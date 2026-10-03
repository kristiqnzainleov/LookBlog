// Small SVG charts for Analytics: area/line with a hover crosshair, columns, and horizontal bars.
// One measure per chart (no second y-axis). Text stays in text colours; colour marks carry identity.
import { h } from "../ui.js";

export const C = { main: "#ff4fa3", compare: "#6a8fe8", grid: "#2a2727", axis: "#7a746e" };
const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  kids.flat().forEach((k) => k && el.append(k));
  return el;
};
export const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(Math.round(n * 10) / 10));
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/* Draw at the real width of the card (so text never gets squeezed), and redraw on resize */
function responsive(draw) {
  const wrap = h("div", { class: "chart-wrap" });
  let last = 0;
  const paint = () => {
    const w = Math.round(wrap.clientWidth);
    if (!w || w === last) return;
    last = w;
    wrap.replaceChildren(draw(w));
  };
  new ResizeObserver(paint).observe(wrap);
  requestAnimationFrame(paint);
  return wrap;
}

/* Tooltip shared by all charts */
let tip;
function tooltip() {
  if (!tip) { tip = h("div", { class: "chart-tip", role: "status" }); document.body.append(tip); }
  return tip;
}
function showTip(x, y, lines) {
  const t = tooltip();
  t.replaceChildren(...lines.map(([label, value, color]) => h("div", { class: "ct-row" }, color ? h("i", { style: `background:${color}` }) : null, h("span", { text: label }), value != null ? h("b", { text: value }) : null)));
  t.hidden = false;
  const w = t.offsetWidth, hh = t.offsetHeight;
  t.style.left = Math.min(innerWidth - w - 8, Math.max(8, x + 14)) + "px";
  t.style.top = Math.max(8, y - hh - 12) + "px";
}
const hideTip = () => tip && (tip.hidden = true);

/*
  areaChart(points, { label, format, xLabel(p), color, height, pct, markers: [{ i, text }] })
  points: [{ x, y }]
*/
export function areaChart(points, opts = {}) { return responsive((w) => drawArea(points, w, opts)); }
function drawArea(points, W, { label = "", format = fmtNum, xLabel = (p) => p.x, color = C.main, height = 220, pct = false, markers = [], xTicks = Math.max(2, Math.floor(W / 110)) } = {}) {
  const H = height, L = 44, R = 12, T = 12, B = 28;
  const max = pct ? 100 : Math.max(4, niceMax(Math.max(1, ...points.map((p) => p.y))));
  const x = (i) => L + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "chart", role: "img", "aria-label": label });
  const grad = `g${Math.random().toString(36).slice(2, 8)}`;
  svg.append(s("defs", {}, s("linearGradient", { id: grad, x1: 0, y1: 0, x2: 0, y2: 1 }, s("stop", { offset: "0", "stop-color": color, "stop-opacity": 0.32 }), s("stop", { offset: "1", "stop-color": color, "stop-opacity": 0 }))));
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    svg.append(s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: C.grid, "stroke-width": 1 }),
      s("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "chart-axis" }, pct ? Math.round(v) + "%" : fmtNum(v)));
  }
  const step = Math.max(1, Math.ceil(points.length / xTicks));
  let lastText = null;
  points.forEach((p, i) => { const txt = xLabel(p, i); if (txt === lastText) return; const lastOk = i === points.length - 1 && (points.length - 1) % step >= step * 0.6; if (i % step === 0 || lastOk) svg.append(s("text", { x: x(i), y: H - 8, "text-anchor": i === 0 ? "start" : i === points.length - 1 ? "end" : "middle", class: "chart-axis" }, (lastText = txt))); });
  if (points.length) {
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
    svg.append(s("path", { d: `${line}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, fill: `url(#${grad})` }),
      s("path", { d: line, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": null }));
  }
  for (const mk of markers) {
    svg.append(s("line", { x1: x(mk.i), x2: x(mk.i), y1: T, y2: H - B, stroke: C.axis, "stroke-dasharray": "3 4", "vector-effect": null }));
  }
  // Crosshair + tooltip
  const cross = s("line", { y1: T, y2: H - B, stroke: "#f4efe8", "stroke-opacity": 0.5, "vector-effect": null, visibility: "hidden" });
  const dot = s("circle", { r: 5, fill: color, stroke: "#1a1919", "stroke-width": 2, visibility: "hidden" });
  const hit = s("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" });
  svg.append(cross, dot, hit);
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1))));
    const p = points[i];
    if (!p) return;
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(p.y)); dot.setAttribute("visibility", "visible");
    const mk = markers.find((m) => m.i === i);
    showTip(e.clientX, e.clientY, [[xLabel(p, i)], [label, pct ? `${p.y}%` : format(p.y), color], ...(mk ? [[mk.text]] : [])]);
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); hideTip(); });
  return svg;
}

/* columnChart(items, { label, format, color, height }) items: [{ label, value, hint }] */
export function columnChart(items, opts = {}) { return responsive((w) => drawColumns(items, w, opts)); }
function drawColumns(items, W, { label = "", format = fmtNum, color = C.main, height = 160, highlight = -1 } = {}) {
  const H = height, L = 6, R = 6, T = 10, B = 22;
  const max = niceMax(Math.max(1, ...items.map((d) => d.value)));
  const bw = (W - L - R) / items.length;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "chart", role: "img", "aria-label": label });
  svg.append(s("line", { x1: L, x2: W - R, y1: H - B, y2: H - B, stroke: C.grid }));
  items.forEach((d, i) => {
    const bh = (d.value / max) * (H - T - B);
    const x0 = L + i * bw + 1, w = Math.max(1, bw - 2);
    const r = Math.min(4, w / 2, bh);
    const y0 = H - B - bh;
    // rounded top, square base
    const path = bh > 0 ? `M${x0},${H - B}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${H - B}Z` : "";
    const bar = s("path", { d: path, fill: i === highlight ? "#f4efe8" : color, opacity: highlight >= 0 && i !== highlight ? 0.55 : 1 });
    const hit = s("rect", { x: L + i * bw, y: T, width: bw, height: H - T - B, fill: "transparent" });
    hit.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, [[d.label], [label, format(d.value), color], ...(d.hint ? [[d.hint]] : [])]));
    hit.addEventListener("pointerleave", hideTip);
    svg.append(bar, hit);
    if (d.tick) svg.append(s("text", { x: L + i * bw + bw / 2, y: H - 6, "text-anchor": "middle", class: "chart-axis" }, d.tick));
  });
  return svg;
}

/* hBars(items, { format, color }) items: [{ label, value }] — a ranked list with bars */
export function hBars(items, { format = fmtNum, color = C.main, total = null } = {}) {
  const max = Math.max(1, ...items.map((d) => d.value));
  const sumAll = total ?? items.reduce((n, d) => n + d.value, 0);
  return h("div", { class: "hbars" }, ...items.map((d) => h("div", { class: "hbar", title: `${d.label}: ${format(d.value)}` },
    h("span", { class: "hb-label", text: d.label }),
    h("span", { class: "hb-track" }, h("span", { class: "hb-fill", style: `width:${(d.value / max) * 100}%;background:${color}` })),
    h("b", { class: "hb-val", text: format(d.value) }),
    h("span", { class: "hb-pct muted", text: sumAll ? Math.round((d.value / sumAll) * 100) + "%" : "" }))));
}

/* split(a, b) — two-part bar, e.g. followers vs not, with a 2px gap and labels */
export function split([a, b]) {
  const t = a.value + b.value || 1;
  return h("div", { class: "split" },
    h("div", { class: "split-bar" },
      h("span", { style: `flex:${a.value || 0.0001};background:${C.main}` }),
      h("span", { style: `flex:${b.value || 0.0001};background:${C.compare}` })),
    h("div", { class: "split-legend" },
      h("span", {}, h("i", { style: `background:${C.main}` }), `${a.label} · `, h("b", { text: Math.round((a.value / t) * 100) + "%" })),
      h("span", {}, h("i", { style: `background:${C.compare}` }), `${b.label} · `, h("b", { text: Math.round((b.value / t) * 100) + "%" }))));
}
