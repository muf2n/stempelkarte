// Update 10 – 🔔 Benachrichtigungszentrale: reine Logik ohne DOM (Node-testbar).
// collect() sammelt aus echten Daten Hinweise → [{ id, kind, emoji, title, sub, when, prio, target }]
//   kind   = Kategorie (siehe CATS, abschaltbar unter Einstellungen › Benachrichtigungen)
//   prio   = 3 dringend · 2 heute · 1 bald · 0 Info
//   target = "#agenda" | "#alltag/geld" | "todo:<id>" | "settings:backup" | "weekreport" | …
// Gelesen/weggewischt: Zustand { read: {id: ts}, dismissed: {id: ts} } (localStorage, siehe js/notify.js).
// Geld-Sperre aktiv → keine Beträge in den Texten.

import { expandTodo } from "./cal-core.js";
import { nextBirthday } from "./planer-core.js";
import { subStatus, reminderId, isActive } from "./alltag/subs-core.js";
import { budgetStatus, levelRank, eurS, eur, DEFAULT_CATS } from "./alltag/money-core.js";
import { missingStamps } from "./worktime-core.js";
import { wantsFridayTip, weekKeyOf, mondayOfWeek } from "./weekreport-core.js";
import { needsReminder } from "./backup-core.js";
import { dueTools } from "./alltag/werkzeug-core.js";
import { dueVehicles } from "./alltag/fahrzeug-core.js";
import { readVehicles, defaultVehicle } from "./trip-core.js";

export const CATS = [
  { id: "aufgaben", e: "✅", t: "Fällige Aufgaben" },
  { id: "termine", e: "📅", t: "Termine heute & morgen" },
  { id: "geburtstage", e: "🎂", t: "Geburtstage" },
  { id: "geld", e: "💶", t: "Budget & Abos" },
  { id: "dokumente", e: "📄", t: "Ablaufende Dokumente" },
  { id: "arbeitszeit", e: "⏱️", t: "Vergessene Stempelungen" },
  { id: "schule", e: "🏫", t: "Prüfungen & Hausübungen" },
  { id: "material", e: "🧰", t: "Fehlendes Material" },
  { id: "werkzeug", e: "🔧", t: "Werkzeug-Prüfungen" },
  { id: "fahrzeug", e: "🚗", t: "Pickerl, Service & Versicherung" },
  { id: "bericht", e: "📒", t: "Wochenbericht am Freitag" },
  { id: "backup", e: "💾", t: "Backup-Erinnerung" },
];
export const CAT_IDS = CATS.map((c) => c.id);

/** Welche Alltag-Sammlungen eine Kategorie braucht (js/notify.js lädt nur die). */
export const NEEDS = {
  geld: ["money_subs", "money_budget"],
  schule: ["school_exams", "school_tasks"],
  material: ["material_items"],
  werkzeug: ["werkzeug"],
  fahrzeug: ["fahrzeug_info", "travel_fuel"],
  bericht: ["berichtsheft"],
};

const pad = (n) => String(n).padStart(2, "0");
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addKey = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
const diff = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const fmt = (k) => { const d = dateOf(k); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
const tsOf = (k, time) => { const d = dateOf(k); const m = /^(\d{1,2}):(\d{2})/.exec(time || ""); if (m) d.setHours(+m[1], +m[2]); return d.getTime(); };
function rel(k, today) {
  const d = diff(today, k);
  if (d === 0) return "heute";
  if (d === 1) return "morgen";
  if (d === -1) return "gestern";
  if (d < 0) return `seit ${fmt(k)}`;
  return d < 7 ? `in ${d} Tagen` : `am ${fmt(k)}`;
}
const s = (v) => String(v ?? "").trim();

/** Einstellungen → { off: Set } (settings.notify.off = Liste abgeschalteter Kategorien). */
export function readPrefs(settings) {
  const n = settings && settings.notify && typeof settings.notify === "object" ? settings.notify : {};
  return { off: new Set(Array.isArray(n.off) ? n.off.filter((x) => CAT_IDS.includes(x)) : []) };
}
export function prefsForSave(off) { return { off: CAT_IDS.filter((id) => off.has(id)) }; }

/**
 * Hinweise sammeln.
 * input = { now, todos, entries, running, settings, cols: {name: [docs]}, loaded: {name: bool},
 *           moneyLocked, lastBackupAt, hasData }
 */
export function collect(input = {}) {
  const now = Number(input.now) || Date.now();
  const today = keyOf(new Date(now));
  const tomorrow = addKey(today, 1);
  const off = readPrefs(input.settings).off;
  const on = (k) => !off.has(k);
  const cols = input.cols || {};
  const loaded = input.loaded || {};
  const col = (n) => (loaded[n] && Array.isArray(cols[n]) ? cols[n] : null);
  const todos = Array.isArray(input.todos) ? input.todos : [];
  const locked = !!input.moneyLocked;
  const out = [];
  const add = (x) => out.push({ sub: "", ...x });

  /* --- Aufgaben (inkl. Dokument-Erinnerungen vr_… und Abo-Erinnerungen src:"abo") --- */
  for (const t of todos) {
    if (!t || t.done || t.kind !== "todo" || !RE_KEY.test(s(t.date)) || t.date > tomorrow) continue;
    const kind = String(t.id || "").startsWith("vr_") ? "dokumente" : t.src === "abo" ? "geld" : "aufgaben";
    if (!on(kind)) continue;
    const over = t.date < today;
    const emoji = kind === "dokumente" ? "📄" : kind === "geld" ? "🔁" : over ? "⏰" : "✅";
    add({
      id: `todo:${t.id}:${t.date}`, kind, emoji,
      title: s(t.title) || "Aufgabe",
      sub: over ? `Überfällig – ${rel(t.date, today)}` : `Fällig ${rel(t.date, today)}${t.time ? " um " + t.time : ""}`,
      when: tsOf(t.date, t.time), prio: over ? 3 : t.date === today ? 2 : 1, target: `todo:${t.id}`,
    });
  }

  /* --- Termine heute/morgen (auch Serien) --- */
  if (on("termine")) {
    for (const t of todos) {
      if (!t || t.kind !== "termin" || t.done) continue;
      let inst = [];
      try { inst = expandTodo(t, today, tomorrow); } catch { inst = []; }
      for (const i of inst) {
        if (i.done) continue;
        const start = tsOf(i.date, i.time);
        const end = Number.isFinite(i.endAbs) ? tsOf(i.date) + i.endAbs * 60000 : start + 3600e3; // endAbs = Minuten ab Tagesbeginn
        if (!i.allDay && end < now) continue; // schon vorbei
        const day = i.date < today ? today : i.date;
        add({
          id: `termin:${t.id}:${i.key || i.date}`, kind: "termine", emoji: "📅",
          title: s(i.title || t.title) || "Termin",
          sub: `${day === today ? "Heute" : "Morgen"}${i.allDay ? " (ganztägig)" : " um " + i.time}${s(i.location || t.location) ? " · " + s(i.location || t.location) : ""}`,
          when: start, prio: day === today ? 2 : 1, target: "#agenda",
        });
      }
    }
  }

  /* --- Geburtstage --- */
  if (on("geburtstage")) {
    for (const t of todos) {
      if (!t || t.kind !== "geburtstag") continue;
      const n = nextBirthday(t, today);
      if (!n) continue;
      const lead = Math.max(1, Math.min(30, Number(t.remindDays) || 0));
      if (n.days > lead) continue;
      const name = s(t.title).replace(/^geburtstag[:\s-]*/i, "") || "Jemand";
      add({
        id: `bday:${t.id}:${n.key}`, kind: "geburtstage", emoji: "🎂",
        title: n.days === 0 ? `${name} hat heute Geburtstag 🎉` : `${name} hat ${rel(n.key, today)} Geburtstag`,
        sub: n.age ? `wird ${n.age}` : "", when: tsOf(n.key), prio: n.days === 0 ? 2 : n.days === 1 ? 1 : 0, target: "#agenda",
      });
    }
  }

  /* --- Geld: Budget-Warnungen und Abos --- */
  if (on("geld")) {
    const budgets = col("money_budget");
    const tx = col("money_tx");
    if (budgets && budgets.length && tx) {
      const mk = today.slice(0, 7);
      const cats = col("money_cats");
      let rows = [];
      try { rows = budgetStatus(tx, budgets, mk, cats && cats.length ? [...cats, ...DEFAULT_CATS] : DEFAULT_CATS); } catch { rows = []; }
      for (const r of rows) {
        const lv = levelRank(r);
        if (lv < 1) continue;
        const nm = r.id === "total" ? "Gesamtbudget" : `Budget ${r.name}`;
        const over = r.ratio > 1;
        add({
          id: `budget:${r.id}:${mk}:${lv}`, kind: "geld", emoji: lv >= 2 ? "🛑" : "⚠️",
          title: over ? `${nm} überschritten` : lv >= 2 ? `${nm} aufgebraucht` : `${nm} fast aufgebraucht`,
          sub: locked ? "🔐 Beträge sind gesperrt" : `${eurS(r.spent)} von ${eurS(r.limit)}`,
          when: now, prio: lv >= 2 ? 3 : 1, target: "#alltag/geld",
        });
      }
    }
    const subs = col("money_subs");
    if (subs) {
      const todoIds = new Set(todos.map((t) => t && t.id));
      for (const sb of subs) {
        if (!sb || sb.deleted) continue;
        let st;
        try { st = subStatus(sb, today); } catch { continue; }
        const name = s(sb.name) || "Abo";
        if ((st.kind === "term" || st.kind === "trial") && st.deadline && st.daysToDeadline >= 0 && st.daysToDeadline <= 14 && !todoIds.has(reminderId(sb.id, st.deadline))) {
          const d = st.daysToDeadline;
          add({
            id: `abo:${sb.id}:${st.deadline}`, kind: "geld", emoji: st.kind === "trial" ? "🧪" : "✂️",
            title: st.kind === "trial" ? `${name}: Testzeitraum endet bald` : `${name}: Kündigungsfrist ${rel(st.deadline, today)}`,
            sub: `Spätestens kündigen ${rel(st.deadline, today)} – nur wenn du's nicht mehr brauchst`,
            when: tsOf(st.deadline), prio: d <= 3 ? 3 : d <= 7 ? 2 : 1, target: "#alltag/geld",
          });
        }
        let active = false;
        try { active = isActive(sb, today); } catch { active = false; }
        if (active && st.next && RE_KEY.test(st.next) && st.next >= today && diff(today, st.next) <= 2 && st.kind !== "trial") {
          const amt = !locked && Number(sb.amount) > 0 ? ` · ${eur(sb.amount)}` : "";
          add({
            id: `abocharge:${sb.id}:${st.next}`, kind: "geld", emoji: "🔁",
            title: `${name} wird ${rel(st.next, today)} abgebucht`, sub: `Abo-Verlängerung${amt}`,
            when: tsOf(st.next), prio: st.next === today ? 1 : 0, target: "#alltag/geld",
          });
        }
      }
    }
  }

  /* --- Arbeitszeit: vergessene Stempelungen --- */
  if (on("arbeitszeit") && Array.isArray(input.entries) && (input.entries.length || input.running)) {
    let gaps = [];
    try { gaps = missingStamps({ entries: input.entries, settings: input.settings || {}, running: input.running || null, now, days: 7 }); } catch { gaps = []; }
    const empty = gaps.filter((g) => g.type === "leer");
    for (const g of gaps) {
      if (g.type === "leer") continue;
      if (g.type === "laeuft") {
        add({ id: `stamp:laeuft:${g.key}`, kind: "arbeitszeit", emoji: "⏱️", title: `Du bist seit ${Math.floor(g.min / 60)} h eingestempelt`, sub: "Vergessen auszustempeln?", when: now, prio: 3, target: "#heute" });
      } else if (g.type === "offen") {
        add({ id: `stamp:offen:${g.entry && g.entry.id}`, kind: "arbeitszeit", emoji: "🕳️", title: `Schicht am ${fmt(g.key)} ohne Ende`, sub: "Bitte Endzeit nachtragen", when: tsOf(g.key), prio: 2, target: "#eintraege" });
      } else if (g.type === "lang") {
        add({ id: `stamp:lang:${g.entry && g.entry.id}`, kind: "arbeitszeit", emoji: "🧐", title: `Über 12 h am ${fmt(g.key)}`, sub: "Stimmt die Schicht so?", when: tsOf(g.key), prio: 1, target: "#eintraege" });
      }
    }
    if (empty.length === 1) {
      add({ id: `stamp:leer:${empty[0].key}`, kind: "arbeitszeit", emoji: "📝", title: `Kein Eintrag am ${fmt(empty[0].key)}`, sub: "Vergessen zu stempeln?", when: tsOf(empty[0].key), prio: 1, target: "#eintraege" });
    } else if (empty.length > 1) {
      add({ id: `stamp:leer:${empty.map((g) => g.key).join(",")}`, kind: "arbeitszeit", emoji: "📝", title: `${empty.length} Arbeitstage ohne Eintrag`, sub: empty.slice(0, 3).map((g) => fmt(g.key)).join(", ") + (empty.length > 3 ? " …" : ""), when: tsOf(empty[0].key), prio: 1, target: "#eintraege" });
    }
  }

  /* --- Schule: Prüfungen (7 Tage) und Hausübungen (bis morgen, überfällige) --- */
  if (on("schule")) {
    const exams = col("school_exams");
    for (const e of exams || []) {
      if (!e || !RE_KEY.test(s(e.date)) || e.date < today) continue;
      const d = diff(today, e.date);
      if (d > 7) continue;
      add({ id: `exam:${e.id}:${e.date}`, kind: "schule", emoji: "📝", title: `${s(e.kind) || "Prüfung"}${s(e.subject) ? " " + s(e.subject) : ""} ${rel(e.date, today)}`, sub: s(e.topics).split("\n")[0].slice(0, 80) || "Viel Erfolg beim Lernen! 💪", when: tsOf(e.date, e.time), prio: d <= 1 ? 2 : 1, target: "#alltag/schule" });
    }
    const tasks = col("school_tasks");
    for (const t of tasks || []) {
      if (!t || t.done || !RE_KEY.test(s(t.due)) || t.due > tomorrow) continue;
      const over = t.due < today;
      add({ id: `hw:${t.id}:${t.due}`, kind: "schule", emoji: over ? "⏰" : "📚", title: `${s(t.subject) ? s(t.subject) + ": " : ""}${s(t.title) || "Hausübung"}`, sub: over ? `Überfällig – ${rel(t.due, today)}` : `Abgabe ${rel(t.due, today)}`, when: tsOf(t.due), prio: over ? 3 : t.due === today ? 2 : 1, target: "#alltag/schule" });
    }
  }

  /* --- Material: noch zu besorgen --- */
  if (on("material")) {
    const items = col("material_items");
    const need = (items || []).filter((x) => x && (x.status || "brauche") === "brauche");
    if (need.length) {
      add({ id: `mat:${today}:${need.length}`, kind: "material", emoji: "🧰", title: need.length === 1 ? "1 Sache noch zu besorgen" : `${need.length} Sachen noch zu besorgen`, sub: need.slice(0, 3).map((x) => s(x.name)).filter(Boolean).join(", ") + (need.length > 3 ? " …" : ""), when: now, prio: 0, target: "#alltag/material" });
    }
  }

  /* --- Werkzeug: Prüfung/Wartung bald oder überfällig --- */
  if (on("werkzeug")) {
    const tools = col("werkzeug");
    if (tools) for (const d of dueTools(tools, now)) {
      add({ id: `wz:${d.id}:${d.due}`, kind: "werkzeug", emoji: d.state === "ueber" ? "⏰" : "🔧", title: d.text.replace(/^\S+\s/, ""), when: now, prio: d.state === "ueber" ? 2 : 1, target: d.hash });
    }
  }

  /* --- Fahrzeuge: Pickerl, Service, Versicherung --- */
  if (on("fahrzeug")) {
    const infos = col("fahrzeug_info");
    const vehicles = readVehicles(input.settings || {});
    if (infos && vehicles.length) {
      const dv = defaultVehicle(input.settings || {});
      const defaultId = dv ? dv.id : null;
      for (const d of dueVehicles(vehicles, infos, col("travel_fuel") || [], now, { defaultId })) {
        const urgent = d.state === "abgelaufen" || d.state === "ueber";
        add({ id: `fz:${d.vehicleId || ""}:${d.kind}:${d.state}`, kind: "fahrzeug", emoji: d.e || "🚗", title: String(d.text || "").replace(/^\S+\s/, ""), when: now, prio: urgent ? 2 : 1, target: d.hash || "#alltag/fahrzeuge" });
      }
    }
  }

  /* --- Wochenbericht (Freitagnachmittag/Samstag) --- */
  if (on("bericht") && Array.isArray(input.entries)) {
    const week = weekKeyOf(today);
    const mon = mondayOfWeek(week);
    const worked = new Set(input.entries.filter((e) => e && (!e.kind || e.kind === "work") && !e.privateTrip && Number.isFinite(e.start))
      .map((e) => keyOf(new Date(e.start))).filter((k) => k >= mon && k <= today)).size;
    const docs = col("berichtsheft");
    if (docs && wantsFridayTip(now, { workedDays: worked })) {
      const doc = docs.find((x) => x && x.id === week);
      if (!(doc && doc.status === "abgegeben")) add({ id: `wr:${week}`, kind: "bericht", emoji: "📒", title: "Wochenbericht fällig", sub: "Mit einem Tipp vorausgefüllt – nur noch drüberschauen ✨", when: now, prio: 1, target: "weekreport" });
    }
  }

  /* --- Backup-Erinnerung --- */
  if (on("backup") && input.hasData && needsReminder(input.lastBackupAt, now)) {
    const last = Number(input.lastBackupAt) || 0;
    add({ id: `backup:${last}`, kind: "backup", emoji: "💾", title: last ? "Zeit für ein Backup" : "Noch kein Backup 🙈", sub: last ? `Das letzte ist ${Math.floor((now - last) / 86400000)} Tage her` : "Ein Tipp – und alles ist sicher", when: now, prio: 1, target: "settings:backup" });
  }

  return sortItems(out);
}

export function sortItems(items) {
  return [...items].sort((a, b) => b.prio - a.prio || a.when - b.when || a.id.localeCompare(b.id));
}

/* ---------- Gelesen / weggewischt ---------- */

export function emptyState() { return { read: {}, dismissed: {} }; }

export function normState(x) {
  const ok = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k, v]) => typeof k === "string" && Number.isFinite(Number(v)))) : {});
  return { read: ok(x && x.read), dismissed: ok(x && x.dismissed) };
}

/** Sichtbare Liste: weggewischte raus, read-Flag dran. */
export function view(items, state) {
  const st = normState(state);
  return items.filter((i) => !(i.id in st.dismissed)).map((i) => ({ ...i, read: i.id in st.read }));
}

export const unreadCount = (items, state) => view(items, state).filter((i) => !i.read).length;

export function markRead(state, ids, now = Date.now()) {
  const st = normState(state);
  for (const id of ids) st.read[id] = now;
  return st;
}

export function dismiss(state, id, now = Date.now()) {
  const st = normState(state);
  st.dismissed[id] = now;
  st.read[id] = now;
  return st;
}

/** Alte Einträge vergessen (nicht mehr aktuelle IDs älter als `days`). */
export function prune(state, items, now = Date.now(), days = 45) {
  const st = normState(state);
  const live = new Set(items.map((i) => i.id));
  const cut = now - days * 86400000;
  for (const k of ["read", "dismissed"]) for (const [id, ts] of Object.entries(st[k])) if (!live.has(id) && ts < cut) delete st[k][id];
  return st;
}
