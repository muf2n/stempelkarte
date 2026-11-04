// Verschickt fällige Erinnerungen per Firebase Cloud Messaging (läuft alle 15 min in GitHub Actions).
// Benötigt das Secret FIREBASE_SERVICE_ACCOUNT (JSON des Dienstkonto-Schlüssels).
import { decide, dayKeyVienna, TZ } from "./decide.mjs";

const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
if (!raw) {
  console.log("FIREBASE_SERVICE_ACCOUNT ist nicht gesetzt – Erinnerungen sind noch nicht eingerichtet. Nichts zu tun.");
  process.exit(0);
}

// Beim Kopieren am Handy werden oft Anführungszeichen „verschönert“, unsichtbare Zeichen
// eingefügt oder Zeilen umgebrochen – das hier repariert die üblichen Fälle.
function parseAccount(text) {
  const tries = [];
  let t = String(text).replace(/^\uFEFF/, "").trim();
  tries.push(t);
  t = t.replace(/[\u200B-\u200D\u2060\u00AD]/g, "")
       .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
       .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
       .replace(/\u00A0/g, " ");
  tries.push(t);
  // echte Zeilenumbrüche innerhalb von Strings (z. B. im private_key) maskieren
  tries.push(t.replace(/"(?:[^"\\]|\\.)*"/gs, (m) => m.replace(/\r?\n/g, "\\n")));
  let lastErr;
  for (const c of tries) {
    try { return JSON.parse(c); } catch (e) { lastErr = e; }
  }
  const m = /position (\d+)/.exec(lastErr && lastErr.message || "");
  const pos = m ? Number(m[1]) : -1;
  const ch = pos >= 0 ? t.codePointAt(pos) : null;
  // Bewusst NICHT lastErr.message ausgeben: Node hängt dort einen Ausschnitt des (geheimen) Inhalts an.
  throw new Error(`Lesefehler an Stelle ${pos}` + (ch != null ? ` (Zeichen dort: U+${ch.toString(16).toUpperCase().padStart(4, "0")})` : "") + `, Länge gesamt ${t.length}, beginnt mit „{“: ${t.startsWith("{")}`);
}

// Privaten Schlüssel neu zusammensetzen: Handy-Kopien enthalten oft zusätzliche Leerzeichen,
// Umbrüche oder „schöne“ Bindestriche. Gibt nur Längen aus, nie den Inhalt.
function repairPem(k) {
  const t = k.replace(/\\n/g, "\n").replace(/[\u2010-\u2015\u2212]/g, "-");
  // Tolerant: Die Beschriftung kann beim Kopieren verändert sein (z. B. übersetzt). Ein Google-
  // Schlüssel (PKCS#8, RSA) beginnt in Base64 immer mit „MII“ – von dort bis „END“ ist der Inhalt.
  const b = t.indexOf("BEGIN"), e = t.lastIndexOf("END");
  const start = b >= 0 ? t.indexOf("MII", b) : -1;
  const m = start >= 0 && e > start ? [null, t.slice(start, e)] : null;
  if (!m) {
    console.error(`Privater Schlüssel: Inhalt nicht gefunden (Länge ${t.length}, BEGIN: ${b >= 0}, END: ${e >= 0}, MII: ${start >= 0}).`);
    return t;
  }
  const label = "PRIVATE KEY";
  const body = m[1].replace(/[^A-Za-z0-9+/=]/g, "");
  const ok = body.length % 4 === 0;
  console.log(`Privater Schlüssel: ${body.length} Zeichen Base64${ok ? "" : " (Länge passt nicht – vermutlich verändert)"}.`);
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

let account;
let accountForDiag = null;
try {
  account = parseAccount(raw);
  accountForDiag = account;
  console.log(`Schlüssel-Text: ${String(raw).length} Zeichen (vollständig ca. 2300–2400).`);
  if (account.type !== "service_account" || !account.private_key || !account.client_email) {
    throw new Error("Inhalt ist kein Firebase-Dienstkonto-Schlüssel (type/private_key/client_email fehlt)");
  }
  account.private_key = repairPem(String(account.private_key));
} catch (e) {
  console.error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON:", e.message);
  process.exit(1);
}

const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore, FieldValue, FieldPath } = await import("firebase-admin/firestore");
const { getMessaging } = await import("firebase-admin/messaging");

initializeApp({ credential: cert(account) });
const db = getFirestore();
const messaging = getMessaging();

const BAD_TOKEN = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/** pushlog nur in eigenen Feldern ändern (die App schreibt dort „snooze“). */
async function writeLog(ref, pairs) {
  const args = [];
  for (const [path, val] of pairs) args.push(new FieldPath(...path), val);
  try {
    await ref.update(...args);
  } catch (e) {
    if (e && (e.code === 5 || /NOT_FOUND|No document/i.test(String(e.message)))) {
      // Dokument gibt es noch nicht → anlegen (merge, falls die App gleichzeitig schreibt)
      const obj = {};
      for (const [path, val] of pairs) {
        let o = obj;
        path.slice(0, -1).forEach((p) => { o = o[p] = o[p] || {}; });
        o[path[path.length - 1]] = val;
      }
      await ref.set(obj, { merge: true });
    } else throw e;
  }
}

/** Alte Tages-Schlüssel (planId:YYYY-MM-DD) aus pushlog entfernen, älter als 7 Tage. */
async function pruneLog(ref, log, todayKey) {
  const limit = dayKeyVienna(Date.now() - 7 * 86400000);
  const args = [];
  for (const field of ["planSent", "snooze", "snoozeSent", "planEndSent"]) {
    const m = log && log[field];
    if (!m || typeof m !== "object") continue;
    for (const k of Object.keys(m)) {
      const day = k.split(":").pop();
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < limit) args.push(new FieldPath(field, k), FieldValue.delete());
    }
  }
  if (args.length) await ref.update(...args).catch(() => {});
}

const now = Date.now();
const todayKey = dayKeyVienna(now);
console.log(`Lauf um ${new Date(now).toISOString()} (${TZ}: ${todayKey})`);

let users = 0, sent = 0;
const refs = await db.collection("users").listDocuments();
for (const userRef of refs) {
  const uid = userRef.id;
  try {
    const meta = userRef.collection("meta");
    const pushSnap = await meta.doc("push").get();
    const tokens = Object.keys((pushSnap.exists && pushSnap.get("tokens")) || {});
    if (!tokens.length) continue;
    users++;

    const [setSnap, stateSnap, logSnap, entSnap] = await Promise.all([
      meta.doc("settings").get(),
      meta.doc("state").get(),
      meta.doc("pushlog").get(),
      userRef.collection("entries").where("start", ">=", now - 36 * 3600000).get(),
    ]);
    const settings = setSnap.exists ? setSnap.data() : {};
    const running = stateSnap.exists ? (stateSnap.get("running") || null) : null;
    const pushlog = logSnap.exists ? logSnap.data() : {};
    const todayEntries = entSnap.docs.map((d) => d.data()).filter((e) => dayKeyVienna(Number(e.start)) === todayKey);

    const due = decide(now, settings, running, todayEntries, pushlog);
    if (logSnap.exists) await pruneLog(meta.doc("pushlog"), pushlog, todayKey);
    let live = tokens;
    for (const n of due) {
      if (!live.length) break;
      const res = await messaging.sendEachForMulticast({
        tokens: live,
        data: { title: n.title, body: n.body, url: n.url, tag: n.tag },
        webpush: { headers: { Urgency: "high", TTL: "3600" } },
      });
      const bad = [];
      res.responses.forEach((r, i) => {
        if (!r.success && r.error && BAD_TOKEN.has(r.error.code)) bad.push(live[i]);
        else if (!r.success) console.warn(`[${uid}] Senden fehlgeschlagen:`, r.error && r.error.code);
      });
      if (bad.length) {
        const args = [];
        for (const t of bad) args.push(new FieldPath("tokens", t), FieldValue.delete());
        await meta.doc("push").update(...args);
        live = live.filter((t) => !bad.includes(t));
        console.log(`[${uid}] ${bad.length} ungültige(s) Token entfernt`);
      }
      if (res.successCount > 0) {
        await writeLog(meta.doc("pushlog"), [...n.log, [["updatedAt"], now]]);
        sent++;
        console.log(`[${uid}] gesendet: ${n.type}`);
      }
    }
  } catch (e) {
    console.error(`[${uid}] Fehler:`, e && e.message ? e.message : e);
  }
}
console.log(`Fertig: ${users} Nutzer mit Push, ${sent} Erinnerung(en) gesendet.`);
