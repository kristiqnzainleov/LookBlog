// Your look: the colour, font and effect of your name (shown everywhere your name is), and your profile's accent colour.
import { h, modal, toast, tick, avatar } from "../ui.js";
import { api, upload } from "../api.js";
import { state, emit } from "../state.js";

export const NAME_COLORS = [
  ["pink", "#ff4fa3"], ["red", "#ff4757"], ["orange", "#ff8a3d"], ["gold", "#ffd23f"], ["lime", "#b6f23a"], ["mint", "#2ee6a6"],
  ["teal", "#19d3c5"], ["sky", "#4cc9ff"], ["blue", "#3d7bff"], ["purple", "#9b5cff"], ["lilac", "#d6a4ff"], ["white", "#ffffff"],
  ["sunset", "linear-gradient(90deg,#ff7a3d,#ff4f8b,#b44cff)"], ["ocean", "linear-gradient(90deg,#1f8bff,#29d3e6)"],
  ["aurora", "linear-gradient(90deg,#2ee6a6,#4cc9ff,#9b5cff)"], ["candy", "linear-gradient(90deg,#ff4fa3,#ffd1ec,#7ad7ff)"],
  ["fire", "linear-gradient(90deg,#ffd23f,#ff8a3d,#ff2e2e)"], ["galaxy", "linear-gradient(90deg,#7597de,#b44cff,#ff4fa3)"],
  ["rainbow", "linear-gradient(90deg,#ff4757,#ff8a3d,#ffd23f,#2ee6a6,#4cc9ff,#9b5cff)"], ["peach", "linear-gradient(90deg,#ffb199,#ff7eb3)"],
  ["neon", "linear-gradient(90deg,#39ff14,#00f0ff)"], ["ice", "linear-gradient(90deg,#e0f7ff,#8fd3ff,#ffffff)"],
  ["xmas", "linear-gradient(90deg,#ff4757,#ffffff,#2ee66b,#ffd23f)"], ["forest", "linear-gradient(90deg,#2ea043,#a3e635)"], ["turtle", "linear-gradient(90deg,#2ea043,#8bd450,#d9b26b)"],
  ["steel", "linear-gradient(90deg,#e2e8f0,#94a3b8,#cbd5e1)"], ["pumpkin", "linear-gradient(90deg,#ff8a3d,#ffb347,#9b5cff)"], ["love", "linear-gradient(90deg,#ff4f7a,#ffb3c7,#ff4f7a)"],
  ["beach", "linear-gradient(90deg,#ffd23f,#ffb070,#29d3e6)"], ["matrix", "linear-gradient(90deg,#39ff14,#0fbf3a)"], ["coffee", "linear-gradient(90deg,#c69c6d,#f3e1c7)"],
  ["pastel", "linear-gradient(90deg,#ffc8e8,#c9f0ff,#e3d1ff)"], ["blood", "linear-gradient(90deg,#ff2e2e,#8b0000)"],
];
export const NAME_FONTS = [["", "Default"], ["display", "Bold"], ["serif", "Elegant"], ["mono", "Mono"], ["script", "Script"], ["rounded", "Rounded"], ["wide", "Wide"],
  ["tall", "Tall"], ["retro", "Retro"], ["marker", "Marker"], ["pixel", "Pixel"], ["scifi", "Sci-fi"], ["hand", "Handwritten"], ["groovy", "Groovy"],
  ["blocky", "Blocky"], ["comic", "Comic"], ["classic", "Classic"], ["neon", "Neon"], ["fancy", "Fancy"], ["spooky", "Spooky"], ["techno", "Techno"]];
// 🎮 Gamer fonts (lookalikes of game lettering)
export const GAMER_FONTS = [["minecraft", "Minecraft"], ["fortnite", "Fortnite"], ["valorant", "Valorant"], ["cod", "Call of Duty"], ["arcade", "Arcade"], ["glitch", "Glitch"], ["esports", "Esports"], ["terminal", "Terminal"]];
// ✨ More fonts (all of them write in Cyrillic too)
export const MORE_FONTS = [["bubbles", "Bubbles"], ["wetpaint", "Wet paint"], ["puddles", "Puddles"], ["beastly", "Beastly"], ["moonrocks", "Moon rocks"], ["microbe", "Microbe"], ["dirt", "Dirt"], ["spray", "Spray paint"], ["vinyl", "Vinyl"], ["iso", "3D Iso"], ["maze", "Maze"], ["burned", "Burned"], ["distressed", "Distressed"], ["gems", "Gemstones"], ["storm", "Storm"], ["fade80", "80s fade"], ["doodle", "Doodle"], ["hatch", "Hatched"], ["pixels", "Pixels"], ["scribble", "Scribble"], ["lines", "Lines"], ["fax", "Broken fax"], ["monoone", "Heavy"], ["comfortaa", "Comfortaa"], ["amatic", "Amatic"], ["neucha", "Neucha"], ["marck", "Marck"], ["badscript", "Bad script"], ["yeseva", "Yeseva"], ["poiret", "Poiret"], ["ruslan", "Ruslan"], ["underdog", "Underdog"], ["kelly", "Kelly slab"], ["stalinist", "Soviet"], ["seymour", "Seymour"], ["philosopher", "Philosopher"], ["pangolin", "Pangolin"], ["jura", "Jura"], ["daysone", "Days one"], ["forum", "Forum"], ["kurale", "Kurale"], ["oranienbaum", "Oranienbaum"], ["montalt", "Montserrat alt"], ["play", "Play"], ["prosto", "Prosto"], ["ubuntu", "Ubuntu"]];
export const NAME_EFFECTS = [["", "None"], ["glow", "Glow"], ["shine", "Shine"], ["shadow", "3D"], ["outline", "Outline"], ["chrome", "🪞 Chrome"], ["retro", "🕹 Retro"], ["fire", "🔥 Fire"], ["ice", "🧊 Ice"], ["neonsign", "💡 Neon sign"]];
export const RINGS = [["", "None"], ["accent", "Accent"], ["sunset", "Sunset"], ["ocean", "Ocean"], ["gold", "Gold"], ["rainbow", "Rainbow"], ["spin", "✨ Spinning"], ["neon", "Neon"], ["white", "White"], ["xmas", "🎄 Candy cane"], ["steel", "Steel"], ["forest", "Forest"],
  ["fire", "🔥 Fire"], ["ice", "🧊 Ice"], ["galaxy", "🌌 Galaxy"], ["candy", "🍬 Candy"], ["toxic", "☢️ Toxic"], ["pastel", "Pastel"], ["disco", "🪩 Disco"],
  ["lava", "🌋 Lava"], ["chrome", "🪞 Chrome"], ["royal", "👑 Royal"], ["mintice", "🌿 Mint"], ["sunrise", "🌅 Sunrise"], ["rose", "🌹 Rose"]];
// New: the banner moves, a line under the name, how the profile opens, and how the numbers look
export const BANNER_ANIMS = [["", "Still"], ["kenburns", "🎥 Slow zoom"], ["pan", "↔️ Pan"], ["shimmer", "✨ Shimmer"], ["hue", "🌈 Colour shift"], ["pulse", "💓 Pulse"], ["glitch", "📺 Glitch"]];
export const NAME_DECOS = [["", "None"], ["underline", "Underline"], ["highlight", "🖍 Marker"], ["wavy", "〰️ Wavy"], ["box", "▢ Box"], ["sparkle", "✨ Sparkles"], ["glowline", "💡 Glow line"]];
export const INTROS = [["", "None"], ["fade", "Fade in"], ["slide", "⬆️ Slide up"], ["zoom", "🔍 Zoom"], ["flip", "🔄 Flip"], ["drop", "⬇️ Drop"], ["blur", "🌫 Blur in"]];
export const STAT_STYLES = [["", "Normal"], ["glass", "🧊 Glass"], ["neon", "💡 Neon"], ["minimal", "Minimal"], ["bold", "Bold"], ["gradient", "🎨 Gradient"], ["outline", "Outline"]];
export const PROFILE_BGS = [["", "None"], ["glow", "Glow"], ["gradient", "Gradient"], ["aurora", "Aurora"], ["stars", "Stars"], ["grid", "Grid"], ["dots", "Dots"], ["waves", "Waves"],
  ["snow", "❄️ Snow"], ["candy", "🍬 Candy cane"], ["shell", "🐢 Shell"], ["pinstripe", "💼 Pinstripe"], ["hearts", "💗 Hearts"], ["matrix", "💻 Matrix"], ["sunrays", "☀️ Sun rays"],
  ["hexagons", "⬡ Hexagons"], ["zigzag", "〰️ Zigzag"], ["plaid", "🧣 Plaid"], ["circuit", "🔌 Circuit"], ["bokeh", "✨ Bokeh"], ["confetti", "🎊 Confetti"]];
export const BANNERS = [["", "Default"], ["sunset", "Sunset"], ["ocean", "Ocean"], ["aurora", "Aurora"], ["candy", "Candy"], ["fire", "Fire"], ["galaxy", "Galaxy"], ["night", "Night"], ["mint", "Mint"], ["mono", "Mono"],
  ["xmas", "🎄 Christmas"], ["winter", "❄️ Winter"], ["forest", "🌲 Forest"], ["turtle", "🐢 Turtle"], ["business", "💼 Business"], ["halloween", "🎃 Halloween"],
  ["beach", "🏖️ Beach"], ["love", "💘 Love"], ["matrix", "💻 Matrix"], ["coffee", "☕ Coffee"], ["pirate", "🏴‍☠️ Pirate"], ["spring", "🌷 Spring"]];
// Photo shape, name animation, a frame around the profile, a trail behind the pointer
export const AVATAR_SHAPES = [["", "Circle"], ["squircle", "Squircle"], ["hex", "Hexagon"], ["heart", "Heart"], ["star", "Star"], ["blob", "Blob"], ["diamond", "Diamond"],
  ["octagon", "Octagon"], ["pentagon", "Pentagon"], ["shield", "Shield"], ["leaf", "Leaf"], ["flower", "Flower"], ["drop", "Drop"]];
export const NAME_ANIMS = [["", "None"], ["wave", "Wave"], ["bounce", "Bounce"], ["pulse", "Pulse"], ["glitch", "Glitch"], ["rainbow", "Rainbow cycle"], ["float", "Float"],
  ["shake", "Shake"], ["flicker", "Flicker"], ["glow", "Glow pulse"], ["slide", "Slide"], ["zoom", "Zoom"], ["jelly", "Jelly"]];
export const CARD_FRAMES = [["", "None"], ["neon", "Neon"], ["glass", "Glass"], ["gold", "Gold"], ["pixel", "Pixel"], ["comic", "Comic"], ["holo", "Holo"],
  ["candy", "🍬 Candy cane"], ["ice", "🧊 Ice"], ["wood", "🪵 Wood"], ["business", "💼 Business"], ["shell", "🐢 Shell"],
  ["rainbow", "🌈 Rainbow"], ["fire", "🔥 Fire"], ["dashed", "Dashed"], ["double", "Double"], ["sketch", "✏️ Sketch"], ["aurora", "🌌 Aurora"]];
export const CURSOR_TRAILS = [["", "None"], ["sparkle", "✨ Sparkles"], ["hearts", "💗 Hearts"], ["stars", "⭐ Stars"], ["bubbles", "🫧 Bubbles"], ["fire", "🔥 Fire"], ["rainbow", "🌈 Rainbow"],
  ["snow", "❄️ Snow"], ["money", "💵 Money"], ["leaves", "🍃 Leaves"], ["notes", "🎵 Music"], ["love", "💘 Love"],
  ["flowers", "🌸 Flowers"], ["ghosts", "👻 Ghosts"], ["cats", "🐱 Cats"], ["paws", "🐾 Paws"]];
export const PHOTO_ANIMS = [["", "Still"], ["spin", "🌀 Spin"], ["pulse", "💓 Pulse"], ["float", "🎈 Float"], ["wobble", "🍮 Wobble"], ["glow", "✨ Glow"], ["bounce", "🏀 Bounce"]];
export const CURSORS = ["", "✨", "💖", "⭐", "🐢", "🔥", "👑", "🎮", "🍕", "🦄", "👻", "🌸", "💎", "🚀", "🐱", "🍓", "⚡", "🎧", "🌙", "🍀"];
export const BIO_STYLES = [["", "Plain"], ["card", "🪪 Card"], ["note", "🗒 Sticky note"], ["terminal", "💻 Terminal"], ["neon", "💡 Neon"], ["quote", "❝ Quote"], ["bubble", "💬 Bubble"]];
export const NAME_SIZES = [["", "Normal"], ["big", "Big"], ["huge", "Huge"]];
// One tap: a whole look at once (in groups)
const T = (color, font, effect, emoji, accent, ring, bg, banner, fx, deco, shape, anim, frame, trail) => ({ color, font, effect, emoji, accent, ring, bg, banner, fx, deco, shape, anim, frame, trail });
export const LOOK_THEME_GROUPS = [
  ["✨ Popular", [
    ["🌸 Kawaii", T("candy", "rounded", "glow", "🌸", "#ff7eb3", "spin", "dots", "candy", "sakura", "bow", "heart", "float", "glass", "hearts")],
    ["🎮 Gamer", T("neon", "minecraft", "glow", "🎮", "#39ff14", "neon", "grid", "night", "", "headphones", "squircle", "glitch", "pixel", "fire")],
    ["🌌 Galaxy", T("galaxy", "scifi", "shine", "🪐", "#9b5cff", "rainbow", "stars", "galaxy", "stars", "star", "star", "pulse", "holo", "stars")],
    ["🔥 Y2K", T("fire", "retro", "shadow", "💿", "#ff8a3d", "sunset", "waves", "fire", "confetti", "flame", "blob", "bounce", "comic", "rainbow")],
    ["👑 Royal", T("gold", "classic", "shine", "👑", "#ffd23f", "gold", "glow", "night", "sparkles", "crown", "diamond", "", "gold", "sparkle")],
    ["🖤 Minimal", T("white", "wide", "", "", "#f5f0f0", "white", "", "mono", "", "", "squircle", "", "", "")],
  ]],
  ["🎄 Holidays", [
    ["🎄 Christmas", T("xmas", "fancy", "glow", "🎄", "#e5484d", "xmas", "candy", "xmas", "xmas", "santa", "", "float", "candy", "snow")],
    ["🎅 Santa", T("xmas", "comic", "shadow", "🎅", "#ff4757", "xmas", "snow", "xmas", "snow", "santa", "heart", "bounce", "candy", "sparkle")],
    ["❄️ Winter", T("ice", "classic", "shine", "❄️", "#8fd3ff", "white", "snow", "winter", "snow", "snowflake", "hex", "", "ice", "snow")],
    ["🦌 Reindeer", T("coffee", "hand", "glow", "🦌", "#c69c6d", "gold", "snow", "winter", "snow", "antlers", "", "wave", "wood", "snow")],
    ["🎁 Gifts", T("xmas", "rounded", "glow", "🎁", "#2ee66b", "spin", "dots", "xmas", "xmas", "gift", "squircle", "bounce", "holo", "sparkle")],
    ["🎆 New Year", T("gold", "fancy", "shine", "🥂", "#ffd23f", "gold", "stars", "night", "confetti", "cap", "star", "pulse", "gold", "sparkle")],
    ["🎃 Halloween", T("pumpkin", "spooky", "glow", "🎃", "#ff8a3d", "sunset", "stars", "halloween", "pumpkins", "pumpkin", "blob", "glitch", "comic", "fire")],
    ["💘 Valentine", T("love", "script", "glow", "💘", "#ff4f7a", "spin", "hearts", "love", "love", "cupid", "heart", "pulse", "glass", "love")],
    ["🐣 Easter", T("pastel", "rounded", "", "🐣", "#ff9ecf", "accent", "dots", "spring", "petals", "flowers", "blob", "bounce", "glass", "hearts")],
  ]],
  ["🐢 Animals", [
    ["🐢 Turtle", T("turtle", "rounded", "shadow", "🐢", "#2ea043", "forest", "shell", "turtle", "turtles", "turtle", "hex", "float", "shell", "leaves")],
    ["🐠 Ocean", T("ocean", "rounded", "glow", "🐠", "#1f8bff", "ocean", "waves", "ocean", "fish", "seashell", "blob", "float", "glass", "")],
    ["🐱 Cat lover", T("peach", "hand", "", "🐱", "#ffb199", "accent", "dots", "candy", "paws", "cat", "squircle", "wave", "glass", "hearts")],
    ["🐶 Dog lover", T("gold", "comic", "shadow", "🐶", "#c48a5a", "gold", "dots", "sunset", "paws", "bone", "", "bounce", "comic", "stars")],
    ["🦄 Unicorn", T("rainbow", "groovy", "glow", "🦄", "#d6a4ff", "rainbow", "aurora", "candy", "sparkles", "unicorn", "heart", "rainbow", "holo", "rainbow")],
    ["🐉 Dragon", T("fire", "blocky", "shadow", "🐉", "#ff2e2e", "sunset", "waves", "fire", "fire", "horns", "diamond", "pulse", "gold", "fire")],
  ]],
  ["💼 Work & life", [
    ["💼 Business", T("steel", "classic", "", "💼", "#4c7dff", "steel", "pinstripe", "business", "", "tie", "squircle", "", "business", "")],
    ["📈 Investor", T("mint", "mono", "glow", "📈", "#2ee6a6", "steel", "grid", "business", "charts", "glasses", "squircle", "", "business", "money")],
    ["💸 Rich", T("gold", "fancy", "shine", "💸", "#ffd23f", "gold", "glow", "night", "money", "crown", "diamond", "pulse", "gold", "money")],
    ["🎓 Student", T("blue", "marker", "", "🎓", "#3d7bff", "accent", "grid", "ocean", "school", "gradcap", "squircle", "wave", "comic", "stars")],
    ["☕ Coffee", T("coffee", "serif", "", "☕", "#c69c6d", "gold", "dots", "coffee", "coffee", "cup", "blob", "float", "wood", "")],
    ["🎧 DJ", T("neon", "techno", "glow", "🎧", "#ff4fa3", "spin", "waves", "night", "notes", "headphones", "squircle", "pulse", "neon", "notes")],
    ["💻 Hacker", T("matrix", "terminal", "glow", "💻", "#39ff14", "neon", "matrix", "matrix", "matrix", "glasses", "squircle", "glitch", "pixel", "")],
    ["⚽ Sport", T("lime", "esports", "shadow", "⚽", "#b6f23a", "neon", "grid", "forest", "balls", "cap", "", "bounce", "neon", "stars")],
    ["🍕 Foodie", T("sunset", "comic", "shadow", "🍕", "#ff8a3d", "sunset", "dots", "fire", "food", "", "blob", "bounce", "comic", "")],
  ]],
  ["🌈 Vibes", [
    ["🌴 Summer", T("beach", "groovy", "glow", "🌴", "#ffd23f", "sunset", "sunrays", "beach", "summer", "glasses", "blob", "wave", "glass", "sparkle")],
    ["🌿 Nature", T("forest", "hand", "", "🌿", "#2ea043", "forest", "dots", "forest", "leaves", "flowers", "blob", "float", "wood", "leaves")],
    ["🍂 Autumn", T("pumpkin", "serif", "", "🍂", "#ff8a3d", "sunset", "waves", "coffee", "leaves", "", "", "float", "wood", "leaves")],
    ["🌷 Spring", T("pastel", "script", "glow", "🌷", "#ff9ecf", "spin", "dots", "spring", "petals", "flowers", "heart", "float", "glass", "hearts")],
    ["🚀 Space", T("galaxy", "scifi", "glow", "🚀", "#4cc9ff", "spin", "stars", "galaxy", "stars", "alien", "", "float", "holo", "stars")],
    ["🌙 Lo-fi", T("lilac", "hand", "", "🌙", "#d6a4ff", "accent", "stars", "night", "rain", "headphones", "squircle", "float", "glass", "")],
    ["🏴‍☠️ Pirate", T("gold", "fancy", "shadow", "🏴‍☠️", "#ffd23f", "gold", "waves", "pirate", "money", "pirate", "hex", "wave", "wood", "money")],
    ["🦇 Gothic", T("blood", "spooky", "glow", "🦇", "#b3122e", "sunset", "stars", "halloween", "bats", "horns", "diamond", "pulse", "neon", "fire")],
    ["💎 Luxury", T("ice", "fancy", "shine", "💎", "#8fd3ff", "white", "glow", "night", "gems", "crown", "diamond", "", "gold", "sparkle")],
  ]],
];
export const LOOK_THEMES = LOOK_THEME_GROUPS.flatMap(([, list]) => list);
const TRAIL_PARTS = { flowers: ["🌸", "🌼", "🌷"], ghosts: ["👻"], cats: ["🐱", "😺"], paws: ["🐾"], snow: ["❄️", "❅"], money: ["💵", "🪙"], leaves: ["🍃", "🍂"], notes: ["🎵", "🎶"], love: ["💘", "💗"], sparkle: ["✨", "✦", "⋆"], hearts: ["💗", "💖", "💕"], stars: ["⭐", "🌟", "✦"], bubbles: ["🫧", "○"], fire: ["🔥", "✨"], rainbow: ["🟥", "🟧", "🟨", "🟩", "🟦", "🟪"] };

// Something falling or floating over my profile, and a decoration on my photo
export const PROFILE_FX = [["", "None"], ["snow", "❄️ Snow"], ["hearts", "💗 Hearts"], ["sparkles", "✨ Sparkles"], ["stars", "⭐ Stars"], ["sakura", "🌸 Sakura"],
  ["confetti", "🎉 Confetti"], ["bubbles", "🫧 Bubbles"], ["fire", "🔥 Fire"], ["leaves", "🍂 Leaves"], ["money", "💸 Money rain"],
  ["xmas", "🎄 Christmas"], ["turtles", "🐢 Turtles"], ["pumpkins", "🎃 Halloween"], ["bats", "🦇 Bats"], ["love", "💌 Love"], ["notes", "🎵 Music"], ["charts", "📈 Business"],
  ["fish", "🐠 Fish"], ["rain", "💧 Rain"], ["coffee", "☕ Coffee"], ["paws", "🐾 Paws"], ["petals", "🌷 Spring"], ["gems", "💎 Gems"], ["matrix", "💻 Code"],
  ["summer", "🌴 Summer"], ["school", "📚 School"], ["balls", "⚽ Sport"], ["food", "🍕 Food"]];
const FX_PARTS = { snow: ["❄️", "❅", "❆"], hearts: ["💗", "💖", "💕", "❤️"], sparkles: ["✨", "💫", "⭐"], stars: ["⭐", "🌟", "✦"], sakura: ["🌸", "🌺", "💮"],
  confetti: ["🎉", "🎊", "✨", "🟣", "🟡"], bubbles: ["🫧", "○", "◦"], fire: ["🔥", "✨"], leaves: ["🍂", "🍁", "🍃"], money: ["💸", "💵", "🪙"],
  xmas: ["🎄", "🎁", "⭐", "🔔", "❄️", "🍬"], turtles: ["🐢", "🫧", "🐢", "🌿"], pumpkins: ["🎃", "👻", "🦇", "🕸️"], bats: ["🦇", "🦇", "🌙"], love: ["💌", "💘", "💗", "🌹"], notes: ["🎵", "🎶", "🎧", "🎤"],
  charts: ["📈", "💼", "📊", "💹", "💰"], fish: ["🐠", "🐟", "🐡", "🫧"], rain: ["💧", "💧", "☔"], coffee: ["☕", "🥐", "🍩"], paws: ["🐾", "🐾", "🦴"], petals: ["🌷", "🌼", "🌸", "🦋"],
  gems: ["💎", "✨", "💍"], matrix: ["0", "1", "0", "1", "{", "}"], summer: ["☀️", "🌴", "🍉", "🏖️", "🍹"], school: ["📚", "✏️", "📐", "🎓"], balls: ["⚽", "🏀", "🎾", "🏐"], food: ["🍕", "🍔", "🍟", "🍩", "🌮"] };
const RISING = new Set(["bubbles", "fire", "turtles", "fish", "charts"]);
export const AVATAR_DECOS = [["", "None", ""], ["crown", "Crown", "👑"], ["halo", "Halo", "😇"], ["horns", "Horns", "😈"], ["cat", "Cat ears", "🐱"], ["headphones", "Headphones", "🎧"],
  ["flowers", "Flowers", "🌸"], ["bow", "Bow", "🎀"], ["flame", "Flame", "🔥"], ["star", "Star", "⭐"], ["cap", "Party hat", "🥳"],
  ["santa", "Santa hat", "🎅"], ["antlers", "Antlers", "🦌"], ["turtle", "Turtle", "🐢"], ["tie", "Tie", "👔"], ["glasses", "Sunglasses", "🕶️"], ["pumpkin", "Pumpkin", "🎃"],
  ["snowflake", "Snowflake", "❄️"], ["cupid", "Cupid", "💘"], ["gradcap", "Grad cap", "🎓"], ["cup", "Coffee", "☕"], ["pirate", "Pirate", "🏴‍☠️"], ["gift", "Gift", "🎁"],
  ["bone", "Bone", "🦴"], ["seashell", "Shell", "🐚"], ["unicorn", "Unicorn", "🦄"], ["alien", "Alien", "👽"]];
const NAME_EMOJIS = ["✨", "💖", "🔥", "👑", "🦋", "🌸", "⭐", "🌙", "💎", "🎀", "🍓", "🐾", "🎧", "⚡", "🌈", "💫"];
const ACCENTS = ["#ff4fa3", "#ff4757", "#ff8a3d", "#ffd23f", "#2ee6a6", "#19d3c5", "#4cc9ff", "#3d7bff", "#9b5cff", "#d6a4ff"];

// Extra fonts load only when someone's name uses them
let fontsLoaded = false;
export function loadFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  document.head.append(h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,700&family=Space+Mono:wght@700&family=Pacifico&family=Fredoka:wght@600&display=swap" }),
    h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Lobster&family=Permanent+Marker&family=Press+Start+2P&family=Orbitron:wght@800&family=Caveat:wght@700&family=Righteous&family=Bungee&family=Bangers&family=Cinzel:wght@700&family=Monoton&family=Great+Vibes&family=Creepster&family=Audiowide&display=swap" }),
    h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@700&family=Luckiest+Guy&family=Teko:wght@600&family=Black+Ops+One&family=Silkscreen:wght@700&family=Rubik+Glitch&family=Russo+One&family=VT323&display=swap" }),
    h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Rubik+Bubbles&family=Rubik+Wet+Paint&family=Rubik+Puddles&family=Rubik+Beastly&family=Rubik+Moonrocks&family=Rubik+Microbe&family=Rubik+Dirt&family=Rubik+Spray+Paint&family=Rubik+Vinyl&family=Rubik+Iso&family=Rubik+Maze&family=Rubik+Burned&family=Rubik+Distressed&family=Rubik+Gemstones&family=Rubik+Storm&family=Rubik+80s+Fade&family=Rubik+Doodle+Shadow&family=Rubik+Marker+Hatch&family=Rubik+Pixels&family=Rubik+Scribble&family=Rubik+Lines&family=Rubik+Broken+Fax&family=Rubik+Mono+One&display=swap" }),
    h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Comfortaa:wght@700&family=Amatic+SC:wght@700&family=Neucha&family=Marck+Script&family=Bad+Script&family=Yeseva+One&family=Poiret+One&family=Ruslan+Display&family=Underdog&family=Kelly+Slab&family=Stalinist+One&family=Seymour+One&family=Philosopher:wght@700&family=Pangolin&family=Jura:wght@700&family=Days+One&family=Forum&family=Kurale:wght@700&family=Oranienbaum&family=Montserrat+Alternates:wght@700&family=Play:wght@700&family=Prosto+One&family=Ubuntu:wght@700&display=swap" }));
}
// A custom gradient is saved as "grad:#aaaaaa,#bbbbbb@90" (colours, then the direction in degrees)
const parseGrad = (c) => { const [cols, deg] = c.slice(5).split("@"); return { cols: cols.split(","), deg: Number(deg) || 90 }; };
const gradCss = (g) => `linear-gradient(${g.deg}deg,${g.cols.join(",")})`;
const colorValue = (c) => (c?.startsWith("#") ? c : c?.startsWith("grad:") ? gradCss(parseGrad(c)) : NAME_COLORS.find(([k]) => k === c)?.[1] || null);

// Put a look on the element that holds a name
export function applyLook(el, look) {
  if (!el) return;
  const c = colorValue(look?.color);
  el.classList.toggle("nl", Boolean(look && (c || look.font || look.effect || look.anim)));
  if (c) {
    el.style.setProperty("--ng", c.startsWith("linear") ? c : `linear-gradient(${c},${c})`);
    el.style.setProperty("--nc", c.startsWith("linear") ? c.match(/#[0-9a-f]{6}/i)?.[0] || "#ff4fa3" : c);
  } else { el.style.removeProperty("--ng"); el.style.removeProperty("--nc"); }
  if (look?.font) { el.dataset.nf = look.font; loadFonts(); } else delete el.dataset.nf;
  if (look?.effect) el.dataset.ne = look.effect; else delete el.dataset.ne;
  if (look?.anim) { el.dataset.na = look.anim; el.classList.add("nl"); } else delete el.dataset.na;
  el.dataset.ncol = c ? "1" : "";
  // An emoji next to the name
  el.querySelector(":scope > .nl-emoji")?.remove();
  if (look?.emoji) {
    const e = h("span", { class: "nl-emoji", "aria-hidden": "true", text: look.emoji });
    const mark = el.querySelector(":scope > .verified, :scope > .nl-hook");
    mark ? mark.before(e) : el.append(e);
    el.classList.add("nl");
  }
}

// The profile page: ring around the photo, background, and banner colours (when there's no banner picture)
export function applyProfileLook({ view, avatarWrap, banner, bio, statusSlot, songSlot, fxBox, card }, look, song) {
  if (avatarWrap) { if (look?.ring) avatarWrap.dataset.ring = look.ring; else delete avatarWrap.dataset.ring; }
  if (avatarWrap) { if (look?.shape) avatarWrap.dataset.shape = look.shape; else delete avatarWrap.dataset.shape; }
  if (card) { if (look?.frame) card.dataset.frame = look.frame; else delete card.dataset.frame; }
  if (avatarWrap) { if (look?.photoAnim) avatarWrap.dataset.pa = look.photoAnim; else delete avatarWrap.dataset.pa; }
  if (bio) { if (look?.bioStyle) bio.dataset.bs = look.bioStyle; else delete bio.dataset.bs; }
  if (view) {
    if (look?.nameSize) view.dataset.nsz = look.nameSize; else delete view.dataset.nsz;
    for (const [k, attr] of [["bannerAnim", "ban"], ["nameDeco", "ndeco"], ["intro", "intro"], ["statStyle", "stst"]]) { if (look?.[k]) view.dataset[attr] = look[k]; else delete view.dataset[attr]; }
    // An emoji instead of the mouse pointer on my profile
    view.style.cursor = look?.cursor ? `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><text x='2' y='26' font-size='24'>${look.cursor}</text></svg>`)}") 6 6, auto` : "";
  }
  // A trail behind the pointer while you look at the profile
  const trailHost = fxBox || view;
  if (trailHost) {
    trailHost._trailOff?.();
    if (look?.trail && TRAIL_PARTS[look.trail] && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const parts = TRAIL_PARTS[look.trail];
      let last = 0, k = 0;
      const move = (e) => {
        const now = performance.now();
        if (now - last < 45) return;
        last = now;
        const p = h("span", { class: "trail-dot", text: parts[k++ % parts.length], style: `left:${e.clientX}px;top:${e.clientY}px;--dx:${(Math.random() - 0.5) * 40}px` });
        document.body.append(p);
        setTimeout(() => p.remove(), 900);
      };
      trailHost.addEventListener("pointermove", move);
      trailHost._trailOff = () => trailHost.removeEventListener("pointermove", move);
    }
  }
  if (view) { if (look?.bg) view.dataset.pbg = look.bg; else delete view.dataset.pbg; }
  if (banner) { if (look?.banner) banner.dataset.bfx = look.banner; else delete banner.dataset.bfx; }
  // A decoration on the photo (a crown, cat ears, a halo…)
  if (avatarWrap) {
    avatarWrap.querySelector(":scope > .av-deco")?.remove();
    const d = AVATAR_DECOS.find(([k]) => k && k === look?.deco);
    if (d) avatarWrap.append(h("span", { class: "av-deco", dataset: { deco: d[0] }, "aria-hidden": "true" }, ...decoParts(d[0], d[2])));
  }
  // Falling (or rising) things over the profile
  const fxHost = fxBox || view;
  if (fxHost) {
    fxHost.querySelector(":scope > .pfx")?.remove();
    if (look?.fx && FX_PARTS[look.fx] && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const parts = FX_PARTS[look.fx];
      // Confetti and money are drawn pieces (paper strips, bank notes, coins) that tumble as they fall
      const drawn = look.fx === "confetti" || look.fx === "money";
      const n = drawn ? (fxBox ? 18 : innerWidth < 700 ? 26 : 44) : fxBox ? 10 : 22;
      const CONF = ["#ff4fa3", "#ffd23f", "#2ee6a6", "#1f8bff", "#9b5cff", "#ff8a3d", "#ffffff", "#ff4757"];
      const piece = (i) => {
        const base = `left:${(((i * 61.8034) % 100) * 0.94 + 3).toFixed(1)}%;--delay:-${((i * 53) % 120) / 10}s;--drift:${((i * 41) % 80) - 40}px;--spin:${1.2 + ((i * 17) % 20) / 10}s;--tilt:${(i * 67) % 360}deg`;
        // three layers, each with one smooth movement: falling (span) · swaying side to side (em) · tumbling (i)
        const sway = `--sw:${2.2 + ((i * 13) % 14) / 10}s`;
        if (look.fx === "confetti") return h("span", { class: "cf", style: `${base};--dur:${6 + ((i * 37) % 6)}s;--c:${CONF[i % CONF.length]};--w:${7 + (i % 4) * 2}px;--h:${12 + ((i * 3) % 5) * 2}px` }, h("em", { style: sway }, h("i")));
        if (i % 3 === 2) return h("span", { class: "coin", style: `${base};--dur:${5 + ((i * 37) % 5)}s;--sz:${16 + (i % 3) * 4}px` }, h("em", { style: sway }, h("i", { text: "$" })));
        return h("span", { class: "bill", style: `${base};--dur:${7 + ((i * 37) % 6)}s;--sc:${0.8 + ((i * 29) % 6) / 10}` }, h("em", { style: sway }, h("i", {}, h("b", { text: "$" }), h("small", { text: "100" }))));
      };
      // (inside a small box, things fall exactly its height, so none of them are hidden below it half the time)
      fxHost.append(h("div", { class: "pfx" + (RISING.has(look.fx) ? " rise" : "") + (fxBox ? " inside" : "") + (drawn ? " drawn" : "") + " k-" + look.fx, "aria-hidden": "true", style: fxBox ? `--fall:${Math.max(160, (fxBox.offsetHeight || 220) + 40)}px` : "" }, ...Array.from({ length: n }, (_, i) => drawn ? piece(i) : h("span", {
        text: parts[i % parts.length],
        style: `left:${(i * 97) % 100}%;--dur:${7 + ((i * 37) % 9)}s;--delay:-${(i * 53) % 12}s;--size:${0.8 + ((i * 29) % 10) / 10}em;--drift:${((i * 41) % 60) - 30}px`,
      }))));
    }
  }
  if (bio) { if (look?.bioFont) { bio.dataset.nf = look.bioFont; bio.classList.add("nl"); loadFonts(); } else { delete bio.dataset.nf; } }
  // Status under the name
  if (statusSlot) statusSlot.replaceChildren(...(look?.status ? [h("p", { class: "pf-status" }, look.status.emoji ? h("span", { class: "pf-status-e", text: look.status.emoji }) : null, h("span", { text: look.status.text || "" }))] : []));
  // The profile's song
  if (songSlot) {
    songSlot.replaceChildren();
    if (song) {
      const play = h("button", { type: "button", class: "pf-song", title: "Play" },
        h("span", { class: "pf-song-cover", style: song.cover ? `background-image:url("${song.cover}")` : "" }, h("i", { text: "▶" })),
        h("span", { class: "pf-song-text" }, h("small", { text: song.kind === "youtube" ? "▶️ Profile song · YouTube" : "🎵 Profile song" }), h("b", { text: song.title }), h("span", { class: "muted", text: song.artist?.name || "" })),
        h("span", { class: "pf-song-eq", "aria-hidden": "true" }, h("i"), h("i"), h("i")));
      if (song.kind === "youtube") {
        let frame = null;
        play.addEventListener("click", () => {
          if (frame) { frame.remove(); frame = null; play.classList.remove("playing"); return; }
          frame = h("iframe", { class: "pf-song-yt", src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(song.yt)}?autoplay=1&playsinline=1&rel=0`, allow: "autoplay; encrypted-media", title: song.title, loading: "lazy" });
          play.after(frame); play.classList.add("playing");
        });
      } else play.addEventListener("click", () => import("./music.js").then((m) => { m.playSongs([song], 0); play.classList.add("playing"); }));
      songSlot.append(play);
    }
  }
}
// Some decorations are two pieces (cat ears, horns)
function decoParts(k, e) {
  if (k === "cat") return [h("i", { class: "ear l" }), h("i", { class: "ear r" })];
  if (k === "horns") return [h("i", { class: "horn l" }), h("i", { class: "horn r" })];
  if (k === "halo") return [h("i", { class: "halo" })];
  if (k === "headphones") return [h("i", { class: "phones" }), h("b", { text: "🎧" })];
  if (k === "flowers") return [h("b", { class: "f1", text: "🌸" }), h("b", { class: "f2", text: "🌼" }), h("b", { class: "f3", text: "🌷" })];
  if (k === "santa") return [h("i", { class: "santa" }, h("i", { class: "santa-pom" }))];
  if (k === "antlers") return [h("i", { class: "antler l" }), h("i", { class: "antler r" })];
  return [h("b", { text: e })];
}

// Names next to a tick (or the empty hook) get their owner's look, everywhere on the site
export function lookHook(user, mark) {
  queueMicrotask(() => {
    const p = mark.parentElement;
    if (!p || p.classList.contains("nl-skip")) return;
    // Only a small element that holds just the name (not a whole row of text)
    const text = p.textContent.trim();
    if (!text || text.length > 64 || /[@·]/.test(text) || p.children.length > 3) return;
    applyLook(p, user.look);
  });
}

// The editor: pick a colour, font and effect for your name, and an accent colour for your profile
export function openLookEditor(onSaved, opts = {}) {
  const cur = { color: "", font: "", effect: "", accent: "", ring: "", bg: "", banner: "", emoji: "", fx: "", deco: "", bioFont: "", status: null, song: "", shape: "", anim: "", frame: "", trail: "", featured: [], ...(state.me.look || {}) };
  let songObj = opts.song || null;
  const preview = h("span", { class: "look-preview-name", text: state.me.name });
  const miniBanner = h("div", { class: "look-mini-banner profile-banner" + (state.me.banner ? "" : " empty"), style: state.me.banner ? `background-image:url("${state.me.banner}")` : "" });
  const miniAvatar = h("div", { class: "look-mini-avatar profile-avatar" }, avatar(state.me, 64));
  const previewStatus = h("div", { class: "look-preview-status" });
  const previewWrap = h("div", { class: "look-preview" }, miniBanner, miniAvatar,
    h("b", { class: "look-preview-b" }, preview, tick(state.me, 24)), h("small", { class: "muted", text: "@" + state.me.username }), previewStatus);
  const paint = () => {
    applyLook(previewWrap.querySelector(".look-preview-b"), cur);
    applyProfileLook({ view: previewWrap, avatarWrap: miniAvatar, banner: state.me.banner ? null : miniBanner, fxBox: previewWrap, statusSlot: previewStatus, card: previewWrap }, cur);
    for (const [box, key] of [[fxs, "fx"], [decos, "deco"], [bioFonts, "bioFont"], [shapes, "shape"], [anims, "anim"], [frames, "frame"], [trails, "trail"], [photoAnims, "photoAnim"], [bioStyles, "bioStyle"], [nameSizes, "nameSize"], [cursors, "cursor"], [bannerAnims, "bannerAnim"], [nameDecos, "nameDeco"], [intros, "intro"], [statStyles, "statStyle"]]) for (const b of box.children) b.classList.toggle("on", (b.dataset.v || "") === (cur[key] || ""));
    songLabel.textContent = songObj ? `${songObj.kind === "youtube" ? "▶️" : songObj.kind === "file" ? "💾" : "🎵"} ${songObj.title} · ${songObj.artist?.name || ""}` : "No song";
    songClear.hidden = !songObj;
    previewWrap.style.setProperty("--accent", cur.accent || "#ff4fa3");
    previewWrap.style.setProperty("--pink", cur.accent || "#ff4fa3");
    for (const [box, key] of [[emojis, "emoji"], [rings, "ring"], [bgs, "bg"], [banners, "banner"]]) for (const b of box.children) b.classList.toggle("on", (b.dataset.v || "") === (cur[key] || ""));
    for (const b of colors.querySelectorAll(".look-sw")) b.classList.toggle("on", (b.dataset.v || "") === (cur.color || ""));
    custom.value = cur.color?.startsWith("#") ? cur.color : "#ff4fa3";
    gradBox?.classList.toggle("on", Boolean(cur.color?.startsWith("grad:")));
    customWrap.classList.toggle("on", Boolean(cur.color?.startsWith("#")));
    for (const b of [...fonts.children, ...gamerFonts.children]) b.classList.toggle("on", b.dataset.v === (cur.font || ""));
    for (const b of effects.children) b.classList.toggle("on", b.dataset.v === (cur.effect || ""));
    for (const b of accents.querySelectorAll(".look-acc")) b.classList.toggle("on", (b.dataset.v || "") === (cur.accent || ""));
  };
  const sw = (v, bg, label) => {
    const b = h("button", { type: "button", class: "look-sw", title: label, "aria-label": label, dataset: { v }, style: v ? `background:${bg}` : "" }, v ? null : h("span", { text: "∅" }));
    b.addEventListener("click", () => { cur.color = v; paint(); });
    return b;
  };
  const custom = h("input", { type: "color", class: "look-custom", "aria-label": "Any colour" });
  custom.addEventListener("input", () => { cur.color = custom.value; paint(); });
  const customWrap = h("label", { class: "look-sw look-custom-wrap", title: "Any colour" }, h("span", { text: "＋" }), custom);
  const colors = h("div", { class: "look-grid" }, sw("", "", "Default"), ...NAME_COLORS.map(([k, v]) => sw(k, v, k[0].toUpperCase() + k.slice(1))), customWrap);
  // My own gradient: 2–4 colours and a direction
  const grad = cur.color?.startsWith("grad:") ? parseGrad(cur.color) : { cols: ["#ff4fa3", "#4cc9ff"], deg: 90 };
  const gradStops = h("div", { class: "grad-stops" });
  const gradBar = h("div", { class: "grad-bar" });
  const angle = h("input", { type: "range", min: 0, max: 360, step: 5, value: grad.deg, class: "grad-angle", "aria-label": "Direction" });
  const angleLabel = h("span", { class: "muted grad-deg" });
  const addStop = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "＋ Colour" });
  const useGrad = () => { cur.color = `grad:${grad.cols.join(",")}@${grad.deg}`; paint(); paintGrad(); };
  function paintGrad() {
    gradBar.style.background = gradCss(grad);
    angleLabel.textContent = grad.deg + "°";
    addStop.hidden = grad.cols.length >= 4;
    gradStops.replaceChildren(...grad.cols.map((c, i) => {
      const input = h("input", { type: "color", value: c, "aria-label": `Colour ${i + 1}` });
      input.addEventListener("input", () => { grad.cols[i] = input.value; useGrad(); });
      const del = grad.cols.length > 2 ? h("button", { type: "button", class: "grad-del", "aria-label": "Remove this colour", text: "✕", onclick: () => { grad.cols.splice(i, 1); useGrad(); } }) : null;
      return h("label", { class: "grad-stop", style: `background:${c}` }, input, del);
    }));
    gradBox.classList.toggle("on", Boolean(cur.color?.startsWith("grad:")));
  }
  angle.addEventListener("input", () => { grad.deg = Number(angle.value); useGrad(); });
  addStop.addEventListener("click", () => { grad.cols.push(grad.cols[grad.cols.length - 1]); useGrad(); });
  gradBar.addEventListener("click", useGrad);
  const gradBox = h("div", { class: "grad-box" }, gradBar, h("div", { class: "grad-row" }, gradStops, addStop), h("div", { class: "grad-row" }, h("span", { text: "Direction" }), angle, angleLabel));
  const chip = (list, key) => h("div", { class: "look-chips" }, ...list.map(([v, label]) => {
    const b = h("button", { type: "button", class: "look-chip", dataset: { v, nf: key === "font" ? v : null }, text: label });
    if (key === "font" && v) loadFonts();
    b.addEventListener("click", () => { cur[key] = v; paint(); });
    return b;
  }));
  const fonts = chip(NAME_FONTS, "font");
  const gamerFonts = chip([...GAMER_FONTS, ...MORE_FONTS], "font");
  const effects = chip(NAME_EFFECTS, "effect");
  const accentCustom = h("input", { type: "color", class: "look-custom", "aria-label": "Any accent colour" });
  accentCustom.addEventListener("input", () => { cur.accent = accentCustom.value; paint(); });
  const accents = h("div", { class: "look-grid" },
    (() => { const b = h("button", { type: "button", class: "look-acc", dataset: { v: "" }, title: "Default" }, h("span", { text: "∅" })); b.addEventListener("click", () => { cur.accent = ""; paint(); }); return b; })(),
    ...ACCENTS.map((c) => { const b = h("button", { type: "button", class: "look-acc", dataset: { v: c }, style: `background:${c}`, title: c }); b.addEventListener("click", () => { cur.accent = c; paint(); }); return b; }),
    h("label", { class: "look-acc look-custom-wrap", title: "Any colour" }, h("span", { text: "＋" }), accentCustom));
  // Emoji next to my name, ring around my photo, profile background, banner colours
  const pickRow = (list, key, cls = "look-chip") => h("div", { class: "look-chips" }, ...list.map(([v, label]) => {
    const b = h("button", { type: "button", class: cls, dataset: { v, [key]: v }, text: label });
    b.addEventListener("click", () => { cur[key] = v; paint(); });
    return b;
  }));
  const emojiMore = h("button", { type: "button", class: "look-emo more", title: "Any emoji", text: "＋" });
  const emojis = h("div", { class: "look-chips" },
    (() => { const b = h("button", { type: "button", class: "look-emo", dataset: { v: "" }, text: "∅" }); b.addEventListener("click", () => { cur.emoji = ""; paint(); }); return b; })(),
    ...NAME_EMOJIS.map((e) => { const b = h("button", { type: "button", class: "look-emo", dataset: { v: e }, text: e }); b.addEventListener("click", () => { cur.emoji = e; paint(); }); return b; }),
    emojiMore);
  emojiMore.addEventListener("click", () => import("./emoji.js").then(({ openEmojiPicker }) => openEmojiPicker(emojiMore, (e) => { cur.emoji = e; paint(); })));
  const rings = pickRow(RINGS, "ring", "look-chip look-ring");
  const bgs = pickRow(PROFILE_BGS, "bg");
  const banners = pickRow(BANNERS, "banner", "look-chip look-banner");
  // Profile effects, photo decoration, bio font
  const fxs = pickRow(PROFILE_FX, "fx");
  const decos = h("div", { class: "look-chips" }, ...AVATAR_DECOS.map(([v, label, e]) => {
    const b = h("button", { type: "button", class: "look-chip", dataset: { v }, text: e ? `${e} ${label}` : label });
    b.addEventListener("click", () => { cur.deco = v; paint(); });
    return b;
  }));
  const bioFonts = h("div", { class: "look-chips" }, ...[...NAME_FONTS, ...GAMER_FONTS, ...MORE_FONTS].map(([v, label]) => {
    const b = h("button", { type: "button", class: "look-chip", dataset: { v, nf: v }, text: label });
    b.addEventListener("click", () => { cur.bioFont = v; paint(); });
    return b;
  }));
  // Status: an emoji and a few words under my name
  const stEmoji = h("button", { type: "button", class: "look-emo st-emoji", title: "Pick an emoji", text: cur.status?.emoji || "🙂" });
  const stText = h("input", { type: "text", class: "text-input st-text", maxlength: 60, placeholder: "e.g. Playing Minecraft · At the gym · Listening to music", value: cur.status?.text || "" });
  const stClear = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Clear" });
  const syncStatus = () => { const t = stText.value.trim(), e = stEmoji.dataset.set ? stEmoji.textContent : ""; cur.status = t || e ? { emoji: e, text: t } : null; paint(); };
  if (cur.status?.emoji) stEmoji.dataset.set = "1";
  stEmoji.addEventListener("click", () => import("./emoji.js").then(({ openEmojiPicker }) => openEmojiPicker(stEmoji, (e) => { stEmoji.textContent = e; stEmoji.dataset.set = "1"; syncStatus(); })));
  stText.addEventListener("input", syncStatus);
  stClear.addEventListener("click", () => { stText.value = ""; stEmoji.textContent = "🙂"; delete stEmoji.dataset.set; syncStatus(); });
  const statusRow = h("div", { class: "st-row" }, stEmoji, stText, stClear);
  // Profile song: search LookBlog's music
  const songLabel = h("span", { class: "song-label" });
  const songClear = h("button", { type: "button", class: "btn btn-xs btn-outline-light", text: "Remove" });
  songClear.addEventListener("click", () => { songObj = null; cur.song = ""; paint(); });
  const songSearch = h("input", { type: "search", class: "text-input", placeholder: "Search a song or artist on LookBlog", autocomplete: "off" });
  // …or a YouTube link
  const ytLink = h("input", { type: "url", class: "text-input", placeholder: "…or paste a YouTube link", autocomplete: "off" });
  const ytUse = h("button", { type: "button", class: "btn btn-sm btn-primary", text: "▶️ Use it" });
  const useYt = async () => {
    if (!ytLink.value.trim()) return ytLink.focus();
    ytUse.disabled = true;
    try { const d = await api(`/api/youtube/info?url=${encodeURIComponent(ytLink.value.trim())}`); songObj = { kind: "youtube", id: "yt-" + d.id, yt: d.id, title: d.title, artist: { name: d.author || "YouTube" }, cover: d.cover }; ytLink.value = ""; paint(); }
    catch (err) { toast(err.error || "Couldn’t open that link."); }
    ytUse.disabled = false;
  };
  ytUse.addEventListener("click", useYt);
  ytLink.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); useYt(); } });
  // …or my own MP3
  const mp3 = h("input", { type: "file", accept: "audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav", hidden: true });
  const mp3Btn = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "⬆️ Upload an MP3" });
  mp3Btn.addEventListener("click", () => mp3.click());
  mp3.addEventListener("change", async () => {
    const f = mp3.files[0]; mp3.value = "";
    if (!f) return;
    if (f.size > 40 * 1024 * 1024) return toast("Songs can be up to 40 MB.");
    mp3Btn.disabled = true; mp3Btn.textContent = "Uploading… 0%";
    try {
      const type = f.type || ({ mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" })[(f.name.split(".").pop() || "").toLowerCase()] || "";
      const { url } = await upload(f.type ? f : new File([f], f.name, { type }), (p) => { mp3Btn.textContent = `Uploading… ${Math.round(p * 100)}%`; });
      songObj = { kind: "file", id: "pf-" + state.me.username, url, title: f.name.replace(/\.[^.]+$/, "").slice(0, 100), artist: { name: state.me.name }, cover: state.me.avatar || null, noCount: true };
      paint();
    } catch (err) { toast(err.error || "Couldn’t upload it."); }
    mp3Btn.disabled = false; mp3Btn.textContent = "⬆️ Upload an MP3";
  });
  const songResults = h("div", { class: "song-results" });
  let songSeq = 0, songTimer;
  const findSongs = async () => {
    const n = ++songSeq;
    try {
      const { songs } = await api(`/api/songs/search?q=${encodeURIComponent(songSearch.value.trim())}`);
      if (n !== songSeq) return;
      songResults.replaceChildren(...songs.slice(0, 6).map((sg) => {
        const b = h("button", { type: "button", class: "song-res" }, h("span", { class: "sr-cover", style: sg.cover ? `background-image:url("${sg.cover}")` : "" }), h("span", { class: "sr-text" }, h("b", { text: sg.title }), h("small", { class: "muted", text: sg.artist.name })));
        b.addEventListener("click", () => { songObj = sg; cur.song = sg.id; paint(); });
        return b;
      }));
      if (!songs.length) songResults.append(h("p", { class: "muted", text: "No songs found." }));
    } catch {}
  };
  songSearch.addEventListener("input", () => { clearTimeout(songTimer); songTimer = setTimeout(findSongs, 220); });
  findSongs();
  const shapes = pickRow(AVATAR_SHAPES, "shape");
  const anims = pickRow(NAME_ANIMS, "anim");
  const frames = pickRow(CARD_FRAMES, "frame");
  const trails = pickRow(CURSOR_TRAILS, "trail");
  const photoAnims = pickRow(PHOTO_ANIMS, "photoAnim");
  const bioStyles = pickRow(BIO_STYLES, "bioStyle");
  const nameSizes = pickRow(NAME_SIZES, "nameSize");
  const bannerAnims = pickRow(BANNER_ANIMS, "bannerAnim");
  const nameDecos = pickRow(NAME_DECOS, "nameDeco");
  const intros = pickRow(INTROS, "intro");
  const statStyles = pickRow(STAT_STYLES, "statStyle");
  const cursors = h("div", { class: "look-chips" }, ...CURSORS.map((e) => { const b = h("button", { type: "button", class: "look-emo", dataset: { v: e, cursor: e }, text: e || "🖱" }); b.addEventListener("click", () => { cur.cursor = e; paint(); }); return b; }));
  // One-tap themes
  let themeGroup = 0;
  const themeTabs = h("div", { class: "look-theme-tabs" });
  const themeGrid = h("div", { class: "look-themes" });
  const paintThemes = () => {
    themeTabs.replaceChildren(...LOOK_THEME_GROUPS.map(([name], gi) => { const b = h("button", { type: "button", class: "look-theme-tab" + (gi === themeGroup ? " on" : ""), text: name }); b.addEventListener("click", () => { themeGroup = gi; paintThemes(); }); return b; }));
    themeGrid.replaceChildren(...LOOK_THEME_GROUPS[themeGroup][1].map(([label, t]) => {
      const b = h("button", { type: "button", class: "look-theme", text: label });
      b.addEventListener("click", () => { Object.assign(cur, { ...t, status: cur.status, song: cur.song, featured: cur.featured }); paint(); paintGradAfterTheme(); toast(`${label} look — tap Save to keep it.`); });
      return b;
    }));
  };
  paintThemes();
  const themes = h("div", { class: "look-themes-wrap" }, themeTabs, themeGrid);
  // Featured badges: up to 3 next to my name
  const featBox = h("div", { class: "look-chips look-feat" }, h("span", { class: "muted", text: "Loading your badges…" }));
  let myBadges = [];
  api(`/api/users/${encodeURIComponent(state.me.username)}/badges`).then((d) => {
    myBadges = [...(d.special || []).map((b) => ({ id: "s:" + b.id, label: `${b.emoji || "🏅"} ${b.name}` })), ...d.badges.filter((b) => b.earned).map((b) => ({ id: b.id, label: `${b.emoji === "tick" ? "✔️" : b.emoji} ${b.name}` }))];
    paintFeat();
  }).catch(() => featBox.replaceChildren(h("span", { class: "muted", text: "Couldn’t load your badges." })));
  function paintFeat() {
    const f = cur.featured || [];
    featBox.replaceChildren(...(myBadges.length ? myBadges.map((b) => {
      const on = f.includes(b.id);
      const btn = h("button", { type: "button", class: "look-chip" + (on ? " on" : ""), text: (on ? `${f.indexOf(b.id) + 1}. ` : "") + b.label });
      btn.addEventListener("click", () => { const list = (cur.featured || []).filter((x) => x !== b.id); if (!on) { if (list.length >= 3) return toast("Pick up to 3."); list.push(b.id); } cur.featured = list; paintFeat(); });
      return btn;
    }) : [h("span", { class: "muted", text: "Earn badges first — then show your favourites here." })]));
  }
  const paintGradAfterTheme = () => { try { paintGrad(); } catch {} };
  const save = h("button", { type: "button", class: "btn btn-primary btn-full", text: "Save my look" });
  const reset = h("button", { type: "button", class: "btn btn-outline-light btn-full", text: "Back to default" });
  const m = modal({ title: "Customize your profile", body: h("div", { class: "create-form look-editor" },
    previewWrap,
    h("p", { class: "look-label", text: "✨ One-tap themes" }), h("p", { class: "create-hint", text: "A whole look at once. Change anything after." }), themes,
    h("p", { class: "look-label", text: "Name colour" }), colors,
    h("p", { class: "look-label", text: "Your own gradient" }), h("p", { class: "create-hint", text: "Pick 2 to 4 colours and turn the direction. Tap the bar to use it." }), gradBox,
    h("p", { class: "look-label", text: "Name font" }), fonts,
    h("p", { class: "look-label", text: "🎮 Gamer fonts" }), gamerFonts,
    h("p", { class: "look-label", text: "Name effect" }), effects,
    h("p", { class: "look-label", text: "Name animation" }), anims,
    h("p", { class: "look-label", text: "✨ Line under your name" }), nameDecos,
    h("p", { class: "look-label", text: "Emoji next to your name" }), emojis,
    h("p", { class: "look-label", text: "🏅 Badges next to your name" }), h("p", { class: "create-hint", text: "Pick up to 3 of your badges to show off." }), featBox,
    h("p", { class: "look-label", text: "Profile accent colour" }), h("p", { class: "create-hint", text: "Buttons, tabs and highlights on your profile." }), accents,
    h("p", { class: "look-label", text: "Ring around your photo" }), rings,
    h("p", { class: "look-label", text: "Photo shape" }), shapes,
    h("p", { class: "look-label", text: "Photo movement" }), photoAnims,
    h("p", { class: "look-label", text: "Name size" }), nameSizes,
    h("p", { class: "look-label", text: "Pointer" }), h("p", { class: "create-hint", text: "An emoji instead of the mouse pointer when people are on your profile." }), cursors,
    h("p", { class: "look-label", text: "Profile frame" }), frames,
    h("p", { class: "look-label", text: "Pointer trail" }), h("p", { class: "create-hint", text: "Little things that follow the mouse (or finger) on your profile." }), trails,
    h("p", { class: "look-label", text: "Profile background" }), bgs,
    h("p", { class: "look-label", text: "Status" }), h("p", { class: "create-hint", text: "A few words under your name, with an emoji." }), statusRow,
    h("p", { class: "look-label", text: "Profile effect" }), h("p", { class: "create-hint", text: "Things that fall or float over your profile." }), fxs,
    h("p", { class: "look-label", text: "Photo decoration" }), decos,
    h("p", { class: "look-label", text: "Profile song" }), h("p", { class: "create-hint", text: "People can play it from your profile: a song on LookBlog, one from YouTube, or your own MP3." }), h("div", { class: "song-now" }, songLabel, songClear), songSearch, songResults,
    h("div", { class: "invite-row song-yt-row" }, ytLink, ytUse), h("div", { class: "song-mp3-row" }, mp3Btn, mp3),
    h("p", { class: "look-label", text: "Bio font" }), bioFonts,
    h("p", { class: "look-label", text: "Bio style" }), bioStyles,
    h("p", { class: "look-label", text: "✨ Banner movement" }), h("p", { class: "create-hint", text: "Your banner (picture or colours) slowly moves." }), bannerAnims,
    h("p", { class: "look-label", text: "✨ How your profile opens" }), h("p", { class: "create-hint", text: "What people see the moment they open your profile." }), intros,
    h("p", { class: "look-label", text: "✨ Followers & numbers style" }), statStyles,
    h("p", { class: "look-label", text: "Banner colours" }), h("p", { class: "create-hint", text: state.me.banner ? "Shown when you remove your banner picture." : "For your banner (you don’t have a banner picture)." }), banners,
    save, reset) });
  const store = async (look) => {
    save.disabled = reset.disabled = true;
    try {
      const r = await api("/api/me/look", { method: "POST", body: look });
      state.me.look = r.look;
      emit("me:updated", state.me);
      m.close();
      toast("Your look is saved. Your name looks like this everywhere.");
      onSaved?.(r.look, r.look?.song || r.look?.songYt || r.look?.songFile ? songObj : null);
    } catch (err) { toast(err.error || "Couldn’t save it."); save.disabled = reset.disabled = false; }
  };
  const KEYS = ["color", "font", "effect", "accent", "ring", "bg", "banner", "emoji", "fx", "deco", "bioFont", "status", "shape", "anim", "frame", "trail",
    "photoAnim", "bioStyle", "nameSize", "cursor", "bannerAnim", "nameDeco", "intro", "statStyle"];
  save.addEventListener("click", () => store({ ...Object.fromEntries(KEYS.map((k) => [k, cur[k] || null])), song: songObj && !songObj.kind ? songObj.id : null,
    songYt: songObj?.kind === "youtube" ? { id: songObj.yt, title: songObj.title, author: songObj.artist?.name === "YouTube" ? "" : songObj.artist?.name || "" } : null,
    songFile: songObj?.kind === "file" ? { url: songObj.url, title: songObj.title } : null, featured: cur.featured?.length ? cur.featured : null }));
  reset.addEventListener("click", () => store({}));
  paint();
  paintGrad();
}
