// Helpers de respuesta y utilidades pequeñas.

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });
}

export const notFound = (msg = "No encontrado") => new Response(msg, { status: 404 });
export const badRequest = (msg = "Solicitud inválida") => new Response(msg, { status: 400 });
export const unauthorized = (msg = "No autorizado") => new Response(msg, { status: 401 });

export const newId = () => crypto.randomUUID();

// Token URL-safe corto para los links públicos.
export function newShareId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function base64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
