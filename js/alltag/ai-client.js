// Gemeinsamer Zugang zum eigenen Claude-Server (tools/mcp, Endpunkt POST <server>/chat).
// Genutzt vom Claude-Assistenten (assistant.js) und vom Lernplaner (school-planner.js).
//
//   const { reply, actions, usage } = await askClaude([{ role: "user", content: "…" }], { timeoutMs: 60000 });
//
// Fehler werden als Error mit deutscher Meldung geworfen; err.code = "local" | "auth" | "network" | "timeout" | "http".
// Test-Haken (nur auf localhost): window.__skAiTest = { token: "x", url?: "http://localhost:…" } überspringt die
// Firebase-Anmeldung, damit Playwright /chat abfangen kann.
import * as store from "../store.js";
import { getFirebase } from "../firebase.js";

export const URL_KEY = "stempelkarte.ai.url";
export const DEFAULT_URL = "https://stempelkarte-mcp.lippa-florian.workers.dev";

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

/** Test-Haken – nur auf localhost wirksam. */
function testHook() {
  try {
    const h = location.hostname;
    if (h !== "localhost" && h !== "127.0.0.1") return null;
    const t = window.__skAiTest;
    return t && typeof t === "object" ? t : null;
  } catch { return null; }
}

export function serverUrl(snap = store.get()) {
  const hook = testHook();
  const s = (hook && hook.url) || (snap && snap.settings && snap.settings.ai && snap.settings.ai.url) || lsGet(URL_KEY) || DEFAULT_URL;
  return String(s).replace(/\/+$/, "").replace(/\/(mcp|chat)$/, "");
}

/** Kann Claude grundsätzlich gefragt werden? (Cloud-Anmeldung nötig – im lokalen Modus nicht.) */
export function aiAvailable(snap = store.get()) {
  if (testHook()) return true;
  return !!(snap && snap.mode && snap.mode !== "local");
}

function fail(code, msg) { const e = new Error(msg); e.code = code; return e; }

/** Firebase-ID-Token für eigene Server-Endpunkte (z. B. /ics). Test-Haken wie askClaude. → String oder wirft (code local|auth). */
export async function idToken(snap = store.get()) {
  const hook = testHook();
  if (hook) return String(hook.token || "test");
  if (!aiAvailable(snap)) throw fail("local", "Nur mit Google-Anmeldung möglich – im lokalen Modus geht das nicht.");
  const f = await getFirebase();
  const u = f && f.auth.currentUser;
  if (!u) throw fail("auth", "Bitte zuerst mit Google anmelden.");
  return u.getIdToken();
}

const STATUS_MSG = {
  401: "Anmeldung abgelehnt – bitte ab- und wieder anmelden.",
  503: "Der Server ist noch nicht fertig eingerichtet (Claude-Schlüssel fehlt).",
  502: "Claude ist gerade nicht erreichbar. Bitte gleich nochmal probieren.",
};

/**
 * Schickt einen Verlauf an den Claude-Server.
 * @param {{role:"user"|"assistant", content:string}[]} messages
 * @param {{timeoutMs?:number, signal?:AbortSignal, body?:object}} [opts]
 *   opts.body: zusätzliche Felder für den /chat-Body (z. B. { mode: "voice", short: true, assistantName: "Jarvis" });
 *   messages kann darüber nicht überschrieben werden.
 * @returns {Promise<{reply:string, actions:string[], usage:object|null, data:object|null}>}
 */
export async function askClaude(messages, opts = {}) {
  const snap = store.get();
  const hook = testHook();
  if (!aiAvailable(snap)) throw fail("local", "Claude braucht die Anmeldung mit Google – im lokalen Modus geht das nicht.");
  let token;
  if (hook) token = String(hook.token || "test");
  else {
    const f = await getFirebase();
    const u = f && f.auth.currentUser;
    if (!u) throw fail("auth", "Bitte zuerst mit Google anmelden.");
    token = await u.getIdToken();
  }
  const ctrl = new AbortController();
  let timedOut = false;
  const tm = opts.timeoutMs ? setTimeout(() => { timedOut = true; ctrl.abort(); }, opts.timeoutMs) : null;
  const onAbort = () => ctrl.abort();
  if (opts.signal) { if (opts.signal.aborted) ctrl.abort(); else opts.signal.addEventListener("abort", onAbort, { once: true }); }
  let res;
  try {
    res = await fetch(serverUrl(snap) + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        ...(opts.body && typeof opts.body === "object" ? opts.body : {}),
        messages: (messages || []).map((m) => ({ role: m.role, content: String(m.content || "") })),
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (timedOut) throw fail("timeout", "Claude hat zu lange gebraucht. Bitte nochmal probieren.");
    if (err && err.name === "AbortError") throw fail("abort", "Abgebrochen.");
    throw fail("network", "Server nicht erreichbar. Ist er schon eingerichtet und bist du online?");
  } finally {
    if (tm) clearTimeout(tm);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) throw fail("http", (data && (data.reply || data.error)) || STATUS_MSG[res.status] || "Fehler " + res.status);
  return {
    reply: String((data && data.reply) || "(keine Antwort)"),
    actions: (data && Array.isArray(data.actions) && data.actions) || [],
    usage: (data && data.usage) || null,
    data,
  };
}
