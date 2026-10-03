// /videos: longer videos as a grid of thumbnails. Each opens its own watch page.
import { h, icon, avatar, empty, tick } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { pagedList, recommendedLoader, withReason } from "../components/post.js";
import { videoTile } from "./profile.js";

function videoCard(p) {
  const tile = videoTile(p);
  // Show who posted it under the title
  tile.querySelector(".tile-text").prepend(avatar(p.author, 36));
  tile.querySelector(".tile-text h3").after(h("p", { class: "muted tile-author" }, p.author.name, tick(p.author, 14)));
  return tile;
}

export function videosPage(view) {
  document.title = "Videos / Look Blog";
  view.classList.add("wide");
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const grid = h("div", { class: "video-grid big" });
  let scope = "foryou", pager;

  for (const [s, label] of [["foryou", "Recommended"], ["all", "All"], ["following", "Following"]]) {
    tabs.append(h("button", { class: "tab", role: "tab", text: label, dataset: { scope: s }, onclick: () => { scope = s; load(); } }));
  }
  tabs.append(h("a", { class: "tab tab-cinema", href: "/cinema" }, "🎬 Movies & Series"), h("a", { class: "tab tab-cinema tab-music", href: "/music" }, icon("note", "note-ic"), "Music"));
  view.append(h("header", { class: "column-head no-title" }, tabs), grid);

  function load() {
    pager?.stop();
    tabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.scope === scope));
    grid.replaceChildren();
    pager = pagedList({
      container: grid,
      load: scope === "foryou" ? recommendedLoader("video") : (before) => api(`/api/feed?scope=${scope === "all" ? "latest" : "following"}&type=video&sort=cool${before ? "&before=" + encodeURIComponent(before) : ""}`),
      render: (p) => (scope === "foryou" ? withReason(videoCard(p), p) : videoCard(p)),
      emptyEl: () => empty("No videos yet.", scope === "following" ? "Videos from people you follow show up here." : "Longer videos show up here. You can post one from your profile."),
    });
  }
  const offCreated = on("post:created", (p) => {
    if (p.type !== "video") return;
    grid.querySelector(".empty")?.remove();
    grid.prepend(videoCard(p));
  });
  load();
  return () => { pager?.stop(); offCreated(); };
}
videosPage.navName = () => "videos";
videosPage.layout = "wide";
