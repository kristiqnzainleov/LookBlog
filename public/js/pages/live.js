// /live/:id — a live stream. The streamer sends camera, screen, or screen + camera (and microphone)
// straight to each viewer; there's a live chat (Top chat / Live chat), floating reactions, likes,
// moderators, and viewers can send a picture, a short video or a sound that pops up on the stream.
// A stream can also be scheduled: then /live/:id is its "upcoming" page with a "Notify me" button.
// When the streamer ends, the recording is uploaded and shows up under "Streams" on their profile.
import { h, icon, avatar, tick, toast, empty, spinner, modal, richText, count as fmtCount } from "../ui.js";
import { api, upload } from "../api.js";
import { on, state } from "../state.js";
import { navigate, profileHref } from "../router.js";
import { BUILTIN_SOUNDS, previewSound } from "../components/voice-room.js";
import { openShareLink } from "../components/share.js";
import { attachMentions } from "../components/mentions.js";
import { openEmojiPicker, insertAtCursor } from "../components/emoji.js";
import { openStickers } from "../components/stickers.js";
import { openSoundPicker } from "../components/sounds.js";
import { openReportLive } from "../components/report.js";

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
const post = (id, path, body) => api(`/api/streams/${id}/${path}`, { method: "POST", body });
const when = (iso) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// For <input type="datetime-local">
const localValue = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/* ---------- Camera, screen, or screen with the camera in a corner ----------
   Everything is drawn on a 1280×720 canvas and the canvas is what's streamed (and recorded). That lets the
   streamer move/hide the camera, put their own pictures and GIFs on top, and show the chat on the stream. */
const CW = 1280, CH = 720;
// Open the camera / screen for a source ("camera", "screen" or "both")
async function grabMedia(source) {
  let screen = null, cam = null;
  if (source === "camera") {
    cam = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: { echoCancellation: true, noiseSuppression: true } });
  } else {
    screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    try {
      cam = await navigator.mediaDevices.getUserMedia(source === "both" ? { video: { width: 640, height: 360 }, audio: { echoCancellation: true } } : { audio: { echoCancellation: true } });
    } catch { if (source === "both") toast("Couldn’t open the camera — streaming the screen only."); }
  }
  return { screen, cam };
}
async function captureSource(source) {
  let { screen, cam } = await grabMedia(source);
  // Mix the screen's sound and the microphone into one track
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const mix = ctx.createMediaStreamDestination();
  let baseNodes = [];
  const connectBase = () => { for (const st of [screen, cam]) if (st && st.getAudioTracks().length) { const n = ctx.createMediaStreamSource(new MediaStream(st.getAudioTracks())); n.connect(mix); baseNodes.push(n); } };
  connectBase();
  const vid = (st) => { if (!st?.getVideoTracks().length) return null; const v = h("video", { muted: true, playsInline: true }); v.srcObject = new MediaStream(st.getVideoTracks()); v.play().catch(() => {}); return v; };
  let sv = vid(screen), cv = vid(cam);
  const canvas = h("canvas", { width: CW, height: CH });
  const g = canvas.getContext("2d");
  // cam: show the camera; camRect: where the small camera goes (screen + camera);
  // overlays: the streamer's pictures and GIFs; chat: the chat box drawn on the stream
  const layout = { source, cam: true, camX: null, camY: null, camSize: 320, overlays: [], chat: { on: false, x: CW - 400, y: 110, w: 380, h: 480, msgs: [] }, guests: [], hostName: "" };
  // Draw a picture into a box (cover = fill and crop, contain = fit whole)
  const fitTo = (cx, v, vw, vh, x, y, w, hh, cover) => {
    const r = (cover ? Math.max : Math.min)(w / vw, hh / vh), dw = vw * r, dh = vh * r;
    cx.save(); cx.beginPath(); cx.rect(x, y, w, hh); cx.clip();
    cx.drawImage(v, x + (w - dw) / 2, y + (hh - dh) / 2, dw, dh);
    cx.restore();
    return { s: r, ox: x + (w - dw) / 2, oy: y + (hh - dh) / 2 };
  };
  layout.camRect = () => {
    if (!(sv && cv && layout.cam && cv.videoWidth)) return null;
    const w = layout.camSize, hh = Math.round(w * cv.videoHeight / cv.videoWidth);
    return { x: layout.camX ?? CW - w - 20, y: layout.camY ?? CH - hh - 20, w, h: hh };
  };
  // My own scene: screen and/or camera, my camera in its corner, my pictures and my chat box.
  // Alone it IS the stream; with guests it becomes my tile, so everyone only arranges their own.
  const scene = h("canvas", { width: CW, height: CH });
  const sg = scene.getContext("2d");
  const drawScene = (cx) => {
    cx.fillStyle = "#000"; cx.fillRect(0, 0, CW, CH);
    if (sv) { if (sv.videoWidth) fitTo(cx, sv, sv.videoWidth, sv.videoHeight, 0, 0, CW, CH, false); }
    else if (cv && layout.cam && cv.videoWidth) fitTo(cx, cv, cv.videoWidth, cv.videoHeight, 0, 0, CW, CH, true);
    else if (cv && !layout.cam) {
      cx.fillStyle = "#16090f"; cx.fillRect(0, 0, CW, CH);
      cx.fillStyle = "#ff4fa3"; cx.font = "800 64px system-ui, sans-serif"; cx.textAlign = "center"; cx.fillText("Be right back", CW / 2, CH / 2); cx.textAlign = "left";
    }
    const r = layout.camRect();
    if (r) {
      cx.save(); cx.beginPath(); cx.roundRect(r.x, r.y, r.w, r.h, 16); cx.clip(); cx.drawImage(cv, r.x, r.y, r.w, r.h); cx.restore();
      cx.strokeStyle = "#ff4fa3"; cx.lineWidth = 4; cx.beginPath(); cx.roundRect(r.x, r.y, r.w, r.h, 16); cx.stroke();
    }
    for (const o of layout.overlays) { const img = overlayFrame(o); if (img) { cx.globalAlpha = o.opacity ?? 1; cx.drawImage(img, o.x, o.y, o.w, o.h); cx.globalAlpha = 1; } }
    drawChat(cx, layout.chat);
  };
  // Live with guests: the screen splits — 2 side by side, 3–4 in a grid (like Instagram live rooms)
  const label = (text, x, y) => {
    g.font = "800 22px system-ui, sans-serif";
    const w = g.measureText(text).width + 24;
    g.fillStyle = "rgba(0,0,0,0.6)"; g.beginPath(); g.roundRect(x + 12, y - 44, w, 32, 10); g.fill();
    g.fillStyle = "#fff"; g.fillText(text, x + 24, y - 21);
  };
  const drawGrid = () => {
    drawScene(sg);
    const tiles = [{ me: true, name: layout.hostName || "Host", cover: layout.source === "camera" }, ...layout.guests.map((gu) => ({ v: gu.off ? null : gu.video, name: gu.name, cover: gu.cover !== false }))].slice(0, 4);
    const n = tiles.length, W2 = CW / 2, H2 = CH / 2;
    const cells = n === 2 ? [[0, 0, W2, CH], [W2, 0, W2, CH]] : n === 3 ? [[0, 0, W2, H2], [W2, 0, W2, H2], [0, H2, CW, H2]] : [[0, 0, W2, H2], [W2, 0, W2, H2], [0, H2, W2, H2], [W2, H2, W2, H2]];
    tiles.forEach((t, i) => {
      const [x, y, w, hh] = cells[i];
      g.fillStyle = "#16090f"; g.fillRect(x, y, w, hh);
      // Whole picture, never cropped: everyone's camera, chat and pictures stay where they put them
      if (t.me) layout.hostTile = fitTo(g, scene, CW, CH, x, y, w, hh, false);
      else if (t.v?.videoWidth) fitTo(g, t.v, t.v.videoWidth, t.v.videoHeight, x, y, w, hh, false);
      else { g.fillStyle = "#ff4fa3"; g.font = "800 30px system-ui, sans-serif"; g.textAlign = "center"; g.fillText(t.v ? "Connecting…" : "Camera off", x + w / 2, y + hh / 2); g.textAlign = "left"; }
      label(t.name, x, y + hh);
    });
    g.strokeStyle = "#ff4fa3"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(W2, 0); g.lineTo(W2, n === 3 ? H2 : CH); if (n > 2) { g.moveTo(0, H2); g.lineTo(CW, H2); } g.stroke();
  };
  const draw = () => {
    if (layout.guests.length) return drawGrid();
    layout.hostTile = null;
    drawScene(sg);
    g.drawImage(scene, 0, 0);
  };
  // A worker clock: timers in a background tab slow down to once a second, a worker's don't
  let worker = null, iv = null;
  try {
    worker = new Worker(URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 33)"], { type: "text/javascript" })));
    worker.onmessage = draw;
  } catch { iv = setInterval(draw, 33); }
  const out = new MediaStream([canvas.captureStream(30).getVideoTracks()[0], ...mix.stream.getAudioTracks()]);
  const stop = () => {
    worker?.terminate(); clearInterval(iv);
    out.getTracks().forEach((t) => t.stop());
    screen?.getTracks().forEach((t) => t.stop()); cam?.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  let mic = (cam || screen)?.getAudioTracks()[0];
  // Guests' sound: into the stream for everyone, and each guest hears the host + the other guests (not themselves)
  const guestAudio = new Map(); // username -> { node, dest }
  const guestMixTrack = (u) => {
    const dest = ctx.createMediaStreamDestination();
    baseNodes.forEach((n) => n.connect(dest));
    for (const [o, x] of guestAudio) if (o !== u && x.node) x.node.connect(dest);
    guestAudio.set(u, { ...(guestAudio.get(u) || {}), dest });
    return dest.stream.getAudioTracks()[0];
  };
  const addGuestAudio = (u, st) => {
    if (!st.getAudioTracks().length) return;
    const node = ctx.createMediaStreamSource(new MediaStream(st.getAudioTracks()));
    node.connect(mix);
    for (const [o, x] of guestAudio) if (o !== u && x.dest) node.connect(x.dest);
    guestAudio.set(u, { ...(guestAudio.get(u) || {}), node });
  };
  const removeGuest = (u) => {
    const x = guestAudio.get(u);
    try { x?.node?.disconnect(); } catch {}
    x?.dest?.stream.getTracks().forEach((t) => t.stop());
    guestAudio.delete(u);
    layout.guests = layout.guests.filter((gu) => gu.username !== u);
  };
  const cap = { stream: out, stop, layout, mic, screenTrack: screen?.getVideoTracks()[0], camTrack: cam?.getVideoTracks()[0], guestMixTrack, addGuestAudio, removeGuest };
  // Change what I show (camera / screen / both) without stopping: the stream keeps the same picture track,
  // only what's drawn on it changes — so viewers, guests and the recording just carry on
  cap.switchSource = async (next) => {
    const got = await grabMedia(next); // may throw if cancelled: nothing changes then
    const wasMuted = mic && !mic.enabled;
    screen?.getTracks().forEach((t) => t.stop()); cam?.getTracks().forEach((t) => t.stop());
    for (const n of baseNodes) { try { n.disconnect(); } catch {} }
    baseNodes = [];
    ({ screen, cam } = got);
    connectBase();
    for (const [u, x] of guestAudio) if (x.dest) baseNodes.forEach((n) => n.connect(x.dest));
    sv = vid(screen); cv = vid(cam);
    mic = (cam || screen)?.getAudioTracks()[0];
    if (mic && wasMuted) mic.enabled = false;
    layout.source = next; layout.cam = true;
    Object.assign(cap, { mic, screenTrack: screen?.getVideoTracks()[0], camTrack: cam?.getVideoTracks()[0] });
    cap.onEnded?.();
    (cap.screenTrack || cap.camTrack)?.addEventListener("ended", () => cap.onSourceEnded?.());
  };
  // A clean view of just my part (for arranging it while the screen is split)
  cap.sceneStream = () => scene.captureStream(30);
  return cap;
}

/* ---------- Pictures and GIFs on the stream ----------
   Loaded as blobs (so the canvas stays streamable). A GIF is split into its frames and played on the canvas. */
function overlayFrame(o) {
  if (!o.frames) return o.img;
  let t = performance.now() % o.total;
  for (const f of o.frames) { if (t < f.dur) return f.img; t -= f.dur; }
  return o.frames[0].img;
}
async function makeOverlay(from) {
  const blob = from instanceof Blob ? from : await (await fetch(from)).blob();
  let frames = null, img;
  if (/gif/i.test(blob.type) && "ImageDecoder" in window) {
    try {
      const dec = new ImageDecoder({ data: await blob.arrayBuffer(), type: "image/gif" });
      await dec.tracks.ready;
      const n = Math.min(dec.tracks.selectedTrack.frameCount, 300);
      frames = [];
      for (let i = 0; i < n; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        frames.push({ img: await createImageBitmap(image), dur: Math.max(20, (image.duration || 100000) / 1000) });
        image.close();
      }
      img = frames[0].img;
      if (frames.length < 2) frames = null;
    } catch { frames = null; }
  }
  if (!img) img = await createImageBitmap(blob);
  const ratio = img.height / img.width;
  const w = Math.min(320, img.width), hh = Math.round(w * ratio);
  return { id: Math.random().toString(36).slice(2), img, frames, total: frames ? frames.reduce((n, f) => n + f.dur, 0) : 0, src: URL.createObjectURL(blob), gif: Boolean(frames), x: 24, y: 24, w, h: hh, ratio, opacity: 1 };
}

/* ---------- The chat, drawn on the stream (like YouTube / Twitch overlays) ---------- */
function drawChat(g, c) {
  if (!c.on) return;
  const now = Date.now();
  const msgs = (c.demo && !c.msgs.length ? [{ name: "LookBlog", text: "Your chat shows here. Drag me to move me, drag my corner to resize.", at: now }] : c.msgs).filter((m) => now - m.at < 45000);
  g.save();
  g.beginPath(); g.roundRect(c.x, c.y, c.w, c.h, 18); g.clip();
  g.fillStyle = "rgba(10, 10, 14, 0.58)"; g.fillRect(c.x, c.y, c.w, c.h);
  g.fillStyle = "#ff4fa3"; g.font = "800 17px system-ui, sans-serif"; g.fillText("💬 LIVE CHAT", c.x + 16, c.y + 28);
  const pad = 16, lh = 27, maxW = c.w - pad * 2;
  let y = c.y + c.h - pad;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    // lay out "Name  text…" word by word
    const lines = [[]];
    let x = 0;
    const put = (word, color, bold) => {
      g.font = `${bold ? 800 : 500} 21px system-ui, sans-serif`;
      const wd = g.measureText(word + " ").width;
      if (x + wd > maxW && x > 0) { lines.push([]); x = 0; }
      lines[lines.length - 1].push({ word, color, bold, x }); x += wd;
    };
    put(m.name, "#ff4fa3", true);
    for (const w of String(m.text || "").split(/\s+/).filter(Boolean)) put(w, "#ffffff", false);
    const stickerH = m.sticker?.complete ? 70 : 0;
    const blockH = lines.length * lh + stickerH + 8;
    if (y - blockH < c.y + 40) break;
    const age = now - m.at;
    g.globalAlpha = age > 35000 ? Math.max(0, 1 - (age - 35000) / 10000) : 1;
    let ly = y - blockH + lh - 6;
    for (const line of lines) { for (const t of line) { g.font = `${t.bold ? 800 : 500} 21px system-ui, sans-serif`; g.fillStyle = t.color; g.fillText(t.word, c.x + pad + t.x, ly); } ly += lh; }
    if (stickerH) { const sw = Math.min(70 * m.sticker.width / m.sticker.height, maxW); g.drawImage(m.sticker, c.x + pad, ly - lh + 6, sw, 66); }
    g.globalAlpha = 1;
    y -= blockH;
  }
  g.restore();
}

/* ---------- Camera size slider (screen + camera): any size, up to the whole stream ---------- */
const camSizeInputs = new Set();
function camSizeControl(cap) {
  const L = cap.layout;
  if (!cap.camTrack || L.source !== "both") return null;
  const r = h("input", { type: "range", min: 100, max: CW, value: L.camSize, class: "sm-range cam-size", "aria-label": "Camera size" });
  r.addEventListener("input", () => {
    const old = L.camRect();
    L.camSize = Number(r.value);
    const now = L.camRect();
    // grow from the corner it's anchored to, and keep it on the screen
    if (old && now) { L.camX = Math.max(0, Math.min(CW - now.w, old.x + old.w - now.w)); L.camY = Math.max(0, Math.min(CH - now.h, old.y + old.h - now.h)); }
  });
  camSizeInputs.add(r);
  return h("label", { class: "cam-size-row" }, h("span", { text: "📷 Camera size" }), r);
}

/* ---------- Move and resize things right on the preview ---------- */
function attachStageDrag(video, cap, { direct = false } = {}) {
  const L = cap.layout;
  const toCanvas = (e) => {
    const r = video.getBoundingClientRect(), sc = Math.min(r.width / CW, r.height / CH);
    const ox = r.left + (r.width - CW * sc) / 2, oy = r.top + (r.height - CH * sc) / 2;
    const p = { x: (e.clientX - ox) / sc, y: (e.clientY - oy) / sc };
    // Split screen: your things live inside your own tile
    const t = !direct && L.guests?.length ? L.hostTile : null;
    return t ? { x: (p.x - t.ox) / t.s, y: (p.y - t.oy) / t.s } : p;
  };
  const items = () => {
    const out = [...L.overlays].reverse().map((o) => ({ rect: o, kind: "pic", o }));
    if (L.chat.on) out.unshift({ rect: L.chat, kind: "chat" });
    const cr = L.camRect();
    if (cr) out.push({ rect: cr, kind: "cam" });
    return out;
  };
  const hit = (p) => {
    for (const it of items()) {
      const r = it.rect;
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { ...it, corner: p.x > r.x + r.w - 34 && p.y > r.y + r.h - 34 };
    }
    return null;
  };
  let drag = null;
  video.addEventListener("pointerdown", (e) => {
    const p = toCanvas(e), it = hit(p);
    if (!it) return;
    e.preventDefault();
    video.setPointerCapture(e.pointerId);
    drag = { it, dx: p.x - it.rect.x, dy: p.y - it.rect.y };
    video.classList.add("dragging");
  });
  video.addEventListener("pointermove", (e) => {
    const p = toCanvas(e);
    if (!drag) { const it = hit(p); video.style.cursor = it ? (it.corner ? "nwse-resize" : "move") : ""; return; }
    const { it } = drag, r = it.rect;
    if (it.corner) {
      const w = Math.max(80, Math.min(CW, p.x - r.x));
      if (it.kind === "pic") { it.o.w = Math.round(w); it.o.h = Math.round(w * it.o.ratio); }
      else if (it.kind === "chat") { L.chat.w = Math.max(220, Math.round(w)); L.chat.h = Math.max(160, Math.min(CH, Math.round(p.y - r.y))); }
      else { L.camSize = Math.max(100, Math.min(CW, Math.round(w))); camSizeInputs.forEach((i) => (i.value = L.camSize)); }
      return;
    }
    const nx = Math.round(Math.max(-r.w / 2, Math.min(CW - r.w / 2, p.x - drag.dx))), ny = Math.round(Math.max(-r.h / 2, Math.min(CH - r.h / 2, p.y - drag.dy)));
    if (it.kind === "pic") { it.o.x = nx; it.o.y = ny; }
    else if (it.kind === "chat") { L.chat.x = nx; L.chat.y = ny; }
    else { L.camX = nx; L.camY = ny; }
  });
  const stop = () => { drag = null; video.classList.remove("dragging"); };
  video.addEventListener("pointerup", stop);
  video.addEventListener("pointercancel", stop);
}

/* ---------- Your pictures and GIFs: add, size, move, remove ---------- */
function openOverlays(cap, onChange = () => {}) {
  const L = cap.layout;
  const list = h("div", { class: "ov-list" });
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  const add = h("button", { type: "button", class: "btn btn-primary btn-sm", text: "＋ Picture or GIF from your device" });
  const gifBtn = h("button", { type: "button", class: "btn btn-outline-light btn-sm", text: "🔎 Search GIFs" });
  const addFrom = async (src, btn) => {
    btn.disabled = true;
    try { L.overlays.push(await makeOverlay(src)); paint(); onChange(); }
    catch { toast("That picture couldn’t be added. Try another one."); }
    btn.disabled = false;
  };
  add.addEventListener("click", () => file.click());
  file.addEventListener("change", () => { const f = file.files[0]; file.value = ""; if (f) addFrom(f, add); });
  gifBtn.addEventListener("click", () => import("../components/gifs.js").then(({ openGifs }) => openGifs(gifBtn, (gg) => addFrom(gg.url, gifBtn))));
  const SPOTS = [["↖", 0, 0], ["↑", 0.5, 0], ["↗", 1, 0], ["↙", 0, 1], ["↓", 0.5, 1], ["↘", 1, 1], ["•", 0.5, 0.5]];
  const paint = () => {
    list.replaceChildren(...L.overlays.map((o) => {
      const size = h("input", { type: "range", min: 40, max: CW, value: o.w, class: "sm-range", "aria-label": "Size" });
      size.addEventListener("input", () => { const cx = o.x + o.w / 2, cy = o.y + o.h / 2; o.w = Number(size.value); o.h = Math.round(o.w * o.ratio); o.x = Math.round(cx - o.w / 2); o.y = Math.round(cy - o.h / 2); });
      const op = h("input", { type: "range", min: 20, max: 100, value: Math.round((o.opacity ?? 1) * 100), class: "sm-range", "aria-label": "Opacity" });
      op.addEventListener("input", () => (o.opacity = Number(op.value) / 100));
      const spots = h("div", { class: "ov-spots" }, ...SPOTS.map(([l, fx, fy]) => {
        const b = h("button", { type: "button", text: l, title: "Move here" });
        b.addEventListener("click", () => { const m = 20; o.x = Math.round(m + (CW - o.w - 2 * m) * fx); o.y = Math.round(m + (CH - o.h - 2 * m) * fy); });
        return b;
      }));
      const del = h("button", { type: "button", class: "btn btn-xs btn-danger", text: "Remove" });
      del.addEventListener("click", () => { L.overlays = L.overlays.filter((x) => x !== o); paint(); onChange(); });
      const up = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Bring to front" });
      up.addEventListener("click", () => { L.overlays = [...L.overlays.filter((x) => x !== o), o]; paint(); });
      return h("div", { class: "ov-item" }, h("div", { class: "ov-thumb" }, h("img", { src: o.src, alt: "" }), o.gif ? h("span", { class: "ov-gif", text: "GIF" }) : null),
        h("div", { class: "ov-ctl" }, h("label", {}, h("small", { class: "muted", text: "Size" }), size), h("label", {}, h("small", { class: "muted", text: "See-through" }), op), spots, h("div", { class: "ov-btns" }, up, del)));
    }));
    if (!L.overlays.length) list.append(h("p", { class: "muted", text: "Nothing yet. Add a logo, a frame, a sign or a GIF you want people to see on your stream." }));
  };
  paint();
  modal({ title: "Pictures & GIFs on your stream", body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: "They stay on the stream (and in the recording). Drag them right on your video to move them, drag a corner to resize." }),
    h("div", { class: "ov-add" }, add, gifBtn), file, list) });
}

/* ---------- 🎛 My screen: each person (the streamer or a guest) arranges only their own part ---------- */
function openMyScreen(cap, { who = "streamer", onChanged = () => {} } = {}) {
  const L = cap.layout;
  const body = h("div", { class: "create-form lv-settings" });
  const preview = h("video", { autoplay: true, playsInline: true, muted: true, class: "studio-video" });
  const sceneStream = cap.sceneStream();
  preview.srcObject = sceneStream;
  attachStageDrag(preview, cap, { direct: true });
  const row = (title, sub, control) => h("label", { class: "lv-set-row" }, h("span", {}, h("b", { text: title }), h("small", { class: "muted", text: sub })), control);
  const pick = (opts, cur, onPick) => h("div", { class: "vis-pick" }, ...opts.map(([k, l]) => h("button", { type: "button", class: k === cur ? "active" : "", text: l, onclick: async (e) => {
    const btn = e.currentTarget;
    if ((await onPick(k)) === false) return;
    btn.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === btn));
  } })));
  const paint = () => {
    const micBox = h("input", { type: "checkbox", checked: cap.mic ? cap.mic.enabled : false });
    micBox.addEventListener("change", () => { if (cap.mic) cap.mic.enabled = micBox.checked; onChanged(); });
    const camBox = h("input", { type: "checkbox", checked: L.cam });
    camBox.addEventListener("change", () => { L.cam = camBox.checked; onChanged(); });
    const chatBox = h("input", { type: "checkbox", checked: L.chat.on });
    chatBox.addEventListener("change", () => { L.chat.on = chatBox.checked; onChanged(); });
    const place = (where) => { const c = L.chat; if (where === "right") Object.assign(c, { x: CW - c.w - 20, y: 110 }); if (where === "left") Object.assign(c, { x: 20, y: 110 }); if (where === "bottom") Object.assign(c, { w: Math.min(c.w, 700), h: 220, x: Math.round((CW - Math.min(c.w, 700)) / 2), y: CH - 240 }); };
    const size = (k) => { const c = L.chat; const [w, hh] = k === "s" ? [300, 360] : k === "l" ? [480, 620] : [380, 480]; const right = c.x > CW / 2; Object.assign(c, { w, h: hh }); c.x = right ? CW - w - 20 : Math.max(20, Math.min(c.x, CW - w - 20)); c.y = Math.max(20, Math.min(c.y, CH - hh - 20)); };
    body.replaceChildren(
      h("p", { class: "create-hint", text: who === "guest" ? "This is only your part of the live. The streamer and other guests arrange their own parts." : "This is only your part. When guests join, each of them arranges their own part — and you arrange yours." }),
      h("div", { class: "lv-stage studio-stage" }, preview, h("span", { class: "lv-badge up", text: "YOUR SCREEN" })),
      h("p", { class: "create-hint", text: "Drag your camera, chat and pictures on the preview to move them; drag a corner to resize." }),
      row("What you show", "Switch any time — nobody gets disconnected", pick([["camera", "📷 Camera"], ["screen", "🖥️ Screen"], ["both", "🖥️+📷 Both"]], L.source, async (k) => {
        if (k === L.source) return false;
        try { await cap.switchSource(k); onChanged(); setTimeout(paint, 300); } catch { toast(k === "camera" ? "Couldn’t open the camera." : "Screen sharing was cancelled."); return false; }
      })),
      row("🎤 Microphone", "Others hear you", micBox),
      cap.camTrack ? row("📷 Camera", L.source === "camera" ? "Off shows “Be right back”" : "Your camera in the corner", camBox) : null,
      cap.camTrack && L.source === "both" ? row("Camera size", "Or drag its corner on the preview", camSizeControl(cap)) : null,
      row("💬 Live chat on my screen", "New messages show on your part, like on YouTube", chatBox),
      row("Chat position", "Or drag it on the preview", pick([["right", "Right"], ["left", "Left"], ["bottom", "Bottom"]], L.chat.x > CW / 2 ? "right" : "left", place)),
      row("Chat size", "Or drag its corner", pick([["s", "Small"], ["m", "Medium"], ["l", "Large"]], L.chat.w <= 300 ? "s" : L.chat.w >= 480 ? "l" : "m", size)),
      row("🖼️ Pictures & GIFs", "Your logo, frames, signs or GIFs", h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Open", onclick: () => openOverlays(cap) })));
  };
  paint();
  modal({ title: "🎛 My screen", wide: true, body, onClose: () => sceneStream.getTracks().forEach((t) => t.stop()) });
}

/* ---------- Start a stream now, schedule one, or start a scheduled one ---------- */
export function openGoLive(opts = {}) {
  const existing = opts.stream || null; // a scheduled stream being started
  const title = h("input", { type: "text", class: "text-input", maxlength: 100, placeholder: "What’s your stream about?", value: existing?.title || "" });
  const desc = h("textarea", { class: "text-input lv-desc-in", rows: 3, maxlength: 2000, placeholder: "Description (optional): what you’ll do, links, schedule…" });
  desc.value = existing?.description || "";
  const src = h("div", { class: "vis-pick" });
  let source = "camera";
  const paint = () => src.replaceChildren(...[["camera", "📷 Camera"], ["screen", "🖥️ Screen"], ["both", "🖥️+📷 Screen & camera"]].map(([k, l]) => {
    const b = h("button", { type: "button", class: k === source ? "active" : "", text: l });
    b.addEventListener("click", () => { source = k; paint(); });
    return b;
  }));
  paint();
  // Thumbnail
  let thumb = existing?.thumb || null;
  const thumbPrev = h("div", { class: "lv-thumb-prev" });
  const thumbIn = h("input", { type: "file", accept: "image/*", hidden: true });
  const thumbBtn = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "🖼️ Add a thumbnail" });
  const paintThumb = () => { thumbPrev.style.backgroundImage = thumb ? `url("${thumb}")` : ""; thumbPrev.hidden = !thumb; thumbBtn.textContent = thumb ? "🖼️ Change thumbnail" : "🖼️ Add a thumbnail"; };
  paintThumb();
  thumbBtn.addEventListener("click", () => thumbIn.click());
  thumbIn.addEventListener("change", async () => {
    const f = thumbIn.files[0];
    if (!f) return;
    thumbBtn.disabled = true; thumbBtn.textContent = "Uploading…";
    try { thumb = (await upload(f)).url; } catch (err) { toast(err.error || "Couldn’t upload it."); }
    thumbBtn.disabled = false; paintThumb();
  });
  // Now or later
  let later = false;
  const whenPick = h("div", { class: "vis-pick" });
  const at = h("input", { type: "datetime-local", class: "text-input", min: localValue(new Date(Date.now() + 2 * 60000)), value: localValue(new Date(Date.now() + 3600000)) });
  const whenBox = h("div", { hidden: true }, at, h("p", { class: "create-hint", text: "Your followers see it as an upcoming live and can tap “Notify me”. When it’s time, open it and press Go live now." }));
  const go = h("button", { type: "button", class: "btn btn-primary btn-full" });
  const srcWrap = h("div", {}, h("b", { class: "vis-label", text: "What to show" }), src);
  const paintWhen = () => {
    whenPick.replaceChildren(...[[false, "Now"], [true, "📅 Schedule"]].map(([k, l]) => {
      const b = h("button", { type: "button", class: k === later ? "active" : "", text: l });
      b.addEventListener("click", () => { later = k; paintWhen(); });
      return b;
    }));
    whenBox.hidden = !later;
    srcWrap.hidden = later;
    go.textContent = later ? "📅 Schedule live" : "Next: set up your stream →";
  };
  paintWhen();
  const m = modal({ title: existing ? "Go live now" : "Go live", body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: "Your followers get a notification. Up to 25 people can watch at once. When you end, the recording is saved to your profile under Streams." }),
    existing ? null : title, desc,
    h("div", { class: "lv-thumb-row" }, thumbPrev, thumbBtn, thumbIn),
    existing ? null : h("b", { class: "vis-label", text: "When" }), existing ? null : whenPick, whenBox,
    srcWrap, go) });
  go.addEventListener("click", async () => {
    go.disabled = true;
    if (later) {
      try {
        const { stream: st } = await api("/api/streams", { method: "POST", body: { title: title.value, description: desc.value, thumb, scheduledFor: new Date(at.value).toISOString() } });
        m.close();
        toast("Scheduled! Your followers can see it on your profile.");
        navigate(`/live/${st.id}`);
      } catch (err) { toast(err.error || "Couldn’t schedule it."); go.disabled = false; }
      return;
    }
    // Ask for the camera / screen first, so nothing starts if it's refused
    let cap;
    try { cap = await captureSource(source); }
    catch { toast(source === "camera" ? "LookBlog needs your camera and microphone to go live." : "Screen sharing was cancelled."); go.disabled = false; return; }
    m.close();
    openStudio(cap, async () => {
      if (existing) {
        if (thumb && thumb !== existing.thumb) await post(existing.id, "thumb", { thumb }).catch(() => {});
        return (await post(existing.id, "start", { description: desc.value, overlay: cap.layout.chat.on ? "on" : "off" })).stream;
      }
      return (await api("/api/streams", { method: "POST", body: { title: title.value, description: desc.value, thumb, overlay: cap.layout.chat.on ? "on" : "off" } })).stream;
    }, () => opts.onStarted?.());
  });
}

/* ---------- Studio: see your stream before you go live, add pictures/GIFs, place the camera and the chat ---------- */
function openStudio(cap, startStream, onStarted) {
  const L = cap.layout;
  L.chat.demo = true;
  const video = h("video", { autoplay: true, playsInline: true, muted: true, class: "studio-video" });
  video.srcObject = cap.stream;
  attachStageDrag(video, cap);
  let started = false;
  const pics = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "🖼️ Pictures & GIFs" });
  pics.addEventListener("click", () => openOverlays(cap));
  const chatBtn = h("button", { type: "button", class: "btn btn-sm btn-outline-light" });
  const paintChatBtn = () => { chatBtn.textContent = L.chat.on ? "💬 Chat on the stream: on" : "💬 Chat on the stream: off"; chatBtn.classList.toggle("on", L.chat.on); };
  chatBtn.addEventListener("click", () => { L.chat.on = !L.chat.on; paintChatBtn(); });
  paintChatBtn();
  const camBtn = cap.camTrack ? h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "📷 Hide camera" }) : null;
  camBtn?.addEventListener("click", () => { L.cam = !L.cam; camBtn.textContent = L.cam ? "📷 Hide camera" : "📷 Show camera"; });
  const goBtn = h("button", { type: "button", class: "btn btn-primary", text: "🔴 Go live" });
  const m = modal({ title: "Set up your stream", wide: true, onClose: () => { if (!started) cap.stop(); }, body: h("div", { class: "studio" },
    h("div", { class: "lv-stage studio-stage" }, video, h("span", { class: "lv-badge up", text: "PREVIEW" })),
    h("p", { class: "create-hint", text: "This is exactly what people will see. Drag pictures, GIFs, the camera and the chat to move them; drag a corner to resize." }),
    h("div", { class: "studio-tools" }, pics, chatBtn, camBtn, camSizeControl(cap), h("span", { style: "flex:1" }), goBtn)) });
  m.card?.classList.add("studio-modal");
  goBtn.addEventListener("click", async () => {
    goBtn.disabled = true; goBtn.textContent = "Starting…";
    try {
      const st = await startStream();
      started = true;
      L.chat.demo = false;
      window.__lbLive = cap;
      m.close();
      navigate(`/live/${st.id}`);
      onStarted?.();
    } catch (err) { toast(err.error || "Couldn’t go live."); goBtn.disabled = false; goBtn.textContent = "🔴 Go live"; }
  });
}

/* ---------- Reactions that float up over the video ---------- */
function floatReaction(layer, emoji) {
  const el = h("span", { class: "lv-float", text: emoji });
  el.style.left = `${10 + Math.random() * 75}%`;
  el.style.setProperty("--drift", `${Math.round((Math.random() - 0.5) * 80)}px`);
  layer.append(el);
  setTimeout(() => el.remove(), 2600);
}

/* ---------- Viewers: send a picture, a short video or a sound to the stream ---------- */
function openSendToStream(st) {
  let kind = "image";
  const tabs = h("div", { class: "vis-pick" });
  const body = h("div", {});
  const note = h("input", { type: "text", class: "text-input", maxlength: 120, placeholder: "Add a message (optional)" });
  const send = async (payload, btn) => {
    if (btn) btn.disabled = true;
    try { await post(st.id, "alert", { ...payload, text: note.value }); toast("Sent to the stream!"); m.close(); }
    catch (err) { toast(err.error || "Couldn’t send it."); if (btn) btn.disabled = false; }
  };
  const paint = () => {
    tabs.replaceChildren(...[["image", "🖼️ Picture"], ["video", "🎬 Video"], ["sound", "🔊 Sound"]].map(([k, l]) => {
      const b = h("button", { type: "button", class: k === kind ? "active" : "", text: l });
      b.addEventListener("click", () => { kind = k; paint(); });
      return b;
    }));
    if (kind === "sound") {
      const mine = h("div", { class: "lv-sounds" }, h("p", { class: "muted", text: "Loading your sounds…" }));
      api("/api/me/sounds").then(({ sounds }) => {
        mine.replaceChildren(...sounds.map((s) => {
          const play = h("button", { type: "button", class: "btn btn-xs btn-outline-light", title: "Listen", text: "▶", onclick: () => previewSound({ url: s.url }) });
          const b = h("button", { type: "button", class: "btn btn-xs btn-primary", text: "Send" });
          b.addEventListener("click", () => send({ kind: "sound", mySound: s.id }, b));
          return h("div", { class: "lv-sound" }, h("span", { class: "lv-sound-emoji", text: s.emoji }), h("b", { text: s.name }), play, b);
        }));
        if (!sounds.length) mine.append(h("p", { class: "muted", text: "You don’t have your own sounds yet." }));
        mine.append(h("button", { type: "button", class: "snd-add", text: "＋ Add your own sound", onclick: () => import("../components/sounds.js").then((m2) => m2.addMySound(() => paint())) }));
      }).catch(() => {});
      body.replaceChildren(h("b", { class: "vis-label", text: "Your sounds" }), mine);
      return;
    }
    const file = h("input", { type: "file", accept: kind === "image" ? "image/*" : "video/*", hidden: true });
    const pick = h("button", { type: "button", class: "btn btn-primary btn-full", text: kind === "image" ? "Choose a picture" : "Choose a video (up to 15 seconds)" });
    pick.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (!f) return;
      pick.disabled = true;
      try {
        if (kind === "video") {
          const secs = await new Promise((r) => { const v = document.createElement("video"); v.preload = "metadata"; v.onloadedmetadata = () => r(v.duration); v.onerror = () => r(0); v.src = URL.createObjectURL(f); });
          if (secs > 15.5) { toast("Keep the video under 15 seconds."); pick.disabled = false; return; }
        }
        pick.textContent = "Uploading…";
        const up = await upload(f, (p) => (pick.textContent = `Uploading… ${Math.round(p * 100)}%`));
        await send({ kind, url: up.url }, null);
      } catch (err) { toast(err.error || "Couldn’t upload it."); }
      pick.disabled = false; pick.textContent = kind === "image" ? "Choose a picture" : "Choose a video (up to 15 seconds)";
    });
    body.replaceChildren(pick, file);
  };
  paint();
  const m = modal({ title: "Send to the stream", body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: "It pops up on the stream for the streamer and everyone watching. Up to 3 a minute — keep it friendly." }),
    tabs, note, body) });
}

/* ---------- Host / mod settings ---------- */
function openStreamSettings(st, onChange, people = () => []) {
  const slow = h("select", { class: "text-input" }, ...[[0, "Off"], [5, "5 seconds"], [10, "10 seconds"], [30, "30 seconds"], [60, "1 minute"]].map(([v, l]) => h("option", { value: v, text: l, selected: st.settings.slow === v })));
  const fol = h("input", { type: "checkbox", checked: st.settings.followersOnly });
  const alerts = h("input", { type: "checkbox", checked: st.settings.alerts });
  const reacts = h("input", { type: "checkbox", checked: st.settings.reactions });
  const whoJoin = h("select", { class: "text-input" }, ...[["off", "Nobody (only people I invite)"], ["mutual", "People I follow each other with"], ["anyone", "Anyone watching"]].map(([v, l]) => h("option", { value: v, text: l, selected: st.settings.guests === v })));
  const maxG = h("select", { class: "text-input" }, ...[1, 2, 3].map((n) => h("option", { value: n, text: `${n} guest${n === 1 ? "" : "s"} (${n + 1} on screen)`, selected: st.settings.maxGuests === n })));
  whoJoin.addEventListener("change", () => save({ guests: whoJoin.value }));
  maxG.addEventListener("change", () => save({ maxGuests: Number(maxG.value) }));
  const chatOn = h("input", { type: "checkbox", checked: st.settings.chat });
  const overlay = h("input", { type: "checkbox", checked: st.settings.overlay !== "off" });
  reacts.addEventListener("change", () => save({ reactions: reacts.checked }));
  chatOn.addEventListener("change", () => save({ chat: chatOn.checked }));
  overlay.addEventListener("change", () => save({ overlay: overlay.checked ? "on" : "off" }));
  const save = async (body) => { try { const r = await post(st.id, "settings", body); st.settings = r.settings; onChange(); } catch (err) { toast(err.error || "Couldn’t save."); } };
  slow.addEventListener("change", () => save({ slow: Number(slow.value) }));
  fol.addEventListener("change", () => save({ followersOnly: fol.checked }));
  alerts.addEventListener("change", () => save({ alerts: alerts.checked }));
  const modsBox = h("div", { class: "lv-mods" });
  const paintMods = () => modsBox.replaceChildren(...(st.mods.length ? st.mods.map((u) => {
    const x = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Remove" });
    x.addEventListener("click", async () => { try { st.mods = (await post(st.id, "mods", { username: u, on: false })).mods; paintMods(); onChange(); } catch (err) { toast(err.error || "Couldn’t remove."); } });
    return h("div", { class: "lv-mod-row" }, h("span", { text: "🛡️ @" + u }), st.isHost ? x : null);
  }) : [h("p", { class: "muted", text: "No moderators yet." })]));
  paintMods();
  const add = h("input", { type: "text", class: "text-input", placeholder: "Type @ and their name" });
  attachMentions(add, { people });
  const addBtn = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "Add moderator" });
  add.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addBtn.click(); } });
  addBtn.addEventListener("click", async () => {
    const u = add.value.trim().replace(/^@/, "");
    if (!u) return;
    try { st.mods = (await post(st.id, "mods", { username: u, on: true })).mods; add.value = ""; paintMods(); onChange(); } catch (err) { toast(err.error || "Couldn’t add them."); }
  });
  modal({ title: "⚙️ Stream settings (whole live)", body: h("div", { class: "create-form lv-settings" },
    st.isHost ? h("label", { class: "lv-set-row" }, h("span", {}, h("b", { text: "🙋 Who can join your live" }), h("small", { class: "muted", text: "Guests go live with you — the screen splits in 2, 3 or 4" })), whoJoin) : null,
    st.isHost ? h("label", { class: "lv-set-row" }, h("span", {}, h("b", { text: "Guests at once" }), h("small", { class: "muted", text: "Up to 4 people on screen, you included" })), maxG) : null,
    h("label", { class: "lv-set-row" }, h("span", {}, h("b", { text: "Chat" }), h("small", { class: "muted", text: "Turn the chat off and on (you and moderators can still write)" })), chatOn),
    h("label", { class: "lv-set-row" }, h("span", {}, h("b", { text: "Reactions" }), h("small", { class: "muted", text: "Floating hearts, fire, laughs… over the video" })), reacts),
    h("p", { class: "create-hint", text: "These are for the whole live. Your camera, your chat on screen and your pictures are in 🎛 My screen — and every guest has their own." }),
    h("label", { class: "lv-set-row" }, h("span", {}, h("b", { text: "Slow mode" }), h("small", { class: "muted", text: "How long people wait between messages" })), slow),
    h("label", { class: "lv-set-row" }, h("span", {}, h("b", { text: "Followers-only chat" }), h("small", { class: "muted", text: "Only people who follow the streamer can chat" })), fol),
    h("label", { class: "lv-set-row" }, h("span", {}, h("b", { text: "Pictures, videos & sounds" }), h("small", { class: "muted", text: "Let viewers send pictures, videos and sounds that pop up on the stream" })), alerts),
    h("b", { class: "vis-label", text: "Moderators" }),
    h("p", { class: "create-hint", text: "Moderators can delete messages, pin them, time people out, remove them and change these settings." }),
    modsBox, st.isHost ? h("div", { class: "invite-row" }, add, addBtn) : null) });
}

/* ---------- The page ---------- */
export function livePage(view, mm) {
  const id = mm[1];
  view.classList.add("page-live");
  const box = h("div", {}, spinner());
  view.append(box);
  const cleanup = [];
  let ended = false;

  const load = async () => {
    cleanup.splice(0).forEach((f) => f());
    let d;
    try { d = await api(`/api/streams/${encodeURIComponent(id)}`); } catch (err) { box.replaceChildren(empty("This stream doesn’t exist.", err.error || "")); return; }
    const st = d.stream;
    document.title = `${st.title} / LookBlog Live`;
    if (st.upcoming) return upcoming(st);
    if (!st.live) {
      box.replaceChildren(empty("This stream has ended.", st.postId ? "Watch the recording:" : "", st.postId ? h("a", { class: "btn btn-primary btn-sm", href: `/watch/${st.postId}`, text: "Watch the recording" }) : null));
      return;
    }
    const video = h("video", { autoplay: true, playsInline: true, muted: st.isHost });
    const viewersEl = h("span", { class: "lv-count", text: `👁 ${st.viewers}` });
    const status = h("p", { class: "lv-status muted" });
    const floatLayer = h("div", { class: "lv-floats" });
    // The chat on the stream: the streamer's browser draws it into the video itself,
    // so viewers (and the recording) see it exactly where the streamer put it
    const capNow = () => (st.isHost ? window.__lbLive : null);
    // (whether the chat shows on the streamer's screen is the streamer's own choice in 🎛 My screen — not a stream setting)
    let overlayInit = false;
    const paintOverlay = () => { if (overlayInit) return; const c = capNow(); if (c) { overlayInit = true; if (st.settings.overlay === "on") c.layout.chat.on = true; } };
    const showOnScreen = (msg) => {
      const c = capNow();
      if (!c || st.settings.overlay === "off") return;
      let sticker = null;
      if (msg.sticker) { sticker = new Image(); sticker.src = msg.sticker; }
      const sound = msg.sound ? "🔊 " + (BUILTIN_SOUNDS.find((x) => x.builtin === msg.sound)?.name || "") : msg.soundUrl ? `${msg.soundEmoji || "🔊"} ${msg.soundName || ""}` : "";
      c.layout.chat.msgs.push({ name: msg.author.name, text: [msg.text, sound].filter(Boolean).join(" "), sticker, at: Date.now() });
      if (c.layout.chat.msgs.length > 30) c.layout.chat.msgs.shift();
    };
    const alertLayer = h("div", { class: "lv-alerts" });

    /* Chat: Top chat hides likely spam and repeats; Live chat shows everything */
    const messages = [];
    let mode = "top";
    const chatList = h("div", { class: "lv-chat-list" });
    const pinnedBar = h("div", { class: "lv-pinned", hidden: true });
    const chatIn = h("input", { type: "text", class: "lv-chat-in", maxlength: 200, placeholder: "Say something…" });
    // Emoji, your stickers, and sounds everyone hears
    const emojiBtn = h("button", { type: "button", class: "lv-chat-tool", title: "Emoji", text: "😊" });
    emojiBtn.addEventListener("click", () => openEmojiPicker(emojiBtn, (e) => insertAtCursor(chatIn, e), { keepOpen: true }));
    const stickerBtn = h("button", { type: "button", class: "lv-chat-tool", title: "Stickers", text: "🏷️" });
    stickerBtn.addEventListener("click", () => openStickers(stickerBtn, (sk) => post(st.id, "chat", { sticker: sk.id }).catch((err) => toast(err.error || "Couldn’t send."))));
    const soundBtn = h("button", { type: "button", class: "lv-chat-tool", title: "Sounds", text: "🔊" });
    // Only your own sounds here (the built-in ones are for group soundboards)
    soundBtn.addEventListener("click", () => openSoundPicker(soundBtn, { builtin: false, onPick: (b) => post(st.id, "chat", { mySound: b.mySound }).catch((err) => toast(err.error || "Couldn’t play it.")) }));
    const sendChat = h("button", { type: "submit", class: "btn btn-primary btn-sm", text: "Send" });
    const chatForm = h("form", { class: "lv-chat-form" }, h("div", { class: "lv-chat-tools" }, emojiBtn, stickerBtn, soundBtn), chatIn, sendChat);
    const chatOffNote = h("p", { class: "lv-chat-off", hidden: true, text: "💤 The chat is off right now." });
    const paintChatState = () => {
      const off = !st.settings.chat;
      chatOffNote.hidden = !off;
      chatOffNote.textContent = off ? (st.isMod ? "💤 The chat is off for viewers — you can still write." : "💤 The streamer turned the chat off.") : "";
      const block = off && !st.isMod;
      chatForm.hidden = block;
      soundBtn.hidden = !st.settings.alerts && !st.isMod;
    };
    const rules = h("p", { class: "lv-rules muted" });
    const paintRules = () => { rules.textContent = [st.settings.slow ? `🐢 Slow mode: ${st.settings.slow}s` : "", st.settings.followersOnly ? "💗 Followers-only chat" : ""].filter(Boolean).join(" · "); rules.hidden = !rules.textContent; };
    paintRules();
    const isTop = (msg, i) => {
      const b = msg.badges || {};
      if (b.host || b.mod || b.verified) return true;
      if (!msg.text) return !(msg.sound || msg.soundUrl) || b.follower; // stickers yes; sounds only from followers
      const t = msg.text.trim();
      if (/https?:\/\//i.test(t)) return false; // links
      if (t.length >= 8 && t === t.toUpperCase() && /[A-Z]/.test(t)) return false; // SHOUTING
      if (/(.)\1{5,}/u.test(t)) return false; // aaaaaaa
      const earlier = messages.slice(Math.max(0, i - 25), i);
      if (earlier.some((x) => (x.text || "").trim().toLowerCase() === t.toLowerCase())) return false; // repeats
      return b.follower || t.length >= 2;
    };
    const tabsEl = h("div", { class: "lv-chat-tabs" });
    const paintTabs = () => tabsEl.replaceChildren(...[["top", "Top chat"], ["all", "Live chat"]].map(([k, l]) => {
      const b = h("button", { type: "button", class: k === mode ? "active" : "", text: l, title: k === "top" ? "Some messages, like likely spam, are hidden" : "All messages are visible" });
      b.addEventListener("click", () => { mode = k; paintTabs(); paintChat(); });
      return b;
    }));
    const msgEl = (msg) => {
      const b = msg.badges || {};
      const el = h("p", { class: "lv-msg" + (b.host ? " is-host" : b.mod ? " is-mod" : ""), "data-id": msg.id },
        b.host ? h("span", { class: "lv-chip host", text: "🎥", title: "Streamer" }) : null,
        b.mod ? h("span", { class: "lv-chip mod", text: "🛡️", title: "Moderator" }) : null,
        h("a", { href: profileHref(msg.author.username), class: "lv-name", text: msg.author.name }), tick(msg.author, 12), " ",
        msg.text ? h("span", { class: "lv-text", text: msg.text }) : null,
        msg.sticker ? h("img", { class: "lv-sticker", src: msg.sticker, alt: "Sticker", loading: "lazy" }) : null,
        msg.sound ? h("span", { class: "lv-sound-msg" }, `🔊 played ${BUILTIN_SOUNDS.find((x) => x.builtin === msg.sound)?.name || "a sound"} `, h("button", { type: "button", class: "lv-replay", title: "Play again", text: "▶", onclick: () => previewSound({ builtin: msg.sound }) })) : null,
        msg.soundUrl ? h("span", { class: "lv-sound-msg" }, `${msg.soundEmoji || "🔊"} played ${msg.soundName || "a sound"} `, h("button", { type: "button", class: "lv-replay", title: "Play again", text: "▶", onclick: () => previewSound({ url: msg.soundUrl }) })) : null);
      if (!st.isMod && msg.author.username !== state.me.username) {
        const more = h("button", { type: "button", class: "lv-msg-more", title: "Report", text: "⋯" });
        more.addEventListener("click", (e) => { e.stopPropagation(); openReportLive(st, msg); });
        el.append(more);
      }
      if (st.isMod) {
        const more = h("button", { type: "button", class: "lv-msg-more", title: "Moderate", text: "⋯" });
        more.addEventListener("click", (e) => { e.stopPropagation(); modMenu(msg, more); });
        el.append(more);
      }
      return el;
    };
    const paintChat = () => {
      const near = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 80;
      chatList.replaceChildren(...messages.filter((msg, i) => mode === "all" || isTop(msg, i)).map(msgEl));
      if (!chatList.childElementCount) chatList.append(h("p", { class: "muted lv-chat-empty", text: "Say hi 👋" }));
      chatList.scrollTop = chatList.scrollHeight;
    };
    const addChat = (msg, live = false) => {
      if (live && msg.sound) previewSound({ builtin: msg.sound });
      if (live && msg.soundUrl) previewSound({ url: msg.soundUrl });
      if (live) showOnScreen(msg);
      messages.push(msg);
      if (messages.length > 300) messages.shift();
      const i = messages.length - 1;
      if (mode === "all" || isTop(msg, i)) {
        chatList.querySelector(".lv-chat-empty")?.remove();
        const near = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 120;
        chatList.append(msgEl(msg));
        if (near) chatList.scrollTop = chatList.scrollHeight;
      }
    };
    const paintPinned = (msg) => {
      pinnedBar.hidden = !msg;
      if (!msg) return pinnedBar.replaceChildren();
      const unpin = st.isMod ? h("button", { type: "button", class: "lv-unpin", title: "Unpin", text: "✕" }) : null;
      unpin?.addEventListener("click", () => post(st.id, "moderate", { action: "pin", messageId: null }).catch(() => {}));
      pinnedBar.replaceChildren(h("span", { text: "📌" }), avatar(msg.author, 22), h("div", {}, h("b", { text: msg.author.name }), h("span", { text: msg.text })), unpin);
    };
    d.chat.forEach((x) => messages.push(x));
    paintTabs(); paintChat(); paintPinned(d.pinned);

    let menuEl = null;
    const closeMenu = () => { menuEl?.remove(); menuEl = null; };
    document.addEventListener("click", closeMenu);
    cleanup.push(() => { document.removeEventListener("click", closeMenu); closeMenu(); });
    const modMenu = (msg, anchor) => {
      closeMenu();
      const act = (label, fn) => { const b = h("button", { type: "button", text: label }); b.addEventListener("click", async () => { closeMenu(); try { await fn(); } catch (err) { toast(err.error || "Couldn’t do that."); } }); return b; };
      const mine = msg.author.username === state.me.username;
      const target = !mine && !msg.badges?.host;
      menuEl = h("div", { class: "lv-menu" },
        act("📌 Pin message", () => post(st.id, "moderate", { action: "pin", messageId: msg.id })),
        act("🗑 Delete", () => post(st.id, "moderate", { action: "delete", messageId: msg.id })),
        ...(target ? [
          act("⏱ Timeout 1 min", () => post(st.id, "moderate", { action: "timeout", username: msg.author.username, minutes: 1 }).then(() => toast(`${msg.author.name} can’t chat for 1 minute.`))),
          act("⏱ Timeout 10 min", () => post(st.id, "moderate", { action: "timeout", username: msg.author.username, minutes: 10 }).then(() => toast(`${msg.author.name} can’t chat for 10 minutes.`))),
          act("🚫 Remove from stream", () => post(st.id, "moderate", { action: "ban", username: msg.author.username }).then(() => toast(`${msg.author.name} was removed.`))),
        ] : []),
        ...(st.isHost && !mine ? [st.mods.includes(msg.author.username)
          ? act("Remove moderator", async () => { st.mods = (await post(st.id, "mods", { username: msg.author.username, on: false })).mods; })
          : act("🛡️ Make moderator", async () => { st.mods = (await post(st.id, "mods", { username: msg.author.username, on: true })).mods; toast(`${msg.author.name} is now a moderator.`); })] : []));
      menuEl.addEventListener("click", (e) => e.stopPropagation());
      const r = anchor.getBoundingClientRect();
      menuEl.style.top = `${Math.min(r.bottom + 4, innerHeight - 260)}px`;
      menuEl.style.left = `${Math.max(8, r.right - 200)}px`;
      document.body.append(menuEl);
    };

    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = chatIn.value.trim();
      if (!text) return;
      chatIn.value = "";
      try { await post(st.id, "chat", { text }); } catch (err) { toast(err.error || "Couldn’t send."); chatIn.value = text; }
    });

    /* Reactions, likes, share, send */
    const reactBar = h("div", { class: "lv-react-bar" }, ...st.reactions.map((emo) => {
      const b = h("button", { type: "button", class: "lv-react", text: emo, title: "React" });
      b.addEventListener("click", () => {
        floatReaction(floatLayer, emo);
        post(st.id, "react", { emoji: emo }).catch((err) => toast(err.error || "Easy!"));
      });
      return b;
    }));
    const paintReacts = () => { reactBar.hidden = !st.settings.reactions && !st.isMod; reactBar.classList.toggle("is-off", !st.settings.reactions); };
    const likeBtn = h("button", { type: "button", class: "lv-vote" });
    const dislikeBtn = h("button", { type: "button", class: "lv-vote" });
    const paintVotes = () => {
      likeBtn.className = "lv-vote" + (st.myVote === "like" ? " on" : "");
      dislikeBtn.className = "lv-vote" + (st.myVote === "dislike" ? " on" : "");
      likeBtn.replaceChildren(icon("like"), h("span", { text: fmtCount(st.likes) }));
      dislikeBtn.replaceChildren(icon("dislike"), h("span", { text: fmtCount(st.dislikes) }));
    };
    paintVotes();
    const vote = async (v) => {
      try { const r = await post(st.id, "vote", { vote: st.myVote === v ? "none" : v }); Object.assign(st, r); paintVotes(); } catch (err) { toast(err.error || "Couldn’t save."); }
    };
    likeBtn.addEventListener("click", () => vote("like"));
    dislikeBtn.addEventListener("click", () => vote("dislike"));
    const shareBtn = h("button", { type: "button", class: "lv-vote" }, icon("share"), h("span", { text: "Share" }));
    shareBtn.addEventListener("click", () => openShareLink({ title: "Share live", url: `${location.origin}/live/${st.id}`, text: `🔴 ${st.host.name} is live: ${st.title}`, onShared: () => post(st.id, "shared").catch(() => {}) }));
    const sendBtn = h("button", { type: "button", class: "lv-vote lv-send" }, h("span", { text: "🎁 Send to stream" }));
    sendBtn.addEventListener("click", () => openSendToStream(st));
    const paintSend = () => { sendBtn.hidden = !st.settings.alerts && !st.isMod; };
    paintSend();
    const settingsBtn = h("button", { type: "button", class: "lv-vote", title: "Stream settings" }, h("span", { text: "⚙️ Stream settings" }));
    const chatPeople = () => { const seen = new Map(); for (const m of messages) if (m.author.username && m.author.username !== state.me.username) seen.set(m.author.username, m.author); return [...seen.values()].reverse(); };
    const repaintAll = () => { paintRules(); paintSend(); paintOverlay(); paintChatState(); paintReacts(); };
    settingsBtn.addEventListener("click", () => openStreamSettings(st, repaintAll, chatPeople));
    settingsBtn.hidden = !st.isMod;
    const reportBtn = st.isHost ? null : h("button", { type: "button", class: "lv-vote lv-report", title: "Report this live" }, h("span", { text: "⚑ Report" }));
    reportBtn?.addEventListener("click", () => openReportLive(st));
    const actions = h("div", { class: "lv-actions" }, likeBtn, dislikeBtn, shareBtn, sendBtn, settingsBtn, reportBtn);

    /* Pictures, videos and sounds viewers sent: shown one at a time */
    const queue = [];
    let showing = false;
    const nextAlert = () => {
      if (showing || !queue.length) return;
      showing = true;
      const a = queue.shift();
      const who = h("p", { class: "lv-alert-who" }, avatar(a.by, 26), h("b", { text: a.by.name }), h("span", { text: a.kind === "sound" ? " played a sound" : a.kind === "video" ? " sent a video" : " sent a picture" }));
      let media = null, ms = 6000;
      if (a.kind === "image") media = h("img", { src: a.url, alt: "" });
      else if (a.kind === "video") {
        media = h("video", { src: a.url, autoplay: true, playsInline: true });
        media.addEventListener("loadedmetadata", () => { media.play().catch(() => { media.muted = true; media.play().catch(() => {}); }); });
        ms = 15500;
        media.addEventListener("ended", () => done());
      } else {
        const s = BUILTIN_SOUNDS.find((x) => x.builtin === a.builtin);
        media = h("span", { class: "lv-alert-emoji", text: a.emoji || s?.emoji || "🔊" });
        previewSound(a.url ? { url: a.url } : { builtin: a.builtin });
        ms = 3500;
      }
      const el = h("div", { class: "lv-alert" }, media, who, a.text ? h("p", { class: "lv-alert-text", text: a.text }) : null);
      alertLayer.append(el);
      let t = null;
      const done = () => { clearTimeout(t); if (!el.isConnected) return; el.classList.add("out"); setTimeout(() => { el.remove(); showing = false; nextAlert(); }, 350); };
      t = setTimeout(done, ms);
    };

    const tools = h("div", { class: "lv-tools" });
    box.replaceChildren(h("div", { class: "lv-wrap" },
      h("div", { class: "lv-main" },
        h("div", { class: "lv-stage" }, video, h("span", { class: "lv-badge", text: "LIVE" }), viewersEl, floatLayer, alertLayer),
        reactBar,
        h("div", { class: "lv-info" }, h("a", { href: profileHref(st.host.username) }, avatar(st.host, 44)),
          h("div", { class: "lv-info-text" }, h("h1", { text: st.title }), h("p", { class: "muted" }, st.host.name, tick(st.host, 13), ` · started ${new Date(st.startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`)), tools),
        actions,
        st.description ? h("div", { class: "lv-desc" }, richText(st.description, [])) : null,
        status),
      h("aside", { class: "lv-chat" }, h("div", { class: "lv-chat-head" }, tabsEl), pinnedBar, rules, chatList, chatOffNote, chatForm)));
    paintOverlay(); paintChatState(); paintReacts();

    cleanup.push(on("stream:chat", (ev) => { if (ev.streamId === st.id) addChat(ev.message, true); }));
    cleanup.push(on("stream:count", (ev) => { if (ev.streamId === st.id) viewersEl.textContent = `👁 ${ev.viewers}`; }));
    cleanup.push(on("stream:react", (ev) => { if (ev.streamId === st.id && ev.by !== state.me.name) floatReaction(floatLayer, ev.emoji); }));
    cleanup.push(on("stream:votes", (ev) => { if (ev.streamId === st.id) { st.likes = ev.likes; st.dislikes = ev.dislikes; paintVotes(); } }));
    cleanup.push(on("stream:alert", (ev) => { if (ev.streamId === st.id) { queue.push(ev.alert); nextAlert(); } }));
    cleanup.push(on("stream:settings", (ev) => { if (ev.streamId === st.id) { st.settings = ev.settings; repaintAll(); } }));
    cleanup.push(on("stream:pinned", (ev) => { if (ev.streamId === st.id) paintPinned(ev.message); }));
    cleanup.push(on("stream:chat-deleted", (ev) => { if (ev.streamId !== st.id) return; const i = messages.findIndex((x) => x.id === ev.messageId); if (i > -1) messages.splice(i, 1); paintChat(); }));
    cleanup.push(on("stream:purge", (ev) => { if (ev.streamId !== st.id) return; for (let i = messages.length - 1; i >= 0; i--) if (messages[i].author.username === ev.username) messages.splice(i, 1); paintChat(); }));
    cleanup.push(on("stream:mods", (ev) => {
      if (ev.streamId !== st.id) return;
      st.mods = ev.mods;
      const wasMod = st.isMod;
      st.isMod = st.isHost || ev.mods.includes(state.me.username);
      if (wasMod !== st.isMod) { toast(st.isMod ? "You’re now a moderator on this stream 🛡️" : "You’re no longer a moderator here."); settingsBtn.hidden = !st.isMod; repaintAll(); paintChat(); }
    }));
    cleanup.push(on("stream:you", (ev) => {
      if (ev.streamId !== st.id) return;
      if (ev.action === "timeout") toast(`A moderator put you in a ${ev.minutes}-minute timeout.`);
      if (ev.action === "ban") { toast("You were removed from this stream."); ended = true; cleanup.splice(0).forEach((f) => f()); box.replaceChildren(empty("You were removed from this stream.", "")); }
      if (ev.action === "unban") toast("You can chat again.");
    }));

    if (!st.isHost) guestClient(st, video, actions);
    if (st.isHost) return host(st, video, tools, status);
    return watch(st, video, status);
  };

  /* ---------- A scheduled stream that hasn't started ---------- */
  function upcoming(st) {
    const cd = h("b", { class: "lv-countdown" });
    const tickCd = () => {
      const s = Math.max(0, Math.round((new Date(st.scheduledFor) - Date.now()) / 1000));
      const dd = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mi = Math.floor((s % 3600) / 60), ss = s % 60;
      cd.textContent = s ? `Starts in ${dd ? dd + "d " : ""}${hh ? hh + "h " : ""}${mi}m ${String(ss).padStart(2, "0")}s` : st.isHost ? "It’s time — go live!" : "Starting soon… waiting for the streamer";
    };
    tickCd();
    const iv = setInterval(tickCd, 1000);
    cleanup.push(() => clearInterval(iv));
    const remind = h("button", { type: "button", class: "btn btn-sm" });
    const paintRemind = () => { remind.className = "btn btn-sm " + (st.reminded ? "btn-following" : "btn-primary"); remind.textContent = st.reminded ? `🔔 You’ll be notified · ${st.reminders}` : `🔔 Notify me${st.reminders ? " · " + st.reminders : ""}`; };
    paintRemind();
    remind.addEventListener("click", async () => { try { Object.assign(st, await post(st.id, "remind")); paintRemind(); } catch (err) { toast(err.error || "Couldn’t save."); } });
    const share = h("button", { type: "button", class: "btn btn-sm btn-outline-light" }, icon("share"), h("span", { text: "Share" }));
    share.addEventListener("click", () => openShareLink({ title: "Share upcoming live", url: `${location.origin}/live/${st.id}`, text: `📅 ${st.host.name} goes live ${when(st.scheduledFor)}: ${st.title}` }));
    const goNow = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "🔴 Go live now" });
    goNow.addEventListener("click", () => openGoLive({ stream: st, onStarted: () => {} }));
    const cancel = h("button", { type: "button", class: "btn btn-sm btn-danger", text: "Cancel" });
    cancel.addEventListener("click", async () => { if (!confirm("Cancel this scheduled live?")) return; try { await api(`/api/streams/${st.id}`, { method: "DELETE" }); toast("Cancelled."); navigate(profileHref(state.me.username) + "?tab=stream"); } catch (err) { toast(err.error || "Couldn’t cancel."); } });
    box.replaceChildren(h("div", { class: "lv-upcoming" },
      h("div", { class: "lv-up-stage", style: st.thumb ? `background-image:url("${st.thumb}")` : "" }, h("span", { class: "lv-badge up", text: "UPCOMING" }), h("div", { class: "lv-up-cd" }, h("span", { text: "📅 " + when(st.scheduledFor) }), cd)),
      h("div", { class: "lv-info" }, h("a", { href: profileHref(st.host.username) }, avatar(st.host, 44)),
        h("div", { class: "lv-info-text" }, h("h1", { text: st.title }), h("p", { class: "muted" }, st.host.name, tick(st.host, 13), " · upcoming live")), st.description ? h("div", { class: "lv-desc" }, richText(st.description, [])) : null,
        h("div", { class: "lv-tools" }, ...(st.isHost ? [goNow, share, cancel] : [remind, share])))));
    // When the streamer starts, open the stream
    cleanup.push(on("stream:state", (ev) => { if (ev.streamId === st.id && ev.live) load(); }));
  }

  /* ---------- Streamer: send to every viewer, record, end ---------- */
  function host(st, video, tools, status) {
    const cap = window.__lbLive;
    if (!cap) {
      // The page was reloaded (or opened again): the stream is still live — pick what to show and carry on
      status.textContent = "Your stream is still live — the page was reloaded. Pick what to show to continue.";
      const pick = (source, label) => {
        const b = h("button", { class: "btn btn-sm btn-primary", text: label });
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            const c2 = await captureSource(source);
            window.__lbLive = c2;
            window.__lbResume = st.id; // host() reconnects everyone once it's listening
            load();
          } catch (err) { toast(err.error || (source === "camera" ? "LookBlog needs your camera and microphone." : "Screen sharing was cancelled.")); b.disabled = false; }
        });
        return b;
      };
      const end = h("button", { class: "btn btn-sm btn-danger", text: "End stream" });
      end.addEventListener("click", async () => { await post(st.id, "end", {}); navigate(profileHref(state.me.username) + "?tab=stream"); });
      tools.append(h("span", { class: "lv-resume-label", text: "🔴 Continue with:" }), pick("camera", "📷 Camera"), pick("screen", "🖥️ Screen"), pick("both", "🖥️+📷 Both"), end);
      const ping = setInterval(() => post(st.id, "ping").catch(() => {}), 5000);
      cleanup.push(() => clearInterval(ping));
      return;
    }
    // Reloading or closing the tab pauses the stream for viewers: ask first
    const warn = (e) => { if (!ended) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    cleanup.push(() => window.removeEventListener("beforeunload", warn));
    const stream = cap.stream;
    video.srcObject = stream;
    const peers = new Map();
    // Record what we send, to save it when the stream ends
    const chunks = [];
    let rec = null;
    try {
      rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm" });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start(2000);
    } catch { status.textContent = "Recording isn’t available in this browser — the stream won’t be saved."; }
    const startedAt = Date.now();
    const timer = h("span", { class: "lv-timer", text: "0:00" });
    const tickT = setInterval(() => { const s = Math.floor((Date.now() - startedAt) / 1000); timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; if (s % 5 === 0) post(st.id, "ping").catch(() => {}); }, 1000);
    const grab = async () => {
      const c = document.createElement("canvas");
      c.width = video.videoWidth || 1280; c.height = video.videoHeight || 720;
      c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
      const pb = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      return (await upload(new File([pb], "poster.jpg", { type: "image/jpeg" }))).url;
    };
    // No thumbnail? Use a frame from the first seconds
    if (!st.thumb) setTimeout(async () => { if (ended) return; try { st.thumb = (await post(st.id, "thumb", { thumb: await grab() })).thumb; } catch {} }, 5000);
    const mute = h("button", { class: "btn btn-sm btn-outline-light", text: "🎤 Mute" });
    mute.addEventListener("click", () => { const t = cap.mic || stream.getAudioTracks()[0]; if (!t) return; t.enabled = !t.enabled; mute.textContent = t.enabled ? "🎤 Mute" : "🔇 Unmute"; });
    const L = cap.layout;
    // My screen (only my part — guests have their own)
    const myScreen = h("button", { class: "btn btn-sm btn-primary", text: "🎛 My screen" });
    myScreen.addEventListener("click", () => openMyScreen(cap, { who: "streamer" }));
    const end = h("button", { class: "btn btn-sm btn-danger", text: "End stream" });
    tools.append(timer, mute, myScreen, end);
    // Drag your pictures, the camera and the chat right on the video (drag a corner to resize)
    attachStageDrag(video, cap);
    hostGuests(st, cap, tools);

    const connect = async (username) => {
      peers.get(username)?.close();
      const pc = new RTCPeerConnection({ iceServers: ICE });
      peers.set(username, pc);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => e.candidate && post(st.id, "signal", { to: username, data: { candidate: e.candidate.toJSON() } }).catch(() => {});
      await pc.setLocalDescription(await pc.createOffer());
      post(st.id, "signal", { to: username, data: { description: pc.localDescription } }).catch(() => {});
    };
    cleanup.push(on("stream:viewer", (ev) => { if (ev.streamId === st.id) connect(ev.username); }));
    cleanup.push(on("stream:viewer-left", (ev) => { if (ev.streamId === st.id) { peers.get(ev.username)?.close(); peers.delete(ev.username); } }));
    cleanup.push(on("stream:signal", async (ev) => {
      if (ev.streamId !== st.id || ev.data?.guest) return;
      const pc = peers.get(ev.from);
      if (!pc) return;
      try {
        if (ev.data?.description) {
          await pc.setRemoteDescription(ev.data.description);
          for (const cand of pc._early || []) await pc.addIceCandidate(cand).catch(() => {});
          pc._early = null;
        } else if (ev.data?.candidate) {
          // A candidate can arrive before the answer: keep it until then
          if (!pc.remoteDescription) (pc._early = pc._early || []).push(ev.data.candidate);
          else await pc.addIceCandidate(ev.data.candidate);
        }
      } catch {}
    }));
    // "Stop sharing" in the browser bar ends the stream
    // "Stop sharing" in the browser bar: go back to the camera instead of ending everything
    cap.onSourceEnded = () => cap.switchSource("camera").catch(() => end.click());
    (cap.screenTrack || cap.camTrack)?.addEventListener("ended", () => cap.onSourceEnded());

    end.addEventListener("click", async () => {
      if (ended) return;
      ended = true;
      end.disabled = true;
      clearInterval(tickT);
      peers.forEach((pc) => pc.close());
      // Stop recording, upload, and turn it into a video on the profile
      let media = null;
      if (rec && rec.state !== "inactive") {
        status.textContent = "Saving your stream…";
        await new Promise((r) => { rec.onstop = r; rec.stop(); });
        const blob = new Blob(chunks, { type: "video/webm" });
        const seconds = (Date.now() - startedAt) / 1000;
        let poster = null;
        if (!st.thumb) try { poster = await grab(); } catch {}
        try {
          status.textContent = "Uploading the recording…";
          const up = await upload(new File([blob], "stream.webm", { type: "video/webm" }), (p) => (status.textContent = `Uploading the recording… ${Math.round(p * 100)}%`));
          media = { url: up.url, poster, duration: Math.round(seconds), width: video.videoWidth || 1280, height: video.videoHeight || 720 };
        } catch (err) { toast(err.error || "Couldn’t save the recording."); }
      }
      cap.stop();
      window.__lbLive = null;
      try {
        const r = await post(st.id, "end", { media });
        toast(r.post ? "Stream saved to your profile under Streams." : "Stream ended.");
        navigate(r.post ? `/watch/${r.post.id}` : profileHref(state.me.username) + "?tab=stream");
      } catch (err) { toast(err.error || "Couldn’t end the stream."); }
    });
    cleanup.push(() => { if (!ended) end.click(); });
    status.textContent = "You’re live! Share the link so people can watch.";
    if (window.__lbResume === st.id) { window.__lbResume = null; post(st.id, "resume").then(() => toast("You’re back live — viewers are reconnecting.")).catch(() => {}); }
  }

  /* ---------- Streamer: guests join the live (the screen splits into 2–4) ---------- */
  function hostGuests(st, cap, tools) {
    const L = cap.layout;
    L.hostName = state.me.name;
    const gpeers = new Map(); // username -> { pc, audio }
    const early = new Map(); // username -> ICE candidates that came before the offer was set up
    const ginfo = new Map(); // username -> { screen, camOff } (what the guest is showing)
    let requests = st.guestRequests || [], guests = st.guests || [];
    const btn = h("button", { class: "btn btn-sm btn-outline-light lv-guest-btn" });
    const paintBtn = () => { btn.textContent = `🙋 Guests ${guests.length ? "(" + guests.length + ")" : ""}${requests.length ? " · " + requests.length + " asking" : ""}`; btn.classList.toggle("asking", requests.length > 0); };
    paintBtn();
    tools.insertBefore(btn, tools.lastChild);
    const act = async (action, username) => { try { const r = await post(st.id, "guest", { action, username }); guests = r.guests; requests = r.requests; paintBtn(); panelPaint?.(); } catch (err) { toast(err.error || "Couldn’t do that."); } };
    let panelPaint = null;
    btn.addEventListener("click", () => {
      const box = h("div", { class: "create-form lv-guests" });
      const invite = h("input", { type: "text", class: "text-input", placeholder: "Invite someone: type @ and their name" });
      attachMentions(invite);
      const inviteBtn = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "Invite", onclick: () => { const u = invite.value.trim().replace(/^@/, ""); if (u) { act("invite", u).then(() => toast("Invite sent!")); invite.value = ""; } } });
      panelPaint = () => {
        if (!box.isConnected && panelPaint) { /* first paint */ }
        const row = (u, ...b) => h("div", { class: "lv-guest-row" }, avatar(u, 30), h("b", { text: u.name }), h("span", { style: "flex:1" }), ...b);
        box.replaceChildren(
          h("p", { class: "create-hint", text: `Up to ${st.settings.maxGuests} guest${st.settings.maxGuests === 1 ? "" : "s"} can be live with you; the screen splits for everyone. Who can ask to join: ${st.settings.guests === "anyone" ? "anyone" : st.settings.guests === "off" ? "nobody (only people you invite)" : "people you follow each other with"} — change it in ⚙️ Settings.` }),
          h("b", { class: "vis-label", text: "Asking to join" }),
          ...(requests.length ? requests.map((u) => row(u, h("button", { type: "button", class: "btn btn-xs btn-primary", text: "Accept", onclick: () => act("accept", u.username) }), h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Decline", onclick: () => act("decline", u.username) }))) : [h("p", { class: "muted", text: "No one is asking right now." })]),
          h("b", { class: "vis-label", text: "Live with you" }),
          ...(guests.length ? guests.map((u) => row(u, h("button", { type: "button", class: "btn btn-xs btn-danger", text: "Remove", onclick: () => act("remove", u.username) }))) : [h("p", { class: "muted", text: "Nobody yet." })]),
          h("div", { class: "invite-row" }, invite, inviteBtn));
      };
      panelPaint();
      modal({ title: "🙋 Live together", body: box, onClose: () => (panelPaint = null) });
    });
    cleanup.push(on("stream:guest-request", (ev) => {
      if (ev.streamId !== st.id) return;
      document.querySelector(`.lv-ask[data-u="${CSS.escape(ev.user.username)}"]`)?.remove();
      const t = h("div", { class: "lv-ask", dataset: { u: ev.user.username } }, avatar(ev.user, 34), h("div", {}, h("b", { text: ev.user.name }), h("span", { text: " wants to join your live" })),
        h("button", { type: "button", class: "btn btn-xs btn-primary", text: "Accept", onclick: () => { act("accept", ev.user.username); t.remove(); } }),
        h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "✕", onclick: () => { act("decline", ev.user.username); t.remove(); } }));
      document.body.append(t);
      setTimeout(() => t.remove(), 20000);
    }));
    cleanup.push(on("stream:guest-requests", (ev) => {
      if (ev.streamId !== st.id) return;
      requests = ev.requests; paintBtn(); panelPaint?.();
      document.querySelectorAll(".lv-ask[data-u]").forEach((t) => { if (!requests.some((r) => r.username === t.dataset.u)) t.remove(); });
    }));
    cleanup.push(() => document.querySelectorAll(".lv-ask").forEach((t) => t.remove()));
    const closeGuest = (u) => { const x = gpeers.get(u); x?.pc.close(); x?.audio.remove(); x?.videoEl?.remove(); gpeers.delete(u); cap.removeGuest(u); };
    cleanup.push(on("stream:guests", (ev) => {
      if (ev.streamId !== st.id) return;
      guests = ev.guests; paintBtn(); panelPaint?.();
      for (const u of [...gpeers.keys()]) if (!guests.some((x) => x.username === u)) closeGuest(u);
      for (const gu of L.guests) gu.name = guests.find((x) => x.username === gu.username)?.name || gu.name;
    }));
    cleanup.push(on("stream:guest-left", (ev) => { if (ev.streamId === st.id) closeGuest(ev.username); }));
    // A guest calls in: answer, send them our sound, take their camera + mic
    cleanup.push(on("stream:signal", async (ev) => {
      if (ev.streamId !== st.id || !ev.data?.guest) return;
      const u = ev.from;
      let x = gpeers.get(u);
      // The guest switched camera/screen or turned the camera off
      if (ev.data.info) { ginfo.set(u, ev.data.info); const gu = L.guests.find((g) => g.username === u); if (gu) { gu.cover = !ev.data.info.screen; gu.off = Boolean(ev.data.info.camOff); } return; }
      if (ev.data.candidate && (!x || !x.ready)) { early.set(u, [...(early.get(u) || []), ev.data.candidate]); return; }
      try {
        if (ev.data.description) {
          if (x) closeGuest(u);
          const pc = new RTCPeerConnection({ iceServers: ICE });
          const audio = h("audio", { autoplay: true, hidden: true });
          document.body.append(audio);
          x = { pc, audio };
          gpeers.set(u, x);
          const mixTrack = cap.guestMixTrack(u);
          pc.addTrack(mixTrack, new MediaStream([mixTrack]));
          let gotAudio = false;
          pc.ontrack = (e) => {
            const stream = e.streams[0] || new MediaStream([e.track]);
            if (e.track.kind === "video") {
              const v = h("video", { autoplay: true, playsInline: true, muted: true, class: "lv-offscreen" });
              v.srcObject = new MediaStream([e.track]);
              document.body.append(v);
              x.videoEl = v;
              v.play().catch(() => {});
              const name = guests.find((g) => g.username === u)?.name || u;
              L.guests = [...L.guests.filter((g) => g.username !== u), { username: u, name, video: v, cover: !ginfo.get(u)?.screen, off: Boolean(ginfo.get(u)?.camOff) }];
            } else if (!gotAudio) { gotAudio = true; audio.srcObject = new MediaStream([e.track]); cap.addGuestAudio(u, new MediaStream([e.track])); }
          };
          pc.onicecandidate = (e) => e.candidate && post(st.id, "signal", { to: u, data: { guest: true, candidate: e.candidate.toJSON() } }).catch(() => {});
          await pc.setRemoteDescription(ev.data.description);
          await pc.setLocalDescription(await pc.createAnswer());
          post(st.id, "signal", { to: u, data: { guest: true, description: pc.localDescription } }).catch(() => {});
          x.ready = true;
          for (const cand of early.get(u) || []) await pc.addIceCandidate(cand).catch(() => {});
          early.delete(u);
        } else if (ev.data.candidate && x) await x.pc.addIceCandidate(ev.data.candidate);
      } catch (err) { console.warn("guest", err); }
    }));
    cleanup.push(() => { for (const u of [...gpeers.keys()]) closeGuest(u); });
  }

  /* ---------- Viewer: ask to join, then go live together with the streamer ---------- */
  function guestClient(st, video, actions) {
    let gpc = null, local = null, hostAudio = null, preview = null, state2 = st.isGuest ? "on" : st.requested ? "asked" : "off";
    let pending = [], guestBar = null;
    const btn = h("button", { type: "button", class: "lv-vote lv-join" });
    const paint = () => {
      btn.hidden = state2 === "off" && !st.canJoin && !st.invited;
      btn.textContent = state2 === "on" ? "🔴 You’re live · Leave" : state2 === "asked" ? "⏳ Asked to join · Cancel" : state2 === "connecting" ? "Connecting…" : "🙋 Join live";
      btn.classList.toggle("on", state2 === "on");
    };
    paint();
    actions.insertBefore(btn, actions.children[3] || null);
    // A guest picks Camera, Screen, or Screen + camera — whatever the streamer is using
    let gcap = null, gsource = "camera";
    const pickSource = () => new Promise((resolve) => {
      let done = false;
      const opt = (k, l, d) => h("button", { type: "button", class: "game-option", onclick: () => { done = true; m.close(); resolve(k); } }, h("b", { text: l }), h("span", { class: "muted", text: d }));
      const m = modal({ title: "How do you want to join?", onClose: () => { if (!done) resolve(null); }, body: h("div", { class: "game-pick" },
        opt("camera", "📷 Camera", "Your face on the live"), opt("screen", "🖥️ Screen", "Show your screen (with your mic)"), opt("both", "🖥️+📷 Screen & camera", "Your screen with your camera in a corner")) });
    });
    const stop = (tellServer) => {
      guestBar?.remove(); guestBar = null;
      pending = [];
      gpc?.close(); gpc = null;
      gcap?.stop(); gcap = null; local = null;
      hostAudio?.remove(); hostAudio = null; preview?.remove(); preview = null;
      video.muted = false;
      if (tellServer) post(st.id, "guest", { action: "leave" }).catch(() => {});
      state2 = "off"; paint();
    };
    const start = async (source) => {
      source = source || (await pickSource());
      if (!source) { post(st.id, "guest", { action: "leave" }).catch(() => {}); state2 = "off"; paint(); return; }
      gsource = source;
      state2 = "connecting"; paint();
      try { gcap = await captureSource(source); }
      catch { toast(source === "camera" ? "LookBlog needs your camera and microphone to join." : "Screen sharing was cancelled."); post(st.id, "guest", { action: "leave" }).catch(() => {}); state2 = "off"; paint(); return; }
      local = gcap.stream;
      gpc = new RTCPeerConnection({ iceServers: ICE });
      local.getTracks().forEach((t) => gpc.addTrack(t, local));
      hostAudio = h("audio", { autoplay: true, hidden: true });
      document.body.append(hostAudio);
      gpc.ontrack = (e) => { if (e.track.kind === "audio") hostAudio.srcObject = new MediaStream([e.track]); };
      gpc.onicecandidate = (e) => e.candidate && post(st.id, "signal", { to: st.host.username, data: { guest: true, candidate: e.candidate.toJSON() } }).catch(() => {});
      gpc.onconnectionstatechange = () => { if (gpc?.connectionState === "failed") { toast("Lost the connection to the live."); stop(true); } };
      await gpc.setLocalDescription(await gpc.createOffer());
      post(st.id, "signal", { to: st.host.username, data: { guest: true, description: gpc.localDescription } }).catch(() => {});
      tellHost({ screen: source !== "camera" });
      gcap.onSourceEnded = () => { if (gcap && gsource !== "camera") switchTo("camera"); };
      (gcap.screenTrack || gcap.camTrack)?.addEventListener("ended", () => gcap?.onSourceEnded());
      // You hear the streamer directly; the stream's own sound would echo you back a moment later
      video.muted = true;
      // Your own small preview (the big video is the stream everyone sees, split with you in it)
      preview = h("video", { class: "lv-self", autoplay: true, playsInline: true, muted: true, style: "position:absolute;right:12px;bottom:12px;left:auto;top:auto;width:22%;max-width:220px;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:12px;border:2px solid #ff4fa3;z-index:3;pointer-events:none" + (source === "camera" ? ";transform:scaleX(-1)" : "") });
      preview.srcObject = local;
      video.parentElement.append(preview);
      guestControls();
      state2 = "on"; paint();
      toast("You’re live! 🎉");
    };
    // Change what you show without leaving (same connection, same picture track)
    const switchTo = async (source) => {
      if (!gcap) return false;
      try { await gcap.switchSource(source); } catch { toast(source === "camera" ? "Couldn’t open the camera." : "Screen sharing was cancelled."); return false; }
      gsource = source;
      preview.style.transform = source === "camera" ? "scaleX(-1)" : "none";
      return true;
    };
    // Your controls while you're on the live: what you show, mic, camera, camera size, your preview
    const tellHost = (info) => post(st.id, "signal", { to: st.host.username, data: { guest: true, info } }).catch(() => {});
    function guestControls() {
      const b = (label, fn, cls = "btn-outline-light") => { const x = h("button", { type: "button", class: "btn btn-xs " + cls, text: label }); x.addEventListener("click", () => fn(x)); return x; };
      // 🎛 My screen: the same panel the streamer has — but only for my own part of the live
      const myScreen = b("🎛 My screen", () => openMyScreen(gcap, { who: "guest", onChanged: () => { gsource = gcap.layout.source; preview.style.transform = gsource === "camera" ? "scaleX(-1)" : "none"; } }), "btn-primary");
      const mic = b(gcap?.mic?.enabled === false ? "🔇 Unmute" : "🎤 Mute", (x) => { const t = gcap?.mic; if (!t) return; t.enabled = !t.enabled; x.textContent = t.enabled ? "🎤 Mute" : "🔇 Unmute"; });
      const hide = b("🙈 Hide my preview", (x) => { preview.hidden = !preview.hidden; x.textContent = preview.hidden ? "👀 Show my preview" : "🙈 Hide my preview"; });
      guestBar = h("div", { class: "lv-guest-bar" }, h("b", { text: "🔴 You’re live with " + st.host.name }), myScreen, mic, hide);
      actions.after(guestBar);
    }
    btn.addEventListener("click", async () => {
      if (state2 === "on") return stop(true);
      if (state2 === "asked") { await post(st.id, "guest", { action: "cancel" }).catch(() => {}); state2 = "off"; return paint(); }
      if (state2 !== "off") return;
      try { const r = await post(st.id, "guest", { action: "request" }); if (r.accepted) return start(); state2 = "asked"; paint(); toast("Asked to join — waiting for the streamer."); }
      catch (err) { toast(err.error || "You can’t join this live."); }
    });
    cleanup.push(on("stream:chat", (ev) => {
      if (ev.streamId !== st.id || !gcap) return;
      const msg = ev.message;
      let sticker = null;
      if (msg.sticker) { sticker = new Image(); sticker.src = msg.sticker; }
      gcap.layout.chat.msgs.push({ name: msg.author.name, text: [msg.text, msg.soundName ? `${msg.soundEmoji || "🔊"} ${msg.soundName}` : ""].filter(Boolean).join(" "), sticker, at: Date.now() });
      if (gcap.layout.chat.msgs.length > 30) gcap.layout.chat.msgs.shift();
    }));
    cleanup.push(on("stream:guest-accepted", (ev) => { if (ev.streamId === st.id && state2 !== "on") start(); }));
    cleanup.push(on("stream:guest-reconnect", (ev) => { if (ev.streamId === st.id && state2 === "on") { const was = gsource; stop(false); start(was); } }));
    // I was on the live and reloaded the page: join again on my own (with the camera)
    if (st.isGuest) { state2 = "off"; setTimeout(() => start("camera"), 600); }
    cleanup.push(on("stream:guest-declined", (ev) => { if (ev.streamId === st.id) { state2 = "off"; paint(); toast("The streamer said not now."); } }));
    cleanup.push(on("stream:guest-removed", (ev) => { if (ev.streamId === st.id) { stop(false); toast("You left the live."); } }));
    cleanup.push(on("stream:guest-invite", (ev) => {
      if (ev.streamId !== st.id) return;
      st.invited = true; paint();
      const t = h("div", { class: "lv-ask" }, avatar(ev.by, 34), h("div", {}, h("b", { text: ev.by.name }), h("span", { text: " invited you to join their live" })),
        h("button", { type: "button", class: "btn btn-xs btn-primary", text: "Join", onclick: () => { t.remove(); btn.click(); } }),
        h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "✕", onclick: () => t.remove() }));
      document.body.append(t);
      setTimeout(() => t.remove(), 20000);
    }));
    cleanup.push(on("stream:signal", async (ev) => {
      if (ev.streamId !== st.id || !ev.data?.guest || !gpc) return;
      try {
        if (ev.data.description) {
          await gpc.setRemoteDescription(ev.data.description);
          for (const cand of pending) await gpc.addIceCandidate(cand).catch(() => {});
          pending = [];
        } else if (ev.data.candidate) {
          if (!gpc.remoteDescription) pending.push(ev.data.candidate);
          else await gpc.addIceCandidate(ev.data.candidate);
        }
      } catch {}
    }));
    cleanup.push(on("stream:ended", (ev) => { if (ev.streamId === st.id) stop(false); }));
    cleanup.push(() => { if (gpc) stop(true); });
  }

  /* ---------- Viewer ---------- */
  function watch(st, video, status) {
    // One connection to the streamer; a fresh offer (the streamer came back after a reload) gets a fresh connection
    let pc = null;
    const makePc = () => {
      pc?.close();
      pc = new RTCPeerConnection({ iceServers: ICE });
      pc.ontrack = (e) => { video.srcObject = e.streams[0]; status.textContent = ""; video.play().catch(() => { status.textContent = "Tap the video to start the sound."; video.muted = true; video.play(); }); };
      pc.onicecandidate = (e) => e.candidate && post(st.id, "signal", { to: st.host.username, data: { candidate: e.candidate.toJSON() } }).catch(() => {});
      pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") status.textContent = "Couldn’t connect to the stream. Try reloading."; };
      return pc;
    };
    makePc();
    video.addEventListener("click", () => { video.muted = false; status.textContent = ""; });
    cleanup.push(on("stream:signal", async (ev) => {
      if (ev.streamId !== st.id || ev.data?.guest) return;
      try {
        if (ev.data?.description) {
          if (ev.data.description.type === "offer" && pc.remoteDescription) makePc();
          const mine = pc;
          await mine.setRemoteDescription(ev.data.description);
          for (const cand of mine._early || []) await mine.addIceCandidate(cand).catch(() => {});
          mine._early = null;
          await mine.setLocalDescription(await mine.createAnswer());
          post(st.id, "signal", { to: st.host.username, data: { description: mine.localDescription } }).catch(() => {});
        } else if (ev.data?.candidate) {
          if (!pc.remoteDescription) (pc._early = pc._early || []).push(ev.data.candidate);
          else await pc.addIceCandidate(ev.data.candidate);
        }
      } catch {}
    }));
    cleanup.push(on("stream:ended", (ev) => {
      if (ev.streamId !== st.id) return;
      ended = true;
      pc.close();
      status.textContent = "The stream has ended. The recording will appear on the streamer’s profile.";
      video.srcObject = null;
    }));
    status.textContent = "Connecting…";
    post(st.id, "join").catch((err) => (status.textContent = err.error || "Couldn’t join."));
    const ping = setInterval(() => post(st.id, "ping").catch(() => {}), 15000);
    cleanup.push(() => { clearInterval(ping); if (!ended) post(st.id, "leave").catch(() => {}); pc?.close(); });
  }

  load();
  return () => cleanup.splice(0).forEach((f) => f());
}
livePage.navName = () => "";
livePage.layout = "wide";
