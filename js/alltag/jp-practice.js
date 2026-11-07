// Alltag › Japanisch › 👂 Hören und 🗣️ Sprechen.
// Hören: Wort/Satz per Sprachausgabe → Bedeutung wählen oder Gehörtes tippen (Kana oder Romaji).
// Sprechen: Wort/Satz anzeigen → nachsprechen (SpeechRecognition ja-JP) → Vergleich (jp-core.compareSpeech).
import { READINGS } from "./jp-data.js";
import { compareSpeech, meaningChoices, kanaToRomaji, shuffle } from "./jp-core.js";
import { srSupported, listenOnce, SR_ERRORS, ttsSupported, stopSpeaking } from "./jp-speech.js";

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

/** Sätze aus den Lesetexten als Übungsobjekte. */
export const SENTENCES = READINGS.flatMap((r) => r.lines.map((l, i) => ({
  id: `${r.id}_${i}`, sentence: true, topic: r.title, emoji: r.emoji,
  kanji: l.ja.map(([t]) => t).join(""),
  kana: l.ja.map(([t, rd]) => rd || t).join(""),
  romaji: l.ro, de: l.de,
})).filter((x) => x.kana.length <= 40));

function pickNext(list, lastId) {
  const c = shuffle(list).filter((x) => x.id !== lastId);
  return c[0] || list[0];
}

function rateSlider(J, esc) {
  const r = J.rate();
  return `<label class="jp-rate"><span>🐢</span><input type="range" min="0.5" max="1.3" step="0.1" value="${esc(String(r))}" data-k="rate" aria-label="Sprechtempo"><span>🐇</span><b>${String(r.toFixed(1)).replace(".", ",")}×</b></label>`;
}

/* ================= 👂 Hören ================= */
export function createListen(J) {
  const { esc } = J;
  let page = null;
  let what = lsGet("sk-jp-l-what") === "satz" ? "satz" : "wort";
  let how = lsGet("sk-jp-l-how") === "tippen" ? "tippen" : "waehlen";
  let cur = null; // { item, options, answered:{input, ok, close} }
  let tally = { n: 0, ok: 0 };

  const pool = () => (what === "satz" ? SENTENCES : J.items());
  function next() {
    const list = pool();
    const item = pickNext(list, cur && cur.item.id);
    cur = { item, options: how === "waehlen" ? meaningChoices(item, list) : null, answered: null };
    render();
    setTimeout(() => { if (page && cur && cur.item === item) J.speak(item.kanji || item.kana); }, 250);
  }

  function html() {
    const it = cur.item;
    const a = cur.answered;
    let body;
    if (how === "waehlen") {
      body = `<div class="jp-opts jp-opts-de">` + cur.options.map((o) => {
        let cls = "";
        if (a) { if (o === it.de) cls = " right"; else if (o === a.input) cls = " wrong"; }
        return `<button type="button" class="jp-opt${cls}" data-ans="${esc(o)}" ${a ? "disabled" : ""}>${esc(o)}</button>`;
      }).join("") + `</div>`;
    } else {
      body = `<form class="jp-typeform" data-k="form" autocomplete="off">` +
        `<input type="text" class="jp-typein" lang="ja" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Kana oder Romaji, z. B. みず / mizu" aria-label="Was hast du gehört?" ${a ? "disabled" : ""} value="${a ? esc(a.input) : ""}">` +
        `<button type="submit" class="btn primary" ${a ? "disabled" : ""}>Prüfen</button></form>`;
    }
    const reveal = a ? `<div class="jp-fb ${a.ok ? "ok" : "no"}"><div>${a.ok ? (a.close ? "🙂 Fast perfekt!" : "✅ Richtig!") : "❌ Leider nicht."}` +
        `<div class="jp-reveal"><span class="jp-ja">${esc(it.kanji || it.kana)}</span>${it.kanji && it.kanji !== it.kana ? ` <small class="jp-ja">${esc(it.kana)}</small>` : ""}` +
        `<small>${esc(it.romaji || kanaToRomaji(it.kana))} · ${esc(it.de)}</small></div></div>` +
        `<button type="button" class="btn primary sm" data-k="next">Weiter →</button></div>` : "";
    return `<div class="jp-card jp-listen">` +
      `<div class="jp-row jp-wrap">` +
        `<div class="jp-seg" role="group" aria-label="Was üben"><button type="button" data-what="wort" aria-pressed="${what === "wort"}">Wörter</button><button type="button" data-what="satz" aria-pressed="${what === "satz"}">Sätze</button></div>` +
        `<div class="jp-seg" role="group" aria-label="Antwort"><button type="button" data-how="waehlen" aria-pressed="${how === "waehlen"}">Bedeutung wählen</button><button type="button" data-how="tippen" aria-pressed="${how === "tippen"}">Tippen</button></div>` +
      `</div>` +
      rateSlider(J, esc) +
      `<div class="jp-ear">` +
        `<button type="button" class="jp-play" data-k="play" aria-label="Nochmal anhören">🔊</button>` +
        `<button type="button" class="btn ghost sm" data-k="slow">🐢 Langsam</button>` +
      `</div>` +
      `<p class="jp-muted jp-center">${how === "waehlen" ? "Was bedeutet das? 🤔" : "Schreib, was du hörst ✍️"}${tally.n ? ` · heute hier ${tally.ok}/${tally.n} ✅` : ""}</p>` +
      body + reveal +
    `</div>` +
    (ttsSupported() ? "" : `<p class="jp-muted">🔇 Ohne Sprachausgabe geht Hören leider nicht.</p>`);
  }

  function render() { if (!page) return; page.innerHTML = html(); if (how === "tippen" && !cur.answered) { const i = page.querySelector(".jp-typein"); if (i) i.focus({ preventScroll: true }); } }

  function answer(input) {
    if (!cur || cur.answered) return;
    const it = cur.item;
    let ok, close = false;
    if (how === "waehlen") ok = input === it.de;
    else { const r = compareSpeech(input, it); ok = r.result !== "wrong"; close = r.result === "close"; }
    cur.answered = { input, ok, close };
    tally.n++; if (ok) tally.ok++;
    J.count("listen", ok);
    if (!ok && !it.sentence) J.grade(it.id, 1, it.own ? { kind: "own" } : { kind: "vocab" }); // Fehler → kommt bald wieder dran
    render();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !page || !page.contains(t)) return;
    if (t.dataset.ans != null) { answer(t.dataset.ans); return; }
    if (t.dataset.what) { what = t.dataset.what; lsSet("sk-jp-l-what", what); next(); return; }
    if (t.dataset.how) { how = t.dataset.how; lsSet("sk-jp-l-how", how); next(); return; }
    const k = t.dataset.k;
    if (k === "play") J.speak(cur.item.kanji || cur.item.kana);
    else if (k === "slow") J.speak(cur.item.kanji || cur.item.kana, { rate: 0.55 });
    else if (k === "next") next();
  }
  function onSubmit(ev) { ev.preventDefault(); const i = page.querySelector(".jp-typein"); if (i && i.value.trim()) answer(i.value.trim()); }
  function onInput(ev) {
    if (ev.target.dataset.k === "rate") { J.setRate(Number(ev.target.value)); const b = ev.target.parentElement.querySelector("b"); if (b) b.textContent = Number(ev.target.value).toFixed(1).replace(".", ",") + "×"; }
  }
  function onChange(ev) { if (ev.target.dataset.k === "rate") J.speak(cur.item.kanji || cur.item.kana); }

  return {
    show(el) {
      page = el;
      page.addEventListener("click", onClick); page.addEventListener("submit", onSubmit);
      page.addEventListener("input", onInput); page.addEventListener("change", onChange);
      if (!cur) next(); else render();
    },
    hide() {
      if (page) { page.removeEventListener("click", onClick); page.removeEventListener("submit", onSubmit); page.removeEventListener("input", onInput); page.removeEventListener("change", onChange); }
      page = null;
    },
  };
}

/* ================= 🗣️ Sprechen ================= */
export function createSpeak(J) {
  const { esc } = J;
  let page = null;
  let what = lsGet("sk-jp-s-what") === "satz" ? "satz" : "wort";
  let cur = null;   // { item, state:"idle"|"listen"|"result", interim, res:{result, best}, tries }
  let rec = null;
  let tally = { n: 0, ok: 0 };

  const pool = () => (what === "satz" ? SENTENCES : J.items());
  function next() {
    stopRec();
    cur = { item: pickNext(pool(), cur && cur.item.id), state: "idle", interim: "", res: null, tries: 0 };
    render();
  }
  function stopRec() { if (rec) { try { rec.stop(); } catch { /* egal */ } rec = null; } }

  function html() {
    const it = cur.item;
    const can = srSupported();
    let status = "";
    if (cur.state === "listen") status = `<div class="jp-listening"><span class="jp-pulse" aria-hidden="true"></span>Hört zu … sag es auf Japanisch 👂${cur.interim ? `<div class="jp-ja jp-interim">${esc(cur.interim)}</div>` : ""}</div>`;
    else if (cur.state === "result" && cur.res) {
      const r = cur.res;
      const heard = r.best ? `<div class="jp-heard">Verstanden: <b class="jp-ja">${esc(r.best)}</b></div>` : "";
      status = r.error
        ? `<div class="jp-fb no"><div>${esc(SR_ERRORS[r.error] || "Das hat nicht geklappt – probier's nochmal 🙂")}</div></div>`
        : r.result === "ok" ? `<div class="jp-fb ok"><div>✅ Perfekt! すごい！${heard}</div></div>`
        : r.result === "close" ? `<div class="jp-fb ok"><div>🙂 Fast! Gut verständlich.${heard}</div></div>`
        : `<div class="jp-fb no"><div>❌ Noch nicht ganz – hör's dir nochmal an und probier's wieder.${heard}</div></div>`;
    }
    const mic = can
      ? `<button type="button" class="jp-mic${cur.state === "listen" ? " on" : ""}" data-k="${cur.state === "listen" ? "stop" : "mic"}" aria-label="${cur.state === "listen" ? "Stopp" : "Sprechen"}">${cur.state === "listen" ? "⏹️" : "🎙️"}</button>`
      : "";
    return `<div class="jp-card jp-speak">` +
      `<div class="jp-row jp-wrap"><div class="jp-seg" role="group" aria-label="Was üben"><button type="button" data-what="wort" aria-pressed="${what === "wort"}">Wörter</button><button type="button" data-what="satz" aria-pressed="${what === "satz"}">Sätze</button></div>` +
        `<span class="jp-grow"></span><span class="jp-muted">${tally.n ? `${tally.ok}/${tally.n} ✅` : ""}</span></div>` +
      `<div class="jp-target">` +
        `<div class="jp-ja jp-cardkana${it.sentence ? " jp-sentence" : (it.kanji || it.kana).length > 11 ? " xl4" : (it.kanji || it.kana).length > 8 ? " xl3" : (it.kanji || it.kana).length > 6 ? " xl2" : ""}">${esc(it.kanji || it.kana)}</div>` +
        (it.kanji && it.kanji !== it.kana ? `<div class="jp-ja jp-sub">${esc(it.kana)}</div>` : "") +
        `<div class="jp-roma">${esc(it.romaji || kanaToRomaji(it.kana))}</div>` +
        `<div class="jp-muted">${esc(it.de)}</div>` +
      `</div>` +
      `<div class="jp-ear">` +
        `<button type="button" class="btn ghost" data-k="play">🔊 Vorsprechen</button>` + mic +
      `</div>` +
      (can ? "" : `<p class="jp-hint">🎙️ Spracherkennung gibt's in diesem Browser leider nicht. In <b>Chrome am Android oder PC</b> kannst du hier sprechen und ich sag dir, ob's passt. Bis dahin: anhören, laut nachsprechen und selbst abhaken 🙂</p>` +
        `<div class="jp-row"><button type="button" class="btn ghost" data-k="self">✅ Hab's laut nachgesprochen</button></div>`) +
      status +
      `<div class="jp-row jp-mt"><span class="jp-grow"></span><button type="button" class="btn ${cur.state === "result" && cur.res && cur.res.result !== "wrong" ? "primary" : "ghost"} sm" data-k="next">Nächstes →</button></div>` +
    `</div>`;
  }
  function render() { if (page) page.innerHTML = html(); }

  async function startMic() {
    if (!cur || cur.state === "listen") return;
    stopSpeaking(); // nicht sich selbst zuhören
    const item = cur.item;
    cur.state = "listen"; cur.interim = ""; cur.res = null;
    render();
    rec = listenOnce({ onInterim: (t) => { if (cur && cur.item === item && cur.state === "listen") { cur.interim = t; const el = page && page.querySelector(".jp-interim"); if (el) el.textContent = t; else render(); } } });
    const out = await rec.done;
    rec = null;
    if (!cur || cur.item !== item) return;
    cur.tries++;
    if (!out.alts.length) {
      cur.state = "result"; cur.res = { error: out.error || "no-speech", best: "" };
      render(); return;
    }
    const r = compareSpeech(out.alts, item);
    cur.state = "result"; cur.res = r;
    tally.n++; const ok = r.result !== "wrong"; if (ok) tally.ok++;
    J.count("speak", ok);
    render();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !page || !page.contains(t)) return;
    if (t.dataset.what) { what = t.dataset.what; lsSet("sk-jp-s-what", what); next(); return; }
    const k = t.dataset.k;
    if (k === "play") J.speak(cur.item.kanji || cur.item.kana);
    else if (k === "mic") startMic();
    else if (k === "stop") stopRec();
    else if (k === "self") { tally.n++; tally.ok++; J.count("speak", true); J.ui.toast("👏 Brav! Weiter so"); next(); }
    else if (k === "next") next();
  }

  return {
    show(el) { page = el; page.addEventListener("click", onClick); if (!cur) next(); else { if (cur.state === "listen") cur.state = "idle"; render(); } },
    hide() { stopRec(); if (page) page.removeEventListener("click", onClick); page = null; },
    destroy() { stopRec(); },
  };
}
