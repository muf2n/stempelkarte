// Update 10: zuletzt gewählte Akzentfarbe sofort setzen (vor dem ersten Bild, ohne Inline-Skript) – siehe js/accent.js.
try {
  var acc = localStorage.getItem("stempelkarte.accent");
  if (acc && acc !== "lila" && /^[a-z]+$/.test(acc)) document.documentElement.setAttribute("data-accent", acc);
} catch (e) { /* egal */ }
// Zahnrad in der Kopfzeile: öffnet die Einstellungs-Zentrale (js/views/settings-hub.js hört auf „sk:open-settings“).
// Solange die App noch nicht eingehängt ist (z. B. Anmeldebildschirm), wie früher zur Übersicht wechseln.
// Bewusst kein Inline-Skript in index.html – die Content-Security-Policy kommt ohne 'unsafe-inline' für Skripte aus.
document.getElementById("btn-settings").addEventListener("click", function () {
  if (document.getElementById("settings-hub")) { window.dispatchEvent(new CustomEvent("sk:open-settings")); return; }
  if (location.hash !== "#uebersicht") location.hash = "#uebersicht";
});
