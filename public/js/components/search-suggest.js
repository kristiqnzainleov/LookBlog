// Suggestions under the top search box: people, groups, events and popular phrases as you type.
// With an empty box it shows your recent searches.
import { h, avatar, tick, icon } from "../ui.js";
import { api } from "../api.js";
import { navigate, profileHref } from "../router.js";
import { chatPic } from "./chat.js";

const RECENT_KEY = "lb-recent-searches";
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } };
export function rememberSearch(q) {
  q = q.trim();
  if (!q) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8))); } catch {}
}

export function attachSuggestions(form, input) {
  const box = h("div", { class: "suggest", role: "listbox", hidden: true });
  form.append(box);
  let items = [], active = -1, seq = 0, timer;

  const close = () => { box.hidden = true; active = -1; form.classList.remove("open"); };
  const go = (it) => { close(); input.blur(); if (it.q) rememberSearch(it.q); if (it.q && !it.href) input.value = ""; navigate(it.href); };
  const mark = (q, text) => {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    return i === -1 ? [text] : [text.slice(0, i), h("b", { text: text.slice(i, i + q.length) }), text.slice(i + q.length)];
  };
  function paint(groups, q) {
    items = [];
    box.replaceChildren();
    for (const [title, list] of groups) {
      if (!list.length) continue;
      box.append(h("p", { class: "sg-title", text: title }));
      for (const it of list) {
        const i = items.length;
        const row = h("a", { class: "sg-row", href: it.href, role: "option" }, ...it.render());
        row.addEventListener("mousedown", (e) => { e.preventDefault(); go(it); });
        row.addEventListener("mouseenter", () => setActive(i));
        items.push({ ...it, el: row });
        box.append(row);
      }
    }
    box.hidden = !items.length;
    form.classList.toggle("open", !box.hidden);
    active = -1;
  }
  const setActive = (i) => { active = i; items.forEach((it, k) => it.el.classList.toggle("on", k === i)); };

  async function update() {
    const q = input.value.trim();
    const n = ++seq;
    if (!q) {
      const r = recent();
      paint([["Recent searches", r.map((t) => ({ q: t, href: `/search?q=${encodeURIComponent(t)}`, render: () => [h("span", { class: "sg-ic" }, icon("replay")), h("span", { class: "sg-text", text: t })] }))]], q);
      if (r.length) box.querySelector(".sg-title").append(h("button", { type: "button", class: "sg-clear-btn", text: "Clear", onmousedown: (e) => { e.preventDefault(); try { localStorage.removeItem(RECENT_KEY); } catch {} close(); } }));
      return;
    }
    let d;
    try { d = await api(`/api/search/suggest?q=${encodeURIComponent(q)}`); } catch { return; }
    if (n !== seq || document.activeElement !== input) return;
    const phrase = (t) => ({ q: t, href: `/search?q=${encodeURIComponent(t)}`, render: () => [h("span", { class: "sg-ic" }, icon("search")), h("span", { class: "sg-text" }, h("span", {}, ...mark(q, t)))] });
    paint([
      ["", [phrase(q), ...d.terms.filter((t) => t.toLowerCase() !== q.toLowerCase()).map(phrase)]],
      ["People", d.people.map((u) => ({ q, href: profileHref(u.username), render: () => [avatar(u, 32), h("span", { class: "sg-text" }, h("span", { class: "sg-name" }, h("span", {}, ...mark(q, u.name)), tick(u, 13)), h("small", { class: "muted", text: `@${u.username} · ${u.followers} follower${u.followers === 1 ? "" : "s"}` }))] }))],
      ["Groups", d.groups.map((g) => ({ q, href: `/messages/${g.id}`, render: () => [chatPic(g, 32), h("span", { class: "sg-text" }, h("span", { class: "sg-name" }, h("span", {}, ...mark(q, g.name))), h("small", { class: "muted", text: `Group · ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}` }))] }))],
      ["Events", d.events.map((e) => ({ q, href: `/event/${e.id}`, render: () => [h("span", { class: "sg-ic ev" }, icon("calendar")), h("span", { class: "sg-text" }, h("span", { class: "sg-name" }, h("span", {}, ...mark(q, e.title))), h("small", { class: "muted", text: new Date(e.startsAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }))] }))],
    ], q);
  }

  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 140); });
  input.addEventListener("focus", update);
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((active + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); go(items[active]); }
    else if (e.key === "Escape") { close(); }
  });
  form.addEventListener("submit", () => { rememberSearch(input.value); close(); });
}
