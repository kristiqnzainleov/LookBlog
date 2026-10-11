// Make it Meme: the meme pictures (drawn with emoji, no outside images) — shared by the server and the browser.
// layout "tb": one big picture, a caption on top and one at the bottom
// layout "rows": a picture per row, its caption next to it
// layout "labels": pictures side by side, a label on each
export const MEMES = [
  { id: "nope", layout: "rows", art: ["🙅", "😏"], bg: "#f3d36b", hint: ["Nope…", "Yes!"] },
  { id: "brain", layout: "rows", art: ["🧠", "🧠✨", "🧠💡✨", "🌌🧠🌌"], bg: "#1c1a3a", hint: ["Normal", "Smart", "Genius", "Galaxy brain"] },
  { id: "fine", layout: "tb", art: ["🐶☕", "🔥🔥🔥"], bg: "#ff8a3d", hint: ["When…", "This is fine."] },
  { id: "shock", layout: "tb", art: ["😱"], bg: "#5b5bd6", hint: ["Top text", "Bottom text"] },
  { id: "distracted", layout: "labels", art: ["💃", "🚶‍♂️", "🙍‍♀️"], bg: "#7fc8a9", hint: ["The new thing", "Me", "What I should do"] },
  { id: "buttons", layout: "labels", art: ["🔴", "🔴", "😰"], bg: "#9fb7d9", hint: ["Option 1", "Option 2", "Me"] },
  { id: "expect", layout: "rows", art: ["😎🌴", "🤡🌧️"], bg: "#ffb3c7", hint: ["Expectation", "Reality"] },
  { id: "yell", layout: "labels", art: ["😤👉", "🐱🍽️"], bg: "#e8e1d6", hint: ["Them", "Me, calmly"] },
  { id: "think", layout: "tb", art: ["🤔👉🧠"], bg: "#3fa7d6", hint: ["Can’t …", "if you …"] },
  { id: "cool", layout: "tb", art: ["😎"], bg: "#111", hint: ["Me after…", "Deal with it"] },
  { id: "clown", layout: "rows", art: ["🙂", "😀", "🤪", "🤡"], bg: "#ffd6e7", hint: ["Step 1", "Step 2", "Step 3", "Full clown"] },
  { id: "night", layout: "rows", art: ["🛌😴", "🧠💭"], bg: "#2b2d5c", hint: ["Me trying to sleep", "My brain at 3 am"] },
  { id: "skull", layout: "tb", art: ["💀"], bg: "#3b3b3b", hint: ["Me when", "I’m dead"] },
  { id: "point", layout: "tb", art: ["🫵😂"], bg: "#ffd166", hint: ["You when", "Ha ha"] },
  { id: "twins", layout: "labels", art: ["🕷️👉", "👈🕷️"], bg: "#c0392b", hint: ["Me", "Also me"] },
  { id: "math", layout: "tb", art: ["🤯🧮📐"], bg: "#6c5ce7", hint: ["Me trying to", "understand…"] },
  { id: "sad", layout: "tb", art: ["🥲"], bg: "#74b9ff", hint: ["When you…", "but…"] },
  { id: "money", layout: "tb", art: ["🤑💸"], bg: "#00b894", hint: ["Me with", "my first paycheck"] },
  { id: "chef", layout: "tb", art: ["🧑‍🍳🤌"], bg: "#fab1a0", hint: ["When the", "Chef’s kiss"] },
  { id: "drama", layout: "rows", art: ["🙂", "😭"], bg: "#a29bfe", hint: ["What happened", "How I tell it"] },
  { id: "run", layout: "labels", art: ["🏃💨", "🦖"], bg: "#55efc4", hint: ["Me", "My problems"] },
  { id: "pigeon", layout: "labels", art: ["🦋", "🧐"], bg: "#81ecec", hint: ["Something", "Is this…?"] },
  { id: "doge", layout: "tb", art: ["🐕"], bg: "#f6e58d", hint: ["Much wow", "Very…"] },
  { id: "trophy", layout: "rows", art: ["🥉", "🥈", "🥇"], bg: "#2d3436", hint: ["Good", "Better", "Best"] },
];
export const memeById = (id) => MEMES.find((m) => m.id === id);
// How many captions a picture takes (a photo of your own: top and bottom)
export function slotsOf(t) {
  const m = memeById(t?.id);
  return t?.photo || !m || m.layout === "tb" ? 2 : m.art.length;
}

// What bots write
export const BOT_CAPTIONS = [
  "Me on Monday", "My wifi at 2%", "When the teacher says pop quiz", "Me pretending to work", "My last brain cell",
  "Group chat at 3 am", "When mom says we have food at home", "Me after one push-up", "My bank account", "Homework",
  "Sleeping 8 hours", "Scrolling LookBlog instead", "Me explaining my plans", "The plot twist", "Fixing one bug",
  "Making ten new ones", "When the song drops", "My diet starting tomorrow", "Me at the party", "Mute button off",
  "Reading the comments", "Opening the fridge again", "Battery 1%", "Just one more episode", "Me", "Also me",
];
