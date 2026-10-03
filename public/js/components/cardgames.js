// Card games at a table in a chat: Poker, Blackjack, Santase, UNO and Belot.
// The server deals and checks every move; this only shows your view and sends what you do.
import { h, avatar, toast, modal } from "../ui.js";
import { api } from "../api.js";

export const CARD_LIST = [
  ["poker", "♠️", "Poker", "Texas Hold’em for 2–8. Chips, blinds, all in."],
  ["blackjack", "🃏", "Blackjack", "1–7 players against the dealer. Get closest to 21."],
  ["santase", "🂡", "Santase (66)", "Сантасе for 2: marriages, closing, first to 11."],
  ["uno", "🟥", "UNO", "2–8 players. Match colour or number, +2, +4, skip."],
  ["belot", "🎴", "Belot", "Белот for 4 in two teams. Bid, declare, play to 151."],
];

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
        g.isHost && g.players.length < g.max ? btn("🤖 Add a bot", () => send("addbot")) : null,
        g.isHost && g.players.some((p) => p?.bot) ? btn("Remove a bot", () => send("removebot")) : null,
        g.isHost ? btn(g.players.length >= g.min ? "▶ Start" : `Need ${g.min - g.players.length} more — add bots or wait`, () => send("start"), "btn-primary") : null),
      g.isHost && g.players.length < g.min ? h("p", { class: "create-hint", text: "No one to play with? Add bots — they play on their own." }) : null);
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

  // Click twice to be sure
  const sure = (text, action, cls) => {
    const b = btn(text, null, cls);
    let armed = false;
    b.addEventListener("click", () => { if (!armed) { armed = true; b.textContent = "Sure? Click again"; setTimeout(() => { armed = false; b.textContent = text; }, 3000); } else action(); });
    return b;
  };
  const TABLE = { blackjack, uno, poker, santase, belot };
  function paint(next) {
    g = next;
    const v = g.view;
    let status = "", body = [];
    if (g.phase === "lobby") { status = "Waiting for players"; body = [lobby()]; }
    else {
      body = TABLE[g.type](v);
      if (g.over) {
        const w = g.over.ended ? null : g.over.team ? `Team ${g.over.winner + 1}` : name(g.over.winner);
        status = g.over.ended ? `⏹ Game stopped by ${g.over.by}` : `${w} wins! 🏆`;
        if (g.myIndex !== -1) body.push(h("div", { class: "game-actions" }, btn("Play again", () => send("again"), "btn-primary")));
      } else status = v.turn === g.myIndex ? "Your turn" : v.turn >= 0 ? `${name(v.turn)}’s turn` : "";
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
