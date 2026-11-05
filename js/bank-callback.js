// Rückkehr von der Bank-Anmeldung (bank-callback.html) – ausgelagert wegen der Content-Security-Policy ohne 'unsafe-inline'.
import { getFirebase } from "./firebase.js";

const URL_KEY = "stempelkarte.ai.url";
const FLASH_KEY = "stempelkarte.bank.flash";
const DEFAULT_URL = "https://stempelkarte-mcp.lippa-florian.workers.dev";
const $ = (id) => document.getElementById(id);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const clean = (u) => String(u || "").trim().replace(/\/+$/, "").replace(/\/(mcp|chat)$/, "");

function show(kind, title, text) {
  $("spin").hidden = true;
  $("ic").textContent = kind === "ok" ? "✅" : "⚠️";
  $("h").textContent = title;
  const m = $("msg");
  m.textContent = text;
  m.className = kind === "ok" ? "" : "err";
  $("back").hidden = false;
}

// Angemeldeten Nutzer abwarten (Firebase stellt die Sitzung aus dem Speicher wieder her)
async function currentUser(f) {
  if (!f) return null;
  if (f.auth.currentUser) return f.auth.currentUser;
  return new Promise((resolve) => {
    const t = setTimeout(() => { off(); resolve(null); }, 6000);
    const off = f.fa.onAuthStateChanged(f.auth, (u) => { clearTimeout(t); off(); resolve(u || null); });
  });
}

async function serverUrl(f, user) {
  const ls = lsGet(URL_KEY);
  if (ls) return clean(ls);
  if (f && user) {
    try {
      const d = await f.fs.getDoc(f.fs.doc(f.db, "users", user.uid, "meta", "settings"));
      const u = d.exists() && d.data().ai && d.data().ai.url;
      if (u) return clean(u);
    } catch { /* Standard */ }
  }
  return DEFAULT_URL;
}

async function main() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state"), error = q.get("error");
  // Code nicht in der Adresszeile/Verlauf stehen lassen
  try { history.replaceState(null, "", location.pathname); } catch { /* egal */ }
  if (error) {
    const why = error === "access_denied" ? "Die Freigabe wurde bei der Bank abgebrochen oder abgelehnt." : `Die Bank meldet: ${q.get("error_description") || error}`;
    show("err", "Nicht verbunden", why + " Du kannst es in der App jederzeit nochmal versuchen.");
    return;
  }
  if (!code || !state) {
    show("err", "Nichts zu tun", "Diese Seite wird nach der Anmeldung bei der Bank automatisch geöffnet. Starte die Verbindung in der App unter Alltag › Geld.");
    return;
  }
  let f = null, user = null;
  try { f = await getFirebase(); user = await currentUser(f); } catch { /* ohne Anmeldung weiter */ }
  const headers = { "Content-Type": "application/json" };
  if (user) { try { headers.Authorization = "Bearer " + (await user.getIdToken()); } catch { /* ohne */ } }
  let res, data = null;
  try {
    res = await fetch((await serverUrl(f, user)) + "/bank/finish", { method: "POST", headers, body: JSON.stringify({ code, state }) });
    try { data = await res.json(); } catch { /* leer */ }
  } catch {
    show("err", "Keine Verbindung", "Der Server war nicht erreichbar. Bitte prüfe dein Internet und starte die Verbindung in der App nochmal.");
    return;
  }
  if (!res.ok) {
    show("err", "Verbindung fehlgeschlagen", (data && data.error) || `Fehler ${res.status}. Bitte in der App nochmal versuchen.`);
    return;
  }
  const n = Number(data && data.imported) || 0;
  const msg = data && data.warn ? data.warn : n ? `Mit BAWAG verbunden ✓ – ${n} Buchung${n === 1 ? "" : "en"} übernommen` : "Mit BAWAG verbunden ✓";
  if (user) {
    lsSet(FLASH_KEY, JSON.stringify({ ok: true, msg, t: Date.now() }));
    location.replace("./#alltag/geld");
    return;
  }
  // z. B. im Handy-Browser außerhalb der App: dort ist niemand angemeldet
  show("ok", "Verbunden ✓", msg.replace(/ ✓/, "") + ". Du kannst dieses Fenster schließen und zur Stempelkarte zurückkehren.");
}
main();
