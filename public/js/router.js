// Client-side pages with real URLs (/feed, /shorts, /videos, /search, /post/:id, /u/:username).
import { $ } from "./ui.js";
import { state } from "./state.js";

const routes = [];
let cleanup = null;

export function route(pattern, page) {
  routes.push({ pattern, page });
}

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return render();
  history[replace ? "replaceState" : "pushState"](null, "", to);
  render();
}

export async function render() {
  const path = location.pathname;
  const match = routes.map((r) => ({ r, m: path.match(r.pattern) })).find((x) => x.m);
  if (typeof cleanup === "function") cleanup();
  cleanup = null;

  const view = $("view");
  view.replaceChildren();
  view.className = "view";
  view.removeAttribute("style"); // e.g. a profile's own accent colour
  // …and the rest of a profile's look: its background, frame and pointer trail stay on that profile only
  for (const k of Object.keys(view.dataset)) delete view.dataset[k];
  view._trailOff?.(); view._trailOff = null;
  document.body.dataset.page = "";
  window.scrollTo(0, 0);

  if (!match) return navigate("/feed", { replace: true });

  // Highlight the right menu item
  const name = match.r.page.navName?.(match.m) ?? "";
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
  document.body.dataset.page = name;
  document.body.dataset.layout = match.r.page.layout || "narrow";

  cleanup = await match.r.page(view, match.m, new URLSearchParams(location.search));
}

export function startRouter() {
  // Open internal links without reloading the page
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || a.target || a.hasAttribute("download")) return;
    if (!/^\/(feed|shorts|videos|search|post\/|watch\/|u\/|playlist\/|messages|groups|invite\/|events|cinema|music|history|settings|album\/|leaderboard|editor|live\/|event\/|verified|analytics|people|admin)/.test(url.pathname)) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
  window.addEventListener("popstate", render);
  render();
}

export const profileHref = (username) => `/u/${encodeURIComponent(username)}`;
export const postHref = (id) => `/post/${encodeURIComponent(id)}`;
export const isMe = (username) => state.me && username.toLowerCase() === state.me.username.toLowerCase();
