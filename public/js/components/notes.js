// Notes: a short line, an emoji, a photo or a GIF above your photo, gone after 24 hours.
// Shown to the people who follow you, at the top of Messages and on your profile.
import { h, avatar, modal, toast, tick } from "../ui.js";
import { api, upload } from "../api.js";
import { openGifs, gifBody } from "./gifs.js";
import { state, on } from "../state.js";
import { profileHref, navigate } from "../router.js";
import { openEmojiPicker, insertAtCursor } from "./emoji.js";

const QUICK = ["☕", "🎧", "📸", "🔥", "😴", "🎉", "💭", "🌙", "🏃", "❤️"];
// The bubble's look: a colour, and an emoji sitting on its corner
export const NOTE_COLORS = [["", "Classic"], ["pink", "Pink"], ["berry", "Berry"], ["purple", "Purple"], ["ocean", "Ocean"], ["mint", "Mint"], ["sunset", "Sunset"], ["gold", "Gold"], ["night", "Night"], ["galaxy", "Galaxy"]];
const DECOS = ["✨", "💖", "🔥", "⭐", "🌸", "🦋", "👑", "🎀", "🍀", "🌈", "💫", "🎶"];
export function styleNote(bubble, note) {
  if (note?.color) bubble.dataset.color = note.color; else delete bubble.dataset.color;
  bubble.querySelector(".nb-deco")?.remove();
  if (note?.deco) bubble.append(h("span", { class: "nb-deco", "aria-hidden": "true", text: note.deco }));
  return bubble;
}

function hoursLeft(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "gone";
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `${h}h left` : `${Math.max(1, Math.floor(ms / 60000))}m left`;
}

// The song inside a note's bubble: "♫ Title"
export function noteMusicLine(song) {
  return h("span", { class: "nb-music", title: `${song.title} · ${song.artist?.name || ""}` }, h("i", { class: "nbm-eq", "aria-hidden": "true" }, h("b"), h("b"), h("b")), h("span", { text: song.title }));
}
export function openNoteEditor(current, onSaved) {
  const input = h("input", { type: "text", class: "text-input note-input", maxlength: 60, placeholder: "Share a thought… or just an emoji", value: current?.text || "" });
  const count = h("span", { class: "counter" });
  const paint = () => {
    const n = [...input.value].length;
    count.textContent = `${n} / 60`;
    count.className = "counter" + (n > 60 ? " over" : "");
    save.disabled = (!input.value.trim() && !media && !music) || n > 60 || busy;
  };
  // A photo or GIF on the note
  let media = current?.media ? { keep: true, url: current.media.url, gif: current.media.gif } : null, busy = false;
  const mediaBox = h("div", { class: "note-media-pick" });
  const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true });
  const photoBtn = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "📷 Photo" });
  const gifBtn = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "GIF" });
  const paintMedia = () => {
    mediaBox.replaceChildren(...(media ? [h("img", { src: media.url, alt: "" }), h("button", { type: "button", class: "nm-x", title: "Remove", text: "✕", onclick: () => { media = null; paintMedia(); paint(); live(); } })] : []));
    mediaBox.hidden = !media;
    live();
  };
  photoBtn.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files[0]; file.value = "";
    if (!f) return;
    busy = true; paint(); photoBtn.textContent = "Uploading…";
    try { const up = await upload(f); media = { image: up.url, url: up.url, gif: false }; } catch (err) { toast(err.error || "Couldn’t upload it."); }
    busy = false; photoBtn.textContent = "📷 Photo"; paintMedia(); paint();
  });
  gifBtn.addEventListener("click", () => openGifs(gifBtn, (g) => { media = { send: gifBody(g), url: g.url, gif: true }; paintMedia(); paint(); }));
  // A song on the note (LookBlog, YouTube or my MP3), like Instagram's notes
  let music = current?.music ? { keep: true, view: current.music } : null;
  const musicBtn = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "🎵 Music" });
  const musicBox = h("div", { class: "note-music-pick" });
  const paintMusic = () => {
    musicBox.replaceChildren();
    musicBox.hidden = !music;
    if (music) import("./song-picker.js").then(({ songPill }) => { musicBox.replaceChildren(songPill(music.view, { small: true }), h("button", { type: "button", class: "nm-x", title: "Remove the song", text: "✕", onclick: () => { music = null; paintMusic(); paint(); live(); } })); });
    live();
  };
  musicBtn.addEventListener("click", () => import("./song-picker.js").then(({ openSongPicker }) => openSongPicker({ title: "A song for your note", onPick: (view, ref) => { music = { view, ref }; paintMusic(); paint(); } })));
  const emojiBtn = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "😊 Emoji" });
  emojiBtn.addEventListener("click", () => openEmojiPicker(emojiBtn, (e) => insertAtCursor(input, e), { keepOpen: true }));
  const quick = h("div", { class: "note-quick" }, ...QUICK.map((e) => {
    const b = h("button", { type: "button", class: "quick-react", text: e, title: e });
    b.addEventListener("click", () => { input.value = e; paint(); input.focus(); });
    return b;
  }));
  // Customize the bubble
  let color = current?.color || "", deco = current?.deco || "";
  const colors = h("div", { class: "note-colors", role: "radiogroup", "aria-label": "Bubble colour" }, ...NOTE_COLORS.map(([id, label]) => {
    const b = h("button", { type: "button", class: "note-color" + (id === color ? " on" : ""), title: label, "aria-label": label, dataset: { color: id } });
    b.addEventListener("click", () => { color = id; colors.querySelectorAll(".note-color").forEach((x) => x.classList.toggle("on", x === b)); live(); });
    return b;
  }));
  const decoMore = h("button", { type: "button", class: "note-deco more", title: "Any emoji", text: "＋" });
  const decos = h("div", { class: "note-decos" },
    h("button", { type: "button", class: "note-deco none" + (deco ? "" : " on"), title: "No emoji", text: "∅", onclick: () => setDeco("") }),
    ...DECOS.map((e) => h("button", { type: "button", class: "note-deco" + (e === deco ? " on" : ""), text: e, onclick: () => setDeco(e) })), decoMore);
  function setDeco(e) {
    deco = e;
    decos.querySelectorAll(".note-deco").forEach((x) => x.classList.toggle("on", x.textContent === e || (!e && x.classList.contains("none"))));
    live();
  }
  decoMore.addEventListener("click", () => openEmojiPicker(decoMore, (e) => setDeco(e)));
  const style = h("details", { class: "note-style", open: Boolean(current?.color || current?.deco) },
    h("summary", { text: "🎨 Bubble style" }),
    h("small", { class: "muted", text: "Colour" }), colors,
    h("small", { class: "muted", text: "Emoji on the bubble" }), decos);
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: current ? "Update note" : "Share note" });
  const del = current ? h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "Delete note" }) : null;
  input.addEventListener("input", paint);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !save.disabled) save.click(); });
  const m = modal({ title: "Your note", body: h("div", { class: "create-form note-editor" },
    h("div", { class: "note-preview" }, h("span", { class: "note-bubble big" }, h("span", { class: "nb-text" })), avatar(state.me, 72)),
    h("p", { class: "create-hint", text: "People who follow you see it for 24 hours, above your photo in Messages and on your profile." }),
    mediaBox, musicBox, input, h("div", { class: "bio-bar" }, emojiBtn, photoBtn, gifBtn, musicBtn, file, count), quick, style, save, del) });
  const preview = m.card.querySelector(".nb-text");
  const previewBubble = m.card.querySelector(".note-preview .note-bubble");
  function live() {
    if (!preview) return;
    preview.textContent = input.value.trim() || (media || music ? "" : "…");
    previewBubble.querySelector(".nb-media")?.remove();
    previewBubble.querySelector(".nb-music")?.remove();
    if (media) previewBubble.prepend(h("img", { class: "nb-media", src: media.url, alt: "" }));
    if (music) previewBubble.append(noteMusicLine(music.view));
    styleNote(previewBubble, { color, deco });
  }
  input.addEventListener("input", live);
  quick.addEventListener("click", live);
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const extra = !media ? {} : media.keep ? { keepMedia: true } : media.image ? { image: media.image } : media.send;
      const tune = !music ? {} : music.keep ? { keepMusic: true } : { music: music.ref };
      const { note } = await api("/api/me/note", { method: "POST", body: { text: input.value, color, deco, ...extra, ...tune } });
      m.close();
      toast("Note shared for 24 hours.");
      onSaved?.(note);
    } catch (err) { toast(err.error || "Couldn’t share the note."); paint(); }
  });
  del?.addEventListener("click", async () => {
    await api("/api/me/note", { method: "DELETE" }).catch(() => {});
    m.close();
    toast("Note deleted.");
    onSaved?.(null);
  });
  paintMedia();
  paintMusic();
  paint();
  live();
  setTimeout(() => input.focus(), 60);
}

// Someone else's note: see it bigger and reply (like Instagram)
export function openNoteReply(user, note) {
  const input = h("input", { type: "text", class: "text-input note-reply-input", maxlength: 1000, placeholder: `Reply to ${user.name.split(" ")[0]}…`, autocomplete: "off" });
  const send = h("button", { type: "button", class: "btn btn-primary", text: "Send", disabled: true });
  const quick = h("div", { class: "note-quick" }, ...["😂", "❤️", "🔥", "😮", "👏", "😢"].map((e) => h("button", { type: "button", class: "quick-react", text: e, title: `Reply ${e}`, onclick: () => go(e) })));
  const m = modal({ title: "Note", body: h("div", { class: "create-form note-reply" },
    h("div", { class: "note-preview" },
      styleNote(h("span", { class: "note-bubble big" + (note.media ? " has-media" : "") }, note.media ? h("img", { class: "nb-media", src: note.media.url, alt: "" }) : null, note.text ? h("span", { class: "nb-text", text: note.text }) : null, note.music ? noteMusicLine(note.music) : null), note),
      h("a", { href: profileHref(user.username), class: "note-reply-who", onclick: (e) => { e.preventDefault(); m.close(); navigate(profileHref(user.username)); } },
        avatar(user, 72), h("b", {}, user.name, tick(user, 15)), h("small", { class: "muted", text: note.expiresAt ? hoursLeft(note.expiresAt) : "" }))),
    note.music ? h("div", { class: "note-reply-song" }) : null,
    quick, h("div", { class: "note-reply-row" }, input, send)) });
  // Their song: tap to listen
  if (note.music) import("./song-picker.js").then(({ songPill }) => m.card.querySelector(".note-reply-song")?.append(songPill(note.music)));
  input.addEventListener("input", () => { send.disabled = !input.value.trim(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) go(input.value); });
  send.addEventListener("click", () => go(input.value));
  let busy = false;
  async function go(text) {
    if (busy || !String(text).trim()) return;
    busy = true; send.disabled = true;
    try {
      const r = await api(`/api/notes/${encodeURIComponent(user.username)}/reply`, { method: "POST", body: { text } });
      m.close();
      toast(r.sent === "message" ? "Reply sent in Messages." : `Reply sent. ${user.name.split(" ")[0]} gets it as a notification.`);
    } catch (err) { toast(err.error || "Couldn’t send it."); busy = false; send.disabled = false; }
  }
  setTimeout(() => input.focus(), 60);
}

// The row of notes at the top of Messages
export function notesRow() {
  const row = h("div", { class: "notes-row" });
  async function load() {
    try {
      const { notes } = await api("/api/notes");
      row.replaceChildren(...notes.map((n) => {
        const label = n.isMe ? (n.note ? "Your note" : "Leave a note") : n.user.name.split(" ")[0];
        const item = h(n.isMe || n.note ? "button" : "a", { class: "note-item" + (n.isMe ? " mine" : ""), href: n.isMe || n.note ? null : profileHref(n.user.username), type: n.isMe || n.note ? "button" : null, title: n.note ? `${n.note.text || (n.note.media?.gif ? "GIF" : "Photo")} · ${hoursLeft(n.note.expiresAt)}` : "" },
          styleNote(h("span", { class: "note-bubble" + (n.note ? "" : " empty") + (n.note?.media ? " has-media" : "") }, n.note?.media ? h("img", { class: "nb-media", src: n.note.media.url, alt: "" }) : null, n.note?.text || !n.note ? h("span", { class: "nb-text", text: n.note ? n.note.text : "+ Note" }) : null, n.note?.music ? noteMusicLine(n.note.music) : null), n.note),
          avatar(n.user, 58),
          h("span", { class: "note-name" }, label, n.isMe ? null : tick(n.user, 13)));
        if (n.isMe) item.addEventListener("click", () => openNoteEditor(n.note, load));
        else if (n.note) item.addEventListener("click", () => openNoteReply(n.user, n.note));
        return item;
      }));
    } catch {}
  }
  load();
  const off = on("note", () => { if (!row.isConnected) return off(); load(); });
  return row;
}
