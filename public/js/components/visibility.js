// Public / Unlisted / Private for videos and shorts.
import { h, icon, toast } from "../ui.js";
import { api } from "../api.js";

export const VIS = {
  public: { label: "Public", hint: "Everyone can see it in feeds, Videos, Shorts and on your profile." },
  unlisted: { label: "Unlisted", hint: "Only people with the link can watch it. It stays out of feeds and search." },
  private: { label: "Private", hint: "Only you can see it." },
};
const ICON = { public: "globe", unlisted: "link", private: "lock" };

// A small badge shown on unlisted and private things
export function visibilityBadge(p) {
  if (!p.visibility || p.visibility === "public") return null;
  return h("span", { class: "vis-badge " + p.visibility, title: VIS[p.visibility].hint }, icon(ICON[p.visibility]), h("span", { text: VIS[p.visibility].label }));
}

// Three choices, used while posting
export function visibilityPicker(start = "public") {
  let value = start;
  const hint = h("p", { class: "vis-hint" });
  const row = h("div", { class: "vis-pick", role: "radiogroup", "aria-label": "Who can watch" });
  const paint = () => {
    row.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.v === value);
      b.setAttribute("aria-checked", String(b.dataset.v === value));
    });
    hint.textContent = VIS[value].hint;
  };
  for (const v of Object.keys(VIS)) {
    const b = h("button", { type: "button", role: "radio", dataset: { v } }, icon(ICON[v]), h("span", { text: VIS[v].label }));
    b.addEventListener("click", () => { value = v; paint(); });
    row.append(b);
  }
  paint();
  return { el: h("div", { class: "vis-field" }, h("b", { class: "vis-label", text: "Who can watch" }), row, hint), value: () => value };
}

// A button on my own video's page to change it later
export function visibilityButton(p, onChange) {
  const btn = h("button", { type: "button", class: "act act-vis" });
  const paint = () => btn.replaceChildren(icon(ICON[p.visibility || "public"]), h("span", { text: VIS[p.visibility || "public"].label }));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelector(".pic-menu")?.remove();
    const menu = h("div", { class: "pic-menu vis-menu", role: "menu" });
    for (const v of Object.keys(VIS)) {
      const item = h("button", { type: "button", role: "menuitemradio", "aria-checked": String(v === p.visibility), class: v === p.visibility ? "checked" : "" },
        icon(ICON[v]), h("span", { class: "vm-t" }, h("b", { text: VIS[v].label }), h("small", { text: VIS[v].hint })));
      item.addEventListener("click", async () => {
        menu.remove();
        if (v === p.visibility) return;
        try {
          await api(`/api/posts/${p.id}/edit`, { method: "POST", body: { visibility: v } });
          p.visibility = v;
          paint();
          onChange?.(v);
          toast(`Now ${VIS[v].label.toLowerCase()}.`);
        } catch (err) { toast(err.error || "Couldn’t change that."); }
      });
      menu.append(item);
    }
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 10) + "px";
    menu.style.top = (r.bottom + menu.offsetHeight + 8 < innerHeight ? r.bottom + 6 : r.top - menu.offsetHeight - 6) + "px";
    setTimeout(() => {
      const away = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("mousedown", away); } };
      document.addEventListener("mousedown", away);
    });
  });
  paint();
  return btn;
}
