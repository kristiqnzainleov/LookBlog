// /cinema — movies and series, Netflix style: a big featured title and rows you scroll sideways.
import { h, icon, empty, spinner, plural, tick } from "../ui.js";
import { starsBadge } from "../components/stars.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { openMovieUpload, openSeriesForm } from "../components/cinema.js";
import { videoTabs } from "./videos.js";

const movieHref = (p) => `/watch/${p.id}`;
const seriesHref = (s) => `/playlist/${s.id}`;

function card(item, kind) {
  const img = kind === "movie" ? item.film?.backdrop || item.media[0]?.poster : item.cover;
  return h("a", { class: "cn-card", href: kind === "movie" ? movieHref(item) : seriesHref(item) },
    h("div", { class: "cn-img", style: img ? `background-image:url("${img}")` : "" },
      h("span", { class: "cn-kind", text: kind === "movie" ? "MOVIE" : "SERIES" })),
    h("div", { class: "cn-info" },
      h("b", { text: item.title }),
      h("span", { class: "muted", text: kind === "movie"
        ? [item.film?.year, item.film?.genre, item.media[0]?.duration ? Math.round(item.media[0].duration / 60) + "m" : null].filter(Boolean).join(" · ")
        : [item.series?.year, item.series?.genre, plural(item.count, "episode", "episodes")].filter(Boolean).join(" · ") }),
      starsBadge(item.stars)));
}
function row(title, items, kind) {
  if (!items.length) return null;
  return h("section", { class: "cn-row" }, h("h2", { text: title }), h("div", { class: "cn-scroll" }, ...items.map((x) => card(x, x.kind === "series" ? "series" : kind))));
}

export function cinemaPage(view) {
  view.append(h("header", { class: "column-head no-title" }, videoTabs("cinema")));
  document.title = "Cinema / LookBlog";
  view.classList.add("page-cinema");
  const box = h("div", {}, spinner());
  view.append(box);
  api("/api/cinema").then(({ series, movies, mine, canMake }) => {
    const featured = movies.find((m) => m.film?.backdrop) || series.find((s) => s.cover) || movies[0] || series[0];
    const make = h("div", { class: "cn-make" },
      h("button", { class: "btn btn-sm btn-primary", onclick: () => openMovieUpload() }, icon("plus"), h("span", { text: "Upload movie" })),
      h("button", { class: "btn btn-sm btn-outline-light", onclick: () => openSeriesForm() }, icon("plus"), h("span", { text: "New series" })));
    let hero = null;
    if (featured) {
      const isMovie = Boolean(featured.film);
      const bg = isMovie ? featured.film.backdrop || featured.media[0]?.poster : featured.cover;
      const info = isMovie ? featured.film : featured.series || {};
      hero = h("section", { class: "cn-hero", style: bg ? `--cn-bg:url("${bg}")` : "" },
        h("div", { class: "cn-hero-text" },
          h("p", { class: "sr-kicker" }, h("span", { class: "sr-n", text: "L" }), isMovie ? "MOVIE" : "SERIES"),
          h("h1", { text: featured.title }),
          h("p", { class: "sr-meta" }, info.year ? h("span", { text: String(info.year) }) : null, info.rating ? h("span", { class: "sr-rating", text: info.rating }) : null, info.genre ? h("span", { text: info.genre }) : null, starsBadge(featured.stars)),
          info.tagline ? h("p", { class: "sr-tagline", text: info.tagline }) : null,
          (isMovie ? featured.text : featured.description) ? h("p", { class: "sr-desc", text: isMovie ? featured.text : featured.description }) : null,
          h("p", { class: "sr-by" }, "By ", (isMovie ? featured.author : featured.owner).name, tick(isMovie ? featured.author : featured.owner, 14)),
          h("div", { class: "sr-actions" }, h("a", { class: "sr-play", href: isMovie ? movieHref(featured) : seriesHref(featured) }, icon("play"), h("span", { text: isMovie ? "Play" : "Watch" })))));
    }
    const yours = [...mine.series.map((s) => ({ ...s, kind: "series" })), ...mine.movies];
    box.replaceChildren(
      h("header", { class: "cn-head" }, h("div", {}, h("h1", { text: "Cinema" }), h("p", { class: "page-sub", text: "Movies and series made by people on LookBlog." })), canMake ? make : null),
      hero,
      row("Series", series, "series"),
      row("Movies", movies, "movie"),
      row("Your movies & series", yours, "movie"),
      !series.length && !movies.length ? empty("Nothing showing yet.", canMake ? "Upload the first movie or start a series." : "Filmmakers and producers can upload movies and series here.") : null);
  }).catch((err) => box.replaceChildren(empty("Couldn’t load the cinema.", err.error || "")));
}
cinemaPage.navName = () => "videos";
cinemaPage.layout = "wide";
