// Geld › Abos: Karte „Abos aus Gmail erkennen“ (Verbinden, Mails prüfen, Treffer übernehmen/ignorieren).
// Zwei Wege:
//  • „Dauerhaft verbinden (Server)“: der eigene Worker (tools/mcp/src/gmail.js) hält ein verschlüsseltes Refresh-Token,
//    prüft täglich und schreibt Erkennungen nach money_gmail/meta.serverDets (nur erkannte Felder, keine Mails).
//  • „Nur diese Sitzung“ (Browser, wie bisher): Mails und Token bleiben im Speicher.
// Gespeichert wird nur money_gmail/meta = {connected, lastScan, scanned, found, handled:[…], serverDets, serverScan}.
import * as G from "./gmail.js";
import { serverUrl, idToken, aiAvailable } from "./ai-client.js";
import { isNative, plugin } from "../native.js";
import * as D from "./subs-detect.js";
import * as M from "./money-core.js";
import * as K from "./subs-catalog.js"; // Update 9 – Abos: Katalog (Beschreibung, Kündigungslink, Anleitung)
import * as store from "../store.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";

const META_ID = "meta";
const HINT_KEY = "stempelkarte.gmail.hint";
const WEEK = 7 * 24 * 3600e3;
const MAX_HANDLED = 400;

// Sitzungs-Zustand (überlebt Tab-/Bereichswechsel, nicht das Neuladen)
const R = { dets: null, busy: false, progress: "", err: null, errMsg: "", scanned: 0, helpOpen: false, hintShown: false, hintClosed: false };

/* ---------- Server-Modus („Gmail dauerhaft verbinden“) ---------- */

const SV_CACHE = "stempelkarte.gmail.server";
const SV_REFRESH_MS = 60 * 1000;
const SV_TEXT = {
  401: "Anmeldung abgelehnt – bitte die App neu laden oder ab- und wieder anmelden.",
  403: "Der Server lehnt diese Seite ab (Herkunft nicht erlaubt).",
  404: "Der Server kennt „Gmail dauerhaft“ noch nicht – ist die neueste Version veröffentlicht?",
  409: "Gmail ist noch nicht dauerhaft verbunden.",
  503: "Gmail ist am Server noch nicht eingerichtet – siehe „Einrichtung“ unten.",
};
function svRead() { try { const c = JSON.parse(lsGet(SV_CACHE) || "null"); return c && typeof c === "object" ? c : null; } catch { return null; } }
const SV = { status: svRead(), loaded: false, loading: false, busy: "", err: "", at: 0, armed: false, armTimer: null, waiting: false, setupOpen: false };

async function svApi(path, method = "POST") {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("Du bist offline – dafür wird Internet gebraucht.");
  const token = await idToken();
  let res;
  try {
    res = await fetch(serverUrl() + path, {
      method,
      headers: { Authorization: "Bearer " + token, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: method === "POST" ? "{}" : undefined,
    });
  } catch { throw new Error("Keine Verbindung zum Server – bist du online?"); }
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) { const e = new Error((data && data.error) || SV_TEXT[res.status] || `Fehler ${res.status}`); e.status = res.status; e.data = data; throw e; }
  return data || {};
}

function fmtWhen(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  const today = M.todayKey(), k = M.keyOf(d);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (k === today) return `heute, ${hm}`;
  if (k === M.addDays(today, -1)) return `gestern, ${hm}`;
  return `${M.fmtDate(k)}, ${hm}`;
}

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const IV_SHORT = { week: "Woche", month: "Monat", quarter: "Quartal", year: "Jahr" };
const short = (key) => (M.isKey(key) ? M.fmtDate(key).slice(0, 6) : "");

function money(v, cur) {
  if (cur && cur !== "EUR") return (Number(v) || 0).toFixed(2).replace(".", ",") + " " + (cur === "USD" ? "$" : cur === "GBP" ? "£" : cur);
  return M.eur(v);
}

/**
 * opts: { col (money.js-Sammlungen inkl. gmail), ui, render, openSub(sub, preset, onSaved), catOf(id) }
 */
export function createGmail(opts) {
  const { col, ui, render } = opts;
  const meta = () => col.gmail.get(META_ID) || {};
  const handledSet = () => new Set((meta().handled || []).map((h) => (typeof h === "string" ? h : h.k)));

  async function patchMeta(partial) {
    try { await col.gmail.put({ ...meta(), ...partial, id: META_ID }); }
    catch (err) { console.warn("Gmail-Status speichern:", err); }
  }
  async function markHandled(det, how) {
    const list = (meta().handled || []).filter((h) => (typeof h === "string" ? h : h.k) !== D.handledKey(det));
    list.push({ k: D.handledKey(det), a: how, t: Date.now() });
    await patchMeta({ handled: list.slice(-MAX_HANDLED) });
  }

  const serverOn = () => aiAvailable(); // nur mit Google-Anmeldung (bzw. Test-Haken auf localhost)
  const svConnected = () => !!(serverOn() && SV.status && SV.status.connected);

  /** Erkennungen aus dieser Sitzung (Browser) + vom Server (money_gmail/meta.serverDets), pro Dienst die neueste. */
  function allDets() {
    const server = Array.isArray(meta().serverDets) ? meta().serverDets : [];
    if (!R.dets && !server.length) return null;
    const map = new Map();
    for (const d of [...server, ...(R.dets || [])]) {
      if (!d || !d.key) continue;
      const c = map.get(d.key);
      if (!c || (Number(d.mailTs) || 0) > (Number(c.mailTs) || 0)) map.set(d.key, d);
    }
    return [...map.values()].sort((a, b) => (Number(b.mailTs) || 0) - (Number(a.mailTs) || 0));
  }

  function actions() {
    const dets = allDets();
    if (!dets) return [];
    return D.planActions(dets, col.subs.all(), handledSet(), M.todayKey());
  }

  function svSet(st) {
    SV.status = st; SV.loaded = true;
    lsSet(SV_CACHE, JSON.stringify(st));
  }

  async function svRefresh(force = false) {
    if (!serverOn() || SV.loading) return;
    if (!force && SV.at && Date.now() - SV.at < SV_REFRESH_MS) return;
    SV.loading = true; SV.at = Date.now();
    try { svSet(await svApi("/gmail/status", "GET")); SV.statusErr = ""; }
    catch (err) { SV.loaded = true; SV.statusErr = err.message || String(err); } // still: Fehler erst beim Tippen zeigen
    finally { SV.loading = false; render(); }
  }

  async function svConnect() {
    if (SV.busy) return;
    // Fenster sofort aus dem Tipp heraus öffnen (Popup-Blocker), die Google-Adresse kommt gleich danach
    const B = isNative() ? plugin("Browser") : null;
    let win = null;
    if (!B) { try { win = window.open("", "_blank"); } catch { win = null; } }
    SV.busy = "connect"; SV.err = ""; render();
    try {
      const { url } = await svApi("/gmail/start");
      if (!url || !/^https:\/\/accounts\.google\.com\//.test(url)) throw new Error("Keine gültige Google-Adresse erhalten.");
      SV.waiting = true;
      if (B) await B.open({ url });
      else if (win && !win.closed) win.location.href = url;
      else { window.location.assign(url); return; }
      ui.toast("Bei Google anmelden und das Häkchen „E-Mails ansehen“ setzen – danach hierher zurückkommen.", 5200);
    } catch (err) {
      try { if (win) win.close(); } catch { /* egal */ }
      SV.err = err.message || String(err);
      if (err.status === 503) SV.setupOpen = true;
    } finally {
      SV.busy = ""; SV.at = 0;
      render();
    }
  }

  async function svScan() {
    if (SV.busy) return;
    SV.busy = "scan"; SV.err = ""; render();
    try {
      const r = await svApi("/gmail/scan");
      if (r.status) svSet(r.status);
      if (r.error) SV.err = r.error.msg || "Prüfen fehlgeschlagen.";
      else {
        const n = Number(r.pending) || 0;
        ui.toast(n ? (n === 1 ? "1 Hinweis zu deinen Abos" : `${n} Hinweise zu deinen Abos`) : `Nichts Neues – ${Number(r.mails) || 0} Mails geprüft`, 2800);
      }
    } catch (err) {
      SV.err = err.message || String(err);
    } finally { SV.busy = ""; render(); }
  }

  async function svDisconnect() {
    if (SV.busy) return;
    if (!SV.armed) {
      SV.armed = true;
      clearTimeout(SV.armTimer);
      SV.armTimer = setTimeout(() => { SV.armed = false; render(); }, 4000);
      render();
      return;
    }
    SV.busy = "disconnect"; SV.err = ""; render();
    try {
      await svApi("/gmail/disconnect");
      svSet({ configured: true, connected: false });
      ui.toast("Gmail getrennt – der Zugriff ist bei Google widerrufen.", 3600);
    } catch (err) {
      SV.err = err.message || String(err);
    } finally { SV.busy = ""; SV.armed = false; render(); }
  }

  // Nach der Google-Anmeldung (anderer Tab/Browser) beim Zurückkommen den Status neu holen
  if (typeof document !== "undefined" && !createGmail._vis) {
    createGmail._vis = true;
    const back = () => { if (document.visibilityState !== "hidden" && SV.waiting) { SV.waiting = false; SV.at = 0; createGmail._refresh && createGmail._refresh(true); } };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
  }
  createGmail._refresh = svRefresh;

  /* ---------- Scan (MUSS synchron aus dem Tipp starten) ---------- */

  function scan() {
    if (R.busy) return;
    R.busy = true; R.err = null; R.errMsg = ""; R.progress = "Verbinde mit Gmail …";
    render();
    const email = (store.get().user && store.get().user.email) || "";
    // connectGmail() öffnet das Popup sofort – kein await davor (Popup-Blocker)
    const p = G.connectGmail(email);
    (async () => {
      try {
        await p;
        if (!meta().connected) await patchMeta({ connected: true });
        R.progress = "Suche passende Mails …"; render();
        const mails = await G.fetchMails({ onProgress: (d, n) => { R.progress = n ? `Prüfe Mails … ${d}/${n}` : "Keine passenden Mails"; render(); } });
        R.scanned = mails.length;
        R.dets = D.detectAll(mails, { today: M.todayKey() });
        await patchMeta({ connected: true, lastScan: Date.now(), scanned: mails.length, found: R.dets.length });
        const n = actions().length;
        ui.toast(n ? (n === 1 ? "1 Hinweis zu deinen Abos" : `${n} Hinweise zu deinen Abos`) : "Nichts Neues gefunden", 2600);
      } catch (err) {
        const code = (err && err.code) || "net";
        if (code !== "cancel" && code !== "auth") console.warn("Gmail-Abgleich:", err);
        R.err = code;
        R.errMsg = (err && err.message) || G.ERR_TEXT.net;
        if (code === "scope") R.helpOpen = true;
        if (code !== "cancel" && code !== "popup") R.dets = null;
      } finally {
        R.busy = false; R.progress = "";
        render();
      }
    })();
  }

  async function disconnect() {
    G.forgetToken();
    R.dets = null; R.err = null;
    await patchMeta({ connected: false });
    ui.toast("Gmail getrennt. Den Zugriff kannst du unter myaccount.google.com → Sicherheit → Drittanbieter-Apps ganz entziehen.", 5200);
  }

  /* ---------- Übernehmen / Ignorieren ---------- */

  const findAct = (k) => actions().find((a) => a.det.key === k);

  async function onAction(what, k) {
    const act = findAct(k);
    if (!act) return;
    const d = act.det;
    try {
      if (what === "ignore") {
        await markHandled(d, "ignored");
        ui.toast("Ignoriert – kommt nicht wieder");
        return;
      }
      if (act.type === "new") {
        const base = D.subFromDet(d, M.todayKey());
        const hit = K.matchCatalog(d.service);
        const preset = { ...base, ...K.catalogFill(base, hit && hit.entry) };
        if (!(d.amount > 0) || (d.currency && d.currency !== "EUR")) {
          // Betrag fehlt oder ist keine Euro-Angabe → Blatt zum Prüfen öffnen
          opts.openSub(null, { ...preset, amount: d.amount || "" }, () => markHandled(d, "accepted"));
          return;
        }
        await col.subs.put(preset);
        await markHandled(d, "accepted");
        ui.toast(`${d.service} als Abo eingetragen ✓`);
      } else if (act.type === "price") {
        const s = act.sub;
        const hist = Array.isArray(s.priceHistory) ? s.priceHistory.slice(-20) : [];
        hist.push({ amount: s.amount, until: d.nextDate || d.mailDate });
        await col.subs.patch(s.id, { amount: d.amount, priceHistory: hist });
        await markHandled(d, "accepted");
        ui.toast(`Preis von ${s.name} auf ${M.eur(d.amount)} geändert ✓`);
      } else if (act.type === "cancel") {
        const s = act.sub;
        await col.subs.patch(s.id, { paused: true, ended: d.nextDate || d.mailDate, endedAt: Date.now(), cancelledOn: s.cancelledOn || d.mailDate });
        await markHandled(d, "accepted");
        ui.toast(`${s.name} beendet – bisherige Buchungen bleiben`);
      } else if (act.type === "trial") {
        const date = D.trialRemindDate(d.nextDate, M.todayKey());
        await store.saveTodo({
          title: `${d.service}: Testzeitraum endet am ${short(d.nextDate)} – kündigen oder behalten?`,
          kind: "todo", date, time: "09:00", remind: true, remindMin: 0, done: false,
          note: `Aus Gmail erkannt${d.amount ? ` – danach ${money(d.amount, d.currency)}/${IV_SHORT[d.interval] || "Monat"}` : ""}.`,
        });
        // Passendes Abo kennt jetzt das Testende (Status „Testzeitraum endet in N Tagen“); keine zweite Erinnerung
        if (act.sub && M.isKey(d.nextDate)) {
          await col.subs.patch(act.sub.id, { contractType: "Testzeitraum", trialEnd: d.nextDate, remindedFor: M.addDays(d.nextDate, -1) }).catch((e) => console.warn(e));
        }
        await markHandled(d, "accepted");
        ui.toast(`Erinnerung am ${M.fmtDate(date)} angelegt ✓`, 3000);
      }
    } catch (err) {
      console.error(err);
      ui.toast("Speichern fehlgeschlagen: " + ((err && err.message) || err), 4000);
    }
  }

  /* ---------- Darstellung ---------- */

  function actRow(a) {
    const d = a.det;
    const c = opts.catOf(d.category || "abos");
    const per = `/${IV_SHORT[d.interval] || "Monat"}`;
    const price = d.amount ? `${money(d.amount, d.currency)}${per}` : "Betrag unbekannt";
    let title, line, ok;
    if (a.type === "new") {
      title = `Neues Abo erkannt: <b>${esc(d.service)}</b>`;
      line = `${esc(price)}${d.nextDate ? ` · nächste Zahlung ${esc(short(d.nextDate))}` : ""}`;
      ok = d.amount > 0 && (!d.currency || d.currency === "EUR") ? "Übernehmen" : "Prüfen & übernehmen";
    } else if (a.type === "price") {
      title = `Preis geändert: <b>${esc(a.sub.name)}</b>`;
      line = `${esc(money(d.amount, d.currency))} statt ${esc(M.eur(a.sub.amount))} – aktualisieren?`;
      ok = "Aktualisieren";
    } else if (a.type === "cancel") {
      title = `Gekündigt erkannt: <b>${esc(a.sub.name)}</b>`;
      line = `${d.nextDate ? `läuft bis ${esc(short(d.nextDate))} · ` : ""}Abo beenden?`;
      ok = "Abo beenden";
    } else {
      title = `Testzeitraum <b>${esc(d.service)}</b> endet am ${esc(short(d.nextDate))}`;
      line = `${d.amount ? `danach ${esc(price)} · ` : ""}Erinnerung?`;
      ok = "Erinnern";
    }
    const src = `Mail vom ${esc(M.fmtDate(d.mailDate))}${d.via ? ` · über ${esc(d.via)}` : ""}${d.confidence < 0.7 ? " · unsicher" : ""}`;
    return `<li class="gm-item gm-${a.type}" data-key="${esc(d.key)}">` +
      `<span class="mn-bub" style="--c:${esc(c.color || "#8b5cf6")}" aria-hidden="true">${esc(c.emoji || "📺")}</span>` +
      `<div class="gm-txt"><p>${title}</p><p class="gm-line">${line}</p><small>${src}</small></div>` +
      `<div class="gm-btns">` +
        `<button type="button" class="btn primary sm" data-gm="ok" data-k="${esc(d.key)}">${esc(ok)}</button>` +
        `<button type="button" class="btn ghost sm" data-gm="ignore" data-k="${esc(d.key)}">Ignorieren</button>` +
      `</div>` +
    `</li>`;
  }

  function helpHTML() {
    return `<details class="gm-help"${R.helpOpen ? " open" : ""}><summary>${serverOn() ? "Anleitung „nur diese Sitzung“" : "Anleitung (einmalig einrichten)"}</summary>` +
      `<ol>` +
        `<li><a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=stempelkarte-40682" target="_blank" rel="noopener">Google Cloud Console</a> öffnen, Projekt <b>stempelkarte-40682</b> wählen und die <b>Gmail API</b> aktivieren.</li>` +
        `<li><b>Google Auth Platform</b> (früher „OAuth-Zustimmungsbildschirm“) → <b>Datenzugriff</b> → „Bereiche hinzufügen oder entfernen“ → <code>…/auth/gmail.readonly</code> eintragen → Aktualisieren → Speichern.</li>` +
        `<li><b>Zielgruppe</b>: Veröffentlichungsstatus <b>„Testen“</b> lassen → Testnutzer → „+ Nutzer hinzufügen“ → <b>lippa.florian@gmail.com</b> → Speichern.</li>` +
        `<li>Hier „Mit Gmail verbinden“ tippen. Google zeigt „Google hat diese App nicht überprüft“ → <b>Erweitert</b> → <b>Weiter zu stempelkarte-40682.firebaseapp.com</b> → Häkchen bei Gmail lesen setzen → Weiter.</li>` +
      `</ol>` +
      `<p class="note">Im Status „Testen“ fragt Google ungefähr wöchentlich erneut nach der Freigabe – das ist normal.</p>` +
    `</details>`;
  }

  function setupHTML() {
    return `<details class="gm-help gm-setup"${SV.setupOpen ? " open" : ""}><summary>Einrichtung „dauerhaft“ (einmalig in der Google Cloud Console)</summary>` +
      `<ol>` +
        `<li><a href="https://console.cloud.google.com/apis/credentials?project=stempelkarte-40682" target="_blank" rel="noopener">APIs &amp; Dienste → Anmeldedaten</a> → OAuth-2.0-Client <b>„Web client (auto created by Google Service)“</b> öffnen (oder einen neuen <b>Webanwendung</b>-Client anlegen).</li>` +
        `<li>Bei <b>Autorisierte Weiterleitungs-URIs</b> „+ URI hinzufügen“: <code>https://stempelkarte-mcp.lippa-florian.workers.dev/gmail/callback</code> → Speichern.</li>` +
        `<li><b>Client-ID</b> und <b>Clientschlüssel</b> kopieren und auf GitHub (Repository → Settings → Secrets and variables → Actions) als <code>GOOGLE_OAUTH_CLIENT_ID</code> und <code>GOOGLE_OAUTH_CLIENT_SECRET</code> eintragen.</li>` +
        `<li>Secret <code>GMAIL_ENC_KEY</code> anlegen: beliebiger Zufallstext mit <b>40+ Zeichen</b> (später nicht mehr ändern). Danach unter Actions „MCP-Connector veröffentlichen“ → Run workflow.</li>` +
      `</ol>` +
      `<p class="note">Gmail API und der Bereich <code>gmail.readonly</code> müssen wie beim Sitzungs-Modus freigegeben sein. Steht die App bei Google auf „Testen“, läuft die Freigabe nach 7 Tagen ab – unter <b>Zielgruppe → App veröffentlichen</b> bleibt sie dauerhaft.</p>` +
    `</details>`;
  }

  const svPrivacy = () => `<p class="gm-privacy">🔒 Nur Lesen. Das Google-Token liegt <b>verschlüsselt auf deinem eigenen Server</b>; gespeichert werden nur erkannte Abo-Daten, keine Mails. Widerrufen jederzeit mit „Trennen“ oder unter <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>.</p>`;
  const svDis = (id) => (SV.busy ? ` disabled${SV.busy === id ? ' aria-busy="true"' : ""}` : "");

  function listHTML(acts, noneText) {
    if (acts.length) return `<ul class="gm-list" aria-label="Erkannte Abos">${acts.map(actRow).join("")}</ul>`;
    return noneText ? `<p class="gm-none">${icon("check", 16)} ${esc(noneText)}</p>` : "";
  }

  function head(sub) {
    return `<div class="gm-head">` +
      `<span class="gm-ic" aria-hidden="true">${icon("mail", 22)}</span>` +
      `<div><h3 class="mn-h" id="gm-h">Abos aus Gmail erkennen</h3><small class="gm-last">${sub}</small></div>` +
    `</div>`;
  }

  /** Karte im verbundenen Server-Modus. */
  function serverCardHTML(st) {
    const acts = actions();
    const since = st.connectedAt ? M.fmtDate(M.keyOf(new Date(Number(st.connectedAt)))) : "";
    const sub = `${st.needsReconnect ? "Freigabe abgelaufen" : `Dauerhaft verbunden${since ? ` seit ${esc(since)}` : ""}`} · ${st.lastScan ? `zuletzt geprüft ${esc(fmtWhen(st.lastScan))}` : "noch nicht geprüft"}`;
    const lr = st.lastResult || {};
    let body = "";
    if (st.needsReconnect) {
      body += `<p class="gm-err" role="alert">Die dauerhafte Freigabe ist abgelaufen oder wurde bei Google widerrufen. Bitte einmal neu verbinden.</p>`;
    } else if (st.lastError && st.lastError.msg && !SV.err) {
      body += `<p class="gm-warn" role="status">${esc(st.lastError.msg)}</p>`;
    }
    if (SV.err) body += `<p class="gm-err" role="alert">${esc(SV.err)}</p>`;
    const none = R.dets ? `Nichts Neues – ${R.scanned} Mails geprüft, alles schon eingetragen.`
      : st.lastScan && !st.needsReconnect ? `Nichts Neues${lr.mails != null ? ` – zuletzt ${lr.mails} Mails geprüft` : ""}. Neue Abo-Mails werden jeden Morgen automatisch geprüft.` : "";
    body += listHTML(acts, none);
    return `<section class="card gm-card gm-server" aria-labelledby="gm-h">` +
      head(sub) +
      `<div class="gm-actions">` +
        (st.needsReconnect
          ? `<button type="button" class="btn primary sm gm-scan" data-gm="sv-connect"${svDis("connect")}>${SV.busy === "connect" ? "Öffne Google …" : "Gmail neu verbinden"}</button>`
          : `<button type="button" class="btn primary sm gm-scan" data-gm="sv-scan"${svDis("scan")}>${SV.busy === "scan" ? "Prüfe Mails …" : "Jetzt prüfen"}</button>`) +
        `<button type="button" class="btn ghost sm gm-unlink${SV.armed ? " armed" : ""}" data-gm="sv-disconnect"${svDis("disconnect")}>${SV.busy === "disconnect" ? "Trenne …" : SV.armed ? "Wirklich trennen?" : "Trennen"}</button>` +
      `</div>` +
      body + svPrivacy() +
    `</section>`;
  }

  function cardHTML() {
    const m = meta();
    const server = serverOn();
    if (server && !SV.loaded && !SV.loading) queueMicrotask(() => svRefresh(true));
    else if (server && SV.loaded && !SV.loading) queueMicrotask(() => svRefresh(false));
    if (svConnected()) return serverCardHTML(SV.status);

    const acts = actions();
    const connected = !!m.connected;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const last = m.lastScan ? new Date(m.lastScan) : null;
    const lastTxt = last
      ? `Zuletzt geprüft: ${M.fmtDate(M.keyOf(last))}, ${String(last.getHours()).padStart(2, "0")}:${String(last.getMinutes()).padStart(2, "0")}${m.scanned != null ? ` · ${m.scanned} Mails` : ""}`
      : connected ? "Verbunden – noch nicht geprüft" : "Noch nicht verbunden";
    const btnLabel = R.busy ? R.progress || "Prüfe …" : connected ? "Mails prüfen" : "Mit Gmail verbinden";
    let body = "";
    if (R.err && R.err !== "cancel") {
      body += `<p class="gm-err" role="alert">${esc(R.errMsg)}${R.err === "scope" ? ` <button type="button" class="gm-link" data-gm="help">Anleitung öffnen</button>` : ""}</p>`;
    } else if (offline && !R.busy) {
      body += `<p class="gm-warn">Du bist offline – zum Prüfen wird Internet gebraucht.</p>`;
    }
    if (allDets()) body += listHTML(acts, R.dets ? `Nichts Neues – ${R.scanned} Mails geprüft, alles schon eingetragen.` : "");

    const sessionActions = `<div class="gm-actions">` +
        `<button type="button" class="btn ${server ? "ghost" : "primary"} sm gm-scan" data-gm="scan"${R.busy ? " disabled aria-busy=\"true\"" : ""}>${esc(btnLabel)}</button>` +
        (connected && !R.busy ? `<button type="button" class="btn ghost sm" data-gm="disconnect">Trennen</button>` : "") +
      `</div>`;
    const sessionPrivacy = `<p class="gm-privacy">🔒 Mails werden nur auf deinem Gerät gelesen und nicht gespeichert.</p>`;

    if (!server) {
      return `<section class="card gm-card" aria-labelledby="gm-h">` + head(esc(lastTxt)) + sessionActions + body + sessionPrivacy + helpHTML() + `</section>`;
    }
    const svErr = SV.err ? `<p class="gm-err" role="alert">${esc(SV.err)}</p>` : "";
    const lastErr = !SV.err && SV.status && SV.status.lastError && SV.status.lastError.msg ? `<p class="gm-warn" role="status">${esc(SV.status.lastError.msg)}</p>` : "";
    return `<section class="card gm-card" aria-labelledby="gm-h">` +
      head(esc(connected || last ? lastTxt : "Noch nicht verbunden")) +
      `<div class="gm-mode gm-mode-server">` +
        `<p class="gm-mode-h"><b>Dauerhaft verbinden (Server)</b> <span class="gm-tag">empfohlen</span></p>` +
        `<p class="gm-mode-t">Einmal freigeben – danach prüft dein Server jeden Morgen selbst nach neuen Abos, Preisänderungen und Testzeiträumen. Auch der Assistent kann dann auf Nachfrage Mails suchen.</p>` +
        `<button type="button" class="btn primary gm-main" data-gm="sv-connect"${svDis("connect")}>${SV.busy === "connect" ? "Öffne Google …" : "Gmail dauerhaft verbinden"}</button>` +
        svErr + lastErr + svPrivacy() +
      `</div>` +
      body +
      `<div class="gm-mode gm-mode-session">` +
        `<p class="gm-mode-h"><b>Nur diese Sitzung</b></p>` +
        sessionActions + sessionPrivacy +
      `</div>` +
      setupHTML() + helpHTML() +
    `</section>`;
  }

  /** Kleiner Hinweis (Übersicht): verbunden, kein Token, ≥ 1 Woche nicht geprüft – höchstens 1× pro Woche. */
  function hintHTML() {
    const m = meta();
    if (!m.connected || R.busy || R.hintClosed || G.hasToken() || svConnected()) return "";
    if (m.lastScan && Date.now() - m.lastScan < WEEK) return "";
    if (!R.hintShown) {
      const lastHint = Number(lsGet(HINT_KEY)) || 0;
      if (Date.now() - lastHint < WEEK) return "";
      R.hintShown = true;
      lsSet(HINT_KEY, String(Date.now()));
    }
    return `<div class="gm-hint" role="status">${icon("mail", 18)}<span>Schon länger nicht nach neuen Abos gesucht.</span>` +
      `<button type="button" class="btn primary sm" data-gm="hintscan">Mails prüfen</button>` +
      `<button type="button" class="gm-x" data-gm="hintclose" aria-label="Hinweis schließen">×</button></div>`;
  }

  /** Klick-Weiche: true, wenn behandelt. */
  function onClick(t) {
    const a = t.dataset.gm;
    if (!a) return false;
    switch (a) {
      case "scan": scan(); break;
      case "hintscan": R.hintClosed = true; scan(); opts.goSubs && opts.goSubs(); break;
      case "hintclose": R.hintClosed = true; render(); break;
      case "disconnect": disconnect(); break;
      case "help": R.helpOpen = true; render(); { const d = document.querySelector(".gm-help"); if (d) { d.open = true; d.scrollIntoView({ block: "nearest", behavior: "smooth" }); } } break;
      case "sv-connect": svConnect(); break;
      case "sv-scan": svScan(); break;
      case "sv-disconnect": svDisconnect(); break;
      case "sv-retry": svRefresh(true); break;
      case "ok": onAction("ok", t.dataset.k); break;
      case "ignore": onAction("ignore", t.dataset.k); break;
      default: return false;
    }
    return true;
  }

  // Popup vorbereiten (SDK laden), ohne ein Fenster zu öffnen
  // (nur angemeldet – im lokalen Modus wird das SDK erst beim Tippen geladen)
  try { if (store.get().user && !(typeof window !== "undefined" && window.__gmailTestToken)) G.prepare(); } catch { /* egal */ }

  return {
    cardHTML, hintHTML, onClick, refresh: svRefresh,
    onToggleHelp: (open, el) => { if (el && el.classList.contains("gm-setup")) SV.setupOpen = open; else R.helpOpen = open; },
  };
}
