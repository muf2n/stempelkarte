// Einstellungs-Karte „Lehre“ (Update 7): Lehrbeginn, Lehrdauer, Lehrberuf, Lehrbetrieb, Name,
// aktuelles Lehrjahr, voraussichtlicher Lehrabschluss, Urlaubsanspruch/-rest; öffnet das Berichtsheft.
// settings.apprentice = { start, years, trade, company, name, vacationDays, notes }
import { icon } from "../icons.js";
import { readApprentice, apprenticeYear, apprenticeEnd, vacationYear, addMonths, openReport } from "./report.js";

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEARS = [[2, "2 Jahre"], [3, "3 Jahre"], [3.5, "3½ Jahre"], [4, "4 Jahre"]];
const DAY = 86400000;

let ctx = null;
let root = null;
let snap = null;

const $ = (sel) => root.querySelector(sel);

function pad(n) { return String(n).padStart(2, "0"); }
function fmtD(d) { return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; }
function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayDate() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }

async function save(partial) {
  const cur = readApprentice(ctx.store.get().settings);
  try {
    await ctx.store.saveSettings({ apprentice: { ...cur, ...partial } });
    return true;
  } catch { return false; }
}

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  root.classList.add("rm", "ap");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico">${icon("briefcase", 20)}</span>
      <div><div class="rm-title">Lehre</div>
      <p class="note">Für dein Lehrjahr, deinen Urlaub und das Berichtsheft (Ausbildungsnachweis).</p></div>
    </div>
    <div class="ap-status" id="ap-status" aria-live="polite"></div>
    <div class="rm-opt ap-form">
      <div class="row">
        <label>Lehrbeginn<input type="date" id="ap-start"></label>
        <label>Lehrdauer
          <select id="ap-years">${YEARS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>
        </label>
      </div>
      <label>Lehrberuf<input type="text" id="ap-trade" maxlength="60" placeholder="z. B. Elektrotechnik" autocomplete="off"></label>
      <label>Lehrbetrieb<input type="text" id="ap-company" maxlength="80" placeholder="z. B. Muster GmbH" autocomplete="organization"></label>
      <label>Dein Name (fürs Berichtsheft)<input type="text" id="ap-name" maxlength="60" placeholder="Vor- und Nachname" autocomplete="name"></label>
    </div>
    <div class="rm-opt ap-vac">
      <div class="lbl">Urlaub</div>
      <label class="rm-inline">Anspruch pro Urlaubsjahr
        <input type="number" id="ap-vacdays" min="0" max="60" step="1" inputmode="numeric">
        <span>Tage</span>
      </label>
      <p class="note">5 Wochen = 25 Arbeitstage (Mo – Fr). Zählt dein Betrieb Mo – Sa, sind es 30 Werktage.</p>
      <div class="ap-vac-tiles" id="ap-vac"></div>
    </div>
    <button type="button" class="btn primary ap-report" id="ap-report">${icon("file", 20)}<span>Berichtsheft öffnen</span></button>`;

  const text = (id, field) => {
    const inp = $(id);
    let t = null;
    const go = async () => { clearTimeout(t); const v = inp.value.trim(); if (v !== (readApprentice(ctx.store.get().settings)[field] || "")) await save({ [field]: v }); };
    inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(go, 800); });
    inp.addEventListener("change", go);
  };
  text("#ap-trade", "trade");
  text("#ap-company", "company");
  text("#ap-name", "name");

  $("#ap-start").addEventListener("change", async () => {
    const v = $("#ap-start").value;
    if (v && !RE_DATE.test(v)) return;
    if (await save({ start: v || null })) ctx.ui.toast(v ? "Lehrbeginn gespeichert" : "Lehrbeginn entfernt");
  });
  $("#ap-years").addEventListener("change", async () => {
    if (await save({ years: Number($("#ap-years").value) })) ctx.ui.toast("Lehrdauer gespeichert");
  });
  $("#ap-vacdays").addEventListener("change", async () => {
    const n = Math.round(Number($("#ap-vacdays").value));
    if (!Number.isFinite(n) || n < 0 || n > 60) { ctx.ui.toast("Bitte eine Zahl zwischen 0 und 60 eingeben."); update(ctx.store.get()); return; }
    if (await save({ vacationDays: n })) ctx.ui.toast(`Urlaubsanspruch: ${n} Tage`);
  });
  $("#ap-report").addEventListener("click", () => openReport(ctx, {}));

  try { snap = ctx.store.get(); } catch { snap = null; }
  if (snap) update(snap);
}

function setVal(sel, v) {
  const inp = $(sel);
  if (!inp || document.activeElement === inp) return;
  if (inp.value !== String(v)) inp.value = String(v);
}

export function update(s) {
  snap = s;
  if (!root || !snap || !root.querySelector("#ap-start")) return;
  const ap = readApprentice(snap.settings);
  setVal("#ap-start", ap.start || "");
  setVal("#ap-years", ap.years);
  setVal("#ap-trade", ap.trade);
  setVal("#ap-company", ap.company);
  setVal("#ap-name", ap.name);
  setVal("#ap-vacdays", ap.vacationDays);

  const esc = ctx.util.esc;
  const today = todayDate();

  // Status: Lehrjahr + Lehrabschluss
  let status = "";
  if (!ap.start) {
    status = `<p class="note ap-hint">Trag deinen Lehrbeginn ein – dann siehst du dein Lehrjahr und wann deine Lehre endet.</p>`;
  } else {
    const [y, m, d] = ap.start.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const end = apprenticeEnd(ap);
    const lj = apprenticeYear(ap, today);
    const left = Math.round((end - today) / DAY);
    let big, small;
    if (today < start) {
      big = "Lehre beginnt bald";
      small = `am ${fmtD(start)} – noch ${Math.round((start - today) / DAY)} Tage`;
    } else if (left < 0) {
      big = "Lehrzeit vorbei";
      small = `Lehrabschluss am ${fmtD(end)} – Glückwunsch!`;
    } else {
      big = `${lj}. Lehrjahr`;
      const ljEnd = new Date(Math.min(addMonths(start, 12 * lj).getTime() - DAY, end.getTime()));
      small = `bis ${fmtD(ljEnd)}`;
    }
    status = `<div class="ap-tiles">
      <div class="ap-tile ap-tile-main"><span class="ap-k">Jetzt</span><b>${esc(big)}</b><span>${esc(small)}</span></div>
      <div class="ap-tile"><span class="ap-k">Lehrabschluss voraussichtlich</span><b>${esc(fmtD(end))}</b>
        <span>${left >= 0 ? `noch <b>${left}</b> ${left === 1 ? "Tag" : "Tage"} bis zur LAP (ca.)` : "vorbei"}</span></div>
    </div>`;
  }
  $("#ap-status").innerHTML = status;

  // Urlaub im laufenden Urlaubsjahr
  const vy = vacationYear(ap, today);
  const fromK = keyOf(vy.from), toK = keyOf(vy.to);
  const days = new Set();
  for (const e of snap.entries || []) {
    if (!e || e.kind !== "urlaub") continue;
    const k = ctx.util.dayKey(e.start);
    if (k >= fromK && k < toK) days.add(k);
  }
  const taken = days.size;
  const rest = ap.vacationDays - taken;
  const lastDay = new Date(vy.to.getTime() - DAY / 2);
  $("#ap-vac").innerHTML = `
    <div class="ap-vt"><span>Anspruch</span><b>${ap.vacationDays}</b></div>
    <div class="ap-vt"><span>Genommen</span><b>${taken}</b></div>
    <div class="ap-vt ap-rest${rest < 0 ? " neg" : ""}"><span>Rest</span><b>${rest}</b></div>
    <p class="note ap-vy">Urlaubsjahr ${esc(fmtD(vy.from))} – ${esc(fmtD(lastDay))}${ap.start ? " (ab Lehrbeginn)" : " (Kalenderjahr, solange kein Lehrbeginn eingetragen ist)"}. Gezählt werden deine Einträge „Urlaub“.</p>`;
}
