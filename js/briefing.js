// Update 10 F – ☀️ Morgen-Briefing & 📅 Wochenrückblick (Blatt). Daten werden hier gesammelt, die Logik steckt in ./briefing-core.js.
// Öffnen: Dashboard (Knopf „☀️ Briefing“ bzw. Angebot am Morgen) und Benachrichtigungszentrale (target "briefing:morning|weekly").
// „🔊 Vorlesen“ liest lokal vor (Gerätestimme). „🤖 Von <Name> zusammenfassen“ schickt NUR summaryForAi(brief) an /chat
// (Modus "briefing", ohne Werkzeuge) und liest die Antwort vor – nur nach Tipp, nie automatisch.
import * as B from "./briefing-core.js";
import { collection } from "./alltag/db.js";
import { expandTodo } from "./cal-core.js";
import { upcomingBirthdays, countdowns, countdownText } from "./planer-core.js";
import * as MAT from "./alltag/material-core.js";
import * as lockState from "./alltag/money-lock-state.js";
import { streak as srsStreak } from "./alltag/srs-core.js";
import * as WX from "./weather.js";
import * as WXC from "./weather-core.js";

export const LAST_MORNING = "sk-brief-morning";
export const LAST_WEEK = "sk-brief-week";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

export function markSeen(kind, now = Date.now()) {
  if (kind === "weekly") lsSet(LAST_WEEK, B.reviewWeek(now).from);
  else lsSet(LAST_MORNING, B.keyOf(new Date(now)));
}
/** Was soll das Dashboard gerade anbieten? → "morning" | "weekly" | null */
export function offer(settings, now = Date.now()) {
  const p = B.readBriefing(settings);
  if (B.shouldOfferMorning(now, lsGet(LAST_MORNING), p)) return "morning";
  if (B.shouldOfferWeekly(now, lsGet(LAST_WEEK), p)) return "weekly";
  return null;
}

function ensureCss() {
  if (document.getElementById("css-briefing")) return;
  const l = document.createElement("link");
  l.id = "css-briefing"; l.rel = "stylesheet";
  l.href = new URL("../css/briefing.css", import.meta.url).href;
  document.head.appendChild(l);
}

const COLS = ["material_items", "school_exams", "school_tasks", "lap_stats", "jp_stats", "habits"];

/* ---------------- Daten sammeln ---------------- */

function sitePlace(snap, today) {
  const places = snap.places || [];
  const r = snap.running;
  if (r) {
    const segs = Array.isArray(r.segments) ? r.segments : [];
    for (const x of [segs[segs.length - 1], r].filter(Boolean)) {
      const p = x.placeId ? places.find((q) => q.id === x.placeId) : null;
      if (p) return { place: p.name, placeId: p.id, people: Array.isArray(r.people) ? r.people : [], source: "running" };
      if (String(x.place || "").trim()) return { place: String(x.place).trim(), placeId: null, people: [], source: "running" };
    }
  }
  return B.einsatzSite(snap.todos || [], today, places);
}

function morningFacts(ctx, data, now) {
  const u = ctx.util;
  const snap = ctx.store.get() || {};
  const s = snap.settings || {};
  const today = B.keyOf(new Date(now));
  const tomorrow = B.addKey(today, 1);
  const todos = snap.todos || [];
  const ts = (k) => new Date(k + "T12:00").getTime();
  // Wetter (nur wenn eingerichtet – Ort bleibt am Gerät)
  let weather = null;
  try {
    const p = WX.prefs();
    if (p.src && p.src !== "off") {
      WX.refresh();
      const st = WX.state();
      const d = st.data;
      if (d && d.days && d.days[0]) {
        const t = d.days[0];
        weather = { emoji: (d.current || t).emoji, text: (d.current || t).text, temp: d.current ? d.current.temp : null, max: t.max, min: t.min, rainProb: t.rainProb,
          place: p.src === "city" ? p.city : "", hints: WXC.hints(d, today).filter((h) => h.date === today || h.when === "Heute").slice(0, 3) };
      }
    }
  } catch (e) { console.warn("Briefing: Wetter", e); }
  const site = sitePlace(snap, today);
  let material = [];
  if (site) {
    const pk = MAT.placeKey({ placeId: site.placeId, place: site.place });
    material = (data.get("material_items") || []).filter((x) => x && x.status === "brauche" &&
      (MAT.placeKey(x) === pk || (site.placeId && MAT.placeKey(x) === MAT.placeKey({ place: site.place }))));
    try { material = MAT.totals(material).map((t) => ({ name: t.name, qty: t.qty, unit: t.unit })); } catch { /* Rohliste */ }
  }
  let schoolToday = null, schoolTomorrow = null, holTomorrow = null;
  try { schoolToday = u.schoolLabel(ts(today), s); schoolTomorrow = u.schoolLabel(ts(tomorrow), s); } catch { /* egal */ }
  if (s.holidays !== false) { try { holTomorrow = u.holidayName(ts(tomorrow)); } catch { /* egal */ } }
  const exams = (data.get("school_exams") || []).filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") && e.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => ({ title: `${e.kind || "Prüfung"}${e.subject ? " " + e.subject : ""}`, days: B.daysUntil(today, e.date) }));
  const homework = (data.get("school_tasks") || []).filter((t) => t && !t.done && (!t.due || t.due <= B.addKey(today, 2))).length;
  const birthdays = [];
  try { for (const b of upcomingBirthdays(todos, today)) { if (b.days > 3) break; birthdays.push({ name: b.t.title || "Geburtstag", days: b.days, age: b.age }); } } catch { /* egal */ }
  const reminders = [];
  if (holTomorrow) reminders.push({ e: "🎌", t: holTomorrow, when: "morgen" });
  try { for (const c of countdowns(todos, today)) { if (c.days > 3) break; reminders.push({ e: c.emoji, t: c.t.title || "Countdown", when: countdownText(c.days) }); } } catch { /* egal */ }
  return {
    now, name: (snap.user && snap.user.name) || "",
    weather, site, material,
    termine: B.termineBetween(todos, today, today, expandTodo),
    tasks: B.openTasks(todos, today),
    school: { today: schoolToday, tomorrow: schoolTomorrow, exams, homework },
    birthdays, reminders,
  };
}

async function weeklyFacts(ctx, data, now) {
  const u = ctx.util;
  const snap = ctx.store.get() || {};
  const s = snap.settings || {};
  const today = B.keyOf(new Date(now));
  const { from, to } = B.reviewWeek(now);
  const ts = (k) => new Date(k + "T12:00").getTime();
  const w = B.weekWork(snap.entries || [], from, to, {
    creditOf: (e) => u.creditMin(e) + 0, targetOf: (k) => u.dailyTargetMin(ts(k), s), dayOf: (t) => u.dayKey(t), untilKey: today < to ? today : to,
  });
  // Berufsschultage zählen wie Arbeit (gleich wie im Überstundenkonto: Soll = 0)
  let balanceMin = null;
  try { const ov = await import("./views/overview.js"); const b = ov.balanceSummary(snap, ctx); if (b && (b.start || b.offset)) balanceMin = b.total; } catch { /* egal */ }
  let money = null;
  try {
    if (lockState.isLoaded() && lockState.isLocked()) money = { locked: true };
    else if (lockState.isLoaded()) { if (!data.has("money_tx")) need(data, "money_tx"); money = B.moneyWeek(data.get("money_tx") || [], from, to); }
  } catch { money = null; }
  const stat = (n) => (data.get(n) || []).find((x) => x && x.id === "me") || null;
  const lapS = stat("lap_stats"), jpS = stat("jp_stats");
  const learn = (st) => (st ? { streak: srsStreak(st, today), days: B.practiceDays(st, from, to) } : null);
  const exams = (data.get("school_exams") || []).filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") && e.date >= today && e.date <= B.addKey(today, 14))
    .sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => ({ title: `${e.kind || "Prüfung"}${e.subject ? " " + e.subject : ""}`, days: B.daysUntil(today, e.date) }));
  let habits = null;
  try {
    const HB = await import("./alltag/habits-core.js");
    let best = null;
    for (const h of data.get("habits") || []) { if (!h || h.archived) continue; const n = HB.streak(h, today); if (n > 0 && (!best || n > best.streak)) best = { title: h.title || h.name || "Gewohnheit", streak: n }; }
    habits = best ? { best } : null;
  } catch { habits = null; }
  return {
    from, to, ...w, balanceMin,
    done: B.doneInWeek(snap.todos || [], from, to, (t) => u.dayKey(t)),
    money, lap: learn(lapS), jp: learn(jpS), exams,
    nextWeek: B.termineBetween(snap.todos || [], B.addKey(to, 1), B.addKey(to, 7), expandTodo),
    habits,
  };
}

function need(data, name) {
  if (data.subs.has(name)) return;
  try { data.subs.set(name, collection(name).watch((list) => { data.set(name, list || []); data.changed(); })); } catch (e) { console.warn("Briefing: " + name, e); }
}

/* ---------------- Rendern ---------------- */

function sectionsHTML(brief, esc) {
  return brief.sections.map((sec) => `<section class="bf-sec" data-sec="${esc(sec.id)}">
      <h3><span aria-hidden="true">${sec.e}</span> ${esc(sec.h)}</h3>
      ${sec.lines.length ? `<ul>${sec.lines.map((l) => `<li${l.hot ? ' class="hot"' : ""}><span class="bf-e" aria-hidden="true">${esc(l.e)}</span><span class="bf-t"><b>${esc(l.t)}</b>${l.sub ? `<small>${esc(l.sub)}</small>` : ""}</span></li>`).join("")}</ul>` : `<p class="bf-empty">${esc(sec.empty || "")}</p>`}
    </section>`).join("");
}

/** Blatt öffnen. kind = "morning" | "weekly" */
export function openBriefing(ctx, kind = "morning") {
  ensureCss();
  const esc = ctx.util.esc;
  let cur = kind === "weekly" ? "weekly" : "morning";
  let brief = null;
  let aiBusy = false;
  let ctrl = null;
  const data = new Map();
  data.subs = new Map();
  let queued = false;
  let el = null;
  data.changed = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; render().catch((e) => console.error(e)); }, 40); };
  for (const n of COLS) need(data, n);
  let wxOff = null;
  try { wxOff = WX.onChange(() => data.changed()); } catch { /* egal */ }
  markSeen(cur);

  async function render() {
    if (!el || !el.isConnected) return;
    const now = Date.now();
    brief = cur === "weekly" ? B.buildWeekly(await weeklyFacts(ctx, data, now)) : B.buildMorning(morningFacts(ctx, data, now));
    const body = el.querySelector(".bf-body");
    el.querySelector(".bf-title").textContent = brief.title;
    el.querySelector(".bf-date").textContent = brief.date;
    body.innerHTML = sectionsHTML(brief, esc);
    el.querySelectorAll("[data-bf-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.bfTab === cur)));
  }

  let aiName = "Claude";
  let aiOk = false;
  const sheet = ctx.ui.openSheet({
    title: "☀️ Briefing",
    bodyHTML: `<div class="bf">
      <div class="bf-tabs" role="tablist" aria-label="Briefing-Art">
        <button type="button" role="tab" class="bf-tab" data-bf-tab="morning" aria-selected="${cur === "morning"}">☀️ Heute</button>
        <button type="button" role="tab" class="bf-tab" data-bf-tab="weekly" aria-selected="${cur === "weekly"}">📅 Woche</button>
      </div>
      <div class="bf-hero"><b class="bf-title"></b><span class="bf-date note"></span></div>
      <div class="bf-body" aria-live="polite"><p class="bf-empty">Einen Moment … ☕</p></div>
      <div class="bf-ai" hidden><div class="bf-ai-h">🤖 <b data-bf="ainame"></b> sagt:</div><p data-bf="aireply"></p></div>
      <div class="bf-actions">
        <button type="button" class="btn ghost sm" data-bf="speak">🔊 Vorlesen</button>
        <button type="button" class="btn sm primary" data-bf="ai" hidden>🤖 <span data-bf="aibtn">Zusammenfassen</span></button>
        <button type="button" class="btn ghost sm" data-bf="stop" hidden>⏹️ Stopp</button>
      </div>
      <p class="note bf-privacy" data-bf="aiwhy" hidden>🔒 An die KI geht nur diese Zusammenfassung – keine weiteren Daten.</p>
      <details class="bf-set"><summary>⚙️ Briefing-Einstellungen</summary>
        <label class="switch"><input type="checkbox" data-bf-set="offer"><span>Am Morgen (und Sonntag/Montag) im Überblick anbieten</span></label>
        <label class="switch"><input type="checkbox" data-bf-set="push"><span>☀️ Push am Morgen <small>(nur Anzahl Termine/Aufgaben und Baustelle – Standard aus)</small></span></label>
        <label class="bf-time">Uhrzeit für den Push <input type="time" data-bf-set="time" step="300"></label>
      </details>
    </div>`,
    onMount(root) { el = root; },
  });
  el = sheet.el;
  const pref = B.readBriefing((ctx.store.get() || {}).settings);
  el.querySelector('[data-bf-set="offer"]').checked = pref.offer;
  el.querySelector('[data-bf-set="push"]').checked = pref.push;
  el.querySelector('[data-bf-set="time"]').value = pref.time;
  el.querySelector(".bf-time").hidden = !pref.push;

  Promise.all([import("./alltag/ai-client.js"), import("./alltag/voice.js")]).then(([ai, vo]) => {
    aiOk = ai.aiAvailable();
    aiName = vo.assistantName();
    const b = el.querySelector('[data-bf="ai"]');
    b.hidden = !aiOk;
    el.querySelector('[data-bf="aiwhy"]').hidden = !aiOk;
    el.querySelector('[data-bf="aibtn"]').textContent = `Von ${aiName} zusammenfassen`;
    if (!vo.support || !(window.speechSynthesis)) el.querySelector('[data-bf="speak"]').hidden = true;
  }).catch((e) => console.warn("Briefing: KI/Stimme", e));

  async function speakText(t) {
    const vo = await import("./alltag/voice.js");
    const core = await import("./alltag/voice-core.js");
    el.querySelector('[data-bf="stop"]').hidden = false;
    try { await vo.speak(core.speakable(t)); } finally { if (el.isConnected) el.querySelector('[data-bf="stop"]').hidden = true; }
  }

  el.addEventListener("click", async (ev) => {
    const tab = ev.target.closest("[data-bf-tab]");
    if (tab) { cur = tab.dataset.bfTab; markSeen(cur); el.querySelector(".bf-ai").hidden = true; render().catch((e) => console.error(e)); return; }
    const b = ev.target.closest("button[data-bf]");
    if (!b) return;
    if (b.dataset.bf === "speak" && brief) { speakText(brief.speech).catch((e) => console.warn(e)); return; }
    if (b.dataset.bf === "stop") { import("./alltag/voice.js").then((vo) => vo.cancelSpeech()).catch(() => {}); if (ctrl) ctrl.abort(); b.hidden = true; return; }
    if (b.dataset.bf === "ai" && brief && !aiBusy) {
      aiBusy = true;
      ctx.ui.setBusy(b, true, "Denkt nach …");
      const box = el.querySelector(".bf-ai");
      try {
        const ai = await import("./alltag/ai-client.js");
        ctrl = new AbortController();
        const msg = `${brief.kind === "weekly" ? B.AI_PROMPT_WEEKLY : B.AI_PROMPT_MORNING}\n\n${B.summaryForAi(brief)}`;
        const res = await ai.askClaude([{ role: "user", content: msg }], { timeoutMs: 45000, signal: ctrl.signal, body: { mode: "briefing", assistantName: aiName } });
        if (!el.isConnected) return;
        box.hidden = false;
        el.querySelector('[data-bf="ainame"]').textContent = aiName;
        el.querySelector('[data-bf="aireply"]').textContent = res.reply;
        speakText(res.reply).catch((e) => console.warn(e));
      } catch (err) {
        if (el.isConnected && !(err && err.code === "abort")) ctx.ui.toast((err && err.message) || "Hat nicht geklappt – bitte nochmal probieren.");
      } finally {
        aiBusy = false; ctrl = null;
        if (el.isConnected) ctx.ui.setBusy(b, false);
      }
    }
  });
  el.addEventListener("change", async (ev) => {
    const t = ev.target.closest("[data-bf-set]");
    if (!t) return;
    const p = B.readBriefing((ctx.store.get() || {}).settings);
    if (t.dataset.bfSet === "offer") p.offer = t.checked;
    if (t.dataset.bfSet === "push") { p.push = t.checked; el.querySelector(".bf-time").hidden = !p.push; }
    if (t.dataset.bfSet === "time" && /^\d{2}:\d{2}$/.test(t.value)) p.time = t.value;
    try { await ctx.store.saveSettings({ briefing: p }); ctx.ui.toast(t.dataset.bfSet === "push" ? (p.push ? "☀️ Morgen-Push ist an" : "Morgen-Push ist aus") : "Gespeichert ✔️", 1800); }
    catch (e) { console.error(e); ctx.ui.toast("Konnte nicht speichern – bitte nochmal probieren."); }
  });

  // Aufräumen, sobald das Blatt weg ist
  const mo = new MutationObserver(() => {
    if (el.isConnected) return;
    mo.disconnect();
    for (const off of data.subs.values()) { try { off(); } catch { /* egal */ } }
    data.subs.clear();
    if (wxOff) try { wxOff(); } catch { /* egal */ }
    if (ctrl) ctrl.abort();
    import("./alltag/voice.js").then((vo) => vo.cancelSpeech()).catch(() => {});
    document.dispatchEvent(new CustomEvent("sk:briefing-closed")); // Überblick zeigt das Angebot dann nicht mehr
  });
  mo.observe(el.parentNode || document.body, { childList: true });
  render().catch((e) => console.error(e));
  return sheet;
}
