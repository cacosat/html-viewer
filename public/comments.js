// Comentarios del documento (panel derecho): listar, comentar, resolver/reabrir y eliminar.

import { icon } from "/icons.js";
import { api, escapeHtml, fmtDate, toast, confirmDialog, isMac } from "/common.js";

export function initComments({ docId, profile, listEl, formEl, countEls = [], onCount }) {
  let resolvedOpen = false; // estado del desplegable "Resueltos" entre re-renders
  const textarea = formEl.querySelector("textarea");
  const hint = formEl.querySelector("#composer-hint");
  if (hint) hint.textContent = `${isMac ? "⌘" : "Ctrl"} + Enter para enviar`;

  function commentHtml(c) {
    const resolved = !!c.resolved;
    const toggle = resolved
      ? `<button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" data-cact="reopen">${icon("rotate-ccw")}Reabrir</button>`
      : `<button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" data-cact="resolve">${icon("check")}Resolver</button>`;
    const note = resolved
      ? `<div class="comment-note">${icon("check")}<span>Resuelto${c.resolved_by ? " por " + escapeHtml(c.resolved_by) : ""}${c.resolved_at ? " · " + fmtDate(c.resolved_at) : ""}</span></div>`
      : "";
    return `<article class="comment${resolved ? " is-resolved" : ""}" data-cid="${c.id}">
      <div class="comment-head"><span class="comment-author">${escapeHtml(c.author || "Anónimo")}</span><time class="comment-date">${fmtDate(c.created_at)}</time></div>
      <div class="comment-body">${escapeHtml(c.body)}</div>${note}
      <div class="comment-actions">${toggle}<button type="button" class="ui-btn ui-btn-ghost ui-btn-danger ui-btn-sm ui-btn-icon" data-cact="delete" aria-label="Eliminar comentario" title="Eliminar comentario">${icon("trash")}</button></div>
    </article>`;
  }

  async function load({ scrollToEnd = false } = {}) {
    let cs;
    try {
      const res = await api(`/api/documents/${encodeURIComponent(docId)}/comments`);
      if (!res.ok) throw new Error();
      cs = await res.json();
    } catch {
      listEl.innerHTML = `<p class="comments-empty">No se pudieron cargar los comentarios.</p>`;
      return;
    }
    const open = cs.filter((c) => !c.resolved);
    const done = cs.filter((c) => c.resolved);
    const prevScroll = listEl.scrollTop;
    let html = open.length
      ? open.map(commentHtml).join("")
      : `<p class="comments-empty">${done.length ? "No hay comentarios abiertos." : "Aún no hay comentarios. Escribe el primero abajo."}</p>`;
    if (done.length) {
      html += `<details class="resolved-group"${resolvedOpen ? " open" : ""}><summary>${icon("chevron-down", 14)}Resueltos (${done.length})</summary>${done.map(commentHtml).join("")}</details>`;
    }
    listEl.innerHTML = html;
    for (const el of countEls) { el.textContent = String(open.length); el.hidden = !open.length; }
    if (onCount) onCount(open.length);
    const det = listEl.querySelector(".resolved-group");
    if (det) det.addEventListener("toggle", () => { resolvedOpen = det.open; });
    if (!scrollToEnd) { listEl.scrollTop = prevScroll; return; }
    listEl.scrollTop = listEl.scrollHeight;
    // Con "Resueltos" abierto, el último comentario abierto queda sobre esa lista: traerlo a la vista.
    const lastOpen = [...listEl.querySelectorAll(":scope > .comment")].pop();
    if (lastOpen && resolvedOpen) {
      listEl.scrollTop += lastOpen.getBoundingClientRect().bottom - listEl.getBoundingClientRect().bottom + 16;
    }
  }

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-cact]");
    const cid = btn && btn.closest(".comment") && btn.closest(".comment").dataset.cid;
    if (!cid) return;
    const act = btn.dataset.cact;
    if (act === "delete") {
      const ok = await confirmDialog({
        title: "¿Eliminar este comentario?", body: "No se puede deshacer.",
        confirm: "Eliminar comentario", cancel: "Conservar comentario", danger: true,
      });
      if (!ok) return;
    }
    btn.disabled = true;
    try {
      const res = act === "delete"
        ? await api(`/api/comments/${cid}`, { method: "DELETE" })
        : await api(`/api/comments/${cid}`, { method: "PATCH", body: { resolved: act === "resolve", by: (profile && profile.name) || null } });
      // Un 404 al eliminar significa que alguien más ya lo borró: el resultado es el mismo.
      if (!res.ok && !(act === "delete" && res.status === 404)) throw new Error(String(res.status));
      if (act === "delete") toast("Comentario eliminado");
      else if (act === "resolve") toast("Comentario resuelto", { tone: "success" });
    } catch {
      toast("No se pudo actualizar el comentario", { tone: "danger" });
    }
    await load();
  });

  async function submit() {
    const body = textarea.value.trim();
    if (!body) { textarea.focus(); return; }
    const btn = formEl.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const res = await api(`/api/documents/${encodeURIComponent(docId)}/comments`, { method: "POST", body: { author: (profile && profile.name) || "Anónimo", body } });
      if (!res.ok) throw new Error();
      textarea.value = "";
      await load({ scrollToEnd: true });
    } catch {
      toast("No se pudo publicar el comentario. Inténtalo de nuevo.", { tone: "danger" });
    } finally {
      btn.disabled = false;
    }
  }
  formEl.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  });

  return { load };
}

