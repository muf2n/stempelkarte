// Update 10 – Alltag › 💼 Buchhaltung (#alltag/buchhaltung[/<tab>[/<id>]]) – optionales Modul (standardmäßig aus).
// Einfache Aufzeichnungen für österreichische Kleinunternehmen: Belege (E/A-Rechnung nach Zahlungsdatum), Rechnungen mit
// fortlaufender Nummer (Storno statt Löschen), Auswertungen (Gewinn, USt-Zahllast als Orientierung, Kleinunternehmer-Grenze),
// Export für die Steuerberatung (CSV, Excel, Jahres-PDF, Belege-Liste). Gedächtnisstütze – ersetzt keine Steuerberatung.
// Beleg-Dateien landen verschlüsselt in 📁 Dokumente (Verknüpfung „beleg“). Reine Logik: ./buch-core.js, Kennzahlen: ./buch-rules.js.
// 🔒 „Mit Geld-Sperre schützen“ (Standard an): der ganze Bereich hängt hinter der Geld-Sperre (money-lock.js guard).
// Nicht für die Assistenten-Werkzeuge freigegeben (kein Server-Werkzeug).
import { collection, newId } from "./db.js";
import * as B from "./buch-core.js";
import { INFO, RULES_CHECKED, rule } from "./buch-rules.js";
import * as A from "./akten-ui.js";
import * as DS from "./dokumente-store.js";
import * as Sess from "./vault-session.js";
import * as F from "./doc-files.js";
import { dataUrlBytes } from "./dokumente-crypt.js";
import { normContact, displayName } from "./kontakte-core.js";
import { askClaude, aiAvailable } from "./ai-client.js";
import { guard as lockGuard } from "./money-lock.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";
import { download } from "../export.js";
import { buildXlsx, XLSX_MIME } from "../xlsx.js";

const PRINT_ID = "bu-print-root";
const TABS = [["home", "🏠 Übersicht"], ["belege", "📒 Belege"], ["rechnungen", "🧾 Rechnungen"], ["auswertung", "📊 Auswertung"], ["export", "📤 Export"], ["info", "ℹ️ Gut zu wissen"], ["setup", "⚙️ Firma"]];
const DISCLAIMER = "Gedächtnisstütze für deine Aufzeichnungen – ersetzt keine Steuerberatung und ist keine zertifizierte Buchhaltungssoftware.";

function injectCSS() {
  if (document.getElementById("bu-css")) return;
  const l = document.createElement("link");
  l.id = "bu-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-buch.css", import.meta.url).href;
  document.head.appendChild(l);
}

/** Außen: Einstellungen laden → mit oder ohne Geld-Sperre einhängen (wechselt live, wenn die Einstellung geändert wird). */
export function mount(el, ctx) {
  injectCSS(); A.injectCSS();
  const setCol = collection("buch_settings");
  let inner = null, mode = null, alive = true, ready = false;
  el.innerHTML = `<div class="al-loading">Lade …</div>`;
  function apply() {
    if (!alive || (!setCol.loaded && !ready)) return;
    const w = B.normSettings(setCol.get("main")).lockWithMoney ? "lock" : "open";
    if (w === mode) return;
    if (inner) { try { inner(); } catch (e) { console.error(e); } inner = null; }
    mode = w;
    el.innerHTML = "";
    inner = w === "lock" ? lockGuard(el, ctx, mountBuch, { banner: false, lockTitle: "Buchhaltung ist gesperrt" }) : mountBuch(el, ctx);
  }
  const off = setCol.watch(() => queueMicrotask(apply));
  A.whenLoaded(setCol).then(() => { ready = true; apply(); });
  return () => { alive = false; off(); if (inner) { try { inner(); } catch (e) { console.error(e); } } inner = null; el.innerHTML = ""; };
}

function mountBuch(el) {
  const col = { set: collection("buch_settings"), bel: collection("buch_belege"), inv: collection("buch_rechnungen"), kt: collection("kontakte") };
  const now = new Date();
  const S = { tab: "home", year: now.getFullYear(), belType: "", q: "", invFilter: "", by: "quarter", openedFor: "" };
  let alive = true, queued = false, built = "", setupLoaded = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };
  const today = () => A.todayKey();
  const st = () => B.normSettings(col.set.get("main"));
  const belege = () => col.bel.all().map(B.normBeleg).filter((b) => b.id);
  const invoices = () => col.inv.all().map(B.normInvoice).filter((i) => i.id);
  const sheets = new Set();
  const openSheet = (o) => { const sh = ui.openSheet(o); sheets.add(sh); return sh; };
  const saveSettings = (patch) => col.set.put({ ...(col.set.get("main") || {}), ...patch, id: "main", updated: Date.now() });

  el.innerHTML = `<div class="ak bu">
    <div class="bu-tabs" role="tablist" aria-label="Buchhaltung">${TABS.map(([id, t]) => `<a role="tab" class="chip bu-tab" data-tab="${id}" href="#alltag/buchhaltung${id === "home" ? "" : "/" + id}">${t}</a>`).join("")}</div>
    <div class="bu-body"></div></div>`;
  const body = el.querySelector(".bu-body");

  function readRoute() {
    const r = B.route(location.hash);
    if (r.tab === "beleg") return { tab: "belege", beleg: r.id };
    if (r.tab === "rechnung") return { tab: "rechnungen", inv: r.id };
    return { tab: TABS.some((t) => t[0] === r.tab) ? r.tab : "home" };
  }

  /* ---------- Rendern ---------- */

  function render() {
    const r = readRoute();
    S.tab = r.tab;
    el.querySelectorAll(".bu-tab").forEach((t) => { const on = t.dataset.tab === S.tab; t.setAttribute("aria-selected", String(on)); t.setAttribute("aria-pressed", String(on)); });
    const key = S.tab + (r.inv ? ":" + r.inv : "");
    if (S.tab === "belege") renderBelege(key !== built);
    else if (S.tab === "setup") {
      // Formular nur neu aufbauen, wenn nötig (sonst gingen Eingaben bei jeder Daten-Änderung verloren)
      if (key !== built || (!setupLoaded && col.set.loaded)) { setupLoaded = col.set.loaded; body.innerHTML = setupHTML(); bindSetup(); }
    } else if (S.tab === "rechnungen" && r.inv) body.innerHTML = invoiceDetailHTML(r.inv);
    else body.innerHTML = ({ home: homeHTML, rechnungen: invoicesHTML, auswertung: reportHTML, export: exportHTML, info: infoHTML }[S.tab] || homeHTML)();
    built = key;
    if (r.beleg && S.openedFor !== r.beleg && col.bel.loaded) {
      S.openedFor = r.beleg;
      const b = col.bel.get(r.beleg);
      if (b) openBeleg(B.normBeleg(b)); else ui.toast("Beleg nicht gefunden.");
    }
  }

  const yearNav = (act = "year") => `<div class="bu-year"><button type="button" class="btn ghost sm" data-bu="${act}-" aria-label="Vorheriges Jahr">${icon("chevron-left", 18)}</button><b>${S.year}</b><button type="button" class="btn ghost sm" data-bu="${act}+" aria-label="Nächstes Jahr">${icon("chevron-right", 18)}</button></div>`;
  const disclaimer = () => `<p class="bu-disc" role="note">📒 ${esc(DISCLAIMER)}</p>`;
  const kpi = (label, c, cls = "") => `<div class="bu-kpi ${cls}"><small>${esc(label)}</small><b>${esc(B.eur(c))}</b></div>`;

  function kuBar(year) {
    const p = B.kuProgress(belege(), invoices(), year);
    const w = Math.min(100, (p.sum / p.tolLimit) * 100);
    const lim = (p.limit / p.tolLimit) * 100;
    const txt = { ok: "Alles entspannt 😊", near: "Du näherst dich der Grenze – im Auge behalten 👀", tolerance: "Über 55.000 €, aber noch in der 10-%-Toleranz: ab nächstem Jahr USt-pflichtig. Bitte mit der Steuerberatung reden.", over: "Über der Toleranzgrenze: ab jetzt USt-pflichtig! Bitte sofort mit der Steuerberatung reden." }[p.state];
    return `<section class="ak-card-s bu-ku bu-ku-${p.state}"><h3>🏷️ Kleinunternehmer-Grenze ${year}</h3>
      <div class="bu-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${p.limit}" aria-valuenow="${p.sum}" aria-label="Umsatz im Verhältnis zur Grenze"><span class="bu-bar-f" style="width:${w.toFixed(1)}%"></span><span class="bu-bar-l" style="left:${lim.toFixed(1)}%"></span></div>
      <p class="bu-ku-n"><b>${esc(B.eur(p.sum))}</b> von ${esc(B.eur(p.limit))} brutto (${String(p.pct).replace(".", ",")} %) · Toleranz bis ${esc(B.eur(p.tolLimit))}</p>
      <p class="note">${esc(txt)} Gezählt: Einnahmen nach Zahlungsdatum + offene Rechnungen des Jahres – Orientierung, keine Prüfung.</p></section>`;
  }

  function dueListHTML(max = 6) {
    const due = B.dueInvoices(invoices(), today(), 3);
    if (!due.length) return `<p class="note">Keine offenen Rechnungen – fein! ☕</p>`;
    return `<ul class="bu-due">${due.slice(0, max).map((d) => `<li><a href="${esc(d.hash)}" class="bu-due-i${d.overdue ? " bad" : d.soon ? " soon" : ""}"><span><b>${esc(d.number)}</b> ${esc(d.customer || "")}</span>` +
      `<span class="bu-due-r"><b>${esc(B.eur(d.gross))}</b><small>${d.overdue ? `⚠️ ${-d.days} ${-d.days === 1 ? "Tag" : "Tage"} überfällig` : d.days === 0 ? "heute fällig" : `fällig ${esc(B.fmtKey(d.dueDate))}`}</small></span></a></li>`).join("")}</ul>`;
  }

  function homeHTML() {
    const s = st();
    const y = now.getFullYear();
    const ys = B.sums(belege(), { ku: s.kleinunternehmer, ...B.periodRange(y, "year") });
    const q = Math.ceil((now.getMonth() + 1) / 3);
    const qs = B.sums(belege(), { ku: s.kleinunternehmer, ...B.periodRange(y, "quarter", q) });
    const recent = belege().sort((a, b) => b.date.localeCompare(a.date) || b.updated - a.updated).slice(0, 5);
    return `${!s.setupDone ? `<section class="ak-card-s bu-setup-cta"><h3>👋 Los geht's</h3><p>Trag zuerst deine Firmendaten ein (Name, Adresse, Kleinunternehmer ja/nein, Bankverbindung) – die landen dann automatisch auf jeder Rechnung.</p><a class="btn primary sm" href="#alltag/buchhaltung/setup">⚙️ Firma einrichten</a></section>` : ""}
      <div class="bu-quick">
        <button type="button" class="btn primary" data-bu="new-out">${icon("plus", 18)}<span>Ausgabe</span></button>
        <button type="button" class="btn ghost" data-bu="new-in">${icon("plus", 18)}<span>Einnahme</span></button>
        <button type="button" class="btn ghost" data-bu="new-inv">🧾 <span>Neue Rechnung</span></button>
      </div>
      <section class="ak-card-s"><h3>📅 ${y} bisher <small class="note">(nach Zahlungsdatum)</small></h3>
        <div class="bu-kpis">${kpi("Einnahmen", ys.income, "in")}${kpi("Ausgaben", ys.expense, "out")}${kpi("Gewinn (E/A)", ys.profit, ys.profit < 0 ? "neg" : "pos")}${s.kleinunternehmer ? "" : kpi(`USt-Zahllast Q${q} (Orientierung)`, qs.zahllast)}</div>
        <p class="note">${s.kleinunternehmer ? "Kleinunternehmer: Beträge brutto, ohne Vorsteuerabzug." : "Beträge netto (USt als durchlaufender Posten)."}</p></section>
      ${s.kleinunternehmer ? kuBar(y) : ""}
      <section class="ak-card-s"><h3>⏳ Offene Rechnungen</h3>${dueListHTML()}</section>
      <section class="ak-card-s"><h3>📒 Zuletzt gebucht</h3>${recent.length ? `<ul class="bu-list">${recent.map(belegRow).join("")}</ul>` : `<p class="note">Noch nichts gebucht. Tipp: Kassenbon gleich nach dem Einkauf abfotografieren 📸</p>`}</section>
      ${disclaimer()}`;
  }

  function belegRow(b) {
    const c = B.catById(b.cat);
    return `<li><button type="button" class="bu-row" data-bu="beleg" data-id="${esc(b.id)}"><span class="bu-row-e" aria-hidden="true">${b.type === "in" ? "💶" : c.e}</span>` +
      `<span class="bu-row-t"><b>${esc(b.partner || b.note || c.label)}</b><small>${esc([B.fmtKey(b.date), c.label, B.fmtRate(b.rate), b.invoiceId ? "aus Rechnung" : "", b.docIds.length ? "📎" : ""].filter(Boolean).join(" · "))}</small></span>` +
      `<span class="bu-row-a ${b.type}">${b.type === "in" ? "+" : "−"}${esc(B.eur(b.gross))}</span></button></li>`;
  }

  function renderBelege(rebuild) {
    if (rebuild || !body.querySelector(".bu-bdyn")) {
      body.innerHTML = `<div class="bu-tools">${yearNav()}
        <label class="ak-search"><span class="sr">Belege suchen</span><input id="bu-q" type="search" placeholder="🔎 Händler, Notiz, Kategorie …" autocomplete="off" value="${esc(S.q)}"></label>
        <div class="bu-quick"><button type="button" class="btn primary sm" data-bu="new-out">${icon("plus", 16)}<span>Ausgabe</span></button><button type="button" class="btn ghost sm" data-bu="new-in">${icon("plus", 16)}<span>Einnahme</span></button></div></div>
        <div class="bu-bdyn"></div>${disclaimer()}`;
      body.querySelector("#bu-q").addEventListener("input", (ev) => { S.q = ev.target.value; renderBelege(false); });
    }
    const s = st();
    const q = S.q.trim().toLowerCase();
    const all = belege().filter((b) => B.yearOf(b.date) === S.year);
    const list = all.filter((b) => (!S.belType || b.type === S.belType) && (!q || B.belegSearchText(b).toLowerCase().includes(q) || B.plain(b.gross).includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.updated - a.updated);
    const sm = B.sums(list, { ku: s.kleinunternehmer });
    const months = new Map();
    for (const b of list) { const m = B.monthOf(b.date); if (!months.has(m)) months.set(m, []); months.get(m).push(b); }
    body.querySelector(".bu-bdyn").innerHTML = `<div class="ak-chips" role="group" aria-label="Art">${[["", "Alle"], ["out", "Ausgaben"], ["in", "Einnahmen"]].map(([id, t]) => `<button type="button" class="chip" data-bu="btype" data-v="${id}" aria-pressed="${S.belType === id}">${t} <span class="ak-cn">${id ? all.filter((b) => b.type === id).length : all.length}</span></button>`).join("")}</div>
      <p class="bu-sumline"><span>Einnahmen <b>${esc(B.eur(sm.income))}</b></span><span>Ausgaben <b>${esc(B.eur(sm.expense))}</b></span><span>Gewinn <b>${esc(B.eur(sm.profit))}</b></span></p>
      ${list.length ? [...months.entries()].map(([m, arr]) => `<section class="bu-month"><h3>${esc(B.MONTHS[m - 1])}</h3><ul class="bu-list">${arr.map(belegRow).join("")}</ul></section>`).join("")
        : col.bel.loaded ? A.emptyHTML("📒", all.length ? "Nichts gefunden" : `Noch keine Belege ${S.year}`, all.length ? "Probier ein anderes Wort. 🤔" : "Jede Ausgabe und Einnahme mit Zahlungsdatum – so stimmt deine Einnahmen-Ausgaben-Rechnung. Kassenbon? Foto machen und 🤖 auslesen lassen.", all.length ? "" : "＋ Erste Ausgabe", "new-out") : `<p class="note">Lade …</p>`}`;
  }

  function invoicesHTML() {
    const t = today();
    const all = invoices().filter((i) => !i.date || B.yearOf(i.date) === S.year || i.status === "entwurf" || (i.status === "offen"));
    const filters = [["", "Alle"], ["entwurf", "📝 Entwürfe"], ["offen", "⏳ Offen"], ["ueberfaellig", "⚠️ Überfällig"], ["bezahlt", "✅ Bezahlt"], ["storniert", "🚫 Storniert"]];
    const stOf = (i) => B.invoiceStatus(i, t);
    const match = (i) => !S.invFilter || stOf(i) === S.invFilter || (S.invFilter === "offen" && stOf(i) === "ueberfaellig") || (S.invFilter === "storniert" && stOf(i) === "storno");
    const list = all.filter(match).sort((a, b) => (a.status === "entwurf" ? -1 : 0) - (b.status === "entwurf" ? -1 : 0) || (b.date || "9").localeCompare(a.date || "9") || (b.seq || 0) - (a.seq || 0));
    return `<div class="bu-tools">${yearNav()}<div class="bu-quick"><button type="button" class="btn primary sm" data-bu="new-inv">${icon("plus", 16)}<span>Neue Rechnung</span></button></div></div>
      <div class="ak-chips" role="group" aria-label="Status">${filters.map(([id, l]) => `<button type="button" class="chip" data-bu="ifilter" data-v="${id}" aria-pressed="${S.invFilter === id}">${l} <span class="ak-cn">${all.filter((i) => !id || stOf(i) === id || (id === "offen" && stOf(i) === "ueberfaellig") || (id === "storniert" && stOf(i) === "storno")).length}</span></button>`).join("")}</div>
      ${list.length ? `<ul class="bu-list">${list.map((i) => { const x = B.STATUS[stOf(i)]; const tt = B.invoiceTotals(i, st());
        return `<li><a class="bu-row" href="${esc(B.invoiceHash(i.id))}"><span class="bu-row-e" aria-hidden="true">${i.kind === "storno" ? "↩️" : "🧾"}</span>` +
          `<span class="bu-row-t"><b>${esc(i.number || "Entwurf")}${i.customer.name ? " · " + esc(i.customer.name) : ""}</b><small>${esc([B.fmtKey(i.date), i.dueDate && i.status === "offen" ? "fällig " + B.fmtKey(i.dueDate) : "", i.refNumber ? "zu " + i.refNumber : ""].filter(Boolean).join(" · "))}</small></span>` +
          `<span class="bu-row-r"><b>${esc(B.eur(tt.gross))}</b><span class="bu-st bu-st-${stOf(i)}">${x.e} ${esc(x.label)}</span></span></a></li>`; }).join("")}</ul>`
        : col.inv.loaded ? A.emptyHTML("🧾", "Noch keine Rechnungen", "Kunde wählen, Positionen eintragen, prüfen lassen – die Nummer vergibt die App fortlaufend. Abgeschlossene Rechnungen werden nie gelöscht, nur storniert.", all.length ? "" : "＋ Erste Rechnung", "new-inv") : `<p class="note">Lade …</p>`}
      ${disclaimer()}`;
  }

  /* ---------- Rechnung: Papier (Vorschau, Druck, Datei) ---------- */

  function paperHTML(invRaw) {
    const inv = B.normInvoice(invRaw);
    const s = st();
    const sel = inv.seller || B.sellerOf(s);
    const t = B.invoiceTotals(inv, s);
    const title = inv.kind === "storno" ? "Stornorechnung" : "Rechnung";
    const fk = B.fmtKey;
    const range = inv.serviceTo && inv.serviceTo !== inv.serviceFrom ? `${fk(inv.serviceFrom)} – ${fk(inv.serviceTo)}` : fk(inv.serviceFrom);
    const sameDay = inv.date && inv.serviceFrom === inv.date && (!inv.serviceTo || inv.serviceTo === inv.serviceFrom);
    const multi = t.groups.length > 1;
    const lines = (v) => esc(v).replace(/\n/g, "<br>");
    return `<article class="rp-paper bu-paper${inv.status === "entwurf" ? " draft" : ""}" aria-label="${title}">
      ${inv.status === "entwurf" ? `<div class="bu-p-wm" aria-hidden="true">ENTWURF</div>` : ""}
      <header class="bu-p-head">
        <div class="bu-p-from">${s.logo ? `<img class="bu-p-logo" src="${esc(s.logo)}" alt="Logo">` : ""}<b>${esc(sel.firm || "Dein Firmenname")}</b><span>${lines(sel.address || "Deine Adresse")}</span>
          ${sel.uid ? `<span>UID: ${esc(sel.uid)}</span>` : ""}${sel.phone ? `<span>Tel.: ${esc(sel.phone)}</span>` : ""}${sel.email ? `<span>${esc(sel.email)}</span>` : ""}${sel.web ? `<span>${esc(sel.web)}</span>` : ""}</div>
      </header>
      <div class="bu-p-mid">
        <div class="bu-p-to"><small>Rechnung an</small>${inv.customer.name ? `<b>${esc(inv.customer.name)}</b><span>${lines(inv.customer.address)}</span>${inv.customer.uid ? `<span>UID: ${esc(inv.customer.uid)}</span>` : ""}` : `<span class="note">–</span>`}</div>
        <dl class="bu-p-meta">
          <dt>${title} Nr.</dt><dd class="bu-p-no">${esc(inv.number || "– (wird beim Abschließen vergeben)")}</dd>
          <dt>Rechnungsdatum</dt><dd>${esc(fk(inv.date) || "–")}</dd>
          <dt>Leistungsdatum</dt><dd>${esc(range || "–")}</dd>
          ${inv.kind === "rechnung" && inv.dueDate ? `<dt>Zahlbar bis</dt><dd>${esc(fk(inv.dueDate))}</dd>` : ""}
          ${inv.refNumber ? `<dt>Storno zu</dt><dd>Rechnung ${esc(inv.refNumber)}</dd>` : ""}
        </dl>
      </div>
      <h1 class="bu-p-title">${title}${inv.number ? " " + esc(inv.number) : ""}</h1>
      ${sameDay ? `<p class="bu-p-small">Rechnungsdatum ist gleich Liefer- bzw. Leistungsdatum.</p>` : ""}
      <table class="bu-p-table"><thead><tr><th class="n">Pos.</th><th class="q">Menge</th><th>Bezeichnung</th><th class="m">Einzelpreis netto</th>${t.ku ? "" : `<th class="r">USt</th>`}<th class="m">Gesamt netto</th></tr></thead>
        <tbody>${t.lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td class="q">${esc(String(l.qty).replace(".", ","))} ${esc(l.unit)}</td><td>${lines(l.text)}</td><td class="m">${esc(B.eur(l.price))}</td>${t.ku ? "" : `<td class="r">${esc(B.fmtRate(l.rate))}</td>`}<td class="m">${esc(B.eur(l.net))}</td></tr>`).join("") || `<tr><td colspan="6" class="note">Noch keine Positionen</td></tr>`}</tbody></table>
      <dl class="bu-p-sum">
        ${t.ku ? `<dt>Gesamtbetrag</dt><dd class="tot">${esc(B.eur(t.gross))}</dd>` :
          `<dt>Summe netto</dt><dd>${esc(B.eur(t.net))}</dd>${t.groups.map((g) => `${multi ? `<dt>Netto ${esc(B.fmtRate(g.rate))}</dt><dd>${esc(B.eur(g.net))}</dd>` : ""}<dt>zzgl. ${esc(B.fmtRate(g.rate))} USt</dt><dd>${esc(B.eur(g.vat))}</dd>`).join("")}<dt>Gesamtbetrag brutto</dt><dd class="tot">${esc(B.eur(t.gross))}</dd>`}
      </dl>
      ${t.ku ? `<p class="bu-p-ku">${esc(rule("kuHint"))}</p>` : ""}
      ${inv.note ? `<p class="bu-p-note">${lines(inv.note)}</p>` : ""}
      ${inv.kind === "rechnung" && t.gross > 0 && inv.status !== "storniert" ? `<p class="bu-p-pay">${inv.status === "bezahlt" ? `✓ Bezahlt am ${esc(fk(inv.paidOn))}. Danke!` : `Bitte überweise den Betrag${inv.dueDate ? ` bis <b>${esc(fk(inv.dueDate))}</b>` : ""}${sel.iban ? ` auf <b>${esc(B.fmtIban(sel.iban))}</b>${sel.bic ? ` (BIC ${esc(sel.bic)})` : ""}${sel.bank ? `, ${esc(sel.bank)}` : ""}` : ""} – Verwendungszweck: ${esc(inv.number || "Rechnungsnummer")}.`}</p>` : ""}
      <footer class="bu-p-foot">${esc([sel.firm, (sel.address || "").replace(/\n/g, ", "), sel.uid ? "UID " + sel.uid : "", sel.iban ? "IBAN " + B.fmtIban(sel.iban) : ""].filter(Boolean).join(" · "))}${sel.footer ? `<br>${esc(sel.footer)}` : ""}</footer>
    </article>`;
  }

  function invoiceDetailHTML(id) {
    const raw = col.inv.get(id);
    if (!raw) return col.inv.loaded ? `<div class="ak-det"><a class="btn ghost sm" href="#alltag/buchhaltung/rechnungen">${icon("chevron-left", 18)}<span>Rechnungen</span></a>${A.emptyHTML("🤔", "Rechnung nicht gefunden", "Vielleicht ein Entwurf, der gelöscht wurde.")}</div>` : `<p class="note">Lade …</p>`;
    const inv = B.normInvoice(raw);
    const stt = B.invoiceStatus(inv, today());
    const x = B.STATUS[stt];
    const t = B.invoiceTotals(inv, st());
    const bk = belege().filter((b) => b.invoiceId === inv.id);
    const ref = inv.refId ? col.inv.get(inv.refId) : inv.stornoId ? col.inv.get(inv.stornoId) : null;
    const acts = [];
    if (inv.status === "entwurf") acts.push(`<button type="button" class="btn primary sm" data-bu="inv-final">✅ <span>Prüfen &amp; abschließen</span></button>`, `<button type="button" class="btn ghost sm" data-bu="inv-edit">${icon("pencil", 16)}<span>Bearbeiten</span></button>`);
    if (inv.kind === "rechnung" && inv.status === "offen") acts.push(`<button type="button" class="btn primary sm" data-bu="inv-paid">💶 <span>Als bezahlt markieren</span></button>`);
    acts.push(`<button type="button" class="btn ghost sm" data-bu="inv-print">🖨️ <span>PDF / Drucken</span></button>`);
    if (inv.status !== "entwurf") acts.push(`<button type="button" class="btn ghost sm" data-bu="inv-share">${icon("share", 16)}<span>Teilen</span></button>`);
    if (inv.kind === "rechnung" && (inv.status === "offen" || inv.status === "bezahlt")) acts.push(`<button type="button" class="btn ghost sm bu-danger" data-bu="inv-storno">↩️ <span>Stornieren</span></button>`);
    if (inv.status === "entwurf") acts.push(`<button type="button" class="btn ghost sm bu-danger" data-bu="inv-del">${icon("trash", 16)}<span>Entwurf löschen</span></button>`);
    return `<div class="ak-det bu-det" data-id="${esc(inv.id)}">
      <div class="ak-det-bar"><a class="btn ghost sm" href="#alltag/buchhaltung/rechnungen">${icon("chevron-left", 18)}<span>Rechnungen</span></a></div>
      <section class="ak-hero"><div class="ak-hero-emo" aria-hidden="true">${inv.kind === "storno" ? "↩️" : "🧾"}</div>
        <div class="ak-hero-t"><h2>${inv.kind === "storno" ? "Stornorechnung" : "Rechnung"} ${esc(inv.number || "(Entwurf)")}</h2>
          <p class="note"><span class="bu-st bu-st-${stt}">${x.e} ${esc(x.label)}</span> · ${esc(B.eur(t.gross))}${inv.customer.name ? " · " + esc(inv.customer.name) : ""}</p></div>
        <div class="ak-hero-acts">${acts.join("")}</div></section>
      ${inv.status === "entwurf" ? `<p class="note bu-hint">📝 Entwurf: noch ohne Nummer, jederzeit änderbar. Erst beim Abschließen prüft die App die Pflichtangaben und vergibt die nächste fortlaufende Nummer.</p>` : `<p class="note bu-hint">🔒 Abgeschlossen – nicht mehr änderbar. Fehler? Stornieren und neu ausstellen.</p>`}
      ${ref ? `<p class="note">${inv.refId ? "↩️ Storno zu" : "🚫 Storniert durch"} <a href="${esc(B.invoiceHash(ref.id))}">${esc(ref.number)}</a></p>` : ""}
      ${bk.length ? `<section class="ak-card-s"><h3>💶 Gebuchte Einnahmen</h3><ul class="bu-list">${bk.map(belegRow).join("")}</ul></section>` : ""}
      <div class="bu-preview">${paperHTML(inv)}</div>
    </div>`;
  }

  /* ---------- Auswertung ---------- */

  function reportHTML() {
    const s = st();
    const rep = B.report(belege(), S.year, { ku: s.kleinunternehmer, by: S.by });
    const cats = B.byCategory(belege(), S.year, s.kleinunternehmer).filter((c) => c.type === "out");
    const maxC = Math.max(1, ...cats.map((c) => c.sum));
    const row = (r, tot = false) => `<div class="bu-rr${tot ? " tot" : ""}"><b class="bu-rr-l">${esc(r.label)}</b>
      <span><small>Einnahmen</small>${esc(B.eur(r.income))}</span><span><small>Ausgaben</small>${esc(B.eur(r.expense))}</span><span class="${r.profit < 0 ? "neg" : ""}"><small>Gewinn</small>${esc(B.eur(r.profit))}</span>
      ${s.kleinunternehmer ? "" : `<span><small>USt</small>${esc(B.eur(r.inVat))}</span><span><small>Vorsteuer</small>${esc(B.eur(r.outVat))}</span><span class="zl"><small>${r.zahllast < 0 ? "Gutschrift" : "Zahllast"}</small>${esc(B.eur(Math.abs(r.zahllast)))}</span>`}</div>`;
    return `<div class="bu-tools">${yearNav()}<div class="ak-chips" role="group" aria-label="Zeitraum">${[["month", "Monate"], ["quarter", "Quartale"]].map(([id, l]) => `<button type="button" class="chip" data-bu="by" data-v="${id}" aria-pressed="${S.by === id}">${l}</button>`).join("")}</div></div>
      <section class="ak-card-s"><h3>📊 Einnahmen-Ausgaben-Rechnung ${S.year}</h3>
        <p class="note">Nach Zahlungsdatum (Zufluss-Abfluss-Prinzip). ${s.kleinunternehmer ? "Kleinunternehmer: Bruttosystem, keine USt." : "Nettosystem. <b>USt-Zahllast = Orientierung für die UVA</b> – die echte Voranmeldung macht deine Steuerberatung bzw. FinanzOnline."}</p>
        <div class="bu-report${s.kleinunternehmer ? " ku" : ""}">${rep.rows.map((r) => row(r)).join("")}${row({ ...rep.total, label: "Summe " + S.year }, true)}</div></section>
      ${s.kleinunternehmer ? kuBar(S.year) : ""}
      <section class="ak-card-s"><h3>🗂️ Ausgaben nach Kategorie</h3>${cats.length ? `<ul class="bu-cats">${cats.map((c) => `<li><span>${c.e} ${esc(c.label)}</span><span class="bu-cbar"><span style="width:${((c.sum / maxC) * 100).toFixed(1)}%"></span></span><b>${esc(B.eur(c.sum))}</b></li>`).join("")}</ul>` : `<p class="note">Noch keine Ausgaben ${S.year}.</p>`}</section>
      <section class="ak-card-s"><h3>⏳ Offene &amp; überfällige Rechnungen</h3>${dueListHTML(20)}</section>
      <div class="bu-quick"><button type="button" class="btn ghost" data-bu="year-pdf">🖨️ <span>Jahres-Zusammenfassung (PDF)</span></button></div>
      ${disclaimer()}`;
  }

  /* ---------- Export ---------- */

  function exportHTML() {
    const n = belege().filter((b) => B.yearOf(b.date) === S.year).length;
    const ni = invoices().filter((i) => i.number && B.yearOf(i.date) === S.year).length;
    return `<div class="bu-tools">${yearNav()}</div>
      <section class="ak-card-s"><h3>📤 Für die Steuerberatung ${S.year}</h3>
        <p class="note">${n} Belege · ${ni} Rechnungen. CSV-Dateien mit Semikolon (öffnen direkt in Excel), Beträge mit Komma.</p>
        <div class="bu-exp">
          <button type="button" class="btn ghost" data-bu="exp-belege">📒 <span>Buchungen (CSV)</span></button>
          <button type="button" class="btn ghost" data-bu="exp-inv">🧾 <span>Rechnungen (CSV)</span></button>
          <button type="button" class="btn ghost" data-bu="exp-list">📎 <span>Belege-Liste (CSV)</span></button>
          <button type="button" class="btn ghost" data-bu="exp-xlsx">📊 <span>Alles als Excel (.xlsx)</span></button>
          <button type="button" class="btn primary" data-bu="year-pdf">🖨️ <span>Jahres-Zusammenfassung (PDF)</span></button>
        </div>
        <p class="note">📎 Die Belege-Liste zeigt pro Buchung, welches Dokument dazu in 📁 Dokumente liegt – und wo noch eins fehlt. ${DS.isReady() ? "" : "Für die Dokument-Titel 📁 Dokumente entsperren (sonst stehen dort nur die Kennungen)."}</p>
        <p class="note">🗄️ Aufbewahren: ${rule("keepYears")} Jahre ab Jahresende – Belege aus ${S.year} also bis 31.12.${S.year + rule("keepYears")}.</p></section>
      ${disclaimer()}`;
  }
  function docRefs() {
    const docs = DS.docs();
    return (b) => {
      const ids = new Set(b.docIds);
      const out = [];
      if (docs) for (const d of linkedTo(docs, "beleg", b.id)) { ids.delete(d.id); out.push(`${d.title} (${d.id})`); }
      for (const id of ids) { const d = docs && docs.find((x) => x.id === id); out.push(d ? `${d.title} (${d.id})` : `Dokument ${id}`); }
      return out;
    };
  }
  function exportFile(kind) {
    const s = st(), y = S.year, inv = invoices();
    const opts = { ku: s.kleinunternehmer, invoices: inv, docRefs: docRefs(), year: y, today: today() };
    const base = `Buchhaltung-${y}`;
    if (kind === "belege") download(`${base}-Buchungen.csv`, B.belegeCSV(belege(), opts));
    else if (kind === "inv") download(`${base}-Rechnungen.csv`, B.invoicesCSV(inv, opts));
    else if (kind === "list") download(`${base}-Belege-Liste.csv`, B.belegListCSV(belege(), opts));
    else if (kind === "xlsx") {
      const rep = B.report(belege(), y, { ku: s.kleinunternehmer, by: "month" });
      const data = buildXlsx([
        { name: "Zusammenfassung", rows: B.summaryRows(rep), widths: [18, 14, 14, 16, 12, 12, 22] },
        { name: "Buchungen", rows: [B.BELEG_HEAD, ...B.belegRows(belege(), opts)], widths: [14, 10, 22, 22, 28, 12, 10, 12, 12, 14, 12, 30, 14] },
        { name: "Rechnungen", rows: [B.INVOICE_HEAD, ...B.invoiceRows(inv, opts)], widths: [12, 14, 14, 12, 12, 26, 14, 12, 12, 12, 14, 12, 12, 14] },
        { name: "Belege-Liste", rows: [B.BELEGLIST_HEAD, ...B.belegListRows(belege(), opts)], widths: [6, 14, 10, 24, 12, 22, 12, 40, 22] },
      ]);
      download(`${base}.xlsx`, data, XLSX_MIME);
    }
    ui.toast("Export erstellt 📤");
  }

  /* ---------- Info ---------- */

  function infoHTML() {
    return `<section class="ak-card-s bu-info-h"><h3>ℹ️ Gut zu wissen</h3>
        <p>Die wichtigsten österreichischen Regeln für kleine Betriebe – kurz zusammengefasst, mit Link zur offiziellen Quelle. <b>Stand: ${esc(B.fmtKey(RULES_CHECKED))}</b>.</p>
        <p class="bu-disc" role="note">⚖️ Keine Rechts- oder Steuerberatung. Regeln ändern sich – im Zweifel gilt die verlinkte Quelle bzw. deine Steuerberatung.</p></section>
      <ul class="bu-info">${INFO.map((r) => `<li class="ak-card-s"><h3>${esc(r.title)}</h3>
        ${r.key === "invoiceFields" ? `<ol class="bu-ol">${r.value.map((v) => `<li>${esc(v)}</li>`).join("")}</ol>` : ""}<p>${esc(r.text)}</p>
        <p class="note">Quelle: <a href="${esc(r.source)}" target="_blank" rel="noopener noreferrer">${esc(new URL(r.source).hostname)}</a> · geprüft ${esc(B.fmtKey(r.checked))}</p></li>`).join("")}</ul>`;
  }

  /* ---------- Einrichtung ---------- */

  function setupHTML() {
    const s = st();
    const next = B.nextNumber(s, invoices(), now.getFullYear());
    return `<form class="fields ak-form bu-setup" novalidate>
      <section class="ak-card-s"><h3>🏢 Deine Firma</h3>
        <label>Firmenname<input id="bu-s-firm" type="text" maxlength="120" value="${esc(s.firm)}" placeholder="z. B. Muster Handwerk e.U." autocomplete="organization"></label>
        <label>Adresse<textarea id="bu-s-addr" rows="3" maxlength="300" placeholder="Straße Nr.&#10;PLZ Ort">${esc(s.address)}</textarea></label>
        <div class="row2"><label><span>UID-Nummer <small class="note">(optional)</small></span><input id="bu-s-uid" type="text" maxlength="20" value="${esc(s.uid)}" placeholder="ATU12345678" autocapitalize="characters"></label>
          <label>Telefon<input id="bu-s-phone" type="tel" maxlength="40" value="${esc(s.phone)}"></label></div>
        <div class="row2"><label>E-Mail<input id="bu-s-mail" type="email" maxlength="120" value="${esc(s.email)}"></label>
          <label>Website<input id="bu-s-web" type="text" maxlength="120" value="${esc(s.web)}"></label></div>
        <label class="switch"><input id="bu-s-ku" type="checkbox"${s.kleinunternehmer ? " checked" : ""}><span>🏷️ Kleinunternehmer (keine USt auf Rechnungen)</span></label>
        <p class="note">Bis ${esc(B.eur(rule("kuLimit") * 100))} Umsatz brutto im Jahr. Rechnungen bekommen dann automatisch den Hinweis „${esc(rule("kuHint"))}“. Gilt für neue Rechnungen – abgeschlossene bleiben, wie sie sind.</p>
        <div class="bu-logo"><span class="bu-logo-prev">${s.logo ? `<img src="${esc(s.logo)}" alt="Logo">` : "Kein Logo"}</span>
          <label class="btn ghost sm ak-filebtn">🖼️ <span>Logo wählen</span><input id="bu-s-logo" type="file" accept="image/png,image/jpeg,image/webp"></label>
          ${s.logo ? `<button type="button" class="btn ghost sm" data-bu="logo-del">Entfernen</button>` : ""}</div>
      </section>
      <section class="ak-card-s"><h3>🏦 Bankverbindung <small class="note">(steht auf jeder Rechnung)</small></h3>
        <label>IBAN<input id="bu-s-iban" type="text" maxlength="42" value="${esc(B.fmtIban(s.iban))}" placeholder="AT.. .... .... .... ...." autocapitalize="characters" inputmode="text"></label>
        <div class="row2"><label><span>BIC <small class="note">(optional)</small></span><input id="bu-s-bic" type="text" maxlength="11" value="${esc(s.bic)}"></label>
          <label><span>Bank <small class="note">(optional)</small></span><input id="bu-s-bank" type="text" maxlength="80" value="${esc(s.bank)}"></label></div>
        <p class="bu-ibanmsg note" aria-live="polite"></p>
      </section>
      <section class="ak-card-s"><h3>🔢 Rechnungen</h3>
        <label>Nummern-Format<input id="bu-s-fmt" type="text" maxlength="40" value="${esc(s.numFormat)}" placeholder="${B.DEFAULT_FORMAT}"></label>
        <p class="note">{JJJJ} = Jahr, {JJ} = Jahr kurz, {NNN} = laufende Nummer (so viele N wie Stellen). Mit Jahr: Zähler startet jedes Jahr bei 1. Nächste Nummer: <b class="bu-nextno">${esc(next.number)}</b> – fortlaufend, ohne Lücken, nie doppelt.</p>
        <div class="row2"><label>Zahlungsziel (Tage)<input id="bu-s-due" type="number" min="0" max="365" inputmode="numeric" value="${s.dueDays}"></label><span></span></div>
        <label><span>Fußzeile <small class="note">(optional, z. B. Firmenbuch, Gerichtsstand)</small></span><textarea id="bu-s-foot" rows="2" maxlength="400">${esc(s.footer)}</textarea></label>
      </section>
      <section class="ak-card-s"><h3>🔒 Schutz</h3>
        <label class="switch"><input id="bu-s-lock" type="checkbox"${s.lockWithMoney ? " checked" : ""}><span>Mit Geld-Sperre schützen</span></label>
        <p class="note">Ist die Geld-Sperre (Fingerabdruck/PIN) eingerichtet, braucht auch die Buchhaltung das Entsperren – und die Suche zeigt dann nichts daraus.</p>
      </section>
      <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button></div>
      ${disclaimer()}
    </form>`;
  }
  let logoNew = null;
  function bindSetup() {
    const f = body.querySelector(".bu-setup");
    if (!f) return;
    logoNew = null;
    const $ = (q) => f.querySelector(q);
    const ibanMsg = () => { const v = $("#bu-s-iban").value; $(".bu-ibanmsg").textContent = v.trim() && !B.ibanOk(v) ? "⚠️ Diese IBAN hat eine falsche Prüfziffer – bitte nochmal prüfen." : ""; };
    $("#bu-s-iban").addEventListener("input", ibanMsg);
    $("#bu-s-fmt").addEventListener("input", () => {
      const v = $("#bu-s-fmt").value.trim();
      $(".bu-nextno").textContent = B.validFormat(v) ? B.nextNumber({ ...st(), numFormat: v }, invoices(), now.getFullYear()).number : "Format ungültig (braucht genau ein {NNN})";
    });
    $("#bu-s-logo").addEventListener("change", async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      try { logoNew = await smallLogo(file); $(".bu-logo-prev").innerHTML = `<img src="${esc(logoNew)}" alt="Logo">`; }
      catch (e) { console.warn(e); ui.toast("Das Bild konnte nicht gelesen werden."); }
    });
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fmt = $("#bu-s-fmt").value.trim() || B.DEFAULT_FORMAT;
      if (!B.validFormat(fmt)) { ui.toast("Nummern-Format braucht genau ein {NNN} – z. B. {JJJJ}-{NNN}."); $("#bu-s-fmt").focus(); return; }
      const uid = $("#bu-s-uid").value.trim();
      if (uid && !B.uidOk(uid)) { ui.toast("Die UID-Nummer sieht nicht richtig aus (Österreich: ATU + 8 Ziffern)."); $("#bu-s-uid").focus(); return; }
      const firm = $("#bu-s-firm").value.trim();
      const patch = { firm, address: $("#bu-s-addr").value.trim(), uid, phone: $("#bu-s-phone").value.trim(), email: $("#bu-s-mail").value.trim(), web: $("#bu-s-web").value.trim(),
        kleinunternehmer: $("#bu-s-ku").checked, iban: $("#bu-s-iban").value, bic: $("#bu-s-bic").value, bank: $("#bu-s-bank").value.trim(), numFormat: fmt,
        dueDays: Math.max(0, Math.min(365, Math.round(Number($("#bu-s-due").value) || 0))), footer: $("#bu-s-foot").value.trim(), lockWithMoney: $("#bu-s-lock").checked,
        setupDone: !!(firm && $("#bu-s-addr").value.trim()) };
      if (logoNew) patch.logo = logoNew;
      const clean = B.normSettings({ ...(col.set.get("main") || {}), ...patch });
      if (await A.safe(saveSettings({ ...clean, counters: clean.counters }), "Gespeichert ✓ – steht so auf deinen Rechnungen")) { built = ""; if (clean.setupDone) A.go("#alltag/buchhaltung"); else render(); }
    });
  }
  async function smallLogo(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Bild")); i.src = url; });
      const sc = Math.min(1, 480 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.naturalWidth * sc)); c.height = Math.max(1, Math.round(im.naturalHeight * sc));
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      let out = c.toDataURL("image/png");
      if (out.length > 150000) { const g = c.getContext("2d"); g.globalCompositeOperation = "destination-over"; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); out = c.toDataURL("image/jpeg", 0.85); }
      if (out.length > 190000) throw new Error("Logo zu groß");
      return out;
    } finally { URL.revokeObjectURL(url); }
  }

  /* ---------- Beleg erfassen / bearbeiten ---------- */

  function rateOptions(cur) {
    return B.RATES.map((r) => `<option value="${r}"${Number(cur) === r ? " selected" : ""}>${esc(B.fmtRate(r))}</option>`).join("");
  }
  function openBeleg(b0 = null, type = "out") {
    const s = st();
    const isNew = !b0;
    const b = B.normBeleg(b0 || { type, date: today(), rate: type === "in" && s.kleinunternehmer ? 0 : 20, pay: "bank" });
    let prepared = null, fileName = "";
    const canAi = aiAvailable();
    const vaultNote = () => (DS.isReady() ? `<p class="note">🔒 Wird beim Speichern verschlüsselt in 📁 Dokumente abgelegt (Ordner „Rechnungen“).</p>`
      : Sess.hasVault() ? `<p class="note">🔒 Deine Dokumente sind gesperrt – <a href="#alltag/dokumente">entsperren</a>, dann wird das Foto verschlüsselt mit abgelegt. Auslesen geht trotzdem.</p>`
        : `<p class="note">💡 Zum Ablegen des Fotos richte in <a href="#alltag/dokumente">📁 Dokumente</a> einmal ein Tresor-Passwort ein (dann verschlüsselt). Auslesen geht trotzdem.</p>`);
    openSheet({
      title: isNew ? (b.type === "in" ? "💶 Neue Einnahme" : "🧾 Neue Ausgabe") : "✏️ Beleg bearbeiten",
      bodyHTML: `<form class="fields ak-form bu-f bu-bform" novalidate>
        <div class="ak-chiprow" role="group" aria-label="Art"><button type="button" class="chip" data-ty="out" aria-pressed="${b.type === "out"}">🧾 Ausgabe</button><button type="button" class="chip" data-ty="in" aria-pressed="${b.type === "in"}">💶 Einnahme</button></div>
        ${b.invoiceId ? `<p class="note bu-hint">🔗 Kommt aus einer Rechnung (bezahlt). Änderungen hier ändern die Rechnung nicht.</p>` : ""}
        <fieldset class="bu-scan"><legend>📸 Beleg</legend>
          <div class="bu-scan-row"><label class="btn ghost sm ak-filebtn">📷 <span>Foto / PDF wählen</span><input id="bu-b-file" type="file" accept="image/*,application/pdf"></label>
            ${canAi ? `<button type="button" class="btn ghost sm" data-scan disabled>🤖 <span>Beleg auslesen</span></button>` : ""}</div>
          <div class="bu-scan-prev" hidden></div><div class="bu-scan-msg" aria-live="polite"></div>
          <div class="bu-vault"></div>
        </fieldset>
        <div class="row2"><label>Zahlungsdatum<input id="bu-b-date" type="date" value="${esc(b.date)}" required></label>
          <label>Betrag brutto (€)<input id="bu-b-gross" type="text" inputmode="decimal" value="${esc(b.gross ? B.centsIn(b.gross) : "")}" placeholder="0,00" required></label></div>
        <div class="row2"><label>USt-Satz<select id="bu-b-rate">${rateOptions(b.rate)}</select></label>
          <label>Kategorie<select id="bu-b-cat"></select></label></div>
        <p class="bu-calc note" aria-live="polite"></p>
        <div class="row2"><label><span class="bu-plabel">${b.type === "in" ? "Kunde" : "Händler / Lieferant"}</span><input id="bu-b-partner" type="text" maxlength="120" value="${esc(b.partner)}"></label>
          <label>Zahlungsart<select id="bu-b-pay">${B.PAYS.map((p) => `<option value="${p.id}"${p.id === b.pay ? " selected" : ""}>${esc(p.label)}</option>`).join("")}</select></label></div>
        <label>Notiz<textarea id="bu-b-note" rows="2" maxlength="1000" placeholder="z. B. Kabel für Baustelle Muster">${esc(b.note)}</textarea></label>
        <p class="bu-gwg note" hidden></p>
        <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button>${isNew ? "" : `<button type="button" class="btn ghost bu-danger" data-del>${icon("trash", 16)}<span>Löschen</span></button>`}</div>
        ${isNew ? "" : `<div class="bu-linked"></div><p class="note">🗄️ Aufbewahren bis ${esc(B.keepUntil(b.date))}.</p>`}
      </form>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        let type = b.type;
        const fillCats = (cur) => { $("#bu-b-cat").innerHTML = B.catsFor(type).map((c) => `<option value="${c.id}"${c.id === cur ? " selected" : ""}>${c.e} ${esc(c.label)}</option>`).join(""); };
        fillCats(b.cat);
        const calc = () => {
          const g = B.toCents($("#bu-b-gross").value);
          const r = Number($("#bu-b-rate").value);
          const cur = { ...b, type, cat: $("#bu-b-cat").value, gross: Number.isFinite(g) ? g : 0, rate: r };
          if (!Number.isFinite(g) || g === 0) { $(".bu-calc").textContent = ""; }
          else { const x = B.splitGross(g, r); $(".bu-calc").textContent = s.kleinunternehmer ? `Kleinunternehmer: zählt mit ${B.eur(g)} brutto${type === "out" && x.vat ? ` (enthaltene USt ${B.eur(x.vat)} ist keine abziehbare Vorsteuer)` : ""}.` : `Netto ${B.eur(x.net)} + ${B.fmtRate(r)} ${type === "in" ? "USt" : "Vorsteuer"} ${B.eur(x.vat)}`; }
          const w = B.gwgWarn(cur, s.kleinunternehmer);
          $(".bu-gwg").hidden = !w; $(".bu-gwg").textContent = w ? "🧰 " + w : "";
        };
        ["#bu-b-gross", "#bu-b-rate", "#bu-b-cat"].forEach((q) => { $(q).addEventListener("input", calc); $(q).addEventListener("change", calc); });
        calc();
        const drawVault = () => { const v = $(".bu-vault"); if (v) v.innerHTML = prepared ? vaultNote() : ""; };
        const offDocs = A.watchDocs(() => { drawVault(); const l = $(".bu-linked"); if (l) l.innerHTML = A.linkedDocsHTML("beleg", b.id, { title: "📎 Belege in Dokumente" }); });
        const l0 = $(".bu-linked"); if (l0) l0.innerHTML = A.linkedDocsHTML("beleg", b.id, { title: "📎 Belege in Dokumente" });
        const obs = new MutationObserver(() => { if (!sheet.isConnected) { offDocs(); obs.disconnect(); } });
        obs.observe(document.getElementById("sheet-root") || document.body, { childList: true });
        sheet.querySelectorAll("[data-ty]").forEach((x) => x.addEventListener("click", () => {
          type = x.dataset.ty;
          sheet.querySelectorAll("[data-ty]").forEach((y) => y.setAttribute("aria-pressed", String(y.dataset.ty === type)));
          fillCats(type === "in" ? "erloese" : "sonstiges");
          $(".bu-plabel").textContent = type === "in" ? "Kunde" : "Händler / Lieferant";
          if (type === "in" && s.kleinunternehmer) $("#bu-b-rate").value = "0";
          calc();
        }));
        $("#bu-b-file").addEventListener("change", async (ev) => {
          const file = ev.target.files && ev.target.files[0];
          if (!file) return;
          const msg = $(".bu-scan-msg");
          try {
            prepared = await F.prepareFile(file);
            fileName = file.name || "Beleg";
            const prev = $(".bu-scan-prev");
            prev.hidden = false;
            prev.innerHTML = /^image\//.test(prepared.type) ? `<img src="${esc(prepared.thumb || prepared.data)}" alt="Beleg-Vorschau">` : `<span class="note">📄 ${esc(fileName)}</span>`;
            const sb = $("[data-scan]"); if (sb) sb.disabled = !/^image\//.test(prepared.type);
            msg.textContent = "";
            drawVault();
          } catch (e) { prepared = null; msg.textContent = (e && e.message) || "Datei konnte nicht gelesen werden."; }
        });
        const scanBtn = $("[data-scan]");
        if (scanBtn) scanBtn.addEventListener("click", async () => {
          if (!prepared || !/^image\//.test(prepared.type)) return;
          const msg = $(".bu-scan-msg");
          ui.setBusy(scanBtn, true, "Liest …");
          msg.textContent = "🤖 Claude schaut sich den Beleg an …";
          try {
            const img = await F.ocrImage(prepared.data);
            const out = await askClaude([{ role: "user", content: B.SCAN_PROMPT }], { body: { mode: "lehrer", image: img }, timeoutMs: 60000 });
            const r = B.parseScan(out.reply);
            if (!r) { msg.textContent = "Hm, das konnte ich nicht sicher lesen – bitte selbst eintragen. ✍️"; return; }
            const mark = (q) => $(q).classList.add("bu-ai");
            if (type !== "out") sheet.querySelector('[data-ty="out"]').click();
            if (r.date) { $("#bu-b-date").value = r.date; mark("#bu-b-date"); }
            if (r.gross) { $("#bu-b-gross").value = B.centsIn(r.gross); mark("#bu-b-gross"); }
            if (r.rate != null) { $("#bu-b-rate").value = String(r.rate); mark("#bu-b-rate"); }
            if (r.partner) { $("#bu-b-partner").value = r.partner; mark("#bu-b-partner"); }
            if (r.cat) { $("#bu-b-cat").value = r.cat; mark("#bu-b-cat"); }
            calc();
            msg.innerHTML = `✅ Ausgelesen – <b>bitte prüfen</b>, KI kann sich verlesen. Gespeichert wird erst mit „Speichern“.`;
          } catch (e) { msg.textContent = (e && e.message) || "Auslesen hat nicht geklappt."; }
          finally { ui.setBusy(scanBtn, false); }
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => {
          if (await A.safe(col.bel.remove(b.id), "Beleg gelöscht 🗑️")) { close(); if (location.hash.includes("/beleg/")) A.go("#alltag/buchhaltung/belege"); }
        });
        $("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const date = $("#bu-b-date").value;
          const gross = B.toCents($("#bu-b-gross").value);
          if (!B.isKey(date)) { ui.toast("Bitte das Zahlungsdatum eintragen."); $("#bu-b-date").focus(); return; }
          if (!Number.isFinite(gross) || gross === 0) { ui.toast("Bitte einen Betrag eintragen (z. B. 12,50)."); $("#bu-b-gross").focus(); return; }
          const id = b.id || newId();
          const doc = B.normBeleg({ ...(b0 || {}), id, type, date, gross, rate: Number($("#bu-b-rate").value), cat: $("#bu-b-cat").value, pay: $("#bu-b-pay").value,
            partner: $("#bu-b-partner").value.trim(), note: $("#bu-b-note").value.trim(), created: b.created || Date.now(), updated: Date.now() });
          const btn = $("[data-save]");
          ui.setBusy(btn, true, "Speichert …");
          let stored = false;
          if (prepared && DS.isReady()) {
            try {
              const r = await DS.create({ title: `Beleg ${doc.partner || B.catById(doc.cat).label} ${B.fmtKey(date)}`, folder: "rechnungen", tags: ["Buchhaltung"], date, expires: "", remind: false, remindDays: 30,
                links: [{ k: "beleg", id }], notes: doc.note, fav: false, type: prepared.type, size: prepared.size, name: fileName, thumb: prepared.thumb || "", ocr: "", created: Date.now() }, dataUrlBytes(prepared.data));
              doc.docIds = [...doc.docIds, r.id];
              stored = true;
              r.upload.catch((e) => { console.error(e); ui.toast("Beleg-Upload fehlgeschlagen – bitte später in 📁 Dokumente prüfen."); });
            } catch (e) { console.error(e); }
          }
          const ok = await A.safe(col.bel.put(doc), prepared ? (stored ? "Gespeichert ✓ – Beleg verschlüsselt abgelegt 🔒📁" : "Gespeichert ✓ – Foto nicht abgelegt (📁 Dokumente gesperrt)") : isNew ? "Gebucht ✓" : "Gespeichert ✓");
          ui.setBusy(btn, false);
          if (ok) { prepared = null; close(); }
        });
      },
    });
  }

  /* ---------- Rechnung bearbeiten ---------- */

  function contacts() { return col.kt.all().map(normContact).filter((c) => c.id).sort((a, b) => displayName(a).localeCompare(displayName(b), "de")); }
  function openInvoiceForm(inv0 = null) {
    const s = st();
    const inv = B.normInvoice(inv0 || { status: "entwurf", date: today(), serviceFrom: today(), dueDays: s.dueDays, items: [{ qty: 1, unit: "Std", text: "", price: 0, rate: 20 }] });
    if (inv.status !== "entwurf") { ui.toast("Abgeschlossene Rechnungen kann man nicht mehr ändern – nur stornieren."); return; }
    let items = inv.items.length ? inv.items.map((x) => ({ ...x })) : [{ qty: 1, unit: "Std", text: "", price: 0, rate: 20 }];
    const ku = s.kleinunternehmer;
    const cs = contacts();
    openSheet({
      title: inv0 ? "✏️ Rechnung bearbeiten (Entwurf)" : "🧾 Neue Rechnung",
      bodyHTML: `<form class="fields ak-form bu-f bu-iform" novalidate>
        <fieldset class="bu-fs"><legend>👤 Kunde</legend>
          <label>Aus Kontakte wählen<select id="bu-i-kt"><option value="">— neu / selbst eintragen —</option>${cs.map((c) => `<option value="${esc(c.id)}"${c.id === inv.customer.contactId ? " selected" : ""}>${esc(displayName(c))}${c.company && c.company !== c.name ? " · " + esc(c.company) : ""}</option>`).join("")}</select></label>
          <label>Name / Firma<input id="bu-i-name" type="text" maxlength="160" value="${esc(inv.customer.name)}" placeholder="z. B. Familie Muster"></label>
          <label>Anschrift<textarea id="bu-i-addr" rows="2" maxlength="300">${esc(inv.customer.address)}</textarea></label>
          <div class="row2"><label><span>E-Mail <small class="note">(optional)</small></span><input id="bu-i-mail" type="email" maxlength="120" value="${esc(inv.customer.email)}"></label>
            <label><span>UID des Kunden <small class="note">(über 10.000 €)</small></span><input id="bu-i-uid" type="text" maxlength="20" value="${esc(inv.customer.uid)}"></label></div>
          <label class="ak-check"><input id="bu-i-biz" type="checkbox"${inv.customer.business ? " checked" : ""}> 🏢 Kunde ist ein Unternehmen</label>
          <label class="ak-check bu-i-savekt"${inv.customer.contactId ? " hidden" : ""}><input id="bu-i-savekt" type="checkbox" checked> 👤 In Kontakte speichern</label>
        </fieldset>
        <div class="row2"><label>Rechnungsdatum<input id="bu-i-date" type="date" value="${esc(inv.date)}"></label>
          <label>Zahlungsziel (Tage)<input id="bu-i-due" type="number" min="0" max="365" inputmode="numeric" value="${inv.dueDays}"></label></div>
        <div class="row2"><label>Leistung am / von<input id="bu-i-from" type="date" value="${esc(inv.serviceFrom)}"></label>
          <label><span>bis <small class="note">(bei Zeitraum)</small></span><input id="bu-i-to" type="date" value="${esc(inv.serviceTo)}"></label></div>
        <fieldset class="bu-fs"><legend>📋 Positionen ${ku ? `<small class="note">(Kleinunternehmer – ohne USt)</small>` : `<small class="note">(Preise netto)</small>`}</legend>
          <div class="bu-items"></div>
          <button type="button" class="btn ghost sm" data-additem>${icon("plus", 16)}<span>Position</span></button>
          <datalist id="bu-units">${B.UNITS.map((u) => `<option value="${esc(u)}">`).join("")}</datalist>
        </fieldset>
        <div class="bu-itot" aria-live="polite"></div>
        <label><span>Text auf der Rechnung <small class="note">(optional)</small></span><textarea id="bu-i-note" rows="2" maxlength="1000" placeholder="z. B. Danke für deinen Auftrag!">${esc(inv.note)}</textarea></label>
        <div class="row"><button type="submit" class="btn primary" data-save>Entwurf speichern</button></div>
        <p class="note">Gespeichert wird als Entwurf – Nummer & Pflichtangaben-Check kommen beim Abschließen.</p>
      </form>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        const box = $(".bu-items");
        const readRows = () => {
          box.querySelectorAll(".bu-item").forEach((r, i) => {
            const q = Number(r.querySelector("[data-f=qty]").value.replace(",", "."));
            const p = B.toCents(r.querySelector("[data-f=price]").value);
            items[i] = { qty: Number.isFinite(q) ? q : 0, unit: r.querySelector("[data-f=unit]").value.trim(), text: r.querySelector("[data-f=text]").value.trim(),
              price: Number.isFinite(p) ? p : 0, rate: ku ? items[i].rate : Number(r.querySelector("[data-f=rate]").value) };
          });
        };
        const totals = () => {
          readRows();
          const t = B.invoiceTotals({ items, ku }, s);
          box.querySelectorAll(".bu-item").forEach((r, i) => { r.querySelector(".bu-item-sum").textContent = B.eur(t.lines[i] ? t.lines[i].net : 0); });
          $(".bu-itot").innerHTML = ku ? `<b>Gesamt ${esc(B.eur(t.gross))}</b>` : `Netto ${esc(B.eur(t.net))} · USt ${esc(B.eur(t.vat))} · <b>Brutto ${esc(B.eur(t.gross))}</b>`;
        };
        const drawRows = () => {
          box.innerHTML = items.map((it, i) => `<div class="bu-item" data-i="${i}">
            <label class="bu-it-t">Bezeichnung<input data-f="text" type="text" maxlength="300" value="${esc(it.text)}" placeholder="z. B. Montage Steckdosen"></label>
            <label class="bu-it-q">Menge<input data-f="qty" type="text" inputmode="decimal" value="${esc(String(it.qty).replace(".", ","))}"></label>
            <label class="bu-it-u">Einheit<input data-f="unit" type="text" maxlength="12" list="bu-units" value="${esc(it.unit)}"></label>
            <label class="bu-it-p">Einzelpreis netto €<input data-f="price" type="text" inputmode="decimal" value="${esc(it.price ? B.centsIn(it.price) : "")}" placeholder="0,00"></label>
            ${ku ? "" : `<label class="bu-it-r">USt<select data-f="rate">${rateOptions(it.rate)}</select></label>`}
            <span class="bu-item-sum" aria-label="Zeilensumme"></span>
            <button type="button" class="ak-x" data-rm="${i}" aria-label="Position ${i + 1} entfernen"${items.length < 2 ? " disabled" : ""}>✕</button></div>`).join("");
          totals();
        };
        drawRows();
        box.addEventListener("input", totals);
        box.addEventListener("change", totals);
        box.addEventListener("click", (ev) => { const rm = ev.target.closest("[data-rm]"); if (!rm) return; readRows(); items.splice(Number(rm.dataset.rm), 1); drawRows(); });
        $("[data-additem]").addEventListener("click", () => { readRows(); const last = items[items.length - 1] || {}; items.push({ qty: 1, unit: last.unit || "Stk", text: "", price: 0, rate: last.rate ?? 20 }); drawRows(); box.querySelector(".bu-item:last-child [data-f=text]").focus(); });
        $("#bu-i-kt").addEventListener("change", () => {
          const c = cs.find((x) => x.id === $("#bu-i-kt").value);
          $(".bu-i-savekt").hidden = !!c;
          if (!c) return;
          $("#bu-i-name").value = c.company || c.name; $("#bu-i-addr").value = c.address; $("#bu-i-mail").value = c.email;
          $("#bu-i-biz").checked = c.type === "firma" || !!c.company;
        });
        $("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          readRows();
          items = items.filter((it, i) => it.text || it.price || i === 0);
          let contactId = $("#bu-i-kt").value;
          const name = $("#bu-i-name").value.trim();
          if (!contactId && name && $("#bu-i-savekt").checked) {
            contactId = newId();
            await col.kt.put({ id: contactId, type: $("#bu-i-biz").checked ? "firma" : "kunde", name, company: $("#bu-i-biz").checked ? name : "", person: "", phone: "", email: $("#bu-i-mail").value.trim(),
              address: $("#bu-i-addr").value.trim(), notes: "Angelegt aus 💼 Buchhaltung", calls: [], jobs: [], placeIds: [], created: Date.now(), updated: Date.now() }).catch((e) => { console.warn(e); contactId = ""; });
          }
          const doc = { ...(inv0 || {}), id: inv.id || newId(), kind: "rechnung", status: "entwurf", number: "", date: $("#bu-i-date").value, serviceFrom: $("#bu-i-from").value, serviceTo: $("#bu-i-to").value,
            dueDays: Math.max(0, Math.min(365, Math.round(Number($("#bu-i-due").value) || 0))),
            customer: { contactId, name, address: $("#bu-i-addr").value.trim(), email: $("#bu-i-mail").value.trim(), uid: $("#bu-i-uid").value.trim(), business: $("#bu-i-biz").checked },
            items, note: $("#bu-i-note").value.trim(), created: inv.created || Date.now(), updated: Date.now() };
          const clean = B.normInvoice(doc);
          delete clean.ku; delete clean.seller;
          if (await A.safe(col.inv.put(JSON.parse(JSON.stringify(clean))), "Entwurf gespeichert 📝")) { close(); A.go(B.invoiceHash(clean.id)); }
        });
      },
    });
  }

  /* ---------- Abschließen, bezahlt, Storno ---------- */

  function openFinalize(inv) {
    const s = st();
    const chk = B.checkInvoice(inv, s);
    const next = B.nextNumber(s, invoices(), B.yearOf(inv.date || today()));
    const ok = !chk.errors.length;
    openSheet({
      title: "✅ Pflichtangaben-Check",
      bodyHTML: `<div class="bu-check">
        ${chk.errors.length ? `<h3>❌ Das fehlt noch</h3><ul class="bu-errs">${chk.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : `<p class="bu-okline">👍 Alle Pflichtangaben sind da${chk.small ? " (Kleinbetragsrechnung bis 400 €)" : ""}.</p>`}
        ${chk.warnings.length ? `<h3>⚠️ Bitte prüfen</h3><ul class="bu-warns">${chk.warnings.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
        ${chk.totals.ku ? `<p class="note">🏷️ Kleinunternehmer: Hinweis „${esc(rule("kuHint"))}“ kommt automatisch auf die Rechnung.</p>` : ""}
        <p class="note">Nach dem Abschließen bekommt die Rechnung die Nummer <b>${esc(next.number)}</b> und kann nicht mehr geändert oder gelöscht werden – nur storniert.</p>
        <div class="row">${ok ? `<button type="button" class="btn primary" data-go>${chk.warnings.length ? "Trotzdem abschließen" : "Abschließen"} (${esc(next.number)})</button>` : ""}
          <button type="button" class="btn ghost" data-fix>${icon("pencil", 16)}<span>${ok ? "Noch ändern" : "Ergänzen"}</span></button>
          ${chk.errors.some((e) => /Einrichtung/.test(e)) ? `<a class="btn ghost" href="#alltag/buchhaltung/setup" data-close>⚙️ Firma einrichten</a>` : ""}</div></div>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-fix]").addEventListener("click", () => { close(); openInvoiceForm(col.inv.get(inv.id)); });
        const cl = sheet.querySelector("[data-close]"); if (cl) cl.addEventListener("click", () => close());
        const go = sheet.querySelector("[data-go]");
        if (go) go.addEventListener("click", async () => {
          ui.setBusy(go, true, "Schließt ab …");
          try {
            const cur = B.normInvoice(col.inv.get(inv.id));
            const f = B.finalize(cur, st(), invoices(), today());
            await col.inv.put(JSON.parse(JSON.stringify({ ...f.invoice, updated: Date.now() })));
            await saveSettings({ counters: f.counters });
            ui.toast(`Rechnung ${f.invoice.number} abgeschlossen ✅`);
            close();
          } catch (e) { console.error(e); ui.setBusy(go, false); ui.toast((e && e.message) || "Abschließen fehlgeschlagen."); }
        });
      },
    });
  }
  function openPaid(inv) {
    const t = B.invoiceTotals(inv, st());
    openSheet({
      title: "💶 Als bezahlt markieren",
      bodyHTML: `<form class="fields ak-form bu-f" novalidate><p>Rechnung <b>${esc(inv.number)}</b> über <b>${esc(B.eur(t.gross))}</b>${inv.customer.name ? ` von ${esc(inv.customer.name)}` : ""}.</p>
        <div class="row2"><label>Geld eingegangen am<input id="bu-p-date" type="date" value="${esc(today())}" max="${esc(today())}"></label>
          <label>Zahlungsart<select id="bu-p-pay">${B.PAYS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("")}</select></label></div>
        <p class="note">Die App bucht automatisch ${t.groups.length > 1 ? `${t.groups.length} Einnahmen (eine je USt-Satz)` : "die Einnahme"} mit diesem Datum – das zählt für die E/A-Rechnung (Zufluss).</p>
        <div class="row"><button type="submit" class="btn primary" data-save>Bezahlt ✓</button></div></form>`,
      onMount(sheet, close) {
        sheet.querySelector("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const date = sheet.querySelector("#bu-p-date").value;
          if (!B.isKey(date)) { ui.toast("Bitte das Zahlungsdatum eintragen."); return; }
          const pay = sheet.querySelector("#bu-p-pay").value;
          const cur = B.normInvoice(col.inv.get(inv.id));
          if (cur.status !== "offen") { close(); return; }
          try {
            for (const b of B.paidBookings(cur, st(), { date, pay, newId })) await col.bel.put(b);
            await col.inv.put(JSON.parse(JSON.stringify({ ...col.inv.get(inv.id), status: "bezahlt", paidOn: date, pay, updated: Date.now() })));
            ui.toast("Bezahlt ✓ – Einnahme gebucht 💶");
            close();
          } catch (e) { console.error(e); ui.toast("Speichern fehlgeschlagen 🙈"); }
        });
      },
    });
  }
  function openStorno(inv) {
    const paid = inv.status === "bezahlt";
    const next = B.nextNumber(st(), invoices(), Number(today().slice(0, 4)));
    openSheet({
      title: "↩️ Rechnung stornieren",
      bodyHTML: `<form class="fields ak-form bu-f" novalidate><p>Rechnungen werden nie gelöscht. Stattdessen entsteht eine <b>Stornorechnung ${esc(next.number)}</b> mit negativen Beträgen, die auf <b>${esc(inv.number)}</b> verweist. Danach kannst du eine neue, richtige Rechnung schreiben.</p>
        ${paid ? `<label class="ak-check"><input id="bu-st-back" type="checkbox"> 💸 Geld wurde zurückgezahlt → Rückbuchung (negative Einnahme) anlegen</label><label>Rückzahlung am<input id="bu-st-date" type="date" value="${esc(today())}"></label>` : ""}
        <div class="row"><button type="submit" class="btn primary bu-dangerbtn" data-save>Stornieren</button></div></form>`,
      onMount(sheet, close) {
        sheet.querySelector("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          try {
            const cur = B.normInvoice(col.inv.get(inv.id));
            const r = B.stornoOf(cur, st(), invoices(), today(), newId);
            await col.inv.put(JSON.parse(JSON.stringify(r.storno)));
            await col.inv.put(JSON.parse(JSON.stringify({ ...col.inv.get(inv.id), status: "storniert", stornoId: r.storno.id, updated: Date.now() })));
            await saveSettings({ counters: r.counters });
            const back = sheet.querySelector("#bu-st-back");
            if (back && back.checked) {
              const date = sheet.querySelector("#bu-st-date").value || today();
              for (const b of B.paidBookings({ ...r.storno, number: r.storno.number }, st(), { date, pay: cur.pay || "bank", newId })) await col.bel.put({ ...b, note: `Rückzahlung Storno ${r.storno.number} zu ${cur.number}` });
            }
            ui.toast(`Storniert – Stornorechnung ${r.storno.number} erstellt ↩️`);
            close();
            A.go(B.invoiceHash(r.storno.id));
          } catch (e) { console.error(e); ui.toast((e && e.message) || "Stornieren fehlgeschlagen."); }
        });
      },
    });
  }

  /* ---------- Druck-Overlay (Rechnung + Jahres-Zusammenfassung) ---------- */

  let printer = null;
  function closePrint(fromPop = false) {
    if (!printer) return;
    const p = printer; printer = null;
    window.removeEventListener("popstate", p.onPop);
    document.removeEventListener("keydown", p.onKey);
    p.el.remove();
    document.body.classList.remove("bu-print-open");
    if (!fromPop && p.pushed && history.state && history.state.bup) history.back();
  }
  function openPrint({ title, paper, docTitle, share = null, file = null }) {
    closePrint();
    const el2 = document.createElement("div");
    el2.id = PRINT_ID;
    el2.className = "rp bu-pr";
    el2.setAttribute("role", "dialog"); el2.setAttribute("aria-modal", "true"); el2.setAttribute("aria-label", title);
    el2.tabIndex = -1;
    el2.innerHTML = `<div class="rp-bar"><button type="button" class="btn ghost sm rp-close" data-p="close">${icon("chevron-left", 18)}<span>Zurück</span></button><h2>${esc(title)}</h2></div>` + paper +
      `<div class="rp-actions"><button type="button" class="btn primary" data-p="print">${icon("file", 20)}<span>Drucken / als PDF speichern</span></button>` +
      (share ? `<button type="button" class="btn ghost" data-p="share">${icon("share", 20)}<span>Teilen</span></button>` : "") +
      (file ? `<button type="button" class="btn ghost" data-p="file">${icon("download", 20)}<span>Herunterladen (HTML)</span></button>` : "") + `</div>`;
    document.body.appendChild(el2);
    document.body.classList.add("bu-print-open");
    const p = { el: el2, pushed: false, onPop: () => closePrint(true), onKey: (ev) => { if (ev.key === "Escape") closePrint(); } };
    printer = p;
    try { history.pushState({ ...(history.state || {}), bup: 1 }, "", location.href); p.pushed = true; window.addEventListener("popstate", p.onPop); } catch { /* egal */ }
    document.addEventListener("keydown", p.onKey);
    el2.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-p]"); if (!b) return;
      if (b.dataset.p === "close") closePrint();
      else if (b.dataset.p === "print") { const prev = document.title; document.title = docTitle; try { window.print(); } catch { ui.toast("Drucken geht hier nicht."); } setTimeout(() => { document.title = prev; }, 1000); }
      else if (b.dataset.p === "share" && share) share();
      else if (b.dataset.p === "file" && file) file();
    });
    try { el2.focus({ preventScroll: true }); } catch { /* egal */ }
  }
  function invoiceText(inv) {
    const s = st(), sel = inv.seller || B.sellerOf(s), t = B.invoiceTotals(inv, s);
    return [`${inv.kind === "storno" ? "Stornorechnung" : "Rechnung"} ${inv.number} vom ${B.fmtKey(inv.date)}`, `${sel.firm}`, inv.customer.name ? `An: ${inv.customer.name}` : "",
      `Betrag: ${B.eur(t.gross)}${t.ku ? " (" + rule("kuHint") + ")" : ` (inkl. ${B.eur(t.vat)} USt)`}`,
      inv.kind === "rechnung" && inv.status !== "bezahlt" && sel.iban ? `Bitte bis ${B.fmtKey(inv.dueDate)} auf ${B.fmtIban(sel.iban)} überweisen, Verwendungszweck ${inv.number}.` : ""].filter(Boolean).join("\n");
  }
  function printInvoice(inv) {
    const name = `Rechnung-${inv.number || "Entwurf"}`.replace(/[^\w.-]+/g, "_");
    openPrint({ title: `🖨️ ${inv.kind === "storno" ? "Stornorechnung" : "Rechnung"} ${inv.number || "(Entwurf)"}`, paper: paperHTML(inv), docTitle: name,
      share: inv.status === "entwurf" ? null : () => shareInvoice(inv),
      file: () => download(name + ".html", standaloneHTML(name, paperHTML(inv)), "text/html;charset=utf-8") });
  }
  async function shareInvoice(inv) {
    const name = `Rechnung-${inv.number}`.replace(/[^\w.-]+/g, "_");
    const text = invoiceText(inv);
    if (navigator.share) { try { await navigator.share({ title: name, text }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(text); ui.toast("Als Text kopiert 📋 – das PDF bekommst du über „PDF / Drucken“."); } catch { ui.toast("Teilen hat nicht geklappt."); }
  }
  function printYear() {
    const s = st();
    const rep = B.report(belege(), S.year, { ku: s.kleinunternehmer, by: "month" });
    const q = B.report(belege(), S.year, { ku: s.kleinunternehmer, by: "quarter" });
    const cats = B.byCategory(belege(), S.year, s.kleinunternehmer);
    const inv = invoices().filter((i) => i.number && B.yearOf(i.date) === S.year);
    const tbl = (r) => { const rows = B.summaryRows(r); return `<table class="bu-p-table bu-y-table"><thead><tr>${rows[0].map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((x, i) => `<tr${i === rows.length - 2 ? ' class="tot"' : ""}>${x.map((c, j) => `<td${j ? ' class="m"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`; };
    const ku = s.kleinunternehmer ? B.kuProgress(belege(), invoices(), S.year) : null;
    const paper = `<article class="rp-paper bu-paper bu-year-p"><header class="bu-p-head"><div class="bu-p-from">${s.logo ? `<img class="bu-p-logo" src="${esc(s.logo)}" alt="Logo">` : ""}<b>${esc(s.firm || "Firma")}</b><span>${esc(s.address).replace(/\n/g, "<br>")}</span>${s.uid ? `<span>UID: ${esc(s.uid)}</span>` : ""}</div></header>
      <h1 class="bu-p-title">Jahres-Zusammenfassung ${S.year}</h1>
      <p class="bu-p-small">Einnahmen-Ausgaben-Rechnung nach Zahlungsdatum · ${s.kleinunternehmer ? "Kleinunternehmer (Bruttosystem)" : "Nettosystem, USt-Zahllast als Orientierung"} · erstellt am ${esc(B.fmtKey(today()))}</p>
      <h2 class="bu-p-h2">Quartale</h2>${tbl(q)}<h2 class="bu-p-h2">Monate</h2>${tbl(rep)}
      <h2 class="bu-p-h2">Nach Kategorie</h2><table class="bu-p-table"><thead><tr><th>Art</th><th>Kategorie</th><th class="m">Summe</th></tr></thead><tbody>${cats.map((c) => `<tr><td>${c.type === "in" ? "Einnahme" : "Ausgabe"}</td><td>${esc(c.label)}</td><td class="m">${esc(B.eur(c.sum))}</td></tr>`).join("") || `<tr><td colspan="3">–</td></tr>`}</tbody></table>
      <h2 class="bu-p-h2">Rechnungen</h2><p class="bu-p-small">${inv.length} ausgestellt (${inv.filter((i) => i.kind === "storno").length} Storno) · offen: ${esc(B.eur(inv.filter((i) => i.kind === "rechnung" && i.status === "offen").reduce((a, i) => a + B.invoiceTotals(i).gross, 0)))}</p>
      ${ku ? `<p class="bu-p-small">Kleinunternehmer-Grenze: ${esc(B.eur(ku.sum))} von ${esc(B.eur(ku.limit))} (${String(ku.pct).replace(".", ",")} %).</p>` : ""}
      <footer class="bu-p-foot">${esc(DISCLAIMER)} Belege ${rule("keepYears")} Jahre aufbewahren (bis 31.12.${S.year + rule("keepYears")}).</footer></article>`;
    openPrint({ title: `🖨️ Jahres-Zusammenfassung ${S.year}`, paper, docTitle: `Buchhaltung-${S.year}-Zusammenfassung` });
  }
  function standaloneHTML(title, paper) {
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${FILE_CSS}</style></head><body>${paper}</body></html>`;
  }

  /* ---------- Ereignisse ---------- */

  const onClick = (ev) => {
    const b = ev.target.closest("[data-bu],[data-ak]");
    if (!b || !el.contains(b)) return;
    const a = b.dataset.bu || b.dataset.ak;
    const curInv = () => { const d = b.closest(".bu-det"); const x = d && col.inv.get(d.dataset.id); return x ? B.normInvoice(x) : null; };
    switch (a) {
      case "new-out": openBeleg(null, "out"); break;
      case "new-in": openBeleg(null, "in"); break;
      case "new-inv": openInvoiceForm(); break;
      case "beleg": { const x = col.bel.get(b.dataset.id); if (x) openBeleg(B.normBeleg(x)); break; }
      case "year-": S.year--; render(); break;
      case "year+": S.year++; render(); break;
      case "btype": S.belType = b.dataset.v; renderBelege(false); break;
      case "ifilter": S.invFilter = b.dataset.v; render(); break;
      case "by": S.by = b.dataset.v; render(); break;
      case "exp-belege": exportFile("belege"); break;
      case "exp-inv": exportFile("inv"); break;
      case "exp-list": exportFile("list"); break;
      case "exp-xlsx": exportFile("xlsx"); break;
      case "year-pdf": printYear(); break;
      case "logo-del": A.safe(saveSettings({ logo: "" }), "Logo entfernt").then(() => { built = ""; render(); }); break;
      case "inv-edit": { const i = curInv(); if (i) openInvoiceForm(col.inv.get(i.id)); break; }
      case "inv-final": { const i = curInv(); if (i) openFinalize(i); break; }
      case "inv-paid": { const i = curInv(); if (i) openPaid(i); break; }
      case "inv-storno": { const i = curInv(); if (i) openStorno(i); break; }
      case "inv-print": { const i = curInv(); if (i) printInvoice(i); break; }
      case "inv-share": { const i = curInv(); if (i) shareInvoice(i); break; }
      case "inv-del": {
        const i = curInv();
        if (!i || i.status !== "entwurf" || i.number) break;
        if (b.dataset.armed) { A.safe(col.inv.remove(i.id), "Entwurf gelöscht 🗑️").then(() => A.go("#alltag/buchhaltung/rechnungen")); break; }
        b.dataset.armed = "1"; b.querySelector("span").textContent = "Wirklich löschen?"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.querySelector("span").textContent = "Entwurf löschen"; } }, 4000);
        break;
      }
      default: break;
    }
  };
  el.addEventListener("click", onClick);
  const offs = [col.set.watch(queue), col.bel.watch(queue), col.inv.watch(queue), col.kt.watch(() => {}), A.watchDocs(() => { if (S.tab === "export") queue(); }),
    A.onRoute((h) => { if (/^#alltag\/buchhaltung/.test(h)) { if (!/\/beleg\//.test(h)) S.openedFor = ""; render(); window.scrollTo(0, 0); } })];
  render();
  return () => {
    alive = false;
    el.removeEventListener("click", onClick);
    offs.forEach((f) => { try { f(); } catch { /* egal */ } });
    for (const sh of sheets) { try { sh.close(); } catch { /* egal */ } }
    closePrint();
  };
}

/** Eingebettete Stile für die heruntergeladene Rechnung (eigenständige Datei, ohne Skripte). */
const FILE_CSS = `body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;background:#fff;margin:0;padding:24px}
.bu-paper{max-width:780px;margin:0 auto;position:relative;display:flex;flex-direction:column;gap:14px}
.bu-p-head{display:flex;justify-content:flex-end}.bu-p-from{display:flex;flex-direction:column;align-items:flex-end;text-align:right;font-size:12px;color:#444}
.bu-p-from b{font-size:16px;color:#111}.bu-p-logo{max-height:60px;max-width:180px;margin-bottom:6px}
.bu-p-mid{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}.bu-p-to{display:flex;flex-direction:column}.bu-p-to small{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.05em}
.bu-p-meta{display:grid;grid-template-columns:auto auto;gap:2px 12px;margin:0;font-size:13px}.bu-p-meta dt{color:#555}.bu-p-meta dd{margin:0;font-weight:600;text-align:right}
.bu-p-title{font-size:22px;margin:8px 0 0}.bu-p-small{font-size:12px;color:#444;margin:0}
.bu-p-table{width:100%;border-collapse:collapse;font-size:13px}.bu-p-table th{text-align:left;font-size:11px;color:#555;border-bottom:1.5px solid #111;padding:6px}
.bu-p-table td{padding:6px;border-bottom:1px solid #ddd;vertical-align:top}.bu-p-table .m,.bu-p-table .r,.bu-p-table .q{text-align:right;white-space:nowrap}.bu-p-table .n{width:2.5em}
.bu-p-sum{display:grid;grid-template-columns:1fr auto;gap:3px 16px;margin:0 0 0 auto;min-width:260px;font-size:13px}.bu-p-sum dt{text-align:right;color:#444}.bu-p-sum dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.bu-p-sum .tot{font-weight:800;font-size:15px;border-top:1.5px solid #111;padding-top:3px}.bu-p-ku{font-weight:600}.bu-p-foot{border-top:1px solid #ccc;padding-top:8px;font-size:11px;color:#555;text-align:center}
.bu-p-wm{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:72px;font-weight:800;color:rgba(200,30,30,.12);transform:rotate(-18deg);pointer-events:none}
@media print{body{padding:0}@page{size:A4;margin:14mm}}`;
