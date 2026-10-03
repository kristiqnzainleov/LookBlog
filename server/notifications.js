// Notifications: stored per person, delivered live, read from the bell in the top bar.

const crypto = require("crypto");
const { db, save, findUser, findPost } = require("./db");
const { sendJSON } = require("./http");
const { sendTo } = require("./realtime");

const KEEP = 200; // per person

function snippet(text, n = 80) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function view(n) {
  const actor = findUser(n.actorId);
  const found = n.postId ? findPost(n.postId) : null;
  const post = found && (found.visibility !== "private" || found.userId === n.userId) ? found : null;
  return {
    id: n.id,
    type: n.type,
    actor: actor ? { name: actor.name, username: actor.username, avatar: actor.avatar } : { name: "Someone", username: "", avatar: null },
    postId: post ? post.id : null,
    postType: post ? post.type : null,
    postText: post ? snippet(post.title || post.text) : null,
    thumb: post?.media?.[0] ? (post.media[0].kind === "image" ? post.media[0].url : post.media[0].poster || null) : null,
    emoji: n.emoji || null,
    text: n.text || null,
    chatId: n.chatId || null,
    group: n.group || null,
    code: n.code || null,
    eventId: n.eventId || null,
    streamId: n.streamId || null,
    createdAt: n.createdAt,
    read: Boolean(n.read),
  };
}

/*
  notify(recipientId, type, actor, { postId, emoji, text })
  types: follow, mention, comment, answer, reaction, cool, repost, upload
*/
function notify(recipientId, type, actor, extra = {}) {
  if (!recipientId || (recipientId === actor.id && type !== "badge")) return;
  const to = findUser(recipientId);
  if (!to) return;
  // Nothing from people you blocked (or who blocked you)
  if ((to.blocked || []).includes(actor.id) || (actor.blocked || []).includes(to.id)) return;
  // Don't stack the same thing twice (e.g. follow, unfollow, follow)
  const dup = db.notifications.find((n) => n.userId === recipientId && n.type === type && n.actorId === actor.id && n.postId === (extra.postId || null) && !n.read
    && Date.now() - new Date(n.createdAt).getTime() < 60 * 60 * 1000);
  if (dup && ["follow", "cool", "repost", "reaction"].includes(type)) {
    dup.createdAt = new Date().toISOString();
    if (extra.emoji) dup.emoji = extra.emoji;
    save("notifications");
    return;
  }
  const n = {
    id: crypto.randomUUID(),
    userId: recipientId,
    type,
    actorId: actor.id,
    postId: extra.postId || null,
    emoji: extra.emoji || null,
    text: extra.text ? snippet(extra.text) : null,
    chatId: extra.chatId || null, // groups: events and invites
    group: extra.group || null,
    code: extra.code || null,
    eventId: extra.eventId || null, // public events
    streamId: extra.streamId || null, // live streams
    createdAt: new Date().toISOString(),
    read: false,
  };
  db.notifications.push(n);
  // Keep only the newest ones per person
  const mine = db.notifications.filter((x) => x.userId === recipientId);
  if (mine.length > KEEP) {
    const drop = new Set(mine.slice(0, mine.length - KEEP).map((x) => x.id));
    db.notifications = db.notifications.filter((x) => !drop.has(x.id));
  }
  save("notifications");
  sendTo([recipientId], { type: "notification", notification: view(n), unread: unreadCount(recipientId) });
}

function unreadCount(userId) {
  return db.notifications.filter((n) => n.userId === userId && !n.read).length;
}

async function handleNotifications(req, res, url, me) {
  if (req.method === "GET" && url.pathname === "/api/notifications") {
    const list = db.notifications.filter((n) => n.userId === me.id).slice(-60).reverse().map(view);
    sendJSON(res, 200, { notifications: list, unread: unreadCount(me.id) });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/notifications/read") {
    let changed = false;
    for (const n of db.notifications) if (n.userId === me.id && !n.read) { n.read = true; changed = true; }
    if (changed) save("notifications");
    sendJSON(res, 200, { unread: 0 });
    return true;
  }
  return false;
}

module.exports = { notify, handleNotifications };
