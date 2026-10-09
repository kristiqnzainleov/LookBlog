// Stories: a photo or short video that disappears after 24 hours. Seen by you and your followers.
// After 24 hours a story moves to your archive (only you see it) for 30 days, so you can still put it in a highlight.
// Highlights: groups of your stories that stay on your profile, with a title and a cover (like Instagram).
// People can react to a story with an emoji and reply to it.
const crypto = require("crypto");
const { db, save, findUser } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { markUsed, deleteMedia, ownedMedia } = require("./media");
const { sendTo } = require("./realtime");
const { buildMedia, authorView, clean, chars } = require("./social");
const { notify } = require("./notifications");
const { every } = require("./ticker");

const DAY = 24 * 60 * 60 * 1000;
const ARCHIVE_DAYS = 30;
const REACTIONS = ["😂", "😮", "😍", "😢", "👏", "🔥", "❤️", "💯"];
const live = (s) => Date.now() - new Date(s.createdAt).getTime() < DAY;
const canSee = (owner, me) => owner.id === me.id || me.following.includes(owner.id);
// Highlights show on the profile: everyone sees them, private accounts only to followers
const canSeeProfile = (owner, me) => owner.id === me.id || !owner.private || me.following.includes(owner.id);
const highlightsOf = (userId) => (db.highlights || []).filter((x) => x.userId === userId);
const inHighlight = (s) => (db.highlights || []).some((x) => x.storyIds.includes(s.id));
const repostedBy = (s, me) => db.stories.some((x) => x.userId === me.id && x.repostOf?.storyId === s.id);
// A story's files are deleted with it, unless another story (a repost) still shows them
function dropMedia(story, gone = new Set([story.id])) {
  for (const url of [story.media.url, story.media.poster].filter(Boolean)) {
    if (!db.stories.some((x) => !gone.has(x.id) && (x.media.url === url || x.media.poster === url))) deleteMedia(url);
  }
}

function storyView(s, me) {
  const out = {
    id: s.id,
    media: s.media,
    text: s.text,
    createdAt: s.createdAt,
    expiresAt: new Date(new Date(s.createdAt).getTime() + DAY).toISOString(),
    live: live(s),
    seen: s.viewers.some((v) => v.userId === me.id),
    mine: s.userId === me.id,
    myReaction: s.reactions?.[me.id] || null,
    // People tagged in it (they can add it to their own story)
    tags: (s.tags || []).map(findUser).filter(Boolean).map((u) => ({ username: u.username, name: u.name })),
    taggedMe: (s.tags || []).includes(me.id),
    canRepost: live(s) && s.userId !== me.id && (s.tags || []).includes(me.id) && !repostedBy(s, me),
    comments: (s.comments || []).filter((c) => { const u = findUser(c.userId); return u && !require("./social").blockedBetween?.(u, me); }).length,
    // The newest comments, shown right on the story
    latestComments: (s.comments || []).filter((c) => { const u = findUser(c.userId); return u && !require("./social").blockedBetween?.(u, me); }).slice(-3)
      .map((c) => { const u = findUser(c.userId); return { id: c.id, name: u.name, username: u.username, avatar: u.avatar, text: c.text || (c.gif ? "GIF" : ""), byOwner: c.userId === s.userId }; }),
    repostOf: s.repostOf ? (() => { const o = findUser(s.repostOf.userId); return o ? { username: o.username, name: o.name } : null; })() : null,
  };
  if (s.userId === me.id) {
    out.viewers = s.viewers.slice().reverse().map((v) => ({ ...authorView(findUser(v.userId)), at: v.at, reaction: s.reactions?.[v.userId] || null }));
    out.reactions = Object.keys(s.reactions || {}).length;
    out.highlights = highlightsOf(me.id).filter((x) => x.storyIds.includes(s.id)).map((x) => x.id);
  }
  return out;
}

// A highlight's cover: the photo picked for it, or a frame from one of its stories
function coverOf(hl) {
  if (hl.cover?.url && (!hl.cover.storyId || hl.storyIds.includes(hl.cover.storyId))) return hl.cover.url;
  const first = hl.storyIds.map((id) => db.stories.find((s) => s.id === id)).find(Boolean);
  return first ? (first.media.kind === "video" ? first.media.poster || null : first.media.url) : null;
}
function highlightView(hl) {
  return { id: hl.id, title: hl.title, cover: coverOf(hl), count: hl.storyIds.filter((id) => db.stories.some((s) => s.id === id)).length, coverStoryId: hl.cover?.storyId || null, customCover: Boolean(hl.cover?.own) };
}

// Stories older than a day go to the archive; after 30 days they're deleted (unless they're in a highlight)
function sweep() {
  const cutoff = Date.now() - ARCHIVE_DAYS * DAY;
  const old = db.stories.filter((s) => new Date(s.createdAt).getTime() < cutoff && !inHighlight(s));
  if (!old.length) return;
  const gone = new Set(old.map((s) => s.id));
  for (const s of old) dropMedia(s, gone);
  db.stories = db.stories.filter((s) => !gone.has(s.id));
  save("stories");
}
every(sweep, 10 * 60 * 1000).unref();
setTimeout(sweep, 5000).unref();

// Who has a story right now, for rings around avatars
function storyState(user, me) {
  if (!canSee(user, me)) return null;
  const list = db.stories.filter((s) => s.userId === user.id && live(s));
  if (!list.length) return null;
  return { count: list.length, unseen: list.some((s) => !s.viewers.some((v) => v.userId === me.id)) };
}

// A reply or reaction: a message if the two follow each other (with the story shown), otherwise a notification
function deliverToOwner(story, me, { text, reaction, gif = null }) {
  const owner = findUser(story.userId);
  const chatMod = require("./chat");
  const mutual = me.following.includes(owner.id) && owner.following.includes(me.id);
  let chat = db.chats.find((ch) => ch.kind === "dm" && ch.members.includes(me.id) && ch.members.includes(owner.id));
  if (!chat && mutual) {
    chat = { id: crypto.randomUUID(), kind: "dm", members: [me.id, owner.id], createdAt: new Date().toISOString(), lastAt: new Date().toISOString(), reads: {} };
    db.chats.push(chat);
  }
  if (!chat) {
    notify(owner.id, reaction ? "story-reaction" : "story-reply", me, reaction ? { emoji: reaction } : { text: text || "sent a GIF" });
    return { sent: "notification" };
  }
  const msg = { id: crypto.randomUUID(), chatId: chat.id, userId: me.id, text: reaction || text, media: gif ? { url: gif.url, kind: "image", gif: true } : null, postId: null, replyTo: null, mentions: [],
    storyReply: { storyId: story.id, owner: owner.id, reaction: reaction || null }, createdAt: new Date().toISOString() };
  db.messages.push(msg);
  chat.lastAt = msg.createdAt;
  save("messages"); save("chats");
  chatMod.deliverMessage(chat, msg);
  return { sent: "message", chatId: chat.id };
}

// The story shown in a chat message (it may have expired since)
function storyPreview(storyId, me) {
  const s = db.stories.find((x) => x.id === storyId);
  const owner = s && findUser(s.userId);
  if (!s || !owner || !(live(s) || inHighlight(s)) || !(canSee(owner, me) || canSeeProfile(owner, me) && inHighlight(s))) return { gone: true };
  return { id: s.id, username: owner.username, thumb: s.media.kind === "video" ? s.media.poster || null : s.media.url };
}

async function handleStories(req, res, url, me) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  const m = req.method;

  /* ---------- Highlights ---------- */
  // GET /api/users/:username/highlights
  if (m === "GET" && parts[0] === "users" && parts[2] === "highlights" && parts.length === 3) {
    const u = db.users.find((x) => x.username.toLowerCase() === decodeURIComponent(parts[1]).toLowerCase());
    if (!u || !canSeeProfile(u, me)) { sendJSON(res, 200, { highlights: [] }); return true; }
    sendJSON(res, 200, { highlights: highlightsOf(u.id).map(highlightView).filter((x) => x.count) });
    return true;
  }
  if (parts[0] === "highlights") {
    // New: POST /api/highlights { title, storyIds, coverStoryId, coverImage }
    if (m === "POST" && parts.length === 1) {
      rateLimit("highlight:" + me.id, 30, 60 * 60 * 1000, "You’ve made a lot of highlights. Try again later.");
      const body = await readJSON(req);
      if (!db.highlights) db.highlights = [];
      if (highlightsOf(me.id).length >= 50) throw httpError(400, "You can have up to 50 highlights.");
      const hl = { id: crypto.randomUUID(), userId: me.id, title: "", storyIds: [], cover: null, createdAt: new Date().toISOString() };
      applyHighlight(hl, body, me);
      if (!hl.storyIds.length) throw httpError(400, "Pick at least one story.");
      db.highlights.push(hl);
      save("highlights");
      sendJSON(res, 201, { highlight: highlightView(hl) });
      return true;
    }
    const hl = parts[1] && (db.highlights || []).find((x) => x.id === parts[1]);
    if (!hl) throw httpError(404, "This highlight is gone.");
    const owner = findUser(hl.userId);
    if (!owner || !canSeeProfile(owner, me)) throw httpError(404, "This highlight is gone.");
    // Watch: GET /api/highlights/:id
    if (m === "GET" && parts.length === 2) {
      const stories = hl.storyIds.map((id) => db.stories.find((s) => s.id === id)).filter(Boolean);
      sendJSON(res, 200, { highlight: highlightView(hl), group: { user: authorView(owner), isMe: owner.id === me.id, highlightId: hl.id, stories: stories.map((s) => storyView(s, me)) } });
      return true;
    }
    if (hl.userId !== me.id) throw httpError(403, "Only the owner can change this highlight.");
    // Edit: POST /api/highlights/:id { title, storyIds, coverStoryId, coverImage, add, remove }
    if (m === "POST" && parts.length === 2) {
      applyHighlight(hl, await readJSON(req), me);
      if (!hl.storyIds.length) { deleteHighlight(hl); sendJSON(res, 200, { deleted: true }); return true; }
      save("highlights");
      sendJSON(res, 200, { highlight: highlightView(hl) });
      return true;
    }
    // Delete: DELETE /api/highlights/:id  (the stories stay in your archive)
    if (m === "DELETE" && parts.length === 2) {
      deleteHighlight(hl);
      sendJSON(res, 200, { ok: true });
      return true;
    }
    return false;
  }

  if (parts[0] !== "stories") return false;

  // The story bar: GET /api/stories  → [{ user, stories, unseen }]
  if (m === "GET" && parts.length === 1) {
    const people = [me, ...me.following.map(findUser).filter(Boolean)];
    const groups = [];
    for (const u of people) {
      const list = db.stories.filter((s) => s.userId === u.id && live(s)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (!list.length && u.id !== me.id) continue;
      const stories = list.map((s) => storyView(s, me));
      groups.push({ user: authorView(u), isMe: u.id === me.id, stories, unseen: stories.some((s) => !s.seen), latest: list.length ? list[list.length - 1].createdAt : "" });
    }
    groups.sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(b.unseen) - Number(a.unseen) || b.latest.localeCompare(a.latest));
    sendJSON(res, 200, { groups });
    return true;
  }

  // My archive (last 30 days, newest first), for making highlights: GET /api/stories/archive
  if (m === "GET" && parts[1] === "archive" && parts.length === 2) {
    const list = db.stories.filter((s) => s.userId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    sendJSON(res, 200, { stories: list.map((s) => storyView(s, me)) });
    return true;
  }

  // One person's stories: GET /api/stories/user/:username
  if (m === "GET" && parts[1] === "user" && parts.length === 3) {
    const u = db.users.find((x) => x.username.toLowerCase() === decodeURIComponent(parts[2]).toLowerCase());
    if (!u) throw httpError(404, "No stories here.");
    const list = db.stories.filter((s) => s.userId === u.id && live(s) && (canSee(u, me) || (s.tags || []).includes(me.id))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!list.length && !canSee(u, me)) throw httpError(404, "No stories here.");
    sendJSON(res, 200, { group: { user: authorView(u), isMe: u.id === me.id, stories: list.map((s) => storyView(s, me)) } });
    return true;
  }

  // Post one: POST /api/stories { media, text }
  if (m === "POST" && parts.length === 1) {
    rateLimit("story:" + me.id, 30, 60 * 60 * 1000, "You’ve posted a lot of stories. Try again later.");
    const body = await readJSON(req);
    if (!body.media) throw httpError(400, "Add a photo or a video.");
    const media = buildMedia(body.media, me);
    if (media.kind === "audio" || media.kind === "file") throw httpError(400, "Add a photo or a video.");
    if (media.kind === "video" && media.duration && media.duration > 60.5) throw httpError(400, "Story videos can be up to 60 seconds.");
    const text = clean(body.text);
    if (chars(text) > 120) throw httpError(400, "Keep the text under 120 characters.");
    require("./sensitive").refuseSensitive([text], [media]); // violence, weapons… aren't allowed
    // Tag people (up to 10): @usernames
    const { findByUsername } = require("./db");
    const tagged = [...new Set((Array.isArray(body.tags) ? body.tags : []).slice(0, 20).map((x) => String(x).replace(/^@/, "").trim().toLowerCase()).filter(Boolean))]
      .map((n) => findByUsername(n)).filter((u) => u && u.id !== me.id && !(u.blocked || []).includes(me.id) && !(me.blocked || []).includes(u.id));
    if (tagged.length > 10) throw httpError(400, "You can tag up to 10 people.");
    const story = { id: crypto.randomUUID(), userId: me.id, media, text, createdAt: new Date().toISOString(), viewers: [], reactions: {}, ...(tagged.length ? { tags: tagged.map((u) => u.id) } : {}) };
    db.stories.push(story);
    for (const u of tagged) notify(u.id, "story-mention", me, { storyId: story.id, thumb: media.kind === "video" ? media.poster || null : media.url });
    me.storyCount = (me.storyCount || 0) + 1;
    save("users");
    markUsed(media.url, "story:" + story.id);
    if (media.poster) markUsed(media.poster, "story:" + story.id);
    save("stories");
    const followers = db.users.filter((u) => u.following.includes(me.id)).map((u) => u.id);
    sendTo([me.id, ...followers], { type: "story:new", username: me.username });
    sendJSON(res, 201, { story: storyView(story, me) });
    return true;
  }

  // One story: while it's up for everyone (24 hours), in a highlight, or in my own archive
  const story = parts[1] && db.stories.find((s) => s.id === parts[1]);
  const owner = story && findUser(story.userId);
  const reachable = story && owner && (story.userId === me.id || (live(story) && (canSee(owner, me) || (story.tags || []).includes(me.id))) || (inHighlight(story) && canSeeProfile(owner, me)));
  if (!reachable) throw httpError(404, "This story is gone.");

  // Tagged in it: add it to my story too. POST /api/stories/:id/repost
  if (m === "POST" && parts[2] === "repost") {
    if (!(story.tags || []).includes(me.id)) throw httpError(403, "Only people tagged in this story can add it to theirs.");
    if (!live(story)) throw httpError(400, "This story has ended.");
    if (repostedBy(story, me)) throw httpError(400, "It’s already in your story.");
    rateLimit("story:" + me.id, 30, 60 * 60 * 1000, "You’ve posted a lot of stories. Try again later.");
    const mine = { id: crypto.randomUUID(), userId: me.id, media: { ...story.media }, text: story.text || "", createdAt: new Date().toISOString(), viewers: [], reactions: {},
      repostOf: { storyId: story.id, userId: story.userId } };
    db.stories.push(mine);
    me.storyCount = (me.storyCount || 0) + 1;
    save("users"); save("stories");
    notify(story.userId, "story-repost", me, { storyId: story.id, thumb: story.media.kind === "video" ? story.media.poster || null : story.media.url });
    const followers = db.users.filter((u) => u.following.includes(me.id)).map((u) => u.id);
    sendTo([me.id, ...followers], { type: "story:new", username: me.username });
    sendJSON(res, 201, { story: storyView(mine, me) });
    return true;
  }

  // Seen: POST /api/stories/:id/view
  if (m === "POST" && parts[2] === "view") {
    if (story.userId !== me.id && !story.viewers.some((v) => v.userId === me.id)) {
      story.viewers.push({ userId: me.id, at: new Date().toISOString() });
      save("stories");
      sendTo([story.userId], { type: "story:viewed", id: story.id, count: story.viewers.length });
    }
    sendJSON(res, 200, { ok: true });
    return true;
  }

  // React: POST /api/stories/:id/react { emoji }  (the same emoji again takes it back)
  if (m === "POST" && parts[2] === "react") {
    if (story.userId === me.id) throw httpError(400, "You can’t react to your own story.");
    rateLimit("story-react:" + me.id, 120, 10 * 60 * 1000, "Slow down a little.");
    const emoji = String((await readJSON(req)).emoji || "");
    if (!REACTIONS.includes(emoji)) throw httpError(400, "Pick one of the reactions.");
    story.reactions = story.reactions || {};
    const same = story.reactions[me.id] === emoji;
    if (same) delete story.reactions[me.id];
    else story.reactions[me.id] = emoji;
    if (!story.viewers.some((v) => v.userId === me.id)) story.viewers.push({ userId: me.id, at: new Date().toISOString() });
    save("stories");
    if (!same) deliverToOwner(story, me, { reaction: emoji });
    sendTo([story.userId], { type: "story:viewed", id: story.id, count: story.viewers.length });
    sendJSON(res, 200, { myReaction: story.reactions[me.id] || null });
    return true;
  }

  // Reply: POST /api/stories/:id/reply { text }
  if (m === "POST" && parts[2] === "reply") {
    if (story.userId === me.id) throw httpError(400, "You can’t reply to your own story.");
    rateLimit("story-reply:" + me.id, 60, 10 * 60 * 1000, "You’ve sent a lot of replies. Take a short break.");
    const body = await readJSON(req);
    const text = clean(body.text);
    const gif = body.gif || body.gifUrl ? require("./social").resolveGif(body, me) : null;
    if (!text && !gif) throw httpError(400, "Write a reply.");
    if (chars(text) > 1000) throw httpError(400, "Keep it under 1000 characters.");
    sendJSON(res, 201, deliverToOwner(story, me, { text, gif }));
    return true;
  }

  /* ---------- Comments on a story: they stay on it (in highlights too), everyone who can see it sees them ---------- */
  const commentView = (c) => {
    const u = findUser(c.userId);
    return u ? { id: c.id, text: c.text, gif: c.gif || null, at: c.at, author: authorView(u), mine: c.userId === me.id, canDelete: c.userId === me.id || story.userId === me.id,
      likes: (c.likes || []).length, liked: (c.likes || []).includes(me.id), byOwner: c.userId === story.userId } : null;
  };
  const { blockedBetween } = require("./social");
  const commentsOf = () => (story.comments || []).filter((c) => { const u = findUser(c.userId); return u && !blockedBetween(u, me); }).map(commentView).filter(Boolean);
  const tellWatchers = () => {
    const ids = new Set([story.userId, ...story.viewers.map((v) => v.userId), ...(story.comments || []).map((c) => c.userId)]);
    sendTo([...ids], { type: "story:comments", id: story.id, count: (story.comments || []).length });
  };
  // GET /api/stories/:id/comments
  if (m === "GET" && parts[2] === "comments" && parts.length === 3) {
    sendJSON(res, 200, { comments: commentsOf() });
    return true;
  }
  // POST /api/stories/:id/comments { text, gif }
  if (m === "POST" && parts[2] === "comments" && parts.length === 3) {
    rateLimit("story-comment:" + me.id, 60, 10 * 60 * 1000, "You’ve written a lot of comments. Take a short break.");
    const body = await readJSON(req);
    const text = clean(body.text);
    const gif = body.gif || body.gifUrl ? require("./social").resolveGif(body, me) : null;
    if (!text && !gif) throw httpError(400, "Write a comment.");
    if (chars(text) > 500) throw httpError(400, "Keep it under 500 characters.");
    story.comments = story.comments || [];
    if (story.comments.length >= 500) throw httpError(400, "This story has a lot of comments already.");
    story.comments.push({ id: crypto.randomUUID().slice(0, 12), userId: me.id, text, gif: gif ? { url: gif.url, width: gif.width || null, height: gif.height || null } : null, at: new Date().toISOString(), likes: [] });
    if (!story.viewers.some((v) => v.userId === me.id) && story.userId !== me.id) story.viewers.push({ userId: me.id, at: new Date().toISOString() });
    save("stories");
    if (story.userId !== me.id) notify(story.userId, "story-comment", me, { text: text || "commented with a GIF", storyId: story.id });
    tellWatchers();
    sendJSON(res, 201, { comments: commentsOf() });
    return true;
  }
  const comment = parts[2] === "comments" && parts[3] ? (story.comments || []).find((c) => c.id === parts[3]) : null;
  if (parts[2] === "comments" && parts[3] && !comment) throw httpError(404, "That comment is gone.");
  // Like a comment: POST /api/stories/:id/comments/:cid/like
  if (m === "POST" && comment && parts[4] === "like") {
    comment.likes = comment.likes || [];
    if (comment.likes.includes(me.id)) comment.likes = comment.likes.filter((x) => x !== me.id); else comment.likes.push(me.id);
    save("stories");
    sendJSON(res, 200, { likes: comment.likes.length, liked: comment.likes.includes(me.id) });
    return true;
  }
  // Delete: DELETE /api/stories/:id/comments/:cid  (mine, or any on my story)
  if (m === "DELETE" && comment && parts.length === 4) {
    if (comment.userId !== me.id && story.userId !== me.id) throw httpError(403, "You can only delete your own comments.");
    story.comments = story.comments.filter((c) => c !== comment);
    save("stories");
    tellWatchers();
    sendJSON(res, 200, { comments: commentsOf() });
    return true;
  }

  // Delete mine: DELETE /api/stories/:id  (also leaves any highlight it was in)
  if (m === "DELETE" && parts.length === 2) {
    if (story.userId !== me.id) throw httpError(403, "You can only delete your own stories.");
    dropMedia(story);
    db.stories = db.stories.filter((s) => s !== story);
    save("stories");
    for (const hl of highlightsOf(me.id).filter((x) => x.storyIds.includes(story.id))) {
      hl.storyIds = hl.storyIds.filter((id) => id !== story.id);
      if (!hl.storyIds.length) deleteHighlight(hl);
    }
    save("highlights");
    sendJSON(res, 200, { ok: true });
    return true;
  }
  return false;
}

// Title, stories and cover of a highlight (only my own stories)
function applyHighlight(hl, body, me) {
  if (body.title !== undefined) {
    const title = clean(body.title).replace(/\s+/g, " ");
    if (chars(title) > 20) throw httpError(400, "Keep the title under 20 characters.");
    hl.title = title || "Highlights";
  }
  const mineIds = new Set(db.stories.filter((s) => s.userId === me.id).map((s) => s.id));
  if (Array.isArray(body.storyIds)) hl.storyIds = [...new Set(body.storyIds.map(String))].filter((id) => mineIds.has(id)).slice(0, 100);
  if (body.add && mineIds.has(body.add) && !hl.storyIds.includes(body.add)) hl.storyIds.push(body.add);
  if (body.remove) hl.storyIds = hl.storyIds.filter((id) => id !== body.remove);
  // Keep them in the order they were posted
  const at = (id) => db.stories.find((s) => s.id === id)?.createdAt || "";
  hl.storyIds.sort((a, b) => at(a).localeCompare(at(b)));
  if (body.coverImage) {
    const img = ownedMedia(body.coverImage, me.id, "image");
    if (!img) throw httpError(400, "That photo couldn’t be found. Add it again.");
    if (hl.cover?.own) deleteMedia(hl.cover.url);
    markUsed(img.url, "highlight:" + hl.id);
    hl.cover = { url: img.url, own: true };
  } else if (body.coverStoryId && hl.storyIds.includes(body.coverStoryId)) {
    if (hl.cover?.own) deleteMedia(hl.cover.url);
    const s = db.stories.find((x) => x.id === body.coverStoryId);
    hl.cover = { url: s.media.kind === "video" ? s.media.poster || null : s.media.url, storyId: s.id };
  }
}
function deleteHighlight(hl) {
  if (hl.cover?.own) deleteMedia(hl.cover.url);
  db.highlights = (db.highlights || []).filter((x) => x !== hl);
  save("highlights");
}

module.exports = { handleStories, storyState, storyPreview, REACTIONS };
