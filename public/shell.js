// Shell de la app (inspirado en el doble sidebar de Obsidian):
//   ribbon (íconos: explorador, biblioteca, subir, buscar · tema, perfil)
//   explorador (Mis archivos / Públicos, con filtro y almacenamiento)
//   área de trabajo (la llena cada página)  ·  panel derecho opcional (visor)
// En pantallas angostas el ribbon+explorador y el panel pasan a ser cajones.

import { icon } from "/icons.js";
import {
  api, errorMessage, escapeHtml, fmtShortDate, getProfile, setProfile, clearProfile, initials,
  openMenu, openModal, toast, createProfileModal, pref, setPref, MOD, shortcut, kbd,
} from "/common.js";
import { bindThemeButton } from "/theme.js";

const NARROW = window.matchMedia("(max-width: 860px)");
const root = document.documentElement;

// ---------------- Datos compartidos (explorador + biblioteca) ----------------
const cache = {};
export function loadDocs(scope, { force = false } = {}) {
  if (!force && cache[scope]) return cache[scope];
  const profile = getProfile();
  const q = scope === "public" ? "scope=public" : `profile_id=${profile ? profile.id : 0}`;
  cache[scope] = api(`/api/documents?${q}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return cache[scope];
}
export function invalidateDocs() { for (const k of Object.keys(cache)) delete cache[k]; }

let storagePromise = null;
export function loadStorage({ force = false } = {}) {
  if (!force && storagePromise) return storagePromise;
  storagePromise = api("/api/storage").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return storagePromise;
}
export const fmtGB = (n) => (n / 1024 ** 3).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsage = (n) => {
  const f = (x, d) => x.toLocaleString("es-CL", { maximumFractionDigits: d });
  if (n < 1024 ** 2) return f(n / 1024, 1) + " KB";
  if (n < 1024 ** 3) return f(n / 1024 ** 2, 1) + " MB";
  return fmtGB(n) + " GB";
};

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function matches(title, q) {
  if (!q) return true;
  const t = norm(title);
  return norm(q).split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}

// ---------------- Shell ----------------
let state = null;

export function initShell({ page, docId = null } = {}) {
  const profile = getProfile();
  if (!profile) { location.href = "/"; return null; }
  const shell = document.getElementById("shell");
  state = { page, docId, profile, shell, filter: "" };

  renderRibbon();
  renderExplorer();
  bindShellControls();
  refreshExplorer();
  renderStorage();
  bindDragAndDrop();

  document.addEventListener("keydown", onGlobalKey);
  document.addEventListener("hv:docs-changed", () => { invalidateDocs(); refreshExplorer(); renderStorage(true); });
  document.addEventListener("hv:doc-changed", () => { invalidateDocs(); refreshExplorer(); });
  NARROW.addEventListener("change", () => closeDrawers());

  return {
    profile,
    openUpload,
    openSwitcher,
    toggleRight,
    isRightOpen,
    setActiveDoc(id) { state.docId = id; markActive(); },
  };
}

function renderRibbon() {
  const r = document.getElementById("ribbon");
  const { page, profile } = state;
  r.innerHTML = `
    <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" data-act="toggle-left" aria-label="Explorador" title="Mostrar u ocultar el explorador (${shortcut(MOD, "\\")})">${icon("panel-left")}</button>
    <div class="ribbon-sep"></div>
    <a class="ui-btn ui-btn-ghost ui-btn-icon ribbon-btn" href="/library" aria-label="Biblioteca" title="Biblioteca"${page === "library" ? ' aria-current="page"' : ""}>${icon("layout-grid")}</a>
    <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon ribbon-btn" data-act="upload" aria-label="Subir HTML" title="Subir HTML">${icon("upload")}</button>
    <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon ribbon-btn" data-act="search" aria-label="Buscar documentos" title="Buscar documentos (${shortcut(MOD, "K")})">${icon("search")}</button>
    <span class="spacer"></span>
    <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" data-act="theme" data-side="right" aria-label="Cambiar tema" aria-haspopup="menu" aria-expanded="false" title="Tema"></button>
    <button type="button" class="ui-btn avatar-btn" data-act="profile" aria-haspopup="menu" aria-expanded="false" aria-label="Perfil: ${escapeHtml(profile.name)}" title="${escapeHtml(profile.name)}">${escapeHtml(initials(profile.name))}</button>`;
  bindThemeButton(r.querySelector('[data-act="theme"]'));
  r.querySelector('[data-act="profile"]').addEventListener("click", (e) => openProfileMenu(e.currentTarget));
  syncLeftButton();
}

function renderExplorer() {
  const ex = document.getElementById("explorer");
  const section = (scope, label) => `
    <section class="tree-section" data-scope="${scope}" data-collapsed="${pref("hv-tree-" + scope) === "collapsed"}">
      <button type="button" class="tree-head" aria-expanded="${pref("hv-tree-" + scope) !== "collapsed"}">
        ${icon("chevron-down", 14)}<span>${label}</span><span class="tree-count" aria-label="documentos"></span>
      </button>
      <ul class="tree-list"></ul>
      <p class="tree-empty" hidden></p>
    </section>`;
  ex.innerHTML = `
    <div class="explorer-inner">
      <div class="explorer-head">
        <a class="wordmark" href="/library">Visor HTML</a>
        <span class="spacer"></span>
        <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm ui-btn-icon" data-act="upload" aria-label="Subir HTML" title="Subir HTML">${icon("plus")}</button>
      </div>
      <div class="explorer-search">
        <div class="input-icon">${icon("search", 14)}<input class="ui-input ui-input-sm" type="search" id="tree-filter" placeholder="Filtrar documentos" aria-label="Filtrar documentos" autocomplete="off"></div>
      </div>
      <nav class="explorer-tree" aria-label="Documentos">
        ${section("public", "Públicos")}
        ${section("mine", "Mis archivos")}
      </nav>
      <div class="explorer-foot">
        <div class="storage-row"><span class="overline">Almacenamiento</span><span class="code-sm subtle" id="storage-text">—</span></div>
        <div class="ui-progress" id="storage-bar" role="progressbar" aria-label="Uso de almacenamiento" aria-valuemin="0" aria-valuemax="100"><span style="width:0"></span></div>
        <div id="storage-badge" hidden></div>
      </div>
    </div>`;
  ex.querySelector("#tree-filter").addEventListener("input", (e) => { state.filter = e.target.value; applyFilter(); });
  for (const head of ex.querySelectorAll(".tree-head")) {
    head.addEventListener("click", () => {
      const sec = head.closest(".tree-section");
      const collapsed = sec.dataset.collapsed !== "true";
      sec.dataset.collapsed = String(collapsed);
      head.setAttribute("aria-expanded", String(!collapsed));
      setPref("hv-tree-" + sec.dataset.scope, collapsed ? "collapsed" : "open");
    });
  }
}

async function refreshExplorer() {
  const ex = document.getElementById("explorer");
  const [mine, pub] = await Promise.all([loadDocs("mine"), loadDocs("public")]);
  const fill = (scope, docs, emptyText) => {
    const sec = ex.querySelector(`.tree-section[data-scope="${scope}"]`);
    sec.querySelector(".tree-count").textContent = String(docs.length);
    sec.querySelector(".tree-list").innerHTML = docs.map((d) => `
      <li data-title="${escapeHtml(d.title)}"><a class="tree-item" href="/doc/${encodeURIComponent(d.id)}" data-id="${escapeHtml(d.id)}" title="${escapeHtml(d.title)} · ${d.public ? "Público" : "Privado"}">
        ${icon(d.public ? "globe" : "file-text")}<span class="tree-item-title">${escapeHtml(d.title)}</span><span class="tree-item-date">${fmtShortDate(d.created_at)}</span>
      </a></li>`).join("");
    const empty = sec.querySelector(".tree-empty");
    empty.dataset.base = emptyText;
  };
  fill("mine", mine, "Aún no subes documentos con este perfil.");
  fill("public", pub, "Aún no hay documentos públicos.");
  markActive();
  applyFilter();
  const cur = ex.querySelector('.tree-item[aria-current="page"]');
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

function applyFilter() {
  const ex = document.getElementById("explorer");
  for (const sec of ex.querySelectorAll(".tree-section")) {
    let shown = 0;
    for (const li of sec.querySelectorAll(".tree-list > li")) {
      const ok = matches(li.dataset.title, state.filter);
      li.hidden = !ok;
      if (ok) shown++;
    }
    const empty = sec.querySelector(".tree-empty");
    const total = sec.querySelectorAll(".tree-list > li").length;
    empty.hidden = shown > 0;
    empty.textContent = total && state.filter ? "Sin coincidencias." : empty.dataset.base || "";
  }
}

function markActive() {
  for (const a of document.querySelectorAll("#explorer .tree-item")) {
    if (a.dataset.id === state.docId) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

async function renderStorage(force = false) {
  const s = await loadStorage({ force });
  const text = document.getElementById("storage-text");
  const bar = document.getElementById("storage-bar");
  const badge = document.getElementById("storage-badge");
  if (!s || !text) return;
  text.textContent = `${fmtUsage(s.used)} de ${Math.round(s.limit / 1024 ** 3)} GB`;
  bar.setAttribute("aria-valuenow", String(s.percent));
  bar.firstElementChild.style.width = Math.max(s.percent, s.used > 0 ? 1 : 0) + "%";
  if (s.over || s.near) {
    badge.hidden = false;
    badge.innerHTML = s.over
      ? '<span class="ui-badge ui-badge-danger ui-badge-dot">Límite alcanzado: subidas bloqueadas</span>'
      : '<span class="ui-badge ui-badge-warning ui-badge-dot">Cerca del límite de 7 GB</span>';
  } else badge.hidden = true;
}

// ---------------- Cajones / paneles ----------------
function isLeftOpen() { return NARROW.matches ? state.shell.classList.contains("is-left-open") : root.dataset.left !== "closed"; }
function toggleLeft(force) {
  const open = typeof force === "boolean" ? force : !isLeftOpen();
  if (NARROW.matches) state.shell.classList.toggle("is-left-open", open);
  else {
    if (open) delete root.dataset.left; else root.dataset.left = "closed";
    setPref("hv-left", open ? "open" : "closed");
  }
  syncLeftButton();
}
function syncLeftButton() {
  const b = document.querySelector('#ribbon [data-act="toggle-left"]');
  if (b && state) b.setAttribute("aria-pressed", String(isLeftOpen()));
}
export function isRightOpen() {
  if (!state) return false;
  return NARROW.matches ? state.shell.classList.contains("is-right-open") : root.dataset.right !== "closed";
}
export function toggleRight(force) {
  const open = typeof force === "boolean" ? force : !isRightOpen();
  if (NARROW.matches) state.shell.classList.toggle("is-right-open", open);
  else {
    if (open) delete root.dataset.right; else root.dataset.right = "closed";
    setPref("hv-right", open ? "open" : "closed");
  }
  document.dispatchEvent(new CustomEvent("hv:panel", { detail: { open } }));
  return open;
}
function closeDrawers() {
  state.shell.classList.remove("is-left-open", "is-right-open");
  syncLeftButton();
  document.dispatchEvent(new CustomEvent("hv:panel", { detail: { open: isRightOpen() } }));
}

function bindShellControls() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act], [data-shell]");
    if (!t) return;
    const act = t.dataset.act || t.dataset.shell;
    if (act === "toggle-left" || act === "menu") toggleLeft();
    else if (act === "upload") { if (NARROW.matches) closeDrawers(); openUpload(); }
    else if (act === "search") { if (NARROW.matches) closeDrawers(); openSwitcher(); }
    else if (act === "scrim") closeDrawers();
  });
  // En móvil, navegar desde el explorador cierra el cajón.
  document.getElementById("explorer").addEventListener("click", (e) => { if (NARROW.matches && e.target.closest("a")) closeDrawers(); });
}

function onGlobalKey(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); openSwitcher(); }
  else if (mod && e.key === "\\") { e.preventDefault(); toggleLeft(); }
}

// ---------------- Perfil ----------------
async function openProfileMenu(anchor) {
  let profiles = [];
  try { profiles = await (await api("/api/profiles")).json(); } catch { /* noop */ }
  const pick = (p) => { setProfile({ id: p.id, name: p.name, email: p.email, area: p.area }); location.reload(); };
  openMenu(anchor, [
    { type: "label", label: "Perfil" },
    ...profiles.map((p) => ({ label: p.name, meta: p.area || "", checked: p.id === state.profile.id, onSelect: () => { if (p.id !== state.profile.id) pick(p); } })),
    { label: "Crear perfil", icon: "user-plus", onSelect: () => createProfileModal(pick) },
    { type: "sep" },
    { label: "Cerrar sesión", icon: "log-out", danger: true, onSelect: logout },
  ], { side: "right", align: "end", label: "Perfil" });
}
async function logout() {
  await fetch("/auth/logout", { method: "POST" }).catch(() => {});
  clearProfile();
  location.href = "/";
}

// ---------------- Subir HTML ----------------
const isHtmlFile = (f) => f && (/\.html?$/i.test(f.name) || f.type === "text/html");

export function openUpload(initialFile = null) {
  const profile = getProfile();
  openModal((modal, close) => {
    modal.innerHTML = `
      <form class="ui-modal-body" novalidate>
        <div class="ui-modal-head">
          <h2 class="ui-modal-title">Subir HTML</h2>
          <p class="ui-modal-sub">Quedará en tu biblioteca a nombre de ${escapeHtml(profile.name)}.</p>
        </div>
        <label class="dropzone" id="up-drop">
          ${icon("file-up", 20)}
          <span class="small"><strong class="strong">Arrastra un archivo .html</strong> o elígelo desde tu equipo</span>
          <span class="ui-btn ui-btn-sm">Elegir archivo</span>
          <input type="file" id="up-file" accept=".html,.htm,text/html" class="visually-hidden">
          <span class="dropzone-file" id="up-name" hidden></span>
        </label>
        <div class="ui-field">
          <label class="ui-label" for="up-title">Título</label>
          <input class="ui-input" id="up-title" placeholder="Si lo dejas vacío se usa el nombre del archivo">
        </div>
        <div class="setting-row">
          <div>
            <label class="ui-label" for="up-public">Documento público</label>
            <p class="ui-help">Cualquiera con el link podrá verlo sin iniciar sesión.</p>
          </div>
          <button type="button" class="ui-switch" role="switch" id="up-public" aria-checked="false"></button>
        </div>
        <div class="callout is-danger" id="up-err" hidden>${icon("circle-alert")}<span></span></div>
        <button type="submit" hidden></button>
      </form>
      <div class="ui-modal-footer">
        <button type="button" class="ui-btn ui-btn-ghost" id="up-cancel">Cancelar</button>
        <button type="button" class="ui-btn ui-btn-primary" id="up-submit" disabled>Subir documento</button>
      </div>`;
    const drop = modal.querySelector("#up-drop");
    const input = modal.querySelector("#up-file");
    const nameEl = modal.querySelector("#up-name");
    const titleEl = modal.querySelector("#up-title");
    const sw = modal.querySelector("#up-public");
    const err = modal.querySelector("#up-err");
    const submitBtn = modal.querySelector("#up-submit");
    let file = null;
    let blocked = false;

    const showError = (msg) => { err.querySelector("span").textContent = msg; err.hidden = !msg; };
    function setFile(f) {
      if (!f) return;
      if (!isHtmlFile(f)) { showError("Elige un archivo con extensión .html o .htm."); return; }
      file = f;
      showError("");
      nameEl.textContent = `${f.name} · ${(f.size / 1024).toFixed(1)} KB`;
      nameEl.hidden = false;
      titleEl.placeholder = f.name.replace(/\.html?$/i, "");
      submitBtn.disabled = blocked;
    }
    input.addEventListener("change", () => setFile(input.files[0]));
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); setFile(e.dataTransfer.files[0]); });
    sw.addEventListener("click", () => sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true")));
    modal.querySelector("#up-cancel").addEventListener("click", () => close());

    loadStorage({ force: true }).then((s) => {
      if (s && s.over) {
        blocked = true;
        submitBtn.disabled = true;
        showError(`Almacenamiento al límite (${fmtGB(s.used)} de 7 GB): las subidas están bloqueadas. Elimina documentos o amplía el plan de R2 para volver a subir.`);
      }
    });

    async function submit() {
      if (!file || blocked) return;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", titleEl.value.trim());
      fd.append("profile_id", profile.id);
      fd.append("public", sw.getAttribute("aria-checked") === "true" ? "1" : "0");
      submitBtn.disabled = true;
      submitBtn.textContent = "Subiendo…";
      try {
        const res = await api("/api/documents", { method: "POST", body: fd });
        if (!res.ok) throw new Error(await errorMessage(res));
        const d = await res.json();
        invalidateDocs();
        close();
        toast("Documento subido", { tone: "success" });
        location.href = `/doc/${encodeURIComponent(d.id)}`;
      } catch (e) {
        showError(e.message || "No se pudo subir el archivo. Inténtalo de nuevo.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Subir documento";
      }
    }
    modal.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
    submitBtn.addEventListener("click", submit);
    if (initialFile) setFile(initialFile);
  });
}

// Soltar un .html en cualquier parte de la app abre la subida con ese archivo.
function bindDragAndDrop() {
  let depth = 0, overlay = null;
  const hasFiles = (e) => [...(e.dataTransfer && e.dataTransfer.types || [])].includes("Files");
  const hide = () => { depth = 0; if (overlay) { overlay.remove(); overlay = null; } };
  document.addEventListener("dragenter", (e) => {
    if (!hasFiles(e) || document.querySelector(".ui-modal")) return;
    depth++;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "drop-overlay";
      overlay.innerHTML = `<div class="drop-card">${icon("file-up", 20)}<p class="h4">Suelta el archivo para subirlo</p><p class="small muted">Solo archivos .html</p></div>`;
      document.body.appendChild(overlay);
    }
  });
  document.addEventListener("dragleave", (e) => { if (overlay && --depth <= 0) hide(); });
  document.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    if (!hasFiles(e) || document.querySelector(".ui-modal")) return;
    e.preventDefault();
    hide();
    const f = e.dataTransfer.files[0];
    if (isHtmlFile(f)) openUpload(f);
    else toast("Solo se pueden subir archivos .html", { tone: "danger" });
  });
}

// ---------------- Buscador rápido (⌘K) ----------------
let switcherOpen = false;
export async function openSwitcher() {
  if (switcherOpen) return;
  switcherOpen = true;
  const [mine, pub] = await Promise.all([loadDocs("mine"), loadDocs("public")]);
  const seen = new Set(mine.map((d) => d.id));
  const docs = [
    ...mine.map((d) => ({ ...d, scope: "Mis archivos" })),
    ...pub.filter((d) => !seen.has(d.id)).map((d) => ({ ...d, scope: "Públicos" })),
  ];
  const commands = [
    { title: "Subir HTML", icon: "upload", run: () => openUpload() },
    { title: "Ir a la biblioteca", icon: "layout-grid", run: () => { location.href = "/library"; } },
    { title: "Mostrar u ocultar el explorador", icon: "panel-left", run: () => toggleLeft() },
  ];
  openModal((modal, close) => {
    modal.classList.add("switcher");
    modal.setAttribute("aria-label", "Buscar documentos");
    modal.innerHTML = `
      <div class="switcher-input"><div class="input-icon">${icon("search")}<input class="ui-input" id="sw-q" placeholder="Busca un documento o una acción" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="sw-list"></div></div>
      <div class="switcher-list" id="sw-list" role="listbox"></div>
      <div class="switcher-foot"><span>${kbd("↑")}${kbd("↓")} moverse</span><span>${kbd("↵")} abrir</span><span>${kbd("Esc")} cerrar</span></div>`;
    const q = modal.querySelector("#sw-q");
    const list = modal.querySelector("#sw-list");
    let items = [], sel = 0;
    function render() {
      const query = q.value.trim();
      const ds = docs.filter((d) => matches(d.title, query))
        .sort((a, b) => Number(norm(b.title).startsWith(norm(query))) - Number(norm(a.title).startsWith(norm(query))))
        .slice(0, 30);
      const cs = commands.filter((c) => matches(c.title, query));
      items = [
        ...ds.map((d) => ({ kind: "doc", d, run: () => { location.href = `/doc/${encodeURIComponent(d.id)}`; } })),
        ...cs.map((c) => ({ kind: "cmd", c, run: c.run })),
      ];
      sel = Math.min(sel, Math.max(items.length - 1, 0));
      let html = "";
      if (ds.length) html += `<div class="switcher-group overline">Documentos</div>`;
      items.forEach((it, i) => {
        if (it.kind === "cmd" && (i === 0 || items[i - 1].kind !== "cmd")) html += `<div class="switcher-group overline">Acciones</div>`;
        html += it.kind === "doc"
          ? `<button type="button" class="switcher-item" role="option" data-i="${i}" aria-selected="${i === sel}">${icon(it.d.public ? "globe" : "file-text")}<span class="switcher-title">${escapeHtml(it.d.title)}</span><span class="switcher-meta">${escapeHtml(it.d.scope)} · ${fmtShortDate(it.d.created_at)}</span></button>`
          : `<button type="button" class="switcher-item" role="option" data-i="${i}" aria-selected="${i === sel}">${icon(it.c.icon)}<span class="switcher-title">${escapeHtml(it.c.title)}</span></button>`;
      });
      list.innerHTML = html || `<p class="switcher-empty">Sin resultados para «${escapeHtml(query)}».</p>`;
      const cur = list.querySelector('[aria-selected="true"]');
      if (cur) cur.scrollIntoView({ block: "nearest" });
    }
    function run(i) { const it = items[i]; if (!it) return; close(); it.run(); }
    q.addEventListener("input", () => { sel = 0; render(); });
    q.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % Math.max(items.length, 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(items.length, 1); render(); }
      else if (e.key === "Enter") { e.preventDefault(); run(sel); }
    });
    list.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) run(Number(b.dataset.i)); });
    list.addEventListener("mousemove", (e) => {
      const b = e.target.closest("[data-i]");
      if (b && Number(b.dataset.i) !== sel) { sel = Number(b.dataset.i); for (const x of list.querySelectorAll("[data-i]")) x.setAttribute("aria-selected", String(Number(x.dataset.i) === sel)); }
    });
    render();
  }, { top: true, wide: true, onClose: () => { switcherOpen = false; } });
}
