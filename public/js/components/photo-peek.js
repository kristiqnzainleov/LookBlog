// Press and hold a photo in a post (or a reply, or a message) to see it big; let go and it's gone (like Instagram).
// A normal click still opens it in the photo viewer.
import { h } from "../ui.js";

const SEL = "a.media-cell, a.reply-media, a.msg-media";
let timer = null, start = null, shown = null, heldAt = 0;

function close() {
  if (!shown) return;
  const el = shown; shown = null;
  el.classList.add("out");
  setTimeout(() => el.remove(), 160);
}
function cancel() { clearTimeout(timer); timer = null; start = null; }

document.addEventListener("pointerdown", (e) => {
  const a = e.target.closest?.(SEL);
  const img = a?.querySelector("img");
  if (!img || e.button > 0) return;
  start = { x: e.clientX, y: e.clientY };
  timer = setTimeout(() => {
    timer = null;
    heldAt = Date.now();
    navigator.vibrate?.(10);
    shown = h("div", { class: "pp-wrap", "aria-hidden": "true" }, h("img", { class: "pp-img", src: a.getAttribute("href") || img.currentSrc || img.src, alt: "" }));
    document.body.append(shown);
  }, 380);
}, true);
// moving the finger (scrolling) before it opens: not a hold
document.addEventListener("pointermove", (e) => { if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel(); }, true);
for (const ev of ["pointerup", "pointercancel"]) document.addEventListener(ev, () => { cancel(); close(); }, true);
addEventListener("blur", () => { cancel(); close(); });
addEventListener("scroll", () => { if (timer) cancel(); }, true);
// letting go after a hold isn't a click (the photo viewer doesn't open too)
document.addEventListener("click", (e) => { if (Date.now() - heldAt < 600 && e.target.closest?.(SEL)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
// no "save image" menu while holding
document.addEventListener("contextmenu", (e) => { if (e.target.closest?.(SEL) && (timer || shown || Date.now() - heldAt < 1500)) e.preventDefault(); }, true);
