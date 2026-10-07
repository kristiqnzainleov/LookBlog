// A chain post (like Gartic Phone, but on a post): someone starts it, others carry it on.
// Each person only sees the part right before theirs; when the chain is finished everyone sees all of it, part by part.
import { h, avatar, toast, modal } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { profileHref } from "../router.js";

export function chainEl(p) {
  const box = h("div", { class: "chain-card" });
  const paint = () => {
    const c = p.chain;
    const faces = h("div", { class: "chain-faces" }, ...c.people.slice(0, 8).map((u) => h("a", { href: profileHref(u.username), title: u.name }, avatar(u, 26))),
      c.people.length > 8 ? h("span", { class: "chain-more", text: "+" + (c.people.length - 8) }) : null);
    const head = h("div", { class: "chain-head" },
      h("span", { class: "chain-badge", text: c.mode === "gartic" ? "🎨 Draw & write chain" : "⛓️ Chain" }),
      h("span", { class: "chain-count", text: `${c.count}/${c.max}` }));
    if (!c.done) {
      // Hidden until it's finished
      const bar = h("div", { class: "chain-bar" }, h("i", { style: `width:${(c.count / c.max) * 100}%` }));
      const go = c.canContinue
        ? h("button", { type: "button", class: "btn btn-primary btn-sm", text: c.nextType === "draw" ? "🎨 Draw the next part" : "✍️ Write the next part" })
        : null;
      go?.addEventListener("click", () => continueChain(p, paint));
      const reveal = c.isAuthor && c.count >= 2 ? h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "🎬 Finish & reveal" }) : null;
      reveal?.addEventListener("click", async () => {
        if (!reveal.dataset.sure) { reveal.dataset.sure = "1"; reveal.textContent = "Reveal it to everyone?"; return; }
        try { p.chain = (await api(`/api/posts/${p.id}/chain/reveal`, { method: "POST" })).chain; paint(); replay(); } catch (err) { toast(err.error || "Couldn’t finish it."); }
      });
      box.replaceChildren(head,
        h("div", { class: "chain-hidden" }, h("span", { class: "chain-lock", text: "🔒" }),
          h("p", {}, h("b", { text: "Hidden until the chain is finished." }), h("br"), c.canContinue
            ? `You’ll only see the part right before yours. ${c.max - c.count} ${c.max - c.count === 1 ? "part" : "parts"} to go.`
            : c.joined ? "You’re in it! You’ll be told when it’s finished." : "It’s full of people already.")),
        bar, faces, h("div", { class: "chain-actions" }, go, reveal));
      return;
    }
    // Finished: every part, with who made it
    const list = h("ol", { class: "chain-parts" }, ...c.parts.map((x, i) => h("li", { class: "chain-part " + x.type, style: `--i:${i}` },
      h("div", { class: "chain-who" }, x.author ? avatar(x.author, 24) : null, h("b", { text: x.author?.name || "Someone" }), h("small", { class: "muted", text: x.type === "draw" ? "drew" : i === 0 ? "started" : x.image && !x.value ? "added a photo" : "wrote" })),
      x.type === "draw" ? h("img", { class: "chain-img", src: x.value, alt: "A drawing", loading: "lazy" }) : [x.value ? h("p", { class: "chain-text", text: x.value }) : null, x.image ? h("img", { class: "chain-photo", src: x.image.url, alt: "Photo", loading: "lazy" }) : null])));
    const replayBtn = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "▶ Replay" });
    replayBtn.addEventListener("click", () => replay());
    box.replaceChildren(h("div", { class: "chain-head" }, h("span", { class: "chain-badge done", text: "🎬 Chain finished" }), h("span", { class: "chain-count", text: `${c.count} parts` }), replayBtn), list, faces);
  };
  // Show the parts one after another
  function replay() {
    const items = [...box.querySelectorAll(".chain-part")];
    items.forEach((el) => el.classList.remove("in"));
    box.classList.add("replaying");
    items.forEach((el, i) => setTimeout(() => { el.classList.add("in"); if (i === items.length - 1) setTimeout(() => box.classList.remove("replaying"), 600); }, 300 + i * 1100));
  }
  paint();
  // Others add parts: refresh this card
  const off = on("chain", async (ev) => {
    if (!box.isConnected) return off();
    if (ev.id !== p.id) return;
    try { const r = await api(`/api/posts/${p.id}`); const was = p.chain.done; p.chain = (r.post || r).chain; paint(); if (!was && p.chain.done) replay(); } catch {}
  });
  return box;
}

// My turn: I only see the part right before mine
async function continueChain(p, done) {
  let turn;
  try { turn = await api(`/api/posts/${p.id}/chain`); } catch (err) { return toast(err.error || "Couldn’t open it."); }
  const prevEl = h("div", { class: "chain-prev" });
  const body = h("div", { class: "create-form chain-turn" });
  let pad = null, input = null, photo = null;
  const send = h("button", { type: "button", class: "btn btn-primary btn-full" });
  const paintTurn = () => {
    prevEl.replaceChildren(h("small", { class: "muted", text: turn.type === "draw" ? "Draw this:" : turn.prev.type === "draw" ? "What is this drawing? Say it in words:" : "Carry on from this:" }),
      turn.prev.type === "draw" ? h("img", { class: "chain-img", src: turn.prev.value, alt: "The drawing before yours" })
        : h("div", {}, turn.prev.value ? h("p", { class: "chain-quote", text: turn.prev.value }) : null, turn.prev.image ? h("img", { class: "chain-photo", src: turn.prev.image.url, alt: "The photo before yours" }) : null));
    send.textContent = turn.type === "draw" ? "✅ Send my drawing" : "✅ Add my part";
  };
  paintTurn();
  if (turn.type === "draw") {
    const { drawPad } = await import("./drawpad.js");
    pad = drawPad();
    body.append(prevEl, pad.el, send);
  } else {
    input = h("textarea", { class: "text-input", rows: 3, maxlength: 280, placeholder: turn.prev.type === "draw" ? "I think it’s…" : "What happens next… (or add a photo)" });
    const { createPicker } = await import("./media-picker.js");
    photo = createPicker({ accept: "image", max: 1, onChange: () => { photo.button.disabled = photo.items().length >= 1; }, onError: (m) => toast(m) });
    body.append(prevEl, input, photo.previews, h("div", { class: "chain-turn-bar" }, photo.button, h("span", { class: "muted", text: "Words, a photo, or both" })), send);
  }
  const md = modal({ title: `Part ${turn.count + 1} of ${turn.max}`, wide: turn.type === "draw", body: h("div", {}, h("p", { class: "create-hint", text: "You only see the part before yours. Nobody sees the whole chain until it’s finished." }), body) });
  setTimeout(() => input?.focus(), 60);
  send.addEventListener("click", async () => {
    let value;
    if (pad) {
      if (pad.empty()) return toast("Draw something first!");
      send.disabled = true; send.textContent = "Sending…";
      try { const { upload } = await import("../api.js"); value = (await upload(new File([await pad.blob()], "chain.png", { type: "image/png" }))).url; }
      catch (err) { send.disabled = false; paintTurn(); return toast(err.error || "Couldn’t send it."); }
    } else {
      value = input.value.trim();
      if (photo?.busy()) return toast("Wait for the photo to finish uploading.");
      if (!value && !photo?.media().length) return input.focus();
      send.disabled = true;
    }
    const pic = photo?.media()[0] || null;
    try {
      const r = await api(`/api/posts/${p.id}/chain`, { method: "POST", body: { value, after: turn.count, ...(pic ? { image: pic.url, width: pic.width, height: pic.height } : {}) } });
      p.chain = r.chain; md.close(); done();
      toast(p.chain.done ? "🎬 That was the last part — the chain is revealed!" : "⛓️ Added! You’ll see the whole thing when it’s finished.");
    } catch (err) {
      send.disabled = false;
      // Someone was quicker: continue from the new last part
      if (err.turn) { turn = err.turn; md.close(); toast(err.error); return continueChain(p, done); }
      paintTurn(); toast(err.error || "Couldn’t add it.");
    }
  });
}
