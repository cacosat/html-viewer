// Tema: Sistema / Claro / Oscuro. La preferencia vive en localStorage ("hv-theme");
// "Sistema" sigue prefers-color-scheme. El bootstrap anti-flash está inline en el <head>.
// Expone openThemeMenu() para el ribbon y monta un botón en #theme-mount si existe.

import { icon } from "/icons.js";
import { openMenu } from "/common.js";

const KEY = "hv-theme";
const mq = window.matchMedia("(prefers-color-scheme: dark)");
const OPTIONS = [
  { pref: "system", label: "Tema del sistema", icon: "monitor" },
  { pref: "light", label: "Tema claro", icon: "sun" },
  { pref: "dark", label: "Tema oscuro", icon: "moon" },
];
const buttons = new Set();

export function getThemePref() { try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; } }
export function resolvedTheme(p = getThemePref()) { return p === "dark" || (p !== "light" && mq.matches) ? "dark" : "light"; }
export const themeIcon = () => (resolvedTheme() === "dark" ? "moon" : "sun");

function apply() {
  document.documentElement.dataset.theme = resolvedTheme();
  for (const b of buttons) b.innerHTML = icon(themeIcon());
}

export function setThemePref(p) {
  try { localStorage.setItem(KEY, p); } catch { /* modo privado */ }
  apply();
}

// Registra un botón para que su ícono siga al tema actual.
export function bindThemeButton(btn) {
  buttons.add(btn);
  btn.innerHTML = icon(themeIcon());
  btn.addEventListener("click", () => openThemeMenu(btn, btn.dataset.side || "bottom"));
}

export function openThemeMenu(anchor, side = "bottom") {
  const cur = getThemePref();
  openMenu(anchor, [
    { type: "label", label: "Tema" },
    ...OPTIONS.map((o) => ({ label: o.label, icon: o.icon, checked: o.pref === cur, onSelect: () => setThemePref(o.pref) })),
  ], { side, align: "end", label: "Tema" });
}

mq.addEventListener("change", () => { if (getThemePref() === "system") apply(); });
apply();

const slot = document.getElementById("theme-mount");
if (slot) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ui-btn ui-btn-ghost ui-btn-icon";
  b.setAttribute("aria-label", "Cambiar tema");
  b.setAttribute("aria-haspopup", "menu");
  b.setAttribute("aria-expanded", "false");
  b.title = "Tema";
  slot.appendChild(b);
  bindThemeButton(b);
}
