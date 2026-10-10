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
  // 700+ badges: search them, see only the earned ones (or the ones still to earn), or one category
  let q = "", show = "all", only = "";
  const badges = h("div", { class: "badge-cats" });
  const paintBadges = () => {
    const words = q.trim().toLowerCase();
    const pass = (b) => (show === "all" || (show === "earned" ? b.earned : !b.earned)) && (!only || (b.cat || "Other") === only) && (!words || `${b.name} ${b.how} ${b.cat}`.toLowerCase().includes(words));
    const sections = cats.filter((c) => !only || c === only).map((c) => {
      const all = data.badges.filter((b) => (b.cat || "Other") === c), list = all.filter(pass);
      if (!list.length) return null;
      // the ones closest to being earned come first among the rest
      if (show !== "earned") list.sort((a, b) => Number(b.earned) - Number(a.earned) || (b.earned ? 0 : (b.progress / b.goal) - (a.progress / a.goal)));
      return h("section", { class: "badge-cat" },
        h("h4", { class: "badge-cat-title" }, c, h("span", { class: "muted", text: ` ${all.filter((b) => b.earned).length}/${all.length}` })),
        h("div", { class: "badge-grid" }, ...list.map(badgeCard)));
    }).filter(Boolean);
    badges.replaceChildren(...(sections.length ? sections : [h("p", { class: "muted", text: "No badges match." })]));
  };
  const search = h("input", { type: "search", class: "text-input badge-search", placeholder: `Search ${data.badges.length} badges…`, autocomplete: "off" });
  let st;
  search.addEventListener("input", () => { clearTimeout(st); st = setTimeout(() => { q = search.value; paintBadges(); }, 120); });
  const chip = (label, on, fn) => { const b = h("button", { type: "button", class: "badge-chip" + (on ? " on" : ""), text: label }); b.addEventListener("click", fn); return b; };
  const filters = h("div", { class: "badge-filters" });
  const paintFilters = () => filters.replaceChildren(
    h("div", { class: "badge-chips" }, chip(`All`, show === "all", () => { show = "all"; paintFilters(); paintBadges(); }), chip(`✅ Earned (${earned})`, show === "earned", () => { show = "earned"; paintFilters(); paintBadges(); }), chip(`🎯 To earn (${data.badges.length - earned})`, show === "todo", () => { show = "todo"; paintFilters(); paintBadges(); })),
    h("div", { class: "badge-chips cats" }, chip("Every category", !only, () => { only = ""; paintFilters(); paintBadges(); }), ...cats.map((c) => chip(c, only === c, () => { only = only === c ? "" : c; paintFilters(); paintBadges(); }))));
  paintFilters();
  paintBadges();
  const roles = data.roles?.length
    ? h("div", { class: "role-badges in-modal" }, ...data.roles.map((r) => h("span", { class: "role-chip", text: `${r.emoji} ${r.name}` })))
    : null;
  const special = data.special?.length
    ? h("div", { class: "special-grid" }, ...data.special.map((b) => h("div", { class: "special-card", style: specialStyle(b) }, b.image ? h("img", { class: "sc-big-img", src: b.image, alt: "" }) : h("span", { class: "sc-big", text: b.emoji }), h("b", { text: b.name }), h("small", { text: b.unique ? `Made by the LookBlog team, only for @${profile.username}` : "A badge from the LookBlog team" }))))
    : null;
  modal({ title: profile.isMe ? "Your badges" : `${profile.name}’s badges`, wide: true, body: h("div", { class: "badges-modal" },
    special ? h("h3", { class: "side-title", text: "💎 Special" }) : null, special,
    roles ? h("h3", { class: "side-title", text: "What they do" }) : null, roles,
    h("h3", { class: "side-title", text: "Awards" }), awards,
    h("h3", { class: "side-title", text: `Badges · ${earned} of ${data.badges.length}` }), search, filters, badges) });
}

// The colours of a special badge (the team picks one; pink and gold if not)
export function specialStyle(b) {
  if (!b?.color) return "";
  const n = parseInt(b.color.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, bl = n & 255;
  const light = 0.299 * r + 0.587 * g + 0.114 * bl > 150;
  return `--sb:${b.color};--sb-text:${light ? "#1a0d14" : "#ffffff"}`;
}
