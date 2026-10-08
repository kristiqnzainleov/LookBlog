/* =========================================================
   LookBlog front end: pop-ups, watching eyes, log in, sign up
   ========================================================= */

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,15}$/;

/* ---------- Talking to the server ---------- */
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { "Content-Type": "application/json", "X-LookBlog": "1" },
      credentials: "same-origin",
      ...options,
    });
  } catch {
    throw { error: "Can’t reach the LookBlog server. Start it with “npm start” and open http://localhost:3000" };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

/* ---------- Pop-ups: grow out of the center of the screen ---------- */
const overlays = {
  login: $("loginOverlay"),
  signup: $("signupOverlay"),
  forgot: $("forgotOverlay"),
  reset: $("resetOverlay"),
  code: $("codeOverlay"),
};
const firstField = { login: $("email"), signup: $("suName"), forgot: $("fpEmail"), reset: $("rpPassword"), code: $("tfaCode") };

function openModal(name) {
  // Carry the email over from the login form to "forgot password"
  if (name === "forgot" && !$("fpEmail").value && EMAIL_RE.test($("email").value.trim())) {
    $("fpEmail").value = $("email").value.trim();
  }
  Object.values(overlays).forEach((o) => o.classList.remove("open"));
  overlays[name].classList.add("open");
  overlays[name].setAttribute("aria-hidden", "false");
  setTimeout(() => firstField[name].focus(), 350);
}
function closeModals() {
  Object.values(overlays).forEach((o) => {
    o.classList.remove("open");
    o.setAttribute("aria-hidden", "true");
  });
  document.activeElement?.blur();
  updateShyness();
}

$("openLogin").addEventListener("click", () => openModal("login"));
$("openSignup").addEventListener("click", () => openModal("signup"));
// Came from an invite link ("Join LookBlog"): go straight to signing up
if (new URLSearchParams(location.search).has("join")) setTimeout(() => openModal("signup"), 300);
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModals));
document.querySelectorAll("[data-switch]").forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    openModal(a.dataset.switch);
  })
);
Object.values(overlays).forEach((o) =>
  o.addEventListener("click", (e) => { if (e.target === o) closeModals(); })
);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModals(); });


/* ---------- Show / hide password ---------- */
document.querySelectorAll(".toggle-pass").forEach((btn) => {
  const input = $(btn.dataset.target);
  btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the field
  btn.addEventListener("click", () => {
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    btn.textContent = hidden ? "hide" : "show";
    updateShyness();
  });
});

/* ---------- Form helpers ---------- */
function setError(input, el, msg) {
  el.textContent = msg || "";
  el.classList.remove("hint-ok");
  input.classList.toggle("invalid", Boolean(msg));
}
function showFormError(el, msg) {
  el.textContent = msg || "";
  el.hidden = !msg;
}
function shake(card) {
  card.classList.remove("shake");
  void card.offsetWidth;
  card.classList.add("shake");
}
function setBusy(btn, busy, label) {
  btn.disabled = busy;
  btn.textContent = label;
}

/* ---------- After logging in: go to the home feed ---------- */
function finishAuth(formEl, successEl, textEl, text) {
  formEl.hidden = true;
  textEl.textContent = text;
  successEl.hidden = false;
  setTimeout(() => location.assign("/feed"), 900);
}

/* ---------- Log in ---------- */
const loginForm = $("loginForm");
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email");
  const pass = $("password");
  const btn = $("submitBtn");
  const value = email.value.trim();
  let ok = true;

  if (!value) { setError(email, $("emailError"), "Please enter your email or username."); ok = false; }
  else if (value.includes("@") && !value.startsWith("@") && !EMAIL_RE.test(value)) {
    setError(email, $("emailError"), "That email address doesn’t look right."); ok = false;
  } else setError(email, $("emailError"), "");

  if (!pass.value) { setError(pass, $("passwordError"), "Please enter your password."); ok = false; }
  else setError(pass, $("passwordError"), "");

  showFormError($("loginError"), "");
  if (!ok) return shake($("loginCard"));

  setBusy(btn, true, "Logging in…");
  try {
    const r = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ login: value, password: pass.value, remember: $("remember").checked }),
    });
    // 2-step verification: the password was right, now the code
    if (r.needCode) return askCode(r.ticket, r.name);
    finishAuth(loginForm, $("loginSuccess"), $("loginSuccessText"), `Good to see you, ${r.user.name}.`);
  } catch (err) {
    showFormError($("loginError"), err.error || "Something went wrong. Try again.");
    shake($("loginCard"));
  } finally {
    setBusy(btn, false, "Log in");
  }
});

/* ---------- Sign up ---------- */
const signupForm = $("signupForm");
const su = {
  name: $("suName"),
  username: $("suUsername"),
  email: $("suEmail"),
  password: $("suPassword"),
};
const suError = (field) => signupForm.querySelector(`[data-error-for="${field}"]`);

function validateSignup() {
  const errors = {};
  const name = su.name.value.trim();
  const username = su.username.value.trim().replace(/^@/, "");
  const email = su.email.value.trim();
  const password = su.password.value;

  if (!name) errors.name = "What should we call you?";
  if (!USERNAME_RE.test(username)) errors.username = "3–15 characters: letters, numbers and _ only.";
  if (!EMAIL_RE.test(email)) errors.email = "That email address doesn’t look right.";
  if (password.length < 8) errors.password = "Use at least 8 characters.";
  return { errors, data: { name, username, email, password } };
}

function showSignupErrors(errors) {
  Object.keys(su).forEach((f) => setError(su[f], suError(f), errors[f]));
}

// Live check: is the username free?
let usernameTimer;
su.username.addEventListener("input", () => {
  clearTimeout(usernameTimer);
  const value = su.username.value.trim().replace(/^@/, "");
  const el = suError("username");
  if (!value) return setError(su.username, el, "");
  if (!USERNAME_RE.test(value)) return setError(su.username, el, "3–15 characters: letters, numbers and _ only.");
  usernameTimer = setTimeout(async () => {
    try {
      const { available } = await api(`/api/username-available?u=${encodeURIComponent(value)}`);
      if (su.username.value.trim().replace(/^@/, "") !== value) return; // user kept typing
      if (available) {
        setError(su.username, el, "");
        el.textContent = `@${value} is free`;
        el.classList.add("hint-ok");
      } else {
        setError(su.username, el, "That username is taken.");
      }
    } catch { /* server offline: the submit will explain */ }
  }, 350);
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("signupBtn");
  const { errors, data } = validateSignup();
  showSignupErrors(errors);
  showFormError($("signupError"), "");
  if (Object.keys(errors).length) return shake($("signupCard"));

  setBusy(btn, true, "Creating your account…");
  try {
    const { user } = await api("/api/register", { method: "POST", body: JSON.stringify(data) });
    finishAuth(signupForm, $("signupSuccess"), $("signupSuccessText"), `You’re @${user.username} now. Glad you’re here, ${user.name}.`);
  } catch (err) {
    if (err.errors) showSignupErrors(err.errors);
    else showFormError($("signupError"), err.error || "Something went wrong. Try again.");
    shake($("signupCard"));
  } finally {
    setBusy(btn, false, "Create account");
  }
});

/* ---------- Forgot password ---------- */
const forgotForm = $("forgotForm");
forgotForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("fpEmail");
  const email = input.value.trim();
  const btn = $("forgotBtn");
  showFormError($("forgotError"), "");

  if (!EMAIL_RE.test(email)) {
    setError(input, $("fpEmailError"), email ? "That email address doesn’t look right." : "Please enter your email.");
    return shake($("forgotCard"));
  }
  setError(input, $("fpEmailError"), "");

  setBusy(btn, true, "Checking…");
  try {
    // The right email opens "Choose a new password" right here (no email is sent)
    const r = await api("/api/forgot-password", { method: "POST", body: JSON.stringify({ email, code: $("fpCode").value.trim() || undefined }) });
    resetToken = r.token;
    $("resetTitle").textContent = `New password for @${r.username}`;
    openModal("reset");
  } catch (err) {
    if (err.errors?.email) setError(input, $("fpEmailError"), err.errors.email);
    else showFormError($("forgotError"), err.error || "Something went wrong. Try again.");
    // This account has 2-step verification: its code is needed too
    if (err.needCode) { $("fpCodeField").hidden = false; setTimeout(() => $("fpCode").focus(), 50); }
    shake($("forgotCard"));
  } finally {
    setBusy(btn, false, "Continue");
  }
});

// Reset the "forgot" pop-up whenever it is opened again
document.querySelectorAll('[data-switch="forgot"]').forEach((a) =>
  a.addEventListener("click", () => {
    forgotForm.hidden = false;
    $("forgotSuccess").hidden = true;
  })
);

/* ---------- New password (from the reset link) ---------- */
let resetToken = new URLSearchParams(location.search).get("reset");
const resetForm = $("resetForm");

if (resetToken) {
  // Take the token out of the address bar so it isn't left in history or shared by accident
  history.replaceState(null, "", location.pathname);
  openModal("reset");
}

resetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("rpPassword");
  const btn = $("resetBtn");
  showFormError($("resetError"), "");

  if (input.value.length < 8) {
    setError(input, $("rpPasswordError"), "Use at least 8 characters.");
    return shake($("resetCard"));
  }
  setError(input, $("rpPasswordError"), "");

  setBusy(btn, true, "Saving…");
  try {
    await api("/api/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: resetToken, password: input.value }),
    });
    resetForm.hidden = true;
    $("resetSuccess").hidden = false;
    setTimeout(() => location.assign("/feed"), 1200);
  } catch (err) {
    if (err.errors?.password) setError(input, $("rpPasswordError"), err.errors.password);
    else showFormError($("resetError"), err.error || "Something went wrong. Try again.");
    shake($("resetCard"));
  } finally {
    setBusy(btn, false, "Save new password");
  }
});

/* (Signing in with Google was removed: email or username and a password) */

/* ---------- 2-step verification code ---------- */
let codeTicket = null;
function askCode(ticket, name) {
  codeTicket = ticket;
  $("codeTitle").textContent = `Hi ${name}, enter your code`;
  $("tfaCode").value = "";
  setError($("tfaCode"), $("tfaError"), "");
  openModal("code");
}
$("codeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("tfaCode"), btn = $("codeBtn");
  const code = input.value.replace(/\s+/g, "");
  if (!/^\d{6,10}$/.test(code)) { setError(input, $("tfaError"), "Enter the 6–10 digit code."); return shake($("codeCard")); }
  setBusy(btn, true, "Checking…");
  try {
    await api("/api/login/code", { method: "POST", body: JSON.stringify({ ticket: codeTicket, code }) });
    location.assign("/feed");
  } catch (err) {
    setError(input, $("tfaError"), err.error || "That code isn’t right.");
    shake($("codeCard"));
    if (/log in again/i.test(err.error || "")) setTimeout(() => openModal("login"), 1200);
  } finally { setBusy(btn, false, "Log in"); }
});

// After deleting an account
if (new URLSearchParams(location.search).has("deleted")) {
  history.replaceState(null, "", "/");
  setTimeout(() => googleNote("Your account was deleted. Thanks for being part of LookBlog."), 400);
}
