// Zahnrad in der Kopfzeile: zur Übersicht wechseln und zum Einstellungs-Panel scrollen (Panel kann erst nach dem Rendern existieren).
// Früher ein Inline-Skript in index.html – ausgelagert, damit die Content-Security-Policy ohne 'unsafe-inline' für Skripte auskommt.
document.getElementById("btn-settings").addEventListener("click", function () {
  if (location.hash !== "#uebersicht") location.hash = "#uebersicht";
  var tries = 0;
  (function go() {
    var p = document.getElementById("settings-panel");
    if (p && p.offsetParent !== null) { p.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (++tries < 30) setTimeout(go, 60);
  })();
});
