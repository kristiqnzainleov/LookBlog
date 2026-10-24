// Click (or tap) someone's photo anywhere on LookBlog to see it big. Tap anywhere (or press Esc) to close it.
// (Not where clicking a photo already does something: opening a story, your own menu, editing your own photo.)
import { h } from "../ui.js";
import { navigate, profileHref } from "../router.js";

const SKIP = ".ap-wrap, .edit-avatar, .story-item, .story-ring, .story-viewer, .me-btn, .profile-avatar.has-story, [data-no-peek]";
document.addEventListener("click", (e) => {
  const av = e.target.closest?.(".avatar[data-u]");
  if (!av || e.button > 0 || e.ctrlKey || e.metaKey || e.shiftKey || av.closest(SKIP)) return;
  // my own big photo on my own profile has its own menu (add to story, change, adjust…)
  if (av.closest(".profile-avatar") && !av.closest("[data-other-profile]")) return;
  e.preventDefault();
  e.stopPropagation();
  peek(av);
}, true);

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
  // (any tap outside the button closes it)
  setTimeout(() => wrap.addEventListener("click", (e) => { if (e.target !== open) close(); }), 50);
  addEventListener("keydown", esc);
  document.body.append(wrap);
}
