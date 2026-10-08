import { lookHook } from "./components/profile-look.js";
import { verifyType } from "./verify-types.js";
// Small UI helpers. User text always goes in with textContent, never as HTML.

export const $ = (id) => document.getElementById(id);

// el.append(null) would show the word "null" on the page. Skip empty pieces everywhere.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ["append", "prepend", "replaceChildren", "before", "after", "replaceWith"]) {
    const orig = proto[name];
    if (!orig || orig.__lbSafe) continue;
    const safe = function (...nodes) { return orig.apply(this, nodes.filter((n) => n != null && n !== false)); };
    safe.__lbSafe = true;
    proto[name] = safe;
  }
}

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}

// Static icons only (never user text)
const ICONS = {
  like: '<path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm0 0 4-7a2.5 2.5 0 0 1 2.4 3.1L12.8 9H19a2 2 0 0 1 2 2.3l-1.2 7.5A2.5 2.5 0 0 1 17.3 21H7"/>',
  dislike: '<path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1zm0 0-4 7a2.5 2.5 0 0 1-2.4-3.1l.6-2.9H5a2 2 0 0 1-2-2.3l1.2-7.5A2.5 2.5 0 0 1 6.7 3H17"/>',
  comment: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  video: '<rect x="2.5" y="5" width="14" height="14" rx="2"/><path d="m16.5 10 5-3v10l-5-3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  flip: '<path d="M4 9a7 7 0 0 1 12.5-3.5L19 8M20 15a7 7 0 0 1-12.5 3.5L5 16"/><path d="M19 4v4h-4M5 20v-4h4"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  note: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  replyArrow: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 4.5 1.8 6.5 2.5 7.2a.5.5 0 0 1-.4.8H3.9a.5.5 0 0 1-.4-.8C4.2 15.5 6 13.5 6 9z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  bellOff: '<path d="M8.6 3.9A6 6 0 0 1 18 9c0 2.3.5 4 1.1 5.2M17 17H3.9a.5.5 0 0 1-.4-.8C4.2 15.5 6 13.5 6 9c0-.6.1-1.2.3-1.8"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/><path d="m3 3 18 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  fire: '<path d="M12 22c4 0 7-2.8 7-7 0-3.3-2-5.6-3.5-7.2-.4 1.7-1.3 2.9-2.5 3.4.3-3.2-1.2-6.2-4-8.2.2 3.4-1.6 5.6-3.2 7.5C4.6 12.1 5 13.4 5 15c0 4.2 3 7 7 7z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  poll: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  magic: '<path d="m4 20 11-11M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.6 1.4L21 13l-1.4.6L19 15l-.6-1.4L17 13l1.4-.6z"/>',
  eraser: '<path d="m7 20-4-4a1.5 1.5 0 0 1 0-2.1L13.9 3a1.5 1.5 0 0 1 2.1 0L21 8a1.5 1.5 0 0 1 0 2.1L11 20zM20 20H7M8.5 9.5l6 6"/>',
  brush: '<path d="M14 4.5 19.5 10 11 18.5 5.5 13z"/><path d="M5.5 13c-2 1-2.5 4.5-2.5 7.5 3 0 6.5-.5 7.5-2.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
  sticker: '<path d="M14 21H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v6z"/><path d="M14 21v-3a4 4 0 0 1 4-4h3"/><path d="M8.5 11h.01M15.5 11h.01M9 15s1.2 1 3 1"/>',
  check: '<path d="M12 1.8l2.5 1.9 3.1-.2 1 3 2.6 1.7-.9 3 .9 3-2.6 1.7-1 3-3.1-.2-2.5 1.9-2.5-1.9-3.1.2-1-3-2.6-1.7.9-3-.9-3 2.6-1.7 1-3 3.1.2z"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9"/>',
  phone: '<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  cool: '<path d="M2 9h20"/><path d="M3.5 9 4.6 14a2.5 2.5 0 0 0 2.4 2h1.6a2.5 2.5 0 0 0 2.4-1.9L11.5 11h1l.5 3.1a2.5 2.5 0 0 0 2.4 1.9H17a2.5 2.5 0 0 0 2.4-2L20.5 9"/>',
  share: '<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/>',
  playlist: '<path d="M3 6h13M3 12h13M3 18h8"/><path d="M16 15.5v5l4.5-2.5z"/>',
  save: '<path d="M3 6h12M3 12h12M3 18h7"/><path d="M18 14v7M14.5 17.5h7"/>',
  chat: '<path d="M3 10.5A2.5 2.5 0 0 1 5.5 8h8a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3A2.5 2.5 0 0 1 3 14.5z"/><path d="M8 8V6.5A2.5 2.5 0 0 1 10.5 4h8A2.5 2.5 0 0 1 21 6.5v4a2.5 2.5 0 0 1-2.5 2.5H16"/>',
  group: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.1c2.9.2 5 2.3 5 5.4"/>',
  send: '<path d="M4 12 20 4l-4 16-4-7z"/><path d="m12 13 8-9"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  userPlus: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M19 8v6M16 11h6"/>',
  repost: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9a3 3 0 0 1 3-3h14M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v2a3 3 0 0 1-3 3h-14"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  game: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7.5 10.5v4M5.5 12.5h4"/><circle cx="15.5" cy="11.5" r="1"/><circle cx="18" cy="13.8" r="1"/>',
  screen: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m9 10.5 3-3 3 3M12 7.5v6"/>',
  hash: '<path d="M5 9h15M4 15h15M10 3 8 21M16 3l-2 18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
  leave: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  crown: '<path d="m3 8 4 4 5-7 5 7 4-4-2 11H5z"/>',
  speaker: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
};
export function icon(name, cls = "") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  if (cls) s.setAttribute("class", cls);
  s.innerHTML = ICONS[name] || "";
  return s;
}

/* ---------- Text with @mentions turned into profile links ---------- */
export function richText(text, mentions = []) {
  const known = new Set((mentions || []).map((u) => u.toLowerCase()));
  const frag = document.createDocumentFragment();
  const re = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{3,15})\b/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    if (!known.has(m[2].toLowerCase())) continue;
    frag.append(text.slice(last, start));
    const a = document.createElement("a");
    a.className = "mention";
    a.href = `/u/${encodeURIComponent(m[2])}`;
    a.textContent = "@" + m[2];
    frag.append(a);
    last = start + m[2].length + 1;
  }
  frag.append(text.slice(last));
  linkify(frag);
  return frag;
}

// Web addresses in text become links (they open in a new tab)
export const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;
function linkify(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) nodes.push(walk.currentNode);
  for (const n of nodes) {
    const text = n.nodeValue;
    URL_RE.lastIndex = 0;
    if (!URL_RE.test(text)) continue;
    URL_RE.lastIndex = 0;
    const f = document.createDocumentFragment();
    let last = 0, m;
    while ((m = URL_RE.exec(text))) {
      f.append(text.slice(last, m.index));
      const a = document.createElement("a");
      a.className = "ext-link";
      a.href = m[0];
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      a.textContent = m[0].replace(/^https?:\/\/(www\.)?/, "").slice(0, 60) + (m[0].length > 70 ? "…" : "");
      a.title = m[0];
      f.append(a);
      last = m.index + m[0].length;
    }
    f.append(text.slice(last));
    n.replaceWith(f);
  }
}

/* ---------- Verification tick ---------- */
export function tick(user, size = 18) {
  // Someone with a custom name look: their name (the element the tick sits in) gets it
  if (!user?.verified) {
    if (!user?.look) return null;
    const hook = document.createElement("span");
    hook.className = "nl-hook";
    lookHook(user, hook);
    return hook;
  }
  const t = verifyType(user.verifiedType);
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "verified");
  s.setAttribute("width", size);
  s.setAttribute("height", size);
  s.setAttribute("role", "img");
  const what = t.id === "other" ? "Verified account" : `Verified ${t.name}`;
  s.setAttribute("aria-label", what);
  s.dataset.verify = t.id;
  s.style.setProperty("--tick", t.color);
  s.innerHTML = `<path d="M12 1.8l2.5 1.9 3.1-.2 1 3 2.6 1.7-.9 3 .9 3-2.6 1.7-1 3-3.1-.2-2.5 1.9-2.5-1.9-3.1.2-1-3-2.6-1.7.9-3-.9-3 2.6-1.7 1-3 3.1.2z" fill="${t.color}"/><g fill="none" stroke="#121111" stroke-width="${t.id === "creator" || t.id === "other" ? 2.4 : 1.6}" stroke-linecap="round" stroke-linejoin="round">${t.glyph}</g>`;
  if (user.look) lookHook(user, s);
  return s;
}

/* ---------- What a tick means: a little card when you point at it (or tap it) ---------- */
const VERIFY_TEXT = {
  creator: "creates content on LookBlog", musician: "makes music", singer: "is a singer", dj: "is a DJ or music producer", band: "is a band",
  artist: "is an artist", photographer: "is a photographer", filmmaker: "makes films", actor: "is an actor", dancer: "is a dancer",
  comedian: "is a comedian", writer: "is a writer", journalist: "is a journalist", gamer: "is a gamer", streamer: "is a streamer",
  athlete: "is an athlete", chef: "is a chef", fashion: "works in fashion", designer: "is a designer", developer: "is a developer",
  business: "is a business or brand", "public-figure": "is a public figure", organization: "is an organization", other: "is who it says it is",
};
let tipEl = null;
function showTickTip(svg) {
  const t = verifyType(svg.dataset.verify);
  tipEl?.remove();
  tipEl = document.createElement("div");
  tipEl.className = "tick-tip";
  tipEl.style.setProperty("--tick", t.color);
  tipEl.innerHTML = "";
  const head = document.createElement("b");
  head.textContent = `${t.emoji} ${t.id === "other" ? "Verified account" : "Verified " + t.name}`;
  const body = document.createElement("span");
  body.textContent = `LookBlog checked that this account is real and that this person ${VERIFY_TEXT[t.id] || "is who they say they are"}.`;
  tipEl.append(head, body);
  document.body.append(tipEl);
  const r = svg.getBoundingClientRect(), w = tipEl.offsetWidth, hgt = tipEl.offsetHeight;
  tipEl.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + "px";
  tipEl.style.top = (r.top - hgt - 8 > 8 ? r.top - hgt - 8 : r.bottom + 8) + "px";
}
const hideTickTip = () => { tipEl?.remove(); tipEl = null; };
document.addEventListener("mouseover", (e) => { const s = e.target.closest?.("svg.verified[data-verify]"); if (s) showTickTip(s); });
document.addEventListener("mouseout", (e) => { if (e.target.closest?.("svg.verified[data-verify]")) hideTickTip(); });
document.addEventListener("click", (e) => { const s = e.target.closest?.("svg.verified[data-verify]"); if (s && matchMedia("(hover: none)").matches) { e.preventDefault(); showTickTip(s); setTimeout(hideTickTip, 2500); } else if (!s) hideTickTip(); }, true);
addEventListener("scroll", hideTickTip, { passive: true, capture: true });

/* ---------- Avatars ---------- */
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}
function tone(username) {
  let n = 0;
  for (const ch of String(username)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return ["", "alt-1", "alt-2", "alt-3"][n % 4];
}
export function avatar(user, size = 42, extra = "") {
  const el = h("span", { class: `avatar ${tone(user.username)} ${extra}`.trim(), style: `--size:${size}px`, "aria-hidden": "true", dataset: user.username ? { u: user.username } : {} });
  if (user.avatar) el.append(h("img", { src: user.avatar, alt: "", loading: "lazy", decoding: "async" }));
  else el.append(h("span", { class: "av-initials", text: initials(user.name) }));
  if (user.live) markLive(el, true, size);
  return el;
}
// A red ring and a "LIVE" tag on the photo of someone who's streaming right now
export function markLive(el, on, size = parseInt(el.style.getPropertyValue("--size")) || 42) {
  el.classList.toggle("is-live", on);
  el.querySelector(".av-live")?.remove();
  if (on && size >= 34) el.append(h("span", { class: "av-live", text: "LIVE" }));
}
export function fillAvatar(el, user) {
  el.className = `avatar ${tone(user.username)}`;
  el.replaceChildren(user.avatar ? h("img", { src: user.avatar, alt: "" }) : initials(user.name));
}

/* ---------- Online status ----------
   presenceDot / presenceText carry data-presence attributes, so live updates can repaint them. */
export function lastSeenText(online, lastSeen) {
  if (online) return "Online";
  if (!lastSeen) return "Offline";
  const s = Math.max(0, (Date.now() - new Date(lastSeen)) / 1000);
  if (s < 60) return "Active just now";
  if (s < 3600) return `Active ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `Active ${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `Active ${Math.floor(s / 86400)}d ago`;
  return "Offline";
}
export function presenceDot(user) {
  const idle = user.online && user.idle;
  return h("span", { class: "presence-dot" + (idle ? " idle" : user.online ? " online" : ""), "data-presence-dot": user.username, title: idle ? "Idle" : user.online ? "Online" : lastSeenText(false, user.lastSeen) });
}
export function presenceText(user) {
  const idle = user.online && user.idle;
  return h("span", { class: "presence-text" + (idle ? " idle" : user.online ? " online" : ""), "data-presence-text": user.username, "data-last-seen": user.lastSeen || "", text: idle ? "Idle" : lastSeenText(user.online, user.lastSeen) });
}
// An avatar with a green dot when the person is online
export function avatarWithPresence(user, size = 42) {
  return h("span", { class: "avatar-presence", style: `--size:${size}px` }, avatar(user, size), presenceDot(user));
}

/* ---------- Formatting ---------- */
export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 7 * 86400) return Math.floor(s / 86400) + "d";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
export function timeEl(iso) {
  return h("time", { datetime: iso, title: new Date(iso).toLocaleString("en-US"), text: timeAgo(iso) });
}
export function count(n) {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "") + "K";
  return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
}
export function duration(sec) {
  if (!Number.isFinite(sec)) return "";
  sec = Math.round(sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const p = (x) => String(x).padStart(2, "0");
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}
export const plural = (n, one, many) => `${count(n)} ${n === 1 ? one : many}`;

/* ---------- Feedback ---------- */
let toastTimer;
export function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}
export function spinner() {
  return h("div", { class: "loading" }, h("div", { class: "spinner", role: "status", "aria-label": "Loading" }));
}
export function empty(title, text, action) {
  return h("div", { class: "empty" }, h("h3", { text: title }), text ? h("p", { text }) : null, action || null);
}

/* ---------- Modals (grow out of the center, like the log in pop-up) ---------- */
export function modal({ title, body, wide = false, onClose }) {
  const closeBtn = h("button", { class: "icon-btn", "aria-label": "Close" }, icon("close"));
  const card = h("div", { class: "app-modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
    h("header", { class: "app-modal-head" }, closeBtn, h("h2", { text: title })),
    h("div", { class: "app-modal-body" }, body)
  );
  const overlay = h("div", { class: "app-overlay" }, card);
  const prevFocus = document.activeElement;
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    overlay.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => overlay.remove(), 250);
    document.body.classList.remove("no-scroll");
    prevFocus?.focus?.();
    onClose?.();
  }
  const onKey = (e) => e.key === "Escape" && close();
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  document.body.classList.add("no-scroll");
  requestAnimationFrame(() => overlay.classList.add("open"));
  return { close, card };
}

// Two-step button: first click asks, second click does it
export function confirmClick(btn, label, action) {
  let armed = false, timer;
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!armed) {
      armed = true;
      btn.classList.add("confirm");
      btn.append(h("span", { class: "confirm-label", text: label }));
      timer = setTimeout(() => {
        armed = false;
        btn.classList.remove("confirm");
        btn.querySelector(".confirm-label")?.remove();
      }, 3000);
      return;
    }
    clearTimeout(timer);
    await action();
  });
}

/* ---------- Times like 1:23 or 1:02:03 in text become links that jump the video there ---------- */
const TIME_RE = /(^|[^\d:])((?:\d{1,2}:)?\d{1,2}:[0-5]\d)(?![\d:])/g;
export const toSeconds = (t) => t.split(":").reduce((n, x) => n * 60 + Number(x), 0);
export const fmtTime = (sec) => { sec = Math.max(0, Math.floor(sec)); const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60; return (hh ? hh + ":" + String(mm).padStart(2, "0") : mm) + ":" + String(ss).padStart(2, "0"); };
export function linkTimes(el, onSeek, maxSec = Infinity) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) if (!walk.currentNode.parentElement.closest("a, button")) nodes.push(walk.currentNode);
  for (const n of nodes) {
    const text = n.nodeValue;
    TIME_RE.lastIndex = 0;
    if (!TIME_RE.test(text)) continue;
    TIME_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = TIME_RE.exec(text))) {
      const start = m.index + m[1].length, sec = toSeconds(m[2]);
      if (sec > maxSec + 1) continue;
      frag.append(text.slice(last, start));
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ts-link";
      b.textContent = m[2];
      b.title = `Jump to ${m[2]}`;
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onSeek(sec); });
      frag.append(b);
      last = start + m[2].length;
    }
    frag.append(text.slice(last));
    n.replaceWith(frag);
  }
  return el;
}

// Where to put a panel next to a button. If the button is hidden (e.g. it's in the ＋ panel, which just closed),
// use the message box it belongs to, so the panel opens there and not in a corner of the screen.
export function visibleRect(el) {
  const r = el.getBoundingClientRect();
  if (r.width || r.height) return r;
  const form = el.closest(".convo-form");
  const alt = form?.querySelector(".convo-input .tray-btn") || form?.querySelector(".convo-input") || el.closest("form, .composer, .create-form");
  return alt ? alt.getBoundingClientRect() : r;
}
