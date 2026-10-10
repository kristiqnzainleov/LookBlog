// Little sounds for messages, made in the browser (no files): a "whoosh" when you send, a "pop" for a heart.
// They are quiet. Browsers only allow sound once you've tapped or clicked somewhere on the page,
// so the sound engine wakes up on your first tap. You can turn the sounds off (bell menu → 🔊).
import { on } from "../state.js";
const OFF_KEY = "lb-sfx-off";
export const soundsOff = () => { try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; } };
export const setSoundsOff = (v) => { try { v ? localStorage.setItem(OFF_KEY, "1") : localStorage.removeItem(OFF_KEY); } catch {} };
let ctx = null;
function engine() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
function tone(c, { from, to, at = 0, dur = 0.12, vol = 0.07, type = "sine" }) {
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
export function sfx(kind) {
  if (soundsOff()) return;
  const c = engine();
  if (!c) return;
  try {
    if (kind === "send") { tone(c, { from: 380, to: 980, dur: 0.14, vol: 0.06 }); tone(c, { from: 1200, to: 1500, at: 0.07, dur: 0.08, vol: 0.025 }); }
    // A notification: a bright little chime (three notes going up)
    else if (kind === "notify") { tone(c, { from: 784, to: 784, dur: 0.14, vol: 0.06, type: "triangle" }); tone(c, { from: 988, to: 988, at: 0.1, dur: 0.14, vol: 0.06, type: "triangle" }); tone(c, { from: 1319, to: 1319, at: 0.2, dur: 0.26, vol: 0.06, type: "triangle" }); }
    // A new message: a soft "ding-dong"
    else if (kind === "message") { tone(c, { from: 1046, to: 1046, dur: 0.16, vol: 0.06 }); tone(c, { from: 784, to: 784, at: 0.12, dur: 0.24, vol: 0.055 }); }
    // A disappearing message or photo: a magic "poof" (a sparkle that rises, then fades away downwards)
    else if (kind === "vanish") {
      tone(c, { from: 520, to: 1560, dur: 0.18, vol: 0.05, type: "sine" });
      [1760, 2093, 2637].forEach((f, i) => tone(c, { from: f, to: f * 1.02, at: 0.12 + i * 0.05, dur: 0.12, vol: 0.03, type: "triangle" }));
      tone(c, { from: 1200, to: 300, at: 0.3, dur: 0.28, vol: 0.035, type: "sine" });
    }
    // Taking a reaction back: a short soft note going down
    else if (kind === "unlike") { tone(c, { from: 700, to: 380, dur: 0.13, vol: 0.05, type: "triangle" }); }
    else if (kind === "like") { tone(c, { from: 660, to: 990, dur: 0.09, vol: 0.07, type: "triangle" }); tone(c, { from: 990, to: 1480, at: 0.08, dur: 0.12, vol: 0.06, type: "triangle" }); }
  } catch {}
}

// People's own message sounds: one of these, or an MP3 they uploaded
export const SOUND_PRESETS = [["pop", "🫧", "Pop"], ["chime", "🎐", "Chime"], ["bubble", "💭", "Bubble"], ["coin", "🪙", "Coin"], ["laser", "🔫", "Laser"], ["bell", "🔔", "Bell"],
  ["drop", "💧", "Drop"], ["whoosh", "💨", "Whoosh"], ["harp", "🎼", "Harp"], ["game", "🎮", "Level up"], ["retro", "👾", "Retro"], ["kiss", "💋", "Kiss"], ["boing", "🤪", "Boing"],
  ["twinkle", "✨", "Twinkle"], ["bass", "🔊", "Bass"], ["magic", "🪄", "Magic"],
  ["cash", "💰", "Cash (ka-ching)"], ["coins", "🪙", "Coins falling"], ["airhorn", "📯", "Air horn"], ["quack", "🦆", "Quack"], ["doorbell", "🛎️", "Doorbell"],
  ["drum", "🥁", "Ba-dum-tss"], ["alarm", "🚨", "Alarm"], ["heartbeat", "💓", "Heartbeat"], ["tada", "🎉", "Ta-da"], ["phone", "📱", "Phone"], ["shark", "🦈", "Shark (dun-dun…)"]];
// A short burst of noise (for coins, cymbals, the "cha" of a cash register)
function noise(c, { at = 0, dur = 0.1, vol = 0.05, hp = 3000 }) {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = b; f.type = "highpass"; f.frequency.value = hp; g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(c.destination); src.start(c.currentTime + at);
}
export function playPreset(k) {
  const c = engine(); if (!c) return;
  const T = (o) => tone(c, o);
  try {
    if (k === "pop") T({ from: 600, to: 1400, dur: 0.08, vol: 0.08 });
    if (k === "chime") [1046, 1318, 1568].forEach((f, i) => T({ from: f, to: f, at: i * 0.09, dur: 0.35, vol: 0.05, type: "triangle" }));
    if (k === "bubble") { T({ from: 300, to: 900, dur: 0.12, vol: 0.06 }); T({ from: 500, to: 1300, at: 0.1, dur: 0.1, vol: 0.05 }); }
    if (k === "coin") { T({ from: 988, to: 988, dur: 0.08, vol: 0.05, type: "square" }); T({ from: 1319, to: 1319, at: 0.08, dur: 0.3, vol: 0.05, type: "square" }); }
    if (k === "laser") T({ from: 2000, to: 200, dur: 0.25, vol: 0.05, type: "sawtooth" });
    if (k === "bell") [880, 1760, 2640].forEach((f, i) => T({ from: f, to: f, dur: 0.9, vol: 0.05 / (i + 1) }));
    if (k === "drop") T({ from: 1400, to: 500, dur: 0.18, vol: 0.07 });
    if (k === "whoosh") T({ from: 200, to: 1200, dur: 0.35, vol: 0.04, type: "sawtooth" });
    if (k === "harp") [523, 659, 784, 1046, 1318].forEach((f, i) => T({ from: f, to: f, at: i * 0.06, dur: 0.4, vol: 0.04, type: "triangle" }));
    if (k === "game") [523, 659, 784, 1046].forEach((f, i) => T({ from: f, to: f, at: i * 0.07, dur: 0.12, vol: 0.045, type: "square" }));
    if (k === "retro") [440, 330, 660].forEach((f, i) => T({ from: f, to: f, at: i * 0.08, dur: 0.1, vol: 0.045, type: "square" }));
    if (k === "kiss") { T({ from: 1800, to: 900, dur: 0.06, vol: 0.06 }); T({ from: 2200, to: 1200, at: 0.12, dur: 0.06, vol: 0.05 }); }
    if (k === "boing") T({ from: 150, to: 600, dur: 0.4, vol: 0.07, type: "triangle" });
    if (k === "twinkle") [1568, 2093, 1760, 2349].forEach((f, i) => T({ from: f, to: f, at: i * 0.07, dur: 0.18, vol: 0.035 }));
    if (k === "bass") { T({ from: 120, to: 50, dur: 0.4, vol: 0.18 }); }
    if (k === "magic") [784, 988, 1175, 1568, 1976].forEach((f, i) => T({ from: f, to: f * 1.02, at: i * 0.05, dur: 0.3, vol: 0.03, type: "triangle" }));
    if (k === "cash") { noise(c, { dur: 0.09, vol: 0.06, hp: 2500 }); T({ from: 2637, to: 2637, at: 0.08, dur: 0.5, vol: 0.05 }); T({ from: 3520, to: 3520, at: 0.11, dur: 0.6, vol: 0.04 }); T({ from: 5274, to: 5274, at: 0.11, dur: 0.4, vol: 0.015 }); }
    if (k === "coins") for (let i = 0; i < 7; i++) { const f = 2000 + Math.random() * 1800; T({ from: f, to: f, at: i * 0.07 + Math.random() * 0.03, dur: 0.12, vol: 0.03 }); noise(c, { at: i * 0.07, dur: 0.03, vol: 0.02, hp: 5000 }); }
    if (k === "airhorn") for (let i = 0; i < 2; i++) [466, 470, 932].forEach((f) => T({ from: f, to: f * 0.98, at: i * 0.32, dur: 0.26, vol: 0.035, type: "sawtooth" }));
    if (k === "quack") { T({ from: 520, to: 380, dur: 0.16, vol: 0.06, type: "sawtooth" }); T({ from: 500, to: 360, at: 0.2, dur: 0.14, vol: 0.05, type: "sawtooth" }); }
    if (k === "doorbell") { T({ from: 659, to: 659, dur: 0.6, vol: 0.06, type: "triangle" }); T({ from: 523, to: 523, at: 0.45, dur: 0.8, vol: 0.06, type: "triangle" }); }
    if (k === "drum") { T({ from: 180, to: 60, dur: 0.15, vol: 0.12 }); T({ from: 160, to: 55, at: 0.18, dur: 0.15, vol: 0.12 }); noise(c, { at: 0.36, dur: 0.5, vol: 0.05, hp: 6000 }); }
    if (k === "alarm") for (let i = 0; i < 3; i++) T({ from: 880, to: 1320, at: i * 0.2, dur: 0.18, vol: 0.04, type: "square" });
    if (k === "heartbeat") [0, 0.18, 0.7, 0.88].forEach((at, i) => T({ from: i % 2 ? 50 : 65, to: 40, at, dur: 0.14, vol: 0.2 }));
    if (k === "tada") { [523, 659, 784].forEach((f, i) => T({ from: f, to: f, at: i * 0.07, dur: 0.12, vol: 0.04, type: "triangle" })); [1046, 1318, 1568].forEach((f) => T({ from: f, to: f, at: 0.25, dur: 0.6, vol: 0.035, type: "triangle" })); }
    // The shark: the two low notes from the film, getting faster… then a bite
    if (k === "shark") {
      [0, 0.5, 1.0, 1.35, 1.65, 1.88, 2.06, 2.2, 2.32, 2.43].forEach((at, i) => {
        const f = i % 2 ? 87.31 : 82.41;
        T({ from: f, to: f, at, dur: 0.28, vol: 0.09 + i * 0.008, type: "sawtooth" });
        T({ from: f * 2, to: f * 2, at, dur: 0.22, vol: 0.03, type: "triangle" });
      });
      T({ from: 220, to: 70, at: 2.58, dur: 0.25, vol: 0.14, type: "square" });
      noise(c, { at: 2.58, dur: 0.18, vol: 0.08, hp: 800 });
    }
    if (k === "phone") for (let i = 0; i < 8; i++) T({ from: i % 2 ? 480 : 440, to: i % 2 ? 480 : 440, at: i * 0.05, dur: 0.05, vol: 0.04 });
  } catch {}
}
const soundCache = new Map();
export function playMsgSound(snd, force = false) {
  if (!snd || (!force && soundsOff())) return false;
  if (snd.preset) { playPreset(snd.preset); return true; }
  if (!snd.url) return false;
  try { let a = soundCache.get(snd.url); if (!a) { a = new Audio(snd.url); soundCache.set(snd.url, a); } a.currentTime = 0; a.volume = 0.7; a.play().catch(() => {}); return true; } catch { return false; }
}

// Sounds for things that happen while you're on LookBlog: notifications, and every new message someone sends you
export function setupAlertSounds(me) {
  const wake = () => { engine(); removeEventListener("pointerdown", wake); removeEventListener("keydown", wake); };
  addEventListener("pointerdown", wake);
  addEventListener("keydown", wake);
  let last = 0;
  const play = (kind) => { if (Date.now() - last < 700) return; last = Date.now(); sfx(kind); }; // a burst of things = one sound
  // (if the person picked their own sound, that's the one you hear)
  const playFrom = (snd, kind) => { if (Date.now() - last < 700) return; last = Date.now(); if (!playMsgSound(snd)) sfx(kind); };
  on("notification", (ev) => (ev?.sound ? playFrom(ev.sound, "notify") : play("notify")));
  on("message", (ev) => {
    const m = ev.message;
    if (!m || m.mine || m.system || m.author?.username === me?.username) return;
    if (m.sound) playFrom(m.sound, "message"); else play("message");
  });
}
