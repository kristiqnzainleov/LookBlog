// Make a sticker from a photo: remove the background, touch it up with an eraser, add a white outline.
// Everything happens in the browser on a <canvas>; the result is a transparent PNG.
import { h, icon, modal } from "../ui.js";

const MAX = 512;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That picture couldn’t be opened.")); };
    img.src = url;
  });
}

/* ---------- Background removal ----------
   Looks at the colours around the edge of the photo, then removes every pixel that is
   connected to the edge and close to one of those colours (a flood fill). Works best with
   plain backgrounds; anything left over can be cleaned up with the eraser. */
function removeBackground(px, w, hgt, tolerance) {
  const mask = new Uint8ClampedArray(w * hgt).fill(255);
  // 1) background colours: sample the border and keep a few distinct ones
  const samples = [];
  const step = Math.max(1, Math.floor((w + hgt) / 120));
  const push = (x, y) => { const i = (y * w + x) * 4; if (px[i + 3] > 10) samples.push([px[i], px[i + 1], px[i + 2]]); };
  for (let x = 0; x < w; x += step) { push(x, 0); push(x, hgt - 1); }
  for (let y = 0; y < hgt; y += step) { push(0, y); push(w - 1, y); }
  const palette = [];
  for (const c of samples) {
    if (!palette.some((p) => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) < 40)) palette.push(c);
    if (palette.length >= 8) break;
  }
  const tol2 = tolerance * tolerance;
  const isBg = (i) => {
    if (px[i + 3] < 10) return true;
    for (const p of palette) {
      const dr = px[i] - p[0], dg = px[i + 1] - p[1], db = px[i + 2] - p[2];
      if (dr * dr + dg * dg + db * db <= tol2) return true;
    }
    return false;
  };
  // 2) flood fill from every edge pixel
  const queue = new Int32Array(w * hgt);
  let head = 0, tail = 0;
  const seen = new Uint8Array(w * hgt);
  const seed = (x, y) => { const k = y * w + x; if (!seen[k] && isBg(k * 4)) { seen[k] = 1; queue[tail++] = k; } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, hgt - 1); }
  for (let y = 0; y < hgt; y++) { seed(0, y); seed(w - 1, y); }
  while (head < tail) {
    const k = queue[head++];
    mask[k] = 0;
    const x = k % w, y = (k - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < hgt - 1) seed(x, y + 1);
  }
  // 3) soften the edge by one pixel
  const soft = mask.slice();
  for (let y = 1; y < hgt - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    if (mask[k] && (!mask[k - 1] || !mask[k + 1] || !mask[k - w] || !mask[k + w])) soft[k] = 140;
  }
  return soft;
}

/* ---------- Magic erase: remove the area you tap ----------
   Photos are noisy and have soft shading, so we compare a slightly blurred copy, and grow the area
   step by step: a pixel joins when it's close to its neighbour (smooth change) and not too far from
   the colour you tapped. Then one more ring is taken to wipe the halo at the edge. */
function blurred(px, w, hgt) {
  const out = new Float32Array(w * hgt * 3);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= hgt) continue;
      const i = (yy * w + xx) * 4;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
    const o = (y * w + x) * 3;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return out;
}
function magicErase(bl, mask, w, hgt, sx, sy, tolerance) {
  const dist2 = (a, b) => { a *= 3; b *= 3; const dr = bl[a] - bl[b], dg = bl[a + 1] - bl[b + 1], db = bl[a + 2] - bl[b + 2]; return dr * dr + dg * dg + db * db; };
  const k0 = sy * w + sx;
  const step2 = (tolerance * 0.55) ** 2, seed2 = (tolerance * 2) ** 2, edge2 = (tolerance * 2.6) ** 2;
  const seen = new Uint8Array(w * hgt);
  const queue = new Int32Array(w * hgt);
  let head = 0, tail = 0;
  queue[tail++] = k0;
  seen[k0] = 1;
  while (head < tail) {
    const k = queue[head++];
    const x = k % w, y = (k - x) / w;
    const nb = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < hgt - 1 ? k + w : -1];
    for (const n of nb) if (n >= 0 && !seen[n] && mask[n] && dist2(n, k) <= step2 && dist2(n, k0) <= seed2) { seen[n] = 1; queue[tail++] = n; }
  }
  let erased = 0;
  for (let i = 0; i < tail; i++) { if (mask[queue[i]]) erased++; mask[queue[i]] = 0; }
  // one more ring: the blurry edge pixels that still look like the erased colour
  for (let y = 1; y < hgt - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    if (!mask[k] || seen[k]) continue;
    if (seen[k - 1] + seen[k + 1] + seen[k - w] + seen[k + w]) mask[k] = dist2(k, k0) <= edge2 ? 0 : 150;
  }
  return erased;
}

export async function openStickerMaker(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale)), H = Math.max(1, Math.round(img.naturalHeight * scale));
  const src = document.createElement("canvas");
  src.width = W; src.height = H;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, W, H);
  const pixels = sctx.getImageData(0, 0, W, H);
  const smooth = blurred(pixels.data, W, H);

  let mask = new Uint8ClampedArray(W * H).fill(255);
  const history = [];
  const snapshot = () => { history.push(mask.slice()); if (history.length > 20) history.shift(); };

  const view = h("canvas", { class: "sm-canvas", width: W, height: H });
  const vctx = view.getContext("2d");
  let outline = true;

  function render() {
    const out = vctx.createImageData(W, H);
    const d = out.data, p = pixels.data;
    for (let k = 0, i = 0; k < mask.length; k++, i += 4) {
      d[i] = p[i]; d[i + 1] = p[i + 1]; d[i + 2] = p[i + 2];
      d[i + 3] = Math.min(p[i + 3], mask[k]);
    }
    vctx.clearRect(0, 0, W, H);
    vctx.putImageData(out, 0, 0);
    view.classList.toggle("with-outline", outline);
  }

  /* Tools */
  let tool = "magic", brush = 18, tolerance = 42;
  const tolInput = h("input", { type: "range", min: "10", max: "120", value: String(tolerance), class: "sm-range", "aria-label": "How much to remove" });
  const sizeInput = h("input", { type: "range", min: "4", max: "60", value: String(brush), class: "sm-range", "aria-label": "Brush size" });
  const removeBtn = h("button", { type: "button", class: "btn btn-primary btn-sm sm-remove" }, icon("magic"), h("span", { text: "Remove background" }));
  const magicBtn = h("button", { type: "button", class: "sm-tool sm-magic active", title: "Tap an area to erase it" }, icon("magic"), h("span", { text: "Magic erase" }));
  const eraseBtn = h("button", { type: "button", class: "sm-tool", title: "Erase" }, icon("eraser"), h("span", { text: "Erase" }));
  const restoreBtn = h("button", { type: "button", class: "sm-tool", title: "Bring back" }, icon("brush"), h("span", { text: "Restore" }));
  const undoBtn = h("button", { type: "button", class: "sm-tool", title: "Undo" }, icon("undo"), h("span", { text: "Undo" }));
  const resetBtn = h("button", { type: "button", class: "sm-tool", title: "Start over" }, icon("replay"), h("span", { text: "Reset" }));
  const outlineBox = h("input", { type: "checkbox", checked: true });
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save sticker" });
  const hint = h("p", { class: "create-hint", text: "We removed the background for you. Tap any leftover area with Magic erase to wipe it away." });

  const setTool = (t) => {
    tool = t;
    magicBtn.classList.toggle("active", t === "magic");
    eraseBtn.classList.toggle("active", t === "erase");
    restoreBtn.classList.toggle("active", t === "restore");
    view.classList.toggle("magic-cursor", t === "magic");
  };
  magicBtn.addEventListener("click", () => setTool("magic"));
  eraseBtn.addEventListener("click", () => setTool("erase"));
  restoreBtn.addEventListener("click", () => setTool("restore"));
  removeBtn.addEventListener("click", () => {
    snapshot();
    removeBtn.disabled = true;
    removeBtn.querySelector("span").textContent = "Removing…";
    setTimeout(() => {
      mask = removeBackground(pixels.data, W, H, tolerance);
      render();
      removeBtn.disabled = false;
      removeBtn.querySelector("span").textContent = "Remove background again";
    }, 30);
  });
  tolInput.addEventListener("input", () => (tolerance = Number(tolInput.value)));
  tolInput.addEventListener("change", () => { if (history.length) { mask = removeBackground(pixels.data, W, H, tolerance); render(); } });
  sizeInput.addEventListener("input", () => (brush = Number(sizeInput.value)));
  undoBtn.addEventListener("click", () => { if (history.length) { mask = history.pop(); render(); } });
  resetBtn.addEventListener("click", () => { snapshot(); mask = new Uint8ClampedArray(W * H).fill(255); render(); });
  outlineBox.addEventListener("change", () => { outline = outlineBox.checked; render(); });

  /* Painting with the eraser / restore brush */
  let painting = false, last = null;
  const toCanvas = (e) => {
    const r = view.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, s: W / r.width };
  };
  const dab = (x, y, s) => {
    const rad = (brush * s) / 2, value = tool === "erase" ? 0 : 255;
    const x0 = Math.max(0, Math.floor(x - rad)), x1 = Math.min(W - 1, Math.ceil(x + rad));
    const y0 = Math.max(0, Math.floor(y - rad)), y1 = Math.min(H - 1, Math.ceil(y + rad));
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      if ((xx - x) ** 2 + (yy - y) ** 2 <= rad * rad) mask[yy * W + xx] = value;
    }
  };
  view.addEventListener("pointerdown", (e) => {
    if (tool === "magic") {
      const p = toCanvas(e);
      const x = Math.max(0, Math.min(W - 1, Math.round(p.x))), y = Math.max(0, Math.min(H - 1, Math.round(p.y)));
      if (!mask[y * W + x]) return;
      snapshot();
      const n = magicErase(smooth, mask, W, H, x, y, tolerance);
      if (n < 25) { history.pop(); hint.textContent = "Only a tiny bit matched there — slide “How much to remove” to the right and tap again."; }
      else hint.textContent = "Erased! Tap more areas, or use Undo.";
      render();
      return;
    }
    view.setPointerCapture(e.pointerId);
    snapshot();
    painting = true;
    last = toCanvas(e);
    dab(last.x, last.y, last.s);
    render();
  });
  view.addEventListener("pointermove", (e) => {
    if (!painting) return;
    const p = toCanvas(e);
    const dist = Math.hypot(p.x - last.x, p.y - last.y), steps = Math.max(1, Math.ceil(dist / 3));
    for (let i = 1; i <= steps; i++) dab(last.x + ((p.x - last.x) * i) / steps, last.y + ((p.y - last.y) * i) / steps, p.s);
    last = p;
    render();
  });
  view.addEventListener("pointerup", () => (painting = false));

  /* Make the final PNG: crop to what's left, add the white outline */
  function exportPng() {
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x] > 20) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) return Promise.resolve(null);
    const pad = outline ? 10 : 2;
    const cw = maxX - minX + 1 + pad * 2, ch = maxY - minY + 1 + pad * 2;
    const piece = document.createElement("canvas");
    piece.width = cw; piece.height = ch;
    piece.getContext("2d").drawImage(view, minX, minY, maxX - minX + 1, maxY - minY + 1, pad, pad, maxX - minX + 1, maxY - minY + 1);
    const out = document.createElement("canvas");
    out.width = cw; out.height = ch;
    const o = out.getContext("2d");
    if (outline) {
      // A white silhouette drawn around the sticker makes the classic outline
      const sil = document.createElement("canvas");
      sil.width = cw; sil.height = ch;
      const sc = sil.getContext("2d");
      sc.drawImage(piece, 0, 0);
      sc.globalCompositeOperation = "source-in";
      sc.fillStyle = "#fff";
      sc.fillRect(0, 0, cw, ch);
      const r = 6;
      for (let a = 0; a < 360; a += 20) o.drawImage(sil, Math.cos((a * Math.PI) / 180) * r, Math.sin((a * Math.PI) / 180) * r);
    }
    o.drawImage(piece, 0, 0);
    return new Promise((resolve) => out.toBlob(resolve, "image/png"));
  }

  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: "Make a sticker",
      wide: true,
      onClose: () => { if (!done) resolve(null); },
      body: h("div", { class: "sticker-maker" },
        h("div", { class: "sm-stage" }, view),
        h("div", { class: "sm-panel" },
          removeBtn,
          h("label", { class: "sm-row" }, h("span", { text: "How much to remove" }), tolInput),
          hint,
          h("div", { class: "sm-tools" }, magicBtn, eraseBtn, restoreBtn, undoBtn, resetBtn),
          h("label", { class: "sm-row" }, h("span", { text: "Brush size" }), sizeInput),
          h("label", { class: "sm-check" }, outlineBox, h("span", { class: "box" }), h("span", { text: "White outline" })),
          save)),
    });
    m.card.classList.add("sticker-modal");
    save.addEventListener("click", async () => {
      save.disabled = true;
      save.textContent = "Saving…";
      const blob = await exportPng();
      if (!blob) { save.disabled = false; save.textContent = "Save sticker"; return; }
      done = true;
      resolve(blob);
      m.close();
    });
    render();
    // Do the first clean-up straight away
    setTimeout(() => removeBtn.click(), 120);
    setTool("magic");
  });
}
