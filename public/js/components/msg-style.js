// How my messages look (a colour or gradient, a font, a shape, a glow — saved on my account, everyone sees it)
// and effects a message can be sent with (like iMessage): slam, loud, gentle, invisible ink, confetti, hearts…
import { h, modal, toast } from "../ui.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { NAME_COLORS, NAME_FONTS, GAMER_FONTS, loadFonts } from "./profile-look.js";

const COLORS = [["", "Default", ""], ["black", "Black", "#0d0c0c"], ...NAME_COLORS.map(([k, v]) => [k, k[0].toUpperCase() + k.slice(1), v])];
const LIGHT = new Set(["gold", "lime", "mint", "teal", "sky", "lilac", "white", "candy", "peach", "ice", "pastel", "beach", "steel", "coffee", "neon", "aurora"]);
const SHAPES = [["", "Normal"], ["round", "Round"], ["square", "Square"], ["pill", "Pill"], ["speech", "Speech"], ["leaf", "Leaf"]];
const GLOWS = [["", "None"], ["glow", "✨ Glow"], ["outline", "Outline"], ["shadow", "3D"]];
export const EFFECTS = [["slam", "💥", "Slam"], ["loud", "📢", "Loud"], ["gentle", "🌙", "Gentle"], ["ink", "🫥", "Invisible ink"], ["confetti", "🎉", "Confetti"], ["hearts", "💕", "Hearts"],
  ["fireworks", "🎆", "Fireworks"], ["balloons", "🎈", "Balloons"], ["spotlight", "🔦", "Spotlight"], ["lasers", "🌈", "Lasers"], ["shake", "🫨", "Shake"], ["rainbow", "🦄", "Rainbow"]];
const colorOf = (k) => (k === "black" ? "#0d0c0c" : /^#/.test(k || "") ? k : NAME_COLORS.find(([x]) => x === k)?.[1] || "");

// Paint a message bubble in its sender's style
export function styleBubble(bubble, style) {
  if (!style || !bubble) return;
  const bg = colorOf(style.bg);
  if (bg) {
    bubble.classList.add("ms-bg");
    bubble.style.setProperty("--ms-bg", bg);
    bubble.style.setProperty("--ms-fg", LIGHT.has(style.bg) ? "#111" : "#fff");
  }
  if (style.shape) bubble.dataset.ms = style.shape;
  if (style.glow) bubble.dataset.mg = style.glow;
  if (style.font) {
    const t = bubble.querySelector(".bubble-text");
    if (t) { t.classList.add("nl"); t.dataset.nf = style.font; loadFonts(); }
  }
}

// The style editor + "send with an effect" (onEffect(effect) arms the next message)
export function openMsgStyle({ onEffect = null, armed = null } = {}) {
  let cur = { ...(state.me.msgStyle || {}) };
  let tab = onEffect ? "effects" : "style";
  const preview = h("div", { class: "ms-preview" });
  const body = h("div", { class: "ms-body" });
  const tabs = h("div", { class: "ms-tabs" });
  const paintPreview = () => {
    const mk = (mine, text) => { const b = h("div", { class: "bubble ms-demo" + (mine ? " mine" : "") }, h("p", { class: "bubble-text", text })); if (mine) styleBubble(b, cur); return h("div", { class: "ms-row" + (mine ? " mine" : "") }, b); };
    preview.replaceChildren(mk(false, "Hey! How do my messages look? 👀"), mk(true, "Like this ✨ everyone sees them this way"));
  };
  const chips = (list, key, render) => h("div", { class: "ms-chips" }, ...list.map((item) => {
    const k = item[0];
    const b = render(item);
    b.classList.toggle("on", (cur[key] || "") === k);
    b.addEventListener("click", () => { if (k) cur[key] = k; else delete cur[key]; paint(); });
    return b;
  }));
  function paint() {
    tabs.replaceChildren(...[["style", "🎨 My style"], ["effects", "✨ Send with effect"]].map(([k, l]) => { const b = h("button", { type: "button", class: "ms-tab" + (tab === k ? " on" : ""), text: l }); b.addEventListener("click", () => { tab = k; paint(); }); return b; }));
    if (tab === "style") {
      paintPreview();
      const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save my style" });
      save.addEventListener("click", async () => {
        save.disabled = true;
        try { const r = await api("/api/me/msg-style", { method: "POST", body: cur }); state.me.msgStyle = r.msgStyle; toast("✨ Saved — your messages look like this now, for everyone."); md.close(); }
        catch (err) { toast(err.error || "Couldn’t save it."); save.disabled = false; }
      });
      body.replaceChildren(preview,
        h("b", { class: "look-label", text: "Bubble colour" }), chips(COLORS, "bg", ([k, l, v]) => h("button", { type: "button", class: "ms-sw" + (k ? "" : " none"), title: l, "aria-label": l, style: v ? `background:${v}` : "" }, k ? null : h("span", { text: "⊘" }))),
        h("b", { class: "look-label", text: "Font" }), chips([["", "Default"], ...NAME_FONTS.filter(([k]) => k), ...GAMER_FONTS], "font", ([k, l]) => h("button", { type: "button", class: "ms-chip nl", dataset: k ? { nf: k } : {}, text: l })),
        h("b", { class: "look-label", text: "Shape" }), chips(SHAPES, "shape", ([k, l]) => h("button", { type: "button", class: "ms-chip", text: l })),
        h("b", { class: "look-label", text: "Effect on the bubble" }), chips(GLOWS, "glow", ([k, l]) => h("button", { type: "button", class: "ms-chip", text: l })),
        save);
      loadFonts();
    } else {
      body.replaceChildren(h("p", { class: "create-hint", text: "Pick an effect, then send your message — everyone in the chat sees it play when it arrives." }),
        h("div", { class: "ms-effects" }, ...EFFECTS.map(([k, e, l]) => {
          const b = h("button", { type: "button", class: "ms-effect" + (armed === k ? " on" : "") }, h("span", { class: "ms-effect-e", text: e }), h("b", { text: l }));
          b.addEventListener("click", () => { if (!onEffect) return toast("Open a chat to send with an effect."); onEffect(armed === k ? null : k); md.close(); });
          return b;
        })),
        armed ? h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "No effect", onclick: () => { onEffect(null); md.close(); } }) : null);
    }
  }
  const md = modal({ title: "Your messages", wide: true, body: h("div", { class: "ms" }, tabs, body) });
  paint();
}

/* ---------- Playing an effect on a message that just arrived ---------- */
const played = new Set();
export function playEffect(effect, row, stage) {
  if (!effect || !row || played.has(row.dataset.id) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  played.add(row.dataset.id);
  const bubble = row.querySelector(".bubble");
  const anim = (el, cls, ms) => { el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
  const layer = (cls) => { const l = h("div", { class: "fx-layer " + cls, "aria-hidden": "true" }); (stage || document.body).append(l); return l; };
  const r = bubble.getBoundingClientRect(), st = (stage || document.body).getBoundingClientRect();
  const cx = r.left + r.width / 2 - st.left, cy = r.top + r.height / 2 - st.top;
  if (effect === "slam") { anim(bubble, "fx-slam", 700); if (stage) setTimeout(() => anim(stage, "fx-quake", 420), 260); }
  if (effect === "loud") anim(bubble, "fx-loud", 1100);
  if (effect === "gentle") anim(bubble, "fx-gentle", 2200);
  if (effect === "shake") anim(bubble, "fx-shake", 900);
  if (effect === "rainbow") anim(bubble, "fx-rainbow", 3000);
  if (effect === "confetti" || effect === "hearts" || effect === "balloons") {
    const l = layer("fx-fall");
    const COL = ["#ff4fa3", "#ffd23f", "#2ee6a6", "#1f8bff", "#9b5cff", "#ff8a3d"];
    const n = effect === "confetti" ? 70 : effect === "hearts" ? 26 : 16;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 100, d = Math.random() * 0.9, dur = 1.8 + Math.random() * 1.6;
      const p = effect === "confetti" ? h("i", { class: "fx-cf", style: `left:${x}%;--c:${COL[i % 6]};--d:${d}s;--t:${dur}s;--r:${Math.random() * 720 - 360}deg` })
        : effect === "hearts" ? h("i", { class: "fx-heart", text: ["💗", "💖", "❤️", "💕"][i % 4], style: `left:${x}%;--d:${d}s;--t:${dur + 0.6}s;--s:${0.8 + Math.random() * 1.2}` })
        : h("i", { class: "fx-balloon", style: `left:${x}%;--c:${COL[i % 6]};--d:${d}s;--t:${dur + 1.4}s` });
      l.append(p);
    }
    setTimeout(() => l.remove(), 4800);
  }
  if (effect === "fireworks") {
    const l = layer("fx-fw");
    for (let b = 0; b < 5; b++) {
      const x = 15 + Math.random() * 70, y = 15 + Math.random() * 45, col = ["#ff4fa3", "#ffd23f", "#2ee6a6", "#4cc9ff", "#9b5cff"][b];
      for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; l.append(h("i", { class: "fx-spark", style: `left:${x}%;top:${y}%;--c:${col};--dx:${Math.cos(a) * 120}px;--dy:${Math.sin(a) * 120}px;--d:${b * 0.35}s` })); }
    }
    setTimeout(() => l.remove(), 3600);
  }
  if (effect === "spotlight") {
    const l = layer("fx-spot");
    l.style.setProperty("--x", cx + "px"); l.style.setProperty("--y", cy + "px"); l.style.setProperty("--rad", Math.max(r.width, r.height) * 0.75 + 30 + "px");
    setTimeout(() => l.classList.add("out"), 2200); setTimeout(() => l.remove(), 2800);
  }
  if (effect === "lasers") {
    const l = layer("fx-lasers");
    for (let i = 0; i < 6; i++) l.append(h("i", { style: `--a:${-60 + i * 24}deg;--c:${["#ff4fa3", "#ffd23f", "#2ee6a6", "#4cc9ff", "#9b5cff", "#ff8a3d"][i]};--d:${i * 0.08}s` }));
    setTimeout(() => l.remove(), 2600);
  }
}
// Invisible ink stays on: the words are hidden until you tap them
export function inkBubble(bubble) {
  bubble.classList.add("fx-ink");
  bubble.addEventListener("click", (e) => {
    if (!bubble.classList.contains("fx-ink")) return;
    e.stopPropagation();
    bubble.classList.remove("fx-ink");
    setTimeout(() => bubble.classList.add("fx-ink"), 6000);
  });
}
