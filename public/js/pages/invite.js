// /invite/:code — someone invited you to a group. Shows the group and a Join button.
import { h, empty, spinner, toast, avatar, plural } from "../ui.js";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { emit } from "../state.js";
import { chatPic } from "../components/chat.js";

export function invitePage(view, m) {
  const code = decodeURIComponent(m[1]);
  document.title = "Invite / LookBlog";
  view.classList.add("page-invite");
  const box = h("section", { class: "invite-card" }, spinner());
  view.append(box);
  api(`/api/invites/${encodeURIComponent(code)}`).then(({ group: g, by }) => {
    document.title = `Join ${g.name} / LookBlog`;
    const join = h("button", { type: "button", class: "btn btn-primary btn-full", text: g.member ? "Open group" : "Join group" });
    join.addEventListener("click", async () => {
      join.disabled = true;
      try {
        const { chatId } = await api(`/api/invites/${encodeURIComponent(code)}/accept`, { method: "POST" });
        if (!g.member) toast(`You joined ${g.name}.`);
        emit("chats:changed");
        navigate(`/messages/${chatId}`);
      } catch (err) { toast(err.error || "Couldn’t join."); join.disabled = false; }
    });
    box.style.setProperty("--group", g.color || "#ff4fa3");
    box.replaceChildren(
      by ? h("p", { class: "invite-by" }, avatar(by, 28), h("span", {}, h("b", { text: by.name }), " invited you to join")) : h("p", { class: "invite-by", text: "You’re invited to join" }),
      chatPic(g, 96),
      h("h1", { text: g.name }),
      g.description ? h("p", { class: "invite-desc", text: g.description }) : null,
      h("p", { class: "invite-stats" }, h("span", { class: "presence-dot online" }), ` ${g.onlineCount} online`, h("span", { class: "dot-sep", text: " · " }), plural(g.memberCount, "member", "members")),
      join);
  }).catch((err) => box.replaceChildren(empty("This invite doesn’t work.", err.error || "It may have expired or been used up. Ask for a new one.")));
}
invitePage.navName = () => "";
