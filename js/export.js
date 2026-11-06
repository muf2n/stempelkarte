// Export: Einträge als Excel-taugliche CSV (Semikolon, BOM) erzeugen und herunterladen/teilen.
import { WD, pad, clock, netMin, creditMin, kindLabel, dayKey, isPrivateTrip } from "./util.js";
import { entryKm, allowanceByDay } from "./travel.js";

const HEAD = ["Datum", "Wochentag", "Art", "Beginn", "Ende", "Pause (Min)", "Netto (h)",
  "Arbeitsort", "Notiz", "Mit wem", "Standort Beginn", "Standort Ende", "Abschnitte",
  "km", "Taggeld €"]; // Update 9: km + Taggeld angehängt

// Feld für CSV aufbereiten: bei ; " oder Zeilenumbruch in Anführungszeichen, " verdoppeln
function cell(v) {
  const s = v == null ? "" : String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Stunden mit Komma, zwei Nachkommastellen
function hours(min) {
  return (Math.round(min / 60 * 100) / 100).toFixed(2).replace(".", ",");
}

function kmText(km) {
  return (Math.round(km * 10) / 10).toFixed(1).replace(".", ",");
}

function money(v) {
  return (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace(".", ",");
}

function date(ts) {
  const d = new Date(ts);
  return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
}

function locText(loc) {
  if (!loc) return "";
  if (loc.addr) return loc.addr;
  if (typeof loc.lat === "number" && typeof loc.lng === "number") {
    return loc.lat.toFixed(6) + "," + loc.lng.toFixed(6);
  }
  return "";
}

// Ortsname: gespeicherter Name, sonst Adresse
function placeText(e) {
  if (e.place) return e.place;
  const l = e.inLoc || e.loc;
  return (l && l.addr) || "";
}

// "08:00-09:10 Autofahren (Hauptplatz 1, Linz); 09:10-16:30 Arbeiten (…)"
function segmentsText(e) {
  const segs = Array.isArray(e.segments) ? e.segments.filter(x => x && Number.isFinite(x.start)) : [];
  return segs.map((x, i) => {
    const end = Number.isFinite(x.end) ? x.end : (segs[i + 1] ? segs[i + 1].start : e.end);
    const pl = placeText(x);
    return clock(x.start) + "-" + (Number.isFinite(end) ? clock(end) : "") + " " +
      (x.activity || "Arbeiten") + (pl ? " (" + pl + ")" : "");
  }).join("; ");
}

function toMs(v) {
  if (v == null || v === "") return null;
  const n = v instanceof Date ? v.getTime() : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Update 10c: Zeilen (Kopf + Einträge + Summe) als Text-Zellen – Grundlage für CSV und Excel. */
export function entriesRows(entries, { from, to, settings = null, days = null, places = null } = {}) {
  const f = toMs(from), t = toMs(to);
  const list = (entries || [])
    .filter(e => e && Number.isFinite(e.start) && (f == null || e.start >= f) && (t == null || e.start < t))
    .filter(e => !isPrivateTrip(e)) // Update 9 – Privatfahrten sind keine Arbeitszeit (stehen im Fahrtenbuch)
    .sort((a, b) => a.start - b.start);

  const rows = [HEAD];
  let sumNet = 0, sumPause = 0, sumKm = 0, sumTg = 0, anyTg = false;
  // Update 9: Taggeld je Tag – steht in der ersten Arbeitszeile des Tages
  const tgMap = list.length
    ? allowanceByDay({ entries: list, places, days: days || {}, settings, dayKey }, list[0].start, list[list.length - 1].start + 1)
    : new Map();
  const tgDone = new Set();
  for (const e of list) {
    const work = !e.kind || e.kind === "work";
    const net = creditMin(e); // Abwesenheit: Gutschrift
    const pause = work ? Math.round(Number(e.pauseMin) || 0) : 0;
    sumNet += net;
    sumPause += pause;
    const km = work ? entryKm(e, settings) : 0;
    sumKm += km;
    let tg = "";
    const dk = dayKey(e.start);
    if (work && !tgDone.has(dk) && tgMap.has(dk)) {
      tgDone.add(dk);
      const d = tgMap.get(dk);
      if (d.level !== "none" && d.amount != null) { tg = money(d.amount); sumTg += d.amount; anyTg = true; }
      else if (d.level !== "none") tg = d.level === "full" ? "voll" : "teilweise"; // Betrag fehlt
    }
    rows.push([
      date(e.start),
      WD[new Date(e.start).getDay()],
      kindLabel(e.kind),
      work ? clock(e.start) : "",
      work && Number.isFinite(e.end) ? clock(e.end) : "",
      pause,
      hours(net),
      work ? placeText(e) : "",
      e.note || "",
      Array.isArray(e.people) ? e.people.filter(Boolean).join(", ") : "",
      locText(e.inLoc),
      locText(e.outLoc),
      work ? segmentsText(e) : "",
      km > 0 ? kmText(km) : "",
      tg,
    ]);
  }
  rows.push(["Summe", "", "", "", "", sumPause, hours(sumNet), "", "", "", "", "", "",
    sumKm > 0 ? kmText(sumKm) : "", anyTg ? money(sumTg) : ""]);
  return rows;
}

export function entriesCSV(entries, opts = {}) {
  const rows = entriesRows(entries, opts);
  return "\uFEFF" + rows.map(r => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

// Update 10c: echte Excel-Datei (.xlsx) – Zahlenspalten (Pause, Netto, km, Taggeld) als Zahlen.
const NUM_COLS = new Set([5, 6, 13, 14]);
const XLSX_WIDTHS = [11, 6, 13, 7, 7, 10, 9, 22, 30, 16, 24, 24, 40, 7, 10];
export function entriesXlsxRows(entries, opts = {}) {
  return entriesRows(entries, opts).map((r, ri) => r.map((v, ci) => {
    if (ri === 0 || !NUM_COLS.has(ci)) return v;
    if (typeof v === "number") return v;
    const t = String(v ?? "");
    return /^-?\d+(,\d+)?$/.test(t) ? Number(t.replace(",", ".")) : t;
  }));
}
export async function entriesXlsx(entries, opts = {}, extraSheets = []) {
  const { buildXlsx } = await import("./xlsx.js");
  return buildXlsx([{ name: opts.sheetName || "Arbeitszeiten", rows: entriesXlsxRows(entries, opts), widths: XLSX_WIDTHS }, ...extraSheets]);
}

// Update 9 – Fahrtenbuch (klassisches österreichisches Format): Kopf + Zeilen aus trip-core.logRows,
// danach Summenzeilen. Gleiche Konventionen wie oben (Semikolon, BOM, CRLF).
export function fahrtenbuchCSV(head, rows, sums = []) {
  const all = [head, ...rows, ...(sums.length ? [[], ...sums] : [])];
  return "\uFEFF" + all.map(r => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

export function download(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const standalone = (typeof navigator !== "undefined" && navigator.standalone === true) ||
    (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  const isIOS = typeof navigator !== "undefined" &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  // iOS-Homescreen-App: <a download> klappt oft nicht → Teilen-Menü verwenden, wenn möglich
  if (isIOS && standalone && typeof File === "function" && navigator.share) {
    try {
      const file = new File([blob], filename, { type: mime });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: filename }).catch(err => {
          if (err && err.name === "AbortError") return; // Nutzer hat abgebrochen
          anchorDownload(blob, filename);
        });
      }
    } catch (_) { /* weiter mit normalem Download */ }
  }
  anchorDownload(blob, filename);
  return Promise.resolve();
}

function anchorDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}
