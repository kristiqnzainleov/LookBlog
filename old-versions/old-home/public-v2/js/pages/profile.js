// /u/:username — someone's page: banner, photo, bio, follower counts (live) and their posts.
import { h, icon, avatar, count, empty, toast, duration } from "../ui.js";
import { api } from "../api.js";
import { state, on, emit } from "../state.js";
import { postCard, pagedList } from "../components/post.js";
import { openEditProfile } from "../components/edit-profile.js";
import { openConnections } from "../components/connections.js";
import { isMe, postHref } from "../router.js";

/* ---------- Follow button (used on profiles, shorts, search, suggestions) ---------- */
export function followButton(username, isFollowing = null, { small = false, onChange } = {}) {
  const btn = h("button", { class: "btn " + (small ? "btn-xs" : "btn-sm") });
  let following = Boolean(isFollowing);
  const paint = () => {
    btn.className = "btn " + (small ? "btn-xs " : "btn-sm ") + (following ? "btn-following" : "btn-follow");
    btn.textContent = following ? "Following" : "Follow";
    btn.setAttribute("aria-pressed", String(following));
  };
  // When we don't know yet, ask the server
  if (isFollowing === null) {
    following = false;
    api(`/api/users/${encodeURIComponent(username)}`).then(({ profile }) => { following = profile.isFollowing; paint(); }).catch(() => {});
  }
  btn.addEventListener("mouseenter", () => { if (following) btn.textContent = "Unfollow"; });
  btn.addEventListener("mouseleave", paint);
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.disabled = true;
    try {
      const { profile } = await api(`/api/users/${encodeURIComponent(username)}/follow`, { method: "POST" });
      following = profile.isFollowing;
      const ids = state.me.following || (state.me.following = []);
      const i = ids.indexOf(profile.id);
      if (following && i === -1) ids.push(profile.id);
      if (!following && i !== -1) ids.splice(i, 1);
      if (following) toast(`You’re following @${profile.username}.`);
      emit("following:changed", { username: profile.username, following });
      onChange?.(profile);
    } catch (err) {
      toast(err.error || "Something went wrong.");
    }
    btn.disabled = false;
    paint();
  });
  // Stay in sync with other follow buttons for the same person
  const off = on("following:changed", (ev) => {
    if (!btn.isConnected) return off(); // the button left the page
    if (ev.username.toLowerCase() === username.toLowerCase() && ev.following !== following) { following = ev.following; paint(); }
  });
  paint();
  return btn;
}

/* ---------- Grids for a profile's shorts and videos ---------- */
function shortTile(p) {
  const m = p.media[0];
  return h("a", { class: "short-tile", href: `/shorts?id=${encodeURIComponent(p.id)}` },
    m.poster ? h("img", { src: m.poster, alt: "", loading: "lazy" }) : h("video", { src: m.url, muted: true, preload: "metadata" }),
    h("span", { class: "tile-views" }, icon("eye"), h("span", { dataset: { postId: p.id, stat: "views" }, text: count(p.views) }))
  );
}
export function videoTile(p) {
  const m = p.media[0];
  return h("a", { class: "video-tile", href: postHref(p.id) },
    h("div", { class: "thumb" },
      m.poster ? h("img", { src: m.poster, alt: "", loading: "lazy" }) : h("div", { class: "thumb-empty" }, icon("play")),
      m.duration ? h("span", { class: "thumb-time", text: duration(m.duration) }) : null
    ),
    h("div", { class: "tile-text" },
      h("h3", { text: p.title }),
      h("p", { class: "muted" },
        h("span", { dataset: { postId: p.id, stat: "views" }, text: count(p.views) }),
        p.views === 1 ? " view · " : " views · ",
        new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      )
    )
  );
}

export async function profilePage(view, m) {
  const username = decodeURIComponent(m[1]);
  view.classList.add("page-profile");
  const back = h("button", { class: "icon-btn", "aria-label": "Back", onclick: () => (history.length > 1 ? history.back() : null) }, icon("back"));
  const title = h("h1", { text: "Profile" });
  const sub = h("span", { class: "head-sub" });
  view.append(h("header", { class: "column-head" }, h("div", { class: "head-row" }, back, h("div", { class: "head-text" }, title, sub))));
  const body = h("div");
  view.append(body);

  let profile;
  try {
    ({ profile } = await api(`/api/users/${encodeURIComponent(username)}`));
  } catch (err) {
    body.append(empty("This account doesn’t exist.", "Check the username and try again."));
    return;
  }
  document.title = `${profile.name} (@${profile.username}) / Look Blog`;
  title.textContent = profile.name;
  const postsCount = h("b", { text: count(profile.posts) });
  sub.textContent = profile.posts === 1 ? "1 post" : `${count(profile.posts)} posts`;

  const banner = h("div", { class: "profile-banner" + (profile.banner ? "" : " empty") });
  if (profile.banner) banner.style.backgroundImage = `url("${profile.banner}")`;

  const followersEl = h("b", { dataset: { followers: profile.username }, text: count(profile.followers) });
  const followingEl = h("b", { dataset: { following: profile.username }, text: count(profile.following) });

  const actionBtn = profile.isMe
    ? h("button", { class: "btn btn-sm btn-outline-light", text: "Edit profile", onclick: openEditProfile })
    : followButton(profile.username, profile.isFollowing, {
        onChange: (p) => { followersEl.textContent = count(p.followers); },
      });

  const bioEl = h("p", { class: "bio", text: profile.bio || "" });
  bioEl.hidden = !profile.bio;
  const AVATAR = matchMedia("(max-width: 640px)").matches ? 104 : 144;
  const avatarWrap = h("div", { class: "profile-avatar" }, avatar(profile, AVATAR));
  const nameEl = h("h2", { text: profile.name });

  body.append(h("section", { class: "profile" },
    banner,
    h("div", { class: "profile-top" }, avatarWrap, actionBtn),
    nameEl,
    h("p", { class: "handle", text: "@" + profile.username }),
    bioEl,
    h("p", { class: "joined" }, icon("calendar"), "Joined " + new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })),
    h("p", { class: "stats" },
      h("button", { class: "stat-btn", onclick: () => openConnections(profile, "following") }, followingEl, " Following"),
      h("button", { class: "stat-btn", onclick: () => openConnections(profile, "followers") }, followersEl, " Followers"),
      h("span", {}, postsCount, profile.posts === 1 ? " Post" : " Posts"),
      h("span", {}, h("b", { text: count(profile.reposts) }), profile.reposts === 1 ? " Repost" : " Reposts")
    )
  ));

  /* Tabs: Posts | Shorts | Videos */
  const tabs = h("div", { class: "tabs profile-tabs", role: "tablist" });
  const list = h("div");
  body.append(tabs, list);
  let pager;
  const kinds = [["post", "Posts"], ["repost", "Reposts"], ["short", "Shorts"], ["video", "Videos"]];
  function show(type) {
    pager?.stop();
    tabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.type === type));
    list.replaceChildren();
    const container = h("div", { class: type === "short" ? "short-grid" : type === "video" ? "video-grid" : "feed" });
    list.append(container);
    const nothing = {
      post: profile.isMe ? ["You haven’t posted yet.", "Your posts will show up here."] : [`@${profile.username} hasn’t posted yet.`, "When they do, their posts will show up here."],
      short: profile.isMe ? ["No shorts yet.", "Vertical videos up to 90 seconds you post show up here."] : ["No shorts yet.", ""],
      video: profile.isMe ? ["No videos yet.", "Longer videos you post show up here."] : ["No videos yet.", ""],
      repost: profile.isMe ? ["You haven’t reposted anything yet.", "Tap the repost button under a post to share it with your followers."] : [`@${profile.username} hasn’t reposted anything yet.`, ""],
    }[type];
    pager = pagedList({
      container,
      load: (before) => api(`/api/users/${encodeURIComponent(profile.username)}/posts?type=${type}${before ? "&before=" + encodeURIComponent(before) : ""}`),
      render: (p) => (type === "short" ? shortTile(p) : type === "video" ? videoTile(p) : postCard(p, { onDeleted: () => (postsCount.textContent = count(--profile.posts)) })),
      emptyEl: () => empty(nothing[0], nothing[1]),
    });
  }
  for (const [type, label] of kinds) {
    tabs.append(h("button", { class: "tab", role: "tab", text: label, dataset: { type }, onclick: () => show(type) }));
  }
  show("post");

  // My own profile updates right after "Edit profile"
  const offMe = on("me:updated", (me) => {
    if (!profile.isMe) return;
    Object.assign(profile, { name: me.name, bio: me.bio, avatar: me.avatar, banner: me.banner });
    title.textContent = nameEl.textContent = me.name;
    bioEl.textContent = me.bio;
    bioEl.hidden = !me.bio;
    avatarWrap.replaceChildren(avatar(profile, AVATAR));
    banner.style.backgroundImage = me.banner ? `url("${me.banner}")` : "";
    banner.classList.toggle("empty", !me.banner);
  });
  // Someone else's profile changed while we look at it
  const offProfile = on("profile", (ev) => {
    if (profile.isMe || ev.username !== profile.username) return;
    Object.assign(profile, ev);
    title.textContent = nameEl.textContent = ev.name;
    bioEl.textContent = ev.bio;
    bioEl.hidden = !ev.bio;
    avatarWrap.replaceChildren(avatar(profile, AVATAR));
    banner.style.backgroundImage = ev.banner ? `url("${ev.banner}")` : "";
    banner.classList.toggle("empty", !ev.banner);
  });

  return () => { pager?.stop(); offMe(); offProfile(); };
}
profilePage.navName = (m) => (isMe(decodeURIComponent(m[1])) ? "profile" : "");
