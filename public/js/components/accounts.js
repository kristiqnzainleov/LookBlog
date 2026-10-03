// Several accounts on one browser: switch between them from the account menu, add another, log one out.
import { h, avatar, tick, toast, modal } from "../ui.js";
import { api } from "../api.js";

export async function paintAccounts(box) {
  let data;
  try { data = await api("/api/accounts"); } catch { return; }
  const others = data.accounts.filter((a) => !a.current);
  const rows = others.map((a) => {
    const row = h("button", { type: "button", class: "acc-row", title: `Switch to @${a.username}` },
      avatar(a, 34),
      h("span", { class: "acc-text" }, h("b", {}, a.name, tick(a, 13)), h("small", { text: "@" + a.username })),
      a.unread ? h("span", { class: "badge-count", text: a.unread > 99 ? "99+" : String(a.unread) }) : null);
    row.addEventListener("click", () => switchTo(a.username));
    // ✕ = log that account out of this browser (it disappears from the list)
    const rm = h("button", { type: "button", class: "acc-remove", title: `Remove @${a.username} from this browser`, "aria-label": `Remove @${a.username}` }, "×");
    let armed = false;
    rm.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!armed) { armed = true; rm.textContent = "Remove?"; rm.classList.add("armed"); setTimeout(() => { armed = false; rm.textContent = "×"; rm.classList.remove("armed"); }, 2500); return; }
      try { await api("/api/accounts/remove", { method: "POST", body: { username: a.username } }); toast(`@${a.username} was removed. You can add it again any time.`); paintAccounts(box); }
      catch (err) { toast(err.error || "Couldn’t remove it."); }
    });
    return h("div", { class: "acc-wrap" }, row, rm);
  });
  const add = h("button", { type: "button", class: "acc-add" }, h("span", { class: "acc-plus", text: "+" }), h("span", { text: "Switch account" }));
  add.addEventListener("click", () => openAddAccount(data.accounts.length >= data.max));
  box.replaceChildren(...(rows.length ? [h("p", { class: "acc-title", text: "Your accounts" }), ...rows] : []), add);
}

export async function switchTo(username) {
  try {
    await api("/api/accounts/switch", { method: "POST", body: { username } });
    location.href = "/feed";
  } catch (err) { toast(err.error || "Couldn’t switch."); }
}

function openAddAccount(full) {
  if (full) return toast("You can be logged in to up to 5 accounts. Log one out first.");
  const login = h("input", { type: "text", class: "text-input", placeholder: "Email or @username", autocomplete: "username" });
  const pass = h("input", { type: "password", class: "text-input", placeholder: "Password", autocomplete: "current-password" });
  const code = h("input", { type: "text", class: "text-input", placeholder: "2-step code", inputmode: "numeric", autocomplete: "one-time-code", hidden: true });
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const go = h("button", { type: "submit", class: "btn btn-primary btn-full", text: "Log in and switch" });
  const form = h("form", { class: "create-form", novalidate: true },
    h("p", { class: "create-hint", text: "Log in to another account. You stay logged in to both and can switch back any time from this menu." }), login, pass, code, err, go,
    h("a", { class: "acc-signup", href: "/?add=1", text: "Don’t have another account? Sign up" }));
  const m = modal({ title: "Switch account", body: form });
  setTimeout(() => login.focus(), 50);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    go.disabled = true;
    try {
      await api("/api/accounts/add", { method: "POST", body: { login: login.value, password: pass.value, code: code.value.trim() || undefined } });
      m.close();
      location.href = "/feed";
    } catch (ex) {
      err.textContent = ex.error || "Couldn’t log in."; err.hidden = false; go.disabled = false;
      if (ex.needCode) { code.hidden = false; code.focus(); }
    }
  });
}
