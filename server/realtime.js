// Live updates with Server-Sent Events, plus who is online.

const { save, findUser } = require("./db");

const clients = new Set();
const connections = new Map(); // userId -> number of open tabs
const offlineTimers = new Map();
const OFFLINE_GRACE_MS = 8000; // a quick reload shouldn't flash "offline"

function write(event, filter = null) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) if (!filter || filter.has(c.userId)) c.res.write(data);
}

function presence(userId) {
  const u = findUser(userId);
  return { online: isOnline(userId), lastSeen: u?.lastSeen || null };
}
function isOnline(userId) {
  return (connections.get(userId) || 0) > 0 || offlineTimers.has(userId);
}

function announce(user, online) {
  write({ type: "presence", username: user.username, online, lastSeen: user.lastSeen || null });
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

  // When people are around, by hour (for "when your audience is online")
  me.onlineHours = me.onlineHours || Array(24).fill(0);
  me.onlineHours[new Date().getHours()]++;
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

function broadcast(event) {
  write(event);
}

// Only to these people (private things like messages and mentions)
function sendTo(userIds, event) {
  write(event, new Set(userIds));
}

// Keep connections open through proxies
setInterval(() => {
  for (const c of clients) c.res.write(": ping\n\n");
}, 25000).unref();

module.exports = { handleEvents, broadcast, sendTo, isOnline, presence };
