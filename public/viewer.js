import { icon, hydrateIcons } from "/icons.js";
import {
  api, errorMessage, escapeHtml, fmtDate, fmtSize, toast, shareModal, presentMode, confirmDialog,
  setVisibility, shareUrl, copyText, pref, setPref, MOD, shortcut,
} from "/common.js";
import { initShell, toggleRight, isRightOpen } from "/shell.js";
import { createEditor } from "/editor.js";
import { initComments } from "/comments.js";

hydrateIcons();
const id = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
const shell = initShell({ page: "doc", docId: id });

const $ = (s) => document.getElementById(s);
const titleEl = $("title");
const saveBtn = $("save");
const discardBtn = $("discard");
const saveState = $("save-state");
const docArea = $("docArea");
const viewStage = $("viewStage"), editStage = $("editStage"), codePane = $("codePane");
const viewFrame = $("viewFrame"), editFrame = $("editFrame"), codeEl = $("code");
const modeButtons = [...document.querySelectorAll("#modes [data-mode]")];
const panelToggle = $("toggle-panel");
const panelCount = $("panel-count");

let doc = null;
let content = "";           // HTML vigente (se actualiza al salir de cada modo)
let savedContent = "";      // última versión guardada en el servidor
let savedTitle = "";
let mode = "view";
let editSource = null;      // HTML con el que se cargó Editar…
let editBaseline = null;    // …y su serialización sin cambios (entrar/salir no ensucia)
let cm = null, cmSetting = false;
let saving = false;
let openComments = 0;

saveBtn.title = `Guardar (${shortcut(MOD, "S")})`;

// ---------------- Editor ----------------
const editor = createEditor({
  frame: editFrame,
  formatBar: $("formatBar"),
  overlays: $("editOverlays"),
  blockBar: $("blockBar"),
  blockOutline: $("blockOutline"),
  statusBar: $("editStatus"),
  onChange: () => scheduleDirtyCheck(),
  onSave: () => save(),
});

// ---------------- Contenido y estado de guardado ----------------
function currentContent() {
  if (mode === "edit" && editor.ready && editBaseline != null) {
    const s = editor.serialize();
    if (s == null) return content;
    return s === editBaseline ? editSource : s;
  }
  if (mode === "code") return cm ? cm.getValue() : codeEl.value;
  return content;
}
function captureCurrent() { content = currentContent(); }
const titleValue = () => titleEl.value.trim();
const isDirty = () => !!doc && (currentContent() !== savedContent || (!!titleValue() && titleValue() !== savedTitle));

const STATE_TEXT = { dirty: "Cambios sin guardar", saving: "Guardando…", saved: "Guardado", error: "No se guardó" };
function setSaveState(state) {
  if (!state) { saveState.hidden = true; saveState.dataset.state = ""; return; }
  saveState.hidden = false;
  saveState.dataset.state = state;
  saveState.title = STATE_TEXT[state];
  saveState.firstElementChild.textContent = STATE_TEXT[state];
}
function updateDirty() {
  const dirty = isDirty();
  saveBtn.disabled = !dirty || saving;
  discardBtn.hidden = !dirty;
  if (saving) return;
  const cur = saveState.dataset.state;
  if (dirty) setSaveState(cur === "error" ? "error" : "dirty");
  else setSaveState(cur === "saved" ? "saved" : null);
}
let dirtyTimer = null;
function scheduleDirtyCheck() {
  if (!saving && saveState.dataset.state !== "error") { setSaveState("dirty"); saveBtn.disabled = false; }
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(updateDirty, 250);
}

const sqliteNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

async function save() {
  if (saving || !doc) return;
  captureCurrent();
  const title = titleValue();
  const body = {};
  if (content !== savedContent) body.content = content;
  if (title && title !== savedTitle) body.title = title;
  if (!Object.keys(body).length) { updateDirty(); return; }
  saving = true;
  saveBtn.disabled = true;
  setSaveState("saving");
  try {
    const res = await api(`/api/documents/${encodeURIComponent(id)}`, { method: "PUT", body });
    if (!res.ok) throw new Error(await errorMessage(res));
    savedContent = content;
    if (body.title) savedTitle = title;
    doc.title = savedTitle;
    doc.updated_at = sqliteNow();
    if (body.content) doc.size = new Blob([content]).size;
    if (mode === "edit" && editor.ready) { editSource = content; editBaseline = editor.serialize(); }
    document.title = `${savedTitle || "Documento"} · Visor HTML`;
    renderDetails();
    if (body.title) document.dispatchEvent(new CustomEvent("hv:docs-changed"));
    saving = false;
    setSaveState("saved");
    setTimeout(() => { if (saveState.dataset.state === "saved" && !isDirty()) setSaveState(null); }, 2500);
  } catch (e) {
    saving = false;
    setSaveState("error");
    toast(e.message || "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.", { tone: "danger", duration: 8000 });
  }
  updateDirty();
}
saveBtn.addEventListener("click", save);

discardBtn.addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "¿Descartar los cambios sin guardar?",
    body: "El documento vuelve a la última versión guardada.",
    confirm: "Descartar cambios", cancel: "Seguir editando", danger: true,
  });
  if (!ok) return;
  content = savedContent;
  titleEl.value = savedTitle;
  setSaveState(null);
  await setMode(mode, { force: true, keep: true });
  toast("Cambios descartados");
});

// ---------------- Modos: Vista / Editar / Código ----------------
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
let cmAssets = null;
function loadCMAssets() {
  if (cmAssets) return cmAssets;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/vendor/codemirror/codemirror.min.css";
  document.head.appendChild(link);
  cmAssets = (async () => {
    await loadScript("/vendor/codemirror/codemirror.min.js");
    await loadScript("/vendor/codemirror/xml.min.js");
    await loadScript("/vendor/codemirror/javascript.min.js");
    await loadScript("/vendor/codemirror/css.min.js");
    await loadScript("/vendor/codemirror/htmlmixed.min.js");
  })();
  return cmAssets;
}
async function ensureCM() {
  if (cm) return;
  try {
    await loadCMAssets();
    if (!window.CodeMirror) return;
    cm = window.CodeMirror.fromTextArea(codeEl, { mode: "htmlmixed", lineNumbers: true, lineWrapping: true, tabSize: 2, theme: "default" });
    cm.on("change", () => { if (!cmSetting) scheduleDirtyCheck(); });
  } catch {
    cm = null; // queda el textarea plano
  }
}
codeEl.addEventListener("input", () => scheduleDirtyCheck());

async function setMode(m, { force = false, keep = false } = {}) {
  if (!doc || (m === mode && !force)) return;
  if (!keep) captureCurrent();
  mode = m;
  for (const b of modeButtons) {
    b.setAttribute("aria-selected", String(b.dataset.mode === m));
    b.tabIndex = b.dataset.mode === m ? 0 : -1;
  }
  docArea.classList.toggle("is-editing", m === "edit");
  viewStage.hidden = m !== "view";
  editStage.hidden = m !== "edit";
  codePane.hidden = m !== "code";
  editor.setActive(m === "edit");
  if (m === "view") {
    viewFrame.srcdoc = content;
  } else if (m === "edit") {
    editSource = content;
    editBaseline = null;
    await editor.load(content);
    if (mode !== "edit") return;
    editBaseline = editor.serialize();
    editor.focus();
  } else {
    await ensureCM();
    if (mode !== "code") return;
    if (cm) {
      cmSetting = true; cm.setValue(content); cmSetting = false;
      setTimeout(() => { cm.refresh(); cm.focus(); }, 0);
    } else codeEl.value = content;
  }
  updateDirty();
}
for (const b of modeButtons) b.addEventListener("click", () => setMode(b.dataset.mode));
$("modes").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const i = modeButtons.findIndex((b) => b.dataset.mode === mode);
  const next = modeButtons[(i + (e.key === "ArrowRight" ? 1 : modeButtons.length - 1)) % modeButtons.length];
  setMode(next.dataset.mode);
  next.focus();
});

// ---------------- Título ----------------
titleEl.addEventListener("input", () => updateDirty());
titleEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); }
  else if (e.key === "Escape") { titleEl.value = savedTitle; titleEl.blur(); updateDirty(); }
});
titleEl.addEventListener("blur", () => { if (!titleValue()) titleEl.value = savedTitle; updateDirty(); });

// ---------------- Acciones del header ----------------
$("share").addEventListener("click", () => { if (doc) shareModal(doc); });
$("present").addEventListener("click", () => { if (!doc) return; captureCurrent(); presentMode({ srcdoc: content }); });

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
});
window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

// ---------------- Panel derecho: comentarios / detalles ----------------
const panelTabs = [...document.querySelectorAll(".panel-tabs [data-ptab]")];
function setPanelTab(t) {
  for (const b of panelTabs) {
    const on = b.dataset.ptab === t;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    $(b.getAttribute("aria-controls")).hidden = !on;
  }
  setPref("hv-panel-tab", t);
}
for (const b of panelTabs) b.addEventListener("click", () => setPanelTab(b.dataset.ptab));
document.querySelector(".panel-tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const cur = panelTabs.findIndex((b) => b.getAttribute("aria-selected") === "true");
  const next = panelTabs[(cur + 1) % panelTabs.length];
  setPanelTab(next.dataset.ptab);
  next.focus();
});
function syncPanelButton() {
  const open = isRightOpen();
  panelToggle.setAttribute("aria-pressed", String(open));
  panelToggle.title = open ? "Ocultar comentarios y detalles" : "Mostrar comentarios y detalles";
  panelCount.textContent = String(openComments);
  panelCount.hidden = open || !openComments;
}
panelToggle.addEventListener("click", () => toggleRight());
$("panel-close").addEventListener("click", () => toggleRight(false));
document.addEventListener("hv:panel", syncPanelButton);

const comments = shell && initComments({
  docId: id,
  profile: shell.profile,
  listEl: $("comments-list"),
  formEl: $("comments-form"),
  countEls: [$("comments-count")],
  onCount: (n) => { openComments = n; syncPanelButton(); },
});

function downloadCurrent() {
  captureCurrent();
  const name = (titleValue() || savedTitle || "documento").replace(/[^\p{L}\p{N}._ -]+/gu, "_").trim().slice(0, 80) || "documento";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: "text/html;charset=utf-8" }));
  a.download = name + ".html";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function renderDetails() {
  const el = $("details");
  if (!doc || !el) return;
  const owner = !doc.profile_id || (shell && doc.profile_id === shell.profile.id);
  const pub = doc.public === 1 || doc.public === true;
  el.innerHTML = `
    <section class="details-section">
      <span class="overline">Documento</span>
      <dl class="kv">
        <dt>Propietario</dt><dd>${escapeHtml(doc.profile_name || "Sin perfil")}</dd>
        <dt>Creado</dt><dd>${escapeHtml(fmtDate(doc.created_at))}</dd>
        <dt>Actualizado</dt><dd>${escapeHtml(fmtDate(doc.updated_at))}</dd>
        <dt>Tamaño</dt><dd class="mono">${escapeHtml(fmtSize(doc.size))}</dd>
      </dl>
    </section>
    <section class="details-section">
      <span class="overline">Compartir</span>
      <div class="setting-row">
        <div>
          <label class="ui-label" for="dt-public">Documento público</label>
          <p class="ui-help" id="dt-public-desc">${pub ? "Cualquiera con el link puede verlo, sin iniciar sesión." : "Solo quienes inician sesión pueden abrirlo."}</p>
        </div>
        <button type="button" class="ui-switch" role="switch" id="dt-public" aria-checked="${pub}" aria-describedby="dt-public-desc"></button>
      </div>
      <div class="ui-field">
        <label class="ui-label" for="dt-link">Link</label>
        <div class="copy-row">
          <input class="ui-input" id="dt-link" readonly value="${escapeHtml(shareUrl(doc))}">
          <button type="button" class="ui-btn ui-btn-icon" id="dt-copy" aria-label="Copiar link" title="Copiar link">${icon("copy")}</button>
        </div>
      </div>
    </section>
    <section class="details-section">
      <span class="overline">Acciones</span>
      <div class="details-actions">
        <button type="button" class="ui-btn" id="dt-download" title="Incluye los cambios sin guardar">${icon("download")}Descargar HTML</button>
        ${owner ? `<button type="button" class="ui-btn ui-btn-danger" id="dt-delete">${icon("trash")}Eliminar documento</button>` : ""}
      </div>
    </section>`;
  const sw = $("dt-public");
  sw.addEventListener("click", async () => {
    sw.disabled = true;
    try {
      await setVisibility(doc, !(doc.public === 1 || doc.public === true));
      toast(doc.public ? "Ahora es público" : "Ahora es privado");
    } catch { toast("No se pudo cambiar la visibilidad", { tone: "danger" }); sw.disabled = false; }
  });
  $("dt-copy").addEventListener("click", () => copyText(shareUrl(doc), $("dt-link")));
  $("dt-download").addEventListener("click", downloadCurrent);
  const del = $("dt-delete");
  if (del) del.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "¿Eliminar este documento?",
      body: `«${doc.title}» y sus comentarios se eliminarán definitivamente.`,
      confirm: "Eliminar documento", cancel: "Conservar documento", danger: true,
    });
    if (!ok) return;
    const res = await api(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) { toast(await errorMessage(res) || "No se pudo eliminar", { tone: "danger" }); return; }
    savedContent = currentContent(); savedTitle = titleValue() || savedTitle; // evita el aviso de cambios al salir
    location.href = "/library";
  });
}
document.addEventListener("hv:doc-changed", (e) => { if (doc && e.detail && e.detail.id === doc.id) renderDetails(); });

// ---------------- Carga ----------------
function showLoadError(status) {
  docArea.innerHTML = `
    <div class="doc-error">
      <div class="ui-card state-card">
        <div class="empty-icon">${icon("circle-alert", 20)}</div>
        <h2 class="h3">${status === 404 ? "No encontramos este documento" : "No se pudo abrir el documento"}</h2>
        <p class="small muted">${status === 404 ? "Puede que lo hayan eliminado. Vuelve a la biblioteca para ver los disponibles." : "Revisa tu conexión y vuelve a intentarlo."}</p>
        <a class="ui-btn" href="/library">Ir a la biblioteca</a>
      </div>
    </div>`;
  for (const b of [saveBtn, $("share"), $("present"), ...modeButtons]) b.disabled = true;
  titleEl.disabled = true;
}

async function load() {
  if (!shell) return;
  setPanelTab(pref("hv-panel-tab", "comments"));
  syncPanelButton();
  let res;
  try { res = await api(`/api/documents/${encodeURIComponent(id)}`); } catch { showLoadError(0); return; }
  if (!res.ok) { showLoadError(res.status); return; }
  doc = await res.json();
  content = savedContent = doc.content || "";
  delete doc.content;
  savedTitle = doc.title || "";
  titleEl.value = savedTitle;
  document.title = `${savedTitle || "Documento"} · Visor HTML`;
  const crumb = $("crumb-scope");
  if (doc.profile_id === shell.profile.id) { crumb.textContent = "Mis archivos"; crumb.href = "/library?scope=mine"; }
  else if (doc.public) { crumb.textContent = "Públicos"; crumb.href = "/library"; }
  else { crumb.textContent = "Biblioteca"; crumb.href = "/library"; }
  renderDetails();
  viewFrame.srcdoc = content;
  comments.load({ scrollToEnd: true });
  if (location.hash === "#editar") setMode("edit");
  else if (location.hash === "#codigo") setMode("code");
}

load();
