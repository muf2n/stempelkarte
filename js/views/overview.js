// Reiter „Übersicht“: Wochenbalken mit Soll/Ist, Monatsauswertung mit CSV-Export und Einstellungen/Konto.

let ctx = null;
let root = null;
let snap = null;
let weekOffset = 0;   // 0 = aktuelle Woche, -1 = letzte …
let monthOffset = 0;  // 0 = aktueller Monat
let targetTimer = null;
let radiusTimer = null;
let accountKey = "";

const $ = (sel) => root.querySelector(sel);

export function mount(el, c) {
  ctx = c;
  root = el;
  root.innerHTML = `
    <div class="stack">
      <div class="panel card" id="ov-week">
        <div class="nav">
          <button class="btn ghost sm" type="button" data-wk="-1" aria-label="Vorige Woche">‹</button>
          <b id="ov-week-label"></b>
          <button class="btn ghost sm" type="button" data-wk="1" aria-label="Nächste Woche">›</button>
        </div>
        <div class="bars" id="ov-bars"></div>
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
        <div class="kv"><span>Netto-Stunden</span><b id="ov-month-net"></b></div>
        <div class="kv"><span>Arbeitstage</span><b id="ov-month-days"></b></div>
        <div class="kv"><span>Pausen gesamt</span><b id="ov-month-pause"></b></div>
        <div class="lbl">Stunden je Arbeitsort</div>
        <div id="ov-month-places"></div>
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
}

export function update(s) {
  snap = s;
  if (!root || !snap) return;
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

/** Alle Arbeitsstücke inkl. laufender Schicht: [{start, min, pauseMin, place}] */
function items() {
  const u = ctx.util;
  const out = (snap.entries || []).map((e) => ({
    start: e.start, min: u.netMin(e), pauseMin: e.pauseMin || 0, place: e.place || "",
  }));
  const r = snap.running;
  if (r) {
    out.push({
      start: r.start,
      min: Math.max(0, ctx.timer.netMs(r) / 60000),
      pauseMin: ctx.timer.pauseMsNow(r) / 60000,
      place: r.place || "",
    });
  }
  return out;
}

function hmRound(min) {
  return ctx.util.hm(Math.round(min));
}

/* ---------- Woche ---------- */

function renderWeek() {
  if (!snap) return;
  const u = ctx.util;
  const ws = u.startOfWeek(Date.now());
  ws.setDate(ws.getDate() + weekOffset * 7);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws);
    d.setDate(ws.getDate() + i);
    days.push({ key: u.dayKey(d.getTime()), date: d, min: 0 });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const it of items()) {
    const d = byKey.get(u.dayKey(it.start));
    if (d) d.min += it.min;
  }
  const total = days.reduce((a, d) => a + d.min, 0);
  const maxMin = Math.max(8 * 60, ...days.map((d) => d.min));
  const todayKey = u.dayKey(Date.now());

  const last = days[6].date;
  $("#ov-week-label").textContent =
    weekOffset === 0 ? "Diese Woche"
      : `${u.pad(ws.getDate())}.${u.pad(ws.getMonth() + 1)}. – ${u.pad(last.getDate())}.${u.pad(last.getMonth() + 1)}.${last.getFullYear()}`;

  $("#ov-bars").innerHTML = days.map((d) => {
    const cls = ["bar"];
    if (d.min < 1) cls.push("zero");
    if (d.key === todayKey) cls.push("today");
    const h = Math.round((d.min / maxMin) * 100);
    return `<div class="${cls.join(" ")}">
      <span class="v">${d.min >= 1 ? u.esc(hmRound(d.min)) : ""}</span>
      <div class="col" style="height:${h}%;--h:${h}%"></div>
      <span class="l">${u.esc(u.WD[d.date.getDay()])}</span>
    </div>`;
  }).join("");

  const targetMin = (Number(snap.settings && snap.settings.weeklyTarget) || 0) * 60;
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

  let net = 0, pause = 0;
  const dayset = new Set();
  const perPlace = new Map();
  for (const it of items()) {
    if (it.start < f || it.start >= t) continue;
    net += it.min;
    pause += it.pauseMin;
    if (it.min > 0) dayset.add(u.dayKey(it.start));
    const name = it.place || "Ohne Ort";
    perPlace.set(name, (perPlace.get(name) || 0) + it.min);
  }
  $("#ov-month-net").textContent = `${hmRound(net)} h`;
  $("#ov-month-days").textContent = String(dayset.size);
  $("#ov-month-pause").textContent = `${hmRound(pause)} h`;

  const rows = [...perPlace.entries()].sort((a, b) => b[1] - a[1]);
  $("#ov-month-places").innerHTML = rows.length
    ? rows.map(([n, m]) => `<div class="kv"><span>${u.esc(n)}</span><b>${u.esc(hmRound(m))} h</b></div>`).join("")
    : `<p class="note">Keine Einträge in diesem Monat.</p>`;
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
