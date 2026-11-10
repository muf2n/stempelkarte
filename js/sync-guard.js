// Update 11 – 🔄 Konflikt-Erkennung (Browser-Teil). Logik: ./sync-guard-core.js
// Speicher (nur dieses Gerät): localStorage „sk-sync-dev“ (Gerätekennung), „sk-sync-mine“ (eigene letzte Änderungen),
// „sk-sync-conflicts“ (offene Konflikte). Nur im Cloud-Modus aktiv – lokal gibt es nichts zu synchronisieren.
import * as G from "./sync-guard-core.js";

const K_DEV = "sk-sync-dev", K_MINE = "sk-sync-mine", K_CONF = "sk-sync-conflicts";
const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll → egal */ } };
const listeners = new Set();

export function deviceId() {
  let d = null;
  try { d = localStorage.getItem(K_DEV); } catch { d = null; }
  if (!d) { d = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); try { localStorage.setItem(K_DEV, d); } catch { /* egal */ } }
  return d;
}

/** Vor dem Hochladen: Zusatzfelder setzen und die Änderung merken. col z. B. "entries" oder "a:money_tx". */
export function beforeWrite(col, doc, known) {
  const now = Date.now();
  const out = G.stamp(doc, known, deviceId(), now);
  set(K_MINE, G.remember(get(K_MINE, {}), col, out, now));
  return out;
}

/** Vom Server bestätigte Version (kein hasPendingWrites) prüfen. */
export function onServerDoc(col, doc) {
  const mine = get(K_MINE, {});
  if (!mine[G.keyOf(col, doc && doc.id)]) return;
  const r = G.check(mine, col, doc, deviceId(), Date.now());
  set(K_MINE, r.mine);
  if (r.conflict) { set(K_CONF, G.addConflict(get(K_CONF, []), r.conflict)); emit(); }
}

export const conflicts = () => { const a = get(K_CONF, []); return Array.isArray(a) ? a : []; };
export function dismiss(key) { set(K_CONF, conflicts().filter((c) => c.key !== key)); emit(); }
export function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { const a = conflicts(); for (const cb of listeners) { try { cb(a); } catch (e) { console.error(e); } } }
