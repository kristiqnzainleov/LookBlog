// Choosing a video's thumbnail: a frame from the video by default, or your own picture.
import { h, icon, toast, modal } from "../ui.js";
import { api, upload } from "../api.js";

const IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp";

/*
  thumbnailField({ vertical }) — used while posting a video or short.
  setAuto(url) gives it the frame taken from the video; value() is the picture to use.
*/
export function thumbnailField({ vertical = false } = {}) {
  let auto = null, custom = null, uploading = false;
  const img = h("div", { class: "thumb-pick-img" + (vertical ? " vertical" : "") });
  const label = h("span", { class: "thumb-pick-label" });
  const input = h("input", { type: "file", accept: IMAGE_TYPES, hidden: true });
  const choose = h("button", { type: "button", class: "btn btn-xs btn-outline-light" }, icon("image"), h("span", { text: "Upload thumbnail" }));
  const reset = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Use a frame from the video" });
  const el = h("div", { class: "thumb-pick" },
    img,
    h("div", { class: "thumb-pick-side" },
      h("b", { text: "Thumbnail" }),
      label,
      h("div", { class: "thumb-pick-btns" }, choose, reset),
      input
    )
  );

  function paint() {
    const url = custom || auto;
    img.style.backgroundImage = url ? `url("${url}")` : "";
    img.classList.toggle("empty", !url);
    label.textContent = uploading ? "Uploading…" : custom ? "Your picture. People see it before they press play." : auto ? "A frame from your video. You can upload your own picture instead." : "Upload a picture people see before they press play. If you skip it, we use a frame from the video.";
    img.replaceChildren(url ? "" : h("span", { class: "thumb-pick-empty" }, icon("image"), h("span", { text: "No thumbnail yet" })));
    reset.hidden = !custom || !auto;
  }
  choose.addEventListener("click", () => input.click());
  reset.addEventListener("click", () => { custom = null; paint(); });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast("Thumbnails can be up to 15 MB.");
    const before = custom;
    custom = URL.createObjectURL(file);
    uploading = true;
    paint();
    img.classList.add("uploading");
    try { custom = (await upload(file)).url; }
    catch (err) { custom = before; toast(err.error || "Upload failed. Try again."); }
    uploading = false;
    img.classList.remove("uploading");
    paint();
    onChange();
  });

  let onChange = () => {};
  paint();
  return {
    el,
    show: (yes) => { el.hidden = !yes; if (!yes) { custom = null; auto = null; paint(); } },
    setAuto: (url) => { auto = url || null; paint(); },
    value: () => custom || auto || null,
    busy: () => uploading,
    onChange: (fn) => (onChange = fn),
  };
}

/* ---------- Change the thumbnail of a video that's already posted ---------- */
export function openChangeThumbnail(post, onDone) {
  const vertical = post.type === "short";
  const video = post.media.find((m) => m.kind === "video");
  let chosen = null;
  const img = h("div", { class: "thumb-pick-img big" + (vertical ? " vertical" : "") });
  const paint = () => {
    const url = chosen || video.poster;
    img.style.backgroundImage = url ? `url("${url}")` : "";
    img.classList.toggle("empty", !url);
  };
  const input = h("input", { type: "file", accept: IMAGE_TYPES, hidden: true });
  const choose = h("button", { type: "button", class: "btn btn-sm btn-outline-light" }, icon("image"), h("span", { text: "Choose a picture" }));
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save thumbnail", disabled: true });
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  choose.addEventListener("click", () => input.click());
  img.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    err.hidden = true;
    chosen = URL.createObjectURL(file);
    paint();
    img.classList.add("uploading");
    save.disabled = true;
    try {
      chosen = (await upload(file)).url;
      save.disabled = false;
    } catch (ex) {
      chosen = null;
      err.textContent = ex.error || "Upload failed. Try again.";
      err.hidden = false;
    }
    img.classList.remove("uploading");
    paint();
  });
  const m = modal({
    title: "Change thumbnail",
    body: h("div", { class: "create-form" },
      h("p", { class: "create-hint", text: "This is the picture people see before they press play." }),
      img, h("div", { class: "thumb-change-btns" }, choose), input, err, save),
  });
  save.addEventListener("click", async () => {
    save.disabled = true;
    save.textContent = "Saving…";
    try {
      const { poster } = await api(`/api/posts/${post.id}/thumbnail`, { method: "POST", body: { poster: chosen } });
      video.poster = poster;
      m.close();
      toast("Thumbnail updated.");
      onDone?.(poster);
    } catch (ex) {
      err.textContent = ex.error || "Couldn’t save the thumbnail.";
      err.hidden = false;
      save.disabled = false;
      save.textContent = "Save thumbnail";
    }
  });
  paint();
}
