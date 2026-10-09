// One conversation: a direct chat or a group. Messages arrive live.
import { h, icon, avatar, timeEl, empty, spinner, toast, confirmClick, richText, modal, plural, avatarWithPresence, presenceText, tick } from "../ui.js";
import { openEmojiPicker, insertAtCursor, QUICK, closeEmojiPicker } from "./emoji.js";
import { api } from "../api.js";
import { on, emit, state } from "../state.js";
import { profileHref, navigate } from "../router.js";
import { openHref, nsfwWrap } from "./post.js";
import { createPicker } from "./media-picker.js";
import { createPlayer } from "./player.js";
import { startRecording, voicePlayer } from "./voice.js";

// Files sent in chats: what each ending is, and how they look
const FILE_TYPES = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", zip: "application/zip",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
};
const fileIcon = (name) => { const e = (String(name).split(".").pop() || "").toLowerCase(); return e === "pdf" ? "📕" : /^docx?$/.test(e) ? "📝" : /^(xlsx?|csv)$/.test(e) ? "📊" : /^pptx?$/.test(e) ? "📽️" : e === "zip" ? "🗜️" : e === "txt" ? "📃" : "📎"; };
const fileSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : (n || 0) + " B");
function audioLength(file) {
  return new Promise((ok) => {
    const a = new Audio(), u = URL.createObjectURL(file);
    const done = (d) => { URL.revokeObjectURL(u); ok(Number.isFinite(d) && d > 0 ? d : null); };
    a.preload = "metadata"; a.onloadedmetadata = () => done(a.duration); a.onerror = () => done(null);
    setTimeout(() => done(null), 4000); a.src = u;
  });
}
function fileCard(m) {
  const ext = (String(m.name).split(".").pop() || "").toUpperCase().slice(0, 5);
  return h("a", { class: "file-card", href: m.url, target: "_blank", rel: "noopener", download: m.name || "", title: "Open or download" },
    h("span", { class: "fc-ic", text: fileIcon(m.name) }),
    h("span", { class: "fc-text" }, h("b", { text: m.name || "File" }), h("small", { class: "muted", text: [ext, m.size ? fileSize(m.size) : ""].filter(Boolean).join(" · ") })),
    h("span", { class: "fc-dl", "aria-hidden": "true", text: "⬇" }));
}
function audioFileCard(m) {
  return h("div", { class: "file-card audio-card" },
    h("div", { class: "fc-row" }, h("span", { class: "fc-ic", text: "🎵" }), h("span", { class: "fc-text" }, h("b", { text: m.name || "Audio" }), h("small", { class: "muted", text: [m.duration ? fmtLen(m.duration) : "", m.size ? fileSize(m.size) : ""].filter(Boolean).join(" · ") })),
      h("a", { class: "fc-dl", href: m.url, target: "_blank", rel: "noopener", download: m.name || "", title: "Download", text: "⬇" })),
    h("audio", { controls: true, preload: "metadata", src: m.url }));
}
const fmtLen = (d) => `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, "0")}`;
import { openStickers, closeStickers } from "./stickers.js";
import { gifButton, closeGifs, openGifs, gifBody } from "./gifs.js";
import { startCall } from "./call.js";
import { gameView, openGamePicker } from "./games.js";
import { openReportUser } from "./report.js";
import { linkBlock } from "./links.js";
import { upload } from "../api.js";
import { attachMentions } from "./mentions.js";
import { openSoundPicker, soundChip, playSound } from "./sounds.js";
import { sfx } from "./sfx.js";
import { styleBubble, playEffect, inkBubble, openMsgStyle, EFFECTS, SECRET_FX, PERSISTENT, secretBubble } from "./msg-style.js";
// On a phone, focusing the box opens the keyboard (and moves the screen): only when the keyboard is already up
const softFocus = (el) => { if (!matchMedia("(hover: none), (max-width: 640px)").matches || document.activeElement === el) el.focus(); };
import { applyWallpaper, applyTheme, onHold, openChatOptions, openVanishPicker, vanishLabel } from "./wallpaper.js";

export function chatPic(c, size = 44) {
  if (c.kind === "dm") return avatarWithPresence(c.other, size);
  const el = h("span", { class: "group-pic", style: `--size:${size}px` + (c.color ? `;--group:${c.color}` : "") + (c.cover ? `;background-image:url("${c.cover}")` : "") });
  if (!c.cover) el.textContent = (c.name || "?").slice(0, 1).toUpperCase();
  return el;
}
export const chatTitle = (c) => (c.kind === "dm" ? c.other.nickname || c.other.name : c.name);
// A person's name as this chat shows it (nickname first)
const shownName = (u) => u.nickname || u.name;

// Name colour from someone's highest role in a group
function roleColor(chat, username) {
  const m = chat.members?.find((x) => x.username === username);
  if (!m) return "";
  if (m.isOwner) return "color:" + (chat.color || "#ff4fa3");
  const r = (m.roles || []).map((id) => chat.roles?.find((x) => x.id === id)).find(Boolean);
  return r ? "color:" + r.color : "";
}

/* ---------- A song from LookBlog inside a message ---------- */
function songChatCard(s) {
  if (!s || s.deleted) return h("div", { class: "shared shared-gone", text: "This song was deleted." });
  const btn = h("button", { type: "button", class: "scc-play", "aria-label": "Play" }, icon("play"));
  const card = h("div", { class: "song-chat" },
    h("div", { class: "scc-cover", style: s.cover ? `background-image:url("${s.cover}")` : "" }, btn),
    h("div", { class: "scc-text" }, h("span", { class: "scc-kind", text: "🎧 Song" }), h("b", { text: s.title }),
      h("a", { class: "muted", href: profileHref(s.artist.username) + "?tab=song", text: s.artist.name + (s.feat ? ` feat. ${s.feat}` : "") }),
      h("span", { class: "muted scc-plays", text: `${(s.plays || 0).toLocaleString("en-US")} plays` })));
  const play = (e) => { e.stopPropagation(); import("./music.js").then((m) => m.playSongs([s], 0)); };
  btn.addEventListener("click", play);
  card.querySelector(".scc-cover").addEventListener("click", play);
  return card;
}

/* ---------- Send a song: search LookBlog's music ---------- */
function openSongPicker(onPick) {
  const search = h("input", { type: "search", class: "text-input", placeholder: "Search songs or artists", autocomplete: "off" });
  const list = h("div", { class: "song-pick" }, spinner());
  let seq = 0, timer;
  const load = async () => {
    const n = ++seq;
    try {
      const { songs } = await api(`/api/songs/search?q=${encodeURIComponent(search.value.trim())}`);
      if (n !== seq) return;
      list.replaceChildren(...songs.map((s) => {
        const send = h("button", { type: "button", class: "btn btn-xs btn-primary", text: "Send" });
        send.addEventListener("click", async () => { send.disabled = true; try { await onPick(s); m.close(); } catch { send.disabled = false; } });
        return h("div", { class: "sp-row" }, h("div", { class: "sp-cover", style: s.cover ? `background-image:url("${s.cover}")` : "" }),
          h("div", { class: "sp-text" }, h("b", { text: s.title }), h("span", { class: "muted", text: `${s.artist.name}${s.album ? " · " + s.album : ""} · ${(s.plays || 0).toLocaleString("en-US")} plays` })), send);
      }));
      if (!songs.length) list.append(empty("No songs found.", search.value.trim() ? "Try another name." : "Nobody has released songs yet."));
    } catch {}
  };
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 200); });
  const m = modal({ title: "Send a song", body: h("div", { class: "create-form" }, search, list) });
  load();
  setTimeout(() => search.focus(), 50);
}

/* ---------- A shared reply (comment) inside a message ---------- */
function sharedComment(c) {
  if (!c || c.deleted) return h("div", { class: "shared shared-gone", text: "This reply was deleted." });
  if (c.hidden) return h("div", { class: "shared shared-gone", text: "You can’t see this reply." });
  const p = c.post;
  const href = (p.type === "video" ? `/watch/${p.id}` : p.type === "short" ? `/shorts?id=${p.id}` : `/post/${p.id}`) + "#replies";
  const what = p.type === "video" ? "video" : p.type === "short" ? "short" : "post";
  return h("a", { class: "shared shared-comment", href },
    h("div", { class: "sc-head" }, avatar(c.author, 26), h("b", {}, c.author.name, tick(c.author, 13)), h("span", { class: "muted", text: "replied" })),
    c.text ? h("p", { class: "sc-text", text: c.text }) : null,
    c.media?.gif ? h("img", { class: "sc-gif", src: c.media.url, alt: "GIF" }) : c.media ? h("p", { class: "muted", text: c.media.kind === "video" ? "🎬 Video reply" : "📷 Photo" }) : null,
    h("div", { class: "sc-post" }, p.thumb ? h("img", { src: p.thumb, alt: "" }) : null,
      h("span", { class: "muted", text: `on ${p.author.name}’s ${what}${p.title ? ": " + p.title : p.text ? ": " + p.text : ""}` })));
}

/* ---------- A shared post inside a message ---------- */
function sharedPost(p) {
  if (!p || p.deleted) return h("div", { class: "shared shared-gone", text: "This post was deleted." });
  const m = p.media?.[0];
  const thumb = m ? (m.kind === "image" ? m.url : m.poster) : null;
  return h("a", { class: "shared", href: openHref(p) },
    thumb ? h("img", { src: thumb, alt: "", loading: "lazy" }) : null,
    h("div", { class: "shared-text" },
      h("b", {}, p.author.name, tick(p.author, 14)),
      h("span", { class: "muted", text: " @" + p.author.username }),
      h("p", { text: p.title || p.text || (p.type === "short" ? "Short" : "Post") })
    )
  );
}

function reactionsEl(msg, chat) {
  const row = h("div", { class: "reactions" });
  for (const r of msg.reactions || []) {
    const chip = h("button", { type: "button", class: "reaction" + (r.mine ? " mine" : ""), title: r.names.join(", ") + " · tap to see who reacted" },
      h("span", { class: "reaction-emoji", text: r.emoji }), r.count > 1 ? h("span", { class: "reaction-count", text: String(r.count) }) : null);
    // Tap: who reacted. Double tap: react with the same emoji yourself (e.g. a ❤️ on top of theirs)
    let tapTimer = null;
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tapTimer) {
        clearTimeout(tapTimer); tapTimer = null;
        // Not mine yet: add it. Already mine: take it back.
        if (!r.mine) likeBurst(chip.closest(".msg")?.querySelector(".bubble"), r.emoji);
        else sfx("unlike");
        react(msg, chat, r.emoji);
        return;
      }
      tapTimer = setTimeout(() => { tapTimer = null; openReactions(msg, chat); }, 280);
    });
    chip.addEventListener("dblclick", (e) => e.stopPropagation());
    row.append(chip);
  }
  row.hidden = !(msg.reactions || []).length;
  return row;
}

// Who reacted (like Instagram): everyone with their emoji, a tab per emoji; tap yours to take it back
async function openReactions(msg, chat) {
  const tabs = h("div", { class: "rx-tabs", role: "tablist" });
  const list = h("div", { class: "rx-list" }, spinner());
  const m = modal({ title: "Reactions", body: h("div", { class: "rx-sheet" }, tabs, list) });
  let people;
  try { people = (await api(`/api/chats/${chat.id}/messages/${msg.id}/reactions`)).reactions; }
  catch (err) { list.replaceChildren(h("p", { class: "muted", text: err.error || "Couldn’t load the reactions." })); return; }
  let tab = "all";
  function paint() {
    const counts = new Map();
    for (const p of people) counts.set(p.emoji, (counts.get(p.emoji) || 0) + 1);
    tabs.replaceChildren(...[["all", `All ${people.length}`], ...[...counts].sort((a, b) => b[1] - a[1]).map(([e, n]) => [e, `${e} ${n}`])].map(([k, label]) => {
      const b = h("button", { type: "button", class: "rx-tab" + (k === tab ? " on" : ""), role: "tab", "aria-selected": String(k === tab), text: label });
      b.addEventListener("click", () => { tab = k; paint(); });
      return b;
    }));
    const shown = people.filter((p) => tab === "all" || p.emoji === tab);
    list.replaceChildren(...shown.map((p) => {
      const row = h(p.mine ? "button" : "a", { class: "rx-row" + (p.mine ? " mine" : ""), type: p.mine ? "button" : null, href: p.mine ? null : profileHref(p.user.username) },
        avatar(p.user, 40),
        h("span", { class: "rx-who" }, h("b", {}, p.mine ? "You" : shownName(p.user), tick(p.user, 13)), h("small", { class: "muted", text: p.mine ? "Tap to remove" : "@" + p.user.username })),
        h("span", { class: "rx-emoji", text: p.emoji }));
      if (p.mine) row.addEventListener("click", async () => {
        await react(msg, chat, p.emoji);
        people = people.filter((x) => !x.mine);
        if (!people.length) return m.close();
        if (tab !== "all" && !people.some((x) => x.emoji === tab)) tab = "all";
        paint();
      });
      else row.addEventListener("click", (e) => { e.preventDefault(); m.close(); navigate(profileHref(p.user.username)); });
      return row;
    }));
    if (!shown.length) list.append(h("p", { class: "muted", text: "No reactions yet." }));
  }
  paint();
}

// A big emoji pops over the message (and a little sound)
function likeBurst(bubble, emoji = "❤️", quiet = false) {
  if (!quiet) sfx("like");
  if (!bubble) return;
  const pop = h("span", { class: "like-burst", text: emoji });
  bubble.append(pop);
  setTimeout(() => pop.remove(), 750);
}
async function react(msg, chat, emoji) {
  try {
    const { reactions } = await api(`/api/chats/${chat.id}/messages/${msg.id}/react`, { method: "POST", body: { emoji } });
    paintReactions(msg.id, reactions, chat);
  } catch (err) { toast(err.error || "Couldn’t react to that."); }
}

function paintReactions(messageId, reactions, chat) {
  const row = document.querySelector(`.msg[data-id="${CSS.escape(messageId)}"]`);
  if (!row) return;
  const msg = row._msg;
  msg.reactions = reactions;
  row.querySelector(".reactions").replaceWith(reactionsEl(msg, chat));
}

/* ---------- A group invite, as a card ---------- */
function groupInviteCard(gi) {
  if (gi.gone) return h("div", { class: "gi-card gone" }, h("b", { text: "📨 This group doesn’t exist anymore." }));
  const go = h("button", { type: "button", class: "btn btn-primary btn-sm gi-join", text: gi.member ? "Open the group" : gi.expired ? "Invite expired" : "Join group", disabled: !gi.member && gi.expired });
  go.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (gi.member) return navigate(`/messages/${gi.chatId}`);
    go.disabled = true; go.textContent = "Joining…";
    try { await api(`/api/invites/${encodeURIComponent(gi.code)}/accept`, { method: "POST" }); emit("chats:changed"); toast(`🎉 You joined ${gi.name}!`); navigate(`/messages/${gi.chatId}`); }
    catch (err) { toast(err.error || "Couldn’t join."); go.disabled = false; go.textContent = "Join group"; }
  });
  return h("div", { class: "gi-card", style: gi.color ? `--gc:${gi.color}` : "" },
    h("div", { class: "gi-top", style: gi.cover ? `background-image:url("${gi.cover}")` : "" }),
    h("div", { class: "gi-body" },
      h("small", { class: "gi-label", text: "📨 Invite to a group" }),
      h("b", { class: "gi-name", text: gi.name }),
      gi.description ? h("p", { class: "gi-desc", text: gi.description }) : null,
      h("span", { class: "gi-members", text: `${gi.members} ${gi.members === 1 ? "member" : "members"}` }),
      go));
}

/* ---------- Polls in chats ---------- */
function chatPollEl(msg, chat) {
  const p = msg.poll;
  const box = h("div", { class: "cpoll" + (p.ended ? " ended" : "") });
  const top = Math.max(0, ...p.options.map((o) => o.count));
  const info = [p.multi ? "Pick as many as you like" : "Pick one", p.anonymous ? "Anonymous" : null,
    p.ended ? "Ended" : p.endsAt ? `Ends ${new Date(p.endsAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : null].filter(Boolean).join(" · ");
  box.append(h("div", { class: "cpoll-head" }, h("span", { class: "cpoll-ic", text: "📊" }), h("b", { class: "cpoll-q", text: p.question })), h("small", { class: "cpoll-info", text: info }));
  for (const o of p.options) {
    const mine = p.mine.includes(o.id), pct = p.total ? Math.round((o.count / p.total) * 100) : 0;
    const b = h("button", { type: "button", class: "cpoll-opt" + (mine ? " mine" : "") + (p.ended && o.count === top && top > 0 ? " win" : ""), disabled: p.ended || chat.member === false },
      h("i", { class: "cpoll-fill", style: `width:${pct}%` }),
      h("span", { class: "cpoll-check", text: mine ? "✓" : "" }),
      h("span", { class: "cpoll-text", text: o.text }),
      o.voters.length ? h("span", { class: "cpoll-faces" }, ...o.voters.slice(0, 3).map((u) => avatar(u, 18))) : null,
      h("b", { class: "cpoll-pct", text: p.total ? `${pct}%` : "" }));
    b.title = p.anonymous ? `${o.count} ${o.count === 1 ? "vote" : "votes"}` : o.voters.map((u) => u.name).join(", ") || "No votes yet";
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      try { const r = await api(`/api/chats/${chat.id}/messages/${msg.id}/vote`, { method: "POST", body: { optionId: o.id } }); paintPoll(msg.id, r.poll, chat); }
      catch (err) { toast(err.error || "Couldn’t vote."); }
    });
    box.append(b);
  }
  const foot = h("div", { class: "cpoll-foot" }, h("span", { class: "muted", text: `${p.total} ${p.total === 1 ? "vote" : "votes"}` }));
  if (!p.anonymous && p.total) {
    const who = h("button", { type: "button", class: "cpoll-link", text: "See votes" });
    who.addEventListener("click", (e) => {
      e.stopPropagation();
      modal({ title: p.question, body: h("div", { class: "cpoll-votes" }, ...p.options.map((o) => h("div", { class: "cpoll-vgroup" },
        h("b", { text: `${o.text} · ${o.count}` }),
        ...(o.voters.length ? o.voters.map((u) => h("div", { class: "conn-row" }, avatar(u, 30), h("span", { text: u.name }))) : [h("p", { class: "muted", text: "Nobody yet" })])))) });
    });
    foot.append(who);
  }
  if (p.isAuthor && !p.ended) {
    const end = h("button", { type: "button", class: "cpoll-link", text: "End poll" });
    end.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!end.dataset.sure) { end.dataset.sure = "1"; end.textContent = "End it for everyone?"; return; }
      try { const r = await api(`/api/chats/${chat.id}/messages/${msg.id}/vote`, { method: "POST", body: { close: true } }); paintPoll(msg.id, r.poll, chat); } catch (err) { toast(err.error || "Couldn’t end it."); }
    });
    foot.append(end);
  }
  box.append(foot);
  return box;
}
function paintPoll(messageId, poll, chat) {
  const row = document.querySelector(`.msg[data-id="${CSS.escape(messageId)}"]`);
  if (!row) return;
  row._msg.poll = poll;
  row.querySelector(".cpoll")?.replaceWith(chatPollEl(row._msg, chat));
}
function openPollForm(onCreate) {
  const q = h("input", { type: "text", class: "text-input", maxlength: 200, placeholder: "Ask a question…" });
  const opts = h("div", { class: "cpoll-form-opts" });
  const addOpt = (v = "") => {
    if (opts.children.length >= 10) return;
    const i = h("input", { type: "text", class: "text-input", maxlength: 80, placeholder: `Answer ${opts.children.length + 1}`, value: v });
    const rm = h("button", { type: "button", class: "icon-btn cpoll-rm", "aria-label": "Remove answer" }, icon("close"));
    const row = h("div", { class: "cpoll-form-row" }, i, rm);
    rm.addEventListener("click", () => { if (opts.children.length > 2) { row.remove(); paintAdd(); } });
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (row === opts.lastChild && i.value.trim()) { addOpt(); opts.lastChild.querySelector("input").focus(); } } });
    opts.append(row); paintAdd();
  };
  const add = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "＋ Add answer" });
  const paintAdd = () => { add.hidden = opts.children.length >= 10; };
  add.addEventListener("click", () => { addOpt(); opts.lastChild.querySelector("input").focus(); });
  addOpt(); addOpt();
  let multi = false, anonymous = false, hours = 0;
  const toggle = (label, get, set) => { const b = h("button", { type: "button", class: "cpoll-toggle" }); const paint = () => { b.classList.toggle("on", get()); b.textContent = (get() ? "✓ " : "") + label; }; b.addEventListener("click", () => { set(!get()); paint(); }); paint(); return b; };
  const ends = h("div", { class: "cpoll-ends" }, h("span", { class: "muted", text: "Ends" }), ...[[0, "Never"], [1, "1 h"], [24, "1 day"], [72, "3 days"], [168, "1 week"]].map(([v, l]) => {
    const b = h("button", { type: "button", class: "cpoll-chip" + (hours === v ? " on" : ""), text: l });
    b.addEventListener("click", () => { hours = v; ends.querySelectorAll(".cpoll-chip").forEach((x) => x.classList.toggle("on", x === b)); });
    return b;
  }));
  const go = h("button", { type: "button", class: "btn btn-primary btn-full", text: "📊 Send poll" });
  const md = modal({ title: "New poll", body: h("div", { class: "create-form cpoll-form" }, q, h("b", { class: "vis-label", text: "Answers" }), opts, add,
    h("div", { class: "cpoll-toggles" }, toggle("Multiple answers", () => multi, (v) => (multi = v)), toggle("Anonymous", () => anonymous, (v) => (anonymous = v))), ends, go) });
  go.addEventListener("click", async () => {
    const options = [...opts.querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean);
    if (!q.value.trim()) return q.focus();
    if (options.length < 2) return toast("Add at least 2 answers.");
    go.disabled = true;
    try { await onCreate({ question: q.value, options, multi, anonymous, hours: hours || null }); md.close(); }
    catch (err) { toast(err.error || "Couldn’t send the poll."); go.disabled = false; }
  });
  setTimeout(() => q.focus(), 60);
}

// Hype (like trending): a 🔥 count under the message; hot messages glow
function hypeEl(msg, chat) {
  const b = h("button", { type: "button", class: "msg-hype" + (msg.hypedByMe ? " on" : "") + (msg.hypes >= 3 ? " hot" : ""), hidden: !msg.hypes, title: msg.hypedByMe ? "You hyped this" : "Hype it", "aria-label": `${msg.hypes || 0} hypes` },
    h("span", { text: "🔥" }), h("b", { text: String(msg.hypes || 0) }), msg.hypes >= 3 ? h("small", { text: "TRENDING" }) : null);
  b.addEventListener("click", (e) => { e.stopPropagation(); hype(msg, chat); });
  return b;
}
async function hype(msg, chat) {
  if (chat.member === false) return toast("Join to hype messages.");
  try {
    const r = await api(`/api/chats/${chat.id}/messages/${msg.id}/hype`, { method: "POST" });
    paintHype(msg.id, r.hypes, chat, r.hypedByMe);
    if (r.hypedByMe) hypeBurst(msg.id);
  } catch (err) { toast(err.error || "Couldn’t hype it."); }
}
function paintHype(messageId, hypes, chat, mine) {
  const row = document.querySelector(`.msg[data-id="${CSS.escape(messageId)}"]`);
  if (!row) return;
  row._msg.hypes = hypes;
  if (mine !== undefined) row._msg.hypedByMe = mine;
  row.querySelector(".msg-hype")?.replaceWith(hypeEl(row._msg, chat));
  row.classList.toggle("hot", hypes >= 3);
}
function hypeBurst(messageId) {
  const row = document.querySelector(`.msg[data-id="${CSS.escape(messageId)}"] .bubble`);
  if (!row) return;
  for (let i = 0; i < 6; i++) { const f = h("span", { class: "hype-fly", text: "🔥", style: `--dx:${(i - 2.5) * 14}px;--d:${i * 40}ms` }); row.append(f); setTimeout(() => f.remove(), 900); }
}
// The chat's trending messages, ranked by hype
function openTrending(chat, channelId, jump) {
  let period = "week";
  const list = h("div", { class: "ht-list" }, spinner());
  const tabs = h("div", { class: "ht-tabs" }, ...[["day", "Today"], ["week", "This week"], ["month", "This month"], ["all", "All time"]].map(([k, l]) => {
    const b = h("button", { type: "button", class: "ht-tab" + (k === period ? " on" : ""), text: l });
    b.addEventListener("click", () => { period = k; tabs.querySelectorAll(".ht-tab").forEach((x) => x.classList.toggle("on", x === b)); load(); });
    return b;
  }));
  const md = modal({ title: "🔥 Trending here", body: h("div", { class: "ht" }, tabs, list) });
  async function load() {
    list.replaceChildren(spinner());
    try {
      const { messages } = await api(`/api/chats/${chat.id}/trending?period=${period}${channelId ? "&channelId=" + encodeURIComponent(channelId) : ""}`);
      list.replaceChildren(...(messages.length ? messages.map((m, i) => {
        const what = m.text || (m.media?.gif ? "GIF" : m.media?.kind === "image" ? "📷 Photo" : m.media?.kind === "video" ? "🎬 Video" : m.media?.kind === "file" ? "📎 " + (m.media.name || "File") : m.media?.kind === "audio" ? (m.media.file ? "🎵 " + (m.media.name || "Audio") : "🎤 Voice message") : m.post ? "📝 Shared a post" : "Message");
        const row = h("button", { type: "button", class: "ht-row" + (i < 3 ? " top" : "") },
          h("span", { class: "ht-rank", text: i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "#" + (i + 1) }),
          avatar(m.author, 34),
          h("span", { class: "ht-body" }, h("b", { text: m.author.nickname || m.author.name }), h("span", { class: "ht-text", text: what }), h("small", { class: "muted", text: new Date(m.createdAt).toLocaleString() })),
          h("span", { class: "ht-count" + (m.hypedByMe ? " on" : "") }, "🔥 ", h("b", { text: String(m.hypes) })));
        row.addEventListener("click", () => { md.close(); jump(m.id); });
        return row;
      }) : [empty("Nothing’s hyped yet.", "Tap 🔥 on a message to hype it. The most hyped ones show up here.")]));
    } catch (err) { list.replaceChildren(empty("Couldn’t load it.", err.error || "")); }
  }
  load();
}

// Notes on a message: sticky notes from the chat's members, under the bubble
const MSG_NOTE_COLORS = ["yellow", "pink", "mint", "sky", "lilac", "peach"];
function notesEl(msg, chat) {
  const box = h("div", { class: "msg-notes" });
  for (const n of msg.notes || []) {
    const del = n.canDelete ? h("button", { type: "button", class: "mn-del", title: "Remove note", "aria-label": "Remove note", text: "✕" }) : null;
    del?.addEventListener("click", async (e) => {
      e.stopPropagation();
      try { const r = await api(`/api/chats/${chat.id}/messages/${msg.id}/notes/${n.id}`, { method: "DELETE" }); paintNotes(msg.id, r.notes, chat); } catch (err) { toast(err.error || "Couldn’t remove it."); }
    });
    box.append(h("div", { class: "msg-note mn-" + n.color, title: new Date(n.at).toLocaleString() },
      h("b", { class: "mn-who", text: n.mine ? "You" : n.author.name }), h("span", { class: "mn-text", text: n.text }), del));
  }
  return box;
}
function paintNotes(messageId, notes, chat) {
  const row = document.querySelector(`.msg[data-id="${CSS.escape(messageId)}"]`);
  if (!row) return;
  row._msg.notes = notes;
  row.querySelector(".msg-notes")?.replaceWith(notesEl(row._msg, chat));
}
function addNote(msg, chat) {
  let color = "yellow";
  const text = h("textarea", { class: "text-input mn-input", maxlength: 140, rows: 3, placeholder: "Leave a note on this message…" });
  const left = h("small", { class: "muted", text: "140" });
  text.addEventListener("input", () => { left.textContent = String(140 - text.value.length); });
  const colors = h("div", { class: "mn-colors" }, ...MSG_NOTE_COLORS.map((c) => {
    const b = h("button", { type: "button", class: "mn-sw mn-" + c + (c === color ? " on" : ""), "aria-label": c });
    b.addEventListener("click", () => { color = c; [...colors.children].forEach((x) => x.classList.toggle("on", x === b)); });
    return b;
  }));
  const go = h("button", { type: "button", class: "btn btn-primary btn-full", text: "🗒 Stick the note" });
  const quote = msg.text ? h("p", { class: "mn-quote", text: msg.text.length > 120 ? msg.text.slice(0, 120) + "…" : msg.text }) : null;
  const md = modal({ title: "Note on a message", body: h("div", { class: "create-form" }, quote, text, h("div", { class: "mn-row" }, colors, left), go,
    h("p", { class: "create-hint", text: "Everyone in this chat sees your note under the message." })) });
  const send = async () => {
    if (!text.value.trim()) return text.focus();
    go.disabled = true;
    try { const r = await api(`/api/chats/${chat.id}/messages/${msg.id}/notes`, { method: "POST", body: { text: text.value, color } }); paintNotes(msg.id, r.notes, chat); md.close(); }
    catch (err) { toast(err.error || "Couldn’t add the note."); go.disabled = false; }
  };
  go.addEventListener("click", send);
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  setTimeout(() => text.focus(), 60);
}

function replyQuote(r) {
  if (r.deleted) return h("div", { class: "reply-quote gone", text: "Original message was deleted" });
  const q = h("button", { type: "button", class: "reply-quote", title: "Show the original message" },
    r.thumb ? h("img", { src: r.thumb, alt: "" }) : null,
    h("span", { class: "rq-text" }, h("b", { text: r.author }), h("span", { text: r.text || "Message" }))
  );
  q.addEventListener("click", () => {
    const orig = document.querySelector(`.msg[data-id="${CSS.escape(r.id)}"]`);
    if (!orig) return toast("That message is further up. Scroll up to load it.");
    orig.scrollIntoView({ behavior: "smooth", block: "center" });
    orig.classList.remove("flash");
    void orig.offsetWidth;
    orig.classList.add("flash");
  });
  return q;
}

// Call notes ("📞 Video call · 1:23", "📞 Missed voice call (declined)") read with the other person's name
export function callNoteText(text, mine, name) {
  const m = /^📞 (Missed )?(video|voice) call(?: · (\d+:\d\d))?( \(declined\))?$/i.exec(text || "");
  if (!m) return null;
  const kind = m[2].toLowerCase() === "video" ? "Video call" : "Voice call";
  if (!m[1]) return { missed: false, video: kind === "Video call", title: `${kind} with ${name}`, sub: m[3] ? `Talked for ${m[3]}` : "" };
  if (mine) return { missed: true, video: kind === "Video call", title: m[4] ? `${name} declined your ${kind.toLowerCase()}` : `${name} didn’t answer`, sub: kind };
  return { missed: true, video: kind === "Video call", title: `Missed ${kind.toLowerCase()} from ${name}`, sub: m[4] ? "You declined" : "Tap the phone to call back" };
}

// Set by the open conversation so a message's Reply button can start a reply
let startReply = null;
let gifReply = null; // (gif, message) => send a GIF as an answer

function eventCard(ev, chat) {
  const when = new Date(ev.startsAt);
  const going = h("button", { type: "button", class: "btn btn-xs " + (ev.mine ? "btn-following" : "btn-primary"), text: ev.mine ? "Going ✓" : "I’m going" });
  going.addEventListener("click", async () => {
    try { const { event } = await api(`/api/groups/${chat.id}/events/${ev.id}/going`, { method: "POST" }); if (event) { Object.assign(ev, event); card.replaceWith(eventCard(ev, chat)); } }
    catch (err) { toast(err.error || "Couldn’t save that."); }
  });
  const card = h("div", { class: "event-card" },
    h("div", { class: "ev-date" }, h("b", { text: when.toLocaleDateString("en-US", { day: "numeric" }) }), h("span", { text: when.toLocaleDateString("en-US", { month: "short" }) })),
    h("div", { class: "ev-text" }, h("b", { text: ev.title }),
      h("span", { class: "muted", text: when.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) + ` · ${ev.going} going` }),
      ev.description ? h("p", { text: ev.description }) : null),
    going);
  return card;
}

// A group invite link inside a message becomes a card with a Join button
function inviteCard(code) {
  const card = h("div", { class: "invite-mini" }, spinner());
  api(`/api/invites/${encodeURIComponent(code)}`).then(({ group: g }) => {
    const join = h("button", { type: "button", class: "btn btn-xs btn-primary", text: g.member ? "Open" : "Join" });
    join.addEventListener("click", async (e) => {
      e.stopPropagation();
      try { const { chatId } = await api(`/api/invites/${encodeURIComponent(code)}/accept`, { method: "POST" }); emit("chats:changed"); navigate(`/messages/${chatId}`); }
      catch (err) { toast(err.error || "Couldn’t join."); }
    });
    card.style.setProperty("--group", g.color || "#ff4fa3");
    card.replaceChildren(chatPic(g, 44), h("div", { class: "im-text" }, h("b", { text: g.name }), h("span", { class: "muted", text: `${plural(g.memberCount, "member", "members")} · ${g.onlineCount} online` })), join);
  }).catch(() => card.replaceChildren(h("span", { class: "muted", text: "This invite has expired." })));
  return card;
}

// A public event link inside a message becomes a card
function eventLinkCard(id) {
  const card = h("a", { class: "event-mini", href: `/event/${id}` }, spinner());
  api(`/api/public-events/${encodeURIComponent(id)}`).then(({ event: ev }) => {
    const d = new Date(ev.startsAt);
    card.replaceChildren(
      h("div", { class: "em-cover", style: ev.cover ? `background-image:url("${ev.cover}")` : "" }),
      h("div", { class: "em-body" },
        h("span", { class: "em-when", text: d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }),
        h("b", { text: ev.title }),
        h("span", { class: "muted", text: (ev.location ? ev.location + " · " : "") + `${ev.going} going` })),
      h("span", { class: "btn btn-xs " + (ev.mine ? "btn-following" : "btn-primary"), text: ev.mine ? "Going ✓" : ev.isHost ? "Hosting" : "View" }));
  }).catch(() => card.replaceChildren(h("span", { class: "muted", text: "This event was cancelled." })));
  return card;
}

/* ---------- Translate a message ---------- */
const TR_LANGS = [["en", "English"], ["bg", "Български"], ["es", "Español"], ["ru", "Русский"], ["de", "Deutsch"], ["sr", "Srpski"], ["ro", "Română"], ["fr", "Français"], ["it", "Italiano"], ["tr", "Türkçe"], ["el", "Ελληνικά"]];
async function translateMessage(msg, bubble, toLang = null) {
  const old = bubble.querySelector(".tr-block");
  if (old && !toLang) return old.remove();
  const box = old || h("div", { class: "tr-block" });
  if (!old) bubble.querySelector(".bubble-text")?.after(box);
  box.replaceChildren(h("span", { class: "muted", text: "Translating…" }));
  let to = toLang;
  if (!to) { try { to = localStorage.getItem("lb-tr-to") || localStorage.getItem("lb-lang") || "en"; } catch { to = "en"; } }
  try {
    const r = await api("/api/translate", { method: "POST", body: { messageId: msg.id, to } });
    const same = r.text.trim() === (msg.text || "").trim();
    // Pick another language right here
    const pick = h("select", { class: "tr-pick", "aria-label": "Translate to" }, ...TR_LANGS.map(([id, name]) => h("option", { value: id, text: name, selected: id === to })));
    pick.addEventListener("change", () => { try { localStorage.setItem("lb-tr-to", pick.value); } catch {} translateMessage(msg, bubble, pick.value); });
    const hide = h("button", { type: "button", class: "tr-hide", text: "Hide" });
    hide.addEventListener("click", () => box.remove());
    box.replaceChildren(
      h("div", { class: "tr-top" }, h("span", { class: "tr-label", text: same ? "Already in this language · translate to" : `Translated${r.from ? " from " + r.from.toUpperCase() : ""} · to` }), pick),
      same ? null : h("p", { class: "tr-text", text: r.text }), hide);
  } catch (err) { box.replaceChildren(h("span", { class: "muted", text: err.error || "Couldn’t translate it." })); }
}

// The sheet for a disappearing photo or video: preview, how it can be seen, send
function openDisappearing(file, send) {
  let mode = "once", sending = false;
  const err = h("p", { class: "form-error", hidden: true });
  const sendBtn = h("button", { type: "button", class: "btn btn-primary btn-full", disabled: true, text: "Uploading…" });
  const picker = createPicker({ accept: "both", max: 1, onChange: () => paint(), onError: (t) => { err.textContent = t; err.hidden = !t; } });
  const caption = h("input", { type: "text", class: "text-input", maxlength: 300, placeholder: "Add a message (optional)" });
  const MODES = [["once", "View once", "①"], ["replay", "Allow replay", "②"], ["keep", "Keep in chat", "∞"]];
  const modes = h("div", { class: "dp-modes", role: "radiogroup" }, ...MODES.map(([k, label, ic]) => {
    const b = h("button", { type: "button", class: "dp-mode" + (k === mode ? " on" : ""), role: "radio", "aria-checked": String(k === mode) }, h("span", { class: "dp-ic", text: ic }), h("b", { text: label }));
    b.addEventListener("click", () => { mode = k; modes.querySelectorAll(".dp-mode").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", String(x === b)); }); paint(); });
    return b;
  }));
  const hint = h("p", { class: "create-hint" });
  function paint() {
    const ready = picker.media().length && !picker.busy();
    sendBtn.disabled = !ready || sending;
    sendBtn.textContent = sending ? "Sending…" : !ready ? "Uploading…" : mode === "keep" ? "Send" : "Send disappearing " + (picker.items()[0]?.kind === "video" ? "video" : "photo");
    hint.textContent = mode === "once" ? "They can open it one time, then it’s gone." : mode === "replay" ? "They can open it twice, then it’s gone." : "It stays in the chat like a normal message.";
  }
  const m = modal({ title: "Disappearing photo", onClose: () => picker.clear(), body: h("div", { class: "create-form dp-sheet" }, picker.previews, modes, hint, caption, err, sendBtn) });
  picker.add([file]);
  paint();
  sendBtn.addEventListener("click", async () => {
    sending = true; paint();
    try {
      await send({ text: caption.value, media: picker.media()[0], ...(mode === "keep" ? {} : { viewOnce: mode === "replay" ? "replay" : true }) });
      m.close();
    } catch (ex) { err.textContent = ex.error || "Couldn’t send it."; err.hidden = false; sending = false; paint(); }
  });
}

// A view-once message: the others tap to open it one time; the sender sees who opened it
function viewOnceRow(msg, chat, onRemoved) {
  const v = msg.viewOnce;
  const what = v.kind === "image" ? "photo" : v.kind === "video" ? "video" : "message";
  let label, sub = null, openable = false;
  if (msg.mine) {
    label = `View-once ${what}`;
    sub = v.everyone ? "Opened" : v.openedCount ? `Opened by ${v.openedCount}` : "Sent";
    if (v.replay) sub += " · replay allowed";
  } else if (v.opened) label = "Opened";
  else if (v.replayLeft) { label = `Tap to replay ${what}`; openable = true; }
  else { label = `Tap to view ${what}`; openable = true; }
  const bubble = h(openable ? "button" : "div", { type: openable ? "button" : null, class: "bubble vo-bubble" + (openable ? " vo-closed" : " vo-done") },
    chat.kind === "group" && !msg.mine ? h("span", { class: "bubble-name", text: shownName(msg.author) }) : null,
    h("span", { class: "vo-line" }, h("span", { class: "vo-ic", text: v.kind === "image" ? "📷" : v.kind === "video" ? "🎬" : "👁" }), h("b", { text: label }), sub ? h("small", { text: " · " + sub }) : null),
    h("span", { class: "bubble-time" }, timeEl(msg.createdAt)));
  if (openable) bubble.addEventListener("click", () => openViewOnce(msg, chat, row));
  const row = h("div", { class: "msg vo" + (msg.mine ? " mine" : ""), dataset: { id: msg.id } },
    msg.mine ? null : h("a", { href: profileHref(msg.author.username), class: "msg-avatar", tabindex: "-1" }, avatar(msg.author, 34)),
    h("div", { class: "msg-stack" }, bubble, reactionsEl(msg, chat)));
  if (msg.mine) {
    const del = h("button", { type: "button", class: "tool-icon msg-del", "aria-label": "Delete message", title: "Delete message" }, icon("trash"));
    del.addEventListener("click", async () => { try { await api(`/api/chats/${chat.id}/messages/${msg.id}`, { method: "DELETE" }); row.remove(); onRemoved?.(); } catch (err) { toast(err.error || "Couldn’t delete it."); } });
    row.append(h("div", { class: "msg-tools" }, del));
  }
  row._msg = msg;
  return row;
}
async function openViewOnce(msg, chat, row) {
  let c;
  try { c = await api(`/api/chats/${chat.id}/messages/${msg.id}/open`, { method: "POST" }); }
  catch (err) { toast(err.error || "It’s gone."); msg.viewOnce.opened = true; row.replaceWith(viewOnceRow(msg, chat)); return; }
  const firstOfTwo = msg.viewOnce.replay && !msg.viewOnce.replayLeft;
  msg.viewOnce.opened = !firstOfTwo;
  msg.viewOnce.replayLeft = firstOfTwo;
  const shown = viewOnceRow(msg, chat);
  row.replaceWith(shown);
  // Shown once, full screen; closing it is the end
  const box = h("div", { class: "vo-view", role: "dialog", "aria-modal": "true", "aria-label": "View once" },
    h("div", { class: "vo-top" }, avatar(msg.author, 30), h("b", { text: shownName(msg.author) }), h("span", { class: "muted", text: firstOfTwo ? "You can replay it one more time" : "View once · it’s gone when you close it" })),
    c.media?.kind === "image" ? h("img", { class: "vo-media", src: c.media.url, alt: "" })
      : c.media?.kind === "video" ? h("video", { class: "vo-media", src: c.media.url, poster: c.media.poster || null, autoplay: true, playsInline: true, controls: true })
      : null,
    c.text ? h("p", { class: "vo-text", text: c.text }) : null,
    h("button", { type: "button", class: "btn btn-primary vo-close", text: "Close" }));
  const close = () => { box.querySelector("video")?.pause(); box.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  box.querySelector(".vo-close").addEventListener("click", close);
  box.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keydown", onKey);
  document.body.append(box);
}

// Like Instagram: pull a message to the right to answer it (finger or mouse)
// Hold a message (or right-click it): it lifts up, gets bigger, everything behind it blurs,
// and its reactions and options show around it
function holdForMenu(row, bubble, tools, msg, chat) {
  if (msg.system) return;
  let t = null, start = null;
  const cancel = () => { clearTimeout(t); t = null; start = null; };
  bubble.addEventListener("pointerdown", (e) => {
    if (e.button || e.target.closest("a, button, video, input, .lb-player, .cpoll, .game-bubble")) return;
    start = { x: e.clientX, y: e.clientY };
    t = setTimeout(() => { t = null; bubble._held = Date.now(); navigator.vibrate?.(12); openMsgMenu(row, bubble, tools, msg, chat); }, 430);
  });
  // (letting go after the hold isn't a tap)
  bubble.addEventListener("click", (e) => { if (Date.now() - (bubble._held || 0) < 700) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  bubble.addEventListener("pointermove", (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel(); });
  bubble.addEventListener("pointerup", cancel); bubble.addEventListener("pointercancel", cancel); bubble.addEventListener("pointerleave", cancel);
  bubble.addEventListener("contextmenu", (e) => { if (e.target.closest("a, video, input")) return; e.preventDefault(); cancel(); openMsgMenu(row, bubble, tools, msg, chat); });
}
function openMsgMenu(row, bubble, tools, msg, chat) {
  if (document.querySelector(".mm-overlay")) return;
  const from = bubble.getBoundingClientRect();
  const close = () => {
    overlay.classList.add("out");
    row.classList.remove("mm-lifted");
    removeEventListener("keydown", onKey);
    overlay.style.pointerEvents = "auto"; // (it stays a moment, invisible, so the tap doesn't land on what's under it)
    setTimeout(() => overlay.remove(), 420);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  // Reactions on top
  const reacts = chat.member !== false ? h("div", { class: "mm-reacts" }, ...QUICK.map((e) => {
    const b = h("button", { type: "button", class: "mm-react" + (msg.reactions?.mine === e ? " on" : ""), text: e, "aria-label": `React ${e}` });
    b.addEventListener("click", () => { react(msg, chat, e); close(); });
    return b;
  }), (() => { const m = h("button", { type: "button", class: "mm-react more", "aria-label": "More reactions" }, h("span", { text: "＋" })); m.addEventListener("click", () => { close(); setTimeout(() => openEmojiPicker(bubble, (e) => react(msg, chat, e)), 200); }); return m; })()) : null;
  // The message itself, bigger
  const copy = bubble.cloneNode(true);
  copy.classList.add("mm-bubble");
  copy.classList.remove("fx-ink");
  copy.style.width = from.width + "px";
  // Its options (the same as its little menu), plus copy
  const actions = h("div", { class: "mm-actions" });
  const add = (icn, label, fn, danger = false) => {
    const b = h("button", { type: "button", class: "mm-action" + (danger ? " danger" : "") }, h("span", { class: "mm-label", text: label }), h("span", { class: "mm-ic" }, icn));
    b.addEventListener("click", () => { close(); setTimeout(fn, 120); });
    actions.append(b);
  };
  for (const b of tools.querySelectorAll("button")) {
    if (b.classList.contains("quick-react") || b.getAttribute("aria-label") === "More reactions") continue;
    const label = (b.getAttribute("aria-label") || b.getAttribute("title") || "").replace(/ \(.*\)$/, "");
    if (!label) continue;
    const ic = h("span", {}, ...[...b.childNodes].map((n) => n.cloneNode(true)));
    const del = b.classList.contains("msg-del");
    add(ic, del ? "Delete" : label, () => { b.click(); if (del) setTimeout(() => b.click(), 30); }, del);
  }
  if (msg.text) add(h("span", { text: "📋" }), "Copy text", () => navigator.clipboard?.writeText(msg.text).then(() => toast("Copied.")).catch(() => {}));
  const stack = h("div", { class: "mm-stack" + (msg.mine ? " mine" : "") }, reacts, copy, actions);
  const overlay = h("div", { class: "mm-overlay", role: "dialog", "aria-label": "Message options" }, stack);
  // (letting go of the hold isn't a tap: only a new tap on the blur closes it)
  let fresh = false;
  overlay.addEventListener("pointerdown", () => { fresh = true; });
  overlay.addEventListener("click", (e) => { if (fresh && (e.target === overlay || e.target === stack)) close(); });
  for (const b of [...actions.children, ...(reacts?.children || [])]) b.addEventListener("click", (e) => { if (!fresh) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  document.body.append(overlay);
  addEventListener("keydown", onKey);
  row.classList.add("mm-lifted");
  // It grows out of where the message was
  const to = copy.getBoundingClientRect();
  copy.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2, 1.1, .3, 1)" });
}

// Swipe to reply: someone else's message to the right, my own (on the right side) to the left
function swipeToReply(row, msg) {
  const dir = msg.mine ? -1 : 1;
  const stack = row.querySelector(".msg-stack"), face = row.querySelector(".msg-avatar");
  const moving = [stack, face].filter(Boolean);
  const arrow = h("span", { class: "swipe-reply", "aria-hidden": "true" }, icon("replyArrow"));
  row.prepend(arrow);
  const LIMIT = 84, TRIGGER = 58;
  let start = null, dx = 0, going = false, armed = false, swiped = false;
  const reset = () => {
    for (const el of [...moving, arrow]) el.style.transition = "transform 0.22s cubic-bezier(.2, .9, .3, 1.2), opacity 0.2s";
    for (const el of moving) el.style.transform = "";
    arrow.style.opacity = "0"; arrow.style.transform = "";
    setTimeout(() => { for (const el of [...moving, arrow]) el.style.transition = ""; }, 240);
  };
  row.addEventListener("pointerdown", (e) => {
    if (e.button || e.target.closest("button, a, input, textarea, video, .lb-player, .reaction, .msg-tools")) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId }; dx = 0; going = armed = swiped = false;
  });
  row.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const mx = (e.clientX - start.x) * dir, my = e.clientY - start.y;
    if (!going) {
      if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) { start = null; return; } // scrolling up or down
      if (mx < 12 || mx < Math.abs(my) * 1.4) return;
      going = true; swiped = true;
      try { row.setPointerCapture(e.pointerId); } catch {}
      getSelection?.()?.removeAllRanges();
    }
    e.preventDefault();
    dx = Math.max(0, Math.min(LIMIT, mx * 0.62));
    for (const el of moving) el.style.transform = `translateX(${dx * dir}px)`;
    arrow.style.opacity = String(Math.min(1, dx / TRIGGER));
    arrow.style.transform = `scale(${0.6 + Math.min(1, dx / TRIGGER) * 0.4})`;
    if (dx >= TRIGGER && !armed) { armed = true; arrow.classList.add("armed"); navigator.vibrate?.(8); }
    else if (dx < TRIGGER && armed) { armed = false; arrow.classList.remove("armed"); }
  });
  const end = () => {
    if (!start) return;
    start = null;
    if (going) {
      arrow.classList.remove("armed");
      if (armed) startReply?.(msg);
      reset();
    }
    going = false;
  };
  row.addEventListener("pointerup", end);
  row.addEventListener("pointercancel", end);
  // A swipe isn't a tap (no menu, no link)
  row.addEventListener("click", (e) => { if (swiped) { e.stopPropagation(); e.preventDefault(); swiped = false; } }, true);
}

// A sensitive (18+) photo or video in a message is blurred for the others until they tap "View"
const sensitive = (msg, el) => (msg.mine ? el : msg.media?.nsfw ? nsfwWrap(el, "photo", "nsfw") : msg.media?.sensitive ? nsfwWrap(el, "photo", "sensitive") : el);

function messageEl(msg, chat, onRemoved) {
  // Small notes in the middle ("📅 New event", nickname changes)
  if (msg.system) {
    const ev = msg.event && chat.events?.find((e) => e.id === msg.event);
    const row = h("div", { class: "msg system", dataset: { id: msg.id } },
      h("p", { class: "sys-note" }, h("span", { text: msg.text }), h("span", { class: "muted" }, " · ", timeEl(msg.createdAt))),
      ev ? eventCard(ev, chat) : null);
    row._msg = msg;
    return row;
  }
  const media = msg.game ? gameView(chat.id, msg.id, msg.game)
    : msg.poll ? chatPollEl(msg, chat)
    : msg.groupInvite ? groupInviteCard(msg.groupInvite)
    : msg.media?.gif ? h("img", { class: "msg-gif", src: msg.media.url, alt: "GIF" })
    : msg.media?.sticker ? h("img", { class: "sticker-img", src: msg.media.url, alt: "Sticker" })
    : msg.media?.kind === "sound" ? soundChip(msg.media)
    : msg.media?.kind === "file" ? fileCard(msg.media)
    : msg.media?.kind === "audio" && msg.media.file ? audioFileCard(msg.media)
    : msg.media?.kind === "audio" ? voicePlayer(msg.media)
    : msg.media
    ? sensitive(msg, msg.media.kind === "image"
      ? h("a", { href: msg.media.url, target: "_blank", rel: "noopener", class: "msg-media" }, h("img", { src: msg.media.url, alt: "", loading: "lazy" }))
      : createPlayer({ src: msg.media.url, poster: msg.media.poster || null, width: msg.media.width, height: msg.media.height, className: "msg-media" }))
    : null;
  if (msg.viewOnce) return viewOnceRow(msg, chat, onRemoved);
  const call = chat.kind === "dm" && !msg.media && !msg.post ? callNoteText(msg.text, msg.mine, chat.other.name) : null;
  const onlyEmoji = msg.text && !msg.media && !msg.post && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\u200D|\uFE0F|\s){1,24}$/u.test(msg.text) && [...msg.text.replace(/\s/g, "")].length <= 12;
  const quote = msg.replyTo ? replyQuote(msg.replyTo) : null;
  const bubble = h("div", { class: "bubble" + (msg.game ? " game-bubble" : "") + (msg.poll ? " poll-bubble" : "") + (msg.groupInvite ? " invite-bubble" : "") + (onlyEmoji && !quote && !msg.storyReply && !msg.noteReply ? " emoji-only" : "") + (msg.media?.kind === "audio" && !msg.media.file ? " voice-bubble" : "") + (msg.media?.kind === "file" || msg.media?.file ? " file-bubble" : "") + (msg.media?.sticker ? " sticker-bubble" : "") + (msg.storyReply?.reaction || msg.instantReply?.reaction ? " story-react" : "") },
    chat.kind === "group" && !msg.mine ? h("a", { class: "bubble-name", href: profileHref(msg.author.username), style: roleColor(chat, msg.author.username) }, shownName(msg.author), tick(msg.author, 13)) : null,
    quote,
    msg.storyReply ? h("div", { class: "note-quote story-quote" },
      h("small", { text: msg.storyReply.reaction ? (msg.mine ? "You reacted to their story" : "Reacted to your story") : (msg.mine ? "You replied to their story" : "Replied to your story") }),
      msg.storyReply.gone ? h("span", { class: "nq-body muted", text: "Story no longer available" })
        : h("span", { class: "nq-body" }, msg.storyReply.thumb ? h("img", { class: "sq-thumb", src: msg.storyReply.thumb, alt: "" }) : null)) : null,
    msg.instantReply ? h("div", { class: "note-quote instant-quote" },
      h("small", { text: msg.instantReply.reaction ? (msg.mine ? "You reacted to their lookture" : "Reacted to your lookture") : (msg.mine ? "You replied to their lookture" : "Replied to your lookture") }),
      h("span", { class: "nq-body muted", text: "⚡ Lookture · seen once" })) : null,
    msg.noteReply ? h("div", { class: "note-quote" },
      h("small", { text: msg.mine ? (msg.noteReply.toMe ? "Replied to your note" : "You replied to their note") : msg.noteReply.toMe ? "Replied to your note" : "Replied to a note" }),
      h("span", { class: "nq-body" }, msg.noteReply.media ? h("img", { src: msg.noteReply.media.url, alt: "" }) : null, msg.noteReply.text ? h("span", { text: msg.noteReply.text }) : null)) : null,
    msg.post ? sharedPost(msg.post) : null,
    msg.comment ? sharedComment(msg.comment) : null,
    media,
    call ? h("div", { class: "call-note" + (call.missed ? " missed" : "") }, h("span", { class: "cn-icon" }, icon(call.video ? "video" : "phone")), h("div", {}, h("b", { text: call.title }), call.sub ? h("span", { text: call.sub }) : null))
      : msg.text ? h("p", { class: "bubble-text" }, richText(msg.text, msg.mentions)) : null,
    (() => { const m = /\/invite\/([A-Za-z0-9]{6,12})\b/.exec(msg.text || ""); return m ? inviteCard(m[1]) : null; })(),
    (() => { const m = /\/event\/([\w-]{6,40})\b/.exec(msg.text || ""); return m ? eventLinkCard(m[1]) : null; })(),
    msg.text ? linkBlock(msg.text) : null,
    // A YouTube/TikTok link while I'm in this group's voice channel: watch it together
    (() => {
      const link = msg.text && /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/)[\w-]{11}|youtu\.be\/[\w-]{11}|(?:www\.|vm\.|vt\.)?tiktok\.com\/)[^\s]*/i.exec(msg.text);
      if (!link || window.__lbCurrentVoice?.()?.chatId !== chat.id) return null;
      return h("button", { type: "button", class: "btn btn-xs btn-primary wt-msg-btn", text: "📺 Watch together in voice", onclick: (e) => { e.stopPropagation(); window.__lbWatchLink?.(link[0]); } });
    })(),
    msg.song ? songChatCard(msg.song) : null,
    h("span", { class: "bubble-time" }, timeEl(msg.createdAt))
  );

  /* Hover menu: quick reactions, more emoji, delete */
  const tools = h("div", { class: "msg-tools" });
  if (chat.member !== false) {
    for (const e of QUICK) {
      const b = h("button", { type: "button", class: "quick-react", text: e, title: `React ${e}` });
      b.addEventListener("click", () => react(msg, chat, e));
      tools.append(b);
    }
    const more = h("button", { type: "button", class: "tool-icon", "aria-label": "More reactions", title: "More reactions" }, icon("smile"));
    more.addEventListener("click", () => openEmojiPicker(more, (e) => react(msg, chat, e)));
    tools.append(more);
  }
  if (msg.media?.sticker && !msg.mine) {
    const keep = h("button", { type: "button", class: "tool-icon", "aria-label": "Save sticker", title: "Save this sticker" }, icon("sticker"));
    keep.addEventListener("click", async () => {
      try { await api("/api/me/stickers", { method: "POST", body: { from: msg.media.url } }); toast("Sticker saved to your collection."); }
      catch (err) { toast(err.error || "Couldn’t save the sticker."); }
    });
    tools.prepend(keep);
  }
  // Translate into the site's language
  if (msg.text && !msg.system) {
    const tr = h("button", { type: "button", class: "tool-icon tr-btn", "aria-label": "Translate", title: "Translate" }, h("span", { text: "文A" }));
    tr.addEventListener("click", () => translateMessage(msg, bubble));
    tools.append(tr);
  }
  // Pin (direct chats: both of you · groups: admins and moderators)
  if (chat.member !== false && (chat.kind === "dm" || chat.perms?.includes("pin_messages"))) {
    const pin = h("button", { type: "button", class: "tool-icon", "aria-label": msg.pinned ? "Unpin" : "Pin", title: msg.pinned ? "Unpin" : "Pin" }, h("span", { text: "📌" }));
    pin.addEventListener("click", async () => {
      try { const { pinned } = await api(`/api/chats/${chat.id}/messages/${msg.id}/pin`, { method: "POST", body: { on: !msg.pinned } }); toast(pinned ? "Pinned." : "Unpinned."); }
      catch (err) { toast(err.error || "Couldn’t pin it."); }
    });
    tools.append(pin);
  }
  // Hype it
  if (chat.member !== false && !msg.system) {
    const hb = h("button", { type: "button", class: "tool-icon hype-tool", "aria-label": "Hype", title: msg.hypedByMe ? "Take back your hype" : "Hype it 🔥" }, h("span", { text: "🔥" }));
    hb.addEventListener("click", () => hype(row._msg || msg, chat));
    tools.prepend(hb);
  }
  // Leave a note on it
  if (chat.member !== false && !msg.system) {
    const nb = h("button", { type: "button", class: "tool-icon", "aria-label": "Add a note", title: "Add a note" }, h("span", { text: "🗒" }));
    nb.addEventListener("click", () => addNote(msg, chat));
    tools.append(nb);
  }
  if (!msg.mine && msg.author.username) {
    const flag = h("button", { type: "button", class: "tool-icon", "aria-label": "Report", title: `Report ${msg.author.name}` }, icon("flag"));
    flag.addEventListener("click", () => openReportUser(msg.author, { message: msg }));
    tools.append(flag);
  }
  if (chat.canSend) {
    const rep = h("button", { type: "button", class: "tool-icon", "aria-label": "Reply", title: "Reply" }, icon("replyArrow"));
    rep.addEventListener("click", () => startReply?.(msg));
    const gifRep = h("button", { type: "button", class: "tool-icon gif-btn", "aria-label": "Reply with a GIF", title: "Reply with a GIF" }, h("span", { text: "GIF" }));
    gifRep.addEventListener("click", () => openGifs(gifRep, (g) => gifReply?.(g, msg)));
    tools.prepend(rep, gifRep);
  }
  if (msg.mine || chat.perms?.includes("delete_messages")) {
    const del = h("button", { type: "button", class: "tool-icon msg-del", "aria-label": "Delete message", title: "Delete message" }, icon("trash"));
    confirmClick(del, "Delete?", async () => {
      try {
        await api(`/api/chats/${chat.id}/messages/${msg.id}`, { method: "DELETE" });
        row.classList.add("leaving");
        setTimeout(() => row.remove(), 200);
        onRemoved?.();
      } catch (err) { toast(err.error || "Couldn’t delete it."); }
    });
    tools.append(del);
  }

  // The sender's own message style, and invisible ink
  styleBubble(bubble, msg.style);
  if (msg.effect === "ink" && msg.text) inkBubble(bubble);
  // Secret & fun messages (a time capsule asks for its contents when it opens)
  if (PERSISTENT.has(msg.effect)) secretBubble(bubble, msg, { onUnlock: () => setTimeout(() => api(`/api/chats/${chat.id}/messages/${msg.id}`).then(({ message }) => { const row = bubble.closest(".msg"); if (row) row.replaceWith(messageEl(message, chat, onRemoved)); }).catch(() => {}), 800) });
  if (msg.pinned) bubble.prepend(h("span", { class: "pin-mark", title: "Pinned", text: "📌" }));
  if (msg.expiresAt) bubble.append(h("span", { class: "vanish-mark", title: "Disappears " + new Date(msg.expiresAt).toLocaleString(), text: "⏳" }));
  const row = h("div", { class: "msg" + (msg.mine ? " mine" : "") + (msg.pinned ? " pinned" : "") + (msg.pingsMe ? " pings-me" : "") + (msg.hypes >= 3 ? " hot" : ""), dataset: { id: msg.id, author: msg.author.username || "" } },
    msg.mine ? null : h("a", { href: profileHref(msg.author.username), class: "msg-avatar", tabindex: "-1" }, avatar(msg.author, 34)),
    h("div", { class: "msg-stack" }, bubble, h("div", { class: "msg-under" }, reactionsEl(msg, chat), hypeEl(msg, chat)), notesEl(msg, chat)),
    tools.children.length ? tools : null
  );
  row._msg = msg;
  if (chat.canSend) swipeToReply(row, msg);
  holdForMenu(row, bubble, tools, msg, chat);
  // Tap a name (or a photo) in a chat: their little profile card
  for (const el of row.querySelectorAll(".bubble-name, .msg-avatar")) {
    el.style.cursor = "pointer";
    el.addEventListener("click", (e) => { if (!msg.author?.username) return; e.preventDefault(); e.stopPropagation(); import("./mini-profile.js").then((m) => m.miniProfile(msg.author.username, el, { extra: { nickname: msg.author.nickname } })); });
  }
  // Phones have no hover: tap a message to show its menu
  bubble.addEventListener("click", (e) => {
    // (on phones the options open by holding the message instead)
    if (true || !matchMedia("(hover: none), (max-width: 640px)").matches || e.target.closest("a, video, button, .lb-player")) return;
    const open = row.classList.contains("show-tools");
    document.querySelectorAll(".msg.show-tools").forEach((x) => x.classList.remove("show-tools"));
    if (!open) row.classList.add("show-tools");
  });
  // Double-click a message to send a heart
  // Double tap (or double click) a message: no reaction from me yet → ❤️; I already reacted → it's taken back
  const heart = () => {
    const mine = (msg.reactions || []).find((x) => x.mine);
    if (mine) { sfx("unlike"); react(msg, chat, mine.emoji); return; }
    likeBurst(bubble, "❤️");
    react(msg, chat, "❤️");
  };
  bubble.addEventListener("dblclick", (e) => { if (!e.target.closest("a, video, .lb-player, .reaction")) heart(); });
  let lastTap = 0;
  bubble.addEventListener("touchend", (e) => {
    if (e.target.closest("a, video, .lb-player, .reaction, button")) return;
    const now = Date.now();
    if (now - lastTap < 300) { e.preventDefault(); heart(); lastTap = 0; } else lastTap = now;
  });
  return row;
}

/* ---------- Nicknames (direct chats: both of you can set both) ---------- */
function openNicknames(chat, refresh) {
  // You name them, they name you
  const rows = [{ username: chat.other.username, name: chat.other.name, nickname: chat.other.nickname, user: chat.other }];
  const body = h("div", { class: "create-form" }, h("p", { class: "create-hint", text: `Give ${chat.other.name} a nickname. It shows only in this chat, for both of you. Only ${chat.other.name} can give you one.` }),
    ...rows.map((r) => {
      const input = h("input", { type: "text", class: "text-input", maxlength: 32, placeholder: r.name, value: r.nickname || "" });
      const save = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "Save" });
      save.addEventListener("click", async () => {
        try { await api(`/api/chats/${chat.id}/nickname`, { method: "POST", body: { username: r.username, nickname: input.value } }); toast(input.value.trim() ? "Nickname saved." : "Nickname removed."); refresh(); }
        catch (err) { toast(err.error || "Couldn’t save it."); }
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); });
      return h("div", { class: "nick-row" }, avatar(r.user, 40), h("div", { class: "nick-main" }, h("b", { text: r.name }), h("div", { class: "nick-input" }, input, save)));
    }),
    chat.myNickname ? h("p", { class: "muted nick-mine", text: `${chat.other.name} calls you “${chat.myNickname}”.` }) : null);
  modal({ title: "Nickname", body });
}

/* ---------- Group members and adding people ---------- */
// The people in a group, in a panel from the right (like Discord): online first, then idle, then offline.
// On a phone, pull the chat to the left to open it.
function membersDrawer(chat, manage) {
  document.querySelector(".md-wrap")?.remove();
  const people = (chat.members || []).filter((u) => u.username);
  const state3 = (u) => (u.online ? (u.idle ? 1 : 0) : 2);
  const groups = [["Online", people.filter((u) => state3(u) === 0)], ["Idle", people.filter((u) => state3(u) === 1)], ["Offline", people.filter((u) => state3(u) === 2)]];
  const row = (u) => {
    const b = h("button", { type: "button", class: "md-row" + (u.online ? "" : " off") }, avatarWithPresence(u, 36),
      h("span", { class: "md-who" }, h("b", {}, u.nickname || u.name, tick(u, 13), u.isOwner ? h("span", { class: "md-crown", title: "Owner", text: "👑" }) : null),
        u.groupStatus ? h("small", { class: "muted", text: `${u.groupStatus.emoji || "💬"} ${u.groupStatus.text || ""}` }) : h("small", { class: "muted", text: "@" + u.username })));
    b.addEventListener("click", () => import("./mini-profile.js").then((m) => m.miniProfile(u.username, b, { extra: { nickname: u.nickname, groupStatus: u.groupStatus } })));
    return b;
  };
  const panel = h("aside", { class: "md-panel", role: "dialog", "aria-label": "People in this group" },
    h("div", { class: "md-head" }, h("b", { text: `People · ${people.length}` }),
      manage ? h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Manage", onclick: () => { close(); manage(); } }) : null,
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    h("div", { class: "md-list" }, ...groups.filter(([, l]) => l.length).flatMap(([t, l]) => [h("p", { class: "md-sec", text: `${t} — ${l.length}` }), ...l.map(row)])));
  const wrap = h("div", { class: "md-wrap" }, h("div", { class: "md-shade" }), panel);
  const close = () => { wrap.classList.add("out"); setTimeout(() => wrap.remove(), 220); removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  wrap.querySelector(".md-shade").addEventListener("click", close);
  addEventListener("keydown", esc);
  // pull it back to the right to close it
  let sx = null;
  panel.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  panel.addEventListener("touchmove", (e) => { if (sx == null) return; const dx = e.touches[0].clientX - sx; if (dx > 0) { panel.style.transition = "none"; panel.style.transform = `translateX(${dx}px)`; } }, { passive: true });
  panel.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; panel.style.transition = ""; panel.style.transform = ""; if (dx > 80) close(); });
  document.body.append(wrap);
}

function openMembers(chat, refresh) {
  const list = h("div", { class: "conn-list" });
  const search = h("input", { type: "search", class: "text-input", placeholder: "Add someone by name or @username", autocomplete: "off" });
  const results = h("div", { class: "conn-list add-results" });
  const m = modal({ title: `${chat.name} · members`, body: chat.member ? [search, results, list] : [list] });

  function paint(c) {
    list.replaceChildren(h("h3", { class: "side-title", text: plural(c.members.length, "member", "members") }));
    // Like Discord: the owner first, then everyone under their highest role, then members without a role
    const roles = c.roles || [];
    const topRole = (u) => roles.find((r) => (u.roles || []).includes(r.id)) || null;
    const groups = [{ key: "owner", name: "👑 Owner", color: c.color || "#ff4fa3", people: c.members.filter((u) => u.isOwner) },
      ...roles.map((r) => ({ key: r.id, name: r.name, color: r.color, people: c.members.filter((u) => !u.isOwner && topRole(u)?.id === r.id) })),
      { key: "none", name: "Members", color: null, people: c.members.filter((u) => !u.isOwner && !topRole(u)) }].filter((g) => g.people.length);
    const rowsOf = [];
    for (const g of groups) {
      list.append(h("div", { class: "role-section", style: g.color ? `--rc:${g.color}` : "" }, h("span", { class: "rs-dot" }), h("b", { text: g.name }), h("span", { class: "muted", text: "— " + g.people.length })));
      for (const u of g.people.sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)) || shownName(a).localeCompare(shownName(b)))) rowsOf.push(u), list.append(memberRow(u, c));
    }
  }
  function memberRow(u, c) {
    {
      const row = h("div", { class: "conn-row" },
        h("a", { href: profileHref(u.username), onclick: m.close }, avatarWithPresence(u, 42)),
        h("div", { class: "who" }, h("a", { href: profileHref(u.username), class: "name", onclick: m.close, style: roleColor(c, u.username) }, shownName(u), tick(u)),
          h("span", { class: "muted" }, (u.nickname ? u.name + " · " : "") + "@" + u.username + (u.isOwner ? " · owner · " : " · "), presenceText(u)),
          u.groupStatus ? h("span", { class: "member-gstatus", text: `${u.groupStatus.emoji ? u.groupStatus.emoji + " " : ""}${u.groupStatus.text}` }) : null,
          (u.roles || []).length ? h("div", { class: "role-chips" }, ...u.roles.map((id) => c.roles?.find((r) => r.id === id)).filter(Boolean).map((r) => h("span", { class: "grole", style: `--rc:${r.color}`, text: r.name }))) : null)
      );
      if (!u.isMe) {
        const rp = h("button", { class: "icon-btn", title: `Report ${u.name}`, "aria-label": `Report ${u.name}` }, icon("flag"));
        rp.addEventListener("click", () => openReportUser(u));
        row.append(rp);
      }
      if (c.perms?.includes("kick") && !u.isMe && !u.isOwner && (u.rank ?? 0) < (c.myRank ?? 0)) {
        const rm = h("button", { class: "btn btn-xs btn-outline-light", text: "Remove" });
        rm.addEventListener("click", async () => {
          try { paint((await api(`/api/groups/${c.id}/members/${encodeURIComponent(u.username)}`, { method: "DELETE" })).chat); refresh(); }
          catch (err) { toast(err.error || "Couldn’t remove them."); }
        });
        row.append(rm);
      }
      return row;
    }
  }
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (!q) return results.replaceChildren();
    timer = setTimeout(async () => {
      const { users } = await api(`/api/users/lookup?q=${encodeURIComponent(q)}`);
      const inGroup = new Set(chat.members.map((u) => u.username));
      results.replaceChildren(...users.map((u) => {
        const add = h("button", { class: "btn btn-xs " + (inGroup.has(u.username) ? "btn-following" : "btn-follow"), text: inGroup.has(u.username) ? "In group" : "Add", disabled: inGroup.has(u.username) });
        add.addEventListener("click", async () => {
          add.disabled = true;
          try {
            const { chat: c } = await api(`/api/groups/${chat.id}/members`, { method: "POST", body: { username: u.username } });
            Object.assign(chat, c);
            add.textContent = "Added";
            add.className = "btn btn-xs btn-following";
            paint(c);
            refresh();
          } catch (err) { toast(err.error || "Couldn’t add them."); add.disabled = false; }
        });
        return h("div", { class: "conn-row" }, avatar(u, 38), h("div", { class: "who" }, h("b", { text: u.name }), h("span", { class: "muted", text: "@" + u.username })), add);
      }));
    }, 200);
  });
  paint(chat);
}

/* ---------- Group settings (owner): who can find it, and deleting it ---------- */
export const GROUP_VIS = {
  public: { label: "Public", hint: "Anyone can find it in Groups, read it and join." },
  unlisted: { label: "Unlisted", hint: "Not listed in Groups. People with the link can read and join." },
  private: { label: "Private", hint: "Hidden. Only members can read it, and only members can add people." },
};
export function groupVisibilityPicker(start = "public") {
  let value = start;
  const hint = h("p", { class: "vis-hint" });
  const row = h("div", { class: "vis-pick", role: "radiogroup", "aria-label": "Who can see this group" });
  const paint = () => {
    row.querySelectorAll("button").forEach((b) => { b.classList.toggle("active", b.dataset.v === value); b.setAttribute("aria-checked", String(b.dataset.v === value)); });
    hint.textContent = GROUP_VIS[value].hint;
  };
  for (const [v, ic] of [["public", "globe"], ["unlisted", "link"], ["private", "lock"]]) {
    const b = h("button", { type: "button", role: "radio", dataset: { v } }, icon(ic), h("span", { text: GROUP_VIS[v].label }));
    b.addEventListener("click", () => { value = v; paint(); });
    row.append(b);
  }
  paint();
  return { el: h("div", { class: "vis-field" }, h("b", { class: "vis-label", text: "Who can see it" }), row, hint), value: () => value };
}
function openGroupSettings(chat, onSaved) {
  const vis = groupVisibilityPicker(chat.visibility || "public");
  const name = h("input", { type: "text", class: "text-input", maxlength: 60, value: chat.name, "aria-label": "Group name" });
  const desc = h("textarea", { class: "text-input", rows: 3, maxlength: 500, placeholder: "What is this group about?" });
  desc.value = chat.description || "";
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save" });
  const del = h("button", { type: "button", class: "btn btn-full btn-danger", text: "Delete group" });
  const m = modal({ title: "Group settings", body: h("div", { class: "create-form" }, name, desc, vis.el, save,
    h("div", { class: "danger-zone" }, h("b", { text: "Delete this group" }), h("p", { class: "muted", text: "All its messages, photos and videos are removed for everyone. This can’t be undone." }), del)) });
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await api(`/api/groups/${chat.id}`, { method: "POST", body: { name: name.value, description: desc.value, cover: chat.cover, visibility: vis.value() } });
      m.close();
      toast("Group saved.");
      emit("chats:changed");
      onSaved();
    } catch (err) { toast(err.error || "Couldn’t save."); save.disabled = false; }
  });
  confirmClick(del, "Click again to delete for everyone", async () => {
    try {
      await api(`/api/groups/${chat.id}`, { method: "DELETE" });
      m.close();
      toast(`${chat.name} was deleted.`);
      emit("chats:changed");
      navigate("/messages");
    } catch (err) { toast(err.error || "Couldn’t delete the group."); }
  });
}

/* ---------- LookStreak ---------- */
function streakBadge(chat) {
  const st = chat.streak;
  if (!st) return null;
  const since = new Date(st.since + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return h("span", { class: "streak" + (st.doneToday ? "" : " at-risk"), title: st.doneToday ? `You’ve both written every day since ${since}.` : "You haven’t both written today yet. Keep it going!" },
    h("span", { class: "streak-fire", text: "🔥" }),
    h("span", { class: "streak-text" }, h("b", { text: st.group ? `${st.days}-day group streak` : `${st.days}-day LookStreak` }), h("small", { text: st.doneToday ? `since ${since}` : st.group ? "2 people need to write today ⏳" : st.yourTurn ? "your turn today ⏳" : "their turn today ⏳" })));
}

/* ---------- The conversation ---------- */
export function conversation(chatId, { onBack, channelId = null, embedded = false, onChat } = {}) {
  const chQuery = channelId ? `channel=${encodeURIComponent(channelId)}` : "";
  let stopRecording = null;
  const head = h("header", { class: "convo-head" });
  const list = h("div", { class: "convo-list" }, spinner());
  const footer = h("div", { class: "convo-foot" });
  const pinBar = h("button", { type: "button", class: "pin-bar", hidden: true });
  // "… is typing" just above the box
  const typingBar = h("div", { class: "typing-bar", hidden: true });
  const typers = new Map(); // username -> { name, until }
  // Also like Instagram: a bubble with bouncing dots at the end of the chat, and "typing…" under the name at the top
  const typingBubble = h("div", { class: "msg typing-msg" });
  function paintTyping() {
    const now = Date.now();
    for (const [u, t] of typers) if (t.until < now) typers.delete(u);
    const names = [...typers.values()].map((t) => t.name);
    typingBar.hidden = !names.length;
    const sub = head.querySelector(".convo-who .muted");
    if (sub) {
      if (names.length && !sub.classList.contains("is-typing")) { sub._was = [...sub.childNodes]; sub.classList.add("is-typing"); }
      if (names.length) sub.replaceChildren(chat?.kind === "group" ? `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ""} is typing…` : "typing…");
      else if (sub.classList.contains("is-typing")) { sub.classList.remove("is-typing"); sub.replaceChildren(...(sub._was || [])); }
    }
    if (!names.length) { typingBubble.remove(); return; }
    const who = names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : `${names[0]}, ${names[1]} and ${names.length - 2} more are typing`;
    typingBar.replaceChildren(h("span", { class: "typing-dots" }, h("i"), h("i"), h("i")), h("span", { text: who }));
    const first = [...typers.keys()][0];
    const person = chat?.kind === "dm" ? chat.other : (chat?.members || []).find((u) => u.username === first);
    const key = [...typers.keys()].join(",");
    if (typingBubble.dataset.who !== key) {
      typingBubble.dataset.who = key;
      typingBubble.replaceChildren(person ? h("span", { class: "msg-avatar" }, avatar(person, 34)) : h("span", { class: "msg-avatar" }),
        h("div", { class: "bubble typing-bubble", "aria-label": who }, h("span", { class: "typing-dots big" }, h("i"), h("i"), h("i"))));
    }
    if (list.lastElementChild !== typingBubble) {
      const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      list.append(typingBubble);
      if (stick) list.scrollTop = list.scrollHeight;
    }
  }
  const typingTick = setInterval(paintTyping, 1000);
  const el = h("section", { class: "convo" }, head, pinBar, list, typingBar, footer);
  // In a group: pull the chat to the left for the people in it (like Discord)
  {
    let st = null;
    el.addEventListener("touchstart", (e) => {
      if (chat?.kind !== "group") return;
      const t = e.touches[0];
      if (e.target.closest(".msg.mine, input, textarea, .convo-tray, .convo-input, .lb-player") && t.clientX < innerWidth - 28) return;
      st = { x: t.clientX, y: t.clientY, go: false };
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (!st) return;
      const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
      if (!st.go) { if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { st = null; return; } if (dx > -16) return; st.go = true; }
      st.dx = dx;
    }, { passive: true });
    el.addEventListener("touchend", () => { if (st?.go && st.dx < -70) membersDrawer(chat, () => openMembers(chat, refresh)); st = null; });
  }
  // Hold (or right-click) anywhere on the chat's background: theme, wallpaper and photo
  const chatOptions = () => chat && openChatOptions(chat, { onTheme: (t) => applyTheme(el, t), onWallpaper: (wp) => applyWallpaper(el, wp), onPhoto: () => refresh(), onVanish: () => paintHead() });
  onHold(list, chatOptions, { ignore: ".bubble, a, button, input, textarea, video, audio, img, .game" });
  // "Seen" (DM) / "Seen by …" (group) under the newest message
  let lastMsg = null;
  function paintSeen() {
    list.querySelector(".seen-row")?.remove();
    if (!chat || !lastMsg || !chat.readers) return;
    const at = lastMsg.createdAt;
    const seen = chat.readers.filter((r) => r.at >= at && r.username !== lastMsg.author?.username);
    if (!seen.length) return;
    let row;
    if (chat.kind === "dm") {
      if (!lastMsg.mine) return;
      row = h("div", { class: "seen-row" }, h("span", { text: "Seen " + new Date(seen[0].at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) }));
    } else {
      const shown = seen.slice(0, 8);
      row = h("div", { class: "seen-row", title: "Seen by " + seen.map((r) => r.name).join(", ") }, h("span", { text: "Seen by" }),
        ...shown.map((r) => avatar(r, 18)), seen.length > shown.length ? h("span", { text: `+${seen.length - shown.length}` }) : null);
    }
    list.append(row);
  }
  // The newest pinned message sits under the header; click to see them all
  async function paintPins() {
    try {
      const { messages } = await api(`/api/chats/${chatId}/pins`);
      const inChannel = channelId ? messages.filter((x) => !x.channelId || x.channelId === channelId) : messages;
      pinBar.hidden = !inChannel.length;
      if (!inChannel.length) return;
      const top = inChannel[0];
      pinBar.replaceChildren(h("span", { class: "pb-ic", text: "📌" }),
        h("span", { class: "pb-text" }, h("b", { text: inChannel.length > 1 ? `${inChannel.length} pinned messages` : "Pinned message" }), h("span", { text: `${top.author.name}: ${top.text || (top.media ? "Photo or video" : top.post ? "Shared post" : top.comment ? "Shared reply" : "Message")}` })));
      pinBar.onclick = () => openPins(inChannel);
    } catch {}
  }
  function openPins(messages) {
    const canPin = chat && (chat.kind === "dm" || chat.perms?.includes("pin_messages"));
    const body = h("div", { class: "pin-list" }, ...messages.map((x) => {
      // Unpin right from the list (if you're allowed)
      const unpin = canPin ? h("span", { class: "pin-unpin", role: "button", tabindex: "0", title: "Unpin", text: "Unpin" }) : null;
      unpin?.addEventListener("click", async (e) => {
        e.stopPropagation();
        try { await api(`/api/chats/${chatId}/messages/${x.id}/pin`, { method: "POST", body: { on: false } }); wrap.remove(); toast("Unpinned."); if (!body.querySelector(".pin-row")) m.close(); }
        catch (err) { toast(err.error || "Couldn’t unpin it."); }
      });
      const row = h("button", { type: "button", class: "pin-row" }, avatar(x.author, 34),
        h("div", { class: "pin-row-text" }, h("b", { text: x.author.name }), h("p", { text: x.text || (x.media ? "Photo or video" : x.post ? "Shared post" : x.comment ? "Shared reply" : "Message") }), h("span", { class: "muted" }, timeEl(x.createdAt))));
      row.addEventListener("click", () => {
        m.close();
        const el2 = list.querySelector(`.msg[data-id="${CSS.escape(x.id)}"]`);
        if (!el2) return toast("That message is further up. Scroll up to load it.");
        el2.scrollIntoView({ behavior: "smooth", block: "center" });
        el2.classList.remove("flash"); void el2.offsetWidth; el2.classList.add("flash");
      });
      const wrap = h("div", { class: "pin-wrap" }, row, unpin);
      return wrap;
    }));
    const m = modal({ title: "Pinned messages", body });
  }
  const ids = new Set();
  let chat = null, more = null, loadingMore = false;

  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const toBottom = () => { list.scrollTop = list.scrollHeight; stick = true; };
  // Photos and GIFs that finish loading later don't push the chat away from the newest message
  let stick = true;
  list.addEventListener("scroll", () => { stick = atBottom(); }, { passive: true });
  list.addEventListener("load", () => { if (stick) list.scrollTop = list.scrollHeight; }, true);
  // When the keyboard opens (or closes) the list gets shorter (or taller): stay on the newest message, no jump
  if ("ResizeObserver" in window) { let lastH = 0; new ResizeObserver(() => { const h0 = list.clientHeight; if (h0 !== lastH) { if (stick) list.scrollTop = list.scrollHeight; lastH = h0; } }).observe(list); }

  function add(msg, { prepend = false } = {}) {
    if (ids.has(msg.id)) return;
    ids.add(msg.id);
    list.querySelector(".empty")?.remove();
    const row = messageEl(msg, chat, () => ids.delete(msg.id));
    if (prepend) list.prepend(row); else { list.append(row); if (!msg.system) { lastMsg = msg; paintSeen(); } }
    // Sent with an effect just now: play it (once)
    if (!prepend && msg.effect && !PERSISTENT.has(msg.effect) && Date.now() - new Date(msg.createdAt).getTime() < 30000) requestAnimationFrame(() => requestAnimationFrame(() => playEffect(msg.effect, row, el)));
  }

  function paintHead() {
    const back = h("button", { class: "icon-btn convo-back", "aria-label": "Back" }, icon("back"));
    back.addEventListener("click", () => onBack?.());
    const channel = embedded && chat.kind === "group" ? chat.channels?.find((x) => x.id === channelId) : null;
    const title = chat.kind === "dm"
      ? h("a", { class: "convo-who", href: profileHref(chat.other.username) }, chatPic(chat, 42), h("div", {}, h("b", {}, shownName(chat.other), tick(chat.other, 16)), h("span", { class: "muted" }, chat.other.nickname ? `${chat.other.name} · ` : "", presenceText(chat.other))), streakBadge(chat))
      : channel ? h("div", { class: "convo-who channel-who" }, h("span", { class: "ch-hash" }, icon("hash")), h("div", {}, h("b", { text: channel.name }), h("span", { class: "muted", text: chat.name })))
      : h("div", { class: "convo-who" }, chatPic(chat, 42), h("div", {}, h("b", { text: chat.name }), h("span", { class: "muted" },
          `${plural(chat.memberCount, "member", "members")}`,
          ` · ${chat.visibility || "public"} group`,
          chat.onlineCount ? h("span", { class: "online-count" }, " · ", h("span", { class: "presence-dot online" }), ` ${chat.onlineCount} online`) : null)), streakBadge(chat));
    const tools = h("div", { class: "convo-tools" });
    // The chat's theme and my wallpaper; hold (or right-click) the name for the chat options
    applyWallpaper(el, chat.wallpaper, chat.id);
    applyTheme(el, chat.theme, chat.id);
    title.title = "Hold for theme, wallpaper and photo";
    onHold(title, chatOptions);
    const styleBtn = h("button", { class: "icon-btn chat-style-btn", title: "Theme, wallpaper and photo", "aria-label": "Theme, wallpaper and photo", text: "🎨" });
    styleBtn.addEventListener("click", chatOptions);
    const gamesBtn = h("button", { class: "icon-btn", title: "Play a game", "aria-label": "Play a game" }, icon("game"));
    gamesBtn.addEventListener("click", () => openGamePicker(chat, { channelId, onStarted: (m) => { add(m); toBottom(); } }));
    tools.append(styleBtn);
    if (chat.canSend) tools.append(gamesBtn);
    const hotBtn = h("button", { class: "icon-btn", title: "Trending here: the most hyped messages", "aria-label": "Trending messages" }, h("span", { class: "nick-ic", text: "🔥" }));
    hotBtn.addEventListener("click", () => openTrending(chat, channelId, jumpTo));
    tools.append(hotBtn);
    // Photos, videos, links and search
    const libBtn = h("button", { class: "icon-btn", title: "Photos, videos, links & search", "aria-label": "Photos, videos, links and search" }, h("span", { class: "nick-ic", text: "🗂" }));
    libBtn.addEventListener("click", () => openLibrary());
    // Disappearing messages: shows when it's on; people who can change the chat can tap it
    const canVanish = chat.kind === "dm" ? chat.canSend : chat.isOwner || chat.perms?.includes("manage_group");
    if (chat.vanish || canVanish) {
      const vBtn = h("button", { class: "icon-btn vanish-btn" + (chat.vanish ? " on" : ""), title: chat.vanish ? `Disappearing messages: ${vanishLabel(chat.vanish)}` : "Disappearing messages", "aria-label": "Disappearing messages" },
        h("span", { class: "nick-ic", text: "⏳" }), chat.vanish ? h("small", { text: vanishLabel(chat.vanish).replace(/ hours?| days?/, (x) => x.trim()[0]) }) : null);
      vBtn.addEventListener("click", () => canVanish ? openVanishPicker(chat, () => paintHead()) : toast(`Messages here disappear after ${vanishLabel(chat.vanish)}.`));
      tools.append(vBtn);
    }
    tools.append(libBtn);
    if (chat.kind === "dm") {
      const nickBtn = h("button", { class: "icon-btn", title: "Nicknames", "aria-label": "Nicknames" }, h("span", { class: "nick-ic", text: "Aa" }));
      nickBtn.addEventListener("click", () => openNicknames(chat, refresh));
      tools.append(nickBtn);
    }
    if (chat.kind === "dm" && chat.canSend) {
      tools.append(
        h("button", { class: "icon-btn call-start", title: "Voice call", "aria-label": "Voice call", onclick: () => startCall(chat, false) }, icon("phone")),
        h("button", { class: "icon-btn call-start", title: "Video call", "aria-label": "Video call", onclick: () => startCall(chat, true) }, icon("video")));
    }
    if (chat.kind === "group" && embedded) {
      tools.append(h("button", { class: "icon-btn", title: "Members", "aria-label": "Members", onclick: () => membersDrawer(chat, () => openMembers(chat, refresh)) }, icon("group")));
    } else if (chat.kind === "group") {
      tools.append(h("button", { class: "btn btn-xs btn-outline-light", onclick: () => openMembers(chat, refresh) }, icon("userPlus"), h("span", { text: chat.member ? "People" : "Members" })));
      if (chat.isOwner) tools.append(h("button", { class: "btn btn-xs btn-outline-light", onclick: () => openGroupSettings(chat, () => refresh()) }, icon("edit"), h("span", { text: "Settings" })));
      if (chat.member) {
        const leave = h("button", { class: "btn btn-xs btn-outline-light", text: "Leave" });
        confirmClick(leave, "Sure?", async () => {
          await api(`/api/groups/${chat.id}/leave`, { method: "POST" });
          toast(`You left ${chat.name}.`);
          emit("chats:changed");
          navigate("/groups");
        });
        tools.append(leave);
      }
    }
    // On a phone: calls stay in the bar, everything else goes in a ⋯ menu (so the name has room)
    if (matchMedia("(max-width: 640px)").matches || chat.kind === "group") {
      const keep = [...tools.children].filter((b) => b.classList.contains("call-start"));
      const rest = [...tools.children].filter((b) => !keep.includes(b));
      if (rest.length > 1) {
        const moreBtn = h("button", { class: "icon-btn convo-more always", title: "More", "aria-label": "More options" }, h("span", { class: "nick-ic", text: "⋯" }));
        const hold = h("div", { hidden: true }, ...rest);
        moreBtn.addEventListener("click", () => {
          const sheet = modal({ title: "Chat", body: h("div", { class: "convo-menu" }, ...rest.map((b) => {
            const label = b.getAttribute("title") || b.getAttribute("aria-label") || "";
            const ic = b.cloneNode(true); ic.removeAttribute("title"); ic.className = "convo-menu-ic";
            const row = h("button", { type: "button", class: "convo-menu-row" + (b.classList.contains("on") ? " on" : "") }, ic, h("span", { text: label.replace(/ — .*$/, "").replace(/:.*$/, "").replace(/, links & search$/, "") }));
            row.addEventListener("click", () => { sheet.close(); setTimeout(() => b.click(), 60); });
            return row;
          })) });
        });
        tools.replaceChildren(...keep, moreBtn, hold);
      }
    }
    head.replaceChildren(back, title, tools);
  }

  function paintFooter() {
    footer.replaceChildren();
    if (chat.kind === "group" && !chat.member) {
      const join = h("button", { class: "btn btn-primary btn-full", text: `Join ${chat.name} to write here` });
      join.addEventListener("click", async () => {
        join.disabled = true;
        chat = (await api(`/api/groups/${chat.id}/join`, { method: "POST" })).chat;
        toast(`You joined ${chat.name}.`);
        emit("chats:changed");
        paintHead();
        paintFooter();
      });
      footer.append(join);
      return;
    }
    if (!chat.canSend) {
      footer.append(h("p", { class: "convo-note", text: "You can write here again when you follow each other." }));
      return;
    }
    const text = h("textarea", { rows: 1, placeholder: "Write a message", "aria-label": "Message" });
    // Let the others see that you're typing (at most every 2.5 seconds)
    // Live: "typing" goes out on the first key and every 2 seconds while you type; "stopped" when you clear it or send
    let lastTyping = 0, typingOn = false;
    const sayTyping = (stop = false) => api(`/api/chats/${chatId}/typing`, { method: "POST", body: { channelId, stop } }).catch(() => {});
    text.addEventListener("input", () => {
      if (!text.value.trim()) { if (typingOn) { typingOn = false; lastTyping = 0; sayTyping(true); } return; }
      if (Date.now() - lastTyping < 2000) return;
      lastTyping = Date.now(); typingOn = true;
      sayTyping();
    });
    text.addEventListener("blur", () => { if (typingOn) { typingOn = false; lastTyping = 0; sayTyping(true); } });
    text.form?.addEventListener?.("submit", () => { typingOn = false; lastTyping = 0; });
    attachMentions(text, { people: () => (chat.kind === "group" ? (chat.members || []).filter((u) => !u.isMe) : chat.other ? [chat.other] : []), everyone: () => chat.kind === "group" });
    const err = h("p", { class: "form-error", role: "alert", hidden: true });
    const showErr = (m) => { err.textContent = m; err.hidden = !m; };
    const send = h("button", { type: "submit", class: "send-btn", "aria-label": "Send", disabled: true }, icon("send"));
    const picker = createPicker({ accept: "both", max: 1, onChange: update, onError: showErr, onOther: (f) => sendFile(f) });
    // You can press send while the photo is still going up: it's sent the moment it's ready
    // Phones: tapping the box opens the keyboard without the phone scrolling the page to it (the cause of the jump)
    text.addEventListener("touchend", (e) => {
      if (document.activeElement === text || !matchMedia("(hover: none), (max-width: 760px)").matches) return;
      e.preventDefault();
      window.dispatchEvent(new Event("lb:keyboard"));
      text.focus({ preventScroll: true });
      const end = text.value.length; try { text.setSelectionRange(end, end); } catch {}
    }, { passive: false });
    function update() { send.disabled = !text.value.trim() && !picker.items().length; }
    // Phones: send on the touch itself, without taking the focus from the box. Otherwise the keyboard closes
    // mid-tap, the whole screen jumps and the tap can miss the button.
    send.addEventListener("touchstart", (e) => { if (send.disabled) return; e.preventDefault(); send.classList.add("pressed"); }, { passive: false });
    send.addEventListener("touchend", (e) => { if (!send.classList.contains("pressed")) return; e.preventDefault(); send.classList.remove("pressed"); if (!send.disabled) form.requestSubmit(); }, { passive: false });
    send.addEventListener("touchcancel", () => send.classList.remove("pressed"));
    send.addEventListener("mousedown", (e) => e.preventDefault());

    text.addEventListener("input", () => { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight, 160) + "px"; update(); });
    text.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    let replying = null;
    const replyBar = h("div", { class: "reply-bar", hidden: true });
    const setReply = (m) => {
      replying = m;
      replyBar.hidden = !m;
      if (!m) return replyBar.replaceChildren();
      const what = m.text || (m.media?.gif ? "GIF" : m.media?.sticker ? "Sticker" : m.media ? (m.media.kind === "file" ? "📎 " + (m.media.name || "File") : m.media.kind === "audio" ? (m.media.file ? "🎵 " + (m.media.name || "Audio") : "🎤 Voice message") : m.media.kind === "video" ? "Video" : "Photo") : m.post ? "Shared post" : "Message");
      const cancel = h("button", { type: "button", class: "tool-icon", "aria-label": "Cancel reply" }, icon("close"));
      cancel.addEventListener("click", () => { setReply(null); text.focus(); });
      replyBar.replaceChildren(icon("replyArrow"),
        h("div", { class: "rb-text" }, h("b", { text: m.mine ? "Replying to yourself" : `Replying to ${m.author.name}` }), h("span", { text: what })),
        cancel);
      softFocus(text);
    };
    startReply = setReply;
    text.addEventListener("keydown", (e) => { if (e.key === "Escape" && replying) { e.stopPropagation(); setReply(null); } });
    const emojiBtn = h("button", { type: "button", class: "tool-btn", "aria-label": "Add emoji", title: "Emoji" }, icon("smile"));
    emojiBtn.addEventListener("click", () => openEmojiPicker(emojiBtn, (e) => insertAtCursor(text, e), { keepOpen: true }));
    /* Voice messages: press the mic, talk, press send */
    const micBtn = h("button", { type: "button", class: "tool-btn mic-btn", "aria-label": "Record a voice message", title: "Voice message" }, icon("mic"));
    const recTime = h("span", { class: "rec-time", text: "0:00" });
    const recBars = h("div", { class: "rec-bars" });
    const recCancel = h("button", { type: "button", class: "tool-icon", "aria-label": "Cancel recording", title: "Cancel" }, icon("trash"));
    const recSend = h("button", { type: "button", class: "send-btn", "aria-label": "Send voice message" }, icon("send"));
    const recBar = h("div", { class: "rec-bar", hidden: true }, recCancel, h("span", { class: "rec-dot" }), recTime, recBars, h("span", { class: "rec-hint", text: "up to 2:00" }), recSend);
    let recording = null;
    const inputRow = h("div", { class: "convo-input" }, picker.button, emojiBtn, text, micBtn, send);
    const showRec = (on) => { recBar.hidden = !on; inputRow.hidden = on; };
    micBtn.addEventListener("click", async () => {
      showErr("");
      recBars.replaceChildren();
      try {
        recording = await startRecording({
          onTick: (secs, level) => {
            recTime.textContent = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
            if (recBars.children.length > 60) recBars.firstChild.remove();
            recBars.append(h("span", { style: `height:${Math.round(12 + level * 88)}%` }));
          },
        });
        showRec(true);
      } catch (ex) {
        showErr(ex.message || "Couldn’t start recording.");
      }
    });
    recCancel.addEventListener("click", () => { recording?.cancel(); recording = null; showRec(false); });
    stopRecording = () => { recording?.cancel(); recording = null; };
    recSend.addEventListener("click", async () => {
      if (!recording) return;
      recSend.disabled = recCancel.disabled = true;
      const r = recording;
      recording = null;
      try {
        const { blob, duration, peaks } = await r.stop();
        if (duration < 0.6) { showRec(false); recSend.disabled = recCancel.disabled = false; return toast("That was too short. Hold on a bit longer."); }
        recTime.textContent = "Sending…";
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "weba";
        const { url } = await upload(new File([blob], "voice." + ext, { type: blob.type }));
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId,  media: { url, duration, peaks }, replyTo: replying?.id || null } }); sfx(message.viewOnce || message.expiresAt ? "vanish" : "send");
        setReply(null);
        add(message);
        toBottom();
        if (chat.kind === "dm") refresh().catch(() => {});
      } catch (ex) {
        showErr(ex.error || ex.message || "Couldn’t send the voice message.");
      }
      recSend.disabled = recCancel.disabled = false;
      showRec(false);
    });
    const stickerBtn = h("button", { type: "button", class: "tool-btn", "aria-label": "Stickers", title: "Stickers" }, icon("sticker"));
    const sendExtra = async (body, what) => {
      try {
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId, ...body, replyTo: replying?.id || null } }); sfx(message.viewOnce || message.expiresAt ? "vanish" : "send");
        setReply(null); add(message); toBottom();
        if (chat.kind === "dm") refresh().catch(() => {});
      } catch (ex) { showErr(ex.error || `Couldn’t send the ${what}.`); }
    };
    // Documents and sound files (PDF, Word, Excel, MP3, WAV…): sent as their own message, with a card to open or play them
    const sendFile = async (file) => {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const type = FILE_TYPES[ext] || (/^audio\/(mpeg|mp3|wav|x-wav|wave|mp4|x-m4a|ogg|flac|x-flac|aac)$/.test(file.type) ? file.type : "");
      if (!type) return showErr("You can send photos, videos, sounds (MP3, WAV, M4A, OGG, FLAC) and documents (PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP).");
      if (file.size > 50 * 1024 * 1024) return showErr("Files can be up to 50 MB.");
      showErr("");
      const f = file.type === type ? file : new File([file], file.name, { type });
      const audio = type.startsWith("audio/");
      // While it uploads: a card in the chat with how far it is
      const pct = h("small", { class: "muted", text: "Uploading… 0%" });
      const pend = h("div", { class: "msg mine pending" }, h("div", { class: "bubble file-bubble" }, h("div", { class: "file-card" }, h("span", { class: "fc-ic", text: audio ? "🎵" : fileIcon(file.name) }), h("span", { class: "fc-text" }, h("b", { text: file.name }), pct))));
      list.append(pend); toBottom();
      try {
        const duration = audio ? await audioLength(f) : null;
        const { url } = await upload(f, (x) => { pct.textContent = `Uploading… ${Math.round(x * 100)}%`; });
        await sendExtra({ media: { url, file: true, name: file.name, size: file.size, ...(duration ? { duration } : {}) } }, "file");
      } catch (err) { showErr(err.error || "Couldn’t send the file."); }
      pend.remove();
    };
    // Files from anywhere: Ctrl+V (a copied picture or file), dropping them on the chat, or the 📎 button
    const takeFiles = (files) => {
      const media = files.filter((f) => /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|webm))$/.test(f.type));
      if (media.length) picker.add(media.slice(0, 1));
      for (const f of files) if (!media.includes(f)) sendFile(f);
    };
    const onPaste = (e) => {
      if (!form.isConnected) return removeEventListener("paste", onPaste);
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) return;
      // Only for this chat: the box, or nothing else being typed in
      const t = e.target;
      if (t !== text && t.closest?.("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      takeFiles(files);
      text.focus();
    };
    addEventListener("paste", onPaste);
    requestAnimationFrame(() => {
      const dropZone = list.parentElement || form.parentElement;
      dropZone?.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); dropZone.classList.add("drop-on"); } });
      dropZone?.addEventListener("dragleave", (e) => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove("drop-on"); });
      dropZone?.addEventListener("drop", (e) => { const files = [...(e.dataTransfer?.files || [])]; dropZone.classList.remove("drop-on"); if (!files.length) return; e.preventDefault(); takeFiles(files); });
    });
    const fileInput = h("input", { type: "file", hidden: true, multiple: true, accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.mp3,.wav,.m4a,.ogg,.flac,.aac,audio/*" });
    fileInput.addEventListener("change", () => { const files = [...fileInput.files]; fileInput.value = ""; files.forEach(sendFile); });
    const fileBtn = h("button", { type: "button", class: "tool-btn", "aria-label": "Send a file", title: "Send a document or a sound file" }, h("span", { class: "tool-emoji", text: "📎" }), fileInput);
    fileBtn.addEventListener("click", (e) => { if (e.target !== fileInput) fileInput.click(); });
    // Sounds: mine, this group's, built-in
    const soundBtn = h("button", { type: "button", class: "tool-btn", "aria-label": "Send a sound", title: "Send a sound" }, h("span", { class: "tool-emoji", text: "🔊" }));
    soundBtn.addEventListener("click", () => openSoundPicker(soundBtn, { group: chat.kind === "group" ? chat : null, builtin: chat.kind === "group", onPick: (b) => sendExtra(b, "sound") }));
    stickerBtn.addEventListener("click", () => openStickers(stickerBtn, async (st, kind) => {
      try {
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId, ...(kind === "group" ? { groupSticker: st.id } : { sticker: st.id }), replyTo: replying?.id || null } }); sfx(message.viewOnce || message.expiresAt ? "vanish" : "send");
        setReply(null);
        add(message);
        toBottom();
        if (chat.kind === "dm") refresh().catch(() => {});
      } catch (ex) { showErr(ex.error || "Couldn’t send the sticker."); }
    }, { group: chat.kind === "group" ? chat : null, canManageGroup: chat.kind === "group" && chat.perms?.includes("manage_sounds") }));
    inputRow.insertBefore(stickerBtn, text);
    inputRow.insertBefore(soundBtn, text);
    // Send a song from LookBlog
    const songBtn = h("button", { type: "button", class: "tool-btn", "aria-label": "Send a song", title: "Send a song" }, icon("note", "note-ic"));
    songBtn.addEventListener("click", () => openSongPicker(async (sg) => {
      try {
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId, songId: sg.id, replyTo: replying?.id || null } }); sfx(message.viewOnce || message.expiresAt ? "vanish" : "send");
        setReply(null); add(message); toBottom();
        if (chat.kind === "dm") refresh().catch(() => {});
      } catch (ex) { showErr(ex.error || "Couldn’t send the song."); throw ex; }
    }));
    inputRow.insertBefore(songBtn, text);
    const sendGif = async (g, to = replying) => {
      try {
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId,  ...gifBody(g), replyTo: to?.id || null } }); sfx(message.viewOnce || message.expiresAt ? "vanish" : "send");
        setReply(null); add(message); toBottom();
        if (chat.kind === "dm") refresh().catch(() => {});
      } catch (ex) { showErr(ex.error || "Couldn’t send the GIF."); }
    };
    gifReply = sendGif;
    const chatGif = gifButton((g) => sendGif(g));
    inputRow.insertBefore(chatGif, text);
    // On a phone the row is just ＋ · text · mic/send; ＋ opens the other tools above
    const trayBtn = h("button", { type: "button", class: "tool-btn tray-btn", "aria-label": "More: stickers, sounds, polls…", title: "More: stickers, sounds, polls…", "aria-expanded": "false" }, h("span", { text: "＋" }));
    inputRow.prepend(trayBtn);
    const form = h("form", { class: "convo-form", novalidate: true }, replyBar, picker.previews, inputRow, recBar, err);
    trayBtn.addEventListener("click", () => { const open = form.classList.toggle("tray-open"); trayBtn.setAttribute("aria-expanded", String(open)); });
    // Something was attached: close the ＋ panel so the preview has room
    new MutationObserver(() => { if (picker.items().length) { form.classList.remove("tray-open"); trayBtn.setAttribute("aria-expanded", "false"); } }).observe(picker.previews, { childList: true });
    inputRow.addEventListener("click", (e) => { const b = e.target.closest(".tool-btn"); if (b && b !== trayBtn && !b.classList.contains("mic-btn") && form.classList.contains("tray-open")) { form.classList.remove("tray-open"); trayBtn.setAttribute("aria-expanded", "false"); } });
    // View once: the next messages can be opened one time only (tap again to turn it off)
    let viewOnce = false;
    const voBtn = h("button", { type: "button", class: "tool-btn vo-btn", "aria-label": "View once", "aria-pressed": "false", title: "View once: they can open it one time" }, h("span", { text: "1" }));
    voBtn.addEventListener("click", () => {
      viewOnce = !viewOnce;
      voBtn.classList.toggle("on", viewOnce);
      voBtn.setAttribute("aria-pressed", String(viewOnce));
      text.placeholder = viewOnce ? "View-once message…" : text.dataset.ph || text.placeholder;
      toast(viewOnce ? "View once is on: they can open your messages one time." : "View once is off.");
      softFocus(text);
    });
    text.dataset.ph = text.placeholder;
    inputRow.insertBefore(voBtn, text);
    // Disappearing photo or video (like Instagram's camera): pick or take one, then View once / Allow replay / Keep in chat
    const camBtn = h("button", { type: "button", class: "tool-btn cam-btn", "aria-label": "Disappearing photo", title: "Disappearing photo or video" }, icon("camera"));
    const camInput = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm", hidden: true });
    camBtn.addEventListener("click", () => camInput.click());
    camInput.addEventListener("change", () => {
      const f = camInput.files[0];
      camInput.value = "";
      if (f) openDisappearing(f, async (body) => {
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId, ...body, replyTo: replying?.id || null } }); sfx(message.viewOnce || message.expiresAt ? "vanish" : "send");
        setReply(null);
        add(message);
        toBottom();
      });
    });
    inputRow.insertBefore(camBtn, voBtn);
    footer.append(camInput);
    // ✨ My message style, and send with an effect (also: hold the send button)
    let armedFx = null, unlockIn = null;
    const fxBtn = h("button", { type: "button", class: "tool-btn fx-btn", "aria-label": "Message style and effects", title: "Your message style & send effects" }, h("span", { text: "✨" }));
    const armFx = (k, mins = null) => {
      armedFx = k; unlockIn = mins;
      const e = EFFECTS.find(([x]) => x === k) || SECRET_FX.find(([x]) => x === k);
      send.classList.toggle("fx-armed", Boolean(k));
      send.dataset.fx = e ? e[1] : "";
      fxBtn.classList.toggle("on", Boolean(k));
      if (e) { toast(`${e[1]} ${e[2]} — your next message is sent with it.`); text.focus(); }
    };
    fxBtn.addEventListener("click", () => openMsgStyle({ onEffect: armFx, armed: armedFx }));
    let holdT = null;
    send.addEventListener("pointerdown", () => { holdT = setTimeout(() => { holdT = "fired"; navigator.vibrate?.(10); openMsgStyle({ onEffect: armFx, armed: armedFx }); }, 450); });
    const unhold = () => { if (holdT && holdT !== "fired") clearTimeout(holdT); };
    send.addEventListener("pointerup", unhold); send.addEventListener("pointerleave", unhold);
    send.addEventListener("click", (e) => { if (holdT === "fired") { e.preventDefault(); e.stopImmediatePropagation(); holdT = null; } }, true);
    inputRow.insertBefore(fxBtn, text);
    // A poll
    const pollBtn = h("button", { type: "button", class: "tool-btn poll-btn", "aria-label": "Poll", title: "Start a poll" }, h("span", { text: "📊" }));
    pollBtn.addEventListener("click", () => openPollForm(async (body) => {
      const { message } = await api(`/api/chats/${chat.id}/polls`, { method: "POST", body: { ...body, channelId } });
      sfx("send"); add(message); toBottom();
    }));
    inputRow.insertBefore(pollBtn, camBtn);
    // The tools: the main ones stay in the row (on a computer); the rest live in a panel that ＋ opens.
    // On a phone the row is just ＋ · text · mic / send, and every tool is in the panel.
    const tray = h("div", { class: "convo-tray", role: "group", "aria-label": "More things to send" });
    form.insertBefore(tray, inputRow);
    const tile = (b, label) => h("div", { class: "tray-tile" }, b, h("small", { text: label }));
    // In the ＋ panel: my message style & effects, a song, a poll, the camera, view once
    for (const [b, l] of [[fileBtn, "File"], [fxBtn, "Style & effects"], [soundBtn, "Sounds"], [songBtn, "Music"], [pollBtn, "Poll"], [camBtn, "Camera"], [voBtn, "View once"]]) tray.append(tile(b, l));
    // In the row: emoji, GIFs and stickers always; the photo button too on a computer (on a phone it's in ＋)
    const ROW = [emojiBtn, chatGif, stickerBtn];
    const MAIN = [[picker.button, "Photo"]], mainTiles = new Map();
    const layoutTools = () => {
      const phone = matchMedia("(max-width: 640px)").matches;
      MAIN.forEach(([b, l], i) => {
        if (phone) { const t = mainTiles.get(b) || tile(b, l); mainTiles.set(b, t); t.prepend(b); tray.insertBefore(t, tray.children[i] || null); }
        else { inputRow.insertBefore(b, text); mainTiles.get(b)?.remove(); }
      });
      for (const b of ROW) { b.classList.add("row-tool"); inputRow.insertBefore(b, text); }
    };
    layoutTools();
    matchMedia("(max-width: 640px)").addEventListener?.("change", layoutTools);
    tray.addEventListener("click", (e) => { if (e.target.closest(".tool-btn") && !e.target.closest(".vo-btn")) { form.classList.remove("tray-open"); trayBtn.setAttribute("aria-expanded", "false"); } });
    // The mic and the send button share a place: mic while the box is empty, send once you write (or add something)
    const swapMicSend = () => { const has = Boolean(text.value.trim()) || picker.items().length > 0; inputRow.classList.toggle("has-text", has); };
    text.addEventListener("input", swapMicSend);
    new MutationObserver(swapMicSend).observe(picker.previews, { childList: true });
    swapMicSend();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (send.disabled) return;
      showErr("");
      send.disabled = true;
      closeEmojiPicker();
      // What's being sent (the box is emptied at once, so nothing is shown twice and nothing jumps when it's done)
      const msgText = text.value, replyId = replying?.id || null, vo = viewOnce, fx = armedFx, fxIn = unlockIn;
      let pending = null;
      if (picker.busy()) {
        // Still uploading: it's in the chat right away, and sent the moment it's up
        const it = picker.items()[0];
        const local = it?.file ? URL.createObjectURL(it.file) : null;
        pending = h("div", { class: "msg mine pending" }, h("div", { class: "msg-stack" }, h("div", { class: "bubble" },
          local && it.kind === "image" ? h("img", { class: "pending-img", src: local, alt: "" }) : null,
          local && it.kind === "video" ? h("video", { class: "pending-img", src: local, muted: true, playsInline: true, preload: "metadata" }) : null,
          msgText.trim() ? h("p", { class: "bubble-text", text: msgText }) : null,
          h("span", { class: "pending-tag", text: "Sending…" }))));
        list.append(pending); toBottom();
        form.classList.add("sending");
        text.value = ""; text.style.height = ""; inputRow.classList.remove("has-text"); setReply(null);
        const t0 = Date.now();
        while (picker.busy() && Date.now() - t0 < 120000) await new Promise((ok) => setTimeout(ok, 120));
        if (local) setTimeout(() => URL.revokeObjectURL(local), 5000);
        if (!picker.media().length && !msgText.trim()) { pending.remove(); form.classList.remove("sending"); picker.clear(); update(); return; }
      }
      try {
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId, text: msgText, media: picker.media()[0] || null, replyTo: replyId, ...(vo ? { viewOnce: true } : {}), ...(fx ? { effect: fx, ...(fxIn ? { unlockIn: fxIn } : {}) } : {}) } }); sfx(message.viewOnce || message.expiresAt ? "vanish" : "send");
        armFx(null);
        if (!pending) { setReply(null); text.value = ""; text.style.height = ""; inputRow.classList.remove("has-text"); }
        pending?.remove();
        add(message);
        toBottom();
        if (chat.kind === "dm") refresh().catch(() => {});
        picker.clear();
      } catch (ex) { pending?.remove(); if (pending && !text.value) text.value = msgText; showErr(ex.error || "Couldn’t send that."); }
      form.classList.remove("sending");
      update();
      softFocus(text);
    });
    footer.append(form);
    setTimeout(() => softFocus(text), 50);
  }

  async function refresh() {
    chat = (await api(`/api/chats/${chatId}`)).chat;
    onChat?.(chat);
    paintHead();
    paintSeen();
  }

  // Go to a message: load older ones until it's on screen, then flash it
  async function jumpTo(messageId, msgChannel) {
    if (msgChannel && channelId && msgChannel !== channelId) return toast("That message is in another channel.");
    let el2 = list.querySelector(`.msg[data-id="${CSS.escape(messageId)}"]`);
    for (let i = 0; !el2 && more && i < 40; i++) { await loadOlder(); el2 = list.querySelector(`.msg[data-id="${CSS.escape(messageId)}"]`); }
    if (!el2) return toast("Couldn’t find that message here.");
    el2.scrollIntoView({ behavior: "smooth", block: "center" });
    el2.classList.remove("flash"); void el2.offsetWidth; el2.classList.add("flash");
  }
  function openLibrary() {
    let tab = "photos";
    const tabs = h("div", { class: "tabs lib-tabs" });
    const body = h("div", { class: "lib-body" });
    const go = (x) => { m.close(); jumpTo(x.id, x.channelId); };
    const when = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    async function paint() {
      tabs.replaceChildren(...[["photos", "🖼️ Photos"], ["videos", "🎬 Videos"], ["links", "🔗 Links"], ["search", "🔎 Search"]].map(([k, l]) => h("button", { class: "tab" + (k === tab ? " active" : ""), text: l, onclick: () => { tab = k; paint(); } })));
      if (tab === "search") return paintSearch();
      body.replaceChildren(spinner());
      let items;
      try { ({ items } = await api(`/api/chats/${chatId}/gallery?kind=${tab}`)); } catch (err) { body.replaceChildren(empty("Couldn’t load.", err.error || "")); return; }
      if (!items.length) return body.replaceChildren(empty(tab === "photos" ? "No photos yet." : tab === "videos" ? "No videos yet." : "No links yet.", "Things shared in this chat show up here."));
      if (tab === "links") {
        body.replaceChildren(h("div", { class: "lib-links" }, ...items.map((x) => h("div", { class: "lib-link" },
          h("a", { href: x.url, target: "_blank", rel: "noopener", class: "lib-url", text: x.url.replace(/^https?:\/\//, "") }),
          h("span", { class: "muted", text: `${x.author.name} · ${when(x.createdAt)}` }),
          h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Show in chat", onclick: () => go(x) })))));
        return;
      }
      body.replaceChildren(h("div", { class: "lib-grid" }, ...items.map((x) => {
        const cell = h("button", { type: "button", class: "lib-cell", title: `${x.author.name} · ${when(x.createdAt)} — click to show in chat` },
          tab === "photos" ? h("img", { src: x.url, alt: "", loading: "lazy" }) : x.poster ? h("img", { src: x.poster, alt: "", loading: "lazy" }) : h("video", { src: x.url, muted: true, preload: "metadata" }),
          tab === "videos" ? h("span", { class: "lib-play", text: "▶" }) : null);
        cell.addEventListener("click", () => go(x));
        return cell;
      })));
    }
    function paintSearch() {
      const q = h("input", { type: "search", class: "text-input", placeholder: "Search messages…" });
      const day = h("input", { type: "date", class: "text-input lib-date", max: new Date().toISOString().slice(0, 10) });
      const results = h("div", { class: "lib-results" }, h("p", { class: "muted", text: "Type words, pick a day — or both." }));
      let t;
      const run = async () => {
        if (!q.value.trim() && !day.value) return results.replaceChildren(h("p", { class: "muted", text: "Type words, pick a day — or both." }));
        results.replaceChildren(spinner());
        try {
          const { messages } = await api(`/api/chats/${chatId}/search?q=${encodeURIComponent(q.value.trim())}&date=${day.value}&tz=${new Date().getTimezoneOffset()}`);
          if (!messages.length) return results.replaceChildren(empty("Nothing found.", "Try other words or another day."));
          results.replaceChildren(...messages.map((x) => {
            const row = h("button", { type: "button", class: "pin-row" }, avatar(x.author, 34),
              h("div", { class: "pin-row-text" }, h("b", { text: x.author.name }), h("p", { text: x.text || (x.media ? (x.media.kind === "image" ? "Photo" : x.media.kind === "video" ? "Video" : x.media.kind === "sound" ? "Sound" : "Voice message") : x.post ? "Shared post" : "Message") }),
                h("span", { class: "muted", text: new Date(x.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) })));
            row.addEventListener("click", () => go(x));
            return row;
          }));
        } catch (err) { results.replaceChildren(empty("Couldn’t search.", err.error || "")); }
      };
      q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 250); });
      day.addEventListener("change", run);
      body.replaceChildren(h("div", { class: "lib-search" }, q, day), results);
      setTimeout(() => q.focus(), 50);
    }
    const m = modal({ title: chat.kind === "group" ? `${chat.name} — shared` : "Shared in this chat", wide: true, body: h("div", { class: "lib" }, tabs, body) });
    paint();
  }

  async function loadOlder() {
    if (!more || loadingMore) return;
    loadingMore = true;
    const h0 = list.scrollHeight;
    const data = await api(`/api/chats/${chatId}/messages?before=${encodeURIComponent(more)}${chQuery ? "&" + chQuery : ""}`);
    data.messages.slice().reverse().forEach((msg) => add(msg, { prepend: true }));
    more = data.more;
    list.scrollTop += list.scrollHeight - h0;
    loadingMore = false;
  }
  list.addEventListener("scroll", () => { if (list.scrollTop < 60) loadOlder(); });

  // "Seen" only when you really look: the chat is open on the screen and LookBlog is the window you're in.
  // In a background tab (or another app in front) it waits, and becomes "Seen" the moment you come back to it.
  let readPending = false;
  const canSee = () => document.visibilityState === "visible" && document.hasFocus() && list.isConnected && list.offsetParent !== null;
  const markRead = () => {
    if (!chat?.member) return;
    if (!canSee()) { readPending = true; return; }
    readPending = false;
    api(`/api/chats/${chatId}/read`, { method: "POST" }).then(() => emit("chats:changed")).catch(() => {});
  };
  const lookedBack = () => {
    if (!list.isConnected) { document.removeEventListener("visibilitychange", lookedBack); removeEventListener("focus", lookedBack); return; }
    if (readPending) setTimeout(() => readPending && markRead(), 400); // a moment on the screen, not a flash
  };
  document.addEventListener("visibilitychange", lookedBack);
  addEventListener("focus", lookedBack);
  list.addEventListener("pointerdown", lookedBack);

  (async () => {
    try {
      chat = (await api(`/api/chats/${chatId}`)).chat;
      onChat?.(chat);
      const data = await api(`/api/chats/${chatId}/messages${chQuery ? "?" + chQuery : ""}`);
      list.replaceChildren();
      more = data.more;
      if (!data.messages.length) list.append(empty(chat.kind === "dm" ? `Say hi to ${chat.other.name}.` : "No messages yet.", chat.kind === "dm" ? "Only the two of you can see this conversation." : "Anyone can read this group. Members can write."));
      data.messages.forEach((msg) => add(msg));
      paintSeen();
      paintHead();
      paintFooter();
      paintPins();
      toBottom();
      markRead();
    } catch (err) {
      if (!err?.error) console.error(err);
      list.replaceChildren(empty("Couldn’t open this conversation.", err.error || ""));
    }
  })();

  const offTyping = on("chat:typing", (ev) => {
    if (ev.chatId !== chatId || (channelId && ev.channelId && ev.channelId !== channelId)) return;
    if (ev.stop) typers.delete(ev.username);
    else typers.set(ev.username, { name: ev.name, until: Date.now() + 3500 });
    paintTyping();
  });
  const offRead = on("chat:read", (ev) => {
    if (ev.chatId !== chatId || !chat) return;
    chat.readers = [...(chat.readers || []).filter((r) => r.username !== ev.user.username), ev.user];
    paintSeen();
  });
  const offMsg = on("message", (ev) => {
    if (ev.chatId !== chatId || !chat) return;
    typers.delete(ev.message.author?.username); paintTyping();
    if (chat.kind === "group" && channelId && ev.message.channelId !== channelId) return;
    const stick = atBottom() || ev.message.mine;
    if (ev.message.media?.kind === "sound" && !ev.message.mine) playSound(ev.message.media);
    add(ev.message);
    if (stick) toBottom();
    if (chat.kind === "dm" && !ev.message.mine) refresh().catch(() => {});
    markRead();
  });
  const offDel = on("message:deleted", (ev) => {
    if (ev.chatId !== chatId) return;
    list.querySelector(`.msg[data-id="${CSS.escape(ev.messageId)}"]`)?.remove();
    ids.delete(ev.messageId);
    list.querySelectorAll(".msg").forEach((row) => {
      if (row._msg?.replyTo?.id === ev.messageId) {
        row._msg.replyTo = { id: ev.messageId, deleted: true };
        row.querySelector(".reply-quote")?.replaceWith(replyQuote(row._msg.replyTo));
      }
    });
  });
  const offGone = on("group:deleted", (ev) => {
    if (ev.chatId !== chatId) return;
    toast(`@${ev.by} deleted ${ev.name}.`);
    navigate("/messages");
  });
  const offReact = on("message:reactions", (ev) => { if (ev.chatId === chatId && chat) paintReactions(ev.messageId, ev.reactions, chat); });
  const offNotes = on("message:notes", (ev) => { if (ev.chatId === chatId && chat) paintNotes(ev.messageId, ev.notes, chat); });
  const offPoll = on("message:poll", (ev) => { if (ev.chatId === chatId && chat) paintPoll(ev.messageId, ev.poll, chat); });
  const offHype = on("message:hype", (ev) => { if (ev.chatId === chatId && chat) paintHype(ev.messageId, ev.hypes, chat, ev.by === state.me.username ? ev.on : undefined); });
  const offHyped = on("message:hyped", (ev) => { if (ev.chatId === chatId) toast(ev.hypes === 1 ? `🔥 @${ev.by} hyped your message` : `🔥 Your message is trending: ${ev.hypes} hypes!`); });
  const offMembers = on("group:members", (ev) => { if (ev.chatId === chatId && chat) { chat.memberCount = ev.memberCount; paintHead(); } });
  const offPins = on("message:pinned", (ev) => {
    if (ev.chatId !== chatId) return;
    const row = list.querySelector(`.msg[data-id="${CSS.escape(ev.messageId)}"]`);
    if (row && chat) { row._msg.pinned = ev.pinned; row.replaceWith(messageEl(row._msg, chat, () => ids.delete(ev.messageId))); }
    paintPins();
  });
  const offNicks = on("chat:nicknames", (ev) => { if (ev.chatId === chatId && chat) refresh().catch(() => {}); });
  const offVo = on("message:viewonce", (ev) => {
    if (ev.chatId !== chatId || !chat) return;
    const row = list.querySelector(`.msg[data-id="${CSS.escape(ev.messageId)}"]`);
    if (row && !document.querySelector(".vo-view")) row.replaceWith(messageEl(ev.message, chat, () => ids.delete(ev.messageId)));
    else if (row) row._msg = ev.message;
  });
  const offVanish = on("chat:vanish", (ev) => { if (ev.chatId === chatId && chat) { chat.vanish = ev.vanish; paintHead(); } });
  // Disappearing messages leave the screen the moment their time is up
  const vanishTick = setInterval(() => {
    const now = new Date().toISOString();
    list.querySelectorAll(".msg").forEach((row) => { if (row._msg?.expiresAt && row._msg.expiresAt <= now) { ids.delete(row._msg.id); row.remove(); } });
  }, 5000);

  return { el, stop: () => { offVo(); offVanish(); clearInterval(vanishTick); offTyping(); offRead(); clearInterval(typingTick); offMsg(); offDel(); offMembers(); offReact(); offNotes(); offHype(); offHyped(); offPoll(); offGone(); offNicks(); offPins(); closeEmojiPicker(); startReply = null; gifReply = null; stopRecording?.(); closeStickers(); closeGifs(); } };
}

