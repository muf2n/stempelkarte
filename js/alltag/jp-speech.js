// Alltag › Japanisch: Sprachausgabe (speechSynthesis, ja-JP) und Spracherkennung (SpeechRecognition, ja-JP).
// Kein Zugriff auf Daten – nur Browser-APIs. Ohne Unterstützung liefern die Funktionen freundliche Zustände statt Fehler.

const synth = () => { try { return window.speechSynthesis || null; } catch { return null; } };
export const ttsSupported = () => !!(synth() && typeof window.SpeechSynthesisUtterance === "function");

let voice = null;
let voicesLoaded = false;
const waiters = new Set();
function pickVoice() {
  const s = synth();
  if (!s) return null;
  let list = [];
  try { list = s.getVoices() || []; } catch { list = []; }
  if (list.length) voicesLoaded = true;
  const ja = list.filter((v) => /^ja([-_]|$)/i.test(String(v.lang || "")));
  // lokale/natürliche Stimmen bevorzugen
  ja.sort((a, b) => (/natural|google|kyoko|o-ren|nanami/i.test(b.name) ? 1 : 0) - (/natural|google|kyoko|o-ren|nanami/i.test(a.name) ? 1 : 0));
  voice = ja[0] || null;
  return voice;
}
function onVoices() { pickVoice(); for (const f of [...waiters]) f(); }
let listening = false;
function ensureListener() {
  const s = synth();
  if (!s || listening) return;
  listening = true;
  try { s.addEventListener("voiceschanged", onVoices); } catch { /* alte Browser */ }
}

/** → "ok" (japanische Stimme da) | "novoice" (Ausgabe geht, aber keine ja-Stimme gefunden) | "none" (keine Sprachausgabe). Wartet max. ~1,5 s auf die Stimmenliste. */
export function voiceStatus() {
  if (!ttsSupported()) return Promise.resolve("none");
  ensureListener();
  if (pickVoice()) return Promise.resolve("ok");
  return new Promise((res) => {
    const done = () => { clearTimeout(t); waiters.delete(done); res(pickVoice() ? "ok" : "novoice"); };
    const t = setTimeout(done, voicesLoaded ? 50 : 1500);
    waiters.add(done);
  });
}

/** Japanisch vorlesen. rate 0.5–1.3. → Promise (löst auch bei Fehler/Abbruch auf). */
export function speak(text, { rate = 0.9 } = {}) {
  const s = synth();
  if (!s || !ttsSupported() || !text) return Promise.resolve(false);
  ensureListener();
  pickVoice();
  try { s.cancel(); } catch { /* egal */ }
  return new Promise((res) => {
    let u;
    try { u = new window.SpeechSynthesisUtterance(String(text)); } catch { res(false); return; }
    u.lang = "ja-JP";
    if (voice) u.voice = voice;
    u.rate = Math.max(0.4, Math.min(1.5, Number(rate) || 0.9));
    u.pitch = 1;
    const t = setTimeout(() => res(true), 15000);
    u.onend = () => { clearTimeout(t); res(true); };
    u.onerror = () => { clearTimeout(t); res(false); };
    try { s.speak(u); } catch { clearTimeout(t); res(false); }
  });
}
export function stopSpeaking() { const s = synth(); if (s) { try { s.cancel(); } catch { /* egal */ } } }

/* ---------- Spracherkennung ---------- */
const SRClass = () => { try { return window.SpeechRecognition || window.webkitSpeechRecognition || null; } catch { return null; } };
export const srSupported = () => !!SRClass();

/**
 * Einmal zuhören (ja-JP). → { done: Promise<{alts:string[], error?:string}>, stop() }
 * onInterim(text) bekommt Zwischenergebnisse.
 */
export function listenOnce({ onInterim } = {}) {
  const C = SRClass();
  if (!C) return { done: Promise.resolve({ alts: [], error: "unsupported" }), stop() {} };
  let rec;
  try { rec = new C(); } catch { return { done: Promise.resolve({ alts: [], error: "unsupported" }), stop() {} }; }
  rec.lang = "ja-JP";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 5;
  let alts = [], error = null, finished = false;
  const done = new Promise((res) => {
    const finish = () => { if (finished) return; finished = true; clearTimeout(t); res({ alts, ...(error && !alts.length ? { error } : {}) }); };
    const t = setTimeout(() => { try { rec.stop(); } catch { /* egal */ } setTimeout(finish, 600); }, 12000);
    rec.onresult = (ev) => {
      const r = ev.results[ev.results.length - 1] || ev.results[0];
      if (!r) return;
      const list = [];
      for (let i = 0; i < r.length; i++) if (r[i] && r[i].transcript) list.push(String(r[i].transcript));
      if (r.isFinal) { alts = list; try { rec.stop(); } catch { /* egal */ } }
      else if (onInterim && list[0]) onInterim(list[0]);
    };
    rec.onerror = (ev) => { error = (ev && ev.error) || "error"; };
    rec.onend = finish;
    try { rec.start(); } catch { error = "start"; finish(); }
  });
  return { done, stop() { try { rec.stop(); } catch { /* egal */ } } };
}

export const SR_ERRORS = {
  "not-allowed": "Mikrofon ist gesperrt – erlaub es in den Browser-Einstellungen 🎙️",
  "service-not-allowed": "Mikrofon ist gesperrt – erlaub es in den Browser-Einstellungen 🎙️",
  "no-speech": "Ich hab nix gehört – probier's nochmal, ruhig etwas lauter 🙂",
  "audio-capture": "Kein Mikrofon gefunden.",
  "network": "Für die Spracherkennung braucht Chrome Internet.",
  "language-not-supported": "Japanisch wird von der Spracherkennung hier nicht unterstützt.",
};
