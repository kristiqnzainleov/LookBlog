// Live updates from the server. Counts on screen update in place:
//   [data-post-id][data-stat="likes|dislikes|views|comments"]  for posts
//   [data-followers="username"]                                for follower counts
//   [data-following="username"]                                for following counts
import { emit } from "./state.js";
import { count } from "./ui.js";

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
      for (const stat of ["likes", "dislikes", "views", "comments", "reposts"]) {
        document.querySelectorAll(`[data-post-id="${CSS.escape(ev.id)}"][data-stat="${stat}"]`).forEach((el) => bump(el, count(ev[stat])));
      }
    }
    if (ev.type === "follow") {
      document.querySelectorAll(`[data-followers="${CSS.escape(ev.username)}"]`).forEach((el) => bump(el, count(ev.followers)));
      document.querySelectorAll(`[data-following="${CSS.escape(ev.by)}"]`).forEach((el) => bump(el, count(ev.byFollowing)));
    }
    emit(ev.type, ev);
  };
  return es;
}
