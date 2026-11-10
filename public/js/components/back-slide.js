// Going back (any ← arrow, or the browser's back): the screen slides. What you were looking at moves out
// to the right and the screen you came from slides in from the left, like turning back a page.
// (The top bar and the dock stay still. Browsers without view transitions get a simpler slide-in.)
const BACK = "button.modal-back, button.convo-back, button.gv-back, button.inbox-back, button[aria-label^='Back']";
let busy = false, passing = false;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Wait until the new screen is drawn: nothing changed for a moment (or at most ~0.45 s)
function settle() {
  return new Promise((ok) => {
    let quiet;
    const done = () => { obs.disconnect(); clearTimeout(quiet); clearTimeout(max); ok(); };
    const obs = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, 80); });
    obs.observe(document.body, { childList: true, subtree: true });
    quiet = setTimeout(done, 140);
    const max = setTimeout(done, 450);
  });
}

function fallback() {
  const v = document.getElementById("view");
  if (!v) return;
  v.classList.remove("back-in"); v.offsetWidth; v.classList.add("back-in");
  setTimeout(() => v.classList.remove("back-in"), 400);
}

// Run fn (which shows the previous screen) with the slide
export function slideBack(fn, { page = false } = {}) {
  if (busy || calm()) return fn();
  if (!document.startViewTransition) { const r = fn(); if (page) fallback(); return r; }
  busy = true;
  const root = document.documentElement;
  root.classList.add("vt-back");
  // (with a window open over the page, everything slides together, so the top bar can't jump above the window)
  root.classList.toggle("vt-page", !document.querySelector(".app-overlay.open, .mm-overlay, .ap-wrap, .pv-wrap, .pk-wrap, [role='dialog'][aria-modal='true']"));
  let t;
  try { t = document.startViewTransition(() => { fn(); return settle(); }); }
  catch { busy = false; root.classList.remove("vt-back", "vt-page"); return fn(); }
  t.finished.catch(() => {}).finally(() => { busy = false; root.classList.remove("vt-back", "vt-page"); });
}

// Tapping a ← arrow: let its own click run inside the slide
document.addEventListener("click", (e) => {
  if (passing || busy || calm() || !document.startViewTransition || e.button > 0) return;
  const b = e.target.closest?.(BACK);
  // (a window's own arrow only moves the window: see modal() in ui.js)
  if (!b || b.disabled || b.closest(".lb-nav, .app-overlay, .md-wrap, .create-pop")) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  slideBack(() => { passing = true; try { b.click(); } finally { passing = false; } });
}, true);
