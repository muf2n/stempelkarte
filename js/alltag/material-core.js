// Update 9 – Material: reine Logik ohne DOM (auch vom Claude-Server tools/mcp genutzt – dort per Re-Export).
// Katalog (österreichische Elektriker-Begriffe), unscharfe Suche (umlaut-/schreibweisen-tolerant, „3x1,5“ findet
// „NYM-J 3×1,5“), Mengen-Text, Zusammenfassung pro Baustelle, Teilen-Text, CSV.
//
// material_items: { id, name, qty, unit, status ("brauche"|"besorgt"|"verbaut"), placeId|null, place, dayKey,
//                   entryId|null, note, photoId|null, catalogId|null, created, updated, doneAt }
// material_catalog: { id ("b_<katalog-id>" für eingebaute, sonst frei), name, unit, group, own, fav, count, lastUsed }

export const UNITS = ["Stk", "m", "Pkg", "Rolle", "kg", "l", "Satz"];
export const STATUSES = ["brauche", "besorgt", "verbaut"];
export const STATUS_LABEL = { brauche: "Brauche ich", besorgt: "Besorgt", verbaut: "Verbaut" };
export const OWN_GROUP = "Eigene";

/* ---------- Katalog ---------- */

// [Name, Einheit, Suchbegriffe (Synonyme, umgangssprachlich)]
const G = {
  "Kabel & Leitungen": [
    ["NYM-J 3×1,5", "m", "nym 3x1.5 mantelleitung kabel"],
    ["NYM-J 5×1,5", "m", "nym 5x1.5 mantelleitung kabel"],
    ["NYM-J 3×2,5", "m", "nym 3x2.5 mantelleitung kabel"],
    ["NYM-J 5×2,5", "m", "nym 5x2.5 mantelleitung kabel"],
    ["NYM-J 5×6", "m", "nym 5x6 mantelleitung kabel"],
    ["YSLY-JZ Steuerleitung", "m", "ysly steuerleitung oelflex"],
    ["J-Y(St)Y 2×2×0,8", "m", "jysty fernmeldekabel telefonkabel 2x2x0.8 klingel"],
    ["H07V-K 1,5 (Farbe)", "m", "h07vk 1.5 einzelader litze aderleitung"],
    ["H07V-K 2,5 (Farbe)", "m", "h07vk 2.5 einzelader litze aderleitung"],
    ["H07V-K 6 (Farbe)", "m", "h07vk 6 einzelader litze aderleitung"],
    ["H07V-K 16 (Farbe)", "m", "h07vk 16 einzelader litze aderleitung erdung"],
    ["CAT 7 Netzwerkkabel", "m", "cat7 lan datenkabel netzwerk"],
    ["Koaxkabel", "m", "koax antennenkabel sat"],
  ],
  "Rohr & Kanal": [
    ["Flexrohr M16", "m", "leerrohr wellrohr m16 16mm"],
    ["Flexrohr M20", "m", "leerrohr wellrohr m20 20mm"],
    ["Flexrohr M25", "m", "leerrohr wellrohr m25 25mm"],
    ["Flexrohr M32", "m", "leerrohr wellrohr m32 32mm"],
    ["Isorohr", "m", "isolierrohr starr rohr"],
    ["Kabelkanal", "m", "kanal leiste brüstungskanal"],
    ["Kabelschellen", "Pkg", "schellen nagelschellen rohrschellen"],
    ["Kabelbinder", "Pkg", "binder strapse"],
  ],
  "Dosen": [
    ["Unterputzdose", "Stk", "up dose schalterdose gerätedose"],
    ["Hohlwanddose", "Stk", "hw dose rigips gipskarton"],
    ["Abzweigdose", "Stk", "verteilerdose ap dose"],
    ["Feuchtraum-Abzweigdose", "Stk", "fr dose aufputz ip65"],
  ],
  "Schalter & Steckdosen": [
    ["Schuko-Steckdose", "Stk", "steckdose schutzkontakt"],
    ["Doppelsteckdose", "Stk", "steckdose 2fach doppel"],
    ["Feuchtraumsteckdose", "Stk", "fr steckdose aufputz ip44"],
    ["Ausschalter", "Stk", "schalter aus"],
    ["Wechselschalter", "Stk", "schalter wechsel"],
    ["Kreuzschalter", "Stk", "schalter kreuz"],
    ["Serienschalter", "Stk", "schalter serie"],
    ["Taster", "Stk", "tastschalter"],
    ["Rahmen 1-fach", "Stk", "abdeckrahmen 1fach"],
    ["Rahmen 2-fach", "Stk", "abdeckrahmen 2fach"],
    ["Rahmen 3-fach", "Stk", "abdeckrahmen 3fach"],
    ["Abdeckung / Wippe", "Stk", "wippe zentralplatte abdeckung"],
    ["Jalousieschalter", "Stk", "rollladen jalousie taster"],
    ["Bewegungsmelder", "Stk", "pir melder präsenzmelder"],
  ],
  "Verteiler": [
    ["LS-Schalter B10", "Stk", "sicherung ls leitungsschutzschalter b10"],
    ["LS-Schalter B13", "Stk", "sicherung ls leitungsschutzschalter b13"],
    ["LS-Schalter B16", "Stk", "sicherung ls leitungsschutzschalter b16"],
    ["LS-Schalter C16", "Stk", "sicherung ls leitungsschutzschalter c16"],
    ["FI/RCD 40A 30mA 2-polig", "Stk", "fi schutzschalter rcd 2p"],
    ["FI/RCD 40A 30mA 4-polig", "Stk", "fi schutzschalter rcd 4p"],
    ["FI/LS-Kombi", "Stk", "fi ls kombi rcbo"],
    ["Hauptschalter", "Stk", "lasttrennschalter hauptschalter"],
    ["Überspannungsschutz", "Stk", "ueberspannung blitzschutz spd"],
    ["Phasenschiene / Sammelschiene", "Stk", "sammelschiene phasenschiene kamm"],
    ["N/PE-Klemmen", "Stk", "n klemme pe klemme schutzleiter"],
    ["Reihenklemmen", "Stk", "klemmen hutschiene"],
    ["Kleinverteiler", "Stk", "verteiler verteilerkasten unterverteiler"],
    ["Blindabdeckung", "Stk", "blindstreifen abdeckstreifen"],
  ],
  "Klemmen": [
    ["Wago 221-412", "Stk", "wago 2er klemme hebelklemme 412"],
    ["Wago 221-413", "Stk", "wago 3er klemme hebelklemme 413"],
    ["Wago 221-415", "Stk", "wago 5er klemme hebelklemme 415"],
    ["Lüsterklemme", "Stk", "luesterklemme klemmleiste"],
    ["Aderendhülsen 1,5", "Pkg", "aderendhuelse 1.5 hülsen"],
    ["Aderendhülsen 2,5", "Pkg", "aderendhuelse 2.5 hülsen"],
  ],
  "Beleuchtung": [
    ["LED-Leuchte", "Stk", "leuchte lampe deckenleuchte"],
    ["Einbauspot", "Stk", "spot downlight einbauleuchte"],
    ["Leuchtmittel E27", "Stk", "birne glühbirne e27 led"],
    ["Leuchtmittel GU10", "Stk", "birne gu10 led spot"],
    ["Trafo / LED-Treiber", "Stk", "treiber netzteil trafo"],
  ],
  "Befestigung": [
    ["Dübel 6", "Pkg", "duebel 6mm"],
    ["Dübel 8", "Pkg", "duebel 8mm"],
    ["Schrauben", "Pkg", "schrauben spax"],
    ["Gips / Schnellzement", "kg", "gips schnellzement einputzen"],
  ],
  "Sonstiges": [
    ["Isolierband", "Rolle", "isoband klebeband"],
    ["Schrumpfschlauch", "m", "schrumpf"],
    ["Erdungsband", "m", "erdungsband bandeisen staberder fundamenterder"],
    ["Potentialausgleichsschiene", "Stk", "pas potentialausgleich"],
    ["Rauchmelder", "Stk", "rauchwarnmelder brandmelder"],
  ],
};

function slug(s) {
  return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Eingebauter Katalog: [{ id, name, unit, group, terms }] */
export const CATALOG = Object.freeze(Object.entries(G).flatMap(([group, list]) =>
  list.map(([name, unit, terms]) => Object.freeze({ id: slug(name), name, unit, group, terms: terms || "" }))));
export const GROUPS = Object.freeze([...Object.keys(G), OWN_GROUP]);

/* ---------- Normalisieren & Suche ---------- */

/** Kleinbuchstaben, ä→ae …, × → x, Komma → Punkt, sonstige Zeichen → Leerzeichen. */
export function norm(s) {
  return String(s ?? "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[×✕*]/g, "x")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(^|\s)\.+|\.+(\s|$)/g, " ")
    .replace(/\s+/g, " ").trim();
}
const compact = (s) => s.replace(/[\s.]/g, "");

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Bewertung 0…100 einer Suche gegen ein Katalog-/Material-Element ({name, terms?}). 0 = passt nicht. */
export function matchScore(q, item) {
  const nq = norm(q);
  if (!nq) return 0;
  const nn = norm(item && item.name);
  if (!nn) return 0;
  if (nq === nn) return 100;
  const cq = compact(nq), cn = compact(nn);
  if (cq === cn) return 98;
  if (cn.startsWith(cq)) return 92;
  const hay = nn + " " + norm(item.terms || "");
  const words = hay.split(" ");
  const chay = compact(hay);
  if (cn.includes(cq) && cq.length >= 2) return 86;
  // jedes Suchwort muss irgendwo passen (Teilwort, zusammengeschrieben oder 1 Tippfehler)
  const toks = nq.split(" ");
  let total = 0;
  for (const t of toks) {
    const ct = compact(t);
    let best = 0;
    for (const w of words) {
      if (w === t) { best = 1; break; }
      if (w.startsWith(t)) best = Math.max(best, 0.9);
      else if (ct.length >= 2 && compact(w).includes(ct)) best = Math.max(best, 0.75);
      else if (t.length >= 4 && w.length >= 4 && !/\d/.test(t) && lev(t, w.slice(0, Math.max(t.length, Math.min(w.length, t.length + 1)))) <= (t.length >= 7 ? 2 : 1)) best = Math.max(best, 0.6);
    }
    if (!best && ct.length >= 3 && chay.includes(ct)) best = 0.7;
    if (!best) return 0;
    total += best;
  }
  return Math.round(40 + 40 * (total / toks.length) - Math.min(10, Math.max(0, words.length - toks.length) * 0.3));
}

/**
 * Katalog durchsuchen. list = Elemente {id, name, unit, group, terms?, fav?, count?}.
 * Favoriten und oft Benutztes rutschen bei gleicher Güte nach oben. Leere Suche → Favoriten, dann Häufigste.
 */
export function searchCatalog(q, list, limit = 8) {
  const items = Array.isArray(list) ? list : [];
  if (!norm(q)) {
    return items.filter((x) => x.fav || x.count > 0)
      .sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, "de"))
      .slice(0, limit);
  }
  const out = [];
  for (const it of items) {
    const sc = matchScore(q, it);
    if (sc > 0) out.push({ it, sc: sc + (it.fav ? 4 : 0) + Math.min(6, Math.log2(1 + (Number(it.count) || 0)) * 2) });
  }
  out.sort((a, b) => b.sc - a.sc || a.it.name.localeCompare(b.it.name, "de"));
  return out.slice(0, limit).map((x) => x.it);
}

/** Bester Katalog-Treffer zu einem Namen oder null (für den Claude-Server). */
export function bestCatalogMatch(q, list = CATALOG, min = 70) {
  let top = null, sc = 0;
  for (const it of list) {
    const s = matchScore(q, it);
    if (s > sc) { sc = s; top = it; }
  }
  return top && sc >= min ? { item: top, score: sc } : null;
}

/** Eingebauten Katalog mit den Nutzer-Einträgen (material_catalog) zusammenführen. */
export function mergeCatalog(userDocs) {
  const byId = new Map();
  for (const d of Array.isArray(userDocs) ? userDocs : []) if (d && d.id) byId.set(d.id, d);
  const out = CATALOG.map((c) => {
    const u = byId.get("b_" + c.id);
    return { ...c, id: c.id, docId: "b_" + c.id, own: false, fav: !!(u && u.fav), count: Number(u && u.count) || 0, lastUsed: (u && u.lastUsed) || 0 };
  });
  for (const d of byId.values()) {
    if (!d.own || d.deleted || !String(d.name || "").trim()) continue;
    out.push({ id: d.id, docId: d.id, name: String(d.name).trim(), unit: UNITS.includes(d.unit) ? d.unit : "Stk", group: OWN_GROUP, terms: String(d.terms || ""), own: true, fav: !!d.fav, count: Number(d.count) || 0, lastUsed: d.lastUsed || 0 });
  }
  return out;
}

/* ---------- Zahlen & Texte ---------- */

export function cleanQty(v) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

export function fmtNum(n) {
  const r = Math.round((Number(n) || 0) * 100) / 100;
  return String(r).replace(".", ",");
}

/** „2×“ bei Stück, sonst „25 m“, „1 Pkg“, „2 Rollen“. */
export function qtyText(qty, unit) {
  const q = fmtNum(qty);
  if (!unit || unit === "Stk") return `${q}×`;
  if (unit === "Rolle") return `${q} ${Number(qty) === 1 ? "Rolle" : "Rollen"}`;
  return `${q} ${unit}`;
}
export function lineText(x) { return `${qtyText(x.qty, x.unit)} ${String(x.name || "").trim()}`; }

export function placeKey(it) {
  if (it && it.placeId) return "p:" + it.placeId;
  const n = norm(it && it.place);
  return n ? "t:" + n : "-";
}
export function placeLabel(it, places) {
  if (it && it.placeId && Array.isArray(places)) {
    const p = places.find((x) => x && x.id === it.placeId);
    if (p && p.name) return p.name;
  }
  return String((it && it.place) || "").trim() || "Ohne Baustelle";
}

function pad(n) { return String(n).padStart(2, "0"); }
export function fmtKeyDate(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}
export function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function keyDate(k) { const [y, m, d] = String(k).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); }
/** Montag–Sonntag der Woche von dayKey k → { from, to } (dayKeys). */
export function weekRange(k) {
  const d = keyDate(k);
  const wd = (d.getDay() + 6) % 7;
  const mo = new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd);
  const su = new Date(mo.getFullYear(), mo.getMonth(), mo.getDate() + 6);
  return { from: keyOf(mo), to: keyOf(su) };
}

/** Gleiche Materialien (Name + Einheit) zusammenzählen → [{ name, unit, qty, n }] nach Name sortiert. */
export function totals(items) {
  const m = new Map();
  for (const it of items || []) {
    const q = cleanQty(it.qty);
    if (!q) continue;
    const unit = UNITS.includes(it.unit) ? it.unit : "Stk";
    const k = compact(norm(it.name)) + "|" + unit;
    const cur = m.get(k);
    if (cur) { cur.qty = Math.round((cur.qty + q) * 100) / 100; cur.n++; }
    else m.set(k, { name: String(it.name || "").trim(), unit, qty: q, n: 1 });
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));
}

/** Nach Baustelle gruppieren → [{ key, place, placeId, items }] (alphabetisch, „Ohne Baustelle“ zuletzt). */
export function byPlace(items, places) {
  const m = new Map();
  for (const it of items || []) {
    const k = placeKey(it);
    if (!m.has(k)) m.set(k, { key: k, place: placeLabel(it, places), placeId: it.placeId || null, items: [] });
    m.get(k).items.push(it);
  }
  return [...m.values()].sort((a, b) => (a.key === "-") - (b.key === "-") || a.place.localeCompare(b.place, "de"));
}

/** Zusammenfassung pro Baustelle: [{ key, place, placeId, verbaut:[totals], offen:[totals], besorgt:n, brauche:n, last }] */
export function summarize(items, places) {
  return byPlace(items, places).map((g) => ({
    key: g.key, place: g.place, placeId: g.placeId,
    verbaut: totals(g.items.filter((x) => x.status === "verbaut")),
    offen: totals(g.items.filter((x) => x.status !== "verbaut")),
    brauche: g.items.filter((x) => x.status === "brauche").length,
    besorgt: g.items.filter((x) => x.status === "besorgt").length,
    last: g.items.reduce((mx, x) => (String(x.dayKey || "") > mx ? String(x.dayKey) : mx), ""),
  }));
}

/** Kurze Zeile „2× Schuko-Steckdose, 25 m NYM-J 3×1,5“ (Berichtsheft). */
export function shortLine(items, max = 0) {
  const t = totals(items).map(lineText);
  if (max && t.length > max) return t.slice(0, max).join(", ") + ` … (+${t.length - max})`;
  return t.join(", ");
}

/** Nur verbaute Materialien eines Tages. */
export function verbautOn(items, dayKey) {
  return (items || []).filter((x) => x && x.status === "verbaut" && x.dayKey === dayKey);
}

/**
 * Auswahl fürs Teilen. f = { mode: "brauche"|"tag"|"woche", day: dayKey, placeKey?: "…"|"" }
 * → { items, title, when }
 */
export function shareSelection(items, f, today) {
  const mode = f && f.mode || "brauche";
  const day = (f && f.day) || today;
  let list, when, title;
  if (mode === "tag") {
    list = (items || []).filter((x) => x.status === "verbaut" && x.dayKey === day);
    when = fmtKeyDate(day); title = "Verbautes Material";
  } else if (mode === "woche") {
    const r = weekRange(day);
    list = (items || []).filter((x) => x.status === "verbaut" && x.dayKey >= r.from && x.dayKey <= r.to);
    when = `${fmtKeyDate(r.from).slice(0, 6)}–${fmtKeyDate(r.to)}`; title = "Verbautes Material";
  } else {
    list = (items || []).filter((x) => x.status === "brauche");
    when = fmtKeyDate(today); title = "Materialliste";
  }
  if (f && f.placeKey) list = list.filter((x) => placeKey(x) === f.placeKey);
  return { items: list, title, when, mode };
}

/** Teilen-Text, z. B. „Materialliste Teststraße 15 (05.11.2026):\n• 2× Schuko-Steckdose\n• 25 m NYM-J 3×1,5“ */
export function shareText(sel, places) {
  const groups = byPlace(sel.items, places);
  if (!groups.length) return "";
  const one = groups.length === 1;
  const head = one ? `${sel.title} ${groups[0].place} (${sel.when}):` : `${sel.title} (${sel.when}):`;
  const lines = [head];
  for (const g of groups) {
    if (!one) lines.push("", `${g.place}:`);
    for (const t of totals(g.items)) lines.push(`• ${lineText(t)}`);
  }
  return lines.join("\n");
}

/** CSV (Excel, Strichpunkt, BOM) der verbauten Materialien eines Monats ("YYYY-MM"). */
export function monthCSV(items, ym, places) {
  const cell = (v) => { const s = v == null ? "" : String(v); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [["Datum", "Baustelle", "Material", "Menge", "Einheit", "Status", "Notiz"]];
  const list = (items || []).filter((x) => x.status === "verbaut" && String(x.dayKey || "").startsWith(ym))
    .sort((a, b) => String(a.dayKey).localeCompare(String(b.dayKey)) || placeLabel(a, places).localeCompare(placeLabel(b, places), "de") || String(a.name).localeCompare(String(b.name), "de"));
  for (const x of list) rows.push([fmtKeyDate(x.dayKey), placeLabel(x, places), x.name, fmtNum(x.qty), x.unit || "Stk", STATUS_LABEL[x.status] || x.status, x.note || ""]);
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Material-Dokument säubern (Speichern aus App und Server). */
export function normItem(x, now = Date.now()) {
  const status = STATUSES.includes(x && x.status) ? x.status : "brauche";
  return {
    ...x,
    name: String((x && x.name) || "").trim().slice(0, 120),
    qty: cleanQty(x && x.qty) || 1,
    unit: UNITS.includes(x && x.unit) ? x.unit : "Stk",
    status,
    placeId: (x && x.placeId) || null,
    place: String((x && x.place) || "").trim().slice(0, 160),
    dayKey: /^\d{4}-\d{2}-\d{2}$/.test(x && x.dayKey) ? x.dayKey : keyOf(new Date(now)),
    entryId: (x && x.entryId) || null,
    note: String((x && x.note) || "").trim().slice(0, 500),
    photoId: (x && x.photoId) || null,
    catalogId: (x && x.catalogId) || null,
    doneAt: status === "verbaut" ? (Number(x && x.doneAt) || now) : null,
  };
}
