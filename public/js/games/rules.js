// Game rules shared by the server (which checks every move) and the browser (which shows legal moves).
// Chess, tic-tac-toe and connect four. Every function is pure: it returns a new state.

/* ---------- Chess ---------- */
// Board: 64 squares, index 0 = a8 … 63 = h1. Pieces: "wK", "bQ", … or null.
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
export function chessStart() {
  const board = [];
  for (const ch of START.replace(/\//g, "")) {
    if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) board.push(null);
    else board.push((ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase());
  }
  return { board, turn: "w", castling: "KQkq", ep: null, half: 0, full: 1, last: null };
}
const file = (i) => i % 8, rank = (i) => Math.floor(i / 8);
const on = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const at = (f, r) => r * 8 + f;
export const squareName = (i) => "abcdefgh"[file(i)] + (8 - rank(i));

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function attacked(board, sq, by) {
  const f = file(sq), r = rank(sq);
  const is = (ff, rr, types) => { if (!on(ff, rr)) return false; const p = board[at(ff, rr)]; return p && p[0] === by && types.includes(p[1]); };
  const dir = by === "w" ? 1 : -1; // white pawns attack upwards (towards rank index - 1)
  if (is(f - 1, r + dir, "P") || is(f + 1, r + dir, "P")) return true;
  for (const [df, dr] of KNIGHT) if (is(f + df, r + dr, "N")) return true;
  for (const [df, dr] of KING) if (is(f + df, r + dr, "K")) return true;
  const slide = (dirs, types) => {
    for (const [df, dr] of dirs) {
      let ff = f + df, rr = r + dr;
      while (on(ff, rr)) {
        const p = board[at(ff, rr)];
        if (p) { if (p[0] === by && types.includes(p[1])) return true; break; }
        ff += df; rr += dr;
      }
    }
    return false;
  };
  return slide(ROOK, "RQ") || slide(BISHOP, "BQ");
}
const kingSq = (board, c) => board.findIndex((p) => p === c + "K");
export const inCheck = (s, c = s.turn) => attacked(s.board, kingSq(s.board, c), c === "w" ? "b" : "w");

function pseudo(s) {
  const out = [], { board, turn } = s, foe = turn === "w" ? "b" : "w";
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || p[0] !== turn) continue;
    const f = file(i), r = rank(i), t = p[1];
    const push = (to, extra = {}) => out.push({ from: i, to, ...extra });
    if (t === "P") {
      const dr = turn === "w" ? -1 : 1, startRank = turn === "w" ? 6 : 1, lastRank = turn === "w" ? 0 : 7;
      const addPawn = (to) => { if (rank(to) === lastRank) for (const promo of "QRBN") push(to, { promo }); else push(to); };
      if (on(f, r + dr) && !board[at(f, r + dr)]) {
        addPawn(at(f, r + dr));
        if (r === startRank && !board[at(f, r + 2 * dr)]) push(at(f, r + 2 * dr), { double: true });
      }
      for (const df of [-1, 1]) {
        if (!on(f + df, r + dr)) continue;
        const to = at(f + df, r + dr);
        if (board[to] && board[to][0] === foe) addPawn(to);
        else if (to === s.ep) push(to, { enPassant: true });
      }
    } else if (t === "N" || t === "K") {
      for (const [df, dr] of t === "N" ? KNIGHT : KING) {
        if (!on(f + df, r + dr)) continue;
        const to = at(f + df, r + dr);
        if (!board[to] || board[to][0] === foe) push(to);
      }
      if (t === "K" && !inCheck(s)) {
        const home = turn === "w" ? 60 : 4, [K, Q] = turn === "w" ? ["K", "Q"] : ["k", "q"];
        if (i === home && s.castling.includes(K) && !board[home + 1] && !board[home + 2] && board[home + 3] === turn + "R"
          && !attacked(board, home + 1, foe) && !attacked(board, home + 2, foe)) push(home + 2, { castle: "K" });
        if (i === home && s.castling.includes(Q) && !board[home - 1] && !board[home - 2] && !board[home - 3] && board[home - 4] === turn + "R"
          && !attacked(board, home - 1, foe) && !attacked(board, home - 2, foe)) push(home - 2, { castle: "Q" });
      }
    } else {
      const dirs = t === "R" ? ROOK : t === "B" ? BISHOP : [...ROOK, ...BISHOP];
      for (const [df, dr] of dirs) {
        let ff = f + df, rr = r + dr;
        while (on(ff, rr)) {
          const to = at(ff, rr);
          if (board[to]) { if (board[to][0] === foe) push(to); break; }
          push(to);
          ff += df; rr += dr;
        }
      }
    }
  }
  return out;
}

function applyRaw(s, mv) {
  const board = s.board.slice(), p = board[mv.from], turn = s.turn;
  const captured = board[mv.to] || (mv.enPassant ? board[mv.to + (turn === "w" ? 8 : -8)] : null);
  board[mv.to] = mv.promo ? turn + mv.promo : p;
  board[mv.from] = null;
  if (mv.enPassant) board[mv.to + (turn === "w" ? 8 : -8)] = null;
  if (mv.castle === "K") { board[mv.to - 1] = board[mv.to + 1]; board[mv.to + 1] = null; }
  if (mv.castle === "Q") { board[mv.to + 1] = board[mv.to - 2]; board[mv.to - 2] = null; }
  let castling = s.castling;
  const strip = (chars) => { for (const c of chars) castling = castling.replace(c, ""); };
  if (p[1] === "K") strip(turn === "w" ? "KQ" : "kq");
  for (const [sq, c] of [[63, "K"], [56, "Q"], [7, "k"], [0, "q"]]) if (mv.from === sq || mv.to === sq) strip(c);
  return {
    board, turn: turn === "w" ? "b" : "w", castling,
    ep: mv.double ? (mv.from + mv.to) / 2 : null,
    half: p[1] === "P" || captured ? 0 : s.half + 1,
    full: s.full + (turn === "b" ? 1 : 0),
    last: { from: mv.from, to: mv.to, captured },
  };
}

export function chessMoves(s) {
  return pseudo(s).filter((mv) => !inCheck(applyRaw(s, mv), s.turn));
}
// Returns the new state, or null if the move isn't legal
export function chessMove(s, { from, to, promo }) {
  const mv = chessMoves(s).find((m) => m.from === from && m.to === to && (!m.promo || m.promo === (promo || "Q")));
  return mv ? applyRaw(s, mv) : null;
}
export function chessStatus(s) {
  const moves = chessMoves(s);
  if (!moves.length) return inCheck(s) ? { over: true, result: "checkmate", winner: s.turn === "w" ? "b" : "w" } : { over: true, result: "stalemate", winner: null };
  const left = s.board.filter(Boolean);
  if (left.length === 2 || (left.length === 3 && left.some((p) => p[1] === "B" || p[1] === "N"))) return { over: true, result: "draw (not enough pieces)", winner: null };
  if (s.half >= 100) return { over: true, result: "draw (50 moves)", winner: null };
  return { over: false, check: inCheck(s) };
}

/* ---------- Tic-tac-toe ---------- */
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export const tttStart = () => ({ cells: Array(9).fill(null), turn: "X", last: null });
export function tttMove(s, { cell }) {
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || s.cells[cell]) return null;
  const cells = s.cells.slice(); cells[cell] = s.turn;
  return { cells, turn: s.turn === "X" ? "O" : "X", last: cell };
}
export function tttStatus(s) {
  for (const l of LINES) if (s.cells[l[0]] && l.every((i) => s.cells[i] === s.cells[l[0]])) return { over: true, result: "three in a row", winner: s.cells[l[0]], line: l };
  if (s.cells.every(Boolean)) return { over: true, result: "draw", winner: null };
  return { over: false };
}

/* ---------- Connect four (7 columns × 6 rows, row 0 is the top) ---------- */
export const c4Start = () => ({ cells: Array(42).fill(null), turn: "R", last: null });
export function c4Move(s, { col }) {
  if (!Number.isInteger(col) || col < 0 || col > 6) return null;
  for (let r = 5; r >= 0; r--) {
    const i = r * 7 + col;
    if (!s.cells[i]) { const cells = s.cells.slice(); cells[i] = s.turn; return { cells, turn: s.turn === "R" ? "Y" : "R", last: i }; }
  }
  return null;
}
export function c4Status(s) {
  const get = (r, c) => (r >= 0 && r < 6 && c >= 0 && c < 7 ? s.cells[r * 7 + c] : null);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
    const v = get(r, c);
    if (!v) continue;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const line = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
      if (line.every(([rr, cc]) => get(rr, cc) === v)) return { over: true, result: "four in a row", winner: v, line: line.map(([rr, cc]) => rr * 7 + cc) };
    }
  }
  if (s.cells.every(Boolean)) return { over: true, result: "draw", winner: null };
  return { over: false };
}

/* ---------- Reversi / Othello (8×8, D = dark moves first, L = light) ---------- */
const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
export function reversiStart() { const cells = Array(64).fill(null); cells[27] = "L"; cells[28] = "D"; cells[35] = "D"; cells[36] = "L"; return { cells, turn: "D", last: null, passed: false }; }
function reversiFlips(cells, i, side) {
  if (cells[i]) return [];
  const r0 = Math.floor(i / 8), c0 = i % 8, foe = side === "D" ? "L" : "D", out = [];
  for (const [dr, dc] of DIRS8) {
    const line = [];
    let r = r0 + dr, c = c0 + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && cells[r * 8 + c] === foe) { line.push(r * 8 + c); r += dr; c += dc; }
    if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && cells[r * 8 + c] === side) out.push(...line);
  }
  return out;
}
export const reversiMoves = (s, side = s.turn) => s.cells.map((_, i) => (reversiFlips(s.cells, i, side).length ? i : -1)).filter((i) => i >= 0);
export function reversiMove(s, { cell }) {
  if (!Number.isInteger(cell) || cell < 0 || cell > 63) return null;
  const flips = reversiFlips(s.cells, cell, s.turn);
  if (!flips.length) return null;
  const cells = s.cells.slice(); cells[cell] = s.turn; for (const f of flips) cells[f] = s.turn;
  const other = s.turn === "D" ? "L" : "D";
  const next = { cells, turn: other, last: cell, flipped: flips, passed: false };
  if (!reversiMoves(next, other).length && reversiMoves(next, s.turn).length) { next.turn = s.turn; next.passed = true; } // they can't move: you go again
  return next;
}
export function reversiStatus(s) {
  const d = s.cells.filter((x) => x === "D").length, l = s.cells.filter((x) => x === "L").length;
  if (reversiMoves(s, "D").length || reversiMoves(s, "L").length) return { over: false, score: { D: d, L: l } };
  return { over: true, result: `${d}–${l}`, winner: d > l ? "D" : l > d ? "L" : null, score: { D: d, L: l } };
}

/* ---------- Gomoku: five in a row on a 15×15 board ---------- */
export const gomokuStart = () => ({ cells: Array(225).fill(null), turn: "X", last: null });
export function gomokuMove(s, { cell }) {
  if (!Number.isInteger(cell) || cell < 0 || cell > 224 || s.cells[cell]) return null;
  const cells = s.cells.slice(); cells[cell] = s.turn;
  return { cells, turn: s.turn === "X" ? "O" : "X", last: cell };
}
export function gomokuStatus(s) {
  const get = (r, c) => (r >= 0 && r < 15 && c >= 0 && c < 15 ? s.cells[r * 15 + c] : null);
  if (s.last != null) {
    const r0 = Math.floor(s.last / 15), c0 = s.last % 15, v = s.cells[s.last];
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const line = [[r0, c0]];
      for (const k of [1, -1]) { let r = r0 + dr * k, c = c0 + dc * k; while (get(r, c) === v) { line.push([r, c]); r += dr * k; c += dc * k; } }
      if (line.length >= 5) return { over: true, result: "five in a row", winner: v, line: line.map(([r, c]) => r * 15 + c) };
    }
  }
  if (s.cells.every(Boolean)) return { over: true, result: "draw", winner: null };
  return { over: false };
}

/* ---------- Dots and boxes: 4×4 boxes; finish a box and you go again ---------- */
const DB = 4;
export const dotsStart = () => ({ h: Array((DB + 1) * DB).fill(null), v: Array(DB * (DB + 1)).fill(null), boxes: Array(DB * DB).fill(null), turn: "A", last: null });
const boxDone = (s, b) => { const r = Math.floor(b / DB), c = b % DB; return s.h[r * DB + c] && s.h[(r + 1) * DB + c] && s.v[r * (DB + 1) + c] && s.v[r * (DB + 1) + c + 1]; };
export function dotsMove(s, { kind, i }) {
  const list = kind === "h" ? s.h : kind === "v" ? s.v : null;
  if (!list || !Number.isInteger(i) || i < 0 || i >= list.length || list[i]) return null;
  const next = { h: s.h.slice(), v: s.v.slice(), boxes: s.boxes.slice(), turn: s.turn, last: { kind, i } };
  next[kind][i] = s.turn;
  let made = 0;
  for (let b = 0; b < DB * DB; b++) if (!next.boxes[b] && boxDone(next, b)) { next.boxes[b] = s.turn; made++; }
  if (!made) next.turn = s.turn === "A" ? "B" : "A";
  return next;
}
export function dotsStatus(s) {
  const a = s.boxes.filter((x) => x === "A").length, b = s.boxes.filter((x) => x === "B").length;
  if (s.boxes.every(Boolean)) return { over: true, result: `${a}–${b}`, winner: a > b ? "A" : b > a ? "B" : null, score: { A: a, B: b } };
  return { over: false, score: { A: a, B: b } };
}

/* ---------- Checkers (draughts): r = red (bottom, moves up), k = black; capitals are kings. Captures are a must. ---------- */
export function checkersStart() {
  const cells = Array(64).fill(null);
  for (let i = 0; i < 64; i++) { const r = Math.floor(i / 8), c = i % 8; if ((r + c) % 2) { if (r < 3) cells[i] = "k"; else if (r > 4) cells[i] = "r"; } }
  return { cells, turn: "r", last: null, chain: null, quiet: 0 };
}
const own = (p, side) => p && p.toLowerCase() === side;
function pieceMoves(cells, i, side) {
  const p = cells[i]; if (!own(p, side)) return { steps: [], jumps: [] };
  const r = Math.floor(i / 8), c = i % 8, king = p === p.toUpperCase();
  const dirs = king ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : side === "r" ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
  const steps = [], jumps = [];
  for (const [dr, dc] of dirs) {
    const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc;
    if (r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7) continue;
    const mid = cells[r1 * 8 + c1];
    if (!mid) steps.push(r1 * 8 + c1);
    else if (!own(mid, side) && r2 >= 0 && r2 <= 7 && c2 >= 0 && c2 <= 7 && !cells[r2 * 8 + c2]) jumps.push({ to: r2 * 8 + c2, over: r1 * 8 + c1 });
  }
  return { steps, jumps };
}
export function checkersMoves(s) {
  const side = s.turn, all = [];
  const from = s.chain != null ? [s.chain] : s.cells.map((_, i) => i);
  let anyJump = false;
  for (const i of from) { const m = pieceMoves(s.cells, i, side); if (m.jumps.length) anyJump = true; all.push([i, m]); }
  const out = [];
  for (const [i, m] of all) {
    if (anyJump) for (const j of m.jumps) out.push({ from: i, to: j.to, over: j.over });
    else if (s.chain == null) for (const t of m.steps) out.push({ from: i, to: t });
  }
  return out;
}
export function checkersMove(s, { from, to }) {
  const mv = checkersMoves(s).find((m) => m.from === from && m.to === to);
  if (!mv) return null;
  const cells = s.cells.slice();
  let p = cells[from]; cells[from] = null;
  if (mv.over != null) cells[mv.over] = null;
  const row = Math.floor(to / 8);
  const crowned = p === p.toLowerCase() && ((p === "r" && row === 0) || (p === "k" && row === 7));
  if (crowned) p = p.toUpperCase();
  cells[to] = p;
  const next = { cells, turn: s.turn, last: { from, to, over: mv.over ?? null }, chain: null, quiet: mv.over != null ? 0 : (s.quiet || 0) + 1 };
  // Another jump with the same piece? Then it's still your turn (not after being crowned)
  if (mv.over != null && !crowned && pieceMoves(cells, to, s.turn).jumps.length) next.chain = to;
  else next.turn = s.turn === "r" ? "k" : "r";
  return next;
}
export function checkersStatus(s) {
  if ((s.quiet || 0) >= 80) return { over: true, result: "draw (80 moves without a capture)", winner: null };
  if (!checkersMoves(s).length) { const win = s.turn === "r" ? "k" : "r"; return { over: true, result: "no moves left", winner: win }; }
  return { over: false };
}

/* ---------- Mancala (Kalah): pits 0–5 + store 6 are South, 7–12 + store 13 North; 4 seeds each ---------- */
export const mancalaStart = () => ({ pits: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], turn: "S", last: null });
export function mancalaMove(s, { pit }) {
  const mine = s.turn === "S" ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12], store = s.turn === "S" ? 6 : 13, foeStore = s.turn === "S" ? 13 : 6;
  if (!mine.includes(pit) || !s.pits[pit]) return null;
  const pits = s.pits.slice();
  let seeds = pits[pit], i = pit; pits[pit] = 0;
  while (seeds) { i = (i + 1) % 14; if (i === foeStore) continue; pits[i]++; seeds--; }
  let turn = s.turn === "S" ? "N" : "S";
  if (i === store) turn = s.turn; // last seed in your store: go again
  else if (mine.includes(i) && pits[i] === 1 && pits[12 - i]) { pits[store] += pits[12 - i] + 1; pits[i] = 0; pits[12 - i] = 0; } // capture
  // One side empty: the rest go to their owners and the game ends
  const south = pits.slice(0, 6).reduce((a, b) => a + b, 0), north = pits.slice(7, 13).reduce((a, b) => a + b, 0);
  if (!south || !north) { pits[6] += south; pits[13] += north; for (const k of [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]) pits[k] = 0; }
  return { pits, turn, last: pit };
}
export function mancalaStatus(s) {
  const done = s.pits.slice(0, 6).every((x) => !x) && s.pits.slice(7, 13).every((x) => !x);
  if (!done) return { over: false, score: { S: s.pits[6], N: s.pits[13] } };
  return { over: true, result: `${s.pits[6]}–${s.pits[13]}`, winner: s.pits[6] > s.pits[13] ? "S" : s.pits[13] > s.pits[6] ? "N" : null, score: { S: s.pits[6], N: s.pits[13] } };
}

/* ---------- One interface for all games ---------- */
export const GAMES = {
  chess: { name: "Chess", emoji: "♟️", sides: ["w", "b"], start: chessStart, move: chessMove, status: chessStatus },
  ttt: { name: "Tic-tac-toe", emoji: "⭕", sides: ["X", "O"], start: tttStart, move: tttMove, status: tttStatus },
  c4: { name: "Connect four", emoji: "🔴", sides: ["R", "Y"], start: c4Start, move: c4Move, status: c4Status },
  reversi: { name: "Reversi", emoji: "⚫", desc: "Othello: trap their discs between yours to flip them. Most discs wins.", sides: ["D", "L"], start: reversiStart, move: reversiMove, status: reversiStatus },
  gomoku: { name: "Gomoku", emoji: "⚪", desc: "Five in a row on a big board. Block them while you build yours.", sides: ["X", "O"], start: gomokuStart, move: gomokuMove, status: gomokuStatus },
  dots: { name: "Dots & Boxes", emoji: "🔲", desc: "Draw lines; close a box and you go again. Most boxes wins.", sides: ["A", "B"], start: dotsStart, move: dotsMove, status: dotsStatus },
  checkers: { name: "Checkers", emoji: "🏁", desc: "Draughts: jump their pieces (you must), reach the end to be crowned king.", sides: ["r", "k"], start: checkersStart, move: checkersMove, status: checkersStatus },
  mancala: { name: "Mancala", emoji: "🥣", desc: "Sow the seeds around the board; end in your store to go again. Most seeds wins.", sides: ["S", "N"], start: mancalaStart, move: mancalaMove, status: mancalaStatus },
};
