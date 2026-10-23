// Stempelkarte: dekorative Inline-SVGs (Blattzweige, Funkel-Sterne, Klemmbrett-Illustration).
// Alle Elemente sind rein dekorativ (aria-hidden) und erben ihre Farben über CSS-Variablen.

const LEAF = 'M0 0C-9-6-11-20-4-32 3-22 4-9 0 0z';

function leaf(x, y, rot, scale, shade) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">`
    + `<path d="${LEAF}" fill="var(--leaf-${shade}, #9d8ae0)"/>`
    + `<path d="M0 0C-1-10-2-20-4-31" fill="none" stroke="var(--leaf-vein, rgba(255,255,255,.55))" stroke-width=".9" stroke-linecap="round"/>`
    + `</g>`;
}

/** Blattzweig; side = "left" | "right" (gespiegelt). */
export function leaves(side = 'left') {
  const flip = side === 'right' ? ' transform="translate(80 0) scale(-1 1)"' : '';
  return `<svg class="deco-leaves deco-leaves-${side === 'right' ? 'right' : 'left'}" viewBox="0 0 80 130" width="80" height="130" aria-hidden="true" focusable="false"><g${flip}>`
    + `<path d="M22 130C20 104 26 74 46 40" fill="none" stroke="var(--leaf-stem, #8a76cf)" stroke-width="1.6" stroke-linecap="round"/>`
    + leaf(46, 42, 28, 1.05, 'a')
    + leaf(36, 64, 62, 1.0, 'b')
    + leaf(33, 70, -38, 0.95, 'a')
    + leaf(27, 92, 70, 0.9, 'c')
    + leaf(25, 98, -48, 0.85, 'b')
    + leaf(22, 118, 64, 0.7, 'c')
    + `</g></svg>`;
}

function star(x, y, r) {
  const k = r * 0.22;
  return `<path d="M${x} ${y - r}C${x + k} ${y - k} ${x + k} ${y - k} ${x + r} ${y}C${x + k} ${y + k} ${x + k} ${y + k} ${x} ${y + r}C${x - k} ${y + k} ${x - k} ${y + k} ${x - r} ${y}C${x - k} ${y - k} ${x - k} ${y - k} ${x} ${y - r}z"/>`;
}

/** Kleine Funkel-Sterne, füllen den Container (absolut positionieren). */
export function sparkles() {
  return `<svg class="deco-sparkles" viewBox="0 0 300 140" preserveAspectRatio="none" aria-hidden="true" focusable="false"><g fill="var(--sparkle, #b9a8f0)">`
    + star(42, 34, 6) + star(52, 86, 7) + star(262, 20, 8) + star(232, 104, 5.5) + star(150, 12, 3.5) + star(284, 76, 3.5)
    + `</g></svg>`;
}

/** Klemmbrett-Illustration für Leerzustände. */
export function emptyClipboard() {
  return `<svg class="deco-clipboard" viewBox="0 0 160 120" width="160" height="120" aria-hidden="true" focusable="false">`
    + `<ellipse cx="80" cy="104" rx="56" ry="10" fill="var(--clip-shadow, #ece7fb)"/>`
    + `<g opacity=".55">${leaf(38, 104, -55, 0.9, 'c')}${leaf(122, 104, 55, 0.9, 'c')}</g>`
    + `<rect x="52" y="22" width="56" height="78" rx="8" fill="var(--clip-board, #d9cff7)" stroke="var(--clip-line, #a796e6)" stroke-width="2.5"/>`
    + `<rect x="59" y="31" width="42" height="62" rx="4" fill="var(--clip-paper, #fff)"/>`
    + `<rect x="66" y="15" width="28" height="12" rx="4" fill="var(--clip-line, #a796e6)"/>`
    + `<circle cx="80" cy="15" r="3.2" fill="var(--clip-paper, #fff)"/>`
    + `<g stroke="var(--clip-line, #a796e6)" stroke-width="3" stroke-linecap="round"><path d="M66 46h28M66 58h28M66 70h18"/></g>`
    + `<g fill="var(--sparkle, #b9a8f0)">${star(36, 40, 6)}${star(126, 30, 7.5)}</g>`
    + `</svg>`;
}
