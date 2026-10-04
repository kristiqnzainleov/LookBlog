// The bell in the top bar: a list of what happened, with a live unread count.
import { $, h, avatar, timeEl, toast, spinner, empty, tick } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { navigate, profileHref, postHref } from "../router.js";

const kindWord = (t) => (t === "video" ? "video" : t === "short" ? "short" : "post");

function sentence(n) {
  const what = kindWord(n.postType);
  switch (n.type) {
    case "follow": return "started following you";
    case "team": return "";
    case "security": return "· security";
    case "song-comment": return "commented on your song";
    case "song": return `released a new song${n.text ? ": " + n.text : ""}`;
    case "tag": return `tagged you in their ${what}`;
    case "mention": return n.postId ? "tagged you" : "tagged you in their bio";
    case "comment": return `replied to your ${what}`;
    case "answer": return "answered your reply";
    case "reaction": return `reacted ${n.emoji || ""} to your reply`;
    case "cool": return `thinks your ${what} is cool`;
    case "repost": return `reposted your ${what}`;
    case "badge": return `earned ${n.text || "a new badge"}`;
    case "live": return `is live now${n.text ? ": " + n.text : ""}`;
    case "creator-heart": return `💗 loved your reply${n.text ? ": " + n.text : ""}`;
    case "video-reply": return `replied to your video with a video${n.text ? ": " + n.text : ""}`;
    case "chat-mention": return `mentioned you${n.group ? " in " + n.group : ""}${n.text ? ": " + n.text : ""}`;
    case "live-upcoming": return `scheduled a live stream${n.text ? ": " + n.text : ""}`;
    case "live-mod": return `made you a moderator on their live${n.text ? ": " + n.text : ""}`;
    case "upcoming-video": return `has a video coming soon${n.text ? ": " + n.text : ""}`;
    case "premiere": return `just released${n.text ? ": " + n.text : " a new video"}`;
    case "public-event": return "is hosting a new event";
    case "public-event-now": return "’s event is happening now";
    case "event-now": return `’s event in ${n.group || "a group"} is happening now`;
    case "public-event-join": return "is going to your event";
    case "public-event-post": return "wrote in your event";
    case "public-event-start": return "’s event is starting soon";
    case "public-event-cancelled": return "cancelled an event you were going to";
    case "follow-request": return "wants to follow you";
    case "follow-accept": return "accepted your follow request";
    case "event": return `planned an event in ${n.group || "a group"}`;
    case "event-start": return `’s event in ${n.group || "a group"} is starting soon`;
    case "invite": return `invited you to join ${n.group || "a group"}`;
    case "upload": return n.postType === "video" ? "uploaded a new video" : n.postType === "short" ? "posted a new short" : "posted something new";
    default: return "did something";
  }
}
function target(n) {
  if (n.link) return n.link;
  if (n.type === "team") return null;
  if (n.streamId) return `/live/${encodeURIComponent(n.streamId)}`;
  if (n.eventId) return `/event/${encodeURIComponent(n.eventId)}`;
  if (n.type === "invite" && n.code) return `/invite/${encodeURIComponent(n.code)}`;
  if (n.type === "chat-mention" && n.chatId) return `/messages/${encodeURIComponent(n.chatId)}`;
  if ((n.type === "event" || n.type === "event-start" || n.type === "event-now") && n.chatId) return `/messages/${encodeURIComponent(n.chatId)}`;
  if (!n.postId) return profileHref(n.actor.username);
  if (n.postType === "video") return `/watch/${encodeURIComponent(n.postId)}`;
  if (n.postType === "short") return `/shorts?id=${encodeURIComponent(n.postId)}`;
  const hash = ["comment", "answer", "reaction"].includes(n.type) ? "#replies" : "";
  return postHref(n.postId) + hash;
}
const ICON = { team: "🛡️", "creator-heart": "💗", "video-reply": "🎥", "chat-mention": "@", live: "🔴", "live-upcoming": "📅", "live-mod": "🛡️", "upcoming-video": "⏳", premiere: "🎬", "public-event-now": "🔴", "event-now": "🔴", "song-comment": "🎵", security: "🔐", song: "🎵", tag: "👥", "public-event": "📅", "public-event-join": "🙋", "public-event-post": "💬", "public-event-start": "⏰", "public-event-cancelled": "❌", "follow-request": "🔒", "follow-accept": "✅", event: "📅", "event-start": "⏰", invite: "📨", badge: "🏅", follow: "👋", mention: "@", comment: "💬", answer: "↩", reaction: "", cool: "😎", repost: "🔁", upload: "🔔" };

function itemEl(n, close) {
  const quote = n.type === "badge" ? null : n.text || n.postText;
  const el = h("a", { class: "notif" + (n.read ? "" : " unread"), href: target(n) },
    h("span", { class: "notif-pic" }, avatar(n.actor, 44, n.actor.team ? "team-av" : ""), h("span", { class: "notif-kind", text: n.type === "reaction" ? n.emoji || "❤️" : ICON[n.type] || "•" })),
    h("span", { class: "notif-text" },
      h("span", {}, h("b", {}, n.actor.name, tick(n.actor, 14)), (/^(event-start|public-event-start|event-now|public-event-now)$/.test(n.type) ? "" : " ") + sentence(n)),
      quote ? h("span", { class: "notif-quote", text: quote }) : null,
      h("span", { class: "notif-time" }, timeEl(n.createdAt))
    ),
    n.thumb ? h("img", { class: "notif-thumb", src: n.thumb, alt: "", loading: "lazy" }) : null
  );
  // Follow requests can be answered right here
  if (n.type === "follow-request") {
    const yes = h("button", { type: "button", class: "btn btn-xs btn-primary", text: "Accept" });
    const no = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Decline" });
    const answer = async (e, accept) => {
      e.preventDefault(); e.stopPropagation();
      try { await api(`/api/me/requests/${encodeURIComponent(n.actor.username)}`, { method: "POST", body: { accept } }); acts.replaceChildren(h("span", { class: "muted", text: accept ? "Accepted ✓" : "Declined" })); }
      catch (err) { acts.replaceChildren(h("span", { class: "muted", text: err.error || "Already answered" })); }
    };
    yes.addEventListener("click", (e) => answer(e, true));
    no.addEventListener("click", (e) => answer(e, false));
    const acts = h("span", { class: "notif-acts" }, no, yes);
    el.querySelector(".notif-text").append(acts);
  }
  el.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    close();
    if (target(n)) navigate(target(n));
  });
  return el;
}

export function setupNotifications() {
  const btn = $("bellBtn"), pop = $("notifPop"), list = $("notifList"), badge = $("bellBadge");
  const paintBadge = (n) => { badge.textContent = n > 99 ? "99+" : String(n); badge.hidden = !n; };
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };

  async function open() {
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    list.replaceChildren(spinner());
    try {
      const { notifications } = await api("/api/notifications");
      list.replaceChildren();
      if (!notifications.length) list.append(empty("Nothing yet.", "When people follow you, tag you, reply or react, it shows up here. Turn on the bell on someone’s profile to hear when they post."));
      notifications.forEach((n) => list.append(itemEl(n, close)));
      if (notifications.some((n) => !n.read)) {
        await api("/api/notifications/read", { method: "POST" });
        paintBadge(0);
      }
    } catch (err) {
      list.replaceChildren(empty("Couldn’t load notifications.", err.error || ""));
    }
  }

  btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden ? open() : close(); });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) close(); });
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());

  // Live: count goes up, a short message pops up, and an open list gets the new item on top
  on("notification", (ev) => {
    const n = ev.notification;
    if (!pop.hidden) {
      list.querySelector(".empty")?.remove();
      list.prepend(itemEl({ ...n, read: true }, close));
      api("/api/notifications/read", { method: "POST" }).catch(() => {});
    } else {
      paintBadge(ev.unread);
    }
    toast(`${n.actor.name}${/^(event-start|public-event-start|event-now|public-event-now)$/.test(n.type) ? "" : " "}${sentence(n)}.`);
  });

  api("/api/notifications").then(({ unread }) => paintBadge(unread)).catch(() => {});
}
