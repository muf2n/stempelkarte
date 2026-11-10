// Update 12 – reine Logik (kein DOM) für 🐾 Haustiere, 👕 Kleiderschrank, 👥 Freunde & Gruppen und 🏠 Wohnen.
// Sammlungen:
//   „tiere“     { id, name, art, emoji, birthday, chip, food: { what, times: ["07:00"], amount }, care: [{ id, title, every (Tage), last }],
//                 vet: [{ id, date, reason, cost, note }], vacc: [{ id, name, date, next }], meds: [{ id, name, dose, from, until, times }],
//                 weight: [{ date, kg }], costs: [{ id, date, what, amount }], notes, photo (Vorschaubild) }
//   „kleidung“  { id, name, cat, color, seasons: [fruehling|sommer|herbst|winter], warmth 1–3, care, fav, worn: [YYYY-MM-DD], photo }
//   „outfits“   { id, name, items: [kleidung-id], fav, worn: [YYYY-MM-DD], plan: [YYYY-MM-DD] }
//   „gruppen“   { id, name, emoji, people: [{ id, name }] (ME = "me" ist immer dabei), events: [{ id, title, date, time, place, note }],
//                 tasks: [{ id, text, who, done }], expenses: [{ id, what, amount, paidBy, forIds, date, kind?: "pay", to? }], challenge: { title, goal, unit, progress: { personId: n } } }
//   „wohnen“    Dokumente mit kind: "umzug" (id "umzug": { date, done: { schritt: true }, own: [{ id, text, days }] }),
//               "kosten" ({ id, name, amount, every: 1|3|12, meter?: [{ date, value }], unit }), "verleih" ({ id, what, who, since, due, back }),
//               "ort" ({ id, what, where, room, note }), "raum" ({ id, name, m2, note })

const s = (v) => (v == null ? "" : String(v)).trim();
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const isKey = (k) => RE_KEY.test(s(k));
const pad = (n) => String(n).padStart(2, "0");
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(k, n) { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); }
export const diffDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
export const fmtDay = (k) => (isKey(k) ? `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}` : "");
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
const arr = (v) => (Array.isArray(v) ? v : []);
export const eur = (v) => (Number(v) || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

/* ================================================================== 🐾 Haustiere */
export const PET_KINDS = [["hund", "🐶", "Hund"], ["katze", "🐱", "Katze"], ["kaninchen", "🐰", "Kaninchen"], ["meerschwein", "🐹", "Meerschweinchen"], ["vogel", "🦜", "Vogel"], ["fisch", "🐠", "Fische"], ["reptil", "🦎", "Reptil"], ["pferd", "🐴", "Pferd"], ["anderes", "🐾", "Anderes"]];
export const CARE_PRESETS = { hund: [["Krallen schneiden", 30], ["Entwurmen", 90], ["Floh-/Zeckenschutz", 30], ["Baden", 60]], katze: [["Katzenklo komplett reinigen", 7], ["Entwurmen", 90], ["Floh-Schutz", 30], ["Kratzbaum checken", 60]],
  kaninchen: [["Stall ausmisten", 7], ["Krallen kontrollieren", 30]], meerschwein: [["Käfig ausmisten", 7], ["Krallen kontrollieren", 30]], fisch: [["Wasser teilweise wechseln", 14], ["Filter reinigen", 30]],
  vogel: [["Käfig reinigen", 7]], reptil: [["Terrarium reinigen", 14]], pferd: [["Hufschmied", 42]], anderes: [] };

export function normPet(x = {}) {
  const k = PET_KINDS.find((p) => p[0] === x.art) || PET_KINDS[PET_KINDS.length - 1];
  return {
    id: s(x.id), name: s(x.name).slice(0, 40), art: k[0], emoji: s(x.emoji).slice(0, 4) || k[1], birthday: isKey(x.birthday) ? x.birthday : "", chip: s(x.chip).slice(0, 30),
    food: { what: s(x.food && x.food.what).slice(0, 80), amount: s(x.food && x.food.amount).slice(0, 40), times: arr(x.food && x.food.times).filter((t) => /^\d{2}:\d{2}$/.test(t)).slice(0, 6) },
    care: arr(x.care).filter((c) => c && s(c.title)).map((c) => ({ id: s(c.id) || nid(), title: s(c.title).slice(0, 60), every: Math.max(1, Math.min(730, Math.round(num(c.every)) || 30)), last: isKey(c.last) ? c.last : "" })).slice(0, 30),
    vet: arr(x.vet).filter((v) => v && isKey(v.date)).map((v) => ({ id: s(v.id) || nid(), date: v.date, reason: s(v.reason).slice(0, 100), cost: r2(Math.max(0, num(v.cost))), note: s(v.note).slice(0, 300) })).slice(-100),
    vacc: arr(x.vacc).filter((v) => v && s(v.name)).map((v) => ({ id: s(v.id) || nid(), name: s(v.name).slice(0, 60), date: isKey(v.date) ? v.date : "", next: isKey(v.next) ? v.next : "" })).slice(0, 30),
    meds: arr(x.meds).filter((m) => m && s(m.name)).map((m) => ({ id: s(m.id) || nid(), name: s(m.name).slice(0, 60), dose: s(m.dose).slice(0, 40), from: isKey(m.from) ? m.from : "", until: isKey(m.until) ? m.until : "", times: arr(m.times).filter((t) => /^\d{2}:\d{2}$/.test(t)).slice(0, 6) })).slice(0, 20),
    weight: arr(x.weight).filter((w) => w && isKey(w.date) && num(w.kg) > 0).map((w) => ({ date: w.date, kg: r2(num(w.kg)) })).sort((a, b) => a.date.localeCompare(b.date)).slice(-200),
    costs: arr(x.costs).filter((c) => c && isKey(c.date) && num(c.amount) > 0).map((c) => ({ id: s(c.id) || nid(), date: c.date, what: s(c.what).slice(0, 80), amount: r2(num(c.amount)) })).slice(-300),
    notes: s(x.notes).slice(0, 2000), photo: /^data:image\/(jpeg|png|webp);base64,/.test(s(x.photo)) && s(x.photo).length < 200000 ? s(x.photo) : "",
  };
}
export const careNext = (c, today) => (c.last ? addDays(c.last, c.every) : today);
export function ageText(birthday, today) {
  if (!isKey(birthday)) return "";
  const b = dateOf(birthday), t = dateOf(today);
  let y = t.getFullYear() - b.getFullYear(), m = t.getMonth() - b.getMonth();
  if (t.getDate() < b.getDate()) m--;
  if (m < 0) { y--; m += 12; }
  return y > 0 ? `${y} ${y === 1 ? "Jahr" : "Jahre"}${m ? `, ${m} Mon.` : ""}` : `${m} ${m === 1 ? "Monat" : "Monate"}`;
}
/** Was beim Tier ansteht: Pflege fällig, Impfung bald, Medikament heute, Tierarzt bald. */
export function petDue(pets, today) {
  const out = [];
  for (const p of pets.map(normPet).filter((x) => x.id && x.name)) {
    for (const c of p.care) { const n = careNext(c, today), d = diffDays(today, n); if (d <= 0) out.push({ pet: p, kind: "pflege", id: c.id, text: c.title, date: n, days: d }); }
    for (const v of p.vacc) if (v.next) { const d = diffDays(today, v.next); if (d <= 14 && d >= -30) out.push({ pet: p, kind: "impfung", id: v.id, text: `Impfung ${v.name}`, date: v.next, days: d }); }
    for (const m of p.meds) if ((!m.from || m.from <= today) && (!m.until || m.until >= today)) out.push({ pet: p, kind: "medikament", id: m.id, text: `${m.name}${m.dose ? " · " + m.dose : ""}${m.times.length ? " um " + m.times.join(", ") : ""}`, date: today, days: 0 });
    for (const v of p.vet) { const d = diffDays(today, v.date); if (d >= 0 && d <= 3) out.push({ pet: p, kind: "tierarzt", id: v.id, text: `Tierarzt${v.reason ? ": " + v.reason : ""}`, date: v.date, days: d }); }
  }
  return out.sort((a, b) => a.days - b.days);
}
export function petCosts(p, year) {
  const x = normPet(p);
  const inY = (d) => !year || d.startsWith(String(year));
  const vet = x.vet.filter((v) => inY(v.date)).reduce((n, v) => n + v.cost, 0), other = x.costs.filter((c) => inY(c.date)).reduce((n, c) => n + c.amount, 0);
  return { vet: r2(vet), other: r2(other), total: r2(vet + other) };
}

/* ================================================================== 👕 Kleiderschrank */
export const CLOTH_CATS = [["oberteil", "👕", "Oberteile"], ["pulli", "🧥", "Pullis & Hoodies"], ["jacke", "🧥", "Jacken"], ["hose", "👖", "Hosen"], ["kurz", "🩳", "Kurze Hosen"], ["schuhe", "👟", "Schuhe"], ["arbeit", "🦺", "Arbeitskleidung"], ["accessoire", "🧢", "Accessoires"], ["sport", "🏃", "Sport"]];
export const SEASONS = [["fruehling", "🌸", "Frühling"], ["sommer", "☀️", "Sommer"], ["herbst", "🍂", "Herbst"], ["winter", "❄️", "Winter"]];
export const CARE = ["", "30 °C", "40 °C", "60 °C", "Handwäsche", "Chemische Reinigung", "Nicht in den Trockner"];
export function normCloth(x = {}) {
  const w = Math.round(num(x.warmth));
  return { id: s(x.id), name: s(x.name).slice(0, 60), cat: (CLOTH_CATS.find((c) => c[0] === x.cat) || CLOTH_CATS[0])[0], color: s(x.color).slice(0, 30),
    seasons: arr(x.seasons).filter((v) => SEASONS.some((y) => y[0] === v)), warmth: w >= 1 && w <= 3 ? w : 2, care: CARE.includes(x.care) ? x.care : "", fav: !!x.fav,
    worn: [...new Set(arr(x.worn).filter(isKey))].sort().slice(-200), note: s(x.note).slice(0, 300),
    photo: /^data:image\/(jpeg|png|webp);base64,/.test(s(x.photo)) && s(x.photo).length < 200000 ? s(x.photo) : "" };
}
export function normOutfit(x = {}) {
  return { id: s(x.id), name: s(x.name).slice(0, 60), items: [...new Set(arr(x.items).map(s).filter(Boolean))].slice(0, 12), fav: !!x.fav,
    worn: [...new Set(arr(x.worn).filter(isKey))].sort().slice(-200), plan: [...new Set(arr(x.plan).filter(isKey))].sort().slice(-60) };
}
export function seasonOf(today) { const m = Number(today.slice(5, 7)); return m >= 3 && m <= 5 ? "fruehling" : m >= 6 && m <= 8 ? "sommer" : m >= 9 && m <= 11 ? "herbst" : "winter"; }
/** Wärme-Stufe passend zur Temperatur (°C): 1 = leicht (≥ 20), 2 = mittel, 3 = warm (≤ 8). */
export const warmthFor = (t) => (t == null ? null : t >= 20 ? 1 : t <= 8 ? 3 : 2);
/** Outfit-Vorschlag: Outfits zuerst, deren Teile zur Temperatur/Saison passen; lange nicht getragen bevorzugt; Regen → Jacke. */
export function suggestOutfits(outfits, clothes, { temp = null, rain = false, today }) {
  const byId = new Map(clothes.map(normCloth).filter((c) => c.id).map((c) => [c.id, c]));
  const want = warmthFor(temp), sea = seasonOf(today);
  return outfits.map(normOutfit).filter((o) => o.id && o.items.length).map((o) => {
    const items = o.items.map((i) => byId.get(i)).filter(Boolean);
    if (!items.length) return null;
    let score = 0;
    const avgW = items.reduce((n, c) => n + c.warmth, 0) / items.length;
    if (want != null) score += 3 - Math.abs(avgW - want) * 2;
    if (items.every((c) => !c.seasons.length || c.seasons.includes(sea))) score += 2;
    if (rain && items.some((c) => c.cat === "jacke")) score += 2;
    if (o.fav) score += 1;
    const last = o.worn[o.worn.length - 1];
    score += last ? Math.min(3, diffDays(last, today) / 7) : 3;
    return { outfit: o, items, score: Math.round(score * 10) / 10 };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}
/** Packvorschlag für eine Reise: Tage → Anzahl je Kategorie (aus dem eigenen Schrank, passend zur Saison). */
export function packFor(clothes, days, season) {
  const n = Math.max(1, Math.min(30, Math.round(days)));
  const want = { oberteil: n, hose: Math.ceil(n / 3), pulli: Math.ceil(n / 4), jacke: 1, schuhe: n > 4 ? 2 : 1, kurz: season === "sommer" ? Math.ceil(n / 3) : 0, sport: 0 };
  const out = [];
  for (const [cat, cnt] of Object.entries(want)) {
    if (!cnt) continue;
    const pool = clothes.map(normCloth).filter((c) => c.id && c.cat === cat && (!c.seasons.length || c.seasons.includes(season))).sort((a, b) => Number(b.fav) - Number(a.fav));
    out.push({ cat, want: cnt, items: pool.slice(0, cnt) });
  }
  return out;
}
export function wardrobeStats(clothes, today) {
  const cs = clothes.map(normCloth).filter((c) => c.id);
  const never = cs.filter((c) => !c.worn.length || diffDays(c.worn[c.worn.length - 1], today) > 365);
  const top = [...cs].sort((a, b) => b.worn.length - a.worn.length).slice(0, 3);
  return { total: cs.length, bySeason: Object.fromEntries(SEASONS.map(([k]) => [k, cs.filter((c) => !c.seasons.length || c.seasons.includes(k)).length])), unused: never, top };
}

/* ================================================================== 👥 Freunde & Gruppen */
export const ME = "me";
export function normGroup(x = {}) {
  const people = arr(x.people).filter((p) => p && s(p.name) && p.id !== ME).map((p) => ({ id: s(p.id) || nid(), name: s(p.name).slice(0, 40) })).slice(0, 30);
  const ids = new Set([ME, ...people.map((p) => p.id)]);
  return {
    id: s(x.id), name: s(x.name).slice(0, 60), emoji: s(x.emoji).slice(0, 4) || "👥", people,
    events: arr(x.events).filter((e) => e && s(e.title) && isKey(e.date)).map((e) => ({ id: s(e.id) || nid(), title: s(e.title).slice(0, 80), date: e.date, time: /^\d{2}:\d{2}$/.test(s(e.time)) ? e.time : "", place: s(e.place).slice(0, 80), note: s(e.note).slice(0, 300) })).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(-100),
    tasks: arr(x.tasks).filter((t) => t && s(t.text)).map((t) => ({ id: s(t.id) || nid(), text: s(t.text).slice(0, 100), who: ids.has(t.who) ? t.who : "", done: !!t.done })).slice(0, 100),
    expenses: arr(x.expenses).filter((e) => e && num(e.amount) > 0 && ids.has(e.paidBy)).map((e) => ({ id: s(e.id) || nid(), what: s(e.what).slice(0, 80), amount: r2(num(e.amount)), paidBy: e.paidBy,
      forIds: arr(e.forIds).filter((i) => ids.has(i)), date: isKey(e.date) ? e.date : "", ...(e.kind === "pay" && ids.has(e.to) ? { kind: "pay", to: e.to } : {}) })).slice(-300),
    challenge: x.challenge && s(x.challenge.title) ? { title: s(x.challenge.title).slice(0, 80), goal: Math.max(1, Math.round(num(x.challenge.goal)) || 10), unit: s(x.challenge.unit).slice(0, 20),
      progress: Object.fromEntries(Object.entries((x.challenge && x.challenge.progress) || {}).filter(([k]) => ids.has(k)).map(([k, v]) => [k, Math.max(0, num(v))])) } : null,
  };
}
export const personName = (g, id) => (id === ME ? "Du" : ((g.people.find((p) => p.id === id) || {}).name || "?"));
export function upcomingEvents(groups, today, days = 30) {
  const end = addDays(today, days);
  return groups.map(normGroup).flatMap((g) => g.events.filter((e) => e.date >= today && e.date <= end).map((e) => ({ ...e, group: g }))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
export function challengeRanking(g) {
  if (!g.challenge) return [];
  return [{ id: ME, name: "Du" }, ...g.people].map((p) => ({ ...p, n: g.challenge.progress[p.id] || 0, pct: Math.min(100, Math.round(((g.challenge.progress[p.id] || 0) / g.challenge.goal) * 100)) })).sort((a, b) => b.n - a.n);
}

/* ================================================================== 🏠 Wohnen */
/** Umzugs-Checkliste (Österreich): Tage relativ zum Umzugstag. */
export const MOVE_STEPS = [
  [-90, "🏠", "Mietvertrag der alten Wohnung kündigen (Kündigungsfrist prüfen)"],
  [-60, "🚚", "Umzugshelfer oder Firma organisieren, Transporter reservieren"],
  [-45, "📦", "Ausmisten: verkaufen, verschenken, entsorgen"],
  [-30, "🔌", "Strom, Gas und Internet für die neue Wohnung anmelden / ummelden"],
  [-30, "🗓️", "Urlaubstag für den Umzug beim Betrieb beantragen (oft 1 Tag Sonderurlaub laut KV)"],
  [-21, "📮", "Nachsendeauftrag bei der Post einrichten"],
  [-14, "📦", "Kartons, Klebeband, Decken besorgen und packen beginnen"],
  [-7, "🧾", "Zählerstände der alten Wohnung notieren lassen"],
  [-2, "🧽", "Kühlschrank abtauen, Werkzeug & Erste-Hilfe-Box griffbereit"],
  [0, "🔑", "Übergabe: Zählerstände + Fotos, Schlüssel übergeben, Protokoll unterschreiben"],
  [3, "🏛️", "Meldezettel: innerhalb von 3 Tagen am neuen Gemeindeamt anmelden"],
  [7, "🚗", "Zulassungsschein (Adresse) aktualisieren lassen"],
  [14, "🏦", "Adresse ändern: Bank, Versicherungen, Arbeitgeber, Schule, Abos, Online-Shops"],
  [30, "🔁", "Kaution der alten Wohnung zurückfordern"],
];
export function moveSteps(doc, today) {
  const d = doc && isKey(doc.date) ? doc.date : "";
  const done = (doc && doc.done) || {};
  const own = arr(doc && doc.own).filter((o) => o && s(o.text)).map((o) => [Math.round(num(o.days)), "📝", s(o.text).slice(0, 120), s(o.id)]);
  return [...MOVE_STEPS.map((x, i) => [...x, "s" + i]), ...own].map(([days, e, text, id]) => {
    const date = d ? addDays(d, days) : "";
    return { id: id || "s", days, e, text, date, done: !!done[id], late: !!date && !done[id] && date < today };
  }).sort((a, b) => a.days - b.days);
}
export const COST_PRESETS = [["Miete", "🏠"], ["Betriebskosten", "🏢"], ["Strom", "⚡"], ["Gas / Heizung", "🔥"], ["Wasser", "💧"], ["Internet", "🌐"], ["Handy", "📱"], ["Haushaltsversicherung", "🛡️"], ["GIS / ORF-Beitrag", "📺"], ["Müllgebühr", "🗑️"]];
export function normCost(x = {}) {
  const ev = [1, 2, 3, 6, 12].includes(Number(x.every)) ? Number(x.every) : 1;
  return { id: s(x.id), kind: "kosten", name: s(x.name).slice(0, 60), amount: r2(Math.max(0, num(x.amount))), every: ev, unit: s(x.unit).slice(0, 10),
    meter: arr(x.meter).filter((m) => m && isKey(m.date) && Number.isFinite(num(m.value))).map((m) => ({ date: m.date, value: num(m.value) })).sort((a, b) => a.date.localeCompare(b.date)).slice(-120) };
}
export const monthly = (c) => r2(c.amount / c.every);
export function costSummary(costs) { const cs = costs.map(normCost).filter((c) => c.id && c.name); const m = r2(cs.reduce((n, c) => n + monthly(c), 0)); return { monthly: m, yearly: r2(m * 12), items: cs }; }
/** Verbrauch aus Zählerständen: je Ablesung Differenz und Tagesverbrauch. */
export function usage(meter) {
  const out = [];
  for (let i = 1; i < meter.length; i++) {
    const days = diffDays(meter[i - 1].date, meter[i].date);
    const diff = r2(meter[i].value - meter[i - 1].value);
    out.push({ from: meter[i - 1].date, to: meter[i].date, diff, perDay: days > 0 ? Math.round((diff / days) * 100) / 100 : null });
  }
  return out;
}
export function normLend(x = {}) {
  return { id: s(x.id), kind: "verleih", what: s(x.what).slice(0, 80), who: s(x.who).slice(0, 60), dir: x.dir === "von" ? "von" : "an",
    since: isKey(x.since) ? x.since : "", due: isKey(x.due) ? x.due : "", back: isKey(x.back) ? x.back : "", note: s(x.note).slice(0, 200) };
}
export function lendDue(lends, today) { return lends.map(normLend).filter((l) => l.id && !l.back && l.due && diffDays(today, l.due) <= 2); }
export function normPlace(x = {}) { return { id: s(x.id), kind: "ort", what: s(x.what).slice(0, 80), where: s(x.where).slice(0, 100), room: s(x.room).slice(0, 40), note: s(x.note).slice(0, 200), updated: Number(x.updated) || 0 }; }
export function normRoom(x = {}) { return { id: s(x.id), kind: "raum", name: s(x.name).slice(0, 40), m2: r2(Math.max(0, num(x.m2))), note: s(x.note).slice(0, 300) }; }
const fold = (t) => s(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export function findPlace(places, q) { const n = fold(q); return places.map(normPlace).filter((p) => p.id && (!n || fold([p.what, p.where, p.room, p.note].join(" ")).includes(n))).sort((a, b) => a.what.localeCompare(b.what, "de")); }
