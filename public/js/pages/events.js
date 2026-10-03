// /events — public events anyone can join · /event/:id — one event with its discussion.
import { h, icon, avatar, tick, empty, spinner, toast, modal, confirmClick, plural, timeEl } from "../ui.js";
import { api, upload } from "../api.js";
import { on, state, emit } from "../state.js";
import { navigate, profileHref } from "../router.js";
import { chatPic } from "../components/chat.js";

const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmtLong = (iso) => new Date(iso).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
// "Tomorrow", "In 3 days", "In 5 hours"
function countdown(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  const hrs = ms / 3600000, days = Math.round(ms / 86400000);
  if (hrs < 1) return `Starts in ${Math.max(1, Math.round(ms / 60000))} min`;
  if (hrs < 20) return `Starts in ${Math.round(hrs)} hour${Math.round(hrs) === 1 ? "" : "s"}`;
  if (days <= 1) return "Tomorrow";
  return days < 14 ? `In ${days} days` : `In ${Math.round(days / 7)} weeks`;
}
const localValue = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function dateBadge(iso) {
  const d = new Date(iso);
  return h("div", { class: "pe-date" }, h("span", { text: d.toLocaleDateString("en-US", { month: "short" }) }), h("b", { text: String(d.getDate()) }));
}
function joinButton(ev, onChange) {
  const b = h("button", { type: "button", class: "btn btn-sm " + (ev.isHost ? "btn-following" : ev.mine ? "btn-following" : "btn-primary"), text: ev.isHost ? "Hosting" : ev.mine ? "Going ✓" : "Join", disabled: ev.isHost });
  b.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    b.disabled = true;
    try {
      const { event } = await api(`/api/public-events/${ev.id}/join`, { method: "POST" });
      if (event.mine) toast(`You’re going to ${event.title}!`);
      onChange?.(event);
    } catch (err) { toast(err.error || "Couldn’t do that."); }
    b.disabled = false;
  });
  return b;
}
function eventCard(ev) {
  const going = h("span", { class: "muted", text: `${plural(ev.going, "person", "people")} going` });
  const card = h("a", { class: "pe-card", href: `/event/${ev.id}` },
    h("div", { class: "pe-cover", style: ev.cover ? `background-image:url("${ev.cover}")` : "" }, dateBadge(ev.startsAt)),
    h("div", { class: "pe-body" },
      h("b", { class: "pe-title", text: ev.title }),
      h("span", { class: "pe-when" }, icon("calendar"), `${fmtDay(ev.startsAt)} · ${fmtTime(ev.startsAt)}`),
      ev.location ? h("span", { class: "pe-where muted", text: "📍 " + ev.location }) : null,
      h("div", { class: "pe-foot" }, h("div", { class: "pe-faces" }, ...ev.goingPeople.slice(0, 4).map((u) => avatar(u, 26))), going,
        joinButton(ev, (e2) => card.replaceWith(eventCard({ ...ev, ...e2 }))))));
  return card;
}

/* ---------- Create or edit ---------- */
export function openEventForm(current = null, onSaved) {
  let cover = current?.cover || null, photo = current?.photo || null, uploading = 0;
  const coverEl = h("button", { type: "button", class: "gc-banner pe-form-cover", title: "Add a cover" });
  const photoEl = h("button", { type: "button", class: "gc-icon", title: "Add a photo" });
  const paint = () => {
    coverEl.style.backgroundImage = cover ? `url("${cover}")` : "";
    coverEl.classList.toggle("empty", !cover);
    coverEl.replaceChildren(h("span", { class: "gc-hint" }, icon("camera"), h("span", { text: cover ? "Change cover" : "Add cover" })));
    photoEl.style.backgroundImage = photo ? `url("${photo}")` : "";
    photoEl.replaceChildren(photo ? h("span", { class: "gc-edit" }, icon("camera"), h("span", { text: "Change" })) : h("span", { class: "gc-hint" }, icon("camera"), h("span", { text: "Photo" })));
  };
  const chooser = (set) => {
    const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", hidden: true });
    input.addEventListener("change", async () => {
      const f = input.files[0]; input.value = "";
      if (!f) return;
      uploading++; save.disabled = true;
      set(URL.createObjectURL(f)); paint();
      try { set((await upload(f)).url); } catch (err) { set(null); toast(err.error || "Upload failed."); }
      if (!--uploading) save.disabled = false;
      paint();
    });
    return input;
  };
  const coverIn = chooser((v) => (cover = v)), photoIn = chooser((v) => (photo = v));
  coverEl.addEventListener("click", () => coverIn.click());
  photoEl.addEventListener("click", () => photoIn.click());
  const start = current ? new Date(current.startsAt) : (() => { const d = new Date(Date.now() + 3 * 86400000); d.setHours(19, 0, 0, 0); return d; })();
  const title = h("input", { type: "text", class: "text-input", maxlength: 90, placeholder: "Event name", value: current?.title || "" });
  const when = h("input", { type: "datetime-local", class: "text-input", value: localValue(start) });
  const until = h("input", { type: "datetime-local", class: "text-input", value: current?.endsAt ? localValue(new Date(current.endsAt)) : "" });
  const where = h("input", { type: "text", class: "text-input", maxlength: 120, placeholder: "Where? A place, an address or “Online”", value: current?.location || "" });
  const desc = h("textarea", { class: "text-input", rows: 5, maxlength: 3000, placeholder: "What’s happening? Tell people what to expect." });
  desc.value = current?.description || "";
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: current ? "Save changes" : "Create public event" });
  const m = modal({ title: current ? "Edit event" : "New public event", body: h("div", { class: "create-form" },
    h("div", { class: "gc-wrap" }, coverEl, photoEl, coverIn, photoIn),
    title, h("div", { class: "pe-row" }, h("label", { class: "pe-field" }, h("span", { class: "vis-label", text: "Starts" }), when), h("label", { class: "pe-field" }, h("span", { class: "vis-label", text: "Ends (optional)" }), until)),
    where, desc, err, save) });
  paint();
  save.addEventListener("click", async () => {
    if (uploading) return;
    err.hidden = true;
    save.disabled = true;
    try {
      const body = { title: title.value, description: desc.value, location: where.value, cover, photo, startsAt: new Date(when.value).toISOString(), endsAt: until.value ? new Date(until.value).toISOString() : null };
      const { event } = await api(current ? `/api/public-events/${current.id}` : "/api/public-events", { method: "POST", body });
      m.close();
      toast(current ? "Event saved." : "Your event is live!");
      onSaved ? onSaved(event) : navigate(`/event/${event.id}`);
    } catch (ex) { err.textContent = ex.error || "Couldn’t save the event."; err.hidden = false; save.disabled = false; }
  });
}

/* ---------- Share to a group (or a chat) ---------- */
export function openShareEvent(ev) {
  const list = h("div", { class: "conn-list" }, spinner());
  const link = location.origin + "/event/" + ev.id;
  const copy = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "Copy link" });
  copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(link); copy.textContent = "Copied!"; } catch { toast(link); } });
  const sentTo = new Set();
  api("/api/chats").then(({ chats }) => {
    const groups = chats.filter((c) => c.kind === "group" && c.member), dms = chats.filter((c) => c.kind === "dm" && c.canSend !== false);
    list.replaceChildren();
    const row = (c) => {
      const b = h("button", { type: "button", class: "btn btn-xs btn-follow", text: "Share" });
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await api(`/api/chats/${c.id}/messages`, { method: "POST", body: { text: `📅 ${ev.title} · /event/${ev.id}` } });
          api(`/api/public-events/${ev.id}/shared`, { method: "POST" }).catch(() => {});
          sentTo.add(c.id);
          b.textContent = "Shared ✓"; b.className = "btn btn-xs btn-following";
        } catch (err) { toast(err.error || "Couldn’t share it."); b.disabled = false; }
      });
      const name = c.kind === "dm" ? (c.other.nickname || c.other.name) : c.name;
      return h("div", { class: "conn-row" }, chatPic(c, 40), h("div", { class: "who" }, h("b", { text: name }), h("span", { class: "muted", text: c.kind === "dm" ? "@" + c.other.username : plural(c.memberCount, "member", "members") })), b);
    };
    if (groups.length) list.append(h("p", { class: "sg-title", text: "Your groups" }), ...groups.map(row));
    if (dms.length) list.append(h("p", { class: "sg-title", text: "Chats" }), ...dms.map(row));
    if (!groups.length && !dms.length) list.append(h("p", { class: "muted", text: "Join a group or start a chat to share events there." }));
  }).catch(() => list.replaceChildren(h("p", { class: "muted", text: "Couldn’t load your groups." })));
  modal({ title: "Share event", body: h("div", { class: "create-form" },
    h("div", { class: "invite-row" }, h("input", { type: "text", class: "text-input invite-link", readonly: true, value: link }), copy),
    list) });
}

/* ---------- /events ---------- */
export function eventsPage(view) {
  document.title = "Events / LookBlog";
  view.classList.add("wide", "page-events");
  let scope = "upcoming";
  const create = h("button", { class: "btn btn-primary btn-sm" }, icon("plus"), h("span", { text: "Create event" }));
  create.addEventListener("click", () => openEventForm());
  const tabs = h("div", { class: "tabs" });
  const grid = h("div", { class: "pe-grid" });
  const paintTabs = () => tabs.replaceChildren(...[["upcoming", "Upcoming"], ["going", "Going"], ["hosting", "Hosting"], ["past", "Past"]].map(([id, label]) =>
    h("button", { class: "tab" + (scope === id ? " active" : ""), onclick: () => { scope = id; paintTabs(); load(); } }, label)));
  async function load() {
    grid.replaceChildren(spinner());
    try {
      const { events } = await api(`/api/public-events?scope=${scope}`);
      grid.replaceChildren(...events.map(eventCard));
      if (!events.length) grid.append(empty(scope === "upcoming" ? "No events yet." : scope === "going" ? "You haven’t joined any events." : scope === "hosting" ? "You’re not hosting anything." : "No past events.", scope === "upcoming" || scope === "hosting" ? "Create one: add a cover, a photo, a time and a place." : ""));
    } catch (err) { grid.replaceChildren(empty("Couldn’t load events.", err.error || "")); }
  }
  view.append(h("header", { class: "column-head" },
    h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "Public events" }), h("p", { class: "page-sub", text: "Meetups, watch parties, games and more. Join one or host your own." })), create)),
    tabs, grid);
  paintTabs();
  load();
  const off = on("public-event", () => load());
  return () => off();
}
eventsPage.navName = () => "events";
eventsPage.layout = "wide";

/* ---------- /event/:id ---------- */
export function eventPage(view, m) {
  const id = m[1];
  view.classList.add("page-event");
  const box = h("div", {}, spinner());
  view.append(box);
  let ev = null;
  const discussion = h("div", { class: "pe-posts" });

  function postEl(p) {
    const del = p.canDelete ? h("button", { type: "button", class: "icon-btn", title: "Delete", "aria-label": "Delete" }, icon("trash")) : null;
    if (del) confirmClick(del, "Delete?", async () => { try { await api(`/api/public-events/${ev.id}/posts/${p.id}`, { method: "DELETE" }); } catch (err) { toast(err.error || "Couldn’t delete it."); } });
    return h("div", { class: "pe-post", dataset: { id: p.id } },
      h("a", { href: profileHref(p.author.username) }, avatar(p.author, 38)),
      h("div", { class: "pe-post-body" },
        h("div", { class: "post-head" }, h("a", { class: "name", href: profileHref(p.author.username) }, p.author.name, tick(p.author, 14)),
          p.isHost ? h("span", { class: "pe-host-tag", text: "Host" }) : null, h("span", { class: "muted" }, timeEl(p.createdAt)), del),
        h("p", { class: "post-text", text: p.text })));
  }
  function paint() {
    document.title = `${ev.title} / LookBlog`;
    const started = new Date(ev.startsAt).getTime() <= Date.now();
    const join = joinButton(ev, (e2) => { Object.assign(ev, e2); load(); });
    const share = h("button", { type: "button", class: "btn btn-sm btn-outline-light" }, icon("share"), h("span", { text: "Share" }));
    share.addEventListener("click", () => openShareEvent(ev));
    const hostTools = ev.isHost ? [
      h("button", { type: "button", class: "btn btn-sm btn-outline-light", onclick: () => openEventForm(ev, (e2) => { ev = e2; paint(); }) }, icon("edit"), h("span", { text: "Edit" })),
      (() => { const d = h("button", { type: "button", class: "btn btn-sm btn-danger", text: "Cancel event" }); confirmClick(d, "Cancel for everyone?", async () => { await api(`/api/public-events/${ev.id}`, { method: "DELETE" }); toast("Event cancelled."); navigate("/events"); }); return d; })(),
    ] : [];
    const text = h("textarea", { class: "pe-input", rows: 1, maxlength: 1000, placeholder: ev.mine || ev.isHost ? "Write something to everyone going…" : "Ask a question or say hi…" });
    const send = h("button", { type: "button", class: "btn btn-primary btn-sm", text: "Post" });
    text.addEventListener("input", () => { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight, 180) + "px"; });
    text.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send.click(); } });
    send.addEventListener("click", async () => {
      if (!text.value.trim()) return text.focus();
      send.disabled = true;
      try {
        const { post } = await api(`/api/public-events/${ev.id}/posts`, { method: "POST", body: { text: text.value } });
        text.value = ""; text.style.height = "";
        if (!discussion.querySelector(`[data-id="${post.id}"]`)) { discussion.querySelector(".empty")?.remove(); discussion.prepend(postEl(post)); }
      } catch (err) { toast(err.error || "Couldn’t post that."); }
      send.disabled = false;
    });
    discussion.replaceChildren(...ev.posts.slice().reverse().map(postEl));
    if (!ev.posts.length) discussion.append(empty("No posts yet.", "Start the conversation."));
    box.replaceChildren(
      h("section", { class: "pe-hero" },
        h("div", { class: "pe-hero-cover", style: ev.cover ? `background-image:url("${ev.cover}")` : "" }),
        h("div", { class: "pe-hero-main" },
          h("div", { class: "pe-photo", style: ev.photo ? `background-image:url("${ev.photo}")` : "" }, ev.photo ? null : dateBadge(ev.startsAt)),
          h("div", { class: "pe-hero-text" },
            h("span", { class: "pe-kicker" + (started ? " live" : "") }, started ? h("span", { class: "pe-live-dot" }) : null, started ? "Happening now" : countdown(ev.startsAt)),
            h("h1", { text: ev.title }),
            h("p", { class: "pe-meta" },
              h("span", {}, icon("calendar"), fmtLong(ev.startsAt) + (ev.endsAt ? ` – ${fmtTime(ev.endsAt)}` : "")),
              ev.location ? h("span", { text: "📍 " + ev.location }) : null,
              h("span", {}, "Hosted by ", h("a", { href: profileHref(ev.host.username) }, ev.host.name), tick(ev.host, 13))),
            h("div", { class: "pe-actions" }, join, share, ...hostTools)))),
      h("div", { class: "pe-cols" },
        h("div", { class: "pe-main" },
          ev.description ? h("section", { class: "pe-card-box" }, h("h3", { text: "About" }), h("p", { class: "pe-desc", text: ev.description })) : null,
          h("section", { class: "pe-card-box" }, h("h3", { text: "Discussion" }), h("div", { class: "pe-compose" }, avatar(state.me, 38), text, send), discussion)),
        h("aside", { class: "pe-side" },
          h("section", { class: "pe-card-box" }, h("h3", { text: `${plural(ev.going, "person", "people")} going` }),
            h("div", { class: "pe-people" }, ...ev.attendees.map((u) => h("a", { href: profileHref(u.username), class: "pe-person", title: u.name }, avatar(u, 40), h("span", { text: u.name }))))),
          h("section", { class: "pe-card-box" }, h("h3", { text: "Invite friends" }), h("p", { class: "muted", text: ev.shares ? `Shared ${plural(ev.shares, "time", "times")} so far. Send it to a group or a chat so more people can join.` : "Send it to a group or a chat so more people can join." }), (() => { const b = h("button", { type: "button", class: "btn btn-sm btn-primary btn-full" }, icon("share"), h("span", { text: "Share to a group" })); b.addEventListener("click", () => openShareEvent(ev)); return b; })()))));
  }
  async function load() {
    try { ev = (await api(`/api/public-events/${encodeURIComponent(id)}`)).event; paint(); }
    catch (err) { box.replaceChildren(empty("This event doesn’t exist anymore.", err.error || "")); }
  }
  load();
  const offs = [
    on("public-event", (e) => { if (e.id === id) load(); }),
    // New posts only refresh the discussion, so a half-written post isn't lost
    on("public-event:post", async (e) => {
      if (e.id !== id || !ev) return;
      try { const { event } = await api(`/api/public-events/${encodeURIComponent(id)}`); ev.posts = event.posts; discussion.replaceChildren(...ev.posts.slice().reverse().map(postEl)); if (!ev.posts.length) discussion.append(empty("No posts yet.", "Start the conversation.")); } catch {}
    }),
  ];
  return () => offs.forEach((f) => f());
}
eventPage.navName = () => "events";
eventPage.layout = "wide";
