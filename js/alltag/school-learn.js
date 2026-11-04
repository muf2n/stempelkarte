// Schule & Lernen – Lern-Timer (Pomodoro) mit Zähler pro Fach (school_sessions) + Lernplan-Ansicht (school_plan).
// Der Timer läuft über Zeitstempel (school_meta/"timer") – auch wenn der Bereich geschlossen ist oder die
// App neu geladen wird. Eine abgeschlossene Fokus-Einheit bekommt die ID "f<startedAt>" → nie doppelt gezählt.
import {
  col, safeWrite, esc, dot, todayKey, keyOf, addDays, mondayOf, fmtDay, countdown, prefs, savePrefs,
  subjects, subjectColor, emptyHTML, pad,
} from "./school-core.js";
import { examTitle } from "./school-exams.js";

/* ---------- Timer-Kern ---------- */

let engineCtx = null;
let engineTimer = null;
let audio = null;

const timerState = () => col("meta").get("timer") || { id: "timer", phase: "idle" };
const isRunning = (t) => t.phase !== "idle" && t.endAt && t.pausedLeft == null;
export function timeLeft(t = timerState()) {
  if (t.phase === "idle") return 0;
  if (t.pausedLeft != null) return Math.max(0, t.pausedLeft);
  return Math.max(0, (t.endAt || 0) - Date.now());
}

export function ensureEngine(ctx) {
  engineCtx = ctx;
  if (ensureEngine.started) return;
  ensureEngine.started = true;
  col("meta").watch(schedule);
}
function schedule() {
  clearTimeout(engineTimer);
  const t = timerState();
  if (!isRunning(t)) return;
  const ms = t.endAt - Date.now();
  if (ms <= 0) { complete(); return; }
  engineTimer = setTimeout(complete, Math.min(ms + 50, 2 ** 30));
}

function unlockAudio() {
  try {
    if (!audio) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = new AC(); }
    if (audio && audio.state === "suspended") audio.resume();
  } catch { audio = null; }
}
function beep() {
  try {
    unlockAudio();
    if (!audio) return;
    const t0 = audio.currentTime + 0.02;
    [0, 0.28, 0.56].forEach((d, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine"; o.frequency.value = i === 2 ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.24);
      o.connect(g).connect(audio.destination);
      o.start(t0 + d); o.stop(t0 + d + 0.26);
    });
  } catch { /* egal */ }
}
function notify(msg, fresh) {
  const data = { meta: col("meta").all() };
  const p = prefs(data);
  try { engineCtx && engineCtx.ui.toast(msg, 4000); } catch { /* egal */ }
  if (!fresh) return; // verspätet nachgeholt (App war zu) → kein Ton
  if (p.sound) beep();
  if (p.vibrate && navigator.vibrate) { try { navigator.vibrate([300, 120, 300, 120, 500]); } catch { /* egal */ } }
  try {
    if (document.hidden && "Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then((r) => r.showNotification("Lern-Timer", { body: msg, tag: "school-pomo", icon: "icons/icon-192.png" })).catch(() => {});
    }
  } catch { /* egal */ }
}

function complete() {
  const t = timerState();
  if (!isRunning(t) || Date.now() < t.endAt) { schedule(); return; }
  const fresh = Date.now() - t.endAt < 90000;
  const p = prefs({ meta: col("meta").all() });
  if (t.phase === "focus") {
    const minutes = Math.max(1, Math.round((t.endAt - t.startedAt - (t.pausedTotal || 0)) / 60000));
    safeWrite(col("sessions").put({ id: "f" + t.startedAt, subject: t.subject || "", start: t.startedAt, end: t.endAt, minutes, date: keyOf(new Date(t.startedAt)) }));
    const round = (t.round || 0) + 1;
    const long = p.longEvery > 0 && round % p.longEvery === 0;
    const bMin = long ? p.longBreakMin : p.breakMin;
    const bEnd = t.endAt + bMin * 60000;
    if (bMin > 0 && bEnd > Date.now()) {
      safeWrite(col("meta").put({ id: "timer", phase: "break", long, subject: t.subject, startedAt: t.endAt, endAt: bEnd, durMs: bMin * 60000, pausedLeft: null, round }));
      notify(`Fokus fertig – ${minutes} min ${t.subject ? t.subject + " " : ""}gezählt. ${bMin} min ${long ? "lange " : ""}Pause!`, fresh);
    } else {
      safeWrite(col("meta").put({ id: "timer", phase: "idle", subject: t.subject, round }));
      notify(`Fokus fertig – ${minutes} min gezählt.`, fresh);
    }
  } else {
    safeWrite(col("meta").put({ id: "timer", phase: "idle", subject: t.subject, round: t.round || 0 }));
    notify("Pause vorbei – weiter geht's! 💪", fresh);
  }
}

export function startFocus(data, subject) {
  unlockAudio();
  const p = prefs(data);
  const now = Date.now();
  const cur = timerState();
  const dur = Math.max(1, Number(p.focusMin) || 25) * 60000;
  safeWrite(col("meta").put({ id: "timer", phase: "focus", subject: subject || "", startedAt: now, endAt: now + dur, durMs: dur, pausedLeft: null, pausedTotal: 0, round: cur.round || 0 }));
}
function pauseTimer() {
  const t = timerState(); if (!isRunning(t)) return;
  safeWrite(col("meta").put({ ...t, pausedLeft: t.endAt - Date.now(), pausedAt: Date.now(), endAt: null }));
}
function resumeTimer() {
  unlockAudio();
  const t = timerState(); if (t.pausedLeft == null) return;
  safeWrite(col("meta").put({ ...t, endAt: Date.now() + t.pausedLeft, pausedLeft: null, pausedTotal: (t.pausedTotal || 0) + (Date.now() - (t.pausedAt || Date.now())) }));
}
function stopTimer(ctx) {
  const t = timerState();
  if (t.phase === "focus") {
    const done = (t.durMs || 0) - timeLeft(t);
    const min = Math.floor(done / 60000);
    if (min >= 5) {
      safeWrite(col("sessions").put({ id: "f" + t.startedAt, subject: t.subject || "", start: t.startedAt, end: Date.now(), minutes: min, date: keyOf(new Date(t.startedAt)), partial: true }));
      ctx.ui.toast(`Abgebrochen – ${min} min gezählt.`);
    } else ctx.ui.toast("Abgebrochen (unter 5 min wird nicht gezählt).");
  }
  safeWrite(col("meta").put({ id: "timer", phase: "idle", subject: t.subject || "", round: t.phase === "focus" ? t.round || 0 : t.round || 0 }));
}

/* ---------- Anzeige ---------- */

const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
const R = 88, CIRC = 2 * Math.PI * R;

/** Jede Sekunde aufgerufen: aktualisiert alle Timer-Anzeigen im Container. */
export function tick(root) {
  const t = timerState();
  const left = t.phase === "idle" ? null : timeLeft(t);
  root.querySelectorAll("[data-pomo-time]").forEach((el) => {
    const idleMs = Number(el.dataset.idle || 0);
    const txt = left == null ? mmss(idleMs) : mmss(left);
    if (el.textContent !== txt) el.textContent = txt;
  });
  root.querySelectorAll("[data-pomo-ring]").forEach((c) => {
    const frac = left == null ? 0 : 1 - left / (t.durMs || 1);
    c.style.strokeDashoffset = String(CIRC * (1 - Math.max(0, Math.min(1, frac))));
  });
  const key = `${t.phase}|${t.pausedLeft == null}|${t.subject}|${t.startedAt}`;
  if (root.dataset.pomoKey && root.dataset.pomoKey !== key) root.dispatchEvent(new CustomEvent("pomo-change"));
  root.dataset.pomoKey = key;
}

export function sessionsStats(data) {
  const today = todayKey(), mon = mondayOf(today);
  const s = data.sessions || [];
  const todayList = s.filter((x) => x.date === today);
  const week = s.filter((x) => x.date >= mon);
  const by = new Map();
  for (const x of s) {
    const k = x.subject || "Allgemein";
    const o = by.get(k) || { subject: k, week: 0, total: 0, count: 0 };
    o.total += Number(x.minutes) || 0; o.count++;
    if (x.date >= mon) o.week += Number(x.minutes) || 0;
    by.set(k, o);
  }
  const sum = (l) => l.reduce((a, x) => a + (Number(x.minutes) || 0), 0);
  return { todayCount: todayList.filter((x) => !x.partial).length, todayMin: sum(todayList), weekMin: sum(week), bySubject: [...by.values()].sort((a, b) => b.week - a.week || b.total - a.total) };
}
export const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + " min" : ""}`.trim() : `${m} min`);

export function pomoMiniHTML() {
  const t = timerState();
  if (t.phase === "idle") return "";
  return `<button type="button" class="ss-pomo-mini ${t.phase}" data-go="lernen">
    <span>${t.phase === "focus" ? "🍅 Fokus" : "☕ Pause"}${t.subject ? " · " + esc(t.subject) : ""}${t.pausedLeft != null ? " · pausiert" : ""}</span>
    <b data-pomo-time>${mmss(timeLeft(t))}</b></button>`;
}

function pomoCardHTML(S) {
  const p = prefs(S.data);
  const t = timerState();
  const st = sessionsStats(S.data);
  const subj = S.view.pomoSubject ?? (t.subject || "");
  const list = subjects(S.data);
  const phase = t.phase;
  const label = phase === "focus" ? (t.pausedLeft != null ? "Fokus pausiert" : "Fokus") : phase === "break" ? (t.long ? "Lange Pause" : "Pause") : "Bereit";
  const c = phase === "break" ? "#14b8a6" : subjectColor(S.data, phase === "idle" ? subj : t.subject) || "#5b7cfa";
  return `<section class="card ss-card ss-pomo ${phase}" style="--c:${esc(c)}">
    <div class="ss-pomo-head"><h3 class="ss-h">Lern-Timer</h3><button type="button" class="ss-icon-btn" id="pm-set" aria-label="Timer-Einstellungen">⚙</button></div>
    <div class="ss-ring">
      <svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="${R}" class="bg"/><circle cx="100" cy="100" r="${R}" class="fg" data-pomo-ring stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${CIRC.toFixed(1)}" transform="rotate(-90 100 100)"/></svg>
      <div class="ss-ring-in"><span class="ss-phase">${esc(label)}</span><b data-pomo-time data-idle="${p.focusMin * 60000}" aria-live="off">${mmss(phase === "idle" ? p.focusMin * 60000 : timeLeft(t))}</b>
        <span class="ss-phase-s">${phase === "idle" ? `${p.focusMin} / ${p.breakMin} min` : esc(t.subject || "Allgemein")}</span></div>
    </div>
    ${phase === "idle" ? `<div class="chips ss-pomo-subj" role="radiogroup" aria-label="Fach">
        <button type="button" class="chip" data-ps="" aria-pressed="${!subj}">Allgemein</button>
        ${list.map((s) => `<button type="button" class="chip" data-ps="${esc(s)}" aria-pressed="${subj === s}">${dot(subjectColor(S.data, s))}${esc(s)}</button>`).join("")}
      </div>
      <button type="button" class="btn go" id="pm-start">▶ Fokus starten</button>`
      : `<div class="row">${t.pausedLeft != null ? `<button type="button" class="btn go" id="pm-resume">▶ Weiter</button>` : `<button type="button" class="btn pause" id="pm-pause">❚❚ Pause</button>`}
        <button type="button" class="btn ghost" id="pm-stop">${phase === "break" ? "Pause überspringen" : "■ Stopp"}</button></div>`}
    <div class="ss-pomo-stats"><span><b>${st.todayCount}</b> 🍅 heute</span><span><b>${esc(fmtMin(st.todayMin))}</b> heute</span><span><b>${esc(fmtMin(st.weekMin))}</b> diese Woche</span></div>
  </section>`;
}

function openPomoSettings(S) {
  const p = prefs(S.data);
  S.ctx.ui.openSheet({
    title: "Lern-Timer einstellen",
    bodyHTML: `<form class="fields ss-form">
      <div class="row"><label>Fokus (min)<input type="number" id="pm-f" min="1" max="120" value="${p.focusMin}" inputmode="numeric"></label>
        <label>Pause (min)<input type="number" id="pm-b" min="0" max="60" value="${p.breakMin}" inputmode="numeric"></label></div>
      <div class="row"><label>Lange Pause (min)<input type="number" id="pm-l" min="0" max="90" value="${p.longBreakMin}" inputmode="numeric"></label>
        <label>Lange Pause nach<select id="pm-e">${[0, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${n === p.longEvery ? " selected" : ""}>${n ? n + " Einheiten" : "nie"}</option>`).join("")}</select></label></div>
      <div class="chips"><button type="button" class="chip" data-pre="25,5">25 / 5</button><button type="button" class="chip" data-pre="50,10">50 / 10</button><button type="button" class="chip" data-pre="45,15">45 / 15</button></div>
      <label class="switch">Ton am Ende<input type="checkbox" id="pm-snd"${p.sound ? " checked" : ""}></label>
      <label class="switch">Vibration am Ende<input type="checkbox" id="pm-vib"${p.vibrate ? " checked" : ""}></label>
      <button type="button" class="btn ghost sm" id="pm-test">Ton testen</button>
      <div class="row"><button type="submit" class="btn primary">Speichern</button></div>
    </form>`,
    onMount(el, close) {
      el.querySelectorAll("[data-pre]").forEach((b) => b.addEventListener("click", () => { const [f, br] = b.dataset.pre.split(","); el.querySelector("#pm-f").value = f; el.querySelector("#pm-b").value = br; }));
      el.querySelector("#pm-test").addEventListener("click", () => { beep(); if (navigator.vibrate) try { navigator.vibrate(200); } catch { /* egal */ } });
      el.querySelector("form").addEventListener("submit", (ev) => {
        ev.preventDefault();
        const num = (id, lo, hi, d) => { const v = Math.round(Number(el.querySelector(id).value)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
        savePrefs(S.data, { focusMin: num("#pm-f", 1, 120, 25), breakMin: num("#pm-b", 0, 60, 5), longBreakMin: num("#pm-l", 0, 90, 15), longEvery: Number(el.querySelector("#pm-e").value) || 0, sound: el.querySelector("#pm-snd").checked, vibrate: el.querySelector("#pm-vib").checked });
        S.ctx.ui.toast("Timer-Einstellungen gespeichert"); close();
      });
    },
  });
}

/* ---------- Lernplan-Zeilen ---------- */

export function planRowHTML(S, p) {
  const ex = (S.data.exams || []).find((e) => e.id === p.examId);
  const late = !p.done && p.date < todayKey();
  return `<li class="ss-task${p.done ? " done" : ""}" style="--c:${esc(subjectColor(S.data, p.subject))}">
    <button type="button" class="ss-check" data-pdone="${esc(p.id)}" role="checkbox" aria-checked="${p.done ? "true" : "false"}" aria-label="${esc(p.title)} erledigt"></button>
    <div class="ss-task-main"><b>${esc(p.title)}</b>
      <span class="ss-meta">${p.subject ? `${dot(subjectColor(S.data, p.subject))}${esc(p.subject)}` : ""}${ex ? `<span>für ${esc(examTitle(ex))} (${esc(countdown(ex.date))})</span>` : ""}${late ? `<span class="ss-late">von ${esc(fmtDay(p.date))}</span>` : ""}${p.minutes ? `<span>${p.minutes} min</span>` : ""}</span></div>
    ${p.done ? "" : `<button type="button" class="ss-icon-btn ss-play" data-pstart="${esc(p.id)}" aria-label="Timer für ${esc(p.title)} starten">▶</button>`}
  </li>`;
}
export function wirePlan(root, S) {
  root.querySelectorAll("[data-pdone]").forEach((b) => b.addEventListener("click", () => {
    const p = col("plan").get(b.dataset.pdone); if (!p) return;
    safeWrite(col("plan").patch(p.id, { done: !p.done, doneAt: !p.done ? Date.now() : null }));
  }));
  root.querySelectorAll("[data-pstart]").forEach((b) => b.addEventListener("click", () => {
    const p = col("plan").get(b.dataset.pstart); if (!p) return;
    if (timerState().phase !== "idle") { S.ctx.ui.toast("Der Timer läuft schon."); S.go("lernen"); return; }
    startFocus(S.data, p.subject);
    S.ctx.ui.toast(`Fokus gestartet: ${p.title}`);
    S.go("lernen");
  }));
}
export function planDue(data, today = todayKey()) {
  return (data.plan || []).filter((p) => !p.done && p.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function renderLearn(body, S) {
  const today = todayKey();
  const due = planDue(S.data, today);
  const doneToday = (S.data.plan || []).filter((p) => p.done && p.date === today);
  const nextDays = [];
  for (let i = 1; i <= 7; i++) {
    const k = addDays(today, i);
    const l = (S.data.plan || []).filter((p) => p.date === k).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (l.length) nextDays.push([k, l]);
  }
  const st = sessionsStats(S.data);
  const maxW = Math.max(1, ...st.bySubject.map((x) => x.week));
  const hasPlan = (S.data.plan || []).length > 0;
  body.innerHTML = `<div class="ss-grid ss-grid-learn">
    ${pomoCardHTML(S)}
    <section class="card ss-card"><h3 class="ss-h">Heute lernen <span class="ss-count">${due.length}</span></h3>
      ${due.length || doneToday.length ? `<ul class="ss-list">${[...due, ...doneToday].map((p) => planRowHTML(S, p)).join("")}</ul>`
        : hasPlan ? `<p class="note">Für heute ist nichts geplant. 🙌</p>`
        : emptyHTML("🗓️", "Noch kein Lernplan", "Bei einer Prüfung „Lernplan erstellen“ tippen – der Stoff wird automatisch auf die Tage davor verteilt.", "Prüfung eintragen", "go-exams")}
      ${nextDays.length ? `<div class="lbl ss-sub">Nächste Tage</div>${nextDays.map(([k, l]) => `<div class="ss-dayplan"><span>${esc(fmtDay(k))}</span><ul class="ss-list">${l.map((p) => planRowHTML(S, p)).join("")}</ul></div>`).join("")}` : ""}
    </section>
    <section class="card ss-card"><h3 class="ss-h">Lernzeit pro Fach</h3>
      ${st.bySubject.length ? `<ul class="ss-bars">${st.bySubject.map((x) => `<li style="--c:${esc(subjectColor(S.data, x.subject === "Allgemein" ? "" : x.subject))}">
          <span class="ss-bars-l">${esc(x.subject)}</span><span class="ss-bars-b"><i style="width:${Math.round((x.week / maxW) * 100)}%"></i></span>
          <span class="ss-bars-v"><b>${esc(fmtMin(x.week))}</b><small>gesamt ${esc(fmtMin(x.total))} · ${x.count} 🍅</small></span></li>`).join("")}</ul>
          <p class="note">Balken = diese Woche.</p>`
        : `<p class="note">Starte den Timer – jede fertige Einheit wird hier pro Fach gezählt.</p>`}
    </section>
  </div>`;
  const t = timerState();
  body.querySelector("#pm-set").addEventListener("click", () => openPomoSettings(S));
  body.querySelectorAll("[data-ps]").forEach((b) => b.addEventListener("click", () => {
    S.view.pomoSubject = b.dataset.ps;
    body.querySelectorAll("[data-ps]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  const on = (id, fn) => { const b = body.querySelector(id); if (b) b.addEventListener("click", fn); };
  on("#pm-start", () => {
    startFocus(S.data, S.view.pomoSubject ?? (t.subject || ""));
    if ("Notification" in window && Notification.permission === "default") { try { Notification.requestPermission().catch(() => {}); } catch { /* egal */ } }
  });
  on("#pm-pause", pauseTimer);
  on("#pm-resume", resumeTimer);
  on("#pm-stop", () => stopTimer(S.ctx));
  body.querySelectorAll("[data-act=go-exams]").forEach((b) => b.addEventListener("click", () => S.go("pruefungen")));
  wirePlan(body, S);
}
