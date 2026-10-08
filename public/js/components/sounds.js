// Sounds you can send: your own ("Mine", kept on your profile), the group's own soundboard sounds
// ("This group", only inside that group), and LookBlog's built-in ones. They're kept apart on purpose.
import { h, toast, spinner, modal, visibleRect } from "../ui.js";
import { api, upload } from "../api.js";
import { BUILTIN_SOUNDS, previewSound } from "./voice-room.js";

let panel = null;
let away = null;
export function closeSoundPicker() { panel?.remove(); panel = null; if (away) document.removeEventListener("mousedown", away); away = null; }
// Play a sound that came in a message, comment or stream
export const playSound = (m) => previewSound(m.builtin ? { builtin: m.builtin } : { url: m.url });
export const soundLabel = (m) => (m.builtin ? BUILTIN_SOUNDS.find((x) => x.builtin === m.builtin)?.name || m.builtin : m.name || "Sound");
export const soundEmoji = (m) => (m.builtin ? BUILTIN_SOUNDS.find((x) => x.builtin === m.builtin)?.emoji || "🔊" : m.emoji || "🔊");

// Add one of your own sounds (an audio file up to 2 MB)
export function addMySound(onDone) {
  const file = h("input", { type: "file", accept: "audio/*", hidden: true });
  const name = h("input", { type: "text", class: "text-input", maxlength: 24, placeholder: "Name (e.g. My laugh)" });
  const emoji = h("input", { type: "text", class: "text-input", maxlength: 4, placeholder: "Emoji", value: "🔊", style: "width:80px" });
  const pick = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Choose an audio file" });
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save sound", disabled: true });
  let url = null;
  pick.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast("Keep sounds short (under 2 MB).");
    pick.disabled = true; pick.textContent = "Uploading…";
    try { url = (await upload(f)).url; pick.textContent = "✓ " + f.name.slice(0, 30); if (!name.value) name.value = f.name.replace(/\.[^.]+$/, "").slice(0, 24); save.disabled = false; new Audio(url).play().catch(() => {}); }
    catch (err) { toast(err.error || "Couldn’t upload it."); pick.textContent = "Choose an audio file"; }
    pick.disabled = false;
  });
  save.addEventListener("click", async () => {
    save.disabled = true;
    try { const { sounds } = await api("/api/me/sounds", { method: "POST", body: { url, name: name.value, emoji: emoji.value } }); m.close(); toast("Sound saved to your sounds."); onDone?.(sounds); }
    catch (err) { toast(err.error || "Couldn’t save it."); save.disabled = false; }
  });
  const m = modal({ title: "Add your own sound", body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: "Your sounds are yours: send them in messages, replies and live streams. (Group soundboards have their own sounds.)" }),
    pick, file, h("div", { class: "invite-row" }, emoji, name), save) });
}

// The picker: tabs Mine / This group / Built-in. onPick(body) gets what to send: { mySound } | { groupSound } | { builtinSound }
export function openSoundPicker(anchor, { group = null, builtin = true, onPick } = {}) {
  if (panel) return closeSoundPicker();
  let tab = "mine";
  const list = h("div", { class: "snd-list" });
  const tabs = h("div", { class: "snd-tabs" });
  panel = h("div", { class: "sticker-panel snd-panel", role: "dialog", "aria-label": "Sounds", style: "visibility:hidden" }, tabs, list);
  document.body.append(panel);
  // Next to the button, before it's shown (it used to flash in the corner first). Above the button it hangs from
  // its bottom edge, so it grows upwards when the list loads instead of sliding down over the button.
  const place = () => {
    if (!panel) return;
    const a = visibleRect(anchor), w = Math.min(320, innerWidth - 16);
    panel.style.width = w + "px";
    panel.style.left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), innerWidth - w - 8) + "px";
    const above = a.top - 16, below = innerHeight - a.bottom - 16;
    if (above >= 200 || above >= below) {
      panel.style.top = "auto"; panel.style.bottom = innerHeight - a.top + 8 + "px"; panel.style.maxHeight = Math.min(380, above) + "px";
    } else {
      panel.style.bottom = "auto"; panel.style.top = a.bottom + 8 + "px"; panel.style.maxHeight = Math.min(380, below) + "px";
    }
    panel.style.visibility = "";
  };
  const row = (s, body, extra) => {
    const play = h("button", { type: "button", class: "snd-play", title: "Listen", text: "▶" });
    play.addEventListener("click", (e) => { e.stopPropagation(); previewSound(s.builtin ? { builtin: s.builtin } : { url: s.url }); });
    const b = h("div", { class: "snd-row" }, h("span", { class: "snd-emoji", text: s.emoji || "🔊" }), h("b", { text: s.name }), play,
      h("button", { type: "button", class: "btn btn-xs btn-primary", text: "Send", onclick: () => { closeSoundPicker(); onPick(body); } }), extra || null);
    return b;
  };
  async function paint() {
    const T = [["mine", "Mine"], ...(group ? [["group", "This group"]] : []), ...(builtin ? [["builtin", "Built-in"]] : [])];
    tabs.replaceChildren(...T.map(([k, l]) => h("button", { type: "button", class: "snd-tab" + (k === tab ? " on" : ""), text: l, onclick: () => { tab = k; paint(); } })));
    if (tab === "builtin") list.replaceChildren(...BUILTIN_SOUNDS.map((s) => row(s, { builtinSound: s.builtin })));
    else if (tab === "group") {
      const gs = group.sounds || [];
      list.replaceChildren(...(gs.length ? gs.map((s) => row(s, { groupSound: s.id })) : [h("p", { class: "muted snd-empty", text: "This group has no sounds yet. Admins add them in the voice channel soundboard." })]));
    } else {
      list.replaceChildren(spinner());
      place();
      try {
        const { sounds } = await api("/api/me/sounds");
        const add = h("button", { type: "button", class: "snd-add", text: "＋ Add your own sound", onclick: () => { closeSoundPicker(); addMySound(() => openSoundPicker(anchor, { group, builtin, onPick })); } });
        list.replaceChildren(add, ...sounds.map((s) => row(s, { mySound: s.id }, h("button", { type: "button", class: "snd-del", title: "Remove from your sounds", text: "✕", onclick: async (e) => {
          e.stopPropagation();
          try { await api(`/api/me/sounds/${s.id}`, { method: "DELETE" }); paint(); } catch (err) { toast(err.error || "Couldn’t remove it."); }
        } }))));
        if (!sounds.length) list.append(h("p", { class: "muted snd-empty", text: "No sounds yet. Add one: a laugh, a catchphrase, anything short." }));
      } catch { list.replaceChildren(h("p", { class: "muted", text: "Couldn’t load your sounds." })); }
    }
    place();
  }
  paint();
  const mine = panel;
  setTimeout(() => {
    if (panel !== mine) return;
    away = (e) => { if (panel && !panel.contains(e.target) && !anchor.contains(e.target) && !e.target.closest?.(".app-modal")) closeSoundPicker(); };
    document.addEventListener("mousedown", away);
  });
}

// A sound in a message or reply: emoji + name + play
export function soundChip(m) {
  return h("button", { type: "button", class: "snd-chip", title: "Play", onclick: (e) => { e.preventDefault(); e.stopPropagation(); playSound(m); } },
    h("span", { class: "snd-emoji", text: soundEmoji(m) }), h("b", { text: soundLabel(m) }), h("span", { class: "snd-chip-play", text: "▶" }));
}
