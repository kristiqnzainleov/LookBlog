// The automatic NSFW check: a small model (NSFWJS, MobileNetV2) runs right in the browser on photos
// (and a video's first frame) when they're picked, before they're posted. Sensitive ones get marked,
// shown blurred to others, and left out of recommendations.
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
// → { nsfw, scores } (nsfw is false when the check can't run, so nothing is ever blocked by mistake)
export async function checkImage(src) {
  try {
    const [m, img] = await Promise.all([model(), toImage(src)]);
    const preds = await m.classify(img);
    const s = Object.fromEntries(preds.map((p) => [p.className, p.probability]));
    const nsfw = (s.Porn || 0) + (s.Hentai || 0) >= 0.55 || (s.Sexy || 0) >= 0.8;
    return { nsfw, scores: s };
  } catch { return { nsfw: false, scores: null }; }
}
// Start downloading the model early (e.g. when the composer opens)
export const warmUp = () => { model().catch(() => {}); };
