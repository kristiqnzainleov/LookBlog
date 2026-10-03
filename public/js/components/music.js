// Music, Spotify style: a player bar at the bottom of every page, song lists, and uploading songs.
import { h, icon, avatar, tick, toast, modal, confirmClick, duration as fmt, spinner } from "../ui.js";
import { api, upload } from "../api.js";
import { state, emit, on } from "../state.js";
import { navigate, profileHref } from "../router.js";

/* ---------- The player bar (one for the whole site, keeps playing while you browse) ---------- */
const audio = new Audio();
audio.preload = "metadata";
// Only one thing plays at a time: a song pauses videos, and a video (with sound) pauses the song
audio.addEventListener("play", () => document.querySelectorAll("video").forEach((v) => { if (!v.paused && !v.muted) v.pause(); }));
document.addEventListener("play", (e) => {
  const v = e.target;
  if (v instanceof HTMLVideoElement && !v.muted && !audio.paused) audio.pause();
}, true);
document.addEventListener("volumechange", (e) => {
  const v = e.target;
  if (v instanceof HTMLVideoElement && !v.paused && !v.muted && !audio.paused) audio.pause();
}, true);
let queue = [], index = -1, bar = null, counted = new Set();
const current = () => queue[index] || null;
export const nowPlaying = () => current();
// For the big "Now playing" screen
export const player = {
  audio,
  current: () => current(),
  toggle: () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()),
  next: () => go(index + 1),
  prev: () => (audio.currentTime > 3 || index === 0 ? (audio.currentTime = 0) : go(index - 1)),
  seek: (sec) => { audio.currentTime = sec; if (audio.paused) audio.play().catch(() => {}); },
  update: (s) => { const c = current(); if (c && s && c.id === s.id) Object.assign(c, s); bar?.paint(); emit("music:changed"); },
};
const openBig = () => import("./music-now.js").then((m) => m.openNowPlaying());

function ico(name) {
  const P = {
    play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
    prev: '<path d="M7 6v12M18 6l-8.5 6 8.5 6z" fill="currentColor"/>',
    next: '<path d="M17 6v12M6 6l8.5 6L6 18z" fill="currentColor"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    vol: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    lyrics: '<path d="M5 6h14M5 10h14M5 14h9M5 18h6"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  };
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.innerHTML = P[name];
  return s;
}

function buildBar() {
  if (bar) return;
  const cover = h("div", { class: "mp-cover" });
  const title = h("a", { class: "mp-title" });
  const artist = h("a", { class: "mp-artist" });
  const like = h("button", { type: "button", class: "mp-btn mp-like", title: "Like", "aria-label": "Like" }, ico("heart"));
  const prev = h("button", { type: "button", class: "mp-btn", title: "Previous", "aria-label": "Previous" }, ico("prev"));
  const play = h("button", { type: "button", class: "mp-play", title: "Play", "aria-label": "Play" }, ico("play"));
  const next = h("button", { type: "button", class: "mp-btn", title: "Next", "aria-label": "Next" }, ico("next"));
  const fill = h("div", { class: "mp-fill" });
  const seek = h("div", { class: "mp-seek", role: "slider", "aria-label": "Seek" }, fill);
  const t0 = h("span", { class: "mp-time", text: "0:00" }), t1 = h("span", { class: "mp-time", text: "0:00" });
  const vol = h("input", { type: "range", class: "mp-vol", min: 0, max: 1, step: 0.05, value: 0.9, "aria-label": "Volume" });
  const lyrics = h("button", { type: "button", class: "mp-btn", title: "Lyrics", "aria-label": "Lyrics" }, ico("lyrics"));
  const close = h("button", { type: "button", class: "mp-btn", title: "Close player", "aria-label": "Close player" }, ico("close"));
  const big = h("button", { type: "button", class: "mp-btn", title: "Full screen player", "aria-label": "Full screen player" }, ico("expand"));
  big.addEventListener("click", openBig);
  cover.addEventListener("click", openBig);
  bar = h("div", { class: "music-bar", role: "region", "aria-label": "Music player" },
    h("div", { class: "mp-left" }, cover, h("div", { class: "mp-names" }, title, artist), like),
    h("div", { class: "mp-mid" }, h("div", { class: "mp-ctrls" }, prev, play, next), h("div", { class: "mp-line" }, t0, seek, t1)),
    h("div", { class: "mp-right" }, lyrics, big, ico("vol"), vol, close));
  document.body.append(bar);
  document.body.classList.add("has-music");
  audio.volume = 0.9;

  play.addEventListener("click", () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
  prev.addEventListener("click", () => (audio.currentTime > 3 || index === 0 ? (audio.currentTime = 0) : go(index - 1)));
  next.addEventListener("click", () => go(index + 1));
  vol.addEventListener("input", () => (audio.volume = Number(vol.value)));
  close.addEventListener("click", () => { audio.pause(); bar.remove(); bar = null; document.body.classList.remove("has-music"); queue = []; index = -1; emit("music:changed"); });
  lyrics.addEventListener("click", () => import("./music-now.js").then((m) => m.openNowPlaying("lyrics")));
  like.addEventListener("click", async () => {
    const s = current(); if (!s) return;
    try { const r = await api(`/api/songs/${s.id}/like`, { method: "POST" }); s.liked = r.liked; paint(); toast(r.liked ? "Added to Liked Songs." : "Removed from Liked Songs."); emit("music:changed"); } catch {}
  });
  const seekTo = (x) => { const r = seek.getBoundingClientRect(); if (audio.duration) audio.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * audio.duration; };
  seek.addEventListener("pointerdown", (e) => { seek.setPointerCapture(e.pointerId); seekTo(e.clientX); const mv = (ev) => seekTo(ev.clientX); seek.addEventListener("pointermove", mv); seek.addEventListener("pointerup", () => seek.removeEventListener("pointermove", mv), { once: true }); });

  const paintTime = () => {
    const d = audio.duration || current()?.duration || 0;
    fill.style.width = d ? (audio.currentTime / d) * 100 + "%" : "0";
    t0.textContent = fmt(audio.currentTime || 0);
    t1.textContent = fmt(d);
  };
  audio.addEventListener("timeupdate", () => {
    // Trimmed / cut in the editor: skip what the artist cut
    const cl = current()?.clip;
    if (cl) {
      const t = audio.currentTime;
      if (t < cl.start - 0.3) audio.currentTime = cl.start;
      const cut = (cl.cuts || []).find(([a, b]) => t >= a && t < b - 0.05);
      if (cut) audio.currentTime = cut[1];
      if (t >= cl.end - 0.05) { audio.pause(); audio.dispatchEvent(new Event("ended")); return; }
    }
    paintTime();
    const s = current();
    // A listen counts after 10 seconds (or half the song, if it's shorter); every listen counts again
    const need = Math.min(10, (audio.duration || s?.duration || 20) * 0.5);
    if (s && audio.currentTime >= need && !counted.has(s.id)) {
      counted.add(s.id);
      api(`/api/songs/${s.id}/play`, { method: "POST" }).then((r) => { s.plays = r.plays; emit("music:changed"); emit("song:plays", { id: s.id, plays: r.plays }); }).catch(() => {});
    }
  });
  audio.addEventListener("loadedmetadata", paintTime);
  audio.addEventListener("play", () => { play.replaceChildren(ico("pause")); emit("music:changed"); });
  audio.addEventListener("pause", () => { play.replaceChildren(ico("play")); emit("music:changed"); });
  audio.addEventListener("ended", () => { const s = current(); if (s) counted.delete(s.id); index < queue.length - 1 ? go(index + 1) : emit("music:changed"); });
  // Starting again from the top is a new listen
  audio.addEventListener("seeked", () => { const s = current(); if (s && audio.currentTime < 1) counted.delete(s.id); });

  function paint() {
    const s = current(); if (!s) return;
    cover.style.backgroundImage = s.cover ? `url("${s.cover}")` : "";
    cover.classList.toggle("empty", !s.cover);
    title.textContent = s.title; title.href = profileHref(s.artist.username) + "?tab=song";
    artist.textContent = s.artist.name + (s.feat ? ` · feat. ${s.feat}` : ""); artist.href = profileHref(s.artist.username);
    like.classList.toggle("on", Boolean(s.liked));
    paintTime();
  }
  bar.paint = paint;
}
function go(i) {
  if (i < 0 || i >= queue.length) return;
  index = i;
  counted.delete(queue[i].id);
  audio.src = queue[i].url;
  if (queue[i].clip?.start) audio.addEventListener("loadedmetadata", () => { audio.currentTime = queue[i].clip.start; }, { once: true });
  audio.play().catch(() => {});
  bar?.paint();
  emit("music:changed");
  if ("mediaSession" in navigator) {
    const s = queue[i];
    navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist.name, artwork: s.cover ? [{ src: s.cover, sizes: "512x512" }] : [] });
    navigator.mediaSession.setActionHandler("nexttrack", () => go(index + 1));
    navigator.mediaSession.setActionHandler("previoustrack", () => go(index - 1));
  }
}
// Play a list starting at one song (press the same song again to pause / resume)
export function playSongs(list, start = 0) {
  const s = list[start];
  if (current()?.id === s.id) return audio.paused ? audio.play().catch(() => {}) : audio.pause();
  buildBar();
  queue = list.slice();
  go(start);
}
export const isPlaying = (id) => current()?.id === id && !audio.paused;

function openLyrics(s) {
  modal({ title: `${s.title} · Lyrics`, body: s.lyrics ? h("p", { class: "lyrics", text: s.lyrics }) : h("p", { class: "muted", text: "No lyrics for this song yet." }) });
}

/* ---------- A numbered song list (Popular, Liked Songs …) ---------- */
export function songList(songs, { showArtist = true, onRemoved } = {}) {
  const el = h("div", { class: "song-list" });
  const rows = songs.map((s, i) => {
    const num = h("span", { class: "sl-n", text: String(i + 1) });
    const playIc = h("span", { class: "sl-play" }, ico("play"));
    const heart = h("button", { type: "button", class: "sl-like" + (s.liked ? " on" : ""), title: s.liked ? "Remove from Liked Songs" : "Save to Liked Songs", "aria-label": "Like" }, ico("heart"));
    heart.addEventListener("click", async (e) => {
      e.stopPropagation();
      try { const r = await api(`/api/songs/${s.id}/like`, { method: "POST" }); s.liked = r.liked; heart.classList.toggle("on", r.liked); emit("music:changed"); } catch {}
    });
    const del = s.mine ? h("button", { type: "button", class: "sl-del", title: "Delete song", "aria-label": "Delete song" }, icon("trash")) : null;
    if (del) confirmClick(del, "Delete?", async () => { await api(`/api/songs/${s.id}`, { method: "DELETE" }); toast("Song deleted."); row.remove(); onRemoved?.(s); });
    const row = h("div", { class: "sl-row", dataset: { id: s.id }, tabindex: "0" },
      h("div", { class: "sl-num" }, num, playIc),
      h("div", { class: "sl-cover", style: s.cover ? `background-image:url("${s.cover}")` : "" }),
      h("div", { class: "sl-text" }, h("b", { class: "sl-title", text: s.title }),
        h("span", { class: "muted" }, s.explicit ? h("span", { class: "sl-e", text: "E" }) : null, showArtist ? s.artist.name : "", s.feat ? ` feat. ${s.feat}` : "")),
      h("span", { class: "muted sl-plays", text: s.plays.toLocaleString("en-US") }),
      heart,
      h("span", { class: "muted sl-dur", text: fmt(s.duration) }),
      del);
    const start = () => playSongs(songs, i);
    row.addEventListener("click", start);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
    return row;
  });
  el.append(h("div", { class: "sl-head" }, h("span", { text: "#" }), h("span"), h("span", { text: "Title" }), h("span", { class: "sl-plays", text: "Plays" }), h("span"), h("span", { class: "sl-dur", text: "⏱" }), h("span")), ...rows);
  const paint = () => rows.forEach((r, i) => {
    r.classList.toggle("playing", isPlaying(r.dataset.id));
    const pl = r.querySelector(".sl-plays");
    if (pl) pl.textContent = songs[i].plays.toLocaleString("en-US");
  });
  paint();
  const off = on("music:changed", () => { if (!el.isConnected) return off(); paint(); });
  return el;
}

// A square card (for rows on the Music page)
export function songCard(s, list, i) {
  const btn = h("button", { type: "button", class: "sc-play", "aria-label": "Play" }, ico(isPlaying(s.id) ? "pause" : "play"));
  const card = h("div", { class: "song-card" },
    h("div", { class: "sc-cover", style: s.cover ? `background-image:url("${s.cover}")` : "" }, btn),
    h("b", { text: s.title }), h("a", { class: "muted", href: profileHref(s.artist.username), text: s.artist.name, onclick: (e) => e.stopPropagation() }));
  card.addEventListener("click", () => playSongs(list, i));
  const off = on("music:changed", () => { if (!card.isConnected) return off(); btn.replaceChildren(ico(isPlaying(s.id) ? "pause" : "play")); card.classList.toggle("playing", isPlaying(s.id)); });
  return card;
}

/* ---------- Upload a song (singers, rappers, DJs / producers) ---------- */
const GENRES = ["Pop", "Hip-hop", "Rap", "R&B", "Electronic", "House", "Techno", "Rock", "Indie", "Folk", "Jazz", "Classical", "Chalga", "Latin", "Lo-fi", "Other"];
export function openUploadSong(onDone) {
  if (!state.me.canMakeMusic) {
    const go = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Open my profile" });
    const m = modal({ title: "Upload a song", body: h("div", { class: "create-form" },
      h("p", { class: "create-hint", text: "Songs are for singers, rappers and DJs / producers. On your profile, press “What do you do?” and pick Singer, Rapper or DJ / Producer." }), go) });
    go.addEventListener("click", () => { m.close(); navigate(profileHref(state.me.username)); });
    return;
  }
  let audioUrl = null, coverUrl = null, dur = 0, busy = 0;
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const file = h("input", { type: "file", accept: "audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/webm,.mp3,.m4a,.ogg,.weba", hidden: true });
  const drop = h("button", { type: "button", class: "drop-zone" }, h("b", { text: "Choose the song" }), h("span", { text: "MP3, M4A or OGG · up to 40 MB" }));
  const fileInfo = h("p", { class: "muted song-file", hidden: true });
  const coverIn = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
  const coverBox = h("button", { type: "button", class: "song-cover-pick" }, h("span", { class: "gc-hint" }, icon("camera"), h("span", { text: "Cover art" })));
  const title = h("input", { type: "text", class: "text-input", maxlength: 100, placeholder: "Song title" });
  const feat = h("input", { type: "text", class: "text-input", maxlength: 80, placeholder: "Featuring (optional)" });
  const album = h("select", { class: "text-input" }, h("option", { value: "", text: "Not on an album" }));
  api(`/api/users/${encodeURIComponent(state.me.username)}/albums`).then(({ albums }) => albums.forEach((a) => album.append(h("option", { value: a.id, text: `${a.kindName}: ${a.title}` })))).catch(() => {});
  const genre = h("select", { class: "text-input" }, h("option", { value: "", text: "Genre" }), ...GENRES.map((g) => h("option", { value: g, text: g })));
  const explicit = h("input", { type: "checkbox" });
  const lyrics = h("textarea", { class: "text-input", rows: 4, maxlength: 8000, placeholder: "Lyrics (optional). For lyrics that follow the song exactly, start lines with the time: [00:12.50] First line" });
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-full", text: "Release song", disabled: true });
  const update = () => { submit.disabled = busy > 0 || !audioUrl || !title.value.trim(); submit.textContent = busy ? "Uploading…" : "Release song"; };
  drop.addEventListener("click", () => file.click());
  coverBox.addEventListener("click", () => coverIn.click());
  title.addEventListener("input", update);
  file.addEventListener("change", async () => {
    const f = file.files[0]; file.value = "";
    if (!f) return;
    if (!title.value) title.value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 100);
    const probe = new Audio(URL.createObjectURL(f));
    probe.addEventListener("loadedmetadata", () => { dur = probe.duration || 0; fileInfo.textContent = `${f.name} · ${fmt(dur)}`; });
    fileInfo.hidden = false; fileInfo.textContent = `${f.name} · uploading…`; drop.hidden = true;
    busy++; update();
    try { audioUrl = (await upload(f)).url; fileInfo.textContent = `✓ ${f.name}${dur ? " · " + fmt(dur) : ""}`; }
    catch (ex) { audioUrl = null; showErr(ex.error || "Upload failed."); drop.hidden = false; fileInfo.hidden = true; }
    busy--; update();
  });
  coverIn.addEventListener("change", async () => {
    const f = coverIn.files[0]; coverIn.value = "";
    if (!f) return;
    coverBox.style.backgroundImage = `url("${URL.createObjectURL(f)}")`; coverBox.classList.add("has");
    busy++; update();
    try { coverUrl = (await upload(f)).url; } catch (ex) { coverUrl = null; coverBox.style.backgroundImage = ""; coverBox.classList.remove("has"); showErr(ex.error || "Upload failed."); }
    busy--; update();
  });
  const form = h("form", { class: "create-form", novalidate: true },
    h("div", { class: "song-top" }, coverBox, h("div", { class: "song-top-main" }, drop, fileInfo, title, feat)),
    h("div", { class: "cine-row3" }, album, genre, h("label", { class: "song-explicit" }, explicit, h("span", { text: "Explicit (E)" }))),
    lyrics, err, submit, file, coverIn);
  const m = modal({ title: "Upload a song", body: form, wide: true });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    showErr(""); submit.disabled = true; submit.textContent = "Releasing…";
    try {
      const { song } = await api("/api/songs", { method: "POST", body: { url: audioUrl, cover: coverUrl, title: title.value, feat: feat.value, albumId: album.value || null, genre: genre.value, explicit: explicit.checked, lyrics: lyrics.value, duration: dur } });
      m.close();
      toast("Your song is out! 🎵");
      state.me.songs = (state.me.songs || 0) + 1;
      onDone ? onDone(song) : navigate(profileHref(state.me.username) + "?tab=song");
    } catch (ex) { showErr(ex.error || "Couldn’t release the song."); update(); }
  });
}

/* ---------- Albums, EPs and singles ---------- */
export function albumCard(al) {
  return h("a", { class: "song-card album-card", href: `/album/${al.id}` },
    h("div", { class: "sc-cover", style: al.cover ? `background-image:url("${al.cover}")` : "" }),
    h("b", { text: al.title }), h("span", { class: "muted", text: `${al.year || ""} · ${al.kindName}` }));
}
export function openAlbumForm(existing = null, onSaved) {
  let cover = existing?.cover || null, busy = false;
  const coverIn = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
  const coverBox = h("button", { type: "button", class: "song-cover-pick" + (cover ? " has" : ""), style: cover ? `background-image:url("${cover}")` : "" }, h("span", { class: "gc-hint" }, icon("camera"), h("span", { text: "Cover" })));
  coverBox.addEventListener("click", () => coverIn.click());
  coverIn.addEventListener("change", async () => {
    const f = coverIn.files[0]; coverIn.value = "";
    if (!f) return;
    coverBox.style.backgroundImage = `url("${URL.createObjectURL(f)}")`; coverBox.classList.add("has");
    busy = true;
    try { cover = (await upload(f)).url; } catch (err) { toast(err.error || "Upload failed."); }
    busy = false;
  });
  const title = h("input", { type: "text", class: "text-input", maxlength: 80, placeholder: "Name", value: existing?.title || "" });
  const kind = h("select", { class: "text-input" }, ...[["album", "Album"], ["ep", "EP"], ["single", "Single"]].map(([v, l]) => h("option", { value: v, text: l, selected: v === (existing?.kind || "album") })));
  const year = h("input", { type: "number", class: "text-input", min: 1900, max: new Date().getFullYear() + 1, value: existing?.year || new Date().getFullYear() });
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: existing ? "Save" : "Create" });
  const m = modal({ title: existing ? `Edit ${existing.kindName}` : "New album or EP", body: h("div", { class: "create-form" },
    h("div", { class: "song-top" }, coverBox, h("div", { class: "song-top-main" }, title, h("div", { class: "cine-row3" }, kind, year))), coverIn, save) });
  save.addEventListener("click", async () => {
    if (busy) return toast("Wait for the cover to finish uploading.");
    save.disabled = true;
    try {
      const { album } = await api(existing ? `/api/albums/${existing.id}` : "/api/albums", { method: "POST", body: { title: title.value, kind: kind.value, year: year.value, cover } });
      m.close();
      toast(existing ? "Saved." : `${album.kindName} created. Add songs to it.`);
      onSaved ? onSaved(album) : navigate(`/album/${album.id}`);
    } catch (err) { toast(err.error || "Couldn’t save it."); save.disabled = false; }
  });
}

// Spinner while loading lists elsewhere
export const loading = () => spinner();
export const artistLink = (a) => h("a", { href: profileHref(a.username) }, avatar(a, 28), a.name, tick(a, 13));
