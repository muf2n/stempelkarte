// Update 10 – ⚡ Automationszentrum: Ausführung in der App (kein Server). Läuft, solange die App offen ist:
// bei jeder Änderung im Store / in den benötigten Sammlungen und jede Minute. Regeln + Logik: js/automation-core.js.
// Sammlungen: „automations“ (Regeln) und „automation_log“ (Verlauf, max. 100). Hinweise landen über den Verlauf
// in der 🔔 Benachrichtigungszentrale (notify-core Kategorie „automation“).
import * as AC from "./automation-core.js";
import { collection } from "./alltag/db.js";
import * as EK from "./alltag/einkauf-core.js";
import { siteHash } from "./site-core.js";

let ctx = null;
let snap = null;
let started = false;
let busy = false;
let queued = false;
let lockMod = null;
let privatMod = null;
const subs = new Map();
const data = new Map();
const ranLocal = new Set(); // Schlüssel dieser Sitzung (bevor der Verlauf zurückkommt)
const listeners = new Set();

/** Für die Oberfläche: cb() nach jedem Durchgang. */
export function onRun(cb) { listeners.add(cb); return () => listeners.delete(cb); }

export function start(c) {
  if (started) return;
  started = true;
  ctx = c;
  snap = ctx.store.get();
  ctx.store.subscribe((s) => { snap = s; schedule(); });
  watch("automations");
  setInterval(schedule, 60000);
  window.addEventListener("sk:automation-check", schedule);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(); });
  import("./alltag/money-lock-state.js").then((m) => { lockMod = m; m.onChange(schedule); }).catch(() => { /* ohne Geld-Sperre */ });
  import("./privat.js").then((m) => { privatMod = m; schedule(); }).catch(() => { /* ohne Privat-Modus */ });
  schedule();
}

function watch(name) {
  if (subs.has(name)) return;
  subs.set(name, () => {});
  try { subs.set(name, collection(name).watch((list) => { data.set(name, list || []); schedule(); })); }
  catch (err) { console.warn("Automationen: " + name, err); }
}
function unwatch(name) {
  const off = subs.get(name);
  if (!off) return;
  try { off(); } catch { /* egal */ }
  subs.delete(name);
  data.delete(name);
}
const loaded = (n) => { try { return subs.has(n) && collection(n).loaded; } catch { return false; } };

function schedule() {
  if (queued) return;
  queued = true;
  setTimeout(() => { queued = false; tick().catch((err) => console.error("Automationen:", err)); }, 400);
}

async function tick() {
  if (!snap || !snap.ready || !snap.mode || busy) return;
  const rules = (data.get("automations") || []).map(AC.normRule).filter((r) => r.id);
  const active = rules.filter((r) => r.enabled);
  const need = new Set(active.length ? ["automation_log", ...AC.neededCollections(active)] : []);
  for (const n of need) watch(n);
  for (const n of [...subs.keys()]) if (n !== "automations" && !need.has(n)) unwatch(n);
  if (!active.length || !loaded("automations") || ![...need].every(loaded)) return;
  const now = Date.now();
  const logs = data.get("automation_log") || [];
  const hist = AC.buildHistory(logs, rules, now);
  for (const k of ranLocal) hist.seen.add(k);
  const S = {
    now, running: snap.running, entries: snap.entries || [], todos: snap.todos || [], places: snap.places || [],
    privat: !!(privatMod && privatMod.isPrivatNow(snap, now)),
    moneyLocked: !lockMod || !lockMod.isLoaded() || lockMod.isLocked(), // unbekannt = gesperrt
    cols: Object.fromEntries([...data].filter(([n]) => n !== "automations" && n !== "automation_log")),
  };
  const runs = AC.plan(active, S, hist);
  if (!runs.length) return;
  busy = true;
  try {
    for (const run of runs) { ranLocal.add(run.key); await execute(run, now); }
    const drop = AC.pruneLog(collection("automation_log").all());
    for (const id of drop) collection("automation_log").remove(id).catch(() => { /* egal */ });
  } finally {
    busy = false;
    for (const cb of listeners) { try { cb(); } catch { /* egal */ } }
  }
}

/** Einen Lauf ausführen und im Verlauf festhalten. */
async function execute(run, now) {
  const fx = AC.effects(run, { now, siteHashOf: siteHash });
  const done = [], hints = [], errors = [];
  for (const f of fx) {
    try {
      if (f.kind === "hint") { hints.push(f.hint); done.push(`🔔 ${f.hint.title}`); }
      else if (f.kind === "error") errors.push(f.error);
      else if (f.kind === "task") { await ctx.store.saveTodo(f.todo); done.push(`✅ Aufgabe „${f.todo.title}“`); }
      else if (f.kind === "einkauf") {
        const items = collection("einkauf").all();
        const n = EK.norm(f.item.name);
        const dup = items.some((x) => x && !x.done && (x.listId || "privat") === f.item.listId && EK.norm(x.name) === n);
        if (dup) done.push(`🛒 „${f.item.name}“ steht schon auf der Liste`);
        else {
          const unit = EK.UNITS.includes(f.item.unit) ? f.item.unit : "Stk";
          await collection("einkauf").put(EK.normItem({ listId: f.item.listId, name: f.item.name, qty: f.item.qty, unit, cat: EK.guessCat(f.item.name) === "sonstiges" ? "baumarkt" : EK.guessCat(f.item.name), done: false, note: f.item.note, src: "automation" }, now));
          done.push(`🛒 „${f.item.name}“ → Baustelle`);
        }
      } else if (f.kind === "mode") {
        if (!privatMod) throw new Error("Privat-Modus nicht verfügbar.");
        if (snap.running && f.privat) { done.push("🔁 Privat-Modus übersprungen (du bist eingestempelt)"); continue; }
        if (privatMod.isPrivatNow(snap, now) !== f.privat) await privatMod.setMode(f.privat, null);
        done.push(f.privat ? "🏡 Privat-Modus an" : "🔧 Arbeitsmodus an");
      }
    } catch (err) {
      errors.push((err && err.message) || String(err));
    }
  }
  const log = { id: AC.logDocId(run.key), ruleId: run.rule.id, key: run.key, ts: now, ok: !errors.length, error: errors.join(" · ").slice(0, 300), name: run.rule.name, emoji: run.rule.emoji, done, hints };
  try { await collection("automation_log").put(log); } catch (err) { console.error("Automationen: Verlauf", err); }
  try { await collection("automations").patch(run.rule.id, AC.afterRun(collection("automations").get(run.rule.id) || run.rule, run.key, now)); } catch (err) { console.error("Automationen: Regel", err); }
}

/** Sofort prüfen (z. B. nach dem Speichern einer Regel). */
export function checkNow() { schedule(); }
