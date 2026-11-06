// Update 10c – Arbeitszeit-Pro in der Übersicht (#worktime-panel):
// 📈 Prognose (Soll/Ist Woche & Monat, Kontostand am Monatsende), 🧮 Was-wäre-wenn, 💼 Konten,
// 🕵️ Vergessene Stempelungen (Nachtragen) und 🔒 Monatsabschluss. Rechnungen in ../worktime-core.js.
import * as WT from "../worktime-core.js";
import { leaveStats, fmtDays } from "./leave.js";

let ctx = null;
let root = null;
let snap = null;
const last = {};
const $ = (sel) => root.querySelector(sel);

function ensureCss() {
  if (document.getElementById("wt-css")) return;
  const l = document.createElement("link");
  l.id = "wt-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/worktime.css", import.meta.url).href;
  document.head.appendChild(l);
}

const signed = (min) => { const m = Math.round(min); return (m < 0 ? "−" : "+") + ctx.util.hm(Math.abs(m)) + " h"; };
const cls = (min) => (Math.round(min) < 0 ? "minus" : "plus");
const hmr = (min) => ctx.util.hm(Math.round(min));
function fmtKey(k, wd = true) {
  const d = WT.keyDate(k);
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${wd ? ctx.util.WD[d.getDay()] + ", " : ""}${p(d.getDate())}.${p(d.getMonth() + 1)}.`;
}
function set(sel, html) {
  const el = $(sel);
  if (el && last[sel] !== html) { el.innerHTML = html; last[sel] = html; }
}

function input() {
  const r = snap.running;
  const runningNetMin = r && ctx.timer ? Math.max(0, ctx.timer.netMs(r) / 60000) : 0;
  return { entries: snap.entries || [], settings: snap.settings || {}, running: r || null, runningNetMin, now: Date.now() };
}

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  ensureCss();
  root.classList.add("wt");
  const y = new Date().getFullYear();
  const wdChips = [1, 2, 3, 4, 5, 6, 0].map((d) =>
    `<button type="button" class="chip" data-wif-wd="${d}" aria-pressed="${d === 5}">${ctx.util.WD[d]}</button>`).join("");
  root.innerHTML = `
    <section class="panel card wt-card" id="wt-forecast" aria-labelledby="wt-fc-h">
      <h2 id="wt-fc-h"><span aria-hidden="true">📈</span> Prognose</h2>
      <div class="wt-grid" data-r="fc"></div>
      <div class="wt-eom" data-r="eom"></div>
      <details class="wt-wif" id="wt-wif">
        <summary><span aria-hidden="true">🧮</span> Was wäre, wenn …?</summary>
        <div class="fields">
          <div><div class="lbl">An welchen Tagen?</div><div class="chips ov-wd" role="group" aria-label="Wochentage">${wdChips}</div>
            <p class="note">Keiner gewählt = jeder Arbeitstag.</p></div>
          <div class="row">
            <label>Minuten pro Tag (± möglich)
              <input type="number" id="wt-wif-min" inputmode="numeric" step="5" min="-600" max="600" value="30">
            </label>
            <label>bis
              <input type="date" id="wt-wif-until" value="${y}-12-31">
            </label>
          </div>
          <div class="wt-wif-res" data-r="wif" aria-live="polite"></div>
        </div>
      </details>
    </section>

    <section class="panel card wt-card" id="wt-accounts" aria-labelledby="wt-acc-h">
      <h2 id="wt-acc-h"><span aria-hidden="true">💼</span> Konten</h2>
      <div class="wt-acc" data-r="acc"></div>
    </section>

    <section class="panel card wt-card" id="wt-gaps" aria-labelledby="wt-gap-h">
      <h2 id="wt-gap-h"><span aria-hidden="true">🕵️</span> Vergessen zu stempeln?</h2>
      <div data-r="gaps"></div>
    </section>

    <section class="panel card wt-card" id="wt-close" aria-labelledby="wt-cl-h">
      <h2 id="wt-cl-h"><span aria-hidden="true">🔒</span> Monatsabschluss</h2>
      <p class="note">Abgeschlossene Monate sind geschützt: Wer dort etwas ändert, wird vorher gefragt. Die Summen werden beim Abschluss festgehalten.</p>
      <div data-r="close"></div>
    </section>`;

  root.addEventListener("click", onClick);
  $("#wt-wif-min").addEventListener("input", renderWhatIf);
  $("#wt-wif-until").addEventListener("change", renderWhatIf);
}

export function update(s) {
  snap = s;
  if (!root || !snap || snap.ready === false) return;
  try { renderForecast(); } catch (err) { console.error(err); }
  try { renderWhatIf(); } catch (err) { console.error(err); }
  try { renderAccounts(); } catch (err) { console.error(err); }
  try { renderGaps(); } catch (err) { console.error(err); }
  try { renderClose(); } catch (err) { console.error(err); }
}

/* ---------- Prognose ---------- */

function renderForecast() {
  const f = WT.forecast(input());
  const tile = (label, x) => {
    const pct = x.soll > 0 ? Math.min(100, Math.round((x.ist / x.soll) * 100)) : 0;
    return `<div class="wt-tile"><div class="wt-tl">${label}</div>
      <div class="wt-tv"><b>${hmr(x.ist)}</b> / ${hmr(x.soll)} h</div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="wt-ts">${x.open > 0 ? `noch ${hmr(x.open)} h offen` : x.soll > 0 ? "Soll erreicht 🎉" : "kein Soll"}</div></div>`;
  };
  set('[data-r="fc"]', tile("Diese Woche", f.week) + tile(ctx.util.MONTHS[Number(f.month.key.slice(5)) - 1], f.month));
  const e = f.endOfMonth;
  set('[data-r="eom"]', `<div class="kv"><span>Kontostand am ${esc(fmtKey(e.key, false))}</span><b class="${cls(e.balance)}">${esc(signed(e.balance))}</b></div>
    <div class="kv"><span>Monatssaldo dann</span><b class="${cls(f.month.endDiff)}">${esc(signed(f.month.endDiff))}</b></div>
    <p class="note">🔮 Wenn du an den ${e.workDays} restlichen Arbeitstagen genau dein Soll arbeitest${e.futureCredit > 0 ? ` (eingetragener Urlaub o. Ä. ist schon drin)` : ""}. Feiertage und Schultage haben kein Soll.</p>`);
}

/* ---------- Was-wäre-wenn ---------- */

function wifRule() {
  const wds = [...root.querySelectorAll("[data-wif-wd]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => Number(b.dataset.wifWd));
  return { weekdays: wds, deltaMin: Number($("#wt-wif-min").value) || 0, until: $("#wt-wif-until").value };
}
function renderWhatIf() {
  if (!snap) return;
  const rule = wifRule();
  const r = WT.whatIf(input(), rule);
  if (r.error) { set('[data-r="wif"]', `<p class="note">${esc(r.error)}</p>`); return; }
  set('[data-r="wif"]', `<p class="wt-wif-q">${esc(WT.whatIfLabel(rule))}</p>
    <div class="kv"><span>Kontostand am ${esc(fmtKey(r.until, false))}</span><b class="${cls(r.result)}">${esc(signed(r.result))}</b></div>
    <div class="kv"><span>ohne Änderung</span><b class="${cls(r.base)}">${esc(signed(r.base))}</b></div>
    <p class="note">${r.days} ${r.days === 1 ? "Tag" : "Tage"} × ${esc(signed(r.deltaMin))} = ${esc(signed(r.diff))} · gerechnet mit deinem Soll, Feiertagen, Schultagen und eingetragenen Abwesenheiten.</p>`);
}

/* ---------- Konten ---------- */

function renderAccounts() {
  const bal = WT.currentBalance(input());
  const h = WT.hourAccounts(bal.total);
  const wt = WT.readWorktime(snap.settings);
  let lv = null;
  try { lv = leaveStats(snap, new Date()); } catch (err) { console.error(err); }
  const item = (emoji, label, val, sub, c = "") =>
    `<div class="wt-acc-i ${c}"><span class="wt-acc-e" aria-hidden="true">${emoji}</span><div><div class="wt-acc-l">${esc(label)}</div><div class="wt-acc-v">${val}</div>${sub ? `<div class="wt-acc-s">${sub}</div>` : ""}</div></div>`;
  set('[data-r="acc"]',
    item("⏫", "Überstunden", esc(hmr(h.plus) + " h"), h.plus ? "auf deinem Konto" : "gerade keine", h.plus ? "plus" : "") +
    item("⏬", "Minusstunden", esc(hmr(h.minus) + " h"), h.minus ? "noch aufzuholen" : "alles im grünen Bereich 🌿", h.minus ? "minus" : "") +
    (lv ? item("🌴", wt.leaveLabel, `${esc(fmtDays(lv.left))} <small>von ${esc(fmtDays(lv.entitled))} Tagen übrig</small>`,
      `${esc(fmtDays(lv.usedN))} genommen${lv.plannedN ? ` · ${esc(fmtDays(lv.plannedN))} geplant` : ""}`, lv.left < 0 ? "minus" : "") : "") +
    (lv ? item("⚖️", "Zeitausgleich", esc(hmr(lv.zaMin) + " h"), `${lv.za.length} ${lv.za.length === 1 ? "Tag" : "Tage"} ${lv.year} · aus deinen Überstunden`) : ""));
}

/* ---------- Vergessene Stempelungen ---------- */

const GAP_TXT = {
  leer: () => "Kein Eintrag an diesem Arbeitstag",
  lang: (g) => `Sehr lange Schicht (${hmr(g.min)} h)`,
  offen: () => "Eintrag ohne gültiges Ende",
  laeuft: (g) => `Läuft schon seit ${hmr(g.min)} h – Ausstempeln vergessen?`,
};
let gapList = [];
function renderGaps() {
  const wt = WT.readWorktime(snap.settings);
  gapList = WT.missingStamps({ ...input(), days: wt.gapDays });
  if (!gapList.length) {
    set('[data-r="gaps"]', `<p class="note wt-ok">✅ Alles gestempelt – in den letzten ${wt.gapDays} Tagen fehlt nichts.</p>`);
    return;
  }
  const show = gapList.slice(0, 8);
  set('[data-r="gaps"]', `<ul class="wt-gaps">${show.map((g, i) => `<li class="wt-gap wt-gap-${g.type}">
      <div><b>${esc(fmtKey(g.key))}</b><small>${esc(GAP_TXT[g.type](g))}</small></div>
      <div class="wt-gap-a">
        ${g.type === "laeuft" ? `<button type="button" class="btn sm primary" data-gap-go="${i}">Zur Stempeluhr</button>`
          : `<button type="button" class="btn sm primary" data-gap="${i}">${g.type === "leer" ? "➕ Nachtragen" : "✏️ Prüfen"}</button>`}
        ${g.type !== "laeuft" ? `<button type="button" class="btn sm ghost" data-gap-ign="${i}" aria-label="Ignorieren" title="Passt so – ausblenden">Passt so</button>` : ""}
      </div></li>`).join("")}</ul>
    ${gapList.length > show.length ? `<p class="note">… und ${gapList.length - show.length} weitere.</p>` : ""}
    <p class="note">Zählt Arbeitstage mit Soll ohne Eintrag, Schichten über 12 h und Einträge ohne Ende. „Passt so“ blendet den Hinweis aus (z. B. unbezahlt frei).</p>`);
}

/* ---------- Monatsabschluss ---------- */

function closeCandidates() {
  const now = new Date();
  const out = [];
  // ab dem früheren von Kontobeginn und erstem Eintrag (keine leeren Monate davor)
  const sk = WT.balanceStartKey(snap.settings, snap.entries || [], snap.running);
  const fe = WT.balanceStartKey({}, snap.entries || [], snap.running);
  const firstK = [sk, fe].filter(Boolean).sort()[0];
  const first = firstK ? firstK.slice(0, 7) : WT.monthKeyOf(now);
  for (let i = 0; i < 4; i++) { const mk = WT.monthKeyOf(new Date(now.getFullYear(), now.getMonth() - i, 1)); if (mk >= first) out.push(mk); }
  for (const k of WT.readClosed(snap.settings).keys()) if (!out.includes(k)) out.push(k);
  return out.sort().reverse().slice(0, 8);
}
function renderClose() {
  const closed = WT.readClosed(snap.settings);
  const cur = WT.monthKeyOf(Date.now());
  const rows = closeCandidates().map((mk) => {
    const c = closed.get(mk);
    if (c) {
      const t = c.totals || {};
      const at = new Date(Number(c.at) || 0);
      return `<li class="wt-mo is-closed"><div><b>🔒 ${esc(WT.monthLabel(mk))}</b>
        <small>abgeschlossen am ${esc(`${String(at.getDate()).padStart(2, "0")}.${String(at.getMonth() + 1).padStart(2, "0")}.${at.getFullYear()}`)} · Ist ${esc(hmr(t.ist || 0))} / Soll ${esc(hmr(t.soll || 0))} h · <span class="${cls(t.diff || 0)}">${esc(signed(t.diff || 0))}</span>${Number.isFinite(c.balance) ? ` · Konto ${esc(signed(c.balance))}` : ""}</small>
        <small>${t.workDays || 0} Arbeitstage · ${t.urlaub || 0} Urlaub · ${t.krank || 0} Krank · ${t.za || 0} ZA</small></div>
        <button type="button" class="btn sm ghost" data-reopen="${esc(mk)}">🔓 Öffnen</button></li>`;
    }
    const t = WT.monthTotals(input(), mk);
    const running = mk === cur;
    return `<li class="wt-mo"><div><b>${esc(WT.monthLabel(mk))}</b>
      <small>Ist ${esc(hmr(t.ist))} / Soll ${esc(hmr(t.soll))} h · <span class="${cls(t.diff)}">${esc(signed(t.diff))}</span>${running ? " · läuft noch" : ""}</small></div>
      <button type="button" class="btn sm ${running ? "ghost" : "primary"}" data-close="${esc(mk)}">✅ Abschließen</button></li>`;
  });
  set('[data-r="close"]', `<ul class="wt-mos">${rows.join("")}</ul>`);
  root.querySelectorAll("[data-close]").forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = "1";
    const mk = b.dataset.close;
    ctx.ui.confirmButton(b, mk === WT.monthKeyOf(Date.now()) ? "Laufenden Monat abschließen?" : "Wirklich abschließen?", () => doClose(mk));
  });
  root.querySelectorAll("[data-reopen]").forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = "1";
    ctx.ui.confirmButton(b, "Monat wieder öffnen?", () => doReopen(b.dataset.reopen));
  });
}

async function doClose(mk) {
  const s = ctx.store.get();
  if (snap.running && WT.monthKeyOf(snap.running.start) === mk) { ctx.ui.toast("⏱️ Erst ausstempeln – die laufende Schicht gehört noch zu diesem Monat.", 3500); return; }
  const totals = WT.monthTotals({ entries: s.entries || [], settings: s.settings || {} }, mk);
  const balance = WT.balanceAtMonthEnd({ entries: s.entries || [], settings: s.settings || {} }, mk);
  try {
    await ctx.store.saveSettings({ closedMonths: WT.closeMonth(s.settings, mk, totals, Date.now(), balance) });
    ctx.ui.toast(`🔒 ${WT.monthLabel(mk)} abgeschlossen – gut gemacht!`);
  } catch { /* Toast kommt vom Store */ }
}
async function doReopen(mk) {
  const s = ctx.store.get();
  try {
    await ctx.store.saveSettings({ closedMonths: WT.reopenMonth(s.settings, mk) });
    ctx.ui.toast(`🔓 ${WT.monthLabel(mk)} wieder geöffnet`);
  } catch { /* Toast kommt vom Store */ }
}

/* ---------- Klicks ---------- */

function onClick(ev) {
  const wd = ev.target.closest("[data-wif-wd]");
  if (wd) {
    wd.setAttribute("aria-pressed", String(wd.getAttribute("aria-pressed") !== "true"));
    renderWhatIf();
    return;
  }
  const g = ev.target.closest("[data-gap]");
  if (g) {
    const x = gapList[Number(g.dataset.gap)];
    if (!x) return;
    if (x.entry) ctx.openEntryForm(x.entry);
    else ctx.openEntryForm(null, { kind: "work", date: x.key });
    return;
  }
  if (ev.target.closest("[data-gap-go]")) { location.hash = "#heute"; return; }
  const ig = ev.target.closest("[data-gap-ign]");
  if (ig) {
    const x = gapList[Number(ig.dataset.gapIgn)];
    if (!x) return;
    const s = ctx.store.get().settings || {};
    const w = s.worktime && typeof s.worktime === "object" ? s.worktime : {};
    const list = WT.readWorktime(s).ignoreGaps;
    const id = x.type === "leer" ? x.key : x.entry && x.entry.id;
    if (!id || list.includes(id)) return;
    ctx.store.saveSettings({ worktime: { ...w, ignoreGaps: [...list, id].slice(-200) } })
      .then(() => ctx.ui.toast("👍 Ausgeblendet")).catch(() => { /* Toast kommt vom Store */ });
  }
}

function esc(s) { return ctx.util.esc(s); }
