// The story editor: move / zoom / turn the photo, light and colour, filters, text and emoji you can drag,
// a song, and tagging people. Everything is kept as data with the story (see games/story-look.js).
import { h, toast, modal } from "../ui.js";
import { STORY_FILTERS, STORY_FONTS, STORY_TEXT_STYLES, STORY_COLORS, STORY_BGS } from "../games/story-look.js";
import { styleStoryMedia, overlayEl, storyBack } from "./stories.js";
import { attachMentions } from "./mentions.js";

const EMOJIS = ["😂", "😍", "🔥", "✨", "💖", "😎", "🥳", "😭", "🤯", "👀", "💯", "🙏", "👑", "🌸", "⭐", "🌈", "☀️", "🌙", "🎉", "🎵", "📍", "☕", "🍕", "🐶", "🐱", "🦋", "💪", "🤍", "💀", "🫶"];

// Opens the editor for a picked file. onShare({ edit, song, songRef, text, tags }) posts it.
export function openStoryEditor({ url, isVideo, more = [], onShare, onClose }) {
  // (new stories show the whole photo, with it blurred behind: nothing is cut off unless you choose Fill)
  const edit = { f: "", a: { b: 0, c: 0, s: 0, w: 0 }, t: { z: 1, x: 0, y: 0, r: 0 }, bg: "blur", m: "fit", o: [] };
  let song = null, songRef = null, selected = null, tab = "filters";
  let cropped = null, dims = null; // a cropped copy of the photo (Crop & size), and the photo's size in pixels

  // The preview: the photo / video, with the text and emoji on top (drag them)
  const media = isVideo ? h("video", { src: url, autoplay: true, muted: true, loop: true, playsInline: true }) : h("img", { src: url, alt: "", draggable: "false" });
  const layer = h("div", { class: "so-layer se-layer" });
  const stage = h("div", { class: "se-stage" }, media, layer);
  if (!isVideo) media.addEventListener("load", () => { dims = [media.naturalWidth, media.naturalHeight]; if (tab === "adjust") paintPanel(); });
  const songTag = h("div", { class: "sv-song se-song", hidden: true });
  const frame = h("div", { class: "story-frame preview se-frame" }, stage, songTag);
  let poster = isVideo ? null : url;
  if (isVideo) media.addEventListener("loadeddata", () => { try { const c = document.createElement("canvas"); c.width = media.videoWidth; c.height = media.videoHeight; c.getContext("2d").drawImage(media, 0, 0); poster = c.toDataURL("image/jpeg", 0.7); paintMedia(); } catch {} }, { once: true });
  const paintMedia = () => {
    styleStoryMedia(media, edit);
    stage.style.background = edit.bg && edit.bg !== "blur" ? edit.bg : "";
    stage.querySelector(".so-back")?.remove();
    const back = storyBack(edit, poster);
    if (back) stage.prepend(back);
  };
  const paintLayer = () => {
    layer.replaceChildren(...edit.o.map((o) => {
      const el = overlayEl(o);
      el.classList.toggle("on", o === selected);
      dragItem(el, o);
      return el;
    }));
  };
  // Drag a text or an emoji around the story (a tap selects it)
  function dragItem(el, o) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (selected !== o) { selected = o; tab = o.k === "t" ? "text" : "stickers"; paintTabs(); paintLayer(); return; }

      const r = stage.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y;
      const move = (ev) => { o.x = Math.max(0, Math.min(100, ox + ((ev.clientX - sx) / r.width) * 100)); o.y = Math.max(0, Math.min(100, oy + ((ev.clientY - sy) / r.height) * 100)); el.style.left = o.x + "%"; el.style.top = o.y + "%"; };
      const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
      addEventListener("pointermove", move); addEventListener("pointerup", up);
    });
  }
  // Drag the photo itself to move it (while adjusting)
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".so-item")) return;
    if (selected) { selected = null; paintLayer(); paintTabs(); }
    const r = stage.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, ox = edit.t.x, oy = edit.t.y;
    const move = (ev) => { edit.t.x = Math.max(-100, Math.min(100, ox + ((ev.clientX - sx) / r.width) * 100 / edit.t.z)); edit.t.y = Math.max(-100, Math.min(100, oy + ((ev.clientY - sy) / r.height) * 100 / edit.t.z)); paintMedia(); };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  // Zoom with the wheel / trackpad on a computer
  stage.addEventListener("wheel", (e) => { e.preventDefault(); edit.t.z = Math.max(0.5, Math.min(4, edit.t.z * (e.deltaY < 0 ? 1.06 : 0.94))); paintMedia(); if (tab === "adjust") paintPanel(); }, { passive: false });

  // The tools
  const TABS = [["filters", "✨", "Filters"], ["adjust", "🎚️", "Adjust"], ...(isVideo ? [] : [["collage", "🖼️", "Collage"]]), ["text", "Aa", "Text"], ["stickers", "😀", "Stickers"], ["music", "🎵", "Music"], ["tag", "👥", "Tag"]];
  // A collage: two or more photos in frames (made into one picture)
  async function makeCollage(extra = []) {
    const { openCollage } = await import("./collage.js");
    const r = await openCollage({ photos: [url, ...extra] });
    if (!r) return;
    cropped = new File([r.blob], "collage.jpg", { type: "image/jpeg" });
    const u = URL.createObjectURL(cropped);
    media.src = u; poster = u; dims = [r.width, r.height];
    edit.m = ""; edit.t = { z: 1, x: 0, y: 0, r: 0 }; // (it's already the shape of a story)
    paintMedia(); if (tab === "collage" || tab === "adjust") paintPanel();
  }
  let myStickers = null;
  const tabs = h("div", { class: "se-tabs", role: "tablist" });
  const panel = h("div", { class: "se-panel" });
  function paintTabs() {
    tabs.replaceChildren(...TABS.map(([k, ic, l]) => h("button", { type: "button", class: "se-tab" + (tab === k ? " on" : ""), role: "tab", "aria-selected": String(tab === k), onclick: () => { tab = k; paintTabs(); } }, h("span", { text: ic }), h("small", { text: l }))));
    paintPanel();
  }
  const slider = (label, val, min, max, step, onInput) => {
    const out = h("b", { text: String(val) });
    const r = h("input", { type: "range", min, max, step, value: val, "aria-label": label });
    r.addEventListener("input", () => { out.textContent = r.value; onInput(Number(r.value)); });
    return h("label", { class: "se-slider" }, h("span", { text: label }), r, out);
  };
  const chip = (text, on, fn, cls = "") => h("button", { type: "button", class: "se-chip " + cls + (on ? " on" : ""), text, onclick: fn });
  const tagIn = h("input", { type: "text", class: "story-text-input story-tag-input", placeholder: "👥 Tag people: @username", autocomplete: "off" });
  attachMentions(tagIn);
  const caption = h("input", { type: "text", class: "story-text-input", maxlength: 120, placeholder: "Caption at the bottom (optional)" });
  function paintPanel() {
    if (tab === "filters") {
      panel.replaceChildren(h("div", { class: "se-filters" }, ...STORY_FILTERS.map(([id, label, css]) => {
        const thumb = isVideo ? h("span", { class: "se-fthumb se-fvideo", style: `filter:${css}` }) : h("span", { class: "se-fthumb", style: `background-image:url("${url}");filter:${css}` });
        return h("button", { type: "button", class: "se-filter" + (edit.f === id ? " on" : ""), onclick: () => { edit.f = id; paintMedia(); paintPanel(); } }, thumb, h("small", { text: label }));
      })));
    } else if (tab === "adjust") {
      panel.replaceChildren(
        slider("☀️ Brightness", edit.a.b, -100, 100, 1, (v) => { edit.a.b = v; paintMedia(); }),
        slider("◐ Contrast", edit.a.c, -100, 100, 1, (v) => { edit.a.c = v; paintMedia(); }),
        slider("🎨 Saturation", edit.a.s, -100, 100, 1, (v) => { edit.a.s = v; paintMedia(); }),
        slider("🌡️ Warmth", edit.a.w, -100, 100, 1, (v) => { edit.a.w = v; paintMedia(); }),
        isVideo ? null : h("div", { class: "se-row" }, h("button", { type: "button", class: "btn btn-primary btn-sm", text: `✂️ Crop & size${dims ? ` · ${dims[0]} × ${dims[1]} px` : ""}`, onclick: async () => {
          const { openFreeCrop } = await import("./freecrop.js");
          const r = await openFreeCrop(media.currentSrc || media.src);
          if (!r) return;
          cropped = new File([r.blob], "story.jpg", { type: r.blob.type || "image/jpeg" });
          const u = URL.createObjectURL(cropped);
          media.src = u; poster = u; dims = [r.width, r.height];
          paintMedia(); paintPanel();
        } }), cropped ? chip("Undo crop", false, () => { cropped = null; media.src = url; poster = url; paintMedia(); paintPanel(); }) : null),
        h("div", { class: "se-row" }, chip("⤢ Whole photo", edit.m === "fit", () => { edit.m = "fit"; if (!edit.bg) edit.bg = "blur"; paintMedia(); paintPanel(); }), chip("▣ Fill the story", edit.m !== "fit", () => { edit.m = ""; paintMedia(); paintPanel(); })),
        slider("📏 Size", Math.round(edit.t.z * 100) / 100, 0.5, 4, 0.01, (v) => { edit.t.z = v; paintMedia(); }),
        slider("↻ Turn", edit.t.r, -180, 180, 1, (v) => { edit.t.r = v; paintMedia(); }),
        h("div", { class: "se-row" }, chip("↺ 90°", false, () => { edit.t.r = ((edit.t.r - 90 + 540) % 360) - 180; paintMedia(); paintPanel(); }), chip("↻ 90°", false, () => { edit.t.r = ((edit.t.r + 90 + 540) % 360) - 180; paintMedia(); paintPanel(); }),
          chip("Reset", false, () => { edit.a = { b: 0, c: 0, s: 0, w: 0 }; edit.t = { z: 1, x: 0, y: 0, r: 0 }; edit.m = "fit"; edit.bg = "blur"; paintMedia(); paintPanel(); })),
        h("p", { class: "se-hint", text: "Drag the photo to move it · use Size (or scroll) to make it bigger or smaller." }),
        h("div", { class: "se-row" }, h("small", { class: "muted", text: "Around it:" }),
          ...STORY_BGS.map((c) => c === "blur" ? chip("Blur", edit.bg === "blur", () => { edit.bg = "blur"; paintMedia(); paintPanel(); })
            : h("button", { type: "button", class: "se-swatch" + (edit.bg === c ? " on" : ""), style: `background:${c}`, "aria-label": c, onclick: () => { edit.bg = c; paintMedia(); paintPanel(); } }))));
    } else if (tab === "text") {
      const t = selected?.k === "t" ? selected : null;
      const input = h("input", { type: "text", class: "story-text-input", maxlength: 120, placeholder: t ? "Edit the text" : "Type something, then Add", value: t?.v || "" });
      input.addEventListener("input", () => { if (t) { t.v = input.value; paintLayer(); } });
      const add = h("button", { type: "button", class: "btn btn-primary btn-sm", text: t ? "Done" : "Add text" });
      add.addEventListener("click", () => {
        if (t) { if (!t.v.trim()) edit.o = edit.o.filter((x) => x !== t); selected = null; paintLayer(); paintPanel(); return; }
        if (!input.value.trim()) return input.focus();
        if (edit.o.length >= 12) return toast("That’s a lot already: up to 12 texts and stickers.");
        const o = { k: "t", v: input.value.trim(), x: 50, y: 40, z: 8, r: 0, c: "#ffffff", f: "bold", s: "bg" };
        edit.o.push(o); selected = o; paintLayer(); paintPanel();
      });
      panel.replaceChildren(h("div", { class: "se-row" }, input, add));
      if (t) panel.append(
        h("div", { class: "se-row" }, ...STORY_FONTS.map(([id, label, css]) => h("button", { type: "button", class: "se-chip" + (t.f === id ? " on" : ""), style: `font-family:${css}`, text: label, onclick: () => { t.f = id; paintLayer(); paintPanel(); } }))),
        h("div", { class: "se-row" }, ...STORY_TEXT_STYLES.map(([id, label]) => chip(label, t.s === id, () => { t.s = id; paintLayer(); paintPanel(); }, "se-style")),
          ...STORY_COLORS.map((c) => h("button", { type: "button", class: "se-swatch" + (t.c === c ? " on" : ""), style: `background:${c}`, "aria-label": c, onclick: () => { t.c = c; paintLayer(); paintPanel(); } }))),
        slider("Size", t.z, 3, 20, 0.5, (v) => { t.z = v; paintLayer(); }),
        slider("Turn", t.r, -180, 180, 1, (v) => { t.r = v; paintLayer(); }),
        h("div", { class: "se-row" }, chip("🗑 Remove", false, () => { edit.o = edit.o.filter((x) => x !== t); selected = null; paintLayer(); paintPanel(); }, "danger"), h("small", { class: "muted", text: "Drag it on the story to move it." })));
      else panel.append(h("p", { class: "se-hint", text: "Add text, then drag it anywhere on the story. Tap a text to change its font, colour and style." }), caption);
      setTimeout(() => input.focus(), 30);
    } else if (tab === "stickers") {
      const e = selected?.k === "e" || selected?.k === "s" ? selected : null;
      panel.replaceChildren(h("div", { class: "se-emojis" }, ...EMOJIS.map((em) => h("button", { type: "button", class: "se-emoji", text: em, onclick: () => {
        if (edit.o.length >= 12) return toast("That’s a lot already: up to 12 texts and stickers.");
        const o = { k: "e", v: em, x: 30 + Math.random() * 40, y: 30 + Math.random() * 40, z: 14, r: Math.round(Math.random() * 30 - 15) };
        edit.o.push(o); selected = o; paintLayer(); paintPanel();
      } }))));
      // My own stickers (from my collection)
      const mine = h("div", { class: "se-mystickers" }, h("small", { class: "muted", text: "Loading your stickers…" }));
      panel.append(h("b", { class: "se-sub", text: "Your stickers" }), mine);
      const paintMine = () => mine.replaceChildren(...(myStickers.length ? myStickers.map((st) => h("button", { type: "button", class: "se-mysticker", onclick: () => {
        if (edit.o.length >= 12) return toast("That’s a lot already: up to 12 texts and stickers.");
        const o = { k: "s", v: st.url, x: 30 + Math.random() * 40, y: 30 + Math.random() * 40, z: 12, r: Math.round(Math.random() * 20 - 10) };
        edit.o.push(o); selected = o; paintLayer(); paintPanel();
      } }, h("img", { src: st.url, alt: "Sticker", loading: "lazy" }))) : [h("small", { class: "muted", text: "No stickers yet — make some from photos in a chat’s sticker panel." })]));
      if (myStickers) paintMine(); else import("../api.js").then(({ api }) => api("/api/me/stickers")).then((r) => { myStickers = r.stickers || []; if (tab === "stickers") paintMine(); }).catch(() => mine.replaceChildren(h("small", { class: "muted", text: "Couldn’t load your stickers." })));
      if (e) panel.append(slider("Size", e.z, 4, 30, 0.5, (v) => { e.z = v; paintLayer(); }), slider("Turn", e.r, -180, 180, 1, (v) => { e.r = v; paintLayer(); }),
        h("div", { class: "se-row" }, chip("🗑 Remove", false, () => { edit.o = edit.o.filter((x) => x !== e); selected = null; paintLayer(); paintPanel(); }, "danger")));
    } else if (tab === "collage") {
      panel.replaceChildren(
        h("p", { class: "se-hint", text: "Put two or more photos together in frames: side by side, a grid, polaroids… and choose the gap, the frame colour and how round they are." }),
        h("div", { class: "se-row" }, h("button", { type: "button", class: "btn btn-primary btn-sm", text: cropped ? "🖼️ Change the collage" : "🖼️ Make a collage", onclick: () => makeCollage() }),
          cropped ? chip("Back to one photo", false, () => { cropped = null; media.src = url; poster = url; edit.m = "fit"; paintMedia(); paintPanel(); }) : null));
    } else if (tab === "music") {
      const pick = h("button", { type: "button", class: "btn btn-primary btn-sm", text: song ? "🎵 Change song" : "🎵 Add a song" });
      pick.addEventListener("click", () => import("./song-picker.js").then(({ openSongPicker }) => openSongPicker({ title: "A song for your story", onPick: (view, ref) => { song = view; songRef = ref; paintSong(); paintPanel(); } })));
      panel.replaceChildren(h("p", { class: "se-hint", text: "It plays while people watch your story (a photo with a song stays up 15 seconds)." }), h("div", { class: "se-row" }, pick,
        song ? chip("Remove", false, () => { song = null; songRef = null; paintSong(); paintPanel(); }, "danger") : null));
      if (song) import("./song-picker.js").then(({ songPill }) => panel.append(songPill(song, { key: "story-edit" })));
    } else {
      panel.replaceChildren(tagIn, h("p", { class: "se-hint", text: "Tagged people get told, and can add your story to theirs." }));
    }
  }
  function paintSong() {
    songTag.hidden = !song;
    if (song) songTag.replaceChildren(h("span", { class: "sv-song-eq" }, h("i"), h("i"), h("i")), h("b", { text: song.title }), h("span", { text: " · " + (song.artist?.name || "") }));
  }
  const tagsOf = () => [...new Set((tagIn.value.match(/@?[\w.]{2,30}/g) || []).map((x) => x.replace(/^@/, "").toLowerCase()))].slice(0, 10);

  const share = h("button", { type: "button", class: "btn btn-primary btn-full" }, h("span", { text: "Share to your story" }));
  let done = false;
  const md = modal({ title: "New story", wide: true, onClose: () => { import("./yt-audio.js").then((m) => m.stop()).catch(() => {}); if (!done) onClose?.(); },
    body: h("div", { class: "story-compose se" }, frame, h("div", { class: "se-tools" }, tabs, panel, share)) });
  share.addEventListener("click", async () => {
    share.disabled = true;
    share.querySelector("span").textContent = "Uploading…";
    const ok = await onShare({ edit: { ...edit, o: edit.o.map(({ ...o }) => o) }, songRef, text: caption.value, tags: tagsOf(), file: cropped }).catch((err) => { toast(err.error || "Couldn’t post the story."); return false; });
    if (ok) { done = true; md.close(); }
    else { share.disabled = false; share.querySelector("span").textContent = "Share to your story"; }
  });
  paintMedia(); paintLayer(); paintTabs();
  // Several photos picked at once: straight to the collage
  if (more.length && !isVideo) { tab = "collage"; paintTabs(); setTimeout(() => makeCollage(more), 200); }
}
