// /shorts: vertical videos, one per screen. Scroll or swipe to the next one.
import { h, icon, avatar, count, empty, tick } from "../ui.js";
import { taggedSlot } from "../components/tags.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { actions, trackPlay, trackImpression } from "../components/post.js";
import { profileHref } from "../router.js";
import { followButton } from "./profile.js";
import { postTextEl } from "../components/edit-post.js";

let muted = true;

export function shortsPage(view, _m, params) {
  document.title = "Shorts / Look Blog";
  view.classList.add("column-shorts");
  const reel = h("div", { class: "reel" });
  view.append(reel);

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
    const video = h("video", { src: m.url, poster: m.poster || null, "data-thumb-for": p.id, loop: true, playsInline: true, preload: "metadata", muted: true });
    trackPlay(video, p.id);
    const playIcon = h("span", { class: "reel-paused", hidden: true }, icon("play"));
    // Click: play / pause. Double-click on the left or right half: 5 seconds back / forward.
    let clickTimer = null;
    video.addEventListener("click", () => {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { if (video.paused) { video.play(); playIcon.hidden = true; } else { video.pause(); playIcon.hidden = false; } }, 220);
    });
    video.addEventListener("dblclick", (e) => {
      clearTimeout(clickTimer);
      const r = video.getBoundingClientRect();
      const step = e.clientX - r.left < r.width / 2 ? -5 : 5;
      video.currentTime = Math.max(0, Math.min((video.duration || 1e9) - 0.05, video.currentTime + step));
      (video.closest(".lb-player, .reel-frame") || video.parentElement).querySelectorAll(".lbp-skip").forEach((x) => x.remove());
      const flash = h("div", { class: "lbp-skip " + (step < 0 ? "left" : "right") }, h("span", { class: "skip-ripple" }), h("span", { class: "skip-arrows" }, h("i"), h("i"), h("i")), h("b", { text: "5 seconds" }));
      video.parentElement.append(flash);
      setTimeout(() => flash.remove(), 750);
    });
    const sound = h("button", { class: "reel-sound", "aria-label": "Sound" }, icon(muted ? "mute" : "sound"));
    sound.addEventListener("click", () => {
      muted = !muted;
      reel.querySelectorAll("video").forEach((v) => (v.muted = muted));
      reel.querySelectorAll(".reel-sound").forEach((b) => b.replaceChildren(icon(muted ? "mute" : "sound")));
    });
    // Pink progress bar at the bottom: runs with the video, drag or tap it to move, ⏪ ⏩ to skip 5 seconds
    const fill = h("div", { class: "rp-fill" });
    const knob = h("div", { class: "rp-knob" });
    const timeTip = h("span", { class: "rp-time" });
    const bar = h("div", { class: "reel-progress", role: "slider", "aria-label": "Seek", tabindex: "0" }, h("div", { class: "rp-track" }, fill, knob), timeTip);
    const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    const paintBar = () => {
      const d = video.duration || m.duration || 0;
      const pct = d ? Math.min(100, (video.currentTime / d) * 100) : 0;
      fill.style.width = pct + "%"; knob.style.left = pct + "%";
      timeTip.textContent = d ? `${fmt(video.currentTime)} / ${fmt(d)}` : "";
    };
    video.addEventListener("timeupdate", paintBar);
    video.addEventListener("loadedmetadata", paintBar);
    let raf = null;
    const loop = () => { paintBar(); raf = video.paused ? null : requestAnimationFrame(loop); };
    video.addEventListener("play", () => { if (!raf) raf = requestAnimationFrame(loop); });
    let seeking = false;
    const seekTo = (e) => {
      const r = bar.querySelector(".rp-track").getBoundingClientRect();
      const d = video.duration || m.duration || 0;
      if (!d) return;
      video.currentTime = Math.max(0, Math.min(d - 0.05, ((e.clientX - r.left) / r.width) * d));
      paintBar();
    };
    bar.addEventListener("pointerdown", (e) => { e.stopPropagation(); seeking = true; bar.classList.add("dragging"); bar.setPointerCapture(e.pointerId); seekTo(e); });
    bar.addEventListener("pointermove", (e) => { if (seeking) seekTo(e); });
    const endSeek = () => { seeking = false; bar.classList.remove("dragging"); };
    bar.addEventListener("pointerup", endSeek);
    bar.addEventListener("pointercancel", endSeek);
    bar.addEventListener("click", (e) => e.stopPropagation());
    bar.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { video.currentTime += 5; e.preventDefault(); } if (e.key === "ArrowLeft") { video.currentTime -= 5; e.preventDefault(); } });
    // Timed comments + live reactions (only if the creator turned them on)
    const marks = h("div", { class: "rp-marks" });
    bar.querySelector(".rp-track").append(marks);
    const pops = h("div", { class: "lbp-pops" });
    let tl = { comments: [], moments: [...(p.moments || [])] }, lastT = 0, loadedTl = false;
    const floatE = (e) => { const el = h("span", { class: "lbp-float", text: e }); el.style.left = `${15 + Math.random() * 70}%`; pops.append(el); setTimeout(() => el.remove(), 2400); };
    const paintMarks = () => {
      const d = video.duration || m.duration || 0;
      marks.replaceChildren();
      if (!d) return;
      for (const c of tl.comments) { const mk = h("span", { class: "lbp-mark", style: `left:${(c.at / d) * 100}%`, title: `${c.author.name}: ${c.text}` }); if (c.author.avatar) mk.style.backgroundImage = `url("${c.author.avatar}")`; else mk.textContent = c.author.name[0]; marks.append(mk); }
      const buckets = new Map(); for (const r of tl.moments) { const k = Math.floor((r.at / d) * 100); buckets.set(k, (buckets.get(k) || 0) + 1); }
      const top = Math.max(1, ...buckets.values());
      for (const [k, n] of buckets) marks.append(h("span", { class: "lbp-bump", style: `left:${k}%;height:${4 + (n / top) * 10}px` }));
    };
    if (p.timedComments || p.momentReactions) {
      video.addEventListener("play", async () => {
        if (loadedTl || !p.timedComments) return;
        loadedTl = true;
        try { tl.comments = (await api(`/api/posts/${p.id}`)).comments.filter((c) => c.at != null); paintMarks(); } catch {}
      });
      video.addEventListener("loadedmetadata", paintMarks);
      video.addEventListener("seeked", () => (lastT = video.currentTime));
      video.addEventListener("timeupdate", () => {
        const t = video.currentTime;
        if (t < lastT) lastT = 0; // looped
        if (t - lastT < 2) {
          for (const c of tl.comments) if (c.at > lastT && c.at <= t) { const pop = h("div", { class: "lbp-pop", style: `left:50%;bottom:110px` }, h("b", { text: c.author.name }), h("span", { text: c.text || "🖼️" })); pops.append(pop); setTimeout(() => pop.classList.add("out"), 3000); setTimeout(() => pop.remove(), 3400); }
          for (const r of tl.moments) if (r.at > lastT && r.at <= t) floatE(r.emoji);
        }
        lastT = t;
      });
    }
    const reactRow = p.momentReactions ? h("div", { class: "reel-react", hidden: true }, ...["❤️", "🔥", "😂", "😮", "👏", "😢"].map((e) => h("button", { type: "button", text: e, onclick: (ev) => { ev.stopPropagation(); floatE(e); const at = video.currentTime; tl.moments.push({ at, emoji: e }); paintMarks(); api(`/api/posts/${p.id}/moments`, { method: "POST", body: { emoji: e, at } }).catch(() => {}); } }))) : null;
    const reactBtn = p.momentReactions ? h("button", { class: "reel-sound reel-react-btn", "aria-label": "React at this moment", title: "React at this moment", text: "⚡" }) : null;
    reactBtn?.addEventListener("click", (e) => { e.stopPropagation(); reactRow.hidden = !reactRow.hidden; });
    const skips = h("div", {}, pops, reactBtn, reactRow);
    const href = profileHref(p.author.username);
    return trackImpression(h("section", { class: "reel-item", dataset: { id: p.id } },
      h("div", { class: "reel-frame" },
        video,
        playIcon,
        sound,
        skips,
        bar,
        h("div", { class: "reel-info" },
          h("div", { class: "reel-author" },
            h("a", { href }, avatar(p.author, 36)),
            h("a", { href, class: "name" }, p.author.name, tick(p.author)),
            p.mine ? null : followButton(p.author.username, null, { small: true })
          ),
          postTextEl(p, "reel-caption"),
          taggedSlot(p, "reel-tags")
        )
      ),
      h("div", { class: "reel-rail" }, actions(p, { onDeleted: () => reel.querySelector(`[data-id="${CSS.escape(p.id)}"]`)?.remove() }))
    ), p.id);
  }

  async function more() {
    if (loading || done) return;
    loading = true;
    try {
      const data = await api(`/api/feed?scope=latest&type=short&sort=cool${before ? "&before=" + encodeURIComponent(before) : ""}`);
      if (!before && !data.posts.length) {
        reel.append(empty("No shorts yet.", "Short vertical videos up to 90 seconds show up here. You can post one from your profile."));
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
shortsPage.layout = "full";
