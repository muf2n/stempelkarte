// node --test test/gallery.test.mjs
// Galerie: Alben-Zuordnung (Radius, Ort vor Adresse), Namen aus Nominatim-Antworten (AT), EXIF, Index-Abgleich.
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../js/gallery-core.js";

const GRAMBACH = { lat: 47.01098, lng: 15.50511 };    // Thomas-Arbesser-Straße, Grambach
const move = (p, dLatM, dLngM = 0) => ({ lat: p.lat + dLatM / 111320, lng: p.lng + dLngM / (111320 * Math.cos(p.lat * Math.PI / 180)) });

test("Haversine: 2 km nach Norden ≈ 2000 m", () => {
  const d = G.distanceM(GRAMBACH, move(GRAMBACH, 2000));
  assert.ok(Math.abs(d - 2000) < 5, String(d));
});

test("matchLocation: Adress-Album im Radius, außerhalb → neu, nächstes gewinnt", () => {
  const a1 = { id: "a1", kind: "address", lat: GRAMBACH.lat, lng: GRAMBACH.lng, radius: 80 };
  const a2 = { id: "a2", kind: "address", ...move(GRAMBACH, 120), radius: 80 };
  const albums = [a1, a2];
  assert.equal(G.matchLocation(move(GRAMBACH, 30), { albums }).album.id, "a1");
  assert.equal(G.matchLocation(move(GRAMBACH, 79), { albums }).album.id, "a2", "näher an a2 (41 m) als an a1 (79 m)");
  assert.equal(G.matchLocation(move(GRAMBACH, 2000), { albums }).type, "new");
  assert.equal(G.matchLocation(move(GRAMBACH, -90), { albums }).type, "new", "90 m > 80 m Radius");
  // Radius je Album
  assert.equal(G.matchLocation(move(GRAMBACH, -90), { albums: [{ ...a1, radius: 150 }] }).type, "address");
  // eigene Alben ohne Position zählen nicht
  assert.equal(G.matchLocation(GRAMBACH, { albums: [{ id: "c", kind: "custom", lat: GRAMBACH.lat, lng: GRAMBACH.lng }] }).type, "new");
  assert.equal(G.matchLocation(null, { albums }).type, "none");
  assert.equal(G.matchLocation({ lat: NaN, lng: 1 }, { albums }).type, "none");
});

test("matchLocation: gespeicherter Ort hat Vorrang vor Adress-Album", () => {
  const place = { id: "p1", name: "Baustelle Grambach", lat: GRAMBACH.lat, lng: GRAMBACH.lng, radius: 150 };
  const addr = { id: "a1", kind: "address", ...move(GRAMBACH, 20), radius: 80 };
  let m = G.matchLocation(move(GRAMBACH, 25), { places: [place], albums: [addr] });
  assert.equal(m.type, "place");
  assert.equal(m.place.id, "p1");
  assert.equal(m.album, null, "Ort-Album noch nicht angelegt");
  const pa = { id: "pa", kind: "place", placeId: "p1", name: "Baustelle Grambach" };
  m = G.matchLocation(move(GRAMBACH, 25), { places: [place], albums: [addr, pa] });
  assert.equal(m.album.id, "pa");
  // außerhalb des Ort-Radius → Adress-Album
  m = G.matchLocation(move(GRAMBACH, 170), { places: [place], albums: [{ ...addr, ...move(GRAMBACH, 180) }] });
  assert.equal(m.type, "address");
  // Ort ohne Koordinaten wird ignoriert; Standardradius 150 m
  m = G.matchLocation(move(GRAMBACH, 140), { places: [{ id: "x", name: "Firma" }, { id: "p2", lat: GRAMBACH.lat, lng: GRAMBACH.lng }] });
  assert.equal(m.type, "place");
  assert.equal(m.place.id, "p2");
});

test("Album-Namen aus Nominatim (Österreich)", () => {
  const grambach = {
    display_name: "1, Thomas-Arbesser-Straße, Grambach, Bezirk Graz-Umgebung, Steiermark, 8074, Österreich",
    address: { house_number: "1", road: "Thomas-Arbesser-Straße", village: "Grambach", municipality: "Grambach", county: "Bezirk Graz-Umgebung", state: "Steiermark", postcode: "8074", country: "Österreich", country_code: "at" },
  };
  assert.equal(G.albumNameFrom(grambach), "Thomas-Arbesser-Straße 1, Grambach");
  assert.equal(G.fullAddrFrom(grambach), "Thomas-Arbesser-Straße 1, 8074 Grambach");

  const graz = { address: { house_number: "1", road: "Hauptplatz", suburb: "Innere Stadt", city_district: "Innere Stadt", city: "Graz", state: "Steiermark", postcode: "8010", country: "Österreich" } };
  assert.equal(G.albumNameFrom(graz), "Hauptplatz 1, Graz");

  const seiersberg = { address: { house_number: "10", road: "Am Seiersberg", town: "Seiersberg-Pirka", municipality: "Seiersberg-Pirka", postcode: "8055" } };
  assert.equal(G.albumNameFrom(seiersberg), "Am Seiersberg 10, Seiersberg-Pirka");

  // ohne Hausnummer → Straße, Ort
  const pirka = { address: { road: "Feldkirchner Straße", village: "Pirka", municipality: "Seiersberg-Pirka", postcode: "8054" } };
  assert.equal(G.albumNameFrom(pirka), "Feldkirchner Straße, Pirka");
  // ohne Straße → Ort (Stadtteil bei Städten)
  assert.equal(G.albumNameFrom({ address: { village: "Grambach", postcode: "8074" } }), "Grambach");
  assert.equal(G.albumNameFrom({ address: { suburb: "Lend", city: "Graz" } }), "Lend, Graz");
  // nur display_name
  assert.equal(G.albumNameFrom({ display_name: "Murradweg, Gössendorf, Bezirk Graz-Umgebung, Steiermark" }), "Murradweg, Gössendorf");
  assert.equal(G.albumNameFrom(null), null);
  assert.equal(G.albumNameFrom({ error: "Unable to geocode" }), null);
  assert.match(G.coordName(GRAMBACH), /^Standort 47,0110 \/ 15,5051$/);
});

test("EXIF: DateTimeOriginal + GPS aus winzigem JPEG", () => {
  const seg = G.buildExifSegment({ date: "2026:10:14 09:41:07", lat: 47.010983, lng: 15.505112 });
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xD9]);
  const withExif = G.injectExif(jpeg, seg);
  const r = G.readExif(withExif.buffer);
  assert.equal(r.ts, new Date(2026, 9, 14, 9, 41, 7).getTime());
  assert.ok(Math.abs(r.lat - 47.010983) < 1e-5, String(r.lat));
  assert.ok(Math.abs(r.lng - 15.505112) < 1e-5, String(r.lng));
  // Süd/West
  const sw = G.readExif(G.injectExif(jpeg, G.buildExifSegment({ date: "2025:01:02 03:04:05", lat: -33.5, lng: -70.25 })));
  assert.ok(Math.abs(sw.lat + 33.5) < 1e-6 && Math.abs(sw.lng + 70.25) < 1e-6);
  // nur Datum
  const d = G.readExif(G.injectExif(jpeg, G.buildExifSegment({ date: "2024:12:24 18:00:00" })));
  assert.equal(d.ts, new Date(2024, 11, 24, 18).getTime());
  assert.equal(d.lat, undefined);
  // kein EXIF / Unsinn
  assert.deepEqual(G.readExif(jpeg), {});
  assert.deepEqual(G.readExif(new Uint8Array([1, 2, 3])), {});
  const broken = G.injectExif(jpeg, G.buildExifSegment({ date: "2026:10:14 09:41:07", lat: 1, lng: 1 }).slice(0, 30));
  assert.doesNotThrow(() => G.readExif(broken));
});

test("Index-Dokument: ohne großes Bild, Abweichung erkennen", () => {
  const photo = { id: "ph1", ts: 1, dayKey: "2026-11-05", data: "data:image/jpeg;base64,AAAA", thumb: "data:t", note: "Verteiler", placeId: null, place: "", albumIds: ["a1", "a1", ""], lat: 47, lng: 15, addr: "X 1, 8074 Grambach", w: 10, h: 20 };
  const d = G.indexDoc(photo);
  assert.equal(d.data, undefined, "kein data im Index");
  assert.equal(d.thumb, "data:t");
  assert.deepEqual(d.albumIds, ["a1"]);
  for (const k of Object.keys(d)) assert.ok(G.INDEX_FIELDS.includes(k), k);
  assert.equal(G.indexDiffers(d, G.indexDoc({ ...photo })), false);
  assert.equal(G.indexDiffers(d, G.indexDoc({ ...photo, note: "neu" })), true);
  assert.equal(G.indexDiffers(d, G.indexDoc({ ...photo, albumIds: ["a1", "a2"] })), true);
  assert.equal(G.indexDiffers(d, G.indexDoc({ ...photo, data: "anders" })), false, "data ist egal");
  assert.equal(G.indexDiffers(d, null), true);
});

test("Backfill-Plan: fehlende und verwaiste Index-Einträge", () => {
  const r = G.planBackfill(["a", "b", "c"], ["b", "x"]);
  assert.deepEqual(r.missing.sort(), ["a", "c"]);
  assert.deepEqual(r.orphans, ["x"]);
  assert.deepEqual(G.planBackfill([], []), { missing: [], orphans: [] });
});

test("albumIds ändern, Zusammenführen, Migration, Ohne Ort", () => {
  assert.deepEqual(G.changeIds(["a", "b"], "c", "a"), ["b", "c"]);
  assert.deepEqual(G.changeIds(["a"], ["a", "b"]), ["a", "b"]);
  assert.deepEqual(G.changeIds(undefined, "x"), ["x"]);
  assert.deepEqual(G.cleanIds(["x", G.OHNE_ORT, "x", null]), ["x"]);

  const items = [{ id: "1", albumIds: ["A"] }, { id: "2", albumIds: ["A", "B"] }, { id: "3", albumIds: ["C"] }];
  assert.deepEqual(G.mergePlan(items, "A", "B"), [{ id: "1", albumIds: ["B"] }, { id: "2", albumIds: ["B"] }]);
  assert.deepEqual(G.mergePlan(items, "A", "A"), []);

  const albums = [{ id: "PA", kind: "place", placeId: "p1" }];
  const mig = G.migrationPlan([
    { id: "1", placeId: "p1", albumIds: [] },          // → zuordnen
    { id: "2", placeId: "p1", albumIds: ["PA"] },      // schon drin
    { id: "3", placeId: "p2", albumIds: [] },          // Ort-Album fehlt → zuordnen (wird angelegt)
    { id: "4", placeId: "p1", albumIds: [], albMig: true }, // schon erledigt (bewusst entfernt)
    { id: "5", placeId: null, albumIds: [] },
  ], albums);
  assert.deepEqual(mig, [{ id: "1", placeId: "p1" }, { id: "3", placeId: "p2" }]);

  const am = new Map([["AD", { id: "AD", kind: "address" }], ["CU", { id: "CU", kind: "custom" }]]);
  assert.equal(G.isOhneOrt({ id: "x", albumIds: [] }, am), true);
  assert.equal(G.isOhneOrt({ id: "x", albumIds: ["CU"] }, am), true, "eigenes Album ist kein Ort");
  assert.equal(G.isOhneOrt({ id: "x", albumIds: ["AD"] }, am), false);
  assert.equal(G.isOhneOrt({ id: "x", albumIds: [], lat: 47, lng: 15 }, am), false);
  assert.deepEqual(G.itemsOfAlbum([{ id: "x", albumIds: [] }, { id: "y", albumIds: ["AD"] }], G.OHNE_ORT, am).map((i) => i.id), ["x"]);
});

test("Gruppieren nach Monat/Tag, Filtern & Suche, Album-Statistik", () => {
  const items = [
    { id: "1", ts: new Date(2026, 10, 5, 9).getTime(), dayKey: "2026-11-05", note: "Verteiler vorher", addr: "Thomas-Arbesser-Straße 1, 8074 Grambach", albumIds: ["A"] },
    { id: "2", ts: new Date(2026, 10, 5, 12).getTime(), dayKey: "2026-11-05", note: "", addr: "", albumIds: ["B"] },
    { id: "3", ts: new Date(2026, 9, 30, 8).getTime(), dayKey: "2026-10-30", note: "Zählerkasten", addr: "Hauptplatz 1, 8010 Graz", albumIds: [] },
  ];
  const g = G.groupByMonthDay(items);
  assert.deepEqual(g.map((m) => m.label), ["November 2026", "Oktober 2026"]);
  assert.deepEqual(g[0].days[0].items.map((i) => i.id), ["2", "1"], "neueste zuerst");
  const am = new Map([["A", { id: "A", name: "Thomas-Arbesser-Straße 1, Grambach", kind: "address" }], ["B", { id: "B", name: "Verteiler", kind: "custom" }]]);
  const ids = (f) => G.filterItems(items, f, am).map((i) => i.id).sort();
  assert.deepEqual(ids({ albumId: "A" }), ["1"]);
  assert.deepEqual(ids({ from: "2026-11-01" }), ["1", "2"]);
  assert.deepEqual(ids({ to: "2026-10-31" }), ["3"]);
  assert.deepEqual(ids({ q: "grambach" }), ["1"]);
  assert.deepEqual(ids({ q: "zaehler" }), ["3"], "Umlaut-unabhängig");
  assert.deepEqual(ids({ q: "verteiler" }), ["1", "2"], "Notiz oder Album-Name");
  assert.deepEqual(ids({ q: "arbesser str." }), ["1"], "„Str.“ = „Straße“");
  assert.deepEqual(ids({ q: "graz verteiler" }), [], "alle Wörter müssen passen");
  const st = G.albumStats(items, { id: "A" }, am);
  assert.equal(st.count, 1);
  assert.equal(st.coverItem.id, "1");
  assert.equal(G.albumStats(items, { id: "B", cover: "nope" }, am).coverItem.id, "2");
});

test("normAlbum + Maps-Link", () => {
  const a = G.normAlbum({ id: "x", kind: "address", name: " Hauptplatz 1, Graz ", lat: 47.07, lng: 15.43, radius: "abc" });
  assert.equal(a.name, "Hauptplatz 1, Graz");
  assert.equal(a.radius, 80);
  assert.equal(G.normAlbum({ id: "y", kind: "foo" }).kind, "custom");
  assert.equal(G.normAlbum(null), null);
  assert.equal(G.albumMapsUrl(a), "https://www.google.com/maps/search/?api=1&query=47.07,15.43");
  assert.match(G.albumMapsUrl({ name: "Hauptplatz 1, Graz" }), /query=Hauptplatz%201%2C%20Graz$/);
});

/* ---------- Hauptkategorien (Agent T) ---------- */

const FOLDERS = G.DEFAULT_FOLDERS.map((f) => G.normFolder(f));

test("Kategorien: normFolder + Sortierung", () => {
  assert.equal(G.normFolder(null), null);
  const f = G.normFolder({ id: "x", name: "  ", color: "rot" });
  assert.equal(f.name, "Kategorie");
  assert.equal(f.emoji, "📁");
  assert.match(f.color, /^#[0-9a-f]{6}$/i);
  const s = G.sortFolders([{ id: "b", name: "B", order: 2 }, { id: "a", name: "A", order: 0 }, { id: "c", name: "C", order: 2, created: -1 }]);
  assert.deepEqual(s.map((x) => x.id), ["a", "c", "b"]);
});

test("Kategorien: Berufsschul-Erkennung", () => {
  for (const n of ["Landesberufsschule Graz 4", "LBS Fürstenfeld", "Berufsschule", "lbs graz"]) assert.ok(G.isSchoolName(n), n);
  for (const n of ["Baustelle Liebenau", "Albstraße 3", "Elbsee", "Firma Elektro Maier"]) assert.ok(!G.isSchoolName(n), n);
});

test("Kategorien: Auto-Kategorie für neue Alben", () => {
  assert.equal(G.resolveAutoFolder(FOLDERS, undefined), G.BAU_ID, "Standard = Baustellen");
  assert.equal(G.resolveAutoFolder(FOLDERS, ""), null, "„keine“");
  assert.equal(G.resolveAutoFolder(FOLDERS, G.PRIVAT_ID), G.PRIVAT_ID);
  assert.equal(G.resolveAutoFolder(FOLDERS, "weg"), null, "gelöschte Kategorie → keine");
  assert.equal(G.resolveAutoFolder([], undefined), null, "ohne Baustellen → keine");
  assert.equal(G.resolveAutoFolder([{ id: "u1", name: "Meine Baustellen" }], undefined), "u1", "Baustellen per Name");

  const addr = { kind: "address", name: "Hauptplatz 1, Graz" };
  assert.equal(G.folderForNewAlbum(addr, { folders: FOLDERS }), G.BAU_ID);
  assert.equal(G.folderForNewAlbum(addr, { folders: FOLDERS, autoFolder: G.PRIVAT_ID }), G.PRIVAT_ID);
  assert.equal(G.folderForNewAlbum({ kind: "custom", name: "Verteiler" }, { folders: FOLDERS }), null, "eigene Alben nie automatisch");
  assert.equal(G.folderForNewAlbum({ kind: "place", name: "LBS Graz" }, { folders: FOLDERS }), G.SCHULE_ID, "Berufsschul-Ort → Berufsschule");
  assert.equal(G.folderForNewAlbum({ kind: "place", name: "Schulort" }, { folders: FOLDERS, place: { name: "Landesberufsschule" } }), G.SCHULE_ID);
  assert.equal(G.folderForNewAlbum({ kind: "place", name: "LBS Graz" }, { folders: [FOLDERS[0]] }), G.BAU_ID, "ohne Berufsschul-Kategorie → Auto");
  assert.equal(G.folderForNewAlbum({ kind: "place", name: "Firma" }, { folders: FOLDERS, autoFolder: "" }), null);
});

test("Kategorien: erster Start (Migration) nur einmal", () => {
  const albums = [
    { id: "a1", kind: "address", name: "Hauptplatz 1, Graz" },
    { id: "a2", kind: "place", placeId: "pS", name: "Schule" },
    { id: "a3", kind: "place", placeId: "pF", name: "Firma" },
    { id: "a4", kind: "custom", name: "Verteiler" },
    { id: "a5", kind: "address", name: "Schon sortiert", folderId: G.PRIVAT_ID },
  ];
  const places = [{ id: "pS", name: "Landesberufsschule Graz" }, { id: "pF", name: "Firma Elektro Maier" }];
  const plan = G.folderMigration({ folders: [], albums, places });
  assert.deepEqual(plan.create.map((f) => f.id), [G.BAU_ID, G.SCHULE_ID, G.PRIVAT_ID], "Standard-Kategorien");
  assert.deepEqual(plan.create.map((f) => f.emoji + " " + f.name), ["🏗️ Baustellen", "🏫 Berufsschule", "🏠 Privat"]);
  assert.deepEqual(plan.assign, [{ id: "a1", folderId: G.BAU_ID }, { id: "a2", folderId: G.SCHULE_ID }, { id: "a3", folderId: G.BAU_ID }],
    "Adress-/Ort-Alben → Baustellen, Berufsschul-Ort → Berufsschule, eigene + schon sortierte bleiben");
  // Flag gesetzt → nie wieder (gelöschte Standard-Kategorien kommen nicht zurück)
  assert.equal(G.folderMigration({ initialized: true, folders: [], albums, places }), null);
  // eigene Kategorien schon da → keine Standard-Kategorien anlegen, ohne „Baustellen“ nichts zuordnen
  const own = G.folderMigration({ folders: [{ id: "w", name: "Werkzeug & Material" }], albums, places });
  assert.equal(own.create.length, 0);
  assert.equal(own.assign.length, 0);
  // eigene „Baustellen“-Kategorie wird genutzt
  const own2 = G.folderMigration({ folders: [{ id: "b", name: "Baustellen 2026" }], albums: albums.slice(0, 1) });
  assert.deepEqual(own2.assign, [{ id: "a1", folderId: "b" }]);
  // ungültige folderId (Kategorie gelöscht) zählt als ohne
  assert.deepEqual(G.folderMigration({ folders: FOLDERS, albums: [{ id: "z", kind: "address", folderId: "weg" }] }).assign, [{ id: "z", folderId: G.BAU_ID }]);
});

test("Kategorien: Zuordnung, Statistik, Filter", () => {
  const ids = new Set(FOLDERS.map((f) => f.id));
  const albums = [
    { id: "a1", kind: "address", folderId: G.BAU_ID, name: "A1" },
    { id: "a2", kind: "address", folderId: G.BAU_ID, name: "A2" },
    { id: "a3", kind: "custom", folderId: G.PRIVAT_ID, name: "A3" },
    { id: "a4", kind: "custom", name: "A4" },
    { id: "a5", kind: "custom", folderId: "geloescht", name: "A5" },
  ].map(G.normAlbum);
  const m = new Map(albums.map((a) => [a.id, a]));
  const items = [
    { id: "p1", ts: 1, albumIds: ["a1"] }, { id: "p2", ts: 5, albumIds: ["a1", "a2"] }, { id: "p3", ts: 3, albumIds: ["a2"] },
    { id: "p4", ts: 4, albumIds: ["a3"] }, { id: "p5", ts: 2, albumIds: ["a4"] }, { id: "p6", ts: 6, albumIds: [] },
    { id: "p7", ts: 7, albumIds: ["a5"] },
  ];
  assert.equal(G.albumFolderId(albums[0], ids), G.BAU_ID);
  assert.equal(G.albumFolderId(albums[4], ids), G.OHNE_KAT, "gelöschte Kategorie → Ohne Kategorie");
  assert.deepEqual(G.albumsInFolder(albums, G.OHNE_KAT, ids).map((a) => a.id), ["a4", "a5"]);
  const st = G.folderStats(items, G.BAU_ID, albums, ids, m);
  assert.equal(st.albums, 2);
  assert.equal(st.count, 3, "p2 in zwei Alben zählt einmal");
  assert.equal(st.last, 5);
  assert.deepEqual(st.covers.map((x) => x.id), ["p2", "p3", "p1"], "Mosaik: Album-Titelbilder, dann neueste");
  assert.equal(G.folderStats(items, G.SCHULE_ID, albums, ids, m).count, 0);
  assert.deepEqual(G.filterItems(items, { folderId: G.BAU_ID }, m, ids).map((x) => x.id).sort(), ["p1", "p2", "p3"]);
  assert.deepEqual(G.filterItems(items, { folderId: G.OHNE_KAT }, m, ids).map((x) => x.id).sort(), ["p5", "p6", "p7"]);
  assert.deepEqual(G.filterItems(items, { folderId: G.BAU_ID, albumId: "a2" }, m, ids).map((x) => x.id).sort(), ["p2", "p3"]);
});

test("Kategorien: Reihenfolge + Löschen", () => {
  const fs = [{ id: "x", order: 0 }, { id: "y", order: 1 }, { id: "z", order: 2 }];
  assert.deepEqual(G.moveFolderPlan(fs, "z", -1), [{ id: "z", order: 1 }, { id: "y", order: 2 }]);
  assert.deepEqual(G.moveFolderPlan(fs, "x", -1), [], "ganz oben bleibt");
  assert.deepEqual(G.moveFolderPlan(fs, "z", 1), [], "ganz unten bleibt");
  // gleiche order (z. B. alte Daten) → sauber durchnummeriert
  const same = [{ id: "x", order: 0, created: 1 }, { id: "y", order: 0, created: 2 }];
  assert.deepEqual(G.moveFolderPlan(same, "y", -1), [{ id: "x", order: 1 }], "y behält 0, x wird 1");
  assert.equal(G.nextFolderOrder(fs), 3);
  assert.equal(G.nextFolderOrder([]), 0);
  const albums = [{ id: "a1", folderId: "x" }, { id: "a2", folderId: "y" }, { id: "a3", folderId: "x" }];
  assert.deepEqual(G.deleteFolderPlan(albums, "x"), [{ id: "a1", folderId: null }, { id: "a3", folderId: null }], "→ Ohne Kategorie");
  assert.deepEqual(G.deleteFolderPlan(albums, "x", "y"), [{ id: "a1", folderId: "y" }, { id: "a3", folderId: "y" }], "→ andere Kategorie");
  assert.deepEqual(G.deleteFolderPlan(albums, "x", "x"), [{ id: "a1", folderId: null }, { id: "a3", folderId: null }], "Ziel = sich selbst → Ohne");
});

/* ---------- Update 9 (Agent U): aktive Kategorie ---------- */

const FS = [
  { id: G.BAU_ID, name: "Baustellen", emoji: "🏗️" },
  { id: G.SCHULE_ID, name: "Berufsschule", emoji: "🏫" },
  { id: "fW", name: "Wohnungen", emoji: "🏠" },
];

test("Aktive Kategorie: Einstellung, Standard, alte autoFolder-Einstellung", () => {
  assert.deepEqual(G.resolveActiveFolder({ folders: FS, gallery: {} }).id, G.BAU_ID, "fehlt → Baustellen");
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: {} }).source, "default");
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: { activeFolderId: "fW" } }).id, "fW");
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: { activeFolderId: "fW" } }).source, "manual");
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: { autoFolder: "fW" } }).id, "fW", "alte Einstellung gilt weiter");
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: { autoFolder: "fW", activeFolderId: G.BAU_ID } }).id, G.BAU_ID, "activeFolderId hat Vorrang");
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: { activeFolderId: "" } }).id, null, "\"\" = keine");
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: { activeFolderId: "weg" } }).id, null, "gelöschte Kategorie → keine");
  assert.equal(G.activeSetting({ autoFolder: "" }), "");
  assert.equal(G.activeSetting(null), undefined);
});

test("Aktive Kategorie: Ort mit Foto-Kategorie überschreibt, solange eingestempelt", () => {
  const places = [{ id: "pX", name: "Firma X", photoFolderId: "fW" }, { id: "pY", name: "Ohne", photoFolderId: "" }, { id: "pZ", name: "Alt", photoFolderId: "weg" }];
  const g = { activeFolderId: G.BAU_ID };
  const r = G.resolveActiveFolder({ folders: FS, gallery: g, placeId: "pX", places });
  assert.equal(r.id, "fW"); assert.equal(r.source, "place"); assert.equal(r.place.name, "Firma X"); assert.equal(r.manualId, G.BAU_ID);
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: g, placeId: "pX", places, ignorePlace: true }).id, G.BAU_ID, "für die Schicht ausgeschaltet");
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: g, placeId: "pY", places }).source, "manual", "Ort ohne Foto-Kategorie");
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: g, placeId: "pZ", places }).id, G.BAU_ID, "ungültige Foto-Kategorie ignoriert");
  assert.equal(G.resolveActiveFolder({ folders: FS, gallery: g, placeId: null, places }).id, G.BAU_ID, "nicht eingestempelt");
  assert.equal(G.runningPlaceId({ placeId: "a", segments: [{ placeId: "b" }, { placeId: "c" }] }), "c", "letzter Abschnitt");
  assert.equal(G.runningPlaceId({ placeId: "a", segments: [{ placeId: null }] }), "a");
  assert.equal(G.runningPlaceId(null), null);
});

test("Regel: neues Adress-Album → aktive Kategorie; Ort-Album → Foto-Kategorie des Orts vor Schule", () => {
  const addr = { kind: "address", name: "Musterstraße 5, Graz" };
  assert.equal(G.folderForNewAlbum(addr, { folders: FS, activeFolderId: "fW" }), "fW");
  assert.equal(G.folderForNewAlbum(addr, { folders: FS, activeFolderId: null }), null, "aktiv = keine");
  assert.equal(G.folderForNewAlbum(addr, { folders: FS, activeFolderId: "weg" }), null);
  assert.equal(G.folderForNewAlbum(addr, { folders: FS, autoFolder: undefined }), G.BAU_ID, "ohne activeFolderId: alte Logik");
  assert.equal(G.folderForNewAlbum({ kind: "custom", name: "x" }, { folders: FS, activeFolderId: "fW" }), null, "eigene Alben nie");
  const lbs = { kind: "place", name: "LBS Graz" };
  assert.equal(G.folderForNewAlbum(lbs, { folders: FS, activeFolderId: "fW", place: { name: "LBS Graz" } }), G.SCHULE_ID, "Schule bleibt Schule");
  assert.equal(G.folderForNewAlbum(lbs, { folders: FS, activeFolderId: "fW", place: { name: "LBS Graz", photoFolderId: "fW" } }), "fW", "Foto-Kategorie des Orts gewinnt");
  assert.equal(G.folderForNewAlbum({ kind: "place", name: "Firma" }, { folders: FS, activeFolderId: G.BAU_ID, place: { name: "Firma" } }), G.BAU_ID);
});

test("Regel im Ablauf: drei neue Adressen → Wohnungen, bekannte Adresse bleibt, Umschalten wirkt ab dem nächsten", () => {
  const P = (dLat) => move(GRAMBACH, dLat);
  const albums = [{ id: "alt", kind: "address", ...P(0), radius: 80, folderId: G.BAU_ID }];
  let active = "fW";
  const take = (pos) => {
    const m = G.matchLocation(pos, { albums });
    if (m.type === "address") return m.album;
    const a = { id: "a" + albums.length, kind: "address", ...pos, radius: 80 };
    a.folderId = G.folderForNewAlbum(a, { folders: FS, activeFolderId: active });
    albums.push(a);
    return a;
  };
  const n1 = take(P(1000)), n2 = take(P(2000)), n3 = take(P(3000));
  assert.deepEqual([n1, n2, n3].map((a) => a.folderId), ["fW", "fW", "fW"]);
  assert.equal(new Set([n1.id, n2.id, n3.id]).size, 3, "drei Alben");
  assert.equal(take(P(10)).id, "alt"); assert.equal(albums[0].folderId, G.BAU_ID, "bestehendes Album bleibt in Baustellen");
  assert.equal(take(P(1020)).id, n1.id, "zurück an Adresse 1 → dasselbe Album");
  active = G.BAU_ID;
  assert.equal(take(P(5000)).folderId, G.BAU_ID, "nach dem Umschalten → Baustellen");
  assert.equal(albums.find((a) => a.id === n1.id).folderId, "fW", "frühere Alben bleiben");
});

test("Einsatz-Titel → Kategorie-Vorschlag", () => {
  assert.equal(G.einsatzFolderSuggestion("Wohnungen Gries", FS).id, "fW");
  assert.equal(G.einsatzFolderSuggestion("wohnungen gries", FS).id, "fW", "Groß/Klein egal");
  assert.equal(G.einsatzFolderSuggestion("Großbaustelle Liebenau", FS), null, "nur am Wortanfang");
  assert.equal(G.einsatzFolderSuggestion("Baustellen-Runde", FS).id, G.BAU_ID);
  assert.equal(G.einsatzFolderSuggestion("Kundendienst", FS), null);
  assert.equal(G.einsatzFolderSuggestion("", FS), null);
  assert.equal(G.einsatzFolderSuggestion("Ab", [{ id: "k", name: "Ab" }]), null, "zu kurze Namen nie");
  assert.equal(G.einsatzFolderSuggestion("Wohnungen Süd", [...FS, { id: "fWS", name: "Wohnungen Süd" }]).id, "fWS", "längster Treffer");
});

test("Zielname + Alben der letzten 14 Tage aus anderen Kategorien", () => {
  assert.equal(G.destLabel({ name: "Musterstraße 5, Graz" }, { name: "Wohnungen" }), "Wohnungen › Musterstraße 5, Graz");
  assert.equal(G.destLabel({ name: "Musterstraße 5, Graz" }, null), "Musterstraße 5, Graz");
  const now = Date.UTC(2026, 10, 5);
  const D = 86400000;
  const ids = new Set(FS.map((f) => f.id));
  const albums = [
    { id: "a", kind: "address", folderId: G.BAU_ID, created: now - 30 * D },
    { id: "b", kind: "address", folderId: G.BAU_ID, created: now - 2 * D },
    { id: "c", kind: "address", folderId: "fW", created: now - 1 * D },
    { id: "d", kind: "custom", created: now - 40 * D },
    { id: "e", kind: "address", folderId: "weg", created: now - 20 * D },
  ];
  const items = [{ id: "p1", ts: now - 3 * D, albumIds: ["a"] }, { id: "p2", ts: now - 20 * D, albumIds: ["e"] }, { id: "p3", ts: now - 1000, albumIds: ["d"] }];
  const r = G.recentAlbumsElsewhere(albums, items, "fW", ids, { now });
  assert.deepEqual(r.map((x) => x.album.id), ["d", "b", "a"], "neueste zuerst, ohne eigene Kategorie, ohne alte");
  assert.equal(r[0].folderId, G.OHNE_KAT);
});
