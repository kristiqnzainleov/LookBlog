// Movies and series (for filmmakers and producers): upload a movie, start a series.
import { h, icon, modal, toast } from "../ui.js";
import { api, upload } from "../api.js";
import { state, emit } from "../state.js";
import { navigate, profileHref } from "../router.js";
import { createPicker } from "./media-picker.js";
import { thumbnailField } from "./thumbnail.js";
import { visibilityPicker } from "./visibility.js";

export const GENRES = ["Drama", "Comedy", "Action", "Thriller", "Horror", "Sci-fi", "Romance", "Documentary", "Animation", "Crime", "Fantasy", "Music", "Short film", "Family"];
export const RATINGS = ["All ages", "7+", "13+", "16+", "18+"];

// Not a filmmaker yet: explain how to become one
function needRole(what) {
  const go = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Open my profile" });
  const m = modal({ title: what === "movie" ? "Upload a movie" : "Start a series", body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: `${what === "movie" ? "Movies" : "Series"} are for filmmakers, film producers, photographers and creators. On your profile, press “What do you do?” and pick one of them (or add your own, like “Director”). Then come back here.` }),
    go) });
  go.addEventListener("click", () => { m.close(); navigate(profileHref(state.me.username)); });
}

const select = (options, value, placeholder) => h("select", { class: "text-input" },
  placeholder ? h("option", { value: "", text: placeholder }) : null,
  ...options.map((o) => h("option", { value: o, text: o, selected: o === value })));

// A picture field (a wide backdrop or a cover)
function pictureField(label, start, wide = true) {
  let url = start || null, busy = false;
  const box = h("button", { type: "button", class: "cine-pic" + (wide ? " wide" : "") });
  const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
  const paint = () => {
    box.style.backgroundImage = url ? `url("${url}")` : "";
    box.replaceChildren(h("span", { class: "gc-hint" }, icon("camera"), h("span", { text: url ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}` })));
  };
  box.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const f = input.files[0]; input.value = "";
    if (!f) return;
    busy = true; url = URL.createObjectURL(f); paint(); box.classList.add("busy");
    try { url = (await upload(f)).url; } catch (err) { url = null; toast(err.error || "Upload failed."); }
    busy = false; box.classList.remove("busy"); paint();
  });
  paint();
  return { el: h("div", { class: "cine-field" }, h("b", { class: "vis-label", text: label }), box, input), value: () => url, busy: () => busy };
}

/* ---------- Upload a movie ---------- */
export function openMovieUpload() {
  if (!state.me.canMakeFilms) return needRole("movie");
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-full", text: "Publish movie", disabled: true });
  const picker = createPicker({ accept: "video", max: 1, onChange: update, onError: showErr });
  const drop = h("button", { type: "button", class: "drop-zone" }, h("b", { text: "Choose the movie file" }), h("span", { text: "MP4, MOV or WebM · any length" }));
  drop.addEventListener("click", () => picker.open());
  const thumb = thumbnailField({ vertical: false });
  thumb.onChange(update);
  const backdrop = pictureField("Backdrop", null, true);
  const title = h("input", { type: "text", class: "text-input", maxlength: 100, placeholder: "Movie title" });
  const tagline = h("input", { type: "text", class: "text-input", maxlength: 140, placeholder: "Tagline (one line that sells it)" });
  const desc = h("textarea", { class: "text-input", rows: 4, maxlength: 5000, placeholder: "What is the movie about?" });
  const year = h("input", { type: "number", class: "text-input", min: 1888, max: new Date().getFullYear() + 2, value: new Date().getFullYear(), placeholder: "Year" });
  const genre = select(GENRES, "", "Genre");
  const rating = select(RATINGS, "", "Age rating");
  const vis = visibilityPicker("public");
  function update() {
    thumb.setAuto(picker.items()[0]?.poster);
    submit.disabled = picker.busy() || thumb.busy() || picker.media().length !== 1 || !title.value.trim();
    submit.textContent = picker.busy() ? "Uploading…" : "Publish movie";
    drop.hidden = picker.items().length > 0;
  }
  title.addEventListener("input", update);
  const form = h("form", { class: "create-form", novalidate: true },
    h("p", { class: "create-hint", text: "Your movie gets a cinema page with a big backdrop, theater mode and subtitles (add them after it’s up)." }),
    drop, picker.previews, thumb.el, backdrop.el, title, tagline, desc,
    h("div", { class: "cine-row3" }, year, genre, rating), vis.el, err, submit);
  form.append(picker.button); picker.button.hidden = true;
  const m = modal({ title: "Upload a movie", body: form, wide: true });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    if (backdrop.busy()) return showErr("Wait for the backdrop to finish uploading.");
    submit.disabled = true; submit.textContent = "Publishing…"; showErr("");
    try {
      const media = picker.media();
      if (thumb.value()) media[0].poster = thumb.value();
      const { post } = await api("/api/posts", { method: "POST", body: {
        type: "video", title: title.value, text: desc.value, media, visibility: vis.value(),
        film: { year: year.value, genre: genre.value, rating: rating.value, tagline: tagline.value, backdrop: backdrop.value() } } });
      emit("post:created", post);
      m.close();
      toast("Your movie is up!");
      navigate(`/watch/${post.id}`);
    } catch (ex) { showErr(ex.error || "Couldn’t publish the movie."); update(); }
  });
  update();
}

/* ---------- Start (or edit) a series ---------- */
export function openSeriesForm(existing = null, onSaved) {
  if (!existing && !state.me.canMakeFilms) return needRole("series");
  const cover = pictureField("Cover (wide, like a poster on TV)", existing?.customCover ? existing.cover : null, true);
  const title = h("input", { type: "text", class: "text-input", maxlength: 80, placeholder: "Series title", value: existing?.title || "" });
  const tagline = h("input", { type: "text", class: "text-input", maxlength: 140, placeholder: "Tagline", value: existing?.series?.tagline || "" });
  const desc = h("textarea", { class: "text-input", rows: 4, maxlength: 1000, placeholder: "What is the series about?" });
  desc.value = existing?.description || "";
  const year = h("input", { type: "number", class: "text-input", min: 1888, max: new Date().getFullYear() + 2, value: existing?.series?.year || new Date().getFullYear() });
  const genre = select(GENRES, existing?.series?.genre || "", "Genre");
  const rating = select(RATINGS, existing?.series?.rating || "", "Age rating");
  const vis = visibilityPicker(existing?.visibility || "public");
  vis.el.querySelector(".vis-label").textContent = "Who can see it";
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const save = h("button", { type: "submit", class: "btn btn-primary btn-full", text: existing ? "Save" : "Create series" });
  const form = h("form", { class: "create-form", novalidate: true },
    existing ? null : h("p", { class: "create-hint", text: "A series is a playlist shown like on Netflix: a big cover, seasons and episodes. Add your videos as episodes next." }),
    cover.el, title, tagline, desc, h("div", { class: "cine-row3" }, year, genre, rating), vis.el, err, save);
  const m = modal({ title: existing ? "Edit series" : "New series", body: form, wide: true });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (cover.busy()) return;
    err.hidden = true; save.disabled = true;
    try {
      const body = { kind: "series", title: title.value, description: desc.value, cover: cover.value(), visibility: vis.value(), year: year.value, genre: genre.value, rating: rating.value, tagline: tagline.value };
      const { playlist } = await api(existing ? `/api/playlists/${existing.id}` : "/api/playlists", { method: "POST", body });
      m.close();
      toast(existing ? "Series saved." : "Series created — upload the first episode!");
      onSaved ? onSaved(playlist) : navigate(`/playlist/${playlist.id}`);
      // A brand-new series: open the episode upload straight away (Season 1)
      if (!existing && !onSaved) setTimeout(() => import("./composer.js").then((c) => c.openEpisodeUpload(playlist, { season: 1, onDone: () => navigate(`/playlist/${playlist.id}`, { replace: true }) })), 600);
    } catch (ex) { err.textContent = ex.error || "Couldn’t save the series."; err.hidden = false; save.disabled = false; }
  });
}
