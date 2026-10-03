// /playlist/:id — a series of videos with its cover.
import { h, icon, avatar, empty, count, duration, toast, confirmClick, plural, timeEl, tick, modal } from "../ui.js";
import { starsBadge, starsWidget } from "../components/stars.js";
import { api } from "../api.js";
import { watchHref } from "../components/post.js";
import { openPlaylistForm, openAddVideos } from "../components/playlists.js";
import { visibilityBadge } from "../components/visibility.js";
import { openSeriesForm } from "../components/cinema.js";
import { profileHref, navigate } from "../router.js";

export async function playlistPage(view, m) {
  const id = decodeURIComponent(m[1]);
  view.classList.add("page-playlist");
  let pl;
  try {
    ({ playlist: pl } = await api(`/api/playlists/${encodeURIComponent(id)}`));
  } catch {
    view.append(empty("This playlist doesn’t exist.", "It may have been deleted."));
    return;
  }
  document.title = `${pl.title} / LookBlog`;
  if (pl.kind === "series") return seriesView(view, pl);
  const playHref = (v) => `${watchHref(v.id)}?list=${encodeURIComponent(pl.id)}`;

  const buttons = h("div", { class: "pl-actions" });
  if (pl.videos.length) buttons.append(h("a", { class: "btn btn-primary btn-sm", href: playHref(pl.videos[0]) }, icon("play"), h("span", { text: "Play all" })));
  if (pl.mine) {
    buttons.append(h("button", { class: "btn btn-sm btn-primary", onclick: () => openAddVideos(pl, () => navigate(location.pathname, { replace: true })) }, icon("plus"), h("span", { text: "Add videos" })));
    buttons.append(h("button", { class: "btn btn-sm btn-outline-light", onclick: () => openPlaylistForm(pl, { onSaved: () => navigate(location.pathname, { replace: true }) }) }, icon("edit"), h("span", { text: "Edit" })));
    const del = h("button", { class: "btn btn-sm btn-outline-light" }, h("span", { text: "Delete" }));
    confirmClick(del, "Sure?", async () => {
      await api(`/api/playlists/${pl.id}`, { method: "DELETE" });
      toast("Playlist deleted.");
      navigate(profileHref(pl.owner.username), { replace: true });
    });
    buttons.append(del);
  }

  const hero = h("section", { class: "pl-hero" },
    h("div", { class: "pl-hero-cover" }, pl.cover ? h("img", { src: pl.cover, alt: "" }) : h("div", { class: "pl-cover-empty" }, icon("playlist"))),
    h("div", { class: "pl-hero-text" },
      h("p", { class: "pl-kicker" }, "Playlist ", visibilityBadge(pl)),
      h("h1", { text: pl.title }),
      h("p", { class: "muted" }, h("a", { href: profileHref(pl.owner.username), class: "pl-owner", text: pl.owner.name }), ` · ${plural(pl.count, "video", "videos")} · updated `, timeEl(pl.updatedAt)),
      pl.description ? h("p", { class: "pl-desc", text: pl.description }) : null,
      buttons
    )
  );
  if (pl.cover) hero.style.setProperty("--pl-bg", `url("${pl.cover}")`);

  const list = h("div", { class: "pl-list" });
  if (!pl.videos.length) {
    list.append(empty("No videos yet.", pl.mine ? "Press “Add videos”, or press Save under any video." : "This playlist is empty."));
  }
  pl.videos.forEach((v, i) => {
    const mm = v.media[0];
    const row = h("div", { class: "pl-row" },
      h("span", { class: "next-index", text: String(i + 1) }),
      h("a", { class: "thumb", href: playHref(v) },
        mm.poster ? h("img", { src: mm.poster, alt: "", loading: "lazy", "data-thumb-for": v.id }) : h("div", { class: "thumb-empty" }, icon("play")),
        mm.duration ? h("span", { class: "thumb-time", text: duration(mm.duration) }) : null
      ),
      h("a", { class: "pl-row-text", href: playHref(v) },
        h("h3", { text: v.title }),
        h("p", { class: "muted" }, v.author.name, tick(v.author, 14), ` · ${count(v.views)} ${v.views === 1 ? "view" : "views"}`)
      )
    );
    if (pl.mine) {
      const rm = h("button", { class: "icon-btn", "aria-label": "Remove from playlist", title: "Remove" }, icon("close"));
      rm.addEventListener("click", async () => {
        await api(`/api/playlists/${pl.id}/videos`, { method: "POST", body: { postId: v.id, add: false } });
        row.remove();
        toast("Removed from the playlist.");
      });
      row.append(rm);
    }
    list.append(row);
  });

  view.append(hero, list);
}
playlistPage.navName = () => "videos";
playlistPage.layout = "wide";

/* ---------- A series, Netflix style: big cover, seasons, episodes ---------- */
function seriesView(view, pl) {
  view.classList.add("page-series");
  const playHref = (v) => `${watchHref(v.id)}?list=${encodeURIComponent(pl.id)}`;
  const seasonOf = (v) => pl.seasons?.[v.id] || 1;
  const seasons = [...new Set(pl.videos.map(seasonOf))].sort((a, b) => a - b);
  let season = seasons[0] || 1;
  // Come back to the season you just uploaded to
  try { const keep = Number(sessionStorage.getItem("lb_series_season_" + pl.id)); if (keep) { season = keep; sessionStorage.removeItem("lb_series_season_" + pl.id); } } catch {}
  const reload = () => navigate(location.pathname, { replace: true });

  const meta = h("p", { class: "sr-meta" },
    pl.series?.year ? h("span", { class: "sr-year", text: String(pl.series.year) }) : null,
    pl.series?.rating ? h("span", { class: "sr-rating", text: pl.series.rating }) : null,
    h("span", { text: Math.max(pl.seasonCount || 1, ...seasons, 1) > 1 ? `${Math.max(pl.seasonCount || 1, ...seasons, 1)} Seasons` : plural(pl.count, "Episode", "Episodes") }),
    pl.series?.genre ? h("span", { text: pl.series.genre }) : null,
    starsBadge(pl.stars),
    h("span", { text: `👁 ${(pl.views || 0).toLocaleString("en-US")} view${pl.views === 1 ? "" : "s"}` }),
    visibilityBadge(pl));
  const buttons = h("div", { class: "sr-actions" });
  if (pl.videos.length) buttons.append(h("a", { class: "sr-play", href: playHref(pl.videos[0]) }, icon("play"), h("span", { text: "Play" })));
  if (pl.mine) {
    buttons.append(
      h("button", { class: "sr-more", onclick: () => openSeriesForm(pl, reload) }, icon("edit"), h("span", { text: "Edit" })));
    const del = h("button", { class: "sr-more" }, h("span", { text: "Delete" }));
    confirmClick(del, "Sure?", async () => { await api(`/api/playlists/${pl.id}`, { method: "DELETE" }); toast("Series deleted."); navigate(profileHref(pl.owner.username), { replace: true }); });
    buttons.append(del);
  }
  const hero = h("section", { class: "sr-hero", style: pl.cover ? `--sr-bg:url("${pl.cover}")` : "" },
    h("div", { class: "sr-hero-text" },
      h("p", { class: "sr-kicker" }, h("span", { class: "sr-n", text: "L" }), "SERIES"),
      h("h1", { text: pl.title }),
      meta,
      pl.series?.tagline ? h("p", { class: "sr-tagline", text: pl.series.tagline }) : null,
      pl.description ? h("p", { class: "sr-desc", text: pl.description }) : null,
      h("p", { class: "sr-by" }, "By ", h("a", { href: profileHref(pl.owner.username), text: pl.owner.name }), tick(pl.owner, 14)),
      buttons,
      starsWidget(pl.stars, { rateUrl: `/api/playlists/${pl.id}/stars`, mine: pl.mine })));

  const list = h("div", { class: "sr-episodes" });
  const head = h("div", { class: "sr-ep-head" }, h("h2", { text: "Episodes" }));
  const sInfo = (n) => pl.seasonInfo?.[n] || {};
  const count = Math.max(pl.seasonCount || 1, ...seasons, 1);
  const sLabel = (n) => `Season ${n}${sInfo(n).year ? " (" + sInfo(n).year + ")" : ""}`;
  const seasonMeta = h("p", { class: "sr-season-meta muted" });
  const paintSeasonMeta = () => { const i = sInfo(season); seasonMeta.textContent = [i.title, i.year ? `Released ${i.year}` : null].filter(Boolean).join(" · "); seasonMeta.hidden = !seasonMeta.textContent; };
  // Season tabs: everyone sees every season
  const seasonTabs = h("div", { class: "sr-seasons", role: "tablist" });
  const paintTabs = () => seasonTabs.replaceChildren(...Array.from({ length: count }, (_, k) => k + 1).map((n) => {
    const b = h("button", { class: "sr-stab" + (n === season ? " on" : ""), role: "tab", text: sLabel(n) });
    b.addEventListener("click", () => { season = n; paintTabs(); paint(); paintSeasonMeta(); });
    return b;
  }));
  paintTabs();
  head.append(seasonTabs);
  // Only the owner: add a season, name it, add episodes to it
  if (pl.mine) {
    const tools = h("div", { class: "sr-head-tools" });
    // Upload a new episode straight into the series (you pick the season in the form)
    const addEp = h("button", { class: "sr-more sr-edit-season sr-upload-ep" }, icon("plus"), h("span", { text: "Upload episode" }));
    addEp.addEventListener("click", () => import("../components/composer.js").then((m) => m.openEpisodeUpload(pl, { season, onDone: (sn) => { try { sessionStorage.setItem("lb_series_season_" + pl.id, String(sn)); } catch {} reload(); } })));
    const addSeason = h("button", { class: "sr-more sr-edit-season" }, icon("plus"), h("span", { text: "Add season" }));
    addSeason.addEventListener("click", async () => {
      addSeason.disabled = true;
      try { const r = await api(`/api/playlists/${pl.id}/seasons`, { method: "POST", body: {} }); toast(`Season ${r.season} (${new Date().getFullYear()}) added. Now add its episodes.`); reload(); }
      catch (err) { toast(err.error || "Couldn’t add a season."); addSeason.disabled = false; }
    });
    const ed = h("button", { class: "sr-more sr-edit-season" }, icon("edit"), h("span", { text: "Edit season" }));
    ed.addEventListener("click", () => seasonForm(season));
    tools.append(addEp, addSeason, ed);
    if (count > 1 && season === count) {
      const rmS = h("button", { class: "sr-more sr-edit-season" }, h("span", { text: "Remove season" }));
      confirmClick(rmS, "Sure?", async () => { try { await api(`/api/playlists/${pl.id}/seasons`, { method: "DELETE" }); toast("Season removed."); reload(); } catch (err) { toast(err.error || "Couldn’t remove it."); } });
      tools.append(rmS);
    }
    head.append(tools);
  }
  function seasonForm(n) {
    const i = n ? sInfo(n) : {};
    const year = h("input", { type: "number", class: "text-input", min: 1888, max: new Date().getFullYear() + 2, value: i.year || new Date().getFullYear() });
    const name = h("input", { type: "text", class: "text-input", maxlength: 60, placeholder: "Season name (optional), e.g. The Beginning", value: i.title || "" });
    const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: n ? "Save" : `Add Season ${count + 1}` });
    const m = modal({ title: n ? `Season ${n}` : "New season", body: h("div", { class: "create-form" }, h("b", { class: "vis-label", text: "Year" }), year, h("b", { class: "vis-label", text: "Name" }), name, save) });
    save.addEventListener("click", async () => {
      try {
        if (n) await api(`/api/playlists/${pl.id}/season-info`, { method: "POST", body: { season: n, year: year.value, title: name.value } });
        else { const r = await api(`/api/playlists/${pl.id}/seasons`, { method: "POST", body: { year: year.value, title: name.value } }); toast(`Season ${r.season} added. Now add its episodes.`); }
        m.close(); reload();
      } catch (err) { toast(err.error || "Couldn’t save it."); }
    });
  }
  function paint() {
    const eps = pl.videos.filter((v) => seasonOf(v) === season);
    list.replaceChildren();
    if (!eps.length) list.append(empty(pl.mine ? "No episodes in this season yet." : "Coming soon.", pl.mine ? "Press “Upload episode” to add one to this season." : "There are no episodes in this season yet."));
    eps.forEach((v, i) => {
      const mm = v.media[0];
      const row = h("div", { class: "sr-ep" },
        h("span", { class: "sr-ep-n", text: String(i + 1) }),
        h("a", { class: "sr-ep-thumb", href: playHref(v) },
          mm.poster ? h("img", { src: mm.poster, alt: "", loading: "lazy" }) : h("div", { class: "thumb-empty" }, icon("play")),
          h("span", { class: "sr-ep-play" }, icon("play"))),
        h("div", { class: "sr-ep-text" },
          h("div", { class: "sr-ep-top" }, h("a", { href: playHref(v) }, h("b", { text: v.title })), mm.duration ? h("span", { class: "muted", text: Math.max(1, Math.round(mm.duration / 60)) + "m" }) : null),
          v.text ? h("p", { class: "sr-ep-desc", text: v.text }) : null));
      if (pl.mine) {
        const s2 = h("select", { class: "sr-ep-season", title: "Move to season" }, ...Array.from({ length: count }, (_, k) => k + 1).map((n) => h("option", { value: n, text: `Season ${n}${sInfo(n).year ? " (" + sInfo(n).year + ")" : ""}`, selected: n === seasonOf(v) })));
        s2.addEventListener("change", async () => { await api(`/api/playlists/${pl.id}/season`, { method: "POST", body: { postId: v.id, season: Number(s2.value) } }); reload(); });
        const rm = h("button", { class: "icon-btn", title: "Remove episode", "aria-label": "Remove episode" }, icon("close"));
        rm.addEventListener("click", async () => { await api(`/api/playlists/${pl.id}/videos`, { method: "POST", body: { postId: v.id, add: false } }); reload(); });
        row.append(h("div", { class: "sr-ep-tools" }, s2, rm));
      }
      list.append(row);
    });
  }
  paint();
  paintSeasonMeta();
  view.append(hero, h("section", { class: "sr-body" }, head, seasonMeta, list), seriesReviews(pl));
}

// Reviews of a series (each shows the writer's stars)
function seriesReviews(pl) {
  const heading = h("h2", { class: "section-title" });
  const listEl = h("div", { class: "replies-list" });
  const paintList = (reviews) => {
    heading.textContent = plural(reviews.length, "review", "reviews");
    listEl.replaceChildren(...reviews.map((r) => {
      const del = r.canDelete ? h("button", { type: "button", class: "tool-icon", title: "Delete review", "aria-label": "Delete review" }, icon("trash")) : null;
      del && confirmClick(del, "Delete?", async () => { try { paintList((await api(`/api/playlists/${pl.id}/reviews/${r.id}`, { method: "DELETE" })).reviews); } catch (err) { toast(err.error || "Couldn’t delete it."); } });
      return h("article", { class: "reply" },
        h("a", { href: profileHref(r.author.username), tabindex: "-1" }, avatar(r.author, 38)),
        h("div", { class: "reply-body" },
          h("div", { class: "post-head" }, h("a", { class: "name", href: profileHref(r.author.username) }, r.author.name, tick(r.author)),
            r.stars ? h("span", { class: "review-stars", title: `${r.stars} out of 5`, text: "★".repeat(r.stars) + "☆".repeat(5 - r.stars) }) : null,
            h("span", { class: "muted" }, timeEl(r.createdAt)), del),
          h("p", { class: "post-text", text: r.text })));
    }));
    if (!reviews.length) listEl.append(empty("No reviews yet.", pl.mine ? "Reviews from your viewers show up here." : "Be the first to review it."));
  };
  paintList(pl.reviews || []);
  const text = h("textarea", { class: "text-input", rows: 2, maxlength: 1500, placeholder: "Write a review…" });
  const send = h("button", { type: "button", class: "btn btn-primary btn-sm", text: "Post review" });
  send.addEventListener("click", async () => {
    if (!text.value.trim()) return text.focus();
    send.disabled = true;
    try { paintList((await api(`/api/playlists/${pl.id}/reviews`, { method: "POST", body: { text: text.value } })).reviews); text.value = ""; toast("Review posted."); }
    catch (err) { toast(err.error || "Couldn’t post it."); }
    send.disabled = false;
  });
  return h("section", { class: "replies sr-reviews" }, h("div", { class: "replies-head" }, heading),
    pl.mine ? null : h("div", { class: "review-box" }, text, h("div", { class: "review-bar" }, h("span", { class: "muted", text: "Rate it with the stars above, then tell people what you think." }), send)),
    listEl);
}
