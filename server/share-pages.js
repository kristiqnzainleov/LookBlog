// Links shared outside LookBlog (Discord, Instagram, Messenger, WhatsApp, X…): a post, a video, a short or a profile.
// Their link previews read the page's Open Graph tags, so the page has the title, the text, the picture and,
// for videos, the video itself (Discord plays it right in the chat). People without an account see a small
// preview with "Open in LookBlog". Only public things show what's in them; private ones show a plain card.
const { db } = require("./db");
const { mediaAddress } = require("./media");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const origin = (req) => `${req.headers["x-forwarded-proto"] === "https" || process.env.VERCEL ? "https" : "http"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const findUser = (id) => db.users.find((u) => u.id === id);

function page(res, { base, path, title, desc, image, imageW, imageH, video, author, body, type = "website", look = null, accent = null }) {
  const url = base + path;
  const img = image || `${base}/og/join.jpg`;
  const head = [
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:site_name" content="LookBlog">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    image && imageW ? `<meta property="og:image:width" content="${imageW}"><meta property="og:image:height" content="${imageH}">` : !image ? `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : "",
    video ? `<meta property="og:video" content="${esc(video.url)}"><meta property="og:video:secure_url" content="${esc(video.url)}"><meta property="og:video:type" content="video/mp4">${video.w ? `<meta property="og:video:width" content="${video.w}"><meta property="og:video:height" content="${video.h}">` : ""}` : "",
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">`,
    `<meta name="theme-color" content="${esc(/^#[0-9a-f]{6}$/i.test(accent || "") ? accent : "#ff4fa3")}">`,
    `<link rel="alternate" type="application/json+oembed" href="${esc(base + "/oembed?url=" + encodeURIComponent(url))}" title="${esc(title)}">`,
    author ? `<meta name="author" content="${esc(author)}">` : "",
  ].filter(Boolean).join("\n");
  const next = encodeURIComponent(path);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
  res.end(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · LookBlog</title>
<meta name="description" content="${esc(desc)}">
${head}
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;900&family=Golos+Text:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/app.css">
<style>
:root { --pink: #ff4fa3; --ink: #0d0c0c; --paper: #f5f0f0; --card: #161414; --card-2: #1f1c1c; --text: #f5f0f0; --muted: #a39b9b; --line: #2a2626; --body: "Golos Text", system-ui, sans-serif; --display: Unbounded, sans-serif; }
body { background-color: var(--ink) !important; }
.card { position: relative; overflow: hidden; }
.sp-banner { height: 96px; margin: -22px -22px 0; border-radius: 0; background: linear-gradient(135deg, var(--pink), #9b5cff) center / cover; }
.sp-banner.empty { opacity: .9; }
.card > .logo { position: relative; z-index: 1; margin-top: -72px; margin-bottom: 40px; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
.sp-av { position: relative; width: 60px; height: 60px; flex: 0 0 auto; }
.sp-av .avatar { width: 60px !important; height: 60px !important; border: 3px solid #161414; }
.sp-name { font-size: 1.15rem; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: radial-gradient(60% 50% at 50% 0%, rgba(255,79,163,.25), transparent 70%), var(--ink); color: var(--paper); font-family: "Golos Text", system-ui, sans-serif; }
.card { width: min(520px, 100%); padding: 22px; border-radius: 26px; background: #161414; border: 1px solid #2a2626; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
.logo { display: block; text-align: center; font-family: Unbounded, sans-serif; font-weight: 900; font-size: 1.6rem; letter-spacing: -0.05em; color: var(--paper); text-decoration: none; margin-bottom: 16px; }
.logo em { font-style: normal; color: var(--pink); }
.who { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.av { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: var(--paper); color: var(--ink); display: grid; place-items: center; font: 900 1.1rem Unbounded, sans-serif; flex: 0 0 auto; }
.who b { display: block; } .who span { color: #a39b9b; font-size: .9rem; }
.text { white-space: pre-wrap; line-height: 1.5; margin: 0 0 12px; font-size: 1.02rem; }
.media { display: block; width: 100%; max-height: 70vh; object-fit: contain; border-radius: 16px; background: #000; margin-bottom: 12px; }
h1 { font: 900 1.2rem Unbounded, sans-serif; margin: 0 0 8px; }
.btn { display: block; text-align: center; padding: 14px 18px; border-radius: 999px; background: var(--pink); color: #000; font-weight: 800; text-decoration: none; font-size: 1.02rem; box-shadow: 0 10px 30px rgba(255,79,163,.35); margin-top: 8px; }
.btn.ghost { background: transparent; color: var(--paper); box-shadow: none; border: 1px solid #3a3434; }
.muted { color: #8a8282; font-size: .85rem; text-align: center; margin-top: 12px; }
</style></head>
<body><main class="card">
  ${look !== null ? `<div class="sp-banner profile-banner${look.bannerImg ? "" : " empty"}"${look.bannerImg ? ` style="background-image:url('${esc(look.bannerImg)}')"` : ""}></div>` : ""}
  <a class="logo" href="/">Look<em>Blog</em></a>
  ${body}
  ${look !== null ? `<script type="module">
    import { applyLook, applyProfileLook } from "/js/components/profile-look.js";
    const look = ${JSON.stringify(look.look || {}).replace(/</g, "\\u003c")};
    const name = document.querySelector(".sp-name");
    if (name) applyLook(name, look);
    applyProfileLook({ avatarWrap: document.querySelector(".sp-av"), banner: document.querySelector(".sp-banner.empty"), card: null }, look);
    if (look.accent) document.documentElement.style.setProperty("--pink", look.accent);
  </script>` : ""}
  <a class="btn" href="/?next=${next}">Open in LookBlog</a>
  <a class="btn ghost" href="/?join=1&next=${next}">Join LookBlog</a>
  <p class="muted">Follow people, not the algorithm.</p>
</main></body></html>`);
}

const initials = (u) => esc(String(u?.name || "?").trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase() || "?");
const avatarHtml = (u) => `<div class="profile-avatar sp-av" style="--av:60px"><span class="avatar" style="--size:60px">${u?.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<span class="av-initials">${initials(u)}</span>`}</span></div>`;
const whoHtml = (u, extra = "") => `<div class="who">${avatarHtml(u)}<div><b class="sp-name">${esc(u?.name || "Someone")}</b>${u?.verified ? ` <span class="sp-tick" title="Verified">✔</span>` : ""}<span style="display:block">@${esc(u?.username || "")}${extra}</span></div></div>`;
// What of their look the page shows (what's on their profile anyway)
const lookOf = (u, base) => ({ look: u?.look ? Object.fromEntries(Object.entries(u.look).filter(([k]) => ["color", "font", "effect", "emoji", "anim", "accent", "ring", "shape", "deco", "photoAnim", "banner", "frame"].includes(k))) : {}, bannerImg: u?.banner ? mediaAddress(u.banner, base) || u.banner : null });
const avatarUrl = (u, base) => (u?.avatar ? (mediaAddress(u.avatar, base) || (u.avatar.startsWith("http") ? u.avatar : base + u.avatar)) : null);

// /post/:id and /watch/:id (posts, photos, shorts and videos)
function servePostPage(req, res, id, path) {
  const base = origin(req);
  const p = db.posts.find((x) => x.id === id && !x.deleted);
  const author = p && findUser(p.userId);
  const open = p && author && p.visibility !== "private" && !author.private && !author.banned && !(p.publishAt && Date.parse(p.publishAt) > Date.now());
  if (!open) return page(res, { base, path, title: "A post on LookBlog", desc: "Open it in LookBlog to see it.", body: `<h1>A post on LookBlog</h1><p class="text">Log in to see it.</p>` });
  const hidden = p.nsfw || p.sensitive || (p.media || []).some((m) => m.nsfw || m.sensitive);
  const video = (p.media || []).find((m) => m.kind === "video");
  const photo = (p.media || []).find((m) => m.kind === "image");
  const kind = p.film ? "movie" : p.type === "short" ? "short" : p.type === "video" ? "video" : photo ? "photo" : "post";
  const label = { movie: "🎬 Movie", short: "📱 Short", video: "▶️ Video", photo: "📷 Photo", post: "📝 Post" }[kind];
  const title = p.title ? `${clip(p.title, 80)} · ${author.name}` : `${author.name} on LookBlog`;
  const desc = clip(p.text || p.title || `${label} by @${author.username}`, 200) + (p.title && p.text ? "" : "");
  const videoUrl = video && !hidden ? mediaAddress(video.url, base) : null;
  const posterUrl = video?.poster && !hidden ? mediaAddress(video.poster, base) : null;
  const photoUrl = photo && !hidden ? mediaAddress(photo.url, base) : null;
  const image = posterUrl || photoUrl || avatarUrl(author, base);
  const sized = posterUrl || photoUrl ? (video || photo) : null;
  const mediaHtml = hidden ? `<p class="text">🔞 This one is marked as sensitive. Open it in LookBlog to see it.</p>`
    : videoUrl ? `<video class="media" src="${esc(videoUrl)}" ${posterUrl ? `poster="${esc(posterUrl)}"` : ""} controls playsinline preload="metadata"></video>`
    : photoUrl ? `<img class="media" src="${esc(photoUrl)}" alt="">` : "";
  page(res, {
    base, path, title, desc, image, imageW: sized?.width, imageH: sized?.height, author: author.name, look: lookOf(author, base), accent: author.look?.accent,
    type: videoUrl ? "video.other" : "article",
    video: videoUrl ? { url: videoUrl, w: video.width, h: video.height } : null,
    body: `${whoHtml(author, ` · ${label}`)}${p.title ? `<h1>${esc(p.title)}</h1>` : ""}${p.text ? `<p class="text">${esc(clip(p.text, 600))}</p>` : ""}${mediaHtml}`,
  });
}

// /u/:username (a profile)
function serveProfilePage(req, res, username, path) {
  const base = origin(req);
  const u = db.users.find((x) => x.username.toLowerCase() === String(username).replace(/^@/, "").toLowerCase());
  if (!u || u.banned) return page(res, { base, path, title: "LookBlog", desc: "Follow people, not the algorithm.", body: `<h1>This account isn’t here</h1>` });
  const followers = db.users.filter((x) => (x.following || []).includes(u.id)).length;
  const posts = db.posts.filter((x) => x.userId === u.id && x.visibility === "public").length;
  const desc = clip(u.private ? "A private account on LookBlog." : u.bio || `${followers} followers · ${posts} posts on LookBlog`, 200);
  page(res, {
    base, path, title: `${u.name} (@${u.username}) · LookBlog`, desc, image: avatarUrl(u, base), type: "profile", look: lookOf(u, base), accent: u.look?.accent,
    body: `${whoHtml(u)}<p class="text">${esc(desc)}</p><p class="muted">${followers} followers · ${posts} posts</p>`,
  });
}

// GET /oembed?url= — Discord (and others) show the author's name above the title, and LookBlog as the provider
function serveOembed(req, res, url) {
  const base = origin(req);
  let path = "";
  try { path = new URL(String(url || "")).pathname; } catch {}
  const out = { version: "1.0", type: "link", provider_name: "LookBlog", provider_url: base };
  let m;
  if ((m = path.match(/^\/(post|watch)\/([\w-]+)$/))) {
    const p = db.posts.find((x) => x.id === m[2] && !x.deleted), a = p && findUser(p.userId);
    if (p && a && p.visibility !== "private" && !a.private) Object.assign(out, { title: clip(p.title || p.text || "", 120), author_name: `${a.name} (@${a.username})${a.verified ? " ✔" : ""}`, author_url: `${base}/u/${a.username}` });
  } else if ((m = path.match(/^\/u\/([^/]+)$/))) {
    const u = db.users.find((x) => x.username.toLowerCase() === decodeURIComponent(m[1]).toLowerCase());
    if (u) Object.assign(out, { author_name: `${u.name} (@${u.username})${u.verified ? " ✔" : ""}`, author_url: `${base}/u/${u.username}` });
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(out));
}

module.exports = { servePostPage, serveProfilePage, serveOembed };
