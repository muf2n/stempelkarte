// Geld-Logik, übernommen aus js/alltag/money-core.js (Update 9b, Agent D):
// Standard-Kategorien, Stichwort-Regeln, Abo-Termine, Budget-Stufen.
// Stand: js/alltag/money-core.js auf Branch update9 (Regeln identisch, per diff geprüft);
// bei Änderungen dort bitte hier nachziehen.

export const DEFAULT_CATS = [
  { id: "essen", name: "Essen & Einkauf", emoji: "🛒", type: "out" },
  { id: "essengehen", name: "Essen gehen", emoji: "🍔", type: "out" },
  { id: "auto", name: "Auto & Tanken", emoji: "⛽", type: "out" },
  { id: "oeffis", name: "Öffis", emoji: "🚆", type: "out" },
  { id: "abos", name: "Abos", emoji: "📺", type: "out" },
  { id: "handy", name: "Handy & Internet", emoji: "📱", type: "out" },
  { id: "wohnen", name: "Wohnen", emoji: "🏠", type: "out" },
  { id: "freizeit", name: "Freizeit", emoji: "🎉", type: "out" },
  { id: "kleidung", name: "Kleidung", emoji: "👕", type: "out" },
  { id: "werkzeug", name: "Werkzeug & Arbeit", emoji: "🧰", type: "out" },
  { id: "schule", name: "Schule", emoji: "📚", type: "out" },
  { id: "gesundheit", name: "Gesundheit", emoji: "💊", type: "out" },
  { id: "geschenke", name: "Geschenke", emoji: "🎁", type: "out" },
  { id: "sparen", name: "Sparen", emoji: "🐷", type: "out" },
  { id: "sonstiges", name: "Sonstiges", emoji: "📦", type: "out" },
  { id: "einkommen", name: "Einkommen", emoji: "💶", type: "in" },
  { id: "geschenkt", name: "Geschenkt bekommen", emoji: "🤝", type: "in" },
  { id: "sonstein", name: "Sonstige Einnahmen", emoji: "💰", type: "in" },
];

export const BUILTIN_RULES = [
  [["spar", "eurospar", "interspar", "billa", "hofer", "lidl", "penny", "merkur", "mpreis", "unimarkt", "nah&frisch", "adeg", "supermarkt", "einkauf", "bäcker", "baecker", "ströck", "anker"], "essen"],
  [["mcdonald", "mc donald", "mäci", "maci", "burger king", "kfc", "subway", "döner", "doener", "kebab", "pizza", "dominos", "mjam", "lieferando", "foodora", "wolt", "restaurant", "gasthaus", "wirt", "imbiss", "würstel", "leberkäs", "kantine", "mittagessen", "kaffee", "café", "starbucks"], "essengehen"],
  [["omv", "bp", "shell", "eni", "avanti", "jet", "turmöl", "tanken", "tankstelle", "diesel", "benzin", "sprit", "vignette", "parken", "parkgebühr", "waschstraße", "öamtc", "oeamtc", "arbö", "werkstatt", "pickerl", "versicherung auto", "kfz"], "auto"],
  [["öbb", "oebb", "wiener linien", "klimaticket", "westbahn", "postbus", "bus", "straßenbahn", "bim", "u-bahn", "zug", "ticket öffi", "jahreskarte", "top-jugendticket", "jugendticket"], "oeffis"],
  [["netflix", "spotify", "disney", "amazon prime", "prime video", "youtube premium", "apple music", "icloud", "xbox game pass", "game pass", "playstation plus", "ps plus", "dazn", "sky", "crunchyroll", "chatgpt", "abo"], "abos"],
  [["a1", "magenta", "drei", "hot ", "spusu", "yesss", "bob ", "handyrechnung", "internet", "wlan", "guthaben", "aufladen"], "handy"],
  [["miete", "strom", "wien energie", "gas", "betriebskosten", "gis", "orf"], "wohnen"],
  [["kino", "cineplexx", "fitness", "mcfit", "clever fit", "fitinn", "konzert", "festival", "bowling", "therme", "schwimmbad", "steam", "playstation", "nintendo", "spiel", "party", "disco", "club", "bar ", "bier", "fortgehen", "ausgehen"], "freizeit"],
  [["h&m", "zara", "primark", "c&a", "deichmann", "snipes", "zalando", "kleidung", "schuhe", "jacke", "hose", "shirt"], "kleidung"],
  [["hornbach", "obi", "bauhaus", "baumax", "lagerhaus", "würth", "wuerth", "conrad", "werkzeug", "arbeitskleidung", "arbeitsschuhe", "sicherheitsschuhe", "multimeter", "phasenprüfer"], "werkzeug"],
  [["schulbuch", "berufsschule", "schulsachen", "heft", "libro", "pagro", "thalia", "kursbeitrag", "internat", "prüfungsgebühr"], "schule"],
  [["apotheke", "arzt", "zahnarzt", "optiker", "brille", "medikament", "dm ", "bipa", "müller drogerie"], "gesundheit"],
  [["geschenk", "geburtstag", "weihnacht"], "geschenke"],
  [["sparen", "sparbuch", "sparkonto", "bausparer"], "sparen"],
  [["lehrlingsentschädigung", "lehrlingsentschaedigung", "lehrlingsgeld", "lohn", "gehalt", "weihnachtsgeld", "urlaubsgeld", "sonderzahlung", "überstunden", "prämie", "praemie", "lehrlingsprämie", "familienbeihilfe", "beihilfe", "fahrtkostenzuschuss"], "einkommen"],
  [["taschengeld", "von oma", "von opa", "von mama", "von papa", "geschenkt"], "geschenkt"],
  [["rückzahlung", "rueckzahlung", "erstattung", "verkauf", "willhaben", "zurück bekommen"], "sonstein"],
];

function normNote(s) {
  return ` ${String(s || "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim()} `;
}

function wordHit(n, kw) {
  const k = kw.toLowerCase();
  if (k.length > 4 && !k.endsWith(" ")) return n.includes(k);
  const kk = k.trim();
  const re = new RegExp(`(^|[^a-zäöüß0-9])${kk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-zäöüß])`, "i");
  return re.test(n);
}

/** Kategorie-Vorschlag aus der Notiz (eigene Regeln money_rules {keyword, cat} haben Vorrang). */
export function suggestCategory(note, userRules = [], validIds = null) {
  const n = normNote(note);
  if (n.trim() === "") return null;
  const ok = (id) => !validIds || validIds.has(id);
  let best = null;
  for (const r of userRules || []) {
    const kw = String(r.keyword || "").toLowerCase().trim();
    if (!kw || !ok(r.cat)) continue;
    if (wordHit(n, kw) && (!best || kw.length > best.keyword.length)) best = { cat: r.cat, source: "eigen", keyword: kw };
  }
  if (best) return best;
  for (const [kws, cat] of BUILTIN_RULES) {
    if (!ok(cat)) continue;
    for (const kw of kws) {
      if (wordHit(n, kw) && (!best || kw.length > best.keyword.length)) best = { cat, source: "auto", keyword: kw };
    }
  }
  return best;
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "12,5" / "12.50" / "1.234,56" / 12.5 → 12.5; ungültig → NaN */
export function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? round2(v) : NaN;
  let s = String(v ?? "").trim().replace(/[€\s ]/g, "").replace(/^eur/i, "").replace(/eur$/i, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : NaN;
}

export function budgetLevel(spent, limit) {
  const l = Number(limit) || 0;
  if (l <= 0) return { ratio: 0, level: "none" };
  const ratio = (Number(spent) || 0) / l;
  return { ratio, level: ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok" };
}

/* ---------- Abos ---------- */

export const INTERVALS = { week: "wöchentlich", month: "monatlich", quarter: "vierteljährlich", year: "jährlich" };
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dateOf = (k) => { const [y, m, d] = String(k).split("-").map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ""));

export function nextDue(key, interval, anchorDay = null) {
  const d = dateOf(key);
  if (interval === "week") { d.setUTCDate(d.getUTCDate() + 7); return keyOf(d); }
  const add = interval === "year" ? 12 : interval === "quarter" ? 3 : 1;
  const day = anchorDay || d.getUTCDate();
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + add;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return keyOf(new Date(Date.UTC(y, m, Math.min(day, last))));
}

export function monthlyCost(sub) {
  const a = Number(sub.amount) || 0;
  switch (sub.interval) {
    case "week": return round2(a * 52 / 12);
    case "quarter": return round2(a / 3);
    case "year": return round2(a / 12);
    default: return round2(a);
  }
}

/** Kommende Zahlungen in den nächsten `days` Tagen (sortiert). */
export function upcoming(subs, today, days = 31) {
  const endD = dateOf(today); endD.setUTCDate(endD.getUTCDate() + days);
  const end = keyOf(endD);
  const res = [];
  for (const s of subs || []) {
    if (!s || s.paused || !isKey(s.next)) continue;
    let k = s.next, guard = 0;
    const anchor = s.day || dateOf(s.next).getUTCDate();
    while (k <= end && guard++ < 400) {
      if (isKey(s.ended) && k > s.ended) break; // gekündigt: nach dem letzten Tag keine Zahlung mehr
      if (k >= today) res.push({ sub: s, date: k });
      k = nextDue(k, s.interval, s.interval === "week" ? null : anchor);
    }
  }
  return res.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
