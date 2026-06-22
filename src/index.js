// html-viewer — Worker: API JSON + contenido + sirve el frontend estático.

import { json, notFound, badRequest, unauthorized, newId, newShareId } from "./util.js";
import { isAuthed, createSessionCookie, clearSessionCookie, verifyToken } from "./auth.js";

const MAX_UPLOAD = 10 * 1024 * 1024; // 10 MB

// Failsafe de almacenamiento: si el total guardado supera este umbral, se bloquean
// nuevas subidas y crecimientos para no exceder el plan gratuito de R2 (10 GB).
const STORAGE_LIMIT = 7 * 1024 * 1024 * 1024; // 7 GiB

// CSP que aísla el HTML subido en un origen opaco (sin allow-same-origin),
// pero deja correr sus scripts para preservar la interactividad del reporte.
const SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const secure = url.protocol === "https:";

    try {
      // --- Rutas públicas (sin token) ---
      if (path.startsWith("/raw/")) return handleRaw(request, env, url);
      if (path.startsWith("/api/shared/")) return handleSharedMeta(request, env, path);
      if (path.startsWith("/s/")) return serveAsset(env, request, "/shared.html");

      // --- Auth ---
      if (path === "/auth/login" && request.method === "POST") return handleLogin(request, env, secure);
      if (path === "/auth/logout" && request.method === "POST") {
        return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(secure) } });
      }
      if (path === "/api/session") {
        return (await isAuthed(request, env)) ? json({ authed: true }) : unauthorized();
      }

      // Shell del visor/editor del dueño: la página es pública, los datos no.
      if (path.startsWith("/doc/")) return serveAsset(env, request, "/viewer.html");

      // --- API protegida ---
      if (path.startsWith("/api/")) {
        if (!(await isAuthed(request, env))) return unauthorized();
        return handleApi(request, env, path);
      }

      // Fallback: assets estáticos.
      return env.ASSETS.fetch(request);
    } catch (err) {
      return new Response("Error del servidor: " + (err && err.message), { status: 500 });
    }
  },
};

function serveAsset(env, request, assetPath) {
  const u = new URL(request.url);
  u.pathname = assetPath;
  u.search = "";
  return env.ASSETS.fetch(new Request(u.toString(), { headers: request.headers }));
}

async function handleLogin(request, env, secure) {
  const body = await request.json().catch(() => null);
  if (!verifyToken(env, body && body.token)) return unauthorized("Token inválido");
  return json({ ok: true }, { headers: { "Set-Cookie": await createSessionCookie(env, secure) } });
}

// Sirve el contenido HTML crudo (aislado) por share_id. ?download fuerza descarga.
async function handleRaw(request, env, url) {
  const shareId = decodeURIComponent(url.pathname.slice("/raw/".length));
  if (!shareId) return notFound();
  const doc = await env.DB.prepare("SELECT title, r2_key, public FROM documents WHERE share_id = ?").bind(shareId).first();
  if (!doc) return notFound("Documento no encontrado");
  if (!doc.public && !(await isAuthed(request, env))) return new Response("Documento privado", { status: 403 });
  const obj = await env.BUCKET.get(doc.r2_key);
  if (!obj) return notFound("Contenido no encontrado");

  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", SANDBOX_CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "no-store");
  if (url.searchParams.has("download")) {
    const fn = (doc.title || "documento").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "documento";
    headers.set("Content-Disposition", `attachment; filename="${fn}.html"`);
  }
  return new Response(obj.body, { headers });
}

async function handleSharedMeta(request, env, path) {
  const shareId = decodeURIComponent(path.slice("/api/shared/".length));
  const doc = await env.DB.prepare("SELECT title, updated_at, share_id, public FROM documents WHERE share_id = ?")
    .bind(shareId).first();
  if (!doc) return notFound();
  if (!doc.public && !(await isAuthed(request, env))) return json({ private: true }, { status: 403 });
  return json(doc);
}

async function handleApi(request, env, path) {
  if (path === "/api/storage") return handleStorage(env);

  // --- Perfiles ---
  if (path === "/api/profiles") {
    if (request.method === "GET") {
      const r = await env.DB.prepare("SELECT id, name, email, area FROM profiles ORDER BY name COLLATE NOCASE").all();
      return json(r.results);
    }
    if (request.method === "POST") {
      const b = await request.json().catch(() => null);
      const name = (b && b.name ? String(b.name) : "").trim().slice(0, 80);
      const email = (b && b.email ? String(b.email) : "").trim().slice(0, 120) || null;
      const area = (b && b.area ? String(b.area) : "").trim().slice(0, 80) || null;
      if (!name) return badRequest("Nombre requerido");
      const res = await env.DB.prepare("INSERT INTO profiles (name, email, area) VALUES (?, ?, ?)").bind(name, email, area).run();
      return json({ id: res.meta.last_row_id, name, email, area }, { status: 201 });
    }
    return badRequest("Método no soportado");
  }
  const profMatch = path.match(/^\/api\/profiles\/(\d+)$/);
  if (profMatch && request.method === "DELETE") {
    const id = Number(profMatch[1]);
    await env.DB.batch([
      env.DB.prepare("UPDATE documents SET profile_id = NULL WHERE profile_id = ?").bind(id),
      env.DB.prepare("DELETE FROM profiles WHERE id = ?").bind(id),
    ]);
    return new Response(null, { status: 204 });
  }

  // --- Documentos ---
  if (path === "/api/documents") {
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      const scope = params.get("scope");
      const profileId = params.get("profile_id");
      let where = "";
      const binds = [];
      if (scope === "public") {
        where = "WHERE d.public = 1";
      } else if (profileId) {
        where = "WHERE d.profile_id = ?";
        binds.push(Number(profileId));
      }
      const r = await env.DB.prepare(
        `SELECT d.id, d.share_id, d.title, d.public, d.profile_id, p.name AS profile_name,
                d.size, d.created_at, d.updated_at
         FROM documents d LEFT JOIN profiles p ON p.id = d.profile_id
         ${where}
         ORDER BY d.created_at DESC`,
      ).bind(...binds).all();
      return json(r.results);
    }
    if (request.method === "POST") return uploadDocument(request, env);
    return badRequest("Método no soportado");
  }

  const docMatch = path.match(/^\/api\/documents\/([^/]+)$/);
  if (docMatch) {
    const id = decodeURIComponent(docMatch[1]);
    if (request.method === "GET") return getDocument(env, id);
    if (request.method === "PUT") return updateDocument(request, env, id);
    if (request.method === "DELETE") return deleteDocument(env, id);
  }

  return notFound();
}

async function getUsedBytes(env) {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS total FROM documents").first();
  return Number(r && r.total) || 0;
}

async function handleStorage(env) {
  const used = await getUsedBytes(env);
  return json({
    used,
    limit: STORAGE_LIMIT,
    percent: Math.min(100, Math.round((used / STORAGE_LIMIT) * 100)),
    near: used >= STORAGE_LIMIT * 0.8 && used < STORAGE_LIMIT,
    over: used >= STORAGE_LIMIT,
  });
}

function storageBlocked(used) {
  return json(
    {
      error: "storage_limit",
      used,
      limit: STORAGE_LIMIT,
      message:
        "Almacenamiento al límite de seguridad (7 GB). Se bloquearon las subidas para no exceder el plan gratuito de Cloudflare R2 (10 GB). Elimina archivos para liberar espacio o amplía el plan de R2.",
    },
    { status: 507 },
  );
}

async function uploadDocument(request, env) {
  const form = await request.formData().catch(() => null);
  if (!form) return badRequest("Esperaba multipart/form-data");
  const file = form.get("file");
  if (!file || typeof file === "string") return badRequest("Archivo requerido");
  const ab = await file.arrayBuffer();
  if (ab.byteLength > MAX_UPLOAD) return badRequest("Archivo demasiado grande (máx 10 MB)");
  const used = await getUsedBytes(env);
  if (used + ab.byteLength > STORAGE_LIMIT) return storageBlocked(used);
  const content = new TextDecoder().decode(ab);

  const rawTitle = (form.get("title") || file.name || "Documento").toString();
  const title = rawTitle.replace(/\.html?$/i, "").trim().slice(0, 200) || "Documento";
  const profileIdRaw = form.get("profile_id");
  const profile_id = profileIdRaw ? Number(profileIdRaw) : null;
  const isPublic = String(form.get("public")) === "1" ? 1 : 0;

  const id = newId();
  const share_id = newShareId();
  const r2_key = `docs/${id}.html`;

  await env.BUCKET.put(r2_key, content, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.DB.prepare(
    "INSERT INTO documents (id, share_id, title, profile_id, r2_key, size, public) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, share_id, title, profile_id, r2_key, ab.byteLength, isPublic).run();

  return json({ id, share_id, title, profile_id, size: ab.byteLength, public: isPublic }, { status: 201 });
}

async function getDocument(env, id) {
  const doc = await env.DB.prepare(
    `SELECT d.*, p.name AS profile_name FROM documents d
     LEFT JOIN profiles p ON p.id = d.profile_id WHERE d.id = ?`,
  ).bind(id).first();
  if (!doc) return notFound();
  const obj = await env.BUCKET.get(doc.r2_key);
  const content = obj ? await obj.text() : "";
  return json({ ...doc, content });
}

async function updateDocument(request, env, id) {
  const b = await request.json().catch(() => null);
  if (!b) return badRequest();
  const doc = await env.DB.prepare("SELECT r2_key, size FROM documents WHERE id = ?").bind(id).first();
  if (!doc) return notFound();

  const sets = [];
  const binds = [];
  if (typeof b.content === "string") {
    const bytes = new TextEncoder().encode(b.content);
    if (bytes.byteLength > MAX_UPLOAD) return badRequest("Contenido demasiado grande (máx 10 MB)");
    if (bytes.byteLength > (doc.size || 0)) {
      const used = await getUsedBytes(env);
      if (used - (doc.size || 0) + bytes.byteLength > STORAGE_LIMIT) return storageBlocked(used);
    }
    await env.BUCKET.put(doc.r2_key, b.content, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    sets.push("size = ?");
    binds.push(bytes.byteLength);
  }
  if (typeof b.title === "string" && b.title.trim()) {
    sets.push("title = ?");
    binds.push(b.title.trim().slice(0, 200));
  }
  if (b.profile_id !== undefined) {
    sets.push("profile_id = ?");
    binds.push(b.profile_id ? Number(b.profile_id) : null);
  }
  if (b.public !== undefined) {
    sets.push("public = ?");
    binds.push(b.public ? 1 : 0);
  }
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  await env.DB.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true });
}

async function deleteDocument(env, id) {
  const doc = await env.DB.prepare("SELECT r2_key FROM documents WHERE id = ?").bind(id).first();
  if (!doc) return notFound();
  await env.BUCKET.delete(doc.r2_key);
  await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204 });
}
