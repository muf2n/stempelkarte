// Update 9 – Privat / Arbeit: Umschalter „Arbeit | Privat“ oben in „Heute“, Privat-Banner mit „Privat bis …“,
// Rückfrage beim Umschalten (eingestempelt → „Ausstempeln und Privat starten?“), Angebot „Jetzt einstempeln“
// beim Zurückschalten an einem Arbeitsort, Einstellungen (Zeitplan, private Fahrten).
// Regeln: js/privat-core.js · Speichern: js/privat.js (settings.mode / modeSchedule / privatTrips).
import * as P from "../privat-core.js";
import { modeNow, setMode, localTs, saveModeSchedule, saveRecordTrips } from "../privat.js";

let ctx = null;
let host = null;
let hooks = {};             // { clockOutNow(): Promise, startWork(place): Promise }
let key = "";
let resetting = false;
let busy = false;

function injectCSS() {
  if (document.getElementById("pm-css")) return;
  const l = document.createElement("link");
  l.id = "pm-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/privat.css", import.meta.url).href;
  document.head.appendChild(l);
}

function snap() { try { return ctx.store.get(); } catch { return null; } }
function settings() { const s = snap(); return (s && s.settings) || {}; }

/** „bis 20:00“ / „bis morgen 06:00“ / „bis Mo 06:00“ */
function untilText(ts) {
  if (ts == null) return "";
  const u = ctx.util;
  const d = new Date(ts), now = new Date();
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const day = days === 0 ? "" : days === 1 ? "morgen " : `${u.WD[d.getDay()]} `;
  return `bis ${day}${u.clock(ts)}`;
}

export function mount(el, c, h = {}) {
  ctx = c; host = el; hooks = h;
  injectCSS();
  el.classList.add("pm");
  el.innerHTML = `
    <div class="pm-bar">
      <div class="pm-seg" role="radiogroup" aria-label="Modus: Arbeit oder Privat">
        <button type="button" role="radio" class="pm-opt" data-pm="arbeit" aria-checked="true"><span aria-hidden="true">💼</span> Arbeit</button>
        <button type="button" role="radio" class="pm-opt" data-pm="privat" aria-checked="false"><span aria-hidden="true">🏠</span> Privat</button>
      </div>
      <span class="pm-auto" data-pm-r="auto" hidden></span>
      <button type="button" class="pm-gear" data-pm="settings" aria-label="Einstellungen Privat-Modus" title="Einstellungen Privat-Modus">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
      </button>
    </div>
    <div class="pm-banner" data-pm-r="banner" role="status" hidden>
      <div class="pm-bt"><span class="pm-pill">🏠 Privat</span><b>Privat-Modus – nichts zählt als Arbeit</b></div>
      <p class="pm-sub" data-pm-r="sub"></p>
      <div class="pm-until" role="group" aria-label="Privat bis …" data-pm-r="until"></div>
    </div>`;
  el.addEventListener("click", onClick);
  update(snap());
}

/** Wird bei jeder Store-Änderung und im Sekundentakt aufgerufen. */
export function update(s) {
  if (!host || !ctx) return;
  s = s || snap();
  if (!s) return;
  const eff = modeNow(s);
  document.body.classList.toggle("is-privat", eff.privat);
  // Eingestempelt (auch von Uhr/Handy/Claude) → selbst gewähltes Privat beenden
  const m = P.readMode(s.settings || {});
  if (s.running && m && m.privat && m.source === "manual" && !resetting && s.ready) {
    resetting = true;
    setMode(false).catch(() => {}).finally(() => { resetting = false; });
  }
  const s0 = s.settings || {};
  const choice = eff.privat && eff.source === "manual" ? P.untilChoiceOf(m, s0, localTs) : null;
  const k = [eff.privat, eff.source, eff.until, choice, Math.floor(Date.now() / 60000), !!s.running].join("|");
  if (k === key) return;
  key = k;
  host.querySelectorAll("[data-pm='arbeit'],[data-pm='privat']").forEach((b) => {
    const on = (b.dataset.pm === "privat") === eff.privat;
    b.setAttribute("aria-checked", String(on));
  });
  const auto = host.querySelector('[data-pm-r="auto"]');
  const sc = P.readModeSchedule(s0);
  auto.hidden = !sc.enabled;
  auto.textContent = sc.enabled ? "Auto" : "";
  auto.title = sc.enabled ? `Automatisch privat außerhalb ${sc.from}–${sc.to}` : "";
  const ban = host.querySelector('[data-pm-r="banner"]');
  ban.hidden = !eff.privat;
  if (!eff.privat) return;
  const sub = [];
  if (eff.source === "schedule") sub.push(`Automatisch außerhalb deiner Arbeitszeit${eff.until ? " · " + untilText(eff.until) : ""}`);
  else if (eff.until) sub.push(untilText(eff.until));
  else sub.push("bis du wieder auf „Arbeit“ tippst");
  sub.push(P.recordPrivateTrips(s0) ? "Fahrten → Fahrtenbuch als privat" : "Fahrten werden nicht aufgezeichnet");
  host.querySelector('[data-pm-r="sub"]').textContent = sub.join(" · ");
  const now = Date.now();
  host.querySelector('[data-pm-r="until"]').innerHTML = P.UNTIL_CHOICES.map((c) => {
    const r = P.untilFor(c.id, now, s0, localTs);
    if (!r.ok) return "";
    const lbl = c.id === "abend" ? `bis ${P.EVENING}` : c.id === "morgen" ? `bis morgen ${P.readModeSchedule(s0).from}` : c.label;
    return `<button type="button" class="chip pm-u" data-pmu="${c.id}" aria-pressed="${String(choice === c.id)}" title="${ctx.util.esc(c.label)}">${ctx.util.esc(lbl)}</button>`;
  }).join("");
}

export function tick() { update(null); }

async function onClick(ev) {
  const b = ev.target.closest("[data-pm],[data-pmu]");
  if (!b || busy) return;
  if (b.dataset.pmu) return chooseUntil(b.dataset.pmu);
  const a = b.dataset.pm;
  if (a === "settings") return openSettings();
  const s = snap();
  const eff = modeNow(s);
  if (a === "privat" && !eff.privat) return goPrivat();
  if (a === "arbeit" && (eff.privat || eff.blocked)) return goArbeit();
}

async function chooseUntil(id) {
  const r = P.untilFor(id, Date.now(), settings(), localTs);
  if (!r.ok) return;
  busy = true;
  try {
    await setMode(true, r.until);
    ctx.ui.toast(r.until ? `Privat ${untilText(r.until)}` : "Privat, bis du es ausschaltest");
  } catch { /* Toast vom Store */ } finally { busy = false; key = ""; update(null); }
}

/** Privat einschalten – eingestempelt: erst fragen, nie still ausstempeln. */
function goPrivat() {
  const s = snap();
  if (s && s.running) {
    const u = ctx.util;
    ctx.ui.openSheet({
      title: "Ausstempeln und Privat starten?",
      bodyHTML: `<p>Du bist seit <b>${u.clock(s.running.start)}</b> eingestempelt. Im Privat-Modus zählt nichts als Arbeit.</p>
        <div class="row"><button type="button" class="btn ghost" data-r="pm-no">Abbrechen</button>
        <button type="button" class="btn stop" data-r="pm-out">Ausstempeln jetzt</button></div>`,
      onMount(el, close) {
        el.querySelector('[data-r="pm-no"]').addEventListener("click", close);
        el.querySelector('[data-r="pm-out"]').addEventListener("click", async () => {
          close();
          busy = true;
          try {
            if (hooks.clockOutNow) await hooks.clockOutNow();
            const st = snap();
            if (st && st.running) { ctx.ui.toast("Ausstempeln hat nicht geklappt – Privat-Modus nicht gestartet.", 3500); return; }
            await setMode(true, null);
            ctx.ui.toast("🏠 Privat-Modus an – nichts zählt als Arbeit");
          } catch { /* Toast */ } finally { busy = false; key = ""; update(null); }
        });
      },
    });
    return;
  }
  busy = true;
  setMode(true, null)
    .then(() => ctx.ui.toast("🏠 Privat-Modus an – nichts zählt als Arbeit"))
    .catch(() => {})
    .finally(() => { busy = false; key = ""; update(null); });
}

/** Zurück zu Arbeit; an einem Arbeitsort „Jetzt einstempeln“ anbieten. */
async function goArbeit() {
  busy = true;
  try { await setMode(false); } catch { busy = false; return; }
  busy = false;
  key = ""; update(null);
  const s = snap();
  if (!s || s.running) return;
  let place = null;
  try {
    const perm = ctx.geo.isSupported() ? await ctx.geo.permission() : "unsupported";
    if (perm === "granted") {
      const loc = await ctx.geo.getPosition({ timeout: 8000, maxAge: 60000 });
      const m = ctx.geofence.matchPlace(loc, s.places || [], (s.settings || {}).defaultRadius || 150);
      if (m) place = m.place;
    }
  } catch { place = null; }
  if (!place) { ctx.ui.toast("💼 Arbeit – Stempeln wieder wie gewohnt"); return; }
  ctx.ui.openSheet({
    title: "Arbeit",
    bodyHTML: `<p>Du bist bei <b>${ctx.util.esc(place.name || "Arbeitsort")}</b>. Jetzt einstempeln?</p>
      <div class="row"><button type="button" class="btn ghost" data-r="pm-later">Später</button>
      <button type="button" class="btn go" data-r="pm-in">Jetzt einstempeln</button></div>`,
    onMount(el, close) {
      el.querySelector('[data-r="pm-later"]').addEventListener("click", close);
      el.querySelector('[data-r="pm-in"]').addEventListener("click", async () => {
        close();
        if (hooks.startWork) await hooks.startWork(place);
      });
    },
  });
}

/* ---------- Einstellungen ---------- */

export function openSettings() {
  const s = settings();
  const sc = P.readModeSchedule(s);
  const wd = P.workDaysOf(s);
  const u = ctx.util;
  const wdTxt = [1, 2, 3, 4, 5, 6, 0].filter((d) => wd.includes(d)).map((d) => u.WD[d]).join(", ") || "keine";
  ctx.ui.openSheet({
    title: "Privat-Modus",
    bodyHTML: `<div class="fields pm-set">
      <p class="note">Im Privat-Modus wirst du nie automatisch eingestempelt, bekommst keine „Nicht eingestempelt“-Erinnerung und nichts zählt als Arbeitszeit.</p>
      <label class="switch"><span>Automatisch privat außerhalb meiner Arbeitszeit</span><input type="checkbox" data-r="pm-auto"${sc.enabled ? " checked" : ""}></label>
      <div class="row pm-times"${sc.enabled ? "" : " hidden"}>
        <label>Arbeit von <input type="time" data-r="pm-from" value="${u.esc(sc.from)}"></label>
        <label>bis <input type="time" data-r="pm-to" value="${u.esc(sc.to)}"></label>
      </div>
      <p class="hint pm-times-note"${sc.enabled ? "" : " hidden"}>Arbeitstage: ${u.esc(wdTxt)} – Wochenenden, freie Tage und Feiertage zählen als privat. Mit „Arbeit“ oben überstimmst du das bis zum nächsten Wechsel.</p>
      <label class="switch"><span>Private Fahrten im Fahrtenbuch aufzeichnen</span><input type="checkbox" data-r="pm-trips"${P.recordPrivateTrips(s) ? " checked" : ""}></label>
      <p class="hint">Fahrten im Privat-Modus landen als <b>privat</b> im Fahrtenbuch (0 h, kein Kilometergeld). Aus = gar nicht aufzeichnen.</p>
    </div>`,
    onMount(el) {
      const auto = el.querySelector('[data-r="pm-auto"]');
      const from = el.querySelector('[data-r="pm-from"]');
      const to = el.querySelector('[data-r="pm-to"]');
      const show = () => { el.querySelectorAll(".pm-times, .pm-times-note").forEach((x) => { x.hidden = !auto.checked; }); };
      auto.addEventListener("change", async () => { show(); try { await saveModeSchedule({ enabled: auto.checked }); } catch { /* Toast */ } key = ""; update(null); });
      const saveT = async () => {
        if (!/^\d{2}:\d{2}$/.test(from.value) || !/^\d{2}:\d{2}$/.test(to.value) || from.value === to.value) { ctx.ui.toast("Bitte gültige Zeiten wählen."); return; }
        try { await saveModeSchedule({ from: from.value, to: to.value }); } catch { /* Toast */ }
        key = ""; update(null);
      };
      from.addEventListener("change", saveT);
      to.addEventListener("change", saveT);
      el.querySelector('[data-r="pm-trips"]').addEventListener("change", async (ev) => {
        try { await saveRecordTrips(ev.target.checked); } catch { /* Toast */ }
        key = ""; update(null);
      });
    },
  });
}
