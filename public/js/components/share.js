// "Share": send a post to one of your chats (a person you both follow, or a group you're in).
import { h, icon, avatar, modal, spinner, empty, toast, tick } from "../ui.js";
import { api } from "../api.js";

function chatRow(c, onPick) {
  const pic = c.kind === "dm" ? avatar(c.other, 44) : h("span", { class: "group-pic", style: c.cover ? `background-image:url("${c.cover}")` : "" }, c.cover ? null : c.name.slice(0, 1).toUpperCase());
  const title = c.kind === "dm" ? c.other.name : c.name;
  const sub = c.kind === "dm" ? "@" + c.other.username : `${c.memberCount} members`;
  const btn = h("button", { type: "button", class: "btn btn-xs btn-follow", text: "Send" });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await onPick(c);
      btn.textContent = "Sent";
      btn.className = "btn btn-xs btn-following";
    } catch (err) {
      toast(err.error || "Couldn’t send it.");
      btn.disabled = false;
      btn.textContent = "Send";
    }
  });
  return h("div", { class: "conn-row" }, pic, h("div", { class: "who" }, h("b", { class: "name" }, title, c.kind === "dm" ? tick(c.other, 14) : null), h("span", { class: "muted", text: sub })), btn);
}

export function shareUrl(post) {
  const path = post.type === "video" ? `/watch/${post.id}` : `/post/${post.id}`;
  return location.origin + path;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  // Older browsers: select a hidden box and copy
  const t = h("textarea", { style: "position:fixed;opacity:0" });
  t.value = text;
  document.body.append(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  t.remove();
  return ok;
}

export function openShare(post) {
  const url = shareUrl(post);
  const linkBox = h("input", { type: "text", class: "text-input share-link", value: url, readonly: true, "aria-label": "Link" });
  linkBox.addEventListener("focus", () => linkBox.select());
  const copyBtn = h("button", { type: "button", class: "btn btn-primary btn-sm" }, icon("link"), h("span", { text: "Copy link" }));
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(url);
    if (ok && !post.mine) api(`/api/posts/${post.id}/share`, { method: "POST" }).catch(() => {});
    copyBtn.querySelector("span").textContent = ok ? "Copied!" : "Select and copy";
    if (!ok) linkBox.select();
    setTimeout(() => (copyBtn.querySelector("span").textContent = "Copy link"), 1800);
  });
  const nativeBtn = navigator.share ? h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "More…" }) : null;
  nativeBtn?.addEventListener("click", () => navigator.share({ title: post.title || "LookBlog", url }).catch(() => {}));
  const hint = post.visibility === "unlisted" ? h("p", { class: "create-hint", text: "This is unlisted: only people with this link can watch it." })
    : post.visibility === "private" ? h("p", { class: "create-hint", text: "This is private: only you can open the link." }) : null;

  // Outside LookBlog: the link shows as a LookBlog post / video there (with the picture, and the video on Discord)
  const what = post.type === "video" ? "video" : post.type === "short" ? "short" : "post";
  const text = `${post.title || post.text?.slice(0, 80) || `A ${what} on LookBlog`}`;
  const counted = () => { if (!post.mine) api(`/api/posts/${post.id}/share`, { method: "POST" }).catch(() => {}); };
  const out = (label, emoji, href) => h("a", { class: "share-app", href, target: "_blank", rel: "noopener", onclick: counted }, h("span", { class: "sa-ic", text: emoji }), h("small", { text: label }));
  const copyFor = (label, emoji) => {
    const b = h("button", { type: "button", class: "share-app" }, h("span", { class: "sa-ic", text: emoji }), h("small", { text: label }));
    b.addEventListener("click", async () => { if (await copyText(url)) { counted(); toast(`Link copied — paste it in ${label}.`); } });
    return b;
  };
  const u = encodeURIComponent(url), t = encodeURIComponent(text);
  const apps = h("div", { class: "share-apps" },
    copyFor("Discord", "🎮"), copyFor("Instagram", "📸"),
    out("WhatsApp", "🟢", `https://wa.me/?text=${t}%20${u}`),
    matchMedia("(pointer: coarse)").matches ? out("Messenger", "💬", `fb-messenger://share?link=${u}`) : copyFor("Messenger", "💬"),
    out("Telegram", "✈️", `https://t.me/share/url?url=${u}&text=${t}`),
    out("Viber", "🟣", `viber://forward?text=${t}%20${u}`),
    out("X", "✖️", `https://twitter.com/intent/tweet?url=${u}&text=${t}`),
    out("Facebook", "📘", `https://www.facebook.com/sharer/sharer.php?u=${u}`),
    out("Reddit", "👽", `https://www.reddit.com/submit?url=${u}&title=${t}`),
    out("Email", "✉️", `mailto:?subject=${t}&body=${u}`));
  const note = h("input", { type: "text", class: "text-input", placeholder: "Add a message (optional)", maxlength: 500 });
  const list = h("div", { class: "conn-list" }, spinner());
  modal({ title: "Share", body: [
    h("div", { class: "share-row" }, linkBox, copyBtn, nativeBtn),
    hint,
    post.visibility === "private" ? null : h("h3", { class: "side-title share-sub", text: "Share outside LookBlog" }),
    post.visibility === "private" ? null : apps,
    h("h3", { class: "side-title share-sub", text: "Send in a chat" }),
    note, list,
  ] });

  fillChats(list, (chatId) => api(`/api/chats/${chatId}/messages`, { method: "POST", body: { postId: post.id, text: note.value } }));
}

/* ---------- Send a reply (comment) from a post, short or video to someone in Messages ---------- */
export function openShareComment(comment, post) {
  const note = h("input", { type: "text", class: "text-input", placeholder: "Add a message (optional)", maxlength: 500 });
  const list = h("div", { class: "conn-list" }, spinner());
  const what = post.type === "video" ? "video" : post.type === "short" ? "short" : "post";
  const preview = h("div", { class: "share-comment" },
    avatar(comment.author, 32),
    h("div", {}, h("b", { text: comment.author.name }), h("p", { text: comment.text || (comment.media ? (comment.media.gif ? "GIF" : comment.media.kind === "video" ? "Video reply" : "Photo") : "") }),
      h("span", { class: "muted", text: `Reply on ${post.author.name}’s ${what}` })));
  modal({ title: "Send this reply", body: [preview, note, list] });
  fillChats(list, (chatId) => api(`/api/chats/${chatId}/messages`, { method: "POST", body: { commentId: comment.id, text: note.value } }));
}

// The list of chats you can send to (and people you follow each other with)
function fillChats(list, send) {
  Promise.all([api("/api/chats"), api("/api/me/mutuals")]).then(([{ chats }, { users }]) => {
    list.replaceChildren();
    const usable = chats.filter((c) => c.canSend);
    // People you follow each other with but haven't talked to yet
    const talked = new Set(usable.filter((c) => c.kind === "dm").map((c) => c.other.username));
    const fresh = users.filter((u) => !talked.has(u.username)).map((u) => ({ kind: "dm", other: u, fresh: true }));
    const all = [...usable, ...fresh];
    if (!all.length) {
      list.append(empty("No one to send to yet.", "You can message people who follow you back, and groups you’ve joined."));
      return;
    }
    for (const c of all) {
      list.append(chatRow(c, async (chat) => {
        let id = chat.id;
        if (chat.fresh) id = (await api(`/api/dm/${encodeURIComponent(chat.other.username)}`, { method: "POST" })).chat.id;
        await send(id);
      }));
    }
  }).catch((err) => list.replaceChildren(empty("Couldn’t load your chats.", err.error || "")));
}

/* ---------- Share any link (a live stream, an upcoming video): copy it or send it in a chat ---------- */
// chatBody: what a chat gets instead of the link as text (e.g. { storyId } → a card)
export function openShareLink({ title = "Share", url, text, onShared, chatBody = null }) {
  const linkBox = h("input", { type: "text", class: "text-input share-link", value: url, readonly: true, "aria-label": "Link" });
  linkBox.addEventListener("focus", () => linkBox.select());
  const copyBtn = h("button", { type: "button", class: "btn btn-primary btn-sm" }, icon("link"), h("span", { text: "Copy link" }));
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(url);
    if (ok) onShared?.();
    copyBtn.querySelector("span").textContent = ok ? "Copied!" : "Select and copy";
    if (!ok) linkBox.select();
    setTimeout(() => (copyBtn.querySelector("span").textContent = "Copy link"), 1800);
  });
  const nativeBtn = navigator.share ? h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "More…" }) : null;
  nativeBtn?.addEventListener("click", () => navigator.share({ title: text || "LookBlog", url }).then(() => onShared?.()).catch(() => {}));
  const note = h("input", { type: "text", class: "text-input", placeholder: "Add a message (optional)", maxlength: 300 });
  const list = h("div", { class: "conn-list" }, spinner());
  modal({ title, body: [h("div", { class: "share-row" }, linkBox, copyBtn, nativeBtn), h("h3", { class: "side-title share-sub", text: "Send in a chat" }), note, list] });
  const path = url.replace(location.origin, "");
  fillChats(list, async (chatId) => {
    await api(`/api/chats/${chatId}/messages`, { method: "POST", body: chatBody ? { ...chatBody, text: note.value.trim() } : { text: [note.value.trim(), `${text ? text + " · " : ""}${path}`].filter(Boolean).join("\n") } });
    onShared?.();
  });
}
