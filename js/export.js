// Export: Einträge als Excel-taugliche CSV (Semikolon, BOM) erzeugen und herunterladen/teilen.
import { WD, pad, clock, netMin, creditMin, kindLabel } from "./util.js";

const HEAD = ["Datum", "Wochentag", "Art", "Beginn", "Ende", "Pause (Min)", "Netto (h)",
  "Arbeitsort", "Notiz", "Standort Beginn", "Standort Ende", "Abschnitte"];

// Feld für CSV aufbereiten: bei ; " oder Zeilenumbruch in Anführungszeichen, " verdoppeln
function cell(v) {
  const s = v == null ? "" : String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Stunden mit Komma, zwei Nachkommastellen
function hours(min) {
  return (Math.round(min / 60 * 100) / 100).toFixed(2).replace(".", ",");
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

export function entriesCSV(entries, { from, to } = {}) {
  const f = toMs(from), t = toMs(to);
  const list = (entries || [])
    .filter(e => e && Number.isFinite(e.start) && (f == null || e.start >= f) && (t == null || e.start < t))
    .sort((a, b) => a.start - b.start);

  const rows = [HEAD];
  let sumNet = 0, sumPause = 0;
  for (const e of list) {
    const work = !e.kind || e.kind === "work";
    const net = creditMin(e); // Abwesenheit: Gutschrift
    const pause = work ? Math.round(Number(e.pauseMin) || 0) : 0;
    sumNet += net;
    sumPause += pause;
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
      locText(e.inLoc),
      locText(e.outLoc),
      work ? segmentsText(e) : "",
    ]);
  }
  rows.push(["Summe", "", "", "", "", sumPause, hours(sumNet), "", "", "", "", ""]);

  return "﻿" + rows.map(r => r.map(cell).join(";")).join("\r\n") + "\r\n";
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
