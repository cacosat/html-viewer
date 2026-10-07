// Editor enriquecido del visor (modo "Editar"): designMode sobre el DOM real del documento.
// Toda la UI (barra de formato, contorno y mini-barra del bloque, barra de estado) vive en el
// padre, fuera del iframe; los únicos nodos que se inyectan en el documento llevan
// data-hv-editor y se quitan al serializar. El historial (deshacer/rehacer) es propio y
// basado en instantáneas, así cubre por igual texto, formato y operaciones de bloque.

import { icon } from "/icons.js";
import { toast, openPopover, openMenu, openModal, promptDialog, escapeHtml, isMac, kbd } from "/common.js";

// td/th quedan fuera a propósito: el cursor en una celda selecciona la FILA (tr).
const BLOCK_SEL = "p,h1,h2,h3,h4,h5,h6,ul,ol,li,table,tr,blockquote,pre,figure,figcaption,section,article,header,footer,aside,nav,main,div,form,fieldset,details,dl,hr";
const MEDIA_SEL = "img,canvas,svg,video,iframe,hr";
const NAMES = {
  p: "Párrafo", h1: "Título 1", h2: "Título 2", h3: "Título 3", h4: "Título 4", h5: "Título 5", h6: "Título 6",
  ul: "Lista", ol: "Lista numerada", li: "Ítem", table: "Tabla", tr: "Fila", blockquote: "Cita", pre: "Código",
  figure: "Figura", figcaption: "Pie de figura", section: "Sección", article: "Artículo", header: "Encabezado",
  footer: "Pie", aside: "Lateral", nav: "Navegación", main: "Principal", div: "Bloque", form: "Formulario",
  fieldset: "Grupo", details: "Desplegable", dl: "Definiciones", hr: "Separador", img: "Imagen",
  canvas: "Gráfico", svg: "Gráfico SVG", video: "Video", iframe: "Contenido incrustado",
};
const TEXT_COLORS = ["#111827", "#4b5563", "#9ca3af", "#dc2626", "#ea580c", "#d97706", "#16a34a", "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#e8490c"];
const SOFT_COLORS = ["#fef08a", "#fde68a", "#fed7aa", "#fecaca", "#fbcfe8", "#e9d5ff", "#c7d2fe", "#bfdbfe", "#99f6e4", "#bbf7d0", "#d9f99d", "#e5e7eb"];
const FONT_MIN = 8, FONT_MAX = 96, STEP = 1.15;
const HISTORY_MAX = 200, HISTORY_CHARS = 40e6;

// Sin scripts, <canvas> se dibuja como su contenido alternativo (0×0): aquí se le da una caja
// visible del tamaño declarado para que el gráfico tenga un lugar reconocible al editar.
const EDITOR_CSS = `
  ::selection { background: rgba(232, 73, 12, 0.28); }
  canvas { display: inline-block; vertical-align: top; box-sizing: border-box; width: 100%; max-width: 100%; height: 180px;
    outline: 1px dashed rgba(232, 73, 12, 0.6); outline-offset: -1px;
    background-image: repeating-linear-gradient(135deg, rgba(232, 73, 12, 0.08) 0 10px, transparent 10px 20px) !important; }
  @supports (width: attr(width px)) {
    canvas[width] { width: attr(width px); }
    canvas[height] { height: attr(height px); }
  }
  img, svg, video, iframe { cursor: pointer; }`;
const HIDDEN_CSS = `
  [style*="display: none"], [style*="display:none"] { display: revert !important; opacity: 0.5;
    outline: 1.5px dashed #e8490c !important; outline-offset: 2px; }`;

const sc = (...keys) => (isMac
  ? "⌘" + keys.map((k) => (k === "Shift" ? "⇧" : k)).join("")
  : "Ctrl+" + keys.join("+"));

export function createEditor({ frame, formatBar, overlays, blockBar, blockOutline, statusBar, onChange, onSave }) {
  let d = null, w = null;           // document / window del iframe en edición
  let editorStyle = null;
  let savedRange = null;            // última selección conocida (los controles del padre roban foco)
  let active = false;
  let trail = [], level = 0;        // ruta del bloque: [más profundo, …, más externo] y nivel activo
  let caretCell = null;             // celda del cursor (para operaciones de columna)
  let showHidden = false;
  let selectionLock = 0;            // tras restaurar el historial, el selectionchange tardío no pisa el bloque
  let lastText = "#e8490c", lastSoft = "#fef08a";
  const hist = { undo: [], redo: [], lastKind: "", lastTime: 0 };

  // ---------------- UI (se arma una vez) ----------------
  const tool = (act, ic, label, extra = "") =>
    `<button type="button" class="tool" data-ed="${act}" aria-label="${label}" title="${label}" ${extra}>${icon(ic)}</button>`;
  const sep = '<span class="fb-sep" aria-hidden="true"></span>';

  formatBar.innerHTML = `
    ${tool("undo", "undo", `Deshacer (${sc("Z")})`)}
    ${tool("redo", "redo", `Rehacer (${sc("Shift", "Z")})`)}
    ${sep}
    <div class="ui-select is-sm"><select id="ed-format" aria-label="Estilo de párrafo" title="Estilo de párrafo">
      <option value="p">Párrafo</option><option value="h1">Título 1</option><option value="h2">Título 2</option>
      <option value="h3">Título 3</option><option value="h4">Título 4</option><option value="blockquote">Cita</option>
      <option value="pre">Código</option><option value="" hidden>Estilo</option>
    </select></div>
    ${sep}
    ${tool("bold", "bold", `Negrita (${sc("B")})`, 'aria-pressed="false"')}
    ${tool("italic", "italic", `Cursiva (${sc("I")})`, 'aria-pressed="false"')}
    ${tool("underline", "underline", `Subrayado (${sc("U")})`, 'aria-pressed="false"')}
    ${tool("strikeThrough", "strikethrough", "Tachado", 'aria-pressed="false"')}
    ${sep}
    <button type="button" class="tool" data-ed="text-color" aria-label="Color del texto" title="Color del texto" aria-haspopup="dialog">${icon("baseline")}<span class="swatch-bar" style="--swatch:${lastText}"></span></button>
    <button type="button" class="tool" data-ed="highlight" aria-label="Resaltado" title="Resaltado" aria-haspopup="dialog">${icon("highlighter")}<span class="swatch-bar" style="--swatch:${lastSoft}"></span></button>
    ${sep}
    ${tool("insertUnorderedList", "list", "Lista con viñetas", 'aria-pressed="false"')}
    ${tool("insertOrderedList", "list-ordered", "Lista numerada", 'aria-pressed="false"')}
    ${tool("outdent", "outdent", "Reducir sangría")}
    ${tool("indent", "indent", "Aumentar sangría")}
    ${sep}
    <button type="button" class="tool" data-ed="align" aria-label="Alineación" title="Alineación" aria-haspopup="menu" aria-expanded="false">${icon("align-left")}</button>
    ${sep}
    ${tool("link", "link", `Insertar o editar enlace (${sc("K")})`)}
    ${tool("unlink", "unlink", "Quitar enlace")}
    ${tool("image", "image", "Insertar imagen")}
    ${sep}
    ${tool("removeFormat", "remove-formatting", "Quitar formato del texto")}
    <span class="spacer"></span>
    <button type="button" class="tool has-label" data-ed="show-hidden" aria-pressed="false" aria-label="Mostrar bloques ocultos" title="Mostrar los bloques ocultos para poder recuperarlos">${icon("eye")}<span class="cq-hide-md">Ocultos</span><span class="ui-badge ui-badge-count" data-hidden-count>0</span></button>
    ${tool("shortcuts", "keyboard", "Atajos de teclado", 'aria-haspopup="dialog"')}`;
  const formatSel = formatBar.querySelector("#ed-format");

  blockBar.innerHTML = `
    <span class="block-name" data-block-name></span>
    ${sep}
    ${tool("level-up", "corner-left-up", "Seleccionar contenedor (subir un nivel)")}
    ${tool("level-down", "corner-right-down", "Seleccionar interior (bajar un nivel)")}
    ${sep}
    ${tool("up", "arrow-up", `Mover arriba (${sc("Shift", "↑")})`)}
    ${tool("down", "arrow-down", `Mover abajo (${sc("Shift", "↓")})`)}
    ${sep}
    ${tool("dup", "copy-plus", "Duplicar")}
    ${tool("insert", "plus", "Insertar párrafo debajo")}
    ${sep}
    ${tool("smaller", "a-smaller", "Reducir texto")}
    ${tool("bigger", "a-bigger", "Agrandar texto")}
    ${tool("bg", "paint-bucket", "Color de fondo", 'aria-haspopup="dialog"')}
    ${tool("reset", "rotate-ccw", "Quitar tamaño, fondo y alineación aplicados")}
    <span class="fb-sep" data-col-part aria-hidden="true"></span>
    <button type="button" class="tool has-label" data-ed="column" data-col-part aria-haspopup="menu" title="Operaciones de la columna del cursor">${icon("columns-right")}<span>Columna</span>${icon("chevron-down", 12)}</button>
    ${sep}
    ${tool("hide", "eye-off", "Ocultar bloque")}
    ${tool("del", "trash", "Eliminar bloque", 'data-danger')}`;
  blockBar.querySelector('[data-ed="del"]').classList.add("is-danger");

  statusBar.innerHTML = `<div class="crumb-trail" data-trail aria-label="Ruta del bloque"></div><span class="edit-hint" data-hint></span>`;
  const trailEl = statusBar.querySelector("[data-trail]");
  const hintEl = statusBar.querySelector("[data-hint]");

  // Los botones no roban el foco del iframe (así se conserva la selección).
  for (const bar of [formatBar, blockBar, statusBar]) {
    bar.addEventListener("mousedown", (e) => { if (!e.target.closest("select, input")) e.preventDefault(); });
  }
  formatBar.addEventListener("click", (e) => { const b = e.target.closest("[data-ed]"); if (b && !b.disabled) formatAction(b.dataset.ed, b); });
  blockBar.addEventListener("click", (e) => { const b = e.target.closest("[data-ed]"); if (b && !b.disabled) blockAction(b.dataset.ed, b); });
  trailEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]");
    if (b) { level = Number(b.dataset.level); refreshUI(); }
  });
  formatSel.addEventListener("change", () => {
    if (formatSel.value) exec("formatBlock", "<" + formatSel.value + ">");
  });

  // ---------------- Carga / serialización ----------------
  function load(html) {
    return new Promise((resolve) => {
      frame.onload = () => {
        try {
          d = frame.contentDocument;
          w = frame.contentWindow;
          d.designMode = "on";
          try { d.execCommand("styleWithCSS", false, true); d.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* noop */ }
          editorStyle = d.createElement("style");
          editorStyle.setAttribute("data-hv-editor", "");
          (d.head || d.documentElement).appendChild(editorStyle);
          bindDocument();
        } catch { d = null; w = null; }
        trail = []; level = 0; caretCell = null; savedRange = null; showHidden = false;
        hist.undo = []; hist.redo = []; hist.lastKind = ""; hist.lastTime = 0;
        applyEditorStyle();
        refreshUI();
        resolve();
      };
      frame.srcdoc = html;
    });
  }

  function serialize() {
    if (!d || !d.documentElement) return null;
    const injected = [...d.querySelectorAll("[data-hv-editor]")].map((n) => [n, n.parentNode, n.nextSibling]);
    for (const [n] of injected) n.remove();
    const html = (d.doctype ? `<!DOCTYPE ${d.doctype.name}>\n` : "") + d.documentElement.outerHTML;
    for (const [n, p, next] of injected) p.insertBefore(n, next);
    return html;
  }

  function applyEditorStyle() { if (editorStyle) editorStyle.textContent = EDITOR_CSS + (showHidden ? HIDDEN_CSS : ""); }

  function bindDocument() {
    d.addEventListener("selectionchange", onSelection);
    d.addEventListener("mouseup", onPointerUp);
    d.addEventListener("keydown", onKeyDown);
    d.addEventListener("beforeinput", onBeforeInput);
    d.addEventListener("input", onInput);
    w.addEventListener("scroll", position, true);
    try { new w.ResizeObserver(() => position()).observe(d.documentElement); } catch { /* noop */ }
  }

  // ---------------- Historial (instantáneas del body) ----------------
  function pathOf(node) {
    const path = [];
    let n = node;
    while (n && n !== d.body) {
      const p = n.parentNode;
      if (!p) return null;
      path.unshift(Array.prototype.indexOf.call(p.childNodes, n));
      n = p;
    }
    return n === d.body ? path : null;
  }
  function nodeAt(path) {
    let n = d.body;
    for (const i of path || []) { if (!n || !n.childNodes[i]) return null; n = n.childNodes[i]; }
    return n;
  }
  const maxOffset = (n) => (n.nodeType === 3 ? n.length : n.childNodes.length);
  function snapshot() {
    let sel = null;
    try {
      const s = w.getSelection();
      if (s && s.rangeCount) {
        const r = s.getRangeAt(0);
        sel = { sp: pathOf(r.startContainer), so: r.startOffset, ep: pathOf(r.endContainer), eo: r.endOffset };
      }
    } catch { /* noop */ }
    const el = activeEl();
    return { html: d.body.innerHTML, sel, block: el ? pathOf(el) : null, deep: trail[0] ? pathOf(trail[0]) : null, level };
  }
  function pushUndo(s) {
    hist.undo.push(s);
    hist.redo.length = 0;
    let chars = hist.undo.reduce((a, x) => a + x.html.length, 0);
    while (hist.undo.length > HISTORY_MAX || (chars > HISTORY_CHARS && hist.undo.length > 1)) chars -= hist.undo.shift().html.length;
  }
  function restore(s) {
    d.body.innerHTML = s.html;
    if (s.sel && s.sel.sp && s.sel.ep) {
      const sn = nodeAt(s.sel.sp), en = nodeAt(s.sel.ep);
      if (sn && en) {
        try {
          const r = d.createRange();
          r.setStart(sn, Math.min(s.sel.so, maxOffset(sn)));
          r.setEnd(en, Math.min(s.sel.eo, maxOffset(en)));
          const sel = w.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          savedRange = r.cloneRange();
        } catch { /* noop */ }
      }
    }
    const deep = s.deep && nodeAt(s.deep);
    if (deep && deep.nodeType === 1) { trail = ancestorsOf(deep); level = Math.min(s.level || 0, trail.length - 1); }
    else { trail = []; level = 0; }
    caretCell = null;
    hist.lastKind = "";
    selectionLock = performance.now() + 150;
    changed();
  }
  function undo() {
    if (!d || !hist.undo.length) return;
    const cur = snapshot();
    const prev = hist.undo.pop();
    hist.redo.push(cur);
    restore(prev);
  }
  function redo() {
    if (!d || !hist.redo.length) return;
    const cur = snapshot();
    const next = hist.redo.pop();
    hist.undo.push(cur);
    restore(next);
  }
  // Ejecuta una mutación y la registra en el historial solo si cambió algo.
  function mutate(fn) {
    if (!d) return false;
    const before = snapshot();
    fn();
    if (d.body.innerHTML === before.html) return false;
    pushUndo(before);
    hist.lastKind = "";
    changed();
    return true;
  }

  // ---------------- Selección y bloque activo ----------------
  function deepestBlock(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el || !d.body.contains(el) || el === d.body) return null;
    const b = el.closest(BLOCK_SEL);
    return b && b !== d.body && d.body.contains(b) ? b : null;
  }
  function ancestorsOf(el) {
    const out = [];
    for (let e = el; e && e !== d.body && e !== d.documentElement; e = e.parentElement) {
      if (e === el || e.matches(BLOCK_SEL)) out.push(e);
    }
    return out;
  }
  function activeEl() {
    const el = trail[level];
    return el && el.isConnected && d && d.body.contains(el) ? el : null;
  }
  function setTrail(el) { trail = el ? ancestorsOf(el) : []; level = 0; }
  function firstChildBlock(el) {
    const queue = [...el.children];
    while (queue.length) {
      const c = queue.shift();
      if (c.matches(BLOCK_SEL) || c.matches(MEDIA_SEL)) return c;
      queue.push(...c.children);
    }
    return null;
  }
  function rememberRange() {
    try {
      const sel = w.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        savedRange = r.cloneRange();
        const n = r.startContainer;
        const el = n.nodeType === 1 ? n : n.parentElement;
        caretCell = el && el.closest ? el.closest("td,th") : null;
        return r;
      }
    } catch { /* noop */ }
    return null;
  }
  function onSelection() {
    if (!d) return;
    const r = rememberRange();
    if (r && performance.now() > selectionLock) {
      const deep = deepestBlock(r.startContainer);
      if (!deep) { trail = []; level = 0; }
      else if (deep !== trail[0] && !(trail[0] && trail[0].matches(MEDIA_SEL) && trail[0].parentElement && trail[0].parentElement.contains(r.startContainer))) setTrail(deep);
    }
    refreshUI();
  }
  // Un clic define el bloque activo (y las imágenes/gráficos se seleccionan como bloque).
  function onPointerUp(e) {
    const media = e.target && e.target.closest ? e.target.closest(MEDIA_SEL) : null;
    if (media && d.body.contains(media)) setTrail(media);
    else {
      const r = rememberRange();
      setTrail(r ? deepestBlock(r.startContainer) : null);
    }
    refreshUI();
  }
  function restoreRange() {
    if (!savedRange) return;
    try {
      const sel = w.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    } catch { /* noop */ }
  }
  function placeCaret(node) {
    try {
      const r = d.createRange();
      r.selectNodeContents(node);
      r.collapse(true);
      const sel = w.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      savedRange = r.cloneRange();
      w.focus();
    } catch { /* noop */ }
  }
  function deselect() { trail = []; level = 0; refreshUI(); }

  // ---------------- Teclado y entrada ----------------
  function onKeyDown(e) {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && !e.altKey && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && !e.altKey && k === "y") { e.preventDefault(); redo(); }
    else if (mod && k === "s") { e.preventDefault(); onSave && onSave(); }
    else if (mod && k === "k") { e.preventDefault(); linkAction(); }
    else if (mod && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); blockAction(e.key === "ArrowUp" ? "up" : "down"); }
    else if (e.key === "Escape") { if (activeEl()) { e.preventDefault(); deselect(); } }
    else if ((e.key === "Backspace" || e.key === "Delete") && activeEl() && activeEl().matches(MEDIA_SEL)) { e.preventDefault(); blockAction("del"); }
  }
  // Agrupa la escritura en ráfagas: un paso de deshacer por ráfaga (pausa > 1 s o cambio de tipo).
  function onBeforeInput(e) {
    if (e.inputType === "historyUndo") { e.preventDefault(); undo(); return; }
    if (e.inputType === "historyRedo") { e.preventDefault(); redo(); return; }
    const kind = e.inputType.startsWith("delete") ? "delete"
      : (e.inputType === "insertText" || e.inputType === "insertCompositionText") ? "type" : e.inputType;
    const now = Date.now();
    if (kind !== hist.lastKind || now - hist.lastTime > 1000 || (kind !== "type" && kind !== "delete")) pushUndo(snapshot());
    hist.lastKind = kind;
    hist.lastTime = now;
  }
  function onInput() {
    if (activeEl() === null && trail.length) trail = [];
    changed();
  }
  function changed() {
    refreshUI();
    if (onChange) onChange();
  }

  // ---------------- Barra de formato ----------------
  function exec(cmd, val = null) {
    if (!d) return;
    w.focus();
    restoreRange();
    mutate(() => { try { d.execCommand(cmd, false, val); } catch { /* noop */ } });
    rememberRange();
    refreshUI();
  }
  function currentAnchor() {
    const n = savedRange && savedRange.startContainer;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    const a = el && el.closest ? el.closest("a[href]") : null;
    return a && d.body.contains(a) ? a : null;
  }
  function inListItem() {
    const n = savedRange && savedRange.startContainer;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(el && el.closest && el.closest("li"));
  }
  function formatAction(act, btn) {
    if (!d) return;
    switch (act) {
      case "undo": return undo();
      case "redo": return redo();
      case "text-color": return colorPicker(btn, "text");
      case "highlight": return colorPicker(btn, "soft");
      case "link": return linkAction();
      case "unlink": return unlinkAction();
      case "image": return imageAction();
      case "show-hidden": showHidden = !showHidden; applyEditorStyle(); refreshUI(); return;
      case "shortcuts": return shortcutsPopover(btn);
      case "align": return alignMenu(btn);
      default: return exec(act);
    }
  }
  async function linkAction() {
    if (!d) return;
    rememberRange();
    const a = currentAnchor();
    const url = await promptDialog({
      title: a ? "Editar enlace" : "Insertar enlace",
      label: "Dirección (URL)",
      value: a ? a.getAttribute("href") : "https://",
      placeholder: "https://ejemplo.com",
      help: savedRange && savedRange.collapsed && !a ? "No hay texto seleccionado: se insertará la dirección como texto del enlace." : "",
      confirm: a ? "Guardar enlace" : "Insertar enlace",
      validate: (v) => (v && v !== "https://" ? "" : "Escribe una dirección, por ejemplo https://ejemplo.com."),
    });
    w.focus();
    restoreRange();
    if (url == null) return;
    mutate(() => {
      if (a) a.setAttribute("href", url);
      else if (savedRange && !savedRange.collapsed) d.execCommand("createLink", false, url);
      else d.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    });
    rememberRange();
  }
  function unlinkAction() {
    const a = currentAnchor();
    if (!a) return;
    mutate(() => a.replaceWith(...a.childNodes));
  }

  function colorPicker(anchor, kind, target = null) {
    rememberRange();
    const colors = kind === "text" ? TEXT_COLORS : SOFT_COLORS;
    const title = target ? "Fondo del bloque" : kind === "text" ? "Color del texto" : "Resaltado";
    const clearLabel = target ? "Sin fondo" : kind === "text" ? "Color automático" : "Sin resaltado";
    const apply = (c) => {
      if (target) {
        mutate(() => {
          if (c) target.style.backgroundColor = c;
          else if (target.style.backgroundColor) target.style.removeProperty("background-color");
          else target.style.backgroundColor = "transparent";
          if (!target.getAttribute("style")) target.removeAttribute("style");
        });
      } else if (kind === "text") {
        if (c) { lastText = c; anchor.querySelector(".swatch-bar").style.setProperty("--swatch", c); }
        exec("foreColor", c || "inherit");
      } else {
        if (c) { lastSoft = c; anchor.querySelector(".swatch-bar").style.setProperty("--swatch", c); }
        exec("hiliteColor", c || "transparent");
      }
    };
    openPopover(anchor, (pop, close) => {
      pop.innerHTML = `
        <div class="color-pop">
          <span class="overline">${title}</span>
          <div class="swatches">${colors.map((c) => `<button type="button" class="swatch-btn" style="--sw:${c}" data-c="${c}" aria-label="Color ${c}" title="${c}"></button>`).join("")}</div>
          <label class="color-pop-row"><input type="color" value="${kind === "text" ? lastText : lastSoft}" aria-label="Color personalizado"><span class="small muted">Personalizado</span></label>
          <button type="button" class="ui-btn ui-btn-sm" data-c="">${clearLabel}</button>
        </div>`;
      pop.addEventListener("mousedown", (e) => { if (!e.target.closest("input")) e.preventDefault(); });
      pop.addEventListener("click", (e) => {
        const b = e.target.closest("[data-c]");
        if (!b) return;
        apply(b.dataset.c);
        close();
      });
      pop.querySelector('input[type="color"]').addEventListener("change", (e) => { apply(e.target.value); close(); });
    }, { side: "bottom", align: "start" });
  }

  const ALIGNS = [
    ["justifyLeft", "align-left", "Alinear a la izquierda"], ["justifyCenter", "align-center", "Centrar"],
    ["justifyRight", "align-right", "Alinear a la derecha"], ["justifyFull", "align-justify", "Justificar"],
  ];
  function currentAlign() {
    for (const [cmd] of ALIGNS) { try { if (d.queryCommandState(cmd)) return cmd; } catch { /* noop */ } }
    return "justifyLeft";
  }
  function alignMenu(anchor) {
    rememberRange();
    const cur = currentAlign();
    openMenu(anchor, ALIGNS.map(([cmd, ic, label]) => ({ label, icon: ic, checked: cmd === cur, onSelect: () => exec(cmd) })),
      { side: "bottom", align: "start", label: "Alineación" });
  }

  function shortcutsPopover(anchor) {
    const rows = [
      ["Guardar", [sc("S")]], ["Deshacer", [sc("Z")]], ["Rehacer", [sc("Shift", "Z")]],
      ["Negrita · cursiva · subrayado", [sc("B"), sc("I"), sc("U")]], ["Enlace", [sc("K")]],
      ["Mover bloque", [sc("Shift", "↑"), sc("Shift", "↓")]], ["Eliminar imagen seleccionada", ["⌫"]],
      ["Deseleccionar bloque", ["Esc"]],
    ];
    openPopover(anchor, (pop) => {
      pop.innerHTML = `<div class="shortcuts"><span class="overline">Atajos de teclado</span>${rows.map(([label, keys]) =>
        `<div class="shortcut-row"><span>${label}</span><span>${keys.map((k) => kbd(k)).join(" ")}</span></div>`).join("")}</div>`;
    }, { side: "bottom", align: "end" });
  }

  // ---------------- Imagen ----------------
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  async function shrinkImage(file) {
    const raw = await fileToDataUrl(file);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return raw; // SVG/GIF tal cual
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = raw; });
    const MAX = 1600;
    if (img.naturalWidth <= MAX && raw.length < 1.5e6) return raw;
    const scale = Math.min(1, MAX / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return file.type === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.85);
  }
  function imageAction() {
    rememberRange();
    const range = savedRange && savedRange.cloneRange();
    openModal((modal, close) => {
      modal.innerHTML = `
        <form class="ui-modal-body" novalidate>
          <div class="ui-modal-head">
            <h2 class="ui-modal-title">Insertar imagen</h2>
            <p class="ui-modal-sub">Se inserta donde está el cursor y queda guardada dentro del HTML.</p>
          </div>
          <label class="dropzone" data-drop>
            ${icon("image", 20)}
            <span class="small"><strong class="strong">Arrastra una imagen</strong> o elígela desde tu equipo</span>
            <span class="ui-btn ui-btn-sm">Elegir imagen</span>
            <input type="file" accept="image/*" class="visually-hidden" data-file>
            <span class="dropzone-file" data-name hidden></span>
          </label>
          <div class="ui-field">
            <label class="ui-label" for="img-url">O pega la dirección de una imagen</label>
            <input class="ui-input" id="img-url" placeholder="https://…/imagen.png" autocomplete="off">
          </div>
          <div class="ui-field">
            <label class="ui-label" for="img-alt">Texto alternativo</label>
            <input class="ui-input" id="img-alt" placeholder="Describe la imagen en pocas palabras" autocomplete="off">
            <p class="ui-help">Lo leen los lectores de pantalla y aparece si la imagen no carga.</p>
          </div>
          <div class="callout is-danger" data-err hidden>${icon("circle-alert")}<span></span></div>
          <button type="submit" hidden></button>
        </form>
        <div class="ui-modal-footer">
          <button type="button" class="ui-btn ui-btn-ghost" data-r="0">Cancelar</button>
          <button type="button" class="ui-btn ui-btn-primary" data-r="1" disabled>Insertar imagen</button>
        </div>`;
      const fileIn = modal.querySelector("[data-file]");
      const nameEl = modal.querySelector("[data-name]");
      const urlIn = modal.querySelector("#img-url");
      const altIn = modal.querySelector("#img-alt");
      const err = modal.querySelector("[data-err]");
      const ok = modal.querySelector('[data-r="1"]');
      const drop = modal.querySelector("[data-drop]");
      let file = null;
      const showErr = (m) => { err.querySelector("span").textContent = m; err.hidden = !m; };
      const sync = () => { ok.disabled = !(file || urlIn.value.trim()); };
      const setFile = (f) => {
        if (!f) return;
        if (!/^image\//.test(f.type)) { showErr("Elige un archivo de imagen (PNG, JPG, GIF, WebP o SVG)."); return; }
        file = f; showErr("");
        nameEl.textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`;
        nameEl.hidden = false;
        if (!altIn.value) altIn.value = f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
        sync();
      };
      fileIn.addEventListener("change", () => setFile(fileIn.files[0]));
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); setFile(e.dataTransfer.files[0]); });
      urlIn.addEventListener("input", sync);
      modal.querySelector('[data-r="0"]').addEventListener("click", () => close());
      async function insert() {
        let src = urlIn.value.trim();
        if (file) {
          ok.disabled = true;
          ok.textContent = "Procesando…";
          try { src = await shrinkImage(file); } catch { src = ""; }
          ok.textContent = "Insertar imagen";
          if (!src) { showErr("No se pudo leer la imagen. Prueba con otro archivo."); sync(); return; }
          if (src.length > 3.5e6) { showErr("La imagen pesa más de 2,5 MB incluso reducida. Usa una más liviana o pega una dirección."); sync(); return; }
        } else if (!/^(https?:|data:image\/)/i.test(src)) {
          showErr("La dirección debe empezar con https:// (o http://)."); return;
        }
        close();
        w.focus();
        if (range) { savedRange = range; restoreRange(); }
        mutate(() => {
          d.execCommand("insertHTML", false, `<img src="${escapeHtml(src)}" alt="${escapeHtml(altIn.value.trim())}" style="max-width: 100%; height: auto;" data-hv-new="1">`);
          const img = d.querySelector("img[data-hv-new]");
          if (img) { img.removeAttribute("data-hv-new"); setTrail(img); }
        });
      }
      modal.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); if (!ok.disabled) insert(); });
      ok.addEventListener("click", insert);
    });
  }

  // ---------------- Editor de bloques ----------------
  function insertBelow(el) {
    const tag = el.tagName.toLowerCase();
    let target = el, n;
    if (el.matches(MEDIA_SEL) && el.parentElement && el.parentElement !== d.body) {
      target = el.closest("p,h1,h2,h3,h4,h5,h6,li,figure,blockquote") || el;
    }
    const ttag = target.tagName.toLowerCase();
    if (ttag === "li") { n = d.createElement("li"); n.innerHTML = "<br>"; }
    else if (ttag === "tr") {
      n = target.cloneNode(true);
      for (const c of n.cells) c.innerHTML = "<br>";
    } else { n = d.createElement("p"); n.innerHTML = "<br>"; }
    target.after(n);
    placeCaret(n.cells && n.cells.length ? n.cells[0] : n);
    setTrail(n);
    return tag;
  }
  function resize(el, bigger) {
    if (el.matches(MEDIA_SEL) && el.tagName !== "HR") {
      const cur = el.getBoundingClientRect().width || 100;
      el.style.width = Math.round(Math.min(4000, Math.max(24, bigger ? cur * STEP : cur / STEP))) + "px";
      if (el.tagName === "IMG" || el.tagName === "VIDEO") el.style.height = "auto";
    } else {
      const cur = parseFloat(w.getComputedStyle(el).fontSize) || 16;
      el.style.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(bigger ? cur * STEP : cur / STEP))) + "px";
    }
  }
  const RESET_PROPS = ["font-size", "background-color", "text-align", "width", "height"];
  const hasResettable = (el) => RESET_PROPS.some((p) => el.style.getPropertyValue(p));

  function blockAction(act, btn) {
    if (!d) return;
    const el = activeEl();
    if (!el) return;
    const parent = el.parentElement;
    switch (act) {
      case "level-up":
        if (level < trail.length - 1) { level++; refreshUI(); }
        return;
      case "level-down": {
        if (level > 0) { level--; refreshUI(); return; }
        const child = firstChildBlock(el);
        if (child) { setTrail(child); refreshUI(); }
        return;
      }
      case "up": {
        const prev = el.previousElementSibling;
        if (prev) mutate(() => parent.insertBefore(el, prev));
        break;
      }
      case "down": {
        const next = el.nextElementSibling;
        if (next) mutate(() => parent.insertBefore(next, el));
        break;
      }
      case "dup":
        mutate(() => { const c = el.cloneNode(true); el.after(c); setTrail(c); });
        toast("Bloque duplicado: la copia queda seleccionada");
        break;
      case "insert": mutate(() => insertBelow(el)); break;
      case "smaller": case "bigger": mutate(() => resize(el, act === "bigger")); break;
      case "bg": colorPicker(btn, "soft", el); return;
      case "reset":
        mutate(() => {
          for (const p of RESET_PROPS) el.style.removeProperty(p);
          if (!el.getAttribute("style")) el.removeAttribute("style");
        });
        break;
      case "column": return columnMenu(btn);
      case "hide": {
        const hidden = el.style.display === "none";
        mutate(() => {
          if (hidden) el.style.removeProperty("display"); else el.style.display = "none";
          if (!el.getAttribute("style")) el.removeAttribute("style");
        });
        if (hidden) toast("Bloque visible otra vez");
        else if (!showHidden) {
          deselect();
          toast("Bloque oculto. Lo recuperas con «Ocultos» en la barra.", { action: { label: "Deshacer", onClick: undo } });
        }
        break;
      }
      case "del":
        mutate(() => { el.remove(); trail = []; level = 0; });
        toast("Bloque eliminado", { action: { label: "Deshacer", onClick: undo } });
        return;
    }
    const cur = activeEl();
    if (cur) cur.scrollIntoView({ block: "nearest" });
    refreshUI();
  }

  function columnMenu(anchor) {
    const row = activeEl();
    if (!caretCell || !row || caretCell.parentElement !== row) return;
    const idx = caretCell.cellIndex;
    const last = row.cells.length - 1;
    openMenu(anchor, [
      { type: "label", label: `Columna ${idx + 1}` },
      { label: "Insertar columna a la izquierda", icon: "columns-left", onSelect: () => columnAction("left") },
      { label: "Insertar columna a la derecha", icon: "columns-right", onSelect: () => columnAction("right") },
      { type: "sep" },
      { label: "Mover columna a la izquierda", icon: "arrow-left", disabled: idx === 0, onSelect: () => columnAction("move-left") },
      { label: "Mover columna a la derecha", icon: "arrow-right", disabled: idx === last, onSelect: () => columnAction("move-right") },
      { type: "sep" },
      { label: "Eliminar columna", icon: "column-remove", danger: true, disabled: last === 0, onSelect: () => columnAction("delete") },
    ], { side: "bottom", align: "start", label: "Columna" });
  }
  function columnAction(kind) {
    const table = caretCell && caretCell.closest("table");
    if (!table) return;
    const idx = caretCell.cellIndex;
    const row = caretCell.parentElement;
    mutate(() => {
      for (const r of [...table.rows]) {
        const cell = r.cells[idx];
        if (!cell) continue;
        if (kind === "left" || kind === "right") {
          const n = cell.cloneNode(false);
          n.removeAttribute("colspan");
          n.innerHTML = "<br>";
          if (kind === "left") cell.before(n); else cell.after(n);
        } else if (kind === "move-left" && r.cells[idx - 1]) r.insertBefore(cell, r.cells[idx - 1]);
        else if (kind === "move-right" && r.cells[idx + 1]) r.insertBefore(r.cells[idx + 1], cell);
        else if (kind === "delete") cell.remove();
      }
      if (kind === "delete") {
        caretCell = row.cells[Math.min(idx, row.cells.length - 1)] || null;
        if (caretCell) placeCaret(caretCell);
      }
    });
    if (kind === "delete") toast("Columna eliminada", { action: { label: "Deshacer", onClick: undo } });
  }

  // ---------------- Render de estado ----------------
  const friendly = (el) => {
    const t = el.tagName.toLowerCase();
    const base = NAMES[t] || `<${t}>`;
    const cls = el.classList && el.classList[0];
    return (t === "div" || t === "section" || t === "article") && cls ? `${base} .${cls.slice(0, 18)}` : base;
  };
  function hiddenCount() {
    let n = 0;
    for (const el of d.body.querySelectorAll("[style]")) if (el.style.display === "none") n++;
    return n;
  }
  function label(btn, text) { btn.title = text; btn.setAttribute("aria-label", text); }
  function setPressed(act, on) {
    const b = formatBar.querySelector(`[data-ed="${act}"]`);
    if (b) b.setAttribute("aria-pressed", String(!!on));
  }
  function setDisabled(bar, act, off) {
    const b = bar.querySelector(`[data-ed="${act}"]`);
    if (b) b.disabled = !!off;
  }

  function refreshUI() {
    if (!active || !d) { blockBar.hidden = true; blockOutline.hidden = true; return; }
    // Barra de formato
    setDisabled(formatBar, "undo", !hist.undo.length);
    setDisabled(formatBar, "redo", !hist.redo.length);
    const alignBtn = formatBar.querySelector('[data-ed="align"]');
    const al = ALIGNS.find(([cmd]) => cmd === currentAlign());
    if (alignBtn.dataset.cur !== al[0]) { alignBtn.dataset.cur = al[0]; alignBtn.innerHTML = icon(al[1]); label(alignBtn, `Alineación: ${al[2].toLowerCase()}`); }
    for (const c of ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"]) {
      let on = false;
      try { on = d.queryCommandState(c); } catch { /* noop */ }
      setPressed(c, on);
    }
    let fmt = "";
    try { fmt = String(d.queryCommandValue("formatBlock") || "").toLowerCase(); } catch { /* noop */ }
    formatSel.value = [...formatSel.options].some((o) => o.value === fmt && o.value) ? fmt : "";
    setDisabled(formatBar, "unlink", !currentAnchor());
    const inLi = inListItem();
    setDisabled(formatBar, "indent", !inLi);
    setDisabled(formatBar, "outdent", !inLi);
    const hc = hiddenCount();
    const hb = formatBar.querySelector('[data-ed="show-hidden"]');
    hb.querySelector("[data-hidden-count]").textContent = String(hc);
    hb.setAttribute("aria-pressed", String(showHidden));
    hb.disabled = !hc && !showHidden;

    // Bloque activo
    const el = activeEl();
    if (el) {
      const isMedia = el.matches(MEDIA_SEL) && el.tagName !== "HR";
      const fs = parseFloat(w.getComputedStyle(el).fontSize) || 16;
      blockBar.querySelector("[data-block-name]").textContent = friendly(el);
      setDisabled(blockBar, "level-up", level >= trail.length - 1);
      setDisabled(blockBar, "level-down", level === 0 && !firstChildBlock(el));
      setDisabled(blockBar, "up", !el.previousElementSibling);
      setDisabled(blockBar, "down", !el.nextElementSibling);
      setDisabled(blockBar, "smaller", !isMedia && fs <= FONT_MIN);
      setDisabled(blockBar, "bigger", !isMedia && fs >= FONT_MAX);
      setDisabled(blockBar, "reset", !hasResettable(el));
      const smaller = blockBar.querySelector('[data-ed="smaller"]');
      const bigger = blockBar.querySelector('[data-ed="bigger"]');
      label(smaller, isMedia ? "Reducir tamaño" : "Reducir texto");
      label(bigger, isMedia ? "Agrandar tamaño" : "Agrandar texto");
      const t = el.tagName.toLowerCase();
      const ins = blockBar.querySelector('[data-ed="insert"]');
      label(ins, t === "li" ? "Insertar ítem debajo" : t === "tr" ? "Insertar fila debajo" : "Insertar párrafo debajo");
      const isHidden = el.style.display === "none";
      const hide = blockBar.querySelector('[data-ed="hide"]');
      hide.innerHTML = icon(isHidden ? "eye" : "eye-off");
      label(hide, isHidden ? "Mostrar bloque" : "Ocultar bloque");
      const showCols = t === "tr" && caretCell && caretCell.parentElement === el;
      for (const p of blockBar.querySelectorAll("[data-col-part]")) p.hidden = !showCols;
    }
    renderStatus(el);
    position();
  }

  function renderStatus(el) {
    if (!el) {
      trailEl.innerHTML = `<span>Ningún bloque seleccionado</span>`;
    } else {
      const outerFirst = [...trail].reverse();
      trailEl.innerHTML = outerFirst.map((b, i) => {
        const idx = trail.length - 1 - i;
        return `${i ? icon("chevron-right", 12) : ""}<button type="button" class="crumb-btn" data-level="${idx}" aria-current="${idx === level}" title="&lt;${b.tagName.toLowerCase()}&gt;">${escapeHtml(friendly(b))}</button>`;
      }).join("");
      trailEl.scrollLeft = trailEl.scrollWidth;
    }
    const charts = d.querySelectorAll("canvas").length;
    hintEl.innerHTML = el
      ? `${kbd("Esc")} deselecciona · ${kbd(sc("Shift", "↑"))} ${kbd(sc("Shift", "↓"))} mueven el bloque`
      : charts
        ? `Las zonas rayadas son ${charts === 1 ? "un gráfico que se dibuja" : `${charts} gráficos que se dibujan`} con scripts: se ven en Vista`
        : "Haz clic en el documento para editar o seleccionar un bloque";
  }

  function position() {
    const el = activeEl();
    if (!active || !d || !el) { blockOutline.hidden = true; blockBar.hidden = true; return; }
    let r;
    try { r = el.getBoundingClientRect(); } catch { r = null; }
    if (!r || (!r.width && !r.height)) { blockOutline.hidden = true; blockBar.hidden = true; return; }
    const fr = frame.getBoundingClientRect();
    const wr = overlays.getBoundingClientRect();
    const ox = fr.left - wr.left + frame.clientLeft;
    const oy = fr.top - wr.top + frame.clientTop;
    const vw = frame.clientWidth, vh = frame.clientHeight;
    const top = Math.max(r.top, 0), left = Math.max(r.left, 0);
    const bottom = Math.min(r.bottom, vh), right = Math.min(r.right, vw);
    if (bottom <= 0 || top >= vh || right <= 0 || left >= vw) { blockOutline.hidden = true; blockBar.hidden = true; return; }
    Object.assign(blockOutline.style, { top: oy + top + "px", left: ox + left + "px", width: right - left + "px", height: bottom - top + "px" });
    blockOutline.hidden = false;
    blockBar.hidden = false;
    const bw = blockBar.offsetWidth, bh = blockBar.offsetHeight;
    // Preferencia: arriba del bloque; si no cabe, debajo; si tampoco, dentro del borde superior.
    let by = oy + top - bh - 6;
    if (by < oy + 4) by = bottom + bh + 10 <= vh ? oy + bottom + 6 : oy + top + 6;
    by = Math.min(Math.max(by, oy + 4), oy + vh - bh - 4);
    let bx = ox + left;
    bx = Math.min(Math.max(bx, ox + 4), Math.max(ox + 4, ox + vw - bw - 4));
    blockBar.style.top = by + "px";
    blockBar.style.left = bx + "px";
  }

  new ResizeObserver(() => position()).observe(frame);
  window.addEventListener("resize", position);

  // Atajos cuando el foco quedó en el padre (p. ej. tras usar un control de la barra).
  document.addEventListener("keydown", (e) => {
    if (!active || !d) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.querySelector(".ui-modal")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (e.key === "Escape" && activeEl()) deselect();
  });

  return {
    load,
    serialize,
    undo,
    redo,
    get ready() { return !!d; },
    setActive(on) {
      active = on;
      formatBar.hidden = !on;
      overlays.hidden = !on;
      statusBar.hidden = !on;
      refreshUI();
    },
    focus() { if (w) w.focus(); },
  };
}
