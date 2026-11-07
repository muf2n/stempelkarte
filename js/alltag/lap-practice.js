// Alltag › LAP › 🔢 Rechenaufgaben: Zufallsaufgaben aus den Formeln, Prüfung mit Toleranz, Lösungsweg Schritt für Schritt,
// passend zum gewählten Lehrjahr, mit 🧮 Taschenrechner zum Aufklappen („Ergebnis übernehmen“ → Antwortfeld).
import { PROBLEM_TYPES, makeProblem, checkAnswer, fmtAuto, fmt, problemTypesFor } from "./lap-core.js";
import { createCalc } from "./lap-calc.js";

const TYPE_KEY = "sk-lap-ptype";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

export function createPractice(L) {
  const { esc } = L;
  let page = null;
  let type = PROBLEM_TYPES.some((t) => t.id === lsGet(TYPE_KEY)) ? lsGet(TYPE_KEY) : "mix";
  let prob = null;
  let input = "";
  let result = null; // null | { ok, value, shown }
  let score = { n: 0, ok: 0 };
  let seq = 0;
  let yearSeen = null;
  const calc = createCalc({ onTake(text) {
    if (!page || result) return;
    input = text;
    const i = page.querySelector(".lap-ans");
    if (i) { i.value = text; i.focus({ preventScroll: true }); }
    L.ui.toast("📥 Ergebnis übernommen – jetzt ✔️ Prüfen");
  } });
  const types = () => problemTypesFor(L.year());

  const fmtAns = (p) => (p.unit === "€" ? fmt(p.answer, 2) : fmtAuto(p.answer));
  function next() {
    prob = makeProblem(type === "mix" ? null : type, Math.random, types());
    input = ""; result = null; seq++; calc.reset();
  }

  function html() {
    if (yearSeen !== L.year()) { yearSeen = L.year(); if (type !== "mix" && !types().some((t) => t.id === type)) type = "mix"; prob = null; }
    if (!prob) next();
    const tp = PROBLEM_TYPES.find((t) => t.id === prob.type);
    return `<div class="lap-card">` +
        `<div class="chips lap-chips" role="group" aria-label="Aufgabenart">` +
          `<button type="button" class="chip" data-pt="mix" aria-pressed="${type === "mix"}">🎲 Gemischt</button>` +
          types().map((t) => `<button type="button" class="chip" data-pt="${t.id}" aria-pressed="${type === t.id}">${t.emoji} ${esc(t.name)}</button>`).join("") +
        `</div>` +
      `</div>` +
      `<div class="lap-card lap-prob">` +
        `<div class="lap-row"><span class="lap-pill">${tp.emoji} ${esc(tp.name)}</span><span class="lap-grow"></span>` +
          `<span class="lap-muted" title="richtig / gerechnet">✅ ${score.ok} / ${score.n}</span></div>` +
        `<p class="lap-q">${esc(prob.text)}</p>` +
        `<form class="lap-ansform" autocomplete="off">` +
          `<label class="lap-field wide"><span>Dein Ergebnis für ${esc(prob.ask)}</span><span class="lap-inp lap-inp-big"><input inputmode="decimal" class="lap-ans" aria-label="Ergebnis" value="${esc(input)}" ${result ? "disabled" : ""} placeholder="z. B. 2,5"><i>${esc(prob.unit)}</i></span></label>` +
          (result ? "" : `<div class="lap-row lap-wrap"><button type="submit" class="btn primary">✔️ Prüfen</button><button type="button" class="btn ghost" data-k="show">👀 Lösung zeigen</button></div>`) +
        `</form>` +
        calc.html({ take: !result }) +
        (result ? resultHTML() : `<p class="lap-muted">Tipp: Komma oder Punkt passt beides. Ein bisserl Rundung ist erlaubt (±${Math.round(prob.tol * 100)} %).</p>`) +
      `</div>`;
  }
  function resultHTML() {
    const head = result.shown
      ? `<div class="lap-fb">👀 Lösung: <b>${fmtAns(prob)} ${esc(prob.unit)}</b></div>`
      : result.ok
        ? `<div class="lap-fb ok">✅ Richtig! <b>${fmtAns(prob)} ${esc(prob.unit)}</b></div>`
        : `<div class="lap-fb no">❌ Leider nicht – richtig wäre <b>${fmtAns(prob)} ${esc(prob.unit)}</b></div>`;
    return head +
      `<h4 class="lap-h4">🪜 Lösungsweg</h4>` +
      `<ol class="lap-steps">${prob.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` +
      L.explain.html("p-" + seq, { topic: "Rechenaufgaben", q: prob.text, a: `${fmtAns(prob)} ${prob.unit} (Lösungsweg: ${prob.steps.join(" | ")})`, picked: result.shown || result.ok ? null : `${input} ${prob.unit}` }) +
      `<button type="button" class="btn primary lap-full" data-k="next">➡️ Nächste Aufgabe</button>`;
  }
  function render() {
    if (!page) return;
    page.innerHTML = `<div>${html()}</div>`;
    const inp = page.querySelector(".lap-ans:not([disabled])");
    if (inp && document.activeElement !== inp && window.matchMedia && window.matchMedia("(hover: hover)").matches) inp.focus({ preventScroll: true });
  }

  function check() {
    const r = checkAnswer(input, prob.answer, prob.tol);
    if (r.empty || !Number.isFinite(r.value)) { L.ui.toast("Bitte eine Zahl eingeben 🙂"); return; }
    result = { ok: r.ok, value: r.value, shown: false };
    score.n++; if (r.ok) score.ok++;
    L.count("calc", r.ok);
    render();
  }

  function onClick(ev) {
    if (!page) return;
    if (calc.click(ev)) return;
    if (L.explain.click(ev)) return;
    const t = ev.target.closest("button");
    if (!t || !page.contains(t)) return;
    if (t.dataset.pt) { type = t.dataset.pt; lsSet(TYPE_KEY, type); next(); render(); return; }
    if (t.dataset.k === "show") { result = { ok: false, value: NaN, shown: true }; render(); return; }
    if (t.dataset.k === "next") { next(); render(); const i = page.querySelector(".lap-ans"); if (i) i.focus({ preventScroll: true }); }
  }
  function onSubmit(ev) { ev.preventDefault(); if (!result) check(); }
  function onInput(ev) { if (calc.input(ev)) return; if (ev.target.classList.contains("lap-ans")) input = ev.target.value; }
  function onKey(ev) { calc.key(ev); }

  return {
    show(el) { page = el; page.addEventListener("click", onClick); page.addEventListener("submit", onSubmit); page.addEventListener("input", onInput); page.addEventListener("keydown", onKey); render(); },
    hide() { if (page) { page.removeEventListener("click", onClick); page.removeEventListener("submit", onSubmit); page.removeEventListener("input", onInput); page.removeEventListener("keydown", onKey); } page = null; },
    onYear() { if (page) render(); },
  };
}
