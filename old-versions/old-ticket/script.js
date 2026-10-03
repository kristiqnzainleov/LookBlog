const card = document.getElementById("loginCard");
const logo = document.getElementById("logo");
const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passInput = document.getElementById("password");
const emailError = document.getElementById("emailError");
const passError = document.getElementById("passwordError");
const togglePass = document.getElementById("togglePass");
const submitBtn = document.getElementById("submitBtn");
const success = document.getElementById("success");
const eyes = [...document.querySelectorAll(".eye")];

/* ---------- The ticket grows out of the center on load ---------- */
window.addEventListener("load", () => {
  requestAnimationFrame(() => card.classList.add("show"));
  setTimeout(() => emailInput.focus(), 400);
});

/* ---------- Eyes in the logo ---------- */
function lookAt(x, y) {
  eyes.forEach((eye) => {
    const r = eye.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const angle = Math.atan2(dy, dx);
    const dist = Math.min(Math.hypot(dx, dy) / 10, r.width * 0.2);
    eye.firstElementChild.style.transform =
      `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px))`;
  });
}

// Follow the mouse
document.addEventListener("mousemove", (e) => lookAt(e.clientX, e.clientY));

// Read along while the user types their email
function lookAtTyping() {
  const r = emailInput.getBoundingClientRect();
  const x = r.left + 14 + Math.min(emailInput.value.length * 8.5, r.width - 28);
  lookAt(x, r.top + r.height / 2);
}
emailInput.addEventListener("input", lookAtTyping);
emailInput.addEventListener("focus", lookAtTyping);

// Cover the eyes while the password is typed, peek when it is shown
function updateShyness() {
  const typingPassword = document.activeElement === passInput;
  const visible = passInput.type === "text";
  logo.classList.toggle("shy", typingPassword && !visible);
  logo.classList.toggle("peek", typingPassword && visible);
}
passInput.addEventListener("focus", updateShyness);
passInput.addEventListener("blur", () => setTimeout(updateShyness, 0));

// Blink now and then
function blink() {
  if (!logo.classList.contains("shy")) {
    eyes.forEach((eye) => eye.classList.add("blink"));
    setTimeout(() => eyes.forEach((eye) => eye.classList.remove("blink")), 140);
  }
  setTimeout(blink, 2500 + Math.random() * 4000);
}
setTimeout(blink, 3000);

/* ---------- Show / hide password ---------- */
togglePass.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the field
togglePass.addEventListener("click", () => {
  const hidden = passInput.type === "password";
  passInput.type = hidden ? "text" : "password";
  togglePass.textContent = hidden ? "hide" : "show";
  updateShyness();
});

/* ---------- Validation ---------- */
function setError(input, el, msg) {
  el.textContent = msg;
  input.classList.toggle("invalid", Boolean(msg));
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const pass = passInput.value;
  let ok = true;

  if (!email) {
    setError(emailInput, emailError, "Please enter your email or username.");
    ok = false;
  } else if (email.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setError(emailInput, emailError, "That email address doesn’t look right.");
    ok = false;
  } else {
    setError(emailInput, emailError, "");
  }

  if (pass.length < 6) {
    setError(passInput, passError, "Password must be at least 6 characters.");
    ok = false;
  } else {
    setError(passInput, passError, "");
  }

  if (!ok) {
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");
    return;
  }

  // Simulated server request (a real backend comes later)
  submitBtn.disabled = true;
  submitBtn.textContent = "Logging in…";
  setTimeout(() => {
    form.hidden = true;
    success.hidden = false;
    logo.classList.remove("shy", "peek");
  }, 1000);
});
