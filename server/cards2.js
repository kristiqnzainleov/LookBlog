// More card games at a table in a chat (with bots): Crazy Eights, Go Fish, Black Peter (Old Maid),
// Higher or Lower, War, Baccarat and Hearts. Same shape as cards.js: start, act, view (each player sees
// only their own cards), over, waiting (who has to move) and bot (what a bot in that seat does).
const crypto = require("crypto");

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fail = (msg) => { const e = new Error(msg); e.gameRule = true; throw e; };
const SUITS = ["S", "H", "D", "C"];
const RANKS = "23456789TJQKA";
const deck52 = () => { const d = []; for (const s of SUITS) for (const r of RANKS) d.push(r + s); return shuffle(d); };
const log = (s, text) => { s.log.push(text); if (s.log.length > 12) s.log.shift(); };
const rv = (c) => RANKS.indexOf(c[0]) + 2;
const SUIT_NAME = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANK_NAME = { T: "10" };
const cn = (c) => (RANK_NAME[c[0]] || c[0]) + SUIT_NAME[c[1]];
const rankName = (r) => ({ T: "10s", J: "Jacks", Q: "Queens", K: "Kings", A: "Aces" })[r] || r + "s";
const pick = (a) => a[crypto.randomInt(a.length)];
const take = (arr, c) => { const i = arr.indexOf(c); if (i === -1) fail("You don’t have that card."); arr.splice(i, 1); };

/* ======================= Crazy Eights ======================= */
const crazy8 = {
  name: "Crazy Eights", emoji: "🎱", min: 2, max: 6, desc: "Match the suit or the rank. Eights are wild. First to empty their hand wins.",
  start(n) {
    const draw = deck52();
    const hands = Array.from({ length: n }, () => draw.splice(0, n === 2 ? 7 : 5));
    let top = draw.pop();
    while (top[0] === "8") { draw.unshift(top); top = draw.pop(); }
    return { kind: "crazy8", n, hands, draw, discard: [top], suit: top[1], turn: 0, drew: null, winner: null, log: [] };
  },
  playable(s, c) { const top = s.discard[s.discard.length - 1]; return c[0] === "8" || c[1] === s.suit || c[0] === top[0]; },
  drawOne(s) { if (!s.draw.length) { const top = s.discard.pop(); s.draw = shuffle(s.discard); s.discard = [top]; } return s.draw.pop() || null; },
  next(s) { s.turn = (s.turn + 1) % s.n; s.drew = null; },
  act(s, seat, a, names) {
    if (s.winner !== null) fail("This game is over.");
    if (s.turn !== seat) fail("It’s not your turn.");
    const hand = s.hands[seat];
    if (a.type === "draw") {
      if (s.drew) fail("You already drew a card.");
      const c = this.drawOne(s);
      if (!c) { log(s, `${names[seat]} passed (no cards left)`); return this.next(s); }
      hand.push(c);
      if (this.playable(s, c)) { s.drew = c; log(s, `${names[seat]} drew a card`); }
      else { log(s, `${names[seat]} drew a card and passed`); this.next(s); }
      return;
    }
    if (a.type === "pass") { if (!s.drew) fail("Draw a card first."); log(s, `${names[seat]} passed`); return this.next(s); }
    if (a.type !== "play") fail("Play or draw a card.");
    const c = String(a.card || "");
    if (!hand.includes(c)) fail("You don’t have that card.");
    if (s.drew && c !== s.drew) fail("You can only play the card you just drew (or pass).");
    if (!this.playable(s, c)) fail("That card doesn’t match.");
    if (c[0] === "8" && !SUITS.includes(a.suit)) fail("Pick a suit.");
    take(hand, c);
    s.discard.push(c);
    s.suit = c[0] === "8" ? a.suit : c[1];
    log(s, `${names[seat]} played ${cn(c)}${c[0] === "8" ? " → " + SUIT_NAME[s.suit] : ""}`);
    if (!hand.length) { s.winner = seat; log(s, `${names[seat]} wins! 🏆`); return; }
    if (hand.length === 1) log(s, `${names[seat]} has one card left!`);
    this.next(s);
  },
  view(s, me) {
    return { kind: "crazy8", hand: s.hands[me] || [], counts: s.hands.map((h) => h.length), top: s.discard[s.discard.length - 1], suit: s.suit, turn: s.turn,
      drew: me === s.turn ? s.drew : null, drawCount: s.draw.length, winner: s.winner, log: s.log,
      playable: me === s.turn && s.winner === null ? (s.hands[me] || []).filter((c) => (!s.drew || c === s.drew) && this.playable(s, c)) : [] };
  },
  over: (s) => (s.winner !== null ? { winner: s.winner } : null),
  waiting: (s) => (s.winner === null ? [s.turn] : []),
  bot(s, seat) {
    const v = this.view(s, seat);
    if (v.playable.length) {
      const counts = {}; for (const c of s.hands[seat]) if (c[0] !== "8") counts[c[1]] = (counts[c[1]] || 0) + 1;
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "S";
      const card = v.playable.find((c) => c[0] !== "8") || v.playable[0];
      return { type: "play", card, suit: best };
    }
    return s.drew ? { type: "pass" } : { type: "draw" };
  },
};

/* ======================= Go Fish ======================= */
const gofish = {
  name: "Go Fish", emoji: "🐟", min: 2, max: 6, desc: "Ask someone for a rank you hold. Collect all four to make a book. Most books wins.",
  start(n) {
    const draw = deck52();
    const s = { kind: "gofish", n, hands: Array.from({ length: n }, () => draw.splice(0, n <= 3 ? 7 : 5)), draw, books: Array.from({ length: n }, () => []), turn: 0, winner: null, done: false, log: [], asked: Array.from({ length: n }, () => []) };
    for (let i = 0; i < n; i++) this.books_(s, i, null);
    return s;
  },
  books_(s, seat, names) {
    const hand = s.hands[seat];
    for (const r of RANKS) {
      const four = hand.filter((c) => c[0] === r);
      if (four.length === 4) { s.hands[seat] = hand.filter((c) => c[0] !== r); s.books[seat].push(r); if (names) log(s, `${names[seat]} made a book of ${rankName(r)} 📚`); return this.books_(s, seat, names); }
    }
  },
  refill(s, seat) { if (!s.hands[seat].length && s.draw.length) s.hands[seat].push(s.draw.pop()); },
  finish(s, names) {
    const total = s.books.reduce((n, b) => n + b.length, 0);
    if (total < 13) return false;
    s.done = true;
    const most = Math.max(...s.books.map((b) => b.length));
    s.winner = s.books.findIndex((b) => b.length === most);
    log(s, `${names[s.winner]} wins with ${most} books! 🏆`);
    return true;
  },
  nextTurn(s, names) {
    for (let k = 1; k <= s.n; k++) {
      const t = (s.turn + k) % s.n;
      this.refill(s, t);
      if (s.hands[t].length) { s.turn = t; return; }
    }
    this.finish(s, names);
  },
  act(s, seat, a, names) {
    if (s.done) fail("This game is over.");
    if (s.turn !== seat) fail("It’s not your turn.");
    if (a.type !== "ask") fail("Ask someone for a rank.");
    const target = Number(a.target), rank = String(a.rank || "")[0];
    if (!Number.isInteger(target) || target === seat || target < 0 || target >= s.n) fail("Pick someone to ask.");
    if (!s.hands[target].length) fail("They have no cards.");
    if (!s.hands[seat].some((c) => c[0] === rank)) fail("You can only ask for a rank you have.");
    s.asked[seat] = [...new Set([rank, ...s.asked[seat]])].slice(0, 6);
    const got = s.hands[target].filter((c) => c[0] === rank);
    if (got.length) {
      s.hands[target] = s.hands[target].filter((c) => c[0] !== rank);
      s.asked[target] = s.asked[target].filter((r) => r !== rank);
      s.hands[seat].push(...got);
      log(s, `${names[seat]} got ${got.length} ${rankName(rank)} from ${names[target]}`);
      this.books_(s, seat, names);
      this.refill(s, target); this.refill(s, seat);
      if (this.finish(s, names)) return;
      if (!s.hands[seat].length) this.nextTurn(s, names);
      return; // they go again
    }
    s.asked[target] = s.asked[target].filter((r) => r !== rank);
    log(s, `${names[target]}: “Go fish!” 🐟`);
    const c = s.draw.pop();
    if (c) {
      s.hands[seat].push(c);
      this.books_(s, seat, names);
      if (this.finish(s, names)) return;
      if (c[0] === rank) { log(s, `${names[seat]} fished the ${rankName(rank).slice(0, -1)} they asked for — again!`); this.refill(s, seat); if (s.hands[seat].length) return; }
    }
    this.nextTurn(s, names);
  },
  view(s, me) {
    return { kind: "gofish", hand: [...(s.hands[me] || [])].sort((a, b) => rv(a) - rv(b)), counts: s.hands.map((h) => h.length), books: s.books, turn: s.done ? -1 : s.turn, drawCount: s.draw.length, winner: s.winner, done: s.done, log: s.log };
  },
  over: (s) => (s.done ? { winner: s.winner } : null),
  waiting: (s) => (s.done ? [] : [s.turn]),
  bot(s, seat) {
    const ranks = [...new Set(s.hands[seat].map((c) => c[0]))];
    const others = [...Array(s.n).keys()].filter((i) => i !== seat && s.hands[i].length);
    // Ask for what others asked for (they have it), otherwise the rank I hold most of (sometimes just a guess)
    if (crypto.randomInt(4)) for (const t of others) { const r = ranks.find((x) => s.asked[t].includes(x)); if (r) return { type: "ask", target: t, rank: r }; }
    if (!crypto.randomInt(3)) return { type: "ask", target: pick(others), rank: pick(ranks) };
    const counts = ranks.map((r) => [r, s.hands[seat].filter((c) => c[0] === r).length]).sort((a, b) => b[1] - a[1]);
    return { type: "ask", target: pick(others), rank: counts[0][0] };
  },
};

/* ======================= Black Peter (Old Maid) ======================= */
// One queen is taken out, so the queen of spades can't be paired: whoever is left holding it loses.
const peter = {
  name: "Black Peter", emoji: "🃏", min: 2, max: 6, desc: "Черен Петър: pair up your cards, take one from the next player. Don’t get stuck with the Q♠!",
  start(n) {
    const d = deck52().filter((c) => c !== "QC");
    const hands = Array.from({ length: n }, () => []);
    d.forEach((c, i) => hands[i % n].push(c));
    const s = { kind: "peter", n, hands, out: [], turn: 0, loser: null, log: [] };
    for (let i = 0; i < n; i++) this.pairs(s, i);
    this.settle(s);
    return s;
  },
  pairs(s, seat, names) {
    const hand = s.hands[seat], left = [];
    for (const c of hand) { const j = left.findIndex((x) => x[0] === c[0]); if (j !== -1) { const [p] = left.splice(j, 1); if (names) log(s, `${names[seat]} put down a pair of ${rankName(c[0])}`); void p; } else left.push(c); }
    s.hands[seat] = shuffle(left);
  },
  // Players with no cards are out; the turn goes to someone who still has cards, who takes from the next one
  settle(s, names) {
    for (let i = 0; i < s.n; i++) if (!s.hands[i].length && !s.out.includes(i)) { s.out.push(i); if (names) log(s, `${names[i]} is out — safe! 🎉`); }
    const left = [...Array(s.n).keys()].filter((i) => s.hands[i].length);
    if (left.length <= 1) { s.loser = left[0] ?? null; if (names && s.loser !== null) log(s, `${names[s.loser]} is left with Black Peter (Q♠)! 🃏`); return; }
    if (!s.hands[s.turn].length) s.turn = left.find((i) => i > s.turn) ?? left[0];
  },
  from(s) { for (let k = 1; k < s.n; k++) { const t = (s.turn + k) % s.n; if (s.hands[t].length) return t; } return -1; },
  act(s, seat, a, names) {
    if (s.loser !== null) fail("This game is over.");
    if (s.turn !== seat) fail("It’s not your turn.");
    const from = this.from(s);
    const i = Number(a.index);
    if (a.type !== "take" || !Number.isInteger(i) || i < 0 || i >= s.hands[from].length) fail("Pick one of their cards.");
    const [c] = s.hands[from].splice(i, 1);
    s.hands[seat].push(c);
    log(s, `${names[seat]} took a card from ${names[from]}`);
    this.pairs(s, seat, names);
    s.turn = from;
    this.settle(s, names);
  },
  view(s, me) {
    const from = this.from(s);
    return { kind: "peter", hand: [...(s.hands[me] || [])].sort((a, b) => rv(a) - rv(b)), counts: s.hands.map((h) => h.length), out: s.out, turn: s.loser !== null ? -1 : s.turn, from, loser: s.loser, log: s.log };
  },
  // The first one out wins (and the one with Black Peter loses)
  over: (s) => (s.loser !== null ? { winner: s.out[0] ?? 0, loser: s.loser } : null),
  waiting: (s) => (s.loser === null ? [s.turn] : []),
  bot(s, seat) { return { type: "take", index: crypto.randomInt(s.hands[this.from(s)].length) }; },
};

/* ======================= Higher or Lower ======================= */
const ROUNDS_HL = 8;
const hilo = {
  name: "Higher or Lower", emoji: "📈", min: 1, max: 8, desc: "Will the next card be higher or lower? Everyone guesses in turn — most right guesses wins.",
  start(n) { const draw = deck52(); return { kind: "hilo", n, draw, card: draw.pop(), prev: null, score: Array(n).fill(0), guesses: Array(n).fill(0), turn: 0, done: false, winner: null, last: null, log: [] }; },
  act(s, seat, a, names) {
    if (s.done) fail("This game is over.");
    if (s.turn !== seat) fail("It’s not your turn.");
    if (!["higher", "lower"].includes(a.type)) fail("Higher or lower?");
    if (!s.draw.length) s.draw = deck52();
    const next = s.draw.pop(), was = s.card;
    const right = a.type === "higher" ? rv(next) > rv(was) : rv(next) < rv(was);
    const same = rv(next) === rv(was);
    if (right) s.score[seat]++;
    s.guesses[seat]++;
    s.prev = was; s.card = next;
    s.last = { seat, guess: a.type, right, same };
    log(s, `${names[seat]} said ${a.type}: ${cn(next)} — ${same ? "same rank, no point" : right ? "right! ✅" : "wrong ❌"}`);
    if (s.guesses.every((g) => g >= ROUNDS_HL)) {
      s.done = true;
      const best = Math.max(...s.score);
      s.winner = s.score.indexOf(best);
      log(s, `${names[s.winner]} wins with ${best} right! 🏆`);
      return;
    }
    s.turn = (s.turn + 1) % s.n;
  },
  view(s) { return { kind: "hilo", card: s.card, prev: s.prev, score: s.score, guesses: s.guesses, rounds: ROUNDS_HL, turn: s.done ? -1 : s.turn, last: s.last, winner: s.winner, log: s.log }; },
  over: (s) => (s.done ? { winner: s.winner } : null),
  waiting: (s) => (s.done ? [] : [s.turn]),
  bot(s) { return { type: rv(s.card) <= 8 ? "higher" : "lower" }; },
};

/* ======================= War ======================= */
const WAR_FLIPS = 60;
const war = {
  name: "War", emoji: "⚔️", min: 2, max: 2, desc: "Война: flip, the higher card takes both. Same rank? It’s war! Most cards after 60 flips wins.",
  start() { const d = deck52(); return { kind: "war", n: 2, piles: [d.slice(0, 26), d.slice(26)], table: [], shown: [null, null], flips: 0, turn: 0, winner: null, log: [] }; },
  act(s, seat, a, names) {
    if (s.winner !== null) fail("This game is over.");
    if (s.turn !== seat) fail("It’s not your turn to flip.");
    if (a.type !== "flip") fail("Flip!");
    const flip = () => [s.piles[0].shift(), s.piles[1].shift()];
    let [x, y] = flip();
    s.table = [x, y];
    let wars = 0;
    while (x && y && rv(x) === rv(y)) {
      wars++;
      const down = [...s.piles[0].splice(0, 3), ...s.piles[1].splice(0, 3)];
      s.table.push(...down);
      [x, y] = flip();
      if (x) s.table.push(x); if (y) s.table.push(y);
    }
    s.shown = [x || null, y || null];
    const win = !x ? 1 : !y ? 0 : rv(x) > rv(y) ? 0 : 1;
    s.piles[win].push(...shuffle(s.table.filter(Boolean)));
    log(s, `${wars ? `⚔️ War${wars > 1 ? " ×" + wars : ""}! ` : ""}${names[win]} takes ${s.table.filter(Boolean).length} cards (${x ? cn(x) : "—"} vs ${y ? cn(y) : "—"})`);
    s.table = [];
    s.flips++;
    if (!s.piles[0].length || !s.piles[1].length || s.flips >= WAR_FLIPS) {
      s.winner = s.piles[0].length >= s.piles[1].length ? 0 : 1;
      log(s, `${names[s.winner]} wins with ${s.piles[s.winner].length} cards! 🏆`);
      return;
    }
    s.turn = 1 - s.turn;
  },
  view(s) { return { kind: "war", counts: s.piles.map((p) => p.length), shown: s.shown, flips: s.flips, maxFlips: WAR_FLIPS, turn: s.winner !== null ? -1 : s.turn, winner: s.winner, log: s.log }; },
  over: (s) => (s.winner !== null ? { winner: s.winner } : null),
  waiting: (s) => (s.winner === null ? [s.turn] : []),
  bot() { return { type: "flip" }; },
};

/* ======================= Baccarat ======================= */
const BAC_ROUNDS = 8;
const bacVal = (c) => ("TJQK".includes(c[0]) ? 0 : c[0] === "A" ? 1 : Number(c[0]));
const bacTotal = (cards) => cards.reduce((n, c) => n + bacVal(c), 0) % 10;
const baccarat = {
  name: "Baccarat", emoji: "🎰", min: 1, max: 8, desc: "Bet on Player, Banker or Tie. Closest to 9 wins. Everyone starts with 1,000 chips.",
  start(n) { return { kind: "baccarat", n, chips: Array(n).fill(1000), bets: Array(n).fill(null), round: 1, phase: "bet", player: [], banker: [], result: null, payouts: Array(n).fill(0), log: [] }; },
  deal(s) {
    const d = deck52();
    const p = [d.pop(), d.pop()], b = [d.pop(), d.pop()];
    let pt = bacTotal(p), bt = bacTotal(b);
    if (pt < 8 && bt < 8) {
      let third = null;
      if (pt <= 5) { third = d.pop(); p.push(third); pt = bacTotal(p); }
      const tv = third ? bacVal(third) : null;
      const bankerDraws = third === null ? bt <= 5 : bt <= 2 || (bt === 3 && tv !== 8) || (bt === 4 && tv >= 2 && tv <= 7) || (bt === 5 && tv >= 4 && tv <= 7) || (bt === 6 && (tv === 6 || tv === 7));
      if (bankerDraws) { b.push(d.pop()); bt = bacTotal(b); }
    }
    s.player = p; s.banker = b;
    s.result = pt > bt ? "player" : bt > pt ? "banker" : "tie";
  },
  act(s, seat, a, names) {
    if (s.phase === "over") fail("This game is over.");
    if (a.type === "bet") {
      if (s.phase !== "bet") fail("Wait for the next round.");
      if (s.bets[seat]) fail("You already bet.");
      const on = ["player", "banker", "tie"].includes(a.on) ? a.on : null, amount = Math.floor(Number(a.amount));
      if (!on) fail("Bet on Player, Banker or Tie.");
      if (!(amount >= 10) || amount > s.chips[seat]) fail("Bet between 10 and your chips.");
      s.bets[seat] = { on, amount };
      log(s, `${names[seat]} bets ${amount} on ${on}`);
      if (s.bets.every((b, i) => b || s.chips[i] < 10)) {
        this.deal(s);
        s.payouts = s.bets.map((b, i) => {
          if (!b) return 0;
          const win = b.on === s.result;
          const pay = !win ? (s.result === "tie" && b.on !== "tie" ? 0 : -b.amount) : b.on === "tie" ? b.amount * 8 : b.on === "banker" ? Math.floor(b.amount * 0.95) : b.amount;
          s.chips[i] += pay;
          return pay;
        });
        log(s, `${s.result === "tie" ? "Tie!" : s.result === "player" ? "Player wins" : "Banker wins"} (${bacTotal(s.player)} – ${bacTotal(s.banker)})`);
        s.phase = s.round >= BAC_ROUNDS || s.chips.every((c) => c < 10) ? "over" : "done";
      }
      return;
    }
    if (a.type === "next") {
      if (s.phase !== "done") fail("Finish this round first.");
      s.round++; s.phase = "bet"; s.bets = Array(s.n).fill(null); s.player = []; s.banker = []; s.result = null; s.payouts = Array(s.n).fill(0);
      return;
    }
    fail("Place a bet.");
  },
  view(s) { return { kind: "baccarat", chips: s.chips, bets: s.bets, round: s.round, rounds: BAC_ROUNDS, phase: s.phase, player: s.player, banker: s.banker, pt: s.player.length ? bacTotal(s.player) : null, bt: s.banker.length ? bacTotal(s.banker) : null, result: s.result, payouts: s.payouts, turn: -1, log: s.log }; },
  over: (s) => (s.phase === "over" ? { winner: s.chips.indexOf(Math.max(...s.chips)) } : null),
  // (after a round, people press Next round when they've seen it)
  waiting(s) { return s.phase === "bet" ? s.bets.map((b, i) => (b || s.chips[i] < 10 ? -1 : i)).filter((i) => i >= 0) : []; },
  bot(s, seat) {
    if (s.phase === "done") return { type: "next" };
    return { type: "bet", on: crypto.randomInt(10) < 5 ? "banker" : "player", amount: Math.max(10, Math.min(s.chips[seat], 50 + crypto.randomInt(5) * 25)) };
  },
};

/* ======================= Hearts ======================= */
const H_TARGET = 50;
const hPoints = (c) => (c[1] === "H" ? 1 : c === "QS" ? 13 : 0);
const hearts = {
  name: "Hearts", emoji: "♥️", min: 4, max: 4, desc: "Avoid hearts (1 point each) and the Q♠ (13). Take them all to shoot the moon! Lowest at 50 wins.",
  start() { const s = { kind: "hearts", n: 4, scores: [0, 0, 0, 0], log: [], winner: null, hand: 0 }; this.deal(s); return s; },
  deal(s) {
    const d = deck52();
    s.hands = [0, 1, 2, 3].map((i) => d.slice(i * 13, i * 13 + 13).sort((a, b) => SUITS.indexOf(a[1]) - SUITS.indexOf(b[1]) || rv(a) - rv(b)));
    s.taken = [0, 0, 0, 0]; s.trick = []; s.broken = false; s.lastTrick = null; s.hand++;
    s.turn = s.hands.findIndex((h) => h.includes("2C"));
    s.first = true;
  },
  legal(s, seat) {
    const hand = s.hands[seat];
    if (s.first && !s.trick.length) return hand.includes("2C") ? ["2C"] : hand;
    if (!s.trick.length) { const non = hand.filter((c) => c[1] !== "H"); return s.broken || !non.length ? hand : non; }
    const led = s.trick[0].card[1];
    const follow = hand.filter((c) => c[1] === led);
    if (follow.length) return follow;
    if (s.first) { const safe = hand.filter((c) => !hPoints(c)); if (safe.length) return safe; }
    return hand;
  },
  act(s, seat, a, names) {
    if (s.winner !== null) fail("This game is over.");
    if (s.turn !== seat) fail("It’s not your turn.");
    const c = String(a.card || "");
    if (a.type !== "play" || !this.legal(s, seat).includes(c)) fail("You can’t play that card now.");
    take(s.hands[seat], c);
    if (c[1] === "H") s.broken = true;
    s.trick.push({ seat, card: c });
    if (s.trick.length < 4) { s.turn = (seat + 1) % 4; return; }
    const led = s.trick[0].card[1];
    const win = s.trick.filter((t) => t.card[1] === led).sort((x, y) => rv(y.card) - rv(x.card))[0].seat;
    const pts = s.trick.reduce((n, t) => n + hPoints(t.card), 0);
    s.taken[win] += pts;
    s.lastTrick = s.trick; s.trick = []; s.first = false;
    if (pts) log(s, `${names[win]} took ${pts} point${pts === 1 ? "" : "s"}${s.lastTrick.some((t) => t.card === "QS") ? " (with Q♠ 😬)" : ""}`);
    s.turn = win;
    if (s.hands.every((h) => !h.length)) {
      const moon = s.taken.indexOf(26);
      if (moon !== -1) { for (let i = 0; i < 4; i++) if (i !== moon) s.scores[i] += 26; log(s, `${names[moon]} shot the moon! 🌙`); }
      else for (let i = 0; i < 4; i++) s.scores[i] += s.taken[i];
      log(s, `After hand ${s.hand}: ${s.scores.map((x, i) => `${names[i]} ${x}`).join(" · ")}`);
      if (Math.max(...s.scores) >= H_TARGET) { const low = Math.min(...s.scores); s.winner = s.scores.indexOf(low); log(s, `${names[s.winner]} wins with ${low}! 🏆`); return; }
      this.deal(s);
    }
  },
  view(s, me) {
    return { kind: "hearts", hand: s.hands[me] || [], counts: s.hands.map((h) => h.length), trick: s.trick, lastTrick: s.lastTrick, scores: s.scores, taken: s.taken, turn: s.winner !== null ? -1 : s.turn, broken: s.broken, handNo: s.hand, target: H_TARGET, winner: s.winner, log: s.log,
      legal: me === s.turn && s.winner === null ? this.legal(s, me) : [] };
  },
  over: (s) => (s.winner !== null ? { winner: s.winner } : null),
  waiting: (s) => (s.winner === null ? [s.turn] : []),
  bot(s, seat) {
    const legal = this.legal(s, seat);
    const low = (list) => [...list].sort((a, b) => rv(a) - rv(b))[0], high = (list) => [...list].sort((a, b) => rv(b) - rv(a))[0];
    if (!s.trick.length) return { type: "play", card: low(legal.filter((c) => c !== "QS")) || low(legal) };
    const led = s.trick[0].card[1];
    if (legal[0][1] === led) {
      const best = s.trick.filter((t) => t.card[1] === led).sort((x, y) => rv(y.card) - rv(x.card))[0].card;
      const under = legal.filter((c) => rv(c) < rv(best));
      return { type: "play", card: under.length ? high(under) : s.trick.length === 3 && !s.trick.some((t) => hPoints(t.card)) ? high(legal) : low(legal) };
    }
    // Can't follow: get rid of the queen of spades, then hearts, then high cards
    return { type: "play", card: legal.includes("QS") ? "QS" : high(legal.filter((c) => c[1] === "H")) || high(legal) };
  },
};

module.exports = { crazy8, gofish, peter, hilo, war, baccarat, hearts };
