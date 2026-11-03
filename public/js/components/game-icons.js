// Line icons for the game picker (one per game), in the same style as the rest of the site
const card = (x = 5, y = 3, w = 14, ht = 18) => `<rect x="${x}" y="${y}" width="${w}" height="${ht}" rx="2"/>`;
const dot = (cx, cy, r = 1.2) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`;

const GAME_ICONS = {
  // board games
  chess: '<circle cx="12" cy="6" r="2.6"/><path d="M9.6 9.5h4.8l-1 6.5h-2.8z"/><path d="M7.5 20.5h9M8.5 20.5l1-4.5h5l1 4.5"/>',
  ttt: '<path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17"/><circle cx="12" cy="12" r="1.6"/><path d="m4.8 4.8 2.4 2.4M7.2 4.8 4.8 7.2M16.8 16.8l2.4 2.4M19.2 16.8l-2.4 2.4"/>',
  c4: `<rect x="3" y="4" width="18" height="13.5" rx="2"/><path d="M5 17.5v3M19 17.5v3"/>${[8, 12, 16].map((x) => `<circle cx="${x}" cy="8.7" r="1.5"/><circle cx="${x}" cy="13" r="1.5"/>`).join("")}`,
  reversi: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  gomoku: `<path d="M4 8h16M4 12h16M4 16h16M8 4v16M12 4v16M16 4v16"/><circle cx="12" cy="12" r="2.1" fill="currentColor"/><circle cx="16" cy="8" r="2.1"/><circle cx="8" cy="16" r="2.1" fill="currentColor"/>`,
  dots: `<path d="M5 5h7v7H5z"/>${[5, 12, 19].map((y) => [5, 12, 19].map((x) => dot(x, y)).join("")).join("")}`,
  checkers: '<ellipse cx="12" cy="8.5" rx="7.5" ry="3"/><path d="M4.5 8.5v3.5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V8.5"/><path d="M4.5 12v3.5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V12"/>',
  mancala: `<rect x="2.5" y="6.5" width="19" height="11" rx="5.5"/>${[9, 12, 15].map((x) => `<circle cx="${x}" cy="10" r="1.3"/><circle cx="${x}" cy="14" r="1.3"/>`).join("")}<path d="M5.5 10v4M18.5 10v4"/>`,
  // party games
  drawtell: '<path d="M4 4.5h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z"/><path d="m13.5 20.5 7-7-2-2-7 7v2z"/>',
  drawthis: '<rect x="4" y="3" width="16" height="12" rx="1.5"/><path d="m7.5 11 3-3 2.2 2.2 3.8-3.7"/><path d="M8.5 21 12 15l3.5 6"/>',
  meme: '<circle cx="12" cy="12" r="8.8"/><path d="M7.8 13.6a4.6 4.6 0 0 0 8.4 0z"/><path d="m8 9.3 2 1M16 9.3l-2 1"/>',
  story: '<path d="M3 5.5c3-1.5 6-1.5 9 .6 3-2.1 6-2.1 9-.6v13.6c-3-1.5-6-1.5-9 .6-3-2.1-6-2.1-9-.6z"/><path d="M12 6.1v13.6"/>',
  // card games
  poker: '<path d="M12 3c3.2 3.6 7.2 6.1 7.2 9.6a3.6 3.6 0 0 1-6.2 2.5l.7 4.9h-3.4l.7-4.9a3.6 3.6 0 0 1-6.2-2.5C4.8 9.1 8.8 6.6 12 3z"/>',
  blackjack: '<rect x="3.2" y="5" width="10" height="14.5" rx="1.8" transform="rotate(-9 8.2 12.2)"/><rect x="10.8" y="4.5" width="10" height="14.5" rx="1.8" transform="rotate(7 15.8 11.7)"/><path d="M15.8 9.5v4.4M13.6 11.7H18"/>',
  santase: `${card()}<path d="M8.8 8 10.5 10 12 7.4l1.5 2.6L15.2 8v4H8.8z"/><path d="M9 16h6"/>`,
  uno: '<rect x="6" y="3" width="12" height="18" rx="2.2" transform="rotate(12 12 12)"/><ellipse cx="12" cy="12" rx="3" ry="5.6" transform="rotate(40 12 12)"/>',
  belot: '<rect x="3.6" y="6" width="9" height="13.5" rx="1.6" transform="rotate(-15 8.1 12.7)"/><rect x="7.5" y="4.2" width="9" height="13.5" rx="1.6"/><rect x="11.4" y="6" width="9" height="13.5" rx="1.6" transform="rotate(15 15.9 12.7)"/>',
  dos: '<rect x="2.8" y="5" width="9" height="14" rx="1.6"/><rect x="12.2" y="5" width="9" height="14" rx="1.6"/><circle cx="7.3" cy="12" r="2"/><circle cx="16.7" cy="12" r="2"/>',
  crazy8: `${card()}<circle cx="12" cy="9.4" r="2.2"/><circle cx="12" cy="14.4" r="2.8"/>`,
  gofish: `<path d="M2.8 12c3-4.6 9.2-5.6 13.2-2l4.2-3.1v10.2L16 14c-4 3.6-10.2 2.6-13.2-2z"/>${dot(7.6, 11, 1)}`,
  peter: `${card()}<circle cx="12" cy="9.8" r="2.8"/><path d="M8.4 17a4.2 4.2 0 0 1 7.2 0"/>`,
  hearts: '<path d="M12 20s-7.8-4.7-7.8-10.4A4.4 4.4 0 0 1 12 7.1a4.4 4.4 0 0 1 7.8 2.5C19.8 15.3 12 20 12 20z"/>',
  hilo: '<path d="M8 20V4.5M4 8.5l4-4 4 4M16 4v15.5M12 15.5l4 4 4-4"/>',
  war: '<path d="m5 5 11.5 11.5M19 5 7.5 16.5"/><path d="m14.3 18.7 1.8 1.8 4.4-4.4-1.8-1.8M9.7 18.7l-1.8 1.8-4.4-4.4 1.8-1.8"/>',
  baccarat: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.4"/><path d="M12 3.4v3M12 17.6v3M3.4 12h3M17.6 12h3M5.9 5.9 8 8M16 16l2.1 2.1M18.1 5.9 16 8M8 16l-2.1 2.1"/>',
};

export function gameIcon(type) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = GAME_ICONS[type] || GAME_ICONS.dots;
  return s;
}
