// Selector de tema: un ícono con dropdown (Sistema / Claro / Oscuro).
// La preferencia se guarda en localStorage; "Sistema" sigue prefers-color-scheme.
// El bootstrap anti-flash vive inline en el <head> de cada página.

const KEY = "hv-theme";
const mq = window.matchMedia("(prefers-color-scheme: dark)");

const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
  monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
};

const OPTIONS = [
  { pref: "system", label: "Sistema", icon: "monitor" },
  { pref: "light", label: "Claro", icon: "sun" },
  { pref: "dark", label: "Oscuro", icon: "moon" },
];

function getPref() { try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; } }
function resolve(p) { return p === "dark" || (p !== "light" && mq.matches) ? "dark" : "light"; }
function applyTheme() { document.documentElement.dataset.theme = resolve(getPref()); }

let wrap, btn, pop;

function refresh() {
  const p = getPref();
  if (btn) btn.innerHTML = ICONS[resolve(p) === "dark" ? "moon" : "sun"];
  if (pop) for (const b of pop.children) b.setAttribute("aria-checked", String(b.dataset.pref === p));
}

function setPref(p) {
  try { localStorage.setItem(KEY, p); } catch { /* modo privado */ }
  applyTheme();
  refresh();
}

function openMenu() {
  pop.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  document.addEventListener("click", onDoc);
  document.addEventListener("keydown", onKey);
}
function closeMenu() {
  pop.hidden = true;
  btn.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", onDoc);
  document.removeEventListener("keydown", onKey);
}
function onDoc(e) { if (!wrap.contains(e.target)) closeMenu(); }
function onKey(e) { if (e.key === "Escape") closeMenu(); }

function mount() {
  const slot = document.getElementById("theme-mount");
  if (!slot) return;
  wrap = document.createElement("div");
  wrap.className = "theme-menu";

  btn = document.createElement("button");
  btn.type = "button";
  btn.className = "theme-btn";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-label", "Cambiar tema");

  pop = document.createElement("div");
  pop.className = "theme-pop";
  pop.setAttribute("role", "menu");
  pop.hidden = true;

  for (const o of OPTIONS) {
    const item = document.createElement("button");
    item.type = "button";
    item.dataset.pref = o.pref;
    item.setAttribute("role", "menuitemradio");
    item.innerHTML = `${ICONS[o.icon]}<span>${o.label}</span><span class="tick" aria-hidden="true">✓</span>`;
    item.addEventListener("click", () => { setPref(o.pref); closeMenu(); });
    pop.appendChild(item);
  }

  btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden ? openMenu() : closeMenu(); });
  wrap.append(btn, pop);
  slot.appendChild(wrap);
  refresh();
}

mq.addEventListener("change", () => { if (getPref() === "system") { applyTheme(); refresh(); } });
applyTheme();
mount();
