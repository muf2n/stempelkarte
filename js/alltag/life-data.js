// Update 12 – gemeinsamer Datenlader für 📊 Statistik und 🎮 Spielwelt: beobachtet alle nötigen Sammlungen + Haupt-Speicher
// und liefert die Eingabe für js/life-core.js. Geld nur ohne Geld-Sperre.
import { collection } from "./db.js";
import * as store from "../store.js";

const COLS = { freizeit: "freizeit", haushalt: "haushalt", habits: "habits", goals: "goals", learn: "learn_progress", lists: "freizeit_listen",
  trips: "travel_trips", journal: "travel_journal", plan: "essensplan", money: "money_tx" };

export function watchLife(cb) {
  let lock = null, queued = false, alive = true;
  const fire = () => { if (queued || !alive) return; queued = true; setTimeout(() => { queued = false; if (alive) cb(input()); }, 30); };
  const cols = Object.fromEntries(Object.entries(COLS).map(([k, n]) => [k, collection(n)]));
  function input() {
    const snap = store.get() || {};
    const locked = !!(lock && lock.isLocked());
    const o = { entries: snap.entries || [], todos: snap.todos || [], settings: snap.settings || {}, moneyLocked: locked, now: Date.now() };
    for (const [k, c] of Object.entries(cols)) o[k] = k === "money" && locked ? [] : c.all();
    return o;
  }
  const offs = Object.values(cols).map((c) => c.watch(fire));
  offs.push(store.subscribe(fire));
  import("./money-lock-state.js").then((m) => { lock = m; if (alive) { offs.push(m.onChange(fire) || (() => {})); fire(); } }).catch(() => {});
  return { input, off: () => { alive = false; offs.forEach((f) => { try { typeof f === "function" && f(); } catch { /* egal */ } }); } };
}
