// /videos: longer videos as a grid of thumbnails. Each opens its own watch page.
import { h, icon, avatar, empty } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { pagedList } from "../components/post.js";
import { openCreate } from "../components/composer.js";
import { videoTile } from "./profile.js";

function videoCard(p) {
  const tile = videoTile(p);
  // Show who posted it under the title
  tile.querySelector(".tile-text").prepend(avatar(p.author, 36));
  tile.querySelector(".tile-text h3").after(h("p", { class: "muted tile-author", text: p.author.name }));
  return tile;
}

export function videosPage(view) {
  document.title = "Videos / Look Blog";
  view.classList.add("wide");
  const uploadBtn = h("button", { class: "btn btn-primary btn-sm" }, icon("plus"), h("span", { text: "Upload" }));
  uploadBtn.addEventListener("click", () => openCreate("video"));
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const grid = h("div", { class: "video-grid big" });
  let scope = "latest", pager;

  for (const [s, label] of [["latest", "Latest"], ["following", "Following"]]) {
    tabs.append(h("button", { class: "tab", role: "tab", text: label, dataset: { scope: s }, onclick: () => { scope = s; load(); } }));
  }
  view.append(h("header", { class: "column-head" }, h("div", { class: "head-row" }, h("h1", { text: "Videos" }), uploadBtn), tabs), grid);

  function load() {
    pager?.stop();
    tabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.scope === scope));
    grid.replaceChildren();
    pager = pagedList({
      container: grid,
      load: (before) => api(`/api/feed?scope=${scope}&type=video${before ? "&before=" + encodeURIComponent(before) : ""}`),
      render: videoCard,
      emptyEl: () => empty("No videos yet.", scope === "following" ? "Videos from people you follow show up here." : "Longer videos show up here. Post the first one.",
        h("button", { class: "btn btn-primary btn-sm", text: "Upload a video", onclick: () => openCreate("video") })),
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
