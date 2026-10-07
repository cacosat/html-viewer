import { icon, hydrateIcons } from "/icons.js";
import { presentMode } from "/common.js";

hydrateIcons();
const shareId = location.pathname.split("/").filter(Boolean).pop();
const frame = document.getElementById("frame");
const titleEl = document.getElementById("title");
const dl = document.getElementById("download");
const present = document.getElementById("present");

function stateCard({ ic, title, text, action }) {
  document.getElementById("main").innerHTML = `
    <div class="doc-error">
      <div class="ui-card state-card">
        <div class="empty-icon">${icon(ic, 20)}</div>
        <h1 class="h3">${title}</h1>
        <p class="small muted">${text}</p>
        ${action || ""}
      </div>
    </div>`;
}

fetch(`/api/shared/${shareId}`).then(async (r) => {
  if (r.status === 403) {
    titleEl.textContent = "Documento privado";
    stateCard({
      ic: "lock",
      title: "Este documento es privado",
      text: "Solo pueden abrirlo quienes inician sesión en Visor HTML. Si deberías tener acceso, inicia sesión y vuelve a abrir el link.",
      action: '<a class="ui-btn ui-btn-primary" href="/">Iniciar sesión</a>',
    });
    return;
  }
  if (!r.ok) {
    titleEl.textContent = "No encontrado";
    stateCard({ ic: "circle-alert", title: "No encontramos este documento", text: "Puede que el link esté incompleto o que el documento se haya eliminado." });
    return;
  }
  const d = await r.json();
  titleEl.textContent = d.title || "Documento";
  document.title = `${d.title || "Documento"} · Visor HTML`;
  frame.src = `/raw/${shareId}`; // /raw aplica CSP sandbox: el reporte queda aislado.
  dl.href = `/raw/${shareId}?download`;
  dl.hidden = false;
  present.hidden = false;
  present.addEventListener("click", () => presentMode({ src: `/raw/${shareId}` }));
}).catch(() => {
  stateCard({ ic: "circle-alert", title: "No se pudo cargar el documento", text: "Revisa tu conexión y vuelve a intentarlo." });
});
