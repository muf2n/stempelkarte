// Geld – Teilen (Salden, Ausgleich) und Sparziele: gemeinsame reine ESM-Datei der Web-App – wird von wrangler mitgebündelt.
export { balances, settle, personName, settleSentence, goalPerMonth, ME } from "../../../js/alltag/money-core.js";
// Update 9 – Budget-Warnungen: „Kann ich mir das leisten?“ (leisten_pruefen) – gleiche Rechnung wie in der App.
export { affordCheck, affordText, splitNoteAmount, budgetStatus } from "../../../js/alltag/money-core.js";
