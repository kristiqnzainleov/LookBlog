// Voice channels in groups. Everyone in a channel connects to everyone else (WebRTC);
// the server keeps the list of who is in which channel and passes the set-up messages along.
// Who is in a channel (and its music) lives in db.voice, so every server sees the same rooms
// (online several servers answer requests, and they sleep in between).

const { db, save, findUser, findByUsername } = require("./db");
const { sendJSON, httpError, readJSON, rateLimit } = require("./http");
const { sendTo } = require("./realtime");
const VOICE_REACTIONS = ["❤️", "😂", "🔥", "👏", "😮", "😢", "💯", "🎉", "👀", "🤯"];
const { can, rank } = require("./groups");
const BUILTIN_SOUNDS = ["airhorn", "tada", "drum", "boing", "ding", "sad"];

// db.voice["chatId:channelId"] = { members: { userId: { muted, deaf, video, screen, seen } }, music }
const STALE_MS = 45 * 1000; // no heartbeat for this long = gone
const roomAt = (key) => db.voice[key]?.members || null;
const roomIds = (key) => Object.keys(roomAt(key) || {});
const whereIs = (userId) => Object.keys(db.voice).find((k) => db.voice[k].members?.[userId]) || null;
const music = {
  get: (key) => db.voice[key]?.music || undefined,
  set: (key, m) => { if (db.voice[key]) { db.voice[key].music = m; save("voice"); } },
  delete: (key) => { if (db.voice[key]?.music) { db.voice[key].music = null; save("voice"); } },
};

/* ---------- Music in a voice channel ----------
   Everyone's browser plays the same thing at the same spot (a LookBlog song or a YouTube video);
   the server keeps what's playing, from when, and the queue. Each person sets their own volume. */
const YT_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/;
async function youtubeInfo(url) {
  const m = String(url || "").match(YT_RE);
  if (!m) return null;
  const id = m[1];
  let title = "YouTube video", thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`, { signal: ac.signal });
    clearTimeout(t);
    if (r.ok) { const d = await r.json(); title = String(d.title || title).slice(0, 120); thumb = d.thumbnail_url || thumb; }
  } catch {}
  return { kind: "youtube", ref: id, title, thumb, duration: null };
}
function musicView(key) {
  const m = music.get(key);
  if (!m || !m.now) return null;
  return { now: m.now, startedAt: m.startedAt, pausedAt: m.pausedAt, queue: m.queue, volume: m.volume ?? 70, rate: m.rate || 1, loop: m.loop || null, mix: m.mix || null, levels: m.levels || null, bass: m.bass || 0, fx: m.fx || null, changedBy: m.changedBy || null, serverNow: Date.now() };
}
function sendMusic(chat, channelId) {
  const key = chat.id + ":" + channelId;
  const ids = roomIds(key);
  if (ids.length) sendTo(ids, { type: "voice:music", chatId: chat.id, channelId, music: musicView(key) });
}
function playNext(key) {
  const m = music.get(key);
  if (!m) return;
  m.now = m.queue.shift() || null;
  m.startedAt = Date.now(); m.pausedAt = null; m.rate = 1; m.loop = null; m.mix = null;
  if (!m.now) music.delete(key);
  else save("voice");
}

// Watch together: what's playing in a channel
// Only the people it was started with see it (and the one who started it)
const watchView = (key, me) => {
  const w = db.voice[key]?.watch;
  if (!w || (me && w.with && !w.with.includes(me.username))) return null;
  return { ...w, withNames: (w.with || []).map((u) => { const x = findByUsername(u); return x ? { username: x.username, name: x.name } : null; }).filter(Boolean) };
};
// A YouTube / YouTube Shorts / TikTok link → { provider, id, kind }
async function parseVideo(url) {
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const yt = /^[\w-]{11}$/;
  if (host === "youtu.be") { const id = u.pathname.slice(1, 12); return yt.test(id) ? { provider: "youtube", id, kind: "video" } : null; }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const short = u.pathname.match(/^\/shorts\/([\w-]{11})/);
    if (short) return { provider: "youtube", id: short[1], kind: "short" };
    const embed = u.pathname.match(/^\/(?:embed|live|v)\/([\w-]{11})/);
    if (embed) return { provider: "youtube", id: embed[1], kind: "video" };
    const id = u.searchParams.get("v");
    return id && yt.test(id) ? { provider: "youtube", id, kind: "video" } : null;
  }
  // (exactly tiktok.com or one of its subdomains: not "eviltiktok.com"), and only https on the normal port
  if ((host === "tiktok.com" || host.endsWith(".tiktok.com")) && u.protocol === "https:" && !u.port && !u.username && !u.password) {
    let m = u.pathname.match(/\/video\/(\d{8,25})/) || u.pathname.match(/\/player\/v1\/(\d{8,25})/);
    if (!m && (host === "vm.tiktok.com" || host === "vt.tiktok.com" || (host === "tiktok.com" && u.pathname.startsWith("/t/")))) {
      // A short share link: follow it to the real one
      try {
        const r = await fetch(u.href, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 LookBlog" }, signal: AbortSignal.timeout(6000) });
        const to = r.headers.get("location") || "";
        m = to.match(/\/video\/(\d{8,25})/);
      } catch {}
    }
    return m ? { provider: "tiktok", id: m[1], kind: "short" } : null;
  }
  return null;
}

function participants(chatId, channelId) {
  const room = roomAt(chatId + ":" + channelId);
  if (!room) return [];
  return Object.entries(room).map(([id, s]) => {
    const u = findUser(id);
    return u && { name: u.name, username: u.username, avatar: u.avatar, verified: Boolean(u.verified), verifiedType: u.verifiedType || null, muted: s.muted, deaf: s.deaf, video: s.video, screen: s.screen,
      ...(db.voice[chatId + ":" + channelId]?.dj?.username === u.username ? { dj: true } : {}) };
  }).filter(Boolean);
}

function announce(chat, channelId) {
  sendTo(chat.members, { type: "voice:state", chatId: chat.id, channelId, participants: participants(chat.id, channelId), status: db.voice[chat.id + ":" + channelId]?.status || null });
}

function leave(userId, chats) {
  const key = whereIs(userId);
  if (!key) return;
  delete db.voice[key].members[userId];
  if (db.voice[key].dj && findUser(userId)?.username === db.voice[key].dj.username) delete db.voice[key].dj;
  const left = roomIds(key);
  if (!left.length) delete db.voice[key];
  save("voice");
  const [chatId, channelId] = key.split(":");
  const chat = chats.find((c) => c.id === chatId);
  if (chat) {
    announce(chat, channelId);
    const u = findUser(userId);
    if (u && left.length) sendTo(left, { type: "voice:left", chatId, channelId, username: u.username });
  }
}

// POST /api/groups/:id/voice { kind: join|leave|ping|state|signal, channelId, to, data, muted, deaf, video, screen }
async function handleVoice(req, res, me, chat, chats) {
  if (!chat.members.includes(me.id)) throw httpError(403, "Join the group to use voice channels.");
  const body = await readJSON(req, 200_000);
  const channel = chat.channels.find((c) => c.id === body.channelId && c.kind === "voice");
  const key = channel ? chat.id + ":" + channel.id : null;

  if (body.kind === "join") {
    if (!channel) throw httpError(404, "That voice channel doesn’t exist.");
    rateLimit("voice:" + me.id, 60, 10 * 60 * 1000, "Slow down a little.");
    if (whereIs(me.id) !== key) leave(me.id, chats);
    if (!db.voice[key]) db.voice[key] = { members: {}, music: null };
    const room = db.voice[key].members;
    if (Object.keys(room).length >= 12 && !room[me.id]) throw httpError(400, "This voice channel is full (12 people).");
    const others = participants(chat.id, channel.id).filter((p) => p.username !== me.username);
    room[me.id] = { muted: Boolean(body.muted), deaf: false, video: false, screen: false, seen: Date.now() };
    save("voice");
    announce(chat, channel.id);
    // A secret topic for the fallback voice relay (when two people can't connect directly)
    const relayTopic = require("./store").enabled ? "vr-" + require("crypto").createHmac("sha256", process.env.SUPABASE_SERVICE_KEY || "lb").update("voice:" + key).digest("base64url").slice(0, 24) : null;
    sendJSON(res, 200, { participants: others, music: musicView(key), relayTopic, watch: watchView(key, me), dj: db.voice[key].dj || null, beat: db.voice[key].beat || null, beatMix: db.voice[key].beatMix || null, status: db.voice[key].status || null, now: Date.now() });
    return true;
  }
  if (body.kind === "leave") {
    leave(me.id, chats);
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Disconnect someone from the channel (needs "Remove people", and only people below you)
  if (body.kind === "kick") {
    const target = findByUsername(String(body.username || ""));
    const room = key && roomAt(key);
    if (!target || !room || !room[target.id]) throw httpError(404, "They’re not in this channel.");
    if (!can(chat, me, "kick") || rank(chat, target.id) >= rank(chat, me.id)) throw httpError(403, "You can’t disconnect them.");
    leave(target.id, chats);
    sendTo([target.id], { type: "voice:kicked", chatId: chat.id, by: me.name });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  const room = key && roomAt(key);
  if (!room || !room[me.id]) throw httpError(409, "You’re not in that voice channel.");
  const mine = room[me.id];
  // Heartbeat: written at most every 10 seconds
  if (Date.now() - (mine.seen || 0) > 10 * 1000) { mine.seen = Date.now(); save("voice"); }
  // The heartbeat also says who is in the channel, so a missed update fixes itself
  if (body.kind === "ping") { sendJSON(res, 200, { ok: true, participants: participants(chat.id, channel.id), watch: watchView(key, me), now: Date.now() }); return true; }
  if (body.kind === "state") {
    for (const k of ["muted", "deaf", "video", "screen"]) if (k in body) mine[k] = Boolean(body[k]);
    save("voice");
    announce(chat, channel.id);
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Music from someone's computer: the sound goes over voice (never uploaded); this only tells the channel what's playing
  if (body.kind === "localmusic") {
    rateLimit("localmusic:" + me.id, 60, 10 * 60 * 1000, "Slow down a little.");
    const title = body.title ? String(body.title).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 100) : null;
    sendTo(Object.keys(room), { type: "voice:localmusic", chatId: chat.id, channelId: channel.id, username: me.username, name: me.name, title });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Soundboard: everyone in the channel hears it
  if (body.kind === "sound") {
    rateLimit("sound:" + me.id, 20, 60 * 1000, "Easy on the sounds!");
    const snd = (chat.sounds || []).find((x) => x.id === body.soundId);
    const builtin = BUILTIN_SOUNDS.includes(body.builtin) ? body.builtin : null;
    if (!snd && !builtin) throw httpError(404, "That sound is gone.");
    sendTo(Object.keys(room), { type: "voice:sound", chatId: chat.id, channelId: channel.id, by: me.name, username: me.username, url: snd?.url || null, builtin, name: snd?.name || builtin, emoji: snd?.emoji || null });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Invite people from the group who aren't here: { kind: "invite", usernames: [...] }
  // They get a pop-up to join right away (and a notification, in case they're away).
  if (body.kind === "invite") {
    rateLimit("vinvite:" + me.id, 40, 10 * 60 * 1000, "You’ve sent a lot of invites. Wait a little.");
    const names = (Array.isArray(body.usernames) ? body.usernames : []).slice(0, 50).map(String);
    const invited = [];
    for (const n of names) {
      const u = findByUsername(n);
      if (!u || u.id === me.id || !chat.members.includes(u.id) || room[u.id]) continue;
      if ((u.blocked || []).includes(me.id) || (me.blocked || []).includes(u.id)) continue;
      sendTo([u.id], { type: "voice:invite", chatId: chat.id, channelId: channel.id, channel: channel.name, group: chat.name, color: chat.color || null,
        by: { name: me.name, username: me.username, avatar: me.avatar }, inside: Object.keys(room).length });
      require("./notifications").notify(u.id, "voice-invite", me, { chatId: chat.id, group: chat.name, text: `🔊 ${channel.name}` });
      invited.push(u.username);
    }
    sendJSON(res, 200, { invited });
    return true;
  }
  // Watch together: a YouTube video, YouTube Short or TikTok, in sync — only for the people it was started with.
  // { kind: "watch", action: "start", url, with: [usernames] } · { action: "add", with } (the one who started it)
  // · { action: "state", playing, pos } (anyone watching can play, pause or skip) · { action: "stop" }
  if (body.kind === "watch") {
    rateLimit("vwatch:" + me.id, 120, 60 * 1000, "Slow down a little.");
    const v = db.voice[key];
    const inRoom = new Set(Object.keys(room).map((id) => findUser(id)?.username).filter(Boolean));
    const pickWith = () => [...new Set((Array.isArray(body.with) ? body.with : []).map(String))].filter((u) => u !== me.username && inRoom.has(u)).slice(0, 12);
    const watching = v.watch && (!v.watch.with || v.watch.with.includes(me.username));
    const before = v.watch?.with || null;
    if (body.action === "start") {
      const chosen = pickWith();
      if (!chosen.length) throw httpError(400, "Pick at least one person in the voice channel to watch with.");
      const found = await parseVideo(String(body.url || ""));
      if (!found) throw httpError(400, "Paste a YouTube, YouTube Shorts or TikTok link.");
      v.watch = { ...found, by: me.username, byName: me.name, with: [me.username, ...chosen], playing: true, pos: 0, at: Date.now() };
    } else if (body.action === "add") {
      if (!v.watch) throw httpError(404, "Nothing is playing.");
      if (v.watch.by !== me.username) throw httpError(403, "Only the person who started it can add people.");
      const more = pickWith().filter((u) => !v.watch.with.includes(u));
      if (!more.length) throw httpError(400, "Pick someone who isn’t watching yet.");
      v.watch.with.push(...more);
    } else if (body.action === "state") {
      if (!watching) throw httpError(404, "Nothing is playing.");
      const pos = Number(body.pos);
      v.watch.playing = Boolean(body.playing);
      v.watch.pos = Number.isFinite(pos) && pos >= 0 ? Math.min(pos, 24 * 3600) : 0;
      v.watch.at = Date.now();
      v.watch.lastBy = me.username;
    } else if (body.action === "stop") {
      if (!watching) { sendJSON(res, 200, { ok: true }); return true; }
      if (v.watch.by !== me.username && !can(chat, me, "manage_group")) throw httpError(403, "Only the person who started it can stop it for everyone. You can close it for yourself.");
      delete v.watch;
    } else throw httpError(400, "Unknown action.");
    save("voice");
    // Tell only the people watching (and, when it stops, the ones who were)
    const audience = new Set([...(v.watch?.with || []), ...(before || [])]);
    const ids = Object.keys(room).filter((id) => audience.has(findUser(id)?.username));
    for (const id of ids) { const u = findUser(id); sendTo([id], { type: "voice:watch", chatId: chat.id, channelId: channel.id, watch: watchView(key, u), by: me.username, action: body.action, now: Date.now() }); }
    sendJSON(res, 200, { watch: watchView(key, me), now: Date.now() });
    return true;
  }
  // The channel's status (like Discord): { kind: "status", text }  — anyone in the channel; empty clears it
  if (body.kind === "status") {
    rateLimit("vstatus:" + me.id, 20, 60 * 1000, "Slow down a little.");
    const text = String(body.text || "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (text) db.voice[key].status = { text, by: me.username }; else delete db.voice[key].status;
    save("voice");
    announce(chat, channel.id);
    sendJSON(res, 200, { status: db.voice[key].status || null });
    return true;
  }
  // DJ mode: one DJ at a time; everyone hears what the DJ does.
  // { kind: "dj", action: "claim" | "release" | "fx" (fx) | "rate" (rate) | "cue" (at) | "loop" (seconds or 0) | "beat" (bpm or 0) }
  if (body.kind === "dj") {
    rateLimit("vdj:" + me.id, 240, 60 * 1000, "Easy, DJ!");
    const v = db.voice[key], a = body.action;
    const isDj = v.dj?.username === me.username;
    let extra = {};
    if (a === "claim") {
      if (v.dj && v.dj.username !== me.username && room[findByUsername(v.dj.username)?.id]) throw httpError(409, `@${v.dj.username} is the DJ right now.`);
      v.dj = { username: me.username, name: me.name };
    } else if (a === "release") {
      if (!isDj && !can(chat, me, "manage_group")) throw httpError(403, "Only the DJ can step down.");
      delete v.dj;
    } else {
      if (!isDj) throw httpError(403, "Only the DJ can do that. Take the decks first.");
      const m = music.get(key);
      const FX = ["airhorn", "siren", "scratch", "laser", "riser", "drop", "rewind", "clap", "brake", "fade", "fadein", "horn", "boom",
        "cheer", "whistle", "roll", "zap", "cymbal", "bassdrop", "backspin", "cut", "echo", "gong", "vinyl",
        "transform", "stutter", "dip", "build", "snare", "kick", "hat", "cowbell", "tom", "perc", "stab", "chord", "uplift", "downlift", "impact", "glitch", "dog", "bell", "phone", "reverse",
        "dubsiren", "police", "bomb", "explosion", "rimshot", "shaker", "conga", "triangle", "coin", "oneup", "pew", "heartbeat", "thunder", "wind", "alarm", "bleep",
        "subdrop", "zipper", "chopper", "ufo", "tapestop", "hey", "roll808", "hornstab", "kalimba", "lights", "strobe",
        "gate", "pump", "tremolo", "swell", "blackout", "halfvol"];
      const INSTRUMENTS = ["808", "synth", "pluck", "bell", "organ", "lead", "piano", "strings", "sub", "chip", "brass"];
      if (a === "fx" && body.fx === "custom") {
        // One of the DJ's own effects (an MP3 they uploaded)
        const pad = (me.djPads || []).find((x) => x.id === body.padId);
        if (!pad) throw httpError(404, "That effect is gone.");
        extra = { fx: "custom", url: pad.url, name: pad.name, emoji: pad.emoji, vol: pad.vol ?? 1 };
      } else if (a === "fx" && body.fx === "note") {
        // A note on the DJ's keys (808 bass, synth, pluck…): everyone's browser plays the same note
        const note = Math.round(Number(body.note));
        if (!(note >= 0 && note <= 24)) throw httpError(400, "Pick a key.");
        extra = { fx: "note", note, inst: INSTRUMENTS.includes(body.inst) ? body.inst : "synth" };
      } else if (a === "fx" && body.fx === "say") {
        // The MC: a short line everyone's browser says out loud
        rateLimit("vdj-say:" + me.id, 20, 60 * 1000, "Easy on the mic!");
        const text = String(body.text || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
        if (!text) throw httpError(400, "Type what to say.");
        extra = { fx: "say", text, voice: ["deep", "normal", "robot", "chipmunk"].includes(body.voice) ? body.voice : "deep" };
      } else if (a === "fx" && body.fx !== "synth") {
        if (!FX.includes(body.fx)) throw httpError(400, "Unknown effect.");
        extra = { fx: body.fx };
        if (body.fx === "brake" && m?.now && m.pausedAt == null) { m.pausedAt = (Date.now() - m.startedAt) * (m.rate || 1); music.set(key, m); sendMusic(chat, channel.id); }
        if (body.fx === "backspin" && m?.now) {
          // The record spins back a few seconds
          const rate = m.rate || 1, pos = m.pausedAt != null ? m.pausedAt : (Date.now() - m.startedAt) * rate, to = Math.max(0, pos - 4000);
          if (m.pausedAt != null) m.pausedAt = to; else m.startedAt = Date.now() - to / rate;
          m.loop = null; music.set(key, m); sendMusic(chat, channel.id);
        }
      } else if (a === "rate" || a === "cue" || a === "loop") {
        if (!m?.now) throw httpError(409, "Nothing is playing.");
        const rate = m.rate || 1;
        const pos = m.pausedAt != null ? m.pausedAt : (Date.now() - m.startedAt) * rate; // ms into the track now
        if (a === "rate") {
          const r = [0.5, 0.75, 0.9, 0.95, 1, 1.05, 1.1, 1.25, 1.5, 2].includes(Number(body.rate)) ? Number(body.rate) : 1;
          m.rate = r;
          if (m.pausedAt == null) m.startedAt = Date.now() - pos / r;
        } else if (a === "cue") {
          const at = Math.max(0, Number(body.at) || 0) * 1000;
          if (m.pausedAt != null) m.pausedAt = at; else m.startedAt = Date.now() - at / rate;
          m.loop = null;
        } else {
          const len = [0, 1, 2, 4, 8, 16].includes(Number(body.seconds)) ? Number(body.seconds) : 0;
          m.loop = len ? { start: pos / 1000, len } : null;
        }
        music.set(key, m);
        sendMusic(chat, channel.id);
      } else if (a === "mix") {
        // The crossfader between what's playing (deck A) and the next song in the queue (deck B): 0 = A, 1 = B
        if (!m?.now) throw httpError(409, "Nothing is playing.");
        const x = Math.max(0, Math.min(1, Number(body.x) || 0));
        if (!m.mix && x > 0) {
          if (!m.queue.length) throw httpError(400, "Queue a song first, then mix into it.");
          m.mix = { item: m.queue[0], startedAt: Date.now(), x };
        } else if (m.mix) m.mix.x = x;
        if (m.mix && x >= 1) {
          // All the way over: deck B is what's playing now
          m.now = m.mix.item; m.startedAt = m.mix.startedAt; m.pausedAt = null; m.rate = 1; m.loop = null;
          if (m.fx) m.fx = { ...m.fx, a: m.fx.b || { low: 0, mid: 0, high: 0, filter: 0 }, b: { low: 0, mid: 0, high: 0, filter: 0 } }; // deck B's EQ comes along
          m.queue = m.queue.filter((q) => q.id !== m.now.id);
          m.mix = null;
        } else if (m.mix && x <= 0) m.mix = null;
        music.set(key, m);
        sendMusic(chat, channel.id);
      } else if (a === "bass") {
        // Bass boost on the song (0–1): everyone's player boosts the low end, and the screen shakes with it
        if (!m?.now) throw httpError(409, "Nothing is playing.");
        m.bass = Math.max(0, Math.min(1, Number(body.amount) || 0));
        music.set(key, m);
        sendMusic(chat, channel.id);
        extra = { bass: m.bass };
      } else if (a === "fx" && body.fx === "synth") {
        // One of the DJ's own effects, made in the effect maker: everyone's browser builds the same sound
        const fx = (me.djFx || []).find((x) => x.id === body.padId);
        if (!fx) throw httpError(404, "That effect is gone.");
        extra = { fx: "synth", p: fx.p, name: fx.name, emoji: fx.emoji };
      } else if (a === "songfx") {
        // Effects on the song itself (LookBlog songs): each deck's EQ and filter, and flanger, phaser, drive, crush, echo, reverb, key lock
        if (!m?.now) throw httpError(409, "Nothing is playing.");
        const num = (x, lo, hi, d) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : d);
        const prev = m.fx || {};
        const deck = (q = {}, p = {}) => ({ low: num(q.low, -26, 12, p.low ?? 0), mid: num(q.mid, -26, 12, p.mid ?? 0), high: num(q.high, -26, 12, p.high ?? 0), filter: num(q.filter, -1, 1, p.filter ?? 0) });
        m.fx = { a: deck(body.a, prev.a), b: deck(body.b, prev.b),
          ...Object.fromEntries(["echo", "verb", "flanger", "phaser", "crush", "drive", "wah", "gate"].map((k) => [k, num(body[k], 0, 1, prev[k] ?? 0)])),
          keylock: typeof body.keylock === "boolean" ? body.keylock : prev.keylock ?? true };
        music.set(key, m);
        sendMusic(chat, channel.id);
      } else if (a === "levels") {
        // The mixer's channel faders for deck A and deck B (0–1, everyone hears it)
        if (!m?.now) throw httpError(409, "Nothing is playing.");
        const num = (x, d) => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(1, Number(x))) : d);
        m.levels = { a: num(body.a, m.levels?.a ?? 1), b: num(body.b, m.levels?.b ?? 1) };
        music.set(key, m);
        sendMusic(chat, channel.id);
      } else if (a === "beatmix") {
        // The drum machine's channel on the mixer: gain, EQ (low / mid / high) and a filter sweep
        const num = (x, lo, hi, d) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : d);
        const prev = v.beatMix || {};
        v.beatMix = { gain: num(body.gain, 0, 1.5, prev.gain ?? 1), low: num(body.low, -24, 12, prev.low ?? 0), mid: num(body.mid, -24, 12, prev.mid ?? 0),
          high: num(body.high, -24, 12, prev.high ?? 0), filter: num(body.filter, -1, 1, prev.filter ?? 0),
          echo: num(body.echo, 0, 1, prev.echo ?? 0), verb: num(body.verb, 0, 1, prev.verb ?? 0), crush: num(body.crush, 0, 1, prev.crush ?? 0), pan: num(body.pan, -1, 1, prev.pan ?? 0),
          drive: num(body.drive, 0, 1, prev.drive ?? 0), wobble: num(body.wobble, 0, 1, prev.wobble ?? 0), wobRate: [1, 2, 4].includes(Number(body.wobRate)) ? Number(body.wobRate) : prev.wobRate ?? 2 };
        extra = { beatMix: v.beatMix };
      } else if (a === "beat") {
        const bpm = Number(body.bpm) || 0;
        const PATTERNS = ["house", "hiphop", "techno", "trap", "dnb", "reggaeton", "disco", "afro", "garage", "funk", "jersey", "drill", "lofi", "custom",
          "amapiano", "dubstep", "breakbeat", "boombap", "phonk", "latin", "bigroom", "moombahton", "baile", "chalga", "trance", "electro"];
        // My own pattern from the step sequencer: 16 steps per drum, "x" = hit
        const ROWS = ["kick", "snare", "hat", "clap", "open", "perc"];
        let steps = null;
        if (body.pattern === "custom") {
          steps = {};
          for (const r of ROWS) steps[r] = String(body.steps?.[r] || "").replace(/[^x.]/g, ".").padEnd(16, ".").slice(0, 16);
        }
        const swing = Math.max(0, Math.min(0.5, Number(body.swing) || 0));
        v.beat = bpm >= 60 && bpm <= 200 ? { bpm: Math.round(bpm), pattern: PATTERNS.includes(body.pattern) ? body.pattern : "house", steps, swing, at: Date.now() } : null;
        if (!v.beat) delete v.beat;
        extra = { beat: v.beat || null };
      } else throw httpError(400, "Unknown DJ action.");
    }
    save("voice");
    sendTo(Object.keys(room), { type: "voice:dj", chatId: chat.id, channelId: channel.id, action: a, dj: v.dj || null, by: me.username, now: Date.now(), ...extra });
    if (a === "claim" || a === "release") announce(chat, channel.id);
    sendJSON(res, 200, { dj: v.dj || null, beat: v.beat || null, now: Date.now() });
    return true;
  }
  // A reaction while you talk: { kind: "react", emoji, to } — to someone's camera or screen (to = their username), or to the channel.
  // Everyone in the group sees it fly up (on the video, in the voice panel and in the channel list).
  if (body.kind === "react") {
    rateLimit("vreact:" + me.id, 30, 10 * 1000, "Easy on the reactions!");
    const emoji = String(body.emoji || "");
    if (!VOICE_REACTIONS.includes(emoji)) throw httpError(400, "Pick one of the reactions.");
    const target = body.to ? findByUsername(String(body.to)) : null;
    const to = target && room[target.id] ? target : null;
    sendTo(chat.members, { type: "voice:react", chatId: chat.id, channelId: channel.id, by: me.name, username: me.username, emoji, to: to?.username || null });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  // Music: { kind: "music", action: play|queue|pause|resume|skip|stop|ended|seek, songId | url, itemId, at }
  if (body.kind === "music") {
    rateLimit("vmusic:" + me.id, 40, 60 * 1000, "Slow down a little.");
    const m = music.get(key) || { now: null, startedAt: 0, pausedAt: null, queue: [], volume: db.voice[key]?.lastVolume ?? 70 };
    const a = body.action;
    m.changedBy = me.name;
    if (a === "play" || a === "queue") {
      let item = null;
      if (body.songId) {
        const sg = db.songs.find((x) => x.id === body.songId);
        if (!sg) throw httpError(404, "That song is gone.");
        const artist = findUser(sg.userId);
        item = { kind: "song", ref: sg.id, url: sg.url, title: sg.title, thumb: sg.cover || null, artist: artist?.name || "", duration: sg.duration || null };
      } else if (body.url) {
        item = await youtubeInfo(body.url);
        if (!item) throw httpError(400, "Paste a YouTube link (youtube.com/watch?v=… or youtu.be/…).");
      } else throw httpError(400, "Pick a song or paste a YouTube link.");
      item.id = Math.random().toString(36).slice(2, 10);
      me.voiceDJ = (me.voiceDJ || 0) + 1; require("./db").save("users");
      item.by = me.name; item.byUsername = me.username;
      if (a === "play" || !m.now) { m.now = item; m.startedAt = Date.now(); m.pausedAt = null; m.rate = 1; m.loop = null; }
      else { if (m.queue.length >= 30) throw httpError(400, "The queue is full."); m.queue.push(item); }
      music.set(key, m);
    } else if (!m.now) throw httpError(409, "Nothing is playing.");
    // (times are in the track: with the DJ's speed, the clock moves "rate" times faster)
    else if (a === "pause") { if (m.pausedAt == null) m.pausedAt = (Date.now() - m.startedAt) * (m.rate || 1); }
    else if (a === "resume") { if (m.pausedAt != null) { m.startedAt = Date.now() - m.pausedAt / (m.rate || 1); m.pausedAt = null; } }
    else if (a === "seek") { const at = Math.max(0, Number(body.at) || 0) * 1000; if (m.pausedAt != null) m.pausedAt = at; else m.startedAt = Date.now() - at / (m.rate || 1); m.loop = null; }
    else if (a === "skip") playNext(key);
    else if (a === "ended") { if (m.now.id === body.itemId) playNext(key); else { sendJSON(res, 200, { music: musicView(key) }); return true; } }
    else if (a === "stop") music.delete(key);
    else if (a === "volume") { m.volume = Math.max(0, Math.min(100, Math.round(Number(body.volume) || 0))); db.voice[key].lastVolume = m.volume; }
    else if (a === "unqueue") m.queue = m.queue.filter((x) => x.id !== body.itemId);
    else throw httpError(400, "Unknown music action.");
    save("voice");
    sendMusic(chat, channel.id);
    sendJSON(res, 200, { music: musicView(key) });
    return true;
  }
  if (body.kind === "signal") {
    const to = findByUsername(String(body.to || ""));
    if (!to || !room[to.id]) throw httpError(404, "They left the channel.");
    sendTo([to.id], { type: "voice:signal", chatId: chat.id, channelId: channel.id, from: me.username, data: body.data ?? null });
    sendJSON(res, 200, { ok: true });
    return true;
  }
  throw httpError(400, "Unknown voice step.");
}

// Drop people whose page stopped sending heartbeats (closed tab, lost connection)
function sweep(chats) {
  const now = Date.now();
  for (const key of Object.keys(db.voice)) for (const [id, s] of Object.entries(db.voice[key]?.members || {})) if (now - s.seen > STALE_MS) leave(id, chats);
}

module.exports = { handleVoice, participants, sweep, leaveVoice: leave };
