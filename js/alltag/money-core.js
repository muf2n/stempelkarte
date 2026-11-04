// Geld – reine Logik ohne DOM (Formatierung, Kategorien-Vorschlag, Summen, Abos, Teilen-Ausgleich).
// Wird von money.js benutzt und ist für Tests in Node ladbar.

/* ---------- Datum ---------- */

const pad = (n) => String(n).padStart(2, "0");
export const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const MONTHS_SHORT = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => keyOf(new Date());
export const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ""));
export function dateOf(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}
/** "2026-11" aus "2026-11-04" */
export const monthOf = (key) => String(key || "").slice(0, 7);
export const monthKey = (y, m) => { const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export function shiftMonth(mk, n) {
  const [y, m] = mk.split("-").map(Number);
  return monthKey(y, m - 1 + n);
}
export function monthLabel(mk, short = false) {
  const [y, m] = mk.split("-").map(Number);
  return short ? MONTHS_SHORT[m - 1] : `${MONTHS[m - 1]} ${y}`;
}
/** TT.MM.JJJJ */
export function fmtDate(key) {
  if (!isKey(key)) return "";
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
}
export function addDays(key, n) {
  const d = dateOf(key); d.setDate(d.getDate() + n); return keyOf(d);
}
export function daysBetween(a, b) {
  return Math.round((dateOf(b) - dateOf(a)) / 86400000);
}

/* ---------- Geld ---------- */

/** Österreichisch: 1.234,56 € (negativ mit echtem Minus). */
export function eur(v, { sign = false, cents = true } = {}) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const fixed = cents ? abs.toFixed(2) : String(Math.round(abs));
  let [int, dec] = fixed.split(".");
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const s = (dec ? `${int},${dec}` : int) + " €";
  if (n < 0 && abs >= 0.005) return "−" + s;
  if (sign && n > 0) return "+" + s;
  return s;
}

/** "12,5" / "12.50" / "1.234,56" → 12.5; ungültig → NaN */
export function parseAmount(str) {
  let s = String(str ?? "").trim().replace(/[€\s ]/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ---------- Kategorien ---------- */

export const DEFAULT_CATS = [
  { id: "essen", name: "Essen & Einkauf", emoji: "🛒", color: "#16a34a", type: "out" },
  { id: "essengehen", name: "Essen gehen", emoji: "🍔", color: "#f97316", type: "out" },
  { id: "auto", name: "Auto & Tanken", emoji: "⛽", color: "#0ea5e9", type: "out" },
  { id: "oeffis", name: "Öffis", emoji: "🚆", color: "#0891b2", type: "out" },
  { id: "abos", name: "Abos", emoji: "📺", color: "#8b5cf6", type: "out" },
  { id: "handy", name: "Handy & Internet", emoji: "📱", color: "#6366f1", type: "out" },
  { id: "wohnen", name: "Wohnen", emoji: "🏠", color: "#a16207", type: "out" },
  { id: "freizeit", name: "Freizeit", emoji: "🎉", color: "#ec4899", type: "out" },
  { id: "kleidung", name: "Kleidung", emoji: "👕", color: "#db2777", type: "out" },
  { id: "werkzeug", name: "Werkzeug & Arbeit", emoji: "🧰", color: "#ca8a04", type: "out" },
  { id: "schule", name: "Schule", emoji: "📚", color: "#5b7cfa", type: "out" },
  { id: "gesundheit", name: "Gesundheit", emoji: "💊", color: "#e11d48", type: "out" },
  { id: "geschenke", name: "Geschenke", emoji: "🎁", color: "#c026d3", type: "out" },
  { id: "sparen", name: "Sparen", emoji: "🐷", color: "#14b8a6", type: "out" },
  { id: "sonstiges", name: "Sonstiges", emoji: "📦", color: "#64748b", type: "out" },
  { id: "einkommen", name: "Einkommen", emoji: "💶", color: "#059669", type: "in" },
  { id: "geschenkt", name: "Geschenkt bekommen", emoji: "🤝", color: "#0d9488", type: "in" },
  { id: "sonstein", name: "Sonstige Einnahmen", emoji: "💰", color: "#65a30d", type: "in" },
];

export const CAT_COLORS = ["#16a34a", "#f97316", "#0ea5e9", "#8b5cf6", "#ec4899", "#e11d48", "#ca8a04", "#14b8a6", "#6366f1", "#a16207", "#64748b", "#c026d3"];

/** Kategorien sortiert (Ausgaben vor Einnahmen, dann order/Name). */
export function sortCats(cats) {
  const base = new Map(DEFAULT_CATS.map((c, i) => [c.id, i]));
  return [...(cats || [])].filter((c) => c && c.id && !c.deleted).sort((a, b) => {
    if ((a.type === "in") !== (b.type === "in")) return a.type === "in" ? 1 : -1;
    const oa = a.order ?? base.get(a.id) ?? 999, ob = b.order ?? base.get(b.id) ?? 999;
    return oa - ob || String(a.name).localeCompare(String(b.name), "de");
  });
}

/** Eingebaute Stichwort-Regeln (Kleinbuchstaben, Teilwort-Treffer). */
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

export function normNote(s) {
  return ` ${String(s || "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim()} `;
}

/** Stichwort für das Lernen: erstes „echtes“ Wort der Notiz (≥ 3 Zeichen, keine Zahl). */
export function ruleKeyword(note) {
  const words = String(note || "").toLowerCase().replace(/[’']/g, "").split(/[^a-zäöüß0-9&]+/i).filter(Boolean);
  const w = words.find((x) => x.length >= 3 && !/^\d+$/.test(x));
  return w || "";
}

/**
 * Kategorie-Vorschlag aus der Notiz. Eigene Regeln (money_rules: {keyword, cat}) haben Vorrang,
 * längstes Stichwort gewinnt. Gibt {cat, source:"eigen"|"auto", keyword} oder null.
 */
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

// Kurze Stichwörter (≤ 4 Zeichen, z. B. „bp“, „spar“, „a1“) nur am Wortanfang, damit „sparkasse“ ≠ „spar“
// bzw. „bp“ nicht in „abpumpen“ trifft. Längere dürfen irgendwo im Text stehen.
function wordHit(n, kw) {
  const k = kw.toLowerCase();
  if (k.length > 4 && !k.endsWith(" ")) return n.includes(k);
  const kk = k.trim();
  const re = new RegExp(`(^|[^a-zäöüß0-9])${kk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-zäöüß])`, "i");
  return re.test(n);
}

/* ---------- Summen ---------- */

export function monthTx(txs, mk) {
  return (txs || []).filter((t) => monthOf(t.date) === mk);
}

export function totals(txs) {
  let inc = 0, out = 0;
  for (const t of txs || []) {
    const a = Number(t.amount) || 0;
    if (t.type === "in") inc += a; else out += a;
  }
  return { in: round2(inc), out: round2(out), saldo: round2(inc - out) };
}

/** Ausgaben pro Kategorie, absteigend: [{cat, sum}] */
export function byCategory(txs, type = "out") {
  const m = new Map();
  for (const t of txs || []) {
    if ((t.type === "in" ? "in" : "out") !== type) continue;
    const c = t.category || "sonstiges";
    m.set(c, (m.get(c) || 0) + (Number(t.amount) || 0));
  }
  return [...m.entries()].map(([cat, sum]) => ({ cat, sum: round2(sum) })).sort((a, b) => b.sum - a.sum);
}

/** Verlauf der letzten n Monate bis mk (inkl.): [{mk, in, out}] */
export function history(txs, mk, n = 6) {
  const res = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = shiftMonth(mk, -i);
    res.push({ mk: k, ...totals(monthTx(txs, k)) });
  }
  return res;
}

/** Budget-Stand: Anteil 0…∞ und Stufe "ok" | "warn" (≥ 80 %) | "over" (≥ 100 %) */
export function budgetLevel(spent, limit) {
  const l = Number(limit) || 0;
  if (l <= 0) return { ratio: 0, level: "none" };
  const ratio = (Number(spent) || 0) / l;
  return { ratio, level: ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok" };
}

/* ---------- Sparziele ---------- */

/** Wie viel pro Monat noch nötig ist, um bis zum Zieldatum fertig zu sein (null ohne Datum). */
export function goalPerMonth(goal, today = todayKey()) {
  const rest = Math.max(0, (Number(goal.target) || 0) - (Number(goal.saved) || 0));
  if (rest <= 0) return { rest: 0, months: 0, perMonth: 0, done: true };
  if (!isKey(goal.date)) return { rest, months: null, perMonth: null, done: false };
  const t = dateOf(today), d = dateOf(goal.date);
  let months = (d.getFullYear() - t.getFullYear()) * 12 + (d.getMonth() - t.getMonth());
  if (d.getDate() >= t.getDate()) months += 1; // laufender Monat zählt mit
  if (goal.date < today) return { rest, months: 0, perMonth: rest, done: false, late: true };
  months = Math.max(1, months);
  return { rest, months, perMonth: Math.ceil((rest / months) * 100) / 100, done: false };
}

/* ---------- Abos ---------- */

export const INTERVALS = { week: "wöchentlich", month: "monatlich", quarter: "vierteljährlich", year: "jährlich" };

/** Nächster Termin nach key für das Intervall. Monatsende wird korrekt behandelt (31. → 30./28.). */
export function nextDue(key, interval, anchorDay = null) {
  const d = dateOf(key);
  if (interval === "week") { d.setDate(d.getDate() + 7); return keyOf(d); }
  const add = interval === "year" ? 12 : interval === "quarter" ? 3 : 1;
  const day = anchorDay || d.getDate();
  const y = d.getFullYear(), m = d.getMonth() + add;
  const last = new Date(y, m + 1, 0).getDate();
  return keyOf(new Date(y, m, Math.min(day, last), 12));
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
export function yearlyCost(sub) {
  const a = Number(sub.amount) || 0;
  switch (sub.interval) {
    case "week": return round2(a * 52);
    case "quarter": return round2(a * 4);
    case "year": return round2(a);
    default: return round2(a * 12);
  }
}

/** Eindeutige Buchungs-ID für eine Abo-Fälligkeit → nie doppelt (auch nicht über mehrere Geräte). */
export const subTxId = (subId, dueKey) => `sub_${subId}_${dueKey.replace(/-/g, "")}`;

/**
 * Fällige Abo-Buchungen bis heute. Gibt {txs:[…], next:"YYYY-MM-DD"} pro Abo.
 * existingIds: Set vorhandener Buchungs-IDs (werden übersprungen). Höchstens 60 Termine je Abo.
 */
export function dueBookings(sub, today = todayKey(), existingIds = new Set()) {
  const txs = [];
  if (!sub || sub.paused || !isKey(sub.next) || !(Number(sub.amount) > 0)) return { txs, next: sub && sub.next };
  let k = sub.next, guard = 0;
  const anchor = sub.day || dateOf(sub.next).getDate();
  while (k <= today && guard++ < 60) {
    const id = subTxId(sub.id, k);
    if (!existingIds.has(id)) {
      txs.push({ id, date: k, amount: round2(sub.amount), type: "out", category: sub.category || "abos", note: sub.name || "Abo", recurringId: sub.id, auto: true });
    }
    k = nextDue(k, sub.interval, sub.interval === "week" ? null : anchor);
  }
  return { txs, next: k };
}

/** Kommende Zahlungen aller Abos in den nächsten `days` Tagen, sortiert. */
export function upcoming(subs, today = todayKey(), days = 31) {
  const end = addDays(today, days);
  const res = [];
  for (const s of subs || []) {
    if (s.paused || !isKey(s.next)) continue;
    let k = s.next, guard = 0;
    const anchor = s.day || dateOf(s.next).getDate();
    while (k <= end && guard++ < 400) {
      if (k >= today) res.push({ sub: s, date: k });
      k = nextDue(k, s.interval, s.interval === "week" ? null : anchor);
    }
  }
  return res.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* ---------- Teilen ---------- */

export const ME = "me";

/** Salden pro Person: positiv = bekommt Geld, negativ = schuldet. */
export function balances(group) {
  const bal = new Map();
  for (const p of group.people || []) bal.set(p.id, 0);
  const add = (id, v) => bal.set(id, (bal.get(id) || 0) + v);
  for (const e of group.expenses || []) {
    const amt = Number(e.amount) || 0;
    if (!(amt > 0)) continue;
    if (e.kind === "pay") { add(e.paidBy, amt); add(e.to, -amt); continue; }
    const fors = (e.forIds && e.forIds.length ? e.forIds : (group.people || []).map((p) => p.id));
    // gerecht in Cent aufteilen, Rest-Cent beim Ersten
    const cents = Math.round(amt * 100);
    const each = Math.floor(cents / fors.length);
    let rest = cents - each * fors.length;
    add(e.paidBy, amt);
    for (const id of fors) { add(id, -(each + (rest > 0 ? 1 : 0)) / 100); if (rest > 0) rest--; }
  }
  for (const [k, v] of bal) bal.set(k, round2(v));
  return bal;
}

/** Möglichst wenige Überweisungen: [{from, to, amount}] */
export function settle(group) {
  const bal = balances(group);
  const pos = [], neg = [];
  for (const [id, v] of bal) {
    if (v > 0.004) pos.push({ id, v }); else if (v < -0.004) neg.push({ id, v: -v });
  }
  pos.sort((a, b) => b.v - a.v); neg.sort((a, b) => b.v - a.v);
  const res = [];
  let i = 0, j = 0;
  while (i < neg.length && j < pos.length) {
    const x = Math.min(neg[i].v, pos[j].v);
    if (x > 0.004) res.push({ from: neg[i].id, to: pos[j].id, amount: round2(x) });
    neg[i].v = round2(neg[i].v - x); pos[j].v = round2(pos[j].v - x);
    if (neg[i].v <= 0.004) i++;
    if (pos[j].v <= 0.004) j++;
  }
  return res;
}

export function personName(group, id, { me = "du" } = {}) {
  if (id === ME) return me;
  const p = (group.people || []).find((x) => x.id === id);
  return p ? p.name : "?";
}

/** Satz wie „Max schuldet dir 12,50 €“. */
export function settleSentence(group, t) {
  const amt = eur(t.amount);
  if (t.to === ME) return `${personName(group, t.from)} schuldet dir ${amt}`;
  if (t.from === ME) return `Du schuldest ${personName(group, t.to)} ${amt}`;
  return `${personName(group, t.from)} schuldet ${personName(group, t.to)} ${amt}`;
}

export function shareText(group) {
  const lines = [`💸 ${group.name || "Gruppe"}`];
  const exp = (group.expenses || []).filter((e) => e.kind !== "pay");
  const total = exp.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  lines.push(`Ausgaben gesamt: ${eur(total)}`);
  for (const e of exp) lines.push(`• ${fmtDate(e.date)} ${e.desc || "Ausgabe"}: ${eur(e.amount)} (bezahlt: ${personName(group, e.paidBy, { me: "ich" })})`);
  const st = settle(group);
  lines.push("");
  if (!st.length) lines.push("✅ Alles ausgeglichen.");
  else {
    lines.push("Ausgleich:");
    for (const t of st) lines.push(`→ ${personName(group, t.from, { me: "Ich" })} zahlt ${personName(group, t.to, { me: "mir" })} ${eur(t.amount)}`);
  }
  return lines.join("\n");
}
