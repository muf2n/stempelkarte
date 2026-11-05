// Geld – Teilen (Salden, Ausgleich) und Sparziele: gemeinsame reine ESM-Datei der Web-App – wird von wrangler mitgebündelt.
export { balances, settle, personName, settleSentence, goalPerMonth, ME } from "../../../js/alltag/money-core.js";
// Update 9 – Sparziele: echtes Konto, Spar-Erinnerung, Aufrunden
export { goalCurrent, goalLinked, goalAccount, accountBalance, accountFree, monthlyInflow, monthsToGoal, reminderDue, reminderMessage, goalReminder, detectPayday, roundUpWeek, roundupSettings, eur as eurCore } from "../../../js/alltag/money-core.js";
