// /shorts: vertical videos, one per screen. Scroll or swipe to the next one.
import { h, icon, avatar, count, empty } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { actions, trackPlay } from "../components/post.js";
import { openCreate } from "../components/composer.js";
import { profileHref } from "../router.js";
import { followButton } from "./profile.js";

let muted = true;

export function shortsPage(view, _m, params) {
  document.title = "Shorts / Look Blog";
  view.classList.add("column-shorts");
  const reel = h("div", { class: "reel" });
  const uploadBtn = h("button", { class: "btn btn-primary btn-sm reel-upload" }, icon("plus"), h("span", { text: "Upload" }));
  uploadBtn.addEventListener("click", () => openCreate("short"));
  view.append(h("header", { class: "column-head reel-head" }, h("div", { class: "head-row" }, h("h1", { text: "Shorts" }), uploadBtn)), reel);

  let before = null, loading = false, done = false;
  const startId = params.get("id");

  // Play the short that is on screen, pause the rest
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target.querySelector("video");
      if (e.isIntersecting && e.intersectionRatio > 0.6) {
        v.muted = muted;
        v.play().catch(() => {});
        if (e.target === reel.lastElementChild || e.target === reel.lastElementChild?.previousElementSibling) more();
      } else {
        v.pause();
      }
    }
  }, { root: null, threshold: [0, 0.6, 1] });

  function shortEl(p) {
    const m = p.media[0];
    const video = h("video", { src: m.url, poster: m.poster || null, loop: true, playsInline: true, preload: "metadata", muted: true });
    trackPlay(video, p.id);
    const playIcon = h("span", { class: "reel-paused", hidden: true }, icon("play"));
    video.addEventListener("click", () => {
      if (video.paused) { video.play(); playIcon.hidden = true; } else { video.pause(); playIcon.hidden = false; }
    });
    const sound = h("button", { class: "reel-sound", "aria-label": "Sound" }, icon(muted ? "mute" : "sound"));
    sound.addEventListener("click", () => {
      muted = !muted;
      reel.querySelectorAll("video").forEach((v) => (v.muted = muted));
      reel.querySelectorAll(".reel-sound").forEach((b) => b.replaceChildren(icon(muted ? "mute" : "sound")));
    });
    const href = profileHref(p.author.username);
    return h("section", { class: "reel-item", dataset: { id: p.id } },
      h("div", { class: "reel-frame" },
        video,
        playIcon,
        sound,
        h("div", { class: "reel-info" },
          h("div", { class: "reel-author" },
            h("a", { href }, avatar(p.author, 36)),
            h("a", { href, class: "name", text: p.author.name }),
            p.mine ? null : followButton(p.author.username, null, { small: true })
          ),
          p.text ? h("p", { class: "reel-caption", text: p.text }) : null
        )
      ),
      h("div", { class: "reel-rail" }, actions(p, { onDeleted: () => reel.querySelector(`[data-id="${CSS.escape(p.id)}"]`)?.remove() }))
    );
  }

  async function more() {
    if (loading || done) return;
    loading = true;
    try {
      const data = await api(`/api/feed?scope=latest&type=short${before ? "&before=" + encodeURIComponent(before) : ""}`);
      if (!before && !data.posts.length) {
        reel.append(empty("No shorts yet.", "Short vertical videos up to 90 seconds show up here.",
          h("button", { class: "btn btn-primary btn-sm", text: "Upload a short", onclick: () => openCreate("short") })));
      }
      for (const p of data.posts) {
        const el = shortEl(p);
        reel.append(el);
        io.observe(el);
      }
      before = data.nextBefore;
      done = !before;
    } catch {
      done = true;
    }
    loading = false;
  }

  // Opened from a link to one short: show that one first
  async function openOne() {
    if (startId) {
      try {
        const { post } = await api(`/api/posts/${encodeURIComponent(startId)}`);
        if (post.type === "short") { const el = shortEl(post); reel.append(el); io.observe(el); }
      } catch {}
    }
    await more();
  }
  openOne();

  const offCreated = on("post:created", (p) => {
    if (p.type !== "short") return;
    reel.querySelector(".empty")?.remove();
    const el = shortEl(p);
    reel.prepend(el);
    io.observe(el);
    el.scrollIntoView();
  });

  // Arrow keys move between shorts
  const onKey = (e) => {
    if (e.target.closest("input, textarea")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...reel.querySelectorAll(".reel-item")];
      const i = items.findIndex((el) => el.getBoundingClientRect().top >= -10);
      const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      next?.scrollIntoView({ behavior: "smooth" });
    }
  };
  document.addEventListener("keydown", onKey);

  return () => {
    io.disconnect();
    reel.querySelectorAll("video").forEach((v) => v.pause());
    offCreated();
    document.removeEventListener("keydown", onKey);
  };
}
shortsPage.navName = () => "shorts";
