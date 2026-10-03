// /feed: the latest posts, shorts and videos, newest first.
import { h, empty } from "../ui.js";
import { api } from "../api.js";
import { state, on } from "../state.js";
import { postCard, pagedList } from "../components/post.js";
import { inlineComposer } from "../components/composer.js";
import { peopleStrip } from "../components/people.js";

let scope = (() => { try { return localStorage.getItem("lb_scope") === "following" ? "following" : "latest"; } catch { return "latest"; } })();

export function feedPage(view) {
  document.title = "Feed / Look Blog";
  const list = h("div", { class: "feed" });
  const pill = h("button", { class: "new-pill", hidden: true });
  let pager, waiting = 0;

  const tabs = h("div", { class: "tabs", role: "tablist" });
  for (const [s, label] of [["latest", "Latest"], ["following", "Following"]]) {
    const b = h("button", { class: "tab", role: "tab", text: label, dataset: { scope: s } });
    b.addEventListener("click", () => { scope = s; try { localStorage.setItem("lb_scope", s); } catch {} load(); });
    tabs.append(b);
  }

  view.append(
    h("header", { class: "column-head" },
      h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "Feed" }), h("p", { class: "page-sub", text: "Newest first. Nothing boosted, no ads." }))),
      tabs
    ),
    inlineComposer(),
    peopleStrip(),
    pill,
    list
  );

  function load() {
    pager?.stop();
    waiting = 0;
    pill.hidden = true;
    tabs.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.scope === scope);
      t.setAttribute("aria-selected", String(t.dataset.scope === scope));
    });
    list.replaceChildren();
    pager = pagedList({
      container: list,
      load: (before) => api(`/api/feed?scope=${scope}${before ? "&before=" + encodeURIComponent(before) : ""}`),
      render: (p) => postCard(p),
      emptyEl: () => scope === "following"
        ? empty("Your feed is quiet.", "Posts from you and the people you follow show up here. Follow a few people, or look at the latest posts.",
            h("button", { class: "btn btn-primary btn-sm", text: "See latest", onclick: () => tabs.querySelector('[data-scope="latest"]').click() }))
        : empty("Nothing here yet.", "Nobody has posted so far. Write the first post on Look Blog."),
    });
  }

  // My own new posts go straight to the top
  const offCreated = on("post:created", (p) => {
    list.querySelector(".empty")?.remove();
    const card = postCard(p);
    card.classList.add("new");
    list.prepend(card);
  });

  // Other people's new posts: offer a "show new posts" button instead of jumping the page
  const offNew = on("post:new", (ev) => {
    if (ev.authorId === state.me.id) return;
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
