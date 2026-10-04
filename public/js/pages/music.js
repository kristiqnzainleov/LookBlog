// /music — songs from people on LookBlog, Spotify style.
import { h, icon, avatar, empty, spinner, tick } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { profileHref } from "../router.js";
import { songList, songCard, playSongs, openUploadSong } from "../components/music.js";
import { videoTabs } from "./videos.js";

export function musicPage(view) {
  document.title = "Music / LookBlog";
  view.classList.add("page-music");
  const box = h("div", {}, spinner());
  view.append(h("header", { class: "column-head no-title" }, videoTabs("music")), box);
  async function load() {
    try {
      const d = await api("/api/music");
      const hour = new Date().getHours();
      const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      const up = d.canMake ? h("button", { class: "btn btn-sm btn-primary", onclick: () => openUploadSong(() => load()) }, icon("plus"), h("span", { text: "Upload song" })) : null;
      const row = (title, list) => list.length ? h("section", { class: "mu-row" }, h("h2", { text: title }), h("div", { class: "mu-scroll" }, ...list.map((s, i) => songCard(s, list, i)))) : null;
      const liked = d.liked.length ? h("section", { class: "mu-liked" },
        h("div", { class: "mu-liked-head" },
          h("div", { class: "mu-liked-art", text: "♥" }),
          h("div", {}, h("p", { class: "mu-kicker", text: "Playlist" }), h("h2", { text: "Liked Songs" }), h("p", { class: "muted", text: `${d.liked.length} song${d.liked.length === 1 ? "" : "s"}` })),
          h("button", { class: "mu-big-play", "aria-label": "Play Liked Songs", onclick: () => playSongs(d.liked, 0) }, icon("play"))),
        songList(d.liked)) : null;
      box.replaceChildren(
        h("header", { class: "mu-head" }, h("div", {}, h("h1", { text: hello }), h("p", { class: "page-sub", text: "Music made by people on LookBlog." })), up),
        d.artists.length ? h("section", { class: "mu-row" }, h("h2", { text: "Artists" }), h("div", { class: "mu-artists" }, ...d.artists.map((a) => h("a", { class: "mu-artist", href: profileHref(a.username) + "?tab=song" }, avatar(a, 120), h("b", {}, a.name, tick(a, 14)), h("span", { class: "muted", text: "Artist" }))))) : null,
        row("New releases", d.newest),
        row("Top songs", d.top),
        liked,
        !d.newest.length ? empty("No songs yet.", d.canMake ? "Be the first: upload a song." : "Singers, rappers and DJs / producers can upload songs here.") : null);
    } catch (err) { box.replaceChildren(empty("Couldn’t load music.", err.error || "")); }
  }
  load();
  const off = on("music:changed", () => {});
  return () => off();
}
musicPage.navName = () => "videos";
musicPage.layout = "wide";
