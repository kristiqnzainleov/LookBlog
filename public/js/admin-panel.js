// /admin-panel — the LookBlog admin panel: its own log in (separate from LookBlog accounts).
// Registering as an admin needs the setup code. Inside: reports, verification, support, bugs, accounts and the team.
import { h, toast } from "./ui.js";
import { api } from "./api.js";
import { state, emit } from "./state.js";

window.__lbPanel = true; // the API helper stays on this page when a session ends
const root = document.getElementById("panel");

async function start() {
  let me;
  try { me = await api("/api/panel/me"); } catch { me = { admin: null, canRegister: false }; }
  if (me.admin) return openPanel(me.admin);
  showLogin(me.canRegister);
}

/* ---------- Log in / register ---------- */
function showLogin(canRegister) {
  document.title = "Log in · LookBlog Admin";
  let mode = "login";
  const box = h("div", { class: "panel-auth-card" });
  const paint = () => {
    const err = h("p", { class: "form-error" });
    const username = h("input", { class: "text-input", placeholder: "Admin username", autocomplete: "username", maxlength: 20 });
    const name = h("input", { class: "text-input", placeholder: "Your name", maxlength: 50 });
    const password = h("input", { class: "text-input", type: "password", placeholder: mode === "login" ? "Password" : "Password (10+ characters)", autocomplete: mode === "login" ? "current-password" : "new-password" });
    const code = h("input", { class: "text-input", placeholder: "Setup code", autocomplete: "off", spellcheck: "false" });
    // 2-step verification (required): the app's code, or a recovery code; on the first log in, the QR code to set it up
    const otp = h("input", { class: "text-input totp-code", placeholder: "123456", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 12, hidden: true });
    const setupBox = h("div", { class: "panel-totp", hidden: true });
    const go = h("button", { type: "submit", class: "btn btn-primary btn-full", text: mode === "login" ? "Log in" : "Create admin account" });
    const form = h("form", { class: "create-form" },
      h("div", { class: "panel-logo" }, h("span", { class: "panel-shield", text: "🛡️" }), h("b", {}, "Look", h("em", { text: "Blog" })), h("span", { class: "panel-tag", text: "Admin" })),
      h("h1", { text: mode === "login" ? "Admin log in" : "Register as admin" }),
      h("p", { class: "muted", text: mode === "login" ? "This is the LookBlog team’s panel. It has its own accounts." : "You need the setup code from the site owner. The first admin becomes the owner." }),
      username, mode === "register" ? name : null, password, mode === "register" ? code : null, setupBox, otp, err, go,
      canRegister ? h("button", { type: "button", class: "btn btn-sm btn-outline-light btn-full", text: mode === "login" ? "New admin? Register with the setup code" : "I already have an admin account", onclick: () => { mode = mode === "login" ? "register" : "login"; paint(); } }) : null,
      h("a", { class: "muted panel-back", href: "/", text: "← Back to LookBlog" }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      go.disabled = true;
      try {
        const body = mode === "login" ? { username: username.value, password: password.value, code: otp.hidden ? undefined : otp.value } : { username: username.value, name: name.value, password: password.value, code: code.value };
        const r = await api(mode === "login" ? "/api/panel/login" : "/api/panel/register", { method: "POST", body });
        if (r.recoveryCodes) await showPanelRecovery(r.recoveryCodes);
        openPanel(r.admin);
      } catch (ex) {
        err.textContent = ex.error || "Something went wrong."; go.disabled = false;
        if (ex.needCode || ex.needSetup) { otp.hidden = false; otp.value = ""; go.textContent = "Continue"; setTimeout(() => otp.focus(), 30); }
        if (ex.needSetup && ex.setup && setupBox.hidden) {
          setupBox.hidden = false;
          const qr = h("div", { class: "totp-qr" });
          import("./components/qr.js").then(({ qrSvg }) => qrSvg(ex.setup.uri, 180)).then((svg) => qr.replaceChildren(svg)).catch(() => {});
          setupBox.replaceChildren(h("b", { text: "Set up 2-step verification" }),
            h("p", { class: "muted", text: "Scan this with an authenticator app (Google Authenticator, Authy, 1Password…), then type the code it shows." }),
            qr, h("p", { class: "muted" }, "Or add this key by hand: ", h("code", { class: "totp-key", text: ex.setup.secret.replace(/(.{4})/g, "$1 ").trim() })));
        }
      }
    });
    box.replaceChildren(form);
    setTimeout(() => username.focus(), 30);
  };
  paint();
  root.replaceChildren(h("main", { class: "panel-auth" }, box));
}

// Shown once, right after 2-step verification is set up: codes that work if the phone is lost
function showPanelRecovery(codes) {
  return new Promise((done) => {
    const ok = h("button", { type: "button", class: "btn btn-primary btn-full", text: "I saved them" });
    const save = h("a", { class: "btn btn-sm btn-outline-light", download: "lookblog-admin-recovery-codes.txt", href: "data:text/plain;charset=utf-8," + encodeURIComponent("LookBlog admin panel recovery codes\nEach one works once, instead of the app's code.\n\n" + codes.join("\n")), text: "Save as a file" });
    const card = h("div", { class: "panel-auth-card" }, h("div", { class: "create-form" },
      h("h1", { text: "Your recovery codes" }),
      h("p", { class: "muted", text: "If you lose your phone, type one of these instead of the app's code. Each works once. Save them somewhere safe now — you won’t see them again." }),
      h("div", { class: "code-box rec-codes" }, ...codes.map((c) => h("span", { text: c }))), save, ok));
    root.replaceChildren(h("main", { class: "panel-auth" }, card));
    ok.addEventListener("click", () => done());
  });
}

/* ---------- The panel ---------- */
async function openPanel(admin) {
  // The admin page reads who is using it from here
  state.me = { id: admin.id, username: admin.username, name: admin.name, avatar: null, admin: true, owner: admin.role === "owner", panel: true, role: admin.role };
  const logout = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Log out" });
  logout.addEventListener("click", async () => { await api("/api/panel/logout", { method: "POST" }).catch(() => {}); location.reload(); });
  const view = h("main", { class: "view panel-view" });
  root.replaceChildren(
    h("header", { class: "panel-top" },
      h("a", { class: "panel-logo small", href: "/admin-panel" }, h("span", { class: "panel-shield", text: "🛡️" }), h("b", {}, "Look", h("em", { text: "Blog" })), h("span", { class: "panel-tag", text: "Admin" })),
      h("div", { class: "panel-who" }, h("span", {}, h("b", { text: admin.name }), h("small", { class: "muted", text: ` @${admin.username} · ${admin.role}` })), admin.role === "owner" ? teamLogBtn() : null, logout)),
    view);
  const { adminPage } = await import("./pages/admin.js");
  adminPage(view, null, new URLSearchParams(location.search));
  // Links to profiles and posts open the site in a new tab
  view.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='/']");
    if (a && !a.getAttribute("href").startsWith("/admin-panel")) { e.preventDefault(); window.open(a.href, "_blank", "noopener"); }
  });
  // Panel accounts don't get live events, so check what's waiting every 30 seconds
  setInterval(async () => { try { emit("admin:update", { counts: (await api("/api/admin")).counts }); } catch {} }, 30 * 1000);
}

// The owner can read what the team did (bans, deletions, report decisions, new admins)
function teamLogBtn() {
  const b = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "📜 Team log" });
  b.addEventListener("click", async () => {
    const { modal, timeEl } = await import("./ui.js");
    try {
      const { log } = await api("/api/panel/log");
      modal({ title: "Team log", wide: true, body: h("div", { class: "team-log" }, ...(log.length ? log.map((x) => h("div", { class: "team-log-row" },
        h("span", { class: "muted" }, timeEl(x.at)), h("b", { text: "@" + (x.byName || "?") }), h("code", { text: x.action }), h("span", { text: x.note || "" }))) : [h("p", { class: "muted", text: "Nothing yet." })])) });
    } catch (ex) { toast(ex.error || "Couldn’t load the log."); }
  });
  return b;
}

start();
