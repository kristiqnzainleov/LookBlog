// Music (Spotify style): singers, rappers and DJs / producers upload songs with cover art.
// Anyone can listen, like songs and see an artist's popular tracks.

const crypto = require("crypto");
const { db, save, findUser, findByUsername } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { ownedMedia, markUsed, deleteMedia } = require("./media");
const { notify } = require("./notifications");
const { broadcast } = require("./realtime");
const REACTIONS = ["🔥", "😍", "👏", "😂", "😢", "🎉"];
const { authorView, clean, chars, blockedBetween, canMakeMusic, cleanClip } = require("./social");

const GENRES = ["Pop", "Hip-hop", "Rap", "R&B", "Electronic", "House", "Techno", "Rock", "Indie", "Folk", "Jazz", "Classical", "Chalga", "Latin", "Lo-fi", "Other"];

const cleanPeaks = (a) => (Array.isArray(a) && a.length >= 40 && a.length <= 400 ? a.map((x) => Math.max(0, Math.min(1, Math.round(Number(x) * 1000) / 1000 || 0))) : null);
function commentView(s, c, me) {
  const u = findUser(c.userId);
  return { id: c.id, text: c.text, at: c.at, author: authorView(u), createdAt: c.createdAt, canDelete: c.userId === me.id || s.userId === me.id };
}
const KINDS = { album: "Album", ep: "EP", single: "Single" };
function albumView(a, me, withSongs = false) {
  const songs = a.songIds.map((id) => db.songs.find((s) => s.id === id)).filter(Boolean);
  const out = {
    id: a.id, title: a.title, kind: a.kind, kindName: KINDS[a.kind] || "Album", cover: a.cover || songs[0]?.cover || null, year: a.year || null,
    artist: authorView(findUser(a.userId)), count: songs.length, duration: songs.reduce((n, s) => n + (s.duration || 0), 0),
    plays: songs.reduce((n, s) => n + (s.plays || 0), 0), mine: a.userId === me.id, createdAt: a.createdAt,
  };
  if (withSongs) out.songs = songs.map((s) => songView(s, me));
  return out;
}
function readAlbum(body, me, current = null) {
  const title = clean(body.title).replace(/\s+/g, " ");
  if (!title) throw httpError(400, "Give it a name.");
  if (chars(title) > 80) throw httpError(400, "Keep the name under 80 characters.");
  let cover = current ? current.cover : null;
  if (body.cover === null) cover = null;
  else if (body.cover && body.cover !== cover) {
    const ok = ownedMedia(body.cover, me.id, "image");
    if (!ok) throw httpError(400, "That cover couldn’t be found. Upload it again.");
    cover = ok.url;
  }
  const year = Number(body.year);
  return { title, kind: KINDS[body.kind] ? body.kind : current?.kind || "album", cover, year: year >= 1900 && year <= new Date().getFullYear() + 1 ? year : current?.year || new Date().getFullYear() };
}
function songView(s, me) {
  return {
    id: s.id, title: s.title, url: s.url, cover: s.cover, duration: s.duration || 0,
    artist: authorView(findUser(s.userId)), feat: s.feat || "", album: s.album || "", genre: s.genre || "",
    albumId: s.albumId || null,
    clip: s.clip || null,
    explicit: Boolean(s.explicit), lyrics: s.lyrics || "", plays: s.plays || 0, likes: s.likes.length,
    liked: s.likes.includes(me.id), mine: s.userId === me.id, createdAt: s.createdAt,
    peaks: s.peaks || null, comments: (s.comments || []).length,
    reactions: REACTIONS.map((e) => ({ emoji: e, count: Object.values(s.reactions || {}).filter((x) => x === e).length })),
    myReaction: (s.reactions || {})[me.id] || null,
  };
}
const visible = (s, me) => !blockedBetween(findUser(s.userId), me);

async function handleMusic(req, res, url, me) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  const [a, b, c] = parts;
  const m = req.method;

  // Someone's songs (most played first): GET /api/users/:username/songs
  if (m === "GET" && a === "users" && c === "songs" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user || blockedBetween(user, me)) throw httpError(404, "This account doesn’t exist.");
    const list = db.songs.filter((s) => s.userId === user.id);
    const popular = [...list].sort((x, y) => (y.plays || 0) - (x.plays || 0) || y.createdAt.localeCompare(x.createdAt));
    const listeners = new Set(list.flatMap((s) => s.listeners || [])).size;
    sendJSON(res, 200, { songs: popular.map((s) => songView(s, me)), latest: [...list].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 1).map((s) => songView(s, me))[0] || null, listeners });
    return true;
  }

  // Someone's albums and EPs: GET /api/users/:username/albums
  if (m === "GET" && a === "users" && c === "albums" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user || blockedBetween(user, me)) throw httpError(404, "This account doesn’t exist.");
    const list = db.albums.filter((x) => x.userId === user.id && (x.songIds.length || user.id === me.id)).sort((x, y) => (y.year || 0) - (x.year || 0) || y.createdAt.localeCompare(x.createdAt));
    sendJSON(res, 200, { albums: list.map((x) => albumView(x, me)) });
    return true;
  }

  /* ---------- Albums, EPs and singles ---------- */
  if (a === "albums") {
    if (m === "POST" && parts.length === 1) {
      if (!canMakeMusic(me)) throw httpError(403, "Albums are for singers, rappers and DJs / producers.");
      rateLimit("album:" + me.id, 20, 60 * 60 * 1000, "That’s a lot of albums. Try again later.");
      const data = readAlbum(await readJSON(req), me);
      const al = { id: crypto.randomUUID().slice(0, 12), userId: me.id, ...data, songIds: [], createdAt: new Date().toISOString() };
      if (al.cover) markUsed(al.cover, "album:" + al.id);
      db.albums.push(al);
      save("albums");
      sendJSON(res, 201, { album: albumView(al, me, true) });
      return true;
    }
    const al = b && db.albums.find((x) => x.id === b);
    if (!al || blockedBetween(findUser(al.userId), me)) throw httpError(404, "This album doesn’t exist anymore.");
    if (m === "GET" && parts.length === 2) { sendJSON(res, 200, { album: albumView(al, me, true) }); return true; }
    if (al.userId !== me.id) throw httpError(403, "Only the artist can change this.");
    if (m === "POST" && parts.length === 2) {
      const data = readAlbum(await readJSON(req), me, al);
      if (al.cover && al.cover !== data.cover) deleteMedia(al.cover);
      if (data.cover && data.cover !== al.cover) markUsed(data.cover, "album:" + al.id);
      Object.assign(al, data);
      for (const s of db.songs) if (al.songIds.includes(s.id)) s.album = al.title;
      save("albums"); save("songs");
      sendJSON(res, 200, { album: albumView(al, me, true) });
      return true;
    }
    if (m === "DELETE" && parts.length === 2) {
      db.albums = db.albums.filter((x) => x !== al);
      if (al.cover) deleteMedia(al.cover);
      for (const s of db.songs) if (s.albumId === al.id) { s.albumId = null; s.album = ""; }
      save("albums"); save("songs");
      sendJSON(res, 200, { ok: true });
      return true;
    }
    // The track list, in order: POST /api/albums/:id/songs { songIds }
    if (m === "POST" && c === "songs" && parts.length === 3) {
      const ids = [...new Set((await readJSON(req)).songIds || [])].filter((id) => db.songs.some((s) => s.id === id && s.userId === me.id)).slice(0, 40);
      for (const s of db.songs) {
        if (s.userId !== me.id) continue;
        if (ids.includes(s.id)) {
          const other = db.albums.find((x) => x !== al && x.songIds.includes(s.id));
          if (other) other.songIds = other.songIds.filter((x) => x !== s.id);
          s.albumId = al.id; s.album = al.title;
        } else if (s.albumId === al.id) { s.albumId = null; s.album = ""; }
      }
      al.songIds = ids;
      save("albums"); save("songs");
      sendJSON(res, 200, { album: albumView(al, me, true) });
      return true;
    }
    return false;
  }

  // The Music page: GET /api/music
  if (m === "GET" && a === "music" && parts.length === 1) {
    const all = db.songs.filter((s) => visible(s, me));
    const newest = [...all].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 20);
    const top = [...all].sort((x, y) => (y.plays || 0) - (x.plays || 0)).slice(0, 20);
    const liked = all.filter((s) => s.likes.includes(me.id)).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    const artistIds = [...new Set(top.map((s) => s.userId))].slice(0, 12);
    sendJSON(res, 200, {
      newest: newest.map((s) => songView(s, me)), top: top.map((s) => songView(s, me)), liked: liked.map((s) => songView(s, me)),
      artists: artistIds.map(findUser).filter(Boolean).map(authorView), canMake: canMakeMusic(me), genres: GENRES,
    });
    return true;
  }

  // Find songs (to send in a chat): GET /api/songs/search?q=
  if (m === "GET" && a === "songs" && b === "search" && parts.length === 2) {
    const q = clean(url.searchParams.get("q")).toLowerCase();
    const list = db.songs.filter((s) => visible(s, me) && (!q || `${s.title} ${s.album || ""} ${s.feat || ""} ${findUser(s.userId)?.name || ""} ${findUser(s.userId)?.username || ""}`.toLowerCase().includes(q)))
      .sort((x, y) => (y.plays || 0) - (x.plays || 0)).slice(0, 30);
    sendJSON(res, 200, { songs: list.map((s) => songView(s, me)) });
    return true;
  }

  if (a !== "songs") return false;

  // Upload: POST /api/songs { url, cover, title, feat, album, genre, explicit, lyrics, duration }
  if (m === "POST" && parts.length === 1) {
    if (!canMakeMusic(me)) throw httpError(403, "Songs are for singers, rappers and DJs / producers. Add one of them under “What do you do?” on your profile.");
    rateLimit("song:" + me.id, 20, 60 * 60 * 1000, "That’s a lot of songs at once. Try again later.");
    const body = await readJSON(req);
    const audio = ownedMedia(body.url, me.id, "audio");
    if (!audio) throw httpError(400, "Add the song file (MP3, M4A or OGG).");
    const title = clean(body.title).replace(/\s+/g, " ");
    if (!title) throw httpError(400, "Give the song a name.");
    if (chars(title) > 100) throw httpError(400, "Keep the name under 100 characters.");
    let cover = null;
    if (body.cover) {
      const ok = ownedMedia(body.cover, me.id, "image");
      if (!ok) throw httpError(400, "That cover couldn’t be found. Upload it again.");
      cover = ok.url;
    }
    const song = {
      id: crypto.randomUUID().slice(0, 12), userId: me.id, url: audio.url, cover, title,
      feat: clean(body.feat).slice(0, 80), album: clean(body.album).slice(0, 80),
      genre: GENRES.includes(body.genre) ? body.genre : "", explicit: Boolean(body.explicit),
      lyrics: clean(body.lyrics).slice(0, 8000), duration: Math.max(0, Math.min(3600, Number(body.duration) || 0)),
      plays: 0, listeners: [], likes: [], createdAt: new Date().toISOString(),
      peaks: cleanPeaks(body.peaks), comments: [], reactions: {},
    };
    const al = body.albumId && db.albums.find((x) => x.id === body.albumId && x.userId === me.id);
    if (al) { song.albumId = al.id; song.album = al.title; al.songIds.push(song.id); save("albums"); }
    markUsed(song.url, "song:" + song.id);
    if (cover) markUsed(cover, "song:" + song.id);
    db.songs.push(song);
    save("songs");
    for (const u of db.users) if (u.bells.includes(me.id) && u.following.includes(me.id)) notify(u.id, "song", me, { text: song.title });
    sendJSON(res, 201, { song: songView(song, me) });
    return true;
  }

  const song = b && db.songs.find((s) => s.id === b);
  if (!song || !visible(song, me)) throw httpError(404, "This song doesn’t exist anymore.");

  if (m === "GET" && parts.length === 2) { sendJSON(res, 200, { song: songView(song, me) }); return true; }
  if (m === "DELETE" && parts.length === 2) {
    if (song.userId !== me.id) throw httpError(403, "You can only delete your own songs.");
    db.songs = db.songs.filter((s) => s !== song);
    for (const x of db.albums) if (x.songIds.includes(song.id)) { x.songIds = x.songIds.filter((id) => id !== song.id); save("albums"); }
    deleteMedia(song.url);
    if (song.cover) deleteMedia(song.cover);
    save("songs");
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // A play (counted once per 30 s of the same person): POST /api/songs/:id/play
  if (m === "POST" && c === "play" && parts.length === 3) {
    song.lastPlays = song.lastPlays || {};
    const now = Date.now();
    // Every listen counts (the same person again only after 30 seconds, so it can't be spammed)
    if (!song.lastPlays[me.id] || now - song.lastPlays[me.id] > 30 * 1000) {
      song.plays = (song.plays || 0) + 1;
      const day = new Date().toISOString().slice(0, 10);
      song.playDaily = { ...(song.playDaily || {}), [day]: ((song.playDaily || {})[day] || 0) + 1 };
      if (me.following.includes(song.userId)) song.followerPlays = (song.followerPlays || 0) + 1;
      song.lastPlays[me.id] = now;
      if (!song.listeners.includes(me.id)) song.listeners.push(me.id);
      save("songs");
    }
    sendJSON(res, 200, { plays: song.plays, listeners: song.listeners.length });
    return true;
  }
  /* ---------- SoundCloud-style comments at a moment of the song ---------- */
  // GET /api/songs/:id/comments
  if (m === "GET" && c === "comments" && parts.length === 3) {
    const list = (song.comments || []).filter((x) => !blockedBetween(findUser(x.userId), me)).sort((x, y) => x.at - y.at);
    // Reactions given at a moment of the song (they pop up when the song gets there)
    const moments = (song.moments || []).filter((x) => !blockedBetween(findUser(x.userId), me)).slice(-400).map((x) => ({ emoji: x.emoji, at: x.at, by: findUser(x.userId)?.name || "" }));
    sendJSON(res, 200, { comments: list.map((x) => commentView(song, x, me)), moments });
    return true;
  }
  // POST /api/songs/:id/comments { text, at }
  if (m === "POST" && c === "comments" && parts.length === 3) {
    rateLimit("songcomment:" + me.id, 30, 10 * 60 * 1000, "Slow down a little.");
    const body = await readJSON(req);
    const text = clean(body.text).replace(/\s+/g, " ");
    if (!text) throw httpError(400, "Write something first.");
    if (chars(text) > 300) throw httpError(400, "Keep it under 300 characters.");
    const at = Math.max(0, Math.min(song.duration || 3600, Math.round((Number(body.at) || 0) * 10) / 10));
    const cm = { id: crypto.randomUUID().slice(0, 10), userId: me.id, text, at, createdAt: new Date().toISOString() };
    song.comments = song.comments || [];
    song.comments.push(cm);
    if (song.comments.length > 2000) song.comments.shift();
    save("songs");
    // Everyone listening sees it straight away
    broadcast({ type: "song:comment", songId: song.id, comment: { ...commentView(song, cm, me), canDelete: false } });
    if (song.userId !== me.id) notify(song.userId, "song-comment", me, { text: `${text} (at ${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, "0")})` });
    sendJSON(res, 201, { comment: commentView(song, cm, me) });
    return true;
  }
  // DELETE /api/songs/:id/comments/:commentId
  if (m === "DELETE" && c === "comments" && parts[3] && parts.length === 4) {
    const cm = (song.comments || []).find((x) => x.id === parts[3]);
    if (!cm) throw httpError(404, "That comment is gone.");
    if (cm.userId !== me.id && song.userId !== me.id) throw httpError(403, "You can’t delete that.");
    song.comments = song.comments.filter((x) => x !== cm);
    save("songs");
    broadcast({ type: "song:comment-deleted", songId: song.id, commentId: cm.id });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // React (one emoji each, same again removes it): POST /api/songs/:id/react { emoji, at }
  if (m === "POST" && c === "react" && parts.length === 3) {
    rateLimit("songreact:" + me.id, 60, 60 * 1000, "Easy!");
    const { emoji, at } = await readJSON(req);
    if (!REACTIONS.includes(emoji)) throw httpError(400, "Pick one of the reactions.");
    song.reactions = song.reactions || {};
    const had = song.reactions[me.id] === emoji;
    if (had) delete song.reactions[me.id]; else song.reactions[me.id] = emoji;
    if (!had) {
      song.moments = song.moments || [];
      song.moments.push({ userId: me.id, emoji, at: Math.max(0, Math.round((Number(at) || 0) * 10) / 10) });
      if (song.moments.length > 1000) song.moments.shift();
    }
    save("songs");
    const view = songView(song, me);
    // Live: the emoji floats up for everyone listening
    broadcast({ type: "song:react", songId: song.id, emoji, on: !had, by: me.name, byUsername: me.username, at: Number(at) || 0, reactions: view.reactions });
    sendJSON(res, 200, { reactions: view.reactions, myReaction: view.myReaction });
    return true;
  }
  // Waveform: POST /api/songs/:id/peaks { peaks }  (worked out in the browser the first time someone plays it)
  if (m === "POST" && c === "peaks" && parts.length === 3) {
    if (!song.peaks) {
      const peaks = cleanPeaks((await readJSON(req, 20000)).peaks);
      if (!peaks) throw httpError(400, "That waveform doesn’t look right.");
      song.peaks = peaks;
      save("songs");
    }
    sendJSON(res, 200, { ok: true });
    return true;
  }

  // Editor: timed lyrics (subtitles for a song): POST /api/songs/:id/lyrics { lyrics }
  if (m === "POST" && c === "lyrics" && parts.length === 3) {
    if (song.userId !== me.id) throw httpError(403, "Only the artist can change the lyrics.");
    song.lyrics = String((await readJSON(req, 100000)).lyrics || "").slice(0, 12000);
    save("songs");
    sendJSON(res, 200, { song: songView(song, me) });
    return true;
  }
  // Editor: trim and cut a song: POST /api/songs/:id/clip { start, end, cuts }
  if (m === "POST" && c === "clip" && parts.length === 3) {
    if (song.userId !== me.id) throw httpError(403, "Only the artist can edit the song.");
    song.clip = cleanClip(await readJSON(req), song.duration);
    save("songs");
    sendJSON(res, 200, { song: songView(song, me) });
    return true;
  }

  // Like / unlike: POST /api/songs/:id/like
  if (m === "POST" && c === "like" && parts.length === 3) {
    const had = song.likes.includes(me.id);
    song.likes = had ? song.likes.filter((id) => id !== me.id) : [...song.likes, me.id];
    save("songs");
    sendJSON(res, 200, { liked: !had, likes: song.likes.length });
    return true;
  }
  return false;
}

module.exports = { handleMusic, songView };
