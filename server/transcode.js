// Video quality: makes smaller copies of uploaded videos (360p … 1080p) so viewers can pick one.
// Needs ffmpeg on the computer (macOS: `brew install ffmpeg`). Without it, videos play as uploaded.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { db, save, UPLOAD_DIR } = require("./db");
const { broadcast } = require("./realtime");
const store = require("./store");

const LADDER = [1080, 720, 480, 360];
function findFfmpeg() {
  for (const p of [process.env.FFMPEG_PATH, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "ffmpeg"]) {
    if (!p) continue;
    try { if (spawnSync(p, ["-version"], { timeout: 5000 }).status === 0) return p; } catch {}
  }
  return null;
}
let FFMPEG = store.enabled ? null : findFfmpeg(); // online the files are in Supabase Storage and there's no ffmpeg
const available = () => Boolean(FFMPEG);

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.split("\n").slice(-3).join(" ")))));
  });
}

let busy = false;
async function work() {
  if (busy || !FFMPEG) return;
  const post = db.posts.find((p) => (p.type === "video" || p.type === "short") && p.media[0]?.kind === "video" && !p.media[0].renditionsDone && !p.media[0].renditionsFailed);
  if (!post) return;
  busy = true;
  const m = post.media[0];
  try {
    const src = path.join(UPLOAD_DIR, m.url.replace("/media/", ""));
    const srcH = Math.min(m.width || 9999, m.height || 9999) || 1080; // the short side, so vertical videos work too
    m.renditions = m.renditions || [];
    for (const target of LADDER) {
      if (target >= srcH || m.renditions.some((r) => r.height === target)) continue;
      const name = crypto.randomUUID() + ".mp4";
      const out = path.join(UPLOAD_DIR, name);
      const scale = (m.width || 0) >= (m.height || 0) ? `scale=-2:${target}` : `scale=${target}:-2`;
      await run(["-y", "-i", src, "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out]);
      db.uploads[name] = { ownerId: post.userId, kind: "video", size: fs.statSync(out).size, createdAt: new Date().toISOString(), usedBy: "post:" + post.id };
      m.renditions.push({ height: target, url: "/media/" + name });
      save("uploads");
      save("posts");
    }
    m.renditionsDone = true;
    save("posts");
    broadcast({ type: "renditions", id: post.id });
    console.log(`[quality] ${post.id}: ${m.renditions.map((r) => r.height + "p").join(", ") || "already small"}`);
  } catch (err) {
    m.renditionsFailed = true;
    save("posts");
    console.error("[quality]", post.id, err.message);
  }
  busy = false;
  setImmediate(work);
}
if (!store.enabled) {
  setInterval(work, 20 * 1000).unref();
  setTimeout(work, 3000).unref();
}

module.exports = { qualityAvailable: available };
