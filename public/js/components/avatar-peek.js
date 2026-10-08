// Hold someone's photo (anywhere on LookBlog) to see it big. Tap anywhere (or press Esc) to close it.
import { h } from "../ui.js";
import { navigate, profileHref } from "../router.js";

let timer = null, start = null, heldAt = 0;
const cancel = () => { clearTimeout(timer); timer = null; start = null; };

document.addEventListener("pointerdown", (e) => {
  const av = e.target.closest?.(".avatar[data-u]");
  if (!av || e.button > 0 || av.closest(".ap-wrap, .edit-avatar")) return;
  start = { x: e.clientX, y: e.clientY };
  timer = setTimeout(() => { timer = null; heldAt = Date.now(); navigator.vibrate?.(10); peek(av); }, 420);
}, true);
document.addEventListener("pointermove", (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel(); }, true);
document.addEventListener("pointerup", cancel, true);
document.addEventListener("pointercancel", cancel, true);
addEventListener("scroll", cancel, true);
// letting go after the hold isn't a tap (no opening the profile underneath)
document.addEventListener("click", (e) => { if (Date.now() - heldAt < 700 && !e.target.closest(".ap-wrap")) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener("contextmenu", (e) => { if (e.target.closest?.(".avatar[data-u]") && Date.now() - heldAt < 1500) e.preventDefault(); }, true);

function peek(av) {
  document.querySelector(".ap-wrap")?.remove();
  const username = av.dataset.u, name = av.dataset.n || username;
  const img = av.querySelector("img");
  const big = img
    ? h("img", { class: "ap-img", src: img.currentSrc || img.src, alt: name })
    : h("span", { class: av.className.replace(/\bis-live\b/, "") + " ap-initials", text: av.querySelector(".av-initials")?.textContent || "" });
  const open = h("button", { type: "button", class: "btn btn-primary btn-sm", text: "View profile" });
  const wrap = h("div", { class: "ap-wrap", role: "dialog", "aria-label": `${name}’s photo` },
    h("div", { class: "ap-card" }, h("div", { class: "ap-circle" }, big), h("b", { class: "ap-name", text: name }), h("span", { class: "ap-handle", text: "@" + username }), open));
  const close = () => { wrap.classList.add("out"); setTimeout(() => wrap.remove(), 180); removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  open.addEventListener("click", (e) => { e.stopPropagation(); close(); navigate(profileHref(username)); });
  // (the tap that ends the hold doesn't close it; the next one does)
  setTimeout(() => wrap.addEventListener("click", (e) => { if (e.target !== open) close(); }), 350);
  addEventListener("keydown", esc);
  document.body.append(wrap);
}
