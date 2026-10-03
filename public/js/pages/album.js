// /album/:id — an album, EP or single, Spotify style.
import { h, icon, empty, spinner, toast, confirmClick, tick, duration as fmt, modal } from "../ui.js";
import { api } from "../api.js";
import { navigate, profileHref } from "../router.js";
import { songList, playSongs, openAlbumForm } from "../components/music.js";

export function albumPage(view, m) {
  const id = m[1];
  view.classList.add("page-album");
  const box = h("div", {}, spinner());
  view.append(box);
  async function load() {
    let al;
    try { al = (await api(`/api/albums/${encodeURIComponent(id)}`)).album; } catch (err) { box.replaceChildren(empty("This album doesn’t exist anymore.", err.error || "")); return; }
    document.title = `${al.title} / LookBlog`;
    const mins = Math.round(al.duration / 60);
    const tools = h("div", { class: "al-tools" },
      h("button", { class: "mu-big-play", "aria-label": "Play", onclick: () => al.songs.length && playSongs(al.songs, 0) }, icon("play")));
    if (al.mine) {
      tools.append(
        h("button", { class: "btn btn-sm btn-outline-light", onclick: () => pickSongs(al) }, icon("plus"), h("span", { text: "Songs" })),
        h("button", { class: "btn btn-sm btn-outline-light", onclick: () => openAlbumForm(al, () => load()) }, icon("edit"), h("span", { text: "Edit" })));
      const del = h("button", { class: "btn btn-sm btn-outline-light", text: "Delete" });
      confirmClick(del, "Delete? (songs stay)", async () => { await api(`/api/albums/${al.id}`, { method: "DELETE" }); toast(`${al.kindName} deleted. The songs are still on your profile.`); navigate(profileHref(al.artist.username) + "?tab=song"); });
      tools.append(del);
    }
    box.replaceChildren(
      h("section", { class: "al-hero", style: al.cover ? `--al-bg:url("${al.cover}")` : "" },
        h("div", { class: "al-cover", style: al.cover ? `background-image:url("${al.cover}")` : "" }),
        h("div", { class: "al-text" },
          h("p", { class: "al-kind", text: al.kindName }),
          h("h1", { text: al.title }),
          h("p", { class: "al-meta" }, h("a", { href: profileHref(al.artist.username) + "?tab=song" }, al.artist.name), tick(al.artist, 14),
            ` · ${al.year || ""} · ${al.count} song${al.count === 1 ? "" : "s"}${mins ? `, ${mins} min` : ""}`))),
      tools,
      al.songs.length ? songList(al.songs, { showArtist: false }) : empty(al.mine ? "No songs yet." : "No songs yet.", al.mine ? "Press “Songs” to add your songs to it." : ""));
  }
  // Pick (and order) which of your songs are on it
  async function pickSongs(al) {
    const { songs } = await api(`/api/users/${encodeURIComponent(al.artist.username)}/songs`);
    let picked = al.songs.map((s) => s.id);
    const list = h("div", { class: "pl-add-list" });
    const paint = () => list.replaceChildren(...songs.map((s) => {
      const box = h("input", { type: "checkbox", checked: picked.includes(s.id) });
      box.addEventListener("change", () => { picked = box.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id); paint(); });
      const n = picked.indexOf(s.id);
      return h("label", { class: "pl-add-row" }, box, h("div", { class: "sp-cover", style: s.cover ? `background-image:url("${s.cover}")` : "" }),
        h("div", { class: "pl-add-text" }, h("b", { text: s.title }), h("span", { class: "muted", text: (n >= 0 ? `Track ${n + 1}` : s.album ? `On “${s.album}”` : "Not on an album") + " · " + fmt(s.duration) })));
    }));
    paint();
    const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save track list" });
    const mm = modal({ title: `Songs on ${al.title}`, body: h("div", { class: "create-form" }, h("p", { class: "create-hint", text: "Tick songs in the order you want them. A song can be on one album at a time." }), songs.length ? list : empty("No songs yet.", "Upload songs first."), save) });
    save.addEventListener("click", async () => {
      try { await api(`/api/albums/${al.id}/songs`, { method: "POST", body: { songIds: picked } }); mm.close(); toast("Track list saved."); load(); }
      catch (err) { toast(err.error || "Couldn’t save it."); }
    });
  }
  load();
}
albumPage.navName = () => "videos";
albumPage.layout = "wide";
