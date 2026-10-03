// A post card (used in every feed), plus reactions and view counting.
import { h, icon, avatar, timeEl, count, duration, toast, confirmClick, spinner } from "../ui.js";
import { api } from "../api.js";
import { profileHref, postHref } from "../router.js";

/* ---------- Views: a post counts as seen once per person ---------- */
const sent = new Set();
export function sendView(id) {
  if (sent.has(id)) return;
  sent.add(id);
  api(`/api/posts/${id}/view`, { method: "POST" }).catch(() => sent.delete(id));
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

// Videos: seen after 2 seconds of playing
export function trackPlay(video, id) {
  let played = 0, last = null;
  video.addEventListener("timeupdate", () => {
    if (last != null && !video.paused) played += Math.max(0, Math.min(1, video.currentTime - last));
    last = video.currentTime;
    if (played >= 2) sendView(id);
  });
  video.addEventListener("seeking", () => (last = null));
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
    if (p.reposted) { repost.classList.remove("pop"); void repost.offsetWidth; repost.classList.add("pop"); }
    try {
      const r = await api(`/api/posts/${p.id}/repost`, { method: "POST", body: { repost: p.reposted } });
      Object.assign(p, { reposted: r.reposted, reposts: r.reposts });
      toast(r.reposted ? "Reposted. Your followers will see it." : "Repost removed.");
    } catch (err) {
      Object.assign(p, before);
      toast(err.error || "Couldn’t repost that. Try again.");
    }
    paintRepost();
  });
  paintRepost();

  const comments = h("a", { class: "act act-comment", href: postHref(p.id) + "#replies", "aria-label": "Replies" }, stat(p, "comments", "comment", " replies"));
  const views = h("span", { class: "act act-views", title: "Views" }, stat(p, "views", "eye", " views"));

  const bar = h("div", { class: "post-actions" + (big ? " big" : "") }, like, dislike, repost, comments, views);
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
export function videoPlayer(m, p, { vertical = false, autoplay = false } = {}) {
  const v = h("video", {
    class: "player" + (vertical ? " vertical" : ""),
    src: m.url,
    poster: m.poster || null,
    controls: true,
    playsInline: true,
    preload: "metadata",
    autoplay,
  });
  if (m.width && m.height) v.style.aspectRatio = `${m.width} / ${m.height}`;
  if (p) trackPlay(v, p.id);
  return v;
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
  if (images.length) return imageGrid(images);
  if (video) return videoPlayer(video, p, { vertical: p.type === "short" });
  return null;
}

/* ---------- The card ---------- */
export function postCard(p, { onDeleted } = {}) {
  const href = profileHref(p.author.username);
  const typeBadge = p.type === "short" ? h("span", { class: "badge", text: "Short" }) : p.type === "video" ? h("span", { class: "badge", text: "Video" }) : null;

  let body;
  if (p.type === "video") {
    const v = p.media[0];
    body = h("a", { class: "video-card", href: postHref(p.id) },
      h("div", { class: "thumb" },
        v.poster ? h("img", { src: v.poster, alt: "", loading: "lazy" }) : h("div", { class: "thumb-empty" }, icon("play")),
        v.duration ? h("span", { class: "thumb-time", text: duration(v.duration) }) : null,
        h("span", { class: "thumb-play" }, icon("play"))
      ),
      h("h3", { class: "video-title", text: p.title }),
    );
  } else {
    body = [p.text ? h("p", { class: "post-text", text: p.text }) : null, mediaBlock(p)];
  }

  // "Mila reposted" above posts that show up because someone shared them
  const repostLine = p.repostedBy
    ? h("a", { class: "repost-line", href: profileHref(p.repostedBy.username) },
        icon("repost"), p.repostedBy.isMe ? "You reposted" : `${p.repostedBy.name} reposted`)
    : null;

  const card = h("article", { class: "post" + (p.repostedBy ? " is-repost" : ""), dataset: { id: p.id } },
    repostLine,
    h("a", { href, class: "post-avatar", tabindex: "-1" }, avatar(p.author, 42)),
    h("div", { class: "post-body" },
      h("div", { class: "post-head" },
        h("a", { class: "name", href, text: p.author.name }),
        h("span", { class: "muted handle", text: "@" + p.author.username }),
        h("span", { class: "muted", text: "·" }),
        h("a", { class: "muted time", href: postHref(p.id) }, timeEl(p.createdAt)),
        typeBadge
      ),
      body,
      actions(p, { onDeleted: (x) => { card.remove(); onDeleted?.(x); } })
    )
  );
  if (p.type === "post" && !p.media.some((m) => m.kind === "video")) trackSeen(card, p.id);
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
