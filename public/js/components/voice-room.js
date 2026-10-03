// Voice channels in groups (like Discord): everyone in a channel talks to everyone else.
// Each pair of people has its own WebRTC connection; the server only passes set-up messages along.
// You can mute, deafen, turn on your camera and share your screen.
import { h, icon, avatar, toast } from "../ui.js";
import { api } from "../api.js";
import { on, emit, state } from "../state.js";
import { setupMusic, applyMusic, openMusicPanel, leaveMusic, setMusicDeaf, musicState, musicNeedsTap, resumeMusic } from "./voice-music.js";

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
let room = null;
export const currentVoice = () => room && { chatId: room.chat.id, channelId: room.channel.id };
export const speakingNow = new Set();
// For checking a call from the browser console: how loud each person arrives
window.__lbVoiceLevels = async () => {
  if (!room) return null;
  const out = {};
  for (const [u, p] of room.peers) {
    const stats = await p.pc.getStats();
    stats.forEach((r) => { if (r.type === "inbound-rtp" && r.kind === "audio") out[u] = { energy: r.totalAudioEnergy || 0, level: r.audioLevel || 0 }; });
  }
  return out;
};

const post = (body) => api(`/api/groups/${room.chat.id}/voice`, { method: "POST", body: { channelId: room.channel.id, ...body } });

/* ---------- Joining and leaving ---------- */
export async function joinVoice(chat, channel) {
  if (room && room.chat.id === chat.id && room.channel.id === channel.id) return;
  if (window.__lbInCall?.()) return toast("Hang up your call first.");
  if (room) await leaveVoice();
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast("Your browser can’t do voice chat.");
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { return toast("LookBlog needs your microphone for voice channels."); }
  // What we send = microphone + soundboard, mixed together, so everyone hears the sounds through the call
  const mic = stream;
  let mix = null;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume?.();
    const micGain = ctx.createGain(), sfx = ctx.createGain(), dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(mic).connect(micGain);
    micGain.connect(dest);
    sfx.gain.value = 0.9;
    sfx.connect(dest);
    sfx.connect(ctx.destination); // and I hear my own sounds
    mix = { ctx, micGain, sfx };
    stream = dest.stream;
  } catch {}
  room = { chat, channel, stream, mic, mix, peers: new Map(), muted: false, deaf: false, video: null, people: [], ended: false };
  let others, joined;
  setupMusic({ send: (b) => post(b), changed: () => paintDock() });
  try { joined = await post({ kind: "join" }); others = joined.participants; }
  catch (err) { stream.getTracks().forEach((t) => t.stop()); room = null; return toast(err.error || "Couldn’t join the voice channel."); }
  buildDock();
  applyMusic(joined.music || null);
  watchLevel(state.me.username, mic);
  for (const p of others) peer(p.username); // I call everyone who is already here
  room.ping = setInterval(() => post({ kind: "ping" }).catch((err) => { if (/not in that voice/i.test(err.error || "")) leaveVoice(true); }), 15000);
  playTone(true);
  emit("voice:local", currentVoice());
}

export async function leaveVoice(silent) {
  if (!room) return;
  const r = room;
  room = null;
  r.ended = true;
  clearInterval(r.ping);
  clearInterval(r.place);
  for (const p of r.peers.values()) closePeer(p);
  r.stream.getTracks().forEach((t) => t.stop());
  r.mic.getTracks().forEach((t) => t.stop());
  r.mix?.ctx.close().catch(() => {});
  r.video?.track.stop();
  r.dock?.remove();
  leaveMusic();
  r.stage?.remove();
  stopLevels();
  if (!silent) api(`/api/groups/${r.chat.id}/voice`, { method: "POST", body: { kind: "leave", channelId: r.channel.id } }).catch(() => {});
  playTone(false);
  emit("voice:local", null);
}
// Leaving the page leaves the channel
addEventListener("pagehide", () => {
  if (!room) return;
  fetch(`/api/groups/${room.chat.id}/voice`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "X-LookBlog": "1" }, body: JSON.stringify({ kind: "leave", channelId: room.channel.id }) });
});

/* ---------- Connections to each person ---------- */
function peer(username) {
  if (room.peers.has(username)) return room.peers.get(username);
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const p = { username, pc, polite: state.me.username > username, makingOffer: false, ignoreOffer: false, inbox: Promise.resolve(), outbox: Promise.resolve(), audio: new Audio(), videoStream: null };
  p.audio.autoplay = true;
  p.audio.muted = room.deaf;
  room.peers.set(username, p);
  for (const t of room.stream.getAudioTracks()) pc.addTrack(t, room.stream);
  if (room.video) pc.addTrack(room.video.track, room.stream);
  // Perfect negotiation: either side may (re)negotiate; the "polite" one gives way on collisions
  pc.onnegotiationneeded = async () => {
    try {
      p.makingOffer = true;
      await pc.setLocalDescription();
      signal(p, { description: pc.localDescription });
    } catch {} finally { p.makingOffer = false; }
  };
  pc.onicecandidate = (e) => e.candidate && signal(p, { candidate: e.candidate.toJSON() });
  pc.ontrack = (e) => {
    const s = e.streams[0] || new MediaStream([e.track]);
    if (e.track.kind === "audio") { p.audio.srcObject = s; watchLevel(username, s); }
    else { p.videoStream = new MediaStream([e.track]); e.track.onunmute = paintStage; e.track.onended = paintStage; paintStage(); }
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") pc.restartIce(); };
  return p;
}
function closePeer(p) {
  p.pc.close();
  p.audio.srcObject = null;
  room?.peers.delete(p.username);
}
// Set-up messages go out one at a time so they arrive in order
function signal(p, data) {
  p.outbox = p.outbox.then(() => room && post({ kind: "signal", to: p.username, data }).catch(() => {}));
}
async function onSignal(ev) {
  if (!room || ev.chatId !== room.chat.id || ev.channelId !== room.channel.id) return;
  const p = peer(ev.from);
  p.inbox = p.inbox.then(async () => {
    const { pc } = p, d = ev.data || {};
    try {
      if (d.description) {
        const collision = d.description.type === "offer" && (p.makingOffer || pc.signalingState !== "stable");
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(d.description);
        if (d.description.type === "offer") {
          await pc.setLocalDescription();
          signal(p, { description: pc.localDescription });
        }
      } else if (d.candidate) {
        try { await pc.addIceCandidate(d.candidate); } catch (err) { if (!p.ignoreOffer) throw err; }
      }
    } catch (err) { console.warn("[voice]", err); }
  });
}
on("voice:signal", onSignal);
on("voice:left", (ev) => {
  if (!room || ev.chatId !== room.chat.id || ev.channelId !== room.channel.id) return;
  const p = room.peers.get(ev.username);
  if (p) closePeer(p);
  playTone(false, true);
  paintStage();
});
on("voice:kicked", (ev) => {
  if (!room || ev.chatId !== room.chat.id) return;
  leaveVoice(true);
  toast(`${ev.by} disconnected you from the voice channel.`);
});
on("voice:music", (ev) => {
  if (!room || ev.chatId !== room.chat.id || ev.channelId !== room.channel.id) return;
  applyMusic(ev.music);
});
on("voice:sound", (ev) => {
  if (!room || ev.chatId !== room.chat.id || ev.channelId !== room.channel.id) return;
  // The sound itself comes through the call (the person who pressed it mixes it into their audio)
  showSoundToast(ev);
});
const decoded = new Map(); // url -> AudioBuffer
async function playIntoRoom(s) {
  if (!room?.mix) { return s.builtin ? playBuiltin(s.builtin) : new Audio(s.url).play().catch(() => {}); }
  const { ctx, sfx } = room.mix;
  await ctx.resume?.();
  if (s.builtin) return playBuiltin(s.builtin, ctx, sfx);
  let buf = decoded.get(s.url);
  if (!buf) {
    buf = await ctx.decodeAudioData(await (await fetch(s.url)).arrayBuffer());
    decoded.set(s.url, buf);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(sfx);
  src.start();
}
on("group:changed", async (ev) => {
  if (!room || ev.chatId !== room.chat.id || ev.what !== "sounds") return;
  try { room.chat.sounds = (await api(`/api/chats/${room.chat.id}`)).chat.sounds; } catch {}
});
on("voice:state", (ev) => {
  if (!room || ev.chatId !== room.chat.id || ev.channelId !== room.channel.id) return;
  const before = room.people.length;
  room.people = ev.participants;
  if (ev.participants.length > before && before) playTone(true, true);
  paintDock();
  paintStage();
});

/* ---------- Mute, deafen, camera, screen ---------- */
// Muting silences only the microphone, so soundboard sounds still go out
function setMicOpen() {
  const open = !room.muted && !room.deaf;
  if (room.mix) room.mix.micGain.gain.value = open ? 1 : 0;
  else room.stream.getAudioTracks().forEach((t) => (t.enabled = open));
}
function setMuted(v) {
  room.muted = v;
  setMicOpen();
  post({ kind: "state", muted: v }).catch(() => {});
  paintDock();
}
function setDeaf(v) {
  room.deaf = v;
  setMusicDeaf(v);
  for (const p of room.peers.values()) p.audio.muted = v;
  setMicOpen();
  post({ kind: "state", deaf: v }).catch(() => {});
  paintDock();
}
async function setVideo(kind) {
  // kind: "camera" | "screen" | null (turn off)
  let track = null;
  if (kind) {
    try {
      const s = kind === "screen"
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
        : await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      track = s.getVideoTracks()[0];
    } catch { return toast(kind === "screen" ? "Screen sharing was cancelled." : "Camera isn’t available."); }
    if (!room) return track.stop();
    track.onended = () => { if (room?.video?.track === track) setVideo(null); };
  }
  const old = room.video?.track;
  for (const p of room.peers.values()) {
    const sender = p.pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender && track) await sender.replaceTrack(track);
    else if (sender) p.pc.removeTrack(sender);
    else if (track) p.pc.addTrack(track, room.stream);
  }
  old?.stop();
  room.video = track ? { track, kind } : null;
  post({ kind: "state", video: kind === "camera", screen: kind === "screen" }).catch(() => {});
  paintDock();
  paintStage();
}

/* ---------- Who is talking (green ring) ---------- */
let audioCtx = null, levelTimer = null;
const meters = new Map();
function watchLevel(username, stream) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(an);
    meters.set(username, { an, buf: new Uint8Array(an.fftSize) });
  } catch { return; }
  if (levelTimer) return;
  levelTimer = setInterval(() => {
    let changed = false;
    for (const [u, m] of meters) {
      m.an.getByteTimeDomainData(m.buf);
      let peak = 0;
      for (const v of m.buf) peak = Math.max(peak, Math.abs(v - 128));
      const talking = peak > 14 && !(u === state.me.username && (room?.muted || room?.deaf));
      if (talking !== speakingNow.has(u)) { talking ? speakingNow.add(u) : speakingNow.delete(u); changed = true; }
    }
    if (changed) { emit("voice:speaking", [...speakingNow]); paintSpeaking(); }
  }, 150);
}
function stopLevels() {
  clearInterval(levelTimer); levelTimer = null;
  meters.clear(); speakingNow.clear();
  emit("voice:speaking", []);
}
function paintSpeaking() {
  document.querySelectorAll("[data-voice-user]").forEach((el) => el.classList.toggle("speaking", speakingNow.has(el.dataset.voiceUser)));
}

/* ---------- Soundboard ---------- */
export const BUILTIN_SOUNDS = [
  { builtin: "airhorn", name: "Airhorn", emoji: "📯" }, { builtin: "tada", name: "Ta-da", emoji: "🎉" },
  { builtin: "drum", name: "Ba dum tss", emoji: "🥁" }, { builtin: "boing", name: "Boing", emoji: "🤪" },
  { builtin: "ding", name: "Ding", emoji: "🔔" }, { builtin: "sad", name: "Sad trombone", emoji: "😢" },
];
// The built-in sounds are made right here in the browser (no files)
// One audio engine for all previews (making a new one per sound runs out after a few and sounds start to break)
let previewCtx = null;
function previewEngine() {
  if (!previewCtx || previewCtx.state === "closed") previewCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (previewCtx.state === "suspended") previewCtx.resume().catch(() => {});
  return previewCtx;
}
function playBuiltin(id, shared = null, into = null) {
  try {
    const ctx = shared || previewEngine();
    const t0 = ctx.currentTime + 0.02, out = ctx.createGain();
    // A limiter at the end so loud sounds never crackle
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.002; limiter.release.value = 0.15;
    out.gain.value = 0.25;
    out.connect(limiter);
    limiter.connect(into || ctx.destination);
    const tone = (type, f1, f2, start, dur, vol = 1, dest = out) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f1, t0 + start);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + start + dur);
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.02);
      g.gain.setValueAtTime(vol, t0 + start + Math.max(0.03, dur - 0.06));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g); g.connect(dest);
      o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
    };
    const noise = (start, dur, vol = 1, hp = 4000) => {
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = "highpass"; f.frequency.value = hp; g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(out); src.start(t0 + start);
    };
    if (id === "airhorn") {
      // A real horn: a chord of brassy notes through a soft filter, three blasts (the last one long)
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 2400; lp.Q.value = 0.7;
      lp.connect(out);
      for (const [st, dur] of [[0, 0.24], [0.3, 0.24], [0.6, 0.85]]) {
        tone("sawtooth", 349, 0, st, dur, 0.45, lp);
        tone("sawtooth", 440, 0, st, dur, 0.35, lp);
        tone("sawtooth", 523, 0, st, dur, 0.3, lp);
        tone("square", 175, 0, st, dur, 0.15, lp);
      }
    }
    if (id === "tada") { tone("triangle", 523, 0, 0, 0.15); tone("triangle", 659, 0, 0.12, 0.15); tone("triangle", 784, 0, 0.24, 0.7); tone("triangle", 1046, 0, 0.24, 0.7, 0.6); }
    if (id === "drum") { tone("sine", 160, 60, 0, 0.18); tone("sine", 180, 70, 0.2, 0.18); noise(0.42, 0.6, 0.9, 6000); }
    if (id === "boing") tone("sine", 180, 720, 0, 0.5);
    if (id === "ding") { tone("sine", 1318, 0, 0, 1.2); tone("sine", 2636, 0, 0, 0.6, 0.3); }
    if (id === "sad") [[392, 0], [370, 0.35], [349, 0.7], [330, 1.05]].forEach(([f, st], i) => tone("sawtooth", f, i === 3 ? 290 : 0, st, i === 3 ? 1 : 0.32, 0.5));
    // tidy up the limiter chain once the sound is done
    setTimeout(() => { try { limiter.disconnect(); } catch {} }, 2600);
  } catch {}
}
function showSoundToast(ev) {
  const el = h("div", { class: "sound-toast" }, h("span", { text: ev.emoji || BUILTIN_SOUNDS.find((s) => s.builtin === ev.builtin)?.emoji || "🔊" }), h("span", {}, h("b", { text: ev.by }), ` played ${ev.name}`));
  document.body.append(el);
  setTimeout(() => el.classList.add("out"), 1800);
  setTimeout(() => el.remove(), 2200);
}
let boardEl = null;
function openSoundboard(anchor) {
  if (boardEl) { boardEl.remove(); boardEl = null; return; }
  const play = (s) => post({ kind: "sound", ...(s.builtin ? { builtin: s.builtin } : { soundId: s.id }) })
    .then(() => playIntoRoom(s))
    .catch((err) => toast(err.error || "Couldn’t play it."));
  const item = (s) => {
    const b = h("button", { type: "button", class: "sb-item" }, h("span", { class: "sb-emoji", text: s.emoji || "🔊" }), h("span", { class: "sb-name", text: s.name }));
    b.addEventListener("click", () => play(s));
    return b;
  };
  const mine = room.chat.sounds || [];
  boardEl = h("div", { class: "soundboard" },
    h("b", { class: "sb-title", text: "Soundboard" }),
    mine.length ? h("div", { class: "sb-grid" }, ...mine.map(item)) : null,
    h("span", { class: "sb-sub", text: "LookBlog sounds" }),
    h("div", { class: "sb-grid" }, ...BUILTIN_SOUNDS.map(item)),
    room.chat.perms?.includes("manage_sounds") ? h("p", { class: "sb-hint", text: "Add your own in Group settings → Sounds." }) : null);
  document.body.append(boardEl);
  const r = anchor.getBoundingClientRect();
  boardEl.style.left = Math.max(8, Math.min(r.left, innerWidth - 300)) + "px";
  boardEl.style.bottom = innerHeight - r.top + 8 + "px";
  setTimeout(() => {
    const away = (e) => { if (boardEl && !boardEl.contains(e.target) && !anchor.contains(e.target)) { boardEl.remove(); boardEl = null; document.removeEventListener("mousedown", away); } };
    document.addEventListener("mousedown", away);
  });
}
export const previewSound = (s) => (s.builtin ? playBuiltin(s.builtin) : new Audio(s.url).play().catch(() => {}));

/* ---------- Little sounds for join / leave ---------- */
function playTone(up, soft) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(up ? 520 : 660, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(up ? 780 : 420, ctx.currentTime + 0.18);
    g.gain.setValueAtTime(soft ? 0.04 : 0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.32);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

/* ---------- The "Voice connected" panel ---------- */
function buildDock() {
  room.dock = h("div", { class: "voice-dock", style: `--group:${room.chat.color || "#ff4fa3"}` });
  document.body.append(room.dock);
  paintDock();
  // Inside a group page it sits at the bottom of the channel list; anywhere else it floats
  room.place = setInterval(placeDock, 500);
}
export function placeDock() {
  if (!room?.dock) return;
  const slot = document.querySelector(".gv-dock-slot");
  if (slot && room.dock.parentElement !== slot) { slot.append(room.dock); room.dock.classList.add("in-slot"); }
  else if (!slot && room.dock.parentElement !== document.body) { document.body.append(room.dock); room.dock.classList.remove("in-slot"); }
}
function paintDock() {
  if (!room?.dock) return;
  const btn = (ic, title, on, fn, cls = "") => {
    const b = h("button", { type: "button", class: "vd-btn " + cls + (on ? " on" : ""), title, "aria-label": title, "aria-pressed": String(Boolean(on)) }, icon(ic));
    b.addEventListener("click", fn);
    return b;
  };
  room.dock.replaceChildren(
    h("div", { class: "vd-info" },
      h("span", { class: "vd-live" }, h("span", { class: "vd-dot" }), "Voice connected"),
      h("a", { class: "vd-where", href: `/messages/${room.chat.id}`, text: `${room.channel.name} / ${room.chat.name}` }),
      musicState()?.now ? (musicNeedsTap()
        ? h("button", { type: "button", class: "vd-now vd-tap", title: "Your browser paused the sound — tap to hear it", onclick: () => resumeMusic() }, "🔊 Tap to hear: " + musicState().now.title)
        : h("button", { type: "button", class: "vd-now", title: "Music", onclick: () => openMusicPanel() }, (musicState().pausedAt != null ? "⏸ " : "🎧 ") + musicState().now.title)) : null),
    h("div", { class: "vd-btns" },
      btn(room.muted ? "mute" : "mic", room.muted ? "Unmute" : "Mute", room.muted, () => setMuted(!room.muted)),
      btn("headphones", room.deaf ? "Undeafen" : "Deafen", room.deaf, () => setDeaf(!room.deaf)),
      btn("video", room.video?.kind === "camera" ? "Turn camera off" : "Turn camera on", room.video?.kind === "camera", () => setVideo(room.video?.kind === "camera" ? null : "camera")),
      btn("screen", room.video?.kind === "screen" ? "Stop sharing" : "Share your screen", room.video?.kind === "screen", () => setVideo(room.video?.kind === "screen" ? null : "screen")),
      (() => { const b = btn("sound", "Soundboard", false, () => openSoundboard(b)); return b; })(),
      btn("note", "Music", Boolean(musicState()?.now), () => openMusicPanel(), "vd-music"),
      btn("leave", "Leave voice", false, () => leaveVoice(), "danger")));
}

/* ---------- Video tiles (camera / screen) ---------- */
function paintStage() {
  if (!room) return;
  const tiles = [];
  const label = (u) => room.people.find((p) => p.username === u)?.name || u;
  if (room.video) tiles.push({ u: state.me.username, name: "You", stream: new MediaStream([room.video.track]), screen: room.video.kind === "screen", mine: true });
  for (const p of room.peers.values()) {
    const info = room.people.find((x) => x.username === p.username);
    const t = p.videoStream?.getVideoTracks()[0];
    if (t && t.readyState === "live" && !t.muted && info && (info.video || info.screen)) tiles.push({ u: p.username, name: label(p.username), stream: p.videoStream, screen: info.screen });
  }
  if (!tiles.length) { if (document.fullscreenElement === room.stage) document.exitFullscreen().catch(() => {}); room.stage?.remove(); room.stage = null; room.tileEls = null; return; }
  // Gets big on its own when two or more cameras are on (unless you made it small yourself)
  if (!room.stageChosen) room.stageMode = tiles.length > 1 ? "big" : "small";
  if (!room.stage) {
    room.stage = h("div", { class: "voice-stage" });
    room.tileEls = new Map();
    document.body.append(room.stage);
  }
  // Keep each person's <video> between repaints (no flicker)
  const els = room.tileEls;
  const keep = new Set();
  const tileEls = tiles.map((t) => {
    const key = t.u + (t.screen ? ":screen" : "");
    keep.add(key);
    let el = els.get(key);
    if (!el) {
      const v = h("video", { autoplay: true, playsInline: true, muted: true });
      el = h("div", { class: "vs-tile", dataset: { voiceUser: t.u } }, v, h("span", { class: "vs-name" }));
      el.addEventListener("click", () => { room.focus = room.focus === key ? null : key; if (room.stageMode === "small") room.stageMode = "big"; paintStage(); });
      els.set(key, el);
    }
    const v = el.querySelector("video");
    if (v.srcObject?.getVideoTracks()[0] !== t.stream.getVideoTracks()[0]) v.srcObject = t.stream;
    v.classList.toggle("mirror", Boolean(t.mine && !t.screen));
    el.classList.toggle("screen", Boolean(t.screen));
    el.classList.toggle("focused", room.focus === key);
    el.querySelector(".vs-name").textContent = (t.screen ? "🖥️ " : "") + t.name;
    return el;
  });
  for (const k of [...els.keys()]) if (!keep.has(k)) els.delete(k);
  if (room.focus && !keep.has(room.focus)) room.focus = null;
  const mode = room.stageMode;
  const n = tileEls.length;
  const cols = room.focus ? 1 : mode === "small" ? Math.min(n, 2) : n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  room.stage.className = `voice-stage ${mode}${room.focus ? " has-focus" : ""}`;
  room.stage.style.setProperty("--cols", cols);
  room.stage.style.setProperty("--rows", Math.ceil((room.focus ? 1 : n) / cols));
  const btn = (ic, title, fn) => { const b = h("button", { type: "button", class: "vs-btn", title, "aria-label": title }, ic.length > 2 ? icon(ic) : h("span", { text: ic })); b.addEventListener("click", (e) => { e.stopPropagation(); fn(); }); return b; };
  const bar = h("div", { class: "vs-bar" },
    h("span", { class: "vs-count", text: `📹 ${n}` }),
    btn(mode === "small" ? "expand" : "↙", mode === "small" ? "Make it bigger" : "Make it smaller", () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); room.stageMode = mode === "small" ? "big" : "small"; room.stageChosen = true; paintStage(); }),
    btn("⛶", "Full screen", () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else { room.stageMode = "big"; paintStage(); room.stage.requestFullscreen?.().catch(() => {}); } }));
  const focused = room.focus ? tileEls.find((el) => el.classList.contains("focused")) : null;
  const strip = focused ? h("div", { class: "vs-strip" }, ...tileEls.filter((el) => el !== focused)) : null;
  room.stage.replaceChildren(bar, ...(focused ? [focused, strip] : tileEls));
  for (const v of room.stage.querySelectorAll("video")) if (v.paused) v.play().catch(() => {});
  paintSpeaking();
}

// For the group page: a person's row in a voice channel
export function voicePerson(p, onKick) {
  const kick = onKick && p.username !== state.me.username ? h("button", { type: "button", class: "vc-kick", title: `Disconnect ${p.name}`, "aria-label": `Disconnect ${p.name}` }, icon("close")) : null;
  kick?.addEventListener("click", (e) => { e.stopPropagation(); onKick(p); });
  return h("div", { class: "vc-person" + (speakingNow.has(p.username) ? " speaking" : ""), dataset: { voiceUser: p.username } }, kick,
    avatar(p, 24), h("span", { class: "vc-name", text: p.name }),
    p.screen ? h("span", { class: "vc-flag live", text: "LIVE" }) : null,
    p.video ? h("span", { class: "vc-flag", title: "Camera on" }, icon("video")) : null,
    p.deaf ? h("span", { class: "vc-flag", title: "Deafened" }, icon("headphones")) : p.muted ? h("span", { class: "vc-flag", title: "Muted" }, icon("mute")) : null);
}
