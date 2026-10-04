// Deleting your account: everything you made is removed, and the reason you gave is kept
// (without your name) so the LookBlog team can learn from it.

const crypto = require("crypto");
const { db, save } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { deleteMedia } = require("./media");
const { sendTo } = require("./realtime");

const REASONS = ["break", "privacy", "too-much-time", "not-useful", "bugs", "safety", "other-account", "other"];

function scrypt(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, Buffer.from(salt, "hex"), 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

function wipe(me) {
  const id = me.id;
  const files = new Set();
  const media = (m) => { if (!m) return; files.add(m.url); if (m.poster) files.add(m.poster); for (const r of m.renditions || []) files.add(r.url); };

  // Posts (and every reply on them)
  const mine = new Set(db.posts.filter((p) => p.userId === id).map((p) => p.id));
  for (const p of db.posts) if (mine.has(p.id)) { p.media.forEach(media); if (p.film?.backdrop) files.add(p.film.backdrop); }
  for (const c of db.comments) if ((mine.has(c.postId) || c.userId === id) && c.media && !c.media.gif) media(c.media);
  db.comments = db.comments.filter((c) => !mine.has(c.postId) && c.userId !== id);
  db.posts = db.posts.filter((p) => !mine.has(p.id));
  // Their marks on other people's posts
  for (const p of db.posts) {
    p.likes = p.likes.filter((x) => x !== id); p.dislikes = p.dislikes.filter((x) => x !== id); p.cools = p.cools.filter((x) => x !== id);
    p.reposts = p.reposts.filter((r) => r.userId !== id); p.tags = (p.tags || []).filter((x) => x !== id); p.mentions = (p.mentions || []).filter((x) => x !== id);
  }
  // Chats: direct chats go; groups lose them (and get a new owner, or go if empty)
  const gone = new Set();
  for (const ch of db.chats) {
    if (!ch.members.includes(id)) continue;
    if (ch.kind === "dm") { gone.add(ch.id); continue; }
    ch.members = ch.members.filter((x) => x !== id);
    if (ch.memberRoles) delete ch.memberRoles[id];
    if (ch.nicknames) delete ch.nicknames[id];
    if (ch.ownerId === id) {
      if (!ch.members.length) gone.add(ch.id);
      else { ch.ownerId = (Object.entries(ch.memberRoles || {}).find(([u, r]) => r.includes("coowner") && ch.members.includes(u)) || [ch.members[0]])[0]; }
    }
  }
  for (const m of db.messages) if ((gone.has(m.chatId) || m.userId === id) && m.media && !m.media.sticker && !m.media.gif) media(m.media);
  db.messages = db.messages.filter((m) => !gone.has(m.chatId) && m.userId !== id);
  for (const ch of db.chats) if (gone.has(ch.id)) { if (ch.cover) files.add(ch.cover); if (ch.banner) files.add(ch.banner); for (const s of ch.sounds || []) files.add(s.url); }
  db.chats = db.chats.filter((ch) => !gone.has(ch.id));
  // Playlists, series, songs, events, stories, notifications, reports
  for (const pl of db.playlists) if (pl.userId === id && pl.cover) files.add(pl.cover);
  db.playlists = db.playlists.filter((pl) => pl.userId !== id);
  for (const pl of db.playlists) pl.videoIds = pl.videoIds.filter((v) => !mine.has(v));
  for (const s of db.songs) if (s.userId === id) { files.add(s.url); if (s.cover) files.add(s.cover); }
  db.songs = db.songs.filter((s) => s.userId !== id);
  for (const s of db.songs) { s.likes = s.likes.filter((x) => x !== id); s.comments = (s.comments || []).filter((c) => c.userId !== id); if (s.reactions) delete s.reactions[id]; }
  for (const a of db.albums || []) if (a.userId === id && a.cover) files.add(a.cover);
  if (db.albums) db.albums = db.albums.filter((a) => a.userId !== id);
  for (const ev of db.events) if (ev.hostId === id) { if (ev.cover) files.add(ev.cover); if (ev.photo) files.add(ev.photo); }
  db.events = db.events.filter((ev) => ev.hostId !== id);
  for (const ev of db.events) { ev.going = ev.going.filter((x) => x !== id); ev.posts = ev.posts.filter((p) => p.userId !== id); }
  for (const st of db.stories) if (st.userId === id) media(st.media);
  for (const hl of db.highlights || []) if (hl.userId === id && hl.cover?.own) files.add(hl.cover.url);
  db.highlights = (db.highlights || []).filter((hl) => hl.userId !== id);
  db.stories = db.stories.filter((st) => st.userId !== id);
  db.notifications = db.notifications.filter((n) => n.userId !== id && n.actorId !== id);
  // Everyone else forgets them
  for (const u of db.users) {
    u.following = u.following.filter((x) => x !== id); u.bells = u.bells.filter((x) => x !== id);
    u.followRequests = (u.followRequests || []).filter((x) => x !== id); u.blocked = (u.blocked || []).filter((x) => x !== id);
  }
  // Files they uploaded (photos, videos, songs…)
  for (const [name, meta] of Object.entries(db.uploads)) if (meta.ownerId === id) files.add("/media/" + name);
  for (const f of [me.avatar, me.banner, ...(me.stickers || []).map((s) => s.url), ...(me.gifs || []).filter((g) => String(g.url).startsWith("/media/")).map((g) => g.url)]) if (f) files.add(f);
  for (const f of files) deleteMedia(f);
  // Sessions and the account itself
  for (const [k, s] of Object.entries(db.sessions)) if (s.userId === id) delete db.sessions[k];
  db.users = db.users.filter((u) => u.id !== id);
  for (const name of ["users", "posts", "comments", "chats", "messages", "playlists", "songs", "events", "stories", "highlights", "notifications", "sessions", "uploads"]) save(name);
  if (db.albums) save("albums");
}

async function handleAccount(req, res, url, me) {
  // POST /api/me/delete { password, reason, details, confirm }
  if (req.method !== "POST" || url.pathname !== "/api/me/delete") return false;
  rateLimit("delete:" + me.id, 5);
  const body = await readJSON(req);
  if (!REASONS.includes(body.reason)) throw httpError(400, "Please tell us why you’re leaving.");
  const details = String(body.details || "").trim().slice(0, 1000);
  if (body.reason === "other" && details.length < 5) throw httpError(400, "Please tell us a bit more about why.");
  if (String(body.confirm || "").toLowerCase() !== me.username.toLowerCase()) throw httpError(400, `Type your username (${me.username}) to confirm.`);
  if (!scrypt(String(body.password || ""), me.passwordHash)) throw httpError(401, "Your password isn’t right.");
  // Keep only why they left (no name, no email)
  db.support.push({ id: crypto.randomUUID().slice(0, 8), kind: "deletion", reason: body.reason, details, accountAgeDays: Math.floor((Date.now() - new Date(me.createdAt).getTime()) / 86400000), createdAt: new Date().toISOString(), status: "closed" });
  save("support");
  console.log(`[account] @${me.username} deleted their account (${body.reason})`);
  wipe(me);
  sendTo([me.id], { type: "account:deleted" });
  sendJSON(res, 200, { ok: true }, { "Set-Cookie": ["lb_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0", "lb_accounts=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"] });
  return true;
}

module.exports = { handleAccount, REASONS, wipe };
