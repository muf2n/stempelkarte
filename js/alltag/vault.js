// Alltag › Passwort-Tresor: Logins, PINs, WLAN, Notizen, Karten – Ende-zu-Ende verschlüsselt im Gerät.
// Krypto in vault-crypto.js, reine Helfer in vault-core.js, QR in qr.js.
// Sammlungen (db.js): vault_meta/main = eingepackter Daten-Schlüssel, vault_items/{id} = {id, iv, ct}. Kein Klartext außerhalb des Speichers.
// Der Claude-Assistent und der eigene Server bekommen NIE Tresor-Daten – dieses Modul spricht mit keinem Server außer Firestore (nur Chiffretext).
import { collection, newId } from "./db.js";
import * as V from "./vault-crypto.js";
import * as C from "./vault-core.js";
import { qrSVG } from "./qr.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import * as ui from "../ui.js";
import * as store from "../store.js";
import { download } from "../export.js";
import { createDocs } from "./vault-docs.js";            // Update 9 – Dokumente
import * as F from "./vault-files.js";
import { usedBytes, fmtSize, FREE_TIER } from "./vault-docs-core.js";
import * as Sess from "./vault-session.js"; // Update 10 – 🔒 verschlüsselte 📁 Dokumente teilen sich den Schlüssel

const META_ID = "main";
const FAIL_KEY = "sk-tresor-fails";
const GEN_KEY = "sk-tresor-gen";
const HIDDEN_LOCK_MS = 60000;
const CLIP_MS = 30000;
const AUTOLOCK_CHOICES = [1, 5, 15];
const CARD_HINT = "Keine vollständigen Kartennummern/CVV speichern empfohlen.";
const FORGET_WARN = "Wenn du das Master-Passwort vergisst, sind alle Einträge verloren – niemand kann sie wiederherstellen. Schreib es auf Papier und bewahr es sicher auf.";

// Test-Haken (nur localhost): window.__tresorTest = { autoLockMs, hiddenMs, clipMs, iter }
const testHook = () => {
  try {
    const h = ["localhost", "127.0.0.1"].includes(location.hostname) && window.__tresorTest || null;
    // L12: Nur lokal in Tests darf die Mindest-Rundenzahl für schnelle Tests gesenkt werden – nie auf GitHub Pages/in der App.
    if (h && Number.isInteger(h.iter)) V._setMinIterForTests(h.iter);
    return h;
  } catch { return null; }
};
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// Firestore bestätigt Schreibvorgänge offline erst später → nicht ewig warten (Schreiben bleibt in der Warteschlange)
function settle(p, ms = 2500) {
  p.catch((e) => { console.error("Tresor speichern:", e); ui.toast("Speichern fehlgeschlagen: " + (e && e.message || e), 4000); });
  return Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
}
const fmtDate = (ms) => { if (!ms) return ""; const d = new Date(ms); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };

/* ---------- Fehlversuche (Speicher + sessionStorage) ---------- */

let memFails = { n: 0, until: 0 };
function fails() {
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem(FAIL_KEY) || "null"); } catch { /* egal */ }
  return s && Number.isFinite(s.n) && s.n > memFails.n ? { n: s.n, until: Number(s.until) || 0 } : memFails;
}
function recordFail() {
  const n = fails().n + 1;
  memFails = { n, until: Date.now() + C.failDelay(n) * 1000 };
  try { sessionStorage.setItem(FAIL_KEY, JSON.stringify(memFails)); } catch { /* egal */ }
  return memFails;
}
function resetFails() {
  memFails = { n: 0, until: 0 };
  try { sessionStorage.removeItem(FAIL_KEY); } catch { /* egal */ }
}
const waitLeft = () => Math.max(0, Math.ceil((fails().until - Date.now()) / 1000));

/* ---------- Zwischenablage (überlebt das Verlassen des Moduls) ---------- */

let clip = null;          // { text, timer }
let pendingClear = null;  // Text, der noch gelöscht werden muss (Seite war nicht im Fokus)

async function writeClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

async function copySecret(text, label = "Passwort") {
  if (!text) return;
  if (!(await writeClipboard(text))) { ui.toast("Kopieren nicht möglich – bitte manuell markieren.", 3500); return; }
  if (clip) clearTimeout(clip.timer);
  const ms = (testHook() && testHook().clipMs) || CLIP_MS;
  clip = { text, timer: setTimeout(() => clearClipboard(), ms) };
  pendingClear = null;
  ui.toast(`${label} kopiert – wird in ${Math.round(ms / 1000)} s aus der Zwischenablage gelöscht`, 3000);
}

/** Zwischenablage leeren, aber nur, wenn (soweit lesbar) noch unser Text drin ist. */
async function clearClipboard() {
  const c = clip || (pendingClear ? { text: pendingClear } : null);
  if (!c) return;
  if (clip) clearTimeout(clip.timer);
  clip = null;
  pendingClear = null;
  let same = true;
  try {
    const p = navigator.permissions && await navigator.permissions.query({ name: "clipboard-read" });
    if (p && p.state === "granted") same = (await navigator.clipboard.readText()) === c.text;
  } catch { /* Lesen nicht erlaubt → trotzdem leeren (best effort) */ }
  if (!same) return;
  try { await navigator.clipboard.writeText(""); }
  catch { pendingClear = c.text; } // z. B. Seite im Hintergrund → beim nächsten Fokus
}
if (typeof window !== "undefined") {
  const retry = () => { if (pendingClear && document.visibilityState === "visible") clearClipboard(); };
  window.addEventListener("focus", retry);
  document.addEventListener("visibilitychange", retry);
}

/* ---------- Modul ---------- */

export function mount(el, ctx) {
  testHook(); // Test-Haken früh anwenden (nur localhost)
  const colMeta = collection("vault_meta");
  const colItems = collection("vault_items");
  const S = {
    key: null,            // nicht exportierbarer CryptoKey (DEK) – nur im Speicher
    meta: null,
    cache: new Map(),     // id → { id, ct, data, created, updated } – entschlüsselt, nur im Speicher
    ready: false,
    broken: 0,
    q: "",
    filter: "all",
    lockReason: "",
    lastAct: Date.now(),
    hiddenAt: 0,
    screen: "",
  };
  const sheets = new Set();
  let alive = true;
  let syncToken = 0;
  let idleTimer = null;
  let hiddenTimer = null;
  let countdown = null;
  let ident = identOf(store.get());

  el.innerHTML = `<div class="tr"></div>`;
  const root = el.querySelector(".tr");
  // Update 9 – Dokumente: eigenes Modul, bekommt nur Zugriff über diese Schnittstelle
  const docs = createDocs({
    getKey: () => S.key,
    getEntry: (id) => S.cache.get(id) || null,
    entries: () => entries(),
    saveEntry: (id, data, prev) => saveEntry(id, data, prev),
    removeEntry: async (id) => { S.cache.delete(id); renderBody(); await settle(colItems.remove(id), 800); },
    sheet: (opts) => sheet(opts),
    track: (o) => sheets.add(o),
    untrack: (o) => sheets.delete(o),
    settle, renderBody: () => renderBody(), copySecret, showErr: (e, m) => showErr(e, m), newId,
  });

  /* ---------- Sperren ---------- */

  function lock(reason = "") {
    const was = !!S.key;
    S.key = null;
    S.cache = new Map();
    S.ready = false;
    S.q = "";
    S.filter = "all";
    syncToken++;
    stopIdle();
    for (const s of [...sheets]) { try { s.close(); } catch { /* egal */ } }
    sheets.clear();
    docs.reset(); // entschlüsselte Vorschaubilder/Dateien (Object-URLs) verwerfen
    if (was) clearClipboard();
    S.lockReason = reason;
    if (alive) render();
  }

  function startIdle() {
    stopIdle();
    S.lastAct = Date.now();
    idleTimer = setInterval(() => {
      const t = testHook();
      const ms = (t && t.autoLockMs) || autoLockMin() * 60000;
      if (S.key && Date.now() - S.lastAct >= ms) lock(`Automatisch gesperrt (${t && t.autoLockMs ? "Test" : autoLockMin() + " Min. ohne Aktivität"}).`);
    }, 250);
  }
  function stopIdle() { clearInterval(idleTimer); idleTimer = null; }
  const bump = () => { S.lastAct = Date.now(); };
  const ACT = ["pointerdown", "keydown", "input", "wheel", "touchstart"];
  ACT.forEach((t) => document.addEventListener(t, bump, { capture: true, passive: true }));

  const hiddenMs = () => (testHook() && testHook().hiddenMs) || HIDDEN_LOCK_MS;
  function onVis() {
    if (document.visibilityState === "hidden") {
      S.hiddenAt = Date.now();
      clearTimeout(hiddenTimer);
      if (S.key) hiddenTimer = setTimeout(() => { if (document.visibilityState === "hidden" && S.key) lock("Gesperrt, weil die App im Hintergrund war."); }, hiddenMs());
    } else {
      clearTimeout(hiddenTimer);
      // Timer können im Hintergrund gedrosselt sein → hier nochmal prüfen
      if (S.key && S.hiddenAt && Date.now() - S.hiddenAt >= hiddenMs()) lock("Gesperrt, weil die App im Hintergrund war.");
      S.hiddenAt = 0;
      bump();
    }
  }
  document.addEventListener("visibilitychange", onVis);

  function autoLockMin() {
    const m = Number(store.get().settings && store.get().settings.vault && store.get().settings.vault.autoLockMin);
    return AUTOLOCK_CHOICES.includes(m) ? m : 5;
  }

  /* ---------- Daten ---------- */

  async function syncCache() {
    const key = S.key;
    if (!key) return;
    const tok = ++syncToken;
    const next = new Map();
    let broken = 0;
    for (const r of colItems.all()) {
      const c = S.cache.get(r.id);
      if (c && c.ct === r.ct) { next.set(r.id, { ...c, created: r.created, updated: r.updated }); continue; }
      try {
        const data = C.normEntry(await V.decryptItem(key, r));
        next.set(r.id, { id: r.id, ct: r.ct, data, created: r.created, updated: r.updated });
      } catch { broken++; }
      if (tok !== syncToken || S.key !== key || !alive) return;
    }
    S.cache = next;
    S.broken = broken;
    S.ready = true;
    renderBody();
  }

  async function saveEntry(id, data, prev) {
    const key = S.key;
    if (!key) throw new Error("Tresor ist gesperrt.");
    const clean = C.normEntry(data);
    const oldSecret = prev ? C.secretOf(prev.data) : "";
    if (C.secretOf(clean) && C.secretOf(clean) !== oldSecret) clean.pwChanged = Date.now();
    else if (prev && prev.data.pwChanged) clean.pwChanged = prev.data.pwChanged;
    const rec = await V.encryptItem(key, id, clean);
    const created = prev && prev.created || Date.now();
    S.cache.set(id, { id, ct: rec.ct, data: clean, created, updated: Date.now() });
    return colItems.put({ ...rec, created });
  }

  const entries = () => [...S.cache.values()];

  /* ---------- Sheets (werden beim Sperren geschlossen) ---------- */

  function sheet(opts) {
    const s = ui.openSheet(opts);
    s.el.classList.add("tr-sheet");
    sheets.add(s);
    const obs = new MutationObserver(() => { if (!document.contains(s.el)) { sheets.delete(s); obs.disconnect(); } });
    obs.observe(s.el.parentNode || document.body, { childList: true });
    return s;
  }

  /* ---------- Rendern ---------- */

  function render() {
    if (!alive) return;
    clearInterval(countdown);
    countdown = null;
    let screen;
    if (!colMeta.loaded) screen = "loading";
    else if (!S.meta) screen = "setup";
    else if (!S.key) screen = "locked";
    else screen = "open";
    // gleiche Ansicht (Sperr-/Einrichtungsbildschirm) nicht neu zeichnen, damit Eingaben erhalten bleiben
    if (screen === S.screen && (screen === "setup" || screen === "locked")) { if (screen === "locked") startCountdown(); return; }
    S.screen = screen;
    if (screen === "loading") root.innerHTML = `<div class="al-loading">Lade Tresor …</div>`;
    else if (screen === "setup") renderSetup();
    else if (screen === "locked") renderLocked();
    else renderOpen();
  }

  function pwField(id, label, { auto = "off", value = "", extra = "", gen = false } = {}) {
    return `<label class="tr-f">${esc(label)}<span class="tr-pw">` +
      `<input id="${id}" type="password" autocomplete="${auto}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(value)}"${extra}>` +
      (gen ? `<button type="button" class="tr-ib" data-gen="${id}" aria-label="Passwort erzeugen" title="Passwort erzeugen">${icon("dice", 20)}</button>` : "") +
      `<button type="button" class="tr-ib" data-eye="${id}" aria-label="Passwort anzeigen" aria-pressed="false">${icon("eye", 20)}</button>` +
    `</span></label>`;
  }

  function meterHTML(id) {
    return `<div class="tr-meter" id="${id}" data-score="-1"><div class="tr-meter-bar"><i></i><i></i><i></i><i></i><i></i></div><small></small></div>`;
  }
  function updateMeter(box, pw) {
    if (!box) return;
    const st = C.strength(pw);
    box.dataset.score = pw ? String(st.score) : "-1";
    box.querySelector("small").textContent = pw ? `${st.label} · ca. ${st.bits} Bit` : "";
  }

  // Augen-/Generator-Knöpfe in einem Container verdrahten
  function wireFields(scope) {
    scope.querySelectorAll("[data-eye]").forEach((b) => b.addEventListener("click", () => {
      const inp = scope.querySelector("#" + b.dataset.eye);
      if (!inp) return;
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      b.setAttribute("aria-pressed", String(show));
      b.setAttribute("aria-label", show ? "Passwort verbergen" : "Passwort anzeigen");
      b.innerHTML = icon(show ? "eye-off" : "eye", 20);
    }));
    scope.querySelectorAll("[data-gen]").forEach((b) => b.addEventListener("click", () => {
      const inp = scope.querySelector("#" + b.dataset.gen);
      openGenerator((pw) => { inp.value = pw; inp.dispatchEvent(new Event("input", { bubbles: true })); });
    }));
  }

  /* ---------- Einrichten ---------- */

  function renderSetup() {
    root.innerHTML =
      `<section class="card tr-hero">` +
        `<span class="tr-hero-ic">${icon("shield", 34)}</span>` +
        `<div><h3>Dein Passwort-Tresor</h3>` +
        `<p>Passwörter, PINs, WLAN-Zugänge und geheime Notizen – verschlüsselt mit deinem Master-Passwort (AES-256, direkt am Gerät). Der Server sieht nur Zeichensalat.</p></div>` +
      `</section>` +
      `<form class="card tr-setup fields" novalidate>` +
        `<h3 class="tr-h">Master-Passwort festlegen</h3>` +
        `<div class="tr-warn" role="note">${icon("lock", 22)}<p><b>Wichtig:</b> ${esc(FORGET_WARN)}</p></div>` +
        pwField("tr-new", "Master-Passwort (mind. 10 Zeichen)", { auto: "new-password" }) +
        meterHTML("tr-new-m") +
        pwField("tr-new2", "Master-Passwort wiederholen", { auto: "new-password" }) +
        `<p class="note">Tipp: 4–5 zufällige Wörter mit Zahl, z. B. „Kaktus Laterne Wolke Brezel 7“ – leicht zu merken, schwer zu erraten.</p>` +
        `<label class="tr-check"><input type="checkbox" id="tr-paper"><span>Ich habe mein Master-Passwort auf Papier notiert.</span></label>` +
        `<p class="tr-err" role="alert" hidden></p>` +
        `<button type="submit" class="btn primary" data-tr="create">${icon("lock", 20)} Tresor anlegen</button>` +
      `</form>` +
      `<div class="tr-restore"><span class="note">Schon eine Sicherung?</span><button type="button" class="chip" data-tr="import">${icon("upload", 16)} Sicherung wiederherstellen</button></div>`;
    const f = root.querySelector("form");
    wireFields(f);
    const pw = f.querySelector("#tr-new"), pw2 = f.querySelector("#tr-new2"), err = f.querySelector(".tr-err");
    pw.addEventListener("input", () => updateMeter(f.querySelector("#tr-new-m"), pw.value));
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const prob = C.masterProblem(pw.value, pw2.value) || (f.querySelector("#tr-paper").checked ? "" : "Bitte bestätige, dass du dein Master-Passwort notiert hast.");
      if (prob) { err.textContent = prob; err.hidden = false; return; }
      err.hidden = true;
      const btn = f.querySelector("[data-tr=create]");
      ui.setBusy(btn, true, "Wird angelegt …");
      try {
        if (colMeta.get(META_ID)) throw new Error("Es gibt schon einen Tresor.");
        const { meta, key } = await V.createVault(pw.value, { iter: (testHook() && testHook().iter) || V.ITER });
        // Reste ohne Schlüssel (z. B. abgebrochener Import) wären nie mehr lesbar
        for (const r of colItems.all()) await settle(colItems.remove(r.id), 800);
        await settle(F.wipeAll().catch((e) => console.warn("Tresor-Dateien löschen:", e)), 3000);
        await putMeta(meta);
        pw.value = pw2.value = "";
        S.key = key;
        Sess.adopt(key, S.meta);
        resetFails();
        unlocked();
        ui.toast("Tresor angelegt 🔒");
        let back = false; try { back = sessionStorage.getItem("sk-dk-return") === "1"; sessionStorage.removeItem("sk-dk-return"); } catch { /* egal */ }
        if (back) { ui.toast("Tresor angelegt 🔒 – jetzt sind deine Dokumente verschlüsselt 📁", 3500); location.hash = "#alltag/dokumente"; }
      } catch (e) {
        console.warn("Tresor anlegen:", e);
        err.textContent = "Anlegen fehlgeschlagen: " + (e && e.message || e);
        err.hidden = false;
      } finally { ui.setBusy(btn, false); }
    });
    root.querySelector("[data-tr=import]").addEventListener("click", pickBackup);
  }

  function putMeta(meta) {
    const m = { id: META_ID, ...V.pickMeta(meta) };
    S.meta = { ...m, updated: Date.now() };
    return settle(colMeta.put(m));
  }

  /* ---------- Gesperrt ---------- */

  function renderLocked() {
    root.innerHTML =
      `<form class="card tr-lock" novalidate>` +
        `<span class="tr-lock-ic">${icon("lock", 34)}</span>` +
        `<h3>Tresor gesperrt</h3>` +
        (S.lockReason ? `<p class="note tr-reason">${esc(S.lockReason)}</p>` : `<p class="note">Gib dein Master-Passwort ein, um deine Einträge zu sehen.</p>`) +
        `<div class="fields">` + pwField("tr-master", "Master-Passwort", { extra: ' enterkeyhint="go"' }) + `</div>` +
        `<p class="tr-err" role="alert" hidden></p>` +
        `<button type="submit" class="btn primary" data-tr="unlock">${icon("unlock", 20)} Entsperren</button>` +
        // TODO native biometrics: „Mit Fingerabdruck entsperren“ – DEK im Android-Keystore (BiometricPrompt) ablegen, erst mit der nativen App.
        `<button type="button" class="tr-link" data-tr="forgot">Master-Passwort vergessen?</button>` +
      `</form>`;
    const f = root.querySelector("form");
    wireFields(f);
    const inp = f.querySelector("#tr-master"), err = f.querySelector(".tr-err"), btn = f.querySelector("[data-tr=unlock]");
    setTimeout(() => { try { if (alive && !document.querySelector(".sheet")) inp.focus({ preventScroll: true }); } catch { /* egal */ } }, 50);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (waitLeft() > 0 || btn.disabled) return;
      if (!inp.value) { showErr(err, "Bitte Master-Passwort eingeben."); return; }
      ui.setBusy(btn, true, "Entsperre …");
      let ok = false;
      try {
        const meta = S.meta;
        const key = await V.unlockVault(inp.value, meta);
        if (!alive || S.meta !== meta) return;
        inp.value = "";
        S.key = key;
        Sess.adopt(key, meta);
        ok = true;
        resetFails();
        S.lockReason = "";
        unlocked();
      } catch (e) {
        if (e && e.code === "wrong-password") {
          const fl = recordFail();
          inp.value = "";
          showErr(err, "Falsches Passwort." + (fl.n >= 3 ? ` (${fl.n} Fehlversuche)` : ""));
          inp.focus();
        } else {
          console.warn("Entsperren:", e);
          showErr(err, e && e.message || "Entsperren fehlgeschlagen.");
        }
      } finally {
        if (!ok && alive) { ui.setBusy(btn, false); startCountdown(); }
      }
    });
    f.querySelector("[data-tr=forgot]").addEventListener("click", openForgot);
    startCountdown();
  }

  function startCountdown() {
    clearInterval(countdown);
    const btn = root.querySelector("[data-tr=unlock]");
    if (!btn) return;
    const tick = () => {
      const left = waitLeft();
      const w = root.querySelector(".tr-wait");
      if (left > 0) {
        btn.disabled = true;
        btn.textContent = `Bitte ${left} s warten`;
        if (!w) btn.insertAdjacentHTML("beforebegin", `<p class="tr-wait note" role="status">Zu viele Fehlversuche – zum Schutz wird nach jedem weiteren Fehlversuch länger gewartet.</p>`);
      } else {
        clearInterval(countdown);
        countdown = null;
        if (btn.disabled && !btn.hasAttribute("aria-busy")) { btn.disabled = false; btn.innerHTML = `${icon("unlock", 20)} Entsperren`; }
        if (w) w.remove();
      }
    };
    tick();
    if (waitLeft() > 0) countdown = setInterval(tick, 500);
  }

  function showErr(errEl, msg) { errEl.textContent = msg; errEl.hidden = false; }

  function unlocked() {
    S.ready = false;
    S.cache = new Map();
    startIdle();
    render();
    syncCache();
  }

  function openForgot() {
    const s = sheet({
      title: "Master-Passwort vergessen?",
      bodyHTML:
        `<div class="tr-warn danger">${icon("lock", 22)}<p>Das Master-Passwort kann <b>niemand</b> wiederherstellen – auch nicht der Entwickler. Ohne es sind die Einträge nicht lesbar.</p></div>` +
        `<p>Probier ruhig weiter (Groß-/Kleinschreibung, Tastatur-Sprache). Wenn du eine Sicherungsdatei mit einem anderen Passwort hast, kannst du den Tresor löschen und die Sicherung danach wiederherstellen.</p>` +
        `<p class="note">Löschen entfernt alle ${colItems.all().length} verschlüsselten Einträge und Dokument-Dateien endgültig. Auch deine verschlüsselten 📁 Dokumente sind danach nicht mehr lesbar. Erinnerungen im Planer bleiben stehen.</p>` +
        `<div class="row"><button type="button" class="btn danger" data-del>Tresor endgültig löschen</button></div>`,
    });
    ui.confirmButton(s.el.querySelector("[data-del]"), "Wirklich alles löschen?", async () => {
      try {
        for (const r of colItems.all()) await settle(colItems.remove(r.id), 800);
        await settle(F.wipeAll().catch((e) => console.warn("Tresor-Dateien löschen:", e)), 3000);
        await settle(colMeta.remove(META_ID));
        resetFails();
        s.close();
        ui.toast("Tresor gelöscht");
      } catch (e) { ui.toast("Löschen fehlgeschlagen: " + (e && e.message || e), 4000); }
    });
  }

  /* ---------- Offen ---------- */

  function renderOpen() {
    root.innerHTML =
      `<div class="tr-top">` +
        `<div class="mn-search tr-search"><span class="mn-search-ic">${icon("search", 18)}</span>` +
          `<input id="tr-q" type="search" placeholder="Suchen …" aria-label="Im Tresor suchen" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" value="${esc(S.q)}"></div>` +
        `<button type="button" class="btn sm tr-lockbtn" data-tr="lock">${icon("lock", 18)}<span>Sperren</span></button>` +
        `<button type="button" class="tr-ib tr-gear" data-tr="settings" aria-label="Tresor-Einstellungen">${icon("gear", 20)}</button>` +
      `</div>` +
      `<div class="tr-grid"><aside class="tr-side"></aside><section class="tr-main" aria-live="polite"></section></div>` +
      `<button type="button" class="tr-fab" data-tr="new" aria-label="Eintrag hinzufügen">${icon("plus", 26)}</button>`;
    root.querySelector("#tr-q").addEventListener("input", (e) => { S.q = e.target.value; renderList(); });
    root.querySelector("[data-tr=lock]").addEventListener("click", () => { lock("Manuell gesperrt."); Sess.lock("Manuell gesperrt."); });
    root.querySelector("[data-tr=settings]").addEventListener("click", openSettings);
    root.querySelector("[data-tr=new]").addEventListener("click", () => openEdit(null));
    root.querySelector(".tr-main").addEventListener("click", onListClick);
    root.querySelector(".tr-side").addEventListener("click", onListClick);
    renderBody();
  }

  function renderBody() {
    if (!alive || S.screen !== "open" || !root.querySelector(".tr-main")) return;
    renderSide();
    renderList();
  }

  function renderSide() {
    const side = root.querySelector(".tr-side");
    if (!S.ready) { side.innerHTML = ""; return; }
    const chk = C.securityCheck(entries());
    const all = entries().length;
    const good = chk.checked > 0 && !chk.weak.length && !chk.reused.length;
    side.innerHTML =
      `<section class="card tr-check-card${good ? " ok" : chk.weak.length || chk.reused.length ? " warn" : ""}">` +
        `<h3 class="tr-h">${icon("shield", 20)} Sicherheits-Check</h3>` +
        (chk.checked
          ? `<div class="tr-kpis">` +
              `<button type="button" class="tr-kpi${chk.weak.length ? " bad" : ""}" data-tr="filter" data-f="weak"${chk.weak.length ? "" : " disabled"}><b>${chk.weak.length}</b><small>schwach</small></button>` +
              `<button type="button" class="tr-kpi${chk.reused.length ? " bad" : ""}" data-tr="filter" data-f="reused"${chk.reused.length ? "" : " disabled"}><b>${chk.reused.length}</b><small>mehrfach verwendet</small></button>` +
            `</div>` +
            `<p class="note">${good ? "✅ Alle " + chk.checked + " Passwörter sind stark und einzigartig." : chk.checked + " Passwörter geprüft (Logins & WLAN)."}</p>`
          : `<p class="note">Sobald du Logins oder WLAN-Passwörter einträgst, wird hier geprüft, ob sie schwach oder mehrfach verwendet sind.</p>`) +
      `</section>` +
      `<section class="card tr-mini">` +
        `<button type="button" class="tr-row" data-tr="generator">${icon("dice", 20)}<span><b>Passwort-Generator</b><small>Starke Passwörter erzeugen</small></span>${icon("chevron-right", 18)}</button>` +
        `<button type="button" class="tr-row" data-tr="settings">${icon("gear", 20)}<span><b>Einstellungen &amp; Sicherung</b><small>Auto-Sperre ${autoLockMin()} Min. · ${all} ${all === 1 ? "Eintrag" : "Einträge"}</small></span>${icon("chevron-right", 18)}</button>` +
      `</section>`;
  }

  function filtered() {
    const chk = C.securityCheck(entries());
    const weak = new Set(chk.weak), reused = new Set(chk.reused);
    const f = S.filter;
    let list = entries().filter((e) => C.matches(e.data, S.q));
    if (f === "fav") list = list.filter((e) => e.data.fav);
    else if (f === "weak") list = list.filter((e) => weak.has(e.id));
    else if (f === "reused") list = list.filter((e) => reused.has(e.id));
    else if (f.startsWith("t:")) list = list.filter((e) => e.data.type === f.slice(2));
    else if (f.startsWith("c:")) list = list.filter((e) => e.data.category === f.slice(2));
    return { list: C.sortEntries(list), weak, reused };
  }

  function renderList() {
    const main = root.querySelector(".tr-main");
    if (!main) return;
    if (!S.ready) { main.innerHTML = `<div class="al-loading">Entschlüssele …</div>`; return; }
    const all = entries();
    if (!all.length) {
      main.innerHTML = (S.broken ? brokenNote() : "") +
        `<div class="empty tr-empty">${icon("lock", 34)}<h3>🔐 Noch keine Einträge</h3><p>Leg Logins, PINs (z. B. SIM-Karte), WLAN-Zugänge, geheime Notizen oder Dokumente (Reisepass, Ausweise) an.</p>` +
        `<div class="row tr-empty-row"><button type="button" class="btn primary sm" data-tr="new">+ Hinzufügen</button><button type="button" class="btn ghost sm" data-tr="newdoc">🛂 Dokument</button></div></div>`;
      return;
    }
    const { list, weak, reused } = filtered();
    const cats = [...new Set(all.map((e) => e.data.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
    const count = (fn) => all.filter(fn).length;
    const chip = (f, label, n) => `<button type="button" class="chip" data-tr="filter" data-f="${esc(f)}" aria-pressed="${S.filter === f}">${label}${n != null ? ` <em>${n}</em>` : ""}</button>`;
    const chips = [chip("all", "Alle", all.length)];
    const favN = count((e) => e.data.fav);
    if (favN) chips.push(chip("fav", `${icon("star", 15)} Favoriten`, favN));
    chips.push(chip("t:doc", "🛂 Dokumente", count((e) => e.data.type === "doc"))); // Update 9 – immer sichtbar
    for (const t of C.TYPE_IDS) { if (t === "doc") continue; const n = count((e) => e.data.type === t); if (n) chips.push(chip("t:" + t, esc(C.TYPES[t].label), n)); }
    for (const c of cats) chips.push(chip("c:" + c, "# " + esc(c), count((e) => e.data.category === c)));
    if (S.filter === "weak") chips.push(chip("weak", "⚠️ Schwach", weak.size));
    if (S.filter === "reused") chips.push(chip("reused", "⚠️ Mehrfach", reused.size));
    if (S.filter === "t:doc") {
      main.innerHTML = (S.broken ? brokenNote() : "") +
        `<div class="chips tr-chips" role="toolbar" aria-label="Filter">${chips.join("")}</div>` +
        (list.length || !S.q ? docs.cardsHTML(list) : `<div class="empty tr-empty"><h3>Nichts gefunden</h3><p>Probier ein anderes Suchwort.</p></div>`);
      docs.hydrate(main);
      return;
    }
    main.innerHTML =
      (S.broken ? brokenNote() : "") +
      `<div class="chips tr-chips" role="toolbar" aria-label="Filter">${chips.join("")}</div>` +
      (list.length
        ? `<ul class="tr-list">${list.map((e) => itemRow(e, weak.has(e.id), reused.has(e.id))).join("")}</ul>`
        : `<div class="empty tr-empty"><h3>Nichts gefunden</h3><p>Probier ein anderes Suchwort oder einen anderen Filter.</p></div>`);
  }

  const brokenNote = () => `<p class="hint tr-broken">⚠️ ${S.broken} ${S.broken === 1 ? "Eintrag kann" : "Einträge können"} nicht entschlüsselt werden (beschädigt oder aus einem anderen Tresor).</p>`;

  function bubble(type, size = 20, d = null) {
    if (type === "doc" && d) return docs.bubble(d);
    const t = C.TYPES[type] || C.TYPES.login;
    return `<span class="tr-bub" style="--c:${t.color}" aria-hidden="true">${icon(t.icon, size)}</span>`;
  }

  function quickSecret(d) {
    if (d.type === "login" || d.type === "wifi") return d.password ? ["password", "Passwort"] : null;
    if (d.type === "pin") return d.pin ? ["pin", "PIN"] : null;
    if (d.type === "card" || d.type === "doc") return d.number ? ["number", "Nummer"] : null;
    return null;
  }

  function itemRow(e, isWeak, isReused) {
    const d = e.data;
    const sub = [C.subtitle(d), d.category].filter(Boolean).join(" · ");
    const q = quickSecret(d);
    const flags = (isWeak ? `<span class="tr-flag" title="Schwaches Passwort">schwach</span>` : "") + (isReused ? `<span class="tr-flag" title="Mehrfach verwendet">mehrfach</span>` : "") +
      (d.type === "doc" ? docs.badge(d) : "");
    return `<li class="tr-item">` +
      `<button type="button" class="tr-item-main" data-tr="open" data-id="${esc(e.id)}">` +
        bubble(d.type, 20, d) +
        `<span class="tr-item-t"><b>${esc(d.title)}${d.fav ? ` <span class="tr-star" aria-label="Favorit">${icon("star", 14)}</span>` : ""}</b>` +
        `<small>${esc(sub || C.TYPES[d.type].label)}</small></span>${flags}` +
      `</button>` +
      (q ? `<button type="button" class="tr-ib tr-quick" data-tr="copy" data-id="${esc(e.id)}" data-field="${q[0]}" aria-label="${esc(q[1])} von ${esc(d.title)} kopieren" title="${esc(q[1])} kopieren">${icon("copy", 20)}</button>` : "") +
    `</li>`;
  }

  function onListClick(ev) {
    const b = ev.target.closest("[data-tr]");
    if (!b || b.disabled) return;
    const a = b.dataset.tr;
    if (a === "filter") { S.filter = S.filter === b.dataset.f && b.dataset.f !== "all" ? "all" : b.dataset.f; renderList(); return; }
    if (a === "open") { const e = S.cache.get(b.dataset.id); if (e) openDetail(e.id); return; }
    if (a === "copy") { const e = S.cache.get(b.dataset.id); if (e) copySecret(e.data[b.dataset.field], b.dataset.field === "pin" ? "PIN" : b.dataset.field === "number" ? "Nummer" : "Passwort"); return; }
    if (a === "new") { openEdit(null); return; }
    if (a === "newdoc") { docs.openEditor(null); return; }
    if (a === "generator") { openGenerator(null); return; }
    if (a === "settings") { openSettings(); return; }
  }

  /* ---------- Eintrag ansehen ---------- */

  const FIELDS = {
    login: [["user", "Benutzername/E-Mail"], ["password", "Passwort", true], ["url", "Website"]],
    pin: [["pin", "PIN/Code", true], ["puk", "PUK", true]],
    wifi: [["ssid", "SSID (Netzwerkname)"], ["password", "Passwort", true], ["enc", "Verschlüsselung"]],
    note: [],
    card: [["holder", "Name"], ["number", "Nummer", true]],
    doc: [],
  };

  function openDetail(id) {
    const e = S.cache.get(id);
    if (!e) return;
    if (e.data.type === "doc") { docs.openDetail(id); return; }
    const d = e.data;
    const chk = C.securityCheck(entries());
    const warn = [];
    if (chk.weak.includes(id)) warn.push("Schwaches Passwort – besser eines aus dem Generator verwenden.");
    if (chk.reused.includes(id)) warn.push("Dieses Passwort wird auch bei anderen Einträgen verwendet.");
    const rows = FIELDS[d.type].filter(([k]) => d[k]).map(([k, label, secret]) => {
      let val;
      if (secret) val = `<span class="tr-secret" data-k="${k}">••••••••</span>`;
      else if (k === "url") { const u = C.safeUrl(d.url); val = u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(d.url)}</a>` : esc(d.url); }
      else if (k === "enc") val = esc(C.WIFI_ENC[d.enc] || d.enc) + (d.hidden ? " · verstecktes Netz" : "");
      else val = `<span class="tr-val">${esc(d[k])}</span>`;
      return `<div class="tr-field"><div><small>${esc(label)}</small><div class="tr-v">${val}</div></div>` +
        `<div class="tr-acts">` +
          (secret ? `<button type="button" class="tr-ib" data-reveal="${k}" aria-label="${esc(label)} anzeigen" aria-pressed="false">${icon("eye", 20)}</button>` : "") +
          (k !== "enc" ? `<button type="button" class="tr-ib" data-copy="${k}" aria-label="${esc(label)} kopieren">${icon("copy", 20)}</button>` : "") +
        `</div></div>`;
    }).join("");
    const body =
      `<div class="tr-dhead">${bubble(d.type, 22)}<div><b>${esc(C.TYPES[d.type].label)}</b><small>${esc([d.category, "geändert " + fmtDate(e.updated)].filter(Boolean).join(" · "))}</small></div>` +
        `<button type="button" class="tr-ib tr-fav" data-fav aria-pressed="${d.fav}" aria-label="${d.fav ? "Kein Favorit mehr" : "Als Favorit markieren"}">${icon("star", 22)}</button></div>` +
      warn.map((w) => `<p class="hint tr-hintwarn">⚠️ ${esc(w)}</p>`).join("") +
      (d.type === "card" ? `<p class="hint tr-hintwarn">ℹ️ ${esc(CARD_HINT)}</p>` : "") +
      (rows ? `<div class="tr-fields">${rows}</div>` : "") +
      (d.note ? `<div class="tr-field tr-notefield"><div><small>Notiz</small><div class="tr-note">${esc(d.note)}</div></div><div class="tr-acts"><button type="button" class="tr-ib" data-copy="note" aria-label="Notiz kopieren">${icon("copy", 20)}</button></div></div>` : "") +
      (d.type === "wifi" && d.ssid ? `<div class="tr-qr-wrap"><button type="button" class="btn ghost sm" data-qr>${icon("qr", 18)} QR-Code zum Teilen</button><div class="tr-qr" hidden></div></div>` : "") +
      `<div class="row tr-drow"><button type="button" class="btn danger sm" data-del>Löschen</button><button type="button" class="btn primary sm" data-edit>${icon("pencil", 18)} Bearbeiten</button></div>`;
    const s = sheet({ title: d.title, bodyHTML: body });
    const box = s.el;
    box.querySelectorAll("[data-reveal]").forEach((b) => b.addEventListener("click", () => {
      const span = box.querySelector(`.tr-secret[data-k="${b.dataset.reveal}"]`);
      const show = b.getAttribute("aria-pressed") !== "true";
      span.textContent = show ? d[b.dataset.reveal] : "••••••••";
      span.classList.toggle("shown", show);
      b.setAttribute("aria-pressed", String(show));
      b.innerHTML = icon(show ? "eye-off" : "eye", 20);
    }));
    box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.copy;
      const label = (FIELDS[d.type].find((f) => f[0] === k) || [k, "Notiz"])[1];
      copySecret(d[k], label);
    }));
    box.querySelector("[data-fav]").addEventListener("click", async (ev) => {
      const b = ev.currentTarget;
      const cur = S.cache.get(id);
      if (!cur) return;
      const fav = !cur.data.fav;
      b.setAttribute("aria-pressed", String(fav));
      try { await settle(saveEntry(id, { ...cur.data, fav }, cur), 300); } catch { /* Meldung kommt aus settle */ }
      renderBody();
    });
    const qrBtn = box.querySelector("[data-qr]");
    if (qrBtn) qrBtn.addEventListener("click", () => {
      const q = box.querySelector(".tr-qr");
      if (!q.hidden) { q.hidden = true; q.innerHTML = ""; qrBtn.innerHTML = `${icon("qr", 18)} QR-Code zum Teilen`; return; }
      try {
        q.innerHTML = qrSVG(C.wifiQrText(d), { label: "WLAN-QR-Code für " + d.ssid }) + `<p class="note">Mit der Handy-Kamera scannen, um sich mit „${esc(d.ssid)}“ zu verbinden. Enthält das WLAN-Passwort.</p>`;
        q.hidden = false;
        qrBtn.textContent = "QR-Code ausblenden";
      } catch (err) { ui.toast(err.message, 3500); }
    });
    box.querySelector("[data-edit]").addEventListener("click", () => { s.close(); openEdit(id); });
    ui.confirmButton(box.querySelector("[data-del]"), "Wirklich löschen?", async () => {
      s.close();
      S.cache.delete(id);
      renderBody();
      await settle(colItems.remove(id), 800);
      ui.toast("Eintrag gelöscht");
    });
  }

  /* ---------- Eintrag bearbeiten ---------- */

  function formFields(type, d) {
    const v = (k) => esc(d[k] || "");
    const txt = (id, label, k, extra = "") => `<label class="tr-f">${label}<input id="${id}" type="text" value="${v(k)}" autocomplete="off" autocapitalize="off" spellcheck="false"${extra}></label>`;
    const title = `<label class="tr-f">Titel<input id="tf-title" type="text" maxlength="120" value="${v("title")}" placeholder="${esc({ login: "z. B. Instagram", pin: "z. B. SIM-Karte A1", wifi: "z. B. WLAN zu Hause", note: "z. B. Fahrradschloss", card: "z. B. e-card, Bankomatkarte" }[type])}" autocomplete="off"></label>`;
    const note = `<label class="tr-f">Notiz<textarea id="tf-note" rows="${type === "note" ? 8 : 3}" spellcheck="false">${v("note")}</textarea></label>`;
    let mid = "";
    if (type === "login") mid = txt("tf-user", "Benutzername/E-Mail", "user", ' inputmode="email"') + pwField("tf-password", "Passwort", { auto: "new-password", value: d.password || "", gen: true }) + meterHTML("tf-meter") + txt("tf-url", "Website", "url", ' inputmode="url" placeholder="z. B. instagram.com"');
    if (type === "pin") mid = `<p class="note">Für SIM-Karte (PIN/PUK), Türcode, Fahrradschloss, Bankomat-PIN …</p>` + pwField("tf-pin", "PIN/Code", { value: d.pin || "" }) + pwField("tf-puk", "PUK (optional)", { value: d.puk || "" });
    if (type === "wifi") mid = txt("tf-ssid", "SSID (Netzwerkname)", "ssid") + pwField("tf-password", "WLAN-Passwort", { auto: "new-password", value: d.password || "", gen: true }) + meterHTML("tf-meter") +
      `<label class="tr-f">Verschlüsselung<select id="tf-enc">${Object.entries(C.WIFI_ENC).map(([k, l]) => `<option value="${k}"${(d.enc || "WPA") === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>` +
      `<label class="tr-check"><input type="checkbox" id="tf-hidden"${d.hidden ? " checked" : ""}><span>Verstecktes Netzwerk (SSID wird nicht gesendet)</span></label>`;
    if (type === "card") mid = `<p class="hint tr-hintwarn">ℹ️ ${esc(CARD_HINT)} Z. B. nur die letzten 4 Ziffern oder die Nummer eines Ausweises.</p>` + txt("tf-holder", "Name", "holder") + pwField("tf-number", "Nummer", { value: d.number || "" });
    const usedCats = [...new Set([...C.CATEGORIES, ...entries().map((e) => e.data.category).filter(Boolean)])];
    return title + mid + note +
      `<label class="tr-f">Kategorie<input id="tf-cat" type="text" list="tf-cats" maxlength="40" value="${v("category")}" placeholder="z. B. Privat, Schule, Bank" autocomplete="off"></label>` +
      `<datalist id="tf-cats">${usedCats.map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>` +
      `<label class="tr-check"><input type="checkbox" id="tf-fav"${d.fav ? " checked" : ""}><span>${icon("star", 16)} Favorit (oben anzeigen)</span></label>`;
  }

  function readForm(box, type) {
    const g = (id) => { const n = box.querySelector("#" + id); return n ? (n.type === "checkbox" ? n.checked : n.value) : undefined; };
    return {
      type, title: g("tf-title"), note: g("tf-note"), category: g("tf-cat"), fav: g("tf-fav"),
      user: g("tf-user"), password: g("tf-password"), url: g("tf-url"), pin: g("tf-pin"), puk: g("tf-puk"),
      ssid: g("tf-ssid"), enc: g("tf-enc"), hidden: g("tf-hidden"), holder: g("tf-holder"), number: g("tf-number"),
    };
  }

  function openEdit(id) {
    const prev = id ? S.cache.get(id) : null;
    if (prev && prev.data.type === "doc") { docs.openEditor(id); return; }
    let type = prev ? prev.data.type : "login";
    let draft = prev ? { ...prev.data } : {};
    const s = sheet({
      title: prev ? "Eintrag bearbeiten" : "Neuer Eintrag",
      bodyHTML:
        (prev ? "" : `<div class="tr-types" role="group" aria-label="Art">${C.TYPE_IDS.map((t) => `<button type="button" class="chip" data-type="${t}" aria-pressed="${t === type}">${icon(C.TYPES[t].icon, 16)} ${esc(C.TYPES[t].label)}</button>`).join("")}</div>`) +
        `<form class="fields tr-form" novalidate></form>` +
        `<p class="tr-err" role="alert" hidden></p>` +
        `<div class="row"><button type="button" class="btn primary" data-save>Speichern</button></div>`,
    });
    const box = s.el;
    const form = box.querySelector("form");
    const drawForm = () => {
      form.innerHTML = formFields(type, draft);
      wireFields(form);
      const pw = form.querySelector("#tf-password");
      if (pw) { const m = form.querySelector("#tf-meter"); updateMeter(m, pw.value); pw.addEventListener("input", () => updateMeter(m, pw.value)); }
      const ssid = form.querySelector("#tf-ssid"), title = form.querySelector("#tf-title");
      if (ssid) ssid.addEventListener("input", () => { if (!title.dataset.touched) title.value = ssid.value; });
      title.addEventListener("input", () => { title.dataset.touched = "1"; });
      if (prev) title.dataset.touched = "1";
    };
    drawForm();
    box.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.type === "doc") { s.close(); docs.openEditor(null); return; }
      draft = { ...draft, ...Object.fromEntries(Object.entries(readForm(box, type)).filter(([, v]) => v !== undefined)) };
      type = b.dataset.type;
      box.querySelectorAll("[data-type]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.type === type)));
      drawForm();
    }));
    form.addEventListener("submit", (ev) => { ev.preventDefault(); box.querySelector("[data-save]").click(); });
    box.querySelector("[data-save]").addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      const data = readForm(box, type);
      const err = box.querySelector(".tr-err");
      if (!String(data.title || "").trim() && !(type === "wifi" && String(data.ssid || "").trim())) { showErr(err, "Bitte einen Titel eingeben."); return; }
      if (type === "wifi" && !String(data.ssid || "").trim()) { showErr(err, "Bitte die SSID (Netzwerkname) eingeben."); return; }
      ui.setBusy(btn, true, "Speichern …");
      try {
        const newIdv = prev ? prev.id : newId();
        // Lokal sofort fertig; in der Cloud nicht auf den Server warten (offline-fähig)
        await settle(saveEntry(newIdv, data, prev), 1500);
        s.close();
        renderBody();
        ui.toast(prev ? "Gespeichert" : "Eintrag angelegt");
      } catch (e2) {
        ui.setBusy(btn, false);
        showErr(err, "Speichern fehlgeschlagen: " + (e2 && e2.message || e2));
      }
    });
  }

  /* ---------- Generator ---------- */

  function genOpts() {
    let o = null;
    try { o = JSON.parse(lsGet(GEN_KEY) || "null"); } catch { /* egal */ }
    return { length: 20, lower: true, upper: true, digits: true, symbols: true, ambiguous: false, pronounceable: false, ...(o || {}) };
  }

  function openGenerator(onUse) {
    const o = genOpts();
    const opt = (k, label) => `<label class="tr-check"><input type="checkbox" data-o="${k}"${o[k] ? " checked" : ""}><span>${label}</span></label>`;
    const s = sheet({
      title: "Passwort-Generator",
      bodyHTML:
        `<div class="tr-gen-out"><output id="tr-gen-pw" class="tr-genpw" aria-live="polite"></output>${meterHTML("tr-gen-m")}</div>` +
        `<label class="tr-f"><span>Länge: <b id="tr-gen-len">${o.length}</b> Zeichen</span><input type="range" id="tr-gen-range" min="8" max="40" step="1" value="${o.length}"></label>` +
        `<div class="tr-opts">` + opt("lower", "Kleinbuchstaben a–z") + opt("upper", "Großbuchstaben A–Z") + opt("digits", "Ziffern 0–9") + opt("symbols", "Sonderzeichen !#$%") +
          opt("ambiguous", "Ähnliche Zeichen erlauben (0/O, l/I)") + opt("pronounceable", "Aussprechbar (Silben, leichter zu tippen)") + `</div>` +
        `<div class="row"><button type="button" class="btn ghost sm" data-regen>${icon("dice", 18)} Neu</button><button type="button" class="btn ghost sm" data-gcopy>${icon("copy", 18)} Kopieren</button>` +
          (onUse ? `<button type="button" class="btn primary sm" data-use>Übernehmen</button>` : "") + `</div>`,
    });
    const box = s.el;
    let cur = "";
    const regen = () => {
      const opts = genOpts();
      box.querySelectorAll("[data-o]").forEach((c) => { opts[c.dataset.o] = c.checked; });
      opts.length = Number(box.querySelector("#tr-gen-range").value);
      if (!opts.lower && !opts.upper && !opts.digits && !opts.symbols) { opts.lower = true; box.querySelector('[data-o="lower"]').checked = true; }
      lsSet(GEN_KEY, JSON.stringify(opts));
      box.querySelector("#tr-gen-len").textContent = opts.length;
      cur = C.generate(opts);
      box.querySelector("#tr-gen-pw").textContent = cur;
      updateMeter(box.querySelector("#tr-gen-m"), cur);
    };
    box.querySelectorAll("[data-o]").forEach((c) => c.addEventListener("change", regen));
    box.querySelector("#tr-gen-range").addEventListener("input", regen);
    box.querySelector("[data-regen]").addEventListener("click", regen);
    box.querySelector("[data-gcopy]").addEventListener("click", () => copySecret(cur, "Passwort"));
    const use = box.querySelector("[data-use]");
    if (use) use.addEventListener("click", () => { onUse(cur); s.close(); });
    regen();
  }

  /* ---------- Einstellungen, Passwort ändern, Sicherung ---------- */

  function openSettings() {
    const m = autoLockMin();
    const used = usedBytes(colItems.all(), entries());
    const local = store.get().mode === "local";
    const nDocs = entries().filter((e) => e.data.type === "doc").length;
    const pct = Math.min(100, (used / FREE_TIER) * 100);
    const s = sheet({
      title: "Tresor-Einstellungen",
      bodyHTML:
        `<p class="lbl">Automatisch sperren nach</p>` +
        `<div class="chips tr-auto">${AUTOLOCK_CHOICES.map((x) => `<button type="button" class="chip" data-min="${x}" aria-pressed="${x === m}">${x} Min.</button>`).join("")}</div>` +
        `<p class="note">ohne Aktivität. Außerdem wird gesperrt, wenn die App 60 s im Hintergrund ist oder du den Tresor verlässt.</p>` +
        `<div class="tr-usage" data-usage="${used}">` +
          `<div class="tr-usage-h"><b>Belegter Speicher (verschlüsselt)</b><span>${esc(fmtSize(used))}</span></div>` +
          `<div class="tr-usage-bar" role="img" aria-label="${esc(fmtSize(used))} von etwa 1 GB"><i style="width:${Math.max(used ? 0.8 : 0, pct).toFixed(2)}%"></i></div>` +
          `<small>${local ? "Auf diesem Gerät (lokaler Modus)." : "In der Cloud – das Firestore-Gratis-Kontingent sind ca. 1 GB."} ${nDocs} ${nDocs === 1 ? "Dokument" : "Dokumente"}, Einträge + Dateien + Vorschaubilder.</small>` +
        `</div>` +
        `<div class="tr-setlist">` +
          `<button type="button" class="tr-row" data-a="pw">${icon("key", 20)}<span><b>Master-Passwort ändern</b><small>Einträge bleiben erhalten</small></span>${icon("chevron-right", 18)}</button>` +
          `<button type="button" class="tr-row" data-a="export">${icon("download", 20)}<span><b>Verschlüsselte Sicherung herunterladen</b><small>JSON-Datei, nur mit Master-Passwort lesbar – ohne Dokument-Fotos/PDFs</small></span>${icon("chevron-right", 18)}</button>` +
          `<button type="button" class="tr-row" data-a="import">${icon("upload", 20)}<span><b>Sicherung importieren</b><small>Einträge aus einer Sicherungsdatei übernehmen</small></span>${icon("chevron-right", 18)}</button>` +
          `<button type="button" class="tr-row danger" data-a="csv">${icon("file", 20)}<span><b>Klartext-Export (CSV) für Bitwarden</b><small>Nur zum Umziehen – unverschlüsselt!</small></span>${icon("chevron-right", 18)}</button>` +
        `</div>` +
        `<details class="tr-about"><summary>So schützt der Tresor deine Daten</summary>` +
          `<ul><li>Verschlüsselung direkt im Gerät: AES-256-GCM, Schlüssel aus dem Master-Passwort mit PBKDF2-SHA256 (${V.ITER.toLocaleString("de-AT")} Runden).</li>` +
          `<li>Gespeichert (Cloud bzw. Gerät) wird nur Zeichensalat – auch Titel und Website sind verschlüsselt.</li>` +
          `<li>Dokumente: Fotos und PDFs werden im Gerät verschlüsselt und erst beim Öffnen entschlüsselt. Nur wenn du „Erinnern vor Ablauf“ einschaltest, steht z. B. „Reisepass läuft ab am …“ als normaler Planer-Termin unverschlüsselt da.</li>` +
          `<li>Das Master-Passwort wird nirgends gespeichert. Der Claude-Assistent bekommt keine Tresor-Daten.</li>` +
          `<li>Kopierte Passwörter werden nach 30 s aus der Zwischenablage gelöscht (soweit der Browser das erlaubt).</li></ul></details>`,
    });
    const box = s.el;
    box.querySelectorAll("[data-min]").forEach((b) => b.addEventListener("click", async () => {
      const v = Number(b.dataset.min);
      box.querySelectorAll("[data-min]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      try { await store.saveSettings({ vault: { ...(store.get().settings.vault || {}), autoLockMin: v } }); } catch (e) { console.warn(e); }
      bump();
      renderSide();
      ui.toast(`Auto-Sperre: ${v} Min.`);
    }));
    box.querySelector('[data-a="pw"]').addEventListener("click", () => { s.close(); openChangePw(); });
    box.querySelector('[data-a="export"]').addEventListener("click", exportBackup);
    box.querySelector('[data-a="import"]').addEventListener("click", () => { s.close(); pickBackup(); });
    box.querySelector('[data-a="csv"]').addEventListener("click", () => { s.close(); openCsv(); });
  }

  function openChangePw() {
    const s = sheet({
      title: "Master-Passwort ändern",
      bodyHTML:
        `<form class="fields" novalidate>` +
          pwField("tc-old", "Aktuelles Master-Passwort") +
          pwField("tc-new", "Neues Master-Passwort (mind. 10 Zeichen)", { auto: "new-password" }) + meterHTML("tc-m") +
          pwField("tc-new2", "Neues Master-Passwort wiederholen", { auto: "new-password" }) +
          `<div class="tr-warn">${icon("lock", 22)}<p>${esc(FORGET_WARN)}</p></div>` +
          `<p class="tr-err" role="alert" hidden></p>` +
          `<button type="submit" class="btn primary" data-go>Passwort ändern</button>` +
          `<p class="note">Ältere Sicherungsdateien bleiben mit dem alten Passwort verschlüsselt.</p>` +
        `</form>`,
    });
    const f = s.el.querySelector("form");
    wireFields(f);
    const nw = f.querySelector("#tc-new");
    nw.addEventListener("input", () => updateMeter(f.querySelector("#tc-m"), nw.value));
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = f.querySelector(".tr-err"), btn = f.querySelector("[data-go]");
      if (waitLeft() > 0) { showErr(err, `Zu viele Fehlversuche – bitte ${waitLeft()} s warten.`); return; }
      const prob = C.masterProblem(nw.value, f.querySelector("#tc-new2").value);
      if (prob) { showErr(err, prob); return; }
      ui.setBusy(btn, true, "Ändere …");
      try {
        const meta2 = await V.changePassword(S.meta, f.querySelector("#tc-old").value, nw.value, { iter: (testHook() && testHook().iter) || V.ITER });
        await putMeta(meta2);
        resetFails();
        s.close();
        ui.toast("Master-Passwort geändert 🔒", 3000);
      } catch (e) {
        if (e && e.code === "wrong-password") { recordFail(); showErr(err, "Das aktuelle Master-Passwort ist falsch."); }
        else showErr(err, "Ändern fehlgeschlagen: " + (e && e.message || e));
        ui.setBusy(btn, false);
      }
    });
  }

  function exportBackup() {
    try {
      const b = V.makeBackup(S.meta, colItems.all());
      download(`tresor-sicherung-${today()}.json`, JSON.stringify(b, null, 1), "application/json");
      ui.toast(`Sicherung mit ${b.items.length} ${b.items.length === 1 ? "Eintrag" : "Einträgen"} erstellt`, 3000);
    } catch (e) { ui.toast("Sicherung fehlgeschlagen: " + e.message, 4000); }
  }

  function pickBackup() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", async () => {
      const file = inp.files && inp.files[0];
      inp.remove();
      if (!file) return;
      if (file.size > 20e6) { ui.toast("Datei zu groß.", 3500); return; }
      let text, parsed;
      try { text = await file.text(); parsed = V.parseBackup(text); }
      catch (e) { ui.toast(e && e.message || "Datei nicht lesbar.", 4000); return; }
      openImport(text, parsed);
    });
    inp.click();
  }

  function openImport(text, parsed) {
    const hasVault = !!S.meta;
    if (hasVault && !S.key) { ui.toast("Bitte zuerst entsperren.", 3000); return; }
    const s = sheet({
      title: "Sicherung importieren",
      bodyHTML:
        `<p>Sicherung vom <b>${esc(parsed.exported ? fmtDate(Date.parse(parsed.exported)) : "?")}</b> mit <b>${parsed.items.length}</b> ${parsed.items.length === 1 ? "Eintrag" : "Einträgen"}.</p>` +
        `<form class="fields" novalidate>` +
          pwField("ti-pw", "Master-Passwort der Sicherung") +
          `<p class="note">${hasVault ? "Die Einträge werden mit deinem aktuellen Master-Passwort neu verschlüsselt und übernommen. Vorhandene, neuere Einträge bleiben erhalten." : "Der Tresor wird aus der Sicherung wiederhergestellt – danach gilt das Master-Passwort der Sicherung."}</p>` +
          `<p class="tr-err" role="alert" hidden></p>` +
          `<button type="submit" class="btn primary" data-go>Importieren</button>` +
        `</form>`,
    });
    const f = s.el.querySelector("form");
    wireFields(f);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = f.querySelector(".tr-err"), btn = f.querySelector("[data-go]");
      ui.setBusy(btn, true, "Importiere …");
      try {
        const o = await V.openBackup(text, f.querySelector("#ti-pw").value);
        let n = 0, skipped = 0;
        if (S.meta && S.key) {
          for (const en of o.entries) {
            const cur = S.cache.get(en.id);
            if (cur && (cur.updated || 0) >= (en.updated || 0)) { skipped++; continue; }
            await settle(saveEntry(en.id, en.data, cur || (en.created ? { created: en.created, data: {} } : null)), 800);
            n++;
          }
          renderBody();
        } else if (!S.meta) {
          for (const r of colItems.all()) await settle(colItems.remove(r.id), 800);
          for (const it of parsed.items) await settle(colItems.put({ id: it.id, iv: it.iv, ct: it.ct, created: it.created || Date.now() }), 800);
          await putMeta(o.meta);
          n = o.entries.length;
          S.key = o.key;
          Sess.adopt(o.key, S.meta);
          resetFails();
          unlocked();
        } else throw new Error("Bitte zuerst entsperren.");
        s.close();
        ui.toast(`${n} ${n === 1 ? "Eintrag" : "Einträge"} übernommen` + (skipped ? `, ${skipped} schon aktuell` : "") + (o.failed ? `, ${o.failed} beschädigt` : ""), 4000);
      } catch (e) {
        showErr(err, e && e.code === "wrong-password" ? "Falsches Passwort für diese Sicherung." : "Import fehlgeschlagen: " + (e && e.message || e));
        ui.setBusy(btn, false);
      }
    });
  }

  function openCsv() {
    const s = sheet({
      title: "Klartext-Export (CSV)",
      bodyHTML:
        `<div class="tr-warn danger">${icon("file", 22)}<p><b>Achtung: Die Datei enthält ALLE Passwörter, PINs und Notizen unverschlüsselt.</b> Jeder, der sie bekommt, kann alles lesen.</p></div>` +
        `<ul class="tr-ul"><li>Nur zum Umziehen in einen anderen Passwort-Manager (Format für Bitwarden: „Bitwarden (csv)“).</li>` +
        `<li>Nicht per Mail, WhatsApp oder Cloud verschicken, nicht in Excel öffnen.</li>` +
        `<li>Nach dem Import <b>sofort löschen</b> (auch aus „Downloads“ und dem Papierkorb).</li></ul>` +
        `<form class="fields" novalidate>` + pwField("tx-pw", "Master-Passwort zur Bestätigung") +
          `<label class="tr-check"><input type="checkbox" id="tx-ok"><span>Ich verstehe, dass die Datei unverschlüsselt ist.</span></label>` +
          `<p class="tr-err" role="alert" hidden></p>` +
          `<button type="submit" class="btn danger" data-go>Klartext-CSV herunterladen</button></form>`,
    });
    const f = s.el.querySelector("form");
    wireFields(f);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = f.querySelector(".tr-err"), btn = f.querySelector("[data-go]");
      if (!f.querySelector("#tx-ok").checked) { showErr(err, "Bitte bestätige den Hinweis."); return; }
      if (waitLeft() > 0) { showErr(err, `Zu viele Fehlversuche – bitte ${waitLeft()} s warten.`); return; }
      ui.setBusy(btn, true, "Prüfe …");
      try {
        await V.unlockVault(f.querySelector("#tx-pw").value, S.meta);
        resetFails();
        const csv = C.toBitwardenCsv(C.sortEntries(entries()));
        await download(`tresor-klartext-${today()}.csv`, csv, "text/csv;charset=utf-8");
        s.close();
        ui.toast("CSV heruntergeladen – nach dem Import bitte löschen!", 4500);
      } catch (e) {
        if (e && e.code === "wrong-password") { recordFail(); showErr(err, "Falsches Passwort."); }
        else showErr(err, "Export fehlgeschlagen: " + (e && e.message || e));
        ui.setBusy(btn, false);
      }
    });
  }

  const offMeta = colMeta.watch((items) => {
    const m = items.find((x) => x.id === META_ID) || null;
    const prev = S.meta;
    S.meta = m;
    if (S.key && (!m || !prev || m.verifier?.ct !== prev.verifier?.ct)) {
      lock(m ? "Der Tresor wurde auf einem anderen Gerät ersetzt – bitte neu entsperren." : "Der Tresor wurde gelöscht.");
      return;
    }
    render();
  });
  const offItems = colItems.watch(() => { if (S.key) syncCache(); });
  const offStore = store.subscribe((s) => {
    const id = identOf(s);
    if (id !== ident) { ident = id; lock(); }
  });

  render();

  return () => {
    alive = false;
    lock();
    clearInterval(countdown);
    clearTimeout(hiddenTimer);
    ACT.forEach((t) => document.removeEventListener(t, bump, { capture: true }));
    document.removeEventListener("visibilitychange", onVis);
    offMeta(); offItems(); offStore();
  };
}

function identOf(s) {
  if (!s || !s.mode) return "";
  return s.mode === "local" ? "local" : (s.user && s.user.uid) || "";
}
