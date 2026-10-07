// A post card (used in every feed), plus reactions and view counting.
import { h, icon, avatar, timeEl, count, duration, toast, confirmClick, spinner, richText, tick } from "../ui.js";
import { openShare } from "./share.js";
import { createPlayer } from "./player.js";
import { visibilityBadge } from "./visibility.js";
import { pollEl } from "./poll.js";
import { chainEl } from "./chain.js";
import { openReport } from "./report.js";
import { makeEditable, postTextEl, editedLabel, liveTitle } from "./edit-post.js";
import { api } from "../api.js";
import { emit, state } from "../state.js";
import { profileHref, postHref } from "../router.js";

export const watchHref = (id) => `/watch/${encodeURIComponent(id)}`;
export const openHref = (p) => (p.type === "video" ? watchHref(p.id) : postHref(p.id));

/* ---------- Where on the site something was seen (for analytics) ---------- */
export function currentSource() {
  const p = location.pathname;
  if (p.startsWith("/feed")) return "feed";
  if (p.startsWith("/shorts")) return "shorts";
  if (p.startsWith("/videos")) return "videos";
  if (p.startsWith("/watch")) return new URLSearchParams(location.search).has("list") ? "playlist" : document.referrer && !document.referrer.startsWith(location.origin) ? "external" : "watch";
  if (p.startsWith("/u/")) return "profile";
  if (p.startsWith("/messages")) return "messages";
  if (p.startsWith("/search")) return "search";
  if (p.startsWith("/playlist")) return "playlist";
  if (p.startsWith("/post")) return "post";
  return "other";
}

/* ---------- Views: a post counts as seen once per person ---------- */
const sent = new Set();
export function sendView(id) {
  if (sent.has(id)) return;
  sent.add(id);
  api(`/api/posts/${id}/view`, { method: "POST", body: { source: currentSource() } }).catch(() => sent.delete(id));
}

/* ---------- Impressions: a card was on screen (batched) ---------- */
const impressed = new Set(), queue = new Set();
let flushTimer = null;
const impObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const id = e.target.dataset.impId;
    if (e.isIntersecting && id && !impressed.has(id)) {
      impressed.add(id);
      queue.add(id);
      impObserver.unobserve(e.target);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        const ids = [...queue];
        queue.clear();
        if (ids.length) api("/api/impressions", { method: "POST", body: { ids } }).catch(() => {});
      }, 2500);
    }
  }
}, { threshold: 0.5 });
export function trackImpression(el, id) {
  if (!id) return el;
  el.dataset.impId = id;
  impObserver.observe(el);
  return el;
}

// Text posts: seen after being on screen for a moment
const timers = new Map();
const seenObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const id = e.target.dataset.id;
    if (e.isIntersecting) {
      if (!timers.has(id)) timers.set(id, setTimeout(() => { sendView(id); seenObserver.unobserve(e.target); }, 1200));
    } else {
      clearTimeout(timers.get(id));
      timers.delete(id);
    }
  }
}, { threshold: 0.6 });
export function trackSeen(el, id) {
  el.dataset.id = id;
  seenObserver.observe(el);
}

// Videos: seen after 2 seconds of playing; also report how they were watched (retention, skips, exit)
export function trackPlay(video, id) {
  let played = 0, last = null;
  const N = 50;
  let session = null;
  const newSession = () => ({ buckets: new Set(), skips: [], seconds: 0, completed: false, source: currentSource(), sent: false });
  const flush = () => {
    if (!session || session.sent || !session.buckets.size) return;
    session.sent = true;
    const d = video.duration;
    fetch(`/api/posts/${id}/watch`, {
      method: "POST", keepalive: true, credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-LookBlog": "1" },
      body: JSON.stringify({ buckets: [...session.buckets], skips: session.skips, seconds: Math.round(session.seconds * 10) / 10, completed: session.completed, exitAt: Number.isFinite(d) && d ? video.currentTime / d : null, source: session.source }),
    }).catch(() => {});
  };
  video.addEventListener("play", () => { if (!session || session.sent) session = newSession(); });
  video.addEventListener("timeupdate", () => {
    const d = video.duration;
    if (last != null && !video.paused) {
      const step = Math.max(0, Math.min(1, video.currentTime - last));
      played += step;
      if (session) session.seconds += step;
    }
    last = video.currentTime;
    if (session && Number.isFinite(d) && d > 0) session.buckets.add(Math.min(N - 1, Math.floor((video.currentTime / d) * N)));
    if (played >= 2) sendView(id);
  });
  let seekFrom = null;
  video.addEventListener("seeking", () => {
    if (seekFrom == null) seekFrom = last;
    last = null;
  });
  video.addEventListener("seeked", () => {
    const d = video.duration;
    if (session && seekFrom != null && Number.isFinite(d) && d > 0 && video.currentTime - seekFrom > 2) session.skips.push(seekFrom / d);
    seekFrom = null;
  });
  video.addEventListener("ended", () => { if (session) { session.completed = true; flush(); } });
  // Leaving the page or the video disappearing ends the session
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.hidden && flush());
  const watchdog = setInterval(() => { if (!video.isConnected) { flush(); clearInterval(watchdog); } }, 2000);
}

/* ---------- "Cool" celebration: shades drop, sparks fly, a little "Cool!" floats up ---------- */
const BITS = ["😎", "✨", "🔥", "✨", "😎", "💫", "✨", "⚡"];
function coolBurst(btn) {
  btn.classList.remove("cool-hit");
  void btn.offsetWidth;
  btn.classList.add("cool-hit");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const r = btn.getBoundingClientRect();
  const layer = h("div", { class: "cool-burst", "aria-hidden": "true" });
  layer.style.left = r.left + r.width / 2 + "px";
  layer.style.top = r.top + r.height / 2 + "px";

  // Sparks and emoji flying out in a ring
  const n = 12;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 46 + Math.random() * 34;
    const isEmoji = i % 3 === 0;
    const bit = h("span", { class: isEmoji ? "cb-emoji" : "cb-spark", text: isEmoji ? BITS[i % BITS.length] : "" });
    bit.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    bit.style.setProperty("--dy", Math.sin(angle) * dist - 10 + "px");
    bit.style.setProperty("--rot", (Math.random() * 120 - 60) + "deg");
    bit.style.setProperty("--delay", Math.random() * 60 + "ms");
    if (!isEmoji) bit.style.background = ["var(--pink)", "#ffd84d", "var(--paper)"][i % 3];
    layer.append(bit);
  }
  layer.append(h("span", { class: "cb-ring" }), h("span", { class: "cb-word", text: "Cool!" }));
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1100);
}

/* ---------- Reactions bar ---------- */
function stat(p, name, iconName, label) {
  return [icon(iconName), h("span", { class: "stat-num", dataset: { postId: p.id, stat: name }, text: count(p[name]) }), h("span", { class: "sr-only", text: label })];
}

export function actions(p, { onDeleted, big = false } = {}) {
  const like = h("button", { class: "act act-like", "aria-label": "Like" }, stat(p, "likes", "like", " likes"));
  const dislike = h("button", { class: "act act-dislike", "aria-label": "Dislike" }, stat(p, "dislikes", "dislike", " dislikes"));

  const paint = () => {
    like.classList.toggle("on", p.reaction === "like");
    dislike.classList.toggle("on", p.reaction === "dislike");
    like.setAttribute("aria-pressed", String(p.reaction === "like"));
    dislike.setAttribute("aria-pressed", String(p.reaction === "dislike"));
    like.querySelector(".stat-num").textContent = count(p.likes);
    dislike.querySelector(".stat-num").textContent = count(p.dislikes);
  };

  async function react(kind, btn) {
    const before = { reaction: p.reaction, likes: p.likes, dislikes: p.dislikes };
    const next = p.reaction === kind ? null : kind;
    // Update right away, then confirm with the server
    if (p.reaction === "like") p.likes--;
    if (p.reaction === "dislike") p.dislikes--;
    if (next === "like") p.likes++;
    if (next === "dislike") p.dislikes++;
    p.reaction = next;
    paint();
    if (next) { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); }
    try {
      const r = await api(`/api/posts/${p.id}/react`, { method: "POST", body: { reaction: next || "none" } });
      Object.assign(p, { reaction: r.reaction, likes: r.likes, dislikes: r.dislikes });
    } catch (err) {
      Object.assign(p, before);
      toast(err.error || "Couldn’t save that. Try again.");
    }
    paint();
  }
  like.addEventListener("click", (e) => { e.stopPropagation(); react("like", like); });
  dislike.addEventListener("click", (e) => { e.stopPropagation(); react("dislike", dislike); });
  paint();

  /* Cool: pushes the post up in Cool rankings */
  const cool = h("button", { class: "act act-cool", "aria-label": "Cool" }, icon("cool"), h("span", { class: "cool-word", text: "Cool" }), h("span", { class: "stat-num", dataset: { postId: p.id, stat: "cools" }, text: count(p.cools || 0) }));
  const paintCool = () => {
    cool.classList.toggle("on", Boolean(p.cooled));
    cool.setAttribute("aria-pressed", String(Boolean(p.cooled)));
    cool.querySelector(".stat-num").textContent = count(p.cools || 0);
  };
  cool.addEventListener("click", async (e) => {
    e.stopPropagation();
    const before = { cooled: p.cooled, cools: p.cools };
    p.cooled = !p.cooled;
    p.cools = (p.cools || 0) + (p.cooled ? 1 : -1);
    paintCool();
    if (p.cooled) coolBurst(cool);
    try {
      const r = await api(`/api/posts/${p.id}/cool`, { method: "POST", body: { cool: p.cooled } });
      Object.assign(p, { cooled: r.cooled, cools: r.cools });
    } catch (err) {
      Object.assign(p, before);
      toast(err.error || "Couldn’t save that. Try again.");
    }
    paintCool();
  });
  paintCool();

  const share = h("button", { class: "act act-share", "aria-label": "Share", title: "Shares — share a link or send it in a chat" }, stat(p, "shares", "share", " shares"));
  share.addEventListener("click", (e) => { e.stopPropagation(); openShare(p); });

  /* Repost: share it with the people who follow you */
  const repost = h("button", { class: "act act-repost", "aria-label": "Repost" }, stat(p, "reposts", "repost", " reposts"));
  const paintRepost = () => {
    repost.classList.toggle("on", Boolean(p.reposted));
    repost.setAttribute("aria-pressed", String(Boolean(p.reposted)));
    repost.setAttribute("aria-label", p.reposted ? "Undo repost" : "Repost");
    repost.querySelector(".stat-num").textContent = count(p.reposts || 0);
  };
  repost.addEventListener("click", async (e) => {
    e.stopPropagation();
    const before = { reposted: p.reposted, reposts: p.reposts };
    p.reposted = !p.reposted;
    p.reposts = (p.reposts || 0) + (p.reposted ? 1 : -1);
    paintRepost();
  if (p.visibility && p.visibility !== "public") repost.hidden = true; // only public things can be reposted
    if (p.reposted) { repost.classList.remove("pop"); void repost.offsetWidth; repost.classList.add("pop"); }
    try {
      const r = await api(`/api/posts/${p.id}/repost`, { method: "POST", body: { repost: p.reposted } });
      Object.assign(p, { reposted: r.reposted, reposts: r.reposts });
      toast(r.reposted ? "Reposted" : "Repost removed");
    } catch (err) {
      Object.assign(p, before);
      toast(err.error || "Couldn’t repost that. Try again.");
    }
    paintRepost();
  });
  paintRepost();

  const comments = h("a", { class: "act act-comment" + (p.noReplies ? " closed" : ""), href: openHref(p) + "#replies", "aria-label": "Reply", title: p.noReplies ? (p.noReplies === "off" ? "Replies are turned off" : "No replies on " + (p.noReplies === "movie" ? "movies" : p.noReplies === "episode" ? "series episodes" : "past lives")) : "Reply" },
    stat(p, "comments", "comment", p.film ? " reviews" : " replies"), p.noReplies ? null : h("span", { class: "act-label act-reply-label", text: p.film ? "Reviews" : "Reply" }));
  const views = h("span", { class: "act act-views", title: "Views" }, stat(p, "views", "eye", " views"));

  // Movies: no likes or dislikes — stars, reviews, views
  const starsChip = p.film ? h("span", { class: "act act-stars", title: p.stars?.count ? `${p.stars.avg} out of 5 · ${p.stars.count} rating${p.stars.count === 1 ? "" : "s"}` : "No ratings yet" }, h("b", { text: "★ " + (p.stars?.count ? p.stars.avg.toFixed(1) : "–") }), h("span", { class: "muted", text: p.stars?.count ? ` (${p.stars.count})` : "" })) : null;
  const bar = p.film
    ? h("div", { class: "post-actions" + (big ? " big" : "") }, starsChip, comments, share, views)
    : h("div", { class: "post-actions" + (big ? " big" : "") }, cool, like, dislike, repost, comments, share, views);
  // Double-tap on the post likes it (and never takes a like back)
  if (!p.film) bar.likeOnce = () => { if (p.reaction !== "like") react("like", like); };
  if (!p.mine) {
    const rep = h("button", { class: "act act-report", "aria-label": "Report", title: `Report this ${p.stream ? "past live" : p.type === "video" ? "video" : p.type === "short" ? "short" : "post"}` }, icon("flag"), h("span", { class: "act-label", text: "Report" }));
    rep.addEventListener("click", (e) => { e.stopPropagation(); openReport(p); });
    bar.append(rep);
  }
  // The author can turn replies off and on (not for movies, episodes or past lives — those never have replies)
  if (p.mine && (!p.noReplies || p.noReplies === "off")) {
    const tog = h("button", { class: "act act-replies-toggle", title: "Turn replies on or off" });
    const paintTog = () => tog.replaceChildren(h("span", { text: p.noReplies ? "💬 Replies off" : "💬 Replies on" }));
    paintTog();
    tog.addEventListener("click", async (e) => {
      e.stopPropagation();
      try { const r = await api(`/api/posts/${p.id}/replies`, { method: "POST", body: { on: Boolean(p.noReplies) } }); p.noReplies = r.post.noReplies; paintTog(); emit("post:replies", { id: p.id, noReplies: p.noReplies }); toast(p.noReplies ? "Replies are off." : "Replies are on."); }
      catch (err) { toast(err.error || "Couldn’t change it."); }
    });
    bar.append(tog);
  }
  // Creator: timed comments / live reactions on or off
  if (p.mine && p.type !== "post") {
    const opt = (key, on, off) => {
      const b = h("button", { class: "act act-opt", title: "Click to change" });
      const paintB = () => b.replaceChildren(h("span", { text: p[key] ? on : off }));
      paintB();
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        try { const r = await api(`/api/posts/${p.id}/options`, { method: "POST", body: { [key]: !p[key] } }); Object.assign(p, { [key]: r.post[key] }); paintB(); toast(p[key] ? "Turned on — reload the video to see it." : "Turned off."); }
        catch (err) { toast(err.error || "Couldn’t change it."); }
      });
      return b;
    };
    bar.append(opt("timedComments", "🕒 Timed comments on", "🕒 Timed comments off"), opt("momentReactions", "⚡ Reactions on", "⚡ Reactions off"));
  }
  if (p.mine && !p.repostedBy && !p.publishAt) bar.append(pinButton(p));
  if (p.mine) {
    const del = h("button", { class: "act act-delete", "aria-label": "Delete" }, icon("trash"));
    confirmClick(del, "Delete?", async () => {
      try {
        await api(`/api/posts/${p.id}`, { method: "DELETE" });
        toast("Deleted.");
        onDeleted?.(p);
      } catch (err) {
        toast(err.error || "Couldn’t delete that.");
      }
    });
    bar.append(del);
  }
  return bar;
}

/* ---------- Media ---------- */
export function videoPlayer(m, p, { vertical = false, autoplay = false, onTheater = null } = {}) {
  const player = createPlayer({ src: m.url, poster: m.poster || null, width: m.width, height: m.height, vertical, autoplay, thumbFor: p ? p.id : null,
    sources: m.renditions || [], tracks: p?.subtitles || [], onTheater, clip: m.clip || null, knownDuration: m.duration || null,
    onReport: p && !p.mine ? () => openReport(p) : null });
  if (p) trackPlay(player.video, p.id);
  return player;
}

function imageGrid(images) {
  const grid = h("div", { class: `media-grid n${images.length}` });
  for (const m of images) {
    const img = h("img", { src: m.url, alt: "", loading: "lazy", decoding: "async" });
    if (images.length === 1 && m.width && m.height) img.style.aspectRatio = `${m.width} / ${m.height}`;
    grid.append(h("a", { href: m.url, target: "_blank", rel: "noopener", class: "media-cell" }, img));
  }
  return grid;
}

export function mediaBlock(p) {
  const images = p.media.filter((m) => m.kind === "image");
  const video = p.media.find((m) => m.kind === "video");
  const block = images.length ? imageGrid(images) : video ? videoPlayer(video, p, { vertical: p.type === "short" }) : null;
  const kind = warnKind(p);
  return block && kind ? nsfwWrap(block, "post", kind) : block;
}
// Should this be covered for me? "nsfw" (18+), "sensitive" (violence, blood, weapons…) or nothing
export function warnKind(p) {
  if (!p || p.mine) return null;
  if (p.nsfw && !state.me?.showNsfw) return "nsfw";
  if (p.sensitive && !state.me?.showSensitive) return "sensitive";
  return null;
}
// Covered media (blurred, with a button to see it), unless you turned that off in Settings
export function nsfwWrap(block, what = "post", kind = "nsfw") {
  if (kind === "nsfw" ? state.me?.showNsfw : state.me?.showSensitive) return block;
  const wrap = h("div", { class: "nsfw-wrap" }, block);
  nsfwCover(wrap, { what, kind });
  return wrap;
}
// The cover itself, on any box (a player, a short): covered until you tap "View"; videos wait until then
export function nsfwCover(box, { what = "post", kind = "nsfw", onReveal = null } = {}) {
  box.classList.add("nsfw-on");
  if (kind === "sensitive") box.classList.add("sens");
  const v = box.querySelector("video");
  if (v) { v.autoplay = false; v.dataset.nsfwHold = "1"; v.pause(); }
  const cover = h("div", { class: "nsfw-cover" + (kind === "sensitive" ? " sens" : "") },
    h("b", { text: kind === "sensitive" ? "⚠️ Sensitive content" : "🔞 Sensitive content (18+)" }),
    h("span", { text: kind === "sensitive" ? `This ${what} may show violence, blood, weapons or other disturbing things.` : `This ${what} may show nudity or other 18+ things.` }),
    h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "View" }));
  cover.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    box.classList.remove("nsfw-on", "sens"); cover.remove();
    if (v) delete v.dataset.nsfwHold;
    onReveal?.();
  });
  box.append(cover);
  return true;
}

/* ---------- The card ---------- */
import { taggedSlot } from "./tags.js";
import { linkBlock } from "./links.js";

// Pin my post / short / video to the top of my profile (up to 3 of each)
export function pinButton(p, { cls = "act act-pin", onChange } = {}) {
  const b = h("button", { type: "button", class: cls + (p.pinned ? " on" : ""), title: p.pinned ? "Unpin from your profile" : "Pin to your profile", "aria-label": p.pinned ? "Unpin" : "Pin to profile" }, h("span", { text: "📌" }), cls.includes("act") ? h("span", { class: "act-label", text: p.pinned ? "Pinned" : "Pin" }) : null);
  b.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    try {
      const r = await api(`/api/posts/${p.id}/pin`, { method: "POST", body: { pin: !p.pinned } });
      p.pinned = r.pinned;
      b.classList.toggle("on", p.pinned); b.title = p.pinned ? "Unpin from your profile" : "Pin to your profile";
      const l = b.querySelector(".act-label"); if (l) l.textContent = p.pinned ? "Pinned" : "Pin";
      toast(p.pinned ? "📌 Pinned to the top of your profile." : "Unpinned.");
      onChange?.(p.pinned);
    } catch (err) { toast(err.error || "Couldn’t pin it."); }
  });
  return b;
}
export function postCard(p, { onDeleted, onProfile = false } = {}) {
  const href = profileHref(p.author.username);
  const typeBadge = p.type === "short" ? h("span", { class: "badge", text: "Short" }) : p.stream ? h("span", { class: "badge badge-live", text: "🔴 Past live" }) : p.type === "video" ? h("span", { class: "badge", text: "Video" }) : null;

  let body;
  const warn = warnKind(p);
  if (p.type === "video") {
    const v = p.media[0];
    body = h("a", { class: "video-card", href: watchHref(p.id) },
      h("div", { class: "thumb" },
        v.poster ? h("img", { src: v.poster, alt: "", loading: "lazy", "data-thumb-for": p.id }) : h("div", { class: "thumb-empty" }, icon("play")),
        v.duration ? h("span", { class: "thumb-time", text: duration(v.duration) }) : null,
        h("span", { class: "thumb-play" }, icon("play"))
      ),
      liveTitle(p, "h3", "video-title"),
    );
    if (warn) { const th = body.querySelector(".thumb"); th.classList.add("nsfw-on"); th.append(h("span", { class: "nsfw-thumb-tag", text: warn === "nsfw" ? "🔞 18+" : "⚠️ Sensitive" })); }
  } else {
    const textEl = makeEditable(postTextEl(p, "post-text", { placeholder: p.type === "short" ? "Add a caption" : "Add some text" }), p);
    // A post that's only words (no photo) and was found sensitive: the words are covered too
    body = [p.chain ? null : warn && !p.media.length ? nsfwWrap(textEl, "post", warn) : textEl, p.poll ? pollEl(p) : null, p.chain ? chainEl(p) : null, mediaBlock(p),
      p.type === "post" && !p.media.length && !p.poll && !p.chain ? linkBlock(p.text) : null];
  }

  // "Mila reposted" above posts that show up because someone shared them
  const repostLine = p.repostedBy
    ? h("a", { class: "repost-line", href: profileHref(p.repostedBy.username) },
        icon("repost"), p.repostedBy.isMe ? "You reposted" : `${p.repostedBy.name} reposted`)
    : null;

  const pinLine = onProfile && p.pinned && !p.repostedBy ? h("div", { class: "repost-line pin-line" }, h("span", { text: "📌" }), "Pinned") : null;
  const card = h("article", { class: "post" + (p.repostedBy ? " is-repost" : "") + (pinLine ? " is-pinned" : ""), dataset: { id: p.id } },
    repostLine, pinLine,
    h("a", { href, class: "post-avatar", tabindex: "-1" }, avatar(p.author, 42)),
    h("div", { class: "post-body" },
      h("div", { class: "post-head" },
        h("a", { class: "name", href }, p.author.name, tick(p.author)),
        h("span", { class: "muted handle", text: "@" + p.author.username }),
        h("span", { class: "muted", text: "·" }),
        h("a", { class: "muted time", href: openHref(p) }, timeEl(p.createdAt)),
        editedLabel(p),
        typeBadge,
        visibilityBadge(p),
        p.category ? h("a", { class: "cat-chip", href: `${profileHref(p.author.username)}?category=${encodeURIComponent(p.category.id)}`, text: p.category.name }) : null
      ),
      body,
      taggedSlot(p),
      actions(p, { onDeleted: (x) => { card.remove(); onDeleted?.(x); } })
    )
  );
  if (p.type === "post" && !p.media.some((m) => m.kind === "video")) trackSeen(card, p.id);
  trackImpression(card, p.id);
  return card;
}

/* ---------- Infinite list helper: loads pages as you scroll ---------- */
export function pagedList({ container, load, render, emptyEl }) {
  let before = null, loading = false, done = false, first = true;
  const sentinel = h("div", { class: "sentinel" });
  const io = new IntersectionObserver((e) => e[0].isIntersecting && more(), { rootMargin: "800px" });

  async function more() {
    if (loading || done) return;
    loading = true;
    const spin = spinner();
    container.after(spin);
    try {
      const data = await load(before);
      if (first && !data.posts.length) container.append(emptyEl());
      for (const p of data.posts) container.append(render(p));
      before = data.nextBefore;
      done = !before;
    } catch (err) {
      container.append(h("p", { class: "list-error", text: err.error || "Couldn’t load more." }));
      done = true;
    }
    spin.remove();
    first = false;
    loading = false;
    if (done) io.disconnect();
  }
  container.after(sentinel);
  io.observe(sentinel);
  more(); // first page right away
  return { stop: () => { io.disconnect(); sentinel.remove(); } };
}

/* ---------- "For you": recommended posts, page by page ---------- */
export function recommendedLoader(type = null) {
  const shown = new Set();
  return async () => {
    const r = await api(`/api/recommend?limit=12${type ? "&type=" + type : ""}&skip=${[...shown].join(",")}`);
    r.posts.forEach((p) => shown.add(p.id));
    return { posts: r.posts, nextBefore: r.posts.length === 12 ? "more" : null };
  };
}
// The little "why you see this" line
export function withReason(el, p) {
  if (!p.reason) return el;
  const why = h("p", { class: "why-line", text: "✨ " + p.reason });
  (el.querySelector(".post-head") || el.querySelector(".tile-text h3") || el.firstChild)?.after(why);
  return el;
}

/* ---------- Double-tap a post to like it (like Instagram) ---------- */
// Buttons, links, fields and video players keep their own double-click.
const NO_TAP = "button, a, input, textarea, select, video, audio, .lb-player, .post-actions, .poll, .replies, .comments, .composer, [contenteditable]";
export function likeBurst(x, y) {
  const el = h("span", { class: "like-burst", style: `left:${x}px;top:${y}px` }, "❤️");
  document.body.append(el);
  setTimeout(() => el.remove(), 900);
}
function tapLike(e) {
  if (e.target.closest?.(NO_TAP)) return false;
  const host = e.target.closest?.(".post, .detail");
  const bar = host && [...host.querySelectorAll(".post-actions")].find((b) => b.likeOnce && b.closest(".post, .detail") === host);
  if (!bar) return false;
  bar.likeOnce();
  likeBurst(e.clientX, e.clientY);
  window.getSelection?.().removeAllRanges();
  return true;
}
let lastTap = { t: 0, x: 0, y: 0 }, touchLikedAt = 0;
// Phones: two quick taps in the same spot
document.addEventListener("pointerup", (e) => {
  if (e.pointerType !== "touch") return;
  const now = Date.now();
  if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
    if (tapLike(e)) touchLikedAt = now;
    lastTap = { t: 0, x: 0, y: 0 };
  } else lastTap = { t: now, x: e.clientX, y: e.clientY };
});
// Computers: double-click
document.addEventListener("dblclick", (e) => { if (Date.now() - touchLikedAt > 600) tapLike(e); });
