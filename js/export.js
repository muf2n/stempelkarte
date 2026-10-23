// Export: Einträge als Excel-taugliche CSV (Semikolon, BOM) erzeugen und herunterladen/teilen.
import { WD, pad, clock, netMin } from "./util.js";

const HEAD = ["Datum", "Wochentag", "Beginn", "Ende", "Pause (Min)", "Netto (h)",
  "Arbeitsort", "Notiz", "Standort Beginn", "Standort Ende"];

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
    const net = netMin(e);
    const pause = Math.round(Number(e.pauseMin) || 0);
    sumNet += net;
    sumPause += pause;
    rows.push([
      date(e.start),
      WD[new Date(e.start).getDay()],
      clock(e.start),
      Number.isFinite(e.end) ? clock(e.end) : "",
      pause,
      hours(net),
      e.place || "",
      e.note || "",
      locText(e.inLoc),
      locText(e.outLoc),
    ]);
  }
  rows.push(["Summe", "", "", "", sumPause, hours(sumNet), "", "", "", ""]);

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
