// ⚡ Strom-Tycoon – 🗺️ Weltkarte: Ozean unten → Abendhimmel → Weltall oben. Eigene Datei: Karte (Agent „Karte“).
// Vertrag: export mapHTML(g, { opt, badges }), worldTop(wi), MAP_H; Knöpfe mit data-a = goto|unlock|lockinfo|view(data-v)|rad|relics|evsoon|findme.
// Aufbau: ein statisches SVG (Meer, Inseln, Gebäude – ohne Animation, ohne Filter = leicht),
// darüber ein kleines Effekt-SVG (Schaum, Wellen-Glitzer, Sterne, Strom im Kabel) und HTML-Knöpfe/Wolken/Möwen.
import * as T from "../tycoon-core.js";
import { esc } from "../util.js";

/* ---------- Grundlagen ---------- */
export const MAP_H = 1850;
const MW = 400;
const HORIZON = 760; // Scheitel der Meeres-Kante (Meer ist eine gewölbte Planeten-Oberfläche)
function rng(seed) { let x = seed >>> 0 || 7; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const n1 = (v) => Math.round(v * 10) / 10;
const pt = ([x, y]) => `${n1(x)} ${n1(y)}`;
/** Organische Küstenlinie (Buchten + Landzungen) als Punktliste. */
function coast(cx, cy, rx, ry, seed, n = 18, j = 0.2) {
  const r = rng(seed), p1 = r() * 6.28, p2 = r() * 6.28, a1 = 2 + Math.floor(r() * 2), a2 = 4 + Math.floor(r() * 3);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, k = 0.94 + j * (0.5 * Math.sin(a * a1 + p1) + 0.3 * Math.sin(a * a2 + p2) + (r() - 0.5) * 0.6);
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
  });
}
/** Geschlossene, weiche Kurve durch die Punkte (Catmull-Rom → Bézier). */
function smooth(p) {
  const n = p.length; let d = `M${pt(p[0])}`;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n], e = p[(i + 2) % n];
    d += `C${pt([b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6])} ${pt([c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6])} ${pt(c)}`;
  }
  return d + "Z";
}
const sc = (p, cx, cy, s, dx = 0, dy = 0) => p.map(([x, y]) => [cx + (x - cx) * s + dx, cy + (y - cy) * s + dy]);
const LINE = "#1f2a44";

/* ---------- Bausteine (defs) ---------- */
const DEFS = `<defs>
  <linearGradient id="wmSpace" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#060a22"/><stop offset=".35" stop-color="#0f1640"/><stop offset=".72" stop-color="#2b2170"/><stop offset=".9" stop-color="#6d3fa0"/><stop offset="1" stop-color="#e58bb0"/></linearGradient>
  <linearGradient id="wmSea" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#173f9c"/><stop offset=".18" stop-color="#1c5fc4"/><stop offset=".55" stop-color="#1f86dc"/><stop offset="1" stop-color="#2bb8e8"/></linearGradient>
  <radialGradient id="wmShallow"><stop offset=".55" stop-color="#7ef0e6" stop-opacity=".95"/><stop offset=".8" stop-color="#4fd8e6" stop-opacity=".55"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>
  <linearGradient id="wmBeam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fef9c3" stop-opacity=".9"/><stop offset="1" stop-color="#fef9c3" stop-opacity="0"/></linearGradient>
  <radialGradient id="wmGlow"><stop offset="0" stop-color="#c4b5fd" stop-opacity=".55"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>
  <radialGradient id="wmNebA"><stop offset="0" stop-color="#f472b6" stop-opacity=".55"/><stop offset="1" stop-color="#f472b6" stop-opacity="0"/></radialGradient>
  <radialGradient id="wmNebB"><stop offset="0" stop-color="#22d3ee" stop-opacity=".4"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
  <radialGradient id="wmNebC"><stop offset="0" stop-color="#a78bfa" stop-opacity=".55"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/></radialGradient>
  <radialGradient id="wmPlanet" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#f0abfc"/><stop offset=".45" stop-color="#a855f7"/><stop offset="1" stop-color="#3b0764"/></radialGradient>
  <radialGradient id="wmDome" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ecfeff"/><stop offset=".5" stop-color="#a5f3fc" stop-opacity=".9"/><stop offset="1" stop-color="#0891b2" stop-opacity=".85"/></radialGradient>
  <radialGradient id="wmGold" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff7c2"/><stop offset=".5" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/></radialGradient>
  <linearGradient id="wmGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#2563eb"/></linearGradient>
  <linearGradient id="wmGlass2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#0f766e"/></linearGradient>
  <pattern id="wmWin" width="5" height="6" patternUnits="userSpaceOnUse"><rect x="1" y="1.2" width="2.6" height="3" rx=".4" fill="#fef9c3" opacity=".9"/></pattern>
  <pattern id="wmWinD" width="5" height="6" patternUnits="userSpaceOnUse"><rect x="1" y="1.2" width="2.6" height="3" rx=".4" fill="#0f172a" opacity=".35"/></pattern>
  <pattern id="wmAwn" width="6" height="10" patternUnits="userSpaceOnUse"><rect width="3" height="10" fill="#ef4444"/><rect x="3" width="3" height="10" fill="#fff"/></pattern>
  <pattern id="wmScaf" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 0H7M0 0V7M0 7L7 0" stroke="#7c5a2e" stroke-width=".9" fill="none"/></pattern>
  <pattern id="wmRows" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 2H4" stroke="#14532d" stroke-width="1.1" opacity=".55"/></pattern>
  <g id="wmTree"><ellipse cy="1.5" rx="7.5" ry="2.6" fill="#0b2a12" opacity=".28"/><rect x="-1.5" y="-6" width="3" height="8" rx="1" fill="#7c4a1e" stroke="${LINE}" stroke-width="1.1"/>
    <g fill="currentColor" stroke="${LINE}" stroke-width="2.2"><circle cx="-4" cy="-9" r="4.8"/><circle cx="4" cy="-9" r="4.8"/><circle cy="-13.5" r="5.4"/></g>
    <g fill="currentColor"><circle cx="-4" cy="-9" r="4.8"/><circle cx="4" cy="-9" r="4.8"/><circle cy="-13.5" r="5.4"/></g>
    <circle cx="-2" cy="-15" r="2.4" fill="#fff" opacity=".28"/><circle cx="-5" cy="-10" r="1.6" fill="#fff" opacity=".2"/></g>
  <g id="wmPine"><ellipse cy="1.5" rx="6" ry="2.2" fill="#0b2a12" opacity=".28"/><rect x="-1.2" y="-4" width="2.4" height="5" fill="#6b3f17" stroke="${LINE}" stroke-width="1"/>
    <path d="M0 -21L7 -10H3.5L8 -3H-8L-3.5 -10H-7Z" fill="currentColor" stroke="${LINE}" stroke-width="1.8" stroke-linejoin="round"/><path d="M0 -21L-3.5 -10H-1L-4 -4" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1.4"/></g>
  <g id="wmPalm"><ellipse cx="2" cy="1.5" rx="7" ry="2.2" fill="#0b2a12" opacity=".25"/><path d="M0 0C1 -6 3 -11 2 -17" fill="none" stroke="${LINE}" stroke-width="4" stroke-linecap="round"/><path d="M0 0C1 -6 3 -11 2 -17" fill="none" stroke="#a16207" stroke-width="2.2" stroke-linecap="round"/>
    <g fill="#22c55e" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"><path d="M2 -17Q-6 -21 -11 -13Q-4 -17 2 -17Z"/><path d="M2 -17Q10 -22 14 -13Q7 -17 2 -17Z"/><path d="M2 -17Q-3 -26 -9 -24Q-2 -22 2 -17Z"/><path d="M2 -17Q8 -27 13 -22Q6 -21 2 -17Z"/></g><circle cx="2" cy="-16" r="1.8" fill="#78350f"/></g>
  <g id="wmBush"><g fill="currentColor" stroke="${LINE}" stroke-width="1.6"><circle cx="-3" r="3.4"/><circle cx="3" r="3.4"/><circle cy="-2.5" r="3.6"/></g><g fill="currentColor"><circle cx="-3" r="3.4"/><circle cx="3" r="3.4"/><circle cy="-2.5" r="3.6"/></g><circle cx="-1" cy="-4" r="1.3" fill="#fff" opacity=".3"/></g>
  <g id="wmRock"><path d="M-7 1L-5 -4L-1 -6L4 -5L7 0Z" fill="#94a3b8" stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"/><path d="M-5 -4L-1 -6L1 -2Z" fill="#e2e8f0"/></g>
  <g id="wmFlower"><circle r="1.4" fill="#f472b6"/><circle cx="3" cy="1" r="1.2" fill="#fde047"/><circle cx="-2.5" cy="1.5" r="1.2" fill="#fff"/></g>
  <g id="wmFogC" transform="translate(-60 -40)"><path d="M18 46c-10 0-14-12-5-17c-2-11 12-17 20-10c4-12 22-14 28-3c8-8 24-4 24 8c11-1 16 13 7 19c2 8-6 12-12 10H24c-4 0-6-3-6-7Z" fill="#f8fafc" stroke="#94a3b8" stroke-width="2.5"/><path d="M20 47h66c6 2 12-2 10-8c-4 6-10 4-14 4c-10 3-24 3-34 0c-8 2-20 2-28 4Z" fill="#cbd5e1"/><circle cx="44" cy="22" r="6" fill="#fff"/></g>
  <g id="wmCone"><path d="M-3 0L0 -8L3 0Z" fill="#f97316" stroke="${LINE}" stroke-width="1.1" stroke-linejoin="round"/><path d="M-1.6 -3.6H1.6" stroke="#fff" stroke-width="1.3"/><rect x="-4" y="-.5" width="8" height="1.6" rx=".6" fill="#ea580c" stroke="${LINE}" stroke-width=".8"/></g>
</defs>`;
const use = (id, x, y, s = 1, color) => `<use href="#${id}" transform="translate(${n1(x)} ${n1(y)}) scale(${s})"${color ? ` style="color:${color}"` : ""}/>`;

/** Kleines Iso-Haus mit Satteldach. (x,y) = Mitte unten. */
function house(x, y, w = 14, h = 10, wall = "#fef3c7", roof = "#dc2626") {
  const d = w * 0.55, X = x - w / 2, rt = y - h - h * 0.75;
  return `<g stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round">
    <ellipse cx="${n1(x + d / 2)}" cy="${n1(y + 1)}" rx="${n1(w * 0.8)}" ry="${n1(w * 0.22)}" fill="#0b2a12" opacity=".25" stroke="none"/>
    <path d="M${pt([x + w / 2, y])}L${pt([x + w / 2 + d, y - d * 0.5])}V${n1(y - h - d * 0.5)}L${pt([x + w / 2, y - h])}Z" fill="${wall}" style="filter:brightness(.8)"/>
    <path d="M${pt([X, y])}H${n1(x + w / 2)}V${n1(y - h)}L${pt([x, rt])}L${pt([X, y - h])}Z" fill="${wall}"/>
    <path d="M${pt([x, rt])}L${pt([x + d, rt - d * 0.5])}L${pt([x + w / 2 + d + 1.5, y - h - d * 0.5 + 0.8])}L${pt([x + w / 2 + 1.5, y - h + 0.8])}Z" fill="${roof}"/>
    <path d="M${pt([X - 1.5, y - h + 0.8])}L${pt([x, rt])}L${pt([x + w / 2 + 1.5, y - h + 0.8])}" fill="none" stroke-width="2.2"/>
    <rect x="${n1(x - 2)}" y="${n1(y - 5.5)}" width="4" height="5.5" rx=".6" fill="#7c2d12"/>
    <rect x="${n1(x + w / 2 + d * 0.3)}" y="${n1(y - h * 0.7 - d * 0.2)}" width="${n1(d * 0.4)}" height="3" fill="#bae6fd" stroke-width="1"/>
  </g>`;
}
/** Iso-Quader (Hochhaus …). (x,y) = vordere linke Ecke unten. */
function box(x, y, w, h, d, front, side, top, win) {
  return `<g stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round">
    <path d="M${pt([x + w, y])}L${pt([x + w + d, y - d / 2])}V${n1(y - h - d / 2)}L${pt([x + w, y - h])}Z" fill="${side}"/>
    <rect x="${x}" y="${n1(y - h)}" width="${w}" height="${h}" fill="${front}"/>
    <path d="M${pt([x, y - h])}L${pt([x + d, y - h - d / 2])}H${n1(x + w + d)}L${pt([x + w, y - h])}Z" fill="${top}"/>
    ${win ? `<rect x="${x + 1}" y="${n1(y - h + 2)}" width="${w - 2}" height="${n1(h - 4)}" fill="url(#${win})" stroke="none"/>` : ""}
  </g>`;
}
/** Bäume & Co. zufällig in eine Ellipse streuen (nicht in Sperrzonen), nach y sortiert. */
function scatter(cx, cy, rx, ry, seed, count, avoid = [], kinds = [["wmTree", "#16a34a"]]) {
  const r = rng(seed), out = [];
  for (let t = 0; out.length < count && t < count * 30; t++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()), x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d;
    if (avoid.some(([ax, ay, ar, ary = ar]) => ((x - ax) / ar) ** 2 + ((y - ay) / ary) ** 2 < 1)) continue;
    if (out.some((o) => Math.hypot(o[0] - x, (o[1] - y) * 1.4) < 10)) continue;
    out.push([x, y, kinds[Math.floor(r() * kinds.length)], 0.75 + r() * 0.4]);
  }
  return out.sort((a, b) => a[1] - b[1]).map(([x, y, [id, c], s]) => use(id, x, y, s, c)).join("");
}

/** Die Insel selbst: Schatten, Flachwasser, Klippe, Sandrand, Wiese mit Lichtkante, Regionen. */
function land(cx, cy, rx, ry, seed, pal, { n = 18, j = 0.2, inner = 0.84, regions = 3 } = {}) {
  const p = coast(cx, cy, rx, ry, seed, n, j), r = rng(seed * 5 + 1);
  const P = (s, dx = 0, dy = 0) => smooth(sc(p, cx, cy, s, dx, dy));
  const reg = Array.from({ length: regions }, (_, i) => {
    const a = r() * 6.28, q = coast(cx + Math.cos(a) * rx * 0.32, cy + Math.sin(a) * ry * 0.28 - 4, rx * (0.22 + r() * 0.12), ry * (0.2 + r() * 0.1), seed * 9 + i, 10, 0.25);
    return `<path d="${smooth(q)}" fill="${i % 2 ? pal.grassL : pal.grassD}" opacity="${i % 2 ? 0.7 : 0.45}"/>`;
  }).join("");
  return `<path d="${P(1.36, 0, 12)}" fill="#062a66" opacity=".22"/>
    <path d="${P(1.3, 0, 5)}" fill="url(#wmShallow)"/>
    <path d="${P(1.0, 0, 9)}" fill="${pal.cliff}" stroke="${LINE}" stroke-width="3" stroke-linejoin="round"/>
    <path d="${P(1.0)}" fill="${pal.sand}" stroke="${LINE}" stroke-width="3" stroke-linejoin="round"/>
    <path d="${P(0.95, 0, 1)}" fill="none" stroke="${pal.sandD}" stroke-width="2" opacity=".6"/>
    <path d="${P(inner, 0, -4)}" fill="${pal.grassL}" stroke="${pal.edge}" stroke-width="2"/>
    <path d="${P(inner - 0.02, 0, -1.5)}" fill="${pal.grass}"/>
    ${reg}`;
}
const PAL = {
  green: { sand: "#fde3a1", sandD: "#e0b866", cliff: "#b7793a", grass: "#5fc04a", grassL: "#8fe06a", grassD: "#3a9534", edge: "#2d7a2a" },
  dirt: { sand: "#fbd99a", sandD: "#d9a85e", cliff: "#8a5528", grass: "#d09454", grassL: "#e9b878", grassD: "#a5692f", edge: "#8a5528" },
  city: { sand: "#fde3a1", sandD: "#e0b866", cliff: "#9a6a3a", grass: "#56b25a", grassL: "#86d27a", grassD: "#2f8a3e", edge: "#2b6e33" },
  isle: { sand: "#fde7ad", sandD: "#e3bd6b", cliff: "#b7793a", grass: "#63c74d", grassL: "#97e36f", grassD: "#3a9534", edge: "#2d7a2a" },
};

/* ---------- Welten ---------- */
// x, y, rx, ry, Abstand Schild (unter Mitte), Abstand Pin (über Mitte)
const W = [
  { x: 240, y: 1640, rx: 122, ry: 88, lab: 70, pin: -92 },
  { x: 128, y: 1365, rx: 108, ry: 80, lab: 62, pin: -98 },
  { x: 262, y: 1000, rx: 116, ry: 84, lab: 64, pin: -112 },
  { x: 138, y: 560, rx: 104, ry: 66, lab: 92, pin: -96 },
  { x: 250, y: 228, rx: 96, ry: 96, lab: 92, pin: -112 },
];
function garage({ x, y, rx, ry }) {
  const P = PAL.green, gx = x - 12, gy = y - 6;
  return `${land(x, y, rx, ry, 31, P)}
    <path d="M${x - 70} ${y + 30}Q${x - 30} ${y + 10} ${gx} ${gy + 4}" fill="none" stroke="#7c5a2e" stroke-width="9" stroke-linecap="round" opacity=".5"/>
    <path d="M${x - 70} ${y + 30}Q${x - 30} ${y + 10} ${gx} ${gy + 4}" fill="none" stroke="#e7cf9b" stroke-width="6" stroke-linecap="round"/>
    <path d="M${x + 58} ${y - 30}Q${x + 80} ${y + 2} ${x + 104} ${y + 22}" fill="none" stroke="${LINE}" stroke-width="8" stroke-linecap="round"/>
    <path d="M${x + 58} ${y - 30}Q${x + 80} ${y + 2} ${x + 104} ${y + 22}" fill="none" stroke="#38bdf8" stroke-width="5" stroke-linecap="round"/>
    <path d="M${x + 60} ${y - 27}Q${x + 78} ${y} ${x + 98} ${y + 16}" fill="none" stroke="#e0f2fe" stroke-width="1.4" stroke-dasharray="4 6" stroke-linecap="round"/>
    <ellipse cx="${x + 54}" cy="${y - 34}" rx="15" ry="9" fill="#38bdf8" stroke="${LINE}" stroke-width="2"/><ellipse cx="${x + 50}" cy="${y - 36}" rx="7" ry="3" fill="#bae6fd"/>
    <circle cx="${x + 59}" cy="${y - 31}" r="2.4" fill="#4ade80" stroke="${LINE}" stroke-width=".8"/>
    <g transform="translate(${x - 74} ${y - 22})"><rect x="-14" y="-9" width="28" height="18" rx="2" fill="#7c4a1e" stroke="${LINE}" stroke-width="1.6"/><rect x="-12" y="-7" width="24" height="14" fill="url(#wmRows)"/><rect x="-12" y="-7" width="24" height="14" fill="#65a30d" opacity=".25"/></g>
    <path d="M${x + 18} ${y + 22}h44" stroke="#fff" stroke-width="2"/><path d="M${x + 20} ${y + 18}v8M${x + 28} ${y + 18}v8M${x + 36} ${y + 18}v8M${x + 44} ${y + 18}v8M${x + 52} ${y + 18}v8M${x + 60} ${y + 18}v8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    ${scatter(x, y - 6, rx * 0.72, ry * 0.6, 77, 13, [[gx + 6, gy - 10, 40, 30], [x + 54, y - 34, 22, 14], [x - 74, y - 22, 20, 14], [x - 5, y + 50, 50, 22], [x + 40, y + 20, 26, 10]], [["wmTree", "#22a447"], ["wmTree", "#3fb950"], ["wmPine", "#15803d"], ["wmBush", "#4cc35a"]])}
    ${house(x + 26, y - 40, 13, 9, "#fde68a", "#2563eb")}${house(x - 52, y - 46, 13, 9, "#fef3c7", "#dc2626")}${house(x + 74, y + 2, 12, 8, "#fff", "#ea580c")}
    <g stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round">
      <ellipse cx="${gx + 10}" cy="${gy + 3}" rx="36" ry="8" fill="#0b2a12" opacity=".25" stroke="none"/>
      <path d="M${gx + 18} ${gy}l16 -8v-26l-16 8Z" fill="#c9a77a"/>
      <rect x="${gx - 20}" y="${gy - 26}" width="38" height="26" fill="#f3dfb8"/>
      <path d="M${gx - 23} ${gy - 25}L${gx - 2} ${gy - 40}L${gx + 21} ${gy - 25}Z" fill="#8b4513"/>
      <path d="M${gx - 2} ${gy - 40}l16 -8l20 15l-15 8Z" fill="#6b3410"/>
      <rect x="${gx - 14}" y="${gy - 19}" width="24" height="19" fill="#9ca3af"/>
      <path d="M${gx - 14} ${gy - 15}h24M${gx - 14} ${gy - 11}h24M${gx - 14} ${gy - 7}h24M${gx - 14} ${gy - 3}h24" stroke-width=".9" opacity=".7"/>
      <rect x="${gx - 9}" y="${gy - 36}" width="14" height="9" rx="2" fill="#fde047"/>
      <path d="M${gx - 1} ${gy - 35}l-4 4h3l-2 4l5 -5h-3l2 -3Z" fill="#f97316" stroke-width=".8"/>
      <path d="M${gx + 30} ${gy - 30}v-16" stroke-width="2.4"/><path d="M${gx + 25} ${gy - 44}h10" stroke-width="2"/>
    </g>
    <path d="M${gx + 30} ${gy - 44}Q${gx + 48} ${gy - 36} ${x + 26} ${y - 52}" fill="none" stroke="${LINE}" stroke-width="1" opacity=".7"/>
    <g transform="translate(${x + 98} ${y + 46}) rotate(-22)"><rect x="-4" y="-3" width="26" height="6" fill="#a16207" stroke="${LINE}" stroke-width="1.4"/><path d="M2 -3v6M8 -3v6M14 -3v6" stroke="${LINE}" stroke-width=".8"/></g>`;
}
function baustelle({ x, y, rx, ry }) {
  const P = PAL.dirt, cx = x + 28, cy = y - 8;
  return `${land(x, y, rx, ry, 52, P, { j: 0.24 })}
    <path d="M${x - 60} ${y + 10}h70" stroke="#8a5528" stroke-width="7" stroke-linecap="round" opacity=".45"/>
    <path d="M${x - 75} ${y - 20}l14 -14l14 14Z" fill="#e9b878" stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"/><path d="M${x - 61} ${y - 34}l-6 8" stroke="#fff" stroke-opacity=".4" stroke-width="2"/>
    <path d="M${x - 58} ${y - 18}l10 -10l10 10Z" fill="#d6a565" stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"/>
    ${scatter(x, y, rx * 0.72, ry * 0.6, 91, 8, [[x - 5, y - 20, 60, 34], [x - 62, y - 22, 26, 16], [x, y + 46, 52, 20]], [["wmPine", "#3f8f2f"], ["wmBush", "#6aa84f"], ["wmRock"]])}
    ${box(x - 40, y + 8, 36, 30, 16, "#cbd5e1", "#94a3b8", "#e2e8f0", "wmWinD")}
    <rect x="${x - 44}" y="${y - 34}" width="44" height="44" fill="url(#wmScaf)" opacity=".95"/>
    <path d="M${x - 44} ${y - 34}h44v44M${x - 44} ${y - 12}h44" fill="none" stroke="#7c5a2e" stroke-width="1.6"/>
    ${box(x - 40, y - 22, 20, 14, 10, "#e2e8f0", "#94a3b8", "#f1f5f9")}
    <g stroke="${LINE}" stroke-linejoin="round">
      <ellipse cx="${cx}" cy="${cy + 2}" rx="12" ry="4" fill="#3b2410" opacity=".3" stroke="none"/>
      <rect x="${cx - 6}" y="${cy - 4}" width="12" height="6" fill="#64748b" stroke-width="1.4"/>
      <rect x="${cx - 3}" y="${cy - 84}" width="6" height="80" fill="#facc15" stroke-width="1.6"/>
      <path d="M${cx - 3} ${cy - 84}l6 8l-6 8l6 8l-6 8l6 8l-6 8l6 8l-6 8l6 8" fill="none" stroke="#a16207" stroke-width="1"/>
      <path d="M${cx - 28} ${cy - 86}h86v-5h-86Z" fill="#facc15" stroke-width="1.6"/>
      <path d="M${cx - 26} ${cy - 88}h82" stroke="#a16207" stroke-width=".8" stroke-dasharray="3 3"/>
      <rect x="${cx - 30}" y="${cy - 92}" width="12" height="10" fill="#475569" stroke-width="1.4"/>
      <path d="M${cx - 3} ${cy - 91}l3 -12l3 12" fill="none" stroke-width="1.6"/><path d="M${cx} ${cy - 103}L${cx - 24} ${cy - 91}M${cx} ${cy - 103}L${cx + 50} ${cy - 91}" stroke-width=".9"/>
      <rect x="${cx + 4}" y="${cy - 86}" width="9" height="8" fill="#38bdf8" stroke-width="1.4"/>
      <path d="M${cx + 46} ${cy - 86}v34" stroke-width=".9"/><path d="M${cx + 43} ${cy - 52}h6v5h-6Z" fill="#ef4444" stroke-width="1"/>
      <rect x="${cx + 38}" y="${cy - 47}" width="20" height="5" fill="#94a3b8" stroke-width="1.2"/>
    </g>
    <g transform="translate(${x + 56} ${y + 22})" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round">
      <ellipse cy="3" rx="16" ry="3.5" fill="#3b2410" opacity=".3" stroke="none"/>
      <rect x="-12" y="-3" width="22" height="6" rx="3" fill="#334155"/><rect x="-9" y="-12" width="14" height="9" fill="#f59e0b"/><rect x="-7" y="-19" width="8" height="7" fill="#bae6fd"/>
      <path d="M5 -10l12 -10l6 8" fill="none" stroke-width="3.4"/><path d="M5 -10l12 -10l6 8" fill="none" stroke="#f59e0b" stroke-width="1.8"/><path d="M20 -13l6 2l-2 5l-6 -1Z" fill="#64748b"/>
    </g>
    ${use("wmCone", x - 14, y + 32)}${use("wmCone", x - 4, y + 34)}${use("wmCone", x + 6, y + 32)}
    <path d="M${x - 70} ${y + 30}h26M${x - 70} ${y + 30}v-7M${x - 44} ${y + 30}v-7" stroke="${LINE}" stroke-width="1.4"/><path d="M${x - 70} ${y + 25}h26" stroke="#ef4444" stroke-width="3" stroke-dasharray="4 3"/>`;
}
function stadt({ x, y, rx, ry }) {
  const P = PAL.city, r = rng(404);
  const blocks = [];
  const spots = [[-58, -2, 13, 30], [-42, -18, 12, 46], [-24, 4, 14, 34], [-24, -30, 12, 60], [-6, -14, 14, 82], [12, -30, 12, 52], [12, 6, 14, 40], [30, -12, 12, 58], [46, 2, 13, 34], [50, -26, 11, 28]];
  spots.sort((a, b) => a[1] - b[1]).forEach(([dx, dy, w, h], i) => {
    const fr = i % 3 === 0 ? "url(#wmGlass)" : i % 3 === 1 ? "#e2e8f0" : "url(#wmGlass2)", sd = i % 3 === 0 ? "#1e40af" : i % 3 === 1 ? "#94a3b8" : "#115e59", tp = i % 3 === 1 ? "#f8fafc" : "#bfdbfe";
    blocks.push(box(x + dx, y + dy + 14, w, h * 0.8 + r() * 6, w * 0.55, fr, sd, tp, i % 3 === 1 ? "wmWinD" : "wmWin"));
  });
  const tallX = x - 6, tallTop = y - 14 + 14 - (82 * 0.8) - 6;
  return `${land(x, y, rx, ry, 77, P)}
    <path d="M${x - 92} ${y - 30}Q${x - 40} ${y - 10} ${x - 30} ${y + 40}T${x + 20} ${y + 76}" fill="none" stroke="${LINE}" stroke-width="9" stroke-linecap="round"/>
    <path d="M${x - 92} ${y - 30}Q${x - 40} ${y - 10} ${x - 30} ${y + 40}T${x + 20} ${y + 76}" fill="none" stroke="#38bdf8" stroke-width="6" stroke-linecap="round"/>
    <path d="${smooth(coast(x + 4, y - 4, 76, 46, 88, 12, 0.12))}" fill="#a8b3c4" stroke="#64748b" stroke-width="2"/>
    <path d="M${x - 66} ${y + 18}H${x + 74}M${x - 50} ${y - 22}H${x + 66}M${x - 30} ${y - 46}V${y + 38}M${x + 22} ${y - 46}V${y + 38}" stroke="#475569" stroke-width="5"/>
    <path d="M${x - 66} ${y + 18}H${x + 74}M${x - 50} ${y - 22}H${x + 66}" stroke="#fde047" stroke-width=".9" stroke-dasharray="3 3"/>
    <path d="M${x - 40} ${y + 32}h20" stroke="${LINE}" stroke-width="7"/><path d="M${x - 40} ${y + 32}h20" stroke="#ef4444" stroke-width="4.5"/><path d="M${x - 40} ${y + 32}h20" stroke="#fff" stroke-width="1" stroke-dasharray="2 2"/>
    ${scatter(x + 66, y + 28, 22, 14, 41, 5, [], [["wmTree", "#22a447"], ["wmBush", "#4cc35a"]])}
    ${scatter(x - 70, y - 40, 22, 14, 42, 4, [], [["wmTree", "#22a447"], ["wmPine", "#15803d"]])}
    ${blocks.join("")}
    <path d="M${tallX + 7} ${tallTop}v-14" stroke="${LINE}" stroke-width="2"/><circle cx="${tallX + 7}" cy="${tallTop - 15}" r="2.2" fill="#ef4444" stroke="${LINE}" stroke-width=".8"/>
    <g transform="translate(${x + 82} ${y - 18})" stroke="${LINE}" stroke-width="1.4"><path d="M0 0l-6 -40h12Z" fill="#e2e8f0"/><path d="M-12 -32h24M-10 -22h20" stroke-width="1.6"/><path d="M-12 -32q-14 10 -30 12M12 -32q10 6 22 6" fill="none" stroke-width=".8"/></g>`;
}
function mond({ x, y, rx, ry }, locked) {
  const p = coast(x, y, rx, ry * 0.62, 61, 16, 0.14), r = rng(66);
  const top = smooth(p);
  const under = `M${x - rx * 0.95} ${y + 2}C${x - rx * 0.8} ${y + 40} ${x - 40} ${y + 70} ${x - 18} ${y + 96}L${x - 8} ${y + 82}L${x + 4} ${y + 110}L${x + 16} ${y + 84}C${x + 40} ${y + 70} ${x + rx * 0.8} ${y + 40} ${x + rx * 0.95} ${y + 2}Z`;
  const craters = [[-56, -6, 14], [-20, 16, 10], [40, 10, 13], [64, -12, 8], [-70, 16, 7], [10, 26, 6]].map(([dx, dy, s]) => `<ellipse cx="${x + dx}" cy="${y + dy}" rx="${s}" ry="${s * 0.5}" fill="#94a3b8" stroke="#64748b" stroke-width="1.4"/><ellipse cx="${x + dx + 1}" cy="${y + dy + s * 0.12}" rx="${s * 0.75}" ry="${s * 0.33}" fill="#7c8799"/>`).join("");
  const stars = locked ? "" : Array.from({ length: 6 }, () => `<circle cx="${n1(x - rx + r() * rx * 2)}" cy="${n1(y - 60 + r() * 40)}" r=".9" fill="#fff"/>`).join("");
  return `<ellipse cx="${x}" cy="${y + 50}" rx="${rx * 1.5}" ry="${ry * 1.6}" fill="url(#wmGlow)"/>
    <path d="${under}" fill="#475569" stroke="${LINE}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M${x - rx * 0.6} ${y + 20}C${x - 40} ${y + 50} ${x - 30} ${y + 60} ${x - 14} ${y + 84}M${x + 30} ${y + 30}C${x + 34} ${y + 50} ${x + 26} ${y + 62} ${x + 16} ${y + 78}" fill="none" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
    <path d="M${x - rx * 0.85} ${y + 12}C${x - 60} ${y + 30} ${x + 60} ${y + 34} ${x + rx * 0.85} ${y + 12}" fill="none" stroke="#64748b" stroke-width="5" opacity=".7"/>
    <path d="${smooth(sc(p, x, y, 1, 0, 8))}" fill="#64748b" stroke="${LINE}" stroke-width="3"/>
    <path d="${top}" fill="#cbd5e1" stroke="${LINE}" stroke-width="3"/>
    <path d="${smooth(sc(p, x, y, 0.9, 0, -2))}" fill="#e2e8f0"/>
    ${craters}${stars}
    <g stroke="${LINE}" stroke-width="1.5" stroke-linejoin="round">
      <rect x="${x - 6}" y="${y - 14}" width="34" height="6" rx="3" fill="#e2e8f0"/>
      <path d="M${x - 30} ${y - 4}a22 22 0 0 1 44 0Z" fill="url(#wmDome)"/><path d="M${x - 22} ${y - 14}a14 14 0 0 1 14 -10" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M${x - 30} ${y - 4}h44" stroke-width="2"/>
      <path d="M${x + 22} ${y - 2}a12 12 0 0 1 24 0Z" fill="url(#wmDome)"/>
      <g transform="translate(${x + 60} ${y - 6})"><path d="M0 0v-14" stroke-width="1.8"/><path d="M-9 -20a10 10 0 0 0 16 12Z" fill="#f1f5f9"/><circle cx="2" cy="-22" r="2" fill="#ef4444"/></g>
      <g transform="translate(${x - 70} ${y - 6}) skewX(-20)"><rect x="0" y="-10" width="18" height="10" fill="#1d4ed8"/><path d="M6 -10v10M12 -10v10M0 -5h18" stroke="#93c5fd" stroke-width=".8"/></g>
      <g transform="translate(${x - 48} ${y + 4}) skewX(-20)"><rect x="0" y="-10" width="18" height="10" fill="#1d4ed8"/><path d="M6 -10v10M12 -10v10M0 -5h18" stroke="#93c5fd" stroke-width=".8"/></g>
      <path d="M${x + 76} ${y + 8}v-28" stroke-width="1.6"/><path d="M${x + 76} ${y - 20}h14v9h-14Z" fill="#facc15"/><path d="M${x + 84} ${y - 19}l-3 4h3l-2 4" fill="none" stroke-width="1"/>
      <g transform="translate(${x + 10} ${y + 20})"><rect x="-8" y="-6" width="16" height="6" rx="2" fill="#f8fafc"/><circle cx="-5" cy="1" r="2.4" fill="#334155"/><circle cx="5" cy="1" r="2.4" fill="#334155"/><path d="M4 -6l4 -6" stroke-width="1.2"/></g>
    </g>`;
}
function galaxie({ x, y, rx }) {
  const R = rx * 0.62;
  const ring = (front) => `<path d="M${x - R * 1.75} ${y + 6}A${R * 1.75} ${R * 0.42} -12 0 ${front ? 0 : 1} ${x + R * 1.75} ${y - 6}" fill="none" stroke="${LINE}" stroke-width="${front ? 13 : 12}" stroke-linecap="round"/>
    <path d="M${x - R * 1.75} ${y + 6}A${R * 1.75} ${R * 0.42} -12 0 ${front ? 0 : 1} ${x + R * 1.75} ${y - 6}" fill="none" stroke="#fcd34d" stroke-width="8" stroke-linecap="round"/>
    <path d="M${x - R * 1.75} ${y + 6}A${R * 1.75} ${R * 0.42} -12 0 ${front ? 0 : 1} ${x + R * 1.75} ${y - 6}" fill="none" stroke="#f472b6" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`;
  return `<ellipse cx="${x}" cy="${y}" rx="${R * 2.4}" ry="${R * 1.9}" fill="url(#wmNebC)"/>
    <circle cx="${x}" cy="${y}" r="${R + 14}" fill="#e9d5ff" opacity=".18"/>
    ${ring(false)}
    <circle cx="${x}" cy="${y}" r="${R}" fill="url(#wmPlanet)" stroke="${LINE}" stroke-width="3"/>
    <path d="M${x - R * 0.96} ${y - R * 0.25}Q${x} ${y - R * 0.05} ${x + R * 0.96} ${y - R * 0.3}" fill="none" stroke="#f0abfc" stroke-width="5" opacity=".55"/>
    <path d="M${x - R * 0.9} ${y + R * 0.38}Q${x} ${y + R * 0.55} ${x + R * 0.88} ${y + R * 0.36}" fill="none" stroke="#581c87" stroke-width="6" opacity=".45"/>
    <circle cx="${x + R * 0.35}" cy="${y + R * 0.1}" r="${R * 0.14}" fill="#7e22ce" opacity=".6"/><circle cx="${x - R * 0.4}" cy="${y - R * 0.5}" r="${R * 0.22}" fill="#fff" opacity=".35"/>
    ${ring(true)}
    <circle cx="${x + R * 1.55}" cy="${y - R * 1.0}" r="9" fill="#67e8f9" stroke="${LINE}" stroke-width="2"/><circle cx="${x + R * 1.52}" cy="${y - R * 1.04}" r="3" fill="#ecfeff" opacity=".7"/>
    <g transform="translate(${x - R * 1.5} ${y - R * 1.05}) rotate(-20)" stroke="${LINE}" stroke-width="1.4"><rect x="-14" y="-3" width="28" height="6" rx="2" fill="#e2e8f0"/><circle r="6" fill="#f8fafc"/><rect x="-24" y="-5" width="9" height="10" fill="#1d4ed8"/><rect x="15" y="-5" width="9" height="10" fill="#1d4ed8"/><circle r="2.4" fill="#22d3ee"/></g>`;
}
const ART = [garage, baustelle, stadt, mond, galaxie];

/* ---------- Gebäude-Inselchen ---------- */
const B = {
  shop: { x: 64, y: 1545, k: "shop", a: "view", v: "shop", name: "Shop", c: "#16a34a" },
  meister: { x: 78, y: 1770, k: "meister", a: "view", v: "mehr", name: "Meisterbrief", c: "#4f46e5" },
  rad: { x: 322, y: 1420, k: "rad", a: "rad", v: "", name: "Glücksrad", c: "#db2777" },
  relic: { x: 70, y: 1150, k: "relic", a: "relics", v: "", name: "Fundstücke", c: "#c2410c" },
  tour: { x: 78, y: 868, k: "tour", a: "view", v: "tour", name: "Expeditionen", c: "#0d9488" },
  ach: { x: 322, y: 520, k: "ach", a: "view", v: "mehr", name: "Erfolge", c: "#ca8a04" },
};
const islet = (x, y, seed, rx = 42, ry = 28) => land(x, y + 6, rx, ry, seed, PAL.isle, { n: 13, j: 0.16, inner: 0.78, regions: 1 });
const BART = {
  shop: ({ x, y }) => `${islet(x, y, 701)}${use("wmPalm", x + 28, y + 14, 0.9)}${use("wmBush", x - 30, y + 12, 1, "#4cc35a")}
    ${box(x - 14, y + 10, 22, 16, 10, "#fef3c7", "#e7c98f", "#fde68a", "")}
    <path d="M${x - 17} ${y - 4}h28l-3 7h-22Z" fill="url(#wmAwn)" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M${x - 16} ${y - 6}h28l10 -5h-28Z" fill="#b91c1c" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"/>
    <rect x="${x - 9}" y="${y + 3}" width="8" height="7" fill="#bae6fd" stroke="${LINE}" stroke-width="1.1"/><rect x="${x + 2}" y="${y + 2}" width="5" height="8" fill="#7c2d12" stroke="${LINE}" stroke-width="1.1"/>
    <path d="M${x + 17} ${y + 6}v-24" stroke="${LINE}" stroke-width="2"/>
    <circle cx="${x + 17}" cy="${y - 24}" r="9" fill="url(#wmGold)" stroke="${LINE}" stroke-width="2"/><circle cx="${x + 17}" cy="${y - 24}" r="6" fill="none" stroke="#b45309" stroke-width="1"/>
    <text x="${x + 17}" y="${y - 20.5}" text-anchor="middle" font-size="10" font-weight="900" fill="#92400e">€</text>`,
  tour: ({ x, y }) => `${islet(x, y, 702)}${use("wmPine", x - 28, y + 10, 0.9, "#15803d")}${use("wmPine", x + 30, y + 14, 0.8, "#166534")}
    <path d="M${x - 22} ${y + 12}L${x - 16} ${y - 8}L${x - 4} ${y - 14}L${x + 12} ${y - 12}L${x + 22} ${y + 2}L${x + 18} ${y + 14}Z" fill="#94a3b8" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M${x - 16} ${y - 8}L${x - 4} ${y - 14}L${x} ${y - 4}Z" fill="#cbd5e1"/>
    <g transform="translate(${x} ${y - 14})"><ellipse rx="15" ry="9" fill="#fef3c7" stroke="${LINE}" stroke-width="2"/><ellipse rx="11" ry="6.4" fill="none" stroke="#d6a565" stroke-width="1"/>
      <path d="M0 -8L2.2 0L0 8L-2.2 0Z" fill="#fff" stroke="${LINE}" stroke-width=".9"/><path d="M0 -8L2.2 0H-2.2Z" fill="#ef4444"/><path d="M-13 0L0 -1.4L13 0L0 1.4Z" fill="#1e3a8a" opacity=".55"/>
      <circle r="1.4" fill="${LINE}"/></g>
    <path d="M${x + 10} ${y - 8}v-26" stroke="${LINE}" stroke-width="1.8"/><path d="M${x + 10} ${y - 34}l12 4l-12 4Z" fill="#14b8a6" stroke="${LINE}" stroke-width="1.2" stroke-linejoin="round"/>`,
  relic: ({ x, y }) => `${islet(x, y, 703)}${use("wmPalm", x + 30, y + 12, 0.85)}
    <ellipse cx="${x - 6}" cy="${y + 10}" rx="14" ry="4" fill="#a16207" opacity=".45"/>
    <g stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round">
      <rect x="${x - 26}" y="${y - 18}" width="8" height="26" fill="#f1f5f9"/><rect x="${x - 28}" y="${y - 22}" width="12" height="4" fill="#e2e8f0"/><path d="M${x - 24} ${y - 14}v20M${x - 20} ${y - 14}v20" stroke-width=".8" opacity=".5"/>
      <path d="M${x - 12} ${y + 8}v-14l3 -3l2 3l3 -4v18Z" fill="#f1f5f9"/>
      <rect x="${x - 30}" y="${y + 6}" width="30" height="4" fill="#cbd5e1"/>
      <path d="M${x + 8} ${y + 10}c-8 0 -10 -8 -8 -14c1 -4 4 -6 4 -9h-2v-3h12v3h-2c0 3 3 5 4 9c2 6 0 14 -8 14Z" fill="#ea580c"/>
      <path d="M${x + 1} ${y - 3}h14" stroke="#fde68a" stroke-width="1.6"/><path d="M${x + 2} ${y + 3}h12" stroke="#7c2d12" stroke-width="1.2"/>
      <path d="M${x + 1} ${y - 6}q-5 1 -3 7M${x + 15} ${y - 6}q5 1 3 7" fill="none" stroke-width="1.6"/>
    </g>
    <path d="M${x + 22} ${y - 16}l1.4 3l3 1.4l-3 1.4l-1.4 3l-1.4 -3l-3 -1.4l3 -1.4Z" fill="#fde047"/>`,
  rad: ({ x, y }) => {
    const cy = y - 18, R = 18, cols = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#facc15"];
    const spokes = cols.map((_, i) => { const a = (i / 8) * Math.PI * 2; return `M${x} ${cy}L${n1(x + Math.cos(a) * R)} ${n1(cy + Math.sin(a) * R)}`; }).join("");
    const gond = cols.map((c, i) => { const a = (i / 8) * Math.PI * 2, gx = x + Math.cos(a) * R, gy = cy + Math.sin(a) * R; return `<rect x="${n1(gx - 3.2)}" y="${n1(gy - 1)}" width="6.4" height="5.4" rx="1.6" fill="${c}" stroke="${LINE}" stroke-width="1.1"/>`; }).join("");
    return `${islet(x, y, 704)}${use("wmPalm", x - 30, y + 12, 0.85)}${use("wmBush", x + 30, y + 12, 1, "#4cc35a")}
      <path d="M${x - 14} ${y + 8}L${x} ${cy}L${x + 14} ${y + 8}" fill="none" stroke="${LINE}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M${x - 14} ${y + 8}L${x} ${cy}L${x + 14} ${y + 8}" fill="none" stroke="#e2e8f0" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${x}" cy="${cy}" r="${R}" fill="none" stroke="${LINE}" stroke-width="4.5"/><circle cx="${x}" cy="${cy}" r="${R}" fill="none" stroke="#f472b6" stroke-width="2.4"/>
      <path d="${spokes}" stroke="#fbcfe8" stroke-width="1.2"/><circle cx="${x}" cy="${cy}" r="${R * 0.55}" fill="none" stroke="#f9a8d4" stroke-width="1"/>
      ${gond}<circle cx="${x}" cy="${cy}" r="3.4" fill="#fde047" stroke="${LINE}" stroke-width="1.4"/>
      <rect x="${x - 18}" y="${y + 6}" width="36" height="5" rx="1.5" fill="#be185d" stroke="${LINE}" stroke-width="1.4"/>`;
  },
  ach: ({ x, y }) => `<ellipse cx="${x}" cy="${y + 14}" rx="60" ry="40" fill="url(#wmGlow)"/>
    <path d="M${x - 40} ${y + 6}C${x - 30} ${y + 26} ${x - 10} ${y + 36} ${x} ${y + 46}L${x + 8} ${y + 34}C${x + 22} ${y + 26} ${x + 34} ${y + 20} ${x + 40} ${y + 6}Z" fill="#475569" stroke="${LINE}" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="${smooth(coast(x, y + 6, 42, 14, 99, 12, 0.1))}" fill="#94a3b8" stroke="${LINE}" stroke-width="2.6"/>
    <path d="${smooth(coast(x, y + 4, 38, 11, 99, 12, 0.1))}" fill="#cbd5e1"/>
    <ellipse cx="${x - 24}" cy="${y + 6}" rx="5" ry="2" fill="#94a3b8"/><ellipse cx="${x + 26}" cy="${y + 8}" rx="4" ry="1.6" fill="#94a3b8"/>
    <g stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round">
      ${box(x - 22, y + 8, 12, 7, 5, "#cbd5e1", "#94a3b8", "#f1f5f9")}${box(x + 8, y + 8, 12, 5, 5, "#fdba74", "#c2410c", "#fed7aa")}${box(x - 10, y + 8, 18, 12, 6, "#fde047", "#ca8a04", "#fef9c3")}
      <path d="M${x - 9} ${y - 30}h16c0 10 -3 15 -8 16c-5 -1 -8 -6 -8 -16Z" fill="url(#wmGold)"/>
      <path d="M${x - 9} ${y - 27}c-7 0 -7 8 0 8M${x + 7} ${y - 27}c7 0 7 8 0 8" fill="none" stroke-width="2.4"/><path d="M${x - 9} ${y - 27}c-7 0 -7 8 0 8M${x + 7} ${y - 27}c7 0 7 8 0 8" fill="none" stroke="#fbbf24" stroke-width="1"/>
      <rect x="${x - 3}" y="${y - 14}" width="4" height="4" fill="#d97706"/><rect x="${x - 7}" y="${y - 10}" width="12" height="4" rx="1" fill="#92400e"/>
      <path d="M${x - 1} ${y - 27}l1.2 2.4l2.6 .4l-1.9 1.8l.5 2.6l-2.4 -1.2l-2.4 1.2l.5 -2.6l-1.9 -1.8l2.6 -.4Z" fill="#fff7c2" stroke-width=".7"/>
    </g>`,
  meister: ({ x, y }) => `${islet(x, y, 706)}${use("wmTree", x - 30, y + 12, 0.85, "#22a447")}${use("wmTree", x + 32, y + 12, 0.8, "#3fb950")}
    <g stroke="${LINE}" stroke-width="1.5" stroke-linejoin="round">
      <ellipse cx="${x + 2}" cy="${y + 11}" rx="24" ry="5" fill="#0b2a12" opacity=".25" stroke="none"/>
      <rect x="${x - 18}" y="${y + 6}" width="38" height="5" fill="#e2e8f0"/>
      <rect x="${x - 16}" y="${y - 12}" width="34" height="18" fill="#f8fafc"/>
      <path d="M${x - 12} ${y - 10}v16M${x - 4} ${y - 10}v16M${x + 6} ${y - 10}v16M${x + 14} ${y - 10}v16" stroke="#94a3b8" stroke-width="2.6"/>
      <rect x="${x - 1}" y="${y - 2}" width="5" height="8" fill="#7c2d12" stroke-width="1"/>
      <path d="M${x - 20} ${y - 12}L${x + 1} ${y - 28}L${x + 22} ${y - 12}Z" fill="#4f46e5"/><path d="M${x - 12} ${y - 15}L${x + 1} ${y - 24}L${x + 14} ${y - 15}Z" fill="#818cf8"/>
      <path d="M${x + 1} ${y - 38}l2.4 4.8l5.2 .8l-3.8 3.6l1 5.2l-4.8 -2.4l-4.8 2.4l1 -5.2l-3.8 -3.6l5.2 -.8Z" fill="url(#wmGold)" stroke-width="1.2"/>
    </g>
    <g transform="translate(${x + 26} ${y - 6}) rotate(-12)" stroke="${LINE}" stroke-width="1.2"><rect x="-6" y="-9" width="12" height="16" fill="#fef3c7"/><rect x="-8" y="-11" width="16" height="3.4" rx="1.7" fill="#fde68a"/><rect x="-8" y="6" width="16" height="3.4" rx="1.7" fill="#fde68a"/><path d="M-3 -4h6M-3 -1h6M-3 2h4" stroke-width=".8"/><circle cx="3" cy="4" r="1.8" fill="#dc2626" stroke-width=".6"/></g>`,
};

/* ---------- Event-Insel ---------- */
const EV = { x: 300, y: 1218 };
function eventArt(I) {
  const { x, y } = EV;
  if (!I.active) {
    return `${land(x, y + 4, 34, 22, 909, { ...PAL.isle, grass: "#e9c97c", grassL: "#f5dc9c", grassD: "#d9b25e", edge: "#c99a45" }, { n: 12, j: 0.15, inner: 0.7, regions: 0 })}
      ${use("wmPalm", x + 14, y + 6, 0.9)}
      <g stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"><path d="M${x - 10} ${y + 8}v-18" stroke-width="2"/><path d="M${x - 22} ${y - 18}h24v10h-24Z" fill="#d6a565"/></g>
      <text x="${x - 10}" y="${y - 10.5}" text-anchor="middle" font-size="7" font-weight="900" fill="#5b3410">bald!</text>`;
  }
  const c = I.theme.bg;
  return `<defs><pattern id="wmTent" width="8" height="40" patternUnits="userSpaceOnUse"><rect width="4" height="40" fill="${c}"/><rect x="4" width="4" height="40" fill="#fff"/></pattern></defs>
    <circle cx="${x}" cy="${y}" r="92" fill="url(#wmNebA)" opacity=".55"/>
    ${land(x, y + 4, 62, 42, 4242, PAL.isle, { n: 15, j: 0.18 })}
    ${use("wmPalm", x - 42, y + 14, 1)}${use("wmPalm", x + 44, y + 10, 0.95)}${use("wmPalm", x + 34, y + 26, 0.8)}${use("wmBush", x - 30, y + 26, 1, "#4cc35a")}
    <path d="M${x - 50} ${y - 12}Q${x - 25} ${y - 2} ${x} ${y - 46}Q${x + 25} ${y - 2} ${x + 50} ${y - 12}" fill="none" stroke="${LINE}" stroke-width=".9"/>
    ${[-42, -32, -22, -12, 12, 22, 32, 42].map((d, i) => `<path d="M${x + d} ${y - 10 - (Math.abs(d) < 20 ? 14 : 4)}l3 6l3 -6Z" fill="${["#ef4444", "#fde047", "#22c55e", "#3b82f6"][i % 4]}" stroke="${LINE}" stroke-width=".7"/>`).join("")}
    <g stroke="${LINE}" stroke-width="2" stroke-linejoin="round">
      <ellipse cx="${x}" cy="${y + 12}" rx="34" ry="7" fill="#0b2a12" opacity=".25" stroke="none"/>
      <path d="M${x - 30} ${y + 10}V${y - 10}H${x + 30}V${y + 10}Z" fill="url(#wmTent)"/>
      <path d="M${x - 34} ${y - 8}L${x} ${y - 42}L${x + 34} ${y - 8}Q${x + 17} ${y - 2} ${x} ${y - 8}Q${x - 17} ${y - 2} ${x - 34} ${y - 8}Z" fill="url(#wmTent)"/>
      <path d="M${x - 8} ${y + 10}Q${x} ${y - 12} ${x + 8} ${y + 10}Z" fill="#1f2937"/>
      <path d="M${x} ${y - 42}v-12" stroke-width="1.8"/><path d="M${x} ${y - 54}l12 4l-12 4Z" fill="#fde047" stroke-width="1.2"/>
    </g>`;
}

/* ---------- Meer, Himmel, Weltall ---------- */
const SEA_EDGE = `M0 ${HORIZON + 46}Q${MW / 2} ${HORIZON - 46} ${MW} ${HORIZON + 46}`;
const seaTop = (x) => { const t = x / MW; return (1 - t) ** 2 * (HORIZON + 46) + 2 * (1 - t) * t * (HORIZON - 46) + t * t * (HORIZON + 46); };
const ALL = () => [...W.map((w) => [w.x, w.y, w.rx * 1.3, w.ry * 1.4]), ...Object.values(B).map((b) => [b.x, b.y + 4, 60, 44]), [EV.x, EV.y, 82, 60],
  ...TURB.map(([x, y]) => [x, y - 18, 22, 26]), [LIGHT[0], LIGHT[1] - 18, 30, 34], ...ROCKS.map(([x, y]) => [x, y, 18, 10])];
function waves(seed, count) {
  const r = rng(seed), out = [], isl = ALL();
  for (let t = 0; out.length < count && t < count * 20; t++) {
    const x = 8 + r() * (MW - 16), y = HORIZON + 50 + r() * (MAP_H - HORIZON - 60);
    if (y < seaTop(x) + 16) continue;
    if (isl.some(([ix, iy, irx, iry]) => ((x - ix) / irx) ** 2 + ((y - iy) / iry) ** 2 < 1)) continue;
    out.push([x, y, 0.7 + r() * 0.7]);
  }
  return out;
}
function stars(seed, count, maxY) {
  const r = rng(seed), out = [];
  for (let i = 0; i < count; i++) { const x = r() * MW, y = r() * maxY; if (y > seaTop(x) - 6) continue; out.push([x, y, 0.4 + r() * r() * 1.6, r()]); }
  return out;
}
/** Kabel-Route von Welt zu Welt (Strom fließt durch freigeschaltete Teile). */
function routeSeg(i) {
  const a = W[i], b = W[i + 1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, s = i % 2 ? -1 : 1;
  return `M${a.x} ${a.y}Q${mx + s * 90} ${my} ${b.x} ${b.y}`;
}

/* Deko im Meer: Offshore-Windpark, Leuchtturm, Felsen */
const TURB = [[300, 1792, 1], [344, 1768, 0.9], [378, 1806, 1.05]];
const LIGHT = [34, 1010];
const ROCKS = [[205, 1268, 1.1], [26, 1660, 0.9], [372, 1110, 0.8], [180, 860, 0.8]];
function decorSVG() {
  const turb = TURB.map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="${LINE}" stroke-linejoin="round">
      <ellipse cy="1" rx="9" ry="3" fill="#bae6fd" stroke="none" opacity=".8"/><rect x="-5" y="-4" width="10" height="5" rx="1" fill="#facc15" stroke-width="1.4"/>
      <path d="M-1.6 -4L-1 -38H1L1.6 -4Z" fill="#f8fafc" stroke-width="1.4"/><rect x="-2.5" y="-40" width="6" height="4" rx="1.5" fill="#e2e8f0" stroke-width="1.2"/></g>`).join("");
  const [lx, ly] = LIGHT;
  const light = `<g stroke="${LINE}" stroke-linejoin="round">
      <ellipse cx="${lx}" cy="${ly + 6}" rx="26" ry="9" fill="url(#wmShallow)" stroke="none"/>
      <path d="M${lx - 16} ${ly + 6}L${lx - 12} ${ly - 3}L${lx - 2} ${ly - 7}L${lx + 10} ${ly - 4}L${lx + 16} ${ly + 6}Z" fill="#94a3b8" stroke-width="2"/><path d="M${lx - 12} ${ly - 3}L${lx - 2} ${ly - 7}L${lx} ${ly}Z" fill="#cbd5e1"/>
      <path d="M${lx - 6} ${ly - 4}L${lx - 4} ${ly - 34}H${lx + 4}L${lx + 6} ${ly - 4}Z" fill="#f8fafc" stroke-width="1.6"/>
      <path d="M${lx - 5.5} ${ly - 12}H${lx + 5.5}L${lx + 5.2} ${ly - 18}H${lx - 5.2}ZM${lx - 4.8} ${ly - 24}H${lx + 4.8}L${lx + 4.5} ${ly - 30}H${lx - 4.5}Z" fill="#ef4444" stroke-width="1"/>
      <rect x="${lx - 6}" y="${ly - 36}" width="12" height="3" rx="1" fill="#334155" stroke-width="1"/><rect x="${lx - 3.5}" y="${ly - 43}" width="7" height="7" fill="#fde047" stroke-width="1.3"/><path d="M${lx - 5} ${ly - 43}L${lx} ${ly - 49}L${lx + 5} ${ly - 43}Z" fill="#ef4444" stroke-width="1.3"/></g>`;
  const rocks = ROCKS.map(([x, y, s]) => `<ellipse cx="${x}" cy="${y + 2}" rx="${12 * s}" ry="${5 * s}" fill="#bae6fd" opacity=".55"/>${use("wmRock", x, y, s * 1.2)}`).join("");
  return turb + light + rocks;
}
function seaSVG(g, I) {
  const wv = waves(5, 70), st = stars(9, 170, HORIZON + 40);
  const route = W.slice(0, -1).map((_, i) => `<path d="${routeSeg(i)}" fill="none" stroke="#0b2a5c" stroke-width="7" stroke-linecap="round" stroke-dasharray="1 11" opacity=".35"/>
    <path d="${routeSeg(i)}" fill="none" stroke="${i + 1 <= g.unlocked ? "#fde047" : "#e2e8f0"}" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="1 11" opacity="${i + 1 <= g.unlocked ? 0.95 : 0.55}"/>`).join("");
  const worlds = W.map((w, i) => {
    const locked = i > g.unlocked, fog = locked && !(i === g.unlocked + 1);
    const cl = fog ? [[-0.55, 0.05, 0.62], [0.5, -0.25, 0.55], [0.1, 0.42, 0.5]].map(([dx, dy, s]) => use("wmFogC", w.x + dx * w.rx, w.y + dy * w.ry, n1((w.rx * s) / 50))).join("") : "";
    return `<g class="wm-isl${locked ? " locked" : ""}">${ART[i](w, locked)}</g>${cl ? `<g class="wm-fog" opacity=".88">${cl}</g>` : ""}`;
  }).join("");
  return `<svg class="ty-sea wm-sea" viewBox="0 0 ${MW} ${MAP_H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${DEFS}
    <rect width="${MW}" height="${HORIZON + 60}" fill="url(#wmSpace)"/>
    <ellipse cx="90" cy="300" rx="220" ry="150" fill="url(#wmNebA)" opacity=".5"/><ellipse cx="330" cy="420" rx="200" ry="140" fill="url(#wmNebB)"/><ellipse cx="300" cy="90" rx="200" ry="120" fill="url(#wmNebC)" opacity=".7"/>
    <path d="M-20 360Q120 300 200 330T420 270" fill="none" stroke="#c4b5fd" stroke-width="40" opacity=".07" stroke-linecap="round"/>
    ${st.map(([x, y, s, k]) => `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(s)}" fill="${k > 0.8 ? "#fde68a" : k > 0.6 ? "#bae6fd" : "#fff"}" opacity="${n1(0.5 + k * 0.5)}"/>`).join("")}
    <path d="${SEA_EDGE}" fill="none" stroke="#7dd3fc" stroke-width="34" opacity=".18"/><path d="${SEA_EDGE}" fill="none" stroke="#bae6fd" stroke-width="12" opacity=".35"/>
    <path d="${SEA_EDGE}V${MAP_H}H0Z" fill="url(#wmSea)"/>
    <path d="${SEA_EDGE}" fill="none" stroke="#e0f2fe" stroke-width="2.4" opacity=".8"/>
    <path d="M0 ${HORIZON + 80}Q${MW / 2} ${HORIZON - 10} ${MW} ${HORIZON + 80}" fill="none" stroke="#fff" stroke-width="16" opacity=".06"/>
    ${[1150, 1480, 1760].map((yy, i) => `<path d="M-10 ${yy}Q100 ${yy - 30 + i * 12} 200 ${yy}T410 ${yy - 10}" fill="none" stroke="#fff" stroke-width="22" opacity=".045"/>`).join("")}
    ${wv.map(([x, y, s]) => `<path d="M${n1(x)} ${n1(y)}q${n1(3 * s)} ${n1(-3 * s)} ${n1(6 * s)} 0q${n1(3 * s)} ${n1(-3 * s)} ${n1(6 * s)} 0" fill="none" stroke="#e0f2fe" stroke-width="1.5" stroke-linecap="round" opacity="${n1(0.25 + (y - HORIZON) / MAP_H * 0.45)}"/>`).join("")}
    ${route}
    ${decorSVG()}
    <g transform="translate(196 1490) rotate(-8)" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"><path d="M-30 6q-8 0 -14 3" fill="none" stroke="#fff" stroke-width="2" opacity=".6"/><path d="M-12 0h26l-5 7h-18Z" fill="#dc2626"/><rect x="-6" y="-7" width="10" height="7" fill="#f8fafc"/><rect x="-4" y="-5" width="3" height="3" fill="#38bdf8" stroke-width=".7"/><path d="M8 0v-10" stroke-width="1.2"/><path d="M8 -10l-5 5" stroke-width="1"/></g>
    ${Object.values(B).map((b) => `<g class="wm-bisl">${BART[b.k](b)}</g>`).join("")}
    <g class="wm-evisl${I.active ? " on" : ""}">${eventArt(I)}</g>
    ${worlds}
  </svg>`;
}
/** Effekt-Ebene: Schaum um die Küsten, Wellen-Glitzer, funkelnde Sterne, Strom im Kabel, Event-Funkeln. */
function fxSVG(g, I) {
  const r = rng(3);
  const foam = [...W.slice(0, 3).map((w, i) => [w.x, w.y, w.rx, w.ry, [31, 52, 77][i], 18, i === 1 ? 0.24 : 0.2]), ...Object.values(B).filter((b) => b.k !== "ach").map((b, i) => [b.x, b.y + 6, 42, 28, 701 + ["shop", "tour", "relic", "rad", "ach", "meister"].indexOf(b.k), 13, 0.16, i])]
    .map(([x, y, rx, ry, seed, n, j], i) => `<path class="wm-foam" style="animation-delay:-${n1(r() * 6)}s" d="${smooth(sc(coast(x, y, rx, ry, seed, n, j), x, y, 1.1, 0, 6))}"/>`).join("");
  const glints = waves(17, 26).map(([x, y], i) => `<path class="wm-glint" style="animation-delay:-${n1((i * 0.73) % 5)}s" d="M${n1(x)} ${n1(y)}q4 -4 8 0"/>`).join("");
  const tw = stars(23, 40, HORIZON).map(([x, y], i) => `<path class="wm-tw" style="animation-delay:-${n1((i * 0.37) % 3)}s" d="M${n1(x)} ${n1(y - 3)}L${n1(x + 0.8)} ${n1(y - 0.8)}L${n1(x + 3)} ${n1(y)}L${n1(x + 0.8)} ${n1(y + 0.8)}L${n1(x)} ${n1(y + 3)}L${n1(x - 0.8)} ${n1(y + 0.8)}L${n1(x - 3)} ${n1(y)}L${n1(x - 0.8)} ${n1(y - 0.8)}Z"/>`).join("");
  const flow = W.slice(0, -1).map((_, i) => (i + 1 <= g.unlocked ? `<path class="wm-flow" d="${routeSeg(i)}"/>` : "")).join("");
  const mask = `<mask id="wmFlowM" maskUnits="userSpaceOnUse" x="0" y="0" width="${MW}" height="${MAP_H}"><rect width="${MW}" height="${MAP_H}" fill="#fff"/>${W.map((w) => `<ellipse cx="${w.x}" cy="${w.y}" rx="${n1(w.rx * 1.02)}" ry="${n1(w.ry * 0.98)}" fill="#000"/>`).join("")}</mask>`;
  const spark = I.active ? [[-52, -40], [48, -50], [-20, -66], [60, 4], [-64, 10], [22, -74]].map(([dx, dy], i) => `<path class="wm-spk" style="animation-delay:-${i * 0.4}s;transform-origin:${EV.x + dx}px ${EV.y + dy}px" d="M${EV.x + dx} ${EV.y + dy - 6}L${EV.x + dx + 1.6} ${EV.y + dy - 1.6}L${EV.x + dx + 6} ${EV.y + dy}L${EV.x + dx + 1.6} ${EV.y + dy + 1.6}L${EV.x + dx} ${EV.y + dy + 6}L${EV.x + dx - 1.6} ${EV.y + dy + 1.6}L${EV.x + dx - 6} ${EV.y + dy}L${EV.x + dx - 1.6} ${EV.y + dy - 1.6}Z"/>`).join("") : "";
  const rot = TURB.map(([x, y, s], i) => { const hx = x + 0.5 * s, hy = y - 38 * s; return `<g class="wm-rot" style="transform-origin:${n1(hx)}px ${n1(hy)}px;animation-duration:${3 + i * 0.7}s"><g transform="translate(${n1(hx)} ${n1(hy)}) scale(${s})">${[0, 120, 240].map((a) => `<path transform="rotate(${a})" d="M0 0L-1.8 -3Q-1.2 -17 0 -19Q1.4 -17 1.2 -3Z"/>`).join("")}<circle r="2" fill="#e2e8f0"/></g></g>`; }).join("");
  const beam = `<path class="wm-beam" style="transform-origin:${LIGHT[0]}px ${LIGHT[1] - 39}px" d="M${LIGHT[0]} ${LIGHT[1] - 39}L${LIGHT[0] + 70} ${LIGHT[1] - 52}L${LIGHT[0] + 70} ${LIGHT[1] - 26}Z"/>`;
  return `<svg class="wm-fx" viewBox="0 0 ${MW} ${MAP_H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <path class="wm-shoot" d="M60 120l-40 18"/><path class="wm-shoot b" d="M380 380l-44 20"/>
    <defs>${mask}</defs>${tw}<g mask="url(#wmFlowM)">${flow}</g>${foam}${glints}${spark}${rot}${beam}</svg>`;
}

/* ---------- HTML-Ebene ---------- */
const at = (x, y) => `left:${n1((x / MW) * 100)}%;top:${n1((y / MAP_H) * 1e4) / 100}%`;
const boxStyle = (x, y, rx, ry) => `${at(x, y)};width:${n1(((rx * 2) / MW) * 100)}%;height:${n1(((ry * 2) / MAP_H) * 1e4) / 100}%`;
const CLOUD = `<svg viewBox="0 0 120 70" aria-hidden="true" focusable="false"><ellipse cx="62" cy="64" rx="46" ry="5" fill="#0b3a7a" opacity=".16"/>
  <path d="M18 46c-10 0-14-12-5-17c-2-11 12-17 20-10c4-12 22-14 28-3c8-8 24-4 24 8c11-1 16 13 7 19c2 8-6 12-12 10H24c-4 0-6-3-6-7Z" fill="#fff" stroke="#9fb6d6" stroke-width="2"/>
  <path d="M20 47h66c6 2 12-2 10-8c-4 6-10 4-14 4c-10 3-24 3-34 0c-8 2-20 2-28 4Z" fill="#dbeafe"/><circle cx="44" cy="22" r="6" fill="#fff" opacity=".9"/></svg>`;
const GULL = `<svg viewBox="0 0 24 12" aria-hidden="true" focusable="false"><path d="M1 6Q6 0 12 6Q18 0 23 6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M1 6Q6 0 12 6Q18 0 23 6" fill="none" stroke="#334155" stroke-width=".8" stroke-linecap="round" opacity=".6"/></svg>`;
const LOCK = `<svg viewBox="0 0 40 44" aria-hidden="true" focusable="false"><path d="M11 20v-7a9 9 0 0 1 18 0v7" fill="none" stroke="#1f2a44" stroke-width="8"/><path d="M11 20v-7a9 9 0 0 1 18 0v7" fill="none" stroke="#cbd5e1" stroke-width="4"/>
  <rect x="4" y="18" width="32" height="24" rx="6" fill="#fbbf24" stroke="#1f2a44" stroke-width="3"/><rect x="7" y="21" width="26" height="6" rx="3" fill="#fde68a"/><path d="M20 29v6" stroke="#1f2a44" stroke-width="4" stroke-linecap="round"/><circle cx="20" cy="29" r="3.2" fill="#1f2a44"/></svg>`;

export function mapHTML(g, { opt, badges = {} }) {
  const nw = T.nextWorld(g), I = T.eventInfo();
  const worlds = T.WORLDS.map((w, i) => {
    const P = W[i], open = i <= g.unlocked, here = i === g.cur, isNext = !!nw && nw.wi === i, ready = isNext && nw.pct >= 1;
    const r = open ? T.rates(g, i, opt()) : null;
    const lt = n1(((P.lab + P.ry) / (2 * P.ry)) * 100), pt2 = n1(((P.pin + P.ry) / (2 * P.ry)) * 100);
    const chip = open ? `<span class="wm-chip"><i class="wm-coin" aria-hidden="true">€</i>${T.fmt(r.auto)} €/s</span>`
      : ready ? `<span class="wm-chip go">🚀 Jetzt freischalten!</span>`
      : isNext ? `<span class="wm-chip lock">Ziel ${T.fmt(nw.need)} €<span class="wm-prog" aria-hidden="true"><i style="width:${Math.max(3, Math.floor(nw.pct * 100))}%"></i></span><small>${Math.floor(nw.pct * 100)} %</small></span>`
      : `<span class="wm-chip lock">Kosten ${T.fmt(w.unlock)} €</span>`;
    const label = `${w.name}${open ? ` – ${T.fmt(r.auto)} €/s` : ready ? " – jetzt freischalten" : ` – gesperrt`}${here ? " – du bist hier" : ""}`;
    return `<button type="button" class="wm-spot ty-wspot${open ? "" : " locked"}${here ? " here" : ""}${ready ? " ready" : ""}${isNext ? " next" : ""}" style="${boxStyle(P.x, P.y, P.rx, P.ry)};--lt:${lt}%;--pt:${pt2}%" data-a="${open ? "goto" : ready ? "unlock" : "lockinfo"}" data-wi="${i}" aria-label="${esc(label)}">
      ${here ? `<span class="wm-here" aria-hidden="true"><span>📍 Du bist hier</span></span>` : ""}
      ${open ? "" : `<span class="wm-lock" aria-hidden="true">${ready ? "🚀" : LOCK}</span>`}
      <span class="wm-lab" aria-hidden="true"><span class="wm-rib" style="--rb:${open ? ["#d97706", "#ea580c", "#2563eb", "#7c3aed", "#db2777"][i] : ready ? "#16a34a" : "#64748b"}"><span class="wm-num">${i + 1}</span>${esc(w.name)}</span>${chip}</span>
    </button>`;
  }).join("");
  const blds = Object.values(B).map((b) => `<button type="button" class="wm-spot wm-bld ty-bspot" style="${boxStyle(b.x, b.y, 44, 34)}" data-a="${b.a}"${b.v ? ` data-v="${b.v}"` : ""} aria-label="${esc(b.name)}">
      <span class="wm-lab sm" aria-hidden="true"><span class="wm-rib sm" style="--rb:${b.c}">${esc(b.name)}</span></span>${badges[b.k] ? `<i class="wm-dot">${esc(String(badges[b.k]))}</i>` : ""}</button>`).join("");
  const dleft = (t) => { const ms = Math.max(0, t - Date.now()), d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5); return d ? `${d} T ${h} h` : `${h} h`; };
  const evSpot = I.active
    ? `<button type="button" class="wm-spot ty-evspot on" style="${boxStyle(EV.x, EV.y, 66, 50)}" data-a="view" data-v="event" aria-label="Event: ${esc(I.theme.name)} – noch ${dleft(I.end)}">
        <span class="wm-evicon" aria-hidden="true">${I.theme.e}</span>
        <span class="wm-lab ev" aria-hidden="true"><span class="wm-rib" style="--rb:#ca8a04">🎪 ${esc(I.theme.name)}</span><span class="wm-chip ev">⏳ Event · noch ${dleft(I.end)}</span></span>${badges.ev ? `<i class="wm-dot">${esc(String(badges.ev))}</i>` : ""}</button>`
    : `<button type="button" class="wm-spot ty-evspot" style="${boxStyle(EV.x, EV.y, 40, 30)}" data-a="evsoon" aria-label="Nächstes Event in ${dleft(I.nextStart)}">
        <span class="wm-lab sm" aria-hidden="true"><span class="wm-chip soon">🎪 Event in ${dleft(I.nextStart)}</span></span></button>`;
  const lane = (cls, y, dur, delay, inner, w) => `<span class="${cls}" style="top:${n1((y / MAP_H) * 1e4) / 100}%;animation-duration:${dur}s;animation-delay:-${delay}s" aria-hidden="true"><span style="width:${w}%">${inner}</span></span>`;
  const clouds = [[820, 70, 10, 30], [1080, 90, 50, 26], [1290, 80, 22, 30], [1500, 95, 70, 24], [1700, 75, 40, 28]].map(([y, d, de, w]) => lane("wm-lane wm-cloud", y, d, de, CLOUD, w)).join("");
  const gulls = [[1260, 38, 4], [1540, 46, 20], [1040, 52, 30]].map(([y, d, de]) => lane("wm-lane wm-gull", y, d, de, `${GULL}${GULL.replace("viewBox", 'class="b" viewBox')}`, 9)).join("");
  return `<div class="ty-mapbar wm-bar">
      <button type="button" class="wm-gbtn gold" data-a="view" data-v="mehr"><span class="wm-gi" aria-hidden="true">⭐</span><small>Meisterbrief</small></button>
      <span class="wm-title"><span>Weltkarte</span></span>
      <button type="button" class="wm-gbtn blue" data-a="findme"><span class="wm-gi" aria-hidden="true">📍</span><small>Zu mir</small></button></div>
    <section class="ty-ocean wm-map" aria-label="Weltkarte">${seaSVG(g, I)}${fxSVG(g, I)}${clouds}${gulls}${blds}${evSpot}${worlds}</section>`;
}
export const worldTop = (wi) => W[wi].y / MAP_H;
