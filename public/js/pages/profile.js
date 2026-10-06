// /u/:username — someone's page: banner, photo, bio, follower counts (live) and their posts.
import { h, icon, avatar, count, empty, toast, duration, spinner, presenceDot, presenceText, tick, modal, confirmClick, richText } from "../ui.js";
import { attachMentions } from "../components/mentions.js";
import { openPrivacy } from "../components/privacy.js";
import { openReportUser } from "../components/report.js";
import { api, upload } from "../api.js";
import { state, on, emit } from "../state.js";
import { postCard, pagedList } from "../components/post.js";
import { openConnections } from "../components/connections.js";
import { playlistCard, openPlaylistForm, openSaveToPlaylist } from "../components/playlists.js";
import { createCard } from "../components/composer.js";
import { openCropper } from "../components/cropper.js";
import { openBadges, badgeIcon, specialStyle } from "../components/badges.js";
import { openUserStories, addStory } from "../components/stories.js";
import { openVideoModal } from "../components/video-modal.js";
import { visibilityBadge } from "../components/visibility.js";
import { isMe, postHref, navigate } from "../router.js";
import { watchHref, trackImpression } from "../components/post.js";
import { songList, playSongs, openUploadSong, albumCard, openAlbumForm } from "../components/music.js";

/* ---------- Follow button (used on profiles, shorts, search, suggestions) ---------- */
export function followButton(username, isFollowing = null, { small = false, onChange, requested: req = false } = {}) {
  const btn = h("button", { class: "btn " + (small ? "btn-xs" : "btn-sm") });
  let following = Boolean(isFollowing), requested = Boolean(req);
  const paint = () => {
    btn.className = "btn " + (small ? "btn-xs " : "btn-sm ") + (following || requested ? "btn-following" : "btn-follow");
    btn.textContent = following ? "Following" : requested ? "Requested" : "Follow";
    btn.setAttribute("aria-pressed", String(following));
  };
  // When we don't know yet, ask the server
  if (isFollowing === null) {
    following = false;
    api(`/api/users/${encodeURIComponent(username)}`).then(({ profile }) => { following = profile.isFollowing; requested = profile.requested; paint(); }).catch(() => {});
  }
  btn.addEventListener("mouseenter", () => { if (following) btn.textContent = "Unfollow"; else if (requested) btn.textContent = "Cancel request"; });
  btn.addEventListener("mouseleave", paint);
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.disabled = true;
    try {
      const { profile } = await api(`/api/users/${encodeURIComponent(username)}/follow`, { method: "POST" });
      following = profile.isFollowing;
      const wasRequested = requested;
      requested = profile.requested;
      if (requested && !wasRequested) toast(`Request sent. @${profile.username} has a private account.`);
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
// Your own video, short or stream: a trash button on the thumbnail (click twice to delete)
function deleteTileButton(p, tile) {
  const what = p.stream ? "Stream" : p.type === "short" ? "Short" : "Video";
  const del = h("button", { type: "button", class: "tile-del", title: `Delete this ${what.toLowerCase()}`, "aria-label": "Delete" }, icon("trash"));
  confirmClick(del, "Delete?", async () => {
    try { await api(`/api/posts/${p.id}`, { method: "DELETE" }); tile.remove(); toast(`${what} deleted.`); }
    catch (err) { toast(err.error || "Couldn’t delete it."); }
  });
  return del;
}
function shortTile(p, { inPlace = false } = {}) {
  const m = p.media[0];
  const tile = h("a", { class: "short-tile", href: `/shorts?id=${encodeURIComponent(p.id)}` },
    m.poster ? h("img", { src: m.poster, alt: "", loading: "lazy", "data-thumb-for": p.id }) : h("video", { src: m.url, muted: true, preload: "metadata" }),
    h("span", { class: "tile-views" }, icon("eye"), h("span", { dataset: { postId: p.id, stat: "views" }, text: count(p.views) }))
  );
  trackImpression(tile, p.id);
  if (p.mine) tile.append(deleteTileButton(p, tile));
  const badge = visibilityBadge(p);
  if (badge) tile.append(badge);
  if (inPlace) tile.addEventListener("click", (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); e.stopPropagation(); openVideoModal(p); });
  return tile;
}
export function videoTile(p, { inPlace = false } = {}) {
  const m = p.media[0];
  const tile = h("a", { class: "video-tile", href: watchHref(p.id) },
    h("div", { class: "thumb" },
      m.poster ? h("img", { src: m.poster, alt: "", loading: "lazy", "data-thumb-for": p.id }) : h("div", { class: "thumb-empty" }, icon("play")),
      m.duration ? h("span", { class: "thumb-time", text: duration(m.duration) }) : null,
      // Save to a playlist straight from the thumbnail
      p.film || p.episode ? null : (() => { const b = h("button", { type: "button", class: "tile-save", title: "Save to playlist", "aria-label": "Save to playlist" }, icon("playlist")); b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openSaveToPlaylist(p); }); return b; })()
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
  trackImpression(tile, p.id);
  if (p.mine) tile.querySelector(".thumb").append(deleteTileButton(p, tile));
  if (p.stream) tile.querySelector(".thumb").append(h("span", { class: "past-live", text: "🔴 PAST LIVE" }));
  const badge = visibilityBadge(p);
  if (badge) tile.querySelector(".thumb").append(badge);
  if (inPlace) tile.addEventListener("click", (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); e.stopPropagation(); openVideoModal(p); });
  return tile;
}

export async function profilePage(view, m, params) {
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
  // Counts live in the tabs below (Posts 12 · Shorts 2 · Videos 3)
  const tabCount = { post: profile.textPosts ?? profile.posts, short: profile.shorts || 0, video: profile.videos || 0, series: profile.series || 0, movie: profile.movies || 0, song: profile.songs || 0 };
  const postsCount = h("span", { class: "tab-n", text: count(tabCount.post) });
  const shortsCount = h("span", { class: "tab-n", text: count(tabCount.short) });
  const videosCount = h("span", { class: "tab-n", text: count(tabCount.video) });
  const countEl = { post: postsCount, short: shortsCount, video: videosCount,
    series: h("span", { class: "tab-n", text: count(tabCount.series) }), movie: h("span", { class: "tab-n", text: count(tabCount.movie) }), song: h("span", { class: "tab-n", text: count(tabCount.song) }) };
  sub.textContent = "";

  const banner = h("div", { class: "profile-banner" + (profile.banner ? "" : " empty") });
  if (profile.banner) banner.style.backgroundImage = `url("${profile.banner}")`;

  const followersEl = h("b", { dataset: { followers: profile.username }, text: count(profile.followers) });
  const followingEl = h("b", { dataset: { following: profile.username }, text: count(profile.following) });

  // Message works when you follow each other
  const messageBtn = h("button", { class: "btn btn-sm btn-outline-light" }, icon("chat"), h("span", { text: "Message" }));
  const paintMessage = () => (messageBtn.hidden = profile.isMe || !(profile.isFollowing && profile.followsYou));
  messageBtn.addEventListener("click", async () => {
    try {
      const { chat } = await api(`/api/dm/${encodeURIComponent(profile.username)}`, { method: "POST" });
      navigate(`/messages/${chat.id}`);
    } catch (err) { toast(err.error || "Couldn’t open the chat."); }
  });
  paintMessage();

  // Bell: get a notification whenever they post (only while following)
  const bellBtn = h("button", { class: "btn btn-sm btn-outline-light bell-btn" });
  const paintBell = () => {
    bellBtn.hidden = profile.isMe || !profile.isFollowing;
    bellBtn.classList.toggle("on", Boolean(profile.bell));
    bellBtn.replaceChildren(icon(profile.bell ? "bell" : "bellOff"));
    bellBtn.title = profile.bell ? "You’ll get a notification when they post. Click to turn off." : "Get a notification when they post";
    bellBtn.setAttribute("aria-label", bellBtn.title);
    bellBtn.setAttribute("aria-pressed", String(Boolean(profile.bell)));
  };
  bellBtn.addEventListener("click", async () => {
    bellBtn.disabled = true;
    try {
      const { profile: p } = await api(`/api/users/${encodeURIComponent(profile.username)}/bell`, { method: "POST", body: { on: !profile.bell } });
      profile.bell = p.bell;
      if (p.bell) {
        bellBtn.classList.remove("ring"); void bellBtn.offsetWidth; bellBtn.classList.add("ring");
        toast(`You’ll be notified when ${profile.name} posts.`);
      } else toast(`No more post notifications from ${profile.name}.`);
    } catch (err) { toast(err.error || "Couldn’t change that."); }
    bellBtn.disabled = false;
    paintBell();
  });
  paintBell();

  const actionBtn = profile.isMe
    ? null
    : followButton(profile.username, profile.isFollowing, {
        requested: profile.requested,
        onChange: (p) => {
          followersEl.textContent = count(p.followers);
          profile.isFollowing = p.isFollowing;
          profile.bell = p.bell;
          paintMessage();
          paintBell();
        },
      });

  /* More: block / unblock (other people) · requests and privacy (me) */
  const moreBtn = h("button", { class: "icon-btn profile-more", title: "More", "aria-label": "More" }, h("span", { class: "dots", text: "⋯" }));
  moreBtn.addEventListener("click", () => {
    if (profile.isMe) {
      // My own profile: settings in one place
      const item = (ic, label, fn) => { const b = h("button", { type: "button", class: "btn btn-full btn-outline-light me-opt" }, h("span", { text: ic }), h("span", { text: label })); b.addEventListener("click", () => { mm.close(); fn(); }); return b; };
      const mm = modal({ title: "Settings", body: h("div", { class: "create-form" },
        item("🎨", "Customize profile", () => customize()),
        item("🌐", "Language", () => import("../i18n.js").then((x) => x.openLanguage())),
        item("🔒", "Privacy & blocking", openPrivacy),
        item("❓", "Help", () => import("../components/help.js").then((x) => x.openHelp()))) });
      return;
    }
    const blockBtn = h("button", { type: "button", class: "btn btn-full " + (profile.blocked ? "btn-outline-light" : "btn-danger"), text: profile.blocked ? `Unblock @${profile.username}` : `Block @${profile.username}` });
    const reportBtn = h("button", { type: "button", class: "btn btn-full btn-outline-light" }, icon("flag"), h("span", { text: `Report @${profile.username}` }));
    reportBtn.addEventListener("click", () => { m.close(); openReportUser(profile, { onBlocked: () => location.reload() }); });
    const m = modal({ title: `@${profile.username}`, body: h("div", { class: "create-form" },
      reportBtn,
      h("p", { class: "create-hint", text: profile.blocked
        ? "They’ll be able to see your posts and follow you again."
        : "They won’t be able to see your profile or posts, follow you, message you or tag you. Following ends both ways. They won’t be told." }),
      blockBtn) });
    blockBtn.addEventListener("click", async () => {
      try {
        await api(`/api/users/${encodeURIComponent(profile.username)}/block`, { method: "POST", body: { on: !profile.blocked } });
        m.close();
        toast(profile.blocked ? `@${profile.username} is unblocked.` : `@${profile.username} is blocked.`);
        location.reload();
      } catch (err) { toast(err.error || "Couldn’t do that."); }
    });
  });
  const requestsBtn = profile.isMe && profile.requests ? h("button", { class: "btn btn-sm btn-primary", onclick: () => openPrivacy() }, h("span", { text: `Follow requests · ${profile.requests}` })) : null;

  const bioEl = h("p", { class: "bio" });
  const bioWrap = h("div", { class: "bio-wrap" }, bioEl);
  function paintBio() {
    if (profile.isMe) {
      bioEl.replaceChildren(profile.bio ? richText(profile.bio, profile.bioMentions) : "No bio");
      bioEl.classList.toggle("bio-empty", !profile.bio);
      bioEl.hidden = false;
    } else {
      bioEl.replaceChildren(richText(profile.bio || "", profile.bioMentions));
      bioEl.hidden = !profile.bio;
    }
  }
  paintBio();

  /* My own profile: click the bio to write it right here */
  if (profile.isMe) {
    bioEl.classList.add("editable");
    bioEl.tabIndex = 0;
    bioEl.setAttribute("role", "button");
    bioEl.title = "Click to edit your bio";
    const startEdit = () => {
      if (bioWrap.querySelector("form")) return;
      const input = h("textarea", { class: "text-input bio-input", rows: 3, maxlength: 200, placeholder: "Tell people a little about yourself" });
      input.value = profile.bio || "";
      attachMentions(input);
      const counter = h("span", { class: "counter" });
      const paintCount = () => {
        const n = [...input.value].length;
        counter.textContent = `${n} / 160`;
        counter.className = "counter" + (n > 160 ? " over" : "");
        save.disabled = n > 160;
      };
      const save = h("button", { type: "submit", class: "btn btn-primary btn-xs", text: "Save" });
      const cancel = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Cancel" });
      const err = h("p", { class: "form-error", role: "alert", hidden: true });
      const form = h("form", { class: "bio-form", novalidate: true }, input, h("div", { class: "bio-bar" }, counter, cancel, save), err);
      const stop = () => { form.remove(); bioEl.hidden = false; paintBio(); };
      cancel.addEventListener("click", stop);
      input.addEventListener("input", paintCount);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.stopPropagation(); stop(); }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit();
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        save.disabled = true;
        save.textContent = "Saving…";
        try {
          const p2 = await saveProfile({ bio: input.value });
          stop();
          toast(p2.bio ? "Bio saved." : "Bio removed.");
        } catch (ex) {
          err.textContent = ex.errors?.bio || ex.error || "Couldn’t save your bio.";
          err.hidden = false;
          save.disabled = false;
          save.textContent = "Save";
        }
      });
      bioEl.hidden = true;
      bioWrap.append(form);
      paintCount();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    };
    bioEl.addEventListener("click", (e) => { if (!e.target.closest("a")) startEdit(); });
    bioEl.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(); } });
  }
  const AVATAR = matchMedia("(max-width: 640px)").matches ? 104 : 144;
  const avatarWrap = h("div", { class: "profile-avatar" }, avatar({ ...profile, live: profile.liveNow }, AVATAR));
  paintAccent();
  // Streaming right now: a big red "LIVE — Watch" button under the name
  const liveBtn = h("a", { class: "pf-live-btn", hidden: !profile.liveNow, href: profile.liveNow ? `/live/${profile.liveNow}` : "#" }, h("span", { text: "🔴 LIVE NOW" }), h("span", { text: profile.isMe ? "· Open your stream" : "· Watch" }));
  on("stream:state", (ev) => {
    if (ev.username !== profile.username || !liveBtn.isConnected) return;
    profile.liveNow = ev.live ? ev.streamId : null;
    liveBtn.hidden = !ev.live;
    if (ev.live) liveBtn.href = `/live/${ev.streamId}`;
  });
  // Note above the photo (read only here; notes are added from Messages)
  function paintNote() {
    avatarWrap.querySelector(".profile-note")?.remove();
    if (!profile.note) return;
    const left = Math.max(1, Math.round((new Date(profile.note.expiresAt) - Date.now()) / 3600000));
    const bubble = h("span", { class: "note-bubble profile-note" + (profile.note.media ? " has-media" : ""), title: "Note · disappears after 24 hours" },
      profile.note.media ? h("img", { class: "nb-media", src: profile.note.media.url, alt: "" }) : null,
      profile.note.text ? h("span", { class: "nb-text", text: profile.note.text }) : null,
      profile.isMe ? h("span", { class: "nb-left", text: `${left}h left` }) : null);
    import("../components/notes.js").then(({ styleNote }) => styleNote(bubble, profile.note));
    bubble.addEventListener("click", (e) => {
      e.stopPropagation();
      // Someone else's note: reply to it (you need to follow them to see notes in Messages, same here)
      if (!profile.isMe && profile.isFollowing) import("../components/notes.js").then((m) => m.openNoteReply(profile, profile.note));
    });
    if (!profile.isMe && profile.isFollowing) { bubble.title = "Reply to this note"; bubble.classList.add("can-reply"); }
    avatarWrap.append(bubble);
  }
  paintNote();

  /* Story ring around the photo */
  const paintRing = () => {
    avatarWrap.classList.toggle("has-story", Boolean(profile.story));
    avatarWrap.classList.toggle("story-unseen", Boolean(profile.story?.unseen));
    avatarWrap.title = profile.story ? (profile.isMe ? "Watch your story" : `Watch ${profile.name}’s story`) : "";
  };
  paintRing();
  let reloadHighlights = () => {};
  const refreshStory = async () => {
    reloadHighlights();
    try { profile.story = (await api(`/api/users/${encodeURIComponent(profile.username)}`)).profile.story; paintRing(); } catch {}
  };
  if (!profile.isMe) {
    avatarWrap.addEventListener("click", () => { if (profile.story) openUserStories(profile.username, refreshStory); });
  }
  const offStoryNew = on("story:new", (ev) => { if (ev.username === profile.username) refreshStory(); });
  const offNote = on("note", async (ev) => {
    if (ev.username !== profile.username) return;
    try { profile.note = (await api(`/api/users/${encodeURIComponent(profile.username)}`)).profile.note; paintNote(); } catch {}
  });
  const nameEl = h("h2", {}, profile.name, tick(profile, 26), profile.private ? h("span", { class: "private-lock", title: "Private account", text: "🔒" }) : null);
  // Their own accent colour for the whole profile
  function paintAccent() {
    if (profile.look?.accent) view.style.setProperty("--pink", profile.look.accent); else view.style.removeProperty("--pink");
    // Ring around the photo, background, banner colours
    import("../components/profile-look.js").then(({ applyProfileLook }) => applyProfileLook({ view, avatarWrap, banner }, profile.look));
  }

  /* Role badges (Musician, Artist, …) under the name */
  const rolesEl = h("div", { class: "role-badges" });
  // Special badges: made by the LookBlog team for this one person
  const specialEl = h("div", { class: "special-badges", hidden: true });
  function paintSpecial(list) {
    specialEl.replaceChildren(...list.map((b) => h("span", { class: "special-chip", style: specialStyle(b), title: b.unique ? `Special badge · only @${profile.username} has it` : "A badge from the LookBlog team" },
      h("span", { class: "sc-emoji" + (b.image ? " has-img" : "") }, b.image ? h("img", { src: b.image, alt: "" }) : b.emoji), b.name)));
    specialEl.hidden = !list.length;
  }
  function paintRoles(list) {
    rolesEl.replaceChildren(...list.map((r) => h("span", { class: "role-chip", text: `${r.emoji} ${r.name}` })),
      ...(profile.isMe ? [h("button", { type: "button", class: "role-chip add", text: list.length ? "Edit" : "+ Add what you do" })] : []));
    rolesEl.querySelector(".add")?.addEventListener("click", () => openRolePicker());
    rolesEl.hidden = !list.length && !profile.isMe;
  }
  let allRoles = [];
  function openRolePicker() {
    let picked = new Set(profile.roles || []);
    const grid = h("div", { class: "role-grid" });
    const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save" });
    // Not in the list? Add your own
    const ownEmoji = h("input", { type: "text", class: "text-input role-own-emoji", maxlength: 8, placeholder: "✨", "aria-label": "Emoji" });
    const ownName = h("input", { type: "text", class: "text-input", maxlength: 24, placeholder: "Something else? e.g. Tattoo artist", "aria-label": "What you do" });
    const ownAdd = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Add" });
    // Adds what's typed in "Not in the list?". Returns false if it couldn't.
    const addOwn = async () => {
      if (!ownName.value.trim()) { ownName.focus(); return false; }
      ownAdd.disabled = true;
      let ok = false;
      try {
        const { role } = await api("/api/me/roles/custom", { method: "POST", body: { name: ownName.value, emoji: ownEmoji.value } });
        if (!allRoles.some((r) => r.id === role.id)) allRoles.push(role);
        if (picked.size < 3 || picked.has(role.id)) { picked.add(role.id); ok = true; } else toast("Added. Unpick one to use it, you can have up to 3.");
        ownName.value = ""; ownEmoji.value = "";
        paint();
      } catch (err) { toast(err.error || "Couldn’t add it."); }
      ownAdd.disabled = false;
      return ok;
    };
    ownAdd.addEventListener("click", addOwn);
    ownName.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addOwn(); } });
    const own = h("div", { class: "role-own" }, ownEmoji, ownName, ownAdd);
    const paint = () => grid.replaceChildren(...allRoles.map((r) => {
      const b = h("button", { type: "button", class: "role-option" + (picked.has(r.id) ? " on" : ""), text: `${r.emoji} ${r.name}` });
      b.addEventListener("click", () => {
        if (picked.has(r.id)) picked.delete(r.id);
        else if (picked.size < 3) picked.add(r.id);
        else toast("You can pick up to 3.");
        paint();
      });
      return b;
    }));
    paint();
    const m = modal({ title: "What do you do?", body: h("div", { class: "create-form" },
      h("p", { class: "create-hint", text: "Pick up to 3 badges. They show under your name so people know what you’re about." }), grid,
      h("b", { class: "vis-label", text: "Not in the list?" }), own, save) });
    save.addEventListener("click", async () => {
      // Typed your own but pressed Save straight away: add it too
      if (ownName.value.trim() && !(await addOwn())) return;
      try {
        const { roles, canMakeFilms, canMakeMusic: canMakeMusicNow } = await api("/api/me/roles", { method: "POST", body: { roles: [...picked] } });
        if (canMakeMusicNow && !state.me.canMakeMusic) toast("🎵 Songs are unlocked! Upload one from Create.");
        // Filmmaker, Film Producer, Photographer or Creator: movies and series unlock right away
        if (canMakeFilms && !state.me.canMakeFilms) toast("🎬 Movies and series are unlocked! Find them under Create.");
        state.me.canMakeFilms = canMakeFilms;
        state.me.canMakeMusic = canMakeMusicNow;
        emit("me:updated", state.me);
        profile.roles = roles.map((r) => r.id);
        paintRoles(roles);
        m.close();
        toast("Badges saved.");
      } catch (err) { toast(err.error || "Couldn’t save."); }
    });
  }

  /* Customize: name colour, font, effect, and the profile's accent colour */
  function customize() {
    import("../components/profile-look.js").then(({ openLookEditor, applyLook }) => openLookEditor((look) => {
      profile.look = look;
      applyLook(nameEl, look);
      paintAccent();
    }));
  }

  /* @username: on my profile, click it to pick a new one */
  const handleText = h("span", { class: "handle-text", text: "@" + profile.username });
  const handleEl = h("p", { class: "handle" }, handleText,
    profile.isMe ? h("span", { class: "name-pen small" }, icon("edit")) : h("span", { class: "handle-presence" }, presenceDot(profile), presenceText(profile)),
    profile.isMe ? h("button", { type: "button", class: "look-btn", onclick: (e) => { e.stopPropagation(); customize(); } }, h("span", { text: "🎨" }), h("span", { text: "Customize" })) : null,
);
  if (profile.isMe) {
    handleText.classList.add("editable");
    handleText.tabIndex = 0;
    handleText.setAttribute("role", "button");
    handleText.title = "Change your @";
    const editHandle = () => {
      if (handleEl.hidden) return;
      const input = h("input", { type: "text", class: "name-input handle-input", maxlength: 16, value: profile.username, "aria-label": "Username", spellcheck: "false", autocomplete: "off" });
      const status = h("small", { class: "handle-status" });
      const save = h("button", { type: "submit", class: "btn btn-primary btn-xs", text: "Save" });
      const cancel = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Cancel" });
      const form = h("form", { class: "name-form handle-form", novalidate: true }, h("div", { class: "handle-wrap" }, h("span", { class: "at", text: "@" }), input), h("div", { class: "bio-bar" }, status, cancel, save));
      const stop = () => { form.remove(); handleEl.hidden = false; };
      let timer;
      const check = () => {
        clearTimeout(timer);
        const v = input.value.trim().replace(/^@/, "");
        save.disabled = true;
        status.className = "handle-status";
        if (v.toLowerCase() === profile.username.toLowerCase()) { status.textContent = "That’s your @ now."; save.disabled = v === profile.username; return; }
        if (!/^[A-Za-z0-9_]{3,15}$/.test(v)) { status.textContent = "3–15 letters, numbers or _"; status.classList.add("bad"); return; }
        status.textContent = "Checking…";
        timer = setTimeout(async () => {
          try {
            const { available } = await api(`/api/username-available?u=${encodeURIComponent(v)}`);
            if (input.value.trim().replace(/^@/, "") !== v) return;
            status.textContent = available ? `@${v} is free` : "That username is taken.";
            status.classList.add(available ? "ok" : "bad");
            save.disabled = !available;
          } catch {}
        }, 300);
      };
      input.addEventListener("input", check);
      input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); stop(); } });
      cancel.addEventListener("click", stop);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (save.disabled) return;
        save.disabled = true;
        try {
          const { username } = await api("/api/me/username", { method: "POST", body: { username: input.value } });
          state.me.username = profile.username = username;
          emit("me:updated", state.me);
          toast(`You’re @${username} now.`);
          navigate(`/u/${encodeURIComponent(username)}`, { replace: true });
        } catch (ex) {
          status.textContent = ex.error || "Couldn’t change it.";
          status.className = "handle-status bad";
          save.disabled = false;
        }
      });
      handleEl.hidden = true;
      handleEl.after(form);
      check();
      input.focus();
      input.select();
    };
    handleText.addEventListener("click", editHandle);
    handleText.addEventListener("keydown", (e) => { if (e.key === "Enter") editHandle(); });
  }

  /* My own profile: change the banner, photo and name right here */
  async function saveProfile(patch) {
    const body = { name: state.me.name, bio: state.me.bio, avatar: state.me.avatar, banner: state.me.banner, ...patch };
    const { profile: p2 } = await api("/api/me/profile", { method: "POST", body });
    Object.assign(state.me, { name: p2.name, bio: p2.bio, avatar: p2.avatar, banner: p2.banner });
    Object.assign(profile, { name: p2.name, bio: p2.bio, bioMentions: p2.bioMentions, avatar: p2.avatar, banner: p2.banner });
    emit("me:updated", state.me);
    return p2;
  }

  // Pick a picture, show it at once, upload it, then save it to the profile
  // Banner and photo: pick a picture, fit it in the editor, then it uploads and saves
  function pictureEditor(target, key, label) {
    const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", hidden: true });
    const remove = h("button", { type: "button", class: "pic-remove", "aria-label": `Remove ${label}`, title: `Remove ${label}` }, icon("close"));
    target.append(input);
    const shape = key === "avatar"
      ? { aspect: 1, round: true, outWidth: 600, title: "Adjust your photo" }
      : { aspect: 3, round: false, outWidth: 1800, title: "Adjust your banner" };

    async function useBlob(blob) {
      const before = profile[key];
      profile[key] = URL.createObjectURL(blob);
      paintPictures();
      target.classList.add("uploading");
      try {
        const file = new File([blob], key + ".jpg", { type: "image/jpeg" });
        const { url } = await upload(file);
        await saveProfile({ [key]: url });
        toast(key === "banner" ? "Banner updated." : "Photo updated.");
      } catch (err) {
        profile[key] = before;
        toast(err.error || "Couldn’t change it. Try again.");
      }
      target.classList.remove("uploading");
      paintPictures();
    }
    async function edit(src) {
      const blob = await openCropper(src, shape);
      if (blob) await useBlob(blob);
    }
    async function removePic() {
      try {
        await saveProfile({ [key]: null });
        toast(key === "banner" ? "Banner removed." : "Photo removed.");
      } catch (err) { toast(err.error || "Couldn’t remove it."); }
      paintPictures();
    }

    // With a picture already there, offer a small menu; otherwise go straight to choosing one
    function open(e) {
      if (!profile[key] && key !== "avatar") return input.click();
      document.querySelector(".pic-menu")?.remove();
      const menu = h("div", { class: "pic-menu", role: "menu" });
      const item = (text, fn, cls = "") => {
        const b = h("button", { type: "button", role: "menuitem", class: cls, text });
        b.addEventListener("click", (ev) => { ev.stopPropagation(); menu.remove(); fn(); });
        menu.append(b);
      };
      if (key === "avatar" && profile.story) item("Watch your story", () => openUserStories(profile.username, refreshStory));
      if (key === "avatar") item("Add to your story", async () => { if (await addStory()) refreshStory(); });
      item("Upload a new one", () => input.click());
      if (profile[key]) {
        item("Adjust this one", () => edit(profile[key]));
        item("Remove", removePic, "danger");
      }
      document.body.append(menu);
      const r = target.getBoundingClientRect();
      const px = e?.clientX ?? r.left + r.width / 2, py = e?.clientY ?? r.top + r.height / 2;
      menu.style.left = Math.min(px, innerWidth - menu.offsetWidth - 10) + "px";
      menu.style.top = Math.min(py, innerHeight - menu.offsetHeight - 10) + "px";
      setTimeout(() => {
        const away = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("mousedown", away); } };
        document.addEventListener("mousedown", away);
      });
    }
    target.addEventListener("click", (e) => { if (e.target.closest(".pic-remove") || e.target === input) return; open(e); });
    target.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.value = "";
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) return toast("Pictures can be up to 15 MB.");
      await edit(file);
    });
    remove.addEventListener("click", async (e) => {
      e.stopPropagation();
      remove.disabled = true;
      await removePic();
      remove.disabled = false;
    });
    return remove;
  }

  let bannerRemove = null, avatarRemove = null;
  function paintPictures() {
    banner.style.backgroundImage = profile.banner ? `url("${profile.banner}")` : "";
    banner.classList.toggle("empty", !profile.banner);
    avatarWrap.querySelector(".avatar")?.replaceWith(avatar(profile, AVATAR));
    if (bannerRemove) bannerRemove.hidden = !profile.banner;
    if (avatarRemove) avatarRemove.hidden = !profile.avatar;
  }

  if (profile.isMe) {
    for (const [el, label] of [[banner, "Change banner"], [avatarWrap, "Change photo"], [nameEl, "Edit name"]]) {
      el.classList.add("editable");
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", label);
      el.title = label;
    }
    banner.append(h("span", { class: "edit-hint" }, icon("camera"), h("span", { text: "Change banner" })));
    avatarWrap.append(h("span", { class: "edit-hint round" }, icon("camera")));
    bannerRemove = pictureEditor(banner, "banner", "banner");
    banner.append(bannerRemove);
    avatarRemove = pictureEditor(avatarWrap, "avatar", "photo");
    avatarWrap.append(avatarRemove);
    paintPictures();

    /* Name: click to type a new one */
    const nameText = h("span", { class: "name-text", text: profile.name });
    nameEl.replaceChildren(nameText, tick(profile, 26) || "", h("span", { class: "name-pen" }, icon("edit")));
    const editName = () => {
      if (nameEl.hidden) return;
      const input = h("input", { type: "text", class: "name-input", maxlength: 50, value: profile.name, "aria-label": "Your name" });
      const save = h("button", { type: "submit", class: "btn btn-primary btn-xs", text: "Save" });
      const cancel = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Cancel" });
      const err = h("p", { class: "form-error", role: "alert", hidden: true });
      const form = h("form", { class: "name-form", novalidate: true }, input, h("div", { class: "bio-bar" }, cancel, save), err);
      const stop = () => { form.remove(); nameEl.hidden = false; };
      cancel.addEventListener("click", stop);
      input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); stop(); } });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        save.disabled = true;
        save.textContent = "Saving…";
        try {
          await saveProfile({ name: input.value });
          stop();
          toast("Name saved.");
        } catch (ex) {
          err.textContent = ex.errors?.name || ex.error || "Couldn’t save your name.";
          err.hidden = false;
          save.disabled = false;
          save.textContent = "Save";
        }
      });
      nameEl.hidden = true;
      nameEl.after(form);
      input.focus();
      input.select();
    };
    nameEl.addEventListener("click", editName);
    nameEl.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editName(); } });
  }

  body.append(h("section", { class: "profile" },
    banner,
    h("div", { class: "profile-top" }, avatarWrap, h("div", { class: "profile-btns" }, requestsBtn, ...(profile.blocked ? [] : [messageBtn, bellBtn, actionBtn]), moreBtn)),
    nameEl,
    handleEl,
    liveBtn,
    specialEl,
    rolesEl,
    bioWrap,
    h("p", { class: "joined" }, icon("calendar"), "Joined " + new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })),
    h("p", { class: "stats" },
      h("button", { class: "stat-btn", onclick: () => openConnections(profile, "following") }, followingEl, " Following"),
      h("button", { class: "stat-btn", onclick: () => openConnections(profile, "followers") }, followersEl, " Followers"),
      h("span", {}, h("b", { text: count(profile.reposts) }), profile.reposts === 1 ? " Repost" : " Reposts"),
      h("span", { class: "stat-views" }, icon("eye"), h("b", { text: count(profile.views) }), profile.views === 1 ? " View" : " Views")
    )
  ));

  /* Badges and awards */
  const badgeStrip = h("div", { class: "badge-strip", hidden: true });
  body.querySelector(".profile").append(badgeStrip);
  api(`/api/users/${encodeURIComponent(profile.username)}/badges`).then((data) => {
    allRoles = data.allRoles || [];
    paintRoles(data.roles || []);
    paintSpecial(data.special || []);
    const earned = data.badges.filter((b) => b.earned);
    const medals = data.awards.filter((a) => a.level);
    badgeStrip.replaceChildren(
      h("span", { class: "badge-label", text: "Badges" }),
      ...(data.special || []).map((b) => h("span", { class: "badge-dot special" + (b.image ? " has-img" : ""), style: specialStyle(b), title: b.unique ? `${b.name}: special badge, only @${profile.username} has it` : `${b.name}: a badge from the LookBlog team` }, b.image ? h("img", { src: b.image, alt: "" }) : b.emoji)),
      ...medals.map((a) => h("span", { class: `medal ${a.tier}`, title: `${a.name}: ${a.tier} (${a.value} ${a.unit})` }, a.emoji)),
      ...earned.map((b) => h("span", { class: "badge-dot", title: `${b.name}: ${b.how}` }, badgeIcon(b, data, 24))),
      h("button", { type: "button", class: "badge-all" }, earned.length || medals.length ? "All badges" : profile.isMe ? "See badges you can earn" : "No badges yet")
    );
    badgeStrip.querySelector(".badge-all").addEventListener("click", () => openBadges(profile, data));
    badgeStrip.hidden = !earned.length && !medals.length && !data.special?.length && !profile.isMe;
  }).catch(() => {});

  /* Highlights: stories that stay on the profile */
  import("../components/highlights.js").then((mod) => {
    const row = mod.highlightsRow(profile);
    badgeStrip.after(row);
    // Adding a story to a highlight from the viewer: show it here when the viewer closes
    reloadHighlights = row.reload;
  });

  /* Tabs: Posts | Shorts | Videos */
  const tabs = h("div", { class: "tabs profile-tabs", role: "tablist" });
  const list = h("div");

  /* My profile: write a post, upload a short or a video right here */
  const want = params?.get("create");
  const creator = profile.isMe ? createCard(["short", "video"].includes(want) ? want : "post") : null;
  if (creator) {
    creator.el.classList.add("profile-create");
    body.append(creator.el);
    if (want) setTimeout(() => creator.el.scrollIntoView({ block: "start" }), 80);
  }
  const catRow = h("div", { class: "cat-row-chips", hidden: true });
  body.append(tabs, catRow, list);
  let currentTab = "post";
  let category = params?.get("category") || null;
  let categories = [];

  /* Categories: filter this profile's content, and (on my profile) manage them */
  async function loadCategories() {
    try { categories = (await api(`/api/users/${encodeURIComponent(profile.username)}/categories`)).categories; } catch { categories = []; }
    if (category && !categories.some((c) => c.id === category)) category = null;
    paintCats();
  }
  function paintCats() {
    const usable = ["post", "short", "video"].includes(currentTab);
    catRow.hidden = !usable || (!categories.length && !profile.isMe);
    if (catRow.hidden) return;
    const chip = (id, label, n) => {
      const b = h("button", { type: "button", class: "cat-pill" + (category === id ? " active" : "") }, label, n != null ? h("span", { class: "cat-n", text: String(n) }) : null);
      b.addEventListener("click", () => { category = id; paintCats(); show(currentTab, { keepCats: true }); });
      return b;
    };
    catRow.replaceChildren(
      chip(null, "All"),
      ...categories.map((c) => chip(c.id, c.name, c.count)),
      profile.isMe ? h("button", { type: "button", class: "cat-pill cat-manage", onclick: manageCategories }, icon("folder"), h("span", { text: categories.length ? "Manage" : "Add a category" })) : null
    );
  }
  function manageCategories() {
    const list2 = h("div", { class: "cat-manage-list" });
    const input = h("input", { type: "text", class: "text-input", maxlength: 30, placeholder: "New category name" });
    const add = h("button", { type: "button", class: "btn btn-primary btn-sm", text: "Add" });
    const save = async (body, id) => {
      try {
        const r = await api(`/api/me/categories${id ? "/" + id : ""}`, { method: "POST", body });
        state.me.categories = r.categories;
        await loadCategories();
        paint();
      } catch (err) { toast(err.error || "Couldn’t save that."); }
    };
    add.addEventListener("click", async () => { if (input.value.trim()) { await save({ name: input.value }); input.value = ""; } });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
    function paint() {
      list2.replaceChildren(...(categories.length ? categories.map((c) => {
        const name = h("input", { type: "text", class: "text-input", value: c.name, maxlength: 30, "aria-label": "Category name" });
        name.addEventListener("change", () => save({ name: name.value }, c.id));
        const del = h("button", { type: "button", class: "icon-btn", "aria-label": "Delete category", title: "Delete (your posts stay, they just leave the category)" }, icon("trash"));
        confirmClick(del, "Delete?", async () => {
          try {
            const r = await api(`/api/me/categories/${c.id}`, { method: "DELETE" });
            state.me.categories = r.categories;
            if (category === c.id) category = null;
            await loadCategories();
            paint();
            show(currentTab, { keepCats: true });
          } catch (err) { toast(err.error || "Couldn’t delete it."); }
        });
        return h("div", { class: "cat-manage-row" }, name, h("span", { class: "muted", text: `${c.count} ${c.count === 1 ? "item" : "items"}` }), del);
      }) : [h("p", { class: "muted", text: "No categories yet. Make one, then pick it when you post." })]));
    }
    paint();
    modal({ title: "Your categories", body: h("div", { class: "create-form" },
      h("p", { class: "create-hint", text: "Group your posts, shorts and videos so people can find them. Pick a category when you post, or open a post you made to change it." }),
      h("div", { class: "share-row" }, input, add), list2) });
  }
  on("categories:changed", () => profile.isMe && loadCategories());
  let pager;
  // Series and Movies show when they have some (or it's me and I make films);
  // Songs show only when they have songs and are a singer, rapper or DJ / producer
  const kinds = [["post", "Posts"], ["repost", "Reposts"], ["short", "Shorts"], ["video", "Videos"],
    ...(profile.series || (profile.isMe && profile.canMakeFilms) ? [["series", "Series"]] : []),
    ...(profile.movies || (profile.isMe && profile.canMakeFilms) ? [["movie", "Movies"]] : []),
    ...(profile.songs && profile.canMakeMusic ? [["song", "Songs"]] : []),
    ...(profile.streams || profile.liveNow || profile.isMe ? [["stream", profile.liveNow ? "🔴 Streams" : "Streams"]] : []),
    ["playlist", "Playlists"], ["tagged", "Tagged"]];
  function show(type, { keepCats = false } = {}) {
    currentTab = type;
    if (!keepCats) paintCats();
    pager?.stop();
    tabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.type === type));
    list.replaceChildren();
    if (type === "playlist") return showPlaylists();
    if (type === "series") return showSeries();
    if (type === "song") return showSongs();
    if (type === "stream") return showStreams();
    const container = h("div", { class: type === "short" ? "short-grid" : type === "video" || type === "movie" ? "video-grid" : "feed" });
    // Videos: their playlists on a shelf first
    if (type === "video" && !category) {
      const shelf = h("section", { class: "pl-shelf", hidden: true });
      list.append(shelf);
      api(`/api/users/${encodeURIComponent(profile.username)}/playlists`).then(({ playlists }) => {
        if (!playlists.length || currentTab !== "video") return;
        const more = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "See all" });
        more.addEventListener("click", () => show("playlist"));
        shelf.replaceChildren(h("div", { class: "pl-shelf-head" }, h("h3", { text: "Playlists" }), more), h("div", { class: "pl-shelf-row" }, ...playlists.slice(0, 8).map(playlistCard)));
        shelf.hidden = false;
      }).catch(() => {});
    }
    if ((type === "video" || type === "short") && !category) {
      const up = h("section", { class: "pl-shelf", hidden: true });
      list.append(up);
      api(`/api/users/${encodeURIComponent(profile.username)}/upcoming`).then(({ videos }) => {
        const mine = videos.filter((v) => v.type === type);
        if (!mine.length || currentTab !== type) return;
        up.replaceChildren(h("div", { class: "pl-shelf-head" }, h("h3", { text: "Upcoming" })), h("div", { class: "up-grid" }, ...mine.map(upcomingVideoCard)));
        up.hidden = false;
      }).catch(() => {});
    }
    list.append(container);
    const nothing = {
      post: profile.isMe ? ["You haven’t posted yet.", "Your posts will show up here."] : [`@${profile.username} hasn’t posted yet.`, "When they do, their posts will show up here."],
      short: profile.isMe ? ["No shorts yet.", "Vertical videos up to 90 seconds you post show up here."] : ["No shorts yet.", ""],
      video: profile.isMe ? ["No videos yet.", "Longer videos you post show up here."] : ["No videos yet.", ""],
      movie: profile.isMe ? ["No movies yet.", "Upload one from Create → Upload movie."] : ["No movies yet.", ""],
      tagged: profile.isMe ? ["No one has tagged you yet.", "Posts, shorts and videos you’re tagged in show up here."] : [`@${profile.username} hasn’t been tagged yet.`, ""],
      repost: profile.isMe ? ["You haven’t reposted anything yet.", "Tap the repost button under a post to share it with your followers."] : [`@${profile.username} hasn’t reposted anything yet.`, ""],
    }[type];
    pager = pagedList({
      container,
      load: (before) => api(`/api/users/${encodeURIComponent(profile.username)}/posts?type=${type}${category && !["repost", "tagged", "movie"].includes(type) ? "&category=" + encodeURIComponent(category) : ""}${before ? "&before=" + encodeURIComponent(before) : ""}`),
      render: (p) => (type === "short" ? shortTile(p, { inPlace: true }) : type === "video" || type === "movie" ? videoTile(p, { inPlace: true }) : postCard(p, { onDeleted: () => (postsCount.textContent = count(Math.max(0, --tabCount.post))) })),
      emptyEl: () => (category && type !== "repost" ? empty("Nothing in this category here.", "Try another tab or category.") : empty(nothing[0], nothing[1])),
    });
  }
  // Their series, as big Netflix-style cards
  async function showSeries() {
    const grid = h("div", { class: "cn-grid" }, spinner());
    list.append(grid);
    try {
      const { playlists } = await api(`/api/users/${encodeURIComponent(profile.username)}/playlists?kind=series`);
      grid.replaceChildren(...playlists.map((pl) => h("a", { class: "cn-card", href: `/playlist/${pl.id}` },
        h("div", { class: "cn-img", style: pl.cover ? `background-image:url("${pl.cover}")` : "" }, h("span", { class: "cn-kind", text: "SERIES" })),
        h("div", { class: "cn-info" }, h("b", { text: pl.title }), h("span", { class: "muted", text: [pl.series?.year, pl.series?.genre, `${pl.count} episode${pl.count === 1 ? "" : "s"}`].filter(Boolean).join(" · ") })))));
      if (profile.isMe) grid.prepend(h("button", { class: "playlist-new", onclick: () => import("../components/cinema.js").then((m) => m.openSeriesForm()) }, icon("plus"), h("span", { text: "New series" })));
      if (!playlists.length && !profile.isMe) grid.append(empty("No series yet.", ""));
    } catch (err) { grid.replaceChildren(empty("Couldn’t load series.", err.error || "")); }
  }
  // Their songs, Spotify style: big play button and the most played first
  async function showSongs() {
    const box = h("div", { class: "artist-songs" }, spinner());
    list.append(box);
    try {
      const [{ songs, listeners }, { albums }] = await Promise.all([api(`/api/users/${encodeURIComponent(profile.username)}/songs`), api(`/api/users/${encodeURIComponent(profile.username)}/albums`)]);
      const play = h("button", { class: "mu-big-play", "aria-label": "Play", onclick: () => songs.length && playSongs(songs, 0) }, icon("play"));
      box.replaceChildren(
        h("div", { class: "as-head" }, play,
          h("div", {}, h("b", { text: `${listeners.toLocaleString("en-US")} monthly listener${listeners === 1 ? "" : "s"}` }), h("span", { class: "muted", text: ` · ${songs.length} song${songs.length === 1 ? "" : "s"}` })),
          profile.isMe ? h("button", { class: "btn btn-sm btn-outline-light", onclick: () => openUploadSong(() => show("song")) }, icon("plus"), h("span", { text: "Upload song" })) : null),
        h("h3", { class: "as-title", text: "Popular" }),
        songs.length ? songList(songs.slice(0, 10), { showArtist: false }) : empty("No songs yet.", ""),
        albums.length || profile.isMe ? h("div", { class: "as-albums" },
          h("div", { class: "pl-shelf-head" }, h("h3", { class: "as-title", text: "Albums & EPs" }),
            profile.isMe ? h("button", { class: "btn btn-xs btn-outline-light", onclick: () => openAlbumForm() }, icon("plus"), h("span", { text: "New album / EP" })) : null),
          albums.length ? h("div", { class: "mu-scroll" }, ...albums.map(albumCard)) : h("p", { class: "muted", text: "Put your songs together in an album or EP." })) : null);
    } catch (err) { box.replaceChildren(empty("Couldn’t load songs.", err.error || "")); }
  }
  // Streams: the one going on now, and recordings of past ones
  async function showStreams() {
    const box = h("div", { class: "pf-streams" }, spinner());
    list.append(box);
    try {
      const { live, past, upcoming = [] } = await api(`/api/users/${encodeURIComponent(profile.username)}/streams`);
      box.replaceChildren(
        live ? h("a", { class: "live-card", href: `/live/${live.id}` },
          live.thumb ? h("span", { class: "live-card-thumb", style: `background-image:url("${live.thumb}")` }) : null,
          h("span", { class: "lv-badge", text: "LIVE" }), h("div", {}, h("b", { text: live.title }), h("span", { class: "muted", text: `${live.viewers} watching now · started ${new Date(live.startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` })),
          h("span", { class: "btn btn-sm btn-primary", text: live.isHost ? "Open" : "Watch" })) : null,
        profile.isMe && !live ? h("button", { class: "btn btn-sm btn-primary go-live-btn", onclick: () => import("./live.js").then((m) => m.openGoLive()) }, h("span", { text: "🔴 Go live / schedule" })) : null,
        ...(upcoming.length ? [h("h3", { class: "as-title", text: "Upcoming" }), h("div", { class: "up-grid" }, ...upcoming.map(upcomingLiveCard))] : []),
        h("h3", { class: "as-title", text: "Past streams" }),
        past.length ? h("div", { class: "video-grid" }, ...past.map((p) => videoTile(p, { inPlace: true }))) : empty("No past streams yet.", profile.isMe ? "When you end a stream, its recording shows up here." : ""));
    } catch (err) { box.replaceChildren(empty("Couldn’t load streams.", err.error || "")); }
  }
  // An upcoming live / video: a teaser card with the date and "Notify me"
  function upcomingCard({ href, thumb, badge, title, at, reminded, reminders, mine, onRemind, onDelete }) {
    const btn = h("button", { type: "button", class: "btn btn-xs " + (reminded ? "btn-following" : "btn-primary") });
    const paint = () => { btn.className = "btn btn-xs " + (reminded ? "btn-following" : "btn-primary"); btn.textContent = reminded ? "🔔 Notified" : "🔔 Notify me"; };
    paint();
    btn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { ({ reminded, reminders } = await onRemind()); paint(); cnt.textContent = reminders ? `${reminders} waiting` : ""; } catch (err) { toast(err.error || "Couldn’t save."); }
    });
    const cnt = h("span", { class: "muted", text: reminders ? `${reminders} waiting` : "" });
    const card = h(href ? "a" : "div", { class: "up-card", ...(href ? { href } : {}) },
      h("div", { class: "up-thumb", style: thumb ? `background-image:url("${thumb}")` : "" }, h("span", { class: "up-badge", text: badge })),
      h("div", { class: "up-info" }, h("b", { text: title }), h("span", { class: "up-when", text: "📅 " + new Date(at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }),
        h("div", { class: "up-row" }, mine ? h("span", { class: "muted", text: reminders ? `🔔 ${reminders} waiting` : "Scheduled" }) : btn, mine ? null : cnt)));
    if (mine && onDelete) {
      const del = h("button", { type: "button", class: "tile-del", title: "Delete", "aria-label": "Delete" }, icon("trash"));
      confirmClick(del, "Delete?", async () => { try { await onDelete(); card.remove(); toast("Deleted."); } catch (err) { toast(err.error || "Couldn’t delete it."); } });
      card.querySelector(".up-thumb").append(del);
    }
    return card;
  }
  const upcomingLiveCard = (s) => upcomingCard({ href: `/live/${s.id}`, thumb: s.thumb, badge: "UPCOMING LIVE", title: s.title, at: s.scheduledFor, reminded: s.reminded, reminders: s.reminders, mine: s.isHost,
    onRemind: () => api(`/api/streams/${s.id}/remind`, { method: "POST" }), onDelete: () => api(`/api/streams/${s.id}`, { method: "DELETE" }) });
  const upcomingVideoCard = (v) => upcomingCard({ href: v.isMine ? (v.type === "short" ? `/shorts?id=${v.id}` : `/watch/${v.id}`) : null, thumb: v.poster, badge: v.type === "short" ? "SHORT · PREMIERES" : "PREMIERES", title: v.title || v.text || "New short", at: v.publishAt,
    reminded: v.reminded, reminders: v.reminders, mine: v.isMine, onRemind: () => api(`/api/posts/${v.id}/remind`, { method: "POST" }), onDelete: () => api(`/api/posts/${v.id}`, { method: "DELETE" }) });
  async function showPlaylists() {
    const grid = h("div", { class: "playlist-grid" }, spinner());
    list.append(grid);
    try {
      const { playlists } = await api(`/api/users/${encodeURIComponent(profile.username)}/playlists`);
      grid.replaceChildren();
      if (profile.isMe) grid.append(h("button", { class: "playlist-new", onclick: () => openPlaylistForm() }, icon("plus"), h("span", { text: "New playlist" })));
      if (!playlists.length && !profile.isMe) grid.append(empty("No playlists yet.", ""));
      playlists.forEach((pl) => grid.append(playlistCard(pl)));
    } catch (err) {
      grid.replaceChildren(empty("Couldn’t load playlists.", err.error || ""));
    }
  }

  for (const [type, label] of kinds) {
    tabs.append(h("button", { class: "tab", role: "tab", dataset: { type }, onclick: () => show(type) }, label, countEl[type] || null));
  }
  // Private (not following yet) or blocked: no posts, just a note
  if (profile.locked || profile.blocked) {
    tabs.hidden = true;
    list.replaceChildren(h("div", { class: "locked-card" },
      h("span", { class: "lock-ic", text: profile.blocked ? "🚫" : "🔒" }),
      h("h3", { text: profile.blocked ? `You blocked @${profile.username}` : "This account is private" }),
      h("p", { class: "muted", text: profile.blocked ? "Unblock them from the ⋯ menu to see their posts again." : profile.requested ? "Your follow request is waiting for an answer." : `Follow @${profile.username} to see their posts, shorts and videos.` })));
  } else {
    const want2 = params?.get("tab");
    show(kinds.some(([k]) => k === want2) ? want2 : "post");
    loadCategories();
  }

  // Something I just posted from the card: show it in its tab
  const offCreated = on("post:created", (p) => {
    if (!profile.isMe) return;
    profile.posts++;
    if (countEl[p.type]) countEl[p.type].textContent = count(++tabCount[p.type]);
    const tab = p.type;
    if (currentTab === tab && tab === "post") {
      const feed = list.querySelector(".feed");
      feed?.querySelector(".empty")?.remove();
      const card = postCard(p, { onDeleted: () => (postsCount.textContent = count(Math.max(0, --tabCount.post))) });
      card.classList.add("new");
      feed?.prepend(card);
    } else {
      show(tab);
    }
  });

  // My own profile updates right after "Edit profile"
  const offMe = on("me:updated", (me) => {
    if (!profile.isMe) return;
    Object.assign(profile, { name: me.name, bio: me.bio, avatar: me.avatar, banner: me.banner });
    title.textContent = me.name;
    const nt = nameEl.querySelector(".name-text");
    if (nt) nt.textContent = me.name;
    paintBio();
    paintPictures();
  });
  // Someone else's profile changed while we look at it
  const offProfile = on("profile", (ev) => {
    if (profile.isMe || ev.username !== profile.username) return;
    Object.assign(profile, ev);
    title.textContent = ev.name;
    nameEl.firstChild.textContent = ev.name;
    paintBio();
    avatarWrap.querySelector(".avatar")?.replaceWith(avatar(profile, AVATAR));
    banner.style.backgroundImage = ev.banner ? `url("${ev.banner}")` : "";
    banner.classList.toggle("empty", !ev.banner);
  });

  return () => { pager?.stop(); offMe(); offProfile(); offCreated(); offNote(); offStoryNew(); };
}
profilePage.navName = (m) => (isMe(decodeURIComponent(m[1])) ? "profile" : "");
profilePage.layout = "wide";
