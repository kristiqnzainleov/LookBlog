// Links in messages and posts: YouTube, Instagram, TikTok, Spotify, Vimeo and SoundCloud play right here;
// any other web page shows a small preview card (title, picture, site).
import { h } from "../ui.js";
import { api } from "../api.js";

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/i;
export const firstUrl = (text) => {
  const m = URL_RE.exec(text || "");
  if (!m) return null;
  // Our own invite and event links already have their own cards
  try { const u = new URL(m[0]); if (u.host === location.host) return null; } catch { return null; }
  return m[0];
};

function embed(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  // Nothing loads from the other site until you tap: its player can set its own cookies (Cookie Policy)
  const frame = (src, cls, title) => {
    const site = title.split(" ")[0];
    const box = h("div", { class: "embed embed-wait " + cls });
    const go = h("button", { type: "button", class: "embed-load" }, h("b", { text: "▶ Load " + title }), h("small", { text: `This loads content from ${site}, which may set its own cookies.` }));
    go.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      box.classList.remove("embed-wait");
      box.replaceChildren(h("iframe", { src: src + (/youtube-nocookie|vimeo/.test(src) ? (src.includes("?") ? "&" : "?") + "autoplay=1" : ""), title, allow: "autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin", frameborder: "0" }));
    });
    box.append(go);
    return box;
  };
  // YouTube (videos, shorts, youtu.be)
  let id = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host.endsWith(".youtube.com")) id = u.searchParams.get("v") || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/) || [])[1];
  if (id && /^[\w-]{6,15}$/.test(id)) {
    const t = u.searchParams.get("t");
    const start = t ? (/^\d+$/.test(t) ? t : String((Number((t.match(/(\d+)m/) || [])[1] || 0) * 60) + Number((t.match(/(\d+)s/) || [])[1] || 0))) : "";
    return frame(`https://www.youtube-nocookie.com/embed/${id}${start ? "?start=" + start : ""}`, u.pathname.startsWith("/shorts") ? "tall" : "wide", "YouTube video");
  }
  // Instagram posts and reels
  const ig = host === "instagram.com" && u.pathname.match(/^\/(p|reel|reels|tv)\/([\w-]+)/);
  if (ig) return frame(`https://www.instagram.com/${ig[1] === "reels" ? "reel" : ig[1]}/${ig[2]}/embed`, "insta", "Instagram post");
  // TikTok
  const tt = (host === "tiktok.com" || host.endsWith(".tiktok.com")) && u.pathname.match(/\/video\/(\d+)/);
  if (tt) return frame(`https://www.tiktok.com/embed/v2/${tt[1]}`, "tall", "TikTok video");
  // Spotify (track, album, playlist, episode)
  const sp = host === "open.spotify.com" && u.pathname.match(/^\/(?:intl-\w+\/)?(track|album|playlist|episode|artist|show)\/(\w+)/);
  if (sp) return frame(`https://open.spotify.com/embed/${sp[1]}/${sp[2]}`, sp[1] === "track" || sp[1] === "episode" ? "spotify" : "spotify big", "Spotify");
  // Vimeo
  const vm = host === "vimeo.com" && u.pathname.match(/^\/(\d+)/);
  if (vm) return frame(`https://player.vimeo.com/video/${vm[1]}`, "wide", "Vimeo video");
  // SoundCloud
  if (host === "soundcloud.com" && u.pathname.split("/").filter(Boolean).length >= 2) return frame(`https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff4fa3&visual=false`, "spotify", "SoundCloud");
  return null;
}

// The card for any other link
function previewCard(url) {
  const card = h("a", { class: "link-card loading", href: url, target: "_blank", rel: "noopener noreferrer nofollow" },
    h("span", { class: "lc-site", text: (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })() }));
  api(`/api/link-preview?url=${encodeURIComponent(url)}`).then(({ preview: p }) => {
    card.classList.remove("loading");
    card.replaceChildren(
      p.image ? h("div", { class: "lc-img", style: `background-image:url("${p.image.replace(/"/g, "%22")}")` }) : null,
      h("div", { class: "lc-text" }, h("span", { class: "lc-site", text: p.site }), p.title ? h("b", { text: p.title }) : null, p.description ? h("span", { class: "lc-desc", text: p.description }) : null));
  }).catch(() => card.classList.remove("loading"));
  return card;
}

// What to show under a message or post that has a link (or null)
export function linkBlock(text) {
  const url = firstUrl(text);
  if (!url) return null;
  return embed(url) || previewCard(url);
}
