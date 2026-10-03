const card = document.getElementById("loginCard");
const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passInput = document.getElementById("password");
const emailError = document.getElementById("emailError");
const passError = document.getElementById("passwordError");
const togglePass = document.getElementById("togglePass");
const submitBtn = document.getElementById("submitBtn");
const success = document.getElementById("success");

// The login card grows out of the center of the screen on load
window.addEventListener("load", () => {
  requestAnimationFrame(() => card.classList.add("show"));
  setTimeout(() => emailInput.focus(), 350);
});

// Show / hide password
togglePass.addEventListener("click", () => {
  const hidden = passInput.type === "password";
  passInput.type = hidden ? "text" : "password";
  togglePass.textContent = hidden ? "hide" : "show";
});

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
  }, 1000);
});
