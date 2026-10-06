// A small drawing board for the party games: colours, brush sizes, eraser, undo and clear.
// Works with a finger or a mouse; gives back a PNG.
import { h, modal, toast } from "../ui.js";
import { upload } from "../api.js";

const COLORS = ["#111111", "#ffffff", "#ff4757", "#ff8a3d", "#ffd23f", "#2ee6a6", "#1f8bff", "#9b5cff", "#ff4fa3", "#8b5a2b", "#888888"];
const SIZES = [3, 7, 14, 26];

export function drawPad() {
  const W = 640, H = 480;
  const canvas = h("canvas", { width: W, height: H, class: "dp-canvas" });
  const g = canvas.getContext("2d");
  const clearAll = () => { g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H); };
  clearAll();
  let color = COLORS[0], size = SIZES[1], eraser = false, drawing = null;
  const history = [];
  const snap = () => { history.push(g.getImageData(0, 0, W, H)); if (history.length > 30) history.shift(); };
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    snap();
    drawing = at(e);
    g.beginPath(); g.fillStyle = eraser ? "#ffffff" : color; g.arc(drawing[0], drawing[1], size / 2, 0, Math.PI * 2); g.fill();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = at(e);
    g.strokeStyle = eraser ? "#ffffff" : color; g.lineWidth = size; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); g.moveTo(drawing[0], drawing[1]); g.lineTo(p[0], p[1]); g.stroke();
    drawing = p;
  });
  const up = () => { drawing = null; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  const swatches = h("div", { class: "dp-colors" }, ...COLORS.map((c) => {
    const b = h("button", { type: "button", class: "dp-sw" + (c === color ? " on" : ""), style: `background:${c}`, "aria-label": c });
    b.addEventListener("click", () => { color = c; eraser = false; paintTools(); });
    return b;
  }));
  const sizes = h("div", { class: "dp-sizes" }, ...SIZES.map((s) => {
    const b = h("button", { type: "button", class: "dp-size" + (s === size ? " on" : ""), "aria-label": `Brush ${s}` }, h("i", { style: `width:${Math.min(22, s)}px;height:${Math.min(22, s)}px` }));
    b.addEventListener("click", () => { size = s; paintTools(); });
    return b;
  }));
  const eraseBtn = h("button", { type: "button", class: "dp-tool", text: "🧽 Eraser" });
  eraseBtn.addEventListener("click", () => { eraser = !eraser; paintTools(); });
  const undoBtn = h("button", { type: "button", class: "dp-tool", text: "↶ Undo" });
  undoBtn.addEventListener("click", () => { const last = history.pop(); if (last) g.putImageData(last, 0, 0); });
  const clearBtn = h("button", { type: "button", class: "dp-tool", text: "🗑 Clear" });
  clearBtn.addEventListener("click", () => { snap(); clearAll(); });
  function paintTools() {
    [...swatches.children].forEach((b, i) => b.classList.toggle("on", !eraser && COLORS[i] === color));
    [...sizes.children].forEach((b, i) => b.classList.toggle("on", SIZES[i] === size));
    eraseBtn.classList.toggle("on", eraser);
  }
  const el = h("div", { class: "dp" }, canvas, h("div", { class: "dp-bar" }, swatches, h("div", { class: "dp-row" }, sizes, eraseBtn, undoBtn, clearBtn)));
  return {
    el,
    empty: () => history.length === 0,
    blob: () => new Promise((r) => canvas.toBlob(r, "image/png")),
  };
}

// Draw in a window, send it (uploaded); resolves with the picture's address, or null if closed
export function drawInWindow(title, hint) {
  return new Promise((resolve) => {
    const pad = drawPad();
    const send = h("button", { type: "button", class: "btn btn-primary btn-full", text: "✅ Send my drawing" });
    let done = false;
    const m = modal({ title, wide: true, onClose: () => { if (!done) resolve(null); }, body: h("div", { class: "create-form" }, hint ? h("p", { class: "dp-prompt", text: hint }) : null, pad.el, send) });
    send.addEventListener("click", async () => {
      if (pad.empty()) return toast("Draw something first!");
      send.disabled = true; send.textContent = "Sending…";
      try {
        const blob = await pad.blob();
        const { url } = await upload(new File([blob], "drawing.png", { type: "image/png" }));
        done = true; m.close(); resolve(url);
      } catch (err) { toast(err.error || "Couldn’t send it."); send.disabled = false; send.textContent = "✅ Send my drawing"; }
    });
  });
}
