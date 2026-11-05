// Geld › Abos: Karte „Abos aus Gmail erkennen“ (Verbinden, Mails prüfen, Treffer übernehmen/ignorieren).
// Mails und Token bleiben im Speicher; gespeichert wird nur money_gmail/meta = {connected, lastScan, scanned, found, handled:[…]}.
import * as G from "./gmail.js";
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

  function actions() {
    if (!R.dets) return [];
    return D.planActions(R.dets, col.subs.all(), handledSet(), M.todayKey());
  }

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
        if (code !== "cancel") console.warn("Gmail-Abgleich:", err);
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
    return `<details class="gm-help"${R.helpOpen ? " open" : ""}><summary>Anleitung (einmalig einrichten)</summary>` +
      `<ol>` +
        `<li><a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=stempelkarte-40682" target="_blank" rel="noopener">Google Cloud Console</a> öffnen, Projekt <b>stempelkarte-40682</b> wählen und die <b>Gmail API</b> aktivieren.</li>` +
        `<li><b>Google Auth Platform</b> (früher „OAuth-Zustimmungsbildschirm“) → <b>Datenzugriff</b> → „Bereiche hinzufügen oder entfernen“ → <code>…/auth/gmail.readonly</code> eintragen → Aktualisieren → Speichern.</li>` +
        `<li><b>Zielgruppe</b>: Veröffentlichungsstatus <b>„Testen“</b> lassen → Testnutzer → „+ Nutzer hinzufügen“ → <b>lippa.florian@gmail.com</b> → Speichern.</li>` +
        `<li>Hier „Mit Gmail verbinden“ tippen. Google zeigt „Google hat diese App nicht überprüft“ → <b>Erweitert</b> → <b>Weiter zu stempelkarte-40682.firebaseapp.com</b> → Häkchen bei Gmail lesen setzen → Weiter.</li>` +
      `</ol>` +
      `<p class="note">Im Status „Testen“ fragt Google ungefähr wöchentlich erneut nach der Freigabe – das ist normal.</p>` +
    `</details>`;
  }

  function cardHTML() {
    const m = meta();
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
    if (R.dets) {
      body += acts.length
        ? `<ul class="gm-list" aria-label="Erkannte Abos">${acts.map(actRow).join("")}</ul>`
        : `<p class="gm-none">${icon("check", 16)} Nichts Neues – ${R.scanned} Mails geprüft, alles schon eingetragen.</p>`;
    }
    return `<section class="card gm-card" aria-labelledby="gm-h">` +
      `<div class="gm-head">` +
        `<span class="gm-ic" aria-hidden="true">${icon("mail", 22)}</span>` +
        `<div><h3 class="mn-h" id="gm-h">Abos aus Gmail erkennen</h3><small class="gm-last">${esc(lastTxt)}</small></div>` +
      `</div>` +
      `<div class="gm-actions">` +
        `<button type="button" class="btn primary sm gm-scan" data-gm="scan"${R.busy ? " disabled aria-busy=\"true\"" : ""}>${esc(btnLabel)}</button>` +
        (connected && !R.busy ? `<button type="button" class="btn ghost sm" data-gm="disconnect">Trennen</button>` : "") +
      `</div>` +
      body +
      `<p class="gm-privacy">🔒 Mails werden nur auf deinem Gerät gelesen und nicht gespeichert.</p>` +
      helpHTML() +
    `</section>`;
  }

  /** Kleiner Hinweis (Übersicht): verbunden, kein Token, ≥ 1 Woche nicht geprüft – höchstens 1× pro Woche. */
  function hintHTML() {
    const m = meta();
    if (!m.connected || R.busy || R.hintClosed || G.hasToken()) return "";
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
      case "ok": onAction("ok", t.dataset.k); break;
      case "ignore": onAction("ignore", t.dataset.k); break;
      default: return false;
    }
    return true;
  }

  // Popup vorbereiten (SDK laden), ohne ein Fenster zu öffnen
  // (nur angemeldet – im lokalen Modus wird das SDK erst beim Tippen geladen)
  try { if (store.get().user && !(typeof window !== "undefined" && window.__gmailTestToken)) G.prepare(); } catch { /* egal */ }

  return { cardHTML, hintHTML, onClick, onToggleHelp: (open) => { R.helpOpen = open; } };
}
