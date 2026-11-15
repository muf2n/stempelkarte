// ⚡ Strom-Tycoon – Szenen. Aufgeteilt: Karte → ./tycoon-map-art.js, Bergwerk/Event → ./tycoon-mine-art.js, Glücksrad hier.
import * as T from "../tycoon-core.js";
import { esc } from "../util.js";
export { mapHTML, worldTop, MAP_H } from "./tycoon-map-art.js";
export { mineHTML, eventHTML } from "./tycoon-mine-art.js";

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

