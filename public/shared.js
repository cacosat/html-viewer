const shareId = location.pathname.split("/").filter(Boolean).pop();

const frame = document.getElementById("frame");
frame.src = `/raw/${shareId}`; // /raw aplica CSP sandbox; el reporte queda aislado.
document.getElementById("download").href = `/raw/${shareId}?download`;

fetch(`/api/shared/${shareId}`).then(async (r) => {
  if (!r.ok) return;
  const d = await r.json();
  document.getElementById("title").textContent = d.title || "Documento";
  document.title = (d.title || "Documento") + " · html-viewer";
});
