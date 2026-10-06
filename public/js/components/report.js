// Report a post that breaks the rules.
import { h, modal, toast } from "../ui.js";
import { api } from "../api.js";

const REASONS = [
  ["spam", "Spam or scam"],
  ["harassment", "Harassment or bullying"],
  ["hate", "Hate speech"],
  ["violence", "Violence or threats"],
  ["sensitive", "Disturbing or graphic (blood, weapons…)"],
  ["self-harm", "Self-harm or suicide"],
  ["nudity", "Nudity or sexual content"],
  ["misinformation", "False information"],
  ["copyright", "Uses my work without permission"],
  ["other", "Something else"],
];

export function openReport(post) {
  let reason = null;
  const list = h("div", { class: "report-list", role: "radiogroup" });
  const details = h("textarea", { class: "text-input", rows: 3, maxlength: 500, placeholder: "Anything else we should know? (optional)" });
  const send = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Send report", disabled: true });
  for (const [id, label] of REASONS) {
    const b = h("button", { type: "button", role: "radio", class: "report-reason", "aria-checked": "false", text: label });
    b.addEventListener("click", () => {
      reason = id;
      list.querySelectorAll("button").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-checked", String(x === b)); });
      send.disabled = false;
    });
    list.append(b);
  }
  const what = post.stream ? "past live" : post.type === "video" ? "video" : post.type === "short" ? "short" : "post";
  const m = modal({ title: `Report ${what}`, body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: `Why are you reporting this ${what}? The person who posted it won’t know it was you.` }),
    list, details, send) });
  send.addEventListener("click", async () => {
    send.disabled = true;
    send.textContent = "Sending…";
    try {
      await api(`/api/posts/${post.id}/report`, { method: "POST", body: { reason, details: details.value } });
      m.close();
      toast("Thanks. We got your report.");
    } catch (err) {
      toast(err.error || "Couldn’t send the report.");
      send.disabled = false;
      send.textContent = "Send report";
    }
  });
}

// Report a live stream while it's on (or one message in its chat)
export function openReportLive(st, message = null) {
  let reason = null;
  const R = [...REASONS.slice(0, 6), ["self-harm", "Self-harm or suicide"], ...REASONS.slice(6)];
  const list = h("div", { class: "report-list", role: "radiogroup" });
  const details = h("textarea", { class: "text-input", rows: 3, maxlength: 500, placeholder: "What’s happening? (optional)" });
  const send = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Send report", disabled: true });
  for (const [id, label] of R) {
    const b = h("button", { type: "button", role: "radio", class: "report-reason", "aria-checked": "false", text: label });
    b.addEventListener("click", () => { reason = id; list.querySelectorAll("button").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-checked", String(x === b)); }); send.disabled = false; });
    list.append(b);
  }
  const m = modal({ title: message ? "Report message" : "Report live", body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: message ? `“${(message.text || "Sticker / sound").slice(0, 80)}” — ${message.author.name}. They won’t know it was you.` : "We look at live reports right away, with the moment you reported. The streamer won’t know it was you." }),
    list, details, send) });
  send.addEventListener("click", async () => {
    send.disabled = true; send.textContent = "Sending…";
    try { await api(`/api/streams/${st.id}/report`, { method: "POST", body: { reason, details: details.value, messageId: message?.id || null } }); m.close(); toast("Thanks. We got your report."); }
    catch (err) { toast(err.error || "Couldn’t send the report."); send.disabled = false; send.textContent = "Send report"; }
  });
}

// Report a person (from their profile, a group, or one of their messages)
const PERSON_REASONS = [
  ["spam", "Spam or a fake account"],
  ["impersonation", "Pretending to be someone else"],
  ["harassment", "Harassment or bullying"],
  ["hate", "Hate speech"],
  ["violence", "Violence or threats"],
  ["nudity", "Nudity or sexual content"],
  ["self-harm", "Self-harm or suicide"],
  ["underage", "They might be under 13"],
  ["other", "Something else"],
];
export function openReportUser(user, { message = null, onBlocked } = {}) {
  let reason = null;
  const list = h("div", { class: "report-list", role: "radiogroup" });
  const details = h("textarea", { class: "text-input", rows: 3, maxlength: 500, placeholder: "What happened? (optional)" });
  const block = h("input", { type: "checkbox", class: "report-block" });
  const send = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Send report", disabled: true });
  for (const [id, label] of PERSON_REASONS) {
    const b = h("button", { type: "button", role: "radio", class: "report-reason", "aria-checked": "false", text: label });
    b.addEventListener("click", () => {
      reason = id;
      list.querySelectorAll("button").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-checked", String(x === b)); });
      send.disabled = false;
    });
    list.append(b);
  }
  const quote = message ? h("div", { class: "report-quote" }, h("span", { class: "muted", text: "Message you’re reporting:" }), h("p", { text: message.text || (message.media ? "Photo, video or voice message" : "Message") })) : null;
  const m = modal({ title: `Report @${user.username}`, body: h("div", { class: "create-form" },
    h("p", { class: "create-hint", text: `Why are you reporting ${user.name}? They won’t know it was you.` }),
    quote, list, details,
    h("label", { class: "report-block-row" }, block, h("span", {}, h("b", { text: `Also block @${user.username}` }), h("span", { class: "muted", text: "They won’t be able to see your profile, follow you or message you." }))),
    send) });
  send.addEventListener("click", async () => {
    send.disabled = true;
    send.textContent = "Sending…";
    try {
      await api(`/api/users/${encodeURIComponent(user.username)}/report`, { method: "POST", body: { reason, details: details.value, messageId: message?.id || null, block: block.checked } });
      m.close();
      toast(block.checked ? `Thanks. We got your report and @${user.username} is blocked.` : "Thanks. We got your report.");
      if (block.checked) onBlocked?.();
    } catch (err) {
      toast(err.error || "Couldn’t send the report.");
      send.disabled = false;
      send.textContent = "Send report";
    }
  });
}
