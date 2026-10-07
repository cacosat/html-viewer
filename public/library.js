import { icon, hydrateIcons } from "/icons.js";
import { api, escapeHtml, fmtShortDate, fmtSize, toast, shareModal, confirmDialog, errorMessage, pref, setPref } from "/common.js";
import { initShell, loadDocs, loadStorage, fmtGB } from "/shell.js";

hydrateIcons();
const shell = initShell({ page: "library" });

const docsEl = document.getElementById("docs");
const emptyEl = document.getElementById("empty");
const calloutEl = document.getElementById("storage-callout");
const tabs = [...document.querySelectorAll(".lib-tabs .ui-tab")];
const LABEL = { mine: "Mis archivos", public: "Públicos" };

const fromUrl = new URLSearchParams(location.search).get("scope");
let scope = fromUrl === "public" || fromUrl === "mine" ? fromUrl : pref("hv-lib-scope", "mine");

function setScope(s) {
  scope = s;
  setPref("hv-lib-scope", s);
  history.replaceState(null, "", s === "mine" ? "/library" : "/library?scope=public");
  render();
}
for (const t of tabs) t.addEventListener("click", () => setScope(t.dataset.scope));
document.querySelector(".lib-tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const next = tabs[(tabs.findIndex((t) => t.dataset.scope === scope) + 1) % tabs.length];
  setScope(next.dataset.scope);
  next.focus();
});

const ownsDoc = (d) => !d.profile_id || (shell && d.profile_id === shell.profile.id);

function cardHtml(d) {
  const vis = d.public
    ? '<span class="ui-badge ui-badge-teal ui-badge-dot">Público</span>'
    : `<span class="ui-badge">${icon("lock")}Privado</span>`;
  const author = scope === "public" && d.profile_name ? `<span class="ui-badge">${escapeHtml(d.profile_name)}</span>` : "";
  const href = `/doc/${encodeURIComponent(d.id)}`;
  return `
  <article class="ui-card ui-card-interactive doc-card" data-id="${escapeHtml(d.id)}">
    <a class="doc-thumb" href="${href}" tabindex="-1" aria-hidden="true">
      <iframe data-src="/raw/${escapeHtml(d.share_id)}" sandbox="allow-scripts" scrolling="no" tabindex="-1" title="Vista previa"></iframe>
    </a>
    <div class="doc-card-body">
      <a class="doc-card-title" href="${href}">${escapeHtml(d.title)}</a>
      <div class="doc-card-meta">${author}${vis}</div>
      <div class="doc-card-foot">
        <span class="code-sm" title="Actualizado">${fmtSize(d.size)} · ${fmtShortDate(d.updated_at)}</span>
        <div class="doc-card-actions">
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm ui-btn-icon" data-card="share" aria-label="Compartir ${escapeHtml(d.title)}" title="Compartir">${icon("share")}</button>
          <a class="ui-btn ui-btn-ghost ui-btn-sm ui-btn-icon" href="/raw/${escapeHtml(d.share_id)}?download" aria-label="Descargar ${escapeHtml(d.title)}" title="Descargar HTML">${icon("download")}</a>
          ${ownsDoc(d) ? `<button type="button" class="ui-btn ui-btn-ghost ui-btn-danger ui-btn-sm ui-btn-icon" data-card="delete" aria-label="Eliminar ${escapeHtml(d.title)}" title="Eliminar">${icon("trash")}</button>` : ""}
        </div>
      </div>
    </div>
  </article>`;
}

function emptyHtml() {
  return scope === "mine"
    ? `<div class="empty">
        <div class="empty-icon">${icon("file-up", 20)}</div>
        <h2 class="h4">Aún no tienes documentos</h2>
        <p class="small muted">Sube un reporte HTML para verlo, editarlo y compartirlo. También puedes arrastrar un archivo .html a esta ventana.</p>
        <button type="button" class="ui-btn" data-act="upload">${icon("upload")}Subir HTML</button>
      </div>`
    : `<div class="empty">
        <div class="empty-icon">${icon("globe", 20)}</div>
        <h2 class="h4">Aún no hay documentos públicos</h2>
        <p class="small muted">Cuando alguien active «Documento público» al compartir, aparecerá aquí.</p>
      </div>`;
}

let docsById = new Map();
async function render() {
  for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.scope === scope));
  document.getElementById("lib-title").textContent = LABEL[scope];
  document.getElementById("crumb-scope").textContent = LABEL[scope];
  document.title = `${LABEL[scope]} · Visor HTML`;

  const [mine, pub] = await Promise.all([loadDocs("mine"), loadDocs("public")]);
  document.getElementById("count-mine").textContent = String(mine.length);
  document.getElementById("count-public").textContent = String(pub.length);
  const docs = scope === "public" ? pub : mine;
  docsById = new Map(docs.map((d) => [String(d.id), d]));
  const n = docs.length;
  document.getElementById("lib-desc").textContent = scope === "public"
    ? `${n} ${n === 1 ? "documento visible" : "documentos visibles"} con link, de todo el equipo`
    : `${n} ${n === 1 ? "documento" : "documentos"} de ${shell.profile.name}`;

  docsEl.innerHTML = docs.map(cardHtml).join("");
  emptyEl.innerHTML = n ? "" : emptyHtml();
  emptyEl.hidden = n > 0;
  hydrateThumbs();
}

function hydrateThumbs() {
  const io = new IntersectionObserver((entries, obs) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const f = en.target;
      if (f.dataset.src) { f.src = f.dataset.src; f.removeAttribute("data-src"); }
      obs.unobserve(f);
    }
  }, { rootMargin: "300px" });
  for (const f of docsEl.querySelectorAll("iframe[data-src]")) io.observe(f);
}

docsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-card]");
  if (!btn) return;
  const d = docsById.get(btn.closest(".doc-card").dataset.id);
  if (!d) return;
  if (btn.dataset.card === "share") { shareModal(d); return; }
  if (btn.dataset.card === "delete") {
    const ok = await confirmDialog({
      title: "¿Eliminar este documento?",
      body: `«${d.title}» y sus comentarios se eliminarán definitivamente.`,
      confirm: "Eliminar documento", cancel: "Conservar documento", danger: true,
    });
    if (!ok) return;
    const res = await api(`/api/documents/${encodeURIComponent(d.id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) { toast(await errorMessage(res) || "No se pudo eliminar", { tone: "danger" }); return; }
    document.dispatchEvent(new CustomEvent("hv:docs-changed"));
    toast("Documento eliminado");
  }
});

async function renderStorageCallout() {
  const s = await loadStorage();
  if (!s || !(s.over || s.near)) { calloutEl.hidden = true; return; }
  calloutEl.className = "callout lib-callout " + (s.over ? "is-danger" : "is-warning");
  calloutEl.innerHTML = s.over
    ? `${icon("circle-alert")}<div><strong>Almacenamiento al límite (${fmtGB(s.used)} de 7 GB).</strong> Las subidas están bloqueadas para no exceder el plan gratuito de Cloudflare R2 (10 GB). Elimina documentos o amplía el plan de R2 para volver a subir.</div>`
    : `${icon("circle-alert")}<div><strong>Almacenamiento en ${fmtGB(s.used)} de 7 GB.</strong> Al llegar a 7 GB se bloquearán las subidas.</div>`;
  calloutEl.hidden = false;
}

// El shell ya invalidó la caché y refrescó el almacenamiento (se registra antes).
document.addEventListener("hv:docs-changed", () => { render(); renderStorageCallout(); });
document.addEventListener("hv:doc-changed", () => render());

if (shell) {
  render();
  renderStorageCallout();
}
