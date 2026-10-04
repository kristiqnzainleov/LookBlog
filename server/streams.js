// Live streams inside LookBlog.
// The streamer's browser sends the video straight to each viewer (WebRTC); the server only passes the
// set-up messages along, keeps the live chat and the viewer count. When the stream ends, the streamer's
// recording is uploaded and becomes a video ("Past streams" on their profile).

const crypto = require("crypto");
const { db, save, findUser, findByUsername } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { sendTo, broadcast } = require("./realtime");
const { notify } = require("./notifications");
const { authorView, clean, chars, blockedBetween, buildMedia, claim, postView } = require("./social");
const { ownedMedia, markUsed, deleteMedia } = require("./media");
const REACTIONS = ["❤️", "🔥", "😂", "😮", "👏", "💯", "🎉", "😢"];
const SOUNDS = ["airhorn", "tada", "drum", "boing", "ding", "sad"];
// Older streams get the newer fields
function ready(st) {
  st.likes = st.likes || []; st.dislikes = st.dislikes || []; st.mods = st.mods || []; st.reminders = st.reminders || [];
  st.banned = st.banned || []; st.timeouts = st.timeouts || {};
  st.settings = { slow: 0, followersOnly: false, alerts: true, reactions: true, chat: true, overlay: "off", guests: "mutual", maxGuests: 3, ...(st.settings || {}) };
  st.guests = st.guests || []; st.guestRequests = st.guestRequests || []; st.invited = st.invited || [];
  st.stats = st.stats || { viewers: [], watchSeconds: 0, messages: 0, reactions: 0, alerts: 0, shares: 0 };
  return st;
}
const OVERLAY = ["off", "on", "right", "left", "bottom"];
// Who may join a live as a guest (like Instagram live rooms): nobody, people who follow each other with the streamer, or anyone
function canJoinAsGuest(st, me) {
  if (!st.live || st.userId === me.id || st.banned.includes(me.id)) return false;
  if (st.invited.includes(me.id)) return true;
  const host = findUser(st.userId);
  if (st.settings.guests === "anyone") return true;
  if (st.settings.guests === "mutual") return Boolean(host && me.following.includes(host.id) && host.following.includes(me.id));
  return false;
}
const canMod = (st, u) => u && (st.userId === u.id || st.mods.includes(u.id));

const viewers = new Map(); // streamId -> Map(userId -> lastSeen)
const MAX_VIEWERS = 25;

function streamView(st, me) {
  ready(st);
  const live = viewers.get(st.id);
  return {
    id: st.id, title: st.title, description: st.description || "", live: st.live, startedAt: st.startedAt, endedAt: st.endedAt || null,
    scheduledFor: st.scheduledFor || null, upcoming: Boolean(st.scheduledFor && !st.startedAt),
    thumb: st.thumb || null, host: authorView(findUser(st.userId)), isHost: st.userId === me.id, isMod: canMod(st, me),
    viewers: live ? live.size : 0, peak: st.peak || 0, postId: st.postId || null,
    likes: st.likes.length, dislikes: st.dislikes.length, myVote: st.likes.includes(me.id) ? "like" : st.dislikes.includes(me.id) ? "dislike" : null,
    reminded: st.reminders.includes(me.id), reminders: st.reminders.length,
    mods: st.mods.map((id) => findUser(id)?.username).filter(Boolean), settings: st.settings, reactions: REACTIONS,
    guests: st.guests.map((id) => authorView(findUser(id))).filter((x) => x.username),
    guestRequests: st.userId === me.id ? st.guestRequests.map((id) => authorView(findUser(id))).filter((x) => x.username) : [],
    isGuest: st.guests.includes(me.id), requested: st.guestRequests.includes(me.id), canJoin: canJoinAsGuest(st, me),
  };
}
// Badges on a chat message: host, mod, verified, follows the host (used by "Top chat")
function chatView(st, x) {
  const u = findUser(x.userId), host = findUser(st.userId);
  return { ...x, author: authorView(u), badges: { host: x.userId === st.userId, mod: st.mods.includes(x.userId), verified: Boolean(u?.verified), follower: Boolean(u && host && u.following.includes(host.id)) } };
}
function startStream(st, me) {
  for (const old of db.streams) if (old !== st && old.userId === me.id && old.live) endStream(old);
  st.live = true;
  st.startedAt = new Date().toISOString();
  st.hostSeen = Date.now();
  viewers.set(st.id, new Map());
  save("streams");
  const notifyIds = new Set([...db.users.filter((u) => u.following.includes(me.id) && !blockedBetween(u, me)).map((u) => u.id), ...(st.reminders || [])]);
  for (const id of notifyIds) notify(id, "live", me, { text: st.title, streamId: st.id });
  broadcast({ type: "stream:state", streamId: st.id, userId: me.id, username: me.username, live: true });
}
function endStream(st) {
  st.live = false;
  st.endedAt = st.endedAt || new Date().toISOString();
  st.guests = []; st.guestRequests = []; st.invited = [];
  const v = viewers.get(st.id);
  if (v) sendTo([...v.keys()], { type: "stream:ended", streamId: st.id });
  viewers.delete(st.id);
  save("streams");
  broadcast({ type: "stream:state", streamId: st.id, userId: st.userId, username: findUser(st.userId)?.username, live: false });
}

// A stream whose host disappeared (closed the tab) ends after a minute
setInterval(() => {
  const now = Date.now();
  for (const st of db.streams) if (st.live && now - (st.hostSeen || 0) > 60 * 1000) endStream(st);
  // Guests who closed the page drop off the screen
  for (const st of db.streams) if (st.live && st.guests?.length) {
    const v = viewers.get(st.id);
    for (const id of [...st.guests]) if (!v?.has(id)) {
      st.guests = st.guests.filter((x) => x !== id);
      const u = findUser(id);
      sendTo([st.userId, ...(v ? v.keys() : [])], { type: "stream:guests", streamId: st.id, guests: st.guests.map((g) => authorView(findUser(g))) });
      if (u) sendTo([st.userId], { type: "stream:guest-left", streamId: st.id, username: u.username });
    }
  }
  for (const [id, m] of viewers) for (const [u, t] of m) if (now - t > 45 * 1000) { m.delete(u); const st = db.streams.find((x) => x.id === id); if (st) sendTo([st.userId], { type: "stream:viewer-left", streamId: id, username: findUser(u)?.username }); }
}, 15 * 1000).unref();

async function handleStreams(req, res, url, me) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  const [a, b, c] = parts;
  const m = req.method;

  // Someone's streams (live now + past ones): GET /api/users/:username/streams
  if (m === "GET" && a === "users" && c === "streams" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user || blockedBetween(user, me)) throw httpError(404, "This account doesn’t exist.");
    const mine = db.streams.filter((s) => s.userId === user.id);
    const live = mine.find((s) => s.live) || null;
    const past = mine.filter((s) => !s.live && s.postId).map((s) => db.posts.find((p) => p.id === s.postId)).filter((p) => p && (p.visibility === "public" || p.userId === me.id)).reverse();
    const upcoming = mine.filter((s) => s.scheduledFor && !s.startedAt && new Date(s.scheduledFor).getTime() > Date.now() - 6 * 3600000).sort((x, y) => x.scheduledFor.localeCompare(y.scheduledFor));
    sendJSON(res, 200, { live: live ? streamView(live, me) : null, upcoming: upcoming.map((s) => streamView(s, me)), past: past.map((p) => postView(p, me)) });
    return true;
  }
  // My streams' numbers: GET /api/streams/stats
  if (m === "GET" && a === "streams" && b === "stats" && parts.length === 2) {
    const list = db.streams.filter((s) => s.userId === me.id && s.startedAt).map((s) => {
      ready(s);
      const mins = s.endedAt ? (new Date(s.endedAt) - new Date(s.startedAt)) / 60000 : (Date.now() - new Date(s.startedAt)) / 60000;
      return { id: s.id, title: s.title, thumb: s.thumb, live: s.live, startedAt: s.startedAt, minutes: Math.round(mins), peak: s.peak || 0, uniqueViewers: s.stats.viewers.length,
        watchMinutes: Math.round(s.stats.watchSeconds / 6) / 10, messages: s.stats.messages, reactions: s.stats.reactions, alerts: s.stats.alerts, shares: s.stats.shares,
        likes: s.likes.length, dislikes: s.dislikes.length, postId: s.postId || null, recordingViews: s.postId ? (db.posts.find((p) => p.id === s.postId)?.viewedBy.length || 0) : 0 };
    }).reverse();
    sendJSON(res, 200, { streams: list });
    return true;
  }
  // Who's live right now: GET /api/streams
  if (m === "GET" && a === "streams" && parts.length === 1) {
    const list = db.streams.filter((s) => s.live && !blockedBetween(findUser(s.userId), me))
      .sort((x, y) => me.following.includes(y.userId) - me.following.includes(x.userId)).map((s) => streamView(s, me));
    sendJSON(res, 200, { streams: list });
    return true;
  }
  if (a !== "streams") return false;

  // Go live now, or schedule one: POST /api/streams { title, thumb, scheduledFor }
  if (m === "POST" && parts.length === 1) {
    rateLimit("golive:" + me.id, 20, 60 * 60 * 1000, "You’ve started a lot of streams. Try again later.");
    const body = await readJSON(req);
    const title = clean(body.title).replace(/\s+/g, " ") || `${me.name} is live`;
    if (chars(title) > 100) throw httpError(400, "Keep the title under 100 characters.");
    const description = clean(body.description).slice(0, 2000);
    let thumb = null;
    if (body.thumb) { const ok = ownedMedia(body.thumb, me.id, "image"); if (ok) { thumb = ok.url; markUsed(ok.url, "stream:" + me.id); } }
    const when = body.scheduledFor ? new Date(body.scheduledFor) : null;
    if (when && (isNaN(when) || when.getTime() < Date.now() + 60 * 1000 || when.getTime() > Date.now() + 365 * 86400000)) throw httpError(400, "Pick a time in the future (up to a year).");
    const st = ready({ id: crypto.randomUUID().slice(0, 12), userId: me.id, title, description, thumb, live: false, chat: [], peak: 0, createdAt: new Date().toISOString() });
    if (body.overlay === "on") st.settings.overlay = "on";
    if (when) {
      st.scheduledFor = when.toISOString();
      db.streams.push(st);
      save("streams");
      for (const u of db.users) if (u.following.includes(me.id) && !blockedBetween(u, me)) notify(u.id, "live-upcoming", me, { text: `${title} · ${when.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`, streamId: st.id });
      sendJSON(res, 201, { stream: streamView(st, me) });
      return true;
    }
    db.streams.push(st);
    startStream(st, me);
    sendJSON(res, 201, { stream: streamView(st, me) });
    return true;
  }

  const st = b && db.streams.find((s) => s.id === b);
  if (!st || blockedBetween(findUser(st.userId), me)) throw httpError(404, "This stream doesn’t exist.");
  const isHost = st.userId === me.id;

  ready(st);
  if (m === "GET" && parts.length === 2) {
    sendJSON(res, 200, { stream: streamView(st, me), chat: st.chat.slice(-150).map((x) => chatView(st, x)), pinned: st.pinned ? chatView(st, st.pinned) : null });
    return true;
  }
  // A scheduled stream: the host starts it, others ask to be reminded
  if (m === "POST" && c === "start" && parts.length === 3) {
    if (!isHost) throw httpError(403, "Only the streamer can start it.");
    if (st.live) { sendJSON(res, 200, { stream: streamView(st, me) }); return true; }
    if (st.startedAt) throw httpError(400, "This stream already happened.");
    const sb = await readJSON(req).catch(() => ({}));
    if (sb.description !== undefined) st.description = clean(sb.description).slice(0, 2000);
    if (sb.overlay === "on") st.settings.overlay = "on";
    startStream(st, me);
    sendJSON(res, 200, { stream: streamView(st, me) });
    return true;
  }
  if (m === "POST" && c === "remind" && parts.length === 3) {
    st.reminders = st.reminders.includes(me.id) ? st.reminders.filter((x) => x !== me.id) : [...st.reminders, me.id];
    save("streams");
    sendJSON(res, 200, { reminded: st.reminders.includes(me.id), reminders: st.reminders.length });
    return true;
  }
  // Cancel an upcoming stream, or delete a past one (and its recording)
  if (m === "DELETE" && parts.length === 2) {
    if (!isHost) throw httpError(403, "Only the streamer can delete it.");
    if (st.live) throw httpError(400, "End the stream first.");
    db.streams = db.streams.filter((x) => x !== st);
    const rec = st.postId && db.posts.findIndex((p) => p.id === st.postId);
    if (rec > -1) {
      const p = db.posts.splice(rec, 1)[0];
      for (const md of p.media) { deleteMedia(md.url); if (md.poster) deleteMedia(md.poster); for (const r of md.renditions || []) deleteMedia(r.url); }
      db.comments = db.comments.filter((x) => x.postId !== p.id);
      save("posts"); save("comments");
      broadcast({ type: "post:deleted", id: p.id });
    }
    save("streams");
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Report a live while it's happening (or one chat message): POST /api/streams/:id/report { reason, details, messageId }
  if (m === "POST" && c === "report" && parts.length === 3) {
    rateLimit("report:" + me.id, 20, 60 * 60 * 1000, "You’ve sent a lot of reports. Try again later.");
    if (isHost) throw httpError(400, "You can’t report your own live.");
    const body = await readJSON(req);
    const REASONS = ["spam", "harassment", "hate", "violence", "nudity", "misinformation", "copyright", "self-harm", "other"];
    if (!REASONS.includes(body.reason)) throw httpError(400, "Choose a reason.");
    const msg = body.messageId ? st.chat.find((x) => x.id === body.messageId) : null;
    if (body.messageId && !msg) throw httpError(404, "That message is gone.");
    const key = (r) => r.streamId === st.id && r.reporterId === me.id && (r.messageId || null) === (msg?.id || null);
    if (!db.reports.some(key)) {
      db.reports.push({ id: crypto.randomUUID(), streamId: st.id, live: st.live, messageId: msg?.id || null, messageText: msg?.text || null, authorId: msg ? msg.userId : st.userId,
        reporterId: me.id, reason: body.reason, details: clean(body.details).slice(0, 500), at: st.startedAt ? Math.round((Date.now() - new Date(st.startedAt)) / 1000) : null, createdAt: new Date().toISOString(), status: "open" });
      save("reports");
      require("./admin").pingAdmins();
      console.log(`[report] ${body.reason} on ${msg ? "a chat message in" : "live"} ${st.id} by @${me.username}`);
    }
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Like / dislike: POST /api/streams/:id/vote { vote: like|dislike|none }
  if (m === "POST" && c === "vote" && parts.length === 3) {
    const vote = (await readJSON(req)).vote;
    st.likes = st.likes.filter((x) => x !== me.id); st.dislikes = st.dislikes.filter((x) => x !== me.id);
    if (vote === "like") st.likes.push(me.id); else if (vote === "dislike") st.dislikes.push(me.id);
    save("streams");
    const v = viewers.get(st.id);
    sendTo([st.userId, ...(v ? v.keys() : [])], { type: "stream:votes", streamId: st.id, likes: st.likes.length, dislikes: st.dislikes.length });
    sendJSON(res, 200, { likes: st.likes.length, dislikes: st.dislikes.length, myVote: vote === "like" || vote === "dislike" ? vote : null });
    return true;
  }
  // The stream's thumbnail (set by the host, or a frame grabbed when it starts): POST /api/streams/:id/thumb { thumb }
  if (m === "POST" && c === "thumb" && parts.length === 3) {
    if (!isHost) throw httpError(403, "Only the streamer can change the thumbnail.");
    const ok = ownedMedia((await readJSON(req)).thumb, me.id, "image");
    if (!ok) throw httpError(400, "Upload the picture again.");
    markUsed(ok.url, "stream:" + st.id);
    st.thumb = ok.url;
    save("streams");
    sendJSON(res, 200, { thumb: st.thumb });
    return true;
  }
  if (m === "POST" && c === "shared" && parts.length === 3) { st.stats.shares++; save("streams"); sendJSON(res, 200, { ok: true }); return true; }
  // Live reactions that float over the video for everyone: POST /api/streams/:id/react { emoji }
  if (m === "POST" && c === "react" && parts.length === 3) {
    rateLimit("streamreact:" + me.id, 40, 60 * 1000, "Easy!");
    const emoji = (await readJSON(req)).emoji;
    if (!REACTIONS.includes(emoji)) throw httpError(400, "Pick one of the reactions.");
    if (!st.settings.reactions && !canMod(st, me)) throw httpError(403, "The streamer turned reactions off.");
    st.stats.reactions++;
    const v = viewers.get(st.id);
    sendTo([st.userId, ...(v ? v.keys() : [])], { type: "stream:react", streamId: st.id, emoji, by: me.name });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Viewers send a picture, a short video or a sound to show on the stream: POST /api/streams/:id/alert { kind, url, builtin, text }
  if (m === "POST" && c === "alert" && parts.length === 3) {
    if (!st.live) throw httpError(409, "This stream isn’t live.");
    if (!st.settings.alerts && !canMod(st, me)) throw httpError(403, "The streamer turned off pictures, videos and sounds.");
    if (st.banned.includes(me.id)) throw httpError(403, "You can’t send things to this stream.");
    rateLimit("streamalert:" + me.id, 3, 60 * 1000, "You can send up to 3 a minute.");
    const body = await readJSON(req);
    const text = clean(body.text).slice(0, 120);
    let alert = { id: crypto.randomUUID().slice(0, 8), kind: body.kind, by: authorView(me), text };
    if (body.kind === "sound" && body.mySound) {
      const snd = (me.sounds || []).find((x) => x.id === body.mySound);
      if (!snd) throw httpError(404, "That sound isn’t in your collection.");
      Object.assign(alert, { url: snd.url, name: snd.name, emoji: snd.emoji });
    } else if (body.kind === "sound") {
      throw httpError(400, "Send one of your own sounds — built-in sounds are for group soundboards.");
    } else if (body.kind === "image" || body.kind === "video") {
      const file = ownedMedia(body.url, me.id, body.kind);
      if (!file) throw httpError(400, "That file couldn’t be found. Upload it again.");
      const size = db.uploads[file.url.replace("/media/", "")]?.size || 0;
      if (size > 25 * 1024 * 1024) throw httpError(400, "Keep it under 25 MB.");
      markUsed(file.url, "streamalert:" + st.id);
      alert.url = file.url;
    } else throw httpError(400, "Send a picture, a video or a sound.");
    st.stats.alerts++;
    save("streams");
    const v = viewers.get(st.id);
    sendTo([st.userId, ...(v ? v.keys() : [])], { type: "stream:alert", streamId: st.id, alert });
    sendJSON(res, 201, { ok: true });
    return true;
  }
  // Moderators (host only): POST /api/streams/:id/mods { username, on }
  if (m === "POST" && c === "mods" && parts.length === 3) {
    if (!isHost) throw httpError(403, "Only the streamer can choose moderators.");
    const body = await readJSON(req);
    const u = findByUsername(String(body.username || ""));
    if (!u || u.id === me.id) throw httpError(400, "Pick someone else.");
    st.mods = st.mods.filter((x) => x !== u.id);
    if (body.on) st.mods.push(u.id);
    save("streams");
    const v = viewers.get(st.id);
    sendTo([st.userId, ...(v ? v.keys() : [])], { type: "stream:mods", streamId: st.id, mods: st.mods.map((id) => findUser(id)?.username).filter(Boolean) });
    if (body.on) notify(u.id, "live-mod", me, { text: st.title, streamId: st.id });
    sendJSON(res, 200, { mods: st.mods.map((id) => findUser(id)?.username).filter(Boolean) });
    return true;
  }
  // Chat settings (host and mods): POST /api/streams/:id/settings { slow, followersOnly, alerts }
  if (m === "POST" && c === "settings" && parts.length === 3) {
    if (!canMod(st, me)) throw httpError(403, "Only the streamer and moderators can change this.");
    const body = await readJSON(req);
    if (body.slow !== undefined) st.settings.slow = [0, 5, 10, 30, 60].includes(Number(body.slow)) ? Number(body.slow) : 0;
    if (body.followersOnly !== undefined) st.settings.followersOnly = Boolean(body.followersOnly);
    if (body.alerts !== undefined) st.settings.alerts = Boolean(body.alerts);
    if (body.reactions !== undefined) st.settings.reactions = Boolean(body.reactions);
    if (body.chat !== undefined) st.settings.chat = Boolean(body.chat);
    if (body.overlay !== undefined) st.settings.overlay = OVERLAY.includes(body.overlay) ? body.overlay : "off";
    if (body.guests !== undefined && isHost) st.settings.guests = ["off", "mutual", "anyone"].includes(body.guests) ? body.guests : "mutual";
    if (body.maxGuests !== undefined && isHost) st.settings.maxGuests = Math.max(1, Math.min(3, Number(body.maxGuests) || 1));
    save("streams");
    const v = viewers.get(st.id);
    sendTo([st.userId, ...(v ? v.keys() : [])], { type: "stream:settings", streamId: st.id, settings: st.settings });
    sendJSON(res, 200, { settings: st.settings });
    return true;
  }
  // The streamer reloaded the page and picked their camera/screen again: reconnect everyone
  if (m === "POST" && c === "resume" && parts.length === 3) {
    if (!isHost) throw httpError(403, "Only the streamer can do that.");
    if (!st.live) throw httpError(409, "This stream has ended.");
    st.hostSeen = Date.now();
    const v = viewers.get(st.id);
    for (const id of v ? v.keys() : []) { const u = findUser(id); if (u) sendTo([st.userId], { type: "stream:viewer", streamId: st.id, username: u.username, name: u.name }); }
    sendTo(st.guests, { type: "stream:guest-reconnect", streamId: st.id });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Guests (live together, up to 4 people on screen): POST /api/streams/:id/guest { action, username }
  if (m === "POST" && c === "guest" && parts.length === 3) {
    const body = await readJSON(req);
    const a = body.action;
    const v = viewers.get(st.id);
    const everyone = () => [st.userId, ...(v ? v.keys() : [])];
    const tellGuests = () => sendTo(everyone(), { type: "stream:guests", streamId: st.id, guests: st.guests.map((id) => authorView(findUser(id))) });
    const tellRequests = () => sendTo([st.userId], { type: "stream:guest-requests", streamId: st.id, requests: st.guestRequests.map((id) => authorView(findUser(id))) });
    if (!st.live) throw httpError(409, "This stream isn’t live.");
    if (a === "request") {
      if (!canJoinAsGuest(st, me)) throw httpError(403, st.settings.guests === "off" ? "The streamer isn’t taking guests." : "Only people who follow each other with the streamer can join.");
      if (st.guests.includes(me.id)) throw httpError(400, "You’re already on.");
      if (st.guests.length >= st.settings.maxGuests) throw httpError(409, "The live is full right now.");
      rateLimit("guestreq:" + me.id, 6, 10 * 60 * 1000, "Wait a bit before asking again.");
      if (st.invited.includes(me.id)) { st.invited = st.invited.filter((x) => x !== me.id); st.guests.push(me.id); st.guestHistory = [...new Set([...(st.guestHistory || []), me.id])]; save("streams"); sendTo([me.id], { type: "stream:guest-accepted", streamId: st.id }); tellGuests(); sendJSON(res, 200, { accepted: true }); return true; }
      if (!st.guestRequests.includes(me.id)) st.guestRequests.push(me.id);
      sendTo([st.userId], { type: "stream:guest-request", streamId: st.id, user: authorView(me) });
      tellRequests();
      sendJSON(res, 200, { requested: true });
      return true;
    }
    if (a === "cancel") { st.guestRequests = st.guestRequests.filter((x) => x !== me.id); tellRequests(); sendJSON(res, 200, { ok: true }); return true; }
    if (a === "leave") {
      st.guests = st.guests.filter((x) => x !== me.id);
      sendTo([st.userId], { type: "stream:guest-left", streamId: st.id, username: me.username });
      tellGuests();
      sendJSON(res, 200, { ok: true });
      return true;
    }
    if (!isHost) throw httpError(403, "Only the streamer can do that.");
    const u = findByUsername(String(body.username || "").replace(/^@/, ""));
    if (!u) throw httpError(404, "They’re not here anymore.");
    if (a === "accept") {
      if (st.guests.length >= st.settings.maxGuests) throw httpError(409, `You can have up to ${st.settings.maxGuests} guest${st.settings.maxGuests === 1 ? "" : "s"}. Change it in Settings.`);
      st.guestRequests = st.guestRequests.filter((x) => x !== u.id);
      if (!st.guests.includes(u.id)) st.guests.push(u.id);
      st.guestHistory = [...new Set([...(st.guestHistory || []), u.id])];
      save("streams");
      sendTo([u.id], { type: "stream:guest-accepted", streamId: st.id });
      tellGuests(); tellRequests();
    } else if (a === "decline") {
      st.guestRequests = st.guestRequests.filter((x) => x !== u.id);
      sendTo([u.id], { type: "stream:guest-declined", streamId: st.id });
      tellRequests();
    } else if (a === "invite") {
      if (u.id === me.id) throw httpError(400, "That’s you.");
      if (!st.invited.includes(u.id)) st.invited.push(u.id);
      sendTo([u.id], { type: "stream:guest-invite", streamId: st.id, by: authorView(me) });
      notify(u.id, "live", me, { text: "invited you to join their live", streamId: st.id });
    } else if (a === "remove") {
      st.guests = st.guests.filter((x) => x !== u.id);
      sendTo([u.id], { type: "stream:guest-removed", streamId: st.id });
      tellGuests();
    } else throw httpError(400, "Unknown action.");
    sendJSON(res, 200, { guests: st.guests.map((id) => authorView(findUser(id))), requests: st.guestRequests.map((id) => authorView(findUser(id))) });
    return true;
  }
  // Moderation: delete a message, time someone out, ban, pin a message
  if (m === "POST" && c === "moderate" && parts.length === 3) {
    if (!canMod(st, me)) throw httpError(403, "Only the streamer and moderators can do this.");
    const body = await readJSON(req);
    const v = viewers.get(st.id);
    const all = [st.userId, ...(v ? v.keys() : [])];
    if (body.action === "delete") {
      st.chat = st.chat.filter((x) => x.id !== body.messageId);
      if (st.pinned?.id === body.messageId) { st.pinned = null; sendTo(all, { type: "stream:pinned", streamId: st.id, message: null }); }
      sendTo(all, { type: "stream:chat-deleted", streamId: st.id, messageId: body.messageId });
    } else if (body.action === "pin") {
      const msg = st.chat.find((x) => x.id === body.messageId);
      st.pinned = msg || null;
      sendTo(all, { type: "stream:pinned", streamId: st.id, message: msg ? chatView(st, msg) : null });
    } else {
      const u = findByUsername(String(body.username || ""));
      if (!u || u.id === st.userId || (st.mods.includes(u.id) && !isHost)) throw httpError(400, "You can’t do that to them.");
      if (body.action === "timeout") st.timeouts[u.id] = Date.now() + Math.min(60, Math.max(1, Number(body.minutes) || 5)) * 60000;
      else if (body.action === "ban") { if (!st.banned.includes(u.id)) st.banned.push(u.id); st.chat = st.chat.filter((x) => x.userId !== u.id); sendTo(all, { type: "stream:purge", streamId: st.id, username: u.username }); }
      else if (body.action === "unban") { st.banned = st.banned.filter((x) => x !== u.id); delete st.timeouts[u.id]; }
      else throw httpError(400, "Unknown action.");
      sendTo([u.id], { type: "stream:you", streamId: st.id, action: body.action, minutes: Number(body.minutes) || 5 });
    }
    save("streams");
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Viewer joins / leaves / still here
  if (m === "POST" && (c === "join" || c === "leave" || c === "ping") && parts.length === 3) {
    if (isHost) { st.hostSeen = Date.now(); sendJSON(res, 200, { ok: true }); return true; }
    if (!st.live) throw httpError(409, "This stream has ended.");
    const v = viewers.get(st.id) || new Map();
    viewers.set(st.id, v);
    if (c === "leave") { v.delete(me.id); sendTo([st.userId], { type: "stream:viewer-left", streamId: st.id, username: me.username }); }
    else {
      const isNew = !v.has(me.id);
      if (isNew && v.size >= MAX_VIEWERS) throw httpError(409, `This stream is full (${MAX_VIEWERS} viewers).`);
      if (st.banned.includes(me.id)) throw httpError(403, "You can’t watch this stream.");
      if (!isNew && c === "ping") st.stats.watchSeconds += 15;
      v.set(me.id, Date.now());
      if (!st.stats.viewers.includes(me.id)) st.stats.viewers.push(me.id);
      st.peak = Math.max(st.peak || 0, v.size);
      // The host's browser connects to the new viewer
      if (isNew || c === "join") sendTo([st.userId], { type: "stream:viewer", streamId: st.id, username: me.username, name: me.name });
    }
    const count = v.size;
    sendTo([st.userId, ...v.keys()], { type: "stream:count", streamId: st.id, viewers: count });
    sendJSON(res, 200, { viewers: count });
    return true;
  }
  // Set-up messages between host and a viewer: POST /api/streams/:id/signal { to, data }
  if (m === "POST" && c === "signal" && parts.length === 3) {
    const body = await readJSON(req, 200000);
    const to = findByUsername(String(body.to || ""));
    if (!to) throw httpError(404, "They left.");
    if (!isHost && to.id !== st.userId) throw httpError(403, "Not allowed.");
    sendTo([to.id], { type: "stream:signal", streamId: st.id, from: me.username, data: body.data ?? null });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Live chat: POST /api/streams/:id/chat { text }
  if (m === "POST" && c === "chat" && parts.length === 3) {
    rateLimit("streamchat:" + me.id, 30, 60 * 1000, "Slow down a little.");
    const body = await readJSON(req);
    const text = clean(body.text).replace(/\s+/g, " ");
    let sticker = null, sound = null;
    if (body.sticker) {
      const s = (me.stickers || []).find((x) => x.id === body.sticker);
      if (!s) throw httpError(404, "That sticker isn’t in your collection.");
      sticker = s.url;
    }
    let mySound = null;
    if (body.mySound) {
      mySound = (me.sounds || []).find((x) => x.id === body.mySound);
      if (!mySound) throw httpError(404, "That sound isn’t in your collection.");
      if (!st.settings.alerts && !canMod(st, me)) throw httpError(403, "The streamer turned sounds off.");
      rateLimit("streamsound:" + me.id, 4, 60 * 1000, "You can play up to 4 sounds a minute.");
    }
    if (body.sound) {
      throw httpError(400, "Send one of your own sounds — built-in sounds are for group soundboards.");
      if (!st.settings.alerts && !canMod(st, me)) throw httpError(403, "The streamer turned sounds off.");
      rateLimit("streamsound:" + me.id, 4, 60 * 1000, "You can play up to 4 sounds a minute.");
      sound = body.sound;
    }
    if (!text && !sticker && !sound && !mySound) throw httpError(400, "Write something.");
    if (chars(text) > 200) throw httpError(400, "Keep it under 200 characters.");
    if (!st.settings.chat && !canMod(st, me)) throw httpError(403, "The streamer turned the chat off.");
    if (!canMod(st, me)) {
      if (st.banned.includes(me.id)) throw httpError(403, "You were removed from this chat.");
      if ((st.timeouts[me.id] || 0) > Date.now()) throw httpError(403, `You’re in a timeout for ${Math.ceil((st.timeouts[me.id] - Date.now()) / 60000)} more minute(s).`);
      const host = findUser(st.userId);
      if (st.settings.followersOnly && !(host && me.following.includes(host.id))) throw httpError(403, "Only followers can chat right now.");
      const last = [...st.chat].reverse().find((x) => x.userId === me.id);
      if (st.settings.slow && last && Date.now() - new Date(last.at).getTime() < st.settings.slow * 1000) throw httpError(429, `Slow mode: wait ${st.settings.slow}s between messages.`);
    }
    const msg = { id: crypto.randomUUID().slice(0, 8), userId: me.id, text, at: new Date().toISOString(), ...(sticker ? { sticker } : {}), ...(sound ? { sound } : {}), ...(mySound ? { soundUrl: mySound.url, soundName: mySound.name, soundEmoji: mySound.emoji } : {}) };
    st.chat.push(msg);
    st.stats.messages++;
    if (st.chat.length > 500) st.chat.shift();
    save("streams");
    const v = viewers.get(st.id);
    sendTo([st.userId, ...(v ? v.keys() : [])], { type: "stream:chat", streamId: st.id, message: chatView(st, msg) });
    sendJSON(res, 201, { ok: true });
    return true;
  }
  // End: POST /api/streams/:id/end { media, title, visibility }  (media = the uploaded recording, optional)
  if (m === "POST" && c === "end" && parts.length === 3) {
    if (!isHost) throw httpError(403, "Only the streamer can end it.");
    const body = await readJSON(req);
    if (st.live) endStream(st);
    let post = null;
    if (body.media && !st.postId) {
      const media = [buildMedia(body.media, me)];
      if (st.thumb && !media[0].poster) media[0].poster = st.thumb;
      if (media[0].kind !== "video") throw httpError(400, "The recording has to be a video.");
      post = {
        id: crypto.randomUUID(), userId: me.id, type: "video", title: (clean(body.title) || st.title).slice(0, 100), text: `${st.description ? st.description + "\n\n" : ""}Streamed live on ${new Date(st.startedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
        media, visibility: ["public", "unlisted", "private"].includes(body.visibility) ? body.visibility : "public", stream: { id: st.id, startedAt: st.startedAt, endedAt: st.endedAt, peak: st.peak || 0 },
        createdAt: new Date().toISOString(), likes: [], dislikes: [], viewedBy: [], reposts: [], cools: [], commentCount: 0, mentions: [], categoryId: null, poll: null,
      };
      db.posts.unshift(post);
      claim(post.media, "post:" + post.id);
      st.postId = post.id;
      save("posts");
      save("streams");
    }
    sendJSON(res, 200, { stream: streamView(st, me), post: post ? postView(post, me) : null });
    return true;
  }
  return false;
}

// The LookBlog team removes one live chat message
function removeChatMessage(st, messageId) {
  st.chat = (st.chat || []).filter((x) => x.id !== messageId);
  if (st.pinned?.id === messageId) st.pinned = null;
  const v = viewers.get(st.id);
  sendTo([st.userId, ...(v ? v.keys() : [])], { type: "stream:chat-deleted", streamId: st.id, messageId });
  save("streams");
}

module.exports = { handleStreams, endStream, removeChatMessage };
