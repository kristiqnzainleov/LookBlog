// Party games at a table in a chat, next to the card games:
//   DOS          — UNO's sequel: match the cards in the middle by number (or two cards that add up to it).
//   Draw & Tell  — like Gartic Phone: write something, the next person draws it, the next one says what it is…
//   Story Chain  — everyone starts a story; the next person only sees the last line and carries on.
//   Draw This!   — each round one person says what to draw, everyone else draws it, they pick the best one.
// The drawing games end with an album of what happened (a replay you can watch, save and share).
const crypto = require("crypto");

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fail = (msg) => { const e = new Error(msg); e.gameRule = true; throw e; };
const log = (s, text) => { s.log.push(text); if (s.log.length > 12) s.log.shift(); };
const cleanText = (t, max) => String(t || "").replace(/\s+/g, " ").trim().slice(0, max);
// A drawing is a picture uploaded to LookBlog
// (or a bot's drawing: a doodle the server draws, see doodles.js)
const { doodleFor, isDoodle, guessFor, storyLine, PROMPTS, pick } = require("./doodles");
const isPicture = (v) => typeof v === "string" && (/^\/media\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(v) || isDoodle(v));

/* ======================= DOS ======================= */
const DOS_COLORS = ["R", "G", "B", "Y"];
// "R7" = red 7 · "R#" = wild number (any number, red) · "W2" = wild DOS (a 2 of any colour)
function dosDeck() {
  const d = [];
  for (const c of DOS_COLORS) {
    for (let v = 1; v <= 10; v++) d.push(c + v, c + v);
    d.push(c + "#", c + "#");
  }
  for (let i = 0; i < 10; i++) d.push("W2");
  return shuffle(d);
}
const dosColor = (c) => (c === "W2" ? "W" : c[0]);
const dosValue = (c) => (c === "W2" ? 2 : c.endsWith("#") ? null : Number(c.slice(1)));
// Does this card (or these two) match the card in the middle? (a wild # takes whatever number is needed)
function dosMatches(center, cards) {
  const target = dosValue(center);
  if (target == null) return false;
  if (cards.length === 1) { const v = dosValue(cards[0]); return v == null || v === target; }
  if (cards.length === 2) {
    const [a, b] = cards.map(dosValue);
    if (a == null && b == null) return target >= 2;
    if (a == null) return target - b >= 1;
    if (b == null) return target - a >= 1;
    return a + b === target;
  }
  return false;
}
const colorMatch = (center, cards) => cards.every((c) => dosColor(c) === "W" || dosColor(c) === dosColor(center));
const dos = {
  name: "DOS", emoji: "🟦", min: 2, max: 8, desc: "UNO’s sequel. Match the middle cards by number — or two cards that add up to it.",
  start(n) {
    const draw = dosDeck();
    const hands = Array.from({ length: n }, () => draw.splice(0, 7));
    const center = [];
    while (center.length < 2) { const c = draw.pop(); if (dosValue(c) != null && c !== "W2") center.push(c); else draw.unshift(c); }
    return { kind: "dos", n, hands, draw, discard: [], center, turn: 0, matched: [], bonus: 0, drew: false, winner: null, log: [] };
  },
  // (null when every card is in someone's hand)
  drawOne(s) { if (!s.draw.length) { s.draw = shuffle(s.discard); s.discard = []; } return s.draw.pop() || null; },
  give(s, seat) { const c = this.drawOne(s); if (c) s.hands[seat].push(c); return c; },
  endTurn(s, names) {
    // The middle gets back to two cards with a number on them (a wild # goes back in the pile)
    let tries = 0;
    while (s.center.length < 2 && tries++ < 200) {
      const c = this.drawOne(s);
      if (!c) break;
      if (dosValue(c) == null) { s.draw.unshift(c); continue; }
      s.center.push(c);
    }
    s.turn = (s.turn + 1) % s.n; s.matched = []; s.bonus = 0; s.drew = false;
    log(s, `${names[s.turn]}’s turn`);
  },
  checkWin(s, seat, names) {
    if (!s.hands[seat].length) { s.winner = seat; log(s, `${names[seat]} wins! 🏆`); return true; }
    if (s.hands[seat].length === 2) log(s, `${names[seat]}: DOS! ✌️`);
    return false;
  },
  act(s, seat, a, names) {
    if (s.winner !== null) fail("This game is over.");
    if (s.turn !== seat) fail("It’s not your turn.");
    const hand = s.hands[seat];
    if (a.type === "match") {
      const i = Number(a.target);
      const center = s.center[i];
      if (!center) fail("Pick a card in the middle.");
      const cards = Array.isArray(a.cards) ? a.cards.map(String).slice(0, 2) : [];
      if (!cards.length) fail("Pick one or two of your cards.");
      const left = [...hand];
      for (const c of cards) { const k = left.indexOf(c); if (k === -1) fail("You don’t have that card."); left.splice(k, 1); }
      if (!dosMatches(center, cards)) fail(cards.length === 1 ? "That card’s number doesn’t match." : "Those two don’t add up to it.");
      s.hands[seat] = left;
      s.center.splice(i, 1);
      s.discard.push(center, ...cards);
      s.matched.push(center);
      const colour = colorMatch(center, cards);
      if (cards.length === 2 && colour) {
        s.bonus++;
        for (let k = 0; k < s.n; k++) if (k !== seat) this.give(s, k);
        log(s, `${names[seat]}: Double colour match! Everyone else draws 1 and ${names[seat]} can add a card to the middle`);
      } else if (colour) { s.bonus++; log(s, `${names[seat]}: Colour match! They can add a card to the middle`); }
      else log(s, `${names[seat]} matched with ${cards.length === 2 ? "two cards" : "a card"}`);
      this.checkWin(s, seat, names);
      return;
    }
    if (a.type === "place") {
      if (!s.bonus) fail("You can add a card to the middle after a colour match.");
      const c = String(a.card || "");
      const k = hand.indexOf(c); if (k === -1) fail("You don’t have that card.");
      if (dosValue(c) == null) fail("Put a card with a number in the middle (not a wild #).");
      hand.splice(k, 1); s.center.push(c); s.bonus--;
      log(s, `${names[seat]} added a card to the middle`);
      this.checkWin(s, seat, names);
      return;
    }
    if (a.type === "draw") {
      if (s.matched.length) fail("You already matched — end your turn.");
      if (s.drew) fail("You already drew a card.");
      this.give(s, seat); s.drew = true;
      log(s, `${names[seat]} drew a card`);
      return;
    }
    if (a.type === "end") {
      if (!s.matched.length && !s.drew) { this.give(s, seat); log(s, `${names[seat]} couldn’t match and drew a card`); }
      this.endTurn(s, names);
      return;
    }
    fail("Match, draw or end your turn.");
  },
  view(s, me) {
    return { kind: "dos", hand: s.hands[me] || [], counts: s.hands.map((h) => h.length), center: s.center, turn: s.turn, bonus: me === s.turn ? s.bonus : 0,
      drew: s.drew, matchedCount: s.matched.length, drawCount: s.draw.length, winner: s.winner, log: s.log };
  },
  over: (s) => (s.winner !== null ? { winner: s.winner } : null),
  waiting: (s) => (s.winner === null ? [s.turn] : []),
  bot(s, seat) {
    const hand = s.hands[seat];
    const placeable = hand.find((c) => dosValue(c) != null);
    if (s.bonus && placeable) return { type: "place", card: placeable };
    for (let i = 0; i < s.center.length; i++) {
      const single = hand.find((c) => dosMatches(s.center[i], [c]));
      if (single) return { type: "match", target: i, cards: [single] };
      for (let a = 0; a < hand.length; a++) for (let b = a + 1; b < hand.length; b++) if (dosMatches(s.center[i], [hand[a], hand[b]])) return { type: "match", target: i, cards: [hand[a], hand[b]] };
    }
    return { type: "end" };
  },
};

/* ======================= Round games: everyone does something at once ======================= */
// A chain is what happened to one starting idea: [{ seat, type: "text" | "draw", value }]
function roundGame({ name, emoji, desc, min = 2, max = 10, taskOf, rounds }) {
  return {
    name, emoji, desc, min, max, party: true,
    start(n) { return { kind: "chain", game: name, n, round: 0, rounds: rounds(n), chains: Array.from({ length: n }, () => []), done: [], phase: "play", log: [] }; },
    // Round r: player p works on chain (p - r) mod n, so each one only sees what came right before
    chainOf: (s, seat) => ((seat - s.round) % s.n + s.n) % s.n,
    act(s, seat, a, names) {
      if (s.phase !== "play") fail("This game is over.");
      if (s.done.includes(seat)) fail("You already sent yours. Waiting for the others…");
      const type = taskOf(s.round);
      let value = null;
      if (a.skip) value = null;
      else if (type === "text") { value = cleanText(a.value, 140); if (!value) fail("Write something first."); }
      else { if (!isPicture(a.value)) fail("Draw something first."); value = a.value; }
      s.chains[this.chainOf(s, seat)].push({ seat, type, value, skipped: value == null });
      s.done.push(seat);
      if (s.done.length >= s.n) {
        s.round++; s.done = [];
        if (s.round >= s.rounds) { s.phase = "done"; log(s, "That’s it! Watch the replay 🎬"); }
        else log(s, `Round ${s.round + 1} of ${s.rounds}`);
      }
    },
    view(s, me) {
      const out = { kind: "chain", game: name, round: s.round, rounds: s.rounds, phase: s.phase, done: s.done, log: s.log };
      if (s.phase === "done") out.chains = s.chains;
      else if (me >= 0) {
        const chain = s.chains[this.chainOf(s, me)];
        out.task = { type: taskOf(s.round), prev: s.round === 0 ? null : chain[chain.length - 1] || null, sent: s.done.includes(me) };
      }
      return out;
    },
    over: (s) => (s.phase === "done" ? { winner: -1, done: true } : null),
    waiting: (s) => (s.phase === "play" ? Array.from({ length: s.n }, (_, i) => i).filter((i) => !s.done.includes(i)) : []),
    // A bot writes or draws like everyone else (its drawings are doodles of what it read)
    bot(s, seat) {
      const chain = s.chains[this.chainOf(s, seat)], prev = s.round === 0 ? null : chain[chain.length - 1] || null;
      if (taskOf(s.round) === "draw") return { value: doodleFor(prev?.skipped ? "" : prev?.value) };
      if (name === "Story Chain") return { value: storyLine(prev) };
      return { value: s.round === 0 ? pick(PROMPTS) : guessFor(prev) };
    },
  };
}
// Draw & Tell: write → draw it → say what the drawing is → draw that → …
const drawTell = roundGame({
  name: "Draw & Tell", emoji: "🎨", desc: "Like Gartic Phone: write something, the next one draws it, the next says what it is…", min: 2,
  taskOf: (r) => (r % 2 === 0 ? "text" : "draw"), rounds: (n) => Math.max(n, 3),
});
// Story Chain: everyone writes; the next person only sees the last line
const storyChain = roundGame({
  name: "Story Chain", emoji: "📖", desc: "Start a story. The next person only sees your last line and carries on.", min: 2,
  taskOf: () => "text", rounds: (n) => Math.max(n, 4),
});
// With 2 players a chain would only go back and forth, so each chain gets extra rounds (above)

/* ======================= Draw This! ======================= */
const drawThis = {
  name: "Draw This!", emoji: "🖍️", desc: "One person says what to draw, everyone else draws it, and they pick the best drawing.", min: 2, max: 10, party: true,
  start(n) { return { kind: "drawthis", n, round: 0, rounds: n, judge: 0, step: "prompt", prompt: "", drawings: {}, scores: Array(n).fill(0), history: [], phase: "play", log: [] }; },
  act(s, seat, a, names) {
    if (s.phase !== "play") fail("This game is over.");
    if (s.step === "prompt") {
      if (seat !== s.judge) fail(`Waiting for ${names[s.judge]} to say what to draw.`);
      s.prompt = a.skip ? "anything you like" : cleanText(a.value, 80);
      if (!s.prompt) fail("Say what everyone should draw.");
      s.step = "draw"; s.drawings = {};
      log(s, `${names[seat]}: draw “${s.prompt}”!`);
      return;
    }
    if (s.step === "draw") {
      if (seat === s.judge) fail("You’re picking this round — wait for the drawings.");
      if (s.drawings[seat] !== undefined) fail("You already sent your drawing.");
      if (!a.skip && !isPicture(a.value)) fail("Draw something first.");
      s.drawings[seat] = a.skip ? null : a.value;
      if (Object.keys(s.drawings).length >= s.n - 1) {
        s.step = Object.values(s.drawings).some(Boolean) ? "pick" : "next";
        if (s.step === "next") this.nextRound(s, names, null);
      }
      return;
    }
    if (s.step === "pick") {
      if (seat !== s.judge) fail(`${names[s.judge]} picks the best one.`);
      const w = a.skip ? Number(Object.keys(s.drawings).find((k) => s.drawings[k])) : Number(a.winner);
      if (!s.drawings[w]) fail("Pick one of the drawings.");
      s.scores[w]++;
      log(s, `${names[s.judge]} picked ${names[w]}’s drawing 🏅`);
      this.nextRound(s, names, w);
    }
  },
  nextRound(s, names, winner) {
    s.history.push({ judge: s.judge, prompt: s.prompt, drawings: s.drawings, winner });
    s.round++;
    if (s.round >= s.rounds) {
      s.phase = "done";
      const best = Math.max(...s.scores);
      s.winner = s.scores.indexOf(best);
      log(s, `${names[s.winner]} wins with ${best} 🏅! Watch the replay 🎬`);
      return;
    }
    s.judge = s.round % s.n; s.step = "prompt"; s.prompt = ""; s.drawings = {};
    log(s, `Round ${s.round + 1}: ${names[s.judge]} says what to draw`);
  },
  view(s, me) {
    const out = { kind: "drawthis", round: s.round, rounds: s.rounds, judge: s.judge, step: s.step, prompt: s.step === "prompt" ? "" : s.prompt, scores: s.scores, phase: s.phase, log: s.log,
      sent: Object.keys(s.drawings).map(Number), winner: s.winner ?? null };
    if (s.step === "pick" || s.phase === "done") out.drawings = s.drawings;
    if (s.phase === "done") out.history = s.history;
    return out;
  },
  over: (s) => (s.phase === "done" ? { winner: s.winner } : null),
  waiting(s) {
    if (s.phase !== "play") return [];
    if (s.step === "prompt" || s.step === "pick") return [s.judge];
    return Array.from({ length: s.n }, (_, i) => i).filter((i) => i !== s.judge && s.drawings[i] === undefined);
  },
  // A bot says what to draw, draws a doodle of it, or picks a favourite
  bot(s, seat) {
    if (s.step === "prompt") return { value: pick(PROMPTS) };
    if (s.step === "draw") return { value: doodleFor(s.prompt) };
    const options = Object.keys(s.drawings).filter((k) => s.drawings[k]);
    return { winner: Number(pick(options)) };
  },
};

module.exports = { dos, drawtell: drawTell, story: storyChain, drawthis: drawThis };
