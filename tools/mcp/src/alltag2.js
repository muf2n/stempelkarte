// Update 14 – „alltag_lesen“ (nur lesen): EIN Werkzeug für die neuen Alltag-Bereiche, damit die Werkzeugliste klein bleibt.
// bereich: kochen | vorrat | muell | wohnen | verleih | tiere | karriere | gruppen | kleider
// Logik kommt aus den App-Kernen (Wrangler bündelt sie mit). Ausgegeben werden nur Titel/Namen/Daten/Mengen –
// lange Freitexte (Notizen, Schritte, Beschreibungen) bewusst NICHT (könnten eingefügter fremder Text sein).
import * as R from "../../../js/alltag/rezepte-core.js";
import * as H from "../../../js/alltag/hausextra-core.js";
import * as X from "../../../js/alltag/extras-core.js";
import * as K from "../../../js/alltag/karriere-core.js";
import { balances, settle } from "../../../js/alltag/money-core.js";
import * as PR from "../../../js/alltag/pruef-core.js";
import { fmtKey, dayKey } from "./time.js";
import { RO, s, short } from "./util.js";

const u = (t, n = 60) => short(t, n);
const BEREICHE = ["kochen", "vorrat", "muell", "wohnen", "verleih", "tiere", "karriere", "gruppen", "kleider", "pruefung"];
const ALIAS = { rezepte: "kochen", essen: "kochen", essensplan: "kochen", kochplan: "kochen", vorraete: "vorrat", "vorräte": "vorrat", lebensmittel: "vorrat", muellabfuhr: "muell", "müll": "muell", abfall: "muell",
  "wo liegt was": "wohnen", orte: "wohnen", nebenkosten: "wohnen", umzug: "wohnen", geliehen: "verleih", verliehen: "verleih", haustier: "tiere", haustiere: "tiere", tier: "tiere",
  lebenslauf: "karriere", bewerbungen: "karriere", zertifikate: "karriere", ausbildung: "karriere", freunde: "gruppen", gruppe: "gruppen", kleidung: "kleider", kleiderschrank: "kleider", outfits: "kleider", pruefprotokoll: "pruefung", "prüfprotokoll": "pruefung", "prüfung": "pruefung", messung: "pruefung", messwerte: "pruefung" };
const pick = (v) => { const n = s(v).toLowerCase().trim(); return BEREICHE.includes(n) ? n : ALIAS[n] || null; };
const norm = (t) => s(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const hit = (q, ...xs) => !q || xs.some((x) => norm(x).includes(q));
const eur = (v) => `${(Number(v) || 0).toFixed(2).replace(".", ",")} €`;
const qty = (n) => String(n).replace(".", ",");

async function kochen(d, today, q) {
  const [recs, plan, stock] = await Promise.all([d.alltag("rezepte"), d.alltag("essensplan"), d.alltag("vorrat")].map((p) => p.catch(() => [])));
  const rs = R.filterRecipes(recs, { q });
  const byId = new Map(recs.map(R.normRecipe).filter((r) => r.id).map((r) => [r.id, r]));
  const out = [];
  const week = Array.from({ length: 7 }, (_, i) => R.addDays(today, i));
  const lines = [];
  for (const k of week) {
    const doc = R.normDay(plan.find((p) => p && p.id === k) || { id: k });
    const ms = R.MEALS.filter(([m]) => doc.meals[m]).map(([m, , l]) => { const v = doc.meals[m], r = v.recipeId && byId.get(v.recipeId); return `${l}: ${u(r ? r.title : v.text)}`; });
    if (ms.length) lines.push(`- ${R.fmtShort(k)}: ${ms.join(" · ")}`);
  }
  out.push(lines.length ? `📅 Essensplan (nächste 7 Tage):\n${lines.join("\n")}` : "📅 Im Essensplan steht für die nächsten 7 Tage nichts.");
  if (rs.length) out.push(`📖 Rezepte${q ? ` zu „${u(q, 30)}“` : ""} (${rs.length}):\n` + rs.slice(0, 25).map((r) => `- ${r.emoji} ${u(r.title)}${r.fav ? " ⭐" : ""} (${[r.minutes && r.minutes + " min", `${r.servings} Port.`, r.diet, r.allergens.length && "Allergene " + r.allergens.join(",")].filter(Boolean).join(" · ")}) – Zutaten: ${r.ingredients.slice(0, 12).map((i) => u(R.ingText(i, r.servings, r.servings), 40)).join(", ")}`).join("\n"));
  else out.push(recs.length ? "Kein passendes Rezept gefunden." : "Das Rezeptbuch ist noch leer.");
  const sg = R.suggestFromStock(recs, stock, { min: 0.5, limit: 5 });
  if (sg.length) out.push("🥫 Mit dem Vorrat machbar: " + sg.map((x) => `${u(x.recipe.title)} (${Math.round(x.score * 100)} %${x.missing.length ? ", fehlt " + x.missing.slice(0, 3).map((m) => u(m, 25)).join(", ") : ""})`).join("; "));
  return out.join("\n\n");
}
async function vorrat(d, today, q) {
  const st = H.sortStock((await d.alltag("vorrat").catch(() => [])).filter((x) => hit(q, x && x.name)), today).filter((x) => x.id && x.name);
  if (!st.length) return q ? `Im Vorrat gibt es nichts zu „${u(q, 30)}“.` : "Der Vorrat ist leer – Einträge legst du in der App unter Haushalt › 🥫 Vorrat an.";
  const F = { leer: "leer", knapp: "knapp", abgelaufen: "ABGELAUFEN", bald: "MHD bald" };
  return `🥫 Vorrat (${st.length}):\n` + st.slice(0, 60).map((x) => { const f = H.stockState(x, today); return `- ${u(x.name)}: ${H.fmtQty(x)} (${H.placeBy(x.place)[2]})${x.best ? " · MHD " + fmtKey(x.best) : ""}${f.length ? " · " + f.map((k) => F[k]).join(", ") : ""}`; }).join("\n");
}
async function muell(d, today) {
  const bins = (await d.alltag("muell").catch(() => [])).map(H.normBin).filter((b) => b.id);
  if (!bins.length) return "Im Müllkalender ist noch keine Tonne eingetragen.";
  const up = H.upcoming(bins, today, 21);
  return `🗑️ Müllabfuhr (nächste 3 Wochen):\n` + (up.map((g) => `- ${H.fmtShort(g.day)} ${fmtKey(g.day)}: ${g.bins.map((b) => b.name).join(", ")}`).join("\n") || "- keine Termine");
}
async function wohnen(d, today, q) {
  const all = await d.alltag("wohnen").catch(() => []);
  const out = [];
  const places = X.findPlace(all.filter((x) => x && x.kind === "ort"), q);
  if (places.length) out.push(`📍 Wo liegt was${q ? ` („${u(q, 30)}“)` : ""}:\n` + places.slice(0, 40).map((p) => `- ${u(p.what)}: ${u(p.where, 80)}${p.room ? " (" + u(p.room, 30) + ")" : ""}`).join("\n"));
  else if (q) out.push(`Zu „${u(q, 30)}“ ist kein Ort eingetragen.`);
  if (!q) {
    const c = X.costSummary(all.filter((x) => x && x.kind === "kosten"));
    if (c.items.length) out.push(`💶 Nebenkosten: ${eur(c.monthly)} pro Monat (${eur(c.yearly)}/Jahr) – ` + c.items.map((x) => `${u(x.name, 30)} ${eur(X.monthly(x))}`).join(", "));
    const mv = all.find((x) => x && x.id === "umzug");
    if (mv && mv.date) { const st = X.moveSteps(mv, today), open = st.filter((x) => !x.done); out.push(`📦 Umzug am ${fmtKey(mv.date)}: ${st.length - open.length}/${st.length} erledigt. Als Nächstes: ${open.slice(0, 3).map((x) => `${u(x.text, 70)} (${fmtKey(x.date)})`).join("; ")}`); }
    out.push(await verleih(d, today, "", all));
  }
  return out.filter(Boolean).join("\n\n") || "Unter Wohnen ist noch nichts eingetragen.";
}
async function verleih(d, today, q, pre) {
  const ls = (pre || await d.alltag("wohnen").catch(() => [])).filter((x) => x && x.kind === "verleih").map(X.normLend).filter((l) => l.id && !l.back && hit(q, l.what, l.who));
  if (!ls.length) return "🔁 Nichts verliehen oder geliehen.";
  return "🔁 Verleih:\n" + ls.map((l) => `- ${u(l.what)} ${l.dir === "an" ? "verliehen an" : "geliehen von"} ${u(l.who, 40)}${l.since ? " seit " + fmtKey(l.since) : ""}${l.due ? ` · zurück bis ${fmtKey(l.due)}${l.due < today ? " (ÜBERFÄLLIG)" : ""}` : ""}`).join("\n");
}
async function tiere(d, today) {
  const ps = (await d.alltag("tiere").catch(() => [])).map(X.normPet).filter((p) => p.id && p.name);
  if (!ps.length) return "Es ist noch kein Haustier eingetragen.";
  const due = X.petDue(ps, today);
  return ps.map((p) => {
    const c = X.petCosts(p, Number(today.slice(0, 4)));
    const w = p.weight[p.weight.length - 1];
    return [`${p.emoji} ${u(p.name, 30)} (${X.PET_KINDS.find((k) => k[0] === p.art)[2]}${p.birthday ? ", " + X.ageText(p.birthday, today) : ""})`,
      p.food.what || p.food.times.length ? `  Futter: ${u(p.food.what || "–")}${p.food.amount ? " · " + u(p.food.amount, 30) : ""}${p.food.times.length ? " um " + p.food.times.join(", ") : ""}` : "",
      `  Pflege: ${p.care.map((x) => `${u(x.title, 40)} (nächstes Mal ${fmtKey(X.careNext(x, today))})`).join(", ") || "–"}`,
      p.vacc.length ? `  Impfungen: ${p.vacc.map((v) => `${u(v.name, 30)}${v.next ? " nächste " + fmtKey(v.next) : ""}`).join(", ")}` : "",
      p.meds.length ? `  Medikamente: ${p.meds.map((m) => `${u(m.name, 30)}${m.dose ? " " + u(m.dose, 20) : ""}${m.until ? " bis " + fmtKey(m.until) : ""}`).join(", ")}` : "",
      w ? `  Gewicht: ${qty(w.kg)} kg (${fmtKey(w.date)})` : "", `  Kosten dieses Jahr: ${eur(c.total)}`].filter(Boolean).join("\n");
  }).join("\n") + (due.length ? `\n\n📌 Jetzt dran: ${due.map((x) => `${x.pet.name}: ${u(x.text, 60)}${x.days < 0 ? " (überfällig)" : x.days ? ` (in ${x.days} Tagen)` : " (heute)"}`).join("; ")}` : "");
}
async function karriere(d, today, settings) {
  const [cv, certs, jobs] = await Promise.all([d.alltag("karriere"), d.alltag("karriere_certs"), d.alltag("karriere_jobs")].map((p) => p.catch(() => [])));
  const c = K.normCv(cv.find((x) => x && x.id === "cv") || {});
  const ap = settings && settings.apprentice;
  const p = ap && ap.start ? K.apprenticeProgress({ start: ap.start, years: Number(ap.years) || 3.5 }, today) : null;
  const out = [];
  if (p) out.push(`🎓 Lehre: ${p.year}. Lehrjahr, ${p.pct} % geschafft, Ende voraussichtlich ${fmtKey(p.end)} (noch ${p.daysLeft} Tage).`);
  if (c.goals.length) out.push("🎯 Ziele: " + c.goals.map((g) => `${g.done ? "✅" : "☐"} ${u(g.text, 80)}${g.due ? " (bis " + g.due.slice(5) + "/" + g.due.slice(0, 4) + ")" : ""}`).join("; "));
  if (c.skills.length) out.push("🧠 Kenntnisse: " + c.skills.map((k) => `${u(k.name, 40)} ${k.level}/5`).join(", "));
  const cs = certs.map(K.normCert).filter((x) => x.id && x.title);
  if (cs.length) out.push("🏅 Nachweise: " + cs.map((x) => `${u(x.title)}${x.date ? " (" + fmtKey(x.date) + ")" : ""}${x.expires ? ` gültig bis ${fmtKey(x.expires)}${K.certState(x, today) === "ab" ? " ABGELAUFEN" : K.certState(x, today) === "bald" ? " läuft bald ab" : ""}` : ""}`).join("; "));
  const js = jobs.map(K.normJob).filter((j) => j.id && j.company);
  if (js.length) out.push("📨 Bewerbungen: " + js.map((j) => `${u(j.company, 40)}${j.position ? " – " + u(j.position, 40) : ""}: ${K.jobStatus(j.status)[2]}${j.next ? `, nächster Schritt ${fmtKey(j.next)}${j.nextWhat ? " (" + u(j.nextWhat, 40) + ")" : ""}` : ""}`).join("; "));
  return out.join("\n") || "Unter Karriere ist noch nichts eingetragen.";
}
async function gruppen(d, today) {
  const gs = (await d.alltag("gruppen").catch(() => [])).map(X.normGroup).filter((g) => g.id && g.name);
  if (!gs.length) return "Es gibt noch keine Gruppen.";
  return gs.map((g) => {
    const grp = { people: [{ id: "me" }, ...g.people], expenses: g.expenses };
    const plan = settle(grp), ev = g.events.filter((e) => e.date >= today).slice(0, 5), open = g.tasks.filter((t) => !t.done);
    return [`${g.emoji} ${u(g.name, 40)} – Mitglieder: Du${g.people.length ? ", " + g.people.map((p) => u(p.name, 30)).join(", ") : ""}`,
      ev.length ? `  Termine: ${ev.map((e) => `${fmtKey(e.date)}${e.time ? " " + e.time : ""} ${u(e.title, 50)}${e.place ? " @ " + u(e.place, 40) : ""}`).join("; ")}` : "",
      open.length ? `  Offene Aufgaben: ${open.map((t) => `${u(t.text, 50)}${t.who ? " (" + X.personName(g, t.who) + ")" : ""}`).join("; ")}` : "",
      g.expenses.length ? `  Kosten: dein Saldo ${eur(balances(grp).get("me") || 0)}${plan.length ? " · Ausgleich: " + plan.map((t) => `${X.personName(g, t.from)} → ${X.personName(g, t.to)} ${eur(t.amount)}`).join(", ") : " · alles ausgeglichen"}` : "",
      g.challenge ? `  Challenge „${u(g.challenge.title, 50)}“: ${X.challengeRanking(g).map((p) => `${p.name} ${qty(p.n)}/${g.challenge.goal}`).join(", ")}` : ""].filter(Boolean).join("\n");
  }).join("\n");
}
async function kleider(d, today) {
  const [cl, of] = await Promise.all([d.alltag("kleidung"), d.alltag("outfits")].map((p) => p.catch(() => [])));
  const cs = cl.map(X.normCloth).filter((c) => c.id && c.name);
  if (!cs.length) return "Der Kleiderschrank ist noch leer.";
  const st = X.wardrobeStats(cs, today), byId = new Map(cs.map((c) => [c.id, c]));
  const os = of.map(X.normOutfit).filter((o) => o.id);
  return [`👕 ${cs.length} Teile: ` + X.CLOTH_CATS.map(([k, , l]) => { const n = cs.filter((c) => c.cat === k).length; return n ? `${l} ${n}` : ""; }).filter(Boolean).join(", "),
    os.length ? "✨ Outfits: " + os.map((o) => `${u(o.name || "Outfit", 30)} (${o.items.map((i) => (byId.get(i) || {}).name).filter(Boolean).map((n) => u(n, 25)).join(" + ")})${o.worn.length ? " zuletzt " + fmtKey(o.worn[o.worn.length - 1]) : ""}`).join("; ") : "",
    st.unused.length ? `🧺 Lange nicht getragen: ${st.unused.slice(0, 10).map((c) => u(c.name, 30)).join(", ")}` : ""].filter(Boolean).join("\n");
}

async function pruefung(d, q) {
  const ps = (await d.alltag("pruefungen").catch(() => [])).map(PR.normProt).filter((p) => p.id && hit(q, p.kunde, p.adresse)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (!ps.length) return "Es gibt noch kein Prüfprotokoll.";
  const TXT = { ok: "in Ordnung", knapp: "in Ordnung (knapp)", fehler: "MANGEL", offen: "offen" };
  return "⚡ Prüfprotokolle:\n" + ps.slice(0, 10).map((p) => {
    const r = PR.evalProt(p);
    const bad = r.circuits.filter((x) => x.r.state === "fehler" || x.r.state === "knapp").slice(0, 8)
      .map(({ c, r: cr }) => `    ${PR.STATE_E[cr.state]} ${u([c.nr, c.name].filter(Boolean).join(" "), 40)}: ${cr.checks.filter((x) => x.state === "fehler" || x.state === "knapp").map((x) => `${x.label} ${x.value} (${x.limit})`).join(", ")}`);
    return [`- ${u(p.kunde || p.adresse || "Protokoll", 50)}${p.date ? " · " + fmtKey(p.date) : ""} · ${p.netz} · ${p.circuits.length} Stromkreise · ${p.status === "fertig" ? "abgeschlossen" : "Entwurf"} · Ergebnis: ${TXT[r.state]}${r.open ? ` (${r.open} Stromkreise ohne vollständige Messwerte)` : ""} · Besichtigung ${r.visOk}/${r.visAll}`, ...bad].join("\n");
  }).join("\n");
}

const TOOL = {
  name: "alltag_lesen",
  title: "Alltag-Bereiche lesen",
  description: "Liest die Alltag-Bereiche der App (nur lesen): kochen (Rezepte, Essensplan, was mit dem Vorrat machbar ist), vorrat (Lebensmittel/Drogerie mit Menge & MHD), muell (Abfuhrtermine), wohnen (Wo liegt was?, Nebenkosten, Umzug, Verleih), verleih (was ist verliehen/geliehen), tiere (Haustiere: Futter, Pflege, Impfung, Medikamente, Kosten), karriere (Lehre-Fortschritt, Ziele, Zertifikate, Bewerbungen), gruppen (Freunde/Gruppen: Termine, Aufgaben, Kosten-Ausgleich, Challenge), kleider (Kleiderschrank & Outfits), pruefung (Prüfprotokolle nach ÖVE/ÖNORM E 8101: Ergebnis, Mängel, Messwerte außerhalb der Grenzwerte). Mit suche filtern, z. B. bereich wohnen + suche „Reisepass“.",
  inputSchema: { type: "object", properties: {
    bereich: { type: "string", description: "kochen, vorrat, muell, wohnen, verleih, tiere, karriere, gruppen, kleider oder pruefung" },
    suche: { type: "string", description: "Optional: Suchbegriff (Rezept/Zutat, Gegenstand, Vorrats-Artikel …)" },
  }, required: ["bereich"], additionalProperties: false },
  annotations: RO,
  async run(args, d) {
    const b = pick(args.bereich);
    if (!b) return `Den Bereich „${u(args.bereich, 30)}“ kenne ich nicht. Möglich: ${BEREICHE.join(", ")}.`;
    const today = dayKey(d.now), q = norm(args.suche).slice(0, 60);
    switch (b) {
      case "kochen": return kochen(d, today, q);
      case "vorrat": return vorrat(d, today, q);
      case "muell": return muell(d, today);
      case "wohnen": return wohnen(d, today, q);
      case "verleih": return verleih(d, today, q);
      case "tiere": return tiere(d, today);
      case "karriere": { const st = await d.settings().catch(() => ({})); return karriere(d, today, st); }
      case "gruppen": return gruppen(d, today);
      case "pruefung": return pruefung(d, q);
      default: return kleider(d, today);
    }
  },
};
export const ALLTAG2_TOOLS = [TOOL];
