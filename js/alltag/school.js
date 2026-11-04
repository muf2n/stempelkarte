// Alltag-Bereich „Schule & Lernen“ (Update 9b). Unterreiter:
// Fächer · Heute · Stundenplan · Aufgaben · Prüfungen · Planer · Noten · Lernen · Projekte · Dokumente.
// Modul-Vertrag (modules.js): export function mount(el, ctx) → cleanup.
// Daten: js/alltag/db.js, Sammlungen school_* (siehe school-core.js). Schultage kommen aus settings.school.
import {
  COLS, col, setToast, prefs, esc, dot, todayKey, addDays, diffDays, fmtDay, WD_LONG, dateOf, nowMin, toMin,
  lessonsOn, subjectColor, emptyHTML, countdown, fmtAvg, gradeColor,
} from "./school-core.js";
import { renderTimetable, schoolStatus, lessonLine, openLessonForm } from "./school-timetable.js";
import { renderTasks, renderProjects, taskRowHTML, wireTasks, openTaskForm, sortTasks, taskBucket, projectProgress } from "./school-tasks.js";
import { renderExams, renderGrades, upcomingExams, examCardHTML, wireExams, gradeStats, openExamForm } from "./school-exams.js";
import { renderLearn, ensureEngine, tick, pomoMiniHTML, planDue, planRowHTML, wirePlan, sessionsStats, fmtMin } from "./school-learn.js";
import { renderDocs } from "./school-docs.js";
import { renderSubjects } from "./school-subjects.js";
import { renderPlanner } from "./school-planner.js";

const TABS = [
  ["faecher", "Fächer", "📚"], ["heute", "Heute", "☀️"], ["stundenplan", "Stundenplan", "🗓️"], ["aufgaben", "Aufgaben", "📝"], ["pruefungen", "Prüfungen", "🎯"], ["planer", "Planer", "📅"],
  ["noten", "Noten", "⭐"], ["lernen", "Lernen", "🍅"], ["projekte", "Projekte", "🛠️"], ["dokumente", "Dokumente", "📂"],
];
const LS_TAB = "sk-school-tab";
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function injectCSS() {
  if (document.getElementById("ss-css")) return;
  const l = document.createElement("link");
  l.id = "ss-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-school.css", import.meta.url).href;
  document.head.appendChild(l);
}

/* ---------- Heute ---------- */

function nextSchoolDay(S, from) {
  const p = prefs(S.data);
  for (let i = 0; i < 70; i++) {
    const k = addDays(from, i);
    const st = schoolStatus(S, k);
    const ls = st.on ? lessonsOn(S.data, p, k) : [];
    if (st.configured ? st.on : ls.length) return { k, st, ls };
  }
  return null;
}

function renderToday(body, S) {
  const today = todayKey();
  const d = new Date();
  const p = prefs(S.data);
  const stToday = schoolStatus(S, today);
  const lsToday = stToday.on ? lessonsOn(S.data, p, today) : [];
  const nm = nowMin();
  const lastEnd = lsToday.reduce((m, l) => Math.max(m, toMin(l.to) || 0), 0);
  const todayOver = lsToday.length && nm > lastEnd;
  const hasTT = (S.data.timetable || []).length > 0;

  // Status-Zeile
  let status;
  if (stToday.configured) status = stToday.on ? `🏫 Heute ${stToday.label === "Berufsschule" ? "Berufsschule" : esc(stToday.label)}` : "Heute keine Schule";
  else status = lsToday.length ? `🏫 Heute ${lsToday.length} ${lsToday.length === 1 ? "Stunde" : "Stunden"}` : "Heute keine Stunden";

  // Stunden-Karte
  let lessonsCard;
  if (!hasTT) {
    lessonsCard = emptyHTML("🗓️", "Noch kein Stundenplan", "Trag deine Fächer ein, dann siehst du hier deine heutigen Stunden.", "Stundenplan anlegen", "add-lesson");
  } else if (lsToday.length && !todayOver) {
    lessonsCard = `<ul class="ss-lessons">${lsToday.map((l) => {
      const a = toMin(l.from), b = toMin(l.to);
      const now = a != null && b != null && nm >= a && nm < b;
      const past = b != null && nm >= b;
      return lessonLine(S, l, { now }).replace('class="ss-lesson', `class="ss-lesson${past ? " past" : ""}`);
    }).join("")}</ul>`;
  } else {
    const nx = nextSchoolDay(S, addDays(today, 1));
    lessonsCard = `<p class="note">${todayOver ? "Schule für heute geschafft! 🎉" : stToday.configured ? "Heute ist kein Schultag." : "Heute stehen keine Stunden im Plan."}</p>` + (nx
      ? `<div class="lbl ss-sub">Nächster Schultag · ${esc(diffDays(today, nx.k) === 1 ? "morgen" : fmtDay(nx.k))}${nx.st.label && nx.st.label !== "Berufsschule" ? " · " + esc(nx.st.label) : ""}</div>
         ${nx.ls.length ? `<ul class="ss-lessons">${nx.ls.map((l) => lessonLine(S, l)).join("")}</ul>` : `<p class="note">Für ${esc(WD_LONG[dateOf(nx.k).getDay()])} sind keine Stunden eingetragen.</p>`}`
      : "");
  }

  // Aufgaben
  const open = (S.data.tasks || []).filter((t) => !t.done).sort(sortTasks);
  const dueTasks = open.filter((t) => ["overdue", "today", "tomorrow"].includes(taskBucket(t, today)));
  const restWeek = open.filter((t) => taskBucket(t, today) === "week").length;
  const projSoon = (S.data.projects || []).filter((x) => x.due && projectProgress(x) < 100 && diffDays(today, x.due) <= 3);

  // Prüfungen
  const exams = upcomingExams(S.data, today);
  const plan = planDue(S.data, today);
  const st = sessionsStats(S.data);
  const gs = gradeStats(S.data);

  body.innerHTML = `
    <section class="ss-hero">
      <div class="ss-hero-t"><span class="ss-hero-d">${esc(WD_LONG[d.getDay()])}</span><b>${d.getDate()}. ${MONTHS[d.getMonth()]}</b></div>
      <span class="ss-hero-s">${status}</span>
      ${pomoMiniHTML()}
      <div class="ss-hero-k">
        <button type="button" data-go="aufgaben"><b>${open.length}</b><span>offene Aufgaben</span></button>
        <button type="button" data-go="pruefungen"><b>${exams.length}</b><span>${exams.length === 1 ? "Prüfung" : "Prüfungen"}</span></button>
        <button type="button" data-go="noten"><b>${fmtAvg(gs.overall)}</b><span>Notenschnitt</span></button>
        <button type="button" data-go="lernen"><b>${esc(fmtMin(st.weekMin))}</b><span>gelernt (Woche)</span></button>
      </div>
    </section>
    <div class="ss-grid">
      <section class="card ss-card"><div class="ss-h-row"><h3 class="ss-h">${lsToday.length && !todayOver ? "Heutige Stunden" : "Stunden"}</h3>${hasTT ? `<button type="button" class="linkbtn" data-go="stundenplan">Wochenplan</button>` : ""}</div>${lessonsCard}</section>
      <section class="card ss-card"><div class="ss-h-row"><h3 class="ss-h">Fällig <span class="ss-count">${dueTasks.length}</span></h3><button type="button" class="ss-icon-btn" data-act="add-task" aria-label="Aufgabe hinzufügen">+</button></div>
        ${dueTasks.length ? `<ul class="ss-list">${dueTasks.map((t) => taskRowHTML(S, t)).join("")}</ul>` : `<p class="note">${open.length ? "Heute und morgen ist nichts fällig. 👍" : "Keine offenen Aufgaben."}</p>`}
        ${projSoon.map((x) => `<button type="button" class="ss-proj-mini" data-go="projekte" style="--c:${esc(subjectColor(S.data, x.subject))}">🛠️ <b>${esc(x.title)}</b><span>${esc(countdown(x.due, { past: "overdue" }))} · ${projectProgress(x)} %</span></button>`).join("")}
        ${restWeek ? `<button type="button" class="linkbtn" data-go="aufgaben">+ ${restWeek} weitere diese Woche</button>` : ""}
      </section>
      <section class="ss-col">
        ${exams.length ? examCardHTML(S, exams[0]) + (exams.length > 1 ? `<section class="card ss-card ss-more-exams"><div class="lbl">Danach</div><ul class="ss-mini">${exams.slice(1, 4).map((e) => `<li><button type="button" data-go="pruefungen">${dot(subjectColor(S.data, e.subject))}<b>${esc(e.kind)} ${esc(e.subject)}</b><span>${esc(fmtDay(e.date))} · ${esc(countdown(e.date))}</span></button></li>`).join("")}</ul></section>` : "")
          : `<section class="card ss-card"><h3 class="ss-h">Nächste Prüfung</h3><p class="note">Keine Prüfung eingetragen.</p><button type="button" class="btn ghost sm" data-act="add-exam">+ Prüfung</button></section>`}
      </section>
      <section class="card ss-card"><div class="ss-h-row"><h3 class="ss-h">Heute lernen <span class="ss-count">${plan.length}</span></h3><button type="button" class="linkbtn" data-go="lernen">Lern-Timer</button></div>
        ${plan.length ? `<ul class="ss-list">${plan.map((x) => planRowHTML(S, x)).join("")}</ul>` : `<p class="note">${(S.data.plan || []).length ? "Für heute nichts im Lernplan. 🙌" : "Lernplan entsteht automatisch aus deinen Prüfungen."}</p>`}
      </section>
    </div>`;

  body.querySelectorAll("[data-act=add-lesson]").forEach((b) => b.addEventListener("click", () => openLessonForm(S)));
  body.querySelectorAll("[data-act=add-task]").forEach((b) => b.addEventListener("click", () => openTaskForm(S)));
  body.querySelectorAll("[data-act=add-exam]").forEach((b) => b.addEventListener("click", () => openExamForm(S)));
  wireTasks(body, S);
  wireExams(body, S);
  wirePlan(body, S);
}

const VIEWS = {
  faecher: renderSubjects, planer: renderPlanner, heute: renderToday, stundenplan: renderTimetable, aufgaben: renderTasks, pruefungen: renderExams,
  noten: renderGrades, lernen: renderLearn, projekte: renderProjects, dokumente: renderDocs,
};

/* ---------- mount ---------- */

export function mount(el, ctx) {
  injectCSS();
  setToast((m) => { try { ctx.ui.toast(m); } catch { /* egal */ } });
  ensureEngine(ctx);

  let tab = "faecher";
  try { const t = localStorage.getItem(LS_TAB); if (VIEWS[t]) tab = t; } catch { /* egal */ }
  if (ctx && typeof ctx.sub === "string" && VIEWS[ctx.sub]) tab = ctx.sub;

  const S = { ctx, data: {}, view: {}, keepFocus: null };
  el.classList.add("ss");
  el.innerHTML = `<nav class="ss-tabs" role="tablist" aria-label="Schule & Lernen">
      ${TABS.map(([id, label, e]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === tab}"><span aria-hidden="true">${e}</span>${esc(label)}</button>`).join("")}
    </nav><div class="ss-body" role="tabpanel"></div>`;
  const body = el.querySelector(".ss-body");
  const nav = el.querySelector(".ss-tabs");

  let raf = 0, alive = true;
  const render = () => {
    raf = 0;
    if (!alive) return;
    const sel = S.keepFocus; S.keepFocus = null;
    const sx = window.scrollX, sy = window.scrollY;
    try { VIEWS[tab](body, S); } catch (err) { console.error("Schule:", err); body.innerHTML = `<p class="note">Fehler beim Anzeigen.</p>`; }
    body.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => S.go(b.dataset.go)));
    tick(body);
    if (sel) { const f = body.querySelector(sel); if (f) { f.focus(); try { const n = f.value.length; f.setSelectionRange(n, n); } catch { /* egal */ } } }
    if (window.scrollY !== sy) window.scrollTo(sx, sy);
  };
  S.rerender = () => { if (!raf) raf = requestAnimationFrame(render); };
  S.go = (t) => {
    if (!VIEWS[t]) return;
    tab = t;
    try { localStorage.setItem(LS_TAB, t); } catch { /* egal */ }
    nav.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    const ab = nav.querySelector(`[data-tab="${t}"]`);
    if (ab && ab.scrollIntoView) try { ab.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); } catch { /* egal */ }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    render();
    const top = el.getBoundingClientRect().top + window.scrollY - 90;
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
  };
  nav.addEventListener("click", (ev) => { const b = ev.target.closest("[data-tab]"); if (!b) return; if (b.dataset.tab === "faecher") S.view.subject = null; S.go(b.dataset.tab); });

  const offs = COLS.map((n) => col(n).watch((items) => { S.data[n] = items; S.rerender(); }));
  const offStore = ctx.store.subscribe(() => S.rerender()); // Schultage/Einstellungen geändert
  body.addEventListener("pomo-change", () => S.rerender());
  let lastMin = nowMin();
  const iv = setInterval(() => {
    tick(body);
    const m = nowMin();
    if (m !== lastMin) { lastMin = m; if (tab === "heute") S.rerender(); }
  }, 1000);
  const onVis = () => { if (document.visibilityState === "visible") S.rerender(); };
  document.addEventListener("visibilitychange", onVis);
  render();
  requestAnimationFrame(() => { const ab = nav.querySelector('[aria-selected="true"]'); if (ab) nav.scrollLeft = Math.max(0, ab.offsetLeft - 16); });

  return () => {
    alive = false;
    if (raf) cancelAnimationFrame(raf);
    clearInterval(iv);
    offs.forEach((f) => { try { f(); } catch { /* egal */ } });
    try { offStore(); } catch { /* egal */ }
    document.removeEventListener("visibilitychange", onVis);
    el.classList.remove("ss");
    el.innerHTML = "";
  };
}

// für Tests
export { gradeColor };
