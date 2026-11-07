// Update 10 – 💡 „app_wunsch_notieren“ / „app_wuensche_lesen“ + 🔒 kein Server-Werkzeug liest Dokument-Inhalte. Nur erfundene Testdaten.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { setup, vt } from "./helpers.js";
import { TOOLS, WRITE_TOOL_NAMES } from "../src/tools.js";

const NOW = vt(2026, 11, 8, 10, 0);

test("registriert: lesen RO, notieren schreibt (→ Untrusted-Sperre greift)", () => {
  assert.equal(TOOLS.find((t) => t.name === "app_wuensche_lesen").annotations.readOnlyHint, true);
  assert.equal(TOOLS.find((t) => t.name === "app_wunsch_notieren").annotations.readOnlyHint, false);
  assert.ok(WRITE_TOOL_NAMES().has("app_wunsch_notieren"));
  assert.match(TOOLS.find((t) => t.name === "app_wunsch_notieren").description, /NICHT selbst ändern/);
});

test("app_wunsch_notieren: speichert offen/assistent, wichtig + Bereich, keine Doppelten, leer → Fehler", async () => {
  const t = await setup({ now: NOW });
  let r = await t.tool("app_wunsch_notieren", { text: "  Im Planer Aufgaben per Wischen abhaken ", bereich: "Planer", wichtig: true });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Als App-Wunsch notiert \(❗ wichtig\) – Bereich Planer/);
  assert.match(r.text, /Claude Code/);
  const docs = t.g.list(`${t.base}/a_app_wishes`);
  assert.equal(docs.length, 1);
  const w = docs[0].data || docs[0];
  assert.equal(w.text, "Im Planer Aufgaben per Wischen abhaken");
  assert.equal(w.status, "offen");
  assert.equal(w.source, "assistent");
  assert.equal(w.prio, "wichtig");
  r = await t.tool("app_wunsch_notieren", { text: "im planer aufgaben per wischen abhaken" });
  assert.match(r.text, /gibt's schon/);
  assert.equal(t.g.list(`${t.base}/a_app_wishes`).length, 1);
  r = await t.tool("app_wunsch_notieren", { text: "   " });
  assert.equal(r.isError, true);
  r = await t.tool("app_wunsch_notieren", { text: "x".repeat(600) });
  assert.equal(r.isError, true);
});

test("app_wuensche_lesen: leer, Standard offen, Filter alle", async () => {
  const t = await setup({ now: NOW });
  let r = await t.tool("app_wuensche_lesen", {});
  assert.match(r.text, /noch keine App-Wünsche/);
  t.g.set(`${t.base}/a_app_wishes/w1`, { id: "w1", text: "Dunkles Design für den Kalender", status: "offen", prio: "normal", created: 1, source: "app" });
  t.g.set(`${t.base}/a_app_wishes/w2`, { id: "w2", text: "Export als PDF", status: "umgesetzt", created: 2, source: "assistent" });
  r = await t.tool("app_wuensche_lesen", {});
  assert.match(r.text, /Dunkles Design/);
  assert.doesNotMatch(r.text, /Export als PDF/);
  r = await t.tool("app_wuensche_lesen", { status: "alle" });
  assert.match(r.text, /Export als PDF/);
  r = await t.tool("app_wuensche_lesen", { status: "verworfen" });
  assert.match(r.text, /Keine verworfenen App-Wünsche/);
});

test("🔒 Kein Server-Werkzeug liest die (verschlüsselten) Dokumente oder ihre Dateien", () => {
  const dir = new URL("../src/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /a_dokumente|a_doc_files|(alltag|list\w*|get\w*)\(\s*["'`]dokumente["'`]/, f);
  }
});
