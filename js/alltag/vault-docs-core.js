// Alltag › Passwort-Tresor › Dokumente: reine Hilfsfunktionen (ohne DOM/Krypto), in Node testbar.
// Arten, Felder säubern, Ablauf-Abzeichen, Erinnerungs-Plan (unverschlüsselte Planer-Aufgaben), Größen.

export const DOC_KINDS = {
  reisepass:        { label: "Reisepass", emoji: "🛂", color: "#1D4ED8" },
  personalausweis:  { label: "Personalausweis", emoji: "🪪", color: "#0E7490" },
  fuehrerschein:    { label: "Führerschein", emoji: "🚗", color: "#DB2777" },
  lehrlingsausweis: { label: "Lehrlingsausweis", emoji: "🔧", color: "#D97706" },
  ecard:            { label: "e-card", emoji: "🏥", color: "#059669" },
  schuelerausweis:  { label: "Schülerausweis", emoji: "🎓", color: "#7C3AED" },
  versicherung:     { label: "Versicherung", emoji: "🛡️", color: "#0284C7" },
  zeugnis:          { label: "Zeugnis", emoji: "📜", color: "#B45309" },
  vertrag:          { label: "Vertrag", emoji: "✍️", color: "#4B5563" },
  sonstiges:        { label: "Sonstiges", emoji: "📄", color: "#6B7280" },
};
export const DOC_KIND_IDS = Object.keys(DOC_KINDS);
export const SIDES = { front: "Vorderseite", back: "Rückseite", page: "Seite", "": "–" };

export const IMG_MAX_SIDE = 2000;   // Dokumente müssen lesbar bleiben → größer als Baustellen-Fotos (1280)
export const IMG_QUALITY = 0.85;
export const THUMB_SIDE = 400;
export const THUMB_QUALITY = 0.72;
export const PDF_MAX = 5 * 1024 * 1024;
export const MAX_FILES = 12;
export const SOON_MONTHS = 6;
export const FREE_TIER = 1024 * 1024 * 1024; // Firestore-Gratis-Kontingent ≈ 1 GiB

const s = (v) => (v == null ? "" : String(v));
const isKey = (v) => /^\d{4}-\d{2}-\d{2}$/.test(s(v)) && !Number.isNaN(Date.parse(s(v) + "T00:00:00Z"));
const isFileId = (v) => /^[A-Za-z0-9-]{8,64}$/.test(s(v));

function normFile(f) {
  if (!f || !isFileId(f.id)) return null;
  const mime = /^image\/jpeg$|^application\/pdf$/.test(s(f.mime)) ? f.mime : "application/octet-stream";
  return {
    id: f.id,
    name: s(f.name).trim().slice(0, 140) || (mime === "application/pdf" ? "Dokument.pdf" : "Foto.jpg"),
    mime,
    size: Math.max(0, Math.round(Number(f.size) || 0)),
    chunks: Math.max(1, Math.round(Number(f.chunks) || 1)),
    enc: Math.max(0, Math.round(Number(f.enc) || 0)),
    w: Math.round(Number(f.w) || 0) || 0,
    h: Math.round(Number(f.h) || 0) || 0,
    side: Object.prototype.hasOwnProperty.call(SIDES, f.side) ? f.side : "",
    thumb: isFileId(f.thumb) ? f.thumb : null,
    thumbEnc: Math.max(0, Math.round(Number(f.thumbEnc) || 0)),
  };
}

/** Dokument-spezifische Felder (title/note/category/fav kommen aus normEntry). */
export function normDocFields(e) {
  const files = (Array.isArray(e.files) ? e.files : []).map(normFile).filter(Boolean).slice(0, MAX_FILES);
  const expires = isKey(e.expires) ? e.expires : "";
  return {
    kind: DOC_KINDS[e.kind] ? e.kind : "sonstiges",
    number: s(e.number).trim().slice(0, 60),
    issued: isKey(e.issued) ? e.issued : "",
    expires,
    authority: s(e.authority).trim().slice(0, 120),
    files,
    remind: !!(e.remind && expires),
    remId: /^[a-z0-9]{12,40}$/.test(s(e.remId)) ? e.remId : "",
  };
}

/* ---------- Datum ---------- */

export const fmtKey = (k) => (isKey(k) ? `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}` : "");
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const parts = (k) => k.split("-").map(Number);
const dayNum = (k) => { const [y, m, d] = parts(k); return Date.UTC(y, m - 1, d) / 86400000; };

/** Monate addieren (Tag wird am Monatsende gekappt: 31.05. − 3 Monate = 28./29.02.). */
export function addMonths(k, n) {
  const [y, m, d] = parts(k);
  const t = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(t / 12), nm = t - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Ganze Monate von a bis b (b ≥ a), z. B. 05.11. → 12.03. = 4. */
function monthsBetween(a, b) {
  const [ya, ma, da] = parts(a), [yb, mb, db] = parts(b);
  let n = (yb - ya) * 12 + (mb - ma);
  if (db < da) n--;
  return Math.max(0, n);
}

/**
 * Ablauf-Abzeichen → { state: "none"|"ok"|"soon"|"expired", label, days }
 * soon = innerhalb von 6 Monaten (gelb), expired = abgelaufen (rot).
 */
export function expiryInfo(expires, today = todayKey()) {
  if (!isKey(expires)) return { state: "none", label: "", days: null };
  const days = dayNum(expires) - dayNum(today);
  if (days < 0) {
    const ago = -days;
    const m = monthsBetween(expires, today);
    const label = ago === 1 ? "seit gestern abgelaufen" : m >= 1 ? `abgelaufen seit ${m} ${m === 1 ? "Monat" : "Monaten"}` : `abgelaufen seit ${ago} Tagen`;
    return { state: "expired", label, days };
  }
  const m = monthsBetween(today, expires);
  let label;
  if (days === 0) label = "läuft heute ab";
  else if (days === 1) label = "läuft morgen ab";
  else if (m < 1) label = `läuft ab in ${days} Tagen`;
  else if (m < 24) label = `läuft ab in ${m} ${m === 1 ? "Monat" : "Monaten"}`;
  else label = `gültig bis ${fmtKey(expires)}`;
  const soon = addMonths(today, SOON_MONTHS) >= expires;
  return { state: soon ? "soon" : "ok", label, days };
}

/* ---------- Erinnerung (bewusst UNverschlüsselt, nur Art + Datum) ---------- */

/** Text, der im Formular als Einverständnis-Hinweis steht. */
export function reminderNotice(kind, expires) {
  const k = (DOC_KINDS[kind] || DOC_KINDS.sonstiges).label;
  const when = fmtKey(expires) || "TT.MM.JJJJ";
  return `Für die Erinnerung wird nur ‚${k} läuft ab am ${when}‘ unverschlüsselt als Termin gespeichert – keine Nummer, kein Bild.`;
}

export const REMINDER_TIME = "09:00";
export const reminderIds = (remId) => (remId ? [`vr_${remId}_3`, `vr_${remId}_1`] : []);

/**
 * Planer-Aufgaben für ein Dokument → [{ id, title, date, … }] (Form wie store.saveTodo).
 * 3 Monate und 1 Monat vorher; Termine in der Vergangenheit werden auf heute gelegt (ohne Doppelte).
 * Enthält NUR Art und Ablaufdatum – keinen Titel, keine Nummer, keine Datei.
 */
export function reminderPlan(doc, today = todayKey()) {
  if (!doc || !doc.remind || !isKey(doc.expires) || !doc.remId) return [];
  const label = (DOC_KINDS[doc.kind] || DOC_KINDS.sonstiges).label;
  const when = fmtKey(doc.expires);
  const expired = doc.expires < today;
  const title = expired ? `${label} erneuern – abgelaufen am ${when}` : `${label} erneuern – läuft am ${when} ab`;
  const [id3, id1] = reminderIds(doc.remId);
  const out = [];
  const seen = new Set();
  for (const [id, m] of [[id3, 3], [id1, 1]]) {
    let date = addMonths(doc.expires, -m);
    if (date < today) date = today;
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({
      id, title, kind: "todo", cat: "erinnerung", date, time: REMINDER_TIME, remind: true, remindMin: 0,
      note: "Erinnerung aus dem Passwort-Tresor (Dokumente).",
    });
  }
  return out;
}

/** Abgleich mit den vorhandenen Aufgaben → { save: [todo], remove: [id] }. Unveränderte bleiben (auch „erledigt“). */
export function reminderDiff(doc, prevRemId, existing, today = todayKey()) {
  const plan = reminderPlan(doc, today);
  const want = new Map(plan.map((t) => [t.id, t]));
  const ex = new Map((existing || []).map((t) => [t.id, t]));
  const save = [];
  for (const t of plan) {
    const cur = ex.get(t.id);
    if (cur && cur.title === t.title && cur.date === t.date) continue;
    save.push({ ...t, done: false, doneAt: null });
  }
  const ids = new Set([...reminderIds(doc && doc.remId), ...reminderIds(prevRemId)]);
  const remove = [...ids].filter((id) => !want.has(id) && ex.has(id));
  return { save, remove };
}

/* ---------- Größen ---------- */

export function fmtSize(n) {
  n = Number(n) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2).replace(".", ",")} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(n ? 1 : 0, Math.round(n / 1024))} kB`;
}

/** Verschlüsselt belegter Speicher: Einträge (iv+ct) + Datei-Stücke + Vorschaubilder. */
export function usedBytes(records, entries) {
  let n = 0;
  for (const r of records || []) n += s(r.ct).length + s(r.iv).length + 80;
  for (const e of entries || []) {
    const fs = e && e.data && e.data.type === "doc" ? e.data.files : null;
    for (const f of fs || []) n += (f.enc || 0) + (f.thumbEnc || 0);
  }
  return n;
}

/** Bildgröße auf längste Seite max verkleinern (nie vergrößern). */
export function fitSize(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Untertitel für die Liste – nie die Nummer. */
export function docSubtitle(d) {
  const k = (DOC_KINDS[d.kind] || DOC_KINDS.sonstiges).label;
  const n = (d.files || []).length;
  return [k, d.expires ? "gültig bis " + fmtKey(d.expires) : "", n ? `${n} ${n === 1 ? "Datei" : "Dateien"}` : ""].filter(Boolean).join(" · ");
}
