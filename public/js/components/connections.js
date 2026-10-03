// Who follows someone, and whom they follow, in a pop-up with two tabs.
import { h, avatar, modal, spinner, empty, tick } from "../ui.js";
import { api } from "../api.js";
import { profileHref } from "../router.js";
import { followButton } from "../pages/profile.js";

function personRow(u, close) {
  const href = profileHref(u.username);
  return h("div", { class: "conn-row" },
    h("a", { href, tabindex: "-1", onclick: close }, avatar(u, 48)),
    h("div", { class: "who" },
      h("a", { href, class: "name", onclick: close }, u.name, tick(u)),
      h("span", { class: "muted" }, "@" + u.username, u.followsYou && !u.isMe ? h("span", { class: "follows-you", text: "Follows you" }) : null),
      u.bio ? h("p", { class: "person-bio", text: u.bio }) : null
    ),
    u.isMe ? h("span", { class: "muted you", text: "You" }) : followButton(u.username, u.isFollowing, { small: true })
  );
}

export function openConnections(profile, start = "followers") {
  const tabs = h("div", { class: "tabs conn-tabs", role: "tablist" });
  const list = h("div", { class: "conn-list" });
  const m = modal({ title: `@${profile.username}`, body: [tabs, list] });
  let seq = 0;

  async function show(kind) {
    const mine = ++seq;
    tabs.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.kind === kind);
      t.setAttribute("aria-selected", String(t.dataset.kind === kind));
    });
    list.replaceChildren(spinner());
    try {
      const { users } = await api(`/api/users/${encodeURIComponent(profile.username)}/${kind}`);
      if (mine !== seq) return;
      list.replaceChildren();
      if (!users.length) {
        const who = profile.isMe ? "You" : profile.name;
        list.append(kind === "followers"
          ? empty("No followers yet.", profile.isMe ? "When people follow you, they’ll show up here." : `When people follow ${who}, they’ll show up here.`)
          : empty("Not following anyone yet.", profile.isMe ? "People you follow show up here." : `${who} doesn’t follow anyone yet.`));
        return;
      }
      users.forEach((u) => list.append(personRow(u, m.close)));
    } catch (err) {
      list.replaceChildren(empty("Couldn’t load this list.", err.error || "Try again in a moment."));
    }
  }

  for (const [kind, label] of [["followers", "Followers"], ["following", "Following"]]) {
    tabs.append(h("button", { class: "tab", role: "tab", text: label, dataset: { kind }, onclick: () => show(kind) }));
  }
  show(start);
}
