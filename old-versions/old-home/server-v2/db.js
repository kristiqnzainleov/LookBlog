// Tiny JSON-file database. Each collection lives in data/<name>.json.
// Writes are batched for a moment and done atomically (write temp file, then rename).

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.LOOKBLOG_DATA || path.join(__dirname, "..", "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function load(name, fallback) {
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
};

// Bring older data up to the current shape
for (const u of db.users) {
  if (!Array.isArray(u.following)) u.following = [];
  if (typeof u.bio !== "string") u.bio = "";
  if (u.avatar === undefined) u.avatar = null;
  if (u.banner === undefined) u.banner = null;
}
for (const p of db.posts) {
  if (!p.type) p.type = "post";
  if (!Array.isArray(p.media)) p.media = [];
  if (!Array.isArray(p.likes)) p.likes = [];
  if (!Array.isArray(p.dislikes)) p.dislikes = [];
  if (!Array.isArray(p.viewedBy)) p.viewedBy = [];
  if (!Array.isArray(p.reposts)) p.reposts = []; // [{ userId, at }]
  if (typeof p.title !== "string") p.title = "";
  if (typeof p.commentCount !== "number") p.commentCount = db.comments.filter((c) => c.postId === p.id).length;
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
  if (timers[name]) return;
  timers[name] = setTimeout(() => writeNow(name), 40);
}
function flushAll() {
  for (const name of Object.keys(timers)) writeNow(name);
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

module.exports = { db, save, flushAll, findUser, findByUsername, findPost, DATA_DIR, UPLOAD_DIR };
