// Kleine gemeinsame Hilfen der Werkzeuge (Eingaben prüfen, Orte abgleichen, Texte) – ohne Datenzugriff.
import { fmtKey, parseDate, parseTime, diffDays } from "./time.js";
import { UserError } from "./logic.js";
import { best, norm } from "./match.js";

export const SRC = "claude";
export const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const WR = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export const s = (v) => (v == null ? "" : String(v).trim());
export const pad2 = (n) => String(n).padStart(2, "0");
export function need(v, msg) { if (!s(v)) throw new UserError(msg); return s(v); }

/** Erlaubte Dokument-IDs aus Modell-Eingaben (App: newId → base36, Firestore-Auto-IDs, bk_…, YYYY-MM-DD). */
export const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** Von Claude gelieferte ID prüfen, bevor sie in einem Firestore-Pfad landet (L13). Leer → "". */
export function idArg(v, what = "ID") {
  const t = s(v);
  if (!t) return "";
  if (!ID_RE.test(t)) throw new UserError(`Ungültige ${what} „${short(t, 40)}“ – bitte die ID genau so angeben, wie sie ein Lese-Werkzeug geliefert hat.`);
  return t;
}

/* ---------- Inhalte von Dritten (H1) ---------- */

export const UNTRUSTED_TAG = "untrusted_content";
/** Text von Dritten (E-Mail, Bank-Verwendungszweck/Gegenkonto) klar abgrenzen. Ein eingeschmuggeltes
 *  Schluss-Tag wird entschärft, damit der Text nicht aus dem Block „ausbrechen“ kann. */
export function untrusted(source, text) {
  const t = String(text ?? "").replace(/<\s*\/?\s*untrusted_content[^>]*>?/gi, "[…]");
  return `<${UNTRUSTED_TAG} source="${source}">${t}</${UNTRUSTED_TAG}>`;
}
/** Enthält eine Werkzeug-Ausgabe Inhalte von Dritten? */
export const hasUntrusted = (out) => typeof out === "string" && out.includes(`<${UNTRUSTED_TAG} source=`);
/** Buchungs-Notiz: bei Bank-Buchungen (Text kommt vom Gegenkonto/Verwendungszweck) abgegrenzt. */
export function txNote(x, n = 60) {
  if (!s(x && x.note)) return "";
  const t = s(x.note).slice(0, n);
  return x.src === "bank" || x.bankRef || x.bankId ? untrusted("bank", t) : `„${t}“`;
}

export function dateArg(v, today, label = "Datum") {
  if (v == null || s(v) === "") return null;
  const k = parseDate(v, today);
  if (!k) throw new UserError(`${label} „${s(v)}“ verstehe ich nicht. Bitte als TT.MM.JJJJ (z. B. ${fmtKey(today)}) oder „heute“/„gestern“ angeben.`);
  return k;
}
export function timeArg(v, label) {
  const t = parseTime(v);
  if (!t) throw new UserError(`${label} „${s(v)}“ verstehe ich nicht. Bitte als HH:MM (24 h, z. B. 07:30) angeben.`);
  return t;
}
export function boolArg(v, label) {
  if (typeof v === "boolean") return v;
  const t = s(v).toLowerCase();
  if (["ja", "true", "an", "1", "yes", "ein"].includes(t)) return true;
  if (["nein", "false", "aus", "0", "no"].includes(t)) return false;
  throw new UserError(`${label}: bitte ja oder nein angeben.`);
}
/** Deutsche Zahl ("12,5", "1.234,50", 7) → Zahl oder NaN; leer → null. */
export function numArg(v) {
  if (v == null || s(v) === "") return null;
  if (typeof v === "number") return v;
  const t = s(v).replace(/\s|€|km|l\b/gi, "");
  const n = Number(t.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export function placeName(x) { return s(x && (x.place || (x.inLoc && x.inLoc.addr) || (x.loc && x.loc.addr))); }

export function matchPlace(q, places) {
  return best(q, places.filter((p) => p && p.name), (p) => p.name);
}

/** Ort-Eingabe → {placeId, place, info}. Kein Treffer → freier Text (wie App: placeId null). */
export function resolvePlace(q, places) {
  const txt = s(q);
  if (!txt) return { placeId: null, place: "", info: "" };
  const m = matchPlace(txt, places);
  if (m) {
    let info = norm(m.item.name) === norm(txt) ? "" : ` (gespeicherter Ort „${m.item.name}“ zu „${txt}“ gefunden)`;
    if (m.ambiguous && m.second) info += ` – Achtung, „${m.second.name}“ passt ähnlich gut`;
    return { placeId: m.item.id, place: String(m.item.name), info };
  }
  return { placeId: null, place: txt, info: ` (kein gespeicherter Ort passt zu „${txt}“ – als freier Text übernommen)` };
}

/** Eindeutiges Element per ID oder unscharfem Namen finden (sonst verständlicher Fehler). */
export function pick(list, { id, name }, nameOf, what, min = 55) {
  if (s(id)) {
    idArg(id, `${what}-ID`);
    const x = list.find((e) => e && e.id === s(id));
    if (!x) throw new UserError(`${what} mit der ID ${s(id)} gibt es nicht.`);
    return x;
  }
  if (!s(name)) throw new UserError(`Welche(s) ${what}? Bitte Name oder id angeben.`);
  const m = best(name, list, nameOf, min);
  if (!m) {
    const have = list.map(nameOf).filter(Boolean).slice(0, 8);
    throw new UserError(`Kein(e) ${what} passt zu „${s(name)}“.${have.length ? ` Vorhanden: ${have.join(", ")}.` : ""}`);
  }
  if (m.ambiguous && m.score < 98) throw new UserError(`„${s(name)}“ ist nicht eindeutig: „${nameOf(m.item)}“ oder „${nameOf(m.second)}“? Bitte genauer angeben oder die ID nehmen.`);
  return m.item;
}

export function countdown(today, k) {
  const n = diffDays(today, k);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === 2) return "übermorgen";
  if (n > 0) return `noch ${n} Tage`;
  return n === -1 ? "seit gestern" : `seit ${-n} Tagen`;
}

/** Text kürzen (eine Zeile). */
export const short = (v, n = 80) => { const t = s(v).replace(/\s+/g, " "); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/** Liste begrenzen + Hinweis auf weitere. */
export function capped(lines, max, what = "Einträge") {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `… und ${lines.length - max} weitere ${what} (mit limit/seite mehr anzeigen)`];
}

/** Seitenweise: {items, more, page} – limit Standard 20, höchstens 100. */
export function paged(list, args, def = 20) {
  const limit = Math.max(1, Math.min(100, Math.round(Number(args.limit) || def)));
  const page = Math.max(1, Math.round(Number(args.seite) || 1));
  const items = list.slice((page - 1) * limit, page * limit);
  return { items, page, limit, more: list.length > page * limit, total: list.length };
}
