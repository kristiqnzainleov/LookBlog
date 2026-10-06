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
  const el = h("button", { type: "button", class: "inst-pile", "aria-label": "Instants" });
  let data = { pile: [], mine: [], friends: 0, reactions: [] };
  function paint() {
    const n = data.pile.length;
    const cards = data.pile.slice(-3).map((x, i, a) => h("span", { class: "inst-card", style: `--r:${(i - (a.length - 1) / 2) * 9}deg;--i:${i}` }, h("img", { src: x.url, alt: "" })));
    el.replaceChildren(
      n ? h("span", { class: "inst-stack" }, ...cards) : h("span", { class: "inst-cam" }, icon("camera")),
      n ? h("span", { class: "inst-count", text: String(n) }) : null);
    el.title = n ? `${n} new instant${n === 1 ? "" : "s"}` : "Instants: snap a photo for your friends";
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
  const box = h("div", { class: "inst-screen", role: "dialog", "aria-modal": "true", "aria-label": "Instants" });
  document.body.append(box);
  document.body.classList.add("no-scroll");
  let stream = null, closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
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
    const mineBtn = h("button", { type: "button", class: "inst-mine", text: data.mine.length ? `Your instants (${data.mine.length})` : "Your instants" });
    mineBtn.addEventListener("click", () => openMine(data.mine));
    box.replaceChildren(
      h("header", { class: "inst-head" }, closeBtn(), h("b", { class: "inst-title", text: "Instants" }), mineBtn),
      h("div", { class: "inst-frame" }, video),
      h("p", { class: "inst-once", text: data.friends ? `Goes to your ${data.friends} friend${data.friends === 1 ? "" : "s"} · they see it once` : "Instants go to friends: people you follow who follow you back" }),
      h("div", { class: "inst-controls" }, h("span"), shutter, flip));
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      if (closed) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
    } catch {
      box.querySelector(".inst-frame").replaceChildren(h("p", { class: "inst-nocam", text: "LookBlog needs your camera for instants. Allow it in your browser settings." }));
      return;
    }
    flip.addEventListener("click", () => camera(facing === "user" ? "environment" : "user"));
    shutter.addEventListener("click", () => {
      if (!video.videoWidth) return;
      // A square photo from the middle of the camera (mirrored like you saw it, for the front camera)
      const side = Math.min(video.videoWidth, video.videoHeight), out = Math.min(side, 1080);
      const c = h("canvas", { width: out, height: out }), g = c.getContext("2d");
      if (facing === "user") { g.translate(out, 0); g.scale(-1, 1); }
      g.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, out, out);
      box.classList.add("flash");
      setTimeout(() => box.classList.remove("flash"), 250);
      c.toBlob((blob) => blob && review(blob, facing), "image/jpeg", 0.88);
    });
  }

  // The photo you just took: add a few words, send it to your friends, or take another
  function review(blob, facing) {
    stream?.getTracks().forEach((t) => t.stop());
    const src = URL.createObjectURL(blob);
    const caption = h("input", { type: "text", class: "inst-caption", placeholder: "Add a caption…", maxlength: 80 });
    const sendBtn = h("button", { type: "button", class: "btn btn-primary inst-send", text: data.friends ? `Send to ${data.friends} friend${data.friends === 1 ? "" : "s"}` : "Send" });
    const retake = h("button", { type: "button", class: "btn btn-outline-light", text: "Retake" });
    retake.addEventListener("click", () => { URL.revokeObjectURL(src); camera(facing); });
    sendBtn.addEventListener("click", async () => {
      sendBtn.disabled = retake.disabled = true;
      sendBtn.textContent = "Sending…";
      try {
        const { url } = await upload(new File([blob], "instant.jpg", { type: "image/jpeg" }));
        const r = await api("/api/instants", { method: "POST", body: { image: url, caption: caption.value } });
        URL.revokeObjectURL(src);
        toast(`⚡ Instant sent to ${r.sentTo} friend${r.sentTo === 1 ? "" : "s"}.`);
        close();
      } catch (err) {
        toast(err.error || "Couldn’t send it.");
        sendBtn.disabled = retake.disabled = false;
        sendBtn.textContent = "Send";
      }
    });
    box.replaceChildren(
      h("header", { class: "inst-head" }, closeBtn(), h("b", { class: "inst-title", text: "Instants" }), h("span")),
      h("figure", { class: "inst-photo" }, h("img", { src, alt: "" })),
      caption,
      h("div", { class: "inst-foot" }, retake, sendBtn));
    caption.focus();
  }
}

// What I sent in the last 24 hours, and who saw it
function openMine(list) {
  const body = list.length ? h("div", { class: "inst-mine-list" }, ...list.map((x) => {
    const del = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Delete" });
    const row = h("div", { class: "inst-mine-row" },
      h("img", { src: x.url, alt: "" }),
      h("div", { class: "inst-mine-info" },
        h("b", { text: x.caption || "Instant" }),
        h("small", { class: "muted", text: `${timeAgo(x.createdAt)} · seen by ${x.seen.length} of ${x.sentTo}` }),
        x.seen.length ? h("div", { class: "inst-seen" }, ...x.seen.slice(0, 8).map((u) => h("span", { class: "inst-seen-av", title: u.name + (u.reaction ? " " + u.reaction : "") }, avatar(u, 26), u.reaction ? h("i", { text: u.reaction }) : null))) : null),
      del);
    del.addEventListener("click", async () => {
      try { await api(`/api/instants/${x.id}`, { method: "DELETE" }); row.remove(); list.splice(list.indexOf(x), 1); toast("Instant deleted."); } catch (err) { toast(err.error || "Couldn’t delete it."); }
    });
    return row;
  })) : h("p", { class: "muted", text: "You haven’t sent any instants in the last 24 hours." });
  modal({ title: "Your instants", body });
}
