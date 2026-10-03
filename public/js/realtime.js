// Live updates from the server. Counts on screen update in place:
//   [data-post-id][data-stat="likes|dislikes|views|comments"]  for posts
//   [data-followers="username"]                                for follower counts
//   [data-following="username"]                                for following counts
import { emit } from "./state.js";
import { repaintPost } from "./components/edit-post.js";
import { count, lastSeenText } from "./ui.js";

function bump(el, value) {
  if (el.textContent === value) return;
  el.textContent = value;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

export function connect() {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }

    if (ev.type === "stats") {
      for (const stat of ["likes", "dislikes", "views", "comments", "reposts", "cools", "shares"]) { if (ev[stat] === undefined) continue;
        document.querySelectorAll(`[data-post-id="${CSS.escape(ev.id)}"][data-stat="${stat}"]`).forEach((el) => bump(el, count(ev[stat])));
      }
    }
    if (ev.type === "follow") {
      document.querySelectorAll(`[data-followers="${CSS.escape(ev.username)}"]`).forEach((el) => bump(el, count(ev.followers)));
      document.querySelectorAll(`[data-following="${CSS.escape(ev.by)}"]`).forEach((el) => bump(el, count(ev.byFollowing)));
    }
    if (ev.type === "thumbnail") {
      document.querySelectorAll(`[data-thumb-for="${CSS.escape(ev.id)}"]`).forEach((el) => {
        if (el.tagName === "VIDEO") el.setAttribute("poster", ev.poster); else el.src = ev.poster;
      });
    }
    if (ev.type === "presence") {
      const name = CSS.escape(ev.username);
      document.querySelectorAll(`[data-presence-dot="${name}"]`).forEach((el) => {
        el.classList.toggle("online", ev.online);
        el.title = lastSeenText(ev.online, ev.lastSeen);
      });
      document.querySelectorAll(`[data-presence-text="${name}"]`).forEach((el) => {
        el.classList.toggle("online", ev.online);
        el.dataset.lastSeen = ev.lastSeen || "";
        el.textContent = lastSeenText(ev.online, ev.lastSeen);
      });
    }
    if (ev.type === "post:edited") repaintPost(ev);
    emit(ev.type, ev);
  };
  return es;
}
