// Press and hold a post in the feed: it lifts out of the list, moves to the middle of the screen and zooms in,
// with everything behind it blurred. Let go and it slides back into its place.
// (Photos, profile pictures, buttons, polls and videos keep their own hold or tap.)
import { h } from "../ui.js";

const POST = ".feed .post";
const SKIP = "a.media-cell, a.reply-media, .avatar, button, input, textarea, select, label, video, iframe, audio, [contenteditable='true'], .poll, .yt-audio-box, .ai-hidden";
const HOLD = 420;
let timer = null, start = null, card = null, shown = null, heldAt = 0;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function cancel() {
  clearTimeout(timer); timer = null; start = null;
  if (card && !shown) { card.classList.remove("pk-press"); card = null; }
}

function open() {
  timer = null;
  if (!card?.isConnected) return cancel();
  heldAt = Date.now();
  navigator.vibrate?.(10);
  getSelection?.()?.removeAllRanges();
  card.classList.remove("pk-press");
  const r = card.getBoundingClientRect();
  const clone = card.cloneNode(true);
  clone.classList.add("pk-card");
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  clone.querySelectorAll("video").forEach((v) => { v.muted = true; v.removeAttribute("autoplay"); });
  const vw = innerWidth, vh = innerHeight, ZOOM = 1.12;
  // A post that already fills the screen's width (a phone) is laid out a little narrower and then zoomed up to
  // the full width, so it really looks bigger
  const w = Math.min(r.width, Math.round((vw - 16) / ZOOM));
  Object.assign(clone.style, { left: r.left + (r.width - w) / 2 + "px", top: r.top + "px", width: w + "px" });
  // (inside a .feed so the feed's own post styles still apply)
  const wrap = h("div", { class: "pk-wrap", "aria-hidden": "true" }, h("div", { class: "pk-bg" }), h("div", { class: "feed pk-feed" }, clone));
  document.body.append(wrap);
  document.documentElement.classList.add("pk-open");
  const ch = clone.offsetHeight;
  // it starts exactly as wide as the post in the list…
  const s0 = r.width / w;
  clone.style.transition = "none";
  clone.style.transform = `scale(${s0})`;
  clone.offsetWidth;
  clone.style.transition = "";
  clone.dataset.from = `scale(${s0})`;
  // …and zooms to the middle of the screen (smaller if it's taller than the screen)
  const s = Math.max(0.4, Math.min(ZOOM, (vw - 16) / w, (vh - 40) / ch));
  const dx = vw / 2 - (r.left + r.width / 2), dy = vh / 2 - (r.top + ch / 2);
  card.classList.add("pk-hidden");
  shown = { wrap, clone, card };
  const go = () => { wrap.classList.add("on"); clone.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`; };
  if (calm()) go(); else requestAnimationFrame(() => requestAnimationFrame(go));
}

function close() {
  cancel();
  if (!shown) return;
  const { wrap, clone, card: c } = shown;
  shown = null; card = null;
  document.documentElement.classList.remove("pk-open");
  wrap.classList.remove("on");
  clone.style.transform = clone.dataset.from || "";
  setTimeout(() => { wrap.remove(); c.classList.remove("pk-hidden"); }, calm() ? 0 : 240);
}

document.addEventListener("pointerdown", (e) => {
  if (e.button > 0 || shown) return;
  const c = e.target.closest?.(POST);
  if (!c || e.target.closest(SKIP)) return;
  start = { x: e.clientX, y: e.clientY };
  card = c;
  c.classList.add("pk-press");
  timer = setTimeout(open, HOLD);
}, true);
// moving the finger (scrolling) before it opens: not a hold
document.addEventListener("pointermove", (e) => { if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel(); }, true);
for (const ev of ["pointerup", "pointercancel"]) document.addEventListener(ev, close, true);
addEventListener("blur", close);
addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
addEventListener("scroll", () => { if (timer) cancel(); }, true);
// while it's open the page doesn't scroll under your finger
document.addEventListener("touchmove", (e) => { if (shown) e.preventDefault(); }, { passive: false });
// letting go after a hold isn't a tap (no link or post opens too)
document.addEventListener("click", (e) => { if (Date.now() - heldAt < 600 && e.target.closest?.(POST)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
// no "copy / open link" menu while holding
document.addEventListener("contextmenu", (e) => { if (e.target.closest?.(POST) && !e.target.closest(SKIP) && (timer || shown || Date.now() - heldAt < 1500)) e.preventDefault(); }, true);
