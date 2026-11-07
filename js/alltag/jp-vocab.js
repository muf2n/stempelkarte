// Alltag › Japanisch › 🃏 Vokabeln: Karteikarten mit Wiederholung (SM-2), Themen, eigene Wörter, Tagesziel.
import { TOPIC_LIST } from "./jp-data.js";
import { buildQueue, review, GRADES, kanaToRomaji, isLearned, shuffle } from "./jp-core.js";

const TOPIC_KEY = "sk-jp-topics";
const DIR_KEY = "sk-jp-dir";
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
const ivText = (d) => (d <= 0 ? "heute" : d === 1 ? "1 Tag" : d < 30 ? `${d} Tage` : d < 365 ? `${Math.round(d / 30)} Mon.` : "1 Jahr");

export function createVocab(J) {
  const { esc, ui } = J;
  let page = null;
  let view = "home"; // home | review | list | done
  let topics = lsGet(TOPIC_KEY);
  const allTopics = [...TOPIC_LIST.map((t) => t.topic), "Eigene Wörter"];
  if (!Array.isArray(topics)) topics = allTopics.slice();
  let dir = lsGet(DIR_KEY) === "de" ? "de" : "ja";
  let sess = null; // { queue:[item], i, flipped, done, right, reps:{id:n} }
  let search = "";

  const pool = () => J.items().filter((it) => topics.includes(it.topic));
  const freshToday = () => ((J.stats().days || {})[J.today()] || {}).fresh || 0;
  function queue() {
    return buildQueue(pool(), J.cards(), J.today(), { newLimit: J.stats().newPerDay || 10, newToday: freshToday() });
  }

  function homeHTML() {
    const q = queue();
    const all = J.items();
    const cards = J.cards();
    const goal = J.stats().goal || 20;
    const newPer = J.stats().newPerDay || 10;
    const learnedAll = all.filter((it) => isLearned(cards.get(it.id))).length;
    const total = q.due.length + q.fresh.length;
    const emojiOf = (t) => (TOPIC_LIST.find((x) => x.topic === t) || { emoji: "⭐" }).emoji;
    const countOf = (t) => all.filter((x) => x.topic === t).length;
    return `<div class="jp-card jp-hero">` +
        `<div class="jp-duebig"><b>${q.due.length}</b><span>Heute fällig</span></div>` +
        `<div class="jp-duebig soft"><b>${q.fresh.length}</b><span>neue Wörter</span></div>` +
        `<div class="jp-duebig soft"><b>${learnedAll}<i>/${all.length}</i></b><span>gelernt</span></div>` +
        `<div class="jp-row jp-mt jp-full">` +
          `<button type="button" class="btn primary" data-k="start" ${total ? "" : "disabled"}>${total ? `▶️ Lernen (${total})` : "🎉 Alles erledigt für heute"}</button>` +
        `</div>` +
        `<div class="jp-seg jp-mt" role="group" aria-label="Richtung">` +
          `<button type="button" data-dir="ja" aria-pressed="${dir === "ja"}">🇯🇵 → 🇩🇪</button>` +
          `<button type="button" data-dir="de" aria-pressed="${dir === "de"}">🇩🇪 → 🇯🇵</button>` +
        `</div>` +
      `</div>` +
      `<div class="jp-card">` +
        `<h3 class="jp-h3">📚 Themen</h3>` +
        `<div class="chips">` + allTopics.filter((t) => countOf(t) > 0 || t !== "Eigene Wörter").map((t) =>
          `<button type="button" class="chip" data-topic="${esc(t)}" aria-pressed="${topics.includes(t)}">${emojiOf(t)} ${esc(t)} <small>${countOf(t)}</small></button>`).join("") + `</div>` +
        `<div class="jp-row jp-mt jp-wrap">` +
          `<button type="button" class="btn ghost sm" data-k="add">➕ Eigenes Wort</button>` +
          `<button type="button" class="btn ghost sm" data-k="list">🔎 Alle Wörter</button>` +
        `</div>` +
      `</div>` +
      `<div class="jp-card">` +
        `<h3 class="jp-h3">⚙️ Dein Tempo</h3>` +
        `<label class="jp-lbl">Tagesziel (Übungen)</label>` +
        `<div class="jp-seg" role="group" aria-label="Tagesziel">${[10, 20, 30, 50].map((v) => `<button type="button" data-goal="${v}" aria-pressed="${goal === v}">${v}</button>`).join("")}</div>` +
        `<label class="jp-lbl">Neue Wörter pro Tag</label>` +
        `<div class="jp-seg" role="group" aria-label="Neue Wörter pro Tag">${[5, 10, 15, 20].map((v) => `<button type="button" data-new="${v}" aria-pressed="${newPer === v}">${v}</button>`).join("")}</div>` +
        `<p class="jp-muted">Jede Übung in allen Bereichen zählt fürs Tagesziel 🎯 und deine Serie 🔥.</p>` +
      `</div>`;
  }

  function startSession() {
    const q = queue();
    sess = { queue: [...q.due, ...shuffle(q.fresh)], i: 0, flipped: false, right: 0, n: 0, reps: {} };
    view = sess.queue.length ? "review" : "home";
    render();
  }

  function faceJa(it, big) {
    const main = it.kanji || it.kana;
    const sz = big ? (main.length > 11 ? " xl4" : main.length > 8 ? " xl3" : main.length > 6 ? " xl2" : "") : "";
    return `<div class="jp-ja ${big ? "jp-cardkana" : ""}${sz}">${esc(main)}</div>` +
      (it.kanji ? `<div class="jp-ja jp-sub">${esc(it.kana)}</div>` : "");
  }
  function reviewHTML() {
    const it = sess.queue[sess.i];
    const card = J.card(it.id);
    const isNew = !card || !card.seen;
    const prog = Math.round((sess.i / sess.queue.length) * 100);
    const front = dir === "ja" ? faceJa(it, true) : `<div class="jp-cardde">${esc(it.de)}</div>`;
    let back = "";
    if (sess.flipped) {
      back = `<div class="jp-back">` +
        (dir === "ja" ? `<div class="jp-cardde">${esc(it.de)}</div>` : faceJa(it, true)) +
        `<div class="jp-roma">${esc(it.romaji || kanaToRomaji(it.kana))}</div>` +
      `</div>` +
      `<div class="jp-grades">` + GRADES.map((g) => {
        const nx = review(card || {}, g.q, J.today());
        return `<button type="button" class="jp-grade g${g.q}" data-q="${g.q}"><span class="jp-gem" aria-hidden="true">${g.emoji}</span><span>${g.label}</span><small>${ivText(nx.interval)}</small></button>`;
      }).join("") + `</div>`;
    }
    return `<div class="jp-card jp-flash">` +
      `<div class="jp-row"><span class="jp-muted">${sess.i + 1}/${sess.queue.length} · ${esc(it.emoji || "")} ${esc(it.topic)}${isNew ? ` · <b class="jp-new">✨ neu</b>` : ""}</span><span class="jp-grow"></span>` +
        `<button type="button" class="btn ghost sm" data-say="${esc(it.kana)}" aria-label="Vorlesen">🔊</button>` +
        `<button type="button" class="btn ghost sm" data-k="home">✕</button></div>` +
      `<div class="jp-bar jp-bar-q"><span style="width:${prog}%"></span></div>` +
      `<div class="jp-front">${front}</div>` +
      (sess.flipped ? back : `<button type="button" class="btn primary jp-flip" data-k="flip">🔄 Umdrehen</button>`) +
    `</div>`;
  }
  function doneHTML() {
    return `<div class="jp-card jp-center"><div class="jp-score">🎉</div>` +
      `<p><b>${sess.n}</b> Wiederholungen, davon <b>${sess.right}</b> gewusst. お疲れさま！ (otsukaresama!)</p>` +
      `<div class="jp-row jp-mt"><button type="button" class="btn primary" data-k="home">Zurück</button></div></div>`;
  }
  function listHTML() {
    const s = search.trim().toLowerCase();
    const cards = J.cards();
    const items = J.items().filter((it) => !s || [it.kana, it.kanji, it.romaji, it.de, it.topic].some((x) => String(x || "").toLowerCase().includes(s)));
    const rows = items.slice(0, 250).map((it) => {
      const c = cards.get(it.id);
      const st = !c || !c.seen ? "" : isLearned(c) ? "✅" : "🔁";
      return `<li class="jp-li"><button type="button" class="jp-li-say" data-say="${esc(it.kana)}" aria-label="Vorlesen">🔊</button>` +
        `<span class="jp-li-ja"><span class="jp-ja">${esc(it.kanji || it.kana)}</span>${it.kanji ? ` <small class="jp-ja">${esc(it.kana)}</small>` : ""}<small>${esc(it.romaji)}</small></span>` +
        `<span class="jp-li-de">${esc(it.de)}</span><span class="jp-li-st" aria-hidden="true">${st}</span>` +
        (it.own ? `<button type="button" class="btn ghost sm" data-del="${esc(it.id)}" aria-label="${esc(it.de)} löschen">🗑️</button>` : "") +
      `</li>`;
    }).join("");
    return `<div class="jp-card">` +
      `<div class="jp-row"><button type="button" class="btn ghost sm" data-k="home">← Zurück</button><span class="jp-grow"></span><button type="button" class="btn ghost sm" data-k="add">➕ Eigenes Wort</button></div>` +
      `<input type="search" class="jp-search jp-mt" placeholder="Suchen: Kana, Romaji oder Deutsch …" value="${esc(search)}" aria-label="Wörter suchen">` +
      `<ul class="jp-list">${rows || `<li class="jp-muted">Nix gefunden 🤔</li>`}</ul>` +
    `</div>`;
  }

  function render() {
    if (!page) return;
    const keepFocus = document.activeElement && document.activeElement.classList.contains("jp-search");
    page.innerHTML = `<div class="jp-vocab">${view === "review" ? reviewHTML() : view === "done" ? doneHTML() : view === "list" ? listHTML() : homeHTML()}</div>`;
    if (keepFocus) { const i = page.querySelector(".jp-search"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  async function grade(q) {
    const it = sess.queue[sess.i];
    const before = J.card(it.id);
    const fresh = !before || !before.seen;
    await J.grade(it.id, q, it.own ? { kind: "own" } : { kind: "vocab" });
    if (fresh) J.count("fresh");
    J.count("cards", q >= 3);
    sess.n++; if (q >= 3) sess.right++;
    sess.reps[it.id] = (sess.reps[it.id] || 0) + 1;
    if (q < 3 && sess.reps[it.id] < 4) sess.queue.push(it); // gleich nochmal üben
    sess.i++; sess.flipped = false;
    if (sess.i >= sess.queue.length) view = "done";
    render();
  }

  function addWord() {
    ui.openSheet({
      title: "➕ Eigenes Wort",
      bodyHTML: `<form class="fields jp-addform" autocomplete="off">` +
        `<label>Kana (Hiragana/Katakana) *<input name="kana" required lang="ja" placeholder="z. B. ねじ"></label>` +
        `<label>Kanji (optional)<input name="kanji" lang="ja" placeholder="z. B. 螺子"></label>` +
        `<label>Romaji (leer = automatisch)<input name="romaji" autocapitalize="off" placeholder="z. B. neji"></label>` +
        `<label>Deutsch *<input name="de" required placeholder="z. B. Schraube"></label>` +
        `<div class="row"><button type="submit" class="btn primary">Speichern 💾</button></div>` +
      `</form>`,
      onMount(el, close) {
        const f = el.querySelector("form");
        f.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const v = (n) => String(f.elements[n].value || "").trim().slice(0, 80);
          const kana = v("kana"), de = v("de");
          if (!kana || !de) return;
          if (!/[぀-ヿ]/.test(kana)) { ui.toast("Bitte die Lesung in Kana eingeben (z. B. ねじ) 🙂"); return; }
          await J.putOwn({ kana, kanji: v("kanji"), romaji: v("romaji") || kanaToRomaji(kana), de, topic: "Eigene Wörter" });
          if (!topics.includes("Eigene Wörter")) { topics.push("Eigene Wörter"); lsSet(TOPIC_KEY, topics); }
          ui.toast("⭐ Wort gespeichert – kommt bei den neuen Wörtern dran");
          close();
          render();
        });
      },
    });
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !page || !page.contains(t)) return;
    if (t.dataset.say) { J.speak(t.dataset.say); return; }
    if (t.dataset.q) { grade(Number(t.dataset.q)); return; }
    if (t.dataset.topic) {
      const x = t.dataset.topic;
      topics = topics.includes(x) ? topics.filter((y) => y !== x) : [...topics, x];
      lsSet(TOPIC_KEY, topics); render(); return;
    }
    if (t.dataset.dir) { dir = t.dataset.dir; lsSet(DIR_KEY, dir); render(); return; }
    if (t.dataset.goal) { J.setGoal(Number(t.dataset.goal), 0); render(); return; }
    if (t.dataset.new) { J.setGoal(0, Number(t.dataset.new)); render(); return; }
    if (t.dataset.del) {
      if (t.dataset.armed) { J.removeOwn(t.dataset.del).then(() => { ui.toast("Gelöscht"); render(); }); return; }
      t.dataset.armed = "1"; t.textContent = "Wirklich?"; return;
    }
    const k = t.dataset.k;
    if (k === "start") startSession();
    else if (k === "flip") { sess.flipped = true; render(); if (dir === "de") J.speak(sess.queue[sess.i].kana); }
    else if (k === "home") { view = "home"; render(); }
    else if (k === "list") { view = "list"; render(); }
    else if (k === "add") addWord();
  }
  function onInput(ev) { if (ev.target.classList.contains("jp-search")) { search = ev.target.value; render(); } }
  function onKey(ev) {
    if (view !== "review" || !page || ev.target.closest("input,textarea")) return;
    if (!sess.flipped && (ev.key === " " || ev.key === "Enter")) { ev.preventDefault(); sess.flipped = true; render(); }
    else if (sess.flipped && ["1", "2", "3", "4"].includes(ev.key)) grade(GRADES[Number(ev.key) - 1].q);
  }

  return {
    show(el) { page = el; page.addEventListener("click", onClick); page.addEventListener("input", onInput); document.addEventListener("keydown", onKey); if (view === "done") view = "home"; render(); },
    hide() { if (page) { page.removeEventListener("click", onClick); page.removeEventListener("input", onInput); } document.removeEventListener("keydown", onKey); page = null; },
    onData() { if (view === "home" || view === "list") render(); },
  };
}
