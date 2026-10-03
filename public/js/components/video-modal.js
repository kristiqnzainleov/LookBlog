// Play a video or short right where you are (used on profiles), with a link to its full page.
import { h, icon, avatar, count, modal, timeEl, tick } from "../ui.js";
import { videoPlayer, actions, watchHref } from "./post.js";
import { profileHref, postHref } from "../router.js";
import { visibilityBadge } from "./visibility.js";

export function openVideoModal(p) {
  const m0 = p.media.find((x) => x.kind === "video");
  const vertical = p.type === "short";
  const player = videoPlayer(m0, p, { vertical, autoplay: true });
  const full = vertical ? postHref(p.id) : watchHref(p.id);
  const href = profileHref(p.author.username);
  let m;
  const go = (url) => (e) => { e.preventDefault(); m.close(); history.pushState(null, "", url); dispatchEvent(new PopStateEvent("popstate")); };
  const body = h("div", { class: "video-modal" + (vertical ? " vertical" : "") },
    player,
    h("div", { class: "vm-info" },
      p.title ? h("h3", { class: "vm-title", text: p.title }) : null,
      h("div", { class: "vm-row" },
        h("a", { href, class: "vm-author", onclick: go(href) }, avatar(p.author, 36), h("b", {}, p.author.name, tick(p.author, 15))),
        h("span", { class: "muted" }, count(p.views), p.views === 1 ? " view · " : " views · ", timeEl(p.createdAt)),
        visibilityBadge(p),
        h("a", { class: "btn btn-xs btn-outline-light vm-open", href: full, onclick: go(full) }, h("span", { text: "Open full page" }), icon("back"))
      ),
      !vertical && p.text ? h("p", { class: "vm-desc post-text", text: p.text }) : null,
      actions(p, { onDeleted: () => m.close() })
    )
  );
  m = modal({ title: vertical ? "Short" : "Video", body, wide: true, onClose: () => player.pause() });
  m.card.classList.add("video-modal-card");
}
