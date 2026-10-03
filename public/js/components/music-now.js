// "Now playing": the big music screen.
//   - a waveform you can click to jump, with listeners' comments pinned to moments (SoundCloud style)
//   - comments pop up live as the song reaches them, and new ones arrive in real time
//   - lyrics that follow the song (Spotify style); "[01:23.40] line" times make them exact
//   - reactions (🔥 😍 👏 😂 😢 🎉) that float up for everyone listening
import { h, avatar, tick, toast, fmtTime } from "../ui.js";
import { api } from "../api.js";
import { on, emit, state } from "../state.js";
import { profileHref, navigate } from "../router.js";
import { player } from "./music.js";

let screen = null;

function ico(name) {
  const P = {
    play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
    prev: '<path d="M7 6v12M18 6l-8.5 6 8.5 6z" fill="currentColor"/>',
    next: '<path d="M17 6v12M6 6l8.5 6L6 18z" fill="currentColor"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
  };
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.innerHTML = P[name];
  return s;
}

/* Lyrics: "[mm:ss.xx] text" lines are timed exactly; plain lines are spread over the song */
function parseLyrics(text, duration) {
  const lines = String(text || "").split(/\r?\n/);
  const timed = [];
  for (const l of lines) {
    const tags = [...l.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const words = l.replace(/\[[^\]]*\]/g, "").trim();
    for (const t of tags) timed.push({ at: Number(t[1]) * 60 + Number(t[2]) + (t[3] ? Number("0." + t[3]) : 0), text: words });
  }
  if (timed.length) return { exact: true, lines: timed.sort((a, b) => a.at - b.at) };
  const plain = lines.map((l) => l.trim());
  const sung = plain.filter(Boolean).length || 1;
  const step = (duration || sung * 4) / (sung + 1);
  let k = 0;
  return { exact: false, lines: plain.map((t) => ({ at: t ? step * ++k : null, text: t })) };
}

// The waveform: worked out from the audio the first time (then saved for everyone)
async function getPeaks(song) {
  if (song.peaks) return song.peaks;
  try {
    const buf = await (await fetch(song.url)).arrayBuffer();
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0), N = 160, size = Math.floor(data.length / N) || 1;
    const peaks = [];
    for (let i = 0; i < N; i++) {
      let max = 0;
      for (let j = i * size; j < (i + 1) * size && j < data.length; j += 16) max = Math.max(max, Math.abs(data[j]));
      peaks.push(max);
    }
    const top = Math.max(...peaks) || 1;
    song.peaks = peaks.map((p) => Math.round((p / top) * 1000) / 1000);
    api(`/api/songs/${song.id}/peaks`, { method: "POST", body: { peaks: song.peaks } }).catch(() => {});
    return song.peaks;
  } catch { return Array.from({ length: 160 }, (_, i) => 0.35 + 0.3 * Math.abs(Math.sin(i / 5))); }
}

export function openNowPlaying(tab = "comments") {
  if (screen) { screen.setTab?.(tab); return; }
  const song0 = player.current();
  if (!song0) return;
  const audio = player.audio;
  let song = song0, comments = [], moments = [], lyrics = null, peaks = null, shownPops = new Set(), shownMoments = new Set();

  const bg = h("div", { class: "np-bg" });
  const cover = h("div", { class: "np-cover" });
  const title = h("h1", { class: "np-title" });
  const artist = h("a", { class: "np-artist" });
  const like = h("button", { class: "np-like", "aria-label": "Like" }, ico("heart"));
  const plays = h("p", { class: "np-plays" });
  const reacts = h("div", { class: "np-reacts" });
  const canvas = h("canvas", { class: "np-wave" });
  const marks = h("div", { class: "np-marks" });
  const popLayer = h("div", { class: "np-pops" });
  const floatLayer = h("div", { class: "np-floats" });
  const wave = h("div", { class: "np-wave-wrap" }, canvas, marks, popLayer);
  const t0 = h("span", { class: "np-time" }), t1 = h("span", { class: "np-time" });
  const playBtn = h("button", { class: "np-play", "aria-label": "Play" }, ico("pause"));
  const prev = h("button", { class: "np-btn", "aria-label": "Previous" }, ico("prev"));
  const next = h("button", { class: "np-btn", "aria-label": "Next" }, ico("next"));
  const close = h("button", { class: "np-close", "aria-label": "Close", title: "Back to the small player" }, ico("down"));
  const tabBtns = h("div", { class: "np-tabs" });
  const panel = h("div", { class: "np-panel" });
  const input = h("input", { type: "text", class: "np-input", maxlength: 300, placeholder: "Write a comment at 0:00…" });
  const send = h("button", { class: "btn btn-primary btn-sm", text: "Post" });
  const composer = h("form", { class: "np-compose" }, avatar(state.me, 32), input, send);

  screen = h("div", { class: "now-playing", role: "dialog", "aria-label": "Now playing" },
    bg, floatLayer,
    h("div", { class: "np-top" }, close, h("span", { class: "np-kicker", text: "Now playing" }), h("span")),
    h("div", { class: "np-main" },
      h("div", { class: "np-left" }, cover,
        h("div", { class: "np-meta" }, h("div", { class: "np-names" }, title, artist, plays), like),
        reacts,
        wave, h("div", { class: "np-times" }, t0, t1),
        h("div", { class: "np-ctrls" }, prev, playBtn, next)),
      h("div", { class: "np-right" }, tabBtns, panel, composer)));
  document.body.append(screen);
  document.body.classList.add("no-scroll");
  requestAnimationFrame(() => screen.classList.add("open"));

  let tabNow = tab;
  const setTab = (t) => { tabNow = t; paintTabs(); paintPanel(); };
  screen.setTab = setTab;
  function paintTabs() {
    tabBtns.replaceChildren(...[["comments", `Comments${comments.length ? " · " + comments.length : ""}`], ["lyrics", "Lyrics"]].map(([k, l]) => {
      const b = h("button", { class: "np-tab" + (k === tabNow ? " on" : ""), text: l });
      b.addEventListener("click", () => setTab(k));
      return b;
    }));
    composer.hidden = tabNow !== "comments";
  }

  /* ---------- One song's details ---------- */
  async function load() {
    song = player.current();
    if (!song) return shut();
    shownPops = new Set();
    bg.style.backgroundImage = song.cover ? `url("${song.cover}")` : "";
    cover.style.backgroundImage = song.cover ? `url("${song.cover}")` : "";
    title.textContent = song.title;
    artist.textContent = song.artist.name + (song.feat ? ` · feat. ${song.feat}` : "");
    artist.href = profileHref(song.artist.username) + "?tab=song";
    artist.onclick = (e) => { e.preventDefault(); shut(); navigate(artist.getAttribute("href")); };
    paintLike();
    paintReacts();
    paintPlays();
    shownMoments = new Set();
    lyrics = parseLyrics(song.lyrics, song.duration || audio.duration);
    comments = [];
    paintTabs(); paintPanel(); drawMarks();
    try { const d = await api(`/api/songs/${song.id}/comments`); comments = d.comments; moments = d.moments || []; } catch {}
    paintTabs(); paintPanel(); drawMarks();
    peaks = await getPeaks(song);
    draw();
  }
  function paintPlays() { plays.textContent = `${(song.plays || 0).toLocaleString("en-US")} play${song.plays === 1 ? "" : "s"}`; }
  function paintLike() { like.classList.toggle("on", Boolean(song.liked)); like.title = song.liked ? "Remove from Liked Songs" : "Save to Liked Songs"; }
  like.addEventListener("click", async () => {
    try { const r = await api(`/api/songs/${song.id}/like`, { method: "POST" }); song.liked = r.liked; player.update(song); paintLike(); toast(r.liked ? "Added to Liked Songs." : "Removed from Liked Songs."); } catch {}
  });
  function paintReacts() {
    reacts.replaceChildren(...(song.reactions || []).map((r) => {
      const b = h("button", { class: "np-react" + (song.myReaction === r.emoji ? " on" : ""), title: "React" }, h("span", { text: r.emoji }), r.count ? h("small", { text: String(r.count) }) : null);
      b.addEventListener("click", async () => {
        try { const x = await api(`/api/songs/${song.id}/react`, { method: "POST", body: { emoji: r.emoji, at: audio.currentTime } }); song.reactions = x.reactions; song.myReaction = x.myReaction; paintReacts(); }
        catch (err) { toast(err.error || "Couldn’t react."); }
      });
      return b;
    }));
  }

  /* ---------- Waveform ---------- */
  const dur = () => audio.duration || song.duration || 1;
  function draw() {
    const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (!r.width) return;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    const c = canvas.getContext("2d");
    c.scale(dpr, dpr);
    const list = peaks || [], n = list.length || 1, bw = r.width / n, prog = audio.currentTime / dur();
    for (let i = 0; i < list.length; i++) {
      const hgt = Math.max(2, list[i] * r.height * 0.95);
      c.fillStyle = i / n < prog ? "#ff4fa3" : "rgba(255,255,255,0.35)";
      c.fillRect(i * bw + 0.5, (r.height - hgt) / 2, Math.max(1, bw - 1.5), hgt);
    }
  }
  function drawMarks() {
    marks.replaceChildren(...comments.map((cm) => {
      const m = h("button", { class: "np-mark", style: `left:${(cm.at / dur()) * 100}%`, title: `${cm.author.name} at ${fmtTime(cm.at)}: ${cm.text}` }, avatar(cm.author, 18));
      m.addEventListener("click", (e) => { e.stopPropagation(); player.seek(cm.at); });
      return m;
    }));
  }
  wave.addEventListener("click", (e) => {
    const r = wave.getBoundingClientRect();
    player.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur());
  });

  /* ---------- Comments and lyrics ---------- */
  function paintPanel() {
    if (tabNow === "lyrics") {
      if (!lyrics?.lines.some((l) => l.text)) { panel.replaceChildren(h("p", { class: "np-empty", text: "No lyrics for this song yet." })); return; }
      panel.replaceChildren(h("div", { class: "np-lyrics" + (lyrics.exact ? "" : " rough") }, ...lyrics.lines.map((l, i) => {
        const el = h("p", { class: "np-line" + (l.text ? "" : " gap"), dataset: { i }, text: l.text || "♪" });
        if (l.at != null) el.addEventListener("click", () => player.seek(l.at));
        return el;
      })), lyrics.exact ? null : h("p", { class: "np-note", text: "Lyrics move along with the song. Artists can make them exact by adding times like [01:23.40]." }));
      return syncLyrics(true);
    }
    if (!comments.length) { panel.replaceChildren(h("p", { class: "np-empty", text: "No comments yet. Be the first — your comment will sit at the moment you post it." })); return; }
    panel.replaceChildren(h("div", { class: "np-comments" }, ...comments.slice().sort((a, b) => a.at - b.at).map(commentRow)));
  }
  function commentRow(cm) {
    const at = h("button", { class: "np-at", text: fmtTime(cm.at), title: "Play from here" });
    at.addEventListener("click", () => player.seek(cm.at));
    const del = cm.canDelete ? h("button", { class: "np-del", text: "Delete" }) : null;
    del?.addEventListener("click", async () => { try { await api(`/api/songs/${song.id}/comments/${cm.id}`, { method: "DELETE" }); } catch (err) { toast(err.error || "Couldn’t delete it."); } });
    return h("div", { class: "np-comment", dataset: { id: cm.id } }, avatar(cm.author, 32),
      h("div", { class: "np-c-main" }, h("div", { class: "np-c-top" }, h("b", {}, cm.author.name, tick(cm.author, 12)), h("span", { class: "muted", text: "at " }), at), h("p", { text: cm.text })), del);
  }
  let lastLine = -1;
  function syncLyrics(force) {
    if (tabNow !== "lyrics" || !lyrics) return;
    const t = audio.currentTime;
    let cur = -1;
    lyrics.lines.forEach((l, i) => { if (l.at != null && l.at <= t + 0.15) cur = i; });
    if (cur === lastLine && !force) return;
    lastLine = cur;
    panel.querySelectorAll(".np-line").forEach((el) => {
      const i = Number(el.dataset.i);
      el.classList.toggle("now", i === cur);
      el.classList.toggle("past", i < cur);
    });
    panel.querySelector(".np-line.now")?.scrollIntoView({ block: "center", behavior: force ? "auto" : "smooth" });
  }
  // As the song reaches a comment, it pops up over the waveform (SoundCloud style)
  function popComments() {
    const t = audio.currentTime;
    for (const cm of comments) {
      if (shownPops.has(cm.id) || cm.at > t || cm.at < t - 1.2) continue;
      shownPops.add(cm.id);
      const pop = h("div", { class: "np-pop", style: `left:${Math.min(88, (cm.at / dur()) * 100)}%` }, avatar(cm.author, 22), h("span", {}, h("b", { text: cm.author.name + " " }), cm.text));
      popLayer.append(pop);
      setTimeout(() => pop.classList.add("out"), 3200);
      setTimeout(() => pop.remove(), 3700);
    }
  }
  // Reactions people gave at a moment float up when the song gets there
  function popMoments() {
    const t = audio.currentTime;
    moments.forEach((mo, i) => {
      if (shownMoments.has(i) || mo.at > t || mo.at < t - 1.2) return;
      shownMoments.add(i);
      floatEmoji(mo.emoji, mo.by);
    });
  }
  function floatEmoji(emoji, by) {
    const f = h("div", { class: "np-float", style: `left:${10 + Math.random() * 80}%` }, h("span", { text: emoji }), by ? h("small", { text: by }) : null);
    floatLayer.append(f);
    setTimeout(() => f.remove(), 2600);
  }

  composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    try {
      const { comment } = await api(`/api/songs/${song.id}/comments`, { method: "POST", body: { text, at: audio.currentTime } });
      input.value = "";
      if (!comments.some((c) => c.id === comment.id)) comments.push(comment);
      shownPops.add(comment.id);
      paintTabs(); paintPanel(); drawMarks();
    } catch (err) { toast(err.error || "Couldn’t post it."); }
    send.disabled = false;
  });

  /* ---------- Playback ---------- */
  playBtn.addEventListener("click", () => player.toggle());
  prev.addEventListener("click", () => player.prev());
  next.addEventListener("click", () => player.next());
  // Going back before a comment or reaction lets it pop up again
  audio.addEventListener("seeked", () => {
    const t = audio.currentTime;
    for (const cm of comments) if (cm.at > t) shownPops.delete(cm.id);
    moments.forEach((mo, i) => { if (mo.at > t) shownMoments.delete(i); });
  });
  const tick_ = () => {
    t0.textContent = fmtTime(audio.currentTime);
    t1.textContent = fmtTime(dur());
    input.placeholder = `Write a comment at ${fmtTime(audio.currentTime)}…`;
    draw(); syncLyrics(false); popComments(); popMoments();
  };
  const paintPlay = () => playBtn.replaceChildren(ico(audio.paused ? "play" : "pause"));
  audio.addEventListener("timeupdate", tick_);
  audio.addEventListener("play", paintPlay);
  audio.addEventListener("pause", paintPlay);
  const onResize = () => { draw(); drawMarks(); };
  addEventListener("resize", onResize);

  /* ---------- Live from other listeners ---------- */
  let lastId = song.id;
  const offs = [
    on("music:changed", () => { const c = player.current(); if (!c) return shut(); if (c.id !== lastId) { lastId = c.id; load(); } paintPlay(); paintPlays(); }),
    on("song:comment", (ev) => {
      if (ev.songId !== song.id || comments.some((c) => c.id === ev.comment.id)) return;
      comments.push(ev.comment);
      paintTabs(); if (tabNow === "comments") paintPanel(); drawMarks();
      if (ev.comment.author.username !== state.me.username) toast(`💬 ${ev.comment.author.name} at ${fmtTime(ev.comment.at)}: ${ev.comment.text}`);
    }),
    on("song:comment-deleted", (ev) => {
      if (ev.songId !== song.id) return;
      comments = comments.filter((c) => c.id !== ev.commentId);
      paintTabs(); if (tabNow === "comments") paintPanel(); drawMarks();
    }),
    on("song:react", (ev) => {
      if (ev.songId !== song.id) return;
      song.reactions = ev.reactions;
      paintReacts();
      if (ev.on) {
        moments.push({ emoji: ev.emoji, at: ev.at, by: ev.by });
        shownMoments.add(moments.length - 1);
        floatEmoji(ev.emoji, ev.by);
      }
    }),
  ];

  function shut() {
    if (!screen) return;
    const s = screen;
    screen = null;
    s.classList.remove("open");
    document.body.classList.remove("no-scroll");
    audio.removeEventListener("timeupdate", tick_);
    audio.removeEventListener("play", paintPlay);
    audio.removeEventListener("pause", paintPlay);
    removeEventListener("resize", onResize);
    removeEventListener("keydown", onKey);
    offs.forEach((f) => f());
    setTimeout(() => s.remove(), 300);
  }
  const onKey = (e) => {
    if (e.key === "Escape") shut();
    else if (e.key === " " && document.activeElement !== input) { e.preventDefault(); player.toggle(); }
  };
  addEventListener("keydown", onKey);
  close.addEventListener("click", shut);
  paintPlay();
  load();
  setTimeout(onResize, 350);
  void emit;
}
