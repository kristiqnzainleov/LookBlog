// How a story is edited: a filter, light/colour adjustments, the photo moved / zoomed / turned, and text and
// emoji placed on it. Kept as data with the story (so videos can have it too) — shared by the server and the browser.
export const STORY_FILTERS = [
  ["", "Normal", ""],
  ["clarendon", "Clarendon", "contrast(1.2) saturate(1.35)"],
  ["juno", "Juno", "saturate(1.4) contrast(1.1) hue-rotate(-8deg)"],
  ["lark", "Lark", "brightness(1.12) saturate(0.9) contrast(0.95)"],
  ["gingham", "Gingham", "brightness(1.05) sepia(0.12) contrast(0.92)"],
  ["moon", "Moon", "grayscale(1) contrast(1.1) brightness(1.1)"],
  ["noir", "Noir", "grayscale(1) contrast(1.45) brightness(0.9)"],
  ["vintage", "Vintage", "sepia(0.55) contrast(1.05) saturate(1.2) brightness(0.95)"],
  ["warm", "Warm", "sepia(0.25) saturate(1.3) hue-rotate(-12deg)"],
  ["cool", "Cool", "saturate(1.1) hue-rotate(14deg) brightness(1.03)"],
  ["dreamy", "Dreamy", "brightness(1.12) saturate(1.2) contrast(0.88) blur(0.3px)"],
  ["neon", "Neon", "saturate(2) contrast(1.25) hue-rotate(-20deg)"],
  ["pink", "Pink", "sepia(0.3) saturate(1.6) hue-rotate(-40deg)"],
  ["fade", "Fade", "contrast(0.8) brightness(1.15) saturate(0.75)"],
  ["drama", "Drama", "contrast(1.5) saturate(1.3) brightness(0.88)"],
  ["sunset", "Sunset", "sepia(0.35) saturate(1.6) hue-rotate(-25deg) contrast(1.1)"],
];
export const STORY_FONTS = [["classic", "Classic", "Golos Text, system-ui, sans-serif"], ["bold", "Bold", "Unbounded, sans-serif"], ["type", "Typewriter", "ui-monospace, Menlo, monospace"],
  ["neon", "Neon", "'Pacifico', 'Brush Script MT', cursive"], ["serif", "Serif", "Georgia, 'Times New Roman', serif"], ["comic", "Comic", "'Comic Sans MS', 'Marker Felt', cursive"]];
export const STORY_TEXT_STYLES = [["plain", "Aa"], ["bg", "▣"], ["soft", "▢"], ["outline", "Ⓐ"], ["glow", "✦"]];
export const STORY_COLORS = ["#ffffff", "#111111", "#ff4fa3", "#ff4757", "#ff8a3d", "#ffd23f", "#2ee6a6", "#4cc9ff", "#3d7bff", "#9b5cff"];
export const STORY_BGS = ["#000000", "#ff4fa3", "#9b5cff", "#4cc9ff", "#2ee6a6", "#ffd23f", "#ff8a3d", "#ffffff"];

const filterOf = (id) => STORY_FILTERS.find((f) => f[0] === id)?.[2] || "";
// The CSS for the photo or video itself
export function mediaStyle(edit) {
  const a = edit?.a || {}, t = edit?.t || {};
  const parts = [filterOf(edit?.f)];
  if (a.b) parts.push(`brightness(${1 + a.b / 100})`);
  if (a.c) parts.push(`contrast(${1 + a.c / 100})`);
  if (a.s) parts.push(`saturate(${1 + a.s / 100})`);
  if (a.w) parts.push(a.w > 0 ? `sepia(${a.w / 200}) hue-rotate(${-a.w / 6}deg)` : `hue-rotate(${-a.w / 4}deg) saturate(${1 - a.w / 400})`);
  const filter = parts.filter(Boolean).join(" ");
  const transform = `translate(${t.x || 0}%, ${t.y || 0}%) rotate(${t.r || 0}deg) scale(${t.z || 1})`;
  return { filter, transform };
}

// Clean what a browser sent (the server keeps only this)
const num = (v, lo, hi, d = 0, dp = 0) => { const n = Number(v); if (!Number.isFinite(n)) return d; const k = 10 ** dp; return Math.round(Math.max(lo, Math.min(hi, n)) * k) / k; };
const HEX = /^#[0-9a-f]{6}$/i;
const EMOJI_ONE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:️|⃣|\p{Emoji_Modifier}|‍(?:\p{Extended_Pictographic}|\p{Emoji_Component}))*️?$/u;
export function cleanStoryEdit(e) {
  if (!e || typeof e !== "object") return null;
  const out = {};
  if (STORY_FILTERS.some((f) => f[0] && f[0] === e.f)) out.f = e.f;
  const a = e.a || {}, aa = { b: num(a.b, -100, 100), c: num(a.c, -100, 100), s: num(a.s, -100, 100), w: num(a.w, -100, 100) };
  if (Object.values(aa).some(Boolean)) out.a = Object.fromEntries(Object.entries(aa).filter(([, v]) => v));
  const t = e.t || {}, tt = { z: num(t.z, 0.5, 4, 1, 2), x: num(t.x, -100, 100, 0, 1), y: num(t.y, -100, 100, 0, 1), r: num(t.r, -180, 180, 0) };
  if (tt.z !== 1 || tt.x || tt.y || tt.r) out.t = tt;
  if (HEX.test(e.bg || "")) out.bg = e.bg.toLowerCase();
  const o = Array.isArray(e.o) ? e.o.slice(0, 12) : [];
  out.o = o.map((x) => {
    if (!x || typeof x !== "object") return null;
    const base = { x: num(x.x, 0, 100, 50, 1), y: num(x.y, 0, 100, 50, 1), z: num(x.z, 3, 30, 8, 1), r: num(x.r, -180, 180, 0) };
    if (x.k === "t") {
      const v = String(x.v || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!v) return null;
      return { k: "t", v, ...base, c: HEX.test(x.c || "") ? x.c.toLowerCase() : "#ffffff",
        f: STORY_FONTS.some((f) => f[0] === x.f) ? x.f : "classic", s: STORY_TEXT_STYLES.some((s) => s[0] === x.s) ? x.s : "plain" };
    }
    if (x.k === "e" && typeof x.v === "string" && x.v.length <= 16 && EMOJI_ONE.test(x.v)) return { k: "e", v: x.v, ...base };
    return null;
  }).filter(Boolean);
  if (!out.o.length) delete out.o;
  return Object.keys(out).length ? out : null;
}
