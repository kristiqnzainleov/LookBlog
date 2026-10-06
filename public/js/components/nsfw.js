// The automatic checks on photos (and a video's first frame) when they're picked, before they're posted,
// right in the browser: NSFW (NSFWJS) and sensitive things like weapons (MobileNet).
// Marked ones are shown covered to others and left out of recommendations.
let modelP = null;
const add = (src) => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("load " + src)); document.head.append(s); });
function model() {
  if (!modelP) {
    modelP = (async () => {
      if (!window.tf) await add("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
      if (!window.nsfwjs) await add("https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/browser/nsfwjs.min.js");
      window.tf.enableProdMode?.();
      return window.nsfwjs.load("/models/nsfw/model.json", { size: 224 });
    })();
    modelP.catch(() => { modelP = null; });
  }
  return modelP;
}
const toImage = (src) => new Promise((ok, no) => {
  if (src instanceof HTMLImageElement || src instanceof HTMLCanvasElement) return ok(src);
  const url = URL.createObjectURL(src);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); ok(img); };
  img.onerror = () => { URL.revokeObjectURL(url); no(new Error("image")); };
  img.src = url;
});
// Sensitive (violence): a general picture model (MobileNet) that knows weapons
let objectsP = null;
function objects() {
  if (!objectsP) {
    objectsP = (async () => {
      if (!window.tf) await add("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
      if (!window.mobilenet) await add("https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js");
      return window.mobilenet.load({ version: 2, alpha: 0.5 });
    })();
    objectsP.catch(() => { objectsP = null; });
  }
  return objectsP;
}
const WEAPONS = ["assault rifle", "revolver", "rifle", "holster", "guillotine"];
async function hasWeapon(img) {
  try {
    const preds = await (await objects()).classify(img, 5);
    return preds.some((p) => WEAPONS.some((w) => p.className.startsWith(w)) && p.probability >= 0.35);
  } catch { return false; }
}

// → { nsfw, sensitive, scores } (both false when the check can't run, so nothing is ever blocked by mistake)
export async function checkImage(src) {
  try {
    const img = await toImage(src);
    const [m, weapon] = await Promise.all([model(), hasWeapon(img)]);
    const preds = await m.classify(img);
    const s = Object.fromEntries(preds.map((p) => [p.className, p.probability]));
    const nsfw = (s.Porn || 0) + (s.Hentai || 0) >= 0.55 || (s.Sexy || 0) >= 0.8;
    return { nsfw, sensitive: weapon, scores: s };
  } catch { return { nsfw: false, sensitive: false, scores: null }; }
}
// Start downloading the model early (e.g. when the composer opens)
export const warmUp = () => { model().catch(() => {}); };
