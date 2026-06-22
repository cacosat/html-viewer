// Sesión sin estado: una cookie firmada con HMAC-SHA256 (no se guarda en DB).
// Como hay un único token compartido, todas las sesiones son equivalentes.

import { base64url } from "./util.js";

const enc = new TextEncoder();
const COOKIE = "hv_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 días

async function sign(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return base64url(sig);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function createSessionCookie(env, secure) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `v1.${exp}`;
  const sig = await sign(env.SESSION_SECRET, payload);
  const attrs = [`${COOKIE}=${payload}.${sig}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${MAX_AGE}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(secure) {
  const attrs = [`${COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export async function isAuthed(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  if (!m) return false;
  const value = m[1];
  const idx = value.lastIndexOf(".");
  if (idx < 0) return false;
  const payload = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = await sign(env.SESSION_SECRET, payload);
  if (!timingSafeEqual(sig, expected)) return false;
  const parts = payload.split(".");
  if (parts[0] !== "v1") return false;
  const exp = parseInt(parts[1], 10);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

export function verifyToken(env, token) {
  if (!env.AUTH_TOKEN || typeof token !== "string") return false;
  if (token.length !== env.AUTH_TOKEN.length) return false;
  return timingSafeEqual(token, env.AUTH_TOKEN);
}
