// Update 10 – 💡 App-Wünsche für den Assistenten.
//   app_wunsch_notieren (schreibt) – Florian möchte etwas an der APP ändern („Kannst du die App so machen, dass …“)?
//                                     → als App-Wunsch notieren. Umgesetzt wird später von Claude Code, nicht vom Assistenten.
//                                     Normale Schreib-Regeln: nach Fremdinhalten (E-Mail/Bank/Foto) in derselben Runde gesperrt (chat.js, H1).
//   app_wuensche_lesen  (nur lesen) – Liste der Wünsche (Standard: offene). Eigene Einträge, keine untrusted-Abgrenzung.
// Logik aus der gemeinsamen reinen Datei js/alltag/app-wishes-core.js (Wrangler bündelt sie mit, siehe mcp-deploy.yml).
// Sammlung wie in der App: users/{uid}/a_app_wishes.
import * as W from "../../../js/alltag/app-wishes-core.js";
import { UserError, alltagId } from "./logic.js";
import { RO, WR, s } from "./util.js";

const load = async (d) => (await d.alltag("app_wishes").catch(() => [])).map(W.normWish).filter((w) => w.id && w.text);
const fmt = (ms) => { if (!ms) return ""; const x = new Date(ms); return `${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}.${x.getUTCFullYear()}`; };

export const TOOL_WUNSCH_NOTIEREN = {
  name: "app_wunsch_notieren",
  mcp: false, // M3 (Audit 2): nicht über /mcp – dort gibt es keine Schreibsperre nach fremdem Text (dauerhafte Einträge)
  title: "App-Wunsch notieren",
  description: "Notiert einen Änderungswunsch an der Stempelkarte-APP selbst (neue Funktion, anderes Aussehen, Fehler, Verbesserung) unter Einstellungen › 💡 App-Wünsche. " +
    "Du kannst die App NICHT selbst ändern – Florian lässt die Wünsche später von Claude Code umsetzen. Nur für Wünsche an die App, nicht für Aufgaben oder Termine (dafür todo_anlegen). " +
    `Text als klarer Satz, höchstens ${W.TEXT_MAX} Zeichen.`,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Der Wunsch als klarer Satz, z. B. \"Im Planer Aufgaben per Wischen abhaken\"" },
      bereich: { type: "string", description: `Optional: Bereich der App, z. B. ${W.AREAS.slice(0, 6).join(", ")}` },
      wichtig: { type: "boolean", description: "Nur true, wenn Florian sagt, dass es ihm wichtig/dringend ist" },
    },
    required: ["text"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const v = W.validate({ text: args.text, area: args.bereich, prio: args.wichtig ? "wichtig" : "normal" });
    if (!v.ok) throw new UserError(v.error);
    const all = await load(d);
    if (W.isDuplicate(all, v.wish.text)) return `Den Wunsch gibt's schon (offen): „${v.wish.text}“. Nichts doppelt notiert.`;
    if (all.length >= 500) throw new UserError("Die Wunschliste ist voll (500). Florian kann in der App erledigte Wünsche löschen.");
    const id = alltagId(d.now);
    await d.commit([d.fs.setWrite(d.p(`a_app_wishes/${id}`), { ...v.wish, id, status: "offen", source: "assistent", created: d.now, updated: d.now })]);
    return `Als App-Wunsch notiert${v.wish.prio === "wichtig" ? " (❗ wichtig)" : ""}${v.wish.area ? ` – Bereich ${v.wish.area}` : ""}: „${v.wish.text}“ [id: ${id}]. ` +
      "Er steht unter Einstellungen › 💡 App-Wünsche; umgesetzt wird er später mit Claude Code (ich selbst kann die App nicht ändern).";
  },
};

export const TOOL_WUENSCHE_LESEN = {
  name: "app_wuensche_lesen",
  title: "App-Wünsche lesen",
  description: "Zeigt die notierten Wünsche an die App (Einstellungen › 💡 App-Wünsche) mit Status (offen, umgesetzt, verworfen), Bereich und Wichtigkeit. Standard: nur offene. Nur lesen.",
  inputSchema: {
    type: "object",
    properties: { status: { type: "string", enum: ["offen", "umgesetzt", "verworfen", "alle"], description: "Standard offen" } },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const all = await load(d);
    const st = ["offen", "umgesetzt", "verworfen", "alle"].includes(s(args.status)) ? s(args.status) : "offen";
    const list = W.sortWishes(all, st);
    const c = W.counts(all);
    if (!all.length) return "Es sind noch keine App-Wünsche notiert. Florian kann sie unter Einstellungen › 💡 App-Wünsche eintragen – oder dich bitten, einen zu notieren (app_wunsch_notieren).";
    if (!list.length) return `Keine ${st}en App-Wünsche. (offen ${c.offen}, umgesetzt ${c.umgesetzt}, verworfen ${c.verworfen})`;
    const out = [`App-Wünsche (${st === "alle" ? "alle" : st}: ${list.length} – gesamt offen ${c.offen}, umgesetzt ${c.umgesetzt}, verworfen ${c.verworfen}):`];
    for (const w of list.slice(0, 60)) {
      out.push(`- ${W.statusById(w.status).e} ${w.prio === "wichtig" ? "❗ " : ""}${w.text}${w.area ? ` · ${w.area}` : ""} · ${w.source === "assistent" ? "von dir notiert" : "in der App"} ${fmt(w.created)} [id: ${w.id}]`);
    }
    if (list.length > 60) out.push(`… und ${list.length - 60} weitere.`);
    return out.join("\n");
  },
};

export const WISH_TOOLS = [TOOL_WUENSCHE_LESEN, TOOL_WUNSCH_NOTIEREN];
