// "Invite friends": my own Join LookBlog link (a referral). Shared in Instagram, Messenger and others it shows
// the LookBlog logo and "Join LookBlog"; there's also a picture for an Instagram story, and who joined with it.
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
      btn("insta", "Instagram story", () => storyImage(d.url), "📸"),
      link("whatsapp", "WhatsApp", `https://wa.me/?text=${enc(text + " " + d.url)}`, "🟢"),
      link("x", "X", `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(d.url)}`, "✖️"),
      link("fb", "Facebook", `https://www.facebook.com/sharer/sharer.php?u=${enc(d.url)}`, "📘")),
    h("p", { class: "create-hint", text: isPhone() ? "Instagram: tap “Instagram story” to share a picture with your link, or copy the link and send it in a DM." : "Instagram and Messenger: copy the link and paste it in a message. It shows the LookBlog logo and “Join LookBlog”." }),
    joined);
}

// A picture for an Instagram story (1080×1920): the logo with its eyes, "Join me on LookBlog", @me and the link
async function storyImage(url) {
  try { await document.fonts.load("900 120px Unbounded"); } catch {}
  const W = 1080, H = 1920, c = h("canvas", { width: W, height: H }), g = c.getContext("2d");
  g.fillStyle = "#0d0c0c"; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 520, 40, W / 2, 520, 900);
  glow.addColorStop(0, "rgba(255,79,163,0.55)"); glow.addColorStop(1, "rgba(255,79,163,0)");
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  // Logo: L(eye)(eye)k + Blog
  g.textBaseline = "alphabetic";
  g.font = "900 150px Unbounded, sans-serif";
  const eye = 92, gap = 8, parts = [["L", "#f5f0f0"], ["eyes"], ["k", "#f5f0f0"], ["Blog", "#ff4fa3"]];
  const widthOf = (p) => (p[0] === "eyes" ? eye * 2 + gap * 3 : g.measureText(p[0]).width - 10);
  let x = (W - parts.reduce((n, p) => n + widthOf(p), 0)) / 2;
  const base = 600;
  for (const p of parts) {
    if (p[0] === "eyes") {
      for (let i = 0; i < 2; i++) {
        const cx = x + gap + eye / 2 + i * (eye + gap), cy = base - eye / 2 - 4;
        g.fillStyle = "#f5f0f0"; g.beginPath(); g.arc(cx, cy, eye / 2, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#0d0c0c"; g.beginPath(); g.arc(cx + (i ? -10 : 10), cy + 6, eye / 4.2, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#fff"; g.beginPath(); g.arc(cx + (i ? -16 : 4), cy - 2, 6, 0, Math.PI * 2); g.fill();
      }
    } else { g.fillStyle = p[1]; g.fillText(p[0], x, base); }
    x += widthOf(p);
  }
  g.textAlign = "center";
  g.fillStyle = "#f5f0f0"; g.font = "900 96px Unbounded, sans-serif";
  g.fillText("Join me on", W / 2, 900); g.fillStyle = "#ff4fa3"; g.fillText("LookBlog", W / 2, 1010);
  g.fillStyle = "#b9b0b0"; g.font = "600 46px 'Golos Text', sans-serif";
  g.fillText("Follow people, not the algorithm.", W / 2, 1110);
  // Me
  g.fillStyle = "#f5f0f0"; g.font = "800 58px 'Golos Text', sans-serif";
  g.fillText("@" + state.me.username, W / 2, 1330);
  // The link in a pink pill
  g.font = "800 44px 'Golos Text', sans-serif";
  const label = url.replace(/^https?:\/\//, ""), lw = g.measureText(label).width + 90;
  g.fillStyle = "#ff4fa3"; g.beginPath(); g.roundRect((W - lw) / 2, 1430, lw, 110, 55); g.fill();
  g.fillStyle = "#000"; g.fillText(label, W / 2, 1502);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const file = new File([blob], "join-lookblog.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] }) && matchMedia("(pointer: coarse)").matches) {
    // Phones: the share sheet (Instagram is in it)
    try { await navigator.share({ files: [file], title: "Join LookBlog", text: url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = h("a", { href: URL.createObjectURL(blob), download: "join-lookblog.png" });
  document.body.append(a); a.click(); a.remove();
  toast("Saved the picture. Put it in your Instagram story and add a link sticker with your invite link.");
}
