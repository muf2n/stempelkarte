// Berichtsheft / Ausbildungsnachweis (Update 7): Wochenbericht als Vollbild-Ansicht.
// Kopf (Name, Lehrberuf, Lehrbetrieb, Lehrjahr, KW), Tabelle Mo–So (Tätigkeiten, Orte, Stunden),
// Wochensumme, Ergänzungen (settings.apprentice.notes[weekKey]), Unterschriften; Drucken + Text kopieren.
import { icon } from "../icons.js";
import {
  esc, hm, dayKey, startOfWeek, holidayName, schoolLabel, schoolCreditMin, creditMin, kindLabel, WD,
} from "../util.js";
import { countByDays } from "../photos.js"; // Update 9 – Foto-Anzahl je Tag
import { verbautOn, shortLine } from "../alltag/material-core.js"; // Update 9 – Material je Tag (rein, ohne DOM)

const DAY = 86400000;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WORK = "Arbeiten";

/* ---------- gemeinsame Helfer (auch für apprentice.js) ---------- */

/** Gültige Lehrlings-Einstellungen mit Standardwerten. */
export function readApprentice(settings) {
  const a = (settings && settings.apprentice) || {};
  const years = [2, 3, 3.5, 4].includes(Number(a.years)) ? Number(a.years) : 3;
  const vd = Number(a.vacationDays);
  return {
    start: RE_DATE.test(String(a.start || "")) ? a.start : null,
    years,
    trade: String(a.trade || ""),
    company: String(a.company || ""),
    name: String(a.name || ""),
    vacationDays: Number.isFinite(vd) && vd >= 0 ? Math.round(vd) : 25,
    notes: a.notes && typeof a.notes === "object" ? { ...a.notes } : {},
  };
}

/** Datum + n Monate; Monatsende wird begrenzt (31.08. + 6 Monate → 28./29.02.). */
export function addMonths(date, n) {
  const y = date.getFullYear(), m = date.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(date.getDate(), last));
}

function startDate(ap) {
  if (!ap.start) return null;
  const [y, m, d] = ap.start.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Letzter Tag der Lehrzeit (Lehrbeginn + Lehrdauer − 1 Tag) oder null. */
export function apprenticeEnd(ap) {
  const s = startDate(ap);
  if (!s) return null;
  const e = addMonths(s, Math.round(ap.years * 12));
  return new Date(e.getFullYear(), e.getMonth(), e.getDate() - 1);
}

/** Lehrjahr (1, 2, …) am Datum; 0 vor Lehrbeginn bzw. ohne Lehrbeginn. */
export function apprenticeYear(ap, date) {
  const s = startDate(ap);
  if (!s || date < s) return 0;
  const max = Math.ceil(ap.years);
  let k = 0;
  while (k < max - 1 && addMonths(s, 12 * (k + 1)) <= date) k++;
  return k + 1;
}

/** Laufendes Urlaubsjahr: ab Jahrestag des Lehrbeginns (sonst Kalenderjahr) → {from, to (exklusiv)}. */
export function vacationYear(ap, date) {
  const s = startDate(ap);
  if (!s) return { from: new Date(date.getFullYear(), 0, 1), to: new Date(date.getFullYear() + 1, 0, 1) };
  let k = 0;
  while (addMonths(s, 12 * (k + 1)) <= date) k++;
  return { from: addMonths(s, 12 * k), to: addMonths(s, 12 * (k + 1)) };
}

/** ISO-Kalenderwoche → {year, week}. */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const wd = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - wd);
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return { year: y, week };
}

/** Schlüssel einer Woche für die Ergänzungen: "2026-W45". */
export function weekKey(date) {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/* ---------- Wochendaten ---------- */

function placeText(x) {
  if (!x) return "";
  if (x.place) return String(x.place);
  const l = x.inLoc || x.loc;
  return (l && l.addr) || "";
}
function endPlaceText(x) {
  if (!x) return "";
  if (x.endPlace) return String(x.endPlace);
  return (x.endLoc && x.endLoc.addr) || "";
}
function addUniq(list, v) {
  const s = String(v || "").trim();
  if (s && !list.some((x) => x.toLowerCase() === s.toLowerCase())) list.push(s);
}

/** Zeilen Mo–So für die Woche ab ws (Montag). */
export function buildWeek(snap, ws) {
  const settings = (snap && snap.settings) || {};
  const entries = (snap && snap.entries) || [];
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i);
    const k = dayKey(d);
    const acts = [], places = [], tags = [];
    let min = 0;
    const hol = settings.holidays !== false ? holidayName(d) : null;
    if (hol) tags.push({ kind: "feiertag", text: `Feiertag: ${hol}` });
    const sch = schoolLabel(d, settings);
    if (sch) {
      if (sch !== "Berufsschule") addUniq(acts, sch);
      tags.push({ kind: "schule", text: "Berufsschule" });
      min += schoolCreditMin(d, settings);
    }
    const list = entries.filter((e) => e && dayKey(e.start) === k).sort((a, b) => a.start - b.start);
    const notes = [], segActs = [], people = [];
    let workCount = 0, noteCount = 0;
    for (const e of list) {
      min += creditMin(e);
      for (const n of Array.isArray(e.people) ? e.people : []) addUniq(people, n);
      if (e.kind && e.kind !== "work") {
        const lbl = e.kind === "schule" ? "Berufsschule" : kindLabel(e.kind);
        if (e.kind !== "schule") tags.push({ kind: e.kind, text: lbl });
        else if (!tags.some((t) => t.kind === "schule")) tags.push({ kind: "schule", text: lbl });
        if (e.note) addUniq(notes, e.note);
        continue;
      }
      workCount++;
      if (String(e.note || "").trim()) { noteCount++; addUniq(notes, e.note); }
      const segs = Array.isArray(e.segments) ? e.segments.filter((x) => x && Number.isFinite(x.start)) : [];
      for (const x of segs) {
        const a = x.activity || WORK;
        if (a !== WORK) addUniq(segActs, a);
        addUniq(places, placeText(x));
        addUniq(places, endPlaceText(x));
      }
      addUniq(places, placeText(e));
    }
    // Tätigkeiten: zuerst die Notizen, dann Abschnitt-Tätigkeiten außer „Arbeiten“
    for (const n of notes) addUniq(acts, n);
    for (const a of segActs) addUniq(acts, a);
    if (workCount && !acts.length) addUniq(acts, WORK);
    const noNote = workCount > 0 && noteCount === 0;
    rows.push({ date: d, key: k, wd: WD[d.getDay()], acts, places, people, tags, min, hol, noNote, empty: !list.length && !sch && !hol });
  }
  return rows;
}

/* ---------- Ansicht ---------- */

let cur = null; // { ctx, ws, el, unsub, pushed, saveTimer }

function pad(n) { return String(n).padStart(2, "0"); }
function fmtD(d, withYear = true) { return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${withYear ? d.getFullYear() : ""}`; }

function getSnap() { try { return cur.ctx.store.get(); } catch { return null; } }

function headInfo(snap) {
  const ap = readApprentice(snap && snap.settings);
  const ws = cur.ws;
  const we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
  const { week } = isoWeek(ws);
  const lj = apprenticeYear(ap, ws) || apprenticeYear(ap, we);
  return { ap, ws, we, week, lj };
}

function renderPaper() {
  const snap = getSnap();
  if (!snap || !cur) return;
  const { ap, ws, we, week, lj } = headInfo(snap);
  const rows = buildWeek(snap, ws);
  const sum = rows.reduce((s, r) => s + r.min, 0);
  const field = (label, v) => `<div class="rp-f"><span>${label}</span><b>${v ? esc(v) : "&nbsp;"}</b></div>`;
  const missing = !ap.name || !ap.trade || !ap.company;
  const el = cur.el;

  el.querySelector(".rp-wk").textContent = `KW ${week} · ${fmtD(ws, false)} – ${fmtD(we)}`;
  el.querySelector(".rp-hint").hidden = !missing;
  const tip = el.querySelector(".rp-tip");
  if (tip) tip.hidden = !rows.some((r) => r.noNote);

  el.querySelector(".rp-head").innerHTML = `
    <div class="rp-title"><h1>Ausbildungsnachweis</h1><span>Berichtsheft · Woche ${week}</span></div>
    <div class="rp-fields">
      ${field("Name", ap.name)}
      ${field("Lehrberuf", ap.trade)}
      ${field("Lehrbetrieb", ap.company)}
      ${field("Lehrjahr", lj ? `${lj}. Lehrjahr` : "")}
      ${field("Woche", `KW ${week}: ${fmtD(ws)} – ${fmtD(we)}`)}
    </div>`;

  el.querySelector(".rp-tbody").innerHTML = rows.map((r) => {
    const tags = r.tags.map((t) => `<span class="rp-tag rp-${esc(t.kind)}">${esc(t.text)}</span>`).join("");
    const acts = r.acts.length ? r.acts.map(esc).join("; ") : (tags ? "" : `<span class="rp-none">–</span>`);
    const pl = r.places.length ? r.places.map(esc).join(", ") : `<span class="rp-none">–</span>`;
    return `<tr class="${r.empty ? "rp-empty" : ""}${r.date.getDay() === 0 || r.date.getDay() === 6 ? " rp-we" : ""}">
      <td class="rp-day" data-rp-day="${esc(r.key)}"><b>${esc(r.wd)}</b><span>${esc(fmtD(r.date, false))}</span></td>
      <td class="rp-act">${tags ? `<div class="rp-tags">${tags}</div>` : ""}${acts ? `<div>${acts}</div>` : ""}${r.people.length ? `<div class="rp-ppl">mit: ${r.people.map(esc).join(", ")}</div>` : ""}</td>
      <td class="rp-pl${r.places.length ? "" : " rp-pl-empty"}">${pl}</td>
      <td class="rp-h">${r.min > 0 ? esc(hm(r.min)) : "–"}</td>
    </tr>`;
  }).join("");
  el.querySelector(".rp-sum").textContent = `${hm(sum)} h`;
  photoCounts(rows);
  materialLines();

  const ta = el.querySelector("#rp-notes");
  const note = String(ap.notes[weekKey(ws)] || "");
  if (document.activeElement !== ta && !cur.saveTimer && ta.value !== note) ta.value = note;
  el.querySelector(".rp-notes-print").textContent = ta.value;
}

/** Update 9: kleine Foto-Anzahl „📷 3“ je Tag (nur Anzeige, nicht im Druck). */
let photoKey = "";
let photoCache = {};
async function photoCounts(rows) {
  if (!cur) return;
  const el = cur.el;
  const keys = rows.map((r) => r.key);
  const k = keys.join(",");
  const paint = (counts) => {
    for (const td of el.querySelectorAll("[data-rp-day]")) {
      const n = counts[td.dataset.rpDay] || 0;
      let b = td.querySelector(".rp-ph");
      if (!n) { if (b) b.remove(); continue; }
      if (!b) { b = document.createElement("span"); b.className = "rp-ph"; td.appendChild(b); }
      b.textContent = `📷 ${n}`;
      b.title = `${n} ${n === 1 ? "Foto" : "Fotos"}`;
    }
  };
  if (k === photoKey) { paint(photoCache); return; }
  photoKey = k;
  photoCache = {};
  try {
    const counts = await countByDays(keys);
    if (!cur || photoKey !== k) return;
    photoCache = counts;
    paint(counts);
  } catch { /* nur Anzeige */ }
}

/** Update 9: „Material: 2× Steckdose, 25 m NYM-J …“ je Tag aus verbauten Materialien (nur Anzeige). */
let matItems = [];
function materialLines() {
  if (!cur) return;
  for (const td of cur.el.querySelectorAll("[data-rp-day]")) {
    const act = td.parentElement && td.parentElement.querySelector(".rp-act");
    if (!act) continue;
    const line = shortLine(verbautOn(matItems, td.dataset.rpDay));
    let d = act.querySelector(".rp-mat");
    if (!line) { if (d) d.remove(); continue; }
    td.parentElement.classList.remove("rp-empty"); // Tag mit Material ist nicht leer
    if (!d) { d = document.createElement("div"); d.className = "rp-mat"; act.appendChild(d); }
    d.innerHTML = `<b>Material:</b> ${esc(line)}`;
  }
}

async function flushNote() {
  if (!cur || !cur.saveTimer) return;
  clearTimeout(cur.saveTimer);
  cur.saveTimer = null;
  const ta = cur.el.querySelector("#rp-notes");
  const wk = cur.noteWeek;
  const snap = getSnap();
  const ap = readApprentice(snap && snap.settings);
  const v = ta.value;
  if ((ap.notes[wk] || "") === v) return;
  try {
    await cur.ctx.store.saveSettings({ apprentice: { ...ap, notes: { ...ap.notes, [wk]: v } } });
  } catch { /* Toast kommt vom Store */ }
}

function weekText(snap) {
  const { ap, ws, we, week, lj } = headInfo(snap);
  const rows = buildWeek(snap, ws);
  const sum = rows.reduce((s, r) => s + r.min, 0);
  const lines = [
    `Ausbildungsnachweis – KW ${week} (${fmtD(ws)} – ${fmtD(we)})`,
    ap.name ? `Name: ${ap.name}` : null,
    ap.trade ? `Lehrberuf: ${ap.trade}` : null,
    ap.company ? `Lehrbetrieb: ${ap.company}` : null,
    lj ? `Lehrjahr: ${lj}.` : null,
    "",
  ].filter((x) => x !== null);
  for (const r of rows) {
    const parts = [];
    const tagTxt = r.tags.map((t) => t.text);
    if (tagTxt.length) parts.push(tagTxt.join(", "));
    if (r.acts.length) parts.push(r.acts.join("; "));
    if (r.people.length) parts.push(`mit: ${r.people.join(", ")}`);
    if (r.places.length) parts.push(`Ort: ${r.places.join(", ")}`);
    const mat = shortLine(verbautOn(matItems, r.key)); // Update 9 – Material
    if (mat) parts.push(`Material: ${mat}`);
    lines.push(`${r.wd} ${fmtD(r.date, false)}: ${parts.length ? parts.join(" · ") : "–"}${r.min > 0 ? ` (${hm(r.min)} h)` : ""}`);
  }
  lines.push("", `Wochensumme: ${hm(sum)} h`);
  const note = cur.el.querySelector("#rp-notes").value.trim();
  if (note) lines.push("", "Ergänzungen:", note);
  return lines.join("\n");
}

async function copyText(txt) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(txt); return true; }
  } catch { /* Fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

function shiftWeek(n) {
  flushNote();
  const ws = cur.ws;
  cur.ws = n === 0 ? startOfWeek(Date.now()) : new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 7 * n);
  cur.noteWeek = weekKey(cur.ws);
  const ta = cur.el.querySelector("#rp-notes");
  ta.value = String(readApprentice(getSnap() && getSnap().settings).notes[cur.noteWeek] || "");
  renderPaper();
}

function onKey(ev) {
  if (!cur) return;
  if (ev.key === "Escape" && !document.querySelector("#sheet-root .sheet")) { ev.preventDefault(); closeReport(); }
}
function onPop() { if (cur) closeReport(true); }

/** Berichtsheft schließen. */
export function closeReport(fromPop = false) {
  if (!cur) return;
  const c = cur;
  flushNote();
  cur = null;
  photoKey = "";
  try { c.unsub && c.unsub(); } catch { /* egal */ }
  try { c.matOff && c.matOff(); } catch { /* egal */ }
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("popstate", onPop);
  c.el.remove();
  document.body.classList.remove("rp-open");
  document.body.style.overflow = c.prevOverflow;
  if (!fromPop && c.pushed && history.state && history.state.rp) history.back();
  if (c.prevFocus && document.contains(c.prevFocus)) { try { c.prevFocus.focus({ preventScroll: true }); } catch { /* egal */ } }
}

/** Berichtsheft (Ausbildungsnachweis) als Vollbild-Ansicht öffnen. */
export function openReport(ctx, { weekStart } = {}) {
  if (cur) closeReport();
  const ws = startOfWeek(weekStart ?? Date.now());
  const el = document.createElement("div");
  el.id = "rp-root";
  el.className = "rp";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Berichtsheft");
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="rp-bar">
      <button type="button" class="btn ghost sm rp-close" data-rp="close">${icon("chevron-left", 18)}<span>Zurück</span></button>
      <h2>Berichtsheft</h2>
    </div>
    <div class="rp-nav">
      <button type="button" class="btn ghost sm rp-arrow" data-rp="prev" aria-label="Vorherige Woche">${icon("chevron-left", 20)}</button>
      <div class="rp-wk" aria-live="polite"></div>
      <button type="button" class="btn ghost sm rp-arrow" data-rp="next" aria-label="Nächste Woche">${icon("chevron-right", 20)}</button>
      <button type="button" class="btn ghost sm rp-now" data-rp="now">Diese Woche</button>
    </div>
    <p class="note rp-tip" hidden>Tipp: Beim Ausstempeln kurz notieren, was du gemacht hast.</p>
    <p class="note rp-hint" hidden>Tipp: Name, Lehrberuf und Lehrbetrieb trägst du unter Übersicht → Einstellungen → Lehre ein.</p>
    <article class="rp-paper">
      <header class="rp-head"></header>
      <table class="rp-table">
        <thead><tr><th class="rp-day">Tag</th><th>Tätigkeiten</th><th>Ort</th><th class="rp-h">Std.</th></tr></thead>
        <tbody class="rp-tbody"></tbody>
        <tfoot><tr><td colspan="3">Wochensumme</td><td class="rp-h rp-sum"></td></tr></tfoot>
      </table>
      <section class="rp-extra">
        <label for="rp-notes">Ergänzungen <small>(was du diese Woche gelernt oder gemacht hast)</small></label>
        <textarea id="rp-notes" rows="4" placeholder="z. B. Neues gelernt: Steckdosen anschließen, FI-Schalter prüfen …"></textarea>
        <div class="rp-notes-print" aria-hidden="true"></div>
      </section>
      <footer class="rp-sign">
        <div><span class="rp-line"></span><span>Datum, Unterschrift Lehrling</span></div>
        <div><span class="rp-line"></span><span>Datum, Unterschrift Ausbilder/in</span></div>
      </footer>
    </article>
    <div class="rp-actions">
      <button type="button" class="btn primary" data-rp="print">${icon("file", 20)}<span>Drucken / als PDF speichern</span></button>
      <button type="button" class="btn ghost" data-rp="copy">${icon("note", 20)}<span>Als Text kopieren</span></button>
    </div>`;

  cur = { ctx, ws, el, unsub: null, pushed: false, saveTimer: null, noteWeek: weekKey(ws),
    prevOverflow: document.body.style.overflow || "", prevFocus: document.activeElement };
  document.body.appendChild(el);
  document.body.classList.add("rp-open");
  document.body.style.overflow = "hidden";

  el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-rp]");
    if (!b || !cur) return;
    const a = b.dataset.rp;
    if (a === "close") closeReport();
    else if (a === "prev") shiftWeek(-1);
    else if (a === "next") shiftWeek(1);
    else if (a === "now") shiftWeek(0);
    else if (a === "print") {
      await flushNote();
      el.querySelector(".rp-notes-print").textContent = el.querySelector("#rp-notes").value;
      try { window.print(); } catch { ctx.ui.toast("Drucken geht hier nicht."); }
    } else if (a === "copy") {
      const ok = await copyText(weekText(getSnap()));
      ctx.ui.toast(ok ? "Bericht kopiert – jetzt einfügen, wo du willst." : "Kopieren hat nicht geklappt.");
    }
  });
  const ta = el.querySelector("#rp-notes");
  ta.value = String(readApprentice(getSnap() && getSnap().settings).notes[cur.noteWeek] || "");
  ta.addEventListener("input", () => {
    if (!cur) return;
    el.querySelector(".rp-notes-print").textContent = ta.value;
    clearTimeout(cur.saveTimer);
    cur.saveTimer = setTimeout(() => flushNote(), 700);
  });
  ta.addEventListener("blur", () => flushNote());

  document.addEventListener("keydown", onKey);
  try {
    history.pushState({ ...(history.state || {}), rp: 1 }, "", location.href);
    cur.pushed = true;
    window.addEventListener("popstate", onPop);
  } catch { /* egal */ }

  renderPaper();
  try { cur.unsub = ctx.store.subscribe(() => { if (cur) renderPaper(); }); } catch { /* egal */ }
  // Update 9 – verbautes Material (Alltag-Sammlung, erst hier geladen)
  const mine = cur;
  import("../alltag/db.js").then(({ collection }) => {
    if (cur !== mine) return;
    mine.matOff = collection("material_items").watch((list) => { matItems = list || []; if (cur === mine) renderPaper(); });
  }).catch((err) => console.warn("Material fürs Berichtsheft nicht geladen:", err));
  try { el.focus({ preventScroll: true }); } catch { /* egal */ }
  return { close: () => closeReport() };
}
