// /watch/:id — a video on its own page, YouTube style: big player, details, replies, and "Up next".
// With ?list=<playlist id> the playlist shows on the side and plays through.
import { h, icon, avatar, timeEl, empty, count, duration, richText, plural, tick, modal, toast, confirmClick, linkTimes } from "../ui.js";
import { starsWidget } from "../components/stars.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { on } from "../state.js";
import { actions, videoPlayer, watchHref, nsfwCover, warnKind } from "../components/post.js";
import { commentsSection } from "../components/comments.js";
import { openSaveToPlaylist, playlistHref } from "../components/playlists.js";
import { openChangeThumbnail } from "../components/thumbnail.js";
import { visibilityButton } from "../components/visibility.js";
import { categorySelect, makeEditable, postTextEl, editedLabel, liveTitle } from "../components/edit-post.js";
import { profileHref, navigate, postHref } from "../router.js";
import { followButton } from "./profile.js";
import { taggedSlot } from "../components/tags.js";

function nextCard(p, href, { index = null, current = false } = {}) {
  const m = p.media[0];
  return h("a", { class: "next-card" + (current ? " current" : ""), href },
    index != null ? h("span", { class: "next-index", text: current ? "▶" : String(index) }) : null,
    h("div", { class: "thumb" },
      m.poster ? h("img", { src: m.poster, alt: "", loading: "lazy", "data-thumb-for": p.id }) : h("div", { class: "thumb-empty" }, icon("play")),
      m.duration ? h("span", { class: "thumb-time", text: duration(m.duration) }) : null
    ),
    h("div", { class: "next-text" },
      h("h4", { text: p.title }),
      h("p", { class: "muted" }, p.author.name, tick(p.author, 14)),
      h("p", { class: "muted" }, h("span", { dataset: { postId: p.id, stat: "views" }, text: count(p.views) }), p.views === 1 ? " view" : " views")
    )
  );
}

/* ---------- Subtitles (the person who posted the video) ---------- */
const LANGS = [["en", "English"], ["bg", "Български"], ["es", "Español"], ["de", "Deutsch"], ["fr", "Français"], ["it", "Italiano"], ["ru", "Русский"], ["tr", "Türkçe"], ["el", "Ελληνικά"], ["ro", "Română"], ["pt", "Português"], ["ja", "日本語"], ["ko", "한국어"], ["zh", "中文"], ["ar", "العربية"]];
function openSubtitles(p) {
  const list = h("div", { class: "gs-list" });
  const paint = () => {
    list.replaceChildren(...(p.subtitles || []).map((t) => {
      const del = h("button", { type: "button", class: "icon-btn", title: "Remove", "aria-label": "Remove" }, icon("trash"));
      confirmClick(del, "Remove?", async () => { try { p.subtitles = (await api(`/api/posts/${p.id}/subtitles/${t.id}`, { method: "DELETE" })).subtitles; paint(); changed = true; } catch (err) { toast(err.error || "Couldn’t remove them."); } });
      return h("div", { class: "gs-row" }, h("span", { class: "cc-badge", text: t.lang.toUpperCase() }), h("b", { class: "grow", text: t.label }), del);
    }));
    if (!p.subtitles?.length) list.append(h("p", { class: "muted", text: "No subtitles yet." }));
  };
  let changed = false, fileText = null;
  const lang = h("select", { class: "text-input" }, ...LANGS.map(([id, name]) => h("option", { value: id, text: name })));
  const label = h("input", { type: "text", class: "text-input", maxlength: 40, placeholder: "Label (shown in the player), e.g. English" });
  lang.addEventListener("change", () => { if (!label.dataset.touched) label.value = LANGS.find(([id]) => id === lang.value)[1]; });
  label.addEventListener("input", () => (label.dataset.touched = "1"));
  label.value = "English";
  const file = h("input", { type: "file", accept: ".srt,.vtt,text/vtt", hidden: true });
  const pick = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Choose .srt or .vtt file" });
  const info = h("span", { class: "muted sound-file" });
  const add = h("button", { type: "button", class: "btn btn-primary btn-sm", text: "Add subtitles", disabled: true });
  pick.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 500_000) { info.textContent = "That file is too big."; return; }
    fileText = await f.text();
    info.textContent = f.name;
    add.disabled = false;
  });
  add.addEventListener("click", async () => {
    add.disabled = true;
    try {
      p.subtitles = (await api(`/api/posts/${p.id}/subtitles`, { method: "POST", body: { lang: lang.value, label: label.value, text: fileText } })).subtitles;
      toast("Subtitles added.");
      changed = true; fileText = null; info.textContent = ""; paint();
    } catch (err) { toast(err.error || "Couldn’t add them."); add.disabled = false; }
  });
  paint();
  modal({ title: "Subtitles", onClose: () => { if (changed) location.reload(); }, body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: "Viewers turn them on with the CC button in the player. Upload an .srt or .vtt file per language." }),
    list, h("b", { class: "vis-label", text: "Add a language" }), lang, label, h("div", { class: "gs-actions" }, pick, add), info, file) });
}

export async function watchPage(view, m, params) {
  const id = decodeURIComponent(m[1]);
  const listId = params.get("list");
  view.classList.add("page-watch");

  let p, comments;
  try {
    ({ post: p, comments } = await api(`/api/posts/${encodeURIComponent(id)}`));
  } catch {
    view.append(empty("This video doesn’t exist anymore.", "It may have been deleted."));
    return;
  }
  if (p.type !== "video") return navigate(postHref(p.id), { replace: true });
  document.title = `${p.title} / LookBlog`;

  // Theater mode: the player goes full width above everything else (remembered)
  let theater = false;
  try { const saved = localStorage.getItem("lb-theater"); theater = saved === "1" || (saved === null && Boolean(p.film)); } catch {}
  // Movies open in theater mode unless you turned it off
  if (p.film) { try { if (localStorage.getItem("lb-theater-movie") !== "0") theater = true; } catch {} }
  const stage = h("div", { class: "watch-stage" });
  const setTheater = (on) => {
    theater = on;
    try { localStorage.setItem(p.film ? "lb-theater-movie" : "lb-theater", on ? "1" : "0"); } catch {}
    view.classList.toggle("theater", on);
    if (on) stage.append(player); else main.prepend(player);
    player.setTheater?.(on);
    return on;
  };
  const player = videoPlayer(p.media[0], p, { autoplay: true, onTheater: () => setTheater(!theater) });
  player.classList.add("watch-player");
  if (warnKind(p)) nsfwCover(player, { what: "video", kind: warnKind(p), onReveal: () => player.video?.play().catch(() => {}) });

  /* Channel row */
  const href = profileHref(p.author.username);
  const followers = h("span", { class: "muted", text: "" });
  api(`/api/users/${encodeURIComponent(p.author.username)}`).then(({ profile }) => {
    followers.replaceChildren(h("span", { dataset: { followers: profile.username }, text: count(profile.followers) }), profile.followers === 1 ? " follower" : " followers");
  }).catch(() => {});
  const saveBtn = h("button", { class: "act act-save" }, icon("save"), h("span", { text: "Save" }));
  saveBtn.addEventListener("click", () => openSaveToPlaylist(p));
  const bar = actions(p, { onDeleted: () => navigate("/videos", { replace: true }) });
  bar.classList.add("watch-actions");
  if (!p.film && !p.episode) bar.insertBefore(saveBtn, bar.querySelector(".act-views"));
  if (p.mine) {
    const thumbBtn = h("button", { class: "act act-thumb" }, icon("image"), h("span", { text: "Thumbnail" }));
    thumbBtn.addEventListener("click", () => openChangeThumbnail(p, (poster) => player.video.setAttribute("poster", poster)));
    bar.insertBefore(thumbBtn, bar.querySelector(".act-views"));
    bar.insertBefore(visibilityButton(p), bar.querySelector(".act-views"));
    { const an = h("a", { class: "act act-analytics", href: `/analytics?post=${p.id}` }, icon("poll"), h("span", { text: "Analytics" })); bar.insertBefore(an, bar.querySelector(".act-views")); }
    if ((state.me.categories || []).length) bar.insertBefore(categorySelect(p), bar.querySelector(".act-views"));
    const subBtn = h("button", { class: "act act-subs" }, h("span", { class: "cc-badge", text: "CC" }), h("span", { text: "Subtitles" }));
    subBtn.addEventListener("click", () => openSubtitles(p));
    bar.insertBefore(subBtn, bar.querySelector(".act-views"));
  }

  const film = p.film ? h("div", { class: "film-strip" },
    h("span", { class: "sr-kicker" }, h("span", { class: "sr-n", text: "L" }), "MOVIE"),
    p.film.year ? h("span", { text: String(p.film.year) }) : null,
    p.film.rating ? h("span", { class: "sr-rating", text: p.film.rating }) : null,
    p.film.genre ? h("span", { text: p.film.genre }) : null,
    p.media[0]?.duration ? h("span", { text: p.media[0].duration < 60 ? `${Math.round(p.media[0].duration)}s` : `${Math.floor(p.media[0].duration / 3600) ? Math.floor(p.media[0].duration / 3600) + "h " : ""}${Math.round((p.media[0].duration % 3600) / 60)}m` }) : null,
    p.subtitles?.length ? h("span", { class: "cc-badge", text: "CC" }) : null,
    p.film.tagline ? h("em", { class: "film-tag", text: p.film.tagline }) : null) : null;
  // An upcoming video: only the author sees it until it comes out
  let premiere = null;
  if (p.publishAt) {
    const rel = h("button", { class: "btn btn-xs btn-primary", text: "Release now" });
    rel.addEventListener("click", async () => { rel.disabled = true; try { await api(`/api/posts/${p.id}/release`, { method: "POST" }); toast("It’s out! Your followers were notified."); premiere.remove(); } catch (err) { toast(err.error || "Couldn’t release it."); rel.disabled = false; } });
    premiere = h("div", { class: "premiere-strip" }, h("span", { text: `⏳ Upcoming · comes out ${new Date(p.publishAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Only you can see it until then.` }), rel);
  }
  // A recorded live stream: say so instead of looking like a normal upload
  const pastLive = p.stream ? h("div", { class: "past-live-strip" }, h("span", { class: "lv-badge up", text: "PAST LIVE" }),
    h("span", { text: `Streamed live ${new Date(p.stream.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` + (p.stream.endedAt ? ` · ${Math.max(1, Math.round((new Date(p.stream.endedAt) - new Date(p.stream.startedAt)) / 60000))} min` : "") + (p.stream.peak ? ` · up to ${p.stream.peak} watching at once` : "") })) : null;
  // This video answers another one
  const replyOf = p.replyTo && !p.replyTo.gone ? h("a", { class: "vreply-strip", href: p.replyTo.type === "short" ? `/shorts?id=${p.replyTo.id}` : `/watch/${p.replyTo.id}` },
    h("span", { text: "↩ Video reply to" }), h("b", { text: p.replyTo.title || "a video" }), h("span", { class: "muted", text: "by " + p.replyTo.author.name })) : null;
  const main = h("div", { class: "watch-main" },
    player,
    replyOf,
    premiere,
    pastLive,
    film,
    p.film ? starsWidget(p.stars, { rateUrl: `/api/posts/${p.id}/stars`, mine: p.mine }) : null,
    makeEditable(liveTitle(p, "h1", "watch-title"), p, "title"),
    h("div", { class: "watch-row" },
      h("div", { class: "channel" },
        h("a", { href }, avatar(p.author, 46)),
        h("div", { class: "who" }, h("a", { href, class: "name" }, p.author.name, tick(p.author)), followers),
        p.mine ? null : followButton(p.author.username)
      ),
      bar
    ),
    h("div", { class: "watch-desc" },
      h("p", { class: "watch-meta" },
        h("span", { dataset: { postId: p.id, stat: "views" }, text: count(p.views) }), p.views === 1 ? " view · " : " views · ",
        new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), " · ", timeEl(p.createdAt), " ", editedLabel(p)
      ),
      p.mine
        ? makeEditable(postTextEl(p, "post-text", { placeholder: "Add a description" }), p)
        : p.text ? linkTimes(h("p", { class: "post-text" }, richText(p.text, p.mentions)), (sec) => { player.video.currentTime = sec; player.video.play().catch(() => {}); player.scrollIntoView({ behavior: "smooth", block: "center" }); }, p.media[0]?.duration || Infinity) : h("p", { class: "muted", text: "No description." }),
      taggedSlot(p)
    )
  );
  // Timed comments + live reactions on the timeline (when the creator turned them on)
  const timed = comments.filter((c) => c.at != null);
  const moments = [...(p.moments || [])];
  const paintTimeline = () => (p.timedComments || p.momentReactions) && player.setTimeline?.({
    comments: p.timedComments ? timed : [], moments,
    onReact: p.momentReactions ? (emoji, at) => api(`/api/posts/${p.id}/moments`, { method: "POST", body: { emoji, at } }).catch((err) => toast(err.error || "Couldn’t react.")) : null });
  paintTimeline();
  const offMoment = on("post:moment", (ev) => { if (ev.id !== p.id) return; if (!player.isConnected) return offMoment(); moments.push({ at: ev.at, emoji: ev.emoji }); paintTimeline(); });
  const replies = commentsSection(p, comments, { getTime: () => player.video.currentTime || 0, onTimed: (c) => { if (!timed.some((x) => x.id === c.id)) { timed.push(c); paintTimeline(); } } });
  // A time in a reply or the description was clicked: jump there
  const offSeek = on("player:seek", (ev) => {
    if (ev.postId !== p.id) return;
    player.video.currentTime = ev.seconds;
    player.video.play().catch(() => {});
    player.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  if (!p.film) { const vr = h("button", { class: "act act-videoreply" }, icon("video"), h("span", { text: "Reply with a video" })); vr.addEventListener("click", () => import("../components/composer.js").then((m) => m.openVideoReply(p))); bar.insertBefore(vr, bar.querySelector(".act-views")); }
  main.append(replies.el);

  /* Side: playlist (if any) and up next */
  const side = h("aside", { class: "watch-side" });
  let playlist = null;
  if (listId) {
    try {
      ({ playlist } = await api(`/api/playlists/${encodeURIComponent(listId)}`));
      const items = h("div", { class: "pl-items" });
      playlist.videos.forEach((v, i) => items.append(nextCard(v, `${watchHref(v.id)}?list=${encodeURIComponent(playlist.id)}`, { index: i + 1, current: v.id === p.id })));
      const pos = playlist.videos.findIndex((v) => v.id === p.id);
      side.append(h("section", { class: "pl-panel" },
        h("header", {},
          h("a", { href: playlistHref(playlist.id), class: "pl-panel-title", text: playlist.title }),
          h("p", { class: "muted", text: `${playlist.owner.name} · ${pos + 1} / ${playlist.count}` })
        ),
        items
      ));
      setTimeout(() => items.querySelector(".current")?.scrollIntoView({ block: "nearest" }), 100);
      // Play the next one when this ends
      player.video.addEventListener("ended", () => {
        const next = playlist.videos[pos + 1];
        if (next) navigate(`${watchHref(next.id)}?list=${encodeURIComponent(playlist.id)}`);
      });
    } catch {}
  }
  const upNext = h("div", { class: "up-next" }, h("h3", { class: "side-title", text: "Up next" }));
  side.append(upNext);
  // Up next: recommended for you, close to this video
  api(`/api/recommend?type=video&limit=14&seed=${encodeURIComponent(p.id)}`).then(({ posts }) => {
    const skip = new Set([p.id, ...(playlist?.videos.map((v) => v.id) || [])]);
    const list = posts.filter((v) => !skip.has(v.id)).slice(0, 12);
    if (!list.length) upNext.append(h("p", { class: "muted side-empty", text: "No other videos yet." }));
    list.forEach((v) => upNext.append(nextCard(v, watchHref(v.id))));
  }).catch(() => {});

  view.append(stage, h("div", { class: "watch" }, main, side));
  if (theater) setTheater(true);
  if (location.hash === "#replies") replies.el.scrollIntoView();

  const offDeleted = on("post:deleted", (ev) => { if (ev.id === p.id) navigate("/videos", { replace: true }); });
  return () => { replies.stop(); offDeleted(); offSeek(); player.pause(); };
}
watchPage.navName = () => "videos";
watchPage.layout = "wide";
