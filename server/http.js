// Small HTTP helpers shared by the routes.

const { every } = require("./ticker");
function sendJSON(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}

// Throw one of these from a route to answer with that status and message
function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, expose: true, extra });
}

function readJSON(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, "That’s too much text."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
      } catch {
        reject(httpError(400, "Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Simple fixed-window rate limit
const attempts = new Map();
function tooMany(key, limit = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) {
    attempts.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > limit;
}
every(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
}, 10 * 60 * 1000).unref();

function rateLimit(key, limit, windowMs, message = "Too many attempts. Try again in a few minutes.") {
  if (tooMany(key, limit, windowMs)) throw httpError(429, message);
}

// The same limit, but counted in the database, so every server shares it (logging in, sign-ups, resets…).
// The key is stored hashed (it often holds an IP address) and is removed when its window ends.
function sharedRateLimit(key, limit = 10, windowMs = 15 * 60 * 1000, message = "Too many attempts. Try again in a few minutes.") {
  rateLimit(key, limit, windowMs, message); // (the quick local check first)
  const { db, save } = require("./db");
  const id = "rl:" + require("crypto").createHash("sha256").update(key).digest("hex").slice(0, 32);
  const now = Date.now(), e = db.tokens[id];
  if (!e || e.expires < now) db.tokens[id] = { count: 1, expires: now + windowMs };
  else e.count++;
  save("tokens");
  if (db.tokens[id].count > limit) throw httpError(429, message);
}

module.exports = { sendJSON, httpError, readJSON, parseCookies, rateLimit, sharedRateLimit };
