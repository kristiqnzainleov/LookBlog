// /post/:id — one post, short or video on its own page, with views, reactions and replies.
import { h, icon, avatar, timeEl, empty, count } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { actions, mediaBlock, videoPlayer, sendView } from "../components/post.js";
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
  title.textContent = p.type === "video" ? "Video" : p.type === "short" ? "Short" : "Post";
  document.title = `${p.type === "video" ? p.title : p.author.name + ": " + (p.text || "Post").slice(0, 40)} / Look Blog`;
  const href = profileHref(p.author.username);
  const onDeleted = () => navigate("/feed", { replace: true });

  const authorRow = h("div", { class: "detail-author" },
    h("a", { href }, avatar(p.author, 48)),
    h("div", { class: "who" }, h("a", { href, class: "name", text: p.author.name }), h("span", { class: "muted", text: "@" + p.author.username })),
    p.mine ? null : followButton(p.author.username)
  );
  const viewsLine = h("p", { class: "detail-meta muted" },
    h("span", { dataset: { postId: p.id, stat: "views" }, text: count(p.views) }), p.views === 1 ? " view · " : " views · ", timeEl(p.createdAt),
    " · ", new Date(p.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
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
      p.text ? h("p", { class: "detail-text post-text", text: p.text }) : null,
      mediaBlock(p),
      viewsLine,
      actions(p, { onDeleted, big: true })
    );
    // A text or photo post counts as seen when opened; videos count when played
    if (!p.media.some((x) => x.kind === "video")) sendView(p.id);
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
