// "Sensitive content" (not sexual, that's NSFW): violence, blood, weapons, self-harm, death and other disturbing things.
// It isn't allowed on LookBlog: found from the words (English and Bulgarian) or the photo check when it's picked (weapons),
// it's refused right away; posted anyway and reported by people, it's taken down.

// One of these is enough
const STRONG = [
  "gore", "gory", "beheading", "beheaded", "suicide", "self-harm", "self harm", "selfharm", "murder", "murdered", "corpse", "dead body", "dead bodies",
  "torture", "tortured", "terror attack", "terrorist attack", "mass shooting", "school shooting", "shot dead", "stabbed", "stabbing", "massacre", "execution video",
  "убийство", "убит", "убита", "самоубийство", "самонараняване", "труп", "трупове", "мъчения", "изтезания", "стрелба в", "намушкан", "намушкана", "обезглав", "клане", "терористична атака",
];
// Two of these (or one together with a sensitive photo)
const MEDIUM = [
  "blood", "bloody", "bleeding", "gun", "guns", "pistol", "rifle", "knife", "weapon", "weapons", "war", "bomb", "explosion", "violence", "violent", "fight", "accident", "crash", "injury", "injured", "wound", "dead", "death", "killed", "kill",
  "кръв", "кърви", "пистолет", "пушка", "автомат", "нож", "оръжие", "война", "бомба", "взрив", "експлозия", "насилие", "бой", "катастрофа", "ранен", "ранени", "рана", "мъртъв", "мъртви", "смърт", "убиха",
];
const norm = (t) => " " + String(t || "").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ") + " ";
const has = (text, w) => text.includes(" " + w + " ") || (w.length > 5 && text.includes(" " + w));

// → true when the words make it sensitive
function sensitiveText(...parts) {
  const t = norm(parts.join(" "));
  if (STRONG.some((w) => has(t, w))) return true;
  return MEDIUM.filter((w) => has(t, w)).length >= 2;
}

const NOT_ALLOWED = "This isn’t allowed on LookBlog. Violence, blood, weapons, self-harm and other disturbing content go against the LookBlog rules (see Terms).";
const { httpError } = require("./http");
// Throws the "not allowed" error when the words (or a photo the check flagged) are sensitive
function refuseSensitive(texts, media = []) {
  if ((media || []).some((m) => m?.sensitive) || sensitiveText(...texts)) throw httpError(400, NOT_ALLOWED);
}

module.exports = { sensitiveText, refuseSensitive, NOT_ALLOWED };
