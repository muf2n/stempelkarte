// Update 10b – Smart Dashboard (Reiter Heute): reine Logik ohne DOM, unit-getestet (test/dashboard-core.test.mjs).
// Widgets, Einstellungen lesen (settings.dashboard = { order, hidden, auto }), Kontext erkennen,
// Reihenfolge je Kontext und regelbasierte Tipps aus echten Daten (keine KI-Anfrage).

/** Alle Widgets in Standard-Reihenfolge. */
export const WIDGETS = [
  { id: "balance",   e: "⚖️", t: "Überstundenstand" },
  { id: "agenda",    e: "📌", t: "Nächster Termin & Aufgaben" },
  { id: "calendar",  e: "🗓️", t: "Die nächsten Tage" },
  { id: "site",      e: "🔧", t: "Aktuelle Baustelle" },
  { id: "money",     e: "💶", t: "Finanzen" },
  { id: "school",    e: "🎒", t: "Prüfungen & Hausaufgaben" },
  { id: "einkauf",   e: "🛒", t: "Einkauf" }, // Update 10 – Einkaufsliste
  { id: "faellig",   e: "🧰", t: "Werkzeug & Auto fällig" }, // Update 10 – Werkzeug-Register / Fahrzeuge
  { id: "reminders", e: "🔔", t: "Erinnerungen" },
  { id: "tip",       e: "💡", t: "Tipp" },
  { id: "sync",      e: "☁️", t: "Sync-Status" },
];
export const IDS = WIDGETS.map((w) => w.id);
export const DEFAULT_ORDER = IDS.slice();
export const widgetById = (id) => WIDGETS.find((w) => w.id === id) || null;

/** Reihenfolge je Kontext (Automatisch sortieren). */
export const CONTEXT_ORDER = {
  work:    ["site", "balance", "tip", "agenda", "faellig", "calendar", "reminders", "school", "einkauf", "money", "sync"],
  school:  ["school", "tip", "agenda", "calendar", "reminders", "balance", "einkauf", "faellig", "money", "site", "sync"],
  private: ["agenda", "calendar", "reminders", "einkauf", "faellig", "money", "tip", "school", "balance", "site", "sync"],
  day:     ["agenda", "site", "balance", "tip", "calendar", "faellig", "einkauf", "school", "reminders", "money", "sync"],
};
export const CONTEXT_LABEL = {
  work: "🔧 Arbeitsmodus",
  school: "🎒 Schulabend",
  private: "🏡 Feierabend & Freizeit",
  day: "☀️ Dein Tag",
};

/** Ids bereinigen: nur bekannte, ohne Doppelte. */
function cleanIds(list) {
  const out = [];
  for (const id of Array.isArray(list) ? list : []) if (IDS.includes(id) && !out.includes(id)) out.push(id);
  return out;
}

/** settings.dashboard mit Standardwerten: { order (vollständig), hidden, auto }. */
export function readDashboard(settings) {
  const d = (settings && settings.dashboard && typeof settings.dashboard === "object") ? settings.dashboard : {};
  const order = cleanIds(d.order);
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id); // neue Widgets hinten anhängen
  return { order, hidden: cleanIds(d.hidden), auto: d.auto !== false };
}

/** Zum Speichern (store.saveSettings({ dashboard })). */
export function dashboardForSave(cfg) {
  const c = readDashboard({ dashboard: cfg });
  return { order: c.order, hidden: c.hidden, auto: c.auto };
}

/**
 * Kontext aus Fakten:
 *  f = { now (ms|Date), running (bool), workDays ([0..6]), schoolToday (bool), schoolTomorrow (bool), holidayToday (bool) }
 *  → "work" (eingestempelt) | "school" (Abend vor Schultag / Schulvormittag) | "private" (nach der Arbeit, Wochenende, Feiertag) | "day"
 */
export function detectContext(f = {}) {
  const d = new Date(f.now instanceof Date ? f.now.getTime() : Number(f.now) || Date.now());
  const h = d.getHours();
  if (f.running) return "work";
  if (f.schoolTomorrow && h >= 16) return "school";
  if (f.schoolToday && h < 15) return "school";
  const wd = Array.isArray(f.workDays) ? f.workDays : [1, 2, 3, 4, 5];
  if (f.holidayToday || !wd.includes(d.getDay())) return "private";
  if (h >= 16 || h < 5) return "private";
  return "day";
}

/** Sichtbare Widgets in der richtigen Reihenfolge. available = Set/Array der Widgets mit Datenquelle (optional). */
export function arrange(cfg, context, available = null) {
  const c = readDashboard({ dashboard: cfg });
  const base = c.auto ? (CONTEXT_ORDER[context] || c.order) : c.order;
  const avail = available ? new Set(available) : null;
  return cleanIds(base).filter((id) => !c.hidden.includes(id) && (!avail || avail.has(id)));
}

/** Widget um eine Stelle verschieben (dir −1 = hoch, +1 = runter) → neue Reihenfolge (vollständig). */
export function moveWidget(order, id, dir) {
  const o = readDashboard({ dashboard: { order } }).order;
  const i = o.indexOf(id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= o.length) return o;
  [o[i], o[j]] = [o[j], o[i]];
  return o;
}

/** Widget ein-/ausblenden → neue hidden-Liste. */
export function toggleHidden(hidden, id, hide) {
  const h = cleanIds(hidden).filter((x) => x !== id);
  if (hide && IDS.includes(id)) h.push(id);
  return h;
}

const H = 3600000;

/**
 * Regelbasierte Tipps aus echten Daten – wichtigste zuerst, höchstens `max`.
 * f = {
 *   now, running: { start, pauseMs, pauseStart } | null, netMs (Arbeitszeit der laufenden Schicht),
 *   schoolTomorrow: "Berufsschule" | null, holidayTomorrow: string | null,
 *   examSoon: { title, days } | null, tasksOverdue: n, birthdayToday: "Name" | null,
 *   balanceMin: number | null, offline: bool, openMaterial: n, weekend: bool,
 *   weekReportDue: bool (Update 10 – Freitagnachmittag, Wochenbericht noch nicht abgegeben)
 * }
 */
export function pickTips(f = {}, max = 2) {
  const out = [];
  const d = new Date(f.now instanceof Date ? f.now.getTime() : Number(f.now) || Date.now());
  const h = d.getHours();
  const r = f.running;
  if (r && r.pauseStart == null) {
    const net = Number(f.netMs) || 0;
    const noPause = !(Number(r.pauseMs) > 0);
    if (noPause && net >= 5 * H) out.push({ id: "pause", e: "☕", text: `Seit ${Math.floor(net / H)} h keine Pause – gönn dir kurz was!` });
    else if (net >= 9.5 * H) out.push({ id: "long", e: "🛑", text: "Schon über 9½ h gearbeitet – denk an deinen Feierabend." });
  }
  if (f.birthdayToday) out.push({ id: "bday", e: "🎂", text: `${f.birthdayToday} hat heute Geburtstag – schick liebe Grüße!` });
  if (f.examSoon && f.examSoon.days <= 2) {
    const when = f.examSoon.days <= 0 ? "heute" : f.examSoon.days === 1 ? "morgen" : "übermorgen";
    out.push({ id: "exam", e: "📖", text: `${f.examSoon.title} ist ${when} – kurz wiederholen lohnt sich.` });
  }
  if (f.schoolTomorrow && h >= 12) out.push({ id: "school", e: "🎒", text: `Morgen ${f.schoolTomorrow} – Tasche schon gepackt?` });
  if (f.holidayTomorrow) out.push({ id: "hol", e: "🎌", text: `Morgen ist ${f.holidayTomorrow} – schönen freien Tag!` });
  if (Number(f.tasksOverdue) > 0) out.push({ id: "overdue", e: "📝", text: f.tasksOverdue === 1 ? "1 Aufgabe ist überfällig – kurz erledigen?" : `${f.tasksOverdue} Aufgaben sind überfällig – kurz durchschauen?` });
  if (r && Number(f.openMaterial) > 0) out.push({ id: "mat", e: "🧰", text: `${f.openMaterial} Material${f.openMaterial === 1 ? "" : "ien"} für diese Baustelle noch offen.` });
  if (f.weekReportDue) out.push({ id: "wr", e: "📋", text: "Wochenbericht fertig machen? Dein Entwurf fürs Berichtsheft wartet schon ✨", act: "wr" }); // Update 10
  if (f.offline) out.push({ id: "offline", e: "📴", text: "Du bist offline – deine Änderungen werden später synchronisiert." });
  const bal = Number(f.balanceMin);
  if (f.balanceMin != null && Number.isFinite(bal) && !r) {
    if (bal >= 40 * 60) out.push({ id: "plus", e: "🌴", text: "Über 40 Überstunden – vielleicht Zeitausgleich einplanen?" });
    else if (bal <= -10 * 60) out.push({ id: "minus", e: "⏳", text: "Dein Konto ist über 10 h im Minus – ein paar längere Tage helfen." });
  }
  if (!out.length && f.weekend && !r) out.push({ id: "weekend", e: "🌿", text: "Wochenende – lass die Arbeit ruhig mal liegen." });
  return out.slice(0, Math.max(0, max));
}
