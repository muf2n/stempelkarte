// Update 10 – 💾 Automatisches Wochen-Backup (Cron, siehe wrangler.toml / worker.js scheduled()).
// Liest alle Daten des Nutzers mit dem Dienstkonto und legt einen gzip-komprimierten JSON-Snapshot
// (Format wie die Backup-Datei der App, js/backup-core.js) in users/{uid}/backups ab:
//   backups/{YYYY-MM-DD}        { kind:"meta", date, created, size, stored, gz, chunks, counts, v }
//   backups/{YYYY-MM-DD}_c{i}   { kind:"chunk", date, i, data: base64-Teil (≤ 900 KB) }
// Die letzten 4 bleiben. NIE dabei: Tresor (a_vault*, vault*), Bild-Bytes, Server-Dokumente in meta/.
// Wenige Unteranfragen (Cloudflare gratis: ~50 pro Lauf): Token + UID + 1 Abfrage je Namensbereich (kindless
// Abfrage über alle Unter-Sammlungen, ausgeschlossene Bereiche per __name__-Grenzen übersprungen) + batchGet für meta
// + 1 Liste der Backups + 1–2 Commits.
import { loadAccount, getAccessToken, resolveUid, DEFAULT_PROJECT } from "./google.js";
import { Firestore } from "./firestore.js";
import * as B from "../../../js/backup-core.js";

export const BACKUP_CRON = "15 2 * * 0"; // sonntags 02:15 UTC ≈ 03:15 Wien (Winterzeit)
export const MIN_GAP_MS = 6 * 86400000;  // höchstens ein automatisches Backup pro ~Woche
const COMMIT_BYTES = 8 * 1024 * 1024;    // Commit-Anfragen klein halten (Firestore-Limit 10 MiB)
// Kleinste mögliche Dokument-ID (so macht es auch das Firebase-Admin-SDK bei recursiveDelete)
const MIN_ID = "__id-9223372036854775808__";

/** Ausgeschlossene Namensbereiche → [{from, to}] (Sammlungsnamen, to exklusiv), sortiert. */
export function excludedRanges() {
  const r = [
    ...B.EXCLUDE_EXACT.map((n) => ({ from: n, to: n + "\u0000" })),
    ...B.EXCLUDE_PREFIX.map((p) => ({ from: p, to: p + "~" })), // Namen bestehen nur aus a-z0-9_ (< „~“)
  ];
  return r.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** Kindless-Abfragen für alles außer den ausgeschlossenen Bereichen. → [structuredQuery] */
export function rangeQueries(root, uid) {
  const ref = (coll) => ({ referenceValue: `${root}/users/${uid}/${coll}/${MIN_ID}` });
  const f = (op, coll) => ({ fieldFilter: { field: { fieldPath: "__name__" }, op, value: ref(coll) } });
  const out = [];
  let lower = null;
  for (const ex of excludedRanges()) {
    if (lower !== null && lower >= ex.from) { if (ex.to > lower) lower = ex.to; continue; }
    const filters = [];
    if (lower !== null) filters.push(f("GREATER_THAN_OR_EQUAL", lower));
    filters.push(f("LESS_THAN", ex.from));
    out.push(filters);
    lower = ex.to;
  }
  out.push([f("GREATER_THAN_OR_EQUAL", lower)]);
  return out.map((filters) => ({
    from: [{ allDescendants: true }],
    where: filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } },
  }));
}

/** Alle sicherbaren Daten lesen → Backup-Objekt (Format von js/backup-core.js). */
export async function collectSnapshot(fs, uid, now = Date.now()) {
  const base = `${fs.root}/users/${uid}/`;
  const collections = {};
  const results = await Promise.all(rangeQueries(fs.root, uid).map((q) => fs.runQuery(`users/${uid}`, q)));
  for (const docs of results) {
    for (const d of docs) {
      if (!d || !d.name || !d.name.startsWith(base)) continue;
      const rel = d.name.slice(base.length).split("/");
      if (rel.length !== 2) continue; // nur direkte Sammlungen des Nutzers
      const [coll, id] = rel;
      if (!B.allowedCollection(coll)) continue; // doppelte Absicherung (Tresor & Co.)
      (collections[coll] ||= []).push({ ...d.data, id });
    }
  }
  for (const n of B.MAIN) collections[n] ||= [];
  const metaDocs = await fs.batchGet(B.META_DOCS.map((id) => `users/${uid}/meta/${id}`));
  const meta = {};
  B.META_DOCS.forEach((id, i) => { if (metaDocs[i]) meta[id] = metaDocs[i].data; });
  return B.buildBackup({ collections, meta, created: now, source: "auto", app: "server" });
}

/** Datum (Wien) eines Zeitstempels → YYYY-MM-DD */
export function viennaDate(ts) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

/** Snapshot schreiben + alte aufräumen. → { date, chunks, size, stored, dropped } bzw. { skipped } */
export async function runBackup(fs, uid, { now = Date.now(), force = false } = {}) {
  const existing = await fs.list(`users/${uid}/backups`, { mask: ["kind", "date", "created", "chunks", "i"] });
  const metas = existing.filter((d) => d && d.data && d.data.kind === "meta");
  const latest = metas.reduce((a, d) => Math.max(a, Number(d.data.created) || 0), 0);
  if (!force && latest && now - latest < MIN_GAP_MS) return { skipped: "recent" };

  const backup = await collectSnapshot(fs, uid, now);
  const date = viennaDate(now);
  const { meta, chunks } = await B.packSnapshot(backup, { date });
  const p = (id) => `users/${uid}/backups/${id}`;

  const writes = [];
  chunks.forEach((data, i) => writes.push({ w: fs.setWrite(p(B.chunkId(date, i)), { kind: "chunk", date, i, data }), size: data.length + 200 }));
  const { drop } = B.retention([...metas.map((d) => d.data.date), date], B.KEEP_AUTO);
  const dropSet = new Set(drop);
  // Alte Teile desselben Tages (z. B. vorher mehr Teile) und verworfene Backups löschen
  for (const d of existing) {
    const dd = d.data || {};
    if (dropSet.has(dd.date) || (dd.date === date && dd.kind === "chunk" && Number(dd.i) >= chunks.length)) writes.push({ w: fs.deleteWrite(p(d.id)), size: 200 });
  }
  // Meta zuletzt: erst wenn alle Teile da sind, taucht das Backup in der App auf
  const groups = [[]];
  let cur = 0;
  for (const x of writes) {
    if (cur + x.size > COMMIT_BYTES || groups[groups.length - 1].length >= 450) { groups.push([]); cur = 0; }
    groups[groups.length - 1].push(x.w);
    cur += x.size;
  }
  groups[groups.length - 1].push(fs.setWrite(p(date), meta));
  for (const g of groups) if (g.length) await fs.commit(g);
  return { date, chunks: chunks.length, size: meta.size, stored: meta.stored, dropped: drop.length };
}

/** Für scheduled(): Dienstkonto laden, UID finden, Backup machen. Gibt nur Status zurück (keine Inhalte). */
export async function runBackupCron(env, { fetchImpl = (...a) => fetch(...a), now = Date.now(), force = false } = {}) {
  let acc;
  try { acc = loadAccount(env.FIREBASE_SERVICE_ACCOUNT); } catch { return { skipped: "not_configured" }; }
  const projectId = String(env.FIREBASE_PROJECT_ID || acc.project_id || DEFAULT_PROJECT);
  const getToken = () => getAccessToken(acc, fetchImpl, now);
  const fs = new Firestore({ projectId, getToken, fetchImpl });
  const uid = await resolveUid({ env, projectId, getToken, fetchImpl, fs });
  try {
    return await runBackup(fs, uid, { now, force });
  } catch (e) {
    return { error: (e && e.code) || "Fehler" };
  }
}
