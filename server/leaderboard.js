// Leaderboards: most followed, most watched, most liked, top artists, and this week's top songs and videos.
const { db, findUser } = require("./db");
const { sendJSON } = require("./http");
const { authorView, canView, blockedBetween } = require("./social");

const sum = (a) => a.reduce((n, x) => n + x, 0);
const weekKeys = () => { const out = []; const t = new Date(); for (let i = 0; i < 7; i++) out.push(new Date(t.getTime() - i * 86400000).toISOString().slice(0, 10)); return out; };
let cache = { at: 0, data: null };

function compute() {
  const week = new Set(weekKeys());
  const weekAgo = Date.now() - 7 * 86400000;
  const people = db.users.filter((u) => !u.private || true);
  const followers = new Map(people.map((u) => [u.id, 0]));
  for (const u of db.users) for (const id of u.following) if (followers.has(id)) followers.set(id, followers.get(id) + 1);
  const pub = db.posts.filter((p) => p.visibility === "public");
  const by = (fn) => { const m = new Map(); for (const p of pub) m.set(p.userId, (m.get(p.userId) || 0) + fn(p)); return m; };
  const views = by((p) => (p.type !== "post" ? p.viewedBy.length : 0));
  const likes = by((p) => p.likes.length + p.cools.length);
  const plays = new Map();
  for (const s of db.songs) plays.set(s.userId, (plays.get(s.userId) || 0) + (s.plays || 0));
  const listeners = new Map();
  for (const s of db.songs) { const set = listeners.get(s.userId) || new Set(); (s.listeners || []).forEach((x) => set.add(x)); listeners.set(s.userId, set); }
  const board = (m, unit, extra) => [...m].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([id, n]) => ({ userId: id, value: n, unit, ...(extra ? extra(id) : {}) }));
  // This week
  const songsWeek = db.songs.map((s) => ({ s, n: sum(Object.entries(s.playDaily || {}).filter(([k]) => week.has(k)).map(([, v]) => v)) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 50);
  const videosWeek = pub.filter((p) => p.type === "video" || p.type === "short").map((p) => ({ p, n: (p.viewLog || []).filter((v) => new Date(v.at).getTime() >= weekAgo).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 50);
  // Series: views on all their episodes; films: views on movies
  const postById = new Map(db.posts.map((p) => [p.id, p]));
  const series = db.playlists.filter((pl) => pl.kind === "series" && (pl.visibility || "public") === "public").map((pl) => {
    const eps = pl.videoIds.map((id) => postById.get(id)).filter((p) => p && p.visibility === "public");
    const viewers = new Set(); eps.forEach((p) => p.viewedBy.forEach((x) => viewers.add(x)));
    return { id: pl.id, n: sum(eps.map((p) => p.viewedBy.length)), viewers: viewers.size, episodes: eps.length, likes: sum(eps.map((p) => p.likes.length)) };
  }).filter((x) => x.episodes).sort((a, b) => b.n - a.n || b.likes - a.likes).slice(0, 50);
  const films = pub.filter((p) => p.film).map((p) => ({ id: p.id, n: p.viewedBy.length, likes: p.likes.length })).sort((a, b) => b.n - a.n || b.likes - a.likes).slice(0, 50);
  // Streamers: different people who watched their lives (all streams), then peak and live watch time
  const streamers = new Map();
  for (const st of db.streams || []) {
    if (!st.startedAt) continue;
    const x = streamers.get(st.userId) || { viewers: new Set(), peak: 0, minutes: 0, streams: 0, likes: 0, dislikes: 0 };
    (st.stats?.viewers || []).forEach((v) => x.viewers.add(v));
    x.peak = Math.max(x.peak, st.peak || 0);
    x.minutes += (st.stats?.watchSeconds || 0) / 60;
    x.streams++; x.likes += (st.likes || []).length; x.dislikes += (st.dislikes || []).length;
    // likes on the recording count too
    const rec = st.postId && db.posts.find((p) => p.id === st.postId);
    if (rec) x.likes += rec.likes.length;
    streamers.set(st.userId, x);
  }
  // Ranked by viewers and likes together (a like counts twice, a dislike takes one away)
  const all = [...streamers].map(([id, x]) => ({ userId: id, viewers: x.viewers.size, streams: x.streams, peak: x.peak, minutes: Math.round(x.minutes), likes: x.likes, score: x.viewers.size + x.likes * 2 - x.dislikes })).filter((x) => x.streams);
  const streams = all.map((x) => ({ ...x, value: x.score, unit: "points" })).sort((a, b) => b.value - a.value || b.likes - a.likes || b.peak - a.peak).slice(0, 50);
  const streamsLiked = all.map((x) => ({ ...x, value: x.likes, unit: "likes" })).filter((x) => x.likes > 0).sort((a, b) => b.value - a.value || b.viewers - a.viewers).slice(0, 50);
  return {
    streams, "streams-liked": streamsLiked,
    series, films,
    followers: board(followers, "followers"),
    views: board(views, "views"),
    likes: board(likes, "likes & Cools"),
    artists: board(plays, "plays", (id) => ({ listeners: (listeners.get(id) || new Set()).size })),
    songsWeek: songsWeek.map((x) => ({ songId: x.s.id, value: x.n })),
    videosWeek: videosWeek.map((x) => ({ postId: x.p.id, value: x.n })),
  };
}

async function handleLeaderboard(req, res, url, me) {
  if (req.method !== "GET" || url.pathname !== "/api/leaderboard") return false;
  if (!cache.data || Date.now() - cache.at > 60 * 1000) cache = { at: Date.now(), data: compute() };
  const board = url.searchParams.get("board") || "followers";
  const d = cache.data;
  const person = (x, i) => { const u = findUser(x.userId); return u && !blockedBetween(u, me) ? { rank: i + 1, user: { ...authorView(u), isMe: u.id === me.id }, value: x.value, unit: x.unit, listeners: x.listeners, streams: x.streams, peak: x.peak, minutes: x.minutes, likes: x.likes, viewers: x.viewers } : null; };
  let list;
  if (board === "songs-week") {
    const { songView } = require("./music");
    list = d.songsWeek.map((x, i) => { const s = db.songs.find((y) => y.id === x.songId); return s && !blockedBetween(findUser(s.userId), me) ? { rank: i + 1, song: songView(s, me), value: x.value, unit: "plays this week" } : null; });
  } else if (board === "videos-week") {
    const { postView } = require("./social");
    list = d.videosWeek.map((x, i) => { const p = db.posts.find((y) => y.id === x.postId); return p && canView(p, me) ? { rank: i + 1, post: postView(p, me), value: x.value, unit: "views this week" } : null; });
  } else if (board === "series") {
    list = d.series.map((x) => {
      const pl = db.playlists.find((y) => y.id === x.id); const u = pl && findUser(pl.userId);
      if (!u || blockedBetween(u, me)) return null;
      const cover = pl.cover || (pl.videoIds.map((id) => db.posts.find((p) => p.id === id)).find(Boolean)?.media[0]?.poster) || null;
      return { series: { id: pl.id, title: pl.title, cover, genre: pl.genre || null, year: pl.year || null, episodes: x.episodes, viewers: x.viewers, likes: x.likes, author: authorView(u) }, value: x.n, unit: "views" };
    });
  } else if (board === "films") {
    const { postView } = require("./social");
    list = d.films.map((x) => { const p = db.posts.find((y) => y.id === x.id); return p && canView(p, me) ? { post: postView(p, me), film: true, value: x.n, unit: "views" } : null; });
  } else list = (d[board] || d.followers).map(person);
  list = list.filter(Boolean).map((x, i) => ({ ...x, rank: i + 1 }));
  sendJSON(res, 200, { board, list, updatedAt: new Date(cache.at).toISOString() });
  return true;
}

module.exports = { handleLeaderboard };
