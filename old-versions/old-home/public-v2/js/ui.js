// Small UI helpers. User text always goes in with textContent, never as HTML.

export const $ = (id) => document.getElementById(id);

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
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  repost: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9a3 3 0 0 1 3-3h14M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v2a3 3 0 0 1-3 3h-14"/>',
};
export function icon(name, cls = "") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  if (cls) s.setAttribute("class", cls);
  s.innerHTML = ICONS[name] || "";
  return s;
}

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
  const el = h("span", { class: `avatar ${tone(user.username)} ${extra}`.trim(), style: `--size:${size}px`, "aria-hidden": "true" });
  if (user.avatar) el.append(h("img", { src: user.avatar, alt: "", loading: "lazy", decoding: "async" }));
  else el.textContent = initials(user.name);
  return el;
}
export function fillAvatar(el, user) {
  el.className = `avatar ${tone(user.username)}`;
  el.replaceChildren(user.avatar ? h("img", { src: user.avatar, alt: "" }) : initials(user.name));
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
