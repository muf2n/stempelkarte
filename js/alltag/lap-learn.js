// Alltag › LAP › 🃏 Lernkarten: Karteikarten mit Wiederholung (SM-2 aus ./srs-core.js), Themenauswahl, Suche.
// Lehrjahr: neue Karten nur aus dem gewählten Jahr, Wiederholungen auch aus den Jahren davor. Eigene Karten (📷/✍️) lernen mit.
import { TOPICS, NORM_NOTE, topicOf } from "./lap-data.js";
import { buildQueue, review, GRADES, isLearned, shuffle } from "./srs-core.js";
import { learnPools, filterYear, normYear } from "./lap-core.js";

const TOPIC_KEY = "sk-lap-topics";
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
const ivText = (d) => (d <= 0 ? "heute" : d === 1 ? "1 Tag" : d < 30 ? `${d} Tage` : d < 365 ? `${Math.round(d / 30)} Mon.` : "1 Jahr");

export function createLearn(L) {
  const { esc } = L;
  let page = null;
  let view = "home"; // home | review | list | done
  let topics = lsGet(TOPIC_KEY);
  if (!Array.isArray(topics) || !topics.length) topics = TOPICS.map((t) => t.id);
  let sess = null; // { queue, i, flipped, right, total }
  let search = "";

  const yearCards = () => filterYear(L.allCards(), L.year(), "exact");
  const freshToday = () => ((L.stats().days || {})[L.today()] || {}).fresh || 0;
  function queue() {
    const p = learnPools(L.allCards().filter((c) => topics.includes(c.topic)), L.year());
    const opts = { newLimit: L.stats().newPerDay || 10, newToday: freshToday() };
    return { due: buildQueue(p.review, L.cards(), L.today(), opts).due, fresh: buildQueue(p.fresh, L.cards(), L.today(), opts).fresh };
  }
  const yLabel = () => (normYear(L.year()) ? `${normYear(L.year())}. Lj.` : "");

  const normNote = (ids) => (ids.some((id) => (topicOf(id) || {}).norm) ? `<p class="lap-norm">${esc(NORM_NOTE)}</p>` : "");

  function homeHTML() {
    const q = queue();
    const cards = L.cards();
    const weak = L.weak();
    const all = yearCards();
    const learnedAll = all.filter((c) => isLearned(cards.get(c.id))).length;
    const total = q.due.length + q.fresh.length;
    const newPer = L.stats().newPerDay || 10;
    return `<div class="lap-card lap-hero">` +
        `<div class="lap-big"><b>${q.due.length}</b><span>heute fällig</span></div>` +
        `<div class="lap-big soft"><b>${q.fresh.length}</b><span>neue Karten</span></div>` +
        `<div class="lap-big soft"><b>${learnedAll}<i>/${all.length}</i></b><span>gelernt${yLabel() ? " · " + yLabel() : ""}</span></div>` +
        `<div class="lap-row lap-full lap-span">` +
          `<button type="button" class="btn primary" data-k="start" ${total ? "" : "disabled"}>${total ? `▶️ Lernen (${total})` : "🎉 Alles erledigt für heute"}</button>` +
        `</div>` +
      `</div>` +
      `<div class="lap-card">` +
        `<div class="lap-row"><h3 class="lap-h3">📚 Themen</h3><span class="lap-grow"></span>` +
          `<button type="button" class="lap-link" data-k="all">${topics.length === TOPICS.length ? "keins" : "alle"}</button></div>` +
        `<div class="lap-topics">` + TOPICS.map((t) => {
          const list = all.filter((c) => c.topic === t.id);
          const done = list.filter((c) => isLearned(cards.get(c.id))).length;
          const pct = list.length ? Math.round((done / list.length) * 100) : 0;
          const isWeak = weak.includes(t.id);
          return `<button type="button" class="lap-topic${isWeak ? " weak" : ""}${list.length ? "" : " empty"}" data-topic="${t.id}" aria-pressed="${topics.includes(t.id)}">` +
            `<span class="lap-topic-e" aria-hidden="true">${t.emoji}</span><span class="lap-topic-n">${esc(t.name)}${isWeak ? ` <em>💪 üben</em>` : ""}${t.norm ? ` <em class="lap-tag-norm" title="Normwerte mit Berufsschul-Unterlagen abgleichen">📚</em>` : ""}</span>` +
            `<small>${list.length ? `${done}/${list.length}` : "–"}</small><span class="lap-bar"><span style="width:${pct}%"></span></span></button>`;
        }).join("") + `</div>` +
        `<div class="lap-row lap-mt lap-wrap"><button type="button" class="btn ghost sm" data-k="list">🔎 Alle Karten ansehen</button></div>` +
      `</div>` +
      `<div class="lap-card">` +
        `<h3 class="lap-h3">⚙️ Dein Tempo</h3>` +
        `<p class="lap-muted">Neue Karten pro Tag – fällige Wiederholungen kommen immer dazu.</p>` +
        `<div class="lap-seg" role="group" aria-label="Neue Karten pro Tag">` +
          [5, 10, 20].map((n) => `<button type="button" data-new="${n}" aria-pressed="${newPer === n}">${n}</button>`).join("") +
        `</div>` +
      `</div>`;
  }

  function reviewHTML() {
    const it = sess.queue[sess.i];
    const tp = topicOf(it.topic);
    const cur = L.cards().get(it.id);
    const pct = Math.round((sess.i / sess.queue.length) * 100);
    const prev = (q) => review(cur, q, L.today()).interval;
    return `<div class="lap-card lap-flash">` +
      `<div class="lap-row"><button type="button" class="btn ghost sm" data-k="home">← Zurück</button><span class="lap-grow"></span>` +
        `<span class="lap-muted">${sess.i + 1} / ${sess.queue.length}</span></div>` +
      `<span class="lap-bar lap-bar-q"><span style="width:${pct}%"></span></span>` +
      `<div class="lap-front"><span class="lap-pill">${tp.emoji} ${esc(tp.name)}${cur && cur.seen ? "" : " · neu ✨"}</span>${it.own ? `<span class="lap-pill soft">${it.source === "foto" ? "📷" : "✍️"} eigene Karte</span>` : ""}` +
        `<p class="lap-q">${esc(it.q)}</p></div>` +
      (sess.flipped
        ? `<div class="lap-back"><p class="lap-a">✅ ${esc(it.a)}</p>${it.e ? `<p class="lap-e">💡 ${esc(it.e)}</p>` : ""}${normNote([it.topic])}` +
            L.explain.html("c-" + it.id, { topic: tp.name, q: it.q, a: it.a, e: it.e }) + `</div>` +
          `<p class="lap-muted lap-center">Wie gut hast du's gewusst?</p>` +
          `<div class="lap-grades">` + GRADES.map((g) => `<button type="button" class="lap-grade g${g.q}" data-q="${g.q}"><span>${g.emoji} ${g.label}</span><small>${ivText(prev(g.q))}</small></button>`).join("") + `</div>`
        : `<button type="button" class="btn primary lap-full" data-k="flip">👀 Antwort zeigen</button>`) +
    `</div>`;
  }

  function doneHTML() {
    return `<div class="lap-card lap-center">` +
      `<div class="lap-emoji" aria-hidden="true">🎉</div>` +
      `<h3 class="lap-h3">Runde geschafft!</h3>` +
      `<p class="lap-muted">${sess.right} von ${sess.total} Karten gewusst. Weiter so – Wiederholung macht den Meister 💪</p>` +
      `<div class="lap-row lap-wrap lap-centerrow"><button type="button" class="btn primary" data-k="home">Zur Übersicht</button>` +
      `<button type="button" class="btn ghost" data-k="toexam">📝 Prüfung probieren</button></div>` +
    `</div>`;
  }

  function listHTML() {
    const s = search.trim().toLowerCase();
    const list = yearCards().filter((c) => topics.includes(c.topic) && (!s || (c.q + " " + c.a + " " + c.e).toLowerCase().includes(s)));
    const cards = L.cards();
    return `<div class="lap-card">` +
      `<div class="lap-row"><button type="button" class="btn ghost sm" data-k="home">← Zurück</button><span class="lap-grow"></span><span class="lap-muted">${list.length} Karten</span></div>` +
      `<input type="search" class="lap-search" placeholder="🔎 Suchen, z. B. FI, Stern, IP44 …" aria-label="Karten durchsuchen" value="${esc(search)}">` +
      normNote([...new Set(list.map((c) => c.topic))]) +
    `</div>` +
    `<div class="lap-list">` + (list.length ? list.map((c) => {
      const tp = topicOf(c.topic);
      return `<details class="lap-item"><summary><span class="lap-dot${isLearned(cards.get(c.id)) ? " ok" : ""}" aria-hidden="true"></span><span>${tp.emoji} ${esc(c.q)}</span>${c.own ? `<em class="lap-owntag">${c.source === "foto" ? "📷" : "✍️"} eigene</em>` : ""}</summary>` +
        `<p class="lap-a">✅ ${esc(c.a)}</p>${c.e ? `<p class="lap-e">💡 ${esc(c.e)}</p>` : ""}` +
        L.explain.html("c-" + c.id, { topic: tp.name, q: c.q, a: c.a, e: c.e }) + `</details>`;
    }).join("") : `<p class="lap-muted lap-center">Nix gefunden 🤔 – probier ein anderes Wort.</p>`) + `</div>`;
  }

  function render() {
    if (!page) return;
    page.innerHTML = `<div>${view === "review" && sess ? reviewHTML() : view === "done" && sess ? doneHTML() : view === "list" ? listHTML() : homeHTML()}</div>`;
  }

  function start() {
    const q = queue();
    const list = [...q.due, ...shuffle(q.fresh)];
    if (!list.length) return;
    sess = { queue: list, i: 0, flipped: false, right: 0, total: list.length, again: new Set() };
    view = "review"; render();
  }

  async function grade(q) {
    const it = sess.queue[sess.i];
    const wasNew = !((L.cards().get(it.id) || {}).seen > 0);
    await L.grade(it.id, q);
    if (wasNew) L.count("fresh"); // zählt nur „neu heute“ (nicht fürs Tagesziel)
    L.count("cards", q >= 3);
    if (q >= 3 && !sess.again.has(it.id)) sess.right++;
    if (q < 3) { sess.again.add(it.id); sess.queue.push(it); } // heute nochmal (am Ende der Runde)
    sess.i++; sess.flipped = false;
    if (sess.i >= sess.queue.length) view = "done";
    render();
  }

  function onClick(ev) {
    if (!page) return;
    if (L.explain.click(ev)) return;
    const t = ev.target.closest("button");
    if (!t || !page.contains(t)) return;
    if (t.dataset.topic) {
      const id = t.dataset.topic;
      topics = topics.includes(id) ? topics.filter((x) => x !== id) : [...topics, id];
      lsSet(TOPIC_KEY, topics); render(); return;
    }
    if (t.dataset.new) { L.setNewPerDay(Number(t.dataset.new)); render(); return; }
    if (t.dataset.q) { grade(Number(t.dataset.q)); return; }
    const k = t.dataset.k;
    if (k === "start") start();
    else if (k === "flip") { sess.flipped = true; render(); const g = page.querySelector(".lap-grade.g4"); if (g) g.focus({ preventScroll: true }); }
    else if (k === "home") { view = "home"; sess = null; render(); }
    else if (k === "list") { view = "list"; render(); }
    else if (k === "all") { topics = topics.length === TOPICS.length ? [] : TOPICS.map((x) => x.id); lsSet(TOPIC_KEY, topics); render(); }
    else if (k === "toexam") L.go("pruefung");
  }
  let searchTimer = null;
  function onInput(ev) {
    if (!ev.target.classList.contains("lap-search")) return;
    search = ev.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (!page) return;
      const pos = ev.target.selectionStart;
      render();
      const inp = page.querySelector(".lap-search");
      if (inp) { inp.focus({ preventScroll: true }); try { inp.setSelectionRange(pos, pos); } catch { /* egal */ } }
    }, 180);
  }
  function onKey(ev) {
    if (view !== "review" || !sess || ev.target.matches("input, textarea")) return;
    if (!sess.flipped && (ev.key === " " || ev.key === "Enter")) { ev.preventDefault(); sess.flipped = true; render(); }
    else if (sess.flipped && ["1", "2", "3", "4"].includes(ev.key)) { ev.preventDefault(); grade(GRADES[Number(ev.key) - 1].q); }
  }

  return {
    show(el, opts) {
      page = el;
      if (opts && opts.topic && TOPICS.some((t) => t.id === opts.topic)) { topics = [opts.topic]; lsSet(TOPIC_KEY, topics); view = "home"; sess = null; }
      page.addEventListener("click", onClick); page.addEventListener("input", onInput); document.addEventListener("keydown", onKey);
      render();
    },
    hide() {
      if (page) { page.removeEventListener("click", onClick); page.removeEventListener("input", onInput); }
      document.removeEventListener("keydown", onKey);
      clearTimeout(searchTimer);
      page = null;
    },
    onData() { if (page && view === "home") render(); },
    onYear() { if (page && view !== "review") { if (view === "done") { view = "home"; sess = null; } render(); } },
  };
}
