// Accounts: sign up, log in, log out, sessions, forgot / reset password.

const crypto = require("crypto");
const { db, save, findUser, findByUsername } = require("./db");
const { sendJSON, httpError, readJSON, parseCookies, rateLimit } = require("./http");

const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESET_MS = 30 * 60 * 1000; // 30 minutes
const USERNAME_RE = /^[A-Za-z0-9_]{3,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

/* ---------- Passwords ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, Buffer.from(salt, "hex"), 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}
const DUMMY_HASH = hashPassword("not-a-real-password"); // keeps timing equal for unknown users

/* ---------- Sessions (only a hash of each token is stored) ---------- */
function startSession(user, remember) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[sha256(token)] = { userId: user.id, expires: Date.now() + SESSION_MS };
  save("sessions");
  const cookie = [`lb_session=${token}`, "HttpOnly", "Path=/", "SameSite=Lax"];
  if (remember) cookie.push(`Max-Age=${SESSION_MS / 1000}`);
  return cookie.join("; ");
}

function sessionUser(req) {
  const token = parseCookies(req).lb_session;
  if (!token) return null;
  const key = sha256(token);
  const s = db.sessions[key];
  if (!s) return null;
  if (s.expires < Date.now()) {
    delete db.sessions[key];
    save("sessions");
    return null;
  }
  return findUser(s.userId);
}

function endSessionsFor(userId) {
  for (const [k, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[k];
  save("sessions");
}

// Drop expired sessions once an hour
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, s] of Object.entries(db.sessions)) if (s.expires < now) { delete db.sessions[k]; changed = true; }
  if (changed) save("sessions");
}, 60 * 60 * 1000).unref();

/* ---------- Password reset links ---------- */
const resetTokens = new Map(); // sha256(token) -> { userId, expires }

/* ---------- Public shape of the logged-in user ---------- */
function meView(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    bio: u.bio,
    avatar: u.avatar,
    banner: u.banner,
    createdAt: u.createdAt,
    following: u.following,
  };
}

function validateSignup({ name, username, email, password }) {
  const errors = {};
  name = String(name || "").trim();
  username = String(username || "").trim().replace(/^@/, "");
  email = String(email || "").trim().toLowerCase();
  password = String(password || "");

  if (!name) errors.name = "What should we call you?";
  else if (name.length > 50) errors.name = "Keep your name under 50 characters.";

  if (!USERNAME_RE.test(username)) errors.username = "3–15 characters: letters, numbers and _ only.";
  else if (findByUsername(username)) errors.username = "That username is taken.";

  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = "That email address doesn’t look right.";
  else if (db.users.some((u) => u.email === email)) errors.email = "There’s already an account with this email.";

  if (password.length < 8) errors.password = "Use at least 8 characters.";
  else if (password.length > 128) errors.password = "That password is too long.";

  return { errors, clean: { name, username, email, password } };
}

/* ---------- Routes. Returns true when the request was handled. ---------- */
async function handleAuth(req, res, url, { port }) {
  const ip = req.socket.remoteAddress;
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/me") {
    const user = sessionUser(req);
    if (!user) throw httpError(401, "Not logged in.");
    sendJSON(res, 200, { user: meView(user) });
    return true;
  }

  if (route === "GET /api/username-available") {
    const name = String(url.searchParams.get("u") || "").replace(/^@/, "");
    if (!USERNAME_RE.test(name)) sendJSON(res, 200, { available: false, reason: "invalid" });
    else sendJSON(res, 200, { available: !findByUsername(name) });
    return true;
  }

  if (route === "POST /api/register") {
    rateLimit("reg:" + ip, 10);
    const { errors, clean } = validateSignup(await readJSON(req));
    if (Object.keys(errors).length) {
      sendJSON(res, 400, { errors });
      return true;
    }
    const user = {
      id: crypto.randomUUID(),
      name: clean.name,
      username: clean.username,
      email: clean.email,
      passwordHash: hashPassword(clean.password),
      createdAt: new Date().toISOString(),
      following: [],
      bio: "",
      avatar: null,
      banner: null,
    };
    db.users.push(user);
    save("users");
    sendJSON(res, 201, { user: meView(user) }, { "Set-Cookie": startSession(user, true) });
    return true;
  }

  if (route === "POST /api/login") {
    rateLimit("login:" + ip, 10);
    const body = await readJSON(req);
    const id = String(body.login || "").trim().replace(/^@/, "");
    const password = String(body.password || "");
    const user = id.includes("@") ? db.users.find((u) => u.email === id.toLowerCase()) : findByUsername(id);
    const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH) && Boolean(user);
    if (!ok) throw httpError(401, "Wrong email/username or password.");
    sendJSON(res, 200, { user: meView(user) }, { "Set-Cookie": startSession(user, Boolean(body.remember)) });
    return true;
  }

  if (route === "POST /api/logout") {
    const token = parseCookies(req).lb_session;
    if (token) {
      delete db.sessions[sha256(token)];
      save("sessions");
    }
    sendJSON(res, 200, { ok: true }, { "Set-Cookie": "lb_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0" });
    return true;
  }

  if (route === "POST /api/forgot-password") {
    rateLimit("forgot:" + ip, 5);
    const email = String((await readJSON(req)).email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      sendJSON(res, 400, { errors: { email: "That email address doesn’t look right." } });
      return true;
    }
    const user = db.users.find((u) => u.email === email);
    if (user) {
      for (const [k, v] of resetTokens) if (v.userId === user.id) resetTokens.delete(k);
      const token = crypto.randomBytes(32).toString("hex");
      resetTokens.set(sha256(token), { userId: user.id, expires: Date.now() + RESET_MS });
      // No email service yet: print the link in the server terminal instead.
      console.log(`\n[password reset] for ${user.email}\n  http://localhost:${port}/?reset=${token}\n`);
    }
    // Same answer either way, so nobody can find out which emails have accounts.
    sendJSON(res, 200, { ok: true });
    return true;
  }

  if (route === "POST /api/reset-password") {
    rateLimit("reset:" + ip, 10);
    const body = await readJSON(req);
    const key = sha256(String(body.token || ""));
    const entry = resetTokens.get(key);
    if (!entry || entry.expires < Date.now()) {
      resetTokens.delete(key);
      throw httpError(400, "This reset link has expired or was already used. Ask for a new one.");
    }
    const password = String(body.password || "");
    if (password.length < 8) { sendJSON(res, 400, { errors: { password: "Use at least 8 characters." } }); return true; }
    if (password.length > 128) { sendJSON(res, 400, { errors: { password: "That password is too long." } }); return true; }
    const user = findUser(entry.userId);
    if (!user) throw httpError(400, "This reset link is no longer valid.");

    user.passwordHash = hashPassword(password);
    save("users");
    resetTokens.delete(key);
    endSessionsFor(user.id); // log out every device that used the old password
    sendJSON(res, 200, { user: meView(user) }, { "Set-Cookie": startSession(user, true) });
    return true;
  }

  return false;
}

module.exports = { handleAuth, sessionUser, meView };
