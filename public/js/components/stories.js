// Stories: the bar at the top of the feed, posting one, and the full-screen viewer.
import { h, icon, avatar, timeAgo, toast, modal, tick } from "../ui.js";
import { api, upload } from "../api.js";
import { on, state } from "../state.js";
import { profileHref, navigate } from "../router.js";
import { inspectVideo } from "./media-picker.js";

const IMAGE_SECONDS = 5;
const REACTIONS = ["😂", "😮", "😍", "😢", "👏", "🔥", "❤️", "💯"];

/* ---------- Posting a story ---------- */
export async function addStory() {
  const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm", hidden: true });
  document.body.append(input);
  const file = await new Promise((resolve) => { input.addEventListener("change", () => resolve(input.files[0] || null)); input.click(); });
  input.remove();
  if (!file) return false;
  const isVideo = file.type.startsWith("video/");
  let info = null;
  if (isVideo) {
    info = await inspectVideo(file);
    if (!info || !Number.isFinite(info.duration)) { toast("We couldn’t read this video. Try an MP4."); return false; }
    if (info.duration > 60.5) { toast("Story videos can be up to 60 seconds."); return false; }
  }
  const url = URL.createObjectURL(file);
  const text = h("input", { type: "text", class: "story-text-input", maxlength: 120, placeholder: "Add text (optional)" });
  const caption = h("div", { class: "story-caption", hidden: true });
  text.addEventListener("input", () => { caption.textContent = text.value; caption.hidden = !text.value.trim(); });
  const share = h("button", { type: "button", class: "btn btn-primary btn-full" }, h("span", { text: "Share to your story" }));
  const media = isVideo ? h("video", { src: url, autoplay: true, muted: true, loop: true, playsInline: true }) : h("img", { src: url, alt: "" });
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title: "New story", onClose: () => { URL.revokeObjectURL(url); if (!done) resolve(false); },
      body: h("div", { class: "story-compose" },
        h("div", { class: "story-frame preview" }, media, caption),
        text,
        h("p", { class: "create-hint", text: "Your followers can see it for 24 hours." }),
        share) });
    setTimeout(() => text.focus(), 80);
    share.addEventListener("click", async () => {
      share.disabled = true;
      share.querySelector("span").textContent = "Uploading…";
      try {
        const body = { media: { url: (await upload(file)).url }, text: text.value };
        if (isVideo) {
          Object.assign(body.media, { duration: info.duration, width: info.width, height: info.height });
          if (info.posterBlob) body.media.poster = (await upload(new File([info.posterBlob], "cover.jpg", { type: "image/jpeg" }))).url;
        }
        await api("/api/stories", { method: "POST", body });
        done = true;
        resolve(true);
        m.close();
        toast("Your story is up for 24 hours.");
      } catch (err) {
        toast(err.error || "Couldn’t post the story.");
        share.disabled = false;
        share.querySelector("span").textContent = "Share to your story";
      }
    });
  });
}

/* ---------- The viewer ---------- */
export function openStories(groups, startGroup = 0, onClosed) {
  let g = startGroup, i = 0, timer = null, started = 0, elapsed = 0, paused = false, closed = false;
  const bars = h("div", { class: "sv-bars" });
  const who = h("div", { class: "sv-who" });
  const stage = h("div", { class: "sv-stage" });
  const caption = h("div", { class: "story-caption" });
  const foot = h("div", { class: "sv-foot" });
  const closeBtn = h("button", { type: "button", class: "sv-close", "aria-label": "Close" }, icon("close"));
  const prevZone = h("button", { type: "button", class: "sv-zone left", "aria-label": "Previous" });
  const nextZone = h("button", { type: "button", class: "sv-zone right", "aria-label": "Next" });
  const frame = h("div", { class: "story-frame" }, stage, caption, prevZone, nextZone, h("div", { class: "sv-top" }, bars, h("div", { class: "sv-head" }, who, closeBtn)), foot);
  const box = h("div", { class: "story-viewer", role: "dialog", "aria-modal": "true", "aria-label": "Story" }, frame);
  document.body.append(box);
  document.body.classList.add("no-scroll");
  requestAnimationFrame(() => box.classList.add("open"));

  const group = () => groups[g];
  const story = () => group()?.stories[i];
  let video = null;

  function duration() { return story()?.media.kind === "video" ? Math.min(60, story().media.duration || video?.duration || 15) : IMAGE_SECONDS; }
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
      video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
    } else {
      stage.replaceChildren(h("img", { src: s.media.url, alt: "" }));
    }
    caption.textContent = s.text || "";
    caption.hidden = !s.text;
    paintFoot(s);
    if (!s.mine && !s.seen) { s.seen = true; api(`/api/stories/${s.id}/view`, { method: "POST" }).catch(() => {}); }
    group().unseen = group().stories.some((x) => !x.seen);
    paintBars(0);
    timer = requestAnimationFrame(tickTime);
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
      foot.replaceChildren(viewersBtn, hlBtn, ...(editHl ? [editHl] : []), del);
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
      const input = h("input", { type: "text", class: "sv-reply", placeholder: `Reply to ${group().user.name}…`, maxlength: 1000 });
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
      foot.replaceChildren(reacts, h("div", { class: "sv-reply-row" }, input, send));
    }
  }
  // A reaction floats up over the story
  function floatUp(emoji) {
    const el = h("span", { class: "sv-float", text: emoji });
    frame.append(el);
    setTimeout(() => el.remove(), 1400);
  }
  let holding = false;
  function pause(on) {
    if (on === paused) return;
    paused = on;
    if (on) { elapsed += performance.now() - started; video?.pause(); }
    else { started = performance.now(); video?.play().catch(() => {}); }
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
  function close() {
    if (closed) return;
    closed = true;
    offViewed();
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
  for (const [zone, fn] of [[prevZone, prev], [nextZone, next]]) {
    zone.addEventListener("pointerdown", () => { downAt = performance.now(); holding = true; setTimeout(() => holding && pause(true), 180); });
    zone.addEventListener("pointerup", () => { holding = false; if (performance.now() - downAt < 200) fn(); pause(false); });
    zone.addEventListener("pointerleave", () => { if (holding) { holding = false; pause(false); } });
  }
  closeBtn.addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  const onKey = (e) => {
    if (e.target.closest?.("input")) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === " ") { e.preventDefault(); pause(!paused); }
  };
  document.addEventListener("keydown", onKey);
  // Start at the first unseen story of the person
  const firstUnseen = group().stories.findIndex((s) => !s.seen && !s.mine);
  i = firstUnseen > 0 ? firstUnseen : 0;
  show();
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
export async function openUserStories(username, onClosed) {
  try {
    const { group } = await api(`/api/stories/user/${encodeURIComponent(username)}`);
    if (!group.stories.length) return false;
    openStories([group], 0, onClosed);
    return true;
  } catch { return false; }
}
