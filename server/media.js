// Uploading and serving photos and videos.
// Files are checked by their first bytes (not just the name or type the browser claims).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { db, save, UPLOAD_DIR } = require("./db");
const store = require("./store");
const { sendJSON, httpError, rateLimit } = require("./http");
const { every } = require("./ticker");

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
  "audio/flac": { ext: "flac", kind: "audio", max: 50 * MB, check: (b) => ascii(b, 0, "fLaC") },
  "audio/aac": { ext: "aac", kind: "audio", max: 40 * MB, check: (b) => b[0] === 0xff && (b[1] & 0xf6) === 0xf0 },
  // Documents sent in chats (always downloaded, never opened as a web page)
  "application/pdf": { ext: "pdf", kind: "file", max: 50 * MB, check: (b) => ascii(b, 0, "%PDF") },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", kind: "file", max: 50 * MB, check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", kind: "file", max: 50 * MB, check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", kind: "file", max: 50 * MB, check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  "application/msword": { ext: "doc", kind: "file", max: 50 * MB, check: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0]) },
  "application/vnd.ms-excel": { ext: "xls", kind: "file", max: 50 * MB, check: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0]) },
  "application/vnd.ms-powerpoint": { ext: "ppt", kind: "file", max: 50 * MB, check: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0]) },
  "application/zip": { ext: "zip", kind: "file", max: 50 * MB, check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]) },
  "text/plain": { ext: "txt", kind: "file", max: 10 * MB, check: (b) => b.length > 0 && !b.includes(0) },
  "text/csv": { ext: "csv", kind: "file", max: 10 * MB, check: (b) => b.length > 0 && !b.includes(0) },
};
// Other names browsers use for the same types
for (const [alias, real] of [["audio/mp3", "audio/mpeg"], ["audio/x-m4a", "audio/mp4"], ["audio/x-flac", "audio/flac"], ["application/x-zip-compressed", "application/zip"]]) TYPES[alias] = TYPES[real];
const CONTENT_TYPE = Object.fromEntries(Object.entries(TYPES).reverse().map(([type, t]) => [t.ext, type]));
const NAME_RE = /^[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|mov|webm|weba|ogg|m4a|mp3|wav|flac|aac|pdf|docx|xlsx|pptx|doc|xls|ppt|zip|txt|csv)$/;
const WHAT = { image: "photo", video: "video", audio: "sound", file: "file" };
const TYPES_HINT = "Use a photo (JPG, PNG, GIF, WebP), a video (MP4, MOV, WebM), a sound (MP3, M4A, OGG, WAV, FLAC) or a document (PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP).";

/* ---------- Online: files live in Supabase Storage (bucket "media") ----------
   The browser asks for an upload address (POST /api/upload/start), sends the file straight to Supabase,
   then tells us it's done (POST /api/upload/finish). We check the first bytes like we do locally. */
const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const ONLINE_MAX = 50 * MB; // the largest file Supabase's free plan takes
const sbHeaders = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` });
const publicUrl = (name) => `${SB_URL}/storage/v1/object/public/media/${name}`;
const sign = (text) => crypto.createHmac("sha256", SB_KEY).update(text).digest("base64url");
const limitOf = (t) => (store.enabled ? Math.min(t.max, ONLINE_MAX) : t.max);
const tooBigFor = (t) => httpError(413, `${{ image: "Photos", video: "Videos", audio: "Sounds", file: "Files" }[t.kind]} can be up to ${limitOf(t) / MB} MB.`);

// POST /api/upload/start { type, size } -> { uploadUrl, name, ticket }
async function startUpload(req, res, me, body) {
  rateLimit("upload:" + me.id, 60, 10 * 60 * 1000, "You’re uploading a lot. Take a short break.");
  const type = String(body.type || "").split(";")[0].trim().toLowerCase();
  const t = TYPES[type];
  if (!t) throw httpError(415, TYPES_HINT);
  const size = Number(body.size) || 0;
  if (!size) throw httpError(400, "That file is empty.");
  if (size > limitOf(t)) throw tooBigFor(t);
  const name = `${crypto.randomUUID()}.${t.ext}`;
  const r = await fetch(`${SB_URL}/storage/v1/object/upload/sign/media/${name}`, { method: "POST", headers: { ...sbHeaders(), "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) throw httpError(502, "Couldn’t start the upload. Try again.");
  const { url } = await r.json();
  sendJSON(res, 200, { uploadUrl: `${SB_URL}/storage/v1${url}`, name, type, ticket: sign(`${me.id}:${name}:${type}`) });
}

// POST /api/upload/finish { name, type, ticket } -> { url, kind }
async function finishUpload(req, res, me, body) {
  const name = String(body.name || ""), type = String(body.type || "");
  const t = TYPES[type];
  if (!t || !NAME_RE.test(name) || !name.endsWith("." + t.ext) || body.ticket !== sign(`${me.id}:${name}:${type}`)) throw httpError(400, "That upload isn’t valid.");
  if (db.uploads[name]) return sendJSON(res, 201, { url: "/media/" + name, kind: t.kind });
  const r = await fetch(publicUrl(name) + "?t=" + Date.now(), { headers: { Range: "bytes=0-15" } });
  const head = r.ok ? Buffer.from(await r.arrayBuffer()).subarray(0, 16) : Buffer.alloc(0);
  const size = Number(String(r.headers.get("content-range") || "").split("/")[1]) || Number(r.headers.get("content-length")) || 0;
  const bad = !r.ok ? httpError(400, "The file didn’t arrive. Try again.") : size > limitOf(t) ? tooBigFor(t)
    : !t.check(head) ? httpError(415, `That file doesn’t look like a real ${WHAT[t.kind]}.`) : null;
  if (bad) { removeObject(name); throw bad; }
  db.uploads[name] = { ownerId: me.id, kind: t.kind, size, createdAt: new Date().toISOString() };
  save("uploads");
  sendJSON(res, 201, { url: "/media/" + name, kind: t.kind });
}

function removeObject(name) {
  fetch(`${SB_URL}/storage/v1/object/media`, { method: "DELETE", headers: { ...sbHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [name] }) })
    .catch((err) => console.error("[media] delete", err.message));
}

/* ---------- POST /api/upload  (raw file body, type in Content-Type) ---------- */
async function handleUpload(req, res, me) {
  if (store.enabled) throw httpError(400, "Uploads go straight to storage now. Reload the page and try again.");
  rateLimit("upload:" + me.id, 60, 10 * 60 * 1000, "You’re uploading a lot. Take a short break.");
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const t = TYPES[type];
  if (!t) throw httpError(415, TYPES_HINT);
  const declared = Number(req.headers["content-length"] || 0);
  const tooBig = tooBigFor(t);
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
    if (!t.check(head)) throw httpError(415, `That file doesn’t look like a real ${WHAT[t.kind]}.`);
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
every(() => {
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
  if (store.enabled) return removeObject(name);
  fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {});
}

/* ---------- GET /media/<file>  (supports Range so videos can seek) ---------- */
function serveMedia(req, res, name) {
  if (!NAME_RE.test(name) || !db.uploads[name]) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  // Online the file is in Supabase Storage (it handles seeking and caching)
  if (store.enabled) {
    res.writeHead(302, { Location: publicUrl(name), "Cache-Control": "public, max-age=86400" });
    return res.end();
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
    // Documents are always downloaded (never shown as a page on our site); PDFs may open in the browser's own viewer
    ...(db.uploads[name].kind === "file" ? { "Content-Disposition": /\.pdf$/.test(name) ? "inline" : "attachment", "Content-Security-Policy": "sandbox" } : {}),
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

module.exports = { handleUpload, startUpload, finishUpload, ownedMedia, markUsed, deleteMedia, serveMedia };
