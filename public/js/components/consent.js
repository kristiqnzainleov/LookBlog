// What the cookie window allows (public/cookie-consent.js). Without "Content from other sites",
// pictures from other companies (GIPHY GIFs, map tiles) wait for a tap instead of loading by themselves.
import { h } from "../ui.js";

export const extraOk = () => Boolean(window.lbConsent?.extra());

const outside = (url) => {
  try { return new URL(url, location.href).origin !== location.origin; } catch { return false; }
};

// An <img> that loads now if it's ours or allowed, otherwise a "Tap to load" button that turns into it.
export function outsideImg(props, label = "GIF") {
  const img = () => h("img", props);
  if (!outside(props.src) || extraOk()) return img();
  const btn = h("button", { type: "button", class: "ext-wait " + (props.class || ""), title: "Loads from another site, which sees your IP address" },
    h("span", { class: "ext-wait-name", text: label }), h("span", { class: "ext-wait-tap", text: "Tap to load" }));
  const show = () => { removeEventListener("lb-consent", onConsent); if (btn.parentNode) btn.replaceWith(img()); };
  const onConsent = (e) => { if (e.detail?.extra) show(); };
  addEventListener("lb-consent", onConsent);
  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); show(); });
  return btn;
}
