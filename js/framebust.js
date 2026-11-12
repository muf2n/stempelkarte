// Schutz gegen Clickjacking: Die App darf nicht in einem fremden Rahmen (iframe) laufen.
// GitHub Pages erlaubt keine eigenen Header (X-Frame-Options / CSP frame-ancestors), daher hier im Skript.
(function () {
  try {
    if (window.top === window.self) return;
  } catch (_) { /* fremder Rahmen → Zugriff verweigert → erst recht blockieren */ }
  document.documentElement.style.display = "none";
  try { window.top.location = window.self.location.href; } catch (_) { /* Rahmen erlaubt keine Umleitung → bleibt leer */ }
})();
