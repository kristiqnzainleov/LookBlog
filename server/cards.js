// Card games in chats: Poker (Texas Hold'em), Blackjack, Santase (66), UNO and Belot.
// The server keeps the deck and everyone's hand; each player only gets a view with their own cards.
// Cards are strings: rank + suit, e.g. "AS", "TH" (T = ten), "9C". UNO cards: colour + value, e.g. "R7", "GS", "W4".
const crypto = require("crypto");

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fail = (msg) => { const e = new Error(msg); e.gameRule = true; throw e; };
const SUITS = ["S", "H", "D", "C"];
const SUIT_NAME = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANK_NAME = { T: "10", J: "J", Q: "Q", K: "K", A: "A" };
const cardName = (c) => (RANK_NAME[c[0]] || c[0]) + SUIT_NAME[c[1]];
const deckOf = (ranks, copies = 1) => { const d = []; for (let k = 0; k < copies; k++) for (const s of SUITS) for (const r of ranks) d.push(r + s); return shuffle(d); };
const log = (s, text) => { s.log.push(text); if (s.log.length > 12) s.log.shift(); };
const take = (arr, c) => { const i = arr.indexOf(c); if (i === -1) fail("You don’t have that card."); arr.splice(i, 1); };

/* ======================= Blackjack ======================= */
function bjValue(cards) {
  let v = 0, aces = 0;
  for (const c of cards) { const r = c[0]; if (r === "A") { v += 11; aces++; } else v += "TJQK".includes(r) ? 10 : Number(r); }
  while (v > 21 && aces) { v -= 10; aces--; }
  return v;
}
const bjNatural = (cards) => cards.length === 2 && bjValue(cards) === 21;
const blackjack = {
  name: "Blackjack", emoji: "🃏", min: 1, max: 7, desc: "Beat the dealer to 21. Everyone starts with 1,000 chips.",
  start(n) { return { kind: "blackjack", n, chips: Array(n).fill(1000), bets: Array(n).fill(0), hands: Array.from({ length: n }, () => []), done: Array(n).fill(false), dealer: [], shoe: deckOf("23456789TJQKA", 4), phase: "bet", turn: -1, results: [], log: [] }; },
  draw(s) { if (s.shoe.length < 20) s.shoe = deckOf("23456789TJQKA", 4); return s.shoe.pop(); },
  act(s, seat, a, names) {
    if (a.type === "next") {
      if (s.phase !== "done") fail("Finish this round first.");
      s.bets.fill(0); s.hands = s.hands.map(() => []); s.done.fill(false); s.dealer = []; s.results = []; s.phase = "bet"; s.turn = -1;
      s.chips = s.chips.map((c, i) => { if (c <= 0) { log(s, `${names[i]} got 500 more chips`); return 500; } return c; });
      return;
    }
    if (s.phase === "bet") {
      if (a.type !== "bet") fail("Place your bet first.");
      const amt = Math.floor(Number(a.amount));
      if (!(amt >= 10 && amt <= s.chips[seat])) fail(`Bet between 10 and ${s.chips[seat]}.`);
      s.bets[seat] = amt;
      log(s, `${names[seat]} bet ${amt}`);
      if (s.bets.every((b) => b > 0)) this.deal(s, names);
      return;
    }
    if (s.phase !== "play") fail("Wait for the next round.");
    if (s.turn !== seat) fail("It’s not your turn.");
    const hand = s.hands[seat];
    if (a.type === "hit") {
      hand.push(this.draw(s));
      const v = bjValue(hand);
      if (v > 21) { log(s, `${names[seat]} busts with ${v} 💥`); s.done[seat] = true; }
      else if (v === 21) s.done[seat] = true;
    } else if (a.type === "stand") { s.done[seat] = true; log(s, `${names[seat]} stands on ${bjValue(hand)}`); }
    else if (a.type === "double") {
      if (hand.length !== 2) fail("You can only double on your first two cards.");
      if (s.chips[seat] < s.bets[seat] * 2) fail("Not enough chips to double.");
      s.bets[seat] *= 2; hand.push(this.draw(s)); s.done[seat] = true;
      log(s, `${names[seat]} doubles and gets ${cardName(hand[2])} (${bjValue(hand)})`);
    } else fail("Hit, stand or double.");
    this.advance(s, names);
  },
  deal(s, names) {
    for (let k = 0; k < 2; k++) { for (const h of s.hands) h.push(this.draw(s)); s.dealer.push(this.draw(s)); }
    s.hands.forEach((h, i) => { if (bjNatural(h)) { s.done[i] = true; log(s, `${names[i]} has Blackjack! 🎉`); } });
    s.phase = "play"; s.turn = -1;
    this.advance(s, names);
  },
  advance(s, names) {
    const next = s.done.findIndex((d) => !d);
    if (next !== -1) { s.turn = next; return; }
    // Dealer's turn: draw to 17
    const anyAlive = s.hands.some((h) => bjValue(h) <= 21 && !bjNatural(h));
    if (anyAlive) while (bjValue(s.dealer) < 17) s.dealer.push(this.draw(s));
    const dv = bjValue(s.dealer), dNat = bjNatural(s.dealer);
    s.results = s.hands.map((h, i) => {
      const v = bjValue(h), bet = s.bets[i];
      let win;
      if (v > 21) win = -bet;
      else if (bjNatural(h) && !dNat) win = Math.floor(bet * 1.5);
      else if (dNat && !bjNatural(h)) win = -bet;
      else if (dv > 21 || v > dv) win = bet;
      else if (v === dv) win = 0;
      else win = -bet;
      s.chips[i] += win;
      return win;
    });
    log(s, `Dealer has ${dv > 21 ? dv + " — bust!" : dv}`);
    s.phase = "done"; s.turn = -1;
  },
  view(s, me) {
    const hide = s.phase === "play";
    return { kind: "blackjack", phase: s.phase, chips: s.chips, bets: s.bets, turn: s.turn, results: s.results, log: s.log,
      hands: s.hands.map((h) => ({ cards: h, value: bjValue(h) })),
      dealer: hide ? { cards: [s.dealer[0], "??"], value: null } : { cards: s.dealer, value: s.dealer.length ? bjValue(s.dealer) : null },
      canDouble: s.phase === "play" && s.turn === me && s.hands[me]?.length === 2 && s.chips[me] >= s.bets[me] * 2 };
  },
  over: () => null,
};

/* ======================= UNO ======================= */
const UNO_COLORS = ["R", "G", "B", "Y"];
function unoDeck() {
  const d = [];
  for (const c of UNO_COLORS) { d.push(c + "0"); for (const v of "123456789SRD") d.push(c + v, c + v); }
  for (let i = 0; i < 4; i++) d.push("W", "W4");
  return shuffle(d);
}
const unoPoints = (c) => (c[0] === "W" ? 50 : "SRD".includes(c[1]) ? 20 : Number(c[1]));
const uno = {
  name: "UNO", emoji: "🟥", min: 2, max: 8, desc: "Match the colour or number. First to empty their hand wins.",
  start(n) {
    const draw = unoDeck();
    const hands = Array.from({ length: n }, () => draw.splice(0, 7));
    let top = draw.pop();
    while (!/^[RGBY][0-9]$/.test(top)) { draw.unshift(top); top = draw.pop(); }
    return { kind: "uno", n, hands, draw, discard: [top], color: top[0], turn: 0, dir: 1, drew: null, winner: null, points: 0, log: [] };
  },
  playable(s, c) { if (c[0] === "W") return true; const top = s.discard[s.discard.length - 1]; return c[0] === s.color || (top[0] !== "W" && c[1] === top[1]); },
  drawOne(s) {
    if (!s.draw.length) { const top = s.discard.pop(); s.draw = shuffle(s.discard); s.discard = [top]; }
    return s.draw.pop();
  },
  next(s, steps = 1) { s.turn = ((s.turn + s.dir * steps) % s.n + s.n) % s.n; s.drew = null; },
  act(s, seat, a, names) {
    if (s.winner !== null) fail("This game is over.");
    if (s.turn !== seat) fail("It’s not your turn.");
    const hand = s.hands[seat];
    if (a.type === "draw") {
      if (s.drew) fail("You already drew a card.");
      const c = this.drawOne(s);
      hand.push(c);
      if (this.playable(s, c)) { s.drew = c; log(s, `${names[seat]} drew a card`); }
      else { log(s, `${names[seat]} drew a card and passed`); this.next(s); }
      return;
    }
    if (a.type === "pass") { if (!s.drew) fail("Draw a card first."); log(s, `${names[seat]} passed`); this.next(s); return; }
    if (a.type !== "play") fail("Play or draw a card.");
    const c = String(a.card || "");
    if (!hand.includes(c)) fail("You don’t have that card.");
    if (s.drew && c !== s.drew) fail("You can only play the card you just drew (or pass).");
    if (!this.playable(s, c)) fail("That card doesn’t match.");
    if (c[0] === "W" && !UNO_COLORS.includes(a.color)) fail("Pick a colour.");
    take(hand, c);
    s.discard.push(c);
    s.color = c[0] === "W" ? a.color : c[0];
    const NAMES = { S: "Skip", R: "Reverse", D: "+2" };
    log(s, `${names[seat]} played ${c === "W" ? "Wild" : c === "W4" ? "Wild +4" : NAMES[c[1]] || c[1]}${c[0] === "W" ? " → " + { R: "red", G: "green", B: "blue", Y: "yellow" }[s.color] : ""}`);
    if (!hand.length) {
      s.winner = seat;
      s.points = s.hands.reduce((n, h) => n + h.reduce((m, x) => m + unoPoints(x), 0), 0);
      log(s, `${names[seat]} wins! 🏆`);
      return;
    }
    if (hand.length === 1) log(s, `${names[seat]}: UNO! 🔥`);
    const v = c === "W4" ? "4" : c[0] === "W" ? "W" : c[1];
    if (v === "S") this.next(s, 2);
    else if (v === "R") { s.dir *= -1; this.next(s, s.n === 2 ? 2 : 1); }
    else if (v === "D" || v === "4") {
      this.next(s);
      const k = v === "D" ? 2 : 4;
      for (let i = 0; i < k; i++) s.hands[s.turn].push(this.drawOne(s));
      log(s, `${names[s.turn]} draws ${k} and is skipped`);
      this.next(s);
    } else this.next(s);
  },
  view(s, me) {
    return { kind: "uno", hand: s.hands[me] || [], counts: s.hands.map((h) => h.length), top: s.discard[s.discard.length - 1], color: s.color, turn: s.turn, dir: s.dir,
      drew: me === s.turn ? s.drew : null, drawCount: s.draw.length, winner: s.winner, points: s.points, log: s.log,
      playable: me === s.turn && s.winner === null ? (s.hands[me] || []).filter((c) => (!s.drew || c === s.drew) && this.playable(s, c)) : [] };
  },
  over: (s) => (s.winner !== null ? { winner: s.winner } : null),
};

/* ======================= Poker (Texas Hold'em) ======================= */
const RV = (r) => "23456789TJQKA".indexOf(r) + 2;
function score5(cards) {
  const vals = cards.map((c) => RV(c[0])).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals.join() === "14,5,4,3,2") straightHigh = 5;
  }
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts).map(([v, n]) => [n, Number(v)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kick = groups.map((g) => g[1]);
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, ...kick];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...kick];
  if (flush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, ...kick];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...kick];
  if (groups[0][0] === 2) return [1, ...kick];
  return [0, ...vals];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
// Best 5-card hand out of 5, 6 or 7 cards
function best7(cards) {
  let best = null;
  const pick = (start, chosen) => {
    if (chosen.length === 5) { const sc = score5(chosen); if (!best || cmp(sc, best) > 0) best = sc; return; }
    for (let i = start; i <= cards.length - (5 - chosen.length); i++) pick(i + 1, [...chosen, cards[i]]);
  };
  pick(0, []);
  return best;
}
const HAND_NAMES = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];
const poker = {
  name: "Poker", emoji: "♠️", min: 2, max: 8, desc: "Texas Hold’em. 1,000 chips each, blinds 10/20. Last one with chips wins.",
  start(n) { const s = { kind: "poker", n, chips: Array(n).fill(1000), dealer: n - 1, sb: 10, bb: 20, handNo: 0, log: [], winner: null }; this.newHand(s); return s; },
  alive: (s) => s.chips.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0),
  nextFrom(s, i, ok) { for (let k = 1; k <= s.n; k++) { const j = (i + k) % s.n; if (ok(j)) return j; } return -1; },
  newHand(s) {
    const alive = this.alive(s);
    if (alive.length < 2) { s.winner = alive[0] ?? 0; s.phase = "over"; return; }
    s.handNo++;
    if (s.handNo % 8 === 0) { s.sb *= 2; s.bb *= 2; log(s, `Blinds go up: ${s.sb}/${s.bb}`); }
    s.inHand = s.chips.map((c) => c > 0);
    s.folded = Array(s.n).fill(false); s.allin = Array(s.n).fill(false); s.acted = Array(s.n).fill(false);
    s.bets = Array(s.n).fill(0); s.committed = Array(s.n).fill(0);
    s.deck = deckOf("23456789TJQKA"); s.board = []; s.shown = null; s.results = null;
    s.hole = s.chips.map((c) => (c > 0 ? [s.deck.pop(), s.deck.pop()] : []));
    s.dealer = this.nextFrom(s, s.dealer, (j) => s.inHand[j]);
    const heads = alive.length === 2;
    const sbSeat = heads ? s.dealer : this.nextFrom(s, s.dealer, (j) => s.inHand[j]);
    const bbSeat = this.nextFrom(s, sbSeat, (j) => s.inHand[j]);
    this.put(s, sbSeat, Math.min(s.sb, s.chips[sbSeat]));
    this.put(s, bbSeat, Math.min(s.bb, s.chips[bbSeat]));
    s.curBet = s.bb; s.minRaise = s.bb; s.phase = "preflop";
    s.turn = this.nextFrom(s, bbSeat, (j) => this.canAct(s, j));
    if (s.turn === -1 || this.roundDone(s)) this.endRound(s);
  },
  put(s, i, amt) { s.chips[i] -= amt; s.bets[i] += amt; s.committed[i] += amt; if (s.chips[i] === 0) s.allin[i] = true; },
  canAct: (s, j) => s.inHand[j] && !s.folded[j] && !s.allin[j],
  live: (s) => s.inHand.map((x, j) => x && !s.folded[j]),
  roundDone(s) {
    const actors = [...Array(s.n).keys()].filter((j) => this.canAct(s, j));
    if (actors.every((j) => s.acted[j] && s.bets[j] === s.curBet)) return true;
    // Only one player can still act and they've matched the bet
    if (actors.length === 1 && s.bets[actors[0]] >= s.curBet && this.live(s).filter(Boolean).length > 1 && s.acted[actors[0]]) return true;
    if (actors.length === 0) return true;
    return false;
  },
  act(s, seat, a, names) {
    if (s.phase === "over") fail("This game is over.");
    if (a.type === "next") { if (s.phase !== "done") fail("Finish this hand first."); this.newHand(s); return; }
    if (s.phase === "done") fail("Start the next hand.");
    if (s.turn !== seat) fail("It’s not your turn.");
    const toCall = s.curBet - s.bets[seat];
    if (a.type === "fold") { s.folded[seat] = true; log(s, `${names[seat]} folds`); }
    else if (a.type === "check") { if (toCall > 0) fail("You need to call or fold."); log(s, `${names[seat]} checks`); }
    else if (a.type === "call") {
      if (toCall <= 0) fail("Nothing to call — check instead.");
      const amt = Math.min(toCall, s.chips[seat]); this.put(s, seat, amt);
      log(s, `${names[seat]} calls ${amt}${s.allin[seat] ? " (all in)" : ""}`);
    } else if (a.type === "raise" || a.type === "allin") {
      const to = a.type === "allin" ? s.bets[seat] + s.chips[seat] : Math.floor(Number(a.to));
      if (!(to > s.curBet)) fail("Raise above the current bet.");
      if (to - s.bets[seat] > s.chips[seat]) fail("You don’t have that many chips.");
      const allIn = to - s.bets[seat] === s.chips[seat];
      if (to - s.curBet < s.minRaise && !allIn) fail(`Raise to at least ${s.curBet + s.minRaise}.`);
      this.put(s, seat, to - s.bets[seat]);
      if (to - s.curBet >= s.minRaise) { s.minRaise = to - s.curBet; s.acted = s.acted.map((x, j) => (j === seat ? x : false)); }
      s.curBet = to;
      log(s, `${names[seat]} ${allIn ? "goes all in" : "raises"} to ${to}`);
    } else fail("Fold, check, call or raise.");
    s.acted[seat] = true;
    if (this.live(s).filter(Boolean).length === 1) return this.finish(s, names);
    if (this.roundDone(s)) return this.endRound(s, names);
    s.turn = this.nextFrom(s, seat, (j) => this.canAct(s, j) && (!s.acted[j] || s.bets[j] < s.curBet));
    if (s.turn === -1) this.endRound(s, names);
  },
  endRound(s, names) {
    const actors = [...Array(s.n).keys()].filter((j) => this.canAct(s, j));
    const runOut = actors.length <= 1;
    const deal = () => {
      if (s.phase === "preflop") { s.board.push(s.deck.pop(), s.deck.pop(), s.deck.pop()); s.phase = "flop"; }
      else if (s.phase === "flop") { s.board.push(s.deck.pop()); s.phase = "turn"; }
      else if (s.phase === "turn") { s.board.push(s.deck.pop()); s.phase = "river"; }
      else return false;
      return true;
    };
    s.bets.fill(0); s.curBet = 0; s.minRaise = s.bb; s.acted.fill(false);
    if (runOut) { while (deal()); return this.finish(s, names, true); }
    if (!deal()) return this.finish(s, names, true);
    s.turn = this.nextFrom(s, s.dealer, (j) => this.canAct(s, j));
  },
  finish(s, names = [], showdown = false) {
    const live = this.live(s);
    const results = [];
    if (!showdown || live.filter(Boolean).length === 1) {
      const w = live.indexOf(true);
      const pot = s.committed.reduce((n, x) => n + x, 0);
      s.chips[w] += pot;
      results.push({ seat: w, won: pot, hand: null });
      log(s, `${names[w] || "Someone"} wins ${pot}`);
    } else {
      const scores = s.hole.map((h, j) => (live[j] ? best7([...h, ...s.board]) : null));
      const levels = [...new Set(s.committed.filter((x) => x > 0))].sort((a, b) => a - b);
      let prev = 0;
      for (const lv of levels) {
        const pot = s.committed.reduce((n, x) => n + Math.max(0, Math.min(x, lv) - prev), 0);
        const elig = [...Array(s.n).keys()].filter((j) => live[j] && s.committed[j] >= lv);
        prev = lv;
        if (!pot || !elig.length) continue;
        let best = null, winners = [];
        for (const j of elig) { const c = best ? cmp(scores[j], best) : 1; if (c > 0) { best = scores[j]; winners = [j]; } else if (c === 0) winners.push(j); }
        const share = Math.floor(pot / winners.length);
        winners.forEach((j, k) => { const amt = share + (k === 0 ? pot - share * winners.length : 0); s.chips[j] += amt; const r = results.find((x) => x.seat === j); if (r) r.won += amt; else results.push({ seat: j, won: amt, hand: HAND_NAMES[scores[j][0]] }); });
      }
      s.shown = live.map((x, j) => (x ? s.hole[j] : null));
      for (const r of results) log(s, `${names[r.seat] || "Someone"} wins ${r.won} with ${r.hand}`);
    }
    s.results = results;
    s.phase = "done"; s.turn = -1;
    const alive = this.alive(s);
    if (alive.length < 2) { s.winner = alive[0]; s.phase = "over"; log(s, `${names[s.winner] || "Someone"} has all the chips! 🏆`); }
  },
  over: (s) => (s.phase === "over" ? { winner: s.winner } : null),
};
// What you have right now (2–7 cards)
poker.view = function (s, me) {
  const pot = (s.committed || []).reduce((n, x) => n + x, 0);
  let myHand = null;
  const hole = me >= 0 ? s.hole?.[me] || [] : [];
  if (hole.length) {
    const all = [...hole, ...(s.board || [])];
    myHand = all.length >= 5 ? HAND_NAMES[best7(all)[0]] : hole[0][0] === hole[1][0] ? "Pair" : "High card";
  }
  return { kind: "poker", phase: s.phase, chips: s.chips, bets: s.bets, folded: s.folded, allin: s.allin, inHand: s.inHand, dealer: s.dealer, turn: s.turn, board: s.board || [],
    hole, shown: s.shown, results: s.results, pot, sb: s.sb, bb: s.bb, log: s.log, winner: s.winner, myHand,
    toCall: me >= 0 && s.bets ? Math.max(0, s.curBet - s.bets[me]) : 0, minRaiseTo: (s.curBet || 0) + (s.minRaise || 0) };
};

/* ======================= Santase (66) ======================= */
const S_ORDER = "9JQKTA";
const S_VAL = { 9: 0, J: 2, Q: 3, K: 4, T: 10, A: 11 };
const santase = {
  name: "Santase", emoji: "🂡", min: 2, max: 2, desc: "Сантасе (66): take tricks, call marriages, reach 66. First to 11 points wins.",
  start() { const s = { kind: "santase", n: 2, score: [0, 0], first: 0, log: [], winner: null }; this.newHand(s); return s; },
  newHand(s) {
    const deck = deckOf(S_ORDER);
    s.hands = [deck.splice(0, 6), deck.splice(0, 6)];
    s.stock = deck; // stock[0] is the face-up trump card, cards are drawn from the end
    s.trumpSuit = s.stock[0][1];
    s.leader = s.first; s.turn = s.first; s.first = 1 - s.first;
    s.trick = []; s.lastTrick = null; s.points = [0, 0]; s.tricks = [0, 0]; s.pending = [0, 0]; s.closed = null; s.phase = "play"; s.result = null; s.marriages = [];
  },
  strict: (s) => s.closed !== null || s.stock.length === 0,
  beats(s, a, b) { // does b beat a (a led)
    if (a[1] === b[1]) return S_ORDER.indexOf(b[0]) > S_ORDER.indexOf(a[0]);
    return b[1] === s.trumpSuit;
  },
  legal(s, seat) {
    const hand = s.hands[seat];
    if (!s.trick.length || !this.strict(s)) return [...hand];
    const led = s.trick[0].card;
    const same = hand.filter((c) => c[1] === led[1]);
    if (same.length) { const higher = same.filter((c) => this.beats(s, led, c)); return higher.length ? higher : same; }
    const trumps = hand.filter((c) => c[1] === s.trumpSuit);
    return trumps.length ? trumps : [...hand];
  },
  act(s, seat, a, names) {
    if (s.winner !== null) fail("This game is over.");
    if (a.type === "next") { if (s.phase !== "done") fail("Finish this hand first."); this.newHand(s); return; }
    if (s.phase !== "play") fail("Start the next hand.");
    if (s.turn !== seat) fail("It’s not your turn.");
    const hand = s.hands[seat], leading = !s.trick.length;
    if (a.type === "exchange") {
      if (!leading || this.strict(s) || s.stock.length < 3) fail("You can’t exchange the trump now.");
      const nine = "9" + s.trumpSuit;
      if (!hand.includes(nine)) fail("You need the 9 of trumps.");
      take(hand, nine); hand.push(s.stock[0]); s.stock[0] = nine;
      log(s, `${names[seat]} swapped the 9 for ${cardName(hand[hand.length - 1])}`);
      return;
    }
    if (a.type === "close") {
      if (!leading || this.strict(s) || s.stock.length < 3) fail("You can’t close now.");
      s.closed = seat; log(s, `${names[seat]} closed the deck 🔒`);
      return;
    }
    if (a.type !== "play") fail("Play a card.");
    const c = String(a.card || "");
    if (!hand.includes(c)) fail("You don’t have that card.");
    if (!leading && !this.legal(s, seat).includes(c)) fail(this.strict(s) ? "Follow suit (and beat it if you can), or play a trump." : "You can’t play that.");
    if (a.marriage) {
      if (!leading || !"KQ".includes(c[0])) fail("Lead a king or queen to call a marriage.");
      const pair = (c[0] === "K" ? "Q" : "K") + c[1];
      if (!hand.includes(pair)) fail("You need the king and queen of the same suit.");
      const pts = c[1] === s.trumpSuit ? 40 : 20;
      if (s.tricks[seat] > 0) s.points[seat] += pts; else s.pending[seat] += pts;
      s.marriages.push({ seat, suit: c[1], pts });
      log(s, `${names[seat]} calls ${pts} ${SUIT_NAME[c[1]]} 💍`);
      if (s.points[seat] >= 66) { take(hand, c); return this.endHand(s, seat, names); }
    }
    take(hand, c);
    s.trick.push({ seat, card: c });
    if (s.trick.length < 2) { s.turn = 1 - seat; return; }
    const [x, y] = s.trick;
    const w = this.beats(s, x.card, y.card) ? y.seat : x.seat;
    s.points[w] += S_VAL[x.card[0]] + S_VAL[y.card[0]] + s.pending[w];
    s.pending[w] = 0;
    s.tricks[w]++;
    s.lastTrick = s.trick; s.trick = [];
    s.leader = w; s.turn = w;
    if (s.closed === null && s.stock.length) { s.hands[w].push(s.stock.pop()); s.hands[1 - w].push(s.stock.pop()); }
    if (s.points[w] >= 66) return this.endHand(s, w, names);
    if (!s.hands[0].length && !s.hands[1].length) {
      if (s.closed === null) s.points[w] += 10; // last trick
      if (s.points[w] >= 66) return this.endHand(s, w, names);
      if (s.closed !== null) return this.endHand(s, 1 - s.closed, names, true);
      return this.endHand(s, s.points[0] === s.points[1] ? w : s.points[0] > s.points[1] ? 0 : 1, names);
    }
  },
  endHand(s, w, names, closerFailed = false) {
    const l = 1 - w;
    let gp;
    if (closerFailed || (s.closed !== null && s.closed !== w)) gp = 3;
    else gp = s.tricks[l] === 0 ? 3 : s.points[l] < 33 ? 2 : 1;
    s.score[w] += gp;
    s.result = { winner: w, gamePoints: gp, points: [...s.points] };
    log(s, `${names[w]} wins the hand (${s.points[w]} – ${s.points[l]}) +${gp}`);
    s.phase = "done"; s.turn = -1;
    if (s.score[w] >= 11) { s.winner = w; log(s, `${names[w]} wins the game! 🏆`); }
  },
  view(s, me) {
    const leading = s.turn === me && !s.trick.length && s.phase === "play";
    const hand = s.hands[me] || [];
    return { kind: "santase", phase: s.phase, score: s.score, turn: s.turn, trumpSuit: s.trumpSuit, trumpCard: s.stock.length ? s.stock[0] : null, stockCount: s.stock.length,
      closed: s.closed, hand: [...hand].sort((a, b) => a[1].localeCompare(b[1]) || S_ORDER.indexOf(a[0]) - S_ORDER.indexOf(b[0])),
      oppCount: me >= 0 ? s.hands[1 - me].length : null, counts: s.hands.map((x) => x.length), trick: s.trick, lastTrick: s.lastTrick,
      myPoints: me >= 0 ? s.points[me] : null, tricks: s.tricks, result: s.result, winner: s.winner, log: s.log,
      legal: s.turn === me && s.phase === "play" ? this.legal(s, me) : [],
      canExchange: leading && !this.strict(s) && s.stock.length >= 3 && hand.includes("9" + s.trumpSuit),
      canClose: leading && !this.strict(s) && s.stock.length >= 3,
      marriages: leading ? [...new Set(hand.filter((c) => c[0] === "K" && hand.includes("Q" + c[1])).map((c) => c[1]))] : [] };
  },
  over: (s) => (s.winner !== null ? { winner: s.winner } : null),
};

/* ======================= Belot ======================= */
const B_NAT = "789TJQKA"; // for sequences
const T_ORDER = ["J", "9", "A", "T", "K", "Q", "8", "7"]; // high → low
const P_ORDER = ["A", "T", "K", "Q", "J", "9", "8", "7"];
const T_VAL = { J: 20, 9: 14, A: 11, T: 10, K: 4, Q: 3, 8: 0, 7: 0 };
const P_VAL = { A: 11, T: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
const BIDS = ["C", "D", "H", "S", "NT", "AT"];
const BID_NAME = { C: "♣ Clubs", D: "♦ Diamonds", H: "♥ Hearts", S: "♠ Spades", NT: "No trumps", AT: "All trumps" };
const belot = {
  name: "Belot", emoji: "🎴", min: 4, max: 4, desc: "Белот for 4 (two teams: seats 1 & 3 vs 2 & 4). Bid, declare, play to 151.",
  start() { const s = { kind: "belot", n: 4, score: [0, 0], dealer: 3, log: [], winner: null }; this.newDeal(s); return s; },
  newDeal(s) {
    s.dealer = (s.dealer + 1) % 4;
    const deck = deckOf(B_NAT);
    s.hands = [0, 1, 2, 3].map(() => []);
    for (const k of [3, 2]) for (let i = 1; i <= 4; i++) s.hands[(s.dealer + i) % 4].push(...deck.splice(0, k));
    s.rest = deck;
    s.phase = "bid"; s.turn = (s.dealer + 1) % 4; s.contract = null; s.passes = 0; s.bids = [];
    s.trick = []; s.lastTrick = null; s.points = [0, 0]; s.tricksCount = [0, 0]; s.decl = []; s.belotsDone = []; s.result = null;
  },
  isTrump(s, c) { const t = s.contract.type; return t === "AT" || c[1] === t; },
  order(s, c) { return this.isTrump(s, c) ? T_ORDER : P_ORDER; },
  value(s, c) { return this.isTrump(s, c) ? T_VAL[c[0]] : P_VAL[c[0]]; },
  winnerOf(s, trick) {
    const led = trick[0].card[1], t = s.contract.type;
    let best = trick[0];
    for (const x of trick.slice(1)) {
      const bt = t !== "AT" && t !== "NT" && best.card[1] === t, xt = t !== "AT" && t !== "NT" && x.card[1] === t;
      if (xt && !bt) best = x;
      else if (x.card[1] === best.card[1] && (xt || x.card[1] === led || bt)) { const o = this.order(s, x.card); if (o.indexOf(x.card[0]) < o.indexOf(best.card[0])) best = x; }
    }
    return best.seat;
  },
  legal(s, seat) {
    const hand = s.hands[seat], t = s.contract.type;
    if (!s.trick.length) return [...hand];
    const led = s.trick[0].card[1];
    const same = hand.filter((c) => c[1] === led);
    const curW = this.winnerOf(s, s.trick), partnerWins = curW % 2 === seat % 2;
    const highestOf = (suit) => { const o = t === "AT" || suit === t ? T_ORDER : P_ORDER; return s.trick.filter((x) => x.card[1] === suit).reduce((m, x) => Math.min(m, o.indexOf(x.card[0])), 99); };
    if (same.length) {
      // Trumps led (or all trumps): you must go higher if you can
      if (t === "AT" || led === t) { const hi = highestOf(led); const up = same.filter((c) => T_ORDER.indexOf(c[0]) < hi); return up.length ? up : same; }
      return same;
    }
    if (t === "NT" || t === "AT" || partnerWins) return [...hand];
    const trumps = hand.filter((c) => c[1] === t);
    if (!trumps.length) return [...hand];
    const hi = highestOf(t);
    const up = trumps.filter((c) => T_ORDER.indexOf(c[0]) < hi);
    return up.length ? up : trumps;
  },
  declarations(s) {
    if (s.contract.type === "NT") return;
    for (let seat = 0; seat < 4; seat++) {
      const hand = s.hands[seat];
      for (const [r, pts] of [["J", 200], ["9", 150], ["A", 100], ["T", 100], ["K", 100], ["Q", 100]]) if (SUITS.every((su) => hand.includes(r + su))) s.decl.push({ seat, text: `Four ${RANK_NAME[r] || r}s`, pts });
      for (const su of SUITS) {
        let run = 0;
        for (let i = 0; i <= B_NAT.length; i++) {
          if (i < B_NAT.length && hand.includes(B_NAT[i] + su)) { run++; continue; }
          if (run >= 3) s.decl.push({ seat, text: run === 3 ? "Tierce" : run === 4 ? "Quarte" : "Quinte", pts: run === 3 ? 20 : run === 4 ? 50 : 100 });
          run = 0;
        }
      }
    }
  },
  act(s, seat, a, names) {
    if (s.winner !== null) fail("This game is over.");
    if (a.type === "next") { if (s.phase !== "done") fail("Finish this deal first."); this.newDeal(s); return; }
    if (s.turn !== seat) fail("It’s not your turn.");
    if (s.phase === "bid") {
      if (a.type === "pass") { s.passes++; s.bids.push({ seat, bid: "Pass" }); log(s, `${names[seat]} passes`); }
      else if (a.type === "bid") {
        const i = BIDS.indexOf(a.bid);
        if (i === -1) fail("Pick a bid.");
        if (s.contract && i <= BIDS.indexOf(s.contract.type)) fail("Bid higher than " + BID_NAME[s.contract.type] + ".");
        s.contract = { type: a.bid, team: seat % 2, by: seat, double: 1 };
        s.passes = 0; s.bids.push({ seat, bid: BID_NAME[a.bid] }); log(s, `${names[seat]} bids ${BID_NAME[a.bid]}`);
      } else if (a.type === "contra" || a.type === "recontra") {
        if (!s.contract) fail("There’s nothing to double.");
        if (a.type === "contra" && (s.contract.team === seat % 2 || s.contract.double !== 1)) fail("You can’t double that.");
        if (a.type === "recontra" && (s.contract.team !== seat % 2 || s.contract.double !== 2)) fail("You can’t redouble that.");
        s.contract.double *= 2; s.passes = 0; s.bids.push({ seat, bid: a.type === "contra" ? "Contra" : "Re-contra" }); log(s, `${names[seat]}: ${a.type === "contra" ? "Contra!" : "Re-contra!"}`);
      } else fail("Bid or pass.");
      if (!s.contract && s.passes === 4) { log(s, "Everyone passed — new deal"); this.newDeal(s); return; }
      if (s.contract && s.passes === 3) {
        for (let i = 1; i <= 4; i++) s.hands[(s.dealer + i) % 4].push(...s.rest.splice(0, 3));
        s.phase = "play"; s.turn = (s.dealer + 1) % 4;
        this.declarations(s);
        for (const d of s.decl) log(s, `${names[d.seat]}: ${d.text} (${d.pts})`);
        return;
      }
      s.turn = (seat + 1) % 4;
      return;
    }
    if (a.type !== "play") fail("Play a card.");
    const c = String(a.card || "");
    if (!s.hands[seat].includes(c)) fail("You don’t have that card.");
    if (!this.legal(s, seat).includes(c)) fail("You must follow suit (and play higher trumps / trump in when you have to).");
    // Belot: king + queen of trumps (any suit in all trumps)
    const t = s.contract.type;
    if (t !== "NT" && "KQ".includes(c[0]) && (t === "AT" || c[1] === t) && s.hands[seat].includes((c[0] === "K" ? "Q" : "K") + c[1]) && !s.belotsDone.includes(c[1])) {
      s.belotsDone.push(c[1]); s.decl.push({ seat, text: "Belot", pts: 20 }); log(s, `${names[seat]}: Belot! (20)`);
    }
    take(s.hands[seat], c);
    s.trick.push({ seat, card: c });
    if (s.trick.length < 4) { s.turn = (seat + 1) % 4; return; }
    const w = this.winnerOf(s, s.trick);
    s.points[w % 2] += s.trick.reduce((n, x) => n + this.value(s, x.card), 0);
    s.tricksCount[w % 2]++;
    s.lastTrick = s.trick; s.trick = []; s.turn = w;
    if (s.hands.every((h) => !h.length)) { s.points[w % 2] += 10; this.score(s, names); }
  },
  score(s, names) {
    const t = s.contract.type, ct = s.contract.team, ot = 1 - ct;
    const mult = t === "NT" ? 2 : 1;
    const raw = s.points.map((p) => p * mult);
    s.decl.forEach((d) => (raw[d.seat % 2] += d.pts));
    // Capot: one team took every trick
    if (s.tricksCount[ct] === 0 || s.tricksCount[ot] === 0) { const w = s.tricksCount[ct] ? ct : ot; raw[w] += 90; }
    let final = [...raw];
    let note;
    if (raw[ct] <= raw[ot]) { final = [0, 0]; final[ot] = raw[ct] + raw[ot]; note = `${BID_NAME[t]} went down (вътре)`; }
    else note = `${BID_NAME[t]} made it`;
    if (s.contract.double > 1) { const total = (final[0] + final[1]) * s.contract.double; const win = final[ct] > final[ot] ? ct : ot; final = [0, 0]; final[win] = total; }
    const gp = final.map((p) => Math.round(p / 10));
    s.score[0] += gp[0]; s.score[1] += gp[1];
    s.result = { raw, gamePoints: gp, note };
    log(s, `${note}: ${gp[0]} – ${gp[1]}`);
    s.phase = "done"; s.turn = -1;
    if (s.score[0] >= 151 || s.score[1] >= 151) {
      if (s.score[0] !== s.score[1]) { s.winner = s.score[0] > s.score[1] ? 0 : 1; log(s, `Team ${s.winner + 1} wins! 🏆`); }
    }
  },
  view(s, me) {
    const hand = s.hands[me] || [];
    const sortKey = (c) => "SHCD".indexOf(c[1]) * 10 + (s.contract && s.phase === "play" ? this.order(s, c).indexOf(c[0]) : P_ORDER.indexOf(c[0]));
    return { kind: "belot", phase: s.phase, score: s.score, dealer: s.dealer, turn: s.turn, hand: [...hand].sort((a, b) => sortKey(a) - sortKey(b)),
      counts: s.hands.map((h) => h.length), contract: s.contract ? { ...s.contract, name: BID_NAME[s.contract.type] } : null, bids: s.bids.slice(-8),
      trick: s.trick, lastTrick: s.lastTrick, points: s.phase === "done" ? s.points : null, decl: s.decl, result: s.result, winner: s.winner, log: s.log,
      legal: s.phase === "play" && s.turn === me ? this.legal(s, me) : [],
      canBid: s.phase === "bid" && s.turn === me ? BIDS.filter((b) => !s.contract || BIDS.indexOf(b) > BIDS.indexOf(s.contract.type)) : [],
      canContra: s.phase === "bid" && s.turn === me && s.contract && s.contract.team !== me % 2 && s.contract.double === 1,
      canRecontra: s.phase === "bid" && s.turn === me && s.contract && s.contract.team === me % 2 && s.contract.double === 2 };
  },
  over: (s) => (s.winner !== null ? { winner: s.winner, team: true } : null),
};

const CARD_GAMES = { poker, blackjack, santase, uno, belot, ...require("./party") }; // + DOS and the drawing/story party games

/* ======================= Bots ======================= */
// Who has to do something right now (so a bot in that seat can move)
function waitingSeats(type, s) {
  if (CARD_GAMES[type]?.waiting) return CARD_GAMES[type].waiting(s);
  if (type === "blackjack") {
    if (s.phase === "bet") return s.bets.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
    return s.phase === "play" && s.turn >= 0 ? [s.turn] : [];
  }
  if (type === "uno") return s.winner === null ? [s.turn] : [];
  if (type === "poker") return s.phase !== "done" && s.phase !== "over" && s.turn >= 0 ? [s.turn] : [];
  if (type === "santase" || type === "belot") return s.phase !== "done" && s.winner === null && s.turn >= 0 ? [s.turn] : [];
  return [];
}
const lowest = (cards, val) => [...cards].sort((a, b) => val(a) - val(b))[0];
function botMove(type, s, seat) {
  const def = CARD_GAMES[type];
  if (def.bot) return def.bot(s, seat);
  if (type === "blackjack") {
    if (s.phase === "bet") return { type: "bet", amount: Math.max(10, Math.min(s.chips[seat], 50)) };
    const v = bjValue(s.hands[seat]);
    if (s.hands[seat].length === 2 && (v === 10 || v === 11) && s.chips[seat] >= s.bets[seat] * 2) return { type: "double" };
    return { type: v < 17 ? "hit" : "stand" };
  }
  if (type === "uno") {
    const v = def.view(s, seat);
    if (v.playable.length) {
      const hand = s.hands[seat];
      const counts = {}; for (const c of hand) if (c[0] !== "W") counts[c[0]] = (counts[c[0]] || 0) + 1;
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "R";
      // keep wild cards for later: play coloured cards first
      const card = v.playable.find((c) => c[0] !== "W") || v.playable[0];
      return { type: "play", card, color: best };
    }
    return s.drew ? { type: "pass" } : { type: "draw" };
  }
  if (type === "poker") {
    const v = def.view(s, seat);
    const all = [...s.hole[seat], ...s.board];
    let strength;
    if (all.length >= 5) strength = best7(all)[0];
    else { const [a, b] = s.hole[seat]; strength = a[0] === b[0] ? 2 : (RV(a[0]) >= 11 && RV(b[0]) >= 11) ? 1 : 0; }
    const r = crypto.randomInt(100);
    if (v.toCall === 0) {
      if (strength >= 3 && s.chips[seat] > v.minRaiseTo - s.bets[seat] && r < 50) return { type: "raise", to: v.minRaiseTo };
      return { type: "check" };
    }
    const cheap = v.toCall <= s.bb * 2 || v.toCall <= s.chips[seat] * 0.05;
    if (strength >= 4 && r < 40 && s.chips[seat] > v.minRaiseTo - s.bets[seat]) return { type: "raise", to: v.minRaiseTo };
    if (strength >= 1 || cheap || r < 10) return { type: "call" };
    return { type: "fold" };
  }
  if (type === "santase") {
    const v = def.view(s, seat);
    if (v.canExchange) return { type: "exchange" };
    if (v.marriages.length) { const su = v.marriages.includes(s.trumpSuit) ? s.trumpSuit : v.marriages[0]; return { type: "play", card: "K" + su, marriage: true }; }
    const legal = def.legal(s, seat);
    const val = (c) => S_VAL[c[0]] + (c[1] === s.trumpSuit ? 20 : 0);
    if (!s.trick.length) return { type: "play", card: lowest(legal, val) };
    const led = s.trick[0].card;
    const winners = legal.filter((c) => def.beats(s, led, c));
    const worth = S_VAL[led[0]];
    if (winners.length && (worth >= 10 || winners.some((c) => c[1] !== s.trumpSuit))) return { type: "play", card: lowest(winners, val) };
    return { type: "play", card: lowest(legal, val) };
  }
  if (type === "belot") {
    if (s.phase === "bid") {
      const hand = s.hands[seat];
      let bestSuit = null, bestScore = 0;
      for (const su of ["C", "D", "H", "S"]) {
        const mine = hand.filter((c) => c[1] === su);
        const sc = (mine.some((c) => c[0] === "J") ? 3 : 0) + (mine.some((c) => c[0] === "9") ? 2 : 0) + mine.length;
        if (sc > bestScore) { bestScore = sc; bestSuit = su; }
      }
      const curI = s.contract ? BIDS.indexOf(s.contract.type) : -1;
      if (bestScore >= 6 && BIDS.indexOf(bestSuit) > curI && !(s.contract && s.contract.team === seat % 2)) return { type: "bid", bid: bestSuit };
      return { type: "pass" };
    }
    const legal = def.legal(s, seat);
    const val = (c) => def.value(s, c) + (def.isTrump(s, c) ? 15 : 0);
    if (!s.trick.length) return { type: "play", card: [...legal].sort((a, b) => val(b) - val(a))[0] };
    const curW = def.winnerOf(s, s.trick);
    if (curW % 2 === seat % 2) return { type: "play", card: [...legal].sort((a, b) => def.value(s, b) - def.value(s, a))[0] }; // partner wins: give points
    const winning = legal.filter((c) => def.winnerOf(s, [...s.trick, { seat, card: c }]) === seat);
    return { type: "play", card: winning.length ? lowest(winning, val) : lowest(legal, val) };
  }
  return null;
}

module.exports = { CARD_GAMES, cardName, waitingSeats, botMove };
