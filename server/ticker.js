// Jobs that repeat (ending lives nobody is streaming, releasing scheduled posts, clearing old stories…).
// Locally they run on a timer. Online the server sleeps between requests, so they run at the start of a request once they're due.

const store = require("./store");

const jobs = [];
function every(fn, ms) {
  if (!store.enabled) return setInterval(fn, ms);
  jobs.push({ fn, ms, last: 0 });
  return { unref() {} };
}
function runDue() {
  const now = Date.now();
  for (const job of jobs) {
    if (now - job.last < job.ms) continue;
    job.last = now;
    try { job.fn(); } catch (err) { console.error("[job]", err); }
  }
}

// Keep the server awake until this work is done, even after the answer went out (Vercel's waitUntil).
// Locally there's nothing to do: the server never sleeps.
function keepAlive(promise) {
  const ctx = globalThis[Symbol.for("@vercel/request-context")]?.get?.();
  if (ctx?.waitUntil) ctx.waitUntil(promise.catch((err) => console.error("[keepAlive]", err)));
  return promise;
}

module.exports = { every, runDue, keepAlive };
