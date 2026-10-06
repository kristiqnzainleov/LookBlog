// Instants (like Instagram), phones only: the little pile at the bottom of Messages.
// Tap it to see what your friends sent (each one once), then snap your own with the camera.
// No gallery and no editing: just a quick photo for your friends, gone after they see it.
import { h, icon, avatar, toast, timeAgo, modal, tick } from "../ui.js";
import { api, upload } from "../api.js";
import { on } from "../state.js";

const PHONE = "(pointer: coarse) and (max-width: 900px)";
export const instantsAvailable = () => matchMedia(PHONE).matches && Boolean(navigator.mediaDevices?.getUserMedia);

// The pile in the corner of Messages
export function instantsPile() {
  const el = h("button", { type: "button", class: "inst-pile", "aria-label": "Looktures" });
  let data = { pile: [], mine: [], friends: 0, reactions: [] };
  function paint() {
    const n = data.pile.length;
    const cards = data.pile.slice(-3).map((x, i, a) => h("span", { class: "inst-card", style: `--r:${(i - (a.length - 1) / 2) * 9}deg;--i:${i}` }, h("img", { src: x.url, alt: "" })));
    el.replaceChildren(
      n ? h("span", { class: "inst-stack" }, ...cards) : h("span", { class: "inst-cam" }, icon("camera")),
      n ? h("span", { class: "inst-count", text: String(n) }) : null);
    el.title = n ? `${n} new lookture${n === 1 ? "" : "s"}` : "Looktures: snap a photo for your friends";
    el.classList.toggle("has-new", n > 0);
  }
  async function load() {
    try { data = await api("/api/instants"); paint(); } catch {}
  }
  el.addEventListener("click", () => openInstants(data, load));
  paint();
  load();
  const off = on("instant:new", () => { if (!el.isConnected) return off(); load(); });
  // Hidden on computers (and when the screen gets wide)
  const mq = matchMedia(PHONE);
  const fit = () => { el.hidden = !mq.matches; };
  mq.addEventListener?.("change", fit);
  fit();
  return el;
}

// Full screen: the friends' instants first, then the camera
function openInstants(data, reload) {
  const box = h("div", { class: "inst-screen", role: "dialog", "aria-modal": "true", "aria-label": "Looktures" });
  document.body.append(box);
  document.body.classList.add("no-scroll");
  let stream = null, closed = false, sentCount = 0, sending = 0;
  const close = () => {
    if (closed) return;
    closed = true;
    if (sentCount) toast(`⚡ ${sentCount} lookture${sentCount === 1 ? "" : "s"} sent to your friends.`);
    stream?.getTracks().forEach((t) => t.stop());
    box.remove();
    document.body.classList.remove("no-scroll");
    reload();
  };
  const closeBtn = () => h("button", { type: "button", class: "inst-x", "aria-label": "Close", onclick: close }, icon("close"));
  const queue = data.pile.slice();
  queue.length ? showNext() : camera();

  /* ---------- Seeing friends' instants, one at a time ---------- */
  function showNext() {
    const x = queue.shift();
    if (!x) return camera();
    api(`/api/instants/${x.id}/seen`, { method: "POST" }).catch(() => {});
    const reactRow = h("div", { class: "inst-reacts" }, ...(data.reactions || []).map((e) => {
      const b = h("button", { type: "button", text: e, "aria-label": "React " + e });
      b.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        b.classList.add("pop");
        try { await api(`/api/instants/${x.id}/react`, { method: "POST", body: { emoji: e } }); toast(`Sent ${e} to ${x.user.name.split(" ")[0]}.`); } catch (err) { toast(err.error || "Couldn’t react."); }
      });
      return b;
    }));
    const input = h("input", { type: "text", class: "inst-reply", placeholder: `Reply to ${x.user.name.split(" ")[0]}…`, maxlength: 1000, enterkeyhint: "send" });
    const send = async () => {
      if (!input.value.trim()) return;
      try { await api(`/api/instants/${x.id}/reply`, { method: "POST", body: { text: input.value } }); input.value = ""; input.blur(); toast("Reply sent in Messages."); }
      catch (err) { toast(err.error || "Couldn’t send it."); }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
    const nextBtn = h("button", { type: "button", class: "inst-next", text: queue.length ? `Next (${queue.length})` : "📸 Your turn" });
    nextBtn.addEventListener("click", showNext);
    box.replaceChildren(
      h("header", { class: "inst-head" }, closeBtn(), h("div", { class: "inst-who" }, avatar(x.user, 32), h("b", {}, x.user.name, tick(x.user, 13)), h("span", { class: "muted", text: timeAgo(x.createdAt) }))),
      h("figure", { class: "inst-photo", onclick: (e) => { if (!e.target.closest("button, input")) showNext(); } },
        h("img", { src: x.url, alt: "" }), x.caption ? h("figcaption", { text: x.caption }) : null),
      h("p", { class: "inst-once", text: "Seen once · tap the photo for the next one" }),
      reactRow,
      h("div", { class: "inst-foot" }, input, nextBtn));
  }

  /* ---------- The camera ---------- */
  async function camera(facing = "user") {
    stream?.getTracks().forEach((t) => t.stop());
    const video = h("video", { class: "inst-video" + (facing === "user" ? " mirror" : ""), autoplay: true, playsInline: true, muted: true });
    const shutter = h("button", { type: "button", class: "inst-shutter", "aria-label": "Take the photo" });
    const flip = h("button", { type: "button", class: "inst-flip", "aria-label": "Switch camera" }, icon("flip"));
    const mineBtn = h("button", { type: "button", class: "inst-mine", text: data.mine.length ? `Your looktures (${data.mine.length})` : "Your looktures" });
    mineBtn.addEventListener("click", () => openMine(data.mine));
    box.replaceChildren(
      h("header", { class: "inst-head" }, closeBtn(), h("b", { class: "inst-title", text: "Looktures" }), mineBtn),
      h("div", { class: "inst-frame" }, video, h("span", { class: "inst-zoom", hidden: true }), h("span", { class: "inst-sent", hidden: true })),
      h("input", { type: "text", class: "inst-caption", placeholder: "Caption (optional)…", maxlength: 80, enterkeyhint: "done" }),
      h("p", { class: "inst-once", text: data.friends ? `Goes to your ${data.friends} friend${data.friends === 1 ? "" : "s"} · they see it once` : "Looktures go to friends: people you follow who follow you back" }),
      h("div", { class: "inst-controls" }, h("span"), shutter, flip));
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false });
      if (closed) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
    } catch {
      box.querySelector(".inst-frame").replaceChildren(h("p", { class: "inst-nocam", text: "LookBlog needs your camera for looktures. Allow it in your browser settings." }));
      return;
    }
    flip.addEventListener("click", () => camera(facing === "user" ? "environment" : "user"));
    // Zoom with two fingers (pinch). The camera's own zoom when the phone offers it, otherwise the picture is enlarged.
    const frame = box.querySelector(".inst-frame"), badge = box.querySelector(".inst-zoom");
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.().zoom;
    const lens = caps && caps.max > caps.min ? caps : null;
    const MAX = lens ? lens.max : 5, MIN = lens ? lens.min : 1;
    let zoom = lens ? track.getSettings?.().zoom || MIN : 1, pinch = null, hideBadge;
    const setZoom = (z) => {
      zoom = Math.min(MAX, Math.max(MIN, z));
      if (lens) track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
      else video.style.transform = `${facing === "user" ? "scaleX(-1) " : ""}scale(${zoom})`;
      badge.textContent = (lens ? zoom / (MIN || 1) : zoom).toFixed(1).replace(/\.0$/, "") + "×";
      badge.hidden = false;
      clearTimeout(hideBadge);
      hideBadge = setTimeout(() => { badge.hidden = true; }, 1200);
    };
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    frame.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { pinch = { d: dist(e.touches), z: zoom }; e.preventDefault(); } }, { passive: false });
    frame.addEventListener("touchmove", (e) => { if (pinch && e.touches.length === 2) { e.preventDefault(); setZoom(pinch.z * (dist(e.touches) / pinch.d)); } }, { passive: false });
    frame.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null; });
    // Double tap: back to no zoom
    let lastTap = 0;
    frame.addEventListener("touchend", (e) => { if (e.touches.length || e.changedTouches.length !== 1) return; const now = Date.now(); if (now - lastTap < 300) setZoom(MIN); lastTap = now; });
    shutter.addEventListener("click", () => {
      if (!video.videoWidth) return;
      // A square photo from the middle of the camera (mirrored like you saw it, for the front camera), zoomed like on screen
      const side = Math.min(video.videoWidth, video.videoHeight) / (lens ? 1 : zoom), out = Math.min(Math.round(side), 1080);
      const c = h("canvas", { width: out, height: out }), g = c.getContext("2d");
      if (facing === "user") { g.translate(out, 0); g.scale(-1, 1); }
      g.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, out, out);
      box.classList.add("flash");
      setTimeout(() => box.classList.remove("flash"), 250);
      // Sent right away, and the camera stays open: snap as many as you like
      const captionIn = box.querySelector(".inst-caption"), caption = captionIn.value;
      captionIn.value = "";
      c.toBlob((blob) => blob && fire(blob, caption, c.toDataURL("image/jpeg", 0.4)), "image/jpeg", 0.88);
    });
  }

  async function fire(blob, caption, thumb) {
    const frame = box.querySelector(".inst-frame");
    if (frame) {
      const fly = h("img", { class: "inst-fly", src: thumb, alt: "" });
      frame.append(fly);
      setTimeout(() => fly.remove(), 700);
    }
    sending++;
    paintSent();
    try {
      const { url } = await upload(new File([blob], "lookture.jpg", { type: "image/jpeg" }));
      await api("/api/instants", { method: "POST", body: { image: url, caption } });
      sentCount++;
    } catch (err) { toast(err.error || "Couldn’t send that one."); }
    sending--;
    paintSent();
  }
  function paintSent() {
    const el = box.querySelector(".inst-sent");
    if (!el) return;
    el.hidden = !sentCount && !sending;
    el.textContent = sending ? `Sending… ${sentCount ? "· " + sentCount + " sent" : ""}` : `✓ ${sentCount} sent`;
  }
}

// What I sent in the last 24 hours, and who saw it
function openMine(list) {
  const body = list.length ? h("div", { class: "inst-mine-list" }, ...list.map((x) => {
    const del = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Delete" });
    const row = h("div", { class: "inst-mine-row" },
      h("img", { src: x.url, alt: "" }),
      h("div", { class: "inst-mine-info" },
        h("b", { text: x.caption || "Lookture" }),
        h("small", { class: "muted", text: `${timeAgo(x.createdAt)} · seen by ${x.seen.length} of ${x.sentTo}` }),
        x.seen.length ? h("div", { class: "inst-seen" }, ...x.seen.slice(0, 8).map((u) => h("span", { class: "inst-seen-av", title: u.name + (u.reaction ? " " + u.reaction : "") }, avatar(u, 26), u.reaction ? h("i", { text: u.reaction }) : null))) : null),
      del);
    del.addEventListener("click", async () => {
      try { await api(`/api/instants/${x.id}`, { method: "DELETE" }); row.remove(); list.splice(list.indexOf(x), 1); toast("Lookture deleted."); } catch (err) { toast(err.error || "Couldn’t delete it."); }
    });
    return row;
  })) : h("p", { class: "muted", text: "You haven’t sent any looktures in the last 24 hours." });
  modal({ title: "Your looktures", body });
}
