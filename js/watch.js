// Uhr Bangle.js 2 (Update 7): Verbindung per Web Bluetooth (Nordic-UART, Espruino-REPL),
// App auf die Uhr spielen, Abgleich (Stempel-Warteschlange der Uhr, Schritte/Puls/Höhenmeter, Zustand zurück).
// Protokoll: Befehl = "\x10" + JS + "\n" (\x10 = ohne Echo); Antwort = eine JSON-Zeile {"sk":<id>,"r":…} bzw. {"sk":<id>,"e":"…"}.
import "./lock-core.js";

const UART = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // Handy → Uhr (schreiben)
const RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // Uhr → Handy (Notifications)
const CHUNK_BYTES = 20;
const STORAGE_CHUNK = 256;          // Zeichen Nutzdaten pro Storage.write-Befehl
const LS_KEY = "stempelkarte.watch.v1";
const LS_DAYS = "stempelkarte.watch.days"; // nur Fallback, falls store.saveDay fehlt
const DAYS_BACK = 14;
const AUTO_GAP_MS = 5 * 60 * 1000;
const WORK = "Arbeiten";
export const APP_FILES = [
  { url: "./tools/bangle/stempelkarte.app.js", name: "stempel.app.js" },
  { url: "./tools/bangle/stempelkarte.boot.js", name: "stempel.boot.js" },
];
export const SHOP_URL = "https://shop.espruino.com/banglejs2";

const Core = () => globalThis.LockCore;

// ---------- Einstellungen (pro Gerät/Browser, weil auch die Bluetooth-Freigabe pro Browser gilt) ----------

const DEFAULT_PREFS = { paired: false, autoSync: true, lastSync: 0, lastQ: 0, deviceId: "", deviceName: "", installedAt: 0, lastError: "" };

export function readPrefs() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(LS_KEY);
    return { ...DEFAULT_PREFS, ...(raw ? JSON.parse(raw) : {}) };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function savePrefs(partial) {
  const p = { ...readPrefs(), ...partial };
  try { globalThis.localStorage && globalThis.localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* egal */ }
  emit();
  return p;
}

// ---------- Status für die Einstellungen ----------

let status = { state: "idle", msg: "", progress: null };
const listeners = new Set();

export function getStatus() {
  return { ...status, ...readPrefs(), supported: isSupported(), connected: !!(conn && conn.connected) };
}
export function onStatus(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit() {
  const s = getStatus();
  for (const cb of [...listeners]) { try { cb(s); } catch (e) { console.error(e); } }
}
function setStatus(state, msg = "", progress = null) {
  status = { state, msg, progress };
  emit();
}

export function isSupported() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth && typeof navigator.bluetooth.requestDevice === "function";
}

// ---------- Hilfen (rein, getestet) ----------

/** JS-String-Literal nur aus ASCII (Umlaute → \xNN, sonst \uNNNN). */
export function jsStr(s) {
  let out = '"';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (c === 10) out += "\\n";
    else if (c === 13) out += "\\r";
    else if (c === 9) out += "\\t";
    else if (c < 32 || (c > 126 && c < 256)) out += "\\x" + c.toString(16).padStart(2, "0");
    else if (c >= 256 && c < 0x10000) out += "\\u" + c.toString(16).padStart(4, "0");
    else if (c >= 0x10000) out += "?";
    else out += ch;
  }
  return out + '"';
}

/** JSON als ASCII (gültiges JS-Literal für die Uhr). */
export function asciiJson(v) {
  return JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** Text in Byte-Stücke für BLE-Writes. */
export function chunkBytes(str, size = CHUNK_BYTES) {
  const bytes = new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
/** CRC32 (IEEE) über die Zeichencodes 0–255 – wie E.CRC32 auf der Uhr. */
export function crc32(str) {
  let c = 0xffffffff;
  for (let i = 0; i < str.length; i++) c = CRC_TABLE[(c ^ str.charCodeAt(i)) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pad(n) { return (n < 10 ? "0" : "") + n; }
export function dayKeyOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/** Laufende Schicht wie timer.clockIn, aber mit Start-Zeitpunkt t und ohne Ort. */
export function newRunning(t, activity = WORK) {
  return {
    start: t,
    segments: [{ start: t, activity: activity || WORK, placeId: null, place: "", loc: null }],
    placeId: null, place: "", note: "", pauseStart: null, pauseMs: 0, inLoc: null,
  };
}

/**
 * Warteschlange der Uhr [{t, a:"in"|"pause"|"resume"|"act"|"out", v}] in Reihenfolge anwenden (rein).
 * → { running, steps:[{type:"out", running, end}], changed, applied, skipped }
 * Ausstempeln wird als Schritt geliefert (Aufrufer: setRunning(step.running) + timer.clockOut({end})).
 */
export function applyWatchQueue(running, events, now = Date.now()) {
  const C = Core();
  let r = running || null;
  const steps = [];
  let changed = false, applied = 0, skipped = 0;
  const list = (events || []).map((e, i) => ({ ...e, _i: i }))
    .filter((e) => e && Number.isFinite(Number(e.t)))
    .sort((a, b) => (a.t - b.t) || (a._i - b._i));
  for (const ev of list) {
    const t = Math.min(Number(ev.t), now);
    if (ev.a === "in") {
      if (r) { skipped++; continue; }
      r = newRunning(t);
      changed = true; applied++;
    } else if (ev.a === "out") {
      if (!r || !(t > r.start)) { skipped++; continue; }
      steps.push({ type: "out", running: r, end: t });
      r = null; changed = true; applied++;
    } else if (ev.a === "pause" || ev.a === "resume" || ev.a === "act") {
      if (!r || t < (Number(r.start) || 0)) { skipped++; continue; }
      const action = C.parseAction(ev.a === "act" ? "act:" + (ev.v || WORK) : ev.a);
      const res = C.applyAction(r, action, t);
      if (res.changed) { r = res.running; changed = true; applied++; } else skipped++;
    } else skipped++;
  }
  return { running: r, steps, changed, applied, skipped };
}

/** Zustand für die Anzeige auf der Uhr. */
export function watchState(snap, now = Date.now(), util = null) {
  const dk = util && util.dayKey ? util.dayKey(now) : dayKeyOf(now);
  const key = (ts) => (util && util.dayKey ? util.dayKey(ts) : dayKeyOf(ts));
  const r = snap && snap.running;
  let done = 0;
  for (const e of (snap && snap.entries) || []) {
    if (!e || (e.kind && e.kind !== "work") || !e.end || key(e.start) !== dk) continue;
    done += Math.max(0, (e.end - e.start) / 60000 - (Number(e.pauseMin) || 0));
  }
  const C = Core();
  return {
    start: r ? r.start : null,
    p: r && r.pauseStart != null ? r.pauseStart : null,
    pm: r ? Number(r.pauseMs) || 0 : 0,
    act: r ? (C ? C.currentActivity(r) : WORK) : WORK,
    done: Math.round(done), dk, at: now,
  };
}

/** Tageswerte aus Gesundheitsdaten {dk:{s,c,n,b,m}} + Höhenmetern {dk:{u,d}} → {dk: Day-Teil}. */
export function buildDays(health, alt, now = Date.now(), back = DAYS_BACK) {
  const out = {};
  const base = new Date(now);
  for (let i = 0; i < back; i++) {
    const dk = dayKeyOf(new Date(base.getFullYear(), base.getMonth(), base.getDate() - i).getTime());
    const h = (health && health[dk]) || null;
    const a = (alt && alt[dk]) || null;
    const day = {
      steps: h && h.c > 0 ? Math.round(h.s) : null,
      altUp: a && Number.isFinite(Number(a.u)) ? Math.round(a.u) : null,
      altDown: a && Number.isFinite(Number(a.d)) ? Math.round(a.d) : null,
      hrAvg: h && h.n > 0 ? Math.round(h.b / h.n) : null,
      hrMax: h && h.m > 0 ? Math.round(h.m) : null,
    };
    if (day.steps == null && day.altUp == null && day.hrAvg == null) continue;
    out[dk] = { ...day, source: "bangle" };
  }
  return out;
}

function sameDay(a, b) {
  if (!a || !b) return false;
  return ["steps", "altUp", "altDown", "hrAvg", "hrMax"].every((k) => (a[k] ?? null) === (b[k] ?? null));
}

// ---------- Befehle für die Uhr (Espruino-JS, je eine Zeile) ----------

const W_INFO = '(function(){var s=require("Storage");return {now:Date.now(),app:!!s.read("stempel.app.js"),' +
  'q:s.readJSON("stempel.queue.json",1)||[],alt:s.readJSON("stempel.days.json",1)||{},' +
  'bat:E.getBattery(),fw:process.env.VERSION};})()';

// UNSICHER (API): require("health").readDay(date, cb) ruft cb je 10-Minuten-Block mit {hr,min,steps,bpm,…} auf
// (bpmMax nur in neueren Versionen der Health-App). Bangle.getHealthStatus("day").steps = Schritte heute bisher.
const W_HEALTH = '(function(){var h;try{h=require("health");}catch(e){}var o={},n=new Date();' +
  'function k(d){return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);}' +
  'for(var i=0;i<' + DAYS_BACK + ';i++){var d=new Date(n.getFullYear(),n.getMonth(),n.getDate()-i);var x={s:0,c:0,n:0,b:0,m:0};' +
  'if(h&&h.readDay){try{h.readDay(d,function(r){x.c++;x.s+=r.steps||0;if(r.bpm){x.n++;x.b+=r.bpm;var mx=r.bpmMax||r.bpm;if(mx>x.m)x.m=mx;}});}catch(e){}}' +
  'if(i==0&&Bangle.getHealthStatus){try{var t=Bangle.getHealthStatus("day");if(t&&t.steps>=x.s){x.s=t.steps;if(!x.c)x.c=1;}}catch(e){}}' +
  'o[k(d)]=x;}return {has:!!h,d:o};})()';

const wClearQueue = (n) => '(function(){var s=require("Storage"),f="stempel.queue.json",q=s.readJSON(f,1)||[];' +
  'q=q.slice(' + n + ');if(q.length)s.writeJSON(f,q);else s.erase(f);return q.length;})()';

const wState = (st) => '(function(){require("Storage").writeJSON("stempel.state.json",' + asciiJson(st) + ');' +
  'if(global.skReload)global.skReload();return 1;})()';

const wSetTime = (ms) => '(function(){setTime(' + (ms / 1000).toFixed(3) + ');return Date.now();})()';

/** Launcher-Eintrag. */
export const APP_INFO = {
  id: "stempel", name: "Stempelkarte", src: "stempel.app.js", icon: "stempel.img", type: "app", version: "0.1", tags: "tool",
  files: "stempel.info,stempel.app.js,stempel.boot.js,stempel.img", data: "stempel.queue.json,stempel.state.json,stempel.days.json",
};

/** 48×48-Symbol (Espruino-Bildformat, 1 Bit): Kreis mit Zeigern. */
export function appIcon() {
  const W = 48, H = 48;
  const bits = new Uint8Array((W * H) / 8);
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) { const i = y * W + x; bits[i >> 3] |= 0x80 >> (i & 7); } };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - 23.5, dy = y - 23.5, d = Math.hypot(dx, dy);
    if (d >= 18 && d <= 22) set(x, y);                                   // Ring
    if (Math.abs(dx) <= 1.6 && dy <= 0 && dy >= -14) set(x, y);           // Zeiger 12 Uhr
    if (Math.abs(dy) <= 1.6 && dx >= 0 && dx <= 10) set(x, y);            // Zeiger 3 Uhr
  }
  let s = String.fromCharCode(W, H, 1);
  for (const b of bits) s += String.fromCharCode(b);
  return s;
}

// ---------- Verbindung ----------

let conn = null;     // {device, server, tx, buf, pending, nextId, lastText, connected}
let busy = null;     // läuft gerade eine Aktion?

function err(msg, code) { const e = new Error(msg); e.sk = true; if (code) e.code = code; return e; }

/** Für „Mein Tag“ & andere Geräte: settings.watch = {paired, deviceId, lastSync} (merge über saveSettings). */
async function markSettings(ctx, extra = {}) {
  const store = ctx && ctx.store;
  if (!store || typeof store.saveSettings !== "function") return;
  const s = (store.get() && store.get().settings) || {};
  const cur = s.watch || {};
  const p = readPrefs();
  const next = { ...cur, paired: true, deviceId: p.deviceId || cur.deviceId || "", lastSync: cur.lastSync || 0, ...extra };
  if (JSON.stringify(next) === JSON.stringify(cur)) return;
  try { await store.saveSettings({ watch: next }); } catch (e) { console.warn("settings.watch nicht gespeichert:", e); }
}

/** Fehler in verständliches Deutsch. */
export function niceError(e) {
  const name = e && e.name;
  const m = String((e && e.message) || e || "");
  if (e && e.sk) return m;
  if (name === "NotFoundError" && /cancel/i.test(m)) return "Keine Uhr ausgewählt.";
  if (name === "NotFoundError") return "Keine Uhr gefunden. Ist die Bangle.js in der Nähe, eingeschaltet und Bluetooth am Handy an?";
  if (name === "SecurityError") return "Bluetooth ist hier nicht erlaubt (nur über https bzw. in der installierten App).";
  if (name === "NotAllowedError") return "Bluetooth wurde nicht erlaubt.";
  if (name === "NetworkError") return "Verbindung zur Uhr fehlgeschlagen. Ist sie gerade mit einer anderen App (z. B. Gadgetbridge) verbunden?";
  return m || "Unbekannter Fehler bei der Uhr.";
}

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(err(msg, "timeout")), ms); })]).finally(() => clearTimeout(t));
}

async function pickDevice(interactive, choose = false) {
  const bt = navigator.bluetooth;
  const prefs = readPrefs();
  if (!choose && typeof bt.getDevices === "function") {
    try {
      const list = await bt.getDevices();
      const match = list.find((d) => prefs.deviceId && d.id === prefs.deviceId) || list.find((d) => /^Bangle/i.test(d.name || ""));
      if (match) return match;
    } catch { /* weiter */ }
  }
  if (!interactive) throw err("Uhr ist hier noch nicht freigegeben – tippe einmal auf „Uhr verbinden“.", "no-device");
  return bt.requestDevice({ filters: [{ namePrefix: "Bangle" }], optionalServices: [UART] });
}

/** Wartet bei bekannten Geräten kurz auf ein Lebenszeichen (Chrome verbindet sonst evtl. nicht).
 *  UNSICHER (API): device.watchAdvertisements() gibt es nur in neueren Chrome-Versionen. */
async function waitNearby(device, ms = 6000) {
  if (typeof device.watchAdvertisements !== "function") return;
  let ctrl = null;
  try {
    ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(err("Die Uhr ist nicht in der Nähe.", "not-nearby")), ms);
      device.addEventListener("advertisementreceived", () => { clearTimeout(t); resolve(); }, { once: true });
      device.watchAdvertisements(ctrl ? { signal: ctrl.signal } : undefined).catch(() => { clearTimeout(t); resolve(); });
    });
  } finally {
    try { if (ctrl) ctrl.abort(); } catch { /* egal */ }
  }
}

/** Mit der Uhr verbinden. interactive=false: nur bereits freigegebene Uhr, keine Auswahl. */
export async function connect({ interactive = true, choose = false } = {}) {
  if (!isSupported()) throw err("Dein Browser kann kein Web Bluetooth. Am Android-Handy klappt es mit Chrome, am iPhone leider nicht.", "unsupported");
  if (conn && conn.connected) return conn;
  setStatus("connecting", "Verbinde mit der Uhr …");
  const device = await pickDevice(interactive, choose);
  if (!device.gatt) throw err("Diese Uhr kann nicht verbunden werden.");
  if (!device.gatt.connected && !interactive) await waitNearby(device);
  const server = await withTimeout(device.gatt.connect(), 15000, "Die Uhr antwortet nicht. Ist sie in der Nähe und nicht mit einer anderen App verbunden?");
  const svc = await server.getPrimaryService(UART);
  const tx = await svc.getCharacteristic(TX);
  const rx = await svc.getCharacteristic(RX);
  const c = { device, server, tx, rx, buf: "", pending: new Map(), nextId: 1, lastText: "", connected: true, writing: Promise.resolve(), dec: new TextDecoder() };
  c.onData = (ev) => onData(c, ev.target.value);
  c.onDisc = () => dropConn(c, "Die Verbindung zur Uhr wurde getrennt.");
  rx.addEventListener("characteristicvaluechanged", c.onData);
  device.addEventListener("gattserverdisconnected", c.onDisc);
  await rx.startNotifications();
  conn = c;
  await write(c, "\x03"); // angefangene Eingabe auf der Uhr verwerfen (Strg+C)
  savePrefs({ paired: true, deviceId: device.id || "", deviceName: device.name || "Bangle.js" });
  setStatus("connected", "Verbunden mit " + (device.name || "der Uhr"));
  return c;
}

function dropConn(c, reason) {
  if (!c.connected) return;
  c.connected = false;
  for (const p of c.pending.values()) { clearTimeout(p.timer); p.reject(err(reason, "disconnected")); }
  c.pending.clear();
  try { c.rx.removeEventListener("characteristicvaluechanged", c.onData); } catch { /* egal */ }
  try { c.device.removeEventListener("gattserverdisconnected", c.onDisc); } catch { /* egal */ }
  if (conn === c) conn = null;
  if (status.state === "connected") setStatus("idle", "");
  else emit();
}

export async function disconnect() {
  const c = conn;
  if (!c) return;
  dropConn(c, "Verbindung beendet.");
  try { if (c.server && c.server.connected) c.server.disconnect(); else if (c.device.gatt && c.device.gatt.connected) c.device.gatt.disconnect(); } catch { /* egal */ }
  if (status.state === "connected") setStatus("idle", "");
}

function onData(c, value) {
  const bytes = value instanceof DataView ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
  c.buf += c.dec.decode(bytes, { stream: true });
  let i;
  while ((i = c.buf.indexOf("\n")) >= 0) {
    const line = c.buf.slice(0, i).replace(/\r$/, "");
    c.buf = c.buf.slice(i + 1);
    handleLine(c, line);
  }
  if (c.buf.length > 200000) c.buf = c.buf.slice(-1000); // Schutz vor Müll
}

function handleLine(c, line) {
  const j = line.indexOf('{"sk":');
  if (j >= 0) {
    let msg = null;
    try { msg = JSON.parse(line.slice(j)); } catch { msg = null; }
    if (msg && c.pending.has(msg.sk)) {
      const p = c.pending.get(msg.sk);
      c.pending.delete(msg.sk);
      clearTimeout(p.timer);
      if (msg.e != null) p.reject(err("Fehler auf der Uhr: " + msg.e, "watch"));
      else p.resolve(msg.r);
      return;
    }
  }
  const t = line.replace(/[\x00-\x1f>]/g, "").trim();
  if (t) c.lastText = t.slice(0, 200);
}

function write(c, str) {
  const run = async () => {
    for (const part of chunkBytes(str)) {
      if (!c.connected) throw err("Die Verbindung zur Uhr wurde getrennt.", "disconnected");
      if (typeof c.tx.writeValueWithResponse === "function") await c.tx.writeValueWithResponse(part);
      else await c.tx.writeValue(part);
    }
  };
  const p = c.writing.then(run, run);
  c.writing = p.catch(() => {});
  return p;
}

/** JS-Ausdruck auf der Uhr auswerten → Ergebnis (JSON). */
export async function call(expr, { timeout = 8000 } = {}) {
  const c = conn;
  if (!c || !c.connected) throw err("Die Uhr ist nicht verbunden.", "disconnected");
  const id = c.nextId++;
  const cmd = "\x10try{Bluetooth.println(JSON.stringify({sk:" + id + ",r:(" + expr + ")}));}catch(e){Bluetooth.println(JSON.stringify({sk:" + id + ",e:\"\"+e}));}\n";
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      c.pending.delete(id);
      reject(err("Die Uhr antwortet nicht" + (c.lastText ? ` (${c.lastText})` : "") + ". Ist sie in der Nähe und eingeschaltet?", "timeout"));
    }, timeout);
    c.pending.set(id, { resolve, reject, timer });
  });
  c.lastText = "";
  try { await write(c, cmd); } catch (e) {
    const p = c.pending.get(id);
    if (p) { clearTimeout(p.timer); c.pending.delete(id); }
    throw e;
  }
  return result;
}

function exclusive(fn) {
  if (busy) return Promise.reject(err("Die Uhr ist gerade beschäftigt – kurz warten.", "busy"));
  busy = (async () => { try { return await fn(); } finally { busy = null; } })();
  return busy;
}

// ---------- Uhr verbinden (Test) ----------

/** Verbindet, liest Akku/Firmware und ob die App drauf ist; trennt danach wieder. */
export function pair(ctx) {
  return exclusive(async () => {
    try {
      await connect({ interactive: true, choose: true });
      const info = await call('{bat:E.getBattery(),fw:process.env.VERSION,app:!!require("Storage").read("stempel.app.js")}');
      savePrefs({ lastError: "" });
      await markSettings(ctx);
      setStatus("idle", `Verbunden: ${readPrefs().deviceName} · Akku ${info.bat} %` + (info.app ? "" : " · Stempelkarte-App fehlt noch"));
      return info;
    } catch (e) {
      const m = niceError(e); savePrefs({ lastError: m }); setStatus("error", m); throw err(m, e.code);
    } finally { await disconnect(); }
  });
}

// ---------- App auf die Uhr spielen ----------

async function writeFile(name, content, onChunk) {
  const total = content.length;
  if (/[^\x00-\xff]/.test(content)) throw err(`${name}: enthält Zeichen, die die Uhr nicht speichern kann.`);
  for (let off = 0; off < total || (total === 0 && off === 0); off += STORAGE_CHUNK) {
    const part = content.slice(off, off + STORAGE_CHUNK);
    const args = off === 0 ? `${jsStr(name)},${jsStr(part)},0,${total}` : `${jsStr(name)},${jsStr(part)},${off}`;
    await call(`require("Storage").write(${args})`, { timeout: 10000 });
    if (onChunk) onChunk(Math.min(off + STORAGE_CHUNK, total));
    if (total === 0) break;
  }
  const check = await call(`(function(){var f=require("Storage").read(${jsStr(name)});return f?{l:f.length,c:E.CRC32(f)}:null;})()`, { timeout: 10000 });
  // UNSICHER (API): E.CRC32 sollte die Standard-CRC32 sein; Abweichung nur bei der Länge ist ein harter Fehler.
  if (!check || check.l !== total) throw err(`${name} wurde nicht vollständig gespeichert – bitte nochmal versuchen.`);
  if ((check.c >>> 0) !== crc32(content)) console.warn("Uhr: CRC weicht ab", name, check.c, crc32(content));
}

/** Lädt die Watch-App (stempel.app.js + stempel.boot.js + Symbol + stempel.info) auf die Uhr. */
export function installApp(onProgress, ctx = null) {
  return exclusive(async () => {
    try {
      setStatus("installing", "Lade die App …", 0);
      const files = [];
      for (const f of APP_FILES) {
        const res = await fetch(f.url, { cache: "no-store" });
        if (!res.ok) throw err("Die Uhr-App konnte nicht geladen werden (offline?).");
        files.push({ name: f.name, content: await res.text() });
      }
      files.push({ name: "stempel.img", content: appIcon() });
      await connect({ interactive: true });
      const total = files.reduce((n, f) => n + f.content.length, 0) || 1;
      let doneBefore = 0;
      for (const f of files) {
        await writeFile(f.name, f.content, (n) => {
          const p = (doneBefore + n) / total;
          setStatus("installing", `Spiele die App auf die Uhr … ${Math.round(p * 100)} %`, p);
          if (onProgress) onProgress(p);
        });
        doneBefore += f.content.length;
      }
      await call(`require("Storage").writeJSON("stempel.info",${asciiJson(APP_INFO)})`, { timeout: 10000 });
      // UNSICHER (API): Ohne ".boot0" baut der Bootloader die Boot-Datei beim nächsten load() neu (dann läuft
      // stempel.boot.js); "launch.cache.json" zwingt den Launcher, die App-Liste neu einzulesen.
      await call('(function(){var s=require("Storage");s.erase(".boot0");s.erase("launch.cache.json");setTimeout(load,300);return 1;})()', { timeout: 10000 });
      savePrefs({ installedAt: Date.now(), lastError: "" });
      await markSettings(ctx);
      setStatus("idle", "Fertig! Die App „Stempelkarte“ ist jetzt im Menü der Uhr.", 1);
      return true;
    } catch (e) {
      const m = niceError(e); savePrefs({ lastError: m }); setStatus("error", m); throw err(m, e.code);
    } finally { await disconnect(); }
  });
}

// ---------- Abgleich ----------

async function saveDays(ctx, days) {
  const store = ctx.store;
  const have = (store.get() && store.get().days) || {};
  let n = 0;
  const now = Date.now();
  if (typeof store.saveDay === "function") {
    for (const [dk, d] of Object.entries(days)) {
      if (sameDay(have[dk], d)) continue;
      await store.saveDay(dk, { ...d, syncedAt: now });
      n++;
    }
  } else {
    // Fallback: store.saveDay fehlt (noch) → lokal ablegen
    console.warn("store.saveDay fehlt – Tageswerte der Uhr nur lokal gespeichert");
    let all = {};
    try { all = JSON.parse(globalThis.localStorage.getItem(LS_DAYS) || "{}"); } catch { all = {}; }
    for (const [dk, d] of Object.entries(days)) { if (!sameDay(all[dk], d)) { all[dk] = { ...(all[dk] || {}), ...d, syncedAt: now }; n++; } }
    try { globalThis.localStorage.setItem(LS_DAYS, JSON.stringify(all)); } catch { /* egal */ }
  }
  return n;
}

async function runQueue(ctx, events) {
  const { store, timer } = ctx;
  const before = store.get().running || null;
  const plan = applyWatchQueue(before, events, Date.now());
  for (const step of plan.steps) {
    await store.setRunning(step.running);
    await timer.clockOut({ end: step.end });
  }
  if (plan.steps.length ? !!plan.running : plan.changed) await store.setRunning(plan.running);
  return plan;
}

async function waitReady(store, ms = 15000) {
  if (store.get() && store.get().ready) return true;
  return new Promise((resolve) => {
    let un = null;
    const t = setTimeout(() => { if (un) un(); resolve(false); }, ms);
    un = store.subscribe((s) => { if (s && s.ready) { clearTimeout(t); queueMicrotask(() => un && un()); resolve(true); } });
  });
}

/**
 * Abgleich: Warteschlange der Uhr anwenden, Tageswerte speichern, Zustand zurückschicken.
 * → { applied, skipped, days, app, steps }
 */
export function sync(ctx, { interactive = true, quiet = false } = {}) {
  return exclusive(async () => {
    try {
      if (!ctx || !ctx.store) throw err("App ist noch nicht bereit.");
      if (!(await waitReady(ctx.store))) throw err("Deine Daten sind noch nicht geladen – gleich nochmal versuchen.");
      await connect({ interactive });
      setStatus("syncing", "Gleiche mit der Uhr ab …");
      const t0 = Date.now();
      const info = await call(W_INFO, { timeout: 10000 });
      const t1 = Date.now();
      const offset = Math.round((t0 + t1) / 2 - Number(info.now)); // Handy − Uhr
      if (Math.abs(offset) > 60000) {
        try { await call(wSetTime(Date.now())); } catch (e) { console.warn("Uhrzeit nicht gestellt:", e); }
      }
      const prefs = readPrefs();
      const queue = Array.isArray(info.q) ? info.q : [];
      const fresh = queue.filter((e) => e && Number(e.t) > (prefs.lastQ || 0));
      const events = fresh.map((e) => ({ ...e, t: Math.abs(offset) > 60000 ? Number(e.t) + offset : Number(e.t) }));
      const plan = await runQueue(ctx, events);
      if (queue.length) {
        const maxT = Math.max(...queue.map((e) => Number(e.t) || 0));
        savePrefs({ lastQ: Math.max(prefs.lastQ || 0, maxT) });
        await call(wClearQueue(queue.length), { timeout: 10000 });
      }

      setStatus("syncing", "Lese Schritte und Puls …");
      let health = null;
      try { health = await call(W_HEALTH, { timeout: 40000 }); } catch (e) { console.warn("Gesundheitsdaten nicht gelesen:", e); }
      const days = buildDays(health && health.d, info.alt, Date.now());
      const nDays = await saveDays(ctx, days);

      if (info.app) await call(wState(watchState(ctx.store.get(), Date.now(), ctx.util)), { timeout: 10000 });

      const now = Date.now();
      savePrefs({ lastSync: now, lastError: "" });
      await markSettings(ctx, { lastSync: now });
      const today = days[dayKeyOf(now)];
      let msg = "Abgeglichen um " + pad(new Date(now).getHours()) + ":" + pad(new Date(now).getMinutes());
      if (!info.app) msg += " · Stempelkarte-App ist noch nicht auf der Uhr";
      else if (health && !health.has) msg += " · Health-App fehlt auf der Uhr (keine Schritte)";
      setStatus("idle", msg);
      if (plan.applied && ctx.ui && ctx.ui.toast) {
        ctx.ui.toast(plan.applied === 1 ? "1 Aktion von der Uhr übernommen" : `${plan.applied} Aktionen von der Uhr übernommen`, 2800);
      } else if (!quiet && ctx.ui && ctx.ui.toast) ctx.ui.toast("Mit der Uhr abgeglichen", 2000);
      return { applied: plan.applied, skipped: plan.skipped, days: nDays, app: !!info.app, steps: today ? today.steps : null, battery: info.bat };
    } catch (e) {
      const m = niceError(e);
      savePrefs({ lastError: m });
      setStatus("error", m);
      throw err(m, e && e.code);
    } finally { await disconnect(); }
  });
}

let lastAuto = 0;
let visHooked = false;

/** Beim Start/Sichtbarwerden: still abgleichen, wenn schon einmal verbunden und Schalter an. */
export async function autoSync(ctx) {
  if (!visHooked && typeof document !== "undefined") {
    visHooked = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") autoSync(ctx).catch(() => {});
    });
  }
  if (!isSupported() || typeof navigator.bluetooth.getDevices !== "function") return null;
  const p = readPrefs();
  if (!p.paired || p.autoSync === false || busy) return null;
  if (Date.now() - lastAuto < AUTO_GAP_MS) return null;
  lastAuto = Date.now();
  try {
    return await sync(ctx, { interactive: false, quiet: true });
  } catch (e) {
    if (e && (e.code === "no-device" || e.code === "not-nearby")) setStatus("idle", "");
    return null;
  }
}

/** Nur für Tests: Zustand zurücksetzen. */
export function _reset() { conn = null; busy = null; lastAuto = 0; status = { state: "idle", msg: "", progress: null }; }
