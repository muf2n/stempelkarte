// Update 10 – Alltag › 🗺️ Karte & Route (#alltag/karte). Wie Google Maps, nur schlank:
// Karte mit deinem Standort, „Wohin?“-Suche (Nominatim, nur auf Enter/🔎 – laut Nutzungsregeln keine Tipp-Autovervollständigung),
// Schnellziele (Orte/Baustellen, Kontakte, heutige Termine, Zuhause/Firma, Zuletzt), Routen für 🚗/🚶/🚲 über die FOSSGIS-OSRM-Server
// (routing.openstreetmap.de) mit Dauer, Strecke, Ankunft und Schritt-für-Schritt auf Deutsch; 🚆 Öffis → Google Maps / ÖBB Scotty.
// Vorbelegung über den Hash: ?place=<Ort-ID> | ?q=<Adresse> | ?to=lat,lng&name=…  (Logik: ./route-core.js)
// Datenschutz: Positionen bleiben am Gerät, gehen nur an die Routen-/Adress-Server; „Zuletzt“ nur lokal (beim Abmelden gelöscht).
import * as R from "./route-core.js";
import * as store from "../store.js";
import * as ui from "../ui.js";
import * as geo from "../geo.js";
import { plugin } from "../native.js";
import { esc, dayKey } from "../util.js";
import { collection } from "./db.js";
import * as K from "./kontakte-core.js";
import * as CC from "../cal-core.js";
import { siteStatus } from "../site-core.js";

import { addTiles, LEAFLET_JS, LEAFLET_CSS } from "../map-tiles.js"; // lokale Leaflet-Kopie + Ersatz-Kacheln
const LEAFLET_JS_SRI = "sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH"; // wie js/views/places.js
const LEAFLET_CSS_SRI = "sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H";
const AT_CENTER = [47.6, 13.8];
const HOME_RE = /\b(zuhause|zu hause|daheim|home|wohnung)\b/i;
const FIRMA_RE = /\b(firma|werkstatt|betrieb|büro|buero|lager|zentrale)\b/i;

let leafletP = null;
function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((resolve, reject) => {
    if (!document.querySelector("link[data-leaflet]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = LEAFLET_CSS; link.integrity = LEAFLET_CSS_SRI; link.crossOrigin = "anonymous"; link.dataset.leaflet = "1";
      document.head.appendChild(link);
    }
    const sc = document.createElement("script");
    sc.src = LEAFLET_JS; sc.integrity = LEAFLET_JS_SRI; sc.crossOrigin = "anonymous"; sc.async = true; sc.dataset.leaflet = "1";
    sc.onload = () => (window.L ? resolve(window.L) : reject(new Error("Leaflet fehlt")));
    sc.onerror = () => { sc.remove(); reject(new Error("Leaflet konnte nicht geladen werden")); };
    document.head.appendChild(sc);
  }).catch((e) => { leafletP = null; throw e; });
  return leafletP;
}

function injectCSS() {
  if (document.getElementById("kr-css")) return;
  const l = document.createElement("link");
  l.id = "kr-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-karte.css", import.meta.url).href;
  document.head.appendChild(l);
}

/* ---------- lokaler Speicher ---------- */
function lsGet(k, fb) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? fb : v; } catch { return fb; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } }
const recents = () => lsGet(R.RECENT_KEY, []).map(R.normDest).filter(Boolean);

/* ---------- Nominatim (≤ 1 Anfrage/s, Zwischenspeicher) ---------- */
const memGeo = new Map();
let lastNom = 0, nomQueue = Promise.resolve();
function nominatim(q, near, limit = 6) {
  const key = `${R.fold(q).trim()}|${limit}`;
  if (memGeo.has(key)) return Promise.resolve(memGeo.get(key));
  const stored = lsGet(R.GEO_KEY, {});
  if (stored && Array.isArray(stored[key])) { memGeo.set(key, stored[key]); return Promise.resolve(stored[key]); }
  const run = async () => {
    const wait = lastNom + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNom = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(R.nominatimUrl(q, near, limit), { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const list = R.parseNominatim(await res.json());
      memGeo.set(key, list);
      const all = lsGet(R.GEO_KEY, {}) || {};
      all[key] = list;
      const keys = Object.keys(all);
      for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete all[k];
      lsSet(R.GEO_KEY, all);
      return list;
    } finally { clearTimeout(t); lastNom = Date.now(); }
  };
  const p = nomQueue.then(run, run);
  nomQueue = p.catch(() => null);
  return p;
}

/* ---------- Routen (OSRM, je Modus/Start/Ziel zwischengespeichert) ---------- */
const routeCache = new Map();
function fetchRoute(mode, from, to) {
  const key = R.cacheKey(mode, from, to);
  if (routeCache.has(key)) return routeCache.get(key);
  const p = (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(R.osrmUrl(mode, from, to), { signal: ctrl.signal, headers: { Accept: "application/json" } });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      if (!res.ok && !(json && json.code)) return { ok: false, error: res.status === 429 ? "Routenserver ist gerade ausgelastet – gleich nochmal probieren." : "Routenserver nicht erreichbar." };
      return R.parseOsrm(json, mode);
    } catch {
      return { ok: false, error: navigator.onLine === false ? "Du bist offline – Routen brauchen Internet. 📶" : "Routenserver hat nicht geantwortet." };
    } finally { clearTimeout(t); }
  })();
  routeCache.set(key, p);
  p.then((r) => { if (!r.ok) routeCache.delete(key); });
  return p;
}

function openExternal(url) {
  const B = plugin("Browser");
  if (B) { B.open({ url }).catch(() => window.open(url, "_blank", "noopener")); return true; }
  return false;
}

/* ================================================================== */

export function mount(el) {
  injectCSS();
  const S = {
    me: null,            // eigener Standort { lat, lng, acc }
    from: null,          // eigener Start (statt Standort) { name, sub, lat, lng }
    dest: null,
    mode: lsGet("sk-karte-mode", "car"),
    results: {},         // mode → Ergebnis
    target: "to",        // Suchfeld füllt "to" oder "from"
    expanded: false,
    collapsed: false, // Update 13: eingeklappt (nur Griff + Titel)
    follow: null,        // watchPosition-ID
    live: null,          // Update 16: watchPosition-ID für den Live-Punkt (nur solange die Karte sichtbar ist)
    lock: false,         // Update 16: „Mitfahren“ – Karte folgt meinem Standort (aus, sobald man die Karte verschiebt)
    stepIdx: 0,
    locState: "unknown", // granted | prompt | denied | unknown | busy | error
    locMsg: "",
    sugg: null,          // { loading, list, error, q }
  };
  if (!R.MODES.some((m) => m.id === S.mode)) S.mode = "car";
  let alive = true, map = null, Lx = null, layers = null, token = 0;
  const kontakte = collection("kontakte");

  el.innerHTML = `<div class="kr" data-r="kr">
    <div class="kr-mapwrap">
      <div class="kr-map" data-r="map" role="region" aria-label="Karte"></div>
      <p class="kr-mapnote" data-r="mapnote" hidden></p>
      <div class="kr-follow" data-r="follow" hidden aria-live="polite"></div>
      <button type="button" class="kr-fab kr-locate" data-k="locate" aria-label="Zu meinem Standort springen" title="Zu meinem Standort"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    </div>
    <form class="kr-search" data-r="form" role="search" autocomplete="off">
      <span class="kr-search-ic" data-r="searchic" aria-hidden="true">🔎</span>
      <input id="kr-q" type="search" placeholder="Wohin?" aria-label="Ziel suchen" enterkeyhint="search" maxlength="200" spellcheck="false">
      <button type="button" class="kr-ib" data-k="mic" aria-label="Ziel sagen" hidden>🎤</button>
      <button type="submit" class="kr-ib kr-go" aria-label="Suchen">➜</button>
      <button type="button" class="kr-ib" data-k="info" aria-label="Infos zu Karte & Datenschutz">ℹ️</button>
      <div class="kr-sugg" data-r="sugg" hidden></div>
    </form>
    <section class="kr-sheet" data-r="sheet" aria-label="Route">
      <button type="button" class="kr-grip" data-k="grip" aria-label="Bereich vergrößern"><span></span></button>
      <div class="kr-sheet-body" data-r="body"></div>
    </section>
  </div>`;
  const $ = (r) => el.querySelector(`[data-r="${r}"]`);
  const kr = $("kr"), qIn = el.querySelector("#kr-q"), suggEl = $("sugg"), body = $("body"), sheet = $("sheet");
  const desktop = () => matchMedia("(min-width: 1024px)").matches;

  /* ---------- Größe: Vollbild unter der Kopfzeile ---------- */
  function fit() {
    if (!alive) return;
    const top = kr.getBoundingClientRect().top + window.scrollY;
    const tb = document.getElementById("tabbar");
    let bottom = window.innerHeight;
    if (tb) { const r = tb.getBoundingClientRect(); if (r.height && r.top > top + 100 && getComputedStyle(tb).display !== "none") bottom = Math.min(bottom, r.top); }
    kr.style.height = Math.max(380, Math.round(bottom - top - (desktop() ? 16 : 0))) + "px";
    kr.style.marginBottom = "";
    const over = document.documentElement.scrollHeight - window.innerHeight; // Rest-Abstand unter dem Bereich → kein Seiten-Scrollen
    if (over > 0 && over < 120) kr.style.marginBottom = -over + "px";
    if (map) map.invalidateSize();
  }
  const onResize = () => fit();
  window.addEventListener("resize", onResize);
  requestAnimationFrame(fit);

  /* ---------- Karte ---------- */
  function mapNote(t) { const n = $("mapnote"); n.textContent = t || ""; n.hidden = !t; }
  async function ensureMap() {
    if (map) return map;
    try {
      const L = await loadLeaflet();
      if (!alive) return null;
      if (map) return map;
      Lx = L;
      map = L.map($("map"), { zoomControl: false, attributionControl: true }).setView(AT_CENTER, 7);
      map.attributionControl.setPosition("topright"); // unten liegt am Handy das Bottom-Sheet drüber
      map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
      addTiles(L, map, ' · Routen: <a href="https://routing.openstreetmap.de" target="_blank" rel="noopener">FOSSGIS</a>');
      L.control.zoom({ position: "bottomright", zoomInTitle: "Hineinzoomen", zoomOutTitle: "Herauszoomen" }).addTo(map);
      layers = { route: L.layerGroup().addTo(map), marks: L.layerGroup().addTo(map), me: L.layerGroup().addTo(map), step: L.layerGroup().addTo(map) };
      map.on("dragstart", () => { if (S.lock) { S.lock = false; markLock(); } }); // selbst verschieben = Mitfahren aus
      mapNote("");
      fit();
      drawMap(true);
      return map;
    } catch {
      mapNote("🗺️ Karte konnte nicht geladen werden (offline?). Routen & Zeiten gehen trotzdem.");
      return null;
    }
  }
  const accent = () => { try { return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#4F46E5"; } catch { return "#4F46E5"; } };
  function pad() {
    if (desktop()) return { paddingTopLeft: [40, 40], paddingBottomRight: [40, 40] };
    const sh = sheet.getBoundingClientRect().height || 0, top = 104; // Suchfeld + Pin-Höhe
    return { paddingTopLeft: [24, top], paddingBottomRight: [24, Math.min(sh + 24, kr.clientHeight * 0.7)] };
  }
  function drawMap(refit) {
    if (!map || !Lx) return;
    const L = Lx;
    layers.route.clearLayers(); layers.marks.clearLayers(); layers.me.clearLayers(); layers.step.clearLayers();
    if (S.me) {
      L.circle([S.me.lat, S.me.lng], { radius: Math.min(S.me.acc || 30, 300), color: "#1a73e8", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(layers.me);
      L.circleMarker([S.me.lat, S.me.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }).bindTooltip("Du bist hier").addTo(layers.me);
    }
    const from = origin();
    if (S.from) L.circleMarker([S.from.lat, S.from.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#16a34a", fillOpacity: 1 }).bindTooltip("Start: " + S.from.name).addTo(layers.marks);
    if (S.dest) {
      L.marker([S.dest.lat, S.dest.lng], { icon: L.divIcon({ className: "kr-pin", html: "<span>📍</span>", iconSize: [36, 36], iconAnchor: [18, 34] }), keyboard: false, title: S.dest.name }).addTo(layers.marks);
    }
    const r = S.results[S.mode];
    let bounds = null;
    if (r && r.ok && r.coords.length > 1) {
      L.polyline(r.coords, { color: "#fff", weight: 10, opacity: 0.9, interactive: false }).addTo(layers.route);
      L.polyline(r.coords, { color: S.mode === "car" ? accent() : S.mode === "bike" ? "#16a34a" : "#0284c7", weight: 6, opacity: 0.95, dashArray: S.mode === "foot" ? "2 10" : null, lineCap: "round", interactive: false }).addTo(layers.route);
      bounds = L.latLngBounds(r.coords);
      const st = S.follow != null && r.steps[S.stepIdx];
      if (st && st.loc) L.circleMarker(st.loc, { radius: 9, color: "#fff", weight: 3, fillColor: "#f59e0b", fillOpacity: 1 }).addTo(layers.step);
    } else if (S.dest && from) bounds = L.latLngBounds([[S.dest.lat, S.dest.lng], [from.lat, from.lng]]);
    if (!refit || S.follow != null) return;
    if (bounds) map.fitBounds(bounds.pad(0.05), { ...pad(), maxZoom: 17 });
    else if (S.dest) map.setView([S.dest.lat, S.dest.lng], 15);
    else if (S.me) map.setView([S.me.lat, S.me.lng], 14);
  }

  /* ---------- Standort ---------- */
  /** Karte auf meinen Standort – mittig im sichtbaren Teil (über dem Bottom-Sheet bzw. unter dem Suchfeld). */
  function centerOnMe() {
    if (!map || !S.me) return;
    const z = Math.max(map.getZoom(), 16), p = pad();
    const dx = (p.paddingTopLeft[0] - p.paddingBottomRight[0]) / 2, dy = (p.paddingTopLeft[1] - p.paddingBottomRight[1]) / 2;
    const pt = map.project([S.me.lat, S.me.lng], z).subtract([dx, dy]);
    map.setView(map.unproject(pt, z), z, { animate: true });
  }
  const origin = () => S.from || (S.me ? { name: "Mein Standort", lat: S.me.lat, lng: S.me.lng } : null);
  async function locate(ask, center = false) {
    if (!geo.isSupported()) { S.locState = "error"; S.locMsg = "Dieses Gerät kann keinen Standort ermitteln."; render(); return; }
    S.locState = "busy"; render();
    try {
      const p = await geo.getPosition({ timeout: 12000, maxAge: center ? 0 : 60000 }); // Fadenkreuz: immer frisch
      if (!alive) return;
      S.me = { lat: p.lat, lng: p.lng, acc: p.acc };
      S.locState = "granted"; S.locMsg = "";
      startLive();
      if (center && map) { drawMap(false); centerOnMe(); } // Knopf „Zu meinem Standort“
      else drawMap(!S.dest);
      if (S.dest && !S.from) loadRoutes(center);
    } catch (e) {
      if (!alive) return;
      S.locState = e && e.code === "denied" ? "denied" : "error";
      S.locMsg = (e && e.message) || "Standort nicht verfügbar.";
      if (ask) ui.toast("📍 " + S.locMsg, 3800);
    }
    render();
  }
  (async () => {
    const perm = await geo.permission();
    if (!alive) return;
    S.locState = perm === "granted" ? "granted" : perm === "denied" ? "denied" : "prompt";
    if (perm === "granted") locate(false); else render(); // locate() startet danach den Live-Punkt
  })();

  /* ---------- Ziele ---------- */
  function placeDest(p) {
    if (!p) return null;
    if (R.validPoint(p)) return R.normDest({ name: p.name || "Ort", sub: p.addr || "", lat: p.lat, lng: p.lng });
    return null;
  }
  function quickPicks() {
    const snap = store.get() || {};
    const places = (snap.places || []).filter((p) => p && p.id);
    const homeIds = new Set(((snap.settings || {}).allowance || {}).homePlaceIds || []);
    const fav = [];
    const home = places.find((p) => HOME_RE.test(p.name || ""));
    const firma = places.find((p) => p !== home && (FIRMA_RE.test(p.name || "") || homeIds.has(p.id)));
    if (home) fav.push({ e: "🏠", label: "Zuhause", kind: "place", id: home.id, name: home.name, sub: home.addr || "", ok: R.validPoint(home) || !!home.addr });
    if (firma) fav.push({ e: "🏢", label: "Firma", kind: "place", id: firma.id, name: firma.name, sub: firma.addr || "", ok: R.validPoint(firma) || !!firma.addr });
    const used = new Set(fav.map((f) => f.id));
    const today = dayKey(Date.now());
    const orte = places.filter((p) => !used.has(p.id) && (R.validPoint(p) || p.addr) && siteStatus(p, today) !== "abgeschlossen")
      .map((p) => ({ e: "🏗️", kind: "place", id: p.id, name: p.name || "Ort", sub: p.addr || "" }));
    let termine = [];
    try {
      termine = CC.expandAll(snap.todos || [], today, CC.addDays(today, 1), (t) => !!String(t.location || "").trim() || (t.overrides && typeof t.overrides === "object"))
        .filter((i) => String(i.location || "").trim() && !i.done)
        .slice(0, 6)
        .map((i) => ({ e: "📅", kind: "addr", name: i.title || "Termin", sub: `${i.date === today ? "Heute" : "Morgen"}${i.time ? " " + i.time : ""} · ${i.location}`, addr: String(i.location).trim() }));
    } catch { termine = []; }
    const kont = kontakte.all().map(K.normContact).filter((c) => c.id && c.address)
      .sort((a, b) => K.displayName(a).localeCompare(K.displayName(b), "de")).slice(0, 30)
      .map((c) => ({ e: K.typeById(c.type).e || "👤", kind: "addr", name: K.displayName(c), sub: c.address.replace(/\s*\n\s*/g, ", "), addr: c.address.replace(/\s*\n\s*/g, ", ") }));
    const rec = recents().map((d) => ({ e: "🕘", kind: "dest", name: d.name, sub: d.sub, dest: d }));
    return { fav, rec, orte, termine, kont };
  }
  const pickById = new Map();
  let pickSeq = 0;
  function pickBtn(it) {
    const k = "p" + (++pickSeq);
    pickById.set(k, it);
    return `<button type="button" class="kr-pick" data-pick="${k}"><span class="kr-pick-e" aria-hidden="true">${esc(it.e)}</span>` +
      `<span class="kr-pick-t"><b>${esc(it.label || it.name)}</b>${it.label && it.name !== it.label ? `<small>${esc(it.name)}${it.sub ? " · " + esc(it.sub) : ""}</small>` : it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span></button>`;
  }
  async function resolvePick(it) {
    if (it.dest) return it.dest;
    if (it.kind === "place") {
      const p = ((store.get() || {}).places || []).find((x) => x.id === it.id);
      const d = placeDest(p);
      if (d) return d;
      if (p && p.addr) return geocodeOne(p.addr, p.name || it.name);
      return null;
    }
    if (it.kind === "addr") return geocodeOne(it.addr, it.name);
    return R.normDest(it);
  }
  async function geocodeOne(addr, name) {
    ui.toast("🔎 Suche Adresse …", 1400);
    try {
      const list = await nominatim(addr, origin(), 1);
      if (!list.length) { ui.toast(`🤔 „${addr}“ nicht gefunden – probier's im Suchfeld genauer.`, 3600); return null; }
      return R.normDest({ ...list[0], name: name || list[0].name, sub: addr });
    } catch { ui.toast("Adresssuche gerade nicht erreichbar 📶", 3000); return null; }
  }

  async function chooseDest(d, { as = S.target } = {}) {
    if (!d) return;
    closeSugg();
    qIn.value = "";
    if (as === "from") {
      S.from = d; S.target = "to"; qIn.placeholder = "Wohin?";
    } else {
      S.dest = d;
      lsSet(R.RECENT_KEY, R.addRecent(lsGet(R.RECENT_KEY, []), d));
    }
    S.results = {};
    S.expanded = false;
    S.collapsed = false; // neues Ziel → Sheet wieder halb offen
    stopFollow();
    render();
    await ensureMap();
    drawMap(true);
    loadRoutes();
  }
  function clearDest() {
    S.dest = null; S.from = null; S.results = {}; S.target = "to"; qIn.placeholder = "Wohin?";
    stopFollow();
    if (location.hash.includes("?")) history.replaceState(null, "", location.pathname + location.search + "#alltag/karte");
    render(); drawMap(true);
  }

  async function loadRoutes(keepView = false) {
    const from = origin(), to = S.dest;
    if (!from || !to) { render(); return; }
    const my = ++token;
    for (const m of R.ROUTED_MODES) S.results[m] = S.results[m] || { loading: true };
    render();
    await Promise.all(R.ROUTED_MODES.map(async (m) => {
      const r = await fetchRoute(m, from, to);
      if (!alive || my !== token) return;
      S.results[m] = r;
      render();
      if (m === S.mode) drawMap(!keepView);
    }));
  }

  /* ---------- Suche ---------- */
  function closeSugg() { S.sugg = null; suggEl.hidden = true; suggEl.innerHTML = ""; }
  function renderSugg() {
    const q = qIn.value.trim();
    if (!q && !S.sugg) { suggEl.hidden = true; suggEl.innerHTML = ""; return; }
    const qp = quickPicks();
    const local = [...qp.fav, ...qp.rec, ...qp.orte, ...qp.termine, ...qp.kont].filter((x) => R.matches({ name: `${x.label || ""} ${x.name}`, sub: x.sub }, q)).slice(0, 6);
    let html = "";
    if (local.length && q) html += `<div class="kr-sugg-h">Bei dir gespeichert</div>` + local.map(pickBtn).join("");
    const sg = S.sugg;
    if (sg && sg.loading) html += `<div class="kr-sugg-h">🔎 Suche „${esc(sg.q)}“ …</div>`;
    else if (sg && sg.error) html += `<p class="kr-sugg-note">${esc(sg.error)}</p>`;
    else if (sg && sg.list) html += sg.list.length ? `<div class="kr-sugg-h">Gefunden</div>` + sg.list.map((d) => pickBtn({ e: "📍", kind: "dest", name: d.name, sub: d.sub, dest: d })).join("")
      : `<p class="kr-sugg-note">🤔 Nichts gefunden für „${esc(sg.q)}“. Mit Ort probieren, z. B. „Hauptplatz Graz“.</p>`;
    else if (q.length >= 3) html += `<p class="kr-sugg-note">↵ Enter oder ➜ tippen, um „${esc(q)}“ auf der Karte zu suchen.</p>`;
    else if (q) html += `<p class="kr-sugg-note">Mindestens 3 Zeichen für die Adresssuche ✍️</p>`;
    if (S.target === "from") html = `<div class="kr-sugg-h">🟢 Start wählen</div>` + (S.me ? pickBtn({ e: "📍", kind: "me", name: "Mein Standort", sub: "" }) : "") + html;
    suggEl.innerHTML = html;
    suggEl.hidden = !html;
  }
  async function search(q) {
    q = String(q || "").trim();
    if (q.length < 3) { renderSugg(); return; }
    S.sugg = { loading: true, q };
    renderSugg();
    try {
      const list = await nominatim(q, origin());
      if (!alive || !S.sugg || S.sugg.q !== q) return;
      S.sugg = { list, q };
    } catch {
      if (!alive) return;
      S.sugg = { error: navigator.onLine === false ? "Du bist offline – Adresssuche braucht Internet. 📶" : "Adresssuche gerade nicht erreichbar – gleich nochmal probieren.", q };
    }
    renderSugg();
  }
  $("form").addEventListener("submit", (e) => { e.preventDefault(); search(qIn.value); });
  qIn.addEventListener("input", () => { if (S.sugg && S.sugg.q !== qIn.value.trim()) S.sugg = null; renderSugg(); });
  qIn.addEventListener("focus", () => { if (qIn.value.trim() || S.target === "from") renderSugg(); });
  qIn.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSugg(); qIn.blur(); } });
  const onDocDown = (e) => { if (!$("form").contains(e.target)) closeSugg(); };
  document.addEventListener("pointerdown", onDocDown);

  // 🎤 Ziel sagen (Web Speech, falls vorhanden)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = el.querySelector('[data-k="mic"]');
  if (SR) mic.hidden = false;
  let rec = null;
  mic.addEventListener("click", () => {
    if (rec) { try { rec.stop(); } catch { /* egal */ } return; }
    try {
      rec = new SR(); rec.lang = "de-AT"; rec.interimResults = false; rec.maxAlternatives = 1;
      mic.classList.add("on");
      rec.onresult = (ev) => { const t = ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : ""; if (t) { qIn.value = t.replace(/^(nach|zu|zum|zur)\s+/i, ""); search(qIn.value); } };
      rec.onend = () => { rec = null; mic.classList.remove("on"); };
      rec.onerror = () => { rec = null; mic.classList.remove("on"); };
      rec.start();
    } catch { rec = null; mic.classList.remove("on"); ui.toast("🎤 Spracheingabe geht hier leider nicht.", 2600); }
  });

  /* ---------- Update 16: Live-Punkt & „Mitfahren“ ---------- */
  // Läuft nur, solange die Karte offen UND sichtbar ist (Akku). Fragt nie selbst nach der Berechtigung –
  // startet erst, wenn der Standort schon erlaubt ist bzw. nach dem Tippen aufs Fadenkreuz.
  function startLive() {
    if (S.live != null || !geo.isSupported() || document.hidden || S.locState !== "granted") return;
    try {
      S.live = navigator.geolocation.watchPosition((p) => {
        if (!alive || S.live == null || S.follow != null) return; // beim Routen-„Mitlaufen“ übernimmt startFollow
        S.me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) };
        moveMe();
        if (S.lock && map) map.panTo(pannedTarget(), { animate: true, duration: 0.6 });
      }, (e) => { if (e && e.code === 1) { S.locState = "denied"; stopLive(); render(); } }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
    } catch { S.live = null; }
  }
  function stopLive() { if (S.live != null) { try { navigator.geolocation.clearWatch(S.live); } catch { /* egal */ } } S.live = null; }
  /** Nur den blauen Punkt + Genauigkeitskreis verschieben (ohne Route/Marker neu zu zeichnen). */
  function moveMe() {
    if (!map || !layers.me || !S.me) return;
    const ls = layers.me.getLayers();
    if (ls.length === 2) { ls[0].setLatLng([S.me.lat, S.me.lng]).setRadius(Math.min(S.me.acc || 30, 300)); ls[1].setLatLng([S.me.lat, S.me.lng]); }
    else drawMap(false);
  }
  /** Ziel fürs Mitschwenken: mein Standort mittig im sichtbaren Bereich (über dem Sheet). */
  function pannedTarget() {
    const z = map.getZoom(), p = pad();
    const dx = (p.paddingTopLeft[0] - p.paddingBottomRight[0]) / 2, dy = (p.paddingTopLeft[1] - p.paddingBottomRight[1]) / 2;
    return map.unproject(map.project([S.me.lat, S.me.lng], z).subtract([dx, dy]), z);
  }
  function markLock() { const b = el.querySelector('[data-k="locate"]'); if (b) { b.classList.toggle("on", !!S.lock); b.setAttribute("aria-pressed", String(!!S.lock)); b.title = S.lock ? "Karte fährt mit – zum Beenden die Karte verschieben" : "Zu meinem Standort"; } }
  const onVis = () => { if (document.hidden) stopLive(); else startLive(); };
  document.addEventListener("visibilitychange", onVis);

  /* ---------- Mitlaufen ---------- */
  function stopFollow() {
    if (S.follow != null) { try { navigator.geolocation.clearWatch(S.follow); } catch { /* egal */ } }
    S.follow = null; S.stepIdx = 0;
    const f = $("follow"); if (f) f.hidden = true;
  }
  function startFollow() {
    if (!geo.isSupported()) return;
    S.stepIdx = 0;
    try {
      S.follow = navigator.geolocation.watchPosition((p) => {
        if (!alive || S.follow == null) return;
        S.me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) };
        const r = S.results[S.mode];
        if (r && r.ok) S.stepIdx = R.nextStepIndex(r.steps, S.me, S.stepIdx);
        drawMap(false);
        if (map) map.setView([S.me.lat, S.me.lng], Math.max(map.getZoom(), 17), { animate: true });
        renderFollow();
        markStep();
      }, () => { ui.toast("📍 Standort für „Mitlaufen“ nicht verfügbar.", 3000); stopFollow(); render(); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
    } catch { S.follow = null; }
    renderFollow();
  }
  function renderFollow() {
    const f = $("follow");
    const r = S.results[S.mode];
    if (S.follow == null || !r || !r.ok) { f.hidden = true; return; }
    const st = r.steps[S.stepIdx];
    const d = st && st.loc && S.me ? R.distanceM(S.me, { lat: st.loc[0], lng: st.loc[1] }) : null;
    f.innerHTML = st ? `<span class="kr-follow-ic" aria-hidden="true">${esc(st.icon)}</span><span><small>${d != null ? "In " + esc(R.fmtDistance(d)) : "Gleich"}</small><b>${esc(st.text)}</b></span>` : "";
    f.hidden = !st;
  }
  function markStep() {
    body.querySelectorAll(".kr-step").forEach((li, i) => li.classList.toggle("now", S.follow != null && i === S.stepIdx));
  }

  /* ---------- Bottom-Sheet / Seitenleiste ---------- */
  function modeTabs() {
    return `<div class="kr-modes" role="tablist" aria-label="Verkehrsmittel">${R.MODES.map((m) => {
      const r = S.results[m.id];
      const val = m.id === "transit" ? "Google ↗" : !r ? "–" : r.loading ? "…" : r.ok ? R.fmtDurationShort(r.duration) : "✕";
      return `<button type="button" role="tab" class="kr-mode" data-mode="${m.id}" aria-selected="${S.mode === m.id}"><span class="kr-mode-e" aria-hidden="true">${m.e}</span><span class="kr-mode-l">${esc(m.l)}</span><b class="kr-mode-t" data-t="${m.id}">${esc(val)}</b></button>`;
    }).join("")}</div>`;
  }
  function locCard() {
    if (S.locState === "busy") return `<div class="kr-card kr-loc"><p>📡 Suche deinen Standort …</p></div>`;
    if (S.me || S.from) return "";
    if (S.locState === "denied") return `<div class="kr-card kr-loc"><p><b>📍 Standort ist blockiert</b></p><p class="note">${esc(S.locMsg || "Erlaube den Standort in den Browser-Einstellungen – oder wähl unten einen Start.")}</p><button type="button" class="btn sm ghost" data-k="pickfrom">🟢 Start selbst wählen</button></div>`;
    return `<div class="kr-card kr-loc"><p><b>📍 Darf ich deinen Standort verwenden?</b></p>
      <p class="note">Dann rechne ich die Route von dort, wo du gerade bist. Dein Standort bleibt am Gerät – er geht nur zum Routenrechner, wenn du ein Ziel wählst. 🔒</p>
      ${S.locMsg ? `<p class="note kr-err">${esc(S.locMsg)}</p>` : ""}
      <div class="kr-row"><button type="button" class="btn primary sm" data-k="allow">📍 Standort verwenden</button><button type="button" class="btn sm ghost" data-k="pickfrom">🟢 Start selbst wählen</button></div></div>`;
  }
  function homeHTML() {
    pickById.clear();
    const qp = quickPicks();
    const sec = (t, list, extra = "") => list.length ? `<section class="kr-sec"><h3>${t}</h3><div class="kr-picks">${list.map(pickBtn).join("")}</div>${extra}</section>` : "";
    const any = qp.fav.length + qp.rec.length + qp.orte.length + qp.termine.length + qp.kont.length;
    return `<div class="kr-hello"><h2>🗺️ Wohin geht's?</h2><p class="note">Ziel eingeben oder unten antippen – ich zeig dir Auto 🚗, zu Fuß 🚶, Rad 🚲 und Öffis 🚆 mit Weg & Zeit.</p></div>` +
      locCard() +
      (qp.fav.length ? `<div class="kr-favs">${qp.fav.map(pickBtn).join("")}</div>` : "") +
      sec("🕘 Zuletzt", qp.rec, qp.rec.length ? `<button type="button" class="kr-link" data-k="clearrecent">Verlauf löschen</button>` : "") +
      sec("📅 Termine heute & morgen", qp.termine) +
      sec("🏗️ Baustellen & Orte", qp.orte.slice(0, 12)) +
      sec("👤 Kunden & Kontakte", qp.kont.slice(0, 12)) +
      (any ? "" : `<p class="note kr-empty">Tipp: Orte, Baustellen und Kontakte mit Adresse erscheinen hier als Schnellziele. 😊</p>`);
  }
  function routeHTML() {
    const d = S.dest, from = origin();
    const m = R.modeById(S.mode);
    const r = S.results[S.mode];
    let main = "";
    if (!from) main = locCard() || `<p class="note">Wähl einen Start, dann rechne ich die Route.</p>`;
    else if (m.id === "transit") {
      const gm = R.gmapsDirUrl({ from, to: d, mode: "transit" });
      main = `<div class="kr-card kr-oeffi"><h3>🚆 Öffi-Verbindungen</h3>
        <p class="note">Für Bus, Bim &amp; Zug gibt's leider keinen freien Fahrplan-Dienst ohne Schlüssel – darum öffne ich die Verbindung direkt dort, wo die echten Fahrpläne sind. 🙌</p>
        <div class="kr-btns"><a class="btn primary" data-ext href="${esc(gm)}" target="_blank" rel="noopener" data-r="gm-transit">🗺️ In Google Maps öffnen</a>
        <a class="btn ghost" data-ext href="${esc(R.SCOTTY_URL)}" target="_blank" rel="noopener" data-r="scotty">🚉 ÖBB Scotty öffnen</a></div>
        <p class="note kr-small">Bei Scotty gibst du das Ziel selbst ein – <button type="button" class="kr-link" data-k="copy">📋 Adresse kopieren</button>.</p></div>`;
    } else if (!r || r.loading) main = `<div class="kr-sum kr-loading"><span class="kr-spin" aria-hidden="true"></span> Route wird berechnet …</div>`;
    else if (!r.ok) main = `<div class="kr-card kr-err-card"><p>😕 ${esc(r.error)}</p><button type="button" class="btn sm ghost" data-k="retry">🔄 Nochmal</button></div>`;
    else {
      const nav = R.gmapsDirUrl({ to: d, mode: m.id, navigate: true });
      main = `<div class="kr-sum"><div class="kr-sum-main"><b class="kr-dur" data-r="dur">${esc(R.fmtDuration(r.duration))}</b><span class="kr-dist" data-r="dist">${esc(R.fmtDistance(r.distance))}</span></div>
          <p class="kr-arr" data-r="arr">🕐 ${esc(R.arrivalText(Date.now(), r.duration))}</p></div>
        <div class="kr-btns"><a class="btn primary" data-ext data-r="nav" href="${esc(nav)}" target="_blank" rel="noopener">▶️ Navigation starten</a>
          <button type="button" class="btn ghost" data-k="follow" aria-pressed="${S.follow != null}">${S.follow != null ? "⏹️ Mitlaufen beenden" : "👣 Mitlaufen"}</button></div>
        <p class="note kr-small">ℹ️ Live-Navigation mit Ansagen läuft über Google Maps. Hier siehst du Weg &amp; Zeit – „Mitlaufen“ zeigt deine Position auf der Route und den nächsten Schritt.</p>
        <details class="kr-steps" data-r="steps"${S.stepsOpen ? " open" : ""}><summary>🧭 Schritt für Schritt <small>(${r.steps.length})</small></summary>
          <ol>${r.steps.map((s, i) => `<li class="kr-step${S.follow != null && i === S.stepIdx ? " now" : ""}" data-i="${i}"><span class="kr-step-ic" aria-hidden="true">${esc(s.icon)}</span><span class="kr-step-t">${esc(s.text)}</span>${s.distance >= 1 ? `<small>${esc(R.fmtDistance(s.distance))}</small>` : ""}</li>`).join("")}</ol></details>`;
    }
    return `<div class="kr-dest"><div class="kr-dest-t"><h2 data-r="destname">📍 ${esc(d.name)}</h2>${d.sub ? `<p class="note">${esc(d.sub)}</p>` : ""}</div>
        <button type="button" class="kr-x" data-k="clear" aria-label="Ziel entfernen">✕</button></div>
      <div class="kr-from"><span>🟢 Von:</span> <b>${esc(from ? from.name : "–")}</b> <button type="button" class="kr-link" data-k="pickfrom">ändern</button>${S.from && S.me ? ` <button type="button" class="kr-link" data-k="fromme">📍 Mein Standort</button>` : ""}</div>
      ${modeTabs()}${main}`;
  }
  function render() {
    if (!alive) return;
    const det = body.querySelector(".kr-steps");
    if (det) S.stepsOpen = det.open;
    const scroll = body.scrollTop;
    body.innerHTML = S.dest ? routeHTML() : homeHTML();
    if (S.dest) body.scrollTop = scroll;
    sheet.dataset.expanded = String(S.expanded && !S.collapsed);
    sheet.dataset.collapsed = String(!!S.collapsed);
    kr.classList.toggle("kr-min", !!S.collapsed);
    kr.dataset.loc = S.locState || "";
    markLock();
    sheet.dataset.has = S.dest ? "route" : "home";
    el.querySelector('[data-k="grip"]').setAttribute("aria-label", S.collapsed ? "Bereich aufklappen" : S.expanded ? "Bereich verkleinern" : "Bereich vergrößern (nach unten wischen zum Einklappen)");
    el.querySelector('[data-k="grip"]').setAttribute("aria-expanded", String(!S.collapsed));
    renderFollow();
    if (!suggEl.hidden) renderSugg();
  }

  /* ---------- Klicks ---------- */
  el.addEventListener("click", async (e) => {
    const ext = e.target.closest("a[data-ext]");
    if (ext) { if (openExternal(ext.href)) e.preventDefault(); return; }
    const pk = e.target.closest("[data-pick]");
    if (pk) {
      const it = pickById.get(pk.dataset.pick);
      if (!it) return;
      if (it.kind === "me") { S.from = null; S.target = "to"; qIn.placeholder = "Wohin?"; closeSugg(); S.results = {}; render(); drawMap(true); loadRoutes(); return; }
      const d = await resolvePick(it);
      if (d) chooseDest(d);
      return;
    }
    const md = e.target.closest("[data-mode]");
    if (md) {
      S.mode = md.dataset.mode; lsSet("sk-karte-mode", S.mode);
      if (S.follow != null && S.mode === "transit") stopFollow();
      render(); drawMap(true);
      return;
    }
    const st = e.target.closest(".kr-step");
    if (st && map) { const r = S.results[S.mode]; const s = r && r.ok && r.steps[Number(st.dataset.i)]; if (s && s.loc) { map.setView(s.loc, 17); if (!desktop()) { S.expanded = false; render(); } } return; }
    const k = e.target.closest("[data-k]");
    if (!k) return;
    switch (k.dataset.k) {
      case "locate": S.lock = true; markLock(); if (S.me && map) centerOnMe(); locate(true, true); break; // sofort hin, dann frisch nachziehen; ab jetzt mitfahren
      case "allow": locate(true); break;
      case "pickfrom": S.target = "from"; qIn.placeholder = "Von wo?"; qIn.focus(); renderSugg(); break;
      case "fromme": S.from = null; S.results = {}; render(); drawMap(true); loadRoutes(); break;
      case "clear": clearDest(); break;
      case "retry": S.results = {}; loadRoutes(); break;
      case "grip": setSize(S.collapsed ? 1 : S.expanded ? 1 : 2); break; // Tippen: zu → halb → groß → halb; einklappen per Wischen nach unten
      case "follow": if (S.follow != null) stopFollow(); else startFollow(); render(); drawMap(S.follow == null); break;
      case "clearrecent": lsSet(R.RECENT_KEY, []); render(); break;
      case "info": openInfo(); break;
      case "copy": {
        const t = S.dest ? (S.dest.sub ? `${S.dest.name}, ${S.dest.sub}` : `${S.dest.lat},${S.dest.lng}`) : "";
        try { await navigator.clipboard.writeText(t); ui.toast("📋 Adresse kopiert", 1600); } catch { ui.toast(t, 4000); }
        break;
      }
    }
  });
  // Sheet per Wischen: groß ⇄ halb ⇄ eingeklappt (Handy). Gewischt werden kann am Griff, am Titel – und im Inhalt,
  // wenn der ganz oben ist und nach unten gezogen wird.
  function size() { return S.collapsed ? 0 : S.expanded ? 2 : 1; }
  function setSize(n) { S.collapsed = n === 0; S.expanded = n === 2; render(); setTimeout(() => { if (map) { map.invalidateSize(); } }, 280); }
  function sizeStep(dir) { setSize(Math.max(0, Math.min(2, size() - dir))); } // dir > 0 = nach unten
  const grip = el.querySelector('[data-k="grip"]');
  let drag = null;
  const startDrag = (y, fromBody) => { drag = { y, fromBody, moved: false }; };
  const endDrag = (y) => {
    if (!drag) return false;
    const dy = y - drag.y, fromBody = drag.fromBody; drag = null;
    if (Math.abs(dy) < 40) return false;
    if (fromBody && (dy < 0 || body.scrollTop > 0)) return false; // im Inhalt nur nach unten und nur ganz oben
    sizeStep(dy > 0 ? 1 : -1);
    return true;
  };
  grip.addEventListener("pointerdown", (e) => { startDrag(e.clientY, false); try { grip.setPointerCapture(e.pointerId); } catch { /* egal */ } });
  grip.addEventListener("pointercancel", () => { drag = null; });
  grip.addEventListener("pointerup", (e) => { if (endDrag(e.clientY)) { e.preventDefault(); grip.dataset.swiped = "1"; setTimeout(() => delete grip.dataset.swiped, 50); } });
  grip.addEventListener("click", (e) => { if (grip.dataset.swiped) e.stopImmediatePropagation(); }, true);
  body.addEventListener("click", (e) => { if (S.collapsed) { e.preventDefault(); e.stopImmediatePropagation(); setSize(1); } }, true); // eingeklappt: Tippen öffnet
  body.addEventListener("touchstart", (e) => { if (body.scrollTop <= 0 && e.touches.length === 1) startDrag(e.touches[0].clientY, true); }, { passive: true });
  body.addEventListener("touchend", (e) => { const t = e.changedTouches && e.changedTouches[0]; if (t) endDrag(t.clientY); }, { passive: true });

  function openInfo() {
    ui.openSheet({
      title: "🗺️ Karte & Route – gut zu wissen",
      bodyHTML: `<div class="kr-info">
        <p><b>🔒 Dein Standort bleibt bei dir.</b> Die App speichert ihn nirgends auf einem Server. Wenn du ein Ziel wählst, gehen nur Start- und Zielpunkt an den Routenrechner; wenn du eine Adresse suchst, nur der Suchtext an die Adresssuche.</p>
        <p><b>🧭 Routen</b> für Auto, zu Fuß und Rad kommen von den freien Servern der <a href="https://fossgis.de" target="_blank" rel="noopener">FOSSGIS e.V.</a> (routing.openstreetmap.de, OSRM). Die laufen ehrenamtlich – deshalb rechne ich jede Route nur einmal und merk sie mir kurz.</p>
        <p><b>🔎 Adresssuche</b> über <a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a> von OpenStreetMap – absichtlich erst auf Enter/➜, nicht bei jedem Buchstaben (so wollen es die Nutzungsregeln), höchstens 1 Anfrage pro Sekunde, Ergebnisse werden am Gerät zwischengespeichert.</p>
        <p><b>🚆 Öffis & ▶️ Navigation</b> öffnen Google Maps bzw. ÖBB Scotty – dort gelten deren Datenschutzregeln. Live-Navigation mit Ansagen gibt's in der App (noch) nicht.</p>
        <p><b>🕘 „Zuletzt“</b> (max. 10 Ziele) liegt nur in diesem Browser und wird beim Abmelden gelöscht.</p>
        <p class="note">Kartendaten © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a> (ODbL) · Karten-Kacheln: OpenStreetMap Foundation · Routen: FOSSGIS / OSRM · Karte: Leaflet</p>
      </div>`,
    });
  }

  /* ---------- Vorbelegung aus dem Hash ---------- */
  async function applyHash() {
    const h = R.parseKarteHash(location.hash);
    if (h.place) {
      const p = ((store.get() || {}).places || []).find((x) => x.id === h.place);
      if (!p) { ui.toast("Ort nicht gefunden 🤔", 2400); return; }
      const d = placeDest(p) || (p.addr ? await geocodeOne(p.addr, p.name) : null);
      if (d) chooseDest(d, { as: "to" });
      else ui.toast("Für diesen Ort ist noch keine Position oder Adresse gespeichert.", 3200);
    } else if (h.to) chooseDest(R.normDest({ name: h.name || "Ziel", lat: h.to.lat, lng: h.to.lng }), { as: "to" });
    else if (h.q) {
      const d = await geocodeOne(h.q, h.name || h.q.split(",")[0]);
      if (d) chooseDest(R.normDest({ ...d, sub: h.q }), { as: "to" });
      else { qIn.value = h.q; }
    }
  }
  const onHash = () => { if (/^#alltag\/karte\?/.test(location.hash)) applyHash(); };
  window.addEventListener("hashchange", onHash);
  const offStore = store.subscribe ? store.subscribe(() => { if (!S.dest && alive) render(); }) : null;
  const offK = kontakte.watch(() => { if (!S.dest && alive) render(); });

  render();
  ensureMap();
  applyHash();

  return () => {
    alive = false;
    stopFollow();
    stopLive(); document.removeEventListener("visibilitychange", onVis);
    if (rec) { try { rec.abort(); } catch { /* egal */ } }
    window.removeEventListener("resize", onResize);
    window.removeEventListener("hashchange", onHash);
    document.removeEventListener("pointerdown", onDocDown);
    if (typeof offStore === "function") offStore();
    if (typeof offK === "function") offK();
    if (map) { try { map.remove(); } catch { /* egal */ } map = null; }
  };
}
