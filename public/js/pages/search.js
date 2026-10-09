// /search?q= — find people and posts.
import { h, icon, avatar, empty, spinner, tick } from "../ui.js";
import { api } from "../api.js";
import { postCard } from "../components/post.js";
import { profileHref } from "../router.js";
import { followButton } from "./profile.js";
import { attachVoiceSearch } from "../components/voice-search.js";

export function personRow(u) {
  const href = profileHref(u.username);
  return h("div", { class: "person" },
    h("a", { href, tabindex: "-1" }, avatar(u, 48)),
    h("div", { class: "who" },
      h("a", { href, class: "name" }, u.name, tick(u)),
      h("span", { class: "muted", text: "@" + u.username }),
      u.bio ? h("p", { class: "person-bio", text: u.bio }) : null
    ),
    u.isMe ? null : followButton(u.username, u.isFollowing)
  );
}

export function searchPage(view, _m, params) {
  document.title = "Search / Look Blog";
  view.classList.add("page-search");
  const input = h("input", { type: "search", placeholder: "Search people and posts", value: params.get("q") || "", autocomplete: "off", "aria-label": "Search" });
  const form = h("form", { class: "search-box", role: "search" }, icon("search"), input);
  attachVoiceSearch(form, input); // say it instead of typing
  const results = h("div", { class: "search-results" });
  view.append(h("header", { class: "column-head" }, h("div", { class: "head-row" }, form)), results);

  // What you searched is remembered: when you arrive with a search, press Enter, or open a result
  import("../components/search-suggest.js").then((m) => {
    if (params.get("q")) m.rememberSearch(params.get("q"));
    form.addEventListener("submit", () => m.rememberSearch(input.value));
    results.addEventListener("click", (e) => { if (e.target.closest("a, button")) m.rememberSearch(input.value); });
  });
  let timer, seq = 0;
  async function run(q) {
    const mine = ++seq;
    if (!q.trim()) {
      results.replaceChildren(empty("Find people on Look Blog", "Search by name or @username. You can also search the text of posts."));
      return;
    }
    results.replaceChildren(spinner());
    try {
      const { users, fromPeople = [], posts } = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (mine !== seq) return;
      results.replaceChildren();
      if (!users.length && !posts.length && !fromPeople.length) return results.append(empty(`No results for “${q}”`, "Try a different name or word."));
      if (users.length) results.append(h("h2", { class: "section-title", text: "People" }), ...users.map(personRow));
      // What the people you searched for posted
      for (const x of fromPeople) {
        results.append(h("div", { class: "search-from" },
          h("h2", { class: "section-title" }, "From ", x.user.name, tick(x.user, 16)),
          h("a", { class: "btn btn-xs btn-outline-light", href: profileHref(x.user.username), text: "See profile" })),
          ...x.posts.map((p) => postCard(p)));
      }
      if (posts.length) results.append(h("h2", { class: "section-title", text: fromPeople.length ? "More posts" : "Posts" }), ...posts.map((p) => postCard(p)));
    } catch (err) {
      results.replaceChildren(empty("Search isn’t working right now.", err.error || "Try again in a moment."));
    }
  }
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      history.replaceState(null, "", input.value.trim() ? `/search?q=${encodeURIComponent(input.value.trim())}` : "/search");
      run(input.value);
    }, 250);
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); run(input.value); });
  run(input.value);
  setTimeout(() => input.focus(), 0);
  return () => clearTimeout(timer);
}
searchPage.navName = () => "search";
