// Uploading and serving photos and videos.
// Files are checked by their first bytes (not just the name or type the browser claims).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { db, save, UPLOAD_DIR } = require("./db");
const { sendJSON, httpError, rateLimit } = require("./http");

const MB = 1024 * 1024;
const startsWith = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);
const ascii = (buf, at, text) => buf.subarray(at, at + text.length).toString("latin1") === text;

const TYPES = {
  "image/jpeg": { ext: "jpg", kind: "image", max: 15 * MB, check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  "image/png": { ext: "png", kind: "image", max: 15 * MB, check: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]) },
  "image/gif": { ext: "gif", kind: "image", max: 15 * MB, check: (b) => ascii(b, 0, "GIF8") },
  "image/webp": { ext: "webp", kind: "image", max: 15 * MB, check: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP") },
  "video/mp4": { ext: "mp4", kind: "video", max: 500 * MB, check: (b) => ascii(b, 4, "ftyp") },
  "video/quicktime": { ext: "mov", kind: "video", max: 500 * MB, check: (b) => ["ftyp", "moov", "wide", "mdat", "free", "skip"].some((t) => ascii(b, 4, t)) },
  "video/webm": { ext: "webm", kind: "video", max: 500 * MB, check: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  // Voice messages
  "audio/webm": { ext: "weba", kind: "audio", max: 15 * MB, check: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  "audio/ogg": { ext: "ogg", kind: "audio", max: 40 * MB, check: (b) => ascii(b, 0, "OggS") },
  "audio/mp4": { ext: "m4a", kind: "audio", max: 40 * MB, check: (b) => ascii(b, 4, "ftyp") },
  "audio/wav": { ext: "wav", kind: "audio", max: 20 * MB, check: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE") },
  "audio/x-wav": { ext: "wav", kind: "audio", max: 20 * MB, check: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE") },
  "audio/wave": { ext: "wav", kind: "audio", max: 20 * MB, check: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE") },
  "audio/mpeg": { ext: "mp3", kind: "audio", max: 40 * MB, check: (b) => ascii(b, 0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
};
const CONTENT_TYPE = Object.fromEntries(Object.entries(TYPES).map(([type, t]) => [t.ext, type]));
const NAME_RE = /^[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|mov|webm|weba|ogg|m4a|mp3|wav)$/;

/* ---------- POST /api/upload  (raw file body, type in Content-Type) ---------- */
async function handleUpload(req, res, me) {
  rateLimit("upload:" + me.id, 60, 10 * 60 * 1000, "You’re uploading a lot. Take a short break.");
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const t = TYPES[type];
  if (!t) throw httpError(415, "Use a JPG, PNG, GIF or WebP photo, an MP4, MOV or WebM video, or a sound (MP3, M4A, OGG, WAV).");
  const declared = Number(req.headers["content-length"] || 0);
  const tooBig = httpError(413, t.kind === "image" ? "Photos can be up to 15 MB." : "Videos can be up to 500 MB.");
  if (declared > t.max) throw tooBig;

  const id = crypto.randomUUID();
  const tmp = path.join(UPLOAD_DIR, id + ".part");
  const out = fs.createWriteStream(tmp);
  let size = 0;
  let head = Buffer.alloc(0);

  try {
    await new Promise((resolve, reject) => {
      req.on("data", (chunk) => {
        size += chunk.length;
        if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
        if (size > t.max) {
          reject(tooBig);
          req.destroy();
          return;
        }
        if (!out.write(chunk)) {
          req.pause();
          out.once("drain", () => req.resume());
        }
      });
      req.on("end", () => out.end(resolve));
      req.on("error", reject);
      out.on("error", reject);
    });
    if (size === 0) throw httpError(400, "That file is empty.");
    if (!t.check(head)) throw httpError(415, `That file doesn’t look like a real ${t.kind === "image" ? "photo" : t.kind === "audio" ? "recording" : "video"}.`);
  } catch (err) {
    out.destroy();
    fs.rm(tmp, { force: true }, () => {});
    throw err;
  }

  const name = `${id}.${t.ext}`;
  fs.renameSync(tmp, path.join(UPLOAD_DIR, name));
  db.uploads[name] = { ownerId: me.id, kind: t.kind, size, createdAt: new Date().toISOString() };
  save("uploads");
  sendJSON(res, 201, { url: "/media/" + name, kind: t.kind });
}

/* ---------- Check that a URL points to a fresh file this user uploaded ---------- */
// Each upload can be used in one place only (a post, a reply, an avatar or a banner),
// so deleting one of them never removes a file that something else still shows.
function ownedMedia(url, ownerId, kind) {
  const name = String(url || "").replace(/^\/media\//, "");
  const meta = NAME_RE.test(name) && db.uploads[name];
  if (!meta || meta.ownerId !== ownerId || meta.usedBy) return null;
  if (kind && meta.kind !== kind) return null;
  return { url: "/media/" + name, kind: meta.kind };
}

function markUsed(url, usedBy) {
  const name = String(url || "").replace(/^\/media\//, "");
  if (db.uploads[name]) {
    db.uploads[name].usedBy = usedBy;
    save("uploads");
  }
}

// Remove uploads nobody attached to anything within a day
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [name, meta] of Object.entries(db.uploads)) {
    if (!meta.usedBy && new Date(meta.createdAt).getTime() < cutoff) deleteMedia("/media/" + name);
  }
}, 60 * 60 * 1000).unref();

function deleteMedia(url) {
  const name = String(url || "").replace(/^\/media\//, "");
  if (!NAME_RE.test(name) || !db.uploads[name]) return;
  delete db.uploads[name];
  save("uploads");
  fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {});
}

/* ---------- GET /media/<file>  (supports Range so videos can seek) ---------- */
function serveMedia(req, res, name) {
  if (!NAME_RE.test(name) || !db.uploads[name]) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  const file = path.join(UPLOAD_DIR, name);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  const headers = {
    "Content-Type": CONTENT_TYPE[path.extname(name).slice(1)],
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (range) {
    let start = range[1] === "" ? stat.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    if (start < 0 || start > end || start >= stat.size) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  res.writeHead(200, { ...headers, "Content-Length": stat.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

module.exports = { handleUpload, ownedMedia, markUsed, deleteMedia, serveMedia };
