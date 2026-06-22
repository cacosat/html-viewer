import { api, toast } from "/common.js";

const id = location.pathname.split("/").filter(Boolean).pop();
const viewFrame = document.getElementById("viewFrame");
const editFrame = document.getElementById("editFrame");
const codeEl = document.getElementById("code");
const titleEl = document.getElementById("title");
const saveBtn = document.getElementById("save");
const tabButtons = [...document.querySelectorAll(".tabs button")];

let doc = null;
let content = ""; // fuente de verdad del HTML, siempre al día
let dirty = false;

function markDirty() {
  dirty = true;
  saveBtn.disabled = false;
}

// Serializa el HTML editado desde el iframe de texto. Los <script> quedaron
// inertes (sin allow-scripts) pero presentes en el DOM, así que se preservan.
function readEditFrame() {
  const d = editFrame.contentDocument;
  if (!d || !d.documentElement) return content;
  const doctype = d.doctype ? `<!DOCTYPE ${d.doctype.name}>\n` : "";
  return doctype + d.documentElement.outerHTML;
}

// La superficie visible es la fuente de verdad: evita depender de estado que
// se pueda desincronizar de lo que el usuario realmente ve.
function visibleSurface() {
  if (!codeEl.hidden) return "code";
  if (!editFrame.hidden) return "text";
  return "view";
}

function syncContentFromView() {
  const s = visibleSurface();
  if (s === "code") content = codeEl.value;
  else if (s === "text") content = readEditFrame();
  // en "view" no se edita; content ya está al día
}

function setTab(tab) {
  syncContentFromView(); // captura ediciones de la superficie actual antes de cambiar
  for (const b of tabButtons) b.classList.toggle("active", b.dataset.tab === tab);
  viewFrame.hidden = tab !== "view";
  editFrame.hidden = tab !== "text";
  codeEl.hidden = tab !== "code";

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
  } else {
    codeEl.value = content;
  }
}

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) setTab(b.dataset.tab);
});

codeEl.addEventListener("input", () => { content = codeEl.value; markDirty(); });
titleEl.addEventListener("input", markDirty);

saveBtn.addEventListener("click", async () => {
  syncContentFromView();
  saveBtn.disabled = true;
  saveBtn.textContent = "Guardando…";
  try {
    const res = await api(`/api/documents/${id}`, { method: "PUT", body: { content, title: titleEl.value } });
    if (!res.ok) throw new Error(await res.text());
    dirty = false;
    toast("Guardado");
  } catch (err) {
    alert("Error al guardar: " + err.message);
  } finally {
    saveBtn.textContent = "Guardar";
    saveBtn.disabled = !dirty;
  }
});

document.getElementById("copy").addEventListener("click", async () => {
  if (!doc) return;
  const url = `${location.origin}/s/${doc.share_id}`;
  try { await navigator.clipboard.writeText(url); toast("Link copiado"); }
  catch { prompt("Copia el link:", url); }
});

window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

async function load() {
  const res = await api(`/api/documents/${id}`);
  if (!res.ok) { document.body.innerHTML = "<p style='padding:2rem'>No se pudo cargar el documento.</p>"; return; }
  doc = await res.json();
  content = doc.content || "";
  titleEl.value = doc.title || "";
  document.title = (doc.title || "Documento") + " · html-viewer";
  setTab("view");
}

load();
