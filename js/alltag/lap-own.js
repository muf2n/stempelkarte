// Alltag › LAP › ✍️ Eigene Karten: 📷 „Aus Foto lernen“ (Arbeitsblatt/Buchseite → Claude macht Lernkarten als JSON → du prüfst
// und bearbeitest jede Karte → ✅ Übernehmen) und die Verwaltung deiner eigenen Karten (selbst schreiben, bearbeiten, löschen).
// Gespeichert in lap_own { id:"<thema>-u…", topic, year, q, a, x:[] | [3 falsche], e, source:"foto"|"hand" } – das SRS läuft
// wie bei den fertigen Karten über lap_cards (gleiche id). Foto: verkleinert (≤ 1280 px), nur für diese eine Anfrage, nicht gespeichert.
import { TOPICS, YEARS, topicOf } from "./lap-data.js";
import { cleanOwnCard, parseCardJSON, photoPrompt, normYear, OWN_LIMITS } from "./lap-core.js";
import { askClaude, aiAvailable } from "./ai-client.js";
import { shrinkImage } from "./unterwegs-shared.js";

const TOPIC_IDS = TOPICS.map((t) => t.id);
const blank = (year) => ({ q: "", a: "", x: ["", "", ""], e: "", topic: "grund", year });
const draftOf = (c) => ({ q: c.q || "", a: c.a || "", x: [0, 1, 2].map((i) => (c.x && c.x[i]) || ""), e: c.e || "", topic: c.topic, year: normYear(c.year) || 1 });

export function createOwn(L) {
  const { esc } = L;
  let page = null;
  let view = "home"; // home | busy | review | edit
  let drafts = [];   // Entwürfe in review/edit
  let errs = {};     // index → Fehlertext
  let editId = null; // bearbeitete Karte (null = neu)
  let importYear = normYear(L.year()) || 1;
  let preview = "";  // verkleinertes Foto (nur Anzeige während Claude liest)
  let note = null;   // { kind:"err"|"ok", text }
  let dropped = 0;
  let ctrl = null;
  let armed = null;  // id, deren Löschen bestätigt werden muss

  const topicSel = (i, cur) => `<select data-i="${i}" data-f="topic" aria-label="Thema">${TOPICS.map((t) => `<option value="${t.id}"${t.id === cur ? " selected" : ""}>${t.emoji} ${esc(t.name)}</option>`).join("")}</select>`;
  const yearSel = (i, cur) => `<select data-i="${i}" data-f="year" aria-label="Lehrjahr">${YEARS.map((y) => `<option value="${y}"${y === cur ? " selected" : ""}>${y}. Lehrjahr</option>`).join("")}</select>`;

  function editorHTML(d, i, { removable }) {
    return `<div class="lap-card lap-owned${errs[i] ? " bad" : ""}" data-card="${i}">` +
      `<div class="lap-row"><span class="lap-pill">${drafts.length > 1 ? `🃏 Karte ${i + 1}` : editId ? "✏️ Karte bearbeiten" : "✍️ Neue Karte"}</span><span class="lap-grow"></span>` +
        (removable ? `<button type="button" class="btn ghost sm" data-k="drop" data-i="${i}" aria-label="Karte ${i + 1} entfernen">🗑️ Entfernen</button>` : "") + `</div>` +
      (errs[i] ? `<p class="lap-fb no" role="alert">⚠️ ${esc(errs[i])}</p>` : "") +
      `<label class="lap-field wide"><span>Frage</span><textarea data-i="${i}" data-f="q" rows="2" maxlength="${OWN_LIMITS.q}">${esc(d.q)}</textarea></label>` +
      `<label class="lap-field wide"><span>✅ Richtige Antwort</span><input data-i="${i}" data-f="a" maxlength="${OWN_LIMITS.a}" value="${esc(d.a)}"></label>` +
      `<fieldset class="lap-xset"><legend>❌ Falsche Antworten <small>(optional – mit allen dreien kommt die Karte auch in die Prüfung)</small></legend>` +
        d.x.map((v, j) => `<input data-i="${i}" data-f="x${j}" maxlength="${OWN_LIMITS.a}" value="${esc(v)}" aria-label="Falsche Antwort ${j + 1}" placeholder="Falsch ${j + 1}">`).join("") + `</fieldset>` +
      `<label class="lap-field wide"><span>💡 Erklärung <small>(optional)</small></span><input data-i="${i}" data-f="e" maxlength="${OWN_LIMITS.e}" value="${esc(d.e)}"></label>` +
      `<div class="lap-fields"><label class="lap-field"><span>Thema</span>${topicSel(i, d.topic)}</label><label class="lap-field"><span>Lehrjahr</span>${yearSel(i, d.year)}</label></div>` +
    `</div>`;
  }

  function homeHTML() {
    const own = L.own();
    const ai = aiAvailable();
    return `<div class="lap-card lap-photohero">` +
        `<div class="lap-row"><div class="lap-emoji" aria-hidden="true">📷</div><div><h3 class="lap-h3">Aus Foto lernen</h3>` +
        `<p class="lap-muted">Fotografier ein Arbeitsblatt oder eine Buchseite – Claude macht daraus 5–15 Lernkarten, nur mit dem, was wirklich draufsteht. Du schaust sie vorher noch durch ✅</p></div></div>` +
        `<div class="lap-row lap-wrap"><span class="lap-muted">Für das</span><div class="lap-seg" role="group" aria-label="Lehrjahr für neue Karten">` +
          YEARS.map((y) => `<button type="button" data-iy="${y}" aria-pressed="${importYear === y}">${y}. Lj.</button>`).join("") + `</div></div>` +
        (ai
          ? `<label class="btn primary lap-full lap-photobtn">📷 Foto aufnehmen oder wählen<input type="file" accept="image/*" class="lap-photo-in" hidden></label>`
          : `<p class="lap-fb">🔐 Dafür brauchst du die Anmeldung mit Google – im lokalen Modus kann Claude keine Fotos lesen. Eigene Karten schreiben geht aber trotzdem 👇</p>`) +
        (note ? `<p class="lap-fb ${note.kind === "err" ? "no" : "ok"}" role="status">${esc(note.text)}</p>` : "") +
        `<p class="lap-muted lap-small">📚 Tipp: Gerade, gut beleuchtet, Seite füllt das Bild. Das Foto wird nur für diese eine Anfrage verkleinert an Claude geschickt und nicht gespeichert.</p>` +
      `</div>` +
      `<div class="lap-card">` +
        `<div class="lap-row"><h3 class="lap-h3">✍️ Deine eigenen Karten</h3><span class="lap-grow"></span><span class="lap-muted">${own.length}</span></div>` +
        `<button type="button" class="btn ghost sm" data-k="new">➕ Karte selbst schreiben</button>` +
        (own.length
          ? `<ul class="lap-ownlist">${own.map((c) => {
              const tp = topicOf(c.topic) || TOPICS[0];
              const ask = armed === c.id;
              return `<li class="lap-ownrow" data-id="${esc(c.id)}"><div class="lap-ownmain"><span class="lap-ownq">${tp.emoji} ${esc(c.q)}</span>` +
                `<span class="lap-owna">✅ ${esc(c.a)}</span>` +
                `<span class="lap-ownmeta">${c.year}. Lj. · ${c.source === "foto" ? "📷 aus Foto" : "✍️ selbst geschrieben"}${c.x && c.x.length === 3 ? " · 📝 prüfungstauglich" : ""}</span></div>` +
                `<div class="lap-ownact"><button type="button" class="btn ghost sm" data-k="edit" data-id="${esc(c.id)}" aria-label="Bearbeiten">✏️</button>` +
                `<button type="button" class="btn ${ask ? "danger" : "ghost"} sm" data-k="del" data-id="${esc(c.id)}" aria-label="Löschen">${ask ? "Wirklich löschen?" : "🗑️"}</button></div></li>`;
            }).join("")}</ul>`
          : `<p class="lap-muted">Noch keine eigenen Karten – mach ein Foto oder schreib eine selbst 🌱</p>`) +
      `</div>`;
  }

  function busyHTML() {
    return `<div class="lap-card lap-center lap-busy">` +
      (preview ? `<img class="lap-preview" src="${esc(preview)}" alt="Dein Foto">` : "") +
      `<div class="lap-row lap-centerrow"><span class="lap-ai-av" aria-hidden="true">🤖</span><div class="lap-typing" aria-label="Claude liest"><span></span><span></span><span></span></div></div>` +
      `<p class="lap-muted">Claude liest dein Foto und schreibt Lernkarten … 📖 Das dauert meist 10–30 Sekunden.</p>` +
      `<button type="button" class="btn ghost sm" data-k="cancel">Abbrechen</button>` +
    `</div>`;
  }

  function reviewHTML() {
    return `<div class="lap-card">` +
        `<div class="lap-row"><button type="button" class="btn ghost sm" data-k="home">← Zurück</button><span class="lap-grow"></span><span class="lap-muted">${drafts.length} ${drafts.length === 1 ? "Karte" : "Karten"}</span></div>` +
        `<h3 class="lap-h3">🔍 Schau kurz drüber</h3>` +
        `<p class="lap-muted">Claude kann sich verlesen – bessere aus, was nicht passt, und lösch, was du nicht brauchst.${dropped ? ` (${dropped} unklare ${dropped === 1 ? "Karte hab" : "Karten hab"} ich gleich weggelassen.)` : ""}</p>` +
      `</div>` +
      drafts.map((d, i) => editorHTML(d, i, { removable: true })).join("") +
      `<div class="lap-card lap-stick"><div class="lap-row lap-wrap"><button type="button" class="btn primary" data-k="save" ${drafts.length ? "" : "disabled"}>✅ Übernehmen (${drafts.length})</button>` +
        `<button type="button" class="btn ghost" data-k="home">Abbrechen</button></div></div>`;
  }

  function editHTML() {
    return `<div class="lap-card"><div class="lap-row"><button type="button" class="btn ghost sm" data-k="home">← Zurück</button></div></div>` +
      editorHTML(drafts[0], 0, { removable: false }) +
      `<div class="lap-card"><div class="lap-row lap-wrap"><button type="button" class="btn primary" data-k="save">💾 Speichern</button><button type="button" class="btn ghost" data-k="home">Abbrechen</button></div></div>`;
  }

  function render() {
    if (!page) return;
    page.innerHTML = `<div>${view === "busy" ? busyHTML() : view === "review" ? reviewHTML() : view === "edit" ? editHTML() : homeHTML()}</div>`;
  }
  const goHome = () => { view = "home"; drafts = []; errs = {}; editId = null; armed = null; render(); };

  async function fromPhoto(file) {
    note = null;
    let img;
    try { img = await shrinkImage(file, { maxSide: 1280, maxBytes: 700 * 1024, quality: 0.85 }); }
    catch (err) { note = { kind: "err", text: "😕 " + ((err && err.message) || "Das Bild konnte nicht gelesen werden.") }; render(); return; }
    preview = img.data; view = "busy"; render();
    ctrl = new AbortController();
    try {
      const out = await askClaude([{ role: "user", content: photoPrompt({ year: importYear, topics: TOPIC_IDS }) }], {
        body: { mode: "lehrer", image: { type: "image/jpeg", data: img.data.replace(/^data:[^,]*,/, "") } }, timeoutMs: 120000, signal: ctrl.signal,
      });
      const r = parseCardJSON(out.reply, { topics: TOPIC_IDS, defYear: importYear, defTopic: "grund" });
      if (!r.cards.length) { preview = ""; view = "home"; note = { kind: "err", text: "🤔 " + (r.error || "Da hab ich keine Karten gefunden.") + " Probier's mit einem schärferen Foto nochmal." }; render(); return; }
      drafts = r.cards.map(draftOf); dropped = r.dropped; errs = {}; editId = null;
      preview = ""; view = "review"; render();
      if (page && page.scrollIntoView) { try { page.scrollIntoView({ block: "start" }); } catch { /* egal */ } }
    } catch (err) {
      preview = ""; view = "home";
      note = err && err.code === "abort" ? null : { kind: "err", text: "😕 " + ((err && err.message) || "Das hat nicht geklappt.") + " Probier's gleich nochmal." };
      render();
    } finally { ctrl = null; }
  }

  async function save() {
    errs = {};
    const ok = [];
    drafts.forEach((d, i) => {
      const r = cleanOwnCard({ ...d, x: d.x.filter((v) => v.trim()) }, { topics: TOPIC_IDS, defYear: importYear });
      if (r.ok) ok.push(r.card); else errs[i] = r.error;
    });
    if (Object.keys(errs).length) {
      render();
      const first = page && page.querySelector(".lap-owned.bad");
      if (first && first.scrollIntoView) { try { first.scrollIntoView({ block: "center" }); } catch { /* egal */ } }
      L.ui.toast("Bitte die markierten Karten noch ausbessern ✍️");
      return;
    }
    const source = editId ? (L.own().find((c) => c.id === editId) || {}).source || "hand" : view === "review" ? "foto" : "hand";
    const n = await L.saveOwn(ok, { source, id: editId });
    if (n == null) return; // Fehler hat L schon gemeldet
    note = view === "review" ? { kind: "ok", text: `🎉 ${n} ${n === 1 ? "Karte ist" : "Karten sind"} jetzt in deinen Lernkarten!` } : null;
    L.ui.toast(editId ? "💾 Gespeichert" : view === "review" ? `✅ ${n} Karten übernommen – viel Spaß beim Lernen!` : "✍️ Karte gespeichert");
    goHome();
  }

  function onClick(ev) {
    if (!page) return;
    const t = ev.target.closest("button");
    if (!t || !page.contains(t)) return;
    if (t.dataset.iy) { importYear = Number(t.dataset.iy); render(); return; }
    const k = t.dataset.k;
    if (k === "new") { drafts = [blank(normYear(L.year()) || 1)]; errs = {}; editId = null; view = "edit"; note = null; render(); const q = page.querySelector('[data-f="q"]'); if (q) q.focus(); }
    else if (k === "edit") { const c = L.own().find((x) => x.id === t.dataset.id); if (!c) return; drafts = [draftOf(c)]; errs = {}; editId = c.id; view = "edit"; note = null; render(); }
    else if (k === "del") {
      const id = t.dataset.id;
      if (armed !== id) { armed = id; render(); return; }
      armed = null; L.removeOwn(id).then(() => { L.ui.toast("🗑️ Karte gelöscht"); render(); });
    }
    else if (k === "drop") { const i = Number(t.dataset.i); drafts.splice(i, 1); errs = {}; if (!drafts.length) { goHome(); L.ui.toast("Alle Karten verworfen"); } else render(); }
    else if (k === "save") save();
    else if (k === "cancel") { if (ctrl) ctrl.abort(); }
    else if (k === "home") goHome();
  }
  function onInput(ev) {
    const el = ev.target;
    const i = Number(el.dataset.i), f = el.dataset.f;
    if (!f || !drafts[i]) return;
    if (f === "year") drafts[i].year = Number(el.value);
    else if (/^x\d$/.test(f)) drafts[i].x[Number(f[1])] = el.value;
    else drafts[i][f] = el.value;
  }
  function onChange(ev) {
    if (ev.target.classList.contains("lap-photo-in")) { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (f) fromPhoto(f); return; }
    onInput(ev);
  }

  return {
    show(el) { page = el; page.addEventListener("click", onClick); page.addEventListener("input", onInput); page.addEventListener("change", onChange); render(); },
    hide() { if (page) { page.removeEventListener("click", onClick); page.removeEventListener("input", onInput); page.removeEventListener("change", onChange); } page = null; },
    onData() { if (page && view === "home") render(); },
    onYear() { if (view === "home") { importYear = normYear(L.year()) || importYear; render(); } },
    destroy() { if (ctrl) { try { ctrl.abort(); } catch { /* egal */ } } },
  };
}
