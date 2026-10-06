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
    else if (kind === "like") { tone(c, { from: 660, to: 990, dur: 0.09, vol: 0.07, type: "triangle" }); tone(c, { from: 990, to: 1480, at: 0.08, dur: 0.12, vol: 0.06, type: "triangle" }); }
  } catch {}
}

// Sounds for things that happen while you're on LookBlog: notifications, and messages for chats you don't have open
export function setupAlertSounds(me) {
  const wake = () => { engine(); removeEventListener("pointerdown", wake); removeEventListener("keydown", wake); };
  addEventListener("pointerdown", wake);
  addEventListener("keydown", wake);
  let last = 0;
  const play = (kind) => { if (Date.now() - last < 700) return; last = Date.now(); sfx(kind); }; // a burst of things = one sound
  on("notification", () => play("notify"));
  on("message", (ev) => {
    const m = ev.message;
    if (!m || m.mine || m.system || m.author?.username === me?.username) return;
    const open = document.querySelector(`.convo[data-wall-chat="${CSS.escape(ev.chatId)}"]`) && document.visibilityState === "visible";
    if (!open) play("message");
  });
}
