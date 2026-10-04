// /admin — the LookBlog team's page: reports, verification requests, support messages, bug reports and accounts.
import { h, avatar, tick, empty, spinner, toast, timeEl, confirmClick, modal } from "../ui.js";
import { api, upload } from "../api.js";
import { state, on } from "../state.js";
import { profileHref, postHref } from "../router.js";
import { VERIFY_TYPES } from "../verify-types.js";
import { specialStyle } from "../components/badges.js";

const TABS = [
  ["overview", "📊 Overview"],
  ["reports", "🚩 Reports", "reports"],
  ["verifications", "✅ Verification", "verifications"],
  ["support", "💬 Support", "support"],
  ["bugs", "🐞 Bugs", "bugs"],
  ["deleted", "👋 Deleted accounts"],
  ["users", "👥 Accounts"],
];
const TYPE_LABEL = { post: "📝 Post", user: "👤 Account", live: "🔴 Live", chat: "💬 Live chat" };
const POST_WORD = { post: "post", video: "video", short: "short" };
const typeName = (id) => VERIFY_TYPES.find((t) => t[0] === id)?.[1] || id;
const postLink = (id, type) => (type === "video" ? `/watch/${encodeURIComponent(id)}` : type === "short" ? `/shorts?id=${encodeURIComponent(id)}` : postHref(id));

function who(user, size = 36) {
  if (!user || user.gone) return h("span", { class: "adm-who muted" }, avatar({ name: "?", username: "" }, size), h("span", { text: "Deleted account" }));
  return h("a", { class: "adm-who", href: profileHref(user.username) }, avatar(user, size),
    h("span", { class: "adm-who-text" }, h("b", {}, user.name, tick(user, 14)), h("small", { class: "muted", text: "@" + user.username + (user.banned ? " · suspended" : "") })));
}
const chip = (text, cls = "") => h("span", { class: ("adm-chip " + cls).trim(), text });
const noteInput = (placeholder) => h("input", { class: "adm-input", type: "text", maxlength: 500, placeholder });
function segmented(options, value, onPick) {
  const wrap = h("div", { class: "adm-seg" });
  const paint = () => wrap.replaceChildren(...options.map(([k, l]) => h("button", { type: "button", class: k === value ? "on" : "", text: l, onclick: () => { value = k; paint(); onPick(k); } })));
  paint();
  return wrap;
}
function typeSelect(selected) {
  return h("select", { class: "adm-input adm-select" }, ...VERIFY_TYPES.map(([id, label, emoji]) => h("option", { value: id, text: `${emoji} ${label}`, selected: id === selected })));
}

export function adminPage(view, _m, params) {
  document.title = "Admin / LookBlog";
  view.classList.add("page-admin");
  if (!state.me?.admin) {
    view.append(empty("This page is for the LookBlog team.", "You don’t have access to it."));
    return;
  }
  // The admin panel (its own accounts) also has the Team tab
  const ALL = state.me.panel ? [...TABS, ["team", "🛡️ Team"]] : TABS;
  let tab = ALL.some(([k]) => k === params.get("tab")) ? params.get("tab") : "overview";
  let counts = {};
  const tabs = h("nav", { class: "adm-tabs" });
  const body = h("div", { class: "adm-body" });
  view.append(h("header", { class: "column-head" }, h("div", { class: "head-row" }, h("div", { class: "head-text" },
    h("h1", { text: "🛡️ Admin" }), h("p", { class: "page-sub", text: "Reports, verification requests, messages to the team and accounts." }))), tabs), body);

  const paintTabs = () => tabs.replaceChildren(...ALL.map(([k, label, c]) => h("button", { type: "button", class: "adm-tab" + (k === tab ? " on" : ""), onclick: () => go(k) },
    label, c && counts[c] ? h("span", { class: "adm-count", text: String(counts[c]) }) : null)));
  const setCounts = (c) => { if (!c) return; counts = c; paintTabs(); };
  function go(k) { tab = k; history.replaceState(null, "", k === "overview" ? location.pathname : `${location.pathname}?tab=${k}`); paintTabs(); load(); }

  let sub = {}; // the chosen filter on each tab
  async function load() {
    body.replaceChildren(spinner());
    try {
      if (tab === "overview") return overview();
      if (tab === "reports") return reports();
      if (tab === "verifications") return verifications();
      if (tab === "support") return tickets("support");
      if (tab === "bugs") return tickets("bug");
      if (tab === "deleted") return tickets("deletion");
      if (tab === "users") return users();
      if (tab === "team") return team();
    } catch (err) {
      body.replaceChildren(empty("Couldn’t load this.", err.error || "Try again."));
    }
  }

  /* ---------- Overview ---------- */
  async function overview() {
    const d = await api("/api/admin");
    setCounts(d.counts);
    const waiting = [["reports", "🚩", "Open reports"], ["verifications", "✅", "Verification requests"], ["support", "💬", "Support messages"], ["bugs", "🐞", "Bug reports"]];
    const t = d.totals;
    const max = Math.max(1, ...d.signups.map((s) => s.count));
    body.replaceChildren(
      h("h2", { class: "adm-h2", text: "Waiting for you" }),
      h("div", { class: "adm-cards" }, ...waiting.map(([k, e, l]) => h("button", { type: "button", class: "adm-card" + (d.counts[k] ? " hot" : ""), onclick: () => go(k) },
        h("span", { class: "adm-card-emoji", text: e }), h("b", { text: String(d.counts[k]) }), h("span", { text: l })))),
      h("h2", { class: "adm-h2", text: "LookBlog" }),
      h("div", { class: "adm-stats" }, ...[["Accounts", t.users], ["Posts", t.posts], ["Videos", t.videos], ["Shorts", t.shorts], ["Groups", t.groups], ["Songs", t.songs],
        ["Live now", t.liveNow], ["Verified", t.verified], ["Suspended", t.banned], ["Admins", t.admins]].map(([l, n]) => h("div", { class: "adm-stat" }, h("b", { text: n.toLocaleString("en-US") }), h("span", { text: l })))),
      h("h2", { class: "adm-h2", text: "New accounts, last 14 days" }),
      h("div", { class: "adm-chart" }, ...d.signups.map((s) => h("div", { class: "adm-bar", title: `${s.day}: ${s.count}` },
        h("span", { class: "adm-bar-n", text: s.count ? String(s.count) : "" }), h("i", { style: `height:${Math.round((s.count / max) * 100)}%` }), h("small", { text: s.day.slice(8) })))),
      h("h2", { class: "adm-h2", text: "Newest accounts" }),
      h("div", { class: "adm-list" }, ...(d.newest.length ? d.newest.map((u) => h("div", { class: "adm-row" }, who(u), h("span", { class: "muted" }, timeEl(u.createdAt)))) : [empty("No accounts yet.")]))
    );
  }

  /* ---------- Reports ---------- */
  async function reports() {
    const status = sub.reports || "open";
    const d = await api(`/api/admin/reports?status=${status}`);
    setCounts(d.counts);
    const list = h("div", { class: "adm-list" });
    body.replaceChildren(segmented([["open", "Open"], ["closed", "Closed"]], status, (k) => { sub.reports = k; load(); }), list);
    if (!d.cases.length) return list.append(empty(status === "open" ? "No open reports. 🎉" : "No closed reports yet."));
    list.append(...d.cases.map(caseCard));
  }
  function caseCard(c) {
    const t = c.target;
    let preview;
    if (t.type === "post") {
      preview = h("div", { class: "adm-target" },
        t.thumb ? h("img", { class: "adm-thumb", src: t.thumb, alt: "" }) : null,
        h("div", { class: "adm-target-text" },
          t.title ? h("b", { text: t.title }) : null,
          t.text ? h("p", { class: "adm-quote", text: t.text }) : null,
          !t.title && !t.text ? h("p", { class: "muted", text: t.mediaCount ? `${t.mediaCount} ${t.mediaKind || "file"}${t.mediaCount === 1 ? "" : "s"}` : "No text" }) : null,
          h("div", { class: "adm-meta" }, who(t.author, 28), t.exists ? h("a", { class: "btn btn-xs btn-outline-light", href: postLink(t.postId, t.postType), text: `Open ${POST_WORD[t.postType] || "post"} ↗` }) : chip("Already deleted"))));
    } else if (t.type === "user") {
      preview = h("div", { class: "adm-target" }, h("div", { class: "adm-target-text" }, who(t.user, 44),
        h("p", { class: "muted", text: `${t.followers} followers · ${t.posts} posts` })));
    } else if (t.type === "live") {
      preview = h("div", { class: "adm-target" },
        t.thumb ? h("img", { class: "adm-thumb", src: t.thumb, alt: "" }) : null,
        h("div", { class: "adm-target-text" }, h("b", { text: t.title || "Live stream" }), t.live ? chip("🔴 Live now", "red") : null,
          h("div", { class: "adm-meta" }, who(t.author, 28), t.exists ? h("a", { class: "btn btn-xs btn-outline-light", href: t.live || !t.postId ? `/live/${encodeURIComponent(t.streamId)}` : `/watch/${encodeURIComponent(t.postId)}`, text: "Open ↗" }) : chip("Already deleted"))));
    } else {
      preview = h("div", { class: "adm-target" }, h("div", { class: "adm-target-text" },
        h("p", { class: "adm-quote", text: t.text || "(no text)" }),
        h("div", { class: "adm-meta" }, who(t.author, 28), h("span", { class: "muted", text: `in “${t.streamTitle || "a live"}” by @${t.host.username}` }), t.exists ? null : chip("Already deleted"))));
    }
    const reasons = {};
    for (const r of c.reports) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    const details = h("details", { class: "adm-details" }, h("summary", { text: `${c.count} report${c.count === 1 ? "" : "s"} · who reported it` }),
      ...c.reports.map((r) => h("div", { class: "adm-report" }, who(r.reporter, 28),
        h("div", {}, h("span", {}, chip(r.reason), " ", h("span", { class: "muted" }, timeEl(r.createdAt))),
          r.details ? h("p", { text: r.details }) : null,
          r.message ? h("p", { class: "adm-quote", text: "Message: " + (r.message.text || (r.message.media ? "(photo or file)" : "")) }) : null))));
    const card = h("article", { class: "adm-case" + (c.status === "open" ? "" : " closed") },
      h("header", { class: "adm-case-head" }, chip(TYPE_LABEL[t.type]), ...Object.entries(reasons).map(([r, n]) => chip(n > 1 ? `${r} ×${n}` : r, "pink")), h("span", { class: "muted adm-grow" }, timeEl(c.latest))),
      preview, details);
    if (c.status === "open") {
      const note = noteInput("Note (optional): sent to the author if you remove it");
      const dismiss = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Dismiss" });
      const remove = t.type !== "user" && t.exists ? h("button", { type: "button", class: "btn btn-sm btn-danger", text: { post: `Remove ${POST_WORD[t.postType] || "post"}`, live: t.live ? "End & remove live" : "Remove live", chat: "Delete message" }[t.type] }) : null;
      const banTarget = t.type === "user" ? t.user : t.author;
      const banBtn = banTarget && !banTarget.gone && !banTarget.banned ? h("button", { type: "button", class: "btn btn-sm btn-danger-outline", text: t.type === "user" ? "Suspend account" : "Suspend author" }) : null;
      const act = async (action) => {
        try {
          const r = await api("/api/admin/reports", { method: "POST", body: { key: c.key, action, note: note.value } });
          setCounts(r.counts);
          toast(action === "dismiss" ? "Dismissed. The reporters were told." : action === "remove" ? "Removed. The author and the reporters were told." : "Account suspended.");
          card.remove();
          if (!body.querySelector(".adm-case")) load();
        } catch (err) { toast(err.error || "Couldn’t do that."); }
      };
      dismiss.addEventListener("click", () => act("dismiss"));
      if (remove) confirmClick(remove, "Sure?", () => act("remove"));
      if (banBtn) confirmClick(banBtn, "Sure?", () => act("ban"));
      card.append(h("footer", { class: "adm-actions" }, note, h("div", { class: "adm-btns" }, dismiss, remove, banBtn)));
    } else {
      card.append(h("footer", { class: "adm-resolved" },
        chip({ dismissed: "Dismissed", removed: "Removed", banned: "Author suspended" }[c.resolution] || c.resolution, c.resolution === "dismissed" ? "" : "red"),
        c.resolvedBy ? h("span", { class: "muted", text: `by @${c.resolvedBy.username}` }) : null, h("span", { class: "muted" }, timeEl(c.resolvedAt)),
        c.note ? h("p", { class: "adm-note", text: c.note }) : null));
    }
    return card;
  }

  /* ---------- Verification ---------- */
  async function verifications() {
    const status = sub.verifications || "pending";
    const d = await api(`/api/admin/verifications?status=${status}`);
    setCounts(d.counts);
    const list = h("div", { class: "adm-list" });
    body.replaceChildren(segmented([["pending", "Waiting"], ["approved", "Approved"], ["rejected", "Rejected"]], status, (k) => { sub.verifications = k; load(); }), list);
    if (!d.requests.length) return list.append(empty(status === "pending" ? "No requests waiting. 🎉" : "Nothing here yet."));
    list.append(...d.requests.map((r) => {
      const card = h("article", { class: "adm-case" + (r.status === "pending" ? "" : " closed") },
        h("header", { class: "adm-case-head" }, who(r.user, 44), h("span", { class: "muted adm-grow" }, "applied ", timeEl(r.createdAt))),
        h("div", { class: "adm-facts" },
          h("span", {}, h("small", { class: "muted", text: "Full name" }), h("b", { text: r.fullName })),
          h("span", {}, h("small", { class: "muted", text: "Category" }), h("b", { text: typeName(r.category) })),
          h("span", {}, h("small", { class: "muted", text: "Followers" }), h("b", { text: r.followers.toLocaleString("en-US") })),
          h("span", {}, h("small", { class: "muted", text: "Posts" }), h("b", { text: String(r.posts) })),
          r.joined ? h("span", {}, h("small", { class: "muted", text: "Joined" }), h("b", {}, timeEl(r.joined))) : null),
        h("p", { class: "adm-about", text: r.about }),
        r.links.length ? h("div", { class: "adm-links" }, ...r.links.map((l) => h("a", { href: l, target: "_blank", rel: "noopener noreferrer nofollow", text: l }))) : null);
      if (r.status === "pending") {
        const type = typeSelect(r.category);
        const note = noteInput("Note to them (optional)");
        const yes = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "Approve" });
        const no = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Reject" });
        const act = async (action) => {
          try {
            const res = await api(`/api/admin/verifications/${r.id}`, { method: "POST", body: { action, type: type.value, note: note.value } });
            setCounts(res.counts);
            toast(action === "approve" ? `@${r.user.username} is verified ✓` : "Rejected. They were told.");
            card.remove();
            if (!body.querySelector(".adm-case")) load();
          } catch (err) { toast(err.error || "Couldn’t do that."); }
        };
        yes.addEventListener("click", () => act("approve"));
        confirmClick(no, "Sure?", () => act("reject"));
        card.append(h("footer", { class: "adm-actions" }, h("label", { class: "adm-label" }, h("span", { class: "muted", text: "Tick" }), type), note, h("div", { class: "adm-btns" }, no, yes)));
      } else {
        card.append(h("footer", { class: "adm-resolved" }, chip(r.status === "approved" ? "Approved" : "Rejected", r.status === "approved" ? "green" : "red"),
          r.decidedBy ? h("span", { class: "muted", text: `by @${r.decidedBy.username}` }) : null, r.decidedAt ? h("span", { class: "muted" }, timeEl(r.decidedAt)) : null,
          r.note ? h("p", { class: "adm-note", text: r.note }) : null));
      }
      return card;
    }));
  }

  /* ---------- Support, bugs and deleted accounts ---------- */
  async function tickets(kind) {
    const status = kind === "deletion" ? "open" : sub[kind] || "open";
    const d = await api(`/api/admin/support?kind=${kind}&status=${status}`);
    setCounts(d.counts);
    const list = h("div", { class: "adm-list" });
    body.replaceChildren(kind === "deletion" ? h("p", { class: "muted", text: "Why people deleted their accounts. Nothing else about them is kept." })
      : segmented([["open", "Open"], ["closed", "Answered & closed"]], status, (k) => { sub[kind] = k; load(); }), list);
    if (!d.tickets.length) return list.append(empty(kind === "deletion" ? "Nobody has left. 🎉" : status === "open" ? "Nothing waiting. 🎉" : "Nothing here yet."));
    list.append(...d.tickets.map((t) => ticketCard(t, kind)));
  }
  function ticketCard(t, kind) {
    if (kind === "deletion") {
      return h("article", { class: "adm-case closed" }, h("header", { class: "adm-case-head" }, chip(t.reason || "other", "pink"),
        t.accountAgeDays != null ? h("span", { class: "muted", text: `account was ${t.accountAgeDays} day${t.accountAgeDays === 1 ? "" : "s"} old` }) : null,
        h("span", { class: "muted adm-grow" }, timeEl(t.createdAt))), t.details ? h("p", { class: "adm-about", text: t.details }) : null);
    }
    const info = [t.page && `Page: ${t.page}`, t.screen && `Screen: ${t.screen}`, t.lang && `Language: ${t.lang}`, t.email && `Email: ${t.email}`].filter(Boolean).join(" · ");
    const card = h("article", { class: "adm-case" + (t.status === "open" ? "" : " closed") },
      h("header", { class: "adm-case-head" }, t.user ? who(t.user, 36) : h("b", { text: "@" + (t.username || "unknown") }),
        chip(kind === "bug" ? "🐞 " + (t.area || "other") : t.topic || "other", "pink"), h("span", { class: "muted adm-grow" }, "#" + t.id + " · ", timeEl(t.createdAt))),
      h("p", { class: "adm-about", text: t.message }),
      t.steps ? h("div", {}, h("small", { class: "muted", text: "Steps" }), h("p", { class: "adm-about", text: t.steps })) : null,
      t.expected ? h("div", {}, h("small", { class: "muted", text: "Expected" }), h("p", { class: "adm-about", text: t.expected })) : null,
      t.screenshot ? h("a", { href: t.screenshot, target: "_blank", rel: "noopener" }, h("img", { class: "adm-shot", src: t.screenshot, alt: "Screenshot" })) : null,
      info ? h("p", { class: "muted adm-small", text: info }) : null,
      t.userAgent ? h("p", { class: "muted adm-small", text: t.userAgent }) : null,
      t.reply ? h("div", { class: "adm-reply" }, h("small", { class: "muted", text: "Your reply" }), h("p", { text: t.reply })) : null);
    const text = h("textarea", { class: "adm-input", rows: 3, maxlength: 3000, placeholder: t.user ? "Write a reply. They get it as a notification from the LookBlog Team." : "This account was deleted, so a reply can’t reach them." });
    const send = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "Send reply", disabled: !t.user });
    const toggle = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: t.status === "open" ? (kind === "bug" ? "Mark fixed" : "Close") : "Reopen" });
    const save = async (bodyData, done) => {
      try {
        const r = await api(`/api/admin/support/${t.id}`, { method: "POST", body: bodyData });
        setCounts(r.counts);
        toast(done);
        card.remove();
        if (!body.querySelector(".adm-case")) load();
      } catch (err) { toast(err.error || "Couldn’t do that."); }
    };
    send.addEventListener("click", () => { if (!text.value.trim()) return text.focus(); save({ reply: text.value }, "Reply sent ✓"); });
    toggle.addEventListener("click", () => save({ status: t.status === "open" ? "closed" : "open" }, t.status === "open" ? "Closed" : "Reopened"));
    card.append(h("footer", { class: "adm-actions" }, t.user ? text : null, h("div", { class: "adm-btns" }, toggle, t.user ? send : null)));
    return card;
  }

  /* ---------- Accounts ---------- */
  async function users() {
    const filter = sub.users || "all";
    const search = h("input", { class: "adm-input", type: "search", placeholder: "Search by name, @username or email", value: sub.q || "" });
    const list = h("div", { class: "adm-list" });
    const total = h("p", { class: "muted adm-small" });
    body.replaceChildren(h("div", { class: "adm-toolbar" }, search, segmented([["all", "All"], ["verified", "Verified"], ["banned", "Suspended"], ["admins", "Admins"]], filter, (k) => { sub.users = k; load(); })), total, list);
    let timer;
    const fetchList = async () => {
      list.replaceChildren(spinner());
      try {
        const d = await api(`/api/admin/users?filter=${filter}&q=${encodeURIComponent(search.value.trim())}`);
        total.textContent = `${d.total.toLocaleString("en-US")} account${d.total === 1 ? "" : "s"}${d.total > d.users.length ? `, showing the newest ${d.users.length}` : ""}`;
        list.replaceChildren(...(d.users.length ? d.users.map(userCard) : [empty("No accounts found.")]));
      } catch (err) { list.replaceChildren(empty("Couldn’t load accounts.", err.error || "")); }
    };
    search.addEventListener("input", () => { sub.q = search.value; clearTimeout(timer); timer = setTimeout(fetchList, 250); });
    fetchList();
    setTimeout(() => search.focus(), 50);
  }
  function userCard(u) {
    const card = h("article", { class: "adm-user" });
    const paint = (u) => {
      const isMe = u.id === state.me.id;
      const act = async (action, extra = {}) => {
        try {
          const r = await api(`/api/admin/users/${u.id}`, { method: "POST", body: { action, ...extra } });
          if (r.deleted) { toast(`@${u.username} was deleted.`); card.remove(); return; }
          toast("Done ✓");
          paint(r.user);
        } catch (err) { toast(err.error || "Couldn’t do that."); }
      };
      const btns = [];
      if (u.verified) { const b = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Remove tick" }); confirmClick(b, "Sure?", () => act("unverify")); btns.push(b); }
      else btns.push(h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Verify", onclick: () => verifyModal(u, (type) => act("verify", { type })) }));
      btns.push(h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "⭐ Special badge", onclick: () => specialModal(u, (name, emoji, image, color) => act("special-badge", { name, emoji, image, color })) }));
      if (!u.owner && !isMe) {
        if (u.banned) btns.push(h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Unsuspend", onclick: () => act("unban") }));
        else btns.push(h("button", { type: "button", class: "btn btn-xs btn-danger-outline", text: "Suspend", onclick: () => banModal(u, (reason) => act("ban", { reason })) }));
        if (state.me.owner) {
          if (u.admin) { const b = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Remove admin" }); confirmClick(b, "Sure?", () => act("remove-admin")); btns.push(b); }
          else { const b = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Make admin" }); confirmClick(b, "Sure?", () => act("make-admin")); btns.push(b); }
        }
        btns.push(h("button", { type: "button", class: "btn btn-xs btn-danger", text: "Delete", onclick: () => deleteModal(u, (confirm) => act("delete", { confirm })) }));
      }
      card.replaceChildren(
        h("div", { class: "adm-user-main" }, who(u, 44),
          h("div", { class: "adm-user-chips" }, u.owner ? chip("👑 Owner", "pink") : u.admin ? chip("🛡️ Admin", "pink") : null, u.banned ? chip("Suspended", "red") : null, isMe ? chip("You") : null)),
        h("p", { class: "muted adm-small" }, [u.email, `${u.followers} followers`, `${u.posts} posts`, u.reportsAgainst ? `🚩 ${u.reportsAgainst} reports` : null].filter(Boolean).join(" · "), " · joined ", timeEl(u.createdAt)),
        u.bannedInfo?.reason ? h("p", { class: "adm-note", text: "Suspended: " + u.bannedInfo.reason }) : null,
        u.special?.length ? h("div", { class: "adm-user-chips" }, ...u.special.map((b) => {
          const x = h("button", { type: "button", class: "special-chip small", style: specialStyle(b), title: "Remove this special badge" }, b.image ? h("img", { class: "sc-mini", src: b.image, alt: "" }) : `${b.emoji} `, `${b.name} ✕`);
          confirmClick(x, "Remove?", () => act("remove-special", { badgeId: b.id }));
          return x;
        })) : null,
        h("div", { class: "adm-btns" }, ...btns));
    };
    paint(u);
    return card;
  }
  function verifyModal(u, done) {
    const type = typeSelect("creator");
    const ok = h("button", { type: "button", class: "btn btn-primary", text: "Verify" });
    const m = modal({ title: `Verify @${u.username}`, body: h("div", { class: "adm-modal" }, h("p", { class: "muted", text: "Which tick should they get?" }), type, ok) });
    ok.addEventListener("click", () => { m.close(); done(type.value); });
  }
  function specialModal(u, done) {
    const emoji = h("input", { class: "adm-input", type: "text", maxlength: 8, placeholder: "💎", style: "width:80px" });
    const name = h("input", { class: "adm-input", type: "text", maxlength: 24, placeholder: "Badge name, e.g. Ivancho" });
    const ok = h("button", { type: "button", class: "btn btn-primary", text: "Give badge" });
    // Its colour
    const COLORS = ["#ff4fa3", "#a66bff", "#4f8bff", "#36c9ff", "#2fd38a", "#ffd23f", "#ff8a3d", "#ff4545", "#ffffff", "#1c1c1c"];
    let color = null;
    const custom = h("input", { type: "color", class: "sb-custom", value: "#ff4fa3", title: "Any colour" });
    const swatches = h("div", { class: "sb-swatches" });
    const preview = h("span", { class: "special-chip" }, h("span", { class: "sc-emoji", text: "💎" }), "Preview");
    const paintColors = () => {
      swatches.replaceChildren(h("button", { type: "button", class: "sb-swatch auto" + (!color ? " on" : ""), title: "Pink and gold (default)", onclick: () => { color = null; paintColors(); } }),
        ...COLORS.map((c) => h("button", { type: "button", class: "sb-swatch" + (color === c ? " on" : ""), style: `background:${c}`, title: c, onclick: () => { color = c; paintColors(); } })), custom);
      preview.setAttribute("style", specialStyle({ color }));
      preview.querySelector(".sc-emoji").textContent = emoji.value.trim() || "💎";
      preview.lastChild.textContent = name.value.trim() || "Preview";
    };
    custom.addEventListener("input", () => { color = custom.value; paintColors(); });
    emoji.addEventListener("input", paintColors);
    name.addEventListener("input", paintColors);
    // Or a picture instead of the emoji
    let image = null;
    const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true });
    const pic = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "🖼️ Use a picture" });
    pic.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files[0]; file.value = "";
      if (!f) return;
      pic.disabled = true; pic.textContent = "Uploading…";
      try { image = (await upload(f)).url; pic.replaceChildren(h("img", { class: "sc-mini", src: image, alt: "" }), " Picture added"); }
      catch (err) { toast(err.error || "Couldn’t upload it."); pic.textContent = "🖼️ Use a picture"; }
      pic.disabled = false;
    });
    const m = modal({ title: `Special badge for @${u.username}`, body: h("div", { class: "adm-modal" },
      h("p", { class: "muted", text: "A one-of-a-kind badge: nobody else can get one with the same name. It shows on their profile and they get a notification." }),
      h("div", { class: "adm-toolbar" }, emoji, name), h("div", {}, pic, file),
      h("b", { class: "vis-label", text: "Colour" }), swatches, h("div", { class: "sb-preview" }, preview), ok) });
    paintColors();
    ok.addEventListener("click", () => { if (!name.value.trim()) return name.focus(); m.close(); done(name.value, emoji.value, image, color); });
    setTimeout(() => name.focus(), 50);
  }
  function banModal(u, done) {
    const reason = h("input", { class: "adm-input", type: "text", maxlength: 200, placeholder: "Reason (they see it when they try to log in)" });
    const ok = h("button", { type: "button", class: "btn btn-danger", text: "Suspend" });
    const m = modal({ title: `Suspend @${u.username}`, body: h("div", { class: "adm-modal" }, h("p", { class: "muted", text: "They’re logged out everywhere and can’t log in until you unsuspend them. Their posts stay up." }), reason, ok) });
    ok.addEventListener("click", () => { m.close(); done(reason.value); });
    setTimeout(() => reason.focus(), 50);
  }
  function deleteModal(u, done) {
    const input = h("input", { class: "adm-input", type: "text", placeholder: u.username, autocomplete: "off" });
    const ok = h("button", { type: "button", class: "btn btn-danger", text: "Delete forever", disabled: true });
    input.addEventListener("input", () => { ok.disabled = input.value.trim().toLowerCase() !== u.username.toLowerCase(); });
    const m = modal({ title: `Delete @${u.username}`, body: h("div", { class: "adm-modal" },
      h("p", { text: "This deletes the account with all its posts, videos, messages and files. It can’t be undone." }),
      h("p", { class: "muted", text: `Type ${u.username} to confirm.` }), input, ok) });
    ok.addEventListener("click", () => { m.close(); done(input.value.trim()); });
    setTimeout(() => input.focus(), 50);
  }

  /* ---------- Team (admin panel accounts) ---------- */
  async function team() {
    const d = await api("/api/panel/admins");
    const list = h("div", { class: "adm-list" }, ...d.admins.map((a) => {
      const row = h("div", { class: "adm-row" },
        h("span", { class: "adm-who" }, h("span", { class: "panel-shield", text: a.role === "owner" ? "👑" : "🛡️" }), h("span", { class: "adm-who-text" }, h("b", { text: a.name }), h("small", { class: "muted", text: `@${a.username} · ${a.role}` }))),
        a.id === d.me.id ? chip("You") : null);
      if (d.me.role === "owner" && a.id !== d.me.id) {
        const rm = h("button", { type: "button", class: "btn btn-xs btn-danger-outline", text: "Remove" });
        confirmClick(rm, "Sure?", async () => { try { await api(`/api/panel/admins/${a.id}`, { method: "DELETE" }); toast("Removed."); team(); } catch (err) { toast(err.error || "Couldn’t remove."); } });
        row.append(rm);
      }
      return row;
    }));
    const parts = [h("h2", { class: "adm-h2", text: "Admins" }), h("p", { class: "muted", text: "Accounts that can open this panel. They’re separate from LookBlog accounts." }), list];
    if (d.me.role === "owner") {
      const u = h("input", { class: "adm-input", placeholder: "Username", maxlength: 20 });
      const n = h("input", { class: "adm-input", placeholder: "Name", maxlength: 50 });
      const p = h("input", { class: "adm-input", type: "password", placeholder: "Password (10+ characters)", autocomplete: "new-password" });
      const add = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "Add admin" });
      add.addEventListener("click", async () => { try { await api("/api/panel/admins", { method: "POST", body: { username: u.value, name: n.value, password: p.value } }); toast("Admin added. Give them the username and password."); team(); } catch (err) { toast(err.error || "Couldn’t add."); } });
      parts.push(h("h2", { class: "adm-h2", text: "Add an admin" }), h("div", { class: "adm-toolbar" }, u, n, p, add));
    }
    // My password
    const cur = h("input", { class: "adm-input", type: "password", placeholder: "Current password", autocomplete: "current-password" });
    const nw = h("input", { class: "adm-input", type: "password", placeholder: "New password (10+)", autocomplete: "new-password" });
    const chg = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Change my password" });
    chg.addEventListener("click", async () => { try { await api("/api/panel/password", { method: "POST", body: { password: cur.value, newPassword: nw.value } }); cur.value = nw.value = ""; toast("Password changed."); } catch (err) { toast(err.error || "Couldn’t change it."); } });
    parts.push(h("h2", { class: "adm-h2", text: "My password" }), h("div", { class: "adm-toolbar" }, cur, nw, chg));
    body.replaceChildren(...parts);
  }

  // New reports and messages arrive live
  const off = on("admin:update", (ev) => {
    setCounts(ev.counts);
    if (tab === "overview") load();
  });
  paintTabs();
  load();
  return () => off();
}
adminPage.navName = () => "admin";
adminPage.layout = "wide";
