// "Report a bug": tell the LookBlog team something is broken. The page, browser and screen size
// are added automatically, and you can attach a screenshot.
import { h, modal, toast, icon } from "../ui.js";
import { api, upload } from "../api.js";

const AREAS = [["feed", "Feed / For you"], ["posts", "Posts and replies"], ["videos", "Videos and the player"], ["shorts", "Shorts"], ["music", "Music"], ["cinema", "Movies and series"],
  ["messages", "Messages"], ["calls", "Calls and voice channels"], ["groups", "Groups"], ["events", "Events"], ["profile", "Profile and settings"], ["notifications", "Notifications"], ["search", "Search"], ["other", "Something else"]];

export function openBugReport() {
  const page = location.pathname + location.search;
  const guess = /messages/.test(page) ? "messages" : /watch|videos/.test(page) ? "videos" : /shorts/.test(page) ? "shorts" : /music/.test(page) ? "music" : /cinema|playlist/.test(page) ? "cinema" : /events?\//.test(page) ? "events" : /\/u\//.test(page) ? "profile" : /feed/.test(page) ? "feed" : "other";
  const area = h("select", { class: "text-input" }, ...AREAS.map(([id, l]) => h("option", { value: id, text: l, selected: id === guess })));
  const what = h("textarea", { class: "text-input", rows: 3, maxlength: 3000, placeholder: "What went wrong?" });
  const steps = h("textarea", { class: "text-input", rows: 3, maxlength: 2000, placeholder: "How can we make it happen? (1. I opened… 2. I pressed…)" });
  const expected = h("input", { type: "text", class: "text-input", maxlength: 1000, placeholder: "What did you expect to happen? (optional)" });
  let shot = null, busy = false;
  const shotIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
  const shotBtn = h("button", { type: "button", class: "btn btn-sm btn-outline-light" }, icon("image"), h("span", { text: "Attach a screenshot" }));
  const shotPrev = h("img", { class: "bug-shot", alt: "", hidden: true });
  shotBtn.addEventListener("click", () => shotIn.click());
  shotIn.addEventListener("change", async () => {
    const f = shotIn.files[0]; shotIn.value = "";
    if (!f) return;
    shotPrev.src = URL.createObjectURL(f); shotPrev.hidden = false;
    busy = true; send.disabled = true;
    try { shot = (await upload(f)).url; } catch (err) { shot = null; shotPrev.hidden = true; toast(err.error || "Couldn’t attach it."); }
    busy = false; send.disabled = false;
  });
  const send = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Send bug report" });
  const info = h("p", { class: "muted bug-info", text: `We’ll also send: this page (${page}), your browser and screen size.` });
  const m = modal({ title: "Report a bug", body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: "Found something broken in LookBlog? Tell us and we’ll fix it." }),
    h("b", { class: "vis-label", text: "Where" }), area, what, steps, expected, h("div", { class: "gs-actions" }, shotBtn), shotPrev, shotIn, info, send) });
  setTimeout(() => what.focus(), 60);
  send.addEventListener("click", async () => {
    if (busy) return;
    if (what.value.trim().length < 10) { toast("Tell us a bit more about the bug."); return what.focus(); }
    send.disabled = true;
    let lang = "en";
    try { lang = localStorage.getItem("lb-lang") || "en"; } catch {}
    try {
      const { id } = await api("/api/bugs", { method: "POST", body: { what: what.value, steps: steps.value, expected: expected.value, area: area.value, page, screenshot: shot, screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`, lang } });
      m.close();
      toast(`Thanks! Bug report #${id} is with the LookBlog team. 🐞`);
    } catch (err) { toast(err.error || "Couldn’t send it."); send.disabled = false; }
  });
}
