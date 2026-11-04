// Stempelkarte fuer Bangle.js 2 (auf der Uhr als "stempel.app.js").
// Zeigt Uhrzeit, Stempel-Status, Arbeitszeit, Schritte und Hoehenmeter von heute.
// Knoepfe (Touch): Einstempeln / Pause-Weiter / Autofahren-Arbeiten / Ausstempeln (2x tippen).
// Jede Aktion landet mit Zeitstempel in "stempel.queue.json"; die Handy-App holt sie beim Abgleich ab
// und schickt den echten Zustand als "stempel.state.json" zurueck.
// Nur ASCII verwenden (wird 1:1 per Bluetooth in den Uhr-Speicher geschrieben).
(function () {
  var DRIVE = "Autofahren", WORK = "Arbeiten";
  var QMAX = 200;

  function isDrive(a) { return String(a || "").toLowerCase().replace(/[^a-z]/g, "") === "autofahren"; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hm(min) { min = Math.max(0, Math.floor(min)); return Math.floor(min / 60) + ":" + pad(min % 60); }

  /** Zustand normalisieren. st = {start, p, pm, act, done, dk, at} (start/p = ms, pm = Pausen-ms, done = fertige Min. heute) */
  function norm(st) {
    st = st || {};
    return { start: st.start || null, p: st.p || null, pm: st.pm || 0, act: st.act || WORK, done: st.done || 0, dk: st.dk || null, at: st.at || 0 };
  }

  /** Welches Ereignis erzeugt ein Knopf? kind = "in" | "pause" | "act" | "out" -> Ereignis oder null */
  function decide(st, kind, now) {
    st = norm(st);
    if (kind === "in") return st.start ? null : { t: now, a: "in" };
    if (!st.start) return null;
    if (kind === "pause") return { t: now, a: st.p ? "resume" : "pause" };
    if (kind === "act") { if (st.p) return null; return { t: now, a: "act", v: isDrive(st.act) ? WORK : DRIVE }; }
    if (kind === "out") return { t: now, a: "out" };
    return null;
  }

  /** Ereignis sofort auf die Anzeige anwenden (die Handy-App rechnet spaeter verbindlich). */
  function applyLocal(st, ev) {
    st = norm(st);
    var t = ev.t;
    if (ev.a === "in" && !st.start) {
      if (st.dk !== dayKey(t)) { st.done = 0; st.dk = dayKey(t); }
      st.start = t; st.p = null; st.pm = 0; st.act = WORK;
    } else if (ev.a === "pause" && st.start && !st.p) st.p = t;
    else if (ev.a === "resume" && st.start && st.p) { st.pm += Math.max(0, t - st.p); st.p = null; }
    else if (ev.a === "act" && st.start) st.act = ev.v || WORK;
    else if (ev.a === "out" && st.start) {
      if (st.dk !== dayKey(t)) { st.done = 0; st.dk = dayKey(t); }
      st.done += Math.max(0, ((st.p || t) - st.start - st.pm) / 60000);
      st.start = null; st.p = null; st.pm = 0; st.act = WORK;
    }
    return st;
  }

  /** Arbeitsminuten heute (fertige Eintraege + laufende Schicht, Pause friert ein). */
  function workMin(st, now) {
    st = norm(st);
    var done = st.dk === dayKey(now) ? st.done : 0;
    if (!st.start) return done;
    return done + Math.max(0, ((st.p || now) - st.start - st.pm) / 60000);
  }

  /** Ereignis an die Warteschlange haengen (Kopie, hoechstens QMAX Eintraege, aelteste fliegen raus). */
  function queuePush(q, ev) {
    var out = (q || []).slice();
    out.push(ev);
    while (out.length > QMAX) out.shift();
    return out;
  }

  /** Statuszeile */
  function statusText(st) {
    st = norm(st);
    if (!st.start) return "Nicht eingestempelt";
    if (st.p) return "Pause seit " + hhmm(st.p);
    return (isDrive(st.act) ? "Autofahrt" : "Arbeit") + " seit " + hhmm(st.start);
  }

  /** Knoepfe fuer den Zustand: [{id, label, x, y, w, h}] auf 176x176 */
  function buttons(st, armed) {
    st = norm(st);
    if (!st.start) return [{ id: "in", label: "Einstempeln", x: 4, y: 112, w: 168, h: 60 }];
    var list = [
      { id: "pause", label: st.p ? "Weiter" : "Pause", x: 4, y: 104, w: 82, h: 34 },
      { id: "act", label: isDrive(st.act) ? "Arbeiten" : "Auto", x: 90, y: 104, w: 82, h: 34 },
      { id: "out", label: armed ? "Nochmal tippen" : "Ausstempeln", x: 4, y: 142, w: 168, h: 32 }
    ];
    if (st.p) list[1].off = true;
    return list;
  }

  function hit(list, x, y) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
    }
    return null;
  }

  var api = { decide: decide, applyLocal: applyLocal, workMin: workMin, queuePush: queuePush, statusText: statusText,
    buttons: buttons, hit: hit, norm: norm, isDrive: isDrive, hm: hm, dayKey: dayKey, QMAX: QMAX };
  if (typeof Bangle === "undefined") { if (typeof module !== "undefined") module.exports = api; return; }

  // ---------------- ab hier nur auf der Uhr ----------------
  var Storage = require("Storage");
  var QF = "stempel.queue.json", SF = "stempel.state.json", DF = "stempel.days.json";
  var state = norm(Storage.readJSON(SF, true));
  var armed = 0, armTimer, drawTimer, btns = [];

  // Hoehenmeter: Hintergrund-Teil (stempel.boot.js) laeuft normalerweise schon; sonst hier nachladen,
  // dann wird zumindest gemessen, solange die App offen ist.
  if (!global.SKALT && Storage.read("stempel.boot.js")) { try { eval(Storage.read("stempel.boot.js")); } catch (e) { } }

  function altToday() {
    var dk = dayKey(Date.now());
    if (global.SKALT && global.SKALT.S && global.SKALT.S.dk === dk) return global.SKALT.S.u;
    var d = (Storage.readJSON(DF, true) || {})[dk];
    return d ? d.u : 0;
  }

  function stepsToday() {
    // UNSICHER (API): Bangle.getHealthStatus("day").steps gibt es ab Firmware 2v11.
    try { return Bangle.getHealthStatus("day").steps | 0; } catch (e) { return null; }
  }

  function draw() {
    var now = Date.now();
    g.reset();
    g.setColor(g.theme.bg).fillRect(0, 0, 175, 175);
    g.setColor(g.theme.fg).setFontAlign(0, -1);
    g.setFont("Vector", 40).drawString(hhmm(now), 88, 2);
    var col = !state.start ? g.theme.fg : state.p ? "#ff0" : isDrive(state.act) ? "#0ff" : "#0f0";
    g.setColor(col).setFont("Vector", 16).drawString(statusText(state), 88, 46);
    g.setColor(g.theme.fg).setFont("6x8", 2).drawString("Heute " + hm(workMin(state, now)) + " h", 88, 68);
    var s = stepsToday();
    g.setFont("6x8", 1).drawString((s === null ? "-" : s) + " Schritte  " + Math.round(altToday()) + " Hm", 88, 88);
    btns = buttons(state, armed);
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var hiFill = b.id === "in" || (b.id === "out" && armed);
      g.setColor(hiFill ? g.theme.fgH : g.theme.fg2);
      g.setBgColor(hiFill ? g.theme.bgH : g.theme.bg2);
      g.clearRect(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1);
      g.drawRect(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1);
      if (b.off) g.setColor("#888");
      g.setFontAlign(0, 0).setFont("Vector", b.id === "in" ? 24 : 16).drawString(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    }
    if (state.at) { g.reset().setFont("6x8", 1).setFontAlign(1, 1).setColor("#888").drawString("Handy " + hhmm(state.at), 174, 101); }
  }

  function schedule() {
    if (drawTimer) clearTimeout(drawTimer);
    drawTimer = setTimeout(function () { drawTimer = undefined; draw(); schedule(); }, 60000 - (Date.now() % 60000));
  }

  function act(kind) {
    var ev = decide(state, kind, Date.now());
    if (!ev) { Bangle.buzz(30); return; }
    var q = Storage.readJSON(QF, true) || [];
    Storage.writeJSON(QF, queuePush(q, ev));
    state = applyLocal(state, ev);
    Storage.writeJSON(SF, state);
    Bangle.buzz(80);
    draw();
  }

  function onTouch(n, e) {
    var b = hit(btns, e.x, e.y);
    if (!b || b.off) return;
    if (b.id === "out") {
      if (!armed) {
        armed = 1; draw();
        if (armTimer) clearTimeout(armTimer);
        armTimer = setTimeout(function () { armed = 0; armTimer = undefined; draw(); }, 3000);
        return;
      }
      armed = 0; if (armTimer) clearTimeout(armTimer); armTimer = undefined;
    }
    act(b.id);
  }

  // Die Handy-App ruft nach dem Abgleich global.skReload() auf.
  global.skReload = function () { state = norm(Storage.readJSON(SF, true)); draw(); };
  if (global.SKALT) global.SKALT.onChange = draw;

  // UNSICHER (API): Bangle.setUI({mode:"custom", touch, btn, remove}) - Knopf BTN1 fuehrt zur Uhr zurueck.
  Bangle.setUI({
    mode: "custom",
    touch: onTouch,
    btn: function () { load(); },
    remove: function () {
      if (drawTimer) clearTimeout(drawTimer);
      if (armTimer) clearTimeout(armTimer);
      delete global.skReload;
      if (global.SKALT) global.SKALT.onChange = null;
    }
  });
  Bangle.setLocked(false);
  draw();
  schedule();
})();
