// Stories: the bar at the top of the feed, posting one, and the full-screen viewer.
import { h, icon, avatar, timeAgo, toast, modal, tick, swipeToReply } from "../ui.js";
import { api, upload } from "../api.js";
import { on, state } from "../state.js";
import { profileHref, navigate } from "../router.js";
import { inspectVideo } from "./media-picker.js";
import { openGifs, gifBody, closeGifs } from "./gifs.js";
import { openSoundPicker, closeSoundPicker, soundChip } from "./sounds.js";
import { attachMentions } from "./mentions.js";
import { mediaStyle, STORY_FONTS } from "../games/story-look.js";

/* ---------- A story's edits, drawn: filter + adjustments on the photo, text and emoji on top ---------- */
export function styleStoryMedia(el, edit) {
  const { filter, transform } = mediaStyle(edit);
  el.style.filter = filter || "";
  el.style.objectFit = edit?.m === "fit" ? "contain" : ""; // the whole photo, not cut to fill the story
  el.style.transform = transform === "translate(0%, 0%) rotate(0deg) scale(1)" ? "" : transform;
}
export function overlayEl(o) {
  // one of my stickers (a picture)
  if (o.k === "s") return h("div", { class: "so-item so-sticker", style: `left:${o.x}%;top:${o.y}%;--z:${o.z};--rot:${o.r || 0}deg` }, h("img", { src: o.v, alt: "", draggable: "false" }));
  const font = STORY_FONTS.find((f) => f[0] === o.f)?.[2];
  const el = h("div", { class: "so-item " + (o.k === "t" ? "so-text so-" + (o.s || "plain") : "so-emoji"),
    style: `left:${o.x}%;top:${o.y}%;--z:${o.z};--rot:${o.r || 0}deg;${o.k === "t" ? `--c:${o.c || "#fff"};font-family:${font || "inherit"}` : ""}` }, h("span", { text: o.v }));
  return el;
}
// Behind a photo that doesn't fill the story: the same photo, big and blurred (or a colour, set on the stage)
export function storyBack(edit, src) {
  const wanted = edit?.bg === "blur" || (edit?.m === "fit" && !edit?.bg);
  return wanted && src ? h("img", { class: "so-back", src, alt: "", "aria-hidden": "true", draggable: "false" }) : null;
}
export function storyLayer(edit) {
  return h("div", { class: "so-layer", "aria-hidden": "true" }, ...((edit?.o || []).map(overlayEl)));
}

const IMAGE_SECONDS = 5;
const REACTIONS = ["😂", "😮", "😍", "😢", "👏", "🔥", "❤️", "💯"];

/* ---------- Posting a story ---------- */
export async function addStory() {
  // (several photos at once: they go into a collage)
  const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm", multiple: true, hidden: true });
  document.body.append(input);
  const files = await new Promise((resolve) => { input.addEventListener("change", () => resolve([...input.files])); input.click(); });
  input.remove();
  const file = files[0];
  if (!file) return false;
  const morePhotos = file.type.startsWith("video/") ? [] : files.slice(1, 6).filter((f) => f.type.startsWith("image/")).map((f) => URL.createObjectURL(f));
  const isVideo = file.type.startsWith("video/");
  let info = null;
  if (isVideo) {
    info = await inspectVideo(file);
    if (!info || !Number.isFinite(info.duration)) { toast("We couldn’t read this video. Try an MP4."); return false; }
    if (info.duration > 60.5) { toast("Story videos can be up to 60 seconds."); return false; }
  }
  const url = URL.createObjectURL(file);
  // The editor: filters, adjustments, text, stickers, a song, tags
  const { openStoryEditor } = await import("./story-editor.js");
  return new Promise((resolve) => {
    openStoryEditor({ url, isVideo, more: morePhotos,
      onClose: () => { URL.revokeObjectURL(url); resolve(false); },
      onShare: async ({ edit, songRef, text, tags, file: cropped }) => {
        const pic = cropped || file; // (cropped with Crop & size)
        const check = import("./nsfw.js").then((m) => m.checkImage(isVideo ? info.posterBlob : pic)).catch(() => ({ nsfw: false }));
        const body = { media: { url: (await upload(pic)).url }, text, tags, edit, song: songRef };
        const found = (isVideo ? info.posterBlob : true) ? await check : {};
        // Weapons, violence… aren't allowed on LookBlog
        if (found.sensitive) throw { error: "This isn’t allowed on LookBlog. Violence, blood, weapons, self-harm and other disturbing content go against the LookBlog rules." };
        if (found.nsfw) body.media.nsfw = true; // 18+: blurred for others
        if (isVideo) {
          Object.assign(body.media, { duration: info.duration, width: info.width, height: info.height });
          if (info.posterBlob) body.media.poster = (await upload(new File([info.posterBlob], "cover.jpg", { type: "image/jpeg" }))).url;
        }
        await api("/api/stories", { method: "POST", body });
        URL.revokeObjectURL(url);
        resolve(true);
        toast("Your story is up for 24 hours.");
        return true;
      } });
  });
}

/* ---------- The viewer ---------- */
export function openStories(groups, startGroup = 0, onClosed, { comments: openComments = false } = {}) {
  let g = startGroup, i = 0, timer = null, started = 0, elapsed = 0, paused = false, closed = false;
  const bars = h("div", { class: "sv-bars" });
  const who = h("div", { class: "sv-who" });
  const stage = h("div", { class: "sv-stage" });
  const caption = h("div", { class: "story-caption" });
  const tagRow = h("div", { class: "sv-tags" });
  const foot = h("div", { class: "sv-foot" });
  const closeBtn = h("button", { type: "button", class: "sv-close", "aria-label": "Close" }, icon("close"));
  // A panel that slides up inside the story itself (comments, sharing): part of the story screen, not a window over the page
  let sheetOpen = null;
  function frameSheet({ title, body, onClose }) {
    sheetOpen?.close();
    const x = h("button", { type: "button", class: "sv-sheet-x", "aria-label": "Close" }, icon("close"));
    const grip = h("span", { class: "sv-sheet-grip", "aria-hidden": "true" });
    const el = h("div", { class: "sv-sheet", role: "dialog", "aria-label": title }, grip, h("div", { class: "sv-sheet-head" }, h("b", { text: title }), x), h("div", { class: "sv-sheet-body" }, body));
    // taps inside it don't move the story on
    for (const t of ["pointerdown", "pointerup", "click", "keydown"]) el.addEventListener(t, (e) => e.stopPropagation());
    let gone = false;
    const sheet = { el, close() { if (gone) return; gone = true; sheetOpen = null; el.classList.add("out"); setTimeout(() => el.remove(), 220); onClose?.(); } };
    x.addEventListener("click", () => sheet.close());
    // Pull it down to close it: by the grip or the title, or anywhere once the list is at its top
    const bodyEl = el.querySelector(".sv-sheet-body");
    let y0 = null, pulled = 0, how = "";
    const canPull = (t) => t.closest(".sv-sheet-grip, .sv-sheet-head") || (bodyEl.scrollTop <= 0 && !t.closest("input, textarea, .sc-type"));
    const pullStart = (y, t, kind) => { if (gone || !canPull(t)) return; y0 = y; pulled = 0; how = kind; };
    const pullMove = (y, e) => {
      if (y0 == null) return;
      const d = y - y0;
      if (!pulled && d < 6) { if (d < -6) y0 = null; return; } // moving up: it's a scroll
      pulled = Math.max(0, d);
      e.cancelable && e.preventDefault();
      el.classList.add("pulling");
      el.style.transform = `translateY(${pulled}px)`;
    };
    const pullEnd = () => {
      if (y0 == null) return;
      y0 = null; el.classList.remove("pulling");
      if (pulled > 6) { el.dataset.justPulled = "1"; setTimeout(() => delete el.dataset.justPulled, 50); }
      if (pulled > Math.min(110, el.offsetHeight * 0.25)) { el.style.transform = `translateY(${pulled}px)`; sheet.close(); } else el.style.transform = "";
      pulled = 0;
    };
    // fingers (touch events, so the list can still scroll when you aren't pulling)
    el.addEventListener("touchstart", (e) => pullStart(e.touches[0].clientY, e.target, "t"), { passive: true });
    el.addEventListener("touchmove", (e) => how === "t" && pullMove(e.touches[0].clientY, e), { passive: false });
    el.addEventListener("touchend", () => how === "t" && pullEnd());
    el.addEventListener("touchcancel", () => how === "t" && pullEnd());
    // a mouse
    el.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" && e.button === 0) pullStart(e.clientY, e.target, "m"); });
    const mMove = (e) => how === "m" && pullMove(e.clientY, e), mUp = () => how === "m" && pullEnd();
    addEventListener("pointermove", mMove, true);
    addEventListener("pointerup", mUp, true);
    el.addEventListener("animationend", () => { if (gone) { removeEventListener("pointermove", mMove, true); removeEventListener("pointerup", mUp, true); } });
    // (a pull isn't a click on what's under it)
    el.addEventListener("click", (e) => { if (el.dataset.justPulled) { e.preventDefault(); e.stopPropagation(); } }, true);
    frame.append(el);
    sheetOpen = sheet;
    return sheet;
  }
  // Pick a sound to send (the story waits while the list is open)
  function pickStorySound(anchor, onPick, stop = true) {
    if (stop) pause(true);
    let picked = false;
    openSoundPicker(anchor, { builtin: true, onPick: (b) => { picked = true; if (stop) pause(false); onPick(b); } });
    // (closed without picking: go on)
    const watch = setInterval(() => { if (!document.querySelector(".snd-panel")) { clearInterval(watch); if (stop && !picked && !closed && !sheetOpen) pause(false); } }, 300);
  }
  // A photo from a comment, big, over the story (tap or Esc to close it)
  function seePhoto(url) {
    const el = h("div", { class: "sv-photo-view", role: "dialog", "aria-label": "Photo" }, h("img", { src: url, alt: "Photo" }), h("button", { type: "button", class: "sv-sheet-x", "aria-label": "Close" }, icon("close")));
    for (const t of ["pointerdown", "pointerup", "keydown"]) el.addEventListener(t, (e) => e.stopPropagation());
    const shut = () => { el.remove(); removeEventListener("keydown", esc, true); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); shut(); } };
    el.addEventListener("click", (e) => { e.stopPropagation(); shut(); });
    addEventListener("keydown", esc, true);
    frame.append(el);
  }
  // Share it: a link (works outside LookBlog too) or as a card in a chat. In a highlight, the whole highlight.
  const shareBtn = h("button", { type: "button", class: "sv-close sv-share", "aria-label": "Share", title: "Share" }, icon("send"));
  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = story(), gr = group();
    if (!s) return;
    pause(true);
    const hl = gr.highlight;
    import("./share.js").then(({ shareLinkBody }) => {
      const o = hl
        ? { title: "Share this highlight", url: `${location.origin}/highlight/${hl.id}`, text: `${hl.title || "Highlight"} · @${gr.user.username}`, chatBody: { highlightId: hl.id }, onShared: () => toast("Shared.") }
        : { title: "Share this story", url: `${location.origin}/story/${s.id}`, text: `@${gr.user.username}’s story`, chatBody: { storyId: s.id }, onShared: () => toast("Shared.") };
      frameSheet({ title: o.title, body: shareLinkBody(o), onClose: () => { if (!closed) pause(false); } });
    });
  });
  // ⚑ Report someone else's story
  const reportBtn = h("button", { type: "button", class: "sv-close sv-report", "aria-label": "Report this story", title: "Report" }, icon("flag"));
  reportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = story();
    if (!s || s.mine) return;
    pause(true);
    import("./report.js").then((m) => m.openReportContent({ what: "story", url: `/api/stories/${s.id}/report`, onClose: () => { if (!closed) pause(false); } }));
  });
  const prevZone = h("button", { type: "button", class: "sv-zone left", "aria-label": "Previous" });
  const nextZone = h("button", { type: "button", class: "sv-zone right", "aria-label": "Next" });
  const frame = h("div", { class: "story-frame" }, stage, caption, tagRow, prevZone, nextZone, h("div", { class: "sv-top" }, bars, h("div", { class: "sv-head" }, who, h("div", { class: "sv-head-btns" }, reportBtn, shareBtn, closeBtn))), foot);
  const box = h("div", { class: "story-viewer", role: "dialog", "aria-modal": "true", "aria-label": "Story" }, frame);
  document.body.append(box);
  document.body.classList.add("no-scroll");
  requestAnimationFrame(() => box.classList.add("open"));

  const group = () => groups[g];
  const story = () => group()?.stories[i];
  let video = null;

  // (a photo with a song stays up longer, like on Instagram)
  function duration() { return story()?.media.kind === "video" ? Math.min(60, story().media.duration || video?.duration || 15) : story()?.song ? 15 : IMAGE_SECONDS; }
  // The story's song: plays while it's on screen (a YouTube one as sound only), with its name on the story
  let songAudio = null, songYt = null, songCheck = 0;
  const songTag = h("div", { class: "sv-song", hidden: true });
  // When the browser won't start the sound by itself: it starts on the first touch of the story (no button on it)
  let wantSound = false;
  const startSound = () => {
    if (!wantSound) return;
    wantSound = false;
    if (paused) return;
    if (songAudio) songAudio.play().catch(() => {});
    else if (songYt) { const k = songYt; import("./yt-audio.js").then((m) => { if (songYt === k && !m.ytIsPlaying(k.yt, k.key)) m.ytToggle(k.yt, { anchor: frame }, k.key); }); }
  };
  frame.addEventListener("pointerup", startSound, true);
  frame.addEventListener("keydown", startSound, true);
  frame.append(songTag);
  function stopStorySong() {
    clearTimeout(songCheck); wantSound = false;
    songAudio?.pause(); songAudio = null;
    if (songYt) { const k = songYt; songYt = null; import("./yt-audio.js").then((m) => { if (m.ytIsPlaying(k.yt, k.key)) m.stop(); }); }
    songTag.hidden = true;
  }
  // Tap the song's name: what's playing (cover, name, artist), with a way to stop it and find it
  songTag.setAttribute("role", "button");
  songTag.tabIndex = 0;
  songTag.setAttribute("aria-label", "What song is this?");
  const songNow = () => songAudio ? !songAudio.paused : songYt ? import("./yt-audio.js").then((m) => songYt && m.ytIsPlaying(songYt.yt, songYt.key)) : false;
  async function showSong(e) {
    e?.stopPropagation();
    const s = story();
    if (!s?.song) return;
    const sg = s.song;
    holdTime(true); // the story waits; the song keeps playing
    const toggle = h("button", { type: "button", class: "btn btn-primary sv-song-play" });
    const paint = async () => { const on = await songNow(); toggle.replaceChildren(h("span", { text: on ? "⏸" : "▶" }), h("span", { text: on ? " Pause the song" : " Play the song" })); };
    toggle.addEventListener("click", async () => {
      if (songAudio) { if (songAudio.paused) songAudio.play().catch(() => {}); else songAudio.pause(); }
      else if (songYt) { const m = await import("./yt-audio.js"); m.ytToggle(songYt.yt, { anchor: frame }, songYt.key); await new Promise((r) => setTimeout(r, 400)); }
      wantSound = false;
      paint();
    });
    const links = [];
    if (sg.kind === "youtube") links.push(h("a", { class: "btn btn-outline-light", href: `https://www.youtube.com/watch?v=${encodeURIComponent(sg.yt)}`, target: "_blank", rel: "noopener noreferrer" }, "▶️ Open on YouTube"));
    else if (sg.kind !== "file" && sg.artist?.username) {
      links.push(h("a", { class: "btn btn-outline-light", href: profileHref(sg.artist.username), onclick: () => close() }, "👤 " + sg.artist.name));
      if (sg.albumId) links.push(h("a", { class: "btn btn-outline-light", href: `/album/${sg.albumId}`, onclick: () => close() }, "💿 " + (sg.album || "Album")));
    }
    const body = h("div", { class: "sv-song-info" },
      sg.cover ? h("img", { class: "sv-song-cover", src: sg.cover, alt: "" }) : h("div", { class: "sv-song-cover none", text: "🎵" }),
      h("div", { class: "sv-song-what" },
        h("small", { class: "sv-song-label" }, h("span", { class: "sv-song-eq" }, h("i"), h("i"), h("i")), " Song on this story"),
        h("b", { class: "sv-song-title", text: sg.title || "A song" }),
        h("span", { class: "sv-song-artist", text: [sg.artist?.name, sg.feat ? "feat. " + sg.feat : ""].filter(Boolean).join(" ") + (sg.kind === "file" ? " · their own sound" : sg.kind === "youtube" ? " · YouTube" : "") }),
        sg.album ? h("span", { class: "sv-song-album muted", text: sg.album }) : null),
      h("div", { class: "sv-song-btns" }, toggle, ...links));
    paint();
    frameSheet({ title: "Song", body, onClose: () => { if (!closed) holdTime(false); } });
  }
  songTag.addEventListener("click", showSong);
  songTag.addEventListener("pointerdown", (e) => e.stopPropagation());
  songTag.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showSong(e); } });
  function playStorySong(s) {
    stopStorySong();
    if (!s.song) return;
    songTag.replaceChildren(h("span", { class: "sv-song-eq" }, h("i"), h("i"), h("i")), h("b", { text: s.song.title }), h("span", { text: " · " + (s.song.artist?.name || "") }));
    songTag.hidden = false;
    if (s.song.kind === "youtube") {
      songYt = { yt: s.song.yt, key: "story-" + s.id };
      import("./yt-audio.js").then((m) => {
        if (songYt?.key !== "story-" + s.id) return;
        m.ytToggle(s.song.yt, { title: s.song.title, artist: s.song.artist?.name, anchor: frame }, "story-" + s.id);
        // not playing after a moment: the browser wants a tap first
        songCheck = setTimeout(() => { if (songYt?.key === "story-" + s.id && !m.ytIsPlaying(s.song.yt, songYt.key)) wantSound = true; }, 2500);
      });
    } else if (s.song.url) {
      songAudio = new Audio(s.song.url); songAudio.loop = true;
      songAudio.play().catch(() => { if (songAudio) wantSound = true; });
    }
  }
  function paintBars(progress = 0) {
    const n = group().stories.length;
    if (bars.children.length !== n) bars.replaceChildren(...group().stories.map(() => h("span", {}, h("i"))));
    [...bars.children].forEach((b, k) => (b.firstChild.style.width = k < i ? "100%" : k === i ? progress * 100 + "%" : "0%"));
  }
  function tickTime() {
    if (closed) return;
    const p = Math.min(1, (elapsed + (paused ? 0 : performance.now() - started)) / 1000 / duration());
    paintBars(p);
    if (p >= 1) return next();
    timer = requestAnimationFrame(tickTime);
  }
  function show() {
    cancelAnimationFrame(timer);
    const s = story();
    if (!s) return close();
    reportBtn.hidden = Boolean(s.mine);
    elapsed = 0; started = performance.now(); paused = false;
    const u = group().user;
    who.replaceChildren(h("a", { href: profileHref(u.username), onclick: (e) => { e.preventDefault(); close(); navigate(profileHref(u.username)); } }, avatar(u, 34)),
      h("b", {}, u.name, tick(u, 14)), group().highlight ? h("span", { class: "sv-hl", text: group().highlight.title }) : null, h("span", { class: "muted", text: timeAgo(s.createdAt) }));
    video?.pause();
    video = null;
    if (s.media.kind === "video") {
      video = h("video", { src: s.media.url, poster: s.media.poster || null, autoplay: true, playsInline: true });
      video.addEventListener("waiting", () => { if (!paused) pause(true); });
      video.addEventListener("playing", () => { if (paused && !holding) pause(false); });
      stage.replaceChildren(video);
      if (s.song) video.muted = true; // the song plays instead
      video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
    } else {
      stage.replaceChildren(h("img", { src: s.media.url, alt: "" }));
    }
    // Its edits: filter, light, position; text and emoji on top; a background colour around it
    styleStoryMedia(stage.firstElementChild, s.edit);
    stage.style.background = s.edit?.bg && s.edit.bg !== "blur" ? s.edit.bg : "";
    const back = storyBack(s.edit, s.media.kind === "video" ? s.media.poster : s.media.url);
    if (back) stage.prepend(back);
    if (s.edit?.o?.length) stage.append(storyLayer(s.edit));
    paintStuck(s);
    playStorySong(s);
    // Sensitive (18+): blurred until you tap "View"
    const warnNsfw = s.media.nsfw && !state.me.showNsfw, warnSens = s.media.sensitive && !state.me.showSensitive;
    if ((warnNsfw || warnSens) && !s.mine) {
      stage.classList.add("nsfw-on");
      video?.pause();
      const cover = h("div", { class: "nsfw-cover sv-nsfw" }, h("b", { text: warnNsfw ? "🔞 Sensitive content (18+)" : "⚠️ Sensitive content" }),
        h("span", { text: warnNsfw ? "This story may show nudity or other 18+ things." : "This story may show violence, blood, weapons or other disturbing things." }),
        h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "View story", onclick: (e) => { e.stopPropagation(); stage.classList.remove("nsfw-on"); cover.remove(); video?.play().catch(() => {}); } }));
      stage.append(cover);
    } else stage.classList.remove("nsfw-on");
    caption.textContent = s.text || "";
    caption.hidden = !s.text;
    // Tagged people (tap to see their profile)
    tagRow.replaceChildren(...(s.tags || []).map((t) => h("a", { class: "sv-tag", href: profileHref(t.username), text: "@" + t.username,
      onclick: (e) => { e.preventDefault(); close(); navigate(profileHref(t.username)); } })));
    if (s.repostOf) who.append(h("a", { class: "sv-repost", href: profileHref(s.repostOf.username), text: "🔁 @" + s.repostOf.username,
      onclick: (e) => { e.preventDefault(); close(); navigate(profileHref(s.repostOf.username)); } }));
    paintFoot(s);
    paintCommentsOnStory(s);
    frame.style.setProperty("--foot-h", foot.offsetHeight + "px");
    if (!s.mine && !s.seen) { s.seen = true; api(`/api/stories/${s.id}/view`, { method: "POST" }).catch(() => {}); }
    group().unseen = group().stories.some((x) => !x.seen);
    paintBars(0);
    timer = requestAnimationFrame(tickTime);
  }
  const onStoryOf = (c) => ({ id: c.id, name: c.author.name, username: c.author.username, avatar: c.author.avatar, text: c.text || (c.gif ? "GIF" : c.image ? "📷 Photo" : c.sound ? `${c.sound.emoji || "🔊"} ${c.sound.name || "Sound"}` : ""), sticker: c.sticker || null, image: c.image?.url || c.image || null, reply: Boolean(c.parentId), byOwner: c.byOwner });
  // A new comment pops up on the story: the commenter's photo and their words (like Instagram)
  function popComment(c) {
    if (!c) return;
    const el = h("div", { class: "sv-pop", "aria-live": "polite" }, avatar(c, 40), h("div", { class: "sv-pop-text" }, h("b", { text: c.mine ? "You commented" : `${c.name} commented` }), c.text ? h("span", { text: c.text }) : null),
      c.sticker ? h("img", { class: "sv-pop-sticker", src: c.sticker, alt: "Sticker" }) : null,
      c.image ? h("img", { class: "sv-pop-sticker sv-cmt-photo", src: c.image, alt: "Photo" }) : null);
    frame.append(el);
    setTimeout(() => el.remove(), 3200);
  }
  // The newest comments float on the story itself (tap them to see all and write one)
  const onStory = h("button", { type: "button", class: "sv-cmts", "aria-label": "Comments" });
  frame.append(onStory);
  // When there are more, they scroll: drag up or down (or use the wheel / a finger) and the comments move, not the box.
  // A tap opens all the comments.
  let cmtDrag = null, dragged = false;
  onStory.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (e.pointerType !== "mouse") return; // a finger scrolls it natively
    cmtDrag = { y: e.clientY, top: onStory.scrollTop }; dragged = false;
  });
  onStory.addEventListener("pointermove", (e) => {
    if (!cmtDrag) return;
    const dy = e.clientY - cmtDrag.y;
    if (!dragged && Math.abs(dy) < 5) return;
    if (!dragged) { dragged = true; pause(true); onStory.classList.add("dragging"); try { onStory.setPointerCapture(e.pointerId); } catch {} }
    onStory.scrollTop = cmtDrag.top - dy;
  });
  const dropCmts = () => { if (!cmtDrag) return; cmtDrag = null; if (dragged) { onStory.classList.remove("dragging"); pause(false); } };
  onStory.addEventListener("pointerup", dropCmts);
  onStory.addEventListener("pointercancel", dropCmts);
  // (a finger scrolling it pauses the story while it moves)
  let scrollPause = 0;
  onStory.addEventListener("scroll", () => { if (cmtDrag) return; pause(true); clearTimeout(scrollPause); scrollPause = setTimeout(() => pause(false), 700); }, { passive: true });
  onStory.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  onStory.addEventListener("click", (e) => { e.stopPropagation(); if (dragged) { dragged = false; return; } const s = story(); if (s) showComments(s); });
  function paintCommentsOnStory(s) {
    const list = s.latestComments || [];
    onStory.hidden = false; // (with no comments yet: just "Add a comment")
    onStory.classList.toggle("empty", !list.length);
    onStory.replaceChildren(...list.map((c) => h("div", { class: "sv-cmt" + (c.reply ? " reply" : "") }, avatar(c, 28),
      h("div", { class: "sv-cmt-text" }, h("b", { text: c.name + (c.byOwner ? " · Author" : "") }), c.text ? h("span", { text: c.text }) : null),
      c.sticker ? h("img", { class: "sv-cmt-sticker", src: c.sticker, alt: "" }) : null,
      c.image ? h("img", { class: "sv-cmt-sticker sv-cmt-photo", src: c.image, alt: "" }) : null)),
      h("small", { class: "sv-cmt-more", text: s.comments > list.length ? `💬 View all ${s.comments} comments` : "💬 Add a comment" }));
    requestAnimationFrame(() => { onStory.scrollTop = onStory.scrollHeight; }); // the newest at the bottom
    frame.style.setProperty("--foot-h", foot.offsetHeight + "px");
    // (above the story's own words, if it has some)
    requestAnimationFrame(() => {
      const fr = frame.getBoundingClientRect(), cap = caption.textContent.trim() ? caption.getBoundingClientRect() : null;
      onStory.style.bottom = cap && cap.height ? `${Math.round(fr.bottom - cap.top + 8)}px` : "";
    });
  }
  // Stickers stuck on the story (by anyone watching): on a free spot, a little turned. Tap one of yours twice
  // (or any, on your own story) to take it off.
  const stuckLayer = h("div", { class: "st-stuck" });
  frame.append(stuckLayer); // (above the tap zones, so a sticker can be tapped)
  function paintStuck(s) {
    stuckLayer.replaceChildren(...(s.stuck || []).map((x) => {
      const canOff = s.mine; // (only the author changes the stickers on their story)
      const img = h("img", { class: "st-item" + (canOff ? " movable" : ""), src: x.url, alt: "Sticker", draggable: "false", title: `Sticker from @${x.by}${canOff ? " · drag to move it, tap twice to take it off" : ""}`, style: `left:${x.x}%;top:${x.y}%;--rot:${x.rot}deg` });
      // Drag it somewhere else on the story
      let mv = null, moved = false;
      img.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (!canOff) return;
        e.preventDefault();
        mv = { sx: e.clientX, sy: e.clientY, x: x.x, y: x.y }; moved = false;
        try { img.setPointerCapture(e.pointerId); } catch {}
      });
      img.addEventListener("pointermove", (e) => {
        if (!mv) return;
        const fr = frame.getBoundingClientRect(), dx = e.clientX - mv.sx, dy = e.clientY - mv.sy;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        if (!moved) { moved = true; pause(true); img.classList.add("moving"); img.classList.remove("armed"); }
        x.x = Math.max(3, Math.min(97, mv.x + (dx / fr.width) * 100));
        x.y = Math.max(5, Math.min(95, mv.y + (dy / fr.height) * 100));
        img.style.left = x.x + "%"; img.style.top = x.y + "%";
      });
      const drop = async () => {
        if (!mv) return;
        mv = null;
        if (!moved) return;
        img.classList.remove("moving");
        pause(false);
        try { await api(`/api/stories/${s.id}/stick`, { method: "POST", body: { move: x.id, x: x.x, y: x.y } }); } catch (err) { toast(err.error || "Couldn’t move it."); }
      };
      img.addEventListener("pointerup", drop);
      img.addEventListener("pointercancel", drop);
      img.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (moved) { moved = false; return; } // (that was a drag)
        if (!canOff) return;
        if (!img.classList.contains("armed")) { img.classList.add("armed"); pause(true); setTimeout(() => img.classList.remove("armed"), 2500); return; }
        try { s.stuck = (await api(`/api/stories/${s.id}/stick`, { method: "POST", body: { remove: x.id } })).stuck; paintStuck(s); pause(false); } catch (err) { toast(err.error || "Couldn’t take it off."); }
      });
      return img;
    }));
  }
  function stickBtn(s) {
    const b = h("button", { type: "button", class: "sv-pill sv-stick-btn", title: "Stick a sticker on it", "aria-label": "Stick a sticker" }, h("span", { text: "🏷️" }));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      pause(true);
      import("./stickers.js").then(({ openStickers }) => openStickers(b, async (st) => {
        try {
          const r = await api(`/api/stories/${s.id}/stick`, { method: "POST", body: { sticker: st.id, x: 20 + Math.random() * 60, y: 22 + Math.random() * 45, rot: Math.round(Math.random() * 40 - 20) } });
          s.stuck = r.stuck; paintStuck(s);
          stuckLayer.lastElementChild?.classList.add("just");
        } catch (err) { toast(err.error || "Couldn’t stick it."); }
        pause(false);
      }));
    });
    return b;
  }
  // Comments: they stay on the story; everyone who can see it sees them
  function commentsBtn(s, round = false) {
    const b = h("button", { type: "button", class: round ? "sv-gif sv-comments-btn sv-cmt-round" : "sv-pill sv-comments-btn", title: "Comments", "aria-label": "Comments" }, icon("comment"), h("span", { class: "sv-cc", text: s.comments ? String(s.comments) : "" }));
    b.classList.toggle("has", !!s.comments);
    b.addEventListener("click", () => showComments(s));
    return b;
  }
  function showComments(s) {
    pause(true);
    const list = h("div", { class: "sc-list" }, h("p", { class: "muted", text: "Loading…" }));
    const input = h("input", { type: "text", class: "text-input sc-input", placeholder: s.mine ? "Add a comment…" : `Comment on ${group().user.name.split(" ")[0]}’s story…`, maxlength: 500 });
    const send = h("button", { type: "button", class: "btn btn-primary sc-send", text: "Post", disabled: true });
    const gifBtn = h("button", { type: "button", class: "sv-gif sc-gif", title: "GIF", "aria-label": "Comment with a GIF" }, h("span", { text: "GIF" }));
    const emojiBtn = h("button", { type: "button", class: "sv-gif sc-gif sc-emoji", title: "Emoji", "aria-label": "Emoji" }, h("span", { text: "🙂" }), h("small", { text: "Emoji" }));
    const stickBtn = h("button", { type: "button", class: "sv-gif sc-gif sc-stick", title: "Send a sticker", "aria-label": "Comment with a sticker" }, h("span", { text: "🏷️" }), h("small", { text: "Sticker" }));
    // A photo: pick one, see it above the box (with words too, if you like), then Post
    const photoBtn = h("button", { type: "button", class: "sv-gif sc-gif sc-photo", title: "Photo", "aria-label": "Comment with a photo" }, h("span", { text: "📷" }), h("small", { text: "Photo" }));
    const photoBar = h("div", { class: "sc-photo-pick", hidden: true });
    let photo = null;
    const ready = () => Boolean(input.value.trim() || photo);
    const setPhoto = (p) => {
      photo = p;
      photoBar.hidden = !p;
      photoBar.replaceChildren(...(p ? [h("img", { src: p.preview, alt: "" }), h("span", { class: "muted", text: p.url ? "Photo ready — add words if you like" : "Uploading…" }),
        h("button", { type: "button", class: "sc-reply-x", "aria-label": "Remove the photo", text: "✕", onclick: () => setPhoto(null) })] : []));
      send.disabled = !ready() || (p && !p.url);
    };
    photoBtn.addEventListener("click", () => {
      const f = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
      f.addEventListener("change", async () => {
        const file = f.files[0];
        f.remove();
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) return toast("Pictures can be up to 8 MB.");
        const p = { preview: URL.createObjectURL(file) };
        setPhoto(p);
        const size = await new Promise((r) => { const im = new Image(); im.onload = () => r({ width: im.naturalWidth, height: im.naturalHeight }); im.onerror = () => r({}); im.src = p.preview; });
        try { const { url } = await upload(file); if (photo !== p) return; setPhoto({ ...p, ...size, url }); input.focus(); }
        catch (err) { if (photo === p) setPhoto(null); toast(err.error || "Couldn’t upload the photo."); }
      });
      document.body.append(f);
      f.click();
    });
    const soundBtn = h("button", { type: "button", class: "sv-gif sc-gif sc-sound", title: "Sound", "aria-label": "Comment with a sound" }, h("span", { text: "🔊" }), h("small", { text: "Sound" }));
    soundBtn.addEventListener("click", () => pickStorySound(soundBtn, (b) => post(b), false));
    stickBtn.addEventListener("click", () => import("./stickers.js").then(({ openStickers }) => openStickers(stickBtn, (st) => post({ text: input.value, sticker: st.id }))));
    // Answering a comment: a bar above the box ("Replying to @…  ✕")
    let replyTo = null;
    const replyBar = h("div", { class: "sc-replying", hidden: true });
    const setReply = (c) => {
      replyTo = c;
      replyBar.hidden = !c;
      if (c) replyBar.replaceChildren(h("span", { text: "↩ Replying to " }), h("b", { text: "@" + c.author.username }), h("button", { type: "button", class: "sc-reply-x", "aria-label": "Cancel", text: "✕", onclick: () => setReply(null) }));
      input.placeholder = c ? `Reply to ${c.author.name.split(" ")[0]}…` : s.mine ? "Add a comment…" : `Comment on ${group().user.name.split(" ")[0]}’s story…`;
      if (c) input.focus();
    };
    const row = (c, isReply) => {
      const like = h("button", { type: "button", class: "sc-like" + (c.liked ? " on" : ""), "aria-label": "Like" }, h("span", { text: c.liked ? "❤️" : "🤍" }), h("small", { text: c.likes ? String(c.likes) : "" }));
      like.addEventListener("click", async () => {
        try { const r = await api(`/api/stories/${s.id}/comments/${c.id}/like`, { method: "POST" }); c.liked = r.liked; c.likes = r.likes; like.classList.toggle("on", r.liked); like.querySelector("span").textContent = r.liked ? "❤️" : "🤍"; like.querySelector("small").textContent = r.likes ? String(r.likes) : ""; } catch {}
      });
      const del = c.canDelete ? h("button", { type: "button", class: "sc-act sc-del-link", text: "Delete" }) : null;
      del?.addEventListener("click", async () => {
        if (!del.dataset.sure) { del.dataset.sure = "1"; del.textContent = "Delete?"; del.classList.add("sure"); return; }
        try { paintList((await api(`/api/stories/${s.id}/comments/${c.id}`, { method: "DELETE" })).comments); } catch (err) { toast(err.error || "Couldn’t delete it."); }
      });
      const reply = h("button", { type: "button", class: "sc-act", text: "Reply", onclick: () => setReply(c) });
      const rep = c.mine ? null : h("button", { type: "button", class: "sc-act", text: "Report", onclick: () => import("./report.js").then((m) => m.openReportContent({ what: "comment", url: `/api/stories/${s.id}/comments/${c.id}/report`, quote: c.text || "" })) });
      const el = h("div", { class: "sc-row" + (isReply ? " sc-reply" : "") + (c.mine ? " mine" : "") },
        h("a", { href: profileHref(c.author.username), class: "sc-av" }, avatar(c.author, isReply ? 28 : 36)),
        h("div", { class: "sc-body" },
          h("div", { class: "sc-bubble" },
            h("div", { class: "sc-head" }, h("b", {}, c.author.name, tick(c.author, 13)), c.byOwner ? h("span", { class: "sc-owner", text: "Author" }) : null),
            c.text ? h("p", { class: "sc-text", text: c.text }) : null,
            c.gif ? h("img", { class: "sc-gif-img", src: c.gif.url, alt: "GIF", loading: "lazy" }) : null,
            c.sticker ? h("img", { class: "sc-sticker", src: c.sticker, alt: "Sticker", loading: "lazy" }) : null,
          c.sound ? h("div", { class: "sc-sound-msg" }, soundChip(c.sound)) : null,
          c.image ? h("button", { type: "button", class: "sc-photo-btn", "aria-label": "See the photo", onclick: () => seePhoto(c.image.url) }, h("img", { class: "sc-photo-img", src: c.image.url, alt: "Photo", loading: "lazy", width: c.image.width || undefined, height: c.image.height || undefined })) : null),
          h("div", { class: "sc-meta" }, h("small", { class: "muted", text: timeAgo(c.at) }), reply, del, rep)),
        like);
      swipeToReply(el, () => setReply(c)); // swipe right to answer
      return el;
    };
    const paintList = (comments) => {
      s.comments = comments.length;
      s.latestComments = comments.slice(-30).map(onStoryOf);
      if (story() === s) paintCommentsOnStory(s);
      frame.querySelectorAll(".sv-cc").forEach((x) => { x.textContent = comments.length ? String(comments.length) : ""; x.parentElement.classList.toggle("has", !!comments.length); });
      // Each comment, with its answers under it
      const tops = comments.filter((c) => !c.parentId || !comments.some((x) => x.id === c.parentId));
      list.replaceChildren(...(tops.length ? tops.flatMap((c) => [row(c, false), ...comments.filter((x) => x.parentId === c.id).map((x) => row(x, true))])
        : [h("div", { class: "sc-empty" }, h("span", { text: "💬" }), h("b", { text: "No comments yet" }), h("small", { class: "muted", text: "Be the first to say something." }))]));
      list.scrollTop = list.scrollHeight;
    };
    const post = async (body) => {
      send.disabled = true;
      try {
        const { comments } = await api(`/api/stories/${s.id}/comments`, { method: "POST", body: { ...body, parentId: replyTo?.id || null } });
        paintList(comments); input.value = ""; setPhoto(null);
        const answered = Boolean(replyTo);
        setReply(null);
        // A new comment: back to the story, where it pops up with my photo (an answer stays here, in the list)
        const c = comments.filter((x) => x.mine).slice(-1)[0];
        if (!answered) { md.close(); if (c) setTimeout(() => popComment({ ...onStoryOf(c), mine: true }), 150); }
      } catch (err) { toast(err.error || "Couldn’t post it."); }
      send.disabled = !ready();
    };
    const withPhoto = () => ({ text: input.value, ...(photo?.url ? { image: { url: photo.url, width: photo.width, height: photo.height } } : {}) });
    input.addEventListener("input", () => { send.disabled = !ready() || (photo && !photo.url); });
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && ready() && !(photo && !photo.url)) post(withPhoto()); });
    send.addEventListener("click", () => ready() && post(withPhoto()));
    gifBtn.addEventListener("click", () => openGifs(gifBtn, (gf) => post({ text: input.value, ...gifBody(gf) })));
    emojiBtn.addEventListener("click", () => import("./emoji.js").then(({ openEmojiPicker }) => openEmojiPicker(emojiBtn, (e) => {
      const at = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? at;
      input.value = input.value.slice(0, at) + e + input.value.slice(end);
      input.focus(); input.setSelectionRange(at + e.length, at + e.length);
      send.disabled = !ready() || (photo && !photo.url);
    })));
    const md = frameSheet({ title: `Comments${s.comments ? ` · ${s.comments}` : ""}`, onClose: () => { closeGifs(); closeSoundPicker(); import("./emoji.js").then((m) => m.closeEmojiPicker?.()).catch(() => {}); import("./stickers.js").then((m) => m.closeStickers?.()).catch(() => {}); offC(); if (!closed) pause(false); },
      body: h("div", { class: "sc-sheet" }, list, replyBar, h("div", { class: "sc-compose" }, photoBar, h("div", { class: "sc-type" }, input, send), h("div", { class: "sc-extras" }, photoBtn, soundBtn, emojiBtn, stickBtn, gifBtn))) });
    const load = () => api(`/api/stories/${s.id}/comments`).then((r) => paintList(r.comments)).catch(() => list.replaceChildren(h("p", { class: "muted", text: "Couldn’t load the comments." })));
    const offC = on("story:comments", (ev) => { if (ev.id === s.id) load(); });
    load();
    setTimeout(() => input.focus(), 80);
    return md;
  }
  function paintFoot(s) {
    if (s.mine) {
      const viewersBtn = h("button", { type: "button", class: "sv-pill" }, icon("eye"), h("span", { text: `${s.viewers.length} ${s.viewers.length === 1 ? "viewer" : "viewers"}` }));
      viewersBtn.addEventListener("click", () => {
        pause(true);
        const list = h("div", { class: "conn-list" }, h("p", { class: "muted", text: "Loading…" }));
        modal({ title: "Seen by", onClose: () => pause(false), body: list });
        // Fetch fresh, so people who watched since you opened it show up too
        api(`/api/stories/user/${encodeURIComponent(group().user.username)}`).then(({ group: fresh }) => {
          const st = fresh.stories.find((x) => x.id === s.id) || s;
          s.viewers = st.viewers || [];
          viewersBtn.querySelector("span").textContent = `${s.viewers.length} ${s.viewers.length === 1 ? "viewer" : "viewers"}`;
          list.replaceChildren(...(s.viewers.length
            ? [h("p", { class: "muted seen-count", text: `${s.viewers.length} ${s.viewers.length === 1 ? "person" : "people"} watched this story` }),
               ...s.viewers.map((v) => h("div", { class: "conn-row" }, avatar(v, 40), h("div", { class: "who" }, h("b", {}, v.name, tick(v, 14)), h("span", { class: "muted", text: "@" + v.username + " · " + timeAgo(v.at) })), v.reaction ? h("span", { class: "sv-viewer-react", title: "Their reaction", text: v.reaction }) : null))]
            : [h("p", { class: "muted", text: "Nobody has watched it yet." })]));
        }).catch(() => list.replaceChildren(h("p", { class: "muted", text: "Couldn’t load the list." })));
      });
      const del = h("button", { type: "button", class: "sv-pill" }, icon("trash"), h("span", { text: "Delete" }));
      del.addEventListener("click", async () => {
        try {
          await api(`/api/stories/${s.id}`, { method: "DELETE" });
          group().stories.splice(i, 1);
          toast("Story deleted.");
          if (!group().stories.length) return nextGroup();
          if (i >= group().stories.length) i = group().stories.length - 1;
          bars.replaceChildren();
          show();
        } catch (err) { toast(err.error || "Couldn’t delete it."); }
      });
      // Keep it on my profile: add it to a highlight
      const hlBtn = h("button", { type: "button", class: "sv-pill" }, h("span", { class: "sv-hl-ic", text: "♡" }), h("span", { text: "Highlight" }));
      hlBtn.addEventListener("click", () => {
        pause(true);
        import("./highlights.js").then((mod) => mod.addToHighlight(s, state.me));
      });
      const editHl = group().highlight ? h("button", { type: "button", class: "sv-pill" }, h("span", { text: "✏️ Edit highlight" })) : null;
      editHl?.addEventListener("click", () => {
        close();
        import("./highlights.js").then((mod) => mod.openHighlightEditor({ highlight: group().highlight, onDone: onClosed }));
      });
      foot.replaceChildren(viewersBtn, commentsBtn(s), hlBtn, ...(editHl ? [editHl] : []), del);
    } else {
      // Quick reactions (tap the same one again to take it back)
      const reacts = h("div", { class: "sv-reacts" }, ...REACTIONS.map((e) => {
        const b = h("button", { type: "button", class: "sv-react" + (s.myReaction === e ? " on" : ""), text: e, "aria-label": `React ${e}` });
        b.addEventListener("click", async () => {
          b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
          try {
            const r = await api(`/api/stories/${s.id}/react`, { method: "POST", body: { emoji: e } });
            s.myReaction = r.myReaction;
            reacts.querySelectorAll(".sv-react").forEach((x) => x.classList.toggle("on", x.textContent === s.myReaction));
            if (r.myReaction) floatUp(e);
          } catch (err) { toast(err.error || "Couldn’t react."); }
        });
        return b;
      }));
      const input = h("input", { type: "text", class: "sv-reply", placeholder: `Message ${group().user.name.split(" ")[0]}…`, title: "A private message (only they see it)", maxlength: 1000 });
      const send = h("button", { type: "button", class: "sv-send", "aria-label": "Send", disabled: true }, icon("send"));
      input.addEventListener("focus", () => pause(true));
      input.addEventListener("blur", () => pause(false));
      input.addEventListener("input", () => { send.disabled = !input.value.trim(); });
      const sendReply = async () => {
        if (!input.value.trim()) return;
        send.disabled = true;
        try {
          const r = await api(`/api/stories/${s.id}/reply`, { method: "POST", body: { text: input.value } });
          input.value = "";
          input.blur();
          toast(r.sent === "message" ? "Reply sent in Messages." : `Reply sent. ${group().user.name.split(" ")[0]} gets it as a notification.`);
        } catch (err) { toast(err.error || "Couldn’t send it."); send.disabled = false; }
      };
      input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") sendReply(); });
      send.addEventListener("click", sendReply);
      // Reply with a GIF (the story waits while you pick)
      const gifBtn = h("button", { type: "button", class: "sv-gif", "aria-label": "Reply with a GIF", title: "GIF" }, h("span", { text: "GIF" }));
      gifBtn.addEventListener("click", () => {
        pause(true);
        openGifs(gifBtn, async (g) => {
          try {
            const r = await api(`/api/stories/${s.id}/reply`, { method: "POST", body: { text: input.value, ...gifBody(g) } });
            input.value = ""; send.disabled = true;
            toast(r.sent === "message" ? "GIF sent in Messages." : `Sent. ${group().user.name.split(" ")[0]} gets it as a notification.`);
          } catch (err) { toast(err.error || "Couldn’t send it."); }
        }, { onClose: () => pause(false) });
      });
      // …or a sound (one of mine, or a built-in one): it arrives in Messages, and plays there
      const soundBtn = h("button", { type: "button", class: "sv-gif sv-sound-btn", "aria-label": "Reply with a sound", title: "Sound" }, h("span", { text: "🔊" }));
      soundBtn.addEventListener("click", () => pickStorySound(soundBtn, async (b) => {
        try {
          const r = await api(`/api/stories/${s.id}/reply`, { method: "POST", body: b });
          toast(r.sent === "message" ? "🔊 Sound sent in Messages." : `🔊 Sent. ${group().user.name.split(" ")[0]} gets it as a notification.`);
        } catch (err) { toast(err.error || "Couldn’t send it."); }
      }));
      // Tagged in it: add it to my story (like Instagram)
      let repost = null;
      if (s.canRepost) {
        repost = h("button", { type: "button", class: "sv-add-story" }, h("span", { text: "＋" }), h("b", { text: "Add to your story" }));
        repost.addEventListener("click", async () => {
          repost.disabled = true;
          try { await api(`/api/stories/${s.id}/repost`, { method: "POST" }); s.canRepost = false; repost.replaceChildren(h("b", { text: "✓ Added to your story" })); toast("It’s in your story now."); }
          catch (err) { toast(err.error || "Couldn’t add it."); repost.disabled = false; }
        });
      }
      foot.replaceChildren(...(repost ? [repost] : []), h("div", { class: "sv-react-row" }, reacts), h("div", { class: "sv-reply-row" }, commentsBtn(s, true), input, soundBtn, gifBtn, send));
    }
  }
  // A reaction floats up over the story
  function floatUp(emoji) {
    const el = h("span", { class: "sv-float", text: emoji });
    frame.append(el);
    setTimeout(() => el.remove(), 1400);
  }
  let holding = false;
  // Stop the clock only (the song and video go on)
  function holdTime(on) {
    if (on === paused) return;
    paused = on;
    if (on) elapsed += performance.now() - started; else started = performance.now();
  }
  function pause(on) {
    if (on === paused) return;
    paused = on;
    if (on) { elapsed += performance.now() - started; video?.pause(); songAudio?.pause(); if (songYt) import("./yt-audio.js").then((m) => songYt && m.ytIsPlaying(songYt.yt, songYt.key) && m.ytToggle(songYt.yt, { anchor: frame }, songYt.key)); }
    else { started = performance.now(); video?.play().catch(() => {}); songAudio?.play().catch(() => {}); if (songYt) import("./yt-audio.js").then((m) => songYt && !m.ytIsPlaying(songYt.yt, songYt.key) && m.ytToggle(songYt.yt, { anchor: frame }, songYt.key)); }
    frame.classList.toggle("paused", on);
  }
  function next() { if (i < group().stories.length - 1) { i++; show(); } else nextGroup(); }
  function prev() { if (i > 0) { i--; show(); } else if (g > 0) { g--; i = 0; bars.replaceChildren(); show(); } else { elapsed = 0; started = performance.now(); } }
  function nextGroup() { if (g < groups.length - 1) { g++; i = 0; bars.replaceChildren(); show(); } else close(); }
  const offViewed = on("story:viewed", (ev) => {
    const s = story();
    if (!s || !s.mine || ev.id !== s.id) return;
    s.viewers.length = ev.count; // keep the number fresh; the list reloads when opened
    const btn = foot.querySelector(".sv-pill span");
    if (btn) btn.textContent = `${ev.count} ${ev.count === 1 ? "viewer" : "viewers"}`;
  });
  const offStuck = on("story:stuck", (ev) => { const s = story(); if (s && ev.id === s.id) { s.stuck = ev.stuck; paintStuck(s); } });
  const offComments = on("story:comments", (ev) => {
    const s = story();
    if (!s || ev.id !== s.id) return;
    s.comments = ev.count;
    frame.querySelectorAll(".sv-cc").forEach((x) => { x.textContent = ev.count ? String(ev.count) : ""; x.parentElement.classList.toggle("has", !!ev.count); });
    const before = new Set((s.latestComments || []).map((c) => c.id));
    api(`/api/stories/${s.id}/comments`).then((r) => {
      s.latestComments = r.comments.slice(-30).map(onStoryOf);
      if (story() !== s) return;
      paintCommentsOnStory(s);
      // Someone else just commented while I'm watching: it pops up
      const fresh = r.comments.filter((c) => !before.has(c.id) && c.author.username !== state.me?.username).slice(-1)[0];
      if (fresh && !sheetOpen && !document.querySelector(".app-modal")) popComment(onStoryOf(fresh));
    }).catch(() => {});
  });
  function close() {
    if (closed) return;
    closed = true;
    sheetOpen?.close();
    stopStorySong();
    closeGifs();
    offViewed(); offComments(); offStuck();
    cancelAnimationFrame(timer);
    video?.pause();
    document.removeEventListener("keydown", onKey);
    box.classList.remove("open");
    document.body.classList.remove("no-scroll");
    setTimeout(() => box.remove(), 200);
    onClosed?.();
  }
  // Tap left/right, hold anywhere to pause
  let downAt = 0;
  // Pull the story down to close it (like Instagram)
  let swipeY = null, swipeD = 0;
  for (const [zone, fn] of [[prevZone, prev], [nextZone, next]]) {
    zone.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      downAt = performance.now(); holding = true; swipeY = e.clientY; swipeD = 0;
      try { zone.setPointerCapture(e.pointerId); } catch {}
      const at = downAt;
      // hold: it stops (and the buttons fade away, so you can see the whole story)
      setTimeout(() => { if (holding && downAt === at && swipeD <= 8) { pause(true); frame.classList.add("holding"); } }, 180);
    });
    zone.addEventListener("pointermove", (e) => {
      if (swipeY == null) return;
      swipeD = Math.max(0, e.clientY - swipeY);
      if (swipeD > 8) { frame.classList.add("pulling"); frame.style.transform = `translateY(${swipeD}px) scale(${1 - Math.min(swipeD, 400) / 2000})`; box.style.setProperty("--pull", String(Math.min(swipeD / 300, 1))); }
    });
    zone.addEventListener("pointerup", () => {
      holding = false; frame.classList.remove("holding");
      const d = swipeD; swipeY = null; swipeD = 0;
      frame.classList.remove("pulling"); frame.style.transform = ""; box.style.removeProperty("--pull");
      if (d > 120) return close();
      if (d <= 8 && performance.now() - downAt < 200) fn();
      pause(false);
    });
    zone.addEventListener("pointercancel", () => { if (holding) { holding = false; pause(false); } frame.classList.remove("holding"); swipeY = null; swipeD = 0; frame.classList.remove("pulling"); frame.style.transform = ""; box.style.removeProperty("--pull"); });
    zone.addEventListener("pointerleave", () => { if (holding && swipeY == null) { holding = false; frame.classList.remove("holding"); pause(false); } });
    zone.addEventListener("contextmenu", (e) => e.preventDefault()); // (a long press doesn't open the phone's menu)
  }
  closeBtn.addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  const onKey = (e) => {
    if (e.target.closest?.("input") || document.querySelector(".app-overlay")) return; // (a window on top handles its own keys)
    // a panel open inside the story (comments, sharing): Esc closes the panel, the arrows don't move the story
    if (sheetOpen) { if (e.key === "Escape") sheetOpen.close(); return; }
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === " ") { e.preventDefault(); pause(!paused); }
  };
  document.addEventListener("keydown", onKey);
  // Start at the first unseen story of the person
  const firstUnseen = group().stories.findIndex((s) => !s.seen && !s.mine);
  i = group().startAt ?? (firstUnseen > 0 ? firstUnseen : 0);
  show();
  if (openComments && story()) setTimeout(() => showComments(story()), 300);
}

/* ---------- The bar at the top of the feed ---------- */
export function storyBar() {
  const row = h("div", { class: "story-bar" });
  let groups = [];
  async function load() {
    try { groups = (await api("/api/stories")).groups; } catch { return; }
    // Adding a story happens from your own profile picture; here you only watch
    const watchable = groups.filter((x) => x.stories.length);
    row.hidden = !watchable.length;
    row.replaceChildren(...watchable.map((gr) => {
      const has = gr.stories.length > 0;
      const ring = h("span", { class: "story-ring" + (has ? (gr.unseen ? " unseen" : " seen") : "") }, avatar(gr.user, 62));
      const item = h("button", { type: "button", class: "story-item" + (gr.isMe ? " me" : "") }, ring,
        h("span", { class: "story-name" }, gr.isMe ? "Your story" : gr.user.name.split(" ")[0]));
      item.addEventListener("click", () => openStories(watchable, watchable.indexOf(gr), load));
      return item;
    }));
  }
  load();
  const off = on("story:new", () => { if (!row.isConnected) return off(); load(); });
  return row;
}

// Open one person's stories (e.g. from their profile picture)
export async function openUserStories(username, onClosed, storyId = null, opts = {}) {
  try {
    const { group } = await api(`/api/stories/user/${encodeURIComponent(username)}`);
    if (!group.stories.length) return false;
    if (storyId) group.startAt = Math.max(0, group.stories.findIndex((x) => x.id === storyId));
    openStories([group], 0, onClosed, opts);
    return true;
  } catch { return false; }
}
