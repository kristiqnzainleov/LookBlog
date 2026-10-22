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
    `<meta name="theme-color" content="#ff4fa3">`,
    `<link rel="alternate" type="application/json+oembed" href="${esc(base + "/oembed?url=" + encodeURIComponent(url))}" title="${esc(title)}">`,
    author ? `<meta name="author" content="${esc(author)}">` : "",
  ].filter(Boolean).join("\n");
  const next = encodeURIComponent(path);
  // Its one small script runs with a one-time nonce (scripts are otherwise only allowed from files)
  const nonce = require("crypto").randomBytes(16).toString("base64");
  // (every small script in the page gets it: the video player's too)
  body = String(body || "").replace(/<script type="module">/g, `<script type="module" nonce="${nonce}">`);
  // Not kept by the CDN: it can't tell logged-in people apart, and they must get LookBlog itself, not this page
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Vary": "Cookie",
    "Content-Security-Policy": `script-src 'self' 'nonce-${nonce}'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'` });
  res.end(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · LookBlog</title>
<meta name="description" content="${esc(desc)}">
${head}
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link href="/fonts/26761d630a.css" rel="stylesheet">
<link rel="stylesheet" href="/app.css">
<style>
:root { --pink: #ff4fa3; --ink: #0d0c0c; --paper: #f5f0f0; --card: #161414; --card-2: #1f1c1c; --text: #f5f0f0; --muted: #a39b9b; --line: #2a2626; --body: "Golos Text", system-ui, sans-serif; --display: Unbounded, sans-serif; }
body { background-color: var(--ink) !important; }
[hidden] { display: none !important; }
.card { position: relative; overflow: hidden; }
.wrap { width: min(520px, 100%); display: flex; flex-direction: column; align-items: stretch; gap: 18px; }
.sp-av { position: relative; width: 60px; height: 60px; flex: 0 0 auto; }
.sp-av .avatar { width: 60px !important; height: 60px !important; border: 3px solid #161414; }
.sp-name { font-size: 1.15rem; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: radial-gradient(60% 50% at 50% 0%, rgba(255,79,163,.25), transparent 70%), var(--ink); color: var(--paper); font-family: "Golos Text", system-ui, sans-serif; }
.card { width: 100%; padding: 22px; border-radius: 26px; background: #161414; border: 1px solid #2a2626; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
.logo { display: block; text-align: center; font-family: Unbounded, sans-serif; font-weight: 900; font-size: 2.1rem; letter-spacing: -0.05em; color: var(--paper); text-decoration: none; }
.logo em { font-style: normal; color: var(--pink); }
.logo { line-height: 1; user-select: none; }
.eye { --close: 0; position: relative; display: inline-block; width: 0.6em; height: 0.6em; margin: 0 0.035em; border-radius: 50%; background: var(--paper); vertical-align: -0.02em; overflow: hidden; isolation: isolate; }
.pupil { position: absolute; left: 50%; top: 50%; width: 0.27em; height: 0.27em; border-radius: 50%; background: var(--ink); transform: translate(-50%, -50%); will-change: transform; }
.pupil::after { content: ""; position: absolute; top: 18%; left: 22%; width: 28%; height: 28%; border-radius: 50%; background: var(--paper); }
.lid { position: absolute; left: -5%; width: 110%; background: #ddd3c5; transition: transform 0.22s cubic-bezier(0.45, 0, 0.25, 1); }
.lid-top { top: 0; height: 58%; z-index: 2; border-bottom: 0.035em solid var(--ink); border-radius: 0 0 50% 50% / 0 0 38% 38%; transform: translateY(calc((var(--close) - 1) * 104%)); }
.lid-bottom { bottom: 0; height: 50%; z-index: 1; border-top: 0.02em solid var(--ink); border-radius: 50% 50% 0 0 / 22% 22% 0 0; transform: translateY(calc((1 - var(--close)) * 104%)); }
.eye.blink { --close: 1; } .eye.blink .lid { transition-duration: 0.09s; }
.logo { position: relative; display: block; width: fit-content; margin: 0 auto; }
.logo.asleep .eye { --close: 1; }
.logo.asleep .lid { transition-duration: 1.4s; transition-timing-function: ease-in; }
.logo.waking .eye { animation: eyeWake 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes eyeWake { 0% { transform: scale(0.9); } 40% { transform: scale(1.18); } 100% { transform: scale(1); } }
.zzz { position: absolute; left: 100%; top: -0.2em; pointer-events: none; font-family: Unbounded, sans-serif; font-weight: 900; color: var(--pink); font-size: 0.42em; line-height: 1; }
.zzz i { position: absolute; font-style: normal; opacity: 0; }
.logo.asleep .zzz i { animation: zFloat 3s ease-in-out infinite; }
.logo.asleep .zzz i:nth-child(2) { animation-delay: 1s; font-size: 1.25em; }
.logo.asleep .zzz i:nth-child(3) { animation-delay: 2s; font-size: 1.55em; }
@keyframes zFloat { 0% { opacity: 0; transform: translate(0, 0.4em) rotate(-10deg); } 20% { opacity: 1; } 80% { opacity: 0.9; } 100% { opacity: 0; transform: translate(1.4em, -1.6em) rotate(12deg); } }
.who b.sp-name { display: inline; }
.sp-tick { display: inline-flex; vertical-align: -3px; margin-left: 4px; }
.sp-tick svg { width: 20px; height: 20px; }
.who { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.av { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: var(--paper); color: var(--ink); display: grid; place-items: center; font: 900 1.1rem Unbounded, sans-serif; flex: 0 0 auto; }
.who b { display: block; } .who span { color: #a39b9b; font-size: .9rem; }
.text { white-space: pre-wrap; line-height: 1.5; margin: 0 0 12px; font-size: 1.02rem; }
.media { display: block; width: 100%; max-height: 70vh; object-fit: contain; border-radius: 16px; background: #000; margin-bottom: 12px; }
.sp-player { margin-bottom: 12px; border-radius: 16px; overflow: hidden; cursor: pointer; }
.sp-player .lb-player { border-radius: 16px; }
.sp-player.vertical .lb-player { max-height: 70vh; margin: 0 auto; }
h1 { font: 900 1.2rem Unbounded, sans-serif; margin: 0 0 8px; }
.btn { display: block; text-align: center; padding: 14px 18px; border-radius: 999px; background: var(--pink); color: #000; font-weight: 800; text-decoration: none; font-size: 1.02rem; box-shadow: 0 10px 30px rgba(255,79,163,.35); margin-top: 8px; }
.btn.ghost { background: transparent; color: var(--paper); box-shadow: none; border: 1px solid #3a3434; }
.muted { color: #8a8282; font-size: .85rem; text-align: center; margin-top: 12px; }
.sp-story { position: relative; display: block; width: min(300px, 100%); aspect-ratio: 9 / 16; margin: 14px auto 0; border-radius: 18px; overflow: hidden; background: #000; box-shadow: 0 0 0 3px #ff4fa3, 0 18px 40px rgba(0,0,0,.5); }
.sp-story img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sp-story-play { position: absolute; inset: 0; display: grid; place-items: center; font-size: 3rem; color: #fff; text-shadow: 0 4px 20px rgba(0,0,0,.6); }
.sp-story-text { position: absolute; left: 12px; right: 12px; bottom: 14px; padding: 8px 12px; border-radius: 12px; background: rgba(0,0,0,.55); color: #fff; font-weight: 700; text-align: center; }
.sp-hl { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 16px auto 0; color: inherit; text-decoration: none; }
.sp-hl-ring { width: 120px; height: 120px; border-radius: 50%; padding: 4px; background: conic-gradient(#ff4fa3, #ffb86b, #9b5cff, #ff4fa3); }
.sp-hl-ring img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; border: 4px solid #161414; display: block; }
.sp-hl small { color: #a39b9b; }
</style></head>
<body><div class="wrap">
  <a class="logo" href="/" aria-label="LookBlog"><span aria-hidden="true">L<span class="eye"><span class="pupil"></span><span class="lid lid-top"></span><span class="lid lid-bottom"></span></span><span class="eye"><span class="pupil"></span><span class="lid lid-top"></span><span class="lid lid-bottom"></span></span>k<em>Blog</em></span></a>
  <main class="card">
  ${body}
  ${look !== null ? `<script type="module" nonce="${nonce}">
    import { applyLook, applyProfileLook } from "/js/components/profile-look.js";
    import { tick } from "/js/ui.js";
    // The same verification tick as on LookBlog (its kind: creator, artist, rapper…)
    const t = document.querySelector(".sp-tick");
    if (t) { const svg = tick({ verified: true, verifiedType: t.dataset.type }, 20); if (svg) t.replaceChildren(svg); }
    const look = ${JSON.stringify(look.look || {}).replace(/</g, "\\u003c")};
    const name = document.querySelector(".sp-name");
    if (name) applyLook(name, look);
    applyProfileLook({ avatarWrap: document.querySelector(".sp-av"), card: null }, look);
  </script>` : ""}
  <a class="btn" href="/?next=${next}">Open in LookBlog</a>
  <a class="btn ghost" href="/?join=1&next=${next}">Join LookBlog</a>
  <p class="muted">Follow people, not the algorithm.</p>
</main></div>
<script src="/eyes.js" defer></script></body></html>`);
}

const initials = (u) => esc(String(u?.name || "?").trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase() || "?");
const avatarHtml = (u) => `<div class="profile-avatar sp-av" style="--av:60px"><span class="avatar" style="--size:60px">${u?.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<span class="av-initials">${initials(u)}</span>`}</span></div>`;
const whoHtml = (u, extra = "") => `<div class="who">${avatarHtml(u)}<div><b class="sp-name">${esc(u?.name || "Someone")}</b>${u?.verified ? `<span class="sp-tick" title="Verified" data-type="${esc(u.verifiedType || "creator")}">✔</span>` : ""}<span style="display:block">@${esc(u?.username || "")}${extra}</span></div></div>`;
// What of their look the page shows (what's on their profile anyway)
const lookOf = (u, base) => ({ look: u?.look ? Object.fromEntries(Object.entries(u.look).filter(([k]) => ["color", "font", "effect", "anim", "ring", "shape", "photoAnim", "banner", "frame"].includes(k))) : {}, bannerImg: u?.banner ? mediaAddress(u.banner, base) || u.banner : null });
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
  const label = { movie: "Movie", short: "Short", video: "Video", photo: "Photo", post: "Post" }[kind];
  const title = p.title ? `${clip(p.title, 80)} · ${author.name}` : `${author.name} on LookBlog`;
  const desc = clip(p.text || p.title || `${label} by @${author.username}`, 200) + (p.title && p.text ? "" : "");
  const videoUrl = video && !hidden ? mediaAddress(video.url, base) : null;
  const posterUrl = video?.poster && !hidden ? mediaAddress(video.poster, base) : null;
  const photoUrl = photo && !hidden ? mediaAddress(photo.url, base) : null;
  const image = posterUrl || photoUrl || avatarUrl(author, base);
  const sized = posterUrl || photoUrl ? (video || photo) : null;
  const mediaHtml = hidden ? `<p class="text">🔞 This one is marked as sensitive. Open it in LookBlog to see it.</p>`
    : videoUrl ? `<div class="sp-player${p.type === "short" ? " vertical" : ""}" data-cfg="${esc(JSON.stringify({ src: video.url, poster: video.poster || null, width: video.width || null, height: video.height || null, vertical: p.type === "short", sources: video.renditions || [], knownDuration: video.duration || null }))}"><video class="media" src="${esc(videoUrl)}" ${posterUrl ? `poster="${esc(posterUrl)}"` : ""} controls playsinline preload="metadata"></video></div>
      <script type="module">
        // LookBlog's own player (pink bar, big play button, speed, quality, full screen) instead of the browser's
        import { createPlayer } from "/js/components/player.js";
        const box = document.querySelector(".sp-player");
        try { const player = createPlayer(JSON.parse(box.dataset.cfg)); box.replaceChildren(player); } catch {}
        // Pressing play (or anywhere on the video) takes you to LookBlog, to watch it there
        const go = (e) => { e.preventDefault(); e.stopPropagation(); location.href = "/?next=" + encodeURIComponent(location.pathname); };
        box.addEventListener("click", go, true);
        box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); }, true);
        box.title = "Watch it on LookBlog";
      </script>`
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

// /story/:id — a story someone shared (a public account's, while it's up or in a highlight)
function serveStoryPage(req, res, id, path) {
  const base = origin(req);
  const found = require("./stories").publicStory(id);
  if (!found) return page(res, { base, path, title: "A story on LookBlog", desc: "Stories are for followers. Open it in LookBlog to see it.", body: `<h1>A story on LookBlog</h1><p class="text">Log in to see it.</p>` });
  const { story: s, owner, thumb } = found;
  const hidden = s.media.nsfw || s.media.sensitive;
  const img = !hidden && thumb ? mediaAddress(thumb, base) : null;
  page(res, {
    base, path, title: `${owner.name}’s story · LookBlog`, desc: clip(s.text || `A story by @${owner.username} on LookBlog`, 200),
    image: img || avatarUrl(owner, base), imageW: img ? s.media.width : null, imageH: img ? s.media.height : null, author: owner.name, look: lookOf(owner, base), accent: owner.look?.accent,
    body: `${whoHtml(owner, " · Story")}${img ? `<a class="sp-story" href="/?next=${encodeURIComponent(path)}"><img src="${esc(img)}" alt="">${s.media.kind === "video" ? `<span class="sp-story-play">▶</span>` : ""}${s.text ? `<span class="sp-story-text">${esc(clip(s.text, 140))}</span>` : ""}</a>` : `<p class="text">🔞 Open it in LookBlog to see it.</p>`}`,
  });
}
// /highlight/:id — a highlight from someone's profile
function serveHighlightPage(req, res, id, path) {
  const base = origin(req);
  const found = require("./stories").publicHighlight(id);
  if (!found) return page(res, { base, path, title: "A highlight on LookBlog", desc: "Open it in LookBlog to see it.", body: `<h1>A highlight on LookBlog</h1><p class="text">Log in to see it.</p>` });
  const { highlight: hl, owner } = found;
  const img = hl.cover ? mediaAddress(hl.cover, base) : null;
  page(res, {
    base, path, title: `${hl.title || "Highlight"} · ${owner.name} on LookBlog`, desc: `${hl.count} ${hl.count === 1 ? "story" : "stories"} by @${owner.username}`,
    image: img || avatarUrl(owner, base), author: owner.name, look: lookOf(owner, base), accent: owner.look?.accent,
    body: `${whoHtml(owner, " · Highlight")}<a class="sp-hl" href="/?next=${encodeURIComponent(path)}"><span class="sp-hl-ring">${img ? `<img src="${esc(img)}" alt="">` : ""}</span><b>${esc(hl.title || "Highlight")}</b><small>${hl.count} ${hl.count === 1 ? "story" : "stories"}</small></a>`,
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

module.exports = { servePostPage, serveProfilePage, serveStoryPage, serveHighlightPage, serveOembed };
