// Material-Katalog & -Logik: gemeinsame reine ESM-Datei der Web-App (keine Kopie, damit Katalog und Suche gleich bleiben).
// Wrangler bündelt die Datei beim Veröffentlichen mit; .github/workflows/mcp-deploy.yml reagiert auch auf Änderungen daran.
export * from "../../../js/alltag/material-core.js";
