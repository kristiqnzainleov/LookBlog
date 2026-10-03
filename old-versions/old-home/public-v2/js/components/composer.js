// Writing posts: the box at the top of the feed, and the "Create" pop-up (post, short, video).
import { h, avatar, toast, modal } from "../ui.js";
import { api } from "../api.js";
import { state, emit } from "../state.js";
import { createPicker } from "./media-picker.js";

const LIMIT = { post: 1000, short: 300, video: 5000, title: 100 };
const chars = (s) => [...s].length;

function counter(textarea, limit) {
  const el = h("span", { class: "counter" });
  const paint = () => {
    const left = limit - chars(textarea.value);
    el.textContent = left <= Math.min(100, limit * 0.2) ? String(left) : "";
    el.className = "counter" + (left < 0 ? " over" : left <= 20 ? " warn" : "");
  };
  textarea.addEventListener("input", paint);
  paint();
  return { el, over: () => chars(textarea.value) > limit, paint };
}

function autoGrow(t) {
  const fit = () => { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; };
  t.addEventListener("input", fit);
  return fit;
}

async function publish(body) {
  const { post } = await api("/api/posts", { method: "POST", body });
  emit("post:created", post);
  return post;
}

/* ---------- Box at the top of the feed ---------- */
export function inlineComposer() {
  const text = h("textarea", { rows: 2, placeholder: "What did you see today?", "aria-label": "Write a post" });
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-sm", text: "Post", disabled: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const picker = createPicker({ accept: "both", max: 4, onChange: update, onError: showErr });
  const cnt = counter(text, LIMIT.post);
  const fit = autoGrow(text);

  function update() {
    submit.disabled = picker.busy() || cnt.over() || (!text.value.trim() && !picker.media().length);
    submit.textContent = picker.busy() ? "Uploading…" : "Post";
  }
  text.addEventListener("input", update);
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  // Paste or drop photos straight into the box
  text.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); picker.add(files); }
  });

  const form = h("form", { class: "composer", novalidate: true },
    avatar(state.me, 42),
    h("div", { class: "composer-main" },
      text,
      picker.previews,
      h("div", { class: "composer-bar" }, picker.button, h("span", { class: "composer-hint", text: "Ctrl + Enter to post" }), cnt.el, submit),
      err
    )
  );
  form.addEventListener("dragover", (e) => { e.preventDefault(); form.classList.add("drop"); });
  form.addEventListener("dragleave", () => form.classList.remove("drop"));
  form.addEventListener("drop", (e) => { e.preventDefault(); form.classList.remove("drop"); picker.add([...e.dataTransfer.files]); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    showErr("");
    submit.disabled = true;
    submit.textContent = "Posting…";
    try {
      await publish({ type: "post", text: text.value, media: picker.media() });
      text.value = "";
      picker.clear();
      cnt.paint();
      fit();
    } catch (ex) {
      showErr(ex.error || "Couldn’t post that. Try again.");
    }
    update();
  });
  return form;
}

/* ---------- "Create" pop-up ---------- */
export function openCreate(kind = "post") {
  const tabs = h("div", { class: "seg", role: "tablist" });
  const panel = h("div", { class: "create-panel" });
  let current = null;
  const m = modal({ title: "Create", body: [tabs, panel], wide: true });

  const kinds = [
    ["post", "Post"],
    ["short", "Short"],
    ["video", "Video"],
  ];
  for (const [k, label] of kinds) {
    const b = h("button", { type: "button", role: "tab", class: "seg-btn", text: label });
    b.addEventListener("click", () => show(k));
    b.dataset.kind = k;
    tabs.append(b);
  }

  function show(k) {
    if (current?.busy?.()) { toast("Wait for the upload to finish, or remove it first."); return; }
    tabs.querySelectorAll(".seg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.kind === k);
      b.setAttribute("aria-selected", String(b.dataset.kind === k));
    });
    current = createForm(k, () => m.close());
    panel.replaceChildren(current.el);
    setTimeout(() => current.focus(), 50);
  }
  show(kind);
}

function createForm(kind, close) {
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const showErr = (msg) => { err.textContent = msg; err.hidden = !msg; };
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-full", disabled: true });
  const label = { post: "Post", short: "Post short", video: "Post video" }[kind];

  const picker = createPicker({
    accept: kind === "post" ? "both" : "video",
    max: kind === "post" ? 4 : 1,
    maxVideoSeconds: kind === "short" ? 90 : null,
    onChange: update,
    onError: showErr,
  });

  const title = kind === "video" ? h("input", { type: "text", maxlength: 120, placeholder: "Title", "aria-label": "Title", class: "text-input" }) : null;
  const text = h("textarea", {
    rows: kind === "video" ? 4 : 3,
    class: "text-input",
    placeholder: kind === "post" ? "What did you see today?" : kind === "short" ? "Add a caption" : "Tell people about your video",
    "aria-label": kind === "video" ? "Description" : "Text",
  });
  const cnt = counter(text, LIMIT[kind]);
  autoGrow(text);

  const hint = {
    post: "Write something and add up to 4 photos or one video.",
    short: "A vertical video up to 90 seconds. It shows up in Shorts.",
    video: "Any length. It shows up in Videos with its own page.",
  }[kind];

  const dropZone = kind === "post" ? null : h("button", { type: "button", class: "drop-zone" },
    h("b", { text: kind === "short" ? "Choose a short video" : "Choose a video" }),
    h("span", { text: "MP4, MOV or WebM" })
  );
  dropZone?.addEventListener("click", () => picker.open());

  function update() {
    const media = picker.media();
    let ok = !picker.busy() && !cnt.over();
    if (kind === "post") ok = ok && (text.value.trim() || media.length);
    else ok = ok && media.length === 1;
    if (kind === "video") ok = ok && title.value.trim() && chars(title.value.trim()) <= LIMIT.title;
    submit.disabled = !ok;
    submit.textContent = picker.busy() ? "Uploading…" : label;
    if (dropZone) dropZone.hidden = picker.items().length > 0;
  }
  text.addEventListener("input", update);
  title?.addEventListener("input", update);

  const el = h("form", { class: "create-form", novalidate: true },
    h("p", { class: "create-hint", text: hint }),
    dropZone,
    picker.previews,
    title,
    text,
    h("div", { class: "composer-bar" }, kind === "post" ? picker.button : null, h("span", { style: "margin-right:auto" }), cnt.el),
    err,
    submit
  );
  if (kind !== "post") el.append(picker.button), (picker.button.hidden = true);

  el.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    showErr("");
    submit.disabled = true;
    submit.textContent = "Posting…";
    try {
      const post = await publish({ type: kind, text: text.value, title: title?.value || "", media: picker.media() });
      close();
      toast(kind === "short" ? "Your short is up." : kind === "video" ? "Your video is up." : "Posted.");
      emit("navigate-after-create", post);
    } catch (ex) {
      showErr(ex.error || "Couldn’t post that. Try again.");
      update();
    }
  });
  update();
  return { el, busy: () => picker.busy(), focus: () => (kind === "video" ? (picker.items().length ? title : dropZone) : kind === "short" ? dropZone : text)?.focus() };
}
