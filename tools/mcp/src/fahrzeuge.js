// Update 10 – 🚗 Fahrzeuge (Alltag) für den Assistenten: „fahrzeuge_lesen“ (nur lesen).
// Fahrzeuge aus settings.vehicles (Fahrtenbuch), Zusatzangaben aus a_fahrzeug_info (Dokument-ID = Fahrzeug-ID),
// Tankungen aus a_travel_fuel. Logik aus der gemeinsamen reinen Datei js/alltag/fahrzeug-core.js.
// Freitext (Notizen, km-Notizen) wird als untrusted_content abgegrenzt. Nur unkritische Versicherungsfelder.
import * as F from "../../../js/alltag/fahrzeug-core.js";
import * as TR from "./trip.js";
import { dayKey, fmtKey } from "./time.js";
import { RO, s, short, untrusted, pick } from "./util.js";

export * from "../../../js/alltag/fahrzeug-core.js";

const n1 = (v) => String(Math.round(v * 10) / 10).replace(".", ",");
const eur = (v) => `${(Math.round(v * 100) / 100).toFixed(2).replace(".", ",")} €`;
const PK = { ok: "ok", bald: "bald", jetzt: "jetzt fällig", toleranz: "in der Toleranzfrist", abgelaufen: "abgelaufen" };

async function load(d) {
  const [settings, infos, fuel] = await Promise.all([d.settings(), d.alltag("fahrzeug_info").catch(() => []), d.alltag("travel_fuel").catch(() => [])]);
  const vs = TR.readVehicles(settings);
  const dv = TR.defaultVehicle(settings);
  return { vs, defId: dv ? dv.id : null, infos: new Map(infos.filter((x) => x && x.id).map((x) => [x.id, x])), fuel };
}

function facts(v, x, today) {
  const inf = F.normInfo(x.infos.get(v.id), v.id);
  const fills = F.vehicleFills(x.fuel, v.id, x.defId);
  const reads = F.odoReadings(inf, fills, v);
  const km = F.currentKm(reads);
  return { inf, fills, reads, km, cons: F.consumption(fills), pk: F.pickerlStatus(inf, today), sv: F.serviceStatus(inf, km, today), ins: F.insuranceStatus(inf, today) };
}

const label = (v) => (v.plate ? `${v.name} (${v.plate})` : v.name);

function summary(v, f, x) {
  const bits = [TR.VEHICLE_TYPES[v.type]];
  if (v.id === x.defId) bits.push("Standard");
  if (f.inf.make) bits.push(short(f.inf.make, 60));
  if (f.km) bits.push(`${F.fmtKm(f.km)}`);
  if (f.pk.state !== "none") bits.push(`Pickerl ${F.monthLabel(f.pk.month)} (${PK[f.pk.state]})`);
  if (f.sv.state !== "none") bits.push(`Service ${f.sv.state === "ueber" ? "überfällig" : f.sv.state === "bald" ? "bald" : "ok"}`);
  if (f.cons.l100 != null) bits.push(`Ø ${n1(f.cons.l100)} l/100 km`);
  return `- ${label(v)} · ${bits.join(" · ")} [id: ${v.id}]`;
}

function detail(v, f, x) {
  const out = [`🚗 ${label(v)} – ${TR.VEHICLE_TYPES[v.type]}${v.id === x.defId ? " (Standard-Fahrzeug)" : ""} [id: ${v.id}]`];
  if (f.inf.make) out.push(`Marke/Modell: ${short(f.inf.make, 80)}`);
  out.push(`Kilometerstand: ${f.km ? F.fmtKm(f.km) : "unbekannt"}${F.kmPerYear(f.reads) ? ` (≈ ${F.fmtKm(F.kmPerYear(f.reads))} pro Jahr)` : ""}`);
  out.push(f.pk.state === "none" ? "Pickerl (§57a): kein Monat eingetragen" : `Pickerl (§57a): ${F.monthLabel(f.pk.month)} → ${PK[f.pk.state]} (${f.pk.label}). Hinweis: ${F.PICKERL_HINT}`);
  const sv = f.inf.service;
  if (f.sv.state !== "none" || sv.lastDate || sv.lastKm) {
    out.push(`Service: zuletzt ${[sv.lastDate ? fmtKey(sv.lastDate) : "", sv.lastKm ? F.fmtKm(sv.lastKm) : ""].filter(Boolean).join(" bei ") || "?"}` +
      `${sv.everyMonths || sv.everyKm ? `, alle ${[sv.everyMonths ? sv.everyMonths + " Monate" : "", sv.everyKm ? F.fmtKm(sv.everyKm) : ""].filter(Boolean).join(" / ")}` : ""}` +
      `${f.sv.label ? ` → ${f.sv.state === "ueber" ? "überfällig" : f.sv.state === "bald" ? "bald fällig" : "ok"} (${f.sv.label})` : ""}`);
  } else out.push("Service: nichts eingetragen");
  const ins = f.inf.insurance;
  if (ins.company || ins.policy || ins.until) out.push(`Versicherung: ${[ins.company && short(ins.company, 60), ins.policy && `Polizze ${short(ins.policy, 40)}`, ins.until && `bis ${fmtKey(ins.until)}${f.ins.state !== "ok" ? ` (${f.ins.label})` : ""}`].filter(Boolean).join(" · ")}`);
  out.push(`Tankbuch: ${f.fills.length} Tankung${f.fills.length === 1 ? "" : "en"}` +
    (f.cons.l100 != null ? ` · Ø ${n1(f.cons.l100)} l/100 km · ${eur(f.cons.eur100)} pro 100 km (über ${F.fmtKm(f.cons.km)} aus Volltankungen)` : " · Verbrauch ab 2 Volltankungen"));
  const last = f.fills.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  for (const t of last) out.push(`  - ${fmtKey(t.date)}: ${n1(Number(t.liters) || 0)} l · ${eur(Number(t.total) || 0)} · ${F.fmtKm(t.km)}${t.full ? " · voll" : ""}`);
  const ownReads = f.inf.odo.slice(-5).reverse();
  if (ownReads.length) {
    out.push("km-Stände (eingetragen):");
    for (const r of ownReads) out.push(`  - ${fmtKey(r.date)}: ${F.fmtKm(r.km)}${r.note ? ` – ${untrusted("fahrzeug", short(r.note, 120))}` : ""}`);
  }
  if (f.inf.notes) out.push(`Notizen: ${untrusted("fahrzeug", short(f.inf.notes, 1000))}`);
  out.push("Dokumente (Zulassungsschein, Polizze …) liegen ggf. im Tresor der App – darauf hast du keinen Zugriff.");
  return out.join("\n");
}

export const TOOL_FAHRZEUGE_LESEN = {
  name: "fahrzeuge_lesen",
  title: "Fahrzeuge lesen",
  description: "Zeigt die Fahrzeuge aus Alltag › 🚗 Fahrzeuge (dieselben wie im Fahrtenbuch): Kennzeichen, Marke/Modell, Kilometerstand, " +
    "§57a-Pickerl (Monat, Toleranzfrist), nächstes Service nach Datum/km, Versicherung (Gesellschaft, Polizzennummer, Ablauf) und Tankbuch " +
    "mit Verbrauch l/100 km und €/100 km. Ohne Angabe: Übersicht inkl. fälliger Punkte; mit name/kennzeichen oder id: Details. Nur lesen.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Fahrzeug-Name oder Kennzeichen (unscharf)" },
      id: { type: "string", description: "ID des Fahrzeugs (aus der Übersicht)" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const x = await load(d);
    if (!x.vs.length) return "Es sind noch keine Fahrzeuge angelegt. Das geht in der App unter Alltag › 🚗 Fahrzeuge (oder im Fahrtenbuch).";
    if (s(args.name) || s(args.id)) {
      const q = s(args.name).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const byPlate = q ? x.vs.find((v) => v.plate && v.plate.replace(/[^A-Z0-9]/g, "") === q) : null;
      const v = byPlate || pick(x.vs, { id: args.id, name: args.name }, (v) => `${v.name} ${v.plate}`.trim(), "Fahrzeug");
      return detail(v, facts(v, x, today), x);
    }
    const out = [`🚗 ${x.vs.length} Fahrzeug${x.vs.length === 1 ? "" : "e"}:`];
    for (const v of x.vs) out.push(summary(v, facts(v, x, today), x));
    const due = F.dueVehicles(x.vs, [...x.infos.values()], x.fuel, Date.parse(`${today}T12:00:00Z`), { defaultId: x.defId });
    if (due.length) { out.push("", "Fällig / bald fällig:"); for (const z of due) out.push(`- ${z.text.replace(/^\S+\s/, "")}`); }
    out.push("", "Details: fahrzeuge_lesen mit name (oder Kennzeichen) oder id.");
    return out.join("\n");
  },
};

export const FAHRZEUG_TOOLS = [TOOL_FAHRZEUGE_LESEN];
