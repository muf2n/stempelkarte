// Update 10 – Alltag › 🧰 Werkzeug-Register: reine Logik ohne DOM (in Node ladbar, Tests: test/werkzeug-core.test.mjs).
// Wird von js/alltag/werkzeug.js, der Suche und dem Assistenten (tools/mcp/src/werkzeug.js) benutzt.
//
// Sammlung „werkzeug“ (js/alltag/db.js): {
//   id, name, brand (Hersteller/Modell), serial, cat, photoId?,
//   loc: { kind: "firma"|"auto"|"baustelle"|"sonst", placeId?, vehicleId?, text? },
//   holder (ausgeliehen an / verantwortlich, leer = da), history: [{ ts, op: "aus"|"rueck"|"defekt"|"repariert"|"pruefung", who?, note? }],
//   checkMonths (Prüfintervall in Monaten, 0/leer = keins), checkLabel, lastCheck ("JJJJ-MM-TT"), nextCheck? (manuell, sonst berechnet),
//   defect (bool), defectNote, notes, created, updated }

export const CATS = Object.freeze([
  { id: "akku", e: "🔋", label: "Akkuwerkzeug", months: 12, check: "E-Check / Sichtprüfung" },
  { id: "mess", e: "📟", label: "Messgerät", months: 12, check: "Kalibrierung" },
  { id: "hand", e: "🔧", label: "Handwerkzeug", months: 0, check: "Sichtprüfung" },
  { id: "leiter", e: "🪜", label: "Leiter", months: 12, check: "Leiterprüfung" },
  { id: "sonst", e: "🧰", label: "Sonstiges", months: 0, check: "Prüfung" },
]);
export const catById = (id) => CATS.find((c) => c.id === id) || CATS[CATS.length - 1];

export const LOC_KINDS = Object.freeze([
  { id: "firma", e: "🏢", label: "Firma / Lager" },
  { id: "auto", e: "🚐", label: "Im Auto" },
  { id: "baustelle", e: "🏗️", label: "Baustelle" },
  { id: "sonst", e: "📦", label: "Woanders" },
]);
export const locKindById = (id) => LOC_KINDS.find((k) => k.id === id) || LOC_KINDS[0];

export const SOON_DAYS = 30;
const HIST_MAX = 60;
const s = (v) => (v == null ? "" : String(v).trim());
const pad = (n) => String(n).padStart(2, "0");
export const isKey = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k);
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = (now = Date.now()) => keyOf(new Date(now));
export function fmtKey(k) { return isKey(k) ? `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}` : ""; }

/** Tage von a bis b (Datums-Schlüssel, ganze Tage, UTC-sicher). */
export function daysBetween(a, b) {
  const t = (k) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86400000);
}
/** Monate addieren, Tag wird auf das Monatsende gekürzt (31.01. + 1 → 28./29.02.). */
export function addMonths(key, n) {
  if (!isKey(key)) return null;
  let y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) - 1 + Math.round(Number(n) || 0);
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${pad(m + 1)}-${pad(Math.min(Number(key.slice(8, 10)), last))}`;
}

/** Werkzeug mit Standardwerten (alte/fremde Felder bleiben erhalten). */
export function normTool(x) {
  const t = x && typeof x === "object" ? x : {};
  const loc = t.loc && typeof t.loc === "object" ? t.loc : {};
  const months = Math.round(Number(t.checkMonths));
  return {
    ...t,
    id: s(t.id),
    name: s(t.name),
    brand: s(t.brand),
    serial: s(t.serial),
    cat: CATS.some((c) => c.id === t.cat) ? t.cat : "sonst",
    photoId: s(t.photoId) || null,
    loc: { kind: LOC_KINDS.some((k) => k.id === loc.kind) ? loc.kind : "firma", placeId: s(loc.placeId) || null, vehicleId: s(loc.vehicleId) || null, text: s(loc.text) },
    holder: s(t.holder),
    history: Array.isArray(t.history) ? t.history.filter((h) => h && typeof h === "object" && Number(h.ts) > 0) : [],
    checkMonths: Number.isFinite(months) && months > 0 && months <= 120 ? months : 0,
    checkLabel: s(t.checkLabel),
    lastCheck: isKey(t.lastCheck) ? t.lastCheck : null,
    nextCheck: isKey(t.nextCheck) ? t.nextCheck : null,
    defect: t.defect === true,
    defectNote: s(t.defectNote),
    notes: s(t.notes),
  };
}

/** Nächste Prüfung: manuell gesetzt, sonst letzte Prüfung + Intervall, sonst null. */
export function nextDue(tool) {
  const t = normTool(tool);
  if (t.nextCheck) return t.nextCheck;
  if (t.checkMonths && t.lastCheck) return addMonths(t.lastCheck, t.checkMonths);
  return null;
}

/**
 * Status der Prüfung → { state, due, days, label, e }
 *   state: "none" (kein Intervall) | "nie" (Intervall, aber noch kein Prüfdatum) | "ok" | "bald" (≤ soonDays) | "ueber" (überfällig)
 */
export function checkStatus(tool, today, soonDays = SOON_DAYS) {
  const t = normTool(tool);
  const due = nextDue(t);
  if (!due) {
    if (t.checkMonths) return { state: "nie", due: null, days: null, e: "📋", label: "Prüfdatum fehlt" };
    return { state: "none", due: null, days: null, e: "", label: "" };
  }
  const days = daysBetween(today, due);
  if (days < 0) return { state: "ueber", due, days, e: "⛔", label: days === -1 ? "seit gestern überfällig" : `seit ${-days} Tagen überfällig` };
  if (days <= soonDays) return { state: "bald", due, days, e: "⏰", label: days === 0 ? "heute fällig" : days === 1 ? "morgen fällig" : `in ${days} Tagen fällig` };
  return { state: "ok", due, days, e: "✅", label: `bis ${fmtKey(due)}` };
}

/** Gesamtstatus fürs Abzeichen: defekt > ausgeliehen > da. */
export function toolState(tool) {
  const t = normTool(tool);
  if (t.defect) return { id: "defekt", e: "🛠️", label: "Defekt" };
  if (t.holder) return { id: "aus", e: "🤝", label: `bei ${t.holder}` };
  return { id: "da", e: "✅", label: "Verfügbar" };
}

/** Standort als Text. places = [{id,name}], vehicles = [{id,name,plate}] */
export function locLabel(tool, places = [], vehicles = []) {
  const t = normTool(tool);
  const k = locKindById(t.loc.kind);
  if (t.loc.kind === "baustelle") {
    const p = (places || []).find((x) => x && x.id === t.loc.placeId);
    return `${k.e} ${p ? s(p.name) || "Baustelle" : t.loc.text || "Baustelle"}`;
  }
  if (t.loc.kind === "auto") {
    const v = (vehicles || []).find((x) => x && x.id === t.loc.vehicleId);
    return `${k.e} ${v ? (v.plate ? `${s(v.name)} (${v.plate})` : s(v.name)) : t.loc.text || "Im Auto"}`;
  }
  if (t.loc.kind === "sonst") return `${k.e} ${t.loc.text || k.label}`;
  return `${k.e} ${t.loc.text ? `${k.label} · ${t.loc.text}` : k.label}`;
}

/* ---------- Änderungen (geben ein neues Objekt zurück) ---------- */

const pushHist = (t, h) => [...(t.history || []), h].slice(-HIST_MAX);

/** Ausgeben / ausleihen an „who“. */
export function lend(tool, who, ts = Date.now(), note = "") {
  const t = normTool(tool);
  const w = s(who).slice(0, 60);
  if (!w) throw new Error("An wen? Bitte einen Namen angeben.");
  return { ...t, holder: w, history: pushHist(t, { ts, op: "aus", who: w, ...(s(note) ? { note: s(note).slice(0, 200) } : {}) }) };
}
/** Zurückgeben. */
export function giveBack(tool, ts = Date.now(), note = "") {
  const t = normTool(tool);
  return { ...t, holder: "", history: pushHist(t, { ts, op: "rueck", who: t.holder, ...(s(note) ? { note: s(note).slice(0, 200) } : {}) }) };
}
/** Defekt melden (note = was ist kaputt). */
export function reportDefect(tool, note, ts = Date.now()) {
  const t = normTool(tool);
  const n = s(note).slice(0, 300);
  return { ...t, defect: true, defectNote: n, history: pushHist(t, { ts, op: "defekt", ...(n ? { note: n } : {}) }) };
}
export function repaired(tool, ts = Date.now(), note = "") {
  const t = normTool(tool);
  return { ...t, defect: false, defectNote: "", history: pushHist(t, { ts, op: "repariert", ...(s(note) ? { note: s(note).slice(0, 200) } : {}) }) };
}
/** Geprüft am dateKey → lastCheck, manueller Termin entfällt (wird neu berechnet). */
export function markChecked(tool, dateKey, ts = Date.now(), note = "") {
  const t = normTool(tool);
  if (!isKey(dateKey)) throw new Error("Bitte ein gültiges Prüfdatum wählen.");
  return { ...t, lastCheck: dateKey, nextCheck: null, history: pushHist(t, { ts, op: "pruefung", date: dateKey, ...(s(note) ? { note: s(note).slice(0, 200) } : {}) }) };
}

export const HIST_LABEL = { aus: "🤝 Ausgegeben an", rueck: "↩️ Zurück von", defekt: "🛠️ Defekt gemeldet", repariert: "✨ Wieder in Ordnung", pruefung: "✅ Geprüft" };
export function histText(h) {
  const base = HIST_LABEL[h.op] || h.op;
  if (h.op === "aus" || h.op === "rueck") return `${base} ${s(h.who) || "?"}`;
  if (h.op === "pruefung" && isKey(h.date)) return `${base} am ${fmtKey(h.date)}`;
  return base;
}

/* ---------- Listen, Filter, Fälligkeiten ---------- */

const fold = (v) => s(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

/** Suchtext eines Werkzeugs (für Filter und globale Suche). */
export function searchText(tool) {
  const t = normTool(tool);
  return [t.name, t.brand, t.serial, catById(t.cat).label, t.holder, t.notes, t.defectNote, t.loc.text].filter(Boolean).join(" ");
}

/** Filter: { q, cat, view: "alle"|"faellig"|"aus"|"defekt" } → sortiert (Defekt, überfällig, bald, Name). */
export function filterTools(tools, { q = "", cat = "", view = "alle" } = {}, today = todayKey()) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const rank = { ueber: 0, bald: 1, nie: 2, ok: 3, none: 4 };
  return (tools || []).map(normTool).filter((t) => t.id && t.name)
    .filter((t) => !cat || t.cat === cat)
    .filter((t) => {
      if (view === "aus") return !!t.holder;
      if (view === "defekt") return t.defect;
      if (view === "faellig") { const c = checkStatus(t, today).state; return c === "ueber" || c === "bald"; }
      return true;
    })
    .filter((t) => { if (!words.length) return true; const h = fold(searchText(t)); return words.every((w) => h.includes(w)); })
    .map((t) => ({ t, c: checkStatus(t, today) }))
    .sort((a, b) => (b.t.defect - a.t.defect) || (rank[a.c.state] - rank[b.c.state]) || a.t.name.localeCompare(b.t.name, "de"))
    .map((x) => x.t);
}

/** Zähler für die Reiter. */
export function counts(tools, today = todayKey()) {
  const all = (tools || []).map(normTool).filter((t) => t.id && t.name);
  return {
    alle: all.length,
    faellig: all.filter((t) => ["ueber", "bald"].includes(checkStatus(t, today).state)).length,
    aus: all.filter((t) => t.holder).length,
    defekt: all.filter((t) => t.defect).length,
  };
}

/**
 * Fällige Prüfungen für Benachrichtigungen/Dashboard (ohne Datenzugriff):
 * → [{ id, name, e, due, days, state: "ueber"|"bald", label, text, hash }], überfällige zuerst.
 */
export function dueTools(tools, now = Date.now(), { soonDays = SOON_DAYS } = {}) {
  const today = todayKey(now);
  return (tools || []).map(normTool).filter((t) => t.id && t.name)
    .map((t) => ({ t, c: checkStatus(t, today, soonDays) }))
    .filter((x) => x.c.state === "ueber" || x.c.state === "bald")
    .sort((a, b) => a.c.days - b.c.days)
    .map(({ t, c }) => ({
      id: t.id, name: t.name, e: catById(t.cat).e, due: c.due, days: c.days, state: c.state, label: c.label,
      text: `${catById(t.cat).e} ${t.name}: ${t.checkLabel || catById(t.cat).check} ${c.label}`,
      hash: toolHash(t.id),
    }));
}

/* ---------- QR / Scannen ---------- */

export const toolHash = (id) => `#alltag/werkzeug/${encodeURIComponent(s(id))}`;
/** App-Adresse (ohne ?/#) + Hash zum Werkzeug. */
export function toolUrl(base, id) {
  return s(base).replace(/[?#].*$/, "") + toolHash(id);
}
/** Werkzeug-ID aus einem Hash/URL/gescanntem Text oder null. */
export function parseToolRef(text) {
  const t = s(text);
  if (!t) return null;
  const m = /#alltag\/werkzeug\/([A-Za-z0-9_%-]{1,140})/.exec(t);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return null; } }
  if (/^[A-Za-z0-9_-]{4,128}$/.test(t)) return t;
  return null;
}
/** Route im Hash: "#alltag/werkzeug/<id>" → id, "#alltag/werkzeug" → "", sonst null. */
export function routeId(hash) {
  const h = s(hash).replace(/^#/, "").split("?")[0];
  if (h === "alltag/werkzeug") return "";
  const m = /^alltag\/werkzeug\/(.+)$/.exec(h);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
