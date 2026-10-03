// Replies under a post. People can answer publicly with text, a photo or a video.
import { h, icon, avatar, timeEl, toast, confirmClick, plural } from "../ui.js";
import { api } from "../api.js";
import { state, on } from "../state.js";
import { profileHref } from "../router.js";
import { createPicker } from "./media-picker.js";

function commentMedia(m) {
  if (!m) return null;
  if (m.kind === "image") {
    const img = h("img", { src: m.url, alt: "", loading: "lazy" });
    if (m.width && m.height) img.style.aspectRatio = `${m.width} / ${m.height}`;
    return h("a", { class: "reply-media", href: m.url, target: "_blank", rel: "noopener" }, img);
  }
  const v = h("video", { class: "reply-media player", src: m.url, poster: m.poster || null, controls: true, playsInline: true, preload: "metadata" });
  if (m.width && m.height) v.style.aspectRatio = `${m.width} / ${m.height}`;
  return v;
}

function commentEl(c, onRemoved) {
  const href = profileHref(c.author.username);
  const el = h("article", { class: "reply", dataset: { id: c.id } },
    h("a", { href, tabindex: "-1" }, avatar(c.author, 38)),
    h("div", { class: "reply-body" },
      h("div", { class: "post-head" },
        h("a", { class: "name", href, text: c.author.name }),
        h("span", { class: "muted handle", text: "@" + c.author.username }),
        h("span", { class: "muted", text: "·" }),
        h("span", { class: "muted" }, timeEl(c.createdAt))
      ),
      c.text ? h("p", { class: "post-text", text: c.text }) : null,
      commentMedia(c.media)
    )
  );
  if (c.canDelete) {
    const del = h("button", { class: "act act-delete reply-delete", "aria-label": "Delete reply" }, icon("trash"));
    confirmClick(del, "Delete?", async () => {
      try {
        await api(`/api/comments/${c.id}`, { method: "DELETE" });
        el.remove();
        onRemoved();
      } catch (err) {
        toast(err.error || "Couldn’t delete that.");
      }
    });
    el.querySelector(".post-head").append(del);
  }
  return el;
}

export function commentsSection(post, initial) {
  const list = h("div", { class: "replies-list" });
  const heading = h("h2", { class: "section-title", id: "replies" });
  const setHeading = () => (heading.textContent = plural(list.children.length, "reply", "replies"));
  const removed = () => setHeading();
  const ids = new Set();

  function add(c, { animate = false } = {}) {
    if (ids.has(c.id)) return;
    ids.add(c.id);
    const el = commentEl(c, removed);
    if (animate) el.classList.add("new");
    list.append(el);
    setHeading();
  }
  initial.forEach((c) => add(c));
  setHeading();

  /* Reply box */
  const text = h("textarea", { rows: 1, placeholder: "Post your reply", "aria-label": "Your reply" });
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-sm", text: "Reply", disabled: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const picker = createPicker({ accept: "both", max: 1, onChange: update, onError: showErr });
  function update() {
    submit.disabled = picker.busy() || (!text.value.trim() && !picker.media().length) || [...text.value].length > 1000;
    submit.textContent = picker.busy() ? "Uploading…" : "Reply";
  }
  text.addEventListener("input", () => { text.style.height = "auto"; text.style.height = text.scrollHeight + "px"; update(); });

  const form = h("form", { class: "composer reply-composer", novalidate: true },
    avatar(state.me, 38),
    h("div", { class: "composer-main" },
      text,
      picker.previews,
      h("div", { class: "composer-bar" }, picker.button, h("span", { class: "composer-hint", text: "Reply with text, a photo or a video" }), submit),
      err
    )
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    showErr("");
    submit.disabled = true;
    submit.textContent = "Replying…";
    try {
      const media = picker.media()[0] || null;
      const { comment } = await api(`/api/posts/${post.id}/comments`, { method: "POST", body: { text: text.value, media } });
      add(comment, { animate: true });
      text.value = "";
      text.style.height = "";
      picker.clear();
    } catch (ex) {
      showErr(ex.error || "Couldn’t post your reply.");
    }
    update();
  });

  /* Live: new replies from other people appear on their own */
  const offNew = on("comment:new", async (ev) => {
    if (ev.postId !== post.id || ids.has(ev.commentId)) return;
    try {
      const { comment } = await api(`/api/comments/${ev.commentId}`);
      add(comment, { animate: true });
    } catch {}
  });
  const offDel = on("comment:deleted", (ev) => {
    if (ev.postId !== post.id) return;
    list.querySelector(`.reply[data-id="${CSS.escape(ev.commentId)}"]`)?.remove();
    ids.delete(ev.commentId);
    setHeading();
  });

  const el = h("section", { class: "replies" }, heading, form, list);
  return { el, stop: () => { offNew(); offDel(); } };
}
