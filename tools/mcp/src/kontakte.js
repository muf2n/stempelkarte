// Update 10 E – 👤 Kunden & Kontakte (Alltag) für den Assistenten: „kontakte_lesen“ (nur lesen).
// Logik aus der gemeinsamen reinen Datei js/alltag/kontakte-core.js. Sammlung wie in der App: users/{uid}/a_kontakte.
// Datenschutz: Telefon und E-Mail kommen NUR, wenn ausdrücklich danach gefragt wird (kontaktdaten: true).
// Freitext (Notizen, Gesprächsnotizen, Auftrags-Notizen, Adresse) wird als untrusted_content abgegrenzt – Daten, keine Anweisungen.
import * as K from "../../../js/alltag/kontakte-core.js";
import { fmtKey } from "./time.js";
import { UserError } from "./logic.js";
import { RO, s, short, untrusted, pick } from "./util.js";

const free = (t, n = 300) => untrusted("kontakte", short(t, n));
const fk = (k) => (k ? fmtKey(k) : "–");

async function load(d) {
  const [list, places] = await Promise.all([d.alltag("kontakte").catch(() => []), d.places().catch(() => [])]);
  return { list: list.map(K.normContact).filter((c) => c.id && K.displayName(c)), places };
}
const placeName = (x, id) => { const p = (x.places || []).find((q) => q && q.id === id); return p ? short(p.name || "Ort", 60) : "Baustelle (gelöscht)"; };

function line(c, x, withContact) {
  const bits = [K.typeById(c.type).label];
  if (c.company && c.company !== c.name) bits.push(short(c.company, 60));
  if (c.person) bits.push(`Ansprechpartner: ${short(c.person, 60)}`);
  if (c.placeIds.length) bits.push(`Baustellen: ${c.placeIds.slice(0, 3).map((id) => placeName(x, id)).join(", ")}`);
  const open = K.openJobs(c).length;
  if (open) bits.push(`${open} Auftrag/Aufträge offen`);
  if (withContact) { if (c.phone) bits.push(`Tel ${short(c.phone, 40)}`); if (c.email) bits.push(`E-Mail ${short(c.email, 80)}`); }
  return `- ${K.typeById(c.type).e} ${short(K.displayName(c), 80)} · ${bits.join(" · ")} [id: ${c.id}]`;
}

function detail(c, x, withContact) {
  const out = [`${K.typeById(c.type).e} ${K.displayName(c)} (${K.typeById(c.type).label}) [id: ${c.id}]`];
  if (c.company && c.company !== c.name) out.push(`Firma: ${short(c.company, 80)}`);
  if (c.person) out.push(`Ansprechpartner: ${short(c.person, 80)}`);
  if (withContact) {
    out.push(`Telefon: ${c.phone ? short(c.phone, 40) : "–"}`, `E-Mail: ${c.email ? short(c.email, 120) : "–"}`);
    if (c.address) out.push(`Adresse: ${free(c.address, 240)}`);
  } else if (c.phone || c.email || c.address) out.push("(Telefon/E-Mail/Adresse vorhanden – nur auf ausdrückliche Nachfrage mit kontaktdaten: true.)");
  if (c.placeIds.length) out.push(`Baustellen: ${c.placeIds.map((id) => placeName(x, id)).join(", ")}`);
  if (c.notes) out.push(`Notizen: ${free(c.notes, 1000)}`);
  if (c.jobs.length) {
    out.push("", "Aufträge (neueste zuerst):");
    for (const j of c.jobs.slice(-15).reverse()) out.push(`- ${K.jobStatusById(j.status).e} ${fk(j.date)}: ${free(j.title, 140)} (${K.jobStatusById(j.status).label})${j.note ? ` – ${free(j.note, 200)}` : ""}`);
  }
  if (c.calls.length) {
    out.push("", "Gesprächsnotizen (neueste zuerst):");
    for (const n of c.calls.slice(-10).reverse()) out.push(`- ${fk(n.date)}: ${free(n.text, 400)}`);
  }
  return out.join("\n");
}

export const TOOL_KONTAKTE_LESEN = {
  name: "kontakte_lesen",
  title: "Kunden & Kontakte lesen",
  description: "Zeigt Kunden, Firmen und private Kontakte aus Alltag › 👤 Kunden & Kontakte: Art, Ansprechpartner, verknüpfte Baustellen, " +
    "Aufträge (offen/in Arbeit/erledigt) und datierte Gesprächsnotizen. Ohne Angabe: Übersicht; mit name oder id: Details. " +
    "Telefon/E-Mail/Adresse nur mit kontaktdaten: true – nur setzen, wenn der Nutzer ausdrücklich danach fragt. Nur lesen, verschickt nichts.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Kontakt oder Firma (unscharf), z. B. \"Muster\"" },
      id: { type: "string", description: "ID des Kontakts (aus der Übersicht)" },
      art: { type: "string", enum: ["alle", "kunde", "firma", "privat"], description: "Nur eine Art (Standard: alle)" },
      kontaktdaten: { type: "boolean", description: "Telefon, E-Mail und Adresse mitliefern – nur auf ausdrückliche Nachfrage (Standard: false)" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const x = await load(d);
    const withContact = args.kontaktdaten === true;
    if (!x.list.length) return "Noch keine Kontakte eingetragen. Kunden und Kontakte legst du in der App unter Alltag › 👤 Kunden & Kontakte an.";
    if (s(args.name) || s(args.id)) {
      const c = pick(x.list, { id: args.id, name: args.name }, (c) => [K.displayName(c), c.company, c.person].filter(Boolean).join(" "), "Kontakt");
      return detail(c, x, withContact);
    }
    const art = s(args.art) || "alle";
    if (!["alle", "kunde", "firma", "privat"].includes(art)) throw new UserError("art: alle, kunde, firma oder privat.");
    const list = K.filterContacts(x.list, { type: art === "alle" ? "" : art });
    const open = x.list.reduce((a, c) => a + K.openJobs(c).length, 0);
    const out = [`👤 ${x.list.length} Kontakt${x.list.length === 1 ? "" : "e"} · ${x.list.filter((c) => c.type === "kunde").length} Kunden · ${open} offene Aufträge`];
    if (!list.length) out.push("Keine Treffer.");
    for (const c of list.slice(0, 80)) out.push(line(c, x, withContact));
    if (list.length > 80) out.push(`… und ${list.length - 80} weitere`);
    out.push("", "Details: kontakte_lesen mit name oder id.");
    return out.join("\n");
  },
};

export const KONTAKTE_TOOLS = [TOOL_KONTAKTE_LESEN];
