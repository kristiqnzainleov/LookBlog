// Two-step codes from an authenticator app (TOTP, RFC 6238: 6 digits, a new one every 30 seconds).
// The secret is stored encrypted (AES-256-GCM, key MFA_KEY), so a copy of the database alone can't make codes,
// and a code works only once (the last used time step is remembered).
const crypto = require("crypto");

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, "")) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

// The encryption key: MFA_KEY (32 bytes, hex or base64) online; a fixed one only when running locally
function key() {
  const raw = process.env.MFA_KEY || "";
  if (raw) { const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64"); if (k.length === 32) return k; }
  if (process.env.SUPABASE_URL) throw new Error("MFA_KEY is missing");
  return crypto.createHash("sha256").update("lookblog-local-dev-mfa").digest();
}
function seal(secret) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function open(sealed) {
  try {
    const [iv, tag, enc] = String(sealed).split(".").map((x) => Buffer.from(x, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch { return null; }
}

function codeAt(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
const nowStep = () => Math.floor(Date.now() / 30000);

// A new secret, sealed for storing, plus what the person types or scans
function newSecret(label) {
  const secret = b32encode(crypto.randomBytes(20));
  const uri = `otpauth://totp/${encodeURIComponent("LookBlog:" + label)}?secret=${secret}&issuer=LookBlog&algorithm=SHA1&digits=6&period=30`;
  return { secret, sealed: seal(secret), uri };
}
// Checks a code against a sealed secret (one step of clock drift either way). Returns the step it matched, or 0.
function check(sealed, code, lastStep = 0) {
  const secret = open(sealed), c = String(code || "").replace(/\s+/g, "");
  if (!secret || !/^\d{6}$/.test(c)) return 0;
  const now = nowStep();
  for (const s of [now, now - 1, now + 1]) {
    if (s <= lastStep) continue; // (a code is never accepted twice)
    const want = Buffer.from(codeAt(secret, s)), got = Buffer.from(c);
    if (crypto.timingSafeEqual(want, got)) return s;
  }
  return 0;
}

module.exports = { newSecret, check, seal, open, codeAt, nowStep, b32decode };
