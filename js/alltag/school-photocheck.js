// 📷 Rechenweg auf Papier → Foto → Claude prüft. Das Foto bleibt nur im Arbeitsspeicher und wird danach verworfen (nie gespeichert).
import { esc } from "./school-core.js";
import { askClaude, aiAvailable } from "./ai-client.js";
import { shrinkImage } from "./unterwegs-shared.js";

export const photoBtnHTML = () => `<button type="button" class="btn sm pc-btn" data-x="photo">📷 Rechenweg fotografieren</button>`;

function pickPhoto() {
  return new Promise((res) => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.setAttribute("capture", "environment"); inp.addEventListener("change", () => { const f = (inp.files && inp.files[0]) || null; inp.value = ""; res(f); }, { once: true }); inp.click(); });
}
/** Antwort-JSON lesen */
export function parseCheck(reply) {
  const s = String(reply || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  let j = null; if (a >= 0 && b > a) try { j = JSON.parse(s.slice(a, b + 1)); } catch { j = null; }
  if (!j) return null;
  const t = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
  return { result: t(j.result, 40), unit: t(j.unit, 16), readable: j.readable !== false && !!t(j.result, 40), stepsOk: j.steps_ok === true,
    feedback: t(j.feedback, 400), fehler: (Array.isArray(j.fehler) ? j.fehler : []).map((x) => t(x, 160)).filter(Boolean).slice(0, 5) };
}
/**
 * Foto aufnehmen und prüfen lassen.
 * info: { text (Aufgabe + gegebene Werte), unit (erwartete Einheit), solution (richtiger Rechenweg), check(raw) → bool }
 * box: Element für Status/Rückmeldung. Gibt { ok, res } zurück oder null (abgebrochen/Fehler).
 */
export async function photoCheck(ui, info, box) {
  if (!aiAvailable()) { ui.toast("📷 Prüfen per Foto geht mit der Google-Anmeldung und dem Claude-Server. Tipp das Ergebnis einfach ein.", 4200); return null; }
  const file = await pickPhoto(); if (!file) return null;
  let img = null;
  try { img = await shrinkImage(file, { maxSide: 1600, maxBytes: 800 * 1024, quality: 0.85 }); } catch (e) { ui.toast(e.message || "Foto geht nicht."); return null; }
  box.innerHTML = `<p class="pc-wait">⏳ Claude schaut sich deinen Rechenweg an … (ca. 10–25 s)</p>`;
  let r = null;
  try {
    const msg = `Aufgabe: ${info.text}\nGesucht in: ${info.unit || "(ohne Einheit)"}\nRichtiger Rechenweg und Lösung:\n${info.solution}`;
    const out = await askClaude([{ role: "user", content: msg }], { body: { mode: "pruefen", image: { type: "image/jpeg", data: img.data.replace(/^data:[^,]*,/, "") } }, timeoutMs: 120000 });
    r = parseCheck(out.reply);
  } catch (e) { box.innerHTML = ""; ui.toast(e.message || "Prüfen hat nicht geklappt.", 3600); return null; }
  finally { img = null; } // Foto verwerfen – wird nirgends gespeichert
  if (!r) { box.innerHTML = ""; ui.toast("Claude konnte das Foto nicht auswerten – probier's nochmal oder tipp das Ergebnis ein.", 4000); return null; }
  if (!r.readable) { box.innerHTML = `<p class="pc-wait">🤔 Ich kann kein Ergebnis erkennen. Schreib es deutlich hin (z. B. „I = 4,9 A“) und fotografier nochmal – oder tipp es ein.</p>`; return null; }
  const ok = info.check(r.result, r.unit); // Endergebnis prüft die App selbst – nicht die KI
  return { ok, res: r, html: `<div class="pc-res"><p>📷 Gelesen: <b>${esc(r.result)} ${esc(r.unit)}</b></p>
    ${r.feedback ? `<p>🧑‍🏫 ${esc(r.feedback)}</p>` : ""}
    ${r.fehler.length ? `<ul class="pc-err">${r.fehler.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    ${ok && !r.stepsOk ? `<p class="note">Ergebnis stimmt – aber schau dir den Rechenweg nochmal an.</p>` : ""}
    <p class="note">🗑 Dein Foto wurde nicht gespeichert.</p></div>` };
}
