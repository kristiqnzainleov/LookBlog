// Card games at a table in a chat: Poker, Blackjack, Santase, UNO and Belot.
// The server deals and checks every move; this only shows your view and sends what you do.
import { h, avatar, toast, modal } from "../ui.js";
import { api, upload } from "../api.js";
import { drawInWindow } from "./drawpad.js";

export const CARD_LIST = [
  ["poker", "♠️", "Poker", "Texas Hold’em for 2–8. Chips, blinds, all in."],
  ["blackjack", "🃏", "Blackjack", "1–7 players against the dealer. Get closest to 21."],
  ["santase", "🂡", "Santase (66)", "Сантасе for 2: marriages, closing, first to 11."],
  ["uno", "🟥", "UNO", "2–8 players. Match colour or number, +2, +4, skip."],
  ["belot", "🎴", "Belot", "Белот for 4 in two teams. Bid, declare, play to 151."],
  ["dos", "🟦", "DOS", "UNO’s sequel for 2–8. Match the middle cards by number — or two cards that add up."],
];
// Party games: drawing and stories, with a replay at the end
export const PARTY_LIST = [
  ["drawtell", "🎨", "Draw & Tell", "Like Gartic Phone: write, draw what you’re told, guess what the drawing is…"],
  ["drawthis", "🖍️", "Draw This!", "One person says what to draw, everyone draws it, they pick the best one."],
  ["story", "📖", "Story Chain", "Start a story; the next person only sees your last line and carries on."],
];
const DOS_COLOR = { R: "red", G: "green", B: "blue", Y: "yellow", W: "wild" };
function dosEl(c, { onClick, picked = false, size = "" } = {}) {
  if (!c) return h("span", { class: `ucard back dos ${size}` }, h("b", { text: "DOS" }));
  const col = c === "W2" ? "W" : c[0], label = c === "W2" ? "2★" : c.slice(1);
  const el = h(onClick ? "button" : "span", { type: onClick ? "button" : undefined, class: `ucard dos ${DOS_COLOR[col]} ${picked ? "picked" : ""} ${size}`.trim(), title: c === "W2" ? "Wild DOS: a 2 of any colour" : c.endsWith("#") ? "Wild #: any number" : "" }, h("b", { text: label }));
  if (onClick) el.addEventListener("click", () => onClick(c));
  return el;
}

const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANK = { T: "10" };
const UNO_COLOR = { R: "red", G: "green", B: "blue", Y: "yellow" };
const UNO_LABEL = { S: "⊘", R: "⇄", D: "+2" };

export function cardEl(c, { onClick, playable = false, dim = false, size = "" } = {}) {
  if (!c || c === "??") return h("span", { class: `pcard back ${size}` });
  const red = c[1] === "H" || c[1] === "D";
  const el = h(onClick ? "button" : "span", { type: onClick ? "button" : undefined, class: `pcard ${red ? "red" : ""} ${playable ? "playable" : ""} ${dim ? "dim" : ""} ${size}`.trim(), title: (RANK[c[0]] || c[0]) + SUIT[c[1]] },
    h("b", { text: RANK[c[0]] || c[0] }), h("i", { text: SUIT[c[1]] }));
  if (onClick) el.addEventListener("click", () => onClick(c));
  return el;
}
function unoEl(c, { onClick, playable = false, dim = false, size = "" } = {}) {
  if (!c) return h("span", { class: `ucard back ${size}` }, h("b", { text: "UNO" }));
  const wild = c[0] === "W";
  const label = c === "W" ? "W" : c === "W4" ? "+4" : UNO_LABEL[c[1]] || c[1];
  const el = h(onClick ? "button" : "span", { type: onClick ? "button" : undefined, class: `ucard ${wild ? "wild" : UNO_COLOR[c[0]]} ${playable ? "playable" : ""} ${dim ? "dim" : ""} ${size}`.trim() }, h("b", { text: label }));
  if (onClick) el.addEventListener("click", () => onClick(c));
  return el;
}

export function cardGameView(chatId, messageId, game, { big = false, onOpenBig } = {}) {
  const el = h("div", { class: "cg" + (big ? " big" : "") });
  let g = game, busy = false;
  const name = (i) => { const p = g.players[i]; return p ? (p.nickname || p.name) + (i === g.myIndex ? " (you)" : "") : "?"; };
  async function send(path, body) {
    if (busy) return;
    busy = true;
    try { paint((await api(`/api/chats/${chatId}/games/${messageId}/${path}`, { method: "POST", body })).game); }
    catch (err) { toast(err.error || "Couldn’t do that."); }
    busy = false;
  }
  const act = (body) => send("act", body);
  const btn = (text, onclick, cls = "btn-outline-light") => h("button", { type: "button", class: `btn btn-xs ${cls}`, text, onclick });
  const logEl = (v) => (v?.log?.length ? h("div", { class: "cg-log" }, ...v.log.slice(-4).map((t) => h("p", { text: t }))) : null);

  function lobby() {
    const inIt = g.myIndex !== -1;
    return h("div", { class: "cg-lobby" },
      h("div", { class: "cg-seats" }, ...g.players.map((p, i) => h("span", { class: "cg-seat" }, avatar(p, 24), h("b", { text: name(i) }))),
        ...Array.from({ length: Math.max(0, Math.min(g.max, Math.max(g.min, g.players.length + 1)) - g.players.length) }, () => h("span", { class: "cg-seat open", text: "Open seat" }))),
      h("p", { class: "muted", text: `${g.min === g.max ? g.min : g.min + "–" + g.max} players · ${g.players.length} at the table` }),
      h("div", { class: "game-actions" },
        !inIt && g.players.length < g.max ? btn("Join the table", () => send("join"), "btn-primary") : null,
        inIt && !g.isHost ? btn("Leave", () => send("leave")) : null,
        g.isHost && g.players.length < g.max && !g.noBots ? btn("🤖 Add a bot", () => send("addbot")) : null,
        g.isHost && g.players.some((p) => p?.bot) ? btn("Remove a bot", () => send("removebot")) : null,
        g.isHost ? btn(g.players.length >= g.min ? "▶ Start" : `Need ${g.min - g.players.length} more — add bots or wait`, () => send("start"), "btn-primary") : null),
      g.isHost && g.players.length < g.min ? h("p", { class: "create-hint", text: g.noBots ? "Invite people from the chat — this one needs real players." : "No one to play with? Add bots — they play on their own." }) : null);
  }

  /* ---------- Blackjack ---------- */
  function blackjack(v) {
    const me = g.myIndex;
    const rows = g.players.map((p, i) => h("div", { class: "cg-row" + (v.turn === i ? " turn" : "") + (i === me ? " me" : "") },
      avatar(p, 24), h("div", { class: "cg-who" }, h("b", { text: name(i) }), h("small", { class: "muted", text: `🪙 ${v.chips[i]}${v.bets[i] ? " · bet " + v.bets[i] : ""}` })),
      h("div", { class: "cg-cards" }, ...v.hands[i].cards.map((c) => cardEl(c, { size: "sm" }))),
      v.hands[i].cards.length ? h("span", { class: "cg-val", text: v.hands[i].value > 21 ? `${v.hands[i].value} 💥` : v.hands[i].value }) : null,
      v.phase === "done" && v.results[i] != null ? h("span", { class: "cg-res " + (v.results[i] > 0 ? "up" : v.results[i] < 0 ? "down" : ""), text: v.results[i] > 0 ? `+${v.results[i]}` : v.results[i] < 0 ? String(v.results[i]) : "push" }) : null));
    const ctl = h("div", { class: "game-actions" });
    if (me !== -1 && v.phase === "bet" && !v.bets[me]) {
      const amt = h("input", { type: "number", class: "cg-num", min: 10, max: v.chips[me], step: 10, value: Math.min(50, v.chips[me]) });
      ctl.append(amt, btn("Bet", () => act({ type: "bet", amount: Number(amt.value) }), "btn-primary"));
    } else if (v.phase === "bet") ctl.append(h("span", { class: "muted", text: "Waiting for everyone to bet…" }));
    if (v.phase === "play" && v.turn === me) ctl.append(btn("Hit", () => act({ type: "hit" }), "btn-primary"), btn("Stand", () => act({ type: "stand" })), v.canDouble ? btn("Double", () => act({ type: "double" })) : null);
    if (v.phase === "done" && me !== -1) ctl.append(btn("Next round", () => act({ type: "next" }), "btn-primary"));
    return [h("div", { class: "cg-dealer" }, h("b", { text: "Dealer" }), h("div", { class: "cg-cards" }, ...v.dealer.cards.map((c) => cardEl(c, { size: "sm" }))), v.dealer.value != null ? h("span", { class: "cg-val", text: v.dealer.value }) : null), ...rows, ctl];
  }

  /* ---------- UNO ---------- */
  function uno(v) {
    const me = g.myIndex, myTurn = v.turn === me && v.winner === null;
    const play = (c) => {
      if (!myTurn) return;
      if (c[0] !== "W") return act({ type: "play", card: c });
      const pick = h("div", { class: "uno-colors" }, ...Object.entries(UNO_COLOR).map(([k, col]) => h("button", { type: "button", class: "ucard " + col, onclick: () => { m.close(); act({ type: "play", card: c, color: k }); } }, h("b", { text: " " }))));
      const m = modal({ title: "Pick a colour", body: pick });
    };
    const seats = h("div", { class: "cg-seats" }, ...g.players.map((p, i) => h("span", { class: "cg-seat" + (v.turn === i ? " turn" : ""), title: `${v.counts[i]} cards` }, avatar(p, 22), h("b", { text: name(i) }), h("small", { text: `🂠 ${v.counts[i]}${v.counts[i] === 1 ? " UNO!" : ""}` }))));
    const drawPile = h("button", { type: "button", class: "ucard back", disabled: !myTurn || v.drew, title: "Draw a card", onclick: () => act({ type: "draw" }) }, h("b", { text: "UNO" }));
    const table = h("div", { class: "uno-table" }, drawPile, unoEl(v.top, { size: "lg" }), h("span", { class: "uno-color " + UNO_COLOR[v.color], text: v.dir === 1 ? "↻" : "↺" }));
    const hand = h("div", { class: "cg-hand" }, ...v.hand.map((c) => unoEl(c, { onClick: myTurn ? play : null, playable: v.playable.includes(c), dim: myTurn && !v.playable.includes(c) })));
    const ctl = h("div", { class: "game-actions" }, myTurn && v.drew ? btn("Pass", () => act({ type: "pass" })) : null,
      me !== -1 ? h("span", { class: "muted", text: myTurn ? (v.drew ? "Play the card you drew, or pass." : "Your turn — play a card or draw.") : `${name(v.turn)}’s turn` }) : null);
    return [seats, table, me !== -1 ? hand : null, ctl];
  }

  /* ---------- Poker ---------- */
  function poker(v) {
    const me = g.myIndex, myTurn = v.turn === me && v.phase !== "done" && v.phase !== "over";
    const rows = g.players.map((p, i) => h("div", { class: "cg-row" + (v.turn === i ? " turn" : "") + (i === me ? " me" : "") + (v.folded?.[i] || !v.inHand?.[i] ? " out" : "") },
      avatar(p, 24), h("div", { class: "cg-who" }, h("b", {}, name(i), v.dealer === i ? h("span", { class: "cg-dealer-btn", text: "D" }) : null),
        h("small", { class: "muted", text: `🪙 ${v.chips[i]}${v.bets?.[i] ? " · bet " + v.bets[i] : ""}${v.folded?.[i] ? " · folded" : v.allin?.[i] ? " · ALL IN" : ""}` })),
      h("div", { class: "cg-cards" }, ...(v.shown?.[i] ? v.shown[i].map((c) => cardEl(c, { size: "sm" })) : i === me ? v.hole.map((c) => cardEl(c, { size: "sm" })) : v.inHand?.[i] && !v.folded?.[i] ? [cardEl("??", { size: "sm" }), cardEl("??", { size: "sm" })] : [])),
      v.results?.find((r) => r.seat === i) ? h("span", { class: "cg-res up", text: `+${v.results.find((r) => r.seat === i).won}` }) : null));
    const board = h("div", { class: "pk-board" }, ...v.board.map((c) => cardEl(c)), ...Array.from({ length: 5 - v.board.length }, () => h("span", { class: "pcard slot" })));
    const ctl = h("div", { class: "game-actions" });
    if (myTurn) {
      const raise = h("input", { type: "number", class: "cg-num", min: v.minRaiseTo, step: v.bb, value: v.minRaiseTo });
      ctl.append(btn("Fold", () => act({ type: "fold" })),
        v.toCall ? btn(`Call ${Math.min(v.toCall, v.chips[me])}`, () => act({ type: "call" }), "btn-primary") : btn("Check", () => act({ type: "check" }), "btn-primary"),
        v.chips[me] > v.toCall ? raise : null, v.chips[me] > v.toCall ? btn("Raise", () => act({ type: "raise", to: Number(raise.value) })) : null,
        btn("All in", () => act({ type: "allin" }), "btn-danger"));
    }
    if (v.phase === "done" && me !== -1) ctl.append(btn("Next hand", () => act({ type: "next" }), "btn-primary"));
    return [h("div", { class: "pk-top" }, board, h("b", { class: "pk-pot", text: `Pot ${v.pot}` }), h("small", { class: "muted", text: `Blinds ${v.sb}/${v.bb}` })),
      me !== -1 && v.myHand ? h("p", { class: "cg-hint", text: `You have: ${v.myHand}` }) : null, ...rows, ctl];
  }

  /* ---------- Santase ---------- */
  function santase(v) {
    const me = g.myIndex, myTurn = v.turn === me && v.phase === "play", leading = myTurn && !v.trick.length;
    const opp = me === -1 ? 1 : 1 - me;
    const head = h("div", { class: "st-top" },
      h("div", { class: "st-trump" }, v.trumpCard ? cardEl(v.trumpCard) : h("span", { class: "pcard slot", text: SUIT[v.trumpSuit] }), h("small", { text: `Trumps ${SUIT[v.trumpSuit]} · deck ${v.stockCount}${v.closed !== null ? " 🔒" : ""}` })),
      h("div", { class: "st-score" }, h("b", { text: `${v.score[0]} : ${v.score[1]}` }), h("small", { class: "muted", text: `${name(0)} · ${name(1)} — to 11` })));
    const trick = h("div", { class: "cg-trick" }, ...(v.trick.length ? v.trick : v.lastTrick || []).map((x) => h("div", { class: "cg-played" + (v.trick.length ? "" : " old") }, cardEl(x.card), h("small", { text: name(x.seat) }))));
    const hand = h("div", { class: "cg-hand" }, ...v.hand.map((c) => cardEl(c, { onClick: myTurn ? (cc) => act({ type: "play", card: cc }) : null, playable: myTurn && v.legal.includes(c), dim: myTurn && !v.legal.includes(c) })));
    const ctl = h("div", { class: "game-actions" },
      ...(leading ? v.marriages.map((su) => btn(`💍 Call ${su === v.trumpSuit ? 40 : 20} ${SUIT[su]}`, () => act({ type: "play", card: "K" + su, marriage: true }), "btn-primary")) : []),
      v.canExchange ? btn(`Swap 9${SUIT[v.trumpSuit]}`, () => act({ type: "exchange" })) : null,
      v.canClose ? btn("🔒 Close", () => act({ type: "close" })) : null,
      v.phase === "done" && me !== -1 && v.winner === null ? btn("Next hand", () => act({ type: "next" }), "btn-primary") : null);
    return [head, h("p", { class: "cg-hint", text: v.phase === "done" ? `Hand over: ${name(v.result.winner)} +${v.result.gamePoints}` : `${myTurn ? "Your turn" : name(v.turn) + "’s turn"}${me !== -1 ? ` · your points: ${v.myPoints}` : ""} · ${name(opp)} has ${v.counts[opp]} cards` }),
      trick, me !== -1 ? hand : null, ctl];
  }

  /* ---------- Belot ---------- */
  function belot(v) {
    const me = g.myIndex, myTurn = v.turn === me;
    const team = (i) => (i % 2 === 0 ? "Team 1" : "Team 2");
    const head = h("div", { class: "st-top" },
      h("div", {}, h("b", { text: v.contract ? `${v.contract.name}${v.contract.double > 1 ? " ×" + v.contract.double : ""}` : "Bidding…" }), v.contract ? h("small", { class: "muted", text: ` by ${name(v.contract.by)}` }) : null),
      h("div", { class: "st-score" }, h("b", { text: `${v.score[0]} : ${v.score[1]}` }), h("small", { class: "muted", text: `${name(0)} & ${name(2)} · ${name(1)} & ${name(3)} — to 151` })));
    const seats = h("div", { class: "cg-seats" }, ...g.players.map((p, i) => h("span", { class: "cg-seat t" + (i % 2) + (v.turn === i ? " turn" : "") }, avatar(p, 22), h("b", { text: name(i) }), h("small", { text: `${team(i)}${v.dealer === i ? " · deals" : ""}` }))));
    const parts = [head, seats];
    if (v.phase === "bid") {
      parts.push(h("div", { class: "cg-log" }, ...v.bids.map((b) => h("p", { text: `${name(b.seat)}: ${b.bid}` }))));
      if (myTurn) parts.push(h("div", { class: "game-actions" }, ...v.canBid.map((b) => btn({ C: "♣", D: "♦", H: "♥", S: "♠", NT: "No trumps", AT: "All trumps" }[b], () => act({ type: "bid", bid: b }), "btn-primary")),
        v.canContra ? btn("Contra", () => act({ type: "contra" }), "btn-danger") : null, v.canRecontra ? btn("Re-contra", () => act({ type: "recontra" }), "btn-danger") : null,
        btn("Pass", () => act({ type: "pass" }))));
      else parts.push(h("p", { class: "cg-hint", text: `${name(v.turn)} is bidding…` }));
    } else {
      parts.push(h("div", { class: "cg-trick" }, ...(v.trick.length ? v.trick : v.lastTrick || []).map((x) => h("div", { class: "cg-played" + (v.trick.length ? "" : " old") }, cardEl(x.card), h("small", { text: name(x.seat) })))));
      if (v.phase === "play") parts.push(h("p", { class: "cg-hint", text: myTurn ? "Your turn" : `${name(v.turn)}’s turn` }));
      if (v.phase === "done" && v.result) parts.push(h("p", { class: "cg-hint", text: `${v.result.note} · this deal ${v.result.gamePoints[0]} : ${v.result.gamePoints[1]}` }), me !== -1 && v.winner === null ? h("div", { class: "game-actions" }, btn("Next deal", () => act({ type: "next" }), "btn-primary")) : null);
    }
    if (me !== -1) parts.push(h("div", { class: "cg-hand" }, ...v.hand.map((c) => cardEl(c, { onClick: myTurn && v.phase === "play" ? (cc) => act({ type: "play", card: cc }) : null, playable: v.legal.includes(c), dim: myTurn && v.phase === "play" && !v.legal.includes(c) }))));
    return parts;
  }

  /* ---------- DOS ---------- */
  let picked = [];
  function dos(v) {
    const me = g.myIndex, myTurn = v.turn === me && v.winner === null;
    picked = picked.filter((c) => v.hand.includes(c));
    const seats = h("div", { class: "cg-seats" }, ...g.players.map((p, i) => h("span", { class: "cg-seat" + (v.turn === i ? " turn" : "") }, avatar(p, 22), h("b", { text: name(i) }), h("small", { text: `🂠 ${v.counts[i]}${v.counts[i] === 2 ? " DOS!" : ""}` }))));
    const pickCard = (c) => {
      if (!myTurn) return;
      if (v.bonus) return act({ type: "place", card: c }); // after a colour match: add it to the middle
      const i = picked.indexOf(c);
      if (i >= 0) picked.splice(i, 1); else picked = [...picked.slice(-1), c];
      paint(g);
    };
    const center = h("div", { class: "dos-center" }, ...v.center.map((c, i) => dosEl(c, { size: "lg", onClick: myTurn && picked.length ? () => { act({ type: "match", target: i, cards: picked }); picked = []; } : null })));
    const hand = h("div", { class: "cg-hand" }, ...v.hand.map((c) => dosEl(c, { onClick: myTurn ? pickCard : null, picked: picked.includes(c) })));
    const tip = !myTurn ? `${name(v.turn)}’s turn` : v.bonus ? `Colour match! Tap a card to add it to the middle (${v.bonus} left), or end your turn.`
      : picked.length ? `Now tap a card in the middle: same number, or two cards that add up to it.` : "Pick 1 or 2 of your cards, then a card in the middle. A wild # is any number; 2★ is a 2 of any colour.";
    const ctl = h("div", { class: "game-actions" },
      myTurn && !v.matchedCount && !v.drew ? btn("Draw a card", () => act({ type: "draw" })) : null,
      myTurn ? btn(v.matchedCount || v.drew ? "End turn" : "End turn (draw 1)", () => { picked = []; act({ type: "end" }); }, "btn-primary") : null,
      me !== -1 ? h("span", { class: "muted", text: tip }) : null);
    return [seats, h("div", { class: "uno-table" }, h("span", { class: "ucard back dos", title: `${v.drawCount} left` }, h("b", { text: "DOS" })), center), me !== -1 ? hand : null, ctl];
  }

  /* ---------- Draw & Tell / Story Chain ---------- */
  const avatarsDone = (doneSeats) => h("div", { class: "pg-done" }, ...g.players.map((p, i) => h("span", { class: "pg-who" + (doneSeats.includes(i) ? " ok" : ""), title: name(i) }, avatar(p, 26), doneSeats.includes(i) ? h("i", { text: "✓" }) : null)));
  function chain(v) {
    const story = g.type === "story";
    if (v.phase === "done") return [album()];
    const t = v.task;
    const head = h("p", { class: "pg-round", text: `Round ${v.round + 1} of ${v.rounds}` });
    let task = null;
    if (g.myIndex === -1) task = h("p", { class: "muted", text: "You’re watching. The album shows up at the end." });
    else if (t.sent) task = h("p", { class: "muted", text: "✓ Sent! Waiting for the others…" });
    else if (t.type === "draw") {
      task = h("div", { class: "pg-task" }, h("small", { class: "muted", text: "Draw this:" }), h("p", { class: "pg-quote", text: t.prev?.skipped ? "(they skipped — draw anything!)" : t.prev?.value }),
        btn("✏️ Draw it", async () => { const url = await drawInWindow("Draw it!", t.prev?.value || ""); if (url) act({ value: url }); }, "btn-primary"));
    } else {
      const input = h("input", { type: "text", class: "text-input pg-input", maxlength: 140,
        placeholder: !t.prev ? (story ? "Once upon a time…" : "Something to draw — e.g. a cat surfing a pizza") : story ? "What happens next?" : "What is this drawing?" });
      const go = btn("Send", () => input.value.trim() && act({ value: input.value }), "btn-primary");
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) act({ value: input.value }); });
      task = h("div", { class: "pg-task" },
        t.prev ? (t.prev.type === "draw"
          ? h("div", {}, h("small", { class: "muted", text: "What’s this drawing?" }), t.prev.skipped ? h("p", { class: "muted", text: "(no drawing — make something up!)" }) : h("img", { class: "pg-img", src: t.prev.value, alt: "A drawing" }))
          : h("div", {}, h("small", { class: "muted", text: "The story so far ends with:" }), h("p", { class: "pg-quote", text: t.prev.value || "…" })))
          : h("small", { class: "muted", text: story ? "Start a story:" : "Write something for the next person to draw:" }),
        h("div", { class: "invite-row" }, input, go));
    }
    return [head, avatarsDone(v.done), task];
  }
  function drawthis(v) {
    const me = g.myIndex, judge = v.judge, isJudge = me === judge;
    const scores = h("div", { class: "cg-seats" }, ...g.players.map((p, i) => h("span", { class: "cg-seat" + (i === judge ? " turn" : "") }, avatar(p, 22), h("b", { text: name(i) }), h("small", { text: `🏅 ${v.scores[i]}${i === judge ? " · picks" : ""}` }))));
    if (v.phase === "done") return [scores, album()];
    const head = h("p", { class: "pg-round", text: `Round ${v.round + 1} of ${v.rounds}` });
    let body;
    if (v.step === "prompt") {
      if (isJudge) {
        const input = h("input", { type: "text", class: "text-input pg-input", maxlength: 80, placeholder: "What should everyone draw? e.g. a dragon eating sushi" });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) act({ value: input.value }); });
        body = h("div", { class: "pg-task" }, h("small", { class: "muted", text: "You say what to draw this round:" }), h("div", { class: "invite-row" }, input, btn("Go", () => input.value.trim() && act({ value: input.value }), "btn-primary")));
      } else body = h("p", { class: "muted", text: `${name(judge)} is choosing what to draw…` });
    } else if (v.step === "draw") {
      const drawers = g.players.map((_, i) => i).filter((i) => i !== judge);
      body = h("div", { class: "pg-task" }, h("small", { class: "muted", text: "Draw this:" }), h("p", { class: "pg-quote", text: v.prompt }), avatarsDone(v.sent.filter((i) => drawers.includes(i))),
        !isJudge && me !== -1 && !v.sent.includes(me) ? btn("✏️ Draw it", async () => { const url = await drawInWindow(`Draw: ${v.prompt}`, v.prompt); if (url) act({ value: url }); }, "btn-primary")
          : h("p", { class: "muted", text: isJudge ? "Everyone is drawing…" : me === -1 ? "" : "✓ Sent! Waiting for the others…" }));
    } else {
      const grid = h("div", { class: "pg-grid" }, ...Object.entries(v.drawings || {}).filter(([, url]) => url).map(([seat, url]) => {
        const b = h(isJudge ? "button" : "div", { type: isJudge ? "button" : undefined, class: "pg-pick" }, h("img", { src: url, alt: "A drawing" }), h("small", { text: name(Number(seat)) }));
        if (isJudge) b.addEventListener("click", () => act({ winner: Number(seat) }));
        return b;
      }));
      body = h("div", { class: "pg-task" }, h("p", { class: "pg-quote", text: v.prompt }), h("small", { class: "muted", text: isJudge ? "Tap the best drawing:" : `${name(judge)} is picking the best one…` }), grid);
    }
    return [scores, head, body];
  }

  /* ---------- The album: what happened, to watch again (replay), save and share ---------- */
  function albumData() {
    const v = g.view;
    if (g.type === "drawthis") return (v.history || []).map((r, k) => ({
      title: `Round ${k + 1} · ${name(r.judge)}: “${r.prompt}”`,
      items: Object.entries(r.drawings).filter(([, u]) => u).map(([seat, u]) => ({ who: name(Number(seat)) + (Number(seat) === r.winner ? " 🏅" : ""), img: u })),
    }));
    return (v.chains || []).map((c, k) => ({
      title: g.type === "story" ? `Story ${k + 1}` : `Chain ${k + 1} · started by ${name(c[0]?.seat)}`,
      items: c.map((st) => ({ who: name(st.seat), text: st.type === "text" ? (st.skipped ? "(skipped)" : st.value) : null, img: st.type === "draw" && !st.skipped ? st.value : null, skipped: st.skipped && st.type === "draw" })),
    }));
  }
  function album() {
    const data = albumData();
    const list = h("div", { class: "pg-album" }, ...data.map((sec) => h("div", { class: "pg-sec" }, h("b", { text: sec.title }),
      ...sec.items.map((it) => h("div", { class: "pg-step" }, h("small", { class: "muted", text: it.who }), it.img ? h("img", { class: "pg-img", src: it.img, alt: "" }) : h("p", { class: "pg-quote", text: it.text || "(no drawing)" }))))));
    return h("div", {}, h("div", { class: "game-actions" },
      btn("▶ Replay", () => replay(data), "btn-primary"),
      btn("💾 Save", () => saveAlbum(data)),
      btn("📤 Share in chat", () => shareAlbum(data))), list);
  }
  // A slideshow: each step appears after the other
  function replay(data) {
    const steps = data.flatMap((sec) => [{ title: sec.title }, ...sec.items]);
    let i = 0, timer = null;
    const stage = h("div", { class: "rp-stage" });
    const bar = h("div", { class: "rp-bar" });
    const show = () => {
      const st = steps[i];
      stage.replaceChildren(st.title ? h("h3", { class: "rp-title", text: st.title }) : h("div", { class: "rp-step" }, h("small", { class: "muted", text: st.who }), st.img ? h("img", { src: st.img, alt: "" }) : h("p", { class: "pg-quote big", text: st.text || "(no drawing)" })));
      bar.style.setProperty("--p", ((i + 1) / steps.length) * 100 + "%");
    };
    const next = () => { if (i < steps.length - 1) { i++; show(); } else stop(); };
    const play = () => { stop(); timer = setInterval(next, 2600); pp.textContent = "⏸"; };
    const stop = () => { clearInterval(timer); timer = null; pp.textContent = "▶"; };
    const pp = h("button", { type: "button", class: "btn btn-sm btn-outline-light", text: "⏸", onclick: () => (timer ? stop() : play()) });
    modal({ title: `🎬 ${g.name} replay`, wide: true, onClose: stop, body: h("div", { class: "rp" }, bar, stage,
      h("div", { class: "game-actions" }, btn("◀", () => { stop(); i = Math.max(0, i - 1); show(); }), pp, btn("▶▶", () => { stop(); next(); }))) });
    show(); play();
  }
  // One tall picture of the whole album
  async function albumPng(data) {
    const W = 720, pad = 24, imgW = 480, imgH = 360;
    const loadImg = (src) => new Promise((ok) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
    const items = [];
    for (const sec of data) { items.push({ title: sec.title }); for (const it of sec.items) items.push({ ...it, image: it.img ? await loadImg(it.img) : null }); }
    const hOf = (it) => (it.title ? 56 : it.image ? imgH + 40 : 90);
    const H = 90 + items.reduce((n, it) => n + hOf(it), 0) + pad;
    const c = h("canvas", { width: W, height: H }), x = c.getContext("2d");
    x.fillStyle = "#0d0c0c"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#ff4fa3"; x.font = "900 34px Unbounded, sans-serif"; x.fillText(`${g.emoji} ${g.name}`, pad, 56);
    x.fillStyle = "#8a8282"; x.font = "600 16px 'Golos Text', sans-serif"; x.fillText("LookBlog", W - pad - 70, 56);
    let y = 90;
    const wrap = (text, maxW) => { const words = String(text).split(" "), lines = []; let line = ""; for (const w of words) { const t = line ? line + " " + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; } lines.push(line); return lines.slice(0, 3); };
    for (const it of items) {
      if (it.title) { x.fillStyle = "#f5f0f0"; x.font = "800 20px 'Golos Text', sans-serif"; x.fillText(it.title.slice(0, 60), pad, y + 34); y += 56; continue; }
      x.fillStyle = "#8a8282"; x.font = "700 14px 'Golos Text', sans-serif"; x.fillText(it.who, pad, y + 18);
      if (it.image) { x.drawImage(it.image, pad, y + 26, imgW, imgH); y += imgH + 40; }
      else {
        x.fillStyle = "#1b1919"; x.beginPath(); x.roundRect(pad, y + 26, W - pad * 2, 56, 12); x.fill();
        x.fillStyle = "#fff"; x.font = "600 17px 'Golos Text', sans-serif";
        wrap(it.text || "(no drawing)", W - pad * 4).forEach((l, k) => x.fillText(l, pad + 14, y + 50 + k * 20));
        y += 90;
      }
    }
    return new Promise((r) => c.toBlob(r, "image/png"));
  }
  async function saveAlbum(data) {
    const blob = await albumPng(data);
    if (!blob) return toast("Couldn’t make the picture.");
    const a = h("a", { href: URL.createObjectURL(blob), download: `${g.name.replace(/\W+/g, "-").toLowerCase()}-replay.png` });
    document.body.append(a); a.click(); a.remove();
    toast("Saved the replay picture.");
  }
  async function shareAlbum(data) {
    try {
      const blob = await albumPng(data);
      if (!blob) throw { error: "Couldn’t make the picture." };
      const { url } = await upload(new File([blob], "replay.png", { type: "image/png" }));
      await api(`/api/chats/${chatId}/messages`, { method: "POST", body: { text: `🎬 ${g.name} replay`, media: { url }, replayOf: messageId } });
      toast("Shared in the chat.");
    } catch (err) { toast(err.error || "Couldn’t share it."); }
  }

  // Click twice to be sure
  const sure = (text, action, cls) => {
    const b = btn(text, null, cls);
    let armed = false;
    b.addEventListener("click", () => { if (!armed) { armed = true; b.textContent = "Sure? Click again"; setTimeout(() => { armed = false; b.textContent = text; }, 3000); } else action(); });
    return b;
  };
  const TABLE = { blackjack, uno, poker, santase, belot, dos, drawtell: chain, story: chain, drawthis };
  function paint(next) {
    g = next;
    const v = g.view;
    let status = "", body = [];
    if (g.phase === "lobby") { status = "Waiting for players"; body = [lobby()]; }
    else {
      body = TABLE[g.type](v);
      if (g.over) {
        const w = g.over.ended ? null : g.over.team ? `Team ${g.over.winner + 1}` : name(g.over.winner);
        status = g.over.ended ? `⏹ Game stopped by ${g.over.by}` : g.over.done ? "Finished! Watch the replay 🎬" : `${w} wins! 🏆`;
        if (g.myIndex !== -1) body.push(h("div", { class: "game-actions" }, btn("Play again", () => send("again"), "btn-primary")));
      } else status = g.party ? (v.done ? `${v.done.length}/${g.players.length} sent` : "") : v.turn === g.myIndex ? "Your turn" : v.turn >= 0 ? `${name(v.turn)}’s turn` : "";
    }
    el.replaceChildren(
      h("div", { class: "game-head" }, h("span", { class: "game-emoji", text: g.emoji }), h("b", { text: g.name }), h("span", { class: "game-status" + (g.over ? " over" : ""), text: status })),
      ...body, g.phase !== "lobby" ? logEl(v) : null,
      g.phase !== "over" && (g.isHost || g.myIndex !== -1) ? h("div", { class: "game-actions cg-exit" },
        g.isHost ? sure(g.phase === "lobby" ? "Close the table" : "⏹ End game", () => send("end"), "btn-danger") : null,
        !g.isHost && g.myIndex !== -1 && g.phase === "play" ? sure("🚪 Leave (a bot takes your seat)", () => send("leave")) : null) : null,
      !big && onOpenBig ? h("div", { class: "game-actions" }, btn("⤢ Bigger", () => onOpenBig(g))) : null);
  }
  paint(game);
  return { el, paint };
}
