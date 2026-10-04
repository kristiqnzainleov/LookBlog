// Highlights: groups of your stories that stay on your profile (like Instagram), each with a title and a cover.
import { h, modal, toast, confirmClick } from "../ui.js";
import { api, upload } from "../api.js";

const thumbOf = (s) => (s.media.kind === "video" ? s.media.poster || "" : s.media.url);
const dayLabel = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// The row of circles on a profile (plus "New" on your own)
export function highlightsRow(profile) {
  const row = h("div", { class: "hl-row", hidden: true });
  async function load() {
    let list = [];
    try { list = (await api(`/api/users/${encodeURIComponent(profile.username)}/highlights`)).highlights; } catch { return; }
    row.replaceChildren(
      ...(profile.isMe ? [h("button", { type: "button", class: "hl-item hl-new", onclick: () => openHighlightEditor({ onDone: load }) }, h("span", { class: "hl-circle" }, "+"), h("span", { class: "hl-title", text: "New" }))] : []),
      ...list.map((hl) => h("button", { type: "button", class: "hl-item", title: hl.title, onclick: () => watch(hl) },
        h("span", { class: "hl-circle" }, hl.cover ? h("img", { src: hl.cover, alt: "" }) : h("span", { class: "hl-empty", text: hl.title.slice(0, 1) })),
        h("span", { class: "hl-title", text: hl.title }))));
    row.hidden = !list.length && !profile.isMe;
  }
  async function watch(hl) {
    try {
      const { group, highlight } = await api(`/api/highlights/${hl.id}`);
      if (!group.stories.length) return toast("This highlight is empty.");
      group.highlight = highlight;
      const { openStories } = await import("./stories.js");
      openStories([group], 0, load);
    } catch (err) { toast(err.error || "Couldn’t open it."); }
  }
  load();
  row.reload = load;
  return row;
}

// Make a new highlight or change one: title, which stories, and the cover
export async function openHighlightEditor({ highlight = null, preselect = [], onDone } = {}) {
  let archive = [];
  try { archive = (await api("/api/stories/archive")).stories; } catch (err) { return toast(err.error || "Couldn’t load your stories."); }
  if (!archive.length) return toast("Post a story first, then you can add it to a highlight.");
  let picked = new Set(preselect);
  let coverStoryId = highlight?.coverStoryId || null, coverImage = null, coverPreview = highlight?.cover || null;
  if (highlight) {
    const { group } = await api(`/api/highlights/${highlight.id}`).catch(() => ({ group: { stories: [] } }));
    picked = new Set(group.stories.map((s) => s.id));
  }

  const title = h("input", { type: "text", class: "text-input", maxlength: 20, placeholder: "Highlight name", value: highlight?.title || "" });
  const coverCircle = h("span", { class: "hl-circle big" });
  const grid = h("div", { class: "hl-grid" });
  const coverRow = h("div", { class: "hl-cover-row" });
  const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true });
  const uploadBtn = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "📷 Upload a cover" });
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: highlight ? "Save" : "Add highlight" });
  const del = highlight ? h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "Delete highlight" }) : null;

  const currentCover = () => {
    if (coverImage) return coverPreview;
    const s = archive.find((x) => x.id === coverStoryId && picked.has(x.id)) || archive.slice().reverse().find((x) => picked.has(x.id));
    return s ? thumbOf(s) : coverPreview;
  };
  function paint() {
    const ordered = archive.filter((s) => picked.has(s.id)).reverse(); // oldest first, like when watching
    grid.replaceChildren(...archive.map((s) => {
      const n = ordered.indexOf(s) + 1;
      const tile = h("button", { type: "button", class: "hl-tile" + (picked.has(s.id) ? " on" : ""), title: dayLabel(s.createdAt) },
        h("img", { src: thumbOf(s), alt: "" }),
        s.media.kind === "video" ? h("span", { class: "hl-vid", text: "▶" }) : null,
        h("span", { class: "hl-date", text: dayLabel(s.createdAt) }),
        h("span", { class: "hl-check", text: n ? String(n) : "" }));
      tile.addEventListener("click", () => { if (picked.has(s.id)) picked.delete(s.id); else picked.add(s.id); paint(); });
      return tile;
    }));
    coverRow.replaceChildren(...ordered.map((s) => {
      const b = h("button", { type: "button", class: "hl-cover-pick" + (!coverImage && (coverStoryId === s.id) ? " on" : ""), title: "Use as cover" }, h("img", { src: thumbOf(s), alt: "" }));
      b.addEventListener("click", () => { coverStoryId = s.id; coverImage = null; paint(); });
      return b;
    }));
    const c = currentCover();
    coverCircle.replaceChildren(c ? h("img", { src: c, alt: "" }) : h("span", { class: "hl-empty", text: (title.value || "H").slice(0, 1) }));
    save.disabled = !picked.size;
  }
  uploadBtn.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files[0]; file.value = "";
    if (!f) return;
    uploadBtn.disabled = true; uploadBtn.textContent = "Uploading…";
    try { const up = await upload(f); coverImage = up.url; coverPreview = up.url; } catch (err) { toast(err.error || "Couldn’t upload it."); }
    uploadBtn.disabled = false; uploadBtn.textContent = "📷 Upload a cover";
    paint();
  });
  title.addEventListener("input", paint);

  const m = modal({ title: highlight ? "Edit highlight" : "New highlight", wide: true, body: h("div", { class: "create-form hl-editor" },
    h("div", { class: "hl-head" }, coverCircle, title),
    h("b", { class: "vis-label", text: "Stories" }),
    h("p", { class: "create-hint", text: "Your stories from the last 30 days. Stories in a highlight stay on your profile." }),
    grid,
    h("b", { class: "vis-label", text: "Cover" }),
    h("p", { class: "create-hint", text: "Pick one of the stories, or upload your own picture." }),
    coverRow, h("div", {}, uploadBtn, file),
    save, del) });

  save.addEventListener("click", async () => {
    save.disabled = true;
    const body = { title: title.value, storyIds: [...picked], ...(coverImage ? { coverImage } : coverStoryId ? { coverStoryId } : {}) };
    try {
      const r = highlight ? await api(`/api/highlights/${highlight.id}`, { method: "POST", body }) : await api("/api/highlights", { method: "POST", body });
      m.close();
      toast(r.deleted ? "Highlight deleted." : highlight ? "Highlight saved." : "Highlight added to your profile.");
      onDone?.();
    } catch (err) { toast(err.error || "Couldn’t save it."); save.disabled = false; }
  });
  if (del) confirmClick(del, "Sure?", async () => {
    try { await api(`/api/highlights/${highlight.id}`, { method: "DELETE" }); m.close(); toast("Highlight deleted. The stories stay in your archive."); onDone?.(); }
    catch (err) { toast(err.error || "Couldn’t delete it."); }
  });
  paint();
  setTimeout(() => title.focus(), 60);
}

// From the story viewer: put this story in one of my highlights, or start a new one
export async function addToHighlight(story, me, onDone) {
  let list = [];
  try { list = (await api(`/api/users/${encodeURIComponent(me.username)}/highlights`)).highlights; } catch {}
  const already = new Set(story.highlights || []);
  const m = modal({ title: "Add to highlight", body: h("div", { class: "hl-pick" },
    h("button", { type: "button", class: "hl-item hl-new", onclick: () => { m.close(); openHighlightEditor({ preselect: [story.id], onDone }); } }, h("span", { class: "hl-circle" }, "+"), h("span", { class: "hl-title", text: "New" })),
    ...list.map((hl) => {
      const on = already.has(hl.id);
      const b = h("button", { type: "button", class: "hl-item" + (on ? " added" : ""), title: on ? "Already in this highlight (tap to remove)" : `Add to ${hl.title}` },
        h("span", { class: "hl-circle" }, hl.cover ? h("img", { src: hl.cover, alt: "" }) : h("span", { class: "hl-empty", text: hl.title.slice(0, 1) }), on ? h("span", { class: "hl-tick", text: "✓" }) : null),
        h("span", { class: "hl-title", text: hl.title }));
      b.addEventListener("click", async () => {
        try {
          const r = await api(`/api/highlights/${hl.id}`, { method: "POST", body: on ? { remove: story.id } : { add: story.id } });
          if (on) already.delete(hl.id); else already.add(hl.id);
          story.highlights = [...already];
          m.close();
          toast(r.deleted ? "Removed. The highlight was empty, so it’s gone." : on ? `Removed from ${hl.title}.` : `Added to ${hl.title}.`);
          onDone?.();
        } catch (err) { toast(err.error || "Couldn’t do that."); }
      });
      return b;
    })) });
}
