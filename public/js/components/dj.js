// DJ mode in a voice channel: one DJ at a time mixes the music that's playing (YouTube or LookBlog songs),
// and everyone in the channel hears it: speed, hot cues, loops, brake, fades into the next song,
// effect pads (airhorn, siren, scratch…) and a drum machine on top. The effects are made right in each
// person's browser at the same moment, so they sound the same for everyone.
import { h, toast } from "../ui.js";
import { api as apiCall, upload } from "../api.js";
import { state } from "../state.js";

let ctx = null, master = null;
function engine() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination); } catch { return null; }
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
function env(c, node, t, a, peak, d) { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); node.connect(g); g.connect(master); return g; }
function osc(c, type, f0, f1, t, dur, peak = 0.3, a = 0.01) {
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(c, o, t, a, peak, dur); o.start(t); o.stop(t + a + dur + 0.05); return o;
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
  fade() {},
};
export function playFx(name) { const c = engine(); if (c && FX[name]) try { FX[name](c, c.currentTime + 0.02); } catch {} }

/* ---------- Drum machine (in time for everyone: it starts from the same server moment) ---------- */
const PATTERNS = {
  house: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "..x...x...x...x." },
  hiphop: { kick: "x......xx.x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." },
  techno: { kick: "x...x...x...x...", snare: "........x.......", hat: "xxxxxxxxxxxxxxxx" },
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
      if (pat.kick[i] === "x") osc(c, "sine", 150, 40, nextAt, 0.25, 0.8, 0.002);
      if (pat.snare[i] === "x") { const s = noise(c, 0.18), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1500; s.connect(f); env(c, f, nextAt, 0.001, 0.35, 0.15); s.start(nextAt); osc(c, "triangle", 220, 180, nextAt, 0.1, 0.15); }
      if (pat.hat[i] === "x") { const s = noise(c, 0.05), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000; s.connect(f); env(c, f, nextAt, 0.001, 0.12, 0.04); s.start(nextAt); }
      n++; nextAt += step;
    }
  }, 25) };
}
export const beatOn = () => beat?.b || null;

/* ---------- The DJ console (inside the music window) ---------- */
// api: { post(body), music() → current music, position() → seconds, dj() → { username } | null }
export function djConsole(api) {
  const box = h("div", { class: "dj" });
  const cues = JSON.parse(sessionStorage.getItem("lb-dj-cues") || "{}");
  let setMode = false;
  const send = (b) => api.post({ kind: "dj", ...b }).catch((err) => toast(err.error || "Couldn’t do that."));
  function paint() {
    const dj = api.dj(), me = dj?.username === state.me.username, m = api.music();
    const lock = !me;
    const pad = (label, cls, fn, title) => { const b = h("button", { type: "button", class: "dj-pad " + cls, text: label, title: title || label, disabled: lock }); b.addEventListener("click", fn); return b; };
    const head = h("div", { class: "dj-head" },
      h("b", { text: "🎛 DJ Mode" }),
      dj ? h("span", { class: "dj-who" + (me ? " me" : ""), text: me ? "🎧 You’re the DJ" : `🎧 @${dj.username} is DJing` }) : h("span", { class: "muted", text: "Nobody is DJing" }),
      me ? h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Step down", onclick: () => send({ action: "release" }) })
        : h("button", { type: "button", class: "btn btn-xs btn-primary", text: dj ? "Take over" : "🎧 Take the decks", disabled: Boolean(dj), onclick: () => send({ action: "claim" }) }));
    const track = m?.now ? h("div", { class: "dj-deck" }, cassette(m, me),
      h("div", { class: "dj-track" }, h("b", { text: m.now.title }), h("small", { class: "muted", text: `${(m.rate || 1)}× speed${m.loop ? ` · 🔁 loop ${m.loop.len}s` : ""}` }),
        m.queue?.length ? h("small", { class: "muted", text: `Next: ${m.queue[0].title}` }) : h("small", { class: "muted", text: "Nothing queued next" }),
        me ? h("small", { class: "dj-hint", text: "↔ Drag the tape to scrub" }) : null))
      : h("p", { class: "muted", text: "Play a song first (YouTube or LookBlog), then mix it here." });
    // Crossfader: from what's playing (A) into the next song in the queue (B)
    const xf = h("input", { type: "range", min: 0, max: 100, value: Math.round((m?.mix?.x || 0) * 100), class: "dj-xfader", disabled: lock || !m?.now || (!m?.queue?.length && !m?.mix), "aria-label": "Crossfader" });
    let xfTimer;
    xf.addEventListener("input", () => { clearTimeout(xfTimer); xfTimer = setTimeout(() => send({ action: "mix", x: Number(xf.value) / 100 }), 120); });
    const mixRow = h("div", { class: "dj-mix" },
      h("span", { class: "dj-deck-lbl", title: m?.now?.title || "", text: "A · " + (m?.now?.title || "—") }),
      xf,
      h("span", { class: "dj-deck-lbl b", title: (m?.mix?.item || m?.queue?.[0])?.title || "", text: "B · " + ((m?.mix?.item || m?.queue?.[0])?.title || "queue a song") }));
    // Speed
    const speeds = h("div", { class: "dj-row" }, h("span", { class: "dj-lbl", text: "Tempo" }),
      ...[0.75, 1, 1.25, 1.5].map((r) => pad(r + "×", "dj-small" + ((m?.rate || 1) === r ? " on" : ""), () => send({ action: "rate", rate: r }))));
    // Hot cues: tap to jump (everyone); "Set" first to save the current moment
    const cueRow = h("div", { class: "dj-row" }, h("span", { class: "dj-lbl", text: "Cues" }),
      ...[1, 2, 3, 4].map((k) => pad(cues[m?.now?.id]?.[k] != null ? `${k} · ${fmt(cues[m.now.id][k])}` : `${k}`, "dj-cue" + (setMode ? " setting" : ""), () => {
        if (!m?.now) return;
        if (setMode || cues[m.now.id]?.[k] == null) {
          cues[m.now.id] = { ...(cues[m.now.id] || {}), [k]: api.position() };
          sessionStorage.setItem("lb-dj-cues", JSON.stringify(cues)); setMode = false; paint(); toast(`Cue ${k} set at ${fmt(api.position())}.`);
        } else send({ action: "cue", at: cues[m.now.id][k] });
      })),
      pad(setMode ? "Setting…" : "Set", "dj-small" + (setMode ? " on" : ""), () => { setMode = !setMode; paint(); }, "Save the current moment on a cue"));
    // Loops
    const loops = h("div", { class: "dj-row" }, h("span", { class: "dj-lbl", text: "Loop" }),
      ...[1, 2, 4, 8].map((sec) => pad(sec + "s", "dj-small" + (m?.loop?.len === sec ? " on" : ""), () => send({ action: "loop", seconds: sec }))),
      pad("Off", "dj-small", () => send({ action: "loop", seconds: 0 })));
    // Transport
    const transport = h("div", { class: "dj-row" },
      pad(m?.pausedAt == null ? "⏸ Pause" : "▶ Play", "dj-wide", () => api.post({ kind: "music", action: m?.pausedAt == null ? "pause" : "resume" })),
      pad("🛑 Brake", "dj-wide", () => send({ action: "fx", fx: "brake" })),
      pad("🌀 Mix to next", "dj-wide", async () => {
        if (!m?.queue?.length) return toast("Queue a song first, then mix into it.");
        await send({ action: "fx", fx: "fade" });
        setTimeout(() => api.post({ kind: "music", action: "skip" }).catch(() => {}), 2600);
      }, "Fade out and bring in the next song"));
    // Effect pads
    const fx = h("div", { class: "dj-pads" }, ...[["📯", "airhorn", "Airhorn"], ["🚨", "siren", "Siren"], ["💿", "scratch", "Scratch"], ["🔫", "laser", "Laser"], ["🚀", "riser", "Riser"], ["💥", "drop", "Drop"],
      ["⏪", "rewind", "Rewind"], ["👏", "clap", "Clap"], ["🎺", "horn", "Horn"], ["🔊", "boom", "Boom"]].map(([e, k, label]) => pad(`${e} ${label}`, "dj-fx", () => send({ action: "fx", fx: k }))));
    // Drum machine
    const b = beatOn();
    const bpm = h("input", { type: "range", min: 70, max: 180, value: b?.bpm || 124, class: "dj-bpm", disabled: lock });
    const bpmN = h("span", { class: "dj-bpm-n", text: (b?.bpm || 124) + " BPM" });
    bpm.addEventListener("input", () => { bpmN.textContent = bpm.value + " BPM"; });
    bpm.addEventListener("change", () => { if (beatOn()) send({ action: "beat", bpm: Number(bpm.value), pattern: beatOn().pattern }); });
    const beats = h("div", { class: "dj-row" }, h("span", { class: "dj-lbl", text: "Beat" }),
      ...["house", "hiphop", "techno"].map((p) => pad(p === "hiphop" ? "Hip-hop" : p[0].toUpperCase() + p.slice(1), "dj-small" + (b?.pattern === p ? " on" : ""), () => send({ action: "beat", bpm: Number(bpm.value), pattern: p }))),
      pad("Off", "dj-small", () => send({ action: "beat", bpm: 0 })));
    // My own effects (MP3s): tap to play for everyone, ＋ to add one
    const mine = h("div", { class: "dj-pads mine" },
      ...myPads.map((p) => {
        const b = pad(`${p.emoji} ${p.name}`, "dj-fx dj-mine", () => send({ action: "fx", fx: "custom", padId: p.id }));
        const del = h("span", { class: "dj-del", title: "Remove", text: "✕" });
        del.addEventListener("click", async (e) => { e.stopPropagation(); try { myPads = (await apiCall(`/api/me/dj-pads/${p.id}`, { method: "DELETE" })).pads; paint(); } catch {} });
        b.append(del);
        return b;
      }),
      (() => {
        const file = h("input", { type: "file", accept: "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a", hidden: true });
        const add = h("button", { type: "button", class: "dj-pad dj-fx dj-add", text: "＋ MP3", title: "Add your own effect (an MP3 up to 2 MB)" });
        add.addEventListener("click", () => file.click());
        file.addEventListener("change", async () => {
          const f = file.files[0]; file.value = "";
          if (!f) return;
          if (f.size > 2 * 1024 * 1024) return toast("Keep effects short (up to 2 MB).");
          add.disabled = true; add.textContent = "Uploading…";
          try {
            const { url } = await upload(f);
            myPads = (await apiCall("/api/me/dj-pads", { method: "POST", body: { url, name: f.name.replace(/\.[^.]+$/, "").slice(0, 20) } })).pads;
            toast("Your effect is on the decks.");
          } catch (err) { toast(err.error || "Couldn’t add it."); }
          paint();
        });
        return h("span", { class: "dj-add-wrap" }, add, file);
      })());
    box.replaceChildren(head, track,
      h("div", { class: "dj-console" + (lock ? " locked" : "") }, speeds, cueRow, loops, transport, h("b", { class: "dj-sec", text: "Mix (crossfader)" }), mixRow,
        h("b", { class: "dj-sec", text: "Effects" }), fx, h("b", { class: "dj-sec", text: "My effects" }), mine, beats, h("div", { class: "dj-row" }, h("span", { class: "dj-lbl", text: "" }), bpm, bpmN)),
      h("p", { class: "create-hint", text: lock ? "Only the DJ can use the decks. Everyone in the channel hears what the DJ does." : "Everyone in the voice channel hears everything you do here, at the same moment." }));
  }
  // The tape: its reels spin while the music plays (faster with more speed); the DJ drags it to scrub
  function cassette(m, me) {
    const playing = m.pausedAt == null;
    const tape = h("div", { class: "dj-tape" + (playing ? " spin" : "") + (me ? " grab" : ""), style: `--spin:${(1.6 / (m.rate || 1)).toFixed(2)}s` },
      h("div", { class: "dj-tape-label", text: m.now.title }),
      h("div", { class: "dj-reels" }, h("i", { class: "dj-reel" }), h("div", { class: "dj-window" }), h("i", { class: "dj-reel" })),
      h("div", { class: "dj-tape-time", text: fmt(api.position()) }));
    if (!me) return tape;
    let drag = null;
    tape.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, pos: api.position(), t: performance.now(), scratched: false }; tape.setPointerCapture(e.pointerId); tape.classList.add("dragging"); });
    tape.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, to = Math.max(0, drag.pos + dx / 12);
      tape.querySelector(".dj-tape-time").textContent = fmt(to);
      tape.style.setProperty("--turn", `${dx * 3}deg`);
      // A quick flick scratches (everyone hears it)
      const speed = Math.abs(e.movementX || 0);
      if (speed > 18 && !drag.scratched) { drag.scratched = true; send({ action: "fx", fx: "scratch" }); }
    });
    const end = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, to = Math.max(0, drag.pos + dx / 12);
      tape.classList.remove("dragging"); tape.style.removeProperty("--turn");
      if (Math.abs(dx) > 4) send({ action: "cue", at: to });
      drag = null;
    };
    tape.addEventListener("pointerup", end);
    tape.addEventListener("pointercancel", end);
    return tape;
  }
  let myPads = [];
  apiCall("/api/me/dj-pads").then((d) => { myPads = d.pads || []; paint(); }).catch(() => {});
  // The tape's clock keeps moving
  const clock = setInterval(() => { if (!box.isConnected) return clearInterval(clock); const t = box.querySelector(".dj-tape:not(.dragging) .dj-tape-time"); if (t) t.textContent = fmt(api.position()); }, 500);
  paint();
  return { el: box, paint };
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
