// Starts the Look Blog app.
import { $, fillAvatar, timeAgo, toast } from "./ui.js";
import { api } from "./api.js";
import { state, on } from "./state.js";
import { connect } from "./realtime.js";
import { route, startRouter, navigate, profileHref, postHref } from "./router.js";
import { openCreate } from "./components/composer.js";
import { openEditProfile } from "./components/edit-profile.js";
import { feedPage } from "./pages/feed.js";
import { shortsPage } from "./pages/shorts.js";
import { videosPage } from "./pages/videos.js";
import { postPage } from "./pages/post.js";
import { profilePage } from "./pages/profile.js";
import { searchPage } from "./pages/search.js";

route(/^\/feed$/, feedPage);
route(/^\/shorts$/, shortsPage);
route(/^\/videos$/, videosPage);
route(/^\/search$/, searchPage);
route(/^\/post\/([\w-]+)$/, postPage);
route(/^\/u\/([^/]+)$/, profilePage);

function paintMe() {
  const me = state.me;
  fillAvatar($("meAvatar"), me);
  $("meName").textContent = me.name;
  $("meHandle").textContent = "@" + me.username;
  $("navProfile").href = $("menuProfile").href = profileHref(me.username);
}

/* ---------- Account menu in the top bar ---------- */
function setupMenu() {
  const btn = $("meBtn"), pop = $("mePop");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.setAttribute("aria-expanded", String(!pop.hidden));
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());
  pop.addEventListener("click", (e) => { if (e.target.closest("a, button")) close(); });
  $("menuEdit").addEventListener("click", openEditProfile);
  $("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    location.assign("/");
  });
}

(async function start() {
  try {
    state.me = (await api("/api/me")).user;
  } catch {
    return; // api() already sent us to the log in page
  }
  paintMe();
  on("me:updated", paintMe);
  setupMenu();

  $("createBtn").addEventListener("click", () => openCreate());
  $("topSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("topSearchInput").value.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
    $("topSearchInput").value = "";
    $("topSearchInput").blur();
  });

  // After posting a short or a video from the Create pop-up, show it where it lives
  on("navigate-after-create", (p) => {
    if (p.type === "short" && location.pathname !== "/shorts") navigate("/shorts");
    else if (p.type === "video") navigate(postHref(p.id));
    else if (p.type === "post" && location.pathname !== "/feed") navigate("/feed");
  });

  // Live: tell me when someone reposts my post
  on("repost", (ev) => {
    if (ev.authorId === state.me.id && ev.byId !== state.me.id) toast(`@${ev.by} reposted your post.`);
  });

  // Live: tell me when someone follows me
  on("follow", (ev) => {
    if (ev.username === state.me.username && ev.following) toast(`@${ev.by} started following you.`);
  });

  connect();
  startRouter();

  // Keep "5m / 3h" times fresh
  setInterval(() => {
    document.querySelectorAll("time[datetime]").forEach((t) => (t.textContent = timeAgo(t.getAttribute("datetime"))));
  }, 60000);
})();
