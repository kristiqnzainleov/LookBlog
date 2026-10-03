// /history — what you watched, your replies, and what you liked.
import { h, icon, empty, spinner, toast, timeEl, confirmClick, duration } from "../ui.js";
import { api } from "../api.js";
import { watchHref, openHref } from "../components/post.js";

const TABS = [["watched", "Watched"], ["comments", "Replies"], ["likes", "Liked"]];
const dayName = (iso) => {
  if (!iso) return "Earlier";
  const d = new Date(iso), t = new Date();
  const days = Math.floor((new Date(t.toDateString()) - new Date(d.toDateString())) / 86400000);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? d.toLocaleDateString("en-US", { weekday: "long" }) : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};
const hrefOf = (p) => (p.type === "video" ? watchHref(p.id) : p.type === "short" ? `/shorts?id=${p.id}` : openHref(p));
function thumb(p) {
  const m = p.media?.[0];
  const src = m ? (m.kind === "image" ? m.url : m.poster) : null;
  return h("a", { class: "hi-thumb" + (p.type === "short" ? " tall" : ""), href: hrefOf(p) },
    src ? h("img", { src, alt: "", loading: "lazy" }) : h("span", { class: "hi-text-thumb", text: (p.text || p.title || "").slice(0, 60) || "Post" }),
    m?.duration ? h("span", { class: "thumb-time", text: duration(m.duration) }) : null);
}

export function historyPage(view, _m, params) {
  document.title = "History / LookBlog";
  view.classList.add("page-history");
  let tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "watched";
  const tabs = h("div", { class: "tabs" });
  const tools = h("div", { class: "hi-tools" });
  const list = h("div", { class: "hi-list" });
  view.append(h("header", { class: "column-head" }, h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "History" }), h("p", { class: "page-sub", text: "What you watched, your replies and what you liked." }))), tabs), tools, list);
  const paintTabs = () => tabs.replaceChildren(...TABS.map(([k, l]) => h("button", { class: "tab" + (k === tab ? " active" : ""), text: l, onclick: () => { tab = k; paintTabs(); load(); } })));

  async function load() {
    list.replaceChildren(spinner());
    tools.replaceChildren();
    let d;
    try { d = await api(`/api/me/history?kind=${tab}`); } catch (err) { list.replaceChildren(empty("Couldn’t load your history.", err.error || "")); return; }
    if (tab === "watched") {
      const pause = h("button", { class: "btn btn-sm btn-outline-light", text: d.paused ? "▶ Turn history back on" : "⏸ Pause history" });
      pause.addEventListener("click", async () => { const r = await api("/api/me/history/pause", { method: "POST", body: { paused: !d.paused } }); toast(r.paused ? "History is paused. What you watch now isn’t saved." : "History is on again."); load(); });
      const clear = h("button", { class: "btn btn-sm btn-outline-light", text: "Clear all watch history" });
      confirmClick(clear, "Sure? Clear everything", async () => { await api("/api/me/history", { method: "DELETE" }); toast("Watch history cleared."); load(); });
      tools.append(pause, d.items.length ? clear : null);
      if (d.paused) tools.append(h("span", { class: "muted hi-paused", text: "History is paused." }));
    }
    list.replaceChildren();
    if (!d.items.length) return list.append(empty(tab === "watched" ? "Nothing watched yet." : tab === "comments" ? "You haven’t replied to anything yet." : "You haven’t liked anything yet.", ""));
    let lastDay = null;
    for (const it of d.items) {
      const day = dayName(it.at);
      if (day !== lastDay) { list.append(h("h3", { class: "hi-day", text: day })); lastDay = day; }
      const p = it.post;
      const row = h("div", { class: "hi-row" }, thumb(p),
        h("div", { class: "hi-main" },
          h("a", { class: "hi-title", href: hrefOf(p), text: p.title || (p.text || "").slice(0, 120) || (p.type === "short" ? "Short" : "Post") }),
          h("span", { class: "muted" }, p.author.name, " · ", p.type === "video" ? (p.film ? "Movie" : "Video") : p.type === "short" ? "Short" : "Post", it.at ? [" · ", timeEl(it.at)] : null),
          it.comment ? h("p", { class: "hi-comment" }, h("b", { text: "You replied: " }), it.comment.text || (it.comment.media?.gif ? "GIF" : it.comment.media ? "Photo or video" : "")) : null));
      if (tab === "watched") {
        const rm = h("button", { class: "icon-btn", title: "Remove from history", "aria-label": "Remove from history" }, icon("close"));
        rm.addEventListener("click", async () => { await api(`/api/me/history?postId=${encodeURIComponent(p.id)}`, { method: "DELETE" }); row.remove(); });
        row.append(rm);
      }
      list.append(row);
    }
  }
  paintTabs();
  load();
}
historyPage.navName = () => "";
