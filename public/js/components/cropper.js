// Fit a picture before saving it: drag to move it, zoom with the slider or the mouse wheel.
// Used for the profile photo (round) and the banner (wide).
import { h, modal } from "../ui.js";

/*
  openCropper(src, { aspect, round, outWidth, title }) -> Promise<Blob | null>
  src is a File or an image URL from this site.
*/
export function openCropper(src, { aspect = 1, round = false, outWidth = 800, title = "Adjust picture" } = {}) {
  return new Promise((resolve) => {
    const objectUrl = src instanceof Blob ? URL.createObjectURL(src) : null;
    const img = new Image();
    img.decoding = "async";
    img.src = objectUrl || src;

    const view = h("div", { class: "crop-view" + (round ? " round" : "") });
    view.style.aspectRatio = String(aspect);
    const pic = h("img", { class: "crop-img", alt: "", draggable: "false" });
    view.append(pic, h("div", { class: "crop-mask" }));
    const zoom = h("input", { type: "range", min: "1", max: "4", step: "0.01", value: "1", class: "crop-zoom", "aria-label": "Zoom" });
    const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save", disabled: true });
    const cancel = h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "Cancel" });
    let done = false;
    const m = modal({
      title,
      body: h("div", { class: "cropper" },
        h("p", { class: "create-hint", text: "Drag to move it. Use the slider or your mouse wheel to zoom." }),
        view,
        h("div", { class: "crop-zoom-row" }, h("span", { text: "−" }), zoom, h("span", { text: "+" })),
        h("div", { class: "crop-btns" }, cancel, save)),
      onClose: () => finish(null),
    });

    let base = 1, scale = 1, x = 0, y = 0, W = 0, H = 0;
    // x, y: where the picture's centre sits, relative to the frame's centre (in frame pixels)
    const layout = () => {
      W = view.clientWidth; H = view.clientHeight;
      base = Math.max(W / img.naturalWidth, H / img.naturalHeight); // "cover" the frame
      clamp();
      paint();
    };
    const clamp = () => {
      const w = img.naturalWidth * base * scale, hh = img.naturalHeight * base * scale;
      const mx = (w - W) / 2, my = (hh - H) / 2;
      x = Math.max(-mx, Math.min(mx, x));
      y = Math.max(-my, Math.min(my, y));
    };
    const paint = () => {
      const w = img.naturalWidth * base * scale, hh = img.naturalHeight * base * scale;
      pic.style.width = w + "px";
      pic.style.height = hh + "px";
      pic.style.transform = `translate(${W / 2 - w / 2 + x}px, ${H / 2 - hh / 2 + y}px)`;
    };

    img.onload = () => {
      pic.src = img.src;
      save.disabled = false;
      requestAnimationFrame(layout);
    };
    img.onerror = () => finish(null);
    window.addEventListener("resize", layout);

    let drag = null;
    view.addEventListener("pointerdown", (e) => { view.setPointerCapture(e.pointerId); drag = { sx: e.clientX, sy: e.clientY, ox: x, oy: y }; view.classList.add("dragging"); });
    view.addEventListener("pointermove", (e) => { if (!drag) return; x = drag.ox + e.clientX - drag.sx; y = drag.oy + e.clientY - drag.sy; clamp(); paint(); });
    view.addEventListener("pointerup", () => { drag = null; view.classList.remove("dragging"); });
    view.addEventListener("wheel", (e) => {
      e.preventDefault();
      scale = Math.max(1, Math.min(4, scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
      zoom.value = String(scale);
      clamp(); paint();
    }, { passive: false });
    zoom.addEventListener("input", () => { scale = Number(zoom.value); clamp(); paint(); });

    cancel.addEventListener("click", () => { finish(null); m.close(); });
    save.addEventListener("click", () => {
      // Cut the visible part out of the full-size picture
      const s = base * scale;
      const w = img.naturalWidth * s, hh = img.naturalHeight * s;
      const left = (w / 2 - x - W / 2) / s, top = (hh / 2 - y - H / 2) / s;
      const outW = Math.min(outWidth, Math.round(W / s));
      const outH = Math.round(outW / aspect);
      const c = document.createElement("canvas");
      c.width = outW; c.height = outH;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, left, top, W / s, H / s, 0, 0, outW, outH);
      save.disabled = true;
      save.textContent = "Saving…";
      c.toBlob((blob) => { finish(blob); m.close(); }, "image/jpeg", 0.9);
    });

    function finish(v) {
      if (done) return;
      done = true;
      window.removeEventListener("resize", layout);
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      resolve(v);
    }
  });
}
