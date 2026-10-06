// Microphone and speaker choice, kept per browser, plus the connection servers for calls and voice.
// Used by voice channels and calls.
import { h, modal, toast } from "../ui.js";
import { api } from "../api.js";

const KEY = "lb-audio";
export function audioPrefs() {
  try { return { micId: "", speakerId: "", noiseSuppression: true, echoCancellation: true, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { micId: "", speakerId: "", noiseSuppression: true, echoCancellation: true }; }
}
function savePrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} }

// The microphone you picked (or the default one if it's gone)
export async function getMic(prefs = audioPrefs()) {
  const base = { echoCancellation: prefs.echoCancellation, noiseSuppression: prefs.noiseSuppression, autoGainControl: true, channelCount: 1 };
  if (prefs.micId) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: prefs.micId } } }); }
    catch (err) { if (err.name === "NotAllowedError") throw err; } // that mic is unplugged: use the default
  }
  return navigator.mediaDevices.getUserMedia({ audio: base });
}

// The same choice as constraints for getUserMedia (a missing mic just falls back to the default)
export function micConstraints(prefs = audioPrefs()) {
  // HD: the microphone at full quality (48 kHz)
  return { echoCancellation: prefs.echoCancellation, noiseSuppression: prefs.noiseSuppression, autoGainControl: true,
    sampleRate: { ideal: 48000 }, sampleSize: { ideal: 16 }, channelCount: { ideal: 1 }, ...(prefs.micId ? { deviceId: { ideal: prefs.micId } } : {}) };
}

/* ---------- HD voice ----------
   Opus normally sends voice at about 32 kbps. Before using the other side's offer/answer we ask for much more
   (up to 128 kbps, full 48 kHz, with repair for lost packets): their settings decide how *my* voice is sent,
   so both sides doing this makes both directions HD. */
const HD = { maxaveragebitrate: 128000, maxplaybackrate: 48000, useinbandfec: 1, usedtx: 0 };
export function hdDescription(desc) {
  if (!desc?.sdp) return desc;
  const pt = (desc.sdp.match(/a=rtpmap:(\d+) opus\/48000/i) || [])[1];
  if (!pt) return desc;
  const lines = desc.sdp.split("\r\n");
  const i = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
  const params = Object.fromEntries(i >= 0 ? lines[i].slice(`a=fmtp:${pt} `.length).split(";").map((x) => x.trim().split("=")).filter((x) => x[0]) : []);
  Object.assign(params, HD);
  const line = `a=fmtp:${pt} ` + Object.entries(params).map(([k, v]) => `${k}=${v}`).join(";");
  if (i >= 0) lines[i] = line;
  else { const r = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `)); if (r >= 0) lines.splice(r + 1, 0, line); }
  return { type: desc.type, sdp: lines.join("\r\n") };
}
// And let my voice use that much (once connected)
export async function hdSenders(pc) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "audio" || !sender.getParameters) continue;
    try {
      const prm = sender.getParameters();
      if (!prm.encodings?.length) prm.encodings = [{}];
      prm.encodings[0].maxBitrate = HD.maxaveragebitrate;
      prm.encodings[0].priority = "high";
      prm.encodings[0].networkPriority = "high";
      await sender.setParameters(prm);
    } catch {}
  }
}

export async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return { mics: all.filter((d) => d.kind === "audioinput"), speakers: all.filter((d) => d.kind === "audiooutput") };
}
export const canPickSpeaker = () => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

// Connection servers for WebRTC (STUN, and TURN when LookBlog has one, so calls work across mobile networks too)
let iceCache = null;
export async function iceServers() {
  if (iceCache && Date.now() - iceCache.at < 30 * 60 * 1000) return iceCache.list;
  try { iceCache = { at: Date.now(), list: (await api("/api/ice")).iceServers }; }
  catch { iceCache = { at: Date.now(), list: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] }; }
  return iceCache.list;
}

// One sound engine for the whole page (browsers only allow a few, and phones start it only after a tap)
let ctx = null;
export function audioEngine() {
  if (!ctx || ctx.state === "closed") ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  return ctx;
}

// The settings window: microphone, speaker, a live mic meter and the clean-up options
export async function openAudioSettings({ onMicChange, onSpeakerChange, onOptionsChange } = {}) {
  const prefs = audioPrefs();
  let { mics, speakers } = await listDevices();
  const micSel = h("select", { class: "adm-input adm-select vs-select" });
  const spkSel = h("select", { class: "adm-input adm-select vs-select" });
  const fill = () => {
    micSel.replaceChildren(h("option", { value: "", text: "Default microphone" }), ...mics.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => h("option", { value: d.deviceId, text: d.label || `Microphone ${i + 1}`, selected: d.deviceId === prefs.micId })));
    spkSel.replaceChildren(h("option", { value: "", text: "Default speaker" }), ...speakers.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => h("option", { value: d.deviceId, text: d.label || `Speaker ${i + 1}`, selected: d.deviceId === prefs.speakerId })));
  };
  fill();
  const bar = h("i");
  const meter = h("div", { class: "vs-meter", title: "Talk to see your microphone move" }, bar);
  const ns = h("input", { type: "checkbox", checked: prefs.noiseSuppression });
  const ec = h("input", { type: "checkbox", checked: prefs.echoCancellation });
  const testSpk = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "🔊 Test" });

  // A live meter for the chosen microphone
  let testStream = null, raf = 0;
  async function startMeter() {
    cancelAnimationFrame(raf);
    testStream?.getTracks().forEach((t) => t.stop());
    try { testStream = await getMic(prefs); } catch { bar.style.width = "0"; return; }
    const ac = audioEngine(), an = ac.createAnalyser();
    an.fftSize = 512;
    ac.createMediaStreamSource(testStream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const loop = () => { an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); bar.style.width = Math.min(100, peak * 1.6) + "%"; raf = requestAnimationFrame(loop); };
    loop();
    // Now that the browser allowed the mic, the device names are known
    ({ mics, speakers } = await listDevices()); fill();
  }
  micSel.addEventListener("change", async () => { prefs.micId = micSel.value; savePrefs(prefs); startMeter(); await onMicChange?.(prefs); });
  spkSel.addEventListener("change", () => { prefs.speakerId = spkSel.value; savePrefs(prefs); onSpeakerChange?.(prefs.speakerId); });
  for (const [box, k] of [[ns, "noiseSuppression"], [ec, "echoCancellation"]]) box.addEventListener("change", async () => { prefs[k] = box.checked; savePrefs(prefs); startMeter(); await onOptionsChange?.(prefs); });
  testSpk.addEventListener("click", async () => {
    const a = new Audio();
    const ac = audioEngine(), dest = ac.createMediaStreamDestination(), o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 660; g.gain.setValueAtTime(0.15, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.6);
    o.connect(g); g.connect(dest); o.start(); o.stop(ac.currentTime + 0.65);
    a.srcObject = dest.stream;
    if (prefs.speakerId && a.setSinkId) await a.setSinkId(prefs.speakerId).catch(() => {});
    a.play().catch(() => toast("Tap again to hear the test."));
  });

  modal({ title: "Voice settings", onClose: () => { cancelAnimationFrame(raf); testStream?.getTracks().forEach((t) => t.stop()); }, body: h("div", { class: "create-form vs-settings" },
    h("b", { class: "vis-label", text: "Microphone" }), micSel, meter,
    h("p", { class: "create-hint", text: "Talk: the bar should move. If it doesn’t, pick another microphone." }),
    canPickSpeaker() ? h("b", { class: "vis-label", text: "Speaker" }) : null,
    canPickSpeaker() ? h("div", { class: "vs-row" }, spkSel, testSpk) : h("p", { class: "create-hint", text: "This browser plays sound on the speaker your phone or computer is using." }),
    h("label", { class: "check-row" }, ns, h("span", { text: "Noise suppression (cuts background noise)" })),
    h("label", { class: "check-row" }, ec, h("span", { text: "Echo cancellation (turn off only with headphones)" }))) });
  startMeter();
}
