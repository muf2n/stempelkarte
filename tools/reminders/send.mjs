// Verschickt fällige Erinnerungen per Firebase Cloud Messaging (läuft alle 15 min in GitHub Actions).
// Benötigt das Secret FIREBASE_SERVICE_ACCOUNT (JSON des Dienstkonto-Schlüssels).
import { decide, decideBudget, applyBudgetAlerts, dayKeyVienna, decideSavings, savingsWanted, decideBriefing, briefingDue } from "./decide.mjs";

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
  // todoSent: {todoId: "YYYY-MM-DD HH:MM"} – nach dem Datum im Wert aufräumen
  const ts = log && log.todoSent;
  if (ts && typeof ts === "object") {
    for (const [k, v] of Object.entries(ts)) {
      const day = String(v || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < limit) args.push(new FieldPath("todoSent", k), FieldValue.delete());
    }
  }
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

/** Update 9 – Budget: Budgets, Kategorien, Buchungen des laufenden Monats und Warn-Zustand (null ohne Budget). */
async function loadBudget(userRef, meta, uid) {
  try {
    const bSnap = await userRef.collection("a_money_budget").get();
    const budgets = bSnap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((b) => Number(b.amount) > 0);
    if (!budgets.length) return null;
    const first = todayKey.slice(0, 7) + "-01";
    const [txSnap, catSnap, stSnap] = await Promise.all([
      userRef.collection("a_money_tx").where("date", ">=", first).get(),
      userRef.collection("a_money_cats").get().catch(() => ({ docs: [] })),
      meta.doc("budget_alerts").get(),
    ]);
    return {
      budgets,
      txs: txSnap.docs.map((d) => ({ ...d.data(), id: d.id })),
      cats: catSnap.docs.map((d) => ({ ...d.data(), id: d.id })),
      state: stSnap.exists ? stSnap.data() : null,
    };
  } catch (e) {
    warn("Budget", e);
    return null;
  }
}

const now = Date.now();
const todayKey = dayKeyVienna(now);

// M8: Die Logs dieses Workflows sind öffentlich (öffentliches Repo). Deshalb nur Zählwerte ausgeben –
// keine UID, keine Art der Erinnerung, keine Titel, Uhrzeiten, Budget- oder Geburtstagstexte, keine Fehlermeldungen
// mit Inhalten (nur Fehler-Codes).
let users = 0, sent = 0, failed = 0, removed = 0, warnings = 0, errors = 0;
const errCodes = new Set();
function codeOf(e) {
  const c = e && (e.code ?? e.status);
  return c != null && /^[A-Za-z0-9/_.-]{1,60}$/.test(String(c)) ? String(c) : "?";
}
function warn(_area, e) { warnings++; errCodes.add(codeOf(e)); }
const refs = await db.collection("users").listDocuments();
for (const userRef of refs) {
  const uid = userRef.id;
  try {
    const meta = userRef.collection("meta");
    const pushSnap = await meta.doc("push").get();
    const tokenMap = (pushSnap.exists && pushSnap.get("tokens")) || {};
    const tokens = Object.keys(tokenMap);
    if (!tokens.length) continue;
    // Android-App (Capacitor): eigener Payload mit sichtbarer Benachrichtigung im Kanal „erinnerungen“
    const isAndroid = (t) => !!(tokenMap[t] && tokenMap[t].platform === "android");
    users++;

    const [setSnap, stateSnap, logSnap, entSnap, todoSnap] = await Promise.all([
      meta.doc("settings").get(),
      meta.doc("state").get(),
      meta.doc("pushlog").get(),
      userRef.collection("entries").where("start", ">=", now - 36 * 3600000).get(),
      userRef.collection("todos").where("remind", "==", true).get().catch((e) => {
        warn("Aufgaben", e);
        return { docs: [] };
      }),
    ]);
    const settings = setSnap.exists ? setSnap.data() : {};
    const running = stateSnap.exists ? (stateSnap.get("running") || null) : null;
    const pushlog = logSnap.exists ? logSnap.data() : {};
    const todayEntries = entSnap.docs.map((d) => d.data()).filter((e) => dayKeyVienna(Number(e.start)) === todayKey);

    const todos = todoSnap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((t) => !t.done);

    const due = decide(now, settings, running, todayEntries, pushlog, todos);
    // Update 9 – Sparziele: Spar-Erinnerung (Zahltag/fixer Tag) und Aufrunden (Sonntag)
    try {
      const goalSnap = await userRef.collection("a_money_goals").get();
      const goals = goalSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
      if (savingsWanted(settings, goals)) {
        const since = dayKeyVienna(now - 100 * 86400000);
        const [txSnap, bankSnap] = await Promise.all([
          userRef.collection("a_money_tx").where("date", ">=", since).get(),
          meta.doc("bank").get(),
        ]);
        const txs = txSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
        const bank = bankSnap.exists ? bankSnap.data() : null;
        due.push(...decideSavings(now, settings, pushlog, { goals, txs, bank }));
      }
    } catch (e) {
      warn("Sparziele", e);
    }
    // Update 10 F – ☀️ Morgen-Briefing (nur wenn eingeschaltet; liest dann alle Planer-Einträge + Orte, protokolliert nichts davon)
    if (briefingDue(now, settings, pushlog)) {
      try {
        const [allTodos, placeSnap] = await Promise.all([userRef.collection("todos").get(), userRef.collection("places").get()]);
        due.push(...decideBriefing(now, settings, pushlog, allTodos.docs.map((d) => ({ ...d.data(), id: d.id })), placeSnap.docs.map((d) => ({ ...d.data(), id: d.id }))));
      } catch (e) {
        warn("Briefing", e);
      }
    }
    if (logSnap.exists) await pruneLog(meta.doc("pushlog"), pushlog, todayKey);
    // Update 9 – Budget-Warnungen: nur lesen, wenn es überhaupt ein Budget gibt
    const budget = await loadBudget(userRef, meta, uid);
    if (budget) due.push(...decideBudget(now, settings, budget.txs, budget.budgets, budget.cats, budget.state));
    const budgetSent = [];
    let live = tokens;
    for (const n of due) {
      if (!live.length) break;
      const data = { title: n.title, body: n.body, url: n.url, tag: n.tag };
      const webTokens = live.filter((t) => !isAndroid(t));
      const androidTokens = live.filter(isAndroid);
      const batches = [];
      if (webTokens.length) batches.push([webTokens, {
        tokens: webTokens,
        data,
        webpush: { headers: { Urgency: "high", TTL: "3600" } },
      }]);
      if (androidTokens.length) batches.push([androidTokens, {
        tokens: androidTokens,
        data,
        android: {
          priority: "high",
          ttl: 3600 * 1000,
          notification: { title: n.title, body: n.body, channelId: "erinnerungen", tag: n.tag },
        },
      }]);
      const res = { successCount: 0 };
      const bad = [];
      for (const [list, msg] of batches) {
        const r0 = await messaging.sendEachForMulticast(msg);
        res.successCount += r0.successCount;
        r0.responses.forEach((r, i) => {
          if (!r.success && r.error && BAD_TOKEN.has(r.error.code)) bad.push(list[i]);
          else if (!r.success) { failed++; errCodes.add(codeOf(r.error)); }
        });
      }
      if (bad.length) {
        const args = [];
        for (const t of bad) args.push(new FieldPath("tokens", t), FieldValue.delete());
        await meta.doc("push").update(...args);
        live = live.filter((t) => !bad.includes(t));
        removed += bad.length;
      }
      if (res.successCount > 0 && n.alerts) {
        budgetSent.push(...n.alerts);
        sent++;
      } else if (res.successCount > 0) {
        await writeLog(meta.doc("pushlog"), [...n.log, [["updatedAt"], now]]);
        sent++;
      }
    }
    if (budgetSent.length) {
      await meta.doc("budget_alerts").set({ ...applyBudgetAlerts(budget.state, todayKey, budgetSent), updatedAt: now });
    }
  } catch (e) {
    errors++;
    errCodes.add(codeOf(e));
  }
}
const extra = [
  failed ? `${failed} nicht zugestellt` : "",
  removed ? `${removed} ungültige(s) Token entfernt` : "",
  warnings ? `${warnings} Warnung(en)` : "",
  errors ? `${errors} Fehler` : "",
].filter(Boolean);
console.log(`${users} Nutzer, ${sent} Nachricht(en) gesendet${extra.length ? ` · ${extra.join(" · ")} (Codes: ${[...errCodes].join(", ")})` : ""}.`);
