// Help: short answers to common questions, with a search box.
import { h, modal, toast, timeEl } from "../ui.js";
import { api } from "../api.js";

const SUPPORT_TOPICS = [["bug", "Something isn’t working"], ["account", "My account"], ["safety", "Safety or someone bothering me"], ["messages", "Messages and calls"], ["groups", "Groups and events"], ["videos", "Videos and uploads"], ["other", "Something else"]];

// "Still need help?": write to the LookBlog team, and see what you sent before
function contactBox() {
  const topic = h("select", { class: "text-input" }, ...SUPPORT_TOPICS.map(([id, label]) => h("option", { value: id, text: label })));
  const msg = h("textarea", { class: "text-input", rows: 4, maxlength: 3000, placeholder: "Describe the problem. What did you do, what happened, what did you expect?" });
  const send = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Send to the LookBlog team" });
  const mine = h("div", { class: "help-tickets" });
  const loadMine = () => api("/api/support").then(({ tickets }) => {
    mine.replaceChildren(...(tickets.length ? [h("b", { class: "vis-label", text: "Your messages to the team" })] : []),
      ...tickets.map((t) => h("div", { class: "help-ticket" },
        h("div", { class: "ht-head" }, h("span", { class: "ht-status " + t.status, text: t.status === "open" ? "Waiting for an answer" : t.status === "answered" ? "Answered" : "Closed" }), h("span", { class: "muted" }, timeEl(t.createdAt))),
        h("p", { text: t.message }),
        t.reply ? h("p", { class: "ht-reply" }, h("b", { text: "LookBlog team: " }), t.reply) : null)));
  }).catch(() => {});
  send.addEventListener("click", async () => {
    if (msg.value.trim().length < 10) return toast("Tell us a bit more (at least 10 characters).");
    send.disabled = true;
    try {
      await api("/api/support", { method: "POST", body: { topic: topic.value, message: msg.value, page: location.pathname } });
      msg.value = "";
      toast("Thanks! The LookBlog team got your message.");
      loadMine();
    } catch (err) { toast(err.error || "Couldn’t send it."); }
    send.disabled = false;
  });
  loadMine();
  return h("section", { class: "help-contact" },
    h("h3", { text: "Still need help?" }),
    h("p", { class: "muted", text: "Write to the LookBlog team about anything that isn’t covered here. We read every message." }),
    topic, msg, send, mine);
}

const TOPICS = [
  ["Getting started", [
    ["What is LookBlog?", "A place to share posts, photos, shorts and videos, follow people, chat, call and hang out in groups."],
    ["How do I change my photo, banner or bio?", "Open your profile (top right menu → Your profile). Click your photo, the banner or the bio to change them."],
    ["How do I change my @username?", "On your profile, click your @username under your name and type a new one."],
    ["What do the badges mean?", "Badges show what you’ve done on LookBlog. Open “All badges” on a profile to see how to earn each one."],
  ]],
  ["Posting", [
    ["How do I post?", "Use the box at the top of your feed or profile. Add text, photos, a poll, or upload a short or a video."],
    ["Who can see my posts?", "Pick Public, Unlisted (only people with the link) or Private (only you) when you post. If your account is private, only your followers see your posts."],
    ["What is “Cool”?", "A special reaction. Posts with lots of Cools show up higher in the Cool feed."],
    ["How do I see how my posts are doing?", "Open Analytics from the top right menu: views, watch time, where people come from and more."],
  ]],
  ["Messages and calls", [
    ["Who can I message?", "People who follow you back. Groups are open to anyone who joins."],
    ["How do I call someone?", "Open a direct chat and press the phone (voice) or camera (video) button at the top."],
    ["Can I share my screen or play games?", "Yes. During a call use the screen and game buttons. You can also start chess, tic-tac-toe or connect four from the game button in any chat."],
    ["What are nicknames?", "In a direct chat, press Aa to give the other person a nickname. Only they can give you one."],
  ]],
  ["Groups", [
    ["How do groups work?", "Like small servers: text channels to chat, voice channels to talk, roles, events and a soundboard."],
    ["How do I invite people?", "Open the group and press “Invite people”. Send it to someone or copy a link."],
    ["How do roles work?", "The owner (and anyone allowed) can create roles with permissions under Roles, then give them to people in Members."],
    ["How do I use the soundboard?", "Join a voice channel and press the speaker button in the Voice connected panel. Everyone in the channel hears it."],
  ]],
  ["Events", [
    ["What are public events?", "Events anyone can find and join. Open Events from the bottom bar, create one with a cover and photo, and share it to your groups."],
    ["How do I join an event?", "Open it and press Join. You can write in the event’s discussion too."],
  ]],
  ["Privacy and safety", [
    ["How do I make my account private?", "Top right menu → Privacy & blocking → turn on Private account. People then have to ask to follow you."],
    ["How do I block someone?", "Open their profile, press ⋯ and choose Block. They can’t see your profile, follow you or message you."],
    ["How do I report someone?", "On their profile press ⋯ → Report. You can also report a message from its menu, or a post with the flag button."],
    ["Will they know I reported or blocked them?", "No. Reports are anonymous and blocked people aren’t told."],
  ]],
  ["Account", [
    ["How do I change the language?", "Top right menu → Language."],
    ["How do I get verified?", "Top right menu → Get verified. You need 1,000 followers and 10 posts to apply."],
    ["How do I log out?", "Top right menu → Log out."],
  ]],
];

export function openHelp() {
  const search = h("input", { type: "search", class: "text-input", placeholder: "Search help", "aria-label": "Search help" });
  const list = h("div", { class: "help-list" });
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    for (const [topic, items] of TOPICS) {
      const hits = items.filter(([qq, a]) => !q || (qq + " " + a + " " + topic).toLowerCase().includes(q));
      if (!hits.length) continue;
      list.append(h("h3", { class: "help-topic", text: topic }),
        ...hits.map(([qq, a]) => h("details", { class: "help-item", open: Boolean(q) }, h("summary", { text: qq }), h("p", { text: a }))));
    }
    if (!list.children.length) list.append(h("p", { class: "muted", text: "Nothing found. Try other words." }));
  };
  search.addEventListener("input", paint);
  paint();
  modal({ title: "Help", body: h("div", { class: "help" }, search, list, contactBox()) });
  setTimeout(() => search.focus(), 50);
}
