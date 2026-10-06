// DJ mode in a voice channel: one DJ at a time mixes the music that's playing (YouTube or LookBlog songs),
// and everyone in the channel hears it: speed, hot cues, loops, brake, fades into the next song,
// effect pads (airhorn, siren, scratch…) and a drum machine on top. The effects are made right in each
// person's browser at the same moment, so they sound the same for everyone.
import { h, toast } from "../ui.js";
import { api as apiCall, upload } from "../api.js";
import { state } from "../state.js";

let ctx = null, master = null;
// The drum machine has its own channel on the mixer: gain → low / mid / high EQ → filter → level meter
let beatBus = null;
function engine() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
      const gain = ctx.createGain(), low = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), high = ctx.createBiquadFilter(), filter = ctx.createBiquadFilter(), meter = ctx.createAnalyser();
      low.type = "lowshelf"; low.frequency.value = 200; mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.9; high.type = "highshelf"; high.frequency.value = 4000;
      filter.type = "allpass"; meter.fftSize = 256;
      gain.connect(low); low.connect(mid); mid.connect(high); high.connect(filter); filter.connect(meter); meter.connect(master);
      beatBus = { gain, low, mid, high, filter, meter };
      if (pendingMix) setBeatMix(pendingMix);
    } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
addEventListener("pointerdown", () => engine(), { once: true });
let djVol = 0.8;
export const djVolume = (v) => { djVol = Math.max(0, Math.min(1.2, v)); if (master) master.gain.value = djVol; };
// The DJ's own effects (MP3s): played as they are, as loud as the music
export function playCustom(url) { try { const a = new Audio(url); a.volume = Math.min(1, djVol); a.play().catch(() => {}); } catch {} }

const noise = (c, secs) => {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * secs), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
};
function env(c, node, t, a, peak, d, dest = master) { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); node.connect(g); g.connect(dest); return g; }
function osc(c, type, f0, f1, t, dur, peak = 0.3, a = 0.01, dest = master) {
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(c, o, t, a, peak, dur, dest); o.start(t); o.stop(t + a + dur + 0.05); return o;
}
// The beat channel's knobs (everyone hears the same): gain, EQ in dB, filter −1 (low-pass) … 0 (off) … +1 (high-pass)
let pendingMix = null, beatMixNow = { gain: 1, low: 0, mid: 0, high: 0, filter: 0 };
export function setBeatMix(mix) {
  beatMixNow = { ...beatMixNow, ...(mix || {}) };
  if (!beatBus) { pendingMix = beatMixNow; return; }
  const t = ctx.currentTime, b = beatBus, m = beatMixNow;
  b.gain.gain.setTargetAtTime(m.gain, t, 0.03);
  b.low.gain.setTargetAtTime(m.low, t, 0.03); b.mid.gain.setTargetAtTime(m.mid, t, 0.03); b.high.gain.setTargetAtTime(m.high, t, 0.03);
  if (Math.abs(m.filter) < 0.04) b.filter.type = "allpass";
  else if (m.filter < 0) { b.filter.type = "lowpass"; b.filter.frequency.setTargetAtTime(20000 * Math.pow(0.012, -m.filter), t, 0.03); }
  else { b.filter.type = "highpass"; b.filter.frequency.setTargetAtTime(20 * Math.pow(200, m.filter), t, 0.03); }
}
export const beatMix = () => beatMixNow;
// How loud the beat channel is right now (0–1), for its meter
export function beatLevel() {
  if (!beatBus) return 0;
  const a = new Uint8Array(beatBus.meter.fftSize); beatBus.meter.getByteTimeDomainData(a);
  let peak = 0; for (const v of a) peak = Math.max(peak, Math.abs(v - 128) / 128);
  return Math.min(1, peak * 1.6);
}

// The effect pads
const FX = {
  airhorn(c, t) { for (let k = 0; k < 3; k++) for (const f of [466, 470, 932]) osc(c, "sawtooth", f, f * 0.97, t + k * 0.28, 0.22, 0.09, 0.005); },
  horn(c, t) { for (const f of [311, 392, 466]) osc(c, "sawtooth", f, f, t, 0.9, 0.08, 0.03); },
  siren(c, t) {
    const o = c.createOscillator(), lfo = c.createOscillator(), depth = c.createGain();
    o.type = "square"; o.frequency.value = 900; lfo.frequency.value = 3; depth.gain.value = 350;
    lfo.connect(depth); depth.connect(o.frequency); env(c, o, t, 0.05, 0.08, 2.2); o.start(t); lfo.start(t); o.stop(t + 2.4); lfo.stop(t + 2.4);
  },
  scratch(c, t) {
    for (let k = 0; k < 4; k++) {
      const n = noise(c, 0.12), f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 6;
      f.frequency.setValueAtTime(k % 2 ? 2400 : 600, t + k * 0.11); f.frequency.exponentialRampToValueAtTime(k % 2 ? 600 : 2400, t + k * 0.11 + 0.1);
      n.connect(f); env(c, f, t + k * 0.11, 0.005, 0.5, 0.1); n.start(t + k * 0.11);
    }
  },
  laser(c, t) { for (let k = 0; k < 3; k++) osc(c, "square", 2400, 120, t + k * 0.16, 0.15, 0.08, 0.002); },
  riser(c, t) {
    const n = noise(c, 4), f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 3; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(8000, t + 3.8);
    n.connect(f); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 3.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 4); f.connect(g); g.connect(master); n.start(t); n.stop(t + 4);
    osc(c, "sawtooth", 200, 1600, t, 3.9, 0.05, 1.5);
  },
  drop(c, t) { osc(c, "sine", 120, 30, t, 1.4, 0.9, 0.005); const n = noise(c, 0.6), f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900; n.connect(f); env(c, f, t, 0.005, 0.4, 0.5); n.start(t); },
  boom(c, t) { osc(c, "sine", 90, 25, t, 0.9, 1, 0.003); },
  rewind(c, t) { const n = noise(c, 1.2), f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 8; f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(200, t + 1.1); n.connect(f); env(c, f, t, 0.02, 0.6, 1.1); n.start(t); osc(c, "sawtooth", 900, 60, t, 1.1, 0.05); },
  clap(c, t) { for (let k = 0; k < 3; k++) { const n = noise(c, 0.2), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1200; n.connect(f); env(c, f, t + k * 0.012, 0.001, 0.55, 0.12); n.start(t + k * 0.012); } },
  brake(c, t) { osc(c, "sawtooth", 220, 30, t, 0.8, 0.12, 0.01); },
  backspin(c, t) { FX.rewind(c, t); osc(c, "square", 600, 40, t, 0.9, 0.05, 0.01); },
  cheer(c, t) {
    // A crowd: lots of noisy voices rising and falling
    const n = noise(c, 2.6), f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1200; f.Q.value = 0.8;
    n.connect(f); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5); f.connect(g); g.connect(master); n.start(t); n.stop(t + 2.6);
    for (let k = 0; k < 5; k++) osc(c, "triangle", 500 + k * 90, 700 + k * 120, t + k * 0.15, 0.6, 0.03, 0.05);
  },
  whistle(c, t) { osc(c, "sine", 1800, 2600, t, 0.35, 0.18, 0.01); osc(c, "sine", 2600, 1500, t + 0.38, 0.45, 0.15, 0.01); },
  roll(c, t) {
    // A snare roll that speeds up (a build-up)
    let at = t, gap = 0.18;
    while (at < t + 2.4) { const s = noise(c, 0.08), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1800; s.connect(f); env(c, f, at, 0.001, 0.25 + (at - t) * 0.12, 0.06); s.start(at); at += gap; gap = Math.max(0.035, gap * 0.9); }
  },
  zap(c, t) { for (let k = 0; k < 2; k++) osc(c, "sawtooth", 3200, 200, t + k * 0.09, 0.08, 0.1, 0.001); },
  cymbal(c, t) {
    // A reverse cymbal: swells up to the beat
    const n = noise(c, 1.6), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 5000;
    n.connect(f); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6); f.connect(g); g.connect(master); n.start(t); n.stop(t + 1.6);
  },
  bassdrop(c, t) { osc(c, "sine", 220, 35, t, 1.6, 1, 0.01); osc(c, "sawtooth", 110, 30, t, 1.4, 0.15, 0.01); },
  gong(c, t) { for (const [f, p] of [[180, 0.35], [362, 0.2], [541, 0.12], [723, 0.08]]) osc(c, "sine", f, f * 0.98, t, 3, p, 0.005); },
  vinyl(c, t) {
    // Old record crackle
    for (let k = 0; k < 40; k++) { const s = noise(c, 0.01), at = t + Math.random() * 2; env(c, s, at, 0.0005, 0.25 * Math.random(), 0.01); s.start(at); }
    const hiss = noise(c, 2), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 3000; hiss.connect(f); env(c, f, t, 0.1, 0.04, 1.8); hiss.start(t);
  },
  // (these change the music itself, in voice-music.js)
  fade() {}, fadein() {}, cut() {}, echo() {},
};
// A tiny scratch sound for while the DJ turns the record (only on the DJ's own screen, it follows their hand)
export function scratchGrain(speed) {
  const c = engine(); if (!c) return;
  const t = c.currentTime, n = noise(c, 0.06), f = c.createBiquadFilter();
  f.type = "bandpass"; f.Q.value = 5; f.frequency.value = Math.min(4000, 300 + Math.abs(speed) * 60);
  n.connect(f); env(c, f, t, 0.002, Math.min(0.5, 0.08 + Math.abs(speed) / 60), 0.05); n.start(t);
}
export function playFx(name) { const c = engine(); if (c && FX[name]) try { FX[name](c, c.currentTime + 0.02); } catch {} }

/* ---------- Drum machine (in time for everyone: it starts from the same server moment) ---------- */
const PATTERNS = {
  house: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "..x...x...x...x." },
  hiphop: { kick: "x......xx.x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." },
  techno: { kick: "x...x...x...x...", snare: "........x.......", hat: "xxxxxxxxxxxxxxxx" },
  trap: { kick: "x.....x...x.....", snare: "........x.......", hat: "x.xxx.x.xxx.x.xx" },
  dnb: { kick: "x.........x.....", snare: "....x.......x..x", hat: "x.x.x.x.x.x.x.x." },
  reggaeton: { kick: "x...x...x...x...", snare: "...x..x....x..x.", hat: "x.x.x.x.x.x.x.x." },
  disco: { kick: "x...x...x...x...", snare: "....x.......x...", hat: ".x.x.x.x.x.x.x.x" },
};
let beat = null;
export function setBeat(b, skew = 0) {
  if (beat) { clearInterval(beat.timer); beat = null; }
  if (!b) return;
  const c = engine(); if (!c) return;
  const step = 60 / b.bpm / 4, pat = PATTERNS[b.pattern] || PATTERNS.house;
  // Which step we're at, counted from when the DJ started it
  const startedSec = (Date.now() + skew - b.at) / 1000;
  let n = Math.ceil(startedSec / step);
  let nextAt = c.currentTime + (n * step - startedSec);
  beat = { b, timer: setInterval(() => {
    while (nextAt < c.currentTime + 0.12) {
      const i = n % 16;
      const bus = beatBus?.gain || master;
      if (pat.kick[i] === "x") osc(c, "sine", 150, 40, nextAt, 0.25, 0.8, 0.002, bus);
      if (pat.snare[i] === "x") { const s = noise(c, 0.18), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1500; s.connect(f); env(c, f, nextAt, 0.001, 0.35, 0.15, bus); s.start(nextAt); osc(c, "triangle", 220, 180, nextAt, 0.1, 0.15, 0.01, bus); }
      if (pat.hat[i] === "x") { const s = noise(c, 0.05), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000; s.connect(f); env(c, f, nextAt, 0.001, 0.12, 0.04, bus); s.start(nextAt); }
      n++; nextAt += step;
    }
  }, 25) };
}
export const beatOn = () => beat?.b || null;

/* ---------- The DJ controller (inside the music window) ----------
   Like a real two-deck controller: deck A (what's playing) and deck B (the next song) with jog wheels,
   a mixer in the middle (channel faders, knobs, meters, crossfader) and performance pads. */

// A knob: drag up/down (or scroll) to turn it; double-click puts it back
function knob(label, { min, max, value, def = value, step = 0.01, disabled = false, fmtv = (v) => v.toFixed(2), onChange, accent = "" }) {
  let v = value;
  const ind = h("i", { class: "knob-ind" });
  const val = h("small", { class: "knob-val", text: fmtv(v) });
  const dial = h("div", { class: "knob-dial" + (accent ? " " + accent : ""), role: "slider", tabindex: disabled ? -1 : 0, "aria-label": label, "aria-valuemin": min, "aria-valuemax": max }, ind);
  const el = h("div", { class: "knob" + (disabled ? " off" : "") }, dial, h("b", { class: "knob-lbl", text: label }), val);
  const show = () => { const k = (v - min) / (max - min); ind.style.transform = `rotate(${-135 + k * 270}deg)`; val.textContent = fmtv(v); dial.setAttribute("aria-valuenow", v); };
  const set = (x) => { v = Math.max(min, Math.min(max, Math.round(x / step) * step)); show(); onChange?.(v); };
  if (!disabled) {
    let drag = null;
    dial.addEventListener("pointerdown", (e) => { e.preventDefault(); drag = { y: e.clientY, v }; dial.setPointerCapture(e.pointerId); });
    dial.addEventListener("pointermove", (e) => { if (drag) set(drag.v + ((drag.y - e.clientY) / 120) * (max - min)); });
    dial.addEventListener("pointerup", () => { drag = null; });
    dial.addEventListener("wheel", (e) => { e.preventDefault(); set(v - Math.sign(e.deltaY) * (max - min) / 40); }, { passive: false });
    dial.addEventListener("dblclick", () => set(def));
    dial.addEventListener("keydown", (e) => { if (e.key === "ArrowUp" || e.key === "ArrowRight") set(v + (max - min) / 40); if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(v - (max - min) / 40); });
  }
  show();
  return el;
}
// A vertical fader (0–1)
function vfader(label, value, { disabled = false, onChange } = {}) {
  const input = h("input", { type: "range", min: 0, max: 100, value: Math.round(value * 100), class: "vfader", disabled, "aria-label": label });
  input.addEventListener("input", () => onChange?.(Number(input.value) / 100));
  return h("div", { class: "vfader-wrap" }, input, h("b", { class: "knob-lbl", text: label }));
}
// A level meter: a column of lights
function meter(levelFn) {
  const leds = Array.from({ length: 12 }, (_, i) => h("i", { class: i >= 10 ? "red" : i >= 7 ? "amber" : "" }));
  const el = h("div", { class: "vu" }, ...leds.slice().reverse());
  const tick = () => {
    if (!el.isConnected) return;
    const n = Math.round(levelFn() * leds.length);
    leds.forEach((l, i) => l.classList.toggle("on", i < n));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return el;
}
// Music meters: YouTube doesn't let a page measure its sound, so these move with what's playing and how loud the channel is set
const fakeLevel = (on, lvl) => () => (on() ? Math.max(0, Math.min(1, lvl() * (0.55 + 0.35 * Math.abs(Math.sin(performance.now() / 140)) + Math.random() * 0.15))) : 0);

export function djConsole(api) {
  const box = h("div", { class: "dj" });
  const cues = JSON.parse(sessionStorage.getItem("lb-dj-cues") || "{}");
  let setMode = false, taps = [], autoMix = false, mixing = false, tab = "fx", holding = false, myPads = [];
  const send = (b) => api.post({ kind: "dj", ...b }).catch((err) => toast(err.error || "Couldn’t do that."));
  const throttle = (fn, ms = 140) => { let t = null, last; return (...a) => { last = a; if (!t) t = setTimeout(() => { t = null; fn(...last); }, ms); }; };
  const sendLevels = throttle((lv) => send({ action: "levels", ...lv }));
  const sendBeatMix = throttle((mx) => { setBeatMix(mx); send({ action: "beatmix", ...mx }); });
  const sendMaster = throttle((v) => api.post({ kind: "music", action: "volume", volume: Math.round(v * 100) }));
  const sendX = throttle((x) => send({ action: "mix", x }));

  function paint() {
    if (holding) return;
    const dj = api.dj(), me = dj?.username === state.me.username, m = api.music();
    const lock = !me;
    const pad = (label, cls, fn, title) => { const b = h("button", { type: "button", class: "dj-pad " + cls, text: label, title: title || label, disabled: lock }); b.addEventListener("click", fn); return b; };
    const nextItem = m?.mix?.item || m?.queue?.[0] || null;
    const lv = m?.levels || { a: 1, b: 1 };

    // ---- top bar ----
    const top = h("div", { class: "djc-top" },
      h("b", { class: "djc-brand", text: "LookBlog DDJ-2" }),
      dj ? h("span", { class: "dj-who" + (me ? " me" : ""), text: me ? "🎧 You’re the DJ" : `🎧 @${dj.username} is DJing` }) : h("span", { class: "muted", text: "Nobody is DJing" }),
      me ? pad(autoMix ? "🤖 Auto-mix ON" : "🤖 Auto-mix", "dj-small" + (autoMix ? " on" : ""), () => { autoMix = !autoMix; paint(); toast(autoMix ? "Auto-mix is on: songs blend into each other." : "Auto-mix is off."); }) : null,
      me ? h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Step down", onclick: () => send({ action: "release" }) })
        : h("button", { type: "button", class: "btn btn-xs btn-primary", text: dj ? "Taken" : "🎧 Take the decks", disabled: Boolean(dj), onclick: () => send({ action: "claim" }) }));

    // ---- deck A: what's playing ----
    const rateSteps = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const pitch = h("input", { type: "range", min: 0, max: rateSteps.length - 1, step: 1, value: Math.max(0, rateSteps.indexOf(m?.rate || 1)), class: "vfader pitch", disabled: lock || !m?.now, "aria-label": "Tempo" });
    pitch.addEventListener("change", () => send({ action: "rate", rate: rateSteps[Number(pitch.value)] }));
    const nudge = (label, rate) => {
      const b = h("button", { type: "button", class: "dj-pad dj-small", text: label, title: "Hold to nudge", disabled: lock || !m?.now });
      let base = 1;
      b.addEventListener("pointerdown", () => { base = m?.rate || 1; send({ action: "rate", rate }); });
      b.addEventListener("pointerup", () => send({ action: "rate", rate: base }));
      return b;
    };
    const left = m?.now ? Math.max(0, (api.duration?.() || 0) - api.position()) : 0;
    const deckA = h("div", { class: "djc-deck a" },
      h("div", { class: "djc-deck-head" }, h("span", { class: "djc-tag", text: "A" }), h("b", { class: "djc-title", text: m?.now?.title || "No track" }),
        h("small", { class: "djc-time" }, h("span", { class: "dj-pos", text: fmt(api.position()) }), left ? ` · −${fmt(left)}` : "")),
      h("div", { class: "djc-jogrow" }, m?.now ? turntable(m, me) : h("div", { class: "tt empty" }),
        h("div", { class: "djc-pitch" }, h("small", { text: "+" }), pitch, h("small", { text: "−" }), h("b", { class: "knob-lbl", text: (m?.rate || 1) + "×" }))),
      h("div", { class: "djc-transport" },
        pad("CUE", "dj-round cue", () => { const c = cues[m?.now?.id]?.[1]; send({ action: "cue", at: c ?? 0 }); }, "Back to cue 1 (or the start)"),
        pad(m?.pausedAt == null ? "⏸" : "▶", "dj-round play" + (m?.pausedAt == null ? " on" : ""), () => api.post({ kind: "music", action: m?.pausedAt == null ? "pause" : "resume" })),
        nudge("◀", 0.75), nudge("▶", 1.25)),
      h("div", { class: "djc-hot" }, ...[1, 2, 3, 4].map((k) => pad(cues[m?.now?.id]?.[k] != null ? fmt(cues[m.now.id][k]) : `HOT ${k}`, "dj-hotcue c" + k + (setMode ? " setting" : ""), () => {
        if (!m?.now) return;
        if (setMode || cues[m.now.id]?.[k] == null) { cues[m.now.id] = { ...(cues[m.now.id] || {}), [k]: api.position() }; sessionStorage.setItem("lb-dj-cues", JSON.stringify(cues)); setMode = false; paint(); toast(`Hot cue ${k} at ${fmt(api.position())}.`); }
        else send({ action: "cue", at: cues[m.now.id][k] });
      })), pad(setMode ? "SET…" : "SET", "dj-small" + (setMode ? " on" : ""), () => { setMode = !setMode; paint(); }, "Save the moment on a hot cue")),
      h("div", { class: "djc-loops" }, h("span", { class: "dj-lbl", text: "Loop" }), ...[1, 2, 4, 8].map((sec) => pad(String(sec), "dj-small" + (m?.loop?.len === sec ? " on" : ""), () => send({ action: "loop", seconds: sec }))), pad("✕", "dj-small", () => send({ action: "loop", seconds: 0 })),
        h("span", { class: "dj-lbl", text: "Jump" }), pad("−8", "dj-small", () => send({ action: "cue", at: Math.max(0, api.position() - 8) })), pad("+8", "dj-small", () => send({ action: "cue", at: api.position() + 8 }))));

    // ---- deck B: the next song ----
    const deckB = h("div", { class: "djc-deck b" },
      h("div", { class: "djc-deck-head" }, h("span", { class: "djc-tag", text: "B" }), h("b", { class: "djc-title", text: nextItem?.title || "Queue a song" }), h("small", { class: "djc-time", text: m?.mix ? "▶ playing" : nextItem ? "loaded" : "" })),
      h("div", { class: "djc-jogrow" }, deckBDisc(nextItem, Boolean(m?.mix)), h("div", { class: "djc-pitch" }, h("small", { text: " " }), h("input", { type: "range", class: "vfader pitch", disabled: true, value: 2, min: 0, max: 4, "aria-label": "Tempo B" }), h("small", { text: " " }), h("b", { class: "knob-lbl", text: "1×" }))),
      h("div", { class: "djc-transport" },
        pad("▶ B", "dj-round play" + (m?.mix ? " on" : ""), () => { if (!nextItem) return toast("Queue a song to load it on deck B."); send({ action: "mix", x: Math.max(0.05, m?.mix?.x || 0.05) }); }, "Start deck B (it plays quietly under A)"),
        pad("🌀 MIX", "dj-round", () => blend(m), "Blend into deck B over 8 seconds"),
        pad("⏭ CUT", "dj-round", () => { if (!nextItem) return toast("Queue a song first."); send({ action: "mix", x: 1 }); }, "Straight to deck B")),
      h("p", { class: "djc-note", text: nextItem ? "Deck B is the next song in the queue." : "Add songs to the queue (below) to load deck B." }));

    // ---- mixer ----
    const strip = (name, kids) => h("div", { class: "djc-strip" }, h("b", { class: "djc-strip-name", text: name }), ...kids);
    const bm = beatMix();
    const playingA = () => Boolean(api.music()?.now && api.music()?.pausedAt == null);
    const mixer = h("div", { class: "djc-mixer" },
      h("div", { class: "djc-strips" },
        strip("CH A", [knob("GAIN", { min: 0, max: 1, value: lv.a, def: 1, disabled: lock || !m?.now, fmtv: (v) => Math.round(v * 100) + "%", onChange: (v) => sendLevels({ a: v }) }),
          meter(fakeLevel(playingA, () => (api.music()?.levels?.a ?? 1) * (1 - (api.music()?.mix?.x || 0)))),
          vfader("A", lv.a, { disabled: lock || !m?.now, onChange: (v) => sendLevels({ a: v }) })]),
        strip("BEAT", [knob("HI", { min: -24, max: 12, value: bm.high, def: 0, step: 1, disabled: lock, fmtv: (v) => (v > 0 ? "+" : "") + v + "dB", onChange: (v) => sendBeatMix({ high: v }) }),
          knob("MID", { min: -24, max: 12, value: bm.mid, def: 0, step: 1, disabled: lock, fmtv: (v) => (v > 0 ? "+" : "") + v + "dB", onChange: (v) => sendBeatMix({ mid: v }) }),
          knob("LOW", { min: -24, max: 12, value: bm.low, def: 0, step: 1, disabled: lock, fmtv: (v) => (v > 0 ? "+" : "") + v + "dB", onChange: (v) => sendBeatMix({ low: v }) }),
          knob("FILTER", { min: -1, max: 1, value: bm.filter, def: 0, disabled: lock, accent: "filter", fmtv: (v) => (Math.abs(v) < 0.04 ? "OFF" : v < 0 ? "LPF" : "HPF"), onChange: (v) => sendBeatMix({ filter: v }) }),
          meter(beatLevel),
          vfader("BEAT", Math.min(1, bm.gain), { disabled: lock, onChange: (v) => sendBeatMix({ gain: v }) })]),
        strip("CH B", [knob("GAIN", { min: 0, max: 1, value: lv.b, def: 1, disabled: lock || !m?.now, fmtv: (v) => Math.round(v * 100) + "%", onChange: (v) => sendLevels({ b: v }) }),
          meter(fakeLevel(() => Boolean(api.music()?.mix), () => (api.music()?.levels?.b ?? 1) * (api.music()?.mix?.x || 0))),
          vfader("B", lv.b, { disabled: lock || !m?.now, onChange: (v) => sendLevels({ b: v }) })])),
      h("div", { class: "djc-master" }, knob("MASTER", { min: 0, max: 1, value: (m?.volume ?? 70) / 100, def: 0.7, disabled: lock, fmtv: (v) => Math.round(v * 100) + "%", accent: "master", onChange: (v) => sendMaster(v) }),
        knob("BPM", { min: 70, max: 180, value: beatOn()?.bpm || 124, def: 124, step: 1, disabled: lock, fmtv: (v) => String(v), onChange: throttle((v) => { if (beatOn()) send({ action: "beat", bpm: v, pattern: beatOn().pattern }); }, 300) })),
      (() => {
        const xf = h("input", { type: "range", min: 0, max: 100, value: Math.round((m?.mix?.x || 0) * 100), class: "dj-xfader", disabled: lock || !m?.now || (!m?.queue?.length && !m?.mix), "aria-label": "Crossfader" });
        xf.addEventListener("input", () => sendX(Number(xf.value) / 100));
        return h("div", { class: "djc-xf" }, h("b", { text: "A" }), xf, h("b", { text: "B" }));
      })());

    // ---- performance pads ----
    const tabs = h("div", { class: "djc-tabs" }, ...[["fx", "FX"], ["moves", "MOVES"], ["samples", "MY SAMPLES"], ["beats", "BEATS"]].map(([k, l]) => {
      const b = h("button", { type: "button", class: "djc-tab" + (tab === k ? " on" : ""), text: l });
      b.addEventListener("click", () => { tab = k; paint(); });
      return b;
    }));
    let grid;
    if (tab === "fx") grid = [["📯", "airhorn", "Airhorn"], ["🚨", "siren", "Siren"], ["💿", "scratch", "Scratch"], ["🔫", "laser", "Laser"], ["🚀", "riser", "Riser"], ["💥", "drop", "Drop"],
      ["⏪", "rewind", "Rewind"], ["👏", "clap", "Clap"], ["🎺", "horn", "Horn"], ["🔊", "boom", "Boom"], ["🙌", "cheer", "Crowd"], ["😗", "whistle", "Whistle"],
      ["🥁", "roll", "Roll"], ["⚡", "zap", "Zap"], ["🌊", "cymbal", "Cymbal"], ["🫨", "bassdrop", "Bass drop"], ["🔔", "gong", "Gong"], ["📻", "vinyl", "Crackle"]].map(([e, k, l], i) => pad(`${e}\n${l}`, "dj-perf c" + (i % 4 + 1), () => send({ action: "fx", fx: k })));
    else if (tab === "moves") grid = [["🔉", "fade", "Fade out"], ["🔊", "fadein", "Fade in"], ["✂️", "cut", "Cut"], ["〰️", "echo", "Echo out"], ["⏪", "backspin", "Backspin"], ["🛑", "brake", "Brake"]]
      .map(([e, k, l], i) => pad(`${e}\n${l}`, "dj-perf c" + (i % 4 + 1), () => send({ action: "fx", fx: k })));
    else if (tab === "samples") grid = [...myPads.map((p, i) => {
      const b = pad(`${p.emoji}\n${p.name}`, "dj-perf c" + (i % 4 + 1) + " dj-mine", () => send({ action: "fx", fx: "custom", padId: p.id }));
      const del = h("span", { class: "dj-del", title: "Remove", text: "✕" });
      del.addEventListener("click", async (e) => { e.stopPropagation(); try { myPads = (await apiCall(`/api/me/dj-pads/${p.id}`, { method: "DELETE" })).pads; paint(); } catch {} });
      b.append(del);
      return b;
    }), (() => {
      const file = h("input", { type: "file", accept: "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a", hidden: true });
      const add = h("button", { type: "button", class: "dj-pad dj-perf dj-add", text: "＋\nMP3", title: "Add your own sample (an MP3 up to 2 MB)", disabled: lock });
      add.addEventListener("click", () => file.click());
      file.addEventListener("change", async () => {
        const f = file.files[0]; file.value = "";
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) return toast("Keep samples short (up to 2 MB).");
        add.disabled = true; add.textContent = "…";
        try { const { url } = await upload(f); myPads = (await apiCall("/api/me/dj-pads", { method: "POST", body: { url, name: f.name.replace(/\.[^.]+$/, "").slice(0, 20) } })).pads; toast("Your sample is on a pad."); }
        catch (err) { toast(err.error || "Couldn’t add it."); }
        paint();
      });
      return h("span", { class: "dj-add-wrap" }, add, file);
    })()];
    else {
      const NAMES = { hiphop: "Hip-hop", dnb: "D&B", reggaeton: "Reggaeton" };
      const b = beatOn();
      grid = [...["house", "hiphop", "techno", "trap", "dnb", "reggaeton", "disco"].map((p, i) => pad(`🥁\n${NAMES[p] || p[0].toUpperCase() + p.slice(1)}`, "dj-perf c" + (i % 4 + 1) + (b?.pattern === p ? " on" : ""), () => send({ action: "beat", bpm: b?.bpm || 124, pattern: p }))),
        pad("⏹\nBeat off", "dj-perf c4", () => send({ action: "beat", bpm: 0 })),
        pad("👆\nTap tempo", "dj-perf c1", () => {
          const now = performance.now();
          taps = taps.filter((t) => now - t < 2500); taps.push(now);
          if (taps.length >= 3) { const gaps = taps.slice(1).map((t, i) => t - taps[i]); const bpmV = Math.max(70, Math.min(180, Math.round(60000 / (gaps.reduce((x, y) => x + y, 0) / gaps.length)))); toast(`${bpmV} BPM`); if (beatOn()) send({ action: "beat", bpm: bpmV, pattern: beatOn().pattern }); }
        })];
    }
    box.replaceChildren(h("div", { class: "djc" + (lock ? " locked" : "") }, top,
      h("div", { class: "djc-main" }, deckA, mixer, deckB),
      h("div", { class: "djc-pads" }, tabs, h("div", { class: "djc-grid" }, ...grid))),
      h("p", { class: "create-hint", text: lock ? "Only the DJ can use the decks. Everyone in the channel hears what the DJ does." : "Everyone in the voice channel hears everything you do here, at the same moment. (YouTube doesn’t let pages change its sound, so EQ and filter work on the beat channel.)" }));
  }
  // Blend from A into B over 8 seconds
  function blend(m) {
    if (!(m?.mix?.item || m?.queue?.length)) return toast("Queue a song first, then mix into it.");
    if (mixing) return;
    mixing = true;
    let x = m?.mix?.x || 0;
    const step = setInterval(() => { x = Math.min(1, x + 0.125); send({ action: "mix", x }); if (x >= 1) { clearInterval(step); setTimeout(() => { mixing = false; }, 3000); } }, 1000);
  }
  // Deck B's record: the next song's picture, spinning once it plays
  function deckBDisc(item, playing) {
    const disc = h("div", { class: "tt-disc" + (playing ? " spin" : ""), style: "--spin:1.8s" }, h("div", { class: "tt-label", style: item?.thumb ? `background-image:url("${item.thumb}")` : "" }), h("i", { class: "tt-hole" }));
    return h("div", { class: "tt" }, h("div", { class: "tt-plate" }, disc), h("div", { class: "tt-arm" + (playing ? " on" : "") }, h("i")));
  }
  // Deck A's record: it spins while the music plays; the DJ grabs it and turns it (forward or back) — one turn ≈ 1.8 s
  let spinAngle = 0;
  function turntable(m, me) {
    const playing = m.pausedAt == null, rate = m.rate || 1;
    const label = h("div", { class: "tt-label", style: m.now.thumb ? `background-image:url("${m.now.thumb}")` : "" });
    const disc = h("div", { class: "tt-disc" + (playing ? " spin" : ""), style: `--spin:${(1.8 / rate).toFixed(2)}s` }, label, h("i", { class: "tt-hole" }));
    const time = h("div", { class: "tt-time", text: fmt(api.position()) });
    const deck = h("div", { class: "tt" + (me ? " grab" : "") }, h("div", { class: "tt-plate" }, disc), h("div", { class: "tt-arm" + (playing ? " on" : "") }, h("i")), time);
    if (!me) return deck;
    let drag = null;
    const angle = (e) => { const r = disc.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
    disc.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      drag = { last: angle(e), total: 0, pos: api.position(), lastT: performance.now(), sent: 0 };
      holding = true;
      disc.setPointerCapture(e.pointerId);
      deck.classList.add("dragging");
      disc.classList.remove("spin");
    });
    disc.addEventListener("pointermove", (e) => {
      if (!drag) return;
      let a = angle(e), d = a - drag.last;
      if (d > 180) d -= 360; if (d < -180) d += 360;
      drag.last = a; drag.total += d; spinAngle += d;
      disc.style.transform = `rotate(${spinAngle}deg)`;
      const now = performance.now(), speed = d / Math.max(1, now - drag.lastT) * 16; drag.lastT = now;
      if (Math.abs(d) > 2) scratchGrain(speed);
      if (Math.abs(speed) > 14 && now - drag.sent > 600) { drag.sent = now; send({ action: "fx", fx: "scratch" }); }
      time.textContent = fmt(Math.max(0, drag.pos + (drag.total / 360) * 1.8));
    });
    const end = () => {
      if (!drag) return;
      const to = Math.max(0, drag.pos + (drag.total / 360) * 1.8);
      holding = false;
      if (Math.abs(drag.total) > 8) send({ action: "cue", at: to });
      drag = null;
      deck.classList.remove("dragging");
      disc.style.transform = "";
      if (m.pausedAt == null) disc.classList.add("spin");
    };
    disc.addEventListener("pointerup", end);
    disc.addEventListener("pointercancel", end);
    return deck;
  }
  apiCall("/api/me/dj-pads").then((d) => { myPads = d.pads || []; if (tab === "samples") paint(); }).catch(() => {});
  // Clocks, and auto-mix 12 seconds before the end
  const clock = setInterval(() => {
    if (!box.isConnected) return clearInterval(clock);
    if (!holding) { const t = box.querySelector(".tt:not(.dragging) .tt-time"); if (t) t.textContent = fmt(api.position()); const p = box.querySelector(".dj-pos"); if (p) p.textContent = fmt(api.position()); }
    const m = api.music(), d = api.dj();
    if (!autoMix || !m?.now || d?.username !== state.me.username || !m.queue?.length || mixing) return;
    const leftS = (api.duration?.() || 0) - api.position();
    if (leftS > 0 && leftS < 12) blend(m);
  }, 500);
  paint();
  return { el: box, paint };
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
