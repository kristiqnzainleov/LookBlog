// Tiny JSON database kept in memory.
//   Locally: each collection lives in data/<name>.json. Writes are batched for a moment and done atomically.
//   Online (SUPABASE_URL set): the records live in Supabase, see store.js.

const fs = require("fs");
const path = require("path");
const store = require("./store");

const DATA_DIR = process.env.LOOKBLOG_DATA || path.join(__dirname, "..", "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
if (!store.enabled) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function load(name, fallback) {
  if (store.enabled) return fallback;
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name + ".json"), "utf8"));
  } catch {
    return fallback;
  }
}

const db = {
  users: load("users", []),
  posts: load("posts", []), // newest first
  comments: load("comments", []), // oldest first
  sessions: load("sessions", {}), // sha256(token) -> { userId, expires }
  uploads: load("uploads", {}), // file name -> { ownerId, kind, size, createdAt }
  playlists: load("playlists", []), // video series
  chats: load("chats", []), // direct messages and groups
  messages: load("messages", []), // oldest first
  notifications: load("notifications", []), // oldest first
  reports: load("reports", []), // posts people reported
  verifyRequests: load("verifyRequests", []), // applications for the tick
  stories: load("stories", []), // gone after 24 hours
  followLog: load("followLog", []), // follows and unfollows over time, for analytics
  events: load("events", []), // public events anyone can join
  support: load("support", []), // messages to the LookBlog team
  songs: load("songs", []), // music (Spotify style)
  albums: load("albums", []), // albums, EPs and singles
  streams: load("streams", []), // live streams (and their recordings)
  highlights: load("highlights", []),
  voice: load("voice", {}),
  liveViewers: load("liveViewers", {}),
  badgeDefs: load("badgeDefs", []), // badges the team designed (name, emoji or picture, colour)
  admins: load("admins", []), // admin panel accounts (separate from LookBlog accounts)
  adminSessions: load("adminSessions", {}), // sha256(token) -> { adminId, expires } // who is watching each live right now // who is in which voice channel right now, and its music // groups of stories that stay on a profile
  tokens: load("tokens", {}), // short-lived: 2-step login tickets and password reset links (hashed)
};

// Accounts with the verification tick
const VERIFIED = String(process.env.VERIFIED_USERNAMES ?? "ko6i").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

// Bring older data up to the current shape
function normalize() {
  for (const u of db.users) {
    if (!Array.isArray(u.following)) u.following = [];
    if (typeof u.bio !== "string") u.bio = "";
    if (u.avatar === undefined) u.avatar = null;
    if (u.banner === undefined) u.banner = null;
    if (!Array.isArray(u.bells)) u.bells = []; // people whose new posts I want to hear about
    if (!Array.isArray(u.categories)) u.categories = []; // [{ id, name }] for sorting my own content
    if (u.note === undefined) u.note = null; // { text, createdAt } — gone after 24 hours
    // The tick stays with the account even if the @ changes later
    u.verified = Boolean(u.verified) || VERIFIED.includes(u.username.toLowerCase());
    if (u.verified && !u.verifiedType) u.verifiedType = "creator";
    if (!Array.isArray(u.stickers)) u.stickers = []; // [{ id, url, createdAt }]
    if (!Array.isArray(u.sounds)) u.sounds = []; // my own sounds [{ id, name, emoji, url, createdAt }]
    if (!Array.isArray(u.gifs)) u.gifs = []; // my GIF collection [{ id, url }]
  }
  for (const p of db.posts) {
    if (!p.type) p.type = "post";
    if (!Array.isArray(p.media)) p.media = [];
    if (!Array.isArray(p.likes)) p.likes = [];
    if (!Array.isArray(p.dislikes)) p.dislikes = [];
    if (!Array.isArray(p.viewedBy)) p.viewedBy = [];
    if (!Array.isArray(p.reposts)) p.reposts = []; // [{ userId, at }]
    if (!Array.isArray(p.cools)) p.cools = []; // user ids who pressed "Cool"
    if (!Array.isArray(p.mentions)) p.mentions = []; // tagged user ids
    if (!["public", "unlisted", "private"].includes(p.visibility)) p.visibility = "public";
    if (typeof p.title !== "string") p.title = "";
    if (typeof p.commentCount !== "number") p.commentCount = db.comments.filter((c) => c.postId === p.id).length;
  }
  for (const c of db.chats) {
    if (c.kind === "group" && !["public", "unlisted", "private"].includes(c.visibility)) c.visibility = "public";
  }
}

const timers = {};
function writeNow(name) {
  clearTimeout(timers[name]);
  delete timers[name];
  const file = path.join(DATA_DIR, name + ".json");
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db[name], null, 2));
  fs.renameSync(tmp, file);
}
function save(name) {
  if (store.enabled) {
    store.markDirty(name);
    // Requests write before they answer; this catches changes made outside a request
    if (!timers.store) timers.store = setTimeout(() => { delete timers.store; store.flush(db); }, 40);
    return;
  }
  if (timers[name]) return;
  timers[name] = setTimeout(() => writeNow(name), 40);
}
function flushAll() {
  if (store.enabled) return store.flush(db);
  for (const name of Object.keys(timers)) if (name !== "store") writeNow(name);
}
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    flushAll();
    process.exit(0);
  });
}

const findUser = (id) => db.users.find((u) => u.id === id) || null;
const findByUsername = (username) => {
  const u = String(username).toLowerCase();
  return db.users.find((x) => x.username.toLowerCase() === u) || null;
};
const findPost = (id) => db.posts.find((p) => p.id === id) || null;
const findChat = (id) => db.chats.find((c) => c.id === id) || null;

// Code that fixes up data once it's loaded (locally that's right away, online after the first fetch)
const loadHooks = [];
let loaded = false;
function onLoad(fn) { if (loaded) fn(); else loadHooks.push(fn); }
// The first load. If it fails (e.g. the network blipped), the next request tries again instead of staying broken.
let loading = null;
function ready() {
  if (!loading) loading = (store.enabled ? store.load(db) : Promise.resolve()).then(() => {
    normalize();
    loaded = true;
    for (const fn of loadHooks.splice(0)) fn();
  }).catch((err) => { loading = null; throw err; });
  return loading;
}
ready().catch((err) => console.error("[db] first load failed, will retry:", err.message));
// Before each request online: pick up what other servers changed
const sync = () => (store.enabled ? store.sync(db) : Promise.resolve());
const flush = () => (store.enabled ? store.flush(db) : Promise.resolve());

module.exports = { VERIFIED, db, save, flushAll, onLoad, ready, sync, flush, findUser, findByUsername, findPost, findChat, DATA_DIR, UPLOAD_DIR };
