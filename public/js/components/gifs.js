// GIF picker: LookBlog's own animated GIFs and the ones people uploaded, all searchable,
// plus your own collection ("Yours"). Upload a GIF once with a few tags and anyone can find it.
import { h, icon, toast, spinner } from "../ui.js";
import { api, upload } from "../api.js";

let panel = null, onClosed = null;
export function closeGifs() { panel?.remove(); panel = null; const f = onClosed; onClosed = null; f?.(); }

// What to send to the server for a picked GIF
export const gifBody = (g) => (g.id ? { gif: g.id } : { gifUrl: g.url });

let lastQuery = "";
let lastTab = "search";
const MOODS = ["Happy", "LOL", "Love", "Wow", "Sad", "Party", "Hello", "Bye", "Yes", "No", "Thanks", "Angry", "Sleepy", "Cute"];

export function openGifs(anchor, onPick, { onClose = null } = {}) {
  if (panel) return closeGifs();
  onClosed = onClose;
  const pick = (g) => { closeGifs(); onPick(g); };
  // Like Instagram: a search box, then a wall of GIFs in two columns that keeps loading as you scroll
  const cols = [h("div", { class: "gif-col" }), h("div", { class: "gif-col" })];
  const heights = [0, 0];
  const grid = h("div", { class: "gif-grid gif-wall" }, spinner());
  const search = h("input", { type: "search", class: "gif-search", placeholder: "Search GIFs", "aria-label": "Search GIFs", value: lastQuery, enterkeyhint: "search" });
  const tabSearch = h("button", { type: "button", class: "gif-tab", text: "Trending" });
  const moods = h("div", { class: "gif-moods" }, ...MOODS.map((m) => {
    const b = h("button", { type: "button", class: "gif-mood", text: m });
    b.addEventListener("click", () => { search.value = search.value.trim().toLowerCase() === m.toLowerCase() ? "" : m; if (lastTab !== "search") setTab("search"); else runSearch(); });
    return b;
  }));
  const tabMine = h("button", { type: "button", class: "gif-tab", text: "Yours" });
  const foot = h("p", { class: "gif-foot muted" });
  const brand = h("div", { class: "gif-brand", hidden: true }, h("span", { text: "Powered by" }), h("b", { text: "GIPHY" }));
  const sheet = matchMedia("(max-width: 640px)").matches;
  panel = h("div", { class: "sticker-panel gif-panel" + (sheet ? " gif-sheet" : ""), role: "dialog", "aria-label": "GIFs", style: "visibility:hidden" },
    sheet ? h("div", { class: "gif-grab", "aria-hidden": "true" }) : null,
    h("header", { class: "gif-head" }, h("div", { class: "gif-search-wrap" }, icon("search"), search), h("div", { class: "gif-tabs" }, tabSearch, tabMine), moods),
    grid, foot, brand);
  document.body.append(panel);

  // On a phone it's a sheet from the bottom; on a computer it sits next to the button (and grows upwards)
  const place = () => {
    if (!panel || sheet) { if (panel) panel.style.visibility = ""; return; }
    const a = anchor.getBoundingClientRect();
    const w = Math.min(400, innerWidth - 16);
    panel.style.width = w + "px";
    panel.style.left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), innerWidth - w - 8) + "px";
    const above = a.top - 16, below = innerHeight - a.bottom - 16;
    if (above >= 320 || above >= below) { panel.style.top = "auto"; panel.style.bottom = innerHeight - a.top + 8 + "px"; panel.style.height = Math.min(520, above) + "px"; }
    else { panel.style.bottom = "auto"; panel.style.top = a.bottom + 8 + "px"; panel.style.height = Math.min(520, below) + "px"; }
    panel.style.visibility = "";
  };

  const SHADES = ["#ff4fa3", "#9b5cff", "#00c2ff", "#00e08a", "#ffd23f", "#ff6b35"];
  let shade = 0;
  const tile = (g, extra) => {
    const img = h("img", { src: g.preview || g.url, alt: g.title || "GIF", loading: "lazy", decoding: "async" });
    img.addEventListener("load", () => b.classList.add("ready"));
    const b = h("button", { type: "button", class: "gif-item", title: g.title || "Send", style: `--shade:${SHADES[shade++ % SHADES.length]}` + (g.w && g.h ? `;aspect-ratio:${g.w}/${g.h}` : "") }, img);
    b.addEventListener("click", () => pick(g));
    extra?.(b);
    if (g.id) return b;
    // Any GIF can be kept in "Yours"
    const keep = h("button", { type: "button", class: "gif-keep", title: "Keep in Yours", "aria-label": "Keep in Yours", text: "☆" });
    keep.addEventListener("click", async (e) => {
      e.stopPropagation();
      try { await api("/api/me/gifs", { method: "POST", body: { saveUrl: g.url, preview: g.preview, title: g.title } }); keep.textContent = "★"; keep.classList.add("on"); toast("Saved to your GIFs."); }
      catch (err) { toast(err.error || "Couldn’t save it."); }
    });
    return h("div", { class: "gif-cell" }, b, keep);
  };
  // Each GIF goes into the shorter column, so the two stay even
  function wall(list, fresh) {
    if (fresh) { cols.forEach((c) => c.replaceChildren()); heights[0] = heights[1] = 0; grid.replaceChildren(...cols); }
    for (const g of list) {
      const i = heights[0] <= heights[1] ? 0 : 1;
      cols[i].append(tile(g));
      heights[i] += g.w && g.h ? g.h / g.w : 1;
    }
  }

  /* ---------- Search and trending ---------- */
  let seq = 0, next = null, loading = false;
  async function runSearch(more = false) {
    const q = search.value.trim();
    lastQuery = q;
    if (!more) { next = null; grid.scrollTop = 0; grid.replaceChildren(spinner()); }
    const n = more ? seq : ++seq;
    loading = true;
    try {
      const d = await api("/api/gifs/search?q=" + encodeURIComponent(q) + (more ? "&offset=" + next : ""));
      if (n !== seq || !panel || lastTab !== "search") return;
      next = d.next;
      brand.hidden = !d.giphy;
      search.placeholder = d.giphy ? "Search GIPHY" : "Search GIFs";
      wall(d.results, !more);
      if (!more && !d.results.length) grid.replaceChildren(h("p", { class: "muted sticker-empty", text: `No GIFs for “${q}”. Try another word, or add your own under “Yours”.` }));
      for (const b of moods.children) b.classList.toggle("on", b.textContent.toLowerCase() === q.toLowerCase());
      tabSearch.textContent = q ? "Results" : "Trending";
      foot.replaceChildren();
      place();
    } catch { if (n === seq && !more) grid.replaceChildren(h("p", { class: "muted", text: "Couldn’t search right now." })); }
    finally { if (n === seq) loading = false; }
  }
  grid.addEventListener("scroll", () => {
    if (lastTab === "search" && next != null && !loading && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 400) runSearch(true);
  }, { passive: true });

  /* ---------- Yours ---------- */
  const fileInput = h("input", { type: "file", accept: "image/gif", hidden: true });
  const tagsInput = h("input", { type: "text", class: "gif-tags", placeholder: "Tags for the next GIF, e.g. happy dance", maxlength: 80 });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    fileInput.value = "";
    if (!f) return;
    if (f.type !== "image/gif") return toast("Pick a .gif file.");
    grid.querySelector(".gif-new")?.after(h("div", { class: "gif-item loading" }, spinner()));
    try {
      const { url } = await upload(f);
      const { gif } = await api("/api/me/gifs", { method: "POST", body: { url, tags: tagsInput.value || search.value } });
      pick(gif);
    } catch (err) { toast(err.error || "Couldn’t add that GIF."); loadMine(); }
  });
  function paintMine(gifs) {
    const add = h("button", { type: "button", class: "sticker-new gif-new", title: "Upload a GIF" }, icon("plus"), h("span", { text: "Add GIF" }), fileInput);
    add.addEventListener("click", (e) => { if (e.target !== fileInput) fileInput.click(); });
    const q = search.value.trim().toLowerCase();
    const shown = q ? gifs.filter((g) => (g.tags || []).join(" ").includes(q)) : gifs;
    grid.replaceChildren(h("div", { class: "gif-mine" }, add, ...shown.map((g) => tile(g, (b) => b.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      try { paintMine((await api(`/api/me/gifs/${g.id}`, { method: "DELETE" })).gifs); } catch {}
    })))));
    if (!gifs.length) grid.append(h("p", { class: "muted sticker-empty", text: "Tap ☆ on any GIF to keep it here, or add one from your device." }));
    foot.replaceChildren(tagsInput, h("span", { text: "Right-click (or hold) a GIF to remove it" }));
    place();
  }
  const loadMine = () => api("/api/me/gifs").then((d) => panel && lastTab === "mine" && paintMine(d.gifs)).catch(() => grid.replaceChildren(h("p", { class: "muted", text: "Couldn’t load your GIFs." })));

  function setTab(t) {
    lastTab = t;
    ++seq;
    tabSearch.classList.toggle("on", t === "search");
    moods.hidden = t !== "search";
    tabMine.classList.toggle("on", t === "mine");
    foot.replaceChildren();
    grid.replaceChildren(spinner());
    t === "search" ? runSearch() : loadMine();
  }
  tabSearch.addEventListener("click", () => setTab("search"));
  tabMine.addEventListener("click", () => setTab("mine"));
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => (lastTab === "search" ? runSearch() : loadMine()), 300);
  });
  search.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { closeGifs(); anchor.focus?.(); } });

  setTab(lastTab);
  place();
  if (!sheet) search.focus();
  const mine = panel;
  setTimeout(() => {
    const away = (e) => {
      if (panel !== mine) return document.removeEventListener("pointerdown", away);
      if (!panel.contains(e.target) && !anchor.contains(e.target)) { closeGifs(); document.removeEventListener("pointerdown", away); }
    };
    document.addEventListener("pointerdown", away);
  });
}

export function gifButton(onPick) {
  const b = h("button", { type: "button", class: "tool-btn gif-btn", "aria-label": "GIF", title: "GIF" }, h("span", { text: "GIF" }));
  b.addEventListener("click", () => openGifs(b, onPick));
  return b;
}
