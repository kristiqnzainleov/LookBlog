// "People to follow": a row of cards you can scroll sideways, shown in the feed.
import { h, avatar, tick } from "../ui.js";
import { api } from "../api.js";
import { profileHref } from "../router.js";
import { followButton } from "../pages/profile.js";

export function peopleStrip() {
  const row = h("div", { class: "people-row" });
  const el = h("section", { class: "people-strip", hidden: true }, h("h2", { text: "People to follow" }), row);

  api("/api/users/suggestions").then(({ users }) => {
    if (!users.length) return;
    for (const u of users) {
      const href = profileHref(u.username);
      row.append(h("div", { class: "person-card" },
        h("a", { href, tabindex: "-1" }, avatar(u, 72)),
        h("a", { href, class: "name" }, u.name, tick(u)),
        h("span", { class: "muted", text: "@" + u.username }),
        followButton(u.username, false, { small: true })
      ));
    }
    el.hidden = false;
  }).catch(() => {});
  return el;
}
