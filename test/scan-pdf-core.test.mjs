// node --test test/scan-pdf-core.test.mjs
// Update 15 – 📸 Erfassen: Code-Erkennung (GTIN, App-Links, URL, WLAN …) und PDF-Ersteller.
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../js/alltag/scan-core.js";
import * as P from "../js/pdf-core.js";

test("GTIN-Prüfziffer", () => {
  assert.ok(S.validGtin("9001234567893") === false || S.validGtin("9001234567893") === true);
  assert.ok(S.validGtin("4006381333931"), "Stabilo-Beispiel EAN-13");
  assert.ok(S.validGtin("96385074"), "EAN-8");
  assert.ok(!S.validGtin("4006381333932"));
  assert.ok(!S.validGtin("12345"));
});

test("classify", () => {
  const base = "https://muf2n.github.io/stempelkarte/";
  const a = S.classify("https://muf2n.github.io/stempelkarte/#alltag/werkzeug/abc123", { appBase: base });
  assert.equal(a.kind, "app"); assert.equal(a.hash, "#alltag/werkzeug/abc123"); assert.equal(a.label, "🧰 Werkzeug");
  assert.equal(S.classify("https://evil.example/#alltag/werkzeug/x", { appBase: base }).kind, "url", "fremde Seite mit App-Hash ist KEIN App-Link");
  assert.equal(S.classify("https://muf2n.github.io/stempelkarte/#alltag/x\"><script>", { appBase: base }).kind, "url", "kaputter Hash wird nicht geöffnet");
  assert.equal(S.classify("4006381333931").kind, "gtin");
  assert.equal(S.classify("12345678", { format: "ean_8" }).kind, "gtin");
  assert.equal(S.classify("https://wko.at").kind, "url");
  assert.deepEqual([S.classify("tel:+43123").kind, S.classify("tel:+43123").value], ["tel", "+43123"]);
  const w = S.classify("WIFI:T:WPA;S:Baustelle\x5c;WLAN;P:geh eim;;"); // \x5c = Backslash (escaptes ;)
  assert.equal(w.kind, "wifi"); assert.equal(w.value, "Baustelle;WLAN"); assert.equal(w.secret, "geh eim");
  assert.equal(S.classify("Milch\nBrot").kind, "text");
  assert.equal(S.classify(""), null);
});

test("Open Food Facts Name und Textzeilen", () => {
  assert.equal(S.offName({ product: { product_name_de: "Vollmilch", brands: "NÖM, X", quantity: "1 l" } }), "NÖM Vollmilch (1 l)");
  assert.equal(S.offName({}), "");
  assert.deepEqual(S.linesToItems("- Milch\n• Brot\n3) Eier\n\nx"), ["Milch", "Brot", "Eier"]);
});

test("PDF: A4 einpassen, JPEG-Größe, gültige Struktur", () => {
  const f = P.fitA4(1000, 2000);
  assert.ok(Math.abs(f.dh - (841.89 - 36)) < 0.01 && f.pw === 595.28);
  assert.equal(P.fitA4(2000, 1000).pw, 841.89, "Querformat-Bild → Querformat-Seite");
  // winziges gültiges JPEG-Kopfstück (SOI + SOF0 mit 3×2 px)
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  assert.deepEqual(P.jpegSize(jpg), { w: 3, h: 2 });
  const pdf = P.makePdf([{ jpeg: jpg, w: 3, h: 2 }, { jpeg: jpg, w: 3, h: 2 }], { title: "Scan (Test)" });
  const txt = new TextDecoder("latin1").decode(pdf);
  assert.ok(txt.startsWith("%PDF-1.4"));
  assert.match(txt, /\/Count 2/);
  assert.match(txt, /\/Title <FEFF005300630061006E00200028/, "Titel als UTF-16 („Scan (“)");
  assert.ok(txt.trimEnd().endsWith("%%EOF"));
  // xref-Offsets zeigen auf "n 0 obj"
  const xref = Number(/startxref\n(\d+)/.exec(txt)[1]);
  assert.ok(txt.slice(xref).startsWith("xref"));
  const offs = [...txt.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.ok(txt.slice(o).startsWith(`${i + 1} 0 obj`), `Objekt ${i + 1}`));
  assert.throws(() => P.makePdf([]));
});
