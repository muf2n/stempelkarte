// Gemeinsamer Datenspeicher für die „Alltag“-Bereiche (Geld, Schule, …).
// Jeder Bereich hat eigene Sammlungen: Cloud → users/{uid}/a_<name>/{id}, lokal → localStorage "sk-a-<name>".
// NICHT im Haupt-Snapshot (store.js) – wird erst geladen, wenn der Bereich geöffnet wird.
//
//   const col = collection("money_tx");
//   const off = col.watch(items => …);   // sofort + bei jeder Änderung (Array, unsortiert)
//   await col.put({ id?, ...felder });   // legt an / ersetzt komplett, gibt id zurück
//   await col.patch(id, { feld: wert }); // Teil-Änderung
//   await col.remove(id);
//   col.all();                            // letzter bekannter Stand (Array)

import * as store from "../store.js";
import { getFirebase } from "../firebase.js";

const cols = new Map();

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function clean(obj) {
  // undefined entfernen (Firestore mag das nicht)
  return JSON.parse(JSON.stringify(obj));
}

class Collection {
  constructor(name) {
    this.name = name;
    this.items = new Map();
    this.listeners = new Set();
    this.unsub = null;
    this.key = null; // mode+uid, für den das geladen ist
    this.started = false;
    store.subscribe((s) => this._sync(s));
  }

  _ident(s) {
    if (!s || !s.mode) return null;
    if (s.mode === "local") return "local";
    return s.user && s.user.uid ? "cloud:" + s.user.uid : null;
  }

  _sync(s) {
    if (!this.started) return;
    const k = this._ident(s);
    if (k === this.key) return;
    this._stop();
    this.key = k;
    this.items = new Map();
    if (!k) { this._emit(); return; }
    if (k === "local") this._startLocal(); else this._startCloud(s.user.uid);
  }

  _stop() {
    if (this.unsub) { try { this.unsub(); } catch {} }
    this.unsub = null;
  }

  _lsKey() { return "sk-a-" + this.name; }

  _startLocal() {
    try {
      const arr = JSON.parse(localStorage.getItem(this._lsKey()) || "[]");
      for (const it of arr) if (it && it.id) this.items.set(it.id, it);
    } catch {}
    const onStorage = (ev) => { if (ev.key === this._lsKey()) { this.key = null; this._sync(store.get()); } };
    window.addEventListener("storage", onStorage);
    this.unsub = () => window.removeEventListener("storage", onStorage);
    this._emit();
  }

  _saveLocal() {
    try { localStorage.setItem(this._lsKey(), JSON.stringify([...this.items.values()])); }
    catch (err) { console.warn("Alltag lokal speichern fehlgeschlagen:", err); }
  }

  async _startCloud(uid) {
    const myKey = this.key;
    const f = await getFirebase();
    if (!f || this.key !== myKey) return;
    const { db, fs } = f;
    this.unsub = fs.onSnapshot(fs.collection(db, "users", uid, "a_" + this.name), (qs) => {
      if (this.key !== myKey) return;
      const m = new Map();
      qs.forEach((d) => m.set(d.id, { ...d.data(), id: d.id }));
      this.items = m;
      this._emit();
    }, (err) => console.error("Alltag-Listener „" + this.name + "“:", err));
    this._emit();
  }

  _emit() {
    const arr = this.all();
    for (const cb of this.listeners) { try { cb(arr); } catch (err) { console.error(err); } }
  }

  _ensure() {
    if (!this.started) { this.started = true; this._sync(store.get()); }
  }

  all() { this._ensure(); return [...this.items.values()]; }

  get(id) { this._ensure(); return this.items.get(id) || null; }

  watch(cb) {
    this._ensure();
    this.listeners.add(cb);
    try { cb(this.all()); } catch (err) { console.error(err); }
    return () => this.listeners.delete(cb);
  }

  async _cloud(fn) {
    const s = store.get();
    const f = await getFirebase();
    if (!f || !s.user) throw new Error("Nicht angemeldet.");
    return fn(f.db, f.fs, s.user.uid);
  }

  async put(item) {
    this._ensure();
    const id = item.id || newId();
    const data = clean({ ...item, id, updated: Date.now(), created: item.created || Date.now() });
    this.items.set(id, data);
    if (this.key === "local") { this._saveLocal(); this._emit(); return id; }
    this._emit();
    await this._cloud((db, fs, uid) => fs.setDoc(fs.doc(db, "users", uid, "a_" + this.name, id), data));
    return id;
  }

  async patch(id, partial) {
    const cur = this.get(id);
    if (!cur) return this.put({ ...partial, id });
    return this.put({ ...cur, ...partial, id });
  }

  async remove(id) {
    this._ensure();
    this.items.delete(id);
    if (this.key === "local") { this._saveLocal(); this._emit(); return; }
    this._emit();
    await this._cloud((db, fs, uid) => fs.deleteDoc(fs.doc(db, "users", uid, "a_" + this.name, id)));
  }
}

export function collection(name) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Ungültiger Sammlungsname: " + name);
  if (!cols.has(name)) cols.set(name, new Collection(name));
  return cols.get(name);
}

export { newId };
