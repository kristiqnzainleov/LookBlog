// Crop & size: choose the part of a picture you keep and its proportions — drag the box and its handles,
// pick a shape (Original, Free, 1:1, 4:5, 16:9…) or type the exact size in pixels.
// openFreeCrop(src) -> Promise<{ blob, width, height } | null>
import { h, modal, toast } from "../ui.js";

const RATIOS = [["original", "Original"], ["free", "Free"], ["1:1", "1:1"], ["4:5", "4:5"], ["3:4", "3:4"], ["2:3", "2:3"], ["9:16", "9:16"], ["16:9", "16:9"], ["3:2", "3:2"]];

export function openFreeCrop(src, { title = "Crop & size", type = "image/jpeg" } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    const pic = h("img", { class: "fc-img", alt: "", draggable: "false" });
    const box = h("div", { class: "fc-box" }, ...["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((d) => h("i", { class: "fc-h fc-" + d, dataset: { d } })), h("span", { class: "fc-grid" }));
    const stage = h("div", { class: "fc-stage" }, pic, h("div", { class: "fc-shade" }), box);
    const ratios = h("div", { class: "fc-ratios" });
    const wIn = h("input", { type: "number", class: "fc-num", min: 16, step: 1, "aria-label": "Width in pixels" });
    const hIn = h("input", { type: "number", class: "fc-num", min: 16, step: 1, "aria-label": "Height in pixels" });
    const info = h("small", { class: "muted fc-info" });
    const apply = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Use this size", disabled: true });
    const cancel = h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "Cancel" });
    let done = false;
    const md = modal({ title, wide: true, onClose: () => finish(null),
      body: h("div", { class: "fc" }, stage, ratios,
        h("div", { class: "fc-size" }, h("span", { text: "Size" }), wIn, h("b", { text: "×" }), hIn, h("span", { class: "muted", text: "px" }), info),
        h("div", { class: "crop-btns" }, cancel, apply)) });

    // The crop, in the picture's own pixels
    let NW = 0, NH = 0, ratio = "original", c = { x: 0, y: 0, w: 0, h: 0 }, k = 1; // k: screen px per picture px
    const lock = () => (ratio === "free" ? 0 : ratio === "original" ? NW / NH : (([a, b]) => a / b)(ratio.split(":").map(Number)));
    // (a margin around the picture, so the handles can be grabbed at its edges too)
    const PAD = 16;
    const layout = () => {
      const maxW = stage.clientWidth - PAD * 2, maxH = Math.min(innerHeight * 0.55, 560);
      k = Math.min(maxW / NW, maxH / NH);
      pic.style.width = NW * k + "px"; pic.style.height = NH * k + "px";
      pic.style.top = PAD + "px";
      stage.style.height = NH * k + PAD * 2 + "px";
      paint();
    };
    const fitRatio = () => {
      const r = lock();
      if (!r) return;
      // the biggest box of that shape that fits, centred on the current one
      let w = NW, hh = NW / r;
      if (hh > NH) { hh = NH; w = NH * r; }
      const cx = c.w ? c.x + c.w / 2 : NW / 2, cy = c.h ? c.y + c.h / 2 : NH / 2;
      c = { w, h: hh, x: Math.max(0, Math.min(NW - w, cx - w / 2)), y: Math.max(0, Math.min(NH - hh, cy - hh / 2)) };
    };
    const paint = () => {
      const off = (stage.clientWidth - NW * k) / 2;
      pic.style.left = off + "px";
      Object.assign(box.style, { left: off + c.x * k + "px", top: PAD + c.y * k + "px", width: c.w * k + "px", height: c.h * k + "px" });
      if (document.activeElement !== wIn) wIn.value = String(Math.round(c.w));
      if (document.activeElement !== hIn) hIn.value = String(Math.round(c.h));
      const g = (a, b) => (b ? g(b, a % b) : a), W = Math.round(c.w), H = Math.round(c.h), d = g(W, H) || 1;
      info.textContent = W / d <= 50 ? `${W / d}:${H / d}` : `${(W / H).toFixed(2)}:1`;
      ratios.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.r === ratio));
    };
    ratios.append(...RATIOS.map(([r, label]) => h("button", { type: "button", class: "se-chip", dataset: { r }, text: label, onclick: () => { ratio = r; if (r === "original") c = { x: 0, y: 0, w: NW, h: NH }; else fitRatio(); paint(); } })));

    // Drag the box to move it; drag a handle to resize (keeping the shape if one is picked)
    stage.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest(".fc-h")?.dataset.d;
      if (!handle && !e.target.closest(".fc-box")) return;
      e.preventDefault();
      const start = { ...c }, sx = e.clientX, sy = e.clientY, r = lock();
      if (ratio === "original" && handle) ratio = "free";
      const move = (ev) => {
        const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
        if (!handle) { c.x = Math.max(0, Math.min(NW - c.w, start.x + dx)); c.y = Math.max(0, Math.min(NH - c.h, start.y + dy)); return paint(); }
        let { x, y, w, h: hh } = start;
        if (handle.includes("e")) w = start.w + dx;
        if (handle.includes("w")) { w = start.w - dx; x = start.x + dx; }
        if (handle.includes("s")) hh = start.h + dy;
        if (handle.includes("n")) { hh = start.h - dy; y = start.y + dy; }
        const rr = lock() || (r && ratio !== "free" ? r : 0);
        if (rr) { if (handle === "n" || handle === "s") w = hh * rr; else hh = w / rr; if (handle.includes("n")) y = start.y + start.h - hh; if (handle.includes("w")) x = start.x + start.w - w; }
        const min = 24;
        if (w < min || hh < min || x < 0 || y < 0 || x + w > NW + 0.5 || y + hh > NH + 0.5) return;
        c = { x, y, w, h: hh };
        paint();
      };
      const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
      addEventListener("pointermove", move); addEventListener("pointerup", up);
    });
    // Type the exact size
    const typed = (which) => {
      const r = lock();
      let w = which === "w" ? Number(wIn.value) : c.w, hh = which === "h" ? Number(hIn.value) : c.h;
      if (!Number.isFinite(w) || !Number.isFinite(hh) || w < 16 || hh < 16) return;
      if (r) { if (which === "w") hh = w / r; else w = hh * r; }
      w = Math.min(w, NW); hh = Math.min(hh, NH);
      c = { w, h: hh, x: Math.max(0, Math.min(NW - w, c.x)), y: Math.max(0, Math.min(NH - hh, c.y)) };
      paint();
    };
    wIn.addEventListener("input", () => typed("w"));
    hIn.addEventListener("input", () => typed("h"));
    wIn.addEventListener("blur", paint); hIn.addEventListener("blur", paint);

    img.onload = () => {
      NW = img.naturalWidth; NH = img.naturalHeight;
      pic.src = img.src;
      c = { x: 0, y: 0, w: NW, h: NH };
      apply.disabled = false;
      requestAnimationFrame(layout);
    };
    img.onerror = () => { toast("Couldn’t open that picture."); finish(null); md.close(); };
    addEventListener("resize", layout);
    cancel.addEventListener("click", () => { finish(null); md.close(); });
    apply.addEventListener("click", () => {
      const W = Math.round(c.w), H = Math.round(c.h);
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, W, H);
      apply.disabled = true; apply.textContent = "Saving…";
      cv.toBlob((blob) => { finish(blob ? { blob, width: W, height: H } : null); md.close(); }, type === "image/png" ? "image/png" : "image/jpeg", 0.92);
    });
    function finish(v) {
      if (done) return;
      done = true;
      removeEventListener("resize", layout);
      resolve(v);
    }
  });
}
