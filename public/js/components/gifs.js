// GIF picker: LookBlog's own animated GIFs and the ones people uploaded, all searchable,
// plus your own collection ("Yours"). Upload a GIF once with a few tags and anyone can find it.
import { h, icon, toast, spinner } from "../ui.js";
import { api, upload } from "../api.js";

let panel = null;
export function closeGifs() { panel?.remove(); panel = null; }

// What to send to the server for a picked GIF
export const gifBody = (g) => (g.id ? { gif: g.id } : { gifUrl: g.url });

let lastQuery = "";
let lastTab = "search";
const MOODS = ["Happy", "LOL", "Love", "Wow", "Sad", "Party", "Hello", "Bye", "Yes", "No", "Thanks", "Angry", "Sleepy", "Cute"];

export function openGifs(anchor, onPick) {
  if (panel) return closeGifs();
  const pick = (g) => { closeGifs(); onPick(g); };
  const grid = h("div", { class: "gif-grid" }, spinner());
  const search = h("input", { type: "search", class: "gif-search", placeholder: "Search GIFs", "aria-label": "Search GIFs", value: lastQuery });
  const tabSearch = h("button", { type: "button", class: "gif-tab", text: "All GIFs" });
  const moods = h("div", { class: "gif-moods" }, ...MOODS.map((m) => {
    const b = h("button", { type: "button", class: "gif-mood", text: m });
    b.addEventListener("click", () => { search.value = search.value.trim().toLowerCase() === m.toLowerCase() ? "" : m; if (lastTab !== "search") setTab("search"); else runSearch(); search.focus(); });
    return b;
  }));
  const tabMine = h("button", { type: "button", class: "gif-tab", text: "Yours" });
  const foot = h("p", { class: "gif-foot muted" });
  panel = h("div", { class: "sticker-panel gif-panel", role: "dialog", "aria-label": "GIFs" },
    h("header", { class: "gif-head" }, h("div", { class: "gif-search-wrap" }, icon("search"), search), h("div", { class: "gif-tabs" }, tabSearch, tabMine), moods),
    grid, foot);
  document.body.append(panel);

  const place = () => {
    if (!panel) return;
    const a = anchor.getBoundingClientRect();
    const w = Math.min(380, innerWidth - 16);
    panel.style.width = w + "px";
    panel.style.left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), innerWidth - w - 8) + "px";
    const top = a.top - panel.offsetHeight - 8;
    panel.style.top = (top > 8 ? top : Math.max(8, Math.min(a.bottom + 8, innerHeight - panel.offsetHeight - 8))) + "px";
  };

  const tile = (g, extra) => {
    const b = h("button", { type: "button", class: "gif-item", title: g.title || "Send" }, h("img", { src: g.preview || g.url, alt: g.title || "GIF", loading: "lazy" }));
    b.addEventListener("click", () => pick(g));
    extra?.(b);
    if (g.id) return b;
    // Any GIF can be kept in "Yours"
    const keep = h("button", { type: "button", class: "gif-keep", title: "Keep in Yours", "aria-label": "Keep in Yours", text: "☆" });
    keep.addEventListener("click", async () => {
      try { await api("/api/me/gifs", { method: "POST", body: { saveUrl: g.url } }); keep.textContent = "★"; keep.classList.add("on"); toast("Saved to your GIFs."); }
      catch (err) { toast(err.error || "Couldn’t save it."); }
    });
    return h("div", { class: "gif-cell" }, b, keep);
  };

  /* ---------- Search ---------- */
  let seq = 0;
  async function runSearch() {
    const q = search.value.trim();
    lastQuery = q;
    const n = ++seq;
    grid.replaceChildren(spinner());
    try {
      const { results } = await api("/api/gifs/search?q=" + encodeURIComponent(q));
      if (n !== seq || !panel) return;
      grid.replaceChildren(...results.map((g) => tile(g)));
      if (!results.length) grid.append(h("p", { class: "muted sticker-empty", text: `No GIFs for “${q}”. Try another word, or add your own under “Yours”.` }));
      for (const b of moods.children) b.classList.toggle("on", b.textContent.toLowerCase() === q.toLowerCase());
      foot.replaceChildren();
      place();
    } catch { if (n === seq) grid.replaceChildren(h("p", { class: "muted", text: "Couldn’t search right now." })); }
  }

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
    grid.replaceChildren(add, ...shown.map((g) => tile(g, (b) => b.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      try { paintMine((await api(`/api/me/gifs/${g.id}`, { method: "DELETE" })).gifs); } catch {}
    }))));
    if (!gifs.length) grid.append(h("p", { class: "muted sticker-empty", text: "Add a GIF from your computer and tag it so people can find it." }));
    foot.replaceChildren(tagsInput, h("span", { text: "Right-click a GIF to remove it" }));
    place();
  }
  const loadMine = () => api("/api/me/gifs").then((d) => panel && lastTab === "mine" && paintMine(d.gifs)).catch(() => grid.replaceChildren(h("p", { class: "muted", text: "Couldn’t load your GIFs." })));

  function setTab(t) {
    lastTab = t;
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
  search.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeGifs(); anchor.focus?.(); } });

  setTab(lastTab);
  place();
  search.focus();
  setTimeout(() => {
    const away = (e) => { if (!panel) return document.removeEventListener("mousedown", away); if (!panel.contains(e.target) && !anchor.contains(e.target)) { closeGifs(); document.removeEventListener("mousedown", away); } };
    document.addEventListener("mousedown", away);
  });
}

export function gifButton(onPick) {
  const b = h("button", { type: "button", class: "tool-btn gif-btn", "aria-label": "GIF", title: "GIF" }, h("span", { text: "GIF" }));
  b.addEventListener("click", () => openGifs(b, onPick));
  return b;
}
