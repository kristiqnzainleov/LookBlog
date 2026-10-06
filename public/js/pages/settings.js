// /settings — two-step verification, language, privacy, and deleting your account.
import { h, toast, modal, spinner } from "../ui.js";
import { api } from "../api.js";
import { state } from "../state.js";

const REASONS = [
  ["break", "I just need a break"], ["too-much-time", "I spend too much time here"], ["privacy", "I’m worried about my privacy"],
  ["not-useful", "I don’t find it useful"], ["bugs", "Too many bugs or problems"], ["safety", "Someone is bothering me"],
  ["other-account", "I have another account"], ["other", "Something else"],
];

function section(title, sub, ...kids) {
  return h("section", { class: "set-card" }, h("h2", { text: title }), sub ? h("p", { class: "muted set-sub", text: sub }) : null, ...kids);
}
// Asks for the password before something sensitive
function askPassword(title, onOk) {
  const pw = h("input", { type: "password", class: "text-input", placeholder: "Your password", autocomplete: "current-password" });
  const go = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Continue" });
  const m = modal({ title, body: h("div", { class: "create-form" }, h("p", { class: "create-hint", text: "For your safety, enter your password first." }), pw, go) });
  const run = async () => { go.disabled = true; try { await onOk(pw.value, m); } catch (err) { toast(err.error || "Something went wrong."); go.disabled = false; } };
  go.addEventListener("click", run);
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  setTimeout(() => pw.focus(), 60);
}
function showCode(code) {
  const box = h("div", { class: "code-box", text: code.replace(/(\d{3})(?=\d)/g, "$1 ") });
  const copy = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Copy" });
  copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(code); copy.textContent = "Copied!"; } catch {} });
  modal({ title: "Your 2-step code", body: h("div", { class: "create-form" }, h("p", { class: "create-hint", text: "You’ll be asked for this code every time you log in (and to reset your password). Keep it somewhere safe. You can see it again here in Settings." }), box, copy) });
}

export function settingsPage(view) {
  document.title = "Settings / LookBlog";
  view.classList.add("page-settings");
  const twoBox = h("div", {}, spinner());
  view.append(h("header", { class: "column-head" }, h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "Settings" }), h("p", { class: "page-sub", text: `@${state.me.username} · ${state.me.email || ""}` })))));

  async function paint2fa() {
    const { on } = await api("/api/me/2fa");
    const status = h("p", { class: "set-status " + (on ? "on" : "off") }, h("span", { class: "dot" }), on ? "On — your code is needed to log in" : "Off");
    const own = h("input", { type: "text", inputmode: "numeric", class: "text-input", maxlength: 10, placeholder: "Your own code (6–10 digits)", autocomplete: "off" });
    const make = h("button", { type: "button", class: "btn btn-primary btn-sm", text: on ? "Get a new code from LookBlog" : "Turn on with a code from LookBlog" });
    const setOwn = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: on ? "Change to my code" : "Turn on with my code" });
    const reveal = on ? h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Show my code" }) : null;
    const off = on ? h("button", { type: "button", class: "btn btn-sm btn-danger", text: "Turn off" }) : null;
    const enable = (code) => askPassword("2-step verification", async (password, m) => {
      const r = await api("/api/me/2fa", { method: "POST", body: { action: "enable", password, code } });
      m.close(); showCode(r.code); paint2fa();
    });
    make.addEventListener("click", () => enable(""));
    setOwn.addEventListener("click", () => {
      const v = own.value.replace(/\s+/g, "");
      if (!/^\d{6,10}$/.test(v)) { toast("Use 6 to 10 digits."); return own.focus(); }
      enable(v);
    });
    reveal?.addEventListener("click", () => askPassword("Show my code", async (password, m) => { const r = await api("/api/me/2fa", { method: "POST", body: { action: "show", password } }); m.close(); showCode(r.code); }));
    off?.addEventListener("click", () => askPassword("Turn off 2-step verification", async (password, m) => { await api("/api/me/2fa", { method: "POST", body: { action: "disable", password } }); m.close(); toast("2-step verification is off."); paint2fa(); }));
    twoBox.replaceChildren(status,
      h("div", { class: "set-row" }, make, reveal, off),
      h("b", { class: "vis-label", text: on ? "Or choose your own code" : "Or choose your own code" }),
      h("div", { class: "set-row" }, own, setOwn));
  }
  paint2fa().catch(() => twoBox.replaceChildren(h("p", { class: "muted", text: "Couldn’t load this." })));

  const lang = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "🌐 Language", onclick: () => import("../i18n.js").then((m) => m.openLanguage()) });
  const priv = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "🔒 Privacy & blocking", onclick: () => import("../components/privacy.js").then((m) => m.openPrivacy()) });
  const del = h("button", { type: "button", class: "btn btn-danger", text: "Delete my account" });
  del.addEventListener("click", openDelete);

  // Email: the address you log in with and get password reset links at
  const subLine = view.querySelector(".page-sub");
  const emailNow = h("p", { class: "set-status on" }, h("span", { class: "dot" }), state.me.email || "No email yet");
  const emailIn = h("input", { type: "email", class: "text-input", placeholder: "New email address", autocomplete: "email", maxlength: 254 });
  const emailBtn = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "Change email" });
  emailBtn.addEventListener("click", () => {
    const email = emailIn.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("That email address doesn’t look right."); return emailIn.focus(); }
    askPassword("Change your email", async (password, m) => {
      const { user } = await api("/api/me/email", { method: "POST", body: { email, password } });
      state.me.email = user.email;
      emailNow.lastChild.textContent = user.email;
      subLine.textContent = `@${state.me.username} · ${user.email}`;
      emailIn.value = "";
      m.close();
      toast("Email changed.");
    });
  });
  emailIn.addEventListener("keydown", (e) => { if (e.key === "Enter") emailBtn.click(); });

  // Sensitive (18+) content: blurred by default, and not recommended. Grown-ups can choose to see it plainly.
  const nsfwState = h("span", { class: "set-state" });
  const nsfwBtn = h("button", { type: "button", class: "btn btn-sm btn-outline-light" });
  const paintNsfw = () => {
    nsfwState.textContent = state.me.showNsfw ? "Shown without blur (and can be recommended to you)" : "Blurred — tap a post to see it. Not recommended to you.";
    nsfwBtn.textContent = state.me.showNsfw ? "Blur it again" : "Show without blur";
  };
  nsfwBtn.addEventListener("click", async () => {
    const show = !state.me.showNsfw;
    if (show && !confirm("Are you 18 or older? Sensitive content can show nudity and other things for adults.")) return;
    try { const r = await api("/api/me/nsfw", { method: "POST", body: { show, adult: show } }); state.me.showNsfw = r.showNsfw; paintNsfw(); toast(r.showNsfw ? "Sensitive content is shown without blur." : "Sensitive content is blurred again."); }
    catch (err) { toast(err.error || "Couldn’t change it."); }
  });
  paintNsfw();

  view.append(
    section("Email", "You log in with it and get password reset links there.", emailNow, h("div", { class: "set-row" }, emailIn, emailBtn)),
    section("Two-step verification (2FA)", "When it’s on, LookBlog asks for your code after your password — so knowing your password (or email) isn’t enough to get into your account. LookBlog can make the code for you, or you can pick your own.", twoBox),
    section("Preferences", null, h("div", { class: "set-row" }, lang, priv)),
    section("⚠️ Sensitive content isn’t allowed", "Violence, blood, weapons, self-harm and other disturbing content go against the LookBlog rules. LookBlog checks posts, stories, comments and photos when they’re uploaded and refuses it; if something gets through and people report it, it’s taken down."),
    section("🔞 Sensitive content (NSFW)", "LookBlog checks photos and videos when they’re posted. Sensitive ones (nudity and other 18+ things) are blurred and aren’t recommended to people who didn’t ask for them.", h("div", { class: "set-row" }, nsfwState, nsfwBtn)),
    section("Delete account", "This removes your profile, posts, videos, songs, messages and everything else you made. It can’t be undone.", del));
}
settingsPage.navName = () => "";

function openDelete() {
  let reason = null;
  const list = h("div", { class: "report-list", role: "radiogroup" }, ...REASONS.map(([id, label]) => {
    const b = h("button", { type: "button", role: "radio", class: "report-reason", "aria-checked": "false", text: label });
    b.addEventListener("click", () => {
      reason = id;
      list.querySelectorAll("button").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-checked", String(x === b)); });
      paint();
    });
    return b;
  }));
  const details = h("textarea", { class: "text-input", rows: 3, maxlength: 1000, placeholder: "Anything you’d like to tell us? (needed if you picked “Something else”)" });
  const confirm = h("input", { type: "text", class: "text-input", placeholder: `Type your username: ${state.me.username}`, autocomplete: "off", spellcheck: "false" });
  const pw = h("input", { type: "password", class: "text-input", placeholder: "Your password", autocomplete: "current-password" });
  const go = h("button", { type: "button", class: "btn btn-danger btn-full", text: "Delete my account forever", disabled: true });
  const paint = () => { go.disabled = !reason || confirm.value.trim().toLowerCase() !== state.me.username.toLowerCase() || !pw.value; };
  confirm.addEventListener("input", paint); pw.addEventListener("input", paint);
  modal({ title: "Delete your account", body: h("div", { class: "create-form" },
    h("b", { class: "vis-label", text: "Why are you leaving?" }), list, details,
    h("b", { class: "vis-label", text: "Confirm" }), confirm, pw,
    h("p", { class: "create-hint", text: "Everything you made is removed for good. Groups you own go to another member. Only your reason is kept (without your name), so we can do better." }), go) });
  go.addEventListener("click", async () => {
    go.disabled = true; go.textContent = "Deleting…";
    try {
      await api("/api/me/delete", { method: "POST", body: { reason, details: details.value, confirm: confirm.value, password: pw.value } });
      location.assign("/?deleted=1");
    } catch (err) { toast(err.error || "Couldn’t delete the account."); go.textContent = "Delete my account forever"; paint(); }
  });
}
