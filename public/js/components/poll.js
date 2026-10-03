// Polls inside posts: vote once, then see how everyone voted. Counts update live.
import { h, toast, plural } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";

function timeLeft(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "Final results";
  const h = Math.floor(ms / 3600000);
  if (h >= 24) return `${Math.floor(h / 24)}d left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.floor(ms / 60000))}m left`;
}

export function pollEl(p) {
  const box = h("div", { class: "poll" });
  function paint() {
    const poll = p.poll;
    const showResults = poll.myVote || poll.ended || p.mine;
    const max = Math.max(1, ...poll.options.map((o) => o.count || 0));
    box.replaceChildren(
      ...poll.options.map((o) => {
        if (!showResults) {
          const b = h("button", { type: "button", class: "poll-choice", text: o.text });
          b.addEventListener("click", (e) => { e.stopPropagation(); vote(o.id, b); });
          return b;
        }
        const pct = poll.total ? Math.round(((o.count || 0) / poll.total) * 100) : 0;
        const row = h("div", { class: "poll-result" + (o.id === poll.myVote ? " mine" : "") + ((o.count || 0) === max && poll.total ? " top" : "") },
          h("span", { class: "poll-bar", style: `width:${pct}%` }),
          h("span", { class: "poll-text", text: o.text }),
          h("span", { class: "poll-pct", text: pct + "%" }));
        return row;
      }),
      h("p", { class: "poll-meta muted", text: `${plural(poll.total, "vote", "votes")} · ${timeLeft(poll.endsAt)}` })
    );
  }
  async function vote(optionId, btn) {
    btn.disabled = true;
    try {
      const { poll } = await api(`/api/posts/${p.id}/vote`, { method: "POST", body: { optionId } });
      p.poll = poll;
      paint();
    } catch (err) {
      toast(err.error || "Couldn’t vote.");
      btn.disabled = false;
    }
  }
  // Live: someone else voted
  const off = on("poll", async (ev) => {
    if (!box.isConnected) return off();
    if (ev.id !== p.id) return;
    try { p.poll = (await api(`/api/posts/${p.id}`)).post.poll; paint(); } catch {}
  });
  paint();
  return box;
}
