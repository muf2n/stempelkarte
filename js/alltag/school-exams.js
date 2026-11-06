// Schule & Lernen – Prüfungen/Schularbeiten (school_exams), Lernplan-Erzeugung (school_plan), Noten (school_grades).
import {
  col, safeWrite, esc, dot, todayKey, addDays, diffDays, dateOf, fmtDay, fmtDayY, countdown, RE_DATE,
  subjectColor, subjectInputHTML, wireSubjectChips, emptyHTML, armDelete,
  GRADE_NAMES, GRADE_COLORS, gradeColor, fmtAvg,
} from "./school-core.js";

export const EXAM_KINDS = ["Schularbeit", "Test", "Prüfung", "Mündlich", "Referat", "Lehrabschlussprüfung"];
export const GRADE_KINDS = [["Schularbeit", 2], ["Test", 1], ["Mitarbeit", 1], ["Mündlich", 1], ["Referat", 1], ["Hausübung", 0.5], ["Zeugnis", 1]];

export const topicsOf = (e) => String(e.topics || "").split("\n").map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
export const examTitle = (e) => `${e.kind || "Prüfung"}${e.subject ? " " + e.subject : ""}`;
export function upcomingExams(data, today = todayKey()) {
  return (data.exams || []).filter((e) => RE_DATE.test(e.date || "") && e.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
}
export function planOf(data, examId) {
  return (data.plan || []).filter((p) => p.examId === examId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.order || 0) - (b.order || 0)));
}
/** Fortschritt einer Prüfung: Lernplan-Anteil (wenn vorhanden), sonst manueller Wert. */
export function examProgress(data, e) {
  const pl = planOf(data, e.id);
  if (pl.length) return Math.round((pl.filter((p) => p.done).length / pl.length) * 100);
  return Math.max(0, Math.min(100, Number(e.progress) || 0));
}

/* ---------- Lernplan ---------- */

/**
 * Verteilt Lerneinheiten auf die Tage vor der Prüfung.
 * → [{date, title, minutes, order}] ; letzter Tag vor der Prüfung = Gesamtwiederholung (wenn ≥ 2 Tage).
 */
export function distributePlan({ topics, start, examDate, skipWeekend = false, minutes = 30, subject = "" }) {
  const days = [];
  for (let k = start; k < examDate && days.length < 400; k = addDays(k, 1)) {
    const wd = dateOf(k).getDay();
    if (skipWeekend && (wd === 0 || wd === 6)) continue;
    days.push(k);
  }
  if (!days.length) return [];
  const out = [];
  const learn = days.length >= 2 ? days.slice(0, -1) : days;
  const list = topics.length ? topics : learn.slice(-5).map(() => `Lernen${subject ? ": " + subject : ""}`);
  const L = learn.length, N = list.length;
  list.forEach((t, i) => {
    const di = N <= L
      ? (N === 1 ? 0 : Math.round((i * (L - 1)) / (N - 1)))
      : Math.floor((i * L) / N);
    const idx = topics.length ? di : L - N + i; // ohne Stoff: die letzten Tage
    out.push({ date: learn[idx], title: t, minutes, order: i });
  });
  if (days.length >= 2) out.push({ date: days[days.length - 1], title: "Wiederholung: alles nochmal durchgehen", minutes, order: N, review: true });
  return out;
}

export function openPlanForm(S, exam) {
  const today = todayKey();
  const existing = planOf(S.data, exam.id);
  S.ctx.ui.openSheet({
    title: "Lernplan erstellen",
    bodyHTML: `<div class="fields ss-form">
      <div class="hint"><b>${esc(examTitle(exam))}</b> · ${esc(fmtDayY(exam.date))} · ${esc(countdown(exam.date))}</div>
      <label>Stoff / Themen (eins pro Zeile)<textarea id="lp-topics" rows="6" placeholder="Ohmsches Gesetz&#10;Reihen- und Parallelschaltung&#10;Leistung und Arbeit">${esc(topicsOf(exam).join("\n"))}</textarea></label>
      <div class="row">
        <label>Beginnen am<input type="date" id="lp-start" value="${esc(today < exam.date ? today : exam.date)}" max="${esc(addDays(exam.date, -1))}"></label>
        <label>Minuten pro Einheit<select id="lp-min">${[15, 25, 30, 45, 60].map((m) => `<option value="${m}"${m === 30 ? " selected" : ""}>${m} min</option>`).join("")}</select></label>
      </div>
      <label class="switch">Wochenenden auslassen<input type="checkbox" id="lp-we"></label>
      <div class="lbl">Vorschau</div>
      <ol class="ss-preview" id="lp-prev"></ol>
      ${existing.length ? `<p class="note">Der bisherige Plan (${existing.length} Einheiten) wird ersetzt – bereits abgehakte Einheiten bleiben erhalten.</p>` : ""}
      <div class="row"><button type="button" class="btn primary" id="lp-go">Plan erstellen</button></div>
      ${existing.length ? `<button type="button" class="btn danger sm" id="lp-del">Lernplan löschen</button>` : ""}
    </div>`,
    onMount(el, close) {
      const read = () => ({
        topics: el.querySelector("#lp-topics").value.split("\n").map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean),
        start: el.querySelector("#lp-start").value || today,
        examDate: exam.date,
        skipWeekend: el.querySelector("#lp-we").checked,
        minutes: Number(el.querySelector("#lp-min").value) || 30,
        subject: exam.subject || "",
      });
      const prev = () => {
        const units = distributePlan(read());
        el.querySelector("#lp-prev").innerHTML = units.length
          ? units.map((u) => `<li><span>${esc(fmtDay(u.date))}</span><b>${esc(u.title)}</b></li>`).join("")
          : `<li class="note">Keine Tage mehr vor der Prüfung – Beginn-Datum früher wählen.</li>`;
      };
      el.querySelectorAll("input,textarea,select").forEach((x) => x.addEventListener("input", prev));
      el.querySelector("#lp-we").addEventListener("change", prev);
      prev();
      el.querySelector("#lp-go").addEventListener("click", () => {
        const r = read();
        const units = distributePlan(r);
        if (!units.length) { S.ctx.ui.toast("Kein Lerntag vor der Prüfung übrig."); return; }
        const doneTitles = new Set();
        for (const p of planOf(S.data, exam.id)) {
          if (p.done) doneTitles.add(p.title); else safeWrite(col("plan").remove(p.id));
        }
        let n = 0;
        for (const u of units) {
          if (doneTitles.has(u.title)) continue;
          n++;
          safeWrite(col("plan").put({ ...u, examId: exam.id, subject: exam.subject || "", done: false }));
        }
        if (r.topics.join("\n") !== topicsOf(exam).join("\n")) safeWrite(col("exams").patch(exam.id, { topics: r.topics.join("\n") }));
        S.ctx.ui.toast(`Lernplan: ${n} Einheiten bis ${fmtDay(exam.date)}`);
        close();
      });
      armDelete(el.querySelector("#lp-del"), () => {
        for (const p of planOf(S.data, exam.id)) safeWrite(col("plan").remove(p.id));
        S.ctx.ui.toast("Lernplan gelöscht"); close();
      });
    },
  });
}

/* ---------- Prüfungen ---------- */

export function examCardHTML(S, e, { compact = false } = {}) {
  const c = subjectColor(S.data, e.subject);
  const n = diffDays(todayKey(), e.date);
  const pr = examProgress(S.data, e);
  const pl = planOf(S.data, e.id);
  const topics = topicsOf(e);
  const big = n <= 0 ? (n === 0 ? "Heute" : "✓") : String(n);
  const urgent = n >= 0 && n <= 3;
  return `<section class="card ss-card ss-exam${urgent ? " urgent" : ""}${n < 0 ? " past" : ""}" style="--c:${esc(c)}">
    <div class="ss-exam-top">
      <div class="ss-cd" aria-label="${esc(countdown(e.date))}"><b>${esc(big)}</b>${n > 0 ? `<span>${n === 1 ? "Tag" : "Tage"}</span>` : ""}</div>
      <div class="ss-exam-t">
        <span class="ss-kind">${esc(e.kind || "Prüfung")}</span>
        <b>${dot(c)}${esc(e.subject || "Ohne Fach")}</b>
        <span class="ss-meta">${esc(fmtDayY(e.date))}${e.time ? " · " + esc(e.time) : ""} · <strong>${esc(countdown(e.date))}</strong></span>
      </div>
      ${compact ? "" : `<button type="button" class="ss-icon-btn" data-eedit="${esc(e.id)}" aria-label="Prüfung bearbeiten">✎</button>`}
    </div>
    ${topics.length && !compact ? `<ul class="ss-topics">${topics.slice(0, 6).map((t) => `<li>${esc(t)}</li>`).join("")}${topics.length > 6 ? `<li class="note">+ ${topics.length - 6} weitere</li>` : ""}</ul>` : ""}
    <div class="ss-proj-pr"><span>Lernfortschritt${pl.length ? ` · Plan ${pl.filter((p) => p.done).length}/${pl.length}` : ""}</span><b>${pr} %</b></div>
    <div class="ss-progress" role="progressbar" aria-valuenow="${pr}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pr}%"></div></div>
    ${compact ? "" : `<div class="ss-actions">
      ${n > 0 ? `<button type="button" class="btn ghost sm" data-eplan="${esc(e.id)}">${pl.length ? "Lernplan ändern" : "Lernplan erstellen"}</button>` : ""}
      ${!pl.length && n >= 0 ? `<label class="ss-range"><span class="sr">Fortschritt</span><input type="range" min="0" max="100" step="10" value="${pr}" data-eprog="${esc(e.id)}" aria-label="Lernfortschritt"></label>` : ""}
      ${n <= 0 && !(S.data.grades || []).some((g) => g.examId === e.id) ? `<button type="button" class="btn primary sm" data-egrade="${esc(e.id)}">Note eintragen</button>` : ""}
    </div>`}
  </section>`;
}

export function openExamForm(S, exam = null, preset = {}) {
  const e = exam || { subject: "", kind: "Schularbeit", date: addDays(todayKey(), 7), time: "", topics: "", progress: 0, ...preset };
  S.ctx.ui.openSheet({
    title: exam ? "Prüfung bearbeiten" : "Neue Prüfung",
    bodyHTML: `<form class="fields ss-form" novalidate>
      ${subjectInputHTML(S.data, "ex-subj", e.subject)}
      <div><div class="lbl">Art</div><div class="chips ss-kinds">${EXAM_KINDS.map((k) => `<button type="button" class="chip" data-k="${esc(k)}" aria-pressed="${e.kind === k}">${esc(k === "Lehrabschlussprüfung" ? "LAP" : k)}</button>`).join("")}</div></div>
      <div class="row"><label>Datum<input type="date" id="ex-date" value="${esc(e.date || "")}"></label><label>Uhrzeit (optional)<input type="time" id="ex-time" value="${esc(e.time || "")}"></label></div>
      <label>Stoff (ein Thema pro Zeile)<textarea id="ex-topics" rows="5" placeholder="Ohmsches Gesetz&#10;Kirchhoffsche Regeln">${esc(e.topics || "")}</textarea></label>
      <div class="row"><button type="submit" class="btn primary">Speichern</button></div>
      ${exam ? `<button type="button" class="btn danger sm" id="ex-del">Prüfung löschen</button>` : ""}
    </form>`,
    onMount(el, close) {
      wireSubjectChips(el);
      let kind = e.kind || "Schularbeit";
      el.querySelector(".ss-kinds").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-k]"); if (!b) return;
        kind = b.dataset.k;
        el.querySelectorAll(".ss-kinds [data-k]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      el.querySelector("form").addEventListener("submit", (ev) => {
        ev.preventDefault();
        const date = el.querySelector("#ex-date").value;
        if (!RE_DATE.test(date)) { S.ctx.ui.toast("Bitte ein Datum wählen."); return; }
        const subject = el.querySelector("#ex-subj").value.trim();
        const isNew = !exam;
        const data = { ...(exam || { progress: 0 }), subject, kind, date, time: el.querySelector("#ex-time").value || "", topics: el.querySelector("#ex-topics").value.trim() };
        const p = col("exams").put(data);
        safeWrite(p);
        // Termin verschoben → offene Plan-Einheiten nach der Prüfung passen nicht mehr
        if (exam && exam.date !== date) S.ctx.ui.toast("Datum geändert – Lernplan ggf. neu erstellen.");
        else S.ctx.ui.toast(isNew ? `${kind} eingetragen` : "Gespeichert");
        close();
        if (isNew && date > todayKey()) {
          Promise.resolve(p).then((id) => { const ex = col("exams").get(id); if (ex && topicsOf(ex).length) openPlanForm(S, ex); }).catch(() => {});
        }
      });
      armDelete(el.querySelector("#ex-del"), () => {
        for (const p of planOf(S.data, exam.id)) safeWrite(col("plan").remove(p.id));
        safeWrite(col("exams").remove(exam.id)); S.ctx.ui.toast("Prüfung gelöscht"); close();
      });
    },
  });
}

export function wireExams(root, S) {
  root.querySelectorAll("[data-eedit]").forEach((b) => b.addEventListener("click", () => openExamForm(S, col("exams").get(b.dataset.eedit))));
  root.querySelectorAll("[data-eplan]").forEach((b) => b.addEventListener("click", () => openPlanForm(S, col("exams").get(b.dataset.eplan))));
  root.querySelectorAll("[data-egrade]").forEach((b) => b.addEventListener("click", () => {
    const e = col("exams").get(b.dataset.egrade);
    openGradeForm(S, null, { subject: e.subject, kind: GRADE_KINDS.some(([k]) => k === e.kind) ? e.kind : "Test", date: e.date, examId: e.id });
  }));
  root.querySelectorAll("[data-eprog]").forEach((r) => r.addEventListener("change", () => safeWrite(col("exams").patch(r.dataset.eprog, { progress: Number(r.value) }))));
}

export function renderExams(body, S) {
  const today = todayKey();
  const up = upcomingExams(S.data, today);
  const past = (S.data.exams || []).filter((e) => !(RE_DATE.test(e.date || "") && e.date >= today)).sort((a, b) => (a.date < b.date ? 1 : -1));
  body.innerHTML = `<div class="ss-toolbar"><p class="note">${up.length ? `${up.length} ${up.length === 1 ? "Prüfung" : "Prüfungen"} vor dir` : "Schularbeiten, Tests und die LAP im Blick."}</p>
      <button type="button" class="btn primary sm" data-act="add-exam">+ Prüfung</button></div>
    ${up.length ? `<div class="ss-grid">${up.map((e) => examCardHTML(S, e)).join("")}</div>`
      : emptyHTML("🎯", "🎉 Keine Prüfungen geplant", "Trag Schularbeiten und Tests mit Stoff ein – du bekommst einen Countdown und einen Lernplan.", "Hinzufügen", "add-exam")}
    ${past.length ? `<details class="ss-past"><summary>Vergangene Prüfungen (${past.length})</summary><div class="ss-grid">${past.map((e) => examCardHTML(S, e)).join("")}</div></details>` : ""}`;
  body.querySelectorAll("[data-act=add-exam]").forEach((b) => b.addEventListener("click", () => openExamForm(S)));
  wireExams(body, S);
}

/* ---------- Noten ---------- */

/** Gewichteter Schnitt einer Notenliste (null, wenn leer). */
export function avgOf(list) {
  let s = 0, w = 0;
  for (const g of list) {
    const n = Number(g.grade), gw = Number(g.weight) > 0 ? Number(g.weight) : 1;
    if (n >= 1 && n <= 5) { s += n * gw; w += gw; }
  }
  return w ? s / w : null;
}
export function gradeStats(data) {
  const by = new Map();
  for (const g of data.grades || []) {
    const s = String(g.subject || "").trim() || "Ohne Fach";
    if (!by.has(s)) by.set(s, []);
    by.get(s).push(g);
  }
  const subjects = [...by.entries()].map(([subject, list]) => ({ subject, list: list.sort((a, b) => (a.date < b.date ? 1 : -1)), avg: avgOf(list) }))
    .sort((a, b) => a.subject.localeCompare(b.subject, "de"));
  const avgs = subjects.map((x) => x.avg).filter((x) => x != null);
  return { subjects, overall: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null, count: (data.grades || []).length };
}

export function openGradeForm(S, grade = null, preset = {}) {
  const g = grade || { subject: preset.subject || "", grade: 0, kind: preset.kind || "Test", weight: null, date: preset.date || todayKey(), note: "", examId: preset.examId || null };
  const defW = (k) => (GRADE_KINDS.find(([x]) => x === k) || [0, 1])[1];
  S.ctx.ui.openSheet({
    title: grade ? "Note bearbeiten" : "Neue Note",
    bodyHTML: `<form class="fields ss-form" novalidate>
      ${subjectInputHTML(S.data, "gr-subj", g.subject)}
      <div><div class="lbl">Note</div><div class="ss-gradepick" role="radiogroup">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-g="${n}" aria-pressed="${Number(g.grade) === n}" style="--c:${GRADE_COLORS[n]}"><b>${n}</b><span>${GRADE_NAMES[n]}</span></button>`).join("")}
      </div></div>
      <div><div class="lbl">Art</div><div class="chips ss-kinds">${GRADE_KINDS.map(([k]) => `<button type="button" class="chip" data-k="${esc(k)}" aria-pressed="${g.kind === k}">${esc(k)}</button>`).join("")}</div></div>
      <div class="row">
        <label>Gewichtung<select id="gr-w">${[0.5, 1, 1.5, 2, 3].map((w) => `<option value="${w}">${String(w).replace(".", ",")}×</option>`).join("")}</select></label>
        <label>Datum<input type="date" id="gr-date" value="${esc(g.date || "")}"></label>
      </div>
      <label>Notiz<input type="text" id="gr-note" maxlength="120" value="${esc(g.note || "")}" placeholder="z. B. 38 von 45 Punkten"></label>
      <div class="row"><button type="submit" class="btn primary">Speichern</button></div>
      ${grade ? `<button type="button" class="btn danger sm" id="gr-del">Note löschen</button>` : ""}
    </form>`,
    onMount(el, close) {
      wireSubjectChips(el);
      let n = Number(g.grade) || 0, kind = g.kind || "Test";
      const wSel = el.querySelector("#gr-w");
      wSel.value = String(g.weight ?? defW(kind));
      el.querySelector(".ss-gradepick").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-g]"); if (!b) return;
        n = Number(b.dataset.g);
        el.querySelectorAll(".ss-gradepick [data-g]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      el.querySelector(".ss-kinds").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-k]"); if (!b) return;
        kind = b.dataset.k; wSel.value = String(defW(kind));
        el.querySelectorAll(".ss-kinds [data-k]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      el.querySelector("form").addEventListener("submit", (ev) => {
        ev.preventDefault();
        if (!(n >= 1 && n <= 5)) { S.ctx.ui.toast("Bitte eine Note (1–5) wählen."); return; }
        const subject = el.querySelector("#gr-subj").value.trim();
        if (!subject) { S.ctx.ui.toast("Bitte ein Fach eingeben."); return; }
        const date = el.querySelector("#gr-date").value;
        safeWrite(col("grades").put({ ...(grade || {}), subject, grade: n, kind, weight: Number(wSel.value) || 1, date: RE_DATE.test(date) ? date : todayKey(), note: el.querySelector("#gr-note").value.trim(), examId: g.examId || null }));
        S.ctx.ui.toast(`${GRADE_NAMES[n]} in ${subject} eingetragen`);
        close();
      });
      armDelete(el.querySelector("#gr-del"), () => { safeWrite(col("grades").remove(grade.id)); S.ctx.ui.toast("Note gelöscht"); close(); });
    },
  });
}

export function renderGrades(body, S) {
  const st = gradeStats(S.data);
  const dist = [1, 2, 3, 4, 5].map((n) => (S.data.grades || []).filter((g) => Number(g.grade) === n).length);
  const maxD = Math.max(1, ...dist);
  body.innerHTML = `<div class="ss-toolbar"><p class="note">Österreichische Noten: 1 = Sehr gut … 5 = Nicht genügend.</p>
      <button type="button" class="btn primary sm" data-act="add-grade">+ Note</button></div>
    ${st.count ? `<div class="ss-grid">
      <section class="card ss-card ss-avg-hero" style="--c:${gradeColor(st.overall)}">
        <div class="ss-avg-big"><b>${fmtAvg(st.overall)}</b><span>${esc(GRADE_NAMES[Math.round(st.overall)] || "")}</span></div>
        <div class="ss-avg-txt"><div class="lbl">Schnitt gesamt</div><p class="note">Ø aller ${st.subjects.length} ${st.subjects.length === 1 ? "Fach" : "Fächer"} · ${st.count} ${st.count === 1 ? "Note" : "Noten"}</p>
          <div class="ss-dist" aria-label="Notenverteilung">${dist.map((c, i) => `<div><i style="height:${Math.round((c / maxD) * 100)}%;--c:${GRADE_COLORS[i + 1]}"></i><span>${i + 1}</span></div>`).join("")}</div>
        </div>
      </section>
      ${st.subjects.map((x) => `<section class="card ss-card ss-subj" style="--c:${esc(subjectColor(S.data, x.subject))}">
        <div class="ss-subj-h"><b>${dot(subjectColor(S.data, x.subject))}${esc(x.subject)}</b>
          <span class="ss-avg-pill" style="--g:${gradeColor(x.avg)}">Ø ${fmtAvg(x.avg)}</span></div>
        <ul class="ss-grades">${x.list.map((g) => `<li><button type="button" data-gedit="${esc(g.id)}" style="--g:${GRADE_COLORS[g.grade] || "#64748b"}">
          <b>${esc(g.grade)}</b><span>${esc(g.kind || "")}${Number(g.weight) !== 1 ? ` · ${String(g.weight).replace(".", ",")}×` : ""}</span><small>${esc(fmtDay(g.date))}</small></button></li>`).join("")}</ul>
      </section>`).join("")}
    </div><p class="note ss-foot">Der Schnitt ist gewichtet und nur eine Orientierung – die Zeugnisnote legt die Lehrkraft fest.</p>`
      : emptyHTML("⭐", "📒 Noch keine Noten", "Trag Schularbeiten, Tests und Mitarbeit ein – du siehst den Schnitt pro Fach und gesamt.", "Hinzufügen", "add-grade")}`;
  body.querySelectorAll("[data-act=add-grade]").forEach((b) => b.addEventListener("click", () => openGradeForm(S)));
  body.querySelectorAll("[data-gedit]").forEach((b) => b.addEventListener("click", () => openGradeForm(S, col("grades").get(b.dataset.gedit))));
}
