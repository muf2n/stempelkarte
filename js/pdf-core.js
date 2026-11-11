// Update 15 – Minimaler PDF-Ersteller (ohne Bibliothek): JPEG-Bilder → mehrseitiges PDF (A4, Bild eingepasst, zentriert).
// Läuft im Browser und in node (Tests). Eingabe: [{ jpeg: Uint8Array, w, h }] (Pixelmaße) → Uint8Array (PDF 1.4).
const A4 = { w: 595.28, h: 841.89 }; // Punkte (1/72 Zoll)
const enc = (str) => new TextEncoder().encode(str);

export function fitA4(w, h, margin = 18) {
  const land = w > h;
  const pw = land ? A4.h : A4.w, ph = land ? A4.w : A4.h; // Querformat-Fotos auf Querformat-Seite
  const k = Math.min((pw - 2 * margin) / w, (ph - 2 * margin) / h);
  const dw = w * k, dh = h * k;
  return { pw, ph, dw, dh, x: (pw - dw) / 2, y: (ph - dh) / 2 };
}

/** JPEG-Größe (Breite/Höhe) aus den Bytes lesen (SOF0/SOF2-Marker) → { w, h } oder null. */
export function jpegSize(b) {
  if (!b || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + len;
  }
  return null;
}

export function makePdf(pages, { title = "Scan" } = {}) {
  if (!pages || !pages.length) throw new Error("Keine Seiten");
  const parts = []; const offsets = []; let pos = 0;
  const push = (x) => { const b = typeof x === "string" ? enc(x) : x; parts.push(b); pos += b.length; };
  const obj = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push("\nendobj\n"); };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".replace(/[\u00e2\u00e3\u00cf\u00d3]/g, "")); // Binär-Kennung (vereinfacht)
  const n = pages.length;
  // 1 = Katalog, 2 = Seitenbaum, 3 = Info, dann je Seite: Seite, Inhalt, Bild
  const pageIds = pages.map((_, i) => 4 + i * 3);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  // Titel als UTF-16BE-Hex (<FEFF…>) – so bleiben Umlaute erhalten
  const hex16 = (str) => "<FEFF" + [...String(str).slice(0, 120)].map((ch) => { const c = ch.codePointAt(0); return c > 0xffff ? "003F" : c.toString(16).toUpperCase().padStart(4, "0"); }).join("") + ">";
  obj(3, `<< /Title ${hex16(title)} /Producer (Stempelkarte) >>`);
  pages.forEach((p, i) => {
    const id = pageIds[i], f = fitA4(p.w, p.h);
    const content = `q ${f.dw.toFixed(2)} 0 0 ${f.dh.toFixed(2)} ${f.x.toFixed(2)} ${f.y.toFixed(2)} cm /Im${i} Do Q`;
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f.pw.toFixed(2)} ${f.ph.toFixed(2)}] /Resources << /XObject << /Im${i} ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    obj(id + 1, [`<< /Length ${content.length} >>\nstream\n`, content, "\nendstream"]);
    obj(id + 2, [`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, "\nendstream"]);
  });
  const total = 4 + n * 3;
  const xref = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let o = 0;
  for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}
