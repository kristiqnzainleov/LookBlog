// /post/:id — one post, short or video on its own page, with views, reactions and replies.
import { h, icon, avatar, timeEl, empty, count, richText, tick } from "../ui.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { on } from "../state.js";
import { actions, mediaBlock, videoPlayer, sendView, warnKind, nsfwWrap } from "../components/post.js";
import { visibilityButton } from "../components/visibility.js";
import { pollEl } from "../components/poll.js";
import { chainEl } from "../components/chain.js";
import { categorySelect, makeEditable, postTextEl, editedLabel } from "../components/edit-post.js";
import { commentsSection } from "../components/comments.js";
import { profileHref, navigate } from "../router.js";
import { followButton } from "./profile.js";

export async function postPage(view, m) {
  const id = decodeURIComponent(m[1]);
  const back = h("button", { class: "icon-btn", "aria-label": "Back", onclick: () => (history.length > 1 ? history.back() : navigate("/feed")) }, icon("back"));
  const title = h("h1", { text: "Post" });
  view.append(h("header", { class: "column-head" }, h("div", { class: "head-row" }, back, title)));

  let data;
  try {
    data = await api(`/api/posts/${encodeURIComponent(id)}`);
  } catch (err) {
    view.append(empty("This post doesn’t exist anymore.", "It may have been deleted."));
    return;
  }
  const p = data.post;
  if (p.type === "video") return navigate(`/watch/${encodeURIComponent(p.id)}${location.hash}`, { replace: true });
  title.textContent = p.stream ? "Past live stream" : p.type === "video" ? "Video" : p.type === "short" ? "Short" : "Post";
  document.title = `${p.type === "video" ? p.title : p.author.name + ": " + (p.text || "Post").slice(0, 40)} / Look Blog`;
  const href = profileHref(p.author.username);
  const onDeleted = () => navigate("/feed", { replace: true });

  const authorRow = h("div", { class: "detail-author" },
    h("a", { href }, avatar(p.author, 48)),
    h("div", { class: "who" }, h("a", { href, class: "name" }, p.author.name, tick(p.author)), h("span", { class: "muted", text: "@" + p.author.username })),
    p.mine ? null : followButton(p.author.username)
  );
  const viewsLine = h("p", { class: "detail-meta muted" },
    h("span", { dataset: { postId: p.id, stat: "views" }, text: count(p.views) }), p.views === 1 ? " view · " : " views · ", timeEl(p.createdAt),
    " · ", new Date(p.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }), " ", editedLabel(p)
  );

  let main;
  if (p.type === "video") {
    main = h("article", { class: "detail detail-video" },
      videoPlayer(p.media[0], p),
      h("h2", { class: "detail-title", text: p.title }),
      viewsLine,
      authorRow,
      actions(p, { onDeleted, big: true }),
      p.text ? h("p", { class: "detail-description post-text", text: p.text }) : null
    );
  } else {
    main = h("article", { class: "detail" + (p.type === "short" ? " detail-short" : "") },
      authorRow,
      // Words found sensitive (and no photo to cover): the words are covered
      p.chain ? null : ((el) => (warnKind(p) && !p.media.length ? nsfwWrap(el, "post", warnKind(p)) : el))(makeEditable(postTextEl(p, "detail-text post-text", { placeholder: p.type === "short" ? "Add a caption" : "Add some text" }), p)),
      p.poll ? pollEl(p) : null,
      p.chain ? chainEl(p) : null,
      mediaBlock(p),
      viewsLine,
      actions(p, { onDeleted, big: true })
    );
    if (p.mine && p.type === "short") {
      const bar = main.querySelector(".post-actions");
      bar.insertBefore(visibilityButton(p), bar.querySelector(".act-views"));
    { const an = h("a", { class: "act act-analytics", href: `/analytics?post=${p.id}` }, icon("poll"), h("span", { text: "Analytics" })); bar.insertBefore(an, bar.querySelector(".act-views")); }
    if ((state.me.categories || []).length) bar.insertBefore(categorySelect(p), bar.querySelector(".act-views"));
    }
    // A text or photo post counts as seen when opened; videos count when played
    if (!p.media.some((x) => x.kind === "video")) sendView(p.id, { open: true });
  }

  const replies = commentsSection(p, data.comments);
  view.append(main, replies.el);
  if (location.hash === "#replies") replies.el.scrollIntoView();

  const offDeleted = on("post:deleted", (ev) => { if (ev.id === p.id) onDeleted(); });
  return () => {
    replies.stop();
    offDeleted();
    view.querySelectorAll("video").forEach((v) => v.pause());
  };
}
postPage.navName = () => "";
