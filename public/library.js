import { api, fmtDate, fmtSize, escapeHtml, toast } from "/common.js";

const profileSel = document.getElementById("profile");
const profileList = document.getElementById("profile-list");
const docsEl = document.getElementById("docs");
const storageWarn = document.getElementById("storage-warn");
const uploadForm = document.getElementById("upload");

const gb = (n) => (n / (1024 ** 3)).toFixed(2);

function setUploadEnabled(on) {
  for (const el of uploadForm.elements) el.disabled = !on;
}

async function loadStorage() {
  try {
    const s = await (await api("/api/storage")).json();
    if (s.over) {
      storageWarn.className = "banner danger";
      storageWarn.innerHTML = `<strong>Almacenamiento al límite (${gb(s.used)} GB / 7 GB).</strong> Se bloquearon las subidas para no exceder el plan gratuito de Cloudflare R2 (10 GB). Elimina archivos o amplía el plan de R2 para volver a subir.`;
      storageWarn.hidden = false;
      setUploadEnabled(false);
    } else if (s.near) {
      storageWarn.className = "banner near";
      storageWarn.innerHTML = `Almacenamiento en ${gb(s.used)} GB de 7 GB (límite de seguridad). Al llegar a 7 GB se bloquearán las subidas para no exceder el plan de R2.`;
      storageWarn.hidden = false;
      setUploadEnabled(true);
    } else {
      storageWarn.hidden = true;
      setUploadEnabled(true);
    }
  } catch { /* sin red o sin sesión: no molestar */ }
}

document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  location.href = "/";
});

async function loadProfiles() {
  const profiles = await (await api("/api/profiles")).json();
  profileSel.innerHTML =
    '<option value="">— Sin perfil —</option>' +
    profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  profileList.innerHTML = profiles.length
    ? profiles.map((p) => `<li><span>${escapeHtml(p.name)}</span> <button data-id="${p.id}" class="link danger">eliminar</button></li>`).join("")
    : "<li class='muted'>Sin perfiles todavía.</li>";
}

profileList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  if (!confirm("¿Eliminar este perfil? Los archivos asociados quedarán sin perfil.")) return;
  await api(`/api/profiles/${btn.dataset.id}`, { method: "DELETE" });
  await loadProfiles();
  await loadDocs();
});

document.getElementById("add-profile").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("profile-name");
  const name = input.value.trim();
  if (!name) return;
  await api("/api/profiles", { method: "POST", body: { name } });
  input.value = "";
  await loadProfiles();
  toast("Perfil agregado");
});

document.getElementById("upload").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = document.getElementById("file").files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("title", document.getElementById("title").value);
  fd.append("profile_id", profileSel.value);
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Subiendo…";
  try {
    const res = await api("/api/documents", { method: "POST", body: fd });
    if (!res.ok) {
      const txt = await res.text();
      let msg = txt; try { msg = JSON.parse(txt).message || txt; } catch {}
      throw new Error(msg);
    }
    e.target.reset();
    await loadDocs();
    await loadStorage();
    toast("Archivo subido");
  } catch (err) {
    alert("Error al subir: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Subir";
  }
});

const shareUrl = (d) => `${location.origin}/s/${d.share_id}`;

async function loadDocs() {
  const docs = await (await api("/api/documents")).json();
  document.getElementById("empty").hidden = docs.length > 0;
  docsEl.innerHTML = docs
    .map(
      (d) => `
    <article class="doc-card">
      <a class="doc-title" href="/doc/${d.id}">${escapeHtml(d.title)}</a>
      <div class="doc-meta">
        ${d.profile_name ? `<span class="badge">${escapeHtml(d.profile_name)}</span>` : ""}
        <span>${fmtSize(d.size)}</span><span>·</span><span>${fmtDate(d.updated_at)}</span>
      </div>
      <div class="doc-actions">
        <a href="/doc/${d.id}">Abrir</a>
        <button class="link" data-copy="${shareUrl(d)}">Copiar link</button>
        <a href="/raw/${d.share_id}?download">Descargar</a>
        <button class="link danger" data-del="${d.id}">Eliminar</button>
      </div>
    </article>`,
    )
    .join("");
}

docsEl.addEventListener("click", async (e) => {
  const copy = e.target.closest("button[data-copy]");
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); toast("Link copiado"); }
    catch { prompt("Copia el link:", copy.dataset.copy); }
    return;
  }
  const del = e.target.closest("button[data-del]");
  if (del) {
    if (!confirm("¿Eliminar este archivo definitivamente?")) return;
    await api(`/api/documents/${del.dataset.del}`, { method: "DELETE" });
    await loadDocs();
    await loadStorage();
    toast("Archivo eliminado");
  }
});

loadProfiles();
loadDocs();
loadStorage();
