// Voice messages: record with the microphone, then play them back with a pink waveform.
import { h, icon, toast, duration as fmt } from "../ui.js";

const MAX_SECONDS = 120;
const BARS = 48;

function pickMime() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return options.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

/*
  startRecording({ onTick(seconds, level) }) -> Promise<{ stop(): Promise<{ blob, duration, peaks }>, cancel() }>
*/
export async function startRecording({ onTick = () => {} } = {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Your browser can’t record audio.");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    throw new Error("LookBlog needs your microphone to record. Allow it in your browser and try again.");
  }
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  // Listen to the volume to draw the waveform
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const levels = [];
  const t0 = performance.now();
  let raf, stopped = false;

  const loop = () => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    const level = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
    levels.push(level);
    const secs = (performance.now() - t0) / 1000;
    onTick(secs, level);
    if (secs >= MAX_SECONDS) { api.stop(); return; }
    raf = requestAnimationFrame(loop);
  };
  rec.start(250);
  loop();

  const cleanup = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  let finishing = null;
  const api = {
    stop() {
      if (finishing) return finishing;
      const secs = Math.min(MAX_SECONDS, (performance.now() - t0) / 1000);
      finishing = new Promise((resolve) => {
        rec.onstop = () => {
          cleanup();
          // Squeeze the volume readings into a fixed number of bars
          const peaks = [];
          const step = Math.max(1, levels.length / BARS);
          for (let i = 0; i < BARS; i++) {
            const part = levels.slice(Math.floor(i * step), Math.floor((i + 1) * step));
            peaks.push(part.length ? Math.max(...part) : 0);
          }
          const top = Math.max(0.05, ...peaks);
          resolve({ blob: new Blob(chunks, { type: (rec.mimeType || mime || "audio/webm").split(";")[0] }), duration: secs, peaks: peaks.map((p) => Math.max(0.08, p / top)) });
        };
        if (rec.state !== "inactive") rec.stop(); else rec.onstop();
      });
      return finishing;
    },
    cancel() {
      if (stopped) return;
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
      cleanup();
    },
  };
  return api;
}

/* ---------- The player in a chat bubble ---------- */
let playing = null; // only one voice message plays at a time

export function voicePlayer(m) {
  const audio = new Audio();
  audio.preload = "metadata";
  audio.src = m.url;
  const peaks = m.peaks?.length ? m.peaks : Array.from({ length: BARS }, (_, i) => 0.3 + 0.25 * Math.abs(Math.sin(i * 0.9)));
  const total = m.duration || 0;

  const playBtn = h("button", { type: "button", class: "vp-play", "aria-label": "Play voice message" }, icon("play"));
  const wave = h("div", { class: "vp-wave", role: "slider", "aria-label": "Seek", tabindex: "0" },
    ...peaks.map((p) => h("span", { style: `height:${Math.round(18 + p * 82)}%` })));
  const time = h("span", { class: "vp-time", text: fmt(total) });
  const speed = h("button", { type: "button", class: "vp-speed", text: "1×", "aria-label": "Speed" });
  const el = h("div", { class: "voice" }, playBtn, wave, h("div", { class: "vp-side" }, time, speed));

  const bars = [...wave.children];
  const paint = () => {
    const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : total;
    const p = d ? audio.currentTime / d : 0;
    const lit = Math.round(p * bars.length);
    bars.forEach((b, i) => b.classList.toggle("on", i < lit));
    time.textContent = audio.paused && audio.currentTime === 0 ? fmt(total) : fmt(audio.currentTime);
    playBtn.replaceChildren(icon(audio.paused ? "play" : "pause"));
    el.classList.toggle("is-playing", !audio.paused);
  };
  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (audio.paused) {
      if (playing && playing !== audio) playing.pause();
      playing = audio;
      audio.play().catch(() => toast("Couldn’t play this voice message."));
    } else audio.pause();
  });
  wave.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = wave.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : total;
    if (d) audio.currentTime = p * d;
    paint();
  });
  const SPEEDS = [1, 1.5, 2];
  speed.addEventListener("click", (e) => {
    e.stopPropagation();
    audio.playbackRate = SPEEDS[(SPEEDS.indexOf(audio.playbackRate) + 1) % SPEEDS.length];
    speed.textContent = audio.playbackRate + "×";
  });
  for (const ev of ["timeupdate", "play", "pause", "seeked", "loadedmetadata"]) audio.addEventListener(ev, paint);
  audio.addEventListener("ended", () => { audio.currentTime = 0; paint(); });
  paint();
  return el;
}
