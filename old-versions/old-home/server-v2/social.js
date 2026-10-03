// Posts, shorts, videos, comments, reactions, views, follows, profiles and search.

const crypto = require("crypto");
const { db, save, findUser, findByUsername, findPost } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { ownedMedia, markUsed, deleteMedia } = require("./media");
const { broadcast } = require("./realtime");

const LIMITS = { postText: 1000, caption: 300, title: 100, description: 5000, comment: 1000, bio: 160, name: 50 };
const SHORT_MAX_SECONDS = 90;
const PAGE = 20;
const TYPES = ["post", "short", "video"];

const clean = (v) => String(v || "").replace(/\r\n?/g, "\n").trim();
const chars = (s) => [...s].length;

/* ---------- Shapes sent to the browser ---------- */
function authorView(u) {
  return u ? { name: u.name, username: u.username, avatar: u.avatar } : { name: "Deleted account", username: "", avatar: null };
}
function followerCount(user) {
  return db.users.filter((u) => u.following.includes(user.id)).length;
}
function stats(p) {
  return { likes: p.likes.length, dislikes: p.dislikes.length, views: p.viewedBy.length, comments: p.commentCount, reposts: p.reposts.length };
}
function postView(p, me) {
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    text: p.text,
    media: p.media,
    createdAt: p.createdAt,
    author: authorView(findUser(p.userId)),
    ...stats(p),
    reaction: p.likes.includes(me.id) ? "like" : p.dislikes.includes(me.id) ? "dislike" : null,
    reposted: p.reposts.some((r) => r.userId === me.id),
    mine: p.userId === me.id,
  };
}
function commentView(c, me, post) {
  return {
    id: c.id,
    postId: c.postId,
    text: c.text,
    media: c.media,
    createdAt: c.createdAt,
    author: authorView(findUser(c.userId)),
    canDelete: c.userId === me.id || post.userId === me.id,
  };
}
function profileView(user, me) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    bio: user.bio,
    avatar: user.avatar,
    banner: user.banner,
    createdAt: user.createdAt,
    following: user.following.length,
    followers: followerCount(user),
    posts: db.posts.filter((p) => p.userId === user.id).length,
    reposts: db.posts.filter((p) => p.reposts.some((r) => r.userId === user.id)).length,
    isMe: user.id === me.id,
    isFollowing: me.following.includes(user.id),
  };
}
function claim(media, usedBy) {
  for (const m of [].concat(media || [])) {
    markUsed(m.url, usedBy);
    if (m.poster) markUsed(m.poster, usedBy);
  }
}
function sendStats(p) {
  broadcast({ type: "stats", id: p.id, ...stats(p) });
}

/* ---------- Timelines ----------
   An item is a post shown at a moment in time: when it was written, or when someone reposted it.
   `authors` decides whose own posts count, `reposters` whose reposts count. Each post shows up once,
   at its most recent moment. */
function timeline({ authors = null, reposters = null, type = null } = {}) {
  const items = [];
  for (const p of db.posts) {
    if (TYPES.includes(type) && p.type !== type) continue;
    let best = null;
    if (!authors || authors.has(p.userId)) best = { post: p, at: p.createdAt, by: null };
    if (reposters) {
      for (const r of p.reposts) {
        if (reposters.has(r.userId) && (!best || r.at > best.at)) best = { post: p, at: r.at, by: r.userId };
      }
    }
    if (best) items.push(best);
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/* ---------- Paging: newest first, "before" is the time of the last item seen ---------- */
function page(items, url, me) {
  const before = url.searchParams.get("before");
  const from = before ? items.filter((i) => i.at < before) : items;
  const slice = from.slice(0, PAGE);
  return {
    posts: slice.map((i) => {
      const view = postView(i.post, me);
      if (i.by) {
        const u = findUser(i.by);
        view.repostedBy = u ? { name: u.name, username: u.username, isMe: u.id === me.id } : null;
        view.repostedAt = i.at;
      }
      return view;
    }),
    nextBefore: from.length > PAGE ? slice[slice.length - 1].at : null,
  };
}

/* ---------- Validating a new post ---------- */
function buildMedia(item, me) {
  const m = ownedMedia(item && item.url, me.id);
  if (!m) throw httpError(400, "One of the files couldn’t be found. Try uploading it again.");
  const out = { url: m.url, kind: m.kind };
  if (m.kind === "video") {
    const poster = item.poster ? ownedMedia(item.poster, me.id, "image") : null;
    if (poster) out.poster = poster.url;
    const d = Number(item.duration);
    if (Number.isFinite(d) && d > 0) out.duration = Math.round(d * 10) / 10;
  }
  const w = Number(item.width), h = Number(item.height);
  if (w > 0 && h > 0 && w < 20000 && h < 20000) { out.width = Math.round(w); out.height = Math.round(h); }
  return out;
}

function validatePost(body, me) {
  const type = TYPES.includes(body.type) ? body.type : "post";
  const text = clean(body.text);
  const title = clean(body.title);
  const raw = Array.isArray(body.media) ? body.media.slice(0, 5) : [];
  const media = raw.map((m) => buildMedia(m, me));
  const videos = media.filter((m) => m.kind === "video");
  const images = media.filter((m) => m.kind === "image");

  if (type === "post") {
    if (!text && !media.length) throw httpError(400, "Write something or add a photo.");
    if (chars(text) > LIMITS.postText) throw httpError(400, `Keep posts under ${LIMITS.postText} characters.`);
    if (videos.length > 1 || (videos.length && images.length)) throw httpError(400, "Add up to 4 photos, or one video.");
    if (images.length > 4) throw httpError(400, "Add up to 4 photos.");
  } else {
    if (media.length !== 1 || videos.length !== 1) throw httpError(400, type === "short" ? "A short needs one video." : "Add the video you want to post.");
    if (type === "short") {
      if (chars(text) > LIMITS.caption) throw httpError(400, `Keep the caption under ${LIMITS.caption} characters.`);
      if (!videos[0].duration) throw httpError(400, "We couldn’t read how long this video is. Try an MP4 file.");
      if (videos[0].duration > SHORT_MAX_SECONDS + 0.5) throw httpError(400, `Shorts can be up to ${SHORT_MAX_SECONDS} seconds. Post it as a video instead.`);
    } else {
      if (!title) throw httpError(400, "Give your video a title.");
      if (chars(title) > LIMITS.title) throw httpError(400, `Keep the title under ${LIMITS.title} characters.`);
      if (chars(text) > LIMITS.description) throw httpError(400, `Keep the description under ${LIMITS.description} characters.`);
    }
  }
  return { type, text, title: type === "video" ? title : "", media };
}

/* ---------- Routes. Returns true when the request was handled. ---------- */
async function handleSocial(req, res, url, me) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // without "api"
  const [a, b, c] = parts;
  const m = req.method;

  // Feed: GET /api/feed?scope=following|latest&type=all|post|short|video&before=
  if (m === "GET" && a === "feed" && parts.length === 1) {
    const scope = url.searchParams.get("scope") === "following" ? "following" : "latest";
    const type = url.searchParams.get("type");
    const people = new Set([me.id, ...me.following]);
    // Latest: every post once, when it was written. Following: posts and reposts from people I follow (and me).
    const items = scope === "latest" ? timeline({ type }) : timeline({ authors: people, reposters: people, type });
    sendJSON(res, 200, page(items, url, me));
    return true;
  }

  // Create: POST /api/posts
  if (m === "POST" && a === "posts" && parts.length === 1) {
    rateLimit("post:" + me.id, 30, 10 * 60 * 1000, "You’re posting a lot. Take a short break.");
    const data = validatePost(await readJSON(req), me);
    const post = {
      id: crypto.randomUUID(),
      userId: me.id,
      ...data,
      createdAt: new Date().toISOString(),
      likes: [],
      dislikes: [],
      viewedBy: [],
      commentCount: 0,
    };
    db.posts.unshift(post);
    claim(post.media, "post:" + post.id);
    save("posts");
    broadcast({ type: "post:new", id: post.id, postType: post.type, author: me.username, authorId: me.id });
    sendJSON(res, 201, { post: postView(post, me) });
    return true;
  }

  // One post with its comments: GET /api/posts/:id
  if (m === "GET" && a === "posts" && parts.length === 2) {
    const post = findPost(b);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    const comments = db.comments.filter((x) => x.postId === post.id).map((x) => commentView(x, me, post));
    sendJSON(res, 200, { post: postView(post, me), comments });
    return true;
  }

  // Delete: DELETE /api/posts/:id
  if (m === "DELETE" && a === "posts" && parts.length === 2) {
    const i = db.posts.findIndex((p) => p.id === b);
    if (i === -1) throw httpError(404, "This post doesn’t exist anymore.");
    const post = db.posts[i];
    if (post.userId !== me.id) throw httpError(403, "You can only delete your own posts.");
    db.posts.splice(i, 1);
    for (const md of post.media) { deleteMedia(md.url); if (md.poster) deleteMedia(md.poster); }
    db.comments = db.comments.filter((x) => {
      if (x.postId !== post.id) return true;
      if (x.media) { deleteMedia(x.media.url); if (x.media.poster) deleteMedia(x.media.poster); }
      return false;
    });
    save("posts");
    save("comments");
    broadcast({ type: "post:deleted", id: post.id });
    sendJSON(res, 200, { ok: true });
    return true;
  }

  // Like / dislike: POST /api/posts/:id/react { reaction: "like" | "dislike" | "none" }
  if (m === "POST" && a === "posts" && c === "react" && parts.length === 3) {
    const post = findPost(b);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    const { reaction } = await readJSON(req);
    post.likes = post.likes.filter((id) => id !== me.id);
    post.dislikes = post.dislikes.filter((id) => id !== me.id);
    if (reaction === "like") post.likes.push(me.id);
    if (reaction === "dislike") post.dislikes.push(me.id);
    save("posts");
    sendStats(post);
    sendJSON(res, 200, { ...stats(post), reaction: reaction === "like" || reaction === "dislike" ? reaction : null });
    return true;
  }

  // Repost: POST /api/posts/:id/repost { repost: true | false }
  if (m === "POST" && a === "posts" && c === "repost" && parts.length === 3) {
    const post = findPost(b);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    const { repost } = await readJSON(req);
    const had = post.reposts.some((r) => r.userId === me.id);
    post.reposts = post.reposts.filter((r) => r.userId !== me.id);
    if (repost) post.reposts.push({ userId: me.id, at: new Date().toISOString() });
    save("posts");
    sendStats(post);
    if (repost && !had) broadcast({ type: "repost", id: post.id, by: me.username, byId: me.id, authorId: post.userId });
    sendJSON(res, 200, { ...stats(post), reposted: Boolean(repost) });
    return true;
  }

  // A view: POST /api/posts/:id/view  (each person counts once)
  if (m === "POST" && a === "posts" && c === "view" && parts.length === 3) {
    const post = findPost(b);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    if (!post.viewedBy.includes(me.id)) {
      post.viewedBy.push(me.id);
      save("posts");
      sendStats(post);
    }
    sendJSON(res, 200, { views: post.viewedBy.length });
    return true;
  }

  // Comment: POST /api/posts/:id/comments { text, media: { url, poster, duration } | null }
  if (m === "POST" && a === "posts" && c === "comments" && parts.length === 3) {
    rateLimit("comment:" + me.id, 60, 10 * 60 * 1000, "You’re commenting a lot. Take a short break.");
    const post = findPost(b);
    if (!post) throw httpError(404, "This post doesn’t exist anymore.");
    const body = await readJSON(req);
    const text = clean(body.text);
    const media = body.media ? buildMedia(body.media, me) : null;
    if (!text && !media) throw httpError(400, "Write a reply or add a photo or video.");
    if (chars(text) > LIMITS.comment) throw httpError(400, `Keep replies under ${LIMITS.comment} characters.`);
    const comment = { id: crypto.randomUUID(), postId: post.id, userId: me.id, text, media, createdAt: new Date().toISOString() };
    db.comments.push(comment);
    claim(comment.media, "comment:" + comment.id);
    post.commentCount++;
    save("comments");
    save("posts");
    broadcast({ type: "comment:new", postId: post.id, commentId: comment.id, authorId: me.id });
    sendStats(post);
    sendJSON(res, 201, { comment: commentView(comment, me, post) });
    return true;
  }

  // One comment (used to show live replies): GET /api/comments/:id
  if (m === "GET" && a === "comments" && parts.length === 2) {
    const comment = db.comments.find((x) => x.id === b);
    const post = comment && findPost(comment.postId);
    if (!comment || !post) throw httpError(404, "This reply doesn’t exist anymore.");
    sendJSON(res, 200, { comment: commentView(comment, me, post) });
    return true;
  }

  // Delete a comment: DELETE /api/comments/:id  (its author or the post's author)
  if (m === "DELETE" && a === "comments" && parts.length === 2) {
    const i = db.comments.findIndex((x) => x.id === b);
    if (i === -1) throw httpError(404, "This reply doesn’t exist anymore.");
    const comment = db.comments[i];
    const post = findPost(comment.postId);
    if (comment.userId !== me.id && (!post || post.userId !== me.id)) throw httpError(403, "You can’t delete this reply.");
    db.comments.splice(i, 1);
    if (comment.media) { deleteMedia(comment.media.url); if (comment.media.poster) deleteMedia(comment.media.poster); }
    save("comments");
    if (post) { post.commentCount = Math.max(0, post.commentCount - 1); save("posts"); sendStats(post); }
    broadcast({ type: "comment:deleted", postId: comment.postId, commentId: comment.id });
    sendJSON(res, 200, { ok: true });
    return true;
  }

  // Who to follow: GET /api/users/suggestions
  if (m === "GET" && a === "users" && b === "suggestions" && parts.length === 2) {
    const list = db.users
      .filter((u) => u.id !== me.id && !me.following.includes(u.id))
      .sort((x, y) => followerCount(y) - followerCount(x) || y.createdAt.localeCompare(x.createdAt))
      .slice(0, 5)
      .map(authorView);
    sendJSON(res, 200, { users: list });
    return true;
  }

  // Profile: GET /api/users/:username
  if (m === "GET" && a === "users" && parts.length === 2) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    sendJSON(res, 200, { profile: profileView(user, me) });
    return true;
  }

  // Their posts: GET /api/users/:username/posts?type=post|short|video&before=
  if (m === "GET" && a === "users" && c === "posts" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    const type = url.searchParams.get("type");
    const only = new Set([user.id]);
    // type=repost: what they shared (any kind). Otherwise: their own posts of that kind.
    const items = type === "repost"
      ? timeline({ authors: new Set(), reposters: only })
      : timeline({ authors: only, type });
    sendJSON(res, 200, page(items, url, me));
    return true;
  }

  // Who follows them / whom they follow: GET /api/users/:username/followers | following
  if (m === "GET" && a === "users" && (c === "followers" || c === "following") && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    const list = c === "followers"
      ? db.users.filter((u) => u.following.includes(user.id))
      : user.following.map(findUser).filter(Boolean);
    sendJSON(res, 200, {
      users: list.map((u) => ({
        ...authorView(u),
        bio: u.bio,
        isMe: u.id === me.id,
        isFollowing: me.following.includes(u.id),
        followsYou: u.following.includes(me.id),
      })),
    });
    return true;
  }

  // Follow / unfollow: POST /api/users/:username/follow
  if (m === "POST" && a === "users" && c === "follow" && parts.length === 3) {
    const user = findByUsername(decodeURIComponent(b));
    if (!user) throw httpError(404, "This account doesn’t exist.");
    if (user.id === me.id) throw httpError(400, "You can’t follow yourself.");
    const i = me.following.indexOf(user.id);
    if (i === -1) me.following.push(user.id);
    else me.following.splice(i, 1);
    save("users");
    broadcast({
      type: "follow",
      username: user.username,
      followers: followerCount(user),
      by: me.username,
      byFollowing: me.following.length,
      following: i === -1,
    });
    sendJSON(res, 200, { profile: profileView(user, me) });
    return true;
  }

  // Edit my profile: POST /api/me/profile { name, bio, avatar, banner }
  if (m === "POST" && a === "me" && b === "profile" && parts.length === 2) {
    const body = await readJSON(req);
    const name = clean(body.name).replace(/\s+/g, " ");
    const bio = clean(body.bio);
    const errors = {};
    if (!name) errors.name = "Your name can’t be empty.";
    else if (chars(name) > LIMITS.name) errors.name = `Keep your name under ${LIMITS.name} characters.`;
    if (chars(bio) > LIMITS.bio) errors.bio = `Keep your bio under ${LIMITS.bio} characters.`;

    const pick = (value, current) => {
      if (value === null) return null; // removed
      if (value === undefined || value === current) return current; // unchanged
      const ok = ownedMedia(value, me.id, "image");
      if (!ok) throw httpError(400, "That picture couldn’t be found. Try uploading it again.");
      return ok.url;
    };
    if (Object.keys(errors).length) { sendJSON(res, 400, { errors }); return true; }

    const avatar = pick(body.avatar, me.avatar);
    const banner = pick(body.banner, me.banner);
    if (me.avatar && me.avatar !== avatar) deleteMedia(me.avatar);
    if (me.banner && me.banner !== banner) deleteMedia(me.banner);
    if (avatar && avatar !== me.avatar) markUsed(avatar, "avatar:" + me.id);
    if (banner && banner !== me.banner) markUsed(banner, "banner:" + me.id);
    Object.assign(me, { name, bio, avatar, banner });
    save("users");
    broadcast({ type: "profile", username: me.username, name, avatar, banner, bio });
    sendJSON(res, 200, { profile: profileView(me, me) });
    return true;
  }

  // Search: GET /api/search?q=
  if (m === "GET" && a === "search" && parts.length === 1) {
    const q = clean(url.searchParams.get("q")).toLowerCase().replace(/^@/, "");
    if (!q) { sendJSON(res, 200, { users: [], posts: [] }); return true; }
    const score = (u) => {
      const un = u.username.toLowerCase(), n = u.name.toLowerCase();
      if (un === q) return 0;
      if (un.startsWith(q) || n.startsWith(q)) return 1;
      if (n.split(/\s+/).some((w) => w.startsWith(q))) return 2;
      return un.includes(q) || n.includes(q) ? 3 : -1;
    };
    const users = db.users
      .map((u) => [score(u), u])
      .filter(([s]) => s >= 0)
      .sort((x, y) => x[0] - y[0] || followerCount(y[1]) - followerCount(x[1]))
      .slice(0, 20)
      .map(([, u]) => ({ ...authorView(u), bio: u.bio, isMe: u.id === me.id, isFollowing: me.following.includes(u.id) }));
    const posts = db.posts
      .filter((p) => (p.text + " " + p.title).toLowerCase().includes(q))
      .slice(0, 20)
      .map((p) => postView(p, me));
    sendJSON(res, 200, { users, posts });
    return true;
  }

  return false;
}

module.exports = { handleSocial };
