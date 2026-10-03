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

/* ---------- One interface for all games ---------- */
export const GAMES = {
  chess: { name: "Chess", emoji: "♟️", sides: ["w", "b"], start: chessStart, move: chessMove, status: chessStatus },
  ttt: { name: "Tic-tac-toe", emoji: "⭕", sides: ["X", "O"], start: tttStart, move: tttMove, status: tttStatus },
  c4: { name: "Connect four", emoji: "🔴", sides: ["R", "Y"], start: c4Start, move: c4Move, status: c4Status },
};
