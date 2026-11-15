// ⚡ Strom-Tycoon – gezeichnete Szenen (Ozean-Karte mit Inseln, Bergwerk-Ansicht einer Welt, Glücksrad). Nur HTML/SVG-Bausteine.
// Alles selbst gezeichnet (SVG-Polygone + Emojis), keine fremden Grafiken.
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
  const clouds = [[30, 180, 0], [220, 640, 8], [60, 1120, 15], [260, 1380, 4]].map(([x, y, d]) => `<span class="ty-cloud" style="${at(x, y)};animation-delay:-${d}s" aria-hidden="true"></span>`).join("");
  return `<div class="ty-mapbar"><button type="button" class="ty-gbtn" data-a="view" data-v="mehr">📜<small>Meisterbrief</small></button><span class="ty-mapt">🗺️ Weltkarte</span><button type="button" class="ty-gbtn" data-a="findme">📍<small>Zu mir</small></button></div>
    <section class="ty-ocean">${svg}${clouds}${worlds}${blds}</section>`;
}
export const worldTop = (wi) => WPOS[wi][1] / MAP_H;

/* ---------- Bergwerk-Ansicht einer Welt ---------- */
export function mineHTML(g, { amtN, rates, abil, inv, chest }) {
  const wi = g.cur, Wd = T.world(wi), W = g.worlds[wi];
  const gens = Wd.gens.filter((x) => T.visible(g, x.id));
  const rows = gens.map((x, i) => {
    const st = W.gens[x.id];
    if (!st.lvl) {
      const c = T.genCost(wi, x.id, 0, 1, g);
      return `<div class="ty-row rock" data-g="${x.id}"><span class="ty-num">${i + 1}</span><div class="ty-rock"><span class="ty-rk" aria-hidden="true">🪨🪨🪨</span>
        <div><b>${x.e} ${esc(x.name)}</b><small>${esc(x.joke)}</small></div><button type="button" class="btn sm ty-buy" data-a="buy" data-id="${x.id}" data-cost="${c}">🔨 Bauen<small>${T.fmt(c)} €</small></button></div></div>`;
    }
    const n = amtN(st.lvl, x.id), cost = T.genCost(wi, x.id, st.lvl, n, g), ms = T.nextMilestone(st.lvl);
    return `<div class="ty-row${st.mgr ? " auto" : ""}" data-g="${x.id}"><span class="ty-num">${i + 1}</span>
      <div class="ty-stollen">
        ${st.mgr ? `<span class="ty-pile auto" aria-label="läuft automatisch">💰<b><span data-k="out-${x.id}"></span>/s</b></span>`
          : `<button type="button" class="ty-pile" data-a="tap" data-id="${x.id}"><span class="ty-pf" data-k="buf-bar-${x.id}"></span>💰<b data-k="buf-${x.id}"></b></button>`}
        ${st.mgr ? `<span class="ty-boss" title="Elektriker angestellt" aria-hidden="true">🧑‍🔧</span>` : `<button type="button" class="ty-hire" data-a="hire" data-id="${x.id}" data-cost="${T.mgrCost(wi, x.id, g)}">➕🧑‍🔧<small>${T.fmt(T.mgrCost(wi, x.id, g))} €</small></button>`}
        <span class="ty-worker" aria-hidden="true">👷</span>
        <span class="ty-gen-e" aria-hidden="true">${x.e}</span>
        <button type="button" class="ty-lvl" data-a="buy" data-id="${x.id}" data-cost="${cost}"><b>Stufe ${st.lvl}</b><small>+${n} · ${T.fmt(cost)} €</small></button>
      </div>
      <div class="ty-rowinfo"><b>${esc(x.name)}</b> <span>${st.mgr ? "" : '<span data-k="out-' + x.id + '"></span> €/s · '}${ms ? `noch ${ms - st.lvl} bis ×2` : "alle Boni ✓"}</span>${ms ? `<span class="ty-ms"><i style="width:${(st.lvl / ms) * 100}%"></i></span>` : ""}</div>
    </div>`;
  }).join("");
  const nw = T.nextWorld(g);
  return `<section class="ty-mine" style="--wbg:${Wd.bg}">
    <div class="ty-surface">
      <div class="ty-sun" aria-hidden="true"></div>
      <div class="ty-tower" data-k="grid-box"><span class="ty-bld" aria-hidden="true">🗼</span><b>Leitung</b><small>Stufe ${W.grid} · <span data-k="cap"></span>/s</small>
        <button type="button" class="ty-up" data-a="grid" data-cost="${T.gridCost(wi, W.grid)}">⬆ ${T.fmt(T.gridCost(wi, W.grid))} €</button></div>
      <div class="ty-road"><span class="ty-truck" aria-hidden="true">🚚</span><span class="ty-flow">💶 <b data-k="flow"></b> €/s</span></div>
      <div class="ty-tower right" data-k="umsp-box"><span class="ty-bld" aria-hidden="true">🏭</span><b>Umspannwerk</b><small>Stufe ${W.umsp} · <span data-k="ucap"></span>/s</small>
        <button type="button" class="ty-up" data-a="umsp" data-cost="${T.umspCost(wi, W.umsp)}">⬆ ${T.fmt(T.umspCost(wi, W.umsp))} €</button></div>
    </div>
    <p class="ty-neck" data-k="neck"></p>
    <div class="ty-shaftwrap"><div class="ty-shaft" aria-hidden="true"><span class="ty-cabin">⚡</span></div><div class="ty-rows">${rows}</div></div>
    ${nw ? `<div class="ty-deep"><span aria-hidden="true">🪨⛏️🪨</span><b>${wi === g.unlocked ? `Nächste Welt: ${esc(T.world(nw.wi).name)}` : "Die Karte hat noch mehr Welten"}</b><small>Verdiene in „${esc(T.world(g.unlocked).name)}“ ${T.fmt(nw.need)} €</small><span class="ty-use"><i data-k="next" style="width:${nw.pct * 100}%"></i></span>${nw.pct >= 1 ? `<button type="button" class="btn primary" data-a="unlock">🚀 Freischalten!</button>` : ""}</div>` : `<div class="ty-deep"><b>🌌 Du besitzt das Universum.</b></div>`}
  </section>
  <div class="ty-dock">
    <button type="button" class="ty-dbtn" data-a="view" data-v="shop">🛒<small>Shop</small>${inv ? `<i>${inv}</i>` : ""}</button>
    <button type="button" class="ty-dbtn" data-a="chest"${chest ? "" : " disabled"}>🎁<small>Truhe</small>${chest ? "<i>!</i>" : ""}</button>
    <button type="button" class="ty-boost" data-a="abil"><span class="ty-abil-f" data-k="abil-bar"></span><span class="ty-abil-t">▶❙ Boost! <small data-k="abil"></small></span></button>
    <button type="button" class="ty-dbtn" data-a="all">💰<small>Alles</small></button>
    <button type="button" class="ty-dbtn" data-a="view" data-v="karte">🗺️<small>Karte</small></button>
  </div>`;
}

/* ---------- Glücksrad ---------- */
export function wheelSVG(rot = 0) {
  const n = T.WHEEL.length, seg = 360 / n, R = 100;
  const pt = (a, r = R) => [110 + r * Math.cos((a - 90) * Math.PI / 180), 110 + r * Math.sin((a - 90) * Math.PI / 180)];
  const parts = T.WHEEL.map((w, i) => {
    const [x1, y1] = pt(i * seg), [x2, y2] = pt((i + 1) * seg), [tx, ty] = pt((i + 0.5) * seg, 68);
    return `<path d="M110 110 L${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${w.c}" stroke="#fff" stroke-width="2"/>
      <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="22" text-anchor="middle" dominant-baseline="central">${w.e}</text>`;
  }).join("");
  return `<div class="ty-wheel"><span class="ty-wptr" aria-hidden="true">▼</span><svg viewBox="0 0 220 220" class="ty-wsvg" style="transform:rotate(${rot}deg)" aria-hidden="true">
    <circle cx="110" cy="110" r="106" fill="#fbbf24" stroke="#b45309" stroke-width="4"/>${parts}<circle cx="110" cy="110" r="16" fill="#fff" stroke="#b45309" stroke-width="4"/></svg></div>`;
}
