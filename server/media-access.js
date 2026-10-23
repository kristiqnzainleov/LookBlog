// Who may open an uploaded file (GET /media/<file>). A file is as private as the thing it's attached to:
// a message → the people who can read that chat; a post or a reply → whoever can see the post (public posts
// of public profiles also without an account, for link previews); a story → its owner, followers and people
// tagged in it (public profiles: everyone, like their shared stories). Avatars, banners, stickers, group
// covers and the like are shown everywhere, so they're public. viewer is null when nobody is logged in.
const { db, findUser } = require("./db");

const findChat = (id) => db.chats.find((c) => c.id === id);
const follows = (viewer, owner) => Boolean(viewer && owner && (viewer.id === owner.id || (viewer.following || []).includes(owner.id)));
const profileOpen = (owner, viewer) => Boolean(owner && !owner.banned && (!owner.private || follows(viewer, owner)));

function postVisible(post, viewer) {
  if (!post) return false;
  if (viewer) return require("./social").canView(post, viewer);
  const author = findUser(post.userId);
  return post.visibility !== "private" && profileOpen(author, null);
}
function chatReadable(chat, viewer) {
  if (!chat || !viewer) return false;
  if ((chat.members || []).includes(viewer.id)) return true;
  return chat.kind === "group" && chat.visibility !== "private";
}
const blocked = (a, b) => Boolean(a && b && a.id !== b.id && ((a.blocked || []).includes(b.id) || (b.blocked || []).includes(a.id)));
// A story's files: like the story itself — for 24 hours (or while it's in a highlight), never across a block
function storyVisible(story, viewer) {
  if (!story) return false;
  const owner = findUser(story.userId);
  if (!owner || owner.banned) return false;
  if (viewer && viewer.id === owner.id) return true; // (their own archive)
  const live = Date.now() - new Date(story.createdAt).getTime() < 24 * 60 * 60 * 1000;
  const inHighlight = (db.highlights || []).some((h) => (h.storyIds || []).includes(story.id));
  if (!live && !inHighlight) return false;
  if (blocked(owner, viewer)) return false;
  if (viewer && (story.tags || []).includes(viewer.id)) return true;
  return profileOpen(owner, viewer);
}

function mediaAllowed(meta, viewer) {
  const used = String(meta.usedBy || "");
  if (!used) return Boolean(viewer && viewer.id === meta.ownerId); // not posted yet: only the person who uploaded it
  const cut = used.indexOf(":");
  const kind = cut < 0 ? used : used.slice(0, cut), id = cut < 0 ? "" : used.slice(cut + 1);
  switch (kind) {
    case "message": {
      const msg = db.messages.find((m) => m.id === id);
      return Boolean(msg && chatReadable(findChat(msg.chatId), viewer));
    }
    case "wallpaper": return chatReadable(findChat(id), viewer);
    case "post": return postVisible(db.posts.find((p) => p.id === id), viewer);
    case "comment": {
      const c = db.comments.find((x) => x.id === id);
      return Boolean(c && postVisible(db.posts.find((p) => p.id === c.postId), viewer));
    }
    case "story":
    case "story-comment": return storyVisible(db.stories.find((s) => s.id === id), viewer);
    case "highlight": {
      const hl = (db.highlights || []).find((h) => h.id === id);
      const owner = hl && findUser(hl.userId);
      return Boolean(owner && !blocked(owner, viewer) && profileOpen(owner, viewer));
    }
    case "instant": case "note": case "notesong": return Boolean(viewer); // for people on LookBlog
    default: return true; // avatars, banners, covers, stickers, GIFs, sounds, songs, albums, events, badges, lives
  }
}

module.exports = { mediaAllowed };
