/* =========================================================
   LookBlog eyes: the two "o"s in the logo watch the cursor,
   look at each other, blink, and close while a password is typed.
   Shared by the landing page and the home feed.
   ========================================================= */

const logos = [...document.querySelectorAll(".logo")];
const eyes = [...document.querySelectorAll(".eye")];

/* ---------- Eyes in the logo ---------- */
const eyePairs = logos.map((logo) => ({ logo, eyes: [...logo.querySelectorAll(".eye")] }));

// Pupils glide toward their target instead of jumping (eased every frame)
const pupils = eyes.map((eye) => ({ el: eye.firstElementChild, x: 0, y: 0, tx: 0, ty: 0 }));
eyes.forEach((eye, i) => (eye._pupil = pupils[i]));
let animating = false;

function movePupil(eye, dx, dy) {
  eye._pupil.tx = dx;
  eye._pupil.ty = dy;
  if (!animating) {
    animating = true;
    requestAnimationFrame(animatePupils);
  }
}

function animatePupils() {
  let moving = false;
  pupils.forEach((p) => {
    p.x += (p.tx - p.x) * 0.16;
    p.y += (p.ty - p.y) * 0.16;
    if (Math.abs(p.tx - p.x) > 0.05 || Math.abs(p.ty - p.y) > 0.05) moving = true;
    else { p.x = p.tx; p.y = p.ty; }
    p.el.style.transform = `translate(calc(-50% + ${p.x.toFixed(2)}px), calc(-50% + ${p.y.toFixed(2)}px))`;
  });
  if (moving) requestAnimationFrame(animatePupils);
  else animating = false;
}

function lookAt(x, y) {
  eyePairs.forEach(({ logo, eyes: pair }) => {
    const rects = pair.map((eye) => eye.getBoundingClientRect());
    if (!rects[0].width) return;
    const centers = rects.map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));

    // Cursor between the two eyes: they look at each other (cross-eyed)
    const between =
      pair.length === 2 &&
      x > centers[0].x && x < centers[1].x &&
      Math.abs(y - (centers[0].y + centers[1].y) / 2) < rects[0].height * 0.6;
    logo.classList.toggle("cross", between);

    pair.forEach((eye, i) => {
      const max = rects[i].width * 0.26;
      if (between) return movePupil(eye, i === 0 ? max : -max, 0);
      const dx = x - centers[i].x;
      const dy = y - centers[i].y;
      const angle = Math.atan2(dy, dx);
      const dist = Math.min(Math.hypot(dx, dy) / 10, rects[i].width * 0.2);
      movePupil(eye, Math.cos(angle) * dist, Math.sin(angle) * dist);
    });
  });
}
document.addEventListener("mousemove", (e) => lookAt(e.clientX, e.clientY));
document.addEventListener("mouseout", (e) => {
  if (!e.relatedTarget) {
    eyePairs.forEach(({ logo }) => logo.classList.remove("cross"));
    eyes.forEach((eye) => movePupil(eye, 0, 0));
  }
});

// Read along while the user types in a text field
document.querySelectorAll("input[type=text], input[type=email]").forEach((input) => {
  const follow = () => {
    const r = input.getBoundingClientRect();
    lookAt(r.left + 14 + Math.min(input.value.length * 8.5, r.width - 28), r.top + r.height / 2);
  };
  input.addEventListener("input", follow);
  input.addEventListener("focus", follow);
});

// Close the eyes while a password is typed, peek when it is shown
function updateShyness() {
  const el = document.activeElement;
  const onPassword = el && el.classList.contains("pw-input");
  const visible = onPassword && el.type === "text";
  logos.forEach((logo) => {
    logo.classList.toggle("shy", onPassword && !visible);
    logo.classList.toggle("peek", onPassword && visible);
  });
}
document.addEventListener("focusin", updateShyness);
document.addEventListener("focusout", () => setTimeout(updateShyness, 0));

// Blink now and then
function blink() {
  if (logos.length && !logos[0].classList.contains("shy")) {
    eyes.forEach((eye) => eye.classList.add("blink"));
    setTimeout(() => eyes.forEach((eye) => eye.classList.remove("blink")), 160);
  }
  setTimeout(blink, 2500 + Math.random() * 4000);
}
setTimeout(blink, 3000);
