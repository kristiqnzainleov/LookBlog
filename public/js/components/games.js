// Games inside chats and calls: chess, tic-tac-toe and connect four.
// A game is a message; moves go to the server, which checks them and tells everyone.
import { h, icon, modal, toast, avatar } from "../ui.js";
import { api } from "../api.js";
import { on } from "../state.js";
import { GAMES, chessMoves, inCheck } from "../games/rules.js";
import { cardGameView, CARD_LIST } from "./cardgames.js";

const boards = new Map(); // messageId -> Set of repaint functions
on("game:update", (ev) => {
  const set = boards.get(ev.messageId);
  if (!set) return;
  for (const fn of [...set]) fn(ev.game);
});
function watch(messageId, el, fn) {
  if (!boards.has(messageId)) boards.set(messageId, new Set());
  const set = boards.get(messageId);
  const wrapped = (g) => { if (!el.isConnected) { set.delete(wrapped); return; } fn(g); };
  set.add(wrapped);
}

const GLYPH = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" };
const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const PIECE_NAME = { P: "a pawn", N: "a knight", B: "a bishop", R: "a rook", Q: "the queen", K: "the king" };
// Pieces each player has taken (chess), best first, and who is ahead
function takenRow(g, i) {
  const side = g.sides[i], foe = side === "w" ? "b" : "w";
  const mine = [...(g.captured?.[side] || [])].sort((a, b) => VALUE[b] - VALUE[a]);
  if (!mine.length) return null;
  const score = (list) => list.reduce((n, t) => n + VALUE[t], 0);
  const lead = score(mine) - score(g.captured?.[foe] || []);
  return h("div", { class: "taken" }, ...mine.map((t) => h("span", { class: "pc " + foe, text: GLYPH[t] + "\uFE0E" })), lead > 0 ? h("b", { class: "lead", text: "+" + lead }) : null);
}
const capturedCount = (g) => (g.captured ? g.captured.w.length + g.captured.b.length : 0);
const SIDE_NAME = { w: "White", b: "Black", X: "X", O: "O", R: "Red", Y: "Yellow" };
const who = (g, i) => g.players[i] ? (g.players[i].nickname || g.players[i].name) : "Open seat";

function statusText(g) {
  const s = g.status;
  const sideIdx = (side) => g.sides.indexOf(side);
  if (s.over) {
    if (s.result === "ended") return `⏹ Game stopped by ${g.ended || "the starter"}`;
    if (g.resigned) return `${who(g, sideIdx(s.winner) === 0 ? 1 : 0)} resigned · ${who(g, sideIdx(s.winner))} wins 🏆`;
    if (!s.winner) return s.result === "stalemate" ? "Stalemate · it’s a draw" : `It’s a draw (${s.result.replace(/^draw ?/, "").replace(/[()]/g, "") || "board full"})`;
    return `${s.result === "checkmate" ? "Checkmate! " : ""}${who(g, sideIdx(s.winner))} wins 🏆`;
  }
  if (g.open) return g.myIndex === 0 ? "Waiting for someone to join…" : "Seat open: join to play";
  const turnIdx = sideIdx(g.state.turn);
  const mine = turnIdx === g.myIndex;
  const check = s.check ? "Check! " : "";
  return mine ? `${check}Your turn` : `${check}${who(g, turnIdx)}’s turn`;
}

/* ---------- Boards ---------- */
function chessBoard(g, send, big) {
  const flip = g.myIndex === 1;
  const st = g.state;
  const myTurn = !g.status.over && !g.open && g.sides[g.myIndex] === st.turn;
  const legal = myTurn ? chessMoves(st) : [];
  let picked = null;
  const grid = h("div", { class: "chess" + (big ? " big" : "") });
  const checkSq = inCheck(st) ? st.board.findIndex((p) => p === st.turn + "K") : -1;
  const squares = [];
  function paint() {
    const targets = new Set(picked == null ? [] : legal.filter((m) => m.from === picked).map((m) => m.to));
    squares.forEach((b, i) => {
      b.classList.toggle("picked", i === picked);
      b.classList.toggle("target", targets.has(i));
      b.classList.toggle("capture", targets.has(i) && Boolean(st.board[i]));
    });
  }
  for (let k = 0; k < 64; k++) {
    const i = flip ? 63 - k : k;
    const p = st.board[i];
    const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1;
    const b = h("button", { type: "button", class: "sq" + (dark ? " dark" : " light") + (st.last && (st.last.from === i || st.last.to === i) ? " last" : "") + (i === checkSq ? " check" : ""), "aria-label": "abcdefgh"[i % 8] + (8 - Math.floor(i / 8)) },
      p ? h("span", { class: "pc " + p[0], text: GLYPH[p[1]] + "︎" }) : null);
    // file/rank labels on the edges
    if (k % 8 === 0) b.append(h("i", { class: "rk", text: String(8 - Math.floor(i / 8)) }));
    if (k >= 56) b.append(h("i", { class: "fl", text: "abcdefgh"[i % 8] }));
    b.addEventListener("click", async () => {
      if (!myTurn) return;
      if (picked != null && legal.some((m) => m.from === picked && m.to === i)) {
        const from = picked;
        const promoting = legal.some((m) => m.from === from && m.to === i && m.promo);
        const promo = promoting ? await pickPromotion(st.turn) : undefined;
        if (promoting && !promo) return;
        picked = null; paint();
        send({ from, to: i, promo });
        return;
      }
      picked = p && p[0] === st.turn && legal.some((m) => m.from === i) ? i : null;
      paint();
    });
    squares.push(b);
    grid.append(b);
  }
  return grid;
}
function pickPromotion(color) {
  return new Promise((resolve) => {
    let done = false;
    const row = h("div", { class: "promo-row" }, ..."QRBN".split("").map((t) => {
      const b = h("button", { type: "button", class: "sq light" }, h("span", { class: "pc " + color, text: GLYPH[t] + "︎" }));
      b.addEventListener("click", () => { done = true; m.close(); resolve(t); });
      return b;
    }));
    const m = modal({ title: "Promote to", body: row, onClose: () => { if (!done) resolve(null); } });
  });
}
function tttBoard(g, send, big) {
  const myTurn = !g.status.over && !g.open && g.sides[g.myIndex] === g.state.turn;
  const line = new Set(g.status.line || []);
  return h("div", { class: "ttt" + (big ? " big" : "") }, ...g.state.cells.map((v, i) => {
    const b = h("button", { type: "button", class: "cell" + (v ? " " + v : "") + (line.has(i) ? " win" : "") + (g.state.last === i ? " last" : ""), text: v || "", disabled: !myTurn || Boolean(v) });
    b.addEventListener("click", () => send({ cell: i }));
    return b;
  }));
}
function c4Board(g, send, big) {
  const myTurn = !g.status.over && !g.open && g.sides[g.myIndex] === g.state.turn;
  const line = new Set(g.status.line || []);
  const grid = h("div", { class: "c4" + (big ? " big" : "") + (myTurn ? " live" : "") });
  for (let col = 0; col < 7; col++) {
    const colEl = h("button", { type: "button", class: "c4-col", "aria-label": `Drop in column ${col + 1}`, disabled: !myTurn || Boolean(g.state.cells[col]) });
    for (let r = 0; r < 6; r++) {
      const i = r * 7 + col, v = g.state.cells[i];
      colEl.append(h("span", { class: "disc" + (v ? " " + v : "") + (line.has(i) ? " win" : "") + (g.state.last === i ? " last" : "") }));
    }
    colEl.addEventListener("click", () => send({ col }));
    grid.append(colEl);
  }
  return grid;
}
const BOARD = { chess: chessBoard, ttt: tttBoard, c4: c4Board };

/* ---------- A game (in a message, a window or the call screen) ---------- */
export function gameView(chatId, messageId, game, { big = false, inCall = false } = {}) {
  if (game.card) {
    const t = cardGameView(chatId, messageId, game, { big, onOpenBig: big || inCall ? null : (g) => openGame(chatId, messageId, g) });
    watch(messageId, t.el, t.paint);
    return t.el;
  }
  const el = h("div", { class: "game" + (big ? " big" : "") });
  let g = game, busy = false, popEl = null;
  async function act(path, body) {
    if (busy) return;
    busy = true;
    try { paint((await api(`/api/chats/${chatId}/games/${messageId}/${path}`, { method: "POST", body })).game); }
    catch (err) { toast(err.error || "Couldn’t do that."); }
    busy = false;
  }
  function seat(i) {
    const p = g.players[i];
    const turn = !g.status.over && !g.open && g.state.turn === g.sides[i];
    return h("div", { class: "seat" + (turn ? " turn" : "") + (i === g.myIndex ? " me" : "") },
      p ? avatar(p, 26) : h("span", { class: "seat-empty", text: "?" }),
      h("div", { class: "seat-main" }, h("b", { text: p ? (p.nickname || p.name) + (i === g.myIndex ? " (you)" : "") : "Open seat" }),
        g.type === "chess" ? takenRow(g, i) : null),
      h("span", { class: "side side-" + g.sides[i], text: SIDE_NAME[g.sides[i]] }));
  }
  function paint(next) {
    // A piece was just taken: show it for a moment
    const took = g && next.type === "chess" && capturedCount(next) > capturedCount(g) ? next.state.last?.captured : null;
    g = next;
    const board = BOARD[g.type](g, (move) => act("move", { move }), big);
    const actions = h("div", { class: "game-actions" });
    if (g.open && g.myIndex === -1) actions.append(h("button", { type: "button", class: "btn btn-primary btn-sm", text: "Join game", onclick: () => act("join") }));
    if (!g.status.over && g.myIndex !== -1) {
      // The one who started can stop the game; the other player can only leave (= resign)
      const twice = (label, path, cls) => {
        const b = h("button", { type: "button", class: "btn btn-xs " + cls, text: label });
        let armed = false;
        b.addEventListener("click", () => { if (!armed) { armed = true; b.textContent = "Sure? Click again"; setTimeout(() => { armed = false; b.textContent = label; }, 3000); } else act(path); });
        return b;
      };
      if (!g.open) actions.append(twice(g.isStarter ? "Resign" : "🚪 Leave", "resign", "btn-outline-light"));
      if (g.isStarter) actions.append(twice("⏹ End game", "end", "btn-danger"));
    }
    if (!big && !inCall) actions.append(h("button", { type: "button", class: "btn btn-xs btn-outline-light", onclick: () => openGame(chatId, messageId, g) }, icon("expand"), h("span", { text: "Bigger" })));
    const top = g.myIndex === 1 ? 0 : 1, bottom = 1 - top;
    el.replaceChildren(
      h("div", { class: "game-head" }, h("span", { class: "game-emoji", text: g.emoji }), h("b", { text: g.name }), h("span", { class: "game-status" + (g.status.over ? " over" : ""), text: statusText(g) })),
      seat(top), h("div", { class: "board-wrap" }, board), seat(bottom), actions);
    if (took) {
      const byIdx = g.sides.indexOf(took[0] === "w" ? "b" : "w");
      const who = byIdx === g.myIndex ? "You" : g.players[byIdx] ? (g.players[byIdx].nickname || g.players[byIdx].name) : "They";
      const pop = h("div", { class: "capture-pop" }, h("span", { class: "pc " + took[0], text: GLYPH[took[1]] + "\uFE0E" }), h("b", { text: `${who} took ${PIECE_NAME[took[1]]}!` }));
      popEl = pop;
      setTimeout(() => pop.classList.add("out"), 1500);
      setTimeout(() => { pop.remove(); if (popEl === pop) popEl = null; }, 1900);
    }
    // Keep the pop-up on screen if the board repaints while it shows
    if (popEl) el.querySelector(".board-wrap").append(popEl);
  }
  paint(game);
  watch(messageId, el, paint);
  return el;
}

export function openGame(chatId, messageId, game) {
  const m = modal({ title: `${game.emoji} ${game.name}`, body: gameView(chatId, messageId, game, { big: true }) });
  return m;
}

// Pick a game and start it in this chat (and channel)
export function openGamePicker(chat, { channelId = null, onStarted } = {}) {
  const list = h("div", { class: "game-pick" }, ...Object.entries(GAMES).map(([type, def]) => {
    const b = h("button", { type: "button", class: "game-option" },
      h("span", { class: "go-emoji", text: def.emoji }), h("b", { text: def.name }),
      h("span", { class: "muted", text: type === "chess" ? "The classic. Checkmate wins." : type === "ttt" ? "Three in a row. Quick!" : "Drop discs, get four in a line." }));
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const { message } = await api(`/api/chats/${chat.id}/games`, { method: "POST", body: { type, channelId } });
        m.close();
        onStarted?.(message);
      } catch (err) { toast(err.error || "Couldn’t start the game."); b.disabled = false; }
    });
    return b;
  }));
  const start = async (type, b) => {
    b.disabled = true;
    try {
      const { message } = await api(`/api/chats/${chat.id}/games`, { method: "POST", body: { type, channelId } });
      m.close();
      onStarted?.(message);
    } catch (err) { toast(err.error || "Couldn’t start the game."); b.disabled = false; }
  };
  const cards = h("div", { class: "game-pick" }, ...CARD_LIST.map(([type, emoji, name, desc]) => {
    const b = h("button", { type: "button", class: "game-option" }, h("span", { class: "go-emoji", text: emoji }), h("b", { text: name }), h("span", { class: "muted", text: desc }));
    b.addEventListener("click", () => start(type, b));
    return b;
  }));
  const m = modal({ title: "Play a game", wide: true, body: h("div", {}, h("p", { class: "create-hint", text: chat.kind === "dm" ? "You play against each other right here in the chat." : "Anyone in the channel can take the second seat." }), list,
    h("h3", { class: "side-title", text: "🃏 Card games" }), h("p", { class: "create-hint", text: "Open a table — people join, then you press Start." }), cards) });
}
