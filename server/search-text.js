// Search that forgives the alphabet and the keyboard:
//  - Cyrillic and Latin find each other: "Иванчо" finds "Ivancho Lol", "ivancho" finds "Иванчо"
//  - spaces and punctuation don't matter: "ivancholol" finds "Ivancho Lol"
//  - a query typed with the wrong keyboard layout is turned back: "сэьхъгдВдв" (Bulgarian BDS keys) → "IvanchoLol"
const TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya", ы: "y", э: "e", ё: "yo", ѝ: "i", і: "i", ї: "yi", є: "ye", ґ: "g", ђ: "dj", ј: "j", љ: "lj", њ: "nj", ћ: "c", џ: "dz" };
// Keyboard layouts: the Latin key → the Cyrillic letter it types
const LAYOUTS = {
  bds: { q: ",", w: "у", e: "е", r: "и", t: "ш", y: "щ", u: "к", i: "с", o: "д", p: "з", "[": "ц", a: "ь", s: "я", d: "а", f: "о", g: "ж", h: "г", j: "т", k: "н", l: "в", ";": "м", "'": "ч", z: "ю", x: "й", c: "ъ", v: "э", b: "ф", n: "х", m: "п", ",": "р", ".": "л", "/": "б" },
  phonetic: { q: "я", w: "в", e: "е", r: "р", t: "т", y: "ъ", u: "у", i: "и", o: "о", p: "п", "[": "ш", "]": "щ", a: "а", s: "с", d: "д", f: "ф", g: "г", h: "х", j: "й", k: "к", l: "л", z: "з", x: "ь", c: "ц", v: "ж", b: "б", n: "н", m: "м", "`": "ч", "\\": "ю" },
  russian: { q: "й", w: "ц", e: "у", r: "к", t: "е", y: "н", u: "г", i: "ш", o: "щ", p: "з", "[": "х", "]": "ъ", a: "ф", s: "ы", d: "в", f: "а", g: "п", h: "р", j: "о", k: "л", l: "д", ";": "ж", "'": "э", z: "я", x: "ч", c: "с", v: "м", b: "и", n: "т", m: "ь", ",": "б", ".": "ю" },
};
const BACK = Object.fromEntries(Object.entries(LAYOUTS).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([lat, cyr]) => [cyr, lat]))]));

// Lower case, Latin letters only (Cyrillic transliterated, accents dropped)
function fold(s) {
  let out = "";
  for (const ch of String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")) out += TRANSLIT[ch] ?? ch;
  return out;
}
const compact = (s) => s.replace(/[^\p{L}\p{N}]+/gu, "");
const swap = (s, map) => [...String(s).toLowerCase()].map((ch) => map[ch] ?? ch).join("");
const hasCyr = (s) => /[Ѐ-ӿ]/.test(s);

// Every way the query may have been meant, folded
function variants(q) {
  const raw = String(q || "").trim();
  const out = new Set([fold(raw)]);
  if (raw.length >= 3) {
    if (hasCyr(raw)) for (const m of Object.values(BACK)) out.add(fold(swap(raw, m))); // Cyrillic keys pressed for a Latin word
    else for (const m of Object.values(LAYOUTS)) { const c = swap(raw, m); if (hasCyr(c)) out.add(fold(c)); } // Latin keys pressed for a Cyrillic word
  }
  return [...out].filter(Boolean).map((v) => ({ v, c: compact(v) }));
}
// Does the text contain the query (in any of its forms)? Also word-start matching for suggestions.
function makeMatcher(q) {
  const vs = variants(q);
  return {
    vs,
    includes: (text) => { const f = fold(text), fc = compact(f); return vs.some(({ v, c }) => f.includes(v) || (c.length >= 3 && fc.includes(c))); },
    startsWord: (text) => { const f = fold(text); const words = f.split(/[^\p{L}\p{N}_]+/u); const fc = compact(f); return vs.some(({ v, c }) => words.some((w) => w.startsWith(v)) || (c.length >= 3 && fc.startsWith(c))); },
    starts: (text) => { const f = fold(text), fc = compact(f); return vs.some(({ v, c }) => f.startsWith(v) || (c.length >= 3 && fc.startsWith(c))); },
    equals: (text) => { const fc = compact(fold(text)); return vs.some(({ c }) => c && fc === c); },
  };
}

module.exports = { fold, variants, makeMatcher };
