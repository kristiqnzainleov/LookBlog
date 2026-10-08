// Groups work a bit like Discord servers: text and voice channels, roles with permissions,
// nicknames, a colour, and events. The owner can do everything.

const crypto = require("crypto");
const { db, save, findUser, findByUsername, onLoad } = require("./db");
const { sendJSON, httpError, readJSON } = require("./http");
const { sendTo } = require("./realtime");
const { notify } = require("./notifications");
const { ownedMedia, markUsed, deleteMedia } = require("./media");
const { rateLimit } = require("./http");
const { every } = require("./ticker");

const PERMS = {
  manage_group: "Change the name, picture, colour and who can see the group",
  manage_channels: "Create, rename and delete channels",
  manage_roles: "Create roles and give them to people",
  manage_events: "Create and remove events",
  kick: "Remove people from the group",
  delete_messages: "Delete other people’s messages",
  manage_nicknames: "Change other people’s nicknames",
  manage_sounds: "Add and remove the group’s sounds and stickers",
  pin_messages: "Pin and unpin messages",
  mention_everyone: "Ping the whole group with @everyone",
};
const ALL = Object.keys(PERMS);
const BUILTIN_ROLES = [
  { id: "coowner", name: "Co-owner", color: "#ffcc33", perms: ALL, builtin: true },
  { id: "admin", name: "Admin", color: "#ff4fa3", perms: ALL.filter((p) => p !== "manage_roles"), builtin: true },
  { id: "mod", name: "Moderator", color: "#66d1ff", perms: ["manage_events", "kick", "delete_messages", "manage_nicknames"], builtin: true },
];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const id8 = () => crypto.randomUUID().slice(0, 8);

// Bring a group up to the current shape (older groups had none of this)
function ensureGroup(chat) {
  if (chat.kind !== "group") return chat;
  let changed = false;
  if (!Array.isArray(chat.channels) || !chat.channels.length) {
    chat.channels = [{ id: "general", name: "general", kind: "text" }, { id: "lounge", name: "Lounge", kind: "voice" }];
    changed = true;
  }
  if (!Array.isArray(chat.roles)) { chat.roles = BUILTIN_ROLES.map((r) => ({ ...r, perms: [...r.perms] })); changed = true; }
  // New permissions reach the built-in Co-owner and Admin roles of older groups
  for (const r of chat.roles) {
    if (!r.builtin || (r.id !== "coowner" && r.id !== "admin")) continue;
    const missing = ["mention_everyone"].filter((p) => !r.perms.includes(p) && !(r.seenPerms || []).includes(p));
    if (missing.length) { r.perms.push(...missing); r.seenPerms = [...(r.seenPerms || []), ...missing]; changed = true; }
  }
  if (!chat.memberRoles) { chat.memberRoles = {}; changed = true; }
  if (!chat.nicknames) { chat.nicknames = {}; changed = true; }
  if (!Array.isArray(chat.events)) { chat.events = []; changed = true; }
  if (!chat.color) { chat.color = "#ff4fa3"; changed = true; }
  if (!Array.isArray(chat.sounds)) { chat.sounds = []; changed = true; }
  if (!Array.isArray(chat.stickers)) { chat.stickers = []; changed = true; }
  // Newer permissions for the built-in roles
  for (const r of chat.roles) {
    if ((r.id === "coowner" || r.id === "admin") && !r.perms.includes("manage_sounds")) { r.perms.push("manage_sounds"); changed = true; }
    if (["coowner", "admin", "mod"].includes(r.id) && !r.perms.includes("pin_messages")) { r.perms.push("pin_messages"); changed = true; }
  }
  if (changed) save("chats");
  return chat;
}
onLoad(() => { for (const c of db.chats) ensureGroup(c); });

const firstText = (chat) => chat.channels.find((c) => c.kind === "text");
function rolesOfMember(chat, userId) {
  return (chat.memberRoles?.[userId] || []).map((id) => chat.roles.find((r) => r.id === id)).filter(Boolean);
}
function can(chat, user, perm) {
  if (!user || !chat.members.includes(user.id)) return false;
  if (chat.ownerId === user.id) return true;
  return rolesOfMember(chat, user.id).some((r) => r.perms.includes(perm));
}
const permsOf = (chat, user) => ALL.filter((p) => can(chat, user, p));
// "Rank": owner 3, co-owner 2, anyone with a role that has permissions 1, everyone else 0.
// You can only act on (kick, rename, change roles of) people below you.
function rank(chat, userId) {
  if (chat.ownerId === userId) return 3;
  const r = rolesOfMember(chat, userId);
  if (r.some((x) => x.id === "coowner")) return 2;
  if (r.some((x) => x.perms.length)) return 1;
  return 0;
}
const nicknameOf = (chat, userId) => chat?.nicknames?.[userId] || null;

function roleView(r) { return { id: r.id, name: r.name, color: r.color, perms: r.perms, builtin: Boolean(r.builtin) }; }
function eventView(chat, ev, me) {
  const by = findUser(ev.createdBy);
  return {
    id: ev.id, title: ev.title, description: ev.description, startsAt: ev.startsAt, channelId: ev.channelId || null,
    by: by ? { name: by.name, username: by.username } : null,
    going: ev.going.length, goingNames: ev.going.map((id) => findUser(id)?.name).filter(Boolean).slice(0, 12),
    mine: ev.going.includes(me.id), canDelete: ev.createdBy === me.id || can(chat, me, "manage_events"),
  };
}

// Extra fields for the group view
function groupExtras(chat, me, voiceRooms) {
  ensureGroup(chat);
  const now = Date.now();
  return {
    color: chat.color,
    colorGrad: chat.colorGrad || null,
    channels: chat.channels.map((c) => ({ ...c, voice: c.kind === "voice" ? voiceRooms(chat.id, c.id) : undefined,
      // A voice channel's status (like Discord: "🎮 Playing Valorant"), set by the people in it
      voiceStatus: c.kind === "voice" ? db.voice?.[chat.id + ":" + c.id]?.status || null : undefined })),
    pinnedChannels: (me.channelPins?.[chat.id] || []).filter((id) => chat.channels.some((c) => c.id === id)), // channels I pinned to the top
    myStatus: chat.memberStatus?.[me.id] || null,
    roles: chat.roles.map(roleView),
    perms: permsOf(chat, me),
    allPerms: PERMS,
    myRank: rank(chat, me.id),
    sounds: (chat.sounds || []).map((x) => ({ id: x.id, name: x.name, emoji: x.emoji, url: x.url })),
    stickers: (chat.stickers || []).map((x) => ({ id: x.id, url: x.url })),
    events: chat.events.filter((e) => new Date(e.startsAt).getTime() > now - 6 * 3600 * 1000)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((e) => eventView(chat, e, me)),
  };
}
function memberExtras(chat, u) {
  return { roles: (chat.memberRoles?.[u.id] || []), nickname: nicknameOf(chat, u.id), rank: rank(chat, u.id), groupStatus: chat.memberStatus?.[u.id] || null };
}

const tell = (chat, what) => sendTo(chat.members, { type: "group:changed", chatId: chat.id, what });

function cleanName(v, max) { return String(v || "").trim().replace(/\s+/g, " ").slice(0, max * 2); }
const len = (s) => [...s].length;

/* ---------- Event reminders: people who are going hear when it starts ---------- */
every(() => {
  const now = Date.now();
  let changed = false;
  for (const chat of db.chats) for (const ev of chat.events || []) {
    const t = new Date(ev.startsAt).getTime();
    if (ev.reminded || t > now + 10 * 60 * 1000 || t < now - 30 * 60 * 1000) continue;
    ev.reminded = true;
    changed = true;
    const by = findUser(ev.createdBy);
    if (!by) continue;
    for (const id of ev.going) if (chat.members.includes(id)) notify(id, "event-start", by, { text: ev.title, chatId: chat.id, group: chat.name });
  }
  // When it starts: everyone in the group hears about it
  for (const chat of db.chats) for (const ev of chat.events || []) {
    const t = new Date(ev.startsAt).getTime();
    if (ev.startNotified || t > now || t < now - 60 * 60 * 1000) continue;
    ev.startNotified = true;
    changed = true;
    const by = findUser(ev.createdBy);
    if (!by) continue;
    for (const id of chat.members) notify(id, "event-now", by, { text: ev.title, chatId: chat.id, group: chat.name });
    sendTo(chat.members, { type: "event:now", title: ev.title, chatId: chat.id, group: chat.name });
  }
  if (changed) save("chats");
}, 60 * 1000).unref();

/* ---------- Invites ---------- */
const CODE_CHARS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.randomBytes(8), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
function liveInvite(code) {
  for (const chat of db.chats) {
    const inv = (chat.invites || []).find((i) => i.code === code);
    if (!inv) continue;
    if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) return null;
    if (inv.maxUses && inv.uses >= inv.maxUses) return null;
    return { chat, inv };
  }
  return null;
}
function makeInvite(chat, me, { days = 7, maxUses = 0 } = {}) {
  chat.invites = (chat.invites || []).filter((i) => !i.expiresAt || new Date(i.expiresAt).getTime() > Date.now());
  const inv = { code: newCode(), by: me.id, createdAt: new Date().toISOString(), uses: 0,
    maxUses: Math.max(0, Math.min(100, Number(maxUses) || 0)),
    expiresAt: days ? new Date(Date.now() + Math.min(30, Number(days)) * 86400000).toISOString() : null };
  chat.invites.push(inv);
  if (chat.invites.length > 50) chat.invites.splice(0, chat.invites.length - 50);
  save("chats");
  return inv;
}
const inviteView = (inv) => ({ code: inv.code, url: "/invite/" + inv.code, uses: inv.uses, maxUses: inv.maxUses || null, expiresAt: inv.expiresAt });
function groupPreview(chat, me, presence) {
  return {
    id: chat.id, name: chat.name, description: chat.description, cover: chat.cover, banner: chat.banner || null, color: chat.color, colorGrad: chat.colorGrad || null, kind: "group",
    memberCount: chat.members.length, onlineCount: chat.members.filter((id) => presence(id).online).length,
    visibility: chat.visibility, member: chat.members.includes(me.id),
  };
}
// GET /api/invites/:code  ·  POST /api/invites/:code/accept
async function handleInvites(req, res, me, parts, { presence, onJoined }) {
  const [, code, action] = parts;
  const found = liveInvite(String(code || ""));
  if (!found) throw httpError(404, "This invite is invalid or has expired.");
  const { chat, inv } = found;
  const by = findUser(inv.by);
  if (req.method === "GET" && !action) {
    sendJSON(res, 200, { group: groupPreview(chat, me, presence), by: by ? { name: by.name, username: by.username, avatar: by.avatar } : null });
    return true;
  }
  if (req.method === "POST" && action === "accept") {
    if (!chat.members.includes(me.id)) {
      chat.members.push(me.id);
      chat.reads = { ...(chat.reads || {}), [me.id]: new Date().toISOString() };
      inv.uses++;
      save("chats");
      onJoined(chat);
    }
    sendJSON(res, 200, { chatId: chat.id });
    return true;
  }
  return false;
}

/* ---------- Routes: /api/groups/:id/... (and nicknames in any chat) ---------- */
async function handleGroupRoutes(req, res, me, chat, parts, helpers) {
  const [, , c, d, e] = parts;
  const m = req.method;
  const need = (perm, msg) => { if (!can(chat, me, perm)) throw httpError(403, msg || "You don’t have permission to do that."); };

  // My status in this group (each group its own): POST /api/groups/:id/my-status { emoji, text }  (empty = cleared)
  if (m === "POST" && c === "my-status" && parts.length === 3) {
    if (!chat.members.includes(me.id)) throw httpError(403, "Join the group first.");
    const body = await readJSON(req);
    const text = String(body.text || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const emoji = typeof body.emoji === "string" && body.emoji.length <= 16 && /\p{Extended_Pictographic}/u.test(body.emoji) ? body.emoji : "";
    chat.memberStatus = chat.memberStatus || {};
    if (text || emoji) chat.memberStatus[me.id] = { emoji, text }; else delete chat.memberStatus[me.id];
    save("chats");
    tell(chat, "members");
    sendJSON(res, 200, { status: chat.memberStatus[me.id] || null });
    return true;
  }
  // Pin a channel to the top of my list (or unpin it): POST /api/groups/:id/pin-channel { channelId }
  if (m === "POST" && c === "pin-channel" && parts.length === 3) {
    const id = String((await readJSON(req)).channelId || "");
    if (!chat.channels.some((x) => x.id === id)) throw httpError(404, "That channel doesn’t exist.");
    me.channelPins = me.channelPins || {};
    const list = (me.channelPins[chat.id] || []).filter((x) => chat.channels.some((ch) => ch.id === x));
    me.channelPins[chat.id] = list.includes(id) ? list.filter((x) => x !== id) : [id, ...list].slice(0, 10);
    if (!me.channelPins[chat.id].length) delete me.channelPins[chat.id];
    save("users");
    sendJSON(res, 200, { pinned: me.channelPins[chat.id] || [] });
    return true;
  }

  // Nicknames: POST /api/chats/:id/nickname { username, nickname }  (DMs and groups)
  if (m === "POST" && c === "nickname" && parts.length === 3) {
    if (!chat.members.includes(me.id)) throw httpError(403, "You’re not in this conversation.");
    const body = await readJSON(req);
    const user = findByUsername(String(body.username || ""));
    if (!user || !chat.members.includes(user.id)) throw httpError(404, "That person isn’t here.");
    const nick = cleanName(body.nickname, 32);
    if (len(nick) > 32) throw httpError(400, "Keep nicknames under 32 characters.");
    if (chat.kind === "dm" && user.id === me.id) throw httpError(403, "In a direct chat, only the other person can give you a nickname.");
    if (chat.kind === "group" && user.id !== me.id) {
      need("manage_nicknames", "You can only change your own nickname.");
      if (rank(chat, user.id) >= rank(chat, me.id) && chat.ownerId !== me.id) throw httpError(403, "You can’t change their nickname.");
    }
    chat.nicknames = chat.nicknames || {};
    if (nick) chat.nicknames[user.id] = nick; else delete chat.nicknames[user.id];
    save("chats");
    sendTo(chat.members, { type: "chat:nicknames", chatId: chat.id });
    if (chat.kind === "dm") helpers.systemMessage(chat, me, nick ? `${me.name} called ${user.name} “${nick}”` : `${me.name} removed ${user.name}’s nickname`);
    sendJSON(res, 200, { ok: true, nickname: nick || null });
    return true;
  }

  if (chat.kind !== "group") return false;
  ensureGroup(chat);
  if (!chat.members.includes(me.id) && m !== "GET") return false;

  /* Invites */
  // POST /api/groups/:id/invites { days, maxUses }  → a link anyone can use
  if (m === "POST" && c === "invites" && parts.length === 3) {
    rateLimit("invite:" + me.id, 40, 60 * 60 * 1000, "You’ve made a lot of invites. Try again later.");
    const body = await readJSON(req);
    sendJSON(res, 201, { invite: inviteView(makeInvite(chat, me, { days: body.days ?? 7, maxUses: body.maxUses })) });
    return true;
  }
  // POST /api/groups/:id/invite-people { usernames: [...] }  → a notification (and a DM if you follow each other)
  if (m === "POST" && c === "invite-people" && parts.length === 3) {
    rateLimit("invitePeople:" + me.id, 60, 60 * 60 * 1000, "You’ve invited a lot of people. Try again later.");
    const names = [...new Set((await readJSON(req)).usernames || [])].slice(0, 20);
    let inv = (chat.invites || []).find((i) => i.by === me.id && !i.maxUses && i.expiresAt && new Date(i.expiresAt).getTime() > Date.now() + 86400000);
    if (!inv) inv = makeInvite(chat, me, { days: 7 });
    const sent = [], chats = {};
    for (const n of names) {
      const u = findByUsername(String(n));
      if (!u || u.id === me.id || chat.members.includes(u.id)) continue;
      notify(u.id, "invite", me, { text: chat.description || chat.name, chatId: chat.id, group: chat.name, code: inv.code });
      const dmId = helpers.dmInvite?.(me, u, chat, inv.code);
      if (dmId) chats[u.username] = dmId;
      sent.push(u.username);
    }
    sendJSON(res, 200, { sent, chats, invite: inviteView(inv) });
    return true;
  }

  /* Group stickers: POST /api/groups/:id/stickers { url } · DELETE /api/groups/:id/stickers/:sid */
  if (c === "stickers" && m === "POST" && parts.length === 3) {
    need("manage_sounds", "Ask an admin to add stickers.");
    const body = await readJSON(req);
    const file = ownedMedia(body.url, me.id, "image");
    if (!file) throw httpError(400, "That picture couldn’t be found. Upload it again.");
    if (chat.stickers.length >= 60) throw httpError(400, "A group can have up to 60 stickers.");
    markUsed(file.url, "gsticker:" + chat.id);
    chat.stickers.unshift({ id: id8(), url: file.url, by: me.id, createdAt: new Date().toISOString() });
    save("chats");
    tell(chat, "stickers");
    sendJSON(res, 201, { stickers: chat.stickers.map((x) => ({ id: x.id, url: x.url })) });
    return true;
  }
  if (c === "stickers" && m === "DELETE" && d && parts.length === 4) {
    const st = chat.stickers.find((x) => x.id === d);
    if (!st) throw httpError(404, "That sticker is gone.");
    if (st.by !== me.id) need("manage_sounds");
    chat.stickers = chat.stickers.filter((x) => x !== st);
    if (!db.messages.some((x) => x.media?.url === st.url)) deleteMedia(st.url);
    save("chats");
    tell(chat, "stickers");
    sendJSON(res, 200, { stickers: chat.stickers.map((x) => ({ id: x.id, url: x.url })) });
    return true;
  }
  /* Soundboard */
  // POST /api/groups/:id/sounds { name, emoji, url }  ·  DELETE /api/groups/:id/sounds/:sid
  if (c === "sounds" && m === "POST" && parts.length === 3) {
    need("manage_sounds", "Ask an admin to add sounds.");
    const body = await readJSON(req);
    const name = cleanName(body.name, 24);
    if (!name || len(name) > 24) throw httpError(400, "Give the sound a name (up to 24 characters).");
    let emoji = String(body.emoji || "").trim();
    if (!emoji || len(emoji) > 4 || !/\p{Extended_Pictographic}/u.test(emoji)) emoji = "🔊";
    const file = ownedMedia(body.url, me.id, "audio");
    if (!file) throw httpError(400, "That sound couldn’t be found. Upload it again.");
    const size = db.uploads[file.url.replace("/media/", "")]?.size || 0;
    if (size > 2 * 1024 * 1024) throw httpError(400, "Keep sounds short (under 2 MB).");
    if (chat.sounds.length >= 40) throw httpError(400, "A group can have up to 40 sounds.");
    markUsed(file.url, "sound:" + chat.id);
    const snd = { id: id8(), name, emoji, url: file.url, by: me.id, createdAt: new Date().toISOString() };
    chat.sounds.push(snd);
    save("chats");
    tell(chat, "sounds");
    sendJSON(res, 201, { sound: { id: snd.id, name, emoji, url: snd.url } });
    return true;
  }
  if (c === "sounds" && m === "DELETE" && d && parts.length === 4) {
    const snd = chat.sounds.find((x) => x.id === d);
    if (!snd) throw httpError(404, "That sound is gone.");
    if (snd.by !== me.id) need("manage_sounds");
    chat.sounds = chat.sounds.filter((x) => x !== snd);
    deleteMedia(snd.url);
    save("chats");
    tell(chat, "sounds");
    sendJSON(res, 200, { ok: true });
    return true;
  }

  /* Channels */
  // POST /api/groups/:id/channels { name, kind }
  if (m === "POST" && c === "channels" && parts.length === 3) {
    need("manage_channels");
    const body = await readJSON(req);
    const kind = body.kind === "voice" ? "voice" : "text";
    let name = cleanName(body.name, 30);
    if (kind === "text") name = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
    if (!name || len(name) > 30) throw httpError(400, "Give the channel a name (up to 30 characters).");
    if (chat.channels.length >= 30) throw httpError(400, "A group can have up to 30 channels.");
    const ch = { id: id8(), name, kind };
    chat.channels.push(ch);
    save("chats");
    tell(chat, "channels");
    sendJSON(res, 201, { channel: ch });
    return true;
  }
  // POST /api/groups/:id/channels/:cid { name }   ·   DELETE /api/groups/:id/channels/:cid
  if (c === "channels" && d && parts.length === 4 && (m === "POST" || m === "DELETE")) {
    need("manage_channels");
    const ch = chat.channels.find((x) => x.id === d);
    if (!ch) throw httpError(404, "That channel doesn’t exist.");
    if (m === "POST") {
      let name = cleanName((await readJSON(req)).name, 30);
      if (ch.kind === "text") name = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
      if (!name || len(name) > 30) throw httpError(400, "Give the channel a name (up to 30 characters).");
      ch.name = name;
    } else {
      if (ch.kind === "text" && chat.channels.filter((x) => x.kind === "text").length === 1) throw httpError(400, "A group needs at least one text channel.");
      chat.channels = chat.channels.filter((x) => x !== ch);
      if (ch.kind === "text") helpers.deleteChannelMessages(chat, ch.id);
    }
    save("chats");
    tell(chat, "channels");
    sendJSON(res, 200, { ok: true });
    return true;
  }

  /* Roles */
  // POST /api/groups/:id/roles { name, color, perms }  ·  POST /roles/:rid {…}  ·  DELETE /roles/:rid
  if (c === "roles" && (m === "POST" || m === "DELETE")) {
    need("manage_roles");
    if (m === "DELETE") {
      const r = chat.roles.find((x) => x.id === d);
      if (!r || r.builtin) throw httpError(400, "That role can’t be removed.");
      chat.roles = chat.roles.filter((x) => x !== r);
      for (const k of Object.keys(chat.memberRoles)) chat.memberRoles[k] = chat.memberRoles[k].filter((x) => x !== r.id);
    } else {
      const body = await readJSON(req);
      const name = cleanName(body.name, 24);
      if (!name || len(name) > 24) throw httpError(400, "Give the role a name (up to 24 characters).");
      const color = COLOR_RE.test(body.color || "") ? body.color : "#9b9494";
      const perms = (Array.isArray(body.perms) ? body.perms : []).filter((p) => ALL.includes(p));
      if (d) {
        const r = chat.roles.find((x) => x.id === d);
        if (!r) throw httpError(404, "That role doesn’t exist.");
        if (r.id === "coowner" && chat.ownerId !== me.id) throw httpError(403, "Only the owner can change the Co-owner role.");
        Object.assign(r, { name, color, perms: r.id === "coowner" ? ALL : perms });
      } else {
        if (chat.roles.length >= 25) throw httpError(400, "A group can have up to 25 roles.");
        chat.roles.push({ id: id8(), name, color, perms });
      }
    }
    save("chats");
    tell(chat, "roles");
    sendJSON(res, 200, { roles: chat.roles.map(roleView) });
    return true;
  }
  // Give or take roles: POST /api/groups/:id/members/:username/roles { roles: [...] }
  if (m === "POST" && c === "members" && d && e === "roles" && parts.length === 5) {
    need("manage_roles");
    const user = findByUsername(decodeURIComponent(d));
    if (!user || !chat.members.includes(user.id)) throw httpError(404, "That person isn’t in the group.");
    if (user.id === chat.ownerId) throw httpError(400, "The owner already has every permission.");
    if (rank(chat, user.id) >= rank(chat, me.id)) throw httpError(403, "You can’t change roles for someone at your level or above.");
    const want = [...new Set((await readJSON(req)).roles || [])].filter((id) => chat.roles.some((r) => r.id === id));
    const had = chat.memberRoles[user.id] || [];
    // Only the owner can make (or unmake) co-owners
    if (chat.ownerId !== me.id && want.includes("coowner") !== had.includes("coowner")) throw httpError(403, "Only the owner can make someone a co-owner.");
    chat.memberRoles[user.id] = want;
    save("chats");
    tell(chat, "members");
    sendJSON(res, 200, { roles: want });
    return true;
  }

  /* Events */
  // POST /api/groups/:id/events { title, description, startsAt, channelId }
  if (m === "POST" && c === "events" && parts.length === 3) {
    need("manage_events", "Ask an admin to create events.");
    const body = await readJSON(req);
    const title = cleanName(body.title, 80);
    const description = String(body.description || "").trim().slice(0, 1000);
    const when = new Date(body.startsAt);
    if (!title || len(title) > 80) throw httpError(400, "Give the event a title (up to 80 characters).");
    if (isNaN(when) || when.getTime() < Date.now() - 60 * 1000) throw httpError(400, "Pick a time in the future.");
    const channelId = chat.channels.some((x) => x.id === body.channelId) ? body.channelId : null;
    const ev = { id: id8(), title, description, startsAt: when.toISOString(), channelId, createdBy: me.id, going: [me.id], createdAt: new Date().toISOString() };
    chat.events.push(ev);
    if (chat.events.length > 100) chat.events.splice(0, chat.events.length - 100);
    save("chats");
    tell(chat, "events");
    helpers.systemMessage(chat, me, `📅 New event: ${title}`, { event: ev.id });
    // Everyone in the group hears about it
    const whenText = when.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    for (const id of chat.members) if (id !== me.id) notify(id, "event", me, { text: `${title} · ${whenText}`, chatId: chat.id, group: chat.name });
    sendJSON(res, 201, { event: eventView(chat, ev, me) });
    return true;
  }
  // RSVP: POST /api/groups/:id/events/:eid/going   ·   DELETE /api/groups/:id/events/:eid
  if (c === "events" && d) {
    const ev = chat.events.find((x) => x.id === d);
    if (!ev) throw httpError(404, "That event is gone.");
    if (m === "POST" && e === "going") {
      ev.going = ev.going.includes(me.id) ? ev.going.filter((x) => x !== me.id) : [...ev.going, me.id];
    } else if (m === "DELETE" && parts.length === 4) {
      if (ev.createdBy !== me.id) need("manage_events");
      chat.events = chat.events.filter((x) => x !== ev);
    } else return false;
    save("chats");
    tell(chat, "events");
    sendJSON(res, 200, { event: chat.events.includes(ev) ? eventView(chat, ev, me) : null });
    return true;
  }
  return false;
}

module.exports = { handleInvites, PERMS, ensureGroup, can, rank, permsOf, groupExtras, memberExtras, nicknameOf, firstText, handleGroupRoutes, COLOR_RE };
