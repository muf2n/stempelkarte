// Update 9 (Agent S) – Galerie: Alben („Kategorien“) und automatische Zuordnung nach Ort/Adresse.
//   Sammlung a_photo_albums (js/alltag/db.js): { id, name, kind:"address"|"custom"|"place", lat?, lng?, radius,
//   addr?, placeId?, cover?, emoji?, created }.
//   autoFile(): nach dem Speichern eines Fotos Position anhängen und passendes Album suchen/anlegen
//   (gespeicherter Ort → Ort-Album, sonst Adress-Album im Radius, sonst neues Album aus Nominatim).
//   Einstellungen: settings.gallery = { auto (Standard true), radius (Standard 80 m),
//     autoFolder (Kategorie für neue Adress-/Ort-Alben; fehlt = „Baustellen“, "" = keine), foldersInit (Flag erster Start) }.
// Update 9 (Agent T) – Hauptkategorien: Sammlung a_photo_folders { id, name, emoji, color, order, created },
//   Alben bekommen optional folderId. ensureFolders() legt beim ersten Start (nur ohne Kategorien) die Standard-
//   Kategorien an und sortiert bestehende Adress-/Ort-Alben ein – danach nie wieder (Flag foldersInit).
import { collection } from "./alltag/db.js";
import * as photos from "./photos.js";
import * as geo from "./geo.js";
import * as store from "./store.js";
import * as G from "./gallery-core.js";

let col = null;
export function albumsCol() { return col || (col = collection("photo_albums")); }
export function albums() { return albumsCol().all().map(G.normAlbum).filter(Boolean); }
export function albumById(id) { const a = albumsCol().get(id); return a ? G.normAlbum(a) : null; }
export function albumsMap() { return new Map(albums().map((a) => [a.id, a])); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Nicht ewig auf Firestore warten (offline bestätigt setDoc erst mit Netz) – lokal ist es sofort da. */
const soft = (p, ms = 1500) => Promise.race([Promise.resolve(p).catch((e) => console.error("Album speichern:", e)), sleep(ms)]);

/** Warten, bis die Alben einmal geladen sind (Cloud), höchstens ms. */
export async function albumsReady(ms = 4000) {
  const c = albumsCol();
  c.all();
  const t0 = Date.now();
  while (!c.loaded && Date.now() - t0 < ms) await sleep(100);
  return c.loaded;
}

/* ---------- Einstellungen ---------- */

function rawSettings() { return (store.get().settings && store.get().settings.gallery) || {}; }
export function settings() {
  const g = rawSettings();
  const out = { auto: g.auto !== false, radius: G.cleanRadius(g.radius, G.DEFAULT_RADIUS), foldersInit: !!g.foldersInit };
  if (typeof g.autoFolder === "string") out.autoFolder = g.autoFolder; // fehlt = Standard „Baustellen“
  return out;
}
export async function saveSettings(partial) {
  await store.saveSettings({ gallery: { ...rawSettings(), ...settings(), ...partial } });
}

/* ---------- Hauptkategorien ---------- */

let fcol = null;
export function foldersCol() { return fcol || (fcol = collection("photo_folders")); }
export function folders() { return G.sortFolders(foldersCol().all().map(G.normFolder).filter(Boolean)); }
export function folderById(id) { const f = id ? foldersCol().get(id) : null; return f ? G.normFolder(f) : null; }
export function folderIds() { return new Set(folders().map((f) => f.id)); }
/** Kategorie, in die neue Adress-/Ort-Alben automatisch kommen (null = keine). */
export function autoFolderId() { return G.resolveAutoFolder(folders(), settings().autoFolder); }

export async function foldersReady(ms = 4000) {
  const c = foldersCol();
  c.all();
  const t0 = Date.now();
  while (!c.loaded && Date.now() - t0 < ms) await sleep(100);
  return c.loaded;
}

let ensuring = null;
/** Erster Start: Standard-Kategorien + Einsortieren bestehender Alben (einmalig, Flag in settings.gallery). */
export function ensureFolders() {
  if (settings().foldersInit) return Promise.resolve(false);
  if (!ensuring) ensuring = doEnsureFolders().finally(() => { ensuring = null; });
  return ensuring;
}
async function doEnsureFolders() {
  const okF = await foldersReady();
  const okA = await albumsReady();
  if (!okF || !okA || settings().foldersInit) return false; // Cloud noch nicht da → später nochmal
  const plan = G.folderMigration({ initialized: false, folders: folders(), albums: albums(), places: store.get().places || [] });
  if (!plan) return false;
  const now = Date.now();
  for (const f of plan.create) await soft(foldersCol().put({ ...f, created: now + f.order }));
  for (const { id, folderId } of plan.assign) await patchAlbum(id, { folderId });
  try { await saveSettings({ foldersInit: true }); } catch (e) { console.error("Galerie-Einstellung:", e); }
  return true;
}

export async function createFolder({ name, emoji, color }) {
  const id = "fo" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const f = G.normFolder({ id, name, emoji, color, order: G.nextFolderOrder(folders()), created: Date.now() });
  await soft(foldersCol().put(f));
  return folderById(id) || f;
}
export async function patchFolder(id, partial) {
  if (!id || id === G.OHNE_KAT) return;
  await soft(foldersCol().patch(id, partial));
}
export async function moveFolder(id, dir) {
  for (const { id: fid, order } of G.moveFolderPlan(folders(), id, dir)) await patchFolder(fid, { order });
}
/** Alben in eine Kategorie legen (folderId null/OHNE_KAT = Ohne Kategorie). */
export async function setAlbumsFolder(ids, folderId) {
  const f = folderId && folderId !== G.OHNE_KAT ? folderId : null;
  for (const id of ids || []) await patchAlbum(id, { folderId: f });
}
/** Kategorie löschen – Fotos und Alben bleiben, die Alben wandern nach target (null = Ohne Kategorie). */
export async function deleteFolder(id, { target = null } = {}) {
  if (!id || id === G.OHNE_KAT) return 0;
  const t = target && target !== G.OHNE_KAT && target !== id && folderById(target) ? target : null;
  const plan = G.deleteFolderPlan(albums(), id, t);
  for (const p of plan) await patchAlbum(p.id, { folderId: p.folderId });
  // war es die Auto-Kategorie für neue Adress-Alben → dorthin, wohin die Alben gewandert sind (sonst keine)
  if (autoFolderId() === id) { try { await saveSettings({ autoFolder: t || "" }); } catch (e) { console.error(e); } }
  await soft(foldersCol().remove(id));
  return plan.length;
}

/* ---------- Position (frisch < 60 s wiederverwenden, sonst ≈ 8 s warten) ---------- */

let lastPos = null; // { lat, lng, acc, at }
export function rememberPosition(p) {
  if (p && G.hasPos(p)) lastPos = { lat: p.lat, lng: p.lng, acc: Number(p.acc) || 0, at: Date.now() };
}
/**
 * Position fürs Foto. Gibt es eine frische (< 60 s), wird höchstens 1,5 s auf eine neuere gewartet
 * (man kann ja inzwischen weitergefahren sein), sonst diese genommen. Ohne frische: bis ≈ 8 s warten.
 * → Promise<{lat,lng,acc}|null> (null = verweigert/nicht verfügbar)
 */
/** Gemerkte Position vergessen (z. B. nach Ortswechsel/Test). */
export function forgetPosition() { lastPos = null; }
export function currentPosition({ timeout = 8000 } = {}) {
  const fresh = lastPos && Date.now() - lastPos.at < 60000 ? { ...lastPos } : null;
  const job = geo.getPosition({ timeout, maxAge: 60000 })
    .then((p) => { rememberPosition(p); return lastPos; })
    .catch(() => fresh);
  return Promise.race([job, sleep(fresh ? 1500 : timeout + 1500).then(() => fresh)]);
}

/* ---------- Alben anlegen/ändern ---------- */

export async function createAlbum(data, { place = null } = {}) {
  const id = data.id || "al" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  data = { ...data };
  if (data.folderId === undefined && (data.kind === "address" || data.kind === "place")) {
    try { await ensureFolders(); } catch (e) { console.warn("Kategorien:", e); }
    const fid = G.folderForNewAlbum(data, { folders: folders(), autoFolder: settings().autoFolder, place });
    if (fid) data.folderId = fid;
  }
  if (!data.folderId || data.folderId === G.OHNE_KAT) delete data.folderId;
  const a = G.normAlbum({ radius: settings().radius, ...data, id, created: Date.now() });
  const clean = {};
  for (const [k, v] of Object.entries(a)) if (v !== undefined) clean[k] = v;
  await soft(albumsCol().put(clean));
  return albumById(id) || a;
}
export async function patchAlbum(id, partial) {
  if (!id || id === G.OHNE_ORT) return;
  await soft(albumsCol().patch(id, partial));
}

/** Ort-Album zu einem gespeicherten Ort (anlegen, falls es fehlt). */
export async function placeAlbum(place) {
  const pid = place && (place.id || place.placeId);
  if (!pid) return null;
  const have = albums().find((a) => a.kind === "place" && a.placeId === pid);
  if (have) return have;
  return createAlbum({
    kind: "place", placeId: pid, name: place.name || place.place || "Ort",
    lat: G.hasPos(place) ? place.lat : null, lng: G.hasPos(place) ? place.lng : null,
    radius: G.cleanRadius(place.radius, G.PLACE_RADIUS), addr: place.addr || "",
  }, { place });
}

/* ---------- Automatisch einsortieren ---------- */

let fileQueue = Promise.resolve();

/**
 * Foto (schon gespeichert) nachträglich mit Position + Album versehen. Läuft in einer Warteschlange,
 * damit zwei schnelle Fotos an derselben Adresse nicht zwei Alben anlegen.
 * opts = { pos?: {lat,lng,acc} | Promise, auto?: false (keine Alben), placeId? }
 * → { album|null, pos|null }
 */
export function autoFile(photo, opts = {}) {
  const job = fileQueue.then(() => doFile(photo, opts));
  fileQueue = job.catch(() => null);
  return job;
}

async function doFile(photo, opts) {
  if (!photo || !photo.id) return { album: null, pos: null };
  let pos = null;
  try { pos = await (opts.pos !== undefined ? opts.pos : currentPosition()); } catch { pos = null; }
  if (pos && !G.hasPos(pos)) pos = null;
  const set = settings();
  const auto = set.auto && opts.auto !== false;
  const patch = {};
  if (pos) { patch.lat = pos.lat; patch.lng = pos.lng; if (Number.isFinite(Number(pos.acc))) patch.acc = Math.round(Number(pos.acc)); }
  let album = null;
  let addr = "";
  if (auto) await albumsReady();
  const pls = store.get().places || [];
  if (pos) {
    const m = G.matchLocation(pos, { places: pls, albums: albums(), defaultRadius: set.radius });
    if (auto && m.type === "place") {
      album = m.album || await placeAlbum(m.place);
      addr = m.place.addr || "";
      // Foto ohne Ort (nicht eingestempelt dort) → mit dem gespeicherten Ort verknüpfen (erscheint im Ort-Blatt)
      if (!photo.placeId) { patch.placeId = m.place.id; patch.place = m.place.name || ""; }
    }
    else if (auto && m.type === "address") { album = m.album; addr = m.album.addr || ""; }
    else {
      const data = await geo.reverseGeocodeDetail(pos.lat, pos.lng);
      addr = G.fullAddrFrom(data);
      if (auto) {
        // nach der Wartezeit noch einmal prüfen (andere Geräte/Fotos)
        const again = G.matchLocation(pos, { places: pls, albums: albums(), defaultRadius: set.radius });
        if (again.type === "address") album = again.album;
        else album = await createAlbum({ kind: "address", name: G.albumNameFrom(data) || G.coordName(pos), lat: pos.lat, lng: pos.lng, radius: set.radius, addr });
      }
    }
  } else if (auto && (opts.placeId || photo.placeId)) {
    // kein GPS, aber eingestempelt an einem Ort → Ort-Album
    const pid = opts.placeId || photo.placeId;
    const pl = pls.find((p) => p.id === pid) || { id: pid, name: photo.place || "Ort" };
    album = await placeAlbum(pl);
  }
  if (addr) patch.addr = addr;
  if (album) { patch.albumIds = G.changeIds(photo.albumIds, album.id); patch.albMig = true; }
  if (Object.keys(patch).length) {
    try { await photos.updatePhoto(photo.id, patch); } catch (e) { console.error("Foto einsortieren:", e); }
  }
  return { album, pos };
}

/* ---------- Migration alter Fotos (einmal beim Öffnen der Galerie, danach nur Neues) ---------- */

let migrating = null;
export function migrate() {
  if (!migrating) migrating = doMigrate().finally(() => { migrating = null; });
  return migrating;
}
async function doMigrate() {
  try { await photos.ensureIndex(); } catch (e) { console.warn("Galerie-Index:", e); }
  const list = await photos.listIndex();
  await albumsReady();
  const plan = G.migrationPlan(list, albums());
  if (!plan.length) return 0;
  const pls = store.get().places || [];
  let n = 0;
  for (const { id, placeId } of plan) {
    const it = list.find((x) => x.id === id);
    const pl = pls.find((p) => p.id === placeId) || { id: placeId, name: (it && it.place) || "Ort" };
    const al = await placeAlbum(pl);
    if (!al) continue;
    try { await photos.updatePhoto(id, { albumIds: G.changeIds(it && it.albumIds, al.id), albMig: true }); n++; } catch (e) { console.error(e); }
  }
  return n;
}

/* ---------- Mehrere Fotos ---------- */

async function eachIds(ids, fn) {
  for (const id of ids) { try { await fn(id); } catch (e) { console.error(e); } }
}
function idxItem(list, id) { return list.find((x) => x.id === id) || null; }

export async function addToAlbum(ids, albumId) {
  const list = await photos.listIndex();
  await eachIds(ids, (id) => { const it = idxItem(list, id); return photos.updatePhoto(id, { albumIds: G.changeIds(it && it.albumIds, albumId) }); });
}
export async function removeFromAlbum(ids, albumId) {
  const list = await photos.listIndex();
  await eachIds(ids, (id) => { const it = idxItem(list, id); return it ? photos.updatePhoto(id, { albumIds: G.changeIds(it.albumIds, [], albumId) }) : null; });
}
export async function moveToAlbum(ids, fromId, toId) {
  const list = await photos.listIndex();
  await eachIds(ids, (id) => { const it = idxItem(list, id); return photos.updatePhoto(id, { albumIds: G.changeIds(it && it.albumIds, toId, fromId && fromId !== G.OHNE_ORT ? fromId : []) }); });
}
export async function deletePhotos(ids) {
  await eachIds(ids, (id) => photos.deletePhoto(id));
}

/** Album `fromId` in `intoId` zusammenführen (Fotos wandern, fromId wird gelöscht). */
export async function mergeAlbums(fromId, intoId) {
  const list = await photos.listIndex();
  const from = albumById(fromId), into = albumById(intoId);
  if (!from || !into || fromId === intoId) return 0;
  const plan = G.mergePlan(list, fromId, intoId);
  await eachIds(plan, (p) => photos.updatePhoto(p.id, { albumIds: p.albumIds }));
  const fill = {};
  if (!G.hasPos(into) && G.hasPos(from)) { fill.lat = from.lat; fill.lng = from.lng; }
  if (!into.addr && from.addr) fill.addr = from.addr;
  if (Object.keys(fill).length) await patchAlbum(intoId, fill);
  await soft(albumsCol().remove(fromId));
  return plan.length;
}

/** Album löschen; withPhotos = true löscht auch alle Fotos darin. */
export async function deleteAlbum(id, { withPhotos = false } = {}) {
  const list = await photos.listIndex();
  const ids = G.itemsOfAlbum(list, id, albumsMap()).map((x) => x.id);
  if (withPhotos) await deletePhotos(ids);
  else await removeFromAlbum(ids, id);
  await soft(albumsCol().remove(id));
  return ids.length;
}
