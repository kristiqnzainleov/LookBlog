// Live updates, plus who is online.
//   Locally: Server-Sent Events on /api/events, and a person is online while a tab is connected.
//   Online (Supabase): events go out through Supabase Realtime. Each person listens on a private topic
//   with an unguessable name (lb-<rtKey>), and on one topic for everyone whose name only logged-in people get. A person is online while their tabs ping.

const crypto = require("crypto");
const { db, save, findUser } = require("./db");
const store = require("./store");

const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const SB_PUBLIC_KEY = process.env.SUPABASE_PUBLIC_KEY || "";
// The topic for everyone (only logged-in people learn its name)
const ALL_TOPIC = "lb-all-" + crypto.createHash("sha256").update("lookblog-all:" + SB_KEY).digest("base64url").slice(0, 24);

const clients = new Set();
const connections = new Map(); // userId -> number of open tabs
const offlineTimers = new Map();
const OFFLINE_GRACE_MS = 8000; // a quick reload shouldn't flash "offline"
const PING_ONLINE_MS = 75 * 1000; // online: a tab pinged within this time

function write(event, filter = null) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) if (!filter || filter.has(c.userId)) c.res.write(data);
}

function presence(userId) {
  const u = findUser(userId);
  return { online: isOnline(userId), lastSeen: u?.lastSeen || null };
}
function isOnline(userId) {
  if (store.enabled) { const u = findUser(userId); return Boolean(u?.pingAt && Date.now() - u.pingAt < PING_ONLINE_MS); }
  return (connections.get(userId) || 0) > 0 || offlineTimers.has(userId);
}

function announce(user, online) {
  broadcast({ type: "presence", username: user.username, online, lastSeen: user.lastSeen || null });
}
function countHour(me) {
  // When people are around, by hour (for "when your audience is online")
  me.onlineHours = me.onlineHours || Array(24).fill(0);
  me.onlineHours[new Date().getHours()]++;
}

function handleEvents(req, res, me) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  const client = { res, userId: me.id };
  clients.add(client);

  countHour(me);
  save("users");
  const wasOnline = isOnline(me.id);
  clearTimeout(offlineTimers.get(me.id));
  offlineTimers.delete(me.id);
  connections.set(me.id, (connections.get(me.id) || 0) + 1);
  if (!wasOnline) announce(me, true);

  req.on("close", () => {
    clients.delete(client);
    const left = (connections.get(me.id) || 1) - 1;
    if (left > 0) return connections.set(me.id, left);
    connections.delete(me.id);
    offlineTimers.set(me.id, setTimeout(() => {
      offlineTimers.delete(me.id);
      if (isOnline(me.id)) return;
      me.lastSeen = new Date().toISOString();
      save("users");
      announce(me, false);
    }, OFFLINE_GRACE_MS));
  });
}

/* ---------- Online: Supabase Realtime ---------- */
const topicOf = (u) => {
  if (!u.rtKey) { u.rtKey = crypto.randomBytes(18).toString("base64url"); save("users"); }
  return "lb-" + u.rtKey;
};
// Where my browser listens: GET /api/realtime
function realtimeInfo(me) {
  return { mode: "supabase", url: SB_URL.replace(/^http/, "ws") + "/realtime/v1/websocket", key: SB_PUBLIC_KEY, topics: [topicOf(me), ALL_TOPIC] };
}
// My tab is open: POST /api/ping (every ~30 seconds)
function ping(me) {
  const was = isOnline(me.id);
  me.pingAt = Date.now();
  if (!was) { countHour(me); announce(me, true); }
  save("users");
}
// People whose tabs stopped pinging are offline now
function sweepOffline() {
  for (const u of db.users) {
    if (u.pingAt && !isOnline(u.id) && !u.offlineSaid) {
      u.offlineSaid = true;
      u.lastSeen = new Date(u.pingAt).toISOString();
      save("users");
      announce(u, false);
    } else if (u.pingAt && isOnline(u.id) && u.offlineSaid) { u.offlineSaid = false; save("users"); }
  }
}

let queue = [];
let timer = null;
function queueOut(topic, event) {
  queue.push({ topic, event: "lb", payload: event, private: false });
  if (!timer) timer = setTimeout(flushRealtime, 30);
}
// Send what's waiting (requests call this before they answer)
async function flushRealtime() {
  clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const messages = queue;
  queue = [];
  for (let i = 0; i < messages.length; i += 100) {
    try {
      const r = await fetch(`${SB_URL}/realtime/v1/api/broadcast`, {
        method: "POST",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messages.slice(i, i + 100) }),
      });
      if (!r.ok) console.error("[realtime]", r.status, await r.text().catch(() => ""));
    } catch (err) { console.error("[realtime]", err.message); }
  }
}

function broadcast(event) {
  if (store.enabled) return queueOut(ALL_TOPIC, event);
  write(event);
}

// Only to these people (private things like messages and mentions)
function sendTo(userIds, event) {
  if (store.enabled) {
    for (const id of new Set(userIds)) { const u = findUser(id); if (u) queueOut(topicOf(u), event); }
    return;
  }
  write(event, new Set(userIds));
}

// Keep connections open through proxies
if (!store.enabled) setInterval(() => {
  for (const c of clients) c.res.write(": ping\n\n");
}, 25000).unref();

if (store.enabled) require("./ticker").every(sweepOffline, 20 * 1000);

module.exports = { handleEvents, broadcast, sendTo, isOnline, presence, realtimeInfo, ping, sweepOffline, flushRealtime };
