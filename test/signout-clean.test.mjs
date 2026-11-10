// L3 (Audit 2): Abmelden räumt private Gerätedaten weg, Geräte-Einstellungen bleiben.
import test from "node:test";
import assert from "node:assert/strict";
import { clearPrivateStorage, PRIVATE_KEYS } from "../js/signout-clean.js";

function mem(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, m };
}

test("clearPrivateStorage: Verläufe, Wetter, Briefing, Suche, Tokens, Cloud-Kalenderkopien weg – Akzentfarbe & lokale Daten bleiben", () => {
  const ls = mem({
    "stempelkarte.ai.history": "[]", "sk-jp-sensei": "[]", "sk-weather": "{}", "sk-weather-cache": "{}", "sk-brief-morning": "1", "sk-brief-week": "1",
    "sk-search-recent": "[]", "stempelkarte.gmail.tok": "x", "stempelkarte.ical.data.cloud:u1|f1": "{}", "stempelkarte.ical.list.cloud:u1": "[]",
    "stempelkarte.accent": "#f00", "stempelkarte.local.v1": "{}", "stempelkarte.ical.list.local": "[]", "sk-money-lock-cache": "{}", "stempelkarte.ai.url": "u",
  });
  const ss = mem({ "sk-money-lock-sess": "{}", "sk-tresor-fails": "{\"n\":3}" });
  const removed = clearPrivateStorage(ls, ss);
  for (const k of ["stempelkarte.ai.history", "sk-jp-sensei", "sk-weather", "sk-weather-cache", "sk-brief-morning", "sk-search-recent", "stempelkarte.gmail.tok", "stempelkarte.ical.data.cloud:u1|f1", "stempelkarte.ical.list.cloud:u1"]) {
    assert.equal(ls.getItem(k), null, k);
    assert.ok(removed.includes(k), k);
  }
  for (const k of ["stempelkarte.accent", "stempelkarte.local.v1", "stempelkarte.ical.list.local", "stempelkarte.ai.url"]) assert.notEqual(ls.getItem(k), null, k);
  assert.equal(ss.getItem("sk-money-lock-sess"), null);
  assert.notEqual(ss.getItem("sk-tresor-fails"), null, "Fehlversuch-Zähler bleibt");
  assert.ok(!PRIVATE_KEYS.includes("stempelkarte.accent"));
});

test("clearPrivateStorage: Karte & Route – letzte Ziele und gesuchte Adressen weg", () => {
  const ls = mem({ "sk-karte-recent": "[]", "sk-karte-geo": "{}", "sk-karte-mode": "car" });
  clearPrivateStorage(ls, mem());
  assert.equal(ls.getItem("sk-karte-recent"), null);
  assert.equal(ls.getItem("sk-karte-geo"), null);
  assert.equal(ls.getItem("sk-karte-mode"), "car", "Verkehrsmittel-Vorliebe bleibt");
});
