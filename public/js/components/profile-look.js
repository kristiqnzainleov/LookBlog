// Your look: the colour, font and effect of your name (shown everywhere your name is), and your profile's accent colour.
import { h, modal, toast, tick } from "../ui.js";
import { api } from "../api.js";
import { state, emit } from "../state.js";

export const NAME_COLORS = [
  ["pink", "#ff4fa3"], ["red", "#ff4757"], ["orange", "#ff8a3d"], ["gold", "#ffd23f"], ["lime", "#b6f23a"], ["mint", "#2ee6a6"],
  ["teal", "#19d3c5"], ["sky", "#4cc9ff"], ["blue", "#3d7bff"], ["purple", "#9b5cff"], ["lilac", "#d6a4ff"], ["white", "#ffffff"],
  ["sunset", "linear-gradient(90deg,#ff7a3d,#ff4f8b,#b44cff)"], ["ocean", "linear-gradient(90deg,#1f8bff,#29d3e6)"],
  ["aurora", "linear-gradient(90deg,#2ee6a6,#4cc9ff,#9b5cff)"], ["candy", "linear-gradient(90deg,#ff4fa3,#ffd1ec,#7ad7ff)"],
  ["fire", "linear-gradient(90deg,#ffd23f,#ff8a3d,#ff2e2e)"], ["galaxy", "linear-gradient(90deg,#7597de,#b44cff,#ff4fa3)"],
  ["rainbow", "linear-gradient(90deg,#ff4757,#ff8a3d,#ffd23f,#2ee6a6,#4cc9ff,#9b5cff)"], ["peach", "linear-gradient(90deg,#ffb199,#ff7eb3)"],
  ["neon", "linear-gradient(90deg,#39ff14,#00f0ff)"], ["ice", "linear-gradient(90deg,#e0f7ff,#8fd3ff,#ffffff)"],
];
export const NAME_FONTS = [["", "Default"], ["display", "Bold"], ["serif", "Elegant"], ["mono", "Mono"], ["script", "Script"], ["rounded", "Rounded"], ["wide", "Wide"]];
export const NAME_EFFECTS = [["", "None"], ["glow", "Glow"], ["shine", "Shine"], ["shadow", "3D"]];
const ACCENTS = ["#ff4fa3", "#ff4757", "#ff8a3d", "#ffd23f", "#2ee6a6", "#19d3c5", "#4cc9ff", "#3d7bff", "#9b5cff", "#d6a4ff"];

// Extra fonts load only when someone's name uses them
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  document.head.append(h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,700&family=Space+Mono:wght@700&family=Pacifico&family=Fredoka:wght@600&display=swap" }));
}
const colorValue = (c) => (c?.startsWith("#") ? c : NAME_COLORS.find(([k]) => k === c)?.[1] || null);

// Put a look on the element that holds a name
export function applyLook(el, look) {
  if (!el) return;
  const c = colorValue(look?.color);
  el.classList.toggle("nl", Boolean(look && (c || look.font || look.effect)));
  if (c) {
    el.style.setProperty("--ng", c.startsWith("linear") ? c : `linear-gradient(${c},${c})`);
    el.style.setProperty("--nc", c.startsWith("linear") ? c.match(/#[0-9a-f]{6}/i)?.[0] || "#ff4fa3" : c);
  } else { el.style.removeProperty("--ng"); el.style.removeProperty("--nc"); }
  if (look?.font) { el.dataset.nf = look.font; loadFonts(); } else delete el.dataset.nf;
  if (look?.effect) el.dataset.ne = look.effect; else delete el.dataset.ne;
  el.dataset.ncol = c ? "1" : "";
}

// Names next to a tick (or the empty hook) get their owner's look, everywhere on the site
export function lookHook(user, mark) {
  queueMicrotask(() => {
    const p = mark.parentElement;
    if (!p || p.classList.contains("nl-skip")) return;
    // Only a small element that holds just the name (not a whole row of text)
    const text = p.textContent.trim();
    if (!text || text.length > 64 || /[@·]/.test(text) || p.children.length > 3) return;
    applyLook(p, user.look);
  });
}

// The editor: pick a colour, font and effect for your name, and an accent colour for your profile
export function openLookEditor(onSaved) {
  const cur = { color: "", font: "", effect: "", accent: "", ...(state.me.look || {}) };
  const preview = h("span", { class: "look-preview-name", text: state.me.name });
  const previewWrap = h("div", { class: "look-preview" }, h("b", { class: "look-preview-b" }, preview, tick(state.me, 24)), h("small", { class: "muted", text: "@" + state.me.username }));
  const paint = () => {
    applyLook(previewWrap.querySelector(".look-preview-b"), cur);
    previewWrap.style.setProperty("--accent", cur.accent || "#ff4fa3");
    for (const b of colors.querySelectorAll(".look-sw")) b.classList.toggle("on", (b.dataset.v || "") === (cur.color || ""));
    custom.value = cur.color?.startsWith("#") ? cur.color : "#ff4fa3";
    customWrap.classList.toggle("on", Boolean(cur.color?.startsWith("#")));
    for (const b of fonts.children) b.classList.toggle("on", b.dataset.v === (cur.font || ""));
    for (const b of effects.children) b.classList.toggle("on", b.dataset.v === (cur.effect || ""));
    for (const b of accents.querySelectorAll(".look-acc")) b.classList.toggle("on", (b.dataset.v || "") === (cur.accent || ""));
  };
  const sw = (v, bg, label) => {
    const b = h("button", { type: "button", class: "look-sw", title: label, "aria-label": label, dataset: { v }, style: v ? `background:${bg}` : "" }, v ? null : h("span", { text: "∅" }));
    b.addEventListener("click", () => { cur.color = v; paint(); });
    return b;
  };
  const custom = h("input", { type: "color", class: "look-custom", "aria-label": "Any colour" });
  custom.addEventListener("input", () => { cur.color = custom.value; paint(); });
  const customWrap = h("label", { class: "look-sw look-custom-wrap", title: "Any colour" }, h("span", { text: "＋" }), custom);
  const colors = h("div", { class: "look-grid" }, sw("", "", "Default"), ...NAME_COLORS.map(([k, v]) => sw(k, v, k[0].toUpperCase() + k.slice(1))), customWrap);
  const chip = (list, key) => h("div", { class: "look-chips" }, ...list.map(([v, label]) => {
    const b = h("button", { type: "button", class: "look-chip", dataset: { v, nf: key === "font" ? v : null }, text: label });
    if (key === "font" && v) loadFonts();
    b.addEventListener("click", () => { cur[key] = v; paint(); });
    return b;
  }));
  const fonts = chip(NAME_FONTS, "font");
  const effects = chip(NAME_EFFECTS, "effect");
  const accentCustom = h("input", { type: "color", class: "look-custom", "aria-label": "Any accent colour" });
  accentCustom.addEventListener("input", () => { cur.accent = accentCustom.value; paint(); });
  const accents = h("div", { class: "look-grid" },
    (() => { const b = h("button", { type: "button", class: "look-acc", dataset: { v: "" }, title: "Default" }, h("span", { text: "∅" })); b.addEventListener("click", () => { cur.accent = ""; paint(); }); return b; })(),
    ...ACCENTS.map((c) => { const b = h("button", { type: "button", class: "look-acc", dataset: { v: c }, style: `background:${c}`, title: c }); b.addEventListener("click", () => { cur.accent = c; paint(); }); return b; }),
    h("label", { class: "look-acc look-custom-wrap", title: "Any colour" }, h("span", { text: "＋" }), accentCustom));
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save my look" });
  const reset = h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "Back to default" });
  const m = modal({ title: "Customize your profile", body: h("div", { class: "create-form look-editor" },
    previewWrap,
    h("p", { class: "look-label", text: "Name colour" }), colors,
    h("p", { class: "look-label", text: "Name font" }), fonts,
    h("p", { class: "look-label", text: "Name effect" }), effects,
    h("p", { class: "look-label", text: "Profile accent colour" }), h("p", { class: "create-hint", text: "Buttons, tabs and highlights on your profile." }), accents,
    save, reset) });
  const store = async (look) => {
    save.disabled = reset.disabled = true;
    try {
      const r = await api("/api/me/look", { method: "POST", body: look });
      state.me.look = r.look;
      emit("me:updated", state.me);
      m.close();
      toast("Your look is saved. Your name looks like this everywhere.");
      onSaved?.(r.look);
    } catch (err) { toast(err.error || "Couldn’t save it."); save.disabled = reset.disabled = false; }
  };
  save.addEventListener("click", () => store({ color: cur.color || null, font: cur.font || null, effect: cur.effect || null, accent: cur.accent || null }));
  reset.addEventListener("click", () => store({}));
  paint();
}
