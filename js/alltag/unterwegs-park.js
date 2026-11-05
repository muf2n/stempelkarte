// Unterwegs › Parkplatz merken: „Hier geparkt“ (GPS + Genauigkeit + Zeit, Notiz/Ebene/Stellplatz, kleines Foto),
// Entfernung + Richtung zum Auto (Kompass über deviceorientation, sonst Norden = oben), Navigation (Google Maps zu Fuß),
// Parkschein-Timer mit Erinnerung („Parkschein läuft in 10 Min ab“) über Zeitstempel, Verlauf der letzten 10.
// Sammlung travel_parking: { id, lat, lng, acc, ts, note, level, spot, photoId?, until?, remindMin, active }
import * as C from "./unterwegs-core.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import { putImage, getImage, cachedImage, delImage, shrinkImage, safeWrite } from "./unterwegs-shared.js";

const KEEP = 10;
const REMIND_MIN = 10;
const NOTIFIED_KEY = "sk-uw-park-notified";

/* ---------- Erinnerung (modulweit, überlebt das Schließen des Bereichs) ---------- */

let remindTimer = null;
let remindFor = "";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

async function notify(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  const opts = { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: "./#alltag/unterwegs" }, requireInteraction: true };
  try {
    if ("serviceWorker" in navigator) {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 1500))]);
      if (reg && reg.showNotification) { await reg.showNotification(title, opts); return true; }
    }
  } catch { /* weiter mit Fallback */ }
  try { new Notification(title, opts); return true; } catch { return false; }
}

/** Erinnerung für den aktiven Parkplatz planen (oder aufheben). */
export function scheduleReminder(rec) {
  clearTimeout(remindTimer); remindTimer = null;
  if (!rec || !rec.active || !rec.until) { remindFor = ""; return; }
  const key = rec.id + "@" + rec.until;
  remindFor = key;
  const mins = Number(rec.remindMin) || REMIND_MIN;
  const at = rec.until - mins * 60000;
  const fire = async () => {
    if (remindFor !== key || lsGet(NOTIFIED_KEY) === key) return;
    const left = Math.max(0, Math.round((rec.until - Date.now()) / 60000));
    const ok = await notify(left > 0 ? `Parkschein läuft in ${left} Min ab` : "Parkschein ist abgelaufen",
      `Bis ${C.clock(rec.until)}${rec.note ? " · " + rec.note : ""}${rec.level ? " · Ebene " + rec.level : ""}`, "sk-park");
    if (ok) lsSet(NOTIFIED_KEY, key);
  };
  const now = Date.now();
  if (now >= at) { if (now < rec.until + 30 * 60000) fire(); return; }
  remindTimer = setTimeout(fire, Math.min(at - now, 2 ** 31 - 1));
}

/* ---------- Ansicht ---------- */

export function createPark({ col, ui, queue, isVisible }) {
  let here = null;         // {lat, lng, acc, ts}
  let watchId = null;
  let heading = null;      // Grad, 0 = Norden
  let geoErr = "";
  let orientOn = false;
  let busy = false;
  let lastGeoRender = 0;

  const list = () => col.all().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const active = () => list().find((p) => p.active) || null;

  /* Standort beobachten, solange die Parkplatz-Seite sichtbar ist und ein Auto geparkt ist */
  function startWatch() {
    if (watchId != null || !("geolocation" in navigator)) return;
    watchId = navigator.geolocation.watchPosition((p) => {
      here = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: p.timestamp || Date.now() };
      geoErr = "";
      const now = Date.now();
      if (now - lastGeoRender > 700) { lastGeoRender = now; updateLive(); }
      else setTimeout(updateLive, 720);
    }, (err) => {
      geoErr = err && err.code === 1 ? "Standort-Zugriff ist blockiert – in den Browser-Einstellungen erlauben." : "Standort gerade nicht verfügbar.";
      updateLive();
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function stopWatch() {
    if (watchId != null) { try { navigator.geolocation.clearWatch(watchId); } catch { /* egal */ } }
    watchId = null;
  }

  function onOrient(ev) {
    let h = null;
    if (typeof ev.webkitCompassHeading === "number") h = ev.webkitCompassHeading;
    else if (ev.absolute && typeof ev.alpha === "number") h = (360 - ev.alpha) % 360;
    if (h == null) return;
    const scr = (screen.orientation && screen.orientation.angle) || 0;
    heading = (h + scr) % 360;
    rotateArrow();
  }
  function startOrient() {
    if (orientOn) return;
    orientOn = true;
    if ("ondeviceorientationabsolute" in window) window.addEventListener("deviceorientationabsolute", onOrient);
    else window.addEventListener("deviceorientation", onOrient);
  }
  function stopOrient() {
    window.removeEventListener("deviceorientationabsolute", onOrient);
    window.removeEventListener("deviceorientation", onOrient);
    orientOn = false;
  }
  const needsOrientPermission = () => typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";

  function rotateArrow() {
    const a = document.querySelector(".uw-park-arrow");
    const rec = active();
    if (!a || !rec || !here) return;
    const b = C.bearing(here, rec);
    const rot = heading == null ? b : b - heading;
    a.style.transform = `rotate(${rot.toFixed(1)}deg)`;
    const lbl = document.querySelector(".uw-park-dirmode");
    if (lbl) lbl.textContent = heading == null ? "Norden = oben" : "Pfeil zeigt zum Auto";
    const rose = document.querySelector(".uw-park-rose");
    if (rose) rose.style.transform = heading == null ? "" : `rotate(${(-heading).toFixed(1)}deg)`;
  }

  /** Nur die Live-Werte (Entfernung, Richtung, Timer) neu zeichnen – ohne die ganze Seite. */
  function updateLive() {
    if (!isVisible()) return;
    const box = document.querySelector(".uw-park-live");
    if (!box) return;
    box.innerHTML = liveHTML(active());
    rotateArrow();
  }

  function liveHTML(rec) {
    if (!rec) return "";
    if (!here) return `<div class="uw-park-dist"><b>…</b><small>${esc(geoErr || "Suche deinen Standort …")}</small></div>`;
    const d = C.distanceM(here, rec);
    const b = C.bearing(here, rec);
    const near = d <= Math.max(15, (here.acc || 0) + (rec.acc || 0) * 0.5);
    return `<div class="uw-park-compass" aria-hidden="true">` +
        `<div class="uw-park-rose"><span class="n">N</span></div>` +
        `<div class="uw-park-arrow" style="transform:rotate(${(heading == null ? b : b - heading).toFixed(1)}deg)">${near ? "🚗" : `<svg viewBox="0 0 40 40" width="64" height="64"><path d="M20 3l11 31-11-7-11 7z" fill="currentColor"/></svg>`}</div>` +
      `</div>` +
      `<div class="uw-park-dist" data-m="${Math.round(d)}">` +
        `<b>${near ? "Du bist da!" : esc(C.fmtDist(d))}</b>` +
        `<small>${near ? "Das Auto ist ganz in der Nähe." : `Richtung ${esc(C.compassName(b))} · <span class="uw-park-dirmode">${heading == null ? "Norden = oben" : "Pfeil zeigt zum Auto"}</span>`}</small>` +
        `<small class="uw-park-acc">Dein Standort ±${Math.round(here.acc || 0)} m</small>` +
      `</div>`;
  }

  function timerHTML(rec) {
    if (!rec.until) {
      return `<div class="uw-park-timer none"><span>${icon("clock", 18)} Parkschein-Timer</span>` +
        `<div class="chips">${[[30, "30 min"], [60, "1 h"], [90, "1½ h"], [120, "2 h"], [180, "3 h"]].map(([m, l]) => `<button type="button" class="chip" data-pa="timer" data-min="${m}">${l}</button>`).join("")}` +
        `<button type="button" class="chip" data-pa="timerat">Bis …</button></div></div>`;
    }
    const left = rec.until - Date.now();
    const total = Math.max(1, rec.until - (rec.timerStart || rec.ts));
    const pct = Math.max(0, Math.min(100, (left / total) * 100));
    const perm = "Notification" in window ? Notification.permission : "unsupported";
    const mins = Number(rec.remindMin) || REMIND_MIN;
    const remind = perm === "granted"
      ? `🔔 Erinnerung ${mins} Min vorher (${C.clock(rec.until - mins * 60000)})`
      : perm === "default" ? `<button type="button" class="linkbtn" data-pa="perm">🔔 Erinnerung erlauben</button>`
      : perm === "denied" ? "🔕 Benachrichtigungen sind blockiert" : "";
    return `<div class="uw-park-timer${left < 0 ? " over" : left < mins * 60000 ? " soon" : ""}">` +
      `<div class="uw-park-timer-top"><span>${icon("clock", 18)} Parkschein bis <b>${C.clock(rec.until)}</b></span><b class="uw-park-left">${esc(C.fmtLeft(left))}</b></div>` +
      `<div class="uw-park-timer-bar"><div style="width:${pct.toFixed(1)}%"></div></div>` +
      `<div class="uw-park-timer-foot"><small>${remind}</small>` +
        `<span><button type="button" class="chip sm" data-pa="extend" data-min="30">+30 min</button>` +
        `<button type="button" class="chip sm" data-pa="timeroff">Aus</button></span></div>` +
    `</div>`;
  }

  function activeHTML(rec) {
    const img = rec.photoId ? cachedImage(rec.photoId) : null;
    if (rec.photoId && !img) getImage(rec.photoId).then((v) => { if (v) queue(); });
    const facts = [
      rec.level ? `<span><small>Ebene</small><b>${esc(rec.level)}</b></span>` : "",
      rec.spot ? `<span><small>Stellplatz</small><b>${esc(rec.spot)}</b></span>` : "",
      `<span><small>Geparkt</small><b>${esc(C.clock(rec.ts))}</b></span>`,
      `<span><small>Genauigkeit</small><b>±${Math.round(rec.acc || 0)} m</b></span>`,
    ].join("");
    return `<section class="card uw-park-card">` +
      `<div class="uw-park-head"><span class="uw-park-badge">${icon("car", 22)}</span>` +
        `<div><b>Dein Auto</b><small>geparkt ${esc(sinceText(rec.ts))}</small></div>` +
        `<button type="button" class="uw-ib" data-pa="edit" data-id="${esc(rec.id)}" aria-label="Details bearbeiten">${icon("pencil", 17)}</button></div>` +
      `<div class="uw-park-live">${liveHTML(rec)}</div>` +
      `<div class="uw-park-facts">${facts}</div>` +
      (rec.note ? `<p class="uw-park-note">${esc(rec.note)}</p>` : "") +
      (img ? `<button type="button" class="uw-park-photo" data-pa="photo" data-id="${esc(rec.id)}"><img src="${img}" alt="Foto vom Parkplatz"></button>` : "") +
      timerHTML(rec) +
      `<div class="uw-park-act">` +
        `<a class="btn primary" href="${esc(C.mapsWalk(rec.lat, rec.lng))}" target="_blank" rel="noopener" data-pa="nav">${icon("pin", 20)} Navigation starten</a>` +
        (needsOrientPermission() && heading == null ? `<button type="button" class="btn ghost sm" data-pa="compass">Kompass aktivieren</button>` : "") +
        `<button type="button" class="btn ghost sm" data-pa="leave" data-id="${esc(rec.id)}">Weggefahren</button>` +
      `</div>` +
    `</section>`;
  }

  function sinceText(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "gerade eben";
    if (m < 60) return `vor ${m} min`;
    if (m < 60 * 24) return `vor ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
    return `am ${C.fmtDateTime(ts)}`;
  }

  function html() {
    const rec = active();
    if (rec) { startWatch(); startOrient(); } else stopWatch();
    scheduleReminder(rec);
    const hist = list().filter((p) => !p.active).slice(0, KEEP);
    return `<div class="uw-park">` +
      (rec ? activeHTML(rec)
        : `<section class="card uw-park-empty">` +
            `<div class="uw-park-big" aria-hidden="true">🅿️</div>` +
            `<h3>Wo steht das Auto?</h3>` +
            `<p class="note">Tipp beim Aussteigen auf „Hier geparkt“ – der Standort wird mit Genauigkeit und Uhrzeit gespeichert.</p>` +
            `<button type="button" class="btn primary uw-park-here" data-pa="here"${busy ? " disabled" : ""}>${icon("pin", 22)} ${busy ? "Standort wird gesucht …" : "Hier geparkt"}</button>` +
          `</section>`) +
      (rec ? `<button type="button" class="btn ghost sm uw-park-again" data-pa="here"${busy ? " disabled" : ""}>${icon("pin", 18)} Neu parken (hier)</button>` : "") +
      `<section class="uw-sec"><h3 class="uw-h">Verlauf</h3>` +
        (hist.length ? `<ul class="uw-park-hist">${hist.map((p) => `<li>` +
            `<a href="${esc(C.mapsSearch(p.lat.toFixed(6) + "," + p.lng.toFixed(6)))}" target="_blank" rel="noopener">` +
              `<span class="uw-park-hic">${icon("pin", 18)}</span>` +
              `<span class="uw-park-ht"><b>${esc(C.fmtDateTime(p.ts))}</b><small>${esc([p.note, p.level && "Ebene " + p.level, p.spot && "Platz " + p.spot].filter(Boolean).join(" · ") || `±${Math.round(p.acc || 0)} m`)}</small></span>` +
            `</a>` +
            `<button type="button" class="uw-ib del" data-pa="del" data-id="${esc(p.id)}" aria-label="Aus Verlauf löschen">${icon("trash", 16)}</button>` +
          `</li>`).join("")}</ul>`
          : `<p class="note">Hier erscheinen deine letzten ${KEEP} Parkplätze.</p>`) +
      `</section>` +
    `</div>`;
  }

  /* ---------- Aktionen ---------- */

  function getPos() {
    return new Promise((res, rej) => {
      if (!("geolocation" in navigator)) { rej(new Error("Dieses Gerät kann keinen Standort bestimmen.")); return; }
      navigator.geolocation.getCurrentPosition(res, (e) => rej(new Error(e && e.code === 1 ? "Standort-Zugriff ist blockiert – bitte erlauben." : "Standort nicht gefunden – nochmal probieren.")), { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    });
  }

  async function parkHere() {
    if (busy) return;
    busy = true; queue();
    try {
      const p = await getPos();
      const prev = active();
      if (prev) await col.patch(prev.id, { active: false });
      const rec = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0), ts: Date.now(), note: "", level: "", spot: "", until: null, remindMin: REMIND_MIN, active: true };
      here = { lat: rec.lat, lng: rec.lng, acc: rec.acc, ts: rec.ts };
      const id = await col.put(rec);
      // nur die letzten 10 behalten
      const old = list().slice(KEEP);
      for (const o of old) { await col.remove(o.id); if (o.photoId) delImage(o.photoId).catch(() => {}); }
      ui.toast(`Parkplatz gespeichert ✓ (±${rec.acc} m)`, 2600);
      busy = false;
      queue();
      return id;
    } catch (err) {
      ui.toast(err.message || String(err), 3500);
    } finally { busy = false; queue(); }
  }

  function openEdit(rec) {
    let photo = undefined; // undefined = unverändert, null = entfernen, string = neu
    const cur = rec.photoId ? cachedImage(rec.photoId) : null;
    ui.openSheet({
      title: "Parkplatz-Details",
      bodyHTML: `<div class="fields">` +
        `<div class="row"><label>Ebene / Stock<input id="uw-p-level" maxlength="12" placeholder="z. B. −2" value="${esc(rec.level || "")}"></label>` +
        `<label>Stellplatz<input id="uw-p-spot" maxlength="12" placeholder="z. B. B 47" value="${esc(rec.spot || "")}"></label></div>` +
        `<label>Notiz<input id="uw-p-note" maxlength="80" placeholder="z. B. neben dem Lift, gelbe Säule" value="${esc(rec.note || "")}"></label>` +
        `<div class="row"><label>Parkschein bis<input id="uw-p-until" type="time" value="${rec.until ? C.clock(rec.until) : ""}"></label>` +
        `<label>Erinnerung vorher (Min)<input id="uw-p-rem" type="number" inputmode="numeric" min="1" max="60" value="${Number(rec.remindMin) || REMIND_MIN}"></label></div>` +
        `<div class="uw-photo-pick"><div class="uw-photo-prev">${cur ? `<img src="${cur}" alt="">` : "📷"}</div>` +
          `<label class="btn ghost sm uw-file">Foto wählen<input id="uw-p-photo" type="file" accept="image/*" capture="environment" hidden></label>` +
          (rec.photoId ? `<button type="button" class="btn ghost sm" data-nophoto>Foto entfernen</button>` : "") + `</div>` +
      `</div>` +
      `<div class="row"><button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const prev = sheet.querySelector(".uw-photo-prev");
        sheet.querySelector("#uw-p-photo").addEventListener("change", async (ev) => {
          const f = ev.target.files && ev.target.files[0];
          if (!f) return;
          try { const r = await shrinkImage(f, { maxSide: 640, maxBytes: 70 * 1024, quality: 0.72 }); photo = r.data; prev.innerHTML = `<img src="${r.data}" alt="">`; }
          catch (err) { ui.toast(err.message || String(err), 3500); }
        });
        const np = sheet.querySelector("[data-nophoto]");
        if (np) np.addEventListener("click", () => { photo = null; prev.textContent = "📷"; });
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const ut = sheet.querySelector("#uw-p-until").value;
          const patch = {
            level: sheet.querySelector("#uw-p-level").value.trim(),
            spot: sheet.querySelector("#uw-p-spot").value.trim(),
            note: sheet.querySelector("#uw-p-note").value.trim(),
            remindMin: Math.max(1, Math.min(60, Math.round(Number(sheet.querySelector("#uw-p-rem").value) || REMIND_MIN))),
          };
          if (ut) {
            const until = timeToTs(ut, rec.ts);
            if (until !== rec.until) { patch.until = until; patch.timerStart = Date.now(); }
          } else patch.until = null;
          close();
          if (photo) { const pid = "park_" + rec.id; await putImage(pid, photo).catch((e) => ui.toast("Foto: " + e.message)); patch.photoId = pid; }
          else if (photo === null && rec.photoId) { await delImage(rec.photoId).catch(() => {}); patch.photoId = null; }
          await safeWrite(ui, col.patch(rec.id, patch), "Gespeichert ✓");
          if (patch.until) askPermission();
        });
      },
    });
  }

  /** "15:30" → nächster Zeitpunkt ab Parkzeit (über Mitternacht → nächster Tag). */
  function timeToTs(hhmm, fromTs) {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(Math.max(fromTs || 0, Date.now() - 6 * 3600000));
    const t = new Date(d); t.setHours(h, m, 0, 0);
    if (t.getTime() < d.getTime() - 60000) t.setDate(t.getDate() + 1);
    return t.getTime();
  }

  async function askPermission() {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    try { await Notification.requestPermission(); } catch { /* egal */ }
    queue();
  }

  function openTimerAt(rec) {
    ui.openSheet({
      title: "Parkschein bis",
      bodyHTML: `<div class="fields"><label>Uhrzeit<input id="uw-pt" type="time" value="${C.clock(Date.now() + 3600000)}"></label>` +
        `<button type="button" class="btn primary" data-save>Timer starten</button></div>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const v = sheet.querySelector("#uw-pt").value;
          if (!v) return;
          close();
          await safeWrite(ui, col.patch(rec.id, { until: timeToTs(v, Date.now()), timerStart: Date.now() }));
          askPermission();
        });
      },
    });
  }

  function onClick(t) {
    const a = t.dataset.pa;
    if (!a) return false;
    const rec = active();
    switch (a) {
      case "here": parkHere(); return true;
      case "edit": if (rec) openEdit(rec); return true;
      case "leave":
        if (t.dataset.armed !== "1") { t.dataset.armed = "1"; t.textContent = "Wirklich?"; setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = "Weggefahren"; } }, 4000); return true; }
        if (rec) safeWrite(ui, col.patch(rec.id, { active: false, left: Date.now() }), "Gute Fahrt! 🚗");
        return true;
      case "timer": if (rec) { safeWrite(ui, col.patch(rec.id, { until: Date.now() + Number(t.dataset.min) * 60000, timerStart: Date.now() })); askPermission(); } return true;
      case "extend": if (rec && rec.until) safeWrite(ui, col.patch(rec.id, { until: Math.max(rec.until, Date.now()) + Number(t.dataset.min) * 60000 })); return true;
      case "timeroff": if (rec) safeWrite(ui, col.patch(rec.id, { until: null })); return true;
      case "timerat": if (rec) openTimerAt(rec); return true;
      case "perm": askPermission(); return true;
      case "compass":
        DeviceOrientationEvent.requestPermission().then((r) => { if (r === "granted") { stopOrient(); startOrient(); } queue(); }).catch(() => ui.toast("Kompass nicht verfügbar"));
        return true;
      case "photo": {
        const r = col.get(t.dataset.id); const img = r && cachedImage(r.photoId);
        if (img) ui.openSheet({ title: "Parkplatz-Foto", bodyHTML: `<img src="${img}" alt="Foto vom Parkplatz" style="width:100%;border-radius:14px">` });
        return true;
      }
      case "del": {
        const r = col.get(t.dataset.id);
        if (r) { if (r.photoId) delImage(r.photoId).catch(() => {}); safeWrite(ui, col.remove(r.id)); }
        return true;
      }
      case "nav": return false; // normaler Link
      default: return false;
    }
  }

  function hide() { stopWatch(); stopOrient(); }

  return { html, onClick, hide, tick: updateLive, test: () => ({ here, heading }) };
}
