// Update 15 – Übergabe von Dateien zwischen Modulen (z. B. 📸 Erfassen / Teilen → 🔒 Dokumente).
// Nur im Arbeitsspeicher dieser Seite: nichts wird ungefragt gespeichert. Die Zielseite holt die Datei mit take() ab.
let pending = null;
/** Datei für ein Ziel ablegen: target z. B. "dokumente". */
export function put(target, file) { pending = { target, file, at: Date.now() }; }
/** Liegt etwas für dieses Ziel bereit (max. 10 Minuten alt)? */
export function peek(target) { return pending && pending.target === target && Date.now() - pending.at < 600000 ? pending.file : null; }
export function take(target) { const f = peek(target); if (f) pending = null; return f; }
export function clear() { pending = null; }
