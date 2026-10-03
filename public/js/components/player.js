// LookBlog's own video player: pink progress bar, big play button, speed, volume and fullscreen.
// Click the video to play or pause, double-click it (or press F) for full screen.
import { h, duration as fmt } from "../ui.js";

const SVG = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="m17 9 5 6M22 9l-5 6"/>',
  full: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  exit: '<path d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  cc: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6"/>',
  theater: '<rect x="2" y="6" width="20" height="12" rx="2"/>',
};
function ico(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = SVG[name];
  return s;
}
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;

/*
  createPlayer({ src, poster, width, height, vertical, autoplay, loop, thumbFor, sources, tracks, onTheater })
  sources: smaller copies [{ height, url }] for the Quality menu · tracks: subtitles [{ lang, label, url }]
  onTheater: shows a "theater mode" button (watch page)
  Returns the wrapper element; the <video> is at wrapper.video.
*/
export function createPlayer({ src, poster = null, width, height, vertical = false, autoplay = false, loop = false, thumbFor = null, className = "", sources = [], tracks = [], onTheater = null, clip = null, knownDuration = null, onReport = null, timeline = null }) {
  const video = h("video", { src, poster, playsInline: true, preload: "metadata", autoplay, loop, "data-thumb-for": thumbFor });
  for (const t of tracks) video.append(h("track", { kind: "subtitles", src: t.url, srclang: t.lang, label: t.label }));
  const bigPlay = h("button", { type: "button", class: "lbp-big", "aria-label": "Play" }, ico("play"));

  const fill = h("div", { class: "lbp-fill" });
  const buffered = h("div", { class: "lbp-buffered" });
  const knob = h("div", { class: "lbp-knob" });
  const hoverTime = h("div", { class: "lbp-hover-time" });
  const bar = h("div", { class: "lbp-bar", role: "slider", tabindex: "0", "aria-label": "Seek", "aria-valuemin": "0" }, buffered, fill, knob, hoverTime);

  const playBtn = h("button", { type: "button", class: "lbp-btn", "aria-label": "Play" }, ico("play"));
  const muteBtn = h("button", { type: "button", class: "lbp-btn", "aria-label": "Mute" }, ico("sound"));
  const vol = h("input", { type: "range", class: "lbp-vol", min: "0", max: "1", step: "0.05", value: "1", "aria-label": "Volume" });
  const time = h("span", { class: "lbp-time", text: "0:00" });
  const speedBtn = h("button", { type: "button", class: "lbp-btn lbp-speed", "aria-label": "Speed", text: "1×" });
  const fullBtn = h("button", { type: "button", class: "lbp-btn", "aria-label": "Full screen" }, ico("full"));
  const ccBtn = tracks.length ? h("button", { type: "button", class: "lbp-btn lbp-cc", "aria-label": "Subtitles", title: "Subtitles (c)" }, ico("cc")) : null;
  const gearBtn = h("button", { type: "button", class: "lbp-btn lbp-gear", "aria-label": "Settings", title: "Quality and subtitles" }, ico("gear"));
  // Report, right on the video (not for your own)
  const reportBtn = onReport ? h("button", { type: "button", class: "lbp-btn lbp-report", "aria-label": "Report", title: "Report" }, h("span", { text: "⚑" })) : null;
  reportBtn?.addEventListener("click", (e) => { e.stopPropagation(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); onReport(); });
  const theaterBtn = onTheater ? h("button", { type: "button", class: "lbp-btn", "aria-label": "Theater mode", title: "Theater mode (t)" }, ico("theater")) : null;
  const menu = h("div", { class: "lbp-menu", hidden: true });

  const controls = h("div", { class: "lbp-controls" },
    bar,
    h("div", { class: "lbp-row" }, playBtn, h("div", { class: "lbp-volume" }, muteBtn, vol), time, h("span", { class: "lbp-spacer" }), ccBtn, speedBtn, gearBtn, reportBtn, theaterBtn, fullBtn)
  );
  const wrap = h("div", { class: `player lb-player paused${vertical ? " vertical" : ""} ${className}`.trim(), tabindex: "0" }, video, bigPlay, controls, menu);
  if (width && height) wrap.style.aspectRatio = `${width} / ${height}`;
  wrap.video = video;
  // Let older code call player.pause() / player.play()
  wrap.pause = () => video.pause();
  wrap.play = () => video.play();

  /* Edited in the LookBlog editor: start / end trimmed and parts cut out. The bar and the clock
     show the edited length; the cut parts are skipped while playing. */
  const cuts = clip?.cuts || [];
  const cStart = clip?.start || 0;
  const dur = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : knownDuration || NaN);
  const cEnd = () => (clip?.end != null ? Math.min(clip.end, dur() || clip.end) : dur());
  const toEdited = (t) => (clip ? Math.max(0, t - cStart - cuts.reduce((n, [a, b]) => n + Math.max(0, Math.min(t, b) - a), 0)) : t);
  const editedLength = () => (clip ? toEdited(cEnd()) : dur());
  const toReal = (e) => {
    if (!clip) return e;
    let t = cStart + e;
    for (const [a, b] of cuts) if (t >= a) t += b - a;
    return Math.min(t, cEnd());
  };
  if (clip) {
    video.addEventListener("loadedmetadata", () => { if (video.currentTime < cStart) video.currentTime = cStart; });
    video.addEventListener("timeupdate", () => {
      const t = video.currentTime;
      if (t < cStart - 0.3) { video.currentTime = cStart; return; }
      const cut = cuts.find(([a, b]) => t >= a && t < b - 0.05);
      if (cut) { video.currentTime = cut[1]; return; }
      if (t >= cEnd() - 0.05 && !video.paused) { video.pause(); if (loop) video.currentTime = cStart, video.play().catch(() => {}); else wrap.classList.add("ended"); }
    });
    video.addEventListener("play", () => { if (video.currentTime >= cEnd() - 0.1) video.currentTime = cStart; });
  }

  const toggle = () => (video.paused || video.ended ? video.play().catch(() => {}) : video.pause());
  const paintPlay = () => {
    const ended = video.ended;
    wrap.classList.toggle("paused", video.paused);
    wrap.classList.toggle("ended", ended);
    playBtn.replaceChildren(ico(ended ? "replay" : video.paused ? "play" : "pause"));
    playBtn.setAttribute("aria-label", video.paused ? "Play" : "Pause");
    bigPlay.replaceChildren(ico(ended ? "replay" : "play"));
  };
  const paintTime = () => {
    const d = editedLength();
    const t = toEdited(video.currentTime);
    const pct = Number.isFinite(d) && d > 0 ? (t / d) * 100 : 0;
    fill.style.width = knob.style.left = pct + "%";
    time.textContent = Number.isFinite(d) ? `${fmt(t)} / ${fmt(d)}` : fmt(t);
    bar.setAttribute("aria-valuenow", String(Math.round(t)));
    if (Number.isFinite(d)) bar.setAttribute("aria-valuemax", String(Math.round(d)));
    if (video.buffered.length && Number.isFinite(d) && d > 0) buffered.style.width = (video.buffered.end(video.buffered.length - 1) / d) * 100 + "%";
  };
  const paintSound = () => {
    const muted = video.muted || video.volume === 0;
    muteBtn.replaceChildren(ico(muted ? "mute" : "sound"));
    vol.value = muted ? "0" : String(video.volume);
    vol.style.setProperty("--v", (muted ? 0 : video.volume) * 100 + "%");
  };
  for (const e of ["play", "pause", "ended"]) video.addEventListener(e, () => { paintPlay(); poke(); });
  for (const e of ["timeupdate", "loadedmetadata", "durationchange", "progress", "seeked"]) video.addEventListener(e, paintTime);
  video.addEventListener("volumechange", paintSound);
  video.addEventListener("waiting", () => wrap.classList.add("loading"));
  for (const e of ["playing", "canplay"]) video.addEventListener(e, () => wrap.classList.remove("loading"));

  /* Click = play/pause, double-click = full screen */
  let clickTimer;
  video.addEventListener("click", () => {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(toggle, 200);
  });
  // Double-click on the left / right side: 5 seconds back / forward. In the middle: full screen.
  video.addEventListener("dblclick", (e) => {
    clearTimeout(clickTimer);
    const r = video.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
    if (x < 0.35 || x > 0.65) {
      const step = x < 0.35 ? -5 : 5;
      video.currentTime = Math.max(0, Math.min((video.duration || 1e9) - 0.1, video.currentTime + step));
      (video.closest(".lb-player, .reel-frame") || video.parentElement).querySelectorAll(".lbp-skip").forEach((x) => x.remove());
      const flash = h("div", { class: "lbp-skip " + (step < 0 ? "left" : "right") }, h("span", { class: "skip-ripple" }), h("span", { class: "skip-arrows" }, h("i"), h("i"), h("i")), h("b", { text: "5 seconds" }));
      wrap.append(flash);
      setTimeout(() => flash.remove(), 750);
      return;
    }
    fullscreen();
  });
  bigPlay.addEventListener("click", toggle);
  playBtn.addEventListener("click", toggle);

  /* Seeking */
  const seekTo = (clientX) => {
    const r = bar.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    if (Number.isFinite(editedLength())) video.currentTime = toReal(p * editedLength());
    paintTime();
  };
  bar.addEventListener("pointerdown", (e) => {
    bar.setPointerCapture(e.pointerId);
    wrap.classList.add("seeking");
    seekTo(e.clientX);
    const move = (ev) => seekTo(ev.clientX);
    const up = () => { wrap.classList.remove("seeking"); bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  });
  bar.addEventListener("pointermove", (e) => {
    const r = bar.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (!Number.isFinite(editedLength())) return;
    hoverTime.textContent = fmt(p * editedLength());
    hoverTime.style.left = p * 100 + "%";
  });

  /* Sound */
  muteBtn.addEventListener("click", () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.6; });
  vol.addEventListener("input", () => { video.volume = Number(vol.value); video.muted = video.volume === 0; });

  /* Speed */
  const SPEEDS = [1, 1.25, 1.5, 2, 0.5, 0.75];
  speedBtn.addEventListener("click", () => {
    video.playbackRate = SPEEDS[(SPEEDS.indexOf(video.playbackRate) + 1) % SPEEDS.length];
    speedBtn.textContent = video.playbackRate + "×";
  });

  /* Full screen */
  function fullscreen() {
    if (fsEl()) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {});
    else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iPhone
  }
  fullBtn.addEventListener("click", fullscreen);
  const onFs = () => {
    const on = fsEl() === wrap;
    wrap.classList.toggle("is-full", on);
    fullBtn.replaceChildren(ico(on ? "exit" : "full"));
    fullBtn.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
  };
  document.addEventListener("fullscreenchange", onFs);
  document.addEventListener("webkitfullscreenchange", onFs);

  /* Quality: the original upload plus smaller copies (if the server made them) */
  const shortSide = Math.min(width || 0, height || 0) || null;
  const QUALITIES = [{ height: shortSide || 0, url: src, original: true }, ...sources.filter((s) => s.url && s.height)]
    .sort((a, b) => b.height - a.height);
  const qLabel = (q) => (q.height ? `${q.height}p` : "Original") + (q.height >= 1080 ? " HD" : q.height >= 720 ? " HD" : "");
  let qChoice = "auto";
  try { qChoice = localStorage.getItem("lb-quality") || "auto"; } catch {}
  let currentUrl = src;
  function pickAuto() {
    if (QUALITIES.length < 2) return QUALITIES[0];
    const need = (vertical ? wrap.clientWidth : wrap.clientHeight || 400) * (window.devicePixelRatio || 1);
    const ok = QUALITIES.filter((q) => q.height >= need * 0.8);
    return ok.length ? ok[ok.length - 1] : QUALITIES[0];
  }
  function setQuality(choice, { remember = true } = {}) {
    qChoice = choice;
    if (remember) try { localStorage.setItem("lb-quality", choice); } catch {}
    const q = choice === "auto" ? pickAuto() : QUALITIES.find((x) => String(x.height) === choice) || QUALITIES.find((x) => x.height <= Number(choice)) || QUALITIES[0];
    if (!q || q.url === currentUrl) return paintMenu();
    const t = video.currentTime, playing = !video.paused, rate = video.playbackRate;
    currentUrl = q.url;
    video.src = q.url;
    video.addEventListener("loadedmetadata", () => { video.currentTime = t; video.playbackRate = rate; if (playing) video.play().catch(() => {}); }, { once: true });
    paintMenu();
  }
  if (QUALITIES.length > 1) requestAnimationFrame(() => setQuality(qChoice, { remember: false }));

  /* Subtitles */
  let subOn = -1;
  try { const want = localStorage.getItem("lb-subs"); if (want) subOn = tracks.findIndex((t) => t.lang === want); } catch {}
  function setSubs(i) {
    subOn = i;
    [...video.textTracks].forEach((tt, k) => (tt.mode = k === i ? "showing" : "disabled"));
    try { localStorage.setItem("lb-subs", i >= 0 ? tracks[i].lang : ""); } catch {}
    ccBtn?.classList.toggle("on", i >= 0);
    paintMenu();
  }
  if (tracks.length) video.addEventListener("loadedmetadata", () => setSubs(subOn), { once: true });
  ccBtn?.addEventListener("click", () => setSubs(subOn >= 0 ? -1 : 0));

  /* The settings menu */
  function paintMenu() {
    const option = (label, on, fn) => { const b = h("button", { type: "button", class: "lbp-opt" + (on ? " on" : "") }, h("span", { text: label }), on ? h("span", { text: "✓" }) : null); b.addEventListener("click", fn); return b; };
    const playingQ = QUALITIES.find((q) => q.url === currentUrl);
    menu.replaceChildren(...[
      h("p", { class: "lbp-menu-title", text: "Quality" }),
      option(`Auto${qChoice === "auto" && playingQ ? ` (${qLabel(playingQ).replace(" HD", "")})` : ""}`, qChoice === "auto", () => setQuality("auto")),
      ...QUALITIES.map((q) => option(qLabel(q), qChoice !== "auto" && q.url === currentUrl, () => setQuality(String(q.height)))),
      QUALITIES.length < 2 ? h("p", { class: "lbp-menu-note", text: "Other qualities appear once the video has been processed." }) : null,
      h("p", { class: "lbp-menu-title", text: "Subtitles" }),
      option("Off", subOn < 0, () => setSubs(-1)),
      ...tracks.map((t, i) => option(t.label, subOn === i, () => setSubs(i))),
      tracks.length ? null : h("p", { class: "lbp-menu-note", text: "No subtitles for this video." })].filter(Boolean));
  }
  paintMenu();
  gearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    gearBtn.classList.toggle("on", !menu.hidden);
    if (!menu.hidden) {
      const away = (ev) => { if (!menu.contains(ev.target) && ev.target !== gearBtn) { menu.hidden = true; gearBtn.classList.remove("on"); document.removeEventListener("pointerdown", away); } };
      document.addEventListener("pointerdown", away);
    }
  });

  /* Theater mode (wide player on the watch page) */
  theaterBtn?.addEventListener("click", () => { const on = onTheater(); theaterBtn.classList.toggle("on", on); });
  wrap.setTheater = (on) => theaterBtn?.classList.toggle("on", on);

  /* Keyboard (when the player has focus) */
  wrap.addEventListener("keydown", (e) => {
    if (e.target.closest("input")) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") { e.preventDefault(); toggle(); }
    else if (k === "f") fullscreen();
    else if (k === "t" && theaterBtn) theaterBtn.click();
    else if (k === "c" && ccBtn) ccBtn.click();
    else if (k === "m") video.muted = !video.muted;
    else if (k === "arrowright") video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
    else if (k === "arrowleft") video.currentTime = Math.max(0, video.currentTime - 5);
    else return;
    poke();
  });

  /* Hide the controls while watching; show them when the mouse moves */
  let idle;
  function poke() {
    wrap.classList.remove("idle");
    clearTimeout(idle);
    if (!video.paused) idle = setTimeout(() => wrap.classList.add("idle"), 2400);
  }
  wrap.addEventListener("pointermove", poke);
  wrap.addEventListener("pointerdown", poke);

  paintPlay();
  paintSound();
  paintTime();
  /* Timed comments and live reactions on the timeline (only when the creator turned them on) */
  const marks = h("div", { class: "lbp-marks" });
  bar.append(marks);
  const popLayer = h("div", { class: "lbp-pops" });
  wrap.append(popLayer);
  let tl = timeline, lastT = 0;
  const shownAt = new Map(); // comment id -> when its bubble last showed (no doubles)
  const reactBtn = h("button", { type: "button", class: "lbp-btn lbp-react", title: "React at this moment", hidden: true }, h("span", { text: "⚡" }));
  const reactRow = h("div", { class: "lbp-react-row", hidden: true }, ...["❤️", "🔥", "😂", "😮", "👏", "😢"].map((e) => h("button", { type: "button", text: e, onclick: (ev) => { ev.stopPropagation(); const at = video.currentTime; floatEmoji(e); tl?.onReact?.(e, at); } })));
  reactBtn.addEventListener("click", (e) => { e.stopPropagation(); reactRow.hidden = !reactRow.hidden; });
  controls.querySelector(".lbp-row").insertBefore(reactBtn, controls.querySelector(".lbp-spacer").nextSibling);
  wrap.append(reactRow);
  function floatEmoji(e) {
    const el = h("span", { class: "lbp-float", text: e });
    el.style.left = `${15 + Math.random() * 70}%`;
    popLayer.append(el);
    setTimeout(() => el.remove(), 2400);
  }
  function paintMarks() {
    marks.replaceChildren();
    const d = video.duration || knownDuration || 0;
    if (!tl || !d) return;
    reactBtn.hidden = !tl.onReact;
    for (const c of tl.comments || []) {
      if (!(c.at >= 0)) continue;
      const m = h("span", { class: "lbp-mark", style: `left:${Math.min(100, (c.at / d) * 100)}%`, title: `${c.author.name} · ${fmt(c.at)}: ${c.text}` });
      m.style.backgroundImage = c.author.avatar ? `url("${c.author.avatar}")` : "";
      if (!c.author.avatar) m.textContent = (c.author.name || "?")[0];
      marks.append(m);
    }
    // Reactions: little bumps where people reacted the most
    const buckets = new Map();
    for (const r of tl.moments || []) { const k = Math.floor((r.at / d) * 100); buckets.set(k, (buckets.get(k) || 0) + 1); }
    const top = Math.max(1, ...buckets.values());
    for (const [k, n] of buckets) marks.append(h("span", { class: "lbp-bump", style: `left:${k}%;height:${4 + (n / top) * 10}px` }));
  }
  wrap.setTimeline = (next) => { tl = next; paintMarks(); };
  video.addEventListener("loadedmetadata", paintMarks);
  video.addEventListener("seeked", () => (lastT = video.currentTime));
  video.addEventListener("timeupdate", () => {
    const t = video.currentTime;
    if (tl && t > lastT && t - lastT < 2) {
      for (const c of tl.comments || []) if (c.at > lastT && c.at <= t && !(shownAt.get(c.id) > Date.now() - 4000)) {
        shownAt.set(c.id, Date.now());
        const d = video.duration || 1;
        const pop = h("div", { class: "lbp-pop", style: `left:${Math.min(88, Math.max(4, (c.at / d) * 100))}%` }, h("b", { text: c.author.name }), h("span", { text: c.text || "🖼️" }));
        popLayer.append(pop);
        setTimeout(() => pop.classList.add("out"), 3200);
        setTimeout(() => pop.remove(), 3600);
      }
      for (const r of tl.moments || []) if (r.at > lastT && r.at <= t) floatEmoji(r.emoji);
    }
    lastT = t;
  });
  paintMarks();
  return wrap;
}
