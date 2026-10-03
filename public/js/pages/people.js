// /people — find people to follow: who follows you, friends of friends, popular and new people. Search by name.
import { h, avatar, tick, empty, spinner, count } from "../ui.js";
import { api } from "../api.js";
import { profileHref } from "../router.js";
import { followButton } from "./profile.js";

const HIDE_KEY = "lb_people_hidden";
const hidden = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || "[]")); } catch { return new Set(); } };

export function peoplePage(view) {
  document.title = "Find people / LookBlog";
  view.classList.add("page-people");
  const search = h("input", { type: "search", class: "text-input people-search", placeholder: "Search anyone — type a name or @username", autocomplete: "off" });
  const tabs = h("div", { class: "tabs" });
  const grid = h("div", { class: "people-grid" });
  let tab = "all", seq = 0, timer;
  const TABS = [["all", "Suggested"], ["back", "Follow back"], ["friends", "Friends of friends"], ["new", "New on LookBlog"]];
  const paintTabs = () => tabs.replaceChildren(...TABS.map(([k, l]) => h("button", { class: "tab" + (k === tab ? " active" : ""), text: l, onclick: () => { tab = k; paintTabs(); load(); } })));
  view.append(h("header", { class: "column-head" },
    h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "Find people" }), h("p", { class: "page-sub", text: "People you might know or like — follow them to see their posts, shorts and lives." }))),
    search, tabs), grid);
  async function load() {
    const n = ++seq;
    grid.replaceChildren(spinner());
    let users;
    try { ({ users } = await api(`/api/users/suggestions?limit=60&q=${encodeURIComponent(search.value.trim())}`)); } catch (err) { grid.replaceChildren(empty("Couldn’t load people.", err.error || "")); return; }
    if (n !== seq) return;
    const skip = hidden();
    users = users.filter((u) => !skip.has(u.username) || search.value.trim());
    // While searching, show everyone who matches (the tabs are for suggestions)
    if (!search.value.trim()) {
      if (tab === "back") users = users.filter((u) => u.followsMe);
      if (tab === "friends") users = users.filter((u) => u.mutual > 0);
      if (tab === "new") users = users.filter((u) => u.isNew);
    }
    if (!users.length) return grid.replaceChildren(empty(search.value.trim() ? "No one found." : "No suggestions here right now.", search.value.trim() ? "Try another name." : "Check the other tabs, or search by name."));
    grid.replaceChildren(...users.map((u) => {
      const href = profileHref(u.username);
      const x = h("button", { type: "button", class: "pc-hide", title: "Not interested", "aria-label": "Hide", text: "✕" });
      const card = h("div", { class: "people-card" }, x,
        h("a", { href, class: "pc-photo" }, avatar(u, 84)),
        h("a", { href, class: "pc-name" }, u.name, tick(u, 15)),
        h("span", { class: "muted pc-handle", text: "@" + u.username + (u.private ? " · 🔒" : "") }),
        h("span", { class: "pc-reason" + (u.followsMe ? " back" : ""), text: u.reason }),
        u.bio ? h("p", { class: "pc-bio", text: u.bio }) : null,
        h("span", { class: "muted pc-stats", text: `${count(u.followers)} follower${u.followers === 1 ? "" : "s"}${u.mutual ? ` · ${u.mutual} mutual` : ""}` }),
        followButton(u.username, u.following, { small: true }));
      x.addEventListener("click", () => { const s = hidden(); s.add(u.username); try { localStorage.setItem(HIDE_KEY, JSON.stringify([...s])); } catch {} card.remove(); });
      return card;
    }));
  }
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 220); });
  paintTabs();
  load();
}
peoplePage.navName = () => "people";
peoplePage.layout = "wide";
