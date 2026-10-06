// DJ mode in a voice channel: one DJ at a time mixes the music that's playing (YouTube or LookBlog songs),
// and everyone in the channel hears it: speed, hot cues, loops, brake, fades into the next song,
// effect pads (airhorn, siren, scratch…) and a drum machine on top. The effects are made right in each
// person's browser at the same moment, so they sound the same for everyone.
import { h, toast, modal } from "../ui.js";
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
      // The FX unit: bit-crush (a distortion), pan, and echo / reverb sends
      const crush = ctx.createWaveShaper(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      const delay = ctx.createDelay(2), fb = ctx.createGain(), echoOut = ctx.createGain(), verb = ctx.createConvolver(), verbOut = ctx.createGain();
      delay.delayTime.value = 0.375; fb.gain.value = 0.42; echoOut.gain.value = 0; verbOut.gain.value = 0;
      const ir = ctx.createBuffer(2, ctx.sampleRate * 2.4, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6); }
      verb.buffer = ir;
      gain.connect(low); low.connect(mid); mid.connect(high); high.connect(filter); filter.connect(crush); crush.connect(pan); pan.connect(meter); meter.connect(master);
      pan.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(echoOut); echoOut.connect(master);
      pan.connect(verb); verb.connect(verbOut); verbOut.connect(master);
      beatBus = { gain, low, mid, high, filter, meter, crush, pan, delay, echoOut, verbOut };
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
const sampleCache = new Map();
export async function playCustom(url, vol = 1) {
  const c = engine();
  try {
    if (!c) throw 0;
    if (!sampleCache.has(url)) sampleCache.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)));
    const buf = await sampleCache.get(url), src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; g.gain.value = vol; src.connect(g); g.connect(bus()); src.start();
  } catch { sampleCache.delete(url); try { const a = new Audio(url); a.volume = Math.min(1, djVol * vol); a.play().catch(() => {}); } catch {} }
}
// The keys: 808 bass, synth, pluck, bell, organ, lead. note 0–24 (two octaves from C)
export function playNote(note, inst = "synth") {
  const c = engine(); if (!c) return;
  const t = c.currentTime + 0.02, base = inst === "808" ? 32.7 : inst === "bell" ? 523.25 : 261.63, f = base * Math.pow(2, note / 12);
  if (inst === "808") { osc(c, "sine", f * 2.2, f, t, 1.3, 0.9, 0.003); osc(c, "triangle", f, f, t, 1.1, 0.25, 0.005); return; }
  if (inst === "pluck") { osc(c, "sawtooth", f, f, t, 0.35, 0.18, 0.002); osc(c, "square", f * 2, f * 2, t, 0.12, 0.05, 0.002); return; }
  if (inst === "bell") { for (const [m, p] of [[1, 0.25], [2.76, 0.1], [5.4, 0.05]]) osc(c, "sine", f * m, f * m, t, 1.6, p, 0.002); return; }
  if (inst === "organ") { for (const [m, p] of [[1, 0.12], [2, 0.08], [3, 0.05], [4, 0.03]]) osc(c, "sine", f * m, f * m, t, 0.7, p, 0.02); return; }
  if (inst === "lead") { osc(c, "sawtooth", f, f, t, 0.5, 0.1, 0.01); osc(c, "sawtooth", f * 1.006, f * 1.006, t, 0.5, 0.1, 0.01); osc(c, "square", f / 2, f / 2, t, 0.5, 0.05, 0.01); return; }
  for (const d of [1, 1.008, 0.992]) osc(c, "sawtooth", f * d, f * d, t, 0.6, 0.07, 0.02);
}

const noise = (c, secs) => {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * secs), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
};
function env(c, node, t, a, peak, d, dest = bus()) { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); node.connect(g); g.connect(dest); return g; }
function osc(c, type, f0, f1, t, dur, peak = 0.3, a = 0.01, dest = bus()) {
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
  b.echoOut.gain.setTargetAtTime((m.echo || 0) * 0.8, t, 0.05);
  b.verbOut.gain.setTargetAtTime((m.verb || 0) * 1.2, t, 0.05);
  if (b.pan.pan) b.pan.pan.setTargetAtTime(m.pan || 0, t, 0.03);
  b.crush.curve = m.crush > 0.02 ? crushCurve(m.crush) : null;
}
function crushCurve(k) {
  const steps = Math.round(24 - k * 21), c = new Float32Array(1024);
  for (let i = 0; i < c.length; i++) { const x = (i / (c.length - 1)) * 2 - 1; c[i] = Math.round(Math.tanh(x * (1 + k * 4)) * steps) / steps; }
  return c;
}
// The beat channel's sound comes in here (the effects and keys too, so the knobs change them all)
const bus = () => beatBus?.gain || master;
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
    n.connect(f); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 3.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 4); f.connect(g); g.connect(bus()); n.start(t); n.stop(t + 4);
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
    n.connect(f); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5); f.connect(g); g.connect(bus()); n.start(t); n.stop(t + 2.6);
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
    n.connect(f); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6); f.connect(g); g.connect(bus()); n.start(t); n.stop(t + 1.6);
  },
  bassdrop(c, t) { osc(c, "sine", 220, 35, t, 1.6, 1, 0.01); osc(c, "sawtooth", 110, 30, t, 1.4, 0.15, 0.01); },
  gong(c, t) { for (const [f, p] of [[180, 0.35], [362, 0.2], [541, 0.12], [723, 0.08]]) osc(c, "sine", f, f * 0.98, t, 3, p, 0.005); },
  vinyl(c, t) {
    // Old record crackle
    for (let k = 0; k < 40; k++) { const s = noise(c, 0.01), at = t + Math.random() * 2; env(c, s, at, 0.0005, 0.25 * Math.random(), 0.01); s.start(at); }
    const hiss = noise(c, 2), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 3000; hiss.connect(f); env(c, f, t, 0.1, 0.04, 1.8); hiss.start(t);
  },
  build(c, t) { FX.roll(c, t); FX.riser(c, t); },
  kick(c, t) { osc(c, "sine", 160, 40, t, 0.35, 1, 0.002); },
  snare(c, t) { const s = noise(c, 0.2), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1500; s.connect(f); env(c, f, t, 0.001, 0.5, 0.18); s.start(t); osc(c, "triangle", 220, 170, t, 0.12, 0.2, 0.005); },
  hat(c, t) { for (let k = 0; k < 4; k++) { const s = noise(c, 0.05), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7500; s.connect(f); env(c, f, t + k * 0.11, 0.001, 0.18, 0.04); s.start(t + k * 0.11); } },
  cowbell(c, t) { osc(c, "square", 587, 587, t, 0.35, 0.08, 0.002); osc(c, "square", 845, 845, t, 0.35, 0.08, 0.002); },
  tom(c, t) { [0, 0.14, 0.28].forEach((d, i) => osc(c, "sine", 260 - i * 60, 90 - i * 15, t + d, 0.3, 0.6, 0.003)); },
  perc(c, t) { [0, 0.09, 0.18, 0.36].forEach((d, i) => osc(c, "triangle", 900 + (i % 2) * 400, 500, t + d, 0.07, 0.25, 0.001)); },
  stab(c, t) { for (const f of [261.6, 329.6, 392, 523.3]) { osc(c, "sawtooth", f, f, t, 0.25, 0.07, 0.003); osc(c, "sawtooth", f * 1.01, f * 1.01, t, 0.25, 0.05, 0.003); } },
  chord(c, t) { for (const f of [220, 261.6, 329.6, 440]) osc(c, "triangle", f, f, t, 1.8, 0.08, 0.15); },
  uplift(c, t) { const n = noise(c, 2), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(9000, t + 1.9); n.connect(f); env(c, f, t, 1.6, 0.35, 0.3); n.start(t); },
  downlift(c, t) { const n = noise(c, 2), f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(9000, t); f.frequency.exponentialRampToValueAtTime(150, t + 1.9); n.connect(f); env(c, f, t, 0.02, 0.4, 1.9); n.start(t); osc(c, "sine", 400, 50, t, 1.8, 0.2, 0.02); },
  impact(c, t) { FX.boom(c, t); const n = noise(c, 1.5), f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 3000; n.connect(f); env(c, f, t, 0.002, 0.6, 1.3); n.start(t); },
  glitch(c, t) { for (let k = 0; k < 10; k++) osc(c, "square", 200 + Math.random() * 3000, 100 + Math.random() * 2000, t + k * 0.05, 0.04, 0.08, 0.001); },
  bell() { playNote(12, "bell"); playNote(19, "bell"); },
  phone(c, t) { for (let k = 0; k < 2; k++) for (let j = 0; j < 10; j++) osc(c, "sine", j % 2 ? 480 : 440, j % 2 ? 480 : 440, t + k * 0.9 + j * 0.05, 0.05, 0.1, 0.002); },
  reverse(c, t) { const n = noise(c, 1.2), f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1500; n.connect(f); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 1.1); g.gain.setValueAtTime(0.0001, t + 1.15); f.connect(g); g.connect(bus()); n.start(t); n.stop(t + 1.2); osc(c, "sine", 110, 110, t + 0.1, 1, 0.3, 0.9); },
  // (these change the music itself, in voice-music.js)
  fade() {}, fadein() {}, cut() {}, echo() {}, transform() {}, stutter() {}, dip() {},
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
  disco: { kick: "x...x...x...x...", snare: "....x.......x...", hat: ".x.x.x.x.x.x.x.x", open: "..x...x...x...x." },
  afro: { kick: "x..x..x...x..x..", snare: "....x.......x...", hat: "x.xx.xx.x.xx.xx.", perc: "..x..x....x..x.." },
  garage: { kick: "x.........x.....", snare: "....x.......x...", hat: "..x...x...x...xx", clap: "....x.......x..." },
  funk: { kick: "x.x....x..x.....", snare: "....x..x.x..x...", hat: "xxxxxxxxxxxxxxxx" },
  jersey: { kick: "x..x..x.x.x.x.x.", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", clap: "....x..x....x..." },
  drill: { kick: "x......x..x.....", snare: "......x.......x.", hat: "x..x..x.x..x.x..", perc: "...x.......x...." },
  lofi: { kick: "x......x..x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", open: "..............x." },
};
export const DRUM_ROWS = ["kick", "snare", "clap", "hat", "open", "perc"];
function drum(c, row, t, b) {
  if (row === "kick") osc(c, "sine", 150, 40, t, 0.25, 0.8, 0.002, b);
  if (row === "snare") { const s = noise(c, 0.18), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1500; s.connect(f); env(c, f, t, 0.001, 0.35, 0.15, b); s.start(t); osc(c, "triangle", 220, 180, t, 0.1, 0.15, 0.01, b); }
  if (row === "clap") for (let k = 0; k < 3; k++) { const n = noise(c, 0.15), f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1400; n.connect(f); env(c, f, t + k * 0.01, 0.001, 0.4, 0.1, b); n.start(t + k * 0.01); }
  if (row === "hat") { const s = noise(c, 0.05), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000; s.connect(f); env(c, f, t, 0.001, 0.12, 0.04, b); s.start(t); }
  if (row === "open") { const s = noise(c, 0.35), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 6000; s.connect(f); env(c, f, t, 0.002, 0.12, 0.3, b); s.start(t); }
  if (row === "perc") osc(c, "triangle", 900, 500, t, 0.07, 0.25, 0.001, b);
}
export function previewDrum(row) { const c = engine(); if (c) drum(c, row, c.currentTime + 0.01, bus()); }
let beat = null;
export function setBeat(b, skew = 0) {
  if (beat) { clearInterval(beat.timer); beat = null; }
  if (!b) return;
  const c = engine(); if (!c) return;
  const step = 60 / b.bpm / 4, pat = (b.pattern === "custom" && b.steps) || PATTERNS[b.pattern] || PATTERNS.house, swing = (b.swing || 0) * step;
  // Which step we're at, counted from when the DJ started it
  const startedSec = (Date.now() + skew - b.at) / 1000;
  let n = Math.ceil(startedSec / step);
  let nextAt = c.currentTime + (n * step - startedSec);
  beat = { b, step: 0, timer: setInterval(() => {
    while (nextAt < c.currentTime + 0.12) {
      const i = n % 16, at = nextAt + (i % 2 ? swing : 0);
      for (const row of DRUM_ROWS) if (pat[row]?.[i] === "x") drum(c, row, at, bus());
      beat.step = i;
      n++; nextAt += step;
    }
  }, 25) };
}
export const beatStep = () => beat?.step ?? -1;
export const beatOn = () => beat?.b || null;
const PATTERN_OF = (name) => ({ kick: "", snare: "", clap: "", hat: "", open: "", perc: "", ...(PATTERNS[name] || {}) });

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
  let setMode = false, taps = [], autoMix = false, mixing = false, tab = sessionStorage.getItem("lb-dj-tab") || "fx", holding = false, myPads = [], padsLoaded = false;
  let inst = "synth", octave = 0, muted = {}, killed = {};
  let seq = (() => { try { return JSON.parse(localStorage.getItem("lb-dj-seq")) || null; } catch { return null; } })() || { kick: "x...x...x...x...", snare: "....x.......x...", clap: "", hat: "..x...x...x...x.", open: "", perc: "", swing: 0 };
  const saveSeq = () => { try { localStorage.setItem("lb-dj-seq", JSON.stringify(seq)); } catch {} };
  const send = (b) => api.post({ kind: "dj", ...b }).catch((err) => toast(err.error || "Couldn’t do that."));
  const throttle = (fn, ms = 140) => { let t = null, last; return (...a) => { last = a; if (!t) t = setTimeout(() => { t = null; fn(...last); }, ms); }; };
  const sendLevels = throttle((lv) => send({ action: "levels", ...lv }));
  const sendBeatMix = throttle((mx) => { setBeatMix(mx); send({ action: "beatmix", ...mx }); });
  const sendMaster = throttle((v) => api.post({ kind: "music", action: "volume", volume: Math.round(v * 100) }));
  const sendX = throttle((x) => send({ action: "mix", x }));

  // Not while a knob or fader is in the DJ's hand (it would be swapped for a new one mid-turn)
  let turning = false, owed = false;
  box.addEventListener("pointerdown", (e) => { if (e.target.closest(".knob-dial, input[type=range]")) turning = true; });
  const letGo = () => { if (!turning) return; turning = false; if (owed) { owed = false; setTimeout(paint, 0); } };
  addEventListener("pointerup", letGo); addEventListener("pointercancel", letGo);
  function paint() {
    if (holding) return;
    if (turning) { owed = true; return; }
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
          muteBtn("a", lv, lock || !m?.now),
          vfader("A", lv.a, { disabled: lock || !m?.now, onChange: (v) => sendLevels({ a: v }) })]),
        strip("FX · BEAT", [knob("HI", { min: -24, max: 12, value: bm.high, def: 0, step: 1, disabled: lock, fmtv: (v) => (v > 0 ? "+" : "") + v + "dB", onChange: (v) => sendBeatMix({ high: v }) }),
          knob("MID", { min: -24, max: 12, value: bm.mid, def: 0, step: 1, disabled: lock, fmtv: (v) => (v > 0 ? "+" : "") + v + "dB", onChange: (v) => sendBeatMix({ mid: v }) }),
          knob("LOW", { min: -24, max: 12, value: bm.low, def: 0, step: 1, disabled: lock, fmtv: (v) => (v > 0 ? "+" : "") + v + "dB", onChange: (v) => sendBeatMix({ low: v }) }),
          knob("FILTER", { min: -1, max: 1, value: bm.filter, def: 0, disabled: lock, accent: "filter", fmtv: (v) => (Math.abs(v) < 0.04 ? "OFF" : v < 0 ? "LPF" : "HPF"), onChange: (v) => sendBeatMix({ filter: v }) }),
          h("div", { class: "djc-kills" }, ...[["high", "HI"], ["mid", "MID"], ["low", "LOW"]].map(([k, l]) => pad(l, "dj-kill" + (killed[k] != null ? " on" : ""), () => {
            if (killed[k] != null) { sendBeatMix({ [k]: killed[k] }); delete killed[k]; } else { killed[k] = bm[k]; sendBeatMix({ [k]: -24 }); }
            setTimeout(paint, 60);
          }, `Kill ${l}`))),
          meter(beatLevel),
          vfader("FX", Math.min(1, bm.gain), { disabled: lock, onChange: (v) => sendBeatMix({ gain: v }) })]),
        strip("CH B", [knob("GAIN", { min: 0, max: 1, value: lv.b, def: 1, disabled: lock || !m?.now, fmtv: (v) => Math.round(v * 100) + "%", onChange: (v) => sendLevels({ b: v }) }),
          meter(fakeLevel(() => Boolean(api.music()?.mix), () => (api.music()?.levels?.b ?? 1) * (api.music()?.mix?.x || 0))),
          muteBtn("b", lv, lock || !m?.now),
          vfader("B", lv.b, { disabled: lock || !m?.now, onChange: (v) => sendLevels({ b: v }) })])),
      h("div", { class: "djc-fxunit" }, h("b", { class: "djc-strip-name", text: "FX UNIT" }),
        knob("ECHO", { min: 0, max: 1, value: bm.echo || 0, def: 0, disabled: lock, fmtv: (v) => Math.round(v * 100) + "%", onChange: (v) => sendBeatMix({ echo: v }) }),
        knob("VERB", { min: 0, max: 1, value: bm.verb || 0, def: 0, disabled: lock, fmtv: (v) => Math.round(v * 100) + "%", onChange: (v) => sendBeatMix({ verb: v }) }),
        knob("CRUSH", { min: 0, max: 1, value: bm.crush || 0, def: 0, disabled: lock, fmtv: (v) => Math.round(v * 100) + "%", onChange: (v) => sendBeatMix({ crush: v }) }),
        knob("PAN", { min: -1, max: 1, value: bm.pan || 0, def: 0, disabled: lock, fmtv: (v) => (Math.abs(v) < 0.05 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100)), onChange: (v) => sendBeatMix({ pan: v }) }),
        pad("RESET", "dj-small", () => sendBeatMix({ echo: 0, verb: 0, crush: 0, pan: 0, filter: 0, low: 0, mid: 0, high: 0 }), "Everything on the FX channel back to normal")),
      h("div", { class: "djc-master" }, knob("MASTER", { min: 0, max: 1, value: (m?.volume ?? 70) / 100, def: 0.7, disabled: lock, fmtv: (v) => Math.round(v * 100) + "%", accent: "master", onChange: (v) => sendMaster(v) }),
        knob("BPM", { min: 70, max: 180, value: beatOn()?.bpm || 124, def: 124, step: 1, disabled: lock, fmtv: (v) => String(v), onChange: throttle((v) => { if (beatOn()) send({ action: "beat", bpm: v, pattern: beatOn().pattern }); }, 300) })),
      (() => {
        const xf = h("input", { type: "range", min: 0, max: 100, value: Math.round((m?.mix?.x || 0) * 100), class: "dj-xfader", disabled: lock || !m?.now || (!m?.queue?.length && !m?.mix), "aria-label": "Crossfader" });
        xf.addEventListener("input", () => sendX(Number(xf.value) / 100));
        return h("div", { class: "djc-xf" }, h("b", { text: "A" }), xf, h("b", { text: "B" }));
      })());

    // ---- performance pads ----
    const TABS = [["fx", "FX"], ["moves", "MOVES"], ["keys", "KEYS"], ["mine", "MY SOUNDS"], ["beats", "BEATS"], ["seq", "SEQUENCER"]];
    const tabs = h("div", { class: "djc-tabs" }, ...TABS.map(([k, l]) => {
      const b = h("button", { type: "button", class: "djc-tab" + (tab === k ? " on" : ""), text: l });
      b.addEventListener("click", () => { tab = k; sessionStorage.setItem("lb-dj-tab", k); paint(); });
      return b;
    }));
    const fxPads = (list) => list.map(([e, k, l], i) => pad(`${e}\n${l}`, "dj-perf c" + (i % 4 + 1), () => send({ action: "fx", fx: k })));
    let grid, gridClass = "djc-grid";
    if (tab === "fx") grid = fxPads([["📯", "airhorn", "Airhorn"], ["🚨", "siren", "Siren"], ["💿", "scratch", "Scratch"], ["🔫", "laser", "Laser"], ["🚀", "riser", "Riser"], ["💥", "drop", "Drop"],
      ["⏪", "rewind", "Rewind"], ["👏", "clap", "Clap"], ["🎺", "horn", "Horn"], ["🔊", "boom", "Boom"], ["🙌", "cheer", "Crowd"], ["😗", "whistle", "Whistle"],
      ["🥁", "roll", "Roll"], ["⚡", "zap", "Zap"], ["🌊", "cymbal", "Cymbal"], ["🫨", "bassdrop", "Bass drop"], ["🔔", "gong", "Gong"], ["📻", "vinyl", "Crackle"],
      ["🦵", "kick", "Kick"], ["🪘", "snare", "Snare"], ["🎩", "hat", "Hats"], ["🐄", "cowbell", "Cowbell"], ["🛢️", "tom", "Toms"], ["🪇", "perc", "Perc"],
      ["🎹", "stab", "Stab"], ["🌅", "chord", "Pad chord"], ["⬆️", "uplift", "Uplifter"], ["⬇️", "downlift", "Downlifter"], ["☄️", "impact", "Impact"], ["👾", "glitch", "Glitch"],
      ["🛎️", "bell", "Bell"], ["📞", "phone", "Phone"], ["🔁", "reverse", "Reverse"], ["🏗️", "build", "Build-up"]]);
    else if (tab === "moves") grid = fxPads([["🔉", "fade", "Fade out"], ["🔊", "fadein", "Fade in"], ["✂️", "cut", "Cut"], ["〰️", "echo", "Echo out"], ["⏪", "backspin", "Backspin"], ["🛑", "brake", "Brake"],
      ["🎚️", "transform", "Transform"], ["🔂", "stutter", "Stutter"], ["🫳", "dip", "Dip"]]);
    else if (tab === "keys") {
      gridClass = "djc-keys-wrap";
      const INST = [["808", "🔈 808"], ["synth", "🎛️ Synth"], ["pluck", "🎸 Pluck"], ["bell", "🔔 Bells"], ["organ", "⛪ Organ"], ["lead", "🎺 Lead"]];
      const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const keys = Array.from({ length: 13 }, (_, i) => {
        const note = i + octave * 12, black = names[i % 12].includes("#");
        const b = h("button", { type: "button", class: "dj-key" + (black ? " black" : ""), disabled: lock, title: names[i % 12], text: names[i % 12].replace("#", "♯") });
        b.addEventListener("pointerdown", (e) => { e.preventDefault(); send({ action: "fx", fx: "note", note, inst }); b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 160); });
        return b;
      });
      grid = [h("div", { class: "djc-inst" }, ...INST.map(([k, l]) => pad(l, "dj-small" + (inst === k ? " on" : ""), () => { inst = k; paint(); })),
          pad("OCT −", "dj-small", () => { octave = Math.max(0, octave - 1); paint(); }), pad("OCT +", "dj-small", () => { octave = Math.min(1, octave + 1); paint(); })),
        h("div", { class: "djc-keys" }, ...keys),
        h("p", { class: "djc-note", text: "Play along: everyone in the channel hears your notes. Keyboard: A W S E D F T G Y H U J K." })];
    } else if (tab === "mine") {
      gridClass = "djc-grid";
      grid = [...myPads.map((p, i) => {
        const b = h("button", { type: "button", class: "dj-pad dj-perf dj-mine pc-" + (p.color || "pink"), title: lock ? "Preview (only you hear it)" : p.name, text: `${p.emoji}\n${p.name}` });
        b.addEventListener("click", () => { if (lock) playCustom(p.url, p.vol ?? 1); else send({ action: "fx", fx: "custom", padId: p.id }); });
        if (p.key) b.append(h("kbd", { class: "dj-kbd", text: p.key.toUpperCase() }));
        const edit = h("span", { class: "dj-edit", title: "Edit", text: "✎" });
        edit.addEventListener("click", (e) => { e.stopPropagation(); editPad(p); });
        b.append(edit);
        return b;
      }), ...(myPads.length < 24 ? addPadButtons() : [])];
      if (padsLoaded && !myPads.length) grid.unshift(h("p", { class: "djc-note wide", text: "Your own sounds live on your account: upload an MP3 or record one with your mic. Only you can use them, in any voice channel." }));
    } else if (tab === "beats") {
      const NAMES = { hiphop: "Hip-hop", dnb: "D&B", lofi: "Lo-fi" };
      const b = beatOn();
      grid = [...["house", "hiphop", "techno", "trap", "dnb", "reggaeton", "disco", "afro", "garage", "funk", "jersey", "drill", "lofi"].map((p, i) => pad(`🥁\n${NAMES[p] || p[0].toUpperCase() + p.slice(1)}`, "dj-perf c" + (i % 4 + 1) + (b?.pattern === p ? " on" : ""), () => send({ action: "beat", bpm: b?.bpm || 124, pattern: p, swing: b?.swing || 0 }))),
        pad("⏹\nBeat off", "dj-perf c4", () => send({ action: "beat", bpm: 0 })),
        pad("👆\nTap tempo", "dj-perf c1", () => {
          const now = performance.now();
          taps = taps.filter((t) => now - t < 2500); taps.push(now);
          if (taps.length >= 3) { const gaps = taps.slice(1).map((t, i) => t - taps[i]); const bpmV = Math.max(70, Math.min(180, Math.round(60000 / (gaps.reduce((x, y) => x + y, 0) / gaps.length)))); toast(`${bpmV} BPM`); if (beatOn()) send({ action: "beat", ...beatOn(), bpm: bpmV }); }
        }),
        ...[-5, -1, 1, 5].map((d) => pad(`${d > 0 ? "+" : ""}${d}\nBPM`, "dj-perf c2", () => { const o = beatOn(); if (!o) return toast("Start a beat first."); send({ action: "beat", ...o, bpm: Math.max(60, Math.min(200, o.bpm + d)) }); }))];
    } else {
      gridClass = "djc-seq-wrap";
      const LABEL = { kick: "KICK", snare: "SNARE", clap: "CLAP", hat: "HAT", open: "OPEN", perc: "PERC" };
      const rows = DRUM_ROWS.map((row) => h("div", { class: "seq-row" },
        (() => { const l = h("button", { type: "button", class: "seq-lbl", text: LABEL[row], title: "Hear it" }); l.addEventListener("click", () => previewDrum(row)); return l; })(),
        ...Array.from({ length: 16 }, (_, i) => {
          const on = (seq[row] || "")[i] === "x";
          const c = h("button", { type: "button", class: "seq-step" + (on ? " on" : "") + (i % 4 === 0 ? " beat" : ""), "data-i": i, "aria-label": `${LABEL[row]} step ${i + 1}` });
          c.addEventListener("click", () => {
            const arr = (seq[row] || "").padEnd(16, ".").split(""); arr[i] = arr[i] === "x" ? "." : "x"; seq[row] = arr.join("");
            c.classList.toggle("on"); saveSeq(); if (!on) previewDrum(row);
            if (!lock && beatOn()?.pattern === "custom") sendSeq();
          });
          return c;
        })));
      const swingK = knob("SWING", { min: 0, max: 0.5, value: seq.swing || 0, def: 0, fmtv: (v) => Math.round(v * 200) + "%", onChange: (v) => { seq.swing = v; saveSeq(); if (!lock && beatOn()?.pattern === "custom") sendSeq(); } });
      grid = [h("div", { class: "seq-grid" }, ...rows),
        h("div", { class: "seq-tools" }, swingK,
          pad(beatOn()?.pattern === "custom" ? "🔄 Update" : "▶ Play my beat", "dj-small play" + (beatOn()?.pattern === "custom" ? " on" : ""), () => sendSeq()),
          pad("⏹ Stop", "dj-small", () => send({ action: "beat", bpm: 0 })),
          h("button", { type: "button", class: "dj-pad dj-small", text: "🎲 Random", onclick: () => { for (const r of DRUM_ROWS) seq[r] = Array.from({ length: 16 }, (_, i) => (Math.random() < ({ kick: i % 4 === 0 ? 0.9 : 0.12, snare: i % 8 === 4 ? 0.9 : 0.05, hat: 0.55, clap: 0.08, open: 0.08, perc: 0.12 })[r] ? "x" : ".")).join(""); saveSeq(); paint(); } }),
          h("button", { type: "button", class: "dj-pad dj-small", text: "🧹 Clear", onclick: () => { for (const r of DRUM_ROWS) seq[r] = ""; saveSeq(); paint(); } }),
          h("button", { type: "button", class: "dj-pad dj-small", text: "📋 From preset", onclick: () => { const p = beatOn(); if (!p || p.pattern === "custom") return toast("Play a preset in BEATS first, then copy it here."); Object.assign(seq, PATTERN_OF(p.pattern)); saveSeq(); paint(); } })),
        h("p", { class: "djc-note", text: "Your pattern is saved on this device. Tap the drum names to hear them." })];
    }
    box.replaceChildren(h("div", { class: "djc" + (lock ? " locked" : "") }, top,
      h("div", { class: "djc-main" }, deckA, mixer, deckB),
      h("div", { class: "djc-pads" }, tabs, h("div", { class: gridClass }, ...grid))),
      h("p", { class: "create-hint", text: lock ? "Only the DJ can use the decks. Everyone in the channel hears what the DJ does." : "Everyone in the voice channel hears everything you do here, at the same moment. (YouTube doesn’t let pages change its sound, so the EQ, filter and FX unit work on the FX · beat channel: effects, keys, beats and your sounds.)" }));
  }
  // Mute a deck (and bring it back at the level it had)
  function muteBtn(k, lv, disabled) {
    const b = h("button", { type: "button", class: "dj-pad dj-kill" + (muted[k] != null ? " on" : ""), text: muted[k] != null ? "MUTED" : "MUTE", disabled });
    b.addEventListener("click", () => {
      if (muted[k] != null) { sendLevels({ [k]: muted[k] || 1 }); delete muted[k]; } else { muted[k] = lv[k] ?? 1; sendLevels({ [k]: 0 }); }
      setTimeout(paint, 250);
    });
    return b;
  }
  function sendSeq() {
    const steps = {}; for (const r of DRUM_ROWS) steps[r] = (seq[r] || "").padEnd(16, ".");
    send({ action: "beat", bpm: beatOn()?.bpm || 124, pattern: "custom", steps, swing: seq.swing || 0 });
  }
  // Adding my own sounds: an MP3 (or WAV…) from the device, or recorded with the mic
  function addPadButtons() {
    const file = h("input", { type: "file", accept: "audio/*,.mp3,.wav,.ogg,.m4a", hidden: true });
    const add = h("button", { type: "button", class: "dj-pad dj-perf dj-add", text: "＋\nUpload", title: "Add your own sound (MP3, WAV, OGG or M4A up to 3 MB)" });
    add.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files[0]; file.value = "";
      if (!f) return;
      if (f.size > 3 * 1024 * 1024) return toast("Keep sounds short (up to 3 MB).");
      add.disabled = true; add.textContent = "…";
      await savePad(f, f.name.replace(/\.[^.]+$/, "").slice(0, 20));
    });
    const rec = h("button", { type: "button", class: "dj-pad dj-perf dj-add rec", text: "🎙\nRecord", title: "Record a sound with your mic (up to 10 seconds)" });
    let recorder = null;
    rec.addEventListener("click", async () => {
      if (recorder) return recorder.stop();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
        const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
        recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
        const chunks = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop()); clearTimeout(limit); clearInterval(tick);
          const blob = new Blob(chunks, { type: (recorder.mimeType || "audio/webm").split(";")[0] }); recorder = null;
          if (blob.size < 1000) { toast("That was too short."); return paint(); }
          rec.textContent = "…";
          const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
          await savePad(new File([blob], "recording." + ext, { type: blob.type }), "My recording");
        };
        recorder.start();
        let secs = 0; rec.classList.add("on"); rec.textContent = "⏺\n0s · stop";
        const tick = setInterval(() => { secs++; rec.textContent = `⏺\n${secs}s · stop`; }, 1000);
        const limit = setTimeout(() => recorder?.state === "recording" && recorder.stop(), 10000);
      } catch { recorder = null; toast("Allow the microphone to record a sound."); }
    });
    return [h("span", { class: "dj-add-wrap" }, add, file), rec];
  }
  async function savePad(f, name) {
    try { const { url } = await upload(f); const r = await apiCall("/api/me/dj-pads", { method: "POST", body: { url, name } }); myPads = r.pads; toast("Saved to your sounds."); paint(); if (r.pad) editPad(r.pad); }
    catch (err) { toast(err.error || "Couldn’t add it."); paint(); }
  }
  // Name, emoji, colour, volume and a keyboard key for one of my sounds
  function editPad(p) {
    const EMOJI = ["🎵", "🔥", "💥", "🎤", "📢", "😂", "🐐", "👑", "💀", "🚀", "⚡", "🎉", "🥁", "🎺", "🔔", "😈", "🫡", "💯", "🍑", "🐶", "🐱", "👽", "🤖", "❤️"];
    const COLORS = ["pink", "red", "orange", "gold", "lime", "mint", "teal", "sky", "blue", "purple", "white"];
    let look = { emoji: p.emoji, color: p.color || "pink" };
    const name = h("input", { class: "text-input", value: p.name, maxlength: 20, placeholder: "Name" });
    const emojis = h("div", { class: "dj-emoji-pick" }, ...EMOJI.map((e) => { const b = h("button", { type: "button", class: e === look.emoji ? "on" : "", text: e }); b.addEventListener("click", () => { look.emoji = e; [...emojis.children].forEach((x) => x.classList.toggle("on", x === b)); }); return b; }));
    const colors = h("div", { class: "dj-color-pick" }, ...COLORS.map((c) => { const b = h("button", { type: "button", class: "pc-" + c + (c === look.color ? " on" : ""), "aria-label": c }); b.addEventListener("click", () => { look.color = c; [...colors.children].forEach((x) => x.classList.toggle("on", x === b)); }); return b; }));
    const vol = h("input", { type: "range", min: 10, max: 150, value: Math.round((p.vol ?? 1) * 100), class: "dj-vol-range" });
    const volLbl = h("small", { text: vol.value + "%" }); vol.addEventListener("input", () => { volLbl.textContent = vol.value + "%"; });
    const key = h("input", { class: "text-input dj-key-input", value: (p.key || "").toUpperCase(), maxlength: 1, placeholder: "—" });
    const hear = h("button", { type: "button", class: "btn btn-outline-light", text: "▶ Hear it", onclick: () => playCustom(p.url, Number(vol.value) / 100) });
    const saveB = h("button", { type: "button", class: "btn btn-primary", text: "Save" });
    const del = h("button", { type: "button", class: "btn btn-danger-outline", text: "🗑 Delete" });
    const md = modal({ title: "Your sound", body: h("div", { class: "create-form dj-pad-edit" },
      h("label", { class: "field-label", text: "Name" }), name,
      h("label", { class: "field-label", text: "Emoji" }), emojis,
      h("label", { class: "field-label", text: "Pad colour" }), colors,
      h("label", { class: "field-label" }, "Volume ", volLbl), vol,
      h("label", { class: "field-label", text: "Keyboard key (press it to fire the sound while you DJ)" }), key,
      h("div", { class: "dj-edit-actions" }, hear, del, saveB)) });
    saveB.addEventListener("click", async () => {
      try { myPads = (await apiCall(`/api/me/dj-pads/${p.id}`, { method: "PATCH", body: { name: name.value, ...look, vol: Number(vol.value) / 100, key: key.value } })).pads; md.close(); paint(); }
      catch (err) { toast(err.error || "Couldn’t save it."); }
    });
    del.addEventListener("click", async () => {
      if (!del.dataset.sure) { del.dataset.sure = "1"; del.textContent = "Sure? Delete"; return; }
      try { myPads = (await apiCall(`/api/me/dj-pads/${p.id}`, { method: "DELETE" })).pads; md.close(); paint(); } catch {}
    });
  }
  // Keyboard: my sounds' keys and the piano keys
  const PIANO = "awsedftgyhujk";
  const onKey = (e) => {
    if (!box.isConnected) return removeEventListener("keydown", onKey);
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea, [contenteditable]") || box.closest("[hidden]")) return;
    if (api.dj()?.username !== state.me.username) return;
    const k = e.key.toLowerCase();
    if (tab === "keys" && PIANO.includes(k)) { e.preventDefault(); return send({ action: "fx", fx: "note", note: PIANO.indexOf(k) + octave * 12, inst }); }
    const p = myPads.find((x) => x.key === k);
    if (p) { e.preventDefault(); send({ action: "fx", fx: "custom", padId: p.id }); }
  };
  addEventListener("keydown", onKey);
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
  apiCall("/api/me/dj-pads").then((d) => { myPads = d.pads || []; padsLoaded = true; if (tab === "mine") paint(); }).catch(() => {});
  // Clocks, and auto-mix 12 seconds before the end
  const clock = setInterval(() => {
    if (!box.isConnected) return clearInterval(clock);
    if (!holding) { const t = box.querySelector(".tt:not(.dragging) .tt-time"); if (t) t.textContent = fmt(api.position()); const p = box.querySelector(".dj-pos"); if (p) p.textContent = fmt(api.position()); }
    const m = api.music(), d = api.dj();
    if (!autoMix || !m?.now || d?.username !== state.me.username || !m.queue?.length || mixing) return;
    const leftS = (api.duration?.() || 0) - api.position();
    if (leftS > 0 && leftS < 12) blend(m);
  }, 500);
  // The sequencer's moving light
  const head = () => {
    if (!box.isConnected) return;
    if (tab === "seq") { const i = beatOn()?.pattern === "custom" ? beatStep() : -1; box.querySelectorAll(".seq-step").forEach((c) => c.classList.toggle("now", Number(c.dataset.i) === i)); }
    requestAnimationFrame(head);
  };
  requestAnimationFrame(head);
  paint();
  return { el: box, paint };
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
