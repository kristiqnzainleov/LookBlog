// Voice channels in groups. Everyone in a channel connects to everyone else (WebRTC);
// the server keeps the list of who is in which channel and passes the set-up messages along.

const { db, findUser, findByUsername } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { sendTo } = require("./realtime");
const { can, rank } = require("./groups");
const BUILTIN_SOUNDS = ["airhorn", "tada", "drum", "boing", "ding", "sad"];

const rooms = new Map(); // "chatId:channelId" -> Map(userId -> { muted, deaf, video, screen, seen })
const where = new Map(); // userId -> "chatId:channelId"
const STALE_MS = 45 * 1000; // no heartbeat for this long = gone

/* ---------- Music in a voice channel ----------
   Everyone's browser plays the same thing at the same spot (a LookBlog song or a YouTube video);
   the server keeps what's playing, from when, and the queue. Each person sets their own volume. */
const music = new Map(); // room key -> { now: item|null, startedAt, pausedAt, queue: [] }
const YT_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/;
async function youtubeInfo(url) {
  const m = String(url || "").match(YT_RE);
  if (!m) return null;
  const id = m[1];
  let title = "YouTube video", thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`, { signal: ac.signal });
    clearTimeout(t);
    if (r.ok) { const d = await r.json(); title = String(d.title || title).slice(0, 120); thumb = d.thumbnail_url || thumb; }
  } catch {}
  return { kind: "youtube", ref: id, title, thumb, duration: null };
}
function musicView(key) {
  const m = music.get(key);
  if (!m || !m.now) return null;
  return { now: m.now, startedAt: m.startedAt, pausedAt: m.pausedAt, queue: m.queue, volume: m.volume ?? 70, changedBy: m.changedBy || null, serverNow: Date.now() };
}
function sendMusic(chat, channelId) {
  const key = chat.id + ":" + channelId;
  const room = rooms.get(key);
  if (room) sendTo([...room.keys()], { type: "voice:music", chatId: chat.id, channelId, music: musicView(key) });
}
function playNext(key) {
  const m = music.get(key);
  if (!m) return;
  m.now = m.queue.shift() || null;
  m.startedAt = Date.now(); m.pausedAt = null;
  if (!m.now) music.delete(key);
}

function participants(chatId, channelId) {
  const room = rooms.get(chatId + ":" + channelId);
  if (!room) return [];
  return [...room].map(([id, s]) => {
    const u = findUser(id);
    return u && { name: u.name, username: u.username, avatar: u.avatar, verified: Boolean(u.verified), verifiedType: u.verifiedType || null, muted: s.muted, deaf: s.deaf, video: s.video, screen: s.screen };
  }).filter(Boolean);
}

function announce(chat, channelId) {
  sendTo(chat.members, { type: "voice:state", chatId: chat.id, channelId, participants: participants(chat.id, channelId) });
}

function leave(userId, chats) {
  const key = where.get(userId);
  if (!key) return;
  where.delete(userId);
  const room = rooms.get(key);
  room?.delete(userId);
  if (room && !room.size) { rooms.delete(key); music.delete(key); }
  const [chatId, channelId] = key.split(":");
  const chat = chats.find((c) => c.id === chatId);
  if (chat) {
    announce(chat, channelId);
    const u = findUser(userId);
    if (u && room) sendTo([...room.keys()], { type: "voice:left", chatId, channelId, username: u.username });
  }
}

// POST /api/groups/:id/voice { kind: join|leave|ping|state|signal, channelId, to, data, muted, deaf, video, screen }
async function handleVoice(req, res, me, chat, chats) {
  if (!chat.members.includes(me.id)) throw httpError(403, "Join the group to use voice channels.");
  const body = await readJSON(req, 200_000);
  const channel = chat.channels.find((c) => c.id === body.channelId && c.kind === "voice");
  const key = channel ? chat.id + ":" + channel.id : null;

  if (body.kind === "join") {
    if (!channel) throw httpError(404, "That voice channel doesn’t exist.");
    rateLimit("voice:" + me.id, 60, 10 * 60 * 1000, "Slow down a little.");
    if (where.get(me.id) !== key) leave(me.id, chats);
    if (!rooms.has(key)) rooms.set(key, new Map());
    const room = rooms.get(key);
    if (room.size >= 12 && !room.has(me.id)) throw httpError(400, "This voice channel is full (12 people).");
    const others = participants(chat.id, channel.id).filter((p) => p.username !== me.username);
    room.set(me.id, { muted: Boolean(body.muted), deaf: false, video: false, screen: false, seen: Date.now() });
    where.set(me.id, key);
    announce(chat, channel.id);
    sendJSON(res, 200, { participants: others, music: musicView(key) });
    return true;
  }
  if (body.kind === "leave") {
    leave(me.id, chats);
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Disconnect someone from the channel (needs "Remove people", and only people below you)
  if (body.kind === "kick") {
    const target = findByUsername(String(body.username || ""));
    const room = key && rooms.get(key);
    if (!target || !room || !room.has(target.id)) throw httpError(404, "They’re not in this channel.");
    if (!can(chat, me, "kick") || rank(chat, target.id) >= rank(chat, me.id)) throw httpError(403, "You can’t disconnect them.");
    leave(target.id, chats);
    sendTo([target.id], { type: "voice:kicked", chatId: chat.id, by: me.name });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  const room = key && rooms.get(key);
  if (!room || !room.has(me.id)) throw httpError(409, "You’re not in that voice channel.");
  const mine = room.get(me.id);
  mine.seen = Date.now();
  if (body.kind === "ping") { sendJSON(res, 200, { ok: true }); return true; }
  if (body.kind === "state") {
    for (const k of ["muted", "deaf", "video", "screen"]) if (k in body) mine[k] = Boolean(body[k]);
    announce(chat, channel.id);
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Soundboard: everyone in the channel hears it
  if (body.kind === "sound") {
    rateLimit("sound:" + me.id, 20, 60 * 1000, "Easy on the sounds!");
    const snd = (chat.sounds || []).find((x) => x.id === body.soundId);
    const builtin = BUILTIN_SOUNDS.includes(body.builtin) ? body.builtin : null;
    if (!snd && !builtin) throw httpError(404, "That sound is gone.");
    sendTo([...room.keys()], { type: "voice:sound", chatId: chat.id, channelId: channel.id, by: me.name, url: snd?.url || null, builtin, name: snd?.name || builtin, emoji: snd?.emoji || null });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Music: { kind: "music", action: play|queue|pause|resume|skip|stop|ended|seek, songId | url, itemId, at }
  if (body.kind === "music") {
    rateLimit("vmusic:" + me.id, 40, 60 * 1000, "Slow down a little.");
    const m = music.get(key) || { now: null, startedAt: 0, pausedAt: null, queue: [], volume: 70 };
    const a = body.action;
    m.changedBy = me.name;
    if (a === "play" || a === "queue") {
      let item = null;
      if (body.songId) {
        const sg = db.songs.find((x) => x.id === body.songId);
        if (!sg) throw httpError(404, "That song is gone.");
        const artist = findUser(sg.userId);
        item = { kind: "song", ref: sg.id, url: sg.url, title: sg.title, thumb: sg.cover || null, artist: artist?.name || "", duration: sg.duration || null };
      } else if (body.url) {
        item = await youtubeInfo(body.url);
        if (!item) throw httpError(400, "Paste a YouTube link (youtube.com/watch?v=… or youtu.be/…).");
      } else throw httpError(400, "Pick a song or paste a YouTube link.");
      item.id = Math.random().toString(36).slice(2, 10);
      me.voiceDJ = (me.voiceDJ || 0) + 1; require("./db").save("users");
      item.by = me.name;
      if (a === "play" || !m.now) { m.now = item; m.startedAt = Date.now(); m.pausedAt = null; }
      else { if (m.queue.length >= 30) throw httpError(400, "The queue is full."); m.queue.push(item); }
      music.set(key, m);
    } else if (!m.now) throw httpError(409, "Nothing is playing.");
    else if (a === "pause") { if (m.pausedAt == null) m.pausedAt = Date.now() - m.startedAt; }
    else if (a === "resume") { if (m.pausedAt != null) { m.startedAt = Date.now() - m.pausedAt; m.pausedAt = null; } }
    else if (a === "seek") { const at = Math.max(0, Number(body.at) || 0) * 1000; if (m.pausedAt != null) m.pausedAt = at; else m.startedAt = Date.now() - at; }
    else if (a === "skip") playNext(key);
    else if (a === "ended") { if (m.now.id === body.itemId) playNext(key); else { sendJSON(res, 200, { music: musicView(key) }); return true; } }
    else if (a === "stop") music.delete(key);
    else if (a === "volume") m.volume = Math.max(0, Math.min(100, Math.round(Number(body.volume) || 0)));
    else if (a === "unqueue") m.queue = m.queue.filter((x) => x.id !== body.itemId);
    else throw httpError(400, "Unknown music action.");
    sendMusic(chat, channel.id);
    sendJSON(res, 200, { music: musicView(key) });
    return true;
  }
  if (body.kind === "signal") {
    const to = findByUsername(String(body.to || ""));
    if (!to || !room.has(to.id)) throw httpError(404, "They left the channel.");
    sendTo([to.id], { type: "voice:signal", chatId: chat.id, channelId: channel.id, from: me.username, data: body.data ?? null });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  throw httpError(400, "Unknown voice step.");
}

// Drop people whose page stopped sending heartbeats (closed tab, lost connection)
function sweep(chats) {
  const now = Date.now();
  for (const [, room] of rooms) for (const [id, s] of room) if (now - s.seen > STALE_MS) leave(id, chats);
}

module.exports = { handleVoice, participants, sweep, leaveVoice: leave };
