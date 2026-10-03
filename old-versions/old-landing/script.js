const overlay = document.getElementById("overlay");
const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passInput = document.getElementById("password");
const emailError = document.getElementById("emailError");
const passError = document.getElementById("passwordError");
const togglePass = document.getElementById("togglePass");
const submitBtn = document.getElementById("submitBtn");
const success = document.getElementById("success");

function openModal() {
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  setTimeout(() => emailInput.focus(), 200);
}

function closeModal() {
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
}

document.getElementById("openLogin").addEventListener("click", openModal);
document.getElementById("heroLogin").addEventListener("click", openModal);
document.getElementById("closeLogin").addEventListener("click", closeModal);

// Close on backdrop click or Esc
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

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
    const modal = document.querySelector(".modal");
    modal.classList.remove("shake");
    void modal.offsetWidth;
    modal.classList.add("shake");
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

// Open the pop-up automatically on page load
window.addEventListener("load", openModal);
