// Schule & Lernen – Stundenplan (school_timetable) als Wochenraster.
// Baut auf den Berufsschul-Tagen aus den Einstellungen auf (settings.school: wöchentliche Tage + Blockschule):
// Stunden an Tagen ohne Schule werden in der gewählten Woche blass angezeigt.
import {
  col, safeWrite, esc, todayKey, addDays, mondayOf, dateOf, fmtDay, fmtDate, pad, toMin, fromMin, RE_DATE,
  prefs, savePrefs, abWeek, schoolDayLabel, hasSchoolSettings, subjectColor, subjectInputHTML, wireSubjectChips,
  emptyHTML, armDelete, abbr, PALETTE, WD, WD_LONG,
} from "./school-core.js";

// Übliche Stundenzeiten (50 min) – nur Vorschlag, beim Eintragen änderbar
export const PERIODS = [
  null, ["08:00", "08:50"], ["08:50", "09:40"], ["09:55", "10:45"], ["10:45", "11:35"], ["11:45", "12:35"], ["12:35", "13:25"],
  ["13:45", "14:35"], ["14:35", "15:25"], ["15:35", "16:25"], ["16:25", "17:15"], ["17:20", "18:10"], ["18:10", "19:00"],
];
const span = (l) => Math.max(1, Number(l.periods) || 1);

function kw(k) {
  const d = dateOf(k); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

/** Schulstatus eines Tages: {on, label}. Ohne Schul-Einstellungen zählt jeder Tag mit Stunden. */
export function schoolStatus(S, k) {
  if (!hasSchoolSettings(S.ctx)) return { on: true, label: null, configured: false };
  const label = schoolDayLabel(S.ctx, k);
  return { on: !!label, label, configured: true };
}

export function openLessonForm(S, lesson = null, preset = {}) {
  const p = prefs(S.data);
  const l = lesson || { weekday: 1, period: 1, periods: 1, subject: "", room: "", teacher: "", color: "", week: "", ...preset };
  const per0 = Number(l.period) || 1;
  const def = (n) => PERIODS[n] || PERIODS[1];
  S.ctx.ui.openSheet({
    title: lesson ? "Stunde bearbeiten" : "Stunde eintragen",
    bodyHTML: `<form class="fields ss-form" novalidate>
      ${subjectInputHTML(S.data, "tt-subj", l.subject)}
      <div><div class="lbl">Tag</div><div class="chips ss-wdpick">${[1, 2, 3, 4, 5, 6].map((d) => `<button type="button" class="chip" data-wd="${d}" aria-pressed="${Number(l.weekday) === d}">${WD[d]}</button>`).join("")}</div></div>
      <div class="row">
        <label>Stunde<select id="tt-p">${PERIODS.slice(1).map((_, i) => `<option value="${i + 1}"${i + 1 === per0 ? " selected" : ""}>${i + 1}.</option>`).join("")}</select></label>
        <label>bis Stunde<select id="tt-p2">${PERIODS.slice(1).map((_, i) => `<option value="${i + 1}"${i + 1 === per0 + span(l) - 1 ? " selected" : ""}>${i + 1}.</option>`).join("")}</select></label>
      </div>
      <div class="row">
        <label>von<input type="time" id="tt-from" value="${esc(l.from || def(per0)[0])}"></label>
        <label>bis<input type="time" id="tt-to" value="${esc(l.to || def(per0 + span(l) - 1)[1])}"></label>
      </div>
      <div class="row">
        <label>Raum<input type="text" id="tt-room" maxlength="20" value="${esc(l.room || "")}" placeholder="z. B. E 204"></label>
        <label>Lehrer/in<input type="text" id="tt-teacher" maxlength="40" value="${esc(l.teacher || "")}" placeholder="z. B. Hr. Huber"></label>
      </div>
      <div><div class="lbl">Farbe</div><div class="ss-swatches" role="radiogroup">
        <button type="button" data-c="" aria-pressed="${!l.color}" aria-label="Automatisch" class="auto">A</button>
        ${PALETTE.map((c) => `<button type="button" data-c="${c}" style="--c:${c}" aria-pressed="${l.color === c}" aria-label="Farbe ${c}"></button>`).join("")}
      </div></div>
      ${p.abWeeks ? `<div><div class="lbl">Woche</div><div class="chips ss-weekpick">${[["", "Jede Woche"], ["A", "Nur A-Woche"], ["B", "Nur B-Woche"]].map(([v, t]) => `<button type="button" class="chip" data-w="${v}" aria-pressed="${(l.week || "") === v}">${t}</button>`).join("")}</div></div>` : ""}
      <div class="row"><button type="submit" class="btn primary">Speichern</button></div>
      ${lesson ? `<div class="row"><button type="button" class="btn ghost sm" id="tt-dup">Kopie für anderen Tag</button><button type="button" class="btn danger sm" id="tt-del">Löschen</button></div>` : ""}
    </form>`,
    onMount(el, close) {
      wireSubjectChips(el);
      let wd = Number(l.weekday) || 1, color = l.color || "", week = l.week || "";
      const pick = (sel, attr, set) => { const box = el.querySelector(sel); if (!box) return; box.addEventListener("click", (ev) => {
        const b = ev.target.closest(`[${attr}]`); if (!b) return;
        set(b.getAttribute(attr));
        box.querySelectorAll(`[${attr}]`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      }); };
      pick(".ss-wdpick", "data-wd", (v) => { wd = Number(v); });
      pick(".ss-swatches", "data-c", (v) => { color = v; });
      pick(".ss-weekpick", "data-w", (v) => { week = v; });
      const p1 = el.querySelector("#tt-p"), p2 = el.querySelector("#tt-p2");
      p1.addEventListener("change", () => {
        if (Number(p2.value) < Number(p1.value)) p2.value = p1.value;
        el.querySelector("#tt-from").value = def(Number(p1.value))[0];
        el.querySelector("#tt-to").value = def(Number(p2.value))[1];
      });
      p2.addEventListener("change", () => {
        if (Number(p2.value) < Number(p1.value)) p1.value = p2.value;
        el.querySelector("#tt-to").value = def(Number(p2.value))[1];
      });
      const collect = () => {
        const subject = el.querySelector("#tt-subj").value.trim();
        if (!subject) { S.ctx.ui.toast("Bitte ein Fach eingeben."); return null; }
        const a = Number(p1.value), b = Math.max(a, Number(p2.value));
        return { subject, weekday: wd, period: a, periods: b - a + 1, from: el.querySelector("#tt-from").value, to: el.querySelector("#tt-to").value,
          room: el.querySelector("#tt-room").value.trim(), teacher: el.querySelector("#tt-teacher").value.trim(), color, week: p.abWeeks ? week : (l.week || "") };
      };
      el.querySelector("form").addEventListener("submit", (ev) => {
        ev.preventDefault();
        const d = collect(); if (!d) return;
        const clash = (S.data.timetable || []).find((x) => x.id !== (lesson && lesson.id) && Number(x.weekday) === d.weekday
          && (!x.week || !d.week || x.week === d.week) && x.period < d.period + d.periods && d.period < x.period + span(x));
        safeWrite(col("timetable").put({ ...(lesson || {}), ...d }));
        S.ctx.ui.toast(clash ? `Gespeichert – überschneidet sich mit ${clash.subject}` : `${d.subject} am ${WD_LONG[d.weekday]} gespeichert`);
        close();
      });
      const dup = el.querySelector("#tt-dup");
      if (dup) dup.addEventListener("click", () => { const d = collect(); if (!d) return; close(); openLessonForm(S, null, { ...d, weekday: d.weekday >= 6 ? 1 : d.weekday + 1 }); });
      armDelete(el.querySelector("#tt-del"), () => { safeWrite(col("timetable").remove(lesson.id)); S.ctx.ui.toast("Stunde gelöscht"); close(); });
    },
  });
}

function openTtSettings(S) {
  const p = prefs(S.data);
  const mon = mondayOf(todayKey());
  const cur = abWeek({ ...p, abWeeks: true }, mon);
  S.ctx.ui.openSheet({
    title: "Stundenplan-Einstellungen",
    bodyHTML: `<div class="fields ss-form">
      <label class="switch">A/B-Wochen (abwechselnder Plan)<input type="checkbox" id="ab-on"${p.abWeeks ? " checked" : ""}></label>
      <div id="ab-box"${p.abWeeks ? "" : " hidden"}><div class="lbl">Diese Woche (KW ${kw(mon)}) ist eine</div>
        <div class="chips ss-abpick"><button type="button" class="chip" data-ab="A" aria-pressed="${cur === "A"}">A-Woche</button><button type="button" class="chip" data-ab="B" aria-pressed="${cur === "B"}">B-Woche</button></div></div>
      <p class="note">Deine Schultage (wöchentlich oder Blockschule) stellst du in der Übersicht unter „Berufsschule“ ein – der Stundenplan zeigt sich dann an genau diesen Tagen.</p>
      <button type="button" class="btn ghost sm" id="ab-sc">Berufsschul-Tage öffnen</button>
      <div class="row"><button type="button" class="btn primary" id="ab-save">Speichern</button></div>
    </div>`,
    onMount(el, close) {
      let ab = cur;
      el.querySelector("#ab-on").addEventListener("change", (ev) => { el.querySelector("#ab-box").hidden = !ev.target.checked; });
      el.querySelector(".ss-abpick").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-ab]"); if (!b) return; ab = b.dataset.ab;
        el.querySelectorAll("[data-ab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      el.querySelector("#ab-sc").addEventListener("click", () => { close(); if (S.ctx.jump) S.ctx.jump("school-panel"); });
      el.querySelector("#ab-save").addEventListener("click", () => {
        const on = el.querySelector("#ab-on").checked;
        savePrefs(S.data, { abWeeks: on, abRef: ab === "A" ? mon : addDays(mon, -7) });
        S.ctx.ui.toast("Gespeichert"); close();
      });
    },
  });
}

export function lessonLine(S, l, { now = false } = {}) {
  const c = l.color || subjectColor(S.data, l.subject);
  return `<li class="ss-lesson${now ? " now" : ""}" style="--c:${esc(c)}">
    <span class="ss-lesson-time">${esc(l.from || "")}<small>${esc(l.to || "")}</small></span>
    <span class="ss-lesson-main"><b>${esc(l.subject)}</b><span class="ss-meta">${span(l) > 1 ? `<span>${l.period}.–${l.period + span(l) - 1}. Std.</span>` : `<span>${l.period}. Std.</span>`}${l.room ? `<span>📍 ${esc(l.room)}</span>` : ""}${l.teacher ? `<span>${esc(l.teacher)}</span>` : ""}${l.week ? `<span>${esc(l.week)}-Woche</span>` : ""}</span></span>
    ${now ? `<span class="ss-now">jetzt</span>` : ""}</li>`;
}

export function renderTimetable(body, S) {
  const p = prefs(S.data);
  const today = todayKey();
  const mon = S.view.ttWeek && RE_DATE.test(S.view.ttWeek) ? S.view.ttWeek : mondayOf(today);
  const all = S.data.timetable || [];
  const ab = abWeek(p, mon);
  const lessons = all.filter((l) => !ab || !l.week || l.week === ab);
  const days = [1, 2, 3, 4, 5, ...(all.some((l) => Number(l.weekday) === 6) ? [6] : [])];
  const maxP = Math.max(6, ...lessons.map((l) => Number(l.period) + span(l) - 1));
  const minP = Math.min(1, ...lessons.map((l) => Number(l.period) || 1));
  const configured = hasSchoolSettings(S.ctx);
  const timeOf = (n) => { const l = all.find((x) => Number(x.period) === n && x.from); return l ? l.from : (PERIODS[n] || [""])[0]; };
  const st = days.map((d) => { const k = addDays(mon, d - 1); return { d, k, ...schoolStatus(S, k) }; });
  const schoolDaysTxt = (() => {
    try {
      const sc = S.ctx.util.readSchool(S.ctx.store.get().settings);
      if (!sc) return "";
      const parts = [];
      if (sc.days.length) parts.push("jeden " + sc.days.map((d) => WD[d]).join(", "));
      const nextB = sc.blocks.filter((b) => b.to >= today).sort((a, b) => (a.from < b.from ? -1 : 1))[0];
      if (nextB) parts.push(`${nextB.label || "Blockschule"} ${fmtDate(nextB.from)} – ${fmtDate(nextB.to)}`);
      return parts.join(" · ");
    } catch { return ""; }
  })();

  let grid = "";
  if (all.length) {
    const rows = maxP - minP + 1;
    grid = `<div class="ss-tt" style="--cols:${days.length};--rows:${rows}">
      <div class="ss-tt-corner"></div>
      ${st.map((x, i) => `<div class="ss-tt-dh${x.k === today ? " today" : ""}${x.on ? "" : " off"}" style="grid-column:${i + 2}">
        <b>${WD[x.d]}</b><span>${esc(fmtDay(x.k).slice(4, 10))}</span>${x.configured ? `<i class="${x.on ? "on" : ""}">${esc(x.on ? (x.label === "Berufsschule" ? "Schule" : x.label) : "frei")}</i>` : ""}</div>`).join("")}
      ${Array.from({ length: rows }, (_, r) => `<div class="ss-tt-ph" style="grid-row:${r + 2}"><b>${minP + r}</b><span>${esc(timeOf(minP + r))}</span></div>`).join("")}
      ${st.map((x, i) => Array.from({ length: rows }, (_, r) => `<button type="button" class="ss-tt-empty${x.on ? "" : " off"}" style="grid-column:${i + 2};grid-row:${r + 2}" data-new="${x.d}:${minP + r}" aria-label="Stunde am ${WD_LONG[x.d]}, ${minP + r}. Stunde eintragen"></button>`).join("")).join("")}
      ${lessons.map((l) => {
        const i = days.indexOf(Number(l.weekday)); if (i < 0) return "";
        const x = st[i];
        const c = l.color || subjectColor(S.data, l.subject);
        const sp = Math.min(span(l), maxP - l.period + 1);
        return `<button type="button" class="ss-tt-l${x.on ? "" : " off"}${x.k === today ? " today" : ""}" data-lesson="${esc(l.id)}" style="grid-column:${i + 2};grid-row:${l.period - minP + 2} / span ${sp};--c:${esc(c)}" title="${esc(`${l.subject} · ${l.from || ""}–${l.to || ""}${l.room ? " · " + l.room : ""}`)}">
          <b class="full">${esc(l.subject)}</b><b class="short">${esc(abbr(l.subject))}</b>${l.room ? `<span>${esc(l.room)}</span>` : ""}${l.week ? `<i>${esc(l.week)}</i>` : ""}</button>`;
      }).join("")}
    </div>`;
  }

  body.innerHTML = `<div class="ss-toolbar ss-weeknav">
      <button type="button" class="ss-icon-btn" data-wk="-7" aria-label="Vorige Woche">‹</button>
      <button type="button" class="ss-wk-t" data-wk="0"><b>KW ${kw(mon)}${ab ? ` · ${ab}-Woche` : ""}</b><span>${esc(fmtDate(mon).slice(0, 6))} – ${esc(fmtDate(addDays(mon, 4)))}${mon === mondayOf(today) ? " · diese Woche" : ""}</span></button>
      <button type="button" class="ss-icon-btn" data-wk="7" aria-label="Nächste Woche">›</button>
      <span class="ss-spacer"></span>
      <button type="button" class="ss-icon-btn" id="tt-set" aria-label="Stundenplan-Einstellungen">⚙</button>
      <button type="button" class="btn primary sm" data-act="add-lesson">+ Stunde</button>
    </div>
    ${configured ? `<p class="note ss-sc-note">🏫 Berufsschule: ${esc(schoolDaysTxt)} <button type="button" class="linkbtn" id="tt-sc">ändern</button></p>`
      : `<div class="hint ss-sc-hint">Tipp: Trag deine Schultage in der Übersicht unter <b>Berufsschule</b> ein – dann zeigt „Heute“ den Stundenplan genau an Schultagen (auch Blockschule). <button type="button" class="linkbtn" id="tt-sc">Jetzt eintragen</button></div>`}
    ${all.length ? grid + `<p class="note">Tippe auf eine Stunde zum Bearbeiten, auf ein leeres Feld zum Eintragen.</p>`
      : emptyHTML("🗓️", "Stundenplan ist leer", "Trag deine Fächer mit Zeit, Raum und Lehrer/in ein – als Wochenraster mit Farben.", "Hinzufügen", "add-lesson")}`;

  body.querySelectorAll("[data-act=add-lesson]").forEach((b) => b.addEventListener("click", () => {
    const firstOn = st.find((x) => x.on && x.configured);
    openLessonForm(S, null, { weekday: firstOn ? firstOn.d : 1 });
  }));
  body.querySelectorAll("[data-lesson]").forEach((b) => b.addEventListener("click", () => openLessonForm(S, col("timetable").get(b.dataset.lesson))));
  body.querySelectorAll("[data-new]").forEach((b) => b.addEventListener("click", () => { const [d, per] = b.dataset.new.split(":").map(Number); openLessonForm(S, null, { weekday: d, period: per }); }));
  body.querySelectorAll("[data-wk]").forEach((b) => b.addEventListener("click", () => {
    const n = Number(b.dataset.wk);
    S.view.ttWeek = n ? addDays(mon, n) : mondayOf(today); S.rerender();
  }));
  body.querySelector("#tt-set").addEventListener("click", () => openTtSettings(S));
  const sc = body.querySelector("#tt-sc");
  if (sc) sc.addEventListener("click", () => { if (S.ctx.jump) S.ctx.jump("school-panel"); });
}

export { toMin, fromMin, pad };
