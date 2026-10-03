// Replies under a post. People answer publicly with text, a photo or a video,
// react to replies with emoji, and answer each other in threads (one level deep).
import { h, icon, avatar, timeEl, toast, confirmClick, plural, richText, tick, linkTimes, fmtTime } from "../ui.js";
import { attachMentions } from "./mentions.js";
import { api } from "../api.js";
import { state, on, emit } from "../state.js";
import { profileHref } from "../router.js";
import { createPicker } from "./media-picker.js";
import { createPlayer } from "./player.js";
import { openEmojiPicker, closeEmojiPicker, QUICK } from "./emoji.js";
import { gifButton, closeGifs, openGifs, gifBody } from "./gifs.js";
import { openShareComment } from "./share.js";
import { openSoundPicker, soundChip } from "./sounds.js";
import { openStickers } from "./stickers.js";

function commentMedia(m) {
  if (!m) return null;
  if (m.kind === "image" && m.gif) return h("img", { class: "reply-gif", src: m.url, alt: "GIF", loading: "lazy" });
  if (m.kind === "image" && m.sticker) return h("img", { class: "reply-sticker", src: m.url, alt: "Sticker", loading: "lazy" });
  if (m.kind === "sound") return soundChip(m);
  if (m.kind === "image") {
    const img = h("img", { src: m.url, alt: "", loading: "lazy" });
    if (m.width && m.height) img.style.aspectRatio = `${m.width} / ${m.height}`;
    return h("a", { class: "reply-media", href: m.url, target: "_blank", rel: "noopener" }, img);
  }
  return h("div", { class: "video-reply" }, h("span", { class: "vr-label" }, icon("video"), "Video reply"),
    createPlayer({ src: m.url, poster: m.poster || null, width: m.width, height: m.height, className: "reply-media" }));
}

/* ---------- Reactions ---------- */
async function react(c, emoji, el) {
  try {
    const { reactions } = await api(`/api/comments/${c.id}/react`, { method: "POST", body: { emoji } });
    c.reactions = reactions;
    paintReactions(el, c);
  } catch (err) {
    toast(err.error || "Couldn’t react to that.");
  }
}
function paintHeart(el, c) {
  const slot = el.querySelector(":scope > .reply-body > .comment-actions .creator-heart-slot");
  if (!slot) return;
  const badge = c.creatorHeart && c.creator ? h("span", { class: "creator-heart", title: `💗 Liked by ${c.creator.name} (creator)` }, avatar(c.creator, 22), h("span", { class: "ch-heart", text: "❤" })) : null;
  if (!c.canHeart) return slot.replaceChildren(...(badge ? [badge] : []));
  // The creator: a heart button (shows the badge when on)
  const btn = h("button", { type: "button", class: "creator-heart-btn" + (c.creatorHeart ? " on" : ""), title: c.creatorHeart ? "Remove your heart" : "Heart this reply (Liked by creator)" }, badge || h("span", { class: "ch-outline", text: "♡" }));
  btn.addEventListener("click", async () => {
    try {
      const r = await api(`/api/comments/${c.id}/heart`, { method: "POST", body: { on: !c.creatorHeart } });
      c.creatorHeart = r.creatorHeart; c.creator = r.creatorHeart ? { name: state.me.name, username: state.me.username, avatar: state.me.avatar } : null;
      paintHeart(el, c);
    } catch (err) { toast(err.error || "Couldn’t do that."); }
  });
  slot.replaceChildren(btn);
}
function paintReactions(el, c) {
  const row = el.querySelector(":scope > .reply-body > .comment-actions .reactions");
  row.replaceChildren(...(c.reactions || []).map((r) => {
    const chip = h("button", { type: "button", class: "reaction" + (r.mine ? " mine" : ""), title: r.names.join(", ") + (r.mine ? " (tap to remove yours)" : "") },
      h("span", { class: "reaction-emoji", text: r.emoji }), h("span", { class: "reaction-count", text: String(r.count) }));
    chip.addEventListener("click", () => react(c, r.emoji, el));
    return chip;
  }));
}

/* ---------- One comment ---------- */
function commentEl(c, { onReply, onGif, onRemoved, post }) {
  // "X replied with a video": a card that opens the reply video
  if (c.videoReply) {
    const v = c.videoReply;
    const href = v.gone ? null : v.type === "short" ? `/shorts?id=${v.id}` : `/watch/${v.id}`;
    const note = h("article", { class: "reply vreply-note", dataset: { id: c.id } },
      h("a", { href: profileHref(c.author.username), tabindex: "-1" }, avatar(c.author, 38)),
      h("div", { class: "reply-body" },
        h("div", { class: "post-head" }, h("a", { class: "name", href: profileHref(c.author.username) }, c.author.name, tick(c.author)), h("span", { class: "muted" }, " replied with a video · ", timeEl(c.createdAt))),
        v.gone ? h("p", { class: "muted", text: "That video reply was removed." })
          : h("a", { class: "vreply-card", href }, h("span", { class: "vreply-thumb", style: v.poster ? `background-image:url("${v.poster}")` : "" }, h("span", { text: "▶" })), h("span", { class: "vreply-text" }, h("b", { text: v.title || "Video reply" }), h("small", { class: "muted", text: "🎥 Video reply" + (v.duration ? " · " + fmtTime(v.duration) : "") })))));
    note._comment = c;
    return note;
  }
  const href = profileHref(c.author.username);
  const quick = h("div", { class: "quick-reacts" });
  for (const e of QUICK) {
    const b = h("button", { type: "button", class: "quick-react", text: e, title: `React ${e}` });
    b.addEventListener("click", () => react(c, e, el));
    quick.append(b);
  }
  const more = h("button", { type: "button", class: "tool-icon", "aria-label": "More reactions", title: "React" }, icon("smile"));
  more.addEventListener("click", () => openEmojiPicker(more, (e) => react(c, e, el)));
  const replyBtn = h("button", { type: "button", class: "comment-link" }, icon("replyArrow"), h("span", { text: "Reply" }));
  replyBtn.addEventListener("click", () => onReply(c));

  const gifRep = h("button", { type: "button", class: "comment-link gif-btn", title: "Reply with a GIF" }, h("span", { text: "GIF" }));
  gifRep.addEventListener("click", () => openGifs(gifRep, (g) => onGif(g, c)));

  // Send this reply to someone in Messages
  const sendBtn = h("button", { type: "button", class: "comment-link", title: "Send in a chat" }, icon("send"), h("span", { text: "Send" }));
  sendBtn.addEventListener("click", () => openShareComment(c, post));

  // ❤️ Liked by creator (like YouTube): the creator's photo with a pink heart
  const heartSlot = h("span", { class: "creator-heart-slot" });
  const actions = h("div", { class: "comment-actions" }, h("div", { class: "reactions" }), heartSlot, more, replyBtn, gifRep, sendBtn, quick);

  const el = h("article", { class: "reply" + (c.parentId ? " is-child" : ""), dataset: { id: c.id } },
    h("a", { href, tabindex: "-1" }, avatar(c.author, c.parentId ? 32 : 38)),
    h("div", { class: "reply-body" },
      h("div", { class: "post-head" },
        h("a", { class: "name", href }, c.author.name, tick(c.author)),
        c.stars ? h("span", { class: "review-stars", title: `${c.stars} out of 5`, text: "★".repeat(c.stars) + "☆".repeat(5 - c.stars) }) : null,
        h("span", { class: "muted handle", text: "@" + c.author.username }),
        h("span", { class: "muted", text: "·" }),
        h("span", { class: "muted" }, timeEl(c.createdAt)),
        c.at != null ? h("button", { type: "button", class: "at-badge", title: "Jump to this moment", text: "📍 " + fmtTime(c.at), onclick: () => { const v = document.querySelector(".watch-main video, .lb-player video"); if (v) { v.currentTime = c.at; v.play().catch(() => {}); v.scrollIntoView({ behavior: "smooth", block: "center" }); } } }) : null
      ),
      c.text ? (() => {
        const t = h("p", { class: "post-text" }, richText(c.text, c.mentions));
        // On videos and shorts, "1:23" jumps the player to that moment
        const dur = post?.media?.[0]?.duration;
        if (post && post.type !== "post" && dur) linkTimes(t, (sec) => emit("player:seek", { postId: post.id, seconds: sec }), dur);
        return t;
      })() : null,
      commentMedia(c.media),
      actions
    )
  );
  el._comment = c;
  paintHeart(el, c);
  if (c.canDelete) {
    const del = h("button", { class: "act act-delete reply-delete", "aria-label": "Delete reply" }, icon("trash"));
    confirmClick(del, "Delete?", async () => {
      try {
        await api(`/api/comments/${c.id}`, { method: "DELETE" });
        onRemoved(c);
      } catch (err) {
        toast(err.error || "Couldn’t delete that.");
      }
    });
    el.querySelector(".post-head").append(del);
  }
  paintReactions(el, c);
  return el;
}

/* ---------- The whole section ---------- */
export function commentsSection(post, initial, { getTime, onTimed } = {}) {
  const list = h("div", { class: "replies-list" });
  const heading = h("h2", { class: "section-title", id: "replies" });
  // Sort: newest first (default), oldest first, or top (most reactions and answers)
  let sort = "new";
  try { sort = localStorage.getItem("lb-reply-sort") || "new"; } catch {}
  const sortBar = h("div", { class: "reply-sort", role: "tablist", "aria-label": "Sort replies" });
  const paintSort = () => sortBar.replaceChildren(...[["new", "Newest"], ["old", "Oldest"], ["top", "Top"]].map(([id, label]) => {
    const b = h("button", { type: "button", class: "rs-btn" + (sort === id ? " on" : ""), role: "tab", "aria-selected": String(sort === id), text: label });
    b.addEventListener("click", () => { sort = id; try { localStorage.setItem("lb-reply-sort", id); } catch {} paintSort(); reorder(); });
    return b;
  }));
  const score = (c) => (c.reactions || []).reduce((n, r) => n + r.count, 0);
  function reorder() {
    const all = [...threads.values()];
    const key = (t) => t.el.querySelector(":scope > .reply")._comment;
    all.sort((a, b) => {
      const x = key(a), y = key(b);
      if (sort === "top") return (score(y) + y._answers * 2) - (score(x) + x._answers * 2) || y.createdAt.localeCompare(x.createdAt);
      return sort === "old" ? x.createdAt.localeCompare(y.createdAt) : y.createdAt.localeCompare(x.createdAt);
    });
    list.append(...all.map((t) => t.el));
  }
  // Movies have reviews, everything else has replies
  const setHeading = () => (heading.textContent = post.film ? plural(list.querySelectorAll(".reply").length, "review", "reviews") : plural(list.querySelectorAll(".reply").length, "reply", "replies"));
  const ids = new Set();
  const threads = new Map(); // top comment id -> { el, replies }

  function remove(c) {
    const t = threads.get(c.id);
    const el = t ? t.el : list.querySelector(`.reply[data-id="${CSS.escape(c.id)}"]`);
    if (t) {
      t.el.querySelectorAll(".reply").forEach((r) => ids.delete(r.dataset.id));
      threads.delete(c.id);
      if (replying && (replying.id === c.id || replying.parentId === c.id)) setReplying(null);
    }
    ids.delete(c.id);
    el?.remove();
    setHeading();
  }

  function add(c, { animate = false } = {}) {
    if (ids.has(c.id)) return;
    ids.add(c.id);
    const el = commentEl(c, { onReply: (x) => setReplying(x), onGif: (g, x) => sendGif(g, x), onRemoved: remove, post });
    if (animate) el.classList.add("new");
    if (c.parentId && threads.has(c.parentId)) {
      threads.get(c.parentId).replies.append(el);
      const top = threads.get(c.parentId).el.querySelector(":scope > .reply")._comment;
      top._answers = (top._answers || 0) + 1;
    } else {
      c._answers = 0;
      const replies = h("div", { class: "thread-replies" });
      const thread = h("div", { class: "thread" }, el, replies);
      threads.set(c.id, { el: thread, replies });
      if (animate && sort === "new") list.prepend(thread); else list.append(thread);
    }
    setHeading();
  }
  // Top-level comments first, so their answers have somewhere to go
  initial.filter((c) => !c.parentId).forEach((c) => add(c));
  initial.filter((c) => c.parentId).forEach((c) => add(c));
  setHeading();
  paintSort();
  reorder();

  /* Reply box: sits at the top, or under a thread while answering someone */
  const text = h("textarea", { rows: 1, placeholder: post.film ? "Write a review…" : "Post your reply", "aria-label": post.film ? "Your review" : "Your reply" });
  attachMentions(text);
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-sm", text: post.film ? "Post review" : "Reply", disabled: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const picker = createPicker({ accept: "both", max: 1, onChange: update, onError: showErr });
  function update() {
    submit.disabled = picker.busy() || (!text.value.trim() && !picker.media().length) || [...text.value].length > 1000;
    submit.textContent = picker.busy() ? "Uploading…" : post.film ? "Post review" : "Reply";
  }
  text.addEventListener("input", () => { text.style.height = "auto"; text.style.height = text.scrollHeight + "px"; update(); });

  const replyingBar = h("div", { class: "reply-bar", hidden: true });
  // GIFs send straight away: from the box, or as an answer to one reply
  async function sendGif(g, to = replying) {
    try {
      const { comment } = await api(`/api/posts/${post.id}/comments`, { method: "POST", body: { text: to === replying ? text.value : "", ...gifBody(g), parentId: to?.id || null } });
      add(comment, { animate: true });
      if (to === replying) { text.value = ""; text.style.height = ""; setReplying(null); }
    } catch (ex) { showErr(ex.error || "Couldn’t send the GIF."); toast(ex.error || "Couldn’t send the GIF."); }
  }
  const gifBtn = gifButton((g) => sendGif(g));
  // Timed comments (the creator allowed them): the reply is pinned to the moment you're watching
  let atOn = true;
  const atChip = post.timedComments && getTime ? h("button", { type: "button", class: "at-chip on", title: "Your reply appears on the video at this moment" }) : null;
  const paintAt = () => { if (!atChip) return; atChip.classList.toggle("on", atOn); atChip.textContent = atOn ? `📍 at ${fmtTime(getTime())}` : "📍 not timed"; };
  if (atChip) { atChip.addEventListener("click", () => { atOn = !atOn; paintAt(); }); text.addEventListener("focus", paintAt); setInterval(() => atChip.isConnected && document.activeElement === text && paintAt(), 1000); paintAt(); }
  // Your stickers and your sounds send straight away too
  async function sendExtra(body, what) {
    try {
      const { comment } = await api(`/api/posts/${post.id}/comments`, { method: "POST", body: { text: text.value, ...body, parentId: replying?.id || null } });
      add(comment, { animate: true });
      text.value = ""; text.style.height = ""; setReplying(null);
    } catch (ex) { showErr(ex.error || `Couldn’t send the ${what}.`); }
  }
  const stickerBtn = h("button", { type: "button", class: "tool-btn", title: "Your stickers", "aria-label": "Stickers" }, icon("sticker"));
  stickerBtn.addEventListener("click", () => openStickers(stickerBtn, (st) => sendExtra({ sticker: st.id }, "sticker")));
  const soundBtn = h("button", { type: "button", class: "tool-btn", title: "Your sounds", "aria-label": "Sounds" }, h("span", { class: "tool-emoji", text: "🔊" }));
  soundBtn.addEventListener("click", () => openSoundPicker(soundBtn, { builtin: false, onPick: (b) => sendExtra(b, "sound") }));
  const form = h("form", { class: "composer reply-composer", novalidate: true },
    avatar(state.me, 38),
    h("div", { class: "composer-main" },
      replyingBar,
      text,
      picker.previews,
      h("div", { class: "composer-bar" }, picker.button, gifBtn, stickerBtn, soundBtn, atChip, h("span", { class: "composer-hint", text: atChip ? "Shows up on the video at that moment" : getTime ? "Tip: write a time like 1:23 to point at a moment" : "Reply with text, a photo, a GIF or a video" }), submit),
      err
    )
  );
  const home = h("div", { class: "composer-home" }, form);

  let replying = null;
  function setReplying(c) {
    replying = c;
    if (!c) {
      replyingBar.hidden = true;
      home.append(form);
      text.placeholder = post.film ? "Write a review…" : "Post your reply";
      return;
    }
    const cancel = h("button", { type: "button", class: "tool-icon", "aria-label": "Cancel" }, icon("close"));
    cancel.addEventListener("click", () => { setReplying(null); });
    replyingBar.replaceChildren(icon("replyArrow"), h("div", { class: "rb-text" }, h("b", { text: `Replying to ${c.author.name}` }), h("span", { text: c.text || (c.media ? "Photo or video" : "") })), cancel);
    replyingBar.hidden = false;
    // Move the box under the thread being answered
    const top = threads.get(c.parentId || c.id);
    top?.el.append(form);
    // Tag the person, unless it's me
    if (c.author.username !== state.me.username && !text.value.includes("@" + c.author.username)) {
      text.value = `@${c.author.username} ` + text.value;
      text.dispatchEvent(new Event("input"));
    }
    text.placeholder = `Answer ${c.author.name}`;
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
  }
  text.addEventListener("keydown", (e) => { if (e.key === "Escape" && replying) { e.stopPropagation(); setReplying(null); } });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    showErr("");
    submit.disabled = true;
    submit.textContent = "Replying…";
    try {
      const media = picker.media()[0] || null;
      const at = atChip && atOn && !replying ? getTime() : undefined;
      const { comment } = await api(`/api/posts/${post.id}/comments`, { method: "POST", body: { text: text.value, media, parentId: replying?.id || null, at } });
      add(comment, { animate: true });
      if (comment.at != null) onTimed?.(comment);
      text.value = "";
      text.style.height = "";
      picker.clear();
      setReplying(null);
    } catch (ex) {
      showErr(ex.error || "Couldn’t post your reply.");
    }
    update();
  });

  /* Live updates */
  const offNew = on("comment:new", async (ev) => {
    if (ev.postId !== post.id || ids.has(ev.commentId)) return;
    try { const cm = (await api(`/api/comments/${ev.commentId}`)).comment; add(cm, { animate: true }); if (cm.at != null) onTimed?.(cm); } catch {}
  });
  const offDel = on("comment:deleted", (ev) => {
    if (ev.postId !== post.id) return;
    remove({ id: ev.commentId });
  });
  const offReact = on("comment:reactions", async (ev) => {
    if (ev.postId !== post.id) return;
    const el = list.querySelector(`.reply[data-id="${CSS.escape(ev.commentId)}"]`);
    if (!el) return;
    try {
      const { comment } = await api(`/api/comments/${ev.commentId}`);
      el._comment.reactions = comment.reactions;
      el._comment.creatorHeart = comment.creatorHeart; el._comment.creator = comment.creator;
      paintReactions(el, el._comment);
      paintHeart(el, el._comment);
    } catch {}
  });

  // Replies closed: no box, just a note (old replies stay visible)
  const closedNote = h("p", { class: "replies-closed" });
  const paintClosed = () => {
    const why = post.noReplies;
    closedNote.hidden = !why;
    home.hidden = Boolean(why);
    closedNote.textContent = why === "movie" ? "🎬 Movies don’t have replies." : why === "episode" ? "📺 Series episodes don’t have replies." : why === "live" ? "🔴 Past lives don’t have replies." : why === "off" ? "💬 The author turned replies off." : "";
  };
  paintClosed();
  const offRepliesToggle = on("post:replies", (ev) => { if (ev.id !== post.id) return; if (!el.isConnected) return offRepliesToggle(); post.noReplies = ev.noReplies; paintClosed(); });
  const el = h("section", { class: "replies" }, h("div", { class: "replies-head" }, heading, sortBar), closedNote, home, list);
  // "Reply with a video": jump to the box and open the file picker
  const replyWithVideo = () => { home.append(form); el.scrollIntoView({ behavior: "smooth", block: "start" }); text.focus(); picker.open(); };
  return { el, replyWithVideo, stop: () => { offNew(); offDel(); offReact(); closeEmojiPicker(); closeGifs(); } };
}
