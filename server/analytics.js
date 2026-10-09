// Analytics for your own content: views, reach, watch time, retention, traffic sources, audience.
const { db, findUser, findPost } = require("./db");
const { sendJSON, httpError } = require("./http");

const DAY = 86400000;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
function daysBack(n) {
  const out = [];
  const t = new Date(); t.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(t.getTime() - i * DAY));
  return out;
}
const sum = (a) => a.reduce((n, x) => n + x, 0);
const N = 50;

function postSummary(p) {
  const w = p.watch;
  const dur = p.media?.find((m) => m.kind === "video")?.duration || 0;
  const avgSec = w && w.plays ? w.seconds / w.plays : 0;
  const reach = (p.reachedBy || [...new Set([...(p.viewedBy || []), ...(p.impressedBy || [])])]).length;
  return {
    id: p.id, type: p.type, stream: Boolean(p.stream), title: p.title || (p.text || "").slice(0, 80) || (p.type === "post" ? "Photo post" : "Untitled"),
    thumb: p.media?.[0] ? (p.media[0].kind === "image" ? p.media[0].url : p.media[0].poster || null) : null,
    createdAt: p.createdAt, visibility: p.visibility, duration: dur,
    views: (p.views ?? p.viewedBy.length), viewers: p.viewedBy.length, reach, impressions: p.impressions || 0,
    ctr: p.impressions ? Math.round((p.viewedBy.length / p.impressions) * 1000) / 10 : null,
    plays: w?.plays || 0, watchMinutes: Math.round(((w?.seconds || 0) / 60) * 10) / 10,
    avgViewSec: Math.round(avgSec * 10) / 10,
    avgViewPct: dur && avgSec ? Math.min(100, Math.round((avgSec / dur) * 100)) : null,
    completionPct: w && w.plays ? Math.round((w.completes / w.plays) * 100) : null,
    likes: p.likes.length, dislikes: p.dislikes.length, cools: p.cools.length, comments: p.commentCount,
    reposts: p.reposts.length, shares: p.shares || 0, saves: p.saves || 0,
  };
}

function overview(me, days) {
  const range = days ? daysBack(days) : null;
  const from = range ? range[0] : "0000";
  const prevFrom = days ? dayKey(Date.now() - days * 2 * DAY) : null;
  const mine = db.posts.filter((p) => p.userId === me.id);
  const followers = db.users.filter((u) => u.following.includes(me.id));
  const followerIds = new Set(followers.map((u) => u.id));

  const logs = mine.flatMap((p) => (p.viewLog || []).map((v) => ({ ...v, p })));
  const inRange = logs.filter((v) => v.at.slice(0, 10) >= from);
  const prev = days ? logs.filter((v) => v.at.slice(0, 10) >= prevFrom && v.at.slice(0, 10) < from) : [];
  const watchIn = (k0, k1) => sum(mine.map((p) => sum(Object.entries(p.watch?.daily || {}).filter(([k]) => k >= k0 && (!k1 || k < k1)).map(([, v]) => v))));
  const follows = db.followLog.filter((f) => f.t === me.id);
  const net = (k0, k1) => sum(follows.filter((f) => f.at.slice(0, 10) >= k0 && (!k1 || f.at.slice(0, 10) < k1)).map((f) => (f.on ? 1 : -1)));
  const visits = me.visits || {};
  const visitsIn = (k0, k1) => sum(Object.entries(visits).filter(([k]) => k >= k0 && (!k1 || k < k1)).map(([, v]) => v));

  // Daily series for the chart
  const keys = range || [...new Set([...logs.map((v) => v.at.slice(0, 10)), ...Object.keys(visits)])].sort();
  const series = keys.map((k) => ({
    day: k,
    views: logs.filter((v) => v.at.slice(0, 10) === k).length,
    watchMinutes: Math.round(sum(mine.map((p) => p.watch?.daily?.[k] || 0)) / 6) / 10,
    followers: sum(follows.filter((f) => f.at.slice(0, 10) === k).map((f) => (f.on ? 1 : -1))),
    visits: visits[k] || 0,
  }));

  const sources = {};
  for (const v of inRange) sources[v.src || "other"] = (sources[v.src || "other"] || 0) + 1;
  const fromFollowers = inRange.filter((v) => v.f).length;

  // Top content in the period
  const perPost = new Map();
  for (const v of inRange) perPost.set(v.p.id, (perPost.get(v.p.id) || 0) + 1);
  const top = [...perPost].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ ...postSummary(findPost(id)), periodViews: n }));

  // Fans: who engages with you the most
  const score = new Map();
  const add = (id, n) => { if (id && id !== me.id) score.set(id, (score.get(id) || 0) + n); };
  for (const p of mine) {
    p.viewedBy.forEach((id) => add(id, 1));
    p.likes.forEach((id) => add(id, 2));
    p.cools.forEach((id) => add(id, 3));
    p.reposts.forEach((r) => add(r.userId, 4));
  }
  for (const c of db.comments) { const p = findPost(c.postId); if (p && p.userId === me.id) add(c.userId, 3); }
  const fans = [...score].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => {
    const u = findUser(id);
    return u && { name: u.name, username: u.username, avatar: u.avatar, verified: Boolean(u.verified), verifiedType: u.verifiedType || null, score: n, follows: followerIds.has(id) };
  }).filter(Boolean);

  // When followers are online (sum of their hourly activity)
  const hours = Array(24).fill(0);
  for (const u of followers) (u.onlineHours || []).forEach((n, h) => (hours[h] += n));

  const totals = {
    views: inRange.length, viewsPrev: days ? prev.length : null,
    reach: new Set(inRange.map((v) => v.u)).size,
    watchMinutes: Math.round(watchIn(from) / 6) / 10, watchMinutesPrev: days ? Math.round(watchIn(prevFrom, from) / 6) / 10 : null,
    followers: followers.length, followersNet: days ? net(from) : null,
    visits: days ? visitsIn(from) : sum(Object.values(visits)), visitsPrev: days ? visitsIn(prevFrom, from) : null,
    likes: sum(mine.map((p) => p.likes.length)), cools: sum(mine.map((p) => p.cools.length)),
    comments: sum(mine.map((p) => p.commentCount)), reposts: sum(mine.map((p) => p.reposts.length)),
    shares: sum(mine.map((p) => p.shares || 0)), saves: sum(mine.map((p) => p.saves || 0)),
    impressions: sum(mine.map((p) => (range ? sum(range.map((k) => p.impDaily?.[k] || 0)) : p.impressions || 0))),
    allTimeViews: sum(mine.map((p) => (p.views ?? p.viewedBy.length))),
  };
  totals.engagementRate = totals.allTimeViews ? Math.round(((totals.likes + totals.cools + totals.comments + totals.reposts + totals.shares) / totals.allTimeViews) * 1000) / 10 : 0;

  return {
    days, totals, series, sources, top, fans, hours,
    audience: { fromFollowers, fromOthers: inRange.length - fromFollowers },
    content: mine.map(postSummary).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

function postDetail(p) {
  const w = p.watch;
  const base = postSummary(p);
  // Retention: share of plays that watched each part of the video
  const retention = w && w.plays ? w.buckets.map((n) => Math.round((n / w.plays) * 1000) / 10) : [];
  let bigDrop = null;
  for (let i = 1; i < retention.length; i++) {
    const d = retention[i - 1] - retention[i];
    if (d > 0 && (!bigDrop || d > bigDrop.drop)) bigDrop = { at: i / N, drop: Math.round(d * 10) / 10 };
  }
  const logs = p.viewLog || [];
  const keys = daysBack(28);
  return {
    ...base,
    retention, exits: w?.exits || [], skips: w?.skips || [], bigDrop,
    sources: w?.sources && Object.keys(w.sources).length ? w.sources : logs.reduce((o, v) => ((o[v.src || "other"] = (o[v.src || "other"] || 0) + 1), o), {}),
    daily: keys.map((k) => ({ day: k, views: logs.filter((v) => v.at.slice(0, 10) === k).length, impressions: p.impDaily?.[k] || 0 })),
    fromFollowers: logs.filter((v) => v.f).length, fromOthers: logs.filter((v) => !v.f).length,
    // Reach: how many different people it got to, by day, and how far down the funnel they went
    reachDaily: keys.map((k) => ({ day: k, people: p.reachDaily?.[k] || 0 })),
    reachFollowers: Math.min(base.reach, p.reachFollowers || 0),
    funnel: {
      reached: base.reach,
      viewed: (p.views ?? p.viewedBy.length),
      engaged: new Set([...p.likes, ...p.cools, ...p.reposts.map((r) => r.userId), ...db.comments.filter((c) => c.postId === p.id).map((c) => c.userId)]).size,
      finished: w?.completes || 0,
    },
  };
}

/* ---------- Creators: series, films and music ---------- */
const { canMakeFilms, canMakeMusic } = require("./social");
function creator(me) {
  const out = { canFilms: canMakeFilms(me), canMusic: canMakeMusic(me) };
  if (out.canFilms) {
    const films = db.posts.filter((p) => p.userId === me.id && p.film).map((p) => ({ ...postSummary(p), year: p.film.year, genre: p.film.genre }));
    out.films = { list: films, totals: { views: sum(films.map((f) => f.views)), reach: sum(films.map((f) => f.reach)), watchMinutes: Math.round(sum(films.map((f) => f.watchMinutes)) * 10) / 10, likes: sum(films.map((f) => f.likes)) } };
    out.series = db.playlists.filter((pl) => pl.userId === me.id && pl.kind === "series").map((pl) => {
      const eps = pl.videoIds.map(findPost).filter(Boolean).map((p) => ({ ...postSummary(p), season: pl.seasons?.[p.id] || 1 }));
      const seasons = {};
      for (const e of eps) { const s = (seasons[e.season] = seasons[e.season] || { season: e.season, year: pl.seasonInfo?.[e.season]?.year || null, episodes: 0, views: 0, watchMinutes: 0 }); s.episodes++; s.views += e.views; s.watchMinutes += e.watchMinutes; }
      // How many people who watched episode 1 went on to the last one
      const first = eps[0] ? findPost(eps[0].id) : null, last = eps.length > 1 ? findPost(eps[eps.length - 1].id) : null;
      const kept = first && last ? last.viewedBy.filter((id) => first.viewedBy.includes(id)).length : null;
      return {
        id: pl.id, title: pl.title, cover: pl.cover || null, episodes: eps,
        seasons: Object.values(seasons).sort((a, b) => a.season - b.season),
        views: sum(eps.map((e) => e.views)), reach: new Set(eps.flatMap((e) => findPost(e.id).reachedBy || findPost(e.id).viewedBy)).size,
        watchMinutes: Math.round(sum(eps.map((e) => e.watchMinutes)) * 10) / 10,
        stayedToEnd: first && first.viewedBy.length && kept != null ? Math.round((kept / first.viewedBy.length) * 100) : null,
      };
    });
  }
  if (out.canMusic) {
    const songs = db.songs.filter((s) => s.userId === me.id);
    const keys = daysBack(28);
    out.music = {
      totals: { plays: sum(songs.map((s) => s.plays || 0)), listeners: new Set(songs.flatMap((s) => s.listeners || [])).size, likes: sum(songs.map((s) => s.likes.length)), songs: songs.length },
      daily: keys.map((k) => ({ day: k, plays: sum(songs.map((s) => s.playDaily?.[k] || 0)) })),
      songs: songs.map((s) => ({ id: s.id, title: s.title, cover: s.cover, plays: s.plays || 0, listeners: (s.listeners || []).length, likes: s.likes.length, followerPlays: s.followerPlays || 0, createdAt: s.createdAt, duration: s.duration || 0 }))
        .sort((a, b) => b.plays - a.plays),
    };
  }
  return out;
}

async function handleAnalytics(req, res, url, me) {
  if (req.method !== "GET" || !url.pathname.startsWith("/api/analytics")) return false;
  const m = url.pathname.match(/^\/api\/analytics\/post\/([\w-]+)$/);
  if (m) {
    const p = findPost(m[1]);
    if (!p || p.userId !== me.id) throw httpError(404, "That isn’t one of your posts.");
    sendJSON(res, 200, { post: postDetail(p) });
    return true;
  }
  if (url.pathname === "/api/analytics/creator") {
    sendJSON(res, 200, creator(me));
    return true;
  }
  if (url.pathname === "/api/analytics") {
    const d = Number(url.searchParams.get("days"));
    sendJSON(res, 200, overview(me, [7, 28, 90, 365].includes(d) ? d : d === 0 ? 0 : 28));
    return true;
  }
  return false;
}

module.exports = { handleAnalytics };
