// Watch together in a voice channel: a YouTube video, YouTube Short or TikTok in a pop-up window,
// in sync for everyone in the channel. Anyone can play, pause or skip; everyone can close it for themselves.
import { h, icon, toast } from "../ui.js";

let win = null; // { el, w, player, send, ... }
let ytReady = null;
function youtubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytReady) ytReady = new Promise((ok) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); ok(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.append(s);
  });
  return ytReady;
}

// Where the video should be right now (the server's clock, so everyone agrees)
const targetOf = (w, skew) => (w.playing ? w.pos + Math.max(0, Date.now() + skew - w.at) / 1000 : w.pos);

export const watchOpen = () => Boolean(win);
export function closeWatch() {
  if (!win) return;
  clearInterval(win.tick);
  removeEventListener("message", win.onMsg);
  try { win.yt?.destroy(); } catch {}
  win.el.remove();
  win = null;
}

// Show it (or switch to another video). send(state) tells the channel when I play, pause or skip.
export function openWatch(w, { skew = 0, send, onStop, canStop, gesture = false, onClose } = {}) {
  if (win && win.w.provider === w.provider && win.w.id === w.id) return applyWatch(w, skew);
  closeWatch();
  const tall = w.kind === "short";
  const stage = h("div", { class: "wt-stage" + (tall ? " tall" : "") });
  const soundBtn = h("button", { type: "button", class: "wt-sound", hidden: true }, "🔊 Tap for sound");
  const stopBtn = canStop ? h("button", { type: "button", class: "wt-btn", title: "Stop for everyone", "aria-label": "Stop for everyone", text: "⏹" }) : null;
  const minBtn = h("button", { type: "button", class: "wt-btn", title: "Make it smaller", "aria-label": "Make it smaller", text: "▁" });
  const closeBtn = h("button", { type: "button", class: "wt-btn", title: "Close for me", "aria-label": "Close for me" }, icon("close"));
  const head = h("div", { class: "wt-head" },
    h("span", { class: "wt-live" }, h("span", { class: "wt-dot" }), "Watching together"),
    h("span", { class: "wt-who", text: `${w.provider === "tiktok" ? "TikTok" : tall ? "YouTube Short" : "YouTube"} · from ${w.byName || "@" + w.by}` }),
    h("div", { class: "wt-tools" }, minBtn, stopBtn, closeBtn));
  const el = h("div", { class: "wt-pop" + (tall ? " tall" : ""), role: "dialog", "aria-label": "Watching together" }, head, stage, soundBtn);
  document.body.append(el);
  win = { el, w: { ...w }, skew, send, applying: 0, lastTime: 0, lastAt: 0, muted: !gesture };

  closeBtn.addEventListener("click", () => { closeWatch(); onClose?.(); });
  stopBtn?.addEventListener("click", () => onStop?.());
  minBtn.addEventListener("click", () => el.classList.toggle("mini"));
  soundBtn.addEventListener("click", () => { win.muted = false; ctl.unmute(); soundBtn.hidden = true; });

  // Drag it around by its top bar
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const x = Math.max(4, Math.min(innerWidth - el.offsetWidth - 4, e.clientX - drag.dx)), y = Math.max(4, Math.min(innerHeight - 60, e.clientY - drag.dy));
    Object.assign(el.style, { left: x + "px", top: y + "px", right: "auto", bottom: "auto" });
  });
  head.addEventListener("pointerup", () => { drag = null; });

  // The players: one way to play, pause, seek, mute and read the time
  const ctl = { play() {}, pause() {}, seek() {}, unmute() {}, time: () => 0, playing: () => false };
  win.ctl = ctl;
  const report = (playing) => {
    if (!win || Date.now() < win.applying) return;
    const pos = ctl.time();
    win.w = { ...win.w, playing, pos, at: Date.now() + win.skew };
    send?.({ playing, pos });
  };

  if (w.provider === "youtube") {
    const holder = h("div");
    stage.append(holder);
    youtubeApi().then(() => {
      if (!win || win.el !== el) return;
      win.yt = new window.YT.Player(holder, {
        videoId: w.id, width: "100%", height: "100%",
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(targetOf(w, skew)), mute: win.muted ? 1 : 0 },
        events: {
          onReady: () => { if (win.muted) soundBtn.hidden = false; applyWatch(win.w, win.skew, true); },
          onStateChange: (e) => { if (e.data === 1) report(true); else if (e.data === 2) report(false); },
        },
      });
      Object.assign(ctl, {
        play: () => win.yt?.playVideo?.(), pause: () => win.yt?.pauseVideo?.(), seek: (t) => win.yt?.seekTo?.(t, true),
        unmute: () => { win.yt?.unMute?.(); win.yt?.setVolume?.(100); }, time: () => win.yt?.getCurrentTime?.() || 0, playing: () => win.yt?.getPlayerState?.() === 1,
      });
    });
  } else {
    // TikTok's embedded player, controlled with messages
    const frame = h("iframe", { class: "wt-frame", allow: "autoplay; fullscreen; encrypted-media; picture-in-picture",
      src: `https://www.tiktok.com/player/v1/${w.id}?autoplay=1&loop=0&rel=0&description=0&music_info=0&controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=1` });
    stage.append(frame);
    let tTime = 0, tPlaying = false;
    const post = (type, value) => frame.contentWindow?.postMessage({ "x-tiktok-player": true, type, ...(value !== undefined ? { value } : {}) }, "*");
    Object.assign(ctl, { play: () => post("play"), pause: () => post("pause"), seek: (t) => post("seekTo", t), unmute: () => post("unMute"), time: () => tTime, playing: () => tPlaying });
    win.onMsg = (e) => {
      if (e.source !== frame.contentWindow || !e.data?.["x-tiktok-player"]) return;
      const d = e.data;
      if (d.type === "onPlayerReady") { if (win.muted) { post("mute"); soundBtn.hidden = false; } applyWatch(win.w, win.skew, true); }
      if (d.type === "onCurrentTime") tTime = Number(d.value?.currentTime ?? d.value) || tTime;
      if (d.type === "onStateChange") { const was = tPlaying; tPlaying = d.value === 1; if (was !== tPlaying) report(tPlaying); }
    };
    addEventListener("message", win.onMsg);
    // If TikTok's controllable player doesn't start (some browsers), use its plain player instead (it plays, but pausing isn't shared)
    let ready = false;
    const was = win.onMsg;
    // "Working" = it actually plays (the time moves), not just that it loaded
    const plain = () => {
      if (win?.el !== el || frame.dataset.plain) return;
      frame.dataset.plain = "1";
      frame.src = `https://www.tiktok.com/embed/v2/${w.id}`;
      soundBtn.hidden = true;
      head.querySelector(".wt-who").textContent += " · plays for everyone";
    };
    win.onMsg = (e) => {
      const d = e.data;
      if (d?.["x-tiktok-player"]) {
        if (d.type === "onPlayerError") return plain();
        if ((d.type === "onStateChange" && d.value === 1) || (d.type === "onCurrentTime" && Number(d.value?.duration) > 0)) ready = true;
      }
      was(e);
    };
    removeEventListener("message", was); addEventListener("message", win.onMsg);
    setTimeout(() => { if (!ready) plain(); }, 8000);
  }

  // Skipping in the player (a jump in time) is told to the others too
  win.tick = setInterval(() => {
    if (!win) return;
    const t = ctl.time(), now = Date.now();
    if (win.lastAt && ctl.playing() && Math.abs(t - (win.lastTime + (now - win.lastAt) / 1000)) > 2.5) report(true);
    win.lastTime = t; win.lastAt = now;
  }, 1000);
}

// Someone played, paused or skipped: catch up
export function applyWatch(w, skew = 0, force = false) {
  if (!win) return;
  win.w = { ...w }; win.skew = skew;
  const c = win.ctl, target = targetOf(w, skew);
  win.applying = Date.now() + 900;
  if (force || Math.abs(c.time() - target) > 1.5) c.seek(target);
  if (w.playing && !c.playing()) c.play();
  if (!w.playing && c.playing()) c.pause();
}

// Pasting a link to start
export function askForVideo(onPick) {
  return import("../ui.js").then(({ modal }) => {
    const input = h("input", { type: "url", class: "text-input", placeholder: "Paste a YouTube, YouTube Shorts or TikTok link", autocomplete: "off" });
    const go = h("button", { type: "button", class: "btn btn-primary btn-full", text: "📺 Watch together" });
    const m = modal({ title: "Watch together", body: h("div", { class: "create-form" },
      h("p", { class: "create-hint", text: "Everyone in the voice channel sees it in a pop-up, in sync. Anyone can pause or skip, and anyone can close it for themselves." }), input, go) });
    const start = async () => {
      if (!input.value.trim()) return input.focus();
      go.disabled = true;
      try { await onPick(input.value.trim()); m.close(); } catch (err) { toast(err.error || "Couldn’t play that link."); go.disabled = false; }
    };
    go.addEventListener("click", start);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
    setTimeout(() => input.focus(), 60);
  });
}
// Links in messages that can be watched together
export const WATCHABLE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/)[\w-]{11}[^\s]*|youtu\.be\/[\w-]{11}[^\s]*|(?:www\.|vm\.|vt\.)?tiktok\.com\/[^\s]+)/i;
