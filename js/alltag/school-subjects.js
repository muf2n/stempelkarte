// Schule & Lernen – Unterreiter „Fächer“: Verlaufskarte pro Fach (Aufgaben, Prüfung, Schnitt, Fortschritt),
// „Gesamtfortschritt“ und Fach-Detail (alles aus den bestehenden Sammlungen gefiltert).
// Symbol pro Fach: prefs.subjectEmoji (school_meta/"prefs"), Standard aus defaultSubjectEmoji().
import {
  col, safeWrite, esc, todayKey, diffDays, fmtDay, fmtDate, countdown, prefs, savePrefs, subjects, subjectColor,
  subjectEmoji, defaultSubjectEmoji, EMOJI_CHOICES, sameSubj, emptyHTML, fmtAvg, gradeColor, GRADE_COLORS, WD_LONG,
} from "./school-core.js";
import { taskRowHTML, wireTasks, openTaskForm, sortTasks } from "./school-tasks.js";
import { upcomingExams, examCardHTML, wireExams, openExamForm, avgOf, openGradeForm } from "./school-exams.js";
import { planRowHTML, wirePlan, fmtMin } from "./school-learn.js";
import { lessonLine, openLessonForm } from "./school-timetable.js";
import { openDoc, kindIcon } from "./school-docs.js";

const of = (list, s) => (list || []).filter((x) => sameSubj(x.subject, s));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Kennzahlen eines Fachs. */
export function subjectStats(data, s, today = todayKey()) {
  const tasks = of(data.tasks, s), plan = of(data.plan, s);
  const tDone = tasks.filter((t) => t.done).length, pDone = plan.filter((p) => p.done).length;
  const exams = upcomingExams(data, today).filter((e) => sameSubj(e.subject, s));
  const grades = of(data.grades, s);
  const sessions = of(data.sessions, s);
  return {
    subject: s, tasks, plan, tDone, pDone, exams, next: exams[0] || null, grades, avg: avgOf(grades),
    lessons: of(data.timetable, s), sessions, minutes: sessions.reduce((a, x) => a + (Number(x.minutes) || 0), 0),
    docs: of(data.docs, s), projects: of(data.projects, s),
    done: tDone + pDone, total: tasks.length + plan.length, progress: pct(tDone + pDone, tasks.length + plan.length),
  };
}

function cardHTML(S, st) {
  const c = subjectColor(S.data, st.subject);
  const n = st.next ? diffDays(todayKey(), st.next.date) : null;
  return `<button type="button" class="ss-fach" data-sopen="${esc(st.subject)}" style="--c:${esc(c)}" aria-label="${esc(st.subject)} öffnen">
    <span class="ss-fach-main">
      <b class="ss-fach-n">${esc(st.subject)}</b>
      <span class="ss-fach-t">${st.tasks.length ? `<b>${st.tDone}/${st.tasks.length}</b> Aufgaben erledigt` : "Keine Aufgaben"}</span>
      <span class="ss-fach-chips">
        ${st.next ? `<span class="${n <= 3 ? "hot" : ""}">🎯 ${esc(st.next.kind || "Prüfung")} · ${esc(countdown(st.next.date))}</span>` : ""}
        ${st.avg != null ? `<span>Ø ${fmtAvg(st.avg)}</span>` : ""}
        ${st.plan.length ? `<span>📖 ${st.pDone}/${st.plan.length}</span>` : ""}
      </span>
      <span class="ss-fach-pl"><span>Fortschritt</span><b>${st.total ? st.progress + " %" : "–"}</b></span>
      <span class="ss-fach-bar" role="progressbar" aria-valuenow="${st.progress}" aria-valuemin="0" aria-valuemax="100"><i style="width:${st.progress}%"></i></span>
    </span>
    <span class="ss-fach-emo" aria-hidden="true">${esc(subjectEmoji(S.data, st.subject))}</span>
  </button>`;
}

function overallHTML(S, all) {
  const tasks = all.reduce((a, x) => a + x.tasks.length, 0);
  const tDone = all.reduce((a, x) => a + x.tDone, 0);
  const done = all.reduce((a, x) => a + x.done, 0), total = all.reduce((a, x) => a + x.total, 0);
  const avgs = all.map((x) => x.avg).filter((x) => x != null);
  const avg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
  const p = pct(done, total);
  return `<section class="card ss-card ss-overall">
    <div class="ss-h-row"><h3 class="ss-h">Gesamtfortschritt</h3><b class="ss-overall-p">${total ? p + " %" : "–"}</b></div>
    <div class="ss-overall-k">
      <div><b>${all.length}</b><span>${all.length === 1 ? "Fach" : "Fächer"}</span></div>
      <div><b>${tasks}</b><span>Aufgaben gesamt</span></div>
      <div><b>${tDone}</b><span>erledigt</span></div>
      <div><b style="${avg != null ? `color:${gradeColor(avg)}` : ""}">${fmtAvg(avg)}</b><span>Notenschnitt</span></div>
    </div>
    <div class="ss-progress ss-overall-bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><div style="width:${p}%"></div></div>
    <p class="note">${done} von ${total} Aufgaben und Lerneinheiten erledigt</p>
  </section>`;
}

export function openEmojiPicker(S, s) {
  const cur = subjectEmoji(S.data, s);
  S.ctx.ui.openSheet({
    title: `Symbol für ${s}`,
    bodyHTML: `<div class="fields ss-form">
      <div class="ss-emojis" role="radiogroup" aria-label="Symbol">${EMOJI_CHOICES.map((e) => `<button type="button" data-emo="${esc(e)}" aria-pressed="${e === cur}" aria-label="${esc(e)}">${esc(e)}</button>`).join("")}</div>
      <label>Oder eigenes Emoji<input type="text" id="em-own" maxlength="8" value="${esc(cur)}" autocomplete="off"></label>
      <div class="row"><button type="button" class="btn primary" id="em-save">Speichern</button><button type="button" class="btn ghost" id="em-def">Standard (${esc(defaultSubjectEmoji(s))})</button></div>
    </div>`,
    onMount(el, close) {
      const own = el.querySelector("#em-own");
      el.querySelector(".ss-emojis").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-emo]"); if (!b) return;
        own.value = b.dataset.emo;
        el.querySelectorAll("[data-emo]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      const save = (e) => {
        const map = { ...(prefs(S.data).subjectEmoji || {}) };
        const k = s.trim().toLowerCase();
        if (e) map[k] = e; else delete map[k];
        safeWrite(savePrefs(S.data, { subjectEmoji: map }));
        S.ctx.ui.toast("Symbol gespeichert"); close();
      };
      el.querySelector("#em-save").addEventListener("click", () => save(own.value.trim()));
      el.querySelector("#em-def").addEventListener("click", () => save(""));
    },
  });
}

/* ---------- Detail ---------- */

function renderDetail(body, S, s) {
  const st = subjectStats(S.data, s);
  const c = subjectColor(S.data, s);
  const today = todayKey();
  const openT = st.tasks.filter((t) => !t.done).sort(sortTasks);
  const doneT = st.tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 5);
  const planNext = st.plan.filter((p) => !p.done).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 8);
  const pastExams = of(S.data.exams, s).filter((e) => !(e.date >= today)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const grades = [...st.grades].sort((a, b) => (a.date < b.date ? 1 : -1));
  const lessons = [...st.lessons].sort((a, b) => ((Number(a.weekday) + 6) % 7) - ((Number(b.weekday) + 6) % 7) || (a.period || 0) - (b.period || 0));
  const weekMin = st.sessions.filter((x) => diffDays(x.date, today) < 7).reduce((a, x) => a + (Number(x.minutes) || 0), 0);
  const recent = [...st.sessions].sort((a, b) => (b.start || 0) - (a.start || 0)).slice(0, 4);
  const docs = [...st.docs].sort((a, b) => (b.created || 0) - (a.created || 0));
  const hours = lessons.reduce((a, l) => a + Math.max(1, Number(l.periods) || 1), 0);
  const head = (t, n, act) => `<div class="ss-h-row"><h3 class="ss-h">${t}${n != null ? ` <span class="ss-count">${n}</span>` : ""}</h3>${act ? `<button type="button" class="ss-icon-btn" data-sd="${act}" aria-label="${t} hinzufügen">+</button>` : ""}</div>`;

  body.innerHTML = `<div class="ss-toolbar"><button type="button" class="linkbtn ss-back" data-sback>‹ Alle Fächer</button></div>
    <section class="ss-fach ss-fach-hero" style="--c:${esc(c)}">
      <span class="ss-fach-main">
        <b class="ss-fach-n">${esc(s)}</b>
        <span class="ss-fach-t">${hours ? `${hours} ${hours === 1 ? "Stunde" : "Stunden"} pro Woche` : "Nicht im Stundenplan"}${st.avg != null ? ` · Ø ${fmtAvg(st.avg)}` : ""}</span>
        <span class="ss-fach-k">
          <span><b>${st.tDone}/${st.tasks.length}</b>Aufgaben</span>
          <span><b>${st.pDone}/${st.plan.length}</b>Lerneinheiten</span>
          <span><b>${esc(fmtMin(st.minutes))}</b>gelernt</span>
          <span><b>${st.next ? esc(countdown(st.next.date)) : "–"}</b>nächste Prüfung</span>
        </span>
        <span class="ss-fach-pl"><span>Fortschritt</span><b>${st.total ? st.progress + " %" : "–"}</b></span>
        <span class="ss-fach-bar"><i style="width:${st.progress}%"></i></span>
      </span>
      <button type="button" class="ss-fach-emo" data-semoji aria-label="Symbol ändern">${esc(subjectEmoji(S.data, s))}<small>ändern</small></button>
    </section>
    <div class="ss-grid">
      <section class="card ss-card">${head("Aufgaben", openT.length, "task")}
        ${openT.length || doneT.length ? `<ul class="ss-list">${[...openT, ...doneT].map((t) => taskRowHTML(S, t)).join("")}</ul>` : `<p class="note">Keine Aufgaben in ${esc(s)}.</p>`}
      </section>
      <section class="ss-col">
        ${st.exams.length ? st.exams.map((e) => examCardHTML(S, e)).join("") : `<section class="card ss-card">${head("Prüfungen", null, "exam")}<p class="note">Keine Prüfung geplant.</p></section>`}
        ${st.exams.length ? `<button type="button" class="btn ghost sm" data-sd="exam">+ Prüfung in ${esc(s)}</button>` : ""}
        ${pastExams.length ? `<details class="ss-past"><summary>Vergangene Prüfungen (${pastExams.length})</summary><ul class="ss-mini">${pastExams.map((e) => `<li><button type="button" data-eedit="${esc(e.id)}"><b>${esc(e.kind || "Prüfung")}</b><span>${esc(fmtDate(e.date))}</span></button></li>`).join("")}</ul></details>` : ""}
      </section>
      <section class="card ss-card">${head("Noten", grades.length, "grade")}
        ${grades.length ? `<ul class="ss-grades">${grades.map((g) => `<li><button type="button" data-gedit="${esc(g.id)}" style="--g:${GRADE_COLORS[g.grade] || "#64748b"}"><b>${esc(g.grade)}</b><span>${esc(g.kind || "")}</span><small>${esc(fmtDay(g.date))}</small></button></li>`).join("")}</ul>` : `<p class="note">Noch keine Noten.</p>`}
      </section>
      <section class="card ss-card"><div class="ss-h-row"><h3 class="ss-h">Lernplan <span class="ss-count">${planNext.length}</span></h3><button type="button" class="linkbtn" data-go="planer">Planer</button></div>
        ${planNext.length ? `<ul class="ss-list">${planNext.map((p) => planRowHTML(S, p)).join("")}</ul>` : `<p class="note">${st.plan.length ? "Alle Lerneinheiten erledigt. 🎉" : "Noch keine Lerneinheiten – im Planer „✨ Mit KI planen“ tippen."}</p>`}
      </section>
      <section class="card ss-card">${head("Stundenplan", lessons.length, "lesson")}
        ${lessons.length ? `<ul class="ss-lessons">${lessons.map((l) => lessonLine(S, l).replace('<span class="ss-lesson-time">', `<span class="ss-lesson-wd">${esc(WD_LONG[Number(l.weekday)] || "").slice(0, 2)}</span><span class="ss-lesson-time">`)).join("")}</ul>` : `<p class="note">${esc(s)} steht noch nicht im Stundenplan.</p>`}
      </section>
      <section class="card ss-card"><div class="ss-h-row"><h3 class="ss-h">Lernzeit</h3><button type="button" class="linkbtn" data-go="lernen">Timer</button></div>
        <div class="ss-pomo-stats"><span><b>${esc(fmtMin(weekMin))}</b> letzte 7 Tage</span><span><b>${esc(fmtMin(st.minutes))}</b> gesamt</span><span><b>${st.sessions.length}</b> 🍅</span></div>
        ${recent.length ? `<ul class="ss-mini">${recent.map((x) => `<li><button type="button" data-go="lernen"><b>${esc(fmtDay(x.date))}</b><span>${esc(fmtMin(Number(x.minutes) || 0))}</span></button></li>`).join("")}</ul>` : ""}
      </section>
      <section class="card ss-card"><div class="ss-h-row"><h3 class="ss-h">Dokumente <span class="ss-count">${docs.length}</span></h3><button type="button" class="linkbtn" data-go="dokumente">Alle</button></div>
        ${docs.length ? `<ul class="ss-docs ss-docs-1">${docs.map((d) => `<li><button type="button" class="ss-doc" data-sdoc="${esc(d.id)}" style="--c:${esc(c)}"><span class="ss-doc-ic">${d.thumb ? `<img src="${esc(d.thumb)}" alt="">` : `<span aria-hidden="true">${kindIcon(d)}</span>`}</span><span class="ss-doc-t"><b>${esc(d.title || "Dokument")}</b><span class="ss-meta"><span>${esc(fmtDate(d.date))}</span></span></span></button></li>`).join("")}</ul>` : `<p class="note">Keine Dokumente zu ${esc(s)}.</p>`}
      </section>
    </div>`;

  body.querySelector("[data-sback]").addEventListener("click", () => { S.view.subject = null; S.rerender(); });
  body.querySelector("[data-semoji]").addEventListener("click", () => openEmojiPicker(S, s));
  const acts = {
    task: () => openTaskForm(S, null, { subject: s }),
    exam: () => openExamForm(S, null, { subject: s }),
    grade: () => openGradeForm(S, null, { subject: s }),
    lesson: () => openLessonForm(S, null, { subject: s, color: lessons[0] && lessons[0].color || "" }),
  };
  body.querySelectorAll("[data-sd]").forEach((b) => b.addEventListener("click", () => acts[b.dataset.sd]()));
  body.querySelectorAll("[data-gedit]").forEach((b) => b.addEventListener("click", () => openGradeForm(S, col("grades").get(b.dataset.gedit))));
  body.querySelectorAll("[data-sdoc]").forEach((b) => b.addEventListener("click", () => openDoc(S, col("docs").get(b.dataset.sdoc))));
  wireTasks(body, S);
  wireExams(body, S);
  wirePlan(body, S);
}

/* ---------- Übersicht ---------- */

export function renderSubjects(body, S) {
  const list = subjects(S.data);
  const sel = S.view.subject && list.find((x) => sameSubj(x, S.view.subject));
  if (sel) { renderDetail(body, S, sel); return; }
  S.view.subject = null;
  if (!list.length) {
    body.innerHTML = emptyHTML("📚", "Noch keine Fächer", "Fächer entstehen aus deinem Stundenplan, deinen Aufgaben, Prüfungen und Noten. Trag am besten zuerst den Stundenplan ein.", "Stundenplan anlegen", "add-lesson");
    body.querySelectorAll("[data-act=add-lesson]").forEach((b) => b.addEventListener("click", () => openLessonForm(S)));
    return;
  }
  const all = list.map((s) => subjectStats(S.data, s));
  body.innerHTML = `${overallHTML(S, all)}<div class="ss-grid ss-faecher">${all.map((st) => cardHTML(S, st)).join("")}</div>
    <p class="note ss-foot">Tippe auf ein Fach für Aufgaben, Prüfungen, Noten und Lernzeit.</p>`;
  body.querySelectorAll("[data-sopen]").forEach((b) => b.addEventListener("click", () => {
    S.view.subject = b.dataset.sopen; S.rerender();
    try { window.scrollTo(0, Math.max(0, body.getBoundingClientRect().top + window.scrollY - 120)); } catch { /* egal */ }
  }));
}
