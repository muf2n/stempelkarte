// Einstiegspunkt: verbindet Anmeldung, Datenspeicher, Reiter-Navigation, Sync-Anzeige und Service Worker.
import { isConfigured } from "./firebase-config.js";
import { initAuth, signIn as authSignIn, signOut as authSignOut } from "./auth.js";
import * as store from "./store.js";
import * as timer from "./timer.js";
import * as geo from "./geo.js";
import * as geofence from "./geofence.js";
import * as ui from "./ui.js";
import * as util from "./util.js";
import * as exporter from "./export.js";
import * as today from "./views/today.js";
import * as entries from "./views/entries.js";
import * as overview from "./views/overview.js";
import * as places from "./views/places.js";
import { openEntryForm } from "./views/entries.js";
import { openPlaceForm } from "./views/places.js";

const TABS = ["heute", "eintraege", "uebersicht", "orte"];
const VIEWS = { heute: today, eintraege: entries, uebersicht: overview, orte: places };
const FORCE_LOCAL_KEY = "stempelkarte.forceLocal";
const firebaseConfigured = isConfigured();

const $ = (sel) => document.querySelector(sel);
const syncEl = $("#sync-status");
const loginEl = $("#login");
const tabbarEl = $("#tabbar");

let mounted = false;
let appVisible = false;
let currentTab = null;
let lastSnap = null;
let authStarted = false;
let currentUid = null;
let loading = false;

// ---------- Hilfen ----------
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch { /* egal */ } }

function errMsg(e) {
  if (!e) return "Unbekannter Fehler";
  if (typeof e === "string") return e;
  return e.message || e.code || String(e);
}

function safe(fn, ...args) {
  try {
    const r = fn && fn(...args);
    if (r && typeof r.catch === "function") r.catch((e) => console.error(e));
  } catch (e) { console.error(e); }
}

// ---------- ctx ----------
const ctx = {
  store, timer, geo, geofence, ui, util, exporter,
  firebaseConfigured,
  openEntryForm: (entry = null) => openEntryForm(entry, ctx),
  openPlaceForm: (place = null, presetLoc = null) => openPlaceForm(place, presetLoc, ctx),
  go: (tab) => go(tab),
  signIn: () => doSignIn(),
  signOut: () => doSignOut(),
};

// ---------- Sync-Status ----------
function renderSync() {
  if (!syncEl) return;
  syncEl.classList.remove("ok", "off");
  if (loading) { syncEl.textContent = "Lade …"; return; }
  if (!navigator.onLine) { syncEl.textContent = "Offline"; syncEl.classList.add("off"); return; }
  if (lastSnap && lastSnap.mode === "cloud") { syncEl.textContent = "Synchron"; syncEl.classList.add("ok"); return; }
  syncEl.textContent = "Nur dieses Gerät";
}
window.addEventListener("online", renderSync);
window.addEventListener("offline", renderSync);

function setLoading(on) { loading = on; renderSync(); }

// ---------- Views ----------
function mountViews() {
  if (mounted) return;
  mounted = true;
  for (const tab of TABS) {
    const el = document.getElementById("view-" + tab);
    if (el) safe(VIEWS[tab].mount, el, ctx);
  }
  store.subscribe((snap) => {
    lastSnap = snap;
    for (const tab of TABS) safe(VIEWS[tab].update, snap);
    renderSync();
  });
  setInterval(() => safe(today.tick), 1000);
}

function tabFromHash() {
  const h = (location.hash || "").replace(/^#/, "");
  return TABS.includes(h) ? h : "heute";
}

function showTab(tab) {
  if (!appVisible) return;
  const changed = tab !== currentTab;
  currentTab = tab;
  for (const t of TABS) {
    const el = document.getElementById("view-" + t);
    if (el) el.hidden = t !== tab;
  }
  if (tabbarEl) {
    tabbarEl.querySelectorAll("[data-tab]").forEach((b) => {
      b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
    });
  }
  if (changed) {
    window.scrollTo(0, 0);
    safe(VIEWS[tab].onShow);
  }
}

function go(tab) {
  if (!TABS.includes(tab)) tab = "heute";
  if (location.hash !== "#" + tab) location.hash = tab; // löst hashchange aus
  else showTab(tab);
}

window.addEventListener("hashchange", () => showTab(tabFromHash()));

if (tabbarEl) {
  tabbarEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-tab]");
    if (b) go(b.dataset.tab);
  });
}

function showApp() {
  setLoading(false);
  if (loginEl) loginEl.hidden = true;
  if (tabbarEl) tabbarEl.hidden = false;
  mountViews();
  appVisible = true;
  currentTab = null;
  showTab(tabFromHash());
}

function showLogin() {
  setLoading(false);
  appVisible = false;
  currentTab = null;
  for (const t of TABS) {
    const el = document.getElementById("view-" + t);
    if (el) el.hidden = true;
  }
  if (tabbarEl) tabbarEl.hidden = true;
  if (loginEl) loginEl.hidden = false;
  const btn = $("#btn-login");
  if (btn) safe(ui.setBusy, btn, false);
}

// ---------- Modi ----------
function startLocalMode() {
  currentUid = null;
  safe(store.stop);
  store.startLocal();
  showApp();
}

async function onUser(user) {
  if (user) {
    lsDel(FORCE_LOCAL_KEY);
    if (currentUid === user.uid && appVisible) return;
    currentUid = user.uid;
    setLoading(true);
    safe(store.stop);
    try {
      await store.startCloud(user);
    } catch (e) {
      ui.toast("Daten konnten nicht geladen werden: " + errMsg(e), 4000);
    }
    showApp();
  } else {
    if (currentUid) safe(store.stop);
    currentUid = null;
    if (lsGet(FORCE_LOCAL_KEY) === "1") {
      if (!appVisible || (lastSnap && lastSnap.mode === "cloud")) startLocalMode();
      else setLoading(false);
    } else {
      showLogin();
    }
  }
}

async function ensureAuth() {
  if (authStarted) return;
  authStarted = true;
  await initAuth((u) => { onUser(u).catch((e) => ui.toast(errMsg(e), 4000)); });
}

async function doSignIn() {
  if (!firebaseConfigured) {
    ui.toast("Firebase ist noch nicht eingerichtet – siehe Anleitung.", 4000);
    return;
  }
  try {
    await ensureAuth();
    await authSignIn();
  } catch (e) {
    ui.toast("Anmeldung fehlgeschlagen: " + errMsg(e), 4000);
    const btn = $("#btn-login");
    if (btn) safe(ui.setBusy, btn, false);
  }
}

async function doSignOut() {
  safe(store.stop);
  currentUid = null;
  lsDel(FORCE_LOCAL_KEY);
  try {
    if (firebaseConfigured && authStarted) await authSignOut();
  } catch (e) {
    ui.toast("Abmelden fehlgeschlagen: " + errMsg(e), 4000);
  }
  if (firebaseConfigured) showLogin();
  else startLocalMode();
}

// Login-Knöpfe
const btnLogin = $("#btn-login");
if (btnLogin) {
  btnLogin.addEventListener("click", () => {
    safe(ui.setBusy, btnLogin, true, "Anmeldung läuft …");
    doSignIn();
  });
}
const btnLocal = $("#btn-local");
if (btnLocal) {
  btnLocal.addEventListener("click", () => {
    lsSet(FORCE_LOCAL_KEY, "1");
    startLocalMode();
  });
}

// ---------- Start ----------
async function boot() {
  if (loginEl) loginEl.hidden = true;
  if (tabbarEl) tabbarEl.hidden = true;
  if (!firebaseConfigured) { startLocalMode(); return; }
  if (lsGet(FORCE_LOCAL_KEY) === "1") {
    startLocalMode();
    // Auth trotzdem starten, damit ein Redirect-Login oder bestehende Sitzung erkannt wird
    ensureAuth().catch((e) => console.warn(e));
    return;
  }
  setLoading(true);
  try {
    await ensureAuth();
  } catch (e) {
    ui.toast("Anmeldung nicht verfügbar: " + errMsg(e), 4000);
    authStarted = false;
    showLogin();
  }
}

// ---------- Globale Fehler ----------
window.addEventListener("unhandledrejection", (ev) => {
  ev.preventDefault();
  console.error(ev.reason);
  try { ui.toast("Fehler: " + errMsg(ev.reason), 4000); } catch { /* egal */ }
});

// ---------- Service Worker ----------
// Updates kommen automatisch: neuer SW übernimmt sofort (skipWaiting/claim), die Seite lädt
// dann einmal neu – aber nie mitten in einer Eingabe oder bei offenem Blatt.
const UPDATED_FLAG = "stempelkarte.updated";
const RELOAD_TS_KEY = "stempelkarte.reloadTs";
const UPDATE_EVERY_MS = 30 * 60 * 1000;

function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* egal */ } }
function ssDel(k) { try { sessionStorage.removeItem(k); } catch { /* egal */ } }

// Nach einem automatischen Neuladen kurz bestätigen
if (ssGet(UPDATED_FLAG) === "1") {
  ssDel(UPDATED_FLAG);
  setTimeout(() => { try { ui.toast("App aktualisiert ✓", 2400); } catch { /* egal */ } }, 600);
}

if ("serviceWorker" in navigator) {
  // War beim Laden schon ein SW aktiv? Wenn nicht, ist das die Erstinstallation → kein Neuladen nötig.
  const hadController = !!navigator.serviceWorker.controller;
  let reloadPending = false;
  let reloaded = false;
  let swReg = null;

  const isBusy = () => {
    const sheet = document.getElementById("sheet-root");
    if (sheet && sheet.children.length > 0) return true;
    const a = document.activeElement;
    if (a && a !== document.body && (a.matches("input, textarea, select") || a.isContentEditable)) return true;
    return false;
  };

  const doReload = () => {
    if (reloaded) return;
    // Schutz gegen Schleifen: höchstens ein automatisches Neuladen pro 30 s
    const last = Number(ssGet(RELOAD_TS_KEY) || 0);
    if (Date.now() - last < 30000) { reloadPending = false; return; }
    reloaded = true;
    reloadPending = false;
    ssSet(RELOAD_TS_KEY, String(Date.now()));
    ssSet(UPDATED_FLAG, "1");
    location.reload();
  };

  const tryReload = () => {
    if (!reloadPending || reloaded) return;
    if (document.visibilityState === "hidden" || !isBusy()) doReload();
    // sonst: beim nächsten Wechsel in den Hintergrund/Vordergrund erneut versuchen
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloadPending = true;
    tryReload();
  });

  const checkUpdate = () => {
    if (!swReg || !navigator.onLine) return;
    swReg.update().catch(() => { /* offline o. ä. – egal */ });
  };

  document.addEventListener("visibilitychange", () => {
    if (reloadPending) { tryReload(); return; }
    if (document.visibilityState === "visible") checkUpdate();
  });
  window.addEventListener("online", checkUpdate);
  setInterval(checkUpdate, UPDATE_EVERY_MS);

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((reg) => { swReg = reg; })
      .catch(() => { /* ignorieren */ });
  });
}

renderSync();
boot();
