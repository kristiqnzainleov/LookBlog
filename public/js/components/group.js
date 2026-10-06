// A group, Discord style: channels on the left (text and voice), the open channel on the right.
// Admins manage channels, roles, the colour and events; anyone sets their own nickname.
import { h, icon, avatar, toast, modal, confirmClick, plural, tick, spinner, empty } from "../ui.js";
import { api, upload } from "../api.js";
import { on, emit, state } from "../state.js";
import { navigate, profileHref } from "../router.js";
import { conversation, chatPic, groupVisibilityPicker } from "./chat.js";
import { openReportUser } from "./report.js";
import { joinVoice, leaveVoice, currentVoice, voicePerson, speakingNow, placeDock, BUILTIN_SOUNDS, previewSound } from "./voice-room.js";

const COLORS = ["#ff4fa3", "#ff3b4f", "#ff8a3b", "#ffcc33", "#b6f23a", "#1fc77a", "#19d3c5", "#66d1ff", "#3b6bff", "#a66bff", "#d6a4ff", "#ff7eb3", "#f5f0eb"];
const has = (chat, p) => chat.perms?.includes(p);
const anyAdmin = (chat) => ["manage_group", "manage_channels", "manage_roles", "kick", "manage_nicknames"].some((p) => has(chat, p));

/* ---------- Invite people: send to someone, or share a link ---------- */
export function openInvite(chat) {
  const link = h("input", { type: "text", class: "text-input invite-link", readonly: true, value: "Making a link…" });
  const copy = h("button", { type: "button", class: "btn btn-primary btn-sm", text: "Copy" });
  const expiry = h("select", { class: "text-input invite-exp" },
    h("option", { value: "1", text: "Expires in 1 day" }), h("option", { value: "7", text: "Expires in 7 days", selected: true }), h("option", { value: "0", text: "Never expires" }));
  const uses = h("select", { class: "text-input invite-exp" },
    h("option", { value: "0", text: "No limit" }), h("option", { value: "1", text: "1 use" }), h("option", { value: "5", text: "5 uses" }), h("option", { value: "25", text: "25 uses" }));
  const makeLink = async () => {
    link.value = "Making a link…";
    try { const { invite } = await api(`/api/groups/${chat.id}/invites`, { method: "POST", body: { days: Number(expiry.value), maxUses: Number(uses.value) } }); link.value = location.origin + invite.url; }
    catch (err) { link.value = ""; toast(err.error || "Couldn’t make a link."); }
  };
  expiry.addEventListener("change", makeLink);
  uses.addEventListener("change", makeLink);
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link.value); } catch { link.select(); document.execCommand("copy"); }
    copy.textContent = "Copied!";
    setTimeout(() => (copy.textContent = "Copy"), 1500);
  });
  makeLink();

  const search = h("input", { type: "search", class: "text-input", placeholder: "Search people to invite", autocomplete: "off" });
  const list = h("div", { class: "conn-list invite-list" }, spinner());
  const inGroup = new Set((chat.members || []).map((u) => u.username));
  const sent = new Set();
  const paint = (users) => {
    list.replaceChildren(...users.filter((u) => u.username !== state.me.username).map((u) => {
      const here = inGroup.has(u.username), done = sent.has(u.username);
      const b = h("button", { type: "button", class: "btn btn-xs " + (here || done ? "btn-following" : "btn-follow"), text: here ? "In group" : done ? "Invited ✓" : "Invite", disabled: here || done });
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await api(`/api/groups/${chat.id}/invite-people`, { method: "POST", body: { usernames: [u.username] } });
          sent.add(u.username);
          b.textContent = "Invited ✓"; b.className = "btn btn-xs btn-following";
        } catch (err) { toast(err.error || "Couldn’t invite them."); b.disabled = false; }
      });
      return h("div", { class: "conn-row" }, avatar(u, 40), h("div", { class: "who" }, h("b", {}, u.name, tick(u, 14)), h("span", { class: "muted", text: "@" + u.username })), b);
    }));
    if (!list.children.length) list.append(h("p", { class: "muted", text: "No one found." }));
  };
  const loadDefault = () => api("/api/me/invitable").then(({ users }) => paint(users)).catch(() => paint([]));
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    const q = search.value.trim();
    timer = setTimeout(() => (q ? api(`/api/users/lookup?q=${encodeURIComponent(q)}`).then(({ users }) => paint(users)).catch(() => {}) : loadDefault()), 200);
  });
  loadDefault();
  modal({ title: `Invite people to ${chat.name}`, body: h("div", { class: "create-form" },
    search, list,
    h("b", { class: "vis-label", text: "Or send a link" }),
    h("div", { class: "invite-row" }, link, copy),
    h("div", { class: "invite-row" }, expiry, uses),
    h("p", { class: "create-hint", text: "Anyone with the link can join, even if the group is private. People you follow back also get it as a message." })) });
}

export function groupView(chatId, { onBack } = {}) {
  const side = h("aside", { class: "gv-side" }, spinner());
  const main = h("div", { class: "gv-main" });
  const el = h("section", { class: "group-view" }, side, main);
  let chat = null, convo = null, active = null;
  const unread = new Set();

  // The group's colour is the accent of the whole group page (buttons, my bubbles, highlights)
  function paintColor(c) {
    el.style.setProperty("--group", c || "#ff4fa3");
    if (c && c !== "#ff4fa3") el.style.setProperty("--pink", c); else el.style.removeProperty("--pink");
  }
  const offColor = on("group:color", (ev) => { if (ev.chatId === chatId) { if (chat) chat.color = ev.color; paintColor(ev.color); } });
  async function load() {
    chat = (await api(`/api/chats/${chatId}`)).chat;
    paintColor(chat.color);
    const want = new URLSearchParams(location.search).get("c");
    const texts = chat.channels.filter((c) => c.kind === "text");
    if (!active || !texts.some((c) => c.id === active)) open(texts.some((c) => c.id === want) ? want : texts[0].id);
    paintSide();
  }

  function open(channelId) {
    active = channelId;
    unread.delete(channelId);
    convo?.stop();
    convo = conversation(chatId, { channelId, embedded: true, onBack: () => el.classList.remove("show-channel"), onChat: (c) => { chat = { ...chat, ...c }; } });
    main.replaceChildren(convo.el);
    el.classList.add("show-channel");
    const u = new URL(location.href);
    u.searchParams.set("c", channelId);
    history.replaceState(history.state, "", u.pathname + u.search);
    paintSide();
  }

  function paintSide() {
    if (!chat) return;
    const head = h("button", { type: "button", class: "gv-head", title: anyAdmin(chat) ? "Group settings" : chat.name },
      chatPic(chat, 40), h("div", { class: "gv-title" }, h("b", { text: chat.name }), h("span", { class: "muted", text: `${plural(chat.memberCount, "member", "members")}${chat.onlineCount ? ` · ${chat.onlineCount} online` : ""}` })),
      anyAdmin(chat) ? icon("gear") : null);
    head.addEventListener("click", () => anyAdmin(chat) ? openSettings() : openAbout());
    const back = h("button", { class: "icon-btn gv-back", "aria-label": "Back" }, icon("back"));
    back.addEventListener("click", () => onBack?.());

    const next = chat.events?.[0];
    const events = h("button", { type: "button", class: "gv-events" }, icon("calendar"),
      h("span", { text: chat.events?.length ? `${plural(chat.events.length, "event", "events")}` : "Events" }),
      next ? h("small", { class: "muted", text: new Date(next.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) }) : null);
    events.addEventListener("click", openEvents);
    const invite = chat.member ? h("button", { type: "button", class: "gv-invite" }, icon("userPlus"), h("span", { text: "Invite people" })) : null;
    invite?.addEventListener("click", () => openInvite(chat));
    const rolesBtn = has(chat, "manage_roles") ? h("button", { type: "button", class: "gv-roles", title: "Create and give roles" }, h("span", { class: "role-dot", style: `--rc:${chat.color}` }), h("span", { text: "Roles" })) : null;
    rolesBtn?.addEventListener("click", () => openSettings("roles"));

    const section = (title, kind) => {
      const add = has(chat, "manage_channels") ? h("button", { type: "button", class: "gv-add", title: `New ${kind} channel`, "aria-label": `New ${kind} channel`, text: "+" }) : null;
      add?.addEventListener("click", () => newChannel(kind));
      return h("div", { class: "gv-sec" }, h("span", { text: title }), add);
    };
    const texts = chat.channels.filter((c) => c.kind === "text").map((c) => {
      const b = h("button", { type: "button", class: "gv-ch" + (c.id === active ? " on" : "") + (unread.has(c.id) ? " unread" : "") }, icon("hash"), h("span", { text: c.name }));
      b.addEventListener("click", () => open(c.id));
      return b;
    });
    const mine = currentVoice();
    const voices = chat.channels.filter((c) => c.kind === "voice").map((c) => {
      const here = mine && mine.chatId === chat.id && mine.channelId === c.id;
      const b = h("button", { type: "button", class: "gv-ch voice" + (here ? " on" : ""), title: here ? "You’re here" : "Join voice" }, icon("speaker"), h("span", { text: c.name }),
        c.voice?.length ? h("small", { class: "gv-count", text: String(c.voice.length) }) : null);
      b.addEventListener("click", () => {
        if (!chat.member) return toast("Join the group to use voice channels.");
        joinVoice(chat, c);
      });
      const kick = has(chat, "kick") ? async (p) => {
        const target = chat.members?.find((m) => m.username === p.username);
        if (target && ((target.rank ?? 0) >= (chat.myRank ?? 0) || target.isOwner)) return toast("You can’t disconnect them.");
        try { await api(`/api/groups/${chat.id}/voice`, { method: "POST", body: { kind: "kick", channelId: c.id, username: p.username } }); toast(`${p.name} was disconnected.`); }
        catch (err) { toast(err.error || "Couldn’t disconnect them."); }
      } : null;
      return h("div", { class: "gv-voice" }, b, h("div", { class: "gv-people" }, ...(c.voice || []).map((p) => voicePerson(p, kick))));
    });

    const meRow = chat.member ? (() => {
      const meInfo = chat.members?.find((m) => m.isMe);
      const nick = h("button", { type: "button", class: "icon-btn", title: "Your nickname here", "aria-label": "Your nickname here" }, h("span", { class: "nick-ic", text: "Aa" }));
      nick.addEventListener("click", () => editNickname(meInfo));
      const leave = h("button", { type: "button", class: "icon-btn", title: "Leave group", "aria-label": "Leave group" }, icon("leave"));
      confirmClick(leave, "Leave?", async () => {
        if (currentVoice()?.chatId === chat.id) await leaveVoice();
        await api(`/api/groups/${chat.id}/leave`, { method: "POST" });
        toast(`You left ${chat.name}.`);
        emit("chats:changed");
        navigate("/groups");
      });
      return h("div", { class: "gv-me" }, avatar(state.me, 32), h("div", { class: "gv-me-name" }, h("b", { text: meInfo?.nickname || state.me.name }), h("span", { class: "muted", text: "@" + state.me.username })), nick, leave);
    })() : null;

    const top = h("div", { class: "gv-top" + (chat.banner ? " has-banner" : "") }, back, head);
    if (chat.banner) top.style.backgroundImage = `linear-gradient(180deg, rgba(10,10,10,0.25), rgba(21,20,20,0.95)), url("${chat.banner}")`;
    side.replaceChildren(top, h("div", { class: "gv-quick" }, invite, rolesBtn), events,
      h("nav", { class: "gv-list" }, section("Text channels", "text"), ...texts, section("Voice channels", "voice"), ...voices), h("div", { class: "gv-dock-slot" }), meRow);
    placeDock();
    side.querySelectorAll("[data-voice-user]").forEach((x) => x.classList.toggle("speaking", speakingNow.has(x.dataset.voiceUser)));
  }

  /* ---------- Channels ---------- */
  function newChannel(kind) {
    const name = h("input", { type: "text", class: "text-input", maxlength: 30, placeholder: kind === "text" ? "new-channel" : "Gaming room" });
    const go = h("button", { type: "button", class: "btn btn-primary btn-full", text: `Create ${kind} channel` });
    const m = modal({ title: kind === "text" ? "New text channel" : "New voice channel", body: h("div", { class: "create-form" }, name, go) });
    const create = async () => {
      go.disabled = true;
      try {
        const { channel } = await api(`/api/groups/${chat.id}/channels`, { method: "POST", body: { name: name.value, kind } });
        m.close();
        await load();
        if (kind === "text") open(channel.id);
      } catch (err) { toast(err.error || "Couldn’t create it."); go.disabled = false; }
    };
    go.addEventListener("click", create);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
    setTimeout(() => name.focus(), 50);
  }

  /* ---------- Nicknames ---------- */
  function editNickname(member) {
    const self = member.isMe;
    const input = h("input", { type: "text", class: "text-input", maxlength: 32, placeholder: member.name, value: member.nickname || "" });
    const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save" });
    const m = modal({ title: self ? "Your nickname" : `Nickname for ${member.name}`, body: h("div", { class: "create-form" },
      h("p", { class: "create-hint", text: "Shown instead of the name everywhere in this group. Leave empty to remove." }), input, save) });
    const go = async () => {
      try { await api(`/api/chats/${chat.id}/nickname`, { method: "POST", body: { username: member.username, nickname: input.value } }); m.close(); toast("Nickname saved."); load(); }
      catch (err) { toast(err.error || "Couldn’t save it."); }
    };
    save.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  /* ---------- About (for people who can't change anything) ---------- */
  function openAbout() {
    modal({ title: chat.name, body: h("div", { class: "create-form" },
      chat.description ? h("p", { text: chat.description }) : h("p", { class: "muted", text: "No description." }),
      h("p", { class: "muted", text: `${plural(chat.memberCount, "member", "members")} · ${chat.visibility} group` })) });
  }

  /* ---------- Events ---------- */
  function openEvents() {
    const list = h("div", { class: "ev-list" });
    const paint = () => {
      list.replaceChildren(...(chat.events || []).map((ev) => {
        const when = new Date(ev.startsAt);
        const going = h("button", { type: "button", class: "btn btn-xs " + (ev.mine ? "btn-following" : "btn-primary"), text: ev.mine ? "Going ✓" : "I’m going" });
        going.addEventListener("click", async () => {
          try { const { event } = await api(`/api/groups/${chat.id}/events/${ev.id}/going`, { method: "POST" }); Object.assign(ev, event); paint(); }
          catch (err) { toast(err.error || "Couldn’t save that."); }
        });
        const del = ev.canDelete ? h("button", { type: "button", class: "icon-btn", title: "Remove event", "aria-label": "Remove event" }, icon("trash")) : null;
        if (del) confirmClick(del, "Remove?", async () => { await api(`/api/groups/${chat.id}/events/${ev.id}`, { method: "DELETE" }); chat.events = chat.events.filter((x) => x !== ev); paint(); });
        const ch = chat.channels.find((c) => c.id === ev.channelId);
        return h("div", { class: "event-card big" },
          h("div", { class: "ev-date" }, h("b", { text: when.toLocaleDateString("en-US", { day: "numeric" }) }), h("span", { text: when.toLocaleDateString("en-US", { month: "short" }) })),
          h("div", { class: "ev-text" }, h("b", { text: ev.title }),
            h("span", { class: "muted", text: when.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" }) + (ch ? ` · ${ch.kind === "voice" ? "🔊" : "#"} ${ch.name}` : "") }),
            ev.description ? h("p", { text: ev.description }) : null,
            h("span", { class: "muted ev-going", text: ev.going ? `${plural(ev.going, "person", "people")} going: ${ev.goingNames.join(", ")}` : "No one going yet" })),
          h("div", { class: "ev-acts" }, going, del));
      }));
      if (!chat.events?.length) list.append(empty("No upcoming events.", has(chat, "manage_events") ? "Plan something below." : "Admins can plan events here."));
    };
    paint();
    let form = null;
    if (has(chat, "manage_events")) {
      const title = h("input", { type: "text", class: "text-input", maxlength: 80, placeholder: "Event name, e.g. Movie night" });
      const d = new Date(Date.now() + 24 * 3600 * 1000); d.setMinutes(0, 0, 0);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const when = h("input", { type: "datetime-local", class: "text-input", value: local });
      const where = h("select", { class: "text-input" }, h("option", { value: "", text: "Where (optional)" }),
        ...chat.channels.map((c) => h("option", { value: c.id, text: (c.kind === "voice" ? "🔊 " : "# ") + c.name })));
      const desc = h("textarea", { class: "text-input", rows: 2, maxlength: 1000, placeholder: "What’s happening? (optional)" });
      const go = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Create event" });
      go.addEventListener("click", async () => {
        go.disabled = true;
        try {
          const { event } = await api(`/api/groups/${chat.id}/events`, { method: "POST", body: { title: title.value, startsAt: new Date(when.value).toISOString(), channelId: where.value || null, description: desc.value } });
          chat.events = [...(chat.events || []), event].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          title.value = ""; desc.value = "";
          paint();
          toast("Event created.");
        } catch (err) { toast(err.error || "Couldn’t create it."); }
        go.disabled = false;
      });
      form = h("div", { class: "create-form ev-form" }, h("b", { class: "vis-label", text: "New event" }), title, when, where, desc, go);
    }
    modal({ title: `Events · ${chat.name}`, body: h("div", {}, list, form) });
  }

  /* ---------- Settings: overview, channels, roles, members ---------- */
  function openSettings(startTab) {
    const tabs = [
      has(chat, "manage_group") && ["overview", "Overview"],
      has(chat, "manage_channels") && ["channels", "Channels"],
      has(chat, "manage_roles") && ["roles", "Roles"],
      has(chat, "manage_sounds") && ["sounds", "Sounds"],
      ["members", "Members"],
    ].filter(Boolean);
    const bar = h("div", { class: "gs-tabs" });
    const pane = h("div", { class: "gs-pane" });
    const m = modal({ title: "Group settings", wide: true, body: h("div", { class: "group-settings" }, bar, pane) });
    let tab = startTab || tabs[0][0];
    const show = (t) => {
      tab = t;
      bar.replaceChildren(...tabs.map(([id, label]) => h("button", { type: "button", class: "gs-tab" + (id === tab ? " on" : ""), text: label, onclick: () => show(id) })));
      pane.replaceChildren(({ overview, channels, roles, members, sounds })[t]());
    };
    const refresh = async () => { await load(); show(tab); };

    function overview() {
      let color = chat.color || "#ff4fa3";
      const name = h("input", { type: "text", class: "text-input", maxlength: 60, value: chat.name });
      const desc = h("textarea", { class: "text-input", rows: 3, maxlength: 500, placeholder: "What is this group about?" });
      desc.value = chat.description || "";
      const swatches = h("div", { class: "swatches" });
      const custom = h("input", { type: "color", class: "swatch-custom", value: color, title: "Any colour" });
      const paintSw = () => {
        swatches.replaceChildren(...COLORS.map((c) => {
          const b = h("button", { type: "button", class: "swatch" + (c === color ? " on" : ""), style: `--c:${c}`, "aria-label": c });
          b.addEventListener("click", () => { color = c; custom.value = c; paintSw(); });
          return b;
        }), custom);
      };
      custom.addEventListener("input", () => { color = custom.value; paintSw(); });
      paintSw();
      const vis = groupVisibilityPicker(chat.visibility || "public");
      // Group picture (icon) and banner (also the thumbnail on the Groups page)
      let cover = chat.cover || null, banner = chat.banner || null, uploading = 0;
      const pics = h("div", { class: "gs-pics" });
      const picker = (label, get, set, cls) => {
        const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", hidden: true });
        const box = h("button", { type: "button", class: "gs-pic " + cls, title: `Change ${label.toLowerCase()}` });
        const remove = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Remove" });
        const paint = () => {
          box.style.backgroundImage = get() ? `url("${get()}")` : "";
          box.classList.toggle("empty", !get());
          // Camera in the middle: "add" when empty, "change" over the picture
          box.replaceChildren(get() ? h("span", { class: "gc-edit" }, icon("camera"), h("span", { text: "Change" })) : h("span", { class: "gc-hint" }, icon("camera"), h("span", { text: "Add " + label.toLowerCase() })));
          remove.hidden = !get();
        };
        box.addEventListener("click", () => input.click());
        remove.addEventListener("click", () => { set(null); paint(); });
        input.addEventListener("change", async () => {
          const f = input.files[0]; input.value = "";
          if (!f) return;
          uploading++; save.disabled = true;
          set(URL.createObjectURL(f)); paint(); box.classList.add("busy");
          try { set((await upload(f)).url); } catch (err) { set(null); toast(err.error || "Upload failed."); }
          box.classList.remove("busy"); paint();
          if (!--uploading) save.disabled = false;
        });
        paint();
        return h("div", { class: "gs-pic-field" }, h("span", { class: "vis-label", text: label }), box, remove, input);
      };
      pics.append(picker("Picture", () => cover, (v) => (cover = v), "icon"), picker("Banner", () => banner, (v) => (banner = v), "banner"));
      const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save" });
      save.addEventListener("click", async () => {
        save.disabled = true;
        try {
          await api(`/api/groups/${chat.id}`, { method: "POST", body: { name: name.value, description: desc.value, cover, banner, visibility: vis.value(), color } });
          toast("Group saved.");
          emit("chats:changed");
          refresh();
        } catch (err) { toast(err.error || "Couldn’t save."); }
        save.disabled = false;
      });
      const out = h("div", { class: "create-form" }, pics, h("b", { class: "vis-label", text: "Name" }), name, desc, h("b", { class: "vis-label", text: "Group colour" }), swatches, vis.el, save);
      if (chat.isOwner) {
        const del = h("button", { type: "button", class: "btn btn-full btn-danger", text: "Delete group" });
        confirmClick(del, "Click again to delete for everyone", async () => {
          try { await api(`/api/groups/${chat.id}`, { method: "DELETE" }); m.close(); toast(`${chat.name} was deleted.`); emit("chats:changed"); navigate("/messages"); }
          catch (err) { toast(err.error || "Couldn’t delete the group."); }
        });
        out.append(h("div", { class: "danger-zone" }, h("b", { text: "Delete this group" }), h("p", { class: "muted", text: "All its channels and messages are removed for everyone. This can’t be undone." }), del));
      }
      return out;
    }

    function channels() {
      const list = h("div", { class: "gs-list" }, ...chat.channels.map((c) => {
        const input = h("input", { type: "text", class: "text-input", maxlength: 30, value: c.name });
        const save = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Rename" });
        save.addEventListener("click", async () => {
          try { await api(`/api/groups/${chat.id}/channels/${c.id}`, { method: "POST", body: { name: input.value } }); toast("Renamed."); refresh(); }
          catch (err) { toast(err.error || "Couldn’t rename it."); }
        });
        const del = h("button", { type: "button", class: "icon-btn", title: "Delete channel", "aria-label": "Delete channel" }, icon("trash"));
        confirmClick(del, c.kind === "text" ? "Delete with all its messages?" : "Delete?", async () => {
          try { await api(`/api/groups/${chat.id}/channels/${c.id}`, { method: "DELETE" }); toast("Channel deleted."); refresh(); }
          catch (err) { toast(err.error || "Couldn’t delete it."); }
        });
        return h("div", { class: "gs-row" }, h("span", { class: "gs-ic" }, icon(c.kind === "voice" ? "speaker" : "hash")), input, save, del);
      }));
      const addText = h("button", { type: "button", class: "btn btn-sm btn-outline-light" }, icon("hash"), h("span", { text: "New text channel" }));
      const addVoice = h("button", { type: "button", class: "btn btn-sm btn-outline-light" }, icon("speaker"), h("span", { text: "New voice channel" }));
      addText.addEventListener("click", () => { m.close(); newChannel("text"); });
      addVoice.addEventListener("click", () => { m.close(); newChannel("voice"); });
      return h("div", {}, list, h("div", { class: "gs-actions" }, addText, addVoice));
    }

    function roles() {
      const list = h("div", { class: "gs-list" });
      const editor = h("div", { class: "role-editor" });
      const edit = (r) => {
        const name = h("input", { type: "text", class: "text-input", maxlength: 24, value: r?.name || "", placeholder: "Role name, e.g. DJ" });
        const color = h("input", { type: "color", class: "swatch-custom", value: r?.color || "#66d1ff" });
        const perms = Object.entries(chat.allPerms).map(([id, label]) => {
          const box = h("input", { type: "checkbox", checked: r ? r.perms.includes(id) : false, disabled: r?.id === "coowner" });
          return { id, box, row: h("label", { class: "perm-row" }, box, h("span", { text: label })) };
        });
        const save = h("button", { type: "button", class: "btn btn-primary btn-sm", text: r ? "Save role" : "Create role" });
        save.addEventListener("click", async () => {
          try {
            await api(`/api/groups/${chat.id}/roles${r ? "/" + r.id : ""}`, { method: "POST", body: { name: name.value, color: color.value, perms: perms.filter((p) => p.box.checked).map((p) => p.id) } });
            toast(r ? "Role saved." : "Role created.");
            refresh();
          } catch (err) { toast(err.error || "Couldn’t save the role."); }
        });
        const del = r && !r.builtin ? h("button", { type: "button", class: "btn btn-sm btn-danger", text: "Delete role" }) : null;
        if (del) confirmClick(del, "Sure?", async () => { await api(`/api/groups/${chat.id}/roles/${r.id}`, { method: "DELETE" }); toast("Role deleted."); refresh(); });
        editor.replaceChildren(h("b", { class: "vis-label", text: r ? `Edit ${r.name}` : "New role" }), h("div", { class: "role-name-row" }, color, name),
          h("div", { class: "perm-list" }, ...perms.map((p) => p.row)), h("div", { class: "gs-actions" }, save, del));
      };
      list.replaceChildren(...chat.roles.map((r) => {
        const count = chat.members.filter((x) => (x.roles || []).includes(r.id)).length;
        const b = h("button", { type: "button", class: "gs-role" }, h("span", { class: "role-dot", style: `--rc:${r.color}` }), h("b", { text: r.name }),
          h("span", { class: "muted", text: `${plural(count, "person", "people")} · ${r.perms.length} permission${r.perms.length === 1 ? "" : "s"}` }));
        b.addEventListener("click", () => edit(r));
        return b;
      }));
      const add = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "+ New role" });
      add.addEventListener("click", () => edit(null));
      edit(null);
      return h("div", { class: "roles-split" }, h("div", {}, list, add), editor);
    }

    function sounds() {
      const list = h("div", { class: "gs-list" }, ...(chat.sounds || []).map((s) => {
        const play = h("button", { type: "button", class: "icon-btn", title: "Play", "aria-label": "Play" }, icon("play"));
        play.addEventListener("click", () => previewSound(s));
        const del = h("button", { type: "button", class: "icon-btn", title: "Delete", "aria-label": "Delete" }, icon("trash"));
        confirmClick(del, "Delete?", async () => { try { await api(`/api/groups/${chat.id}/sounds/${s.id}`, { method: "DELETE" }); refresh(); } catch (err) { toast(err.error || "Couldn’t delete it."); } });
        return h("div", { class: "gs-row sound-row" }, h("span", { class: "sb-emoji", text: s.emoji }), h("b", { class: "grow", text: s.name }), play, del);
      }));
      if (!chat.sounds?.length) list.append(h("p", { class: "muted", text: "No sounds yet. Everyone also gets the LookBlog sounds below." }));
      const emoji = h("input", { type: "text", class: "text-input role-own-emoji", maxlength: 8, placeholder: "🔊" });
      const name = h("input", { type: "text", class: "text-input", maxlength: 24, placeholder: "Sound name, e.g. Bruh" });
      const file = h("input", { type: "file", accept: "audio/mpeg,audio/ogg,audio/webm,audio/mp4,audio/x-m4a,.mp3,.m4a,.ogg", hidden: true });
      const pick = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Choose a sound file" });
      const info = h("span", { class: "muted sound-file" });
      const add = h("button", { type: "button", class: "btn btn-primary btn-sm", text: "Add sound", disabled: true });
      let chosen = null;
      pick.addEventListener("click", () => file.click());
      file.addEventListener("change", () => {
        const f = file.files[0];
        if (!f) return;
        const a = new Audio(URL.createObjectURL(f));
        a.addEventListener("loadedmetadata", () => {
          if (a.duration > 8) { chosen = null; add.disabled = true; info.textContent = `That one is ${Math.round(a.duration)}s. Keep sounds under 8 seconds.`; return; }
          chosen = f; add.disabled = false;
          info.textContent = `${f.name} · ${a.duration.toFixed(1)}s`;
          if (!name.value) name.value = f.name.replace(/\.[^.]+$/, "").slice(0, 24);
        });
        a.addEventListener("error", () => { info.textContent = "That file can’t be played. Try an MP3."; add.disabled = true; });
      });
      add.addEventListener("click", async () => {
        if (!chosen) return;
        add.disabled = true; add.textContent = "Uploading…";
        try {
          const { url } = await upload(chosen);
          await api(`/api/groups/${chat.id}/sounds`, { method: "POST", body: { name: name.value, emoji: emoji.value, url } });
          toast("Sound added.");
          refresh();
        } catch (err) { toast(err.error || "Couldn’t add the sound."); add.disabled = false; add.textContent = "Add sound"; }
      });
      const builtins = h("div", { class: "sb-grid" }, ...BUILTIN_SOUNDS.map((s) => {
        const b = h("button", { type: "button", class: "sb-item" }, h("span", { class: "sb-emoji", text: s.emoji }), h("span", { class: "sb-name", text: s.name }));
        b.addEventListener("click", () => previewSound(s));
        return b;
      }));
      return h("div", { class: "create-form" },
        h("p", { class: "create-hint", text: "Sounds play for everyone in a voice channel. Open the soundboard from the Voice connected panel." }),
        list, h("b", { class: "vis-label", text: "Add a sound (up to 8 seconds)" }),
        h("div", { class: "role-own" }, emoji, name), h("div", { class: "gs-actions" }, pick, add), info, file,
        h("b", { class: "vis-label", text: "LookBlog sounds (tap to hear)" }), builtins);
    }

    function members() {
      const newRole = has(chat, "manage_roles") ? h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "+ Create a role" }) : null;
      newRole?.addEventListener("click", () => show("roles"));
      return h("div", { class: "gs-list" }, newRole ? h("div", { class: "gs-actions top" }, h("span", { class: "muted", text: "Tap a role under someone’s name to give it or take it away." }), newRole) : null, ...chat.members.map((u) => {
        const below = (u.rank ?? 0) < (chat.myRank ?? 0) && !u.isOwner;
        const chips = h("div", { class: "role-chips" }, ...chat.roles.map((r) => {
          const onIt = (u.roles || []).includes(r.id);
          const canToggle = has(chat, "manage_roles") && below && (r.id !== "coowner" || chat.isOwner);
          const chip = h("button", { type: "button", class: "grole" + (onIt ? " on" : ""), style: `--rc:${r.color}`, text: r.name, disabled: !canToggle });
          if (!canToggle && !onIt) chip.hidden = true;
          chip.addEventListener("click", async () => {
            const next = onIt ? u.roles.filter((x) => x !== r.id) : [...(u.roles || []), r.id];
            try { await api(`/api/groups/${chat.id}/members/${encodeURIComponent(u.username)}/roles`, { method: "POST", body: { roles: next } }); refresh(); }
            catch (err) { toast(err.error || "Couldn’t change roles."); }
          });
          return chip;
        }));
        const nick = (u.isMe || (has(chat, "manage_nicknames") && below)) ? h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Nickname" }) : null;
        nick?.addEventListener("click", () => editNickname(u));
        const kick = has(chat, "kick") && below && !u.isMe ? h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Remove" }) : null;
        if (kick) confirmClick(kick, "Remove?", async () => {
          try { await api(`/api/groups/${chat.id}/members/${encodeURIComponent(u.username)}`, { method: "DELETE" }); toast(`${u.name} was removed.`); refresh(); }
          catch (err) { toast(err.error || "Couldn’t remove them."); }
        });
        const report = !u.isMe ? h("button", { type: "button", class: "icon-btn", title: `Report ${u.name}`, "aria-label": `Report ${u.name}` }, icon("flag")) : null;
        report?.addEventListener("click", () => openReportUser(u));
        return h("div", { class: "gs-member" },
          h("a", { href: profileHref(u.username), onclick: m.close }, avatar(u, 40)),
          h("div", { class: "gs-who" }, h("b", {}, u.nickname || u.name, tick(u, 14), u.isOwner ? h("span", { class: "owner-crown", title: "Owner" }, icon("crown")) : null),
            h("span", { class: "muted", text: (u.nickname ? u.name + " · " : "") + "@" + u.username }), chips),
          h("div", { class: "gs-acts" }, nick, kick, report));
      }));
    }
    show(tab);
  }

  /* ---------- Live updates ---------- */
  const offs = [
    on("message", (ev) => {
      if (ev.chatId !== chatId || !ev.message.channelId || ev.message.channelId === active || ev.message.mine) return;
      unread.add(ev.message.channelId);
      paintSide();
    }),
    on("group:changed", (ev) => { if (ev.chatId === chatId) load().catch(() => {}); }),
    on("chat:nicknames", (ev) => { if (ev.chatId === chatId) load().catch(() => {}); }),
    on("voice:state", (ev) => {
      if (ev.chatId !== chatId || !chat) return;
      const c = chat.channels.find((x) => x.id === ev.channelId);
      if (c) { c.voice = ev.participants; paintSide(); }
    }),
    on("voice:local", () => paintSide()),
    on("presence", () => {}),
  ];

  load().catch((err) => side.replaceChildren(empty("Couldn’t open this group.", err.error || "")));
  // Who is in the voice channels: checked every 15 seconds too, in case a live update was missed
  const voiceCheck = setInterval(async () => {
    if (document.visibilityState !== "visible" || !chat) return;
    try {
      const fresh = (await api(`/api/chats/${chatId}`)).chat;
      let changed = false;
      for (const c of chat.channels) {
        const f = fresh.channels?.find((x) => x.id === c.id);
        if (f && JSON.stringify(f.voice || []) !== JSON.stringify(c.voice || [])) { c.voice = f.voice; changed = true; }
      }
      if (changed) paintSide();
    } catch {}
  }, 15000);
  return { el, stop: () => { clearInterval(voiceCheck); convo?.stop(); offs.forEach((f) => f()); offColor(); } };
}
