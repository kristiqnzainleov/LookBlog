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

// The menu at the top of Videos, Movies & Series and Music.
// On Videos the first three switch the list; on the other pages they lead back to Videos.
const SCOPES = [["foryou", "Recommended"], ["all", "All"], ["following", "Following"]];
export function videoTabs(active, onScope = null) {
  const tabs = h("div", { class: "tabs", role: "tablist" });
  for (const [s, label] of SCOPES) {
    tabs.append(onScope
      ? h("button", { class: "tab", role: "tab", text: label, dataset: { scope: s }, onclick: () => onScope(s) })
      : h("a", { class: "tab", href: s === "foryou" ? "/videos" : `/videos?scope=${s}`, text: label, dataset: { scope: s } }));
  }
  tabs.append(h("a", { class: "tab tab-cinema" + (active === "cinema" ? " active" : ""), href: "/cinema" }, "🎬 Movies & Series"),
    h("a", { class: "tab tab-cinema tab-music" + (active === "music" ? " active" : ""), href: "/music" }, icon("note", "note-ic"), "Music"));
  return tabs;
}

export function videosPage(view, _m, params) {
  document.title = "Videos / Look Blog";
  view.classList.add("wide");
  const grid = h("div", { class: "video-grid big" });
  let scope = SCOPES.some(([s]) => s === params?.get("scope")) ? params.get("scope") : "foryou", pager;
  const tabs = videoTabs("videos", (s) => { scope = s; history.replaceState(null, "", s === "foryou" ? "/videos" : `/videos?scope=${s}`); load(); });
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
