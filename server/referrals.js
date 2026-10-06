// Invites to LookBlog (a referral link): everyone has their own link, /join/<code>.
// Shared in Instagram, Messenger and others, the link shows the LookBlog logo and "Join LookBlog".
// Whoever signs up through it is remembered as invited by you, and you're told.
const crypto = require("crypto");
const { db, save, findUser } = require("./db");
const { sendJSON } = require("./http");
const { notify } = require("./notifications");

const COOKIE = "lb_ref";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const byCode = (code) => db.users.find((u) => u.inviteCode && u.inviteCode === String(code || "").toLowerCase());

function inviteCodeOf(u) {
  if (!u.inviteCode) {
    let code;
    do code = crypto.randomBytes(5).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 7);
    while (code.length < 6 || byCode(code));
    u.inviteCode = code;
    save("users");
  }
  return u.inviteCode;
}
const origin = (req) => `${req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http")}://${req.headers["x-forwarded-host"] || req.headers.host}`;

// GET /api/me/invite → my link and who joined with it
function handleReferrals(req, res, url, me) {
  if (!(req.method === "GET" && url.pathname === "/api/me/invite")) return false;
  const code = inviteCodeOf(me);
  const joined = db.users.filter((u) => u.referredBy === me.id).map((u) => ({ name: u.name, username: u.username, avatar: u.avatar, at: u.createdAt }));
  sendJSON(res, 200, { code, url: `${origin(req)}/join/${code}`, joined });
  return true;
}

// The page behind the link (for everyone, logged in or not)
function serveJoinPage(req, res, code) {
  const from = byCode(code);
  const base = origin(req);
  const title = "Join LookBlog";
  const desc = from ? `${from.name} (@${from.username}) invited you to LookBlog. Follow people, not the algorithm.` : "Follow people, not the algorithm. Join LookBlog.";
  const img = `${base}/og/join.jpg`;
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
  // Remember who invited you while you sign up (30 days)
  if (from) headers["Set-Cookie"] = `${COOKIE}=${from.inviteCode}; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax${base.startsWith("https") ? "; Secure" : ""}`;
  const avatar = from?.avatar ? `<img class="av" src="${esc(from.avatar)}" alt="">` : from ? `<span class="av">${esc(from.name.trim()[0] || "?").toUpperCase()}</span>` : "";
  res.writeHead(200, headers);
  res.end(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LookBlog">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(base + "/join/" + (from?.inviteCode || ""))}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="LookBlog: Join LookBlog">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;900&family=Golos+Text:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root { --pink: #ff4fa3; --ink: #0d0c0c; --paper: #f5f0f0; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: radial-gradient(60% 50% at 50% 0%, rgba(255,79,163,.28), transparent 70%), var(--ink); color: var(--paper); font-family: "Golos Text", system-ui, sans-serif; text-align: center; }
.card { width: min(440px, 100%); padding: 36px 24px 28px; border-radius: 28px; background: #161414; border: 1px solid #2a2626; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
.logo { font-family: Unbounded, sans-serif; font-weight: 900; font-size: 2.6rem; letter-spacing: -0.05em; }
.logo em { font-style: normal; color: var(--pink); }
.av { display: inline-grid; place-items: center; width: 76px; height: 76px; margin: 22px auto 10px; border-radius: 50%; object-fit: cover; background: var(--paper); color: var(--ink); font: 900 1.8rem Unbounded, sans-serif; border: 3px solid var(--pink); }
h1 { margin: 18px 0 6px; font: 900 1.7rem Unbounded, sans-serif; }
p { margin: 0 0 22px; color: #b9b0b0; line-height: 1.5; }
.btn { display: block; padding: 15px 20px; border-radius: 999px; background: var(--pink); color: #000; font-weight: 800; text-decoration: none; font-size: 1.05rem; box-shadow: 0 10px 30px rgba(255,79,163,.4); }
.sub { margin-top: 14px; font-size: .85rem; color: #8a8282; }
.sub a { color: var(--paper); }
</style></head>
<body><main class="card">
  <div class="logo">Look<em>Blog</em></div>
  ${avatar}
  <h1>Join LookBlog</h1>
  <p>${from ? `<b>${esc(from.name)}</b> (@${esc(from.username)}) invited you.<br>` : ""}Follow people, not the algorithm.</p>
  <a class="btn" href="/?join=1">Join LookBlog</a>
  <div class="sub">Already have an account? <a href="/">Log in</a></div>
</main></body></html>`);
}

// Signing up: whoever invited you (from the link's cookie) is remembered, and told
function creditReferral(req, user) {
  const code = (String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-z0-9]+)`)) || [])[1];
  const from = code && byCode(code);
  if (!from || from.id === user.id) return [];
  user.referredBy = from.id;
  save("users");
  notify(from.id, "referral", user, { text: "joined LookBlog with your invite" });
  return [`${COOKIE}=; Path=/; Max-Age=0`];
}

module.exports = { handleReferrals, serveJoinPage, creditReferral };
