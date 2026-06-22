const shareId = location.pathname.split("/").filter(Boolean).pop();
const frame = document.getElementById("frame");
const titleEl = document.getElementById("title");
const dl = document.getElementById("download");

fetch(`/api/shared/${shareId}`).then(async (r) => {
  if (r.status === 403) {
    titleEl.textContent = "Documento privado";
    dl.hidden = true;
    document.querySelector(".viewer-main").innerHTML =
      `<div class="empty-state"><p>Este documento es privado.</p><a class="btn" href="/">Iniciar sesión</a></div>`;
    return;
  }
  if (!r.ok) {
    titleEl.textContent = "No encontrado";
    dl.hidden = true;
    document.querySelector(".viewer-main").innerHTML =
      `<div class="empty-state"><p>Documento no encontrado.</p></div>`;
    return;
  }
  const d = await r.json();
  titleEl.textContent = d.title || "Documento";
  document.title = (d.title || "Documento") + " · Reuse";
  frame.src = `/raw/${shareId}`; // /raw aplica CSP sandbox; el reporte queda aislado.
  dl.href = `/raw/${shareId}?download`;
});
