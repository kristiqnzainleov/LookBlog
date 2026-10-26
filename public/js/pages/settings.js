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
// Set up an authenticator app: scan the QR code (or type the key), then type the first code it shows
function showAppSetup({ secret, uri }, password, done) {
  const qrBox = h("div", { class: "totp-qr" }, h("span", { class: "muted", text: "Loading…" }));
  import("../components/qr.js").then(({ qrSvg }) => qrSvg(uri, 200)).then((svg) => qrBox.replaceChildren(svg)).catch(() => qrBox.replaceChildren(h("span", { class: "muted", text: "Couldn’t draw the QR code — type the key instead." })));
  const keyText = secret.replace(/(.{4})/g, "$1 ").trim();
  const copy = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Copy key" });
  copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(secret); copy.textContent = "Copied!"; } catch {} });
  const code = h("input", { type: "text", class: "text-input totp-code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "123456" });
  const go = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Turn on" });
  const m = modal({ title: "Authenticator app", body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: "1. Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…) and scan this code." }),
    qrBox,
    h("p", { class: "create-hint" }, "Can’t scan? Add it by hand with this key: ", h("code", { class: "totp-key", text: keyText }), " ", copy),
    h("p", { class: "create-hint", text: "2. Type the 6-digit code the app shows now." }),
    code, go) });
  const run = async () => {
    go.disabled = true;
    try {
      await api("/api/me/2fa", { method: "POST", body: { action: "app-confirm", password, code: code.value } });
      m.close(); toast("2-step verification is on."); done();
    } catch (err) { toast(err.error || "That code isn’t right."); go.disabled = false; code.select(); }
  };
  go.addEventListener("click", run);
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  setTimeout(() => code.focus(), 80);
}
function showRecovery(codes) {
  const text = codes.join("\n");
  const copy = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "Copy" });
  copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(text); copy.textContent = "Copied!"; } catch {} });
  const save = h("a", { class: "btn btn-sm btn-outline-light", download: "lookblog-recovery-codes.txt", href: "data:text/plain;charset=utf-8," + encodeURIComponent("LookBlog recovery codes for @" + state.me.username + "\nEach one works once.\n\n" + text), text: "Save as a file" });
  modal({ title: "Your recovery codes", body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: "Write them down or save them now — you won’t see them again. Each code works once. Making new codes stops these ones." }),
    h("div", { class: "code-box rec-codes" }, ...codes.map((c) => h("span", { text: c }))),
    h("div", { class: "set-row" }, copy, save)) });
}

export function settingsPage(view) {
  document.title = "Settings / LookBlog";
  view.classList.add("page-settings");
  const twoBox = h("div", {}, spinner());
  view.append(h("header", { class: "column-head" }, h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "Settings" }), h("p", { class: "page-sub", text: `@${state.me.username} · ${state.me.email || ""}` })))));

  async function paint2fa() {
    const { on, kind } = await api("/api/me/2fa");
    const status = h("p", { class: "set-status " + (on ? "on" : "off") }, h("span", { class: "dot" }),
      !on ? "Off" : kind === "app" ? "On — a code from your authenticator app is needed to log in" : "On, with an old fixed code — switch to an authenticator app, it’s much safer");
    const setup = h("button", { type: "button", class: "btn btn-primary btn-sm", text: !on ? "Turn on with an authenticator app" : kind === "app" ? "Move to a new phone or app" : "Switch to an authenticator app" });
    const off = on ? h("button", { type: "button", class: "btn btn-sm btn-danger", text: "Turn off" }) : null;
    setup.addEventListener("click", () => askPassword("2-step verification", async (password, m) => {
      const r = await api("/api/me/2fa", { method: "POST", body: { action: "app-start", password } });
      m.close();
      showAppSetup(r, password, paint2fa);
    }));
    off?.addEventListener("click", () => askPassword("Turn off 2-step verification", async (password, m) => { await api("/api/me/2fa", { method: "POST", body: { action: "disable", password } }); m.close(); toast("2-step verification is off."); paint2fa(); }));
    twoBox.replaceChildren(status, h("div", { class: "set-row" }, setup, off));
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

  // AI filter: posts labelled "AI-generated" can be hidden
  const aiState = h("span", { class: "set-state" });
  const aiBtn = h("button", { type: "button", class: "btn btn-sm btn-outline-light" });
  const paintAi = () => {
    aiState.textContent = state.me.hideAi ? "Hidden — you’ll see “AI-generated post hidden” with a button to show it." : "Shown, with a 🤖 AI-generated label.";
    aiBtn.textContent = state.me.hideAi ? "Show AI content" : "Hide AI content";
  };
  aiBtn.addEventListener("click", async () => {
    try { const r = await api("/api/me/ai", { method: "POST", body: { hide: !state.me.hideAi } }); state.me.hideAi = r.hideAi; paintAi(); toast(r.hideAi ? "AI-generated posts are hidden." : "AI-generated posts are shown again."); }
    catch (err) { toast(err.error || "Couldn’t change it."); }
  });
  paintAi();

  // Password: the current one, then the new one twice (an eye in each box shows what you typed)
  const pwField = (ph, ac, label) => {
    const input = h("input", { type: "password", class: "pw-input", placeholder: ph, autocomplete: ac, maxlength: 128, "aria-label": label });
    const eye = h("button", { type: "button", class: "pw-eye", title: "Show", "aria-label": "Show password", text: "👁" });
    eye.addEventListener("click", () => { const show = input.type === "password"; input.type = show ? "text" : "password"; eye.classList.toggle("on", show); eye.title = show ? "Hide" : "Show"; input.focus(); });
    return { input, el: h("label", { class: "pw-field" }, h("span", { class: "pw-label", text: label }), h("span", { class: "pw-box" }, input, eye)) };
  };
  const now = pwField("Your current password", "current-password", "Current password");
  const neu = pwField("At least 8 characters", "new-password", "New password");
  const again = pwField("Type it once more", "new-password", "New password again");
  const pwNow = now.input, pwNew = neu.input, pwAgain = again.input;
  // How strong the new one is
  const meter = h("div", { class: "pw-meter" }, h("i"), h("i"), h("i"), h("i"));
  const meterText = h("small", { class: "pw-meter-text muted" });
  pwNew.addEventListener("input", () => {
    const v = pwNew.value;
    const score = !v ? 0 : Math.min(4, (v.length >= 8) + (v.length >= 12) + (/[A-Z]/.test(v) && /[a-z]/.test(v)) + (/\d/.test(v)) + (/[^A-Za-z0-9]/.test(v)) - (v.length < 8 ? 1 : 0));
    meter.dataset.score = String(Math.max(0, score));
    meterText.textContent = !v ? "" : v.length < 8 ? "Too short" : ["Weak", "Weak", "Okay", "Good", "Strong 💪"][score];
  });
  const pwErr = h("p", { class: "form-error", role: "alert", hidden: true });
  const pwBtn = h("button", { type: "button", class: "btn btn-primary", text: "Change password" });
  pwBtn.addEventListener("click", async () => {
    pwErr.hidden = true;
    const fail = (t) => { pwErr.textContent = t; pwErr.hidden = false; };
    if (pwNew.value.length < 8) return fail("Use at least 8 characters.");
    if (pwNew.value !== pwAgain.value) return fail("The two new passwords aren’t the same.");
    pwBtn.disabled = true;
    try {
      await api("/api/me/password", { method: "POST", body: { current: pwNow.value, password: pwNew.value } });
      [pwNow, pwNew, pwAgain].forEach((x) => (x.value = ""));
      pwNew.dispatchEvent(new Event("input"));
      toast("Password changed. Other devices were logged out.");
    } catch (err) { fail(err.error || "Couldn’t change it."); }
    pwBtn.disabled = false;
  });
  pwAgain.addEventListener("keydown", (e) => { if (e.key === "Enter") pwBtn.click(); });

  // Recovery codes: the way back in if you forget your password
  const recBox = h("div", {}, spinner());
  const paintRec = () => api("/api/me/recovery-codes").then(({ left, at }) => {
    const make = h("button", { type: "button", class: "btn btn-sm btn-primary", text: left ? "Make new codes" : "Make my recovery codes" });
    make.addEventListener("click", () => {
      const go = async (password, m) => {
        const { codes } = await api("/api/me/recovery-codes", { method: "POST", body: { password } });
        m?.close(); showRecovery(codes); paintRec();
      };
      if (state.me.googleOnly) go("", null).catch((err) => toast(err.error || "Couldn’t make them.")); else askPassword("Recovery codes", go);
    });
    recBox.replaceChildren(
      h("p", { class: "set-status " + (left ? "on" : "off") }, h("span", { class: "dot" }), left ? `${left} of 8 codes left${at ? " · made " + new Date(at).toLocaleDateString("en-US", { dateStyle: "medium" }) : ""}` : "No codes yet — make them now, so you can get back in if you forget your password"),
      h("div", { class: "set-row" }, make));
  }).catch(() => recBox.replaceChildren(h("p", { class: "muted", text: "Couldn’t load this." })));
  paintRec();

  // Activity status: show (or not) when I'm online and when I was last online
  const statusOn = () => !state.me.hideStatus;
  const statusState = h("p", { class: "set-status" }, h("span", { class: "dot" }));
  const statusBtn = h("button", { type: "button", class: "btn btn-sm btn-outline-light" });
  const paintStatus = () => { statusState.className = "set-status " + (statusOn() ? "on" : "off"); statusState.replaceChildren(h("span", { class: "dot" }), statusOn() ? "Shown — people can see when you’re online and when you were last online" : "Hidden — you look offline to everyone"); statusBtn.textContent = statusOn() ? "Hide my activity status" : "Show my activity status"; };
  statusBtn.addEventListener("click", async () => {
    try { const r = await api("/api/me/status", { method: "POST", body: { hide: statusOn() } }); state.me.hideStatus = r.hideStatus; paintStatus(); toast(r.hideStatus ? "Your activity status is hidden." : "Your activity status is shown."); }
    catch (err) { toast(err.error || "Couldn’t change it."); }
  });
  paintStatus();

  // A copy of my data
  const dl = h("a", { class: "btn btn-sm btn-outline-light", href: "/api/me/export", download: "", text: "⬇️ Download my data" });

  view.append(
    section("Email", "You log in with it.", emailNow, h("div", { class: "set-row" }, emailIn, emailBtn)),
    section("Password", "Changing it logs you out on your other devices. (Signed up with Google? Leave the current one empty to set a password.)", h("div", { class: "set-pass" }, now.el, neu.el, h("div", { class: "pw-strength" }, meter, meterText), again.el, pwErr, pwBtn)),
    section("Two-step verification (2FA)", "When it’s on, LookBlog asks for a code from an authenticator app on your phone after your password — so knowing your password (or email) isn’t enough to get into your account. The code changes every 30 seconds.", twoBox),
    section("🔑 Recovery codes", "If you forget your password, one of these codes (with your email or @username) lets you choose a new one. Each code works once. Keep them somewhere safe — not in your messages here.", recBox),
    section("Preferences", null, h("div", { class: "set-row" }, lang, priv)),
    section("🟢 Activity status", "Whether people see the green dot when you’re online, and “Last online …” when you’re not.", statusState, h("div", { class: "set-row" }, statusBtn)),
    section("📦 Your data", "Download a copy of your account: your profile, posts, comments, stories, messages you sent, and more (a JSON file).", h("div", { class: "set-row" }, dl)),
    section("🔞 Sensitive content (NSFW)", "LookBlog checks photos and videos when they’re posted. Sensitive ones (nudity and other 18+ things) are blurred and aren’t recommended to people who didn’t ask for them.", h("div", { class: "set-row" }, nsfwState, nsfwBtn)),
    section("🤖 AI filter", "Photos and videos made with AI tools are found automatically (from the marks those tools leave in the file), and anyone can mark their post as “Made with AI”. They get a 🤖 AI-generated label.", h("div", { class: "set-row" }, aiState, aiBtn)),
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
