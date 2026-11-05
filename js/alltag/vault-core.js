// Alltag › Passwort-Tresor: reine Hilfsfunktionen ohne DOM/Krypto-Schlüssel
// (Eintragsarten, Stärke-Schätzung, Generator, Sicherheits-Check, Suche, CSV für Bitwarden, WLAN-QR-Text).
import { normDocFields, docSubtitle, DOC_KINDS, fmtKey } from "./vault-docs-core.js";

export const TYPES = {
  login: { label: "Login", icon: "key", color: "#4F46E5" },
  pin:   { label: "PIN/Code", icon: "hash", color: "#D97706" },
  wifi:  { label: "WLAN", icon: "wifi", color: "#0E7490" },
  note:  { label: "Notiz", icon: "note", color: "#7C3AED" },
  card:  { label: "Karte/Ausweis", icon: "card", color: "#059669" },
  doc:   { label: "Dokument", icon: "file", color: "#1D4ED8" },   // Update 9 – Dokumente (vault-docs.js)
};
export const TYPE_IDS = Object.keys(TYPES);
export const CATEGORIES = ["Privat", "Arbeit", "Schule", "Bank & Geld", "Einkaufen", "Social Media", "Spiele", "Handy", "Zuhause"];
export const WIFI_ENC = { WPA: "WPA/WPA2/WPA3", WEP: "WEP (veraltet)", nopass: "Offen (ohne Passwort)" };

const s = (v) => (v == null ? "" : String(v));

/** Eintrag säubern: nur bekannte Felder, Strings gekürzt. */
export function normEntry(e) {
  const type = TYPES[e && e.type] ? e.type : "login";
  const out = { type, title: s(e.title).trim().slice(0, 120), category: s(e.category).trim().slice(0, 40), fav: !!e.fav, note: s(e.note).slice(0, 5000) };
  if (type === "login") Object.assign(out, { user: s(e.user).trim().slice(0, 200), password: s(e.password).slice(0, 500), url: s(e.url).trim().slice(0, 500) });
  if (type === "pin") Object.assign(out, { pin: s(e.pin).slice(0, 100), puk: s(e.puk).slice(0, 100) });
  if (type === "wifi") Object.assign(out, { ssid: s(e.ssid).slice(0, 64), password: s(e.password).slice(0, 200), enc: WIFI_ENC[e.enc] ? e.enc : "WPA", hidden: !!e.hidden });
  if (type === "card") Object.assign(out, { holder: s(e.holder).trim().slice(0, 120), number: s(e.number).trim().slice(0, 60) });
  if (type === "doc") Object.assign(out, normDocFields(e));
  if (!out.title) out.title = type === "wifi" && out.ssid ? out.ssid : type === "doc" ? DOC_KINDS[out.kind].label : TYPES[type].label;
  if (e.pwChanged) out.pwChanged = Number(e.pwChanged) || null;
  return out;
}

/** Untertitel für die Liste (nie Passwörter/PINs). */
export function subtitle(e) {
  if (e.type === "login") return e.user || hostOf(e.url) || "";
  if (e.type === "wifi") return e.ssid ? "SSID " + e.ssid : "";
  if (e.type === "card") return [e.holder, maskNumber(e.number)].filter(Boolean).join(" · ");
  if (e.type === "pin") return e.puk ? "PIN + PUK" : "PIN/Code";
  if (e.type === "doc") return docSubtitle(e);
  return ""; // Notizen: Inhalt nicht in der Liste zeigen (Blick über die Schulter)
}

export function hostOf(url) {
  const u = s(url).trim();
  if (!u) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, ""); }
  catch { return u.slice(0, 40); }
}

/** Link nur für http/https (keine javascript:-URLs). */
export function safeUrl(url) {
  const u = s(url).trim();
  if (!u) return "";
  try {
    const p = new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : "https://" + u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : "";
  } catch { return ""; }
}

export function maskNumber(n) {
  const d = s(n).replace(/\s+/g, "");
  if (d.length <= 4) return d;
  return "•••• " + d.slice(-4);
}

/** Das „Geheimnis“ eines Eintrags (für Sicherheits-Check). */
export function secretOf(e) {
  if (e.type === "login" || e.type === "wifi") return s(e.password);
  return "";
}

/* ---------- Stärke-Schätzung (einfache Entropie mit Abzügen) ---------- */

const COMMON = [
  "passwort", "password", "kennwort", "geheim", "hallo", "hello", "schatz", "liebe", "iloveyou", "letmein", "admin", "welcome", "willkommen",
  "qwertz", "qwerty", "asdf", "yxcv", "zxcv", "abc", "123456", "654321", "111111", "000000", "1234", "test", "master", "dragon", "monkey",
  "sommer", "winter", "fruehling", "herbst", "fussball", "football", "baseball", "superman", "batman", "pokemon", "minecraft", "fortnite",
  "austria", "oesterreich", "wien", "vienna", "graz", "linz", "salzburg", "innsbruck", "berlin", "bayern", "rapid", "sturm",
  "michael", "thomas", "daniel", "lukas", "florian", "anna", "julia", "lisa", "sarah", "hund", "katze", "mausi", "hase", "baby", "sonne",
  "google", "facebook", "instagram", "samsung", "xiaomi", "apple", "iphone", "android", "handy", "computer", "internet", "lehrling", "elektriker",
];
const ROWS = ["qwertzuiopü", "asdfghjklöä", "yxcvbnm", "qwertyuiop", "zxcvbnm", "1234567890", "abcdefghijklmnopqrstuvwxyz"];
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "€": "e" };

export const STRENGTH_LABELS = ["Sehr schwach", "Schwach", "Mittel", "Stark", "Sehr stark"];

function poolSize(pw) {
  let p = 0;
  if (/[a-z]/.test(pw)) p += 26;
  if (/[A-Z]/.test(pw)) p += 26;
  if (/[0-9]/.test(pw)) p += 10;
  if (/[^A-Za-z0-9]/.test(pw)) p += /[^\x20-\x7e]/.test(pw) ? 60 : 33;
  return Math.max(p, 10);
}

function isSeq(a, b) {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (Math.abs(x.charCodeAt(0) - y.charCodeAt(0)) === 1) return true;
  return ROWS.some((r) => { const i = r.indexOf(x); return i >= 0 && (r[i + 1] === y || r[i - 1] === y); });
}

/** → { bits, score 0–4, label } */
export function strength(pw) {
  pw = s(pw);
  if (!pw) return { bits: 0, score: 0, label: STRENGTH_LABELS[0] };
  const chars = [...pw];
  const per = Math.log2(poolSize(pw));
  // Gewicht pro Zeichen: Wiederholungen/Folgen zählen kaum
  const w = chars.map((c, i) => {
    if (i === 0) return 1;
    if (c === chars[i - 1]) return 0.15;
    if (isSeq(chars[i - 1], c)) return 0.35;
    return 1;
  });
  // Häufige Wörter (auch mit 1337-Ersetzungen): ganze Stelle ≈ 1 Wort aus kleiner Liste
  const norm = chars.map((c) => LEET[c] || c.toLowerCase()).join("");
  const lower = chars.map((c) => c.toLowerCase()).join("");
  const words = [];
  for (const hay of norm === lower ? [lower] : [lower, norm]) {
    for (const word of COMMON) {
      let from = 0, at;
      while ((at = hay.indexOf(word, from)) >= 0) { words.push([at, at + word.length]); from = at + 1; }
    }
  }
  for (const m of lower.matchAll(/(19|20)\d\d/g)) words.push([m.index, m.index + 4]);
  const covered = new Array(chars.length).fill(false);
  let wordBits = 0;
  for (const [a, b] of words.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))) {
    if (covered.slice(a, b).some(Boolean)) continue;
    for (let i = a; i < b; i++) covered[i] = true;
    wordBits += 9;
  }
  let bits = wordBits;
  chars.forEach((_, i) => { if (!covered[i]) bits += w[i] * per; });
  // nur Ziffern / nur ein Zeichentyp: weniger Vielfalt als gedacht
  if (/^\d+$/.test(pw)) bits = Math.min(bits, chars.length * 3.32);
  const distinct = new Set(chars).size;
  if (distinct <= 3) bits = Math.min(bits, distinct * 4 + 4);
  bits = Math.max(0, Math.round(bits));
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits, score, label: STRENGTH_LABELS[score] };
}

export const MASTER_MIN = 10;
export const MASTER_MIN_BITS = 40;

/** Prüft ein neues Master-Passwort → Fehlermeldung oder "" */
export function masterProblem(pw, confirm) {
  if (s(pw).length < MASTER_MIN) return `Mindestens ${MASTER_MIN} Zeichen.`;
  if (strength(pw).bits < MASTER_MIN_BITS) return "Zu leicht zu erraten – nimm mehrere Wörter, Zahlen oder Zeichen dazu.";
  if (confirm !== undefined && pw !== confirm) return "Die beiden Passwörter stimmen nicht überein.";
  return "";
}

export const isWeak = (pw) => !!pw && strength(pw).bits < 40;

/** Sicherheits-Check → { weak:[ids], reused:[ids], checked } (nur Login + WLAN) */
export function securityCheck(entries) {
  const weak = [];
  const byPw = new Map();
  let checked = 0;
  for (const { id, data } of entries) {
    const pw = secretOf(data);
    if (!pw) continue;
    checked++;
    if (isWeak(pw)) weak.push(id);
    if (!byPw.has(pw)) byPw.set(pw, []);
    byPw.get(pw).push(id);
  }
  const reused = [...byPw.values()].filter((a) => a.length > 1).flat();
  return { weak, reused, checked };
}

/* ---------- Generator ---------- */

const SETS = {
  lower: "abcdefghijkmnopqrstuvwxyz",
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "23456789",
  symbols: "!#$%&*+-=?@_.:;",
};
const AMBIG = { lower: "l", upper: "IO", digits: "01" };
const CONS = "bdfghklmnprstvwz";
const VOW = "aeiou";

export function randInt(n, rnd) {
  if (rnd) return Math.floor(rnd() * n);
  const lim = Math.floor(0x100000000 / n) * n;
  const a = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(a); } while (a[0] >= lim);
  return a[0] % n;
}

/**
 * opts: { length 8–40, lower, upper, digits, symbols (bool), ambiguous (bool, auch 0/O/l/I), pronounceable (bool) }
 * rnd optional (für Tests) – Standard: crypto.getRandomValues
 */
export function generate(opts = {}, rnd) {
  const len = Math.max(8, Math.min(40, Math.round(Number(opts.length) || 16)));
  const use = ["lower", "upper", "digits", "symbols"].filter((k) => opts[k] !== false && (opts[k] || k === "lower"));
  if (!use.length) use.push("lower");
  const set = (k) => SETS[k] + (opts.ambiguous ? AMBIG[k] || "" : "");
  const pick = (str) => str[randInt(str.length, rnd)];
  let out;
  if (opts.pronounceable) {
    // Silben aus Konsonant+Vokal, Groß/Ziffern/Zeichen werden eingestreut
    out = [];
    while (out.length < len) {
      out.push(pick(CONS), pick(VOW));
      if (randInt(3, rnd) === 0) out.push(pick(CONS));
    }
    out = out.slice(0, len);
    const extras = [];
    if (use.includes("upper")) extras.push(() => { const i = randInt(out.length, rnd); out[i] = out[i].toUpperCase(); });
    if (use.includes("digits")) extras.push(() => { out[out.length - 1] = pick(SETS.digits); out[out.length - 2] = pick(SETS.digits); });
    if (use.includes("symbols")) extras.push(() => { out[randInt(out.length - 3, rnd) + 1] = pick(SETS.symbols); });
    // Reihenfolge: zuerst Ziffern/Zeichen setzen, dann Großbuchstaben auf einen Buchstaben
    for (const f of extras.reverse()) f();
    if (use.includes("upper") && !out.some((c) => /[A-Z]/.test(c))) {
      const i = out.findIndex((c) => /[a-z]/.test(c));
      if (i >= 0) out[i] = out[i].toUpperCase();
    }
    if (!use.includes("lower")) out = out.map((c) => c.toUpperCase());
    return out.join("");
  }
  const all = use.map(set).join("");
  for (let tries = 0; tries < 50; tries++) {
    out = Array.from({ length: len }, () => pick(all));
    if (use.every((k) => out.some((c) => set(k).includes(c)))) break;
  }
  return out.join("");
}

/* ---------- Suche & Sortierung ---------- */

const coll = typeof Intl !== "undefined" ? new Intl.Collator("de-AT", { sensitivity: "base", numeric: true }) : null;

export function sortEntries(list) {
  return list.slice().sort((a, b) =>
    (!!b.data.fav - !!a.data.fav) ||
    (coll ? coll.compare(a.data.title || "", b.data.title || "") : String(a.data.title).localeCompare(String(b.data.title))));
}

/** Suche über Titel, Benutzer, Website, SSID, Kategorie, Notiz, Inhaber – nicht über Passwörter/PINs. */
export function matches(e, q) {
  q = s(q).trim().toLowerCase();
  if (!q) return true;
  const hay = [e.title, e.user, e.url, e.ssid, e.category, e.note, e.holder, TYPES[e.type] && TYPES[e.type].label,
    e.type === "doc" && DOC_KINDS[e.kind] ? DOC_KINDS[e.kind].label : "", e.authority].map(s).join("\n").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/* ---------- WLAN-QR (Format „WIFI:T:WPA;S:…;P:…;;“) ---------- */

const wEsc = (v) => s(v).replace(/([\\;,:"])/g, "\\$1");

export function wifiQrText(e) {
  const t = e.enc === "nopass" ? "nopass" : e.enc === "WEP" ? "WEP" : "WPA";
  return `WIFI:T:${t};S:${wEsc(e.ssid)};` + (t === "nopass" ? "" : `P:${wEsc(e.password)};`) + (e.hidden ? "H:true;" : "") + ";";
}

/* ---------- CSV für Bitwarden (Klartext!) ---------- */

const BW_HEAD = ["folder", "favorite", "type", "name", "notes", "fields", "reprompt", "login_uri", "login_username", "login_password", "login_totp"];

function csvCell(v) {
  const t = s(v);
  return /[",\r\n]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function toBitwardenCsv(entries) {
  const rows = [BW_HEAD];
  for (const { data: e } of entries) {
    const fields = [];
    const notes = [];
    if (e.type === "pin") { if (e.pin) fields.push("PIN: " + e.pin); if (e.puk) fields.push("PUK: " + e.puk); }
    if (e.type === "wifi") { fields.push("SSID: " + e.ssid, "Passwort: " + (e.password || ""), "Verschlüsselung: " + (WIFI_ENC[e.enc] || e.enc)); }
    if (e.type === "card") { if (e.holder) fields.push("Name: " + e.holder); if (e.number) fields.push("Nummer: " + e.number); }
    if (e.type === "doc") {
      fields.push("Art: " + (DOC_KINDS[e.kind] || DOC_KINDS.sonstiges).label);
      if (e.number) fields.push("Nummer: " + e.number);
      if (e.issued) fields.push("Ausgestellt: " + fmtKey(e.issued));
      if (e.expires) fields.push("Gültig bis: " + fmtKey(e.expires));
      if (e.authority) fields.push("Behörde: " + e.authority);
      if (e.files && e.files.length) fields.push(`Dateien: ${e.files.length} (nicht im CSV enthalten)`);
    }
    if (e.type !== "login" && e.type !== "note") notes.push(TYPES[e.type].label);
    if (e.note) notes.push(e.note);
    const isLogin = e.type === "login";
    rows.push([
      e.category || "", e.fav ? "1" : "", isLogin ? "login" : "note", e.title || "", notes.join("\n"), fields.join("\n"), "",
      isLogin ? e.url || "" : "", isLogin ? e.user || "" : "", isLogin ? e.password || "" : "", "",
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/* ---------- Fehlversuche (Bremse) ---------- */

/** Wartezeit in Sekunden nach n Fehlversuchen: 0 bis 4, dann 5, 10, 20, 40 … max. 300 */
export function failDelay(n) {
  if (n < 5) return 0;
  return Math.min(300, 5 * 2 ** (n - 5));
}
