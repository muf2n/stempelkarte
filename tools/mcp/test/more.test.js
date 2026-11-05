// Update 9 – „Claude darf (fast) alles“: neue Lese-/Schreib-Werkzeuge, zweistufige Einstellungen, Maskierung,
// verbotene Bereiche, Galerie ohne Bilddaten, Album löschen (Fotos bleiben).
process.env.TZ = "Europe/Vienna";
import test from "node:test";
import assert from "node:assert/strict";
import { setup, vt } from "./helpers.js";

const NOW = vt(2026, 11, 4, 10, 0); // Mi 04.11.2026 10:00
const codeOf = (text) => { const m = /bestaetigungs_code: ([A-Z0-9]{6})/.exec(text); assert.ok(m, "Code in: " + text); return m[1]; };
const SECRET_FEED = "https://calendar.google.com/calendar/ical/florian%40gmail.com/private-0123456789abcdefSECRET/basic.ics";
const THUMB = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD_GEHEIMES_BILD";

async function seeded() {
  const t = await setup({ now: NOW });
  const b = t.base;
  t.g.set(`${b}/meta/settings`, {
    weeklyTarget: 38.5, workDays: [1, 2, 3, 4, 5],
    school: { days: [4], blocks: [{ id: "b1", from: "2026-12-01", to: "2026-12-11", label: "Block 2" }] },
    apprentice: { name: "Florian", trade: "Elektrotechnik", company: "Elektro Maier", start: "2025-09-01", years: 3.5, notes: { "2026-W44": "FI-Schutzschalter geprüft" } },
    leave: { daysPerYear: 25, yearStartMonth: 1, carryOver: 2 },
    allowance: { enabled: true, minHours: 3, fullHours: 11, ratePart: 13.2, rateFull: 26.4, homePlaceIds: ["p2"], kmRate: 0.5, ownCar: false },
    vehicles: [{ id: "v1", name: "Caddy", plate: "WL-123AB", type: "firma" }, { id: "v2", name: "Golf", plate: "WL-9XY", type: "privat" }],
    trips: { defaultVehicleId: "v1" },
    gallery: { activeFolderId: "f_bau" },
    lockscreen: { pinHash: "GEHEIMER_PIN_HASH" },
    ai: { apiKey: "sk-ant-GEHEIM" },
  });
  t.g.set(`${b}/meta/state`, { running: null, rev: 1 });
  t.g.set(`${b}/meta/ical_feeds`, { feeds: [{ id: "f1", name: "Google privat", color: "blue", url: SECRET_FEED, visible: true }] });
  t.g.set(`${b}/meta/bank`, { linked: true, session_id: "SESSION-GEHEIM-42", aspsp: "BAWAG", valid_until: "2027-03-01T00:00:00Z", accounts: [{ uid: "acc-uid-geheim", iban_last4: "4711", name: "Giro", currency: "EUR" }], balance: { amount: 1234.56, currency: "EUR", at: NOW - 3600000 }, lastSync: NOW - 3600000 });
  t.g.set(`${b}/places/p1`, { name: "Baustelle Huber", addr: "Hauptstraße 1, 4600 Wels", lat: 48.16, lng: 14.03, radius: 150 });
  t.g.set(`${b}/places/p2`, { name: "Firma Elektro Maier", addr: "Industriestraße 5, 4600 Wels", lat: 48.17, lng: 14.0, radius: 150 });
  // Fahrt e1: Firma → Huber (manuell 12 km), dann Arbeit; Rückfahrt mit Golf (privat-Auto) Straßen-km
  t.g.set(`${b}/entries/e1`, {
    kind: "work", start: vt(2026, 11, 2, 7, 0), end: vt(2026, 11, 2, 15, 30), pauseMin: 30, placeId: "p1", place: "Baustelle Huber", note: "Verteiler", people: [],
    segments: [
      { start: vt(2026, 11, 2, 7, 0), end: vt(2026, 11, 2, 7, 30), activity: "Autofahren", placeId: "p2", place: "Firma Elektro Maier", endPlace: "Baustelle Huber", km: 12 },
      { start: vt(2026, 11, 2, 7, 30), end: vt(2026, 11, 2, 15, 0), activity: "Arbeiten", placeId: "p1", place: "Baustelle Huber" },
      { start: vt(2026, 11, 2, 15, 0), end: vt(2026, 11, 2, 15, 30), activity: "Autofahren", placeId: "p1", place: "Baustelle Huber", endPlace: "Firma Elektro Maier", km: 12, vehicleId: "v2" },
    ],
  });
  t.g.set(`${b}/entries/e2`, { kind: "urlaub", start: vt(2026, 10, 12), end: vt(2026, 10, 12), pauseMin: 0, creditMin: 462, note: "" });
  t.g.set(`${b}/entries/e3`, { kind: "urlaub", start: vt(2026, 12, 21), end: vt(2026, 12, 21), pauseMin: 0, creditMin: 462, note: "" });
  t.g.set(`${b}/entries/e4`, { kind: "krank", start: vt(2026, 3, 3), end: vt(2026, 3, 3), pauseMin: 0, creditMin: 462, note: "Grippe" });
  t.g.set(`${b}/entries/e5`, { kind: "work", start: vt(2026, 11, 3, 7, 0), end: vt(2026, 11, 3, 16, 0), pauseMin: 30, placeId: "p1", place: "Baustelle Huber", note: "Kabel gezogen" });
  // Planer
  t.g.set(`${b}/todos/s1`, { kind: "termin", title: "Fußballtraining", date: "2026-11-02", time: "18:00", endTime: "19:30", rrule: "FREQ=WEEKLY;BYDAY=MO", done: false, createdAt: 1 });
  t.g.set(`${b}/todos/z1`, { kind: "termin", title: "Zahnarzt", date: "2026-11-12", time: "08:00", endTime: "08:30", location: "Dr. Huber", reminders: [30], remind: true, remindMin: 30, done: false, createdAt: 2 });
  t.g.set(`${b}/todos/a1`, { kind: "todo", title: "Werkzeug zurückgeben", date: null, done: false, createdAt: 3 });
  // Galerie
  t.g.set(`${b}/a_photo_folders/f_bau`, { id: "f_bau", name: "Baustellen", emoji: "🏗️", color: "#d97706", order: 0 });
  t.g.set(`${b}/a_photo_folders/f_privat`, { id: "f_privat", name: "Privat", emoji: "🏠", color: "#16a34a", order: 2 });
  t.g.set(`${b}/a_photo_albums/al1`, { id: "al1", name: "Huber Hauptstraße", kind: "address", addr: "Hauptstraße 1, Wels", folderId: "f_bau", created: 1 });
  t.g.set(`${b}/a_photo_albums/al2`, { id: "al2", name: "Urlaub", kind: "custom", folderId: "f_privat", created: 2 });
  for (const [id, ts, al, note] of [["ph1", vt(2026, 11, 2, 9, 0), ["al1"], "Verteiler vorher"], ["ph2", vt(2026, 11, 2, 14, 0), ["al1", "al2"], ""], ["ph3", vt(2026, 8, 1, 12, 0), ["al2"], "Strand"]]) {
    t.g.set(`${b}/photos/${id}`, { id, ts, dayKey: "x", data: THUMB + "_GROSS", thumb: THUMB, albumIds: al, note, addr: "Hauptstraße 1, Wels" });
    t.g.set(`${b}/a_photo_index/${id}`, { id, ts, dayKey: "x", thumb: THUMB, albumIds: al, note, addr: "Hauptstraße 1, Wels", place: "", w: 100, h: 100 });
  }
  // Unterwegs
  t.g.set(`${b}/a_travel_trips/tr1`, { id: "tr1", title: "Kroatien", dest: "Split", from: "2026-11-20", to: "2026-11-27", budget: 800, emoji: "🏖️", plan: [], expenses: [{ amount: 50 }] });
  t.g.set(`${b}/a_travel_packing/pk1`, { id: "pk1", kind: "trip", tripId: "tr1", title: "Kroatien", cats: [{ id: "c1", key: "kleidung", name: "Kleidung", emoji: "👕", items: [{ id: "i1", name: "Badehose", qty: 1, done: false }, { id: "i2", name: "Sonnenbrille", qty: 1, done: true }] }] });
  t.g.set(`${b}/a_travel_fuel/fu1`, { id: "fu1", date: "2026-10-01", liters: 40, total: 64, km: 10000, full: true, station: "OMV" });
  t.g.set(`${b}/a_travel_fuel/fu2`, { id: "fu2", date: "2026-10-20", liters: 30, total: 48, km: 10500, full: true, station: "OMV" });
  t.g.set(`${b}/a_travel_places/ad1`, { id: "ad1", name: "Dr. Huber Zahnarzt", cat: "arzt", address: "Ringstraße 3, Wels", phone: "+43 7242 1234", notes: "Mo–Fr 8–12" });
  // Geld
  t.g.set(`${b}/a_money_goals/g1`, { id: "g1", name: "Moped", target: 2000, saved: 500, date: "2027-06-30", emoji: "🛵" });
  t.g.set(`${b}/a_money_split/sp1`, { id: "sp1", name: "WG", people: [{ id: "me", name: "Ich" }, { id: "pmax", name: "Max" }], expenses: [{ id: "x1", desc: "Pizza", amount: 30, date: "2026-11-01", paidBy: "me", forIds: [] }] });
  // Schule
  t.g.set(`${b}/a_school_timetable/l1`, { id: "l1", subject: "Elektrotechnik", weekday: 4, period: 1, periods: 2, from: "08:00", to: "09:40", room: "E12", teacher: "Mag. Berger" });
  t.g.set(`${b}/a_school_projects/pr1`, { id: "pr1", title: "Schaltplan Einfamilienhaus", subject: "Elektrotechnik", due: "2026-11-20", steps: [{ id: "st1", text: "Grundriss zeichnen", done: true }, { id: "st2", text: "Stromkreise planen", done: false }] });
  t.g.set(`${b}/a_school_docs/dc1`, { id: "dc1", title: "Formelsammlung", subject: "Elektrotechnik", type: "application/pdf", size: 204800, date: "2026-10-01", thumb: THUMB });
  t.g.set(`${b}/a_material_items/m1`, { id: "m1", name: "Schuko-Steckdose", qty: 3, unit: "Stk", status: "brauche", placeId: "p1", place: "Baustelle Huber", dayKey: "2026-11-03" });
  t.g.set(`${b}/a_vault_items/v1`, { id: "v1", title: "Huber WLAN", enc: "xxx" });
  return t;
}
const reqs = (t, re) => t.g.requests.filter((r) => re.test(decodeURIComponent(r.url)));

test("galerie_lesen: Kategorien, Alben, Fotos mit Notiz – nie Bilddaten, nie volle Foto-Dokumente", async () => {
  const t = await seeded();
  const r = await t.tool("galerie_lesen", {});
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Galerie – 3 Fotos in 2 Alben/);
  assert.match(r.text, /Neue Fotos gehen nach: 🏗️ Baustellen/);
  assert.match(r.text, /🏗️ Baustellen: 1 Alben, 2 Fotos/);
  assert.match(r.text, /Huber Hauptstraße: 2 Fotos.*Album-ID al1/);
  assert.match(r.text, /Notiz: „Verteiler vorher“ \(Foto-ID ph1\)/);
  assert.ok(!r.text.includes("base64") && !r.text.includes("GEHEIMES_BILD"));
  const a = await t.tool("galerie_lesen", { album: "urlaub" });
  assert.match(a.text, /Album „Urlaub“ \(Kategorie 🏠 Privat\) – 2 Fotos/);
  const sr = await t.tool("galerie_lesen", { suche: "strand" });
  assert.match(sr.text, /Fotos zu „strand“ \(1\)/);
  // Nur schlanke Listen: Index mit Feldmaske ohne thumb, nie photos/… lesen
  const idx = reqs(t, /a_photo_index/);
  assert.ok(idx.length >= 1);
  for (const q of idx) { assert.match(q.url, /mask\.fieldPaths=/); assert.ok(!/fieldPaths=thumb/.test(q.url)); }
  assert.equal(reqs(t, /\/photos(\/|\?|$)/).length, 0, "photos/ darf nie gelesen werden");
});

test("unterwegs_lesen: Übersicht, Reisen, Packliste, Tanken, Adressen; unterwegs_eintragen schreibt wie die App", async () => {
  const t = await seeded();
  const b = t.base;
  let r = await t.tool("unterwegs_lesen", {});
  assert.match(r.text, /Nächste Reise: 🏖️ Kroatien \(Split\): .*noch 16 Tage/);
  assert.match(r.text, /Ø 6,0 l\/100 km/);
  r = await t.tool("unterwegs_lesen", { bereich: "reisen" });
  assert.match(r.text, /7 Nächte · Budget 800,00 €, ausgegeben 50,00 € · Packliste 1\/2 \(50 %\)/);
  r = await t.tool("unterwegs_lesen", { bereich: "packliste", nur_offen: true });
  assert.match(r.text, /☐ Badehose/);
  assert.ok(!r.text.includes("Sonnenbrille"));
  r = await t.tool("unterwegs_lesen", { bereich: "adressen", suche: "zahnarzt" });
  assert.match(r.text, /Dr\. Huber Zahnarzt \(🩺 Arzt\) · Ringstraße 3, Wels · Tel\. \+43 7242 1234/);
  // schreiben
  r = await t.tool("unterwegs_eintragen", { aktion: "packliste_hinzufuegen", liste: "Kroatien", gegenstaende: ["Ladekabel", "Badehose"], kategorie: "Technik" });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /gesetzt \(🔌 Technik\): Ladekabel · schon drauf: Badehose/);
  r = await t.tool("unterwegs_eintragen", { aktion: "packliste_abhaken", liste: "Split", gegenstaende: ["badehose", "Ladekabel"] });
  assert.match(r.text, /Gepackt ☑: Badehose, Ladekabel\. Packliste „Kroatien“: 3\/3 \(100 %\)/);
  r = await t.tool("unterwegs_eintragen", { aktion: "parkplatz_merken", adresse: "Parkhaus Zentrum, Wels", ebene: "-2", parkschein_bis: "12:00" });
  assert.match(r.text, /Parkplatz gemerkt: Parkhaus Zentrum, Wels · Ebene -2 · Parkschein bis 12:00/);
  const park = t.g.list(`${b}/a_travel_parking`)[0];
  assert.equal(park.active, true); assert.equal(park.lat, null); assert.equal(park.addr, "Parkhaus Zentrum, Wels");
  r = await t.tool("unterwegs_lesen", { bereich: "parken" });
  assert.match(r.text, /Dein Auto: geparkt 04\.11\.2026, 10:00 · Parkhaus Zentrum, Wels · Ebene -2 · Parkschein bis 12:00 \(noch 120 min\)/);
  r = await t.tool("unterwegs_eintragen", { aktion: "tanken", liter: "35,5", betrag: "56,80", km_stand: 11000, tankstelle: "BP", in_geld_buchen: true });
  assert.match(r.text, /35,5 l · 56,80 € .* Verbrauch seit letzter Volltankung 7,1 l\/100 km · auch in Geld gebucht/);
  const tx = t.g.list(`${b}/a_money_tx`)[0];
  assert.equal(tx.category, "auto"); assert.equal(tx.amount, 56.8); assert.match(tx.id, /^uw_fuel_/);
  r = await t.tool("unterwegs_eintragen", { aktion: "reise_anlegen", titel: "Wien", von: "12.12.2026", bis: "13.12.2026", vorlage: TEMPLATE_FIRST() });
  assert.match(r.text, /Reise angelegt: 🧳 Wien · .*Packliste/);
  r = await t.tool("unterwegs_eintragen", { aktion: "adresse_speichern", name: "Werkstatt Berger", adresse: "Gewerbestraße 2", telefon: "0664 123", kategorie: "werkstatt" });
  assert.match(r.text, /Adresse gespeichert: Werkstatt Berger \(🔧 Werkstatt\)/);
  r = await t.tool("unterwegs_eintragen", { aktion: "parkplatz_merken" });
  assert.equal(r.isError, true);
});
function TEMPLATE_FIRST() { return "wochenende"; }

test("fahrtenbuch_lesen + fahrt_bearbeiten + taggeld_lesen", async () => {
  const t = await seeded();
  let r = await t.tool("fahrtenbuch_lesen", { monat: "2026-11" });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Fahrtenbuch – November 2026: 2 Fahrten, 24,0 km/);
  assert.match(r.text, /Kilometergeld: 12,0 km × 0,50 € = 6,00 €/);
  assert.match(r.text, /07:00–07:30 · Firma Elektro Maier → Baustelle Huber · 12,0 km \(manuell\) · Zweck: Baustelle Huber \(Vorschlag\) · Fahrzeug: Caddy \(fahrt e1#0\)/);
  assert.match(r.text, /↩ Baustelle Huber → Firma Elektro Maier/);
  r = await t.tool("fahrt_bearbeiten", { fahrt: "e1#0", zweck: "Material holen", fahrzeug: "golf", km: "13,5" });
  assert.match(r.text, /Zweck → Material holen · Fahrzeug → Golf \(WL-9XY\) · km → 13,5/);
  const seg = t.g.get(`${t.base}/entries/e1`).segments[0];
  assert.deepEqual([seg.purpose, seg.vehicleId, seg.km], ["Material holen", "v2", 13.5]);
  r = await t.tool("fahrt_bearbeiten", { datum: "02.11.2026", uhrzeit: "15:00", privat: true });
  assert.match(r.text, /privat/);
  assert.equal(t.g.get(`${t.base}/entries/e1`).segments[2].private, true);
  r = await t.tool("fahrt_bearbeiten", { fahrt: "e1#1", zweck: "x" });
  assert.equal(r.isError, true);
  r = await t.tool("taggeld_lesen", { monat: "2026-11" });
  assert.match(r.text, /Mo, 02\.11\.2026: 8,5 h weg → teilweise · 13,20 €/);
  assert.match(r.text, /Lohnzettel/);
});

test("urlaub_lesen: Anspruch, verbraucht, geplant, Krankenstand", async () => {
  const t = await seeded();
  const r = await t.tool("urlaub_lesen", {});
  assert.match(r.text, /Urlaubsjahr 2026: Anspruch 25 Tage \+ Rest Vorjahr 2 = 27/);
  assert.match(r.text, /Verbraucht 1 · geplant 1 · übrig 25 Tage/);
  assert.match(r.text, /Geplant: 21\.12\.2026/);
  assert.match(r.text, /Krankenstand 2026: 1 Tag \(03\.03\.2026\)/);
});

test("einstellungen_lesen: alles Wichtige, Geheimes maskiert", async () => {
  const t = await seeded();
  const r = await t.tool("einstellungen_lesen", {});
  assert.match(r.text, /Arbeitstage: Mo, Di, Mi, Do, Fr · Wochenstunden 38,5 h/);
  assert.match(r.text, /Block 01\.12\.2026 – 11\.12\.2026 „Block 2“ \(ID b1\)/);
  assert.match(r.text, /Florian · Elektrotechnik · Elektro Maier · Beginn 01\.09\.2025 · Dauer 3½ Jahre · jetzt 2\. Lehrjahr/);
  assert.match(r.text, /neue Fotos nach: Baustellen/);
  assert.match(r.text, /Google privat \(sichtbar, calendar\.google\.com\/… \(Adresse verborgen\)\)/);
  assert.match(r.text, /Bank:\n- verbunden \(BAWAG/);
  for (const secret of ["private-0123456789", "SECRET", "basic.ics", "SESSION-GEHEIM", "acc-uid-geheim", "GEHEIMER_PIN", "sk-ant-GEHEIM", "florian%40"]) assert.ok(!r.text.includes(secret), "verrät " + secret);
});

test("einstellung_aendern: zweistufig, vorher → nachher, falscher Code, veraltet, verbotene Bereiche", async () => {
  const t = await seeded();
  const b = t.base;
  let r = await t.tool("einstellung_aendern", { bereich: "urlaub", werte: { anspruch: 26, rest_vorjahr: "1,5" } });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Urlaubsanspruch: 25 Tage → 26 Tage/);
  assert.match(r.text, /Rest Vorjahr: 2 Tage → 1½ Tage/);
  assert.match(r.text, /noch NICHT gespeichert/);
  assert.equal(t.g.get(`${b}/meta/settings`).leave.daysPerYear, 25, "Vorschlag speichert nichts");
  const code = codeOf(r.text);
  r = await t.tool("einstellung_bestaetigen", { bestaetigungs_code: "ZZZZZZ" });
  assert.equal(r.isError, true); assert.match(r.text, /passt nicht/);
  r = await t.tool("einstellung_bestaetigen", { bestaetigungs_code: code.toLowerCase() });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Gespeichert – Einstellungen „Urlaub“/);
  assert.deepEqual(t.g.get(`${b}/meta/settings`).leave, { daysPerYear: 26, yearStartMonth: 1, carryOver: 1.5 });
  assert.equal(t.g.get(`${b}/meta/ai_pending_settings`), null);
  r = await t.tool("einstellung_bestaetigen", { bestaetigungs_code: code });
  assert.match(r.text, /keinen offenen Einstellungs-Vorschlag/);
  // Schulblock hinzufügen/entfernen, Arbeitstage
  r = await t.tool("einstellung_aendern", { bereich: "schule", werte: { block_hinzufuegen: { von: "11.01.2027", bis: "05.02.2027", name: "Block 3" }, block_entfernen: "b1" } });
  assert.match(r.text, /Schulblock neu: 11\.01\.2027 – 05\.02\.2027 „Block 3“/);
  assert.match(r.text, /Schulblock entfernen: 01\.12\.2026 – 11\.12\.2026 „Block 2“/);
  await t.tool("einstellung_bestaetigen", { bestaetigungs_code: codeOf(r.text) });
  const sc = t.g.get(`${b}/meta/settings`).school;
  assert.deepEqual(sc.days, [4]);
  assert.equal(sc.blocks.length, 1); assert.equal(sc.blocks[0].label, "Block 3"); assert.ok(sc.blocks[0].id);
  // veraltet: in der App inzwischen geändert
  r = await t.tool("einstellung_aendern", { bereich: "arbeitszeit", werte: { arbeitstage: "Mo-Fr", wochenstunden: 40 } });
  assert.match(r.text, /Wochenstunden: 38,5 h → 40 h/);
  const c2 = codeOf(r.text);
  t.g.set(`${b}/meta/settings`, { ...t.g.get(`${b}/meta/settings`), weeklyTarget: 39 });
  r = await t.tool("einstellung_bestaetigen", { bestaetigungs_code: c2 });
  assert.equal(r.isError, true); assert.match(r.text, /inzwischen in der App geändert/);
  assert.equal(t.g.get(`${b}/meta/settings`).weeklyTarget, 39);
  // Galerie: aktive Kategorie (beide Felder wie die App)
  r = await t.tool("einstellung_aendern", { bereich: "galerie", werte: { aktive_kategorie: "privat" } });
  assert.match(r.text, /Neue Fotos gehen nach: Baustellen → Privat/);
  await t.tool("einstellung_bestaetigen", { bestaetigungs_code: codeOf(r.text) });
  assert.equal(t.g.get(`${b}/meta/settings`).gallery.activeFolderId, "f_privat");
  assert.equal(t.g.get(`${b}/meta/settings`).gallery.autoFolder, "f_privat");
  // verboten
  for (const [bereich, re] of [["Passwort-Tresor", /Tresor/], ["bank", /Bankverbindung/], ["Google-Konto", /Google-Konto/], ["App-Sperre", /App-Sperre/], ["iCal-Abos", /Kalender-Abos/], ["KI api key", /API-Schlüssel/]]) {
    r = await t.tool("einstellung_aendern", { bereich, werte: { x: 1 } });
    assert.equal(r.isError, true, bereich); assert.match(r.text, re);
  }
  r = await t.tool("einstellung_aendern", { bereich: "lehre", werte: { pin: "1234" } });
  assert.match(r.text, /App-Sperre/);
  r = await t.tool("einstellung_aendern", { bereich: "lehre", werte: { lieblingsfarbe: "rot" } });
  assert.match(r.text, /gibt es im Bereich Lehre nicht/);
  // Pending-Dokument mit manipuliertem Feld wird nicht übernommen
  t.g.set(`${b}/meta/ai_pending_settings`, { code: "ABCDEF", created: NOW, expires: NOW + 60000, area: "x", lines: [], patchJson: JSON.stringify({ lockscreen: { pinHash: "0000" } }), beforeJson: JSON.stringify({ lockscreen: { pinHash: "GEHEIMER_PIN_HASH" } }) });
  r = await t.tool("einstellung_bestaetigen", { bestaetigungs_code: "ABCDEF" });
  assert.equal(r.isError, true);
  assert.equal(t.g.get(`${b}/meta/settings`).lockscreen.pinHash, "GEHEIMER_PIN_HASH");
});

test("planer_bearbeiten: Termin verschieben (Dauer bleibt), Serie nur einmal, Rückfrage bei Serie, Aufgabe/Geburtstag/Countdown", async () => {
  const t = await seeded();
  const b = t.base;
  let r = await t.tool("planer_bearbeiten", { titel: "zahnarzt", datum: "13.11.2026", uhrzeit: "09:15", erinnerungen: [60, 1440] });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Jetzt: Fr, 13\.11\.2026 · 09:15–09:45 · Dr\. Huber · Erinnerung 60, 1440 min vorher/);
  const z = t.g.get(`${b}/todos/z1`);
  assert.deepEqual([z.date, z.time, z.endTime, z.remind, z.remindMin, z.reminders], ["2026-11-13", "09:15", "09:45", true, 60, [60, 1440]]);
  r = await t.tool("planer_bearbeiten", { titel: "Fußball", uhrzeit: "19:00" });
  assert.equal(r.isError, true); assert.match(r.text, /Serientermin .*nur diesen einen Termin/);
  r = await t.tool("planer_bearbeiten", { titel: "Fußball", umfang: "nur_diese", instanz_datum: "09.11.2026", uhrzeit: "19:00" });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /geändert \(nur am 09\.11\.2026\)/);
  const s1 = t.g.get(`${b}/todos/s1`);
  assert.equal(s1.time, "18:00");
  assert.equal(s1.overrides["2026-11-09"].time, "19:00");
  assert.equal(s1.overrides["2026-11-09"].endTime, "20:30");
  r = await t.tool("planer_lesen", { von: "09.11.2026", bis: "16.11.2026" });
  assert.match(r.text, /Mo, 09\.11\.2026\n {2}\[ \] 19:00 Termin: Fußballtraining–20:30 \(Serie\)/);
  assert.match(r.text, /Mo, 16\.11\.2026\n {2}\[ \] 18:00 Termin: Fußballtraining–19:30 \(Serie\)/);
  r = await t.tool("planer_bearbeiten", { id: "s1", umfang: "alle", wiederholung: "keine" });
  assert.match(r.text, /Wiederholung entfernt/);
  assert.equal(t.g.get(`${b}/todos/s1`).rrule, null);
  r = await t.tool("planer_bearbeiten", { titel: "Werkzeug", datum: "06.11.2026", countdown: true });
  assert.match(r.text, /Aufgabe geändert: „Werkzeug zurückgeben“ – fällig Fr, 06\.11\.2026, Countdown/);
  r = await t.tool("todo_anlegen", { titel: "Oma", art: "geburtstag", datum: "10.11.1950" });
  assert.match(r.text, /Geburtstag gespeichert: Oma am 10\.11\.1950, Erinnerung am Tag um 09:00/);
  const bd = t.g.list(`${b}/todos`).find((x) => x.kind === "geburtstag");
  assert.deepEqual([bd.bday, bd.byear], ["11-10", 1950]);
  r = await t.tool("planer_bearbeiten", { titel: "Oma", art: "geburtstag", datum: "11.11." });
  assert.match(r.text, /Oma am 11\.11\./);
  r = await t.tool("termin_anlegen", { titel: "LAP", datum: "15.03.2027", ganztags: true, countdown: true });
  assert.match(r.text, /mit Countdown/);
});

test("eintrag_bearbeiten: Zeiten/Notiz/Ort ändern, Abschnitte passen sich an, Abwesenheit nur Gutschrift", async () => {
  const t = await seeded();
  const b = t.base;
  let r = await t.tool("eintrag_bearbeiten", { datum: "03.11.2026", beginn: "06:45", notiz: "Zählerkasten", notiz_anhaengen: true });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Beginn 07:00 → 06:45 · Notiz ergänzt/);
  assert.match(r.text, /Jetzt: 06:45–16:00 · Pause 30 min · netto 8:45 h · Baustelle Huber · Notiz: Kabel gezogen · Zählerkasten/);
  r = await t.tool("eintrag_bearbeiten", { id: "e1", ende: "15:10", ort: "firma" });
  assert.match(r.text, /Ende 15:30 → 15:10/);
  const e1 = t.g.get(`${b}/entries/e1`);
  assert.equal(e1.end, vt(2026, 11, 2, 15, 10));
  assert.equal(e1.segments[2].end, vt(2026, 11, 2, 15, 10));
  assert.equal(e1.segments[1].place, "Firma Elektro Maier", "Arbeits-Abschnitt am alten Ort bekommt neuen Ort");
  assert.equal(e1.segments[0].place, "Firma Elektro Maier", "Fahrt behält ihren Startort");
  r = await t.tool("eintrag_bearbeiten", { id: "e2", beginn: "07:00" });
  assert.equal(r.isError, true);
  r = await t.tool("eintrag_bearbeiten", { id: "e2", gutschrift_h: 4 });
  assert.match(r.text, /Gutschrift 7:42 → 4:00 h/);
  r = await t.tool("eintrag_bearbeiten", { datum: "04.11.2026", notiz: "x" });
  assert.equal(r.isError, true);
});

test("geld_eintragen + geld_lesen: Budget, Sparziel, Einzahlung, Teilen, Kontostand ohne Geheimnisse", async () => {
  const t = await seeded();
  const b = t.base;
  let r = await t.tool("geld_eintragen", { aktion: "budget", betrag: 300 });
  assert.match(r.text, /Budget Gesamt: 300,00 € pro Monat/);
  r = await t.tool("geld_eintragen", { aktion: "budget", kategorie: "Essen gehen", betrag: "60" });
  assert.equal(r.isError, false, r.text);
  r = await t.tool("geld_eintragen", { aktion: "einzahlung", name: "moped", betrag: 100 });
  assert.match(r.text, /Eingezahlt: 100,00 € – „Moped“ jetzt 600,00 € von 2\.000,00 € \(30 %\)/);
  r = await t.tool("geld_eintragen", { aktion: "einzahlung", name: "moped", betrag: -50 });
  assert.match(r.text, /Entnommen: 50,00 €/);
  assert.equal(t.g.get(`${b}/a_money_goals/g1`).saved, 550);
  r = await t.tool("geld_eintragen", { aktion: "sparziel", name: "Führerschein", ziel_betrag: 1800, bis: "01.09.2027" });
  assert.match(r.text, /Sparziel angelegt: 🎯 Führerschein – 0,00 € von 1\.800,00 €/);
  r = await t.tool("geld_eintragen", { aktion: "teilen", gruppe: "WG", beschreibung: "Einkauf", betrag: 40, bezahlt_von: "Max" });
  assert.match(r.text, /bezahlt von Max, geteilt durch 2 \(20,00 € pro Person\)/);
  assert.match(r.text, /Stand: Du schuldest Max 5,00 €\./);
  r = await t.tool("geld_eintragen", { aktion: "teilen", gruppe: "Skiurlaub", personen: ["Lisa"], betrag: 90, beschreibung: "Hütte" });
  assert.match(r.text, /neue Gruppe mit Lisa/);
  r = await t.tool("geld_lesen", {});
  assert.match(r.text, /Moped: 550,00 € von 2\.000,00 € .* pro Monat nötig/);
  assert.match(r.text, /Teilen \(Gruppen\):/);
  assert.match(r.text, /Bankkonto \(BAWAG, ••4711\): Kontostand 1\.234,56 €/);
  assert.ok(!/SESSION-GEHEIM|acc-uid-geheim/.test(r.text));
});

test("schule: Bereiche lesen, Note/Stunde/Projektschritt eintragen", async () => {
  const t = await seeded();
  let r = await t.tool("schule_lesen", { bereich: "stundenplan" });
  assert.match(r.text, /Donnerstag:\n- 1\.–2\. Std 08:00–09:40 Elektrotechnik · Raum E12 · Mag\. Berger \(ID l1\)/);
  r = await t.tool("schule_lesen", { bereich: "projekte" });
  assert.match(r.text, /„Schaltplan Einfamilienhaus“ – 1\/2 Schritte/);
  r = await t.tool("schule_lesen", { bereich: "dokumente" });
  assert.match(r.text, /Formelsammlung · Elektrotechnik · pdf · 200 KB/);
  assert.ok(!r.text.includes("base64"));
  for (const q of reqs(t, /a_school_docs/)) assert.match(q.url, /mask\.fieldPaths=title/);
  r = await t.tool("schule_eintragen", { aktion: "note", fach: "elektro", note: 2, art: "Schularbeit" });
  assert.match(r.text, /Note eingetragen: Elektrotechnik 2 \(Schularbeit, ×2\).*Schnitt Elektrotechnik jetzt 2,00/);
  r = await t.tool("schule_eintragen", { aktion: "stunde", wochentag: "Do", stunde: 3, fach: "Deutsch", raum: "B4" });
  assert.match(r.text, /Stundenplan ergänzt: Donnerstag 3\. Stunde \(09:55–10:45\) Deutsch · Raum B4/);
  r = await t.tool("schule_eintragen", { aktion: "stunde", wochentag: "Do", stunde: 2, fach: "Mathe" });
  assert.match(r.text, /überschneidet sich mit Elektrotechnik/);
  r = await t.tool("schule_eintragen", { aktion: "projekt_schritt", projekt: "schaltplan", schritt: "stromkreise" });
  assert.match(r.text, /Erledigt ☑: Stromkreise planen – Projekt „Schaltplan Einfamilienhaus“: 2\/2 Schritte/);
  r = await t.tool("schule_lesen", {});
  assert.ok(!/Offene Projekte/.test(r.text));
});

test("berichtsheft_notiz: speichern/anhängen, erscheint im Wochenbericht", async () => {
  const t = await seeded();
  let r = await t.tool("berichtsheft_notiz", { woche: "diese", text: "Verteiler montiert" });
  assert.match(r.text, /Berichtsheft KW 45 \(02\.11\.2026 – 08\.11\.2026\): Ergänzung gespeichert/);
  r = await t.tool("berichtsheft_notiz", { text: "Zählerplatz gesetzt" });
  assert.match(r.text, /ergänzt/);
  const st = t.g.get(`${t.base}/meta/settings`);
  assert.equal(st.apprentice.notes["2026-W45"], "Verteiler montiert\nZählerplatz gesetzt");
  assert.equal(st.apprentice.notes["2026-W44"], "FI-Schutzschalter geprüft");
  assert.equal(st.apprentice.company, "Elektro Maier");
  r = await t.tool("wochen_zusammenfassung", {});
  assert.match(r.text, /Ergänzungen zur Woche: Verteiler montiert/);
});

test("galerie_bearbeiten: Album umbenennen/Kategorie, Foto-Notiz (Foto + Index, ohne Bild zu laden)", async () => {
  const t = await seeded();
  const b = t.base;
  let r = await t.tool("galerie_bearbeiten", { aktion: "album_umbenennen", album: "huber", neuer_name: "Huber – Neubau" });
  assert.match(r.text, /„Huber Hauptstraße“ → „Huber – Neubau“/);
  r = await t.tool("galerie_bearbeiten", { aktion: "album_kategorie", album: "urlaub", kategorie: "keine" });
  assert.match(r.text, /hat jetzt keine Kategorie/);
  assert.equal(t.g.get(`${b}/a_photo_albums/al2`).folderId, null);
  r = await t.tool("galerie_bearbeiten", { aktion: "foto_notiz", foto_id: "ph2", notiz: "Verteiler nachher" });
  assert.match(r.text, /Notiz zum Foto vom 02\.11\.2026 gespeichert/);
  assert.equal(t.g.get(`${b}/photos/ph2`).note, "Verteiler nachher");
  assert.equal(t.g.get(`${b}/photos/ph2`).data, THUMB + "_GROSS", "Bild bleibt unverändert");
  assert.equal(t.g.get(`${b}/a_photo_index/ph2`).note, "Verteiler nachher");
  assert.equal(reqs(t, /\/photos(\/|\?|$)/).filter((x) => x.method === "GET").length, 0);
});

test("Album löschen, Fotos behalten – nur zweistufig, Papierkorb stellt Album samt Zuordnung wieder her", async () => {
  const t = await seeded();
  const b = t.base;
  let r = await t.tool("loeschen_vorschlagen", { was: "album", suche: "Urlaub" });
  assert.match(r.text, /Album „Urlaub“ · 2 Fotos \(die Fotos bleiben erhalten\)/);
  assert.ok(t.g.get(`${b}/a_photo_albums/al2`), "Vorschlag löscht nichts");
  r = await t.tool("loeschen_bestaetigen", { bestaetigungs_code: codeOf(r.text) });
  assert.match(r.text, /Gelöscht: 1 Element/);
  assert.equal(t.g.get(`${b}/a_photo_albums/al2`), null);
  assert.ok(t.g.get(`${b}/photos/ph3`), "Foto bleibt");
  assert.deepEqual(t.g.get(`${b}/photos/ph2`).albumIds, ["al1"]);
  assert.deepEqual(t.g.get(`${b}/a_photo_index/ph3`).albumIds, []);
  assert.equal(t.g.get(`${b}/photos/ph3`).data, THUMB + "_GROSS");
  // nur schlanke Listen der Fotos (Feldmaske albumIds)
  for (const q of reqs(t, /\/photos\?/)) assert.match(q.url, /mask\.fieldPaths=albumIds/);
  const tr = t.g.list(`${b}/a_trash`);
  assert.equal(tr.length, 1); assert.deepEqual(tr[0].photoIds.sort(), ["ph2", "ph3"]);
  r = await t.tool("rueckgaengig", {});
  assert.match(r.text, /Wiederhergestellt: 1 Element/);
  assert.ok(t.g.get(`${b}/a_photo_albums/al2`));
  assert.deepEqual(t.g.get(`${b}/photos/ph2`).albumIds, ["al1", "al2"]);
  assert.deepEqual(t.g.get(`${b}/a_photo_index/ph3`).albumIds, ["al2"]);
  r = await t.tool("loeschen_vorschlagen", { was: "fotos", suche: "Strand" });
  assert.equal(r.isError, true); assert.match(r.text, /Fotos kann ich nicht löschen.*Album/);
});

test("suche: findet quer durch die App, nie im Tresor", async () => {
  const t = await seeded();
  let r = await t.tool("suche", { text: "Huber" });
  assert.equal(r.isError, false, r.text);
  for (const area of ["Arbeitszeit:", "Planer:", "Orte:", "Material:", "Adressen:", "Galerie:"]) assert.ok(r.text.includes(area), area + "\n" + r.text);
  assert.ok(!r.text.includes("WLAN"));
  assert.equal(reqs(t, /a_vault/).length, 0, "Tresor wird nie gelesen");
  r = await t.tool("suche", { text: "FI-Schutzschalter" });
  assert.match(r.text, /Berichtsheft:\n- 2026 KW 44/);
  r = await t.tool("suche", { text: "Passwort WLAN" });
  assert.match(r.text, /Passwort-Tresor kann ich nicht durchsuchen/);
});

test("material_status: Status setzen, verbaut zählt heute", async () => {
  const t = await seeded();
  const r = await t.tool("material_status", { name: "schuko", status: "verbaut" });
  assert.match(r.text, /Material 3× Schuko-Steckdose \(Baustelle Huber\): brauche → verbaut/);
  const m = t.g.get(`${t.base}/a_material_items/m1`);
  assert.deepEqual([m.status, m.dayKey], ["verbaut", "2026-11-04"]);
});
