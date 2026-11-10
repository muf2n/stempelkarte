// Update 11 – 🎬 Freizeit-Listen: „listen_lesen“ (nur lesen). Logik aus js/alltag/listen-core.js (Wrangler bündelt sie mit).
// Sammlung wie in der App: users/{uid}/a_freizeit_listen. Ausgegeben werden nur Titel, Status, Fortschritt, Sterne,
// Person/Anlass/Datum/Preis – Notizen und Links bewusst NICHT (Freitext könnte eingefügter fremder Text sein).
import * as L from "../../../js/alltag/listen-core.js";
import { fmtKey, dayKey } from "./time.js";
import { RO, s, short } from "./util.js";

const u = (t, n = 80) => short(t, n);
const norm = (v) => s(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const TYPE_WORDS = { serie: ["serie", "serien"], film: ["film", "filme", "movie"], buch: ["buch", "bucher", "buecher", "lesen"], spiel: ["game", "games", "spiel", "spiele", "gaming"],
  musik: ["musik", "song", "songs", "lieder"], hobby: ["hobby", "hobbys", "hobbies"], ausflug: ["ausflug", "ausfluge", "ausfluege", "trip"], projekt: ["projekt", "projekte"],
  geschenk: ["geschenk", "geschenke", "geschenkidee", "geschenkideen"] };
const typeOf = (v) => { const n = norm(v); if (!n) return ""; for (const [id, w] of Object.entries(TYPE_WORDS)) if (w.includes(n) || n === id) return id; return null; };
const statusOf = (v) => { const n = norm(v).replace(/\s+/g, ""); if (!n) return ""; if (/^(idee|ideen|liste|offen|geplant)$/.test(n)) return "idee"; if (/^(lauft|laeuft|dabei|aktuell|gerade|besorgt)$/.test(n)) return "laeuft"; if (/^(fertig|erledigt|gesehen|gelesen|verschenkt|durch)$/.test(n)) return "fertig"; if (n === "alle") return "alle"; return null; };

function line(i) {
  const bits = [L.statusLabel(i.type, i.status)];
  if (i.progress) bits.push(`📍 ${u(i.progress, 40)}`);
  if (i.rating) bits.push(`${i.rating}/5 ★`);
  if (i.person) bits.push(`für ${u(i.person, 60)}`);
  if (i.occasion) bits.push(u(i.occasion, 60));
  if (i.date) bits.push(fmtKey(i.date));
  if (i.price) bits.push(`ca. ${i.price.toFixed(2).replace(".", ",")} €`);
  return `- ${u(i.title, 120)} (${bits.join(" · ")})`;
}

const TOOL_LESEN = {
  name: "listen_lesen",
  title: "Freizeit-Listen lesen",
  description: "Zeigt die Freizeit-Listen aus Alltag › 🎬 Freizeit-Listen: Serien, Filme, Bücher, Games, Musik, Hobbys, Ausflüge, persönliche Projekte und Geschenkideen (mit Person, Anlass, Datum, Preis). Status: Idee/auf der Liste, gerade dabei, fertig. Ohne Filter: was gerade läuft + die Ideen jeder Liste (fertige nur auf Wunsch). Nur lesen.",
  inputSchema: {
    type: "object",
    properties: {
      typ: { type: "string", description: "serien, filme, bücher, games, musik, hobbys, ausflüge, projekte oder geschenke (leer = alle)" },
      status: { type: "string", description: "idee, dabei, fertig oder alle (Standard: idee + dabei)" },
      person: { type: "string", description: "Nur Geschenkideen für diese Person" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const type = typeOf(args.typ);
    if (type === null) return `Die Liste „${u(args.typ, 40)}“ kenne ich nicht. Es gibt: ${L.TYPES.map((t) => t.label).join(", ")}.`;
    const st = statusOf(args.status);
    if (st === null) return "Status bitte als idee, dabei, fertig oder alle angeben.";
    const raw = await d.alltag("freizeit_listen").catch(() => []);
    let items = raw.map(L.normItem).filter((x) => x.id && x.title);
    if (type) items = items.filter((x) => x.type === type);
    if (s(args.person)) { const p = norm(args.person); items = items.filter((x) => x.type === "geschenk" && norm(x.person).includes(p)); }
    const want = (x) => (st === "alle" ? true : st ? x.status === st : x.status !== "fertig");
    const shown = items.filter(want);
    if (!items.length) return type ? `In „${L.typeById(type).label}“ steht noch nichts. Einträge legst du in der App unter Alltag › 🎬 Freizeit-Listen an.` : "Die Freizeit-Listen sind noch leer.";
    const out = [];
    for (const t of L.TYPES) {
      const arr = L.sortItems(shown.filter((x) => x.type === t.id));
      if (!arr.length) continue;
      out.push(`${t.e} ${t.label} (${arr.length}):`);
      for (const i of arr.slice(0, 40)) out.push(line(i));
      if (arr.length > 40) out.push(`  … und ${arr.length - 40} weitere`);
    }
    const done = items.filter((x) => x.status === "fertig").length;
    if (!out.length) out.push("Nichts mit diesem Filter.");
    if (!st && done) out.push(`(${done} fertige Einträge ausgeblendet – mit status „fertig“ oder „alle“ zeigen.)`);
    const up = L.upcomingGifts(items, dayKey(d.now), 14);
    if (up.length && (!type || type === "geschenk")) out.push(`🎁 Bald fällig: ${up.map((g) => `${u(g.title, 60)}${g.person ? ` für ${u(g.person, 40)}` : ""} am ${fmtKey(g.date)}`).join("; ")}`);
    return out.join("\n");
  },
};

export const LISTEN_TOOLS = [TOOL_LESEN];
