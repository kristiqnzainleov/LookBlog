// "For you": recommends videos, shorts and posts.
// Each candidate gets a score from:
//   - people you like: authors you watch, like, Cool, reply to or follow
//   - topics you like: words from the titles and text of what you engaged with
//   - people like you: what was liked by people who like the same things as you
//   - quality: likes, Cools, replies, reposts per view, and how much of a video people watch
//   - freshness: newer is better, slowly fading over a few days
// Things you already watched sink, and one author can't fill the whole list.

const { db, findUser } = require("./db");

const STOP = new Set("the a an and or but of to in on at for with is are was were be been this that it its my your our their i you we they he she me so if as by from just not no yes do did does have has had will can what when how why who all one out up about more very really get got like".split(" "));
const words = (t) => String(t || "").toLowerCase().match(/[\p{L}\p{N}#]{3,}/gu)?.filter((w) => !STOP.has(w)) || [];
const textOf = (p) => `${p.title || ""} ${p.text || ""} ${p.film?.genre || ""}`;

function profileOf(me) {
  const authors = new Map(), topics = new Map(), liked = new Set(), seen = new Set();
  const add = (m, k, n) => k && m.set(k, (m.get(k) || 0) + n);
  for (const id of me.following) add(authors, id, 3);
  const engage = (p, n) => {
    add(authors, p.userId, n);
    for (const w of new Set(words(textOf(p)))) add(topics, w, n);
  };
  for (const p of db.posts) {
    if (p.userId === me.id) { for (const w of new Set(words(textOf(p)))) add(topics, w, 0.5); continue; }
    if (p.viewedBy.includes(me.id)) { seen.add(p.id); engage(p, 1); }
    if (p.likes.includes(me.id)) { liked.add(p.id); engage(p, 3); }
    if (p.cools.includes(me.id)) { liked.add(p.id); engage(p, 4); }
    if (p.dislikes.includes(me.id)) engage(p, -4);
    if (p.reposts.some((r) => r.userId === me.id)) { liked.add(p.id); engage(p, 4); }
  }
  for (const c of db.comments) if (c.userId === me.id) { const p = db.posts.find((x) => x.id === c.postId); if (p && p.userId !== me.id) engage(p, 3); }
  // Recently watched counts more
  for (const [i, h] of (me.history || []).slice(0, 50).entries()) {
    const p = db.posts.find((x) => x.id === h.postId);
    if (p && p.userId !== me.id) engage(p, 2 * (1 - i / 60));
  }
  // People like you: others who liked what you liked
  const twins = new Map();
  for (const id of liked) {
    const p = db.posts.find((x) => x.id === id);
    for (const u of [...p.likes, ...p.cools]) if (u !== me.id) add(twins, u, 1);
  }
  return { authors, topics, seen, twins };
}

function quality(p) {
  const views = p.viewedBy.length;
  const eng = p.likes.length + p.cools.length * 2 + (p.commentCount || 0) * 2 + p.reposts.length * 3 - p.dislikes.length * 2;
  let q = Math.log1p(Math.max(0, eng)) + (eng / (views + 5)) * 3;
  const w = p.watch;
  if (w && w.plays) q += (w.completes / w.plays) * 2;
  return q;
}

/*
  recommend(me, { type, limit, seed, skip })
  type: "video" | "short" | "post" | null (all) · seed: a post to stay close to (Up next)
  Returns [{ post, score, reason }]
*/
function recommend(me, { type = null, limit = 20, seed = null, skip = [] } = {}) {
  const { authors, topics, seen, twins } = profileOf(me);
  const seedWords = seed ? new Set(words(textOf(seed))) : null;
  const skipSet = new Set(skip);
  const blocked = (u) => u && ((me.blocked || []).includes(u.id) || (u.blocked || []).includes(me.id));
  const now = Date.now();
  const out = [];
  for (const p of db.posts) {
    if (p.userId === me.id || p.visibility !== "public" || skipSet.has(p.id) || (seed && p.id === seed.id)) continue;
    if (type && p.type !== type) continue;
    if (type === "video" && require("./social").notPlainVideo(p)) continue;
    const author = findUser(p.userId);
    if (!author || blocked(author)) continue;
    if (author.private && !me.following.includes(author.id)) continue;
    const pw = new Set(words(textOf(p)));
    let topic = 0;
    for (const w of pw) topic += topics.get(w) || 0;
    topic = Math.log1p(Math.max(0, topic));
    const aff = Math.log1p(Math.max(0, authors.get(p.userId) || 0));
    let twin = 0;
    for (const u of [...p.likes, ...p.cools]) twin += twins.get(u) || 0;
    twin = Math.log1p(twin);
    const ageH = (now - new Date(p.createdAt).getTime()) / 3600000;
    const fresh = Math.exp(-ageH / 96);
    let seedSim = 0;
    if (seedWords) { for (const w of pw) if (seedWords.has(w)) seedSim++; if (seed.userId === p.userId) seedSim += 2; }
    let score = aff * 2.2 + topic * 1.4 + twin * 1.6 + quality(p) * 1.2 + fresh * 2 + seedSim * 1.5;
    if (seen.has(p.id)) score *= 0.3;
    if ((authors.get(p.userId) || 0) < 0) score *= 0.4;
    const parts = [["aff", aff * 2.2], ["topic", topic * 1.4], ["twin", twin * 1.6], ["seed", seedSim * 1.5], ["fresh", fresh * 2], ["quality", quality(p) * 1.2]];
    const top = parts.sort((a, b) => b[1] - a[1])[0][0];
    const reason = top === "aff" ? (me.following.includes(p.userId) ? `From @${author.username}, who you follow` : `You often watch @${author.username}`)
      : top === "topic" ? "Similar to what you like"
      : top === "twin" ? "Liked by people with your taste"
      : top === "seed" ? "Related to what you’re watching"
      : top === "fresh" ? "New on LookBlog" : "Popular right now";
    out.push({ post: p, score, reason });
  }
  out.sort((a, b) => b.score - a.score);
  // Variety: at most 2 from the same person in a row of results
  const per = new Map(), picked = [], rest = [];
  for (const x of out) {
    const n = per.get(x.post.userId) || 0;
    if (n < 2) { picked.push(x); per.set(x.post.userId, n + 1); } else rest.push(x);
    if (picked.length >= limit) break;
  }
  return picked.length < limit ? [...picked, ...rest].slice(0, limit) : picked;
}

module.exports = { recommend };
