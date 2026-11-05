// Update 9 (Agent W3) – Kamera-Fotos in die Galerie übernehmen.
//   Web (Browser + App): Knopf „📥 Fotos von heute importieren“ (auch gestern / Datum) → Mehrfachauswahl →
//     EXIF (Aufnahmezeit, GPS) lesen → Vorschau: Arbeitsfotos vorausgewählt, andere ausgegraut → übernehmen
//     (processImage/addPhoto mit ts = Aufnahmezeit, Position aus EXIF oder vom Ort der Arbeitszeit, Alben automatisch).
//   App (Capacitor-Plugin StempelMedia): neue Kamera-Fotos aus MediaStore seit dem letzten Mal → gleiche Vorschau
//     (oder still übernehmen, wenn „Automatisch übernehmen ohne Nachfrage“ an ist) → markImported.
//     Die App benachrichtigt im Hintergrund („📷 3 neue Baustellen-Fotos …“) – dafür bekommt sie über configure()
//     die Arbeitszeiten der letzten Tage. Tippen öffnet #alltag/galerie?import=native.
//   Einstellungen: settings.mediaImport = { rule, auto, notify, allBuckets }  (Regel siehe media-import-core.js)
//   Doppelt-Schutz: Sammlung a_photo_imports { id, fp, photoId, ts, src, at, name }.
import * as C from "./media-import-core.js";
import * as photos from "./photos.js";
import * as A from "./gallery-albums.js";
import * as G from "./gallery-core.js";
import * as store from "./store.js";
import * as ui from "./ui.js";
import { collection } from "./alltag/db.js";
import { isNative, plugin } from "./native.js";
import { esc } from "./util.js";

const SINCE_KEY = "sk-mi-since";      // App: Aufnahmezeit, bis zu der alles angesehen ist (je Gerät)
const OFFERED_KEY = "sk-mi-offered";  // App: bis dahin schon einmal automatisch angeboten
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (ts) => { const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const fmtTime = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const nFotos = (n) => `${n} ${n === 1 ? "Foto" : "Fotos"}`;
const TARGET_CHARS = 350000;

export function injectCSS() {
  if (document.getElementById("mi-css")) return;
  const l = document.createElement("link");
  l.id = "mi-css"; l.rel = "stylesheet";
  l.href = new URL("../css/media-import.css", import.meta.url).href;
  document.head.appendChild(l);
}

/* ---------- Einstellungen ---------- */

export function settings() { return C.normSettings(store.get().settings); }
export async function saveSettings(partial) {
  const raw = (store.get().settings && store.get().settings.mediaImport) || {};
  await store.saveSettings({ mediaImport: { ...raw, ...settings(), ...partial } });
  pushConfig(true);
  try { window.dispatchEvent(new CustomEvent("sk-mi-settings")); } catch { /* egal */ }
}

/* ---------- Import-Fingerabdrücke (a_photo_imports) ---------- */

let icol = null;
export function importsCol() { return icol || (icol = collection("photo_imports")); }
async function importsReady(ms = 4000) {
  const c = importsCol();
  c.all();
  const t0 = Date.now();
  while (!c.loaded && Date.now() - t0 < ms) await sleep(100);
  return c.loaded;
}
function known() { return C.knownSet(importsCol().all()); }

/* ---------- Regel-Kontext ---------- */

function ruleCtx() {
  const s = store.get();
  return { entries: s.entries || [], running: s.running, places: s.places || [], settings: s.settings || {}, now: Date.now() };
}

/** Einträge einordnen: cls, dup, otherDay, checked. */
function evaluate(items, { dayKey = "" } = {}) {
  const ctx = ruleCtx();
  const ivs = C.workIntervals(ctx);
  const kn = known();
  const { dupes } = C.splitDupes(items, kn);
  const dupSet = new Set(dupes);
  for (const it of items) {
    it.cls = C.classify(it, { ...ctx, intervals: ivs });
    it.dup = dupSet.has(it);
    it.otherDay = !!(dayKey && it.ts && C.dayKeyOf(it.ts) !== dayKey);
    it.checked = !it.dup && it.cls.ok && !it.otherDay;
  }
  return items;
}

function reasonOf(it) {
  if (it.dup) return "dup";
  if (it.otherDay) return "otherday";
  return it.cls.reason;
}

/* ---------- Web: Dateien lesen ---------- */

async function readFileMeta(file) {
  let ex = {};
  let head = new Uint8Array();
  try {
    const buf = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    head = buf.subarray(0, C.HEAD_BYTES);
    if (/jpe?g/i.test(file.type || "") || /\.jpe?g$/i.test(file.name || "") || (buf[0] === 0xFF && buf[1] === 0xD8)) ex = G.readExif(buf);
  } catch { ex = {}; }
  // ohne EXIF-Zeit: Änderungszeit der Datei (bei Kamera-Fotos meist die Aufnahmezeit)
  const ts = ex.ts || Number(file.lastModified) || 0;
  return {
    ts, exifTs: !!ex.ts, lat: G.hasPos(ex) ? ex.lat : null, lng: G.hasPos(ex) ? ex.lng : null,
    fp: C.fpWeb({ size: file.size, ts, head }), size: file.size, name: file.name || "",
  };
}

/* ---------- Gemeinsam: ein Foto übernehmen ---------- */

function folderAt(cls) {
  try {
    if (cls && cls.running) return A.activeFolder().id;   // laufende Schicht: inkl. „für diese Schicht ignorieren“
    const s = store.get();
    return G.resolveActiveFolder({ folders: A.folders(), gallery: (s.settings && s.settings.gallery) || {}, placeId: (cls && cls.placeId) || null, places: s.places || [] }).id;
  } catch { return undefined; }
}

async function importOne(it, processed, src) {
  const cls = it.cls || { placeId: null, place: "", loc: null, entryId: null };
  const ts = it.ts || Date.now();
  const exPos = G.hasPos(it) ? { lat: it.lat, lng: it.lng } : null;
  const pos = exPos || (cls.loc && G.hasPos(cls.loc) ? { lat: cls.loc.lat, lng: cls.loc.lng, ...(Number.isFinite(cls.loc.acc) ? { acc: cls.loc.acc } : {}) } : null);
  const placeId = cls.placeId || null;
  const r = await photos.addPhoto(null, {
    processed, ts, dayKey: C.dayKeyOf(ts),
    placeId, place: cls.place || "", entryId: cls.entryId || null, note: "",
    albumIds: [], lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, acc: pos && Number.isFinite(pos.acc) ? pos.acc : null,
    albMig: true,
  });
  const doc = { id: C.importDocId(it.fp), fp: it.fp, photoId: r.photo.id, ts, src, at: Date.now(), name: String(it.name || "").slice(0, 80) };
  if (it.nativeId != null) doc.nativeId = String(it.nativeId);
  await Promise.race([importsCol().put(doc).catch((e) => console.error("Import merken:", e)), sleep(1500)]);
  const job = A.autoFile(r.photo, { pos, placeId, activeFolderId: folderAt(cls) }).catch((e) => { console.error("Einsortieren:", e); return null; });
  return { photo: r.photo, job };
}

async function finishJobs(jobs, onStep) {
  if (!jobs.length) return [];
  if (onStep) onStep();
  const res = await Promise.race([Promise.all(jobs), sleep(25000).then(() => null)]);
  return res || [];
}

function summary(n, filed) {
  const albums = new Set((filed || []).filter((r) => r && r.album).map((r) => r.album.id));
  return `${nFotos(n)} übernommen${albums.size ? ` · in ${albums.size} ${albums.size === 1 ? "Album" : "Alben"} sortiert` : ""}.`;
}

/* ---------- Vorschau-Blatt ---------- */

const REASON_CLASS = { work: "ok", place: "ok", outside: "off", privat: "priv", nodate: "off", dup: "dup", otherday: "off" };

function tileHTML(it, i) {
  const r = reasonOf(it);
  const lbl = r === "work" ? (it.cls.place ? it.cls.place : "Arbeitszeit") : r === "place" ? (it.cls.place || "an deinem Ort") : C.REASON_LABELS[r];
  return `<button type="button" class="mi-tile is-${REASON_CLASS[r] || "off"}" data-mi-i="${i}" aria-pressed="${it.checked}"${it.dup ? " disabled" : ""} ` +
    `aria-label="${esc(`${it.ts ? fmtTime(it.ts) : "ohne Zeit"} – ${lbl}${it.checked ? ", ausgewählt" : ""}`)}">` +
    (it.src ? `<img src="${esc(it.src)}" alt="" loading="lazy" decoding="async">` : `<span class="mi-noimg" aria-hidden="true">📷</span>`) +
    `<span class="mi-chk" aria-hidden="true">✓</span>` +
    `<span class="mi-cap"><b>${it.ts ? esc(fmtTime(it.ts)) : "–"}${it.ts && it.otherDay ? ` <small>${esc(fmtDate(it.ts).slice(0, 6))}</small>` : ""}</b>` +
      `<small>${G.hasPos(it) ? "📍 " : ""}${esc(lbl)}</small></span>` +
  `</button>`;
}

/**
 * Vorschau mit Auswahl. opts = { title, sub, items, hint, run(selected, progress) → Promise<string|void>, onClose }
 * → { close }
 */
function openPreview({ title, sub = "", items, hint = "", run, onClose }) {
  injectCSS();
  let busy = false;
  let closed = false;
  const r = ui.openSheet({
    title,
    bodyHTML: `<div class="mi-sheet" data-mi="sheet"></div>`,
    onMount(el, close) {
      const box = el.querySelector('[data-mi="sheet"]');
      el.classList.add("mi-sheet-wrap");
      const draw = () => {
        const nSel = items.filter((x) => x.checked).length;
        const nOk = items.filter((x) => !x.dup && x.cls.ok && !x.otherDay).length;
        const nDup = items.filter((x) => x.dup).length;
        const noGps = items.some((x) => !x.dup && !G.hasPos(x));
        box.innerHTML =
          `<div class="mi-top"><div class="mi-sum"><b>${esc(nFotos(items.length))}${sub ? ` · ${esc(sub)}` : ""}</b>` +
            `<small>${nOk ? `${nOk} ${nOk === 1 ? "Arbeitsfoto" : "Arbeitsfotos"} erkannt` : "Keine Arbeitsfotos erkannt"}${nDup ? ` · ${nDup} schon übernommen` : ""}</small></div>` +
            `<div class="mi-allnone"><button type="button" class="btn sm ghost" data-mi="all">Alle</button><button type="button" class="btn sm ghost" data-mi="none">Keine</button></div></div>` +
          `<p class="mi-legend"><span class="mi-dot is-ok"></span>vorausgewählt: Arbeitszeit${C.normSettings(store.get().settings).rule !== "work" ? " oder an deinen Orten" : ""}` +
            ` <span class="mi-dot is-off"></span>privat/außerhalb der Arbeitszeit – antippen zum Auswählen</p>` +
          `<div class="mi-grid" role="group" aria-label="Fotos auswählen">${items.map(tileHTML).join("")}</div>` +
          (noGps ? xiaomiHint(hint) : "") +
          `<div class="mi-foot" data-mi="foot">` +
            `<button type="button" class="btn ghost" data-mi="cancel">Abbrechen</button>` +
            `<button type="button" class="btn primary" data-mi="go"${nSel ? "" : " disabled"}>${nSel ? `📥 ${esc(nFotos(nSel))} übernehmen` : (items.length && nDup === items.length ? "Nichts Neues" : "Nichts ausgewählt")}</button>` +
          `</div>`;
      };
      draw();
      const progress = (i, n, text) => {
        const f = box.querySelector('[data-mi="foot"]');
        if (!f) return;
        const pct = n ? Math.round((i / n) * 100) : 100;
        f.innerHTML = `<div class="mi-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${i}" aria-label="Fortschritt">` +
          `<div class="mi-prog-bar"><span style="width:${pct}%"></span></div><b data-mi="ptext">${esc(text || `Übernehme ${Math.min(i + 1, n)} von ${n} …`)}</b></div>`;
      };
      box.addEventListener("click", async (ev) => {
        if (busy) return;
        const t = ev.target.closest("[data-mi-i]");
        if (t) {
          const it = items[Number(t.dataset.miI)];
          if (!it || it.dup) return;
          it.checked = !it.checked;
          draw();
          const again = box.querySelector(`[data-mi-i="${t.dataset.miI}"]`);
          if (again) again.focus();
          return;
        }
        const b = ev.target.closest("[data-mi]");
        if (!b) return;
        const a = b.dataset.mi;
        if (a === "all") { for (const x of items) if (!x.dup) x.checked = true; draw(); }
        else if (a === "none") { for (const x of items) x.checked = false; draw(); }
        else if (a === "cancel") close();
        else if (a === "go") {
          const sel = items.filter((x) => x.checked && !x.dup);
          if (!sel.length) return;
          busy = true;
          el.classList.add("mi-busy");
          progress(0, sel.length);
          let msg = "";
          try { msg = await run(sel, progress); }
          catch (e) { console.error(e); msg = "Übernehmen hat nicht geklappt."; }
          busy = false;
          close();
          if (msg) ui.toast(msg, 3800);
        }
      });
      // Schließen über ✕/Esc während des Übernehmens verhindern
      const x = el.querySelector(".close");
      if (x) x.addEventListener("click", (ev) => { if (busy) { ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
      new MutationObserver((_, mo) => { if (!el.isConnected) { mo.disconnect(); if (!closed) { closed = true; if (onClose) onClose(); } } }).observe(el.parentNode || document.body, { childList: true });
    },
  });
  return r;
}

function xiaomiHint(extra = "") {
  return `<div class="mi-hint" role="note"><span class="mi-hint-ic" aria-hidden="true">💡</span><span><b>Fotos ohne Standort?</b> ` +
    `Am Xiaomi: <b>Kamera → Einstellungen → Standortinformationen speichern</b> einschalten. Dann kommen neue Fotos automatisch ins Album ihrer Adresse.` +
    (extra ? ` ${esc(extra)}` : "") + `</span></div>`;
}

/* ---------- Web: Import-Ablauf ---------- */

/** Dateien → Vorschau → übernehmen. dayKey = gewählter Tag (andere Tage nicht vorausgewählt). */
export async function importFiles(files, { dayKey = C.dayKeyOf(Date.now()) } = {}) {
  injectCSS();
  const imgs = [...(files || [])].filter((f) => !f.type || /^image\//i.test(f.type));
  if (!imgs.length) { ui.toast("Bitte Bilder auswählen."); return; }
  if (imgs.length > 8) ui.toast(`Lese ${imgs.length} Fotos …`, 1500);
  await importsReady();
  const urls = [];
  const items = [];
  for (const f of imgs) {
    const m = await readFileMeta(f);
    const src = URL.createObjectURL(f);
    urls.push(src);
    items.push({ ...m, key: m.fp, file: f, src });
  }
  items.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  evaluate(items, { dayKey });
  const label = dayKey === C.dayKeyOf(Date.now()) ? "heute" : dayKey === C.dayKeyOf(Date.now() - 86400000) ? "gestern" : `vom ${fmtDate(C.dayStart(dayKey))}`;
  openPreview({
    title: "Fotos übernehmen",
    sub: label,
    items,
    onClose: () => { setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 500); },
    run: async (sel, progress) => {
      const jobs = [];
      let ok = 0, fail = 0;
      for (let i = 0; i < sel.length; i++) {
        progress(i, sel.length);
        try {
          const processed = await photos.processImage(sel[i].file);
          const r = await importOne(sel[i], processed, "web");
          jobs.push(r.job); ok++;
        } catch (e) { console.error(e); fail++; }
      }
      const filed = await finishJobs(jobs, () => progress(sel.length, sel.length, "Sortiere in Alben …"));
      return fail ? `${nFotos(ok)} übernommen, ${fail} nicht lesbar.` : summary(ok, filed);
    },
  });
}

/* ---------- Karte in der Galerie ---------- */

let day = "";
function today() { return C.dayKeyOf(Date.now()); }
function yesterday() { return C.dayKeyOf(Date.now() - 86400000); }
function dayText(k) {
  if (k === today()) return "von heute";
  if (k === yesterday()) return "von gestern";
  return `vom ${fmtDate(C.dayStart(k)).slice(0, 6)}`;
}

/** Karte „📥 Fotos von heute importieren“ (+ gestern / Datum; in der App „Neue Kamera-Fotos“). */
export function cardHTML() {
  injectCSS();
  if (!day) day = today();
  const set = settings();
  const nat = isNative() && !!plugin("StempelMedia");
  return `<section class="mi-card" aria-label="Kamera-Fotos übernehmen">` +
    `<div class="mi-card-h"><span class="mi-card-ic" aria-hidden="true">📥</span><span class="mi-card-t"><b>Fotos aus der Kamera übernehmen</b>` +
      `<small>Arbeitsfotos werden vorausgewählt · ${esc(C.RULE_LABELS[set.rule])}</small></span></div>` +
    `<div class="mi-days" role="group" aria-label="Tag">` +
      `<button type="button" class="mi-day" data-mi-day="${today()}" aria-pressed="${day === today()}">Heute</button>` +
      `<button type="button" class="mi-day" data-mi-day="${yesterday()}" aria-pressed="${day === yesterday()}">Gestern</button>` +
      `<label class="mi-day mi-date${day !== today() && day !== yesterday() ? " is-on" : ""}"><span aria-hidden="true">📅</span><span class="mi-date-t">${day !== today() && day !== yesterday() ? esc(fmtDate(C.dayStart(day)).slice(0, 6)) : "Datum"}</span>` +
        `<input type="date" data-mi="date" value="${esc(day)}" max="${today()}" aria-label="Anderer Tag"></label>` +
    `</div>` +
    `<div class="mi-acts">` +
      `<label class="btn primary mi-pick" tabindex="0" role="button" data-mi-pick><span aria-hidden="true">📥</span><span data-mi="picklbl">Fotos ${esc(dayText(day))} importieren</span>` +
        `<input type="file" accept="image/*" multiple class="mi-file" tabindex="-1"></label>` +
      (nat ? `<button type="button" class="btn ghost mi-nat" data-mi="native"><span aria-hidden="true">📱</span><span>Neue Kamera-Fotos</span></button>` : "") +
    `</div>` +
  `</section>`;
}

/** Klicks/Eingaben der Karte (Ereignis-Delegation an root) + ?import=native. → unsub */
export function wire(root) {
  injectCSS();
  day = today();
  const refresh = () => {
    root.querySelectorAll("[data-mi-day]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.miDay === day)));
    const other = day !== today() && day !== yesterday();
    root.querySelectorAll(".mi-date").forEach((l) => { l.classList.toggle("is-on", other); const t = l.querySelector(".mi-date-t"); if (t) t.textContent = other ? fmtDate(C.dayStart(day)).slice(0, 6) : "Datum"; });
    root.querySelectorAll('[data-mi="picklbl"]').forEach((s) => { s.textContent = `Fotos ${dayText(day)} importieren`; });
  };
  const onClick = (ev) => {
    const d = ev.target.closest("[data-mi-day]");
    if (d && root.contains(d)) { day = d.dataset.miDay; refresh(); return; }
    const n = ev.target.closest('[data-mi="native"]');
    if (n && root.contains(n)) openNativeImport({});
  };
  const onChange = (ev) => {
    const t = ev.target;
    if (t.matches && t.matches('input[data-mi="date"]')) { if (/^\d{4}-\d{2}-\d{2}$/.test(t.value)) { day = t.value; refresh(); } return; }
    if (t.matches && t.matches("input.mi-file")) {
      const files = [...(t.files || [])];
      t.value = "";
      if (files.length) importFiles(files, { dayKey: day });
    }
  };
  const onKey = (ev) => {
    const lab = ev.target.closest && ev.target.closest("label[data-mi-pick]");
    if (!lab || (ev.key !== "Enter" && ev.key !== " ")) return;
    ev.preventDefault();
    const inp = lab.querySelector("input.mi-file");
    if (inp) inp.click();
  };
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("keydown", onKey);
  const onHash = () => checkHash();
  window.addEventListener("hashchange", onHash);
  const onSet = () => root.querySelectorAll(".mi-card-t small").forEach((x) => { x.textContent = `Arbeitsfotos werden vorausgewählt · ${C.RULE_LABELS[settings().rule]}`; });
  window.addEventListener("sk-mi-settings", onSet);
  setTimeout(checkHash, 0);
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    root.removeEventListener("keydown", onKey);
    window.removeEventListener("hashchange", onHash);
    window.removeEventListener("sk-mi-settings", onSet);
  };
}

/** #alltag/galerie?import=native → Vorschau der neuen Kamera-Fotos öffnen, Zusatz aus dem Hash entfernen. */
function checkHash() {
  const h = location.hash || "";
  const m = /^#(alltag\/galerie[^?]*)\?(.*)$/.exec(h);
  if (!m) return;
  const q = new URLSearchParams(m[2]);
  if (q.get("import") !== "native") return;
  try { history.replaceState(history.state, "", location.pathname + location.search + "#" + m[1]); } catch { /* egal */ }
  openNativeImport({});
}

/* ---------- App: StempelMedia ---------- */

function P() { return isNative() ? plugin("StempelMedia") : null; }
async function pcall(method, args) {
  const p = P();
  if (!p || typeof p[method] !== "function") { const e = new Error("kommt mit dem nächsten App-Update"); e.code = "missing"; throw e; }
  return p[method](args || {});
}

export async function nativeStatus() {
  try { return await pcall("status"); } catch (e) { return { access: "none", missing: e.code === "missing", error: String(e.message || e) }; }
}

function dataUrl(s) { return !s ? "" : /^data:/.test(s) ? s : `data:image/jpeg;base64,${s}`; }

async function dataUrlToFile(u) {
  const b = await (await fetch(u)).blob();
  try { return new File([b], "kamera.jpg", { type: "image/jpeg" }); } catch { return b; }
}

/** Bild aus der App laden → { data, thumb, w, h } (zu groß → im Browser weiter verkleinern). */
async function nativeProcessed(id) {
  const r = await pcall("readImage", { id, maxSide: 1280, quality: 0.72 });
  const data = dataUrl(r && r.data);
  if (!data) throw new Error("Bild nicht lesbar");
  let out = { data, thumb: dataUrl(r.thumb) || data, w: Number(r.w || r.width) || 0, h: Number(r.h || r.height) || 0 };
  if (data.length > TARGET_CHARS || !out.w) out = await photos.processImage(await dataUrlToFile(data));
  return out;
}

function nativeSince() {
  const v = Number(lsGet(SINCE_KEY));
  const floor = Date.now() - 7 * 86400000;
  if (Number.isFinite(v) && v > 0) return Math.max(v, floor);
  return C.dayStart(today()); // erstes Mal: ab heute früh
}

let nativeOpen = null;

/** Neue Kamera-Fotos aus der App. opts = { silent } (silent = ohne Vorschau die Arbeitsfotos übernehmen). */
export async function openNativeImport({ silent = false } = {}) {
  if (nativeOpen) return nativeOpen;
  nativeOpen = doNative({ silent }).finally(() => { nativeOpen = null; });
  return nativeOpen;
}

async function doNative({ silent }) {
  injectCSS();
  if (!P()) { if (!silent) ui.toast("Geht nur in der Android-App – im Browser „📥 Fotos importieren“ nutzen."); return { n: 0 }; }
  const st = await nativeStatus();
  if (st.missing) { if (!silent) ui.toast("Kamera-Import kommt mit dem nächsten App-Update."); return { n: 0 }; }
  if (st.access !== "full" && st.access !== "partial") { if (!silent) permissionSheet(st); return { n: 0 }; }
  const set = settings();
  const since = nativeSince();
  let res;
  try { res = await pcall("listNew", { since, limit: 60, allBuckets: set.allBuckets, thumbs: true }); }
  catch (e) { console.error(e); if (!silent) ui.toast("Kamera-Fotos konnten nicht gelesen werden."); return { n: 0 }; }
  const list = (res && Array.isArray(res.items) ? res.items : []).filter((x) => x && x.id != null);
  await importsReady();
  const items = list.map((x) => ({
    key: "n" + x.id, nativeId: x.id, fp: C.fpNative(x.id, x.dateTaken), ts: Number(x.dateTaken) || 0,
    lat: G.hasPos(x) ? x.lat : null, lng: G.hasPos(x) ? x.lng : null,
    src: dataUrl(x.thumb), name: x.displayName || "", size: x.size || 0,
  })).sort((a, b) => a.ts - b.ts);
  evaluate(items, {});
  const maxTs = items.reduce((m, x) => Math.max(m, x.ts || 0), 0);
  const fresh = items.filter((x) => !x.dup);
  const done = async (importedIds, skippedIds) => {
    try { await pcall("markImported", { ids: importedIds.map(String), skipped: skippedIds.map(String), until: maxTs || 0 }); } catch (e) { console.warn("markImported:", e); }
    if (maxTs) lsSet(SINCE_KEY, String(maxTs + 1));
  };
  if (!fresh.length) {
    // alles schon übernommen → Merker weiterschieben, damit die App nicht nochmal meldet
    if (items.length) await done(items.map((x) => x.nativeId), []);
    if (!silent) ui.toast(items.length ? "Alle neuen Kamera-Fotos sind schon in der Galerie." : "Keine neuen Kamera-Fotos seit dem letzten Mal.");
    return { n: 0 };
  }
  const runImport = async (sel, progress) => {
    const jobs = [];
    const okIds = [];
    let fail = 0;
    for (let i = 0; i < sel.length; i++) {
      if (progress) progress(i, sel.length);
      try {
        const processed = await nativeProcessed(sel[i].nativeId);
        const r = await importOne(sel[i], processed, "native");
        jobs.push(r.job); okIds.push(sel[i].nativeId);
      } catch (e) { console.error(e); fail++; }
    }
    const chosen = new Set(sel.map((x) => x.nativeId));
    await done([...okIds, ...items.filter((x) => x.dup).map((x) => x.nativeId)], items.filter((x) => !chosen.has(x.nativeId) && !x.dup).map((x) => x.nativeId));
    const filed = await finishJobs(jobs, progress ? () => progress(sel.length, sel.length, "Sortiere in Alben …") : null);
    return { n: okIds.length, msg: fail ? `${nFotos(okIds.length)} übernommen, ${fail} nicht lesbar.` : summary(okIds.length, filed) };
  };
  if (silent) {
    const sel = fresh.filter((x) => x.cls.ok);
    if (!sel.length) { await done([], fresh.map((x) => x.nativeId)); return { n: 0 }; }
    ui.toast(`Übernehme ${nFotos(sel.length)} aus der Kamera …`, 2500);
    const r = await runImport(sel, null);
    ui.toast(`📷 ${r.msg}`, 4000);
    return r;
  }
  lsSet(OFFERED_KEY, String(maxTs));
  openPreview({
    title: "Neue Kamera-Fotos",
    sub: `seit ${fmtDate(since) === fmtDate(Date.now()) ? `heute ${fmtTime(since)}` : `${fmtDate(since).slice(0, 6)} ${fmtTime(since)}`}`,
    items,
    hint: st.location === false ? "Außerdem in der App erlauben: „Standort in Fotos lesen“ (Galerie → ⚙)." : "",
    run: async (sel, progress) => (await runImport(sel, progress)).msg,
  });
  return { n: fresh.length, preview: true };
}

/* ---------- App: Berechtigung ---------- */

function accessText(st) {
  if (!st || st.missing) return { ic: "⏳", t: "kommt mit dem nächsten App-Update", cls: "off" };
  if (st.access === "full") return { ic: "✓", t: "erlaubt", cls: "ok" };
  if (st.access === "partial") return { ic: "⚠", t: "nur ausgewählte Fotos", cls: "warn" };
  return { ic: "✕", t: "nicht erlaubt", cls: "off" };
}

function permissionSheet(st) {
  injectCSS();
  const partial = st && st.access === "partial";
  ui.openSheet({
    title: "Zugriff auf Kamera-Fotos",
    bodyHTML: `<div class="mi-sheet">` +
      (partial
        ? `<p>Du hast der App nur <b>ausgewählte Fotos</b> freigegeben. Neue Kamera-Fotos sieht sie so nicht automatisch.</p>` +
          `<p class="note">In den Einstellungen: <b>Berechtigungen → Fotos und Videos → „Alle erlauben“</b>.</p>`
        : `<p>Damit Baustellen-Fotos aus der normalen Kamera-App automatisch in die Galerie kommen, braucht die App Zugriff auf deine Fotos.</p>` +
          `<p class="note">Die Fotos bleiben auf dem Handy – übernommen werden nur die, die du auswählst (bzw. Arbeitsfotos, wenn „Automatisch übernehmen“ an ist).</p>`) +
      `<div class="row"><button type="button" class="btn ghost" data-mp="settings">Einstellungen öffnen</button><button type="button" class="btn primary" data-mp="ask">Zugriff erlauben</button></div>` +
    `</div>`,
    onMount(el, close) {
      el.addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-mp]");
        if (!b) return;
        if (b.dataset.mp === "settings") { try { await pcall("openSettings"); } catch (e) { ui.toast("Einstellungen konnten nicht geöffnet werden."); } close(); return; }
        ui.setBusy(b, true, "Bitte warten …");
        const r = await requestAccess();
        close();
        if (r && r.access === "full") openNativeImport({});
        else if (r && r.access === "partial") permissionSheet(r);
      });
    },
  });
}

export async function requestAccess() {
  let r = null;
  try { r = await pcall("requestPermission"); } catch (e) { ui.toast(e.code === "missing" ? "Kommt mit dem nächsten App-Update." : "Berechtigung konnte nicht angefragt werden."); return null; }
  pushConfig(true);
  if (r && r.access === "full") ui.toast("Zugriff erlaubt ✓");
  return r;
}

/* ---------- Einstellungs-Karte (Galerie ⚙) ---------- */

/** HTML der Karte „Kamera-Fotos automatisch übernehmen“ (App) bzw. „Kamera-Fotos übernehmen“ (Browser). */
export function settingsHTML() {
  injectCSS();
  const set = settings();
  const nat = isNative();
  return `<section class="mi-set" data-mi-set>` +
    `<h3 class="mi-set-h"><span aria-hidden="true">📷</span> ${nat ? "Kamera-Fotos automatisch übernehmen" : "Kamera-Fotos übernehmen"}</h3>` +
    (nat ? `<div class="mi-perm" data-mi-perm><span class="mi-perm-t">Zugriff auf Fotos wird geprüft …</span></div>` : "") +
    `<div class="fields"><label>Welche Fotos sind Arbeitsfotos?<select data-mi-s="rule">` +
      C.RULES.map((r) => `<option value="${r}"${r === set.rule ? " selected" : ""}>${esc(C.RULE_LABELS[r])}</option>`).join("") +
    `</select></label></div>` +
    `<p class="note">Zählt die Aufnahmezeit (EXIF) – liegt sie in einem Arbeits-Eintrag oder der laufenden Schicht, wird das Foto vorausgewählt. „An meinen Orten“: zusätzlich, wenn das Foto-GPS im Umkreis eines gespeicherten Orts liegt. Privatmodus und Privatfahrten zählen nie.</p>` +
    (nat ? `<label class="mi-switch"><input type="checkbox" data-mi-s="notify"${set.notify ? " checked" : ""}><span><b>Benachrichtigung bei neuen Baustellen-Fotos</b><small>„📷 3 neue Baustellen-Fotos – in die App übernehmen“ (prüft etwa alle 20 Minuten und sofort, solange die App läuft).</small></span></label>` +
      `<label class="mi-switch"><input type="checkbox" data-mi-s="auto"${set.auto ? " checked" : ""}><span><b>Automatisch übernehmen ohne Nachfrage</b><small>Beim Öffnen der App kommen Arbeitsfotos still in die Galerie. Aus: Vorschau zum Auswählen.${set.rule === "ask" ? " (Bei „Alle neuen Fotos fragen“ wird immer gefragt.)" : ""}</small></span></label>` +
      `<label class="mi-switch"><input type="checkbox" data-mi-s="allBuckets"${set.allBuckets ? " checked" : ""}><span><b>Auch andere Ordner</b><small>Nicht nur DCIM/Kamera, auch z. B. WhatsApp- oder Download-Bilder.</small></span></label>` +
      `<div class="row mi-set-acts"><button type="button" class="btn sm ghost" data-mi-s="check">📱 Jetzt nach neuen Fotos sehen</button></div>` : "") +
    xiaomiHint() +
  `</section>`;
}

/** Ereignisse der Einstellungs-Karte (speichert sofort). */
export function wireSettings(el) {
  const box = el.querySelector("[data-mi-set]");
  if (!box) return;
  const drawPerm = async () => {
    const host = box.querySelector("[data-mi-perm]");
    if (!host) return;
    const st = await nativeStatus();
    const a = accessText(st);
    const loc = st && !st.missing && st.access !== "none" ? (st.location ? `<span class="mi-pill is-ok">✓ Standort in Fotos</span>` : `<span class="mi-pill is-warn">⚠ Standort in Fotos fehlt</span>`) : "";
    const btn = st.missing ? "" : st.access === "full"
      ? (st.location === false ? `<button type="button" class="btn sm ghost" data-mi-s="ask">Standort erlauben</button>` : "")
      : st.access === "partial"
        ? `<button type="button" class="btn sm primary" data-mi-s="opensettings">Einstellungen öffnen</button>`
        : `<button type="button" class="btn sm primary" data-mi-s="ask">Zugriff erlauben</button>`;
    host.innerHTML = `<span class="mi-perm-t">Zugriff auf Fotos: <span class="mi-pill is-${a.cls}">${esc(a.ic)} ${esc(a.t)}</span> ${loc}</span>${btn}` +
      (st.access === "partial" ? `<p class="note mi-perm-n">Nur ausgewählte Fotos freigegeben – neue Kamera-Fotos sieht die App so nicht. In den Einstellungen: Berechtigungen → Fotos und Videos → „Alle erlauben“.</p>` : "");
  };
  drawPerm();
  box.addEventListener("change", async (ev) => {
    const t = ev.target.closest("[data-mi-s]");
    if (!t) return;
    const k = t.dataset.miS;
    try {
      if (k === "rule") await saveSettings({ rule: t.value });
      else if (k === "notify" || k === "auto" || k === "allBuckets") await saveSettings({ [k]: t.checked });
      ui.toast("Gespeichert.", 1500);
    } catch (e) { console.error(e); }
  });
  box.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-mi-s]");
    if (!t || t.tagName === "SELECT" || t.tagName === "INPUT") return;
    const k = t.dataset.miS;
    if (k === "ask") { const r = await requestAccess(); if (r && r.access === "partial") permissionSheet(r); drawPerm(); }
    else if (k === "opensettings") { try { await pcall("openSettings"); } catch { ui.toast("Einstellungen konnten nicht geöffnet werden."); } }
    else if (k === "check") openNativeImport({});
  });
}

/* ---------- App: Start, Rückkehr, Benachrichtigung ---------- */

let lastCfg = "";
let cfgT = 0;
/** Regel + Arbeitszeiten an die App schicken (für die Hintergrund-Benachrichtigung). */
export function pushConfig(force = false) {
  if (!P()) return;
  clearTimeout(cfgT);
  cfgT = setTimeout(async () => {
    const s = store.get();
    if (!s || !s.ready) return;
    const cfg = C.nativeConfig({ entries: s.entries || [], running: s.running, places: s.places || [], settings: s.settings || {}, now: Date.now() });
    const sig = JSON.stringify({ ...cfg, at: 0 });
    if (!force && sig === lastCfg) return;
    lastCfg = sig;
    try { await pcall("configure", cfg); } catch (e) { if (e.code !== "missing") console.warn("StempelMedia.configure:", e); }
  }, force ? 50 : 1200);
}

function goImport() {
  const h = "#alltag/galerie?import=native";
  if (location.hash === h) checkHash();
  else location.hash = h.slice(1);
}

let lastAuto = 0;
async function maybeAuto(reason) {
  const s = store.get();
  if (!s || !s.ready || document.visibilityState === "hidden") return;
  if (Date.now() - lastAuto < 30000 && reason !== "changed") return;
  lastAuto = Date.now();
  const set = settings();
  if (nativeOpen || document.querySelector(".mi-sheet-wrap")) return;
  if (set.auto && set.rule !== "ask") { await openNativeImport({ silent: true }); return; }
  // ohne „automatisch“: Vorschau nur zeigen, wenn es neue Arbeitsfotos gibt, die noch nicht angeboten wurden
  const st = await nativeStatus();
  if (st.access !== "full" && st.access !== "partial") return;
  let res;
  try { res = await pcall("listNew", { since: nativeSince(), limit: 60, allBuckets: set.allBuckets, thumbs: false }); } catch { return; }
  const list = (res && res.items) || [];
  const offered = Number(lsGet(OFFERED_KEY)) || 0;
  await importsReady();
  const items = list.map((x) => ({ fp: C.fpNative(x.id, x.dateTaken), ts: Number(x.dateTaken) || 0, lat: x.lat, lng: x.lng }));
  evaluate(items, {});
  const wanted = items.filter((x) => !x.dup && (x.cls.ok || set.rule === "ask") && x.ts > offered);
  if (wanted.length) openNativeImport({});
}

let started = false;
/** In der App beim Start aufrufen (app.js). */
export function startNative() {
  if (started || !isNative()) return;
  const p = P();
  if (!p) return;
  started = true;
  try {
    if (typeof p.addListener === "function") {
      p.addListener("importRequested", () => goImport());
      p.addListener("mediaChanged", () => { if (document.visibilityState === "visible") maybeAuto("changed"); });
    }
  } catch (e) { console.warn("StempelMedia-Listener:", e); }
  let first = true;
  store.subscribe((s) => {
    if (!s.ready) return;
    pushConfig(false);
    if (first) { first = false; onOpen(); }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") onOpen(); });
}

async function onOpen() {
  const s = store.get();
  if (!s || !s.ready) return;
  let pend = null;
  try { pend = await pcall("takePending"); } catch { pend = null; }
  if (pend && pend.open) { goImport(); return; }
  setTimeout(() => maybeAuto("open"), 1500);
}
