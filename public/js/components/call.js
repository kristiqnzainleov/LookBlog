// Voice and video calls in direct chats (WebRTC). The server only relays the set-up messages;
// sound and video go straight between the two browsers.
import { h, icon, avatar, toast, tick } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { gameView, openGamePicker } from "./games.js";
import { currentVoice } from "./voice-room.js";

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
let current = null; // one call at a time
window.__lbInCall = () => Boolean(current);

const send = (chatId, body) => api(`/api/chats/${chatId}/call`, { method: "POST", body }).catch((err) => { toast(err.error || "Call failed."); throw err; });

/* A soft ring tone made in the browser (no sound files) */
function ringtone(outgoing) {
  let ctx, timer, stopped = false;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); ctx.resume?.().catch(() => {}); } catch { return () => {}; }
  const beep = () => {
    if (stopped) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = outgoing ? 440 : 660;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    o.start(); o.stop(ctx.currentTime + 1);
    timer = setTimeout(beep, outgoing ? 3000 : 1600);
  };
  beep();
  return () => { stopped = true; clearTimeout(timer); ctx.close().catch(() => {}); };
}

function fmt(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, "0")}`; }

/* ---------- The call window ---------- */
function callUI({ chatId, person, video, outgoing, callId }) {
  const status = h("p", { class: "call-status", text: outgoing ? "Calling…" : "Connecting…" });
  const remoteVideo = h("video", { class: "call-remote", autoplay: true, playsInline: true });
  const localVideo = h("video", { class: "call-local", autoplay: true, playsInline: true, muted: true });
  const remoteAudio = h("audio", { autoplay: true });
  const who = h("div", { class: "call-who" }, avatar(person, 112), h("h2", {}, person.name, tick(person, 22)), status);
  const muteBtn = h("button", { type: "button", class: "call-btn", title: "Mute" }, icon("mic"));
  const camBtn = h("button", { type: "button", class: "call-btn", title: "Camera" }, icon("video"));
  const hang = h("button", { type: "button", class: "call-btn hang", title: "Hang up" }, icon("phone"));
  const screenBtn = h("button", { type: "button", class: "call-btn", title: "Share your screen" }, icon("screen"));
  const gameBtn = h("button", { type: "button", class: "call-btn", title: "Play a game together" }, icon("game"));
  const sharing = h("p", { class: "call-sharing", hidden: true });
  const gamePane = h("div", { class: "call-game", hidden: true });
  const box = h("div", { class: "call-screen" + (video ? " is-video" : ""), role: "dialog", "aria-label": "Call" },
    remoteVideo, who, localVideo, remoteAudio, sharing, gamePane, h("div", { class: "call-controls" }, muteBtn, camBtn, screenBtn, gameBtn, hang));
  document.body.append(box);
  requestAnimationFrame(() => box.classList.add("open"));

  const st = { chatId, callId, video, outgoing, pc: null, stream: null, pending: [], connectedAt: 0, timer: null, stopRing: ringtone(outgoing), ended: false };
  current = st;

  async function getMedia() {
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { width: 1280, height: 720 } : false });
    } catch {
      if (video) { // fall back to a voice call if the camera isn't available
        st.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        toast("Camera isn’t available. Continuing with voice only.");
        box.classList.remove("is-video");
      } else throw new Error("LookBlog needs your microphone for calls.");
    }
    localVideo.srcObject = st.stream;
  }
  function makePeer() {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    st.stream.getTracks().forEach((t) => pc.addTrack(t, st.stream));
    pc.onicecandidate = (e) => e.candidate && send(chatId, { kind: "ice", callId, data: e.candidate.toJSON() }).catch(() => {});
    pc.ontrack = (e) => {
      const s = e.streams[0];
      // Play the sound through exactly one element
      if (s.getVideoTracks().length) { remoteVideo.srcObject = s; remoteVideo.muted = false; remoteAudio.srcObject = null; box.classList.add("has-remote-video"); }
      else remoteAudio.srcObject = s;
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && !st.connectedAt) {
        st.connectedAt = Date.now();
        st.stopRing();
        st.timer = setInterval(() => (status.textContent = fmt((Date.now() - st.connectedAt) / 1000)), 500);
        box.classList.add("live");
      }
      if (["failed", "disconnected"].includes(pc.connectionState)) { status.textContent = "Connection lost"; setTimeout(() => end(true), 2500); }
    };
    st.pc = pc;
    return pc;
  }
  async function flushIce() { for (const c of st.pending.splice(0)) await st.pc.addIceCandidate(c).catch(() => {}); }

  // Messages from the other side
  st.handle = async (ev) => {
    if (ev.callId !== callId) return;
    if (ev.kind === "accept" && outgoing) {
      st.stopRing();
      status.textContent = "Connecting…";
      try { await st.mediaReady; } catch { return; }
      if (st.ended) return;
      const pc = makePeer();
      await pc.setLocalDescription(await pc.createOffer());
      send(chatId, { kind: "offer", callId, data: pc.localDescription.toJSON() });
    } else if (ev.kind === "offer") {
      const pc = st.pc || makePeer();
      await pc.setRemoteDescription(ev.data);
      await flushIce();
      await pc.setLocalDescription(await pc.createAnswer());
      send(chatId, { kind: "answer", callId, data: pc.localDescription.toJSON() });
    } else if (ev.kind === "answer" && st.pc) {
      await st.pc.setRemoteDescription(ev.data);
      await flushIce();
    } else if (ev.kind === "ice") {
      if (st.pc?.remoteDescription) await st.pc.addIceCandidate(ev.data).catch(() => {});
      else st.pending.push(ev.data);
    } else if (ev.kind === "decline" || ev.kind === "busy") {
      status.textContent = ev.kind === "busy" ? "They’re on another call." : "Call declined.";
      setTimeout(() => end(false, ev.kind), 1400);
    } else if (ev.kind === "screen") {
      sharing.hidden = !ev.data?.on;
      sharing.textContent = `🖥️ ${person.name} is sharing their screen`;
      if (ev.data?.on) box.classList.add("has-remote-video", "remote-screen");
      else { box.classList.remove("remote-screen"); if (!remoteVideo.srcObject?.getVideoTracks().some((t) => t.readyState === "live" && !t.muted) || !video) box.classList.remove("has-remote-video"); }
    } else if (ev.kind === "hangup") {
      status.textContent = "Call ended";
      setTimeout(() => end(false), 800);
    }
  };

  muteBtn.addEventListener("click", () => {
    const t = st.stream?.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    muteBtn.classList.toggle("off", !t.enabled);
    muteBtn.title = t.enabled ? "Mute" : "Unmute";
  });
  camBtn.addEventListener("click", () => {
    const t = st.stream?.getVideoTracks()[0];
    if (!t) return toast("This is a voice call.");
    t.enabled = !t.enabled;
    camBtn.classList.toggle("off", !t.enabled);
  });
  hang.addEventListener("click", () => end(true));

  /* Share the screen: swap it in for the camera, or add it (and renegotiate) on a voice call */
  async function renegotiate() {
    await st.pc.setLocalDescription(await st.pc.createOffer());
    send(chatId, { kind: "offer", callId, data: st.pc.localDescription.toJSON() }).catch(() => {});
  }
  async function stopScreen() {
    const t = st.screen;
    if (!t) return;
    st.screen = null;
    t.onended = null;
    t.stop();
    if (st.screenReplaced) await st.screenReplaced.replaceTrack(st.camTrack || null).catch(() => {});
    else if (st.screenSender) { st.pc.removeTrack(st.screenSender); await renegotiate(); }
    st.screenReplaced = st.screenSender = null;
    localVideo.srcObject = st.stream;
    box.classList.remove("sharing");
    screenBtn.classList.remove("on");
    send(chatId, { kind: "screen", callId, data: { on: false } }).catch(() => {});
  }
  screenBtn.addEventListener("click", async () => {
    if (st.screen) return stopScreen();
    if (!st.pc) return toast("Wait until the call connects.");
    if (!navigator.mediaDevices?.getDisplayMedia) return toast("Your browser can’t share the screen.");
    let track;
    try { track = (await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })).getVideoTracks()[0]; }
    catch { return; }
    st.screen = track;
    track.onended = stopScreen;
    const sender = st.pc.getSenders().find((x) => x.track?.kind === "video");
    if (sender) { st.camTrack = sender.track; st.screenReplaced = sender; await sender.replaceTrack(track); }
    else { st.screenSender = st.pc.addTrack(track, st.stream); await renegotiate(); }
    localVideo.srcObject = new MediaStream([track]);
    box.classList.add("sharing");
    screenBtn.classList.add("on");
    send(chatId, { kind: "screen", callId, data: { on: true } }).catch(() => {});
  });

  /* Games during the call */
  function showGame(msg) {
    gamePane.hidden = false;
    box.classList.add("with-game");
    const close = h("button", { type: "button", class: "icon-btn call-game-close", "aria-label": "Close game" }, icon("close"));
    close.addEventListener("click", () => { gamePane.hidden = true; box.classList.remove("with-game"); });
    gamePane.replaceChildren(close, gameView(chatId, msg.id, msg.game, { inCall: true }));
  }
  gameBtn.addEventListener("click", () => openGamePicker({ id: chatId, kind: "dm" }, { onStarted: showGame }));
  st.offGame = on("message", (ev) => { if (ev.chatId === chatId && ev.message.game && !ev.message.mine) { showGame(ev.message); toast(`${person.name} started ${ev.message.game.name}.`); } });

  let missTimer = outgoing ? setTimeout(() => { if (!st.pc) { status.textContent = "No answer"; setTimeout(() => end(true, "missed"), 1200); } }, 35000) : null;

  async function end(tell, reason) {
    if (st.ended) return;
    st.ended = true;
    clearTimeout(missTimer);
    clearInterval(st.timer);
    st.stopRing();
    if (tell) send(chatId, { kind: "hangup", callId }).catch(() => {});
    st.pc?.close();
    st.stream?.getTracks().forEach((t) => t.stop());
    st.screen?.stop();
    st.offGame?.();
    current = null;
    // Say who you were talking to before the window closes
    const talked = st.connectedAt ? fmt((Date.now() - st.connectedAt) / 1000) : null;
    if (talked) {
      status.textContent = `Call with ${person.name} ended · ${talked}`;
      box.classList.remove("live", "has-remote-video");
      box.classList.add("ended");
      toast(`Call with ${person.name} ended · ${talked}`);
    }
    setTimeout(() => { box.classList.remove("open"); setTimeout(() => box.remove(), 250); }, talked ? 1600 : 0);
    // The caller leaves a note in the chat
    if (outgoing) {
      const kind = video ? "Video call" : "Voice call";
      const text = talked ? `📞 ${kind} · ${talked}` : `📞 Missed ${kind.toLowerCase()}${reason === "decline" ? " (declined)" : ""}`;
      api(`/api/chats/${chatId}/messages`, { method: "POST", body: { text } }).catch(() => {});
    }
  }
  st.getMedia = getMedia;
  st.end = end;
  return st;
}

/* ---------- Start a call ---------- */
export async function startCall(chat, video) {
  if (current) return toast("You’re already on a call.");
  if (currentVoice()) return toast("Leave the voice channel first.");
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast("Your browser can’t make calls.");
  const callId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const st = callUI({ chatId: chat.id, person: chat.other, video, outgoing: true, callId });
  // Ring straight away; the microphone/camera starts while their phone is ringing
  st.mediaReady = st.getMedia();
  st.mediaReady.catch(() => {});
  try {
    await Promise.all([send(chat.id, { kind: "ring", callId, video }), st.mediaReady]);
  } catch (err) {
    if (err?.message && !err.error) toast(err.message);
    st.end(true);
  }
}

/* ---------- Incoming calls (set up once, from main.js) ---------- */
// Ask once (on a click, as browsers require) so calls can show up even when LookBlog is in another tab
function askForNotifications() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  const ask = () => { document.removeEventListener("pointerdown", ask); Notification.requestPermission().catch(() => {}); };
  document.addEventListener("pointerdown", ask);
}

// Blink the tab title while ringing
function flashTitle(text) {
  const old = document.title;
  let on = false;
  const t = setInterval(() => { document.title = (on = !on) ? text : old; }, 900);
  document.title = text;
  return () => { clearInterval(t); document.title = old; };
}

export function listenForCalls() {
  askForNotifications();
  let ringing = null;
  on("call", async (ev) => {
    if (current && current.callId === ev.callId) return current.handle(ev);
    if (ev.kind === "ring") {
      if (current || ringing) return send(ev.chatId, { kind: "busy", callId: ev.callId }).catch(() => {});
      const what = ev.video ? "video call" : "voice call";
      const stopTone = ringtone(false);
      const stopTitle = flashTitle(`📞 ${ev.from.name} is calling…`);
      let vib = null;
      if (navigator.vibrate) { navigator.vibrate([400, 250, 400]); vib = setInterval(() => navigator.vibrate([400, 250, 400]), 1600); }
      let note = null;
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try {
          note = new Notification(`${ev.from.name} is calling you`, { body: `Incoming ${what} on LookBlog`, icon: ev.from.avatar || undefined, tag: "call-" + ev.callId, requireInteraction: true });
          note.onclick = () => { window.focus(); note.close(); };
        } catch {}
      }
      const stop = () => { stopTone(); stopTitle(); clearInterval(vib); navigator.vibrate?.(0); note?.close(); };

      const accept = h("button", { type: "button", class: "call-btn accept", title: "Accept" }, icon(ev.video ? "video" : "phone"));
      const decline = h("button", { type: "button", class: "call-btn hang", title: "Decline" }, icon("phone"));
      const card = h("div", { class: "incoming-call", role: "alertdialog", "aria-label": `Incoming ${what} from ${ev.from.name}` },
        h("div", { class: "ic-card" },
          h("div", { class: "ic-ring" }, avatar(ev.from, 120)),
          h("b", { class: "ic-name" }, ev.from.name, tick(ev.from, 20)),
          h("span", { class: "ic-what", text: `Incoming ${what}…` }),
          h("div", { class: "ic-actions" },
            h("label", { class: "ic-btn" }, decline, h("span", { text: "Decline" })),
            h("label", { class: "ic-btn" }, accept, h("span", { text: "Accept" })))));
      document.body.append(card);
      requestAnimationFrame(() => card.classList.add("open"));
      accept.focus();
      ringing = { callId: ev.callId, card, stop };
      const close = () => { stop(); card.classList.remove("open"); setTimeout(() => card.remove(), 200); ringing = null; };
      const timeout = setTimeout(() => { close(); toast(`Missed call from ${ev.from.name}.`); }, 35000);
      const onKey = (e) => { if (e.key === "Escape" && ringing?.card === card) decline.click(); };
      document.addEventListener("keydown", onKey);
      const done = () => { clearTimeout(timeout); document.removeEventListener("keydown", onKey); close(); };
      ringing.done = done;
      decline.addEventListener("click", () => { done(); send(ev.chatId, { kind: "decline", callId: ev.callId }).catch(() => {}); });
      accept.addEventListener("click", async () => {
        done();
        const st = callUI({ chatId: ev.chatId, person: ev.from, video: ev.video, outgoing: false, callId: ev.callId });
        st.stopRing();
        try {
          await st.getMedia();
          await send(ev.chatId, { kind: "accept", callId: ev.callId });
        } catch (err) { toast(err.message || "Couldn’t answer."); st.end(true); }
      });
    } else if (ev.kind === "hangup" && ringing?.callId === ev.callId) {
      ringing.done();
      toast(`Missed call from ${ev.from.name}.`);
    }
  });
}
