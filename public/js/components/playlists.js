// Playlists: save a video to one, make a new one, edit title / description / cover.
import { h, icon, modal, spinner, empty, toast, plural } from "../ui.js";
import { api, upload } from "../api.js";
import { navigate } from "../router.js";
import { visibilityPicker, visibilityBadge } from "./visibility.js";

export const playlistHref = (id) => `/playlist/${encodeURIComponent(id)}`;

export function playlistCard(pl) {
  return h("a", { class: "playlist-card", href: playlistHref(pl.id) },
    h("div", { class: "pl-cover" },
      pl.cover ? h("img", { src: pl.cover, alt: "", loading: "lazy" }) : h("div", { class: "pl-cover-empty" }, icon("playlist")),
      h("span", { class: "pl-count" }, icon("playlist"), plural(pl.count, "video", "videos"))
    ),
    h("h3", {}, pl.title, " ", visibilityBadge(pl)),
    h("p", { class: "muted", text: pl.owner.name })
  );
}

/* ---------- New / edit playlist form ---------- */
export function openPlaylistForm(existing = null, { onSaved } = {}) {
  let coverUrl = existing?.customCover ? existing.cover : null;
  let uploading = false;
  const preview = h("div", { class: "pl-form-cover" });
  const paint = () => {
    preview.replaceChildren(coverUrl ? h("img", { src: coverUrl, alt: "" }) : h("div", { class: "pl-cover-empty" }, icon("playlist"), h("span", { text: "No cover yet" })));
    removeBtn.hidden = !coverUrl;
  };
  const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", hidden: true });
  const pickBtn = h("button", { type: "button", class: "btn btn-sm btn-outline-light" }, icon("image"), h("span", { text: "Choose cover" }));
  const removeBtn = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Remove cover" });
  pickBtn.addEventListener("click", () => input.click());
  removeBtn.addEventListener("click", () => { coverUrl = null; paint(); });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    uploading = true;
    save.disabled = true;
    coverUrl = URL.createObjectURL(file);
    paint();
    preview.classList.add("uploading");
    try { coverUrl = (await upload(file)).url; }
    catch (err) { coverUrl = null; showErr(err.error || "Upload failed."); }
    preview.classList.remove("uploading");
    uploading = false;
    save.disabled = false;
    paint();
  });

  const title = h("input", { type: "text", class: "text-input", placeholder: "Playlist name", maxlength: 80, value: existing?.title || "" });
  const desc = h("textarea", { class: "text-input", rows: 3, placeholder: "What is this series about? (optional)", maxlength: 1000 });
  desc.value = existing?.description || "";
  const vis = visibilityPicker(existing?.visibility || "public");
  vis.el.querySelector(".vis-label").textContent = "Who can see it";
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const showErr = (msg) => { err.textContent = msg; err.hidden = !msg; };
  const save = h("button", { type: "submit", class: "btn btn-primary btn-full", text: existing ? "Save" : "Create playlist" });

  const form = h("form", { class: "create-form pl-form", novalidate: true },
    h("div", { class: "pl-form-top" }, preview, h("div", { class: "pl-form-btns" }, pickBtn, removeBtn, input)),
    title, desc, vis.el, err, save);
  const m = modal({ title: existing ? "Edit playlist" : "New playlist", body: form });
  paint();
  setTimeout(() => title.focus(), 50);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (uploading) return;
    showErr("");
    save.disabled = true;
    try {
      const body = { title: title.value, description: desc.value, cover: coverUrl, visibility: vis.value() };
      const { playlist } = existing
        ? await api(`/api/playlists/${existing.id}`, { method: "POST", body })
        : await api("/api/playlists", { method: "POST", body });
      m.close();
      toast(existing ? "Playlist saved." : "Playlist created.");
      onSaved ? onSaved(playlist) : navigate(playlistHref(playlist.id));
    } catch (ex) {
      showErr(ex.error || "Couldn’t save the playlist.");
    }
    save.disabled = false;
  });
}

/* ---------- Add videos to a playlist (from the playlist page) ---------- */
export function openAddVideos(pl, onDone, { season = null } = {}) {
  const have = new Set((pl.videos || []).map((v) => v.id));
  const picked = new Set();
  const search = h("input", { type: "search", class: "text-input", placeholder: "Search your videos and public videos" });
  const list = h("div", { class: "pl-add-list" }, spinner());
  const add = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Add videos", disabled: true });
  const paintAdd = () => { add.disabled = !picked.size; add.textContent = picked.size ? `Add ${plural(picked.size, "video", "videos")}` : "Add videos"; };
  const row = (v) => {
    const m = v.media[0];
    const inIt = have.has(v.id);
    const box = h("input", { type: "checkbox", checked: inIt || picked.has(v.id), disabled: inIt });
    box.addEventListener("change", () => { box.checked ? picked.add(v.id) : picked.delete(v.id); paintAdd(); });
    return h("label", { class: "pl-add-row" + (inIt ? " in" : "") }, box,
      h("div", { class: "thumb" }, m.poster ? h("img", { src: m.poster, alt: "", loading: "lazy" }) : h("div", { class: "thumb-empty" }, icon("play"))),
      h("div", { class: "pl-add-text" }, h("b", { text: v.title }), h("span", { class: "muted", text: inIt ? "Already in this playlist" : v.author.name })));
  };
  let seq = 0, timer;
  async function load() {
    const n = ++seq;
    try {
      const { mine, others } = await api(`/api/playlists/candidates?q=${encodeURIComponent(search.value.trim())}`);
      if (n !== seq) return;
      list.replaceChildren();
      if (mine.length) list.append(h("p", { class: "sg-title", text: "Your videos" }), ...mine.map(row));
      if (others.length) list.append(h("p", { class: "sg-title", text: "Public videos" }), ...others.map(row));
      if (!mine.length && !others.length) list.append(empty(search.value.trim() ? "No videos found." : "You haven’t uploaded videos yet.", search.value.trim() ? "Try other words." : "Search to add other people’s public videos."));
    } catch (err) { list.replaceChildren(empty("Couldn’t load videos.", err.error || "")); }
  }
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 220); });
  add.addEventListener("click", async () => {
    add.disabled = true;
    try {
      const { added } = await api(`/api/playlists/${pl.id}/videos`, { method: "POST", body: { postIds: [...picked], add: true, season } });
      m.close();
      toast(`Added ${plural(added, "video", "videos")} to “${pl.title}”.`);
      onDone?.();
    } catch (err) { toast(err.error || "Couldn’t add them."); paintAdd(); }
  });
  const m = modal({ title: season ? `Add episodes to Season ${season}` : `Add videos to ${pl.title}`, body: h("div", { class: "create-form" }, search, list, add) });
  load();
}

/* ---------- "Save to playlist" for one video ---------- */
export function openSaveToPlaylist(video) {
  if (video.film || video.episode) return toast(video.film ? "Movies can’t be added to playlists — they live in Movies & Series." : "Series episodes can’t be added to playlists — they stay in their series.");
  const list = h("div", { class: "pl-pick" }, spinner());
  const newBtn = h("button", { type: "button", class: "btn btn-sm btn-outline-light pl-new" }, icon("plus"), h("span", { text: "New playlist" }));
  const m = modal({ title: "Save to playlist", body: [list, newBtn] });

  async function load() {
    try {
      const { playlists } = await api(`/api/playlists?contains=${encodeURIComponent(video.id)}`);
      list.replaceChildren();
      if (!playlists.length) list.append(empty("No playlists yet.", "Make one to group your videos into a series."));
      for (const pl of playlists) {
        const box = h("input", { type: "checkbox", checked: pl.hasVideo });
        box.addEventListener("change", async () => {
          box.disabled = true;
          try {
            await api(`/api/playlists/${pl.id}/videos`, { method: "POST", body: { postId: video.id, add: box.checked } });
            toast(box.checked ? `Saved to “${pl.title}”.` : `Removed from “${pl.title}”.`);
          } catch (err) {
            box.checked = !box.checked;
            toast(err.error || "Couldn’t update the playlist.");
          }
          box.disabled = false;
        });
        list.append(h("label", { class: "pl-pick-row" }, box, h("span", { class: "box" }), h("b", { text: pl.title }), h("span", { class: "muted", text: plural(pl.count, "video", "videos") })));
      }
    } catch (err) {
      list.replaceChildren(empty("Couldn’t load your playlists.", err.error || ""));
    }
  }
  newBtn.addEventListener("click", () => {
    m.close();
    openPlaylistForm(null, {
      onSaved: async (pl) => {
        await api(`/api/playlists/${pl.id}/videos`, { method: "POST", body: { postId: video.id, add: true } }).catch(() => {});
        toast(`Saved to “${pl.title}”.`);
      },
    });
  });
  load();
}
