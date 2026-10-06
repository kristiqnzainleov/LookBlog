// Voice channels in groups. Everyone in a channel connects to everyone else (WebRTC);
// the server keeps the list of who is in which channel and passes the set-up messages along.
// Who is in a channel (and its music) lives in db.voice, so every server sees the same rooms
// (online several servers answer requests, and they sleep in between).

const { db, save, findUser, findByUsername } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { sendTo } = require("./realtime");
const VOICE_REACTIONS = ["❤️", "😂", "🔥", "👏", "😮", "😢", "💯", "🎉", "👀", "🤯"];
const { can, rank } = require("./groups");
const BUILTIN_SOUNDS = ["airhorn", "tada", "drum", "boing", "ding", "sad"];

// db.voice["chatId:channelId"] = { members: { userId: { muted, deaf, video, screen, seen } }, music }
const STALE_MS = 45 * 1000; // no heartbeat for this long = gone
const roomAt = (key) => db.voice[key]?.members || null;
const roomIds = (key) => Object.keys(roomAt(key) || {});
const whereIs = (userId) => Object.keys(db.voice).find((k) => db.voice[k].members?.[userId]) || null;
const music = {
  get: (key) => db.voice[key]?.music || undefined,
  set: (key, m) => { if (db.voice[key]) { db.voice[key].music = m; save("voice"); } },
  delete: (key) => { if (db.voice[key]?.music) { db.voice[key].music = null; save("voice"); } },
};

/* ---------- Music in a voice channel ----------
   Everyone's browser plays the same thing at the same spot (a LookBlog song or a YouTube video);
   the server keeps what's playing, from when, and the queue. Each person sets their own volume. */
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
  const ids = roomIds(key);
  if (ids.length) sendTo(ids, { type: "voice:music", chatId: chat.id, channelId, music: musicView(key) });
}
function playNext(key) {
  const m = music.get(key);
  if (!m) return;
  m.now = m.queue.shift() || null;
  m.startedAt = Date.now(); m.pausedAt = null;
  if (!m.now) music.delete(key);
  else save("voice");
}

// Watch together: what's playing in a channel
const watchView = (key) => { const w = db.voice[key]?.watch; return w ? { ...w } : null; };
// A YouTube / YouTube Shorts / TikTok link → { provider, id, kind }
async function parseVideo(url) {
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const yt = /^[\w-]{11}$/;
  if (host === "youtu.be") { const id = u.pathname.slice(1, 12); return yt.test(id) ? { provider: "youtube", id, kind: "video" } : null; }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const short = u.pathname.match(/^\/shorts\/([\w-]{11})/);
    if (short) return { provider: "youtube", id: short[1], kind: "short" };
    const embed = u.pathname.match(/^\/(?:embed|live|v)\/([\w-]{11})/);
    if (embed) return { provider: "youtube", id: embed[1], kind: "video" };
    const id = u.searchParams.get("v");
    return id && yt.test(id) ? { provider: "youtube", id, kind: "video" } : null;
  }
  if (host.endsWith("tiktok.com")) {
    let m = u.pathname.match(/\/video\/(\d{8,25})/) || u.pathname.match(/\/player\/v1\/(\d{8,25})/);
    if (!m && (host === "vm.tiktok.com" || host === "vt.tiktok.com" || u.pathname.startsWith("/t/"))) {
      // A short share link: follow it to the real one
      try {
        const r = await fetch(u.href, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 LookBlog" }, signal: AbortSignal.timeout(6000) });
        const to = r.headers.get("location") || "";
        m = to.match(/\/video\/(\d{8,25})/);
      } catch {}
    }
    return m ? { provider: "tiktok", id: m[1], kind: "short" } : null;
  }
  return null;
}

function participants(chatId, channelId) {
  const room = roomAt(chatId + ":" + channelId);
  if (!room) return [];
  return Object.entries(room).map(([id, s]) => {
    const u = findUser(id);
    return u && { name: u.name, username: u.username, avatar: u.avatar, verified: Boolean(u.verified), verifiedType: u.verifiedType || null, muted: s.muted, deaf: s.deaf, video: s.video, screen: s.screen };
  }).filter(Boolean);
}

function announce(chat, channelId) {
  sendTo(chat.members, { type: "voice:state", chatId: chat.id, channelId, participants: participants(chat.id, channelId) });
}

function leave(userId, chats) {
  const key = whereIs(userId);
  if (!key) return;
  delete db.voice[key].members[userId];
  const left = roomIds(key);
  if (!left.length) delete db.voice[key];
  save("voice");
  const [chatId, channelId] = key.split(":");
  const chat = chats.find((c) => c.id === chatId);
  if (chat) {
    announce(chat, channelId);
    const u = findUser(userId);
    if (u && left.length) sendTo(left, { type: "voice:left", chatId, channelId, username: u.username });
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
    if (whereIs(me.id) !== key) leave(me.id, chats);
    if (!db.voice[key]) db.voice[key] = { members: {}, music: null };
    const room = db.voice[key].members;
    if (Object.keys(room).length >= 12 && !room[me.id]) throw httpError(400, "This voice channel is full (12 people).");
    const others = participants(chat.id, channel.id).filter((p) => p.username !== me.username);
    room[me.id] = { muted: Boolean(body.muted), deaf: false, video: false, screen: false, seen: Date.now() };
    save("voice");
    announce(chat, channel.id);
    // A secret topic for the fallback voice relay (when two people can't connect directly)
    const relayTopic = require("./store").enabled ? "vr-" + require("crypto").createHmac("sha256", process.env.SUPABASE_SERVICE_KEY || "lb").update("voice:" + key).digest("base64url").slice(0, 24) : null;
    sendJSON(res, 200, { participants: others, music: musicView(key), relayTopic, watch: watchView(key), now: Date.now() });
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
    const room = key && roomAt(key);
    if (!target || !room || !room[target.id]) throw httpError(404, "They’re not in this channel.");
    if (!can(chat, me, "kick") || rank(chat, target.id) >= rank(chat, me.id)) throw httpError(403, "You can’t disconnect them.");
    leave(target.id, chats);
    sendTo([target.id], { type: "voice:kicked", chatId: chat.id, by: me.name });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  const room = key && roomAt(key);
  if (!room || !room[me.id]) throw httpError(409, "You’re not in that voice channel.");
  const mine = room[me.id];
  // Heartbeat: written at most every 10 seconds
  if (Date.now() - (mine.seen || 0) > 10 * 1000) { mine.seen = Date.now(); save("voice"); }
  // The heartbeat also says who is in the channel, so a missed update fixes itself
  if (body.kind === "ping") { sendJSON(res, 200, { ok: true, participants: participants(chat.id, channel.id), watch: watchView(key), now: Date.now() }); return true; }
  if (body.kind === "state") {
    for (const k of ["muted", "deaf", "video", "screen"]) if (k in body) mine[k] = Boolean(body[k]);
    save("voice");
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
    sendTo(Object.keys(room), { type: "voice:sound", chatId: chat.id, channelId: channel.id, by: me.name, username: me.username, url: snd?.url || null, builtin, name: snd?.name || builtin, emoji: snd?.emoji || null });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Invite people from the group who aren't here: { kind: "invite", usernames: [...] }
  // They get a pop-up to join right away (and a notification, in case they're away).
  if (body.kind === "invite") {
    rateLimit("vinvite:" + me.id, 40, 10 * 60 * 1000, "You’ve sent a lot of invites. Wait a little.");
    const names = (Array.isArray(body.usernames) ? body.usernames : []).slice(0, 50).map(String);
    const invited = [];
    for (const n of names) {
      const u = findByUsername(n);
      if (!u || u.id === me.id || !chat.members.includes(u.id) || room[u.id]) continue;
      if ((u.blocked || []).includes(me.id) || (me.blocked || []).includes(u.id)) continue;
      sendTo([u.id], { type: "voice:invite", chatId: chat.id, channelId: channel.id, channel: channel.name, group: chat.name, color: chat.color || null,
        by: { name: me.name, username: me.username, avatar: me.avatar }, inside: Object.keys(room).length });
      require("./notifications").notify(u.id, "voice-invite", me, { chatId: chat.id, group: chat.name, text: `🔊 ${channel.name}` });
      invited.push(u.username);
    }
    sendJSON(res, 200, { invited });
    return true;
  }
  // Watch together: a YouTube video, YouTube Short or TikTok, in sync for everyone in the channel.
  // { kind: "watch", action: "start", url } · { action: "state", playing, pos } (anyone can play, pause or skip) · { action: "stop" }
  if (body.kind === "watch") {
    rateLimit("vwatch:" + me.id, 120, 60 * 1000, "Slow down a little.");
    const v = db.voice[key];
    if (body.action === "start") {
      const found = await parseVideo(String(body.url || ""));
      if (!found) throw httpError(400, "Paste a YouTube, YouTube Shorts or TikTok link.");
      v.watch = { ...found, by: me.username, byName: me.name, playing: true, pos: 0, at: Date.now() };
    } else if (body.action === "state") {
      if (!v.watch) throw httpError(404, "Nothing is playing.");
      const pos = Number(body.pos);
      v.watch.playing = Boolean(body.playing);
      v.watch.pos = Number.isFinite(pos) && pos >= 0 ? Math.min(pos, 24 * 3600) : 0;
      v.watch.at = Date.now();
      v.watch.lastBy = me.username;
    } else if (body.action === "stop") {
      if (!v.watch) { sendJSON(res, 200, { ok: true }); return true; }
      if (v.watch.by !== me.username && !can(chat, me, "manage_group")) throw httpError(403, "Only the person who started it can stop it for everyone. You can close it for yourself.");
      delete v.watch;
    } else throw httpError(400, "Unknown action.");
    save("voice");
    sendTo(Object.keys(room), { type: "voice:watch", chatId: chat.id, channelId: channel.id, watch: watchView(key), by: me.username, action: body.action, now: Date.now() });
    sendJSON(res, 200, { watch: watchView(key), now: Date.now() });
    return true;
  }
  // A reaction while you talk: { kind: "react", emoji, to } — to someone's camera or screen (to = their username), or to the channel.
  // Everyone in the group sees it fly up (on the video, in the voice panel and in the channel list).
  if (body.kind === "react") {
    rateLimit("vreact:" + me.id, 30, 10 * 1000, "Easy on the reactions!");
    const emoji = String(body.emoji || "");
    if (!VOICE_REACTIONS.includes(emoji)) throw httpError(400, "Pick one of the reactions.");
    const target = body.to ? findByUsername(String(body.to)) : null;
    const to = target && room[target.id] ? target : null;
    sendTo(chat.members, { type: "voice:react", chatId: chat.id, channelId: channel.id, by: me.name, username: me.username, emoji, to: to?.username || null });
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
    save("voice");
    sendMusic(chat, channel.id);
    sendJSON(res, 200, { music: musicView(key) });
    return true;
  }
  if (body.kind === "signal") {
    const to = findByUsername(String(body.to || ""));
    if (!to || !room[to.id]) throw httpError(404, "They left the channel.");
    sendTo([to.id], { type: "voice:signal", chatId: chat.id, channelId: channel.id, from: me.username, data: body.data ?? null });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  throw httpError(400, "Unknown voice step.");
}

// Drop people whose page stopped sending heartbeats (closed tab, lost connection)
function sweep(chats) {
  const now = Date.now();
  for (const key of Object.keys(db.voice)) for (const [id, s] of Object.entries(db.voice[key]?.members || {})) if (now - s.seen > STALE_MS) leave(id, chats);
}

module.exports = { handleVoice, participants, sweep, leaveVoice: leave };
