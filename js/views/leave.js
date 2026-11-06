// Urlaubskonto & Krankenstand (Update 9): Karte in der Übersicht (#leave-panel).
// Urlaub: Anspruch + Resturlaub Vorjahr, verbraucht (bis heute), geplant (Zukunft), übrig – gezählt in Arbeitstagen,
// Einträge unter halbem Tagessoll zählen als ½ Tag. Krankenstand: Tage dieses Jahr. Zeitausgleich: verbrauchte Stunden.
// settings.leave = { daysPerYear, yearStartMonth (1–12), carryOver }
import { icon } from "../icons.js";
import { dayKey, dailyTargetMin, schoolCreditMin, creditMin, hm, esc, WD } from "../util.js";

export const MONTHS_AT = ["Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];

const RE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/* ---------- Berechnung (auch für timesheet.js) ---------- */

/** Gültige Urlaubseinstellungen mit Standardwerten (Anspruch fällt auf settings.apprentice.vacationDays zurück). */
export function readLeave(settings) {
  const s = settings || {};
  const l = s.leave && typeof s.leave === "object" ? s.leave : {};
  const apVd = Number(s.apprentice && s.apprentice.vacationDays);
  let dpy = Number(l.daysPerYear);
  if (!Number.isFinite(dpy) || dpy < 0 || dpy > 60) dpy = Number.isFinite(apVd) && apVd >= 0 && apVd <= 60 ? apVd : 25;
  const ym = Math.trunc(Number(l.yearStartMonth));
  const co = Number(l.carryOver);
  return {
    daysPerYear: Math.round(dpy * 2) / 2,
    yearStartMonth: ym >= 1 && ym <= 12 ? ym : 1,
    carryOver: Number.isFinite(co) && co >= -60 && co <= 120 ? Math.round(co * 2) / 2 : 0,
    custom: Number.isFinite(Number(l.daysPerYear)),
  };
}

/** Urlaubsjahr, das `date` enthält → {from, to (exklusiv)}. */
export function leaveYear(lv, date) {
  const d = date instanceof Date ? date : new Date(date);
  const m0 = lv.yearStartMonth - 1;
  const y = d.getMonth() >= m0 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: new Date(y, m0, 1), to: new Date(y + 1, m0, 1) };
}

export function leaveYearLabel(lv, ly) {
  if (lv.yearStartMonth === 1) return `Urlaubsjahr ${ly.from.getFullYear()}`;
  const last = new Date(ly.to.getFullYear(), ly.to.getMonth(), 0);
  const p = (n) => String(n).padStart(2, "0");
  return `Urlaubsjahr ${p(ly.from.getMonth() + 1)}/${ly.from.getFullYear()} – ${p(last.getMonth() + 1)}/${last.getFullYear()}`;
}

function keyDate(k) {
  const m = RE_KEY.exec(k || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** Soll eines Tages inkl. Berufsschultagen (dort zählt das normale Tagessoll). */
function fullTarget(d, settings) {
  return dailyTargetMin(d, settings) || schoolCreditMin(d, settings) || 0;
}

/** Wert eines Urlaubstags in Arbeitstagen: 0 (kein Arbeitstag), ½ oder 1. */
export function vacationValue(d, credit, settings) {
  const t = fullTarget(d, settings);
  if (t <= 0) return 0;
  if (credit > 0 && credit <= t / 2 + 1) return 0.5;
  return 1;
}

/**
 * Tage einer Art im Zeitraum [from, to) → [{key, date, entries, credit, value, zaMin}] sortiert.
 * value: Urlaub in Arbeitstagen; zaMin: beim Zeitausgleich verbrauchte Minuten (Soll − Gutschrift des Tages).
 */
export function kindDays(snap, kind, from, to) {
  const settings = (snap && snap.settings) || {};
  const fk = dayKey(from), tk = dayKey(to);
  const byDay = new Map();
  const allCredit = new Map();
  for (const e of (snap && snap.entries) || []) {
    if (!e || !Number.isFinite(e.start)) continue;
    const k = dayKey(e.start);
    if (k < fk || k >= tk) continue;
    allCredit.set(k, (allCredit.get(k) || 0) + creditMin(e));
    if ((e.kind || "work") !== kind) continue;
    let d = byDay.get(k);
    if (!d) byDay.set(k, (d = { key: k, date: keyDate(k), entries: [], credit: 0 }));
    d.entries.push(e);
    d.credit += creditMin(e);
  }
  const out = [...byDay.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const d of out) {
    d.value = kind === "urlaub" ? vacationValue(d.date, d.credit, settings) : 1;
    d.zaMin = kind === "zeitausgleich" ? Math.max(0, dailyTargetMin(d.date, settings) - (allCredit.get(d.key) || 0)) : 0;
  }
  return out;
}

const sumVal = (list) => list.reduce((s, d) => s + d.value, 0);

/** Kennzahlen für die Karte. */
export function leaveStats(snap, now = new Date()) {
  const lv = readLeave(snap && snap.settings);
  const ly = leaveYear(lv, now);
  const todayK = dayKey(now);
  const vac = kindDays(snap, "urlaub", ly.from, ly.to);
  const taken = vac.filter((d) => d.key <= todayK);
  const planned = vac.filter((d) => d.key > todayK);
  const y = now.getFullYear();
  const yf = new Date(y, 0, 1), yt = new Date(y + 1, 0, 1);
  const sick = kindDays(snap, "krank", yf, yt);
  const za = kindDays(snap, "zeitausgleich", yf, yt);
  const entitled = lv.daysPerYear + lv.carryOver;
  const usedN = sumVal(taken), plannedN = sumVal(planned);
  return {
    lv, ly, year: y, entitled,
    taken, planned, usedN, plannedN, left: entitled - usedN - plannedN,
    sick, za, zaMin: za.reduce((s, d) => s + d.zaMin, 0),
  };
}

/** Zahl mit Komma und ½: 2.5 → "2½", 0.5 → "½". */
export function fmtDays(n) {
  const v = Math.round(n * 2) / 2;
  const neg = v < 0;
  const a = Math.abs(v);
  const whole = Math.floor(a);
  const half = a - whole >= 0.5;
  const s = half ? (whole ? `${whole}½` : "½") : String(whole);
  return (neg ? "−" : "") + s;
}

function daysWord(n) { return Math.abs(n) <= 1 && n !== 0 ? "Tag" : "Tage"; }

/* ---------- Karte ---------- */

let ctx = null;
let root = null;
let snap = null;
let lastHtml = "";

const $ = (sel) => root.querySelector(sel);

function fmtShort(d) { return `${WD[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`; }

async function saveLeave(partial) {
  const cur = readLeave(ctx.store.get().settings);
  const next = { daysPerYear: cur.daysPerYear, yearStartMonth: cur.yearStartMonth, carryOver: cur.carryOver, ...partial };
  try { await ctx.store.saveSettings({ leave: next }); return true; } catch { return false; }
}

function parseNum(v) {
  const n = Number(String(v || "").trim().replace(",", ".").replace("−", "-"));
  return Number.isFinite(n) ? n : null;
}

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  root.classList.add("lv");
  root.innerHTML = `
    <div class="lv-h">
      <span class="rm-ico lv-ico">${icon("sun", 20)}</span>
      <div class="lv-ht"><h2>Urlaub &amp; Krankenstand</h2><p class="note" id="lv-year"></p></div>
    </div>
    <div class="lv-tiles" id="lv-tiles"></div>
    <div class="lv-bar" id="lv-bar" aria-hidden="true"></div>
    <div class="lv-rows" id="lv-rows"></div>
    <details class="lv-set">
      <summary>${icon("gear", 18)}<span>Urlaubsanspruch einstellen</span></summary>
      <div class="lv-set-b">
        <label class="rm-inline">Anspruch pro Jahr
          <input type="number" id="lv-days" min="0" max="60" step="0.5" inputmode="decimal"><span>Arbeitstage</span></label>
        <p class="note">Standard: 5 Wochen = 25 Arbeitstage (Mo – Fr).</p>
        <label class="rm-inline">Urlaubsjahr beginnt im
          <select id="lv-month">${MONTHS_AT.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select></label>
        <label class="rm-inline">Resturlaub aus dem Vorjahr
          <input type="number" id="lv-carry" min="-60" max="120" step="0.5" inputmode="decimal"><span>Tage</span></label>
        <p class="note">Gezählt werden deine Einträge „Urlaub“ an Arbeitstagen. Ist die Gutschrift höchstens ein halbes Tagessoll, zählt der Tag als ½ Urlaubstag.</p>
      </div>
    </details>`;

  $("#lv-days").addEventListener("change", async () => {
    const n = parseNum($("#lv-days").value);
    if (n == null || n < 0 || n > 60) { ctx.ui.toast("Bitte eine Zahl zwischen 0 und 60 eingeben."); render(true); return; }
    const v = Math.round(n * 2) / 2;
    if (await saveLeave({ daysPerYear: v })) ctx.ui.toast(`Urlaubsanspruch: ${fmtDays(v)} Tage`);
  });
  $("#lv-month").addEventListener("change", async () => {
    const m = Number($("#lv-month").value);
    if (await saveLeave({ yearStartMonth: m })) ctx.ui.toast(`Urlaubsjahr beginnt im ${MONTHS_AT[m - 1]}`);
  });
  $("#lv-carry").addEventListener("change", async () => {
    const raw = $("#lv-carry").value;
    const n = raw === "" ? 0 : parseNum(raw);
    if (n == null || n < -60 || n > 120) { ctx.ui.toast("Bitte eine gültige Zahl eingeben."); render(true); return; }
    const v = Math.round(n * 2) / 2;
    if (await saveLeave({ carryOver: v })) ctx.ui.toast(v ? `Resturlaub: ${fmtDays(v)} Tage` : "Kein Resturlaub");
  });
  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-lv]");
    if (b) openList(b.dataset.lv);
  });

  try { snap = ctx.store.get(); } catch { snap = null; }
  if (snap) render();
}

export function update(s) {
  snap = s;
  if (root && snap) render();
}

function setVal(sel, v) {
  const inp = $(sel);
  if (!inp || document.activeElement === inp) return;
  if (inp.value !== String(v)) inp.value = String(v);
}

function render(force = false) {
  if (!root || !snap || !root.querySelector("#lv-tiles")) return;
  const st = leaveStats(snap);
  setVal("#lv-days", st.lv.daysPerYear);
  setVal("#lv-month", st.lv.yearStartMonth);
  setVal("#lv-carry", st.lv.carryOver || "");

  const ent = Math.max(0, st.entitled);
  const pct = (n) => (ent > 0 ? Math.max(0, Math.min(100, (n / ent) * 100)) : 0);
  const usedP = pct(st.usedN), planP = Math.min(100 - usedP, pct(st.plannedN));
  const yLabel = leaveYearLabel(st.lv, st.ly) + (st.lv.carryOver ? ` · inkl. ${fmtDays(st.lv.carryOver)} ${daysWord(st.lv.carryOver)} Rest aus dem Vorjahr` : "");
  const html = `
    <div class="lv-t"><span>Anspruch</span><b>${fmtDays(st.entitled)}</b></div>
    <div class="lv-t lv-used"><span>Verbraucht</span><b>${fmtDays(st.usedN)}</b></div>
    <div class="lv-t lv-plan"><span>Geplant</span><b>${fmtDays(st.plannedN)}</b></div>
    <div class="lv-t lv-left${st.left < 0 ? " neg" : ""}"><span>Übrig</span><b>${fmtDays(st.left)}</b></div>`;
  const bar = `<i class="lv-b-used" style="width:${usedP}%"></i><i class="lv-b-plan" style="width:${planP}%"></i>`;
  const row = (k, ic, label, val, sub) => `
    <button type="button" class="lv-row" data-lv="${k}">
      <span class="lv-dot lv-${k}">${icon(ic, 18)}</span>
      <span class="lv-rm"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
      <span class="lv-rv">${esc(val)}</span>${icon("chevron-right", 18)}
    </button>`;
  const nextPlan = st.planned[0];
  const rows = [
    row("urlaub", "sun", "Urlaubstage", `${fmtDays(st.usedN + st.plannedN)} ${daysWord(st.usedN + st.plannedN)}`,
      nextPlan ? `nächster: ${fmtShort(nextPlan.date)}` : (st.taken.length ? "keiner mehr geplant" : "noch kein Urlaub eingetragen")),
    row("krank", "heart", `Krankenstand ${st.year}`, `${st.sick.length} ${daysWord(st.sick.length)}`,
      st.sick.length ? `zuletzt ${fmtShort(st.sick[st.sick.length - 1].date)}` : "keine Krankentage"),
    row("zeitausgleich", "clock", `Zeitausgleich ${st.year}`, `${hm(st.zaMin)} h`,
      st.za.length ? `${st.za.length} ${daysWord(st.za.length)} · aus dem Überstundenkonto` : "noch kein Zeitausgleich"),
  ].join("");
  const key = html + bar + rows + yLabel;
  if (!force && key === lastHtml) return;
  lastHtml = key;
  $("#lv-year").textContent = yLabel;
  $("#lv-tiles").innerHTML = html;
  $("#lv-bar").innerHTML = bar;
  $("#lv-rows").innerHTML = rows;
}

/* ---------- Liste der Tage (Blatt) ---------- */

/** Fasst aufeinanderfolgende Tage zusammen (dazwischen nur Tage ohne Soll, z. B. Wochenende). */
function groupDays(list, settings) {
  const groups = [];
  let g = null;
  for (const d of list) {
    if (g) {
      const last = g.days[g.days.length - 1].date;
      let gap = true;
      const x = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      for (let i = 0; i < 10 && x < d.date; i++, x.setDate(x.getDate() + 1)) {
        if (fullTarget(x, settings) > 0) { gap = false; break; }
      }
      if (gap && x >= d.date) { g.days.push(d); continue; }
    }
    g = { days: [d] };
    groups.push(g);
  }
  return groups;
}

function openList(kind) {
  if (!snap) return;
  const st = leaveStats(snap);
  const settings = snap.settings || {};
  let title, list, intro;
  if (kind === "urlaub") {
    title = "Urlaubstage";
    list = [...st.taken, ...st.planned];
    intro = `${leaveYearLabel(st.lv, st.ly)}: ${fmtDays(st.usedN)} verbraucht, ${fmtDays(st.plannedN)} geplant, ${fmtDays(st.left)} übrig.`;
  } else if (kind === "krank") {
    title = `Krankenstand ${st.year}`;
    list = st.sick;
    intro = `${st.sick.length} ${daysWord(st.sick.length)} mit Eintrag „Krank“.`;
  } else {
    title = `Zeitausgleich ${st.year}`;
    list = st.za;
    intro = `${hm(st.zaMin)} h aus dem Überstundenkonto genommen (Tagessoll minus Gutschrift des Tages).`;
  }
  const todayK = dayKey(Date.now());
  const groups = groupDays(list, settings);
  const valOf = (d) => {
    if (kind === "urlaub") return d.value ? `${fmtDays(d.value)} ${d.value === 0.5 ? "Tag" : daysWord(d.value)}` : "zählt nicht";
    if (kind === "zeitausgleich") return `${hm(d.zaMin)} h`;
    return d.credit > 0 ? `${hm(d.credit)} h` : "";
  };
  const body = !list.length
    ? `<p class="note">${esc(intro)}</p><p class="lv-empty">🏖️ Noch keine Einträge.</p>`
    : `<p class="note">${esc(intro)}</p>` + groups.slice().reverse().map((g) => {
      const a = g.days[0].date, b = g.days[g.days.length - 1].date;
      const n = kind === "urlaub" ? g.days.reduce((s, d) => s + d.value, 0) : g.days.length;
      const future = g.days[0].key > todayK;
      const head = g.days.length > 1 ? `${fmtShort(a)} – ${fmtShort(b)}${b.getFullYear()}` : `${fmtShort(a)}${a.getFullYear()}`;
      return `<section class="lv-g">
        <div class="lv-gh"><b>${esc(head)}</b><span>${future ? `<em class="lv-fut">geplant</em>` : ""}${esc(fmtDays(n))} ${daysWord(n)}</span></div>
        ${g.days.map((d) => {
          const note = d.entries.map((e) => String(e.note || "").trim()).filter(Boolean).join(" · ");
          return `<button type="button" class="lv-day" data-id="${esc(d.entries[0].id)}">
            <span class="lv-dd">${esc(fmtShort(d.date))}</span>
            <span class="lv-dn">${note ? esc(note) : ""}</span>
            <span class="lv-dv">${esc(valOf(d))}</span></button>`;
        }).join("")}
      </section>`;
    }).join("");
  ctx.ui.openSheet({
    title,
    bodyHTML: `<div class="lv-list">${body}</div>`,
    onMount: (el, close) => {
      el.addEventListener("click", (ev) => {
        const b = ev.target.closest(".lv-day[data-id]");
        if (!b) return;
        const e = (ctx.store.get().entries || []).find((x) => x.id === b.dataset.id);
        if (!e) return;
        close();
        ctx.openEntryForm(e);
      });
    },
  });
}
