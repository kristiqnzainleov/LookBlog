// Link previews: the title, picture and site name of a web page someone pasted.
// Only public addresses are fetched (never this computer or a home network), with a size and time limit.

const dns = require("dns").promises;
const net = require("net");
const { sendJSON, httpError, rateLimit } = require("./http");

const cache = new Map(); // url -> { at, data }
const DAY = 86400000;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:") && privateIp(v.slice(7));
}
async function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
  if (u.port && !["80", "443", ""].includes(u.port)) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((x) => x.address);
  if (!ips.length || ips.some(privateIp)) return null;
  return u;
}
// Fetch a page, connecting only to an address that was checked (the DNS answer can't change in between: no "DNS rebinding")
function safeGet(u) {
  const mod = u.protocol === "https:" ? require("https") : require("http");
  const lookup = (host, opts, cb) => dns.lookup(host, { all: true }).then((list) => {
    const ok = list.filter((x) => !privateIp(x.address));
    if (!list.length || ok.length !== list.length) return cb(new Error("blocked address"));
    if (opts && opts.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  }, cb);
  return new Promise((resolve, reject) => {
    const req = mod.get(u, { lookup, timeout: 6000, headers: { "User-Agent": "Mozilla/5.0 (compatible; LookBlogPreview/1.0)", Accept: "text/html" } }, (res) => resolve(res));
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}
const decode = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).trim();
function meta(html, ...names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, "i");
    const m = html.match(re);
    if (m) return decode(m[1] || m[2]);
  }
  return "";
}

async function preview(raw) {
  const hit = cache.get(raw);
  if (hit && Date.now() - hit.at < DAY) return hit.data;
  let u = await safeUrl(raw);
  if (!u) throw httpError(400, "That link can’t be previewed.");
  let res, html = "";
  // Follow up to 3 redirects, checking each address
  for (let i = 0; i < 4; i++) {
    try { res = await safeGet(u); } catch { throw httpError(400, "That link can’t be previewed."); }
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      u = await safeUrl(new URL(res.headers.location, u).href);
      if (!u) throw httpError(400, "That link can’t be previewed.");
      continue;
    }
    break;
  }
  if (res.statusCode < 200 || res.statusCode >= 300 || !String(res.headers["content-type"] || "").includes("html")) { res.resume(); throw httpError(400, "No preview for that link."); }
  // Read the top of the page only (up to 400 KB, or until </head>)
  html = await new Promise((resolve) => {
    let buf = "", size = 0;
    const done = () => { res.destroy(); resolve(buf); };
    res.on("data", (c) => { size += c.length; buf += c.toString("utf8"); if (size > 400000 || /<\/head>/i.test(buf)) done(); });
    res.on("end", () => resolve(buf));
    res.on("error", () => resolve(buf));
    setTimeout(done, 6000).unref?.();
  });
  const title = meta(html, "og:title", "twitter:title") || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
  let image = meta(html, "og:image", "twitter:image", "og:image:url");
  if (image) { try { image = new URL(image, u).href; if (!/^https?:/.test(image)) image = ""; } catch { image = ""; } }
  const data = {
    url: u.href, title: title.slice(0, 200), description: meta(html, "og:description", "twitter:description", "description").slice(0, 300),
    image: image || null, site: (meta(html, "og:site_name") || u.hostname.replace(/^www\./, "")).slice(0, 60),
  };
  if (cache.size > 3000) cache.clear();
  cache.set(raw, { at: Date.now(), data });
  return data;
}

async function handleLinks(req, res, url, me) {
  if (req.method !== "GET" || url.pathname !== "/api/link-preview") return false;
  rateLimit("preview:" + me.id, 120, 10 * 60 * 1000, "Too many links at once.");
  const raw = String(url.searchParams.get("url") || "").slice(0, 2000);
  try { sendJSON(res, 200, { preview: await preview(raw) }); }
  catch (err) { sendJSON(res, err.status || 400, { error: err.expose ? err.message : "No preview for that link." }); }
  return true;
}

module.exports = { handleLinks };
