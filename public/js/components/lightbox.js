// Photos open inside the site, full screen. Click or scroll to zoom, drag to look around,
// arrows (or swipe) for the next photo, Esc to close.
import { h, icon } from "../ui.js";

export function openLightbox(urls, start = 0) {
  let i = start, scale = 1, x = 0, y = 0;
  const img = h("img", { class: "lb-img", alt: "", draggable: "false" });
  const stage = h("div", { class: "lb-stage" }, img);
  const counter = h("span", { class: "lb-count" });
  const prev = h("button", { type: "button", class: "lb-nav lb-prev", "aria-label": "Previous photo" }, icon("back"));
  const next = h("button", { type: "button", class: "lb-nav lb-next", "aria-label": "Next photo" }, icon("back"));
  const close = h("button", { type: "button", class: "lb-close", "aria-label": "Close" }, icon("close"));
  const zoomIn = h("button", { type: "button", class: "lb-tool", "aria-label": "Zoom in", text: "+" });
  const zoomOut = h("button", { type: "button", class: "lb-tool", "aria-label": "Zoom out", text: "−" });
  const zoomLabel = h("span", { class: "lb-zoom", text: "100%" });
  const box = h("div", { class: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": "Photo" },
    stage, close, prev, next,
    h("div", { class: "lb-bar" }, counter, h("span", { class: "lb-spacer" }), zoomOut, zoomLabel, zoomIn));
  document.body.append(box);
  document.body.classList.add("no-scroll");
  requestAnimationFrame(() => box.classList.add("open"));

  const apply = (animate = true) => {
    img.style.transition = animate ? "transform 0.2s ease-out" : "none";
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    zoomLabel.textContent = Math.round(scale * 100) + "%";
    box.classList.toggle("zoomed", scale > 1);
  };
  const clampPan = () => {
    const r = img.getBoundingClientRect();
    const w = (r.width / scale) * scale, hh = (r.height / scale) * scale;
    const maxX = Math.max(0, (w - innerWidth) / 2 + 40), maxY = Math.max(0, (hh - innerHeight) / 2 + 40);
    x = Math.max(-maxX, Math.min(maxX, x));
    y = Math.max(-maxY, Math.min(maxY, y));
  };
  // Zoom toward a point on screen
  function zoomTo(s, cx = innerWidth / 2, cy = innerHeight / 2) {
    s = Math.max(1, Math.min(5, s));
    const k = s / scale;
    x = (x - (cx - innerWidth / 2)) * k + (cx - innerWidth / 2);
    y = (y - (cy - innerHeight / 2)) * k + (cy - innerHeight / 2);
    scale = s;
    if (scale === 1) x = y = 0;
    apply();
    clampPan();
    apply();
  }
  function show(n) {
    i = (n + urls.length) % urls.length;
    scale = 1; x = y = 0;
    img.src = urls[i];
    apply(false);
    counter.textContent = urls.length > 1 ? `${i + 1} / ${urls.length}` : "";
    prev.hidden = next.hidden = urls.length < 2;
  }

  /* Mouse and touch */
  let drag = null, moved = false;
  const pointers = new Map();
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    drag = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, dist: null, s0: scale };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag.dist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && drag.dist) {
      const [a, b] = [...pointers.values()];
      zoomTo(drag.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / drag.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      moved = true;
      return;
    }
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    if (scale > 1) {
      x = drag.ox + dx; y = drag.oy + dy;
      clampPan();
      apply(false);
    }
  });
  stage.addEventListener("pointerup", (e) => {
    pointers.delete(e.pointerId);
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    if (scale === 1 && moved && Math.abs(dx) > 60 && urls.length > 1) show(i + (dx < 0 ? 1 : -1)); // swipe
    else if (!moved) {
      // The stage captures the pointer, so check where the click landed ourselves
      const r = img.getBoundingClientRect();
      const onPhoto = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (onPhoto) zoomTo(scale > 1 ? 1 : 2.5, e.clientX, e.clientY); // click to zoom
      else if (scale === 1) shut(); // click outside the photo
    }
    drag = null;
  });
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  }, { passive: false });

  zoomIn.addEventListener("click", () => zoomTo(scale * 1.5));
  zoomOut.addEventListener("click", () => zoomTo(scale / 1.5));
  prev.addEventListener("click", () => show(i - 1));
  next.addEventListener("click", () => show(i + 1));
  close.addEventListener("click", shut);
  const onKey = (e) => {
    if (e.key === "Escape") shut();
    else if (e.key === "ArrowRight") show(i + 1);
    else if (e.key === "ArrowLeft") show(i - 1);
    else if (e.key === "+" || e.key === "=") zoomTo(scale * 1.5);
    else if (e.key === "-") zoomTo(scale / 1.5);
  };
  document.addEventListener("keydown", onKey);
  function shut() {
    document.removeEventListener("keydown", onKey);
    box.classList.remove("open");
    document.body.classList.remove("no-scroll");
    setTimeout(() => box.remove(), 200);
  }
  show(start);
}
