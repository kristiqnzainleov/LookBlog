// The automatic checks on photos (and a video's first frame) when they're picked, before they're posted,
// right in the browser: NSFW (NSFWJS) and sensitive things like weapons (MobileNet).
// Everything (the libraries and the models) comes from LookBlog itself: the photo and your address go nowhere else.
// Marked ones are shown covered to others and left out of recommendations.
let modelP = null;
// (TensorFlow's bundle assigns a global "regeneratorRuntime"; if it isn't there yet it falls back to Function(),
// which our Content Security Policy blocks, and the whole library fails to load. So it exists first.)
const add = (src) => { if (!("regeneratorRuntime" in window)) window.regeneratorRuntime = undefined; return addScript(src); };
const addScript = (src) => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("load " + src)); document.head.append(s); });
function model() {
  if (!modelP) {
    modelP = (async () => {
      if (!window.tf) await add("/js/lib/tf.min.js");
      if (!window.nsfwjs) await add("/js/lib/nsfwjs.min.js");
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
// Sensitive (violence): a general picture model (MobileNet v2, ImageNet) that knows weapons.
// Loaded straight with TensorFlow from LookBlog's own copy.
let objectsP = null;
function objects() {
  if (!objectsP) {
    objectsP = (async () => {
      if (!window.tf) await add("/js/lib/tf.min.js");
      return window.tf.loadGraphModel("/models/mobilenet/model.json");
    })();
    objectsP.catch(() => { objectsP = null; });
  }
  return objectsP;
}
// ImageNet classes (the model has a "background" class first, so +1): assault rifle, revolver, rifle, holster, guillotine
const WEAPON_IDS = [413, 763, 764, 597, 583].map((i) => i + 1);
async function hasWeapon(img) {
  try {
    const net = await objects(), tf = window.tf;
    const probs = tf.tidy(() => {
      const x = tf.browser.fromPixels(img).resizeBilinear([224, 224]).toFloat().div(127.5).sub(1).expandDims(0);
      const out = net.predict(x);
      return tf.softmax(Array.isArray(out) ? out[0] : out).dataSync();
    });
    return WEAPON_IDS.some((i) => probs[i] >= 0.35);
  } catch (err) { console.warn("[sensitive check]", err?.message); return false; }
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
export const warmUp = () => { model().catch(() => {}); objects().catch(() => {}); }; // (both checks, ready before the first photo)
