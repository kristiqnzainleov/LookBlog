// A QR code for an authenticator app (the qrcode-generator library, served by LookBlog itself)
let lib = null;
function load() {
  if (lib) return lib;
  lib = new Promise((ok, no) => {
    if (window.qrcode) return ok(window.qrcode);
    const s = document.createElement("script");
    s.src = "/js/lib/qrcode.js";
    s.onload = () => ok(window.qrcode);
    s.onerror = () => { lib = null; no(new Error("qr")); };
    document.head.append(s);
  });
  return lib;
}
// An <svg> element (black on white, with a quiet zone) for the text
export async function qrSvg(text, size = 200) {
  const qrcode = await load();
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), cell = 1, pad = 4, dim = n + pad * 2;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${dim} ${dim}`);
  svg.setAttribute("width", size); svg.setAttribute("height", size);
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "QR code for your authenticator app");
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = document.createElementNS(svg.namespaceURI, "rect");
  bg.setAttribute("width", dim); bg.setAttribute("height", dim); bg.setAttribute("fill", "#fff");
  svg.append(bg);
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + pad} ${r + pad}h${cell}v${cell}h-${cell}z`;
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", d); path.setAttribute("fill", "#000");
  svg.append(path);
  return svg;
}
