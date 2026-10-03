// /editor — the LookBlog editor for your videos, shorts, movies, episodes, streams and songs:
//   • Trim: choose where it starts and ends
//   • Cut: take out parts in the middle
//   • Subtitles (videos) and timed lyrics (songs), to the minute and second
// The original file stays whole: viewers just see (and hear) the edited version.
import { h, icon, empty, spinner, toast, modal, fmtTime } from "../ui.js";
import { api } from "../api.js";
import { state } from "../state.js";

const LANGS = [["en", "English"], ["bg", "Български"], ["es", "Español"], ["ru", "Русский"], ["de", "Deutsch"], ["sr", "Srpski"], ["ro", "Română"], ["fr", "Français"], ["it", "Italiano"], ["tr", "Türkçe"]];
// 1:02.5 / 01:02.500 / 62.5  ⇄  seconds
const fmtPrecise = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`; };
function parseTime(v) {
  const s = String(v).trim().replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const p = s.split(":").map(Number);
  if (p.some((x) => isNaN(x))) return null;
  return p.reduce((n, x) => n * 60 + x, 0);
}
const vttTime = (t) => { const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60; return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${ss.toFixed(3).padStart(6, "0")}`; };
function parseVtt(text) {
  const cues = [];
  for (const block of String(text).replace(/\r/g, "").split(/\n\n+/)) {
    const m = block.match(/(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{3})/);
    if (!m) continue;
    const t = (hh, mm, ss, ms) => (Number((hh || "0:").slice(0, -1)) * 3600) + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
    const text2 = block.split("\n").slice(block.split("\n").findIndex((l) => l.includes("-->")) + 1).join("\n").trim();
    cues.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: text2 });
  }
  return cues;
}
const toVtt = (cues) => "WEBVTT\n\n" + cues.slice().sort((a, b) => a.start - b.start).map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}`).join("\n\n") + "\n";
function parseLrc(text) {
  const out = [];
  for (const l of String(text || "").split(/\r?\n/)) {
    const m = l.match(/^\s*\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (m) out.push({ start: Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number("0." + m[3]) : 0), text: m[4] });
    else if (l.trim()) out.push({ start: null, text: l.trim() });
  }
  return out;
}
const toLrc = (lines) => lines.map((l) => (l.start != null ? `[${fmtPrecise(l.start)}] ` : "") + l.text).join("\n");

export function editorPage(view, _m, params) {
  document.title = "Editor / LookBlog";
  view.classList.add("page-editor");
  const side = h("aside", { class: "ed-side" }, spinner());
  const main = h("section", { class: "ed-main" }, empty("Pick something to edit.", "Choose one of your videos, shorts, movies, episodes, streams or songs on the left."));
  view.append(h("header", { class: "column-head" }, h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "LookBlog Editor" }), h("p", { class: "page-sub", text: "Trim, cut and add subtitles or timed lyrics — to the second." })))),
    h("div", { class: "ed-wrap" }, side, main));

  let items = [];
  (async () => {
    const me = encodeURIComponent(state.me.username);
    const [v, sh, songs] = await Promise.all([api(`/api/users/${me}/posts?type=video`), api(`/api/users/${me}/posts?type=short`), api(`/api/users/${me}/songs`).catch(() => ({ songs: [] }))]);
    items = [...v.posts.map((p) => ({ kind: p.stream ? "Stream" : p.film ? "Movie" : "Video", p })), ...sh.posts.map((p) => ({ kind: "Short", p })), ...songs.songs.map((s) => ({ kind: "Song", s }))];
    const search = h("input", { type: "search", class: "text-input", placeholder: "Search your things" });
    const list = h("div", { class: "ed-list" });
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      list.replaceChildren(...items.filter((it) => !q || (it.p?.title || it.p?.text || it.s?.title || "").toLowerCase().includes(q)).map((it) => {
        const thumb = it.s ? it.s.cover : it.p.media[0]?.poster;
        const b = h("button", { type: "button", class: "ed-item", dataset: { id: it.p?.id || it.s.id } },
          h("span", { class: "ed-thumb" + (it.s ? " sq" : ""), style: thumb ? `background-image:url("${thumb}")` : "" }),
          h("span", { class: "ed-item-text" }, h("b", { text: it.s ? it.s.title : it.p.title || it.p.text?.slice(0, 40) || it.kind }), h("small", { class: "muted", text: `${it.kind}${(it.p?.media[0]?.clip || it.s?.clip) ? " · edited" : ""}` })));
        b.addEventListener("click", () => open(it));
        return b;
      }));
      if (!list.children.length) list.append(h("p", { class: "muted", text: items.length ? "Nothing matches." : "Upload a video or a song first." }));
    };
    search.addEventListener("input", paint);
    side.replaceChildren(search, list);
    paint();
    const want = params.get("id");
    const found = items.find((it) => it.p?.id === want || it.s?.id === want);
    if (found) open(found);
  })().catch((err) => side.replaceChildren(empty("Couldn’t load your things.", err.error || "")));

  let stopCurrent = null;
  function open(it) {
    stopCurrent?.();
    side.querySelectorAll(".ed-item").forEach((b) => b.classList.toggle("on", b.dataset.id === (it.p?.id || it.s.id)));
    const isSong = Boolean(it.s);
    const media = isSong ? h("audio", { src: it.s.url, preload: "auto", controls: false }) : h("video", { src: it.p.media[0].url, poster: it.p.media[0].poster || null, playsInline: true, preload: "auto" });
    const stage = h("div", { class: "ed-stage" + (isSong ? " song" : "") + (it.kind === "Short" ? " tall" : ""), style: isSong && it.s.cover ? `background-image:url("${it.s.cover}")` : "" }, media);
    const overlay = h("div", { class: "ed-sub-overlay", hidden: true });
    stage.append(overlay);
    const clip0 = (isSong ? it.s.clip : it.p.media[0].clip) || null;
    let start = clip0?.start || 0, end = clip0?.end ?? null, cuts = (clip0?.cuts || []).map((c) => [...c]), mark = null;
    // Recordings from live streams don't say how long they are: use the length we saved
    const D = () => (Number.isFinite(media.duration) && media.duration > 0 ? media.duration : (isSong ? it.s.duration : it.p.media[0].duration) || 1);

    /* Transport */
    const playBtn = h("button", { type: "button", class: "ed-play", "aria-label": "Play" }, icon("play"));
    const clock = h("span", { class: "ed-clock", text: "00:00.00" });
    playBtn.addEventListener("click", () => (media.paused ? media.play().catch(() => {}) : media.pause()));
    media.addEventListener("play", () => playBtn.replaceChildren(h("span", { text: "❚❚" })));
    media.addEventListener("pause", () => playBtn.replaceChildren(icon("play")));
    const nudge = (d) => { media.currentTime = Math.max(0, Math.min(D(), media.currentTime + d)); };
    const back = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "−1s", onclick: () => nudge(-1) });
    const back2 = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "−0.1s", onclick: () => nudge(-0.1) });
    const fwd2 = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "+0.1s", onclick: () => nudge(0.1) });
    const fwd = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "+1s", onclick: () => nudge(1) });

    /* Timeline: the kept part is pink, trimmed and cut parts are dark */
    const tl = h("div", { class: "ed-timeline" });
    const head = h("div", { class: "ed-head" });
    const paintTl = () => {
      const d = D(), e = end ?? d;
      const pct = (x) => (x / d) * 100 + "%";
      tl.replaceChildren(
        h("div", { class: "ed-keep", style: `left:${pct(start)};width:calc(${pct(e)} - ${pct(start)})` }),
        ...cuts.map(([a, b]) => h("div", { class: "ed-cut", style: `left:${pct(a)};width:calc(${pct(b)} - ${pct(a)})`, title: `Cut ${fmtPrecise(a)}–${fmtPrecise(b)}` })),
        ...(mark != null ? [h("div", { class: "ed-mark", style: `left:${pct(mark)}` })] : []),
        h("div", { class: "ed-trim l", style: `left:${pct(start)}` }), h("div", { class: "ed-trim r", style: `left:${pct(e)}` }), head);
      head.style.left = pct(media.currentTime);
      cutList.replaceChildren(...cuts.map(([a, b], i) => {
        const rm = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Undo" });
        rm.addEventListener("click", () => { cuts.splice(i, 1); paintTl(); });
        return h("div", { class: "ed-cut-row" }, h("span", { text: `✂ ${fmtPrecise(a)} → ${fmtPrecise(b)} (${(b - a).toFixed(1)}s)` }), rm);
      }));
      const kept = e - start - cuts.reduce((n, [a, b]) => n + (b - a), 0);
      summary.textContent = `Start ${fmtPrecise(start)} · End ${fmtPrecise(e)} · ${cuts.length} cut${cuts.length === 1 ? "" : "s"} · new length ${fmtTime(kept)} (was ${fmtTime(d)})`;
    };
    tl.addEventListener("pointerdown", (e) => {
      const r = tl.getBoundingClientRect();
      const go = (x) => { media.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * D(); };
      go(e.clientX);
      const mv = (ev) => go(ev.clientX);
      tl.setPointerCapture(e.pointerId);
      tl.addEventListener("pointermove", mv);
      tl.addEventListener("pointerup", () => tl.removeEventListener("pointermove", mv), { once: true });
    });
    const summary = h("p", { class: "ed-summary muted" });
    const cutList = h("div", { class: "ed-cuts" });
    const setStart = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "⇤ Start here" });
    const setEnd = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "End here ⇥" });
    const markBtn = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "✂ Cut from here…" });
    setStart.addEventListener("click", () => { start = Math.min(media.currentTime, (end ?? D()) - 1); paintTl(); });
    setEnd.addEventListener("click", () => { end = Math.max(media.currentTime, start + 1); paintTl(); });
    markBtn.addEventListener("click", () => {
      if (mark == null) { mark = media.currentTime; markBtn.textContent = `✂ …to here (from ${fmtPrecise(mark)})`; markBtn.classList.add("on"); }
      else {
        const a = Math.min(mark, media.currentTime), b = Math.max(mark, media.currentTime);
        if (b - a < 0.2) toast("Move a little further to cut a part.");
        else cuts.push([a, b]);
        mark = null; markBtn.textContent = "✂ Cut from here…"; markBtn.classList.remove("on");
      }
      paintTl();
    });
    const saveClip = h("button", { type: "button", class: "btn btn-primary btn-sm", text: "Save edits" });
    const resetClip = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Undo all edits" });
    saveClip.addEventListener("click", async () => {
      try {
        const body = { start, end: end ?? D(), cuts };
        const r = await api(isSong ? `/api/songs/${it.s.id}/clip` : `/api/posts/${it.p.id}/clip`, { method: "POST", body });
        if (isSong) it.s.clip = r.song.clip; else it.p.media[0].clip = r.clip;
        toast(r.clip === null || r.song?.clip === null ? "No edits — it plays in full." : "Edits saved. Viewers now see the edited version.");
      } catch (err) { toast(err.error || "Couldn’t save."); }
    });
    resetClip.addEventListener("click", async () => {
      start = 0; end = null; cuts = []; paintTl();
      try { await api(isSong ? `/api/songs/${it.s.id}/clip` : `/api/posts/${it.p.id}/clip`, { method: "POST", body: { reset: true } }); toast("Back to the original."); } catch {}
    });

    /* Subtitles (videos) / timed lyrics (songs) */
    let cues = [], lang = "en";
    const subList = h("div", { class: "ed-subs" });
    const langSel = h("select", { class: "text-input ed-lang" }, ...LANGS.map(([id, n]) => h("option", { value: id, text: n })));
    const loadSubs = async () => {
      if (isSong) { cues = parseLrc(it.s.lyrics).map((l) => ({ start: l.start, end: null, text: l.text })); return paintSubs(); }
      const t = (it.p.subtitles || []).find((x) => x.lang === lang);
      cues = [];
      if (t) { try { cues = parseVtt(await (await fetch(t.url)).text()); } catch {} }
      paintSubs();
    };
    langSel.addEventListener("change", () => { lang = langSel.value; loadSubs(); });
    function paintSubs() {
      cues.sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9));
      subList.replaceChildren(...cues.map((c, i) => {
        const st = h("input", { type: "text", class: "ed-t", value: c.start != null ? fmtPrecise(c.start) : "", placeholder: "mm:ss.00", title: "Starts at" });
        const en = isSong ? null : h("input", { type: "text", class: "ed-t", value: c.end != null ? fmtPrecise(c.end) : "", placeholder: "mm:ss.00", title: "Ends at" });
        const tx = h("input", { type: "text", class: "ed-tx", value: c.text, placeholder: isSong ? "Lyric line" : "Subtitle text" });
        const now = h("button", { type: "button", class: "btn btn-xs btn-outline-light", title: "Set the start to where the video is now", text: "⏱" });
        const rm = h("button", { type: "button", class: "icon-btn", "aria-label": "Remove line", title: "Remove" }, icon("close"));
        const go = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "▶", title: "Play from here" });
        st.addEventListener("change", () => { const t = parseTime(st.value); if (t == null) return toast("Use a time like 01:23.50"); c.start = t; if (!isSong && (c.end == null || c.end <= t)) c.end = t + 2.5; paintSubs(); });
        en?.addEventListener("change", () => { const t = parseTime(en.value); if (t == null || t <= c.start) return toast("The end has to be after the start."); c.end = t; paintSubs(); });
        tx.addEventListener("input", () => (c.text = tx.value));
        now.addEventListener("click", () => { c.start = media.currentTime; if (!isSong && (c.end == null || c.end <= c.start)) c.end = c.start + 2.5; paintSubs(); });
        go.addEventListener("click", () => { media.currentTime = c.start || 0; media.play().catch(() => {}); });
        rm.addEventListener("click", () => { cues.splice(i, 1); paintSubs(); });
        return h("div", { class: "ed-sub" + (isSong ? " song" : "") }, st, en, now, go, tx, rm);
      }));
      if (!cues.length) subList.append(h("p", { class: "muted", text: isSong ? "No lyrics yet. Play the song and press “Add line now” at each line." : "No subtitles in this language yet. Play the video and press “Add line now” where someone speaks." }));
    }
    const addLine = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "+ Add line now" });
    addLine.addEventListener("click", () => {
      const t = media.currentTime;
      cues.push({ start: t, end: isSong ? null : Math.min(D(), t + 2.5), text: "" });
      paintSubs();
      const row = [...subList.querySelectorAll(".ed-sub")].find((r) => r.querySelector(".ed-t").value === fmtPrecise(t));
      row?.querySelector(".ed-tx")?.focus();
    });
    const saveSubs = h("button", { type: "button", class: "btn btn-sm btn-primary", text: isSong ? "Save lyrics" : "Save subtitles" });
    saveSubs.addEventListener("click", async () => {
      const good = cues.filter((c) => c.text.trim());
      try {
        if (isSong) {
          const r = await api(`/api/songs/${it.s.id}/lyrics`, { method: "POST", body: { lyrics: toLrc(good) } });
          it.s.lyrics = r.song.lyrics;
          toast("Lyrics saved. They follow the song in the player.");
        } else {
          if (!good.length) return toast("Add at least one line.");
          const label = LANGS.find(([id]) => id === lang)[1];
          const r = await api(`/api/posts/${it.p.id}/subtitles`, { method: "POST", body: { lang, label, text: toVtt(good.map((c) => ({ ...c, end: c.end ?? c.start + 2.5 }))) } });
          it.p.subtitles = r.subtitles;
          toast(`${label} subtitles saved.`);
        }
      } catch (err) { toast(err.error || "Couldn’t save."); }
    });

    /* Live: show the current subtitle over the video, move the playhead */
    const tick = () => {
      clock.textContent = fmtPrecise(media.currentTime);
      head.style.left = (media.currentTime / D()) * 100 + "%";
      const t = media.currentTime;
      const cur = isSong ? [...cues].reverse().find((c) => c.start != null && c.start <= t) : cues.find((c) => c.start <= t && (c.end ?? c.start + 2.5) > t);
      overlay.hidden = !cur?.text;
      overlay.textContent = cur?.text || "";
      subList.querySelectorAll(".ed-sub").forEach((row, i) => row.classList.toggle("now", cues[i] === cur));
    };
    media.addEventListener("timeupdate", tick);
    media.addEventListener("loadedmetadata", () => { paintTl(); tick(); });
    const onKey = (e) => {
      if (e.target.closest("input, textarea, select")) return;
      if (e.key === " ") { e.preventDefault(); playBtn.click(); }
      else if (e.key === "ArrowLeft") nudge(e.shiftKey ? -0.1 : -1);
      else if (e.key === "ArrowRight") nudge(e.shiftKey ? 0.1 : 1);
      else if (e.key.toLowerCase() === "x") markBtn.click();
      else if (e.key.toLowerCase() === "s") addLine.click();
    };
    addEventListener("keydown", onKey);
    stopCurrent = () => { removeEventListener("keydown", onKey); media.pause(); };

    main.replaceChildren(
      h("div", { class: "ed-top" }, h("h2", { text: isSong ? it.s.title : it.p.title || it.kind }), h("span", { class: "ed-kind", text: it.kind })),
      stage,
      h("div", { class: "ed-transport" }, playBtn, clock, back, back2, fwd2, fwd, h("span", { class: "muted ed-keys", text: "Space play · ←/→ 1s · Shift ±0.1s · X cut · S add line" })),
      tl,
      h("section", { class: "ed-card" }, h("h3", { text: "✂ Trim & cut" }), h("p", { class: "muted", text: "Move to a moment, then set where it starts and ends. To cut a part out, press “Cut from here…”, move to where the part ends and press it again." }),
        h("div", { class: "gs-actions" }, setStart, setEnd, markBtn), cutList, summary, h("div", { class: "gs-actions" }, saveClip, resetClip)),
      h("section", { class: "ed-card" }, h("h3", { text: isSong ? "🎤 Timed lyrics" : "CC Subtitles" }),
        h("p", { class: "muted", text: isSong ? "Each line lights up in the player at its time." : "Each line shows on the video from its start to its end time. Pick a language — every language is a separate subtitle track." }),
        h("div", { class: "gs-actions" }, ...(isSong ? [] : [langSel]), addLine, saveSubs), subList));
    paintTl();
    loadSubs();
  }
  return () => stopCurrent?.();
}
editorPage.navName = () => "";
editorPage.layout = "wide";
