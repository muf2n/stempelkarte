// Geld › Übersicht: Karte „Bankkonto (BAWAG)“ – Verbindung über Enable Banking (Server: tools/mcp/src/bank.js).
// Die App spricht nur mit dem eigenen Worker (/bank/start|sync|status|unlink); die Anmeldung passiert auf der
// Seite von BAWAG. Buchungen schreibt der Server direkt nach money_tx (src:"bank").
import * as store from "../store.js";
import { getFirebase } from "../firebase.js";
import { isNative, plugin } from "../native.js";
import * as M from "./money-core.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";

const URL_KEY = "stempelkarte.ai.url";
const DEFAULT_URL = "https://stempelkarte-mcp.lippa-florian.workers.dev";
const CACHE_KEY = "stempelkarte.bank.status";
const FLASH_KEY = "stempelkarte.bank.flash";
const REFRESH_MS = 60 * 1000;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* egal */ } };

/** Worker-Adresse: localStorage → settings.ai.url → Standard (wie der Assistent). */
export function serverUrl(snap = store.get()) {
  const s = lsGet(URL_KEY) || (snap && snap.settings && snap.settings.ai && snap.settings.ai.url) || DEFAULT_URL;
  return String(s).trim().replace(/\/+$/, "").replace(/\/(mcp|chat)$/, "");
}

/** Test-Haken: nur auf localhost wird window.__bankTestToken gelesen (Playwright, ohne echte Anmeldung). */
function testToken() {
  try {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
    return typeof window.__bankTestToken === "string" && window.__bankTestToken ? window.__bankTestToken : null;
  } catch { return null; }
}

class BankError extends Error {
  constructor(msg, status = 0, data = null) { super(msg); this.status = status; this.data = data; }
}

const STATUS_TEXT = {
  401: "Anmeldung abgelehnt – bitte die App neu laden oder ab- und wieder anmelden.",
  403: "Der Server lehnt diese Seite ab (Herkunft nicht erlaubt).",
  404: "Der Server kennt die Bankverbindung noch nicht – ist die neueste Version veröffentlicht?",
  429: "Die Bank erlaubt gerade keine weiteren Abrufe. Bitte in ein paar Stunden nochmal.",
  502: "Die Bank bzw. Enable Banking ist gerade nicht erreichbar. Bitte später nochmal probieren.",
  503: "Die Bankverbindung ist am Server noch nicht eingerichtet (ENABLEBANKING_APP_ID / ENABLEBANKING_KEY fehlen).",
};

async function api(path, { method = "POST", body } = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new BankError("Du bist offline – für die Bank wird Internet gebraucht.");
  let token = testToken();
  if (!token) {
    const f = await getFirebase().catch(() => null);
    const u = f && f.auth && f.auth.currentUser;
    if (!u) throw new BankError("Bitte zuerst mit Google anmelden.", 401);
    token = await u.getIdToken();
  }
  let res;
  try {
    res = await fetch(serverUrl() + path, {
      method,
      headers: { Authorization: "Bearer " + token, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
    });
  } catch {
    throw new BankError("Keine Verbindung zum Server – bist du online?");
  }
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) throw new BankError((data && data.error) || STATUS_TEXT[res.status] || `Fehler ${res.status}`, res.status, data);
  return data || {};
}

function readCache() {
  try { const c = JSON.parse(lsGet(CACHE_KEY) || "null"); return c && typeof c === "object" ? c : null; } catch { return null; }
}

// Sitzungs-Zustand (überlebt Bereichswechsel)
const R = { status: readCache(), loaded: false, loading: false, busy: "", err: "", at: 0, armed: false, armTimer: null };

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  const today = M.todayKey(), k = M.keyOf(d);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (k === today) return `heute, ${hm}`;
  if (k === M.addDays(today, -1)) return `gestern, ${hm}`;
  return `${M.fmtDate(k)}, ${hm}`;
}

/**
 * opts: { ui, render }
 * → { cardHTML(), onClick(el) → bool, refresh(force) }
 */
export function createBank(opts) {
  const { ui, render } = opts;
  const cloud = () => { const s = store.get(); return (s.mode === "cloud" && !!s.user) || !!testToken(); };

  function setStatus(st) {
    R.status = st;
    R.loaded = true;
    lsSet(CACHE_KEY, JSON.stringify(st));
  }

  async function refresh(force = false) {
    if (!cloud() || R.loading) return;
    if (!force && R.at && Date.now() - R.at < REFRESH_MS) return;
    R.loading = true; R.at = Date.now();
    try {
      setStatus(await api("/bank/status", { method: "GET" }));
      R.err = "";
    } catch (err) {
      R.err = err.message || String(err);
      R.loaded = true;
    } finally {
      R.loading = false;
      render();
    }
  }

  async function connect() {
    if (R.busy) return;
    R.busy = "connect"; R.err = ""; render();
    try {
      const { url } = await api("/bank/start", { body: {} });
      if (!url || !/^https:\/\//.test(url)) throw new BankError("Keine gültige Anmelde-Adresse erhalten.");
      const B = isNative() ? plugin("Browser") : null;
      if (B) {
        await B.open({ url });
        R.busy = "";
        ui.toast("Melde dich bei BAWAG an – danach hierher zurückkehren.", 4200);
        R.at = 0;
      } else {
        window.location.assign(url);
        return; // Seite wird verlassen
      }
    } catch (err) {
      R.err = err.message || String(err);
      R.busy = "";
    }
    render();
  }

  async function sync() {
    if (R.busy) return;
    R.busy = "sync"; R.err = ""; render();
    try {
      const r = await api("/bank/sync", { body: {} });
      if (r.status) setStatus(r.status);
      if (r.error) R.err = r.error.msg || "Abgleich fehlgeschlagen.";
      else {
        const n = Number(r.imported) || 0;
        ui.toast(n ? (n === 1 ? "1 neue Buchung von der Bank 🏦" : `${n} neue Buchungen von der Bank 🏦`) : "Alles aktuell ✓", 2600);
      }
    } catch (err) {
      R.err = err.message || String(err);
    } finally {
      R.busy = "";
      render();
    }
  }

  async function unlink() {
    if (R.busy) return;
    R.busy = "unlink"; R.err = ""; render();
    try {
      await api("/bank/unlink", { body: {} });
      setStatus({ linked: false });
      ui.toast("Bankverbindung getrennt – bisherige Buchungen bleiben.", 3600);
    } catch (err) {
      R.err = err.message || String(err);
    } finally {
      R.busy = ""; R.armed = false;
      render();
    }
  }

  /* ---------- Darstellung ---------- */

  function head(sub) {
    return `<div class="bk-head">` +
      `<span class="bk-ic" aria-hidden="true">🏦</span>` +
      `<div><h3 class="mn-h" id="bk-h">Bankkonto (BAWAG)</h3>${sub ? `<small class="bk-sub">${sub}</small>` : ""}</div>` +
    `</div>`;
  }
  const errBox = () => (R.err ? `<p class="bk-err" role="alert">${esc(R.err)}</p>` : "");
  const btnLbl = (id, idle, busy) => (R.busy === id ? busy : idle);
  const dis = (id) => (R.busy ? ` disabled${R.busy === id ? ' aria-busy="true"' : ""}` : "");

  function explain() {
    return `<ul class="bk-points">` +
      `<li>🔐 Du meldest dich auf der <b>Seite von BAWAG</b> an – die App sieht dein Passwort nie.</li>` +
      `<li>👀 Nur Lesen: Kontostand und Umsätze. Überweisen kann die App nicht.</li>` +
      `<li>🔄 Neue Buchungen kommen 4× am Tag automatisch und werden gleich einer Kategorie zugeordnet.</li>` +
      `<li>📅 Die Freigabe gilt bis zu 180 Tage, dann einmal kurz erneuern – die App erinnert dich.</li>` +
    `</ul>` +
    `<p class="bk-foot">Über Enable Banking, einen in der EU zugelassenen Kontoinformationsdienst (PSD2).</p>`;
  }

  function cardHTML() {
    const st = R.status;
    // Lokaler Modus / nicht angemeldet
    if (!cloud()) {
      return `<section class="card bk-card bk-off" aria-labelledby="bk-h">${head("Nur mit Google-Anmeldung")}` +
        `<p class="bk-note">Der automatische Kontoabgleich läuft über den Server und braucht dein Google-Konto. Im lokalen Modus kannst du Buchungen wie gewohnt selbst eintragen.</p></section>`;
    }
    if (!R.loaded && !R.loading) queueMicrotask(() => refresh(true));
    if (!st && R.err && !R.busy) {
      return `<section class="card bk-card" aria-labelledby="bk-h">${head("Status unbekannt")}${errBox()}` +
        `<div class="bk-actions"><button type="button" class="btn ghost sm" data-bk="retry">Erneut versuchen</button></div></section>`;
    }
    if (!st && !R.loaded) {
      return `<section class="card bk-card" aria-labelledby="bk-h" aria-busy="true">${head("Lade Status …")}<div class="bk-skel"></div></section>`;
    }
    if (!st || !st.linked) {
      return `<section class="card bk-card" aria-labelledby="bk-h">${head("Nicht verbunden")}` +
        explain() + errBox() +
        `<div class="bk-actions"><button type="button" class="btn primary bk-main" data-bk="connect"${dis("connect")}>${btnLbl("connect", "Mit BAWAG verbinden", "Öffne BAWAG …")}</button></div>` +
      `</section>`;
    }
    const left = Number.isFinite(Number(st.daysLeft)) && st.daysLeft != null ? Number(st.daysLeft) : null;
    const expired = !!st.expired || (left != null && left < 0);
    const lvl = expired || (left != null && left < 7) ? "bad" : left != null && left < 21 ? "warn" : "ok";
    const pill = expired ? "Abgelaufen" : left == null ? "" : left === 0 ? "läuft heute ab" : left === 1 ? "noch 1 Tag" : `noch ${left} Tage`;
    const accs = st.accounts || [];
    const acc = accs.find((a) => a.main) || accs[0];
    const accTxt = acc ? `${esc(acc.name || "Konto")}${acc.iban_last4 ? ` ·· ${esc(acc.iban_last4)}` : ""}` : "";
    const bal = st.balance;
    const sub = st.lastSync ? `Aktualisiert ${esc(fmtTime(st.lastSync))}` : "Noch nicht abgeglichen";
    const lastErr = !R.err && !expired && st.lastError && st.lastError.msg ? `<p class="bk-warn" role="status">${esc(st.lastError.msg)}</p>` : "";
    return `<section class="card bk-card bk-on" aria-labelledby="bk-h">` +
      `<div class="bk-top">${head(sub)}${pill ? `<span class="bk-pill ${lvl}" title="Freigabe gültig bis ${esc(M.fmtDate(String(st.valid_until || "").slice(0, 10)))}">${esc(pill)}</span>` : ""}</div>` +
      `<div class="bk-bal">` +
        `<small>${bal ? "Kontostand" : "Kontostand noch unbekannt"}${bal && bal.at ? ` · ${esc(fmtTime(bal.at))}` : ""}</small>` +
        `<b class="${bal && bal.amount < 0 ? "neg" : ""}">${bal ? esc(M.eur(bal.amount)) : "–"}</b>` +
        (accTxt ? `<span class="bk-acc">${accTxt}</span>` : "") +
      `</div>` +
      accountsList(st, acc) +
      (expired ? `<p class="bk-err" role="alert">Die Freigabe ist abgelaufen – bitte einmal neu mit BAWAG verbinden.</p>` : left != null && left < 7 ? `<p class="bk-warn">Die Freigabe läuft bald ab – jetzt erneuern, dann geht's 180 Tage weiter.</p>` : "") +
      errBox() + lastErr +
      `<div class="bk-actions">` +
        (expired || (left != null && left < 21)
          ? `<button type="button" class="btn primary sm bk-main" data-bk="connect"${dis("connect")}>${btnLbl("connect", expired ? "Neu verbinden" : "Verbindung erneuern", "Öffne BAWAG …")}</button>`
          : "") +
        (expired ? "" : `<button type="button" class="btn ${left != null && left < 21 ? "ghost" : "primary"} sm bk-main" data-bk="sync"${dis("sync")}>${btnLbl("sync", "Jetzt aktualisieren", "Hole Buchungen …")}</button>`) +
        (expired ? "" : `<button type="button" class="btn ghost sm" data-bk="addacc"${dis("connect")}>${btnLbl("connect", "+ Sparkonto freigeben", "Öffne BAWAG …")}</button>`) +
        `<button type="button" class="btn ghost sm bk-unlink${R.armed ? " armed" : ""}" data-bk="unlink"${dis("unlink")}>${R.busy === "unlink" ? "Trenne …" : R.armed ? "Wirklich trennen?" : "Verbindung trennen"}</button>` +
      `</div>` +
      `<p class="bk-foot">🏦 Bank-Buchungen sind in der Liste markiert. Was du daran änderst, bleibt so.</p>` +
    `</section>`;
  }

  function onClick(t) {
    const a = t.dataset.bk;
    if (!a) return false;
    if (a === "connect") connect();
    else if (a === "addacc") { ui.toast("Bei BAWAG alle Konten anhaken, die die App sehen soll (z. B. Girokonto + Sparkonto).", 4200); connect(); }
    else if (a === "sync") sync();
    else if (a === "retry") refresh(true);
    else if (a === "unlink") {
      if (!R.armed) {
        R.armed = true;
        clearTimeout(R.armTimer);
        R.armTimer = setTimeout(() => { R.armed = false; render(); }, 4000);
        render();
      } else {
        clearTimeout(R.armTimer);
        unlink();
      }
    } else return false;
    return true;
  }

  // Rückmeldung von bank-callback.html (einmalig)
  const flash = lsGet(FLASH_KEY);
  if (flash) {
    lsDel(FLASH_KEY);
    try {
      const f = JSON.parse(flash);
      if (f && f.ok) setTimeout(() => ui.toast(f.msg || "Mit BAWAG verbunden ✓", 3600), 300);
      R.at = 0;
    } catch { /* egal */ }
  }
  refresh(true);

  return { cardHTML, onClick, refresh, linked: () => !!(R.status && R.status.linked), status: () => R.status };
}

/* Update 9 – Sparziele: weitere Konten (z. B. Sparkonto) unter dem Hauptkonto */
function accountsList(st, main) {
  const others = (st.accounts || []).filter((a) => a !== main);
  if (!others.length) {
    return `<details class="bk-more"><summary>Sparkonto dazunehmen?</summary>` +
      `<p>Dann kann ein Sparziel den echten Kontostand zeigen. Tippe auf „+ Sparkonto freigeben“ und hake bei BAWAG beide Konten an. ` +
      `Fehlt das Sparkonto dort, muss es zuerst im Enable-Banking-Control-Panel bei der App verknüpft werden.</p></details>`;
  }
  return `<ul class="bk-accs">` + others.map((a) => {
    const b = (st.balances && st.balances[a.uid]) || a.balance;
    return `<li><span>${esc(a.name || "Konto")}${a.iban_last4 ? ` <small>••${esc(a.iban_last4)}</small>` : ""}</span>` +
      `<b>${b && Number.isFinite(Number(b.amount)) ? esc(M.eur(b.amount)) : "–"}</b></li>`;
  }).join("") + `</ul>`;
}

/** Markierung für Bank-Buchungen in Listen. */
export function bankMark(t) {
  return t && (t.src === "bank" || t.bankRef || t.bankId) ? ` · <span class="bk-mark" title="Von der Bank übernommen">🏦 Bank</span>` : "";
}
