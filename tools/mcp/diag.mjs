// Diagnose: ruft alle Lese-Werkzeuge mit echten Daten auf und gibt NUR aus, ob sie gehen
// (bei Fehlern: Fehlerart + Stelle im Code – nie Inhalte oder Fehlertexte, denn das Log ist öffentlich).
import { makeDataFactory } from "./src/worker.js";
import { TOOLS } from "./src/tools.js";

const env = {
  FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT,
  STEMPEL_UID: process.env.STEMPEL_UID,
  STEMPEL_EMAIL: process.env.STEMPEL_EMAIL,
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  GMAIL_ENC_KEY: process.env.GMAIL_ENC_KEY,
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
// Gmail: nur Status/Hinweistext ausgeben, nie Mail-Inhalte
{
  const { TOOL_MAILS_SUCHEN } = await import("./src/gmail.js");
  try {
    const out = String(await TOOL_MAILS_SUCHEN.run({ suche: "Rechnung", max: 2 }, await getData()));
    console.log(/Mail\(s\) zu/.test(out) ? "ok    mails_suchen (Treffer)" : /^Keine Mails/.test(out) ? "ok    mails_suchen (keine Treffer)" : "hint  mails_suchen: " + out.slice(0, 300));
  } catch (e) {
    bad++;
    const frames = String((e && e.stack) || "").split("\n").filter((l) => /src\//.test(l)).slice(0, 4).map((l) => l.trim().replace(/^.*\/tools\/mcp\//, ""));
    console.log(`FAIL  mails_suchen [${(e && e.name) || "?"}${e && e.status ? " " + e.status : ""}${e && e.code ? " " + e.code : ""}] ${frames.join(" <- ")}`);
  }
}
console.log(bad ? `${bad} Werkzeug(e) mit internem Fehler` : "alle Lese-Werkzeuge ok");
