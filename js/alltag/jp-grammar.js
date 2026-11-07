// Alltag › Japanisch › 📐 Grammatik: 20 kurze Lektionen (Erklärung, Tabelle, Beispiele zum Anhören, Mini-Quiz).
// Wird von ./japanisch.js erst beim ersten Öffnen des Tabs nachgeladen. Inhalte: ./jp-data-grammar.js
import { GRAMMAR } from "./jp-data-grammar.js";
import { parseJa } from "./jp-text.js";
import { shuffle } from "./jp-core.js";

const KEY = "sk-jp-gram";
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };

export function createGrammar(J) {
  const { esc } = J;
  let page = null;
  const s = lsGet(KEY) || {};
  const opt = { furi: s.furi !== false, ro: s.ro !== false, de: s.de !== false, open: s.open || null, done: Array.isArray(s.done) ? s.done : [] };
  const save = () => lsSet(KEY, { furi: opt.furi, ro: opt.ro, de: opt.de, open: opt.open, done: opt.done });
  let quiz = null; // { g, list:[ex], i, sel, ok, right }

  const furi = (ja) => ja.map(([t, rd]) => (rd && opt.furi ? `<ruby>${esc(t)}<rt>${esc(rd)}</rt></ruby>` : esc(t))).join("");
  const examples = (g) => g.examples.map(([src, ro, de]) => ({ ...parseJa(src), ro, de }));

  function listHTML() {
    const n = opt.done.length;
    return `<div class="jp-card jp-ghero"><span class="jp-gbig" aria-hidden="true">📐</span><div><b>Grammatik in kleinen Häppchen</b>` +
      `<p class="jp-muted">${GRAMMAR.length} kurze Lektionen – lesen, anhören, kurz üben. Im 🛤️ Lernpfad kommen sie zwischen den Wörtern dran.</p>` +
      `<span class="jp-bar jp-gbar" aria-label="${n} von ${GRAMMAR.length} geschafft"><span style="width:${Math.round((n / GRAMMAR.length) * 100)}%"></span></span>` +
      `<small class="jp-muted">${n} / ${GRAMMAR.length} geschafft</small></div></div>` +
      `<div class="jp-rlist jp-glist">` + GRAMMAR.map((g, i) =>
        `<button type="button" class="jp-rtile" data-open="${esc(g.id)}"><span class="jp-rem" aria-hidden="true">${g.emoji}</span>` +
        `<span><b>${i + 1}. ${esc(g.title)}</b><small class="jp-ja">${esc(g.short)}${opt.done.includes(g.id) ? " · ✅" : ""}</small></span></button>`).join("") + `</div>`;
  }

  function lessonHTML(g) {
    const tg = (k, label) => `<button type="button" class="chip" data-tg="${k}" aria-pressed="${!!opt[k]}">${label}</button>`;
    return `<div class="jp-card jp-gram">` +
      `<div class="jp-row"><button type="button" class="btn ghost sm" data-k="back">← Übersicht</button><span class="jp-grow"></span><span class="jp-glevel">${esc(g.level)}</span></div>` +
      `<h3 class="jp-h3 jp-gtitle">${g.emoji} ${esc(g.title)} <small class="jp-ja">${esc(g.short)}</small></h3>` +
      g.explain.map((t) => `<p class="jp-gp">${esc(t)}</p>`).join("") +
      `<table class="jp-gtable">${g.table.map(([a, b]) => `<tr><td class="jp-ja">${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}</table>` +
    `</div>` +
    `<div class="jp-card">` +
      `<div class="jp-row jp-wrap"><h3 class="jp-h3 jp-grow">🗣️ Beispiele <small class="jp-muted">antippen = anhören</small></h3></div>` +
      `<div class="chips">${tg("furi", "あ Furigana")}${tg("ro", "Aa Romaji")}${tg("de", "🇩🇪 Deutsch")}</div>` +
      `<div class="jp-lines">` + examples(g).map((x, i) =>
        `<button type="button" class="jp-line" data-ex="${i}"><span class="jp-lt"><span class="jp-ja jp-ltja">${furi(x.ja)}</span>` +
        (opt.ro ? `<small class="jp-lro">${esc(x.ro)}</small>` : "") + (opt.de ? `<small class="jp-lde">${esc(x.de)}</small>` : "") + `</span></button>`).join("") +
      `</div>` +
    `</div>` +
    `<div class="jp-card jp-gquiz" aria-live="polite">${quizHTML(g)}</div>`;
  }

  /* ---- Mini-Quiz ---- */
  function startQuiz(g) {
    const list = g.ex.map((e) => {
      if (e.t === "build") { const p = parseJa(e.src); const words = p.tokens.filter((x) => !x.punct).map((x) => x.r); return { ...e, words, tiles: shuffle(words.map((w, i) => ({ w, i }))), built: [] }; }
      return { ...e, opts: shuffle(e.opts) };
    });
    quiz = { g: g.id, list, i: 0, sel: null, checked: null, right: 0 };
  }
  function quizHTML(g) {
    if (!quiz || quiz.g !== g.id) return `<h3 class="jp-h3">✏️ Kurz üben</h3><p class="jp-muted">${g.ex.length} kleine Aufgaben zu dieser Lektion.</p>` +
      `<div class="jp-row jp-full"><button type="button" class="btn primary" data-k="quiz">▶️ Los geht's</button></div>`;
    if (quiz.i >= quiz.list.length) {
      const all = quiz.right === quiz.list.length;
      return `<div class="jp-center"><div class="jp-gbig" aria-hidden="true">${all ? "🎉" : "💪"}</div><h3 class="jp-h3">${quiz.right} von ${quiz.list.length} richtig</h3>` +
        `<p class="jp-muted">${all ? "すごい！ Perfekt gemacht." : "Gut gemacht – im Lernpfad kommt die Lektion nochmal dran."}</p>` +
        `<div class="jp-row jp-full jp-mt"><button type="button" class="btn ghost" data-k="quiz">🔁 Nochmal</button><button type="button" class="btn primary" data-k="back">Weiter ✓</button></div></div>`;
    }
    const e = quiz.list[quiz.i];
    const c = quiz.checked;
    let body = "";
    if (e.t === "mc") body = `<p class="jp-muted">Was passt in die Lücke?</p><div class="jp-gs jp-ja">${esc(e.s).replace("＿", `<span class="jp-gap">${c ? esc(e.a) : "＿"}</span>`)}</div><p class="jp-lde">${esc(e.de)}</p>`;
    else if (e.t === "pick") body = `<p class="jp-muted">Was bedeutet der Satz?</p><div class="jp-gs jp-ja">${esc(e.s)}</div>`;
    else if (e.t === "pickja") body = `<p class="jp-muted">Wie sagt man …</p><div class="jp-gs">„${esc(e.de)}“</div>`;
    else body = `<p class="jp-muted">Bau den Satz: „${esc(e.de)}“ 🧩</p><div class="jp-gbuilt jp-ja">${e.built.length ? e.built.map((k, j) => `<button type="button" class="jp-gtile" data-unb="${j}" ${c ? "disabled" : ""}>${esc(e.tiles[k].w)}</button>`).join("") : `<span class="jp-muted">Tipp die Kacheln an 👇</span>`}</div>` +
      `<div class="jp-gbank jp-ja">${e.tiles.map((t, k) => `<button type="button" class="jp-gtile" data-b="${k}" ${e.built.includes(k) || c ? "disabled" : ""}>${esc(t.w)}</button>`).join("")}</div>`;
    const opts = e.t === "build" ? "" : `<div class="jp-gopts${e.t === "mc" ? "" : " long"}">` + e.opts.map((o, k) => {
      const st = c ? (o === e.a ? " ok" : o === quiz.sel ? " no" : "") : quiz.sel === o ? " sel" : "";
      return `<button type="button" class="jp-gopt${st}${e.t === "pick" ? "" : " jp-ja"}" data-o="${k}" ${c ? "disabled" : ""}>${esc(o)}</button>`;
    }).join("") + `</div>`;
    const solution = e.t === "build" ? e.words.join("") : e.t === "mc" ? e.s.replace("＿", e.a) : e.a;
    const fb = c ? `<div class="jp-gfb ${c.ok ? "ok" : "no"}"><b>${c.ok ? "✔️ Richtig!" : "✖️ Nicht ganz"}</b>` +
      (!c.ok ? `<span>Richtig: <b class="jp-ja">${esc(solution)}</b></span>` : "") + `<small>${esc(e.ro)}${e.t !== "pickja" && e.de ? " · " + esc(e.de) : ""}</small></div>` : "";
    const can = e.t === "build" ? e.built.length > 0 : quiz.sel != null;
    return `<div class="jp-row"><h3 class="jp-h3 jp-grow">✏️ Aufgabe ${quiz.i + 1} / ${quiz.list.length}</h3><span class="jp-muted">✔️ ${quiz.right}</span></div>` +
      body + opts + fb +
      `<div class="jp-row jp-full">${c ? `<button type="button" class="btn primary" data-k="next">Weiter →</button>` : `<button type="button" class="btn primary" data-k="check" ${can ? "" : "disabled"}>Prüfen</button>`}</div>`;
  }
  function check() {
    const e = quiz.list[quiz.i];
    let ok;
    if (e.t === "build") ok = e.built.map((k) => e.tiles[k].w).join("") === e.words.join("");
    else ok = quiz.sel === e.a;
    quiz.checked = { ok };
    if (ok) quiz.right++;
    J.count("gram", ok);
    const say = e.t === "build" ? e.words.join("") : e.t === "mc" ? e.s.replace("＿", e.a) : e.t === "pickja" ? e.a : e.s;
    J.speak(say);
  }

  function render() {
    if (!page) return;
    const g = GRAMMAR.find((x) => x.id === opt.open);
    page.innerHTML = `<div class="jp-grammar">${g ? lessonHTML(g) : listHTML()}</div>`;
  }
  function renderQuiz() {
    const g = GRAMMAR.find((x) => x.id === opt.open);
    const box = page && page.querySelector(".jp-gquiz");
    if (g && box) box.innerHTML = quizHTML(g); else render();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !page || !page.contains(t)) return;
    const g = GRAMMAR.find((x) => x.id === opt.open);
    if (t.dataset.open) { opt.open = t.dataset.open; quiz = null; save(); render(); window.scrollTo(0, 0); return; }
    if (t.dataset.tg) { opt[t.dataset.tg] = !opt[t.dataset.tg]; save(); render(); return; }
    if (t.dataset.ex != null && g) {
      const x = examples(g)[Number(t.dataset.ex)];
      page.querySelectorAll(".jp-line.on").forEach((b) => b.classList.remove("on"));
      t.classList.add("on");
      J.speak(x.kana).then(() => t.classList.remove("on"));
      return;
    }
    if (!g) return;
    if (quiz && t.dataset.o != null && !quiz.checked) { quiz.sel = quiz.list[quiz.i].opts[Number(t.dataset.o)]; renderQuiz(); return; }
    if (quiz && t.dataset.b != null && !quiz.checked) { quiz.list[quiz.i].built.push(Number(t.dataset.b)); renderQuiz(); return; }
    if (quiz && t.dataset.unb != null && !quiz.checked) { quiz.list[quiz.i].built.splice(Number(t.dataset.unb), 1); renderQuiz(); return; }
    const k = t.dataset.k;
    if (k === "back") {
      if (quiz && quiz.g === g.id && quiz.i >= quiz.list.length && !opt.done.includes(g.id)) { opt.done.push(g.id); J.ui.toast("📐 Lektion geschafft – よくできました！"); }
      opt.open = null; quiz = null; save(); render(); window.scrollTo(0, 0);
    } else if (k === "quiz") { startQuiz(g); renderQuiz(); }
    else if (k === "check" && quiz) { check(); renderQuiz(); }
    else if (k === "next" && quiz) { quiz.i++; quiz.sel = null; quiz.checked = null; renderQuiz(); }
  }
  return {
    show(el) { page = el; page.addEventListener("click", onClick); render(); },
    hide() { if (page) page.removeEventListener("click", onClick); page = null; },
  };
}
