// Kartenkacheln mit automatischem Ersatz-Server.
// Standard: OpenStreetMap (tile.openstreetmap.org). In manchen Android-WebViews/Netzen werden diese Kacheln blockiert
// (graue Karte). Kommen die ersten Kacheln nicht an, schaltet die Karte auf CARTO „Voyager“ um (ebenfalls OSM-Daten).
// Die Wahl wird am Gerät gemerkt (localStorage „sk-map-tiles“), damit es beim nächsten Mal sofort klappt.
const KEY = "sk-map-tiles";
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende';
export const PROVIDERS = {
  osm: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", opts: { maxZoom: 19, attribution: OSM_ATTR } },
  carto: { url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    opts: { maxZoom: 19, subdomains: "abcd", attribution: `${OSM_ATTR} · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>` } },
};
const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const set = (v) => { try { localStorage.setItem(KEY, v); } catch { /* egal */ } };

/** Fügt Kacheln hinzu; extraAttr wird an die Quellenangabe angehängt. → { layer, provider } */
export function addTiles(L, map, extraAttr = "") {
  let id = get() === "carto" ? "carto" : "osm";
  let layer = null, ok = 0, bad = 0, switched = false;
  const make = (pid) => {
    const p = PROVIDERS[pid];
    const l = L.tileLayer(p.url, { ...p.opts, attribution: p.opts.attribution + extraAttr });
    l.on("tileload", () => { ok++; if (pid === "carto" && !get()) set("carto"); });
    l.on("tileerror", () => {
      bad++;
      if (!switched && pid === "osm" && ok === 0 && bad >= 3) { // OSM kommt nicht an → Ersatz
        switched = true; map.removeLayer(l); id = "carto"; set("carto"); ok = 0; bad = 0;
        layer = make("carto").addTo(map);
      }
    });
    return l;
  };
  layer = make(id).addTo(map);
  // Falls gar kein Ereignis kommt (z. B. Kacheln hängen), nach 6 s ohne geladene Kachel ebenfalls umschalten.
  setTimeout(() => {
    if (!switched && id === "osm" && ok === 0 && map._loaded !== false) {
      switched = true; try { map.removeLayer(layer); } catch { /* egal */ } id = "carto"; set("carto"); layer = make("carto").addTo(map);
    }
  }, 6000);
  return { get layer() { return layer; }, get provider() { return id; } };
}

/** Lokale Leaflet-Kopie (vendor/leaflet, 1.9.4) – keine Abhängigkeit von unpkg mehr. */
export const LEAFLET_JS = new URL("../vendor/leaflet/leaflet.js", import.meta.url).href;
export const LEAFLET_CSS = new URL("../vendor/leaflet/leaflet.css", import.meta.url).href;
