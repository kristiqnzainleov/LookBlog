// Star ratings for movies and series: the average of everyone's stars, and your own 1–5.
import { h, toast } from "../ui.js";
import { api } from "../api.js";

// "★ 4.3 (12)" — small, for cards
export function starsBadge(stars) {
  if (!stars?.count) return null;
  return h("span", { class: "stars-badge", title: `${stars.avg} out of 5 from ${stars.count} rating${stars.count === 1 ? "" : "s"}` }, h("b", { text: "★ " + stars.avg.toFixed(1) }), h("small", { text: ` (${stars.count})` }));
}

// The big one: average + "Your rating" with 5 clickable stars. rateUrl: where to POST { stars }
export function starsWidget(stars, { rateUrl, mine = false } = {}) {
  let s = stars || { avg: null, count: 0, mine: null };
  const el = h("div", { class: "stars-widget" });
  const row = (value, { big = false, interactive = false } = {}) => {
    const wrap = h("span", { class: "stars-row" + (big ? " big" : "") + (interactive ? " pick" : "") });
    for (let i = 1; i <= 5; i++) {
      const fill = Math.max(0, Math.min(1, (value || 0) - (i - 1)));
      const st = h(interactive ? "button" : "span", { type: interactive ? "button" : undefined, class: "star", title: interactive ? `${i} star${i === 1 ? "" : "s"}` : undefined, style: `--fill:${Math.round(fill * 100)}%` }, h("span", { text: "★" }));
      if (interactive) {
        st.addEventListener("mouseenter", () => wrap.querySelectorAll(".star").forEach((x, k) => x.style.setProperty("--fill", k < i ? "100%" : "0%")));
        st.addEventListener("click", async () => {
          try { s = (await api(rateUrl, { method: "POST", body: { stars: s.mine === i ? 0 : i } })).stars; paint(); toast(s.mine ? `You gave it ${s.mine} star${s.mine === 1 ? "" : "s"}.` : "Rating removed."); }
          catch (err) { toast(err.error || "Couldn’t save your rating."); }
        });
      }
      wrap.append(st);
    }
    if (interactive) wrap.addEventListener("mouseleave", () => paint());
    return wrap;
  };
  function paint() {
    el.replaceChildren(
      h("div", { class: "sw-avg" }, row(s.avg, { big: true }), h("b", { class: "sw-num", text: s.avg ? s.avg.toFixed(1) : "–" }), h("span", { class: "muted", text: s.count ? `${s.count} rating${s.count === 1 ? "" : "s"}` : "No ratings yet" })),
      mine ? null : h("div", { class: "sw-mine" }, h("span", { class: "muted", text: s.mine ? "Your rating:" : "Rate it:" }), row(s.mine || 0, { interactive: true })));
  }
  paint();
  return el;
}
