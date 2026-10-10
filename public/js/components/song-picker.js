// Picking a song (for your profile or a note), like on Instagram: a song on LookBlog, a YouTube link, or your own MP3.
// onPick(view, ref): view is what's shown and played, ref is what's sent to the server ({ song } · { yt } · { file }).
import { h, modal, toast, spinner } from "../ui.js";
import { api, upload } from "../api.js";
import { state } from "../state.js";

export function openSongPicker({ title = "Add music", onPick }) {
  let tab = "lookblog";
  const body = h("div", { class: "spk" });
  const tabs = h("div", { class: "spk-tabs" });
  const pane = h("div", { class: "spk-pane" });
  const pick = (view, ref) => { md.close(); onPick?.(view, ref); };

  function paint() {
    tabs.replaceChildren(...[["lookblog", "🔎 LookBlog"], ["youtube", "▶️ YouTube"], ["mp3", "⬆️ MP3"]].map(([k, l]) => {
      const b = h("button", { type: "button", class: "spk-tab" + (tab === k ? " on" : ""), text: l });
      b.addEventListener("click", () => { tab = k; paint(); });
      return b;
    }));
    if (tab === "lookblog") {
      const q = h("input", { type: "search", class: "text-input", placeholder: "Search a song or artist", autocomplete: "off" });
      const list = h("div", { class: "song-results" }, spinner());
      let seq = 0, t;
      const find = async () => {
        const n = ++seq;
        try {
          const { songs } = await api(`/api/songs/search?q=${encodeURIComponent(q.value.trim())}`);
          if (n !== seq) return;
          list.replaceChildren(...songs.slice(0, 12).map((sg) => {
            const b = h("button", { type: "button", class: "song-res" }, h("span", { class: "sr-cover", style: sg.cover ? `background-image:url("${sg.cover}")` : "" }), h("span", { class: "sr-text" }, h("b", { text: sg.title }), h("small", { class: "muted", text: sg.artist.name })));
            b.addEventListener("click", () => pick(sg, { song: sg.id }));
            return b;
          }));
          if (!songs.length) list.replaceChildren(h("p", { class: "muted", text: "No songs found. Try YouTube or your own MP3." }));
        } catch { list.replaceChildren(h("p", { class: "muted", text: "Couldn’t search right now." })); }
      };
      q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(find, 220); });
      find();
      pane.replaceChildren(q, list);
      setTimeout(() => q.focus(), 50);
    } else if (tab === "youtube") {
      const link = h("input", { type: "url", class: "text-input", placeholder: "Paste a YouTube link", autocomplete: "off" });
      const go = h("button", { type: "button", class: "btn btn-primary btn-full", text: "▶️ Use this song" });
      const preview = h("div", { class: "spk-yt-preview" });
      const use = async () => {
        if (!link.value.trim()) return link.focus();
        go.disabled = true; go.textContent = "Finding it…";
        try {
          const d = await api(`/api/youtube/info?url=${encodeURIComponent(link.value.trim())}`);
          pick({ kind: "youtube", id: "yt-" + d.id, yt: d.id, title: d.title, artist: { name: d.author || "YouTube" }, cover: d.cover }, { yt: { id: d.id, title: d.title, author: d.author } });
        } catch (err) { toast(err.error || "Couldn’t open that link."); go.disabled = false; go.textContent = "▶️ Use this song"; }
      };
      go.addEventListener("click", use);
      link.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); use(); } });
      pane.replaceChildren(h("p", { class: "create-hint", text: "Copy a song’s link from YouTube (or YouTube Music) and paste it here." }), link, preview, go);
      setTimeout(() => link.focus(), 50);
    } else {
      const file = h("input", { type: "file", accept: "audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav", hidden: true });
      const up = h("button", { type: "button", class: "btn btn-primary btn-full", text: "⬆️ Choose an MP3" });
      up.addEventListener("click", () => file.click());
      file.addEventListener("change", async () => {
        const f = file.files[0]; file.value = "";
        if (!f) return;
        if (f.size > 40 * 1024 * 1024) return toast("Songs can be up to 40 MB.");
        up.disabled = true; up.textContent = "Uploading… 0%";
        try {
          const type = f.type || ({ mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" })[(f.name.split(".").pop() || "").toLowerCase()] || "";
          const { url } = await upload(f.type ? f : new File([f], f.name, { type }), (p) => { up.textContent = `Uploading… ${Math.round(p * 100)}%`; });
          const name = f.name.replace(/\.[^.]+$/, "").slice(0, 100);
          pick({ kind: "file", id: "f-" + url.slice(-12), url, title: name, artist: { name: state.me.name }, cover: state.me.avatar || null, noCount: true }, { file: { url, title: name } });
        } catch (err) { toast(err.error || "Couldn’t upload it."); up.disabled = false; up.textContent = "⬆️ Choose an MP3"; }
      });
      pane.replaceChildren(h("p", { class: "create-hint", text: "Your own song: an MP3, M4A, OGG or WAV file (up to 40 MB)." }), up, file);
    }
  }
  body.append(tabs, pane);
  const md = modal({ title, body });
  paint();
}

// A song as a small pill (like on Instagram): ♫ Title · Artist — tap to play / pause.
// YouTube songs open a small player under the pill. onEdit: a ✎ to change it (only on your own).
export function songPill(song, { onEdit = null, small = false } = {}) {
  const wrap = h("div", { class: "song-pill-wrap" });
  const eq = h("span", { class: "sp-eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
  const pill = h("button", { type: "button", class: "song-pill" + (small ? " small" : ""), title: "Play" },
    song.cover ? h("span", { class: "sp-cover", style: `background-image:url("${song.cover}")` }) : h("span", { class: "sp-note", text: "♫" }),
    h("span", { class: "sp-text" }, h("b", { text: song.title }), h("span", { text: " · " + (song.artist?.name || "") })),
    song.kind === "youtube" ? h("span", { class: "sp-yt", text: "▶️" }) : null, eq);
  let frame = null, offPlayer = null;
  pill.addEventListener("click", (e) => {
    e.stopPropagation();
    if (song.kind === "youtube") {
      if (frame) { frame.remove(); frame = null; pill.classList.remove("playing"); return; }
      frame = h("iframe", { class: "pf-song-yt", src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(song.yt)}?autoplay=1&playsinline=1&rel=0`, allow: "autoplay; encrypted-media", title: song.title });
      wrap.append(frame); pill.classList.add("playing");
      return;
    }
    import("./music.js").then((m) => {
      m.playSongs([song], 0);
      const sync = () => { if (!pill.isConnected) return offPlayer?.(); pill.classList.toggle("playing", m.isPlaying(song.id)); };
      setTimeout(sync, 150);
      if (!offPlayer) import("../state.js").then((st) => { offPlayer = st.on("music:changed", sync); });
    });
  });
  wrap.append(pill);
  if (onEdit) wrap.append(h("button", { type: "button", class: "song-pill-edit", title: "Change the song", "aria-label": "Change the song", text: "✎", onclick: (e) => { e.stopPropagation(); onEdit(); } }));
  return wrap;
}
