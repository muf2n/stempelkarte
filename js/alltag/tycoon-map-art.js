// ⚡ Strom-Tycoon – 🗺️ Ozean-Karte (Inseln, Gebäude, Event-Insel). Eigene Datei: Karte (Agent „Karte“).
// Vertrag: export mapHTML(g, { opt, badges }) und worldTop(wi); Knöpfe mit data-a = goto|unlock|lockinfo|view(data-v)|rad|relics|evsoon|findme.
import * as T from "../tycoon-core.js";
import { esc } from "../util.js";

/* ---------- Inseln ---------- */
function rng(seed) { let x = seed >>> 0 || 7; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
/** Kantige Insel als Polygon-Punkte (Low-Poly wie eine Landkarte). */
function blob(cx, cy, rx, ry, seed, n = 11, j = 0.28) {
  const r = rng(seed), pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.35, k = 1 - r() * j;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}
const P = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
const scale = (pts, cx, cy, f) => pts.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)))));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
function islandSVG(cx, cy, rx, ry, seed, color, locked) {
  const pts = blob(cx, cy, rx, ry, seed);
  const base = locked ? "#475569" : color;
  const inner = [0, 1, 2].map((i) => blob(cx + (i - 1) * rx * 0.32, cy + ((i % 2) - 0.4) * ry * 0.3, rx * 0.36, ry * 0.32, seed * 7 + i, 7, 0.3));
  const rocks = rng(seed * 3);
  const isles = [0, 1, 2].map(() => { const a = rocks() * Math.PI * 2, d = 1.12 + rocks() * 0.15; return blob(cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, 7 + rocks() * 6, 6 + rocks() * 5, seed + 99 + Math.floor(rocks() * 999), 6, 0.2); });
  return `<g class="ty-isl${locked ? " locked" : ""}">
    <polygon points="${P(scale(pts, cx, cy, 1.17))}" fill="#7dd3fc" opacity=".55"/>
    ${isles.map((q) => `<polygon points="${P(q)}" fill="${shade(base, 0.2)}" stroke="${shade(base, -0.45)}" stroke-width="2"/>`).join("")}
    <polygon points="${P(pts)}" fill="${shade(base, 0.08)}" stroke="${shade(base, -0.5)}" stroke-width="3.5" stroke-linejoin="round"/>
    ${inner.map((q, i) => `<polygon points="${P(q)}" fill="${shade(base, i % 2 ? -0.18 : 0.22)}" stroke="${shade(base, -0.35)}" stroke-width="1.5" opacity=".9"/>`).join("")}
  </g>`;
}

/* Karte 400 × 1500 Einheiten */
export const MAP_H = 1500;
const WPOS = [[250, 1290, 125, 95], [110, 1020, 100, 82], [290, 760, 105, 85], [110, 500, 95, 80], [270, 220, 112, 92]];
const BPOS = { shop: [80, 1300, "🛒", "Shop", "shop"], tour: [315, 520, "🧭", "Expeditionen", "tour"], relic: [70, 770, "🏺", "Fundstücke", "relic"],
  rad: [318, 1035, "🎡", "Glücksrad", "rad"], ach: [80, 250, "🏆", "Erfolge", "mehr"], meister: [330, 1450, "📜", "Meisterbrief", "mehr"] };

export function mapHTML(g, { opt, badges = {} }) {
  const nw = T.nextWorld(g);
  const svg = `<svg class="ty-sea" viewBox="0 0 400 ${MAP_H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs><pattern id="tyw" width="60" height="40" patternUnits="userSpaceOnUse"><path d="M6 22 q6 -6 12 0 M36 8 q5 -5 10 0" stroke="#bfdbfe" stroke-width="1.6" fill="none" opacity=".55"/></pattern></defs>
    <rect width="400" height="${MAP_H}" fill="#2563eb"/><rect width="400" height="${MAP_H}" fill="url(#tyw)"/>
    ${T.WORLDS.map((w, i) => islandSVG(WPOS[i][0], WPOS[i][1], WPOS[i][2], WPOS[i][3], 11 + i * 37, w.bg, i > g.unlocked)).join("")}
    ${Object.values(BPOS).map(([x, y], i) => islandSVG(x, y + 14, 38, 24, 500 + i * 13, "#16a34a", false)).join("")}
    ${T.eventInfo().active ? islandSVG(228, 400, 62, 44, 4242, T.eventInfo().theme.bg, false) : islandSVG(228, 404, 26, 18, 4243, "#64748b", false)}
  </svg>`;
  const at = (x, y) => `left:${(x / 400) * 100}%;top:${(y / MAP_H) * 100}%`;
  const worlds = T.WORLDS.map((w, i) => {
    const [x, y] = WPOS[i], open = i <= g.unlocked, here = i === g.cur;
    const r = open ? T.rates(g, i, opt()) : null;
    const isNext = nw && nw.wi === i;
    return `<button type="button" class="ty-spot ty-wspot${open ? "" : " locked"}${here ? " here" : ""}" style="${at(x, y)}" data-a="${open ? "goto" : isNext && nw.pct >= 1 ? "unlock" : "lockinfo"}" data-wi="${i}">
      ${here ? `<span class="ty-pin" aria-label="Du bist hier">📍</span>` : ""}
      <span class="ty-land" aria-hidden="true">${open ? w.e : isNext && nw.pct >= 1 ? "🚀" : "🔒"}</span>
      <span class="ty-banner" style="--bb:${open ? w.bg : "#334155"}">${open || isNext ? esc(w.name) : "???"}</span>
      <small class="ty-sub">${open ? `${T.fmt(r.auto)} €/s` : isNext ? (nw.pct >= 1 ? "Jetzt freischalten!" : `${Math.floor(nw.pct * 100)} % · ${T.fmt(nw.need)} €`) : "gesperrt"}</small>
    </button>`;
  }).join("");
  const blds = Object.entries(BPOS).map(([k, [x, y, e, name, v]]) => `<button type="button" class="ty-spot ty-bspot" style="${at(x, y)}" data-a="${k === "rad" ? "rad" : k === "relic" ? "relics" : "view"}" data-v="${v}">
      <span class="ty-land sm" aria-hidden="true">${e}</span><span class="ty-banner sm">${name}</span>${badges[k] ? `<i class="ty-dot">${badges[k]}</i>` : ""}</button>`).join("");
  const I = T.eventInfo(), EP = [228, 392];
  const dleft = (t) => { const ms = t - Date.now(), d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5); return d ? `${d} T ${h} h` : `${h} h`; };
  const evSpot = I.active
    ? `<button type="button" class="ty-spot ty-evspot on" style="${at(EP[0], EP[1])}" data-a="view" data-v="event"><span class="ty-land" aria-hidden="true">${I.theme.e}</span><span class="ty-banner" style="--bb:#ca8a04">🎪 ${esc(I.theme.name)}</span><small class="ty-sub">Event · noch ${dleft(I.end)}</small>${badges.ev ? `<i class="ty-dot">${badges.ev}</i>` : ""}</button>`
    : `<button type="button" class="ty-spot ty-evspot" style="${at(EP[0], EP[1])}" data-a="evsoon"><span class="ty-land sm" aria-hidden="true">🎪</span><small class="ty-sub">Event in ${dleft(I.nextStart)}</small></button>`;
  const clouds = [[30, 180, 0], [220, 640, 8], [60, 1120, 15], [260, 1380, 4]].map(([x, y, d]) => `<span class="ty-cloud" style="${at(x, y)};animation-delay:-${d}s" aria-hidden="true"></span>`).join("");
  return `<div class="ty-mapbar"><button type="button" class="ty-gbtn" data-a="view" data-v="mehr">📜<small>Meisterbrief</small></button><span class="ty-mapt">🗺️ Weltkarte</span><button type="button" class="ty-gbtn" data-a="findme">📍<small>Zu mir</small></button></div>
    <section class="ty-ocean">${svg}${clouds}${worlds}${blds}${evSpot}</section>`;
}
export const worldTop = (wi) => WPOS[wi][1] / MAP_H;

