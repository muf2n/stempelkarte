// Update 17 – Anzeige-Bausteine „Wie lange war ich wo?“ (Heute, Einträge, Übersicht). Logik: ./dayline-core.js
import * as D from "./dayline-core.js";
import { esc } from "./util.js";

export function loadCss() {
  if (document.querySelector('link[data-css="dayline"]')) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.css = "dayline";
  l.href = new URL("../css/dayline.css", import.meta.url).href; document.head.appendChild(l);
}
const clock = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** Kacheln „Ort – Dauer“ (groß, gut lesbar). */
export function totalsHTML(totals, { max = 6 } = {}) {
  if (!totals.length) return "";
  return `<ul class="dl-tot">${totals.slice(0, max).map((t) => `<li style="--c:${D.colorFor(t.key)}"><span class="dl-ic" aria-hidden="true">${t.icon}</span><span class="dl-tn">${esc(t.label)}</span><b>${D.dur(t.min)}</b></li>`).join("")}</ul>`;
}

/** Farbleiste über den Tag (Lücken = nicht gestempelt). */
export function barHTML(d) {
  if (!d.blocks.length || d.first == null) return "";
  const span = Math.max(1, d.last - d.first);
  return `<div class="dl-bar" role="img" aria-label="Tagesverlauf ${clock(d.first)} bis ${clock(d.last)}">${d.blocks.map((b) => `<i style="left:${((b.start - d.first) / span) * 100}%;width:${Math.max(0.8, ((b.end - b.start) / span) * 100)}%;background:${D.colorFor(b.placeKey)}" title="${esc(b.label)} ${D.dur(b.min)}"></i>`).join("")}</div>
    <div class="dl-ax"><span>${clock(d.first)}</span><span>${clock(d.last)}</span></div>`;
}

/** Liste der Abschnitte: Uhrzeit | Ort/Tätigkeit | Dauer. */
export function blocksHTML(d) {
  return `<ol class="dl-list">${d.blocks.map((b) => `<li class="dl-${b.kind}${b.running ? " run" : ""}" style="--c:${D.colorFor(b.placeKey)}">
    <span class="dl-t">${clock(b.start)}<small>${b.running ? "läuft" : clock(b.end)}</small></span>
    <span class="dl-m"><b>${b.icon} ${esc(b.label)}</b>${b.act ? `<small>${esc(b.act)}</small>` : ""}${b.pauseMin ? `<small>☕ inkl. ${D.dur(b.pauseMin)} Pause abgezogen</small>` : ""}</span>
    <b class="dl-d">${D.dur(b.min)}</b></li>`).join("")}</ol>`;
}

/** Komplette Tageskarte. */
export function dayCardHTML(d, { title = "🗺️ Wo warst du heute?" } = {}) {
  if (!d.blocks.length) return "";
  const work = d.blocks.filter((b) => b.kind !== "drive").reduce((n, b) => n + b.min, 0), drive = d.blocks.filter((b) => b.kind === "drive").reduce((n, b) => n + b.min, 0);
  return `<div class="card dl-card"><div class="dl-head"><h2>${title}</h2><small>${D.dur(work)} vor Ort${drive ? ` · ${D.dur(drive)} gefahren` : ""}${d.pauseMin ? ` · ${D.dur(d.pauseMin)} Pause` : ""}</small></div>
    ${totalsHTML(d.totals)}${barHTML(d)}${blocksHTML(d)}</div>`;
}

/** Eine Zeile für Listen (Einträge): „🏗️ Jauk 6 h 10 · 🚗 45 min“. */
export function inlineHTML(totals, max = 3) {
  if (!totals.length) return "";
  const rest = totals.length - max;
  return `<span class="dl-inline">${totals.slice(0, max).map((t) => `<span style="--c:${D.colorFor(t.key)}"><i aria-hidden="true"></i>${t.icon} ${esc(t.label.length > 18 ? t.label.slice(0, 17) + "…" : t.label)} <b>${D.dur(t.min)}</b></span>`).join("")}${rest > 0 ? `<span>+${rest}</span>` : ""}</span>`;
}

/** Balken je Ort für einen Zeitraum (Übersicht). */
export function placeBarsHTML(totals, { title = "📍 Wo warst du wie lange?", empty = "In diesem Zeitraum gibt es keine Zeiten.", bare = false } = {}) {
  const max = Math.max(1, ...totals.map((t) => t.min));
  return `<div class="${bare ? "dl-bare" : "card dl-card"}">${bare ? "" : `<div class="dl-head"><h2>${title}</h2></div>`}${totals.length ? `<ul class="dl-bars">${totals.map((t) => `<li style="--c:${D.colorFor(t.key)}">
      <div class="dl-bh"><span>${t.icon} ${esc(t.label)}</span><b>${D.dur(t.min)}</b></div>
      <span class="dl-bb" aria-hidden="true"><i style="width:${(t.min / max) * 100}%"></i></span><small>${t.days} ${t.days === 1 ? "Tag" : "Tage"}</small></li>`).join("")}</ul>` : `<p class="note">${empty}</p>`}</div>`;
}
