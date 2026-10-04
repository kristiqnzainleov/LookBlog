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
    const go = h("button", { type: "submit", class: "btn btn-primary btn-full", text: mode === "login" ? "Log in" : "Create admin account" });
    const form = h("form", { class: "create-form" },
      h("div", { class: "panel-logo" }, h("span", { class: "panel-shield", text: "🛡️" }), h("b", {}, "Look", h("em", { text: "Blog" })), h("span", { class: "panel-tag", text: "Admin" })),
      h("h1", { text: mode === "login" ? "Admin log in" : "Register as admin" }),
      h("p", { class: "muted", text: mode === "login" ? "This is the LookBlog team’s panel. It has its own accounts." : "You need the setup code from the site owner. The first admin becomes the owner." }),
      username, mode === "register" ? name : null, password, mode === "register" ? code : null, err, go,
      canRegister ? h("button", { type: "button", class: "btn btn-sm btn-outline-light btn-full", text: mode === "login" ? "New admin? Register with the setup code" : "I already have an admin account", onclick: () => { mode = mode === "login" ? "register" : "login"; paint(); } }) : null,
      h("a", { class: "muted panel-back", href: "/", text: "← Back to LookBlog" }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      go.disabled = true;
      try {
        const body = mode === "login" ? { username: username.value, password: password.value } : { username: username.value, name: name.value, password: password.value, code: code.value };
        const { admin } = await api(mode === "login" ? "/api/panel/login" : "/api/panel/register", { method: "POST", body });
        openPanel(admin);
      } catch (ex) { err.textContent = ex.error || "Something went wrong."; go.disabled = false; }
    });
    box.replaceChildren(form);
    setTimeout(() => username.focus(), 30);
  };
  paint();
  root.replaceChildren(h("main", { class: "panel-auth" }, box));
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
      h("div", { class: "panel-who" }, h("span", {}, h("b", { text: admin.name }), h("small", { class: "muted", text: ` @${admin.username} · ${admin.role}` })), logout)),
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

start();
