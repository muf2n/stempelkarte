// Update 10 – 🔒 Tresor-Sitzung für verschlüsselte 📁 Dokumente (und alles, was sie anzeigt: Suche, 📎-Listen, Baustelle).
// Hält den Tresor-Datenschlüssel (DEK, nicht exportierbar) NUR im Speicher – nie in localStorage/IndexedDB/Cache.
// Gleiche Auto-Sperre wie der Tresor: Einstellung settings.vault.autoLockMin (1/5/15, Standard 5) ohne Aktivität,
// 60 s im Hintergrund, Konto-Wechsel, Tresor ersetzt/gelöscht. Fehlversuche teilen sich den Zähler mit dem Tresor (sessionStorage).
// Der Tresor (vault.js) übergibt seinen Schlüssel nach dem Entsperren mit adopt() → einmal entsperren reicht.
import { collection } from "./db.js";
import * as V from "./vault-crypto.js";
import { failDelay } from "./vault-core.js";
import * as store from "../store.js";

const META_ID = "main";
const FAIL_KEY = "sk-tresor-fails";
const HIDDEN_LOCK_MS = 60000;
const CHOICES = [1, 5, 15];

let key = null, metaCt = "", reason = "";
let metaCol = null, ident = null;
let lastAct = Date.now(), idle = null, hiddenTimer = null, hiddenAt = 0;
const subs = new Set();

const testHook = () => {
  try {
    const h = ["localhost", "127.0.0.1"].includes(location.hostname) && window.__tresorTest || null;
    if (h && Number.isInteger(h.iter)) V._setMinIterForTests(h.iter);
    return h;
  } catch { return null; }
};
const identOf = (s) => (!s || !s.mode ? "" : s.mode === "local" ? "local" : (s.user && s.user.uid) || "");
const verOf = (m) => (m && m.verifier && m.verifier.ct) || "";

function emit() { for (const cb of [...subs]) { try { cb(); } catch (e) { console.error(e); } } }

function ensure() {
  if (metaCol) return;
  metaCol = collection("vault_meta");
  metaCol.watch(() => {
    const m = metaCol.get(META_ID);
    if (key && verOf(m) !== metaCt) lock(m ? "Der Tresor wurde ersetzt – bitte neu entsperren." : "Der Tresor wurde gelöscht.");
    else emit();
  });
  try {
    ident = identOf(store.get());
    store.subscribe((s) => { const id = identOf(s); if (id !== ident) { ident = id; lock(); } });
  } catch { /* ohne Store (Tests) */ }
  if (typeof document !== "undefined") {
    const bump = () => { lastAct = Date.now(); };
    ["pointerdown", "keydown", "input", "wheel", "touchstart"].forEach((t) => document.addEventListener(t, bump, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        clearTimeout(hiddenTimer);
        if (key) hiddenTimer = setTimeout(() => { if (document.visibilityState === "hidden" && key) lock("Gesperrt, weil die App im Hintergrund war."); }, hiddenMs());
      } else {
        clearTimeout(hiddenTimer);
        if (key && hiddenAt && Date.now() - hiddenAt >= hiddenMs()) lock("Gesperrt, weil die App im Hintergrund war.");
        hiddenAt = 0;
        lastAct = Date.now();
      }
    });
  }
}
const hiddenMs = () => (testHook() && testHook().hiddenMs) || HIDDEN_LOCK_MS;
function autoLockMin() {
  try { const m = Number(store.get().settings.vault.autoLockMin); return CHOICES.includes(m) ? m : 5; } catch { return 5; }
}
function startIdle() {
  clearInterval(idle);
  lastAct = Date.now();
  idle = setInterval(() => {
    const t = testHook();
    const ms = (t && t.autoLockMs) || autoLockMin() * 60000;
    if (key && Date.now() - lastAct >= ms) lock(`Automatisch gesperrt (${t && t.autoLockMs ? "Test" : autoLockMin() + " Min. ohne Aktivität"}).`);
  }, 500);
}

/* ---------- Fehlversuche (gleiches Format wie vault.js) ---------- */
function fails() { try { const s = JSON.parse(sessionStorage.getItem(FAIL_KEY) || "null"); if (s && Number.isFinite(s.n)) return { n: s.n, until: Number(s.until) || 0 }; } catch { /* egal */ } return { n: 0, until: 0 }; }
function recordFail() { const n = fails().n + 1; try { sessionStorage.setItem(FAIL_KEY, JSON.stringify({ n, until: Date.now() + failDelay(n) * 1000 })); } catch { /* egal */ } return n; }
function resetFails() { try { sessionStorage.removeItem(FAIL_KEY); } catch { /* egal */ } }
export const waitLeft = () => Math.max(0, Math.ceil((fails().until - Date.now()) / 1000));

/* ---------- Öffentlich ---------- */

export function meta() { ensure(); return metaCol.get(META_ID) || null; }
export const metaLoaded = () => { ensure(); return !!metaCol.loaded; };
export const hasVault = () => !!meta();
export const isUnlocked = () => !!key;
export const getKey = () => key;
export const lockReason = () => reason;
export function onChange(cb) { ensure(); subs.add(cb); return () => subs.delete(cb); }

/** Schlüssel übernehmen (vom Tresor nach dem Entsperren/Anlegen oder nach unlock()). */
export function adopt(k, m = null) {
  ensure();
  if (!k) return;
  testHook();
  key = k;
  metaCt = verOf(m || meta());
  reason = "";
  startIdle();
  emit();
}

/** Mit dem Tresor-Passwort entsperren. Wirft VaultError("wrong-password") bzw. Error mit code "wait". */
export async function unlock(password) {
  ensure();
  testHook();
  const left = waitLeft();
  if (left > 0) { const e = new Error(`Zu viele Fehlversuche – bitte ${left} s warten.`); e.code = "wait"; throw e; }
  const m = meta();
  if (!m) { const e = new Error("Es gibt noch keinen Tresor."); e.code = "no-vault"; throw e; }
  try {
    const k = await V.unlockVault(password, m);
    resetFails();
    adopt(k, m);
  } catch (e) {
    if (e && e.code === "wrong-password") { const n = recordFail(); e.fails = n; }
    throw e;
  }
}

export function lock(why = "") {
  const was = !!key;
  key = null;
  metaCt = "";
  clearInterval(idle); idle = null;
  clearTimeout(hiddenTimer);
  reason = why;
  if (was) emit();
}
