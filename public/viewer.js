import { api, toast, shareModal, presentMode, getProfile, escapeHtml, fmtDate } from "/common.js";

const id = location.pathname.split("/").filter(Boolean).pop();
const viewStage = document.getElementById("viewStage");
const editStage = document.getElementById("editStage");
const codePane = document.getElementById("codePane");
const viewFrame = document.getElementById("viewFrame");
const editFrame = document.getElementById("editFrame");
const codeEl = document.getElementById("code");
const titleEl = document.getElementById("title");
const saveBtn = document.getElementById("save");
const tabButtons = [...document.querySelectorAll(".tabs button")];
const docArea = document.querySelector(".doc-area");

let doc = null;
let content = "";   // fuente de verdad del HTML, siempre al día
let dirty = false;
let cm = null;      // instancia CodeMirror (carga diferida)
let cmSettingValue = false; // ignora el evento change del setValue programático

function markDirty() { dirty = true; saveBtn.disabled = false; }

// Serializa el HTML del iframe de edición. Guarda contra vaciar `content`
// (p. ej. si el iframe aún no terminó de cargar).
function readEditFrame() {
  try {
    const d = editFrame.contentDocument;
    if (!d || !d.body || !d.body.innerHTML.trim()) return content;
    const doctype = d.doctype ? `<!DOCTYPE ${d.doctype.name}>\n` : "";
    return doctype + d.documentElement.outerHTML;
  } catch {
    return content;
  }
}

// La superficie visible es la fuente de verdad (no depende de estado externo).
function visibleSurface() {
  if (!codePane.hidden) return "code";
  if (!editStage.hidden) return "text";
  return "view";
}

function captureCurrent() {
  const s = visibleSurface();
  if (s === "text") content = readEditFrame();
  else if (s === "code") content = cm ? cm.getValue() : codeEl.value;
}

// ---- CodeMirror (self-host, carga diferida) ----
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
    cm = window.CodeMirror.fromTextArea(codeEl, {
      mode: "htmlmixed",
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
      theme: "default",
    });
    cm.on("change", () => { if (cmSettingValue) return; content = cm.getValue(); markDirty(); });
  } catch {
    cm = null; // fallback: textarea plano
  }
}

async function setTab(tab) {
  captureCurrent(); // captura ediciones de la superficie actual antes de cambiar
  for (const b of tabButtons) b.classList.toggle("active", b.dataset.tab === tab);
  viewStage.hidden = tab !== "view";
  editStage.hidden = tab !== "text";
  codePane.hidden = tab !== "code";

  const editing = tab === "text";
  docArea.classList.toggle("editing", editing);
  formatBar.hidden = !editing;
  editOverlays.hidden = !editing;
  if (!editing) hideBlockUI();

  if (tab === "view") {
    viewFrame.srcdoc = content;
  } else if (tab === "text") {
    editFrame.onload = () => {
      try {
        const d = editFrame.contentDocument;
        d.designMode = "on";
        // Formato como CSS inline (spans con style) y Enter crea <p>.
        try { d.execCommand("styleWithCSS", false, true); d.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* noop */ }
        d.addEventListener("input", () => { content = readEditFrame(); markDirty(); requestAnimationFrame(positionBlockUI); });
        attachEdit(d);
      } catch (_) { /* algún navegador podría bloquearlo */ }
    };
    editFrame.srcdoc = content;
  } else if (tab === "code") {
    await ensureCM();
    if (cm) { cmSettingValue = true; cm.setValue(content); cmSettingValue = false; setTimeout(() => cm.refresh(), 0); }
    else { codeEl.value = content; }
  }
}

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) setTab(b.dataset.tab);
});

titleEl.addEventListener("input", markDirty);

saveBtn.addEventListener("click", async () => {
  captureCurrent();
  saveBtn.disabled = true;
  saveBtn.textContent = "Guardando…";
  try {
    const res = await api(`/api/documents/${id}`, { method: "PUT", body: { content, title: titleEl.value } });
    if (!res.ok) {
      const txt = await res.text();
      let msg = txt; try { msg = JSON.parse(txt).message || txt; } catch {}
      throw new Error(msg);
    }
    dirty = false;
    toast("Guardado");
  } catch (err) {
    alert("Error al guardar: " + err.message);
  } finally {
    saveBtn.textContent = "Guardar";
    saveBtn.disabled = !dirty;
  }
});

document.getElementById("copy").addEventListener("click", () => {
  if (!doc) return;
  shareModal({ id: doc.id, share_id: doc.share_id, public: doc.public, title: doc.title });
});

document.getElementById("present").addEventListener("click", () => {
  captureCurrent();
  presentMode({ srcdoc: content });
});

// ============================================================
// Edición enriquecida: barra de formato + editor de bloques.
// Toda la UI vive FUERA del iframe (overlays en el padre), así
// jamás se serializa dentro del HTML guardado.
// ============================================================
const formatBar = document.getElementById("formatBar");
const editOverlays = document.getElementById("editOverlays");
const blockBar = document.getElementById("blockBar");
const blockOutline = document.getElementById("blockOutline");
const blockTag = document.getElementById("blockTag");
const blockFormatSel = document.getElementById("blockFormat");
const foreColorInput = document.getElementById("foreColor");
const foreSwatch = document.getElementById("foreSwatch");
const blockBgInput = document.getElementById("blockBg");
const bgSwatch = document.getElementById("bgSwatch");

let edDoc = null;       // document del iframe en edición
let edWin = null;       // window del iframe en edición
let savedRange = null;  // última selección conocida (para restaurar tras usar la toolbar)
let activeBlock = null; // bloque activo (modelo A: donde está el cursor)

// td/th excluidos a propósito: el caret en una celda selecciona la FILA (tr).
const BLOCK_SEL = "p,h1,h2,h3,h4,h5,h6,ul,ol,li,table,tr,blockquote,pre,figure,figcaption,section,article,header,footer,aside,nav,div,form,fieldset";

function attachEdit(d) {
  edDoc = d;
  edWin = editFrame.contentWindow;
  savedRange = null;
  activeBlock = null;
  hideBlockUI();
  d.addEventListener("selectionchange", onEditSelection);
  d.addEventListener("mouseup", onEditSelection);
  d.addEventListener("keyup", onEditSelection);
  edWin.addEventListener("scroll", () => positionBlockUI(), true);
}

function ancestorBlock(node) {
  if (!edDoc) return null;
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  if (!el || !el.closest) return null;
  const b = el.closest(BLOCK_SEL);
  return b && b !== edDoc.body && b !== edDoc.documentElement && edDoc.body.contains(b) ? b : null;
}

function onEditSelection() {
  if (!edDoc) return;
  try {
    const sel = edWin.getSelection();
    if (sel && sel.rangeCount) {
      savedRange = sel.getRangeAt(0).cloneRange();
      activeBlock = ancestorBlock(sel.getRangeAt(0).startContainer);
    }
  } catch { /* noop */ }
  updateToolbarState();
  positionBlockUI();
}

function syncEdit() { content = readEditFrame(); markDirty(); }

// Ejecuta un comando de edición restaurando la selección (los botones de la
// toolbar no roban el foco gracias al preventDefault en mousedown, pero el
// select y los pickers de color sí — savedRange cubre esos casos).
function exec(cmd, val = null) {
  if (!edDoc) return;
  try {
    edWin.focus();
    const sel = edWin.getSelection();
    if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); }
    edDoc.execCommand(cmd, false, val);
    syncEdit();
    updateToolbarState();
    requestAnimationFrame(positionBlockUI);
  } catch { /* noop */ }
}

const STATE_CMDS = ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList", "justifyLeft", "justifyCenter", "justifyRight"];
function updateToolbarState() {
  if (!edDoc || formatBar.hidden) return;
  for (const btn of formatBar.querySelectorAll("[data-cmd]")) {
    const c = btn.dataset.cmd;
    if (!STATE_CMDS.includes(c)) continue;
    let on = false;
    try { on = edDoc.queryCommandState(c); } catch { /* noop */ }
    btn.classList.toggle("active", on);
  }
  let v = "";
  try { v = String(edDoc.queryCommandValue("formatBlock")).toLowerCase(); } catch { /* noop */ }
  blockFormatSel.value = ["p", "h1", "h2", "h3"].includes(v) ? v : "";
}

// --- Wiring de la barra de formato ---
formatBar.addEventListener("mousedown", (e) => { if (!e.target.closest("select,input")) e.preventDefault(); });
formatBar.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cmd]");
  if (b) exec(b.dataset.cmd);
});
blockFormatSel.addEventListener("change", () => {
  if (blockFormatSel.value) exec("formatBlock", "<" + blockFormatSel.value + ">");
});
document.getElementById("linkBtn").addEventListener("click", () => {
  const url = prompt("URL del enlace:", "https://");
  if (url && url !== "https://") exec("createLink", url);
});
foreColorInput.addEventListener("change", () => {
  foreSwatch.style.borderBottomColor = foreColorInput.value;
  exec("foreColor", foreColorInput.value);
});

// --- Editor de bloques (modelo A: mini-barra anclada al bloque del cursor) ---
function hideBlockUI() { blockBar.hidden = true; blockOutline.hidden = true; }

function positionBlockUI() {
  if (editStage.hidden || !edDoc || !activeBlock || !activeBlock.isConnected) { hideBlockUI(); return; }
  let r;
  try { r = activeBlock.getBoundingClientRect(); } catch { hideBlockUI(); return; }
  if (!r.width && !r.height) { hideBlockUI(); return; } // display:none u oculto
  const ifr = editFrame.getBoundingClientRect();
  const da = docArea.getBoundingClientRect();
  const ox = ifr.left - da.left, oy = ifr.top - da.top;

  blockOutline.style.top = oy + r.top + "px";
  blockOutline.style.left = ox + r.left + "px";
  blockOutline.style.width = r.width + "px";
  blockOutline.style.height = r.height + "px";
  blockOutline.hidden = false;

  blockTag.textContent = activeBlock.tagName.toLowerCase();
  blockBar.hidden = false;
  const bw = blockBar.offsetWidth, bh = blockBar.offsetHeight;
  let top = oy + r.top - bh - 6;
  if (top < oy + 4) top = oy + r.bottom + 6; // no cabe arriba → debajo del bloque
  top = Math.min(Math.max(top, oy + 4), oy + ifr.height - bh - 4);
  let left = ox + r.left;
  left = Math.min(Math.max(left, ox + 4), Math.max(ox + 4, ox + ifr.width - bw - 4));
  blockBar.style.top = top + "px";
  blockBar.style.left = left + "px";
}

blockBar.addEventListener("mousedown", (e) => { if (!e.target.closest("input")) e.preventDefault(); });
blockBar.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || !edDoc || !activeBlock || !activeBlock.isConnected) return;
  const el = activeBlock;
  const p = el.parentElement;

  if (b.dataset.act === "parent") {
    if (p && p !== edDoc.body && p !== edDoc.documentElement) { activeBlock = p; positionBlockUI(); }
    return; // no muta el documento
  }

  switch (b.dataset.act) {
    case "up":
      if (el.previousElementSibling) { p.insertBefore(el, el.previousElementSibling); el.scrollIntoView({ block: "nearest" }); }
      break;
    case "down":
      if (el.nextElementSibling) { p.insertBefore(el.nextElementSibling, el); el.scrollIntoView({ block: "nearest" }); }
      break;
    case "dup":
      el.after(el.cloneNode(true));
      break;
    case "smaller":
    case "bigger": {
      const cur = parseFloat(edWin.getComputedStyle(el).fontSize) || 16;
      const next = b.dataset.act === "bigger" ? cur * 1.15 : cur / 1.15;
      el.style.fontSize = Math.min(96, Math.max(8, Math.round(next))) + "px";
      break;
    }
    case "resetStyle":
      el.style.backgroundColor = "";
      el.style.fontSize = "";
      el.style.display = "";
      if (!el.getAttribute("style")) el.removeAttribute("style");
      break;
    case "hide":
      el.style.display = "none";
      hideBlockUI();
      toast("Bloque oculto — recuperable desde la pestaña Código");
      break;
    case "del": {
      // Vía selección + execCommand para que Ctrl/Cmd+Z pueda deshacerlo.
      try {
        const r = edDoc.createRange();
        r.selectNode(el);
        const sel = edWin.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        edDoc.execCommand("delete");
        edWin.focus();
      } catch { el.remove(); }
      activeBlock = null;
      hideBlockUI();
      toast("Bloque eliminado — Ctrl/Cmd+Z para deshacer");
      break;
    }
  }
  syncEdit();
  requestAnimationFrame(positionBlockUI);
});

blockBgInput.addEventListener("input", () => {
  if (activeBlock && activeBlock.isConnected) {
    activeBlock.style.backgroundColor = blockBgInput.value;
    bgSwatch.style.background = blockBgInput.value;
  }
});
blockBgInput.addEventListener("change", () => { syncEdit(); });

// Reposicionar overlays ante cambios de layout (toggle comentarios, resize, etc.).
new ResizeObserver(() => positionBlockUI()).observe(editFrame);
window.addEventListener("resize", positionBlockUI);
// El hueco sobre el documento sigue la altura real de la barra (puede envolver a 2 filas).
new ResizeObserver(() => {
  docArea.style.setProperty("--fbh", formatBar.offsetHeight + "px");
}).observe(formatBar);

// ---- Comentarios ----
const profile = getProfile();
const commentsList = document.getElementById("comments-list");
const commentsForm = document.getElementById("comments-form");
const commentsCount = document.getElementById("comments-count");
let resolvedOpen = false; // estado del desplegable "Resueltos" entre re-renders

const CICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  reopen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
};

function commentHtml(c) {
  const resolved = !!c.resolved;
  const toggle = resolved
    ? `<button class="cbtn" data-cact="reopen" title="Reabrir comentario">${CICON.reopen}Reabrir</button>`
    : `<button class="cbtn" data-cact="resolve" title="Marcar como resuelto">${CICON.check}Resolver</button>`;
  const note = resolved
    ? `<div class="comment-resolved-note">${CICON.check}Resuelto${c.resolved_by ? " por " + escapeHtml(c.resolved_by) : ""}${c.resolved_at ? " · " + fmtDate(c.resolved_at) : ""}</div>`
    : "";
  return `<div class="comment${resolved ? " resolved" : ""}" data-cid="${c.id}">
    <div class="comment-head"><span class="comment-author">${escapeHtml(c.author || "—")}</span><span class="comment-date">${fmtDate(c.created_at)}</span></div>
    <div class="comment-body">${escapeHtml(c.body)}</div>${note}
    <div class="comment-actions">${toggle}<button class="cbtn icon danger" data-cact="delete" title="Eliminar comentario" aria-label="Eliminar comentario">${CICON.trash}</button></div>
  </div>`;
}

async function loadComments({ scrollToEnd = false } = {}) {
  try {
    const cs = await (await api(`/api/documents/${id}/comments`)).json();
    const open = cs.filter((c) => !c.resolved);
    const done = cs.filter((c) => c.resolved);
    const prevScroll = commentsList.scrollTop;
    let html = open.length
      ? open.map(commentHtml).join("")
      : `<p class="muted comments-empty">${done.length ? "No hay comentarios abiertos." : "Sin comentarios aún."}</p>`;
    if (done.length) {
      html += `<details class="comments-resolved"${resolvedOpen ? " open" : ""}><summary>Resueltos (${done.length})</summary>${done.map(commentHtml).join("")}</details>`;
    }
    commentsList.innerHTML = html;
    commentsCount.textContent = String(open.length);
    commentsCount.hidden = !open.length;
    const det = commentsList.querySelector(".comments-resolved");
    if (det) det.addEventListener("toggle", () => { resolvedOpen = det.open; });
    if (!scrollToEnd) {
      commentsList.scrollTop = prevScroll;
      return;
    }
    commentsList.scrollTop = commentsList.scrollHeight;
    // Con "Resueltos" abierto, el último comentario abierto queda sobre esa lista: traerlo a la vista.
    const lastOpen = [...commentsList.querySelectorAll(":scope > .comment")].pop();
    if (lastOpen && resolvedOpen) {
      commentsList.scrollTop += lastOpen.getBoundingClientRect().bottom - commentsList.getBoundingClientRect().bottom + 16;
    }
  } catch { /* noop */ }
}

// Resolver / reabrir / eliminar (delegación sobre la lista).
commentsList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-cact]");
  const cid = btn && btn.closest(".comment") && btn.closest(".comment").dataset.cid;
  if (!cid) return;
  const act = btn.dataset.cact;
  if (act === "delete" && !confirm("¿Eliminar este comentario? No se puede deshacer.")) return;
  btn.disabled = true;
  try {
    const res = act === "delete"
      ? await api(`/api/comments/${cid}`, { method: "DELETE" })
      : await api(`/api/comments/${cid}`, { method: "PATCH", body: { resolved: act === "resolve", by: (profile && profile.name) || null } });
    // Un 404 al eliminar significa que alguien más ya lo borró: el resultado es el mismo.
    if (!res.ok && !(act === "delete" && res.status === 404)) throw new Error(String(res.status));
    if (act === "delete") toast("Comentario eliminado");
  } catch {
    toast("No se pudo actualizar el comentario");
  }
  await loadComments();
});

commentsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const ta = document.getElementById("comment-body");
  const body = ta.value.trim();
  if (!body) return;
  const btn = commentsForm.querySelector("button");
  btn.disabled = true;
  try {
    const res = await api(`/api/documents/${id}/comments`, { method: "POST", body: { author: (profile && profile.name) || "Anónimo", body } });
    if (!res.ok) throw new Error();
    ta.value = "";
    await loadComments({ scrollToEnd: true });
  } catch {
    toast("No se pudo comentar");
  } finally {
    btn.disabled = false;
  }
});

// Toggle de la barra de comentarios (preferencia persistida)
const toggleCommentsBtn = document.getElementById("toggle-comments");
function applyCommentsState() {
  const open = localStorage.getItem("hv-comments") !== "closed";
  document.querySelector(".viewer-main").classList.toggle("comments-hidden", !open);
  toggleCommentsBtn.classList.toggle("active", open);
  toggleCommentsBtn.setAttribute("aria-pressed", String(open));
}
toggleCommentsBtn.addEventListener("click", () => {
  const open = localStorage.getItem("hv-comments") !== "closed";
  localStorage.setItem("hv-comments", open ? "closed" : "open");
  applyCommentsState();
});
applyCommentsState();

window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

async function load() {
  const res = await api(`/api/documents/${id}`);
  if (!res.ok) { document.body.innerHTML = "<p style='padding:2rem'>No se pudo cargar el documento.</p>"; return; }
  doc = await res.json();
  content = doc.content || "";
  titleEl.value = doc.title || "";
  document.title = (doc.title || "Documento") + " · Reuse";
  setTab("view");
  loadComments({ scrollToEnd: true });
}

load();
