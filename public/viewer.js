import { api, toast, shareModal } from "/common.js";

const id = location.pathname.split("/").filter(Boolean).pop();
const viewStage = document.getElementById("viewStage");
const editStage = document.getElementById("editStage");
const codePane = document.getElementById("codePane");
const editHint = document.getElementById("editHint");
const viewFrame = document.getElementById("viewFrame");
const editFrame = document.getElementById("editFrame");
const codeEl = document.getElementById("code");
const titleEl = document.getElementById("title");
const saveBtn = document.getElementById("save");
const tabButtons = [...document.querySelectorAll(".tabs button")];

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
  editHint.hidden = tab !== "text";

  if (tab === "view") {
    viewFrame.srcdoc = content;
  } else if (tab === "text") {
    editFrame.onload = () => {
      try {
        const d = editFrame.contentDocument;
        d.designMode = "on";
        d.addEventListener("input", () => { content = readEditFrame(); markDirty(); });
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

window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

async function load() {
  const res = await api(`/api/documents/${id}`);
  if (!res.ok) { document.body.innerHTML = "<p style='padding:2rem'>No se pudo cargar el documento.</p>"; return; }
  doc = await res.json();
  content = doc.content || "";
  titleEl.value = doc.title || "";
  document.title = (doc.title || "Documento") + " · Reuse";
  setTab("view");
}

load();
