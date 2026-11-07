// Alltag › LAP › 📝 Prüfungssimulation: 20 gemischte Multiple-Choice-Fragen mit Zeitlimit, Auswertung je Thema,
// Durchsicht der Fehler (mit „🤖 Erklär mir das“), Verlauf der Versuche. Laufende Prüfung übersteht Neuladen (localStorage).
// Lehrjahr: gemischt aus dem gewählten Jahr und darunter. Bei Rechenfragen gibt's den 🧮 Taschenrechner zum Aufklappen.
import { TOPICS, NORM_NOTE, topicOf } from "./lap-data.js";
import { buildExam, scoreExam, examVerdict, filterYear, isNumericQuestion, normYear, EXAM_SIZE, EXAM_SECONDS, PASS_PCT } from "./lap-core.js";
import { createCalc } from "./lap-calc.js";

const RUN_KEY = "sk-lap-exam-run";
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
const mmss = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function createExam(L) {
  const { esc } = L;
  let page = null;
  let run = lsGet(RUN_KEY); // { qs, answers, i, start, secs }
  if (run && (!Array.isArray(run.qs) || !run.qs.length)) run = null;
  let shown = null; // Ergebnis-Dokument, das gerade angezeigt wird
  let timer = null;
  let armed = false;
  const calc = createCalc();
  const card = (id) => L.allCards().find((c) => c.id === id);
  const yearText = (y) => (normYear(y) ? `bis zum ${normYear(y)}. Lehrjahr` : "aus allen Lehrjahren");

  const left = () => (run ? run.secs - (Date.now() - run.start) / 1000 : 0);
  const persist = () => lsSet(RUN_KEY, run);

  function homeHTML() {
    const ex = L.exams();
    const weak = L.weak();
    const best = ex.reduce((m, e) => Math.max(m, e.pct || 0), 0);
    return `<div class="lap-card lap-examhero">` +
        `<div class="lap-emoji" aria-hidden="true">📝</div>` +
        `<h3 class="lap-h3">Prüfungssimulation</h3>` +
        `<p class="lap-muted">${EXAM_SIZE} gemischte Fragen ${yearText(L.year())} · ${Math.round(EXAM_SECONDS / 60)} Minuten · Übungsziel ${PASS_PCT} %. ` +
          `Fragen, die du falsch hast, landen automatisch in deinen Lernkarten 🃏</p>` +
        (weak.length ? `<p class="lap-muted">💪 Deine Übungsthemen (${weak.map((id) => (topicOf(id) || {}).emoji).join(" ")}) kommen etwas öfter dran.</p>` : "") +
        `<button type="button" class="btn primary" data-k="start">▶️ Prüfung starten</button>` +
        `<p class="lap-muted lap-small">Das ist eine Übung der App – keine echte LAP-Bewertung. Ablauf und Gewichtung der echten Prüfung erfährst du in der Berufsschule bzw. bei der Lehrlingsstelle.</p>` +
      `</div>` +
      `<div class="lap-card">` +
        `<div class="lap-row"><h3 class="lap-h3">📈 Deine Versuche</h3><span class="lap-grow"></span>${ex.length ? `<span class="lap-muted">Bestes: ${best} %</span>` : ""}</div>` +
        (ex.length
          ? `<ul class="lap-hist">${ex.slice(0, 12).map((e) => `<li><button type="button" class="lap-histrow" data-show="${esc(e.id)}">` +
              `<span class="lap-hist-d">${esc(new Date(e.at).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "2-digit" }))}</span>` +
              `<span class="lap-bar lap-hist-b"><span class="${e.pct >= PASS_PCT ? "ok" : "no"}" style="width:${Math.max(3, e.pct)}%"></span></span>` +
              `<b>${e.pct} %</b><small>${e.right}/${e.n} · ${mmss(e.secs)}</small></button></li>`).join("")}</ul>` +
            `<button type="button" class="btn ghost sm" data-k="clear">${armed ? "Wirklich alle löschen?" : "🧹 Verlauf löschen"}</button>`
          : `<p class="lap-muted">Noch keine Versuche – trau dich! 🍀</p>`) +
      `</div>`;
  }

  function runHTML() {
    const q = run.qs[run.i];
    const tp = topicOf(q.topic);
    const answered = Object.keys(run.answers).length;
    return `<div class="lap-card lap-exam">` +
      `<div class="lap-row lap-examtop"><span class="lap-timer${left() < 120 ? " low" : ""}" aria-label="Restzeit">⏱️ <b class="lap-time">${mmss(left())}</b></span><span class="lap-grow"></span>` +
        `<span class="lap-muted">Frage ${run.i + 1} / ${run.qs.length}</span></div>` +
      `<div class="lap-dots" role="group" aria-label="Fragen">${run.qs.map((x, i) => `<button type="button" class="lap-qdot${i === run.i ? " cur" : ""}${run.answers[x.id] != null ? " done" : ""}" data-go="${i}" aria-label="Frage ${i + 1}${run.answers[x.id] != null ? " (beantwortet)" : ""}">${i + 1}</button>`).join("")}</div>` +
      `<span class="lap-pill">${tp.emoji} ${esc(tp.name)}</span>` +
      `<p class="lap-q">${esc(q.q)}</p>` +
      (isNumericQuestion(q) ? calc.html({ take: false }) : "") +
      `<div class="lap-opts" role="radiogroup" aria-label="Antworten">${q.options.map((o, i) => `<button type="button" role="radio" class="lap-opt" data-opt="${i}" aria-checked="${run.answers[q.id] === o}"><span class="lap-optk" aria-hidden="true">${"ABCD"[i]}</span><span>${esc(o)}</span></button>`).join("")}</div>` +
      `<div class="lap-row lap-wrap lap-examnav">` +
        `<button type="button" class="btn ghost" data-k="prev" ${run.i === 0 ? "disabled" : ""}>← Zurück</button><span class="lap-grow"></span>` +
        (run.i < run.qs.length - 1 ? `<button type="button" class="btn primary" data-k="nextq">Weiter →</button>` : "") +
      `</div>` +
      `<button type="button" class="btn ${answered === run.qs.length ? "primary" : "ghost"} lap-full" data-k="submit">${armed ? `Wirklich abgeben? ${run.qs.length - answered} offen` : `✅ Abgeben (${answered}/${run.qs.length})`}</button>` +
    `</div>`;
  }

  function resultHTML(res) {
    const live = res.qs; // nur direkt nach der Prüfung vorhanden (mit Antwortreihenfolge)
    const wrong = (res.wrong || []).map((w) => ({ ...w, c: card(w.id) })).filter((w) => w.c);
    const norm = wrong.some((w) => (topicOf(w.c.topic) || {}).norm);
    return `<div class="lap-card lap-center lap-result">` +
        `<div class="lap-score ${res.pct >= PASS_PCT ? "ok" : "no"}">${res.pct} %</div>` +
        `<p class="lap-verdict">${esc(examVerdict(res.pct))}</p>` +
        `<p class="lap-muted">${res.right} von ${res.n} richtig · ${mmss(res.secs)} min${res.timeout ? " · ⏰ Zeit abgelaufen" : ""}</p>` +
        `<div class="lap-row lap-wrap lap-centerrow"><button type="button" class="btn primary" data-k="start">🔁 Neue Prüfung</button><button type="button" class="btn ghost" data-k="home">Zur Übersicht</button></div>` +
      `</div>` +
      `<div class="lap-card"><h3 class="lap-h3">📊 Nach Thema</h3><ul class="lap-bytopic">` +
        TOPICS.filter((t) => res.byTopic && res.byTopic[t.id]).map((t) => {
          const v = res.byTopic[t.id]; const p = Math.round((v.ok / v.n) * 100);
          return `<li><span>${t.emoji} ${esc(t.name)}</span><span class="lap-bar"><span class="${p >= PASS_PCT ? "ok" : "no"}" style="width:${Math.max(3, p)}%"></span></span><b>${v.ok}/${v.n}</b></li>`;
        }).join("") + `</ul></div>` +
      `<div class="lap-card"><h3 class="lap-h3">${wrong.length ? `🔍 Deine Fehler (${wrong.length})` : "🌟 Keine Fehler – sauber!"}</h3>` +
        (norm ? `<p class="lap-norm">${esc(NORM_NOTE)}</p>` : "") +
        wrong.map((w) => {
          const tp = topicOf(w.c.topic);
          return `<div class="lap-wrong">` +
            `<span class="lap-pill sm">${tp.emoji} ${esc(tp.name)}</span>` +
            `<p class="lap-q sm">${esc(w.c.q)}</p>` +
            `<p class="lap-mine">${w.picked != null ? `❌ Deine Antwort: ${esc(w.picked)}` : "⏭️ Nicht beantwortet"}</p>` +
            `<p class="lap-a">✅ ${esc(w.c.a)}</p>${w.c.e ? `<p class="lap-e">💡 ${esc(w.c.e)}</p>` : ""}` +
            L.explain.html(`x-${res.id}-${w.id}`, { topic: tp.name, q: w.c.q, a: w.c.a, e: w.c.e, picked: w.picked }) +
          `</div>`;
        }).join("") +
        (live && wrong.length ? `<p class="lap-muted">🃏 Diese Fragen sind jetzt in deinen Lernkarten als „heute fällig“.</p>` : "") +
      `</div>`;
  }

  function render() {
    if (!page) return;
    page.innerHTML = `<div>${run ? runHTML() : shown ? resultHTML(shown) : homeHTML()}</div>`;
  }

  function tick() {
    if (!run || !page) return;
    if (left() <= 0) { finish(true); return; }
    const t = page.querySelector(".lap-time");
    if (t) { t.textContent = mmss(left()); t.parentElement.classList.toggle("low", left() < 120); }
  }
  function startTimer() { stopTimer(); if (run) timer = setInterval(tick, 1000); }
  function stopTimer() { clearInterval(timer); timer = null; }

  function start() {
    const weights = Object.fromEntries(L.weak().map((t) => [t, 2]));
    run = { qs: buildExam(filterYear(L.allCards(), L.year(), "upto"), { weights }), answers: {}, i: 0, start: Date.now(), secs: EXAM_SECONDS, year: L.year() };
    calc.reset();
    if (!run.qs.length) { run = null; L.ui.toast("Für dieses Lehrjahr gibt's noch keine Prüfungsfragen 🤔"); return; }
    shown = null; armed = false; persist(); render(); startTimer();
  }
  async function finish(timeout = false) {
    if (!run) return;
    stopTimer();
    const r = run; run = null; persist();
    const s = scoreExam(r.qs, r.answers);
    const secs = Math.min(r.secs, Math.round((Date.now() - r.start) / 1000));
    const doc = { id: "e" + Date.now().toString(36), at: new Date().toISOString(), n: s.n, right: s.right, pct: s.pct, secs, byTopic: s.byTopic, wrong: s.wrong, ...(timeout ? { timeout: true } : {}) };
    shown = { ...doc, qs: r.qs };
    armed = false;
    render();
    if (page && page.scrollIntoView) { try { page.scrollIntoView({ block: "start" }); } catch { /* egal */ } }
    if (timeout) L.ui.toast("⏰ Zeit ist um – deine Prüfung wurde abgegeben.");
    await L.saveExam(doc);
    await L.relearn(s.wrong.map((w) => w.id));
    L.count("exam", s.passed, s.n);
  }

  function onClick(ev) {
    if (!page) return;
    if (calc.click(ev)) return;
    if (L.explain.click(ev)) return;
    const t = ev.target.closest("button");
    if (!t || !page.contains(t)) return;
    const k = t.dataset.k;
    if (run) {
      if (t.dataset.opt != null) {
        const q = run.qs[run.i];
        run.answers[q.id] = q.options[Number(t.dataset.opt)];
        persist(); armed = false;
        page.querySelectorAll(".lap-opt").forEach((b) => b.setAttribute("aria-checked", String(b === t)));
        render();
        return;
      }
      if (t.dataset.go != null) { run.i = Number(t.dataset.go); armed = false; persist(); render(); return; }
      if (k === "prev" && run.i > 0) { run.i--; persist(); render(); return; }
      if (k === "nextq" && run.i < run.qs.length - 1) { run.i++; persist(); render(); return; }
      if (k === "submit") {
        const open = run.qs.length - Object.keys(run.answers).length;
        if (open > 0 && !armed) { armed = true; render(); return; }
        finish(false); return;
      }
      return;
    }
    if (k === "start") { start(); return; }
    if (k === "home") { shown = null; render(); return; }
    if (t.dataset.show) { const e = L.exams().find((x) => x.id === t.dataset.show); if (e) { shown = e; render(); } return; }
    if (k === "clear") {
      if (!armed) { armed = true; render(); return; }
      armed = false; L.clearExams().then(render);
    }
  }
  function onInput(ev) { calc.input(ev); }
  function onKey(ev) {
    if (calc.key(ev)) return;
    if (!run || !page || ev.target.matches("input, textarea")) return;
    const i = "abcd1234".indexOf(ev.key.toLowerCase());
    if (i >= 0) { const b = page.querySelector(`.lap-opt[data-opt="${i % 4}"]`); if (b) { ev.preventDefault(); b.click(); } }
    else if (ev.key === "ArrowRight" && run.i < run.qs.length - 1) { run.i++; persist(); render(); }
    else if (ev.key === "ArrowLeft" && run.i > 0) { run.i--; persist(); render(); }
  }

  return {
    show(el) {
      page = el; armed = false;
      page.addEventListener("click", onClick); page.addEventListener("input", onInput); document.addEventListener("keydown", onKey);
      if (run && left() <= 0) { finish(true); return; }
      render(); startTimer();
    },
    hide() { stopTimer(); if (page) { page.removeEventListener("click", onClick); page.removeEventListener("input", onInput); } document.removeEventListener("keydown", onKey); page = null; },
    onYear() { if (page && !run) render(); },
    onData() { if (page && !run && !shown) render(); },
    destroy() { stopTimer(); },
  };
}
