// Fit a picture before saving it: drag to move it, zoom with the slider or the mouse wheel.
// Used for the profile photo (round) and the banner (wide).
// Nothing is cut off unless you want it to be: zoom out to fit the whole picture, and pick what fills the space
// around it (the picture blurred, or a colour). It can be turned too.
import { h, modal } from "../ui.js";

const BGS = [["blur", "Blur"], ["#000000", ""], ["#ffffff", ""], ["#ff4fa3", ""], ["#9b5cff", ""], ["#4cc9ff", ""], ["#2ee6a6", ""], ["#ffd23f", ""]];

/*
  openCropper(src, { aspect, round, outWidth, title }) -> Promise<Blob | null>
  src is a File or an image URL from this site.
*/
export function openCropper(src, { aspect = 1, round = false, outWidth = 800, title = "Adjust picture" } = {}) {
  return new Promise((resolve) => {
    const objectUrl = src instanceof Blob ? URL.createObjectURL(src) : null;
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.src = objectUrl || src;

    const view = h("div", { class: "crop-view" + (round ? " round" : "") });
    view.style.aspectRatio = String(aspect);
    const back = h("img", { class: "crop-back", alt: "", draggable: "false" });
    const pic = h("img", { class: "crop-img", alt: "", draggable: "false" });
    view.append(back, pic, h("div", { class: "crop-mask" }));
    const zoom = h("input", { type: "range", min: "0.2", max: "4", step: "0.01", value: "1", class: "crop-zoom", "aria-label": "Size" });
    const sizeOut = h("b", { class: "crop-size", text: "100%" });
    const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save", disabled: true });
    const cancel = h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "Cancel" });
    const fill = h("button", { type: "button", class: "se-chip", text: "▣ Fill" });
    const fit = h("button", { type: "button", class: "se-chip", text: "⤢ Fit whole photo" });
    const turn = h("button", { type: "button", class: "se-chip", text: "↻ Turn" });
    const bgRow = h("div", { class: "crop-bgs" });
    let done = false;
    const m = modal({
      title,
      body: h("div", { class: "cropper" },
        h("p", { class: "create-hint", text: "Drag to move it. Use the slider (or your mouse wheel) to make it bigger or smaller — zoom out to show the whole picture." }),
        view,
        h("div", { class: "crop-zoom-row" }, h("span", { text: "−" }), zoom, h("span", { text: "+" }), sizeOut),
        h("div", { class: "crop-tools" }, fill, fit, turn),
        h("div", { class: "crop-bg-row" }, h("small", { class: "muted", text: "Around it:" }), bgRow),
        h("div", { class: "crop-btns" }, cancel, save)),
      onClose: () => finish(null),
    });

    // cover = the scale that fills the frame; scale is relative to it (1 = fills, less = whole picture shows)
    let cover = 1, scale = 1, x = 0, y = 0, W = 0, H = 0, rot = 0, bg = "blur";
    const nat = () => (rot % 180 ? [img.naturalHeight, img.naturalWidth] : [img.naturalWidth, img.naturalHeight]);
    const fitScale = () => { const [nw, nh] = nat(); return Math.min(W / nw, H / nh) / cover; };
    const layout = () => {
      W = view.clientWidth; H = view.clientHeight;
      const [nw, nh] = nat();
      cover = Math.max(W / nw, H / nh);
      zoom.min = String(Math.min(1, Math.round(fitScale() * 100) / 100));
      clamp(); paint();
    };
    // Bigger than the frame: it can't leave a gap at an edge. Smaller: it stays inside the frame.
    const clamp = () => {
      const [nw, nh] = nat();
      const w = nw * cover * scale, hh = nh * cover * scale;
      const mx = Math.abs(w - W) / 2, my = Math.abs(hh - H) / 2;
      x = Math.max(-mx, Math.min(mx, x));
      y = Math.max(-my, Math.min(my, y));
    };
    const paint = () => {
      const s = cover * scale, w = img.naturalWidth * s, hh = img.naturalHeight * s;
      pic.style.width = w + "px";
      pic.style.height = hh + "px";
      pic.style.transform = `translate(${W / 2 - w / 2 + x}px, ${H / 2 - hh / 2 + y}px) rotate(${rot}deg)`;
      back.hidden = bg !== "blur";
      view.style.background = bg === "blur" ? "#000" : bg;
      zoom.value = String(scale);
      sizeOut.textContent = Math.round(scale * 100) + "%";
      bgRow.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.bg === bg));
    };
    bgRow.append(...BGS.map(([v, label]) => h("button", { type: "button", class: v === "blur" ? "se-chip" : "se-swatch", dataset: { bg: v }, style: v === "blur" ? "" : `background:${v}`, text: label, "aria-label": label || v, onclick: () => { bg = v; paint(); } })));

    img.onload = () => {
      pic.src = img.src; back.src = img.src;
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
      scale = Math.max(Number(zoom.min), Math.min(4, scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
      clamp(); paint();
    }, { passive: false });
    zoom.addEventListener("input", () => { scale = Number(zoom.value); clamp(); paint(); });
    fill.addEventListener("click", () => { scale = 1; x = 0; y = 0; clamp(); paint(); });
    fit.addEventListener("click", () => { scale = fitScale(); x = 0; y = 0; clamp(); paint(); });
    turn.addEventListener("click", () => { rot = (rot + 90) % 360; x = 0; y = 0; layout(); });

    cancel.addEventListener("click", () => { finish(null); m.close(); });
    save.addEventListener("click", () => {
      // Draw what the frame shows, at full quality: the background, then the picture where it sits
      const outW = outWidth, outH = Math.round(outW / aspect), k = outW / W;
      const c = document.createElement("canvas");
      c.width = outW; c.height = outH;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      if (bg === "blur") {
        // the picture, blown up and blurred, behind it
        const [nw, nh] = nat(), cs = Math.max(outW / nw, outH / nh);
        ctx.save(); ctx.filter = "blur(24px) brightness(0.8)";
        ctx.translate(outW / 2, outH / 2); ctx.rotate((rot * Math.PI) / 180);
        const bw = img.naturalWidth * cs * 1.1, bh = img.naturalHeight * cs * 1.1;
        ctx.drawImage(img, -bw / 2, -bh / 2, bw, bh);
        ctx.restore();
      } else { ctx.fillStyle = bg; ctx.fillRect(0, 0, outW, outH); }
      const s = cover * scale * k, w = img.naturalWidth * s, hh = img.naturalHeight * s;
      ctx.save();
      ctx.translate(outW / 2 + x * k, outH / 2 + y * k);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -hh / 2, w, hh);
      ctx.restore();
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
