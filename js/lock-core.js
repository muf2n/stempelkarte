// Gemeinsamer Kern für die Steuerung am Sperrbildschirm (Update 6).
// Klassisches Skript ohne import/export, damit es überall läuft:
//  - im Service Worker per importScripts("js/lock-core.js")
//  - in der App per `import "./lock-core.js"` (legt globalThis.LockCore an)
//  - in node für Tests (module.exports)
// Enthält: Firestore-Value-Codec (REST), Aktions-Logik (gleiche Semantik wie timer.js),
// Text/Knöpfe der Status-Benachrichtigung und kleine IndexedDB-Hilfen.
(function (root) {
  "use strict";

  var DRIVE = "Autofahren";
  var WORK = "Arbeiten";
  var TAG = "stempel-status";
  var ICON = "icons/wecker-192.png";
  var DB_NAME = "stempelkarte-sw";
  var DB_VERSION = 1;
  var QUEUE_MAX_AGE_MS = 24 * 3600 * 1000;

  // ---------- Firestore-Value-Codec ----------
  // Unterstützt map/array/string/integer/double/null/boolean. Andere Typen (timestamp, geoPoint …)
  // werden als {__fs:{<typ>:<wert>}} unverändert durchgereicht, damit nichts verloren geht.

  function encodeValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") {
      if (!isFinite(v)) return { nullValue: null };
      if (Number.isInteger(v) && Number.isSafeInteger(v) && !Object.is(v, -0)) return { integerValue: String(v) };
      return { doubleValue: v };
    }
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) {
      var values = [];
      for (var i = 0; i < v.length; i++) if (v[i] !== undefined) values.push(encodeValue(v[i]));
      return { arrayValue: values.length ? { values: values } : {} };
    }
    if (typeof v === "object") {
      if (v.__fs && typeof v.__fs === "object") return v.__fs;
      return { mapValue: { fields: encodeFields(v) } };
    }
    return { nullValue: null };
  }

  function encodeFields(obj) {
    var out = {};
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (obj[k] === undefined) continue;
      out[k] = encodeValue(obj[k]);
    }
    return out;
  }

  function decodeValue(v) {
    if (!v || typeof v !== "object") return null;
    if ("nullValue" in v) return null;
    if ("booleanValue" in v) return !!v.booleanValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("stringValue" in v) return String(v.stringValue);
    if ("arrayValue" in v) {
      var vals = (v.arrayValue && v.arrayValue.values) || [];
      return vals.map(decodeValue);
    }
    if ("mapValue" in v) return decodeFields((v.mapValue && v.mapValue.fields) || {});
    return { __fs: v };
  }

  function decodeFields(fields) {
    var out = {};
    for (var k in fields || {}) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) out[k] = decodeValue(fields[k]);
    }
    return out;
  }

  // ---------- Aktionen ----------

  function isDrive(activity) {
    return String(activity || "").toLowerCase().replace(/[^a-zäöüß]/g, "") === "autofahren";
  }

  function segmentsOf(r) {
    if (!r) return [];
    if (Array.isArray(r.segments) && r.segments.length) return r.segments;
    return [{
      start: r.start, activity: WORK,
      placeId: r.placeId == null ? null : r.placeId, place: r.place || "",
      loc: r.inLoc == null ? null : r.inLoc,
    }];
  }

  function currentActivity(r) {
    var segs = segmentsOf(r);
    var last = segs[segs.length - 1];
    return (last && last.activity) || WORK;
  }

  /** "pause" | "resume" | "act:<Name>" → {type, activity?} oder null */
  function parseAction(str) {
    var s = String(str || "");
    if (s === "pause" || s === "resume") return { type: s };
    if (s.indexOf("act:") === 0 && s.length > 4) return { type: "act", activity: s.slice(4) };
    return null;
  }

  function actionString(a) {
    if (!a) return "";
    return a.type === "act" ? "act:" + a.activity : a.type;
  }

  /**
   * Wendet eine Aktion auf die laufende Schicht an (rein, ohne Seiteneffekte).
   * → { running, changed } ; wirft {code:"not-running"}, wenn keine Schicht läuft.
   * Semantik wie timer.js: Pause → pauseStart=ts; Weiter → pauseMs += ts-pauseStart;
   * Tätigkeitswechsel → letzter Abschnitt endLoc=null/endPlace="", neuer Abschnitt ohne Ort.
   */
  function applyAction(running, action, ts) {
    if (!running) { var e = new Error("Du bist nicht eingestempelt."); e.code = "not-running"; throw e; }
    var now = Number(ts) || Date.now();
    var r = Object.assign({}, running);
    if (!action) return { running: r, changed: false };
    if (action.type === "pause") {
      if (r.pauseStart != null) return { running: r, changed: false };
      r.pauseStart = Math.max(now, Number(r.start) || 0);
      return { running: r, changed: true };
    }
    if (action.type === "resume") {
      if (r.pauseStart == null) return { running: r, changed: false };
      r.pauseMs = (Number(r.pauseMs) || 0) + Math.max(0, now - r.pauseStart);
      r.pauseStart = null;
      return { running: r, changed: true };
    }
    if (action.type === "act") {
      var activity = action.activity || WORK;
      var segs = segmentsOf(r);
      var last = segs[segs.length - 1];
      if (last && last.activity === activity) return { running: r, changed: false };
      var start = Math.max(now, (last && last.start) || 0);
      var prev = segs.slice(0, -1);
      if (last) prev.push(Object.assign({}, last, { endLoc: null, endPlace: "" }));
      // via:"lock" → die App trägt den Standort nach, wenn sie bald danach geöffnet wird
      prev.push({ start: start, activity: activity, placeId: null, place: "", loc: null, via: "lock" });
      r.segments = prev;
      return { running: r, changed: true };
    }
    return { running: r, changed: false };
  }

  /** Mehrere Aktionen (Warteschlange) in Reihenfolge mit ihren Original-Zeitstempeln anwenden.
   *  Aktionen von vor dem Schichtbeginn gehören zu einer alten Schicht und werden übersprungen. */
  function applyQueue(running, items) {
    var r = running;
    var changed = false;
    var list = (items || []).slice().sort(function (a, b) { return (a.ts - b.ts) || ((a.id || 0) - (b.id || 0)); });
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!r) break;
      if (!(Number(it.ts) >= (Number(r.start) || 0))) continue;
      try {
        var res = applyAction(r, parseAction(it.action), it.ts);
        r = res.running;
        changed = changed || res.changed;
      } catch (e) { break; }
    }
    return { running: r, changed: changed };
  }

  function nextRev(oldRev, now) {
    return Math.max(Number(now) || Date.now(), (Number(oldRev) || 0) + 1);
  }

  // ---------- Status-Benachrichtigung ----------

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(ts) { var d = new Date(ts); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  function placeOf(r) {
    var segs = segmentsOf(r);
    var last = segs[segs.length - 1] || {};
    return last.place || (last.loc && last.loc.addr) || r.place || "";
  }

  function actionsFor(r, maxActions) {
    var paused = r.pauseStart != null;
    var cur = currentActivity(r);
    var target = isDrive(cur) ? WORK : DRIVE;
    var list = [
      paused ? { action: "resume", title: "Weiter" } : { action: "pause", title: "Pause" },
      { action: "act:" + target, title: target },
    ];
    var max = Number(maxActions);
    if (isFinite(max) && max >= 0) list = list.slice(0, max);
    return list;
  }

  /** → { title, options } für registration.showNotification; note = kurze Rückmeldung statt Standardtext. */
  function statusNotification(r, opts) {
    opts = opts || {};
    var paused = r.pauseStart != null;
    var title = paused ? "Pause seit " + hhmm(r.pauseStart) : "Bei der Arbeit · " + currentActivity(r);
    var place = placeOf(r);
    var body = "Seit " + hhmm(r.start) + (place ? " · " + place : "");
    if (opts.note) body = opts.note + "\n" + body;
    return {
      title: title,
      options: {
        tag: TAG,
        body: body,
        icon: ICON,
        badge: ICON,
        silent: true,
        renotify: false,
        requireInteraction: true,
        timestamp: paused ? r.pauseStart : r.start,
        data: { kind: "status", url: "./#heute" },
        actions: actionsFor(r, opts.maxActions),
      },
    };
  }

  /** Schlüssel, um unnötiges Neuanzeigen zu vermeiden. */
  function statusKey(r, maxActions) {
    if (!r) return "none";
    var n = statusNotification(r, { maxActions: maxActions });
    return [n.title, n.options.body, n.options.timestamp, n.options.actions.map(function (a) { return a.action; }).join(",")].join("|");
  }

  /** Kurze Rückmeldung nach einer Aktion vom Sperrbildschirm. */
  function feedback(action, ts) {
    var t = hhmm(ts);
    if (!action) return "";
    if (action.type === "pause") return "Pause gestartet um " + t;
    if (action.type === "resume") return "Weiter um " + t;
    return action.activity + " seit " + t;
  }

  // ---------- IndexedDB (nur Browser/SW) ----------
  // DB "stempelkarte-sw": Store "config" (key → Wert: firebase, last, token), Store "queue" (autoIncrement).

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB fehlt")); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("config")) db.createObjectStore("config");
        if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("IndexedDB blockiert")); };
    });
  }

  function tx(stores, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(stores, mode);
        var result;
        t.oncomplete = function () { db.close(); resolve(result); };
        t.onerror = function () { db.close(); reject(t.error); };
        t.onabort = function () { db.close(); reject(t.error || new Error("abgebrochen")); };
        var r = fn(t);
        if (r && typeof r.then === "function") r.then(function (v) { result = v; }); // nicht verwendet
        else if (r && "onsuccess" in r) r.onsuccess = function () { result = r.result; };
        else result = r;
      });
    });
  }

  function configGet(key) {
    return tx(["config"], "readonly", function (t) { return t.objectStore("config").get(key); });
  }
  function configSet(key, value) {
    return tx(["config"], "readwrite", function (t) { t.objectStore("config").put(value, key); return true; });
  }
  function queueAdd(item) {
    return tx(["queue"], "readwrite", function (t) { return t.objectStore("queue").add(item); });
  }
  function queueAll() {
    return tx(["queue"], "readonly", function (t) { return t.objectStore("queue").getAll(); });
  }
  /** Löscht die Einträge mit diesen ids und schreibt optional config "last" – in einer Transaktion. */
  function queueRemove(ids, last) {
    return tx(["queue", "config"], "readwrite", function (t) {
      var q = t.objectStore("queue");
      for (var i = 0; i < ids.length; i++) q.delete(ids[i]);
      if (last !== undefined) t.objectStore("config").put(last, "last");
      return true;
    });
  }

  var api = {
    DRIVE: DRIVE, WORK: WORK, TAG: TAG, ICON: ICON, DB_NAME: DB_NAME, QUEUE_MAX_AGE_MS: QUEUE_MAX_AGE_MS,
    encodeValue: encodeValue, encodeFields: encodeFields, decodeValue: decodeValue, decodeFields: decodeFields,
    isDrive: isDrive, segmentsOf: segmentsOf, currentActivity: currentActivity,
    parseAction: parseAction, actionString: actionString, applyAction: applyAction, applyQueue: applyQueue, nextRev: nextRev,
    hhmm: hhmm, actionsFor: actionsFor, statusNotification: statusNotification, statusKey: statusKey, feedback: feedback,
    openDb: openDb, configGet: configGet, configSet: configSet, queueAdd: queueAdd, queueAll: queueAll, queueRemove: queueRemove,
  };
  root.LockCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this);
