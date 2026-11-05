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
  { id: "reisen", name: "Reisen", emoji: "✈️", color: "#0d9488", type: "out" },
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
    if (isKey(sub.ended) && k > sub.ended) break; // gekündigt: nach dem letzten Tag nicht mehr buchen
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
      if (isKey(s.ended) && k > s.ended) break;
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

/* ---------- Update 9 – Sparziele: echtes Konto, Lohn-Erinnerung, Aufrunden ---------- */
// Eigener Abschnitt (reine Funktionen) – benutzt von money-savings.js (App), tools/reminders/decide.mjs (Push)
// und dem MCP-Server (geld_lesen). bank = Form von /bank/status bzw. users/{uid}/meta/bank:
//   {accounts:[{uid, iban_last4, name, hash, product}], balances:{uid:{amount, currency, date, at}},
//    balanceHistory:{uid:[{d, a}]}, lastSync}
// goal.bank = {uid, hash, last4, name, mode:"all"|"fixed", offset?, alloc?}
// goal.reminder = {on, amount, mode:"payday"|"day", day?}; goal.remindAck = "YYYY-MM" (erledigt/ausgeblendet)

/** Konto eines Sparziels in der Bank-Liste finden (uid → identification_hash → IBAN-Ende). */
export function goalAccount(goal, bank) {
  const l = goal && goal.bank;
  const accs = (bank && Array.isArray(bank.accounts)) ? bank.accounts : [];
  if (!l || !accs.length) return null;
  return accs.find((a) => a.uid && a.uid === l.uid) ||
    (l.hash ? accs.find((a) => a.hash && a.hash === l.hash) : null) ||
    (l.last4 ? accs.find((a) => a.iban_last4 === l.last4) : null) || null;
}

/** Saldo eines Kontos {amount, at, date} oder null. */
export function accountBalance(acc, bank) {
  if (!acc) return null;
  const b = (bank && bank.balances && bank.balances[acc.uid]) || acc.balance || null;
  if (!b || !Number.isFinite(Number(b.amount))) return null;
  return { amount: round2(b.amount), at: Number(b.at) || null, date: b.date || null };
}

const isLinked = (g) => !!(g && g.bank && (g.bank.uid || g.bank.hash || g.bank.last4));
export const goalLinked = isLinked;

/**
 * Aktueller Stand eines Sparziels.
 * Nicht verbunden: saved. Verbunden: „all“ = Kontostand − Startbetrag − feste Anteile anderer Ziele am selben Konto,
 * „fixed“ = fester Anteil (höchstens, was nach früher angelegten festen Anteilen noch auf dem Konto liegt).
 * → {amount, linked, account, balance, missing, unknown}
 */
export function goalCurrent(goal, goals = [], bank = null) {
  if (!isLinked(goal)) return { amount: round2(Number(goal && goal.saved) || 0), linked: false };
  const acc = goalAccount(goal, bank);
  const bal = accountBalance(acc, bank);
  if (!acc) return { amount: 0, linked: true, missing: true, account: null, balance: null };
  if (!bal) return { amount: 0, linked: true, unknown: true, account: acc, balance: null };
  const same = (goals || []).filter((g) => g && g.id !== goal.id && isLinked(g) && goalAccount(g, bank) === acc);
  const fixedOf = (g) => Math.max(0, Number(g.bank.alloc) || 0);
  const order = (g) => [Number(g.created) || 0, String(g.id || "")];
  const before = (a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0); };
  if (goal.bank.mode === "fixed") {
    const earlier = same.filter((g) => g.bank.mode === "fixed" && before(g, goal) < 0).reduce((s, g) => s + fixedOf(g), 0);
    const amount = Math.max(0, Math.min(fixedOf(goal), bal.amount - earlier));
    return { amount: round2(amount), linked: true, account: acc, balance: bal };
  }
  const fixed = same.filter((g) => g.bank.mode === "fixed").reduce((s, g) => s + fixedOf(g), 0);
  const amount = Math.max(0, bal.amount - (Number(goal.bank.offset) || 0) - fixed);
  return { amount: round2(amount), linked: true, account: acc, balance: bal };
}

/** Nicht zugeteilter Rest eines Kontos (nur wenn kein „ganzer Kontostand“-Ziel darauf zeigt), sonst null. */
export function accountFree(acc, goals = [], bank = null) {
  const bal = accountBalance(acc, bank);
  if (!bal) return null;
  const on = (goals || []).filter((g) => isLinked(g) && goalAccount(g, bank) === acc);
  if (!on.length || on.some((g) => g.bank.mode !== "fixed")) return null;
  return round2(bal.amount - on.reduce((s, g) => s + Math.max(0, Number(g.bank.alloc) || 0), 0));
}

/**
 * Durchschnittlicher monatlicher Zuwachs aus dem Tagesverlauf [{d, a}] der letzten `days` Tage (Standard 3 Monate).
 * → {perMonth, days, from, to} oder null (weniger als 14 Tage Verlauf).
 */
export function monthlyInflow(history, today = todayKey(), days = 92) {
  const start = addDays(today, -days);
  const pts = (Array.isArray(history) ? history : []).filter((p) => p && isKey(p.d) && p.d <= today && p.d >= start && Number.isFinite(Number(p.a)))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  if (pts.length < 2) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const span = daysBetween(first.d, last.d);
  if (span < 14) return null;
  return { perMonth: round2(((Number(last.a) - Number(first.a)) / span) * 30.44), days: span, from: first.d, to: last.d };
}

/** Monate bis zum Ziel bei gleichbleibendem Zuwachs (null, wenn kein Zuwachs). */
export function monthsToGoal(rest, perMonth) {
  if (!(rest > 0)) return 0;
  if (!(Number(perMonth) > 0.5)) return null;
  return Math.ceil(rest / Number(perMonth));
}

/* Lohn / Lehrlingsentschädigung erkennen */
export const SALARY_RE = /(lehrlings\s*-?\s*entsch(ä|ae)digung|lehrlingsgeld|lohn|gehalt|bez(ü|ue)ge|entgelt|salary|payroll)/i;
const txText = (t) => `${t.note || ""} ${t.counterparty || ""} ${t.bankText || ""}`;
const SAL_EXCLUDE = /(r(ü|ue)ck(zahlung|erstattung|buchung)|steuer|finanzamt|arbeitnehmerveranlagung|familienbeihilfe)/i;

/** Ist die Buchung eine Lohn-/Gehaltszahlung? (Eingang, Stichwort oder Kategorie „Einkommen“, ≥ 50 €) */
export function isSalaryTx(t) {
  if (!t || t.type !== "in" || !(Number(t.amount) >= 50) || !isKey(t.date)) return false;
  const text = txText(t);
  if (SAL_EXCLUDE.test(text)) return false;
  return SALARY_RE.test(text) || t.category === "einkommen";
}

/**
 * Zahltag im Monat von `today` (nur bis heute): größte Lohn-Buchung; ohne Treffer der größte Eingang,
 * der in mindestens einem der zwei Vormonate in ähnlicher Höhe (±25 %) schon kam („regelmäßig“).
 * → {date, amount, id, source:"lohn"|"regel"} oder null
 */
export function detectPayday(txs, today = todayKey()) {
  const mk = monthOf(today);
  const ins = (txs || []).filter((t) => t && t.type === "in" && isKey(t.date) && t.date <= today && Number(t.amount) > 0);
  const cur = ins.filter((t) => monthOf(t.date) === mk);
  if (!cur.length) return null;
  const pick = (list, source) => {
    const t = [...list].sort((a, b) => (Number(b.amount) - Number(a.amount)) || (a.date < b.date ? -1 : 1))[0];
    return t ? { date: t.date, amount: round2(t.amount), id: t.id || null, source } : null;
  };
  const sal = cur.filter(isSalaryTx);
  if (sal.length) return pick(sal, "lohn");
  const prev = [shiftMonth(mk, -1), shiftMonth(mk, -2)];
  const regular = cur.filter((t) => Number(t.amount) >= 100 && prev.some((pm) =>
    ins.some((x) => monthOf(x.date) === pm && Math.abs(Number(x.amount) - Number(t.amount)) <= Number(t.amount) * 0.25)));
  return regular.length ? pick(regular, "regel") : null;
}

/** Erinnerung eines Ziels normalisieren. */
export function goalReminder(goal) {
  const r = goal && goal.reminder && typeof goal.reminder === "object" ? goal.reminder : {};
  const day = Math.min(31, Math.max(1, Math.round(Number(r.day) || 1)));
  return { on: r.on === true, amount: round2(Math.max(0, Number(r.amount) || 0)), mode: r.mode === "day" ? "day" : "payday", day };
}

/** Tag des Monats (1–31) auf den Monat begrenzen → "YYYY-MM-DD". */
export function dayInMonth(mk, day) {
  const [y, m] = mk.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${mk}-${pad(Math.min(day, last))}`;
}

/**
 * Ist die Spar-Erinnerung dieses Ziels in diesem Monat fällig (und noch nicht erledigt/ausgeblendet)?
 * ctx: {txs, goals, bank} → {mk, date, kind, amount, rest, payday?} oder null
 */
export function reminderDue(goal, today = todayKey(), ctx = {}) {
  const r = goalReminder(goal);
  if (!r.on || !(r.amount > 0) || !goal || goal.archived) return null;
  const mk = monthOf(today);
  if (goal.remindAck === mk) return null;
  const cur = goalCurrent(goal, ctx.goals || [], ctx.bank || null);
  const rest = round2(Math.max(0, (Number(goal.target) || 0) - cur.amount));
  if (!(rest > 0)) return null;
  let date, payday = null;
  if (r.mode === "day") {
    date = dayInMonth(mk, r.day);
    if (date > today) return null;
  } else {
    payday = detectPayday(ctx.txs || [], today);
    if (!payday) return null;
    date = payday.date;
  }
  return { mk, date, kind: r.mode, amount: round2(Math.min(r.amount, rest)), rest, payday, linked: cur.linked };
}

/** Text für Banner und Push. */
export function reminderMessage(goal, due) {
  const what = `${goal.emoji ? goal.emoji + " " : ""}${goal.name || "dein Sparziel"}`;
  const title = due.kind === "payday" ? "💰 Lohn ist da!" : "💰 Zeit zum Sparen";
  const body = `Leg diesen Monat ${eur(due.amount)} für ${what} zur Seite (noch ${eur(due.rest)} bis zum Ziel)`;
  return { title, body, text: `${title} ${body}` };
}

/* Aufrunden */

/** Aufrundungsbetrag auf den nächsten vollen Euro (step 1) bzw. 5 € (step 5); glatte Beträge → 0. */
export function roundUpOf(amount, step = 1) {
  const c = Math.round((Number(amount) || 0) * 100);
  const s = (Number(step) === 5 ? 5 : 1) * 100;
  if (!(c > 0)) return 0;
  return ((s - (c % s)) % s) / 100;
}

/** Montag der Woche von key. */
export function weekStart(key = todayKey()) {
  const d = dateOf(key);
  const wd = (d.getDay() + 6) % 7; // Mo = 0
  return addDays(key, -wd);
}

const RU_SKIP = new Set(["sparen"]);
/**
 * Aufrunden für alle Ausgaben der Woche (Montag bis `today`). Sparen/Sparziel-Buchungen zählen nicht.
 * → {from, to, total, count}
 */
export function roundUpWeek(txs, today = todayKey(), step = 1) {
  const from = weekStart(today);
  let cents = 0, count = 0;
  for (const t of txs || []) {
    if (!t || t.type === "in" || !isKey(t.date) || t.date < from || t.date > today) continue;
    if (RU_SKIP.has(t.category) || t.goalId || t.roundup) continue;
    const r = roundUpOf(t.amount, step);
    if (r > 0) { cents += Math.round(r * 100); count++; }
  }
  return { from, to: today, total: cents / 100, count };
}

/** settings.money.roundup normalisieren. booked = {Wochenbeginn: schon gebuchter Betrag}. */
export function roundupSettings(settings) {
  const m = settings && settings.money && typeof settings.money === "object" ? settings.money : {};
  const r = m.roundup && typeof m.roundup === "object" ? m.roundup : {};
  const booked = {};
  for (const [k, v] of Object.entries(r.booked && typeof r.booked === "object" ? r.booked : {})) if (isKey(k) && Number(v) > 0) booked[k] = round2(v);
  return { on: r.on === true, step: Number(r.step) === 5 ? 5 : 1, push: r.push === true, goalId: r.goalId ? String(r.goalId) : "", booked };
}
