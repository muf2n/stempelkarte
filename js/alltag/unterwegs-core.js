// Unterwegs – reine Logik ohne DOM (Datum, Packlisten-Vorlagen, Fortschritt, Tanken, Peilung, Links, Teilen-Text).
// Wird von unterwegs*.js benutzt und ist in Node ladbar (Tests).

/* ---------- Datum & Zahlen ---------- */

const pad = (n) => String(n).padStart(2, "0");
export const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const MONTHS_SHORT = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => keyOf(new Date());
export const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ""));
export function dateOf(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}
export function addDays(key, n) { const d = dateOf(key); d.setDate(d.getDate() + n); return keyOf(d); }
export function daysBetween(a, b) { return Math.round((dateOf(b) - dateOf(a)) / 86400000); }
/** TT.MM.JJJJ */
export function fmtDate(key) {
  if (!isKey(key)) return "";
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
}
/** „Fr, 24. Juli“ */
export function fmtDay(key, withYear = false) {
  if (!isKey(key)) return "";
  const d = dateOf(key);
  return `${WD[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}${withYear ? " " + d.getFullYear() : ""}`;
}
export const monthOf = (key) => String(key || "").slice(0, 7);
export function monthLabel(mk, short = false) {
  const [y, m] = String(mk).split("-").map(Number);
  return short ? MONTHS_SHORT[m - 1] : `${MONTHS[m - 1]} ${y}`;
}
export function shiftMonth(mk, n) {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function clock(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function fmtDateTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${clock(ts)}`;
}

/** Österreichisch: 1.234,56 € */
export function eur(v, { cents = true } = {}) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const fixed = cents ? abs.toFixed(2) : String(Math.round(abs));
  let [int, dec] = fixed.split(".");
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const s = (dec ? `${int},${dec}` : int) + " €";
  return n < 0 && abs >= 0.005 ? "−" + s : s;
}
/** Zahl mit Komma, feste Nachkommastellen (1.234,5) */
export function num(v, digits = 1) {
  const n = Number(v);
  if (!isFinite(n)) return "–";
  let [int, dec] = Math.abs(n).toFixed(digits).split(".");
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 ? "−" : "") + (dec ? `${int},${dec}` : int);
}
/** "12,5" / "12.50" / "1.234,56" → Zahl; leer/ungültig → NaN */
export function parseNum(str) {
  let s = String(str ?? "").trim().replace(/[€\s  ]/g, "").replace(/l$|km$/i, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const numIn = (v) => (v === "" || v == null || !isFinite(Number(v)) ? "" : String(v).replace(".", ","));

/* ---------- Reisen ---------- */

export function nights(trip) {
  if (!trip || !isKey(trip.from) || !isKey(trip.to)) return 0;
  return Math.max(0, daysBetween(trip.from, trip.to));
}

/** Countdown-Status einer Reise relativ zu heute. */
export function tripStatus(trip, today = todayKey()) {
  if (!trip || !isKey(trip.from)) return { kind: "nodate", label: "ohne Datum" };
  const to = isKey(trip.to) ? trip.to : trip.from;
  const d = daysBetween(today, trip.from);
  if (d > 1) return { kind: "future", days: d, label: `noch ${d} Tage` };
  if (d === 1) return { kind: "future", days: 1, label: "morgen geht’s los" };
  if (d === 0) return { kind: "today", days: 0, label: "heute geht’s los" };
  const end = daysBetween(today, to);
  if (end >= 0) {
    const day = -d + 1, total = daysBetween(trip.from, to) + 1;
    return { kind: "running", label: `unterwegs – Tag ${day} von ${total}` };
  }
  return { kind: "past", label: -end === 1 ? "seit gestern vorbei" : `vor ${-end} Tagen vorbei` };
}

export function dateRange(trip) {
  if (!isKey(trip.from)) return "";
  const a = dateOf(trip.from);
  if (!isKey(trip.to) || trip.to === trip.from) return fmtDay(trip.from, true);
  const b = dateOf(trip.to);
  const sameYear = a.getFullYear() === b.getFullYear();
  return `${WD[a.getDay()]}, ${a.getDate()}. ${MONTHS_SHORT[a.getMonth()]}${sameYear ? "" : " " + a.getFullYear()} – ${WD[b.getDay()]}, ${b.getDate()}. ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
}

export function sortTrips(trips, today = todayKey()) {
  // kommende/laufende zuerst (nach Start aufsteigend), dann vergangene (neueste zuerst), ohne Datum am Ende
  const rank = (t) => {
    const s = tripStatus(t, today).kind;
    return s === "running" || s === "today" ? 0 : s === "future" ? 1 : s === "nodate" ? 2 : 3;
  };
  return [...trips].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 3) return String(b.from).localeCompare(String(a.from));
    return String(a.from || "").localeCompare(String(b.from || ""));
  });
}

export function spent(trip) {
  return round2((trip.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0));
}

/** Reiseplan nach Tag gruppiert: [{day, items}] – Tage der Reise immer, dazu Tage mit Punkten außerhalb. */
export function planByDay(trip) {
  const items = [...(trip.plan || [])].sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.time || "99").localeCompare(String(b.time || "99")));
  const days = new Map();
  if (isKey(trip.from)) {
    const n = Math.min(60, nights(trip));
    for (let i = 0; i <= n; i++) days.set(addDays(trip.from, i), []);
  }
  for (const it of items) {
    const k = isKey(it.day) ? it.day : "";
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(it);
  }
  return [...days.entries()].sort((a, b) => (a[0] || "9").localeCompare(b[0] || "9")).map(([day, items]) => ({ day, items }));
}

/* ---------- Links ---------- */

export const mapsSearch = (q) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(String(q || "").trim());
export const mapsWalk = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}&travelmode=walking`;
export const mapsRoute = (q) => "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(String(q || "").trim());
export const telHref = (p) => "tel:" + String(p || "").replace(/[^\d+]/g, "");

/* ---------- Geo ---------- */

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Peilung von a nach b in Grad (0 = Norden, im Uhrzeigersinn). */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const DIRS = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"];
export const compassName = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
export function fmtDist(m) {
  if (!isFinite(m)) return "–";
  if (m < 10) return "< 10 m";
  if (m < 1000) return `${Math.round(m / 5) * 5} m`;
  return `${num(m / 1000, m < 10000 ? 1 : 0)} km`;
}
export function fmtLeft(ms) {
  const neg = ms < 0;
  const m = Math.round(Math.abs(ms) / 60000);
  const s = m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)} min` : `${m} min`;
  return neg ? `seit ${s} abgelaufen` : `noch ${s}`;
}

/* ---------- Packlisten ---------- */

export const PACK_CATS = [
  { key: "wichtig", name: "Wichtiges", emoji: "⭐" },
  { key: "dokumente", name: "Dokumente", emoji: "📄" },
  { key: "kleidung", name: "Kleidung", emoji: "👕" },
  { key: "hygiene", name: "Hygiene", emoji: "🧴" },
  { key: "technik", name: "Technik", emoji: "🔌" },
  { key: "flugzeug", name: "Flugzeug", emoji: "✈️" },
  { key: "bus", name: "Bus & Bahn", emoji: "🚆" },
  { key: "auto", name: "Auto", emoji: "🚗" },
  { key: "hotel", name: "Hotel", emoji: "🏨" },
  { key: "arbeit", name: "Arbeit & Werkzeug", emoji: "🧰" },
  { key: "ski", name: "Ski & Schnee", emoji: "⛷️" },
  { key: "strand", name: "Strand & Baden", emoji: "🏖️" },
  { key: "proviant", name: "Proviant", emoji: "🥪" },
  { key: "sonstiges", name: "Sonstiges", emoji: "📦" },
];
export const catInfo = (key) => PACK_CATS.find((c) => c.key === key) || PACK_CATS[PACK_CATS.length - 1];

// Vorlagen: [kategorie, [ "Name" | ["Name", Menge] ]]
const T = {
  wochenende: {
    title: "Wochenende", emoji: "🎒", sub: "2–3 Tage, kleines Gepäck",
    cats: [
      ["wichtig", ["Handy", "Ladekabel", "Geldbörse", "Schlüssel", "e-card", "Ausweis"]],
      ["kleidung", [["Unterwäsche", 3], ["Socken", 3], ["T-Shirts", 2], ["Hose", 1], ["Pullover / Weste", 1], ["Pyjama", 1], "Jacke (Wetter checken)"]],
      ["hygiene", ["Zahnbürste", "Zahnpasta", "Deo", "Duschgel / Shampoo", "Haarbürste", "Medikamente"]],
      ["technik", ["Powerbank", "Kopfhörer"]],
      ["auto", ["Führerschein", "Zulassungsschein", "Sonnenbrille", "Vignette / Maut prüfen"]],
    ],
  },
  sommer: {
    title: "Urlaub Sommer", emoji: "🏖️", sub: "1–2 Wochen, Flug & Strand",
    cats: [
      ["wichtig", ["Handy", "Ladekabel", "Geldbörse", "Bankomat-/Kreditkarte", "Bargeld (Euro)", "Hausschlüssel"]],
      ["dokumente", ["Reisepass / Personalausweis", "Flugtickets / Boardingpass", "Hotelbuchung", "Reiseversicherung", "e-card (EKVK auf der Rückseite)", "Führerschein (Mietauto)"]],
      ["kleidung", [["Unterwäsche", 8], ["Socken", 5], ["T-Shirts", 6], ["Shorts", 3], ["Lange Hose", 1], ["Pullover für abends", 1], ["Sandalen", 1], ["Sneaker", 1], ["Pyjama", 1]]],
      ["strand", [["Badehose / Bikini", 2], "Badetuch", "Sonnenbrille", "Kappe / Hut", "Flip-Flops", "Strandtasche"]],
      ["hygiene", ["Zahnbürste", "Zahnpasta", "Deo", "Sonnencreme LSF 50", "After-Sun", "Duschgel / Shampoo", "Rasierer", "Insektenschutz", "Reiseapotheke", "Pflaster"]],
      ["technik", ["Powerbank", "Kopfhörer", "Reiseadapter", "Kamera"]],
      ["flugzeug", ["Flüssigkeiten-Beutel (1 l, max. 100 ml)", "Nackenkissen", "Leere Trinkflasche", "Snack", "Kaugummi (Druckausgleich)", "Offline-Musik / Filme laden"]],
      ["hotel", ["Ohrstöpsel", "Wäschesack", "Steckdosenleiste"]],
    ],
  },
  ski: {
    title: "Skiurlaub", emoji: "⛷️", sub: "Piste, Hütte, Winterauto",
    cats: [
      ["wichtig", ["Handy", "Ladekabel", "Geldbörse", "e-card", "Ausweis", "Skipass / Online-Ticket"]],
      ["ski", ["Ski / Snowboard", "Skischuhe", "Stöcke", "Helm", "Skibrille", "Skihandschuhe", ["Skisocken", 3], ["Funktionsunterwäsche", 2], "Skijacke", "Skihose", "Buff / Halstuch", "Rückenprotektor"]],
      ["kleidung", [["Unterwäsche", 6], ["Socken", 4], ["Pullover", 2], ["T-Shirts", 3], ["Jeans / Freizeithose", 1], "Haube", "Winterschuhe", "Hausschuhe", ["Badehose (Wellness)", 1]]],
      ["hygiene", ["Zahnbürste", "Zahnpasta", "Deo", "Lippenpflege mit LSF", "Sonnencreme", "Feuchtigkeitscreme", "Blasenpflaster", "Schmerzgel", "Medikamente"]],
      ["technik", ["Powerbank (Kälte!)", "Kopfhörer", "Handyhülle mit Band"]],
      ["auto", ["Winterreifen prüfen", "Schneeketten", "Eiskratzer", "Frostschutz Scheibenwischer", "Schneebesen", "Vignette"]],
      ["proviant", ["Tee in der Thermoskanne", "Müsliriegel"]],
    ],
  },
  montage: {
    title: "Montage (Arbeit)", emoji: "🧰", sub: "Auswärts arbeiten mit Hotel",
    cats: [
      ["wichtig", ["Handy", "Ladegerät", "Firmenhandy / Tablet", "Geldbörse", "Firmenschlüssel / Codes", "e-card"]],
      ["dokumente", ["Montageauftrag", "Pläne / Schaltpläne", "Stundenzettel / Berichtsheft", "Hotelbestätigung", "Führerschein", "Tankkarte", "Ansprechpartner Baustelle"]],
      ["arbeit", [["Arbeitshose", 3], ["Arbeits-T-Shirts", 4], "Arbeitsjacke", "Sicherheitsschuhe S3", "Helm", "Schutzbrille", "Gehörschutz", ["Arbeitshandschuhe", 2], "Zweipoliger Spannungsprüfer", "VDE-Schraubendreher-Set", "Abisolierzange", "Seitenschneider", "Kombizange", "Akkuschrauber + Akkus", "Ladegerät Akkus", "Maßband / Zollstock", "Stirnlampe", "Kabelbinder", "Isolierband", "Verbindungsklemmen", "Bleistift / Marker"]],
      ["kleidung", [["Unterwäsche", 5], ["Socken", 5], ["Freizeit-Shirts", 3], ["Jeans", 1], "Pullover", "Pyjama", "Turnschuhe"]],
      ["hygiene", ["Zahnbürste", "Zahnpasta", "Deo", "Duschgel", "Handwaschpaste", "Handcreme", "Pflaster", "Medikamente"]],
      ["hotel", ["Ohrstöpsel", "Wecker / Handy-Wecker", "Wäschesack", "Kopfhörer"]],
      ["auto", ["Fahrtenbuch", "Warnweste", "Verbandskasten prüfen", "Werkzeug sichern"]],
      ["proviant", ["Jause", "Trinkflasche", "Kaffee / Thermoskanne"]],
    ],
  },
};
export const TEMPLATE_KEYS = Object.keys(T);
export const templateMeta = (k) => (T[k] ? { key: k, title: T[k].title, emoji: T[k].emoji, sub: T[k].sub, count: T[k].cats.reduce((s, c) => s + c[1].length, 0) } : null);

let seq = 0;
export const sid = (p = "i") => p + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

function catObj(key) { const c = catInfo(key); return { id: sid("c"), key: c.key, name: c.name, emoji: c.emoji, items: [] }; }
export function newCat(key, name, emoji) {
  const c = catObj(key);
  if (name) c.name = name;
  if (emoji) c.emoji = emoji;
  return c;
}
export function newItem(name, qty = 1) { return { id: sid("i"), name: String(name || "").trim(), qty: Math.max(1, Math.round(Number(qty) || 1)), done: false }; }

/** Kategorien einer eingebauten Vorlage (frische IDs, alles unabgehakt). */
export function templateCats(key) {
  const t = T[key];
  if (!t) return [];
  return t.cats.map(([k, items]) => {
    const c = catObj(k);
    c.items = items.map((x) => (Array.isArray(x) ? newItem(x[0], x[1]) : newItem(x)));
    return c;
  });
}
/** Kopie fremder Kategorien (z. B. eigene Vorlage) mit frischen IDs und ohne Häkchen. */
export function cloneCats(cats) {
  return (cats || []).map((c) => ({ ...c, id: sid("c"), items: (c.items || []).map((i) => ({ ...i, id: sid("i"), done: false })) }));
}

export function packProgress(list) {
  let total = 0, done = 0;
  for (const c of (list && list.cats) || []) for (const i of c.items || []) { total++; if (i.done) done++; }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}
export function catProgress(c) {
  const items = c.items || [];
  return { total: items.length, done: items.filter((i) => i.done).length };
}
export function resetList(list) {
  return { ...list, cats: (list.cats || []).map((c) => ({ ...c, items: (c.items || []).map((i) => ({ ...i, done: false })) })) };
}
export function moveIn(arr, idx, dir) {
  const a = [...arr];
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= a.length) return a;
  [a[idx], a[j]] = [a[j], a[idx]];
  return a;
}
export function packText(list, trip) {
  const p = packProgress(list);
  const lines = [`🧳 ${list.title || "Packliste"}`];
  if (trip && isKey(trip.from)) lines.push(dateRange(trip));
  lines.push(`${p.done}/${p.total} gepackt (${p.pct} %)`, "");
  for (const c of list.cats || []) {
    if (!(c.items || []).length) continue;
    const cp = catProgress(c);
    lines.push(`${c.emoji || "•"} ${c.name} (${cp.done}/${cp.total})`);
    for (const i of c.items) lines.push(`${i.done ? "☑" : "☐"} ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/* ---------- Tanken ---------- */

/**
 * Verbrauch zwischen Volltankungen.
 * fills: [{date, liters, total, km, full}] → { rows: [{fill, dist, l100, eurKm}], avgL100, eurKm, km, liters, cost }
 * Liter/Kosten aller Tankungen nach einer Volltankung bis inkl. der nächsten Volltankung zählen zu dieser Strecke.
 */
export function fuelStats(fills) {
  const list = [...(fills || [])]
    .filter((f) => f && isFinite(Number(f.km)) && Number(f.km) > 0)
    .sort((a, b) => Number(a.km) - Number(b.km) || String(a.date).localeCompare(String(b.date)));
  const rows = new Map();
  let lastFull = null, accL = 0, accE = 0;
  let sumKm = 0, sumL = 0, sumE = 0;
  for (const f of list) {
    const l = Number(f.liters) || 0, e = Number(f.total) || 0;
    if (lastFull) { accL += l; accE += e; }
    if (f.full) {
      if (lastFull) {
        const dist = Number(f.km) - Number(lastFull.km);
        if (dist > 0 && accL > 0) {
          rows.set(f.id || f, { dist, l100: (accL / dist) * 100, eurKm: accE / dist, liters: accL });
          sumKm += dist; sumL += accL; sumE += accE;
        }
      }
      lastFull = f; accL = 0; accE = 0;
    }
  }
  return {
    rows,
    avgL100: sumKm ? (sumL / sumKm) * 100 : null,
    eurKm: sumKm ? sumE / sumKm : null,
    km: sumKm, liters: sumL, cost: sumE,
  };
}
export const pricePerL = (f) => (Number(f.liters) > 0 ? Number(f.total) / Number(f.liters) : null);

/** Monatskosten der letzten n Monate bis mk (inkl.): [{mk, sum, liters}] */
export function fuelMonths(fills, mk, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = shiftMonth(mk, -i);
    const arr = (fills || []).filter((f) => monthOf(f.date) === m);
    out.push({ mk: m, sum: round2(arr.reduce((s, f) => s + (Number(f.total) || 0), 0)), liters: arr.reduce((s, f) => s + (Number(f.liters) || 0), 0), n: arr.length });
  }
  return out;
}

/* ---------- Adressen ---------- */

export const PLACE_CATS = [
  { key: "familie", name: "Familie", emoji: "👪" },
  { key: "freunde", name: "Freunde", emoji: "🧑‍🤝‍🧑" },
  { key: "arbeit", name: "Arbeit", emoji: "🏢" },
  { key: "baustelle", name: "Baustelle", emoji: "🚧" },
  { key: "arzt", name: "Arzt", emoji: "🩺" },
  { key: "werkstatt", name: "Werkstatt", emoji: "🔧" },
  { key: "schule", name: "Schule", emoji: "🏫" },
  { key: "amt", name: "Amt & Behörde", emoji: "🏛️" },
  { key: "einkauf", name: "Einkauf", emoji: "🛒" },
  { key: "sonstiges", name: "Sonstiges", emoji: "📍" },
];
export const placeCat = (k) => PLACE_CATS.find((c) => c.key === k) || PLACE_CATS[PLACE_CATS.length - 1];

const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
export function searchPlaces(places, q, cat = "") {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  return (places || [])
    .filter((p) => !cat || (p.cat || "sonstiges") === cat)
    .filter((p) => {
      if (!terms.length) return true;
      const hay = fold([p.name, p.address, p.phone, p.notes, placeCat(p.cat).name].join(" "));
      const digits = String(p.phone || "").replace(/\D/g, "");
      return terms.every((t) => hay.includes(t) || (/^\d{3,}$/.test(t) && digits.includes(t)));
    })
    .sort((a, b) => (!!b.fav - !!a.fav) || String(a.name).localeCompare(String(b.name), "de", { sensitivity: "base" }));
}
