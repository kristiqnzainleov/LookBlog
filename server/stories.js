// Stories: a photo or short video that disappears after 24 hours. Seen by you and your followers.
const crypto = require("crypto");
const { db, save, findUser } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { markUsed, deleteMedia } = require("./media");
const { sendTo } = require("./realtime");
const { buildMedia, authorView, clean, chars } = require("./social");
const { every } = require("./ticker");

const DAY = 24 * 60 * 60 * 1000;
const live = (s) => Date.now() - new Date(s.createdAt).getTime() < DAY;
const canSee = (owner, me) => owner.id === me.id || me.following.includes(owner.id);

function storyView(s, me) {
  const out = {
    id: s.id,
    media: s.media,
    text: s.text,
    createdAt: s.createdAt,
    expiresAt: new Date(new Date(s.createdAt).getTime() + DAY).toISOString(),
    seen: s.viewers.some((v) => v.userId === me.id),
    mine: s.userId === me.id,
  };
  if (s.userId === me.id) {
    out.viewers = s.viewers.slice().reverse().map((v) => ({ ...authorView(findUser(v.userId)), at: v.at }));
  }
  return out;
}

// Throw away expired stories (and their files) every 10 minutes
function sweep() {
  const old = db.stories.filter((s) => !live(s));
  if (!old.length) return;
  for (const s of old) { deleteMedia(s.media.url); if (s.media.poster) deleteMedia(s.media.poster); }
  db.stories = db.stories.filter(live);
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

async function handleStories(req, res, url, me) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  if (parts[0] !== "stories") return false;
  const m = req.method;

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

  // One person's stories: GET /api/stories/user/:username
  if (m === "GET" && parts[1] === "user" && parts.length === 3) {
    const u = db.users.find((x) => x.username.toLowerCase() === decodeURIComponent(parts[2]).toLowerCase());
    if (!u || !canSee(u, me)) throw httpError(404, "No stories here.");
    const list = db.stories.filter((s) => s.userId === u.id && live(s)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    sendJSON(res, 200, { group: { user: authorView(u), isMe: u.id === me.id, stories: list.map((s) => storyView(s, me)) } });
    return true;
  }

  // Post one: POST /api/stories { media, text }
  if (m === "POST" && parts.length === 1) {
    rateLimit("story:" + me.id, 30, 60 * 60 * 1000, "You’ve posted a lot of stories. Try again later.");
    const body = await readJSON(req);
    if (!body.media) throw httpError(400, "Add a photo or a video.");
    const media = buildMedia(body.media, me);
    if (media.kind === "audio") throw httpError(400, "Add a photo or a video.");
    if (media.kind === "video" && media.duration && media.duration > 60.5) throw httpError(400, "Story videos can be up to 60 seconds.");
    const text = clean(body.text);
    if (chars(text) > 120) throw httpError(400, "Keep the text under 120 characters.");
    const story = { id: crypto.randomUUID(), userId: me.id, media, text, createdAt: new Date().toISOString(), viewers: [] };
    db.stories.push(story);
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

  const story = parts[1] && db.stories.find((s) => s.id === parts[1] && live(s));
  if (!story) throw httpError(404, "This story is gone.");
  const owner = findUser(story.userId);
  if (!owner || !canSee(owner, me)) throw httpError(404, "This story is gone.");

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

  // Delete mine: DELETE /api/stories/:id
  if (m === "DELETE" && parts.length === 2) {
    if (story.userId !== me.id) throw httpError(403, "You can only delete your own stories.");
    db.stories = db.stories.filter((s) => s !== story);
    deleteMedia(story.media.url);
    if (story.media.poster) deleteMedia(story.media.poster);
    save("stories");
    sendJSON(res, 200, { ok: true });
    return true;
  }
  return false;
}

module.exports = { handleStories, storyState };
