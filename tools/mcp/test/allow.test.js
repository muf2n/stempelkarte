// M2 (Audit 2): „Zugänge synchronisieren“ – allow/<e-mail> aus ALLOWED_EMAILS, nur Zahlen in der Ausgabe.
import test from "node:test";
import assert from "node:assert/strict";
import { makeAccount, FakeGoogle, PROJECT } from "./helpers.js";
import { Firestore } from "../src/firestore.js";
import { loadAccount, getAccessToken, clearCaches } from "../src/google.js";
import { parseAllowed, syncAllowed } from "../sync-allow.mjs";

test("parseAllowed: bereinigt, klein, ohne Doppelte, zählt ungültige", () => {
  assert.deepEqual(parseAllowed(" A@Example.com, b@example.at;a@example.com  kaputt, x@y"), { emails: ["a@example.com", "b@example.at"], bad: 2 });
  assert.deepEqual(parseAllowed(""), { emails: [], bad: 0 });
});

test("syncAllowed: legt an, behält, entfernt nicht mehr gelistete", async () => {
  clearCaches();
  const acc = await makeAccount();
  const g = new FakeGoogle({ publicKey: acc.publicKey });
  const a = loadAccount(acc.json);
  const fs = new Firestore({ projectId: PROJECT, getToken: () => getAccessToken(a, g.fetch), fetchImpl: g.fetch });
  g.set("allow/alt@example.com", { allowed: true });
  g.set("allow/bleibt@example.com", { allowed: true });
  const r = await syncAllowed(fs, "bleibt@example.com, neu@example.com", 5);
  assert.deepEqual(r, { added: 1, kept: 1, removed: 1, bad: 0 });
  assert.deepEqual(g.list("allow").map((d) => d.id ?? d).length, 2);
  assert.equal(g.get("allow/alt@example.com"), null);
  assert.equal(g.get("allow/neu@example.com").allowed, true);
});
