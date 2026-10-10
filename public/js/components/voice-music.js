// Music in a voice channel: everyone in the channel hears the same song at the same moment.
// It's a LookBlog song (an <audio>) or a YouTube video (YouTube's own player, kept tiny).
// The server keeps what's playing, since when, and the volume — anyone in the channel can change any of it.
import { h, toast, spinner, empty } from "../ui.js";
import { api } from "../api.js";
import { djConsole, djVolume, audioEngine, setBassBoost, beatOn } from "./dj.js";

const VOL_KEY = "lb_vc_music_vol";
let volume = 60;
try { volume = Number(localStorage.getItem(VOL_KEY) ?? 60); } catch {}
let current = null;      // what the server says
let deaf = false;
let audio = null, yt = null, ytBox = null, ytReady = null;
let post = null;         // (body) => Promise, set by the voice room
let onChange = () => {};

const onLocal = (fn) => { const f = () => fn(); addEventListener("lb-local-music", f); return () => removeEventListener("lb-local-music", f); };
let localApi = null; // music from my computer (the voice room streams it)
export function setupMusic({ send, changed, local }) { post = send; onChange = changed || (() => {}); localApi = local || null; }
// Who's the DJ right now (the voice room keeps this up to date)
let djNow = null;
export function setDj(d) { djNow = d || null; onChange(); paintBass(); }
export const currentDj = () => djNow;
export const musicState = () => current;
export const musicVolume = () => volume;
// My own music volume (0–100): only for me, on top of the channel's volume. Nobody else hears a difference.
const MY_KEY = "lb_vc_my_music_vol";
let mine = 100, mineMuted = false;
try { const v = localStorage.getItem(MY_KEY); if (v != null) mine = Math.max(0, Math.min(100, Number(v) || 0)); mineMuted = localStorage.getItem(MY_KEY + "_m") === "1"; } catch {}
const myMul = () => (mineMuted ? 0 : mine / 100);
export const myMusicVolume = () => ({ volume: mine, muted: mineMuted });
export function setMyMusicVolume(v, muted = mineMuted) {
  mine = Math.max(0, Math.min(100, Math.round(v))); mineMuted = Boolean(muted);
  try { localStorage.setItem(MY_KEY, String(mine)); localStorage.setItem(MY_KEY + "_m", mineMuted ? "1" : "0"); } catch {}
  setMusicVolume(volume);
  dispatchEvent(new Event("lb-my-music-vol"));
}

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
const level = () => (deaf ? 0 : Math.round((current?.volume ?? volume) * fadeMul * myMul()));
// Deck B: the next song, while the DJ crossfades into it (x: 0 = only deck A, 1 = only deck B)
let deckB = null; // { id, yt, box, audio }
const mixX = () => current?.mix?.x || 0;
// Bass boost: LookBlog songs (MP3s) go through a low-end boost in the browser. YouTube doesn't let a page touch
// its sound, so there the beat channel's kicks get a sub-bass instead. Either way the screen shakes with it.
// The song's own effects chain (LookBlog songs; YouTube doesn't let a page touch its sound).
// Each deck: 3-band EQ and a filter. Then for the whole song: bass boost, flanger, phaser, drive, bit-crush,
// echo and reverb, and a limiter so nothing clips. Everyone's browser builds the same chain from the same settings.
const chains = new WeakMap();
const FX0 = { a: { low: 0, mid: 0, high: 0, filter: 0 }, b: { low: 0, mid: 0, high: 0, filter: 0 }, echo: 0, verb: 0, flanger: 0, phaser: 0, crush: 0, drive: 0, wah: 0, gate: 0, keylock: true };
export const songFx = () => ({ ...FX0, ...(current?.fx || {}), a: { ...FX0.a, ...(current?.fx?.a || {}) }, b: { ...FX0.b, ...(current?.fx?.b || {}) } });
const fxActive = (f, deck, amt) => amt > 0.02 || f.echo || f.verb || f.flanger || f.phaser || f.crush || f.drive || f.wah || f.gate || Object.values(f[deck]).some((v) => Math.abs(v) > 0.01);
function chainFor(el) {
  let ch = chains.get(el);
  if (ch) return ch;
  const c = audioEngine(); if (!c) return null; // (not until the page's sound has started, or the song would go quiet)
  try {
    const node = (type, props = {}) => { const f = c.createBiquadFilter(); f.type = type; for (const [k, v] of Object.entries(props)) f[k].value = v; return f; };
    const src = c.createMediaElementSource(el);
    const low = node("lowshelf", { frequency: 250 }), mid = node("peaking", { frequency: 1000, Q: 0.8 }), high = node("highshelf", { frequency: 4000 }), filt = node("allpass");
    const shelf = node("lowshelf", { frequency: 110 }), sub = node("peaking", { frequency: 55, Q: 1.1 });
    const sum = c.createGain(), drive = c.createWaveShaper(), crush = c.createWaveShaper(), out = c.createGain(), lim = c.createDynamicsCompressor();
    lim.threshold.value = -6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
    // Auto-wah: a sharp peak that sweeps up and down in time
    const wah = node("peaking", { frequency: 1000, Q: 5 }), wahLfo = c.createOscillator(), wahDepth = c.createGain();
    wah.gain.value = 0; wahLfo.frequency.value = 1; wahDepth.gain.value = 0; wahLfo.connect(wahDepth); wahDepth.connect(wah.frequency); wahLfo.start();
    src.connect(low); low.connect(mid); mid.connect(high); high.connect(filt); filt.connect(wah); wah.connect(shelf); shelf.connect(sub); sub.connect(sum);
    // Flanger: a tiny delay that sweeps, mixed back in
    const fl = c.createDelay(0.05), flLfo = c.createOscillator(), flDepth = c.createGain(), flMix = c.createGain(), flFb = c.createGain();
    fl.delayTime.value = 0.004; flLfo.frequency.value = 0.25; flDepth.gain.value = 0.003; flMix.gain.value = 0; flFb.gain.value = 0.5;
    flLfo.connect(flDepth); flDepth.connect(fl.delayTime); flLfo.start(); sub.connect(fl); fl.connect(flFb); flFb.connect(fl); fl.connect(flMix); flMix.connect(sum);
    // Phaser: four sweeping all-pass filters, mixed back in
    const phLfo = c.createOscillator(), phDepth = c.createGain(), phMix = c.createGain();
    phLfo.frequency.value = 0.4; phDepth.gain.value = 600; phMix.gain.value = 0; phLfo.connect(phDepth); phLfo.start();
    let prev = sub;
    for (let k = 0; k < 4; k++) { const ap = node("allpass", { frequency: 700 + k * 300, Q: 0.6 }); phDepth.connect(ap.frequency); prev.connect(ap); prev = ap; }
    prev.connect(phMix); phMix.connect(sum);
    // Trance gate: the song chops on 8th notes
    const gate = c.createGain(), gateLfo = c.createOscillator(), gateDepth = c.createGain();
    gateLfo.type = "square"; gateLfo.frequency.value = 4; gateDepth.gain.value = 0; gateLfo.connect(gateDepth); gateDepth.connect(gate.gain); gateLfo.start();
    sum.connect(drive); drive.connect(crush); crush.connect(gate); gate.connect(out); out.connect(lim); lim.connect(c.destination);
    // Echo and reverb sends
    const dl = c.createDelay(2), fb = c.createGain(), echoOut = c.createGain(), verb = c.createConvolver(), verbOut = c.createGain();
    dl.delayTime.value = 0.375; fb.gain.value = 0.4; echoOut.gain.value = 0; verbOut.gain.value = 0;
    const ir = c.createBuffer(2, c.sampleRate * 2.6, c.sampleRate);
    for (let k = 0; k < 2; k++) { const d = ir.getChannelData(k); for (let n = 0; n < d.length; n++) d[n] = (Math.random() * 2 - 1) * Math.pow(1 - n / d.length, 2.8); }
    verb.buffer = ir;
    out.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(echoOut); echoOut.connect(lim);
    out.connect(verb); verb.connect(verbOut); verbOut.connect(lim);
    ch = { low, mid, high, filt, shelf, sub, drive, crush, flMix, flLfo, flDepth, phMix, phLfo, phDepth, dl, echoOut, verbOut, wah, wahLfo, wahDepth, gate, gateLfo, gateDepth };
    chains.set(el, ch);
    return ch;
  } catch { return null; }
}
const curveCache = new Map();
function shaper(kind, k) {
  const key = kind + Math.round(k * 50);
  if (curveCache.has(key)) return curveCache.get(key);
  const cv = new Float32Array(1024);
  for (let i = 0; i < cv.length; i++) {
    const x = (i / (cv.length - 1)) * 2 - 1;
    if (kind === "drive") { const a = 1 + k * 25; cv[i] = ((1 + a) * x) / (1 + a * Math.abs(x)) * (1 - k * 0.3); }
    else if (kind === "crush") { const steps = Math.round(24 - k * 21); cv[i] = Math.round(x * steps) / steps; }
    else { const kk = (k - 0.5) * 6; cv[i] = Math.tanh(x * (1 + kk)) / Math.tanh(1 + kk); } // bass drive
  }
  curveCache.set(key, cv);
  return cv;
}
function songChain(el, deck, amt) {
  if (!el) return;
  const f = songFx();
  el.preservesPitch = el.mozPreservesPitch = el.webkitPreservesPitch = f.keylock !== false; // KEY LOCK off: faster = higher, like vinyl
  let ch = chains.get(el);
  if (!ch) { if (!fxActive(f, deck, amt)) return; ch = chainFor(el); if (!ch) return; }
  const t = ch.low.context.currentTime, d = f[deck], set = (p, v) => p.setTargetAtTime(v, t, 0.04);
  set(ch.low.gain, d.low); set(ch.mid.gain, d.mid); set(ch.high.gain, d.high);
  if (Math.abs(d.filter) < 0.04) ch.filt.type = "allpass";
  else if (d.filter < 0) { ch.filt.type = "lowpass"; set(ch.filt.frequency, 20000 * Math.pow(0.012, -d.filter)); ch.filt.Q.value = 3; }
  else { ch.filt.type = "highpass"; set(ch.filt.frequency, 20 * Math.pow(200, d.filter)); ch.filt.Q.value = 3; }
  set(ch.shelf.gain, amt * 16); set(ch.sub.gain, amt * 8);
  set(ch.flMix.gain, f.flanger * 0.8); set(ch.flDepth.gain, 0.002 + f.flanger * 0.003);
  set(ch.phMix.gain, f.phaser * 0.9); set(ch.phLfo.frequency, 0.2 + f.phaser * 0.8);
  const bpm = beatOn()?.bpm || 124; set(ch.dl.delayTime, Math.min(1.5, (60 / bpm) * 0.75));
  set(ch.wah.gain, f.wah * 18); set(ch.wahDepth.gain, f.wah * 900); set(ch.wahLfo.frequency, bpm / 60 / 2);
  set(ch.gate.gain, 1 - f.gate / 2); set(ch.gateDepth.gain, f.gate / 2); set(ch.gateLfo.frequency, (bpm / 60) * 2);
  set(ch.echoOut.gain, f.echo * 0.8); set(ch.verbOut.gain, f.verb * 1.3);
  ch.drive.curve = f.drive > 0.02 ? shaper("drive", f.drive) : amt > 0.5 ? shaper("bass", amt) : null;
  ch.crush.curve = f.crush > 0.02 ? shaper("crush", f.crush) : null;
}
let bassStyle = null;
function paintBass() {
  const amt = current?.now && current.pausedAt == null && !deaf ? current.bass || 0 : 0;
  setBassBoost(amt);
  songChain(audio, "a", amt); songChain(deckB?.audio, "b", amt);
  const on = amt > 0.02;
  document.body.classList.toggle("bass-boost", on);
  document.body.style.setProperty("--bass", String(amt));
  document.body.style.setProperty("--beat", (60 / (beatOn()?.bpm || 120)).toFixed(3) + "s");
  // Whoever is playing it (the DJ, or whoever put the song on): their name shakes
  const who = on ? djNow?.username || current.now.byUsername || "" : "";
  if (!bassStyle) { bassStyle = document.createElement("style"); bassStyle.id = "bass-style"; document.head.append(bassStyle); }
  const u = who.replace(/["\\]/g, "");
  bassStyle.textContent = u ? `body.bass-boost .vc-person[data-voice-user="${u}"] .vc-name, body.bass-boost .msg[data-author="${u}"] .bubble-name, body.bass-boost [data-bass-name="${u}"] { display: inline-block; animation: bass-vibe 0.08s linear infinite; color: var(--pink); text-shadow: 0 0 calc(var(--bass) * 12px) var(--pink); }` : "";
}
function applyVols() {
  // The DJ's mixer: crossfader between the decks, and each deck's channel fader
  const lv = current?.levels || { a: 1, b: 1 };
  const a = level() * (1 - mixX()) * (lv.a ?? 1), b = level() * mixX() * (lv.b ?? 1);
  if (audio) audio.volume = Math.max(0, Math.min(1, a / 100));
  try { yt?.setVolume(Math.round(a)); } catch {}
  if (deckB?.audio) deckB.audio.volume = Math.max(0, Math.min(1, b / 100));
  try { deckB?.yt?.setVolume(Math.round(b)); } catch {}
  paintBass();
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
      deckB.audio = new Audio(); deckB.audio.crossOrigin = "anonymous"; deckB.audio.src = item.url;
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
// Trance gate: the music chops on and off on every 16th note, for 2 bars
export function musicGate(bpm = 124) {
  cancelAnimationFrame(fadeAnim);
  const s16 = 60000 / bpm / 4;
  for (let i = 0; i < 32; i++) setTimeout(() => { fadeMul = i % 2 ? 0.08 : 1; applyVols(); }, i * s16);
  setTimeout(() => { fadeMul = 1; applyVols(); }, 32 * s16);
}
// Sidechain pump: the music ducks on every beat and swells back (like a kick pushing it), for 2 bars
export function musicPump(bpm = 124) {
  cancelAnimationFrame(fadeAnim);
  const beatMs = 60000 / bpm, t0 = performance.now(), end = beatMs * 8;
  const step = () => {
    const el = performance.now() - t0;
    if (el >= end) { fadeMul = 1; applyVols(); return; }
    const ph = (el % beatMs) / beatMs;
    fadeMul = 0.15 + 0.85 * Math.min(1, ph * 1.6) ** 2;
    applyVols(); fadeAnim = requestAnimationFrame(step);
  };
  step();
}
// Tremolo: the volume wobbles fast for a few seconds
export function musicTremolo() {
  cancelAnimationFrame(fadeAnim);
  const t0 = performance.now();
  const step = () => { const el = performance.now() - t0; if (el > 4000) { fadeMul = 1; applyVols(); return; } fadeMul = 0.55 + 0.45 * Math.sin(el / 1000 * 2 * Math.PI * 7); applyVols(); fadeAnim = requestAnimationFrame(step); };
  step();
}
// Swell: quiet, then it grows back up
export function musicSwell() { cancelAnimationFrame(fadeAnim); fadeMul = 0.1; applyVols(); fadeTo(1, 4000); }
// Blackout: total silence for one bar, then everything back at once
export function musicBlackout(bpm = 124) { musicCut(60000 / bpm * 4); }
// Half volume (tap again to bring it back)
export function musicHalf() { cancelAnimationFrame(fadeAnim); fadeTo(fadeMul > 0.75 ? 0.5 : 1, 400); }
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
  queueMicrotask(paintBass);
  if (audio) { audio.pause(); audio.src = ""; audio = null; }
  if (yt) { try { yt.destroy(); } catch {} yt = null; }
  ytBox?.remove(); ytBox = null;
}

export async function applyMusic(m) {
  const prevId = current?.now?.id;
  if (m) m.skew = m.serverNow ? Date.now() - m.serverNow : 0;
  current = m;
  onChange();
  paintBass();
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
      audio = new Audio(); audio.crossOrigin = "anonymous"; audio.src = item.url;
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
  djVolume(deaf ? 0 : ((current?.volume ?? volume) / 100) * myMul()); // the DJ's effects follow the music volume (and mine)
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
  // 💻 From my computer: MP3, WAV… streamed to the channel live (nothing is uploaded or saved)
  const lfile = h("input", { type: "file", accept: "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus", multiple: true, hidden: true });
  const lpick = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "💻 Choose songs from your computer" });
  lpick.addEventListener("click", () => lfile.click());
  lfile.addEventListener("change", () => { const f = [...lfile.files]; lfile.value = ""; if (f.length) localApi?.play(f); });
  const lnow = h("div", { class: "vm-local-now" });
  const lvol = h("input", { type: "range", min: 0, max: 100, value: Math.round((localApi?.getVolume?.() ?? 0.8) * 100), class: "vm-vol", "aria-label": "Volume of your music" });
  lvol.addEventListener("input", () => localApi?.volume(Number(lvol.value) / 100));
  const paintLocal = () => {
    const st = localApi?.state();
    if (!st) { lnow.replaceChildren(); return; }
    lnow.replaceChildren(
      h("div", { class: "vm-card" }, h("div", { class: "vm-thumb vm-thumb-local", text: "💻" }),
        h("div", { class: "vm-text" }, h("b", { text: st.title }), h("small", { class: "muted", text: `From your computer${st.queue.length ? ` · ${st.queue.length} more` : ""}` }), h("span", { class: "vm-pos vm-lpos", text: fmt(st.pos) + (st.dur ? " / " + fmt(st.dur) : "") }))),
      h("div", { class: "vm-ctl" },
        h("button", { type: "button", class: "btn btn-sm btn-primary", text: st.paused ? "▶ Resume" : "⏸ Pause", onclick: () => localApi.pause(!st.paused) }),
        h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "⏭ Next", onclick: () => localApi.next() }),
        h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "⏹ Stop", onclick: () => localApi.stop() })),
      h("label", { class: "vm-vol-row" }, h("span", { text: "🔊 Its volume" }), lvol));
  };
  paintLocal();
  const offLocal = onLocal(() => { if (!body.isConnected) return offLocal(); paintLocal(); });
  const ltick = setInterval(() => { if (!body.isConnected) return clearInterval(ltick); const st = localApi?.state(); const el = body.querySelector(".vm-lpos"); if (st && el) el.textContent = fmt(st.pos) + (st.dur ? " / " + fmt(st.dur) : ""); }, 1000);
  const localBox = localApi ? h("div", { class: "vm-local" }, h("b", { class: "vis-label", text: "💻 From your computer" }),
    h("p", { class: "create-hint", text: "Play MP3, WAV, M4A or FLAC files from your computer. Everyone in the channel hears them live — they're not uploaded or saved anywhere." }),
    lpick, lfile, lnow) : null;
  body.append(djBtn, djWrap, now, localBox,
    h("label", { class: "vm-vol-row" }, h("span", { text: "🔊 Volume for everyone" }), vol, volLabel),
    myVolumeRow(),
    h("p", { class: "create-hint", text: "Everyone in this voice channel hears the music and anyone can change the song, pause, skip or turn it up." }),
    h("b", { class: "vis-label", text: "YouTube" }), h("div", { class: "invite-row" }, link, playLink, queueLink),
    h("b", { class: "vis-label", text: "Songs on LookBlog" }), search, songs);
  floatWindow("🎧 Music in voice", body, () => { clearInterval(tick); onChange = prevChange; });
}

// "My volume": a slider and a mute that only change what I hear
export function myVolumeRow({ compact = false } = {}) {
  const r = h("input", { type: "range", min: 0, max: 100, value: mine, class: "vm-vol vm-myvol", "aria-label": "My music volume (only for me)" });
  const n = h("span", { class: "vm-vol-n", text: mine + "%" });
  const m = h("button", { type: "button", class: "vm-mymute" + (mineMuted ? " on" : ""), title: mineMuted ? "Hear the music again" : "Mute the music just for me", text: mineMuted ? "🔇" : "🎧" });
  const sync = () => { r.value = mine; n.textContent = mineMuted ? "Muted" : mine + "%"; m.textContent = mineMuted ? "🔇" : "🎧"; m.classList.toggle("on", mineMuted); row.classList.toggle("muted", mineMuted); };
  r.addEventListener("input", () => setMyMusicVolume(Number(r.value), false));
  m.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setMyMusicVolume(mine, !mineMuted); });
  const row = h("label", { class: "vm-vol-row vm-my" + (compact ? " compact" : "") }, m, h("span", { text: compact ? "My music" : "My volume (only for me)" }), r, n);
  const on = () => { if (!row.isConnected) return removeEventListener("lb-my-music-vol", on); sync(); };
  addEventListener("lb-my-music-vol", on);
  sync();
  return row;
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
