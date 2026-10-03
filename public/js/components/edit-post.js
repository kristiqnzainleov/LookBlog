// Edit your own post in place: click the text, change it, Save.
import { h, icon, toast, richText } from "../ui.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { attachMentions } from "./mentions.js";

const LIMITS = { post: 1000, short: 300, video: 5000, title: 100 };

/*
  makeEditable(el, post, field)
    el     – the element showing the text (it is swapped for a form while editing)
    field  – "text" or "title"
  After saving, every copy of this post on the page repaints (see repaintPost).
*/
export function makeEditable(el, post, field = "text") {
  if (!post.mine) return el;
  const limit = field === "title" ? LIMITS.title : LIMITS[post.type];
  el.classList.add("editable-text");
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.title = field === "title" ? "Click to edit the title" : "Click to edit";

  const start = (e) => {
    if (e?.target?.closest?.("a")) return; // let @mentions and links work
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (el.hidden) return;
    const multiline = field !== "title";
    const input = h(multiline ? "textarea" : "input", {
      class: "text-input edit-input" + (field === "title" ? " edit-title" : ""),
      rows: multiline ? 3 : null,
      maxlength: limit + 50,
      "aria-label": field === "title" ? "Title" : "Text",
    });
    input.value = post[field] || "";
    if (multiline) attachMentions(input);
    const counter = h("span", { class: "counter" });
    const save = h("button", { type: "submit", class: "btn btn-primary btn-xs", text: "Save" });
    const cancel = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Cancel" });
    const err = h("p", { class: "form-error", role: "alert", hidden: true });
    const form = h("form", { class: "edit-form", novalidate: true }, input, h("div", { class: "bio-bar" }, counter, cancel, save), err);

    const fit = () => { if (multiline) { input.style.height = "auto"; input.style.height = input.scrollHeight + 4 + "px"; } };
    const paintCount = () => {
      const n = [...input.value].length;
      counter.textContent = `${n} / ${limit}`;
      counter.className = "counter" + (n > limit ? " over" : "");
      save.disabled = n > limit || (field === "title" && !input.value.trim());
    };
    input.addEventListener("input", () => { paintCount(); fit(); });
    const stop = () => { form.remove(); el.hidden = false; };
    cancel.addEventListener("click", (ev) => { ev.stopPropagation(); stop(); });
    form.addEventListener("click", (ev) => ev.stopPropagation());
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.stopPropagation(); stop(); }
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey || !multiline)) { ev.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      save.disabled = true;
      save.textContent = "Saving…";
      try {
        const { post: updated } = await api(`/api/posts/${post.id}/edit`, { method: "POST", body: { [field]: input.value } });
        stop();
        repaintPost(updated);
        toast("Saved.");
      } catch (ex) {
        err.textContent = ex.error || "Couldn’t save that.";
        err.hidden = false;
        save.disabled = false;
        save.textContent = "Save";
      }
    });

    el.hidden = true;
    el.after(form);
    paintCount();
    fit();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  el.addEventListener("click", start);
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === el) start(e); });
  return el;
}

/* ---------- Keep every copy of a post on screen up to date ---------- */
const registry = new Map(); // post id -> Set of { post, paint }
export function track(post, paint) {
  if (!registry.has(post.id)) registry.set(post.id, new Set());
  const entry = { post, paint };
  registry.get(post.id).add(entry);
  return entry;
}
export function repaintPost(update) {
  for (const entry of registry.get(update.id) || []) {
    Object.assign(entry.post, { text: update.text, title: update.title, mentions: update.mentions, editedAt: update.editedAt });
    entry.paint();
  }
  // forget copies that left the page
  for (const [id, set] of registry) for (const e of set) if (e.dead?.()) set.delete(e);
}

// Text with @mentions, or a placeholder for my own empty post
export function postTextEl(post, cls = "post-text", { placeholder = null } = {}) {
  const el = h("p", { class: cls });
  const paint = () => {
    el.replaceChildren();
    if (post.text) el.append(richText(post.text, post.mentions));
    else if (post.mine && placeholder) { el.textContent = placeholder; el.classList.add("text-placeholder"); return; }
    el.classList.remove("text-placeholder");
    el.hidden = !post.text && !(post.mine && placeholder);
  };
  paint();
  const entry = track(post, paint);
  entry.dead = () => !el.isConnected;
  return el;
}

export function editedLabel(post) {
  const el = h("span", { class: "muted edited", text: "· Edited", title: "" });
  const paint = () => {
    el.hidden = !post.editedAt;
    if (post.editedAt) el.title = "Edited " + new Date(post.editedAt).toLocaleString("en-US");
  };
  paint();
  const entry = track(post, paint);
  entry.dead = () => !el.isConnected;
  return el;
}

// A title that follows edits (e.g. a video card's title)
export function liveTitle(post, tag, cls) {
  const el = h(tag, { class: cls, text: post.title });
  const entry = track(post, () => (el.textContent = post.title));
  entry.dead = () => !el.isConnected;
  return el;
}

// On my own post's page: move it to another category
export function categorySelect(post) {
  const sel = h("select", { class: "cat-select", "aria-label": "Category" },
    h("option", { value: "", text: "No category" }),
    ...(state.me.categories || []).map((c) => h("option", { value: c.id, text: c.name })));
  sel.value = post.category?.id || "";
  sel.addEventListener("change", async () => {
    try {
      const { post: up } = await api(`/api/posts/${post.id}/edit`, { method: "POST", body: { categoryId: sel.value || null } });
      post.category = up.category;
      toast(up.category ? `Moved to ${up.category.name}.` : "Removed from its category.");
    } catch (err) { toast(err.error || "Couldn’t change the category."); }
  });
  return h("label", { class: "cat-field act" }, icon("folder"), sel);
}
