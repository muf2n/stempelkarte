// ⚡ Strom-Tycoon – ⛏️ Bergwerk-Ansicht einer Welt + 🎪 Event-Ansicht. Eigene Datei (Agent „Bergwerk“). Stile: css/alltag-tycoon-mine.css
// Vertrag: export mineHTML(g, { amtN, inv, chest }) und eventHTML(g, ev, { amtN }); data-a/data-k/data-cost/data-evcost siehe js/alltag/tycoon.js (refresh + Klicks).
// Kreislauf (nur Optik, reine CSS-Animation): Arbeiter füllen die Lore am Stollen-Eingang → der Liftfahrer fährt jeden Stollen mit Elektriker an,
// lädt ein, fährt hoch und lädt beim Umspannwerk ab → der E-Transporter bringt's zur Strombörse. Die Halte-Zeiten werden hier berechnet
// und als @keyframes in einem <style> mitgeliefert (Stollen-Höhe fest: ROW_H muss zu --tm-rh im CSS passen).
import * as T from "../tycoon-core.js";
import { esc } from "../util.js";

const ROW_H = 128, TOP_H = 40, CAB_H = 56, CAB_STOP = 116; // px – siehe CSS (.tm-row height, .tm-top height, .tm-cab height, Stollen-Boden)
const OL = "#24160c"; // Umrissfarbe (Cartoon)

/* ---------- Lift-Kreislauf ---------- */
/** Fahrplan des Liftes: Stopps bei den Stollen mit Elektriker. Liefert CSS (@keyframes) + Ankunftszeiten je Stollen. */
function liftPlan(autoIdx) {
  if (!autoIdx.length) return { css: "", arr: {}, P: 0 };
  const v = 230, stop = 0.85, un = 1.3, stopY = (i) => TOP_H + i * ROW_H + CAB_STOP - CAB_H;
  const kf = [[0, 0], [un, 0]], arr = {}, cargo = [[0, 1], [un * 0.8, 0]];
  let t = un, y = 0;
  autoIdx.forEach((i, k) => {
    const ny = stopY(i); t += Math.max(0.35, Math.abs(ny - y) / v); arr[i] = t; kf.push([t, ny]);
    cargo.push([t, k / autoIdx.length], [t + stop * 0.7, (k + 1) / autoIdx.length]);
    t += stop; kf.push([t, ny]); y = ny;
  });
  t += Math.max(0.6, y / v); kf.push([t, 0]); cargo.push([t, 1]);
  const P = t, pc = (x) => ((x / P) * 100).toFixed(2) + "%";
  const lift = kf.map(([x, yy]) => `${pc(x)}{transform:translateY(${yy}px);animation-timing-function:ease-in-out}`).join("");
  const crg = cargo.map(([x, f]) => `${pc(x)}{transform:scaleY(${Math.max(0.04, f).toFixed(3)})}`).join("");
  const s = pc(stop * 0.75), s2 = pc(stop * 2.4);
  const css = `@keyframes tm-lift{${lift}}@keyframes tm-cargo{${crg}}
    @keyframes tm-heap{0%{transform:scaleY(1)}${s}{transform:scaleY(.12)}100%{transform:scaleY(1)}}
    @keyframes tm-lpop{0%{opacity:0;transform:translate(-50%,6px) scale(.6)}${pc(stop * 0.3)}{opacity:1;transform:translate(-50%,-6px) scale(1.1)}${s2}{opacity:0;transform:translate(-50%,-30px) scale(1)}100%{opacity:0}}
    @keyframes tm-unpop{0%{opacity:0;transform:translate(-50%,8px) scale(.6)}${pc(un * 0.35)}{opacity:1;transform:translate(-50%,-4px) scale(1.12)}${pc(un * 1.6)}{opacity:0;transform:translate(-50%,-34px) scale(1)}100%{opacity:0}}
    .tm{--tm-P:${P.toFixed(2)}s}`;
  return { css, arr, P };
}
const delay = (plan, i) => `animation-delay:${(plan.arr[i] - plan.P).toFixed(2)}s`;

/* ---------- Zeichnungen (inline-SVG, keine externen Bilder) ---------- */
const svg = (vb, body, cls = "", extra = "") => `<svg class="${cls}" viewBox="${vb}" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

/** Hintergrund-Szenerie über der Erde, je Welt. */
function sceneSVG(id) {
  const cloud = (x, y, s, c = "#fff") => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 18c-8 0-12-10-4-14 0-9 13-12 18-5 5-8 19-6 20 4 9-1 12 13 2 15z" fill="${c}" stroke="${OL}" stroke-opacity=".18" stroke-width="2"/></g>`;
  const stars = (n, seed, h = 110) => { let s = seed, o = ""; for (let i = 0; i < n; i++) { s = (s * 9301 + 49297) % 233280; const x = (s / 233280) * 400; s = (s * 9301 + 49297) % 233280; const y = (s / 233280) * h; o += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 5 ? 0.9 : 1.7}" fill="#fff" opacity="${i % 3 ? 0.7 : 1}"/>`; } return o; };
  switch (id) {
    case "baustelle": return svg("0 0 400 150", `<defs><linearGradient id="tmsk1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc4f2"/><stop offset=".7" stop-color="#ffe2a8"/><stop offset="1" stop-color="#ffc979"/></linearGradient></defs>
      <rect width="400" height="150" fill="url(#tmsk1)"/><circle cx="330" cy="40" r="20" fill="#fff3c4"/><circle cx="330" cy="40" r="30" fill="#fff3c4" opacity=".35"/>
      <g class="tm-drift">${cloud(40, 18, 1.1)}${cloud(220, 30, .8)}</g>
      <path d="M0 132 Q60 110 120 124 T260 118 T400 122 V150 H0z" fill="#e3b26a" stroke="${OL}" stroke-opacity=".25" stroke-width="2"/>
      <g stroke="${OL}" stroke-width="2.5" stroke-linejoin="round"><rect x="236" y="62" width="80" height="70" fill="#c9cdd3"/><path d="M236 85h80M236 108h80M262 62v70M290 62v70" stroke-width="2"/>
      <rect x="244" y="90" width="12" height="12" fill="#ffd166"/><rect x="298" y="68" width="12" height="12" fill="#ffd166"/></g>
      <g stroke="${OL}" stroke-width="2.5" stroke-linejoin="round" fill="#f5b700"><path d="M150 132V22h10v110z"/><path d="M150 32h10M150 52h10M150 72h10M150 92h10M150 112h10" stroke-width="1.6"/><path d="M60 22h200v9H60z"/><path d="M80 22l75-14 5 14"/><rect x="60" y="31" width="22" height="14" fill="#5b6472"/></g>
      <g class="tm-swing"><path d="M230 31v42" stroke="${OL}" stroke-width="1.6"/><path d="M224 73h12l-2 9h-8z" fill="#ef4444" stroke="${OL}" stroke-width="2"/><rect x="221" y="82" width="18" height="12" fill="#8b5a2b" stroke="${OL}" stroke-width="2"/></g>
      <g stroke="${OL}" stroke-width="2"><path d="M340 132l7-20 7 20z" fill="#f97316"/><path d="M343 124h8" stroke="#fff" stroke-width="3"/><path d="M366 132l6-16 6 16z" fill="#f97316"/></g>`, "tm-scene", ' preserveAspectRatio="xMidYMax slice"');
    case "stadt": return svg("0 0 400 150", `<defs><linearGradient id="tmsk2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2a6e"/><stop offset=".55" stop-color="#9b4d9e"/><stop offset="1" stop-color="#ff9a6b"/></linearGradient></defs>
      <rect width="400" height="150" fill="url(#tmsk2)"/>${stars(18, 7, 60)}<circle cx="70" cy="34" r="14" fill="#fff4d6"/><circle cx="76" cy="30" r="13" fill="#3a3577" opacity=".9"/>
      <g fill="#4a3f86" opacity=".9">${[[0,70,40],[40,52,36],[80,80,30],[112,40,44],[160,64,34],[196,30,40],[240,58,32],[276,44,46],[326,72,30],[360,50,40]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${150 - y}"/>`).join("")}</g>
      <g stroke="${OL}" stroke-width="2.5" stroke-linejoin="round">${[[10,88,38,"#33407d"],[52,70,30,"#3b4a91"],[88,96,36,"#2d3870"],[130,58,40,"#3d4c99"],[176,84,30,"#33407d"],[212,50,36,"#2a3468"],[254,78,40,"#3b4a91"],[300,92,34,"#2d3870"],[338,66,44,"#33407d"]].map(([x, y, w, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${152 - y}" fill="${c}"/>`).join("")}</g>
      <g fill="#ffd36b">${[[16,96],[28,108],[58,80],[66,96],[94,104],[108,116],[138,66],[150,82],[138,98],[182,92],[220,60],[220,78],[232,96],[262,88],[278,104],[306,100],[346,76],[362,92],[350,108],[318,116],[156,116],[196,120]].map(([x, y]) => `<rect x="${x}" y="${y}" width="6" height="7" rx="1"/>`).join("")}</g>
      <path d="M216 50v-14M218 36l-2-6" stroke="${OL}" stroke-width="2"/><circle cx="216" cy="34" r="2.6" fill="#ef4444" class="tm-blink"/>`, "tm-scene", ' preserveAspectRatio="xMidYMax slice"');
    case "mond": return svg("0 0 400 150", `<defs><linearGradient id="tmsk3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#090418"/><stop offset="1" stop-color="#2e1866"/></linearGradient><radialGradient id="tmea" cx=".35" cy=".35"><stop offset="0" stop-color="#7fd3ff"/><stop offset=".7" stop-color="#2563eb"/><stop offset="1" stop-color="#1e3a8a"/></radialGradient></defs>
      <rect width="400" height="150" fill="url(#tmsk3)"/><g class="tm-twinkle">${stars(46, 3)}</g>
      <circle cx="300" cy="40" r="24" fill="url(#tmea)" stroke="${OL}" stroke-width="2.5"/><path d="M286 30c6-4 10 2 16 0s6 8 0 10-8 6-14 2-6-8-2-12zM306 52c4-2 8 0 9 3-3 3-8 3-9-3z" fill="#4ade80" stroke="${OL}" stroke-width="1.2" stroke-opacity=".5"/><circle cx="300" cy="40" r="34" fill="#60a5fa" opacity=".12"/>
      <path d="M0 120 Q50 92 110 112 T220 104 T330 110 T400 100 V150 H0z" fill="#7d8193" stroke="${OL}" stroke-width="2.5"/>
      <g fill="#5f6373" stroke="${OL}" stroke-width="1.5" stroke-opacity=".5"><ellipse cx="60" cy="122" rx="16" ry="4"/><ellipse cx="180" cy="114" rx="11" ry="3"/><ellipse cx="350" cy="116" rx="14" ry="3.5"/></g>
      <g stroke="${OL}" stroke-width="2.5" stroke-linejoin="round"><path d="M222 112a30 26 0 0 1 60 0z" fill="#bfe8ff" fill-opacity=".75"/><path d="M232 112a20 18 0 0 1 22-18" fill="none" stroke="#fff" stroke-width="2" stroke-opacity=".8"/><rect x="216" y="110" width="72" height="8" rx="2" fill="#c7cbd6"/>
      <path d="M120 112V78" stroke-width="2"/><path d="M110 76a12 6 0 0 0 20 0z" fill="#c7cbd6"/></g><circle cx="120" cy="72" r="2.6" fill="#f43f5e" class="tm-blink"/>`, "tm-scene", ' preserveAspectRatio="xMidYMax slice"');
    case "galaxie": return svg("0 0 400 150", `<defs><radialGradient id="tmnb1"><stop offset="0" stop-color="#f472b6" stop-opacity=".75"/><stop offset="1" stop-color="#f472b6" stop-opacity="0"/></radialGradient><radialGradient id="tmnb2"><stop offset="0" stop-color="#22d3ee" stop-opacity=".6"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient><radialGradient id="tmpl" cx=".35" cy=".3"><stop offset="0" stop-color="#fde68a"/><stop offset=".6" stop-color="#f97316"/><stop offset="1" stop-color="#9a3412"/></radialGradient></defs>
      <rect width="400" height="150" fill="#070617"/><ellipse cx="110" cy="50" rx="130" ry="60" fill="url(#tmnb1)"/><ellipse cx="300" cy="70" rx="120" ry="55" fill="url(#tmnb2)"/>
      <g class="tm-twinkle">${stars(60, 11, 140)}</g>
      <g stroke="${OL}" stroke-width="2.5"><circle cx="318" cy="44" r="20" fill="url(#tmpl)"/><ellipse cx="318" cy="46" rx="36" ry="8" fill="none" stroke="#fde68a" stroke-width="3.5" transform="rotate(-14 318 46)"/></g>
      <g class="tm-comet"><path d="M60 26l-46 14" stroke="#e0f2fe" stroke-width="4" stroke-linecap="round" opacity=".55"/><circle cx="62" cy="25" r="4" fill="#fff"/></g>
      <path d="M0 126 L40 108 70 118 110 98 150 116 200 104 240 120 290 100 330 114 370 104 400 112 V150 H0z" fill="#3b2d6e" stroke="${OL}" stroke-width="2.5" stroke-linejoin="round"/>
      <g stroke="${OL}" stroke-width="2" stroke-linejoin="round"><path d="M96 116l8-24 8 24z" fill="#a78bfa"/><path d="M104 92l-2 24" stroke="#ede9fe" stroke-width="1.5"/><path d="M118 118l5-14 5 14z" fill="#22d3ee"/><path d="M256 118l7-20 7 20z" fill="#f472b6"/></g>`, "tm-scene", ' preserveAspectRatio="xMidYMax slice"');
    case "garage": default: return svg("0 0 400 150", `<defs><linearGradient id="tmsk0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fb8f5"/><stop offset="1" stop-color="#c9ecff"/></linearGradient></defs>
      <rect width="400" height="150" fill="url(#tmsk0)"/><g class="tm-sunr"><circle cx="340" cy="34" r="30" fill="#fff7c2" opacity=".5"/></g><circle cx="340" cy="34" r="17" fill="#ffe14d" stroke="${OL}" stroke-width="2.5"/>
      <g class="tm-drift">${cloud(30, 16, 1.2)}${cloud(190, 8, .9)}${cloud(268, 40, .7)}</g>
      <path d="M0 122 Q70 92 150 114 T300 106 T400 112 V150 H0z" fill="#8fd16a" stroke="${OL}" stroke-opacity=".3" stroke-width="2"/>
      <g stroke="${OL}" stroke-width="2.5" stroke-linejoin="round"><path d="M216 84l42-26 42 26z" fill="#c2410c"/><rect x="222" y="84" width="72" height="50" fill="#f3e3c3"/><rect x="236" y="98" width="44" height="36" fill="#9ca3af"/>
      <path d="M236 106h44M236 114h44M236 122h44" stroke-width="1.6"/><rect x="250" y="66" width="16" height="10" fill="#7dd3fc"/></g>
      <g stroke="${OL}" stroke-width="2.5"><rect x="330" y="96" width="9" height="40" fill="#7a4a26"/><circle cx="334" cy="86" r="22" fill="#4fae3c"/><circle cx="322" cy="96" r="13" fill="#4fae3c"/><circle cx="348" cy="96" r="13" fill="#4fae3c"/></g>
      <g fill="#fbe7c6" stroke="${OL}" stroke-width="1.8">${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => `<path d="M${120 + k * 12} 136v-18l4-5 4 5v18z"/>`).join("")}<rect x="118" y="122" width="96" height="4"/></g>`, "tm-scene", ' preserveAspectRatio="xMidYMax slice"');
  }
}

/** Fördergerüst + Hochspannungsmast über dem Schacht (= „Leitung“). */
const PYLON = svg("0 0 62 128", `<g stroke="${OL}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
  <path d="M12 126L25 18h12l13 108z" fill="#d6dbe3"/><path d="M19 120L28 34 M43 120 34 34 M16 104h30M19 82h24M22 60h18M24 42h14" fill="none" stroke-width="2"/>
  <path d="M17 112 L41 86 M45 112 L21 86 M21 82 L39 62 M41 82 L23 62 M24 58 L37 44 M38 58 L25 44" fill="none" stroke-width="1.6" stroke-opacity=".75"/>
  <path d="M2 30h58v6H2z" fill="#9aa4b2"/><path d="M8 50h46v5H8z" fill="#9aa4b2"/>
  <path d="M5 36v7M57 36v7M11 55v6M51 55v6" stroke-width="2"/><g fill="#7dd3fc"><rect x="2.5" y="41" width="5" height="5" rx="1.5"/><rect x="54.5" y="41" width="5" height="5" rx="1.5"/><rect x="8.5" y="59" width="5" height="5" rx="1.5"/><rect x="48.5" y="59" width="5" height="5" rx="1.5"/></g>
  <path d="M31 4v14" /><circle cx="31" cy="4" r="3" fill="#ef4444"/></g>
  <g class="tm-wheel" style="transform-origin:31px 24px"><circle cx="31" cy="24" r="8" fill="#f59e0b" stroke="${OL}" stroke-width="2.4"/><path d="M31 16v16M23 24h16M25.3 18.3l11.4 11.4M36.7 18.3 25.3 29.7" stroke="${OL}" stroke-width="1.5"/><circle cx="31" cy="24" r="2.2" fill="${OL}"/></g>`, "tm-pylon");

/** Umspannwerk (= Lager) mit Trafos. */
const UMSP = svg("0 0 132 96", `<g stroke="${OL}" stroke-width="2.6" stroke-linejoin="round">
  <path d="M4 38l36-20 36 20z" fill="#b91c1c"/><path d="M8 38h64v56H8z" fill="#f1e4cc"/><path d="M8 50h64M8 62h64M8 74h64M8 86h64" stroke="#c9b18c" stroke-width="1.4"/>
  <path d="M30 94V68a10 10 0 0 1 20 0v26z" fill="#6b7280"/><path d="M30 74h20M30 81h20M30 88h20" stroke-width="1.4"/>
  <rect x="14" y="44" width="12" height="12" fill="#ffd34d"/><rect x="54" y="44" width="12" height="12" fill="#ffd34d"/>
  <circle cx="40" cy="31" r="7" fill="#facc15"/><path d="M41 26l-4 6h4l-2 5 5-7h-4z" fill="${OL}" stroke-width="0"/>
  <rect x="78" y="50" width="48" height="40" rx="3" fill="#94a3b8"/><path d="M84 54v32M90 54v32M96 54v32M102 54v32M108 54v32M114 54v32M120 54v32" stroke-width="1.6" stroke-opacity=".6"/>
  <path d="M76 90h52v5H76z" fill="#facc15"/><path d="M80 90l4 5M88 90l4 5M96 90l4 5M104 90l4 5M112 90l4 5M120 90l4 5" stroke-width="2"/>
  <g fill="#e2e8f0"><path d="M86 50V36"/><rect x="82" y="32" width="8" height="5" rx="2"/><rect x="82" y="39" width="8" height="5" rx="2"/><rect x="82" y="46" width="8" height="4" rx="2"/>
  <rect x="98" y="28" width="8" height="5" rx="2"/><rect x="98" y="35" width="8" height="5" rx="2"/><rect x="98" y="42" width="8" height="5" rx="2"/>
  <rect x="114" y="32" width="8" height="5" rx="2"/><rect x="114" y="39" width="8" height="5" rx="2"/><rect x="114" y="46" width="8" height="4" rx="2"/></g></g>
  <g class="tm-zap"><path d="M102 22l-5 6h4l-3 6 7-8h-4l3-4z" fill="#fde047" stroke="${OL}" stroke-width="1.4"/></g>`, "tm-umsp");

/** Strombörse (Verkauf). */
const KASSE = svg("0 0 96 84", `<g stroke="${OL}" stroke-width="2.6" stroke-linejoin="round">
  <rect x="12" y="34" width="72" height="48" fill="#fef3c7"/><rect x="18" y="40" width="60" height="22" fill="#1e293b"/>
  <path d="M22 56l10-6 8 3 10-8 8 4 10-9" fill="none" stroke="#4ade80" stroke-width="2.4" stroke-linecap="round"/><path d="M70 34l8 0-1 6" fill="none" stroke="#4ade80" stroke-width="2" stroke-opacity="0"/>
  <path d="M8 64h80v18H8z" fill="#a16207"/><path d="M8 70h80" stroke-width="1.6" stroke-opacity=".5"/>
  <path d="M4 34L12 16h72l8 18z" fill="#ef4444"/><path d="M24 16l-5 18M40 16l-3 18M56 16l3 18M72 16l5 18" stroke-width="0"/>
  <path d="M20 16l-4 18h8l3-18zM44 16l-1 18h8l-1-18zM68 16l3 18h8l-4-18z" fill="#fff" stroke-width="0"/><path d="M4 34L12 16h72l8 18z" fill="none"/>
  <path d="M4 34q6 6 11 0q6 6 11 0q6 6 11 0q6 6 11 0q6 6 11 0q6 6 11 0q6 6 11 0q6 6 11 0" fill="#ef4444"/>
  <rect x="22" y="4" width="52" height="13" rx="3" fill="#1d4ed8"/></g>
  <text x="48" y="13.8" text-anchor="middle" font-size="8.4" font-weight="900" fill="#fff" font-family="system-ui,sans-serif" letter-spacing=".3">BÖRSE</text>
  <g stroke="${OL}" stroke-width="1.6"><ellipse cx="66" cy="62" rx="7" ry="2.6" fill="#facc15"/><ellipse cx="66" cy="59" rx="7" ry="2.6" fill="#facc15"/><ellipse cx="66" cy="56" rx="7" ry="2.6" fill="#fde047"/><ellipse cx="54" cy="62" rx="7" ry="2.6" fill="#facc15"/><ellipse cx="54" cy="59" rx="7" ry="2.6" fill="#fde047"/></g>`, "tm-kasse");

/** E-Transporter (fährt nach rechts; zurück gespiegelt). */
const VAN = svg("0 0 48 30", `<g stroke="${OL}" stroke-width="2.2" stroke-linejoin="round"><path d="M2 8h28v16H2z" fill="#fff"/><path d="M30 12h9l6 7v5H30z" fill="#22c55e"/><path d="M33 14h5l3 4h-8z" fill="#bae6fd" stroke-width="1.6"/>
  <path d="M2 18h28" stroke="#22c55e" stroke-width="3"/><circle cx="16" cy="13" r="4.2" fill="#facc15" stroke-width="1.6"/><path d="M16.8 10.2l-2.4 3.2h2l-1 2.6 2.8-3.6h-2z" fill="${OL}" stroke-width="0"/>
  <circle cx="11" cy="25" r="4" fill="#334155"/><circle cx="37" cy="25" r="4" fill="#334155"/><circle cx="11" cy="25" r="1.4" fill="#cbd5e1" stroke-width="0"/><circle cx="37" cy="25" r="1.4" fill="#cbd5e1" stroke-width="0"/></g>
  <g class="tm-crates" stroke="${OL}" stroke-width="1.8"><rect x="5" y="1" width="9" height="8" fill="#f59e0b"/><rect x="15" y="1" width="9" height="8" fill="#fbbf24"/><rect x="9" y="-6" width="9" height="7" fill="#f59e0b"/></g>`, "tm-van", ' overflow="visible"');

/** Kraftwerks-Maschine (3 Bauformen), Emoji sitzt im Bullauge. */
function machineSVG(k) {
  const g = `stroke="${OL}" stroke-width="2.6" stroke-linejoin="round"`;
  if (k === 1) return svg("0 0 64 76", `<g ${g}><path d="M10 72h44l-4-8H14z" fill="#64748b"/><rect x="12" y="20" width="40" height="46" rx="8" fill="var(--tm-m1)"/><path d="M12 32h40M12 54h40" stroke-width="2" stroke-opacity=".5"/>
    <path d="M20 20v-6h24v6" fill="#b45309"/><g fill="#d97706"><rect x="18" y="4" width="28" height="5" rx="2.5"/><rect x="18" y="10" width="28" height="5" rx="2.5"/></g>
    <circle cx="32" cy="43" r="15" fill="#0f172a"/><circle cx="32" cy="43" r="15" fill="none" stroke="#cbd5e1" stroke-width="3.2"/></g>
    <circle class="tm-led" cx="47" cy="27" r="2.6" stroke="${OL}" stroke-width="1.4"/>`, "tm-mach");
  if (k === 2) return svg("0 0 64 76", `<g ${g}><path d="M8 72h48l-3-7H11z" fill="#64748b"/><path d="M8 65V26q0-8 8-8h32q8 0 8 8v39z" fill="var(--tm-m1)"/>
    <circle cx="32" cy="43" r="17" fill="#cbd5e1"/><circle cx="32" cy="43" r="13" fill="#0f172a"/><path d="M8 26h48" stroke-width="2" stroke-opacity=".5"/>
    <path d="M44 18V8h8v10" fill="#94a3b8"/><path d="M42 8h12" /></g><g class="tm-smoke"><circle cx="48" cy="2" r="3.4" fill="#e5e7eb" opacity=".8"/></g>
    <circle class="tm-led" cx="14" cy="24" r="2.6" stroke="${OL}" stroke-width="1.4"/>`, "tm-mach");
  return svg("0 0 64 76", `<g ${g}><path d="M6 72h52l-3-7H9z" fill="#64748b"/><rect x="6" y="14" width="52" height="51" rx="6" fill="var(--tm-m1)"/>
    <path d="M6 24h52" stroke-width="2" stroke-opacity=".5"/><g fill="#cbd5e1" stroke-width="1.4"><circle cx="11" cy="19" r="1.8"/><circle cx="53" cy="19" r="1.8"/><circle cx="11" cy="60" r="1.8"/><circle cx="53" cy="60" r="1.8"/></g>
    <circle cx="32" cy="43" r="16" fill="#0f172a"/><circle cx="32" cy="43" r="16" fill="none" stroke="#fbbf24" stroke-width="3.4"/>
    <path d="M18 14l4-8h20l4 8" fill="#475569"/></g><circle class="tm-led" cx="32" cy="9.5" r="2.6" stroke="${OL}" stroke-width="1.4"/>`, "tm-mach");
}

/** Liftkabine (Förderkorb) – Rider + Ladung. */
const CAGE = svg("0 0 50 56", `<g stroke="${OL}" stroke-width="2.6" stroke-linejoin="round"><path d="M4 8h42v46H4z" fill="none"/>
  <path d="M4 54h42v-5H4z" fill="#78350f"/><path d="M4 8h42v6H4z" fill="#f59e0b"/><path d="M4 14v35M46 14v35" stroke="#f59e0b" stroke-width="5"/><path d="M4 14v35M46 14v35" stroke-width="1.4"/>
  <path d="M8 18l34 28M42 18L8 46" stroke="#f59e0b" stroke-width="1.6" stroke-opacity=".7"/><path d="M18 8l7-6 7 6" fill="none" stroke-width="2.2"/></g>`, "tm-cage");

/* ---------- Bausteine ---------- */
const ms = (lvl) => { const m = T.nextMilestone(lvl), p = T.MILESTONES.filter((x) => x <= lvl).pop() || 0;
  return m ? `<span class="tm-ms" title="noch ${m - lvl} bis ×2"><i style="width:${(((lvl - p) / (m - p)) * 100).toFixed(1)}%"></i><em>×2 · ${lvl}/${m}</em></span>` : `<span class="tm-ms done"><em>alle Boni ✓</em></span>`; };

function rowHTML({ i, x, st, plan, ev, cost, n, mgrCost }) {
  const cur = ev ? "🎫" : "€", a = ev ? "ev" : "", ck = ev ? "data-evcost" : "data-cost", k = ev ? "evbuf" : "buf", ok = ev ? "evout" : "out";
  const auto = st.mgr, slow = auto ? "" : " slow";
  const pile = auto
    ? `<span class="tm-pile auto" aria-label="läuft automatisch"><span class="tm-cart"><span class="tm-heap" style="${delay(plan, i)}"></span></span><b class="tm-o"><span data-k="${ok}-${x.id}"></span>/s</b>
        <span class="tm-lpop tm-o" style="${delay(plan, i)}" aria-hidden="true">+<span data-k="${ok}-${x.id}"></span> ${cur}</span></span>`
    : `<button type="button" class="tm-pile" data-a="${a}tap" data-id="${x.id}" aria-label="${esc(x.name)}: einsammeln"><span class="tm-cart"><span class="ty-pf tm-heap" data-k="${k}-bar-${x.id}"></span><i class="tm-bang" aria-hidden="true">!</i></span><b class="tm-o" data-k="${k}-${x.id}"></b></button>`;
  const boss = auto
    ? `<span class="ty-boss tm-boss" title="Elektriker angestellt" aria-hidden="true"><span>🧑‍🔧</span></span>`
    : `<button type="button" class="tm-hire" data-a="${a}hire" data-id="${x.id}" ${ck}="${mgrCost}" aria-label="Elektriker anstellen"><span class="tm-hf" aria-hidden="true">🧑‍🔧</span><em aria-hidden="true">+</em><small>${T.fmt(mgrCost)} ${cur}</small></button>`;
  return `<div class="ty-row tm-row${auto ? " auto" : ""}" data-g="${x.id}" style="--i:${i}">
    <div class="tm-sign"><span class="tm-num">${i + 1}</span><b>${esc(x.name)}</b>${ev ? "" : ms(st.lvl)}</div>
    <div class="tm-tun">
      <span class="tm-lamp" aria-hidden="true"></span>
      ${pile}${boss}
      <span class="tm-walk${slow}" aria-hidden="true"><span class="tm-wk"><span class="tm-wb">👷<i>⚡</i></span></span></span>
      <span class="tm-gen${auto ? " on" : ""}" aria-hidden="true">${machineSVG(i % 3)}<span class="tm-ge">${x.e}</span><span class="tm-spark"></span>${auto ? "" : `<small class="tm-rate"><span data-k="${ok}-${x.id}"></span>/s</small>`}</span>
    </div>
    <button type="button" class="tm-lvl" data-a="${a}buy" data-id="${x.id}" ${ck}="${cost}"><b>Stufe ${st.lvl}</b><small>+${n} · ${T.fmt(cost)} ${cur}</small></button>
  </div>`;
}

function rockHTML({ i, x, cost, ev }) {
  return `<div class="ty-row rock tm-rock" data-g="${x.id}" style="--i:${i}">
    <div class="tm-rwall" aria-hidden="true"><span class="tm-crack"></span><span class="tm-pick">⛏️</span></div>
    <div class="tm-rsign"><b><span class="tm-num">${i + 1}</span>${x.e} ${esc(x.name)}</b><small>${esc(x.joke)}</small></div>
    <button type="button" class="tm-build" data-a="${ev ? "evbuy" : "buy"}" data-id="${x.id}" ${ev ? "data-evcost" : "data-cost"}="${cost}"><b>🔨 Bauen</b><small>${T.fmt(cost)} ${ev ? "🎫" : "€"}</small></button>
  </div>`;
}

function shaftHTML(plan, rider, cargoE) {
  const anim = plan.P ? "" : " idle";
  return `<div class="tm-shaft${anim}" aria-hidden="true"><span class="tm-cable"></span>
    <span class="tm-track"><span class="ty-cabin tm-cab"><span class="tm-cbl"></span>${CAGE}<span class="tm-cargo"><i>${cargoE}</i></span><span class="tm-rider">${rider}</span></span></span></div>`;
}

/* ---------- Bergwerk-Ansicht einer Welt ---------- */
export function mineHTML(g, { amtN, inv, chest }) {
  const wi = g.cur, Wd = T.world(wi), W = g.worlds[wi];
  const gens = Wd.gens.filter((x) => T.visible(g, x.id));
  const autoIdx = gens.map((x, i) => (W.gens[x.id].lvl && W.gens[x.id].mgr ? i : -1)).filter((i) => i >= 0);
  const plan = liftPlan(autoIdx), live = plan.P > 0;
  const rows = gens.map((x, i) => {
    const st = W.gens[x.id];
    if (!st.lvl) return rockHTML({ i, x, cost: T.genCost(wi, x.id, 0, 1, g) });
    const n = amtN(st.lvl, x.id);
    return rowHTML({ i, x, st, plan, cost: T.genCost(wi, x.id, st.lvl, n, g), n, mgrCost: T.mgrCost(wi, x.id, g) });
  }).join("");
  const nw = T.nextWorld(g), gc = T.gridCost(wi, W.grid), uc = T.umspCost(wi, W.umsp);
  return `${plan.css ? `<style>${plan.css}</style>` : ""}<section class="ty-mine tm w-${Wd.id}${live ? " live" : ""}" style="--wbg:${Wd.bg}">
    <div class="ty-surface tm-surf">
      ${sceneSVG(Wd.id)}
      <div class="tm-ground" aria-hidden="true"><span class="tm-road"></span><span class="tm-hole"></span></div>
      <svg class="tm-wires" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 4 Q50 22 100 14" /><path d="M0 22 Q50 36 100 26" /><path class="tm-flowln" d="M0 4 Q50 22 100 14" /><path class="tm-flowln" d="M0 22 Q50 36 100 26" /></svg>
      <div class="tm-b tm-lei" data-k="grid-box">
        <span class="tm-plate"><b>Leitung</b><small><span data-k="cap"></span>/s</small></span>${PYLON}
        <button type="button" class="tm-up" data-a="grid" data-cost="${gc}" aria-label="Leitung ausbauen"><b>Stufe ${W.grid}</b><small>⬆ ${T.fmt(gc)} €</small></button>
      </div>
      <div class="tm-b tm-ums" data-k="umsp-box">
        <span class="tm-plate"><b>Umspannwerk</b><small><span data-k="ucap"></span>/s</small></span>
        <span class="tm-art">${UMSP}<span class="tm-unpop tm-o" aria-hidden="true">+⚡</span></span>
        <button type="button" class="tm-up" data-a="umsp" data-cost="${uc}" aria-label="Umspannwerk ausbauen"><b>Stufe ${W.umsp}</b><small>⬆ ${T.fmt(uc)} €</small></button>
      </div>
      <div class="tm-b tm-ks">
        <span class="tm-flow tm-o">💶 <b data-k="flow"></b> €/s</span>
        <span class="tm-art">${KASSE}<span class="tm-coins" aria-hidden="true"><i>🪙</i><i>🪙</i><i>🪙</i></span></span>
      </div>
      <span class="tm-vtrack" aria-hidden="true"><span class="tm-vmove">${VAN}<span class="tm-puff"></span></span></span>
    </div>
    <div class="ty-shaftwrap tm-wrap">${shaftHTML(plan, "👷", "⚡")}
      <div class="tm-rows"><div class="tm-top"><p class="ty-neck tm-neck" data-k="neck"></p></div>${rows}</div></div>
    ${nw ? `<div class="ty-deep tm-deep"><span class="tm-gems" aria-hidden="true">💎</span><b class="tm-o">${wi === g.unlocked ? `Nächste Welt: ${esc(T.world(nw.wi).name)}` : "Die Karte hat noch mehr Welten"}</b><small>Verdiene in „${esc(T.world(g.unlocked).name)}“ ${T.fmt(nw.need)} €</small><span class="ty-use tm-bar"><i data-k="next" style="width:${nw.pct * 100}%"></i></span>${nw.pct >= 1 ? `<button type="button" class="tm-go" data-a="unlock">🚀 Freischalten!</button>` : ""}</div>` : `<div class="ty-deep tm-deep"><span class="tm-gems" aria-hidden="true">🌌</span><b class="tm-o">Du besitzt das Universum.</b></div>`}
  </section>
  <div class="ty-dock tm-dock">
    <button type="button" class="tm-db b" data-a="view" data-v="shop"><span aria-hidden="true">🛒</span><small>Shop</small>${inv ? `<i>${inv}</i>` : ""}</button>
    <button type="button" class="tm-db o${chest ? " has" : ""}" data-a="chest"${chest ? "" : " disabled"}><span aria-hidden="true">🎁</span><small>Truhe</small>${chest ? "<i>!</i>" : ""}</button>
    <button type="button" class="ty-boost tm-boost" data-a="abil"><span class="ty-abil-f tm-bf" data-k="abil-bar"></span><span class="tm-bt"><b class="tm-o">⚡ BOOST!</b><small data-k="abil"></small></span></button>
    <button type="button" class="tm-db y" data-a="all"><span aria-hidden="true">💰</span><small>Alles</small></button>
    <button type="button" class="tm-db t" data-a="view" data-v="karte"><span aria-hidden="true">🗺️</span><small>Karte</small></button>
  </div>`;
}

/* ---------- 🎪 Event-Ansicht ---------- */
export function eventHTML(g, ev, { amtN }) {
  const th = ev.theme, I = ev.info, can = T.evClaimable(ev);
  const left = I.end - Date.now(), d = Math.floor(left / 864e5), h = Math.floor((left % 864e5) / 36e5);
  const gens = th.gens.filter((x) => T.evVisible(ev, x.id));
  const autoIdx = gens.map((x, i) => (ev.gens[x.id].lvl && ev.gens[x.id].mgr ? i : -1)).filter((i) => i >= 0);
  const plan = liftPlan(autoIdx);
  const rows = gens.map((x, i) => {
    const st = ev.gens[x.id];
    if (!st.lvl) return rockHTML({ i, x, cost: T.evGenCost(th, x.id, 0), ev: true });
    const n = amtN(st.lvl, x.id, true);
    return rowHTML({ i, x, st, plan, ev: true, cost: T.evGenCost(th, x.id, st.lvl, n), n, mgrCost: T.evMgrCost(th, x.id) });
  }).join("");
  const max = Math.log10(T.EV_TRACK[T.EV_TRACK.length - 1].at), pos = (v) => Math.max(0, Math.min(100, (Math.log10(Math.max(1, v)) / max) * 100));
  return `${plan.css ? `<style>${plan.css}</style>` : ""}<section class="ty-evhead tm-evhead" style="--ebg:${th.bg}"><div class="ty-evtop"><span class="ty-eve" aria-hidden="true">${th.e}</span><div><b class="tm-o">🎪 ${esc(th.name)}</b><small>Event endet in ${d ? `${d} T ` : ""}${h} h</small></div></div>
      <div class="ty-evmoney tm-o">🎫 <b data-k="evmoney"></b><small><span data-k="evrate"></span> 🎫/s</small></div>
      <div class="ty-evtrack"><span class="ty-evbar"><i data-k="evbar" style="width:${pos(ev.total)}%"></i></span>${T.EV_TRACK.map((x, i) => `<span class="ty-evm${ev.claimed.includes(i) ? " got" : ev.total >= x.at ? " ready" : ""}" style="left:${pos(x.at)}%" title="${esc(x.t)} (ab ${T.fmt(x.at)} 🎫)">${x.e}</span>`).join("")}</div>
      ${can.length ? `<button type="button" class="tm-go" data-a="evclaim">🎁 ${can.length} Belohnung${can.length > 1 ? "en" : ""} abholen!</button>` : `<small>Nächste Belohnung: ${(() => { const nx = T.EV_TRACK.find((x, i) => !ev.claimed.includes(i) && ev.total < x.at); return nx ? `${nx.e} ${esc(nx.t)} bei ${T.fmt(nx.at)} 🎫 gesamt` : "alles geholt – Champion! 🏆"; })()}</small>`}
    </section>
    <section class="ty-mine tm w-ev${plan.P ? " live" : ""}" style="--wbg:${th.bg}">
      <div class="ty-shaftwrap tm-wrap">${shaftHTML(plan, "👷", th.e)}
        <div class="tm-rows"><div class="tm-top ev"><p class="tm-neck">${th.e} Event-Stollen – Elektriker fahren den Lift von selbst</p></div>${rows}</div></div>
    </section>
    <p class="note">🎫 Event-Münzen gibt's nur während des Events. Elektriker arbeiten auch hier offline weiter. Alle 3 Wochen kommt ein neues Event!</p>`;
}
