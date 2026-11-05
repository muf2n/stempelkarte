// Diagnose: ruft alle Lese-Werkzeuge mit echten Daten auf und gibt NUR aus, ob sie gehen
// (bei Fehlern: Fehlerart + Stelle im Code – nie Inhalte oder Fehlertexte, denn das Log ist öffentlich).
import { makeDataFactory } from "./src/worker.js";
import { TOOLS } from "./src/tools.js";

const env = {
  FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT,
  STEMPEL_UID: process.env.STEMPEL_UID,
  STEMPEL_EMAIL: process.env.STEMPEL_EMAIL,
};
const getData = makeDataFactory(env);
const ARGS = { abos_lesen: [{}, { alle: true }] };

let bad = 0;
for (const t of TOOLS) {
  if (!(t.annotations && t.annotations.readOnlyHint === true)) continue;
  if (/mail/.test(t.name)) continue; // Gmail nicht anfassen
  for (const args of ARGS[t.name] || [{}]) {
    try {
      const d = await getData();
      await t.run(args, d);
      console.log(`ok    ${t.name}`);
    } catch (e) {
      const user = e && (e.constructor?.name === "UserError" || e.expose);
      const frames = String((e && e.stack) || "").split("\n").filter((l) => /src\/|js\/alltag|js\//.test(l)).slice(0, 4)
        .map((l) => l.trim().replace(/^.*\/(tools\/mcp\/src\/|js\/)/, "$1").replace(/\)$/, ""));
      if (!user) bad++;
      console.log(`${user ? "hint " : "FAIL "} ${t.name}  [${(e && e.name) || "?"}${e && e.status ? " " + e.status : ""}]  ${user ? "" : frames.join(" <- ")}`);
    }
  }
}
console.log(bad ? `${bad} Werkzeug(e) mit internem Fehler` : "alle Lese-Werkzeuge ok");
