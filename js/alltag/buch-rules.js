// Update 10 – 💼 Buchhaltung: österreichische Kennzahlen an EINER Stelle (zum leichten Aktualisieren).
// Jeder Wert hat Quelle (offizielle Seite) + Prüfdatum. Das ist eine Gedächtnisstütze für die Aufzeichnungen –
// KEINE Rechts- oder Steuerberatung. Bei Änderungen: Wert + „checked“ + ggf. Quelle anpassen, Tests laufen lassen.

export const RULES_CHECKED = "2026-11-08";

const USP_KU = "https://www.usp.gv.at/aktuelles/newsliste/kleinunternehmerregelung-ab-2025.html";
const WKO_KU = "https://www.wko.at/steuern/kleinunternehmerregelung-umsatzsteuer";
const USP_RATES = "https://www.usp.gv.at/steuern-finanzen/umsatzsteuer-ueberblick/steuersaetze-und-steuerbefreiungen-der-umsatzsteuer.html";
const USP_49 = "https://www.usp.gv.at/aktuelles/newsliste/neuer_ustsatz.html";
const USP_INV = "https://www.usp.gv.at/steuern-finanzen/umsatzsteuer-ueberblick/rechnung.html";
const WKO_INV = "https://www.wko.at/steuern/rechnung-richtig-ausstellen";
const USP_KEEP = "https://www.usp.gv.at/steuern-finanzen/steuerliche-gewinnermittlung/weitere-informationen-zur-steuerlichen-gewinnermittlung/betriebliches-rechnungswesen/aufbewahrungspflicht.html";
const USP_EAR = "https://www.usp.gv.at/steuern-finanzen/steuerliche-gewinnermittlung/einnahmen-ausgaben-rechnung.html";
const USP_GWG = "https://www.usp.gv.at/steuern-finanzen/steuerliche-gewinnermittlung/weitere-informationen-zur-steuerlichen-gewinnermittlung/betriebseinnahmen-und-ausgaben/geringwertige-wirtschaftsgueter.html";

export const RULES = Object.freeze({
  /** Kleinunternehmerregelung: Umsatzgrenze brutto pro Kalenderjahr (seit 1.1.2025), Toleranz 10 % bis Jahresende. */
  kuLimit: { value: 55000, since: "2025-01-01", source: USP_KU, checked: RULES_CHECKED,
    text: "Kleinunternehmerregelung: Umsatzgrenze 55.000 € brutto pro Jahr (seit 2025 Brutto-Grenze, vorher netto)." },
  kuTolerancePct: { value: 10, source: USP_KU, checked: RULES_CHECKED,
    text: "Überschreitest du die Grenze um höchstens 10 % (bis 60.500 €), darfst du bis Jahresende noch ohne USt fakturieren – ab dem Folgejahr bist du steuerpflichtig. Darüber sind alle weiteren Umsätze sofort steuerpflichtig." },
  kuHint: { value: "Umsatzsteuerfrei aufgrund der Kleinunternehmerregelung.", source: WKO_KU, checked: RULES_CHECKED,
    text: "Hinweis auf der Rechnung (Formulierungsvorschlag der WKO; ein fixer Wortlaut ist nicht vorgeschrieben)." },
  /** USt-Sätze in Prozent. 4,9 % seit 1.7.2026 nur für ausgewählte Grundnahrungsmittel (Anlage 3 UStG). */
  vatRates: { value: [20, 13, 10, 4.9, 0], source: USP_RATES, checked: RULES_CHECKED,
    text: "20 % Normalsteuersatz · 13 % z. B. Pflanzen, Brennholz, Künstler, Sport-Eintritte · 10 % z. B. Lebensmittel, Bücher, Wohnungsmiete, Beherbergung · 4,9 % seit 1.7.2026 für ausgewählte Grundnahrungsmittel · 0 % = steuerfrei / Kleinunternehmer." },
  vatRate49: { value: 4.9, since: "2026-07-01", source: USP_49, checked: RULES_CHECKED,
    text: "Neuer ermäßigter Satz 4,9 % seit 1. Juli 2026 – nur für bestimmte Grundnahrungsmittel (nicht in der Gastronomie)." },
  /** Kleinbetragsrechnung: Gesamtbetrag inkl. USt bis … € → vereinfachte Angaben. */
  smallInvoice: { value: 400, source: USP_INV, checked: RULES_CHECKED,
    text: "Kleinbetragsrechnung bis 400 € brutto: Name/Anschrift des Empfängers, fortlaufende Nummer und eigener Steuerbetrag dürfen fehlen – Bruttobetrag + Steuersatz genügen." },
  /** Über diesem Bruttobetrag braucht's die UID des Empfängers (wenn an ein Unternehmen). */
  bigInvoice: { value: 10000, source: USP_INV, checked: RULES_CHECKED,
    text: "Rechnungen über 10.000 € brutto an andere Unternehmen: zusätzlich die UID-Nummer des Empfängers." },
  invoiceFields: { value: [
    "Name und Anschrift des Ausstellers", "Name und Anschrift des Empfängers", "Menge und handelsübliche Bezeichnung bzw. Art und Umfang der Leistung",
    "Tag oder Zeitraum der Lieferung/Leistung", "Entgelt (netto) und Steuersatz bzw. Hinweis auf Steuerbefreiung", "Steuerbetrag",
    "Ausstellungsdatum", "Fortlaufende Rechnungsnummer", "UID-Nummer des Ausstellers", "UID des Empfängers (über 10.000 € brutto, an Unternehmen)",
  ], source: WKO_INV, checked: RULES_CHECKED, text: "Pflichtangaben auf Rechnungen über 400 € (WKO, Stand 01.04.2025)." },
  /** Aufbewahrungspflicht in Jahren (ab Ende des Kalenderjahres). */
  keepYears: { value: 7, source: USP_KEEP, checked: RULES_CHECKED,
    text: "Bücher, Aufzeichnungen und Belege 7 Jahre aufbewahren – gezählt ab dem Ende des Kalenderjahres (bei Grundstücken teils 12 bzw. 22 Jahre, bei offenen Verfahren länger)." },
  /** Einnahmen-Ausgaben-Rechnung: Zufluss-Abfluss-Prinzip. */
  ear: { value: "Zufluss-Abfluss", source: USP_EAR, checked: RULES_CHECKED,
    text: "E/A-Rechnung: Einnahmen zählen, wenn das Geld da ist (bar oder Gutschrift), Ausgaben, wenn es abfließt – entscheidend ist das Zahlungsdatum. Ausnahme z. B. Abschreibung (AfA) von Anlagen. USt im Nettosystem als durchlaufender Posten; Kleinunternehmer ohne USt: Bruttosystem." },
  /** Geringwertige Wirtschaftsgüter: Sofortabschreibung bis … € (netto mit Vorsteuerabzug, brutto als Kleinunternehmer). */
  gwgLimit: { value: 1000, since: "2023-01-01", source: USP_GWG, checked: RULES_CHECKED,
    text: "Geringwertige Wirtschaftsgüter bis 1.000 € (seit 2023; mit Vorsteuerabzug netto, als Kleinunternehmer brutto) können sofort voll abgesetzt werden." },
});

/** Wert lesen (z. B. rule("kuLimit") → 55000). */
export const rule = (k) => (RULES[k] ? RULES[k].value : undefined);

/** Für die „ℹ️ Gut zu wissen“-Seite: [{ key, title, text, source, checked }] */
export const INFO = [
  ["kuLimit", "🏷️ Kleinunternehmerregelung"], ["kuTolerancePct", "📈 Toleranz 10 %"], ["kuHint", "🧾 Hinweis auf der Rechnung"],
  ["vatRates", "💶 Umsatzsteuersätze"], ["vatRate49", "🥖 4,9 % für Grundnahrungsmittel"],
  ["invoiceFields", "✅ Pflichtangaben auf Rechnungen"], ["smallInvoice", "🪙 Kleinbetragsrechnung"], ["bigInvoice", "🏢 Über 10.000 €"],
  ["ear", "📒 Einnahmen-Ausgaben-Rechnung"], ["gwgLimit", "🧰 Geringwertige Wirtschaftsgüter"], ["keepYears", "🗄️ Aufbewahrungspflicht"],
].map(([key, title]) => ({ key, title, ...RULES[key] }));
