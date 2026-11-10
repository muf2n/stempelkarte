// node --test test/karriere-core.test.mjs
// Update 12 – Karriere: Lebenslauf, Ausbildungsfortschritt, Zertifikate mit Ablauf, Bewerbungen mit Hinweisen.
import test from "node:test";
import assert from "node:assert/strict";
import * as K from "../js/alltag/karriere-core.js";

const ap = { start: "2024-09-01", years: 3.5, trade: "Elektrotechnik", company: "Muster Elektro GmbH" };

test("Ausbildungsfortschritt und Lehrjahr", () => {
  const p = K.apprenticeProgress(ap, "2026-11-10");
  assert.equal(p.year, 3);
  assert.ok(p.pct > 60 && p.pct < 65, String(p.pct));
  assert.equal(p.end, "2028-03-01");
  assert.equal(K.apprenticeProgress({}, "2026-11-10"), null);
  const st = K.apprenticeStation(ap);
  assert.equal(st.title, "Lehre Elektrotechnik");
  assert.equal(st.from, "2024-09");
  assert.match(st.text, /03\/2028/);
});

test("normCv säubert, sortCv: laufend zuerst", () => {
  const c = K.normCv({ skills: [{ name: "Installation", level: 9 }, { name: "" }], cv: [{ title: "Polytechnische", kind: "schule", from: "2023-09", to: "2024-06" }, { title: "Ferialjob", from: "2023-07", to: "2023-08" }, { title: "Lehre", from: "2024-09" }] });
  assert.equal(c.skills.length, 1); assert.equal(c.skills[0].level, 5);
  assert.deepEqual(K.sortCv(c.cv).map((x) => x.title), ["Lehre", "Polytechnische", "Ferialjob"]);
});

test("Zertifikate: Ablauf", () => {
  const t = "2026-11-10";
  assert.equal(K.certState(K.normCert({ expires: "2026-12-01" }), t), "bald");
  assert.equal(K.certState(K.normCert({ expires: "2026-11-01" }), t), "ab");
  assert.equal(K.certState(K.normCert({}), t), "frei");
  const d = K.dueCerts([{ id: "a", title: "Erste Hilfe", expires: "2026-12-20" }, { id: "b", title: "Stapler", expires: "2027-12-01" }], t);
  assert.deepEqual(d.map((x) => x.id), ["a"]);
});

test("Bewerbungen: Zählung und Hinweise", () => {
  const t = "2026-11-10";
  const jobs = [
    { id: "1", company: "A", status: "gesendet", applied: "2026-10-20" },
    { id: "2", company: "B", status: "gespraech", next: "2026-11-11", nextWhat: "Vorstellungsgespräch" },
    { id: "3", company: "C", status: "absage", applied: "2026-09-01" },
    { id: "4", company: "D", status: "gesendet", applied: "2026-11-05" },
  ];
  assert.equal(K.jobCounts(jobs).gesendet, 2);
  const h = K.jobHints(jobs, t);
  assert.deepEqual(h.map((x) => x.id), ["1", "2"]);
  assert.match(h[1].hint, /Vorstellungsgespräch 11\.11\.2026/);
  assert.equal(K.normJob({ link: "http://x" }).link, "");
  assert.equal(K.prepDone({ prep: { 0: true, 2: true, 99: true } }), 2);
});

test("Lebenslauf als Text", () => {
  const txt = K.cvText({ headline: "Elektrotechnik-Lehrling", city: "Graz", skills: [{ name: "Hausinstallation", cat: "fach" }], languages: [{ name: "Deutsch", level: "Muttersprache" }] }, "Max Muster", ap);
  assert.match(txt, /^Max Muster\nElektrotechnik-Lehrling\nGraz/);
  assert.match(txt, /AUSBILDUNG\n09\/2024 – heute  Lehre Elektrotechnik, Muster Elektro GmbH/);
  assert.match(txt, /Fachlich: Hausinstallation/);
  assert.match(txt, /Deutsch \(Muttersprache\)/);
});
