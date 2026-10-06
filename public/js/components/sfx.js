// Little sounds for messages, made in the browser (no files): a "whoosh" when you send, a "pop" for a heart.
// They are quiet, and only play after something you did (browsers allow sound after a tap or a key).
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
  const c = engine();
  if (!c) return;
  try {
    if (kind === "send") { tone(c, { from: 380, to: 980, dur: 0.14, vol: 0.06 }); tone(c, { from: 1200, to: 1500, at: 0.07, dur: 0.08, vol: 0.025 }); }
    else if (kind === "like") { tone(c, { from: 660, to: 990, dur: 0.09, vol: 0.07, type: "triangle" }); tone(c, { from: 990, to: 1480, at: 0.08, dur: 0.12, vol: 0.06, type: "triangle" }); }
  } catch {}
}
