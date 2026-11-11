// Update 15 – 📸 Erfassen: Was ist ein gescannter Code? → Art + passende Aktionen (reine Logik, kein DOM).
// Sicherheit: Gescannte Inhalte lösen NIE automatisch etwas aus – es werden nur Knöpfe angeboten.
// App-eigene Links (QR-Sticker von Werkzeug/Baustelle) öffnen nur einen Bereich innerhalb der App.

const s = (v) => (v == null ? "" : String(v)).trim();

/** GTIN/EAN-Prüfziffer (EAN-8, UPC-A 12, EAN-13, GTIN-14). */
export function validGtin(code) {
  const c = s(code);
  if (!/^\d{8}$|^\d{12,14}$/.test(c)) return false;
  const d = c.split("").map(Number), check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

/** App-Hash aus einem Link, wenn er zu dieser App gehört (gleicher Ursprung+Pfad oder github.io/stempelkarte). */
export function appHash(text, appBase) {
  const t = s(text);
  const i = t.indexOf("#");
  if (i < 0) return null;
  const base = t.slice(0, i).replace(/[?].*$/, ""), hash = t.slice(i);
  const ours = (appBase && base === s(appBase).replace(/[?#].*$/, "")) || /^https:\/\/muf2n\.github\.io\/stempelkarte\/?(index\.html)?$/.test(base) || base === "";
  if (!ours) return null;
  return /^#[a-z]+(\/[A-Za-z0-9_%.\-/]*)?$/.test(hash) ? hash : null;
}

/**
 * Gescannten Text einordnen. → { kind, label, value, hash?, url?, actions: [id] }
 * kind: app | gtin | url | tel | mail | wifi | text
 */
export function classify(raw, { appBase = "", format = "" } = {}) {
  const t = s(raw).slice(0, 2000);
  if (!t) return null;
  const h = appHash(t, appBase);
  if (h) {
    const what = /^#alltag\/werkzeug\//.test(h) ? "🧰 Werkzeug" : /^#baustelle|^#site|^#orte/.test(h) ? "🏗️ Baustelle" : "📱 Bereich der App";
    return { kind: "app", label: what, value: t, hash: h, actions: ["open"] };
  }
  if (/^\d{8,14}$/.test(t) && (validGtin(t) || /ean|upc/i.test(format))) return { kind: "gtin", label: "🏷️ Produkt-Strichcode", value: t, actions: ["vorrat", "einkauf", "material", "lookup", "copy"] };
  if (/^https?:\/\/\S+$/i.test(t)) return { kind: "url", label: "🔗 Link", value: t, url: t, actions: ["openurl", "copy"] };
  if (/^tel:/i.test(t)) return { kind: "tel", label: "📞 Telefonnummer", value: t.replace(/^tel:/i, ""), url: t, actions: ["openurl", "copy"] };
  if (/^mailto:/i.test(t)) return { kind: "mail", label: "✉️ E-Mail", value: t.replace(/^mailto:/i, "").split("?")[0], url: t, actions: ["openurl", "copy"] };
  if (/^WIFI:/i.test(t)) {
    const ssid = (/S:((?:\\.|[^;])*)/.exec(t) || [])[1] || "";
    const pass = (/P:((?:\\.|[^;])*)/.exec(t) || [])[1] || "";
    return { kind: "wifi", label: "📶 WLAN", value: ssid.replace(/\\(.)/g, "$1"), secret: pass.replace(/\\(.)/g, "$1"), actions: ["copypass"] };
  }
  return { kind: "text", label: "📝 Text", value: t, actions: ["note", "einkauf", "copy"] };
}

/** Name aus einer Open-Food-Facts-Antwort (v2) → "Marke Produkt (Menge)" oder "". */
export function offName(json) {
  const p = json && json.product;
  if (!p) return "";
  const name = s(p.product_name_de || p.product_name || p.generic_name_de || p.generic_name);
  const brand = s(p.brands).split(",")[0].trim();
  const qty = s(p.quantity);
  return [brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : "", name].filter(Boolean).join(" ").slice(0, 60) + (qty ? ` (${qty.slice(0, 15)})` : "");
}

/** Einkaufslisten-Einträge aus einem Text (eine Zeile = ein Eintrag, Aufzählungszeichen weg). */
export function linesToItems(text) {
  return s(text).split(/\r?\n|,(?=\s*\D)/).map((l) => l.replace(/^[-•*·☐☑\d.)\s]+/, "").trim()).filter((l) => l.length >= 2).slice(0, 40).map((l) => l.slice(0, 80));
}
