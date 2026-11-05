// Fahrtenbuch & Taggeld: gemeinsame reine ESM-Dateien der Web-App (keine Kopie) – km-Vorrang, Zweck, Fahrzeuge,
// Monatssummen, Kilometergeld, Taggeld-Stufen. Wrangler bündelt sie mit; .github/workflows/mcp-deploy.yml reagiert darauf.
export * from "../../../js/travel.js";
export * from "../../../js/trip-core.js";
