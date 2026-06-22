// Helpers compartidos por las páginas (módulos ES).

export async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
    init.body = JSON.stringify(opts.body);
    init.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, init);
  if (res.status === 401 && location.pathname !== "/" && !location.pathname.startsWith("/s/")) {
    location.href = "/";
    throw new Error("No autorizado");
  }
  return res;
}

export function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T") + "Z"); // SQLite UTC -> Date
  if (isNaN(d)) return s;
  return d.toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });
}

export function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---- Perfil activo (por navegador) ----
const PROFILE_KEY = "hv-profile";
export function getProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch { return null; }
}
export function setProfile(p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }
export function clearProfile() { localStorage.removeItem(PROFILE_KEY); }

// ---- Modal genérico ----
export function openModal(build) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const dialog = document.createElement("div");
  dialog.className = "modal";
  overlay.appendChild(dialog);
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  function onKey(e) { if (e.key === "Escape") close(); }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  build(dialog, close);
  document.body.appendChild(overlay);
  return close;
}

// ---- Modal: crear perfil (nombre, correo, área) ----
export function createProfileModal(onCreated) {
  openModal((dialog, close) => {
    dialog.innerHTML = `
      <h3>Nuevo perfil</h3>
      <form class="modal-form" id="cp-form">
        <input id="cp-name" placeholder="Nombre" required autocomplete="name">
        <input id="cp-email" type="email" placeholder="Correo (opcional)" autocomplete="email">
        <input id="cp-area" placeholder="Área (ej: Marketing)">
        <p class="error" id="cp-err" hidden></p>
        <div class="modal-actions">
          <button type="button" class="ghost" id="cp-cancel">Cancelar</button>
          <button type="submit">Crear perfil</button>
        </div>
      </form>`;
    dialog.querySelector("#cp-cancel").addEventListener("click", close);
    dialog.querySelector("#cp-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = dialog.querySelector("#cp-name").value.trim();
      const email = dialog.querySelector("#cp-email").value.trim();
      const area = dialog.querySelector("#cp-area").value.trim();
      if (!name) return;
      const res = await fetch("/api/profiles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, area }),
      });
      if (!res.ok) { const er = dialog.querySelector("#cp-err"); er.textContent = "No se pudo crear el perfil."; er.hidden = false; return; }
      const p = await res.json();
      close();
      if (onCreated) onCreated(p);
    });
    setTimeout(() => dialog.querySelector("#cp-name")?.focus(), 0);
  });
}

// ---- Modal: compartir (link + copiar + toggle público/privado, estilo Drive) ----
export function shareModal(doc) {
  openModal((dialog, close) => {
    const url = `${location.origin}/s/${doc.share_id}`;
    let isPublic = doc.public === 1 || doc.public === true;
    dialog.innerHTML = `
      <h3>Compartir</h3>
      <p class="modal-sub muted">${escapeHtml(doc.title || "Documento")}</p>
      <div class="share-row">
        <input class="share-link" readonly value="${escapeHtml(url)}">
        <button class="copy-link">Copiar</button>
      </div>
      <div class="vis-row">
        <div>
          <div class="vis-title"></div>
          <div class="vis-desc muted"></div>
        </div>
        <button class="vis-toggle" role="switch" aria-label="Cambiar visibilidad"></button>
      </div>
      <div class="modal-actions"><button class="ghost modal-close">Cerrar</button></div>`;
    const visTitle = dialog.querySelector(".vis-title");
    const visDesc = dialog.querySelector(".vis-desc");
    const toggle = dialog.querySelector(".vis-toggle");
    function render() {
      visTitle.textContent = isPublic ? "Público" : "Privado";
      visDesc.textContent = isPublic
        ? "Cualquiera con el link puede verlo."
        : "Solo quienes inician sesión pueden abrirlo.";
      toggle.classList.toggle("on", isPublic);
      toggle.setAttribute("aria-checked", String(isPublic));
    }
    render();
    toggle.addEventListener("click", async () => {
      const next = !isPublic;
      toggle.disabled = true;
      try {
        const res = await api(`/api/documents/${doc.id}`, { method: "PUT", body: { public: next ? 1 : 0 } });
        if (!res.ok) throw new Error("error");
        isPublic = next;
        doc.public = next ? 1 : 0;
        render();
        toast(isPublic ? "Ahora es público" : "Ahora es privado");
        document.dispatchEvent(new CustomEvent("hv:doc-changed", { detail: { id: doc.id, public: doc.public } }));
      } catch {
        toast("No se pudo cambiar la visibilidad");
      } finally {
        toggle.disabled = false;
      }
    });
    dialog.querySelector(".copy-link").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(url); toast("Link copiado"); }
      catch { const i = dialog.querySelector(".share-link"); i.focus(); i.select(); }
    });
    dialog.querySelector(".modal-close").addEventListener("click", close);
  });
}

// ---- Modo presentación (pantalla completa + zoom) ----
export function presentMode(opts = {}) {
  const sandbox = opts.sandbox || "allow-scripts allow-forms allow-popups allow-modals allow-downloads";
  const overlay = document.createElement("div");
  overlay.className = "present-overlay";
  overlay.innerHTML =
    `<div class="present-bar">
      <button class="pbtn" data-z="out" aria-label="Alejar" title="Alejar (−)">−</button>
      <span class="present-zoom">100%</span>
      <button class="pbtn" data-z="in" aria-label="Acercar" title="Acercar (+)">+</button>
      <button class="pbtn" data-z="reset" title="Ajustar (0)">Ajustar</button>
      <div class="present-spacer"></div>
      <span class="present-hint">+/− zoom · Esc salir</span>
      <button class="pbtn present-exit" title="Salir (Esc)">Salir ✕</button>
    </div>
    <div class="present-stage"><div class="present-zoomwrap"><iframe title="Presentación" sandbox="${sandbox}"></iframe></div></div>`;
  document.body.appendChild(overlay);

  const stage = overlay.querySelector(".present-stage");
  const wrap = overlay.querySelector(".present-zoomwrap");
  const iframe = overlay.querySelector("iframe");
  const label = overlay.querySelector(".present-zoom");
  if (opts.srcdoc != null) iframe.srcdoc = opts.srcdoc;
  else if (opts.src) iframe.src = opts.src;

  let z = 1, baseW = 0, baseH = 0, closed = false;
  function apply() {
    iframe.style.transform = `scale(${z})`;
    wrap.style.width = baseW * z + "px";
    wrap.style.height = baseH * z + "px";
    label.textContent = Math.round(z * 100) + "%";
  }
  function fit() {
    baseW = stage.clientWidth;
    baseH = stage.clientHeight;
    iframe.style.width = baseW + "px";
    iframe.style.height = baseH + "px";
    apply();
  }
  function setZoom(nz) { z = Math.min(4, Math.max(0.25, Math.round(nz * 20) / 20)); apply(); }
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", fit);
    document.removeEventListener("fullscreenchange", onFs);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    overlay.remove();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "+" || e.key === "=") setZoom(z + 0.1);
    else if (e.key === "-" || e.key === "_") setZoom(z - 0.1);
    else if (e.key === "0") { z = 1; fit(); }
  }
  function onFs() { if (!document.fullscreenElement) close(); }

  overlay.querySelector('[data-z="in"]').addEventListener("click", () => setZoom(z + 0.1));
  overlay.querySelector('[data-z="out"]').addEventListener("click", () => setZoom(z - 0.1));
  overlay.querySelector('[data-z="reset"]').addEventListener("click", () => { z = 1; fit(); });
  overlay.querySelector(".present-exit").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", fit);

  if (overlay.requestFullscreen) {
    overlay.requestFullscreen().then(() => document.addEventListener("fullscreenchange", onFs)).catch(() => {});
  }
  fit();
}
