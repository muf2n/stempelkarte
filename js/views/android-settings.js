// Einstellungs-Karte „Android-App“ (#android-panel, Agent X) – nur in der nativen Hülle sichtbar.
// Zeigt Berechtigungen (Hintergrund-Standort, Akku, Schritte, Erinnerungen) mit Knöpfen
// und die Auto-Stempeln-Einstellungen settings.native = { autoClock: "auto"|"ask"|"off", autoClockOut: bool }.
import { icon } from "../icons.js";
import { isNative } from "../native.js";
import * as ns from "../native-sync.js";

let ctx = null;
let root = null;
let snap = null;
let busy = "";
let nat = null;      // Ergebnis StempelNative.status() oder { missing:true }
let health = null;   // Ergebnis StempelHealth.status() oder { missing:true }
let push = null;     // native-sync.pushStatus()
let refreshing = null;

const $ = (sel) => root.querySelector(sel);
const PHONE_ICO = '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';
const UPDATE_TXT = "kommt mit dem nächsten App-Update";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pad(n) { return (n < 10 ? "0" : "") + n; }

export function readNative(settings) {
  const n = (settings && settings.native && typeof settings.native === "object") ? settings.native : {};
  return {
    autoClock: ["auto", "ask", "off"].includes(n.autoClock) ? n.autoClock : "auto",
    autoClockOut: n.autoClockOut === true,
  };
}

const STYLE = `
#android-panel.rm { display:flex; flex-direction:column; gap:12px; margin-top:4px; padding-top:16px; border-top:1px solid var(--line); }
#android-panel[hidden] { display:none; }
#android-panel .an-list { display:flex; flex-direction:column; gap:10px; }
#android-panel .an-row { display:flex; flex-direction:column; gap:8px; padding:10px 14px; border-radius:var(--r-sm);
  background:color-mix(in srgb, var(--soft) 55%, var(--card)); border:1px solid color-mix(in srgb, var(--accent) 12%, var(--line)); }
#android-panel .an-top { display:flex; gap:10px; align-items:flex-start; }
#android-panel .an-dot { flex:none; width:12px; height:12px; margin-top:5px; border-radius:50%; background:var(--muted); opacity:.6; }
#android-panel .an-dot.ok { background:var(--run); opacity:1; }
#android-panel .an-dot.bad { background:var(--danger); opacity:1; }
#android-panel .an-dot.wait { background:var(--pause, var(--accent)); opacity:1; }
#android-panel .an-txt { display:flex; flex-direction:column; gap:2px; min-width:0; }
#android-panel .an-txt b { color:var(--ink); font-weight:600; }
#android-panel .an-txt small { color:var(--muted); font-size:.86rem; line-height:1.35; }
#android-panel .an-row .btn { min-height:46px; justify-content:center; text-align:center; white-space:normal; }
#android-panel .an-row .btn:disabled { opacity:.55; }
#android-panel .an-btns { display:flex; flex-wrap:wrap; gap:8px; }
#android-panel .an-btns .btn { flex:1 1 180px; }
#android-panel .an-sel select { width:100%; }
#android-panel .an-off { opacity:.5; }
#android-panel .an-last { margin:0; font-variant-numeric:tabular-nums; }
`;

export function mount(el, c) {
  if (!el) return;
  ctx = c;
  root = el;
  if (!isNative()) { root.hidden = true; return; }
  root.hidden = false;
  root.classList.add("rm", "an");
  if (!document.getElementById("an-style")) {
    const st = document.createElement("style");
    st.id = "an-style";
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico">${PHONE_ICO}</span>
      <div><div class="rm-title">Android-App</div>
      <p class="note">Automatisch stempeln am Arbeitsort, Schritte vom Handy und Erinnerungen – auch wenn die App zu ist.</p></div>
    </div>
    <div class="an-list" id="an-list" aria-live="polite"></div>
    <div class="rm-opt">
      <label class="an-sel">Auto-Stempeln am Arbeitsort
        <select id="an-auto">
          <option value="auto">automatisch einstempeln</option>
          <option value="ask">nur fragen</option>
          <option value="off">aus</option>
        </select>
      </label>
      <p class="note">„Automatisch“: Kommst du bei einem gespeicherten Ort an, wird eingestempelt und du bekommst eine Nachricht mit „Rückgängig“. „Nur fragen“: eine Nachricht mit Knopf zum Einstempeln.</p>
    </div>
    <div class="rm-opt" id="an-out-wrap">
      <label class="switch"><span>Automatisch ausstempeln</span><input type="checkbox" id="an-out"></label>
      <p class="note">Aus: Beim Verlassen des Orts kommt nur die Frage „Ausstempeln?“. An: Nach 5 Minuten außerhalb wird ausgestempelt.</p>
    </div>
    <div class="an-btns">
      <button class="btn" type="button" id="an-sync">${icon("swap", 18)}<span>Schritte jetzt abgleichen</span></button>
    </div>
    <p class="note an-last" id="an-last"></p>
    <details class="lk-help">
      <summary>Xiaomi: damit es im Hintergrund klappt</summary>
      <p class="note">1. „Hintergrund-Standort erlauben“ → Standort auf <b>Immer zulassen</b> stellen.</p>
      <p class="note">2. „Akku-Einstellungen öffnen“ → Energiesparen für Stempelkarte auf <b>Keine Einschränkungen</b>, und <b>Autostart</b> einschalten.</p>
      <p class="note">3. In den letzten Apps die Stempelkarte nach unten ziehen und das Schloss-Symbol antippen, damit HyperOS sie nicht beendet.</p>
    </details>`;

  $("#an-list").addEventListener("click", onListClick);
  $("#an-auto").addEventListener("change", async (ev) => {
    const cur = readNative(snap && snap.settings);
    await saveNative({ ...cur, autoClock: ev.target.value },
      ev.target.value === "auto" ? "Auto-Stempeln: automatisch" : ev.target.value === "ask" ? "Auto-Stempeln: nur fragen" : "Auto-Stempeln ist aus.");
    // UNSICHER: Agent W liest settings.native selbst; syncPlaces sorgt nur dafür, dass die Geofences sofort neu gesetzt werden.
    ns.syncPlacesNow(ctx);
  });
  $("#an-out").addEventListener("change", async (ev) => {
    const cur = readNative(snap && snap.settings);
    await saveNative({ ...cur, autoClockOut: ev.target.checked },
      ev.target.checked ? "Automatisch ausstempeln ist an." : "Automatisch ausstempeln ist aus.");
  });
  $("#an-sync").addEventListener("click", async () => {
    if (busy) return;
    busy = "sync"; renderList(); renderLast();
    const r = await ns.syncSteps(ctx, { force: true });
    busy = "";
    if (!r) ctx.ui.toast(ns.hasMethod("StempelHealth", "readDays") ? "Schritte konnten nicht gelesen werden." : "Schritte " + UPDATE_TXT + ".", 3500);
    else ctx.ui.toast(r.saved ? `Schritte übernommen (${r.saved} ${r.saved === 1 ? "Tag" : "Tage"}).` : "Schritte sind aktuell.", 2500);
    renderList(); renderLast();
  });
  ns.onChange(() => { renderLast(); refresh(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && root && !root.hidden) refresh();
  });
  if (ctx.store && ctx.store.get) { try { const s = ctx.store.get(); if (s) update(s); } catch { /* egal */ } }
  refresh();
}

export function update(s) {
  snap = s;
  if (!root || root.hidden || !s) return;
  const n = readNative(s.settings);
  const a = $("#an-auto"), o = $("#an-out");
  if (a && a.value !== n.autoClock && document.activeElement !== a) a.value = n.autoClock;
  if (o && o.checked !== n.autoClockOut) o.checked = n.autoClockOut;
  const wrap = $("#an-out-wrap");
  if (wrap) wrap.classList.toggle("an-off", n.autoClock === "off");
  if (o) o.disabled = n.autoClock === "off";
  renderList();
}

async function saveNative(next, msg) {
  try {
    await ctx.store.saveSettings({ native: next });
    if (msg) ctx.ui.toast(msg, 2200);
  } catch { /* Toast kommt vom Store */ }
}

// ---------- Status ----------

async function safeStatus(name) {
  if (!ns.hasMethod(name, "status")) return { missing: true };
  try { return (await ns.call(name, "status")) || {}; }
  catch (e) { return e && e.code === "missing" ? { missing: true } : { error: true }; }
}

async function refresh() {
  if (!root || root.hidden) return;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const [a, b, c] = await Promise.all([safeStatus("StempelNative"), safeStatus("StempelHealth"), ns.pushStatus().catch(() => null)]);
    nat = a; health = b; push = c;
    renderList();
  })();
  try { await refreshing; } finally { refreshing = null; }
}

/** Wert aus dem (noch nicht festgelegten) Status von Agent W lesen → true/false/null. */
// UNSICHER: Die Feldnamen von StempelNative.status() legt Agent W fest; hier werden die üblichen Varianten probiert.
function pick(st, keys) {
  if (!st || typeof st !== "object") return null;
  for (const k of keys) {
    const v = k.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), st);
    if (v === undefined || v === null) continue;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v === "granted" || v === "ok" || v === "true" || v === "always";
  }
  return null;
}

function rowsData() {
  const rows = [];
  const missingNat = !nat || nat.missing;
  // Hintergrund-Standort
  {
    let state = "unk", txt = "Status unbekannt";
    if (missingNat) { txt = "Kommt mit dem nächsten App-Update"; }
    else {
      const bg = pick(nat, ["backgroundLocation", "locationBackground", "bgLocation", "location.background", "permissions.backgroundLocation"]);
      const fg = pick(nat, ["fineLocation", "location", "locationFine", "permissions.fineLocation"]);
      const act = pick(nat, ["activityRecognition", "activity", "permissions.activityRecognition"]);
      if (bg === true) { state = "ok"; txt = "Erlaubt – Standort „Immer zulassen“" + (act === false ? " · Fahrerkennung noch nicht erlaubt" : ""); }
      else if (bg === false) { state = "bad"; txt = fg === true ? "Nur „Während der Nutzung“ – fürs Auto-Stempeln „Immer zulassen“ wählen" : "Noch nicht erlaubt"; }
      if (act === false && bg !== true) txt += " · Fahrerkennung aus";
    }
    rows.push({ id: "loc", title: "Standort im Hintergrund", state, txt,
      btn: { a: "loc", label: "Hintergrund-Standort erlauben", disabled: missingNat || !ns.hasMethod("StempelNative", "requestBackgroundPermissions") } });
  }
  // Akku
  {
    let state = "unk", txt = "Bei Xiaomi wichtig: keine Akku-Einschränkung und Autostart an";
    if (missingNat) txt = "Kommt mit dem nächsten App-Update";
    else {
      const ign = pick(nat, ["ignoringBatteryOptimizations", "batteryOptimizationIgnored", "batteryUnrestricted", "battery.unrestricted", "battery"]);
      const opt = pick(nat, ["batteryOptimized", "batteryRestricted"]);
      const good = ign != null ? ign : (opt != null ? !opt : null);
      if (good === true) { state = "ok"; txt = "Keine Akku-Einschränkung – Autostart bei Xiaomi bitte trotzdem prüfen"; }
      else if (good === false) { state = "bad"; txt = "Akku-Sparen bremst die App – auf „Keine Einschränkungen“ stellen"; }
    }
    rows.push({ id: "bat", title: "Akku & Autostart", state, txt,
      btn: { a: "bat", label: "Akku-Einstellungen öffnen (Xiaomi)", disabled: missingNat || !ns.hasMethod("StempelNative", "openBatterySettings") } });
  }
  // Schritte
  {
    let state = "unk", txt = "Status wird gelesen …", extra = null;
    const missingH = !health || health.missing;
    if (missingH) txt = "Kommt mit dem nächsten App-Update";
    else if (health.error) { state = "bad"; txt = "Status nicht lesbar"; }
    else {
      const hc = health.healthConnect;
      const g = health.granted || {};
      if (health.source === "healthconnect") {
        state = "ok";
        txt = "Über Health Connect" + (g.elevation || g.floors ? " · mit Höhenmetern" : "");
      } else if (health.source === "sensor") {
        state = "ok";
        txt = "Über den Schrittzähler des Handys (zählt, solange die App läuft)";
        if (hc === "available") txt += " · Health Connect noch nicht erlaubt";
      } else {
        state = "bad";
        txt = health.sensor === false && hc !== "available" ? "Dieses Handy hat keinen Schrittzähler" : "Noch nicht erlaubt";
      }
      if (hc === "update_required") { extra = { a: "hc", label: "Health Connect aktualisieren" }; }
      else if (hc === "available" && !g.steps) { extra = { a: "hc", label: "Health Connect öffnen" }; }
    }
    const allSteps = !missingH && health.source === "healthconnect" && !!(health.granted || {}).elevation;
    rows.push({ id: "steps", title: "Schritte & Höhenmeter", state, txt,
      btn: { a: "steps", label: allSteps ? "Schritte sind erlaubt" : "Schritte erlauben", disabled: missingH || allSteps },
      extra: missingH || !ns.hasMethod("StempelHealth", "openHealthConnect") ? null : extra });
  }
  // Erinnerungen (Push)
  {
    let state = "unk", txt = "", disabled = false;
    const cloud = snap && snap.mode === "cloud" && snap.user;
    if (!push || !push.available) { txt = "Kommt mit dem nächsten App-Update"; disabled = true; }
    else if (!cloud) { txt = "Nur mit Anmeldung (Google) – Erinnerungen kommen vom Server"; disabled = true; }
    else if (push.permission === "granted" && push.token) { state = "ok"; txt = "Erlaubt – dieses Handy bekommt Erinnerungen"; }
    else if (push.permission === "granted") { state = "wait"; txt = "Erlaubt – noch einmal tippen, um das Handy anzumelden"; }
    else if (push.permission === "denied") { state = "bad"; txt = "Blockiert – in den Handy-Einstellungen → Apps → Stempelkarte → Benachrichtigungen erlauben"; }
    else { state = "bad"; txt = "Noch nicht erlaubt"; }
    rows.push({ id: "push", title: "Erinnerungen", state, txt,
      btn: { a: "push", label: push && push.permission === "granted" ? "Handy für Erinnerungen anmelden" : "Benachrichtigungen erlauben", disabled: disabled || (push && push.permission === "granted" && !!push.token) } });
  }
  return rows;
}

function renderList() {
  const box = root && $("#an-list");
  if (!box) return;
  box.innerHTML = rowsData().map((r) => `
    <div class="an-row" data-row="${r.id}">
      <div class="an-top"><span class="an-dot ${r.state}" aria-hidden="true"></span>
        <div class="an-txt"><b>${esc(r.title)}</b><small>${esc(r.txt)}</small></div></div>
      <div class="an-btns">
        <button class="btn${r.state === "bad" ? " primary" : ""}" type="button" data-a="${r.btn.a}"${r.btn.disabled || busy ? " disabled" : ""}>${esc(busy === r.btn.a ? "Bitte warten …" : r.btn.label)}</button>
        ${r.extra ? `<button class="btn" type="button" data-a="${r.extra.a}"${busy ? " disabled" : ""}>${esc(r.extra.label)}</button>` : ""}
      </div>
    </div>`).join("");
  const sync = $("#an-sync");
  if (sync) sync.disabled = !!busy || !ns.hasMethod("StempelHealth", "readDays");
}

function renderLast() {
  const el = root && $("#an-last");
  if (!el) return;
  if (busy === "sync") { el.textContent = "Schritte werden gelesen …"; return; }
  const r = ns.lastSteps();
  if (!ns.hasMethod("StempelHealth", "readDays")) { el.textContent = "Schritte vom Handy " + UPDATE_TXT + "."; return; }
  if (!r) { el.textContent = ""; return; }
  const d = new Date(r.at);
  const src = r.source === "healthconnect" ? "Health Connect" : r.source === "sensor" ? "Schrittzähler" : r.source === "mixed" ? "Health Connect + Schrittzähler" : "keine Daten";
  el.textContent = `Zuletzt abgeglichen: heute ${pad(d.getHours())}:${pad(d.getMinutes())} · Quelle: ${src}`;
}

async function onListClick(ev) {
  const b = ev.target.closest("button[data-a]");
  if (!b || b.disabled || busy) return;
  const a = b.dataset.a;
  busy = a; renderList();
  try {
    if (a === "loc") await ns.call("StempelNative", "requestBackgroundPermissions");
    else if (a === "bat") await ns.call("StempelNative", "openBatterySettings");
    else if (a === "steps") {
      const st = await ns.call("StempelHealth", "requestPermissions");
      if (st && st.ok) { ctx.ui.toast("Schritte sind erlaubt.", 2200); busy = ""; ns.syncSteps(ctx, { force: true }); }
      else if (st) ctx.ui.toast("Schritte sind noch nicht erlaubt.", 3000);
    } else if (a === "hc") await ns.call("StempelHealth", "openHealthConnect");
    else if (a === "push") {
      const r = await ns.enablePush({ interactive: true });
      if (r.ok) ctx.ui.toast("Dieses Handy wird für Erinnerungen angemeldet.", 2500);
      else if (r.reason === "no-user") ctx.ui.toast("Bitte zuerst mit Google anmelden.", 3000);
      else ctx.ui.toast("Benachrichtigungen sind nicht erlaubt.", 3000);
    }
  } catch (e) {
    ctx.ui.toast(e && e.code === "missing" ? "Das " + UPDATE_TXT + "." : (e && e.message) || "Hat nicht geklappt.", 3500);
  } finally {
    busy = "";
    await refresh();
  }
}
