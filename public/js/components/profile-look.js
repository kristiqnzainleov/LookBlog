// Your look: the colour, font and effect of your name (shown everywhere your name is), and your profile's accent colour.
import { h, modal, toast, tick, avatar } from "../ui.js";
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
export const NAME_FONTS = [["", "Default"], ["display", "Bold"], ["serif", "Elegant"], ["mono", "Mono"], ["script", "Script"], ["rounded", "Rounded"], ["wide", "Wide"],
  ["tall", "Tall"], ["retro", "Retro"], ["marker", "Marker"], ["pixel", "Pixel"], ["scifi", "Sci-fi"], ["hand", "Handwritten"], ["groovy", "Groovy"],
  ["blocky", "Blocky"], ["comic", "Comic"], ["classic", "Classic"], ["neon", "Neon"], ["fancy", "Fancy"], ["spooky", "Spooky"], ["techno", "Techno"]];
// 🎮 Gamer fonts (lookalikes of game lettering)
export const GAMER_FONTS = [["minecraft", "Minecraft"], ["fortnite", "Fortnite"], ["valorant", "Valorant"], ["cod", "Call of Duty"], ["arcade", "Arcade"], ["glitch", "Glitch"], ["esports", "Esports"], ["terminal", "Terminal"]];
export const NAME_EFFECTS = [["", "None"], ["glow", "Glow"], ["shine", "Shine"], ["shadow", "3D"]];
export const RINGS = [["", "None"], ["accent", "Accent"], ["sunset", "Sunset"], ["ocean", "Ocean"], ["gold", "Gold"], ["rainbow", "Rainbow"], ["spin", "✨ Spinning"], ["neon", "Neon"], ["white", "White"]];
export const PROFILE_BGS = [["", "None"], ["glow", "Glow"], ["gradient", "Gradient"], ["aurora", "Aurora"], ["stars", "Stars"], ["grid", "Grid"], ["dots", "Dots"], ["waves", "Waves"]];
export const BANNERS = [["", "Default"], ["sunset", "Sunset"], ["ocean", "Ocean"], ["aurora", "Aurora"], ["candy", "Candy"], ["fire", "Fire"], ["galaxy", "Galaxy"], ["night", "Night"], ["mint", "Mint"], ["mono", "Mono"]];
const NAME_EMOJIS = ["✨", "💖", "🔥", "👑", "🦋", "🌸", "⭐", "🌙", "💎", "🎀", "🍓", "🐾", "🎧", "⚡", "🌈", "💫"];
const ACCENTS = ["#ff4fa3", "#ff4757", "#ff8a3d", "#ffd23f", "#2ee6a6", "#19d3c5", "#4cc9ff", "#3d7bff", "#9b5cff", "#d6a4ff"];

// Extra fonts load only when someone's name uses them
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  document.head.append(h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,700&family=Space+Mono:wght@700&family=Pacifico&family=Fredoka:wght@600&display=swap" }),
    h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Lobster&family=Permanent+Marker&family=Press+Start+2P&family=Orbitron:wght@800&family=Caveat:wght@700&family=Righteous&family=Bungee&family=Bangers&family=Cinzel:wght@700&family=Monoton&family=Great+Vibes&family=Creepster&family=Audiowide&display=swap" }),
    h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@700&family=Luckiest+Guy&family=Teko:wght@600&family=Black+Ops+One&family=Silkscreen:wght@700&family=Rubik+Glitch&family=Russo+One&family=VT323&display=swap" }));
}
// A custom gradient is saved as "grad:#aaaaaa,#bbbbbb@90" (colours, then the direction in degrees)
const parseGrad = (c) => { const [cols, deg] = c.slice(5).split("@"); return { cols: cols.split(","), deg: Number(deg) || 90 }; };
const gradCss = (g) => `linear-gradient(${g.deg}deg,${g.cols.join(",")})`;
const colorValue = (c) => (c?.startsWith("#") ? c : c?.startsWith("grad:") ? gradCss(parseGrad(c)) : NAME_COLORS.find(([k]) => k === c)?.[1] || null);

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
  // An emoji next to the name
  el.querySelector(":scope > .nl-emoji")?.remove();
  if (look?.emoji) {
    const e = h("span", { class: "nl-emoji", "aria-hidden": "true", text: look.emoji });
    const mark = el.querySelector(":scope > .verified, :scope > .nl-hook");
    mark ? mark.before(e) : el.append(e);
    el.classList.add("nl");
  }
}

// The profile page: ring around the photo, background, and banner colours (when there's no banner picture)
export function applyProfileLook({ view, avatarWrap, banner }, look) {
  if (avatarWrap) { if (look?.ring) avatarWrap.dataset.ring = look.ring; else delete avatarWrap.dataset.ring; }
  if (view) { if (look?.bg) view.dataset.pbg = look.bg; else delete view.dataset.pbg; }
  if (banner) { if (look?.banner) banner.dataset.bfx = look.banner; else delete banner.dataset.bfx; }
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
  const cur = { color: "", font: "", effect: "", accent: "", ring: "", bg: "", banner: "", emoji: "", ...(state.me.look || {}) };
  const preview = h("span", { class: "look-preview-name", text: state.me.name });
  const miniBanner = h("div", { class: "look-mini-banner profile-banner" + (state.me.banner ? "" : " empty"), style: state.me.banner ? `background-image:url("${state.me.banner}")` : "" });
  const miniAvatar = h("div", { class: "look-mini-avatar profile-avatar" }, avatar(state.me, 64));
  const previewWrap = h("div", { class: "look-preview" }, miniBanner, miniAvatar,
    h("b", { class: "look-preview-b" }, preview, tick(state.me, 24)), h("small", { class: "muted", text: "@" + state.me.username }));
  const paint = () => {
    applyLook(previewWrap.querySelector(".look-preview-b"), cur);
    applyProfileLook({ view: previewWrap, avatarWrap: miniAvatar, banner: state.me.banner ? null : miniBanner }, cur);
    previewWrap.style.setProperty("--accent", cur.accent || "#ff4fa3");
    previewWrap.style.setProperty("--pink", cur.accent || "#ff4fa3");
    for (const [box, key] of [[emojis, "emoji"], [rings, "ring"], [bgs, "bg"], [banners, "banner"]]) for (const b of box.children) b.classList.toggle("on", (b.dataset.v || "") === (cur[key] || ""));
    for (const b of colors.querySelectorAll(".look-sw")) b.classList.toggle("on", (b.dataset.v || "") === (cur.color || ""));
    custom.value = cur.color?.startsWith("#") ? cur.color : "#ff4fa3";
    gradBox?.classList.toggle("on", Boolean(cur.color?.startsWith("grad:")));
    customWrap.classList.toggle("on", Boolean(cur.color?.startsWith("#")));
    for (const b of [...fonts.children, ...gamerFonts.children]) b.classList.toggle("on", b.dataset.v === (cur.font || ""));
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
  // My own gradient: 2–4 colours and a direction
  const grad = cur.color?.startsWith("grad:") ? parseGrad(cur.color) : { cols: ["#ff4fa3", "#4cc9ff"], deg: 90 };
  const gradStops = h("div", { class: "grad-stops" });
  const gradBar = h("div", { class: "grad-bar" });
  const angle = h("input", { type: "range", min: 0, max: 360, step: 5, value: grad.deg, class: "grad-angle", "aria-label": "Direction" });
  const angleLabel = h("span", { class: "muted grad-deg" });
  const addStop = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "＋ Colour" });
  const useGrad = () => { cur.color = `grad:${grad.cols.join(",")}@${grad.deg}`; paint(); paintGrad(); };
  function paintGrad() {
    gradBar.style.background = gradCss(grad);
    angleLabel.textContent = grad.deg + "°";
    addStop.hidden = grad.cols.length >= 4;
    gradStops.replaceChildren(...grad.cols.map((c, i) => {
      const input = h("input", { type: "color", value: c, "aria-label": `Colour ${i + 1}` });
      input.addEventListener("input", () => { grad.cols[i] = input.value; useGrad(); });
      const del = grad.cols.length > 2 ? h("button", { type: "button", class: "grad-del", "aria-label": "Remove this colour", text: "✕", onclick: () => { grad.cols.splice(i, 1); useGrad(); } }) : null;
      return h("label", { class: "grad-stop", style: `background:${c}` }, input, del);
    }));
    gradBox.classList.toggle("on", Boolean(cur.color?.startsWith("grad:")));
  }
  angle.addEventListener("input", () => { grad.deg = Number(angle.value); useGrad(); });
  addStop.addEventListener("click", () => { grad.cols.push(grad.cols[grad.cols.length - 1]); useGrad(); });
  gradBar.addEventListener("click", useGrad);
  const gradBox = h("div", { class: "grad-box" }, gradBar, h("div", { class: "grad-row" }, gradStops, addStop), h("div", { class: "grad-row" }, h("span", { text: "Direction" }), angle, angleLabel));
  const chip = (list, key) => h("div", { class: "look-chips" }, ...list.map(([v, label]) => {
    const b = h("button", { type: "button", class: "look-chip", dataset: { v, nf: key === "font" ? v : null }, text: label });
    if (key === "font" && v) loadFonts();
    b.addEventListener("click", () => { cur[key] = v; paint(); });
    return b;
  }));
  const fonts = chip(NAME_FONTS, "font");
  const gamerFonts = chip(GAMER_FONTS, "font");
  const effects = chip(NAME_EFFECTS, "effect");
  const accentCustom = h("input", { type: "color", class: "look-custom", "aria-label": "Any accent colour" });
  accentCustom.addEventListener("input", () => { cur.accent = accentCustom.value; paint(); });
  const accents = h("div", { class: "look-grid" },
    (() => { const b = h("button", { type: "button", class: "look-acc", dataset: { v: "" }, title: "Default" }, h("span", { text: "∅" })); b.addEventListener("click", () => { cur.accent = ""; paint(); }); return b; })(),
    ...ACCENTS.map((c) => { const b = h("button", { type: "button", class: "look-acc", dataset: { v: c }, style: `background:${c}`, title: c }); b.addEventListener("click", () => { cur.accent = c; paint(); }); return b; }),
    h("label", { class: "look-acc look-custom-wrap", title: "Any colour" }, h("span", { text: "＋" }), accentCustom));
  // Emoji next to my name, ring around my photo, profile background, banner colours
  const pickRow = (list, key, cls = "look-chip") => h("div", { class: "look-chips" }, ...list.map(([v, label]) => {
    const b = h("button", { type: "button", class: cls, dataset: { v, [key]: v }, text: label });
    b.addEventListener("click", () => { cur[key] = v; paint(); });
    return b;
  }));
  const emojiMore = h("button", { type: "button", class: "look-emo more", title: "Any emoji", text: "＋" });
  const emojis = h("div", { class: "look-chips" },
    (() => { const b = h("button", { type: "button", class: "look-emo", dataset: { v: "" }, text: "∅" }); b.addEventListener("click", () => { cur.emoji = ""; paint(); }); return b; })(),
    ...NAME_EMOJIS.map((e) => { const b = h("button", { type: "button", class: "look-emo", dataset: { v: e }, text: e }); b.addEventListener("click", () => { cur.emoji = e; paint(); }); return b; }),
    emojiMore);
  emojiMore.addEventListener("click", () => import("./emoji.js").then(({ openEmojiPicker }) => openEmojiPicker(emojiMore, (e) => { cur.emoji = e; paint(); })));
  const rings = pickRow(RINGS, "ring", "look-chip look-ring");
  const bgs = pickRow(PROFILE_BGS, "bg");
  const banners = pickRow(BANNERS, "banner", "look-chip look-banner");
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save my look" });
  const reset = h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "Back to default" });
  const m = modal({ title: "Customize your profile", body: h("div", { class: "create-form look-editor" },
    previewWrap,
    h("p", { class: "look-label", text: "Name colour" }), colors,
    h("p", { class: "look-label", text: "Your own gradient" }), h("p", { class: "create-hint", text: "Pick 2 to 4 colours and turn the direction. Tap the bar to use it." }), gradBox,
    h("p", { class: "look-label", text: "Name font" }), fonts,
    h("p", { class: "look-label", text: "🎮 Gamer fonts" }), gamerFonts,
    h("p", { class: "look-label", text: "Name effect" }), effects,
    h("p", { class: "look-label", text: "Emoji next to your name" }), emojis,
    h("p", { class: "look-label", text: "Profile accent colour" }), h("p", { class: "create-hint", text: "Buttons, tabs and highlights on your profile." }), accents,
    h("p", { class: "look-label", text: "Ring around your photo" }), rings,
    h("p", { class: "look-label", text: "Profile background" }), bgs,
    h("p", { class: "look-label", text: "Banner colours" }), h("p", { class: "create-hint", text: state.me.banner ? "Shown when you remove your banner picture." : "For your banner (you don’t have a banner picture)." }), banners,
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
  save.addEventListener("click", () => store({ color: cur.color || null, font: cur.font || null, effect: cur.effect || null, accent: cur.accent || null,
    ring: cur.ring || null, bg: cur.bg || null, banner: cur.banner || null, emoji: cur.emoji || null }));
  reset.addEventListener("click", () => store({}));
  paint();
  paintGrad();
}
