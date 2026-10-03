// Tag people in a post, short or video ("with Mila and Desi"). They get a notification
// and the post shows up under "Tagged" on their profile.
import { h, avatar, toast, modal, tick } from "../ui.js";
import { api } from "../api.js";
import { state, on } from "../state.js";
import { profileHref } from "../router.js";

// While posting: a "Tag people" button and the chosen people as chips
export function tagPicker(initial = []) {
  let people = [...initial];
  const chips = h("div", { class: "tag-chips" });
  const btn = h("button", { type: "button", class: "tool-btn tag-btn", title: "Tag people", "aria-label": "Tag people" }, h("span", { text: "👥" }));
  const paint = () => {
    chips.replaceChildren(...people.map((u) => {
      const x = h("button", { type: "button", class: "tag-x", "aria-label": `Remove ${u.name}`, text: "×" });
      x.addEventListener("click", () => { people = people.filter((p) => p.username !== u.username); paint(); });
      return h("span", { class: "tag-chip" }, avatar(u, 20), h("span", { text: u.name }), x);
    }));
    chips.hidden = !people.length;
    btn.classList.toggle("on", people.length > 0);
  };
  btn.addEventListener("click", () => openTagSearch(people, (list) => { people = list; paint(); }));
  paint();
  return { button: btn, chips, value: () => people.map((u) => u.username), clear: () => { people = []; paint(); } };
}

// Search people to tag
export function openTagSearch(current, onDone, { title = "Tag people" } = {}) {
  let picked = [...current];
  const search = h("input", { type: "search", class: "text-input", placeholder: "Search people by name or @username", autocomplete: "off" });
  const chosen = h("div", { class: "tag-chips" });
  const results = h("div", { class: "conn-list tag-results" });
  const done = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Done" });
  const paintChosen = () => {
    chosen.replaceChildren(...picked.map((u) => {
      const x = h("button", { type: "button", class: "tag-x", text: "×", "aria-label": `Remove ${u.name}` });
      x.addEventListener("click", () => { picked = picked.filter((p) => p.username !== u.username); paintChosen(); find(); });
      return h("span", { class: "tag-chip" }, avatar(u, 20), h("span", { text: u.name }), x);
    }));
    chosen.hidden = !picked.length;
  };
  let timer;
  async function find() {
    const q = search.value.trim();
    try {
      const { users } = q ? await api(`/api/users/lookup?q=${encodeURIComponent(q)}`) : await api("/api/me/invitable");
      results.replaceChildren(...users.filter((u) => u.username !== state.me.username).slice(0, 12).map((u) => {
        const on = picked.some((p) => p.username === u.username);
        const b = h("button", { type: "button", class: "btn btn-xs " + (on ? "btn-following" : "btn-follow"), text: on ? "Tagged ✓" : "Tag" });
        b.addEventListener("click", () => {
          if (on) picked = picked.filter((p) => p.username !== u.username);
          else if (picked.length >= 20) return toast("You can tag up to 20 people.");
          else picked.push({ name: u.name, username: u.username, avatar: u.avatar });
          paintChosen(); find();
        });
        return h("div", { class: "conn-row" }, avatar(u, 38), h("div", { class: "who" }, h("b", {}, u.name, tick(u, 13)), h("span", { class: "muted", text: "@" + u.username })), b);
      }));
      if (!results.children.length) results.append(h("p", { class: "muted", text: "No one found." }));
    } catch {}
  }
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(find, 180); });
  const m = modal({ title, body: h("div", { class: "create-form" }, search, chosen, results, done) });
  done.addEventListener("click", () => { m.close(); onDone(picked); });
  paintChosen();
  find();
  setTimeout(() => search.focus(), 50);
}

// On a post: "with Mila, Desi and 2 others"
export function taggedLine(p, onChange) {
  const tagged = p.tagged || [];
  const meTagged = tagged.some((u) => u.username === state.me.username);
  if (!tagged.length) return null;
  const line = h("p", { class: "post-tags" });
  if (tagged.length) {
    const shown = tagged.slice(0, 3);
    line.append(h("span", { class: "pt-ic", text: "👥" }), "with ");
    shown.forEach((u, i) => {
      line.append(h("a", { href: profileHref(u.username), class: "pt-name", text: u.name }));
      if (i < shown.length - 1) line.append(i === shown.length - 2 && tagged.length <= 3 ? " and " : ", ");
    });
    if (tagged.length > 3) {
      const more = h("button", { type: "button", class: "pt-more", text: ` and ${tagged.length - 3} more` });
      more.addEventListener("click", () => modal({ title: "Tagged", body: h("div", { class: "conn-list" }, ...tagged.map((u) => h("a", { class: "conn-row", href: profileHref(u.username) }, avatar(u, 38), h("div", { class: "who" }, h("b", { text: u.name }), h("span", { class: "muted", text: "@" + u.username }))))) }));
      line.append(more);
    }
  }
  if (meTagged) {
    const rm = h("button", { type: "button", class: "pt-edit", text: "Remove me" });
    rm.addEventListener("click", async () => {
      try { const { post } = await api(`/api/posts/${p.id}/tags/me`, { method: "DELETE" }); p.tagged = post.tagged; onChange?.(); toast("You’re no longer tagged."); }
      catch (err) { toast(err.error || "Couldn’t do that."); }
    });
    line.append(rm);
  }
  return line;
}

// The "with …" line, kept up to date when the post is edited (an @ added or removed)
export function taggedSlot(p, extraClass = "") {
  const slot = h("div", { class: "pt-slot " + extraClass });
  const paint = () => slot.replaceChildren(taggedLine(p, paint) || "");
  paint();
  const off = on("post:edited", async (ev) => {
    if (!slot.isConnected) return off();
    if (ev.id !== p.id) return;
    try { p.tagged = (await api(`/api/posts/${p.id}`)).post.tagged; paint(); } catch {}
  });
  return slot;
}
