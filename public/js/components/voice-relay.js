// Voice relay: the fallback for when two people in a voice channel can't connect directly
// (some mobile and office networks block it, and LookBlog has no TURN server).
// Their voices then go through Supabase Realtime instead: telephone quality (8 kHz, μ-law),
// in 250 ms pieces, and only while someone is actually talking.
import { realtimeLink } from "../realtime.js";
import { audioEngine } from "./audio-devices.js";
import { h } from "../ui.js";

const RATE = 8000, CHUNK = 2000; // 2000 samples at 8 kHz = 250 ms
const WORKLETS = `
class Cap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${CHUNK}); this.n = 0; this.acc = 0; this.cnt = 0; this.step = sampleRate / ${RATE}; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++; this.pos++;
      if (this.pos >= this.step) {
        this.pos -= this.step;
        this.buf[this.n++] = this.acc / this.cnt; this.acc = 0; this.cnt = 0;
        if (this.n === ${CHUNK}) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("lb-cap", Cap);
class Play extends AudioWorkletProcessor {
  constructor() {
    super(); this.q = []; this.cur = null; this.i = 0; this.frac = 0; this.step = ${RATE} / sampleRate; this.started = false;
    this.port.onmessage = (e) => { this.q.push(e.data); if (this.q.length > 8) this.q.splice(0, this.q.length - 3); };
  }
  process(_, outputs) {
    const out = outputs[0][0];
    if (!this.started) { if (this.q.length < 2) { out.fill(0); return true; } this.started = true; }
    for (let k = 0; k < out.length; k++) {
      if (!this.cur || this.i >= this.cur.length - 1) {
        this.cur = this.q.shift() || null; this.i = 0; this.frac = 0;
        if (!this.cur) { this.started = false; out.fill(0, k); return true; }
      }
      const a = this.cur[this.i], b = this.cur[this.i + 1] ?? a;
      out[k] = a + (b - a) * this.frac;
      this.frac += this.step;
      while (this.frac >= 1) { this.frac -= 1; this.i++; }
    }
    return true;
  }
}
registerProcessor("lb-play", Play);`;

// μ-law: 8 bits per sample, the classic telephone format
function encode(f32) {
  const out = new Uint8Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    let x = Math.max(-1, Math.min(1, f32[i])) * 32635;
    const sign = x < 0 ? 0x80 : 0;
    if (sign) x = -x;
    x += 132;
    let exp = 7;
    for (let m = 0x4000; (x & m) === 0 && exp > 0; m >>= 1) exp--;
    const mant = (x >> (exp + 3)) & 0x0f;
    out[i] = ~(sign | (exp << 4) | mant) & 0xff;
  }
  return out;
}
function decode(u8) {
  const out = new Float32Array(u8.length);
  for (let i = 0; i < u8.length; i++) {
    const v = ~u8[i] & 0xff, sign = v & 0x80, exp = (v >> 4) & 7, mant = v & 0x0f;
    const x = (((mant << 3) + 132) << exp) - 132;
    out[i] = (sign ? -x : x) / 32635;
  }
  return out;
}
const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const peakOf = (f) => { let p = 0; for (let i = 0; i < f.length; i++) p = Math.max(p, Math.abs(f[i])); return p; };

let relay = null;
export const relayLoud = new Map(); // username -> time their voice last arrived loud (for the green ring)

export async function startRelay({ topic, me, mic, box, speakerId }) {
  stopRelay();
  if (!topic || !realtimeLink.ready || !window.AudioWorkletNode) return;
  const ctx = audioEngine();
  if (!ctx.__lbRelay) {
    ctx.__lbRelay = ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLETS], { type: "text/javascript" })));
  }
  await ctx.__lbRelay;
  const r = relay = { topic, me, ctx, box, speakerId, wantFrom: new Set(), sendTo: new Set(), players: new Map(), muted: false, deaf: false, hang: 0, src: null, cap: null, keep: null };
  // My microphone, cut into pieces
  r.cap = new AudioWorkletNode(ctx, "lb-cap");
  const sink = ctx.createGain(); sink.gain.value = 0;
  r.cap.connect(sink); sink.connect(ctx.destination);
  r.cap.port.onmessage = (e) => {
    if (relay !== r || !r.sendTo.size || r.muted) return;
    const f = e.data, loud = peakOf(f) > 0.02;
    if (loud) r.hang = 3; else if (r.hang > 0) r.hang--; else return; // only while talking (and a moment after)
    realtimeLink.send(topic, "a", { from: me, d: toB64(encode(f)) });
  };
  setMic(mic);
  realtimeLink.join(topic, (event, p) => {
    if (relay !== r || !p) return;
    if (event === "req" && p.to === me) { r.sendTo.add(p.from); need(p.from); } // they can't reach me directly: send to them, and listen to them
    else if (event === "stop" && p.to === me) r.sendTo.delete(p.from);
    else if (event === "a" && r.wantFrom.has(p.from) && !r.deaf) play(p.from, p.d);
    else if (event === "v" && r.wantFrom.has(p.from)) videoHandler?.(p.from, p);
    else if (event === "voff" && r.wantFrom.has(p.from)) videoHandler?.(p.from, null);
  });
  // Ask again every few seconds, in case a request got lost
  r.keep = setInterval(() => { for (const u of r.wantFrom) realtimeLink.send(topic, "req", { from: me, to: u }); }, 5000);
}

function play(user, b64) {
  const r = relay;
  let pl = r.players.get(user);
  if (!pl) {
    const node = new AudioWorkletNode(r.ctx, "lb-play", { outputChannelCount: [1] });
    const dest = r.ctx.createMediaStreamDestination();
    node.connect(dest);
    // Out through an <audio>, like everyone else's voice
    const audio = h("audio", { autoplay: true, playsInline: true });
    audio.srcObject = dest.stream;
    if (r.speakerId && audio.setSinkId) audio.setSinkId(r.speakerId).catch(() => {});
    r.box?.append(audio);
    audio.play().catch(() => {});
    pl = { node, dest, audio };
    if (relayVols.has(user)) audio.volume = Math.min(1, relayVols.get(user));
    r.players.set(user, pl);
  }
  const f = decode(fromB64(b64));
  if (peakOf(f) > 0.03) relayLoud.set(user, Date.now());
  pl.node.port.postMessage(f);
}

// Two people couldn't connect directly: hear each other through the relay
export function need(user) {
  const r = relay;
  if (!r || r.wantFrom.has(user)) return;
  r.wantFrom.add(user);
  r.sendTo.add(user);
  realtimeLink.send(r.topic, "req", { from: r.me, to: user });
}
// They connected directly after all (or left): stop
export function unneed(user) {
  const r = relay;
  if (!r) return;
  if (r.wantFrom.delete(user)) realtimeLink.send(r.topic, "stop", { from: r.me, to: user });
  r.sendTo.delete(user);
  const pl = r.players.get(user);
  if (pl) { pl.node.disconnect(); pl.audio.srcObject = null; pl.audio.remove(); r.players.delete(user); }
  relayLoud.delete(user);
}
export const relaying = (user) => Boolean(relay?.wantFrom.has(user));

export function setMic(stream) {
  const r = relay;
  if (!r || !stream) return;
  try { r.src?.disconnect(); } catch {}
  r.src = r.ctx.createMediaStreamSource(stream);
  r.src.connect(r.cap);
}
export function setRelayMuted(v) { if (relay) relay.muted = v; }
// How loud each person is for me (0–1 here; a boost above 100% only works over a direct connection)
const relayVols = new Map();
export function setRelayUserVolume(user, v) { relayVols.set(user, v); const pl = relay?.players.get(user); if (pl) pl.audio.volume = Math.min(1, v); }
export function setRelayDeaf(v) { if (relay) { relay.deaf = v; for (const pl of relay.players.values()) pl.audio.muted = v; } }
export function setRelaySpeaker(id) { if (relay) { relay.speakerId = id; for (const pl of relay.players.values()) pl.audio.setSinkId?.(id || "").catch(() => {}); } }
export function wakeRelay() { if (relay) for (const pl of relay.players.values()) if (pl.audio.paused) pl.audio.play().catch(() => {}); }

/* ---------- Video through the relay (camera or screen, a few pictures a second) ----------
   Only for people we can't reach directly; everyone else gets real video over the direct connection. */
let videoHandler = null;
export const onRelayVideo = (fn) => { videoHandler = fn; };
let vidLoop = null;
export function setRelayVideo(track, kind) {
  clearInterval(vidLoop); vidLoop = null;
  const r = relay;
  if (!r) return;
  if (!track) { for (const u of r.sendTo) realtimeLink.send(r.topic, "voff", { from: r.me, to: u }); return; }
  const v = h("video", { muted: true, playsInline: true, autoplay: true });
  v.srcObject = new MediaStream([track]);
  v.play().catch(() => {});
  const c = document.createElement("canvas"), g = c.getContext("2d");
  const maxW = kind === "screen" ? 960 : 360, every = kind === "screen" ? 600 : 250, q = kind === "screen" ? 0.55 : 0.6;
  let busy = false;
  vidLoop = setInterval(() => {
    if (relay !== r || busy || !r.sendTo.size || !v.videoWidth || track.readyState !== "live") return;
    const w = Math.min(maxW, v.videoWidth), hh = Math.round((w / v.videoWidth) * v.videoHeight);
    c.width = w; c.height = hh;
    g.drawImage(v, 0, 0, w, hh);
    busy = true;
    c.toBlob(async (blob) => {
      busy = false;
      if (!blob || relay !== r) return;
      const b64 = toB64(new Uint8Array(await blob.arrayBuffer()));
      realtimeLink.send(r.topic, "v", { from: r.me, kind, w, h: hh, d: b64 });
    }, "image/jpeg", q);
  }, every);
  track.addEventListener("ended", () => { if (vidLoop) setRelayVideo(null); });
}

export function stopRelay() {
  const r = relay;
  if (!r) return;
  clearInterval(vidLoop); vidLoop = null;
  relay = null;
  clearInterval(r.keep);
  for (const u of [...r.wantFrom]) realtimeLink.send(r.topic, "stop", { from: r.me, to: u });
  for (const pl of r.players.values()) { pl.node.disconnect(); pl.audio.srcObject = null; pl.audio.remove(); }
  try { r.src?.disconnect(); r.cap?.disconnect(); } catch {}
  realtimeLink.leave(r.topic);
  relayLoud.clear();
}
