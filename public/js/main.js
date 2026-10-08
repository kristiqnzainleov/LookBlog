// Starts the Look Blog app.
import { $, h, avatar, fillAvatar, timeAgo, toast, lastSeenText, tick, markLive } from "./ui.js";
import { api } from "./api.js";
import { state, on } from "./state.js";
import { connect } from "./realtime.js";
import { route, startRouter, navigate, profileHref, postHref } from "./router.js";
import { feedPage } from "./pages/feed.js";
import { shortsPage } from "./pages/shorts.js";
import { videosPage } from "./pages/videos.js";
import { postPage } from "./pages/post.js";
import { profilePage } from "./pages/profile.js";
import { searchPage } from "./pages/search.js";
import { setupNotifications } from "./components/notifications.js";
import { openLightbox } from "./components/lightbox.js";
import { listenForCalls } from "./components/call.js";
import { watchPage } from "./pages/watch.js";
import { playlistPage } from "./pages/playlist.js";
import { messagesPage } from "./pages/messages.js";
import { groupsPage } from "./pages/groups.js";
import { verifiedPage } from "./pages/verified.js";
import { invitePage } from "./pages/invite.js";
import { eventsPage, eventPage } from "./pages/events.js";
import { cinemaPage } from "./pages/cinema.js";
import { musicPage } from "./pages/music.js";
import { historyPage } from "./pages/history.js";
import { settingsPage } from "./pages/settings.js";
import { albumPage } from "./pages/album.js";
import { leaderboardPage } from "./pages/leaderboard.js";
import { adminPage } from "./pages/admin.js";
import { setupAlertSounds } from "./components/sfx.js";
import { peoplePage } from "./pages/people.js";
import { editorPage } from "./pages/editor.js";
import { livePage } from "./pages/live.js";
import { analyticsPage } from "./pages/analytics.js";
import { followButton } from "./pages/profile.js";

route(/^\/feed$/, feedPage);
route(/^\/shorts$/, shortsPage);
route(/^\/videos$/, videosPage);
route(/^\/search$/, searchPage);
route(/^\/post\/([\w-]+)$/, postPage);
route(/^\/u\/([^/]+)$/, profilePage);
route(/^\/watch\/([\w-]+)$/, watchPage);
route(/^\/playlist\/([\w-]+)$/, playlistPage);
route(/^\/messages(\/[\w-]+)?$/, messagesPage);
route(/^\/groups$/, groupsPage);
route(/^\/verified$/, verifiedPage);
route(/^\/invite\/([\w-]+)$/, invitePage);
route(/^\/events$/, eventsPage);
route(/^\/cinema$/, cinemaPage);
route(/^\/music$/, musicPage);
route(/^\/history$/, historyPage);
route(/^\/settings$/, settingsPage);
route(/^\/album\/([\w-]+)$/, albumPage);
route(/^\/leaderboard$/, leaderboardPage);
route(/^\/admin$/, adminPage);
route(/^\/editor$/, editorPage);
route(/^\/live\/([\w-]+)$/, livePage);
route(/^\/event\/([\w-]+)$/, eventPage);
route(/^\/analytics$/, analyticsPage);
route(/^\/people$/, peoplePage);

/* ---------- Unread messages badge ---------- */
async function loadUnread() {
  try {
    const { unread } = await api("/api/chats");
    $("msgBadge").textContent = unread > 99 ? "99+" : String(unread);
    $("msgBadge").hidden = !unread;
  } catch {}
}

function paintMe() {
  const me = state.me;
  fillAvatar($("meAvatar"), me);
  $("meName").textContent = me.name;
  $("meHandle").textContent = "@" + me.username;
  $("navProfile").href = $("menuProfile").href = profileHref(me.username);
  $("menuAdmin").hidden = !me.admin;
}

/* ---------- Account menu in the top bar ---------- */
function setupMenu() {
  const btn = $("meBtn"), pop = $("mePop");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.setAttribute("aria-expanded", String(!pop.hidden));
    // Other accounts logged in on this browser, to switch quickly
    if (!pop.hidden) import("./components/accounts.js").then((m) => m.paintAccounts($("meAccounts")));
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());
  pop.addEventListener("click", (e) => { if (e.target.closest("a, button")) close(); });
  // Create: upload a video or a short (or write a post) from anywhere
  {
    const btn = $("createBtn"), pop = $("createPop");
    document.body.append(pop); // out of the top bar, so it can sit in the middle of the screen
    // Movies and series show up only for filmmakers, film producers, photographers and creators
    const paintFilm = () => {
      pop.querySelectorAll('[data-kind="movie"], [data-kind="series"]').forEach((b) => (b.hidden = !state.me.canMakeFilms));
      pop.querySelectorAll('[data-kind="song"]').forEach((b) => (b.hidden = !state.me.canMakeMusic));
    };
    paintFilm();
    on("me:updated", paintFilm);
    // A sheet in the middle of the screen that fades and grows in
    const close = () => {
      if (pop.hidden) return;
      pop.classList.remove("show");
      btn.setAttribute("aria-expanded", "false");
      setTimeout(() => { if (!pop.classList.contains("show")) pop.hidden = true; }, 220);
    };
    const open = () => {
      pop.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add("show")));
      btn.setAttribute("aria-expanded", "true");
      setTimeout(() => pop.querySelector(".cs-grid button")?.focus(), 60);
    };
    btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden ? open() : close(); });
    pop.addEventListener("click", (e) => { if (e.target === pop || e.target.closest(".cs-close")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    pop.addEventListener("click", async (e) => {
      const kind = e.target.closest("button[data-kind]")?.dataset.kind;
      if (!kind) return;
      close();
      if (kind === "event") return (await import("./pages/events.js")).openEventForm();
      if (kind === "series") return (await import("./components/cinema.js")).openSeriesForm();
      if (kind === "movie") return (await import("./components/cinema.js")).openMovieUpload();
      if (kind === "song") return (await import("./components/music.js")).openUploadSong();
      if (kind === "live") return (await import("./pages/live.js")).openGoLive();
      const { createCard } = await import("./components/composer.js");
      const { modal } = await import("./ui.js");
      const card = createCard(kind);
      const m = modal({ title: kind === "video" ? "Upload a video" : kind === "short" ? "Upload a short" : "Write a post", body: card.el, wide: true });
      card.el.classList.add("in-modal");
      const off = on("post:created", (p) => { off(); m.close(); navigate(p.type === "video" ? `/watch/${p.id}` : p.type === "short" ? `/shorts?id=${p.id}` : `/post/${p.id}`); });
    });
  }
  $("menuInvite").addEventListener("click", () => { $("mePop").hidden = true; import("./components/invite-friends.js").then((m) => m.openInviteFriends()); });
  $("menuBug").addEventListener("click", () => { $("mePop").hidden = true; import("./components/bug-report.js").then((m) => m.openBugReport()); });
  $("menuHelp").addEventListener("click", () => { $("mePop").hidden = true; import("./components/help.js").then((m) => m.openHelp()); });
  $("menuLanguage").addEventListener("click", () => { $("mePop").hidden = true; import("./i18n.js").then((m) => m.openLanguage()); });
  $("menuPrivacy").addEventListener("click", () => { $("mePop").hidden = true; import("./components/privacy.js").then((m) => m.openPrivacy()); });
  $("logoutBtn").addEventListener("click", async () => {
    const r = await api("/api/logout", { method: "POST" }).catch(() => ({}));
    // Another account is still logged in here: go on with it
    location.assign(r.switched ? "/feed" : "/");
  });
}

(async function start() {
  try {
    state.me = (await api("/api/me")).user;
  } catch {
    return; // api() already sent us to the log in page
  }
  // Site language (saved on the account, so it follows you to other devices)
  const i18n = await import("./i18n.js");
  if (state.me.lang && state.me.lang !== i18n.currentLang() && !sessionStorage.getItem("lb-lang-synced")) {
    try { sessionStorage.setItem("lb-lang-synced", "1"); localStorage.setItem("lb-lang", state.me.lang); location.reload(); return; } catch {}
  }
  i18n.startTranslation();
  // Someone went live / ended: update their photo everywhere on the page
  on("stream:state", (ev) => {
    if (!ev.username) return;
    document.querySelectorAll(`.avatar[data-u="${CSS.escape(ev.username)}"]`).forEach((el) => markLive(el, ev.live));
  });
  // Load the music player early so "one thing plays at a time" works on every page
  import("./components/music.js");
  // First time in with Google: say hi and point at the profile
  if (new URLSearchParams(location.search).get("welcome") === "google") {
    history.replaceState(null, "", location.pathname);
    setTimeout(() => toast(`Welcome to LookBlog, ${state.me.name}! Your @ is @${state.me.username} — change it any time on your profile.`), 600);
  }
  $("meLang").textContent = i18n.LANGS.find((l) => l.id === i18n.currentLang())?.native || "English";
  paintMe();
  on("me:updated", paintMe);
  // The LookBlog team: a badge on the Admin menu item with what's waiting
  if (state.me.admin) {
    const paintAdmin = (c) => { const n = c.reports + c.verifications + c.support + c.bugs; $("adminBadge").textContent = n > 99 ? "99+" : String(n); $("adminBadge").hidden = !n; };
    api("/api/admin").then((d) => paintAdmin(d.counts)).catch(() => {});
    on("admin:update", (ev) => paintAdmin(ev.counts));
  }
  // Suspended or deleted by the LookBlog team: back to the start page
  on("account:banned", () => { location.href = "/"; });
  setupMenu();
  setupNotifications();
  setupAlertSounds(state.me);
  listenForCalls();

  // Any photo in a post, reply or message opens in the site's own viewer
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.media-cell, a.reply-media, a.msg-media");
    if (!a || !a.querySelector("img") || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const group = a.closest(".media-grid");
    const links = group ? [...group.querySelectorAll("a.media-cell")] : [a];
    openLightbox(links.map((l) => l.getAttribute("href")), links.indexOf(a));
  });

  import("./components/search-suggest.js").then((m) => m.attachSuggestions($("topSearch"), $("topSearchInput")));
  import("./components/voice-search.js").then((m) => m.attachVoiceSearch($("topSearch"), $("topSearchInput")));
  $("topSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("topSearchInput").value.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
    $("topSearchInput").value = "";
    $("topSearchInput").blur();
    document.body.classList.remove("search-open");
  });
  // Phones: the search is a round button that opens into a full-width bar
  const phone = matchMedia("(max-width: 640px)");
  $("topSearch").addEventListener("click", (e) => {
    if (!phone.matches || document.body.classList.contains("search-open")) return;
    e.preventDefault();
    document.body.classList.add("search-open");
    $("topSearchInput").focus();
  });
  $("topSearchInput").addEventListener("blur", () => {
    // Wait a moment so a tap on a suggestion still works
    setTimeout(() => { if (!$("topSearch").contains(document.activeElement)) document.body.classList.remove("search-open"); }, 250);
  });
  $("topSearchInput").addEventListener("keydown", (e) => { if (e.key === "Escape") $("topSearchInput").blur(); });

  // Live: messages, mentions, cools, groups
  on("message", (ev) => {
    loadUnread();
    const here = location.pathname === `/messages/${ev.chatId}`;
    if (!here && !ev.message.mine) {
      const where = ev.chat.kind === "group" ? ` in ${ev.chat.name}` : "";
      toast(`New message from ${ev.message.author.name}${where}.`);
    }
  });
  on("chats:changed", loadUnread);
  on("message:reacted", (ev) => {
    if (location.pathname !== `/messages/${ev.chatId}`) toast(`@${ev.by} reacted ${ev.emoji} to your message.`);
  });
  on("group:added", (ev) => { toast(`@${ev.by} added you to ${ev.name}.`); loadUnread(); });
  on("group:deleted", () => loadUnread());


  connect();
  // The bottom menu steps aside while you scroll down and comes back when you scroll up (phones and computers)
  {
    let lastY = scrollY, moved = 0;
    addEventListener("scroll", () => {
      const y = scrollY, d = y - lastY; lastY = y;
      moved = Math.sign(d) === Math.sign(moved) ? moved + d : d;
      if (y < 40 || moved < -18) document.body.classList.remove("dock-away");
      else if (moved > 28) document.body.classList.add("dock-away");
    }, { passive: true });
    addEventListener("popstate", () => document.body.classList.remove("dock-away"));
    document.addEventListener("click", (e) => { if (e.target.closest("a[href]")) document.body.classList.remove("dock-away"); });
  }
  startRouter();

  loadUnread();

  // Keep "5m / 3h" times fresh
  setInterval(() => {
    document.querySelectorAll("time[datetime]").forEach((t) => (t.textContent = timeAgo(t.getAttribute("datetime"))));
    document.querySelectorAll("[data-presence-text]:not(.online)").forEach((el) => (el.textContent = lastSeenText(false, el.dataset.lastSeen || null)));
  }, 60000);
})();
