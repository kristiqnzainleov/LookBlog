// Voice channels in groups (like Discord): everyone in a channel talks to everyone else.
// Each pair of people has its own WebRTC connection; the server only passes set-up messages along.
// You can mute, deafen, turn on your camera and share your screen.
import { h, icon, avatar, toast, tick, modal } from "../ui.js";
import { api } from "../api.js";
import { on, emit, state } from "../state.js";
import { setupMusic, applyMusic, openMusicPanel, leaveMusic, setMusicDeaf, musicState, musicNeedsTap, resumeMusic } from "./voice-music.js";
import { getMic, audioPrefs, audioEngine, iceServers, openAudioSettings } from "./audio-devices.js";
import * as relay from "./voice-relay.js";
let room = null;
export const currentVoice = () => room && { chatId: room.chat.id, channelId: room.channel.id };
export const speakingNow = new Set();
// For checking a call from the browser console: how loud each person arrives
window.__lbVoicePeers = () => (room ? [...room.peers.values()] : []);
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
  // Start the sound engine right at the tap (phones only allow sound after one)
  audioEngine();
  // We send the microphone itself (soundboard sounds are played by everyone's own browser instead,
  // so nothing can go silent if the browser pauses its sound engine)
  let mic;
  try { mic = await getMic(); }
  catch { return toast("LookBlog needs your microphone for voice channels."); }
  const ice = await iceServers();
  const audioBox = h("div", { class: "vr-audio", "aria-hidden": "true" });
  document.body.append(audioBox);
  room = { chat, channel, stream: mic, mic, ice, audioBox, peers: new Map(), muted: false, deaf: false, video: null, people: [], ended: false, needsTap: false };
  watchMicEnd();
  let others, joined;
  setupMusic({ send: (b) => post(b), changed: () => paintDock() });
  try { joined = await post({ kind: "join" }); others = joined.participants; }
  catch (err) { mic.getTracks().forEach((t) => t.stop()); audioBox.remove(); room = null; return toast(err.error || "Couldn’t join the voice channel."); }
  buildDock();
  applyMusic(joined.music || null);
  watchLocal(mic);
  // The fallback for people we can't reach directly
  relay.startRelay({ topic: joined.relayTopic, me: state.me.username, mic, box: audioBox, speakerId: audioPrefs().speakerId }).catch((err) => console.warn("[relay]", err));
  for (const p of others) peer(p.username); // I call everyone who is already here
  room.ping = setInterval(() => post({ kind: "ping" }).then((r) => syncPeople(r.participants)).catch((err) => { if (/not in that voice/i.test(err.error || "")) leaveVoice(true); }), 15000);
  playTone(true);
  emit("voice:local", currentVoice());
}

export async function leaveVoice(silent) {
  if (!room) return;
  const r = room;
  room = null;
  reactBar?.remove(); reactBar = null;
  r.ended = true;
  clearInterval(r.ping);
  clearInterval(r.place);
  relay.stopRelay();
  for (const p of r.peers.values()) closePeer(p);
  r.mic.getTracks().forEach((t) => t.stop());
  r.audioBox?.remove();
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
  // (window.__lbForceRelay: for testing, make direct connections impossible)
  const pc = new RTCPeerConnection(window.__lbForceRelay ? { iceServers: [], iceTransportPolicy: "relay" } : { iceServers: room.ice, iceCandidatePoolSize: 2 });
  // Their voice plays in an <audio> on the page (phones are pickier about ones that aren't)
  const audio = h("audio", { autoplay: true, playsInline: true });
  room.audioBox.append(audio);
  const p = { username, pc, polite: state.me.username > username, makingOffer: false, ignoreOffer: false, inbox: Promise.resolve(), outbox: Promise.resolve(), audio, videoStream: null };
  p.audio.muted = room.deaf;
  const spk = audioPrefs().speakerId;
  if (spk && audio.setSinkId) audio.setSinkId(spk).catch(() => {});
  room.peers.set(username, p);
  for (const t of room.stream.getAudioTracks()) pc.addTrack(t, room.stream);
  if (room.video) pc.addTrack(room.video.track, room.stream);
  // Perfect negotiation: either side may (re)negotiate; the "polite" one gives way on collisions.
  // The connection details (ICE candidates) go inside the offer/answer itself, in one message:
  // separate candidate messages can arrive in the wrong order online and get lost.
  pc.onnegotiationneeded = async () => {
    try {
      p.makingOffer = true;
      await pc.setLocalDescription();
      await gathered(pc);
      signal(p, { description: pc.localDescription });
    } catch {} finally { p.makingOffer = false; }
  };
  // Not connected after 8 seconds: talk through the relay meanwhile
  setTimeout(() => { if (room && room.peers.get(username) === p && pc.connectionState !== "connected") relay.need(username); }, 8000);
  // If it isn't connected in 10 seconds, try again (up to 3 times)
  p.tries = 0;
  const watch = () => setTimeout(() => {
    if (!room || room.peers.get(username) !== p || pc.connectionState === "connected" || pc.connectionState === "closed" || p.tries >= 3) return;
    p.tries++;
    pc.restartIce();
    watch();
  }, 10000);
  watch();
  pc.ontrack = (e) => {
    const s = e.streams[0] || new MediaStream([e.track]);
    if (e.track.kind === "audio") { p.audio.srcObject = s; playAudio(p.audio); }
    else { p.videoStream = new MediaStream([e.track]); e.track.onunmute = paintStage; e.track.onended = paintStage; paintStage(); }
  };
  // A dropped connection tries again on its own
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") relay.unneed(username); // direct works: no relay needed
    if (pc.connectionState === "failed") { relay.need(username); pc.restartIce(); }
    if (pc.connectionState === "disconnected") setTimeout(() => { if (pc.connectionState === "disconnected") pc.restartIce(); }, 4000);
  };
  return p;
}
function closePeer(p) {
  relay.unneed(p.username);
  p.pc.close();
  p.audio.srcObject = null;
  p.audio.remove();
  room?.peers.delete(p.username);
}
// Wait until the browser has found its ways to be reached (or 3 seconds, whichever comes first)
function gathered(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((ok) => {
    const done = () => { pc.removeEventListener("icegatheringstatechange", check); clearTimeout(t); ok(); };
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    pc.addEventListener("icegatheringstatechange", check);
    const t = setTimeout(done, 3000);
  });
}
// Play someone's voice; if the browser blocks it, show a "Tap to hear" button
function playAudio(a) {
  a.play().then(() => { if (room?.needsTap && [...room.peers.values()].every((p) => !p.audio.paused || !p.audio.srcObject)) { room.needsTap = false; paintDock(); } })
    .catch(() => { if (room && !room.needsTap) { room.needsTap = true; paintDock(); } });
}
// Any tap on the page while in voice wakes the sound up again (phones pause it when they feel like it)
function wakeAudio() {
  if (!room) return;
  audioEngine();
  for (const p of room.peers.values()) if (p.audio.srcObject && p.audio.paused) playAudio(p.audio);
  relay.wakeRelay();
}
addEventListener("pointerdown", wakeAudio, true);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wakeAudio(); });

/* ---------- The microphone ---------- */
// Use another microphone (from Voice settings, or when the one in use is unplugged)
async function switchMic() {
  if (!room) return;
  let s;
  try { s = await getMic(); } catch { return toast("Couldn’t use that microphone."); }
  if (!room) return s.getTracks().forEach((t) => t.stop());
  const track = s.getAudioTracks()[0];
  for (const p of room.peers.values()) {
    const sender = p.pc.getSenders().find((x) => x.track?.kind === "audio");
    if (sender) await sender.replaceTrack(track).catch(() => {});
  }
  const old = room.mic;
  room.mic = s;
  room.stream = s;
  old.getTracks().forEach((t) => t.stop());
  relay.setMic(s);
  setMicOpen();
  watchLocal(s);
  watchMicEnd();
}
function watchMicEnd() {
  const t = room?.mic.getAudioTracks()[0];
  if (t) t.onended = () => { if (room?.mic.getAudioTracks()[0] === t) { toast("Your microphone disconnected. Switching to another one."); switchMic(); } };
}
navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
  if (!room) return;
  const t = room.mic.getAudioTracks()[0];
  if (!t || t.readyState === "ended") return switchMic();
  // The microphone picked in settings was plugged back in: use it
  const want = audioPrefs().micId;
  if (want && t.getSettings().deviceId !== want) {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    if (all.some((d) => d.deviceId === want)) switchMic();
  }
});
function setSpeaker(id) {
  if (!room) return;
  relay.setRelaySpeaker(id);
  for (const p of room.peers.values()) if (p.audio.setSinkId) p.audio.setSinkId(id || "").catch(() => {});
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
        // Candidates that came early (from an older version of the page) go in now
        for (const c of (p.early || []).splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (d.description.type === "offer") {
          await pc.setLocalDescription();
          await gathered(pc);
          signal(p, { description: pc.localDescription });
        }
      } else if (d.candidate) {
        if (!pc.remoteDescription) { (p.early = p.early || []).push(d.candidate); return; }
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
  // Everyone's browser plays the sound itself (the one who pressed it already heard it)
  if (ev.username !== state.me.username) playSoundHere(ev);
  showSoundToast(ev);
});
/* ---------- Invite people from the group who aren't in the channel ---------- */
let inviteList = null;
async function openVoiceInvite() {
  if (!room) return;
  const list = h("div", { class: "vi-list" });
  const sent = new Set();
  let members = [];
  const inviteAll = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "Invite everyone online" });
  const paint = () => {
    if (!room) return list.replaceChildren(h("p", { class: "muted", text: "You left the voice channel." }));
    const here = new Set(room.people.map((p) => p.username).concat(state.me.username));
    // Not in the channel (people who join drop off this list by themselves)
    const out = members.filter((u) => !here.has(u.username)).sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)) || a.name.localeCompare(b.name));
    inviteAll.hidden = !out.some((u) => u.online && !sent.has(u.username));
    list.replaceChildren(...(out.length ? out.map((u) => {
      const b = h("button", { type: "button", class: "btn btn-xs " + (sent.has(u.username) ? "btn-outline-light" : "btn-primary"), text: sent.has(u.username) ? "Invited ✓" : "Invite", disabled: sent.has(u.username) });
      b.addEventListener("click", () => send([u.username]));
      return h("div", { class: "conn-row vi-row" }, avatar(u, 38),
        h("div", { class: "who" }, h("b", {}, u.nickname || u.name, tick(u, 13)), h("span", { class: "muted" }, u.online ? h("span", { class: "vi-on", text: "● Online" }) : "Offline", " · @" + u.username)), b);
    }) : [h("p", { class: "muted", text: "Everyone from the group is already here 🎉" })]));
  };
  const send = async (names) => {
    try {
      const { invited } = await post({ kind: "invite", usernames: names });
      invited.forEach((n) => sent.add(n));
      toast(invited.length === 1 ? `Invited @${invited[0]}.` : `Invited ${invited.length} people.`);
    } catch (err) { toast(err.error || "Couldn’t invite them."); }
    paint();
  };
  inviteAll.addEventListener("click", () => send(members.filter((u) => u.online && !sent.has(u.username) && !room.people.some((p) => p.username === u.username)).map((u) => u.username)));
  const m = modal({ title: `Invite to 🔊 ${room.channel.name}`, onClose: () => { inviteList = null; }, body: h("div", { class: "create-form vi" },
    h("p", { class: "create-hint", text: "They get a pop-up to join you right away (and a notification if they’re away)." }), inviteAll, list) });
  list.append(h("p", { class: "muted", text: "Loading…" }));
  try {
    const d = await api(`/api/chats/${room.chat.id}`);
    members = ((d.chat || d).members || []).filter((u) => !u.isMe);
  } catch { members = (room.chat.members || []).filter((u) => !u.isMe); }
  inviteList = paint;
  paint();
  return m;
}

// Someone invites me into their voice channel: a pop-up to join right away
on("voice:invite", (ev) => {
  if (room && room.chat.id === ev.chatId && room.channel.id === ev.channelId) return;
  document.querySelector(".vi-pop")?.remove();
  import("./sfx.js").then((x) => x.sfx("notify")).catch(() => {});
  const join = h("button", { type: "button", class: "btn btn-primary btn-sm", text: "Join" });
  const no = h("button", { type: "button", class: "btn btn-outline-light btn-sm", text: "Not now" });
  const pop = h("div", { class: "vi-pop", role: "alertdialog", "aria-label": "Voice channel invite", style: ev.color ? `--group:${ev.color}` : "" },
    avatar(ev.by, 46),
    h("div", { class: "vi-pop-text" }, h("b", { text: `${ev.by.name} invites you` }), h("span", { text: `🔊 ${ev.channel} · ${ev.group}` }), ev.inside ? h("small", { class: "muted", text: `${ev.inside} ${ev.inside === 1 ? "person is" : "people are"} talking` }) : null),
    h("div", { class: "vi-pop-btns" }, no, join));
  const close = () => { pop.classList.add("out"); setTimeout(() => pop.remove(), 250); };
  no.addEventListener("click", close);
  join.addEventListener("click", async () => {
    close();
    try {
      const d = await api(`/api/chats/${ev.chatId}`);
      const chat = d.chat || d;
      const ch = chat.channels?.find((c) => c.id === ev.channelId);
      if (location.pathname !== `/messages/${ev.chatId}`) import("../router.js").then((r) => r.navigate(`/messages/${ev.chatId}`));
      if (ch) joinVoice(chat, ch);
    } catch (err) { toast(err.error || "Couldn’t join."); }
  });
  document.body.append(pop);
  setTimeout(() => pop.isConnected && close(), 30000);
});

/* ---------- Reactions while you talk (on someone's camera or screen, or just to the channel) ---------- */
export const VOICE_REACTIONS = ["❤️", "😂", "🔥", "👏", "😮", "😢", "💯", "🎉", "👀", "🤯"];
// Who a reaction is for: the stream you're looking at, or the only one that's on
function reactTarget() {
  if (!room) return null;
  const f = room.focus?.split(":")[0];
  if (f && f !== state.me.username) return f;
  const live = [...(room.tileEls?.keys() || [])].map((k) => k.split(":")[0]).filter((u) => u !== state.me.username);
  return new Set(live).size === 1 ? live[0] : null;
}
function sendReaction(emoji, to) {
  if (!room) return;
  const ev = { chatId: room.chat.id, channelId: room.channel.id, by: state.me.name, username: state.me.username, emoji, to: to || null, mine: true };
  showReaction(ev);
  post({ kind: "react", emoji, to: to || null }).catch((err) => toast(err.error || "Couldn’t react."));
}
let reactBar = null;
function openReactBar(anchor, to) {
  if (reactBar) { reactBar.remove(); const same = reactBar._anchor === anchor; reactBar = null; if (same) return; }
  reactBar = h("div", { class: "vr-react-bar", role: "toolbar", "aria-label": "Reactions" },
    to ? h("span", { class: "vr-react-to", text: "to @" + to }) : null,
    ...VOICE_REACTIONS.map((e) => { const b = h("button", { type: "button", text: e, "aria-label": "React " + e }); b.addEventListener("click", (ev) => { ev.stopPropagation(); sendReaction(e, to ?? reactTarget()); }); return b; }));
  reactBar._anchor = anchor;
  document.body.append(reactBar);
  const r = anchor.getBoundingClientRect(), w = reactBar.offsetWidth;
  reactBar.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + "px";
  reactBar.style.top = Math.max(8, r.top - reactBar.offsetHeight - 8) + "px";
  setTimeout(() => {
    const away = (e) => { if (reactBar && !reactBar.contains(e.target) && !anchor.contains(e.target)) { reactBar.remove(); reactBar = null; document.removeEventListener("pointerdown", away); } };
    document.addEventListener("pointerdown", away);
  });
}
// An emoji floats up (with who sent it) over the stream it's for, the voice panel and the channel list
function floatIn(box, ev, big) {
  if (!box) return;
  const el = h("span", { class: "vr-float" + (big ? " big" : "") }, h("span", { class: "vr-float-emoji", text: ev.emoji }), h("small", { text: ev.mine ? "You" : ev.by.split(" ")[0] }));
  el.style.left = 12 + Math.random() * 70 + "%";
  box.append(el);
  setTimeout(() => el.remove(), 2600);
}
function showReaction(ev) {
  const here = room && ev.chatId === room.chat.id && ev.channelId === room.channel.id;
  if (here) {
    const tile = ev.to && (room.tileEls?.get(ev.to + ":screen") || room.tileEls?.get(ev.to));
    if (tile) floatIn(tile, ev, true);
    floatIn(room.dock, ev);
    if (!tile && room.stage) floatIn(room.stage, ev, true);
  }
  document.querySelectorAll(`.vc-person[data-voice-user="${CSS.escape(ev.username)}"]`).forEach((row) => floatIn(row, ev));
}
on("voice:react", (ev) => { if (ev.username !== state.me.username) showReaction(ev); });

// Soundboard sounds play in an <audio> on the page, like people's voices
// (browsers keep that playing during a call; the Web Audio engine they sometimes put to sleep).
const builtinFiles = new Map(); // builtin id -> blob URL of a WAV made once in the browser
async function builtinUrl(id) {
  if (builtinFiles.has(id)) return builtinFiles.get(id);
  const rate = 44100, off = new OfflineAudioContext(1, rate * 2.6, rate);
  playBuiltin(id, off, off.destination);
  const buf = await off.startRendering();
  const url = URL.createObjectURL(wavBlob(buf));
  builtinFiles.set(id, url);
  return url;
}
function wavBlob(buf) {
  const data = buf.getChannelData(0), n = data.length, out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, t) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); out.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true);
  return new Blob([out], { type: "audio/wav" });
}
async function playSoundHere(s) {
  if (room?.deaf) return;
  try {
    const a = h("audio", { src: s.builtin ? await builtinUrl(s.builtin) : s.url, playsInline: true });
    a.volume = 0.9;
    const spk = audioPrefs().speakerId;
    if (spk && a.setSinkId) await a.setSinkId(spk).catch(() => {});
    (room?.audioBox || document.body).append(a);
    a.addEventListener("ended", () => a.remove());
    setTimeout(() => a.remove(), 15000);
    await a.play();
  } catch {
    // Blocked or not supported: fall back to the sound engine, and offer the "Tap to hear" button
    if (s.builtin) playBuiltin(s.builtin);
    if (room && !room.needsTap) { room.needsTap = true; paintDock(); }
  }
}
on("group:changed", async (ev) => {
  if (!room || ev.chatId !== room.chat.id || ev.what !== "sounds") return;
  try { room.chat.sounds = (await api(`/api/chats/${room.chat.id}`)).chat.sounds; } catch {}
});
// Who is in the channel (from a live update or the heartbeat): call anyone new, drop anyone gone
function syncPeople(list) {
  if (!room || !Array.isArray(list)) return;
  const before = room.people.length;
  room.people = list;
  inviteList?.(); // the invite list drops whoever just came in
  const here = new Set(list.map((p) => p.username));
  for (const u of here) if (u !== state.me.username && !room.peers.has(u)) peer(u);
  for (const [u, p] of [...room.peers]) if (!here.has(u)) closePeer(p);
  if (list.length > before && before) playTone(true, true);
  paintDock();
  paintStage();
}
on("voice:state", (ev) => {
  if (!room || ev.chatId !== room.chat.id || ev.channelId !== room.channel.id) return;
  syncPeople(ev.participants);
  inviteList?.();
});

/* ---------- Mute, deafen, camera, screen ---------- */
// Muting silences only the microphone, so soundboard sounds still go out
function setMicOpen() {
  const open = !room.muted && !room.deaf;
  room.mic.getAudioTracks().forEach((t) => (t.enabled = open));
  relay.setRelayMuted(!open);
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
  relay.setRelayDeaf(v);
  setMicOpen();
  post({ kind: "state", deaf: v }).catch(() => {});
  paintDock();
}
// Phones' browsers can't share the screen (Apple and Google don't allow it), so offer a camera instead
const canShareScreen = () => Boolean(navigator.mediaDevices?.getDisplayMedia);
function phoneScreenInfo() {
  const pick = (facing, label) => h("button", { type: "button", class: "co-item", onclick: () => { m.close(); setVideo("camera", facing); } },
    h("span", { class: "co-ic", text: facing === "user" ? "🤳" : "📷" }), h("span", { class: "co-text" }, h("b", { text: label }), h("small", { class: "muted", text: facing === "user" ? "Your face" : "What’s in front of your phone" })));
  const m = modal({ title: "Share from your phone", body: h("div", { class: "co-list" },
    h("p", { class: "muted", text: "Phone browsers don’t allow sharing the screen (Apple and Google block it). Open LookBlog on a computer to share your screen, or show people your camera:" }),
    pick("environment", "Back camera"), pick("user", "Front camera")) });
}
async function setVideo(kind, facing = "user") {
  // kind: "camera" | "screen" | null (turn off); facing: which camera on a phone
  let track = null;
  if (kind === "screen" && !canShareScreen()) return phoneScreenInfo();
  if (kind) {
    try {
      const s = kind === "screen"
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
        : await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: facing } });
      track = s.getVideoTracks()[0];
    } catch (err) {
      if (kind === "screen" && matchMedia("(pointer: coarse)").matches) return phoneScreenInfo();
      return toast(kind === "screen" ? "Screen sharing was cancelled." : "Camera isn’t available.");
    }
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
  room.video = track ? { track, kind, facing } : null;
  relay.setRelayVideo(track, kind); // people we can only reach through the relay get pictures that way
  post({ kind: "state", video: kind === "camera", screen: kind === "screen" }).catch(() => {});
  paintDock();
  paintStage();
}

/* ---------- Who is talking (green ring) ---------- */
// My own microphone is measured directly. Other people's loudness comes from the connection's stats,
// so their sound never goes through the page's sound engine (on iPhones that can silence it).
let levelTimer = null, localMeter = null;
function watchLocal(stream) {
  try {
    const ac = audioEngine(), an = ac.createAnalyser();
    an.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(an);
    localMeter = { an, buf: new Uint8Array(an.fftSize) };
  } catch { localMeter = null; }
  if (levelTimer) return;
  levelTimer = setInterval(async () => {
    if (!room) return;
    const now = new Set();
    if (localMeter && !room.muted && !room.deaf) {
      localMeter.an.getByteTimeDomainData(localMeter.buf);
      let peak = 0;
      for (const v of localMeter.buf) peak = Math.max(peak, Math.abs(v - 128));
      if (peak > 14) now.add(state.me.username);
    }
    // People heard through the relay
    for (const [u, t] of relay.relayLoud) if (Date.now() - t < 450) now.add(u);
    await Promise.all([...room.peers].map(async ([u, p]) => {
      try { (await p.pc.getStats()).forEach((r) => { if (r.type === "inbound-rtp" && r.kind === "audio" && (r.audioLevel || 0) > 0.03) now.add(u); }); } catch {}
    }));
    const changed = now.size !== speakingNow.size || [...now].some((u) => !speakingNow.has(u));
    if (!changed) return;
    speakingNow.clear();
    now.forEach((u) => speakingNow.add(u));
    emit("voice:speaking", [...speakingNow]);
    paintSpeaking();
  }, 250);
}
function stopLevels() {
  clearInterval(levelTimer); levelTimer = null;
  localMeter = null; speakingNow.clear();
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
function playBuiltin(id, shared = null, into = null) {
  try {
    const ctx = shared || audioEngine();
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
    .then(() => playSoundHere(s))
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
    const ctx = audioEngine();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(up ? 520 : 660, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(up ? 780 : 420, ctx.currentTime + 0.18);
    g.gain.setValueAtTime(soft ? 0.04 : 0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.32);
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
  // (a slot that's hidden — e.g. the channel list on a phone while a channel is open — doesn't count)
  const slot = [...document.querySelectorAll(".gv-dock-slot")].find((x) => x.parentElement?.getClientRects().length);
  if (slot && room.dock.parentElement !== slot) { slot.append(room.dock); room.dock.classList.add("in-slot"); }
  else if (!slot && room.dock.parentElement !== document.body) { document.body.append(room.dock); room.dock.classList.remove("in-slot"); }
  // Floating over a chat: sit just above the message box, never on top of it
  if (!slot) {
    const foot = [...document.querySelectorAll(".convo-foot")].find((x) => x.getClientRects().length);
    const top = foot?.getBoundingClientRect().top;
    room.dock.style.bottom = top && top < innerHeight ? Math.round(innerHeight - top + 8) + "px" : "";
  } else room.dock.style.bottom = "";
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
      room.needsTap ? h("button", { type: "button", class: "vd-now vd-tap", onclick: () => wakeAudio() }, "🔊 Tap to hear everyone") : null,
      musicState()?.now ? (musicNeedsTap()
        ? h("button", { type: "button", class: "vd-now vd-tap", title: "Your browser paused the sound — tap to hear it", onclick: () => resumeMusic() }, "🔊 Tap to hear: " + musicState().now.title)
        : h("button", { type: "button", class: "vd-now", title: "Music", onclick: () => openMusicPanel() }, (musicState().pausedAt != null ? "⏸ " : "🎧 ") + musicState().now.title)) : null),
    h("div", { class: "vd-btns" },
      btn(room.muted ? "mute" : "mic", room.muted ? "Unmute" : "Mute", room.muted, () => setMuted(!room.muted)),
      btn("headphones", room.deaf ? "Undeafen" : "Deafen", room.deaf, () => setDeaf(!room.deaf)),
      btn("video", room.video?.kind === "camera" ? "Turn camera off" : "Turn camera on", room.video?.kind === "camera", () => setVideo(room.video?.kind === "camera" ? null : "camera")),
      room.video?.kind === "camera" && matchMedia("(pointer: coarse)").matches ? btn("flip", "Switch camera", false, () => setVideo("camera", room.video.facing === "user" ? "environment" : "user")) : null,
      btn("screen", room.video?.kind === "screen" ? "Stop sharing" : canShareScreen() ? "Share your screen" : "Share (camera)", room.video?.kind === "screen", () => setVideo(room.video?.kind === "screen" ? null : "screen")),
      (() => { const b = btn("sound", "Soundboard", false, () => openSoundboard(b)); return b; })(),
      (() => { const b = h("button", { type: "button", class: "vd-btn vd-react", title: "React", "aria-label": "React", text: "😊" }); b.addEventListener("click", () => openReactBar(b, null)); return b; })(),
      btn("userPlus", "Invite people to this channel", false, () => openVoiceInvite()),
      btn("gear", "Voice settings (microphone, speaker)", false, () => openAudioSettings({ onMicChange: switchMic, onOptionsChange: switchMic, onSpeakerChange: setSpeaker })),
      btn("note", "Music", Boolean(musicState()?.now), () => openMusicPanel(), "vd-music"),
      btn("leave", "Leave voice", false, () => leaveVoice(), "danger")));
}

// Camera or screen from someone we can only reach through the relay: pictures drawn into a canvas,
// which becomes their video (real video over a direct connection always wins)
relay.onRelayVideo((user, f) => {
  const p = room?.peers.get(user);
  if (!p) return;
  if (!f) {
    if (p.videoFromRelay) { p.videoStream = null; p.videoFromRelay = false; p.relayVid = null; paintStage(); }
    return;
  }
  const direct = !p.videoFromRelay && p.videoStream?.getVideoTracks()[0];
  if (direct && direct.readyState === "live" && !direct.muted && p.pc.connectionState === "connected") return;
  if (!p.relayVid || !p.videoFromRelay) {
    const c = document.createElement("canvas");
    c.width = f.w; c.height = f.h;
    p.relayVid = { c, g: c.getContext("2d") };
    p.videoStream = c.captureStream();
    p.videoFromRelay = true;
  }
  const img = new Image();
  img.onload = () => {
    const rv = p.relayVid;
    if (!rv) return;
    if (rv.c.width !== f.w || rv.c.height !== f.h) { rv.c.width = f.w; rv.c.height = f.h; }
    rv.g.drawImage(img, 0, 0);
    if (!room?.tileEls?.has(user + (f.kind === "screen" ? ":screen" : ""))) paintStage();
  };
  img.src = "data:image/jpeg;base64," + f.d;
});

/* ---------- Video tiles (camera / screen) ---------- */
function paintStage() {
  if (!room) return;
  const tiles = [];
  const label = (u) => room.people.find((p) => p.username === u)?.name || u;
  if (room.video) tiles.push({ u: state.me.username, name: "You", stream: new MediaStream([room.video.track]), screen: room.video.kind === "screen", mine: true });
  for (const p of room.peers.values()) {
    const info = room.people.find((x) => x.username === p.username);
    const t = p.videoStream?.getVideoTracks()[0];
    if (t && t.readyState === "live" && !t.muted && info && (info.video || info.screen)) tiles.push({ u: p.username, name: label(p.username), who: info, stream: p.videoStream, screen: info.screen });
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
      // React to their stream
      if (!t.mine) {
        const rb = h("button", { type: "button", class: "vs-react", title: `React to ${t.name}`, "aria-label": `React to ${t.name}`, text: "😊" });
        rb.addEventListener("click", (e) => { e.stopPropagation(); openReactBar(rb, t.u); });
        el.append(rb);
      }
      el.addEventListener("click", () => { room.focus = room.focus === key ? null : key; if (room.stageMode === "small") room.stageMode = "big"; paintStage(); });
      els.set(key, el);
    }
    const v = el.querySelector("video");
    if (v.srcObject?.getVideoTracks()[0] !== t.stream.getVideoTracks()[0]) v.srcObject = t.stream;
    v.classList.toggle("mirror", Boolean(t.mine && !t.screen));
    el.classList.toggle("screen", Boolean(t.screen));
    el.classList.toggle("focused", room.focus === key);
    el.querySelector(".vs-name").replaceChildren((t.screen ? "🖥️ " : "") + t.name, ...(t.who ? [tick(t.who, 13)] : []));
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
    avatar(p, 24), h("span", { class: "vc-name", text: p.name }), tick(p, 13),
    p.screen ? h("span", { class: "vc-flag live", text: "LIVE" }) : null,
    p.video ? h("span", { class: "vc-flag", title: "Camera on" }, icon("video")) : null,
    p.deaf ? h("span", { class: "vc-flag", title: "Deafened" }, icon("headphones")) : p.muted ? h("span", { class: "vc-flag", title: "Muted" }, icon("mute")) : null);
}
