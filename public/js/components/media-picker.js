// Picking, uploading and previewing photos and videos.
import { h, icon, duration as fmtDuration } from "../ui.js";
import { upload } from "../api.js";
// Violence, blood, weapons… aren't allowed: a photo the check flags is taken out right away
const NOT_ALLOWED = "This isn’t allowed on LookBlog. Violence, blood, weapons, self-harm and other disturbing content go against the LookBlog rules.";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

// Read a video's length and size in the browser, and grab a frame to use as its cover
export function inspectVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    let info = null;
    const done = (poster = null) => {
      URL.revokeObjectURL(url);
      resolve(info ? { ...info, posterBlob: poster } : null);
    };
    const timeout = setTimeout(() => done(), 8000);
    v.onerror = () => { clearTimeout(timeout); done(); };
    let measuring = false;
    v.onloadedmetadata = () => {
      info = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
      if (v.duration === Infinity) {
        // Some recordings don't store their length: jump to the end to find it
        measuring = true;
        v.currentTime = 1e7;
        return;
      }
      v.currentTime = Math.min(1, (v.duration || 2) / 4);
    };
    v.ondurationchange = () => {
      if (measuring && Number.isFinite(v.duration)) {
        measuring = false;
        info.duration = v.duration;
        v.currentTime = Math.min(1, v.duration / 4);
      }
    };
    v.onseeked = () => {
      if (measuring) return;
      try {
        const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((blob) => { clearTimeout(timeout); done(blob); }, "image/jpeg", 0.82);
      } catch {
        clearTimeout(timeout);
        done();
      }
    };
  });
}

// Big photos (straight from a phone camera) are made smaller before they go up: much faster to send
async function shrinkPhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const MAX = 2048, k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const type = "image/jpeg";
    const blob = await new Promise((ok) => c.toBlob(ok, type, 0.86));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type });
  } catch { return file; }
}

function imageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({}); };
    img.src = url;
  });
}

/*
  createPicker({ accept: "image" | "video" | "both", max, maxVideoSeconds, onChange })
  Returns { button, previews, open(), items(), media(), busy(), clear() }
*/
export function createPicker({ accept = "both", max = 4, maxVideoSeconds = null, onChange = () => {}, onError = () => {} } = {}) {
  const types = accept === "image" ? IMAGE_TYPES : accept === "video" ? VIDEO_TYPES : [...IMAGE_TYPES, ...VIDEO_TYPES];
  const input = h("input", { type: "file", accept: types.join(","), multiple: accept !== "video" && max > 1, hidden: true });
  const previews = h("div", { class: "picker-previews" });
  let items = []; // { file, kind, url, poster, duration, width, height, progress, status, el }

  const label = accept === "video" ? "Add video" : accept === "image" ? "Add photo" : "Add photo or video";
  const button = h("button", { type: "button", class: "tool-btn", title: label, "aria-label": label },
    icon(accept === "video" ? "video" : "image"), input);
  button.addEventListener("click", (e) => {
    if (e.target === input) return;
    // On a phone: LookBlog's own choice first (library, camera…), not straight to the browser's menu
    if (matchMedia("(hover: none), (max-width: 640px)").matches) { e.preventDefault(); return attachSheet(); }
    input.click();
  });
  // A one-off file input (camera, video camera, files) that hands what you pick to the picker
  const pickWith = (attrs) => {
    const tmp = h("input", { type: "file", hidden: true, ...attrs });
    tmp.addEventListener("change", () => { add([...tmp.files]); tmp.remove(); });
    document.body.append(tmp);
    tmp.click();
  };
  function attachSheet() {
    document.querySelector(".att-wrap")?.remove();
    const opt = (ic, title, sub, fn) => { const b = h("button", { type: "button", class: "att-opt" }, h("span", { class: "att-ic", text: ic }), h("span", { class: "att-txt" }, h("b", { text: title }), h("small", { text: sub }))); b.addEventListener("click", () => { close(); setTimeout(fn, 60); }); return b; };
    const imgs = IMAGE_TYPES.join(","), vids = VIDEO_TYPES.join(",");
    const opts = [
      // The gallery: "image/*"/"video/*" only (no camera, no files), so Android opens its photo picker straight away
      opt("🖼️", "Gallery", accept === "image" ? "Your photos" : "Your photos and videos",
        () => pickWith({ accept: accept === "image" ? "image/*" : accept === "video" ? "video/*" : "image/*,video/*", multiple: accept !== "video" && max > 1 })),
      accept !== "video" ? opt("📷", "Take a photo", "Use the camera now", () => pickWith({ accept: "image/*", capture: "environment" })) : null,
      accept !== "image" ? opt("🎥", "Record a video", "Use the camera now", () => pickWith({ accept: "video/*", capture: "environment" })) : null,
      opt("🤳", "Selfie", "The front camera", () => pickWith({ accept: accept === "video" ? "video/*" : "image/*", capture: "user" })),
      // Files: the file browser (not the gallery)
      opt("📁", "Files", "Choose from your files", () => pickWith({ accept: "*/*", multiple: accept !== "video" && max > 1 })),
    ].filter(Boolean);
    const cancel = h("button", { type: "button", class: "att-cancel", text: "Cancel" });
    const card = h("div", { class: "att-card" }, h("i", { class: "att-grab" }), h("p", { class: "att-title", text: label }), ...opts, cancel);
    const wrap = h("div", { class: "att-wrap" }, card);
    const close = () => { wrap.classList.add("out"); setTimeout(() => wrap.remove(), 200); };
    cancel.addEventListener("click", close);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    import("../ui.js").then((m) => m.swipeDownToClose?.(card, close));
    document.body.append(wrap);
  }
  input.addEventListener("change", () => {
    add([...input.files]);
    input.value = "";
  });

  function changed() {
    const hasVideo = items.some((i) => i.kind === "video");
    button.disabled = hasVideo || items.length >= max;
    previews.hidden = !items.length;
    onChange();
  }

  async function add(files) {
    for (const file of files) {
      const kind = IMAGE_TYPES.includes(file.type) ? "image" : VIDEO_TYPES.includes(file.type) ? "video" : null;
      if (!kind || !types.includes(file.type)) { onError("Use a JPG, PNG, GIF or WebP photo, or an MP4, MOV or WebM video."); continue; }
      if (kind === "video" && items.length) { onError("Add up to 4 photos, or one video."); continue; }
      if (kind === "image" && items.some((i) => i.kind === "video")) { onError("Add up to 4 photos, or one video."); continue; }
      if (items.length >= max) { onError(max === 1 ? "You can add one file here." : `You can add up to ${max} photos.`); break; }

      const item = { file, kind, progress: 0, status: "uploading" };
      items.push(item);
      item.el = previewEl(item);
      previews.append(item.el);
      changed();
      start(item);
    }
  }

  async function start(item) {
    try {
      if (item.kind === "video") {
        const info = await inspectVideo(item.file);
        if (info) Object.assign(item, { duration: info.duration, width: info.width, height: info.height });
        if (maxVideoSeconds && (!info || !Number.isFinite(info.duration))) throw { error: "We couldn’t read this video. Try an MP4 file." };
        if (maxVideoSeconds && info.duration > maxVideoSeconds + 0.5) throw { error: `Shorts can be up to ${maxVideoSeconds} seconds. This one is ${fmtDuration(info.duration)}.` };
        if (info?.posterBlob) {
          item.check = import("./nsfw.js").then((m) => m.checkImage(info.posterBlob)); // the checks on the first frame
          item.check.then((r) => { if (r.sensitive && items.includes(item)) { item.status = "error"; remove(item); onError(NOT_ALLOWED); } });
          const poster = await upload(new File([info.posterBlob], "cover.jpg", { type: "image/jpeg" }));
          item.poster = poster.url;
        }
        paintMeta(item);
      } else {
        item.file = await shrinkPhoto(item.file);
        item.check = import("./nsfw.js").then((m) => m.checkImage(item.file)); // the checks, while it uploads
        // Not allowed (weapons, violence…): out of the post the moment it's found
        item.check.then((r) => { if (r.sensitive && items.includes(item)) { item.status = "error"; remove(item); onError(NOT_ALLOWED); } });
        Object.assign(item, await imageSize(item.file));
      }
      const res = await upload(item.file, (p) => { item.progress = p; paintProgress(item); });
      item.url = res.url;
      // Sensitive (18+)? Marked, so others see it blurred
      if (item.check) {
        // (never wait long for the check: if it isn't ready a few seconds after the upload, go on)
        const r = await Promise.race([item.check, new Promise((ok) => setTimeout(() => ok({}), 3500))]);
        if (r.sensitive || !items.includes(item)) return; // already taken out
        item.nsfw = r.nsfw;
        if (r.nsfw) { item.el?.classList.add("is-nsfw"); item.el?.append(h("span", { class: "preview-nsfw", title: "Marked as sensitive (18+): others see it blurred", text: "🔞" })); onError("This looks sensitive (18+). It will be posted blurred, and people tap to see it."); }
      }
      item.status = "done";
    } catch (err) {
      item.status = "error";
      onError(err.error || "Upload failed. Try again.");
      remove(item);
      return;
    }
    paintProgress(item);
    changed();
  }

  function previewEl(item) {
    const objectUrl = URL.createObjectURL(item.file);
    item.objectUrl = objectUrl;
    const media = item.kind === "image"
      ? h("img", { src: objectUrl, alt: "" })
      : h("video", { src: objectUrl, muted: true, playsInline: true, preload: "metadata" });
    const removeBtn = h("button", { type: "button", class: "preview-remove", "aria-label": "Remove" }, icon("close"));
    removeBtn.addEventListener("click", () => remove(item));
    return h("div", { class: `preview preview-${item.kind}` },
      media,
      h("span", { class: "preview-meta" }),
      h("div", { class: "preview-progress" }, h("span")),
      removeBtn
    );
  }
  function paintProgress(item) {
    const bar = item.el?.querySelector(".preview-progress");
    if (!bar) return;
    bar.firstChild.style.width = Math.round(item.progress * 100) + "%";
    bar.hidden = item.status === "done";
  }
  function paintMeta(item) {
    const meta = item.el?.querySelector(".preview-meta");
    if (meta && item.duration) meta.textContent = fmtDuration(item.duration);
  }
  function remove(item) {
    items = items.filter((i) => i !== item);
    item.el?.remove();
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    changed();
  }

  previews.hidden = true;
  return {
    button,
    previews,
    open: () => input.click(),
    add,
    items: () => items,
    busy: () => items.some((i) => i.status === "uploading"),
    media: () => items.filter((i) => i.status === "done").map((i) => ({
      url: i.url, poster: i.poster, duration: i.duration, width: i.width, height: i.height, ...(i.nsfw ? { nsfw: true } : {}),
    })),
    clear: () => [...items].forEach(remove),
  };
}
