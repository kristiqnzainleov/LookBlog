// The LookBlog team's admin page (/admin): reports, verification requests, support messages,
// bug reports and accounts. Only admins can use it.
//   Owners: the usernames in ADMINS (comma-separated, default "ko6i"). They can also add and remove admins.
//   Admins: owners, and accounts an owner made admin (user.admin).

const { db, save, findUser } = require("./db");
const { sendJSON, httpError, readJSON } = require("./http");
const { sendTo } = require("./realtime");

const OWNERS = () => String(process.env.ADMINS || "ko6i").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const isOwner = (u) => Boolean(u) && OWNERS().includes(u.username.toLowerCase());
const isAdmin = (u) => Boolean(u) && (isOwner(u) || Boolean(u.admin));
const TEAM = { id: "team", blocked: [] };

const VERIFY_TYPES = ["creator", "musician", "singer", "dj", "band", "artist", "photographer", "filmmaker", "actor", "dancer", "comedian", "writer", "journalist", "gamer", "streamer", "athlete", "chef", "fashion", "designer", "developer", "business", "public-figure", "organization", "other"];

const now = () => new Date().toISOString();
const clip = (t, n) => String(t || "").trim().slice(0, n);
const followersOf = (id) => db.users.filter((u) => u.following.includes(id)).length;
const postsOf = (id) => db.posts.filter((p) => p.userId === id).length;
function person(u) {
  if (!u) return { name: "Deleted account", username: "", avatar: null, gone: true };
  return { id: u.id, name: u.name, username: u.username, avatar: u.avatar, verified: Boolean(u.verified), verifiedType: u.verified ? u.verifiedType || "creator" : null, banned: Boolean(u.banned) };
}
function teamNote(userId, text, link) {
  require("./notifications").notify(userId, "team", TEAM, { text, link });
}

/* ---------- What's waiting ---------- */
function counts() {
  const openReports = new Set(db.reports.filter((r) => r.status === "open").map(caseKey)).size;
  return {
    reports: openReports,
    verifications: db.verifyRequests.filter((r) => r.status === "pending").length,
    support: db.support.filter((t) => t.kind !== "bug" && t.kind !== "deletion" && t.status === "open").length,
    bugs: db.support.filter((t) => t.kind === "bug" && t.status === "open").length,
  };
}
// Tell every admin that something new came in (the admin page and the menu badge update live)
function pingAdmins() {
  const ids = db.users.filter(isAdmin).map((u) => u.id);
  if (ids.length) sendTo(ids, { type: "admin:update", counts: counts() });
}

/* ---------- Reports ----------
   Several people can report the same thing, so reports are grouped into cases by what they point at. */
function caseKey(r) {
  if (r.kind === "user") return "user:" + r.userId;
  if (r.streamId) return r.messageId ? `chat:${r.streamId}:${r.messageId}` : "live:" + r.streamId;
  return "post:" + r.postId;
}
function caseTarget(r) {
  if (r.kind === "user") {
    const u = findUser(r.userId);
    return { type: "user", user: person(u), userId: r.userId, followers: u ? followersOf(u.id) : 0, posts: u ? postsOf(u.id) : 0, exists: Boolean(u) };
  }
  if (r.streamId) {
    const st = db.streams.find((x) => x.id === r.streamId);
    const host = findUser(st?.userId || r.authorId);
    if (r.messageId) {
      const msg = st?.chat?.find((x) => x.id === r.messageId);
      return { type: "chat", streamId: r.streamId, streamTitle: st?.title || "", text: msg?.text ?? r.messageText ?? "", author: person(findUser(r.authorId)), host: person(host), exists: Boolean(msg) };
    }
    return { type: "live", streamId: r.streamId, title: st?.title || "", thumb: st?.thumb || null, live: Boolean(st?.live), postId: st?.postId || null, author: person(host), exists: Boolean(st) };
  }
  const post = db.posts.find((p) => p.id === r.postId);
  const m = post?.media?.[0];
  return {
    type: "post", postId: r.postId, postType: post?.type || "post", title: post?.title || "", text: clip(post?.text, 400),
    thumb: m ? (m.kind === "image" ? m.url : m.poster || null) : null, mediaKind: m?.kind || null, mediaCount: post?.media?.length || 0,
    author: person(findUser(post?.userId || r.authorId)), exists: Boolean(post),
  };
}
function listCases(status) {
  const groups = new Map();
  for (const r of db.reports) {
    const open = r.status === "open";
    if ((status === "open") !== open) continue;
    const key = caseKey(r) + (open ? "" : "|" + (r.resolvedAt || r.createdAt).slice(0, 16));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const cases = [...groups.values()].map((rs) => {
    rs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const r = rs[0];
    return {
      key: caseKey(r), target: caseTarget(r), status: r.status, count: rs.length,
      latest: r.createdAt, resolution: r.resolution || null, note: r.note || null, resolvedAt: r.resolvedAt || null,
      resolvedBy: r.resolvedBy ? person(findUser(r.resolvedBy)) : null,
      reports: rs.map((x) => ({ id: x.id, reason: x.reason, details: x.details || "", reporter: person(findUser(x.reporterId)), createdAt: x.createdAt, message: x.message || null, at: x.at ?? null })),
    };
  });
  // Open: the most reported first, then the newest. Closed: the newest first.
  cases.sort((a, b) => (status === "open" ? b.count - a.count : 0) || b.latest.localeCompare(a.latest));
  return cases.slice(0, 200);
}

function ban(user, reason, by) {
  if (!user) return;
  user.banned = { reason: clip(reason, 200) || null, at: now(), by: by.id };
  require("./auth").endSessionsFor(user.id);
  for (const st of db.streams) if (st.userId === user.id && st.live) require("./streams").endStream(st);
  save("users");
  sendTo([user.id], { type: "account:banned" });
}

function resolveCase(key, action, note, me) {
  const open = db.reports.filter((r) => r.status === "open" && caseKey(r) === key);
  if (!open.length) throw httpError(404, "This case is already closed.");
  const target = caseTarget(open[0]);
  const reason = open[0].reason;
  let authorId = null;
  if (action === "remove") {
    if (target.type === "post") {
      const post = db.posts.find((p) => p.id === target.postId);
      if (post) { authorId = post.userId; require("./social").removePost(post); }
    } else if (target.type === "live") {
      const st = db.streams.find((x) => x.id === target.streamId);
      if (st) {
        authorId = st.userId;
        if (st.live) require("./streams").endStream(st);
        const rec = st.postId && db.posts.find((p) => p.id === st.postId);
        if (rec) require("./social").removePost(rec);
        const i = db.streams.indexOf(st);
        if (i > -1) { db.streams.splice(i, 1); save("streams"); }
      }
    } else if (target.type === "chat") {
      const st = db.streams.find((x) => x.id === target.streamId);
      authorId = open[0].authorId;
      if (st) require("./streams").removeChatMessage(st, open[0].messageId);
    } else throw httpError(400, "An account can’t be removed this way. Suspend it instead.");
  } else if (action === "ban") {
    const id = target.type === "user" ? target.userId : open[0].authorId || (target.author && target.author.id);
    const user = findUser(id);
    if (!user) throw httpError(404, "This account doesn’t exist anymore.");
    if (isOwner(user)) throw httpError(403, "Owners can’t be suspended.");
    if (user.id === me.id) throw httpError(400, "You can’t suspend your own account.");
    authorId = user.id;
    ban(user, note || reason, me);
  } else if (action !== "dismiss") throw httpError(400, "Unknown action.");

  for (const r of open) Object.assign(r, { status: "closed", resolution: action === "dismiss" ? "dismissed" : action === "remove" ? "removed" : "banned", note: clip(note, 500) || null, resolvedAt: now(), resolvedBy: me.id });
  save("reports");

  // Let the people who reported it know
  const what = { post: "post", user: "account", live: "live stream", chat: "live chat message" }[target.type];
  const msg = action === "dismiss"
    ? `We reviewed the ${what} you reported. It doesn’t go against our rules, so it stays up. Thanks for looking out for LookBlog.`
    : `Thanks for your report. We reviewed the ${what} and took action.`;
  for (const id of new Set(open.map((r) => r.reporterId))) teamNote(id, msg, null);
  // And the author, when their content was removed (a suspended account can't see it anyway)
  if (action === "remove" && authorId) teamNote(authorId, `Your ${what} was removed because it goes against our rules (${reason}).${note ? " " + clip(note, 300) : ""}`, null);
  pingAdmins();
}

/* ---------- Verification requests ---------- */
function verifyView(r) {
  const u = findUser(r.userId);
  return {
    id: r.id, status: r.status, fullName: r.fullName, category: r.category, about: r.about, links: r.links || [], createdAt: r.createdAt,
    note: r.note || null, decidedAt: r.decidedAt || null, decidedBy: r.decidedBy ? person(findUser(r.decidedBy)) : null,
    user: person(u), followers: u ? followersOf(u.id) : 0, posts: u ? postsOf(u.id) : 0, joined: u?.createdAt || null,
  };
}

/* ---------- Support messages and bug reports ---------- */
function ticketView(t) {
  return {
    id: t.id, kind: t.kind || "support", topic: t.topic || null, area: t.area || null, message: t.message || "", steps: t.steps || "", expected: t.expected || "",
    reason: t.reason || null, details: t.details || "", accountAgeDays: t.accountAgeDays ?? null,
    page: t.page || "", userAgent: t.userAgent || "", screen: t.screen || "", lang: t.lang || "", screenshot: t.screenshot || null, email: t.email || null,
    status: t.status, reply: t.reply || null, repliedAt: t.repliedAt || null, createdAt: t.createdAt,
    user: t.userId ? person(findUser(t.userId)) : null, username: t.username || null,
  };
}

/* ---------- Accounts ---------- */
function userRow(u) {
  return {
    ...person(u), email: u.email || null, createdAt: u.createdAt, followers: followersOf(u.id), posts: postsOf(u.id),
    admin: isAdmin(u), owner: isOwner(u), bannedInfo: u.banned ? { reason: u.banned.reason, at: u.banned.at } : null,
    reportsAgainst: db.reports.filter((r) => (r.kind === "user" ? r.userId : r.authorId) === u.id).length,
  };
}

async function handleAdmin(req, res, url, me) {
  if (!url.pathname.startsWith("/api/admin")) return false;
  if (!isAdmin(me)) throw httpError(403, "Only the LookBlog team can open this.");
  const parts = url.pathname.split("/").filter(Boolean).slice(2); // after /api/admin
  const m = req.method;
  const [a, b] = parts;

  // Overview: GET /api/admin
  if (m === "GET" && !a) {
    const day = 86400000;
    const signups = Array.from({ length: 14 }, (_, i) => {
      const start = new Date(new Date().setHours(0, 0, 0, 0) - (13 - i) * day);
      const end = start.getTime() + day;
      return { day: start.toISOString().slice(0, 10), count: db.users.filter((u) => { const t = new Date(u.createdAt).getTime(); return t >= start.getTime() && t < end; }).length };
    });
    sendJSON(res, 200, {
      counts: counts(),
      totals: {
        users: db.users.length, posts: db.posts.filter((p) => p.type === "post").length, videos: db.posts.filter((p) => p.type === "video").length,
        shorts: db.posts.filter((p) => p.type === "short").length, groups: db.chats.filter((c) => c.kind === "group").length,
        songs: db.songs.length, liveNow: db.streams.filter((s) => s.live).length, verified: db.users.filter((u) => u.verified).length,
        banned: db.users.filter((u) => u.banned).length, admins: db.users.filter(isAdmin).length,
      },
      signups,
      newest: db.users.slice().sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 6).map(userRow),
      owner: isOwner(me),
    });
    return true;
  }

  // Reports: GET /api/admin/reports?status=open|closed · POST /api/admin/reports { key, action: dismiss|remove|ban, note }
  if (a === "reports" && !b) {
    if (m === "GET") { sendJSON(res, 200, { cases: listCases(url.searchParams.get("status") === "closed" ? "closed" : "open"), counts: counts() }); return true; }
    if (m === "POST") {
      const body = await readJSON(req);
      resolveCase(String(body.key || ""), body.action, body.note, me);
      sendJSON(res, 200, { ok: true, counts: counts() });
      return true;
    }
  }

  // Verification: GET /api/admin/verifications?status=pending|approved|rejected · POST /api/admin/verifications/:id { action: approve|reject, type, note }
  if (a === "verifications") {
    if (m === "GET" && !b) {
      const status = ["pending", "approved", "rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
      const list = db.verifyRequests.filter((r) => r.status === status).sort((x, y) => (status === "pending" ? x.createdAt.localeCompare(y.createdAt) : y.createdAt.localeCompare(x.createdAt)));
      sendJSON(res, 200, { requests: list.slice(0, 200).map(verifyView), counts: counts() });
      return true;
    }
    if (m === "POST" && b) {
      const r = db.verifyRequests.find((x) => x.id === b);
      if (!r) throw httpError(404, "This request doesn’t exist.");
      if (r.status !== "pending") throw httpError(400, "This request was already answered.");
      const body = await readJSON(req);
      const user = findUser(r.userId);
      const note = clip(body.note, 500) || null;
      if (body.action === "approve") {
        if (!user) throw httpError(404, "This account doesn’t exist anymore.");
        const type = VERIFY_TYPES.includes(body.type) ? body.type : r.category || "creator";
        user.verified = true; user.verifiedType = type;
        save("users");
        Object.assign(r, { status: "approved", type, note, decidedAt: now(), decidedBy: me.id });
        teamNote(user.id, `🎉 You’re verified! Your account now has the ${type.replace("-", " ")} tick.${note ? " " + note : ""}`, `/u/${encodeURIComponent(user.username)}`);
      } else if (body.action === "reject") {
        Object.assign(r, { status: "rejected", note, decidedAt: now(), decidedBy: me.id });
        if (user) teamNote(user.id, `Your verification request wasn’t approved this time.${note ? " " + note : ""} You can apply again in 30 days.`, "/verified");
      } else throw httpError(400, "Unknown action.");
      save("verifyRequests");
      pingAdmins();
      sendJSON(res, 200, { request: verifyView(r), counts: counts() });
      return true;
    }
  }

  // Support and bugs: GET /api/admin/support?kind=support|bug|deletion&status=open|closed · POST /api/admin/support/:id { reply, status }
  if (a === "support") {
    if (m === "GET" && !b) {
      const kind = ["support", "bug", "deletion"].includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "support";
      const status = url.searchParams.get("status") === "closed" ? "closed" : "open";
      const list = db.support.filter((t) => (t.kind || "support") === kind && (kind === "deletion" || (status === "open" ? t.status === "open" : t.status !== "open")));
      list.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      sendJSON(res, 200, { tickets: list.slice(0, 200).map(ticketView), counts: counts() });
      return true;
    }
    if (m === "POST" && b) {
      const t = db.support.find((x) => x.id === b);
      if (!t) throw httpError(404, "This message doesn’t exist.");
      const body = await readJSON(req);
      const reply = clip(body.reply, 3000);
      if (reply) {
        t.reply = reply; t.repliedAt = now(); t.repliedBy = me.id; t.status = "closed";
        if (t.userId && findUser(t.userId)) teamNote(t.userId, `${t.kind === "bug" ? "About your bug report" : "Reply to your message"}: ${reply}`, null);
      }
      if (body.status === "open" || body.status === "closed") t.status = body.status;
      save("support");
      pingAdmins();
      sendJSON(res, 200, { ticket: ticketView(t), counts: counts() });
      return true;
    }
  }

  // Accounts: GET /api/admin/users?q=&filter=all|banned|verified|admins · POST /api/admin/users/:id { action, type, reason, confirm }
  if (a === "users") {
    if (m === "GET" && !b) {
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase().replace(/^@/, "");
      const filter = url.searchParams.get("filter") || "all";
      let list = db.users.filter((u) => filter === "banned" ? u.banned : filter === "verified" ? u.verified : filter === "admins" ? isAdmin(u) : true);
      if (q) list = list.filter((u) => u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || String(u.email || "").toLowerCase().includes(q));
      list.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      sendJSON(res, 200, { users: list.slice(0, 100).map(userRow), total: list.length });
      return true;
    }
    if (m === "POST" && b) {
      const user = findUser(b);
      if (!user) throw httpError(404, "This account doesn’t exist.");
      const body = await readJSON(req);
      const act = body.action;
      const guard = () => {
        if (user.id === me.id) throw httpError(400, "You can’t do this to your own account.");
        if (isOwner(user)) throw httpError(403, "Owners can’t be changed here.");
        if (isAdmin(user) && !isOwner(me)) throw httpError(403, "Only an owner can do this to another admin.");
      };
      if (act === "verify") {
        user.verified = true; user.verifiedType = VERIFY_TYPES.includes(body.type) ? body.type : "creator";
        teamNote(user.id, `🎉 You’re verified! Your account now has the ${user.verifiedType.replace("-", " ")} tick.`, `/u/${encodeURIComponent(user.username)}`);
      } else if (act === "unverify") {
        user.verified = false;
      } else if (act === "ban") {
        guard(); ban(user, body.reason, me);
      } else if (act === "unban") {
        delete user.banned;
      } else if (act === "make-admin" || act === "remove-admin") {
        if (!isOwner(me)) throw httpError(403, "Only an owner can add or remove admins.");
        if (isOwner(user)) throw httpError(403, "Owners are always admins.");
        user.admin = act === "make-admin";
        if (user.admin) teamNote(user.id, "You’re now part of the LookBlog team. Open the Admin page from your menu.", "/admin");
      } else if (act === "delete") {
        guard();
        if (String(body.confirm || "").toLowerCase() !== user.username.toLowerCase()) throw httpError(400, `Type ${user.username} to confirm.`);
        sendTo([user.id], { type: "account:banned" });
        require("./account").wipe(user);
        console.log(`[admin] @${me.username} deleted @${user.username}`);
        sendJSON(res, 200, { ok: true, deleted: true });
        return true;
      } else throw httpError(400, "Unknown action.");
      save("users");
      console.log(`[admin] @${me.username}: ${act} @${user.username}`);
      sendJSON(res, 200, { user: userRow(user) });
      return true;
    }
  }

  sendJSON(res, 404, { error: "Not found." });
  return true;
}

module.exports = { handleAdmin, isAdmin, isOwner, pingAdmins };
