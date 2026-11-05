// Abo-Erkennung aus E-Mails – reine Funktionen ohne DOM/Netz (in Node testbar: test/subs-detect.test.mjs).
//
//   const mail = mailFromGmail(gmailMessageJson);          // {id, date, from, subject, text}
//   const det  = detectSub(mail, { today: "2026-11-04" }); // {service, key, amount, currency, interval, nextDate, kind, mailId, mailDate, confidence, …} | null
//   const list = detectAll(mails, { today });              // pro Dienst nur die neueste Erkennung
//   const acts = planActions(list, subs, handledKeys);     // was die Oberfläche anbieten soll
//
// Mails werden nur im Speicher verarbeitet; gespeichert wird nichts davon.

import { keyOf, dateOf, isKey, addDays, nextDue, round2 } from "./money-core.js";

/** Gmail-Suche nach Abo-Mails (Browser: gmail.js, Server: tools/mcp/src/gmail.js – dort mit after: statt newer_than:). */
export const GMAIL_QUERY = 'newer_than:400d (subject:(abo OR abonnement OR subscription OR mitgliedschaft OR "your receipt" OR rechnung OR beleg OR bestellbestätigung OR "trial" OR testzeitraum OR gekündigt OR kündigung OR cancelled OR verlängert OR renewal) OR from:(googleplay-noreply@google.com OR no_reply@email.apple.com OR netflix OR spotify OR amazon OR disneyplus OR youtube OR paypal))';

/* ---------- Bekannte Dienste ---------- */
// re: Treffer in Absender + Betreff + Text (Kleinbuchstaben). from: nur im Absender. cat: Kategorie in money_cats.
// via: Sammel-Absender (Google Play, Apple, PayPal) – dort wird zuerst nach einem konkreten Dienst im Text gesucht.
export const SERVICES = [
  { key: "netflix", name: "Netflix", re: /netflix/, cat: "abos", interval: "month" },
  { key: "spotify", name: "Spotify", re: /spotify/, cat: "abos", interval: "month" },
  { key: "disney", name: "Disney+", re: /disney\s?\+|disneyplus|disney plus/, cat: "abos", interval: "month" },
  { key: "youtube", name: "YouTube Premium", re: /youtube premium|youtube music premium|youtube-premium/, cat: "abos", interval: "month" },
  { key: "googleone", name: "Google One", re: /google one\b|google-one/, cat: "abos", interval: "month" },
  { key: "icloud", name: "iCloud+", re: /icloud\s?\+|icloud-speicher|icloud speicher|icloud storage|icloud-speicherplan|icloud plus/, cat: "abos", interval: "month" },
  { key: "applemusic", name: "Apple Music", re: /apple music/, cat: "abos", interval: "month" },
  { key: "appletv", name: "Apple TV+", re: /apple tv\s?\+|apple tv plus/, cat: "abos", interval: "month" },
  { key: "appleone", name: "Apple One", re: /apple one\b/, cat: "abos", interval: "month" },
  { key: "prime", name: "Amazon Prime", re: /amazon prime|prime[- ]mitgliedschaft|prime video|prime membership|amazon\.\w+\/prime|prime-abo/, cat: "abos", interval: "month" },
  { key: "kindle", name: "Kindle Unlimited", re: /kindle unlimited/, cat: "abos", interval: "month" },
  { key: "audible", name: "Audible", re: /audible/, cat: "abos", interval: "month" },
  { key: "dazn", name: "DAZN", re: /\bdazn\b/, cat: "abos", interval: "month" },
  { key: "sky", name: "Sky / WOW", re: /\bsky (x|ticket|go|q|österreich|deutschland|abo|entertainment|sport)\b|@sky\.(at|de)|\bwow\b ?(tv|ticket|abo|streaming|filme|serien|live-sport)|wowtv|@wowtv/, cat: "abos", interval: "month" },
  { key: "gamepass", name: "Xbox Game Pass", re: /game pass|xbox live gold|xbox/, cat: "abos", interval: "month" },
  { key: "psplus", name: "PlayStation Plus", re: /playstation\s?(®|\(r\))?\s?plus|ps plus|ps\+/, cat: "abos", interval: "month" },
  { key: "nintendo", name: "Nintendo Switch Online", re: /nintendo switch online|nintendo/, cat: "abos", interval: "year" },
  { key: "m365", name: "Microsoft 365", re: /microsoft 365|office 365/, cat: "abos", interval: "year" },
  { key: "chatgpt", name: "ChatGPT Plus", re: /chatgpt|openai/, cat: "abos", interval: "month" },
  { key: "claude", name: "Claude Pro", re: /claude\.ai|claude (pro|max)|anthropic/, cat: "abos", interval: "month" },
  { key: "duolingo", name: "Duolingo Super", re: /duolingo/, cat: "abos", interval: "year" },
  { key: "crunchyroll", name: "Crunchyroll", re: /crunchyroll/, cat: "abos", interval: "month" },
  { key: "twitch", name: "Twitch", re: /twitch/, cat: "abos", interval: "month" },
  { key: "nitro", name: "Discord Nitro", re: /discord nitro|nitro basic|\bnitro\b.*discord|discord.*\bnitro\b/, cat: "abos", interval: "month" },
  { key: "snapchat", name: "Snapchat+", re: /snapchat\s?\+|snapchat plus|snapchat\+/, cat: "abos", interval: "month" },
  { key: "tinder", name: "Tinder", re: /tinder/, cat: "freizeit", interval: "month" },
  { key: "paramount", name: "Paramount+", re: /paramount\s?\+|paramount plus/, cat: "abos", interval: "month" },
  { key: "rtlplus", name: "RTL+", re: /rtl\s?\+/, cat: "abos", interval: "month" },
  { key: "joyn", name: "Joyn PLUS+", re: /joyn/, cat: "abos", interval: "month" },
  { key: "deezer", name: "Deezer", re: /deezer/, cat: "abos", interval: "month" },
  { key: "tidal", name: "TIDAL", re: /\btidal\b/, cat: "abos", interval: "month" },
  { key: "eaplay", name: "EA Play", re: /ea play/, cat: "abos", interval: "month" },
  { key: "ubisoft", name: "Ubisoft+", re: /ubisoft\s?\+/, cat: "abos", interval: "month" },
  { key: "adobe", name: "Adobe", re: /adobe/, cat: "abos", interval: "month" },
  { key: "canva", name: "Canva Pro", re: /canva/, cat: "abos", interval: "month" },
  { key: "dropbox", name: "Dropbox", re: /dropbox/, cat: "abos", interval: "month" },
  { key: "nordvpn", name: "NordVPN", re: /nordvpn/, cat: "abos", interval: "year" },
  { key: "strava", name: "Strava", re: /strava/, cat: "freizeit", interval: "year" },
  { key: "komoot", name: "komoot", re: /komoot/, cat: "freizeit", interval: "year" },
  { key: "patreon", name: "Patreon", re: /patreon/, cat: "abos", interval: "month" },
  { key: "linkedin", name: "LinkedIn Premium", re: /linkedin premium/, cat: "abos", interval: "month" },
  { key: "babbel", name: "Babbel", re: /babbel/, cat: "schule", interval: "month" },
  { key: "headspace", name: "Headspace", re: /headspace/, cat: "gesundheit", interval: "year" },
  { key: "mcfit", name: "McFit", re: /mcfit|mc fit/, cat: "freizeit", interval: "month" },
  { key: "fitinn", name: "FitInn", re: /fit ?inn\b/, cat: "freizeit", interval: "month" },
  { key: "cleverfit", name: "clever fit", re: /clever ?fit/, cat: "freizeit", interval: "month" },
  { key: "johnharris", name: "John Harris Fitness", re: /john harris/, cat: "freizeit", interval: "month" },
  { key: "a1", name: "A1", re: /\ba1 telekom|@a1\.(net|at)|\ba1\.net\b|\ba1 (rechnung|xcite|mobil|go|internet)|mein a1/, cat: "handy", interval: "month" },
  { key: "magenta", name: "Magenta", re: /magenta/, cat: "handy", interval: "month" },
  { key: "drei", name: "Drei", re: /@drei\.at|\bdrei\.at\b|\bdrei (rechnung|mobil|tarif|kunden)|ihre drei-rechnung|hutchison drei/, cat: "handy", interval: "month" },
  { key: "hot", name: "HoT", re: /@hot\.at|\bhot\.at\b|hofer telekom|\bhot (mobil|tarif|guthaben|aufladung|fix)/, cat: "handy", interval: "month" },
  { key: "spusu", name: "spusu", re: /spusu/, cat: "handy", interval: "month" },
  { key: "yesss", name: "yesss!", re: /yesss/, cat: "handy", interval: "month" },
  { key: "bob", name: "bob", re: /@bob\.at|\bbob\.at\b|\bbob (mobil|tarif|rechnung)/, cat: "handy", interval: "month" },
  { key: "georg", name: "Georg (Mobilfunk)", re: /@georg\.at/, cat: "handy", interval: "month" },
];

// Sammel-Absender: erst konkreten Dienst suchen, sonst eigener Name
const VIA = [
  { key: "googleplay", name: "Google Play", re: /googleplay-noreply@google\.com|google play/ },
  { key: "apple", name: "Apple (App Store)", re: /no_reply@email\.apple\.com|@apple\.com|app store|apple-id|apple id|itunes/ },
  { key: "paypal", name: "PayPal", re: /paypal/ },
  { key: "amazon", name: "Amazon", re: /amazon/ },
];

const byKey = new Map(SERVICES.map((s) => [s.key, s]));
export const serviceByKey = (k) => byKey.get(k) || null;

/* ---------- Text-Hilfen ---------- */

const MONTH_NAMES = {
  jänner: 1, jaenner: 1, januar: 1, january: 1, jan: 1, jän: 1,
  februar: 2, feber: 2, february: 2, feb: 2,
  märz: 3, maerz: 3, march: 3, mär: 3, mar: 3, mrz: 3,
  april: 4, apr: 4,
  mai: 5, may: 5,
  juni: 6, june: 6, jun: 6,
  juli: 7, july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  oktober: 10, october: 10, okt: 10, oct: 10,
  november: 11, nov: 11,
  dezember: 12, december: 12, dez: 12, dec: 12,
};
const MONTH_RE = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join("|");

/** base64url → UTF-8-Text (charset optional, z. B. "iso-8859-1"). */
export function decodeB64url(data, charset = "utf-8") {
  if (!data) return "";
  let b64 = String(data).replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  while (b64.length % 4) b64 += "=";
  let bin;
  try { bin = atob(b64); } catch { return ""; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try { return new TextDecoder(charset || "utf-8").decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", euro: "€", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·", reg: "®", copy: "©", trade: "™", zwnj: "", shy: "" };

/** HTML grob in lesbaren Text umwandeln (ohne DOM). */
export function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n in ENT ? ENT[n] : m))
    .replace(/[ \t ​‌]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function header(payload, name) {
  const h = (payload && payload.headers || []).find((x) => String(x.name).toLowerCase() === name);
  return h ? String(h.value || "") : "";
}

function charsetOf(part) {
  const m = /charset="?([\w-]+)/i.exec(header(part, "content-type"));
  return m ? m[1].toLowerCase() : "utf-8";
}

/** Gmail-Nachricht (format=full) → {id, date (ms), from, subject, text}. text/plain bevorzugt, sonst HTML ohne Tags. */
export function mailFromGmail(msg) {
  const p = (msg && msg.payload) || {};
  let plain = "", html = "";
  const walk = (part, depth = 0) => {
    if (!part || depth > 8) return;
    const mt = String(part.mimeType || "").toLowerCase();
    if (part.body && part.body.data && !(part.filename)) {
      if (mt === "text/plain" && !plain) plain = decodeB64url(part.body.data, charsetOf(part));
      else if (mt === "text/html" && !html) html = decodeB64url(part.body.data, charsetOf(part));
    }
    for (const c of part.parts || []) walk(c, depth + 1);
  };
  walk(p);
  let text = plain.trim() ? plain : htmlToText(html);
  if (!text.trim()) text = String(msg && msg.snippet || "");
  const dHeader = Date.parse(header(p, "date"));
  const date = Number(msg && msg.internalDate) || (isFinite(dHeader) ? dHeader : Date.now());
  return { id: String(msg && msg.id || ""), date, from: header(p, "from"), subject: header(p, "subject"), text };
}

/* ---------- Beträge ---------- */

/** "1.234,56" / "9,99" / "9.99" / "1,234.56" / "12" → Zahl */
export function parseNum(s) {
  let t = String(s || "").replace(/[\s ']/g, "");
  if (!t) return NaN;
  const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
  if (lc >= 0 && ld >= 0) {
    const dec = lc > ld ? "," : ".";
    t = t.split(dec === "," ? "." : ",").join("");
    t = t.replace(",", ".");
  } else if (lc >= 0 || ld >= 0) {
    const sep = lc >= 0 ? "," : ".";
    const after = t.length - t.lastIndexOf(sep) - 1;
    const parts = t.split(sep);
    if (after === 3 && parts.length >= 2 && parts[0].length <= 3 && sep === ".") t = parts.join(""); // 1.234
    else if (after === 3 && sep === ",") t = parts.join(""); // 1,234 (englisch)
    else t = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
  }
  const n = Number(t);
  return isFinite(n) ? round2(n) : NaN;
}

const NUM = String.raw`\d{1,5}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\d{1,5}`;
const CUR_BEFORE = new RegExp(String.raw`(€|eur\b|euro\b|\$|usd\b|£|gbp\b|chf\b)\s?(${NUM})(?:,-|,–)?`, "gi");
const CUR_AFTER = new RegExp(String.raw`(?<![\d.,])(${NUM})(?:,-|,–)?\s?(€|eur\b|euro\b|\$|usd\b|£|gbp\b|chf\b)`, "gi");

function curCode(s) {
  const c = String(s).toLowerCase();
  if (c === "$" || c === "usd") return "USD";
  if (c === "£" || c === "gbp") return "GBP";
  if (c === "chf") return "CHF";
  return "EUR";
}

/** Alle Geldbeträge mit Position: [{value, currency, index, end}] */
export function findAmounts(text) {
  const t = String(text || "");
  const res = [];
  const seen = new Set();
  for (const re of [CUR_BEFORE, CUR_AFTER]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const before = re === CUR_BEFORE;
      const num = before ? m[2] : m[1];
      const cur = before ? m[1] : m[2];
      const value = parseNum(num.replace(/\s(?=\d{3}\b)/g, ""));
      if (!(value > 0) || value > 5000) continue;
      if (seen.has(m.index)) continue;
      seen.add(m.index);
      res.push({ value, currency: curCode(cur), index: m.index, end: m.index + m[0].length });
    }
  }
  return res.sort((a, b) => a.index - b.index);
}

const TAX_BEFORE = /(mwst|mehrwertsteuer|ust\.?|umsatzsteuer|vat|tax|steuer|rabatt|ersparnis|sparen|du sparst|you save|discount|guthaben|gutschein|rückerstattung|refund|netto|zwischensumme|subtotal)[^\n]{0,18}$/i;
const TOTAL_BEFORE = /(gesamt|summe|total|betrag|preis|price|amount|charged|belastet|abgebucht|zahlung|bezahlt|paid|kosten|kostet|monatlich|jährlich|nur|für|for|ab|now|jetzt|neu|new)[^\n]{0,28}$/i;
const INTERVAL_AFTER = /^\s?(\/|pro|per|im|je|a |each|every|monatlich|jährlich|mtl|monthly|yearly|annual)/i;

/** Hauptbetrag wählen: Steuer/Rabatt-Beträge ignorieren, Gesamt/Preis/„pro Monat“ bevorzugen. */
export function pickAmount(text) {
  const t = String(text || "");
  const all = findAmounts(t);
  if (!all.length) return null;
  let best = null, bestScore = -Infinity;
  all.forEach((a, i) => {
    const pre = t.slice(Math.max(0, a.index - 40), a.index);
    const post = t.slice(a.end, a.end + 16);
    let s = 0;
    if (TAX_BEFORE.test(pre)) s -= 5;
    if (TOTAL_BEFORE.test(pre)) s += 2;
    if (/(gesamt|summe|total|endbetrag)[^\n]{0,20}$/i.test(pre)) s += 2;
    if (INTERVAL_AFTER.test(post)) s += 3;
    if (/^\s?(inkl|incl)/i.test(post)) s += 1;
    s -= i * 0.05; // frühere leicht bevorzugen
    if (s > bestScore) { bestScore = s; best = a; }
  });
  return best;
}

/** Preisänderung „von 10,99 € auf 12,99 €“ / „from €10.99 to €12.99“ → {oldAmount, amount} */
export function findPriceChange(text) {
  const t = String(text || "");
  const all = findAmounts(t);
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i], b = all[i + 1];
    const between = t.slice(a.end, b.index);
    const pre = t.slice(Math.max(0, a.index - 30), a.index);
    if (between.length > 30) continue;
    if (/\b(statt|anstatt|instead of)\b/i.test(between)) return { amount: a.value, oldAmount: b.value, currency: a.currency };
    if (/\b(auf|to|nun|now)\b|→|->/i.test(between) || (/(von|from|bisher|bislang|current|aktuell)\s*$/i.test(pre) && /\b(neu|new)\b/i.test(between))) {
      return { oldAmount: a.value, amount: b.value, currency: b.currency };
    }
  }
  return null;
}

/* ---------- Intervall ---------- */

const INTERVAL_PATTERNS = [
  ["week", /wöchentlich|woechentlich|pro woche|je woche|\/\s?woche|wochenabo|weekly|per week|a week|each week|every week|\/\s?wk\b|\/\s?week/gi],
  ["quarter", /vierteljährlich|quartalsweise|pro quartal|alle 3 monate|alle drei monate|3-monats|quarterly|every 3 months|per quarter/gi],
  ["year", /jährlich|jaehrlich|pro jahr|je jahr|im jahr|\/\s?jahr|jahresabo|jahresmitgliedschaft|jahrespaket|jahresplan|jahres-abo|jahresabonnement|12-monatig|12 monatig|12 monate|zwölf monate|yearly|annual(ly)?|per year|a year|each year|every year|\/\s?yr\b|\/\s?year|12 months|12-month/gi],
  ["month", /monatlich|pro monat|je monat|im monat|\/\s?monat|\/\s?mon\.?(?![a-z])|mtl\.?|monatsabo|monatspaket|monthly|per month|a month|each month|every month|\/\s?mo\b|\/\s?month|1 monat|1 month|monatlicher|monatliche/gi],
];

/** Intervall nahe am Betrag (oder erstes im Text). */
export function parseInterval(text, nearIndex = null) {
  const t = String(text || "");
  let best = null;
  for (const [iv, re] of INTERVAL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      // „12 Monate gratis“/„1 Monat kostenlos“ ist eine Aktion, kein Intervall
      if (/^\s?(gratis|kostenlos|free|testen|probe)/i.test(t.slice(m.index + m[0].length, m.index + m[0].length + 12)) && /\d/.test(m[0])) continue;
      const dist = nearIndex == null ? m.index : Math.abs(m.index - nearIndex);
      if (!best || dist < best.dist) best = { iv, dist };
    }
  }
  return best ? best.iv : null;
}

/* ---------- Datum ---------- */

function mk(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(y, m - 1, d, 12);
  if (dt.getMonth() !== m - 1) return null;
  return keyOf(dt);
}

function fixYear(y, m, d, refKey) {
  if (y != null) return mk(y < 100 ? 2000 + y : y, m, d);
  const ref = dateOf(refKey);
  let k = mk(ref.getFullYear(), m, d);
  if (k && k < addDays(refKey, -45)) k = mk(ref.getFullYear() + 1, m, d);
  return k;
}

/** Alle Datumsangaben im Text: [{key, index}]. refKey = Maildatum (für Daten ohne Jahr). */
export function findDates(text, refKey) {
  const t = String(text || "");
  const res = [];
  const push = (key, index) => { if (key) res.push({ key, index }); };
  let m;
  const reNum = /(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})(?!\d))?/g;
  while ((m = reNum.exec(t))) push(fixYear(m[3] != null ? Number(m[3]) : null, Number(m[2]), Number(m[1]), refKey), m.index);
  const reIso = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
  while ((m = reIso.exec(t))) push(mk(Number(m[1]), Number(m[2]), Number(m[3])), m.index);
  const reDMY = new RegExp(String.raw`(?<!\d)(\d{1,2})\.?\s(${MONTH_RE})\.?(?:,?\s(\d{4}))?(?![a-zäöü])`, "gi");
  while ((m = reDMY.exec(t))) push(fixYear(m[3] ? Number(m[3]) : null, MONTH_NAMES[m[2].toLowerCase()], Number(m[1]), refKey), m.index);
  const reMDY = new RegExp(String.raw`(?<![a-zäöü])(${MONTH_RE})\.?\s(\d{1,2})(?:st|nd|rd|th)?(?:,?\s(\d{4}))?(?!\d)`, "gi");
  while ((m = reMDY.exec(t))) push(fixYear(m[3] ? Number(m[3]) : null, MONTH_NAMES[m[1].toLowerCase()], Number(m[2]), refKey), m.index);
  const reSlash = /(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/g; // US-Format M/D/YYYY
  while ((m = reSlash.exec(t))) push(mk(Number(m[3]), Number(m[1]), Number(m[2])), m.index);
  return res.sort((a, b) => a.index - b.index);
}

const NEXT_KW = /((erste|nächste)\s(abbuchung|zahlung|belastung)|abbuchung (erfolgt )?|nächste[nrs]?\s(zahlung|abbuchung|abrechnung|rechnung|verlängerung|belastung|zahlungstermin|abrechnungsdatum|abrechnungszeitraum)|nächster\s(zahlungstermin|abrechnungstermin|termin)|verlängert sich (automatisch )?(am|zum)|wird (automatisch )?(am|zum)\s|erneuert (sich )?(am|zum)|abgebucht am|verlängerung am|verlängerungsdatum|ab dem|ab\s(?=\d)|gilt ab|endet am|endet zum|enden am|läuft (noch )?bis|läuft am|laeuft am|bis zum|bis einschließlich|gültig bis|aktiv bis|zugriff bis|next (billing|payment|charge|renewal|bill)( date)?|renews? (on|automatically on)|will (be )?renew(ed)? on|will be (charged|billed) on|billed on|charged on|renewal date|ends on|end on|expires? on|until|effective (from|on|as of)?|starting( on| from)?|from your billing date|beginning)/gi;

/** Datum, das sich auf die nächste Zahlung/Verlängerung/das Ende bezieht. */
export function findNextDate(text, refKey) {
  const t = String(text || "");
  const dates = findDates(t, refKey);
  if (!dates.length) return null;
  NEXT_KW.lastIndex = 0;
  let m, best = null;
  while ((m = NEXT_KW.exec(t))) {
    const from = m.index + m[0].length;
    const d = dates.find((x) => x.index >= m.index && x.index - from <= 45);
    if (d && (!best || d.index < best.index)) best = d;
    if (best) break;
  }
  return best ? best.key : null;
}

/* ---------- Art der Mail ---------- */

const RE_CANCEL = /gekündigt|gekuendigt|kündigungsbestätigung|kündigung (ist |wurde )?(bestätigt|erhalten|eingegangen|erfolgreich)|deine kündigung|ihre kündigung|abo (wurde |ist )?(beendet|storniert)|abonnement (wurde |ist )?(beendet|storniert|gekündigt)|mitgliedschaft (wurde |ist )?(beendet|gekündigt)|wird nicht (mehr )?verlängert|nicht mehr verlängert|automatische verlängerung (wurde )?(deaktiviert|ausgeschaltet)|läuft (am .{0,25})?ab\b|laeuft (am .{0,25})?ab\b|cancell?ed|cancell?ation|has been cancel|will not (auto-?)?renew|won'?t (auto-?)?renew|subscription (has )?ended|membership (has )?ended|auto-renew(al)? (is |has been )?(turned )?off|we'?re sorry to see you go|schade, dass du gehst/i;
const RE_TRIAL = /testzeitraum|probezeitraum|probemonat|probeabo|probe-abo|testphase|gratis-?monat|kostenlos testen|gratis testen|kostenloser zeitraum|kostenlose testversion|free trial|trial (period|ends|will end|is ending)|your trial|deine testphase|ihr testzeitraum|dein testzeitraum|\btrial\b/i;
const RE_TRIAL_ACTIVE = /(dein|deines|ihr|ihres|your)\s+(kostenlose[rnms]?\s+|gratis-?\s*)?(testzeitraum|probezeitraum|testphase|probemonat|probeabo|free trial|trial)|trial (ends|will end|is ending|ended|endet|expires)|(testzeitraum|probezeitraum|testphase|probemonat) (endet|läuft|beginnt|hat begonnen|startet|ist aktiv|gestartet)|testzeitraum .{0,40}(endet|läuft)/i;
const RE_PRICE = /(passen|ändern|erhöhen|aktualisieren) (wir )?(den|die|deinen|ihren) (preis|preise|beitrag|abopreis)|preisänderung|preisanpassung|preiserhöhung|neuer preis|neue preise|neuen preis|preis (wird |ändert sich|steigt)|wird teurer|price (change|increase|update|adjustment)|new price|prices? (are|is) changing|änderung (des|deines|ihres) (preises|abopreises)/i;
const RE_RENEW = /verlängert|verlängerung|erneuert|erneuerung|renewal|renewed|will renew|zahlungsbestätigung|zahlungseingang|rechnung|beleg|quittung|receipt|invoice|payment (received|confirmation|successful)|abgebucht|belastet|charged|danke für (deine|ihre) zahlung|thank you for your (payment|purchase)|bestellbestätigung|kaufbestätigung|your (monthly|annual) (plan|subscription)|abrechnung/i;
const RE_NEW = /willkommen|welcome|danke für (dein|ihr|das) abo|danke,? dass du .{0,30}abonniert|abonniert|subscribed|bestätigung (deines|ihres|des) (abos|abonnements)|abo-?bestätigung|subscription confirm|you'?re (now )?subscribed|neues abo|mitgliedschaft (wurde )?(aktiviert|gestartet|bestätigt)|du bist jetzt|(ist|sind) (jetzt|nun) aktiv|is now active|you'?re now (a )?(premium|member|plus)|thanks for (subscribing|joining)|aktivierung/i;
const RE_SUB = /\babo\b|abos\b|abonnement|abonniert|subscription|subscribed|mitgliedschaft|membership|premium|\bplus\b|\bpro\b|monatlich|jährlich|recurring|wiederkehrend|automatische zahlung|automatic payment|lastschrift|dauerauftrag|testzeitraum|trial|verlängert|verlängerung|renew|tarif|grundgebühr|vertrag/i;
const RE_ONEOFF = /deine bestellung|ihre bestellung|order #|order number|bestellnummer|versandbestätigung|shipped|versandt|lieferung|delivery|paket/i;

export function classifyKind(text) {
  const t = String(text || "");
  if (RE_CANCEL.test(t)) return "cancel";
  if (RE_TRIAL.test(t)) return "trial";
  if (RE_PRICE.test(t)) return "price_change";
  if (RE_NEW.test(t)) return "new";
  if (RE_RENEW.test(t)) return "renewal";
  return null;
}

/* ---------- Dienst ---------- */

const cleanName = (s) => String(s || "").replace(/["„“”«»]/g, "").replace(/\s*[:(|].*$/, "").replace(/\s+[-–—].*$/, "").replace(/\s+/g, " ").trim().slice(0, 40);

/** Google Play: „Ihr Abo für X“ / „Your subscription to X“ / „Abonnement für X bei Google Play“ */
function googlePlayApp(text) {
  const re = /(?:(?:ihr|dein|ihres|deines)\s+(?:abo(?:nnement)?|testzeitraum|probezeitraum)\s+(?:für|von|bei)|your\s+(?:subscription|free trial)\s+(?:to|for|from)|subscription\s+(?:to|for)|abo(?:nnement)?\s+für)\s+["„“]?([^\n"„“”]{2,60}?)["“”]?\s*(?:\(|bei google play|on google play|from google play|wurde|ist|has|will|endet|ends|läuft|wird|was|\n|[.!,–-]\s|$)/gim;
  let m;
  while ((m = re.exec(text))) {
    const name = cleanName(m[1]);
    if (name && !/^google play\b/i.test(name)) return name;
  }
  return null;
}

/** Dienst erkennen → {key, name, cat, via?, known} | null */
export function detectService(mail) {
  const from = String(mail.from || "").toLowerCase();
  const subject = String(mail.subject || "");
  const body = String(mail.text || "");
  const hay = (from + "\n" + subject + "\n" + body).toLowerCase();
  const head = (from + "\n" + subject).toLowerCase();
  const via = VIA.find((v) => v.re.test(from)) || VIA.find((v) => v.key !== "amazon" && v.re.test(head));
  // Erst Absender + Betreff, dann ganzer Text (damit Werbe-Fußzeilen nicht gewinnen)
  let svc = SERVICES.find((s) => s.re.test(head)) || SERVICES.find((s) => s.re.test(hay));
  if (svc) return { key: svc.key, name: svc.name, cat: svc.cat, via: via && via.key !== svc.key ? via.name : null, known: true, defInterval: svc.interval };
  if (via && via.key === "googleplay") {
    const app = googlePlayApp(subject + "\n" + body);
    if (app) {
      const inner = SERVICES.find((s) => s.re.test(app.toLowerCase()));
      if (inner) return { key: inner.key, name: inner.name, cat: inner.cat, via: "Google Play", known: true, defInterval: inner.interval };
      return { key: "gp:" + slug(app), name: app, cat: "abos", via: "Google Play", known: true };
    }
    return { key: "googleplay", name: "Google Play", cat: "abos", via: null, known: true };
  }
  if (via && via.key === "apple") return { key: "apple", name: "Apple (App Store)", cat: "abos", via: null, known: true };
  if (via && via.key === "paypal") {
    const m = /(?:automatische zahlungen? an|automatic payments? to|abonnement bei|subscription (?:with|to)|händler:?|merchant:?)\s+["„]?([a-z0-9][\w&.+' -]{1,30}?)["“]?(?:\s+(?:eingerichtet|genehmigt|gesendet|wurde|has|was|is)|[.,\n]|$)/i.exec(subject + "\n" + body);
    if (m) {
      const name = cleanName(m[1]);
      return { key: "pp:" + slug(name), name, cat: "abos", via: "PayPal", known: false };
    }
    return null;
  }
  return null;
}

export function slug(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\+/g, "plus").replace(/[^a-z0-9]+/g, "");
}

/** Allgemeiner Treffer ohne bekannten Dienst: Name aus Absender-Anzeigename oder Domain. */
function genericService(mail) {
  const from = String(mail.from || "");
  let name = (/^\s*"?([^"<]+?)"?\s*</.exec(from) || [])[1] || "";
  name = name.replace(/\b(no-?reply|noreply|info|service|support|team|kundenservice|newsletter|rechnung|billing|mail)\b/gi, "").replace(/[|·•-]+$/g, "").trim();
  if (!name || name.length < 2) {
    const dom = (/@([\w.-]+)/.exec(from) || [])[1] || "";
    const parts = dom.split(".").filter((p) => !/^(mail|email|e|news|info|noreply|billing|accounts?|service)$/i.test(p));
    name = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "";
    name = name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
  }
  if (!name) return null;
  return { key: "g:" + slug(name), name: cleanName(name), cat: "abos", via: null, known: false };
}

/* ---------- Erkennung ---------- */

function rollForward(key, interval, today) {
  if (!isKey(key) || !today) return key;
  let k = key, guard = 0;
  const anchor = interval === "week" ? null : dateOf(key).getDate();
  while (k < today && guard++ < 600) k = nextDue(k, interval || "month", anchor);
  return k;
}

/**
 * Eine Mail auswerten. opts.today = "YYYY-MM-DD" (Standard heute).
 * → {service, key, category, via, amount, currency, interval, nextDate, kind, oldAmount?, mailId, mailDate, subject, confidence} | null
 */
export function detectSub(mail, opts = {}) {
  if (!mail) return null;
  const today = opts.today || keyOf(new Date());
  const mailDate = keyOf(new Date(Number(mail.date) || Date.parse(mail.date) || Date.now()));
  const subject = String(mail.subject || "");
  const body = String(mail.text || "").slice(0, 20000);
  const full = subject + "\n" + body;
  const lower = full.toLowerCase();

  let svc = detectService(mail);
  const subSignal = RE_SUB.test(full) || RE_TRIAL.test(full) || RE_CANCEL.test(full);
  if (!svc) {
    if (!subSignal) return null;
    svc = genericService(mail);
    if (!svc) return null;
  }
  // Sammel-Absender ohne Abo-Hinweis (z. B. normale Amazon-/PayPal-Bestellung) → kein Abo
  if (!subSignal && (!svc.known || svc.via)) return null;
  if (!svc.known && RE_ONEOFF.test(full) && !/abo|subscription|mitgliedschaft|membership/i.test(full)) return null;
  if (svc.key === "prime" && RE_ONEOFF.test(subject) && !/prime/i.test(subject)) return null;

  let kind = classifyKind(full);
  const pc = kind === "price_change" ? findPriceChange(body) || findPriceChange(full) : null;
  const pick = pc ? null : pickAmount(body) || pickAmount(subject);
  let amount = pc ? pc.amount : pick ? pick.value : null;
  const currency = pc ? pc.currency : pick ? pick.currency : "EUR";
  const near = pick ? pick.index : null;
  let interval = parseInterval(body, near) || parseInterval(subject);
  const intervalFound = !!interval;
  if (!interval) interval = svc.defInterval || "month";

  // Generische Treffer brauchen Betrag UND (Intervall oder klare Art), sonst zu unsicher
  if (!svc.known && !(amount && (intervalFound || kind === "renewal" || kind === "new" || kind === "trial"))) return null;
  if (!kind) kind = amount ? "renewal" : null;
  if (!kind) return null;
  // Werbung („3 Monate gratis testen!“) ist kein laufender Testzeitraum
  if (kind === "trial" && !RE_TRIAL_ACTIVE.test(full)) return null;
  // Bei Test/Kündigung ist ein Betrag oft „0,00 €“ oder der künftige Preis – beides ok
  if (kind === "trial" && amount === 0) amount = null;

  let nextDate = findNextDate(body, mailDate) || findNextDate(subject, mailDate);
  if (kind === "trial" || kind === "cancel") {
    if (!nextDate) {
      // „Testzeitraum endet am …“ ohne Schlüsselwort davor: erstes Datum nach dem Maildatum
      const ds = findDates(body, mailDate).filter((d) => d.key >= mailDate);
      if (ds.length) nextDate = ds[0].key;
    }
  } else if (kind === "price_change") {
    if (!nextDate) nextDate = null;
  } else {
    if (!nextDate || nextDate <= mailDate) nextDate = nextDue(mailDate, interval);
    nextDate = rollForward(nextDate, interval, today);
  }

  let confidence = 0.3;
  if (svc.known) confidence += 0.3;
  if (amount) confidence += 0.15;
  if (intervalFound) confidence += 0.1;
  if (nextDate) confidence += 0.05;
  if (/abo|abonnement|subscription|mitgliedschaft|membership/i.test(lower)) confidence += 0.1;
  confidence = Math.min(1, Math.round(confidence * 100) / 100);

  const out = {
    service: svc.name, key: svc.key, category: svc.cat || "abos", via: svc.via || null,
    amount: amount != null ? round2(amount) : null, currency, interval, intervalFound,
    nextDate: nextDate || null, kind,
    mailId: String(mail.id || ""), mailDate, mailTs: Number(mail.date) || Date.parse(mail.date) || 0,
    subject: subject.slice(0, 140), confidence,
  };
  if (pc) out.oldAmount = pc.oldAmount;
  return out;
}

/** Alle Mails auswerten, pro Dienst nur die neueste Erkennung behalten (neueste zuerst). */
export function detectAll(mails, opts = {}) {
  const best = new Map();
  for (const m of mails || []) {
    let d = null;
    try { d = detectSub(m, opts); } catch { d = null; }
    if (!d || d.confidence < (opts.minConfidence ?? 0.5)) continue;
    const cur = best.get(d.key);
    if (!cur || d.mailTs > cur.mailTs) {
      // Betrag aus älterer Mail übernehmen, wenn die neueste keinen hat (z. B. Kündigung)
      if (cur && d.amount == null && cur.amount != null) d.lastAmount = cur.amount;
      best.set(d.key, d);
    } else if (cur.amount == null && d.amount != null && cur.lastAmount == null) cur.lastAmount = d.amount;
  }
  return [...best.values()].sort((a, b) => b.mailTs - a.mailTs);
}

/* ---------- Abgleich mit vorhandenen Abos ---------- */

export const handledKey = (det) => `${det.key}|${det.mailId}`;

/** Passt ein vorhandenes Abo (money_subs) zur Erkennung? */
export function matchSub(det, subs) {
  const list = (subs || []).filter((s) => s && !s.deleted);
  const direct = list.find((s) => s.gmail && s.gmail.key === det.key);
  if (direct) return direct;
  const a = slug(det.service);
  const svc = serviceByKey(det.key);
  const alias = svc ? slug(svc.name.split(/[ /]/)[0]) : a;
  return list.find((s) => {
    const b = slug(s.name);
    if (!b) return false;
    if (b === a || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b))) return true;
    if (svc && (svc.re.test(String(s.name).toLowerCase()) || (alias.length >= 4 && b.includes(alias)))) return true;
    return false;
  }) || null;
}

/**
 * Was soll angeboten werden? handled = Set von handledKey (übernommen/ignoriert).
 * → [{type:"new"|"price"|"cancel"|"trial", det, sub?}]
 */
export function planActions(dets, subs, handled = new Set(), today = keyOf(new Date())) {
  const res = [];
  for (const d of dets || []) {
    if (handled.has(handledKey(d))) continue;
    const sub = matchSub(d, subs);
    const active = sub && !sub.paused && !sub.ended;
    if (d.kind === "trial") {
      if (d.nextDate && d.nextDate >= today) res.push({ type: "trial", det: d, sub });
      continue;
    }
    if (d.kind === "cancel") {
      if (active) res.push({ type: "cancel", det: d, sub });
      continue;
    }
    if (sub) {
      if (!active) {
        // Beendetes Abo, aber neuere Zahlung → wieder neu anbieten
        const endKey = sub.ended || "";
        if (endKey && d.mailDate > endKey && d.amount) res.push({ type: "new", det: d, sub: null });
        continue;
      }
      if (d.amount && Math.abs((Number(sub.amount) || 0) - d.amount) >= 0.01 && (d.kind === "price_change" || (d.interval === (sub.interval || "month")))) {
        res.push({ type: "price", det: d, sub });
      }
      continue;
    }
    if (d.kind === "price_change" && !d.amount) continue;
    res.push({ type: "new", det: d, sub: null });
  }
  return res;
}

/** Abo-Objekt für money_subs aus einer Erkennung */
export function subFromDet(det, today = keyOf(new Date())) {
  const interval = det.interval || "month";
  const next = isKey(det.nextDate) && det.nextDate >= today ? det.nextDate : rollForward(det.nextDate || nextDue(det.mailDate, interval), interval, today);
  return {
    name: det.service, amount: det.amount, interval, next,
    day: interval === "week" ? null : dateOf(next).getDate(),
    category: det.category || "abos", paused: false,
    source: "gmail", gmail: { key: det.key, mailId: det.mailId },
  };
}

/** Erinnerungs-Datum für einen Testzeitraum: 2 Tage vorher, nie in der Vergangenheit. */
export function trialRemindDate(endKey, today = keyOf(new Date())) {
  if (!isKey(endKey)) return today;
  const k = addDays(endKey, -2);
  return k < today ? today : k;
}
