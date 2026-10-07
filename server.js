// LookBlog server. No external dependencies.
// Run with:  npm start   (or: node server.js)

const http = require("http");
const fs = require("fs");
const path = require("path");

// Settings can live in a .env file next to server.js (e.g. GOOGLE_CLIENT_ID=...)
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
} catch {}
const { sendJSON } = require("./server/http");
const { handleAuth, sessionUser } = require("./server/auth");
const { handleUpload, serveMedia } = require("./server/media");
const { handleSocial } = require("./server/social");
const { handleEvents } = require("./server/realtime");
const { handlePlaylists } = require("./server/playlists");
const { handleChat } = require("./server/chat");
const { handleNotifications } = require("./server/notifications");
const { handleStories } = require("./server/stories");
const { handleInstants } = require("./server/instants");
const { handleReferrals, serveJoinPage } = require("./server/referrals");
const { handleAnalytics } = require("./server/analytics");
const { handleEvents: handlePublicEvents } = require("./server/events");
const { handleMusic } = require("./server/music");
const { handleAccount } = require("./server/account");
const { handleLinks } = require("./server/links");
const { handleLeaderboard } = require("./server/leaderboard");
const { handleStreams } = require("./server/streams");
const { handleAdmin, handlePanel, panelAdmin } = require("./server/admin");
const { ready, sync, flush } = require("./server/db");
const store = require("./server/store");
const { runDue } = require("./server/ticker");
const { realtimeInfo, ping, flushRealtime } = require("./server/realtime");
const { startUpload, finishUpload } = require("./server/media");
require("./server/transcode"); // makes 360p–1080p copies of videos when ffmpeg is installed
const { badgesFor, checkBadges, ROLES, rolesOf, findRole } = require("./server/badges");
const crypto = require("crypto");
const { save } = require("./server/db");
const { readJSON } = require("./server/http");
const { findByUsername } = require("./server/db");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".gif": "image/gif",
  ".json": "application/json; charset=utf-8",
  ".bin": "application/octet-stream",
};

// Pages of the app (all served by app.html, which shows the right one)
const APP_PAGES = [
  /^\/feed$/, /^\/shorts$/, /^\/videos$/, /^\/search$/, /^\/post\/[\w-]+$/, /^\/watch\/[\w-]+$/, /^\/u\/[^/]+$/,
  /^\/playlist\/[\w-]+$/, /^\/messages(\/[\w-]+)?$/, /^\/groups$/, /^\/invite\/[\w-]+$/, /^\/events$/, /^\/cinema$/, /^\/music$/, /^\/history$/, /^\/settings$/, /^\/leaderboard$/, /^\/editor$/, /^\/live\/[\w-]+$/, /^\/album\/[\w-]+$/, /^\/event\/[\w-]+$/, /^\/verified$/, /^\/analytics$/, /^\/people$/, /^\/admin$/,
];

function redirect(res, to) {
  res.writeHead(302, { Location: to, "Cache-Control": "no-store" });
  res.end();
}

function servePublic(res, relPath) {
  const file = path.join(PUBLIC_DIR, relPath);
  const type = TYPES[path.extname(file)];
  // Stay inside public/ and only serve known file types
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !type || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  // The GIF pack never changes, so browsers may keep it
  const cache = relPath.startsWith("gifs/pack/") ? "public, max-age=604800" : "no-store";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res, url) {
  // Every write must carry this header. Other sites can't add it without permission, which blocks CSRF.
  if (req.method !== "GET" && req.headers["x-lookblog"] !== "1") {
    return sendJSON(res, 403, { error: "Missing request header." });
  }

  if (await handleAuth(req, res, url, { port: PORT })) return;

  // The admin panel (/admin-panel) has its own accounts
  if (url.pathname.startsWith("/api/panel/")) { await handlePanel(req, res, url); return; }
  const panel = /^\/api\/(admin|upload)/.test(url.pathname) ? panelAdmin(req) : null;
  if (panel && url.pathname.startsWith("/api/admin")) { await handleAdmin(req, res, url, panel); return; }

  // A panel admin can also upload (e.g. a picture for a special badge)
  const me = sessionUser(req) || (panel && url.pathname.startsWith("/api/upload") ? panel : null);
  if (!me) return sendJSON(res, 401, { error: "Please log in." });

  if (req.method === "GET" && url.pathname === "/api/events") {
    if (store.enabled) return sendJSON(res, 410, { error: "Live updates moved. Reload the page." });
    return handleEvents(req, res, me);
  }
  // Connection servers for calls, voice and lives: GET /api/ice
  if (req.method === "GET" && url.pathname === "/api/ice") return sendJSON(res, 200, { iceServers: await iceServers() });
  // Where my browser listens for live updates, and "my tab is open"
  if (req.method === "GET" && url.pathname === "/api/realtime") return sendJSON(res, 200, store.enabled ? realtimeInfo(me) : { mode: "sse" });
  if (req.method === "POST" && url.pathname === "/api/ping") { if (store.enabled) ping(me); return sendJSON(res, 200, { ok: true }); }
  // Online uploads go straight to storage
  if (store.enabled && req.method === "POST" && url.pathname === "/api/upload/start") return startUpload(req, res, me, await readJSON(req));
  if (store.enabled && req.method === "POST" && url.pathname === "/api/upload/finish") return finishUpload(req, res, me, await readJSON(req));
  if (await handleAdmin(req, res, url, me)) return;
  if (req.method === "POST" && url.pathname === "/api/upload") return handleUpload(req, res, me);
  // After anything that changes data, see if someone earned a badge
  if (req.method !== "GET") afterAnswer(res, () => {
    try {
      checkBadges(me);
      const m = url.pathname.match(/^\/api\/users\/([^/]+)\/follow$/);
      if (m) checkBadges(findByUsername(decodeURIComponent(m[1])));
    } catch (err) { console.error("[badges]", err); } // never take the server down over a badge
  });

  // Badges and awards: GET /api/users/:username/badges
  const bm = req.method === "GET" && url.pathname.match(/^\/api\/users\/([^/]+)\/badges$/);
  if (bm) {
    const user = findByUsername(decodeURIComponent(bm[1]));
    if (!user) return sendJSON(res, 404, { error: "This account doesn’t exist." });
    if (user.id === me.id) checkBadges(me);
    return sendJSON(res, 200, { ...badgesFor(user), roles: rolesOf(user), allRoles: user.id === me.id ? [...ROLES, ...(me.customRoles || [])] : ROLES });
  }

  // My role badges: POST /api/me/roles { roles: [...] }
  if (req.method === "POST" && url.pathname === "/api/me/roles") {
    const want = (await readJSON(req)).roles;
    const roles = [...new Set(Array.isArray(want) ? want : [])].filter((id) => findRole(me, id));
    if (roles.length > 3) return sendJSON(res, 400, { error: "Pick up to 3." });
    me.roles = roles;
    save("users");
    return sendJSON(res, 200, { roles: rolesOf(me), canMakeFilms: require("./server/social").canMakeFilms(me), canMakeMusic: require("./server/social").canMakeMusic(me) });
  }

  // Write to the LookBlog team: POST /api/support { topic, message, page }  ·  my messages: GET /api/support
  if (url.pathname === "/api/support") {
    const { db } = require("./server/db");
    if (req.method === "GET") {
      return sendJSON(res, 200, { tickets: db.support.filter((t) => t.userId === me.id).slice(-20).reverse().map((t) => ({ id: t.id, topic: t.topic, message: t.message, status: t.status, reply: t.reply || null, createdAt: t.createdAt })) });
    }
    if (req.method === "POST") {
      const { rateLimit } = require("./server/http");
      rateLimit("support:" + me.id, 6, 60 * 60 * 1000, "You’ve sent a few messages already. We’ll get back to you soon.");
      const body = await readJSON(req);
      const TOPICS = ["account", "bug", "safety", "groups", "videos", "messages", "other"];
      const topic = TOPICS.includes(body.topic) ? body.topic : "other";
      const message = String(body.message || "").trim().slice(0, 3000);
      if (message.length < 10) return sendJSON(res, 400, { error: "Tell us a bit more (at least 10 characters)." });
      const t = { id: crypto.randomUUID().slice(0, 8), userId: me.id, username: me.username, email: me.email || null, topic, message, page: String(body.page || "").slice(0, 200), userAgent: String(req.headers["user-agent"] || "").slice(0, 200), status: "open", createdAt: new Date().toISOString() };
      db.support.push(t);
      save("support");
      require("./server/admin").pingAdmins();
      console.log(`[support] #${t.id} ${topic} from @${me.username}: ${message.slice(0, 120)}`);
      return sendJSON(res, 201, { ticket: { id: t.id, topic, message, status: t.status, createdAt: t.createdAt } });
    }
  }

  // Report a bug in LookBlog: POST /api/bugs { what, steps, expected, area, page, screenshot, screen, lang }
  if (req.method === "POST" && url.pathname === "/api/bugs") {
    const { db } = require("./server/db");
    const { rateLimit } = require("./server/http");
    const { ownedMedia, markUsed } = require("./server/media");
    rateLimit("bug:" + me.id, 10, 60 * 60 * 1000, "Thanks — you’ve sent a few bug reports already. Try again a bit later.");
    const body = await readJSON(req);
    const what = String(body.what || "").trim().slice(0, 3000);
    if (what.length < 10) return sendJSON(res, 400, { error: "Tell us a bit more about the bug (at least 10 characters)." });
    let screenshot = null;
    if (body.screenshot) { const ok = ownedMedia(body.screenshot, me.id, "image"); if (ok) { screenshot = ok.url; markUsed(ok.url, "bug:" + me.id); } }
    const AREAS = ["feed", "posts", "videos", "shorts", "music", "cinema", "messages", "calls", "groups", "events", "profile", "notifications", "search", "other"];
    const t = {
      id: crypto.randomUUID().slice(0, 8), kind: "bug", userId: me.id, username: me.username, topic: "bug",
      area: AREAS.includes(body.area) ? body.area : "other", message: what,
      steps: String(body.steps || "").trim().slice(0, 2000), expected: String(body.expected || "").trim().slice(0, 1000),
      page: String(body.page || "").slice(0, 200), screen: String(body.screen || "").slice(0, 40), lang: String(body.lang || "").slice(0, 10),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 250), screenshot, status: "open", createdAt: new Date().toISOString(),
    };
    db.support.push(t);
    save("support");
    require("./server/admin").pingAdmins();
    console.log(`[bug] #${t.id} (${t.area}) from @${me.username} on ${t.page}: ${what.slice(0, 140)}`);
    return sendJSON(res, 201, { id: t.id });
  }

  // Site language: POST /api/me/lang { lang }
  if (req.method === "POST" && url.pathname === "/api/me/lang") {
    const lang = String((await readJSON(req)).lang || "");
    if (!["en", "bg", "es", "ru", "de", "sr", "ro"].includes(lang)) return sendJSON(res, 400, { error: "That language isn’t available." });
    me.lang = lang;
    save("users");
    return sendJSON(res, 200, { lang });
  }

  // Add my own "what I do": POST /api/me/roles/custom { name, emoji }
  if (req.method === "POST" && url.pathname === "/api/me/roles/custom") {
    const body = await readJSON(req);
    const name = String(body.name || "").trim().replace(/\s+/g, " ");
    if (!name || [...name].length > 24) return sendJSON(res, 400, { error: "Use 1 to 24 characters." });
    let emoji = String(body.emoji || "").trim();
    if (!emoji || [...emoji].length > 4 || !/\p{Extended_Pictographic}/u.test(emoji)) emoji = "✨";
    me.customRoles = me.customRoles || [];
    let role = me.customRoles.find((r) => r.name.toLowerCase() === name.toLowerCase()) || ROLES.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!role) {
      if (me.customRoles.length >= 10) return sendJSON(res, 400, { error: "You can make up to 10 of your own." });
      role = { id: "c-" + crypto.randomUUID().slice(0, 8), emoji, name };
      me.customRoles.push(role);
      save("users");
    }
    return sendJSON(res, 201, { role });
  }

  if (await handlePublicEvents(req, res, url, me)) return;
  if (await handleMusic(req, res, url, me)) return;
  if (await handleAccount(req, res, url, me)) return;
  if (await handleLinks(req, res, url, me)) return;
  if (await handleLeaderboard(req, res, url, me)) return;
  if (await handleStreams(req, res, url, me)) return;
  if (await handleAnalytics(req, res, url, me)) return;
  if (await handleStories(req, res, url, me)) return;
  if (await handleInstants(req, res, url, me)) return;
  if (handleReferrals(req, res, url, me)) return;
  if (await handleNotifications(req, res, url, me)) return;
  if (await handlePlaylists(req, res, url, me)) return;
  if (await handleChat(req, res, url, me)) return;
  if (await handleSocial(req, res, url, me)) return;

  sendJSON(res, 404, { error: "Not found." });
}

// STUN finds your public address; TURN relays the sound when two people can't reach each other directly
// (common on mobile networks). TURN comes from TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL, or from Metered
// (METERED_DOMAIN + METERED_API_KEY, fresh credentials every hour).
let turnCache = null;
async function iceServers() {
  const list = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
  if (process.env.TURN_URLS) list.push({ urls: process.env.TURN_URLS.split(",").map((x) => x.trim()), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
    if (!turnCache || Date.now() - turnCache.at > 60 * 60 * 1000) {
      try {
        const r = await fetch(`https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(process.env.METERED_API_KEY)}`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) turnCache = { at: Date.now(), list: (await r.json()).filter((x) => /^turns?:/.test(String(x.urls))) };
      } catch (err) { console.error("[turn]", err.message); }
    }
    if (turnCache) list.push(...turnCache.list);
  }
  return list;
}

// Work to do after answering. Locally right after; online just before the answer goes out
// (the server may sleep as soon as it has answered).
function afterAnswer(res, fn) {
  if (store.enabled) res.beforeEnd.push(fn);
  else res.on("finish", () => setImmediate(fn));
}

async function handle(req, res) {
  try {
    await ready();
  } catch (err) {
    // The database couldn't be reached: say so instead of crashing (the next request tries again)
    console.error("[db]", err.message);
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Retry-After": "2" });
    return res.end(JSON.stringify({ error: "LookBlog is waking up. Try again in a moment." }));
  }
  if (store.enabled) {
    // What other servers changed. If that fails, carry on with what's in memory.
    await sync().catch((err) => console.error("[sync]", err.message));
    runDue(); // jobs that are due
    // Write everything and send live updates before the answer leaves
    res.beforeEnd = [];
    const end = res.end.bind(res);
    res.end = (...args) => {
      Promise.resolve()
        .then(() => { for (const fn of res.beforeEnd.splice(0)) fn(); })
        .then(() => Promise.all([flush(), flushRealtime()]))
        .catch((err) => console.error("[store]", err))
        .finally(() => end(...args));
      return res;
    };
  }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;
  try {
    if (p.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end();
    }
    if (p.startsWith("/media/")) return serveMedia(req, res, p.slice("/media/".length));

    const loggedIn = Boolean(sessionUser(req));
    if (p === "/" || p === "/index.html") {
      // Logged-in people go straight to their feed (unless they opened a password reset link)
      if (loggedIn && !url.searchParams.has("reset") && !url.searchParams.has("add")) return redirect(res, "/feed");
      return servePublic(res, "index.html");
    }
    // The admin panel: its own log in, separate from LookBlog accounts
    if (p === "/admin-panel") return servePublic(res, "admin-panel.html");
    // About, Help and the policies: open to everyone
    const info = { "/about": "about", "/help": "help", "/terms": "terms", "/privacy": "privacy", "/cookies": "cookies" }[p];
    if (info) return servePublic(res, `info/${info}.html`);
    // An invite link: "Join LookBlog" (with the logo when it's shared)
    if (/^\/join\/[a-z0-9]{4,12}$/i.test(p)) return serveJoinPage(req, res, p.slice(6));
    if (/^\/doodle\/[a-z]+(?:_[a-z]+)?-\d{1,10}\.svg$/.test(p)) return require("./server/doodles").serveDoodle(res, p.slice(8));
    if (APP_PAGES.some((re) => re.test(p))) {
      if (!loggedIn) return redirect(res, "/");
      return servePublic(res, "app.html");
    }
    return servePublic(res, decodeURIComponent(p).replace(/^\/+/, ""));
  } catch (err) {
    if (!err.expose) console.error(err);
    if (res.headersSent) return res.end();
    sendJSON(res, err.status || 500, { error: err.expose ? err.message : "Something went wrong.", ...(err.extra || {}) });
  }
}

// Online (Vercel) api/index.js calls handle(); locally this file runs its own server
if (require.main === module) {
  const server = http.createServer(handle);
  server.requestTimeout = 30 * 60 * 1000; // big video uploads can take a while
  server.listen(PORT, () => {
    console.log(`LookBlog is running at http://localhost:${PORT}`);
  });
}

module.exports = { handle };
