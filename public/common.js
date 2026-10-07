// Helpers compartidos por las páginas (módulos ES): API, formato, perfil,
// y componentes de UI (modal, confirmación, menú, popover, toast, compartir,
// modo presentación) sobre las clases ui-* de app.css.

import { icon } from "/icons.js";

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

// Mensaje legible de una respuesta de error (JSON {message} o texto).
export async function errorMessage(res) {
  const txt = await res.text().catch(() => "");
  try { return JSON.parse(txt).message || txt; } catch { return txt || `Error ${res.status}`; }
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(" ", "T") + "Z"); // SQLite UTC -> Date
  return isNaN(d) ? null : d;
}
export function fmtDate(s) {
  const d = parseDate(s);
  return d ? d.toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" }) : (s || "");
}
export function fmtShortDate(s) {
  const d = parseDate(s);
  if (!d) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("es-CL", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "2-digit" }).replace(".", "");
}
export function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
export function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => (w[0] || "").toUpperCase()).join("") || "?";
}

// Atajos: "⌘" en Mac, "Ctrl" en el resto.
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl";
export const kbd = (...keys) => keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join("");
export const shortcut = (...keys) => keys.join(isMac ? "" : "+");

// ---- Perfil activo (por navegador) ----
const PROFILE_KEY = "hv-profile";
export function getProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch { return null; }
}
export function setProfile(p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }
export function clearProfile() { localStorage.removeItem(PROFILE_KEY); }

// Preferencias de UI (localStorage tolerante a modo privado).
export function pref(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
}
export function setPref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

// ---- Toasts (con acción opcional, p. ej. "Deshacer") ----
export function toast(msg, opts = {}) {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = "toast" + (opts.tone ? ` is-${opts.tone}` : "") + (opts.action ? "" : " no-action");
  const ico = opts.tone === "success" ? icon("check") : opts.tone === "danger" ? icon("circle-alert") : "";
  t.innerHTML = `${ico}<span>${escapeHtml(msg)}</span>`;
  if (opts.action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ui-btn ui-btn-ghost ui-btn-sm";
    b.textContent = opts.action.label;
    b.addEventListener("click", () => { dismiss(); opts.action.onClick(); });
    t.appendChild(b);
  }
  host.appendChild(t);
  while (host.children.length > 3) host.firstElementChild.remove();
  let gone = false;
  function dismiss() {
    if (gone) return;
    gone = true;
    t.classList.add("is-leaving");
    setTimeout(() => t.remove(), 220);
  }
  setTimeout(dismiss, opts.duration || (opts.action ? 6000 : 2600));
  return dismiss;
}

// ---- Modal genérico ----
// build(modal, close) arma el contenido dentro de .ui-modal.
export function openModal(build, opts = {}) {
  const scrim = document.createElement("div");
  scrim.className = "ui-scrim" + (opts.top ? " is-top" : "");
  const modal = document.createElement("div");
  modal.className = "ui-modal" + (opts.wide ? " is-wide" : "") + (opts.className ? " " + opts.className : "");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  scrim.appendChild(modal);
  const prevFocus = document.activeElement;
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    scrim.remove();
    document.removeEventListener("keydown", onKey, true);
    if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    if (opts.onClose) opts.onClose(result);
  }
  function onKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    else if (e.key === "Tab") trapFocus(e, modal);
  }
  scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) close(); });
  document.addEventListener("keydown", onKey, true);
  build(modal, close);
  document.body.appendChild(scrim);
  const auto = modal.querySelector("[autofocus]") || modal.querySelector("input:not([readonly]), textarea, select, button.ui-btn-primary, button");
  if (auto) setTimeout(() => auto.focus(), 0);
  return close;
}

function trapFocus(e, root) {
  const f = [...root.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// Confirmación: pregunta + verbo repetido en el botón (nunca "OK"/"Sí").
export function confirmDialog({ title, body = "", confirm = "Confirmar", cancel = "Cancelar", danger = false }) {
  return new Promise((resolve) => {
    openModal((modal, close) => {
      modal.innerHTML = `
        <div class="ui-modal-body">
          <div class="ui-modal-head">
            <h2 class="ui-modal-title">${escapeHtml(title)}</h2>
            ${body ? `<p class="ui-modal-sub">${escapeHtml(body)}</p>` : ""}
          </div>
        </div>
        <div class="ui-modal-footer">
          <button type="button" class="ui-btn ui-btn-ghost" data-r="0">${escapeHtml(cancel)}</button>
          <button type="button" class="ui-btn ${danger ? "ui-btn-danger" : "ui-btn-primary"}" data-r="1" autofocus>${escapeHtml(confirm)}</button>
        </div>`;
      modal.querySelector('[data-r="0"]').addEventListener("click", () => close(false));
      modal.querySelector('[data-r="1"]').addEventListener("click", () => close(true));
    }, { onClose: (r) => resolve(r === true) });
  });
}

// Pide un valor (reemplaza a prompt()).
export function promptDialog({ title, label, value = "", placeholder = "", help = "", confirm = "Aceptar", cancel = "Cancelar", type = "text", validate }) {
  return new Promise((resolve) => {
    openModal((modal, close) => {
      modal.innerHTML = `
        <form class="ui-modal-body" novalidate>
          <h2 class="ui-modal-title">${escapeHtml(title)}</h2>
          <div class="ui-field">
            <label class="ui-label" for="pd-input">${escapeHtml(label)}</label>
            <input class="ui-input" id="pd-input" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
            <p class="ui-help" id="pd-help">${escapeHtml(help)}</p>
          </div>
          <button type="submit" hidden></button>
        </form>
        <div class="ui-modal-footer">
          <button type="button" class="ui-btn ui-btn-ghost" data-r="0">${escapeHtml(cancel)}</button>
          <button type="button" class="ui-btn ui-btn-primary" data-r="1">${escapeHtml(confirm)}</button>
        </div>`;
      const input = modal.querySelector("#pd-input");
      const helpEl = modal.querySelector("#pd-help");
      const submit = () => {
        const v = input.value.trim();
        const err = validate ? validate(v) : "";
        if (err) {
          input.setAttribute("aria-invalid", "true");
          helpEl.textContent = err;
          helpEl.classList.add("is-error");
          input.focus();
          return;
        }
        close(v);
      };
      modal.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
      modal.querySelector('[data-r="0"]').addEventListener("click", () => close(null));
      modal.querySelector('[data-r="1"]').addEventListener("click", submit);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }, { onClose: (r) => resolve(typeof r === "string" ? r : null) });
  });
}

// ---- Flotantes: posiciona `el` junto a `anchor`, sin salirse del viewport ----
export function placeFloating(el, anchor, { side = "bottom", align = "start", gap = 6 } = {}) {
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight, m = 8;
  let top, left;
  if (side === "right") {
    left = a.right + gap;
    top = align === "end" ? a.bottom - h : a.top;
    if (left + w > vw - m) left = a.left - gap - w;
  } else {
    top = side === "top" ? a.top - gap - h : a.bottom + gap;
    if (side !== "top" && top + h > vh - m) top = a.top - gap - h;
    if (side === "top" && top < m) top = a.bottom + gap;
    left = align === "end" ? a.right - w : a.left;
  }
  el.style.left = Math.round(Math.min(Math.max(left, m), vw - w - m)) + "px";
  el.style.top = Math.round(Math.min(Math.max(top, m), vh - h - m)) + "px";
}

let openFloating = null; // solo un menú/popover abierto a la vez

function mountFloating(el, anchor, opts, onClose) {
  if (openFloating) openFloating();
  el.style.visibility = "hidden";
  document.body.appendChild(el);
  placeFloating(el, anchor, opts);
  el.style.visibility = "";
  anchor.setAttribute("aria-expanded", "true");
  let closed = false;
  function close({ restoreFocus = false } = {}) {
    if (closed) return;
    closed = true;
    el.remove();
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("blur", onBlur);
    if (openFloating === close) openFloating = null;
    if (restoreFocus && anchor.focus) anchor.focus();
    if (onClose) onClose();
  }
  function onDoc(e) { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close({ restoreFocus: true }); }
  }
  // Un clic dentro de un iframe (p. ej. el documento) no llega al padre: cerrar al perder foco.
  function onBlur() { setTimeout(() => { if (document.activeElement && document.activeElement.tagName === "IFRAME") close(); }, 0); }
  setTimeout(() => {
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", onBlur);
  }, 0);
  openFloating = close;
  return close;
}

// Menú: items = [{label, icon, onSelect, checked, danger, meta} | {type:"sep"} | {type:"label", label}]
export function openMenu(anchor, items, opts = {}) {
  const menu = document.createElement("div");
  menu.className = "ui-menu";
  menu.setAttribute("role", "menu");
  if (opts.label) menu.setAttribute("aria-label", opts.label);
  for (const it of items) {
    if (it.type === "sep") { menu.insertAdjacentHTML("beforeend", '<div class="ui-menu-sep" role="separator"></div>'); continue; }
    if (it.type === "label") { menu.insertAdjacentHTML("beforeend", `<div class="ui-menu-label overline">${escapeHtml(it.label)}</div>`); continue; }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ui-menu-item" + (it.danger ? " is-danger" : "");
    b.setAttribute("role", it.checked !== undefined ? "menuitemradio" : "menuitem");
    if (it.checked !== undefined) b.setAttribute("aria-checked", String(!!it.checked));
    if (it.disabled) b.disabled = true;
    b.innerHTML = `${it.icon ? icon(it.icon) : ""}<span>${escapeHtml(it.label)}</span>` +
      (it.meta ? `<span class="menu-meta">${escapeHtml(it.meta)}</span>` : "") +
      (it.checked !== undefined ? `<span class="menu-check">${icon("check")}</span>` : "");
    b.addEventListener("click", () => { close(); it.onSelect && it.onSelect(); });
    menu.appendChild(b);
  }
  menu.addEventListener("keydown", (e) => {
    const its = [...menu.querySelectorAll(".ui-menu-item:not(:disabled)")];
    const i = its.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); its[(i + 1) % its.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); }
    else if (e.key === "Tab") close();
  });
  const close = mountFloating(menu, anchor, opts, opts.onClose);
  const first = menu.querySelector('[aria-checked="true"]') || menu.querySelector(".ui-menu-item:not(:disabled)");
  if (first) setTimeout(() => first.focus(), 0);
  return close;
}

// Popover con contenido libre: build(el, close)
export function openPopover(anchor, build, opts = {}) {
  const pop = document.createElement("div");
  pop.className = "ui-popover" + (opts.className ? " " + opts.className : "");
  pop.setAttribute("role", "dialog");
  let close = () => {};
  build(pop, (...a) => close(...a));
  close = mountFloating(pop, anchor, opts, opts.onClose);
  return close;
}

// ---- Modal: crear perfil (nombre, correo, área) ----
export function createProfileModal(onCreated) {
  openModal((modal, close) => {
    modal.innerHTML = `
      <form class="ui-modal-body" id="cp-form" novalidate>
        <div class="ui-modal-head">
          <h2 class="ui-modal-title">Nuevo perfil</h2>
          <p class="ui-modal-sub">El perfil identifica quién sube y comenta cada documento.</p>
        </div>
        <div class="ui-field">
          <label class="ui-label" for="cp-name">Nombre</label>
          <input class="ui-input" id="cp-name" autocomplete="name" placeholder="Ej: Ana Pérez">
          <p class="ui-help is-error" id="cp-err" hidden></p>
        </div>
        <div class="ui-field">
          <label class="ui-label" for="cp-email">Correo <span class="subtle">(opcional)</span></label>
          <input class="ui-input" id="cp-email" type="email" autocomplete="email" placeholder="nombre@empresa.com">
        </div>
        <div class="ui-field">
          <label class="ui-label" for="cp-area">Área <span class="subtle">(opcional)</span></label>
          <input class="ui-input" id="cp-area" placeholder="Ej: Marketing">
        </div>
        <button type="submit" hidden></button>
      </form>
      <div class="ui-modal-footer">
        <button type="button" class="ui-btn ui-btn-ghost" id="cp-cancel">Cancelar</button>
        <button type="button" class="ui-btn ui-btn-primary" id="cp-submit">Crear perfil</button>
      </div>`;
    const form = modal.querySelector("#cp-form");
    const nameEl = modal.querySelector("#cp-name");
    const err = modal.querySelector("#cp-err");
    async function submit() {
      const name = nameEl.value.trim();
      if (!name) {
        nameEl.setAttribute("aria-invalid", "true");
        err.textContent = "Escribe un nombre, por ejemplo: Ana Pérez.";
        err.hidden = false;
        nameEl.focus();
        return;
      }
      const res = await fetch("/api/profiles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: modal.querySelector("#cp-email").value.trim(), area: modal.querySelector("#cp-area").value.trim() }),
      }).catch(() => null);
      if (!res || !res.ok) { err.textContent = "No se pudo crear el perfil. Revisa tu conexión e inténtalo de nuevo."; err.hidden = false; return; }
      const p = await res.json();
      close();
      if (onCreated) onCreated(p);
    }
    form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
    modal.querySelector("#cp-submit").addEventListener("click", submit);
    modal.querySelector("#cp-cancel").addEventListener("click", () => close());
    nameEl.addEventListener("input", () => { nameEl.removeAttribute("aria-invalid"); err.hidden = true; });
  });
}

// ---- Visibilidad (público/privado) compartida por el modal y el panel ----
export async function setVisibility(doc, isPublic) {
  const res = await api(`/api/documents/${doc.id}`, { method: "PUT", body: { public: isPublic ? 1 : 0 } });
  if (!res.ok) throw new Error(await errorMessage(res));
  doc.public = isPublic ? 1 : 0;
  document.dispatchEvent(new CustomEvent("hv:doc-changed", { detail: { id: doc.id, public: doc.public } }));
}
export const shareUrl = (doc) => `${location.origin}/s/${doc.share_id}`;
export async function copyText(text, inputEl) {
  try { await navigator.clipboard.writeText(text); toast("Link copiado", { tone: "success" }); }
  catch { if (inputEl) { inputEl.focus(); inputEl.select(); } toast("Copia el link seleccionado con " + shortcut(MOD, "C")); }
}

// ---- Modal: compartir (link + copiar + interruptor público/privado) ----
export function shareModal(doc) {
  openModal((modal, close) => {
    const url = shareUrl(doc);
    modal.innerHTML = `
      <div class="ui-modal-body">
        <div class="ui-modal-head">
          <h2 class="ui-modal-title">Compartir</h2>
          <p class="ui-modal-sub">${escapeHtml(doc.title || "Documento")}</p>
        </div>
        <div class="setting-row">
          <div>
            <label class="ui-label" for="sh-switch">Documento público</label>
            <p class="ui-help" id="sh-desc"></p>
          </div>
          <button type="button" class="ui-switch" role="switch" id="sh-switch" aria-describedby="sh-desc"></button>
        </div>
        <div class="ui-field">
          <label class="ui-label" for="sh-link">Link</label>
          <div class="copy-row">
            <input class="ui-input" id="sh-link" readonly value="${escapeHtml(url)}">
            <button type="button" class="ui-btn" id="sh-copy">${icon("copy")}Copiar link</button>
          </div>
        </div>
      </div>
      <div class="ui-modal-footer">
        <button type="button" class="ui-btn ui-btn-ghost" id="sh-close">Cerrar</button>
      </div>`;
    const sw = modal.querySelector("#sh-switch");
    const desc = modal.querySelector("#sh-desc");
    const render = () => {
      const on = doc.public === 1 || doc.public === true;
      sw.setAttribute("aria-checked", String(on));
      desc.textContent = on ? "Cualquiera con el link puede verlo, sin iniciar sesión." : "Solo quienes inician sesión pueden abrirlo.";
    };
    render();
    sw.addEventListener("click", async () => {
      sw.disabled = true;
      try {
        await setVisibility(doc, !(doc.public === 1 || doc.public === true));
        render();
        toast(doc.public ? "Ahora es público" : "Ahora es privado");
      } catch { toast("No se pudo cambiar la visibilidad", { tone: "danger" }); }
      finally { sw.disabled = false; }
    });
    modal.querySelector("#sh-copy").addEventListener("click", () => copyText(url, modal.querySelector("#sh-link")));
    modal.querySelector("#sh-close").addEventListener("click", () => close());
  });
}

// ---- Modo presentación (pantalla completa + zoom) ----
export function presentMode(opts = {}) {
  const sandbox = opts.sandbox || "allow-scripts allow-forms allow-popups allow-modals allow-downloads";
  const overlay = document.createElement("div");
  overlay.className = "present-overlay";
  overlay.innerHTML =
    `<div class="present-bar">
      <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm ui-btn-icon" data-z="out" aria-label="Alejar" title="Alejar (−)">${icon("zoom-out")}</button>
      <span class="present-zoom" aria-live="polite">100%</span>
      <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm ui-btn-icon" data-z="in" aria-label="Acercar" title="Acercar (+)">${icon("zoom-in")}</button>
      <button type="button" class="ui-btn ui-btn-sm" data-z="reset" title="Ajustar al ancho (0)">${icon("maximize")}Ajustar</button>
      <span class="spacer"></span>
      <span class="present-hint">${kbd("+")} ${kbd("−")} zoom · ${kbd("Esc")} salir</span>
      <button type="button" class="ui-btn ui-btn-sm present-exit" title="Salir (Esc)">${icon("x")}Salir</button>
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
