// /messages and /messages/:chatId — your conversations on the left, the open one on the right.
import { h, icon, timeAgo, empty, spinner, modal, toast, avatarWithPresence, presenceText, tick } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { navigate } from "../router.js";
import { conversation, chatPic, chatTitle, callNoteText } from "../components/chat.js";
import { notesRow } from "../components/notes.js";
import { instantsPile } from "../components/instants.js";
import { groupView } from "../components/group.js";
import { onHold, openChatOptions, applyWallpaper, applyTheme } from "../components/wallpaper.js";

function openNewMessage() {
  const list = h("div", { class: "conn-list" }, spinner());
  const m = modal({ title: "New message", body: [h("p", { class: "create-hint", text: "You can message people who follow you back." }), list] });
  api("/api/me/mutuals").then(({ users }) => {
    list.replaceChildren();
    if (!users.length) return list.append(empty("No one yet.", "When you and someone follow each other, you can message them here."));
    for (const u of users) {
      const row = h("button", { type: "button", class: "conn-row conn-btn" }, avatarWithPresence(u, 44), h("div", { class: "who" }, h("b", { class: "name" }, u.name, tick(u)), h("span", { class: "muted" }, "@" + u.username + " · ", presenceText(u))));
      row.addEventListener("click", async () => {
        try {
          const { chat } = await api(`/api/dm/${encodeURIComponent(u.username)}`, { method: "POST" });
          m.close();
          navigate(`/messages/${chat.id}`);
        } catch (err) { toast(err.error || "Couldn’t open the chat."); }
      });
      list.append(row);
    }
  }).catch((err) => list.replaceChildren(empty("Couldn’t load people.", err.error || "")));
}

export function messagesPage(view, m) {
  const openId = m[1] ? decodeURIComponent(m[1].slice(1)) : null;
  document.title = "Messages / LookBlog";
  view.classList.add("page-messages");

  const listEl = h("div", { class: "inbox-list" }, spinner());
  const newBtn = h("button", { class: "icon-btn", "aria-label": "New message", title: "New message" }, icon("edit"));
  newBtn.addEventListener("click", openNewMessage);
  const inbox = h("aside", { class: "inbox" },
    h("header", { class: "inbox-head" }, backToFeed(), h("h1", { text: "Messages" }), newBtn),
    notesRow(),
    listEl,
    h("a", { class: "inbox-groups", href: "/groups" }, icon("group"), h("span", { text: "Find public groups" })),
    // Instants: phones only (the pile hides itself on computers)
    instantsPile()
  );
  const pane = h("div", { class: "convo-pane" });
  const messenger = h("div", { class: "messenger" + (openId ? " has-open" : "") }, inbox, pane);
  view.append(messenger);

  // Phones: the chat window never moves. It's exactly as tall as what you can see (the keyboard included),
  // and the page itself can't be scrolled or pushed up.
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    document.documentElement.style.setProperty("--vvh", Math.round(vv.height) + "px");
    if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0);
  };
  vv?.addEventListener("resize", fit);
  vv?.addEventListener("scroll", fit);
  addEventListener("scroll", fit, { passive: true });
  fit();
  const unfit = () => { vv?.removeEventListener("resize", fit); vv?.removeEventListener("scroll", fit); removeEventListener("scroll", fit); document.documentElement.style.removeProperty("--vvh"); };

  // Pull the window to the right to go back to the Feed. (Inside an open chat on a phone, pull from the left edge to go back to the list.)
  let sw = null;
  messenger.addEventListener("touchstart", (e) => {
    const t = e.touches[0], edge = t.clientX < 28;
    const inChat = messenger.classList.contains("has-open") && matchMedia("(max-width: 760px)").matches;
    if (!edge && (inChat || e.target.closest(".msg, input, textarea, select, .notes-row, .convo-tray, .instants-pile, .lb-player, .mini-profile"))) return;
    sw = { x: t.clientX, y: t.clientY, dx: 0, go: false, inChat };
  }, { passive: true });
  messenger.addEventListener("touchmove", (e) => {
    if (!sw) return;
    const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    if (!sw.go) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // scrolling up or down
      if (dx < 14) return;
      sw.go = true;
    }
    sw.dx = Math.max(0, dx);
    messenger.style.transition = "none";
    messenger.style.transform = `translateX(${sw.dx}px)`;
    messenger.style.opacity = String(Math.max(0.35, 1 - sw.dx / (innerWidth * 1.4)));
  }, { passive: true });
  const swipeEnd = () => {
    if (!sw) return;
    const { dx, go, inChat } = sw; sw = null;
    if (!go) return;
    messenger.style.transition = "transform 0.22s ease, opacity 0.22s ease";
    if (dx > Math.min(120, innerWidth * 0.28)) {
      messenger.style.transform = "translateX(100%)"; messenger.style.opacity = "0";
      setTimeout(() => {
        if (inChat) { messenger.style.transform = ""; messenger.style.opacity = ""; (messenger.querySelector(".convo-back") || messenger.querySelector(".gv-top .icon-btn"))?.click(); }
        else navigate("/feed");
      }, 210);
    } else { messenger.style.transform = ""; messenger.style.opacity = ""; }
  };
  messenger.addEventListener("touchend", swipeEnd);
  messenger.addEventListener("touchcancel", swipeEnd);

  // Hold a chat (or right-click it) for its theme, wallpaper and photo
  function holdForWallpaper(c, item) {
    const open = (fn) => (v) => document.querySelectorAll(`.convo[data-wall-chat="${CSS.escape(c.id)}"]`).forEach((el) => fn(el, v));
    onHold(item, () => openChatOptions(c, { onTheme: open(applyTheme), onWallpaper: open(applyWallpaper), onPhoto: () => loadList() }));
    return item;
  }

  async function loadList() {
    try {
      const { chats } = await api("/api/chats");
      watchInboxTyping(listEl);
      listEl.replaceChildren();
      if (!chats.length) {
        listEl.append(empty("No conversations yet.", "Message someone who follows you back, or join a group."));
        return;
      }
      for (const c of chats) {
        listEl.append(holdForWallpaper(c, h("a", { class: "inbox-item" + (c.id === openId ? " active" : "") + (c.unread ? " unread" : ""), href: `/messages/${c.id}`, dataset: { chat: c.id } },
          chatPic(c, 48),
          h("div", { class: "inbox-text" },
            h("div", { class: "inbox-top" }, h("b", {}, chatTitle(c), c.kind === "dm" ? tick(c.other, 15) : null), h("span", { class: "muted", text: timeAgo(c.lastAt) })),
            h("p", { class: "muted inbox-last" },
              h("span", { class: "il-text", text: c.last ? (c.kind === "dm" && callNoteText(c.last.text, c.last.mine, c.other.name)?.title) || (c.last.mine ? "You: " : c.kind === "group" ? `${c.last.by}: ` : "") + c.last.text : c.kind === "group" ? "No messages yet" : "" }),
              c.streak ? h("span", { class: "streak-chip" + (c.streak.doneToday ? "" : " at-risk"), title: c.streak.doneToday ? `${c.streak.days}-day LookStreak` : "Write today to keep your LookStreak", text: `🔥 ${c.streak.days}` }) : null)
          ),
          c.unread ? h("span", { class: "badge-count", text: String(c.unread) }) : null
        )));
      }
    } catch (err) {
      listEl.replaceChildren(empty("Couldn’t load your messages.", err.error || ""));
    }
  }

  let convo = null, stopped = false;
  if (openId) {
    // Groups open Discord-style (channels on the left); direct chats open as a conversation
    pane.append(spinner());
    api(`/api/chats/${openId}`).then(({ chat }) => {
      if (stopped) return;
      if (chat.kind === "group") {
        messenger.classList.add("group-open");
        convo = groupView(openId, { onBack: () => navigate("/messages") });
      } else convo = conversation(openId, { onBack: () => navigate("/messages") });
      pane.replaceChildren(convo.el);
    }).catch((err) => pane.replaceChildren(empty("Couldn’t open this conversation.", err.error || "")));
  } else {
    pane.append(h("div", { class: "convo-empty" },
      icon("chat"),
      h("h2", { text: "Your messages" }),
      h("p", { class: "muted", text: "Talk privately with people who follow you back, or chat in public groups. You can send photos, videos and posts." }),
      h("button", { class: "btn btn-primary btn-sm", text: "New message", onclick: openNewMessage })
    ));
  }

  loadList();
  const offMsg = on("message", loadList);
  const offChanged = on("chats:changed", loadList);
  return () => { stopped = true; unfit(); convo?.stop(); offMsg(); offChanged(); };
}
messagesPage.navName = () => "messages";
messagesPage.layout = "full";

// "Desi is typing…" right in the chat list (live)
let inboxTypingOff = null;
function watchInboxTyping(listEl) {
  if (inboxTypingOff) return;
  const timers = new Map();
  inboxTypingOff = on("chat:typing", (ev) => {
    if (!listEl.isConnected) { inboxTypingOff(); inboxTypingOff = null; return; }
    const item = listEl.querySelector(`.inbox-item[data-chat="${CSS.escape(ev.chatId)}"]`);
    const last = item?.querySelector(".il-text");
    if (!last) return;
    if (!last.dataset.orig) last.dataset.orig = last.textContent;
    clearTimeout(timers.get(ev.chatId));
    const back = () => { last.textContent = last.dataset.orig; item.classList.remove("is-typing"); };
    if (ev.stop) return back();
    last.textContent = `${ev.name.split(" ")[0]} is typing…`;
    item.classList.add("is-typing");
    timers.set(ev.chatId, setTimeout(back, 3500));
  });
}

// ← back to the Feed (the top bar is hidden on Messages)
function backToFeed() {
  const b = h("button", { class: "icon-btn inbox-back", "aria-label": "Back to the Feed", title: "Back to the Feed" }, icon("back"));
  b.addEventListener("click", () => navigate("/feed"));
  return b;
}
