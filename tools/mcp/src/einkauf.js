// Update 10 – 🛒 Einkaufsliste: „einkauf_lesen“ (nur lesen) und „einkauf_hinzufuegen“ (schreibt Artikel in eine Liste).
// Logik aus der gemeinsamen reinen Datei js/alltag/einkauf-core.js (Wrangler bündelt sie mit, siehe mcp-deploy.yml).
// Sammlungen wie in der App: users/{uid}/a_einkauf (Artikel), a_einkauf_lists (Listen + "history").
// Material mit Status „brauche“ wird beim Lesen als „🧰 Material fehlt“ mit angezeigt (keine Kopie).
import * as EK from "../../../js/alltag/einkauf-core.js";
import { UserError, alltagId } from "./logic.js";
import { RO, WR, SRC, s, short } from "./util.js";

export * from "../../../js/alltag/einkauf-core.js";

// Eigene Einträge (wie material_lesen) – kein Fremdinhalt, daher keine untrusted-Abgrenzung (sonst wäre Lesen + Hinzufügen in einer Runde gesperrt).
const u = (t, n = 120) => short(t, n);

async function load(d) {
  const [items, lists, mat] = await Promise.all([
    d.alltag("einkauf").catch(() => []), d.alltag("einkauf_lists").catch(() => []), d.alltag("material_items").catch(() => []),
  ]);
  return { items: items.map((x) => EK.normItem(x)).filter((x) => x.name), docs: lists, lists: EK.listsOf(lists), mat };
}

const TOOL_LESEN = {
  name: "einkauf_lesen",
  title: "Einkaufsliste lesen",
  description: "Zeigt die Einkaufslisten aus Alltag › 🛒 Einkaufsliste (z. B. Privat, Baustelle, eigene Listen): offene Artikel nach Kategorie (Lebensmittel, Drogerie, Baumarkt/Elektro, Sonstiges) mit Menge und Einheit, auf Wunsch auch erledigte – dazu fehlendes Material (Status „brauche“ aus dem Material-Bereich). Ohne Liste: alle Listen.",
  inputSchema: {
    type: "object",
    properties: {
      liste: { type: "string", description: "Name der Liste, z. B. \"Privat\", \"Baustelle\" oder \"Material\" (leer = alle)" },
      erledigte: { type: "boolean", description: "Auch abgehakte Artikel zeigen (Standard: nein)" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const { items, lists, mat } = await load(d);
    const q = s(args.liste);
    const wantMat = !q || /^(material|🧰)/i.test(q);
    let shown = lists;
    if (q && !/^material/i.test(q)) {
      const l = EK.findList(q, lists);
      if (!l) throw new UserError(`Liste „${q}“ gibt's nicht – vorhanden: ${lists.map((x) => x.name).join(", ")}, Material.`);
      shown = [l];
    } else if (q) shown = [];
    const out = [];
    for (const l of shown) {
      const all = EK.sortItems(items.filter((x) => x.listId === l.id));
      const open = all.filter((x) => !x.done);
      const done = all.filter((x) => x.done);
      out.push(`${l.e} ${l.name} (ID ${l.id}) – ${open.length ? `${open.length} offen` : "nichts offen"}${done.length ? `, ${done.length} erledigt` : ""}`);
      for (const g of EK.groupOpen(all)) {
        out.push(`  ${g.cat.e} ${g.cat.label}:`);
        for (const it of g.items) out.push(`  - ${u(EK.lineText(it))}${it.note ? ` (${u(it.note, 80)})` : ""} (ID ${it.id})`);
      }
      if (args.erledigte && done.length) {
        out.push("  ✅ Erledigt:");
        for (const it of done.slice(0, 40)) out.push(`  - ${u(EK.lineText(it))} (ID ${it.id})`);
      }
    }
    if (wantMat) {
      const rows = EK.materialRows(mat, d.now).filter((x) => !x.done);
      if (rows.length) {
        if (out.length) out.push("");
        out.push(`🧰 Material fehlt (aus dem Material-Bereich) – ${rows.length} offen`);
        for (const r of rows) out.push(`  - ${EK.fmtNum(r.qty)} ${r.unit} ${u(r.name)}${r.place ? ` · ${u(r.place, 60)}` : ""} (Material-ID ${r.id})`);
      } else if (q) out.push("🧰 Material fehlt: nichts offen.");
    }
    if (!items.length && !out.some((x) => x.startsWith("🧰"))) return "Die Einkaufslisten sind noch leer. Mit einkauf_hinzufuegen kann ich etwas draufschreiben.";
    return out.join("\n");
  },
};

const TOOL_HINZU = {
  name: "einkauf_hinzufuegen",
  mcp: false, // M3 (Audit 2): nicht über /mcp – dort gibt es keine Schreibsperre nach fremdem Text (dauerhafte Einträge)
  title: "Auf die Einkaufsliste",
  description: "Schreibt einen oder mehrere Artikel auf eine Einkaufsliste in Alltag › 🛒 Einkaufsliste. Menge/Einheit dürfen im Text stehen (\"2 kg Äpfel\", \"3x Brot\", \"Milch\"). Die Kategorie (Lebensmittel, Drogerie, Baumarkt/Elektro, Sonstiges) wird erraten, wenn keine angegeben ist. Steht der Artikel schon offen drauf, wird die Menge erhöht statt doppelt eingetragen. Standard-Liste: Privat; eine noch nicht vorhandene Liste wird angelegt. Material für die Baustelle bitte mit material_anlegen eintragen (erscheint dann automatisch unter „Material fehlt“).",
  inputSchema: {
    type: "object",
    properties: {
      artikel: {
        anyOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 30 }],
        description: "Artikel, z. B. [\"2 kg Äpfel\", \"Milch\"] oder \"Brot, Butter, 6 Eier\" (Komma trennt)",
      },
      liste: { type: "string", description: "Name der Liste (Standard \"Privat\"), z. B. \"Baustelle\" oder \"Party\"" },
      kategorie: { type: "string", description: "lebensmittel, drogerie, baumarkt (Baumarkt/Elektro) oder sonstiges – gilt für alle Artikel; leer = automatisch" },
      notiz: { type: "string", description: "Notiz zu den Artikeln (z. B. Marke)" },
    },
    required: ["artikel"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const raw = Array.isArray(args.artikel) ? args.artikel : s(args.artikel).split(/[,;\n]+/);
    const parsed = raw.map((x) => EK.parseQuick(x)).filter((p) => p.name);
    if (!parsed.length) throw new UserError("Bitte angeben, was auf die Liste soll.");
    if (parsed.length > 30) throw new UserError("Höchstens 30 Artikel auf einmal.");
    let cat = "";
    if (s(args.kategorie)) {
      const k = EK.norm(args.kategorie);
      const hit = EK.CATS.find((c) => c.id === k || EK.norm(c.label).startsWith(k) || (k.length >= 4 && EK.norm(c.label).includes(k)) || (k === "elektro" && c.id === "baumarkt"));
      if (!hit) throw new UserError(`Kategorie „${s(args.kategorie)}“ kenne ich nicht – möglich: ${EK.CATS.map((c) => c.label).join(", ")}.`);
      cat = hit.id;
    }
    const { items, docs, lists } = await load(d);
    const writes = [];
    const lq = s(args.liste) || "Privat";
    if (/^material/i.test(lq)) throw new UserError("„Material fehlt“ füllt sich aus dem Material-Bereich – bitte material_anlegen verwenden.");
    let list = EK.findList(lq, lists);
    let created = false;
    if (!list) {
      const id = alltagId(d.now);
      list = EK.normList({ id, name: lq.slice(0, 40), e: "🛒", order: Math.max(1, ...lists.map((l) => l.order)) + 1 });
      writes.push(d.fs.setWrite(d.p(`a_einkauf_lists/${id}`), { ...list, created: d.now, updated: d.now, src: SRC }));
      created = true;
    }
    const hist = EK.historyOf(docs);
    const open = items.filter((x) => x.listId === list.id && !x.done);
    const added = [], merged = [];
    const histItems = [];
    let n = 0;
    for (const p of parsed) {
      const h = hist.names[EK.norm(p.name)];
      const c = cat || EK.guessCat(p.name, hist);
      const unit = p.qty ? p.unit : ((h && h.unit) || "Stk");
      const dupe = open.find((x) => EK.norm(x.name) === EK.norm(p.name));
      if (dupe) {
        if (p.qty && (dupe.unit === unit || !dupe.qty)) {
          const qty = (dupe.qty || 0) + p.qty;
          writes.push(d.fs.setWrite(d.p(`a_einkauf/${dupe.id}`), { ...dupe, qty, unit, updated: d.now }));
          dupe.qty = qty; dupe.unit = unit;
        }
        merged.push(EK.lineText(dupe));
      } else {
        const id = alltagId(d.now + n++);
        const it = EK.normItem({ id, listId: list.id, name: p.name, qty: p.qty, unit, cat: c, done: false, note: s(args.notiz).slice(0, 300) }, d.now);
        writes.push(d.fs.setWrite(d.p(`a_einkauf/${id}`), { ...it, created: d.now, updated: d.now, src: SRC }));
        open.push(it);
        added.push(`${EK.catById(c).e} ${EK.lineText(it)}`);
      }
      histItems.push({ name: p.name, cat: c, unit });
    }
    writes.push(d.fs.setWrite(d.p(`a_einkauf_lists/${EK.HISTORY_ID}`), { ...hist, names: EK.addToHistory(hist.names, histItems, d.now), updated: d.now }));
    await d.commit(writes);
    const parts = [];
    if (created) parts.push(`Neue Liste „${list.name}“ angelegt.`);
    if (added.length) parts.push(`Auf „${list.name}“ geschrieben: ${added.join(", ")}.`);
    if (merged.length) parts.push(`Stand schon drauf: ${merged.join(", ")}.`);
    return parts.join(" ");
  },
};

export const EINKAUF_TOOLS = [TOOL_LESEN, TOOL_HINZU];
