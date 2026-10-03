// Privacy: a private account (people have to ask to follow), follow requests, and blocked accounts.
import { h, avatar, toast, modal, spinner, empty, tick } from "../ui.js";
import { api } from "../api.js";
import { state, emit } from "../state.js";

export function openPrivacy() {
  const toggle = h("input", { type: "checkbox", class: "switch-input", "aria-label": "Private account" });
  const requests = h("div", { class: "conn-list" }, spinner());
  const blocked = h("div", { class: "conn-list" }, spinner());
  const reqTitle = h("b", { class: "vis-label", text: "Follow requests" });

  const loadRequests = () => api("/api/me/requests").then(({ users, private: priv }) => {
    toggle.checked = priv;
    reqTitle.textContent = users.length ? `Follow requests · ${users.length}` : "Follow requests";
    requests.replaceChildren(...users.map((u) => {
      const yes = h("button", { type: "button", class: "btn btn-xs btn-primary", text: "Accept" });
      const no = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Decline" });
      const answer = async (accept) => {
        yes.disabled = no.disabled = true;
        try { await api(`/api/me/requests/${encodeURIComponent(u.username)}`, { method: "POST", body: { accept } }); toast(accept ? `@${u.username} now follows you.` : "Request declined."); loadRequests(); emit("requests:changed"); }
        catch (err) { toast(err.error || "Couldn’t do that."); yes.disabled = no.disabled = false; }
      };
      yes.addEventListener("click", () => answer(true));
      no.addEventListener("click", () => answer(false));
      return h("div", { class: "conn-row" }, h("a", { href: `/u/${encodeURIComponent(u.username)}` }, avatar(u, 42)),
        h("div", { class: "who" }, h("b", {}, u.name, tick(u, 14)), h("span", { class: "muted", text: "@" + u.username })), h("div", { class: "req-acts" }, no, yes));
    }));
    if (!users.length) requests.append(h("p", { class: "muted", text: priv ? "No one is waiting." : "When your account is private, people have to ask to follow you. Their requests show up here." }));
  }).catch((err) => requests.replaceChildren(empty("Couldn’t load requests.", err.error || "")));

  const loadBlocked = () => api("/api/me/blocked").then(({ users }) => {
    blocked.replaceChildren(...users.map((u) => {
      const un = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Unblock" });
      un.addEventListener("click", async () => {
        un.disabled = true;
        try { await api(`/api/users/${encodeURIComponent(u.username)}/block`, { method: "POST", body: { on: false } }); toast(`@${u.username} is unblocked.`); loadBlocked(); }
        catch (err) { toast(err.error || "Couldn’t unblock."); un.disabled = false; }
      });
      return h("div", { class: "conn-row" }, avatar(u, 42), h("div", { class: "who" }, h("b", {}, u.name), h("span", { class: "muted", text: "@" + u.username })), un);
    }));
    if (!users.length) blocked.append(h("p", { class: "muted", text: "You haven’t blocked anyone. Block someone from the ⋯ button on their profile." }));
  }).catch(() => {});

  toggle.addEventListener("change", async () => {
    try {
      const { private: priv } = await api("/api/me/privacy", { method: "POST", body: { private: toggle.checked } });
      state.me.private = priv;
      toast(priv ? "Your account is private. New followers have to ask first." : "Your account is public. Anyone can follow you.");
      loadRequests();
    } catch (err) { toggle.checked = !toggle.checked; toast(err.error || "Couldn’t change that."); }
  });

  modal({ title: "Privacy & blocking", body: h("div", { class: "create-form privacy" },
    h("label", { class: "switch-row" },
      h("span", { class: "switch-text" }, h("b", { text: "🔒 Private account" }), h("span", { class: "muted", text: "Only people you approve can see your posts, shorts, videos and who you follow. Your name, photo and bio stay visible." })),
      toggle, h("span", { class: "switch", "aria-hidden": "true" })),
    reqTitle, requests,
    h("b", { class: "vis-label", text: "Blocked accounts" }), blocked) });
  loadRequests();
  loadBlocked();
}
