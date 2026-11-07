// Update 10 F – POST /auth/revoke: „Überall abmelden“.
// Prüft das Firebase-ID-Token (Signatur, Projekt, Besitzer-E-Mail wie /chat) und setzt per Identity Toolkit
// (accounts:update, validSince = jetzt) alle Refresh-Tokens des Kontos ungültig → jedes Gerät muss sich neu anmelden.
// Bereits ausgestellte ID-Tokens laufen spätestens nach einer Stunde ab. Nie Tokens oder Inhalte protokollieren.
import { loadAccount, getAccessToken, DEFAULT_PROJECT, DEFAULT_EMAIL } from "./google.js";
import { verifyIdToken, allowedOrigin, corsHeaders } from "./chat.js";

export const IDTK = "https://identitytoolkit.googleapis.com/v1";

export async function handleAuth(request, env, { fetchImpl = (...a) => fetch(...a), now = Date.now() } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const origin = request.headers.get("origin");
  const cors = { ...corsHeaders(origin, env) };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors } });
  if (path !== "/auth/revoke") return json(404, { error: "Nicht gefunden." });
  if (request.method === "OPTIONS") return new Response(null, { status: allowedOrigin(origin, env) ? 204 : 403, headers: cors });
  if (request.method !== "POST") return json(405, { error: "Nur POST ist erlaubt." });
  if (origin && !allowedOrigin(origin, env)) return json(403, { error: "Herkunft nicht erlaubt." });

  let acc;
  try { acc = loadAccount(env.FIREBASE_SERVICE_ACCOUNT); } catch { return json(503, { error: "Server noch nicht eingerichtet (Dienstkonto fehlt)." }); }
  const projectId = String(env.FIREBASE_PROJECT_ID || acc.project_id || DEFAULT_PROJECT);
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get("authorization") || "").trim());
  if (!m) return json(401, { error: "Bitte anmelden." });
  let who;
  try {
    who = await verifyIdToken(m[1].trim(), { projectId, email: env.STEMPEL_EMAIL || DEFAULT_EMAIL, fetchImpl, now });
  } catch {
    return json(401, { error: "Anmeldung ungültig oder abgelaufen – bitte neu laden." });
  }
  let token;
  try { token = await getAccessToken(acc, fetchImpl, now); } catch { return json(502, { error: "Google-Anmeldung des Servers fehlgeschlagen." }); }
  const validSince = String(Math.floor(now / 1000));
  let res;
  try {
    res = await fetchImpl(`${IDTK}/projects/${encodeURIComponent(projectId)}/accounts:update`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ localId: who.uid, validSince }),
    });
  } catch { return json(502, { error: "Google nicht erreichbar – bitte später nochmal." }); }
  if (!res.ok) return json(502, { error: `Abmelden auf allen Geräten hat nicht geklappt (Google ${res.status}).` });
  return json(200, { ok: true, validSince: Number(validSince) });
}
