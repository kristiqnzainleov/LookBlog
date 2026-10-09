// Emoji picker: a small panel with categories and recently used emoji. No outside libraries.
import { h, visibleRect, phoneSheet } from "../ui.js";

const SETS = [
  ["Smileys", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖"],
  ["Gestures", "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 💪 🫶 👀 👁️ 👄 🫦 🧠"],
  ["Hearts", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ❤️‍🔥 💋 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤"],
  ["Animals", "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐴 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🦑 🐠 🐬 🐳 🦈 🌸 🌹 🌻 🌷 🌱 🌲 🌴 🍀 🍁 🍄 🌍 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ ⛅ ☁️ 🌧️ ❄️ ☃️ 🌊"],
  ["Food", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🌶️ 🌽 🥕 🥐 🍞 🧀 🥚 🍳 🥞 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🍝 🍜 🍣 🍱 🍦 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍿 ☕ 🍵 🧋 🥤 🍺 🍻 🥂 🍷 🍸"],
  ["Activities", "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🛹 ⛸️ 🎿 🏂 🏋️ 🚴 🏊 🧘 🏆 🥇 🎮 🎲 🧩 🎯 🎳 🎸 🎹 🥁 🎤 🎧 🎬 🎨 📷 📸 🎥 🎉 🎊 🎈 🎁 🎀"],
  ["Objects", "📱 💻 ⌚ 📺 💡 🔦 📚 📖 ✏️ 📝 📌 📎 ✂️ 🔒 🔑 🔨 🧲 💊 🛒 🚗 🚕 🚌 🚲 ✈️ 🚀 🛸 ⛵ 🏠 🏙️ 🌆 🗺️ ⏰ ⌛ 💰 💎 🎓 👑 💍 👓 🕶️ 👟 👗 🧢 🎒"],
  ["Symbols", "✅ ☑️ ❌ ❗ ❓ ‼️ ⁉️ 💲 ➕ ➖ ✖️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔺 🔻 💠 🔶 🔷 ♻️ ⚠️ 🚫 🔞 🆗 🆕 🆒 🔝 ▶️ ⏸️ ⏹️ 🔁 🔀 🎵 🎶 ➡️ ⬅️ ⬆️ ⬇️ 🇧🇬 🏳️‍🌈"],
].map(([name, list]) => [name, list.split(" ")]);

export const QUICK = ["❤️", "😂", "😮", "😢", "🔥", "👍"];

const RECENT_KEY = "lb_recent_emoji";
function recent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 24); } catch { return []; }
}
function remember(e) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 24))); } catch {}
}

let openPanel = null;
export function closeEmojiPicker() {
  openPanel?.remove();
  openPanel = null;
}

// Open the panel next to `anchor`; onPick(emoji) runs for each choice. keepOpen lets you pick several.
export function openEmojiPicker(anchor, onPick, { keepOpen = false } = {}) {
  // Tapping the same button again closes it
  if (openPanel && openPanel._anchor === anchor) { closeEmojiPicker(); return null; }
  closeEmojiPicker();
  const tabs = h("div", { class: "emoji-tabs" });
  const grid = h("div", { class: "emoji-grid", role: "listbox" });
  const panel = h("div", { class: "emoji-panel", role: "dialog", "aria-label": "Emoji" }, tabs, grid);

  const sets = [];
  const r = recent();
  if (r.length) sets.push(["Recent", r]);
  sets.push(...SETS);

  for (const [name, list] of sets) {
    const btn = h("button", { type: "button", class: "emoji-tab", title: name, text: list[0] });
    btn.addEventListener("click", () => grid.querySelector(`[data-set="${name}"]`)?.scrollIntoView({ block: "start" }));
    tabs.append(btn);
    grid.append(h("p", { class: "emoji-set", dataset: { set: name }, text: name }));
    for (const e of list) {
      const b = h("button", { type: "button", class: "emoji-btn", text: e, title: e });
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        remember(e);
        onPick(e);
        if (!keepOpen) closeEmojiPicker();
      });
      grid.append(b);
    }
  }

  document.body.append(panel);
  openPanel = panel;
  panel._anchor = anchor;
  // Place above the anchor when there's room, otherwise below
  const a = visibleRect(anchor);
  const w = Math.min(340, innerWidth - 16);
  panel.style.width = w + "px";
  const left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), innerWidth - w - 8);
  panel.style.left = left + "px";
  const ph = panel.offsetHeight;
  panel.style.top = (a.top - ph - 8 > 8 ? a.top - ph - 8 : Math.min(a.bottom + 8, innerHeight - ph - 8)) + "px";

  setTimeout(() => {
    const away = (e) => {
      if (!panel.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) {
        closeEmojiPicker();
        document.removeEventListener("mousedown", away);
      }
    };
    document.addEventListener("mousedown", away);
  });
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeEmojiPicker(); document.removeEventListener("keydown", onKey, true); } };
  document.addEventListener("keydown", onKey, true);
  return panel;
}

// Put an emoji where the cursor is in a text box
export function insertAtCursor(field, text) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.value = field.value.slice(0, start) + text + field.value.slice(end);
  const pos = start + text.length;
  // On a phone don't pop the keyboard open just for an emoji (it pushes the whole chat up)
  const touch = matchMedia("(hover: none), (max-width: 640px)").matches;
  if (!touch || document.activeElement === field) { field.focus(); field.setSelectionRange(pos, pos); }
  else try { field.setSelectionRange(pos, pos); } catch {}
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
