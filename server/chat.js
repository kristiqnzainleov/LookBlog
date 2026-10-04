// Direct messages (only between people who follow each other) and public groups.
// Messages can carry text, a photo or video, or a shared post. Live delivery goes only to members.

const crypto = require("crypto");
const { db, save, findUser, findByUsername, findPost, findChat, onLoad, flush } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { ownedMedia, markUsed, deleteMedia } = require("./media");
const { sendTo, presence, flushRealtime } = require("./realtime");
const { notify } = require("./notifications");
const { handleInvites, ensureGroup, can, rank, groupExtras, memberExtras, nicknameOf, firstText, handleGroupRoutes, COLOR_RE } = require("./groups");
const { handleVoice, participants: voiceRoom, sweep: sweepVoice, leaveVoice } = require("./voice");
const RULES = require("../public/js/games/rules.js");
const { CARD_GAMES, waitingSeats, botMove } = require("./cards");
const { every, keepAlive } = require("./ticker");
const BOT_NAMES = ["Rosie", "Max", "Luna", "Theo", "Ivy", "Niko", "Mila", "Leo"];
const isBot = (id) => typeof id === "string" && id.startsWith("bot:");
const botView = (id) => ({ name: "🤖 " + id.slice(4), username: "", avatar: null, verified: false, bot: true });
function seatNames(chat, g) { return g.players.map((id) => { if (isBot(id)) return "🤖 " + id.slice(4); const u = findUser(id); return u ? nicknameOf(chat, u.id) || u.name : "Someone"; }); }
// Wins and finished games count for badges (bots don't get badges)
function recordResult(g) {
  if (g.ended || g.counted) return;
  g.counted = true;
  let winners = [];
  if (g.card) {
    const over = CARD_GAMES[g.type].over(g.state);
    if (!over) return;
    winners = over.team ? g.players.filter((_, i) => i % 2 === over.winner) : [g.players[over.winner]];
  } else if (g.status?.winner) winners = [g.players[RULES.GAMES[g.type].sides.indexOf(g.status.winner)]];
  for (const id of g.players) {
    if (isBot(id)) continue;
    const u = findUser(id);
    if (!u) continue;
    u.gamesFinished = (u.gamesFinished || 0) + 1;
    if (g.card) u.cardGames = (u.cardGames || 0) + 1;
    if (winners.includes(id)) { u.gameWins = (u.gameWins || 0) + 1; if (g.card) u.cardWins = (u.cardWins || 0) + 1; }
  }
  save("users");
}
function pushGame(chat, msg) {
  for (const id of chat.members) {
    const u = findUser(id);
    if (u) sendTo([id], { type: "game:update", chatId: chat.id, messageId: msg.id, game: gameView(msg.game, u) });
  }
}
// After a restart: bots whose turn it was carry on
onLoad(() => setTimeout(() => { for (const m of db.messages) if (m.game?.card && m.game.phase === "play" && m.game.players.some(isBot)) { const c = findChat(m.chatId); if (c) runBots(c, m); } }, 3000).unref?.());
// Bots take their turns on their own, a moment apart so people can follow
const botTimers = new Map();
function runBots(chat, msg) {
  if (botTimers.has(msg.id)) return;
  let done;
  keepAlive(new Promise((resolve) => (done = resolve)).then(() => Promise.all([flush(), flushRealtime()])));
  botTimers.set(msg.id, setTimeout(() => {
    botTimers.delete(msg.id);
    try {
      const g = msg.game;
      if (!g?.card || g.phase !== "play" || !g.players.some(isBot)) return;
      const def = CARD_GAMES[g.type];
      const seat = waitingSeats(g.type, g.state).find((i) => isBot(g.players[i]));
      if (seat === undefined) return;
      try { def.act(g.state, seat, botMove(g.type, g.state, seat), seatNames(chat, g)); }
      catch (err) { console.error("[bot]", g.type, err.message); return; }
      if (def.over(g.state)) { g.phase = "over"; recordResult(g); }
      save("messages");
      pushGame(chat, msg);
      runBots(chat, msg);
    } finally { done(); }
  }, 900));
}
const gameDef = (t) => RULES.GAMES[t] || CARD_GAMES[t];
const { resolveExtras, resolveGif, postView, authorView, buildMedia, claim, findMentions, usernamesOf, clean, chars, canView } = require("./social");

const PAGE = 40;
const mutual = (a, b) => a.following.includes(b.id) && b.following.includes(a.id);
const isMember = (chat, user) => chat.members.includes(user.id);

function lastMessage(chat) {
  for (let i = db.messages.length - 1; i >= 0; i--) if (db.messages[i].chatId === chat.id) return db.messages[i];
  return null;
}
function unread(chat, me) {
  if (!isMember(chat, me)) return 0;
  const since = chat.reads?.[me.id] || "";
  return db.messages.filter((m) => m.chatId === chat.id && m.userId !== me.id && m.createdAt > since).length;
}
function preview(msg) {
  if (!msg) return "";
  if (msg.game) return `${gameDef(msg.game.type)?.emoji || "🎮"} Started a game of ${gameDef(msg.game.type)?.name || "something"}`;
  if (msg.text) return msg.text.slice(0, 120);
  if (msg.media?.sticker) return "Sent a sticker";
  if (msg.media?.gif) return "Sent a GIF";
  if (msg.media) return msg.media.kind === "audio" ? "🎤 Voice message" : msg.media.kind === "video" ? "Sent a video" : "Sent a photo";
  if (msg.postId) return "Shared a post";
  if (msg.commentId) return "Shared a reply";
  if (msg.songId) return "🎵 Sent a song";
  return "";
}

/* ---------- LookStreak: days in a row when you both wrote to each other ---------- */
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA"); // YYYY-MM-DD, server time
function streakOf(chat) {
  if (chat.kind !== "dm") return null;
  const [a, b] = chat.members;
  const days = { [a]: new Set(), [b]: new Set() };
  for (const m of db.messages) if (m.chatId === chat.id && days[m.userId]) days[m.userId].add(dayKey(m.createdAt));
  const both = (k) => days[a].has(k) && days[b].has(k);
  const d = new Date();
  // Today still counts as "in progress": the streak is alive if yesterday was done
  if (!both(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0, since = null;
  while (both(dayKey(d))) {
    n++;
    since = dayKey(d);
    d.setDate(d.getDate() - 1);
  }
  if (n < 2) return null; // a streak starts once you've both written two days in a row
  const today = dayKey(new Date());
  return {
    days: n,
    since,
    doneToday: both(today),
    waitingOn: both(today) ? null : (days[a].has(today) ? b : days[b].has(today) ? a : "both"),
  };
}

/* Group streak: days in a row when at least two different members wrote in the group */
function groupStreakOf(chat) {
  if (chat.kind !== "group") return null;
  const writers = new Map(); // day -> Set(userId)
  for (const m of db.messages) if (m.chatId === chat.id && !m.system) { const k = dayKey(m.createdAt); if (!writers.has(k)) writers.set(k, new Set()); writers.get(k).add(m.userId); }
  const ok = (k) => (writers.get(k)?.size || 0) >= 2;
  const d = new Date();
  if (!ok(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0, since = null;
  while (ok(dayKey(d))) { n++; since = dayKey(d); d.setDate(d.getDate() - 1); }
  if (n < 2) return null;
  return { days: n, since, doneToday: ok(dayKey(new Date())), group: true };
}
// Who read up to when (for "Seen" / "Seen by …")
function readersOf(chat, me) {
  return chat.members.filter((id) => id !== me.id && chat.reads?.[id]).map((id) => { const u = findUser(id); return u && { ...authorView(u), at: chat.reads[id] }; }).filter(Boolean);
}
function chatView(chat, me, { full = false } = {}) {
  const last = lastMessage(chat);
  const out = {
    id: chat.id,
    kind: chat.kind,
    lastAt: chat.lastAt,
    last: last ? { text: preview(last), by: findUser(last.userId)?.username || "", mine: last.userId === me.id } : null,
    unread: unread(chat, me),
    member: isMember(chat, me),
    pinnedCount: (chat.pins || []).length,
  };
  if (chat.kind === "dm") {
    const other = findUser(chat.members.find((id) => id !== me.id));
    out.other = other ? { ...authorView(other), ...presence(other.id), nickname: nicknameOf(chat, other.id) } : { name: "Deleted account", username: "", avatar: null };
    out.myNickname = nicknameOf(chat, me.id);
    out.canSend = Boolean(other && mutual(me, other));
    const st = streakOf(chat);
    out.streak = st && { days: st.days, since: st.since, doneToday: st.doneToday, yourTurn: st.waitingOn === me.id || st.waitingOn === "both" };
  } else {
    out.streak = groupStreakOf(chat);
  }
  if (full) out.readers = readersOf(chat, me);
  if (chat.kind !== "dm") {
    out.name = chat.name;
    out.description = chat.description;
    out.cover = chat.cover;
    out.banner = chat.banner || null;
    out.memberCount = chat.members.length;
    out.isOwner = chat.ownerId === me.id;
    out.visibility = chat.visibility;
    out.canSend = isMember(chat, me);
    out.color = ensureGroup(chat).color;
    if (full) {
      out.members = chat.members.map(findUser).filter(Boolean).map((u) => ({ ...authorView(u), ...presence(u.id), ...memberExtras(chat, u), isOwner: u.id === chat.ownerId, isMe: u.id === me.id }));
      out.onlineCount = chat.members.filter((id) => presence(id).online).length;
      Object.assign(out, groupExtras(chat, me, voiceRoom));
    }
  }
  return out;
}

// A short look at the message someone is answering
function replyPreview(msg) {
  if (!msg.replyTo) return null;
  const orig = db.messages.find((x) => x.id === msg.replyTo);
  if (!orig) return { id: msg.replyTo, deleted: true };
  const author = findUser(orig.userId);
  return {
    id: orig.id,
    author: author ? author.name : "Deleted account",
    username: author ? author.username : "",
    text: preview(orig),
    thumb: orig.media ? (orig.media.kind === "image" ? orig.media.url : orig.media.poster || null) : null,
  };
}

function gameView(g, me) {
  if (g.card) {
    const def = CARD_GAMES[g.type];
    const players = g.players.map((id) => (isBot(id) ? botView(id) : (findUser(id) ? authorView(findUser(id)) : null)));
    const myIndex = g.players.indexOf(me.id);
    return { type: g.type, card: true, name: def.name, emoji: def.emoji, min: def.min, max: def.max, players, phase: g.phase, isHost: g.host === me.id, myIndex,
      view: g.state ? def.view(g.state, myIndex) : null, over: g.ended ? { ended: true, by: g.ended } : g.state ? def.over(g.state) : null };
  }
  const def = RULES.GAMES[g.type];
  const players = g.players.map((id) => (id ? findUser(id) : null)).map((u) => (u ? authorView(u) : null));
  const myIndex = g.players.indexOf(me.id);
  return { type: g.type, name: def.name, emoji: def.emoji, sides: def.sides, players, state: g.state, status: g.status, moves: g.moves, myIndex, resigned: g.resigned || null, open: !g.players[1], captured: g.captured || null, ended: g.ended || null, isStarter: g.players[0] === me.id };
}

// A shared reply: who wrote it, what it says, and which post it's on
function sharedCommentView(id, me) {
  const cm = db.comments.find((x) => x.id === id);
  const p = cm && findPost(cm.postId);
  if (!cm || !p) return { deleted: true };
  if (!canView(p, me)) return { hidden: true };
  const a = findUser(cm.userId), owner = findUser(p.userId);
  return {
    id: cm.id, text: cm.text, media: cm.media ? { kind: cm.media.kind, url: cm.media.url, poster: cm.media.poster || null, gif: Boolean(cm.media.gif) } : null,
    author: authorView(a), createdAt: cm.createdAt,
    post: { id: p.id, type: p.type, title: p.title || "", text: (p.text || "").slice(0, 80), author: authorView(owner), thumb: p.media[0] ? (p.media[0].kind === "image" ? p.media[0].url : p.media[0].poster || null) : null },
  };
}

function messageView(msg, me) {
  let post = null;
  const chat = findChat(msg.chatId);
  if (msg.postId) {
    const p = findPost(msg.postId);
    post = p ? (canView(p, me) ? postView(p, me) : { hidden: true }) : { deleted: true };
  }
  return {
    id: msg.id,
    chatId: msg.chatId,
    text: msg.text,
    media: msg.media,
    post,
    comment: msg.commentId ? sharedCommentView(msg.commentId, me) : null,
    song: msg.songId ? (() => { const sg = db.songs.find((x) => x.id === msg.songId); return sg ? require("./music").songView(sg, me) : { deleted: true }; })() : null,
    pinned: Boolean(chat?.pins?.includes(msg.id)),
    mentions: usernamesOf(msg.mentions),
    pingsMe: msg.userId !== me.id && (msg.mentions.includes(me.id) || Boolean(msg.everyone)),
    reactions: reactionsView(msg, me),
    replyTo: replyPreview(msg),
    storyReply: msg.storyReply ? { ...require("./stories").storyPreview(msg.storyReply.storyId, me), reaction: msg.storyReply.reaction, toMe: msg.storyReply.owner === me.id } : null,
    noteReply: msg.noteReply ? { text: msg.noteReply.text, media: msg.noteReply.media, toMe: msg.noteReply.owner === me.id } : null,
    author: { ...authorView(findUser(msg.userId)), nickname: nicknameOf(chat, msg.userId) },
    mine: msg.userId === me.id,
    channelId: msg.channelId || null,
    system: msg.system || false,
    game: msg.game ? gameView(msg.game, me) : null,
    event: msg.event && chat?.events ? (chat.events.find((e) => e.id === msg.event) ? msg.event : null) : null,
    createdAt: msg.createdAt,
  };
}

/* ---------- Reactions: one emoji per person per message ---------- */
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\u20E3|\p{Emoji_Modifier}|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Component}))*\uFE0F?$/u;
function reactionsView(msg, me) {
  const groups = new Map();
  for (const [userId, emoji] of Object.entries(msg.reactions || {})) {
    if (!groups.has(emoji)) groups.set(emoji, []);
    groups.get(emoji).push(userId);
  }
  return [...groups].map(([emoji, ids]) => ({
    emoji,
    count: ids.length,
    mine: ids.includes(me.id),
    names: ids.map((id) => findUser(id)?.name).filter(Boolean).slice(0, 10),
  })).sort((a, b) => b.count - a.count);
}

function canRead(chat, me) {
  if (isMember(chat, me)) return true;
  return chat.kind === "group" && chat.visibility !== "private"; // public and unlisted groups can be read with the link
}

function validateGroup(body, me, current = null) {
  const name = clean(body.name).replace(/\s+/g, " ");
  const description = clean(body.description);
  if (!name) throw httpError(400, "Give your group a name.");
  if (chars(name) > 60) throw httpError(400, "Keep the name under 60 characters.");
  if (chars(description) > 500) throw httpError(400, "Keep the description under 500 characters.");
  let cover = current ? current.cover : null;
  if (body.cover === null) cover = null;
  else if (body.cover && body.cover !== cover) {
    const ok = ownedMedia(body.cover, me.id, "image");
    if (!ok) throw httpError(400, "That picture couldn’t be found. Try uploading it again.");
    cover = ok.url;
  }
  let banner = current ? current.banner || null : null;
  if (body.banner === null) banner = null;
  else if (body.banner && body.banner !== banner) {
    const ok = ownedMedia(body.banner, me.id, "image");
    if (!ok) throw httpError(400, "That picture couldn’t be found. Try uploading it again.");
    banner = ok.url;
  }
  const visibility = ["public", "unlisted", "private"].includes(body.visibility) ? body.visibility : current ? current.visibility : "public";
  return { name, description, cover, banner, visibility };
}

function notifyMembers(chat, event) {
  sendTo(chat.members, event);
}

/* ---------- Translating messages (Google Translate's public endpoint; results are cached) ---------- */
const translations = new Map();
async function translate(text, to) {
  const key = to + "|" + text;
  if (translations.has(key)) return translations.get(key);
  let out = null;
  // 1) Google's free endpoint
  try {
    const r = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=" + encodeURIComponent(to) + "&q=" + encodeURIComponent(text), { signal: AbortSignal.timeout(6000) });
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
      const j = await r.json();
      out = { text: (j[0] || []).map((x) => x[0]).join(""), from: j[2] || null };
    }
  } catch {}
  // 2) MyMemory (free, no key)
  if (!out) {
    const r = await fetch("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text.slice(0, 500)) + "&langpair=autodetect|" + encodeURIComponent(to), { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j.responseStatus !== 200 || !j.responseData?.translatedText) throw new Error("translate " + (j.responseDetails || j.responseStatus));
    const t = j.responseData.translatedText;
    out = { text: t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'"), from: j.responseData.detectedLanguage || null };
  }
  if (translations.size > 2000) translations.clear();
  translations.set(key, out);
  return out;
}

// Send a message to every member, each with their own view of it
function deliver(chat, msg) {
  for (const id of chat.members) {
    const u = findUser(id);
    if (u) sendTo([id], { type: "message", chatId: chat.id, message: messageView(msg, u), chat: chatView(chat, u) });
  }
}
// A small note in the chat ("📅 New event", nickname changes, …)
function systemMessage(chat, me, text, extra = {}) {
  const msg = { id: crypto.randomUUID(), chatId: chat.id, userId: me.id, text, media: null, postId: null, replyTo: null, mentions: [], system: true, createdAt: new Date().toISOString() };
  if (chat.kind === "group") msg.channelId = firstText(chat).id;
  Object.assign(msg, extra);
  db.messages.push(msg);
  chat.lastAt = msg.createdAt;
  save("messages"); save("chats");
  deliver(chat, msg);
  return msg;
}
function deleteChannelMessages(chat, channelId) {
  const first = firstText(chat)?.id;
  const gone = db.messages.filter((x) => x.chatId === chat.id && (x.channelId || first) === channelId);
  for (const x of gone) if (x.media && !x.media.sticker && !x.media.gif && !x.media.shared) { deleteMedia(x.media.url); if (x.media.poster) deleteMedia(x.media.poster); }
  const ids = new Set(gone.map((x) => x.id));
  db.messages = db.messages.filter((x) => !ids.has(x.id));
  save("messages");
}
// An invite sent as a direct message (only between people who follow each other)
function dmInvite(me, user, group, code) {
  if (!mutual(me, user)) return;
  let dm = db.chats.find((ch) => ch.kind === "dm" && ch.members.includes(me.id) && ch.members.includes(user.id));
  if (!dm) {
    dm = { id: crypto.randomUUID(), kind: "dm", members: [me.id, user.id], createdAt: new Date().toISOString(), lastAt: new Date().toISOString(), reads: {} };
    db.chats.push(dm);
  }
  const msg = { id: crypto.randomUUID(), chatId: dm.id, userId: me.id, text: `📨 Join ${group.name} on LookBlog: /invite/${code}`, media: null, postId: null, replyTo: null, mentions: [], createdAt: new Date().toISOString() };
  db.messages.push(msg);
  dm.lastAt = msg.createdAt;
  save("messages"); save("chats");
  deliver(dm, msg);
}

// Which text channel a group message belongs to (older messages had none: they live in the first one)
const channelOf = (chat, msg) => msg.channelId || firstText(chat)?.id;
every(() => sweepVoice(db.chats), 15 * 1000).unref();

async function handleChat(req, res, url, me) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // without "api"
  const [a, b, c, d] = parts;
  const m = req.method;

  // Translate: POST /api/translate { messageId | text, to }
  if (m === "POST" && a === "translate" && parts.length === 1) {
    rateLimit("translate:" + me.id, 120, 10 * 60 * 1000, "You’re translating a lot. Take a short break.");
    const body = await readJSON(req);
    let text = String(body.text || "");
    if (body.messageId) {
      const msg = db.messages.find((x) => x.id === body.messageId);
      const ch = msg && findChat(msg.chatId);
      if (!msg || !ch || !canRead(ch, me)) throw httpError(404, "That message doesn’t exist.");
      text = msg.text || "";
    }
    text = text.slice(0, 2000);
    if (!text.trim()) throw httpError(400, "There’s nothing to translate.");
    const to = String(body.to || me.lang || "en").replace(/[^a-zA-Z-]/g, "").slice(0, 10) || "en";
    try {
      sendJSON(res, 200, { ...(await translate(text, to)), to });
    } catch (err) {
      console.error("[translate]", err.message);
      throw httpError(503, "Translation isn’t available right now. Check the internet connection.");
    }
    return true;
  }

  // People I can message (we follow each other): GET /api/me/mutuals
  if (m === "GET" && a === "me" && b === "mutuals" && parts.length === 2) {
    const list = db.users.filter((u) => u.id !== me.id && mutual(me, u)).map((u) => ({ ...authorView(u), ...presence(u.id) }))
      .sort((a, b) => Number(b.online) - Number(a.online));
    sendJSON(res, 200, { users: list });
    return true;
  }

  // People I could invite to a group (I follow them or they follow me): GET /api/me/invitable
  if (m === "GET" && a === "me" && b === "invitable" && parts.length === 2) {
    const list = db.users.filter((u) => u.id !== me.id && (me.following.includes(u.id) || u.following.includes(me.id)))
      .map((u) => ({ ...authorView(u), ...presence(u.id) }))
      .sort((x, y) => Number(y.online) - Number(x.online)).slice(0, 60);
    sendJSON(res, 200, { users: list });
    return true;
  }

  // My conversations: GET /api/chats
  if (m === "GET" && a === "chats" && parts.length === 1) {
    const list = db.chats
      .filter((ch) => isMember(ch, me) && (ch.kind === "group" || lastMessage(ch)))
      .sort((x, y) => y.lastAt.localeCompare(x.lastAt))
      .map((ch) => chatView(ch, me));
    sendJSON(res, 200, { chats: list, unread: list.reduce((n, ch) => n + ch.unread, 0) });
    return true;
  }

  // Reply to someone's note: POST /api/notes/:username/reply { text }
  // People who follow each other get it as a message (with the note quoted), otherwise as a notification.
  if (m === "POST" && a === "notes" && c === "reply" && parts.length === 3) {
    rateLimit("note-reply:" + me.id, 30, 10 * 60 * 1000, "You’ve replied to a lot of notes. Take a short break.");
    const other = findByUsername(decodeURIComponent(b));
    if (!other || other.id === me.id) throw httpError(404, "This note isn’t there anymore.");
    const note = require("./social").activeNote(other);
    if (!note || !me.following.includes(other.id) || require("./social").blockedBetween(me, other)) throw httpError(404, "This note isn’t there anymore.");
    const text = clean((await readJSON(req)).text);
    if (!text) throw httpError(400, "Write a reply.");
    if (chars(text) > 1000) throw httpError(400, "Keep it under 1000 characters.");
    let chat = db.chats.find((ch) => ch.kind === "dm" && ch.members.includes(me.id) && ch.members.includes(other.id));
    if (!chat && mutual(me, other)) {
      chat = { id: crypto.randomUUID(), kind: "dm", members: [me.id, other.id], createdAt: new Date().toISOString(), lastAt: new Date().toISOString(), reads: {} };
      db.chats.push(chat);
    }
    me.noteReplyCount = (me.noteReplyCount || 0) + 1;
    save("users");
    if (!chat) {
      notify(other.id, "note-reply", me, { text: `${text}` });
      sendJSON(res, 201, { sent: "notification" });
      return true;
    }
    const msg = { id: crypto.randomUUID(), chatId: chat.id, userId: me.id, text, media: null, postId: null, replyTo: null, mentions: [],
      noteReply: { text: note.text, media: note.media ? { url: note.media.url, gif: Boolean(note.media.gif) } : null, owner: other.id }, createdAt: new Date().toISOString() };
    db.messages.push(msg);
    chat.lastAt = msg.createdAt;
    save("messages"); save("chats");
    deliver(chat, msg);
    sendJSON(res, 201, { sent: "message", chatId: chat.id });
    return true;
  }

  // Open (or start) a direct conversation: POST /api/dm/:username
  if (m === "POST" && a === "dm" && parts.length === 2) {
    const other = findByUsername(decodeURIComponent(b));
    if (!other) throw httpError(404, "This account doesn’t exist.");
    if (other.id === me.id) throw httpError(400, "You can’t message yourself.");
    let chat = db.chats.find((ch) => ch.kind === "dm" && ch.members.includes(me.id) && ch.members.includes(other.id));
    if (!chat) {
      if (!mutual(me, other)) throw httpError(403, "You can message someone when you follow each other.");
      chat = { id: crypto.randomUUID(), kind: "dm", members: [me.id, other.id], createdAt: new Date().toISOString(), lastAt: new Date().toISOString(), reads: {} };
      db.chats.push(chat);
      save("chats");
    }
    sendJSON(res, 200, { chat: chatView(chat, me) });
    return true;
  }

  // Public groups: GET /api/groups?q=
  if (m === "GET" && a === "groups" && parts.length === 1) {
    const q = clean(url.searchParams.get("q")).toLowerCase();
    const list = db.chats
      .filter((ch) => ch.kind === "group" && ch.visibility === "public" && (!q || (ch.name + " " + ch.description).toLowerCase().includes(q)))
      .sort((x, y) => y.members.length - x.members.length || y.lastAt.localeCompare(x.lastAt))
      .slice(0, 60)
      .map((ch) => chatView(ch, me));
    sendJSON(res, 200, { groups: list });
    return true;
  }

  // Create a group: POST /api/groups { name, description, cover }
  if (m === "POST" && a === "groups" && parts.length === 1) {
    rateLimit("group:" + me.id, 10, 60 * 60 * 1000, "You’ve made a lot of groups. Try again later.");
    const data = validateGroup(await readJSON(req), me);
    const now = new Date().toISOString();
    const chat = { id: crypto.randomUUID(), kind: "group", ...data, ownerId: me.id, members: [me.id], createdAt: now, lastAt: now, reads: { [me.id]: now } };
    ensureGroup(chat);
    if (chat.cover) markUsed(chat.cover, "group:" + chat.id);
    if (chat.banner) markUsed(chat.banner, "groupbanner:" + chat.id);
    db.chats.push(chat);
    save("chats");
    sendJSON(res, 201, { chat: chatView(chat, me, { full: true }) });
    return true;
  }

  // Invite links: GET /api/invites/:code · POST /api/invites/:code/accept
  if (a === "invites" && b) {
    return handleInvites(req, res, me, parts, {
      presence,
      onJoined: (chat) => {
        notifyMembers(chat, { type: "group:members", chatId: chat.id, memberCount: chat.members.length });
        systemMessage(chat, me, `👋 ${me.name} joined the group`);
      },
    });
  }

  if ((a === "chats" || a === "groups") && b) {
    const chat = findChat(b);
    if (!chat || (a === "groups" && chat.kind !== "group")) throw httpError(404, "This conversation doesn’t exist.");
    if (!canRead(chat, me)) throw httpError(403, "This conversation is private.");

    // Someone is typing: POST /api/chats/:id/typing { channelId }
    if (m === "POST" && c === "typing" && parts.length === 3) {
      if (!isMember(chat, me)) { sendJSON(res, 200, { ok: true }); return true; }
      const body = await readJSON(req).catch(() => ({}));
      sendTo(chat.members.filter((id) => id !== me.id), { type: "chat:typing", chatId: chat.id, channelId: body.channelId || null, username: me.username, name: nicknameOf(chat, me.id) || me.name, stop: Boolean(body.stop) });
      sendJSON(res, 200, { ok: true });
      return true;
    }
    // Everything shared here: GET /api/chats/:id/gallery?kind=photos|videos|links
    if (m === "GET" && c === "gallery" && parts.length === 3) {
      const kind = url.searchParams.get("kind") || "photos";
      const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;
      const items = [];
      for (const x of db.messages) {
        if (x.chatId !== chat.id || x.system) continue;
        const base = { id: x.id, channelId: x.channelId || null, createdAt: x.createdAt, author: authorView(findUser(x.userId)) };
        if (kind === "photos" && x.media?.kind === "image" && !x.media.sticker) items.push({ ...base, url: x.media.url, gif: Boolean(x.media.gif) });
        else if (kind === "videos" && x.media?.kind === "video") items.push({ ...base, url: x.media.url, poster: x.media.poster || null, duration: x.media.duration || null });
        else if (kind === "links") for (const link of String(x.text || "").match(URL_RE) || []) items.push({ ...base, url: link, text: x.text.slice(0, 140) });
      }
      sendJSON(res, 200, { items: items.reverse().slice(0, 300) });
      return true;
    }
    // Search messages by words and/or a day: GET /api/chats/:id/search?q=&date=YYYY-MM-DD&tz=<minutes>
    if (m === "GET" && c === "search" && parts.length === 3) {
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const date = String(url.searchParams.get("date") || "");
      const tz = Number(url.searchParams.get("tz")) || 0; // the browser's getTimezoneOffset()
      if (!q && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, "Type something or pick a day.");
      const dayOf = (iso) => new Date(new Date(iso).getTime() - tz * 60000).toISOString().slice(0, 10);
      const found = db.messages.filter((x) => x.chatId === chat.id && !x.system
        && (!q || String(x.text || "").toLowerCase().includes(q) || (x.media?.name || "").toLowerCase().includes(q))
        && (!date || dayOf(x.createdAt) === date)).slice(-200).reverse();
      sendJSON(res, 200, { messages: found.map((x) => messageView(x, me)) });
      return true;
    }
    // GET /api/chats/:id
    if (m === "GET" && parts.length === 2) {
      sendJSON(res, 200, { chat: chatView(chat, me, { full: true }) });
      return true;
    }

    // GET /api/chats/:id/messages?before=<createdAt>
    if (m === "GET" && c === "messages" && parts.length === 3) {
      const before = url.searchParams.get("before");
      const channel = chat.kind === "group" ? (chat.channels.find((x) => x.id === url.searchParams.get("channel") && x.kind === "text") || firstText(chat)).id : null;
      const all = db.messages.filter((x) => x.chatId === chat.id && (!before || x.createdAt < before) && (!channel || channelOf(chat, x) === channel));
      const slice = all.slice(-PAGE);
      sendJSON(res, 200, { messages: slice.map((x) => messageView(x, me)), more: all.length > PAGE ? slice[0].createdAt : null });
      return true;
    }

    // POST /api/chats/:id/messages { text, media, postId }
    if (m === "POST" && c === "messages" && parts.length === 3) {
      rateLimit("msg:" + me.id, 120, 10 * 60 * 1000, "You’re sending a lot of messages. Take a short break.");
      if (!isMember(chat, me)) throw httpError(403, chat.kind === "group" ? "Join the group to write here." : "You’re not in this conversation.");
      if (chat.kind === "dm") {
        const other = findUser(chat.members.find((id) => id !== me.id));
        if (!other || !mutual(me, other)) throw httpError(403, "You can message someone only while you follow each other.");
      }
      const body = await readJSON(req);
      const text = clean(body.text);
      let media = body.media ? buildMedia(body.media, me) : null;
      const gifMedia = resolveGif(body, me);
      if (gifMedia) media = gifMedia;
      const extra = resolveExtras(body, me, chat); // a sticker or a sound (mine, the group's, or built-in)
      if (extra) media = extra;
      const found = body.postId ? findPost(body.postId) : null;
      const post = found && canView(found, me) ? found : null;
      if (post && post.userId !== me.id) { post.shares = (post.shares || 0) + 1; save("posts"); require("./realtime").broadcast({ type: "stats", id: post.id, likes: post.likes.length, dislikes: post.dislikes.length, views: post.viewedBy.length, comments: post.commentCount, reposts: post.reposts.length, cools: post.cools.length, shares: post.shares }); }
      if (body.postId && !post) throw httpError(404, "That post doesn’t exist anymore.");
      // A reply (comment) from a post, short or video
      let commentRef = null;
      if (body.commentId) {
        const cm = db.comments.find((x) => x.id === body.commentId);
        const onPost = cm && findPost(cm.postId);
        if (!cm || !onPost || !canView(onPost, me)) throw httpError(404, "That reply doesn’t exist anymore.");
        commentRef = cm.id;
      }
      // A song from LookBlog's music
      let songRef = null;
      if (body.songId) {
        const sg = db.songs.find((x) => x.id === body.songId);
        if (!sg) throw httpError(404, "That song doesn’t exist anymore.");
        songRef = sg.id;
      }
      if (!text && !media && !post && !commentRef && !songRef) throw httpError(400, "Write a message or add something to send.");
      if (chars(text) > 2000) throw httpError(400, "Keep messages under 2000 characters.");

      let replyTo = null;
      if (body.replyTo) {
        const orig = db.messages.find((x) => x.id === body.replyTo && x.chatId === chat.id);
        if (!orig) throw httpError(404, "The message you’re replying to was deleted.");
        replyTo = orig.id;
      }
      const msg = { id: crypto.randomUUID(), chatId: chat.id, userId: me.id, text, media, postId: post ? post.id : null, commentId: commentRef, songId: songRef, replyTo, mentions: findMentions(text), createdAt: new Date().toISOString() };
      if (chat.kind === "group") {
        const ch = chat.channels.find((x) => x.id === body.channelId && x.kind === "text") || firstText(chat);
        msg.channelId = ch.id;
      }
      db.messages.push(msg);
      if (!media?.sticker && !media?.gif && !media?.shared) claim(media, "message:" + msg.id);
      chat.lastAt = msg.createdAt;
      chat.reads = { ...(chat.reads || {}), [me.id]: msg.createdAt };
      save("messages");
      save("chats");
      deliver(chat, msg);
      // @someone pings them (a notification), @everyone pings the whole group
      const pinged = new Set(msg.mentions.filter((id) => id !== me.id && chat.members.includes(id)));
      if (chat.kind === "group" && /(^|\s)@(everyone|here)\b/i.test(text) && can(chat, me, "mention_everyone")) { chat.members.forEach((id) => id !== me.id && pinged.add(id)); msg.everyone = true; save("messages"); }
      for (const id of pinged) notify(id, "chat-mention", me, { chatId: chat.id, group: chat.kind === "group" ? chat.name : null, text: text || "mentioned you" });
      sendJSON(res, 201, { message: messageView(msg, me) });
      return true;
    }

    // Delete my message: DELETE /api/chats/:id/messages/:messageId
    if (m === "DELETE" && c === "messages" && d && parts.length === 4) {
      const i = db.messages.findIndex((x) => x.id === d && x.chatId === chat.id);
      if (i === -1) throw httpError(404, "That message doesn’t exist.");
      const msg = db.messages[i];
      if (msg.userId !== me.id && !(chat.kind === "group" && can(chat, me, "delete_messages"))) throw httpError(403, "You can only delete your own messages.");
      db.messages.splice(i, 1);
      if (msg.media && !msg.media.sticker && !msg.media.gif && !msg.media.shared) { deleteMedia(msg.media.url); if (msg.media.poster) deleteMedia(msg.media.poster); }
      save("messages");
      notifyMembers(chat, { type: "message:deleted", chatId: chat.id, messageId: msg.id });
      sendJSON(res, 200, { ok: true });
      return true;
    }

    // React: POST /api/chats/:id/messages/:messageId/react { emoji }  (same emoji again removes it)
    if (m === "POST" && c === "messages" && d && parts[4] === "react" && parts.length === 5) {
      if (!isMember(chat, me)) throw httpError(403, "Join the group to react.");
      const msg = db.messages.find((x) => x.id === d && x.chatId === chat.id);
      if (!msg) throw httpError(404, "That message doesn’t exist.");
      const emoji = String((await readJSON(req)).emoji || "");
      if (emoji && (emoji.length > 32 || !EMOJI_RE.test(emoji))) throw httpError(400, "That isn’t an emoji.");
      msg.reactions = msg.reactions || {};
      if (!emoji || msg.reactions[me.id] === emoji) delete msg.reactions[me.id];
      else msg.reactions[me.id] = emoji;
      save("messages");
      for (const id of chat.members) {
        const u = findUser(id);
        if (u) sendTo([id], { type: "message:reactions", chatId: chat.id, messageId: msg.id, reactions: reactionsView(msg, u) });
      }
      if (emoji && msg.userId !== me.id && msg.reactions[me.id]) {
        sendTo([msg.userId], { type: "message:reacted", chatId: chat.id, by: me.username, emoji });
      }
      sendJSON(res, 200, { reactions: reactionsView(msg, me) });
      return true;
    }

    // Calls (voice and video, direct chats): POST /api/chats/:id/call { kind, callId, video, data }
    // kind: ring | accept | decline | busy | offer | answer | ice | hangup — the server only passes these on.
    if (m === "POST" && c === "call" && parts.length === 3) {
      if (chat.kind !== "dm" || !isMember(chat, me)) throw httpError(403, "Calls work in direct chats.");
      const other = findUser(chat.members.find((id) => id !== me.id));
      if (!other || !mutual(me, other)) throw httpError(403, "You can call someone when you follow each other.");
      const body = await readJSON(req, 200_000);
      const KINDS = ["ring", "accept", "decline", "busy", "offer", "answer", "ice", "hangup", "screen"];
      if (!KINDS.includes(body.kind)) throw httpError(400, "Unknown call step.");
      if (body.kind === "ring") rateLimit("call:" + me.id, 30, 10 * 60 * 1000, "You’re calling a lot. Try again in a bit.");
      if (body.kind === "accept") { me.callCount = (me.callCount || 0) + 1; other.callCount = (other.callCount || 0) + 1; save("users"); }
      sendTo([other.id], {
        type: "call", chatId: chat.id, callId: String(body.callId || "").slice(0, 40), kind: body.kind, video: Boolean(body.video),
        from: { name: me.name, username: me.username, avatar: me.avatar, verified: Boolean(me.verified), verifiedType: me.verifiedType || null },
        data: body.data ?? null,
      });
      sendJSON(res, 200, { ok: true });
      return true;
    }

    // Channels, roles, events, nicknames
    if (await handleGroupRoutes(req, res, me, chat, parts, { systemMessage, deleteChannelMessages, dmInvite })) return true;

    // Voice channels: POST /api/groups/:id/voice
    if (m === "POST" && c === "voice" && parts.length === 3 && chat.kind === "group") return handleVoice(req, res, me, chat, db.chats);

    /* ---------- Games: chess, tic-tac-toe, connect four ---------- */
    // Start one: POST /api/chats/:id/games { type, channelId }
    if (m === "POST" && c === "games" && parts.length === 3) {
      if (!isMember(chat, me)) throw httpError(403, "Join to play.");
      const body = await readJSON(req);
      const def = gameDef(body.type);
      if (!def) throw httpError(400, "Pick a game.");
      rateLimit("game:" + me.id, 30, 10 * 60 * 1000, "That’s a lot of games. Finish one first!");
      const other = chat.kind === "dm" ? chat.members.find((id) => id !== me.id) : null;
      if (chat.kind === "dm" && !mutual(me, findUser(other))) throw httpError(403, "You can play when you follow each other.");
      const game = CARD_GAMES[body.type]
        ? { type: body.type, card: true, host: me.id, players: [me.id], phase: "lobby", state: null }
        : { type: body.type, players: [me.id, other], state: def.start(), status: { over: false }, moves: 0 };
      const msg = { id: crypto.randomUUID(), chatId: chat.id, userId: me.id, text: "", media: null, postId: null, replyTo: null, mentions: [], game, createdAt: new Date().toISOString() };
      if (chat.kind === "group") msg.channelId = (chat.channels.find((x) => x.id === body.channelId && x.kind === "text") || firstText(chat)).id;
      db.messages.push(msg);
      chat.lastAt = msg.createdAt;
      save("messages"); save("chats");
      deliver(chat, msg);
      sendJSON(res, 201, { message: messageView(msg, me) });
      return true;
    }
    // Join / move / resign: POST /api/chats/:id/games/:messageId/(join|move|resign)
    if (m === "POST" && c === "games" && d && parts.length === 5) {
      const msg = db.messages.find((x) => x.id === d && x.chatId === chat.id && x.game);
      if (!msg) throw httpError(404, "That game is gone.");
      if (!isMember(chat, me)) throw httpError(403, "Join to play.");
      const g = msg.game, def = gameDef(g.type);
      const action = parts[4];
      if (g.card) {
        // Card games: a lobby (join / leave / start), then moves ("act"), then "again"
        const names = seatNames(chat, g);
        if (action === "join") {
          if (g.phase !== "lobby") throw httpError(409, "This game already started.");
          if (g.players.includes(me.id)) throw httpError(400, "You’re already in.");
          if (g.players.length >= def.max) throw httpError(409, "The table is full.");
          g.players.push(me.id);
        } else if (action === "addbot") {
          if (g.phase !== "lobby") throw httpError(409, "This game already started.");
          if (g.host !== me.id) throw httpError(403, "Only the person who opened the table can add bots.");
          if (g.players.length >= def.max) throw httpError(409, "The table is full.");
          const name = BOT_NAMES.find((n) => !g.players.includes("bot:" + n)) || "Bot" + g.players.length;
          g.players.push("bot:" + name);
        } else if (action === "removebot") {
          if (g.phase !== "lobby" || g.host !== me.id) throw httpError(403, "You can’t do that now.");
          const i = g.players.map(isBot).lastIndexOf(true);
          if (i === -1) throw httpError(400, "There are no bots.");
          g.players.splice(i, 1);
        } else if (action === "end") {
          // Only the person who opened the table can stop the game
          if (g.host !== me.id) throw httpError(403, "Only the person who started the game can stop it. You can leave instead.");
          if (g.phase === "over") throw httpError(409, "This game is already over.");
          g.phase = "over"; g.ended = names[g.players.indexOf(me.id)] || me.name;
        } else if (action === "leave") {
          if (!g.players.includes(me.id)) throw httpError(400, "You’re not playing.");
          if (g.phase === "lobby") {
            g.players = g.players.filter((id) => id !== me.id);
            if (g.host === me.id) g.host = g.players.find((id) => !isBot(id)) || null;
          } else if (g.phase === "play") {
            if (g.host === me.id) throw httpError(400, "You started this game — use End game to stop it.");
            // A bot takes your seat so the others can finish
            const seat = g.players.indexOf(me.id);
            const name = BOT_NAMES.find((n) => !g.players.includes("bot:" + n)) || "Bot" + seat;
            g.players[seat] = "bot:" + name;
            if (g.state?.log) { g.state.log.push(`${names[seat]} left — 🤖 ${name} takes the seat`); if (g.state.log.length > 12) g.state.log.shift(); }
          } else throw httpError(400, "This game is over.");
        } else if (action === "start" || action === "again") {
          g.ended = null;
          if (action === "start" && g.host !== me.id) throw httpError(403, "Only the person who opened the table can start.");
          if (action === "again" && (!g.players.includes(me.id) || g.phase !== "over")) throw httpError(400, "You can’t restart this.");
          if (g.players.length < def.min) throw httpError(409, `${def.name} needs at least ${def.min} player${def.min === 1 ? "" : "s"}.`);
          g.state = def.start(g.players.length);
          g.phase = "play";
        } else if (action === "act") {
          const seat = g.players.indexOf(me.id);
          if (seat === -1) throw httpError(403, "You’re watching this game.");
          if (g.phase !== "play") throw httpError(409, "The game isn’t running.");
          try { def.act(g.state, seat, await readJSON(req), names); }
          catch (err) { if (err.gameRule) throw httpError(400, err.message); throw err; }
          if (def.over(g.state)) { g.phase = "over"; recordResult(g); }
        } else throw httpError(404, "Not found.");
        save("messages");
        pushGame(chat, msg);
        runBots(chat, msg);
        sendJSON(res, 200, { game: gameView(g, me) });
        return true;
      }
      if (action === "join") {
        if (g.players[1]) throw httpError(409, "Someone already took that seat.");
        if (g.players[0] === me.id) throw httpError(400, "Wait for someone else to join.");
        g.players[1] = me.id;
      } else if (action === "move") {
        if (g.status.over) throw httpError(409, "This game is over.");
        if (!g.players[1]) throw httpError(409, "Wait for someone to join.");
        const side = def.sides[g.players.indexOf(me.id)];
        if (!side) throw httpError(403, "You’re watching this game.");
        if ((g.state.turn) !== side) throw httpError(409, "It’s not your turn.");
        const next = def.move(g.state, (await readJSON(req)).move || {});
        if (!next) throw httpError(400, "That move isn’t allowed.");
        g.state = next;
        g.moves++;
        if (g.type === "chess" && next.last?.captured) {
          g.captured = g.captured || { w: [], b: [] };
          g.captured[side].push(next.last.captured[1]);
        }
        g.status = def.status(next);
        if (g.status.over) recordResult(g);
      } else if (action === "end") {
        if (g.players[0] !== me.id) throw httpError(403, "Only the person who started the game can stop it. You can leave instead.");
        if (g.status.over) throw httpError(409, "This game is already over.");
        g.status = { over: true, result: "ended" };
        g.ended = me.name;
      } else if (action === "resign") {
        const i = g.players.indexOf(me.id);
        if (i === -1 || g.status.over) throw httpError(400, "You can’t resign this game.");
        g.status = { over: true, result: "resigned", winner: def.sides[1 - i] };
        g.resigned = me.id;
        recordResult(g);
      } else throw httpError(404, "Not found.");
      save("messages");
      for (const id of chat.members) {
        const u = findUser(id);
        if (u) sendTo([id], { type: "game:update", chatId: chat.id, messageId: msg.id, game: gameView(g, u) });
      }
      sendJSON(res, 200, { game: gameView(g, me) });
      return true;
    }

    /* ---------- Pinned messages ---------- */
    // GET /api/chats/:id/pins
    if (m === "GET" && c === "pins" && parts.length === 3) {
      const list = (chat.pins || []).map((id) => db.messages.find((x) => x.id === id)).filter(Boolean).reverse();
      sendJSON(res, 200, { messages: list.map((x) => messageView(x, me)) });
      return true;
    }
    // POST /api/chats/:id/messages/:messageId/pin { on }
    if (m === "POST" && c === "messages" && d && parts[4] === "pin" && parts.length === 5) {
      if (!isMember(chat, me)) throw httpError(403, "Join to pin messages.");
      if (chat.kind === "group" && !can(chat, me, "pin_messages")) throw httpError(403, "You need the “Pin and unpin messages” permission here.");
      const msg = db.messages.find((x) => x.id === d && x.chatId === chat.id);
      if (!msg || msg.system) throw httpError(404, "That message doesn’t exist.");
      const on = Boolean((await readJSON(req)).on);
      chat.pins = (chat.pins || []).filter((id) => id !== msg.id && db.messages.some((x) => x.id === id));
      if (on) {
        if (chat.pins.length >= 50) throw httpError(400, "You can pin up to 50 messages. Unpin one first.");
        chat.pins.push(msg.id);
      }
      save("chats");
      sendTo(chat.members, { type: "message:pinned", chatId: chat.id, messageId: msg.id, pinned: on, count: chat.pins.length });
      if (on) systemMessage(chat, me, `📌 ${me.name} pinned a message`, chat.kind === "group" ? { channelId: msg.channelId || firstText(chat).id } : {});
      sendJSON(res, 200, { pinned: on, count: chat.pins.length });
      return true;
    }

    // Mark as read: POST /api/chats/:id/read — and tell the others (for "Seen")
    if (m === "POST" && c === "read" && parts.length === 3) {
      if (isMember(chat, me)) {
        const at = new Date().toISOString();
        chat.reads = { ...(chat.reads || {}), [me.id]: at };
        save("chats");
        sendTo(chat.members.filter((id) => id !== me.id), { type: "chat:read", chatId: chat.id, user: { ...authorView(me), at } });
      }
      sendJSON(res, 200, { ok: true });
      return true;
    }

    if (chat.kind === "group") {
      // Join / leave: POST /api/groups/:id/join | leave
      if (m === "POST" && (c === "join" || c === "leave") && parts.length === 3) {
        if (c === "join" && !isMember(chat, me) && chat.visibility === "private") throw httpError(403, "This group is private. A member has to add you.");
        if (c === "join" && !isMember(chat, me)) {
          chat.members.push(me.id);
          chat.reads = { ...(chat.reads || {}), [me.id]: new Date().toISOString() };
        }
        if (c === "leave" && isMember(chat, me)) {
          chat.members = chat.members.filter((id) => id !== me.id);
          if (chat.memberRoles) delete chat.memberRoles[me.id];
          leaveVoice(me.id, db.chats);
          if (chat.ownerId === me.id && chat.members.length) chat.ownerId = chat.members[0]; // hand it over
        }
        save("chats");
        notifyMembers(chat, { type: "group:members", chatId: chat.id, memberCount: chat.members.length });
        sendJSON(res, 200, { chat: chatView(chat, me, { full: true }) });
        return true;
      }

      // Add someone: POST /api/groups/:id/members { username }  (any member can add people)
      if (m === "POST" && c === "members" && parts.length === 3) {
        if (!isMember(chat, me)) throw httpError(403, "Join the group to add people.");
        const user = findByUsername(String((await readJSON(req)).username || "").replace(/^@/, ""));
        if (!user) throw httpError(404, "This account doesn’t exist.");
        if (!isMember(chat, user)) {
          chat.members.push(user.id);
          save("chats");
          sendTo([user.id], { type: "group:added", chatId: chat.id, name: chat.name, by: me.username });
          notifyMembers(chat, { type: "group:members", chatId: chat.id, memberCount: chat.members.length });
        }
        sendJSON(res, 200, { chat: chatView(chat, me, { full: true }) });
        return true;
      }

      // Remove someone (owner only): DELETE /api/groups/:id/members/:username
      if (m === "DELETE" && c === "members" && d && parts.length === 4) {
        if (!can(chat, me, "kick")) throw httpError(403, "You don’t have permission to remove people.");
        const user = findByUsername(decodeURIComponent(d));
        if (!user || user.id === me.id || rank(chat, user.id) >= rank(chat, me.id)) throw httpError(400, "You can’t remove that person.");
        chat.members = chat.members.filter((id) => id !== user.id);
        delete chat.memberRoles[user.id];
        sendTo([user.id], { type: "group:deleted", chatId: chat.id, name: chat.name, by: me.username });
        save("chats");
        notifyMembers(chat, { type: "group:members", chatId: chat.id, memberCount: chat.members.length });
        sendJSON(res, 200, { chat: chatView(chat, me, { full: true }) });
        return true;
      }

      // Delete the whole group (owner only): DELETE /api/groups/:id
      if (m === "DELETE" && parts.length === 2) {
        if (chat.ownerId !== me.id) throw httpError(403, "Only the group’s owner can delete it.");
        const members = [...chat.members];
        for (const x of db.messages) if (x.chatId === chat.id && x.media && !x.media.sticker && !x.media.gif && !x.media.shared) { deleteMedia(x.media.url); if (x.media.poster) deleteMedia(x.media.poster); }
        db.messages = db.messages.filter((x) => x.chatId !== chat.id);
        db.chats = db.chats.filter((x) => x !== chat);
        if (chat.cover) deleteMedia(chat.cover);
        if (chat.banner) deleteMedia(chat.banner);
        for (const snd of chat.sounds || []) deleteMedia(snd.url);
        save("messages");
        save("chats");
        sendTo(members, { type: "group:deleted", chatId: chat.id, name: chat.name, by: me.username });
        sendJSON(res, 200, { ok: true });
        return true;
      }

      // Edit (owner only): POST /api/groups/:id { name, description, cover }
      if (m === "POST" && parts.length === 2) {
        if (!can(chat, me, "manage_group")) throw httpError(403, "You don’t have permission to change the group.");
        const body = await readJSON(req);
        const data = validateGroup(body, me, chat);
        if (body.color !== undefined) {
          if (!COLOR_RE.test(String(body.color))) throw httpError(400, "Pick a colour.");
          data.color = body.color.toLowerCase();
        }
        if (chat.cover && chat.cover !== data.cover) deleteMedia(chat.cover);
        if (chat.banner && chat.banner !== data.banner) deleteMedia(chat.banner);
        if (data.banner && data.banner !== chat.banner) markUsed(data.banner, "groupbanner:" + chat.id);
        if (data.cover && data.cover !== chat.cover) markUsed(data.cover, "group:" + chat.id);
        Object.assign(chat, data);
        save("chats");
        sendTo(chat.members, { type: "group:changed", chatId: chat.id, what: "group" });
        sendJSON(res, 200, { chat: chatView(chat, me, { full: true }) });
        return true;
      }
    }
  }

  return false;
}

module.exports = { handleChat, streakOf, deliverMessage: (chat, msg) => deliver(chat, msg) };
