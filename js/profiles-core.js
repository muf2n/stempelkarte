// Update 10 F – 👤 App-Profile & 🧩 Module ein/aus: reine Logik ohne DOM (Node-testbar).
//   settings.profiles = { active: "standard"|"arbeit"|"schule"|"privat"|"urlaub"|"fokus", slots: { <id>: { dashboard, notifyOff } } }
//   settings.modules  = { off: [Alltag-Modul-IDs] }  – ausgeschaltete Bereiche: weg aus Alltag-Raster, Suche, Mitteilungen, Überblick.
// Ein Profil setzt beim Wechsel settings.dashboard (Widgets/Reihenfolge) und settings.notify.off (stumme Kategorien) – also genau die
// bestehenden Einstellungen. Was du in einem Profil anpasst, merkt sich dieses Profil (Stand wird beim Verlassen in slots gesichert).
// Daten werden nie gelöscht.

export const PROFILES = [
  { id: "standard", e: "🏠", t: "Standard", sub: "Deine eigene Einstellung" },
  { id: "arbeit", e: "💼", t: "Arbeit", sub: "Baustelle, Wetter & Stunden zuerst", privat: false,
    dashboard: { auto: false, order: ["site", "weather", "agenda", "balance", "faellig", "tip", "calendar", "reminders", "einkauf", "sync"], hidden: ["money", "school", "haushalt"] },
    mute: ["haushalt", "gewohnheiten", "geld"] },
  { id: "schule", e: "🎒", t: "Schule", sub: "Prüfungen & Hausübungen im Fokus",
    dashboard: { auto: false, order: ["school", "agenda", "calendar", "weather", "tip", "reminders", "balance", "sync"], hidden: ["site", "faellig", "money", "einkauf", "haushalt"] },
    mute: ["material", "werkzeug", "fahrzeug", "arbeitszeit"] },
  { id: "privat", e: "🏡", t: "Privat", sub: "Feierabend – Arbeit tritt in den Hintergrund", privat: true,
    dashboard: { auto: false, order: ["agenda", "calendar", "weather", "reminders", "haushalt", "einkauf", "money", "tip", "sync"], hidden: ["site", "balance", "faellig", "school"] },
    mute: ["arbeitszeit", "material", "werkzeug", "bericht"] },
  { id: "urlaub", e: "🌴", t: "Urlaub", sub: "Nur das Nötigste – genieß die Zeit", privat: true,
    dashboard: { auto: false, order: ["weather", "agenda", "calendar", "reminders", "einkauf", "haushalt", "sync"], hidden: ["site", "balance", "faellig", "school", "money", "tip"] },
    mute: ["arbeitszeit", "material", "werkzeug", "bericht", "schule", "backup"] },
  { id: "fokus", e: "🎯", t: "Fokus", sub: "Nur Termine & Aufgaben, kaum Ablenkung",
    dashboard: { auto: false, order: ["agenda", "tip"], hidden: ["balance", "calendar", "site", "money", "school", "einkauf", "faellig", "haushalt", "weather", "reminders", "sync"] },
    mute: ["geburtstage", "geld", "dokumente", "material", "werkzeug", "fahrzeug", "haushalt", "gewohnheiten", "bericht", "backup", "automation"] },
];
export const PROFILE_IDS = PROFILES.map((p) => p.id);
export const profileById = (id) => PROFILES.find((p) => p.id === id) || PROFILES[0];

/** Mitteilungs-Kategorien (js/notify-core.js CATS) je Alltag-Modul. */
export const MODULE_NOTIFY = {
  geld: ["geld"],
  schule: ["schule"],
  material: ["material"],
  werkzeug: ["werkzeug"],
  fahrzeuge: ["fahrzeug"],
  haushalt: ["haushalt", "muell", "vorrat"],
  routinen: ["gewohnheiten"],
  automationen: ["automation"],
  vertraege: ["vertraege"], // Update 10 E
  listen: ["geschenke"], // Update 11
  tiere: ["tiere"], karriere: ["karriere"], wohnen: ["verleih"], gruppen: ["gruppen"], // Update 12
  inventar: ["garantie"], // Update 10 E
  buchhaltung: ["rechnungen"], // Update 10 – 💼 Buchhaltung
};
/** Optionale Module: standardmäßig AUS, bis sie jemand einschaltet (settings.modules.on). */
export const DEFAULT_OFF = ["buchhaltung"];
export const isOptional = (id) => DEFAULT_OFF.includes(id);
/** Überblick-Widgets (js/dashboard-core.js) je Modul; ein Widget verschwindet erst, wenn ALLE seine Module aus sind. */
export const WIDGET_MODULES = {
  money: ["geld"],
  school: ["schule"],
  einkauf: ["einkauf"],
  faellig: ["werkzeug", "fahrzeuge"],
  haushalt: ["haushalt", "routinen"],
  lernen: ["japanisch", "lap"], // Update 10 – Lernpfad
};
/** Suchtreffer-Ziel (go.t in js/views/search.js) → Modul. */
export const SEARCH_MODULE = {
  geld: "geld", school: "schule", uw: "unterwegs", einkauf: "einkauf", material: "material", werkzeug: "werkzeug",
  fahrzeug: "fahrzeuge", jp: "japanisch", lap: "lap", rt: "routinen", mem: "notizen", photo: "galerie", album: "galerie",
};

const uniq = (a) => [...new Set(a)];
const strList = (a) => (Array.isArray(a) ? uniq(a.filter((x) => typeof x === "string" && x && x.length <= 40)) : []);

/** settings.modules → Set ausgeschalteter Modul-IDs. knownIds (optional) filtert auf bekannte. */
function rawMods(settings) {
  const m = settings && settings.modules && typeof settings.modules === "object" ? settings.modules : {};
  return { off: strList(m.off), on: strList(m.on) };
}
export function modulesOff(settings, knownIds = null) {
  const { off, on } = rawMods(settings);
  for (const id of DEFAULT_OFF) if (!on.includes(id) && !off.includes(id)) off.push(id); // optionale Module: aus, bis eingeschaltet
  return new Set(knownIds ? off.filter((x) => knownIds.includes(x)) : off);
}
export const moduleOn = (settings, id) => !modulesOff(settings).has(id);

/** Neuen Wert für settings.modules. */
export function toggleModule(settings, id, on) {
  const r = rawMods(settings);
  const off = new Set(r.off), onSet = new Set(r.on);
  if (on) { off.delete(id); if (isOptional(id)) onSet.add(id); } else { off.add(id); onSet.delete(id); }
  return onSet.size ? { off: [...off].sort(), on: [...onSet].sort() } : { off: [...off].sort() };
}

/** Durch ausgeschaltete Module stumme Mitteilungs-Kategorien. */
export function mutedByModules(settings) {
  const off = modulesOff(settings);
  const out = new Set();
  for (const [mod, cats] of Object.entries(MODULE_NOTIFY)) if (off.has(mod)) cats.forEach((c) => out.add(c));
  return out;
}
/** Durch ausgeschaltete Module verborgene Überblick-Widgets. */
export function hiddenWidgetsByModules(settings) {
  const off = modulesOff(settings);
  const out = new Set();
  for (const [w, mods] of Object.entries(WIDGET_MODULES)) if (mods.every((m) => off.has(m))) out.add(w);
  return out;
}
/** Suchtreffer erlaubt? (go = { t, hash?, h? }) */
export function searchAllowed(settings, go) {
  const off = modulesOff(settings);
  if (!off.size || !go) return true;
  const mod = SEARCH_MODULE[go.t];
  if (mod && off.has(mod)) return false;
  const h = String(go.hash || go.h || "");
  const m = /^#alltag\/([a-z0-9_-]+)/.exec(h);
  return !(m && off.has(m[1]));
}

/** settings.profiles normalisiert. */
export function readProfiles(settings) {
  const p = settings && settings.profiles && typeof settings.profiles === "object" ? settings.profiles : {};
  const active = PROFILE_IDS.includes(p.active) ? p.active : "standard";
  const slots = {};
  const raw = p.slots && typeof p.slots === "object" ? p.slots : {};
  for (const id of PROFILE_IDS) {
    const x = raw[id];
    if (!x || typeof x !== "object") continue;
    slots[id] = {
      dashboard: x.dashboard && typeof x.dashboard === "object" ? { order: strList(x.dashboard.order), hidden: strList(x.dashboard.hidden), auto: x.dashboard.auto !== false } : null,
      notifyOff: strList(x.notifyOff),
    };
  }
  return { active, slots };
}

function curDashboard(settings) {
  const d = settings && settings.dashboard && typeof settings.dashboard === "object" ? settings.dashboard : {};
  return { order: strList(d.order), hidden: strList(d.hidden), auto: d.auto !== false };
}
function curNotifyOff(settings) {
  const n = settings && settings.notify && typeof settings.notify === "object" ? settings.notify : {};
  return strList(n.off);
}

/**
 * Profil wechseln → Teil-Einstellungen zum Speichern (store.saveSettings):
 *   { profiles, dashboard, notify: { off }, mode? }
 * Der Stand des bisherigen Profils wird in slots gesichert; das Ziel nimmt seinen gesicherten Stand, sonst die Vorgabe.
 * modeFn(privat) → Wert für settings.mode (Privat/Arbeit) – nur wenn das Profil das will (oder ein Privat-Profil verlassen wird).
 */
export function switchProfile(settings, toId, { modeFn = null } = {}) {
  const to = profileById(toId);
  const cur = readProfiles(settings);
  const from = profileById(cur.active);
  const slots = { ...cur.slots, [from.id]: { dashboard: curDashboard(settings), notifyOff: curNotifyOff(settings) } };
  const saved = slots[to.id];
  let dashboard, off;
  if (saved && saved.dashboard) { dashboard = saved.dashboard; off = saved.notifyOff; }
  else if (to.dashboard) { dashboard = { order: to.dashboard.order.slice(), hidden: to.dashboard.hidden.slice(), auto: to.dashboard.auto !== false }; off = to.mute.slice(); }
  else { dashboard = { order: [], hidden: [], auto: true }; off = []; } // Standard ohne gesicherten Stand
  const patch = { profiles: { active: to.id, slots }, dashboard, notify: { off: uniq(off) } };
  if (modeFn) {
    if (typeof to.privat === "boolean") patch.mode = modeFn(to.privat);
    else if (from.privat === true && from.id !== to.id) patch.mode = modeFn(false);
  }
  return patch;
}

/** Ziel-Profil auf seine Vorgabe zurücksetzen (Slot vergessen) – nur für das aktive sinnvoll. */
export function resetProfile(settings, id) {
  const cur = readProfiles(settings);
  const slots = { ...cur.slots, [id]: null }; // null statt löschen: Firestore-merge behält sonst den alten Slot
  const p = profileById(id);
  const patch = { profiles: { active: cur.active, slots } };
  if (cur.active === id) {
    patch.dashboard = p.dashboard ? { order: p.dashboard.order.slice(), hidden: p.dashboard.hidden.slice(), auto: p.dashboard.auto !== false } : { order: [], hidden: [], auto: true };
    patch.notify = { off: p.mute ? p.mute.slice() : [] };
  }
  return patch;
}
