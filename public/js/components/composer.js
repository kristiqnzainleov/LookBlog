// Writing posts from the top of the feed: a quick post, a short, or a video.
import { h, icon, avatar, toast, modal } from "../ui.js";
import { api } from "../api.js";
import { state, emit } from "../state.js";
import { createPicker } from "./media-picker.js";
import { attachMentions } from "./mentions.js";
import { thumbnailField } from "./thumbnail.js";
import { visibilityPicker } from "./visibility.js";

const LIMIT = { post: 1000, short: 300, video: 5000, title: 100 };
const chars = (s) => [...s].length;

function counter(textarea, limit) {
  const el = h("span", { class: "counter" });
  const paint = () => {
    const left = limit - chars(textarea.value);
    el.textContent = left <= Math.min(100, limit * 0.2) ? String(left) : "";
    el.className = "counter" + (left < 0 ? " over" : left <= 20 ? " warn" : "");
  };
  textarea.addEventListener("input", paint);
  paint();
  return { el, over: () => chars(textarea.value) > limit, paint };
}

function autoGrow(t) {
  const fit = () => { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; };
  t.addEventListener("input", fit);
  return fit;
}

async function publish(body) {
  const { post } = await api("/api/posts", { method: "POST", body });
  emit("post:created", post);
  return post;
}

/* ---------- Category: one of my own, or a new one ---------- */
function categoryPicker() {
  const sel = h("select", { class: "cat-select", "aria-label": "Category" });
  function fill(selected = "") {
    sel.replaceChildren(
      h("option", { value: "", text: "No category" }),
      ...(state.me.categories || []).map((c) => h("option", { value: c.id, text: c.name })),
      h("option", { value: "__new", text: "+ New category…" })
    );
    sel.value = selected;
  }
  let last = "";
  sel.addEventListener("change", async () => {
    if (sel.value !== "__new") { last = sel.value; return; }
    const name = await askName();
    if (!name) return fill(last);
    try {
      const { categories } = await api("/api/me/categories", { method: "POST", body: { name } });
      state.me.categories = categories;
      const made = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      last = made?.id || "";
      fill(last);
      emit("categories:changed");
    } catch (err) {
      toast(err.error || "Couldn’t make that category.");
      fill(last);
    }
  });
  fill();
  return { el: h("label", { class: "cat-field" }, icon("folder"), sel), value: () => (sel.value === "__new" ? "" : sel.value), reset: () => { last = ""; fill(); } };
}
// A tiny inline prompt (the browser's prompt() isn't allowed everywhere)
function askName() {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", class: "text-input", maxlength: 30, placeholder: "Category name, e.g. Travel" });
    const ok = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Create category" });
    let done = false;
    const m = modal({ title: "New category", body: h("div", { class: "create-form" }, input, ok), onClose: () => { if (!done) resolve(null); } });
    const finish = () => { done = true; resolve(input.value.trim() || null); m.close(); };
    ok.addEventListener("click", finish);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(); } });
    setTimeout(() => input.focus(), 60);
  });
}

/* ---------- Poll builder ---------- */
function pollBuilder(onChange) {
  const opts = h("div", { class: "poll-opts" });
  const days = h("select", { class: "cat-select", "aria-label": "Poll length" },
    h("option", { value: "1", text: "1 day" }), h("option", { value: "3", text: "3 days" }), h("option", { value: "7", text: "1 week" }));
  const add = h("button", { type: "button", class: "btn btn-xs btn-outline-light" }, icon("plus"), h("span", { text: "Add answer" }));
  const remove = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Remove poll" });
  const el = h("div", { class: "poll-builder", hidden: true },
    h("b", { class: "vis-label", text: "Poll answers" }), opts,
    h("div", { class: "poll-tools" }, add, h("span", { class: "muted", text: "Ends in" }), days, h("span", { style: "flex:1" }), remove));
  function addOpt(v = "") {
    if (opts.children.length >= 4) return;
    const i = h("input", { type: "text", class: "text-input", maxlength: 60, placeholder: `Answer ${opts.children.length + 1}`, value: v });
    i.addEventListener("input", onChange);
    opts.append(i);
    add.hidden = opts.children.length >= 4;
    onChange();
  }
  add.addEventListener("click", () => { addOpt(); opts.lastChild.focus(); });
  const api_ = {
    el,
    on: () => !el.hidden,
    open: () => { el.hidden = false; if (!opts.children.length) { addOpt(); addOpt(); } opts.firstChild.focus(); onChange(); },
    close: () => { el.hidden = true; opts.replaceChildren(); add.hidden = false; onChange(); },
    value: () => ({ options: [...opts.children].map((i) => i.value.trim()).filter(Boolean), days: Number(days.value) }),
    ready: () => [...opts.children].filter((i) => i.value.trim()).length >= 2,
  };
  remove.addEventListener("click", api_.close);
  return api_;
}

/* ---------- Chain post builder (like Gartic Phone) ---------- */
function chainBuilder(onChange) {
  let mode = "text", max = 6;
  const sizes = h("div", { class: "chain-sizes" });
  const paint = () => {
    sizes.replaceChildren(h("span", { class: "muted", text: "Parts" }), ...[4, 6, 8, 10, 12].map((n) => {
      const b = h("button", { type: "button", class: "chain-size" + (max === n ? " on" : ""), text: String(n) });
      b.addEventListener("click", () => { max = n; paint(); });
      return b;
    }));
  };
  paint();
  const remove = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Not a chain" });
  const el = h("div", { class: "chain-builder", hidden: true },
    h("b", { class: "vis-label", text: "⛓️ Chain post" }),
    h("p", { class: "create-hint", text: "Others carry it on. Each person only sees the part right before theirs — nobody knows the rest until the chain is finished. Then everyone sees how it turned out." }),
    h("div", { class: "poll-tools" }, sizes, h("span", { style: "flex:1" }), remove));
  const api_ = { el, on: () => !el.hidden, open: () => { el.hidden = false; onChange(); }, close: () => { el.hidden = true; onChange(); }, value: () => ({ mode, max }) };
  remove.addEventListener("click", api_.close);
  return api_;
}

/* ---------- A quick post: text and photos ---------- */
const PROMPTS = [
  "What did you see today? Tag people with @",
  "Share something that made you look twice.",
  "What’s on your mind? Photos welcome.",
  "Caught anything pretty on camera lately?",
  "Tell your followers what you’re up to.",
  "Ask a question, or start a poll.",
  "Small moment, big feeling? Post it.",
  "What would you like people to see?",
  "Today in one sentence…",
  "Tag a friend who should see this.",
];
function pickPrompt() {
  let prev = null;
  try { prev = sessionStorage.getItem("lb_prompt"); } catch {}
  const options = PROMPTS.filter((p) => p !== prev);
  const p = options[Math.floor(Math.random() * options.length)];
  try { sessionStorage.setItem("lb_prompt", p); } catch {}
  return p;
}

function postForm() {
  const prompt = pickPrompt();
  const text = h("textarea", { rows: 2, placeholder: prompt, "aria-label": "Write a post" });
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-sm", text: "Post", disabled: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const picker = createPicker({ accept: "both", max: 4, onChange: update, onError: showErr });
  const cnt = counter(text, LIMIT.post);
  const fit = autoGrow(text);
  attachMentions(text);
  const cat = categoryPicker();
  const poll = pollBuilder(() => update());
  const pollBtn = h("button", { type: "button", class: "tool-btn", title: "Add a poll", "aria-label": "Add a poll" }, icon("poll"));
  pollBtn.addEventListener("click", () => (poll.on() ? poll.close() : poll.open()));
  const chain = chainBuilder(() => update());
  const chainBtn = h("button", { type: "button", class: "tool-btn", title: "Chain post: others carry it on, blind (like Gartic Phone)", "aria-label": "Chain post" }, h("span", { class: "tool-emoji", text: "⛓️" }));
  chainBtn.addEventListener("click", () => (chain.on() ? chain.close() : (poll.close(), chain.open(), text.focus())));

  function update() {
    const hasPoll = poll.on(), hasChain = chain.on();
    picker.button.disabled = hasPoll || hasChain || picker.items().some((i) => i.kind === "video") || picker.items().length >= 4;
    pollBtn.disabled = picker.items().length > 0 || hasChain;
    chainBtn.disabled = picker.items().length > 0 || hasPoll;
    pollBtn.classList.toggle("on", hasPoll);
    chainBtn.classList.toggle("on", hasChain);
    text.placeholder = hasPoll ? "Ask a question…" : hasChain ? "Start the chain… the next person only sees this line" : prompt;
    submit.disabled = picker.busy() || cnt.over() || (hasPoll ? !text.value.trim() || !poll.ready() : hasChain ? !text.value.trim() : !text.value.trim() && !picker.media().length);
    submit.textContent = picker.busy() ? "Uploading…" : "Post";
  }
  text.addEventListener("input", update);
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  // Paste or drop photos straight into the box
  text.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); picker.add(files); }
  });

  // 💬 on/off: let people reply or not
  let repliesOff = false;
  const repliesOffBtn = h("button", { type: "button", class: "tool-btn replies-off-btn", title: "Replies on — click to turn them off" }, h("span", { class: "tool-emoji", text: "💬" }));
  repliesOffBtn.addEventListener("click", () => { repliesOff = !repliesOff; repliesOffBtn.classList.toggle("off", repliesOff); repliesOffBtn.title = repliesOff ? "Replies off — click to turn them on" : "Replies on — click to turn them off"; toast(repliesOff ? "Replies will be off for this post." : "Replies are on."); });
  const form = h("form", { class: "composer", novalidate: true },
    avatar(state.me, 42),
    h("div", { class: "composer-main" },
      text,
      picker.previews,
      poll.el,
      chain.el,
      h("div", { class: "composer-bar" }, picker.button, pollBtn, chainBtn, repliesOffBtn, cat.el, cnt.el, submit),
      err
    )
  );
  form.addEventListener("dragover", (e) => { e.preventDefault(); form.classList.add("drop"); });
  form.addEventListener("dragleave", () => form.classList.remove("drop"));
  form.addEventListener("drop", (e) => { e.preventDefault(); form.classList.remove("drop"); picker.add([...e.dataTransfer.files]); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    showErr("");
    submit.disabled = true;
    submit.textContent = "Posting…";
    try {
      await publish({ type: "post", text: text.value, media: poll.on() || chain.on() ? [] : picker.media(), poll: poll.on() ? poll.value() : null, chain: chain.on() ? chain.value() : null, categoryId: cat.value() || null, repliesOff });
      toast(poll.on() ? "Poll posted." : chain.on() ? "⛓️ Chain started! Others can carry it on now." : "Posted.");
      text.value = "";
      picker.clear();
      poll.close();
      chain.close();
      cnt.paint();
      fit();
    } catch (ex) {
      showErr(ex.error || "Couldn’t post that. Try again.");
    }
    update();
  });
  return { el: form, busy: () => picker.busy(), focus: () => text.focus() };
}

/* ---------- The create card at the top of the feed: Post, Short or Video ---------- */
export function createCard(start = "post") {
  const tabs = h("div", { class: "create-kinds", role: "tablist", "aria-label": "What do you want to post?" });
  const panel = h("div", { class: "create-body" });
  const card = h("section", { class: "create-card" }, tabs, panel);
  let current = null, kind = null;

  const kinds = [
    ["post", "Post", "edit"],
    ["short", "Short", "video"],
    ["video", "Video", "play"],
  ];
  for (const [k, label, ic] of kinds) {
    const b = h("button", { type: "button", role: "tab", class: "create-kind", dataset: { kind: k } }, icon(ic), h("span", { text: label }));
    b.addEventListener("click", () => show(k, true));
    tabs.append(b);
  }

  function show(k, focus = false) {
    if (k === kind) return;
    if (current?.busy?.()) { toast("Wait for the upload to finish, or remove it first."); return; }
    kind = k;
    tabs.querySelectorAll(".create-kind").forEach((b) => {
      b.classList.toggle("active", b.dataset.kind === k);
      b.setAttribute("aria-selected", String(b.dataset.kind === k));
    });
    current = k === "post" ? postForm() : createForm(k, () => { kind = null; show(k); });
    panel.replaceChildren(current.el);
    if (focus) setTimeout(() => current.focus(), 50);
  }
  show(start);
  return { el: card, show: (k) => { show(k, true); card.scrollIntoView({ behavior: "smooth", block: "start" }); } };
}

// Answer a video with your own video (a "video reply"): the upload form, linked to that video
export function openVideoReply(original) {
  const m = modal({ title: "Reply with a video", wide: true, body: createForm("video", () => m.close(), { replyTo: original }).el });
}

// Upload an episode straight into a series, into the season you pick (or a new one)
export function openEpisodeUpload(series, { season = 1, onDone } = {}) {
  const m = modal({ title: `Upload an episode · ${series.title}`, wide: true, body: createForm("video", () => m.close(), { series, season, onDone }).el });
}

function createForm(kind, close, { replyTo = null, series = null, season: startSeason = 1, onDone = null } = {}) {
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const showErr = (msg) => { err.textContent = msg; err.hidden = !msg; };
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-full", disabled: true });
  const label = series ? "Add episode" : { post: "Post", short: "Post short", video: "Post video" }[kind];
  // Which season this episode goes in (the next number makes a new season)
  let seasonSel = null;
  if (series) {
    const count = Math.max(series.seasonCount || 1, 1);
    const info = series.seasonInfo || {};
    seasonSel = h("select", { class: "text-input season-pick", "aria-label": "Season" },
      ...Array.from({ length: count }, (_, k) => k + 1).map((n) => h("option", { value: n, selected: n === startSeason, text: `Season ${n}${info[n]?.title ? " — " + info[n].title : ""}${info[n]?.year ? " (" + info[n].year + ")" : ""}` })),
      count < 50 ? h("option", { value: count + 1, text: `➕ New season (Season ${count + 1})` }) : null);
  }

  const picker = createPicker({
    accept: kind === "post" ? "both" : "video",
    max: kind === "post" ? 4 : 1,
    maxVideoSeconds: kind === "short" ? 90 : null,
    onChange: update,
    onError: showErr,
  });

  const title = kind === "video" ? h("input", { type: "text", maxlength: 120, placeholder: series ? "Episode title (e.g. “Pilot”)" : "Title", "aria-label": "Title", class: "text-input" }) : null;
  const text = h("textarea", {
    rows: kind === "video" ? 4 : 3,
    class: "text-input",
    placeholder: kind === "post" ? "What did you see today?" : kind === "short" ? "Add a caption" : "Tell people about your video",
    "aria-label": kind === "video" ? "Description" : "Text",
  });
  const cnt = counter(text, LIMIT[kind]);
  autoGrow(text);
  attachMentions(text);

  const hint = {
    post: "Write something and add up to 4 photos or one video.",
    short: "A vertical video up to 90 seconds. It shows up in Shorts.",
    video: "Any length. It shows up in Videos with its own page.",
  }[kind];

  const dropZone = kind === "post" ? null : h("button", { type: "button", class: "drop-zone" },
    h("b", { text: kind === "short" ? "Choose a short video" : "Choose a video" }),
    h("span", { text: "MP4, MOV or WebM" })
  );
  dropZone?.addEventListener("click", () => picker.open());

  // Videos and shorts get a thumbnail: a frame from the video, or your own picture
  // Thumbnails are for videos; shorts start playing right away
  const thumb = kind === "video" ? thumbnailField({ vertical: false }) : null;
  const cat = kind === "post" ? null : categoryPicker();
  const vis = kind === "post" ? null : visibilityPicker("public");
  thumb?.onChange(() => update());
  // Replies on or off (can be changed later from the post)
  const repliesBox = h("input", { type: "checkbox" });
  const repliesRow = h("label", { class: "check-row replies-row" }, repliesBox, h("span", {}, h("b", { text: "💬 Turn off replies" }), h("small", { class: "muted", text: " — nobody can reply to it" })));
  // SoundCloud-style extras (off unless you turn them on)
  const timedBox = h("input", { type: "checkbox" }), momentsBox = h("input", { type: "checkbox" });
  const extrasRow = h("div", { class: "extras-rows" },
    h("label", { class: "check-row" }, timedBox, h("span", {}, h("b", { text: "🕒 Timed comments" }), h("small", { class: "muted", text: " — replies pop up on the video at the moment people wrote them" }))),
    h("label", { class: "check-row" }, momentsBox, h("span", {}, h("b", { text: "⚡ Live reactions" }), h("small", { class: "muted", text: " — people react at any second; reactions fly up when others get there" }))));
  // Upcoming: release it later (like a YouTube premiere). Followers see a teaser with "Notify me".
  let schedEl = null, schedAt = null;
  if (kind !== "post") {
    const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const box = h("input", { type: "checkbox" });
    schedAt = h("input", { type: "datetime-local", class: "text-input", hidden: true, min: toLocal(new Date(Date.now() + 2 * 60000)), value: toLocal(new Date(Date.now() + 86400000)) });
    box.addEventListener("change", () => { schedAt.hidden = !box.checked; if (vis) vis.el.hidden = box.checked; schedAt.dataset.on = box.checked ? "1" : ""; });
    schedEl = h("div", { class: "sched-row" }, h("label", { class: "check-row" }, box, h("span", {}, h("b", { text: "⏳ Schedule as upcoming" }), h("small", { class: "muted", text: " — goes public at this time; followers can tap “Notify me”" }))), schedAt);
  }

  function update() {
    const media = picker.media();
    if (thumb) thumb.setAuto(picker.items()[0]?.poster);
    let ok = !picker.busy() && !cnt.over() && !thumb?.busy();
    if (kind === "post") ok = ok && (text.value.trim() || media.length);
    else ok = ok && media.length === 1;
    if (kind === "video") ok = ok && title.value.trim() && chars(title.value.trim()) <= LIMIT.title;
    submit.disabled = !ok;
    submit.textContent = picker.busy() ? "Uploading…" : label;
    if (dropZone) dropZone.hidden = picker.items().length > 0;
  }
  text.addEventListener("input", update);
  title?.addEventListener("input", update);

  const el = h("form", { class: "create-form", novalidate: true },
    series ? h("div", { class: "vreply-banner ep-banner" }, h("span", { text: "📺 New episode of" }), h("b", { text: series.title }), h("span", { class: "muted", text: "· pick the season:" }), seasonSel) : null,
    replyTo ? h("div", { class: "vreply-banner" }, h("span", { text: "↩ Your video replies to" }), h("b", { text: replyTo.title || "this video" }), h("span", { class: "muted", text: "by " + replyTo.author.name })) : null,
    h("p", { class: "create-hint", text: hint }),
    dropZone,
    picker.previews,
    thumb?.el,
    title,
    text,
    h("div", { class: "composer-bar" }, kind === "post" ? picker.button : null, h("span", { class: "tag-hint muted", text: "Tag people with @" }), h("span", { style: "margin-right:auto" }), cnt.el),
    cat ? h("div", { class: "cat-row" }, h("b", { class: "vis-label", text: "Category" }), cat.el) : null,
    vis?.el,
    schedEl,
    repliesRow,
    extrasRow,
    err,
    submit
  );
  if (kind !== "post") el.append(picker.button), (picker.button.hidden = true);

  el.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    showErr("");
    submit.disabled = true;
    submit.textContent = "Posting…";
    try {
      const media = picker.media();
      if (thumb && media[0] && thumb.value()) media[0].poster = thumb.value();
      const publishAt = schedAt?.dataset.on ? new Date(schedAt.value).toISOString() : null;
      await publish({ type: kind, text: text.value, title: title?.value || "", media, visibility: vis?.value() || "public", categoryId: cat?.value() || null, publishAt, repliesOff: repliesBox.checked, timedComments: timedBox.checked, momentReactions: momentsBox.checked, replyTo: replyTo?.id || null, ...(series ? { seriesId: series.id, season: Number(seasonSel.value) } : {}) });
      close();
      if (series) { toast(`📺 Episode added to Season ${seasonSel.value} of “${series.title}”.`); onDone?.(Number(seasonSel.value)); return; }
      if (replyTo) toast(`✅ Your video reply is up! It shows under “${replyTo.title || "the video"}”.`);
      else if (publishAt) toast(`Scheduled! It comes out ${new Date(publishAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`);
      else toast(kind === "short" ? "Your short is up. It’s at the top of your feed and in Shorts." : "Your video is up. It’s at the top of your feed and in Videos.");
    } catch (ex) {
      showErr(ex.error || "Couldn’t post that. Try again.");
      update();
    }
  });
  update();
  return { el, busy: () => picker.busy(), focus: () => (kind === "video" ? (picker.items().length ? title : dropZone) : kind === "short" ? dropZone : text)?.focus() };
}
