/* =========================================================
   LookBlog home: feed, composer, likes, profiles, follows.
   All user text is inserted with textContent, never as HTML.
   ========================================================= */

const $ = (id) => document.getElementById(id);
const POST_MAX = 500;

let me = null;
let scope = "following";
let route = { name: "home" };

/* ---------- Server ---------- */
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...options,
    });
  } catch {
    throw { error: "Can’t reach the server. Check that it’s running." };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.assign("/"); // session ended: back to the log in page
    throw data;
  }
  if (!res.ok) throw data;
  return data;
}

/* ---------- Small DOM helper ---------- */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}
function svg(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim(); // static icons only, never user text
  return t.content.firstChild;
}
const ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-8.6C1.3 8.4 3 5 6.4 5c2.1 0 3.5 1.2 4.4 2.6l1.2 1.7 1.2-1.7C14.1 6.2 15.5 5 17.6 5 21 5 22.7 8.4 21.2 11.4 19 15.6 12 20 12 20z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

/* ---------- Avatars, names, time ---------- */
function initials(name) {
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}
function avatarClass(username) {
  let n = 0;
  for (const ch of String(username)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return ["", "alt-1", "alt-2", "alt-3"][n % 4];
}
function fillAvatar(el, user) {
  el.textContent = initials(user.name);
  el.className = `avatar ${avatarClass(user.username)} ${el.classList.contains("avatar-xl") ? "avatar-xl" : ""}`.trim();
}
function avatar(user, extra = "") {
  return h("span", { class: `avatar ${avatarClass(user.username)} ${extra}`.trim(), text: initials(user.name), "aria-hidden": "true" });
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 7 * 86400) return Math.floor(s / 86400) + "d";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

/* ---------- Rendering posts ---------- */
function postEl(p, isNew = false) {
  const profileHref = `#/u/${encodeURIComponent(p.author.username)}`;

  const likeBtn = h("button", {
    class: "act act-like" + (p.liked ? " liked" : ""),
    "aria-pressed": String(p.liked),
    "aria-label": p.liked ? "Unlike" : "Like",
  }, svg(ICON_HEART), h("span", { text: p.likeCount ? String(p.likeCount) : "" }));
  likeBtn.addEventListener("click", () => toggleLike(p, likeBtn));

  const actions = h("div", { class: "post-actions" }, likeBtn);
  if (p.mine) {
    const del = h("button", { class: "act act-delete", "aria-label": "Delete post" }, svg(ICON_TRASH));
    del.addEventListener("click", () => deletePost(p, del));
    actions.append(del);
  }

  const time = new Date(p.createdAt);
  return h("article", { class: "post" + (isNew ? " new" : ""), "data-id": p.id },
    h("a", { href: profileHref, tabindex: "-1" }, avatar(p.author)),
    h("div", { class: "post-body" },
      h("div", { class: "post-head" },
        h("a", { class: "name", href: profileHref, text: p.author.name }),
        h("span", { class: "muted", text: "@" + p.author.username }),
        h("span", { class: "muted", text: "·" }),
        h("time", { class: "muted", datetime: p.createdAt, title: time.toLocaleString("en-US"), text: timeAgo(p.createdAt) })
      ),
      h("p", { class: "post-text", text: p.text }),
      actions
    )
  );
}

function renderPosts(list, emptyState) {
  const feed = $("feed");
  feed.replaceChildren();
  if (!list.length) return feed.append(emptyState);
  feed.append(...list.map((p) => postEl(p)));
}

function emptyEl(title, text, button) {
  return h("div", { class: "empty" }, h("h3", { text: title }), h("p", { text }), button || null);
}

function showLoading() {
  $("feed").replaceChildren(h("div", { class: "loading" }, h("div", { class: "spinner", "aria-label": "Loading" })));
}

/* ---------- Likes and deleting ---------- */
async function toggleLike(p, btn) {
  // Update right away, then confirm with the server
  p.liked = !p.liked;
  p.likeCount += p.liked ? 1 : -1;
  paintLike(btn, p);
  if (p.liked) {
    btn.classList.remove("pop");
    void btn.offsetWidth;
    btn.classList.add("pop");
  }
  try {
    const r = await api(`/api/posts/${p.id}/like`, { method: "POST" });
    p.liked = r.liked;
    p.likeCount = r.likeCount;
    paintLike(btn, p);
  } catch (err) {
    p.liked = !p.liked;
    p.likeCount += p.liked ? 1 : -1;
    paintLike(btn, p);
    toast(err.error || "Couldn’t like that. Try again.");
  }
}
function paintLike(btn, p) {
  btn.classList.toggle("liked", p.liked);
  btn.setAttribute("aria-pressed", String(p.liked));
  btn.setAttribute("aria-label", p.liked ? "Unlike" : "Like");
  btn.querySelector("span").textContent = p.likeCount ? String(p.likeCount) : "";
}

async function deletePost(p, btn) {
  // Two-step delete: first click asks, second click deletes
  if (!btn.classList.contains("confirm")) {
    btn.classList.add("confirm");
    btn.append(h("span", { text: "Delete?" }));
    setTimeout(() => {
      btn.classList.remove("confirm");
      btn.querySelector("span")?.remove();
    }, 3000);
    return;
  }
  try {
    await api(`/api/posts/${p.id}`, { method: "DELETE" });
    document.querySelector(`.post[data-id="${CSS.escape(p.id)}"]`)?.remove();
    toast("Post deleted.");
    if (route.name === "profile") loadProfile(route.username, false);
  } catch (err) {
    toast(err.error || "Couldn’t delete that.");
  }
}

/* ---------- Composer ---------- */
const textarea = $("composerText");
const counter = $("counter");
const postBtn = $("postBtn");

function updateComposer() {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
  const len = [...textarea.value].length;
  const left = POST_MAX - len;
  counter.textContent = left <= 60 ? String(left) : "";
  counter.className = "counter" + (left < 0 ? " over" : left <= 20 ? " warn" : "");
  postBtn.disabled = !textarea.value.trim() || left < 0;
}
textarea.addEventListener("input", updateComposer);
textarea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("composer").requestSubmit();
});

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (postBtn.disabled) return;
  const err = $("composerError");
  err.hidden = true;
  postBtn.disabled = true;
  postBtn.textContent = "Posting…";
  try {
    const { post } = await api("/api/posts", { method: "POST", body: JSON.stringify({ text: textarea.value }) });
    textarea.value = "";
    updateComposer();
    const feed = $("feed");
    feed.querySelector(".empty")?.remove();
    feed.prepend(postEl(post, true));
  } catch (ex) {
    err.textContent = ex.error || "Couldn’t post that. Try again.";
    err.hidden = false;
  } finally {
    postBtn.textContent = "Post";
    updateComposer();
  }
});

$("postCta").addEventListener("click", () => {
  if (route.name !== "home") location.hash = "#/";
  setTimeout(() => textarea.focus(), 50);
});

/* ---------- Feed ---------- */
async function loadFeed() {
  showLoading();
  try {
    const { posts } = await api(`/api/feed?scope=${scope}`);
    if (route.name !== "home") return;
    const empty = scope === "following"
      ? emptyEl("Your feed is quiet.", "Posts from you and the people you follow show up here. Follow someone, or see what everyone is writing.",
          h("button", { class: "btn btn-primary btn-sm", text: "See everyone", onclick: () => setScope("everyone") }))
      : emptyEl("Nothing here yet.", "Nobody has posted so far. Write the first post on Look Blog.");
    renderPosts(posts, empty);
  } catch (err) {
    $("feed").replaceChildren(emptyEl("Couldn’t load posts.", err.error || "Try again in a moment."));
  }
}

function setScope(s) {
  scope = s;
  try { localStorage.setItem("lb_scope", s); } catch {}
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.scope === s;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  loadFeed();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setScope(t.dataset.scope)));

/* ---------- Profile ---------- */
function paintFollowBtn(btn, profile) {
  btn.hidden = profile.isMe;
  btn.className = "btn btn-sm " + (profile.isFollowing ? "btn-following" : "btn-follow");
  btn.textContent = profile.isFollowing ? "Following" : "Follow";
  btn.onmouseenter = () => { if (profile.isFollowing) btn.textContent = "Unfollow"; };
  btn.onmouseleave = () => { btn.textContent = profile.isFollowing ? "Following" : "Follow"; };
}

async function follow(username) {
  const { profile } = await api(`/api/users/${encodeURIComponent(username)}/follow`, { method: "POST" });
  return profile;
}

async function loadProfile(username, withSpinner = true) {
  if (withSpinner) showLoading();
  try {
    const { profile, posts } = await api(`/api/users/${encodeURIComponent(username)}`);
    if (route.name !== "profile" || route.username !== username) return;
    $("columnTitle").textContent = profile.name;
    fillAvatar($("pAvatar"), profile);
    $("pName").textContent = profile.name;
    $("pHandle").textContent = "@" + profile.username;
    $("pJoined").textContent = "Joined " + new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    $("pFollowing").textContent = profile.following;
    $("pFollowers").textContent = profile.followers;
    $("pPosts").textContent = profile.posts;

    const btn = $("followBtn");
    paintFollowBtn(btn, profile);
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const p = await follow(profile.username);
        Object.assign(profile, p);
        paintFollowBtn(btn, profile);
        $("pFollowers").textContent = profile.followers;
        loadSuggestions();
      } catch (err) {
        toast(err.error || "Something went wrong.");
      } finally {
        btn.disabled = false;
      }
    };
    $("profile").hidden = false;

    renderPosts(posts, emptyEl(
      profile.isMe ? "You haven’t posted yet." : `@${profile.username} hasn’t posted yet.`,
      profile.isMe ? "Your posts will show up here." : "When they do, their posts will show up here."
    ));
  } catch (err) {
    $("profile").hidden = true;
    $("columnTitle").textContent = "Profile";
    $("feed").replaceChildren(emptyEl("This account doesn’t exist.", "Check the username and try again."));
  }
}

/* ---------- Who to follow ---------- */
async function loadSuggestions() {
  const box = $("suggestions");
  try {
    const { users } = await api("/api/users/suggestions");
    box.replaceChildren();
    if (!users.length) {
      box.append(h("p", { class: "side-empty", text: "You’re following everyone here. Invite a friend to Look Blog." }));
      return;
    }
    for (const u of users) {
      const href = `#/u/${encodeURIComponent(u.username)}`;
      const btn = h("button", { class: "btn btn-follow", text: "Follow" });
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await follow(u.username);
          toast(`You’re following @${u.username}.`);
          loadSuggestions();
          if (route.name === "home" && scope === "following") loadFeed();
        } catch (err) {
          toast(err.error || "Something went wrong.");
          btn.disabled = false;
        }
      });
      box.append(h("div", { class: "suggestion" },
        h("a", { href, tabindex: "-1" }, avatar(u)),
        h("div", { class: "who" }, h("a", { href, text: u.name }), h("span", { text: "@" + u.username })),
        btn
      ));
    }
  } catch {
    box.replaceChildren(h("p", { class: "side-empty", text: "Couldn’t load suggestions." }));
  }
}

/* ---------- Routing: #/ is home, #/u/name is a profile ---------- */
function onRoute() {
  const m = location.hash.match(/^#\/u\/([^/]+)/);
  route = m ? { name: "profile", username: decodeURIComponent(m[1]) } : { name: "home" };
  const isHome = route.name === "home";
  const isMyProfile = !isHome && me && route.username.toLowerCase() === me.username.toLowerCase();

  $("tabs").hidden = !isHome;
  $("composer").hidden = !isHome;
  $("backBtn").hidden = isHome;
  $("profile").hidden = true;
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.remove("active"));
  document.querySelector(`.nav-link[data-nav="${isHome ? "home" : isMyProfile ? "profile" : "x"}"]`)?.classList.add("active");
  window.scrollTo(0, 0);

  if (isHome) {
    $("columnTitle").textContent = "Home";
    document.title = "Home / Look Blog";
    setScope(scope);
  } else {
    $("columnTitle").textContent = "Profile";
    document.title = `@${route.username} / Look Blog`;
    loadProfile(route.username);
  }
}
window.addEventListener("hashchange", onRoute);
$("backBtn").addEventListener("click", () => (history.length > 1 ? history.back() : (location.hash = "#/")));

/* ---------- Log out ---------- */
$("logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.assign("/");
});

/* ---------- Start ---------- */
(async function start() {
  try {
    const { user } = await api("/api/me");
    me = user;
  } catch {
    return; // api() already sent us to the log in page
  }
  fillAvatar($("meAvatar"), me);
  fillAvatar($("composerAvatar"), me);
  $("meName").textContent = me.name;
  $("meHandle").textContent = "@" + me.username;
  $("navProfile").href = `#/u/${encodeURIComponent(me.username)}`;

  try {
    const saved = localStorage.getItem("lb_scope");
    if (saved === "everyone" || saved === "following") scope = saved;
  } catch {}

  updateComposer();
  onRoute();
  loadSuggestions();

  // Keep "2m / 3h" times fresh
  setInterval(() => {
    document.querySelectorAll(".post time").forEach((t) => (t.textContent = timeAgo(t.getAttribute("datetime"))));
  }, 60000);
})();
