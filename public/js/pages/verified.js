// /verified — what the tick means, and how to apply for it.
import { h, icon, tick, toast, spinner, empty } from "../ui.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { profileHref } from "../router.js";
import { VERIFY_TYPES, verifyType } from "../verify-types.js";


export async function verifiedPage(view) {
  document.title = "Get verified / LookBlog";
  view.classList.add("page-verified");
  const big = { ...state.me, verified: true, verifiedType: state.me.verifiedType || "creator" };
  const badgeBox = h("div", { class: "verify-badge" }, tick(big, 74));
  const typeLabel = h("p", { class: "verify-type" });
  // Show the tick for whatever kind is picked
  function showType(id) {
    const t = verifyType(id);
    badgeBox.replaceChildren(tick({ verified: true, verifiedType: t.id }, 74));
    badgeBox.style.setProperty("--glow", t.color);
    badgeBox.classList.remove("swap"); void badgeBox.offsetWidth; badgeBox.classList.add("swap");
    typeLabel.replaceChildren();
  }
  view.append(h("section", { class: "verify-hero" },
    badgeBox,
    typeLabel,
    h("h1", {}, "Get verified on LookBlog"),
    h("p", { class: "page-sub", text: "The tick shows people that an account is really who it says it is. Its colour and the picture inside show what you do, and it appears next to your name everywhere: posts, videos, comments and messages." })
  ));
  const body = h("div", { class: "verify-body" }, spinner());
  view.append(body);

  let data;
  try { data = await api("/api/verify"); } catch (err) { body.replaceChildren(empty("Couldn’t load this page.", err.error || "")); return; }
  body.replaceChildren();

  showType(data.verifiedType || data.request?.category || "creator");
  if (data.verified) {
    body.append(h("section", { class: "verify-card done" },
      h("h2", {}, "You’re verified ", tick(big, 22)),
      h("p", { text: "Your tick is live. People see it next to your name all over LookBlog." }),
      h("a", { class: "btn btn-primary btn-sm", href: profileHref(state.me.username), text: "See your profile" })));
    return;
  }
  if (data.request?.status === "pending") {
    body.append(h("section", { class: "verify-card pending" },
      h("span", { class: "verify-status", text: "In review" }),
      h("h2", { text: "Thanks, we got your application" }),
      h("p", { text: `You applied on ${new Date(data.request.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. We’ll let you know when it’s been reviewed.` })));
    return;
  }

  /* What you need: 1,000 followers and 10 posts */
  const need = [
    ["followers", `${data.min.followers.toLocaleString("en-US")} followers`, data.counts.followers, data.min.followers],
    ["posts", `${data.min.posts} posts`, data.counts.posts, data.min.posts],
  ];
  const ready = need.every(([k]) => data.checks[k]);
  body.append(h("section", { class: "verify-card" },
    h("h2", { text: "What you need" }),
    h("ul", { class: "verify-checks" }, ...need.map(([k, label, have, goal]) =>
      h("li", { class: data.checks[k] ? "ok" : "" },
        h("span", { class: "vc-mark", text: data.checks[k] ? "✓" : "•" }),
        h("span", { class: "vc-text" }, h("span", { text: label }),
          h("div", { class: "award-bar" }, h("span", { style: `width:${Math.min(100, Math.round((have / goal) * 100))}%` })),
          h("small", { class: "muted", text: `You have ${have.toLocaleString("en-US")}` }))))),
    ready
      ? h("p", { class: "verify-note ok", text: "You meet everything. You can apply now." })
      : h("p", { class: "verify-note", text: "Keep posting and growing. You can send the form below once you reach both." })
  ));
  if (data.request?.status === "rejected") body.append(h("p", { class: "verify-note", text: "Your last application wasn’t approved. You can apply again 30 days after it." }));
  /* The form */
  const fullName = h("input", { type: "text", class: "text-input", maxlength: 80, placeholder: "Your full name", value: state.me.name });
  const cat = h("select", { class: "text-input" }, h("option", { value: "", text: "What describes you best?" }),
    ...VERIFY_TYPES.map((t) => h("option", { value: t.id, text: `${t.emoji}  ${t.name}` })));
  cat.addEventListener("change", () => showType(cat.value || "creator"));
  const preview = h("div", { class: "vf-preview" });
  const paintPreview = () => {
    const t = verifyType(cat.value || "creator");
    preview.replaceChildren(h("span", { class: "muted", text: "Your name will look like this:" }),
      h("b", { class: "vf-name" }, state.me.name, tick({ verified: true, verifiedType: t.id }, 22)));
  };
  cat.addEventListener("change", paintPreview);
  paintPreview();
  const about = h("textarea", { class: "text-input", rows: 4, maxlength: 1000, placeholder: "Why should your account be verified? Tell us who you are and what you do." });
  const links = [0, 1, 2].map((i) => h("input", { type: "url", class: "text-input", placeholder: i ? "Another link (optional)" : "A link about you: website, article, other profile (optional)" }));
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const send = h("button", { type: "submit", class: "btn btn-primary btn-full", disabled: !ready }, icon("send"),
    h("span", { text: ready ? "Apply for verification" : `Reach ${data.min.followers.toLocaleString("en-US")} followers and ${data.min.posts} posts to apply` }));
  const form = h("form", { class: "verify-card verify-form", novalidate: true },
    h("h2", { text: "Apply" }),
    h("label", { class: "vf-label", text: "Full name" }), fullName,
    h("label", { class: "vf-label", text: "What are you?" }), cat, preview,
    h("label", { class: "vf-label", text: "About you" }), about,
    h("label", { class: "vf-label", text: "Links" }), ...links,
    err, send);
  body.append(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    send.disabled = true;
    try {
      await api("/api/verify", { method: "POST", body: { fullName: fullName.value, category: cat.value, about: about.value, links: links.map((l) => l.value) } });
      toast("Application sent.");
      view.replaceChildren();
      verifiedPage(view);
    } catch (ex) {
      err.textContent = ex.error || "Couldn’t send your application.";
      err.hidden = false;
      send.disabled = false;
    }
  });
}
verifiedPage.navName = () => "";
