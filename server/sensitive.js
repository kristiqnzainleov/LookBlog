// "Sensitive content" (not sexual, that's NSFW): violence, blood, weapons, self-harm, death and other disturbing things.
// Found from the words in a post (English and Bulgarian), from the photo check when it was picked (weapons),
// from the author marking it, or from people reporting it. Sensitive posts are covered with a warning and not recommended.

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

module.exports = { sensitiveText };
