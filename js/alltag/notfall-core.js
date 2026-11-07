// Update 10 – 🆘 Notfallkarte: reine Logik ohne DOM (Node-testbar, test/notfall-core.test.mjs).
// Sammlung „notfall“, ein Dokument mit id "card":
//   { blood, allergies, meds, conditions, contacts: [{ name, rel, phone }], insurance: { name, number }, notes, claudeAllowed }
// Datenschutz: Der Assistent liest die Karte nur, wenn claudeAllowed === true (Standard: aus).
// Wird auch vom Server (tools/mcp/src/memory.js → notfallkarte_lesen) verwendet.

const s = (v) => (v == null ? "" : String(v).trim());
export const CARD_ID = "card";
export const BLOOD = ["", "0+", "0−", "A+", "A−", "B+", "B−", "AB+", "AB−", "unbekannt"];
export const MAX_CONTACTS = 5;

/** Telefonnummer → nur Ziffern und führendes +, sonst "" (für tel:-Links). */
export function telDigits(phone) {
  const t = s(phone).replace(/^00/, "+");
  const plus = t.startsWith("+");
  const d = t.replace(/\D/g, "");
  return d.length >= 3 && d.length <= 20 ? (plus ? "+" : "") + d : "";
}
export const telHref = (phone) => { const d = telDigits(phone); return d ? "tel:" + d : ""; };

export function normCard(x = {}) {
  const c = x && typeof x === "object" ? x : {};
  const contacts = Array.isArray(c.contacts) ? c.contacts.map((k) => ({ name: s(k && k.name).slice(0, 60), rel: s(k && k.rel).slice(0, 40), phone: s(k && k.phone).slice(0, 30) }))
    .filter((k) => k.name || k.phone).slice(0, MAX_CONTACTS) : [];
  const ins = c.insurance && typeof c.insurance === "object" ? c.insurance : {};
  const blood = BLOOD.includes(s(c.blood)) ? s(c.blood) : s(c.blood).replace(/-/g, "−").slice(0, 12);
  return {
    ...c, id: CARD_ID,
    blood: BLOOD.includes(blood) ? blood : "",
    allergies: s(c.allergies).slice(0, 600), meds: s(c.meds).slice(0, 800), conditions: s(c.conditions).slice(0, 800),
    contacts, insurance: { name: s(ins.name).slice(0, 60), number: s(ins.number).slice(0, 40) },
    notes: s(c.notes).slice(0, 800), claudeAllowed: c.claudeAllowed === true,
  };
}

/** Ist überhaupt etwas eingetragen? */
export function isEmpty(card) {
  const c = normCard(card);
  return !c.blood && !c.allergies && !c.meds && !c.conditions && !c.contacts.length && !c.insurance.name && !c.insurance.number && !c.notes;
}

/** Textfassung (für den Assistenten nach Freigabe bzw. zum Teilen). */
export function cardText(card) {
  const c = normCard(card);
  const out = ["🆘 Notfallkarte"];
  if (c.blood) out.push(`Blutgruppe: ${c.blood}`);
  if (c.allergies) out.push(`Allergien: ${c.allergies}`);
  if (c.meds) out.push(`Medikamente: ${c.meds}`);
  if (c.conditions) out.push(`Vorerkrankungen: ${c.conditions}`);
  if (c.insurance.name || c.insurance.number) out.push(`Krankenkasse: ${[c.insurance.name, c.insurance.number && `Nr. ${c.insurance.number}`].filter(Boolean).join(", ")}`);
  if (c.contacts.length) {
    out.push("Notfallkontakte:");
    for (const k of c.contacts) out.push(`- ${[k.name, k.rel && `(${k.rel})`].filter(Boolean).join(" ")}${k.phone ? `: ${k.phone}` : ""}`);
  }
  if (c.notes) out.push(`Hinweise: ${c.notes}`);
  return out.join("\n");
}
