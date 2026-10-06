// One conversation: a direct chat or a group. Messages arrive live.
import { h, icon, avatar, timeEl, empty, spinner, toast, confirmClick, richText, modal, plural, avatarWithPresence, presenceText, tick } from "../ui.js";
import { openEmojiPicker, insertAtCursor, QUICK, closeEmojiPicker } from "./emoji.js";
import { api } from "../api.js";
import { on, emit, state } from "../state.js";
import { profileHref, navigate } from "../router.js";
import { openHref } from "./post.js";
import { createPicker } from "./media-picker.js";
import { createPlayer } from "./player.js";
import { startRecording, voicePlayer } from "./voice.js";
import { openStickers, closeStickers } from "./stickers.js";
import { gifButton, closeGifs, openGifs, gifBody } from "./gifs.js";
import { startCall } from "./call.js";
import { gameView, openGamePicker } from "./games.js";
import { openReportUser } from "./report.js";
import { linkBlock } from "./links.js";
import { upload } from "../api.js";
import { attachMentions } from "./mentions.js";
import { openSoundPicker, soundChip, playSound } from "./sounds.js";
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
    chip.addEventListener("click", () => openReactions(msg, chat));
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
    : msg.media?.gif ? h("img", { class: "msg-gif", src: msg.media.url, alt: "GIF" })
    : msg.media?.sticker ? h("img", { class: "sticker-img", src: msg.media.url, alt: "Sticker" })
    : msg.media?.kind === "sound" ? soundChip(msg.media)
    : msg.media?.kind === "audio" ? voicePlayer(msg.media)
    : msg.media
    ? msg.media.kind === "image"
      ? h("a", { href: msg.media.url, target: "_blank", rel: "noopener", class: "msg-media" }, h("img", { src: msg.media.url, alt: "", loading: "lazy" }))
      : createPlayer({ src: msg.media.url, poster: msg.media.poster || null, width: msg.media.width, height: msg.media.height, className: "msg-media" })
    : null;
  if (msg.viewOnce) return viewOnceRow(msg, chat, onRemoved);
  const call = chat.kind === "dm" && !msg.media && !msg.post ? callNoteText(msg.text, msg.mine, chat.other.name) : null;
  const onlyEmoji = msg.text && !msg.media && !msg.post && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\u200D|\uFE0F|\s){1,24}$/u.test(msg.text) && [...msg.text.replace(/\s/g, "")].length <= 12;
  const quote = msg.replyTo ? replyQuote(msg.replyTo) : null;
  const bubble = h("div", { class: "bubble" + (msg.game ? " game-bubble" : "") + (onlyEmoji && !quote && !msg.storyReply && !msg.noteReply ? " emoji-only" : "") + (msg.media?.kind === "audio" ? " voice-bubble" : "") + (msg.media?.sticker ? " sticker-bubble" : "") + (msg.storyReply?.reaction || msg.instantReply?.reaction ? " story-react" : "") },
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

  if (msg.pinned) bubble.prepend(h("span", { class: "pin-mark", title: "Pinned", text: "📌" }));
  if (msg.expiresAt) bubble.append(h("span", { class: "vanish-mark", title: "Disappears " + new Date(msg.expiresAt).toLocaleString(), text: "⏳" }));
  const row = h("div", { class: "msg" + (msg.mine ? " mine" : "") + (msg.pinned ? " pinned" : "") + (msg.pingsMe ? " pings-me" : ""), dataset: { id: msg.id } },
    msg.mine ? null : h("a", { href: profileHref(msg.author.username), class: "msg-avatar", tabindex: "-1" }, avatar(msg.author, 34)),
    h("div", { class: "msg-stack" }, bubble, reactionsEl(msg, chat)),
    tools.children.length ? tools : null
  );
  row._msg = msg;
  // Phones have no hover: tap a message to show its menu
  bubble.addEventListener("click", (e) => {
    if (!matchMedia("(hover: none), (max-width: 640px)").matches || e.target.closest("a, video, button, .lb-player")) return;
    const open = row.classList.contains("show-tools");
    document.querySelectorAll(".msg.show-tools").forEach((x) => x.classList.remove("show-tools"));
    if (!open) row.classList.add("show-tools");
  });
  // Double-click a message to send a heart
  bubble.addEventListener("dblclick", (e) => { if (!e.target.closest("a, video, .lb-player")) react(msg, chat, "❤️"); });
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
  function paintTyping() {
    const now = Date.now();
    for (const [u, t] of typers) if (t.until < now) typers.delete(u);
    const names = [...typers.values()].map((t) => t.name);
    typingBar.hidden = !names.length;
    if (!names.length) return;
    const who = names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : `${names[0]}, ${names[1]} and ${names.length - 2} more are typing`;
    typingBar.replaceChildren(h("span", { class: "typing-dots" }, h("i"), h("i"), h("i")), h("span", { text: who }));
  }
  const typingTick = setInterval(paintTyping, 1000);
  const el = h("section", { class: "convo" }, head, pinBar, list, typingBar, footer);
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
  const toBottom = () => (list.scrollTop = list.scrollHeight);

  function add(msg, { prepend = false } = {}) {
    if (ids.has(msg.id)) return;
    ids.add(msg.id);
    list.querySelector(".empty")?.remove();
    const row = messageEl(msg, chat, () => ids.delete(msg.id));
    if (prepend) list.prepend(row); else { list.append(row); if (!msg.system) { lastMsg = msg; paintSeen(); } }
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
      tools.append(h("button", { class: "icon-btn", title: "Members", "aria-label": "Members", onclick: () => openMembers(chat, refresh) }, icon("group")));
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
    attachMentions(text, { people: () => (chat.kind === "group" ? (chat.members || []).filter((u) => !u.isMe) : chat.other ? [chat.other] : []), everyone: () => chat.kind === "group" && chat.perms?.includes("mention_everyone") });
    const err = h("p", { class: "form-error", role: "alert", hidden: true });
    const showErr = (m) => { err.textContent = m; err.hidden = !m; };
    const send = h("button", { type: "submit", class: "send-btn", "aria-label": "Send", disabled: true }, icon("send"));
    const picker = createPicker({ accept: "both", max: 1, onChange: update, onError: showErr });
    function update() { send.disabled = picker.busy() || (!text.value.trim() && !picker.media().length); }
    text.addEventListener("input", () => { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight, 160) + "px"; update(); });
    text.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    let replying = null;
    const replyBar = h("div", { class: "reply-bar", hidden: true });
    const setReply = (m) => {
      replying = m;
      replyBar.hidden = !m;
      if (!m) return replyBar.replaceChildren();
      const what = m.text || (m.media?.gif ? "GIF" : m.media?.sticker ? "Sticker" : m.media ? (m.media.kind === "audio" ? "🎤 Voice message" : m.media.kind === "video" ? "Video" : "Photo") : m.post ? "Shared post" : "Message");
      const cancel = h("button", { type: "button", class: "tool-icon", "aria-label": "Cancel reply" }, icon("close"));
      cancel.addEventListener("click", () => { setReply(null); text.focus(); });
      replyBar.replaceChildren(icon("replyArrow"),
        h("div", { class: "rb-text" }, h("b", { text: m.mine ? "Replying to yourself" : `Replying to ${m.author.name}` }), h("span", { text: what })),
        cancel);
      text.focus();
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
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId,  media: { url, duration, peaks }, replyTo: replying?.id || null } });
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
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId, ...body, replyTo: replying?.id || null } });
        setReply(null); add(message); toBottom();
        if (chat.kind === "dm") refresh().catch(() => {});
      } catch (ex) { showErr(ex.error || `Couldn’t send the ${what}.`); }
    };
    // Sounds: mine, this group's, built-in
    const soundBtn = h("button", { type: "button", class: "tool-btn", "aria-label": "Send a sound", title: "Send a sound" }, h("span", { class: "tool-emoji", text: "🔊" }));
    soundBtn.addEventListener("click", () => openSoundPicker(soundBtn, { group: chat.kind === "group" ? chat : null, builtin: chat.kind === "group", onPick: (b) => sendExtra(b, "sound") }));
    stickerBtn.addEventListener("click", () => openStickers(stickerBtn, async (st, kind) => {
      try {
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId, ...(kind === "group" ? { groupSticker: st.id } : { sticker: st.id }), replyTo: replying?.id || null } });
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
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId, songId: sg.id, replyTo: replying?.id || null } });
        setReply(null); add(message); toBottom();
        if (chat.kind === "dm") refresh().catch(() => {});
      } catch (ex) { showErr(ex.error || "Couldn’t send the song."); throw ex; }
    }));
    inputRow.insertBefore(songBtn, text);
    const sendGif = async (g, to = replying) => {
      try {
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId,  ...gifBody(g), replyTo: to?.id || null } });
        setReply(null); add(message); toBottom();
        if (chat.kind === "dm") refresh().catch(() => {});
      } catch (ex) { showErr(ex.error || "Couldn’t send the GIF."); }
    };
    gifReply = sendGif;
    const chatGif = gifButton((g) => sendGif(g));
    inputRow.insertBefore(chatGif, text);
    const form = h("form", { class: "convo-form", novalidate: true }, replyBar, picker.previews, inputRow, recBar, err);
    // View once: the next messages can be opened one time only (tap again to turn it off)
    let viewOnce = false;
    const voBtn = h("button", { type: "button", class: "tool-btn vo-btn", "aria-label": "View once", "aria-pressed": "false", title: "View once: they can open it one time" }, h("span", { text: "1" }));
    voBtn.addEventListener("click", () => {
      viewOnce = !viewOnce;
      voBtn.classList.toggle("on", viewOnce);
      voBtn.setAttribute("aria-pressed", String(viewOnce));
      text.placeholder = viewOnce ? "View-once message…" : text.dataset.ph || text.placeholder;
      toast(viewOnce ? "View once is on: they can open your messages one time." : "View once is off.");
      text.focus();
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
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId, ...body, replyTo: replying?.id || null } });
        setReply(null);
        add(message);
        toBottom();
      });
    });
    inputRow.insertBefore(camBtn, voBtn);
    footer.append(camInput);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (send.disabled) return;
      showErr("");
      send.disabled = true;
      closeEmojiPicker();
      try {
        const { message } = await api(`/api/chats/${chat.id}/messages`, { method: "POST", body: { channelId,  text: text.value, media: picker.media()[0] || null, replyTo: replying?.id || null, ...(viewOnce ? { viewOnce: true } : {}) } });
        setReply(null);
        add(message);
        toBottom();
        if (chat.kind === "dm") refresh().catch(() => {});
        text.value = "";
        text.style.height = "";
        picker.clear();
      } catch (ex) { showErr(ex.error || "Couldn’t send that."); }
      update();
      text.focus();
    });
    footer.append(form);
    setTimeout(() => text.focus(), 50);
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

  const markRead = () => chat?.member && api(`/api/chats/${chatId}/read`, { method: "POST" }).then(() => emit("chats:changed")).catch(() => {});

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

  return { el, stop: () => { offVo(); offVanish(); clearInterval(vanishTick); offTyping(); offRead(); clearInterval(typingTick); offMsg(); offDel(); offMembers(); offReact(); offGone(); offNicks(); offPins(); closeEmojiPicker(); startReply = null; gifReply = null; stopRecording?.(); closeStickers(); closeGifs(); } };
}

