// Verschickt fällige Erinnerungen per Firebase Cloud Messaging (läuft alle 15 min in GitHub Actions).
// Benötigt das Secret FIREBASE_SERVICE_ACCOUNT (JSON des Dienstkonto-Schlüssels).
import { decide, dayKeyVienna, TZ } from "./decide.mjs";

const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
if (!raw) {
  console.log("FIREBASE_SERVICE_ACCOUNT ist nicht gesetzt – Erinnerungen sind noch nicht eingerichtet. Nichts zu tun.");
  process.exit(0);
}

let account;
try {
  account = JSON.parse(raw);
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
        await meta.doc("pushlog").set({ ...n.log, updatedAt: now }, { merge: true });
        sent++;
        console.log(`[${uid}] gesendet: ${n.type}`);
      }
    }
  } catch (e) {
    console.error(`[${uid}] Fehler:`, e && e.message ? e.message : e);
  }
}
console.log(`Fertig: ${users} Nutzer mit Push, ${sent} Erinnerung(en) gesendet.`);
