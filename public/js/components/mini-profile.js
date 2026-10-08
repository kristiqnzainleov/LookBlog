// A small profile card that pops up when you tap a name (yours or someone's) in a group or chat
import { h, avatar, tick, toast } from "../ui.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { profileHref, navigate } from "../router.js";

let open = null;
export function closeMiniProfile() { open?.(); }
export async function miniProfile(username, anchor, { extra = null } = {}) {
  closeMiniProfile();
  const card = h("div", { class: "mini-profile", role: "dialog", "aria-label": "Profile" }, h("div", { class: "mp-loading", text: "…" }));
  document.body.append(card);
  const place = () => {
    const a = anchor.getBoundingClientRect(), w = Math.min(320, innerWidth - 16), ht = card.offsetHeight;
    card.style.width = w + "px";
    card.style.left = Math.max(8, Math.min(innerWidth - w - 8, a.left)) + "px";
    card.style.top = (a.top - ht - 10 > 8 ? a.top - ht - 10 : Math.min(innerHeight - ht - 8, a.bottom + 10)) + "px";
  };
  place();
  const away = (e) => { if (!card.contains(e.target) && !anchor.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const close = () => { card.classList.add("out"); setTimeout(() => card.remove(), 150); document.removeEventListener("pointerdown", away, true); removeEventListener("keydown", esc); open = null; };
  open = close;
  setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
  addEventListener("keydown", esc);
  let p;
  try { const d = await api(`/api/users/${encodeURIComponent(username)}`); p = d.profile || d.user || d; } catch (err) { card.replaceChildren(h("p", { class: "muted", text: err.error || "Couldn’t load the profile." })); return; }
  if (!card.isConnected) return;
  const look = p.look || {};
  const me = p.username === state.me.username;
  const banner = h("div", { class: "mp-banner", style: p.banner ? `background-image:url("${p.banner}")` : "" });
  if (look.banner && !p.banner) banner.dataset.bfx = look.banner, banner.classList.add("profile-banner", "empty");
  if (look.accent) card.style.setProperty("--pink", look.accent);
  const name = h("b", { class: "mp-name" }, p.name, tick(p, 16));
  const go = h("button", { type: "button", class: "btn btn-primary btn-sm", text: me ? "My profile" : "View profile" });
  go.addEventListener("click", () => { close(); navigate(profileHref(p.username)); });
  const btns = [go];
  if (me) {
    const edit = h("button", { type: "button", class: "btn btn-outline-light btn-sm", text: "🎨 Customize" });
    edit.addEventListener("click", () => { close(); navigate(profileHref(p.username) + "?customize=1"); });
    btns.push(edit);
  } else {
    const msg = h("button", { type: "button", class: "btn btn-outline-light btn-sm", text: "Message" });
    msg.addEventListener("click", async () => { try { const r = await api(`/api/dm/${encodeURIComponent(p.username)}`, { method: "POST" }); close(); navigate(`/messages/${(r.chat || r).id}`); } catch (err) { toast(err.error || "You can message when you follow each other."); } });
    btns.push(msg);
  }
  card.replaceChildren(banner,
    h("div", { class: "mp-body" },
      h("div", { class: "mp-av" }, avatar(p, 64)),
      name, h("span", { class: "muted mp-handle", text: "@" + p.username + (extra?.nickname ? ` · “${extra.nickname}” here` : "") }),
      look.status ? h("p", { class: "mp-status", text: `${look.status.emoji || ""} ${look.status.text || ""}`.trim() }) : null,
      extra?.groupStatus ? h("p", { class: "mp-status", text: `${extra.groupStatus.emoji || "💬"} ${extra.groupStatus.text || ""}` }) : null,
      p.bio ? h("p", { class: "mp-bio", text: p.bio }) : null,
      h("div", { class: "mp-stats" },
        h("span", {}, h("b", { text: String(p.followers ?? 0) }), " followers"), h("span", {}, h("b", { text: String(p.following ?? 0) }), " following"), p.posts != null ? h("span", {}, h("b", { text: String(p.posts) }), " posts") : null),
      h("div", { class: "mp-btns" }, ...btns)));
  if (look.color || look.font) import("./profile-look.js").then((m) => m.applyLook?.(name, look)).catch(() => {});
  place();
}
