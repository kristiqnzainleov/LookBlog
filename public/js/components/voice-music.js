// Music in a voice channel: everyone in the channel hears the same song at the same moment.
// It's a LookBlog song (an <audio>) or a YouTube video (YouTube's own player, kept tiny).
// The server keeps what's playing, since when, and the volume — anyone in the channel can change any of it.
import { h, toast, spinner, empty } from "../ui.js";
import { api } from "../api.js";
import { djConsole, djVolume } from "./dj.js";

const VOL_KEY = "lb_vc_music_vol";
let volume = 60;
try { volume = Number(localStorage.getItem(VOL_KEY) ?? 60); } catch {}
let current = null;      // what the server says
let deaf = false;
let audio = null, yt = null, ytBox = null, ytReady = null;
let post = null;         // (body) => Promise, set by the voice room
let onChange = () => {};

export function setupMusic({ send, changed }) { post = send; onChange = changed || (() => {}); }
// Who's the DJ right now (the voice room keeps this up to date)
let djNow = null;
export function setDj(d) { djNow = d || null; onChange(); }
export const currentDj = () => djNow;
export const musicState = () => current;
export const musicVolume = () => volume;

function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    document.head.append(h("script", { src: "https://www.youtube.com/iframe_api", async: true }));
  });
  return ytReady;
}
// Where the track is now (with the DJ's speed, and inside the DJ's loop if there is one)
const position = (m) => {
  let p = (m.pausedAt ?? (Date.now() - m.startedAt - (m.skew || 0)) * (m.rate || 1)) / 1000;
  if (m.loop && p > m.loop.start) p = m.loop.start + ((p - m.loop.start) % m.loop.len);
  return Math.max(0, p);
};
// The DJ's fades: 1 = full, 0 = silent (on top of the volume, which stays the same from song to song)
let fadeMul = 1, fadeAnim = null;
const level = () => (deaf ? 0 : Math.round((current?.volume ?? volume) * fadeMul));
// Deck B: the next song, while the DJ crossfades into it (x: 0 = only deck A, 1 = only deck B)
let deckB = null; // { id, yt, box, audio }
const mixX = () => current?.mix?.x || 0;
function applyVols() {
  // The DJ's mixer: crossfader between the decks, and each deck's channel fader
  const lv = current?.levels || { a: 1, b: 1 };
  const a = level() * (1 - mixX()) * (lv.a ?? 1), b = level() * mixX() * (lv.b ?? 1);
  if (audio) audio.volume = Math.max(0, Math.min(1, a / 100));
  try { yt?.setVolume(Math.round(a)); } catch {}
  if (deckB?.audio) deckB.audio.volume = Math.max(0, Math.min(1, b / 100));
  try { deckB?.yt?.setVolume(Math.round(b)); } catch {}
}
function dropDeckB() {
  if (!deckB) return;
  try { deckB.yt?.destroy(); } catch {}
  deckB.box?.remove();
  if (deckB.audio) { deckB.audio.pause(); deckB.audio.src = ""; }
  deckB = null;
}
async function syncDeckB(m) {
  const mix = m?.mix;
  if (!mix) return dropDeckB();
  const item = mix.item, pos = () => Math.max(0, (Date.now() - mix.startedAt - (m.skew || 0)) / 1000);
  if (deckB && deckB.id !== item.id) dropDeckB();
  if (!deckB) {
    deckB = { id: item.id };
    if (item.kind === "song") {
      deckB.audio = new Audio(item.url);
      deckB.audio.dataset.voiceMusic = "1";
      deckB.audio.addEventListener("loadedmetadata", () => { if (deckB?.audio) deckB.audio.currentTime = pos(); });
      deckB.audio.play().catch(() => {});
    } else {
      const YT = await loadYT();
      if (!deckB || deckB.id !== item.id) return;
      deckB.box = h("div", { class: "vm-yt deck-b" }, h("div", { class: "vm-yt-head" }, h("span", { text: "🎚 Deck B · " + item.title })), h("div", { id: "vm-ytb-" + item.id }));
      document.body.append(deckB.box);
      const me = deckB;
      me.yt = new YT.Player("vm-ytb-" + item.id, { width: 200, height: 112, videoId: item.ref,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, start: Math.floor(pos()), rel: 0 },
        events: {
          onReady: (e) => { e.target.unMute(); e.target.setVolume(Math.round(level() * mixX())); e.target.seekTo(pos(), true); e.target.playVideo(); },
          // Once it's the main deck, its end moves the queue on
          onStateChange: (e) => { if (e.data === 0 && yt === e.target && current?.now) post?.({ kind: "music", action: "ended", itemId: current.now.id }).catch(() => {}); },
        } });
    }
  }
  applyVols();
}

function fadeTo(target, ms) {
  cancelAnimationFrame(fadeAnim);
  const from = fadeMul, t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    fadeMul = from + (target - from) * k;
    applyVols();
    if (k < 1) fadeAnim = requestAnimationFrame(step);
  };
  step();
}
export const musicFadeOut = (ms = 2500) => fadeTo(0, ms);
export const musicFadeIn = (ms = 2500) => { if (fadeMul > 0.99) { fadeMul = 0; applyVols(); } fadeTo(1, ms); };
// Cut: silence for a moment, then straight back
export function musicCut(ms = 600) { cancelAnimationFrame(fadeAnim); fadeMul = 0; applyVols(); setTimeout(() => { fadeMul = 1; applyVols(); }, ms); }
// Echo out: the music pulses away (like an echo), then comes back a few seconds later
export function musicEcho() {
  cancelAnimationFrame(fadeAnim);
  [0.55, 1, 0.35, 0.7, 0.18, 0.4, 0.06, 0.15, 0].forEach((v, i) => setTimeout(() => { fadeMul = v; applyVols(); }, i * 170));
  setTimeout(() => fadeTo(1, 1500), 4000);
}
// Transform: the music chops on and off in time (like flicking the channel fader)
export function musicTransform() {
  cancelAnimationFrame(fadeAnim);
  for (let i = 0; i < 16; i++) setTimeout(() => { fadeMul = i % 2 ? 0.05 : 1; applyVols(); }, i * 125);
  setTimeout(() => { fadeMul = 1; applyVols(); }, 2000);
}
// Stutter: short stabs of sound that speed up, then back in
export function musicStutter() {
  cancelAnimationFrame(fadeAnim);
  let at = 0, gap = 220, k = 0;
  while (at < 1800) { const on = k++ % 2 === 0; setTimeout(() => { fadeMul = on ? 1 : 0; applyVols(); }, at); at += gap; gap = Math.max(50, gap * 0.85); }
  setTimeout(() => { fadeMul = 1; applyVols(); }, at + 40);
}
// Dip: the music drops low for a moment (for a shout-out or an effect), then comes back
export function musicDip() { fadeTo(0.25, 250); setTimeout(() => fadeTo(1, 900), 2200); }
// How long the song is (for auto-mix)
export function musicDuration() { try { return yt?.getDuration?.() || audio?.duration || current?.now?.duration || 0; } catch { return 0; } }
export const musicPosition = () => (current?.now ? position(current) : 0);
// The DJ's brake: the record slows down and stops
export function musicBrake() {
  try { if (yt) { [0.75, 0.5, 0.25].forEach((r, i) => setTimeout(() => { try { yt.setPlaybackRate(r); } catch {} }, i * 220)); setTimeout(() => { try { yt.pauseVideo(); yt.setPlaybackRate(current?.rate || 1); } catch {} }, 700); } } catch {}
  if (audio) { let r = 1; const iv = setInterval(() => { r -= 0.15; if (r <= 0.25) { clearInterval(iv); audio.pause(); audio.playbackRate = 1; } else audio.playbackRate = r; }, 90); }
}
// Keeping in time with the DJ's loop (the players don't loop on their own)
setInterval(() => {
  const m = current;
  if (!m?.now || !m.loop || m.pausedAt != null) return;
  const want = position(m);
  try {
    if (yt && Math.abs((yt.getCurrentTime?.() || 0) - want) > 0.35) yt.seekTo(want, true);
    if (audio && Math.abs(audio.currentTime - want) > 0.35) audio.currentTime = want;
  } catch {}
}, 200);
// Browsers sometimes block sound until you tap: then "Music in voice" (and the voice bar) show a play button.
// No extra windows.
let tapFn = null;
function needTap(fn) { if (tapFn) return; tapFn = fn; onChange(); }
const clearTap = () => { if (!tapFn) return; tapFn = null; onChange(); };
export const musicNeedsTap = () => Boolean(tapFn);
export function resumeMusic() { const f = tapFn; tapFn = null; f?.(); onChange(); }

function stopAll() {
  clearTap();
  if (audio) { audio.pause(); audio.src = ""; audio = null; }
  if (yt) { try { yt.destroy(); } catch {} yt = null; }
  ytBox?.remove(); ytBox = null;
}

export async function applyMusic(m) {
  const prevId = current?.now?.id;
  if (m) m.skew = m.serverNow ? Date.now() - m.serverNow : 0;
  current = m;
  onChange();
  if (!m?.now) { dropDeckB(); return stopAll(); }
  const item = m.now, paused = m.pausedAt != null;
  if (item.id !== prevId) {
    if (deckB && deckB.id === item.id && (deckB.yt || deckB.audio)) {
      // The DJ mixed all the way into deck B: it simply carries on as the main deck
      stopAll();
      yt = deckB.yt || null; ytBox = deckB.box || null; audio = deckB.audio || null;
      ytBox?.classList.remove("deck-b");
      if (audio) audio.addEventListener("ended", () => post?.({ kind: "music", action: "ended", itemId: item.id }).catch(() => {}));
      deckB = null;
    } else stopAll();
    if (fadeMul < 1) setTimeout(() => fadeTo(1, 2000), 300); // a new song after the DJ's fade comes back in
  }
  syncDeckB(m);
  if (item.kind === "song") {
    if (!audio) {
      audio = new Audio(item.url);
      audio.dataset.voiceMusic = "1"; // the page's "one thing plays" rule leaves this alone
      audio.addEventListener("ended", () => post?.({ kind: "music", action: "ended", itemId: item.id }).catch(() => {}));
      audio.addEventListener("loadedmetadata", () => { if (current?.now?.id === item.id) audio.currentTime = Math.min(position(current), Math.max(0, audio.duration - 0.5)); });
    }
    applyVols();
    audio.playbackRate = m.rate || 1;
    if (Math.abs(audio.currentTime - position(m)) > 1.5 && audio.readyState > 0) audio.currentTime = position(m);
    if (paused) audio.pause(); else audio.play().then(clearTap).catch(() => needTap(() => audio?.play().catch(() => {})));
    return;
  }
  // YouTube
  const YT = await loadYT();
  if (current?.now?.id !== item.id) return;
  if (!yt) {
    // A small visible player (browsers don't always play hidden ones)
    ytBox = h("div", { class: "vm-yt" }, h("div", { class: "vm-yt-head" }, h("span", { text: "🎧 " + item.title }), h("button", { type: "button", class: "vm-yt-min", title: "Smaller", text: "–", onclick: () => ytBox.classList.toggle("min") })), h("div", { id: "vm-yt-" + item.id }));
    document.body.append(ytBox);
    await new Promise((resolve) => {
      yt = new YT.Player("vm-yt-" + item.id, {
        width: 200, height: 112, videoId: item.ref,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, start: Math.floor(position(m)), rel: 0 },
        events: {
          onReady: (e) => {
            e.target.unMute(); e.target.setVolume(Math.round(level() * (1 - mixX()))); e.target.setPlaybackRate?.(current?.rate || 1); e.target.seekTo(position(current || m), true);
            if (current?.pausedAt == null) e.target.playVideo(); else e.target.pauseVideo();
            // Still not playing a few seconds later = the browser blocked it
            setTimeout(() => { try { if (yt && current?.now?.id === item.id && current.pausedAt == null && ![1, 3].includes(yt.getPlayerState())) needTap(() => { yt.unMute(); yt.playVideo(); }); } catch {} }, 3500);
            resolve();
          },
          onStateChange: (e) => { if (e.data === YT.PlayerState.PLAYING) clearTap(); if (e.data === YT.PlayerState.ENDED) post?.({ kind: "music", action: "ended", itemId: item.id }).catch(() => {}); },
          onError: () => { toast("This YouTube video can’t be played here — skipping."); post?.({ kind: "music", action: "ended", itemId: item.id }).catch(() => {}); },
        },
      });
    });
    return;
  }
  try {
    applyVols();
    if ((yt.getPlaybackRate?.() || 1) !== (m.rate || 1)) yt.setPlaybackRate(m.rate || 1);
    if (Math.abs((yt.getCurrentTime?.() || 0) - position(m)) > (m.loop ? 0.4 : 2)) yt.seekTo(position(m), true);
    if (paused) yt.pauseVideo(); else yt.playVideo();
  } catch {}
}

export function setMusicVolume(v) {
  volume = Math.max(0, Math.min(100, Math.round(v)));
  try { localStorage.setItem(VOL_KEY, String(volume)); } catch {}
  applyVols();
  djVolume(deaf ? 0 : (current?.volume ?? volume) / 100); // the DJ's effects follow the music volume
}
export function setMusicDeaf(d) { deaf = d; setMusicVolume(volume); }
export function leaveMusic() { current = null; stopAll(); dropDeckB(); }

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ---------- The music panel ---------- */
export function openMusicPanel() {
  const body = h("div", { class: "vm-panel" });
  const send = async (b) => { try { await applyMusic((await post({ kind: "music", ...b })).music); paint(); } catch (err) { toast(err.error || "Couldn’t do that."); } };
  // Paste a YouTube link
  const link = h("input", { type: "url", class: "text-input", placeholder: "Paste a YouTube link…" });
  const playLink = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "▶ Play" });
  const queueLink = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "+ Queue" });
  const go = async (action, b) => { if (!link.value.trim()) return link.focus(); b.disabled = true; await send({ action, url: link.value.trim() }); link.value = ""; b.disabled = false; };
  playLink.addEventListener("click", () => go("play", playLink));
  queueLink.addEventListener("click", () => go("queue", queueLink));
  link.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(current?.now ? "queue" : "play", playLink); } });
  // LookBlog songs
  const search = h("input", { type: "search", class: "text-input", placeholder: "Search songs on LookBlog" });
  const songs = h("div", { class: "song-pick" }, spinner());
  let seq = 0, timer;
  const load = async () => {
    const n = ++seq;
    try {
      const { songs: list } = await api(`/api/songs/search?q=${encodeURIComponent(search.value.trim())}`);
      if (n !== seq) return;
      songs.replaceChildren(...list.slice(0, 20).map((s) => h("div", { class: "sp-row" }, h("div", { class: "sp-cover", style: s.cover ? `background-image:url("${s.cover}")` : "" }),
        h("div", { class: "sp-text" }, h("b", { text: s.title }), h("span", { class: "muted", text: s.artist.name })),
        h("button", { type: "button", class: "btn btn-xs btn-primary", text: "▶", title: "Play now", onclick: () => send({ action: "play", songId: s.id }) }),
        h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "+", title: "Add to queue", onclick: () => send({ action: "queue", songId: s.id }) }))));
      if (!list.length) songs.append(empty("No songs found.", ""));
    } catch {}
  };
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 200); });
  load();
  const vol = h("input", { type: "range", min: 0, max: 100, value: current?.volume ?? 70, class: "vm-vol", "aria-label": "Music volume for everyone" });
  const volLabel = h("span", { class: "vm-vol-n", text: (current?.volume ?? 70) + "%" });
  let volTimer;
  vol.addEventListener("input", () => {
    volLabel.textContent = vol.value + "%";
    if (current) { current.volume = Number(vol.value); setMusicVolume(volume); }
    clearTimeout(volTimer);
    volTimer = setTimeout(() => post({ kind: "music", action: "volume", volume: Number(vol.value) }).catch(() => {}), 150);
  });
  const now = h("div", { class: "vm-now" });
  let tick = null;
  function paint() {
    if (!body.isConnected && tick) { clearInterval(tick); return; }
    const m = current;
    if (document.activeElement !== vol && m) { vol.value = m.volume ?? 70; volLabel.textContent = vol.value + "%"; }
    if (!m?.now) { now.replaceChildren(h("p", { class: "muted", text: "Nothing is playing. Paste a YouTube link or pick a song — everyone in the channel will hear it." })); return; }
    const it = m.now, paused = m.pausedAt != null;
    const pos = h("span", { class: "vm-pos", text: fmt(position(m)) + (it.duration ? " / " + fmt(it.duration) : "") });
    now.replaceChildren(
      h("div", { class: "vm-card" }, h("div", { class: "vm-thumb", style: it.thumb ? `background-image:url("${it.thumb}")` : "" }, it.kind === "youtube" ? h("span", { class: "vm-yt-tag", text: "YouTube" }) : null),
        h("div", { class: "vm-text" }, h("b", { text: it.title }), h("small", { class: "muted", text: `${it.artist ? it.artist + " · " : ""}added by ${it.by}` }), pos)),
      h("div", { class: "vm-ctl" },
        h("button", { type: "button", class: "btn btn-sm btn-primary", text: paused ? "▶ Resume" : "⏸ Pause", onclick: () => send({ action: paused ? "resume" : "pause" }) }),
        h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "⏭ Skip", onclick: () => send({ action: "skip" }) }),
        h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "⏹ Stop", onclick: () => send({ action: "stop" }) })),
      m.queue.length ? h("div", { class: "vm-queue" }, h("b", { text: `Up next (${m.queue.length})` }), ...m.queue.map((q, i) => h("div", { class: "vm-q" }, h("span", { text: `${i + 1}. ${q.title}` }), h("button", { type: "button", class: "lv-unpin", text: "✕", title: "Remove", onclick: () => send({ action: "unqueue", itemId: q.id }) })))) : null);
    if (tapFn) now.prepend(h("button", { type: "button", class: "btn btn-primary btn-full vm-unblock", text: "🔊 Tap to hear the music", onclick: () => { resumeMusic(); paint(); } }));
  }
  paint();
  tick = setInterval(() => { if (!body.isConnected) return clearInterval(tick); const p = body.querySelector(".vm-pos"); if (p && current?.now) p.textContent = fmt(position(current)) + (current.now.duration ? " / " + fmt(current.now.duration) : ""); }, 1000);
  const prevChange = onChange;
  onChange = () => { prevChange(); if (body.isConnected) paint(); };
  // 🎛 DJ Mode: a window in the music window
  const dj = djConsole({ post: (b) => post(b), music: () => current, position: () => (current?.now ? position(current) : 0), duration: () => musicDuration(), dj: () => djNow });
  const djWrap = h("div", { class: "dj-wrap", hidden: !djNow }, dj.el);
  const djBtn = h("button", { type: "button", class: "btn btn-sm dj-toggle" + (djNow ? " on" : ""), text: djNow ? `🎛 DJ Mode · 🎧 @${djNow.username}` : "🎛 DJ Mode" });
  // The controller is wide: keep the window on the screen
  const fit = () => requestAnimationFrame(() => { const w = djWrap.closest(".float-win"); if (!w) return; const r = w.getBoundingClientRect(); if (r.right > innerWidth - 8) w.style.left = Math.max(8, innerWidth - r.width - 8) + "px"; });
  djBtn.addEventListener("click", () => { djWrap.hidden = !djWrap.hidden; djBtn.classList.toggle("open", !djWrap.hidden); if (!djWrap.hidden) dj.paint(); fit(); });
  setTimeout(fit, 50);
  const prevChange2 = onChange;
  onChange = () => { prevChange2(); if (!body.isConnected) return; dj.paint(); djBtn.textContent = djNow ? `🎛 DJ Mode · 🎧 @${djNow.username}` : "🎛 DJ Mode"; djBtn.classList.toggle("on", Boolean(djNow)); };
  body.append(djBtn, djWrap, now,
    h("label", { class: "vm-vol-row" }, h("span", { text: "🔊 Volume for everyone" }), vol, volLabel),
    h("p", { class: "create-hint", text: "Everyone in this voice channel hears the music and anyone can change the song, pause, skip or turn it up." }),
    h("b", { class: "vis-label", text: "YouTube" }), h("div", { class: "invite-row" }, link, playLink, queueLink),
    h("b", { class: "vis-label", text: "Songs on LookBlog" }), search, songs);
  floatWindow("🎧 Music in voice", body, () => { clearInterval(tick); onChange = prevChange; });
}

/* ---------- A window you can drag around (remembers where you left it) ---------- */
let openWin = null;
function floatWindow(title, body, onClose) {
  openWin?.close();
  const POS = "lb_vm_pos";
  const close = () => { win.remove(); openWin = null; onClose?.(); document.removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape" && !document.querySelector(".app-modal")) close(); };
  const head = h("div", { class: "fw-head", title: "Drag to move" }, h("span", { class: "fw-grip", text: "⠿" }), h("b", { text: title }),
    h("button", { type: "button", class: "fw-btn", title: "Smaller", text: "–", onclick: () => win.classList.toggle("min") }),
    h("button", { type: "button", class: "fw-btn", title: "Close", "aria-label": "Close", text: "✕", onclick: () => close() }));
  const win = h("div", { class: "float-win", role: "dialog", "aria-label": title }, head, h("div", { class: "fw-body" }, body));
  document.body.append(win);
  const place = (x, y) => {
    const r = win.getBoundingClientRect();
    x = Math.max(8, Math.min(innerWidth - r.width - 8, x)); y = Math.max(8, Math.min(innerHeight - 60, y));
    win.style.left = x + "px"; win.style.top = y + "px";
    return { x, y };
  };
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(POS) || "null"); } catch {}
  place(saved?.x ?? innerWidth - win.offsetWidth - 24, saved?.y ?? 90);
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".fw-btn")) return;
    const r = win.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
    win.classList.add("dragging");
  });
  head.addEventListener("pointermove", (e) => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
  const stop = () => {
    if (!drag) return;
    drag = null; win.classList.remove("dragging");
    try { localStorage.setItem(POS, JSON.stringify({ x: parseInt(win.style.left), y: parseInt(win.style.top) })); } catch {}
  };
  head.addEventListener("pointerup", stop);
  head.addEventListener("pointercancel", stop);
  document.addEventListener("keydown", esc);
  openWin = { close };
}
