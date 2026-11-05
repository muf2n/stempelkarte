// GET /ics?id=<feedId> – iCal-Abo (z. B. Google „Privatadresse im iCal-Format“) serverseitig abholen.
// Die Feed-Adresse steht NUR in Firestore (users/{uid}/meta/ical_feeds = {feeds:[{id, name, color, url, visible}]})
// und wird nie aus der Anfrage übernommen → kein offener Proxy. Anmeldung mit Firebase-ID-Token wie /chat.
// Zwischenspeicher 10 Min. (caches.default, sonst Speicher). Keine Inhalte/Adressen protokollieren.
import { verifyIdToken, corsHeaders, allowedOrigin } from "./chat.js";
import { loadAccount, getAccessToken, DEFAULT_PROJECT, DEFAULT_EMAIL } from "./google.js";
import { Firestore } from "./firestore.js";

export const ICS_TIMEOUT_MS = 10_000;
export const ICS_MAX_BYTES = 2 * 1024 * 1024;
export const ICS_CACHE_MS = 10 * 60 * 1000;
const FRESH_MIN_MS = 60 * 1000; // ?fresh=1 frühestens nach 1 Min. wirklich neu holen
const CACHE_HOST = "https://ics-cache.stempelkarte.invalid/";

const mem = new Map(); // key → {at, body}
export function clearIcsCache() { mem.clear(); }

/** Erlaubte Feed-Adresse? https, kein Login/Port-Trick, Host calendar.google.com oder Pfad endet auf .ics. */
export function feedUrlOk(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[")) return false; // keine IP-Adressen
  if (h === "calendar.google.com") return /^\/calendar\/ical\//.test(u.pathname);
  return /\.ics$/i.test(u.pathname);
}

function icsCors(origin, env) {
  const h = corsHeaders(origin, env);
  if (h["access-control-allow-origin"]) {
    h["access-control-allow-methods"] = "GET, OPTIONS";
    h["access-control-expose-headers"] = "x-ics-fetched-at, x-ics-cache";
  }
  return h;
}

async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

class IcsError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/** Feed holen: Weiterleitungen selbst verfolgen (jede Zieladresse erneut prüfen), Zeit- und Größenlimit. */
export async function fetchFeed(url, fetchImpl, { timeoutMs = ICS_TIMEOUT_MS, maxBytes = ICS_MAX_BYTES } = {}) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let cur = url;
    let res;
    for (let hop = 0; hop < 4; hop++) {
      if (!feedUrlOk(cur)) throw new IcsError(422, "Die Kalender-Adresse ist nicht erlaubt.");
      try {
        res = await fetchImpl(cur, { method: "GET", redirect: "manual", signal: ctrl.signal, headers: { accept: "text/calendar, text/plain;q=0.8, */*;q=0.1", "user-agent": "Stempelkarte-ICS/1.0" } });
      } catch (e) {
        if (ctrl.signal.aborted) throw new IcsError(504, "Der Kalender hat zu lange gebraucht (über 10 s).");
        throw new IcsError(502, "Der Kalender ist gerade nicht erreichbar.");
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        cur = new URL(res.headers.get("location"), cur).toString();
        continue;
      }
      break;
    }
    if (res.status >= 300 && res.status < 400) throw new IcsError(502, "Zu viele Weiterleitungen.");
    if (res.status === 404 || res.status === 401 || res.status === 403 || res.status === 410) {
      throw new IcsError(502, `Der Kalender hat die Adresse abgelehnt (${res.status}). Ist der Link noch gültig? Bei Google ggf. neu kopieren.`);
    }
    if (!res.ok) throw new IcsError(502, `Der Kalender antwortet gerade nicht (HTTP ${res.status}).`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > maxBytes) throw new IcsError(413, "Der Kalender ist zu groß (über 2 MB).");
    let text = "";
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let n = 0;
      for (;;) {
        let chunk;
        try { chunk = await reader.read(); }
        catch { throw ctrl.signal.aborted ? new IcsError(504, "Der Kalender hat zu lange gebraucht (über 10 s).") : new IcsError(502, "Übertragung abgebrochen."); }
        if (chunk.done) break;
        n += chunk.value.byteLength;
        if (n > maxBytes) { try { await reader.cancel(); } catch { /* egal */ } throw new IcsError(413, "Der Kalender ist zu groß (über 2 MB)."); }
        text += dec.decode(chunk.value, { stream: true });
      }
      text += dec.decode();
    } else {
      text = await res.text();
      if (new TextEncoder().encode(text).length > maxBytes) throw new IcsError(413, "Der Kalender ist zu groß (über 2 MB).");
    }
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) throw new IcsError(422, "Unter dieser Adresse liegt kein Kalender (kein iCal-Format).");
    return text;
  } finally {
    clearTimeout(tm);
  }
}

function cacheApi() {
  try { return typeof caches !== "undefined" && caches.default ? caches.default : null; } catch { return null; }
}

/** HTTP-Handler für GET /ics?id=… */
export async function handleIcs(request, env, { fetchImpl = (...a) => fetch(...a), now = Date.now() } = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const cors = icsCors(origin, env);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors } });
  if (request.method === "OPTIONS") return new Response(null, { status: allowedOrigin(origin, env) ? 204 : 403, headers: cors });
  if (request.method !== "GET") return json(405, { error: "Nur GET ist erlaubt." });
  if (origin && !allowedOrigin(origin, env)) return json(403, { error: "Herkunft nicht erlaubt." });
  const id = String(url.searchParams.get("id") || "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return json(400, { error: "id fehlt oder ist ungültig." });

  let acc;
  try { acc = loadAccount(env.FIREBASE_SERVICE_ACCOUNT); } catch { return json(503, { error: "Der Server ist noch nicht eingerichtet (Dienstkonto fehlt)." }); }
  const projectId = String(env.FIREBASE_PROJECT_ID || acc.project_id || DEFAULT_PROJECT);
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get("authorization") || "").trim());
  if (!m) return json(401, { error: "Bitte anmelden." });
  let uid;
  try { uid = (await verifyIdToken(m[1].trim(), { projectId, email: env.STEMPEL_EMAIL || DEFAULT_EMAIL, fetchImpl, now })).uid; }
  catch { return json(401, { error: "Anmeldung ungültig oder abgelaufen – bitte neu laden." }); }

  try {
    const fs = new Firestore({ projectId, getToken: () => getAccessToken(acc, fetchImpl, now), fetchImpl });
    const doc = await fs.get(`users/${uid}/meta/ical_feeds`);
    const feeds = doc && Array.isArray(doc.data.feeds) ? doc.data.feeds : [];
    const feed = feeds.find((f) => f && f.id === id);
    if (!feed || !feed.url) return json(404, { error: "Diesen Kalender-Link gibt es nicht (mehr)." });
    if (!feedUrlOk(feed.url)) return json(422, { error: "Die gespeicherte Kalender-Adresse ist nicht erlaubt." });

    const key = `${uid}|${id}|${await sha(feed.url)}`;
    const fresh = url.searchParams.get("fresh") === "1";
    const out = (body, at, hit) => new Response(body, {
      status: 200,
      headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, no-store", "x-ics-fetched-at": String(at), "x-ics-cache": hit ? "hit" : "miss", ...cors },
    });
    // 1) Speicher, 2) caches.default
    const hitMem = mem.get(key);
    const maxAge = fresh ? FRESH_MIN_MS : ICS_CACHE_MS;
    if (hitMem && now - hitMem.at < maxAge) return out(hitMem.body, hitMem.at, true);
    const cache = cacheApi();
    const cacheReq = new Request(CACHE_HOST + encodeURIComponent(key));
    if (cache && !hitMem) {
      try {
        const c = await cache.match(cacheReq);
        if (c) {
          const at = Number(c.headers.get("x-ics-fetched-at")) || 0;
          if (now - at < maxAge) { const body = await c.text(); mem.set(key, { at, body }); return out(body, at, true); }
        }
      } catch { /* Cache ist nur Beiwerk */ }
    }
    const body = await fetchFeed(feed.url, fetchImpl);
    mem.set(key, { at: now, body });
    if (mem.size > 50) mem.delete(mem.keys().next().value);
    if (cache) {
      try {
        await cache.put(cacheReq, new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": `max-age=${ICS_CACHE_MS / 1000}`, "x-ics-fetched-at": String(now) } }));
      } catch { /* egal */ }
    }
    return out(body, now, false);
  } catch (e) {
    if (e instanceof IcsError) return json(e.status, { error: e.message });
    return json(500, { error: "Interner Fehler – bitte später nochmal versuchen." });
  }
}
