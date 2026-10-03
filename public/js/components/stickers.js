// Your sticker collection: send one, make a new one from a photo, or remove one.
import { h, icon, toast, spinner } from "../ui.js";
import { api, upload } from "../api.js";
import { openStickerMaker } from "./sticker-maker.js";

let panel = null;
export function closeStickers() { panel?.remove(); panel = null; }

export async function makeSticker() {
  const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", hidden: true });
  document.body.append(input);
  const file = await new Promise((resolve) => { input.addEventListener("change", () => resolve(input.files[0] || null)); input.click(); });
  input.remove();
  if (!file) return null;
  const blob = await openStickerMaker(file).catch((e) => { toast(e.message); return null; });
  if (!blob) return null;
  const { url } = await upload(new File([blob], "sticker.png", { type: "image/png" }));
  const { stickers } = await api("/api/me/stickers", { method: "POST", body: { url } });
  toast("Sticker saved.");
  return stickers;
}

// Tabs: "Mine" (your own stickers, usable anywhere) and "This group" (the group's stickers, only in that group).
// onSend(sticker, kind) — kind is "mine" or "group".
export function openStickers(anchor, onSend, { group = null, canManageGroup = false } = {}) {
  if (panel) return closeStickers();
  let tab = "mine";
  const grid = h("div", { class: "sticker-grid" }, spinner());
  const tabs = h("div", { class: "snd-tabs" });
  const hint = h("span", { class: "muted" });
  panel = h("div", { class: "sticker-panel", role: "dialog", "aria-label": "Stickers" },
    h("header", { class: "sp-head" }, group ? tabs : h("b", { text: "Your stickers" }), hint), grid);
  document.body.append(panel);
  const place = () => {
    if (!panel) return;
    const a = anchor.getBoundingClientRect();
    const w = Math.min(340, innerWidth - 16);
    panel.style.width = w + "px";
    panel.style.left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), innerWidth - w - 8) + "px";
    panel.style.top = Math.max(8, a.top - panel.offsetHeight - 8) + "px";
  };
  const paintTabs = () => tabs.replaceChildren(...[["mine", "Mine"], ["group", "This group"]].map(([k, l]) => h("button", { type: "button", class: "snd-tab" + (k === tab ? " on" : ""), text: l, onclick: () => { tab = k; paintTabs(); load(); } })));
  if (group) paintTabs();

  function paintGroup(list) {
    hint.textContent = canManageGroup ? "Right-click to remove" : "";
    const add = canManageGroup ? h("button", { type: "button", class: "sticker-new", title: "Add a sticker to this group" }, icon("plus"), h("span", { text: "Add" })) : null;
    add?.addEventListener("click", async () => {
      closeStickers();
      try {
        const input = h("input", { type: "file", accept: "image/png,image/webp,image/gif,image/jpeg", hidden: true });
        document.body.append(input);
        const file = await new Promise((r) => { input.addEventListener("change", () => r(input.files[0] || null)); input.click(); });
        input.remove();
        if (!file) return;
        const blob = /gif/.test(file.type) ? file : await openStickerMaker(file);
        if (!blob) return;
        const { url } = await upload(new File([blob], "sticker.png", { type: blob.type || "image/png" }));
        const { stickers } = await api(`/api/groups/${group.id}/stickers`, { method: "POST", body: { url } });
        group.stickers = stickers;
        toast("Sticker added to the group.");
      } catch (err) { toast(err.error || err.message || "Couldn’t add it."); }
    });
    grid.replaceChildren(...[add].filter(Boolean), ...list.map((s) => {
      const b = h("button", { type: "button", class: "sticker-item", title: "Send" }, h("img", { src: s.url, alt: "Sticker", loading: "lazy" }));
      b.addEventListener("click", () => { closeStickers(); onSend(s, "group"); });
      if (canManageGroup) b.addEventListener("contextmenu", async (e) => {
        e.preventDefault();
        try { group.stickers = (await api(`/api/groups/${group.id}/stickers/${s.id}`, { method: "DELETE" })).stickers; paintGroup(group.stickers); } catch (err) { toast(err.error || "Couldn’t remove it."); }
      });
      return b;
    }));
    if (!list.length) grid.append(h("p", { class: "muted sticker-empty", text: canManageGroup ? "No group stickers yet. Add the first one!" : "This group has no stickers yet." }));
    place();
  }

  function paint(stickers) {
    hint.textContent = "Right-click to remove";
    const create = h("button", { type: "button", class: "sticker-new", title: "Make a sticker from a photo" }, icon("plus"), h("span", { text: "Make one" }));
    create.addEventListener("click", async () => {
      closeStickers();
      try { await makeSticker(); } catch (err) { toast(err.error || err.message || "Couldn’t make the sticker."); }
    });
    grid.replaceChildren(create, ...stickers.map((s) => {
      const b = h("button", { type: "button", class: "sticker-item", title: "Send" }, h("img", { src: s.url, alt: "Sticker", loading: "lazy" }));
      b.addEventListener("click", () => { closeStickers(); onSend(s, "mine"); });
      b.addEventListener("contextmenu", async (e) => {
        e.preventDefault();
        b.classList.add("removing");
        try { paint((await api(`/api/me/stickers/${s.id}`, { method: "DELETE" })).stickers); toast("Sticker removed."); }
        catch (err) { toast(err.error || "Couldn’t remove it."); b.classList.remove("removing"); }
      });
      return b;
    }));
    if (!stickers.length) grid.append(h("p", { class: "muted sticker-empty", text: "No stickers yet. Make one from any photo: we’ll help you cut out the background." }));
    place();
  }
  function load() {
    grid.replaceChildren(spinner());
    if (tab === "group") return paintGroup(group.stickers || []);
    api("/api/me/stickers").then(({ stickers }) => { if (tab === "mine") paint(stickers); }).catch(() => grid.replaceChildren(h("p", { class: "muted", text: "Couldn’t load your stickers." })));
  }
  place();
  load();
  setTimeout(() => {
    const away = (e) => { if (panel && !panel.contains(e.target) && !anchor.contains(e.target)) { closeStickers(); document.removeEventListener("mousedown", away); } };
    document.addEventListener("mousedown", away);
  });
}
