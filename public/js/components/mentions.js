// Typing "@" in a text box suggests people to tag.
import { h, avatar, tick } from "../ui.js";
import { api } from "../api.js";

export function attachMentions(field, opts = {}) {
  const box = h("div", { class: "mention-box", role: "listbox", hidden: true });
  let items = [], active = 0, range = null, timer, seq = 0;

  const place = () => {
    const r = field.getBoundingClientRect();
    box.style.left = Math.max(8, r.left) + "px";
    box.style.top = r.bottom + 6 + "px";
    box.style.width = Math.min(320, r.width) + "px";
  };
  const close = () => { box.hidden = true; items = []; range = null; if (!field.isConnected) box.remove(); };

  function pick(u) {
    if (!range) return;
    const v = field.value;
    field.value = v.slice(0, range.start) + "@" + u.username + " " + v.slice(range.end);
    const pos = range.start + u.username.length + 2;
    field.setSelectionRange(pos, pos);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    field.focus();
  }

  function paint() {
    box.replaceChildren(...items.map((u, i) => {
      const row = h("button", { type: "button", class: "mention-item" + (i === active ? " active" : ""), role: "option" },
        avatar(u, 30), h("span", { class: "mi-text" }, h("b", {}, u.name, tick(u, 14)), h("span", { class: "muted", text: "@" + u.username })));
      row.addEventListener("mousedown", (e) => { e.preventDefault(); pick(u); });
      return row;
    }));
    box.hidden = !items.length;
    if (items.length) place();
  }

  field.addEventListener("input", () => {
    const pos = field.selectionStart;
    const before = field.value.slice(0, pos);
    const m = before.match(/(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{0,15})$/);
    if (!m) return close();
    range = { start: pos - m[2].length - 1, end: pos };
    clearTimeout(timer);
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const { users } = await api(`/api/users/lookup?q=${encodeURIComponent(m[2])}`);
        if (mine !== seq) return;
        const q = m[2].toLowerCase();
        const first = (opts.people?.() || []).filter((u) => !q || u.username.toLowerCase().startsWith(q) || u.name.toLowerCase().includes(q));
        const seen = new Set(first.map((u) => u.username));
        items = [...(opts.everyone?.() && "everyone".startsWith(q) ? [{ username: "everyone", name: "Everyone in this group", avatar: null }] : []), ...first, ...users.filter((u) => !seen.has(u.username))].slice(0, 8);
        active = 0;
        paint();
      } catch { close(); }
    }, 120);
  });
  field.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); pick(items[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); close(); }
  }, true);
  field.addEventListener("blur", () => setTimeout(close, 150));
  window.addEventListener("scroll", () => !box.hidden && place(), true);
  document.body.append(box);
  return { close };
}
