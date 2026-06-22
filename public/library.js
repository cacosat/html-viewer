import { api, fmtDate, fmtSize, escapeHtml, toast, getProfile, setProfile, clearProfile, createProfileModal, shareModal } from "/common.js";

const profile = getProfile();
if (!profile) location.href = "/"; // se requiere un perfil activo

const docsEl = document.getElementById("docs");
const emptyEl = document.getElementById("empty");
const storageWarn = document.getElementById("storage-warn");
const uploadForm = document.getElementById("upload");
let currentTab = "mine";

const ICON = {
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
};

const gb = (n) => (n / (1024 ** 3)).toFixed(2);

// ---- Failsafe de almacenamiento ----
function setUploadEnabled(on) { for (const el of uploadForm.elements) el.disabled = !on; }
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
      storageWarn.innerHTML = `Almacenamiento en ${gb(s.used)} GB de 7 GB (límite de seguridad). Al llegar a 7 GB se bloquearán las subidas.`;
      storageWarn.hidden = false;
      setUploadEnabled(true);
    } else {
      storageWarn.hidden = true;
      setUploadEnabled(true);
    }
  } catch { /* noop */ }
}

// ---- Topbar: perfil activo + switcher ----
function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => (w[0] || "").toUpperCase()).join("") || "?";
}
function renderProfileMenu() {
  const mount = document.getElementById("profile-menu");
  mount.innerHTML = `
    <button class="profile-btn" aria-haspopup="true" aria-expanded="false">
      <span class="avatar">${escapeHtml(initials(profile.name))}</span>
      <span class="profile-name">${escapeHtml(profile.name)}</span>
      <span class="chev">${ICON.chev}</span>
    </button>
    <div class="profile-pop" role="menu" hidden></div>`;
  const btn = mount.querySelector(".profile-btn");
  const pop = mount.querySelector(".profile-pop");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); document.removeEventListener("click", onDoc); };
  function onDoc(e) { if (!mount.contains(e.target)) close(); }
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (pop.hidden) { await fillPop(pop, close); pop.hidden = false; btn.setAttribute("aria-expanded", "true"); document.addEventListener("click", onDoc); }
    else close();
  });
}
async function fillPop(pop, close) {
  let profiles = [];
  try { profiles = await (await api("/api/profiles")).json(); } catch { /* noop */ }
  const pick = (p) => { setProfile({ id: p.id, name: p.name, email: p.email, area: p.area }); location.reload(); };
  pop.innerHTML =
    `<div class="pop-label">Perfil</div>` +
    profiles.map((p) => `<button class="pop-item" data-pid="${p.id}">${escapeHtml(p.name)}${p.id === profile.id ? " ✓" : ""}</button>`).join("") +
    `<button class="pop-item" data-new="1">+ Crear perfil</button>` +
    `<div class="pop-sep"></div>` +
    `<button class="pop-item danger" data-logout="1">Salir</button>`;
  pop.querySelectorAll("[data-pid]").forEach((b) => b.addEventListener("click", () => pick(profiles.find((x) => x.id === Number(b.dataset.pid)))));
  pop.querySelector("[data-new]").addEventListener("click", () => { close(); createProfileModal(pick); });
  pop.querySelector("[data-logout]").addEventListener("click", async () => { await fetch("/auth/logout", { method: "POST" }); clearProfile(); location.href = "/"; });
}

// ---- Tabs ----
function setTab(tab) {
  currentTab = tab;
  for (const x of document.querySelectorAll(".lib-tabs button")) x.classList.toggle("active", x.dataset.tab === tab);
  loadDocs();
}
document.querySelector(".lib-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) setTab(b.dataset.tab);
});

// ---- Documentos ----
function cardHtml(d) {
  const vis = d.public ? `<span class="badge green">Público</span>` : `<span class="badge muted-badge">Privado</span>`;
  return `
  <article class="doc-card" data-id="${d.id}" data-share="${d.share_id}" data-public="${d.public}" data-title="${escapeHtml(d.title)}">
    <a class="thumb" href="/doc/${d.id}" aria-label="Abrir ${escapeHtml(d.title)}">
      <iframe data-src="/raw/${d.share_id}" sandbox="allow-scripts" scrolling="no" tabindex="-1" aria-hidden="true"></iframe>
    </a>
    <div class="doc-body">
      <a class="doc-title" href="/doc/${d.id}">${escapeHtml(d.title)}</a>
      <div class="doc-meta">
        ${d.profile_name ? `<span class="badge">${escapeHtml(d.profile_name)}</span>` : ""}
        ${vis}
        <span>${fmtSize(d.size)}</span><span>·</span><span>${fmtDate(d.updated_at)}</span>
      </div>
      <div class="doc-actions">
        <button class="icon-btn" data-act="share" title="Compartir / copiar link" aria-label="Compartir">${ICON.share}</button>
        <a class="icon-btn" href="/raw/${d.share_id}?download" title="Descargar" aria-label="Descargar">${ICON.download}</a>
        <button class="icon-btn danger" data-act="del" title="Eliminar" aria-label="Eliminar">${ICON.trash}</button>
      </div>
    </div>
  </article>`;
}

async function loadDocs() {
  const q = currentTab === "public" ? "scope=public" : `profile_id=${profile.id}`;
  let docs = [];
  try { docs = await (await api(`/api/documents?${q}`)).json(); } catch { return; }
  emptyEl.hidden = docs.length > 0;
  emptyEl.textContent = currentTab === "public" ? "Aún no hay documentos públicos." : "Aún no has subido archivos con este perfil.";
  docsEl.innerHTML = docs.map(cardHtml).join("");
  hydrateThumbs();
}

function hydrateThumbs() {
  const io = new IntersectionObserver((entries, obs) => {
    for (const en of entries) {
      if (en.isIntersecting) {
        const f = en.target;
        if (f.dataset.src) { f.src = f.dataset.src; f.removeAttribute("data-src"); }
        obs.unobserve(f);
      }
    }
  }, { rootMargin: "300px" });
  for (const f of docsEl.querySelectorAll("iframe[data-src]")) io.observe(f);
}

docsEl.addEventListener("click", async (e) => {
  const card = e.target.closest(".doc-card");
  if (!card) return;
  if (e.target.closest('[data-act="share"]')) {
    shareModal({ id: card.dataset.id, share_id: card.dataset.share, public: card.dataset.public === "1", title: card.dataset.title });
    return;
  }
  if (e.target.closest('[data-act="del"]')) {
    if (!confirm("¿Eliminar este archivo definitivamente?")) return;
    await api(`/api/documents/${card.dataset.id}`, { method: "DELETE" });
    await loadDocs();
    await loadStorage();
    toast("Archivo eliminado");
  }
});

// Al cambiar visibilidad desde el modal de compartir, refrescar la lista.
document.addEventListener("hv:doc-changed", () => loadDocs());

// ---- Subir ----
uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = document.getElementById("file").files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("title", document.getElementById("title").value);
  fd.append("profile_id", profile.id);
  fd.append("public", document.getElementById("visibility").value);
  const btn = uploadForm.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Subiendo…";
  try {
    const res = await api("/api/documents", { method: "POST", body: fd });
    if (!res.ok) {
      const txt = await res.text();
      let m = txt; try { m = JSON.parse(txt).message || txt; } catch {}
      throw new Error(m);
    }
    uploadForm.reset();
    setTab("mine");
    await loadStorage();
    toast("Archivo subido");
  } catch (err) {
    alert("Error al subir: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Subir";
  }
});

if (profile) {
  renderProfileMenu();
  loadDocs();
  loadStorage();
}
