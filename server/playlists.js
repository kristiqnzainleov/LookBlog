// Playlists: series of videos with a title, description and cover.

const crypto = require("crypto");
const { db, save, findUser, findByUsername, findPost } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { ownedMedia, markUsed, deleteMedia } = require("./media");
const { postView, authorView, clean, chars, canView, canMakeFilms } = require("./social");

const MAX_VIDEOS = 200;

function cover(pl) {
  if (pl.cover) return pl.cover;
  const first = pl.videoIds.map(findPost).find((p) => p && p.visibility === "public");
  return first?.media[0]?.poster || null;
}

// Reviews on a series, each with the writer's stars
function reviewsView(pl, me) {
  const { authorView } = require("./social");
  return (pl.reviews || []).map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt, author: authorView(findUser(r.userId)), stars: pl.stars?.[r.userId] || null, canDelete: r.userId === me.id || pl.userId === me.id }));
}
function playlistView(pl, me, withVideos = false) {
  // Other people only see public videos in a playlist; unlisted and private ones stay with the link / the owner
  const videos = pl.videoIds.map(findPost).filter((p) => p && p.type === "video" && (p.userId === me.id || p.visibility === "public"));
  const out = {
    id: pl.id,
    title: pl.title,
    description: pl.description,
    cover: cover(pl),
    customCover: Boolean(pl.cover),
    count: videos.length,
    owner: authorView(findUser(pl.userId)),
    mine: pl.userId === me.id,
    visibility: pl.visibility || "public",
    kind: pl.kind || "playlist",
    series: pl.kind === "series" ? { genre: pl.genre || null, year: pl.year || null, rating: pl.rating || null, tagline: pl.tagline || null, logo: pl.logo || null } : null,
    stars: pl.kind === "series" ? require("./social").starsView(pl.stars, me) : null,
    reviews: pl.kind === "series" && withVideos ? reviewsView(pl, me) : undefined,
    views: videos.reduce((n, p) => n + p.viewedBy.length, 0),
    seasons: pl.kind === "series" ? pl.seasons || {} : undefined,
    seasonInfo: pl.kind === "series" ? pl.seasonInfo || {} : undefined,
    seasonCount: pl.kind === "series" ? Math.max(pl.seasonCount || 1, ...Object.values(pl.seasons || {}).map(Number), 1) : undefined,
    createdAt: pl.createdAt,
    updatedAt: pl.updatedAt,
  };
  if (withVideos) out.videos = videos.map((p) => postView(p, me));
  return out;
}

function validate(body, me, current = null) {
  const title = clean(body.title);
  const description = clean(body.description);
  if (!title) throw httpError(400, "Give your playlist a name.");
  if (chars(title) > 80) throw httpError(400, "Keep the name under 80 characters.");
  if (chars(description) > 1000) throw httpError(400, "Keep the description under 1000 characters.");
  let cov = current ? current.cover : null;
  if (body.cover === null) cov = null;
  else if (body.cover && body.cover !== cov) {
    const ok = ownedMedia(body.cover, me.id, "image");
    if (!ok) throw httpError(400, "That cover couldn’t be found. Try uploading it again.");
    cov = ok.url;
  }
  const visibility = ["public", "unlisted", "private"].includes(body.visibility) ? body.visibility : current?.visibility || "public";
  const kind = body.kind === "series" || current?.kind === "series" ? "series" : "playlist";
  if (kind === "series" && !current && !canMakeFilms(me)) throw httpError(403, "Series are for filmmakers, film producers, photographers and creators. Add one of them under “What do you do?” on your profile.");
  const out = { title, description, cover: cov, visibility, kind };
  if (kind === "series") {
    const year = Number(body.year);
    out.year = year >= 1888 && year <= new Date().getFullYear() + 2 ? year : current?.year || null;
    out.genre = body.genre !== undefined ? clean(body.genre).slice(0, 40) || null : current?.genre || null;
    out.rating = ["All ages", "7+", "13+", "16+", "18+"].includes(body.rating) ? body.rating : current?.rating || null;
    out.tagline = body.tagline !== undefined ? clean(body.tagline).slice(0, 140) || null : current?.tagline || null;
  }
  return out;
}
// public: on the profile for everyone · unlisted: only with the link · private: only the owner
const canSeePlaylist = (pl, me) => pl.userId === me.id || (pl.visibility || "public") !== "private";

// A movie, or an episode of a series: they live in Movies & Series, not in normal playlists
const isCinema = (p) => Boolean(p.film) || db.playlists.some((x) => x.kind === "series" && x.videoIds.includes(p.id));
async function handlePlaylists(req, res, url, me) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // without "api"
  const [a, b, c] = parts;
  const m = req.method;

  // Someone's playlists: GET /api/users/:username/playlists
  if (m === "GET" && a === "users" && c === "playlists" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    const kind = url.searchParams.get("kind");
    const list = db.playlists.filter((p) => p.userId === user.id && (user.id === me.id || (p.visibility || "public") === "public") && (!kind || (p.kind || "playlist") === kind))
      .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
    sendJSON(res, 200, { playlists: list.map((p) => playlistView(p, me)) });
    return true;
  }

  // Movies and series (the Cinema page): GET /api/cinema
  if (m === "GET" && a === "cinema" && parts.length === 1) {
    const series = db.playlists.filter((p) => p.kind === "series" && (p.visibility || "public") === "public" && p.videoIds.length)
      .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).slice(0, 40).map((p) => playlistView(p, me));
    const movies = db.posts.filter((p) => p.type === "video" && p.film && p.visibility === "public" && canView(p, me)).slice(0, 60).map((p) => postView(p, me));
    const mine = { series: db.playlists.filter((p) => p.kind === "series" && p.userId === me.id).map((p) => playlistView(p, me)), movies: db.posts.filter((p) => p.film && p.userId === me.id).map((p) => postView(p, me)) };
    sendJSON(res, 200, { series, movies, mine, canMake: canMakeFilms(me) });
    return true;
  }

  if (a !== "playlists") return false;

  // My playlists (for "Save to playlist"): GET /api/playlists?contains=<videoId>
  if (m === "GET" && parts.length === 1) {
    const contains = url.searchParams.get("contains");
    // Series aren't here: episodes are added from the series page only
    const list = db.playlists.filter((p) => p.userId === me.id && p.kind !== "series").sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
    sendJSON(res, 200, { playlists: list.map((p) => ({ ...playlistView(p, me), hasVideo: contains ? p.videoIds.includes(contains) : false })) });
    return true;
  }

  // Create: POST /api/playlists { title, description, cover }
  if (m === "POST" && parts.length === 1) {
    rateLimit("playlist:" + me.id, 30, 10 * 60 * 1000, "You’re making a lot of playlists. Take a short break.");
    const data = validate(await readJSON(req), me);
    const now = new Date().toISOString();
    const pl = { id: crypto.randomUUID(), userId: me.id, ...data, videoIds: [], createdAt: now, updatedAt: now };
    if (pl.cover) markUsed(pl.cover, "playlist:" + pl.id);
    db.playlists.push(pl);
    save("playlists");
    sendJSON(res, 201, { playlist: playlistView(pl, me, true) });
    return true;
  }

  // Videos I could add: GET /api/playlists/candidates?q=   (mine first, then public videos)
  if (m === "GET" && b === "candidates" && parts.length === 2) {
    const q = clean(url.searchParams.get("q")).toLowerCase();
    const match = (p) => !q || `${p.title || ""} ${p.text || ""}`.toLowerCase().includes(q);
    const mine = db.posts.filter((p) => p.type === "video" && p.userId === me.id && match(p));
    const others = q ? db.posts.filter((p) => p.type === "video" && p.userId !== me.id && p.visibility === "public" && canView(p, me) && match(p)).slice(0, 30) : [];
    sendJSON(res, 200, { mine: mine.slice(0, 60).map((p) => postView(p, me)), others: others.map((p) => postView(p, me)) });
    return true;
  }

  const pl = db.playlists.find((p) => p.id === b);
  if (!pl || !canSeePlaylist(pl, me)) throw httpError(404, "This playlist doesn’t exist.");

  // Open: GET /api/playlists/:id
  if (m === "GET" && parts.length === 2) {
    sendJSON(res, 200, { playlist: playlistView(pl, me, true) });
    return true;
  }

  // Series reviews: POST /api/playlists/:id/reviews { text } · DELETE /api/playlists/:id/reviews/:rid
  if (c === "reviews" && pl.kind === "series") {
    const { clean, chars, authorView } = require("./social");
    if (m === "POST" && parts.length === 3) {
      const text = clean((await readJSON(req)).text);
      if (!text) throw httpError(400, "Write your review.");
      if (chars(text) > 1500) throw httpError(400, "Keep reviews under 1,500 characters.");
      pl.reviews = pl.reviews || [];
      pl.reviews.unshift({ id: crypto.randomUUID().slice(0, 10), userId: me.id, text, createdAt: new Date().toISOString() });
      save("playlists");
      sendJSON(res, 201, { reviews: reviewsView(pl, me) });
      return true;
    }
    if (m === "DELETE" && parts.length === 4) {
      const r = (pl.reviews || []).find((x) => x.id === parts[3]);
      if (!r || (r.userId !== me.id && pl.userId !== me.id)) throw httpError(404, "That review is gone.");
      pl.reviews = pl.reviews.filter((x) => x !== r);
      save("playlists");
      sendJSON(res, 200, { reviews: reviewsView(pl, me) });
      return true;
    }
  }
  // Rate a series: POST /api/playlists/:id/stars { stars: 1–5, or 0 to take it back }
  if (m === "POST" && c === "stars" && parts.length === 3) {
    if (pl.kind !== "series") throw httpError(400, "Only series can be rated.");
    if (pl.userId === me.id) throw httpError(400, "You can’t rate your own series.");
    const n = Math.round(Number((await readJSON(req)).stars) || 0);
    pl.stars = pl.stars || {};
    if (n >= 1 && n <= 5) pl.stars[me.id] = n; else delete pl.stars[me.id];
    save("playlists");
    sendJSON(res, 200, { stars: require("./social").starsView(pl.stars, me) });
    return true;
  }
  if (pl.userId !== me.id) throw httpError(403, "Only the owner can change this playlist.");

  // Edit: POST /api/playlists/:id { title, description, cover }
  if (m === "POST" && parts.length === 2) {
    const data = validate(await readJSON(req), me, pl);
    if (pl.cover && pl.cover !== data.cover) deleteMedia(pl.cover);
    if (data.cover && data.cover !== pl.cover) markUsed(data.cover, "playlist:" + pl.id);
    Object.assign(pl, data, { updatedAt: new Date().toISOString() });
    save("playlists");
    sendJSON(res, 200, { playlist: playlistView(pl, me, true) });
    return true;
  }

  // Delete: DELETE /api/playlists/:id
  if (m === "DELETE" && parts.length === 2) {
    db.playlists = db.playlists.filter((p) => p !== pl);
    if (pl.cover) deleteMedia(pl.cover);
    save("playlists");
    sendJSON(res, 200, { ok: true });
    return true;
  }

  // Series: which season an episode is in: POST /api/playlists/:id/season { postId, season }
  if (m === "POST" && c === "season" && parts.length === 3) {
    const { postId, season } = await readJSON(req);
    if (!pl.videoIds.includes(postId)) throw httpError(404, "That episode isn’t in this series.");
    const n = Math.max(1, Math.min(50, Math.round(Number(season) || 1)));
    pl.seasons = { ...(pl.seasons || {}), [postId]: n };
    pl.updatedAt = new Date().toISOString();
    save("playlists");
    sendJSON(res, 200, { playlist: playlistView(pl, me, true) });
    return true;
  }
  // Add a season: POST /api/playlists/:id/seasons  → one more season (up to 50)
  if (m === "POST" && c === "seasons" && parts.length === 3) {
    if (pl.kind !== "series") throw httpError(400, "Only series have seasons.");
    const now = Math.max(pl.seasonCount || 1, ...Object.values(pl.seasons || {}).map(Number), 1);
    if (now >= 50) throw httpError(400, "A series can have up to 50 seasons.");
    pl.seasonCount = now + 1;
    // The year is simply the year you add it (change it later with "Edit season" if you like)
    const body = await readJSON(req);
    pl.seasonInfo = { ...(pl.seasonInfo || {}), [pl.seasonCount]: { year: new Date().getFullYear(), title: clean(body.title).slice(0, 60) || null } };
    pl.updatedAt = new Date().toISOString();
    save("playlists");
    sendJSON(res, 200, { playlist: playlistView(pl, me, true), season: pl.seasonCount });
    return true;
  }
  // Remove the last season (only when it's empty): DELETE /api/playlists/:id/seasons
  if (m === "DELETE" && c === "seasons" && parts.length === 3) {
    const now = Math.max(pl.seasonCount || 1, ...Object.values(pl.seasons || {}).map(Number), 1);
    if (now <= 1) throw httpError(400, "A series needs at least one season.");
    if (Object.entries(pl.seasons || {}).some(([id, n]) => Number(n) === now && pl.videoIds.includes(id))) throw httpError(400, "Move this season’s episodes first.");
    pl.seasonCount = now - 1;
    save("playlists");
    sendJSON(res, 200, { playlist: playlistView(pl, me, true) });
    return true;
  }

  // A season's year and name: POST /api/playlists/:id/season-info { season, year, title }
  if (m === "POST" && c === "season-info" && parts.length === 3) {
    if (pl.kind !== "series") throw httpError(400, "Only series have seasons.");
    const body = await readJSON(req);
    const n = Math.max(1, Math.min(50, Math.round(Number(body.season) || 1)));
    const year = Number(body.year);
    pl.seasonInfo = { ...(pl.seasonInfo || {}), [n]: { year: year >= 1888 && year <= new Date().getFullYear() + 2 ? year : null, title: clean(body.title).slice(0, 60) || null } };
    pl.updatedAt = new Date().toISOString();
    save("playlists");
    sendJSON(res, 200, { playlist: playlistView(pl, me, true) });
    return true;
  }

  // Move an episode: POST /api/playlists/:id/move { postId, to }
  if (m === "POST" && c === "move" && parts.length === 3) {
    const { postId, to } = await readJSON(req);
    const i = pl.videoIds.indexOf(postId);
    if (i === -1) throw httpError(404, "That video isn’t in this playlist.");
    pl.videoIds.splice(i, 1);
    pl.videoIds.splice(Math.max(0, Math.min(pl.videoIds.length, Number(to) || 0)), 0, postId);
    save("playlists");
    sendJSON(res, 200, { playlist: playlistView(pl, me, true) });
    return true;
  }

  // Add or remove a video: POST /api/playlists/:id/videos { postId, add }
  if (m === "POST" && c === "videos" && parts.length === 3) {
    const body = await readJSON(req);
    // Several at once: { postIds: [...], add: true }
    if (Array.isArray(body.postIds)) {
      let added = 0;
      for (const id of body.postIds.slice(0, 100)) {
        const p = findPost(id);
        if (!p || p.type !== "video" || !canView(p, me) || pl.videoIds.includes(p.id)) continue;
        if (pl.kind !== "series" && isCinema(p)) continue; // movies and episodes don't go in normal playlists
        if (pl.videoIds.length >= MAX_VIDEOS) break;
        pl.videoIds.push(p.id);
        if (pl.kind === "series" && body.season) pl.seasons = { ...(pl.seasons || {}), [p.id]: Math.max(1, Math.min(50, Math.round(Number(body.season)))) };
        added++;
      }
      pl.updatedAt = new Date().toISOString();
      save("playlists");
      sendJSON(res, 200, { playlist: playlistView(pl, me, true), added });
      return true;
    }
    const { postId, add } = body;
    if (pl.kind === "series" && add) throw httpError(400, "Add episodes from the series page (Add episodes).");
    const post = findPost(postId);
    if (!post || post.type !== "video" || !canView(post, me)) throw httpError(404, "That video doesn’t exist.");
    if (add && pl.kind !== "series" && isCinema(post)) throw httpError(400, post.film ? "Movies can’t be added to playlists." : "Series episodes can’t be added to playlists.");
    pl.videoIds = pl.videoIds.filter((id) => id !== post.id);
    if (add) {
      if (pl.videoIds.length >= MAX_VIDEOS) throw httpError(400, `A playlist can hold up to ${MAX_VIDEOS} videos.`);
      pl.videoIds.push(post.id);
      if (post.userId !== me.id) post.saves = (post.saves || 0) + 1;
    }
    pl.updatedAt = new Date().toISOString();
    save("playlists");
    sendJSON(res, 200, { playlist: playlistView(pl, me), added: Boolean(add) });
    return true;
  }

  return false;
}

module.exports = { handlePlaylists };
