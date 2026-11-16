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
/* ---------- 110 weitere Bots (eigene Figuren, Stärke steigt mit der Liste) ---------- */
const MORE = `🐣 Küken Kiki|🐌 Schnecke Turbo|🐶 Dackel Waldi|🐱 Katze Minka|🐰 Hase Hoppel|🐢 Schildkröte Speedy|🦆 Ente Erna|🐷 Schweinchen Rosi|🐑 Schaf Wolle|🐭 Maus Pieps|🦔 Igel Stachi|🐸 Frosch Quaxi|🐝 Biene Summsi|🐞 Käfer Punkti|👶 Baby Ben|👧 Lena (7)|👦 Tobi (9)|🐻 Bär Brummi|🐼 Panda Pauli|🐨 Koala Kuschel|🐧 Pinguin Frack|🦉 Eule Ottilie|🧒 Mia (10)|🦊 Fuchs Fridolin|👩‍🎓 Schülerin Sarah|🧑‍🍳 Koch Karli|👨‍🌾 Bauer Hias|👩‍🌾 Bäuerin Liesl|🧑‍🔧 Installateur Ivo|👷‍♀️ Maurerin Monika|🧑‍🏭 Schlosser Schorsch|💂 Wachmann Willi|👨‍🚒 Feuerwehrmann Flo|👮 Polizistin Petra|🧑‍🎓 Student Stefan|👵 Oma Hilde|👴 Opa Alois|🧓 Tante Trude|🧑‍🎨 Malerin Mona|🧑‍🎤 Sänger Sascha|🤠 Cowboy Charly|🎅 Nikolaus Niki|🤶 Christl|🧚 Fee Flora|🧜 Nixe Nelly|🧟 Zombie Zenzi|🧛 Graf Biss|🤴 Prinz Poldi|👸 Prinzessin Pia|🧝 Elfe Elora|🧞 Dschinn Dino|🦸 Super-Susi|🦹 Schurke Schnauz|🥷 Ninja Nino|🧑‍✈️ Pilotin Paula|👨‍⚕️ Doktor Huber|👩‍⚕️ Schwester Sabine|🧑‍🏫 Lehrerin Lotte|🧑‍💻 Programmierer Paul|👩‍🔬 Forscherin Fanny|🕵️ Detektiv Dreher|🧙 Zauberer Zoltan|🔌 Stecker Steffi|🔋 Akku Anton|💡 Glühbirne Gloria|🧲 Magnet Max|⚙️ Zahnrad Zacharias|📡 Funker Ferdinand|🖥️ Computer Konrad|🛰️ Satellit Sigi|♟️ Bauer Bertl|♞ Springer Sprinzl|♝ Läufer Lukas|♜ Turm Traudl|♛ Dame Daniela|♚ König Konstantin|🎩 Baron von Bauer|👑 Königin Karoline|🧑‍🦳 Hofrat Hödl|🦁 Löwe Leopold|🐯 Tiger Tassilo|🐺 Wolf Wotan|🦅 Adler Adalbert|🦈 Hai Harald|🐙 Krake Kasimir|🦄 Einhorn Elvira|🦖 T-Rex Theo|🐲 Drachin Doris|🐉 Drache Draxl|🌩️ Gewitter Gustl|☢️ Reaktor Rudi|🦾 Cyborg Cyrill|👽 Alien Zorg|🛸 Ufo Udo|👾 Pixel Petz|🤖 Robo Rosa|🌪️ Tornado Tom|🌊 Tsunami Tanja|❄️ Eiskalte Edda|🔥 Feuerfaust Fritz|🌋 Vulkan Vinzenz|🏔️ Bergkönig Benedikt|🌌 Kosmos Kassian|👁️ Allsehender Albert|🧙‍♂️ Schachmagier Merlinus|🎓 Professorin Damenopfer|🧠 Neuronetz NEURA|🏆 Weltmeister Wolfgang|💎 Diamant Dominik|🖲️ Supercomputer DEEP-OHM`.split("|");
const MORE2 = `🐿️ Eichhörnchen Emil|🦦 Otter Olli|🦥 Faultier Fritzi|🐊 Krokodil Kroko|🦒 Giraffe Gisela|🦓 Zebra Zora|🦘 Känguru Kurt|🦩 Flamingo Flo|🐓 Hahn Hansi|🦚 Pfau Pepi|🐄 Kuh Liesl|🐐 Ziege Zilli|🐴 Pony Pünktchen|🐹 Hamster Hanni|🐇 Hase Hermine|🦌 Hirsch Hubert|🐗 Wildschwein Wastl|🦫 Biber Bruno|🦭 Robbe Rudi|🐬 Delfin Daisy|🐳 Wal Walter|🦀 Krabbe Klara|🦞 Hummer Hugo-Max|🐠 Fisch Flossi|🐡 Kugelfisch Kugi|🦑 Tintenfisch Tinto|🦋 Schmetterling Schmetti|🐛 Raupe Rosalie|🦗 Grille Gregor|🕷️ Spinne Spinnifix|🦂 Skorpion Sigi|🐍 Schlange Sissi|🦎 Eidechse Eddi|🐢 Opa Schildkröte|🦕 Brachio Bruni|🐘 Elefant Erwin|🦏 Nashorn Norbert|🦛 Nilpferd Nelli|🐪 Kamel Karl|🦙 Lama Lotti|🧑‍🌾 Gärtnerin Gerda|🧑‍🍼 Papa Peter|👩‍🍼 Mama Maria|🧑‍🔬 Chemiker Chris|🧑‍🚀 Astronautin Anna|🧑‍🚒 Feuerwehrfrau Franzi|🧑‍⚖️ Richterin Renate|🧑‍💼 Chefin Charlotte|👨‍💼 Abteilungsleiter Anton|🧑‍🏭 Elektrikerin Elena|👷 Polier Paul|🧑‍🔧 Monteur Martin|🧑‍✈️ Kapitän Klaus|🧑‍🎓 Doktorandin Dora|🧑‍🏫 Direktor Dietrich|🎤 Rapper MC Matt|🎸 Rocker Roland|🎻 Geigerin Greta|🎺 Trompeter Toni|🥁 Trommler Tobias|🎨 Künstler Kasimir|📸 Fotografin Fanny|🎬 Regisseur Rainer|📚 Bücherwurm Berta|🧩 Rätselfuchs Rafael|🎲 Würfelkönig Wenzel|🃏 Joker Jakob|🎯 Dart-Daniel|🏓 Pingpong-Paula|⛷️ Skifahrer Sepp-Hias|🏂 Snowboarderin Sina|🚴 Radler Raphael|🏊 Schwimmerin Selma|🧗 Kletterer Kilian|🤺 Fechterin Felicitas|🥋 Karate-Kai|🏇 Jockey Jonas|🧘 Yoga-Yvonne|🏋️ Gewichtheber Gerhard|🤹 Jongleurin Julia|🎩 Zauberkünstler Zaro|🧙‍♀️ Hexe Hilda|🧚‍♂️ Waldgeist Wurzel|🧛‍♀️ Vampirin Vera|🧟‍♂️ Untoter Udo|🐲 Glücksdrache Lu|🦅 Falke Falko|🦉 Uhu Ulrich|🐺 Leitwolf Lupo|🦁 Löwin Lara|🐆 Gepard Gerold|🦈 Weißer Hai Wanda|🌪️ Wirbelwind Willi|🌞 Sonnenkönig Sol|🌙 Mondgöttin Luna-Maria|⭐ Sternschnuppe Stella|🌋 Lava-Lothar|🧠 Gedankenleser Gideon|🤖 Robo-Großmeister RGM-9`.split("|");
const HI = ["Servus! Lust auf eine Partie?", "Na, bist du bereit?", "Ich hab heute richtig Lust zu spielen!", "Setz dich, ich beiß nicht. Meistens.", "Zeig mal, was du kannst.", "Heute gewinn ich – vielleicht.", "Schach ist mein Lieblingsspiel!", "Mal schauen, wer hier der Chef ist.", "Ich spiel fair – aber nicht nett.", "Konzentration … los geht's!"];
const WIN = ["Gewonnen! Das war knapp … oder?", "Hehe, diesmal ich!", "Gut gespielt – aber nicht gut genug.", "Revanche jederzeit!", "Schachmatt! Juhu!"];
const LOSE = ["Respekt, das war stark!", "Na gut, du hast gewonnen.", "Uff. Nächstes Mal krieg ich dich.", "Gratuliere! Wirklich sauber.", "Ich geb's zu: du warst besser."];
const TALK = ["Hmm …", "Interessant.", "Das hab ich kommen sehen.", "Oh-oh.", "Mutiger Zug!", "Lass mich nachdenken.", "Jetzt wird's spannend!", "Das war aber frech.", "Warte nur ab.", "Hoppla!"];
const pick = (arr, i, k) => arr[(i * 7 + k * 3) % arr.length];
const LEVELS = ["Neu im Schach", "Anfänger", "Fortgeschritten", "Profi", "Meister", "Großmeister"];
function catFor(elo) { return elo < 600 ? LEVELS[0] : elo < 1000 ? LEVELS[1] : elo < 1400 ? LEVELS[2] : elo < 1800 ? LEVELS[3] : elo < 2200 ? LEVELS[4] : LEVELS[5]; }
const ALLMORE = [...MORE, ...MORE2];
const GEN = ALLMORE.map((x, i) => {
  const sp = x.indexOf(" "), e = x.slice(0, sp), name = x.slice(sp + 1);
  const elo = i < MORE.length ? Math.round((200 + (i / (MORE.length - 1)) * 2300) / 10) * 10 : Math.round((220 + (((i - MORE.length) * 0.6180339887) % 1) * 2260) / 10) * 10; // zweite Liste: über alle Stufen verteilt
  return { id: "b" + String(i + 1).padStart(3, "0"), e, name, elo, cat: catFor(elo), ...paramsFor(elo), hi: pick(HI, i, 1), win: pick(WIN, i, 2), lose: pick(LOSE, i, 3), talk: [pick(TALK, i, 1), pick(TALK, i, 4), pick(TALK, i, 6)] };
});
for (const b of BOTS) b.cat = catFor(b.elo);
BOTS.push(...GEN);
BOTS.sort((a, b) => a.elo - b.elo);
export const CATS = LEVELS;
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
/** Neue Elo nach einer Partie (score 1/0,5/0). Fairer als reines Elo:
 *  K = 32 in den ersten 10 Partien, danach 20 · Unterschied zählt höchstens ±400 ·
 *  ein Sieg bringt immer mindestens +4, eine Niederlage kostet höchstens −20. */
export function eloAfter(me, opp, score, games) {
  const k = games < 10 ? 32 : 20, o = me + Math.max(-400, Math.min(400, opp - me));
  let d = k * (score - expected(me, o));
  if (score === 1) d = Math.max(4, d); else if (score === 0) d = Math.max(-20, d);
  return Math.max(100, Math.round(me + d));
}
/** Was steht auf dem Spiel? (für die Anzeige vor der Partie) */
export const stakes = (me, opp, games) => ({ win: eloAfter(me, opp, 1, games) - me, draw: eloAfter(me, opp, 0.5, games) - me, loss: eloAfter(me, opp, 0, games) - me });

/* ---------- Spielstand ---------- */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
export function normMe(x = {}) {
  const bots = {};
  for (const b of BOTS) { const r = (x.bots && x.bots[b.id]) || {}; bots[b.id] = { w: Math.max(0, num(r.w)), d: Math.max(0, num(r.d)), l: Math.max(0, num(r.l)), c: Math.max(0, Math.min(3, Math.floor(num(r.c)))) }; }
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
/** Kronen für einen Sieg: ohne Hilfe (kein Hinweis, kein Rückgängig) 3, mit 1–2 Hilfen 2, sonst 1 */
export const crownsForWin = (helps) => (helps <= 0 ? 3 : helps <= 2 ? 2 : 1);
export function recordGame(me0, { bot, res, color, tc, moves, pgn, date, helps = 0 }) {
  const me = normMe(me0), B = anyBot(bot), sc = res === "win" ? 1 : res === "draw" ? 0.5 : 0;
  const before = me.elo, elo = eloAfter(me.elo, B.elo, sc, me.games);
  const b = me.bots[bot] || { w: 0, d: 0, l: 0, c: 0 };
  return {
    me: { ...me, elo, games: me.games + 1, wins: me.wins + (sc === 1), draws: me.draws + (sc === 0.5), losses: me.losses + (sc === 0),
      bots: { ...me.bots, [bot]: { w: b.w + (sc === 1), d: b.d + (sc === 0.5), l: b.l + (sc === 0), c: Math.max(b.c || 0, sc === 1 ? crownsForWin(helps) : 0) } },
      hist: [...me.hist, { bot, res, color, tc, moves, pgn: String(pgn || "").slice(0, 6000), date: date || Date.now(), elo }].slice(-30) },
    diff: elo - before,
  };
}
/** Kronen je Bot (wie Sterne): 1 = Remis geschafft, 2 = 1 Sieg, 3 = 3 Siege */
export const crowns = (r) => (!r ? 0 : r.c ? r.c : r.w ? 2 : 0); // alte Siege ohne Hilfe-Info: 2

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
  const pts = [[250, 1, 450, 300], [450, 1, 260, 400], [650, 2, 170, 600], [850, 2, 95, 700], [1050, 3, 55, 900], [1250, 3, 28, 1000], [1450, 4, 14, 1200], [1650, 5, 8, 1500], [1850, 7, 3, 2000], [2100, 12, 0, 3000], [2300, 14, 0, 3800], [2450, 18, 0, 4500]];
  let p = pts[0]; for (const x of pts) if (elo >= x[0]) p = x;
  return { depth: p[1], noise: p[2], time: p[3] };
}
/* ---------- Menschliche Fehler (damit 200 Elo sich wie 200 Elo anfühlt) ----------
 * Echte Anfänger rechnen nicht: sie ziehen, was „gut aussieht“ (schlagen, Schach geben, Dame raus),
 * übersehen hängende Figuren und Matt-Drohungen. So oft „zieht“ ein Bot so statt mit der Engine: */
export function slipChance(elo) {
  const pts = [[200, 0.55], [400, 0.4], [600, 0.26], [800, 0.15], [1000, 0.08], [1200, 0.04], [1400, 0.015], [1600, 0]];
  if (elo <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (elo <= pts[i][0]) { const [a, pa] = pts[i - 1], [b, pb] = pts[i]; return pa + ((elo - a) / (b - a)) * (pb - pa); }
  return 0;
}
/** Ein „Anfänger-Zug“ ohne Vorausdenken. ch = chess.js-Instanz. Gibt uci zurück. */
export function humanMove(ch, rnd = Math.random) {
  const ms = ch.moves({ verbose: true }); if (!ms.length) return null;
  const opening = ch.history().length < 16, back = ch.turn() === "w" ? "1" : "8";
  const w = ms.map((m) => {
    let x = 1;
    if (m.captured) x += 3;                       // „Gratis-Figur!“ – auch wenn sie es nicht ist
    if (m.san.includes("+")) x += 2;              // Schach geben macht Spaß
    if (m.piece === "q") x += 1;                  // Dame raus!
    if (m.piece === "k" && !m.flags.includes("k") && !m.flags.includes("q")) x *= 0.25;
    if (opening && m.piece === "p" && /[de]/.test(m.from[0])) x += 2;
    if (opening && (m.piece === "n" || m.piece === "b") && m.from[1] === back) x += 2;
    if (m.promotion) x += m.promotion === "q" ? 4 : -0.9;
    return Math.max(0.05, x);
  });
  let r = rnd() * w.reduce((a, b) => a + b, 0), i = 0;
  while (i < w.length - 1 && (r -= w[i]) > 0) i++;
  const m = ms[i]; return m.from + m.to + (m.promotion || "");
}
/* ---------- Menschen-Modell: so denkt ein Mensch mit dieser Elo ----------
 * 1. Er bemerkt nur ein paar Kandidatenzüge – zuerst das Auffällige (Zurückschlagen, Schlagen, Schach, Entwickeln).
 * 2. Bei jedem Kandidaten sieht er die Antwort des Gegners nur manchmal („Blindheit“) – sonst zählt er nur, was er sofort gewinnt.
 * 3. Den besten Zug findet er öfter, je stärker er ist. 4. Eröffnungen spielt er so, wie Menschen sie spielen. */
const lerp = (pts, x) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, pa] = pts[i - 1], [b, pb] = pts[i]; return pa + ((x - a) / (b - a)) * (pb - pa); } return pts[pts.length - 1][1]; };
export const human = (elo) => ({
  blind: lerp([[200, 0.85], [400, 0.68], [600, 0.5], [800, 0.3], [1000, 0.17], [1200, 0.08], [1400, 0.035], [1600, 0.015], [1800, 0.005], [1900, 0]], elo),
  cands: Math.round(lerp([[200, 3], [600, 4], [1000, 6], [1400, 9], [1800, 14]], elo)),
  findBest: lerp([[200, 0.12], [600, 0.3], [1000, 0.5], [1400, 0.7], [1800, 0.9]], elo),
  temp: lerp([[200, 160], [600, 90], [1000, 40], [1400, 15], [1800, 6]], elo),
});
const HPV = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
// Eröffnungen wie Menschen sie spielen (Gewichte: [unter 800, ab 800])
const BOOK = {
  "": [["e2e4", 55, 50], ["d2d4", 15, 28], ["g1f3", 3, 8], ["c2c4", 2, 7], ["b1c3", 8, 2], ["f2f4", 5, 2], ["a2a4", 4, 0], ["h2h4", 4, 0], ["g2g3", 2, 3]],
  "e2e4": [["e7e5", 50, 40], ["c7c5", 8, 22], ["e7e6", 6, 10], ["c7c6", 5, 8], ["d7d5", 8, 6], ["b8c6", 10, 3], ["d7d6", 8, 4], ["a7a6", 5, 0], ["h7h6", 4, 0]],
  "d2d4": [["d7d5", 50, 45], ["g8f6", 10, 35], ["e7e6", 10, 8], ["b8c6", 10, 2], ["f7f5", 4, 4], ["e7e5", 10, 2]],
  "e2e4 e7e5": [["g1f3", 45, 65], ["d1h5", 18, 2], ["f1c4", 15, 10], ["b1c3", 8, 8], ["d1f3", 8, 0], ["d2d4", 6, 10], ["f2f4", 3, 5]],
  "e2e4 e7e5 g1f3": [["b8c6", 60, 70], ["d7d6", 15, 12], ["g8f6", 10, 15], ["f7f6", 8, 0], ["d8e7", 7, 0]],
  "e2e4 e7e5 d1h5": [["b8c6", 45, 50], ["g7g6", 20, 40], ["d8e7", 15, 10], ["g8f6", 20, 0]],
  "e2e4 e7e5 g1f3 b8c6": [["f1c4", 40, 30], ["f1b5", 15, 40], ["d2d4", 15, 20], ["b1c3", 15, 10], ["h2h3", 15, 0]],
  "e2e4 e7e5 f1c4": [["b8c6", 40, 45], ["g8f6", 30, 45], ["d8g5", 15, 0], ["f8c5", 15, 10]],
};
function bookMove(ch, elo, rnd) {
  const key = ch.history({ verbose: true }).map((m) => m.from + m.to).join(" "), L = BOOK[key]; if (!L) return null;
  const col = elo < 800 ? 1 : 2, legal = new Set(ch.moves({ verbose: true }).map((m) => m.from + m.to));
  const ok = L.filter((x) => legal.has(x[0]) && x[col] > 0); if (!ok.length) return null;
  let r = rnd() * ok.reduce((a, x) => a + x[col], 0); for (const x of ok) if ((r -= x[col]) <= 0) return x[0];
  return ok[0][0];
}
/** Wählt einen menschlichen Zug. list = Engine-Wertungen aller Züge [[uci, cp]] (Sicht der Seite am Zug). */
export function humanChoose(ch, elo, list, rnd = Math.random) {
  const ms = ch.moves({ verbose: true }); if (!ms.length) return null;
  const plies = ch.history().length;
  if (plies < 6) { const b = bookMove(ch, elo, rnd); if (b && rnd() < 0.9) return b; }
  const H = human(elo), sc = new Map(list.map(([u, v]) => [u.slice(0, 4), v])), uci = (m) => m.from + m.to + (m.promotion || "");
  const best = list.length ? list[0][1] : 0, last = ch.history({ verbose: true }).slice(-1)[0], back = ch.turn() === "w" ? "1" : "8";
  if (best > 20000 && rnd() < 0.5 + H.findBest / 2) return list[0][0]; // Matt sehen auch Menschen oft
  // Auffälligkeit: was springt ins Auge?
  const sal = ms.map((m) => {
    let x = 1 + rnd() * 1.5;
    if (last && m.captured && m.to === last.to) x += 6;                  // zurückschlagen – Instinkt
    if (m.captured) x += 2 + HPV[m.captured];
    if (m.san.includes("+")) x += 2;
    if (plies < 16 && (m.piece === "n" || m.piece === "b") && m.from[1] === back) x += 2.5;
    if (plies < 10 && m.piece === "p" && /[cde]/.test(m.from[0]) && m.from[1] !== back) x += 1.5;
    if (m.flags.includes("k") || m.flags.includes("q")) x += 2;
    if (m.piece === "q" && elo < 900) x += 1.5;                           // Anfänger lieben die Dame
    if (m.piece === "k" && !m.flags.includes("k") && !m.flags.includes("q")) x *= plies > 60 ? 1 : 0.3;
    if (m.promotion) x += m.promotion === "q" ? 6 : -0.8;
    return { m, x };
  });
  // Kandidaten ziehen (ohne Zurücklegen), der beste Zug ist mit findBest-Wahrscheinlichkeit dabei
  const pool = sal.slice(), cands = [];
  if (list.length && rnd() < H.findBest) { const i = pool.findIndex((c) => uci(c.m).slice(0, 4) === list[0][0].slice(0, 4)); if (i >= 0) cands.push(pool.splice(i, 1)[0]); }
  while (cands.length < H.cands && pool.length) {
    let r = rnd() * pool.reduce((a, c) => a + c.x, 0), i = 0; while (i < pool.length - 1 && (r -= pool[i].x) > 0) i++;
    cands.push(pool.splice(i, 1)[0]);
  }
  // Bewerten, wie er es wahrnimmt
  const now = sc.size ? Math.max(...sc.values()) : 0;
  let pick = cands[0].m, top = -Infinity;
  for (const { m } of cands) {
    const eng = sc.has(m.from + m.to) ? sc.get(m.from + m.to) : 0;
    const naive = Math.min(now, 300) + (m.captured ? HPV[m.captured] * 100 : 0) + (m.san.includes("+") ? 30 : 0) + (m.promotion === "q" ? 800 : 0);
    const seen = rnd() >= H.blind, v = (seen ? eng : naive) + (rnd() * 2 - 1) * H.temp;
    if (v > top) { top = v; pick = m; }
  }
  return uci(pick);
}
/** Starke Bots geben aussichtslose Partien auf (wie Menschen). Anfänger kämpfen bis zum Schluss. */
export const resignsAt = (elo) => (elo >= 1200 ? -900 : null);
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

/* ---------- 🔍 Partie-Analyse ---------- */
// ev[k] = Bewertung (Centipawns, Sicht Weiß) der Stellung nach k Halbzügen; best[k] = bester Zug in dieser Stellung (UCI).
export const MATE_CP = 30000;
const clampCp = (v) => (Math.abs(v) > MATE_CP - 1000 ? Math.sign(v) * 1500 : Math.max(-1500, Math.min(1500, v)));
export const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clampCp(cp))) - 1);
export const CLASSES = [
  { k: "great", e: "‼", t: "Großartig", c: "#26c2a3" },
  { k: "best", e: "★", t: "Bester Zug", c: "#81b64c" },
  { k: "exc", e: "👍", t: "Exzellent", c: "#96bc4b" },
  { k: "good", e: "✓", t: "Gut", c: "#95b776" },
  { k: "inacc", e: "?!", t: "Ungenau", c: "#f7c631" },
  { k: "miss", e: "✕", t: "Verpasst", c: "#ff7769" },
  { k: "mist", e: "?", t: "Fehler", c: "#ffa459" },
  { k: "blund", e: "??", t: "Patzer", c: "#fa412d" },
];
export const classOf = (k) => CLASSES.find((x) => x.k === k);
const PV = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/**
 * moves: UCI-Liste, ev/best wie oben; caps (optional): je Zug { piece, captured } (für „Großartig“ = gutes Opfer)
 * → je Zug { ply, side, cls, loss (Gewinn-%) } + Genauigkeit, Zählung, geschätzte Spielbewertung und Phasen je Seite
 */
export function analyse(moves, ev, best, caps = []) {
  const out = [], acc = { w: [], b: [] };
  for (let i = 0; i < moves.length; i++) {
    const side = i % 2 === 0 ? "w" : "b", sg = side === "w" ? 1 : -1;
    const before = winPct(sg * ev[i]), after = winPct(sg * ev[i + 1]);
    const loss = Math.max(0, before - after);
    const isBest = best[i] && moves[i].slice(0, 4) === best[i].slice(0, 4);
    const prevOpp = i > 0 ? winPct(sg * ev[i - 1]) : 50; // Stand vor dem gegnerischen Zug
    const c = caps[i] || {};
    let cls = isBest || loss < 1 ? "best" : loss < 3 ? "exc" : loss < 6 ? "good" : loss < 12 ? "inacc" : loss < 22 ? "mist" : "blund";
    // Verpasst: Gegner hatte gerade einen Fehler gemacht (Chance war da), du nutzt sie nicht, stehst aber nicht schlechter als vorher
    if ((cls === "mist" || cls === "blund") && before - prevOpp > 15 && after >= prevOpp - 3) cls = "miss";
    // Großartig: bester Zug, der Material hergibt (Figur zieht auf ein Feld, wo sie geschlagen werden kann, oder schlägt Kleineres) und gut steht
    if (cls === "best" && c.sac && after >= 50) cls = "great";
    out.push({ ply: i, side, cls, loss: Math.round(loss * 10) / 10, best: best[i] });
    acc[side].push(Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669)));
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : 0);
  const count = (side) => Object.fromEntries(CLASSES.map((cc) => [cc.k, out.filter((m) => m.side === side && m.cls === cc.k).length]));
  // Phasen: Eröffnung bis Halbzug 20, Endspiel ab dem Zeitpunkt, wo wenig Material übrig ist (caps[i].endgame)
  const phaseOf = (i) => ((caps[i] || {}).endgame ? "end" : i < 20 ? "open" : "mid");
  const phase = (side) => Object.fromEntries(["open", "mid", "end"].map((ph) => { const a = out.filter((m, i) => m.side === side && phaseOf(i) === ph).map((m) => m.loss); if (!a.length) return [ph, null]; const av = a.reduce((x, y) => x + y, 0) / a.length; return [ph, av < 4 ? "good" : av < 9 ? "inacc" : "bad"]; }));
  const rating = (a) => Math.max(100, Math.min(2800, Math.round(((a - 40) * 38) / 50) * 50));
  const A = { w: avg(acc.w), b: avg(acc.b) };
  return { moves: out, acc: A, count: { w: count("w"), b: count("b") }, rating: { w: rating(A.w), b: rating(A.b) }, phase: { w: phase("w"), b: phase("b") } };
}
export const fmtEval = (cp) => (Math.abs(cp) > MATE_CP - 1000 ? `${cp > 0 ? "+" : "−"}M${Math.ceil((MATE_CP - Math.abs(cp)) / 2)}` : `${cp >= 0 ? "+" : "−"}${(Math.abs(cp) / 100).toFixed(1).replace(".", ",")}`);
