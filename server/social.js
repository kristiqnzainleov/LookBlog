// Posts, shorts, videos, comments, reactions, views, follows, profiles and search.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { db, save, findUser, findByUsername, findPost } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { ownedMedia, markUsed, deleteMedia } = require("./media");
const { broadcast, sendTo, presence } = require("./realtime");
const { notify } = require("./notifications");
const { every } = require("./ticker");

// What you need before you can apply for the tick
const VERIFY_MIN = { followers: 1000, posts: 10 };
const LIMITS = { postText: 1000, caption: 300, title: 100, description: 5000, comment: 1000, bio: 160, name: 50 };
const SHORT_MAX_SECONDS = 90;
const PAGE = 20;
const TYPES = ["post", "short", "video"];

const clean = (v) => String(v || "").replace(/\r\n?/g, "\n").trim();

// "@mila_iv" in a text tags that person (only real accounts count)
const MENTION_RE = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{3,15})\b/g;
function findMentions(...texts) {
  const ids = new Set();
  for (const t of texts) {
    for (const m of String(t || "").matchAll(MENTION_RE)) {
      const u = findByUsername(m[2]);
      if (u) ids.add(u.id);
    }
  }
  return [...ids];
}
const usernamesOf = (ids) => (ids || []).map((id) => findUser(id)?.username).filter(Boolean);
// People tagged in a post ("with Mila and Desi"): usernames → ids, no blocked people, up to 20
function resolveTags(list, me) {
  if (!Array.isArray(list)) return [];
  const ids = [];
  for (const name of list.slice(0, 40)) {
    const u = findByUsername(String(name || "").replace(/^@/, ""));
    if (!u || u.id === me.id || ids.includes(u.id) || blockedBetween(u, me)) continue;
    ids.push(u.id);
    if (ids.length >= 20) break;
  }
  return ids;
}
// A trim / cut list from the editor, checked and tidied
function cleanClip(body, duration) {
  if (!body || body.reset) return null;
  const D = Number(duration) || 36000;
  const num = (x) => Math.max(0, Math.min(D, Math.round((Number(x) || 0) * 100) / 100));
  const start = num(body.start), end = body.end == null ? D : num(body.end);
  if (end - start < 1) throw httpError(400, "Keep at least one second.");
  const cuts = (Array.isArray(body.cuts) ? body.cuts : []).slice(0, 30)
    .map((x) => [num(x[0]), num(x[1])]).filter(([a, b]) => b - a >= 0.2 && a >= start && b <= end).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const cut of cuts) { const last = merged[merged.length - 1]; if (last && cut[0] <= last[1]) last[1] = Math.max(last[1], cut[1]); else merged.push(cut); }
  const kept = end - start - merged.reduce((n, [a, b]) => n + (b - a), 0);
  if (kept < 1) throw httpError(400, "Keep at least one second.");
  if (start === 0 && end >= D - 0.05 && !merged.length) return null;
  return { start, end, cuts: merged, length: Math.round(kept * 10) / 10 };
}
// Who is tagged in a post: everyone @mentioned (and older tags), minus people who removed themselves
const taggedIds = (p) => [...new Set(p.mentions || [])].filter((id) => id !== p.userId && !(p.untagged || []).includes(id));
// Reach: each person counts once, the first day the post reached them (seen on screen or opened)
function markReached(p, user) {
  if (!p.reachedBy) p.reachedBy = [...new Set([...(p.viewedBy || []), ...(p.impressedBy || [])])].filter((id) => id !== user.id);
  if (p.reachedBy.includes(user.id)) return;
  p.reachedBy.push(user.id);
  const day = new Date().toISOString().slice(0, 10);
  p.reachDaily = p.reachDaily || {};
  p.reachDaily[day] = (p.reachDaily[day] || 0) + 1;
  if (user.following.includes(p.userId)) p.reachFollowers = (p.reachFollowers || 0) + 1;
}
function notifyMentions(ids, me, what) {
  const others = ids.filter((id) => id !== me.id);
  for (const id of others) notify(id, "mention", me, { postId: what.postId, text: what.text });
}
const chars = (s) => [...s].length;

/* ---------- Who can see a post ----------
   public:   everywhere
   unlisted: only with the link (not in feeds, search or the profile for other people)
   private:  only the person who posted it */
const VISIBILITY = ["public", "unlisted", "private"];
// Blocked (either way) = you don't see each other's things
const blockedBetween = (a, b) => Boolean(a && b && a.id !== b.id && ((a.blocked || []).includes(b.id) || (b.blocked || []).includes(a.id)));
// A private account's posts are only for its followers
const locked = (user, me) => Boolean(user.private && user.id !== me.id && !me.following.includes(user.id));
function canView(p, me) {
  if (p.userId === me.id) return true;
  if (p.visibility === "private") return false;
  const author = findUser(p.userId);
  if (!author) return true;
  return !blockedBetween(author, me) && !locked(author, me);
}
function viewablePost(id, me) {
  const p = findPost(id);
  return p && canView(p, me) ? p : null;
}

/* ---------- GIFs: LookBlog's own pack, GIFs people uploaded, and your collection ---------- */
let GIF_PACK = [];
try { GIF_PACK = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "gifs", "pack.json"), "utf8")); } catch {}
// GIPHY (the library Instagram uses): only links to GIPHY's own media servers
const GIPHY_RE = /^https:\/\/(media\d?|i)\.giphy\.com\/media\/[\w./-]{1,160}$/;
const knownGif = (u) => GIF_PACK.some((g) => g.url === u) || GIPHY_RE.test(u) || (u.startsWith("/media/") && db.users.some((x) => x.gifs.some((g) => g.url === u)));
// GIPHY search and trending, 30 at a time, remembered for 10 minutes so we stay well inside the API limits
const GIPHY_KEY = process.env.GIPHY_API_KEY || "";
const giphyCache = new Map();
async function giphy(q, offset) {
  if (!GIPHY_KEY) return null;
  const key = q + "|" + offset, hit = giphyCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const u = new URL("https://api.giphy.com/v1/gifs/" + (q ? "search" : "trending"));
  u.search = new URLSearchParams({ api_key: GIPHY_KEY, limit: "30", offset: String(offset), rating: "pg-13", bundle: "messaging_non_clips", ...(q ? { q, lang: "en" } : {}) });
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error("GIPHY " + r.status);
    const j = await r.json();
    const strip = (x) => String(x || "").split("?")[0];
    const results = (j.data || []).map((g) => {
      const full = g.images?.downsized_medium || g.images?.original, small = g.images?.fixed_width || full;
      return { url: strip(full?.url), preview: strip(small?.webp || small?.url), w: Number(small?.width) || 200, h: Number(small?.height) || 150, title: g.title || "GIF", source: "giphy" };
    }).filter((g) => GIPHY_RE.test(g.url) && GIPHY_RE.test(g.preview));
    const total = j.pagination?.total_count ?? 0, next = offset + (j.pagination?.count || results.length);
    const data = { results, next: results.length && next < Math.min(total, 4999) ? next : null };
    if (giphyCache.size > 500) giphyCache.clear();
    giphyCache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) { console.error("[giphy]", err.message); return null; }
}
// Stickers and sounds you can send anywhere: yours, the group's (only inside that group), or a built-in sound
const BUILTIN_SOUND_IDS = ["airhorn", "tada", "drum", "boing", "ding", "sad"];
function resolveExtras(body, me, chat = null) {
  if (body.sticker) {
    const s = (me.stickers || []).find((x) => x.id === body.sticker);
    if (!s) throw httpError(404, "That sticker isn’t in your collection.");
    return { url: s.url, kind: "image", sticker: true };
  }
  if (body.groupSticker) {
    const s = chat?.kind === "group" && (chat.stickers || []).find((x) => x.id === body.groupSticker);
    if (!s) throw httpError(404, "That group sticker is gone.");
    return { url: s.url, kind: "image", sticker: true };
  }
  if (body.mySound) {
    const s = (me.sounds || []).find((x) => x.id === body.mySound);
    if (!s) throw httpError(404, "That sound isn’t in your collection.");
    return { kind: "sound", url: s.url, name: s.name, emoji: s.emoji, shared: true };
  }
  if (body.groupSound) {
    const s = chat?.kind === "group" && (chat.sounds || []).find((x) => x.id === body.groupSound);
    if (!s) throw httpError(404, "That group sound is gone.");
    return { kind: "sound", url: s.url, name: s.name, emoji: s.emoji, shared: true };
  }
  if (body.builtinSound) {
    if (chat?.kind !== "group") throw httpError(400, "Built-in sounds are for groups. Send one of your own sounds.");
    if (!BUILTIN_SOUND_IDS.includes(body.builtinSound)) throw httpError(400, "Pick a sound.");
    return { kind: "sound", builtin: body.builtinSound, name: body.builtinSound, emoji: "🔊", shared: true };
  }
  return null;
}
function resolveGif(body, me) {
  if (body.gif) {
    const g = me.gifs.find((x) => x.id === body.gif);
    if (!g) throw httpError(404, "That GIF isn’t in your collection.");
    return { url: g.url, kind: "image", gif: true };
  }
  if (body.gifUrl) {
    const u = String(body.gifUrl);
    if (knownGif(u)) return { url: u, kind: "image", gif: true };
    throw httpError(400, "That GIF can’t be used.");
  }
  return null;
}

/* ---------- Shapes sent to the browser ---------- */
// Who's live right now (refreshed every 2 seconds, so authorView stays cheap)
let liveCache = { at: 0, map: new Map() };
function liveOf(id) {
  if (Date.now() - liveCache.at > 2000) liveCache = { at: Date.now(), map: new Map((db.streams || []).filter((s) => s.live).map((s) => [s.userId, s.id])) };
  return liveCache.map.get(id) || null;
}
function authorView(u) {
  if (!u) return { name: "Deleted account", username: "", avatar: null, verified: false };
  const live = liveOf(u.id);
  return { name: u.name, username: u.username, avatar: u.avatar, verified: Boolean(u.verified), verifiedType: u.verified ? u.verifiedType || "creator" : null, ...(live ? { live } : {}) };
}

/* ---------- Notes: a short line or emoji that disappears after 24 hours ---------- */
const NOTE_MS = 24 * 60 * 60 * 1000;
function activeNote(u) {
  if (!u.note) return null;
  if (Date.now() - new Date(u.note.createdAt).getTime() > NOTE_MS) return null;
  return { text: u.note.text || "", media: u.note.media || null, color: u.note.color || null, deco: u.note.deco || null, createdAt: u.note.createdAt, expiresAt: new Date(new Date(u.note.createdAt).getTime() + NOTE_MS).toISOString() };
}

/* ---------- Polls ---------- */
function pollView(p, me) {
  if (!p.poll) return null;
  const total = p.poll.options.reduce((n, o) => n + o.votes.length, 0);
  const mine = p.poll.options.find((o) => o.votes.includes(me.id));
  const ended = Date.now() > new Date(p.poll.endsAt).getTime();
  const show = Boolean(mine) || ended || p.userId === me.id;
  return {
    options: p.poll.options.map((o) => ({ id: o.id, text: o.text, count: show ? o.votes.length : null })),
    total,
    myVote: mine ? mine.id : null,
    ended,
    endsAt: p.poll.endsAt,
  };
}
function categoryOf(p) {
  if (!p.categoryId) return null;
  const owner = findUser(p.userId);
  const c = owner?.categories.find((x) => x.id === p.categoryId);
  return c ? { id: c.id, name: c.name } : null;
}
function followerCount(user) {
  return db.users.filter((u) => u.following.includes(user.id)).length;
}
// Replies: off when the author turned them off; never on movies, series episodes or recorded lives
const isEpisode = (p) => p.type === "video" && db.playlists.some((x) => x.kind === "series" && x.videoIds.includes(p.id));
// "Videos" means normal videos: not movies, not series episodes, not recorded lives
const notPlainVideo = (p) => Boolean(p.film || p.stream || isEpisode(p));
// (movies and past lives can have replies; series episodes don't)
function repliesClosed(p) {
  if (isEpisode(p)) return "episode";
  if (p.repliesOff) return "off";
  return null;
}
// Star ratings (1–5) for movies and series: the average of everyone's stars
function starsView(map, me) {
  const vals = Object.values(map || {}).filter((n) => n >= 1 && n <= 5);
  return { avg: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null, count: vals.length, mine: (map || {})[me.id] || null };
}
function stats(p) {
  return { likes: p.likes.length, dislikes: p.dislikes.length, views: p.viewedBy.length, comments: p.commentCount, reposts: p.reposts.length, cools: p.cools.length, shares: p.shares || 0 };
}
function postView(p, me) {
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    text: p.text,
    media: p.media,
    film: p.film || null,
    stars: p.film ? starsView(p.stars, me) : null,
    stream: p.stream || null,
    replyTo: p.replyTo ? (() => { const o = findPost(p.replyTo); return o && canView(o, me) ? { id: o.id, type: o.type, title: o.title || o.text.slice(0, 60), author: authorView(findUser(o.userId)) } : { gone: true }; })() : null,
    publishAt: p.publishAt || null,
    episode: isEpisode(p),
    noReplies: repliesClosed(p),
    timedComments: Boolean(p.timedComments),
    momentReactions: Boolean(p.momentReactions),
    moments: p.momentReactions ? (p.moments || []).slice(-600).map((x) => ({ at: x.at, emoji: x.emoji })) : [],
    myMoments: p.momentReactions ? (p.moments || []).filter((x) => x.userId === me.id).length : 0,
    tagged: taggedIds(p).map(findUser).filter((u) => u && !blockedBetween(u, me)).map((u) => ({ name: u.name, username: u.username, avatar: u.avatar })),
    subtitles: (p.subtitles || []).map((x) => ({ id: x.id, lang: x.lang, label: x.label, url: `/api/posts/${p.id}/subtitles/${x.id}.vtt` })),
    createdAt: p.createdAt,
    author: authorView(findUser(p.userId)),
    ...stats(p),
    reaction: p.likes.includes(me.id) ? "like" : p.dislikes.includes(me.id) ? "dislike" : null,
    reposted: p.reposts.some((r) => r.userId === me.id),
    cooled: p.cools.includes(me.id),
    mentions: usernamesOf(p.mentions),
    editedAt: p.editedAt || null,
    visibility: p.visibility,
    poll: pollView(p, me),
    category: categoryOf(p),
    mine: p.userId === me.id,
  };
}
/* ---------- Reactions on comments: one emoji per person ---------- */
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\u20E3|\p{Emoji_Modifier}|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Component}))*\uFE0F?$/u;
function commentReactions(c, me) {
  const groups = new Map();
  for (const [userId, emoji] of Object.entries(c.reactions || {})) {
    if (!groups.has(emoji)) groups.set(emoji, []);
    groups.get(emoji).push(userId);
  }
  return [...groups].map(([emoji, ids]) => ({
    emoji,
    count: ids.length,
    mine: ids.includes(me.id),
    names: ids.map((id) => findUser(id)?.name).filter(Boolean).slice(0, 10),
  })).sort((x, y) => y.count - x.count);
}

function commentView(c, me, post) {
  return {
    stars: post?.film ? post.stars?.[c.userId] || null : undefined, // a movie review shows the writer's stars
    creatorHeart: Boolean(c.creatorHeart),
    creator: c.creatorHeart && post ? authorView(findUser(post.userId)) : null,
    canHeart: Boolean(post && post.userId === me.id),
    videoReply: c.videoReply ? (() => { const v = findPost(c.videoReply); return v && canView(v, me) ? { id: v.id, type: v.type, title: v.title || v.text.slice(0, 60), poster: v.media[0]?.poster || null, duration: v.media[0]?.duration || null } : { gone: true }; })() : null,
    id: c.id,
    postId: c.postId,
    text: c.text,
    media: c.media,
    createdAt: c.createdAt,
    author: authorView(findUser(c.userId)),
    mentions: usernamesOf(c.mentions),
    parentId: c.parentId || null,
    at: c.at ?? null,
    reactions: commentReactions(c, me),
    canDelete: c.userId === me.id || post.userId === me.id,
  };
}
function profileView(user, me) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    bio: user.bio,
    bioMentions: usernamesOf(findMentions(user.bio)),
    avatar: user.avatar,
    banner: user.banner,
    createdAt: user.createdAt,
    following: user.following.length,
    followers: followerCount(user),
    posts: db.posts.filter((p) => p.userId === user.id && (p.visibility === "public" || user.id === me.id)).length,
    textPosts: db.posts.filter((p) => p.userId === user.id && p.type === "post" && (p.visibility === "public" || user.id === me.id)).length,
    videos: db.posts.filter((p) => p.userId === user.id && p.type === "video" && !notPlainVideo(p) && (p.visibility === "public" || user.id === me.id)).length,
    shorts: db.posts.filter((p) => p.userId === user.id && p.type === "short" && (p.visibility === "public" || user.id === me.id)).length,
    views: db.posts.filter((p) => p.userId === user.id && (p.visibility !== "private" || user.id === me.id)).reduce((n, p) => n + p.viewedBy.length, 0),
    reposts: db.posts.filter((p) => p.visibility === "public" && p.reposts.some((r) => r.userId === user.id)).length,
    movies: db.posts.filter((p) => p.userId === user.id && p.film && (p.visibility === "public" || user.id === me.id)).length,
    series: db.playlists.filter((p) => p.userId === user.id && p.kind === "series" && ((p.visibility || "public") === "public" || user.id === me.id)).length,
    songs: db.songs.filter((s) => s.userId === user.id).length,
    streams: (db.streams || []).filter((s) => s.userId === user.id && (s.live || s.postId || (s.scheduledFor && !s.startedAt))).length,
    liveNow: (db.streams || []).find((s) => s.userId === user.id && s.live)?.id || null,
    canMakeFilms: canMakeFilms(user),
    canMakeMusic: canMakeMusic(user),
    isMe: user.id === me.id,
    isFollowing: me.following.includes(user.id),
    followsYou: user.following.includes(me.id),
    private: Boolean(user.private),
    locked: locked(user, me),
    requested: (user.followRequests || []).includes(me.id),
    blocked: (me.blocked || []).includes(user.id),
    requests: user.id === me.id ? (me.followRequests || []).length : undefined,
    bell: me.bells.includes(user.id),
    verified: Boolean(user.verified),
    verifiedType: user.verified ? user.verifiedType || "creator" : null,
    roles: user.roles || [],
    story: require("./stories").storyState(user, me),
    note: user.id === me.id || me.following.includes(user.id) ? activeNote(user) : null,
    ...presence(user.id),
  };
}
function claim(media, usedBy) {
  for (const m of [].concat(media || [])) {
    markUsed(m.url, usedBy);
    if (m.poster) markUsed(m.poster, usedBy);
  }
}
function sendStats(p) {
  broadcast({ type: "stats", id: p.id, ...stats(p) });
}

/* ---------- Timelines ----------
   An item is a post shown at a moment in time: when it was written, or when someone reposted it.
   `authors` decides whose own posts count, `reposters` whose reposts count. Each post shows up once,
   at its most recent moment.
   sort "cool": every Cool moves a post up as if it was posted one hour later. Nothing else changes the order. */
const COOL_BOOST_MS = 60 * 60 * 1000;
const ms = (iso) => new Date(iso).getTime();

function timeline({ authors = null, reposters = null, type = null, sort = "latest", all = false, noShorts = false, category = null } = {}) {
  const items = [];
  for (const p of db.posts) {
    if (TYPES.includes(type) && p.type !== type) continue;
    if (type === "video" && notPlainVideo(p)) continue; // movies, series episodes and past lives have their own places
    if (noShorts && p.type === "short") continue;
    if (category && p.categoryId !== category) continue;
    if (!all && p.visibility !== "public") continue;
    let best = null;
    if (!authors || authors.has(p.userId)) best = { post: p, at: p.createdAt, by: null };
    if (reposters) {
      for (const r of p.reposts) {
        if (reposters.has(r.userId) && (!best || r.at > best.at)) best = { post: p, at: r.at, by: r.userId };
      }
    }
    if (best) {
      best.key = ms(best.at) + (sort === "cool" ? p.cools.length * COOL_BOOST_MS : 0);
      items.push(best);
    }
  }
  return items.sort((a, b) => b.key - a.key || (a.post.id < b.post.id ? 1 : -1));
}

/* ---------- Paging: highest key first, "before" is the key of the last item seen ---------- */
function page(items, url, me) {
  const before = Number(url.searchParams.get("before"));
  items = items.filter((i) => canView(i.post, me) && !(i.by && blockedBetween(findUser(i.by), me)));
  const from = before ? items.filter((i) => i.key < before) : items;
  const slice = from.slice(0, PAGE);
  return {
    posts: slice.map((i) => {
      const view = postView(i.post, me);
      if (i.by) {
        const u = findUser(i.by);
        view.repostedBy = u ? { name: u.name, username: u.username, isMe: u.id === me.id } : null;
        view.repostedAt = i.at;
      }
      return view;
    }),
    nextBefore: from.length > PAGE ? slice[slice.length - 1].key : null,
  };
}

/* ---------- Validating a new post ---------- */
function buildMedia(item, me) {
  const m = ownedMedia(item && item.url, me.id);
  if (!m) throw httpError(400, "One of the files couldn’t be found. Try uploading it again.");
  const out = { url: m.url, kind: m.kind };
  if (m.kind === "video") {
    const poster = item.poster ? ownedMedia(item.poster, me.id, "image") : null;
    if (poster) out.poster = poster.url;
    const d = Number(item.duration);
    if (Number.isFinite(d) && d > 0) out.duration = Math.round(d * 10) / 10;
  }
  if (m.kind === "audio") {
    const d = Number(item.duration);
    if (!Number.isFinite(d) || d <= 0) throw httpError(400, "That recording is empty.");
    if (d > 125) throw httpError(400, "Voice messages can be up to 2 minutes.");
    out.duration = Math.round(d * 10) / 10;
    // A small waveform (0..1 values) drawn by the player
    if (Array.isArray(item.peaks)) out.peaks = item.peaks.slice(0, 64).map((x) => Math.max(0, Math.min(1, Math.round(Number(x) * 100) / 100 || 0)));
    return out;
  }
  const w = Number(item.width), h = Number(item.height);
  if (w > 0 && h > 0 && w < 20000 && h < 20000) { out.width = Math.round(w); out.height = Math.round(h); }
  return out;
}

function validatePost(body, me) {
  const type = TYPES.includes(body.type) ? body.type : "post";
  const text = clean(body.text);
  const title = clean(body.title);
  const raw = Array.isArray(body.media) ? body.media.slice(0, 5) : [];
  const media = raw.map((m) => buildMedia(m, me));
  if (media.some((m) => m.kind === "audio")) throw httpError(400, "Voice messages are for chats.");
  const videos = media.filter((m) => m.kind === "video");
  const images = media.filter((m) => m.kind === "image");

  if (type === "post") {
    if (!text && !media.length) throw httpError(400, "Write something or add a photo.");
    if (chars(text) > LIMITS.postText) throw httpError(400, `Keep posts under ${LIMITS.postText} characters.`);
    if (videos.length > 1 || (videos.length && images.length)) throw httpError(400, "Add up to 4 photos, or one video.");
    if (images.length > 4) throw httpError(400, "Add up to 4 photos.");
  } else {
    if (media.length !== 1 || videos.length !== 1) throw httpError(400, type === "short" ? "A short needs one video." : "Add the video you want to post.");
    if (type === "short") {
      if (chars(text) > LIMITS.caption) throw httpError(400, `Keep the caption under ${LIMITS.caption} characters.`);
      if (!videos[0].duration) throw httpError(400, "We couldn’t read how long this video is. Try an MP4 file.");
      if (videos[0].duration > SHORT_MAX_SECONDS + 0.5) throw httpError(400, `Shorts can be up to ${SHORT_MAX_SECONDS} seconds. Post it as a video instead.`);
    } else {
      if (!title) throw httpError(400, "Give your video a title.");
      if (chars(title) > LIMITS.title) throw httpError(400, `Keep the title under ${LIMITS.title} characters.`);
      if (chars(text) > LIMITS.description) throw httpError(400, `Keep the description under ${LIMITS.description} characters.`);
    }
  }
  const visibility = type !== "post" && VISIBILITY.includes(body.visibility) ? body.visibility : "public";

  // A poll: the post's text is the question, with 2–4 answers
  let poll = null;
  if (type === "post" && body.poll) {
    const opts = (Array.isArray(body.poll.options) ? body.poll.options : []).map(clean).filter(Boolean);
    if (!text) throw httpError(400, "Write the question for your poll.");
    if (media.length) throw httpError(400, "A poll can’t have photos or a video.");
    if (opts.length < 2) throw httpError(400, "Add at least 2 answers.");
    if (opts.length > 4) throw httpError(400, "A poll can have up to 4 answers.");
    if (opts.some((o) => chars(o) > 60)) throw httpError(400, "Keep each answer under 60 characters.");
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) throw httpError(400, "Each answer must be different.");
    const days = [1, 3, 7].includes(Number(body.poll.days)) ? Number(body.poll.days) : 1;
    poll = {
      options: opts.map((t) => ({ id: crypto.randomUUID().slice(0, 8), text: t, votes: [] })),
      endsAt: new Date(Date.now() + days * 86400000).toISOString(),
    };
  }

  // One of my own categories
  let categoryId = null;
  if (body.categoryId) {
    if (!me.categories.some((c) => c.id === body.categoryId)) throw httpError(400, "That category doesn’t exist anymore.");
    categoryId = body.categoryId;
  }
  // A movie: a video with film details (for filmmakers and producers)
  let film = null;
  if (type === "video" && body.film) {
    if (!canMakeFilms(me)) throw httpError(403, "Movies are for filmmakers, film producers, photographers and creators. Add one of them under “What do you do?” on your profile.");
    const year = Number(body.film.year);
    film = {
      year: year >= 1888 && year <= new Date().getFullYear() + 2 ? year : null,
      genre: clean(body.film.genre).slice(0, 40) || null,
      rating: ["All ages", "7+", "13+", "16+", "18+"].includes(body.film.rating) ? body.film.rating : null,
      tagline: clean(body.film.tagline).slice(0, 140) || null,
      backdrop: null,
    };
    if (body.film.backdrop) {
      const ok = ownedMedia(body.film.backdrop, me.id, "image");
      if (ok) film.backdrop = ok.url;
    }
  }
  // Upcoming video (like a YouTube premiere): hidden (private) until publishAt, then it goes public
  let publishAt = null;
  if (type !== "post" && body.publishAt) {
    const when = new Date(body.publishAt);
    if (isNaN(when) || when.getTime() < Date.now() + 60 * 1000 || when.getTime() > Date.now() + 365 * 86400000) throw httpError(400, "Pick a release time in the future (up to a year).");
    publishAt = when.toISOString();
  }
  // SoundCloud-style extras for videos and shorts, off unless the creator turns them on
  const timedComments = type !== "post" && Boolean(body.timedComments);
  const momentReactions = type !== "post" && Boolean(body.momentReactions);
  // A video reply: this video answers another video or short
  let replyTo = null;
  if (body.replyTo && type !== "post") {
    const orig = viewablePost(body.replyTo, me);
    if (!orig || orig.type === "post") throw httpError(404, "The video you’re replying to is gone.");
    replyTo = orig.id;
  }
  return { ...(replyTo ? { replyTo } : {}), ...(timedComments ? { timedComments } : {}), ...(momentReactions ? { momentReactions, moments: [] } : {}), repliesOff: Boolean(body.repliesOff), type, text, title: type === "video" ? title : "", media, visibility: publishAt ? "private" : visibility, poll, categoryId, ...(film ? { film } : {}), ...(publishAt ? { publishAt, reminders: [], premiere: true } : {}) };
}

// Movies and series unlock with a Filmmaker, Film Producer, Photographer or Creator role
// (or one they named like that, e.g. "Director")
const FILM_ROLES = ["filmmaker", "producer", "photographer", "creator"];
// Songs unlock with a Singer, Rapper or DJ / Producer role (or one named like that)
const MUSIC_ROLES = ["singer", "rapper", "dj"];
function canMakeMusic(u) {
  if (!u) return false;
  const ids = u.roles || [];
  if (ids.some((id) => MUSIC_ROLES.includes(id))) return true;
  return (u.customRoles || []).some((r) => ids.includes(r.id) && /sing|rap|dj|beat|music produc|певец|певица|рап|диджей/i.test(r.name));
}
function canMakeFilms(u) {
  if (!u) return false;
  const ids = u.roles || [];
  if (ids.some((id) => FILM_ROLES.includes(id))) return true;
  return (u.customRoles || []).some((r) => ids.includes(r.id) && /film|movie|produc|direct|cinema|photograph|creator|режис|продуц|филм|кино|фотограф/i.test(r.name));
}

// Upcoming videos: go public at their time and tell the people who asked to be reminded
function releaseDue() {
  let changed = false;
  for (const post of db.posts) {
    if (!post.publishAt || new Date(post.publishAt).getTime() > Date.now()) continue;
    const me = findUser(post.userId);
    const reminders = post.reminders || [];
    post.visibility = "public";
    post.createdAt = new Date().toISOString();
    delete post.publishAt; delete post.reminders;
    changed = true;
    if (!me) continue;
    notifyMentions(post.mentions || [], me, { postId: post.id, text: post.title || post.text });
    broadcast({ type: "post:new", id: post.id, postType: post.type, author: me.username, authorId: me.id });
    const ids = new Set([...reminders, ...db.users.filter((u) => u.bells.includes(me.id) && u.following.includes(me.id)).map((u) => u.id)]);
    for (const id of ids) if (id !== me.id) notify(id, "premiere", me, { postId: post.id, text: post.title || post.text });
  }
  if (changed) save("posts");
}
every(releaseDue, 20 * 1000).unref();
function upcomingView(p, me) {
  const m = p.media[0] || {};
  return { id: p.id, type: p.type, title: p.title, text: p.text.slice(0, 200), poster: m.poster || null, duration: m.duration || null, publishAt: p.publishAt, reminded: (p.reminders || []).includes(me.id), reminders: (p.reminders || []).length, isMine: p.userId === me.id };
}

/* ---------- Routes. Returns true when the request was handled. ---------- */
async function handleSocial(req, res, url, me) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // without "api"
  const [a, b, c] = parts;
  const m = req.method;

  // Feed: GET /api/feed?scope=following|latest&type=all|post|short|video&before=
  if (m === "GET" && a === "feed" && parts.length === 1) {
    const scope = ["following", "latest", "cool"].includes(url.searchParams.get("scope")) ? url.searchParams.get("scope") : "latest";
    const type = url.searchParams.get("type");
    const sort = url.searchParams.get("sort") === "cool" || scope === "cool" ? "cool" : "latest";
    const people = new Set([me.id, ...me.following]);
    // Latest / Cool: every post once. Following: posts and reposts from people I follow (and me).
    // Shorts live on the Shorts page, so the feed leaves them out unless asked for
    const noShorts = !TYPES.includes(type);
    const items = scope === "following"
      ? timeline({ authors: people, reposters: people, type, sort, noShorts })
      : timeline({ type, sort, noShorts });
    sendJSON(res, 200, page(items, url, me));
    return true;
  }

  // Create: POST /api/posts
  if (m === "POST" && a === "posts" && parts.length === 1) {
    rateLimit("post:" + me.id, 30, 10 * 60 * 1000, "You’re posting a lot. Take a short break.");
    const body = await readJSON(req);
    // Uploading an episode straight into one of my series (and a season — a new one if asked)
    let series = null, season = 1;
    if (body.seriesId) {
      series = db.playlists.find((x) => x.id === body.seriesId && x.kind === "series");
      if (!series || series.userId !== me.id) throw httpError(404, "That series doesn’t exist.");
      if (body.type !== "video") throw httpError(400, "Episodes are videos.");
      const count = Math.max(series.seasonCount || 1, ...Object.values(series.seasons || {}).map(Number), 1);
      season = Math.round(Number(body.season) || 1);
      if (season < 1 || season > Math.min(50, count + 1)) throw httpError(400, "Pick a season.");
      if (series.videoIds.length >= 200) throw httpError(400, "This series is full.");
    }
    const data = validatePost(body, me);
    const post = {
      id: crypto.randomUUID(),
      userId: me.id,
      ...data,
      createdAt: new Date().toISOString(),
      likes: [],
      dislikes: [],
      viewedBy: [],
      reposts: [],
      cools: [],
      commentCount: 0,
    };
    post.mentions = findMentions(post.text, post.title);
    post.tags = []; // people are tagged with @ in the text (post.mentions)
    db.posts.unshift(post);
    claim(post.media, "post:" + post.id);
    if (post.film?.backdrop) markUsed(post.film.backdrop, "post:" + post.id);
    save("posts");
    if (series) {
      const count = Math.max(series.seasonCount || 1, ...Object.values(series.seasons || {}).map(Number), 1);
      if (season > count) { series.seasonCount = season; series.seasonInfo = { ...(series.seasonInfo || {}), [season]: { year: new Date().getFullYear(), title: null } }; }
      series.videoIds.push(post.id);
      series.seasons = { ...(series.seasons || {}), [post.id]: season };
      series.updatedAt = new Date().toISOString();
      save("playlists");
      // Followers hear about a new episode instead of "a new video"
      if (post.visibility === "public") for (const u of db.users) if (u.bells.includes(me.id) && u.following.includes(me.id)) notify(u.id, "new-episode", me, { postId: post.id, text: `${series.title} · S${season}: ${post.title}` });
      sendJSON(res, 201, { post: postView(post, me), series: { id: series.id, season } });
      return true;
    }
    if (post.replyTo) {
      const orig = findPost(post.replyTo);
      if (orig) {
        db.comments.push({ id: crypto.randomUUID(), postId: orig.id, userId: me.id, parentId: null, text: "", media: null, videoReply: post.id, mentions: [], reactions: {}, createdAt: new Date().toISOString() });
        orig.commentCount = (orig.commentCount || 0) + 1;
        save("comments"); save("posts");
        if (orig.userId !== me.id) notify(orig.userId, "video-reply", me, { postId: orig.id, text: post.title || "a video" });
        broadcast({ type: "comment:new", postId: orig.id, commentId: db.comments[db.comments.length - 1].id });
      }
    }
    if (post.publishAt) for (const u of db.users) if (u.following.includes(me.id) && !blockedBetween(u, me)) notify(u.id, "upcoming-video", me, { text: `${post.title || "A new short"} · ${new Date(post.publishAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`, username: me.username });
    if (post.visibility !== "private") notifyMentions(post.mentions, me, { postId: post.id, text: post.title || post.text });
    if (post.visibility === "public") broadcast({ type: "post:new", id: post.id, postType: post.type, author: me.username, authorId: me.id });
    if (post.visibility === "public") for (const u of db.users) {
      if (u.bells.includes(me.id) && u.following.includes(me.id) && !post.mentions.includes(u.id)) {
        notify(u.id, "upload", me, { postId: post.id });
      }
    }
    sendJSON(res, 201, { post: postView(post, me) });
    return true;
  }

  // Someone's upcoming videos (teasers only): GET /api/users/:username/upcoming
  if (m === "GET" && a === "users" && c === "upcoming" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user || blockedBetween(user, me) || locked(user, me)) { sendJSON(res, 200, { videos: [] }); return true; }
    const list = db.posts.filter((p) => p.userId === user.id && p.publishAt).sort((x, y) => x.publishAt.localeCompare(y.publishAt));
    sendJSON(res, 200, { videos: list.map((p) => upcomingView(p, me)) });
    return true;
  }
  // Remind me when it comes out: POST /api/posts/:id/remind
  if (m === "POST" && a === "posts" && c === "remind" && parts.length === 3) {
    const post = findPost(b);
    if (!post || !post.publishAt || blockedBetween(findUser(post.userId), me)) throw httpError(404, "This video isn’t coming up anymore.");
    post.reminders = post.reminders || [];
    post.reminders = post.reminders.includes(me.id) ? post.reminders.filter((x) => x !== me.id) : [...post.reminders, me.id];
    save("posts");
    sendJSON(res, 200, { reminded: post.reminders.includes(me.id), reminders: post.reminders.length });
    return true;
  }
  // Release it now, or move it: POST /api/posts/:id/release { publishAt? }
  if (m === "POST" && a === "posts" && c === "release" && parts.length === 3) {
    const post = findPost(b);
    if (!post || post.userId !== me.id || !post.publishAt) throw httpError(404, "This video isn’t scheduled.");
    const body = await readJSON(req);
    if (body.publishAt) {
      const when = new Date(body.publishAt);
      if (isNaN(when) || when.getTime() < Date.now() + 60 * 1000) throw httpError(400, "Pick a time in the future.");
      post.publishAt = when.toISOString();
    } else post.publishAt = new Date(Date.now() - 1000).toISOString();
    save("posts");
    releaseDue();
    sendJSON(res, 200, { post: postView(post, me) });
    return true;
  }

  // One post with its comments: GET /api/posts/:id
  if (m === "GET" && a === "posts" && parts.length === 2) {
    const post = viewablePost(b, me);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    const comments = db.comments.filter((x) => x.postId === post.id && !blockedBetween(findUser(x.userId), me)).map((x) => commentView(x, me, post));
    sendJSON(res, 200, { post: postView(post, me), comments });
    return true;
  }

  // Delete: DELETE /api/posts/:id
  if (m === "DELETE" && a === "posts" && parts.length === 2) {
    const i = db.posts.findIndex((p) => p.id === b);
    if (i === -1) throw httpError(404, "This post doesn’t exist anymore.");
    const post = db.posts[i];
    if (post.userId !== me.id) throw httpError(403, "You can only delete your own posts.");
    removePost(post);
    sendJSON(res, 200, { ok: true });
    return true;
  }

  // Like / dislike: POST /api/posts/:id/react { reaction: "like" | "dislike" | "none" }
  if (m === "POST" && a === "posts" && c === "react" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    if (post.film) throw httpError(400, "Movies are rated with stars instead.");
    const { reaction } = await readJSON(req);
    post.likes = post.likes.filter((id) => id !== me.id);
    post.dislikes = post.dislikes.filter((id) => id !== me.id);
    if (reaction === "like") post.likes.push(me.id);
    if (reaction === "dislike") post.dislikes.push(me.id);
    // My likes history
    me.likeLog = (me.likeLog || []).filter((x) => x.postId !== post.id);
    if (reaction === "like") { me.likeLog.unshift({ postId: post.id, at: new Date().toISOString() }); me.likeLog.length = Math.min(me.likeLog.length, 500); }
    save("users");
    save("posts");
    sendStats(post);
    sendJSON(res, 200, { ...stats(post), reaction: reaction === "like" || reaction === "dislike" ? reaction : null });
    return true;
  }

  // Repost: POST /api/posts/:id/repost { repost: true | false }
  if (m === "POST" && a === "posts" && c === "repost" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    const { repost } = await readJSON(req);
    if (repost && post.visibility !== "public") throw httpError(400, "Only public posts can be reposted.");
    const had = post.reposts.some((r) => r.userId === me.id);
    post.reposts = post.reposts.filter((r) => r.userId !== me.id);
    if (repost) post.reposts.push({ userId: me.id, at: new Date().toISOString() });
    save("posts");
    sendStats(post);
    if (repost && !had) broadcast({ type: "repost", id: post.id, by: me.username, byId: me.id, authorId: post.userId });
    if (repost && !had) notify(post.userId, "repost", me, { postId: post.id });
    sendJSON(res, 200, { ...stats(post), reposted: Boolean(repost) });
    return true;
  }

  // Cool: POST /api/posts/:id/cool { cool: true | false }  — pushes the post up in Cool rankings
  if (m === "POST" && a === "posts" && c === "cool" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    if (post.film) throw httpError(400, "Movies are rated with stars instead.");
    const { cool } = await readJSON(req);
    const had = post.cools.includes(me.id);
    post.cools = post.cools.filter((id) => id !== me.id);
    if (cool) post.cools.push(me.id);
    save("posts");
    sendStats(post);
    if (cool && !had) notify(post.userId, "cool", me, { postId: post.id });
    sendJSON(res, 200, { ...stats(post), cooled: Boolean(cool) });
    return true;
  }

  // Edit my post: POST /api/posts/:id/edit { text, title }
  if (m === "POST" && a === "posts" && c === "edit" && parts.length === 3) {
    rateLimit("edit:" + me.id, 60, 10 * 60 * 1000, "You’re editing a lot. Take a short break.");
    const post = viewablePost(b, me);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    if (post.userId !== me.id) throw httpError(403, "You can only edit your own posts.");
    const body = await readJSON(req);
    if (body.categoryId !== undefined) {
      if (body.categoryId && !me.categories.some((x) => x.id === body.categoryId)) throw httpError(400, "That category doesn’t exist anymore.");
      post.categoryId = body.categoryId || null;
      save("posts");
      if (body.text === undefined && body.title === undefined && body.visibility === undefined) {
        sendJSON(res, 200, { post: postView(post, me) });
        return true;
      }
    }
    if (body.visibility !== undefined) {
      if (post.type === "post") throw httpError(400, "Only videos and shorts can be unlisted or private.");
      if (!VISIBILITY.includes(body.visibility)) throw httpError(400, "Choose public, unlisted or private.");
      if (post.publishAt) { delete post.publishAt; delete post.reminders; }
      if (body.visibility !== post.visibility) {
        post.visibility = body.visibility;
        save("posts");
        broadcast({ type: "post:visibility", id: post.id, visibility: post.visibility, authorId: me.id });
      }
      if (body.text === undefined && body.title === undefined) {
        sendJSON(res, 200, { post: postView(post, me) });
        return true;
      }
    }
    const text = body.text === undefined ? post.text : clean(body.text);
    const title = body.title === undefined ? post.title : clean(body.title);
    if (post.type === "post") {
      if (!text && !post.media.length) throw httpError(400, "A post needs some text or a photo.");
      if (chars(text) > LIMITS.postText) throw httpError(400, `Keep posts under ${LIMITS.postText} characters.`);
    } else if (post.type === "short") {
      if (chars(text) > LIMITS.caption) throw httpError(400, `Keep the caption under ${LIMITS.caption} characters.`);
    } else {
      if (!title) throw httpError(400, "Give your video a title.");
      if (chars(title) > LIMITS.title) throw httpError(400, `Keep the title under ${LIMITS.title} characters.`);
      if (chars(text) > LIMITS.description) throw httpError(400, `Keep the description under ${LIMITS.description} characters.`);
    }
    if (text === post.text && title === post.title) {
      sendJSON(res, 200, { post: postView(post, me) });
      return true;
    }
    const before = new Set(post.mentions);
    post.text = text;
    post.title = post.type === "video" ? title : "";
    post.mentions = findMentions(post.text, post.title);
    post.untagged = (post.untagged || []).filter((id) => before.has(id)); // a new @ tags them again
    post.editedAt = new Date().toISOString();
    save("posts");
    notifyMentions(post.mentions.filter((id) => !before.has(id)), me, { postId: post.id, text: post.title || post.text });
    broadcast({ type: "post:edited", id: post.id, text: post.text, title: post.title, mentions: usernamesOf(post.mentions), editedAt: post.editedAt });
    sendJSON(res, 200, { post: postView(post, me) });
    return true;
  }

  // Change a video's thumbnail: POST /api/posts/:id/thumbnail { poster }
  if (m === "POST" && a === "posts" && c === "thumbnail" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    if (post.userId !== me.id) throw httpError(403, "Only the person who posted it can change the thumbnail.");
    const video = post.media.find((x) => x.kind === "video");
    if (!video) throw httpError(400, "Only videos and shorts have thumbnails.");
    const { poster } = await readJSON(req);
    const img = ownedMedia(poster, me.id, "image");
    if (!img) throw httpError(400, "That picture couldn’t be found. Try uploading it again.");
    if (video.poster) deleteMedia(video.poster);
    video.poster = img.url;
    markUsed(img.url, "post:" + post.id);
    save("posts");
    broadcast({ type: "thumbnail", id: post.id, poster: img.url });
    sendJSON(res, 200, { poster: img.url });
    return true;
  }

  // Vote in a poll: POST /api/posts/:id/vote { optionId }  (one vote each, can't be changed)
  if (m === "POST" && a === "posts" && c === "vote" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post || !post.poll) throw httpError(404, "This poll doesn’t exist anymore.");
    if (Date.now() > new Date(post.poll.endsAt).getTime()) throw httpError(400, "This poll has ended.");
    if (post.poll.options.some((o) => o.votes.includes(me.id))) throw httpError(400, "You already voted.");
    const { optionId } = await readJSON(req);
    const opt = post.poll.options.find((o) => o.id === optionId);
    if (!opt) throw httpError(400, "Pick one of the answers.");
    opt.votes.push(me.id);
    save("posts");
    broadcast({ type: "poll", id: post.id });
    sendJSON(res, 200, { poll: pollView(post, me) });
    return true;
  }

  // Report a post: POST /api/posts/:id/report { reason, details }
  if (m === "POST" && a === "posts" && c === "report" && parts.length === 3) {
    rateLimit("report:" + me.id, 20, 60 * 60 * 1000, "You’ve sent a lot of reports. Try again later.");
    const post = viewablePost(b, me);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    if (post.userId === me.id) throw httpError(400, "You can’t report your own post.");
    const body = await readJSON(req);
    const REASONS = ["spam", "harassment", "hate", "violence", "nudity", "misinformation", "copyright", "other"];
    const reason = REASONS.includes(body.reason) ? body.reason : null;
    if (!reason) throw httpError(400, "Choose a reason.");
    const details = clean(body.details).slice(0, 500);
    if (!db.reports.some((r) => r.postId === post.id && r.reporterId === me.id)) {
      db.reports.push({ id: crypto.randomUUID(), postId: post.id, authorId: post.userId, reporterId: me.id, reason, details, createdAt: new Date().toISOString(), status: "open" });
      save("reports");
      require("./admin").pingAdmins();
      console.log(`[report] ${reason} on post ${post.id} by @${me.username}`);
    }
    sendJSON(res, 200, { ok: true });
    return true;
  }

  // Report a person: POST /api/users/:username/report { reason, details, messageId, block }
  if (m === "POST" && a === "users" && c === "report" && parts.length === 3) {
    rateLimit("report:" + me.id, 20, 60 * 60 * 1000, "You’ve sent a lot of reports. Try again later.");
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    if (user.id === me.id) throw httpError(400, "You can’t report yourself.");
    const body = await readJSON(req);
    const REASONS = ["spam", "harassment", "hate", "violence", "nudity", "impersonation", "underage", "self-harm", "other"];
    const reason = REASONS.includes(body.reason) ? body.reason : null;
    if (!reason) throw httpError(400, "Choose a reason.");
    const details = clean(body.details).slice(0, 500);
    // A reported message is kept with the report (only if I could see it)
    let message = null;
    if (body.messageId) {
      const msg = db.messages.find((x) => x.id === body.messageId && x.userId === user.id);
      const chat = msg && db.chats.find((x) => x.id === msg.chatId);
      if (msg && chat && chat.members.includes(me.id)) message = { id: msg.id, chatId: chat.id, text: msg.text || "", media: msg.media?.url || null };
    }
    const open = db.reports.find((r) => r.kind === "user" && r.userId === user.id && r.reporterId === me.id && r.status === "open");
    if (open) Object.assign(open, { reason, details: details || open.details, message: message || open.message, updatedAt: new Date().toISOString() });
    else db.reports.push({ id: crypto.randomUUID(), kind: "user", userId: user.id, reporterId: me.id, reason, details, message, createdAt: new Date().toISOString(), status: "open" });
    save("reports");
    require("./admin").pingAdmins();
    console.log(`[report] ${reason} on @${user.username} by @${me.username}${message ? " (message)" : ""}`);
    // Optionally block them at the same time
    if (body.block) {
      me.blocked = [...new Set([...(me.blocked || []), user.id])];
      me.following = me.following.filter((id) => id !== user.id);
      user.following = user.following.filter((id) => id !== me.id);
      me.bells = me.bells.filter((id) => id !== user.id);
      user.bells = user.bells.filter((id) => id !== me.id);
      me.followRequests = (me.followRequests || []).filter((id) => id !== user.id);
      user.followRequests = (user.followRequests || []).filter((id) => id !== me.id);
      save("users");
    }
    sendJSON(res, 200, { ok: true, blocked: Boolean(body.block) });
    return true;
  }

  /* ---------- Subtitles on videos ---------- */
  // GET /api/posts/:id/subtitles/:sid.vtt  (what the player loads)
  if (m === "GET" && a === "posts" && c === "subtitles" && parts[3] && parts.length === 4) {
    const post = viewablePost(b, me);
    const sub = post && (post.subtitles || []).find((x) => x.id + ".vtt" === parts[3]);
    if (!sub) throw httpError(404, "No subtitles here.");
    res.writeHead(200, { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(sub.vtt);
    return true;
  }
  // Add: POST /api/posts/:id/subtitles { lang, label, text }   ·   Remove: DELETE /api/posts/:id/subtitles/:sid
  if (a === "posts" && c === "subtitles" && (m === "POST" || m === "DELETE")) {
    const post = viewablePost(b, me);
    if (!post || post.userId !== me.id) throw httpError(403, "Only the person who posted the video can change its subtitles.");
    post.subtitles = post.subtitles || [];
    if (m === "DELETE") {
      post.subtitles = post.subtitles.filter((x) => x.id !== parts[3]);
    } else {
      const body = await readJSON(req, 600_000);
      const lang = String(body.lang || "").toLowerCase().replace(/[^a-z-]/g, "").slice(0, 10) || "en";
      const label = clean(body.label).slice(0, 40) || lang.toUpperCase();
      let text = String(body.text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
      if (!text) throw httpError(400, "That subtitle file is empty.");
      if (text.length > 500_000) throw httpError(400, "That subtitle file is too big.");
      // SRT → WebVTT (commas in times become dots, and the header is added)
      if (!/^WEBVTT/.test(text)) text = "WEBVTT\n\n" + text.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2");
      if (!/-->/.test(text)) throw httpError(400, "That doesn’t look like a subtitle file (.srt or .vtt).");
      if (post.subtitles.length >= 10) throw httpError(400, "A video can have up to 10 subtitle languages.");
      post.subtitles = post.subtitles.filter((x) => x.lang !== lang);
      post.subtitles.push({ id: crypto.randomUUID().slice(0, 8), lang, label, vtt: text });
    }
    save("posts");
    sendJSON(res, 200, { subtitles: post.subtitles.map((x) => ({ id: x.id, lang: x.lang, label: x.label, url: `/api/posts/${post.id}/subtitles/${x.id}.vtt` })) });
    return true;
  }

  // Editor: trim and cut a video (the file stays whole; viewers only see the kept parts)
  // POST /api/posts/:id/clip { start, end, cuts: [[from, to], …] }   (null = undo all edits)
  if (m === "POST" && a === "posts" && c === "clip" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post || post.userId !== me.id) throw httpError(403, "Only the person who posted it can edit it.");
    const v = post.media.find((x) => x.kind === "video");
    if (!v) throw httpError(400, "This post has no video.");
    const body = await readJSON(req);
    v.clip = cleanClip(body, v.duration);
    save("posts");
    broadcast({ type: "post:clip", id: post.id });
    sendJSON(res, 200, { clip: v.clip });
    return true;
  }

  // Change who is tagged: POST /api/posts/:id/tags { usernames }
  if (m === "POST" && a === "posts" && c === "tags" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post || post.userId !== me.id) throw httpError(403, "Only the person who posted it can tag people.");
    const before = new Set(post.tags || []);
    post.tags = resolveTags((await readJSON(req)).usernames, me);
    save("posts");
    if (post.visibility !== "private") for (const id of post.tags) if (!before.has(id)) notify(id, "tag", me, { postId: post.id });
    sendJSON(res, 200, { post: postView(post, me) });
    return true;
  }
  // Untag myself: DELETE /api/posts/:id/tags/me
  if (m === "DELETE" && a === "posts" && c === "tags" && parts[3] === "me" && parts.length === 4) {
    const post = findPost(b);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    post.tags = (post.tags || []).filter((id) => id !== me.id);
    post.untagged = [...new Set([...(post.untagged || []), me.id])];
    save("posts");
    sendJSON(res, 200, { post: postView(post, me) });
    return true;
  }

  // A view: POST /api/posts/:id/view  (each person counts once)
  if (m === "POST" && a === "posts" && c === "view" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    const src = String((await readJSON(req)).source || "other").slice(0, 20);
    // My watch history (newest first, each post once)
    if (!me.historyPaused) {
      me.history = (me.history || []).filter((x) => x.postId !== post.id);
      me.history.unshift({ postId: post.id, at: new Date().toISOString() });
      me.history.length = Math.min(me.history.length, 500);
      save("users");
    }
    if (post.userId !== me.id) markReached(post, me);
    if (!post.viewedBy.includes(me.id)) {
      post.viewedBy.push(me.id);
      // For analytics: when, from where, and whether they follow the author
      post.viewLog = post.viewLog || [];
      post.viewLog.push({ u: me.id, at: new Date().toISOString(), src, f: me.following.includes(post.userId) ? 1 : 0 });
      save("posts");
      sendStats(post);
    }
    sendJSON(res, 200, { views: post.viewedBy.length });
    return true;
  }

  // How someone watched a video: POST /api/posts/:id/watch { buckets, exitAt, skips, seconds, completed, source }
  if (m === "POST" && a === "posts" && c === "watch" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post || !post.media.some((x) => x.kind === "video")) throw httpError(404, "Not a video.");
    if (post.userId === me.id) { sendJSON(res, 200, { ok: true }); return true; } // your own plays don't count
    rateLimit("watch:" + me.id, 600, 60 * 60 * 1000);
    const body = await readJSON(req);
    const N = 50;
    const w = post.watch || (post.watch = { plays: 0, seconds: 0, completes: 0, buckets: Array(N).fill(0), exits: Array(N).fill(0), skips: Array(N).fill(0), sources: {}, daily: {} });
    const idx = (x) => Math.max(0, Math.min(N - 1, Math.floor(Number(x) * N)));
    const seen = new Set((Array.isArray(body.buckets) ? body.buckets : []).map(Number).filter((x) => x >= 0 && x < N));
    if (!seen.size) { sendJSON(res, 200, { ok: true }); return true; }
    const dur = post.media[0].duration || 0;
    const secs = Math.max(0, Math.min(Number(body.seconds) || 0, dur ? dur * 3 : 7200));
    w.plays++;
    w.seconds += secs;
    if (body.completed) w.completes++;
    for (const k of seen) w.buckets[k]++;
    if (!body.completed && Number.isFinite(Number(body.exitAt))) w.exits[idx(body.exitAt)]++;
    for (const sk of (Array.isArray(body.skips) ? body.skips : []).slice(0, 20)) w.skips[idx(sk)]++;
    const src = String(body.source || "other").slice(0, 20);
    w.sources[src] = (w.sources[src] || 0) + 1;
    const day = new Date().toISOString().slice(0, 10);
    w.daily[day] = (w.daily[day] || 0) + secs;
    save("posts");
    sendJSON(res, 200, { ok: true });
    return true;
  }

  // Seen in a feed or grid: POST /api/impressions { ids: [...] }
  if (m === "POST" && a === "impressions" && parts.length === 1) {
    const ids = (await readJSON(req)).ids;
    const day = new Date().toISOString().slice(0, 10);
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 100)) {
      const p = findPost(String(id));
      if (!p || p.userId === me.id || !canView(p, me)) continue;
      p.impressions = (p.impressions || 0) + 1;
      p.impDaily = p.impDaily || {};
      p.impDaily[day] = (p.impDaily[day] || 0) + 1;
      p.impressedBy = p.impressedBy || [];
      if (!p.impressedBy.includes(me.id)) p.impressedBy.push(me.id);
      markReached(p, me);
    }
    save("posts");
    sendJSON(res, 200, { ok: true });
    return true;
  }

  // A reaction at a moment of a video/short: POST /api/posts/:id/moments { emoji, at }
  if (m === "POST" && a === "posts" && c === "moments" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post || !post.momentReactions) throw httpError(400, "Live reactions are off for this.");
    rateLimit("moment:" + me.id, 60, 60 * 1000, "Easy!");
    const body = await readJSON(req);
    const emoji = ["❤️", "🔥", "😂", "😮", "👏", "😢"].includes(body.emoji) ? body.emoji : null;
    const at = Number(body.at);
    if (!emoji || !(at >= 0)) throw httpError(400, "Pick a reaction.");
    post.moments = post.moments || [];
    post.moments.push({ userId: me.id, emoji, at: Math.round(at * 10) / 10, createdAt: new Date().toISOString() });
    if (post.moments.length > 5000) post.moments.splice(0, post.moments.length - 5000);
    save("posts");
    broadcast({ type: "post:moment", id: post.id, emoji, at: Math.round(at * 10) / 10 });
    sendJSON(res, 201, { ok: true });
    return true;
  }
  // The creator changes the extras later: POST /api/posts/:id/options { timedComments, momentReactions }
  if (m === "POST" && a === "posts" && c === "options" && parts.length === 3) {
    const post = findPost(b);
    if (!post || post.userId !== me.id) throw httpError(404, "This post doesn’t exist anymore.");
    if (post.type === "post") throw httpError(400, "That’s for videos and shorts.");
    const body = await readJSON(req);
    if (body.timedComments !== undefined) post.timedComments = Boolean(body.timedComments);
    if (body.momentReactions !== undefined) { post.momentReactions = Boolean(body.momentReactions); post.moments = post.moments || []; }
    save("posts");
    sendJSON(res, 200, { post: postView(post, me) });
    return true;
  }
  // Rate a movie: POST /api/posts/:id/stars { stars: 1–5, or 0 to take it back }
  if (m === "POST" && a === "posts" && c === "stars" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (!post || !post.film) throw httpError(404, "Only movies can be rated.");
    if (post.userId === me.id) throw httpError(400, "You can’t rate your own movie.");
    const n = Math.round(Number((await readJSON(req)).stars) || 0);
    post.stars = post.stars || {};
    if (n >= 1 && n <= 5) post.stars[me.id] = n; else delete post.stars[me.id];
    save("posts");
    sendJSON(res, 200, { stars: starsView(post.stars, me) });
    return true;
  }
  // Turn replies on or off (the author): POST /api/posts/:id/replies { on }
  if (m === "POST" && a === "posts" && c === "replies" && parts.length === 3) {
    const post = findPost(b);
    if (!post || post.userId !== me.id) throw httpError(404, "This post doesn’t exist anymore.");
    if (isEpisode(post)) throw httpError(400, "Series episodes never have replies.");
    post.repliesOff = !(await readJSON(req)).on;
    save("posts");
    sendJSON(res, 200, { post: postView(post, me) });
    return true;
  }

  // Shared (link copied): POST /api/posts/:id/share
  if (m === "POST" && a === "posts" && c === "share" && parts.length === 3) {
    const post = viewablePost(b, me);
    if (post && post.userId !== me.id) { post.shares = (post.shares || 0) + 1; save("posts"); sendStats(post); }
    sendJSON(res, 200, { ok: true, shares: post?.shares || 0 });
    return true;
  }

  // Comment: POST /api/posts/:id/comments { text, media: { url, poster, duration } | null }
  if (m === "POST" && a === "posts" && c === "comments" && parts.length === 3) {
    rateLimit("comment:" + me.id, 60, 10 * 60 * 1000, "You’re commenting a lot. Take a short break.");
    const post = viewablePost(b, me);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    const closed = repliesClosed(post);
    if (closed) throw httpError(403, closed === "movie" ? "Movies don’t have replies." : closed === "episode" ? "Series episodes don’t have replies." : closed === "live" ? "Past lives don’t have replies." : "Replies are turned off for this post.");
    const body = await readJSON(req);
    const text = clean(body.text);
    let media = body.media ? buildMedia(body.media, me) : null;
    if (media?.kind === "audio") throw httpError(400, "Voice messages are for chats.");
    const gifMedia = resolveGif(body, me) || resolveExtras(body, me);
    if (gifMedia) media = gifMedia;
    if (!text && !media) throw httpError(400, "Write a reply or add a photo or video.");
    if (chars(text) > LIMITS.comment) throw httpError(400, `Keep replies under ${LIMITS.comment} characters.`);
    // Answering another comment: threads are one level deep, so a reply to a reply joins the same thread
    let parent = null;
    if (body.parentId) {
      parent = db.comments.find((x) => x.id === body.parentId && x.postId === post.id);
      if (!parent) throw httpError(404, "The comment you’re answering was deleted.");
      if (parent.parentId) parent = db.comments.find((x) => x.id === parent.parentId) || parent;
    }
    const comment = { id: crypto.randomUUID(), postId: post.id, userId: me.id, parentId: parent ? parent.id : null, text, media, mentions: findMentions(text), reactions: {}, createdAt: new Date().toISOString() };
    // A comment at a moment of the video (only if the creator allows timed comments)
    if (post.timedComments && !parent && Number.isFinite(Number(body.at)) && Number(body.at) >= 0) comment.at = Math.round(Number(body.at) * 10) / 10;
    db.comments.push(comment);
    if (!comment.media?.gif && !comment.media?.sticker && !comment.media?.shared) claim(comment.media, "comment:" + comment.id);
    post.commentCount++;
    save("comments");
    save("posts");
    broadcast({ type: "comment:new", postId: post.id, commentId: comment.id, authorId: me.id });
    notifyMentions(comment.mentions, me, { postId: post.id, text: comment.text });
    const answered = body.parentId ? db.comments.find((x) => x.id === body.parentId) : null;
    if (answered && !comment.mentions.includes(answered.userId)) {
      notify(answered.userId, "answer", me, { postId: post.id, text: comment.text });
    }
    if (post.userId !== answered?.userId && !comment.mentions.includes(post.userId)) {
      notify(post.userId, "comment", me, { postId: post.id, text: comment.text });
    }
    sendStats(post);
    sendJSON(res, 201, { comment: commentView(comment, me, post) });
    return true;
  }

  // One comment (used to show live replies): GET /api/comments/:id
  if (m === "GET" && a === "comments" && parts.length === 2) {
    const comment = db.comments.find((x) => x.id === b);
    const post = comment && viewablePost(comment.postId, me);
    if (!comment || !post) throw httpError(404, "This reply doesn’t exist anymore.");
    sendJSON(res, 200, { comment: commentView(comment, me, post) });
    return true;
  }

  // ❤️ Liked by the creator (only the person who posted it): POST /api/comments/:id/heart { on }
  if (m === "POST" && a === "comments" && c === "heart" && parts.length === 3) {
    const comment = db.comments.find((x) => x.id === b);
    const post = comment && viewablePost(comment.postId, me);
    if (!comment || !post) throw httpError(404, "This reply doesn’t exist anymore.");
    if (post.userId !== me.id) throw httpError(403, "Only the creator can do that.");
    const on = Boolean((await readJSON(req)).on);
    const before = Boolean(comment.creatorHeart);
    comment.creatorHeart = on;
    save("comments");
    broadcast({ type: "comment:reactions", postId: post.id, commentId: comment.id });
    if (on && !before && comment.userId !== me.id) notify(comment.userId, "creator-heart", me, { postId: post.id, text: comment.text });
    sendJSON(res, 200, { creatorHeart: on });
    return true;
  }
  // React to a comment: POST /api/comments/:id/react { emoji }  (same emoji again removes it)
  if (m === "POST" && a === "comments" && c === "react" && parts.length === 3) {
    const comment = db.comments.find((x) => x.id === b);
    const post = comment && viewablePost(comment.postId, me);
    if (!comment || !post) throw httpError(404, "This reply doesn’t exist anymore.");
    const emoji = String((await readJSON(req)).emoji || "");
    if (emoji && (emoji.length > 32 || !EMOJI_RE.test(emoji))) throw httpError(400, "That isn’t an emoji.");
    comment.reactions = comment.reactions || {};
    if (!emoji || comment.reactions[me.id] === emoji) delete comment.reactions[me.id];
    else comment.reactions[me.id] = emoji;
    save("comments");
    broadcast({ type: "comment:reactions", postId: post.id, commentId: comment.id });
    if (emoji && comment.reactions[me.id] && comment.userId !== me.id) {
      notify(comment.userId, "reaction", me, { postId: post.id, emoji, text: comment.text });
    }
    sendJSON(res, 200, { reactions: commentReactions(comment, me) });
    return true;
  }

  // Delete a comment: DELETE /api/comments/:id  (its author or the post's author)
  if (m === "DELETE" && a === "comments" && parts.length === 2) {
    const i = db.comments.findIndex((x) => x.id === b);
    if (i === -1) throw httpError(404, "This reply doesn’t exist anymore.");
    const comment = db.comments[i];
    const post = findPost(comment.postId);
    if (comment.userId !== me.id && (!post || post.userId !== me.id)) throw httpError(403, "You can’t delete this reply.");
    const gone = db.comments.filter((x) => x.id === comment.id || x.parentId === comment.id);
    db.comments = db.comments.filter((x) => !gone.includes(x));
    for (const x of gone) if (x.media && !x.media.gif && !x.media.sticker && !x.media.shared) { deleteMedia(x.media.url); if (x.media.poster) deleteMedia(x.media.poster); }
    save("comments");
    if (post) { post.commentCount = Math.max(0, post.commentCount - gone.length); save("posts"); sendStats(post); }
    for (const x of gone) broadcast({ type: "comment:deleted", postId: comment.postId, commentId: x.id });
    sendJSON(res, 200, { ok: true });
    return true;
  }

  // People for "@" suggestions: GET /api/users/lookup?q=
  if (m === "GET" && a === "users" && b === "lookup" && parts.length === 2) {
    const q = clean(url.searchParams.get("q")).toLowerCase().replace(/^@/, "");
    const list = db.users
      .filter((u) => !blockedBetween(u, me))
      .filter((u) => !q || u.username.toLowerCase().startsWith(q) || u.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
      .sort((x, y) => Number(me.following.includes(y.id)) - Number(me.following.includes(x.id)) || x.username.localeCompare(y.username))
      .slice(0, 6)
      .map(authorView);
    sendJSON(res, 200, { users: list });
    return true;
  }

  // Who to follow: GET /api/users/suggestions
  // Find people: GET /api/users/suggestions?limit=&q=  — follows you, friends of friends, popular, new
  if (m === "GET" && a === "users" && b === "suggestions" && parts.length === 2) {
    const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit")) || 5));
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase().replace(/^@/, "");
    const week = Date.now() - 7 * 86400000;
    const list = db.users
      // Searching finds anyone (also people you already follow); suggestions skip the ones you follow
      .filter((u) => u.id !== me.id && (q || !me.following.includes(u.id)) && !blockedBetween(u, me))
      .filter((u) => !q || u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || (u.nickname || "").toLowerCase().includes(q))
      .map((u) => {
        const mutualIds = me.following.filter((id) => findUser(id)?.following.includes(u.id));
        const followsMe = u.following.includes(me.id);
        const followers = followerCount(u);
        const isNew = new Date(u.createdAt).getTime() > week;
        const reason = followsMe ? "Follows you" : mutualIds.length ? `Followed by ${findUser(mutualIds[0])?.name}${mutualIds.length > 1 ? ` and ${mutualIds.length - 1} more` : ""}` : isNew ? "New on LookBlog" : followers ? "Popular on LookBlog" : "On LookBlog";
        const exact = q && (u.username.toLowerCase() === q || u.name.toLowerCase() === q) ? 5000 : q && (u.username.toLowerCase().startsWith(q) || u.name.toLowerCase().startsWith(q)) ? 2000 : 0;
        const following = me.following.includes(u.id);
        return { u, score: exact + (followsMe ? 1000 : 0) + mutualIds.length * 50 + followers + (isNew ? 5 : 0), view: { ...authorView(u), bio: String(u.bio || "").slice(0, 120), followers, mutual: mutualIds.length, followsMe, isNew, following, reason: following ? "You follow them" : reason, private: Boolean(u.private) } };
      })
      .sort((x, y) => y.score - x.score || y.u.createdAt.localeCompare(x.u.createdAt))
      .slice(0, limit)
      .map((x) => x.view);
    sendJSON(res, 200, { users: list });
    return true;
  }

  // Profile: GET /api/users/:username
  if (m === "GET" && a === "users" && parts.length === 2) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user || (user.blocked || []).includes(me.id)) throw httpError(404, "This account doesn’t exist.");
    if (user.id !== me.id) {
      const day = new Date().toISOString().slice(0, 10);
      user.visits = user.visits || {};
      user.visits[day] = (user.visits[day] || 0) + 1;
      save("users");
    }
    sendJSON(res, 200, { profile: profileView(user, me) });
    return true;
  }

  // Their posts: GET /api/users/:username/posts?type=post|short|video&before=
  if (m === "GET" && a === "users" && c === "posts" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    if (blockedBetween(user, me) || locked(user, me)) { sendJSON(res, 200, { posts: [], more: null }); return true; }
    const type = url.searchParams.get("type");
    if (type === "movie") {
      const items = db.posts.filter((p) => p.userId === user.id && p.film && (p.visibility === "public" || user.id === me.id)).map((p) => ({ post: p, at: p.createdAt, by: null, key: ms(p.createdAt) }));
      sendJSON(res, 200, page(items, url, me));
      return true;
    }
    if (type === "tagged") {
      const items = db.posts.filter((p) => taggedIds(p).includes(user.id) && p.visibility === "public").map((p) => ({ post: p, at: p.createdAt, by: null, key: ms(p.createdAt) }));
      sendJSON(res, 200, page(items, url, me));
      return true;
    }
    const only = new Set([user.id]);
    // type=repost: what they shared (any kind). Otherwise: their own posts of that kind.
    const items = type === "repost"
      ? timeline({ authors: new Set(), reposters: only })
      : timeline({ authors: only, type, all: user.id === me.id, category: url.searchParams.get("category") || null });
    sendJSON(res, 200, page(items, url, me));
    return true;
  }

  // Who follows them / whom they follow: GET /api/users/:username/followers | following
  if (m === "GET" && a === "users" && (c === "followers" || c === "following") && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    if (blockedBetween(user, me)) throw httpError(404, "This account doesn’t exist.");
    if (locked(user, me)) throw httpError(403, "This account is private.");
    const list = c === "followers"
      ? db.users.filter((u) => u.following.includes(user.id))
      : user.following.map(findUser).filter(Boolean);
    sendJSON(res, 200, {
      users: list.map((u) => ({
        ...authorView(u),
        bio: u.bio,
        isMe: u.id === me.id,
        isFollowing: me.following.includes(u.id),
        followsYou: u.following.includes(me.id),
      })),
    });
    return true;
  }

  // Bell: POST /api/users/:username/bell { on }  — tell me when they post (only while following)
  if (m === "POST" && a === "users" && c === "bell" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    if (!me.following.includes(user.id)) throw httpError(400, "Follow them first to get their notifications.");
    const { on } = await readJSON(req);
    me.bells = me.bells.filter((id) => id !== user.id);
    if (on) me.bells.push(user.id);
    save("users");
    sendJSON(res, 200, { profile: profileView(user, me) });
    return true;
  }

  // Follow / unfollow: POST /api/users/:username/follow
  if (m === "POST" && a === "users" && c === "follow" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    if (user.id === me.id) throw httpError(400, "You can’t follow yourself.");
    if (blockedBetween(user, me)) throw httpError(403, "You can’t follow this account.");
    // Private accounts: ask first (asking again takes the request back)
    if (user.private && !me.following.includes(user.id)) {
      user.followRequests = user.followRequests || [];
      const asked = user.followRequests.includes(me.id);
      user.followRequests = asked ? user.followRequests.filter((id) => id !== me.id) : [...user.followRequests, me.id];
      save("users");
      if (!asked) notify(user.id, "follow-request", me);
      sendTo([user.id], { type: "requests", count: user.followRequests.length });
      sendJSON(res, 200, { profile: profileView(user, me) });
      return true;
    }
    const i = me.following.indexOf(user.id);
    if (i === -1) me.following.push(user.id);
    else {
      me.following.splice(i, 1);
      me.bells = me.bells.filter((id) => id !== user.id);
    }
    save("users");
    if (i === -1) notify(user.id, "follow", me);
    db.followLog.push({ t: user.id, by: me.id, at: new Date().toISOString(), on: i === -1 ? 1 : 0 });
    save("followLog");
    broadcast({
      type: "follow",
      username: user.username,
      followers: followerCount(user),
      by: me.username,
      byFollowing: me.following.length,
      following: i === -1,
    });
    sendJSON(res, 200, { profile: profileView(user, me) });
    return true;
  }

  // Recommended for me: GET /api/recommend?type=video|short|post&seed=<postId>&skip=id,id&limit=
  if (m === "GET" && a === "recommend" && parts.length === 1) {
    const { recommend } = require("./recommend");
    const type = ["video", "short", "post"].includes(url.searchParams.get("type")) ? url.searchParams.get("type") : null;
    const seed = url.searchParams.get("seed") ? findPost(url.searchParams.get("seed")) : null;
    const skip = String(url.searchParams.get("skip") || "").split(",").filter(Boolean).slice(0, 300);
    const limit = Math.max(1, Math.min(40, Number(url.searchParams.get("limit")) || 20));
    const list = recommend(me, { type, seed, skip, limit });
    sendJSON(res, 200, { posts: list.map((x) => ({ ...postView(x.post, me), reason: x.reason })) });
    return true;
  }

  /* ---------- History: what I watched, my replies, what I liked ---------- */
  // GET /api/me/history?kind=watched|comments|likes
  if (m === "GET" && a === "me" && b === "history" && parts.length === 2) {
    const kind = url.searchParams.get("kind") || "watched";
    if (kind === "comments") {
      const list = db.comments.filter((c) => c.userId === me.id).slice(-200).reverse().map((c) => {
        const p = findPost(c.postId);
        return p && canView(p, me) ? { at: c.createdAt, comment: { id: c.id, text: c.text, media: c.media ? { kind: c.media.kind, gif: Boolean(c.media.gif), url: c.media.url } : null }, post: postView(p, me) } : null;
      }).filter(Boolean);
      sendJSON(res, 200, { items: list });
      return true;
    }
    const log = kind === "likes" ? me.likeLog || [] : me.history || [];
    const items = log.map((x) => { const p = findPost(x.postId); return p && canView(p, me) ? { at: x.at, post: postView(p, me) } : null; }).filter(Boolean).slice(0, 200);
    // Likes from before the history existed (no date)
    if (kind === "likes" && items.length < 200) {
      const have = new Set(items.map((x) => x.post.id));
      for (const p of db.posts) if (p.likes.includes(me.id) && !have.has(p.id) && canView(p, me)) items.push({ at: null, post: postView(p, me) });
    }
    sendJSON(res, 200, { items, paused: Boolean(me.historyPaused) });
    return true;
  }
  // DELETE /api/me/history?postId=  (one, or everything)  ·  POST /api/me/history/pause { paused }
  if (m === "DELETE" && a === "me" && b === "history" && parts.length === 2) {
    const id = url.searchParams.get("postId");
    me.history = id ? (me.history || []).filter((x) => x.postId !== id) : [];
    save("users");
    sendJSON(res, 200, { ok: true });
    return true;
  }
  if (m === "POST" && a === "me" && b === "history" && c === "pause") {
    me.historyPaused = Boolean((await readJSON(req)).paused);
    save("users");
    sendJSON(res, 200, { paused: me.historyPaused });
    return true;
  }

  /* ---------- Blocking ---------- */
  // POST /api/users/:username/block { on }
  if (m === "POST" && a === "users" && c === "block" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user || user.id === me.id) throw httpError(400, "You can’t block that account.");
    const on = Boolean((await readJSON(req)).on);
    me.blocked = (me.blocked || []).filter((id) => id !== user.id);
    if (on) {
      me.blocked.push(user.id);
      // Blocking ends following both ways, and any follow requests
      me.following = me.following.filter((id) => id !== user.id);
      user.following = user.following.filter((id) => id !== me.id);
      me.bells = me.bells.filter((id) => id !== user.id);
      user.bells = user.bells.filter((id) => id !== me.id);
      me.followRequests = (me.followRequests || []).filter((id) => id !== user.id);
      user.followRequests = (user.followRequests || []).filter((id) => id !== me.id);
    }
    save("users");
    sendJSON(res, 200, { profile: profileView(user, me) });
    return true;
  }
  // GET /api/me/blocked
  if (m === "GET" && a === "me" && b === "blocked" && parts.length === 2) {
    sendJSON(res, 200, { users: (me.blocked || []).map(findUser).filter(Boolean).map(authorView) });
    return true;
  }

  /* ---------- Private account and follow requests ---------- */
  // POST /api/me/privacy { private }
  if (m === "POST" && a === "me" && b === "privacy" && parts.length === 2) {
    me.private = Boolean((await readJSON(req)).private);
    // Going public: everyone who asked becomes a follower
    if (!me.private) {
      for (const id of me.followRequests || []) { const u = findUser(id); if (u && !u.following.includes(me.id)) { u.following.push(me.id); notify(u.id, "follow-accept", me); } }
      me.followRequests = [];
    }
    save("users");
    sendJSON(res, 200, { private: me.private });
    return true;
  }
  // GET /api/me/requests  ·  POST /api/me/requests/:username { accept }
  if (a === "me" && b === "requests") {
    me.followRequests = me.followRequests || [];
    if (m === "GET" && parts.length === 2) {
      sendJSON(res, 200, { users: me.followRequests.map(findUser).filter(Boolean).map((u) => ({ ...authorView(u), bio: u.bio })), private: Boolean(me.private) });
      return true;
    }
    if (m === "POST" && parts.length === 3) {
      const user = findByUsername(decodeURIComponent(c));
      if (!user || !me.followRequests.includes(user.id)) throw httpError(404, "That request is gone.");
      me.followRequests = me.followRequests.filter((id) => id !== user.id);
      if ((await readJSON(req)).accept && !user.following.includes(me.id)) {
        user.following.push(me.id);
        notify(user.id, "follow-accept", me);
        broadcast({ type: "follow", username: me.username, followers: followerCount(me), by: user.username, byFollowing: user.following.length, following: true });
      }
      save("users");
      sendJSON(res, 200, { count: me.followRequests.length });
      return true;
    }
  }

  // Someone's categories: GET /api/users/:username/categories
  if (m === "GET" && a === "users" && c === "categories" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    const visible = (p) => p.userId === user.id && (p.visibility === "public" || user.id === me.id);
    sendJSON(res, 200, {
      categories: user.categories.map((cat) => ({ id: cat.id, name: cat.name, count: db.posts.filter((p) => visible(p) && p.categoryId === cat.id).length })),
    });
    return true;
  }

  // My categories: POST /api/me/categories { name } · POST /api/me/categories/:id { name } · DELETE /api/me/categories/:id
  if (a === "me" && b === "categories") {
    const id = parts[2];
    if (m === "POST") {
      const name = clean((await readJSON(req)).name).replace(/\s+/g, " ");
      if (!name) throw httpError(400, "Give the category a name.");
      if (chars(name) > 30) throw httpError(400, "Keep the name under 30 characters.");
      if (me.categories.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== id)) throw httpError(400, "You already have a category with that name.");
      if (id) {
        const cat = me.categories.find((x) => x.id === id);
        if (!cat) throw httpError(404, "That category doesn’t exist.");
        cat.name = name;
      } else {
        if (me.categories.length >= 20) throw httpError(400, "You can have up to 20 categories.");
        me.categories.push({ id: crypto.randomUUID().slice(0, 8), name });
      }
      save("users");
      sendJSON(res, 200, { categories: me.categories });
      return true;
    }
    if (m === "DELETE" && id) {
      me.categories = me.categories.filter((x) => x.id !== id);
      for (const p of db.posts) if (p.userId === me.id && p.categoryId === id) p.categoryId = null;
      save("users");
      save("posts");
      sendJSON(res, 200, { categories: me.categories });
      return true;
    }
  }

  // Notes: GET /api/notes · POST /api/me/note { text } · DELETE /api/me/note
  if (m === "GET" && a === "notes" && parts.length === 1) {
    const people = [me, ...me.following.map(findUser).filter(Boolean)];
    const notes = people
      .map((u) => ({ user: authorView(u), note: activeNote(u), isMe: u.id === me.id }))
      .filter((x) => x.note || x.isMe)
      .sort((x, y) => Number(y.isMe) - Number(x.isMe) || (y.note?.createdAt || "").localeCompare(x.note?.createdAt || ""));
    sendJSON(res, 200, { notes });
    return true;
  }
  if (a === "me" && b === "note" && parts.length === 2) {
    if (m === "POST") {
      // A note: text and/or a photo or GIF
      const body = await readJSON(req);
      const text = clean(body.text).replace(/\s+/g, " ");
      let media = null;
      if (body.image) {
        const img = ownedMedia(body.image, me.id, "image");
        if (!img) throw httpError(400, "That photo couldn’t be found. Add it again.");
        media = { url: img.url, gif: false };
      } else if (body.gif || body.gifUrl) {
        const g = resolveGif(body, me);
        media = { url: g.url, gif: true };
      } else if (body.keepMedia && me.note?.media) media = me.note.media;
      if (!text && !media) throw httpError(400, "Write a note, pick an emoji or add a photo or GIF.");
      if (chars(text) > 60) throw httpError(400, "Keep notes under 60 characters.");
      const old = me.note?.media;
      if (old && !old.gif && old.url !== media?.url) deleteMedia(old.url);
      if (media && !media.gif && media.url !== old?.url) markUsed(media.url, "note:" + me.id);
      if (media && media.url !== old?.url) me.noteMediaCount = (me.noteMediaCount || 0) + 1;
      // How the bubble looks: a colour and an emoji on its corner
      const NOTE_COLORS = ["pink", "berry", "purple", "ocean", "mint", "sunset", "gold", "night", "galaxy"];
      const color = NOTE_COLORS.includes(body.color) ? body.color : null;
      const deco = typeof body.deco === "string" && body.deco.length <= 16 && /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\u20E3|\p{Emoji_Modifier}|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Component}))*\uFE0F?$/u.test(body.deco) ? body.deco : null;
      me.note = { text, media, ...(color ? { color } : {}), ...(deco ? { deco } : {}), createdAt: new Date().toISOString() };
      me.noteCount = (me.noteCount || 0) + 1;
    } else if (m === "DELETE") {
      if (me.note?.media && !me.note.media.gif) deleteMedia(me.note.media.url);
      me.note = null;
    } else return false;
    save("users");
    const followers = db.users.filter((u) => u.following.includes(me.id)).map((u) => u.id);
    sendTo([me.id, ...followers], { type: "note", username: me.username });
    sendJSON(res, 200, { note: activeNote(me) });
    return true;
  }

  // Change my @: POST /api/me/username { username }
  if (m === "POST" && a === "me" && b === "username" && parts.length === 2) {
    rateLimit("rename:" + me.id, 5, 24 * 60 * 60 * 1000, "You can change your @ up to 5 times a day.");
    const username = String((await readJSON(req)).username || "").trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{3,15}$/.test(username)) throw httpError(400, "3–15 characters: letters, numbers and _ only.");
    const taken = findByUsername(username);
    if (taken && taken.id !== me.id) throw httpError(400, "That username is taken.");
    const old = me.username;
    me.username = username;
    save("users");
    broadcast({ type: "username", old, username, name: me.name });
    sendJSON(res, 200, { username });
    return true;
  }

  // Search GIFs: GET /api/gifs/search?q=&offset=  (GIPHY like on Instagram, plus LookBlog's pack and GIFs people added;
  // with no words: what's trending)
  if (m === "GET" && a === "gifs" && b === "search" && parts.length === 2) {
    const q = clean(url.searchParams.get("q")).toLowerCase().slice(0, 50);
    const offset = Math.max(0, Math.min(4900, Number(url.searchParams.get("offset")) || 0));
    const words = q.split(/[^\p{L}\p{N}']+/u).filter(Boolean);
    const matches = (text) => words.every((w) => text.split(" ").some((t) => t.startsWith(w)));
    const ours = [];
    if (!offset) {
      const seen = new Set();
      for (const g of GIF_PACK) {
        if (words.length && !matches(`${g.title.toLowerCase()} ${g.tags.join(" ")}`)) continue;
        seen.add(g.url);
        ours.push({ url: g.url, title: g.title, source: "lookblog" });
      }
      for (const u of db.users) for (const g of u.gifs) {
        if (seen.has(g.url) || !g.url.startsWith("/media/")) continue;
        if (words.length && !matches((g.tags || []).join(" "))) continue;
        seen.add(g.url);
        ours.push({ url: g.url, title: (g.tags || []).join(" "), source: "people" });
        if (ours.length >= 120) break;
      }
    }
    const g = await giphy(q, offset);
    if (!g) { sendJSON(res, 200, { results: ours, next: null, giphy: false }); return true; }
    // GIPHY first (that's the big library); ours after, or first when you searched and they match
    const results = words.length && ours.length ? [...ours.slice(0, 12), ...g.results, ...ours.slice(12)] : [...g.results, ...(offset ? [] : ours.slice(0, 24))];
    sendJSON(res, 200, { results, next: g.next, giphy: true });
    return true;
  }

  // GIFs: GET /api/me/gifs · POST /api/me/gifs { url } · DELETE /api/me/gifs/:id
  if (a === "me" && b === "gifs") {
    if (m === "GET" && parts.length === 2) { sendJSON(res, 200, { gifs: me.gifs }); return true; }
    if (m === "POST" && parts.length === 2) {
      const body = await readJSON(req);
      if (me.gifs.length >= 300) throw httpError(400, "You can keep up to 300 GIFs. Remove some first.");
      if (body.saveUrl) {
        // Keep a GIF from the LookBlog pack (or one someone added) in "Yours"
        const u = String(body.saveUrl);
        if (!knownGif(u)) throw httpError(400, "That GIF can’t be saved.");
        let g = me.gifs.find((x) => x.url === u);
        if (!g) {
          g = { id: crypto.randomUUID().slice(0, 8), url: u, tags: (GIF_PACK.find((p) => p.url === u)?.tags || clean(body.title).toLowerCase().split(/\s+/).filter(Boolean)).slice(0, 10) };
          if (GIPHY_RE.test(String(body.preview || ""))) g.preview = String(body.preview);
          me.gifs.unshift(g); save("users");
        }
        sendJSON(res, 201, { gif: g, gifs: me.gifs });
        return true;
      }
      const img = ownedMedia(body.url, me.id, "image");
      if (!img || !/\.gif$/i.test(img.url)) throw httpError(400, "Pick a GIF file.");
      markUsed(img.url, "gif");
      const tags = clean(body.tags).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 10);
      const g = { id: crypto.randomUUID().slice(0, 8), url: img.url, tags };
      me.gifs.unshift(g);
      save("users");
      sendJSON(res, 201, { gif: g, gifs: me.gifs });
      return true;
    }
    if (m === "DELETE" && parts[2]) {
      me.gifs = me.gifs.filter((g) => g.id !== parts[2]);
      save("users");
      sendJSON(res, 200, { gifs: me.gifs });
      return true;
    }
  }

  // My sounds: GET /api/me/sounds · POST { name, emoji, url } · DELETE /api/me/sounds/:id
  if (a === "me" && b === "sounds") {
    if (m === "GET" && parts.length === 2) { sendJSON(res, 200, { sounds: me.sounds }); return true; }
    if (m === "POST" && parts.length === 2) {
      const body = await readJSON(req);
      const name = clean(body.name).slice(0, 24);
      if (!name) throw httpError(400, "Give the sound a name.");
      let emoji = String(body.emoji || "").trim();
      if (!emoji || [...emoji].length > 4 || !/\p{Extended_Pictographic}/u.test(emoji)) emoji = "🔊";
      const file = ownedMedia(body.url, me.id, "audio");
      if (!file) throw httpError(400, "That sound couldn’t be found. Upload it again.");
      if ((db.uploads[file.url.replace("/media/", "")]?.size || 0) > 2 * 1024 * 1024) throw httpError(400, "Keep sounds short (under 2 MB).");
      if (me.sounds.length >= 40) throw httpError(400, "You can keep up to 40 sounds. Remove some first.");
      markUsed(file.url, "mysound:" + me.id);
      me.sounds.unshift({ id: crypto.randomUUID().slice(0, 8), name, emoji, url: file.url, createdAt: new Date().toISOString() });
      save("users");
      sendJSON(res, 201, { sounds: me.sounds });
      return true;
    }
    if (m === "DELETE" && parts[2]) {
      const snd = me.sounds.find((x) => x.id === parts[2]);
      me.sounds = me.sounds.filter((x) => x.id !== parts[2]);
      save("users");
      if (snd && !db.messages.some((x) => x.media?.url === snd.url) && !db.comments.some((x) => x.media?.url === snd.url)) deleteMedia(snd.url);
      sendJSON(res, 200, { sounds: me.sounds });
      return true;
    }
  }

  // Stickers: GET /api/me/stickers · POST /api/me/stickers { url } (new) or { from: url } (save someone's) · DELETE /api/me/stickers/:id
  if (a === "me" && b === "stickers") {
    if (m === "GET" && parts.length === 2) {
      sendJSON(res, 200, { stickers: me.stickers });
      return true;
    }
    if (m === "POST" && parts.length === 2) {
      const body = await readJSON(req);
      if (me.stickers.length >= 100) throw httpError(400, "You can keep up to 100 stickers. Remove some first.");
      let url;
      if (body.url) {
        const img = ownedMedia(body.url, me.id, "image");
        if (!img) throw httpError(400, "That picture couldn’t be found. Try again.");
        markUsed(img.url, "sticker");
        url = img.url;
      } else if (body.from) {
        // Save a sticker someone sent you
        const known = db.users.some((u) => u.stickers.some((s) => s.url === body.from));
        if (!known) throw httpError(404, "That sticker doesn’t exist anymore.");
        url = body.from;
      } else throw httpError(400, "Add a picture.");
      if (me.stickers.some((s) => s.url === url)) { sendJSON(res, 200, { stickers: me.stickers }); return true; }
      me.stickers.unshift({ id: crypto.randomUUID().slice(0, 8), url, createdAt: new Date().toISOString() });
      save("users");
      sendJSON(res, 201, { stickers: me.stickers });
      return true;
    }
    if (m === "DELETE" && parts[2]) {
      const st = me.stickers.find((s) => s.id === parts[2]);
      me.stickers = me.stickers.filter((s) => s.id !== parts[2]);
      save("users");
      // Remove the file only when nobody has it any more and no message shows it
      if (st && !db.users.some((u) => u.stickers.some((s) => s.url === st.url)) && !db.messages.some((x) => x.media?.url === st.url)) deleteMedia(st.url);
      sendJSON(res, 200, { stickers: me.stickers });
      return true;
    }
  }

  // Verification: GET /api/verify (my status) · POST /api/verify { fullName, category, about, links }
  if (a === "verify" && parts.length === 1) {
    const mine = db.verifyRequests.filter((r) => r.userId === me.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0] || null;
    if (m === "GET") {
      const stats = profileView(me, me);
      sendJSON(res, 200, {
        verified: Boolean(me.verified),
        verifiedType: me.verified ? me.verifiedType || "creator" : null,
        request: mine && { status: mine.status, createdAt: mine.createdAt, category: mine.category },
        checks: {
          followers: stats.followers >= VERIFY_MIN.followers,
          posts: stats.posts >= VERIFY_MIN.posts,
        },
        min: VERIFY_MIN,
        counts: { posts: stats.posts, followers: stats.followers },
      });
      return true;
    }
    if (m === "POST") {
      if (me.verified) throw httpError(400, "You’re already verified.");
      if (mine && mine.status === "pending") throw httpError(400, "Your application is already being reviewed.");
      const st = profileView(me, me);
      if (st.followers < VERIFY_MIN.followers || st.posts < VERIFY_MIN.posts) {
        throw httpError(400, `You need at least ${VERIFY_MIN.followers.toLocaleString("en-US")} followers and ${VERIFY_MIN.posts} posts to apply.`);
      }
      if (mine && mine.status === "rejected" && Date.now() - new Date(mine.createdAt).getTime() < 30 * 86400000) throw httpError(400, "You can apply again 30 days after your last application.");
      const body = await readJSON(req);
      const CATS = ["creator", "musician", "singer", "dj", "band", "artist", "photographer", "filmmaker", "actor", "dancer", "comedian", "writer", "journalist", "gamer", "streamer", "athlete", "chef", "fashion", "designer", "developer", "business", "public-figure", "organization", "other"];
      const fullName = clean(body.fullName).slice(0, 80);
      const category = CATS.includes(body.category) ? body.category : null;
      const about = clean(body.about).slice(0, 1000);
      const links = (Array.isArray(body.links) ? body.links : []).map((l) => clean(l)).filter(Boolean).slice(0, 3);
      if (!fullName) throw httpError(400, "Write your full name.");
      if (!category) throw httpError(400, "Choose what describes you best.");
      if (chars(about) < 20) throw httpError(400, "Tell us a bit more about why you should be verified (at least 20 characters).");
      if (links.some((l) => !/^https?:\/\/[^\s]+\.[^\s]+/i.test(l))) throw httpError(400, "Links should start with http:// or https://");
      db.verifyRequests.push({ id: crypto.randomUUID(), userId: me.id, username: me.username, fullName, category, about, links, status: "pending", createdAt: new Date().toISOString() });
      save("verifyRequests");
      require("./admin").pingAdmins();
      console.log(`[verification] @${me.username} applied (${category}). See data/verifyRequests.json`);
      sendJSON(res, 201, { ok: true });
      return true;
    }
  }

  // Edit my profile: POST /api/me/profile { name, bio, avatar, banner }
  if (m === "POST" && a === "me" && b === "profile" && parts.length === 2) {
    const body = await readJSON(req);
    const name = clean(body.name).replace(/\s+/g, " ");
    const bio = clean(body.bio);
    const errors = {};
    if (!name) errors.name = "Your name can’t be empty.";
    else if (chars(name) > LIMITS.name) errors.name = `Keep your name under ${LIMITS.name} characters.`;
    if (chars(bio) > LIMITS.bio) errors.bio = `Keep your bio under ${LIMITS.bio} characters.`;

    const pick = (value, current) => {
      if (value === null) return null; // removed
      if (value === undefined || value === current) return current; // unchanged
      const ok = ownedMedia(value, me.id, "image");
      if (!ok) throw httpError(400, "That picture couldn’t be found. Try uploading it again.");
      return ok.url;
    };
    if (Object.keys(errors).length) { sendJSON(res, 400, { errors }); return true; }

    const avatar = pick(body.avatar, me.avatar);
    const banner = pick(body.banner, me.banner);
    if (me.avatar && me.avatar !== avatar) deleteMedia(me.avatar);
    if (me.banner && me.banner !== banner) deleteMedia(me.banner);
    if (avatar && avatar !== me.avatar) markUsed(avatar, "avatar:" + me.id);
    if (banner && banner !== me.banner) markUsed(banner, "banner:" + me.id);
    // People newly tagged in the bio hear about it
    const before = new Set(findMentions(me.bio));
    Object.assign(me, { name, bio, avatar, banner });
    save("users");
    for (const id of findMentions(bio)) if (!before.has(id) && id !== me.id) notify(id, "mention", me, { text: bio });
    broadcast({ type: "profile", username: me.username, name, avatar, banner, bio });
    sendJSON(res, 200, { profile: profileView(me, me) });
    return true;
  }

  // Suggestions while typing: GET /api/search/suggest?q=
  if (m === "GET" && a === "search" && b === "suggest" && parts.length === 2) {
    const q = clean(url.searchParams.get("q")).toLowerCase().replace(/^@/, "").slice(0, 60);
    if (!q) { sendJSON(res, 200, { people: [], groups: [], terms: [], events: [] }); return true; }
    const starts = (t) => t.toLowerCase().split(/[^\p{L}\p{N}_]+/u).some((w) => w.startsWith(q));
    const people = db.users
      .filter((u) => !(u.blocked || []).includes(me.id) && (u.username.toLowerCase().startsWith(q) || starts(u.name)))
      .sort((x, y) => Number(me.following.includes(y.id)) - Number(me.following.includes(x.id)) || followerCount(y) - followerCount(x))
      .slice(0, 5).map((u) => ({ ...authorView(u), followers: followerCount(u) }));
    const groups = db.chats.filter((c) => c.kind === "group" && c.visibility === "public" && starts(c.name + " " + (c.description || "")))
      .sort((x, y) => y.members.length - x.members.length).slice(0, 3)
      .map((c) => ({ id: c.id, name: c.name, cover: c.cover, color: c.color, memberCount: c.members.length, kind: "group" }));
    // Phrases from posts: the words that start with what you typed, plus the next couple of words
    const counts = new Map();
    for (const p of db.posts) {
      if (p.visibility !== "public" || !canView(p, me)) continue;
      const text = `${p.title || ""} ${p.text || ""}`.replace(/\s+/g, " ");
      const lower = text.toLowerCase();
      let i = lower.indexOf(q);
      while (i !== -1 && counts.size < 400) {
        if (i === 0 || /[^\p{L}\p{N}_#]/u.test(lower[i - 1])) {
          // the word(s) you typed plus the next word, without punctuation
          const words = text.slice(i).match(/[\p{L}\p{N}_'#]+/gu) || [];
          const phrase = words.slice(0, q.trim().split(/\s+/).length + 1).join(" ").toLowerCase();
          if (phrase.length > q.length - 1) counts.set(phrase, (counts.get(phrase) || 0) + 1 + p.viewedBy.length / 50);
        }
        i = lower.indexOf(q, i + 1);
      }
    }
    const terms = [...counts].sort((x, y) => y[1] - x[1]).map(([t]) => t).slice(0, 5);
    const events = (db.events || []).filter((e) => new Date(e.startsAt).getTime() > Date.now() - 6 * 3600 * 1000 && starts(e.title + " " + (e.description || "")))
      .slice(0, 3).map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, cover: e.cover || null }));
    sendJSON(res, 200, { people, groups, terms, events });
    return true;
  }

  // Search: GET /api/search?q=
  if (m === "GET" && a === "search" && parts.length === 1) {
    const q = clean(url.searchParams.get("q")).toLowerCase().replace(/^@/, "");
    if (!q) { sendJSON(res, 200, { users: [], fromPeople: [], posts: [] }); return true; }
    const score = (u) => {
      const un = u.username.toLowerCase(), n = u.name.toLowerCase();
      if (un === q) return 0;
      if (un.startsWith(q) || n.startsWith(q)) return 1;
      if (n.split(/\s+/).some((w) => w.startsWith(q))) return 2;
      return un.includes(q) || n.includes(q) ? 3 : -1;
    };
    const users = db.users
      .map((u) => [score(u), u])
      .filter(([s, u]) => s >= 0 && !(u.blocked || []).includes(me.id))
      .sort((x, y) => x[0] - y[0] || followerCount(y[1]) - followerCount(x[1]))
      .slice(0, 20)
      .map(([, u]) => ({ ...authorView(u), bio: u.bio, isMe: u.id === me.id, isFollowing: me.following.includes(u.id) }));
    // Searching a person's name also shows what they posted (for the closest matches)
    const shown = new Set();
    const fromPeople = db.users
      .map((u) => [score(u), u])
      .filter(([s, u]) => s >= 0 && s <= 2 && !blockedBetween(u, me))
      .sort((x, y) => x[0] - y[0] || followerCount(y[1]) - followerCount(x[1]))
      .slice(0, 3)
      .map(([, u]) => {
        const theirs = db.posts.filter((p) => p.userId === u.id && p.visibility === "public" && canView(p, me)).slice(0, 12);
        theirs.forEach((p) => shown.add(p.id));
        return { user: authorView(u), posts: theirs.map((p) => postView(p, me)) };
      })
      .filter((x) => x.posts.length);
    const posts = db.posts
      .filter((p) => !shown.has(p.id) && p.visibility === "public" && canView(p, me) && (p.text + " " + p.title).toLowerCase().includes(q))
      .slice(0, 20)
      .map((p) => postView(p, me));
    sendJSON(res, 200, { users, fromPeople, posts });
    return true;
  }

  return false;
}

// Deletes a post with its files and replies (used by its author and by the LookBlog team)
function removePost(post) {
  const i = db.posts.indexOf(post);
  if (i === -1) return;
  db.posts.splice(i, 1);
  for (const md of post.media) { deleteMedia(md.url); if (md.poster) deleteMedia(md.poster); for (const r of md.renditions || []) deleteMedia(r.url); }
  db.comments = db.comments.filter((x) => {
    if (x.postId !== post.id) return true;
    if (x.media && !x.media.gif && !x.media.sticker && !x.media.shared) { deleteMedia(x.media.url); if (x.media.poster) deleteMedia(x.media.poster); }
    return false;
  });
  // A stream's recording: the stream goes with it
  if (post.stream?.id && db.streams) { const si = db.streams.findIndex((x) => x.id === post.stream.id && !x.live); if (si > -1) { db.streams.splice(si, 1); save("streams"); } }
  save("posts");
  save("comments");
  broadcast({ type: "post:deleted", id: post.id });
}

module.exports = { activeNote, removePost, starsView, notPlainVideo, resolveExtras, cleanClip, handleSocial, resolveGif, canView, blockedBetween, canMakeFilms, canMakeMusic, postView, authorView, buildMedia, claim, findMentions, usernamesOf, clean, chars };
