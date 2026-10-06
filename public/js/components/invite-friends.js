// "Invite friends": my own Join LookBlog link (a referral). Shared in Instagram, Messenger and others it shows
// the LookBlog logo and "Join LookBlog". It also shows who joined with it.
import { h, modal, toast, avatar, spinner, timeAgo } from "../ui.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { navigate, profileHref } from "../router.js";

const isPhone = () => matchMedia("(pointer: coarse)").matches;

export async function openInviteFriends() {
  const body = h("div", { class: "create-form invite-friends" }, spinner());
  const m = modal({ title: "Invite friends", body });
  let d;
  try { d = await api("/api/me/invite"); } catch (err) { body.replaceChildren(h("p", { class: "muted", text: err.error || "Couldn’t make your link." })); return; }
  const text = `Join me on LookBlog! Follow people, not the algorithm. 💗`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(d.url); toast("Link copied. Paste it in Instagram, Messenger or anywhere."); }
    catch { prompt("Copy your link:", d.url); }
  };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: "Join LookBlog", text, url: d.url }); } catch {} }
    else copy();
  };
  const enc = encodeURIComponent;
  // Instagram: the link goes in a direct message (it shows the logo and "Join LookBlog").
  // Phones: the share menu (pick Instagram). Otherwise: the link is copied and Instagram's "new message" opens to paste it.
  const toInstagram = async () => {
    if (isPhone() && navigator.share) { try { await navigator.share({ title: "Join LookBlog", text, url: d.url }); return; } catch (e) { if (e.name === "AbortError") return; } }
    await copy();
    open("https://www.instagram.com/direct/new/", "_blank", "noopener");
  };
  const btn = (cls, label, fn, ic) => { const b = h("button", { type: "button", class: "inv-btn " + cls }, h("span", { class: "inv-ic", text: ic }), h("span", { text: label })); b.addEventListener("click", fn); return b; };
  const link = (cls, label, href, ic) => h("a", { class: "inv-btn " + cls, href, target: "_blank", rel: "noopener" }, h("span", { class: "inv-ic", text: ic }), h("span", { text: label }));

  const joined = d.joined.length
    ? h("div", { class: "inv-joined" }, h("p", { class: "inv-count" }, h("b", { text: String(d.joined.length) }), d.joined.length === 1 ? " friend joined with your invite 🎉" : " friends joined with your invite 🎉"),
        ...d.joined.slice().reverse().map((u) => h("a", { class: "conn-row", href: profileHref(u.username), onclick: (e) => { e.preventDefault(); m.close(); navigate(profileHref(u.username)); } },
          avatar(u, 36), h("div", { class: "who" }, h("b", { text: u.name }), h("span", { class: "muted", text: `@${u.username} · joined ${timeAgo(u.at)}` })))))
    : h("p", { class: "muted inv-none", text: "Nobody has joined with your link yet. When they do, they show up here (and you get a notification)." });

  body.replaceChildren(
    // What people see when you share it
    h("div", { class: "inv-preview" },
      h("img", { src: "/og/join.jpg", alt: "LookBlog: Join LookBlog", class: "inv-img" }),
      h("div", { class: "inv-meta" }, h("b", { text: "Join LookBlog" }), h("small", { class: "muted", text: `${state.me.name} invited you · ${new URL(d.url).host}` }))),
    h("div", { class: "inv-link" }, h("input", { type: "text", readonly: true, value: d.url, "aria-label": "Your invite link", onclick: (e) => e.target.select() }), h("button", { type: "button", class: "btn btn-primary btn-sm", text: "Copy", onclick: copy })),
    h("div", { class: "inv-grid" },
      btn("share", navigator.share ? "Share…" : "Copy link", share, "📤"),
      isPhone() ? link("messenger", "Messenger", `fb-messenger://share/?link=${enc(d.url)}`, "💬")
        : btn("messenger", "Messenger", async () => { await copy(); open("https://www.messenger.com/", "_blank", "noopener"); }, "💬"),
      btn("insta", "Instagram", () => toInstagram(), "📸"),
      link("whatsapp", "WhatsApp", `https://wa.me/?text=${enc(text + " " + d.url)}`, "🟢"),
      link("x", "X", `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(d.url)}`, "✖️"),
      link("fb", "Facebook", `https://www.facebook.com/sharer/sharer.php?u=${enc(d.url)}`, "📘")),
    h("p", { class: "create-hint", text: isPhone() ? "Instagram: tap “Instagram” and pick Instagram to send your link in a message. It shows the LookBlog logo and “Join LookBlog”." : "Instagram and Messenger: your link is copied and the app opens. Paste it in a message: it shows the LookBlog logo and “Join LookBlog”." }),
    joined);
}
