// Update 12 – Alltag › 📊 Mein Leben (#alltag/leben): 🧬 Digital Twin (nur freigegebene Bereiche), 📊 Statistik
// (Woche/Monat/Jahr, Vergleich mit davor, Zeitverteilung, 12-Monats-Verlauf, CSV-Export) und 🎉 Jahresrückblick.
// Rechnet nur aus vorhandenen Daten (js/life-core.js), speichert nichts außer der Freigabe (Sammlung „spiel“, Dokument "me").
import { collection } from "./db.js";
import * as L from "../life-core.js";
import * as G from "../spiel-core.js";
import { watchLife } from "./life-data.js";
import * as A from "./akten-ui.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const TAB_KEY = "sk-leben-tab";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const TABS = [["twin", "🧬", "Digital Twin"], ["stats", "📊", "Statistik"], ["jahr", "🎉", "Jahresrückblick"]];
function loadCss() {
  if (document.querySelector('link[data-css="leben"]')) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.css = "leben";
  l.href = new URL("../../css/alltag-leben.css", import.meta.url).href; document.head.appendChild(l);
}
const eur = (v) => (Number(v) || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export function mount(el) {
  loadCss();
  const sp = collection("spiel");
  const S = { tab: TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "twin", kind: "week", off: 0, year: new Date().getFullYear() };
  let inp = null, alive = true;
  const me = () => G.normMe(sp.get("me") || {});
  const live = watchLife((x) => { inp = x; render(); });
  const offSp = sp.watch(() => { if (inp) render(); });

  function render() {
    if (!alive) return;
    if (!inp) { el.innerHTML = `<p class="note">Lade …</p>`; return; }
    const acts = L.activities(inp);
    el.innerHTML = `<div class="lb"><div class="lb-tabs" role="tablist">${TABS.map(([id, e, l]) => `<button type="button" role="tab" class="lb-tab${S.tab === id ? " on" : ""}" aria-selected="${S.tab === id}" data-tab="${id}"><span aria-hidden="true">${e}</span>${l}</button>`).join("")}</div>
      ${S.tab === "stats" ? statsHTML(acts) : S.tab === "jahr" ? yearHTML() : twinHTML(acts)}</div>`;
  }

  /* ---------- Digital Twin ---------- */
  function twinHTML(acts) {
    const m = me();
    if (!m.twinAreas) return `<section class="card lb-consent"><h3>🧬 Dein Digital Twin</h3>
      <p>Dein Twin zeigt, wie es in deinen Lebensbereichen läuft – berechnet <b>nur auf diesem Konto</b> aus Daten, die schon in der App sind. Nichts wird an eine KI geschickt.</p>
      <p><b>Welche Bereiche darf er verwenden?</b></p><div class="chips" data-r="areas">${L.AREAS.map((a) => `<button type="button" class="chip" data-area="${a.id}" aria-pressed="false">${a.e} ${a.t}</button>`).join("")}</div>
      <div class="lb-row"><button type="button" class="btn ghost sm" data-lb="allareas">Alle auswählen</button><button type="button" class="btn primary sm" data-lb="consent">✅ Freigeben</button></div></section>`;
    const today = A.todayKey();
    const tw = L.twin(acts, today, m.twinAreas);
    const lv = G.levelOf(G.totalXp(acts));
    const avg = tw.length ? Math.round(tw.reduce((n, x) => n + x.score, 0) / tw.length) : 0;
    const strongest = [...tw].sort((a, b) => b.score - a.score)[0], growing = [...tw].sort((a, b) => b.trend - a.trend)[0];
    const hat = G.SHOP.find((i) => i.id === m.wear.hat);
    return `<section class="card lb-twin"><div class="lb-ava" aria-hidden="true">${esc(m.avatar)}${hat ? `<span class="lb-hat">${hat.e}</span>` : ""}</div>
        <div><h3>Dein Twin · Level ${lv.level}</h3><small>Balance der letzten 4 Wochen: <b>${avg}%</b></small>
        ${strongest && strongest.score ? `<p>💪 Stärkster Bereich: <b>${strongest.e} ${esc(strongest.t)}</b>${growing && growing.trend > 0 ? ` · 📈 wächst: <b>${growing.e} ${esc(growing.t)}</b>` : ""}</p>` : `<p>Mach einfach weiter wie gewohnt – dein Twin wächst mit. 🌱</p>`}</div></section>
      <ul class="lb-areas">${tw.map((a) => `<li><span class="lb-ae" aria-hidden="true">${a.e}</span><div class="lb-am"><div class="lb-row"><b>${esc(a.t)}</b><span class="lb-sp"></span><small>${a.days} aktive Tage ${a.trend ? `<span class="${a.trend > 0 ? "up" : "down"}">${a.trend > 0 ? "▲" : "▼"} ${Math.abs(a.trend)}</span>` : ""}</small></div>
        <span class="lb-bar" aria-label="${a.score} Prozent"><i style="width:${a.score}%;background:${a.color}"></i></span></div></li>`).join("")}</ul>
      <p class="note">Richtwerte: Der Balken ist voll, wenn du in 4 Wochen so oft aktiv warst wie ein guter Durchschnitt (z. B. 12 Lerntage, 8 Sporttage). Kein Druck – Urlaub und Krankheit sind völlig okay. 💛</p>
      <button type="button" class="btn ghost sm" data-lb="areas">🔒 Freigegebene Bereiche ändern</button>`;
  }

  /* ---------- Statistik ---------- */
  function statsHTML(acts) {
    const today = A.todayKey();
    const cur = L.range(S.kind, today, S.off), prev = L.range(S.kind, today, S.off - 1);
    const cmp = L.compareAreas(acts, cur, prev);
    const totalMin = cmp.reduce((n, a) => n + a.cur.min, 0) || 1;
    const mo = L.money(inp, cur.from, cur.to);
    const hist = L.monthly(acts, today, 12);
    const maxM = Math.max(1, ...hist.map((h) => Object.values(h.areas).reduce((a, b) => a + b, 0)));
    const vs = { week: "Vorwoche", month: "Vormonat", year: "Vorjahr" }[S.kind];
    return `<div class="lb-row"><div class="chips">${[["week", "Woche"], ["month", "Monat"], ["year", "Jahr"]].map(([k, l]) => `<button type="button" class="chip" data-kind="${k}" aria-pressed="${S.kind === k}">${l}</button>`).join("")}</div></div>
      <div class="lb-row lb-nav"><button type="button" class="btn ghost sm" data-off="-1" aria-label="Davor">‹</button><b>${esc(cur.label)}</b><button type="button" class="btn ghost sm" data-off="1" aria-label="Danach"${S.off >= 0 ? " disabled" : ""}>›</button></div>
      <section class="card"><h3>⏳ Zeitverteilung</h3>${cmp.some((a) => a.cur.min) ? `<div class="lb-stack" role="img" aria-label="Zeitverteilung">${cmp.filter((a) => a.cur.min).map((a) => `<i style="flex:${a.cur.min};background:${a.color}" title="${esc(a.t)}: ${L.fmtH(a.cur.min)}"></i>`).join("")}</div>
        <ul class="lb-legend">${cmp.filter((a) => a.cur.min).map((a) => `<li><span style="background:${a.color}"></span>${a.e} ${esc(a.t)} <b>${L.fmtH(a.cur.min)}</b> <small>${Math.round((a.cur.min / totalMin) * 100)} %</small></li>`).join("")}</ul>` : `<p class="note">In diesem Zeitraum gibt es keine gemessenen Zeiten.</p>`}</section>
      <section class="card"><h3>📊 Aktive Tage je Bereich <small>vs. ${vs}</small></h3><table class="lb-tbl"><tbody>${cmp.map((a) => `<tr><td>${a.e} ${esc(a.t)}</td><td><b>${a.cur.days}</b></td><td class="${a.delta > 0 ? "up" : a.delta < 0 ? "down" : ""}">${a.delta > 0 ? "▲ " + a.delta : a.delta < 0 ? "▼ " + -a.delta : "–"}</td></tr>`).join("")}</tbody></table></section>
      ${mo ? `<section class="card"><h3>💶 Finanzen</h3><div class="lb-kpis"><span><small>Einnahmen</small><b>${eur(mo.income)}</b></span><span><small>Ausgaben</small><b>${eur(mo.expense)}</b></span><span><small>Gespart</small><b class="${mo.saved >= 0 ? "up" : "down"}">${eur(mo.saved)}</b></span></div></section>` : inp.moneyLocked ? `<p class="note">🔒 Finanzen ausgeblendet (Geld-Sperre aktiv).</p>` : ""}
      <section class="card"><h3>📈 Letzte 12 Monate</h3><div class="lb-chart" role="img" aria-label="Aktive Tage pro Monat">${hist.map((h) => `<div class="lb-col"><div class="lb-colbar">${L.AREAS.map((a) => h.areas[a.id] ? `<i style="height:${(h.areas[a.id] / maxM) * 100}%;background:${a.color}"></i>` : "").join("")}</div><small>${esc(h.label)}</small></div>`).join("")}</div></section>
      <button type="button" class="btn ghost sm" data-lb="csv">⬇️ Als CSV exportieren</button>`;
  }

  /* ---------- Jahresrückblick ---------- */
  function yearHTML() {
    const y = L.yearReview(inp, S.year);
    const tile = (e, v, l) => `<div class="lb-tile"><span aria-hidden="true">${e}</span><b>${v}</b><small>${l}</small></div>`;
    const any = y.workDays || y.learnDays || y.sportDays || y.chores || y.todos || y.travelDays;
    return `<div class="lb-row lb-nav"><button type="button" class="btn ghost sm" data-year="-1" aria-label="Jahr davor">‹</button><b>${S.year}</b><button type="button" class="btn ghost sm" data-year="1" aria-label="Jahr danach"${S.year >= new Date().getFullYear() ? " disabled" : ""}>›</button></div>
      <section class="lb-hero"><h2>🎉 Dein Jahr ${S.year}</h2><p>${any ? "Schau, was du alles geschafft hast:" : "Für dieses Jahr gibt es noch keine Daten."}</p></section>
      ${any ? `<div class="lb-tiles">${tile("🛠️", y.workHours + " h", `gearbeitet an ${y.workDays} Tagen`)}${tile("📚", y.learnXp, `Lern-XP an ${y.learnDays} Tagen`)}${tile("💪", y.sportHours + " h", `Sport an ${y.sportDays} Tagen`)}
        ${tile("🧽", y.chores, "Haushaltsaufgaben")}${tile("✅", y.todos, "Aufgaben erledigt")}${tile("✈️", y.travelDays, "Reisetage")}
        ${y.series + y.films + y.books + y.games ? tile("🎬", y.series + y.films + y.books + y.games, `${y.films} Filme · ${y.series} Serien · ${y.books} Bücher · ${y.games} Games`) : ""}
        ${y.money ? tile("💶", eur(y.money.saved), "gespart") : ""}</div>
        <section class="card">${y.topMonth ? `<p>🏆 Aktivster Monat: <b>${new Date(y.topMonth + "-15").toLocaleDateString("de-AT", { month: "long" })}</b></p>` : ""}${y.busiestDay ? `<p>📅 Vollster Tag: <b>${A.fmtKey(y.busiestDay)}</b></p>` : ""}</section>
        <button type="button" class="btn primary sm" data-lb="shareyear">📤 Rückblick teilen</button>` : ""}`;
  }

  function areaSheet() {
    const cur = new Set(me().twinAreas || []);
    ui.openSheet({ title: "🔒 Freigabe für den Digital Twin", bodyHTML: `<p class="note">Nur diese Bereiche fließen in deinen Twin ein.</p><div class="chips" data-r="areas">${L.AREAS.map((a) => `<button type="button" class="chip" data-area="${a.id}" aria-pressed="${cur.has(a.id)}">${a.e} ${a.t}</button>`).join("")}</div>
      <div class="row"><button type="button" class="btn ghost sm" data-off>Twin ausschalten</button><button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sh, close) {
        sh.querySelector('[data-r="areas"]').addEventListener("click", (ev) => { const c = ev.target.closest("[data-area]"); if (!c) return; cur.has(c.dataset.area) ? cur.delete(c.dataset.area) : cur.add(c.dataset.area); c.setAttribute("aria-pressed", String(cur.has(c.dataset.area))); });
        sh.querySelector("[data-save]").addEventListener("click", () => { close(); A.safe(sp.put({ ...me(), twinAreas: [...cur] }), "🔒 Freigabe gespeichert"); });
        sh.querySelector("[data-off]").addEventListener("click", () => { close(); A.safe(sp.put({ ...me(), twinAreas: null }), "Twin ausgeschaltet"); });
      } });
  }

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b || !el.contains(b)) return;
    const d = b.dataset;
    if (d.tab) { S.tab = d.tab; lsSet(TAB_KEY, S.tab); render(); return; }
    if (d.kind) { S.kind = d.kind; S.off = 0; render(); return; }
    if (d.off) { S.off = Math.min(0, S.off + Number(d.off)); render(); return; }
    if (d.year) { S.year = Math.min(new Date().getFullYear(), S.year + Number(d.year)); render(); return; }
    if (d.area && b.closest(".lb-consent")) { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); return; }
    switch (d.lb) {
      case "allareas": el.querySelectorAll(".lb-consent [data-area]").forEach((x) => x.setAttribute("aria-pressed", "true")); break;
      case "consent": {
        const sel = [...el.querySelectorAll('.lb-consent [data-area][aria-pressed="true"]')].map((x) => x.dataset.area);
        if (!sel.length) { ui.toast("Wähl mindestens einen Bereich."); break; }
        A.safe(sp.put({ ...me(), twinAreas: sel }), "🧬 Dein Twin ist erwacht!"); break;
      }
      case "areas": areaSheet(); break;
      case "csv": {
        const blob = new Blob(["﻿" + L.csv(L.activities(inp))], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `stempelkarte-aktivitaeten-${A.todayKey()}.csv`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); break;
      }
      case "shareyear": {
        const y = L.yearReview(inp, S.year);
        const t = `🎉 Mein Jahr ${S.year}\n🛠️ ${y.workHours} h gearbeitet\n📚 ${y.learnXp} Lern-XP\n💪 ${y.sportHours} h Sport\n✅ ${y.todos} Aufgaben erledigt\n✈️ ${y.travelDays} Reisetage`;
        navigator.clipboard?.writeText(t).then(() => ui.toast("📋 Rückblick kopiert")).catch(() => ui.toast("Kopieren nicht möglich")); break;
      }
      default: break;
    }
  });
  render();
  return () => { alive = false; live.off(); try { offSp(); } catch { /* egal */ } };
}
