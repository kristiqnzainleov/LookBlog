// /leaderboard — most followed, most watched, most liked, top artists, and this week's top songs and videos.
import { h, avatar, tick, empty, spinner, icon } from "../ui.js";
import { api } from "../api.js";
import { profileHref } from "../router.js";
import { playSongs } from "../components/music.js";

const BOARDS = [
  ["followers", "👥 Followers", "People with the most followers"],
  ["views", "▶ Video views", "Most views on their videos and shorts"],
  ["likes", "❤️ Likes", "Most likes and Cools on their posts"],
  ["artists", "🎤 Artists", "Most plays on their songs"],
  ["songs-week", "🎧 Songs this week", "The most played songs in the last 7 days"],
  ["trending-videos", "🔥 Trending videos", "Videos and shorts trending this week: hypes, likes, replies, reposts and views (newer counts more)"],
  ["videos-week", "▶ Videos this week", "The most watched videos and shorts in the last 7 days"],
  ["streams", "🔴 Streams", "Top streamers: viewers + likes on their lives (a like counts twice)"],
  ["streams-liked", "❤️ Most liked lives", "Streamers with the most likes on their lives and recordings"],
  ["series", "📺 Series", "The most watched series (all episodes together)"],
  ["films", "🎬 Movies", "The most watched movies"],
];
const medal = (r) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : String(r));

export function leaderboardPage(view, _m, params) {
  document.title = "Leaderboard / LookBlog";
  view.classList.add("page-leaderboard");
  let board = BOARDS.some(([k]) => k === params.get("board")) ? params.get("board") : "followers";
  const tabs = h("div", { class: "lb-tabs" });
  const sub = h("p", { class: "page-sub" });
  const list = h("div", { class: "lb-list" });
  view.append(h("header", { class: "column-head" }, h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "Leaderboard" }), sub)), tabs), list);
  const paintTabs = () => tabs.replaceChildren(...BOARDS.map(([k, l]) => h("button", { class: "lb-tab" + (k === board ? " on" : ""), text: l, onclick: () => { board = k; history.replaceState(null, "", `/leaderboard?board=${k}`); paintTabs(); load(); } })));
  async function load() {
    sub.textContent = BOARDS.find(([k]) => k === board)[2];
    list.replaceChildren(spinner());
    let d;
    try { d = await api(`/api/leaderboard?board=${board}`); } catch (err) { list.replaceChildren(empty("Couldn’t load the leaderboard.", err.error || "")); return; }
    if (!d.list.length) return list.replaceChildren(empty("Nobody here yet.", "Be the first!"));
    const songs = d.list.filter((x) => x.song).map((x) => x.song);
    list.replaceChildren(...d.list.map((x, i) => {
      const rank = h("span", { class: "lb-rank" + (x.rank <= 3 ? " top" : ""), text: medal(x.rank) });
      const value = h("span", { class: "lb-value" }, h("b", { text: x.value.toLocaleString("en-US") }), h("small", { class: "muted", text: x.unit }));
      if (x.user) return h("a", { class: "lb-row" + (x.user.isMe ? " me" : ""), href: profileHref(x.user.username) + (board === "artists" ? "?tab=song" : board.startsWith("streams") ? "?tab=stream" : "") }, rank, avatar(x.user, 44),
        h("span", { class: "lb-who" }, h("b", {}, x.user.name, tick(x.user, 14), x.user.isMe ? h("span", { class: "lb-you", text: "You" }) : null), h("small", { class: "muted", text: "@" + x.user.username + (x.listeners != null ? ` · ${x.listeners} listeners` : "") + (x.streams != null ? ` · ❤️ ${x.likes} · 👁 ${x.viewers} viewers · ${x.streams} stream${x.streams === 1 ? "" : "s"} · peak ${x.peak}` : "") })), value);
      if (x.song) {
        const play = h("button", { class: "lb-play", "aria-label": "Play" }, icon("play"));
        play.addEventListener("click", (e) => { e.preventDefault(); playSongs(songs, songs.indexOf(x.song)); });
        return h("div", { class: "lb-row" }, rank, h("span", { class: "lb-cover", style: x.song.cover ? `background-image:url("${x.song.cover}")` : "" }, play),
          h("span", { class: "lb-who" }, h("b", { text: x.song.title }), h("a", { class: "muted", href: profileHref(x.song.artist.username) + "?tab=song", text: x.song.artist.name })), value);
      }
      if (x.series) {
        const s = x.series;
        return h("a", { class: "lb-row", href: `/playlist/${s.id}` }, rank,
          h("span", { class: "lb-thumb", style: s.cover ? `background-image:url("${s.cover}")` : "" }),
          h("span", { class: "lb-who" }, h("b", { text: s.title }), h("small", { class: "muted", text: [s.author.name, s.year, s.genre, `${s.episodes} episode${s.episodes === 1 ? "" : "s"}`, `${s.viewers} viewers`].filter(Boolean).join(" · ") })), value);
      }
      const p = x.post;
      return h("a", { class: "lb-row", href: p.type === "short" ? `/shorts?id=${p.id}` : `/watch/${p.id}` }, rank,
        h("span", { class: "lb-thumb" + (p.type === "short" ? " tall" : ""), style: p.media[0]?.poster ? `background-image:url("${p.media[0].poster}")` : "" }),
        h("span", { class: "lb-who" }, h("b", { text: p.title || p.text?.slice(0, 60) || (p.type === "short" ? "Short" : "Video") }), h("small", { class: "muted", text: x.film ? [p.author.name, p.film?.year, p.film?.genre, p.film?.rating].filter(Boolean).join(" · ") : x.trend ? [p.author.name, p.type === "short" ? "Short" : "Video", `🔥 ${x.trend.hypes}`, `❤️ ${x.trend.likes}`, `👁 ${x.trend.views}`].join(" · ") : p.author.name })), value);
    }));
  }
  paintTabs();
  // (on a phone the tabs scroll sideways: show the chosen one)
  requestAnimationFrame(() => tabs.querySelector(".lb-tab.on")?.scrollIntoView({ inline: "center", block: "nearest" }));
  load();
}
leaderboardPage.navName = () => "";
leaderboardPage.layout = "wide";
