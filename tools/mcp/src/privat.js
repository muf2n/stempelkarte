// Privat / Arbeit (Update 9): gemeinsame reine ESM-Datei der Web-App (keine Kopie, gleiche Regeln wie App und Erinnerungen).
// Wrangler bündelt die Datei beim Veröffentlichen mit; .github/workflows/mcp-deploy.yml reagiert auch auf Änderungen daran.
export * from "../../../js/privat-core.js";
