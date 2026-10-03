// All badges and awards for a profile, earned and still to earn.
import { h, modal, count, tick } from "../ui.js";

// The Verified badge shows the person's real tick; the rest are emoji
export function badgeIcon(b, data, size = 30) {
  if (b.emoji === "tick") return tick({ verified: true, verifiedType: data.verifiedType || "creator" }, size) || "✔️";
  return b.emoji;
}

export function openBadges(profile, data) {
  const earned = data.badges.filter((b) => b.earned).length;
  const awards = h("div", { class: "award-grid" }, ...data.awards.map((a) => {
    const next = a.next;
    const prevStep = a.level ? a.steps[a.level - 1] : 0;
    const pct = next ? Math.min(100, Math.round(((a.value - prevStep) / (next - prevStep)) * 100)) : 100;
    return h("div", { class: "award" + (a.level ? " " + a.tier : " locked") },
      h("span", { class: "award-medal", text: a.emoji }),
      h("div", { class: "award-text" },
        h("b", { text: a.name }),
        h("span", { class: "muted", text: a.level ? `${a.tier[0].toUpperCase() + a.tier.slice(1)} · ${count(a.value)} ${a.unit}` : `${count(a.value)} ${a.unit}` }),
        h("div", { class: "award-bar" }, h("span", { style: `width:${pct}%` })),
        h("small", { class: "muted", text: next ? `Next level at ${count(next)}` : "Top level reached" })));
  }));
  const cats = [...new Set(data.badges.map((b) => b.cat || "Other"))];
  const badgeCard = (b) =>
    h("div", { class: "badge-card" + (b.earned ? " earned" : "") },
      h("span", { class: "bc-emoji" }, badgeIcon(b, data, 32)),
      h("b", { text: b.name }),
      h("small", { class: "muted", text: b.how }),
      !b.earned && b.goal > 1 ? h("div", { class: "award-bar" }, h("span", { style: `width:${Math.round((b.progress / b.goal) * 100)}%` })) : null,
      !b.earned && b.goal > 1 ? h("small", { class: "muted", text: `${b.progress} / ${b.goal}` }) : null);
  const badges = h("div", { class: "badge-cats" }, ...cats.map((c) => {
    const list = data.badges.filter((b) => (b.cat || "Other") === c);
    return h("section", { class: "badge-cat" },
      h("h4", { class: "badge-cat-title" }, c, h("span", { class: "muted", text: ` ${list.filter((b) => b.earned).length}/${list.length}` })),
      h("div", { class: "badge-grid" }, ...list.map(badgeCard)));
  }));
  const roles = data.roles?.length
    ? h("div", { class: "role-badges in-modal" }, ...data.roles.map((r) => h("span", { class: "role-chip", text: `${r.emoji} ${r.name}` })))
    : null;
  modal({ title: profile.isMe ? "Your badges" : `${profile.name}’s badges`, wide: true, body: h("div", { class: "badges-modal" },
    roles ? h("h3", { class: "side-title", text: "What they do" }) : null, roles,
    h("h3", { class: "side-title", text: "Awards" }), awards,
    h("h3", { class: "side-title", text: `Badges · ${earned} of ${data.badges.length}` }), badges) });
}
