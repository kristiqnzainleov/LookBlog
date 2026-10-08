// Live updates from the server. Counts on screen update in place:
//   [data-post-id][data-stat="likes|dislikes|views|comments"]  for posts
//   [data-followers="username"]                                for follower counts
//   [data-following="username"]                                for following counts
import { emit } from "./state.js";
import { repaintPost } from "./components/edit-post.js";
import { count, lastSeenText } from "./ui.js";

function bump(el, value) {
  if (el.textContent === value) return;
  el.textContent = value;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

function handle(ev) {
  if (ev.type === "stats") {
    for (const stat of ["likes", "dislikes", "views", "comments", "reposts", "cools", "shares"]) { if (ev[stat] === undefined) continue;
      document.querySelectorAll(`[data-post-id="${CSS.escape(ev.id)}"][data-stat="${stat}"]`).forEach((el) => bump(el, count(ev[stat])));
    }
  }
  if (ev.type === "follow") {
    document.querySelectorAll(`[data-followers="${CSS.escape(ev.username)}"]`).forEach((el) => bump(el, count(ev.followers)));
    document.querySelectorAll(`[data-following="${CSS.escape(ev.by)}"]`).forEach((el) => bump(el, count(ev.byFollowing)));
  }
  if (ev.type === "thumbnail") {
    document.querySelectorAll(`[data-thumb-for="${CSS.escape(ev.id)}"]`).forEach((el) => {
      if (el.tagName === "VIDEO") el.setAttribute("poster", ev.poster); else el.src = ev.poster;
    });
  }
  if (ev.type === "presence") {
    const name = CSS.escape(ev.username);
    document.querySelectorAll(`[data-presence-dot="${name}"]`).forEach((el) => {
      el.classList.toggle("online", ev.online && !ev.idle);
      el.classList.toggle("idle", Boolean(ev.idle));
      el.title = ev.idle ? "Idle" : lastSeenText(ev.online, ev.lastSeen);
    });
    document.querySelectorAll(`[data-presence-text="${name}"]`).forEach((el) => {
      el.classList.toggle("online", ev.online && !ev.idle);
      el.classList.toggle("idle", Boolean(ev.idle));
      el.dataset.lastSeen = ev.lastSeen || "";
      el.textContent = ev.idle ? "Idle" : lastSeenText(ev.online, ev.lastSeen);
    });
  }
  if (ev.type === "post:edited") repaintPost(ev);
  emit(ev.type, ev);
}

// Locally the server streams events (SSE). Online they come through Supabase Realtime.
export async function connect() {
  // Ask how live updates work here; if the server is waking up or the network blips, ask again
  let info = null;
  for (let wait = 1000; !info; wait = Math.min(wait * 2, 15000)) {
    try { const r = await fetch("/api/realtime", { credentials: "same-origin" }); if (r.ok) info = await r.json(); else if (r.status === 401) return; } catch {}
    if (!info) await new Promise((ok) => setTimeout(ok, wait));
  }
  // "I'm here" (and whether I'm idle: LookBlog is in the background, or I haven't touched it for 5 minutes)
  let lastActive = Date.now(), sentIdle = null;
  const isIdle = () => document.visibilityState !== "visible" || Date.now() - lastActive > 5 * 60 * 1000;
  const ping = (force = false) => {
    const idle = isIdle();
    if (!force && info.mode !== "supabase" && idle === sentIdle) return; // (locally the live connection already says I'm online)
    sentIdle = idle;
    fetch("/api/ping" + (idle ? "?idle=1" : ""), { method: "POST", headers: { "X-LookBlog": "1" }, credentials: "same-origin", keepalive: true }).catch(() => {});
  };
  const active = () => { const was = isIdle(); lastActive = Date.now(); if (was && !isIdle()) ping(true); };
  for (const ev of ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"]) addEventListener(ev, active, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => ping(true));
  setInterval(() => ping(info.mode === "supabase"), 30 * 1000);
  if (info.mode !== "supabase") {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => { let ev; try { ev = JSON.parse(e.data); } catch { return; } handle(ev); };
    ping(true);
    return;
  }
  listenSupabase(info);
  ping(true);
}

// A tiny Supabase Realtime client (Phoenix channels over a WebSocket): join my topics, hear "lb" broadcasts.
// Other parts of the app can also join extra topics and send on them (the voice relay uses this).
const extra = new Map(); // topic -> handler(event, payload)
let rtSend = null;
const joinCfg = { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, private: false } };
export const realtimeLink = {
  join(topic, handler) { extra.set(topic, handler); rtSend?.("realtime:" + topic, "phx_join", joinCfg); },
  leave(topic) { extra.delete(topic); rtSend?.("realtime:" + topic, "phx_leave"); },
  send(topic, event, payload) { return Boolean(rtSend?.("realtime:" + topic, "broadcast", { type: "broadcast", event, payload })); },
  get ready() { return Boolean(rtSend); },
};
function listenSupabase({ url, key, topics }) {
  let ws, ref = 0, beat, retry = 1000;
  const send = (topic, event, payload = {}) => { if (ws?.readyState !== 1) return false; ws.send(JSON.stringify({ topic, event, payload, ref: String(++ref) })); return true; };
  rtSend = send;
  const open = () => {
    ws = new WebSocket(`${url}?apikey=${encodeURIComponent(key)}&vsn=1.0.0`);
    ws.onopen = () => {
      retry = 1000;
      for (const t of topics) send("realtime:" + t, "phx_join", { config: { broadcast: { self: false }, presence: { key: "" }, private: false } });
      for (const t of extra.keys()) send("realtime:" + t, "phx_join", joinCfg);
      clearInterval(beat);
      beat = setInterval(() => send("phoenix", "heartbeat"), 25 * 1000);
    };
    ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.event !== "broadcast" || !msg.payload) return;
      if (msg.payload.event === "lb" && msg.payload.payload) return handle(msg.payload.payload);
      const h = extra.get(String(msg.topic || "").replace(/^realtime:/, ""));
      if (h) h(msg.payload.event, msg.payload.payload);
    };
    ws.onclose = () => {
      clearInterval(beat);
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 15000);
    };
  };
  open();
}
