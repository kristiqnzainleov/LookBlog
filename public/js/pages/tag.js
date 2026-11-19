// /tag/<hashtag>: everything posted with a #hashtag. Videos as a grid of thumbnails (like Videos),
// shorts as tall tiles (like on a profile) and posts as cards. Sorted by Top or Newest.
import { h, empty, spinner, toast } from "../ui.js";
import { api } from "../api.js";
import { postCard } from "../components/post.js";
import { videoTile, shortTile } from "./profile.js";

const TYPES = [["all", "All"], ["video", "Videos"], ["short", "Shorts"], ["post", "Posts"]];
const SORTS = [["top", "Top"], ["new", "Newest"]];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function tagPage(view, m, params) {
  let tag = "";
  try { tag = decodeURIComponent(m[1]); } catch { tag = m[1]; }
  tag = tag.replace(/^#/, "").toLowerCase();
  document.title = `#${tag} / Look Blog`;
  view.classList.add("page-tag");
  let type = TYPES.some(([k]) => k === params.get("type")) ? params.get("type") : "all";
  let sort = params.get("sort") === "new" ? "new" : "top";
  let seq = 0, lastCounts = null;

  const title = h("h1", { class: "ht-title" }, h("span", { class: "ht-hash", text: "#" }), tag);
  const sub = h("p", { class: "ht-sub muted", text: " " });
  const tabs = h("div", { class: "tabs ht-tabs", role: "tablist" });
  const sorts = h("div", { class: "ht-sorts", role: "group", "aria-label": "Sort" });
  const results = h("div", { class: "ht-results" });
  view.append(h("header", { class: "ht-head" }, title, sub, h("div", { class: "ht-bar" }, tabs, sorts)), results);

  const paintBar = (counts) => {
    tabs.replaceChildren(...TYPES.map(([k, label]) => {
      const n = counts ? counts[k] : null;
      const b = h("button", { type: "button", class: "tab" + (k === type ? " active" : ""), role: "tab", "aria-selected": String(k === type) },
        label, n != null && k !== "all" ? h("span", { class: "ht-count", text: String(n) }) : null);
      b.disabled = Boolean(counts) && k !== "all" && !n;
      b.addEventListener("click", () => { if (type !== k) { type = k; load(); } });
      return b;
    }));
    sorts.replaceChildren(...SORTS.map(([k, label]) => {
      const b = h("button", { type: "button", class: "ht-sort" + (k === sort ? " on" : ""), "aria-pressed": String(k === sort), text: label });
      b.addEventListener("click", () => { if (sort !== k) { sort = k; load(); } });
      return b;
    }));
  };
  paintBar(null);

  const render = (p) => (p.type === "short" ? shortTile(p) : p.type === "video" ? videoTile(p) : postCard(p));
  const gridFor = (t) => h("div", { class: t === "short" ? "short-grid" : t === "video" ? "video-grid big" : "feed" });

  async function load() {
    const my = ++seq;
    history.replaceState(history.state, "", `/tag/${encodeURIComponent(tag)}${type !== "all" || sort !== "top" ? "?" + new URLSearchParams({ ...(type !== "all" ? { type } : {}), ...(sort !== "top" ? { sort } : {}) }) : ""}`);
    paintBar(lastCounts);
    results.replaceChildren(spinner());
    let d;
    try { d = await api(`/api/tags/${encodeURIComponent(tag)}?type=${type}&sort=${sort}`); }
    catch (err) { if (my === seq) results.replaceChildren(empty("Couldn’t load this hashtag.", err.error || "Try again in a moment.")); return; }
    if (my !== seq) return;
    lastCounts = d.counts;
    sub.textContent = d.counts.all
      ? [plural(d.counts.all, "post", "posts"), d.counts.video ? plural(d.counts.video, "video", "videos") : "", d.counts.short ? plural(d.counts.short, "short", "shorts") : ""].filter(Boolean).join(" · ")
      : "Nothing yet";
    paintBar(d.counts);
    results.replaceChildren();
    if (!d.posts.length) {
      results.append(empty(`No ${type === "all" ? "posts" : TYPES.find(([k]) => k === type)[1].toLowerCase()} with #${tag} yet.`, "Be the first: add it to your post, video or short."));
      return;
    }
    if (type === "all") {
      // One section for each kind, in the order they rank
      const groups = { video: [], short: [], post: [] };
      for (const p of d.posts) groups[p.type === "short" ? "short" : p.type === "video" ? "video" : "post"].push(p);
      for (const k of ["video", "short", "post"]) {
        if (!groups[k].length) continue;
        const more = d.counts[k] > groups[k].length || (k !== "post" && groups[k].length > 6);
        const list = k === "post" ? groups[k] : groups[k].slice(0, 6);
        const all = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "See all" });
        all.addEventListener("click", () => { type = k; load(); scrollTo({ top: 0, behavior: "smooth" }); });
        results.append(h("section", { class: "ht-section" },
          h("div", { class: "ht-section-head" }, h("h2", { text: TYPES.find(([t]) => t === k)[1] }), more ? all : null),
          (() => { const g = gridFor(k); g.append(...list.map(render)); return g; })()));
      }
      return;
    }
    const grid = gridFor(type);
    grid.append(...d.posts.map(render));
    results.append(grid);
    let offset = d.posts.length;
    if (d.more) {
      const btn = h("button", { type: "button", class: "btn btn-sm btn-outline-light ht-more", text: "Show more" });
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const n = await api(`/api/tags/${encodeURIComponent(tag)}?type=${type}&sort=${sort}&offset=${offset}`);
          if (my !== seq) return;
          grid.append(...n.posts.map(render));
          offset += n.posts.length;
          if (n.more) btn.disabled = false; else btn.remove();
        } catch (err) { btn.disabled = false; toast(err.error || "Couldn’t load more."); }
      });
      results.append(btn);
    }
  }
  load();
}
tagPage.navName = () => "";
tagPage.layout = "wide";
