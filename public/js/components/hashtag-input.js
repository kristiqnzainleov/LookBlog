// While you write a post, a caption or a video's description: #hashtags light up pink right in the box.
// (A copy of the text sits behind the box with the hashtags coloured; the box's own text is see-through,
// so you still type, select and paste in the real box.)
import { TAG_RE } from "../ui.js";

const COPY = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "lineHeight", "letterSpacing", "wordSpacing", "textTransform", "textIndent", "textAlign", "tabSize",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"];

export function highlightTags(ta, tries = 0) {
  if (!ta || ta._tagHl) return;
  // (the box is often made before it's put on the page: wait until it's there)
  if (!ta.isConnected) { if (tries < 120) requestAnimationFrame(() => highlightTags(ta, tries + 1)); return; }
  ta._tagHl = true;
  const back = document.createElement("div");
  back.className = "tag-hl-back";
  back.setAttribute("aria-hidden", "true");
  const wrap = document.createElement("div");
  wrap.className = "tag-hl";
  ta.before(wrap);
  wrap.append(back, ta);
  // its own colours (before its text turns see-through)
  const start = getComputedStyle(ta);
  wrap.style.setProperty("--tag-ink", start.color);
  back.style.background = start.backgroundColor;
  ta.classList.add("tag-hl-input");

  const fit = () => {
    const cs = getComputedStyle(ta);
    for (const k of COPY) back.style[k] = cs[k];
    back.style.borderStyle = "solid";
    back.style.borderColor = "transparent";
    // a scrollbar in the box makes its text narrower: the copy too
    const bar = ta.offsetWidth - ta.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    back.style.paddingRight = `calc(${cs.paddingRight} + ${Math.max(0, bar)}px)`;
  };
  const paint = () => {
    const v = ta.value;
    back.replaceChildren();
    TAG_RE.lastIndex = 0;
    let last = 0, m;
    while ((m = TAG_RE.exec(v))) {
      const s = m.index + m[1].length;
      back.append(v.slice(last, s));
      const mark = document.createElement("mark");
      mark.textContent = "#" + m[2];
      back.append(mark);
      last = s + 1 + m[2].length;
    }
    back.append(v.slice(last) + "\n");
    back.scrollTop = ta.scrollTop;
  };
  ta.addEventListener("input", paint);
  ta.addEventListener("scroll", () => { back.scrollTop = ta.scrollTop; });
  // text put in by the page (a draft, a cleared box after posting)
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  Object.defineProperty(ta, "value", { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); paint(); } });
  if (typeof ResizeObserver === "function") new ResizeObserver(() => { fit(); back.scrollTop = ta.scrollTop; }).observe(ta);
  fit();
  paint();
}
