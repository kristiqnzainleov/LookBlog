// "Edit profile" pop-up: banner, photo, name and bio.
import { h, icon, avatar, modal, toast } from "../ui.js";
import { api, upload } from "../api.js";
import { state, emit } from "../state.js";

const IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp";

export function openEditProfile() {
  const me = state.me;
  const draft = { avatar: me.avatar, banner: me.banner };
  let uploading = 0;

  /* Banner */
  const bannerImg = h("div", { class: "edit-banner" });
  const paintBanner = () => {
    bannerImg.style.backgroundImage = draft.banner ? `url("${draft.banner}")` : "";
    bannerImg.classList.toggle("empty", !draft.banner);
    removeBanner.hidden = !draft.banner;
  };
  const bannerInput = h("input", { type: "file", accept: IMAGE_TYPES, hidden: true });
  const bannerBtn = h("button", { type: "button", class: "photo-btn", "aria-label": "Change banner" }, icon("camera"));
  const removeBanner = h("button", { type: "button", class: "photo-btn", "aria-label": "Remove banner" }, icon("close"));
  bannerBtn.addEventListener("click", () => bannerInput.click());
  removeBanner.addEventListener("click", () => { draft.banner = null; paintBanner(); });

  /* Photo */
  const avatarBox = h("div", { class: "edit-avatar" });
  const paintAvatar = () => avatarBox.replaceChildren(avatar({ ...me, avatar: draft.avatar }, 104), avatarBtn);
  const avatarInput = h("input", { type: "file", accept: IMAGE_TYPES, hidden: true });
  const avatarBtn = h("button", { type: "button", class: "photo-btn", "aria-label": "Change photo" }, icon("camera"));
  avatarBtn.addEventListener("click", () => avatarInput.click());

  async function pick(input, key, paint, box) {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return showErr("Pictures can be up to 15 MB.");
    const previous = draft[key];
    draft[key] = URL.createObjectURL(file); // show it right away
    paint();
    box.classList.add("uploading");
    uploading++;
    save.disabled = true;
    try {
      const res = await upload(file);
      draft[key] = res.url;
    } catch (err) {
      draft[key] = previous;
      showErr(err.error || "Upload failed. Try again.");
    }
    uploading--;
    box.classList.remove("uploading");
    save.disabled = uploading > 0;
    paint();
  }
  bannerInput.addEventListener("change", () => pick(bannerInput, "banner", paintBanner, bannerImg));
  avatarInput.addEventListener("change", () => pick(avatarInput, "avatar", paintAvatar, avatarBox));

  /* Name and bio */
  const name = h("input", { type: "text", id: "epName", class: "text-input", maxlength: 50, value: me.name, autocomplete: "name" });
  const bio = h("textarea", { id: "epBio", class: "text-input", rows: 3, maxlength: 200, placeholder: "Tell people a little about yourself" });
  bio.value = me.bio || "";
  const bioCount = h("span", { class: "counter" });
  const paintCount = () => {
    const left = 160 - [...bio.value].length;
    bioCount.textContent = `${[...bio.value].length} / 160`;
    bioCount.className = "counter" + (left < 0 ? " over" : "");
  };
  bio.addEventListener("input", paintCount);
  const nameErr = h("small", { class: "error" });
  const bioErr = h("small", { class: "error" });
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const save = h("button", { type: "submit", class: "btn btn-primary btn-full", text: "Save" });

  const form = h("form", { class: "edit-profile", novalidate: true },
    h("div", { class: "edit-banner-wrap" }, bannerImg, h("div", { class: "photo-actions" }, bannerBtn, removeBanner), bannerInput),
    avatarBox, avatarInput,
    h("div", { class: "field" }, h("label", { for: "epName", text: "Name" }), name, nameErr),
    h("div", { class: "field" }, h("div", { class: "label-row" }, h("label", { for: "epBio", text: "Bio" }), bioCount), bio, bioErr),
    err,
    save
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (uploading) return;
    showErr("");
    nameErr.textContent = bioErr.textContent = "";
    save.disabled = true;
    save.textContent = "Saving…";
    try {
      const { profile } = await api("/api/me/profile", {
        method: "POST",
        body: { name: name.value, bio: bio.value, avatar: draft.avatar, banner: draft.banner },
      });
      Object.assign(state.me, { name: profile.name, bio: profile.bio, avatar: profile.avatar, banner: profile.banner });
      emit("me:updated", state.me);
      m.close();
      toast("Profile saved.");
    } catch (ex) {
      if (ex.errors) { nameErr.textContent = ex.errors.name || ""; bioErr.textContent = ex.errors.bio || ""; }
      else showErr(ex.error || "Couldn’t save. Try again.");
    }
    save.disabled = false;
    save.textContent = "Save";
  });

  paintBanner();
  paintAvatar();
  paintCount();
  const m = modal({ title: "Edit profile", body: form, wide: true });
}
