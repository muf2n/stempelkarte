// Update 9 – Kalender: Termin-Editor (Blatt) – Titel, Kalender, ganztägig, Beginn/Ende, Wiederholung, Ort, Erinnerungen,
// Notiz, Farbe; bei Serien „Nur diesen / Diesen und alle folgenden / Alle“; Duplizieren, Löschen, als .ics teilen.
import { icon } from "../icons.js";
import {
  addDays, diffDays, isKey, toMin, hhmm, wdOf, parseKey, weekdayPos, RDAYS, parseRRule, formatRRule,
  repeatPresets, presetOf, describeRule, normCalendars, calOf, PALETTE, applyEdit, applyDelete, finalizeEvent,
  expandTodo, reminderOffsets, fmtKey, toICS,
} from "../cal-core.js";
import { CATS } from "../planer-core.js";
import { calColor } from "../planer-core.js";

const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WD_MO_IDX = [1, 2, 3, 4, 5, 6, 0];
const WD2 = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const normTime = (t) => (/^\d{1,2}:\d{2}$/.test(String(t || "")) ? String(t).padStart(5, "0") : null);

export const REM_TIMED = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
export const REM_ALLDAY = [0, 1440, 2880, 10080];
export function remLabel(min, allDay) {
  if (allDay) {
    if (min === 0) return "Am Tag um 09:00";
    if (min % 10080 === 0) return `${min / 10080} Woche${min > 10080 ? "n" : ""} vorher um 09:00`;
    if (min % 1440 === 0) return `${min / 1440} Tag${min > 1440 ? "e" : ""} vorher um 09:00`;
    return `${min} Min. vor 09:00`;
  }
  if (min === 0) return "Zur Uhrzeit";
  if (min % 10080 === 0) return `${min / 10080} Woche${min > 10080 ? "n" : ""} vorher`;
  if (min % 1440 === 0) return `${min / 1440} Tag${min > 1440 ? "e" : ""} vorher`;
  if (min % 60 === 0) return `${min / 60} Std. vorher`;
  return `${min} Min. vorher`;
}
export const mapsLink = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const dShort = (k) => { const { d, m } = parseKey(k); return `${WD2[wdOf(k)]}, ${d}.${m}.`; };

/* ---------- Abfrage bei Serien ---------- */

/** → Promise<"one"|"following"|"all"|null> */
export function askScope(c, title = "Wiederkehrender Termin", { one = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const h = c.ui.openSheet({
      title,
      bodyHTML: `<p class="note">Dieser Termin wiederholt sich. Was soll gelten?</p><div class="stack cal-scope">` +
        (one ? `<button type="button" class="btn" data-scope="one">Nur diesen Termin</button>` : "") +
        `<button type="button" class="btn" data-scope="following">Diesen und alle folgenden</button>` +
        `<button type="button" class="btn" data-scope="all">Alle Termine</button>` +
        `<button type="button" class="btn ghost" data-scope="">Abbrechen</button></div>`,
      onMount(sheet, close) {
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-scope]");
          if (!b) return;
          fin(b.dataset.scope || null);
          close();
        });
        const mo = new MutationObserver(() => { if (!sheet.isConnected) { mo.disconnect(); fin(null); } });
        mo.observe(document.getElementById("sheet-root") || document.body, { childList: true });
      },
    });
    if (!h) fin(null);
  });
}

/** Ergebnis von applyEdit/applyDelete speichern. */
export async function persistResult(c, res) {
  await Promise.all([
    ...res.save.map((t) => c.store.saveTodo(finalizeEvent(t))),
    ...res.create.map((t) => c.store.saveTodo(finalizeEvent(t))),
    ...res.remove.map((id) => c.store.deleteTodo(id)),
  ]);
}

/* ---------- Editor ---------- */

/**
 * Termin anlegen/bearbeiten. todo = gespeicherter Termin (oder null), preset = {date,time,endTime,endDate,allDay,title,cat,countdown,calendarId},
 * instKey = ursprünglicher Tag der angetippten Instanz (bei Serien). opts.openTask(preset) öffnet stattdessen das Aufgaben-Blatt.
 */
export function openEventForm(todo, c, preset = null, instKey = null, opts = {}) {
  const isNew = !todo;
  const pre = preset || {};
  const s0 = c.store.get();
  const cals = normCalendars(s0.settings && s0.settings.calendars);
  const userCals = cals.filter((x) => x.kind === "user");
  const recurring = !!(todo && parseRRule(todo.rrule));
  const inst = todo && recurring && instKey ? expandTodo(todo, instKey, instKey).find((i) => i.key === instKey) || (expandTodo(todo, addDays(instKey, -40), addDays(instKey, 40)).find((i) => i.key === instKey)) : null;
  const src = inst || todo || {};
  const tk = todayKey();
  let lastCal = null;
  try { lastCal = localStorage.getItem("stempelkarte.lastCal"); } catch { /* egal */ }

  const st = {
    title: src.title || pre.title || "",
    calendarId: todo ? calOf(todo, cals) : (pre.calendarId && userCals.some((x) => x.id === pre.calendarId) ? pre.calendarId : (userCals.some((x) => x.id === lastCal) ? lastCal : "privat")),
    allDay: todo ? (src.allDay === true || !normTime(src.time)) : !!pre.allDay || (!pre.time && !!pre.allDayIfNoTime),
    date: isKey(src.date) ? src.date : (isKey(pre.date) ? pre.date : tk),
    time: normTime(src.time) || normTime(pre.time) || (() => { const d = new Date(); return `${pad(Math.min(23, d.getHours() + 1))}:00`; })(),
    endDate: null, endTime: null,
    rrule: todo ? todo.rrule || null : pre.rrule || null,
    location: src.location || pre.location || "",
    note: src.note || "",
    color: src.color || null,
    reminders: todo ? reminderOffsets(todo) : (Array.isArray(pre.reminders) ? pre.reminders : (pre.allDay ? [] : [30])),
    cat: todo ? (CATS[todo.cat] ? todo.cat : null) : (CATS[pre.cat] ? pre.cat : null),
    countdown: todo ? !!todo.countdown : !!pre.countdown,
  };
  if (pre.time && !todo && !pre.allDay) st.allDay = false;
  if (todo) {
    if (st.allDay) { st.endDate = src.endDate || todo.endDate || st.date; st.endTime = null; }
    else {
      let et = src.endTime === "24:00" ? "00:00" : src.endTime;
      let ed = src.endTime === "24:00" ? addDays(src.endDate, 1) : src.endDate;
      if (!inst) {
        const e0 = expandTodo(todo, todo.date, addDays(todo.date, 400))[0];
        if (e0) { et = e0.endTime === "24:00" ? "00:00" : e0.endTime; ed = e0.endTime === "24:00" ? addDays(e0.endDate, 1) : e0.endDate; }
      }
      st.endTime = normTime(et) || hhmm((toMin(st.time) + 60) % 1440);
      st.endDate = ed || st.date;
    }
  } else {
    const st0 = toMin(st.time);
    const et = normTime(pre.endTime);
    const dur = et && toMin(et) > st0 ? toMin(et) - st0 : 60;
    const endAbs = st0 + dur;
    st.endTime = hhmm(endAbs % 1440);
    st.endDate = isKey(pre.endDate) && pre.endDate >= st.date ? pre.endDate : addDays(st.date, Math.floor(endAbs / 1440));
    if (st.allDay) st.endDate = isKey(pre.endDate) && pre.endDate >= st.date ? pre.endDate : st.date;
  }
  st.rrule = st.rrule ? formatRRule(st.rrule) : null;
  const orig = JSON.stringify({ ...st });
  const origRule = st.rrule;

  // Wiederholung (Zustand für „Benutzerdefiniert“)
  const R = (() => {
    const r = parseRRule(st.rrule);
    const p = weekdayPos(st.date);
    return {
      preset: presetOf(st.rrule, st.date),
      freq: r ? r.freq : "WEEKLY",
      interval: r ? r.interval : 1,
      byday: new Set(r && r.freq === "WEEKLY" && r.byday.length ? r.byday.map((b) => b.wd) : [wdOf(st.date)]),
      monthMode: r && r.freq === "MONTHLY" && r.byday.length ? (r.byday[0].n === -1 ? "last" : "nth") : "day",
      end: r && r.until ? "until" : r && r.count ? "count" : "never",
      until: r && r.until ? r.until : addDays(st.date, 90),
      count: r && r.count ? r.count : 10,
      pos: p,
    };
  })();

  const calChips = userCals.map((x) => `<button type="button" class="chip cal-chip" data-cal="${esc(x.id)}" style="--c:${calColor(x.color)}"><i aria-hidden="true"></i><span>${esc(x.name)}</span></button>`).join("");
  const colorChips = `<button type="button" class="cal-sw cal-sw-auto" data-color="" aria-label="Farbe des Kalenders" title="Kalenderfarbe"></button>` +
    PALETTE.map(([k, n]) => `<button type="button" class="cal-sw" data-color="${k}" style="--c:var(--cal-${k})" aria-label="${n}" title="${n}"></button>`).join("");

  const bodyHTML =
    `<div class="fields ag-form cal-form">` +
      (isNew && opts.openTask ? `<div class="chips ag-kind cal-kind" data-r="kind"><button type="button" class="chip" data-k="termin" aria-pressed="true">${icon("calendar", 18)}<span>Termin</span></button>` +
        `<button type="button" class="chip" data-k="todo" aria-pressed="false">${icon("check", 18)}<span>Aufgabe</span></button></div>` : "") +
      `<label>Titel<input type="text" data-r="title" maxlength="140" enterkeyhint="done" placeholder="z. B. Zahnarzt" value="${esc(st.title)}"></label>` +
      (recurring && inst ? `<p class="note cal-recinfo">${icon("repeat", 15)} ${esc(describeRule(todo.rrule, todo.date))} · dieser Termin: ${esc(dShort(instKey))}</p>` : "") +
      `<div><div class="lbl">Kalender</div><div class="chips cal-cals" data-r="cals">${calChips}</div></div>` +
      `<label class="switch"><input type="checkbox" data-r="allday"${st.allDay ? " checked" : ""}><span>Ganztägig</span></label>` +
      `<div class="cal-dt"><div class="row"><label>Beginn<input type="date" data-r="date" value="${esc(st.date)}"></label>` +
        `<label data-r="timewrap">Uhrzeit<input type="time" data-r="time" step="300" value="${esc(st.time)}"></label></div>` +
      `<div class="row"><label>Ende<input type="date" data-r="enddate" value="${esc(st.endDate)}"></label>` +
        `<label data-r="endtimewrap">Uhrzeit<input type="time" data-r="endtime" step="300" value="${esc(st.endTime || "")}"></label></div>` +
        `<p class="hint" data-r="durhint"></p></div>` +
      `<div class="cal-rep"><label>Wiederholen<select data-r="repeat"></select></label>` +
        `<div class="cal-custom" data-r="custom" hidden>` +
          `<div class="row"><label>Alle<input type="number" data-r="iv" min="1" max="99" inputmode="numeric" value="${R.interval}"></label>` +
          `<label>&nbsp;<select data-r="freq"><option value="DAILY">Tage</option><option value="WEEKLY">Wochen</option><option value="MONTHLY">Monate</option><option value="YEARLY">Jahre</option></select></label></div>` +
          `<div class="chips cal-wd" data-r="wds">${WD_MO_IDX.map((w) => `<button type="button" class="chip" data-wd="${w}" aria-label="${WD_LONG[w]}">${WD2[w]}</button>`).join("")}</div>` +
          `<label data-r="mmwrap">Im Monat<select data-r="mmode"></select></label>` +
        `</div>` +
        `<div class="row cal-rend" data-r="rendwrap"><label>Endet<select data-r="rend"><option value="never">Nie</option><option value="until">Am Datum</option><option value="count">Nach Anzahl</option></select></label>` +
          `<label data-r="untilwrap">bis<input type="date" data-r="until" value="${esc(R.until)}"></label>` +
          `<label data-r="countwrap">Termine<input type="number" data-r="count" min="1" max="999" inputmode="numeric" value="${R.count}"></label></div>` +
        `<p class="hint" data-r="rephint"></p>` +
      `</div>` +
      `<div class="cal-loc"><label>Ort<input type="text" data-r="loc" maxlength="200" placeholder="Adresse oder Ort" value="${esc(st.location)}"></label>` +
        `<a class="btn sm ghost cal-maps" data-r="maps" target="_blank" rel="noopener" hidden>${icon("pin", 16)} In Google Maps öffnen</a></div>` +
      `<div class="ag-rem cal-rems"><div class="lbl">Erinnerungen</div><div class="chips" data-r="rems"></div>` +
        `<label class="cal-remadd">Erinnerung hinzufügen<select data-r="remadd"></select></label><p class="hint" data-r="remhint" hidden></p></div>` +
      `<label>Notiz<textarea data-r="note" rows="3" placeholder="optional">${esc(st.note)}</textarea></label>` +
      `<div><div class="lbl">Farbe</div><div class="cal-colors" data-r="colors">${colorChips}</div></div>` +
      `<details class="cal-more"${st.cat || st.countdown ? " open" : ""}><summary>Kategorie &amp; Countdown</summary>` +
        `<div class="chips pl-cats" data-r="cat">${Object.entries(CATS).filter(([k]) => k !== "erinnerung").map(([k, v]) => `<button type="button" class="chip" data-cat="${k}"><span aria-hidden="true">${v.emoji}</span><span>${v.label}</span></button>`).join("")}</div>` +
        `<label class="switch pl-cdsw"><input type="checkbox" data-r="countdown"${st.countdown ? " checked" : ""}><span>⏳ Countdown oben im Planer anzeigen</span></label>` +
      `</details>` +
    `</div>` +
    `<div class="stack" style="margin-top:14px">` +
      `<button type="button" class="btn primary" data-r="save">Speichern</button>` +
      (isNew ? "" :
        `<div class="row cal-actions"><button type="button" class="btn ghost" data-r="dup">${icon("copy", 16)} Duplizieren</button>` +
        `<button type="button" class="btn ghost" data-r="ics">${icon("share", 16)} Als .ics</button></div>` +
        (!recurring ? `<button type="button" class="btn ghost" data-r="toggle">${todo.done ? "Wieder offen" : "Als erledigt abhaken"}</button>` : "") +
        `<button type="button" class="btn danger" data-r="del">Löschen</button>`) +
    `</div>`;

  return c.ui.openSheet({
    title: isNew ? (st.cat ? `Neu: ${CATS[st.cat].label}` : "Neuer Termin") : (recurring ? "Termin (Serie)" : "Termin"),
    bodyHTML,
    onMount(sheet, close) {
      const $ = (r) => sheet.querySelector(`[data-r="${r}"]`);

      const buildRule = () => {
        if (R.preset === "none") return null;
        let r;
        if (R.preset !== "custom") r = parseRRule(repeatPresets(st.date).find((x) => x[0] === R.preset)[2]);
        else {
          r = { freq: R.freq, interval: Math.max(1, Math.min(99, Number(R.interval) || 1)), byday: [], bymonthday: [], bymonth: [] };
          if (R.freq === "WEEKLY") r.byday = [...R.byday].map((wd) => ({ wd, n: 0 }));
          if (R.freq === "MONTHLY") {
            const p = weekdayPos(st.date);
            if (R.monthMode === "nth") r.byday = [{ wd: wdOf(st.date), n: Math.min(p.n, 4) }];
            else if (R.monthMode === "last") r.byday = [{ wd: wdOf(st.date), n: -1 }];
            else r.bymonthday = [parseKey(st.date).d];
          }
        }
        if (R.end === "until" && isKey(R.until)) r.until = R.until >= st.date ? R.until : st.date;
        else if (R.end === "count") r.count = Math.max(1, Math.min(999, Number(R.count) || 1));
        return formatRRule(r);
      };

      const drawRepeat = () => {
        const sel = $("repeat");
        const list = repeatPresets(st.date);
        sel.innerHTML = list.map(([id, l]) => `<option value="${id}"${id === R.preset ? " selected" : ""}>${esc(l)}</option>`).join("");
        $("custom").hidden = R.preset !== "custom";
        $("rendwrap").hidden = R.preset === "none";
        $("freq").value = R.freq;
        $("wds").hidden = R.freq !== "WEEKLY";
        $("wds").querySelectorAll("[data-wd]").forEach((b) => b.setAttribute("aria-pressed", String(R.byday.has(Number(b.dataset.wd)))));
        const p = weekdayPos(st.date);
        $("mmode").innerHTML = `<option value="day">am ${parseKey(st.date).d}.</option>` +
          (p.n <= 4 ? `<option value="nth">am ${p.n}. ${WD_LONG[wdOf(st.date)]}</option>` : "") +
          (p.last ? `<option value="last">am letzten ${WD_LONG[wdOf(st.date)]}</option>` : "");
        if (![...$("mmode").options].some((o) => o.value === R.monthMode)) R.monthMode = "day";
        $("mmode").value = R.monthMode;
        $("mmwrap").hidden = R.freq !== "MONTHLY";
        $("rend").value = R.end;
        $("untilwrap").hidden = R.end !== "until";
        $("countwrap").hidden = R.end !== "count";
        st.rrule = R.touched ? buildRule() : origRule;
        $("rephint").textContent = st.rrule ? describeRule(st.rrule, st.date) : "";
        $("rephint").hidden = !st.rrule;
      };

      const drawRems = () => {
        const opts = st.allDay ? REM_ALLDAY : REM_TIMED;
        $("rems").innerHTML = st.reminders.length
          ? st.reminders.map((m) => `<span class="chip cal-rem">${esc(remLabel(m, st.allDay))}<button type="button" data-rmrem="${m}" aria-label="Erinnerung ${esc(remLabel(m, st.allDay))} entfernen">✕</button></span>`).join("")
          : `<span class="note">Keine Erinnerung</span>`;
        $("remadd").innerHTML = `<option value="">+ Erinnerung …</option>` + opts.filter((m) => !st.reminders.includes(m)).map((m) => `<option value="${m}">${esc(remLabel(m, st.allDay))}</option>`).join("");
        const hint = $("remhint");
        let h = "";
        if (st.reminders.length) {
          const s = c.store.get();
          if (s.mode !== "cloud") h = "Ohne Google-Konto erinnert die App nur, solange sie geöffnet ist.";
          else if (typeof Notification !== "undefined" && Notification.permission !== "granted") h = "Erlaube Benachrichtigungen unter Übersicht → Erinnerungen, damit sie ankommen.";
        }
        hint.textContent = h;
        hint.hidden = !h;
      };

      const draw = () => {
        sheet.querySelectorAll("[data-cal]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cal === st.calendarId)));
        $("timewrap").hidden = st.allDay;
        $("endtimewrap").hidden = st.allDay;
        $("enddate").min = st.date;
        const loc = st.location.trim();
        $("maps").hidden = !loc;
        if (loc) $("maps").href = mapsLink(loc);
        sheet.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.color || null) === (st.color || null))));
        const cc = userCals.find((x) => x.id === st.calendarId);
        const auto = sheet.querySelector(".cal-sw-auto");
        if (auto && cc) auto.style.setProperty("--c", calColor(cc.color));
        sheet.querySelectorAll("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cat === st.cat)));
        // Dauer-Hinweis
        let h = "";
        if (st.allDay) { const n = diffDays(st.date, st.endDate) + 1; h = n > 1 ? `${n} Tage` : ""; }
        else {
          const dur = diffDays(st.date, st.endDate) * 1440 + toMin(st.endTime) - toMin(st.time);
          if (dur <= 0) h = "⚠ Ende liegt vor dem Beginn";
          else h = dur >= 1440 ? `${Math.floor(dur / 1440)} T. ${Math.floor((dur % 1440) / 60)} Std.` : dur % 60 ? `${Math.floor(dur / 60)} Std. ${dur % 60} Min.` : `${dur / 60} Std.`;
        }
        $("durhint").textContent = h;
        $("durhint").hidden = !h;
      };
      drawRepeat();
      drawRems();
      draw();

      const kind = $("kind");
      if (kind) kind.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-k=todo]");
        if (!b) return;
        close();
        opts.openTask({ kind: "todo", title: $("title").value.trim(), date: st.date, time: st.allDay ? null : st.time });
      });
      $("cals").addEventListener("click", (ev) => { const b = ev.target.closest("[data-cal]"); if (b) { st.calendarId = b.dataset.cal; draw(); } });
      $("allday").addEventListener("change", () => {
        st.allDay = $("allday").checked;
        if (st.allDay) { st.reminders = st.reminders.filter((m) => REM_ALLDAY.includes(m)); }
        else if (st.endDate > st.date && diffDays(st.date, st.endDate) === 0) st.endDate = st.date;
        $("enddate").value = st.endDate;
        drawRems(); draw();
      });
      $("date").addEventListener("change", () => {
        const v = $("date").value;
        if (!isKey(v)) return;
        const shift = diffDays(st.date, v);
        st.date = v;
        st.endDate = addDays(st.endDate, shift);
        $("enddate").value = st.endDate;
        if (R.preset === "custom" && R.freq === "WEEKLY" && R.byday.size === 1) R.byday = new Set([wdOf(v)]);
        drawRepeat(); draw();
      });
      $("time").addEventListener("change", () => {
        const v = normTime($("time").value);
        if (!v) return;
        const dur = diffDays(st.date, st.endDate) * 1440 + toMin(st.endTime) - toMin(st.time);
        st.time = v;
        const endAbs = toMin(v) + (dur > 0 ? dur : 60);
        st.endTime = hhmm(endAbs % 1440);
        st.endDate = addDays(st.date, Math.floor(endAbs / 1440));
        $("endtime").value = st.endTime;
        $("enddate").value = st.endDate;
        draw();
      });
      $("enddate").addEventListener("change", () => { const v = $("enddate").value; if (isKey(v)) { st.endDate = v < st.date ? st.date : v; $("enddate").value = st.endDate; } draw(); });
      $("endtime").addEventListener("change", () => {
        const v = normTime($("endtime").value);
        if (!v) return;
        st.endTime = v;
        if (st.endDate === st.date && toMin(v) <= toMin(st.time)) { st.endDate = addDays(st.date, 1); $("enddate").value = st.endDate; }
        draw();
      });
      $("endtime").addEventListener("input", () => { const v = normTime($("endtime").value); if (v) { st.endTime = v; draw(); } });
      $("repeat").addEventListener("change", () => { R.touched = true; R.preset = $("repeat").value; if (R.preset === "custom") { R.byday = new Set([wdOf(st.date)]); } drawRepeat(); });
      $("iv").addEventListener("input", () => { R.touched = true; R.interval = Number($("iv").value) || 1; drawRepeat(); });
      $("freq").addEventListener("change", () => { R.touched = true; R.freq = $("freq").value; drawRepeat(); });
      $("wds").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-wd]");
        if (!b) return;
        const w = Number(b.dataset.wd);
        R.touched = true;
        if (R.byday.has(w) && R.byday.size > 1) R.byday.delete(w); else R.byday.add(w);
        drawRepeat();
      });
      $("mmode").addEventListener("change", () => { R.touched = true; R.monthMode = $("mmode").value; drawRepeat(); });
      $("rend").addEventListener("change", () => { R.touched = true; R.end = $("rend").value; drawRepeat(); });
      $("until").addEventListener("change", () => { R.touched = true; R.until = $("until").value; drawRepeat(); });
      $("count").addEventListener("input", () => { R.touched = true; R.count = Number($("count").value) || 1; drawRepeat(); });
      $("loc").addEventListener("input", () => { st.location = $("loc").value; draw(); });
      $("rems").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-rmrem]");
        if (!b) return;
        st.reminders = st.reminders.filter((m) => m !== Number(b.dataset.rmrem));
        drawRems();
      });
      $("remadd").addEventListener("change", () => {
        const v = $("remadd").value;
        if (v !== "") st.reminders = [...new Set([...st.reminders, Number(v)])].sort((a, b) => a - b);
        drawRems();
      });
      $("colors").addEventListener("click", (ev) => { const b = ev.target.closest("[data-color]"); if (b) { st.color = b.dataset.color || null; draw(); } });
      $("cat").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-cat]");
        if (!b) return;
        st.cat = st.cat === b.dataset.cat ? null : b.dataset.cat;
        if (st.cat && isNew && !st.countdown) { st.countdown = true; $("countdown").checked = true; }
        draw();
      });
      $("countdown").addEventListener("change", () => { st.countdown = $("countdown").checked; });
      $("title").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("save").click(); } });
      if (isNew && !$("title").value) setTimeout(() => { try { $("title").focus(); } catch { /* egal */ } }, 60);

      const collect = () => {
        st.note = $("note").value.trim();
        st.title = $("title").value.trim();
        const ch = {
          title: st.title, allDay: st.allDay, date: st.date,
          time: st.allDay ? null : st.time, endDate: st.endDate, endTime: st.allDay ? null : st.endTime,
          location: st.location.trim(), note: st.note, color: st.color || null,
        };
        return ch;
      };
      const extra = () => ({ calendarId: st.calendarId, reminders: st.reminders, cat: st.cat || null, countdown: !!(st.countdown && !st.rrule) });

      const saveBtn = $("save");
      saveBtn.addEventListener("click", async () => {
        const ch = collect();
        if (!ch.title) { c.ui.toast("Bitte gib dem Termin einen Titel."); $("title").focus(); return; }
        if (!st.allDay && diffDays(st.date, st.endDate) * 1440 + toMin(st.endTime) - toMin(st.time) <= 0) { c.ui.toast("Das Ende liegt vor dem Beginn."); return; }
        try { localStorage.setItem("stempelkarte.lastCal", st.calendarId); } catch { /* egal */ }
        const ruleChanged = (st.rrule || null) !== origRule;
        c.ui.setBusy(saveBtn, true, "Speichert …");
        try {
          if (isNew) {
            await c.store.saveTodo(finalizeEvent({ kind: "termin", ...ch, ...extra(), rrule: st.rrule, done: false, doneAt: null }));
            close();
            c.ui.toast(st.rrule ? `Serie gespeichert · ${describeRule(st.rrule, st.date)}` : "Termin gespeichert", 2000);
            return;
          }
          if (!recurring || !instKey) {
            await c.store.saveTodo(finalizeEvent({ ...todo, ...ch, ...extra(), rrule: st.rrule }));
            close();
            c.ui.toast("Gespeichert", 1600);
            return;
          }
          if (JSON.stringify({ ...st, note: st.note, title: st.title }) === orig && !ruleChanged) { close(); return; }
          c.ui.setBusy(saveBtn, false);
          const scope = await askScope(c, "Änderung speichern", { one: !ruleChanged });
          if (!scope) return;
          c.ui.setBusy(saveBtn, true, "Speichert …");
          const changes = scope === "one" ? ch : { ...ch, ...extra(), ...(ruleChanged ? { rrule: st.rrule } : {}) };
          const res = applyEdit(todo, instKey, changes, scope);
          if (scope !== "one") for (const t of [...res.save, ...res.create]) Object.assign(t, extra());
          await persistResult(c, res);
          close();
          c.ui.toast(scope === "one" ? "Nur dieser Termin geändert" : scope === "following" ? "Dieser und alle folgenden geändert" : "Alle Termine geändert", 2000);
        } catch (e) { console.error(e); c.ui.setBusy(saveBtn, false); }
      });

      const dup = $("dup");
      if (dup) dup.addEventListener("click", async () => {
        const ch = collect();
        const copy = { ...todo, ...ch, ...extra(), rrule: st.rrule, title: ch.title || todo.title };
        delete copy.id; delete copy.icsUid; delete copy.createdAt;
        try { await c.store.saveTodo(finalizeEvent({ ...copy, done: false, doneAt: null })); close(); c.ui.toast("Kopie angelegt", 1800); } catch { /* Toast vom Store */ }
      });
      const ics = $("ics");
      if (ics) ics.addEventListener("click", () => {
        const name = (todo.title || "termin").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "termin";
        shareICS(c, toICS([todo], { name: todo.title || "Termin" }), `${name}.ics`, todo.title || "Termin");
      });
      const tg = $("toggle");
      if (tg) tg.addEventListener("click", async () => {
        close();
        try { await c.store.saveTodo({ ...todo, done: !todo.done, doneAt: !todo.done ? Date.now() : null }); c.ui.toast(!todo.done ? "Termin abgehakt ✓" : "Wieder offen", 1600); } catch { /* egal */ }
      });
      const del = $("del");
      if (del) c.ui.confirmButton(del, "Wirklich löschen?", async () => {
        try {
          if (recurring && instKey) {
            const scope = await askScope(c, "Termin löschen");
            if (!scope) return;
            await persistResult(c, applyDelete(todo, instKey, scope));
            close();
            c.ui.toast(scope === "one" ? "Dieser Termin gelöscht" : scope === "following" ? "Dieser und alle folgenden gelöscht" : "Serie gelöscht", 1800);
          } else {
            await c.store.deleteTodo(todo.id);
            close();
            c.ui.toast("Gelöscht.");
          }
        } catch (e) { console.error(e); }
      });
    },
  });
}

/* ---------- Google-Termin (nur lesen) ---------- */

export function openGoogleEvent(inst, c, calName = "Google") {
  const when = inst.allDay
    ? (inst.endDate > inst.date ? `${dShort(inst.date)} – ${dShort(inst.endDate)} (ganztägig)` : `${dShort(inst.date)} (ganztägig)`)
    : `${dShort(inst.date)} ${inst.time} – ${inst.endDate > inst.date ? dShort(inst.endDate) + " " : ""}${inst.endTime}`;
  return c.ui.openSheet({
    title: inst.title || "Google-Termin",
    bodyHTML: `<div class="cal-gev" style="--c:${esc(inst.color || "#4285F4")}">` +
      `<p class="cal-gev-cal"><i aria-hidden="true"></i>${esc(calName)} · nur lesen</p>` +
      `<p><b>${esc(when)}</b></p>` +
      (inst.location ? `<p>${icon("pin", 16)} ${esc(inst.location)} · <a href="${esc(mapsLink(inst.location))}" target="_blank" rel="noopener">Karte</a></p>` : "") +
      (inst.note ? `<p class="cal-gev-note">${esc(inst.note)}</p>` : "") +
      `</div><div class="stack" style="margin-top:14px">` +
      (inst.htmlLink ? `<a class="btn primary" href="${esc(inst.htmlLink)}" target="_blank" rel="noopener" data-r="glink">In Google Kalender öffnen</a>` : "") +
      `</div>`,
  });
}

/* ---------- .ics teilen / herunterladen ---------- */

export async function shareICS(c, text, filename, title = "Kalender") {
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  try {
    if (typeof File !== "undefined" && navigator.canShare && navigator.share) {
      const file = new File([blob], filename, { type: "text/calendar" });
      if (navigator.canShare({ files: [file] }) && matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ files: [file], title });
        return "share";
      }
    }
  } catch (e) { if (e && e.name === "AbortError") return "cancel"; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  c.ui.toast(`${filename} heruntergeladen`, 2000);
  return "download";
}

export { fmtKey, MONTHS };
