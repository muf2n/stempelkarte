// ⚡ Strom-Tycoon – Szenen. Aufgeteilt: Karte → ./tycoon-map-art.js, Bergwerk/Event → ./tycoon-mine-art.js, Glücksrad hier.
import * as T from "../tycoon-core.js";
import { esc } from "../util.js";
export { mapHTML, worldTop, MAP_H } from "./tycoon-map-art.js";
export { mineHTML, eventHTML } from "./tycoon-mine-art.js";

/* ---------- Glücksrad ----------
   Drei Lagen: Rahmen mit Lauflichtern (fest) · Segmente (.ty-wsvg, dreht sich) · Glanz, Nabe und Zeiger (fest). */
export function wheelSVG(rot = 0) {
  const n = T.WHEEL.length, seg = 360 / n, C = 150, R = 124;
  const pt = (a, r) => [C + r * Math.cos((a - 90) * Math.PI / 180), C + r * Math.sin((a - 90) * Math.PI / 180)];
  const f = (v) => v.toFixed(1);
  const parts = T.WHEEL.map((w, i) => {
    const [x1, y1] = pt(i * seg, R), [x2, y2] = pt((i + 1) * seg, R), mid = (i + 0.5) * seg, [tx, ty] = pt(mid, 88);
    return `<path d="M${C} ${C} L${f(x1)} ${f(y1)} A${R} ${R} 0 0 1 ${f(x2)} ${f(y2)} Z" fill="${w.c}"/>
      <path d="M${C} ${C} L${f(x1)} ${f(y1)} A${R} ${R} 0 0 1 ${f(x2)} ${f(y2)} Z" fill="url(#tyw-seg)"/>
      <text x="${f(tx)}" y="${f(ty)}" font-size="28" text-anchor="middle" dominant-baseline="central" transform="rotate(${f(mid)} ${f(tx)} ${f(ty)})">${w.e}</text>`;
  }).join("");
  const lines = T.WHEEL.map((_, i) => { const [x, y] = pt(i * seg, R), [sx, sy] = pt(i * seg, R - 4); return `<line x1="${C}" y1="${C}" x2="${f(x)}" y2="${f(y)}"/><circle cx="${f(sx)}" cy="${f(sy)}" r="3.4" class="ty-stud"/>`; }).join("");
  const bulbs = Array.from({ length: 24 }, (_, i) => { const [x, y] = pt(i * 15, 137); return `<circle cx="${f(x)}" cy="${f(y)}" r="4.6" class="ty-bulb ${i % 2 ? "b" : "a"}"/>`; }).join("");
  return `<div class="ty-wheel">
    <svg viewBox="0 0 300 300" class="ty-wrim" aria-hidden="true"><defs>
      <linearGradient id="tyw-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset=".35" stop-color="#f6b928"/><stop offset=".7" stop-color="#c47a0c"/><stop offset="1" stop-color="#ffd76a"/></linearGradient>
      <radialGradient id="tyw-shadow" cx=".5" cy=".5" r=".5"><stop offset=".8" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="150" cy="292" rx="96" ry="7" fill="url(#tyw-shadow)"/>
      <circle cx="150" cy="150" r="148" fill="#5a2a00"/><circle cx="150" cy="150" r="145" fill="url(#tyw-gold)"/>
      <circle cx="150" cy="150" r="130" fill="#3b1c00"/>${bulbs}</svg>
    <svg viewBox="0 0 300 300" class="ty-wsvg" style="transform:rotate(${rot}deg)" aria-hidden="true"><defs>
      <radialGradient id="tyw-seg" cx="150" cy="150" r="124" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset=".92" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient></defs>
      ${parts}<g stroke="#ffe08a" stroke-width="2.4" stroke-linecap="round">${lines}</g></svg>
    <svg viewBox="0 0 300 300" class="ty-wtop" aria-hidden="true"><defs>
      <linearGradient id="tyw-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <radialGradient id="tyw-hub" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff6c4"/><stop offset=".45" stop-color="#f5b324"/><stop offset="1" stop-color="#8a4b00"/></radialGradient>
      <linearGradient id="tyw-pin" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7a7a"/><stop offset=".5" stop-color="#e11d48"/><stop offset="1" stop-color="#8f0b2c"/></linearGradient></defs>
      <path d="M58 104 A100 100 0 0 1 242 104 A170 120 0 0 0 58 104 Z" fill="url(#tyw-gloss)"/>
      <circle cx="150" cy="150" r="30" fill="#5a2a00"/><circle cx="150" cy="150" r="27" fill="url(#tyw-hub)"/><circle cx="150" cy="150" r="18" fill="#7a1028" stroke="#ffe08a" stroke-width="2"/>
      <text x="150" y="151" font-size="20" text-anchor="middle" dominant-baseline="central">⚡</text>
      <g class="ty-wpin"><path d="M150 58 L136 26 A16 16 0 1 1 164 26 Z" fill="#5a2a00" transform="translate(0 3)"/><path d="M150 54 L137 25 A15 15 0 1 1 163 25 Z" fill="url(#tyw-pin)" stroke="#ffe08a" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="150" cy="18" r="5.5" fill="#fff4c2" stroke="#c47a0c" stroke-width="1.5"/><ellipse cx="144" cy="11" rx="4.5" ry="2.2" fill="#fff" opacity=".55"/></g></svg>
  </div>`;
}
