// Update 12 – 🎮 Spielwelt – reine Logik (kein DOM).
// Grundsatz: motivieren, nie bestrafen. XP entstehen nur aus echten Aktivitäten (js/life-core.js), gehen nie verloren,
// Quests laufen einfach ab (keine Strafe), Pausen/Urlaub/Krankheit ändern nichts. Das Haustier schläft höchstens, es leidet nie.
// Gespeichert wird nur Spiel-Kleinkram in der Alltag-Sammlung „spiel“, Dokument "me":
//   { id:"me", claimed: { questKey: true }, ach: { id: ms }, spent, owned: [itemId], wear: { hat, frame, pet }, pet: { name, fedDay, fed },
//     avatar, records: { gameId: Bestwert }, wheel: [Optionen], secret: { id: ms } }

import { AREAS, addDays } from "./life-core.js";

const s = (v) => (v == null ? "" : String(v)).trim();
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };

/** XP je Aktivität. */
export const XP = { arbeitstag: 20, aufgabe: 5, sport: 0, zuhause: 0, hausarbeit: 10, gewohnheit: 4, meilenstein: 30, ziel: 100, "lern-xp": 0.5, liste: 15, reisetag: 25, tagebuch: 10, gekocht: 8 };
export function xpOf(a) {
  if (a.kind === "sport") return Math.min(60, Math.round(a.min / 3)); // 3 min = 1 XP, max 60 am Stück
  if (a.kind === "zuhause") return Math.min(30, Math.round(a.min / 5));
  return Math.round((XP[a.kind] || 0) * (a.n || 1));
}
export function totalXp(acts, to = "9999-12-31") { let x = 0; for (const a of acts) if (a.day <= to) x += xpOf(a); return x; }
export function xpByArea(acts) { const o = Object.fromEntries(AREAS.map((a) => [a.id, 0])); for (const a of acts) if (o[a.area] != null) o[a.area] += xpOf(a); return o; }

/** Level: Level n braucht insgesamt 50·n·(n+1) XP (1→100, 2→300, 5→1500, 10→5500 …). */
export const xpForLevel = (n) => 50 * n * (n + 1);
export function levelOf(xp) {
  let n = 0;
  while (xp >= xpForLevel(n + 1) && n < 200) n++;
  const base = xpForLevel(n), next = xpForLevel(n + 1);
  return { level: n + 1, xp, into: xp - base, need: next - base, pct: Math.round(((xp - base) / (next - base)) * 100) };
}
/** Skill-Stufe je Bereich (0–10) aus Bereichs-XP. */
export const skillLevel = (xp) => Math.min(10, Math.floor(Math.sqrt(Math.max(0, xp) / 40)));
export const SKILL_TITLES = ["Neuling", "Anfänger", "Lehrling", "Geübt", "Fortgeschritten", "Könner", "Profi", "Experte", "Meister", "Großmeister", "Legende"];

/* ------------------------------------------------------------------ Quests */
// test(acts im Zeitraum) → Fortschritt 0…goal
const sum = (acts, f) => acts.filter(f).reduce((n, a) => n + (a.n || 1), 0);
const mins = (acts, f) => acts.filter(f).reduce((n, a) => n + (a.min || 0), 0);
export const DAILY = [
  { id: "d-aufgabe", e: "✅", t: "Erledige 2 Aufgaben", goal: 2, p: (a) => sum(a, (x) => x.kind === "aufgabe") },
  { id: "d-lernen", e: "📚", t: "Sammle 20 Lern-XP (LAP oder Japanisch)", goal: 20, p: (a) => sum(a, (x) => x.kind === "lern-xp") },
  { id: "d-haus", e: "🧽", t: "Hak eine Haushaltsaufgabe ab", goal: 1, p: (a) => sum(a, (x) => x.kind === "hausarbeit") },
  { id: "d-sport", e: "💪", t: "15 Minuten Bewegung", goal: 15, p: (a) => mins(a, (x) => x.kind === "sport") },
  { id: "d-gewohnheit", e: "🔥", t: "Hak eine Gewohnheit ab", goal: 1, p: (a) => sum(a, (x) => x.kind === "gewohnheit") },
  { id: "d-arbeit", e: "🛠️", t: "Stemple einen Arbeitstag", goal: 1, p: (a) => sum(a, (x) => x.kind === "arbeitstag") },
  { id: "d-koch", e: "🍳", t: "Plan heute ein Rezept ein", goal: 1, p: (a) => sum(a, (x) => x.kind === "gekocht") },
];
export const WEEKLY = [
  { id: "w-lernen", e: "🎓", t: "Lerne an 4 Tagen", goal: 4, p: (a) => new Set(a.filter((x) => x.area === "lernen").map((x) => x.day)).size },
  { id: "w-sport", e: "🏃", t: "90 Minuten Sport diese Woche", goal: 90, p: (a) => mins(a, (x) => x.kind === "sport") },
  { id: "w-haus", e: "🏡", t: "5 Haushaltsaufgaben", goal: 5, p: (a) => sum(a, (x) => x.kind === "hausarbeit") },
  { id: "w-aufgaben", e: "📋", t: "10 Aufgaben erledigt", goal: 10, p: (a) => sum(a, (x) => x.kind === "aufgabe") },
  { id: "w-liste", e: "🎬", t: "Etwas von deinen Freizeit-Listen abhaken", goal: 1, p: (a) => sum(a, (x) => x.kind === "liste") },
  { id: "w-bunt", e: "🌈", t: "In 4 verschiedenen Lebensbereichen aktiv", goal: 4, p: (a) => new Set(a.map((x) => x.area)).size },
];
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function pick(pool, n, seed) { const arr = [...pool]; const out = []; let h = hash(seed); while (out.length < n && arr.length) { out.push(arr.splice(h % arr.length, 1)[0]); h = hash(String(h)); } return out; }
export const mondayOf = (k) => { const d = dateOf(k); return addDays(k, -((d.getDay() + 6) % 7)); };

/** Quests für heute/diese Woche mit Fortschritt. disabled = Quest-IDs, die nicht passen (z. B. Modul aus). */
export function quests(acts, today, me = {}, disabled = []) {
  const ok = (q) => !disabled.includes(q.id);
  const wk = mondayOf(today);
  const todayActs = acts.filter((a) => a.day === today);
  const weekActs = acts.filter((a) => a.day >= wk && a.day <= addDays(wk, 6));
  const claimed = (me && me.claimed) || {};
  const mk = (q, scope, key, list, coins) => { const v = Math.min(q.goal, q.p(list)); return { ...q, scope, key, value: v, done: v >= q.goal, claimed: !!claimed[key], coins }; };
  return {
    daily: pick(DAILY.filter(ok), 3, "d" + today).map((q) => mk(q, "day", `${today}:${q.id}`, todayActs, 10)),
    weekly: pick(WEEKLY.filter(ok), 3, "w" + wk).map((q) => mk(q, "week", `${wk}:${q.id}`, weekActs, 30)),
  };
}

/* ------------------------------------------------------------------ Erfolge */
export function stats(acts) {
  const c = (k) => acts.filter((a) => a.kind === k).reduce((n, a) => n + (a.n || 1), 0);
  const days = new Set(acts.map((a) => a.day));
  let streak = 0, best = 0, prev = null;
  for (const d of [...days].sort()) { streak = prev && addDays(prev, 1) === d ? streak + 1 : 1; best = Math.max(best, streak); prev = d; }
  return { arbeitstage: c("arbeitstag"), aufgaben: c("aufgabe"), haus: c("hausarbeit"), lernxp: c("lern-xp"), sportMin: acts.filter((a) => a.kind === "sport").reduce((n, a) => n + a.min, 0),
    listen: c("liste"), reisetage: c("reisetag"), tagebuch: c("tagebuch"), gekocht: c("gekocht"), ziele: c("ziel"), gewohnheit: c("gewohnheit"),
    aktivTage: days.size, besteSerie: best, bereiche: new Set(acts.map((a) => a.area)).size };
}
export const ACHIEVEMENTS = [
  { id: "start", e: "🌱", t: "Erster Schritt", d: "Die erste Aktivität in der App", c: (s) => s.aktivTage >= 1 },
  { id: "arbeit10", e: "🔧", t: "Fleißige Hände", d: "10 Arbeitstage gestempelt", c: (s) => s.arbeitstage >= 10 },
  { id: "arbeit100", e: "🏗️", t: "Baustellen-Veteran", d: "100 Arbeitstage", c: (s) => s.arbeitstage >= 100 },
  { id: "aufgaben50", e: "📋", t: "Abhak-Profi", d: "50 Aufgaben erledigt", c: (s) => s.aufgaben >= 50 },
  { id: "haus25", e: "🧹", t: "Hausmeister:in", d: "25 Haushaltsaufgaben", c: (s) => s.haus >= 25 },
  { id: "lern500", e: "🧠", t: "Wissensdurst", d: "500 Lern-XP", c: (s) => s.lernxp >= 500 },
  { id: "lern3000", e: "🎓", t: "LAP-Kandidat", d: "3000 Lern-XP", c: (s) => s.lernxp >= 3000 },
  { id: "sport600", e: "🚴", t: "In Bewegung", d: "10 Stunden Sport", c: (s) => s.sportMin >= 600 },
  { id: "listen10", e: "🍿", t: "Genießer:in", d: "10 Dinge von den Freizeit-Listen abgehakt", c: (s) => s.listen >= 10 },
  { id: "reise7", e: "🧳", t: "Weltenbummler", d: "7 Reisetage", c: (s) => s.reisetage >= 7 },
  { id: "tagebuch5", e: "📔", t: "Erinnerungs-Sammler", d: "5 Tagebuch-Einträge", c: (s) => s.tagebuch >= 5 },
  { id: "koch10", e: "👨‍🍳", t: "Hobbykoch", d: "10 Mahlzeiten eingeplant", c: (s) => s.gekocht >= 10 },
  { id: "ziel1", e: "🎯", t: "Ziel erreicht", d: "Ein Ziel komplett geschafft", c: (s) => s.ziele >= 1 },
  { id: "serie7", e: "🔥", t: "Eine Woche dran", d: "7 Tage am Stück aktiv", c: (s) => s.besteSerie >= 7 },
  { id: "allround", e: "🌈", t: "Allrounder", d: "In allen 7 Lebensbereichen aktiv", c: (s) => s.bereiche >= 7 },
  // versteckt – erst sichtbar, wenn geschafft
  { id: "nacht", e: "🦉", t: "Nachteule", d: "Das Spiel nach Mitternacht geöffnet", secret: true, c: (s, x) => !!(x && x.secret && x.secret.nacht) },
  { id: "tipp7", e: "🐣", t: "Neugierig", d: "Den Avatar 7× angetippt", secret: true, c: (s, x) => !!(x && x.secret && x.secret.tipp7) },
  { id: "rad", e: "🎡", t: "Glücksrad-Fan", d: "Das Entscheidungsrad 10× gedreht", secret: true, c: (s, x) => Number(x && x.records && x.records.spins) >= 10 },
  { id: "ohm", e: "⚡", t: "Ohm'sches Genie", d: "15 Punkte im Ohm-Blitz", secret: true, c: (s, x) => Number(x && x.records && x.records.ohm) >= 15 },
];
export function achievements(st, me = {}) { return ACHIEVEMENTS.map((a) => ({ ...a, got: !!a.c(st, me) })); }

/* ------------------------------------------------------------------ Münzen & Shop */
export const SHOP = [
  { id: "hat-helm", slot: "hat", e: "⛑️", t: "Schutzhelm", price: 30 },
  { id: "hat-krone", slot: "hat", e: "👑", t: "Krone", price: 200 },
  { id: "hat-zauber", slot: "hat", e: "🎩", t: "Zylinder", price: 80 },
  { id: "hat-party", slot: "hat", e: "🥳", t: "Partyhut", price: 50 },
  { id: "frame-blitz", slot: "frame", e: "⚡", t: "Blitz-Rahmen", price: 60, color: "#facc15" },
  { id: "frame-regenbogen", slot: "frame", e: "🌈", t: "Regenbogen-Rahmen", price: 150, color: "conic" },
  { id: "frame-gold", slot: "frame", e: "🥇", t: "Gold-Rahmen", price: 300, color: "#d4a017" },
  { id: "pet-katze", slot: "pet", e: "🐱", t: "Katze", price: 100 },
  { id: "pet-drache", slot: "pet", e: "🐲", t: "Drache", price: 400 },
  { id: "pet-roboter", slot: "pet", e: "🤖", t: "Roboter", price: 250 },
];
export const DEFAULT_PET = { id: "pet-funki", e: "⚡", t: "Funki" };
export function coins(q, ach, me = {}) {
  const claimed = Object.keys((me && me.claimed) || {});
  let earned = 0;
  for (const k of claimed) earned += /^\d{4}-\d{2}-\d{2}:w-/.test(k) ? 30 : 10;
  earned += ach.filter((a) => a.got).length * 25;
  return Math.max(0, earned - (Number(me.spent) || 0)); // spent kann negativ sein → Ausgleich für aufgeräumte Quests
}
export function buy(me, item, have) {
  const owned = Array.isArray(me.owned) ? me.owned : [];
  if (owned.includes(item.id)) return { ok: false, why: "Hast du schon" };
  if (have < item.price) return { ok: false, why: `Dir fehlen noch ${item.price - have} 🪙` };
  return { ok: true, me: { ...me, owned: [...owned, item.id], spent: (Number(me.spent) || 0) + item.price, wear: { ...(me.wear || {}), [item.slot]: item.id } } };
}

/* ------------------------------------------------------------------ Haustier */
/** Stimmung aus den letzten 3 Tagen + Füttern heute. Nie traurig – höchstens müde. */
export function petMood(acts, today, me = {}) {
  const from = addDays(today, -2);
  const n = acts.filter((a) => a.day >= from && a.day <= today).length;
  const fed = me.pet && me.pet.fedDay === today;
  const score = Math.min(3, Math.floor(n / 3)) + (fed ? 1 : 0);
  return [{ e: "😴", t: "döst gemütlich – mach was, dann wacht es auf" }, { e: "🙂", t: "ist entspannt" }, { e: "😄", t: "freut sich" }, { e: "🤩", t: "ist total happy" }, { e: "🥰", t: "liebt dich!" }][score];
}

/* ------------------------------------------------------------------ Welt */
export const ZONES = [
  { id: "werkstatt", lvl: 1, e: "🔧", t: "Werkstatt", area: "arbeit" },
  { id: "garten", lvl: 2, e: "🌻", t: "Garten", area: "haushalt" },
  { id: "bibliothek", lvl: 3, e: "📚", t: "Bibliothek", area: "lernen" },
  { id: "sportplatz", lvl: 5, e: "🏟️", t: "Sportplatz", area: "sport" },
  { id: "kino", lvl: 7, e: "🎪", t: "Freizeitpark", area: "freizeit" },
  { id: "rathaus", lvl: 9, e: "🏛️", t: "Rathaus", area: "orga" },
  { id: "hafen", lvl: 12, e: "⛵", t: "Hafen", area: "reisen" },
  { id: "berg", lvl: 15, e: "🏔️", t: "Gipfel", area: null },
  { id: "schloss", lvl: 20, e: "🏰", t: "Schloss", area: null },
  { id: "rakete", lvl: 30, e: "🚀", t: "Raumstation", area: null },
];
/** Zonen mit Freischalt-Status und „Ausbaustufe“ (Skill des Bereichs). */
export function world(level, areaXp) {
  return ZONES.map((z) => ({ ...z, open: level >= z.lvl, stage: z.area ? skillLevel(areaXp[z.area] || 0) : null }));
}

/* ------------------------------------------------------------------ Saison-Events */
function easter(y) { // Gauß
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export function season(today) {
  if (!RE_KEY.test(today)) return null;
  const md = today.slice(5), y = Number(today.slice(0, 4));
  const e = easter(y);
  if (md >= "12-01" && md <= "12-24") return { id: "advent", e: "🎄", t: "Adventzeit", d: "Jeden Tag ein Türchen: Hol dir täglich deine Quests!" };
  if (md >= "12-27" || md <= "01-02") return { id: "silvester", e: "🎆", t: "Jahreswechsel", d: "Schau dir deinen Jahresrückblick an! 🥂" };
  if (today >= addDays(e, -7) && today <= addDays(e, 1)) return { id: "ostern", e: "🐰", t: "Osterzeit", d: "Such das versteckte Ei in der Spielwelt 🥚" };
  if (md >= "10-25" && md <= "10-31") return { id: "halloween", e: "🎃", t: "Halloween", d: "Gruselig produktiv! 👻" };
  if (md >= "07-01" && md <= "08-31") return { id: "sommer", e: "☀️", t: "Sommer-Event", d: "Raus an die frische Luft – Sport zählt doppelt so schön 🏊" };
  if (md >= "02-01" && md <= "02-14") return { id: "fasching", e: "🎭", t: "Fasching", d: "Verkleide deinen Avatar im Shop 🥳" };
  return null;
}

/* ------------------------------------------------------------------ Mini-Games */
export const CHALLENGES = [
  "📵 30 Minuten ohne Handy – nur du und ein Buch oder Musik",
  "🚶 Geh 15 Minuten spazieren, ganz ohne Ziel",
  "💧 Trink heute 2 Liter Wasser",
  "🧹 5-Minuten-Blitzaufräumen in einem Zimmer",
  "📞 Ruf jemanden an, mit dem du lange nicht geredet hast",
  "🍳 Koch heute etwas, das du noch nie gemacht hast",
  "📚 Lerne 10 neue Japanisch-Wörter",
  "⚡ Erkläre jemandem den Unterschied zwischen FI und LS",
  "🧘 5 Minuten Dehnen nach der Arbeit",
  "🌅 Steh morgen 15 Minuten früher auf und genieß den Kaffee",
  "📝 Schreib 3 Dinge auf, für die du heute dankbar bist",
  "🚲 Fahr eine Strecke mit dem Rad statt mit dem Auto",
  "🧰 Sortier deine Werkzeugtasche",
  "🎵 Hör ein Album komplett durch, ohne zu skippen",
];
export const dailyChallenge = (today) => CHALLENGES[hash("c" + today) % CHALLENGES.length];
export function randomChallenge(rnd = Math.random) { return CHALLENGES[Math.floor(rnd() * CHALLENGES.length) % CHALLENGES.length]; }

/** Ohm-Blitz: Aufgabe zu U = R · I (ganzzahlige, schöne Werte). → { q, a, unit } */
export function ohmTask(rnd = Math.random) {
  const R = [10, 20, 22, 47, 50, 100, 220, 470][Math.floor(rnd() * 8)];
  const I = [0.1, 0.2, 0.5, 1, 2][Math.floor(rnd() * 5)];
  const U = Math.round(R * I * 100) / 100;
  const k = Math.floor(rnd() * 3);
  const f = (v) => String(v).replace(".", ",");
  if (k === 0) return { q: `R = ${R} Ω, I = ${f(I)} A → U = ?`, a: U, unit: "V" };
  if (k === 1) return { q: `U = ${f(U)} V, R = ${R} Ω → I = ?`, a: I, unit: "A" };
  return { q: `U = ${f(U)} V, I = ${f(I)} A → R = ?`, a: R, unit: "Ω" };
}
export const ohmCheck = (task, input) => Math.abs(Number(String(input).replace(",", ".")) - task.a) < 1e-6;

/** Entscheidungsrad: Ergebnis-Index und Drehwinkel (mehrere volle Umdrehungen + Segment). */
export function spin(n, rnd = Math.random) {
  const i = Math.floor(rnd() * n) % n;
  const seg = 360 / n;
  return { index: i, deg: 360 * 5 + (360 - (i * seg + seg / 2)) };
}

export function normMe(x = {}) {
  return {
    id: "me", claimed: x.claimed && typeof x.claimed === "object" ? x.claimed : {}, spent: Number(x.spent) || 0, // darf nach pruneClaimed negativ sein (Guthaben bleibt gleich)
    owned: Array.isArray(x.owned) ? x.owned.filter((id) => SHOP.some((i) => i.id === id)) : [], wear: x.wear && typeof x.wear === "object" ? x.wear : {},
    pet: { name: s(x.pet && x.pet.name).slice(0, 20) || "Funki", fedDay: s(x.pet && x.pet.fedDay) }, avatar: s(x.avatar).slice(0, 8) || "🧑‍🔧",
    records: x.records && typeof x.records === "object" ? x.records : {}, wheel: Array.isArray(x.wheel) ? x.wheel.map(s).filter(Boolean).slice(0, 12) : [],
    secret: x.secret && typeof x.secret === "object" ? x.secret : {}, twinAreas: Array.isArray(x.twinAreas) ? x.twinAreas.filter((a) => AREAS.some((y) => y.id === a)) : null,
  };
}
/** Alte claimed-Schlüssel (älter als 60 Tage) aufräumen – Münzen bleiben über „bank“ erhalten. */
export function pruneClaimed(me, today) {
  const lim = addDays(today, -60);
  const keep = {}, drop = Object.keys(me.claimed).filter((k) => k.slice(0, 10) < lim);
  if (!drop.length) return me;
  for (const [k, v] of Object.entries(me.claimed)) if (k.slice(0, 10) >= lim) keep[k] = v;
  const value = drop.reduce((n, k) => n + (/:w-/.test(k) ? 30 : 10), 0);
  return { ...me, claimed: keep, spent: me.spent - value };
}
