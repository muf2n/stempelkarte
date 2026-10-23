// Reiter „Orte“: Karte (Leaflet, lazy geladen), Liste der Arbeitsorte und Formular zum Anlegen/Bearbeiten.

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const AT_CENTER = [47.6, 13.8];
const AT_ZOOM = 7;
const SHORT_HINT = "Für die automatische Erkennung bitte ‚Meinen Standort übernehmen‘ tippen, während du dort bist.";

let leafletPromise = null;

let root = null;
let C = null;          // ctx
let snap = null;       // letzter Snapshot
let map = null;
let layer = null;      // L.layerGroup mit Markern
let lastFitKey = "";
let myLoc = null;      // eigener Standort (falls bekannt)
let locAsked = false;

/* ---------- Hilfen ---------- */

function hasCoords(p) {
  return p && typeof p.lat === "number" && typeof p.lng === "number" &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

function accent() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return v || "#2f6fed";
  } catch { return "#2f6fed"; }
}

function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);
}

/**
 * Erste https-URL aus beliebigem Text holen und ggf. Koordinaten daraus lesen.
 * → { url: string, lat: number|null, lng: number|null, short: boolean }
 */
export function parseMapsLink(text) {
  const out = { url: "", lat: null, lng: null, short: false };
  const m = String(text || "").match(/https:\/\/[^\s<>"'`]+/i);
  if (!m) return out;
  out.url = m[0].replace(/[),.;!?]+$/, "");
  let s = out.url;
  try { s = decodeURIComponent(s); } catch { /* roh weiter */ }
  s = s.replace(/\+/g, " ");
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const tries = [
    new RegExp("!3d" + num + "!4d" + num),                                   // genaue Pin-Position
    new RegExp("[?&#](?:q|query|ll|center|destination)=(?:loc:)?\\s*" + num + "\\s*,\\s*" + num, "i"),
    new RegExp("@" + num + "," + num),                                       // Kartenmitte
  ];
  for (const re of tries) {
    const r = s.match(re);
    if (r) {
      const lat = parseFloat(r[1]), lng = parseFloat(r[2]);
      if (validLatLng(lat, lng)) { out.lat = lat; out.lng = lng; break; }
    }
  }
  out.short = out.lat === null && /(goo\.gl|maps\.app\.goo\.gl|g\.co)\//i.test(out.url);
  return out;
}

function monthHoursByPlace(entries) {
  const now = new Date();
  const from = C.util.startOfMonth(now.getFullYear(), now.getMonth()).getTime();
  const to = C.util.startOfMonth(now.getFullYear(), now.getMonth() + 1).getTime();
  const sums = {};
  for (const e of entries || []) {
    if (!e.placeId || e.start < from || e.start >= to) continue;
    sums[e.placeId] = (sums[e.placeId] || 0) + C.util.netMin(e);
  }
  return sums;
}

/* ---------- Leaflet ---------- */

function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      link.dataset.leaflet = "1";
      document.head.appendChild(link);
    }
    const sc = document.createElement("script");
    sc.src = LEAFLET_JS;
    sc.async = true;
    sc.dataset.leaflet = "1";
    sc.onload = () => (window.L ? resolve(window.L) : reject(new Error("Leaflet fehlt")));
    sc.onerror = () => { sc.remove(); reject(new Error("Leaflet konnte nicht geladen werden")); };
    document.head.appendChild(sc);
  }).catch((err) => { leafletPromise = null; throw err; });
  return leafletPromise;
}

function showMapNote(text) {
  const n = root && root.querySelector("[data-r=mapnote]");
  if (!n) return;
  n.textContent = text || "";
  n.hidden = !text;
}

async function ensureMap() {
  if (map) return map;
  const box = root.querySelector("[data-r=map]");
  try {
    const L = await loadLeaflet();
    if (map) return map;
    map = L.map(box, { zoomControl: true, attributionControl: true }).setView(AT_CENTER, AT_ZOOM);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap",
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    showMapNote("");
    box.hidden = false;
    drawMap(true);
    return map;
  } catch {
    box.hidden = true;
    showMapNote("Karte nicht verfügbar – keine Internetverbindung? Die Orte funktionieren trotzdem.");
    return null;
  }
}

function drawMap(forceFit) {
  if (!map || !layer || !window.L) return;
  const L = window.L;
  const col = accent();
  layer.clearLayers();
  const places = (snap && snap.places || []).filter(hasCoords);
  const pts = [];
  for (const p of places) {
    const ll = [p.lat, p.lng];
    pts.push(ll);
    L.circle(ll, { radius: p.radius || 150, color: col, weight: 1.5, fillColor: col, fillOpacity: 0.12 }).addTo(layer);
    L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: col, fillOpacity: 1 })
      .bindTooltip(p.name || "Ort")
      .on("click", () => openPlaceForm(p, null, C))
      .addTo(layer);
  }
  if (myLoc && hasCoords(myLoc)) {
    const ll = [myLoc.lat, myLoc.lng];
    pts.push(ll);
    if (myLoc.acc) L.circle(ll, { radius: Math.min(myLoc.acc, 500), color: "#1a73e8", weight: 0, fillOpacity: 0.12 }).addTo(layer);
    L.circleMarker(ll, { radius: 7, color: "#fff", weight: 2, fillColor: "#1a73e8", fillOpacity: 1 })
      .bindTooltip("Du bist hier").addTo(layer);
  }
  const key = pts.map((p) => p.join(",")).join(";");
  if (!forceFit && key === lastFitKey) return;
  lastFitKey = key;
  if (pts.length === 0) map.setView(AT_CENTER, AT_ZOOM);
  else if (pts.length === 1) map.setView(pts[0], 15);
  else map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
}

/* ---------- Liste ---------- */

function renderList() {
  const list = root.querySelector("[data-r=list]");
  const { esc, hm } = C.util;
  const places = (snap && snap.places) || [];
  if (places.length === 0) {
    list.innerHTML =
      `<div class="empty"><h3>Noch keine Orte</h3>` +
      `<p class="note">Speichere deine Arbeitsorte – dann erkennt die App beim Einstempeln automatisch, wo du bist.</p></div>`;
    return;
  }
  const sums = monthHoursByPlace(snap.entries);
  list.innerHTML = places.map((p) => {
    const bits = [`Radius ${p.radius || 150} m`];
    if (sums[p.id]) bits.push(`${hm(Math.round(sums[p.id]))} h diesen Monat`);
    if (!hasCoords(p)) bits.push("keine Position");
    return `<button type="button" class="place-item" data-id="${esc(p.id)}">` +
      `<strong>${esc(p.name || "Ohne Namen")}</strong>` +
      (p.addr ? `<span class="note">${esc(p.addr)}</span>` : "") +
      `<span class="note">${esc(bits.join(" · "))}</span>` +
      `</button>`;
  }).join("");
}

/* ---------- Standort ---------- */

async function maybeLocate() {
  if (locAsked) return;
  locAsked = true;
  try {
    if ((await C.geo.permission()) !== "granted") return;
    myLoc = await C.geo.getPosition({ timeout: 10000, maxAge: 120000 });
    drawMap(true);
  } catch { /* still */ }
}

/* ---------- View-Schnittstelle ---------- */

export function mount(el, ctx) {
  root = el;
  C = ctx;
  el.innerHTML =
    `<div class="stack">` +
      `<div class="section-h"><h2>Arbeitsorte</h2>` +
        `<button type="button" class="btn sm ghost" data-r="new">+ Neuer Ort</button></div>` +
      `<div class="map" data-r="map"></div>` +
      `<p class="hint" data-r="mapnote" hidden></p>` +
      `<button type="button" class="btn primary" data-r="here">Aktuellen Standort als Ort speichern</button>` +
      `<div class="stack" data-r="list"></div>` +
    `</div>`;

  el.querySelector("[data-r=new]").addEventListener("click", () => openPlaceForm(null, null, C));

  const here = el.querySelector("[data-r=here]");
  here.addEventListener("click", async () => {
    C.ui.setBusy(here, true, "Standort wird ermittelt …");
    try {
      const loc = await C.geo.getPosition({ timeout: 12000, maxAge: 0 });
      myLoc = loc;
      drawMap(true);
      openPlaceForm(null, loc, C);
    } catch (err) {
      C.ui.toast((err && err.message) || "Standort konnte nicht ermittelt werden.", 3600);
    } finally {
      C.ui.setBusy(here, false);
    }
  });

  el.querySelector("[data-r=list]").addEventListener("click", (ev) => {
    const b = ev.target.closest(".place-item");
    if (!b) return;
    const p = ((snap && snap.places) || []).find((x) => x.id === b.dataset.id);
    if (p) openPlaceForm(p, null, C);
  });

  snap = ctx.store.get ? ctx.store.get() : null;
  if (snap) renderList();
}

export function update(s) {
  snap = s;
  if (!root) return;
  renderList();
  drawMap(false);
}

export function tick() {}

export async function onShow() {
  if (!root) return;
  const m = await ensureMap();
  if (m) setTimeout(() => { try { m.invalidateSize(); drawMap(false); } catch { /* egal */ } }, 60);
  maybeLocate();
}

/* ---------- Formular ---------- */

export function openPlaceForm(place, presetLoc, ctx) {
  const c = ctx || C;
  const { esc } = c.util;
  const settings = (c.store.get && c.store.get().settings) || {};
  const isNew = !place || !place.id;
  const st = {
    lat: hasCoords(place) ? place.lat : (hasCoords(presetLoc) ? presetLoc.lat : null),
    lng: hasCoords(place) ? place.lng : (hasCoords(presetLoc) ? presetLoc.lng : null),
  };
  const radius0 = Math.min(1000, Math.max(50, Number(place && place.radius) || Number(settings.defaultRadius) || 150));

  const bodyHTML =
    `<div class="fields">` +
      `<label>Name<input id="pf-name" type="text" autocomplete="off" placeholder="z. B. Baustelle Linz" value="${esc(place ? place.name || "" : "")}"></label>` +
      `<label>Adresse<input id="pf-addr" type="text" autocomplete="off" placeholder="Straße Nr, Ort" value="${esc(place ? place.addr || "" : (presetLoc && presetLoc.addr) || "")}"></label>` +
      `<label>Erkennungs-Radius: <b data-r="rval">${radius0} m</b>` +
        `<input id="pf-radius" type="range" min="50" max="1000" step="10" value="${radius0}"></label>` +
      `<p class="note" data-r="coords"></p>` +
      `<div class="row">` +
        `<button type="button" class="btn sm ghost" data-r="useloc">Meinen Standort übernehmen</button>` +
        `<button type="button" class="btn sm ghost" data-r="open">In Maps öffnen</button>` +
      `</div>` +
      `<label>Google-Maps-Link (optional)<input id="pf-link" type="url" inputmode="url" autocomplete="off" placeholder="Link hier einfügen" value="${esc(place ? place.link || "" : "")}"></label>` +
      `<p class="hint" data-r="linkhint" hidden></p>` +
    `</div>` +
    `<div class="stack" style="margin-top:14px">` +
      `<button type="button" class="btn primary" data-r="save">Speichern</button>` +
      (isNew ? "" : `<button type="button" class="btn danger" data-r="del">Ort löschen</button>`) +
    `</div>`;

  c.ui.openSheet({
    title: isNew ? "Neuer Arbeitsort" : "Ort bearbeiten",
    bodyHTML,
    onMount(sheet, close) {
      const $ = (sel) => sheet.querySelector(sel);
      const fName = $("#pf-name"), fAddr = $("#pf-addr"), fRad = $("#pf-radius"), fLink = $("#pf-link");
      const coordsEl = $("[data-r=coords]"), linkHint = $("[data-r=linkhint]");

      const showCoords = () => {
        coordsEl.textContent = st.lat !== null
          ? `Position: ${st.lat.toFixed(5)}, ${st.lng.toFixed(5)}`
          : "Keine Position gespeichert – der Ort wird beim Stempeln nicht automatisch erkannt.";
      };
      const setLinkHint = (t) => { linkHint.textContent = t || ""; linkHint.hidden = !t; };
      showCoords();

      fRad.addEventListener("input", () => { $("[data-r=rval]").textContent = fRad.value + " m"; });

      const fillAddr = async (lat, lng) => {
        if (fAddr.value.trim()) return;
        const a = await c.geo.reverseGeocode(lat, lng);
        if (a && !fAddr.value.trim()) fAddr.value = a;
      };
      if (isNew && hasCoords(presetLoc) && !fAddr.value.trim()) fillAddr(presetLoc.lat, presetLoc.lng);

      const useBtn = $("[data-r=useloc]");
      useBtn.addEventListener("click", async () => {
        c.ui.setBusy(useBtn, true, "Standort wird ermittelt …");
        try {
          const loc = await c.geo.getPosition({ timeout: 12000, maxAge: 0 });
          st.lat = loc.lat; st.lng = loc.lng;
          myLoc = loc;
          showCoords();
          setLinkHint("");
          c.ui.toast(`Standort übernommen (±${Math.round(loc.acc || 0)} m)`);
          await fillAddr(loc.lat, loc.lng);
        } catch (err) {
          c.ui.toast((err && err.message) || "Standort konnte nicht ermittelt werden.", 3600);
        } finally {
          c.ui.setBusy(useBtn, false);
        }
      });

      $("[data-r=open]").addEventListener("click", () => {
        const parsed = parseMapsLink(fLink.value);
        const url = c.geo.placeMapsUrl({ link: parsed.url, lat: st.lat, lng: st.lng, addr: fAddr.value.trim() });
        if (url) window.open(url, "_blank", "noopener");
        else c.ui.toast("Noch keine Position oder Adresse vorhanden.");
      });

      const onLink = () => {
        const raw = fLink.value.trim();
        if (!raw) { setLinkHint(""); return; }
        const p = parseMapsLink(raw);
        if (!p.url) { setLinkHint("Kein gültiger Link gefunden (muss mit https:// beginnen)."); return; }
        if (p.url !== raw) fLink.value = p.url;
        if (p.lat !== null) {
          st.lat = p.lat; st.lng = p.lng;
          showCoords();
          setLinkHint("Position aus dem Link übernommen.");
          fillAddr(p.lat, p.lng);
        } else {
          setLinkHint((p.short ? "Kurzlink erkannt – er enthält keine Koordinaten. " : "Link enthält keine Koordinaten. ") + SHORT_HINT);
        }
      };
      fLink.addEventListener("change", onLink);
      fLink.addEventListener("paste", () => setTimeout(onLink, 0));

      const saveBtn = $("[data-r=save]");
      saveBtn.addEventListener("click", async () => {
        const name = fName.value.trim();
        if (!name) { c.ui.toast("Bitte einen Namen eingeben."); fName.focus(); return; }
        const parsed = parseMapsLink(fLink.value);
        if (st.lat === null && parsed.lat !== null) { st.lat = parsed.lat; st.lng = parsed.lng; }
        const data = {
          ...(place || {}),
          name,
          addr: fAddr.value.trim(),
          link: parsed.url || "",
          lat: st.lat,
          lng: st.lng,
          radius: Math.round(Number(fRad.value) || 150),
        };
        if (isNew) delete data.id;
        c.ui.setBusy(saveBtn, true, "Speichert …");
        try {
          await c.store.savePlace(data);
          close();
          c.ui.toast(st.lat === null ? "Gespeichert – noch ohne Position." : "Ort gespeichert.");
        } catch {
          c.ui.setBusy(saveBtn, false);
        }
      });

      const delBtn = $("[data-r=del]");
      if (delBtn) {
        c.ui.confirmButton(delBtn, "Wirklich löschen?", async () => {
          try {
            await c.store.deletePlace(place.id);
            close();
            c.ui.toast("Ort gelöscht.");
          } catch { /* Toast kommt vom Store */ }
        });
      }

      if (isNew && !fName.value) setTimeout(() => { try { fName.focus(); } catch { /* egal */ } }, 50);
    },
  });
}
