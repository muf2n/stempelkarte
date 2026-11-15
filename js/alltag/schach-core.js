// ♟️ Schach – reine Logik (kein DOM): Bots mit Persönlichkeit, Bedenkzeiten, Elo, Spielstand, Rätsel-Wertung.
// Gespeichert in Sammlung „spiel“, Dokument "schach": { elo, games, wins, draws, losses, bots: {id: {w, d, l}},
//   hist: [{bot, res, color, tc, moves, date, pgn}] (letzte 30), pz: {r, n, ok, streak, best, day, dayDone, solved:[ids]} }

export const BOTS = [
  { id: "hugo", e: "🐹", name: "Hamster Hugo", elo: 250, cat: "Neu im Schach", depth: 1, noise: 450, time: 300,
    hi: "Quiek! Wie hüpft nochmal das Pferd?", win: "Ich hab gewonnen?! Sonnenblumenkerne für alle!", lose: "Quiek … gut gespielt. Ich geh zurück ins Laufrad.", talk: ["Ui, glänzt die Dame schön.", "Ich zieh einfach irgendwas.", "Darf der Bauer rückwärts?"] },
  { id: "luki", e: "🧒", name: "Lehrling Luki", elo: 450, cat: "Neu im Schach", depth: 1, noise: 260, time: 400,
    hi: "Servus! Ich spiel erst seit der Berufsschule.", win: "Ha! Das erzähl ich morgen in der Pause!", lose: "Na geh … Revanche nach der Jause?", talk: ["Hmm, wo war nochmal der Läufer?", "Das hat mir der Meister gezeigt!", "Oh, das hab ich nicht gesehen."] },
  { id: "gerti", e: "👵", name: "Oma Gerti", elo: 650, cat: "Neu im Schach", depth: 2, noise: 170, time: 600,
    hi: "Setz dich, Bub. Magst einen Kuchen?", win: "So, und jetzt iss noch ein Stück Kuchen.", lose: "Brav, brav! Du bist ja ein ganz Schlauer.", talk: ["Früher haben wir mit Holzfiguren gespielt.", "Na schau, der Springer.", "Nimm dir Zeit, Schatz."] },
  { id: "franz", e: "👷", name: "Polier Franz", elo: 850, cat: "Anfänger", depth: 2, noise: 95, time: 700,
    hi: "Auf der Baustelle bin ich der Chef. Am Brett auch.", win: "Siehst, so wird's gemacht. Und jetzt Kaffee.", lose: "Respekt, Burschi. Das hätt ich nicht gedacht.", talk: ["Zack, und weiter.", "Das ist kein Zug, das ist Pfusch!", "Ich brauch noch einen Kaffee."] },
  { id: "eva", e: "👩‍🔧", name: "Elektro-Eva", elo: 1050, cat: "Anfänger", depth: 3, noise: 55, time: 900,
    hi: "Spannung liegt an. Los geht's!", win: "Kurzschluss bei dir – Sicherung geflogen!", lose: "Gut geschaltet! Das war eine saubere Partie.", talk: ["Das steht unter Strom.", "Achtung, Hochspannung am Königsflügel!", "Erst messen, dann ziehen."] },
  { id: "sepp", e: "🧔", name: "Meister Sepp", elo: 1250, cat: "Fortgeschritten", depth: 3, noise: 28, time: 1000,
    hi: "Grüß dich. Zeig mir, was du gelernt hast.", win: "Lehrjahre sind keine Herrenjahre. Nochmal!", lose: "Sauber! Bald brauchst mich nimmer.", talk: ["Ordentlich verlegt, die Figuren.", "Das hätte ich anders gemacht.", "Denk an deinen König."] },
  { id: "ida", e: "👩‍💼", name: "Ingenieurin Ida", elo: 1450, cat: "Fortgeschritten", depth: 4, noise: 14, time: 1200,
    hi: "Ich habe die Partie schon durchgerechnet. Fast.", win: "Wie berechnet. Danke für die Partie.", lose: "Interessant. Das muss ich nachrechnen.", talk: ["Laut Plan läuft alles.", "Eine elegante Struktur.", "Hmm, statisch korrekt."] },
  { id: "ohm", e: "🧑‍🏫", name: "Professor Ohm", elo: 1650, cat: "Profi", depth: 5, noise: 8, time: 1500,
    hi: "Widerstand ist zwecklos. Das ist mein Gesetz.", win: "U = R · I. Und du = besiegt.", lose: "Bemerkenswert! Das kommt in meine Vorlesung.", talk: ["Ein klassischer Aufbau.", "Das erinnert mich an 1827.", "Spannung, Strom, Widerstand …"] },
  { id: "volt", e: "🤖", name: "Roboter Volt", elo: 1850, cat: "Profi", depth: 7, noise: 3, time: 2000,
    hi: "BEEP. Partie geladen. Gewinnwahrscheinlichkeit: hoch.", win: "BEEP BOOP. Erwartetes Ergebnis.", lose: "FEHLER 404: Sieg nicht gefunden. Gratuliere, Mensch.", talk: ["Berechne …", "Zug optimal.", "Interessanter menschlicher Zug."] },
  { id: "blitz", e: "⚡", name: "Großmeister Blitz", elo: 2100, cat: "Meister", depth: 12, noise: 0, time: 3000,
    hi: "Ich schlage ein wie der Blitz. Bist du bereit?", win: "Donnerwetter – das ging schnell.", lose: "Unglaublich! Du bist ein Gewitter am Brett!", talk: ["⚡", "Gewitter zieht auf.", "Das war vorhersehbar."] },
];
export const CATS = ["Neu im Schach", "Anfänger", "Fortgeschritten", "Profi", "Meister"];
export const botById = (id) => BOTS.find((b) => b.id === id) || BOTS[0];

/** Bedenkzeiten: [id, Minuten, Inkrement s] */
export const TCS = [
  { cat: "Ohne Uhr", e: "♾️", list: [["none", 0, 0, "Ohne Uhr"]] },
  { cat: "Bullet", e: "🚀", list: [["1", 1, 0, "1 min"], ["1+1", 1, 1, "1 + 1"], ["2+1", 2, 1, "2 + 1"]] },
  { cat: "Blitz", e: "⚡", list: [["3+2", 3, 2, "3 + 2"], ["5", 5, 0, "5 min"], ["5+5", 5, 5, "5 + 5"]] },
  { cat: "Schnellschach", e: "⏱️", list: [["10", 10, 0, "10 min"], ["15+10", 15, 10, "15 + 10"], ["30", 30, 0, "30 min"], ["10+5", 10, 5, "10 + 5"], ["20", 20, 0, "20 min"], ["60", 60, 0, "60 min"]] },
];
export const tcById = (id) => { for (const c of TCS) for (const t of c.list) if (t[0] === id) return { id: t[0], min: t[1], inc: t[2], label: t[3], cat: c.cat }; return { id: "none", min: 0, inc: 0, label: "Ohne Uhr", cat: "Ohne Uhr" }; };

/** Wie lange darf der Bot denken? (Bot-Zeit, aber mit Uhr nie mehr als ~1/25 der Restzeit + Inkrement) */
export function thinkMs(bot, clockMs, incS) {
  if (clockMs == null) return bot.time;
  return Math.max(120, Math.min(bot.time, clockMs / 25 + incS * 800));
}

/* ---------- Elo ---------- */
export const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
/** Neue Elo nach einer Partie (score 1/0,5/0). K = 40 in den ersten 10 Partien, danach 24. */
export function eloAfter(me, opp, score, games) {
  const k = games < 10 ? 40 : 24;
  return Math.max(100, Math.round(me + k * (score - expected(me, opp))));
}

/* ---------- Spielstand ---------- */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
export function normMe(x = {}) {
  const bots = {};
  for (const b of BOTS) { const r = (x.bots && x.bots[b.id]) || {}; bots[b.id] = { w: Math.max(0, num(r.w)), d: Math.max(0, num(r.d)), l: Math.max(0, num(r.l)) }; }
  const pz = x.pz || {};
  return {
    elo: Math.round(num(x.elo, 800)), games: Math.max(0, num(x.games)), wins: Math.max(0, num(x.wins)), draws: Math.max(0, num(x.draws)), losses: Math.max(0, num(x.losses)),
    bots, hist: (Array.isArray(x.hist) ? x.hist : []).slice(-30),
    pz: { r: Math.round(num(pz.r, 800)), n: Math.max(0, num(pz.n)), ok: Math.max(0, num(pz.ok)), streak: Math.max(0, num(pz.streak)), best: Math.max(0, num(pz.best)),
      day: String(pz.day || ""), dayDone: !!pz.dayDone, solved: (Array.isArray(pz.solved) ? pz.solved : []).slice(-600) },
    ev: x.ev && typeof x.ev === "object" && /^\d{4}-\d{2}-\d{2}$/.test(String(x.ev.key || "")) ? { key: x.ev.key, won: (Array.isArray(x.ev.won) ? x.ev.won : []).filter((i) => Number.isInteger(i) && i >= 0 && i < 5), claimed: (Array.isArray(x.ev.claimed) ? x.ev.claimed : []).filter((i) => Number.isInteger(i) && i >= 0 && i < 4) } : null,
    cups: Math.max(0, num(x.cups)),
    last: x.last && typeof x.last === "object" ? { bot: String(x.last.bot || "eva"), tc: String(x.last.tc || "none"), color: ["w", "b", "r"].includes(x.last.color) ? x.last.color : "w" } : { bot: "eva", tc: "none", color: "w" },
  };
}
/** Ergebnis eintragen. res: "win" | "draw" | "loss" (aus Sicht des Spielers) */
export function recordGame(me0, { bot, res, color, tc, moves, pgn, date }) {
  const me = normMe(me0), B = anyBot(bot), sc = res === "win" ? 1 : res === "draw" ? 0.5 : 0;
  const before = me.elo, elo = eloAfter(me.elo, B.elo, sc, me.games);
  const b = me.bots[bot] || { w: 0, d: 0, l: 0 };
  return {
    me: { ...me, elo, games: me.games + 1, wins: me.wins + (sc === 1), draws: me.draws + (sc === 0.5), losses: me.losses + (sc === 0),
      bots: { ...me.bots, [bot]: { w: b.w + (sc === 1), d: b.d + (sc === 0.5), l: b.l + (sc === 0) } },
      hist: [...me.hist, { bot, res, color, tc, moves, pgn: String(pgn || "").slice(0, 6000), date: date || Date.now(), elo }].slice(-30) },
    diff: elo - before,
  };
}
/** Kronen je Bot (wie Sterne): 1 = Remis geschafft, 2 = 1 Sieg, 3 = 3 Siege */
export const crowns = (r) => (r.w >= 3 ? 3 : r.w >= 1 ? 2 : r.d >= 1 ? 1 : 0);

/* ---------- Rätsel ---------- */
export function puzzleResult(me0, p, ok, today) {
  const me = normMe(me0), k = me.pz.n < 15 ? 40 : 20;
  const r = Math.max(100, Math.round(me.pz.r + k * ((ok ? 1 : 0) - expected(me.pz.r, p.r))));
  const streak = ok ? me.pz.streak + 1 : 0;
  return { ...me, pz: { ...me.pz, r, n: me.pz.n + 1, ok: me.pz.ok + (ok ? 1 : 0), streak, best: Math.max(me.pz.best, streak), solved: ok ? [...new Set([...me.pz.solved, p.id])].slice(-600) : me.pz.solved } };
}
/** Nächstes Rätsel: nahe an der eigenen Wertung, noch nicht gelöst. */
export function nextPuzzle(puzzles, me, rnd = Math.random) {
  const r = me.pz.r, done = new Set(me.pz.solved);
  const pool = puzzles.filter((p) => !done.has(p.id) && Math.abs(p.r - r) <= 250);
  const list = pool.length ? pool : puzzles.filter((p) => !done.has(p.id));
  const all = list.length ? list : puzzles;
  return all[Math.floor(rnd() * all.length)];
}
export function dailyPuzzle(puzzles, day) {
  let h = 0; for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const mid = puzzles.filter((p) => p.r >= 900 && p.r <= 1600);
  const list = mid.length ? mid : puzzles;
  return list[h % list.length];
}
export function fmtClock(ms) {
  if (ms == null) return "∞";
  ms = Math.max(0, ms);
  const s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
  return ms < 10000 ? `${Math.floor(ms / 1000)},${Math.floor((ms % 1000) / 100)}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------- 🎪 Wochen-Event: jeden Montag 5 neue Bots (zufällige Stärke, links schwach → rechts stark) ---------- */
const EV_THEMES = [
  { t: "Baustellen-Gang", e: "🏗️", c: ["👷‍♂️", "🦺", "🚧", "🏋️", "🦾"], n: ["Kran-Kurt", "Beton-Berta", "Schalungs-Sigi", "Mörtel-Max", "Bagger-Boris"] },
  { t: "Oma-Turnier", e: "👵", c: ["👵🏻", "👴🏼", "🧶", "🍰", "👑"], n: ["Strick-Resi", "Kuchen-Kathi", "Opa Ferdl", "Tante Mitzi", "Uroma Gusti"] },
  { t: "Roboter-Revolte", e: "🤖", c: ["🔩", "🦿", "🛰️", "🧠", "👾"], n: ["Schräubchen", "Servo-7", "Kabel-Karl", "Byte-Bianca", "Omega-X"] },
  { t: "Donau-Piraten", e: "🏴‍☠️", c: ["🦜", "⚓", "🗺️", "🦈", "🏴‍☠️"], n: ["Papagei Pepe", "Anker-Anni", "Kapitän Kurz", "Hai-Hannes", "Käpt'n Schwarzbart"] },
  { t: "Zirkus Blitzlicht", e: "🎪", c: ["🤡", "🤹", "🐘", "🦁", "🎩"], n: ["Clown Fipsi", "Jongleur Jo", "Elefant Emil", "Löwe Leo", "Direktor Zack"] },
  { t: "Dino-Park", e: "🦖", c: ["🦕", "🥚", "🦴", "🌋", "🦖"], n: ["Diplo-Didi", "Eierkopf", "Knochen-Kai", "Vulkan-Vroni", "T-Rex Toni"] },
  { t: "Weltraum-Liga", e: "🚀", c: ["👨‍🚀", "🛸", "🌙", "☄️", "🌌"], n: ["Astro-Andi", "Ufo-Uschi", "Mond-Moritz", "Komet-Klara", "Galaxis-Gerd"] },
  { t: "Fußball-Profis", e: "⚽", c: ["🥅", "🧤", "👟", "🏆", "⭐"], n: ["Tormann Toni", "Verteidiger Vinz", "Flügel-Flo", "Kapitän Krankl", "Star Stürmer"] },
];
export const EV_REWARD = [5, 8, 12, 20, 30];
/** Belohnungsleiste (💵 gesammelt): Belohnung für den Strom-Tycoon */
export const EV_TRACK = [
  { at: 13, e: "🔩", t: "10 Sicherungen", fuses: 10 },
  { at: 25, e: "⚡", t: "Doppelstrom-Booster", inv: "x2" },
  { at: 45, e: "🔥", t: "Dreifach-Booster + 15 🔩", inv: "x3", fuses: 15 },
  { at: 75, e: "🏆", t: "Wochen-Pokal + Zeitsprung 8 h + 30 🔩", inv: "zeit8", fuses: 30, cup: true },
];
const mondayKey = (now) => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function seeded(str) { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; }; }
/** Engine-Stärke aus der Elo (gleiche Skala wie die festen Bots) */
export function paramsFor(elo) {
  const pts = [[250, 1, 450, 300], [450, 1, 260, 400], [650, 2, 170, 600], [850, 2, 95, 700], [1050, 3, 55, 900], [1250, 3, 28, 1000], [1450, 4, 14, 1200], [1650, 5, 8, 1500], [1850, 7, 3, 2000], [2100, 12, 0, 3000]];
  let p = pts[0]; for (const x of pts) if (elo >= x[0]) p = x;
  return { depth: p[1], noise: p[2], time: p[3] };
}
export function weekEvent(now = Date.now()) {
  const key = mondayKey(now), r = seeded("ev" + key);
  const [y, m, d] = key.split("-").map(Number), ends = new Date(y, m - 1, d + 7, 0, 0, 0).getTime();
  const th = EV_THEMES[Math.floor(r() * EV_THEMES.length)];
  const elos = Array.from({ length: 5 }, (_, i) => Math.round((250 + i * 330 + r() * 300) / 10) * 10).sort((a, b) => a - b); // zufällig, aber steigend
  const bots = th.n.map((name, i) => ({ id: `ev-${key}-${i}`, e: th.c[i], name, elo: elos[i], cat: "Event", ev: true, reward: EV_REWARD[i], ...paramsFor(elos[i]),
    hi: ["Na, traust du dich?", "Ich bin heute in Form!", "Das wird lustig.", "Ich hab trainiert. Viel.", "Ich bin der Boss dieser Woche."][i],
    win: "Gewonnen! Komm nächste Woche wieder.", lose: "Respekt! Du hast dir die 💵 verdient.", talk: ["Event-Zeit!", "Hmm …", "Nicht schlecht.", "Na warte!"] }));
  return { key, ends, theme: th.t, e: th.e, bots };
}
const _botById = botById;
/** Bot inkl. Event-Bots (ID „ev-JJJJ-MM-TT-i“) */
export function anyBot(id, now = Date.now()) {
  const m = /^ev-(\d{4}-\d{2}-\d{2})-(\d)$/.exec(String(id || ""));
  if (!m) return _botById(id);
  const [y, mo, d] = m[1].split("-").map(Number);
  return weekEvent(new Date(y, mo - 1, d, 12).getTime()).bots[Number(m[2])];
}
export function evState(me, ev) { const e = me.ev && me.ev.key === ev.key ? me.ev : { key: ev.key, won: [], claimed: [] }; return { ...e, pts: e.won.reduce((a, i) => a + EV_REWARD[i], 0) }; }
/** Sieg gegen Event-Bot i eintragen → neuer Spielstand (+ freigewordene Belohnungen) */
export function evWin(me, ev, i) {
  const st = evState(me, ev);
  if (st.won.includes(i)) return { me, gained: 0 };
  const won = [...st.won, i];
  return { me: { ...me, ev: { key: ev.key, won, claimed: st.claimed } }, gained: EV_REWARD[i] };
}
export const evClaimable = (st) => EV_TRACK.map((x, i) => i).filter((i) => st.pts >= EV_TRACK[i].at && !st.claimed.includes(i));
