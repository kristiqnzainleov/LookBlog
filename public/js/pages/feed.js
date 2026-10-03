// /feed: the latest posts, shorts and videos, newest first.
import { h, empty, avatar, tick } from "../ui.js";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { state, on } from "../state.js";
import { postCard, pagedList, recommendedLoader, withReason } from "../components/post.js";

let scope = (() => { try { const v = localStorage.getItem("lb_scope"); return ["following", "all"].includes(v) ? v : "foryou"; } catch { return "foryou"; } })();
// A different line under "Feed" every time you come back
const LINES = {
  all: [
    "Newest first. Every Cool pushes a post up.",
    "What did everyone see today?",
    "Fresh from people’s cameras.",
    "Scroll slowly. Someone made this.",
    "No ads. Just people.",
    "Press Cool on what makes you smile.",
    "Look around. Somebody’s waiting for a reply.",
    "Today’s small things, in order.",
    "Your eyes, our pink. Look around.",
    "Coffee, cameras and conversations.",
    "Good posts float up when people Cool them.",
    "Seen something nice? Post it from your profile.",
  ],
  foryou: [
    "Picked for you from what you watch, like and reply to.",
    "Things you might like, from people you might not know yet.",
    "The more you like and watch, the better this gets.",
  ],
  following: [
    "You and the people you follow, with their reposts.",
    "Just your people. Nothing else.",
    "What your friends have been up to.",
    "The people you chose, newest first.",
    "Catch up with everyone you follow.",
  ],
};
let lastLine = {};
function pickLine(scope) {
  let prev = null;
  try { prev = sessionStorage.getItem("lb_line_" + scope); } catch {}
  const list = LINES[scope].filter((l) => l !== prev && l !== lastLine[scope]);
  const line = list[Math.floor(Math.random() * list.length)];
  lastLine[scope] = line;
  try { sessionStorage.setItem("lb_line_" + scope, line); } catch {}
  return line;
}

// Who's live right now (people you follow first)
function liveStrip() {
  const el = h("div", { class: "live-strip" });
  const paint = async () => {
    try {
      const { streams } = await api("/api/streams");
      el.replaceChildren(...streams.filter((s) => !s.isHost).map((s) => h("a", { class: "ls-card", href: `/live/${s.id}` },
        h("div", { class: "ls-thumb", style: s.thumb ? `background-image:url("${s.thumb}")` : "" }, h("span", { class: "lv-badge", text: "LIVE" }), h("span", { class: "ls-n", text: `👁 ${s.viewers}` })),
        h("div", { class: "ls-info" }, avatar(s.host, 30), h("div", {}, h("b", { text: s.title }), h("small", {}, s.host.name, tick(s.host, 12)))))));
    } catch {}
  };
  paint();
  const off = on("stream:state", () => setTimeout(paint, 300));
  const iv = setInterval(() => { if (!el.isConnected) { clearInterval(iv); off?.(); return; } paint(); }, 30000);
  return el;
}

export function feedPage(view) {
  if (new URLSearchParams(location.search).has("create")) {
    navigate(`/u/${encodeURIComponent(state.me.username)}${location.search}`, { replace: true });
    return;
  }
  document.title = "Feed / Look Blog";
  const list = h("div", { class: "feed" });
  const pill = h("button", { class: "new-pill", hidden: true });
  let pager, waiting = 0;

  const subtitle = h("p", { class: "page-sub" });
  const tabs = h("div", { class: "tabs", role: "tablist" });
  for (const [s, label] of [["foryou", "For you"], ["all", "All"], ["following", "Following"]]) {
    const b = h("button", { class: "tab", role: "tab", text: label, dataset: { scope: s } });
    b.addEventListener("click", () => { scope = s; try { localStorage.setItem("lb_scope", s); } catch {} load(); });
    tabs.append(b);
  }

  view.append(
    h("header", { class: "column-head" },
      h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "Feed" }), subtitle)),
      tabs
    ),
    liveStrip(),
    pill,
    list
  );

  function load() {
    pager?.stop();
    waiting = 0;
    pill.hidden = true;
    subtitle.textContent = pickLine(scope);
    subtitle.classList.remove("line-in"); void subtitle.offsetWidth; subtitle.classList.add("line-in");
    tabs.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.scope === scope);
      t.setAttribute("aria-selected", String(t.dataset.scope === scope));
    });
    list.replaceChildren();
    pager = pagedList({
      container: list,
      load: scope === "foryou" ? recommendedLoader() : (before) => api(`/api/feed?scope=${scope === "all" ? "latest&sort=cool" : "following"}${before ? "&before=" + encodeURIComponent(before) : ""}`),
      render: (p) => (scope === "foryou" ? withReason(postCard(p), p) : postCard(p)),
      emptyEl: () => scope === "following"
        ? empty("Your feed is quiet.", "Posts from you and the people you follow show up here. Follow a few people, or look at the latest posts.",
            h("button", { class: "btn btn-primary btn-sm", text: "See all posts", onclick: () => tabs.querySelector('[data-scope="all"]').click() }))
        : empty("Nothing here yet.", "Nobody has posted so far. Write the first post on Look Blog."),
    });
  }

  // My own new posts go straight to the top
  const offCreated = on("post:created", (p) => {
    if (p.type === "short") return; // shorts live on the Shorts page
    list.querySelector(".empty")?.remove();
    const card = postCard(p);
    card.classList.add("new");
    list.prepend(card);
  });

  // Other people's new posts: offer a "show new posts" button instead of jumping the page
  const offNew = on("post:new", (ev) => {
    if (ev.authorId === state.me.id || ev.postType === "short") return;
    if (scope === "following" && !state.me.following?.includes(ev.authorId)) return;
    waiting++;
    pill.textContent = waiting === 1 ? "Show 1 new post" : `Show ${waiting} new posts`;
    pill.hidden = false;
  });
  pill.addEventListener("click", () => { window.scrollTo({ top: 0 }); load(); });

  const offDeleted = on("post:deleted", (ev) => list.querySelectorAll(`.post[data-id="${CSS.escape(ev.id)}"]`).forEach((el) => el.remove()));

  // When I repost something, show it at the top of my Following feed
  const offRepost = on("repost", (ev) => {
    if (ev.byId !== state.me.id || scope !== "following") return;
    api(`/api/posts/${encodeURIComponent(ev.id)}`).then(({ post }) => {
      list.querySelectorAll(`.post[data-id="${CSS.escape(ev.id)}"]`).forEach((el) => el.remove());
      const card = postCard({ ...post, repostedBy: { name: state.me.name, username: state.me.username, isMe: true } });
      card.classList.add("new");
      list.prepend(card);
    }).catch(() => {});
  });

  load();
  return () => { pager?.stop(); offCreated(); offNew(); offDeleted(); offRepost(); };
}
feedPage.navName = () => "feed";
