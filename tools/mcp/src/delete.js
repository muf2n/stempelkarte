// Sicheres Löschen über Claude: Vorschlag (Liste + kurzlebiger Code) → Bestätigung → Papierkorb + Rückgängig.
// Ablage wie die Web-App: users/{uid}/entries|todos|places|a_<name>/… ; Vorschlag in meta/ai_pending_delete,
// Papierkorb in a_trash (siehe js/alltag/trash-core.js). Tresor, Fotos und Einstellungen sind nie löschbar.
import {
  dayKey, keyToTs, addDays, mondayOf, wdOf, clock, fmtKey, fmtKeyWd, eur, parseDate, parseMonth, parseKey, isKey,
} from "./time.js";
import { UserError, kindLabel, readSchool, alltagId } from "./logic.js";
import { score } from "./match.js";
import { untrusted } from "./util.js"; // H1: Bank-Texte abgrenzen
import { expandTodo, parseRRule, applyDelete } from "./cal.js";
import { DELETABLE, splitPath, isExpired, restoreDoc, groupBatches, typeLabel } from "./trash.js";

export const MAX_ITEMS = 200;
export const CODE_TTL_MS = 10 * 60000;
export const PENDING = "meta/ai_pending_delete";
const MATCH_MIN = 60;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const s = (v) => (v == null ? "" : String(v).trim());
const pad2 = (n) => String(n).padStart(2, "0");
const keyOfTs = (ts) => (Number.isFinite(Number(ts)) && Number(ts) > 0 ? dayKey(Number(ts)) : null);

/* ---------- Was darf gelöscht werden ---------- */

const WAS = {
  termin: "termin", termine: "termin", event: "termin", events: "termin", veranstaltung: "termin", kalender: "termin",
  aufgabe: "aufgabe", aufgaben: "aufgabe", todo: "aufgabe", todos: "aufgabe",
  geburtstag: "geburtstag", geburtstage: "geburtstag",
  einsatz: "einsatz", einsaetze: "einsatz", einsatzplan: "einsatz",
  eintrag: "eintrag", eintraege: "eintrag", arbeitszeit: "eintrag", arbeitszeiten: "eintrag", schicht: "eintrag", schichten: "eintrag",
  urlaub: "eintrag:urlaub", krank: "eintrag:krank", krankenstand: "eintrag:krank", zeitausgleich: "eintrag:zeitausgleich", schule: "eintrag:schule",
  material: "material",
  ausgabe: "ausgabe", ausgaben: "ausgabe", einnahme: "ausgabe", einnahmen: "ausgabe", buchung: "ausgabe", buchungen: "ausgabe",
  hausaufgabe: "hausaufgabe", hausaufgaben: "hausaufgabe",
  pruefung: "pruefung", pruefungen: "pruefung", schularbeit: "pruefung", test: "pruefung",
  note: "note", noten: "note",
  packliste: "packliste", packlisten: "packliste", packlisteitems: "packliste", packlisteneintrag: "packliste",
  abo: "abo", abos: "abo", fixkosten: "abo",
  ort: "ort", orte: "ort",
  album: "album", alben: "album", fotoalbum: "album", fotoalben: "album", galeriealbum: "album",
};
const FORBIDDEN = [
  [/passw|tresor|vault|kennw|pin|wlan|zugangsdat/, "Den Passwort-Tresor kann ich nicht löschen – das geht nur direkt in der App."],
  [/foto|bild|galerie|photo/, "Fotos kann ich nicht löschen – das geht nur in der Galerie der App. Ein Album kann ich entfernen (was=album), die Fotos darin bleiben erhalten."],
  [/einstell|setting|konto|profil|schulbl/, "Einstellungen kann ich nicht löschen oder zurücksetzen – das geht nur in der App."],
  [/laufend|stempeluhr|aktuelleschicht/, "Die laufende Schicht kann ich nicht löschen. Bitte zuerst ausstempeln – danach kann der Eintrag gelöscht werden."],
];
const WAS_HELP = "termin, aufgabe, geburtstag, einsatz, eintrag, material, ausgabe, hausaufgabe, pruefung, note, packliste, abo, ort oder album (Fotos bleiben)";

export function resolveWas(v) {
  const k = s(v).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z]/g, "");
  if (!k) throw new UserError(`Bitte angeben, was gelöscht werden soll (${WAS_HELP}).`);
  if (WAS[k]) { const [type, art] = WAS[k].split(":"); return { type, art: art || null }; }
  for (const [re, msg] of FORBIDDEN) if (re.test(k)) throw new UserError(msg);
  throw new UserError(`„${s(v)}“ kann ich nicht löschen. Möglich: ${WAS_HELP}. (Tresor, Fotos und Einstellungen sind ausgeschlossen.)`);
}

/* ---------- Zeitraum ---------- */

function lastOfMonth(mk) {
  const [y, m] = mk.split("-").map(Number);
  return `${mk}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** „im Dezember“, „am 24.12.“, „nächste Woche“, „heute“, ISO … → {from, to}. */
export function rangeOf(v, today, label) {
  const raw = s(v).toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;
  const x = raw.replace(/^(im|in|am|ab|bis|seit|vom|von|zum|zur)\s+/, "").replace(/^(der|dem|den|die)\s+/, "");
  let m = /^(diese|dieser|aktuelle|nächste|naechste|kommende|letzte|vorige|vergangene|übernächste|uebernaechste)\s+woche$/.exec(x);
  if (m) {
    const w = m[1];
    const off = /^(ü|ue)/.test(w) ? 14 : /^(n|k)/.test(w) ? 7 : /^(l|vo|ve)/.test(w) ? -7 : 0;
    const mo = addDays(mondayOf(today), off);
    return { from: mo, to: addDays(mo, 6) };
  }
  const k = parseDate(x, today);
  if (k) return { from: k, to: k };
  if (/[a-zäöü]/.test(x) || /^\d{4}-\d{1,2}$|^\d{1,2}[./ ]\d{4}$/.test(x)) {
    const mk = parseMonth(x, today);
    if (mk) return { from: `${mk}-01`, to: lastOfMonth(mk) };
  }
  throw new UserError(`${label} „${s(v)}“ verstehe ich nicht. Bitte als TT.MM.JJJJ, JJJJ-MM-TT, Monat („Dezember“) oder „nächste Woche“ angeben.`);
}

function rangeArgs(args, today) {
  const a = rangeOf(args.von, today, "„von“");
  const b = rangeOf(args.bis, today, "„bis“");
  if (!a && !b) return null;
  let from = a ? a.from : "1970-01-01";
  let to = b ? b.to : a.to;
  if (to < from) [from, to] = [b.from, a.to];
  return { from, to };
}
const inRange = (k, r) => !r || (isKey(k) && k >= r.from && k <= r.to);
const overlaps = (a, b, r) => !r || (isKey(a) && a <= r.to && (isKey(b) && b >= a ? b : a) >= r.from);

function textHit(q, fields) {
  if (!s(q)) return true;
  return fields.some((f) => s(f) && score(q, f) >= MATCH_MIN);
}

/* ---------- Kandidaten suchen ---------- */

const dLabel = (k) => (isKey(k) ? fmtKeyWd(k) : "ohne Datum");
const q = (t) => (s(t) ? ` · „${s(t).split("\n")[0].slice(0, 80)}“` : "");

function inSchool(k, sc) {
  if (!sc) return false;
  if (sc.days.includes(wdOf(k))) return true;
  return sc.blocks.some((b) => b.from <= k && k <= b.to);
}

async function findEntries(d, args, r, art) {
  const [entries, settings, st] = await Promise.all([d.entriesAll(), d.settings(), d.state()]);
  const outside = args.nur_ausserhalb_schulblock === true;
  const kind = outside ? "schule" : art || (s(args.art) ? s(args.art).toLowerCase() : null);
  const sc = readSchool(settings);
  const out = [];
  for (const e of entries) {
    const k = keyOfTs(e.start);
    if (!k) continue;
    const ek = e.kind || "work";
    if (s(args.id) && e.id !== s(args.id)) continue;
    if (kind && ek !== kind) continue;
    if (!inRange(k, r)) continue;
    if (outside && inSchool(k, sc)) continue;
    if (!textHit(args.suche, [e.note, e.place, kindLabel(ek)])) continue;
    const what = ek === "work" ? `Arbeit ${clock(e.start)}–${clock(e.end)}${s(e.place) ? " · " + s(e.place) : ""}` : kindLabel(ek);
    out.push({ op: "delete", path: `entries/${e.id}`, type: "eintrag", sort: k + clock(e.start), label: `${dLabel(k)} · ${what}${q(e.note)}` });
  }
  const notes = [];
  const run = st.running;
  if (run && (!kind || kind === "work") && (!r || inRange(keyOfTs(run.start), r))) {
    notes.push(`Die laufende Schicht (seit ${clock(run.start)} Uhr) ist nicht dabei – die kann ich nicht löschen. Dafür bitte zuerst ausstempeln.`);
  }
  return { list: out, notes };
}

const TODO_KIND = { termin: "termin", aufgabe: "todo", geburtstag: "geburtstag", einsatz: "einsatz" };

function bdayHit(t, r) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(s(t.bday));
  if (!m) return { ok: !r, key: null };
  if (!r) return { ok: true, key: null };
  for (let y = parseKey(r.from).y; y <= parseKey(r.to).y; y++) {
    const k = `${y}-${pad2(m[1])}-${pad2(m[2])}`;
    if (inRange(k, r)) return { ok: true, key: k };
  }
  return { ok: false };
}

async function findTodos(d, args, r, type) {
  const todos = await d.todos();
  const kind = TODO_KIND[type];
  const serie = s(args.serie).toLowerCase();
  const out = [], askSerie = [], notes = [];
  for (const t of todos) {
    if (s(args.id) ? t.id !== s(args.id) : t.kind !== kind) continue;
    if (!textHit(args.suche, [t.title, t.note, t.location, t.place])) continue;
    const tl = typeLabel(t.kind === "todo" ? "aufgabe" : t.kind);
    if (t.kind === "geburtstag") {
      const h = bdayHit(t, r);
      if (!h.ok) continue;
      const m = /^(\d{1,2})-(\d{1,2})$/.exec(s(t.bday));
      out.push({ op: "delete", path: `todos/${t.id}`, type: "geburtstag", sort: h.key || "", label: `${m ? `${pad2(m[2])}.${pad2(m[1])}.` : "?"} · Geburtstag · „${t.title}“` });
      continue;
    }
    if (t.kind === "termin" && parseRRule(t.rrule)) {
      const insts = r ? expandTodo(t, r.from, r.to) : [];
      if (r && !insts.length) continue;
      if (!serie) { askSerie.push({ t, insts }); continue; }
      if (serie === "nur_datum") {
        if (!r) throw new UserError("Für „nur am Datum“ bitte mit von (und ggf. bis) das Datum der Wiederholung angeben.");
        for (const i of insts) out.push({ op: "exdate", path: `todos/${t.id}`, date: i.key, type: "termin", sort: i.key + (i.time || ""), label: `${dLabel(i.key)}${i.time ? " " + i.time : ""} · Termin (nur diese Wiederholung) · „${t.title}“` });
        continue;
      }
      out.push({ op: "delete", path: `todos/${t.id}`, type: "termin", sort: t.date, label: `ab ${dLabel(t.date)} · Termin-Serie (ganz) · „${t.title}“` });
      continue;
    }
    const last = t.endDate || t.dateTo || t.date;
    if (r ? !overlaps(t.date, last, r) : false) continue;
    const span = last && last > t.date ? ` – ${fmtKey(last)}` : "";
    out.push({ op: "delete", path: `todos/${t.id}`, type: type, sort: t.date || "~", label: `${dLabel(t.date)}${span}${t.time ? " " + t.time : ""} · ${tl} · „${t.title || t.place || "(ohne Titel)"}“` });
  }
  return { list: out, askSerie, notes };
}

const ALLTAG = {
  material: { coll: "material_items", date: (x) => x.dayKey, fields: (x) => [x.name, x.note, x.place], label: (x) => `Material · ${s(x.qty) || 1} ${s(x.unit)} ${s(x.name)}`.replace(/\s+/g, " ") + (s(x.place) ? ` · ${s(x.place)}` : "") },
  ausgabe: { coll: "money_tx", date: (x) => x.date, fields: (x) => [x.note, x.category], label: (x) => `${x.type === "in" ? "Einnahme" : "Ausgabe"} ${eur(Number(x.amount) || 0)}${s(x.category) ? " · " + s(x.category) : ""}${x.src === "bank" || x.bankRef ? (s(x.note) ? " · " + untrusted("bank", s(x.note).split("\n")[0].slice(0, 80)) : "") : q(x.note)}` },
  hausaufgabe: { coll: "school_tasks", date: (x) => x.due, fields: (x) => [x.title, x.subject, x.note], label: (x) => `Hausaufgabe · ${s(x.subject) ? s(x.subject) + ": " : ""}„${s(x.title)}“` },
  pruefung: { coll: "school_exams", date: (x) => x.date, fields: (x) => [x.subject, x.kind, x.topics], label: (x) => `${s(x.kind) || "Prüfung"} · ${s(x.subject)}` },
  note: { coll: "school_grades", date: (x) => x.date, fields: (x) => [x.subject, x.kind, x.note], label: (x) => `Note ${s(x.grade)} · ${s(x.subject)}${s(x.kind) ? " (" + s(x.kind) + ")" : ""}` },
  abo: { coll: "money_subs", date: null, fields: (x) => [x.name, x.note], label: (x) => `Abo · ${s(x.name) || "Abo"} ${eur(Number(x.amount) || 0)}` },
};

async function findAlltag(d, args, r, type) {
  const def = ALLTAG[type];
  if (!def.date && r) throw new UserError("Abos haben kein Datum – bitte mit suche (Name) oder id angeben.");
  const docs = await d.alltag(def.coll);
  const out = [];
  for (const x of docs) {
    if (s(args.id) && x.id !== s(args.id)) continue;
    const k = def.date ? def.date(x) : null;
    if (def.date && !inRange(k, r)) continue;
    if (!textHit(args.suche, def.fields(x))) continue;
    out.push({ op: "delete", path: `a_${def.coll}/${x.id}`, type, sort: k || "", label: `${def.date ? dLabel(k) + " · " : ""}${def.label(x)}` });
  }
  return { list: out, notes: [] };
}

async function findPlaces(d, args, r) {
  if (r) throw new UserError("Orte haben kein Datum – bitte mit suche (Name) oder id angeben.");
  const places = await d.places();
  const out = [];
  for (const p of places) {
    if (s(args.id) && p.id !== s(args.id)) continue;
    if (!textHit(args.suche, [p.name, p.addr])) continue;
    out.push({ op: "delete", path: `places/${p.id}`, type: "ort", sort: s(p.name), label: `Ort · „${s(p.name) || "(ohne Namen)"}“${s(p.addr) ? " · " + s(p.addr) : ""}` });
  }
  return { list: out, notes: out.length ? ["Hinweis: Bestehende Arbeitszeit-Einträge behalten den Ortsnamen als Text – nur der gespeicherte Ort (Adresse, Radius, Geofence) verschwindet."] : [] };
}

async function findPacking(d, args, r) {
  if (r) throw new UserError("Packlisten haben kein Datum – bitte mit suche (Gegenstand) und/oder liste angeben.");
  const lists = await d.alltag("travel_packing");
  const out = [];
  for (const l of lists) {
    if (s(args.liste) && !textHit(args.liste, [l.title])) continue;
    const ids = [], names = [];
    for (const c of l.cats || []) for (const it of c.items || []) {
      if (!it || !it.id) continue;
      if (s(args.id) && it.id !== s(args.id)) continue;
      if (!textHit(args.suche, [it.name])) continue;
      ids.push(it.id); names.push(s(it.name));
    }
    if (!ids.length) continue;
    out.push({ op: "items", path: `a_travel_packing/${l.id}`, itemIds: ids, n: ids.length, type: "packliste", sort: s(l.title), label: `Packliste „${s(l.title) || "Liste"}“ · ${names.join(", ")}` });
  }
  return { list: out, notes: [] };
}

/** Foto-Zugehörigkeit nur über schlanke Felder lesen (nie Bilddaten). */
async function photoRefs(d) {
  const [photos, index] = await Promise.all([
    d.fs.list(d.p("photos"), { mask: ["albumIds"] }),
    d.fs.list(d.p("a_photo_index"), { mask: ["albumIds"] }),
  ]);
  const ids = (x) => (Array.isArray(x && x.albumIds) ? x.albumIds.map(String) : []);
  return { photos: new Map(photos.map((p) => [p.id, ids(p.data)])), index: new Map(index.map((p) => [p.id, ids(p.data)])) };
}

async function findAlbums(d, args, r) {
  if (r) throw new UserError("Alben haben kein Datum – bitte mit suche (Name) oder id angeben.");
  const albums = await d.alltag("photo_albums");
  const hits = albums.filter((a) => a && a.id && (!s(args.id) || a.id === s(args.id)) && textHit(args.suche, [a.name, a.addr]));
  if (!hits.length) return { list: [], notes: [] };
  const refs = await photoRefs(d);
  const out = hits.map((a) => {
    const n = [...refs.index.entries()].filter(([, l]) => l.includes(a.id)).length;
    return { op: "album", path: `a_photo_albums/${a.id}`, type: "album", sort: s(a.name), label: `Album „${s(a.name) || "Album"}“ · ${n} ${n === 1 ? "Foto" : "Fotos"} (die Fotos bleiben erhalten)` };
  });
  return { list: out, notes: ["Hinweis: Nur das Album verschwindet – alle Fotos bleiben in der Galerie (unter „Alle Fotos“ bzw. anderen Alben)."] };
}

/* ---------- Werkzeuge ---------- */

export function makeCode() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

/** Papierkorb: ältere als 30 Tage weg (höchstens 100 pro Aufruf). */
async function purgeTrash(d, docs) {
  const old = docs.filter((t) => isExpired(t.data, d.now)).slice(0, 100);
  if (old.length) await d.commit(old.map((t) => d.fs.deleteWrite(d.p(`a_trash/${t.id}`))));
  return docs.filter((t) => !old.includes(t));
}

async function getMany(d, paths) {
  const out = new Map();
  const uniq = [...new Set(paths)];
  for (let i = 0; i < uniq.length; i += 20) {
    const chunk = uniq.slice(i, i + 20);
    const docs = await Promise.all(chunk.map((p) => d.fs.get(d.p(p))));
    chunk.forEach((p, j) => out.set(p, docs[j] ? docs[j].data : null));
  }
  return out;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const opsCount = (ops) => ops.reduce((a, o) => a + (o.op === "items" ? o.itemIds.length : 1), 0);

const PROPS = {
  was: { type: "string", description: "Was: termin, aufgabe, geburtstag, einsatz, eintrag (Arbeitszeit/Urlaub/Krank/Zeitausgleich/Schule), material, ausgabe (Buchung), hausaufgabe, pruefung, note, packliste (Gegenstände einer Packliste), abo, ort, album (nur das Album – Fotos bleiben). NICHT möglich: Passwort-Tresor, Fotos, Einstellungen, laufende Schicht." },
  suche: { type: "string", description: "Suchtext, unscharf gegen Titel/Notiz/Ort (z. B. \"Zahnarzt\", \"Billa\", \"Huber\")" },
  von: { type: "string", description: "Erster Tag bzw. Zeitraum: TT.MM.JJJJ, JJJJ-MM-TT, \"24.12.\", \"heute\", \"Dezember\", \"nächste Woche\". Andere Angaben bitte selbst in ein Datum umrechnen." },
  bis: { type: "string", description: "Letzter Tag (inklusive), gleiche Formate. Fehlt er, gilt der von-Tag bzw. -Zeitraum." },
  id: { type: "string", description: "Genau dieses Element (ID aus einem Lese-Werkzeug)" },
  art: { type: "string", enum: ["work", "urlaub", "krank", "zeitausgleich", "schule"], description: "Nur bei was=eintrag: Eintragsart" },
  nur_ausserhalb_schulblock: { type: "boolean", description: "Nur bei was=eintrag: nur Schul-Einträge, die an keinem eingestellten Schultag/in keinem Schulblock liegen" },
  serie: { type: "string", enum: ["ganz", "nur_datum"], description: "Bei Serienterminen (Wiederholung): \"ganz\" = ganze Serie löschen, \"nur_datum\" = nur die Wiederholung(en) im Zeitraum von–bis auslassen. Vorher den Nutzer fragen!" },
  liste: { type: "string", description: "Nur bei was=packliste: Name der Packliste" },
};

export const DELETE_TOOLS = [
  {
    name: "loeschen_vorschlagen",
    title: "Löschen vorschlagen",
    description: "SCHRITT 1 von 2 beim Löschen – löscht selbst NOCH NICHTS. Sucht die passenden Elemente (Termine, Aufgaben, Geburtstage, Einsätze, Arbeitszeit-Einträge, Material, Buchungen, Hausaufgaben, Prüfungen, Noten, Packlisten-Gegenstände, Abos, Orte, Foto-Alben – „Album löschen, Fotos behalten“) und gibt eine Liste (Datum, Art, Titel) plus einen bestaetigungs_code (10 Minuten gültig, höchstens 200 Elemente) zurück. Danach IMMER dem Nutzer die Liste zeigen und fragen „Soll ich diese X löschen?“ – erst nach einem ausdrücklichen Ja in seiner NÄCHSTEN Nachricht loeschen_bestaetigen aufrufen. Nie beide Werkzeuge ohne Antwort des Nutzers dazwischen aufrufen. Bei Serienterminen zuerst fragen: ganze Serie oder nur am Datum X (Feld serie). Passwort-Tresor, Fotos, Einstellungen und die laufende Schicht sind nicht löschbar.",
    inputSchema: { type: "object", properties: PROPS, required: ["was"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(args, d) {
      const today = dayKey(d.now);
      const { type, art } = resolveWas(args.was);
      const r = rangeArgs(args, today);
      if (!s(args.suche) && !r && !s(args.id) && args.nur_ausserhalb_schulblock !== true && !s(args.liste) && !art) {
        throw new UserError("Das ist zu ungenau – alles auf einmal lösche ich nicht. Bitte suche, einen Zeitraum (von/bis) oder eine id angeben.");
      }
      if (args.nur_ausserhalb_schulblock === true && type !== "eintrag") throw new UserError("nur_ausserhalb_schulblock gibt es nur bei was=eintrag.");
      let res;
      if (type === "eintrag") res = await findEntries(d, args, r, art);
      else if (TODO_KIND[type]) res = await findTodos(d, args, r, type);
      else if (ALLTAG[type]) res = await findAlltag(d, args, r, type);
      else if (type === "ort") res = await findPlaces(d, args, r);
      else if (type === "album") res = await findAlbums(d, args, r);
      else res = await findPacking(d, args, r);
      const list = res.list.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
      const ask = res.askSerie || [];
      const out = [];
      if (ask.length) {
        out.push("Serientermine gefunden – noch nichts vorgemerkt:");
        for (const { t, insts } of ask) out.push(`- „${t.title}“ (Serie ab ${fmtKey(t.date)})${insts.length ? `, im Zeitraum am ${insts.slice(0, 5).map((i) => fmtKey(i.key)).join(", ")}${insts.length > 5 ? " …" : ""}` : ""}`);
        out.push("Frag den Nutzer: „Ganze Serie löschen oder nur am Datum …?“ und ruf dann loeschen_vorschlagen erneut mit serie=\"ganz\" oder serie=\"nur_datum\" (mit von/bis = Datum) auf.");
        if (list.length) out.push("", `Außerdem passen ${list.length} weitere Elemente – sie kommen beim nächsten Vorschlag wieder mit.`);
        return out.concat(res.notes || []).join("\n");
      }
      const n = opsCount(list);
      if (!n) {
        const why = res.notes && res.notes.length ? "\n" + res.notes.join("\n") : "";
        if (why && type === "eintrag") throw new UserError(`Nichts Passendes zum Löschen gefunden.${why}`);
        return `Nichts Passendes zum Löschen gefunden.${why}`;
      }
      if (n > MAX_ITEMS) throw new UserError(`Das wären ${n} Elemente – höchstens ${MAX_ITEMS} auf einmal. Bitte genauer eingrenzen (Zeitraum oder Suchtext).`);
      const code = makeCode();
      const ops = list.map(({ sort: _s, n: _n, ...o }) => o);
      await d.commit([d.fs.setWrite(d.p(PENDING), { code, created: d.now, expires: d.now + CODE_TTL_MS, count: n, ops })]);
      out.push(`Gefunden – ${count(n, "Element", "Elemente")} zum Löschen (noch NICHT gelöscht):`);
      list.slice(0, 80).forEach((o, i) => out.push(`${i + 1}. ${o.label}`));
      if (list.length > 80) out.push(`… und ${list.length - 80} weitere`);
      if (res.notes && res.notes.length) out.push("", ...res.notes);
      out.push("", `bestaetigungs_code: ${code} (10 Minuten gültig)`);
      out.push(`WICHTIG: Zeig dem Nutzer diese Liste und frag: „Soll ich diese ${n} löschen?“ Erst nach einem klaren Ja in seiner nächsten Nachricht loeschen_bestaetigen mit diesem Code aufrufen. Gelöschtes landet 30 Tage im Papierkorb (rueckgaengig).`);
      return out.join("\n");
    },
  },
  {
    name: "loeschen_bestaetigen",
    title: "Löschen bestätigen",
    description: "SCHRITT 2 von 2: Löscht die Elemente aus dem letzten loeschen_vorschlagen – nur mit dessen bestaetigungs_code und NUR nachdem der Nutzer die Liste gesehen und in einer eigenen Nachricht ausdrücklich Ja gesagt hat. Niemals im selben Zug wie loeschen_vorschlagen aufrufen. Alles kommt vorher in den Papierkorb (30 Tage, rueckgaengig).",
    inputSchema: {
      type: "object",
      properties: { bestaetigungs_code: { type: "string", description: "Code aus loeschen_vorschlagen" } },
      required: ["bestaetigungs_code"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    action: "loeschen",
    async run(args, d) {
      const code = s(args.bestaetigungs_code).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const doc = await d.fs.get(d.p(PENDING));
      const p = doc && doc.data;
      if (!p || !p.code || !Array.isArray(p.ops)) throw new UserError("Es gibt keinen offenen Löschvorschlag. Zuerst loeschen_vorschlagen aufrufen, dem Nutzer die Liste zeigen und ihn fragen.");
      if (!(Number(p.expires) > d.now)) {
        await d.commit([d.fs.deleteWrite(d.p(PENDING))]);
        throw new UserError("Der Bestätigungscode ist abgelaufen (10 Minuten). Bitte loeschen_vorschlagen nochmal aufrufen und den Nutzer erneut fragen.");
      }
      if (code !== p.code) throw new UserError("Der Bestätigungscode passt nicht zum letzten Löschvorschlag. Nur den Code aus loeschen_vorschlagen verwenden – nichts gelöscht.");
      const ops = p.ops.filter((o) => o && splitPath(o.path));
      await purgeTrash(d, await d.fs.list(d.p("a_trash"))).catch(() => null);
      const cur = await getMany(d, ops.map((o) => o.path));
      const batchId = "b" + alltagId(d.now);
      const writes = [];
      let done = 0, gone = 0, i = 0;
      // mehrere Ausnahmen am selben Serientermin nacheinander anwenden
      const work = new Map();
      const refs = ops.some((o) => o.op === "album") ? await photoRefs(d) : null;
      const pre = []; // Album: Fotos aus dem Album nehmen (vor dem eigentlichen Löschen, ggf. in Teilen)
      for (const o of ops) {
        const before = work.has(o.path) ? work.get(o.path) : cur.get(o.path);
        if (!before) { gone++; continue; }
        const { coll, id } = splitPath(o.path);
        const trash = { path: o.path, data: before, op: o.op, type: o.type || "", label: o.label || "", deletedAt: d.now, by: "claude", batchId };
        if (o.op === "exdate") {
          const r = applyDelete({ ...before, id }, o.date, "one");
          if (r.remove.length) { writes.push(d.fs.deleteWrite(d.p(o.path))); work.set(o.path, null); trash.op = "delete"; }
          else { const { id: _x, ...n } = r.save[0]; writes.push(d.fs.setWrite(d.p(o.path), n)); work.set(o.path, n); trash.date = o.date; }
          done++;
        } else if (o.op === "items") {
          const ids = new Set(o.itemIds || []);
          let k = 0;
          const n = { ...before, cats: (before.cats || []).map((c) => ({ ...c, items: (c.items || []).filter((it) => { const hit = it && ids.has(it.id); if (hit) k++; return !hit; }) })) };
          if (!k) { gone++; continue; }
          if (coll.startsWith("a_")) n.updated = d.now;
          writes.push(d.fs.setWrite(d.p(o.path), n)); work.set(o.path, n);
          trash.itemIds = [...ids];
          done += k;
        } else if (o.op === "album") {
          // „Album löschen, Fotos behalten“: Album-ID aus Foto UND Index entfernen (nur Feld albumIds), dann Album löschen
          const pids = [];
          for (const [pid, l] of refs.photos) {
            if (!l.includes(id)) continue;
            pids.push(pid);
            pre.push(d.fs.patchWrite(d.p(`photos/${pid}`), { albumIds: l.filter((x) => x !== id) }, { exists: true }));
          }
          for (const [pid, l] of refs.index) if (l.includes(id)) pre.push(d.fs.patchWrite(d.p(`a_photo_index/${pid}`), { albumIds: l.filter((x) => x !== id) }, { exists: true }));
          trash.photoIds = pids;
          writes.push(d.fs.deleteWrite(d.p(o.path))); work.set(o.path, null);
          done++;
        } else {
          writes.push(d.fs.deleteWrite(d.p(o.path))); work.set(o.path, null);
          done++;
        }
        writes.push(d.fs.setWrite(d.p(`a_trash/${batchId}-${i++}`), trash));
      }
      writes.push(d.fs.deleteWrite(d.p(PENDING)));
      for (let k = 0; k < pre.length; k += 400) await d.commit(pre.slice(k, k + 400));
      await d.commit(writes);
      d.invalidate("todos", "places", "entries:true", "entries:false", ...DELETABLE.filter((c) => c.startsWith("a_")));
      if (!done) return "Nichts gelöscht – die vorgeschlagenen Elemente gibt es nicht mehr.";
      return [
        `Gelöscht: ${count(done, "Element", "Elemente")}${gone ? ` (${gone} gab es schon nicht mehr)` : ""}.`,
        "Alles liegt 30 Tage im Papierkorb: rückgängig mit „rueckgaengig“ oder in der App unter Übersicht → Einstellungen → Papierkorb.",
        `(Stapel ${batchId})`,
      ].join("\n");
    },
  },
  {
    name: "rueckgaengig",
    title: "Löschen rückgängig machen",
    description: "Stellt die zuletzt von Claude gelöschten Elemente (oder einen bestimmten Stapel aus dem Papierkorb) wieder her – Termine, Ausnahmen von Serienterminen, Einträge, Packlisten-Gegenstände usw. Der Papierkorb hält 30 Tage.",
    inputSchema: {
      type: "object",
      properties: { batch: { type: "string", description: "Optional: Stapel-ID (z. B. aus loeschen_bestaetigen). Ohne Angabe: die letzte Löschung." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(args, d) {
      const docs = await purgeTrash(d, await d.fs.list(d.p("a_trash")));
      const items = docs.map((x) => ({ ...x.data, id: x.id }));
      const batches = groupBatches(items);
      if (!batches.length) return "Im Papierkorb liegt nichts (Claude-Löschungen werden 30 Tage aufgehoben).";
      const b = s(args.batch) ? batches.find((x) => x.batchId === s(args.batch)) : batches[0];
      if (!b) throw new UserError(`Den Stapel „${s(args.batch)}“ gibt es im Papierkorb nicht. Vorhanden: ${batches.slice(0, 5).map((x) => x.batchId).join(", ")}.`);
      // ältere Ausnahme zuerst → mehrere Ausnahmen derselben Serie greifen nacheinander
      const its = [...b.items].sort((x, y) => String(x.id).localeCompare(String(y.id), "en", { numeric: true }));
      const cur = await getMany(d, its.filter((t) => splitPath(t.path)).map((t) => t.path));
      const state = new Map(cur);
      const writes = [], labels = [], post = [];
      let skipped = 0;
      const refs = its.some((t) => Array.isArray(t.photoIds) && t.photoIds.length) ? await photoRefs(d) : null;
      for (const t of its) {
        if (splitPath(t.path)) {
          const r = restoreDoc(t, state.get(t.path) ?? null);
          if (r.data) { writes.push(d.fs.setWrite(d.p(t.path), r.data)); state.set(t.path, r.data); labels.push(t.label || t.path); }
          else skipped++;
          // Album: Fotos wieder ins Album legen (nur die, die es noch gibt)
          if (refs && Array.isArray(t.photoIds) && r.data) {
            const aid = splitPath(t.path).id;
            for (const pid of t.photoIds) {
              const pl = refs.photos.get(pid);
              if (pl && !pl.includes(aid)) post.push(d.fs.patchWrite(d.p(`photos/${pid}`), { albumIds: [...pl, aid] }, { exists: true }));
              const il = refs.index.get(pid);
              if (il && !il.includes(aid)) post.push(d.fs.patchWrite(d.p(`a_photo_index/${pid}`), { albumIds: [...il, aid] }, { exists: true }));
            }
          }
        }
        writes.push(d.fs.deleteWrite(d.p(`a_trash/${t.id}`)));
      }
      await d.commit(writes);
      for (let k = 0; k < post.length; k += 400) await d.commit(post.slice(k, k + 400));
      d.invalidate("todos", "places", "entries:true", "entries:false", ...DELETABLE.filter((c) => c.startsWith("a_")));
      const out = [`Wiederhergestellt: ${count(labels.length, "Element", "Elemente")} (gelöscht am ${fmtKey(dayKey(b.deletedAt))}, ${clock(b.deletedAt)} Uhr).`];
      out.push(...labels.slice(0, 30).map((l) => `- ${l}`));
      if (skipped) out.push(`${skipped} ${skipped === 1 ? "war" : "waren"} schon wieder vorhanden und ${skipped === 1 ? "blieb" : "blieben"} unverändert.`);
      return out.join("\n");
    },
  },
];

export { keyToTs };
