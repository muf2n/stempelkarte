// Update 10 – 🧰 Werkzeug-Register (Alltag) für den Assistenten: „werkzeug_lesen“ (nur lesen).
// Logik aus der gemeinsamen reinen Datei js/alltag/werkzeug-core.js (Wrangler bündelt sie mit, siehe mcp-deploy.yml).
// Sammlung wie in der App: users/{uid}/a_werkzeug. Freitext (Notizen, Defekt-Beschreibung, Verlaufs-Notizen) wird als
// untrusted_content abgegrenzt – das sind Daten, keine Anweisungen.
import * as W from "../../../js/alltag/werkzeug-core.js";
import * as TR from "./trip.js";
import { dayKey, fmtKey } from "./time.js";
import { UserError } from "./logic.js";
import { RO, s, short, untrusted, pick } from "./util.js";

export * from "../../../js/alltag/werkzeug-core.js";

const free = (t, n = 300) => untrusted("werkzeug", short(t, n));

async function load(d) {
  const [tools, places, settings] = await Promise.all([d.alltag("werkzeug").catch(() => []), d.places().catch(() => []), d.settings()]);
  return { tools: tools.map(W.normTool).filter((t) => t.id && t.name), places, vehicles: TR.readVehicles(settings) };
}

function line(t, x, today) {
  const c = W.checkStatus(t, today);
  const st = W.toolState(t);
  const bits = [W.catById(t.cat).label];
  if (t.brand) bits.push(short(t.brand, 60));
  if (t.serial) bits.push(`SN ${short(t.serial, 40)}`);
  bits.push(W.locLabel(t, x.places, x.vehicles).replace(/^\S+\s/, "Ort: "));
  if (st.id === "aus") bits.push(`ausgeliehen an ${short(t.holder, 60)}`);
  if (st.id === "defekt") bits.push("DEFEKT");
  if (c.state !== "none") bits.push(`${t.checkLabel || W.catById(t.cat).check}: ${c.state === "ok" ? `nächste ${fmtKey(c.due)}` : c.label}`);
  return `- ${W.catById(t.cat).e} ${short(t.name, 80)} · ${bits.join(" · ")} [id: ${t.id}]`;
}

function detail(t, x, today) {
  const c = W.checkStatus(t, today);
  const out = [`${W.catById(t.cat).e} ${t.name} (${W.catById(t.cat).label}) [id: ${t.id}]`];
  if (t.brand) out.push(`Hersteller/Modell: ${short(t.brand, 80)}`);
  if (t.serial) out.push(`Seriennummer: ${short(t.serial, 60)}`);
  out.push(`Standort: ${W.locLabel(t, x.places, x.vehicles).replace(/^\S+\s/, "")}`);
  out.push(`Status: ${t.defect ? "defekt" : t.holder ? `ausgeliehen an ${short(t.holder, 60)}` : "verfügbar"}`);
  if (t.defect && t.defectNote) out.push(`Defekt: ${free(t.defectNote)}`);
  if (t.checkMonths || t.lastCheck || t.nextCheck) {
    out.push(`${t.checkLabel || W.catById(t.cat).check}: ${t.checkMonths ? `alle ${t.checkMonths} Monate` : "ohne festes Intervall"}` +
      `${t.lastCheck ? `, zuletzt ${fmtKey(t.lastCheck)}` : ""}${c.due ? `, nächste ${fmtKey(c.due)}` : ""} → ${c.state === "ok" ? "ok" : c.label}`);
  }
  if (t.notes) out.push(`Notizen: ${free(t.notes, 1000)}`);
  const hist = t.history.slice(-10).reverse();
  if (hist.length) {
    out.push("", "Verlauf (neueste zuerst):");
    for (const h of hist) out.push(`- ${fmtKey(dayKey(h.ts))}: ${W.histText(h).replace(/^\S+\s/, "")}${h.note ? ` – ${free(h.note, 200)}` : ""}`);
  }
  return out.join("\n");
}

export const TOOL_WERKZEUG_LESEN = {
  name: "werkzeug_lesen",
  title: "Werkzeug-Register lesen",
  description: "Zeigt das Werkzeug-Register aus Alltag › 🧰 Werkzeug: Akkuwerkzeug, Messgeräte, Handwerkzeug, Leitern mit Hersteller/Modell, " +
    "Seriennummer, Standort (Firma/Auto/Baustelle), an wen verliehen, Defekte und Prüf-/Kalibriertermine (fällig/überfällig). " +
    "Ohne Angabe: Übersicht; mit name oder id: Details samt Verlauf. Nur lesen.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Werkzeug (unscharf), z. B. \"Prüfgerät\" oder eine Seriennummer" },
      id: { type: "string", description: "ID des Werkzeugs (aus der Übersicht)" },
      filter: { type: "string", enum: ["alle", "faellig", "ausgeliehen", "defekt"], description: "Nur fällige Prüfungen, verliehene oder defekte (Standard: alle)" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const x = await load(d);
    if (!x.tools.length) return "Das Werkzeug-Register ist noch leer. Werkzeug trägst du in der App unter Alltag › 🧰 Werkzeug ein.";
    if (s(args.name) || s(args.id)) {
      const q = s(args.name);
      const bySn = q ? x.tools.find((t) => t.serial && t.serial.toLowerCase() === q.toLowerCase()) : null;
      const t = bySn || pick(x.tools, { id: args.id, name: q }, (t) => t.name, "Werkzeug");
      return detail(t, x, today);
    }
    const view = { ausgeliehen: "aus" }[s(args.filter)] || s(args.filter) || "alle";
    if (!["alle", "faellig", "aus", "defekt"].includes(view)) throw new UserError("filter: alle, faellig, ausgeliehen oder defekt.");
    const list = W.filterTools(x.tools, { view }, today);
    const n = W.counts(x.tools, today);
    const out = [`🧰 ${n.alle} Werkzeug${n.alle === 1 ? "" : "e"} · ${n.faellig} Prüfung${n.faellig === 1 ? "" : "en"} fällig · ${n.aus} verliehen · ${n.defekt} defekt`];
    if (!list.length) out.push(view === "faellig" ? "Keine Prüfung fällig." : view === "aus" ? "Nichts verliehen." : view === "defekt" ? "Nichts defekt." : "Keine Treffer.");
    for (const t of list.slice(0, 80)) out.push(line(t, x, today));
    if (list.length > 80) out.push(`… und ${list.length - 80} weitere`);
    out.push("", "Details: werkzeug_lesen mit name oder id.");
    return out.join("\n");
  },
};

export const WERKZEUG_TOOLS = [TOOL_WERKZEUG_LESEN];
