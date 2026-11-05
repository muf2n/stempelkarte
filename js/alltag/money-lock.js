// Update 9 – Geld-Sperre (zweiter Faktor für Alltag › Geld): Sperrbildschirm, Einrichtung, Einstellungen.
//   guard(el, ctx, mountInner) → cleanup: zeigt erst nach dem Entsperren den eigentlichen Geld-Bereich (mountInner).
// Entsperren mit Fingerabdruck/Gesicht (WebAuthn, Plattform-Authentifikator, userVerification "required") oder PIN.
// Prüfung im Browser (money-lock-core.js) → schützt die ANZEIGE in der App. Server-Zugriffe (Claude-Assistent,
// tools/mcp, Bank-Abgleich) sind davon bewusst NICHT betroffen.
import * as S from "./money-lock-state.js";
import * as L from "./money-lock-core.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import * as ui from "../ui.js";
import * as store from "../store.js";
import { getFirebase } from "../firebase.js";
import { isNative, nativeGoogleCredential } from "../native.js";

const FAIL_KEY = "sk-money-lock-fails";
const DEV_KEY = "sk-money-lock-dev";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* egal */ } };

function ensureCss() {
  if (document.getElementById("css-money-lock")) return;
  const l = document.createElement("link");
  l.id = "css-money-lock";
  l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-moneylock.css", import.meta.url).href;
  document.head.appendChild(l);
}

/* ---------- Fehlversuche (localStorage → überlebt Neuladen) ---------- */

function fails() {
  try { const f = JSON.parse(lsGet(FAIL_KEY) || "null"); if (f && Number.isFinite(f.n)) return { n: f.n, until: Number(f.until) || 0 }; } catch { /* egal */ }
  return { n: 0, until: 0 };
}
function recordFail() {
  const n = fails().n + 1;
  const f = { n, until: Date.now() + L.failDelay(n) * 1000 };
  lsSet(FAIL_KEY, JSON.stringify(f));
  return f;
}
const resetFails = () => lsSet(FAIL_KEY, null);
const waitLeft = () => Math.max(0, Math.ceil((fails().until - Date.now()) / 1000));

/* ---------- WebAuthn ---------- */

let bioPromise = null;
/** Plattform-Authentifikator mit Nutzerprüfung vorhanden? (In der Android-App-WebView meist nicht.) */
export function bioSupport() {
  if (!bioPromise) {
    bioPromise = (async () => {
      try {
        if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return false;
        if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
        return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
      } catch { return false; }
    })();
  }
  return bioPromise;
}
let bioOk = false;
bioSupport().then((v) => { bioOk = v; });

const devKey = () => DEV_KEY + ":" + (S.ident() || "");
/** Zugangsdaten dieses Geräts (falls hier eingerichtet). */
function devCred() {
  const id = lsGet(devKey());
  return id ? S.getCfg().creds.find((c) => c.id === id) || null : null;
}
const bioHere = () => bioOk && !!devCred();

function deviceLabel() {
  const ua = navigator.userAgent || "";
  if (isNative()) return "Android-App";
  if (/Android/i.test(ua)) return "Android-Handy";
  if (/iPhone|iPad/i.test(ua)) return "iPhone/iPad";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows-PC";
  return "Dieses Gerät";
}

function bioError(err) {
  const n = err && err.name;
  if (n === "NotAllowedError" || n === "AbortError") return ""; // abgebrochen / Zeit abgelaufen
  if (n === "InvalidStateError") return "Auf diesem Gerät ist schon ein Fingerabdruck für Geld eingerichtet.";
  if (n === "SecurityError") return "Fingerabdruck ist auf dieser Adresse nicht möglich.";
  if (n === "NotSupportedError") return "Dieses Gerät unterstützt das nicht – bitte die PIN verwenden.";
  return (err && err.message) || "Fingerabdruck fehlgeschlagen.";
}

async function registerBio() {
  const st = store.get();
  const uid = (st.user && st.user.uid) || "local";
  const challenge = L.randomBytes(32);
  const cfg = S.getCfg();
  const pk = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { id: location.hostname, name: "Stempelkarte" },
      user: { id: new TextEncoder().encode(uid).slice(0, 64), name: (st.user && st.user.email) || "stempelkarte", displayName: (st.user && st.user.name) || "Stempelkarte – Geld" },
      pubKeyCredParams: [{ type: "public-key", alg: L.ALG_ES256 }, { type: "public-key", alg: L.ALG_RS256 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged", requireResidentKey: false },
      excludeCredentials: cfg.creds.map((c) => ({ type: "public-key", id: L.unb64url(c.id) })),
      attestation: "none",
      timeout: 60000,
    },
  });
  if (!pk) throw new Error("Abgebrochen.");
  const r = pk.response;
  if (!L.checkCreateClientData(r.clientDataJSON, { challenge, origin: location.origin })) throw new Error("Antwort des Geräts passt nicht.");
  const spki = typeof r.getPublicKey === "function" ? r.getPublicKey() : null;
  const alg = typeof r.getPublicKeyAlgorithm === "function" ? r.getPublicKeyAlgorithm() : L.ALG_ES256;
  if (!spki) throw new Error("Dieser Browser ist zu alt für Fingerabdruck – bitte die PIN verwenden.");
  if (alg !== L.ALG_ES256 && alg !== L.ALG_RS256) throw new Error("Unbekanntes Schlüsselverfahren.");
  let counter = 0;
  try { if (typeof r.getAuthenticatorData === "function") counter = L.parseAuthData(r.getAuthenticatorData()).counter; } catch { /* 0 */ }
  const cred = { id: L.b64url(pk.rawId), publicKey: L.b64(spki), alg, counter, label: deviceLabel(), created: Date.now() };
  await S.saveCfg({ creds: [...cfg.creds.filter((c) => c.id !== cred.id), cred] });
  lsSet(devKey(), cred.id);
  return cred;
}

let bioAbort = null;
/** → true bei gültigem Fingerabdruck/Gesicht. Wirft bei Fehlern (Text für den Nutzer). */
async function bioVerify() {
  const cred = devCred();
  if (!cred) throw new Error("Auf diesem Gerät ist kein Fingerabdruck eingerichtet.");
  const challenge = L.randomBytes(32);
  try { if (bioAbort) bioAbort.abort(); } catch { /* egal */ }
  bioAbort = typeof AbortController === "function" ? new AbortController() : null;
  const a = await navigator.credentials.get({
    publicKey: { challenge, rpId: location.hostname, allowCredentials: [{ type: "public-key", id: L.unb64url(cred.id) }], userVerification: "required", timeout: 60000 },
    ...(bioAbort ? { signal: bioAbort.signal } : {}),
  });
  bioAbort = null;
  if (!a) return false;
  if (L.b64url(a.rawId) !== cred.id) throw new Error("Unbekannter Schlüssel.");
  const res = await L.verifyAssertion(cred, a.response, { challenge, origin: location.origin, rpId: location.hostname });
  if (!res.ok) throw new Error(res.reason === "counter" ? "Zähler des Schlüssels passt nicht – bitte die PIN verwenden und den Fingerabdruck neu einrichten." : "Fingerabdruck konnte nicht bestätigt werden.");
  if (res.counter !== cred.counter) {
    const creds = S.getCfg().creds.map((c) => (c.id === cred.id ? { ...c, counter: res.counter, used: Date.now() } : c));
    S.saveCfg({ creds }).catch((e) => console.warn("Geld-Sperre Zähler:", e));
  }
  return true;
}
const abortBio = () => { try { if (bioAbort) bioAbort.abort(); } catch { /* egal */ } bioAbort = null; };

/* ---------- Google neu anmelden („PIN vergessen?“) ---------- */

async function reauthGoogle() {
  const t = S.testHook();
  if (t && typeof t.reauth === "function") return !!(await t.reauth());
  if (S.isLocal()) throw new Error("Im lokalen Modus gibt es kein Google-Konto.");
  if (navigator.onLine === false) throw new Error("Du bist offline – für die Google-Anmeldung wird Internet gebraucht.");
  const f = await getFirebase();
  const u = f && f.auth.currentUser;
  if (!u) throw new Error("Bitte zuerst mit Google anmelden.");
  const { fa } = f;
  try {
    let res;
    if (isNative()) {
      const cred = await nativeGoogleCredential(fa);
      if (!cred) return false;
      res = await fa.reauthenticateWithCredential(u, cred);
    } else {
      const provider = new fa.GoogleAuthProvider();
      provider.setCustomParameters(u.email ? { login_hint: u.email, prompt: "select_account" } : { prompt: "select_account" });
      res = await fa.reauthenticateWithPopup(u, provider);
    }
    return !!(res && res.user && res.user.uid === u.uid);
  } catch (err) {
    const c = String((err && err.code) || (err && err.message) || "");
    if (/popup-closed|cancelled-popup|cancel|12501/i.test(c)) return false;
    if (/user-mismatch/.test(c)) throw new Error("Das war ein anderes Google-Konto – bitte mit dem Konto dieser App anmelden.");
    if (/popup-blocked/.test(c)) throw new Error("Das Anmeldefenster wurde blockiert – bitte Popups für diese Seite erlauben.");
    if (/network/.test(c)) throw new Error("Keine Internetverbindung.");
    throw new Error("Google-Anmeldung fehlgeschlagen" + (err && err.code ? ` (${err.code})` : "") + ".");
  }
}

/* ---------- Ziffernblock ---------- */

/**
 * opts: { title, text, len (Auto-Absenden bei dieser Länge, 0 = OK-Knopf), bio (Knopf zeigen), icon,
 *         onPin(pin) → Promise<{ok}|{err}>, onBio() → Promise<{ok}|{err}>, footHTML, onFoot(name) }
 */
function pad(host, opts) {
  const len = opts.len || 0;
  let pin = "";
  let busy = false;
  let waitT = null;
  host.innerHTML =
    `<div class="ml-pad">` +
      `<span class="ml-ic">${icon(opts.icon || "lock", 30)}</span>` +
      `<h3 class="ml-h">${esc(opts.title)}</h3>` +
      (opts.text ? `<p class="note ml-text">${esc(opts.text)}</p>` : "") +
      `<div class="ml-dots" aria-hidden="true"></div>` +
      `<p class="ml-sr" aria-live="polite"></p>` +
      `<p class="ml-err" role="alert"></p>` +
      `<div class="ml-keys" role="group" aria-label="Ziffernblock">` +
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button type="button" class="ml-key" data-k="${d}">${d}</button>`).join("") +
        (opts.bio ? `<button type="button" class="ml-key ml-key-bio" data-k="bio" aria-label="Mit Fingerabdruck oder Gesicht entsperren">${icon("fingerprint", 28)}</button>` : `<span class="ml-key-gap"></span>`) +
        `<button type="button" class="ml-key" data-k="0">0</button>` +
        `<button type="button" class="ml-key ml-key-del" data-k="del" aria-label="Letzte Ziffer löschen">⌫</button>` +
      `</div>` +
      (len ? "" : `<button type="button" class="btn primary ml-ok" data-k="ok" disabled>${esc(opts.okLabel || "Weiter")}</button>`) +
      (opts.footHTML || "") +
    `</div>`;
  const root = host.querySelector(".ml-pad");
  const dotsEl = root.querySelector(".ml-dots"), errEl = root.querySelector(".ml-err"), srEl = root.querySelector(".ml-sr"), okBtn = root.querySelector(".ml-ok");

  function draw() {
    const n = len || Math.max(L.PIN_MIN, pin.length);
    dotsEl.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < pin.length ? "on" : ""}"></i>`).join("");
    srEl.textContent = pin.length ? `${pin.length} ${pin.length === 1 ? "Ziffer" : "Ziffern"} eingegeben` : "";
    if (okBtn) okBtn.disabled = busy || pin.length < L.PIN_MIN || waitLeft() > 0;
    const locked = busy || (opts.useWait && waitLeft() > 0);
    root.querySelectorAll(".ml-key:not(.ml-key-bio)").forEach((b) => { b.disabled = locked; });
    root.classList.toggle("is-busy", busy);
  }
  function error(msg) {
    errEl.textContent = msg || "";
    if (msg) { root.classList.remove("shake"); void root.offsetWidth; root.classList.add("shake"); }
  }
  function startWait() {
    if (!opts.useWait) return;
    clearInterval(waitT);
    const tick = () => {
      const s = waitLeft();
      if (s > 0) errEl.textContent = `Zu viele Fehlversuche – bitte noch ${s} s warten.`;
      else { clearInterval(waitT); waitT = null; if (/warten/.test(errEl.textContent)) errEl.textContent = ""; }
      draw();
    };
    tick();
    if (waitLeft() > 0) waitT = setInterval(tick, 250);
  }
  async function submit() {
    if (busy || pin.length < L.PIN_MIN) return;
    if (opts.useWait && waitLeft() > 0) { startWait(); return; }
    busy = true; draw();
    let r;
    try { r = await opts.onPin(pin); } catch (err) { r = { err: (err && err.message) || String(err) }; }
    busy = false;
    if (!root.isConnected) return;
    pin = "";
    draw();
    if (r && r.err) { error(r.err); startWait(); }
  }
  async function bio() {
    if (busy || !opts.onBio) return;
    error("");
    let r;
    try { r = await opts.onBio(); } catch (err) { r = { err: bioError(err) }; }
    if (root.isConnected && r && r.err) error(r.err);
  }
  function press(k) {
    if (k === "bio") { bio(); return; }
    if (k === "ok") { submit(); return; }
    if (busy || (opts.useWait && waitLeft() > 0)) return;
    if (k === "del") { pin = pin.slice(0, -1); draw(); return; }
    if (!/^\d$/.test(k) || pin.length >= L.PIN_MAX) return;
    if (errEl.textContent && !/warten/.test(errEl.textContent)) errEl.textContent = "";
    pin += k;
    draw();
    if (len && pin.length >= len) submit();
  }
  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-k], [data-ml-foot]");
    if (!b || !root.contains(b)) return;
    if (b.dataset.mlFoot) { if (opts.onFoot) opts.onFoot(b.dataset.mlFoot, b); return; }
    press(b.dataset.k);
  });
  // Tastatur (PC): nur das oberste Feld reagiert
  const onKey = (ev) => {
    if (!root.isConnected) { document.removeEventListener("keydown", onKey); return; }
    const sheets = document.querySelectorAll("#sheet-root .sheet");
    const top = sheets.length ? sheets[sheets.length - 1] : null;
    if (top ? !top.contains(root) : false) return;
    if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if (/^\d$/.test(ev.key)) { ev.preventDefault(); press(ev.key); }
    else if (ev.key === "Backspace") { ev.preventDefault(); press("del"); }
    else if (ev.key === "Enter" && !len) { ev.preventDefault(); press("ok"); }
  };
  document.addEventListener("keydown", onKey);
  draw();
  if (opts.useWait && waitLeft() > 0) startWait();
  return {
    root, error, bio,
    clear() { pin = ""; draw(); },
    destroy() { clearInterval(waitT); document.removeEventListener("keydown", onKey); },
  };
}

/* ---------- PIN prüfen (mit Wartezeit) ---------- */

async function checkPin(pin) {
  const s = waitLeft();
  if (s > 0) return { err: `Zu viele Fehlversuche – bitte noch ${s} s warten.` };
  if (await L.verifyPin(pin, S.getCfg().pin)) { resetFails(); return { ok: true }; }
  const f = recordFail();
  const d = L.failDelay(f.n);
  if (d) return { err: `Falsche PIN. Bitte ${d} s warten.` };
  const left = 5 - f.n;
  return { err: left <= 2 ? `Falsche PIN. Noch ${left} ${left === 1 ? "Versuch" : "Versuche"}, dann kurze Wartezeit.` : "Falsche PIN." };
}

/* ---------- Sperrbildschirm (im Geld-Bereich) ---------- */

function lockScreen(host, { autoBio }) {
  const cfg = S.getCfg();
  const bio = bioHere();
  const reason = S.lockReason();
  const p = pad(host, {
    title: "Geld ist gesperrt",
    text: reason || (bio ? "Entsperre mit Fingerabdruck/Gesicht oder deiner PIN." : "Gib deine PIN ein."),
    len: (cfg.pin && cfg.pin.len) || 0,
    okLabel: "Entsperren",
    bio,
    useWait: true,
    onPin: async (pin) => { const r = await checkPin(pin); if (r.ok) S.unlock(); return r; },
    onBio: async () => { if (await bioVerify()) { resetFails(); S.unlock(); return { ok: true }; } return { ok: false }; },
    footHTML: `<div class="ml-foot">` +
      (bio ? `<button type="button" class="btn ghost sm ml-biobtn" data-ml-foot="bio">${icon("fingerprint", 20)}<span>Fingerabdruck / Gesicht</span></button>` : "") +
      `<button type="button" class="ml-link" data-ml-foot="forgot">PIN vergessen?</button>` +
    `</div>`,
    onFoot: (name) => { if (name === "bio") p.bio(); else if (name === "forgot") forgotFlow(); },
  });
  host.querySelector(".ml-pad").classList.add("card", "ml-lock");
  if (autoBio && bio && document.visibilityState === "visible") setTimeout(() => { if (p.root.isConnected) p.bio(); }, 250);
  return { destroy() { p.destroy(); abortBio(); } };
}

/* ---------- Blätter: Prüfen, Einrichten, PIN vergessen ---------- */

/** Aktuelle PIN/Fingerabdruck verlangen → Promise<bool>. */
function openVerify(title, text) {
  return new Promise((resolve) => {
    let done = false, p = null;
    const finish = (v, close) => { if (done) return; done = true; if (p) p.destroy(); abortBio(); resolve(v); if (close) close(); };
    const sh = ui.openSheet({
      title,
      bodyHTML: `<div class="ml-sheetpad"></div>`,
      onMount(sheet, close) {
        const cfg = S.getCfg();
        p = pad(sheet.querySelector(".ml-sheetpad"), {
          title: "Zur Bestätigung", text, icon: "shield", len: (cfg.pin && cfg.pin.len) || 0, okLabel: "Bestätigen",
          bio: bioHere(), useWait: true,
          onPin: async (pin) => { const r = await checkPin(pin); if (r.ok) finish(true, close); return r; },
          onBio: async () => { if (await bioVerify()) { resetFails(); finish(true, close); return { ok: true }; } return { ok: false }; },
        });
        // Schließen über ✕/Hintergrund → abgebrochen
        new MutationObserver((_, obs) => { if (!sheet.isConnected) { obs.disconnect(); finish(false); } }).observe(sheet.parentNode, { childList: true });
      },
    });
    return sh;
  });
}

/**
 * Neue PIN festlegen (2× eingeben) und danach optional Fingerabdruck anbieten.
 * mode: "setup" (Sperre einschalten) | "change" | "reset" (nach Google-Anmeldung)
 */
function openSetup(mode = "setup") {
  let p = null;
  let first = "";
  const titles = { setup: "Geld schützen", change: "PIN ändern", reset: "Neue PIN festlegen" };
  ui.openSheet({
    title: titles[mode] || titles.setup,
    bodyHTML: `<div class="ml-sheetpad"></div>`,
    onMount(sheet, close) {
      const host = sheet.querySelector(".ml-sheetpad");
      new MutationObserver((_, obs) => { if (!sheet.isConnected) { obs.disconnect(); if (p) p.destroy(); abortBio(); } }).observe(sheet.parentNode, { childList: true });
      const stepNew = (err = "") => {
        if (p) p.destroy();
        first = "";
        p = pad(host, {
          title: mode === "change" ? "Neue PIN" : "PIN festlegen", icon: "key", len: 0, okLabel: "Weiter",
          text: "4 bis 8 Ziffern. Danach tippst du sie zur Kontrolle noch einmal.",
          onPin: async (pin) => { first = pin; stepRepeat(); return { ok: true }; },
        });
        if (err) p.error(err);
      };
      const stepRepeat = () => {
        if (p) p.destroy();
        p = pad(host, {
          title: "PIN wiederholen", icon: "key", len: first.length,
          text: "Zur Kontrolle nochmal dieselbe PIN.",
          onPin: async (pin) => {
            if (pin !== first) { setTimeout(() => stepNew("Die PINs stimmen nicht überein – bitte nochmal."), 0); return { ok: false }; }
            const t = S.testHook();
            const rec = await L.hashPin(pin, (t && t.iter) || L.PIN_ITER);
            resetFails();
            S.unlock(); // zuerst entsperren, dann einschalten → Geld bleibt offen
            try { await S.saveCfg({ pin: rec, enabled: mode === "change" ? S.getCfg().enabled : true, bannerDismissed: true }); }
            catch (err) { return { err: "Speichern fehlgeschlagen: " + ((err && err.message) || err) }; }
            setTimeout(stepBio, 0);
            return { ok: true };
          },
        });
      };
      const finish = () => {
        if (p) p.destroy();
        close();
        ui.toast(mode === "setup" ? "Geld ist jetzt geschützt" : "Neue PIN gespeichert");
      };
      const stepBio = async () => {
        if (mode === "change" || !(await bioSupport()) || devCred()) { finish(); return; }
        if (p) p.destroy();
        p = null;
        host.innerHTML =
          `<div class="ml-pad ml-bioask">` +
            `<span class="ml-ic">${icon("fingerprint", 32)}</span>` +
            `<h3 class="ml-h">Auch mit Fingerabdruck/Gesicht?</h3>` +
            `<p class="note ml-text">Dein Gerät prüft Fingerabdruck oder Gesicht selbst – die App bekommt davon nur ein „passt“. Die PIN bleibt als Ersatz.</p>` +
            `<p class="ml-err" role="alert"></p>` +
            `<button type="button" class="btn primary" data-b="reg">${icon("fingerprint", 22)}<span>Fingerabdruck einrichten</span></button>` +
            `<button type="button" class="btn ghost" data-b="skip">Nur PIN verwenden</button>` +
          `</div>`;
        const errEl = host.querySelector(".ml-err");
        host.querySelector("[data-b=skip]").addEventListener("click", finish);
        host.querySelector("[data-b=reg]").addEventListener("click", async (ev) => {
          const b = ev.currentTarget;
          b.disabled = true;
          try { await registerBio(); finish(); }
          catch (err) { errEl.textContent = bioError(err) || "Abgebrochen – du kannst es später in den Einstellungen nochmal versuchen."; }
          finally { if (b.isConnected) b.disabled = false; }
        });
      };
      stepNew();
    },
  });
}

async function forgotFlow() {
  if (S.isLocal() && !(S.testHook() && S.testHook().reauth)) {
    ui.openSheet({
      title: "PIN vergessen?",
      bodyHTML:
        `<div class="ml-forgot">` +
          `<p>Im lokalen Modus gibt es kein Google-Konto, mit dem du dich ausweisen kannst. Die Geld-Daten liegen hier ohnehin nur in diesem Browser.</p>` +
          `<p class="note">Du kannst eine neue PIN festlegen – der Fingerabdruck (falls eingerichtet) bleibt.</p>` +
          `<button type="button" class="btn primary" data-b="new">Neue PIN festlegen</button>` +
        `</div>`,
      onMount(sheet, close) {
        ui.confirmButton(sheet.querySelector("[data-b=new]"), "Wirklich neue PIN?", () => { close(); openSetup("reset"); });
      },
    });
    return;
  }
  ui.openSheet({
    title: "PIN vergessen?",
    bodyHTML:
      `<div class="ml-forgot">` +
        `<p>Melde dich zur Sicherheit nochmal mit deinem Google-Konto an. Danach legst du eine neue PIN fest.</p>` +
        `<p class="ml-err" role="alert"></p>` +
        `<button type="button" class="btn primary" data-b="google">${icon("user", 20)}<span>Mit Google bestätigen</span></button>` +
      `</div>`,
    onMount(sheet, close) {
      const b = sheet.querySelector("[data-b=google]"), errEl = sheet.querySelector(".ml-err");
      b.addEventListener("click", async () => {
        b.disabled = true; errEl.textContent = "";
        try {
          if (await reauthGoogle()) { resetFails(); close(); openSetup("reset"); }
          else errEl.textContent = "Abgebrochen.";
        } catch (err) { errEl.textContent = (err && err.message) || String(err); }
        finally { if (b.isConnected) b.disabled = false; }
      });
    },
  });
}

/* ---------- Einstellungen ---------- */

export function openSettings() {
  ensureCss();
  let off = null;
  ui.openSheet({
    title: "Geld-Sperre",
    bodyHTML: `<div class="ml-set"></div>`,
    onMount(sheet) {
      const root = sheet.querySelector(".ml-set");
      const draw = async () => {
        const cfg = S.getCfg();
        const sup = await bioSupport();
        if (!root.isConnected) return;
        const mine = devCred();
        const others = cfg.creds.filter((c) => !mine || c.id !== mine.id);
        const m = cfg.autoLockMin;
        root.innerHTML =
          `<label class="switch ml-main"><input type="checkbox" id="ml-on"${cfg.enabled ? " checked" : ""}><span>Geld sperren</span></label>` +
          `<p class="note">Beim Öffnen von Geld wird nach Fingerabdruck/Gesicht oder PIN gefragt.</p>` +
          (cfg.pin ?
            `<h4 class="ml-sub">Entsperren mit</h4>` +
            `<div class="ml-row">${icon("fingerprint", 22)}<span><b>Fingerabdruck / Gesicht</b><small>${
              !sup ? "Auf diesem Gerät nicht verfügbar – hier wird die PIN verwendet." :
              mine ? `Auf diesem Gerät eingerichtet${others.length ? ` · ${others.length} weitere${others.length === 1 ? "s Gerät" : " Geräte"}` : ""}` :
              `Auf diesem Gerät noch nicht eingerichtet${others.length ? ` (${others.length} anderes Gerät)` : ""}`}</small></span>` +
              (sup ? (mine ? `<button type="button" class="btn ghost sm" data-ml="bio-del">Entfernen</button>` : `<button type="button" class="btn primary sm" data-ml="bio-add">Einrichten</button>`) : "") +
            `</div>` +
            `<div class="ml-row">${icon("key", 22)}<span><b>PIN</b><small>${cfg.pin.len ? `${cfg.pin.len}-stellig · ` : ""}immer als Ersatz</small></span><button type="button" class="btn ghost sm" data-ml="pin">Ändern</button></div>` +
            `<h4 class="ml-sub">Automatisch sperren nach</h4>` +
            `<div class="chips ml-auto" role="group" aria-label="Automatisch sperren nach">${L.AUTOLOCK_CHOICES.map((x) => `<button type="button" class="chip" data-min="${x}" aria-pressed="${x === m}">${x} Min.</button>`).join("")}</div>` +
            `<p class="note">ohne Aktivität – und wenn die App länger als 60 Sekunden im Hintergrund ist.</p>` +
            `<label class="switch ml-mask"><input type="checkbox" id="ml-mask"${cfg.maskElsewhere ? " checked" : ""}><span>Beträge in anderen Bereichen ausblenden</span></label>` +
            `<p class="note">Taggeld und Kilometergeld (Übersicht, Einträge, Fahrtenbuch) erscheinen als „•••“, solange Geld gesperrt ist.</p>` +
            (cfg.enabled ? `<button type="button" class="btn ghost" data-ml="locknow">${icon("lock", 20)}<span>Jetzt sperren</span></button>` : "")
          : `<button type="button" class="btn primary" data-ml="setup">${icon("lock", 20)}<span>Jetzt einrichten</span></button>`) +
          `<div class="ml-info">${icon("sparkle", 20)}<p><b>Der Claude-Assistent kann weiterhin deine Geld-Daten lesen.</b> Er holt sie direkt über deinen Server, nicht über diesen Bildschirm.</p></div>` +
          `<div class="ml-info">${icon("shield", 20)}<p>PIN und Fingerabdruck werden hier am Gerät geprüft. Das schützt die Anzeige in der App – z. B. wenn jemand dein entsperrtes Handy in der Hand hat. Deine Daten selbst sind wie bisher über dein Google-Konto geschützt.</p></div>`;
      };
      root.addEventListener("change", async (ev) => {
        const t = ev.target;
        if (t.id === "ml-on") {
          const cfg = S.getCfg();
          if (t.checked) {
            if (!cfg.pin) { t.checked = false; openSetup("setup"); return; }
            S.unlock();
            await S.saveCfg({ enabled: true }).catch((e) => ui.toast("Speichern fehlgeschlagen: " + e.message, 4000));
            ui.toast("Geld-Sperre eingeschaltet");
          } else {
            t.checked = true;
            if (!(await openVerify("Sperre ausschalten", "Bestätige mit PIN oder Fingerabdruck, um die Geld-Sperre auszuschalten."))) return;
            await S.saveCfg({ enabled: false }).catch((e) => ui.toast("Speichern fehlgeschlagen: " + e.message, 4000));
            ui.toast("Geld-Sperre ausgeschaltet");
          }
        } else if (t.id === "ml-mask") {
          await S.saveCfg({ maskElsewhere: t.checked }).catch((e) => ui.toast("Speichern fehlgeschlagen: " + e.message, 4000));
        }
      });
      root.addEventListener("click", async (ev) => {
        const chip = ev.target.closest("[data-min]");
        if (chip) { await S.saveCfg({ autoLockMin: Number(chip.dataset.min) }).catch((e) => ui.toast("Speichern fehlgeschlagen: " + e.message, 4000)); S.unlock(); return; }
        const b = ev.target.closest("[data-ml]");
        if (!b) return;
        switch (b.dataset.ml) {
          case "setup": openSetup("setup"); break;
          case "pin":
            if (await openVerify("PIN ändern", "Gib zuerst deine aktuelle PIN ein.")) openSetup("change");
            break;
          case "bio-add":
            b.disabled = true;
            try { await registerBio(); ui.toast("Fingerabdruck eingerichtet"); }
            catch (err) { const m = bioError(err); if (m) ui.toast(m, 4000); }
            finally { if (b.isConnected) b.disabled = false; }
            break;
          case "bio-del": {
            const mine = devCred();
            if (!mine) break;
            lsSet(devKey(), null);
            await S.saveCfg({ creds: S.getCfg().creds.filter((c) => c.id !== mine.id) }).catch((e) => ui.toast("Speichern fehlgeschlagen: " + e.message, 4000));
            ui.toast("Fingerabdruck auf diesem Gerät entfernt");
            break;
          }
          case "locknow": S.lock("Manuell gesperrt."); break;
          default: break;
        }
      });
      off = S.onChange(() => { if (!root.isConnected) { off(); return; } draw(); });
      new MutationObserver((_, obs) => { if (!sheet.isConnected) { obs.disconnect(); if (off) off(); } }).observe(sheet.parentNode, { childList: true });
      draw();
    },
  });
}

/* ---------- Wächter um den Geld-Bereich ---------- */

export function guard(el, ctx, mountInner) {
  ensureCss();
  S.start();
  el.innerHTML = `<div class="ml-host"><div class="ml-banner-slot"></div><div class="ml-lockslot"></div><div class="ml-inner"></div></div>`;
  const bannerSlot = el.querySelector(".ml-banner-slot"), lockSlot = el.querySelector(".ml-lockslot"), innerEl = el.querySelector(".ml-inner");
  const bar = el.closest(".al-mod") && el.closest(".al-mod").querySelector(".al-bar");
  const tools = document.createElement("div");
  tools.className = "ml-tools";
  if (bar) bar.appendChild(tools);
  let mode = "";
  let inner = null;
  let lockUi = null;
  let toolsKey = "", bannerKey = "";
  let alive = true;

  function drawTools() {
    const cfg = S.getCfg();
    const k = mode === "open" ? (cfg.enabled ? "on" : "off") : "none";
    if (k === toolsKey) return;
    toolsKey = k;
    tools.innerHTML = k === "none" ? "" :
      (k === "on" ? `<button type="button" class="ml-tbtn" data-ml-t="lock" aria-label="Geld jetzt sperren" title="Jetzt sperren">${icon("lock", 20)}</button>` : "") +
      `<button type="button" class="ml-tbtn" data-ml-t="settings" aria-label="Geld-Sperre: Einstellungen" title="Geld-Sperre">${icon("gear", 20)}</button>`;
  }
  function drawBanner() {
    const cfg = S.getCfg();
    const k = mode === "open" && !cfg.enabled && !cfg.bannerDismissed ? "show" : "";
    if (k === bannerKey) return;
    bannerKey = k;
    bannerSlot.innerHTML = k ?
      `<div class="ml-banner" role="note">` +
        `<span class="ml-banner-ic">${icon("fingerprint", 24)}</span>` +
        `<span class="ml-banner-txt"><b>Geld mit Fingerabdruck/PIN schützen</b><small>Dann sieht niemand deine Beträge, wenn er dein Handy in der Hand hat.</small></span>` +
        `<button type="button" class="btn primary sm" data-ml-t="setup">Einrichten</button>` +
        `<button type="button" class="ml-x" data-ml-t="dismiss" aria-label="Hinweis ausblenden">✕</button>` +
      `</div>` : "";
  }
  function render() {
    if (!alive) return;
    const want = !S.isLoaded() ? "loading" : S.isLocked() ? "locked" : "open";
    const prev = mode;
    if (want !== mode) {
      mode = want;
      if (want !== "open" && inner !== null) {
        ui.closeAllSheets(); // offene Geld-Blätter (mit Beträgen) schließen
        try { if (typeof inner === "function") inner(); } catch (err) { console.error("Geld cleanup:", err); }
        inner = null;
        innerEl.innerHTML = "";
      }
      if (lockUi) { lockUi.destroy(); lockUi = null; }
      lockSlot.innerHTML = "";
      if (want === "loading") lockSlot.innerHTML = `<div class="al-loading">Lade …</div>`;
      else if (want === "locked") lockUi = lockScreen(lockSlot, { autoBio: (prev === "" || prev === "loading") && !S.lockReason() });
      else {
        inner = mountInner(innerEl, ctx) || 0;
      }
    }
    drawTools();
    drawBanner();
  }
  const onClick = (ev) => {
    const b = ev.target.closest("[data-ml-t]");
    if (!b) return;
    switch (b.dataset.mlT) {
      case "lock": S.lock("Manuell gesperrt."); break;
      case "settings": openSettings(); break;
      case "setup": openSetup("setup"); break;
      case "dismiss": S.saveCfg({ bannerDismissed: true }).catch((e) => console.warn(e)); break;
      default: break;
    }
  };
  el.addEventListener("click", onClick);
  tools.addEventListener("click", onClick);
  const off = S.onChange(render);
  render();
  return () => {
    alive = false;
    off();
    el.removeEventListener("click", onClick);
    tools.remove();
    if (lockUi) lockUi.destroy();
    if (typeof inner === "function") { try { inner(); } catch (err) { console.error(err); } }
    inner = null;
    el.innerHTML = "";
  };
}
