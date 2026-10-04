// The database in Supabase (used when SUPABASE_URL and SUPABASE_SERVICE_KEY are set).
// Every record is one row in public.docs: (coll, id, data, deleted, seq).
//   - On start the server loads everything into memory, so the rest of the code works as before.
//   - Before each request it fetches only the rows that changed since it last looked (seq goes up on every write),
//     so several servers running at once still see each other's changes.
//   - save(name) marks a collection; flush() writes only the records that really changed (and deletions).

const crypto = require("crypto");

const URL_ = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY || "";
const enabled = Boolean(URL_ && KEY);
const OVERLAP = 10; // re-read a few rows each time, in case a slower write finished late
const PAGE = 1000;

let lastSeq = 0;
const written = new Map(); // coll -> Map(id -> JSON of what the database has)
const rowSeq = new Map(); // coll + "\0" + id -> seq of the version in memory
const dirty = new Set();

// Calls Supabase. A dropped connection or a 5xx is tried again (3 tries, a moment apart).
async function rest(path, { method = "GET", body, prefer } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${URL_}/rest/v1/${path}`, {
        method,
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status >= 500 && attempt < 3) throw new Error(`Supabase ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`Supabase ${method} ${path.split("?")[0]}: ${res.status} ${await res.text().catch(() => "")}`), { final: true });
      return res.status === 204 ? null : res.json();
    } catch (err) {
      if (err.final || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
}

const wmap = (coll) => written.get(coll) || written.set(coll, new Map()).get(coll);
function entries(db, name) {
  const c = db[name];
  if (Array.isArray(c)) return c.map((d) => [d.id || (d.id = crypto.randomUUID()), d]);
  return Object.entries(c || {});
}
// Swap an object's contents but keep the object (other code may hold it)
function replaceInPlace(target, data) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, data);
  return target;
}
const timeOf = (d) => new Date(d.createdAt || d.at || 0).getTime() || 0;

async function fetchSince(seq) {
  const rows = [];
  for (;;) {
    const page = await rest(`docs?select=coll,id,data,deleted,seq&seq=gt.${seq}&order=seq.asc&limit=${PAGE}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
    seq = page[page.length - 1].seq;
  }
}

// First load: build every collection from the rows
async function load(db) {
  const rows = await fetchSince(0);
  const by = new Map();
  for (const r of rows) {
    rowSeq.set(r.coll + "\0" + r.id, r.seq);
    lastSeq = Math.max(lastSeq, r.seq);
    if (r.deleted) continue;
    if (!by.has(r.coll)) by.set(r.coll, []);
    by.get(r.coll).push(r);
  }
  for (const [coll, list] of by) {
    if (!(coll in db)) db[coll] = [];
    if (Array.isArray(db[coll])) {
      const docs = list.map((r) => r.data);
      docs.sort((a, b) => (coll === "posts" ? timeOf(b) - timeOf(a) : timeOf(a) - timeOf(b)));
      db[coll] = docs;
    } else db[coll] = Object.fromEntries(list.map((r) => [r.id, r.data]));
    const w = wmap(coll);
    for (const [id, d] of entries(db, coll)) w.set(id, JSON.stringify(d));
  }
}

function apply(db, r) {
  const key = r.coll + "\0" + r.id;
  if ((rowSeq.get(key) || 0) >= r.seq) return; // we already have this version (or a newer one)
  rowSeq.set(key, r.seq);
  if (!(r.coll in db)) { if (r.deleted) return; db[r.coll] = []; }
  const coll = db[r.coll];
  const w = wmap(r.coll);
  if (Array.isArray(coll)) {
    const i = coll.findIndex((d) => d.id === r.id);
    if (r.deleted) { if (i > -1) coll.splice(i, 1); w.delete(r.id); return; }
    const doc = i > -1 ? replaceInPlace(coll[i], r.data) : r.data;
    if (i === -1) { if (r.coll === "posts") coll.unshift(doc); else coll.push(doc); }
    w.set(r.id, JSON.stringify(doc));
  } else {
    if (r.deleted) { delete coll[r.id]; w.delete(r.id); return; }
    const doc = coll[r.id] ? replaceInPlace(coll[r.id], r.data) : (coll[r.id] = r.data);
    w.set(r.id, JSON.stringify(doc));
  }
}

// Pick up what other servers wrote
let syncing = null;
function sync(db) {
  if (!syncing) syncing = (async () => {
    try {
      const rows = await fetchSince(Math.max(0, lastSeq - OVERLAP));
      for (const r of rows) { apply(db, r); lastSeq = Math.max(lastSeq, r.seq); }
    } finally { syncing = null; }
  })();
  return syncing;
}

// Write what changed. Runs one at a time.
let chain = Promise.resolve();
function flush(db) {
  chain = chain.then(() => writeChanges(db)).catch((err) => console.error("[store]", err.message));
  return chain;
}
async function writeChanges(db) {
  if (!dirty.size) return;
  const names = [...dirty];
  dirty.clear();
  const rows = [];
  for (const name of names) {
    if (!(name in db)) continue;
    const w = wmap(name);
    const seen = new Set();
    for (const [id, d] of entries(db, name)) {
      seen.add(id);
      const s = JSON.stringify(d);
      if (w.get(id) !== s) { rows.push({ coll: name, id, data: d, deleted: false }); w.set(id, s); }
    }
    for (const id of [...w.keys()]) if (!seen.has(id)) { rows.push({ coll: name, id, data: null, deleted: true }); w.delete(id); }
  }
  for (let i = 0; i < rows.length; i += 300) {
    const part = rows.slice(i, i + 300);
    try {
      const back = await rest("docs?on_conflict=coll,id&select=coll,id,seq", { method: "POST", body: part, prefer: "resolution=merge-duplicates,return=representation" });
      for (const r of back) rowSeq.set(r.coll + "\0" + r.id, r.seq);
    } catch (err) {
      // Try these again next time
      for (const r of part) { wmap(r.coll).set(r.id, "\0retry"); dirty.add(r.coll); }
      throw err;
    }
  }
}

function markDirty(name) { dirty.add(name); }
const hasPending = () => dirty.size > 0;

module.exports = { enabled, load, sync, flush, markDirty, hasPending, rest };
