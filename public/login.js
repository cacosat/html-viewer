import { setProfile, getProfile, escapeHtml, createProfileModal } from "/common.js";

const stepToken = document.getElementById("step-token");
const stepProfile = document.getElementById("step-profile");
const select = document.getElementById("profile-select");
let profilesData = [];

// Si ya hay sesión: con perfil → biblioteca; sin perfil → paso 2 directo.
fetch("/api/session").then(async (r) => {
  if (!r.ok) return;
  if (getProfile()) { location.href = "/library"; return; }
  await showProfileStep();
}).catch(() => {});

stepToken.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("err-token");
  err.hidden = true;
  const token = document.getElementById("token").value;
  const res = await fetch("/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) { err.textContent = "Token inválido."; err.hidden = false; return; }
  await showProfileStep();
});

async function showProfileStep() {
  await loadProfiles();
  stepToken.hidden = true;
  stepProfile.hidden = false;
}

async function loadProfiles() {
  profilesData = await (await fetch("/api/profiles")).json();
  select.innerHTML = profilesData.length
    ? profilesData.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.area ? " · " + escapeHtml(p.area) : ""}</option>`).join("")
    : `<option value="" disabled selected>Aún no hay perfiles — crea uno</option>`;
}

document.getElementById("new-profile").addEventListener("click", () => {
  createProfileModal(async (p) => {
    await loadProfiles();
    select.value = String(p.id);
  });
});

stepProfile.addEventListener("submit", (e) => {
  e.preventDefault();
  const err = document.getElementById("err-profile");
  const p = profilesData.find((x) => x.id === Number(select.value));
  if (!p) { err.textContent = "Elige o crea un perfil."; err.hidden = false; return; }
  setProfile({ id: p.id, name: p.name, email: p.email, area: p.area });
  location.href = "/library";
});
