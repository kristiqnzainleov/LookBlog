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
  for (let i = db.messages.length - 1; i >= 0; i--) if (db.messages[i].chatId === chat.id && !expired(db.messages[i])) return db.messages[i];
  return null;
}
function unread(chat, me) {
  if (!isMember(chat, me)) return 0;
  const since = chat.reads?.[me.id] || "";
  return db.messages.filter((m) => m.chatId === chat.id && m.userId !== me.id && m.createdAt > since).length;
}
function preview(msg) {
  if (!msg) return "";
  if (msg.poll) return `📊 Poll: ${msg.poll.question}`;
  if (msg.groupInvite) return `📨 Invite to ${findChat(msg.groupInvite.chatId)?.name || "a group"}`;
  if (msg.unlockAt && Date.now() < new Date(msg.unlockAt).getTime()) return "⏳ A time capsule";
  if (msg.game) return `${gameDef(msg.game.type)?.emoji || "🎮"} Started a game of ${gameDef(msg.game.type)?.name || "something"}`;
  if (msg.viewOnce) return msg.viewOnce.gone || (msg.media ? msg.media.kind : "text") === "text" ? "👁 View-once message" : msg.media?.kind === "video" ? "👁 View-once video" : "👁 View-once photo";
  if (msg.text) return msg.text.slice(0, 120);
  if (msg.media?.sticker) return "Sent a sticker";
  if (msg.media?.gif) return "Sent a GIF";
  if (msg.media) return msg.media.kind === "file" ? `📎 ${msg.media.name || "File"}` : msg.media.kind === "audio" ? (msg.media.file ? `🎵 ${msg.media.name || "Audio"}` : "🎤 Voice message") : msg.media.kind === "video" ? "Sent a video" : "Sent a photo";
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
// The chat's wallpaper, the same for everyone in it. (It used to be personal: the first one a member
// had picked becomes the chat's.)
function chatWallpaper(chat) {
  if (chat.wallpaper === undefined) {
    const had = chat.members.map((id) => findUser(id)?.wallpapers?.[chat.id]).find(Boolean) || null;
    chat.wallpaper = had;
    if (had?.image) markUsed(had.image, `wallpaper:${chat.id}`);
    save("chats");
  }
  return chat.wallpaper || null;
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
    wallpaper: chatWallpaper(chat), // the background everyone in the chat sees
    theme: chat.theme || null, // the bubble colours everyone in the chat sees
    vanish: chat.vanish || 0, // disappearing messages: seconds, 0 = off
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
    out.colorGrad = chat.colorGrad || null;
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
    text: orig.unlockAt && Date.now() < new Date(orig.unlockAt).getTime() ? "⏳ A time capsule" : preview(orig),
    thumb: orig.media && !orig.viewOnce && !(orig.unlockAt && Date.now() < new Date(orig.unlockAt).getTime()) ? (orig.media.kind === "image" ? orig.media.url : orig.media.poster || null) : null,
  };
}

function gameView(g, me) {
  if (g.card) {
    const def = CARD_GAMES[g.type];
    const players = g.players.map((id) => (isBot(id) ? botView(id) : (findUser(id) ? authorView(findUser(id)) : null)));
    const myIndex = g.players.indexOf(me.id);
    return { type: g.type, card: true, party: Boolean(def.party), noBots: Boolean(def.noBots), name: def.name, emoji: def.emoji, min: def.min, max: def.max, players, phase: g.phase, isHost: g.host === me.id, myIndex,
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

// A view-once message as one person sees it: closed (tap to open), opened (gone for them) or, for the sender, who opened it
function viewOnceView(msg, me, out) {
  const chat = findChat(msg.chatId);
  const others = (chat?.members || []).filter((id) => id !== msg.userId);
  const opened = msg.viewOnce.openedBy || [];
  const kind = msg.viewOnce.gone ? msg.viewOnce.kind : msg.media ? msg.media.kind : "text";
  const max = msg.viewOnce.max || 1, done = (id) => (msg.viewOnce.opens?.[id] ?? (opened.includes(id) ? 1 : 0)) >= max;
  out.viewOnce = { kind, replay: max > 1, opened: done(me.id), replayLeft: max > 1 && opened.includes(me.id) && !done(me.id), openedCount: opened.length,
    everyone: others.length > 0 && others.every(done) };
  // Nobody sees the content in the chat itself: the others open it once, and the sender only sees that it was sent
  out.text = ""; out.media = null; out.mentions = [];
  return out;
}
function messageView(msg, me) {
  if (msg.viewOnce) return viewOnceView(msg, me, messageViewFull(msg, me));
  const v = messageViewFull(msg, me);
  if (msg.unlockAt) v.unlockAt = msg.unlockAt;
  if (lockedFor(msg, me)) { v.text = ""; v.media = null; v.post = null; v.song = null; v.comment = null; v.locked = true; }
  return v;
}
function messageViewFull(msg, me) {
  let post = null;
  const chat = findChat(msg.chatId);
  if (msg.postId) {
    const p = findPost(msg.postId);
    post = p ? (canView(p, me) ? postView(p, me) : { hidden: true }) : { deleted: true };
  }
  return {
    id: msg.id,
    chatId: msg.chatId,
    expiresAt: msg.expiresAt || null,
    text: msg.text,
    media: msg.media,
    post,
    comment: msg.commentId ? sharedCommentView(msg.commentId, me) : null,
    song: msg.songId ? (() => { const sg = db.songs.find((x) => x.id === msg.songId); return sg ? require("./music").songView(sg, me) : { deleted: true }; })() : null,
    pinned: Boolean(chat?.pins?.includes(msg.id)),
    mentions: usernamesOf(msg.mentions),
    pingsMe: msg.userId !== me.id && (msg.mentions.includes(me.id) || Boolean(msg.everyone)),
    reactions: reactionsView(msg, me),
    notes: notesView(msg, me),
    poll: msg.poll ? chatPollView(msg.poll, me, chat) : null,
    groupInvite: msg.groupInvite ? groupInviteView(msg.groupInvite, me) : null,
    style: msg.system ? null : msgStyleOf(msg.userId),
    sound: msg.system ? null : findUser(msg.userId)?.msgSound || null,
    effect: msg.effect || null,
    hypes: (msg.hypes || []).length,
    hypedByMe: (msg.hypes || []).includes(me.id),
    replyTo: replyPreview(msg),
    storyReply: msg.storyReply ? { ...require("./stories").storyPreview(msg.storyReply.storyId, me), reaction: msg.storyReply.reaction, toMe: msg.storyReply.owner === me.id } : null,
    instantReply: msg.instantReply ? { reaction: msg.instantReply.reaction || null, toMe: msg.instantReply.owner === me.id } : null,
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

/* ---------- How my messages look (my own style, everyone sees it) and send effects ---------- */
const MSG_EFFECTS = ["slam", "loud", "gentle", "ink", "confetti", "hearts", "fireworks", "balloons", "spotlight", "lasers", "shake", "rainbow",
  "snow", "stars", "money", "fire", "bubbles", "kisses", "butterflies", "petals", "rockets", "party", "thunder", "disco", "zoom", "glitch", "typewriter", "bounce", "spin", "ghost",
  "cash", "pizza", "cats", "dogs", "skulls", "clowns", "eyes", "hundred", "goats", "aliens", "crowns", "diamonds", "rain", "matrix", "magic", "heartbeat", "flip", "drop", "tornado", "jelly", "explode",
  // secret & fun messages (they stay that way)
  "scratch", "hold", "whisper", "upside", "mirror", "capsule", "selfdestruct", "shaking", "glowing"];
// A time capsule: nobody but the sender sees what's inside until it opens
const lockedFor = (msg, me) => Boolean(msg.unlockAt && Date.now() < new Date(msg.unlockAt).getTime() && msg.userId !== me.id);
function msgStyleOf(userId) { const u = findUser(userId); return u?.msgStyle || null; }

/* ---------- Polls in chats and groups ---------- */
// { question, options: [{ id, text, votes: [userIds] }], multi, anonymous, endsAt, closed, by }
function chatPollView(p, me, chat) {
  const ended = p.closed || (p.endsAt && Date.now() > new Date(p.endsAt).getTime());
  const voters = new Set(p.options.flatMap((o) => o.votes));
  return {
    question: p.question, multi: Boolean(p.multi), anonymous: Boolean(p.anonymous), endsAt: p.endsAt || null, ended: Boolean(ended),
    total: voters.size, mine: p.options.filter((o) => o.votes.includes(me.id)).map((o) => o.id), isAuthor: p.by === me.id,
    options: p.options.map((o) => ({ id: o.id, text: o.text, count: o.votes.length,
      voters: p.anonymous ? [] : o.votes.slice(0, 12).map(findUser).filter(Boolean).map((u) => ({ name: nicknameOf(chat, u.id) || u.name, username: u.username, avatar: u.avatar })) })),
  };
}
function pushPoll(chat, msg) {
  for (const id of chat.members) { const u = findUser(id); if (u) sendTo([id], { type: "message:poll", chatId: chat.id, messageId: msg.id, poll: chatPollView(msg.poll, u, chat) }); }
}

/* ---------- Notes on a message: little sticky notes the chat's members leave on it ---------- */
const MSG_NOTE_COLORS = ["yellow", "pink", "mint", "sky", "lilac", "peach"];
function notesView(msg, me) {
  const chat = findChat(msg.chatId);
  return (msg.notes || []).map((n) => {
    const u = findUser(n.userId);
    return u ? { id: n.id, text: n.text, color: n.color, at: n.at, mine: n.userId === me.id, canDelete: n.userId === me.id || Boolean(chat && chat.kind === "group" && can(chat, me, "delete_messages")),
      author: { name: nicknameOf(chat, u.id) || u.name, username: u.username, avatar: u.avatar } } : null;
  }).filter(Boolean);
}
function sendNotes(chat, msg) {
  for (const id of chat.members) { const u = findUser(id); if (u) sendTo([id], { type: "message:notes", chatId: chat.id, messageId: msg.id, notes: notesView(msg, u) }); }
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
  // Disappearing messages: each one is deleted for everyone after the chat's timer
  if (chat.vanish && !msg.system && !msg.expiresAt) {
    msg.expiresAt = new Date(new Date(msg.createdAt).getTime() + chat.vanish * 1000).toISOString();
    save("messages");
  }
  for (const id of chat.members) {
    const u = findUser(id);
    if (u) sendTo([id], { type: "message", chatId: chat.id, message: messageView(msg, u), chat: chatView(chat, u) });
  }
}
// Delete disappearing messages whose time is up (and tell the chat, so they vanish from open screens)
const VANISH = { 0: "off", 3600: "1 hour", 86400: "24 hours", 604800: "7 days" };
const expired = (x) => x.expiresAt && x.expiresAt <= new Date().toISOString();
function sweepVanished() {
  // View-once photos and videos everyone has opened: the file goes a minute later
  for (const x of db.messages) {
    const pg = x.viewOnce?.purge;
    if (pg && pg.at <= Date.now()) { deleteMedia(pg.url); if (pg.poster) deleteMedia(pg.poster); delete x.viewOnce.purge; save("messages"); }
  }
  const gone = db.messages.filter(expired);
  if (!gone.length) return;
  const ids = new Set(gone.map((x) => x.id));
  db.messages = db.messages.filter((x) => !ids.has(x.id));
  for (const x of gone) {
    if (x.media && !x.media.sticker && !x.media.gif && !x.media.shared) { deleteMedia(x.media.url); if (x.media.poster) deleteMedia(x.media.poster); }
    const chat = findChat(x.chatId);
    if (chat) {
      chat.pins = (chat.pins || []).filter((p) => (p.id || p) !== x.id);
      notifyMembers(chat, { type: "message:deleted", chatId: chat.id, messageId: x.id });
    }
  }
  save("messages"); save("chats");
}
every(sweepVanished, 30 * 1000).unref();

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
// A group invite goes to the chat between the two of you, as a card with a Join button (it opens that chat)
function dmInvite(me, user, group, code) {
  const { blockedBetween } = require("./social");
  if (blockedBetween(me, user)) return null;
  let dm = db.chats.find((ch) => ch.kind === "dm" && ch.members.includes(me.id) && ch.members.includes(user.id));
  if (!dm) {
    dm = { id: crypto.randomUUID(), kind: "dm", members: [me.id, user.id], createdAt: new Date().toISOString(), lastAt: new Date().toISOString(), reads: {} };
    db.chats.push(dm);
  }
  const msg = { id: crypto.randomUUID(), chatId: dm.id, userId: me.id, text: "", groupInvite: { chatId: group.id, code }, media: null, postId: null, replyTo: null, mentions: [], createdAt: new Date().toISOString() };
  db.messages.push(msg);
  dm.lastAt = msg.createdAt;
  save("messages"); save("chats");
  deliver(dm, msg);
  return dm.id;
}
function groupInviteView(gi, me) {
  const g = findChat(gi.chatId);
  if (!g) return { gone: true };
  const inv = (g.invites || []).find((i) => i.code === gi.code);
  const expired = !inv || (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) || (inv.maxUses && (inv.uses || 0) >= inv.maxUses);
  return { chatId: g.id, code: gi.code, name: g.name, description: (g.description || "").slice(0, 120), cover: g.cover || null, color: g.color || null, members: g.members.length, member: g.members.includes(me.id), expired: Boolean(expired) };
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
      text = msg.viewOnce || lockedFor(msg, me) ? "" : msg.text || "";
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
        if (x.chatId !== chat.id || x.system || x.viewOnce) continue;
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
      const found = db.messages.filter((x) => x.chatId === chat.id && !x.system && !x.viewOnce && !lockedFor(x, me)
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
      // (a voice channel has its own chat too, for the people talking in it)
      const channel = chat.kind === "group" ? (chat.channels.find((x) => x.id === url.searchParams.get("channel") && (x.kind === "text" || x.kind === "voice")) || firstText(chat)).id : null;
      const all = db.messages.filter((x) => x.chatId === chat.id && !expired(x) && (!before || x.createdAt < before) && (!channel || channelOf(chat, x) === channel));
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
      if (media?.sensitive) require("./sensitive").refuseSensitive([], [media]); // a photo of weapons, violence… isn't allowed
      const gifMedia = resolveGif(body, me);
      if (gifMedia) media = gifMedia;
      const extra = resolveExtras(body, me, chat); // a sticker or a sound (mine, the group's, or built-in)
      if (extra) media = extra;
      const found = body.postId ? findPost(body.postId) : null;
      const post = found && canView(found, me) ? found : null;
      if (post && post.userId !== me.id) { post.shares = (post.shares || 0) + 1; save("posts"); require("./realtime").broadcast({ type: "stats", id: post.id, likes: post.likes.length, dislikes: post.dislikes.length, views: post.views ?? post.viewedBy.length, comments: post.commentCount, reposts: post.reposts.length, cools: post.cools.length, shares: post.shares }); }
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
      // Sent with an effect (like iMessage): everyone sees it play when it arrives
      if (MSG_EFFECTS.includes(body.effect)) msg.effect = body.effect;
      if (msg.effect === "capsule") {
        const mins = [1, 5, 15, 60, 180, 1440, 10080].includes(Number(body.unlockIn)) ? Number(body.unlockIn) : 60;
        msg.unlockAt = new Date(Date.now() + mins * 60000).toISOString();
      }
      // Self-destruct: gone for everyone a minute after it's sent
      if (msg.effect === "selfdestruct") { const at = Date.now() + 60000; if (!msg.expiresAt || new Date(msg.expiresAt).getTime() > at) msg.expiresAt = new Date(at).toISOString(); }
      // View once: the others can open it one time, then it's gone (like Instagram)
      if (body.viewOnce) {
        if (post || commentRef || songRef || media?.sticker || media?.gif || media?.kind === "audio" || media?.kind === "file" || media?.shared) throw httpError(400, "View once works for text, photos and videos.");
        // "replay": each person can open it twice (like Instagram's "Allow replay")
        msg.viewOnce = { openedBy: [], ...(body.viewOnce === "replay" ? { max: 2, opens: {} } : {}) };
      }
      if (chat.kind === "group") {
        // (a game's replay goes where the game was)
        const replayFrom = body.replayOf ? db.messages.find((x) => x.id === body.replayOf && x.chatId === chat.id) : null;
        const ch = chat.channels.find((x) => x.id === (body.channelId || replayFrom?.channelId) && (x.kind === "text" || x.kind === "voice")) || firstText(chat);
        msg.channelId = ch.id;
      }
      db.messages.push(msg);
      if (!media?.sticker && !media?.gif && !media?.shared) claim(media, "message:" + msg.id);
      chat.lastAt = msg.createdAt;
      chat.reads = { ...(chat.reads || {}), [me.id]: msg.createdAt };
      save("messages");
      // @someone pings them (a notification), @everyone pings the whole group (anyone in it can use it)
      const pinged = new Set(msg.mentions.filter((id) => id !== me.id && chat.members.includes(id)));
      if (chat.kind === "group" && /(^|\s)@(everyone|here)\b/i.test(text)) {
        rateLimit("everyone:" + me.id + ":" + chat.id, 6, 10 * 60 * 1000, "You’ve pinged everyone a lot. Try again in a few minutes.");
        chat.members.forEach((id) => id !== me.id && pinged.add(id)); msg.everyone = true; save("messages");
      }
      save("chats");
      deliver(chat, msg);
      for (const id of pinged) notify(id, "chat-mention", me, { chatId: chat.id, group: chat.kind === "group" ? chat.name : null, text: text || "mentioned you" });
      sendJSON(res, 201, { message: messageView(msg, me) });
      return true;
    }

    // Open a view-once message: POST /api/chats/:id/messages/:messageId/open → its text or photo, one time only.
    // When everyone it was for has opened it, the content is deleted for good.
    if (m === "POST" && c === "messages" && d && parts[4] === "open" && parts.length === 5) {
      if (!isMember(chat, me)) throw httpError(403, "You’re not in this conversation.");
      const msg = db.messages.find((x) => x.id === d && x.chatId === chat.id);
      if (!msg?.viewOnce) throw httpError(404, "That message is gone.");
      if (msg.userId === me.id) throw httpError(400, "It’s for the others: you can’t open your own view-once message.");
      const max = msg.viewOnce.max || 1, opensOf = (id) => msg.viewOnce.opens?.[id] ?? (msg.viewOnce.openedBy.includes(id) ? 1 : 0);
      if (msg.viewOnce.gone || opensOf(me.id) >= max) throw httpError(410, "You’ve already opened it.");
      const content = { text: msg.text, media: msg.media ? { kind: msg.media.kind, url: msg.media.url, poster: msg.media.poster || null, width: msg.media.width || null, height: msg.media.height || null } : null };
      const before = opensOf(me.id);
      if (msg.viewOnce.opens) msg.viewOnce.opens[me.id] = before + 1;
      if (!msg.viewOnce.openedBy.includes(me.id)) msg.viewOnce.openedBy.push(me.id);
      const others = chat.members.filter((id) => id !== msg.userId);
      if (others.every((id) => opensOf(id) >= max)) {
        // Everyone saw it: delete it (a short moment later, so the photo can still load for the last person)
        msg.viewOnce.kind = msg.media ? msg.media.kind : "text";
        msg.viewOnce.gone = true;
        const media = msg.media;
        msg.text = ""; msg.media = null;
        if (media) msg.viewOnce.purge = { url: media.url, poster: media.poster || null, at: Date.now() + 60 * 1000 };
      }
      save("messages");
      for (const id of chat.members) {
        const u = findUser(id);
        if (u) sendTo([id], { type: "message:viewonce", chatId: chat.id, messageId: msg.id, message: messageView(msg, u) });
      }
      sendJSON(res, 200, content);
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

    // Who reacted: GET /api/chats/:id/messages/:messageId/reactions → [{ user, emoji, mine }]
    if (m === "GET" && c === "messages" && d && parts[4] === "reactions" && parts.length === 5) {
      if (!canRead(chat, me)) throw httpError(403, "You can’t see this conversation.");
      const msg = db.messages.find((x) => x.id === d && x.chatId === chat.id);
      if (!msg) throw httpError(404, "That message doesn’t exist.");
      const people = Object.entries(msg.reactions || {}).map(([id, emoji]) => ({ u: findUser(id), emoji })).filter((x) => x.u)
        .map((x) => ({ user: { ...authorView(x.u), nickname: nicknameOf(chat, x.u.id) }, emoji: x.emoji, mine: x.u.id === me.id }))
        .sort((a, b) => Number(b.mine) - Number(a.mine));
      sendJSON(res, 200, { reactions: people });
      return true;
    }

    // One message (e.g. a time capsule that just opened): GET /api/chats/:id/messages/:messageId
    if (m === "GET" && c === "messages" && d && parts.length === 4) {
      if (!isMember(chat, me) && !(chat.kind === "group" && chat.visibility === "public")) throw httpError(403, "Join to see this.");
      const msg = db.messages.find((x) => x.id === d && x.chatId === chat.id);
      if (!msg || (msg.expiresAt && new Date(msg.expiresAt) < new Date())) throw httpError(404, "That message is gone.");
      sendJSON(res, 200, { message: messageView(msg, me) });
      return true;
    }
    // Hype a message (like trending): POST /api/chats/:id/messages/:messageId/hype  (again takes it back)
    if (m === "POST" && c === "messages" && d && parts[4] === "hype" && parts.length === 5) {
      if (!isMember(chat, me)) throw httpError(403, "Join to hype messages.");
      const msg = db.messages.find((x) => x.id === d && x.chatId === chat.id);
      if (!msg || msg.system) throw httpError(404, "That message doesn’t exist.");
      rateLimit("hype:" + me.id, 120, 60 * 1000, "Easy on the hype!");
      msg.hypes = msg.hypes || [];
      const on = !msg.hypes.includes(me.id);
      if (on) msg.hypes.push(me.id); else msg.hypes = msg.hypes.filter((x) => x !== me.id);
      save("messages");
      sendTo(chat.members, { type: "message:hype", chatId: chat.id, messageId: msg.id, hypes: msg.hypes.length, by: me.username, on });
      // The author hears about it when their message gets hot
      if (on && msg.userId !== me.id && [1, 5, 10, 25, 50, 100].includes(msg.hypes.length)) {
        sendTo([msg.userId], { type: "message:hyped", chatId: chat.id, messageId: msg.id, hypes: msg.hypes.length, by: me.username });
      }
      sendJSON(res, 200, { hypes: msg.hypes.length, hypedByMe: on });
      return true;
    }
    // The chat's trending messages: GET /api/chats/:id/trending?channelId=&period=day|week|month|all
    if (m === "GET" && c === "trending" && parts.length === 3) {
      if (!isMember(chat, me) && !(chat.kind === "group" && chat.visibility === "public")) throw httpError(403, "Join to see this.");
      const H = { day: 24, week: 168, month: 720, all: 1e7 }[url.searchParams.get("period")] || 168;
      const from = Date.now() - H * 3600 * 1000, ch = url.searchParams.get("channelId");
      const list = db.messages.filter((x) => x.chatId === chat.id && (x.hypes || []).length && !x.system && (!ch || (x.channelId || null) === ch) && new Date(x.createdAt).getTime() >= from && !(x.expiresAt && new Date(x.expiresAt) < new Date()))
        .map((x) => ({ x, score: x.hypes.length / Math.pow((Date.now() - new Date(x.createdAt).getTime()) / 3600000 + 2, H <= 24 ? 1.2 : 0.6) }))
        .sort((a, b) => b.x.hypes.length - a.x.hypes.length || b.score - a.score).slice(0, 30);
      sendJSON(res, 200, { messages: list.map(({ x }) => messageView(x, me)) });
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

    /* ---------- Polls ---------- */
    // Start one: POST /api/chats/:id/polls { question, options, multi, anonymous, hours, channelId }
    if (m === "POST" && c === "polls" && parts.length === 3) {
      if (!isMember(chat, me)) throw httpError(403, "Join to start a poll.");
      if (chat.kind === "dm") { const other = findUser(chat.members.find((id) => id !== me.id)); if (!other || !mutual(me, other)) throw httpError(403, "You can send messages when you follow each other."); }
      rateLimit("chatpoll:" + me.id, 20, 10 * 60 * 1000, "That’s a lot of polls. Try again in a bit.");
      const body = await readJSON(req);
      const question = clean(body.question).replace(/\s+/g, " ").trim();
      const opts = (Array.isArray(body.options) ? body.options : []).map((o) => clean(o).replace(/\s+/g, " ").trim()).filter(Boolean);
      if (!question) throw httpError(400, "Ask a question.");
      if (chars(question) > 200) throw httpError(400, "Keep the question under 200 characters.");
      if (opts.length < 2) throw httpError(400, "Add at least 2 answers.");
      if (opts.length > 10) throw httpError(400, "A poll can have up to 10 answers.");
      if (opts.some((o) => chars(o) > 80)) throw httpError(400, "Keep each answer under 80 characters.");
      if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) throw httpError(400, "Each answer must be different.");
      require("./sensitive").refuseSensitive([question, ...opts], []);
      const hours = [1, 6, 24, 72, 168].includes(Number(body.hours)) ? Number(body.hours) : null;
      const poll = { question, options: opts.map((t) => ({ id: crypto.randomUUID().slice(0, 8), text: t, votes: [] })), multi: Boolean(body.multi), anonymous: Boolean(body.anonymous),
        endsAt: hours ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : null, by: me.id };
      const msg = { id: crypto.randomUUID(), chatId: chat.id, userId: me.id, text: "", media: null, postId: null, replyTo: null, mentions: [], poll, createdAt: new Date().toISOString() };
      if (chat.kind === "group") msg.channelId = (chat.channels.find((x) => x.id === body.channelId && x.kind === "text") || firstText(chat)).id;
      if (chat.vanish) msg.expiresAt = new Date(Date.now() + chat.vanish * 1000).toISOString();
      db.messages.push(msg);
      chat.lastAt = msg.createdAt;
      save("messages"); save("chats");
      deliver(chat, msg);
      sendJSON(res, 201, { message: messageView(msg, me) });
      return true;
    }
    // Vote: POST /api/chats/:id/messages/:messageId/vote { optionId }  (tap again to take it back; one answer unless it's multiple choice)
    // Close it: POST /api/chats/:id/messages/:messageId/vote { close: true }  (the one who asked, or a moderator)
    if (m === "POST" && c === "messages" && d && parts[4] === "vote" && parts.length === 5) {
      if (!isMember(chat, me)) throw httpError(403, "Join to vote.");
      const msg = db.messages.find((x) => x.id === d && x.chatId === chat.id && x.poll);
      if (!msg) throw httpError(404, "That poll is gone.");
      const p = msg.poll, body = await readJSON(req);
      if (body.close) {
        if (p.by !== me.id && !(chat.kind === "group" && can(chat, me, "delete_messages"))) throw httpError(403, "Only the person who asked can end the poll.");
        p.closed = true;
      } else {
        if (p.closed || (p.endsAt && Date.now() > new Date(p.endsAt).getTime())) throw httpError(400, "This poll has ended.");
        const opt = p.options.find((o) => o.id === body.optionId);
        if (!opt) throw httpError(400, "Pick one of the answers.");
        const had = opt.votes.includes(me.id);
        if (!p.multi) for (const o of p.options) o.votes = o.votes.filter((x) => x !== me.id);
        else opt.votes = opt.votes.filter((x) => x !== me.id);
        if (!had) opt.votes.push(me.id);
      }
      save("messages");
      pushPoll(chat, msg);
      sendJSON(res, 200, { poll: chatPollView(p, me, chat) });
      return true;
    }

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
          if (def.noBots) throw httpError(400, "Bots can’t draw or write stories — invite people instead!");
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

    /* ---------- Notes on messages ---------- */
    // POST /api/chats/:id/messages/:messageId/notes { text, color } · DELETE …/notes/:noteId
    if (c === "messages" && d && parts[4] === "notes") {
      if (!isMember(chat, me)) throw httpError(403, "Join to leave notes.");
      const msg = db.messages.find((x) => x.id === d && x.chatId === chat.id);
      if (!msg || msg.system) throw httpError(404, "That message doesn’t exist.");
      if (m === "POST" && parts.length === 5) {
        rateLimit("msgnote:" + me.id, 30, 60 * 1000, "Easy on the notes!");
        const body = await readJSON(req);
        const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 140);
        if (!text) throw httpError(400, "Write something on the note.");
        msg.notes = msg.notes || [];
        if (msg.notes.length >= 20) throw httpError(400, "This message is full of notes already.");
        msg.notes.push({ id: crypto.randomUUID().slice(0, 8), userId: me.id, text, color: MSG_NOTE_COLORS.includes(body.color) ? body.color : "yellow", at: new Date().toISOString() });
        save("messages");
        sendNotes(chat, msg);
        sendJSON(res, 201, { notes: notesView(msg, me) });
        return true;
      }
      if (m === "DELETE" && parts.length === 6) {
        const n = (msg.notes || []).find((x) => x.id === parts[5]);
        if (!n) throw httpError(404, "That note is gone.");
        if (n.userId !== me.id && !(chat.kind === "group" && can(chat, me, "delete_messages"))) throw httpError(403, "You can only remove your own notes.");
        msg.notes = msg.notes.filter((x) => x !== n);
        save("messages");
        sendNotes(chat, msg);
        sendJSON(res, 200, { notes: notesView(msg, me) });
        return true;
      }
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

    // The chat's wallpaper, for everyone in it: POST /api/chats/:id/wallpaper { preset } | { image, x, y, zoom, dim } | { clear: true }
    // (groups: people who can change the group)
    if (m === "POST" && c === "wallpaper" && parts.length === 3) {
      if (!chat.members.includes(me.id)) throw httpError(403, "Join to change the wallpaper.");
      if (chat.kind === "group" && !require("./groups").can(chat, me, "manage_group")) throw httpError(403, "Only people who can change the group can change its wallpaper.");
      const body = await readJSON(req);
      const WALLS = ["pink-night", "sunset", "ocean", "aurora", "hearts", "dots", "grid", "mono"];
      const old = chatWallpaper(chat);
      let next = null;
      if (body.image) {
        // A new photo, or the one already here (just moved, zoomed or darkened, maybe by someone else)
        const img = old?.image && old.image === body.image ? { url: old.image } : ownedMedia(body.image, me.id, "image");
        if (!img) throw httpError(400, "That photo couldn’t be found. Add it again.");
        if (img.url !== old?.image) markUsed(img.url, `wallpaper:${chat.id}`);
        // Where it was moved to, how far zoomed in, how dark
        const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
        next = { image: img.url, x: num(body.x, 0, 100, 50), y: num(body.y, 0, 100, 50), zoom: num(body.zoom, 1, 4, 1), dim: num(body.dim, 0, 0.8, 0.38) };
      } else if (WALLS.includes(body.preset)) next = { preset: body.preset };
      else if (!body.clear) throw httpError(400, "Pick a wallpaper.");
      if (old?.image && old.image !== next?.image) deleteMedia(old.image);
      const changed = (old?.image || old?.preset || null) !== (next?.image || next?.preset || null);
      chat.wallpaper = next;
      save("chats");
      sendTo(chat.members, { type: "chat:wallpaper", chatId: chat.id, wallpaper: next });
      // Only say so when it's a different background (not when it was just moved or zoomed)
      if (changed) systemMessage(chat, me, next ? `🖼️ ${me.name} changed the chat wallpaper` : `🖼️ ${me.name} removed the chat wallpaper`);
      sendJSON(res, 200, { wallpaper: next });
      return true;
    }

    // Disappearing messages: POST /api/chats/:id/vanish { seconds }  (0 = off; groups: people who can change the group)
    // New messages are deleted for everyone that long after they're sent.
    if (m === "POST" && c === "vanish" && parts.length === 3) {
      if (!isMember(chat, me)) throw httpError(403, "Join to change this.");
      if (chat.kind === "group" && !require("./groups").can(chat, me, "manage_group")) throw httpError(403, "Only people who can change the group can turn on disappearing messages.");
      const seconds = Number((await readJSON(req)).seconds) || 0;
      if (!(seconds in VANISH)) throw httpError(400, "Pick a time.");
      if ((chat.vanish || 0) !== seconds) {
        chat.vanish = seconds || undefined;
        if (!seconds) delete chat.vanish;
        save("chats");
        sendTo(chat.members, { type: "chat:vanish", chatId: chat.id, vanish: seconds });
        systemMessage(chat, me, seconds ? `⏳ ${me.name} turned on disappearing messages: new messages disappear after ${VANISH[seconds]}` : `⏳ ${me.name} turned off disappearing messages`);
      }
      sendJSON(res, 200, { vanish: seconds });
      return true;
    }

    // The chat's theme, for everyone in it: POST /api/chats/:id/theme { theme }  (groups: people who can change the group)
    if (m === "POST" && c === "theme" && parts.length === 3) {
      if (!chat.members.includes(me.id)) throw httpError(403, "Join to change the theme.");
      if (chat.kind === "group" && !require("./groups").can(chat, me, "manage_group")) throw httpError(403, "Only people who can change the group can change its theme.");
      const THEMES = { pink: "Pink", berry: "Berry", ocean: "Ocean", mint: "Mint", sunset: "Sunset", fire: "Fire", gold: "Gold", galaxy: "Galaxy", mono: "Mono" };
      const theme = String((await readJSON(req)).theme || "");
      if (!THEMES[theme]) throw httpError(400, "Pick a theme.");
      chat.theme = theme === "pink" ? null : theme;
      save("chats");
      sendTo(chat.members, { type: "chat:theme", chatId: chat.id, theme: chat.theme });
      systemMessage(chat, me, `🎨 ${me.name} changed the theme to ${THEMES[theme]}`);
      sendJSON(res, 200, { theme: chat.theme });
      return true;
    }
    // The group's photo: POST /api/chats/:id/photo { image }
    if (m === "POST" && c === "photo" && parts.length === 3) {
      if (chat.kind !== "group") throw httpError(400, "Only groups have a photo.");
      if (!require("./groups").can(chat, me, "manage_group")) throw httpError(403, "You don’t have permission to change the group.");
      const img = ownedMedia((await readJSON(req)).image, me.id, "image");
      if (!img) throw httpError(400, "That photo couldn’t be found. Add it again.");
      if (chat.cover && chat.cover !== img.url) deleteMedia(chat.cover);
      markUsed(img.url, "group:" + chat.id);
      chat.cover = img.url;
      save("chats");
      sendTo(chat.members, { type: "group:changed", chatId: chat.id, what: "photo" });
      systemMessage(chat, me, `📷 ${me.name} changed the group photo`);
      sendJSON(res, 200, { cover: chat.cover });
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

      // Just the colour: POST /api/groups/:id/color { color }  (people who can change the group)
      if (m === "POST" && parts[2] === "color" && parts.length === 3) {
        if (!can(chat, me, "manage_group")) throw httpError(403, "Only people who can change the group can change its colour.");
        const body = await readJSON(req);
        const color = String(body.color || "");
        if (!COLOR_RE.test(color)) throw httpError(400, "Pick a colour.");
        chat.color = color.toLowerCase();
        // A gradient too (2–4 colours and a direction): the colour above is its first one, for small things like icons
        const grad = String(body.gradient || "");
        if (/^grad:#[0-9a-f]{6}(,#[0-9a-f]{6}){1,3}@\d{1,3}$/i.test(grad) && Number(grad.split("@")[1]) <= 360) chat.colorGrad = grad.toLowerCase();
        else delete chat.colorGrad;
        save("chats");
        sendTo(chat.members, { type: "group:color", chatId: chat.id, color: chat.color, gradient: chat.colorGrad || null });
        sendTo(chat.members, { type: "group:changed", chatId: chat.id, what: "group" });
        systemMessage(chat, me, `🎨 ${me.name} changed the group colour`);
        sendJSON(res, 200, { color: chat.color, gradient: chat.colorGrad || null });
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

module.exports = { handleChat, streakOf, sweepVanished, deliverMessage: (chat, msg) => deliver(chat, msg) };
