// /groups — public groups anyone can find, read and join. Create your own.
import { h, icon, empty, spinner, modal, toast, plural } from "../ui.js";
import { api, upload } from "../api.js";
import { navigate } from "../router.js";
import { emit } from "../state.js";
import { chatPic, groupVisibilityPicker } from "../components/chat.js";

function openCreateGroup() {
  // A banner across the top and a picture (the group's icon) on top of it, like on the Groups page
  let cover = null, banner = null, uploading = 0;
  const bannerEl = h("button", { type: "button", class: "gc-banner", title: "Add a banner" });
  const iconEl = h("button", { type: "button", class: "gc-icon", title: "Add a picture" });
  const paint = () => {
    bannerEl.style.backgroundImage = banner ? `url("${banner}")` : "";
    bannerEl.classList.toggle("empty", !banner);
    bannerEl.replaceChildren(h("span", { class: "gc-hint" }, icon("camera"), h("span", { text: banner ? "Change banner" : "Add banner" })));
    iconEl.style.backgroundImage = cover ? `url("${cover}")` : "";
    iconEl.classList.toggle("empty", !cover);
    iconEl.replaceChildren(cover ? h("span", { class: "gc-edit" }, icon("camera"), h("span", { text: "Change" })) : h("span", { class: "gc-hint" }, icon("camera"), h("span", { text: "Picture" })));
  };
  const chooser = (set) => {
    const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", hidden: true });
    input.addEventListener("change", async () => {
      const f = input.files[0];
      input.value = "";
      if (!f) return;
      uploading++;
      create.disabled = true;
      set(URL.createObjectURL(f));
      paint();
      try { set((await upload(f)).url); } catch (err) { set(null); showErr(err.error || "Upload failed."); }
      if (!--uploading) create.disabled = false;
      paint();
    });
    return input;
  };
  const bannerInput = chooser((v) => (banner = v)), iconInput = chooser((v) => (cover = v));
  bannerEl.addEventListener("click", () => bannerInput.click());
  iconEl.addEventListener("click", () => iconInput.click());
  const name = h("input", { type: "text", class: "text-input", placeholder: "Group name", maxlength: 60 });
  const vis = groupVisibilityPicker("public");
  const desc = h("textarea", { class: "text-input", rows: 3, placeholder: "What is this group about?", maxlength: 500 });
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const showErr = (msg) => { err.textContent = msg; err.hidden = !msg; };
  const create = h("button", { type: "submit", class: "btn btn-primary btn-full", text: "Create group" });
  const form = h("form", { class: "create-form", novalidate: true },
    h("div", { class: "gc-wrap" }, bannerEl, iconEl, bannerInput, iconInput),
    name, desc, vis.el, err, create);
  const m = modal({ title: "New group", body: form });
  paint();
  setTimeout(() => name.focus(), 50);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (uploading) return showErr("Wait for the pictures to finish uploading.");
    showErr("");
    create.disabled = true;
    try {
      const { chat } = await api("/api/groups", { method: "POST", body: { name: name.value, description: desc.value, cover, banner, visibility: vis.value() } });
      m.close();
      emit("chats:changed");
      navigate(`/messages/${chat.id}`);
    } catch (ex) { showErr(ex.error || "Couldn’t create the group."); }
    create.disabled = false;
  });
}

export function groupsPage(view) {
  document.title = "Groups / LookBlog";
  view.classList.add("wide");
  const createBtn = h("button", { class: "btn btn-primary btn-sm" }, icon("plus"), h("span", { text: "New group" }));
  createBtn.addEventListener("click", openCreateGroup);
  const search = h("input", { type: "search", placeholder: "Find a group", autocomplete: "off", "aria-label": "Find a group" });
  const grid = h("div", { class: "group-grid" });
  view.append(
    h("header", { class: "column-head" },
      h("div", { class: "head-row" }, h("div", { class: "head-text" }, h("h1", { text: "Groups" }), h("p", { class: "page-sub", text: "Chats around a topic. Join a public one or start your own." })), createBtn),
      h("form", { class: "search-box group-search", role: "search", onsubmit: (e) => e.preventDefault() }, icon("search"), search)
    ),
    grid
  );

  let timer, seq = 0;
  async function load() {
    const mine = ++seq;
    grid.replaceChildren(spinner());
    try {
      const { groups } = await api(`/api/groups?q=${encodeURIComponent(search.value.trim())}`);
      if (mine !== seq) return;
      grid.replaceChildren();
      if (!groups.length) {
        grid.append(empty(search.value.trim() ? "No groups match that." : "No groups yet.", "Start the first one.", h("button", { class: "btn btn-primary btn-sm", text: "New group", onclick: openCreateGroup })));
        return;
      }
      for (const g of groups) {
        const action = h("button", { class: "btn btn-xs " + (g.member ? "btn-following" : "btn-follow"), text: g.member ? "Open" : "Join" });
        action.addEventListener("click", async (e) => {
          e.preventDefault();
          if (!g.member) {
            await api(`/api/groups/${g.id}/join`, { method: "POST" });
            toast(`You joined ${g.name}.`);
            emit("chats:changed");
          }
          navigate(`/messages/${g.id}`);
        });
        const thumb = g.banner || g.cover;
        grid.append(h("a", { class: "group-card", href: `/messages/${g.id}`, style: `--group:${g.color || "#ff4fa3"}` },
          h("div", { class: "group-banner" + (thumb ? "" : " empty"), style: thumb ? `background-image:url("${thumb}")` : "" }),
          h("div", { class: "group-body" },
            chatPic(g, 56),
            h("h3", { text: g.name }),
            g.description ? h("p", { class: "group-desc", text: g.description }) : null,
            h("div", { class: "group-foot" }, h("span", { class: "muted", text: plural(g.memberCount, "member", "members") }), action)
          )
        ));
      }
    } catch (err) {
      grid.replaceChildren(empty("Couldn’t load groups.", err.error || ""));
    }
  }
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  load();
  return () => clearTimeout(timer);
}
groupsPage.navName = () => "groups";
groupsPage.layout = "wide";
