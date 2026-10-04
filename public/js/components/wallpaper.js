// Chat options (hold a chat in the list or its name at the top, or right-click it):
//   Theme — the colour of the bubbles, the same for everyone in the chat (like Messenger)
//   Wallpaper — your own background for the chat (only you see it)
//   Group photo — for groups, if you can change the group
import { h, modal, toast } from "../ui.js";
import { api, upload } from "../api.js";
import { on } from "../state.js";

export const WALLS = {
  "pink-night": ["Pink night", "radial-gradient(circle at 20% 15%, rgba(255,79,163,0.45), transparent 45%), radial-gradient(circle at 85% 80%, rgba(140,60,255,0.35), transparent 50%), #160f14"],
  sunset: ["Sunset", "linear-gradient(160deg, #3a1030 0%, #8a2c4f 45%, #ff8a5c 100%)"],
  ocean: ["Ocean", "linear-gradient(160deg, #06203a 0%, #0b4f6c 55%, #1fa2a8 100%)"],
  aurora: ["Aurora", "radial-gradient(ellipse at 30% 0%, rgba(80,255,180,0.35), transparent 55%), radial-gradient(ellipse at 80% 30%, rgba(255,79,163,0.35), transparent 50%), #0c1416"],
  hearts: ["Hearts", "radial-gradient(circle at 12px 12px, rgba(255,79,163,0.35) 3px, transparent 4px) 0 0 / 34px 34px, linear-gradient(160deg, #1e0e17, #2a1020)"],
  dots: ["Dots", "radial-gradient(rgba(255,255,255,0.13) 1.5px, transparent 1.6px) 0 0 / 22px 22px, #141313"],
  grid: ["Grid", "linear-gradient(rgba(255,79,163,0.14) 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, rgba(255,79,163,0.14) 1px, transparent 1px) 0 0 / 28px 28px, #121111"],
  mono: ["Black", "#050505"],
};

export const THEMES = {
  pink: ["Pink", "#ff4fa3", "#14090f"],
  berry: ["Berry", "linear-gradient(135deg, #a64dff, #ff4fa3)", "#fff"],
  ocean: ["Ocean", "linear-gradient(135deg, #1f8bff, #29d3e6)", "#fff"],
  mint: ["Mint", "linear-gradient(135deg, #20c997, #8ce99a)", "#062018"],
  sunset: ["Sunset", "linear-gradient(135deg, #ff7a3d, #ff4fa3)", "#fff"],
  fire: ["Fire", "linear-gradient(135deg, #ff3b30, #ff9f0a)", "#fff"],
  gold: ["Gold", "linear-gradient(135deg, #f7b733, #ffe08a)", "#2b1d00"],
  galaxy: ["Galaxy", "linear-gradient(135deg, #3a1c71, #5b5bd6, #d76d77)", "#fff"],
  mono: ["Mono", "#f4efe8", "#121111"],
};
// Paint the chat's theme (my bubbles, the send button)
export function applyTheme(convoEl, theme, chatId) {
  if (chatId) convoEl.dataset.wallChat = chatId;
  const t = THEMES[theme] || null;
  convoEl.classList.toggle("themed", Boolean(t));
  if (t) { convoEl.style.setProperty("--theme-bubble", t[1]); convoEl.style.setProperty("--theme-text", t[2]); }
  else { convoEl.style.removeProperty("--theme-bubble"); convoEl.style.removeProperty("--theme-text"); }
}
on("chat:theme", (ev) => {
  document.querySelectorAll(`.convo[data-wall-chat="${CSS.escape(ev.chatId)}"]`).forEach((el) => applyTheme(el, ev.theme));
});

// Put the wallpaper behind the messages of a conversation
export function applyWallpaper(convoEl, wp, chatId) {
  if (chatId) convoEl.dataset.wallChat = chatId;
  convoEl.classList.toggle("has-wall", Boolean(wp));
  convoEl.style.removeProperty("--chat-wall");
  if (wp?.image) convoEl.style.setProperty("--chat-wall", `url("${wp.image}") center / cover no-repeat`);
  else if (wp?.preset && WALLS[wp.preset]) convoEl.style.setProperty("--chat-wall", WALLS[wp.preset][1]);
}
// Another tab (or the picker) changed it
on("chat:wallpaper", (ev) => {
  document.querySelectorAll(`.convo[data-wall-chat="${CSS.escape(ev.chatId)}"]`).forEach((el) => applyWallpaper(el, ev.wallpaper));
});

// Hold (phones) or right-click (computers) on something
export function onHold(el, fn) {
  let timer = 0, held = false, start = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    held = false; start = [e.clientX, e.clientY];
    timer = setTimeout(() => { held = true; navigator.vibrate?.(15); fn(); }, 550);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("pointermove", (e) => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) cancel(); });
  // A hold shouldn't also open the chat
  el.addEventListener("click", (e) => { if (held) { e.preventDefault(); e.stopPropagation(); held = false; } }, true);
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); cancel(); fn(); });
}

export function openWallpaperPicker(chat, onDone) {
  const name = chat.kind === "dm" ? chat.other?.name : chat.name;
  let busy = false;
  const save = async (body, msg) => {
    if (busy) return;
    busy = true;
    try {
      const { wallpaper } = await api(`/api/chats/${chat.id}/wallpaper`, { method: "POST", body });
      chat.wallpaper = wallpaper;
      onDone?.(wallpaper);
      m.close();
      toast(msg);
    } catch (err) { toast(err.error || "Couldn’t change it."); }
    busy = false;
  };
  const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true });
  const photo = h("button", { type: "button", class: "wall-opt wall-photo" }, h("span", { text: "📷" }), h("b", { text: "Your photo" }));
  photo.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files[0]; file.value = "";
    if (!f) return;
    photo.querySelector("b").textContent = "Uploading…";
    try { const up = await upload(f); await save({ image: up.url }, "Wallpaper set."); }
    catch (err) { toast(err.error || "Couldn’t upload it."); photo.querySelector("b").textContent = "Your photo"; }
  });
  const current = chat.wallpaper;
  const m = modal({ title: `Wallpaper${name ? " · " + name : ""}`, body: h("div", { class: "create-form wall-picker" },
    h("p", { class: "create-hint", text: "Only you see it. Each chat can have its own." }),
    h("div", { class: "wall-grid" },
      photo, file,
      ...Object.entries(WALLS).map(([id, [label, css]]) => {
        const b = h("button", { type: "button", class: "wall-opt" + (current?.preset === id ? " on" : ""), style: `--wall:${css}` }, h("b", { text: label }));
        b.addEventListener("click", () => save({ preset: id }, `Wallpaper: ${label}.`));
        return b;
      })),
    current ? h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "Remove wallpaper", onclick: () => save({ clear: true }, "Wallpaper removed.") }) : null) });
}

// The theme for everyone in the chat
export function openThemePicker(chat, onDone) {
  const current = chat.theme || "pink";
  const m = modal({ title: "Chat theme", body: h("div", { class: "create-form wall-picker" },
    h("p", { class: "create-hint", text: "Everyone in this chat sees it." }),
    h("div", { class: "theme-grid" }, ...Object.entries(THEMES).map(([id, [label, bg, fg]]) => {
      const b = h("button", { type: "button", class: "theme-opt" + (current === id ? " on" : "") },
        h("span", { class: "theme-bubbles" }, h("i", { class: "tb-other" }), h("i", { class: "tb-mine", style: `background:${bg};color:${fg}`, text: "Hi!" })),
        h("b", { text: label }));
      b.addEventListener("click", async () => {
        try {
          const r = await api(`/api/chats/${chat.id}/theme`, { method: "POST", body: { theme: id } });
          chat.theme = r.theme;
          onDone?.(r.theme);
          m.close();
          toast(`Theme: ${label}.`);
        } catch (err) { toast(err.error || "Couldn’t change it."); }
      });
      return b;
    }))) });
}

// A new photo for a group
function pickGroupPhoto(chat, onDone) {
  const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true });
  document.body.append(file);
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.remove();
    if (!f) return;
    toast("Uploading…");
    try {
      const up = await upload(f);
      const r = await api(`/api/chats/${chat.id}/photo`, { method: "POST", body: { image: up.url } });
      chat.cover = r.cover;
      onDone?.(r.cover);
      toast("Group photo changed.");
    } catch (err) { toast(err.error || "Couldn’t change it."); }
  });
  file.click();
}

// What holding a chat opens
export function openChatOptions(chat, { onTheme, onWallpaper, onPhoto } = {}) {
  const name = chat.kind === "dm" ? chat.other?.name : chat.name;
  const canGroup = chat.kind === "group" && (chat.isOwner || chat.perms?.includes("manage_group"));
  const canTheme = chat.kind === "dm" || canGroup;
  const item = (emoji, title, sub, fn) => h("button", { type: "button", class: "co-item", onclick: () => { m.close(); fn(); } },
    h("span", { class: "co-ic", text: emoji }), h("span", { class: "co-text" }, h("b", { text: title }), h("small", { class: "muted", text: sub })));
  const m = modal({ title: name || "Chat", body: h("div", { class: "co-list" },
    canTheme ? item("🎨", "Theme", "Bubble colours, for everyone in the chat", () => openThemePicker(chat, onTheme)) : null,
    item("🖼️", "Wallpaper", "Your own background (only you see it)", () => openWallpaperPicker(chat, onWallpaper)),
    canGroup ? item("📷", "Group photo", "Change the group’s picture", () => pickGroupPhoto(chat, onPhoto)) : null) });
}
