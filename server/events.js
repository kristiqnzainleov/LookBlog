// Public events: anyone can find them, join, and talk in the event's discussion.
// The host adds a cover, a photo, a time and a place, and anyone can share the event to a group or chat.

const crypto = require("crypto");
const { db, save, findUser } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { ownedMedia, markUsed, deleteMedia } = require("./media");
const { broadcast, sendTo } = require("./realtime");
const { notify } = require("./notifications");
const { authorView, clean, chars, blockedBetween } = require("./social");
const { every } = require("./ticker");

const SOON_MS = 6 * 3600 * 1000; // events stay "upcoming" for a few hours after they start

function eventView(ev, me, { full = false } = {}) {
  const host = findUser(ev.hostId);
  const out = {
    id: ev.id, title: ev.title, description: ev.description, cover: ev.cover, photo: ev.photo,
    startsAt: ev.startsAt, endsAt: ev.endsAt || null, location: ev.location || "", geo: ev.geo || null,
    host: authorView(host), isHost: ev.hostId === me.id,
    going: ev.going.length, mine: ev.going.includes(me.id),
    goingPeople: ev.going.slice(-8).reverse().map(findUser).filter(Boolean).map(authorView),
    posts: ev.posts.length, shares: ev.shares || 0, createdAt: ev.createdAt,
  };
  if (full) {
    out.posts = ev.posts.filter((p) => !blockedBetween(findUser(p.userId), me)).slice(-100).map((p) => postView(ev, p, me));
    out.attendees = ev.going.map(findUser).filter(Boolean).slice(0, 60).map(authorView);
  }
  return out;
}
function postView(ev, p, me) {
  return { id: p.id, text: p.text, author: authorView(findUser(p.userId)), createdAt: p.createdAt, canDelete: p.userId === me.id || ev.hostId === me.id, isHost: p.userId === ev.hostId };
}
const visible = (ev, me) => !blockedBetween(findUser(ev.hostId), me);

function readEvent(body, me, current = null) {
  const title = clean(body.title).replace(/\s+/g, " ");
  const description = clean(body.description);
  const location = clean(body.location).replace(/\s+/g, " ");
  if (!title) throw httpError(400, "Give the event a name.");
  if (chars(title) > 90) throw httpError(400, "Keep the name under 90 characters.");
  if (chars(description) > 3000) throw httpError(400, "Keep the description under 3000 characters.");
  if (chars(location) > 120) throw httpError(400, "Keep the place under 120 characters.");
  const when = new Date(body.startsAt);
  if (isNaN(when)) throw httpError(400, "Pick a date and time.");
  if (!current && when.getTime() < Date.now() - 60 * 1000) throw httpError(400, "Pick a time in the future.");
  let endsAt = null;
  if (body.endsAt) {
    const e = new Date(body.endsAt);
    if (isNaN(e) || e <= when) throw httpError(400, "The end has to be after the start.");
    endsAt = e.toISOString();
  }
  const pic = (value, now) => {
    if (value === null) return null;
    if (!value || value === now) return now || null;
    const ok = ownedMedia(value, me.id, "image");
    if (!ok) throw httpError(400, "That picture couldn’t be found. Try uploading it again.");
    return ok.url;
  };
  // The spot on the map (picked from a search or "use my location"), if any
  const lat = Number(body.geo?.lat), lng = Number(body.geo?.lng);
  const geo = body.geo && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : null;
  return { title, description, location, geo, startsAt: when.toISOString(), endsAt, cover: pic(body.cover, current?.cover), photo: pic(body.photo, current?.photo) };
}

async function handleEvents(req, res, url, me) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  const [a, b, c, d] = parts;
  if (a !== "public-events") return false;
  const m = req.method;

  // List: GET /api/public-events?scope=upcoming|going|hosting|past
  if (m === "GET" && parts.length === 1) {
    const scope = url.searchParams.get("scope") || "upcoming";
    const now = Date.now();
    let list = db.events.filter((ev) => visible(ev, me));
    if (scope === "going") list = list.filter((ev) => ev.going.includes(me.id) && new Date(ev.startsAt).getTime() > now - SOON_MS);
    else if (scope === "hosting") list = list.filter((ev) => ev.hostId === me.id);
    else if (scope === "past") list = list.filter((ev) => new Date(ev.startsAt).getTime() <= now - SOON_MS).reverse();
    else list = list.filter((ev) => new Date(ev.startsAt).getTime() > now - SOON_MS);
    if (scope !== "past") list.sort((x, y) => x.startsAt.localeCompare(y.startsAt));
    sendJSON(res, 200, { events: list.slice(0, 60).map((ev) => eventView(ev, me)) });
    return true;
  }

  // Create: POST /api/public-events { title, description, cover, photo, startsAt, endsAt, location }
  if (m === "POST" && parts.length === 1) {
    rateLimit("event:" + me.id, 10, 60 * 60 * 1000, "You’ve made a lot of events. Try again later.");
    const data = readEvent(await readJSON(req), me);
    const ev = { id: crypto.randomUUID().slice(0, 12), hostId: me.id, ...data, going: [me.id], posts: [], shares: 0, createdAt: new Date().toISOString() };
    if (ev.cover) markUsed(ev.cover, "event:" + ev.id);
    if (ev.photo) markUsed(ev.photo, "eventphoto:" + ev.id);
    db.events.push(ev);
    save("events");
    // Followers hear about it
    for (const u of db.users) if (u.following.includes(me.id)) notify(u.id, "public-event", me, { text: ev.title, eventId: ev.id });
    sendJSON(res, 201, { event: eventView(ev, me, { full: true }) });
    return true;
  }

  const ev = b && db.events.find((x) => x.id === b);
  if (!ev || !visible(ev, me)) throw httpError(404, "This event doesn’t exist anymore.");

  // One event: GET /api/public-events/:id
  if (m === "GET" && parts.length === 2) {
    sendJSON(res, 200, { event: eventView(ev, me, { full: true }) });
    return true;
  }
  // Edit: POST /api/public-events/:id   ·   Delete: DELETE /api/public-events/:id   (host only)
  if ((m === "POST" || m === "DELETE") && parts.length === 2) {
    if (ev.hostId !== me.id) throw httpError(403, "Only the host can change this event.");
    if (m === "DELETE") {
      db.events = db.events.filter((x) => x !== ev);
      if (ev.cover) deleteMedia(ev.cover);
      if (ev.photo) deleteMedia(ev.photo);
      save("events");
      for (const id of ev.going) if (id !== me.id) notify(id, "public-event-cancelled", me, { text: ev.title });
      sendJSON(res, 200, { ok: true });
      return true;
    }
    const data = readEvent(await readJSON(req), me, ev);
    if (ev.cover && ev.cover !== data.cover) deleteMedia(ev.cover);
    if (ev.photo && ev.photo !== data.photo) deleteMedia(ev.photo);
    if (data.cover && data.cover !== ev.cover) markUsed(data.cover, "event:" + ev.id);
    if (data.photo && data.photo !== ev.photo) markUsed(data.photo, "eventphoto:" + ev.id);
    Object.assign(ev, data);
    ev.reminded = false;
    save("events");
    broadcast({ type: "public-event", id: ev.id });
    sendJSON(res, 200, { event: eventView(ev, me, { full: true }) });
    return true;
  }
  // Join / leave: POST /api/public-events/:id/join
  if (m === "POST" && c === "join" && parts.length === 3) {
    if (ev.hostId === me.id) throw httpError(400, "You’re hosting this event.");
    const joining = !ev.going.includes(me.id);
    ev.going = joining ? [...ev.going, me.id] : ev.going.filter((id) => id !== me.id);
    save("events");
    if (joining) notify(ev.hostId, "public-event-join", me, { text: ev.title, eventId: ev.id });
    broadcast({ type: "public-event", id: ev.id });
    sendJSON(res, 200, { event: eventView(ev, me) });
    return true;
  }
  // Discussion: POST /api/public-events/:id/posts { text }   ·   DELETE /api/public-events/:id/posts/:postId
  if (c === "posts" && m === "POST" && parts.length === 3) {
    rateLimit("eventpost:" + me.id, 60, 10 * 60 * 1000, "Slow down a little.");
    const text = clean((await readJSON(req)).text);
    if (!text) throw httpError(400, "Write something first.");
    if (chars(text) > 1000) throw httpError(400, "Keep it under 1000 characters.");
    const p = { id: crypto.randomUUID().slice(0, 12), userId: me.id, text, createdAt: new Date().toISOString() };
    ev.posts.push(p);
    save("events");
    if (ev.hostId !== me.id) notify(ev.hostId, "public-event-post", me, { text, eventId: ev.id });
    broadcast({ type: "public-event:post", id: ev.id, postId: p.id });
    sendJSON(res, 201, { post: postView(ev, p, me) });
    return true;
  }
  if (c === "posts" && m === "DELETE" && d && parts.length === 4) {
    const p = ev.posts.find((x) => x.id === d);
    if (!p) throw httpError(404, "That’s already gone.");
    if (p.userId !== me.id && ev.hostId !== me.id) throw httpError(403, "You can’t delete that.");
    ev.posts = ev.posts.filter((x) => x !== p);
    save("events");
    broadcast({ type: "public-event:post", id: ev.id, deleted: p.id });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Shared somewhere (a group or a chat): POST /api/public-events/:id/shared
  if (m === "POST" && c === "shared" && parts.length === 3) {
    ev.shares = (ev.shares || 0) + 1;
    save("events");
    sendJSON(res, 200, { shares: ev.shares });
    return true;
  }
  return false;
}

// Remind people who are going, 15 minutes before
every(() => {
  const now = Date.now();
  let changed = false;
  for (const ev of db.events) {
    const t = new Date(ev.startsAt).getTime();
    if (ev.reminded || t > now + 15 * 60 * 1000 || t < now - 30 * 60 * 1000) continue;
    ev.reminded = true;
    changed = true;
    const host = findUser(ev.hostId);
    if (host) for (const id of ev.going) notify(id, "public-event-start", host, { text: ev.title, eventId: ev.id });
  }
  // When it starts: the people going, and the host's followers
  for (const ev of db.events) {
    const t = new Date(ev.startsAt).getTime();
    if (ev.startNotified || t > now || t < now - 60 * 60 * 1000) continue;
    ev.startNotified = true;
    changed = true;
    const host = findUser(ev.hostId);
    if (!host) continue;
    const who = new Set([...ev.going, ...db.users.filter((u) => u.following.includes(host.id)).map((u) => u.id)]);
    for (const id of who) notify(id, "public-event-now", host, { text: ev.title, eventId: ev.id });
    sendTo([...who], { type: "event:now", title: ev.title, eventId: ev.id });
  }
  if (changed) save("events");
}, 60 * 1000).unref();

module.exports = { handleEvents, eventView };
