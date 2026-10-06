// Instants (like Instagram): a quick photo taken with the phone's camera, sent to your friends
// (people you follow and who follow you back). Each friend sees it once, then it's gone for them.
// Unseen ones disappear after 24 hours; you can see your own (and who saw them) for those 24 hours too.
const crypto = require("crypto");
const { db, save, findUser } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { markUsed, deleteMedia, ownedMedia } = require("./media");
const { sendTo } = require("./realtime");
const { authorView, clean, chars } = require("./social");
const { every } = require("./ticker");

const DAY = 24 * 60 * 60 * 1000;
const REACTIONS = ["😂", "😍", "🔥", "😮", "👏", "❤️"];
const live = (x) => Date.now() - new Date(x.createdAt).getTime() < DAY;
const blocked = (a, b) => (a.blocked || []).includes(b.id) || (b.blocked || []).includes(a.id);
const friendsOf = (me) => me.following.map(findUser).filter((u) => u && u.following.includes(me.id) && !blocked(me, u));
// Is this instant for me? (sent by a friend while we were friends, still up, not seen yet)
const forMe = (x, me) => x.to.includes(me.id) && live(x) && !x.seenBy.includes(me.id);

function view(x, me) {
  const out = { id: x.id, url: x.url, caption: x.caption || "", createdAt: x.createdAt, expiresAt: new Date(new Date(x.createdAt).getTime() + DAY).toISOString(), user: authorView(findUser(x.userId)) };
  if (x.userId === me.id) {
    out.mine = true;
    out.seen = x.seenBy.map(findUser).filter(Boolean).map((u) => ({ ...authorView(u), reaction: x.reactions?.[u.id] || null }));
    out.sentTo = x.to.length;
  }
  return out;
}

// Gone after 24 hours (the photo too)
function sweep() {
  const old = db.instants.filter((x) => !live(x));
  if (!old.length) return;
  for (const x of old) deleteMedia(x.url);
  const gone = new Set(old.map((x) => x.id));
  db.instants = db.instants.filter((x) => !gone.has(x.id));
  save("instants");
}
every(sweep, 10 * 60 * 1000).unref();

// A reaction or reply goes to the sender as a direct message
function tellOwner(x, me, text, reaction) {
  const owner = findUser(x.userId);
  if (!owner) return;
  let chat = db.chats.find((ch) => ch.kind === "dm" && ch.members.includes(me.id) && ch.members.includes(owner.id));
  if (!chat) {
    chat = { id: crypto.randomUUID(), kind: "dm", members: [me.id, owner.id], createdAt: new Date().toISOString(), lastAt: new Date().toISOString(), reads: {} };
    db.chats.push(chat);
  }
  const msg = { id: crypto.randomUUID(), chatId: chat.id, userId: me.id, text: reaction || text, media: null, postId: null, replyTo: null, mentions: [],
    instantReply: { owner: owner.id, reaction: reaction || null }, createdAt: new Date().toISOString() };
  db.messages.push(msg);
  chat.lastAt = msg.createdAt;
  save("messages"); save("chats");
  require("./chat").deliverMessage(chat, msg);
}

async function handleInstants(req, res, url, me) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  if (parts[0] !== "instants") return false;
  const m = req.method;

  // My pile and what I sent: GET /api/instants
  if (m === "GET" && parts.length === 1) {
    const pile = db.instants.filter((x) => forMe(x, me) && findUser(x.userId) && !blocked(me, findUser(x.userId))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const mine = db.instants.filter((x) => x.userId === me.id && live(x)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    sendJSON(res, 200, { pile: pile.map((x) => view(x, me)), mine: mine.map((x) => view(x, me)), friends: friendsOf(me).length, reactions: REACTIONS });
    return true;
  }

  // Send one: POST /api/instants { image, caption }  (the photo was just taken with the camera)
  if (m === "POST" && parts.length === 1) {
    rateLimit("instant:" + me.id, 60, 60 * 60 * 1000, "You’ve sent a lot of looktures. Try again later.");
    const body = await readJSON(req);
    const img = ownedMedia(body.image, me.id, "image");
    if (!img) throw httpError(400, "Take a photo first.");
    const caption = clean(body.caption).replace(/\s+/g, " ");
    if (chars(caption) > 80) throw httpError(400, "Keep it under 80 characters.");
    const friends = friendsOf(me);
    if (!friends.length) throw httpError(400, "Looktures go to friends: people you follow who follow you back. You don’t have any yet.");
    const x = { id: crypto.randomUUID(), userId: me.id, url: img.url, caption, to: friends.map((u) => u.id), seenBy: [], reactions: {}, createdAt: new Date().toISOString() };
    db.instants.push(x);
    markUsed(img.url, "instant:" + x.id);
    save("instants");
    sendTo(x.to, { type: "instant:new", from: me.username });
    sendJSON(res, 201, { instant: view(x, me), sentTo: friends.length });
    return true;
  }

  const x = parts[1] && db.instants.find((i) => i.id === parts[1]);
  if (!x || !live(x) || !(x.userId === me.id || x.to.includes(me.id))) throw httpError(404, "This lookture is gone.");

  // Seen: POST /api/instants/:id/seen  (gone from my pile)
  if (m === "POST" && parts[2] === "seen") {
    if (x.userId !== me.id && !x.seenBy.includes(me.id)) {
      x.seenBy.push(me.id);
      save("instants");
      sendTo([x.userId], { type: "instant:seen", id: x.id, by: me.username });
    }
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // React or reply: POST /api/instants/:id/react { emoji } · /reply { text }  (a message to the sender)
  if (m === "POST" && (parts[2] === "react" || parts[2] === "reply")) {
    if (x.userId === me.id) throw httpError(400, "That’s your own lookture.");
    rateLimit("instant-react:" + me.id, 60, 10 * 60 * 1000, "Slow down a little.");
    const body = await readJSON(req);
    if (parts[2] === "react") {
      const emoji = String(body.emoji || "");
      if (!REACTIONS.includes(emoji)) throw httpError(400, "Pick one of the reactions.");
      x.reactions[me.id] = emoji;
      save("instants");
      tellOwner(x, me, "", emoji);
    } else {
      const text = clean(body.text);
      if (!text) throw httpError(400, "Write a reply.");
      if (chars(text) > 1000) throw httpError(400, "Keep it under 1000 characters.");
      tellOwner(x, me, text, null);
    }
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Take mine back: DELETE /api/instants/:id
  if (m === "DELETE" && parts.length === 2) {
    if (x.userId !== me.id) throw httpError(403, "You can only delete your own looktures.");
    deleteMedia(x.url);
    db.instants = db.instants.filter((i) => i !== x);
    save("instants");
    sendJSON(res, 200, { ok: true });
    return true;
  }
  return false;
}

module.exports = { handleInstants };
