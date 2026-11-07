// Update 10 – 🌦️ Wetter (Browser): Ort-Einstellung NUR auf diesem Gerät (localStorage, gerundet auf 2 Nachkommastellen),
// Abruf bei Open-Meteo, Zwischenspeicher 1 h, offline der letzte Stand. Anzeige: Widget „weather“ im Heute-Überblick
// (js/views/dashboard.js), Einstellungen auch über Einstellungen › Erscheinungsbild. Logik: js/weather-core.js
import * as W from "./weather-core.js";
import { getPosition } from "./geo.js";
import { openSheet, toast, setBusy } from "./ui.js";
import { esc } from "./util.js";

const PREFS = "sk-weather";
const CACHE = "sk-weather-cache";
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };

(function ensureCss() {
  if (typeof document === "undefined" || document.getElementById("css-weather")) return;
  const l = document.createElement("link");
  l.id = "css-weather"; l.rel = "stylesheet";
  l.href = new URL("../css/weather.css", import.meta.url).href;
  document.head.appendChild(l);
})();

const listeners = new Set();
let st = { status: "idle", data: null, at: 0, error: "", offline: false };
let inflight = null;

export function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { for (const cb of listeners) { try { cb(); } catch (e) { console.error(e); } } }

export function prefs() { return W.normPrefs(lsGet(PREFS) || {}); }
export function savePrefs(p) { lsSet(PREFS, W.normPrefs(p)); st = { status: "idle", data: null, at: 0, error: "", offline: false }; emit(); refresh(); }
export function state() { return st; }

/** Laden, wenn nötig (Cache 1 h). force = trotz Cache. */
export function refresh(force = false) {
  const p = prefs();
  if (!(p.src === "geo" || p.src === "city") || p.lat == null) return Promise.resolve(null);
  const key = W.cacheKey(p.lat, p.lon);
  const c = lsGet(CACHE);
  if (!force && W.cacheFresh(c, key)) {
    if (st.at !== c.at || st.status !== "ok") { st = { status: "ok", data: c.data, at: c.at, error: "", offline: false }; emit(); }
    return Promise.resolve(c.data);
  }
  if (inflight) return inflight;
  const stale = c && c.key === key ? c : null;
  if (!st.data && stale) st = { status: "ok", data: stale.data, at: stale.at, error: "", offline: false };
  if (!st.data) st = { ...st, status: "loading" };
  emit();
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    st = stale ? { status: "ok", data: stale.data, at: stale.at, error: "", offline: true } : { status: "error", data: null, at: 0, error: "Du bist offline – sobald du wieder Netz hast, kommt das Wetter. 📶", offline: true };
    emit();
    return Promise.resolve(st.data);
  }
  const url = W.forecastUrl(p.lat, p.lon);
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const tm = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
  inflight = fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((json) => {
      const data = W.parse(json);
      if (!data) throw new Error("Unerwartete Antwort");
      const at = Date.now();
      lsSet(CACHE, { key, at, data });
      st = { status: "ok", data, at, error: "", offline: false };
      return data;
    })
    .catch((err) => {
      console.warn("Wetter:", err && err.message);
      st = stale ? { status: "ok", data: stale.data, at: stale.at, error: "", offline: true } : { status: "error", data: null, at: 0, error: "Wetter gerade nicht erreichbar – ich probier's später nochmal. 🌥️", offline: false };
      return st.data;
    })
    .finally(() => { if (tm) clearTimeout(tm); inflight = null; emit(); });
  return inflight;
}

/** Aktuellen Standort einmal holen und (gerundet) merken. */
export async function useLocation(btn) {
  if (btn) setBusy(btn, true, "📍 Suche …");
  try {
    const pos = await getPosition({ timeout: 12000, maxAge: 10 * 60000 });
    savePrefs({ src: "geo", lat: W.round2(pos.lat), lon: W.round2(pos.lng), city: "" });
    toast("📍 Standort gemerkt – nur auf diesem Gerät.");
    return true;
  } catch (err) {
    toast(err && err.code === "denied" ? "Standort ist blockiert – du kannst stattdessen eine Stadt eingeben. 🏙️" : "Standort gerade nicht verfügbar – probier eine Stadt. 🏙️", 3600);
    return false;
  } finally { if (btn && btn.isConnected) setBusy(btn, false); }
}

/** Stadt suchen (OpenStreetMap Nominatim) → { name, lat, lon } oder null. */
export async function findCity(q) {
  const text = String(q || "").trim().slice(0, 80);
  if (!text) return null;
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=" + encodeURIComponent(text);
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const list = await r.json();
  const hit = Array.isArray(list) ? list[0] : null;
  if (!hit || !W.validCoords(hit.lat, hit.lon)) return null;
  const name = String(hit.name || hit.display_name || text).split(",")[0].trim();
  return { name, lat: W.round2(hit.lat), lon: W.round2(hit.lon) };
}

/** Einstellungen-Blatt. */
export function openSettings() {
  const p = prefs();
  openSheet({
    title: "🌦️ Wetter",
    bodyHTML: `<div class="fields wx-set">
      <p class="note">Das Wetter kommt von Open-Meteo. Dein Ort bleibt <b>nur auf diesem Gerät</b> und wird auf ca. 1 km gerundet. 🔒</p>
      <p class="wx-cur" data-wx="cur">${esc(p.src === "geo" ? "📍 Aktueller Standort" : p.src === "city" ? `🏙️ ${p.city}` : p.src === "off" ? "💤 Ausgeschaltet" : "Noch kein Ort gewählt")}</p>
      <button type="button" class="btn ghost" data-wx="geo">📍 Meinen Standort verwenden</button>
      <label>Oder eine Stadt<input type="text" data-wx="city" maxlength="80" placeholder="z. B. Graz" value="${esc(p.src === "city" ? p.city : "")}" autocomplete="address-level2" enterkeyhint="search"></label>
      <div class="row"><button type="button" class="btn danger sm" data-wx="off">💤 Wetter ausblenden</button><button type="button" class="btn primary" data-wx="save">🔎 Stadt übernehmen</button></div>
    </div>`,
    onMount(sheet, close) {
      const $ = (k) => sheet.querySelector(`[data-wx="${k}"]`);
      $("geo").addEventListener("click", async () => { if (await useLocation($("geo"))) close(); });
      $("off").addEventListener("click", () => { savePrefs({ src: "off" }); toast("💤 Wetter ausgeblendet – unter Einstellungen › Erscheinungsbild wieder einschaltbar."); close(); });
      const save = async () => {
        const b = $("save");
        const q = $("city").value.trim();
        if (!q) { toast("Bitte eine Stadt eingeben."); return; }
        setBusy(b, true, "Suche …");
        try {
          const hit = await findCity(q);
          if (!hit) { toast(`„${q}“ hab ich nicht gefunden 🤔`); return; }
          savePrefs({ src: "city", city: hit.name, lat: hit.lat, lon: hit.lon });
          toast(`🏙️ Wetter für ${hit.name}`);
          close();
        } catch (err) {
          console.warn(err);
          toast("Suche gerade nicht möglich – bist du online?");
        } finally { if (b.isConnected) setBusy(b, false); }
      };
      $("save").addEventListener("click", save);
      $("city").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); save(); } });
    },
  });
}

/** Dashboard-Knöpfe (data-wx im Widget). */
export function handle(act, btn) {
  if (act === "geo") return useLocation(btn);
  if (act === "set") return openSettings();
  if (act === "no") { savePrefs({ src: "off" }); toast("Alles klar – kein Wetter. 🙂 Einschalten geht in den Einstellungen."); return null; }
  if (act === "retry") return refresh(true);
  return null;
}
