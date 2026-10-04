// Chat wallpapers: everyone picks their own background for a chat (only they see it).
// Hold a chat in the list (or its name at the top of the chat), or right-click it, to change it.
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
