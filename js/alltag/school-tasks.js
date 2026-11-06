// Schule & Lernen – Hausaufgaben/Abgabefristen (school_tasks) und Projekte (school_projects).
import {
  col, safeWrite, esc, dot, todayKey, addDays, diffDays, mondayOf, fmtDay, fmtDayY, countdown, RE_DATE,
  subjectColor, subjectInputHTML, wireSubjectChips, emptyHTML, armDelete, prioLabel,
} from "./school-core.js";
import { newId } from "./db.js";

const PRIO_ORDER = { high: 0, normal: 1, low: 2 };

/* ---------- Aufgaben ---------- */

export function taskBucket(t, today = todayKey()) {
  if (t.done) return "done";
  if (!RE_DATE.test(t.due || "")) return "none";
  const n = diffDays(today, t.due);
  if (n < 0) return "overdue";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (t.due <= addDays(mondayOf(today), 6)) return "week";
  return "later";
}
const BUCKETS = [
  ["overdue", "Überfällig"], ["today", "Heute"], ["tomorrow", "Morgen"], ["week", "Diese Woche"],
  ["later", "Später"], ["none", "Ohne Datum"],
];
export function sortTasks(a, b) {
  const da = a.due || "9999", db = b.due || "9999";
  if (da !== db) return da < db ? -1 : 1;
  return (PRIO_ORDER[a.prio] ?? 1) - (PRIO_ORDER[b.prio] ?? 1);
}

export function taskRowHTML(S, t) {
  const b = taskBucket(t);
  const due = RE_DATE.test(t.due || "")
    ? `<span class="ss-due ss-due-${b}">${esc(t.done ? fmtDay(t.due) : b === "overdue" ? "überfällig · " + fmtDay(t.due) : countdown(t.due) + " · " + fmtDay(t.due))}</span>` : "";
  return `<li class="ss-task${t.done ? " done" : ""}${t.prio === "high" ? " hi" : ""}" style="--c:${esc(subjectColor(S.data, t.subject))}">
    <button type="button" class="ss-check" data-tdone="${esc(t.id)}" role="checkbox" aria-checked="${t.done ? "true" : "false"}" aria-label="${esc(t.title)} erledigt"></button>
    <button type="button" class="ss-task-main" data-tedit="${esc(t.id)}">
      <b>${t.prio === "high" ? `<span class="ss-flag" title="Wichtig">!</span>` : ""}${esc(t.title || "Aufgabe")}</b>
      <span class="ss-meta">${t.subject ? `${dot(subjectColor(S.data, t.subject))}${esc(t.subject)}` : ""}${due}</span>
    </button></li>`;
}

/** Klicks auf Aufgaben-Zeilen (Abhaken/Bearbeiten) in einem Container verdrahten. */
export function wireTasks(root, S) {
  root.querySelectorAll("[data-tdone]").forEach((b) => b.addEventListener("click", () => {
    const t = col("tasks").get(b.dataset.tdone);
    if (!t) return;
    const done = !t.done;
    safeWrite(col("tasks").patch(t.id, { done, doneAt: done ? Date.now() : null }));
    if (done) S.ctx.ui.toast(`„${t.title}“ erledigt ✓`);
  }));
  root.querySelectorAll("[data-tedit]").forEach((b) => b.addEventListener("click", () => openTaskForm(S, col("tasks").get(b.dataset.tedit))));
}

export function openTaskForm(S, task = null, preset = {}) {
  const t = task || { subject: preset.subject || "", title: "", due: preset.due || addDays(todayKey(), 1), prio: "normal", note: "" };
  S.ctx.ui.openSheet({
    title: task ? "Aufgabe bearbeiten" : "Neue Aufgabe",
    bodyHTML: `<form class="fields ss-form" novalidate>
      <label>Was ist zu tun?<input type="text" id="tk-title" maxlength="120" required value="${esc(t.title)}" placeholder="z. B. Übungsblatt Ohmsches Gesetz"></label>
      ${subjectInputHTML(S.data, "tk-subj", t.subject)}
      <label>Fällig am<input type="date" id="tk-due" value="${esc(t.due || "")}"></label>
      <div class="chips ss-quick-due" aria-label="Schnellauswahl Datum">
        <button type="button" class="chip" data-d="0">Heute</button><button type="button" class="chip" data-d="1">Morgen</button>
        <button type="button" class="chip" data-d="7">In 1 Woche</button><button type="button" class="chip" data-d="x">Ohne Datum</button>
      </div>
      <div><div class="lbl">Priorität</div><div class="chips ss-prio" role="radiogroup">
        ${["low", "normal", "high"].map((p) => `<button type="button" class="chip" data-p="${p}" aria-pressed="${t.prio === p}">${prioLabel(p)}</button>`).join("")}
      </div></div>
      <label>Notiz<textarea id="tk-note" maxlength="1000" placeholder="Seiten, Hinweise …">${esc(t.note || "")}</textarea></label>
      <div class="row"><button type="submit" class="btn primary">Speichern</button></div>
      ${task ? `<button type="button" class="btn danger sm" id="tk-del">Löschen</button>` : ""}
    </form>`,
    onMount(el, close) {
      wireSubjectChips(el);
      let prio = t.prio || "normal";
      el.querySelector(".ss-prio").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-p]"); if (!b) return;
        prio = b.dataset.p;
        el.querySelectorAll(".ss-prio [data-p]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      el.querySelector(".ss-quick-due").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-d]"); if (!b) return;
        el.querySelector("#tk-due").value = b.dataset.d === "x" ? "" : addDays(todayKey(), Number(b.dataset.d));
      });
      el.querySelector("form").addEventListener("submit", (ev) => {
        ev.preventDefault();
        const title = el.querySelector("#tk-title").value.trim();
        if (!title) { S.ctx.ui.toast("Bitte einen Titel eingeben."); el.querySelector("#tk-title").focus(); return; }
        const due = el.querySelector("#tk-due").value;
        safeWrite(col("tasks").put({
          ...(task || { done: false }), title, prio,
          subject: el.querySelector("#tk-subj").value.trim(),
          due: RE_DATE.test(due) ? due : null,
          note: el.querySelector("#tk-note").value.trim(),
        }));
        S.ctx.ui.toast(task ? "Aufgabe gespeichert" : "Aufgabe angelegt");
        close();
      });
      armDelete(el.querySelector("#tk-del"), () => { safeWrite(col("tasks").remove(task.id)); S.ctx.ui.toast("Aufgabe gelöscht"); close(); });
      if (!task) setTimeout(() => el.querySelector("#tk-title").focus(), 50);
    },
  });
}

export function renderTasks(body, S) {
  const tasks = S.data.tasks || [];
  const filter = S.view.taskFilter || "open";
  const open = tasks.filter((t) => !t.done).sort(sortTasks);
  const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const cnt = (k) => open.filter((t) => taskBucket(t) === k).length;
  let html = `<div class="ss-toolbar">
      <div class="ss-sumline">
        <span class="ss-badge red">${cnt("overdue")} überfällig</span><span class="ss-badge amber">${cnt("today")} heute</span>
        <span class="ss-badge blue">${cnt("tomorrow") + cnt("week")} diese Woche</span>
      </div>
      <button type="button" class="btn primary sm" data-act="add-task">+ Aufgabe</button>
    </div>
    <div class="chips ss-filter" role="tablist">
      ${[["open", `Offen (${open.length})`], ["done", `Erledigt (${done.length})`]].map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join("")}
    </div>`;
  if (!tasks.length) {
    html += emptyHTML("📝", "Keine Aufgaben", "Trag Hausübungen und Abgabefristen ein – dann siehst du immer, was überfällig, heute oder diese Woche dran ist.", "Hinzufügen", "add-task");
  } else if (filter === "open") {
    if (!open.length) html += `<div class="ss-empty small"><div class="ss-empty-e">🎉</div><h3>Alles erledigt!</h3><p class="note">Keine offenen Aufgaben.</p></div>`;
    html += `<div class="ss-grid">` + BUCKETS.map(([k, label]) => {
      const list = open.filter((t) => taskBucket(t) === k);
      if (!list.length) return "";
      return `<section class="card ss-card ss-b-${k}"><h3 class="ss-h">${esc(label)} <span class="ss-count">${list.length}</span></h3>
        <ul class="ss-list">${list.map((t) => taskRowHTML(S, t)).join("")}</ul></section>`;
    }).join("") + `</div>`;
  } else {
    html += done.length ? `<section class="card ss-card"><ul class="ss-list">${done.map((t) => taskRowHTML(S, t)).join("")}</ul></section>`
      : `<p class="note">✅ Noch nichts erledigt.</p>`;
  }
  body.innerHTML = html;
  body.querySelectorAll("[data-act=add-task]").forEach((b) => b.addEventListener("click", () => openTaskForm(S)));
  body.querySelector(".ss-filter").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-f]"); if (!b) return;
    S.view.taskFilter = b.dataset.f; S.rerender();
  });
  wireTasks(body, S);
}

/* ---------- Projekte ---------- */

export function projectProgress(p) {
  const steps = Array.isArray(p.steps) ? p.steps : [];
  if (!steps.length) return p.done ? 100 : 0;
  return Math.round((steps.filter((s) => s.done).length / steps.length) * 100);
}

function projectCardHTML(S, p) {
  const steps = Array.isArray(p.steps) ? p.steps : [];
  const pr = projectProgress(p);
  const c = subjectColor(S.data, p.subject);
  const dueTxt = RE_DATE.test(p.due || "") ? (pr === 100 ? fmtDayY(p.due) : `${countdown(p.due, { past: "overdue" })} · ${fmtDayY(p.due)}`) : "ohne Fälligkeit";
  const late = RE_DATE.test(p.due || "") && p.due < todayKey() && pr < 100;
  return `<section class="card ss-card ss-proj${pr === 100 ? " done" : ""}" style="--c:${esc(c)}">
    <div class="ss-proj-h">
      <div class="ss-proj-t"><b>${esc(p.title || "Projekt")}</b>
        <span class="ss-meta">${p.subject ? `${dot(c)}${esc(p.subject)} · ` : ""}<span class="${late ? "ss-late" : ""}">${esc(dueTxt)}</span></span></div>
      <button type="button" class="ss-icon-btn" data-pedit="${esc(p.id)}" aria-label="Projekt bearbeiten">✎</button>
    </div>
    <div class="ss-progress" role="progressbar" aria-valuenow="${pr}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pr}%"></div></div>
    <div class="ss-proj-pr"><span>${steps.filter((s) => s.done).length} von ${steps.length} Schritten</span><b>${pr} %</b></div>
    ${steps.length ? `<ul class="ss-steps">${steps.map((s) => `<li><button type="button" class="ss-step${s.done ? " done" : ""}" data-pstep="${esc(p.id)}" data-sid="${esc(s.id)}" role="checkbox" aria-checked="${!!s.done}"><i aria-hidden="true"></i><span>${esc(s.text)}</span></button></li>`).join("")}</ul>` : ""}
    <form class="ss-step-add" data-padd="${esc(p.id)}"><input type="text" maxlength="120" placeholder="Neuer Schritt …" aria-label="Neuer Schritt"><button type="submit" class="btn ghost sm" aria-label="Schritt hinzufügen">+</button></form>
  </section>`;
}

export function openProjectForm(S, proj = null) {
  const p = proj || { title: "", subject: "", due: "", note: "", steps: [] };
  S.ctx.ui.openSheet({
    title: proj ? "Projekt bearbeiten" : "Neues Projekt",
    bodyHTML: `<form class="fields ss-form" novalidate>
      <label>Titel<input type="text" id="pj-title" maxlength="100" value="${esc(p.title)}" placeholder="z. B. Projektarbeit Hausinstallation"></label>
      ${subjectInputHTML(S.data, "pj-subj", p.subject)}
      <label>Fällig am<input type="date" id="pj-due" value="${esc(p.due || "")}"></label>
      <label>Schritte (einer pro Zeile)<textarea id="pj-steps" rows="5" placeholder="Thema wählen&#10;Unterlagen sammeln&#10;Plan zeichnen&#10;Präsentation">${esc((p.steps || []).map((s) => s.text).join("\n"))}</textarea></label>
      <p class="note">Abgehakte Schritte bleiben abgehakt, solange der Text gleich bleibt.</p>
      <label>Notiz<textarea id="pj-note" maxlength="1000">${esc(p.note || "")}</textarea></label>
      <div class="row"><button type="submit" class="btn primary">Speichern</button></div>
      ${proj ? `<button type="button" class="btn danger sm" id="pj-del">Projekt löschen</button>` : ""}
    </form>`,
    onMount(el, close) {
      wireSubjectChips(el);
      el.querySelector("form").addEventListener("submit", (ev) => {
        ev.preventDefault();
        const title = el.querySelector("#pj-title").value.trim();
        if (!title) { S.ctx.ui.toast("Bitte einen Titel eingeben."); return; }
        const old = new Map((p.steps || []).map((s) => [s.text, s]));
        const steps = el.querySelector("#pj-steps").value.split("\n").map((x) => x.trim()).filter(Boolean)
          .map((text) => old.get(text) || { id: newId(), text, done: false });
        const due = el.querySelector("#pj-due").value;
        safeWrite(col("projects").put({ ...(proj || {}), title, steps, subject: el.querySelector("#pj-subj").value.trim(), due: RE_DATE.test(due) ? due : null, note: el.querySelector("#pj-note").value.trim() }));
        S.ctx.ui.toast("Projekt gespeichert");
        close();
      });
      armDelete(el.querySelector("#pj-del"), () => { safeWrite(col("projects").remove(proj.id)); S.ctx.ui.toast("Projekt gelöscht"); close(); });
    },
  });
}

export function renderProjects(body, S) {
  const list = [...(S.data.projects || [])].sort((a, b) => {
    const da = projectProgress(a) === 100 ? 1 : 0, db = projectProgress(b) === 100 ? 1 : 0;
    if (da !== db) return da - db;
    return (a.due || "9999") < (b.due || "9999") ? -1 : 1;
  });
  body.innerHTML = `<div class="ss-toolbar"><p class="note">Größere Arbeiten in Schritte aufteilen und abhaken.</p>
      <button type="button" class="btn primary sm" data-act="add-proj">+ Projekt</button></div>
    ${list.length ? `<div class="ss-grid">${list.map((p) => projectCardHTML(S, p)).join("")}</div>`
      : emptyHTML("🛠️", "🛠️ Noch keine Projekte", "Projektarbeiten, Referate oder die Vorbereitung auf die Lehrabschlussprüfung – mit Schritten und Fortschritt.", "Hinzufügen", "add-proj")}`;
  body.querySelectorAll("[data-act=add-proj]").forEach((b) => b.addEventListener("click", () => openProjectForm(S)));
  body.querySelectorAll("[data-pedit]").forEach((b) => b.addEventListener("click", () => openProjectForm(S, col("projects").get(b.dataset.pedit))));
  body.querySelectorAll("[data-pstep]").forEach((b) => b.addEventListener("click", () => {
    const p = col("projects").get(b.dataset.pstep); if (!p) return;
    const steps = (p.steps || []).map((s) => (s.id === b.dataset.sid ? { ...s, done: !s.done } : s));
    safeWrite(col("projects").patch(p.id, { steps }));
    if (steps.length && steps.every((s) => s.done)) S.ctx.ui.toast(`„${p.title}“ fertig! 🎉`);
  }));
  body.querySelectorAll("[data-padd]").forEach((f) => f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const inp = f.querySelector("input"); const text = inp.value.trim(); if (!text) return;
    const p = col("projects").get(f.dataset.padd); if (!p) return;
    S.keepFocus = `[data-padd="${f.dataset.padd}"] input`;
    safeWrite(col("projects").patch(p.id, { steps: [...(p.steps || []), { id: newId(), text, done: false }] }));
  }));
}
