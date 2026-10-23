// Reiter „Einträge“: Monatsliste aller Einträge nach Tagen gruppiert, plus Formular zum Nachtragen/Bearbeiten.

const SEL_KEY = "stempelkarte.selPlace";

let root = null;
let C = null;          // ctx
let lastSnap = null;
let curY = 0, curM = 0; // angezeigter Monat (m: 0–11)

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function mount(el, ctx) {
  root = el;
  C = ctx;
  const now = new Date();
  curY = now.getFullYear();
  curM = now.getMonth();

  el.innerHTML = `
    <div class="stack">
      <div class="section-h">
        <h2>Einträge</h2>
        <button type="button" class="btn primary sm" data-act="add">+ Nachtragen</button>
      </div>
      <div class="nav">
        <button type="button" class="btn ghost sm" data-act="prev" aria-label="Vorheriger Monat">‹</button>
        <b data-ref="label"></b>
        <button type="button" class="btn ghost sm" data-act="next" aria-label="Nächster Monat">›</button>
      </div>
      <p class="note" data-ref="sum"></p>
      <div class="stack" data-ref="list"></div>
    </div>`;

  el.addEventListener("click", (ev) => {
    const actEl = ev.target.closest("[data-act]");
    if (actEl && el.contains(actEl)) {
      const act = actEl.dataset.act;
      if (act === "add") { C.openEntryForm(null); return; }
      if (act === "prev") { shiftMonth(-1); return; }
      if (act === "next") { shiftMonth(1); return; }
    }
    const row = ev.target.closest("button.entry[data-id]");
    if (row && el.contains(row)) {
      const snap = lastSnap || C.store.get();
      const entry = (snap?.entries || []).find((e) => e.id === row.dataset.id);
      if (entry) C.openEntryForm(entry);
    }
  });

  update(C.store.get());
}

function shiftMonth(delta) {
  const d = new Date(curY, curM + delta, 1);
  curY = d.getFullYear();
  curM = d.getMonth();
  render();
}

export function update(snap) {
  lastSnap = snap;
  render();
}

export function tick() {}

export function onShow() {
  render();
}

function render() {
  if (!root || !C) return;
  const { util, geo } = C;
  const { esc, hm, clock, dayKey, fmtDate, netMin, MONTHS } = util;

  root.querySelector('[data-ref="label"]').textContent = `${MONTHS[curM]} ${curY}`;
  const listEl = root.querySelector('[data-ref="list"]');
  const sumEl = root.querySelector('[data-ref="sum"]');

  const snap = lastSnap;
  if (!snap || snap.ready === false) {
    sumEl.textContent = "";
    listEl.innerHTML = `<div class="empty"><h3>Lade Einträge …</h3></div>`;
    return;
  }

  const from = new Date(curY, curM, 1).getTime();
  const to = new Date(curY, curM + 1, 1).getTime();
  const list = (snap.entries || []).filter((e) => e.start >= from && e.start < to);

  if (!list.length) {
    sumEl.textContent = "";
    listEl.innerHTML = `<div class="empty"><h3>Keine Einträge in diesem Monat</h3>
      <p class="note">Tippe auf „+ Nachtragen“, um Arbeitszeit von Hand einzutragen.</p></div>`;
    return;
  }

  // nach Tagen gruppieren
  const groups = new Map();
  for (const e of list) {
    const k = dayKey(e.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const keys = [...groups.keys()].sort().reverse();

  let total = 0;
  const html = keys.map((k) => {
    const items = groups.get(k).sort((a, b) => a.start - b.start);
    const daySum = items.reduce((s, e) => s + netMin(e), 0);
    total += daySum;
    const rows = items.map((e) => {
      const p = [];
      if (e.place) p.push(`<span class="tag">${esc(e.place)}</span>`);
      if (e.pauseMin > 0) p.push(`Pause ${esc(e.pauseMin)} Min.`);
      if (e.note) p.push(esc(e.note));
      const multi = dayKey(e.end) !== dayKey(e.start) ? " (+1 Tag)" : "";
      const links = [];
      if (e.inLoc && e.inLoc.lat != null) {
        links.push(`<a href="${esc(geo.mapsUrl(e.inLoc.lat, e.inLoc.lng))}" target="_blank" rel="noopener"${e.inLoc.addr ? ` title="${esc(e.inLoc.addr)}"` : ""}>Start-Standort</a>`);
      }
      if (e.outLoc && e.outLoc.lat != null) {
        links.push(`<a href="${esc(geo.mapsUrl(e.outLoc.lat, e.outLoc.lng))}" target="_blank" rel="noopener"${e.outLoc.addr ? ` title="${esc(e.outLoc.addr)}"` : ""}>End-Standort</a>`);
      }
      return `
        <button type="button" class="entry" data-id="${esc(e.id)}">
          <span class="t">${esc(clock(e.start))} – ${esc(clock(e.end))}${multi}</span>
          <span class="d">${esc(hm(netMin(e)))} h</span>
          <span class="p">${p.join(" · ")}</span>
        </button>
        ${links.length ? `<div class="links">${links.join(" · ")}</div>` : ""}`;
    }).join("");
    return `
      <div class="day">
        <div class="day-h"><span>${esc(fmtDate(items[0].start))}</span><span class="sum">${esc(hm(daySum))} h</span></div>
        ${rows}
      </div>`;
  }).join("");

  sumEl.textContent = `Gesamt ${hm(total)} h · ${keys.length} ${keys.length === 1 ? "Arbeitstag" : "Arbeitstage"}`;
  listEl.innerHTML = html;
}

// ---------- Formular ----------

function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || "");
  return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null;
}
function parseTime(str) {
  const m = /^(\d{1,2}):(\d{2})/.exec(str || "");
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

// liest die Felder und gibt {start,end,pauseMin} oder {error} zurück
function readTimes(box) {
  const d = parseDate(box.querySelector("#ef-date").value);
  if (!d) return { error: "Bitte ein Datum wählen." };
  const f = parseTime(box.querySelector("#ef-from").value);
  if (!f) return { error: "Bitte eine Uhrzeit für den Beginn eingeben." };
  const t = parseTime(box.querySelector("#ef-to").value);
  if (!t) return { error: "Bitte eine Uhrzeit für das Ende eingeben." };
  const pRaw = String(box.querySelector("#ef-pause").value || "").trim().replace(",", ".");
  const pauseMin = pRaw === "" ? 0 : Math.round(Number(pRaw));
  if (!Number.isFinite(pauseMin) || pauseMin < 0) return { error: "Die Pause muss 0 oder mehr Minuten sein." };

  const start = new Date(d.y, d.mo, d.d, f.h, f.mi).getTime();
  let endD = new Date(d.y, d.mo, d.d, t.h, t.mi);
  const overnight = endD.getTime() <= start;
  if (overnight) endD = new Date(d.y, d.mo, d.d + 1, t.h, t.mi); // über Mitternacht
  const end = endD.getTime();
  const durMin = Math.round((end - start) / 60000);
  if (pauseMin >= durMin) {
    return { error: `Die Pause (${pauseMin} Min.) ist länger als die Arbeitszeit (${C ? C.util.hm(durMin) : durMin} h).` };
  }
  return { start, end, pauseMin, overnight };
}

export function openEntryForm(entry, ctx) {
  const c = ctx || C;
  const { store, ui, util } = c;
  const { esc, hm, clock, dayKey, netMin } = util;
  const snap = store.get() || {};
  const places = snap.places || [];
  const isNew = !entry;

  let selPlaceId;
  if (isNew) {
    const last = lsGet(SEL_KEY);
    selPlaceId = last && places.some((p) => p.id === last) ? last : "";
  } else {
    selPlaceId = entry.placeId || "";
  }

  // Ort eines bestehenden Eintrags, der nicht mehr existiert, trotzdem anbieten
  const orphan = !isNew && entry.placeId && !places.some((p) => p.id === entry.placeId)
    ? { id: entry.placeId, name: entry.place || "Unbekannter Ort" } : null;

  const opts = [`<option value="">Ohne Ort</option>`]
    .concat(places.map((p) => `<option value="${esc(p.id)}"${p.id === selPlaceId ? " selected" : ""}>${esc(p.name)}</option>`))
    .concat(orphan ? [`<option value="${esc(orphan.id)}" selected>${esc(orphan.name)} (gelöscht)</option>`] : [])
    .join("");

  const vDate = isNew ? dayKey(Date.now()) : dayKey(entry.start);
  const vFrom = isNew ? "08:00" : clock(entry.start);
  const vTo = isNew ? "16:30" : clock(entry.end);
  const vPause = isNew ? 30 : (entry.pauseMin || 0);
  const vNote = isNew ? "" : (entry.note || "");

  const bodyHTML = `
    <div class="fields">
      <label>Datum
        <input type="date" id="ef-date" value="${esc(vDate)}" required>
      </label>
      <div class="row">
        <label>Beginn
          <input type="time" id="ef-from" value="${esc(vFrom)}" required>
        </label>
        <label>Ende
          <input type="time" id="ef-to" value="${esc(vTo)}" required>
        </label>
      </div>
      <label>Pause (Min.)
        <input type="number" id="ef-pause" inputmode="numeric" min="0" step="5" value="${esc(vPause)}">
      </label>
      <label>Arbeitsort
        <select id="ef-place">${opts}</select>
      </label>
      <label>Notiz (optional)
        <textarea id="ef-note" rows="2" placeholder="z. B. Montage Küche">${esc(vNote)}</textarea>
      </label>
      <p class="hint" id="ef-net" aria-live="polite"></p>
      <div class="row">
        <button type="button" class="btn primary" id="ef-save">Speichern</button>
      </div>
      ${isNew ? "" : `<div class="row"><button type="button" class="btn danger sm" id="ef-del">Eintrag löschen</button></div>`}
    </div>`;

  const sheet = ui.openSheet({ title: isNew ? "Arbeitszeit nachtragen" : "Eintrag bearbeiten", bodyHTML });
  const box = sheet.el;
  const netEl = box.querySelector("#ef-net");
  const saveBtn = box.querySelector("#ef-save");

  const refresh = () => {
    const r = readTimes(box);
    if (r.error) {
      netEl.textContent = r.error;
    } else {
      const n = netMin({ start: r.start, end: r.end, pauseMin: r.pauseMin });
      netEl.textContent = `Netto ${hm(n)} h` + (r.overnight ? " · endet am nächsten Tag" : "");
    }
  };
  for (const id of ["#ef-date", "#ef-from", "#ef-to", "#ef-pause"]) {
    const inp = box.querySelector(id);
    inp.addEventListener("input", refresh);
    inp.addEventListener("change", refresh);
  }
  refresh();

  saveBtn.addEventListener("click", async () => {
    const r = readTimes(box);
    if (r.error) { netEl.textContent = r.error; ui.toast(r.error, 3500); return; }
    const pid = box.querySelector("#ef-place").value || null;
    let placeName = "";
    if (pid) {
      const pl = places.find((p) => p.id === pid);
      placeName = pl ? pl.name : (orphan && orphan.id === pid ? (entry.place || "") : "");
    }
    const data = {
      ...(entry || {}),
      start: r.start,
      end: r.end,
      pauseMin: r.pauseMin,
      placeId: pid,
      place: placeName,
      note: box.querySelector("#ef-note").value.trim(),
      inLoc: entry ? (entry.inLoc ?? null) : null,
      outLoc: entry ? (entry.outLoc ?? null) : null,
    };
    if (entry && entry.id) data.id = entry.id;
    ui.setBusy(saveBtn, true, "Speichern …");
    try {
      await store.saveEntry(data);
      const d = new Date(r.start);
      curY = d.getFullYear();
      curM = d.getMonth();
      sheet.close();
      ui.toast(isNew ? "Eintrag gespeichert" : "Änderung gespeichert");
      render();
    } catch {
      ui.setBusy(saveBtn, false);
    }
  });

  const delBtn = box.querySelector("#ef-del");
  if (delBtn) {
    ui.confirmButton(delBtn, "Wirklich löschen?", async () => {
      try {
        await store.deleteEntry(entry.id);
        sheet.close();
        ui.toast("Eintrag gelöscht");
      } catch { /* Store zeigt Toast */ }
    });
  }

  return sheet;
}
