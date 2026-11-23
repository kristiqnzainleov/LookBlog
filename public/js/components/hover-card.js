// Point at someone's name or photo (without clicking) and their profile pops up as a small card.
// It stays while the pointer is on the name or on the card, so you can follow or message from it,
// and goes away a moment after the pointer leaves. Only with a mouse: on a phone a tap opens the profile as before.
import { miniProfile, closeMiniProfile } from "./mini-profile.js";
import { state } from "../state.js";

const SHOW = 550, HIDE = 260;
const LINK = 'a[href^="/u/"]';
// (not in the top bar's own menus, the dock, menus, or inside a card that's already a profile)
const SKIP = ".mini-profile, .topbar, .dock, .me-pop, .ctx-menu, .mm-overlay, .pk-wrap, .story-viewer, [data-no-hover]";
const fine = matchMedia("(hover: hover) and (pointer: fine)");

let showTimer = null, hideTimer = null, anchor = null, card = null, pending = null;

const nameOf = (a) => {
  const m = (a.getAttribute("href") || "").match(/^\/u\/([^/?#]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
};

function hide() {
  clearTimeout(showTimer); showTimer = null; pending = null;
  clearTimeout(hideTimer); hideTimer = null;
  if (card) { closeMiniProfile(); card = null; anchor = null; }
}
const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, HIDE); };
const stay = () => { clearTimeout(hideTimer); hideTimer = null; };

function show(a, username) {
  pending = null;
  if (!a.isConnected || !state.me) return;
  anchor = a;
  miniProfile(username, a, {
    hover: true,
    onCard: (c) => {
      card = c;
      c.addEventListener("pointerenter", stay);
      c.addEventListener("pointerleave", (e) => { if (!anchor?.contains(e.relatedTarget)) hideSoon(); });
    },
  });
}

document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse" || !fine.matches) return;
  const a = e.target.closest?.(LINK);
  if (!a || a.closest(SKIP)) return;
  const username = nameOf(a);
  if (!username) return;
  if (a === anchor && card?.isConnected) return stay(); // back on the same name: keep it
  if (pending === a) return;
  clearTimeout(showTimer);
  pending = a;
  showTimer = setTimeout(() => {
    if (pending !== a) return;
    clearTimeout(hideTimer);
    if (card) { closeMiniProfile(); card = null; }
    show(a, username);
  }, SHOW);
}, true);

document.addEventListener("pointerout", (e) => {
  if (e.pointerType !== "mouse") return;
  const a = e.target.closest?.(LINK);
  if (!a || a.contains(e.relatedTarget)) return;
  if (pending === a) { clearTimeout(showTimer); showTimer = null; pending = null; }
  if (a === anchor && !card?.contains(e.relatedTarget)) hideSoon();
}, true);

// clicking goes to the profile as before (the card closes), and so do scrolling, typing and leaving the page
document.addEventListener("pointerdown", (e) => { if (!card?.contains(e.target)) hide(); }, true);
addEventListener("scroll", (e) => { if (card && !card.contains(e.target)) hide(); else if (pending) { clearTimeout(showTimer); pending = null; } }, true);
addEventListener("keydown", (e) => { if (!card?.contains(e.target)) hide(); });
addEventListener("popstate", hide);
addEventListener("blur", hide);
