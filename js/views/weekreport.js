// Update 10 – ✨ Automatischer Wochenbericht (Berichtsheft-Eintrag) als Vollbild-Ansicht.
// Sammelt die echte Woche (js/weekreport-core.js), schreibt je Tag einen Entwurf aus Vorlagen (ohne KI),
// optional „🤖 Mit Claude formulieren“ (Server-Modus "bericht", nur die strukturierte Zusammenfassung, nie Fotos).
// Texte bearbeiten, je Woche speichern (Alltag-Sammlung „berichtsheft“, ID "2026-W45"), als ✅ abgegeben markieren,
// drucken/PDF (Berichtsheft-Layout mit Unterschriften) und als Text kopieren.
import { icon } from "../icons.js";
import { esc, dayKey, startOfWeek } from "../util.js";
import * as W from "../weekreport-core.js";
import { readApprentice, apprenticeYear, buildWeek } from "./report.js";
import { collection } from "../alltag/db.js";

const ROOT_ID = "wr-root";
let cur = null; // { ctx, week, el, offs:[], pushed, prevFocus, prevOverflow, photos, saveTimer, dirty:Set, busy }
let col = null, logCol = null, matCol = null;
const cols = () => {
  if (!col) { col = collection(W.COLLECTION); logCol = collection("site_log"); matCol = collection("material_items"); }
  return { col, logCol, matCol };
};

/** weekreport.css einmal einhängen. */
function injectCSS() {
  if (document.getElementById("wr-css")) return;
  const l = document.createElement("link");
  l.id = "wr-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/weekreport.css", import.meta.url).href;
  document.head.appendChild(l);
}

const keyDate = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
export const currentWeek = () => W.weekKeyOf(dayKey(Date.now()));
function snapOf() { try { return cur.ctx.store.get() || {}; } catch { return {}; } }
function prefs() { const p = cols().col.all().find((x) => x && x.id === W.PREFS_ID); return { style: W.normStyle(p && p.style) }; }
function savedDoc() { return W.normDoc(cols().col.all().find((x) => x && x.id === cur.week) || null, cur.week); }

/** Woche aus echten Daten zusammenstellen. */
export function weekSummary(snap, week, { photos = [], siteLog = [], material = [] } = {}) {
  const ws = keyDate(W.mondayOfWeek(week));
  const rows = buildWeek(snap, ws);
  return W.buildWeekReport({
    week, rows, entries: snap.entries || [], dayKeyOf: dayKey, places: snap.places || [],
    siteLog, material, photos,
  });
}

function gather() {
  const snap = snapOf();
  const c = cols();
  const sum = weekSummary(snap, cur.week, { photos: cur.photos || [], siteLog: c.logCol.all(), material: c.matCol.all() });
  const ap = readApprentice(snap.settings);
  const mo = keyDate(sum.from), su = keyDate(sum.to);
  const lj = apprenticeYear(ap, mo) || apprenticeYear(ap, su);
  const pf = prefs();
  const doc = savedDoc();
  const draft = W.draftWeek(sum, pf.style);
  const texts = W.mergeTexts(doc, draft);
  for (const k of Object.keys(cur.local)) texts[k] = cur.local[k]; // noch nicht gespeicherte Eingaben
  return { snap, sum, ap, lj, pf, doc, draft, texts, note: String(ap.notes[cur.week] || "") };
}

/* ---------- Darstellung ---------- */

function tile(e, label, val, cls = "") { return `<div class="wr-tile${cls}"><span aria-hidden="true">${e}</span><b>${esc(val)}</b><small>${esc(label)}</small></div>`; }

function factsOf(d) {
  const li = [];
  for (const x of d.sites) li.push(`🏗️ ${esc(x.name)}${x.min ? ` · ${W.hm(x.min)} h` : ""}`);
  if (d.worked) for (const x of d.segments) if (x.drive || x.activity !== W.WORK || d.segments.length > 1) li.push(`${x.drive ? "🚗" : "🔧"} ${esc(x.activity)} ${W.hm(x.min)} h`);
  for (const n of d.notes) li.push(`📝 ${esc(n)}`);
  for (const x of d.log) li.push(`📔 ${esc(x.text)}`);
  if (d.material.length) li.push(`🧰 ${esc(d.material.map((x) => x.line).join(", "))}`);
  if (d.photos.count) li.push(`📷 ${d.photos.count} ${d.photos.count === 1 ? "Foto" : "Fotos"}${d.photos.notes.length ? ` – ${esc(d.photos.notes.join("; "))}` : ""}`);
  if (d.people.length) li.push(`👷 mit ${esc(d.people.join(", "))}`);
  return li;
}

const SRC_BADGE = { claude: "🤖 Claude", edit: "✏️ bearbeitet", auto: "✨ automatisch" };

function typeChip(d) {
  const m = W.TYPE_META[d.type] || W.TYPE_META.frei;
  const kind = d.type === "arbeit" ? "arbeit" : d.type;
  const chips = [`<span class="rp-tag rp-${esc(kind)} wr-chip">${m.e} ${esc(d.type === "feiertag" && d.holiday ? d.holiday : m.l)}</span>`];
  if (d.worked && d.school) chips.push(`<span class="rp-tag rp-schule wr-chip">🎒 ${esc(d.schoolLabel || "Berufsschule")}</span>`);
  return chips.join("");
}

function render(full = false) {
  if (!cur) return;
  const g = gather();
  const { sum, ap, lj, pf, doc, texts, draft } = g;
  const el = cur.el;
  const done = doc.status === "abgegeben";
  cur.last = g;

  el.querySelector(".wr-wk").textContent = `KW ${sum.kw} · ${W.fmtKey(sum.from, false)} – ${W.fmtKey(sum.to)}`;
  const st = el.querySelector(".wr-state");
  st.className = `wr-state${done ? " done" : ""}`;
  const [se, stx] = done ? ["✅", "abgegeben"] : doc.saved ? ["📝", "Entwurf gespeichert"] : ["✨", "neuer Entwurf"];
  st.innerHTML = `<span aria-hidden="true">${se}</span><span class="wr-st-t">${stx}</span>`;
  st.title = stx;

  const t = sum.totals;
  el.querySelector(".wr-sum").innerHTML = `
    <div class="wr-tiles">
      ${tile("⏱️", "Stunden", `${W.hm(t.min)} h`, " main")}
      ${tile("🔧", t.workDays === 1 ? "Arbeitstag" : "Arbeitstage", String(t.workDays))}
      ${t.schoolDays ? tile("🎒", "Berufsschule", `${t.schoolDays} ${t.schoolDays === 1 ? "Tag" : "Tage"}`) : ""}
      ${t.leaveDays ? tile("🌴", "Urlaub", `${t.leaveDays} ${t.leaveDays === 1 ? "Tag" : "Tage"}`) : ""}
      ${t.zaDays ? tile("⏳", "Zeitausgleich", `${t.zaDays} ${t.zaDays === 1 ? "Tag" : "Tage"}`) : ""}
      ${t.sickDays ? tile("🤒", "Krank", `${t.sickDays} ${t.sickDays === 1 ? "Tag" : "Tage"}`) : ""}
      ${t.driveMin ? tile("🚗", "Fahrzeit", `${W.hm(t.driveMin)} h`) : ""}
      ${t.photos ? tile("📷", t.photos === 1 ? "Foto" : "Fotos", String(t.photos)) : ""}
      ${t.material ? tile("🧰", "Material verbaut", String(t.material)) : ""}
    </div>
    ${sum.sites.length ? `<div class="wr-sites">${sum.sites.map((x) => `<span class="wr-site">🏗️ <b>${esc(x.name)}</b> ${x.min ? `${W.hm(x.min)} h · ` : ""}${x.days} ${x.days === 1 ? "Tag" : "Tage"}</span>`).join("")}</div>` : ""}
    ${!t.workDays && !t.schoolDays && !t.leaveDays && !t.sickDays && !t.zaDays ? `<p class="note wr-empty-week">🌿 In dieser Woche ist noch nichts eingetragen – sobald du stempelst, füllt sich der Bericht von selbst.</p>` : ""}`;

  // Stil-Schalter
  for (const b of el.querySelectorAll("[data-wr-style]")) b.setAttribute("aria-pressed", String(b.dataset.wrStyle === pf.style));

  // Neue Daten seit dem Speichern?
  const stale = !done && doc.saved && Object.keys(draft).some((k) => (doc.src[k] || "auto") === "auto" && typeof doc.days[k] === "string" && doc.days[k] !== draft[k]);
  el.querySelector(".wr-stale").hidden = !stale;

  // Kopf des Blatts
  const field = (label, v) => `<div class="rp-f"><span>${label}</span><b>${v ? esc(v) : "&nbsp;"}</b></div>`;
  el.querySelector(".wr-head").innerHTML = `
    <div class="rp-title"><h1>Ausbildungsnachweis</h1><span>Berichtsheft · KW ${sum.kw}${done ? " · ✅ abgegeben" : ""}</span></div>
    <div class="rp-fields">
      ${field("Name", ap.name)}
      ${field("Lehrberuf", ap.trade)}
      ${field("Lehrbetrieb", ap.company)}
      ${field("Lehrjahr", lj ? `${lj}. Lehrjahr` : "")}
      ${field("Kalenderwoche", `KW ${sum.kw}: ${W.fmtKey(sum.from)} – ${W.fmtKey(sum.to)}`)}
    </div>`;
  el.querySelector(".wr-hint").hidden = !!(ap.name && ap.trade && ap.company);

  // Tage: Gerüst nur neu bauen, wenn sich die Woche ändert (Eingaben/Fokus bleiben erhalten)
  const list = el.querySelector(".wr-days");
  if (full || list.dataset.week !== cur.week) {
    list.dataset.week = cur.week;
    list.innerHTML = sum.days.map((d) => `
      <section class="wr-day" data-key="${esc(d.key)}">
        <header class="wr-dh">
          <div class="wr-dd"><b>${esc(d.wdLong)}</b><span>${esc(W.fmtKey(d.key, false))}</span></div>
          <div class="wr-chips"></div>
          <b class="wr-h"></b>
        </header>
        <ul class="wr-facts"></ul>
        <div class="wr-tx">
          <div class="wr-lbl"><label for="wr-ta-${esc(d.key)}">Tätigkeiten</label><span class="wr-src"></span></div>
          <textarea id="wr-ta-${esc(d.key)}" class="wr-ta" rows="3" maxlength="${W.TEXT_MAX}" data-key="${esc(d.key)}" placeholder="Was hast du an diesem Tag gemacht?"></textarea>
          <div class="wr-print" aria-hidden="true"></div>
        </div>
        <button type="button" class="btn ghost sm wr-add" data-wr="add" data-key="${esc(d.key)}">✏️ Trotzdem etwas notieren</button>
      </section>`).join("");
  }
  for (const d of sum.days) {
    const sec = list.querySelector(`.wr-day[data-key="${d.key}"]`);
    if (!sec) continue;
    const txt = texts[d.key] || "";
    const open = !d.empty || !!txt || cur.opened.has(d.key);
    sec.classList.toggle("is-empty", d.empty && !txt);
    sec.classList.toggle("is-we", d.weekend);
    sec.querySelector(".wr-chips").innerHTML = d.empty ? `<span class="wr-free">🌿 nichts eingetragen</span>` : typeChip(d);
    sec.querySelector(".wr-h").textContent = d.min > 0 ? `${W.hm(d.min)} h` : "–";
    const facts = factsOf(d);
    const ul = sec.querySelector(".wr-facts");
    ul.innerHTML = facts.map((x) => `<li>${x}</li>`).join("");
    ul.hidden = !facts.length;
    sec.querySelector(".wr-tx").hidden = !open;
    sec.querySelector(".wr-add").hidden = open || done;
    const ta = sec.querySelector(".wr-ta");
    ta.readOnly = done;
    if (document.activeElement !== ta && ta.value !== txt) ta.value = txt;
    sec.querySelector(".wr-print").textContent = txt || "–";
    const src = cur.local[d.key] !== undefined ? "edit" : (doc.src[d.key] || (txt ? "auto" : ""));
    sec.querySelector(".wr-src").textContent = src ? SRC_BADGE[src] : "";
    sec.querySelector(".wr-src").dataset.src = src;
  }
  el.querySelector(".wr-total").textContent = `${W.hm(sum.totals.min)} h`;
  const nt = el.querySelector(".wr-note");
  nt.hidden = !g.note.trim();
  nt.querySelector(".wr-note-t").textContent = g.note;

  // Knöpfe
  el.querySelector('[data-wr="submit"]').innerHTML = done ? "↩️ <span>Wieder bearbeiten</span>" : "✅ <span>Als abgegeben markieren</span>";
  el.querySelector('[data-wr="submit"]').classList.toggle("primary", !done);
  el.querySelector('[data-wr="submit"]').classList.toggle("ghost", done);
  el.querySelector('[data-wr="ai"]').disabled = done || !!cur.busy || !cur.aiOk;
  el.querySelector('[data-wr="regen"]').disabled = done;
  el.querySelector(".wr-ai-note").hidden = cur.aiOk;
  for (const b of el.querySelectorAll("[data-wr-style]")) b.disabled = done;
}

/* ---------- Speichern ---------- */

async function save(patch = {}, { quiet = true } = {}) {
  if (!cur) return false;
  const g = gather();
  const doc = g.doc;
  const days = { ...g.texts };
  const src = { ...doc.src };
  for (const k of Object.keys(days)) if (!src[k]) src[k] = "auto";
  for (const k of Object.keys(cur.local)) src[k] = "edit";
  const next = {
    id: cur.week, week: cur.week, days, src,
    status: doc.status, submittedAt: doc.submittedAt || null,
    ...patch, updated: Date.now(),
  };
  if (patch.src) next.src = { ...src, ...patch.src };
  if (patch.days) next.days = { ...days, ...patch.days };
  try {
    await cols().col.put(next);
    cur.local = {};
    if (!quiet) cur.ctx.ui.toast("💾 Gespeichert");
    return true;
  } catch (err) {
    console.error("Wochenbericht speichern:", err);
    cur.ctx.ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren.");
    return false;
  }
}

function scheduleSave() {
  if (!cur) return;
  clearTimeout(cur.saveTimer);
  cur.saveTimer = setTimeout(() => { if (cur) { cur.saveTimer = null; save(); } }, 800);
}
async function flush() {
  if (!cur || !cur.saveTimer) return;
  clearTimeout(cur.saveTimer);
  cur.saveTimer = null;
  await save();
}

/* ---------- Claude ---------- */

async function askAi(btn) {
  if (!cur || cur.busy) return;
  const g = cur.last || gather();
  if (!g.sum.days.some((d) => !d.empty)) { cur.ctx.ui.toast("In dieser Woche gibt's noch nichts zum Formulieren 🌿"); return; }
  const mine = cur;
  cur.busy = true;
  btn.disabled = true;
  btn.innerHTML = `<span class="wr-spin" aria-hidden="true"></span><span>Claude schreibt …</span>`;
  try {
    const { askClaude } = await import("../alltag/ai-client.js");
    const text = W.summaryForAi(g.sum, { style: g.pf.style, trade: g.ap.trade || "Elektrotechnik", year: g.lj });
    const { reply } = await askClaude([{ role: "user", content: text }], { timeoutMs: 60000, body: { mode: "bericht" } });
    if (cur !== mine) return;
    const parsed = W.parseAiDays(reply, mine.week);
    const keys = Object.keys(parsed);
    if (!keys.length) { mine.ctx.ui.toast("Claude hat nicht im erwarteten Format geantwortet – probier's nochmal."); return; }
    const src = {};
    for (const k of keys) src[k] = "claude";
    for (const k of keys) delete mine.local[k];
    // leere Tage bleiben leer (nichts erfinden)
    const days = {};
    for (const d of g.sum.days) if (parsed[d.key] !== undefined) days[d.key] = d.empty && !g.texts[d.key] ? "" : parsed[d.key];
    if (await save({ days, src })) mine.ctx.ui.toast("🤖 Claude hat formuliert – lies kurz drüber und pass an, was nicht passt.", 3200);
  } catch (err) {
    if (cur === mine) mine.ctx.ui.toast(err && err.message ? err.message : "Claude ist gerade nicht erreichbar.", 3200);
  } finally {
    mine.busy = false;
    btn.innerHTML = `🤖 <span>Mit Claude formulieren</span>`;
    if (cur === mine) render();
  }
}

/* ---------- Aktionen ---------- */

async function copyText(txt) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(txt); return true; } } catch { /* Fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = txt; ta.setAttribute("readonly", "");
    ta.className = "wr-clip";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

async function onClick(ev) {
  const b = ev.target.closest("[data-wr], [data-wr-style]");
  if (!b || !cur || !cur.el.contains(b)) return;
  if (b.dataset.wrStyle) {
    const style = W.normStyle(b.dataset.wrStyle);
    if (style === prefs().style) return;
    try { await cols().col.put({ id: W.PREFS_ID, style, updated: Date.now() }); } catch { /* Toast vom Store */ }
    // automatische Texte im neuen Stil (eigene/Claude-Texte bleiben)
    const g = gather();
    if (g.doc.saved) {
      const draft = W.draftWeek(g.sum, style);
      const days = {};
      for (const k of Object.keys(draft)) if ((g.doc.src[k] || "auto") === "auto" && cur.local[k] === undefined) days[k] = draft[k];
      await save({ days });
    }
    cur.ctx.ui.toast(style === "ich" ? "✍️ Ich-Form – „Ich habe …“" : "✍️ Neutral – ohne „ich“");
    render();
    return;
  }
  const a = b.dataset.wr;
  if (a === "close") closeWeekReport();
  else if (a === "prev" || a === "next" || a === "now") {
    await flush();
    cur.week = a === "now" ? currentWeek() : W.shiftWeek(cur.week, a === "prev" ? -1 : 1);
    cur.local = {}; cur.opened = new Set();
    render(true);
  } else if (a === "add") {
    cur.opened.add(b.dataset.key);
    render();
    const ta = cur.el.querySelector(`#wr-ta-${b.dataset.key}`);
    if (ta) ta.focus();
  } else if (a === "regen") {
    const g = gather();
    const days = {}, src = {};
    let kept = 0;
    for (const k of Object.keys(g.draft)) {
      const s0 = cur.local[k] !== undefined ? "edit" : g.doc.src[k];
      if (s0 === "edit" || s0 === "claude") { kept++; continue; }
      days[k] = g.draft[k]; src[k] = "auto";
    }
    await save({ days, src });
    cur.ctx.ui.toast(kept ? `🔄 Aus deinen Daten neu erstellt – ${kept} eigene${kept === 1 ? "r" : ""} Text${kept === 1 ? "" : "e"} bleib${kept === 1 ? "t" : "en"}.` : "🔄 Aus deinen Daten neu erstellt");
  } else if (a === "reset-all") {
    const g = gather();
    await save({ days: { ...g.draft }, src: Object.fromEntries(Object.keys(g.draft).map((k) => [k, "auto"])) });
    cur.ctx.ui.toast("🔄 Alle Tage neu aus den Daten");
  } else if (a === "save") {
    clearTimeout(cur.saveTimer); cur.saveTimer = null;
    await save({}, { quiet: false });
  } else if (a === "submit") {
    clearTimeout(cur.saveTimer); cur.saveTimer = null;
    const done = savedDoc().status === "abgegeben";
    if (await save(done ? { status: "entwurf", submittedAt: null } : { status: "abgegeben", submittedAt: Date.now() })) {
      cur.ctx.ui.toast(done ? "↩️ Wieder als Entwurf – du kannst weiter schreiben." : "✅ Woche abgegeben – super gemacht! 🎉", 2600);
    }
  } else if (a === "print") {
    await flush();
    render();
    try { window.print(); } catch { cur.ctx.ui.toast("Drucken geht hier nicht."); }
  } else if (a === "copy") {
    await flush();
    const g = gather();
    const txt = W.reportText(g.sum, g.texts, { name: g.ap.name, trade: g.ap.trade, company: g.ap.company, year: g.lj }, { status: g.doc.status, notes: g.note });
    const ok = await copyText(txt);
    cur.ctx.ui.toast(ok ? "📋 Bericht kopiert – jetzt einfügen, wo du willst." : "Kopieren hat nicht geklappt.");
  } else if (a === "ai") askAi(b);
}

function onInput(ev) {
  const ta = ev.target.closest(".wr-ta");
  if (!ta || !cur || ta.readOnly) return;
  cur.local[ta.dataset.key] = ta.value;
  const sec = ta.closest(".wr-day");
  sec.querySelector(".wr-print").textContent = ta.value || "–";
  const badge = sec.querySelector(".wr-src");
  badge.textContent = SRC_BADGE.edit; badge.dataset.src = "edit";
  scheduleSave();
}

function onKey(ev) {
  if (!cur) return;
  if (ev.key === "Escape" && !document.querySelector("#sheet-root .sheet")) { ev.preventDefault(); closeWeekReport(); }
}
function onPop() { if (cur) closeWeekReport(true); }

/** Wochenbericht schließen. */
export function closeWeekReport(fromPop = false) {
  if (!cur) return;
  const c = cur;
  if (c.saveTimer) { clearTimeout(c.saveTimer); c.saveTimer = null; save(); }
  cur = null;
  for (const off of c.offs) { try { off(); } catch { /* egal */ } }
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("popstate", onPop);
  c.el.remove();
  document.body.classList.remove("wr-open");
  document.body.style.overflow = c.prevOverflow;
  if (!fromPop && c.pushed && history.state && history.state.wr) history.back();
  if (c.prevFocus && document.contains(c.prevFocus)) { try { c.prevFocus.focus({ preventScroll: true }); } catch { /* egal */ } }
}

export function isOpen() { return !!cur; }

/**
 * ✨ Wochenbericht öffnen. opts.week = "2026-W45" | opts.weekStart (Datum/ts) | sonst diese Woche.
 * opts.replace: true → History-Eintrag des Berichtshefts übernehmen (Wechsel aus dem Berichtsheft).
 */
export function openWeekReport(ctx, { week, weekStart, replace = false } = {}) {
  if (cur) closeWeekReport();
  injectCSS();
  let wk = W.isWeekKey(week) ? week : null;
  if (!wk) wk = W.weekKeyOf(dayKey(startOfWeek(weekStart ?? Date.now())));
  const el = document.createElement("div");
  el.id = ROOT_ID;
  el.className = "rp wr";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Wochenbericht");
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="rp-bar">
      <button type="button" class="btn ghost sm rp-close" data-wr="close">${icon("chevron-left", 18)}<span>Zurück</span></button>
      <h2>✨ Wochenbericht</h2>
      <span class="wr-state" aria-live="polite"></span>
    </div>
    <div class="rp-nav">
      <button type="button" class="btn ghost sm rp-arrow" data-wr="prev" aria-label="Vorherige Woche">${icon("chevron-left", 20)}</button>
      <div class="rp-wk wr-wk" aria-live="polite"></div>
      <button type="button" class="btn ghost sm rp-arrow" data-wr="next" aria-label="Nächste Woche">${icon("chevron-right", 20)}</button>
      <button type="button" class="btn ghost sm rp-now" data-wr="now">Diese Woche</button>
    </div>
    <section class="wr-card wr-sum" aria-label="Zusammenfassung der Woche"></section>
    <section class="wr-card wr-tools" aria-label="Entwurf">
      <div class="wr-style" role="group" aria-label="Schreibstil">
        <span class="wr-k">✍️ Schreibstil</span>
        <button type="button" class="wr-seg" data-wr-style="neutral" aria-pressed="true">Neutral</button>
        <button type="button" class="wr-seg" data-wr-style="ich" aria-pressed="false">Ich-Form</button>
      </div>
      <div class="wr-tool-btns">
        <button type="button" class="btn ghost" data-wr="regen">🔄 <span>Neu aus Daten</span></button>
        <button type="button" class="btn ghost wr-ai" data-wr="ai">🤖 <span>Mit Claude formulieren</span></button>
      </div>
      <p class="note wr-ai-note" hidden>🤖 Claude geht nur mit Google-Anmeldung – der automatische Entwurf funktioniert trotzdem.</p>
      <p class="note">Der Entwurf kommt nur aus deinen echten Daten (Stempelungen, Notizen, Tagebuch, Material, Fotos). Claude bekommt bloß diese Zusammenfassung – keine Fotos.</p>
    </section>
    <p class="note wr-stale" hidden>🔄 Seit dem Speichern sind neue Daten dazugekommen. <button type="button" class="linkbtn" data-wr="regen">Automatische Texte aktualisieren</button></p>
    <p class="note rp-hint wr-hint" hidden>💡 Name, Lehrberuf und Lehrbetrieb trägst du unter Einstellungen → Lehre ein – dann steht alles am Ausdruck.</p>
    <article class="rp-paper wr-paper">
      <header class="wr-head"></header>
      <div class="wr-days"></div>
      <div class="wr-totalrow"><span>Wochensumme</span><b class="wr-total"></b></div>
      <section class="wr-note" hidden><b>Ergänzungen</b><div class="wr-note-t"></div></section>
      <footer class="rp-sign">
        <div><span class="rp-line"></span><span>Datum, Unterschrift Lehrling</span></div>
        <div><span class="rp-line"></span><span>Datum, Unterschrift Ausbilder/in</span></div>
      </footer>
    </article>
    <div class="rp-actions wr-actions">
      <button type="button" class="btn primary" data-wr="submit">✅ <span>Als abgegeben markieren</span></button>
      <button type="button" class="btn ghost" data-wr="save">💾 <span>Speichern</span></button>
      <button type="button" class="btn ghost" data-wr="print">${icon("file", 20)}<span>Drucken / als PDF</span></button>
      <button type="button" class="btn ghost" data-wr="copy">📋 <span>Als Text kopieren</span></button>
    </div>`;

  let aiOk = false;
  try { aiOk = !!(ctx.store.get() && ctx.store.get().mode && ctx.store.get().mode !== "local"); } catch { aiOk = false; }
  try { const h = location.hostname; if ((h === "localhost" || h === "127.0.0.1") && window.__skAiTest) aiOk = true; } catch { /* egal */ }

  cur = { ctx, week: wk, el, offs: [], pushed: false, prevFocus: document.activeElement, prevOverflow: document.body.style.overflow || "",
    photos: [], saveTimer: null, local: {}, opened: new Set(), busy: false, aiOk, last: null };
  document.body.appendChild(el);
  document.body.classList.add("wr-open");
  document.body.style.overflow = "hidden";
  el.addEventListener("click", onClick);
  el.addEventListener("input", onInput);
  document.addEventListener("keydown", onKey);
  try {
    if (replace && history.state && history.state.rp) {
      const { rp, ...rest } = history.state;
      history.replaceState({ ...rest, wr: 1 }, "", location.href);
    } else history.pushState({ ...(history.state || {}), wr: 1 }, "", location.href);
    cur.pushed = true;
    window.addEventListener("popstate", onPop);
  } catch { /* egal */ }

  render(true);
  const mine = cur;
  const rerender = () => { if (cur === mine) render(); };
  const c = cols();
  mine.offs.push(c.col.watch(rerender), c.logCol.watch(rerender), c.matCol.watch(rerender));
  try { mine.offs.push(ctx.store.subscribe(rerender)); } catch { /* egal */ }
  // Foto-Index (nur Tag, Ort, Notiz – keine Bilder)
  import("../photos.js").then(async (ph) => {
    const load = async () => {
      try { const list = await ph.listIndex(); if (cur === mine) { mine.photos = list; render(); } } catch { /* nur Anzeige */ }
    };
    await load();
    if (cur === mine) mine.offs.push(ph.onChange(() => load()));
  }).catch((err) => console.warn("Fotos für den Wochenbericht nicht geladen:", err));
  try { el.focus({ preventScroll: true }); } catch { /* egal */ }
  return { close: () => closeWeekReport() };
}

/** Für den Dashboard-Tipp: Ist die Woche schon abgegeben? (lädt die Sammlung bei Bedarf) */
export function weekSubmitted(week) {
  const d = cols().col.all().find((x) => x && x.id === week);
  return !!d && d.status === "abgegeben";
}
