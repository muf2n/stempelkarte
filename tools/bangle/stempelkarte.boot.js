// Stempelkarte fuer Bangle.js 2 - Hintergrund-Teil (wird auf der Uhr als "stempel.boot.js" gespeichert).
// Misst alle 60 s kurz den Luftdruck (Barometer nur ~1-2 s an), rechnet daraus Hoehenmeter
// auf/ab (Hysterese 3 m) und speichert Tageswerte in "stempel.days.json" (max. 30 Tage).
// Nur ASCII verwenden (wird 1:1 per Bluetooth in den Uhr-Speicher geschrieben).
// In node (Tests) gibt es kein "Bangle": dann werden nur die reinen Funktionen exportiert.
(function () {
  var TH = 3;          // Hysterese in Metern
  var JUMP = 150;      // groessere Spruenge in einer Minute = Messfehler/Neustart -> nur Bezug neu setzen
  var MAX_DAYS = 30;
  var FILE = "stempel.days.json";

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  /** Neue Hoehe einspeisen. S = {dk, ref, u, d}; veraendert S. -> true, wenn u/d gewachsen sind. */
  function feed(S, dk, alt) {
    if (typeof alt !== "number" || !isFinite(alt)) return false;
    if (S.dk !== dk) { S.dk = dk; S.u = 0; S.d = 0; }  // neuer Tag: Summen auf 0, Bezug bleibt
    if (S.ref === null || S.ref === undefined) { S.ref = alt; return false; }
    var diff = alt - S.ref;
    if (diff > JUMP || diff < -JUMP) { S.ref = alt; return false; }
    if (diff > TH) { S.u += diff; S.ref = alt; return true; }
    if (diff < -TH) { S.d -= diff; S.ref = alt; return true; }
    return false;
  }

  /** Median (gegen einzelne Ausreisser). */
  function median(a) {
    var b = a.filter(function (x) { return typeof x === "number" && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!b.length) return NaN;
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }

  /** Tageswerte uebernehmen und auf die neuesten max Tage kuerzen. -> neues Objekt */
  function putDay(days, dk, u, d, max) {
    var out = {};
    var keys = Object.keys(days || {});
    for (var i = 0; i < keys.length; i++) out[keys[i]] = days[keys[i]];
    out[dk] = { u: Math.round(u), d: Math.round(d) };
    keys = Object.keys(out).sort();
    var lim = max || MAX_DAYS;
    while (keys.length > lim) { delete out[keys.shift()]; }
    return out;
  }

  var api = { TH: TH, feed: feed, median: median, putDay: putDay, dayKey: dayKey };
  if (typeof Bangle === "undefined") { if (typeof module !== "undefined") module.exports = api; return; }
  if (global.SKALT) return; // laeuft schon (z. B. App hat die Datei nachgeladen)

  var st = require("Storage");
  var days = st.readJSON(FILE, true) || {};
  var today = dayKey(new Date());
  var cur = days[today] || { u: 0, d: 0 };
  var S = { dk: today, ref: null, u: cur.u || 0, d: cur.d || 0 };
  var dirty = false, lastWrite = 0;

  function save() {
    if (!dirty) return;
    days = putDay(days, S.dk, S.u, S.d, MAX_DAYS);
    st.writeJSON(FILE, days);
    dirty = false; lastWrite = Date.now();
  }

  function onAlt(alt) {
    var dk = dayKey(new Date());
    if (dk !== S.dk) { save(); S.u = 0; S.d = 0; S.dk = dk; dirty = true; }
    if (feed(S, dk, alt)) dirty = true;
    if (dirty && Date.now() - lastWrite > 10 * 60000) save();  // Flash schonen: hoechstens alle 10 min
    if (global.SKALT.onChange) { try { global.SKALT.onChange(); } catch (e) { } }
  }

  // UNSICHER (API): Bangle.setBarometerPower(on, appId) + Ereignis "pressure" {altitude, pressure, temperature}.
  // Bangle.getPressure() (Promise) gibt es erst in neueren Firmwares - darum hier der Weg ueber Ereignisse.
  function measure() {
    var vals = [];
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      Bangle.removeListener("pressure", onP);
      Bangle.setBarometerPower(false, "stempel");
      var m = median(vals);
      if (isFinite(m)) onAlt(m);
    }
    function onP(e) { if (e && typeof e.altitude === "number") vals.push(e.altitude); if (vals.length >= 3) finish(); }
    Bangle.on("pressure", onP);
    Bangle.setBarometerPower(true, "stempel");
    setTimeout(finish, 3000);
  }

  global.SKALT = { S: S, save: function () { dirty = true; save(); }, onChange: null, measure: measure };
  E.on("kill", save);
  setInterval(measure, 60000);
  setTimeout(measure, 5000);
})();
