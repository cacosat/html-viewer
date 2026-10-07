import { setProfile, getProfile, escapeHtml, createProfileModal } from "/common.js";

const stepToken = document.getElementById("step-token");
const stepProfile = document.getElementById("step-profile");
const tokenEl = document.getElementById("token");
const select = document.getElementById("profile-select");
let profilesData = [];

// Si ya hay sesión: con perfil → biblioteca; sin perfil → paso 2 directo.
fetch("/api/session").then(async (r) => {
  if (!r.ok) { tokenEl.focus(); return; }
  if (getProfile()) { location.href = "/library"; return; }
  await showProfileStep();
}).catch(() => tokenEl.focus());

function showError(input, el, msg) {
  el.textContent = msg;
  el.hidden = !msg;
  if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
}

tokenEl.addEventListener("input", () => showError(tokenEl, document.getElementById("err-token"), ""));

stepToken.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("err-token");
  const token = tokenEl.value;
  if (!token) { showError(tokenEl, err, "Escribe el token de acceso para continuar."); tokenEl.focus(); return; }
  const btn = stepToken.querySelector("button[type=submit]");
  btn.disabled = true;
  const res = await fetch("/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => null);
  btn.disabled = false;
  if (!res || !res.ok) {
    showError(tokenEl, err, res ? "El token no es válido. Revisa mayúsculas y símbolos e inténtalo de nuevo." : "No hay conexión con el servidor. Inténtalo de nuevo.");
    tokenEl.select();
    return;
  }
  await showProfileStep();
});

async function showProfileStep() {
  await loadProfiles();
  stepToken.hidden = true;
  stepProfile.hidden = false;
  select.focus();
}

async function loadProfiles() {
  profilesData = await (await fetch("/api/profiles")).json();
  select.innerHTML = profilesData.length
    ? profilesData.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.area ? " · " + escapeHtml(p.area) : ""}</option>`).join("")
    : `<option value="" disabled selected>Aún no hay perfiles: crea uno</option>`;
}

document.getElementById("new-profile").addEventListener("click", () => {
  createProfileModal(async (p) => {
    await loadProfiles();
    select.value = String(p.id);
    showError(select, document.getElementById("err-profile"), "");
  });
});

stepProfile.addEventListener("submit", (e) => {
  e.preventDefault();
  const p = profilesData.find((x) => x.id === Number(select.value));
  if (!p) { showError(select, document.getElementById("err-profile"), "Elige un perfil de la lista o crea uno nuevo."); return; }
  setProfile({ id: p.id, name: p.name, email: p.email, area: p.area });
  location.href = "/library";
});
