// Update 9 – Einstellungen über Claude ändern: NUR Freigabeliste und IMMER zweistufig wie das Löschen
// (Vorschlag mit vorher → nachher + kurzlebigem Code in meta/ai_pending_settings → Bestätigung in einer späteren
// Nutzer-Nachricht). Nie: Tresor, App-Sperre/PIN, API-Schlüssel, Kalender-Abo-Adressen, Bank, Google-Konto.
import { dayKey, fmtKey, isKey, WD, hm } from "./time.js";
import { UserError, readApprentice, readSchool, alltagId } from "./logic.js";
import { RO, s, dateArg, timeArg, boolArg, numArg, pick } from "./util.js";
import { norm, best } from "./match.js";
import { fmtTime } from "./time.js";
import { makeCode, CODE_TTL_MS } from "./delete.js";
import { readLeave, readReminders, fmtDays } from "./read.js";
import * as TR from "./trip.js";
import * as PM from "./privat.js";
import * as G from "./gallery.js";

export const PENDING_SETTINGS = "meta/ai_pending_settings";

/** Bereiche, die nie über Claude geändert werden – mit freundlicher Begründung. */
const FORBIDDEN = [
  [/tresor|vault|passw|kennw/, "Den Passwort-Tresor kann ich weder lesen noch ändern – er ist mit deinem Master-Passwort verschlüsselt und bleibt nur in deiner Hand."],
  [/sperr|lockscreen|app_?lock|(^|_)pin($|_|code)|biometr|fingerab/, "Die App-Sperre (PIN/Fingerabdruck) stelle ich aus Sicherheitsgründen nicht um – das geht nur direkt in der App."],
  [/(^|_)api|schluessel|(^|_)key|token|secret|(^|_)ki($|_)|(^|_)ai($|_)|claude|modell/, "API-Schlüssel und KI-Einstellungen fasse ich nicht an – sie sind geheim bzw. kosten Geld; bitte direkt in der App ändern."],
  [/bank|konto_verbind|iban|enable/, "Die Bankverbindung kann ich nicht einrichten oder trennen – das geht aus Sicherheitsgründen nur in der App (Geld → Bank)."],
  [/ical|feed|abo_adr|kalender_abo|google_kal/, "Kalender-Abos (iCal-Adressen) sind geheim – die zeige und ändere ich nicht. Bitte in der App unter Kalender → Abos."],
  [/google|gmail|mail|anmeld|login|account/, "Das Google-Konto bzw. die Anmeldung und Gmail kann ich nicht ändern – das geht nur in der App."],
];
export function forbiddenArea(v) {
  const k = norm(v).replace(/ /g, "_");
  for (const [re, msg] of FORBIDDEN) if (re.test(k)) return msg;
  return null;
}

const WD_IN = { mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, do: 4, donnerstag: 4, fr: 5, freitag: 5, sa: 6, samstag: 6, so: 0, sonntag: 0 };
function daysArg(v, label) {
  let list = v;
  if (typeof v === "string") {
    const t = norm(v);
    if (/^mo (bis )?fr$|^montag (bis )?freitag$|^werktags?$/.test(t)) return [1, 2, 3, 4, 5];
    if (/^keine?$/.test(t)) return [];
    list = t.split(/[ ,;]+/).filter(Boolean);
  }
  if (!Array.isArray(list)) throw new UserError(`${label}: bitte Wochentage wie ["Mo","Di"] angeben.`);
  const out = list.map((x) => (typeof x === "number" ? x : WD_IN[norm(x)] ?? Number(x)));
  if (out.some((x) => !(Number.isInteger(x) && x >= 0 && x <= 6))) throw new UserError(`${label}: unbekannter Wochentag.`);
  return [...new Set(out)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}
const daysTxt = (l) => (l && l.length ? l.map((x) => WD[x]).join(", ") : "keine");
const yn = (v) => (v ? "an" : "aus");
function num(v, label, min, max) {
  const n = numArg(v);
  if (n == null || !Number.isFinite(n) || n < min || n > max) throw new UserError(`${label}: bitte eine Zahl zwischen ${min} und ${max}.`);
  return n;
}
const eurTxt = (v) => (v == null ? "kein Betrag" : `${String(Math.round(v * 100) / 100).replace(".", ",")} €`);

/**
 * Bereiche: je Feld (deutsche Namen, Aliase) → {top, read(raw settings) → Teilobjekt, set(next, v, ctx), show}.
 * Jede Änderung ersetzt nur das betroffene Feld der obersten Ebene (z. B. "leave"), Rest bleibt.
 */
const AREAS = {
  arbeitszeit: {
    label: "Arbeitszeit",
    fields: {
      arbeitstage: { alias: ["workdays", "tage"], top: "workDays", get: (st) => (Array.isArray(st.workDays) ? st.workDays : [1, 2, 3, 4, 5]), set: (v) => daysArg(v, "arbeitstage"), show: daysTxt, label: "Arbeitstage" },
      wochenstunden: { alias: ["weeklytarget", "stunden", "wochenstunden_h"], top: "weeklyTarget", get: (st) => Number(st.weeklyTarget ?? 38.5), set: (v) => Math.round(num(v, "wochenstunden", 0, 60) * 100) / 100, show: (v) => `${String(v).replace(".", ",")} h`, label: "Wochenstunden" },
    },
  },
  schule: {
    label: "Berufsschule",
    fields: {
      schultage: { alias: ["days", "tage"], top: "school", sub: "days", set: (v) => daysArg(v, "schultage"), show: daysTxt, label: "Schultage" },
      block_hinzufuegen: { alias: ["block", "schulblock", "neuer_block"], top: "school", sub: "blocks", label: "Schulblöcke", op: "add" },
      block_entfernen: { alias: ["block_loeschen", "schulblock_entfernen"], top: "school", sub: "blocks", label: "Schulblöcke", op: "remove" },
    },
  },
  lehre: {
    label: "Lehre",
    fields: {
      lehrbeginn: { alias: ["start", "beginn"], top: "apprentice", sub: "start", set: (v, c) => dateArg(v, c.today, "lehrbeginn"), show: (v) => (isKey(v) ? fmtKey(v) : "–"), label: "Lehrbeginn" },
      lehrdauer: { alias: ["years", "dauer", "jahre"], top: "apprentice", sub: "years", set: (v) => { const n = numArg(String(v).replace("½", ".5")); if (![2, 3, 3.5, 4].includes(n)) throw new UserError("lehrdauer: 2, 3, 3,5 oder 4 Jahre."); return n; }, show: (v) => `${String(v).replace(".5", "½")} Jahre`, label: "Lehrdauer" },
      lehrberuf: { alias: ["trade", "beruf"], top: "apprentice", sub: "trade", set: (v) => s(v).slice(0, 80), show: (v) => v || "–", label: "Lehrberuf" },
      lehrbetrieb: { alias: ["company", "betrieb", "firma"], top: "apprentice", sub: "company", set: (v) => s(v).slice(0, 80), show: (v) => v || "–", label: "Lehrbetrieb" },
      name: { alias: ["dein_name"], top: "apprentice", sub: "name", set: (v) => s(v).slice(0, 80), show: (v) => v || "–", label: "Name" },
    },
  },
  urlaub: {
    label: "Urlaub",
    fields: {
      anspruch: { alias: ["daysperyear", "urlaubstage", "tage"], top: "leave", sub: "daysPerYear", set: (v) => Math.round(num(v, "anspruch", 0, 60) * 2) / 2, show: (v) => `${fmtDays(v)} Tage`, label: "Urlaubsanspruch" },
      urlaubsjahr_ab_monat: { alias: ["yearstartmonth", "monat", "urlaubsjahr"], top: "leave", sub: "yearStartMonth", set: (v) => { const n = Math.round(num(v, "urlaubsjahr_ab_monat", 1, 12)); return n; }, show: (v) => `Monat ${v}`, label: "Urlaubsjahr beginnt" },
      rest_vorjahr: { alias: ["carryover", "resturlaub", "uebertrag"], top: "leave", sub: "carryOver", set: (v) => Math.round(num(v, "rest_vorjahr", -60, 120) * 2) / 2, show: (v) => `${fmtDays(v)} Tage`, label: "Rest Vorjahr" },
    },
  },
  erinnerungen: {
    label: "Erinnerungen",
    fields: {
      an: { alias: ["enabled", "alle", "erinnerungen"], top: "reminders", sub: "enabled", set: (v) => boolArg(v, "an"), show: yn, label: "Erinnerungen gesamt" },
      einstempeln_an: { alias: ["start", "start_an"], top: "reminders", sub: "start.enabled", set: (v) => boolArg(v, "einstempeln_an"), show: yn, label: "Einstempel-Erinnerung" },
      einstempeln_um: { alias: ["start_zeit", "einstempeln_zeit", "start_um"], top: "reminders", sub: "start.time", set: (v) => fmtTime(timeArg(v, "einstempeln_um")), show: (v) => v, label: "Einstempel-Erinnerung um" },
      ausstempeln_an: { alias: ["ende", "ende_an", "end"], top: "reminders", sub: "end.enabled", set: (v) => boolArg(v, "ausstempeln_an"), show: yn, label: "Ausstempel-Erinnerung" },
      ausstempeln_nach_h: { alias: ["ende_nach_h", "nach_stunden", "afterhours"], top: "reminders", sub: "end.afterHours", set: (v) => num(v, "ausstempeln_nach_h", 1, 16), show: (v) => `${String(v).replace(".", ",")} h`, label: "Ausstempel-Erinnerung nach" },
      pause_an: { alias: ["pause"], top: "reminders", sub: "pause.enabled", set: (v) => boolArg(v, "pause_an"), show: yn, label: "Pausen-Erinnerung" },
    },
  },
  privat: {
    label: "Privat / Arbeit",
    fields: {
      zeitplan_an: { alias: ["zeitplan", "enabled", "automatisch"], top: "modeSchedule", sub: "enabled", set: (v) => boolArg(v, "zeitplan_an"), show: yn, label: "Privat-Zeitplan" },
      arbeit_von: { alias: ["von", "from"], top: "modeSchedule", sub: "from", set: (v) => fmtTime(timeArg(v, "arbeit_von")), show: (v) => v, label: "Arbeit von" },
      arbeit_bis: { alias: ["bis", "to"], top: "modeSchedule", sub: "to", set: (v) => fmtTime(timeArg(v, "arbeit_bis")), show: (v) => v, label: "Arbeit bis" },
      privatfahrten_aufzeichnen: { alias: ["privatfahrten", "record"], top: "privatTrips", sub: "record", set: (v) => boolArg(v, "privatfahrten_aufzeichnen"), show: yn, label: "Privatfahrten aufzeichnen" },
    },
  },
  galerie: {
    label: "Galerie",
    fields: {
      aktive_kategorie: { alias: ["kategorie", "neue_fotos", "activefolderid"], top: "gallery", sub: "activeFolderId", label: "Neue Fotos gehen nach", op: "folder" },
      automatisch: { alias: ["auto", "einsortieren"], top: "gallery", sub: "auto", set: (v) => boolArg(v, "automatisch"), show: yn, label: "Automatisch einsortieren" },
    },
  },
  taggeld: {
    label: "Taggeld & Kilometer",
    fields: {
      an: { alias: ["enabled", "taggeld"], top: "allowance", sub: "enabled", set: (v) => boolArg(v, "an"), show: yn, label: "Taggeld" },
      ab_stunden_teilweise: { alias: ["minhours", "teilweise_ab"], top: "allowance", sub: "minHours", set: (v) => num(v, "ab_stunden_teilweise", 0, 24), show: (v) => `${String(v).replace(".", ",")} h`, label: "Teilweise ab" },
      ab_stunden_voll: { alias: ["fullhours", "voll_ab"], top: "allowance", sub: "fullHours", set: (v) => num(v, "ab_stunden_voll", 0, 24), show: (v) => `${String(v).replace(".", ",")} h`, label: "Voll ab" },
      betrag_teilweise: { alias: ["ratepart", "satz_teilweise"], top: "allowance", sub: "ratePart", set: (v) => (s(v) === "" ? null : num(v, "betrag_teilweise", 0, 10000)), show: eurTxt, label: "Betrag teilweise" },
      betrag_voll: { alias: ["ratefull", "satz_voll"], top: "allowance", sub: "rateFull", set: (v) => (s(v) === "" ? null : num(v, "betrag_voll", 0, 10000)), show: eurTxt, label: "Betrag voll" },
      kilometergeld: { alias: ["kmrate", "km_satz", "kilometergeld_satz"], top: "allowance", sub: "kmRate", set: (v) => num(v, "kilometergeld", 0, 100), show: (v) => `${eurTxt(v)}/km`, label: "Kilometergeld" },
      eigenes_auto: { alias: ["owncar", "privatauto"], top: "allowance", sub: "ownCar", set: (v) => boolArg(v, "eigenes_auto"), show: (v) => (v ? "ja" : "nein"), label: "Eigenes Auto" },
      umwegfaktor: { alias: ["kmfactor", "faktor"], top: "allowance", sub: "kmFactor", set: (v) => num(v, "umwegfaktor", 1, 3), show: (v) => String(v).replace(".", ","), label: "Umwegfaktor" },
    },
  },
};
const AREA_ALIAS = { arbeit: "arbeitszeit", arbeitstage: "arbeitszeit", wochenstunden: "arbeitszeit", berufsschule: "schule", schulbloecke: "schule", lehrling: "lehre", ausbildung: "lehre", lehrberuf: "lehre",
  erinnerung: "erinnerungen", reminders: "erinnerungen", privatmodus: "privat", modus: "privat", foto: "galerie", fotos: "galerie", kilometer: "taggeld", kilometergeld: "taggeld", diaeten: "taggeld", allowance: "taggeld", leave: "urlaub" };
export const AREA_KEYS = Object.keys(AREAS);
/** Felder der obersten Ebene in meta/settings, die überhaupt geschrieben werden dürfen (Freigabeliste). */
export const ALLOWED_TOP = new Set(Object.values(AREAS).flatMap((a) => Object.values(a.fields).map((f) => f.top)));

/** Aktueller Wert der obersten Ebene, mit Standardwerten wie die App (damit vorher/nachher stimmt). */
function topValue(st, top) {
  const raw = st[top];
  if (top === "workDays") return Array.isArray(raw) ? raw : [1, 2, 3, 4, 5];
  if (top === "weeklyTarget") return Number(raw ?? 38.5);
  const obj = raw && typeof raw === "object" ? JSON.parse(JSON.stringify(raw)) : {};
  if (top === "school") { const sc = readSchool(st) || { days: [], blocks: [] }; return { ...obj, days: sc.days, blocks: (Array.isArray(obj.blocks) ? obj.blocks : []).filter(Boolean) }; }
  if (top === "apprentice") { const ap = readApprentice(st); return { ...obj, start: ap.start, years: ap.years, trade: ap.trade, company: ap.company, name: ap.name }; }
  if (top === "leave") { const lv = readLeave(st); return { ...obj, daysPerYear: lv.daysPerYear, yearStartMonth: lv.yearStartMonth, carryOver: lv.carryOver }; }
  if (top === "reminders") return { ...obj, ...readReminders(st) };
  if (top === "modeSchedule") { const m = PM.readModeSchedule(st); return { ...obj, enabled: m.enabled, from: m.from, to: m.to }; }
  if (top === "privatTrips") return { ...obj, record: PM.recordPrivateTrips(st) };
  if (top === "allowance") { const a = TR.readAllowance(st); return { ...obj, ...a }; }
  if (top === "gallery") return obj;
  return obj;
}
const getPath = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
function setPath(o, p, v) { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) { if (!x[k] || typeof x[k] !== "object") x[k] = {}; x = x[k]; } x[ks[ks.length - 1]] = v; }

function blockText(b) { return `${fmtKey(b.from)} – ${fmtKey(b.to)}${s(b.label) ? ` „${s(b.label)}“` : ""}`; }

/** Vorschlag berechnen → {patch, lines, areaLabel} (ohne zu speichern). */
export async function planSettings(d, bereich, werte) {
  const today = dayKey(d.now);
  const bk = norm(bereich).replace(/ /g, "_");
  const forb = forbiddenArea(bk);
  if (forb) throw new UserError(forb);
  const areaKey = AREAS[bk] ? bk : AREA_ALIAS[bk];
  if (!areaKey) throw new UserError(`Den Bereich „${s(bereich)}“ kann ich nicht ändern. Möglich: ${AREA_KEYS.join(", ")}.`);
  const area = AREAS[areaKey];
  if (!werte || typeof werte !== "object" || Array.isArray(werte) || !Object.keys(werte).length) throw new UserError(`Bitte in werte angeben, was geändert werden soll, z. B. {"${Object.keys(area.fields)[0]}": …}. Möglich: ${Object.keys(area.fields).join(", ")}.`);
  const st = await d.settings();
  const next = {}, lines = [];
  const ctx = { today };
  for (const [k0, v] of Object.entries(werte)) {
    const k = norm(k0).replace(/ /g, "_");
    const forbK = forbiddenArea(k);
    if (forbK) throw new UserError(forbK);
    const fk = area.fields[k] ? k : Object.keys(area.fields).find((f) => area.fields[f].alias.includes(k) || area.fields[f].alias.includes(k.replace(/_/g, "")));
    if (!fk) throw new UserError(`Feld „${k0}“ gibt es im Bereich ${area.label} nicht. Möglich: ${Object.keys(area.fields).join(", ")}.`);
    const f = area.fields[fk];
    if (!(f.top in next)) next[f.top] = topValue(st, f.top);
    const cur = next[f.top];
    if (f.op === "add") {
      const list = Array.isArray(v) ? v : [v];
      for (const b of list) {
        if (!b || typeof b !== "object") throw new UserError("block_hinzufuegen: {\"von\": \"TT.MM.JJJJ\", \"bis\": \"TT.MM.JJJJ\", \"name\": \"…\"}");
        const from = dateArg(b.von ?? b.from, today, "von"), to = dateArg(b.bis ?? b.to, today, "bis");
        if (!from || !to) throw new UserError("Ein Schulblock braucht von und bis.");
        if (to < from) throw new UserError("Beim Schulblock liegt „bis“ vor „von“.");
        const nb = { id: "b" + alltagId(d.now + cur.blocks.length), from, to, label: s(b.name ?? b.label).slice(0, 40) };
        cur.blocks = [...cur.blocks, nb].sort((x, y) => (x.from < y.from ? -1 : 1));
        lines.push(`Schulblock neu: ${blockText(nb)}`);
      }
      continue;
    }
    if (f.op === "remove") {
      const list = Array.isArray(v) ? v : [v];
      for (const q of list) {
        const qs = s(typeof q === "object" && q ? q.id || q.von || q.name : q);
        const asDate = /\d/.test(qs) ? (() => { try { return dateArg(qs, today, "Block"); } catch { return null; } })() : null;
        const b = cur.blocks.find((x) => x.id === qs) || (asDate && cur.blocks.find((x) => x.from <= asDate && asDate <= x.to)) || (cur.blocks.length ? pick(cur.blocks, { name: qs }, (x) => x.label || "", "Schulblock", 60) : null);
        if (!b) throw new UserError(`Keinen Schulblock zu „${qs}“ gefunden.`);
        cur.blocks = cur.blocks.filter((x) => x !== b);
        lines.push(`Schulblock entfernen: ${blockText(b)}`);
      }
      continue;
    }
    if (f.op === "folder") {
      const folders = G.sortFolders((await d.alltag("photo_folders").catch(() => [])).map(G.normFolder).filter(Boolean));
      const q = s(v);
      const fo = /^(keine|ohne|-)$/i.test(q) ? null : folders.find((x) => x.id === q) || pick(folders, { name: q }, (x) => x.name, "Kategorie", 55);
      const before = G.resolveActiveFolder({ folders, gallery: st.gallery || {}, ignorePlace: true });
      const bf = folders.find((x) => x.id === before.id);
      cur.activeFolderId = fo ? fo.id : ""; cur.autoFolder = fo ? fo.id : ""; // wie gallery-albums.js: beide gleich schreiben
      lines.push(`${f.label}: ${bf ? bf.name : "keine Kategorie"} → ${fo ? fo.name : "keine Kategorie"}`);
      continue;
    }
    const val = f.set(v, ctx);
    if (f.sub) {
      const before = getPath(cur, f.sub);
      setPath(cur, f.sub, val);
      lines.push(`${f.label}: ${f.show(before)} → ${f.show(val)}`);
    } else {
      lines.push(`${f.label}: ${f.show(cur)} → ${f.show(val)}`);
      next[f.top] = val;
    }
  }
  if (next.allowance && next.allowance.fullHours < next.allowance.minHours) throw new UserError("„Voll ab“ muss mindestens so groß sein wie „teilweise ab“.");
  if (next.modeSchedule && next.modeSchedule.from === next.modeSchedule.to) throw new UserError("Arbeit von und bis dürfen nicht gleich sein.");
  if (next.apprentice && next.apprentice.start == null) delete next.apprentice.start;
  return { patch: next, lines, areaLabel: area.label, before: Object.fromEntries(Object.keys(next).map((k) => [k, st[k] ?? null])) };
}

export const SETTINGS_TOOLS = [
  {
    name: "einstellung_aendern",
    title: "Einstellung ändern (Vorschlag)",
    description: "SCHRITT 1 von 2 beim Ändern von Einstellungen – speichert selbst NOCH NICHTS. bereich: arbeitszeit (arbeitstage, wochenstunden), schule (schultage, block_hinzufuegen {von,bis,name}, block_entfernen), lehre (lehrbeginn, lehrdauer, lehrberuf, lehrbetrieb, name), urlaub (anspruch, urlaubsjahr_ab_monat, rest_vorjahr), erinnerungen (an, einstempeln_an, einstempeln_um, ausstempeln_an, ausstempeln_nach_h, pause_an), privat (zeitplan_an, arbeit_von, arbeit_bis, privatfahrten_aufzeichnen), galerie (aktive_kategorie, automatisch), taggeld (an, ab_stunden_teilweise, ab_stunden_voll, betrag_teilweise, betrag_voll, kilometergeld, eigenes_auto, umwegfaktor). Gibt vorher → nachher und einen bestaetigungs_code (10 Minuten) zurück. Danach dem Nutzer die Änderung zeigen, fragen und erst nach seinem Ja in der NÄCHSTEN Nachricht einstellung_bestaetigen aufrufen. Tresor, App-Sperre, API-Schlüssel, Kalender-Abos, Bank und Google-Konto sind ausgeschlossen.",
    inputSchema: {
      type: "object",
      properties: {
        bereich: { type: "string", description: `Welcher Einstellungsbereich: ${AREA_KEYS.join(", ")}` },
        werte: { type: "object", description: "Neue Werte, z. B. {\"anspruch\": 26} oder {\"arbeitstage\": [\"Mo\",\"Di\",\"Mi\",\"Do\"]} oder {\"block_hinzufuegen\": {\"von\": \"11.01.2027\", \"bis\": \"05.02.2027\", \"name\": \"Block 3\"}}", additionalProperties: true },
      },
      required: ["bereich", "werte"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(args, d) {
      const plan = await planSettings(d, args.bereich, args.werte);
      if (!plan.lines.length) return "Da ändert sich nichts.";
      const code = makeCode();
      await d.commit([d.fs.setWrite(d.p(PENDING_SETTINGS), {
        code, created: d.now, expires: d.now + CODE_TTL_MS, area: plan.areaLabel, lines: plan.lines,
        patchJson: JSON.stringify(plan.patch), beforeJson: JSON.stringify(plan.before),
      })]);
      return [
        `Vorschlag – Einstellungen „${plan.areaLabel}“ (noch NICHT gespeichert):`,
        ...plan.lines.map((l) => `- ${l}`),
        "",
        `bestaetigungs_code: ${code} (10 Minuten gültig)`,
        "WICHTIG: Zeig dem Nutzer vorher → nachher und frag „Soll ich das so speichern?“. Erst nach einem klaren Ja in seiner nächsten Nachricht einstellung_bestaetigen mit diesem Code aufrufen.",
      ].join("\n");
    },
  },
  {
    name: "einstellung_bestaetigen",
    title: "Einstellung bestätigen",
    description: "SCHRITT 2 von 2: Speichert die zuletzt mit einstellung_aendern vorgeschlagene Einstellung – nur mit dessen bestaetigungs_code und NUR nachdem der Nutzer vorher → nachher gesehen und in einer eigenen Nachricht ausdrücklich Ja gesagt hat. Niemals im selben Zug wie einstellung_aendern aufrufen.",
    inputSchema: {
      type: "object",
      properties: { bestaetigungs_code: { type: "string", description: "Code aus einstellung_aendern" } },
      required: ["bestaetigungs_code"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    action: "einstellung",
    async run(args, d) {
      const code = s(args.bestaetigungs_code).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const doc = await d.fs.get(d.p(PENDING_SETTINGS));
      const p = doc && doc.data;
      if (!p || !p.code || !p.patchJson) throw new UserError("Es gibt keinen offenen Einstellungs-Vorschlag. Zuerst einstellung_aendern aufrufen, dem Nutzer vorher → nachher zeigen und ihn fragen.");
      if (!(Number(p.expires) > d.now)) {
        await d.commit([d.fs.deleteWrite(d.p(PENDING_SETTINGS))]);
        throw new UserError("Der Bestätigungscode ist abgelaufen (10 Minuten). Bitte einstellung_aendern nochmal aufrufen und den Nutzer erneut fragen.");
      }
      if (code !== p.code) throw new UserError("Der Bestätigungscode passt nicht zum letzten Vorschlag – nichts gespeichert.");
      const patch = JSON.parse(p.patchJson);
      const before = JSON.parse(p.beforeJson || "{}");
      const st = await d.settings();
      for (const k of Object.keys(patch)) {
        if (JSON.stringify(st[k] ?? null) !== JSON.stringify(before[k] ?? null)) {
          await d.commit([d.fs.deleteWrite(d.p(PENDING_SETTINGS))]);
          throw new UserError("Diese Einstellung wurde inzwischen in der App geändert – bitte einstellung_aendern neu aufrufen, damit vorher → nachher stimmt. Nichts gespeichert.");
        }
      }
      if (Object.keys(patch).some((x) => !ALLOWED_TOP.has(x))) throw new UserError("Dieser Bereich ist gesperrt – nichts gespeichert.");
      await d.commit([d.fs.patchWrite(d.p("meta/settings"), patch), d.fs.deleteWrite(d.p(PENDING_SETTINGS))]);
      d.invalidate("settings");
      return [`Gespeichert – Einstellungen „${p.area}“:`, ...(p.lines || []).map((l) => `- ${l}`)].join("\n");
    },
  },
];
export { hm, best };
