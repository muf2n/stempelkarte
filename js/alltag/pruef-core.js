// Update 14 – ⚡ Prüfprotokoll (Erstprüfung/Wiederholungsprüfung nach ÖVE/ÖNORM E 8101 Teil 6) – reine Logik (kein DOM).
// Hinweis: Das ist eine Dokumentations- und Lernhilfe. Den rechtsgültigen Prüfbefund unterschreibt die befugte Fachkraft;
// maßgeblich sind die aktuelle Norm, die Herstellerangaben und das Messgerät.
//
// Sammlung „pruefungen“:
//   { id, placeId, kunde, adresse, art: neu|erweiterung|wiederholung, netz: TN-C-S|TN-S|TT, u0 (V), date, pruefer, geraet,
//     besichtigung: { key: true }, erproben: { key: true }, ra (Ω, nur TT), drehfeld: ""|"rechts"|"links",
//     circuits: [{ id, nr, name, schutz: "B"|"C"|"D"|"gG"|"", in (A), ia (A, nur gG manuell), mm2, rcd: "" | "30"|"100"|"300" (mA), rcdTyp: A|F|B|AC, rcdS (selektiv),
//                  riso (MΩ), uiso (V Messspannung), rpe (Ω), zs (Ω), rcdT (ms), rcdI (mA), ub (V), note }],
//     befund: "", maengel: "", status: entwurf|fertig, created, updated }

const s = (v) => (v == null ? "" : String(v)).trim();
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => { if (v == null || s(v) === "") return null; const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const ARTEN = [["neu", "Erstprüfung (Neuanlage)"], ["erweiterung", "Erstprüfung (Erweiterung/Änderung)"], ["wiederholung", "Wiederkehrende Prüfung"]];
export const NETZE = ["TN-C-S", "TN-S", "TT"];
export const SCHUTZ = [["B", "LS B"], ["C", "LS C"], ["D", "LS D"], ["gG", "Sicherung gG"], ["", "–"]];
export const RCD_TYPEN = ["A", "F", "B", "AC"];

/** Besichtigen (Auszug der wichtigsten Punkte). */
export const BESICHTIGUNG = [
  ["schutzart", "Schutzmaßnahmen gegen direktes Berühren (Abdeckungen, Gehäuse, IP-Schutz) vorhanden"],
  ["auswahl", "Betriebsmittel richtig ausgewählt und unbeschädigt"],
  ["leitungen", "Leitungen: Querschnitte, Farben (PE grün-gelb, N blau), Verlegeart passend"],
  ["schutzorgane", "Schutzorgane passend zu Querschnitt und Last, beschriftet"],
  ["verteiler", "Verteiler beschriftet, Stromkreisliste vorhanden"],
  ["potential", "Schutzpotentialausgleich (Haupterdungsschiene) vorhanden und angeschlossen"],
  ["nassraum", "Bad/Nassraum: Schutzbereiche eingehalten, zusätzl. Potentialausgleich falls nötig"],
  ["brand", "Brandabschottungen / Durchführungen in Ordnung"],
  ["klemmen", "Klemmstellen fest, keine blanken Adern außerhalb der Klemmen"],
  ["doku", "Unterlagen: Schaltpläne, Anlagenbuch, Herstellerangaben"],
];
/** Erproben. */
export const ERPROBEN = [
  ["rcdtaste", "FI/RCD-Prüftaste ausgelöst"],
  ["funktion", "Schalter, Taster, Steuerungen funktionieren"],
  ["drehfeld", "Drehfeld bei Drehstrom-Steckdosen geprüft"],
  ["notaus", "Not-Aus / Hauptschalter funktioniert (falls vorhanden)"],
];

/**
 * Grenzwerte (Richtwerte nach ÖVE/ÖNORM E 8101 Teil 6 bzw. HD 60364-6):
 *  - Isolationswiderstand: SELV/PELV (Prüfspannung 250 V DC) ≥ 0,5 MΩ; bis 500 V Nennspannung (500 V DC) ≥ 1 MΩ; über 500 V (1000 V DC) ≥ 1 MΩ.
 *  - Abschaltbedingung TN: Zs ≤ U0 / Ia; Ia für LS: B = 5·In, C = 10·In, D = 20·In (Abschaltung in ≤ 0,4 s bei Endstromkreisen ≤ 32 A).
 *    Weil die Leitung im Betrieb warm wird, ist ein gemessener Wert über 2/3 des Grenzwerts „knapp“ (Hinweis, kein Fehler).
 *  - RCD unverzögert: Auslösezeit bei IΔn ≤ 300 ms; selektiv (S): 130–500 ms. Auslösestrom zwischen 0,5·IΔn und IΔn.
 *  - Berührungsspannung UB ≤ 50 V (AC). TT: RA · IΔn ≤ 50 V.
 *  - Schutzleiter-Durchgang: keine feste Grenze – Richtwert ≤ 1 Ω für übliche Hausinstallationen (Hinweis).
 */
export const UL = 50;
export function rIsoMin(uiso) { return Number(uiso) === 250 ? 0.5 : 1; }
export function ia(c) {
  const In = num(c.in);
  if (c.schutz === "gG") return num(c.ia);
  if (!In) return null;
  return { B: 5, C: 10, D: 20 }[c.schutz] ? In * { B: 5, C: 10, D: 20 }[c.schutz] : null;
}
export function zsMax(c, u0 = 230) { const a = ia(c); return a ? Math.round((u0 / a) * 100) / 100 : null; }

/** Bewertung eines Stromkreises → { checks: [{ key, label, value, limit, state: ok|knapp|fehler|offen }], state } */
export function evalCircuit(c0, { netz = "TN-C-S", u0 = 230 } = {}) {
  const c = normCircuit(c0);
  const out = [];
  const add = (key, label, value, limit, state) => out.push({ key, label, value, limit, state });
  // Isolation
  if (c.riso == null) add("riso", "Isolationswiderstand", null, `≥ ${String(rIsoMin(c.uiso)).replace(".", ",")} MΩ`, "offen");
  else add("riso", "Isolationswiderstand", `${fmt(c.riso)} MΩ`, `≥ ${fmt(rIsoMin(c.uiso))} MΩ`, c.riso >= rIsoMin(c.uiso) ? "ok" : "fehler");
  // Schutzleiter
  if (c.rpe == null) add("rpe", "Schutzleiter-Durchgang", null, "Richtwert ≤ 1 Ω", "offen");
  else add("rpe", "Schutzleiter-Durchgang", `${fmt(c.rpe)} Ω`, "Richtwert ≤ 1 Ω", c.rpe <= 1 ? "ok" : "knapp");
  // Schleifenimpedanz (TN)
  if (netz !== "TT") {
    const zm = zsMax(c, u0);
    if (c.zs == null || zm == null) add("zs", "Schleifenimpedanz Zs", c.zs == null ? null : `${fmt(c.zs)} Ω`, zm ? `≤ ${fmt(zm)} Ω` : "Schutzorgan angeben", c.zs == null || zm == null ? "offen" : "ok");
    else add("zs", "Schleifenimpedanz Zs", `${fmt(c.zs)} Ω`, `≤ ${fmt(zm)} Ω`, c.zs > zm ? "fehler" : c.zs > (zm * 2) / 3 ? "knapp" : "ok");
  }
  // RCD
  if (c.rcd) {
    const idn = Number(c.rcd);
    const tMax = c.rcdS ? 500 : 300, tMin = c.rcdS ? 130 : 0;
    if (c.rcdT == null) add("rcdT", "FI-Auslösezeit bei IΔn", null, c.rcdS ? "130–500 ms" : "≤ 300 ms", "offen");
    else add("rcdT", "FI-Auslösezeit bei IΔn", `${fmt(c.rcdT)} ms`, c.rcdS ? "130–500 ms" : "≤ 300 ms", c.rcdT <= tMax && c.rcdT >= tMin ? "ok" : "fehler");
    if (c.rcdI != null) add("rcdI", "FI-Auslösestrom", `${fmt(c.rcdI)} mA`, `${fmt(idn / 2)}–${idn} mA`, c.rcdI <= idn && c.rcdI >= idn / 2 ? "ok" : "fehler");
    if (c.ub != null) add("ub", "Berührungsspannung UB", `${fmt(c.ub)} V`, `≤ ${UL} V`, c.ub <= UL ? "ok" : "fehler");
  }
  const st = out.some((x) => x.state === "fehler") ? "fehler" : out.some((x) => x.state === "offen") ? "offen" : out.some((x) => x.state === "knapp") ? "knapp" : "ok";
  return { checks: out, state: st };
}
/** TT-Anlage: Erdungswiderstand RA · IΔn ≤ 50 V (größter IΔn der Anlage). */
export function evalRa(p) {
  const ra = num(p.ra);
  if (p.netz !== "TT") return null;
  const idn = Math.max(0, ...(p.circuits || []).map((c) => Number(c.rcd) || 0)) / 1000;
  if (ra == null || !idn) return { value: ra, limit: idn ? Math.round(UL / idn) : null, state: "offen" };
  const lim = Math.round(UL / idn);
  return { value: ra, limit: lim, state: ra <= lim ? "ok" : "fehler" };
}

export function normCircuit(x = {}) {
  const sch = SCHUTZ.some((y) => y[0] === x.schutz) ? x.schutz : "B";
  return {
    id: s(x.id) || nid(), nr: s(x.nr).slice(0, 10), name: s(x.name).slice(0, 60), schutz: sch, in: num(x.in), ia: num(x.ia), mm2: num(x.mm2),
    rcd: ["30", "100", "300", "500"].includes(String(x.rcd)) ? String(x.rcd) : "", rcdTyp: RCD_TYPEN.includes(x.rcdTyp) ? x.rcdTyp : "A", rcdS: !!x.rcdS,
    riso: num(x.riso), uiso: Number(x.uiso) === 250 ? 250 : Number(x.uiso) === 1000 ? 1000 : 500, rpe: num(x.rpe), zs: num(x.zs), rcdT: num(x.rcdT), rcdI: num(x.rcdI), ub: num(x.ub),
    note: s(x.note).slice(0, 200),
  };
}
export function normProt(x = {}) {
  const pick = (o, list) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k, v]) => v && list.some((l) => l[0] === k)));
  return {
    id: s(x.id), placeId: s(x.placeId), kunde: s(x.kunde).slice(0, 80), adresse: s(x.adresse).slice(0, 120),
    art: ARTEN.some((a) => a[0] === x.art) ? x.art : "neu", netz: NETZE.includes(x.netz) ? x.netz : "TN-C-S", u0: Number(x.u0) === 220 ? 220 : 230,
    date: RE_KEY.test(s(x.date)) ? x.date : "", pruefer: s(x.pruefer).slice(0, 60), geraet: s(x.geraet).slice(0, 80),
    besichtigung: pick(x.besichtigung, BESICHTIGUNG), erproben: pick(x.erproben, ERPROBEN), ra: num(x.ra), drehfeld: ["rechts", "links"].includes(x.drehfeld) ? x.drehfeld : "",
    circuits: (Array.isArray(x.circuits) ? x.circuits : []).slice(0, 80).map(normCircuit), befund: s(x.befund).slice(0, 2000), maengel: s(x.maengel).slice(0, 2000),
    status: x.status === "fertig" ? "fertig" : "entwurf", created: Number(x.created) || 0, updated: Number(x.updated) || 0,
  };
}
/** Gesamtergebnis eines Protokolls. */
export function evalProt(p0) {
  const p = normProt(p0);
  const cs = p.circuits.map((c) => ({ c, r: evalCircuit(c, p) }));
  const ra = evalRa(p);
  const fail = cs.filter((x) => x.r.state === "fehler"), open = cs.filter((x) => x.r.state === "offen"), warn = cs.filter((x) => x.r.state === "knapp");
  const visOk = BESICHTIGUNG.filter(([k]) => p.besichtigung[k]).length, erpOk = ERPROBEN.filter(([k]) => p.erproben[k]).length;
  const state = fail.length || (ra && ra.state === "fehler") || p.drehfeld === "links" ? "fehler" : open.length || !cs.length || (ra && ra.state === "offen") ? "offen" : "ok";
  return { circuits: cs, ra, fail: fail.length, open: open.length, warn: warn.length, visOk, visAll: BESICHTIGUNG.length, erpOk, erpAll: ERPROBEN.length, state };
}

/** Stromkreise schnell aus einer Liste anlegen: „1 Licht Küche B10 1,5“, „F2 Steckdosen Bad C16 2,5 FI30“. */
export function parseCircuitLine(line) {
  const t = s(line);
  if (!t) return null;
  const m = /([BCD])\s?(\d{1,3})\b/i.exec(t), g = /\bgG\s?(\d{1,3})\b/i.exec(t), q = /(\d+(?:[.,]\d+)?)\s*(?:mm²|mm2|qmm)?\s*$/i.exec(t.replace(/\bFI\s?\d+.*$/i, "").trim());
  const fi = /\b(?:FI|RCD)\s?(\d{2,3})\b/i.exec(t);
  const nr = /^([A-Z]?\d{1,3}[a-z]?)\b/i.exec(t);
  let name = t.replace(/^([A-Z]?\d{1,3}[a-z]?)\s+/i, "").replace(/\b([BCD])\s?\d{1,3}\b.*$/i, "").replace(/\bgG\s?\d{1,3}\b.*$/i, "").trim();
  return normCircuit({ nr: nr ? nr[1] : "", name: name || t, schutz: m ? m[1].toUpperCase() : g ? "gG" : "B", in: m ? m[2] : g ? g[1] : null,
    mm2: q && (m || g) && Number(q[1].replace(",", ".")) <= 240 && !(m && q[1] === m[2]) ? q[1] : null, rcd: fi ? fi[1] : "" });
}

export const fmt = (v) => (v == null ? "–" : String(Math.round(Number(v) * 1000) / 1000).replace(".", ","));
export const STATE_E = { ok: "✅", knapp: "⚠️", fehler: "❌", offen: "⏳" };
