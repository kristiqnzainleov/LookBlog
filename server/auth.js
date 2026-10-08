// Accounts: sign up, log in, log out, sessions, forgot / reset password.

const crypto = require("crypto");
const { db, save, findUser, findByUsername, VERIFIED } = require("./db");
const { sendJSON, httpError, readJSON, parseCookies, rateLimit } = require("./http");
const { every } = require("./ticker");

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
// Accounts suspended by the LookBlog team can't log in
function checkNotBanned(user) {
  if (user?.banned) throw httpError(403, "This account has been suspended by the LookBlog team" + (user.banned.reason ? ` (${user.banned.reason})` : "") + ".");
}
function startSession(user, remember) {
  checkNotBanned(user);
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[sha256(token)] = { userId: user.id, expires: Date.now() + SESSION_MS };
  save("sessions");
  const cookie = [`lb_session=${token}`, "HttpOnly", "Path=/", "SameSite=Lax"];
  if (remember) cookie.push(`Max-Age=${SESSION_MS / 1000}`);
  return cookie.join("; ");
}

/* ---------- Several accounts on one browser (switch without logging out) ----------
   lb_session = the account in use · lb_accounts = the other accounts' tokens, dot-separated */
const MAX_ACCOUNTS = 5;
function newSession(user) {
  checkNotBanned(user);
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[sha256(token)] = { userId: user.id, expires: Date.now() + SESSION_MS };
  save("sessions");
  return token;
}
const userOfToken = (t) => { const s = t && db.sessions[sha256(t)]; const u = s && s.expires > Date.now() ? findUser(s.userId) : null; return u && !u.banned ? u : null; };
const sessionCookie = (t) => `lb_session=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`;
const accountsCookie = (list) => list.length ? `lb_accounts=${list.join(".")}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MS / 1000}` : "lb_accounts=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
function otherTokens(req) {
  const current = parseCookies(req).lb_session;
  const me = userOfToken(current);
  const seen = new Set(me ? [me.id] : []);
  const out = [];
  for (const t of String(parseCookies(req).lb_accounts || "").split(".").filter((x) => /^[0-9a-f]{64}$/.test(x))) {
    const u = userOfToken(t);
    if (!u || seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(t);
  }
  return out.slice(0, MAX_ACCOUNTS - 1);
}

// Logging in (or signing up) while another account is logged in keeps that one for switching back
function keepPrevious(req, user) {
  const prev = parseCookies(req).lb_session;
  const prevUser = userOfToken(prev);
  if (!prevUser || prevUser.id === user.id) return [];
  const list = [prev, ...otherTokens(req).filter((t) => userOfToken(t)?.id !== user.id)].slice(0, MAX_ACCOUNTS - 1);
  return [accountsCookie(list)];
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
  const user = findUser(s.userId);
  return user && !user.banned ? user : null;
}

function endSessionsFor(userId) {
  for (const [k, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[k];
  save("sessions");
}

// Drop expired sessions once an hour
every(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, s] of Object.entries(db.sessions)) if (s.expires < now) { delete db.sessions[k]; changed = true; }
  for (const [k, t] of Object.entries(db.tokens)) if (t.expires < now) { delete db.tokens[k]; save("tokens"); }
  if (changed) save("sessions");
}, 60 * 60 * 1000).unref();

/* ---------- Two-step verification (2FA): a code LookBlog gives you, or one you choose ---------- */
const twoFA = (u) => Boolean(u?.twoFactor?.on && u.twoFactor.code);
const codeOk = (u, code) => {
  const a = Buffer.from(String(code || "").replace(/\s+/g, "")), b = Buffer.from(String(u.twoFactor.code));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
// Short-lived tickets live in db.tokens (hashed), so any server can finish what another one started
function tokenMap(kind) {
  const k = (key) => kind + ":" + key;
  return {
    get: (key) => db.tokens[k(key)] || undefined,
    set: (key, value) => { db.tokens[k(key)] = value; save("tokens"); },
    delete: (key) => { if (db.tokens[k(key)]) { delete db.tokens[k(key)]; save("tokens"); } },
    *[Symbol.iterator]() { for (const [key, v] of Object.entries(db.tokens)) if (key.startsWith(kind + ":")) yield [key.slice(kind.length + 1), v]; },
  };
}
const pending2fa = tokenMap("2fa"); // sha256(ticket) -> { userId, remember, expires, tries }
function askForCode(user, remember) {
  const ticket = crypto.randomBytes(24).toString("hex");
  pending2fa.set(sha256(ticket), { userId: user.id, remember, expires: Date.now() + 5 * 60 * 1000, tries: 0 });
  return ticket;
}

/* ---------- Password reset links ---------- */
const resetTokens = tokenMap("reset"); // sha256(token) -> { userId, expires }

/* ---------- Public shape of the logged-in user ---------- */
function meView(u) {
  return {
    id: u.id,
    name: u.name,
    look: u.look || null,
    msgStyle: u.msgStyle || null,
    showNsfw: Boolean(u.showNsfw),
    showSensitive: Boolean(u.showSensitive),
    username: u.username,
    email: u.email,
    bio: u.bio,
    avatar: u.avatar,
    banner: u.banner,
    createdAt: u.createdAt,
    following: u.following,
    verified: Boolean(u.verified),
    verifiedType: u.verified ? u.verifiedType || "creator" : null,
    lang: u.lang || null,
    canMakeFilms: require("./social").canMakeFilms(u),
    canMakeMusic: require("./social").canMakeMusic(u),
    ...(require("./admin").isAdmin(u) ? { admin: true, owner: require("./admin").isOwner(u) } : {}),
    private: Boolean(u.private),
    categories: u.categories || [],
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
  // Behind a hosting proxy (TRUST_PROXY=1) the real address is in x-real-ip
  const fwd = process.env.TRUST_PROXY && String(req.headers["x-real-ip"] || "").trim();
  const ip = fwd || req.socket.remoteAddress;
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
      bells: [],
      categories: [],
      note: null,
      verified: VERIFIED.includes(clean.username.toLowerCase()),
    };
    db.users.push(user);
    save("users");
    const refCookies = require("./referrals").creditReferral(req, user); // signed up through someone's invite
    sendJSON(res, 201, { user: meView(user) }, { "Set-Cookie": [startSession(user, true), ...keepPrevious(req, user), ...refCookies] });
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
    checkNotBanned(user);
    // 2FA on: the password was right, now we need the code
    if (twoFA(user)) {
      sendJSON(res, 200, { needCode: true, ticket: askForCode(user, Boolean(body.remember)), name: user.name });
      return true;
    }
    sendJSON(res, 200, { user: meView(user) }, { "Set-Cookie": [startSession(user, Boolean(body.remember)), ...keepPrevious(req, user)] });
    return true;
  }

  // The 2FA code after the password (or Google): POST /api/login/code { ticket, code }
  if (route === "POST /api/login/code") {
    rateLimit("2fa:" + ip, 20);
    const body = await readJSON(req);
    const key = sha256(String(body.ticket || ""));
    const t = pending2fa.get(key);
    if (!t || t.expires < Date.now()) { pending2fa.delete(key); throw httpError(400, "That took too long. Log in again."); }
    const user = findUser(t.userId);
    if (!user || !twoFA(user)) { pending2fa.delete(key); throw httpError(400, "Log in again."); }
    if (!codeOk(user, body.code)) {
      if (++t.tries >= 5) { pending2fa.delete(key); throw httpError(401, "Too many wrong codes. Log in again."); }
      pending2fa.set(key, t);
      throw httpError(401, `That code isn’t right. ${5 - t.tries} tries left.`);
    }
    pending2fa.delete(key);
    sendJSON(res, 200, { user: meView(user) }, { "Set-Cookie": [startSession(user, t.remember), ...keepPrevious(req, user)] });
    return true;
  }

  if (route === "POST /api/logout") {
    const token = parseCookies(req).lb_session;
    const others = otherTokens(req);
    if (token) {
      delete db.sessions[sha256(token)];
      save("sessions");
    }
    // Another account is still logged in on this browser: carry on with it
    if (others.length) {
      const [next, ...rest] = others;
      sendJSON(res, 200, { ok: true, switched: userOfToken(next).username }, { "Set-Cookie": [sessionCookie(next), accountsCookie(rest)] });
      return true;
    }
    sendJSON(res, 200, { ok: true }, { "Set-Cookie": ["lb_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0", accountsCookie([])] });
    return true;
  }

  /* ---------- Settings: 2-step verification ---------- */
  // GET /api/me/2fa
  if (route === "GET /api/me/2fa") {
    const me = sessionUser(req);
    if (!me) throw httpError(401, "Not logged in.");
    sendJSON(res, 200, { on: twoFA(me), hasPassword: !me.googleOnly });
    return true;
  }
  // POST /api/me/2fa { action: enable|disable|show|change, password, code }
  // Change my email: POST /api/me/email { email, password }
  if (route === "POST /api/me/email") {
    const me = sessionUser(req);
    if (!me) throw httpError(401, "Not logged in.");
    rateLimit("email:" + me.id, 10, 60 * 60 * 1000, "You’ve tried a lot of times. Try again in an hour.");
    const body = await readJSON(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) throw httpError(400, "That email address doesn’t look right.");
    if (email === String(me.email || "").toLowerCase()) throw httpError(400, "That’s already your email.");
    if (db.users.some((u) => u.id !== me.id && String(u.email || "").toLowerCase() === email)) throw httpError(400, "There’s already an account with this email.");
    // Accounts made with Google may not have a password; everyone else confirms with theirs
    if (me.passwordHash && !verifyPassword(String(body.password || ""), me.passwordHash)) throw httpError(401, "Your password isn’t right.");
    const old = me.email;
    me.email = email;
    save("users");
    require("./notifications").notify(me.id, "security", me, { text: `Your email was changed${old ? ` from ${old}` : ""} to ${email}. If this wasn’t you, change your password right away.` });
    sendJSON(res, 200, { user: meView(me) });
    return true;
  }

  // Change my password: POST /api/me/password { current, password }
  // (Google accounts without a password can set one.) Every other device is logged out; this one stays in.
  if (route === "POST /api/me/password") {
    const me = sessionUser(req);
    if (!me) throw httpError(401, "Not logged in.");
    rateLimit("pass:" + me.id, 10, 60 * 60 * 1000, "You’ve tried a lot of times. Try again in an hour.");
    const body = await readJSON(req);
    if (me.passwordHash && !verifyPassword(String(body.current || ""), me.passwordHash)) throw httpError(401, "Your current password isn’t right.");
    const password = String(body.password || "");
    if (password.length < 8) throw httpError(400, "Use at least 8 characters.");
    if (password.length > 128) throw httpError(400, "That password is too long.");
    if (me.passwordHash && verifyPassword(password, me.passwordHash)) throw httpError(400, "That’s your current password. Pick a new one.");
    me.passwordHash = hashPassword(password);
    save("users");
    endSessionsFor(me.id);
    require("./notifications").notify(me.id, "security", me, { text: "Your password was changed. If this wasn’t you, change it again right away." });
    sendJSON(res, 200, { ok: true }, { "Set-Cookie": [startSession(me, true), ...keepPrevious(req, me)] });
    return true;
  }

  if (route === "POST /api/me/2fa") {
    const me = sessionUser(req);
    if (!me) throw httpError(401, "Not logged in.");
    rateLimit("2faset:" + me.id, 20);
    const body = await readJSON(req);
    if (!verifyPassword(String(body.password || ""), me.passwordHash)) throw httpError(401, "Your password isn’t right.");
    if (body.action === "disable") { me.twoFactor = { on: false }; save("users"); sendJSON(res, 200, { on: false }); return true; }
    if (body.action === "show") { if (!twoFA(me)) throw httpError(400, "2-step verification is off."); sendJSON(res, 200, { on: true, code: me.twoFactor.code }); return true; }
    // enable / change: your own code (6–10 digits) or one LookBlog makes for you
    let code = String(body.code || "").replace(/\s+/g, "");
    if (code && !/^\d{6,10}$/.test(code)) throw httpError(400, "Use 6 to 10 digits.");
    if (code && /^(\d)\1+$/.test(code)) throw httpError(400, "Pick a code that isn’t the same digit over and over.");
    if (!code) code = String(crypto.randomInt(100000, 1000000));
    me.twoFactor = { on: true, code, since: new Date().toISOString() };
    save("users");
    require("./notifications").notify(me.id, "security", me, { text: "2-step verification is on. You’ll need your code every time you log in." });
    sendJSON(res, 200, { on: true, code });
    return true;
  }

  /* ---------- Switching accounts ---------- */
  // GET /api/accounts — the accounts logged in on this browser
  if (route === "GET /api/accounts") {
    const me = sessionUser(req);
    if (!me) throw httpError(401, "Not logged in.");
    const unread = (u) => db.notifications.filter((n) => n.userId === u.id && !n.read).length;
    const view = (u, current) => ({ name: u.name, username: u.username, avatar: u.avatar, verified: Boolean(u.verified), verifiedType: u.verified ? u.verifiedType || "creator" : null, current, unread: current ? 0 : unread(u) });
    sendJSON(res, 200, { accounts: [view(me, true), ...otherTokens(req).map((t) => view(userOfToken(t), false))], max: MAX_ACCOUNTS });
    return true;
  }
  // POST /api/accounts/add { login, password } — log in to one more account and switch to it
  if (route === "POST /api/accounts/add") {
    rateLimit("login:" + ip, 10);
    const me = sessionUser(req);
    if (!me) throw httpError(401, "Not logged in.");
    const body = await readJSON(req);
    const id = String(body.login || "").trim().replace(/^@/, "");
    const user = id.includes("@") ? db.users.find((u) => u.email === id.toLowerCase()) : findByUsername(id);
    const ok = verifyPassword(String(body.password || ""), user ? user.passwordHash : DUMMY_HASH) && Boolean(user);
    if (!ok) throw httpError(401, "Wrong email/username or password.");
    checkNotBanned(user);
    if (user.id === me.id) throw httpError(400, "You’re already using this account.");
    if (twoFA(user) && !body.code) throw httpError(401, "This account has 2-step verification. Enter its code.", { needCode: true });
    if (twoFA(user) && !codeOk(user, body.code)) throw httpError(401, "That 2-step code isn’t right.", { needCode: true });
    const others = otherTokens(req);
    const existing = others.find((t) => userOfToken(t)?.id === user.id);
    if (!existing && others.length >= MAX_ACCOUNTS - 1) throw httpError(400, `You can be logged in to up to ${MAX_ACCOUNTS} accounts.`);
    const token = existing || newSession(user);
    const rest = [parseCookies(req).lb_session, ...others.filter((t) => t !== token)];
    sendJSON(res, 200, { user: meView(user) }, { "Set-Cookie": [sessionCookie(token), accountsCookie(rest)] });
    return true;
  }
  // POST /api/accounts/switch { username }
  if (route === "POST /api/accounts/switch") {
    const me = sessionUser(req);
    if (!me) throw httpError(401, "Not logged in.");
    const username = String((await readJSON(req)).username || "").toLowerCase();
    const others = otherTokens(req);
    const token = others.find((t) => userOfToken(t)?.username.toLowerCase() === username);
    if (!token) throw httpError(404, "That account isn’t logged in here anymore. Add it again.");
    const rest = [parseCookies(req).lb_session, ...others.filter((t) => t !== token)];
    sendJSON(res, 200, { user: meView(userOfToken(token)) }, { "Set-Cookie": [sessionCookie(token), accountsCookie(rest)] });
    return true;
  }
  // POST /api/accounts/remove { username } — log one of the other accounts out
  if (route === "POST /api/accounts/remove") {
    const username = String((await readJSON(req)).username || "").toLowerCase();
    const others = otherTokens(req);
    const token = others.find((t) => userOfToken(t)?.username.toLowerCase() === username);
    if (token) { delete db.sessions[sha256(token)]; save("sessions"); }
    sendJSON(res, 200, { ok: true }, { "Set-Cookie": accountsCookie(others.filter((t) => t !== token)) });
    return true;
  }

  /* ---------- Sign in with Google ---------- */
  // GET /api/auth/google/config → which Google app to use (null = not set up)
  if (route === "GET /api/auth/google/config") {
    sendJSON(res, 200, { clientId: process.env.GOOGLE_CLIENT_ID || null });
    return true;
  }
  // POST /api/auth/google { accessToken } — checks the token with Google, then logs in or makes the account
  if (route === "POST /api/auth/google") {
    rateLimit("google:" + ip, 20);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw httpError(503, "Sign in with Google isn’t set up on this server yet.");
    const token = String((await readJSON(req)).accessToken || "");
    if (!/^[\w.\-~+/]{20,4096}$/.test(token)) throw httpError(400, "Google didn’t send a valid sign-in.");
    let info, profile;
    try {
      info = await (await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token), { signal: AbortSignal.timeout(8000) })).json();
      profile = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(8000) })).json();
    } catch { throw httpError(503, "Couldn’t reach Google. Try again."); }
    // The token must be for our app, and the email must be confirmed by Google
    if ((info.aud !== clientId && info.azp !== clientId) || !profile.sub || profile.sub !== info.sub) throw httpError(401, "That Google sign-in isn’t for LookBlog.");
    if (!profile.email || profile.email_verified === false) throw httpError(401, "Your Google account has no confirmed email.");
    const email = String(profile.email).toLowerCase();
    let user = db.users.find((u) => u.googleId === profile.sub) || db.users.find((u) => u.email === email);
    let isNew = false;
    if (user) {
      if (!user.googleId) { user.googleId = profile.sub; save("users"); }
    } else {
      // A new account: name from Google, a free @username made from the email
      let base = email.split("@")[0].replace(/[^A-Za-z0-9_]/g, "").slice(0, 12) || "user";
      if (base.length < 3) base = (base + "user").slice(0, 12);
      let username = base, n = 1;
      while (findByUsername(username)) username = (base.slice(0, 12) + (++n)).slice(0, 15);
      user = {
        id: crypto.randomUUID(), name: String(profile.name || username).slice(0, 50), username, email,
        passwordHash: hashPassword(crypto.randomBytes(24).toString("hex")), googleId: profile.sub,
        createdAt: new Date().toISOString(), following: [], bio: "", avatar: null, banner: null, bells: [], categories: [], note: null,
        verified: VERIFIED.includes(username.toLowerCase()),
      };
      db.users.push(user);
      save("users");
      isNew = true;
      require("./referrals").creditReferral(req, user); // signed up through someone's invite
      console.log(`[google] new account @${username}`);
    }
    if (twoFA(user)) {
      sendJSON(res, 200, { needCode: true, ticket: askForCode(user, true), name: user.name });
      return true;
    }
    sendJSON(res, 200, { user: meView(user), isNew }, { "Set-Cookie": [startSession(user, true), ...keepPrevious(req, user)] });
    return true;
  }

  if (route === "POST /api/forgot-password") {
    rateLimit("forgot:" + ip, 5);
    const body2fa = await readJSON(req);
    const email = String(body2fa.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      sendJSON(res, 400, { errors: { email: "That email address doesn’t look right." } });
      return true;
    }
    // No email is sent: the right email lets you choose a new password straight away
    // (the token below is good for 10 minutes and for this one change only).
    const user = db.users.find((u) => u.email === email);
    if (!user) {
      sendJSON(res, 404, { errors: { email: "There’s no LookBlog account with that email." } });
      return true;
    }
    if (twoFA(user)) {
      const code = (await Promise.resolve(body2fa))?.code;
      if (!code) { sendJSON(res, 401, { needCode: true, error: "This account has 2-step verification. Enter your code to continue." }); return true; }
      if (!codeOk(user, code)) { sendJSON(res, 401, { needCode: true, error: "That 2-step code isn’t right." }); return true; }
    }
    for (const [k, v] of resetTokens) if (v.userId === user.id) resetTokens.delete(k);
    const token = crypto.randomBytes(32).toString("hex");
    resetTokens.set(sha256(token), { userId: user.id, expires: Date.now() + 10 * 60 * 1000 });
    console.log(`[password reset] started for @${user.username}`);
    sendJSON(res, 200, { token, name: user.name, username: user.username });
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
    // Let them know, in case it wasn't them
    require("./notifications").notify(user.id, "security", user, { text: "Your password was changed. If this wasn’t you, change it again right away." });
    sendJSON(res, 200, { user: meView(user) }, { "Set-Cookie": startSession(user, true) });
    return true;
  }

  return false;
}

module.exports = { handleAuth, sessionUser, meView, endSessionsFor, hashPassword, verifyPassword };
