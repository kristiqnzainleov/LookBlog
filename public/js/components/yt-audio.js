// YouTube songs: one small YouTube player for the whole site, with our own play / pause.
// Used by profile songs, note songs, songs sent in chats (the spinning records) and story songs.
// YouTube's rules: the player stays visible while it plays (at least 200×200), it's never hidden or shrunk,
// and it comes from youtube-nocookie.com (no YouTube cookies until you play something).
// On a story it sits on the story itself (anchor), so nothing pops up outside it.
import { h } from "../ui.js";

let api = null, player = null, box = null, now = null, ready = null, anchorEl = null;
const tell = () => dispatchEvent(new Event("lb-yt-audio"));

function loadApi() {
  if (api) return api;
  api = new Promise((ok) => {
    if (window.YT?.Player) return ok(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); ok(window.YT); };
    document.head.append(h("script", { src: "https://www.youtube.com/iframe_api" }));
  });
  return api;
}

// Where the card sits: on the element it belongs to (a story), or in the corner of the screen
function place() {
  if (!box) return;
  const a = anchorEl?.isConnected ? anchorEl.getBoundingClientRect() : null;
  box.classList.toggle("on-anchor", Boolean(a));
  if (a) { box.style.left = Math.round(a.right - box.offsetWidth - 12) + "px"; box.style.top = Math.round(a.top + 96) + "px"; box.style.bottom = "auto"; }
  else { box.style.left = box.style.top = box.style.bottom = ""; }
}
addEventListener("resize", place);

function makePlayer(id) {
  const title = h("b", { class: "yt-audio-title" });
  const close = h("button", { type: "button", class: "yt-audio-close", "aria-label": "Stop and close", text: "✕", onclick: (e) => { e.stopPropagation(); stop(); } });
  box = h("div", { class: "yt-audio-box", role: "region", "aria-label": "YouTube player" },
    h("div", { class: "yt-audio-head" }, h("span", { class: "yt-audio-logo", text: "▶" }), title, close), h("div", { id: "lb-yt-audio" }));
  // (taps on it don't reach a story underneath)
  for (const t of ["pointerdown", "pointerup", "click"]) box.addEventListener(t, (e) => e.stopPropagation());
  document.body.append(box);
  ready = loadApi().then((YT) => new Promise((ok) => {
    player = new YT.Player("lb-yt-audio", {
      width: 200, height: 200, videoId: id, host: "https://www.youtube-nocookie.com",
      playerVars: { autoplay: 1, playsinline: 1, controls: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => { ok(player); player.playVideo(); },
        onStateChange: (e) => {
          if (!now) return;
          now.playing = e.data === 1;
          if (e.data === 0) { now.playing = false; now.ended = true; }
          tell();
        },
      },
    });
  }));
  return ready;
}

// Play (or pause, if it's the one playing) a YouTube song by its video id
// (key: where it's played from — a profile, a note, one message. The same song somewhere else starts from the beginning.)
// meta.anchor: the element the player sits on (a story's frame)
export async function ytToggle(id, meta = {}, key = id) {
  if (now?.id === id && now.key === key && player?.getPlayerState) {
    const st = player.getPlayerState();
    if (st === 1 || st === 3) { player.pauseVideo(); now.playing = false; tell(); return; }
    player.playVideo(); return;
  }
  // The site's own music player stops (one thing plays at a time)
  import("./music.js").then((m) => { if (!m.player.audio.paused) m.player.audio.pause(); }).catch(() => {});
  now = { id, key, playing: false, ...meta };
  anchorEl = meta.anchor || null;
  tell();
  const first = !player ? makePlayer(id) : null;
  // (shown before it starts: it never plays out of sight)
  box.querySelector(".yt-audio-title").textContent = [meta.title, meta.artist].filter(Boolean).join(" · ") || "YouTube";
  box.classList.add("show");
  place();
  if (first) await first;
  else { await ready; player.loadVideoById({ videoId: id, startSeconds: 0 }); }
}
export function stop() {
  try { player?.stopVideo(); } catch {}
  box?.classList.remove("show", "on-anchor");
  anchorEl = null;
  if (now) now.playing = false;
  tell();
}
// Opening a video closes the little YouTube window: when a video on LookBlog starts with sound (or gets its
// sound turned on), the song stops and its window goes away. Not for story videos (a story's song goes with it)
// or muted previews in the feed.
function videoWithSound(e) {
  const v = e.target;
  if (!(v instanceof HTMLVideoElement) || v.paused || v.muted || v.volume === 0) return;
  if (!box?.classList.contains("show") || v.closest(".story-viewer, .yt-audio-box")) return;
  stop();
}
document.addEventListener("play", videoWithSound, true);
document.addEventListener("volumechange", videoWithSound, true);
export const ytNow = () => now;
export const ytIsPlaying = (id, key = id) => Boolean(now && now.id === id && now.key === key && now.playing);
export function ytProgress() {
  try { return player && now ? { pos: player.getCurrentTime() || 0, dur: player.getDuration() || 0 } : { pos: 0, dur: 0 }; } catch { return { pos: 0, dur: 0 }; }
}
// The site's music starting stops YouTube
addEventListener("play", (e) => { if (e.target instanceof HTMLMediaElement && now?.playing && !e.target.dataset.voiceMusic) stop(); }, true);

// Play / pause any song: LookBlog / MP3 in the site's player, YouTube as sound only
// key: the place it's played from (a profile, a note, a message) — each has its own playback
export function playAny(song, key = "") {
  if (song.kind === "youtube") return ytToggle(song.yt, { title: song.title, artist: song.artist?.name, cover: song.cover }, key || song.yt);
  stop();
  return import("./music.js").then((m) => m.playSongs([{ ...song, instance: key }], 0));
}
export async function isPlayingAny(song, key = "") {
  if (song.kind === "youtube") return ytIsPlaying(song.yt, key || song.yt);
  const m = await import("./music.js");
  return m.isPlaying(song.id, key);
}

// A song as a vinyl record (like Instagram's music in DMs): the cover is the label, it spins while it plays
export function vinylCard(song, { kindLabel = "🎵 Song", key = "" } = {}) {
  const disc = h("div", { class: "vinyl-disc" }, h("div", { class: "vinyl-label", style: song.cover ? `background-image:url("${song.cover}")` : "" }), h("i", { class: "vinyl-hole" }));
  const btn = h("button", { type: "button", class: "vinyl-play", "aria-label": "Play" }, h("span", { class: "vp-ic", text: "▶" }));
  const bar = h("div", { class: "vinyl-bar" }, h("i"));
  const card = h("div", { class: "vinyl-card", dataset: { song: song.kind === "youtube" ? "yt-" + song.yt : song.id } },
    h("div", { class: "vinyl-stage" }, disc, h("i", { class: "vinyl-arm", "aria-hidden": "true" }), btn),
    h("div", { class: "vinyl-text" },
      h("span", { class: "vinyl-kind", text: song.kind === "youtube" ? "▶️ YouTube" : kindLabel }),
      h("b", { text: song.title || "A song" }),
      h("span", { class: "muted", text: song.artist?.name || "" }),
      bar));
  let mounted = false;
  const paint = async () => {
    if (!card.isConnected) { if (mounted) off(); return; }
    mounted = true;
    const on = await isPlayingAny(song, key);
    card.classList.toggle("playing", on);
    btn.querySelector(".vp-ic").textContent = on ? "❚❚" : "▶";
  };
  const go = (e) => { e.stopPropagation(); playAny(song, key); setTimeout(paint, 300); };
  btn.addEventListener("click", go);
  disc.addEventListener("click", go);
  const tick = setInterval(async () => {
    if (!card.isConnected) { if (mounted) off(); return; }
    if (!card.classList.contains("playing")) return;
    let p = { pos: 0, dur: 0 };
    if (song.kind === "youtube") p = ytIsPlaying(song.yt, key || song.yt) ? ytProgress() : { pos: 0, dur: 0 };
    else { const m = await import("./music.js"); p = { pos: m.player.audio.currentTime, dur: m.player.audio.duration || 0 }; }
    bar.firstChild.style.width = p.dur ? Math.min(100, (p.pos / p.dur) * 100) + "%" : "0%";
  }, 500);
  addEventListener("lb-yt-audio", paint);
  let offMusic = null;
  import("../state.js").then((st) => { offMusic = st.on("music:changed", paint); });
  function off() { clearInterval(tick); removeEventListener("lb-yt-audio", paint); offMusic?.(); }
  requestAnimationFrame(paint);
  return card;
}
