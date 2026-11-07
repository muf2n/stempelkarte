// Alltag › Japanisch › 🔤 Kana: Hiragana-/Katakana-Tabellen (antippen = vorlesen) und Quiz (Fehler landen im SRS).
import { KANA_GROUPS } from "./jp-data.js";
import { toKatakana, makeKanaQuiz, checkRomaji, isMastered, isDue, kanaList, shuffle } from "./jp-core.js";

const OPT_KEY = "sk-jp-kanaquiz";
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
const ALL_ROWS = KANA_GROUPS.flatMap(([gid, , rows]) => rows.map(([rid, name]) => ({ rid, name, gid })));

export function createKana(J) {
  const { esc } = J;
  let page = null;
  let mode = "table"; // table | setup | quiz | done
  let script = "hira";
  const saved = lsGet(OPT_KEY) || {};
  const opt = {
    script: ["hira", "kata", "both"].includes(saved.script) ? saved.script : "hira",
    rows: Array.isArray(saved.rows) && saved.rows.length ? saved.rows.filter((r) => ALL_ROWS.some((x) => x.rid === r)) : ["a", "k", "s"],
    dir: ["k2r", "k2rt", "r2k"].includes(saved.dir) ? saved.dir : "k2r",
    count: [10, 20, 30].includes(saved.count) ? saved.count : 10,
  };
  let quiz = null; // { qs, i, right, wrong:[], answered, typed }

  const cardOf = (k) => J.card(J.kanaId(k));
  const conv = (k) => (script === "kata" ? toKatakana(k) : k);

  function poolFor(o) {
    const scripts = o.script === "both" ? ["hira", "kata"] : [o.script];
    const out = [];
    for (const sc of scripts) for (const k of kanaList(sc)) if (o.rows.includes(k.row)) out.push(k);
    return out;
  }
  function dueKana() {
    const t = J.today();
    const all = [...kanaList("hira"), ...kanaList("kata")];
    return all.filter((k) => { const c = cardOf(k.kana); return c && c.seen > 0 && isDue(c, t); });
  }

  /* ---------- Tabelle ---------- */
  function tableHTML() {
    const due = dueKana().length;
    let h = `<div class="jp-row jp-wrap">` +
      `<div class="jp-seg" role="group" aria-label="Schrift">` +
        `<button type="button" data-k="script" data-v="hira" aria-pressed="${script === "hira"}">あ Hiragana</button>` +
        `<button type="button" data-k="script" data-v="kata" aria-pressed="${script === "kata"}">ア Katakana</button>` +
      `</div>` +
      `<span class="jp-grow"></span>` +
      (due ? `<button type="button" class="btn ghost sm" data-k="due">🔁 Fällige Kana (${due})</button>` : "") +
      `<button type="button" class="btn primary sm" data-k="setup">🎯 Quiz starten</button>` +
    `</div>` +
    `<p class="jp-muted">Tipp ein Zeichen an, dann hörst du es 🔊. Ein grüner Punkt heißt: sitzt schon sicher.</p><div class="jp-kgroups">`;
    for (const [gid, gname, rows] of KANA_GROUPS) {
      const cols = gid === "yoon" ? 3 : 5;
      h += `<section class="jp-kgroup"><h3 class="jp-h3">${esc(gname)}</h3><div class="jp-kgrid" style="--cols:${cols}">`;
      for (const [, , cells] of rows) {
        for (const c of cells) {
          if (!c) { h += `<span class="jp-kcell jp-empty" aria-hidden="true"></span>`; continue; }
          const k = conv(c[0]);
          const card = cardOf(k);
          const cls = card && isMastered(card) ? " ok" : card && card.lapses > 0 && card.reps === 0 ? " weak" : card && card.seen ? " seen" : "";
          h += `<button type="button" class="jp-kcell${cls}" data-say="${esc(k)}" aria-label="${esc(k)} – ${esc(c[1])}"><span class="jp-ja">${esc(k)}</span><small>${esc(c[1])}</small></button>`;
        }
      }
      h += `</div></section>`;
    }
    return h + `</div>`;
  }

  /* ---------- Quiz-Einstellungen ---------- */
  function setupHTML() {
    const n = poolFor(opt).length;
    const chips = (gid) => ALL_ROWS.filter((r) => r.gid === gid).map((r) =>
      `<button type="button" class="chip" data-row="${r.rid}" aria-pressed="${opt.rows.includes(r.rid)}">${esc(r.name)}</button>`).join("");
    return `<div class="jp-card">` +
      `<h3 class="jp-h3">🎯 Kana-Quiz</h3>` +
      `<label class="jp-lbl">Schrift</label>` +
      `<div class="jp-seg" role="group" aria-label="Schrift">` +
        [["hira", "Hiragana"], ["kata", "Katakana"], ["both", "Beide"]].map(([v, l]) => `<button type="button" data-o="script" data-v="${v}" aria-pressed="${opt.script === v}">${l}</button>`).join("") +
      `</div>` +
      `<label class="jp-lbl">Richtung</label>` +
      `<div class="jp-seg" role="group" aria-label="Richtung">` +
        [["k2r", "あ → a wählen"], ["k2rt", "あ → a tippen"], ["r2k", "a → あ wählen"]].map(([v, l]) => `<button type="button" data-o="dir" data-v="${v}" aria-pressed="${opt.dir === v}">${l}</button>`).join("") +
      `</div>` +
      `<label class="jp-lbl">Reihen <button type="button" class="jp-link" data-k="allrows">alle</button> · <button type="button" class="jp-link" data-k="norows">keine</button></label>` +
      `<div class="chips">${chips("basis")}</div><div class="chips">${chips("daku")}</div><div class="chips">${chips("yoon")}</div>` +
      `<label class="jp-lbl">Fragen</label>` +
      `<div class="jp-seg" role="group" aria-label="Anzahl">` +
        [10, 20, 30].map((v) => `<button type="button" data-o="count" data-v="${v}" aria-pressed="${opt.count === v}">${v}</button>`).join("") +
      `</div>` +
      `<div class="jp-row jp-mt">` +
        `<button type="button" class="btn ghost" data-k="table">← Tabelle</button>` +
        `<button type="button" class="btn primary" data-k="start" ${n ? "" : "disabled"}>Los geht's (${n} Zeichen) 🚀</button>` +
      `</div>` +
    `</div>`;
  }

  function startQuiz(pool, count, dir) {
    const cards = J.cards();
    const weights = {};
    for (const p of pool) { const c = cards.get(J.kanaId(p.kana)); if (c) weights[p.kana] = 1 + Math.min(3, c.lapses || 0) + (c.reps === 0 && c.seen ? 1 : 0); }
    const qs = makeKanaQuiz(pool, { dir: dir === "r2k" ? "r2k" : "k2r", count, weights });
    quiz = { qs, i: 0, right: 0, wrong: [], answered: null, typed: dir === "k2rt" };
    mode = "quiz";
    render();
  }

  function quizHTML() {
    const q = quiz.qs[quiz.i];
    const a = quiz.answered;
    const prog = Math.round((quiz.i / quiz.qs.length) * 100);
    const big = q.dir === "r2k" ? `<span class="jp-qroma">${esc(q.prompt)}</span>` : `<span class="jp-ja jp-qkana">${esc(q.prompt)}</span>`;
    let body;
    if (quiz.typed) {
      body = `<form class="jp-typeform" data-k="typeform" autocomplete="off">` +
        `<input type="text" class="jp-typein" name="ans" inputmode="latin" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Romaji, z. B. ka" aria-label="Romaji eingeben" ${a ? "disabled" : ""} value="${a ? esc(a.input) : ""}">` +
        `<button type="submit" class="btn primary" ${a ? "disabled" : ""}>Prüfen</button>` +
      `</form>`;
    } else {
      body = `<div class="jp-opts">` + q.options.map((o) => {
        let cls = "";
        if (a) { if (o === q.answer) cls = " right"; else if (o === a.input) cls = " wrong"; }
        return `<button type="button" class="jp-opt${q.dir === "r2k" ? " jp-ja" : ""}${cls}" data-ans="${esc(o)}" ${a ? "disabled" : ""}>${esc(o)}</button>`;
      }).join("") + `</div>`;
    }
    const fb = a ? `<div class="jp-fb ${a.ok ? "ok" : "no"}">${a.ok ? "✅ Richtig!" : `❌ Das war <b class="jp-ja">${esc(q.kana)}</b> = <b>${esc(q.romaji)}</b>`}` +
      `<button type="button" class="btn primary sm" data-k="next">${quiz.i + 1 < quiz.qs.length ? "Weiter →" : "Fertig 🎉"}</button></div>` : "";
    return `<div class="jp-card jp-quiz">` +
      `<div class="jp-row"><span class="jp-muted">Frage ${quiz.i + 1}/${quiz.qs.length} · ✅ ${quiz.right}</span><span class="jp-grow"></span>` +
        `<button type="button" class="btn ghost sm" data-k="say" aria-label="Vorlesen">🔊</button>` +
        `<button type="button" class="btn ghost sm" data-k="quit">✕ Beenden</button></div>` +
      `<div class="jp-bar jp-bar-q"><span style="width:${prog}%"></span></div>` +
      `<div class="jp-qbig">${big}</div>` +
      body + fb +
    `</div>`;
  }

  function doneHTML() {
    const n = quiz.qs.length;
    const pct = Math.round((quiz.right / n) * 100);
    const uniq = [...new Map(quiz.wrong.map((w) => [w.kana, w])).values()];
    const msg = pct === 100 ? "Perfekt! 🌸 完璧 (kanpeki)!" : pct >= 80 ? "Super gemacht! 💪" : pct >= 50 ? "Wird schon – dranbleiben! 🙂" : "Übung macht den Meister 🍵";
    return `<div class="jp-card jp-center">` +
      `<div class="jp-score">${quiz.right}/${n}</div><p>${msg}</p>` +
      (uniq.length ? `<p class="jp-muted">Diese üben wir öfter (sind jetzt im SRS):</p><div class="jp-misses">${uniq.map((w) => `<button type="button" class="jp-kcell weak" data-say="${esc(w.kana)}"><span class="jp-ja">${esc(w.kana)}</span><small>${esc(w.romaji)}</small></button>`).join("")}</div>` : "") +
      `<div class="jp-row jp-mt jp-wrap">` +
        `<button type="button" class="btn ghost" data-k="table">← Tabelle</button>` +
        (uniq.length ? `<button type="button" class="btn ghost" data-k="retry">🔁 Fehler nochmal</button>` : "") +
        `<button type="button" class="btn primary" data-k="setup">Neues Quiz</button>` +
      `</div></div>`;
  }

  function render() {
    if (!page) return;
    page.innerHTML = `<div class="jp-kana">${mode === "table" ? tableHTML() : mode === "setup" ? setupHTML() : mode === "quiz" ? quizHTML() : doneHTML()}</div>`;
    if (mode === "quiz" && quiz.typed && !quiz.answered) { const i = page.querySelector(".jp-typein"); if (i) i.focus({ preventScroll: true }); }
    if (mode === "quiz" && quiz.answered) { const nb = page.querySelector('[data-k="next"]'); if (nb) nb.focus({ preventScroll: true }); }
  }

  function answer(input) {
    const q = quiz.qs[quiz.i];
    if (quiz.answered) return;
    const ok = q.dir === "r2k" ? input === q.answer : quiz.typed ? checkRomaji(q.romaji, input) : input === q.answer;
    quiz.answered = { input, ok };
    if (ok) quiz.right++; else quiz.wrong.push({ kana: q.kana, romaji: q.romaji });
    J.grade(J.kanaId(q.kana), ok ? 4 : 1, { kind: "kana", kana: q.kana, romaji: q.romaji });
    J.count("kana", ok);
    if (ok) J.speak(q.kana);
    render();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !page.contains(t)) return;
    if (t.dataset.say) { J.speak(t.dataset.say); return; }
    const k = t.dataset.k;
    if (t.dataset.ans != null) { answer(t.dataset.ans); return; }
    if (t.dataset.row) {
      const r = t.dataset.row;
      opt.rows = opt.rows.includes(r) ? opt.rows.filter((x) => x !== r) : [...opt.rows, r];
      lsSet(OPT_KEY, opt); render(); return;
    }
    if (t.dataset.o) {
      const v = t.dataset.o === "count" ? Number(t.dataset.v) : t.dataset.v;
      opt[t.dataset.o] = v; lsSet(OPT_KEY, opt); render(); return;
    }
    if (k === "script") { script = t.dataset.v; render(); return; }
    if (k === "setup") { mode = "setup"; render(); return; }
    if (k === "table") { mode = "table"; render(); return; }
    if (k === "allrows") { opt.rows = ALL_ROWS.map((r) => r.rid); lsSet(OPT_KEY, opt); render(); return; }
    if (k === "norows") { opt.rows = []; lsSet(OPT_KEY, opt); render(); return; }
    if (k === "start") { startQuiz(poolFor(opt), opt.count, opt.dir); return; }
    if (k === "due") { const p = shuffle(dueKana()); startQuiz(p, Math.min(30, Math.max(p.length, 5)), "k2r"); return; }
    if (k === "retry") { const p = [...new Map(quiz.wrong.map((w) => [w.kana, w])).values()]; startQuiz(p, Math.max(5, p.length * 2), opt.dir); return; }
    if (k === "say") { J.speak(quiz.qs[quiz.i].kana); return; }
    if (k === "quit") { mode = quiz && quiz.i > 0 ? "done" : "table"; if (mode === "done") quiz.qs = quiz.qs.slice(0, quiz.i + (quiz.answered ? 1 : 0)); render(); return; }
    if (k === "next") {
      quiz.i++; quiz.answered = null;
      if (quiz.i >= quiz.qs.length) mode = "done";
      render(); return;
    }
  }
  function onSubmit(ev) {
    if (!ev.target.matches('[data-k="typeform"]')) return;
    ev.preventDefault();
    const v = ev.target.querySelector(".jp-typein").value;
    if (v.trim()) answer(v.trim());
  }

  return {
    show(el) {
      page = el;
      page.addEventListener("click", onClick);
      page.addEventListener("submit", onSubmit);
      render();
    },
    hide() { if (page) { page.removeEventListener("click", onClick); page.removeEventListener("submit", onSubmit); } page = null; },
    onData() { if (mode === "table") render(); },
  };
}
