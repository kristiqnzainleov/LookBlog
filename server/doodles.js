// Drawings for the bots in the party games. A bot can't hold a pen, so it "draws" one of these:
// simple pictures, wobbled a little (by a seed) so they look hand-made. Served as /doodle/<subject>-<seed>.svg.
// The bots also need words: what to draw, what a drawing is, and how a story carries on.
const crypto = require("crypto");

// Shapes on a 640×480 board: c = circle [cx, cy, r], e = ellipse [cx, cy, rx, ry], p = closed shape, l = line (open)
const D = {
  sun: { k: ["sun", "sunny", "summer", "слънце", "лято"], s: [{ c: [320, 240, 90], f: "#ffd23f" }, ...Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return { l: [[320 + Math.cos(a) * 115, 240 + Math.sin(a) * 115], [320 + Math.cos(a) * 170, 240 + Math.sin(a) * 170]], st: "#ff8a3d" }; }), { c: [290, 220, 9], f: "#111" }, { c: [350, 220, 9], f: "#111" }, { l: [[280, 270], [320, 295], [360, 270]] }] },
  house: { k: ["house", "home", "building", "къща", "дом"], s: [{ p: [[180, 240], [460, 240], [460, 420], [180, 420]], f: "#ffcf9e" }, { p: [[160, 245], [320, 110], [480, 245]], f: "#e5484d" }, { p: [[290, 330], [350, 330], [350, 420], [290, 420]], f: "#8b5a2b" }, { p: [[205, 275], [260, 275], [260, 320], [205, 320]], f: "#9fd8ff" }, { p: [[380, 275], [435, 275], [435, 320], [380, 320]], f: "#9fd8ff" }, { l: [[60, 420], [580, 420]], st: "#2ea043" }] },
  cat: { k: ["cat", "kitty", "kitten", "котка", "коте", "мачка"], s: [{ e: [320, 340, 120, 90], f: "#ffb347" }, { c: [320, 190, 85], f: "#ffb347" }, { p: [[250, 140], [260, 70], [300, 120]], f: "#ffb347" }, { p: [[340, 120], [380, 70], [390, 140]], f: "#ffb347" }, { c: [290, 180, 10], f: "#111" }, { c: [350, 180, 10], f: "#111" }, { p: [[312, 205], [328, 205], [320, 215]], f: "#ff6b9d" }, { l: [[230, 210], [290, 212]] }, { l: [[350, 212], [410, 210]] }, { l: [[230, 225], [290, 220]] }, { l: [[350, 220], [410, 225]] }, { l: [[440, 360], [520, 300], [540, 240]], st: "#ffb347", w: 16 }] },
  dog: { k: ["dog", "puppy", "doggo", "куче", "кученце"], s: [{ e: [330, 340, 130, 80], f: "#c48a5a" }, { c: [230, 220, 80], f: "#c48a5a" }, { e: [170, 230, 30, 60], f: "#7a4e2d" }, { e: [290, 230, 30, 60], f: "#7a4e2d" }, { c: [210, 205, 9], f: "#111" }, { c: [250, 205, 9], f: "#111" }, { c: [230, 245, 14], f: "#111" }, { l: [[455, 320], [520, 270]], st: "#c48a5a", w: 14 }, { l: [[260, 410], [260, 450]], w: 12, st: "#c48a5a" }, { l: [[400, 410], [400, 450]], w: 12, st: "#c48a5a" }] },
  tree: { k: ["tree", "forest", "wood", "дърво", "гора"], s: [{ p: [[295, 280], [345, 280], [350, 440], [290, 440]], f: "#8b5a2b" }, { c: [320, 200, 110], f: "#2ea043" }, { c: [240, 250, 70], f: "#2ea043" }, { c: [400, 250, 70], f: "#2ea043" }, { c: [290, 180, 12], f: "#e5484d" }, { c: [370, 230, 12], f: "#e5484d" }, { c: [250, 260, 12], f: "#e5484d" }] },
  car: { k: ["car", "auto", "drive", "кола", "автомобил", "кара"], s: [{ p: [[110, 320], [530, 320], [530, 380], [110, 380]], f: "#1f8bff" }, { p: [[200, 320], [250, 240], [410, 240], [460, 320]], f: "#1f8bff" }, { p: [[260, 255], [320, 255], [320, 315], [225, 315]], f: "#cfeaff" }, { p: [[335, 255], [400, 255], [440, 315], [335, 315]], f: "#cfeaff" }, { c: [210, 385, 42], f: "#222" }, { c: [430, 385, 42], f: "#222" }, { c: [210, 385, 16], f: "#bbb" }, { c: [430, 385, 16], f: "#bbb" }] },
  heart: { k: ["heart", "love", "valentine", "сърце", "любов", "обич"], s: [{ p: [[320, 420], [140, 250], [150, 160], [230, 120], [320, 190], [410, 120], [490, 160], [500, 250]], f: "#ff4f7a" }] },
  fish: { k: ["fish", "sea", "ocean", "риба", "рибка", "море"], s: [{ e: [300, 240, 150, 85], f: "#2ec4d6" }, { p: [[440, 240], [540, 170], [540, 310]], f: "#2ec4d6" }, { c: [220, 220, 14], f: "#fff" }, { c: [222, 220, 7], f: "#111" }, { l: [[280, 170], [320, 240], [280, 310]] }, { c: [150, 160, 12], f: "#bdf" }, { c: [130, 120, 8], f: "#bdf" }] },
  star: { k: ["star", "stars", "звезда", "звезди"], s: [{ p: Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 75 : 180; return [320 + Math.cos(a) * r, 250 + Math.sin(a) * r]; }), f: "#ffd23f" }, { c: [290, 240, 9], f: "#111" }, { c: [350, 240, 9], f: "#111" }, { l: [[295, 280], [320, 295], [345, 280]] }] },
  flower: { k: ["flower", "rose", "garden", "цвете", "роза", "цветя"], s: [{ l: [[320, 260], [320, 450]], st: "#2ea043", w: 10 }, { e: [370, 380, 40, 18], f: "#2ea043" }, ...Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return { c: [320 + Math.cos(a) * 65, 200 + Math.sin(a) * 65, 45], f: "#ff6bb5" }; }), { c: [320, 200, 40], f: "#ffd23f" }] },
  smiley: { k: ["smile", "smiley", "happy", "face", "emoji", "усмивка", "щастлив", "лице"], s: [{ c: [320, 240, 170], f: "#ffd23f" }, { e: [260, 200, 18, 30], f: "#111" }, { e: [380, 200, 18, 30], f: "#111" }, { l: [[220, 290], [270, 340], [320, 355], [370, 340], [420, 290]], w: 10 }] },
  pizza: { k: ["pizza", "food", "пица", "храна"], s: [{ p: [[320, 430], [140, 120], [500, 120]], f: "#ffcf6b" }, { l: [[140, 120], [320, 90], [500, 120]], st: "#c47a2c", w: 26 }, { c: [300, 190, 22], f: "#e5484d" }, { c: [380, 170, 20], f: "#e5484d" }, { c: [320, 290, 20], f: "#e5484d" }, { c: [250, 160, 18], f: "#e5484d" }] },
  cloud: { k: ["cloud", "sky", "weather", "облак", "небе", "rain", "дъжд"], s: [{ c: [250, 230, 80], f: "#e9eef5" }, { c: [340, 190, 100], f: "#e9eef5" }, { c: [430, 240, 75], f: "#e9eef5" }, { p: [[180, 240], [500, 240], [500, 310], [180, 310]], f: "#e9eef5" }, ...[220, 300, 380, 460].map((x) => ({ l: [[x, 340], [x - 15, 390]], st: "#1f8bff", w: 7 }))] },
  moon: { k: ["moon", "night", "sleep", "луна", "нощ", "сън"], s: [{ c: [320, 240, 150], f: "#f5e6a1" }, { c: [390, 200, 130], f: "#1b1b2f", st: "#1b1b2f" }, { c: [260, 210, 14], f: "#d8c47a" }, { c: [230, 300, 20], f: "#d8c47a" }, { c: [520, 90, 6], f: "#fff" }, { c: [120, 110, 5], f: "#fff" }] },
  ghost: { k: ["ghost", "spooky", "halloween", "призрак", "дух"], s: [{ p: [[200, 420], [200, 220], [240, 130], [320, 100], [400, 130], [440, 220], [440, 420], [400, 390], [360, 420], [320, 390], [280, 420], [240, 390]], f: "#f4f4f8" }, { e: [280, 230, 18, 28], f: "#111" }, { e: [360, 230, 18, 28], f: "#111" }, { e: [320, 300, 20, 26], f: "#111" }] },
  robot: { k: ["robot", "bot", "ai", "робот", "бот"], s: [{ p: [[230, 180], [410, 180], [410, 310], [230, 310]], f: "#aab4c3" }, { p: [[250, 320], [390, 320], [390, 440], [250, 440]], f: "#8592a6" }, { c: [280, 240, 22], f: "#2ee6a6" }, { c: [360, 240, 22], f: "#2ee6a6" }, { l: [[290, 285], [350, 285]], w: 8 }, { l: [[320, 180], [320, 120]] }, { c: [320, 112, 14], f: "#e5484d" }, { l: [[250, 350], [180, 400]], w: 12, st: "#8592a6" }, { l: [[390, 350], [460, 400]], w: 12, st: "#8592a6" }] },
  rocket: { k: ["rocket", "space", "launch", "ракета", "космос"], s: [{ p: [[320, 60], [390, 170], [390, 360], [250, 360], [250, 170]], f: "#eef1f6" }, { c: [320, 200, 30], f: "#1f8bff" }, { p: [[250, 290], [190, 380], [250, 360]], f: "#e5484d" }, { p: [[390, 290], [450, 380], [390, 360]], f: "#e5484d" }, { p: [[270, 360], [370, 360], [320, 460]], f: "#ff8a3d" }] },
  boat: { k: ["boat", "ship", "sail", "лодка", "кораб"], s: [{ p: [[130, 320], [510, 320], [450, 400], [190, 400]], f: "#8b5a2b" }, { l: [[320, 320], [320, 100]], w: 8 }, { p: [[330, 110], [460, 300], [330, 300]], f: "#fff" }, { l: [[60, 420], [140, 400], [220, 425], [300, 400], [380, 425], [460, 400], [580, 420]], st: "#1f8bff", w: 8 }] },
  apple: { k: ["apple", "fruit", "ябълка", "плод"], s: [{ c: [280, 270, 120], f: "#e5484d" }, { c: [360, 270, 120], f: "#e5484d" }, { l: [[320, 160], [330, 100]], st: "#8b5a2b", w: 10 }, { e: [375, 120, 40, 18], f: "#2ea043" }, { e: [270, 230, 20, 40], f: "#ff8a8a" }] },
  snowman: { k: ["snowman", "snow", "winter", "christmas", "снежен", "сняг", "зима", "коледа"], s: [{ c: [320, 360, 100], f: "#fff" }, { c: [320, 200, 70], f: "#fff" }, { c: [300, 185, 8], f: "#111" }, { c: [340, 185, 8], f: "#111" }, { p: [[320, 200], [370, 212], [320, 220]], f: "#ff8a3d" }, { p: [[270, 140], [370, 140], [360, 80], [280, 80]], f: "#222" }, { c: [320, 330, 9], f: "#111" }, { c: [320, 370, 9], f: "#111" }] },
  mountain: { k: ["mountain", "hill", "hike", "планина", "връх", "хълм"], s: [{ p: [[60, 420], [250, 140], [420, 420]], f: "#7d8ba3" }, { p: [[250, 420], [420, 190], [590, 420]], f: "#5c6a82" }, { p: [[210, 200], [250, 140], [290, 200], [270, 190], [250, 205], [230, 190]], f: "#fff" }, { c: [540, 90, 40], f: "#ffd23f" }] },
  icecream: { k: ["ice cream", "icecream", "dessert", "sweet", "сладолед", "десерт"], s: [{ p: [[250, 250], [390, 250], [320, 450]], f: "#d9a066" }, { c: [320, 220, 75], f: "#ff9ecf" }, { c: [280, 170, 55], f: "#fff1c9" }, { c: [360, 170, 55], f: "#9be7c4" }, { c: [320, 110, 15], f: "#e5484d" }] },
  alien: { k: ["alien", "ufo", "martian", "извънземно", "нло"], s: [{ e: [320, 220, 120, 140], f: "#7ee081" }, { e: [270, 210, 40, 24], f: "#111" }, { e: [370, 210, 40, 24], f: "#111" }, { l: [[300, 300], [340, 300]], w: 8 }, { l: [[280, 90], [250, 30]] }, { l: [[360, 90], [390, 30]] }, { c: [250, 30, 12], f: "#ffd23f" }, { c: [390, 30, 12], f: "#ffd23f" }] },
  crown: { k: ["crown", "king", "queen", "royal", "корона", "крал", "кралица"], s: [{ p: [[160, 360], [180, 160], [260, 270], [320, 140], [380, 270], [460, 160], [480, 360]], f: "#ffd23f" }, { c: [320, 300, 20], f: "#e5484d" }, { c: [230, 315, 16], f: "#1f8bff" }, { c: [410, 315, 16], f: "#2ea043" }] },
  balloon: { k: ["balloon", "party", "birthday", "балон", "парти", "рожден"], s: [{ e: [320, 190, 110, 135], f: "#ff4fa3" }, { p: [[305, 322], [335, 322], [320, 340]], f: "#ff4fa3" }, { l: [[320, 340], [300, 390], [340, 430], [315, 470]] }, { e: [280, 150, 22, 40], f: "#ffb3d6" }] },
  bird: { k: ["bird", "fly", "wings", "птица", "птиче", "лети"], s: [{ e: [320, 260, 120, 80], f: "#1f8bff" }, { c: [430, 200, 55], f: "#1f8bff" }, { p: [[480, 195], [540, 210], [480, 225]], f: "#ffd23f" }, { c: [445, 190, 9], f: "#111" }, { p: [[280, 250], [200, 150], [360, 230]], f: "#4aa8ff" }, { p: [[200, 260], [130, 230], [150, 300]], f: "#1f8bff" }] },
};
const NAMES = Object.keys(D);
const FUN = ["a potato with feelings", "my neighbour at 3am", "a very confused ghost", "abstract art", "a sandwich in love", "the meaning of life", "a dinosaur doing taxes", "grandma on a skateboard"];

// A seeded random (so the same doodle always looks the same)
function rng(seed) { let x = (Number(seed) || 1) % 2147483647; if (x <= 0) x += 2147483646; return () => (x = (x * 16807) % 2147483647) / 2147483647; }
// What a prompt is about: the subjects whose words it mentions, in the order they come (up to two)
function subjectsOf(text) {
  const t = String(text || "").toLowerCase(), found = [];
  for (const n of NAMES) { const at = Math.min(...D[n].k.map((w) => { const i = t.indexOf(w); return i < 0 ? Infinity : i; })); if (at < Infinity) found.push([at, n]); }
  return found.sort((a, b) => a[0] - b[0]).slice(0, 2).map((x) => x[1]);
}
// A drawing for this prompt (or a random one if it's something the bot can't draw)
function doodleFor(text) {
  const subj = subjectsOf(text);
  if (!subj.length) subj.push(NAMES[crypto.randomInt(NAMES.length)]);
  return `/doodle/${subj.join("_")}-${crypto.randomInt(1, 2147483646)}.svg`;
}
const DOODLE_RE = /^\/doodle\/([a-z]+(?:_[a-z]+)?)-(\d{1,10})\.svg$/;
const isDoodle = (v) => typeof v === "string" && DOODLE_RE.test(v) && DOODLE_RE.exec(v)[1].split("_").every((n) => D[n]);
const doodleSubject = (v) => (isDoodle(v) ? DOODLE_RE.exec(v)[1].split("_")[0] : null);

// The SVG: every point moved a little, lines a bit uneven, like a quick drawing with a marker
function shapesSvg(d, r) {
  const j = (v) => v + (r() - 0.5) * 9;
  const pts = (list) => list.map(([x, y]) => `${j(x).toFixed(1)},${j(y).toFixed(1)}`).join(" ");
  const ring = (cx, cy, rx, ry) => Array.from({ length: 26 }, (_, i) => { const a = (i / 26) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
  return d.s.map((sh) => {
    const stroke = sh.st || "#1a1a1a", w = sh.w || 6, fill = sh.f || "none";
    if (sh.l) return `<polyline points="${pts(sh.l)}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const poly = sh.c ? ring(sh.c[0], sh.c[1], sh.c[2], sh.c[2]) : sh.e ? ring(sh.e[0], sh.e[1], sh.e[2], sh.e[3]) : sh.p;
    return `<polygon points="${pts(poly)}" fill="${fill}" stroke="${sh.st || "#1a1a1a"}" stroke-width="5" stroke-linejoin="round"/>`;
  }).join("");
}
// Each seed draws it a bit differently: bigger or smaller, moved, sometimes mirrored, sometimes in other colours
function doodleSvg(names, seed) {
  const list = String(names).split("_");
  if (!list.length || !list.every((n) => D[n])) return null;
  const r = rng(seed);
  const tilt = ((r() - 0.5) * 8).toFixed(1), sc = (0.82 + r() * 0.22).toFixed(2), dx = ((r() - 0.5) * 50).toFixed(0), dy = ((r() - 0.5) * 30).toFixed(0), flip = r() < 0.4 ? -1 : 1;
  const hue = r() < 0.5 ? Math.round(30 + r() * 300) : 0;
  const main = `<g transform="translate(${320 + Number(dx)} ${240 + Number(dy)}) rotate(${tilt}) scale(${flip * sc} ${sc}) translate(-320 -240)"${hue ? ' filter="url(#h)"' : ""}>${shapesSvg(D[list[0]], r)}</g>`;
  // A second thing in the prompt ("a cat with a crown"): drawn smaller, up in a corner
  const extra = list[1] ? `<g transform="translate(${r() < 0.5 ? 470 : 170} 120) scale(0.42) translate(-320 -240)">${shapesSvg(D[list[1]], r)}</g>` : "";
  const defs = hue ? `<defs><filter id="h"><feColorMatrix type="hueRotate" values="${hue}"/></filter></defs>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">${defs}<rect width="640" height="480" fill="#ffffff"/>${main}${extra}</svg>`;
}
function serveDoodle(res, file) {
  const m = /^([a-z]+(?:_[a-z]+)?)-(\d{1,10})\.svg$/.exec(file);
  const svg = m && doodleSvg(m[1], m[2]);
  if (!svg) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" });
  res.end(svg);
}

/* ---------- The bots' words ---------- */
const pick = (a) => a[crypto.randomInt(a.length)];
const PROMPTS = ["a cat riding a rocket", "a dog eating pizza", "a house on a mountain", "a robot in love", "a ghost eating ice cream", "a fish driving a car", "a snowman on the beach",
  "an alien with a crown", "a tree full of apples", "a boat in the clouds", "the moon wearing a crown", "a bird with a balloon", "a happy sun", "a flower on the moon", "a pizza in space"];
// Draw & Tell: what the bot thinks a drawing is
function guessFor(prev) {
  const subj = prev && doodleSubject(prev.value);
  if (subj) {
    const word = D[subj].k[0];
    return pick([`a ${word}`, `a very happy ${word}`, `my ${word} Steve`, `a ${word}, obviously`, `a ${word} on holiday`, `an angry ${word}`, `a ${word} at a party`]);
  }
  // A person's drawing: the bot can't really see it, so it guesses with confidence
  return pick(["a cat riding a rocket", "definitely a dog", "a house… I think?", "a robot in love", "a pizza in space", "a dinosaur doing taxes", ...FUN]);
}
// Story Chain
const STORY_START = ["Once upon a time, a cat found a door in the fridge.", "It was a normal Tuesday until the moon started talking.", "The robot woke up and decided to become a chef.",
  "Nobody believed Grandma when she said she could fly.", "The pizza delivery guy knocked three times. Nobody had ordered pizza.", "Deep in the forest, a tree started singing pop songs."];
const STORY_NEXT = ["Suddenly, everything turned purple.", "Then a dog walked in wearing sunglasses.", "Nobody expected what happened next: a dance battle.", "It started raining spaghetti.",
  "“This is fine,” said the ghost, eating popcorn.", "Then the lights went out, and someone sneezed.", "Out of nowhere, a giant rubber duck appeared.", "So they did the only sensible thing: they ordered pizza.",
  "Meanwhile, on the moon, an alien was watching it all on TV.", "And that’s when the floor turned into lava.", "A wise old frog said: “You must find the golden sock.”", "Everyone screamed. Then everyone laughed.",
  "The cat sighed, put on a tiny hat and left.", "Somebody’s phone rang. It was the president.", "In the end, they all became best friends. Or did they…?"];
function storyLine(prev) { return prev && !prev.skipped ? pick(STORY_NEXT) : pick(STORY_START); }

module.exports = { doodleFor, isDoodle, serveDoodle, guessFor, storyLine, PROMPTS, pick };
