// ⚡ Strom-Tycoon – eigenes Idle-Spiel (Elektriker-Thema) – reine Logik (kein DOM). Tests: test/tycoon-core.test.mjs
// 5 Welten auf einer Karte, je 8 Kraftwerke. Kette wie im Bergwerk: Kraftwerke → 🔌 Leitung → 🏭 Umspannwerk → 💶.
// Ohne Elektriker füllt ein Kraftwerk nur einen Puffer (10 s), den du antippst; mit Elektriker läuft es automatisch –
// begrenzt durch das schwächste Glied (Leitung/Umspannwerk). Vorarbeiter-Fähigkeit ×3, Booster (Shop & Rucksack),
// Expeditionen mit Fundstücken (Dauer-Boni), goldene Blitze, Truhe, Erfolge, Meisterbrief (⭐ = +10 % für immer).
// Gespeichert in Sammlung „spiel“, Dokument "tycoon".

const SCALE = 1000;
const BASE = [[5, 0.5], [60, 4], [700, 30], [8e3, 220], [9e4, 1600], [1e6, 12e3], [1.2e7, 9e4], [1.5e8, 7e5]];

export const WORLDS = [
  { id: "garage", e: "🏚️", name: "Opas Garage", bg: "#78350f", unlock: 0, gens: [
    ["hamster", "🐹", "Hamster im Laufrad", "Läuft für Sonnenblumenkerne. Tarifvertrag in Verhandlung."],
    ["dynamo", "🚲", "Fahrrad-Dynamo", "Opas altes Waffenrad. Quietscht in Es-Dur."],
    ["kartoffel", "🥔", "Kartoffel-Batterie", "0,5 V pro Knolle. Die Pommes müssen warten."],
    ["solar", "☀️", "Solardach", "Funktioniert sogar, wenn Opa den Rasen mäht."],
    ["aggregat", "⛽", "Notstromaggregat", "Riecht nach Abenteuer und Zweitakt."],
    ["toaster", "🍞", "Toaster im Rückwärtsgang", "Macht aus Toast wieder Strom. Fast."],
    ["oma", "👵", "Omas Strickmaschine", "Strickt Strom. Masche für Masche."],
    ["opa", "👴", "Opas Schimpf-Generator", "Jedes „Früher war alles besser“ = 1 kWh."]] },
  { id: "baustelle", e: "🏗️", name: "Die Baustelle", bg: "#a16207", unlock: 1e6, gens: [
    ["kurbel", "🧑‍🔧", "Lehrling an der Kurbel", "Motivation: Jause um 9."],
    ["baustrom", "🔌", "Baustromverteiler", "FI geprüft. Diesmal wirklich."],
    ["windrad", "🌬️", "Windrad am Kran", "Der Kranfahrer findet's nicht lustig."],
    ["diesel", "🚜", "Dieselaggregat", "Lauter als der Polier. Knapp."],
    ["kaffee", "☕", "Kaffeemaschinen-Kraftwerk", "Der Polier läuft auf Kaffee. Jetzt auch die Baustelle."],
    ["bagger", "🚧", "Bagger mit Dynamo", "Gräbt Löcher und Strom."],
    ["radio", "📻", "Baustellenradio-Turbine", "Volle Lautstärke treibt die Turbine."],
    ["jause", "🥪", "Leberkässemmel-Reaktor", "Die Geheimwaffe jeder Baustelle."]] },
  { id: "stadt", e: "🏙️", name: "Großstadt", bg: "#1d4ed8", unlock: 1e9, gens: [
    ["gym", "🏋️", "Fitnessstudio-Strom", "Jeder Bizeps-Curl zählt. Endlich ein Sinn."],
    ["wasser", "💧", "Wasserkraftwerk", "Die Donau macht Überstunden."],
    ["biogas", "🌱", "Kantinen-Biogas", "Schnitzel-Reste mit Zukunft."],
    ["blitz", "⛈️", "Blitzfänger", "Fängt 1,21 Gigawatt. Ab und zu."],
    ["geo", "🌋", "Geothermie", "Unter der Stadt ist es warm. Sehr warm."],
    ["tram", "🚋", "Bim-Bremsenergie", "Jede Vollbremsung zahlt sich aus."],
    ["stau", "🚗", "Stau-Generator", "Endlich ein Nutzen für die Tangente."],
    ["ampel", "🚦", "Rote-Welle-Kraftwerk", "Wartezeit wird Strom."]] },
  { id: "mond", e: "🌙", name: "Mondbasis", bg: "#4c1d95", unlock: 1e12, gens: [
    ["mondsolar", "🌕", "Mond-Solarfarm", "Keine Wolken. Keine Ausreden."],
    ["kaese", "🧀", "Mondkäse-Batterie", "Wissenschaftlich umstritten. Funktioniert trotzdem."],
    ["alien", "👽", "Alien im Laufrad", "Hat den Hamster als Vorbild."],
    ["helium", "⚛️", "Helium-3-Reaktor", "Sauber, stark, schwer auszusprechen."],
    ["gravi", "🪐", "Schwerkraft-Generator", "Fällt nach oben. Erzeugt trotzdem Strom."],
    ["rover", "🛻", "Mond-Rover", "Fährt im Kreis. Mit Absicht."],
    ["rakete", "🚀", "Raketen-Restwärme", "Startet nie. Wärmt aber super."],
    ["krater", "🌑", "Krater-Spiegel", "Die dunkle Seite hat auch Vorteile."]] },
  { id: "galaxie", e: "🌌", name: "Galaxie", bg: "#0f172a", unlock: 1e15, gens: [
    ["dyson", "🌞", "Dyson-Schwarm", "Eine ganze Sonne eingepackt. Mit Schleife."],
    ["loch", "🕳️", "Schwarzes-Loch-Dynamo", "Nicht zu nah ran. Ernsthaft."],
    ["einhorn", "🦄", "Einhorn-Generator", "Regenbogenstrom, 100 % erneuerbar."],
    ["nova", "💥", "Supernova-Akku", "Einmal laden, nie wieder laden."],
    ["unendlich", "♾️", "Unendlichkeits-Steckdose", "Der Schuko-Stecker des Universums."],
    ["komet", "☄️", "Kometen-Fänger", "Schweif inklusive."],
    ["nebel", "🌫️", "Nebel-Turbine", "Bläst kosmisch."],
    ["urknall", "🎆", "Urknall-Wiederholung", "Einmal pro Tag. Nicht weitersagen."]] },
].map((w, wi) => ({ ...w, gens: w.gens.map(([id, e, name, joke], gi) => ({ id, e, name, joke, cost: BASE[gi][0] * Math.pow(SCALE, wi), out: BASE[gi][1] * Math.pow(SCALE, wi) })) }));

export const GROW = 1.15, BUF_SEC = 10, MGR_FACTOR = 25, START_MONEY = 15;
/** Kreislauf wie im Bergwerk: Stollen → Wagen (Bestand) → Lift → Umspannwerk-Lager (surf) → Transporter → Börse (Geld).
 *  Ohne Manager arbeitet eine Station nur, wenn man tippt (eine Runde); mit Manager dauernd. */
export const CYCLE_S = 8, TRIP_S = 6;
export const liftMgrCost = (wi) => 30 * Math.pow(SCALE, wi);
export const transMgrCost = (wi) => 60 * Math.pow(SCALE, wi);
export const MILESTONES = [10, 25, 50, 100, 200, 400];
export const AKKU = [4, 8, 12, 24];
export const AKKU_COST = [0, 5e3, 5e6, 5e9];
export const STAR_BONUS = 0.1, STAR_BASE = 1e6;
export const ABIL = { m: 3, dur: 120e3, cd: 15 * 60e3 };

/* ---------- Booster ---------- */
export const BOOSTS = {
  x2: { e: "⚡", name: "Doppelstrom", m: 2, dur: 3600e3, d: "×2 Ertrag für 1 h" },
  x3: { e: "🔥", name: "Dreifach-Strom", m: 3, dur: 2 * 3600e3, d: "×3 Ertrag für 2 h" },
  x5: { e: "💥", name: "Fünffach-Kracher", m: 5, dur: 30 * 60e3, d: "×5 Ertrag für 30 min" },
  koffer: { e: "💼", name: "Geldkoffer", d: "2 Stunden Ertrag sofort" },
  zeit1: { e: "⏩", name: "Zeitsprung 1 h", d: "1 Stunde vorspulen (alle Welten)" },
  zeit8: { e: "⏭️", name: "Zeitsprung 8 h", d: "8 Stunden vorspulen (alle Welten)" },
};
export const SHOP = [
  { id: "x2", cost: 8 }, { id: "x3", cost: 20 }, { id: "x5", cost: 15 },
  { id: "koffer", cost: 12 }, { id: "zeit1", cost: 10 }, { id: "zeit8", cost: 60 },
];

/* ---------- Expeditionen & Fundstücke ---------- */
export const TOURS = [
  { k: "bach", e: "🥾", name: "Spaziergang zum Bach", min: 15, relic: 0.05, fuse: [1, 2], cash: 10 },
  { k: "berg", e: "🏕️", name: "Wanderung in die Berge", min: 60, relic: 0.2, fuse: [2, 5], cash: 45 },
  { k: "hoehle", e: "🔦", name: "Expedition in die Tropfsteinhöhle", min: 240, relic: 0.5, fuse: [5, 10], cash: 180 },
  { k: "unbekannt", e: "🧭", name: "Erkundung ins Unbekannte", min: 720, relic: 1, fuse: [10, 20], cash: 600 },
];
export const SLOT_COST = [0, 40, 120]; // 2. und 3. Expeditions-Platz
export const RELICS = [
  { id: "lampe", e: "🔦", name: "Opas Taschenlampe", fx: "inc", v: 0.05, d: "+5 % Ertrag" },
  { id: "isolator", e: "💎", name: "Kristall-Isolator", fx: "inc", v: 0.1, d: "+10 % Ertrag" },
  { id: "schrauber", e: "🪛", name: "Goldener Schraubenzieher", fx: "cost", v: 0.04, d: "−4 % Kraftwerks-Preise" },
  { id: "schluessel", e: "🗝️", name: "Rostiger Generalschlüssel", fx: "mgr", v: 0.1, d: "−10 % Elektriker-Kosten" },
  { id: "akku", e: "🔋", name: "Uralter Akku", fx: "off", v: 2, d: "+2 h Offline-Zeit" },
  { id: "tasse", e: "☕", name: "Ewige Kaffeetasse", fx: "abil", v: 0.25, d: "Vorarbeiter-Turbo +25 % länger" },
  { id: "magnet", e: "🧲", name: "Glücksmagnet", fx: "blitz", v: 0.15, d: "Goldene Blitze 15 % öfter" },
  { id: "flasche", e: "🧪", name: "Blitz in der Flasche", fx: "blitzx", v: 0.5, d: "Blitz-Belohnung +50 %" },
  { id: "weste", e: "🦺", name: "Warnweste des Glücks", fx: "tour", v: 0.1, d: "Expeditionen 10 % schneller" },
  { id: "radio", e: "📻", name: "Röhrenradio", fx: "chest", v: 1, d: "Truhe +1 🔩" },
  { id: "hamster", e: "🐹", name: "Goldener Hamster", fx: "tap", v: 0.5, d: "Einspeisen von Hand +50 %" },
  { id: "staub", e: "🌠", name: "Sternenstaub", fx: "star", v: 0.02, d: "Jeder ⭐ +2 % zusätzlich" },
];
export const RELIC_MAX = 5;

/* ---------- Texte ---------- */
export const NEWS = [
  "Eilmeldung: Hamster fordert 4-Tage-Woche. Verhandlungen laufen.",
  "Opa fragt, warum die Stromrechnung plötzlich positiv ist.",
  "Studie: 9 von 10 Kartoffeln würden wieder Batterie werden.",
  "Polier trinkt 14. Kaffee – Baustelle meldet Rekord-Leistung.",
  "Kranfahrer beschwert sich über Windrad. Windrad beschwert sich über Kranfahrer.",
  "Lehrling findet die Pause-Taste. Produktion sinkt um 3 %.",
  "FI-Schalter löst aus. Grund: Neid.",
  "Nachbar baut Solardach – leider auf der Nordseite.",
  "Fitnessstudio meldet: Mitglieder trainieren jetzt freiwillig. Für den Strom.",
  "Blitz schlägt zweimal ein – Versicherung verweigert Kommentar.",
  "Alien im Laufrad verlangt Gewerkschaft. Hamster solidarisch.",
  "Mondkäse-Batterie riecht. NASA bestätigt.",
  "Einhorn nach Schicht erschöpft, Regenbogen nur noch in Pastell.",
  "Schwarzes Loch verschluckt Montagmorgen. Niemand vermisst ihn.",
  "Tipp vom Meister: Erst messen, dann schimpfen.",
  "Gerücht: Wer täglich stempelt, verdient im Spiel doppelt. Stimmt.",
  "Witz des Tages: Was macht ein Elektron im Urlaub? Es geht auf Spannungssuche.",
  "Kurzschluss im Kühlschrank – Wurstsemmel jetzt gegrillt.",
  "Expeditionstrupp kehrt zurück: „Wir haben eine Steckdose im Wald gefunden!“",
  "Oma strickt jetzt auch Verlängerungskabel. Nur 2 m, aber mit Muster.",
];
const BLITZ = [
  { k: "turbo", w: 40, t: "🚀 TURBO! ×7 für 30 s" },
  { k: "cash", w: 35, t: "💰 Geldregen!" },
  { k: "fuse", w: 15, t: "🔩 +3 Sicherungen!" },
  { k: "mega", w: 10, t: "⚡ MEGA-BLITZ: ×20 für 15 s!" },
];
export const ACH = [
  { id: "erst", e: "🔌", t: "Erster Strom", d: "Kauf dein erstes Kraftwerk", f: 2, c: (s) => lvls(s) >= 1 },
  { id: "chef", e: "🧑‍🔧", t: "Chef sein", d: "Stell deinen ersten Elektriker an", f: 3, c: (s) => mgrs(s) >= 1 },
  { id: "l100", e: "📈", t: "Hundert Stufen", d: "100 Stufen insgesamt", f: 5, c: (s) => lvls(s) >= 100 },
  { id: "l500", e: "🏔️", t: "Bergsteiger", d: "500 Stufen insgesamt", f: 15, c: (s) => lvls(s) >= 500 },
  { id: "mio", e: "💶", t: "Millionär", d: "1 Mio. € verdient", f: 5, c: (s) => s.allTime >= 1e6 },
  { id: "mrd", e: "🏦", t: "Milliardär", d: "1 Mrd. € verdient", f: 15, c: (s) => s.allTime >= 1e9 },
  { id: "w2", e: "🏗️", t: "Ab auf die Baustelle", d: "Welt 2 freischalten", f: 5, c: (s) => s.unlocked >= 1 },
  { id: "w3", e: "🏙️", t: "Großstadtkind", d: "Welt 3 freischalten", f: 10, c: (s) => s.unlocked >= 2 },
  { id: "w4", e: "🌙", t: "Mondlandung", d: "Welt 4 freischalten", f: 20, c: (s) => s.unlocked >= 3 },
  { id: "w5", e: "🌌", t: "Unendliche Weiten", d: "Welt 5 freischalten", f: 40, c: (s) => s.unlocked >= 4 },
  { id: "b10", e: "⚡", t: "Blitzfänger", d: "10 goldene Blitze erwischt", f: 5, c: (s) => s.blitze >= 10 },
  { id: "b100", e: "🌩️", t: "Gewitterjäger", d: "100 goldene Blitze erwischt", f: 25, c: (s) => s.blitze >= 100 },
  { id: "tour1", e: "🥾", t: "Wandervogel", d: "Erste Expedition beendet", f: 3, c: (s) => s.tours >= 1 },
  { id: "tour25", e: "🧭", t: "Entdecker", d: "25 Expeditionen beendet", f: 15, c: (s) => s.tours >= 25 },
  { id: "relic6", e: "🏺", t: "Sammler", d: "6 verschiedene Fundstücke", f: 15, c: (s) => Object.keys(s.relics).length >= 6 },
  { id: "relic12", e: "👑", t: "Museumsdirektor", d: "Alle 12 Fundstücke", f: 50, c: (s) => Object.keys(s.relics).length >= 12 },
  { id: "cup1", e: "🏆", t: "Event-Champion", d: "Ersten Event-Pokal geholt", f: 20, c: (s) => (s.cups || 0) >= 1 },
  { id: "meister", e: "📜", t: "Meisterbrief", d: "Ersten Meisterbrief geholt", f: 20, c: (s) => s.resets >= 1 },
  { id: "streak7", e: "📅", t: "Treue Seele", d: "7 Tage in Folge die Truhe geöffnet", f: 10, c: (s) => s.streak >= 7 },
  { id: "tap", e: "👆", t: "Dauerdrücker", d: "500-mal eingespeist", f: 5, c: (s) => s.taps >= 500 },
];

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
export const world = (wi) => WORLDS[wi];
const genOf = (wi, id) => WORLDS[wi].gens.find((g) => g.id === id);
function lvls(s) { return s.worlds.reduce((n, w) => n + Object.values(w.gens).reduce((a, g) => a + g.lvl, 0), 0); }
function mgrs(s) { return s.worlds.reduce((n, w) => n + Object.values(w.gens).filter((g) => g.mgr).length, 0); }
/** Summe eines Fundstück-Effekts (Wert × Stufe). */
export function relicFx(s, fx) { return RELICS.filter((r) => r.fx === fx).reduce((n, r) => n + r.v * (s.relics[r.id] || 0), 0); }

function newWorld(wi) { return { money: wi === 0 ? START_MONEY : 0, total: 0, grid: 0, umsp: 0, abilUntil: 0, abilCd: 0, liftMgr: false, transMgr: false, surf: 0, liftCd: 0, transCd: 0, idle: 0, mab: {}, gens: Object.fromEntries(WORLDS[wi].gens.map((g) => [g.id, { lvl: 0, mgr: false, buf: 0, cd: 0 }])) }; }
export function newState(now = Date.now()) {
  return { v: STATE_V, cur: 0, unlocked: 0, worlds: WORLDS.map((_, i) => newWorld(i)), allTime: 0, stars: 0, resets: 0, akku: 0,
    fuses: 5, boosts: [], inv: {}, tours: 0, exp: [], slots: 1, relics: {}, blitze: 0, taps: 0, ach: [], chestDay: "", streak: 0, wheelDay: "", spins: 0, ev: null, cups: 0, last: now, created: now };
}

/** Spielstand-Version: ältere Stände werden verworfen (Neustart – vom Spieler gewünscht, 15.11.2026). */
export const STATE_V = 4;
export function norm(x = {}, now = Date.now()) {
  const s = newState(now);
  if (Number(x.v) !== STATE_V) return s;
  const ws = WORLDS.map((W, i) => {
    const r = (Array.isArray(x.worlds) && x.worlds[i]) || {};
    const gens = {};
    for (const g of W.gens) {
      const q = (r.gens && r.gens[g.id]) || {};
      const lvl = Math.max(0, Math.floor(num(q.lvl)));
      gens[g.id] = { lvl, mgr: !!q.mgr && lvl > 0, buf: Math.max(0, num(q.buf)), cd: num(q.cd) };
    }
    return { money: Math.max(0, num(r.money, s.worlds[i].money)), total: Math.max(0, num(r.total)), grid: Math.max(0, Math.floor(num(r.grid))),
      umsp: Math.max(0, Math.floor(num(r.umsp))), abilUntil: num(r.abilUntil), abilCd: num(r.abilCd),
      liftMgr: !!r.liftMgr, transMgr: !!r.transMgr, surf: Math.max(0, num(r.surf)), liftCd: num(r.liftCd), transCd: num(r.transCd), idle: Math.max(0, num(r.idle)), mab: r.mab && typeof r.mab === "object" ? Object.fromEntries(Object.entries(r.mab).filter(([, v]) => v && typeof v === "object").map(([k, v]) => [k, { u: num(v.u), cd: num(v.cd) }])) : {}, gens };
  });
  const unlocked = Math.min(WORLDS.length - 1, Math.max(0, Math.floor(num(x.unlocked))));
  const inv = {}; for (const k of Object.keys(BOOSTS)) { const n = Math.floor(num(x.inv && x.inv[k])); if (n > 0) inv[k] = Math.min(999, n); }
  const relics = {}; for (const r of RELICS) { const n = Math.floor(num(x.relics && x.relics[r.id])); if (n > 0) relics[r.id] = Math.min(RELIC_MAX, n); }
  const slots = Math.min(SLOT_COST.length, Math.max(1, Math.floor(num(x.slots, 1))));
  return {
    ...s, worlds: ws, unlocked, cur: Math.min(unlocked, Math.max(0, Math.floor(num(x.cur)))),
    allTime: Math.max(0, num(x.allTime)), stars: Math.max(0, Math.floor(num(x.stars))), resets: Math.max(0, Math.floor(num(x.resets))),
    akku: Math.min(AKKU.length - 1, Math.max(0, Math.floor(num(x.akku)))), fuses: Math.max(0, Math.floor(num(x.fuses, 5))),
    boosts: (Array.isArray(x.boosts) ? x.boosts : []).filter((b) => b && num(b.until) > now && num(b.m) > 1).slice(-10).map((b) => ({ m: num(b.m), until: num(b.until), k: String(b.k || "") })),
    inv, relics, slots, tours: Math.max(0, Math.floor(num(x.tours))),
    exp: (Array.isArray(x.exp) ? x.exp : []).filter((e) => e && TOURS.some((t) => t.k === e.k) && num(e.end) > 0).slice(0, slots).map((e) => ({ k: e.k, start: num(e.start), end: num(e.end), seed: Math.floor(num(e.seed)) })),
    blitze: Math.max(0, Math.floor(num(x.blitze))), taps: Math.max(0, Math.floor(num(x.taps))),
    ach: Array.isArray(x.ach) ? x.ach.filter((a) => ACH.some((y) => y.id === a)) : [],
    chestDay: /^\d{4}-\d{2}-\d{2}$/.test(String(x.chestDay || "")) ? x.chestDay : "", streak: Math.max(0, Math.floor(num(x.streak))),
    wheelDay: /^\d{4}-\d{2}-\d{2}$/.test(String(x.wheelDay || "")) ? x.wheelDay : "", spins: Math.max(0, Math.floor(num(x.spins))),
    ev: x.ev && typeof x.ev === "object" && Number.isFinite(Number(x.ev.cycle)) ? { cycle: Number(x.ev.cycle), money: Math.max(0, num(x.ev.money)), total: Math.max(0, num(x.ev.total)), claimed: Array.isArray(x.ev.claimed) ? x.ev.claimed.filter((i) => Number.isInteger(i)) : [], gens: x.ev.gens && typeof x.ev.gens === "object" ? x.ev.gens : {} } : null,
    cups: Math.max(0, Math.floor(num(x.cups))),
    last: num(x.last, now) || now, created: num(x.created, now) || now,
  };
}
const clone = (s) => ({ ...s, worlds: s.worlds.map((w) => ({ ...w, gens: Object.fromEntries(Object.entries(w.gens).map(([k, v]) => [k, { ...v }])) })),
  boosts: s.boosts.slice(), ach: s.ach.slice(), inv: { ...s.inv }, relics: { ...s.relics }, exp: s.exp.map((e) => ({ ...e })), ev: s.ev ? { ...s.ev, claimed: (s.ev.claimed || []).slice(), gens: Object.fromEntries(Object.entries(s.ev.gens || {}).map(([k, v]) => [k, { ...v }])) } : null });

/* ---------- Preise & Raten ---------- */
export function genCost(wi, id, lvl, n = 1, s = null) {
  const g = genOf(wi, id), k = s ? Math.max(0.5, 1 - relicFx(s, "cost")) : 1;
  return k * g.cost * Math.pow(GROW, lvl) * (Math.pow(GROW, n) - 1) / (GROW - 1);
}
export function maxBuy(wi, id, lvl, money, s = null) {
  const k = s ? Math.max(0.5, 1 - relicFx(s, "cost")) : 1;
  const a = k * genOf(wi, id).cost * Math.pow(GROW, lvl);
  return Math.max(0, Math.floor(Math.log(money * (GROW - 1) / a + 1) / Math.log(GROW) + 1e-9));
}
/** Elektriker-Preis: im ersten Stollen jeder Welt nur 5× (schneller Einstieg wie im Genre üblich), sonst 25× Grundpreis */
export const mgrCost = (wi, id, s = null) => genOf(wi, id).cost * (WORLDS[wi].gens[0].id === id ? 5 : MGR_FACTOR) * (s ? Math.max(0.5, 1 - relicFx(s, "mgr")) : 1);
export const gridCap = (wi, lvl) => 3 * Math.pow(SCALE, wi) * Math.pow(1.55, lvl);
export const gridCost = (wi, lvl, n = 1) => 25 * Math.pow(SCALE, wi) * Math.pow(1.75, lvl) * (Math.pow(1.75, n) - 1) / 0.75;
export const umspCap = (wi, lvl) => 4 * Math.pow(SCALE, wi) * Math.pow(1.6, lvl);
export const umspCost = (wi, lvl, n = 1) => 40 * Math.pow(SCALE, wi) * Math.pow(1.8, lvl) * (Math.pow(1.8, n) - 1) / 0.8;
/** Wie viele Stufen Leitung/Umspannwerk gehen sich aus? */
export function stMaxBuy(wi, key, lvl, money) { const f = key === "lift" ? gridCost : umspCost; let n = 0; while (n < 500 && f(wi, lvl, n + 1) <= money + 1e-9) n++; return n; }
export const milestoneMult = (lvl) => Math.pow(2, MILESTONES.filter((m) => lvl >= m).length);
export const nextMilestone = (lvl) => MILESTONES.find((m) => lvl < m) || null;
export const genOut = (wi, id, lvl) => (lvl > 0 ? genOf(wi, id).out * lvl * milestoneMult(lvl) : 0);
export const abilDur = (s) => ABIL.dur * (1 + relicFx(s, "abil"));
export const offlineHours = (s) => AKKU[s.akku] + relicFx(s, "off");

/** Gesamt-Faktor einer Welt: Sterne × Fundstücke × Schicht-Bonus × Booster × Vorarbeiter. */
export function mult(s, { boost = 1, now = Date.now(), wi = null } = {}) {
  const star = 1 + s.stars * (STAR_BONUS + relicFx(s, "star"));
  const b = s.boosts.filter((x) => x.until > now).reduce((m, x) => m * x.m, 1);
  const ab = wi != null && s.worlds[wi] && s.worlds[wi].abilUntil > now ? ABIL.m : 1;
  return star * (1 + relicFx(s, "inc")) * boost * b * ab;
}
export function rates(s, wi, opt = {}) {
  const w = s.worlds[wi], k = mult(s, { ...opt, wi });
  let raw = 0, manual = 0;
  const per = {};
  for (const g of WORLDS[wi].gens) {
    const st = w.gens[g.id], o = genOut(wi, g.id, st.lvl);
    per[g.id] = o * k * mabX(w, g.id, opt.now);
    if (st.mgr) raw += o; else manual += o;
  }
  const cap = gridCap(wi, w.grid) * mabX(w, "lift", opt.now), ucap = umspCap(wi, w.umsp) * mabX(w, "trans", opt.now);
  // Automatischer Fluss nur, wenn alle drei Stationen Manager haben
  const flow = w.liftMgr && w.transMgr ? Math.min(raw, cap, ucap) : 0;
  const neck = !raw ? null : !w.liftMgr ? "liftmgr" : !w.transMgr ? "transmgr" : raw <= Math.min(cap, ucap) + 1e-9 ? null : cap <= ucap ? "grid" : "umsp";
  return { raw, cap, ucap, auto: flow * k, manual: manual * k, capped: neck === "grid" || neck === "umsp", neck, use: raw ? Math.min(1, raw / cap) : 0, uuse: raw ? Math.min(1, Math.min(raw, cap) / ucap) : 0, per, k, liftMgr: w.liftMgr, transMgr: w.transMgr };
}
/** Bestand aller Wagen einer Welt */
export const cartsOf = (w) => Object.values(w.gens).reduce((a, g) => a + (g.buf || 0), 0);
/** Lift: bis zu amount aus den Wagen (anteilig) ins Umspannwerk-Lager */
function liftMove(w, amount) {
  const tot = cartsOf(w); if (tot <= 0 || amount <= 0) return 0;
  const m = Math.min(tot, amount), f = 1 - m / tot;
  for (const g of Object.values(w.gens)) g.buf = (g.buf || 0) * f;
  w.surf = (w.surf || 0) + m; return m;
}
// Welten, in denen du gerade nicht bist, sammeln ihr Geld in der Kasse (auf der Karte abholen)
function earn(s, wi, x) { const w = s.worlds[wi]; if (wi === s.cur) w.money += x; else w.idle = (w.idle || 0) + x; w.total += x; s.allTime += x; }
/* ---------- Manager-Fähigkeiten (je Station) ---------- */
export const MAB = { m: 3, dur: 180e3, cd: 20 * 60e3 };
const mabX = (w, key, now = Date.now()) => (w.mab && w.mab[key] && w.mab[key].u > now ? MAB.m : 1);
export const MGR_NAMES = ["Sepp Kabelbinder", "Gerti Volt", "Ferdl Watt", "Resi Ampere", "Hansi Ohm", "Mitzi Schuko", "Toni Phasenprüfer", "Burgi Lüsterklemme", "Poldi Sicherung", "Vroni Erdung", "Schorsch Steckdose", "Kathi Kurzschluss"];
const MAB_TXT = { gen: "Abbau ×3", lift: "Lift ×3", trans: "Liefern ×3" };
export function mgrInfo(s, wi, key) {
  const w = s.worlds[wi], has = key === "lift" ? w.liftMgr : key === "trans" ? w.transMgr : !!(w.gens[key] && w.gens[key].mgr);
  const idx = key === "lift" ? 0 : key === "trans" ? 1 : 2 + WORLDS[wi].gens.findIndex((g) => g.id === key);
  const m = (w.mab && w.mab[key]) || { u: 0, cd: 0 };
  return { has, name: MGR_NAMES[(idx * 5 + wi * 3) % MGR_NAMES.length], rank: ["Junior", "Senior", "Meister"][(idx + wi) % 3], ab: MAB_TXT[key === "lift" || key === "trans" ? key : "gen"], until: m.u, cd: m.cd };
}
export function mabUse(s, key, now = Date.now()) {
  const I = mgrInfo(s, s.cur, key); if (!I.has || I.cd > now) return null;
  const n = clone(s), w = n.worlds[n.cur]; w.mab = { ...(w.mab || {}), [key]: { u: now + MAB.dur, cd: now + MAB.cd } }; return n;
}
/** Kasse anderer Welten abholen (×2 kostet 🔩 3). wi = null → alle. */
export const IDLE_X2_COST = 3;
export const idleOf = (s) => s.worlds.reduce((a, w, i) => a + (i <= s.unlocked ? w.idle || 0 : 0), 0);
export function collectIdle(s, wi = null, x2 = false) {
  const tot = wi == null ? idleOf(s) : s.worlds[wi].idle || 0; if (tot <= 0) return null;
  if (x2 && s.fuses < IDLE_X2_COST) return null;
  const n = clone(s), f = x2 ? 2 : 1; if (x2) n.fuses -= IDLE_X2_COST;
  n.worlds.forEach((w, i) => { if ((wi == null && i <= n.unlocked) || i === wi) { const v = (w.idle || 0) * f; w.money += v; if (x2) { w.total += v / 2; n.allTime += v / 2; } w.idle = 0; } });
  return { s: n, got: tot * f };
}
/* ---------- Werte fürs Level-Fenster ---------- */
export function shaftStats(s, wi, id, lvl) {
  const o = genOut(wi, id, lvl) * mult(s, { wi }), workers = Math.min(6, 1 + Math.floor(lvl / 25));
  return { tot: o, workers, walk: 1 + Math.floor(lvl / 40) * 0.5, dig: o / workers, cap: o * CYCLE_S };
}
export function stationStats(wi, key, lvl) {
  const c = key === "lift" ? gridCap(wi, lvl) : umspCap(wi, lvl);
  return { tot: c, load: c * TRIP_S, speed: 1 + Math.floor(lvl / 10) * 0.25, ...(key === "trans" ? { trucks: Math.min(5, 1 + Math.floor(lvl / 15)) } : {}) };
}
/** Ertrag pro Sekunde aller Welten zusammen (für Belohnungen). */
export function totalRate(s, opt = {}) { let n = 0; for (let wi = 0; wi <= s.unlocked; wi++) { const r = rates(s, wi, opt); n += r.auto + (wi === s.cur ? r.manual * 0.5 : 0); } return n; }

export function tick(s0, dt, opt = {}) {
  const s = clone(s0), now = opt.now ?? Date.now();
  dt = Math.max(0, dt);
  for (let wi = 0; wi <= s.unlocked; wi++) {
    const r = rates(s, wi, { ...opt, now }), w = s.worlds[wi];
    for (const g of WORLDS[wi].gens) { const st = w.gens[g.id]; if (st.lvl > 0 && st.mgr) st.buf = (st.buf || 0) + r.per[g.id] * dt; }
    if (w.liftMgr) liftMove(w, r.cap * r.k * dt);
    if (w.transMgr) { const m = Math.min(w.surf || 0, r.ucap * r.k * dt); w.surf -= m; earn(s, wi, m); }
  }
  evTick(s, dt, { ...opt, now }, !opt.noBuf);
  s.boosts = s.boosts.filter((b) => b.until > now);
  s.last = now;
  return s;
}
export function offline(s, now = Date.now(), opt = {}) {
  const secs = Math.max(0, (now - s.last) / 1000);
  const used = Math.min(secs, offlineHours(s) * 3600);
  const before = s.allTime;
  const base = { ...s, boosts: [], worlds: s.worlds.map((w) => ({ ...w, abilUntil: 0, mab: {} })) };
  const n = tick(base, used, { boost: opt.boost || 1, now });
  n.boosts = s.boosts.filter((b) => b.until > now);
  n.worlds.forEach((w, i) => { w.abilUntil = s.worlds[i].abilUntil; w.mab = s.worlds[i].mab; });
  return { s: n, earned: n.allTime - before, secs, used };
}

/* ---------- Aktionen (neuer Zustand oder null) ---------- */
function payW(s, wi, cost) { if (s.worlds[wi].money + 1e-9 < cost) return null; const n = clone(s); n.worlds[wi].money = Math.max(0, n.worlds[wi].money - cost); return n; }
/** Stollen ohne Elektriker antippen: eine Runde Abbau (CYCLE_S Sekunden Ertrag) in den Wagen */
export function collect(s, id, now = Date.now()) {
  const st = s.worlds[s.cur].gens[id];
  if (!st || !st.lvl || st.mgr || (st.cd || 0) > now) return { s, got: 0 };
  const r = rates(s, s.cur, { now }), got = r.per[id] * CYCLE_S * (1 + relicFx(s, "tap"));
  const n = clone(s), g = n.worlds[s.cur].gens[id]; g.buf = (g.buf || 0) + got; g.cd = now + CYCLE_S * 1000; n.taps++;
  return { s: n, got };
}
/** Lift ohne Liftwart antippen: eine Fahrt (TRIP_S Sekunden Kapazität) */
export function liftTap(s, now = Date.now()) {
  const w = s.worlds[s.cur]; if (w.liftMgr || (w.liftCd || 0) > now || cartsOf(w) <= 0) return { s, got: 0 };
  const r = rates(s, s.cur, { now }), n = clone(s), nw = n.worlds[s.cur];
  const got = liftMove(nw, r.cap * r.k * TRIP_S); nw.liftCd = now + TRIP_S * 1000; n.taps++;
  return { s: n, got };
}
/** Transporter ohne Fahrer antippen: eine Fahrt zur Börse → Geld */
export function transTap(s, now = Date.now()) {
  const w = s.worlds[s.cur]; if (w.transMgr || (w.transCd || 0) > now || (w.surf || 0) <= 0) return { s, got: 0 };
  const r = rates(s, s.cur, { now }), n = clone(s), nw = n.worlds[s.cur];
  const got = Math.min(nw.surf, r.ucap * r.k * TRIP_S); nw.surf -= got; earn(n, s.cur, got); nw.transCd = now + TRIP_S * 1000; n.taps++;
  return { s: n, got };
}
/** „Alles“: alle bereiten Stollen abbauen, dann Lift, dann Transporter (Geld = was bei der Börse ankommt) */
export function collectAll(s, now = Date.now()) {
  let n = s;
  for (const g of WORLDS[s.cur].gens) n = collect(n, g.id, now).s;
  n = liftTap(n, now).s;
  const before = n.worlds[s.cur].money, t = transTap(n, now);
  return { s: t.s, got: t.s.worlds[s.cur].money - before };
}
export function hireLift(s) { const w = s.worlds[s.cur]; if (w.liftMgr) return null; const n = payW(s, s.cur, liftMgrCost(s.cur)); if (n) n.worlds[s.cur].liftMgr = true; return n; }
export function hireTrans(s) { const w = s.worlds[s.cur]; if (w.transMgr) return null; const n = payW(s, s.cur, transMgrCost(s.cur)); if (n) n.worlds[s.cur].transMgr = true; return n; }
export function buyGen(s, id, k = 1) {
  const wi = s.cur, st = s.worlds[wi].gens[id];
  if (!st || k < 1) return null;
  const n = payW(s, wi, genCost(wi, id, st.lvl, k, s));
  if (n) n.worlds[wi].gens[id].lvl += k;
  return n;
}
export function hire(s, id) {
  const wi = s.cur, st = s.worlds[wi].gens[id];
  if (!st || st.mgr || st.lvl < 1) return null;
  const n = payW(s, wi, mgrCost(wi, id, s));
  if (!n) return null;
  n.worlds[wi].gens[id] = { ...n.worlds[wi].gens[id], mgr: true }; // Wagen-Bestand bleibt, der Lift holt ihn
  return n;
}
export function buyGrid(s, k = 1) { if (k < 1) return null; const n = payW(s, s.cur, gridCost(s.cur, s.worlds[s.cur].grid, k)); if (n) n.worlds[s.cur].grid += k; return n; }
export function buyUmsp(s, k = 1) { if (k < 1) return null; const n = payW(s, s.cur, umspCost(s.cur, s.worlds[s.cur].umsp, k)); if (n) n.worlds[s.cur].umsp += k; return n; }
export function buyAkku(s) {
  if (s.akku >= AKKU.length - 1) return null;
  const n = payW(s, s.cur, AKKU_COST[s.akku + 1] * Math.pow(SCALE, s.cur));
  if (n) n.akku++;
  return n;
}
/** Vorarbeiter-Turbo der aktuellen Welt (×3, 2 min, 15 min Abklingzeit). */
export function abil(s, now = Date.now()) {
  const w = s.worlds[s.cur];
  if (w.abilCd > now) return null;
  const n = clone(s); n.worlds[s.cur].abilUntil = now + abilDur(s); n.worlds[s.cur].abilCd = now + ABIL.cd;
  return n;
}
export const visible = (s, id) => { const gs = WORLDS[s.cur].gens; const i = gs.findIndex((g) => g.id === id); return i <= 0 || s.worlds[s.cur].gens[gs[i - 1].id].lvl > 0; };
export function nextWorld(s) {
  const ni = s.unlocked + 1;
  if (ni >= WORLDS.length) return null;
  const have = s.worlds[s.unlocked].total;
  return { wi: ni, need: WORLDS[ni].unlock, have, pct: Math.min(1, have / WORLDS[ni].unlock) };
}
export function tryUnlock(s) {
  const nw = nextWorld(s);
  if (!nw || nw.have < nw.need) return null;
  const n = clone(s); n.unlocked = nw.wi; n.cur = nw.wi; n.worlds[nw.wi].money = Math.max(n.worlds[nw.wi].money, WORLDS[nw.wi].gens[0].cost * 3);
  return n;
}
export function goWorld(s, wi) { if (wi < 0 || wi > s.unlocked) return null; const n = clone(s); n.cur = wi; const w = n.worlds[wi]; w.money += w.idle || 0; w.idle = 0; return n; }

/* ---------- Booster: einsetzen, kaufen ---------- */
function applyBoost(s, k, opt = {}) {
  const now = opt.now ?? Date.now(), B = BOOSTS[k];
  let n = clone(s);
  if (B.m) {
    const end = Math.max(now, ...n.boosts.filter((b) => b.k === k).map((b) => b.until)) + B.dur;
    n.boosts = n.boosts.filter((b) => b.k !== k); n.boosts.push({ m: B.m, until: end, k });
    return { s: n, got: 0 };
  }
  if (k === "koffer") { const got = Math.max(totalRate(s, { ...opt, now }) * 7200, WORLDS[s.cur].gens[0].cost * 20); earn(n, s.cur, got); return { s: n, got }; }
  const sec = k === "zeit1" ? 3600 : 8 * 3600, before = n.allTime, keep = { fuses: n.fuses, boosts: n.boosts, inv: n.inv };
  n = tick({ ...n, boosts: [] }, sec, { ...opt, now }); Object.assign(n, keep, { boosts: keep.boosts.filter((x) => x.until > now) });
  return { s: n, got: n.allTime - before };
}
export function shopBuy(s, id, opt = {}) {
  const it = SHOP.find((x) => x.id === id);
  if (!it || s.fuses < it.cost) return null;
  return applyBoost({ ...s, fuses: s.fuses - it.cost }, id, opt);
}
/** Booster aus dem Rucksack einsetzen. */
export function useInv(s, k, opt = {}) {
  if (!BOOSTS[k] || !(s.inv[k] > 0)) return null;
  const n = clone(s); n.inv[k]--; if (!n.inv[k]) delete n.inv[k];
  return applyBoost(n, k, opt);
}

/* ---------- Expeditionen ---------- */
export const tourMs = (s, t) => t.min * 60e3 * Math.max(0.5, 1 - relicFx(s, "tour"));
export function startTour(s, k, now = Date.now(), rnd = Math.random) {
  const t = TOURS.find((x) => x.k === k);
  if (!t || s.exp.length >= s.slots) return null;
  const n = clone(s); n.exp.push({ k, start: now, end: now + tourMs(s, t), seed: Math.floor(rnd() * 2 ** 31) });
  return n;
}
/** Deterministischer Zufall aus dem Startwert (Belohnung steht beim Start fest – kein Neuladen-Trick). */
function rng(seed) { let x = (seed >>> 0) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
export function tourLoot(s, e, opt = {}) {
  const t = TOURS.find((x) => x.k === e.k), r = rng(e.seed);
  const loot = { fuses: t.fuse[0] + Math.floor(r() * (t.fuse[1] - t.fuse[0] + 1)), cash: 0, boosts: [], relic: null };
  loot.cash = Math.max(totalRate(s, opt) * t.cash * 60, WORLDS[s.cur].gens[0].cost * t.min / 3);
  const bk = ["x2", "x2", "x3", "x5", "koffer", "zeit1"];
  const nb = t.min >= 720 ? 3 : t.min >= 240 ? 2 : t.min >= 60 ? 1 : r() < 0.3 ? 1 : 0;
  for (let i = 0; i < nb; i++) loot.boosts.push(bk[Math.floor(r() * bk.length)]);
  if (r() < t.relic) {
    const open = RELICS.filter((x) => (s.relics[x.id] || 0) < RELIC_MAX);
    if (open.length) loot.relic = open[Math.floor(r() * open.length)].id;
  }
  return loot;
}
export function claimTour(s, i, opt = {}) {
  const now = opt.now ?? Date.now(), e = s.exp[i];
  if (!e || e.end > now) return null;
  const loot = tourLoot(s, e, opt);
  const n = clone(s);
  n.exp.splice(i, 1); n.tours++; n.fuses += loot.fuses; earn(n, s.cur, loot.cash);
  for (const b of loot.boosts) n.inv[b] = (n.inv[b] || 0) + 1;
  if (loot.relic) n.relics[loot.relic] = Math.min(RELIC_MAX, (n.relics[loot.relic] || 0) + 1);
  return { s: n, loot };
}
/** Expedition sofort beenden: 1 🔩 je angefangene 10 min. */
export const rushCost = (e, now = Date.now()) => Math.max(1, Math.ceil((e.end - now) / 600e3));
export function rushTour(s, i, now = Date.now()) {
  const e = s.exp[i]; if (!e || e.end <= now) return null;
  const c = rushCost(e, now); if (s.fuses < c) return null;
  const n = clone(s); n.fuses -= c; n.exp[i].end = now; return n;
}
export function buySlot(s) {
  if (s.slots >= SLOT_COST.length) return null;
  const c = SLOT_COST[s.slots]; if (s.fuses < c) return null;
  const n = clone(s); n.fuses -= c; n.slots++; return n;
}

/* ---------- Blitze, Truhe, Erfolge ---------- */
export const nextBlitzIn = (s = null, rnd = Math.random) => (45 + Math.floor(rnd() * 105)) / (1 + (s ? relicFx(s, "blitz") : 0));
export function blitz(s, opt = {}, rnd = Math.random) {
  const now = opt.now ?? Date.now(), bx = 1 + relicFx(s, "blitzx");
  let x = rnd() * 100, pick = BLITZ[0];
  for (const b of BLITZ) { if (x < b.w) { pick = b; break; } x -= b.w; }
  const n = clone(s); n.blitze++;
  let got = 0, text = pick.t;
  if (pick.k === "turbo") n.boosts.push({ m: 7, until: now + 30e3 * bx, k: "turbo" });
  else if (pick.k === "mega") n.boosts.push({ m: 20, until: now + 15e3 * bx, k: "mega" });
  else if (pick.k === "fuse") { const f = Math.round(3 * bx); n.fuses += f; text = `🔩 +${f} Sicherungen!`; }
  else { const r = rates(s, s.cur, { ...opt, now }); got = Math.max((r.auto + r.manual) * 120 * bx, WORLDS[s.cur].gens[0].cost * 3); earn(n, s.cur, got); }
  return { s: n, kind: pick.k, text, got };
}
export function chest(s, today, yesterday, rnd = Math.random) {
  if (s.chestDay === today) return null;
  const n = clone(s);
  n.streak = s.chestDay === yesterday ? s.streak + 1 : 1;
  const f = Math.min(10, 2 + n.streak) + Math.round(relicFx(s, "chest"));
  n.fuses += f; n.chestDay = today;
  let boost = null;
  if (n.streak % 3 === 0 || rnd() < 0.25) { boost = ["x2", "x3", "koffer", "zeit1"][Math.floor(rnd() * 4)]; n.inv[boost] = (n.inv[boost] || 0) + 1; }
  return { s: n, fuses: f, streak: n.streak, boost };
}
export function checkAch(s) {
  const fresh = ACH.filter((a) => !s.ach.includes(a.id) && a.c(s));
  if (!fresh.length) return { s, fresh };
  const n = clone(s); n.ach.push(...fresh.map((a) => a.id)); n.fuses += fresh.reduce((x, a) => x + a.f, 0);
  return { s: n, fresh };
}


/* ---------- Glücksrad (1× täglich gratis, sonst 5 🔩) ---------- */
export const WHEEL = [
  { k: "fuse", n: 3, e: "🔩", t: "3 Sicherungen", w: 24, c: "#64748b" },
  { k: "cash", e: "💶", t: "30 Min. Ertrag", w: 22, c: "#16a34a" },
  { k: "boost", b: "x2", e: "⚡", t: "Doppelstrom", w: 15, c: "#f59e0b" },
  { k: "fuse", n: 10, e: "🔩", t: "10 Sicherungen", w: 8, c: "#475569" },
  { k: "boost", b: "koffer", e: "💼", t: "Geldkoffer", w: 10, c: "#0891b2" },
  { k: "boost", b: "x3", e: "🔥", t: "Dreifach-Strom", w: 8, c: "#ea580c" },
  { k: "boost", b: "x5", e: "💥", t: "Fünffach-Kracher", w: 6, c: "#dc2626" },
  { k: "relic", e: "🏺", t: "Fundstück!", w: 4, c: "#7c3aed" },
  { k: "boost", b: "zeit8", e: "⏭️", t: "Zeitsprung 8 h", w: 3, c: "#db2777" },
];
export const WHEEL_COST = 5;
export function spin(s, today, opt = {}, rnd = Math.random) {
  const free = s.wheelDay !== today;
  if (!free && s.fuses < WHEEL_COST) return null;
  const tot = WHEEL.reduce((a, x) => a + x.w, 0);
  let x = rnd() * tot, idx = 0;
  for (let i = 0; i < WHEEL.length; i++) { if (x < WHEEL[i].w) { idx = i; break; } x -= WHEEL[i].w; }
  const P = WHEEL[idx], n = clone(s);
  if (free) n.wheelDay = today; else n.fuses -= WHEEL_COST;
  n.spins = (n.spins || 0) + 1;
  let got = 0, relic = null;
  if (P.k === "fuse") n.fuses += P.n;
  else if (P.k === "cash") { got = Math.max(totalRate(s, opt) * 1800, WORLDS[s.cur].gens[0].cost * 10); earn(n, s.cur, got); }
  else if (P.k === "boost") n.inv[P.b] = (n.inv[P.b] || 0) + 1;
  else if (P.k === "relic") {
    const open = RELICS.filter((r) => (s.relics[r.id] || 0) < RELIC_MAX);
    if (open.length) { relic = open[Math.floor(rnd() * open.length)].id; n.relics[relic] = (n.relics[relic] || 0) + 1; } else n.fuses += 20;
  }
  return { s: n, idx, prize: P, got, relic, free };
}


/* ---------- 🎪 Events: alle 3 Wochen eine Woche lang eine Event-Insel mit eigener Mini-Wirtschaft (🎫 Event-Münzen) ---------- */
export const EV_EPOCH = new Date(2026, 0, 5, 0, 0, 0).getTime(); // Montag
export const EV_CYCLE_D = 21, EV_LEN_D = 7;
const EVB = [[5, 1], [80, 10], [1200, 120], [2e4, 1500], [4e5, 25000]];
export const EV_THEMES = [
  { id: "kuerbis", e: "🎃", name: "Kürbis-Kraftwerk", bg: "#c2410c", gens: [["laterne", "🎃", "Kürbis-Laterne", "Grinst und leuchtet. Gleichzeitig."], ["geist", "👻", "Geister-Dynamo", "Spukt mit 230 V."], ["besen", "🧹", "Hexenbesen-Turbine", "Fliegt im Kreis, erzeugt Wind."], ["fleder", "🦇", "Fledermaus-Flügelrad", "Nachtschicht inklusive."], ["schloss", "🏰", "Spukschloss-Reaktor", "Knarrt, aber liefert."]] },
  { id: "licht", e: "🎄", name: "Lichterketten-Fest", bg: "#15803d", gens: [["kette", "💡", "Lichterkette", "Eine Birne kaputt? Alle aus. Klassiker."], ["rentier", "🦌", "Rentier-Laufband", "Rudolph trainiert für Dezember."], ["lebkuchen", "🍪", "Lebkuchen-Batterie", "Süß und leistungsstark."], ["schnee", "⛄", "Schneemann-Kühlturm", "Kühlt alles. Auch die Stimmung."], ["christkind", "🌟", "Christkind-Kraftwerk", "Liefert pünktlich am 24."]] },
  { id: "strand", e: "🏖️", name: "Sommer-Strand", bg: "#0284c7", gens: [["eis", "🍦", "Eis-Generator", "Schmilzt schneller als du schaust."], ["welle", "🌊", "Wellenkraftwerk", "Surft auf jeder Welle."], ["creme", "🧴", "Sonnencreme-Solar", "Lichtschutzfaktor 50, Ertrag 100."], ["sandburg", "🏰", "Sandburg-Speicher", "Hält bis zur nächsten Flut."], ["leucht", "🗼", "Leuchtturm-Laser", "Weist Schiffen den Weg zum Geld."]] },
  { id: "urzeit", e: "🦖", name: "Urzeit-Strom", bg: "#78350f", gens: [["steinrad", "🪨", "Steinrad", "Erfunden vor 10.000 Jahren. Läuft noch."], ["dino", "🦕", "Dino-Laufrad", "Sehr großes Laufrad."], ["vulkan", "🌋", "Vulkan-Wärme", "Heiß. Sehr heiß."], ["mammut", "🦣", "Mammut-Mühle", "Flauschig und stark."], ["meteor", "☄️", "Meteor-Kraftwerk", "Einschlagender Erfolg."]] },
  { id: "piraten", e: "🏴‍☠️", name: "Piratenhafen", bg: "#1e3a8a", gens: [["kanone", "💣", "Kanonen-Dynamo", "Bumm = Strom."], ["papagei", "🦜", "Papageien-Propeller", "Plappert und dreht."], ["truhe", "💰", "Schatztruhen-Akku", "Arrr, voll geladen!"], ["segel", "⛵", "Segel-Turbine", "Mit dem Wind zum Reichtum."], ["krake", "🐙", "Kraken-Kraft", "Acht Arme, acht Kurbeln."]] },
  { id: "zirkus", e: "🎪", name: "Zirkus-Zauber", bg: "#be185d", gens: [["clown", "🤡", "Clown-Fahrrad", "Einrad mit Hupe."], ["trampolin", "🤸", "Trampolin-Tritt", "Hoch, runter, Strom."], ["elefant", "🐘", "Elefanten-Lauf", "Vergisst nie eine Kilowattstunde."], ["feuer", "🔥", "Feuerspucker-Wärme", "Bitte nicht nachmachen."], ["kanonier", "🎯", "Kanonenmensch-Kraft", "Fliegt weit, liefert viel."]] },
].map((t) => ({ ...t, gens: t.gens.map(([id, e, name, joke], i) => ({ id, e, name, joke, cost: EVB[i][0], out: EVB[i][1] })) }));
export const EV_TRACK = [
  { at: 1e3, e: "🔩", t: "10 Sicherungen", fuses: 10 },
  { at: 1e5, e: "🔥", t: "Dreifach-Strom-Booster", inv: "x3" },
  { at: 1e7, e: "⏭️", t: "Zeitsprung 8 h + 30 🔩", inv: "zeit8", fuses: 30 },
  { at: 1e9, e: "🏺", t: "Fundstück", relic: true },
  { at: 1e11, e: "🏆", t: "Event-Pokal + 60 🔩", cup: true, fuses: 60 },
];
/** Aktuelles/nächstes Event */
export function eventInfo(now = Date.now()) {
  const D = 864e5, cyc = Math.floor((now - EV_EPOCH) / (EV_CYCLE_D * D));
  const start = EV_EPOCH + cyc * EV_CYCLE_D * D, end = start + EV_LEN_D * D;
  const active = now >= start && now < end;
  const theme = EV_THEMES[((cyc % EV_THEMES.length) + EV_THEMES.length) % EV_THEMES.length];
  const nextStart = active ? start : start + EV_CYCLE_D * D;
  return { cycle: cyc, theme, start, end, active, nextStart, nextTheme: active ? theme : EV_THEMES[(((cyc + 1) % EV_THEMES.length) + EV_THEMES.length) % EV_THEMES.length] };
}
function newEv(cycle, theme) { return { cycle, money: 15, total: 0, claimed: [], gens: Object.fromEntries(theme.gens.map((g) => [g.id, { lvl: 0, mgr: false, buf: 0 }])) }; }
/** Event-Stand für das laufende Event (neu, wenn ein anderes Event lief). */
export function evOf(s, now = Date.now()) {
  const I = eventInfo(now);
  if (!I.active) return null;
  const e = s.ev && s.ev.cycle === I.cycle ? s.ev : newEv(I.cycle, I.theme);
  const gens = {}; for (const g of I.theme.gens) { const q = (e.gens && e.gens[g.id]) || {}; const lvl = Math.max(0, Math.floor(num(q.lvl))); gens[g.id] = { lvl, mgr: !!q.mgr && lvl > 0, buf: Math.max(0, num(q.buf)) }; }
  return { cycle: I.cycle, money: Math.max(0, num(e.money)), total: Math.max(0, num(e.total)), claimed: (Array.isArray(e.claimed) ? e.claimed : []).filter((i) => Number.isInteger(i)), gens, theme: I.theme, info: I };
}
const evGen = (th, id) => th.gens.find((g) => g.id === id);
export const evGenCost = (th, id, lvl, n = 1) => { const g = evGen(th, id); return g.cost * Math.pow(GROW, lvl) * (Math.pow(GROW, n) - 1) / (GROW - 1); };
export const evMaxBuy = (th, id, lvl, money) => { const a = evGen(th, id).cost * Math.pow(GROW, lvl); return Math.max(0, Math.floor(Math.log(money * (GROW - 1) / a + 1) / Math.log(GROW) + 1e-9)); };
export const evMgrCost = (th, id) => evGen(th, id).cost * 15;
export const evVisible = (ev, id) => { const gs = ev.theme.gens; const i = gs.findIndex((g) => g.id === id); return i <= 0 || ev.gens[gs[i - 1].id].lvl > 0; };
export function evRates(s, ev, opt = {}) {
  const k = mult(s, opt); let auto = 0, manual = 0; const per = {};
  for (const g of ev.theme.gens) { const st = ev.gens[g.id], o = st.lvl ? g.out * st.lvl * milestoneMult(st.lvl) * k : 0; per[g.id] = o; if (st.mgr) auto += o; else manual += o; }
  return { auto, manual, per };
}
const evStrip = (ev) => ({ cycle: ev.cycle, money: ev.money, total: ev.total, claimed: ev.claimed, gens: ev.gens });
function evTick(s, dt, opt, withBuf) {
  const ev = evOf(s, opt.now); if (!ev) return;
  const r = evRates(s, ev, opt);
  ev.money += r.auto * dt; ev.total += r.auto * dt;
  if (withBuf) for (const g of ev.theme.gens) { const st = ev.gens[g.id]; if (st.lvl && !st.mgr) st.buf = Math.min(r.per[g.id] * BUF_SEC, st.buf + r.per[g.id] * dt); }
  s.ev = evStrip(ev);
}
function evSet(s, ev) { const n = clone(s); n.ev = evStrip(ev); return n; }
export function evBuy(s, id, k = 1, now = Date.now()) {
  const ev = evOf(s, now); if (!ev || k < 1) return null; const st = ev.gens[id]; if (!st) return null;
  const c = evGenCost(ev.theme, id, st.lvl, k); if (ev.money + 1e-9 < c) return null;
  ev.money -= c; st.lvl += k; return evSet(s, ev);
}
export function evHire(s, id, now = Date.now()) {
  const ev = evOf(s, now); if (!ev) return null; const st = ev.gens[id]; if (!st || st.mgr || !st.lvl) return null;
  const c = evMgrCost(ev.theme, id); if (ev.money + 1e-9 < c) return null;
  ev.money -= c - st.buf; ev.total += st.buf; st.buf = 0; st.mgr = true; return evSet(s, ev);
}
export function evCollect(s, id, now = Date.now()) {
  const ev = evOf(s, now); if (!ev) return { s, got: 0 }; const st = ev.gens[id]; if (!st || !st.buf) return { s, got: 0 };
  const got = st.buf * (1 + relicFx(s, "tap")); ev.money += got; ev.total += got; st.buf = 0;
  const n = evSet(s, ev); n.taps++; return { s: n, got };
}
export const evClaimable = (ev) => EV_TRACK.map((x, i) => i).filter((i) => ev.total >= EV_TRACK[i].at && !ev.claimed.includes(i));
export function evClaim(s, now = Date.now(), rnd = Math.random) {
  const ev = evOf(s, now); if (!ev) return null; const can = evClaimable(ev); if (!can.length) return null;
  const n = clone(s); const got = [];
  for (const i of can) {
    const x = EV_TRACK[i];
    if (x.fuses) n.fuses += x.fuses;
    if (x.inv) n.inv[x.inv] = (n.inv[x.inv] || 0) + 1;
    if (x.cup) n.cups = (n.cups || 0) + 1;
    if (x.relic) { const open = RELICS.filter((r) => (n.relics[r.id] || 0) < RELIC_MAX); if (open.length) { const r = open[Math.floor(rnd() * open.length)]; n.relics[r.id] = (n.relics[r.id] || 0) + 1; got.push(`${r.e} ${r.name}`); } else n.fuses += 20; }
    got.push(`${x.e} ${x.t}`);
  }
  ev.claimed = [...ev.claimed, ...can]; n.ev = evStrip(ev);
  return { s: n, got };
}

/* ---------- Meisterbrief ---------- */
export const starsFor = (allTime) => Math.floor(Math.sqrt(Math.max(0, allTime) / STAR_BASE));
export const prestigeGain = (s) => Math.max(0, starsFor(s.allTime) - s.stars);
export function prestige(s, now = Date.now()) {
  const g = prestigeGain(s);
  if (g < 1) return null;
  const keep = { allTime: s.allTime, stars: s.stars + g, resets: s.resets + 1, akku: s.akku, fuses: s.fuses, blitze: s.blitze, taps: s.taps, ach: s.ach.slice(),
    chestDay: s.chestDay, streak: s.streak, wheelDay: s.wheelDay, spins: s.spins, created: s.created, inv: { ...s.inv }, relics: { ...s.relics }, slots: s.slots, tours: s.tours, exp: s.exp.map((e) => ({ ...e })), ev: s.ev, cups: s.cups };
  return { ...newState(now), ...keep };
}

/* ---------- Anzeige ---------- */
const UNITS = ["", " Tsd.", " Mio.", " Mrd.", " Bio.", " Brd.", " Trio.", " Trd.", " Quad.", " Quint."];
export function fmt(n) {
  n = num(n);
  if (n < 1000) return n.toLocaleString("de-DE", { maximumFractionDigits: n < 10 ? 1 : 0 });
  let i = 0;
  while (n >= 1000 && i < UNITS.length - 1) { n /= 1000; i++; }
  if (n >= 1000) return (n * Math.pow(1000, i)).toExponential(2).replace(".", ",");
  return n.toLocaleString("de-DE", { maximumFractionDigits: n < 100 ? 2 : 1 }) + UNITS[i];
}
export function fmtDur(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, "0")} min` : m ? `${m} min ${String(Math.floor(sec % 60)).padStart(2, "0")} s` : `${Math.floor(sec)} s`;
}
