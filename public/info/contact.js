// The contact form (/contact): works without an account
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("contactForm"), out = $("cOut"), send = $("cSend");
  const topic = new URLSearchParams(location.search).get("topic");
  if (topic && [...$("cTopic").options].some((o) => o.value === topic)) $("cTopic").value = topic;
  const say = (text, ok) => { out.hidden = false; out.textContent = text; out.classList.toggle("ok", Boolean(ok)); };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { topic: $("cTopic").value, email: $("cEmail").value.trim(), name: $("cName").value.trim(), username: $("cUser").value.trim(), message: $("cMsg").value.trim() };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return say("Add an email address we can answer you at.");
    if (body.message.length < 10) return say("Tell us a bit more (at least 10 characters).");
    send.disabled = true; send.textContent = "Sending…";
    try {
      const r = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json", "X-LookBlog": "1" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn’t send it. Try again.");
      form.querySelectorAll("input, textarea, select").forEach((x) => { x.disabled = true; });
      say(`Thanks — we got your message (#${j.id}). We’ll answer at ${body.email}.`, true);
      send.textContent = "Sent";
      return;
    } catch (err) { say(err.message); }
    send.disabled = false; send.textContent = "Send";
  });
})();
