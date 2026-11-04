// Schule & Lernen – Unterreiter „Planer“: Monatskalender mit Punkten (Prüfungen, Aufgaben, Lerneinheiten),
// Liste für den gewählten Tag und „✨ Mit KI planen“ (Claude über ai-client.js → Vorschau → school_plan).
// Ohne Server / lokal / bei Fehler: automatischer Plan aus distributePlan() (school-exams.js).
import {
  col, safeWrite, esc, dot, todayKey, keyOf, addDays, dateOf, diffDays, fmtDay, fmtDayY, countdown, RE_DATE, pad,
  subjects, subjectColor, sameSubj, lessonsOn, prefs, WD_LONG,
} from "./school-core.js";
import { taskRowHTML, wireTasks, openTaskForm } from "./school-tasks.js";
import { upcomingExams, topicsOf, planOf, distributePlan, openExamForm, wireExams, examTitle } from "./school-exams.js";
import { planRowHTML, wirePlan, fmtMin } from "./school-learn.js";
import { schoolStatus } from "./school-timetable.js";
import { askClaude, aiAvailable } from "./ai-client.js";

const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WD_HEAD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const PLAN_DAYS = 14;

/* ---------- Kalender ---------- */

function eventsByDay(data) {
  const m = new Map();
  const get = (k) => { if (!m.has(k)) m.set(k, { exams: [], tasks: [], plan: [] }); return m.get(k); };
  for (const e of data.exams || []) if (RE_DATE.test(e.date || "")) get(e.date).exams.push(e);
  for (const t of data.tasks || []) if (RE_DATE.test(t.due || "")) get(t.due).tasks.push(t);
  for (const p of data.plan || []) if (RE_DATE.test(p.date || "")) get(p.date).plan.push(p);
  return m;
}

function calendarHTML(S, ym, sel, ev) {
  const [y, mo] = ym.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const n = new Date(y, mo, 0).getDate();
  const today = todayKey();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<span class="ss-cal-x" aria-hidden="true"></span>`);
  for (let d = 1; d <= n; d++) {
    const k = `${y}-${pad(mo)}-${pad(d)}`;
    const e = ev.get(k);
    const ex = e ? e.exams.length : 0, tk = e ? e.tasks.filter((t) => !t.done).length : 0, pl = e ? e.plan.filter((p) => !p.done).length : 0;
    const pd = e ? e.plan.length - pl : 0;
    const lbl = [ex && `${ex} Prüfung${ex > 1 ? "en" : ""}`, tk && `${tk} Aufgabe${tk > 1 ? "n" : ""}`, (pl || pd) && `${pl + pd} Lerneinheit${pl + pd > 1 ? "en" : ""}`].filter(Boolean).join(", ");
    cells.push(`<button type="button" class="ss-cal-d${k === today ? " today" : ""}${k === sel ? " sel" : ""}${k < today ? " past" : ""}" data-cday="${k}" aria-pressed="${k === sel}" aria-label="${esc(fmtDayY(k))}${lbl ? ": " + esc(lbl) : ""}">
      <b>${d}</b><span class="ss-cal-dots">${ex ? `<i class="ex"></i>` : ""}${tk ? `<i class="tk"></i>` : ""}${pl ? `<i class="pl"></i>` : pd ? `<i class="pl done"></i>` : ""}</span></button>`);
  }
  return `<section class="card ss-card ss-cal">
    <div class="ss-cal-h">
      <button type="button" class="ss-icon-btn" data-cm="-1" aria-label="Voriger Monat">‹</button>
      <button type="button" class="ss-cal-t" data-cm="0"><b>${MONTHS[mo - 1]} ${y}</b></button>
      <button type="button" class="ss-icon-btn" data-cm="1" aria-label="Nächster Monat">›</button>
    </div>
    <div class="ss-cal-g">${WD_HEAD.map((w) => `<span class="ss-cal-wd">${w}</span>`).join("")}${cells.join("")}</div>
    <div class="ss-cal-leg"><span><i class="ex"></i>Prüfung</span><span><i class="tk"></i>Aufgabe</span><span><i class="pl"></i>Lerneinheit</span></div>
  </section>`;
}

function dayHTML(S, k, ev) {
  const e = ev.get(k) || { exams: [], tasks: [], plan: [] };
  const today = todayKey();
  const plan = [...e.plan].sort((a, b) => (a.done - b.done) || (a.order || 0) - (b.order || 0));
  const tasks = [...e.tasks].sort((a, b) => a.done - b.done);
  const st = schoolStatus(S, k);
  const ls = st.on ? lessonsOn(S.data, prefs(S.data), k) : [];
  const min = plan.filter((p) => !p.done).reduce((a, p) => a + (Number(p.minutes) || 0), 0);
  const rel = diffDays(today, k);
  const title = rel === 0 ? "Heute" : rel === 1 ? "Morgen" : WD_LONG[dateOf(k).getDay()];
  const d = dateOf(k);
  return `<section class="card ss-card ss-calday">
    <div class="ss-h-row"><h3 class="ss-h">${esc(title)}, ${d.getDate()}. ${MONTHS[d.getMonth()]}</h3>
      <button type="button" class="ss-icon-btn" data-cadd aria-label="Aufgabe an diesem Tag">+</button></div>
    ${ls.length ? `<p class="note ss-cal-school">🏫 ${ls.length} ${ls.length === 1 ? "Stunde" : "Stunden"}: ${esc([...new Set(ls.map((l) => l.subject))].join(", "))}</p>` : ""}
    ${e.exams.length ? `<ul class="ss-mini ss-cal-ex">${e.exams.map((x) => `<li><button type="button" data-eedit="${esc(x.id)}" style="--c:${esc(subjectColor(S.data, x.subject))}">🎯 <b>${esc(examTitle(x))}</b><span>${x.time ? esc(x.time) + " · " : ""}${esc(countdown(x.date))}</span></button></li>`).join("")}</ul>` : ""}
    ${tasks.length ? `<div class="lbl">Aufgaben</div><ul class="ss-list">${tasks.map((t) => taskRowHTML(S, t)).join("")}</ul>` : ""}
    ${plan.length ? `<div class="lbl">Lernen${min ? ` · ${esc(fmtMin(min))}` : ""}</div><ul class="ss-list">${plan.map((p) => planRowHTML(S, p)).join("")}</ul>` : ""}
    ${!e.exams.length && !tasks.length && !plan.length ? `<p class="note">Für diesen Tag ist nichts eingetragen.</p>
      <div class="row"><button type="button" class="btn ghost sm" data-cadd>+ Aufgabe</button><button type="button" class="btn ghost sm" data-cexam>+ Prüfung</button></div>` : ""}
  </section>`;
}

/* ---------- KI-Plan: Prompt, Antwort lesen ---------- */

export function planContext(S, today = todayKey()) {
  const end = addDays(today, PLAN_DAYS - 1);
  const exams = upcomingExams(S.data, today).filter((e) => e.date > today && diffDays(today, e.date) <= 45).slice(0, 10);
  const tasks = (S.data.tasks || []).filter((t) => !t.done && (!t.due || (t.due >= addDays(today, -7) && t.due <= addDays(end, 7))))
    .sort((a, b) => ((a.due || "9") < (b.due || "9") ? -1 : 1)).slice(0, 20);
  const school = [];
  for (let i = 0; i < PLAN_DAYS; i++) {
    const k = addDays(today, i);
    const st = schoolStatus(S, k);
    if (st.configured ? st.on : lessonsOn(S.data, prefs(S.data), k).length) school.push(k);
  }
  const planned = (S.data.plan || []).filter((p) => !p.done && p.date >= today && p.date <= end && p.source !== "ai").slice(0, 30);
  return { today, end, exams, tasks, school, planned };
}

export function buildPlanPrompt(S, today = todayKey()) {
  const c = planContext(S, today);
  const data = {
    heute: c.today, wochentag: WD_LONG[dateOf(c.today).getDay()], bis: c.end,
    faecher: subjects(S.data),
    pruefungen: c.exams.map((e) => ({ fach: e.subject || "", art: e.kind || "Prüfung", datum: e.date, stoff: topicsOf(e).slice(0, 10) })),
    aufgaben: c.tasks.map((t) => ({ fach: t.subject || "", titel: t.title, faellig: t.due || null, ...(t.prio === "high" ? { wichtig: true } : {}) })),
    schultage: c.school,
    schon_geplant: c.planned.map((p) => ({ date: p.date, subject: p.subject || "", topic: p.title })),
  };
  return `Du bist mein Lernplaner für die Berufsschule (Elektrotechnik-Lehre, Österreich). Erstelle einen Lernplan für die nächsten ${PLAN_DAYS} Tage (${c.today} bis ${c.end}).
Regeln:
- Lerneinheiten nur an Tagen VOR der jeweiligen Prüfung; nähere Prüfungen und mehr Stoff zuerst.
- Den Stoff sinnvoll aufteilen, der letzte Tag vor einer Prüfung ist eine Wiederholung.
- Offene Aufgaben vor ihrer Fälligkeit einplanen (Thema = Aufgabe).
- Pro Tag höchstens 90 Minuten, an Schultagen höchstens 45 Minuten; Einheiten 15–60 Minuten.
- "schon_geplant" nicht doppelt planen.
- Fach genau so schreiben wie in "faecher".
WICHTIG: Trag nichts selbst ein und benutze keine Werkzeuge. Antworte NUR mit einem JSON-Array ohne weiteren Text, höchstens 24 Einträge, topic höchstens 60 Zeichen:
[{"date":"YYYY-MM-DD","subject":"Fach","topic":"Thema","minutes":30}]

Daten:
${JSON.stringify(data)}`;
}

/** Findet ein JSON-Array (auch in ```json … ```, mit Text drumherum oder als {units:[…]}). */
export function extractJSONArray(text) {
  const t = String(text || "");
  const cands = [];
  for (const m of t.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) cands.push(m[1]);
  cands.push(t);
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a >= 0 && b > a) cands.push(t.slice(a, b + 1));
  const oa = t.indexOf("{"), ob = t.lastIndexOf("}");
  if (oa >= 0 && ob > oa) cands.push(t.slice(oa, ob + 1));
  const pick = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? [v.units, v.plan, v.lernplan, v.einheiten, v.items].find(Array.isArray) : null);
  for (const c of cands) {
    for (const s of [c.trim(), c.trim().replace(/,\s*([\]}])/g, "$1")]) {
      try { const r = pick(JSON.parse(s)); if (r) return r; } catch { /* nächster */ }
    }
  }
  const objs = [];
  for (const m of t.matchAll(/\{[^{}]*\}/g)) { try { objs.push(JSON.parse(m[0].replace(/,\s*}/g, "}"))); } catch { /* weiter */ } }
  return objs;
}

/** Antwort → [{date, subject, topic, minutes}] (geprüft, sortiert, nur die nächsten 14 Tage). */
export function parsePlanReply(text, { today = todayKey(), known = [] } = {}) {
  const end = addDays(today, PLAN_DAYS);
  const out = [];
  for (const r of extractJSONArray(text)) {
    if (!r || typeof r !== "object") continue;
    let date = String(r.date || r.datum || r.tag || "").trim().slice(0, 10);
    const dm = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(r.date || r.datum || "").trim());
    if (dm) date = `${dm[3]}-${pad(dm[2])}-${pad(dm[1])}`;
    if (!RE_DATE.test(date) || date < today || date > end) continue;
    const rawS = String(r.subject || r.fach || "").trim().slice(0, 50);
    const subject = known.find((k) => sameSubj(k, rawS)) || rawS;
    const topic = String(r.topic || r.thema || r.title || r.titel || "").trim().replace(/\s+/g, " ").slice(0, 80) || (subject ? `Lernen: ${subject}` : "");
    if (!topic) continue;
    let minutes = Math.round(Number(r.minutes ?? r.minuten ?? r.min ?? r.dauer) / 5) * 5;
    if (!Number.isFinite(minutes) || minutes <= 0) minutes = 30;
    out.push({ date, subject, topic, minutes: Math.min(180, Math.max(5, minutes)) });
    if (out.length >= 40) break;
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Automatischer Plan (bestehender Generator) für Prüfungen ohne offenen Lernplan, nur die nächsten 14 Tage. */
export function autoUnits(S, today = todayKey()) {
  const end = addDays(today, PLAN_DAYS - 1);
  const units = [];
  let skipped = 0;
  for (const e of upcomingExams(S.data, today)) {
    if (e.date <= today) continue;
    if (planOf(S.data, e.id).some((p) => !p.done)) { skipped++; continue; }
    for (const u of distributePlan({ topics: topicsOf(e), start: today, examDate: e.date, minutes: 30, subject: e.subject || "" })) {
      if (u.date <= end) units.push({ date: u.date, subject: e.subject || "", topic: u.title, minutes: u.minutes, examId: e.id, review: !!u.review });
    }
  }
  return { units: units.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)), skipped };
}

function matchExam(data, subject, date) {
  return upcomingExams(data, date).find((e) => sameSubj(e.subject, subject) && e.date >= date) || null;
}

/** Vorschau-Einheiten in school_plan übernehmen (Form wie openPlanForm in school-exams.js). */
export function adoptUnits(S, units, { source = "ai", replace = false } = {}) {
  const today = todayKey();
  if (replace) for (const p of S.data.plan || []) if (p.source === "ai" && !p.done && p.date >= today) safeWrite(col("plan").remove(p.id));
  const order = new Map();
  for (const u of units) {
    const ex = u.examId ? { id: u.examId } : matchExam(S.data, u.subject, u.date);
    const o = order.get(u.date) || 0; order.set(u.date, o + 1);
    safeWrite(col("plan").put({ date: u.date, title: u.topic, minutes: u.minutes, order: o, examId: ex ? ex.id : null, subject: u.subject || "", done: false, source, ...(u.review ? { review: true } : {}) }));
  }
  return units.length;
}

function openPreview(S, units, { source, note }) {
  const byDay = new Map();
  units.forEach((u, i) => { if (!byDay.has(u.date)) byDay.set(u.date, []); byDay.get(u.date).push([u, i]); });
  const total = units.reduce((a, u) => a + u.minutes, 0);
  const hasOldAI = (S.data.plan || []).some((p) => p.source === "ai" && !p.done && p.date >= todayKey());
  S.ctx.ui.openSheet({
    title: source === "ai" ? "✨ Lernplan von Claude" : "Automatischer Lernplan",
    bodyHTML: `<div class="fields ss-form ss-pv">
      ${note ? `<div class="hint ss-pv-note">${esc(note)}</div>` : ""}
      ${units.length ? `<p class="note"><b>${units.length} Einheiten</b> · ${esc(fmtMin(total))} in ${byDay.size} ${byDay.size === 1 ? "Tag" : "Tagen"} – Häkchen entfernen, was du nicht willst.</p>
      <div class="ss-pv-days">${[...byDay.entries()].map(([k, l]) => `<div class="ss-pv-day"><span>${esc(fmtDay(k))}</span><ul>${l.map(([u, i]) => `<li><label class="ss-pv-u" style="--c:${esc(subjectColor(S.data, u.subject))}">
          <input type="checkbox" data-pvi="${i}" checked><span><b>${esc(u.topic)}</b><small>${u.subject ? `${dot(subjectColor(S.data, u.subject))}${esc(u.subject)} · ` : ""}${u.minutes} min</small></span></label></li>`).join("")}</ul></div>`).join("")}</div>
      ${source === "ai" && hasOldAI ? `<label class="switch">Frühere offene KI-Einheiten ersetzen<input type="checkbox" id="pv-repl" checked></label>` : ""}
      <div class="row"><button type="button" class="btn primary ss-ai-btn" id="pv-go">Übernehmen</button><button type="button" class="btn ghost" id="pv-x">Verwerfen</button></div>`
      : `<p class="note">Es gibt gerade nichts Neues zu planen – alle kommenden Prüfungen haben schon einen Lernplan oder liegen außerhalb der nächsten ${PLAN_DAYS} Tage.</p>
         <div class="row"><button type="button" class="btn ghost" id="pv-x">Schließen</button></div>`}
    </div>`,
    onMount(el, close) {
      el.querySelector("#pv-x").addEventListener("click", () => close());
      const go = el.querySelector("#pv-go");
      if (!go) return;
      const upd = () => { const n = el.querySelectorAll("[data-pvi]:checked").length; go.textContent = n ? `Übernehmen (${n})` : "Übernehmen"; go.disabled = !n; };
      el.querySelectorAll("[data-pvi]").forEach((c) => c.addEventListener("change", upd));
      upd();
      go.addEventListener("click", () => {
        const pick = [...el.querySelectorAll("[data-pvi]:checked")].map((c) => units[Number(c.dataset.pvi)]);
        const repl = el.querySelector("#pv-repl");
        const n = adoptUnits(S, pick, { source, replace: !!(repl && repl.checked) });
        S.ctx.ui.toast(`${n} Lerneinheiten in den Lernplan übernommen ✓`);
        close();
      });
    },
  });
}

let busy = false;
const BUSY_HTML = `<span class="ss-ai-spin" aria-hidden="true"></span>Claude plant …`;
export async function planWithAI(S, btn) {
  if (busy) return;
  const c = planContext(S);
  const fallback = (why) => {
    const { units, skipped } = autoUnits(S);
    const note = `${why} Hier ist der automatische Plan aus deinen Prüfungen${skipped ? ` (${skipped} ${skipped === 1 ? "Prüfung hat" : "Prüfungen haben"} schon einen Plan)` : ""}.`;
    openPreview(S, units, { source: "auto", note });
  };
  if (!c.exams.length && !c.tasks.length) { S.ctx.ui.toast("Keine kommenden Prüfungen oder offenen Aufgaben – nichts zu planen."); return; }
  if (!aiAvailable()) { fallback("Ohne Anmeldung (lokaler Modus) kann Claude nicht planen."); return; }
  busy = true;
  if (btn) { btn.disabled = true; btn.classList.add("busy"); btn.innerHTML = BUSY_HTML; }
  try {
    const res = await askClaude([{ role: "user", content: buildPlanPrompt(S) }], { timeoutMs: 90000 });
    const units = parsePlanReply(res.reply, { known: subjects(S.data) });
    if (!units.length) fallback("Claude hat keinen brauchbaren Plan geliefert.");
    else openPreview(S, units, { source: "ai", note: "" });
  } catch (err) {
    console.warn("KI-Lernplan:", err);
    fallback(`Claude ist gerade nicht erreichbar${err && err.message ? ` (${err.message.replace(/[.\s]+$/, "")})` : ""}.`);
  } finally {
    busy = false;
    S.rerender();
  }
}

/* ---------- Ansicht ---------- */

export function renderPlanner(body, S) {
  const today = todayKey();
  const sel = RE_DATE.test(S.view.calDay || "") ? S.view.calDay : today;
  const ym = /^\d{4}-\d{2}$/.test(S.view.calMonth || "") ? S.view.calMonth : sel.slice(0, 7);
  const ev = eventsByDay(S.data);
  const next14 = (S.data.plan || []).filter((p) => !p.done && p.date >= today && p.date < addDays(today, PLAN_DAYS));
  body.innerHTML = `<div class="ss-toolbar ss-plan-top">
      <div class="ss-plan-t"><h3 class="ss-h">Lernplaner</h3><p class="note">${next14.length ? `${next14.length} offene ${next14.length === 1 ? "Lerneinheit" : "Lerneinheiten"} in den nächsten ${PLAN_DAYS} Tagen` : "Plan deine Lerneinheiten bis zur nächsten Prüfung."}</p></div>
      <button type="button" class="ss-ai-btn${busy ? " busy" : ""}" id="pl-ai"${busy ? " disabled" : ""}>${busy ? BUSY_HTML : "✨ Mit KI planen"}</button>
    </div>
    <div class="ss-plan-grid">${calendarHTML(S, ym, sel, ev)}${dayHTML(S, sel, ev)}</div>`;
  body.querySelectorAll("[data-cm]").forEach((b) => b.addEventListener("click", () => {
    const n = Number(b.dataset.cm);
    if (!n) { S.view.calMonth = today.slice(0, 7); S.view.calDay = today; }
    else { const [y, m] = ym.split("-").map(Number); S.view.calMonth = keyOf(new Date(y, m - 1 + n, 1)).slice(0, 7); }
    S.rerender();
  }));
  body.querySelectorAll("[data-cday]").forEach((b) => b.addEventListener("click", () => { S.view.calDay = b.dataset.cday; S.view.calMonth = b.dataset.cday.slice(0, 7); S.rerender(); }));
  body.querySelectorAll("[data-cadd]").forEach((b) => b.addEventListener("click", () => openTaskForm(S, null, { due: sel })));
  body.querySelectorAll("[data-cexam]").forEach((b) => b.addEventListener("click", () => openExamForm(S, null, { date: sel })));
  body.querySelector("#pl-ai").addEventListener("click", (e) => planWithAI(S, e.currentTarget));
  wireTasks(body, S);
  wireExams(body, S);
  wirePlan(body, S);
}
