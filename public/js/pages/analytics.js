// /analytics — how your content is doing: views, reach, watch time, retention, sources, audience.
// /analytics?post=<id> opens one post or video in detail.
import { h, icon, empty, spinner, duration as fmtDur, avatar, tick } from "../ui.js";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { areaChart, columnChart, hBars, split, fmtNum, C } from "../components/charts.js";

const RANGES = [[7, "7 days"], [28, "28 days"], [90, "90 days"], [365, "1 year"], [0, "All time"]];
const SOURCE_NAMES = { feed: "Feed", shorts: "Shorts", videos: "Videos page", watch: "Watch page", profile: "Your profile", messages: "Shared in chats", search: "Search", playlist: "Playlists", post: "Post page", external: "Outside LookBlog", other: "Other" };
const dayLabel = (k) => new Date(k + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const hourLabel = (hr) => `${hr % 12 || 12} ${hr < 12 ? "AM" : "PM"}`;

function change(now, before) {
  if (before == null) return null;
  if (!before && !now) return { text: "No change", cls: "flat" };
  if (!before) return { text: "New", cls: "up" };
  const p = Math.round(((now - before) / before) * 100);
  return { text: `${p > 0 ? "+" : ""}${p}% vs before`, cls: p > 0 ? "up" : p < 0 ? "down" : "flat" };
}
function tile(label, value, sub, ch) {
  return h("div", { class: "kpi" }, h("span", { class: "kpi-label", text: label }), h("b", { class: "kpi-value", text: value }),
    ch ? h("span", { class: `kpi-change ${ch.cls}`, text: (ch.cls === "up" ? "▲ " : ch.cls === "down" ? "▼ " : "") + ch.text }) : null,
    sub ? h("span", { class: "kpi-sub muted", text: sub }) : null);
}
const card = (title, ...kids) => h("section", { class: "an-card" }, h("h2", { class: "an-title", text: title }), ...kids);
function table(cols, rows, onRow) {
  return h("div", { class: "an-table-wrap" }, h("table", { class: "an-table" },
    h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", { class: c.num ? "num" : "", text: c.label })))),
    h("tbody", {}, ...rows.map((r) => {
      const tr = h("tr", { class: onRow ? "click" : "" }, ...cols.map((c) => h("td", { class: c.num ? "num" : "" }, c.cell(r))));
      if (onRow) tr.addEventListener("click", () => onRow(r));
      return tr;
    }))));
}
function thumbCell(r) {
  return h("span", { class: "an-item" },
    r.thumb ? h("img", { src: r.thumb, alt: "" }) : h("span", { class: "an-thumb-empty" }, icon(r.type === "post" ? "edit" : "play")),
    h("span", { class: "an-item-text" }, h("b", { text: r.title }), h("small", { class: "muted", text: `${r.stream ? "Past live" : r.type === "video" ? "Video" : r.type === "short" ? "Short" : "Post"} · ${new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${r.visibility !== "public" ? " · " + r.visibility : ""}` })));
}

export async function analyticsPage(view, _m, params) {
  document.title = "Analytics / LookBlog";
  view.classList.add("page-analytics");
  const postId = params.get("post");
  if (postId) return postDetail(view, postId);

  let days = 28, metric = "views", section = params.get("section") || "overview";
  const head = h("header", { class: "column-head" }, h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "Analytics" }), h("p", { class: "page-sub", text: "How your posts, shorts and videos are doing." }))));
  // Series, Films and Music only for people who make them
  const sections = h("div", { class: "seg an-sections" });
  const ranges = h("div", { class: "tabs" }, ...RANGES.map(([d, l]) => h("button", { class: "tab", dataset: { d }, text: l, onclick: () => { days = d; load(); } })));
  head.append(sections, ranges);
  const body = h("div", { class: "an-body" }, spinner());
  view.append(head, body);
  let creatorData = null;
  async function paintSections() {
    const [cd, ls] = await Promise.all([api("/api/analytics/creator").catch(() => ({})), api("/api/streams/stats").catch(() => ({ streams: [] }))]);
    creatorData = { ...cd, lives: ls.streams };
    const list = [["overview", "Overview"], ...(creatorData.lives.length ? [["lives", "🔴 Lives"]] : []), ...(creatorData.canFilms ? [["series", "📺 Series"], ["films", "🎬 Films"]] : []), ...(creatorData.canMusic ? [["music", "🎧 Music"]] : [])];
    if (!list.some(([k]) => k === section)) section = "overview";
    sections.hidden = list.length < 2;
    sections.replaceChildren(...list.map(([k, l]) => h("button", { class: "seg-btn" + (k === section ? " active" : ""), text: l, onclick: () => { section = k; paintSections(); show(); } })));
  }
  function show() {
    ranges.hidden = section !== "overview";
    if (section === "overview") return load();
    body.replaceChildren();
    if (section === "series") return creatorSeries(body, creatorData.series || []);
    if (section === "films") return creatorFilms(body, creatorData.films);
    if (section === "music") return creatorMusic(body, creatorData.music);
    if (section === "lives") return creatorLives(body, creatorData.lives);
  }

  async function load() {
    ranges.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", Number(t.dataset.d) === days));
    body.replaceChildren(spinner());
    let d;
    try { d = await api(`/api/analytics?days=${days}`); } catch (err) { body.replaceChildren(empty("Couldn’t load analytics.", err.error || "")); return; }
    const t = d.totals;
    body.replaceChildren();

    /* Headline numbers */
    body.append(h("div", { class: "kpis" },
      tile("Views", fmtNum(t.views), days ? null : "All time", change(t.views, t.viewsPrev)),
      tile("Reach", fmtNum(t.reach), "Different people who watched"),
      tile("Watch time", `${fmtNum(t.watchMinutes)} min`, null, change(t.watchMinutes, t.watchMinutesPrev)),
      tile("Followers", fmtNum(t.followers), t.followersNet != null ? `${t.followersNet >= 0 ? "+" : ""}${t.followersNet} in this period` : null),
      tile("Profile visits", fmtNum(t.visits), null, change(t.visits, t.visitsPrev)),
      tile("Impressions", fmtNum(t.impressions), "Times your posts were on screen"),
      tile("Engagement rate", `${t.engagementRate}%`, "Likes, Cools, replies, reposts and shares per view")));

    /* Over time */
    const METRICS = [["views", "Views"], ["watchMinutes", "Watch time (min)"], ["followers", "Net followers"], ["visits", "Profile visits"]];
    const mtabs = h("div", { class: "seg an-seg" }, ...METRICS.map(([k, l]) => h("button", { class: "seg-btn" + (k === metric ? " active" : ""), text: l, onclick: () => { metric = k; load(); } })));
    const pts = d.series.map((p) => ({ x: p.day, y: p[metric] }));
    body.append(card("Over time", mtabs, pts.length ? areaChart(pts, { label: METRICS.find((m) => m[0] === metric)[1], xLabel: (p) => dayLabel(p.x) }) : empty("No data yet.", "")));

    /* Sources and audience */
    const src = Object.entries(d.sources).map(([k, v]) => ({ label: SOURCE_NAMES[k] || k, value: v })).sort((a, b) => b.value - a.value);
    const aud = d.audience;
    body.append(h("div", { class: "an-grid" },
      card("Where views came from", src.length ? hBars(src) : h("p", { class: "muted", text: "No views in this period yet." })),
      card("Who watched",
        aud.fromFollowers + aud.fromOthers ? split([{ label: "Followers", value: aud.fromFollowers }, { label: "Not following you", value: aud.fromOthers }]) : h("p", { class: "muted", text: "No views in this period yet." }),
        h("div", { class: "an-mini" },
          tile("Likes", fmtNum(t.likes)), tile("Cools", fmtNum(t.cools)), tile("Replies", fmtNum(t.comments)),
          tile("Reposts", fmtNum(t.reposts)), tile("Shares", fmtNum(t.shares)), tile("Saves", fmtNum(t.saves))))));

    /* When followers are on LookBlog */
    const top = d.hours.indexOf(Math.max(...d.hours));
    body.append(card("When your followers are online",
      d.hours.some(Boolean)
        ? [columnChart(d.hours.map((v, hr) => ({ label: hourLabel(hr), value: v, tick: hr % 3 === 0 ? hourLabel(hr) : "" })), { label: "Visits", highlight: top }),
           h("p", { class: "muted an-note", text: `Most active around ${hourLabel(top)}. Posting a little before then helps.` })]
        : h("p", { class: "muted", text: "Not enough data yet. This fills in as your followers use LookBlog." })));

    /* Top content and fans */
    body.append(h("div", { class: "an-grid" },
      card("Top content in this period", d.top.length
        ? table([{ label: "", cell: thumbCell }, { label: "Views", num: true, cell: (r) => fmtNum(r.periodViews) }], d.top, (r) => navigate(`/analytics?post=${r.id}`))
        : h("p", { class: "muted", text: "Nothing yet." })),
      card("Your biggest fans", d.fans.length
        ? h("div", { class: "fans" }, ...d.fans.map((f) => h("a", { class: "fan", href: `/u/${encodeURIComponent(f.username)}` }, avatar(f, 40), h("span", {}, h("b", {}, f.name, tick(f, 13)), h("small", { class: "muted", text: f.follows ? "Follows you" : "Doesn’t follow you yet" })))))
        : h("p", { class: "muted", text: "When people watch, like and reply, they show up here." }))));

    /* Everything you posted */
    body.append(card("All your content",
      d.content.length ? table([
        { label: "Content", cell: thumbCell },
        { label: "Views", num: true, cell: (r) => fmtNum(r.views) },
        { label: "Reach", num: true, cell: (r) => fmtNum(r.reach) },
        { label: "Impr.", num: true, cell: (r) => fmtNum(r.impressions) },
        { label: "CTR", num: true, cell: (r) => (r.ctr == null ? "—" : r.ctr + "%") },
        { label: "Avg view", num: true, cell: (r) => (r.duration ? `${fmtDur(r.avgViewSec)}${r.avgViewPct != null ? ` (${r.avgViewPct}%)` : ""}` : "—") },
        { label: "Watch time", num: true, cell: (r) => (r.duration ? `${fmtNum(r.watchMinutes)}m` : "—") },
        { label: "Likes", num: true, cell: (r) => fmtNum(r.likes) },
        { label: "Cools", num: true, cell: (r) => fmtNum(r.cools) },
        { label: "Replies", num: true, cell: (r) => fmtNum(r.comments) },
      ], d.content, (r) => navigate(`/analytics?post=${r.id}`)) : empty("Nothing posted yet.", "Post from your profile and your numbers show up here.")));
  }
  await paintSections();
  show();
}
analyticsPage.navName = () => "";

/* ---------- Series, films, music ---------- */
function creatorSeries(body, list) {
  if (!list.length) return body.append(empty("No series yet.", "Start one from Create → New series."));
  for (const s of list) {
    const best = [...s.episodes].sort((a, b) => b.views - a.views)[0];
    body.append(card(s.title,
      h("div", { class: "kpis" },
        tile("Views", fmtNum(s.views), "All episodes"), tile("Reach", fmtNum(s.reach), "Different people"),
        tile("Watch time", `${fmtNum(s.watchMinutes)} min`), tile("Episodes", fmtNum(s.episodes.length)),
        tile("Kept watching", s.stayedToEnd == null ? "—" : `${s.stayedToEnd}%`, "Of episode 1 viewers who also watched the last one")),
      s.seasons.length > 1 ? h("div", {}, h("h3", { class: "an-sub", text: "By season" }), hBars(s.seasons.map((x) => ({ label: `Season ${x.season}${x.year ? " (" + x.year + ")" : ""}`, value: x.views })))) : null,
      s.episodes.length ? h("div", {}, h("h3", { class: "an-sub", text: "Views per episode" }),
        columnChart(s.episodes.map((e, i) => ({ label: `S${e.season} · ${e.title}`, value: e.views, tick: `E${i + 1}` })), { label: "Views", highlight: s.episodes.indexOf(best) })) : null,
      table([{ label: "Episode", cell: thumbCell }, { label: "Season", num: true, cell: (r) => String(r.season) }, { label: "Views", num: true, cell: (r) => fmtNum(r.views) }, { label: "Reach", num: true, cell: (r) => fmtNum(r.reach) }, { label: "Avg view", num: true, cell: (r) => (r.avgViewPct != null ? r.avgViewPct + "%" : "—") }, { label: "Finished", num: true, cell: (r) => (r.completionPct != null ? r.completionPct + "%" : "—") }],
        s.episodes, (r) => navigate(`/analytics?post=${r.id}`))));
  }
}
function creatorFilms(body, f) {
  if (!f?.list.length) return body.append(empty("No films yet.", "Upload one from Create → Upload movie."));
  body.append(h("div", { class: "kpis" }, tile("Views", fmtNum(f.totals.views)), tile("Reach", fmtNum(f.totals.reach), "Different people"), tile("Watch time", `${fmtNum(f.totals.watchMinutes)} min`), tile("Likes", fmtNum(f.totals.likes))));
  body.append(card("Your films", table([
    { label: "Film", cell: thumbCell }, { label: "Year", num: true, cell: (r) => (r.year ? String(r.year) : "—") },
    { label: "Views", num: true, cell: (r) => fmtNum(r.views) }, { label: "Reach", num: true, cell: (r) => fmtNum(r.reach) },
    { label: "Avg view", num: true, cell: (r) => (r.avgViewPct != null ? r.avgViewPct + "%" : "—") },
    { label: "Finished", num: true, cell: (r) => (r.completionPct != null ? r.completionPct + "%" : "—") },
    { label: "Watch time", num: true, cell: (r) => `${fmtNum(r.watchMinutes)}m` }, { label: "Likes", num: true, cell: (r) => fmtNum(r.likes) },
  ], f.list, (r) => navigate(`/analytics?post=${r.id}`))));
}
function creatorLives(body, list) {
  if (!list.length) return body.append(empty("No live streams yet.", "Go live from Create → Go live."));
  const sum = (k) => list.reduce((n, x) => n + (x[k] || 0), 0);
  const likes = sum("likes"), dislikes = sum("dislikes");
  body.append(h("div", { class: "kpis" },
    tile("Streams", fmtNum(list.length)), tile("Hours live", fmtNum(Math.round(sum("minutes") / 6) / 10)),
    tile("Peak viewers", fmtNum(Math.max(...list.map((x) => x.peak))), "Most at once"), tile("Unique viewers", fmtNum(sum("uniqueViewers")), "Different people, all streams"),
    tile("Watch time", `${fmtNum(Math.round(sum("watchMinutes") * 10) / 10)} min`, "Live only"), tile("Chat messages", fmtNum(sum("messages"))),
    tile("Reactions", fmtNum(sum("reactions"))), tile("Sent to stream", fmtNum(sum("alerts")), "Pictures, videos & sounds"),
    tile("Likes", fmtNum(likes), likes + dislikes ? `${Math.round((likes / (likes + dislikes)) * 100)}% liked` : ""), tile("Shares", fmtNum(sum("shares"))),
    tile("Recording views", fmtNum(sum("recordingViews")), "After the stream")));
  const recent = [...list].reverse().slice(-20);
  body.append(card("Peak viewers per stream", columnChart(recent.map((x, i) => ({ label: x.title, value: x.peak, tick: new Date(x.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) })), { label: "Peak viewers" })));
  body.append(card("Chat & reactions per stream", hBars(list.slice(0, 10).map((x) => ({ label: x.title, value: x.messages + x.reactions })))));
  body.append(card("Your streams", table([
    { label: "Stream", cell: (r) => h("span", { class: "an-item" }, r.thumb ? h("img", { src: r.thumb, alt: "" }) : h("span", { class: "an-thumb-empty", text: "🔴" }), h("span", { class: "an-item-text" }, h("b", { text: r.title }), h("small", { class: "muted", text: `${r.live ? "LIVE NOW · " : ""}${new Date(r.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${r.minutes} min` }))) },
    { label: "Peak", num: true, cell: (r) => fmtNum(r.peak) }, { label: "Viewers", num: true, cell: (r) => fmtNum(r.uniqueViewers) },
    { label: "Watch time", num: true, cell: (r) => `${fmtNum(r.watchMinutes)}m` }, { label: "Messages", num: true, cell: (r) => fmtNum(r.messages) },
    { label: "Reactions", num: true, cell: (r) => fmtNum(r.reactions) }, { label: "👍 / 👎", num: true, cell: (r) => `${fmtNum(r.likes)} / ${fmtNum(r.dislikes)}` },
    { label: "Recording", num: true, cell: (r) => (r.postId ? `${fmtNum(r.recordingViews)} views` : "—") },
  ], list, (r) => navigate(r.live ? `/live/${r.id}` : r.postId ? `/analytics?post=${r.postId}` : `/live/${r.id}`))));
}
function creatorMusic(body, mu) {
  if (!mu?.songs.length) return body.append(empty("No songs yet.", "Upload one from Create → Upload song."));
  const t = mu.totals;
  body.append(h("div", { class: "kpis" }, tile("Plays", fmtNum(t.plays)), tile("Listeners", fmtNum(t.listeners), "Different people"), tile("Saves", fmtNum(t.likes), "Liked Songs"), tile("Songs", fmtNum(t.songs))));
  body.append(card("Plays in the last 28 days", areaChart(mu.daily.map((d) => ({ x: d.day, y: d.plays })), { label: "Plays", xLabel: (pt) => dayLabel(pt.x) })));
  body.append(card("Your songs", table([
    { label: "Song", cell: (r) => h("span", { class: "an-item" }, r.cover ? h("img", { src: r.cover, alt: "" }) : h("span", { class: "an-thumb-empty", text: "🎧" }), h("span", { class: "an-item-text" }, h("b", { text: r.title }), h("small", { class: "muted", text: new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) }))) },
    { label: "Plays", num: true, cell: (r) => fmtNum(r.plays) }, { label: "Listeners", num: true, cell: (r) => fmtNum(r.listeners) },
    { label: "From followers", num: true, cell: (r) => (r.plays ? Math.round((r.followerPlays / r.plays) * 100) + "%" : "—") },
    { label: "Saves", num: true, cell: (r) => fmtNum(r.likes) },
  ], mu.songs)));
}
analyticsPage.layout = "wide";

/* ---------- One post or video ---------- */
async function postDetail(view, id) {
  const back = h("button", { class: "icon-btn", "aria-label": "Back to analytics", onclick: () => navigate("/analytics") }, icon("back"));
  const head = h("header", { class: "column-head" }, h("div", { class: "head-row" }, back, h("div", { class: "head-text" }, h("h1", { text: "Content analytics" }))));
  const body = h("div", { class: "an-body" }, spinner());
  view.append(head, body);
  let p;
  try { p = (await api(`/api/analytics/post/${encodeURIComponent(id)}`)).post; } catch (err) { body.replaceChildren(empty("Couldn’t load this.", err.error || "")); return; }
  body.replaceChildren();
  const isVideo = p.duration > 0;
  const openHref = p.type === "video" ? `/watch/${p.id}` : `/post/${p.id}`;
  body.append(h("div", { class: "an-hero" }, thumbCell(p), h("a", { class: "btn btn-sm btn-outline-light", href: openHref, text: "Open" })));

  body.append(h("div", { class: "kpis" },
    tile("Views", fmtNum(p.views)), tile("Reach", fmtNum(p.reach), "Different people"),
    tile("Impressions", fmtNum(p.impressions), "Times on screen"),
    tile("Click-through", p.ctr == null ? "—" : `${p.ctr}%`, "Views per impression"),
    ...(isVideo ? [
      tile("Watch time", `${fmtNum(p.watchMinutes)} min`),
      tile("Average view", fmtDur(p.avgViewSec), p.avgViewPct != null ? `${p.avgViewPct}% of the video` : null),
      tile("Watched to the end", p.completionPct == null ? "—" : `${p.completionPct}%`, `${fmtNum(p.plays)} plays`),
    ] : []),
    tile("Likes", fmtNum(p.likes)), tile("Dislikes", fmtNum(p.dislikes)), tile("Cools", fmtNum(p.cools)),
    tile("Replies", fmtNum(p.comments)), tile("Reposts", fmtNum(p.reposts)), tile("Shares", fmtNum(p.shares)), tile("Saves", fmtNum(p.saves))));

  if (isVideo) {
    const N = p.retention.length || 50;
    const at = (i) => fmtDur((i / N) * p.duration);
    if (p.retention.length) {
      const dropI = p.bigDrop ? Math.round(p.bigDrop.at * N) : -1;
      body.append(card("Audience retention",
        h("p", { class: "muted an-note", text: "How many viewers were still watching at each moment of the video." }),
        areaChart(p.retention.map((y, i) => ({ x: i, y })), { label: "Still watching", pct: true, xLabel: (pt) => at(pt.x), markers: dropI > 0 ? [{ i: dropI, text: `Biggest drop: −${p.bigDrop.drop}%` }] : [] }),
        p.bigDrop ? h("p", { class: "an-callout" }, "Most people stopped around ", h("b", { text: fmtDur(p.bigDrop.at * p.duration) }), `. You lost ${p.bigDrop.drop}% of viewers there.`) : null));
      const asCols = (arr, lbl) => columnChart(arr.map((v, i) => ({ label: `${at(i)}–${at(i + 1)}`, value: v, tick: i % 10 === 0 ? at(i) : "" })), { label: lbl, highlight: arr.indexOf(Math.max(...arr)) });
      body.append(h("div", { class: "an-grid" },
        card("Where people stopped watching", p.exits.some(Boolean) ? [asCols(p.exits, "Left here"), h("p", { class: "muted an-note", text: "Each bar is a part of the video. Taller = more people left there." })] : h("p", { class: "muted", text: "Nobody has left early yet." })),
        card("Where people skipped ahead", p.skips.some(Boolean) ? [asCols(p.skips, "Skipped from here"), h("p", { class: "muted an-note", text: "Parts people jumped past. They may be slow or not what viewers expected." })] : h("p", { class: "muted", text: "Nobody has skipped yet." }))));
    } else {
      body.append(card("Audience retention", h("p", { class: "muted", text: "Retention appears after people (other than you) watch this video." })));
    }
  }

  /* Reach: how many people it got to */
  const f = p.funnel;
  const pct = (n) => (f.reached ? Math.round((n / f.reached) * 100) : 0);
  body.append(card("Reach: how many people it got to",
    h("p", { class: "an-callout" }, "Your ", h("b", { text: p.type === "video" ? "video" : p.type === "short" ? "short" : "post" }), " reached ", h("b", { text: fmtNum(f.reached) }), f.reached === 1 ? " person" : " people",
      f.reached ? ` — ${fmtNum(p.reachFollowers)} of them follow you and ${fmtNum(Math.max(0, f.reached - p.reachFollowers))} don’t.` : "."),
    h("div", { class: "funnel" }, ...[["Reached", f.reached, "Saw it on screen or opened it"], ["Watched", f.viewed, "Opened it"], ["Engaged", f.engaged, "Liked, Cooled, replied or reposted"], ...(isVideo ? [["Finished", f.finished, "Watched to the end"]] : [])].map(([l, n, sub]) =>
      h("div", { class: "fn-row" }, h("span", { class: "fn-label" }, h("b", { text: l }), h("small", { class: "muted", text: sub })), h("div", { class: "fn-bar" }, h("span", { style: `width:${Math.max(2, pct(n))}%` })), h("b", { class: "fn-n", text: `${fmtNum(n)} · ${pct(n)}%` })))),
    h("h3", { class: "an-sub", text: "New people reached per day (last 28 days)" }),
    areaChart(p.reachDaily.map((d) => ({ x: d.day, y: d.people })), { label: "People reached", xLabel: (pt) => dayLabel(pt.x) })));

  const src = Object.entries(p.sources).map(([k, v]) => ({ label: SOURCE_NAMES[k] || k, value: v })).sort((a, b) => b.value - a.value);
  body.append(h("div", { class: "an-grid" },
    card("Views over the last 28 days", areaChart(p.daily.map((d) => ({ x: d.day, y: d.views })), { label: "Views", xLabel: (pt) => dayLabel(pt.x) })),
    card("Where views came from", src.length ? hBars(src) : h("p", { class: "muted", text: "No views yet." }),
      p.fromFollowers + p.fromOthers ? split([{ label: "Followers", value: p.fromFollowers }, { label: "Not following you", value: p.fromOthers }]) : null)));
  void C;
}
