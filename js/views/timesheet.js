// Stundenzettel (Update 9): Monats-Stundenzettel als Vollbild-Ansicht (wie das Berichtsheft).
// Kopf (Name, Lehrbetrieb, Monat), Tabelle pro Tag (Datum, Wochentag, Art, Beginn, Ende, Pause, Netto, Ort, Tätigkeit/Notiz),
// Wochen-Zwischensummen, Monatssumme, Soll/Ist/Saldo, Urlaub/Krank/ZA im Monat, Unterschriften.
// Drucken (A4 hoch, nur der Zettel) bzw. als PDF speichern, Teilen als Text (Fallback: Kopieren).
import { icon } from "../icons.js";
import {
  esc, hm, clock, dayKey, netMin, creditMin, kindLabel, holidayName, schoolLabel, schoolCreditMin, dailyTargetMin, WD,
} from "../util.js";
import { readApprentice, isoWeek } from "./report.js";
import { kindDays, fmtDays, MONTHS_AT } from "./leave.js";

const WORK = "Arbeiten";

function pad(n) { return String(n).padStart(2, "0"); }
function fmtD(d, withYear = false) { return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${withYear ? d.getFullYear() : ""}`; }
function monthName(d) { return `${MONTHS_AT[d.getMonth()]} ${d.getFullYear()}`; }
function signed(min) { const m = Math.round(min); return (m < 0 ? "−" : "+") + hm(Math.abs(m)); }

function placeText(x) {
  if (!x) return "";
  if (x.place) return String(x.place);
  const l = x.inLoc || x.loc;
  return (l && l.addr) || "";
}
function addUniq(list, v) {
  const s = String(v || "").trim();
  if (s && !list.some((x) => x.toLowerCase() === s.toLowerCase())) list.push(s);
}

/* ---------- Daten ---------- */

/** Zeilen und Summen für den Monat ab `from` (1. des Monats). */
export function buildMonth(snap, from) {
  const settings = (snap && snap.settings) || {};
  const entries = ((snap && snap.entries) || []).filter((e) => e && Number.isFinite(e.start));
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  const byDay = new Map();
  for (const e of entries) {
    if (e.start < from.getTime() || e.start >= to.getTime()) continue;
    const k = dayKey(e.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  const rows = [];
  const weeks = [];
  let wk = null;
  let ist = 0, soll = 0, workNet = 0;
  for (const d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    const k = dayKey(date);
    const list = (byDay.get(k) || []).sort((a, b) => a.start - b.start);
    const kinds = [];
    const places = [], acts = [];
    let credit = 0, net = 0, first = null, last = null;
    const hol = settings.holidays !== false ? holidayName(date) : null;
    const sch = schoolLabel(date, settings);
    if (sch) { addUniq(kinds, sch === "Berufsschule" ? "Berufsschule" : sch); credit += schoolCreditMin(date, settings); }
    for (const e of list) {
      const kind = e.kind || "work";
      credit += creditMin(e);
      if (kind !== "work") {
        addUniq(kinds, kind === "schule" ? "Berufsschule" : kindLabel(kind));
        if (e.note) addUniq(acts, e.note);
        continue;
      }
      addUniq(kinds, "Arbeit");
      net += netMin(e);
      if (first == null || e.start < first) first = e.start;
      if (Number.isFinite(e.end) && (last == null || e.end > last)) last = e.end;
      if (String(e.note || "").trim()) addUniq(acts, e.note);
      const segs = Array.isArray(e.segments) ? e.segments.filter((x) => x && Number.isFinite(x.start)) : [];
      for (const x of segs) {
        if ((x.activity || WORK) !== WORK) addUniq(acts, x.activity);
        addUniq(places, placeText(x));
      }
      addUniq(places, placeText(e));
    }
    if (hol && !kinds.length) kinds.push("Feiertag");
    // Pause = Anwesenheit (Beginn bis Ende) − Netto-Arbeitszeit (inkl. Lücken zwischen Einträgen)
    const pause = first != null && last != null ? Math.max(0, (last - first) / 60000 - net) : 0;
    // Soll inkl. Berufsschultagen (dort steht die Schul-Gutschrift gegenüber) – Saldo wie im Überstundenkonto
    const target = dailyTargetMin(date, settings) + (sch ? schoolCreditMin(date, settings) : 0);
    const dow = date.getDay();
    const row = {
      date, key: k, wd: WD[dow], hol, kinds, places, acts, first, last, pause, net, credit, target,
      weekend: dow === 0 || dow === 6, empty: !list.length && !sch,
    };
    rows.push(row);
    ist += credit; soll += target; workNet += net;
    const { week } = isoWeek(date);
    if (!wk || wk.week !== week) { wk = { week, from: date, to: date, ist: 0, soll: 0, rows: [] }; weeks.push(wk); }
    wk.to = date; wk.ist += credit; wk.soll += target; wk.rows.push(row);
  }
  const vac = kindDays(snap, "urlaub", from, to);
  const sick = kindDays(snap, "krank", from, to);
  const za = kindDays(snap, "zeitausgleich", from, to);
  return {
    from, to, rows, weeks, ist, soll, workNet,
    vacN: vac.reduce((s, d) => s + d.value, 0),
    sickN: sick.length,
    zaN: za.length, zaMin: za.reduce((s, d) => s + d.zaMin, 0),
    workDays: rows.filter((r) => r.net > 0).length,
  };
}

/* ---------- Ansicht ---------- */

let cur = null; // { ctx, from, el, unsub, pushed, prevOverflow, prevFocus }

function getSnap() { try { return cur.ctx.store.get(); } catch { return null; } }

function renderPaper() {
  const snap = getSnap();
  if (!snap || !cur) return;
  const el = cur.el;
  const ap = readApprentice(snap.settings);
  const m = buildMonth(snap, cur.from);
  const saldo = m.ist - m.soll;
  const field = (label, v) => `<div class="rp-f"><span>${label}</span><b>${v ? esc(v) : "&nbsp;"}</b></div>`;

  el.querySelector(".ts-mo").textContent = monthName(cur.from);
  el.querySelector(".ts-hint").hidden = !!(ap.name && ap.company);
  const r = snap.running;
  el.querySelector(".ts-run").hidden = !(r && r.start >= m.from.getTime() && r.start < m.to.getTime());

  el.querySelector(".ts-head").innerHTML = `
    <div class="rp-title"><h1>Stundenzettel</h1><span>${esc(monthName(cur.from))}</span></div>
    <div class="rp-fields">
      ${field("Name", ap.name)}
      ${field("Lehrbetrieb", ap.company)}
      ${field("Zeitraum", `${fmtD(m.from)} – ${fmtD(new Date(m.to.getTime() - 43200000), true)}`)}
    </div>`;

  const cellH = (min) => (min > 0 ? esc(hm(min)) : "");
  const dayRow = (x) => {
    const cls = ["ts-r"];
    if (x.weekend) cls.push("ts-we");
    if (x.hol) cls.push("ts-hol");
    if (x.empty) cls.push("ts-empty");
    const art = x.kinds.length ? x.kinds.join(", ") : "";
    const notes = [...(x.hol ? [x.hol] : []), ...x.acts];
    return `<tr class="${cls.join(" ")}">
      <td class="ts-d">${esc(fmtD(x.date))}</td>
      <td class="ts-wd">${esc(x.wd)}</td>
      <td class="ts-k">${esc(art)}</td>
      <td class="ts-t" data-l="Beginn">${x.first != null ? esc(clock(x.first)) : ""}</td>
      <td class="ts-t" data-l="Ende">${x.last != null ? esc(clock(x.last)) : ""}</td>
      <td class="ts-t" data-l="Pause">${cellH(x.pause)}</td>
      <td class="ts-n">${cellH(x.credit)}</td>
      <td class="ts-pl">${esc(x.places.join(", "))}</td>
      <td class="ts-a">${esc(notes.join("; "))}</td>
    </tr>`;
  };
  const weekRow = (w) => `<tr class="ts-wsum">
      <td colspan="6" class="ts-ws-l">Summe KW ${w.week} <small>(${esc(fmtD(w.from))} – ${esc(fmtD(w.to))})</small></td>
      <td class="ts-n">${esc(hm(w.ist))}</td>
      <td colspan="2" class="ts-ws-i">Soll ${esc(hm(w.soll))} h · Saldo ${esc(signed(w.ist - w.soll))} h</td>
    </tr>`;
  el.querySelector(".ts-tbody").innerHTML = m.weeks.map((w) => w.rows.map(dayRow).join("") + weekRow(w)).join("");
  el.querySelector(".ts-sum").textContent = hm(m.ist);

  const kv = (l, v, cls = "") => `<div class="ts-kv${cls ? " " + cls : ""}"><span>${l}</span><b>${esc(v)}</b></div>`;
  el.querySelector(".ts-totals").innerHTML = `
    <div class="ts-box">
      ${kv("Soll", `${hm(m.soll)} h`)}
      ${kv("Ist", `${hm(m.ist)} h`)}
      ${kv("Saldo", `${signed(saldo)} h`, Math.round(saldo) < 0 ? "minus" : "plus")}
      ${kv("davon Arbeitszeit (netto)", `${hm(m.workNet)} h`)}
    </div>
    <div class="ts-box">
      ${kv("Arbeitstage", String(m.workDays))}
      ${kv("Urlaubstage", fmtDays(m.vacN))}
      ${kv("Krankenstandstage", String(m.sickN))}
      ${kv("Zeitausgleich", m.zaN ? `${m.zaN} ${m.zaN === 1 ? "Tag" : "Tage"} · ${hm(m.zaMin)} h` : "0")}
    </div>`;
}

function monthText(snap) {
  const ap = readApprentice(snap && snap.settings);
  const m = buildMonth(snap, cur.from);
  const lines = [`Stundenzettel ${monthName(cur.from)}`];
  if (ap.name) lines.push(`Name: ${ap.name}`);
  if (ap.company) lines.push(`Lehrbetrieb: ${ap.company}`);
  lines.push("");
  for (const w of m.weeks) {
    for (const x of w.rows) {
      if (x.empty && !x.hol) continue;
      const parts = [];
      if (x.kinds.length) parts.push(x.kinds.join(", "));
      else if (x.hol) parts.push(`Feiertag (${x.hol})`);
      if (x.first != null && x.last != null) parts.push(`${clock(x.first)}–${clock(x.last)}`);
      if (x.pause >= 1) parts.push(`Pause ${hm(x.pause)}`);
      if (x.places.length) parts.push(x.places.join(", "));
      if (x.acts.length) parts.push(x.acts.join("; "));
      lines.push(`${x.wd} ${fmtD(x.date)}: ${parts.join(" · ")}${x.credit > 0 ? ` = ${hm(x.credit)} h` : ""}`);
    }
    lines.push(`  KW ${w.week}: ${hm(w.ist)} h (Soll ${hm(w.soll)} h, ${signed(w.ist - w.soll)} h)`);
  }
  lines.push("",
    `Monat: Ist ${hm(m.ist)} h / Soll ${hm(m.soll)} h · Saldo ${signed(m.ist - m.soll)} h`,
    `Arbeitstage: ${m.workDays} · Urlaub: ${fmtDays(m.vacN)} · Krank: ${m.sickN} · Zeitausgleich: ${m.zaN} (${hm(m.zaMin)} h)`);
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

async function share() {
  const snap = getSnap();
  if (!snap || !cur) return;
  const text = monthText(snap);
  const title = `Stundenzettel ${monthName(cur.from)}`;
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; } catch (err) {
      if (err && err.name === "AbortError") return; // abgebrochen
    }
  }
  const ok = await copyText(text);
  cur.ctx.ui.toast(ok ? "Stundenzettel als Text kopiert – jetzt einfügen, wo du willst." : "Teilen hat nicht geklappt.");
}

function shiftMonth(n) {
  const f = cur.from;
  const now = new Date();
  cur.from = n === 0 ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(f.getFullYear(), f.getMonth() + n, 1);
  renderPaper();
}

function onKey(ev) {
  if (!cur) return;
  if (ev.key === "Escape" && !document.querySelector("#sheet-root .sheet")) { ev.preventDefault(); closeTimesheet(); }
}
function onPop() { if (cur) closeTimesheet(true); }

/** Stundenzettel schließen. */
export function closeTimesheet(fromPop = false) {
  if (!cur) return;
  const c = cur;
  cur = null;
  try { c.unsub && c.unsub(); } catch { /* egal */ }
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("popstate", onPop);
  c.el.remove();
  document.body.classList.remove("ts-open");
  document.body.style.overflow = c.prevOverflow;
  if (!fromPop && c.pushed && history.state && history.state.ts) history.back();
  if (c.prevFocus && document.contains(c.prevFocus)) { try { c.prevFocus.focus({ preventScroll: true }); } catch { /* egal */ } }
}

/** Stundenzettel als Vollbild öffnen; year/month (0–11) optional, sonst aktueller Monat. */
export function openTimesheet(ctx, { year, month } = {}) {
  if (cur) closeTimesheet();
  const now = new Date();
  const from = new Date(Number.isFinite(year) ? year : now.getFullYear(), Number.isFinite(month) ? month : now.getMonth(), 1);
  const el = document.createElement("div");
  el.id = "ts-root";
  el.className = "rp ts";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Stundenzettel");
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="rp-bar">
      <button type="button" class="btn ghost sm rp-close" data-ts="close">${icon("chevron-left", 18)}<span>Zurück</span></button>
      <h2>Stundenzettel</h2>
    </div>
    <div class="rp-nav">
      <button type="button" class="btn ghost sm rp-arrow" data-ts="prev" aria-label="Voriger Monat">${icon("chevron-left", 20)}</button>
      <div class="rp-wk ts-mo" aria-live="polite"></div>
      <button type="button" class="btn ghost sm rp-arrow" data-ts="next" aria-label="Nächster Monat">${icon("chevron-right", 20)}</button>
      <button type="button" class="btn ghost sm rp-now" data-ts="now">Dieser Monat</button>
    </div>
    <p class="note ts-hint" hidden>Tipp: Name und Lehrbetrieb trägst du unter Übersicht → Einstellungen → Lehre ein.</p>
    <p class="note ts-run" hidden>Die laufende Schicht ist noch nicht enthalten – erst nach dem Ausstempeln.</p>
    <article class="rp-paper ts-paper">
      <header class="rp-head ts-head"></header>
      <table class="ts-table">
        <thead><tr>
          <th class="ts-d">Datum</th><th class="ts-wd">Tag</th><th class="ts-k">Art</th>
          <th class="ts-t">Beginn</th><th class="ts-t">Ende</th><th class="ts-t">Pause</th><th class="ts-n">Netto h</th>
          <th class="ts-pl">Ort</th><th class="ts-a">Tätigkeit / Notiz</th>
        </tr></thead>
        <tbody class="ts-tbody"></tbody>
        <tfoot><tr><td colspan="6">Monatssumme</td><td class="ts-n ts-sum"></td><td colspan="2"></td></tr></tfoot>
      </table>
      <section class="ts-totals"></section>
      <footer class="rp-sign">
        <div><span class="rp-line"></span><span>Datum, Unterschrift Lehrling</span></div>
        <div><span class="rp-line"></span><span>Datum, Unterschrift Ausbilder/in</span></div>
      </footer>
    </article>
    <div class="rp-actions">
      <button type="button" class="btn primary" data-ts="print">${icon("file", 20)}<span>Drucken / als PDF speichern</span></button>
      <button type="button" class="btn ghost" data-ts="share">${icon("swap", 20)}<span>Teilen</span></button>
    </div>`;

  cur = { ctx, from, el, unsub: null, pushed: false,
    prevOverflow: document.body.style.overflow || "", prevFocus: document.activeElement };
  document.body.appendChild(el);
  document.body.classList.add("ts-open");
  document.body.style.overflow = "hidden";

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ts]");
    if (!b || !cur) return;
    const a = b.dataset.ts;
    if (a === "close") closeTimesheet();
    else if (a === "prev") shiftMonth(-1);
    else if (a === "next") shiftMonth(1);
    else if (a === "now") shiftMonth(0);
    else if (a === "print") {
      const prevTitle = document.title;
      const ap = readApprentice(getSnap() && getSnap().settings);
      document.title = `Stundenzettel ${cur.from.getFullYear()}-${pad(cur.from.getMonth() + 1)}${ap.name ? " " + ap.name : ""}`;
      try { window.print(); } catch { ctx.ui.toast("Drucken geht hier nicht."); }
      setTimeout(() => { document.title = prevTitle; }, 1000);
    } else if (a === "share") share();
  });

  document.addEventListener("keydown", onKey);
  try {
    history.pushState({ ...(history.state || {}), ts: 1 }, "", location.href);
    cur.pushed = true;
    window.addEventListener("popstate", onPop);
  } catch { /* egal */ }

  renderPaper();
  try { cur.unsub = ctx.store.subscribe(() => { if (cur) renderPaper(); }); } catch { /* egal */ }
  try { el.focus({ preventScroll: true }); } catch { /* egal */ }
  return { close: () => closeTimesheet() };
}
