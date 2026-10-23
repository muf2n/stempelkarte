// Reiter „Übersicht“: Überstundenkonto, Wochenbalken mit Soll/Ist, Monatsauswertung mit CSV-Export und Einstellungen/Konto.

let ctx = null;
let root = null;
let snap = null;
let weekOffset = 0;   // 0 = aktuelle Woche, -1 = letzte …
let monthOffset = 0;  // 0 = aktueller Monat
let targetTimer = null;
let radiusTimer = null;
let accountKey = "";
let offsetTimer = null;

const $ = (sel) => root.querySelector(sel);

export function mount(el, c) {
  ctx = c;
  root = el;
  root.innerHTML = `
    <div class="stack">
      <div class="panel card ov-balance" id="ov-balance">
        <div class="lbl">Überstundenkonto</div>
        <div class="ov-saldo" id="ov-saldo">–</div>
        <p class="note" id="ov-saldo-note"></p>
        <div class="kv"><span>Diese Woche</span><b id="ov-bal-week"></b></div>
        <div class="kv"><span>Diesen Monat</span><b id="ov-bal-month"></b></div>
      </div>

      <div class="panel card" id="ov-week">
        <div class="nav">
          <button class="btn ghost sm" type="button" data-wk="-1" aria-label="Vorige Woche">‹</button>
          <b id="ov-week-label"></b>
          <button class="btn ghost sm" type="button" data-wk="1" aria-label="Nächste Woche">›</button>
        </div>
        <div class="bars ov-bars" id="ov-bars"></div>
        <p class="note" id="ov-week-hol" hidden></p>
        <div class="kv"><span>Ist / Soll</span><b id="ov-week-ist"></b></div>
        <div class="progress"><div id="ov-week-prog"></div></div>
        <div class="kv"><span>Differenz</span><b id="ov-week-diff"></b></div>
      </div>

      <div class="panel card" id="ov-month">
        <div class="nav">
          <button class="btn ghost sm" type="button" data-mo="-1" aria-label="Voriger Monat">‹</button>
          <b id="ov-month-label"></b>
          <button class="btn ghost sm" type="button" data-mo="1" aria-label="Nächster Monat">›</button>
        </div>
        <div class="kv"><span>Ist / Soll</span><b id="ov-month-ist"></b></div>
        <div class="kv"><span>Differenz</span><b id="ov-month-diff"></b></div>
        <div class="kv"><span>davon Arbeitszeit (netto)</span><b id="ov-month-net"></b></div>
        <div class="kv"><span>Arbeitstage</span><b id="ov-month-days"></b></div>
        <div class="kv"><span>Urlaubstage</span><b id="ov-month-urlaub"></b></div>
        <div class="kv"><span>Krankentage</span><b id="ov-month-krank"></b></div>
        <div class="kv"><span id="ov-year-urlaub-l">Urlaubstage im Jahr</span><b id="ov-year-urlaub"></b></div>
        <div class="kv"><span>Pausen gesamt</span><b id="ov-month-pause"></b></div>
        <div class="lbl">Stunden je Arbeitsort</div>
        <div id="ov-month-places"></div>
        <div class="lbl">Stunden je Tätigkeit</div>
        <div id="ov-month-acts"></div>
        <button class="btn primary" type="button" id="ov-csv">Als CSV (Excel) herunterladen</button>
      </div>

      <div class="panel card" id="ov-settings">
        <h2>Einstellungen</h2>
        <div class="fields">
          <label>Soll-Stunden pro Woche
            <input type="number" id="ov-target" inputmode="decimal" min="0" max="80" step="0.5">
          </label>
          <label class="switch">
            <input type="checkbox" id="ov-autoloc">
            <span>Standort beim Stempeln erfassen</span>
          </label>
          <label>Standard-Radius für Orte (m)
            <input type="number" id="ov-radius" inputmode="numeric" min="50" max="1000" step="10">
          </label>
          <div>
            <div class="lbl">Arbeitstage</div>
            <div class="chips ov-wd" id="ov-workdays" role="group" aria-label="Arbeitstage"></div>
          </div>
          <label class="switch">
            <input type="checkbox" id="ov-holidays">
            <span>Feiertage (Österreich) berücksichtigen</span>
          </label>
          <label class="switch">
            <input type="checkbox" id="ov-pauserem">
            <span>Pausen-Erinnerung nach 6 Stunden</span>
          </label>
          <label>Überstundenkonto zählt ab
            <input type="date" id="ov-balstart">
          </label>
          <label>Startsaldo (Stunden, darf negativ sein)
            <input type="text" id="ov-baloffset" inputmode="text" placeholder="z. B. 12,5 oder -3:15">
          </label>
          <p class="note">Ohne Datum zählt das Konto ab deinem ersten Eintrag.</p>
        </div>
        <div class="lbl">Konto</div>
        <div id="ov-account"></div>
      </div>
    </div>`;

  root.querySelectorAll("[data-wk]").forEach((b) =>
    b.addEventListener("click", () => {
      weekOffset += Number(b.dataset.wk);
      renderWeek();
    }));
  root.querySelectorAll("[data-mo]").forEach((b) =>
    b.addEventListener("click", () => {
      monthOffset += Number(b.dataset.mo);
      renderMonth();
    }));

  $("#ov-csv").addEventListener("click", exportCSV);

  const target = $("#ov-target");
  target.addEventListener("input", () => {
    clearTimeout(targetTimer);
    targetTimer = setTimeout(() => saveTarget(), 700);
  });
  target.addEventListener("change", () => {
    clearTimeout(targetTimer);
    saveTarget();
  });

  $("#ov-autoloc").addEventListener("change", (ev) => {
    save({ autoLocate: ev.target.checked });
  });

  const radius = $("#ov-radius");
  radius.addEventListener("input", () => {
    clearTimeout(radiusTimer);
    radiusTimer = setTimeout(() => saveRadius(false), 700);
  });
  radius.addEventListener("change", () => {
    clearTimeout(radiusTimer);
    saveRadius(true);
  });

  const wdBox = $("#ov-workdays");
  wdBox.innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) =>
    `<button type="button" class="chip" data-wd="${d}" aria-pressed="false">${ctx.util.WD[d]}</button>`).join("");
  wdBox.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-wd]");
    if (!b) return;
    const d = Number(b.dataset.wd);
    const cur = new Set(workDays());
    if (cur.has(d)) cur.delete(d); else cur.add(d);
    const next = [...cur].sort((a, z) => a - z);
    b.setAttribute("aria-pressed", String(cur.has(d)));
    save({ workDays: next });
  });

  $("#ov-holidays").addEventListener("change", (ev) => save({ holidays: ev.target.checked }));
  $("#ov-pauserem").addEventListener("change", (ev) => save({ pauseReminder: ev.target.checked }));
  $("#ov-balstart").addEventListener("change", (ev) => {
    const v = ev.target.value;
    save({ balanceStart: /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null });
  });
  const off = $("#ov-baloffset");
  off.addEventListener("input", () => {
    clearTimeout(offsetTimer);
    offsetTimer = setTimeout(() => saveOffset(false), 900);
  });
  off.addEventListener("change", () => {
    clearTimeout(offsetTimer);
    saveOffset(true);
  });
}

export function update(s) {
  snap = s;
  if (!root || !snap) return;
  renderBalance();
  renderWeek();
  renderMonth();
  renderSettings();
  renderAccount();
}

export function tick() {}

export function onShow() {
  if (snap) update(snap);
}

/* ---------- Hilfen ---------- */

function save(partial) {
  Promise.resolve(ctx.store.saveSettings(partial)).catch(() => {});
}

function saveTarget() {
  const v = parseFloat(String($("#ov-target").value).replace(",", "."));
  if (!isFinite(v) || v < 0 || v > 168) return;
  if (snap && snap.settings && snap.settings.weeklyTarget === v) return;
  save({ weeklyTarget: v });
}

function saveRadius(fixInput) {
  const inp = $("#ov-radius");
  let v = parseInt(inp.value, 10);
  if (!isFinite(v)) {
    if (fixInput && snap) inp.value = snap.settings.defaultRadius;
    return;
  }
  const clamped = Math.min(1000, Math.max(50, v));
  if (clamped !== v) {
    if (!fixInput) return; // während des Tippens noch nicht korrigieren
    inp.value = clamped;
  }
  if (snap && snap.settings && snap.settings.defaultRadius === clamped) return;
  save({ defaultRadius: clamped });
}

function saveOffset(fixInput) {
  const inp = $("#ov-baloffset");
  const v = parseSignedHours(inp.value);
  if (v == null) {
    if (fixInput && snap) inp.value = fmtSignedHours(Number(snap.settings?.balanceOffsetMin) || 0);
    return;
  }
  if (fixInput) inp.value = fmtSignedHours(v);
  if (snap && snap.settings && (Number(snap.settings.balanceOffsetMin) || 0) === v) return;
  save({ balanceOffsetMin: v });
}

/** "12,5" / "-3:15" / "+2" → Minuten (gerundet) oder null; leer = 0. */
function parseSignedHours(str) {
  const t = String(str || "").trim().replace(/\u2212/g, "-").replace(/\s+/g, "").replace(/h$/i, "");
  if (t === "") return 0;
  const m = /^([+-]?)(\d{1,4}):(\d{1,2})$/.exec(t);
  if (m) {
    const v = +m[2] * 60 + Math.min(59, +m[3]);
    return m[1] === "-" ? -v : v;
  }
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || Math.abs(n) > 10000) return null;
  return Math.round(n * 60);
}

function fmtSignedHours(min) {
  const v = Math.round((Number(min) || 0) / 60 * 100) / 100;
  return String(v).replace(".", ",");
}

function settings() {
  return (snap && snap.settings) || {};
}

function workDays() {
  const wd = settings().workDays;
  return Array.isArray(wd) ? wd : [1, 2, 3, 4, 5];
}

function targetOf(ts) {
  const u = ctx.util;
  return u.dailyTargetMin ? u.dailyTargetMin(ts, settings()) : 0;
}

function creditOf(e) {
  const u = ctx.util;
  return u.creditMin ? u.creditMin(e) : u.netMin(e);
}

/** Alle Stücke inkl. laufender Schicht: [{start, min (Gutschrift), net, pauseMin, place, kind}] */
function items() {
  const u = ctx.util;
  const out = (snap.entries || []).filter((e) => e && Number.isFinite(e.start)).map((e) => {
    const kind = e.kind || "work";
    return {
      start: e.start,
      min: creditOf(e),
      net: kind === "work" ? u.netMin(e) : 0,
      pauseMin: kind === "work" ? (e.pauseMin || 0) : 0,
      place: e.place || (e.inLoc && e.inLoc.addr) || "",
      kind,
      acts: kind === "work" ? activitiesOf(e.segments, e.start, e.end, u.netMin(e)) : null,
    };
  });
  const r = snap.running;
  if (r) {
    const net = Math.max(0, ctx.timer.netMs(r) / 60000);
    out.push({
      start: r.start,
      min: net,
      net,
      pauseMin: ctx.timer.pauseMsNow(r) / 60000,
      place: r.place || (r.inLoc && r.inLoc.addr) || "",
      kind: "work",
      acts: activitiesOf(r.segments, r.start, Date.now(), net),
    });
  }
  return out;
}

/** Minuten je Tätigkeit aus Abschnitten (roh: end − start); ohne Abschnitte → alles „Arbeiten“. */
function activitiesOf(segments, start, end, net) {
  const segs = Array.isArray(segments) ? segments.filter((x) => x && Number.isFinite(x.start)) : [];
  const m = new Map();
  if (!segs.length) {
    m.set("Arbeiten", net);
    return m;
  }
  segs.forEach((x, i) => {
    const e = Number.isFinite(x.end) ? x.end : (segs[i + 1] ? segs[i + 1].start : end);
    const name = x.activity || "Arbeiten";
    m.set(name, (m.get(name) || 0) + Math.max(0, ((e || x.start) - x.start) / 60000));
  });
  return m;
}

function hmRound(min) {
  return ctx.util.hm(Math.round(min));
}

/** Vorzeichen-Format: "+12:30 h" / "−3:15 h". */
function signed(min) {
  const m = Math.round(min);
  return (m < 0 ? "\u2212" : "+") + ctx.util.hm(Math.abs(m)) + " h";
}

function setSigned(el, min) {
  el.textContent = signed(min);
  el.classList.toggle("plus", Math.round(min) >= 0);
  el.classList.toggle("minus", Math.round(min) < 0);
}

/** Gutschriften je Tag (dayKey → Minuten), inkl. laufender Schicht. */
function creditByDay() {
  const u = ctx.util;
  const map = new Map();
  for (const it of items()) {
    const k = u.dayKey(it.start);
    map.set(k, (map.get(k) || 0) + it.min);
  }
  return map;
}

function keyToDate(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/**
 * Saldo (Gutschrift − Soll) von Tag `from` (Date, 00:00) bis heute.
 * Vergangene Tage: Gutschrift − Soll; heute: nur Gutschrift (Soll erst ab morgen); Zukunft zählt nicht.
 */
function balanceBetween(from, credits) {
  const u = ctx.util;
  const today = u.startOfDay(Date.now());
  const todayKey = u.dayKey(today);
  let sum = 0;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 40000 && d <= today; i++) {
    const k = u.dayKey(d);
    sum += credits.get(k) || 0;
    if (k !== todayKey) sum -= targetOf(d.getTime());
    d.setDate(d.getDate() + 1);
  }
  return sum;
}

/** Erster Tag des Kontos: balanceStart oder Tag des ersten Eintrags (null = keine Daten). */
function balanceStartDate() {
  const u = ctx.util;
  const bs = keyToDate(settings().balanceStart);
  if (bs) return bs;
  let min = Infinity;
  for (const e of snap.entries || []) if (Number.isFinite(e.start) && e.start < min) min = e.start;
  if (snap.running && snap.running.start < min) min = snap.running.start;
  return Number.isFinite(min) ? u.startOfDay(min) : null;
}

/* ---------- Überstundenkonto ---------- */

function renderBalance() {
  const u = ctx.util;
  const credits = creditByDay();
  const start = balanceStartDate();
  const offset = Number(settings().balanceOffsetMin) || 0;
  const total = offset + (start ? balanceBetween(start, credits) : 0);
  setSigned($("#ov-saldo"), total);

  const note = [];
  if (start) note.push(`seit ${u.fmtDate(start.getTime())}`);
  if (offset) note.push(`inkl. Startsaldo ${signed(offset)}`);
  note.push("Soll von heute zählt erst ab morgen");
  $("#ov-saldo-note").textContent = note.join(" · ");

  const clip = (d) => (start && d < start ? start : d);
  const ws = u.startOfWeek(Date.now());
  const now = new Date();
  const ms = u.startOfMonth(now.getFullYear(), now.getMonth());
  setSigned($("#ov-bal-week"), start ? balanceBetween(clip(ws), credits) : 0);
  setSigned($("#ov-bal-month"), start ? balanceBetween(clip(ms), credits) : 0);
}

/* ---------- Woche ---------- */

function renderWeek() {
  if (!snap) return;
  const u = ctx.util;
  const holOn = settings().holidays !== false;
  const ws = u.startOfWeek(Date.now());
  ws.setDate(ws.getDate() + weekOffset * 7);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws);
    d.setDate(ws.getDate() + i);
    const ts = d.getTime();
    days.push({
      key: u.dayKey(ts), date: d, min: 0,
      target: targetOf(ts),
      hol: holOn && u.holidayName ? u.holidayName(ts) : null,
    });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const it of items()) {
    const d = byKey.get(u.dayKey(it.start));
    if (d) d.min += it.min;
  }
  const total = days.reduce((a, d) => a + d.min, 0);
  const targetMin = days.reduce((a, d) => a + d.target, 0);
  const maxMin = Math.max(8 * 60, ...days.map((d) => d.min), ...days.map((d) => d.target));
  const todayKey = u.dayKey(Date.now());

  const last = days[6].date;
  $("#ov-week-label").textContent =
    weekOffset === 0 ? "Diese Woche"
      : `${u.pad(ws.getDate())}.${u.pad(ws.getMonth() + 1)}. – ${u.pad(last.getDate())}.${u.pad(last.getMonth() + 1)}.${last.getFullYear()}`;

  $("#ov-bars").innerHTML = days.map((d) => {
    const cls = ["bar"];
    if (d.min < 1) cls.push("zero");
    if (d.key === todayKey) cls.push("today");
    if (d.hol) cls.push("ov-hol");
    const h = Math.round((d.min / maxMin) * 100);
    const th = Math.round((d.target / maxMin) * 1000) / 10;
    const title = [u.fmtDate(d.date.getTime())];
    if (d.hol) title.push(d.hol);
    title.push(`Soll ${hmRound(d.target)} h`);
    return `<div class="${cls.join(" ")}" title="${u.esc(title.join(" · "))}">
      <span class="v">${d.min >= 1 ? u.esc(hmRound(d.min)) : ""}</span>
      <div class="ov-colwrap">
        <div class="col" style="height:${h}%;--h:${h}%"></div>
        ${d.target > 0 ? `<i class="ov-tgt" style="bottom:${th}%" aria-hidden="true"></i>` : ""}
      </div>
      <span class="l">${u.esc(u.WD[d.date.getDay()])}${d.hol ? `<small class="ov-hol-l">Feiertag</small>` : ""}</span>
    </div>`;
  }).join("");

  const hols = days.filter((d) => d.hol);
  const holEl = $("#ov-week-hol");
  holEl.hidden = !hols.length;
  holEl.textContent = hols.length
    ? "Feiertag: " + hols.map((d) => `${u.WD[d.date.getDay()]} ${u.pad(d.date.getDate())}.${u.pad(d.date.getMonth() + 1)}. ${d.hol}`).join(" · ")
    : "";

  $("#ov-week-ist").textContent = `${hmRound(total)} / ${hmRound(targetMin)} h`;
  const pct = targetMin > 0 ? Math.min(100, (total / targetMin) * 100) : (total > 0 ? 100 : 0);
  $("#ov-week-prog").style.width = `${pct}%`;
  const diff = Math.round(total - targetMin);
  const diffEl = $("#ov-week-diff");
  diffEl.textContent = `${diff >= 0 ? "+" : ""}${u.hm(diff)} h`;
  diffEl.className = diff >= 0 ? "plus" : "minus";
}

/* ---------- Monat ---------- */

function monthRange() {
  const now = new Date();
  const from = ctx.util.startOfMonth(now.getFullYear(), now.getMonth() + monthOffset);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return { from, to };
}

function renderMonth() {
  if (!snap) return;
  const u = ctx.util;
  const { from, to } = monthRange();
  const f = from.getTime(), t = to.getTime();
  $("#ov-month-label").textContent = `${u.MONTHS[from.getMonth()]} ${from.getFullYear()}`;

  let credit = 0, net = 0, pause = 0;
  const dayset = new Set();
  const urlaub = new Set(), krank = new Set();
  const perPlace = new Map();
  const perAct = new Map();
  for (const it of items()) {
    if (it.start < f || it.start >= t) continue;
    credit += it.min;
    const k = u.dayKey(it.start);
    if (it.kind === "urlaub") { urlaub.add(k); continue; }
    if (it.kind === "krank") { krank.add(k); continue; }
    if (it.kind !== "work") continue;
    net += it.net;
    pause += it.pauseMin;
    if (it.net > 0) dayset.add(k);
    const name = it.place || "Ohne Ort";
    perPlace.set(name, (perPlace.get(name) || 0) + it.net);
    if (it.acts) for (const [a, m] of it.acts) perAct.set(a, (perAct.get(a) || 0) + m);
  }

  let target = 0;
  for (const d = new Date(from); d < to; d.setDate(d.getDate() + 1)) target += targetOf(d.getTime());

  const y = from.getFullYear();
  const yf = new Date(y, 0, 1).getTime(), yt = new Date(y + 1, 0, 1).getTime();
  const yearUrlaub = new Set();
  for (const e of snap.entries || []) {
    if (e && e.kind === "urlaub" && e.start >= yf && e.start < yt) yearUrlaub.add(u.dayKey(e.start));
  }

  $("#ov-month-ist").textContent = `${hmRound(credit)} / ${hmRound(target)} h`;
  const diff = Math.round(credit - target);
  const diffEl = $("#ov-month-diff");
  diffEl.textContent = `${diff >= 0 ? "+" : ""}${u.hm(diff)} h`;
  diffEl.className = diff >= 0 ? "plus" : "minus";
  $("#ov-month-net").textContent = `${hmRound(net)} h`;
  $("#ov-month-days").textContent = String(dayset.size);
  $("#ov-month-urlaub").textContent = String(urlaub.size);
  $("#ov-month-krank").textContent = String(krank.size);
  $("#ov-year-urlaub-l").textContent = `Urlaubstage ${y} gesamt`;
  $("#ov-year-urlaub").textContent = String(yearUrlaub.size);
  $("#ov-month-pause").textContent = `${hmRound(pause)} h`;

  const rows = [...perPlace.entries()].sort((a, b) => b[1] - a[1]);
  $("#ov-month-places").innerHTML = rows.length
    ? rows.map(([n, m]) => `<div class="kv"><span>${u.esc(n)}</span><b>${u.esc(hmRound(m))} h</b></div>`).join("")
    : `<p class="note">Keine Arbeitszeit in diesem Monat.</p>`;

  const acts = [...perAct.entries()].filter(([, m]) => m >= 0.5).sort((a, b) => b[1] - a[1]);
  $("#ov-month-acts").innerHTML = acts.length
    ? acts.map(([n, m]) => `<div class="kv"><span>${u.esc(n)}</span><b>${u.esc(hmRound(m))} h</b></div>`).join("")
    : `<p class="note">Keine Arbeitszeit in diesem Monat.</p>`;
}

function exportCSV() {
  if (!snap) return;
  const u = ctx.util;
  const { from, to } = monthRange();
  const f = from.getTime(), t = to.getTime();
  const list = (snap.entries || [])
    .filter((e) => e.start >= f && e.start < t)
    .sort((a, b) => a.start - b.start);
  if (!list.length) {
    ctx.ui.toast("Keine Einträge in diesem Monat.");
    return;
  }
  const csv = ctx.exporter.entriesCSV(list, { from: f, to: t - 1 });
  ctx.exporter.download(`Arbeitszeiten-${from.getFullYear()}-${u.pad(from.getMonth() + 1)}.csv`, csv);
  if (snap.running && snap.running.start >= f && snap.running.start < t) {
    ctx.ui.toast("Laufende Schicht ist noch nicht enthalten.");
  }
}

/* ---------- Einstellungen ---------- */

function renderSettings() {
  const s = snap.settings || {};
  const target = $("#ov-target");
  if (document.activeElement !== target) {
    target.value = s.weeklyTarget ?? 38.5;
  }
  $("#ov-autoloc").checked = s.autoLocate !== false;
  const radius = $("#ov-radius");
  if (document.activeElement !== radius) radius.value = s.defaultRadius ?? 150;

  const wd = new Set(workDays());
  root.querySelectorAll("#ov-workdays [data-wd]").forEach((b) =>
    b.setAttribute("aria-pressed", String(wd.has(Number(b.dataset.wd)))));
  $("#ov-holidays").checked = s.holidays !== false;
  $("#ov-pauserem").checked = s.pauseReminder !== false;
  const bs = $("#ov-balstart");
  if (document.activeElement !== bs) bs.value = s.balanceStart || "";
  const off = $("#ov-baloffset");
  if (document.activeElement !== off) {
    const v = Number(s.balanceOffsetMin) || 0;
    off.value = v ? fmtSignedHours(v) : "";
  }
}

function renderAccount() {
  const user = snap.user;
  const key = `${snap.mode}|${user ? user.uid + user.name + user.email : ""}|${!!ctx.firebaseConfigured}`;
  if (key === accountKey) return;
  accountKey = key;
  const box = $("#ov-account");
  const u = ctx.util;

  if (snap.mode === "cloud" && user) {
    box.innerHTML = `
      <div class="kv"><span>Angemeldet als</span><b>${u.esc(user.name || user.email || "")}</b></div>
      ${user.email && user.name ? `<p class="note">${u.esc(user.email)}</p>` : ""}
      <p class="hint">Deine Daten werden mit allen deinen Geräten synchronisiert.</p>
      <button class="btn ghost sm" type="button" id="ov-signout">Abmelden</button>`;
    ctx.ui.confirmButton($("#ov-signout"), "Wirklich abmelden?", () => ctx.signOut());
  } else {
    box.innerHTML = `
      <p class="hint">Nur auf diesem Gerät gespeichert.</p>
      ${ctx.firebaseConfigured
        ? `<button class="btn primary" type="button" id="ov-signin">Mit Google anmelden &amp; synchronisieren</button>`
        : ""}`;
    const b = $("#ov-signin");
    if (b) {
      b.addEventListener("click", async () => {
        ctx.ui.setBusy(b, true, "Anmeldung läuft …");
        try {
          await ctx.signIn();
        } catch (err) {
          ctx.ui.toast("Anmeldung fehlgeschlagen.");
        } finally {
          if (b.isConnected) ctx.ui.setBusy(b, false);
        }
      });
    }
  }
}
