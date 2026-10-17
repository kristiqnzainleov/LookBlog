// A collage for a story: two or more photos in frames. Pick a layout, a photo for each frame (drag it inside its
// frame to choose what shows), and the look of the frames: the gap between them, their colour and roundness,
// and the background. The result is one 1080 × 1920 picture.
// openCollage({ photos: [url…] }) -> Promise<{ blob, width, height } | null>
import { h, modal, toast } from "../ui.js";

// Each layout: frames as [x, y, w, h] in fractions of the story
const LAYOUTS = [
  ["2v", "2 · side by side", [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]],
  ["2h", "2 · top & bottom", [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]]],
  ["3h", "3 · rows", [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]]],
  ["1+2", "3 · big top", [[0, 0, 1, 0.55], [0, 0.55, 0.5, 0.45], [0.5, 0.55, 0.5, 0.45]]],
  ["2+1", "3 · big bottom", [[0, 0, 0.5, 0.45], [0.5, 0, 0.5, 0.45], [0, 0.45, 1, 0.55]]],
  ["1|2", "3 · big left", [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]]],
  ["4", "4 · grid", [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]],
  ["4h", "4 · rows", [[0, 0, 1, 0.25], [0, 0.25, 1, 0.25], [0, 0.5, 1, 0.25], [0, 0.75, 1, 0.25]]],
  ["1+3", "4 · big top", [[0, 0, 1, 0.6], [0, 0.6, 1 / 3, 0.4], [1 / 3, 0.6, 1 / 3, 0.4], [2 / 3, 0.6, 1 / 3, 0.4]]],
  ["6", "6 · grid", [[0, 0, 0.5, 1 / 3], [0.5, 0, 0.5, 1 / 3], [0, 1 / 3, 0.5, 1 / 3], [0.5, 1 / 3, 0.5, 1 / 3], [0, 2 / 3, 0.5, 1 / 3], [0.5, 2 / 3, 0.5, 1 / 3]]],
  ["tilt", "3 · polaroids", [[0.08, 0.06, 0.62, 0.36, -6], [0.3, 0.34, 0.62, 0.36, 5], [0.06, 0.6, 0.62, 0.36, -3]]],
];
const COLORS = ["#ffffff", "#000000", "#ff4fa3", "#ffd23f", "#4cc9ff", "#2ee6a6", "#9b5cff", "#ff8a3d"];
const OUT_W = 1080, OUT_H = 1920;

export function openCollage({ photos = [] } = {}) {
  return new Promise((resolve) => {
    let layout = LAYOUTS[photos.length >= 4 ? 6 : photos.length === 3 ? 3 : 0];
    // each frame: { src, img, x, y (pan, -1..1), z (zoom) }
    let cells = [];
    const st = { gap: 12, radius: 18, frame: "#ffffff", bg: "#ffffff", border: 0 };
    const stage = h("div", { class: "cl-stage" });
    const layouts = h("div", { class: "cl-layouts" });
    const look = h("div", { class: "cl-look" });
    const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", multiple: true, hidden: true });
    const use = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Use this collage" });
    const cancel = h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "Cancel" });
    let done = false, picking = 0;
    const md = modal({ title: "Collage", wide: true, onClose: () => finish(null),
      body: h("div", { class: "cl" }, h("div", { class: "cl-left" }, stage, h("p", { class: "se-hint", text: "Tap a frame to put a photo in it · drag a photo to choose what shows · wheel to zoom" })),
        h("div", { class: "cl-right" }, h("b", { class: "cl-title", text: "Layout" }), layouts, h("b", { class: "cl-title", text: "Frames" }), look, h("div", { class: "crop-btns" }, cancel, use)), file) });

    const loadImg = (src) => new Promise((ok) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
    async function setLayout(l) {
      layout = l;
      const old = cells;
      cells = l[2].map((_, k) => old[k] || { src: photos[k] || null, img: null, x: 0, y: 0, z: 1 });
      await Promise.all(cells.map(async (c) => { if (c.src && !c.img) c.img = await loadImg(c.src); }));
      paint();
    }
    // A frame's place: the same gap between frames and around the edges (tilted polaroids keep their own place)
    const rectOf = (r, W, H) => {
      const [fx, fy, fw, fh, rot] = r;
      if (rot) return { x: fx * W, y: fy * H, w: fw * W, h: fh * H, rot };
      const g = st.gap * (W / OUT_W);
      let x = fx * W + g / 2, y = fy * H + g / 2, w = fw * W - g, hh = fh * H - g;
      if (fx < 0.001) { x += g / 2; w -= g / 2; }
      if (fx + fw > 0.999) w -= g / 2;
      if (fy < 0.001) { y += g / 2; hh -= g / 2; }
      if (fy + fh > 0.999) hh -= g / 2;
      return { x, y, w, h: hh, rot: 0 };
    };
    function paint() {
      const W = stage.clientWidth, H = W * 16 / 9;
      stage.style.height = H + "px";
      stage.style.background = st.bg;
      stage.replaceChildren(...layout[2].map((r, k) => {
        const c = cells[k], q = rectOf(r, W, H);
        const cell = h("div", { class: "cl-cell" + (c.img ? "" : " empty"), style: `left:${q.x}px;top:${q.y}px;width:${q.w}px;height:${q.h}px;border-radius:${st.radius * (W / OUT_W)}px;transform:rotate(${q.rot}deg);box-shadow:0 0 0 ${st.border * (W / OUT_W)}px ${st.frame}${q.rot ? ",0 8px 20px rgba(0,0,0,.35)" : ""}` },
          c.img ? h("img", { src: c.src, alt: "", draggable: "false", style: imgStyle(c, q) }) : h("span", { class: "cl-add", text: "＋ Photo" }));
        if (c.img) cell.append(h("button", { type: "button", class: "cl-swap", "aria-label": "Change photo", text: "↺", onclick: (e) => { e.stopPropagation(); pick(k); } }));
        cell.addEventListener("click", () => { if (!c.img) pick(k); });
        // drag the photo inside its frame; the wheel zooms it
        let d = null;
        cell.addEventListener("pointerdown", (e) => { if (!c.img || e.target.closest(".cl-swap")) return; e.preventDefault(); d = { sx: e.clientX, sy: e.clientY, x: c.x, y: c.y }; try { cell.setPointerCapture(e.pointerId); } catch {} });
        cell.addEventListener("pointermove", (e) => { if (!d) return; c.x = Math.max(-1, Math.min(1, d.x - ((e.clientX - d.sx) / q.w) * 2)); c.y = Math.max(-1, Math.min(1, d.y - ((e.clientY - d.sy) / q.h) * 2)); cell.querySelector("img").setAttribute("style", imgStyle(c, q)); });
        cell.addEventListener("pointerup", () => { d = null; });
        cell.addEventListener("wheel", (e) => { if (!c.img) return; e.preventDefault(); c.z = Math.max(1, Math.min(3, c.z * (e.deltaY < 0 ? 1.06 : 0.94))); cell.querySelector("img").setAttribute("style", imgStyle(c, q)); }, { passive: false });
        return cell;
      }));
      layouts.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.l === layout[0]));
    }
    // a photo fills its frame (cover), moved by x / y and zoomed by z
    function cover(img, w, hh, c) {
      const s = Math.max(w / img.naturalWidth, hh / img.naturalHeight) * c.z;
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      return { iw, ih, ix: (w - iw) / 2 * (1 + c.x), iy: (hh - ih) / 2 * (1 + c.y) };
    }
    const imgStyle = (c, q) => { const p = cover(c.img, q.w, q.h, c); return `width:${p.iw}px;height:${p.ih}px;left:${p.ix}px;top:${p.iy}px`; };
    function pick(k) { picking = k; file.click(); }
    file.addEventListener("change", async () => {
      const fs = [...file.files]; file.value = "";
      for (let n = 0; n < fs.length && picking + n < cells.length; n++) {
        const src = URL.createObjectURL(fs[n]);
        const img = await loadImg(src);
        if (img) cells[picking + n] = { src, img, x: 0, y: 0, z: 1 };
      }
      paint();
    });

    // Layout buttons, drawn as small diagrams
    layouts.append(...LAYOUTS.map((l) => h("button", { type: "button", class: "cl-layout", dataset: { l: l[0] }, title: l[1], "aria-label": l[1], onclick: () => setLayout(l) },
      ...l[2].map(([x, y, w, hh, rot]) => h("i", { style: `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${hh * 100}%;${rot ? `transform:rotate(${rot}deg)` : ""}` })))));
    // The look of the frames
    const slider = (label, key, min, max) => {
      const out = h("b", { text: String(st[key]) });
      const r = h("input", { type: "range", min, max, step: 1, value: st[key], "aria-label": label });
      r.addEventListener("input", () => { st[key] = Number(r.value); out.textContent = r.value; paint(); });
      return h("label", { class: "se-slider" }, h("span", { text: label }), r, out);
    };
    const swatches = (key) => h("div", { class: "se-row" }, ...COLORS.map((col) => {
      const b = h("button", { type: "button", class: "se-swatch" + (st[key] === col ? " on" : ""), style: `background:${col}`, "aria-label": col });
      b.addEventListener("click", () => { st[key] = col; b.parentElement.querySelectorAll(".se-swatch").forEach((x) => x.classList.toggle("on", x === b)); paint(); });
      return b;
    }));
    look.append(slider("Gap", "gap", 0, 60), slider("Round corners", "radius", 0, 120), slider("Frame line", "border", 0, 24),
      h("small", { class: "muted", text: "Frame line colour" }), swatches("frame"), h("small", { class: "muted", text: "Background" }), swatches("bg"));

    cancel.addEventListener("click", () => { finish(null); md.close(); });
    use.addEventListener("click", async () => {
      if (!cells.some((c) => c.img)) return toast("Add at least one photo.");
      use.disabled = true; use.textContent = "Making it…";
      const cv = document.createElement("canvas");
      cv.width = OUT_W; cv.height = OUT_H;
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = st.bg; ctx.fillRect(0, 0, OUT_W, OUT_H);
      layout[2].forEach((r, k) => {
        const c = cells[k], q = rectOf(r, OUT_W, OUT_H);
        ctx.save();
        ctx.translate(q.x + q.w / 2, q.y + q.h / 2);
        ctx.rotate((q.rot * Math.PI) / 180);
        ctx.translate(-q.w / 2, -q.h / 2);
        const path = new Path2D();
        path.roundRect(0, 0, q.w, q.h, st.radius);
        if (q.rot) { ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12; ctx.fillStyle = st.frame; ctx.fill(path); ctx.shadowColor = "transparent"; }
        if (st.border) { ctx.lineWidth = st.border * 2; ctx.strokeStyle = st.frame; ctx.stroke(path); }
        ctx.clip(path);
        if (c?.img) { const p = cover(c.img, q.w, q.h, c); ctx.drawImage(c.img, p.ix, p.iy, p.iw, p.ih); }
        else { ctx.fillStyle = "rgba(0,0,0,.08)"; ctx.fillRect(0, 0, q.w, q.h); }
        ctx.restore();
      });
      cv.toBlob((blob) => { finish(blob ? { blob, width: OUT_W, height: OUT_H } : null); md.close(); }, "image/jpeg", 0.92);
    });
    addEventListener("resize", paint);
    function finish(v) { if (done) return; done = true; removeEventListener("resize", paint); resolve(v); }
    requestAnimationFrame(() => setLayout(layout));
  });
}
