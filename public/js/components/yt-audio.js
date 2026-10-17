// YouTube songs as sound only (no video on the screen): one small hidden YouTube player for the whole site,
// with our own play / pause. Used by profile songs, note songs and songs sent in chats (the spinning records).
// If a phone refuses to start it from the hidden player, a small player shows so it can be tapped.
import { h } from "../ui.js";

let api = null, player = null, box = null, now = null, ready = null, failTimer = 0;
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

function makePlayer(id) {
  box = h("div", { class: "yt-audio-box", "aria-hidden": "true" }, h("div", { id: "lb-yt-audio" }));
  const close = h("button", { type: "button", class: "yt-audio-close", "aria-label": "Close", text: "✕", onclick: () => { stop(); } });
  box.append(close);
  document.body.append(box);
  ready = loadApi().then((YT) => new Promise((ok) => {
    player = new YT.Player("lb-yt-audio", {
      width: 200, height: 113, videoId: id,
      playerVars: { autoplay: 1, playsinline: 1, controls: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => { ok(player); player.playVideo(); },
        onStateChange: (e) => {
          if (!now) return;
          now.playing = e.data === 1;
          if (e.data === 1) { clearTimeout(failTimer); box.classList.remove("show"); }
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
export async function ytToggle(id, meta = {}, key = id) {
  if (now?.id === id && now.key === key && player?.getPlayerState) {
    const st = player.getPlayerState();
    if (st === 1 || st === 3) { player.pauseVideo(); now.playing = false; tell(); return; }
    player.playVideo(); return;
  }
  // The site's own music player stops (one thing plays at a time)
  import("./music.js").then((m) => { if (!m.player.audio.paused) m.player.audio.pause(); }).catch(() => {});
  now = { id, key, playing: false, ...meta };
  tell();
  // A phone that won't start it without a tap on the player itself: show the small player to tap
  // (not for a story's song: the story shows its own "tap for sound" button instead, nothing pops up outside it)
  clearTimeout(failTimer);
  box?.classList.remove("show");
  if (!meta.quiet) failTimer = setTimeout(() => { if (now?.id === id && !now.playing) box?.classList.add("show"); }, 3500);
  if (!player) await makePlayer(id);
  else { await ready; player.loadVideoById({ videoId: id, startSeconds: 0 }); }
}
export function stop() {
  try { player?.stopVideo(); } catch {}
  box?.classList.remove("show");
  if (now) now.playing = false;
  tell();
}
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
