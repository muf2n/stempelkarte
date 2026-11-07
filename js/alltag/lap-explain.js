// Alltag › LAP › „🤖 Erklär mir das“: fragt Claude im Server-Modus "lehrer" (geduldiger Elektrotechnik-Lehrer,
// keine Werkzeuge, kein Datenzugriff, Sicherheit zuerst). Antworten werden pro Frage zwischengespeichert (nur im Speicher).
//   html(key, payload) → Platzhalter mit Knopf; click(ev) im Klick-Handler des Bereichs aufrufen (true = erledigt).
import { askClaude, aiAvailable } from "./ai-client.js";
import { md } from "./jp-sensei.js";
import { esc } from "../util.js";
import { explainPrompt } from "./lap-core.js";

const safeKey = (k) => String(k).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);

export function createExplainer(L) {
  const cache = new Map();    // key → { state:"busy"|"ok"|"err", text }
  const payloads = new Map(); // key → { topic, q, a, e, picked }
  const ctrls = new Set();

  function inner(key) {
    const c = cache.get(key);
    if (!c) return `<button type="button" class="btn ghost sm lap-ai-btn" data-explain="${key}">🤖 Erklär mir das</button>`;
    if (c.state === "busy") return `<div class="lap-ai-box"><span class="lap-ai-av" aria-hidden="true">🤖</span><div class="lap-typing" aria-label="Claude erklärt"><span></span><span></span><span></span></div></div>`;
    const retry = c.state === "err" ? `<button type="button" class="btn ghost sm" data-explain="${key}">🔁 Nochmal probieren</button>` : "";
    return `<div class="lap-ai-box${c.state === "err" ? " err" : ""}"><span class="lap-ai-av" aria-hidden="true">🤖</span><div class="lap-ai-txt">${c.state === "err" ? `<p>${esc(c.text)}</p>` : md(c.text)}${retry}</div></div>` +
      (c.state === "ok" ? `<p class="lap-ai-safe">🦺 Denk dran: Arbeiten an Anlagen nur nach den 5 Sicherheitsregeln und unter Aufsicht.</p>` : "");
  }
  function update(key) {
    document.querySelectorAll(`.lap-ai[data-aikey="${key}"]`).forEach((w) => { w.innerHTML = inner(key); });
  }
  async function run(key) {
    const p = payloads.get(key);
    if (!p || (cache.get(key) || {}).state === "busy") return;
    if (!aiAvailable()) {
      cache.set(key, { state: "err", text: "Die Erklärung kommt von Claude – dafür brauchst du die Anmeldung mit Google. Im lokalen Modus geht das leider nicht 🙏" });
      update(key); return;
    }
    cache.set(key, { state: "busy" }); update(key);
    const ctrl = new AbortController(); ctrls.add(ctrl);
    try {
      const out = await askClaude([{ role: "user", content: explainPrompt(p) }], { body: { mode: "lehrer" }, timeoutMs: 60000, signal: ctrl.signal });
      cache.set(key, { state: "ok", text: String(out.reply || "").trim() || "Hmm, da kam keine Antwort. Probier's gleich nochmal 🙂" });
    } catch (err) {
      if (err && err.code === "abort") { cache.delete(key); return; }
      cache.set(key, { state: "err", text: "⚠️ " + ((err && err.message) || String(err)) });
    } finally { ctrls.delete(ctrl); }
    update(key);
  }

  return {
    html(key, payload) {
      const k = safeKey(key);
      payloads.set(k, payload);
      return `<div class="lap-ai" data-aikey="${k}">${inner(k)}</div>`;
    },
    click(ev) {
      const b = ev.target.closest("[data-explain]");
      if (!b) return false;
      run(b.dataset.explain);
      return true;
    },
    destroy() { for (const c of ctrls) { try { c.abort(); } catch { /* egal */ } } ctrls.clear(); },
  };
}
