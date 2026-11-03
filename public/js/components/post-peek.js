// Press and hold a post in the feed: it lifts out of the list, moves to the middle of the screen and zooms in,
// with everything behind it blurred. It stays big after you let go: like, reply or share from there.
// Tap outside it, press ✕ or Esc and it slides back into its place.
// (Photos, profile pictures, buttons, polls and videos keep their own hold or tap.)
import { h, icon } from "../ui.js";

const POST = ".feed .post";
const SKIP = "a.media-cell, a.reply-media, .avatar, button, input, textarea, select, label, video, iframe, audio, [contenteditable='true'], .poll, .yt-audio-box, .ai-hidden, .pk-wrap";
const HOLD = 420, ZOOM = 1.12;
let timer = null, start = null, card = null, shown = null, heldAt = 0;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function cancel() {
  clearTimeout(timer); timer = null; start = null;
  if (card && !shown) { card.classList.remove("pk-press"); card = null; }
}

function open() {
  timer = null;
  const c = card;
  if (!c?.isConnected) return cancel();
  heldAt = Date.now();
  navigator.vibrate?.(10);
  getSelection?.()?.removeAllRanges();
  c.classList.remove("pk-press");
  const r = c.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  // The post itself moves into the big view (so its buttons work); an empty spot of the same size keeps its place
  const spot = h("div", { class: "pk-spot", style: `height:${r.height}px` });
  c.before(spot);
  // A post that already fills the screen's width (a phone) is laid out a little narrower and then zoomed up to
  // the full width, so it really looks bigger
  const w = Math.min(r.width, Math.round((vw - 16) / ZOOM));
  Object.assign(c.style, { left: r.left + (r.width - w) / 2 + "px", top: r.top + "px", width: w + "px" });
  c.classList.add("pk-card");
  const x = h("button", { type: "button", class: "icon-btn pk-close", "aria-label": "Close" }, icon("close"));
  const bg = h("div", { class: "pk-bg" });
  // (inside a .feed so the feed's own post styles still apply)
  const wrap = h("div", { class: "pk-wrap", role: "dialog", "aria-modal": "true", "aria-label": "Post" }, bg, x, h("div", { class: "feed pk-feed" }, c));
  document.body.append(wrap);
  document.documentElement.classList.add("pk-open");
  const ch = c.offsetHeight;
  // it starts exactly as wide as the post in the list…
  const from = `scale(${r.width / w})`;
  c.style.transition = "none";
  c.style.transform = from;
  c.offsetWidth;
  c.style.transition = "";
  // …and zooms to the middle of the screen (smaller if it's taller than the screen)
  const s = Math.max(0.4, Math.min(ZOOM, (vw - 16) / w, (vh - 40) / ch));
  const dx = vw / 2 - (r.left + r.width / 2), dy = vh / 2 - (r.top + ch / 2);
  // deleted from the big view: the big view closes
  const obs = new MutationObserver(() => { if (!wrap.contains(c)) close(true); });
  obs.observe(wrap.lastChild, { childList: true });
  shown = { wrap, card: c, spot, from, obs };
  card = null;
  bg.addEventListener("click", close);
  x.addEventListener("click", close);
  // opening a link from it (a profile, the post, a hashtag) closes the big view first
  c.addEventListener("click", onLink, true);
  const go = () => { wrap.classList.add("on"); c.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`; };
  if (calm()) go(); else requestAnimationFrame(() => requestAnimationFrame(go));
}

function onLink(e) {
  if (Date.now() - heldAt < 600) return;
  if (e.target.closest?.("a[href]") && !e.target.closest("a.media-cell, a.reply-media")) close(true);
}

function close(now = false) {
  cancel();
  if (!shown) return;
  const { wrap, card: c, spot, from, obs } = shown;
  obs?.disconnect();
  shown = null;
  c.removeEventListener("click", onLink, true);
  document.documentElement.classList.remove("pk-open");
  const back = () => {
    // (a post deleted from the big view doesn't come back)
    const kept = wrap.contains(c);
    wrap.remove();
    c.classList.remove("pk-card");
    c.style.left = c.style.top = c.style.width = c.style.transform = c.style.transition = "";
    if (kept && spot.isConnected) spot.replaceWith(c);
    else spot.remove();
  };
  if (now === true || calm()) return back();
  wrap.classList.remove("on");
  c.style.transform = from;
  setTimeout(back, 240);
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
// letting go before it opens: nothing happens (after it opens, it stays)
for (const ev of ["pointerup", "pointercancel"]) document.addEventListener(ev, cancel, true);
addEventListener("keydown", (e) => { if (e.key === "Escape" && shown && !document.querySelector(".app-overlay, .ap-wrap, .pv-wrap")) close(); });
addEventListener("scroll", () => { if (timer) cancel(); }, true);
addEventListener("popstate", () => close(true));
// while it's open the page behind it doesn't scroll
document.addEventListener("touchmove", (e) => { if (shown && !e.target.closest?.(".app-overlay, .post-actions")) e.preventDefault(); }, { passive: false });
document.addEventListener("wheel", (e) => { if (shown && !e.target.closest?.(".app-overlay")) e.preventDefault(); }, { passive: false });
// letting go after a hold isn't a tap (no link or post opens too)
document.addEventListener("click", (e) => { if (Date.now() - heldAt < 600 && e.target.closest?.(POST + ", .pk-wrap")) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
// no "copy / open link" menu while holding
document.addEventListener("contextmenu", (e) => { if (e.target.closest?.(POST) && !e.target.closest(SKIP) && (timer || Date.now() - heldAt < 1500)) e.preventDefault(); }, true);
