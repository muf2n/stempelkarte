// Update 10 F – ☀️ Morgen-Briefing & 📅 Wochenrückblick: reine Logik ohne DOM (Node-testbar, auch für tools/reminders/decide.mjs).
// Alles deterministisch aus echten Daten, die der Aufrufer schon gesammelt hat (js/briefing.js) – keine KI, keine Beispieldaten.
// Ergebnis: { title, date, sections: [{ id, e, h, lines: [{ e, t, sub?, hot? }], empty? }], speech (Text fürs Vorlesen/KI), counts }
// Die optionale „Von Jarvis zusammenfassen“-Anfrage bekommt NUR summaryForAi(brief) – nie Rohdaten.

const pad = (n) => String(n).padStart(2, "0");
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (k) => { const [y, m, d] = String(k).split("-").map(Number); return new Date(y, m - 1, d); };
export const addKey = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
const diffDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const s = (v) => String(v ?? "").trim();
const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const fmtKey = (k) => { const d = dateOf(k); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
export const longDate = (k) => { const d = dateOf(k); return `${WD_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`; };

/** Stunden:Minuten mit Vorzeichen optional („+2:30 h“). */
export function hmText(min, signed = false) {
  const m = Math.round(n0(min));
  const a = Math.abs(m);
  const t = `${Math.floor(a / 60)}:${pad(a % 60)} h`;
  if (!signed) return (m < 0 ? "−" : "") + t;
  return (m < 0 ? "−" : m > 0 ? "+" : "±") + t;
}

/* ---------------- Wann anbieten? ---------------- */

/** Morgen-Briefing wird zwischen 5 und 11 Uhr einmal pro Tag angeboten. */
export function morningWindow(now) { const h = new Date(now).getHours(); return h >= 5 && h < 11; }
export function shouldOfferMorning(now, lastKey, opts = {}) {
  if (opts.offer === false) return false;
  return morningWindow(now) && lastKey !== keyOf(new Date(now));
}

/** Rückblick-Woche: Sonntag → diese Woche (Mo–So), sonst die letzte volle Woche. → { from, to } (Montag, Sonntag) */
export function reviewWeek(now) {
  const d = new Date(now);
  const k = keyOf(d);
  const wd = d.getDay();
  const mon = addKey(k, -((wd + 6) % 7));
  const from = wd === 0 ? mon : addKey(mon, -7);
  return { from, to: addKey(from, 6) };
}
/** Wochenrückblick anbieten: Sonntag ab 15 Uhr und Montag bis 12 Uhr, einmal pro Woche. */
export function weeklyWindow(now) { const d = new Date(now); const h = d.getHours(); return (d.getDay() === 0 && h >= 15) || (d.getDay() === 1 && h < 12); }
export function shouldOfferWeekly(now, lastWeek, opts = {}) {
  if (opts.offer === false) return false;
  return weeklyWindow(now) && lastWeek !== reviewWeek(now).from;
}

/** Einstellungen settings.briefing = { offer (Standard an), push (Standard AUS), time "06:30" }. */
export function readBriefing(settings) {
  const b = settings && settings.briefing && typeof settings.briefing === "object" ? settings.briefing : {};
  const t = /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(b.time || "")) ? String(b.time).padStart(5, "0") : "06:30";
  return { offer: b.offer !== false, push: b.push === true, time: t };
}

/* ---------------- Morgen-Briefing ---------------- */

/**
 * f = {
 *   now, name?: "Florian",
 *   weather: { emoji, text, temp?, max, min, rainProb?, place?, hints: [{ e, when, t }] } | null,
 *   termine: [{ title, time|null, location? }]   (heute, nicht erledigt)
 *   tasks: { open: n, overdue: n, top: [titles] },
 *   site: { place, people: [], source: "einsatz" | "running" | "plan" } | null,
 *   material: [{ name, qty, unit }]   (Status „brauche“ für diese Baustelle),
 *   school: { today: label|null, tomorrow: label|null, exams: [{ title, days }], homework: n },
 *   birthdays: [{ name, days, age|null }]  (0 = heute, 1 = morgen …),
 *   reminders: [{ e, t, when }]   (Countdowns, Feiertag morgen, fällige Dinge),
 * }
 */
export function buildMorning(f = {}) {
  const now = Number(f.now) || Date.now();
  const today = keyOf(new Date(now));
  const h = new Date(now).getHours();
  const hello = h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 14 ? "Mahlzeit" : h < 18 ? "Servus" : "Guten Abend";
  const name = s(f.name).split(/\s+/)[0] || "";
  const sections = [];

  // 🌦️ Wetter
  const w = f.weather;
  if (w && (w.max != null || w.temp != null)) {
    const lines = [{ e: w.emoji || "🌡️", t: `${s(w.text) || "Wetter"}${w.temp != null ? `, jetzt ${Math.round(w.temp)}°` : ""}`, sub: `${w.min != null ? Math.round(w.min) + "° bis " : "bis "}${Math.round(n0(w.max))}°${w.rainProb != null ? ` · 💧 ${Math.round(w.rainProb)} %` : ""}${w.place ? " · " + s(w.place) : ""}` }];
    for (const x of (w.hints || []).slice(0, 3)) lines.push({ e: x.e || "⚠️", t: `${x.when ? s(x.when) + ": " : ""}${s(x.t)}`, hot: true });
    if (w.rainProb != null && w.rainProb >= 60 && !(w.hints || []).length) lines.push({ e: "☂️", t: "Regenjacke einpacken – es wird nass." });
    else if (w.max != null && w.max <= 3) lines.push({ e: "🧤", t: "Warm anziehen – Handschuhe nicht vergessen." });
    sections.push({ id: "weather", e: "🌦️", h: "Wetter", lines });
  }

  // 📍 Baustelle + Material
  const site = f.site && s(f.site.place) ? f.site : null;
  if (site) {
    const lines = [{ e: "📍", t: s(site.place), sub: [site.source === "einsatz" ? "laut Einsatzplan" : site.source === "running" ? "läuft gerade" : site.source === "plan" ? "geplante Schicht" : "", (site.people || []).length ? "mit " + site.people.map(s).filter(Boolean).join(", ") : ""].filter(Boolean).join(" · ") }];
    const mat = (f.material || []).filter((m) => m && s(m.name));
    if (mat.length) {
      lines.push({ e: "🧰", t: `Mitnehmen: ${plural(mat.length, "Material", "Materialien")}`, sub: mat.slice(0, 5).map((m) => `${m.qty != null && m.qty !== "" ? qty(m.qty) + (m.unit ? " " + s(m.unit) : "") + " " : ""}${s(m.name)}`).join(", ") + (mat.length > 5 ? ` … +${mat.length - 5}` : "") });
    }
    sections.push({ id: "site", e: "🔧", h: "Heute auf der Baustelle", lines });
  }

  // 📅 Termine heute
  const termine = (f.termine || []).filter((t) => t && s(t.title));
  sections.push({
    id: "termine", e: "📅", h: "Termine heute",
    lines: termine.slice(0, 6).map((t) => ({ e: t.time ? "🕘" : "📌", t: s(t.title), sub: [t.time ? s(t.time) : "ganztägig", s(t.location)].filter(Boolean).join(" · ") })),
    empty: termine.length ? "" : "Heute keine Termine – Zeit für dich 🌿",
  });

  // ✅ Aufgaben
  const tk = f.tasks || {};
  const open = n0(tk.open), overdue = n0(tk.overdue);
  sections.push({
    id: "tasks", e: "✅", h: "Aufgaben",
    lines: open ? [{ e: overdue ? "⏰" : "📝", t: `${plural(open, "Aufgabe", "Aufgaben")} offen${overdue ? `, ${overdue} davon überfällig` : ""}`, sub: (tk.top || []).map(s).filter(Boolean).slice(0, 3).join(" · "), hot: overdue > 0 }] : [],
    empty: open ? "" : "Keine offenen Aufgaben 🎉",
  });

  // 🎒 Schule
  const sc = f.school || {};
  const sl = [];
  if (sc.today) sl.push({ e: "📚", t: `Heute ${s(sc.today)}`, hot: true });
  if (sc.tomorrow) sl.push({ e: "🎒", t: `Morgen ${s(sc.tomorrow)} – Tasche am Abend packen` });
  for (const x of (sc.exams || []).filter((x) => x && n0(x.days) <= 7).slice(0, 3)) sl.push({ e: "📝", t: s(x.title) || "Prüfung", sub: dayWord(n0(x.days)), hot: n0(x.days) <= 1 });
  if (n0(sc.homework)) sl.push({ e: "✏️", t: `${plural(n0(sc.homework), "Hausübung", "Hausübungen")} offen` });
  if (sl.length) sections.push({ id: "school", e: "🏫", h: "Schule", lines: sl });

  // 🎂 Geburtstage + 🔔 Erinnerungen
  const rl = [];
  for (const b of (f.birthdays || []).filter((b) => b && s(b.name) && n0(b.days) <= 3)) {
    rl.push({ e: "🎂", t: `${s(b.name)}${b.age != null ? ` wird ${b.age}` : " hat Geburtstag"}`, sub: dayWord(n0(b.days)), hot: n0(b.days) === 0 });
  }
  for (const r of (f.reminders || []).filter((r) => r && s(r.t)).slice(0, 4)) rl.push({ e: r.e || "🔔", t: s(r.t), sub: s(r.when) });
  if (rl.length) sections.push({ id: "reminders", e: "🔔", h: "Erinnerungen", lines: rl });

  const counts = { termine: termine.length, tasks: open, overdue, birthdays: (f.birthdays || []).filter((b) => b && n0(b.days) === 0).length, material: (f.material || []).length };
  const brief = { kind: "morning", title: `${hello}${name ? ", " + name : ""} ☀️`, date: longDate(today), today, sections, counts, site: site ? s(site.place) : "" };
  brief.speech = speechOf(brief);
  return brief;
}

function qty(v) { const x = Number(v); return Number.isFinite(x) ? String(Math.round(x * 100) / 100).replace(".", ",") : s(v); }
function dayWord(d) { return d <= 0 ? "heute" : d === 1 ? "morgen" : d === 2 ? "übermorgen" : `in ${d} Tagen`; }

/** Einzeiler für die Push-Nachricht: nur Zahlen + Baustelle, z. B. „☀️ 3 Termine, 2 Aufgaben – Baustelle Musterstraße“. */
export function pushLine(c = {}) {
  const parts = [];
  const t = n0(c.termine), a = n0(c.tasks);
  parts.push(t ? plural(t, "Termin", "Termine") : "keine Termine");
  if (a) parts.push(plural(a, "Aufgabe", "Aufgaben"));
  if (n0(c.birthdays)) parts.push(`${n0(c.birthdays)} 🎂`);
  const site = s(c.site).slice(0, 40);
  return `☀️ ${parts.join(", ")}${site ? " – " + (/^baustelle\b/i.test(site) ? site : "Baustelle " + site) : ""}`;
}

/* ---------------- Wochenrückblick ---------------- */

/**
 * f = {
 *   from, to (Mo/So der Woche),
 *   workedMin, targetMin, workDays (Tage mit Arbeit), balanceMin (Konto gesamt, optional),
 *   done: { count, top: [titles] },
 *   money: { locked: true } | { out, in } | null,
 *   lap: { streak, days } | null, jp: { streak, days } | null,  (days = Übungstage in der Woche)
 *   exams: [{ title, days }] (nächste 14 Tage), examsDone: n,
 *   nextWeek: [{ date, title, time }],
 *   habits: { best: { title, streak } } | null,
 * }
 */
export function buildWeekly(f = {}) {
  const from = s(f.from), to = s(f.to);
  const sections = [];
  const worked = n0(f.workedMin), target = n0(f.targetMin);
  const delta = worked - target;
  const wl = [{ e: "⏱️", t: `${hmText(worked)} gearbeitet`, sub: target ? `Soll ${hmText(target)}` : "kein Soll diese Woche" }];
  if (target || worked) wl.push({ e: delta >= 0 ? "📈" : "📉", t: `Überstunden ${hmText(delta, true)}`, sub: delta > 0 ? "fleißig! Gönn dir was 🍰" : delta < 0 ? "ein paar längere Tage gleichen das aus" : "genau im Soll 👌", hot: delta < -120 });
  if (n0(f.workDays)) wl.push({ e: "📆", t: `${plural(n0(f.workDays), "Arbeitstag", "Arbeitstage")}` });
  if (f.balanceMin != null && Number.isFinite(Number(f.balanceMin))) wl.push({ e: "⚖️", t: `Konto gesamt ${hmText(f.balanceMin, true)}` });
  sections.push({ id: "work", e: "🔧", h: "Arbeit", lines: wl });

  const done = f.done || {};
  sections.push({
    id: "done", e: "✅", h: "Erledigt",
    lines: n0(done.count) ? [{ e: "🎉", t: `${plural(n0(done.count), "Aufgabe", "Aufgaben")} erledigt`, sub: (done.top || []).map(s).filter(Boolean).slice(0, 3).join(" · ") }] : [],
    empty: n0(done.count) ? "" : "Diese Woche nichts abgehakt – nächste Woche wird's 💪",
  });

  if (f.money) {
    if (f.money.locked) sections.push({ id: "money", e: "💶", h: "Finanzen", lines: [{ e: "🔒", t: "Geld gesperrt – Beträge nach dem Entsperren in Alltag › Geld" }] });
    else {
      const out = n0(f.money.out), inc = n0(f.money.in);
      sections.push({ id: "money", e: "💶", h: "Finanzen", lines: [
        { e: "💸", t: `Ausgaben ${eur(out)}` },
        ...(inc ? [{ e: "💰", t: `Einnahmen ${eur(inc)}` }] : []),
      ] });
    }
  }

  const ll = [];
  for (const [k, e, label] of [["lap", "⚡", "LAP"], ["jp", "🇯🇵", "Japanisch"]]) {
    const x = f[k];
    if (!x || !(n0(x.streak) || n0(x.days))) continue;
    ll.push({ e, t: `${label}: ${plural(n0(x.days), "Lerntag", "Lerntage")}`, sub: n0(x.streak) ? `🔥 Serie ${n0(x.streak)} ${n0(x.streak) === 1 ? "Tag" : "Tage"}` : "" });
  }
  if (n0(f.examsDone)) ll.push({ e: "📝", t: `${plural(n0(f.examsDone), "Probeprüfung", "Probeprüfungen")} gemacht` });
  for (const x of (f.exams || []).slice(0, 3)) ll.push({ e: "📖", t: s(x.title) || "Prüfung", sub: dayWord(n0(x.days)), hot: n0(x.days) <= 3 });
  if (f.habits && f.habits.best && n0(f.habits.best.streak)) ll.push({ e: "🔥", t: `${s(f.habits.best.title)}: ${n0(f.habits.best.streak)} Tage in Folge` });
  if (ll.length) sections.push({ id: "learn", e: "🎓", h: "Schule & Lernen", lines: ll });

  const nw = (f.nextWeek || []).filter((t) => t && s(t.title));
  sections.push({
    id: "next", e: "🗓️", h: "Nächste Woche",
    lines: nw.slice(0, 6).map((t) => ({ e: "📌", t: s(t.title), sub: `${fmtKey(t.date)}${t.time ? " · " + s(t.time) : ""}` })),
    empty: nw.length ? "" : "Noch nichts eingetragen – eine ruhige Woche 😌",
  });
  if (nw.length > 6) sections[sections.length - 1].lines.push({ e: "➕", t: `${nw.length - 6} weitere` });

  const counts = { workedMin: worked, deltaMin: delta, done: n0(done.count), next: nw.length };
  const kw = isoWeek(from);
  const brief = { kind: "weekly", title: "Dein Wochenrückblick 📅", date: from && to ? `KW ${kw} · ${fmtKey(from)} – ${fmtKey(to)}` : "", from, to, sections, counts };
  brief.speech = speechOf(brief);
  return brief;
}

function eur(x) { return (Math.round(n0(x) * 100) / 100).toFixed(2).replace(".", ",") + " €"; }
export function isoWeek(k) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(k))) return 0;
  const d = dateOf(k);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

/* ---------------- Text fürs Vorlesen / die KI ---------------- */

const stripEmoji = (t) => String(t || "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu, "").replace(/\s+/g, " ").trim();

/** Ganz einfacher Vorlesetext ohne KI (Abschnitt: Zeilen). */
export function speechOf(brief) {
  const parts = [stripEmoji(brief.title) + "."];
  if (brief.date) parts.push(brief.date + ".");
  for (const sec of brief.sections || []) {
    if (!sec.lines.length) { if (sec.empty) parts.push(stripEmoji(sec.empty) + "."); continue; }
    parts.push(`${sec.h}: ${sec.lines.map((l) => stripEmoji(l.t + (l.sub ? ", " + l.sub : ""))).join("; ")}.`);
  }
  return parts.join(" ").replace(/\.\./g, ".");
}

/** Strukturierte Zusammenfassung für /chat (Modus "briefing"): nur das, was im Briefing steht. */
export function summaryForAi(brief) {
  const out = [`${brief.kind === "weekly" ? "WOCHENRÜCKBLICK" : "MORGEN-BRIEFING"} · ${brief.date || ""}`];
  for (const sec of brief.sections || []) {
    out.push(`## ${sec.h}`);
    if (!sec.lines.length) out.push(`- ${stripEmoji(sec.empty) || "nichts"}`);
    for (const l of sec.lines) out.push(`- ${stripEmoji(l.t)}${l.sub ? " (" + stripEmoji(l.sub) + ")" : ""}`);
  }
  return out.join("\n").slice(0, 4000);
}

export const AI_PROMPT_MORNING = "Fass mir mein Morgen-Briefing in 2 bis 4 kurzen, gesprochenen Sätzen zusammen – freundlich, motivierend, nur mit diesen Daten:";
export const AI_PROMPT_WEEKLY = "Fass mir meinen Wochenrückblick in 2 bis 4 kurzen, gesprochenen Sätzen zusammen – lob, was gut lief, und gib einen kleinen Ausblick, nur mit diesen Daten:";

/* ---------------- Wochenzahlen (Hilfen für den Aufrufer) ---------------- */

/**
 * Arbeitszeit einer Woche aus Einträgen.
 * entries: [{ start, end, pauseMin, kind, creditMin }], creditOf(e) → Minuten, targetOf(dayKey) → Soll-Minuten,
 * dayOf(ts) → "YYYY-MM-DD", untilKey: Soll nur bis zu diesem Tag zählen (inkl.).
 */
export function weekWork(entries, from, to, { creditOf, targetOf, dayOf, untilKey = to }) {
  let worked = 0, target = 0;
  const days = new Set();
  for (const e of entries || []) {
    if (!e || !Number.isFinite(Number(e.start)) || !Number.isFinite(Number(e.end))) continue;
    const k = dayOf(Number(e.start));
    if (k < from || k > to) continue;
    const c = n0(creditOf(e));
    worked += c;
    if ((!e.kind || e.kind === "work") && c > 0) days.add(k);
  }
  for (let k = from; k <= to && k <= untilKey; k = addKey(k, 1)) target += n0(targetOf(k));
  return { workedMin: Math.round(worked), targetMin: Math.round(target), workDays: days.size };
}

/** Erledigte Aufgaben (doneAt in der Woche). */
export function doneInWeek(todos, from, to, dayOf) {
  const list = (todos || []).filter((t) => t && t.done && Number(t.doneAt) > 0 && t.kind !== "termin" && t.kind !== "geburtstag" && t.kind !== "einsatz")
    .filter((t) => { const k = dayOf(Number(t.doneAt)); return k >= from && k <= to; })
    .sort((a, b) => Number(b.doneAt) - Number(a.doneAt));
  return { count: list.length, top: list.slice(0, 3).map((t) => s(t.title) || "Aufgabe") };
}

/** Übungstage in einer Woche aus srs-Statistik { days: { key: { n } } }. */
export function practiceDays(stats, from, to) {
  const days = (stats && stats.days) || {};
  let n = 0;
  for (let k = from; k <= to; k = addKey(k, 1)) if (days[k] && n0(days[k].n) > 0) n++;
  return n;
}

/** Ausgaben/Einnahmen einer Woche aus money_tx ({ type: "in"|"out", amount, date }). */
export function moneyWeek(txs, from, to) {
  let out = 0, inc = 0;
  for (const t of txs || []) {
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || "")) || t.date < from || t.date > to) continue;
    const a = Math.abs(n0(t.amount));
    if (t.type === "in") inc += a; else if (t.type === "out" || !t.type) out += a;
  }
  return { out: Math.round(out * 100) / 100, in: Math.round(inc * 100) / 100 };
}

/** Termine (kind "termin") eines Tages bzw. Zeitraums über expand(t, from, to) → Instanzen [{ date, time, title, done }]. */
export function termineBetween(todos, from, to, expand) {
  const out = [];
  for (const t of todos || []) {
    if (!t || t.kind !== "termin") continue;
    let list = [];
    try { list = expand(t, from, to) || []; } catch { list = []; }
    for (const i of list) if (i && !i.done && i.date >= from && i.date <= to) out.push({ date: i.date, time: i.allDay ? null : (i.time || null), title: s(i.title || t.title) || "Termin", location: s(i.location || t.location) });
  }
  return out.sort((a, b) => (a.date + (a.time || "00:00")).localeCompare(b.date + (b.time || "00:00")));
}

/** Offene Aufgaben (ohne Datum oder bis heute fällig). */
export function openTasks(todos, today) {
  const list = (todos || []).filter((t) => t && !t.done && !["termin", "geburtstag", "einsatz"].includes(t.kind) &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || "")) || t.date <= today))
    .sort((a, b) => ((a.date || "9999") + (a.time || "99")).localeCompare((b.date || "9999") + (b.time || "99")));
  return { open: list.length, overdue: list.filter((t) => t.date && t.date < today).length, top: list.slice(0, 3).map((t) => s(t.title) || "Aufgabe") };
}

/** Einsatz (kind "einsatz") für den Tag → { place, people } (places zum Auflösen von placeId). */
export function einsatzSite(todos, today, places = []) {
  let best = null;
  for (const t of todos || []) {
    if (!t || t.kind !== "einsatz" || !t.date) continue;
    const to = t.dateTo && t.dateTo >= t.date ? t.dateTo : t.date;
    if (today < t.date || today > to) continue;
    if (!best || n0(t.createdAt) >= n0(best.createdAt)) best = t;
  }
  if (!best) return null;
  const p = best.placeId ? (places || []).find((x) => x && x.id === best.placeId) : null;
  return { place: s((p && p.name) || best.place || best.title) || "Einsatz", placeId: p ? p.id : null, people: Array.isArray(best.people) ? best.people.map(s).filter(Boolean) : [], source: "einsatz" };
}

/** Tage bis zum nächsten Termin dieser Prüfung (0 = heute). */
export const daysUntil = (today, k) => diffDays(today, k);
