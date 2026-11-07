// „Zugänge synchronisieren“ (M2, Audit 2): schreibt die Zusatz-Konten aus dem Secret ALLOWED_EMAILS
// (Komma-getrennt) als Firestore-Dokumente allow/<e-mail> und löscht nicht mehr gelistete.
// firestore.rules lässt ein Konto zu, wenn es der Besitzer ist ODER allow/<e-mail> existiert.
// Ausgabe: NUR Zahlen – nie Adressen (das Actions-Log ist öffentlich).
import { loadAccount, getAccessToken, DEFAULT_PROJECT } from "./src/google.js";
import { Firestore } from "./src/firestore.js";

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** "a@x.at, B@y.com" → ["a@x.at", "b@y.com"] (bereinigt, ohne Doppelte); ungültige werden gezählt. */
export function parseAllowed(raw) {
  const ok = new Set();
  let bad = 0;
  for (const part of String(raw || "").split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase();
    if (!e) continue;
    if (EMAIL_RE.test(e) && e.length <= 254) ok.add(e); else bad++;
  }
  return { emails: [...ok].sort(), bad };
}

/** Allow-Liste abgleichen. → { added, kept, removed, bad } */
export async function syncAllowed(fs, raw, now = Date.now()) {
  const { emails, bad } = parseAllowed(raw);
  const existing = new Set((await fs.list("allow", { mask: ["__none__"] })).map((d) => d.id));
  const writes = [];
  let added = 0, kept = 0, removed = 0;
  for (const e of emails) {
    if (existing.has(e)) kept++;
    else { added++; writes.push(fs.setWrite("allow/" + e, { allowed: true, updatedAt: now })); }
  }
  for (const id of existing) if (!emails.includes(id)) { removed++; writes.push(fs.deleteWrite("allow/" + id)); }
  if (writes.length) await fs.commit(writes);
  return { added, kept, removed, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = process.env.ALLOWED_EMAILS;
  // Leer = Secret fehlt → nichts ändern (sonst würden alle Zusatz-Konten gelöscht). Alle entfernen: Secret auf „keine“ setzen.
  if (!String(raw || "").trim()) { console.log("ALLOWED_EMAILS ist nicht gesetzt – nichts geändert."); process.exit(1); }
  if (/^keine$/i.test(raw.trim())) raw = "";
  const acc = loadAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
  const projectId = String(process.env.FIREBASE_PROJECT_ID || acc.project_id || DEFAULT_PROJECT);
  const fs = new Firestore({ projectId, getToken: () => getAccessToken(acc) });
  try {
    const r = await syncAllowed(fs, raw);
    console.log(`Zugänge: ${r.added} neu, ${r.kept} unverändert, ${r.removed} entfernt${r.bad ? `, ${r.bad} ungültig (übersprungen)` : ""}.`);
  } catch (e) {
    console.log(`FEHLER beim Abgleich [${(e && e.name) || "?"}${e && e.status ? " " + e.status : ""}]`);
    process.exit(1);
  }
}
