// Schule & Lernen – Stundenplan (school_timetable) als Wochenraster.
// Baut auf den Berufsschul-Tagen aus den Einstellungen auf (settings.school: wöchentliche Tage + Blockschule):
// Stunden an Tagen ohne Schule werden in der gewählten Woche blass angezeigt.
import {
  col, safeWrite, esc, todayKey, addDays, mondayOf, dateOf, fmtDay, fmtDate, pad, toMin, fromMin, RE_DATE,
  prefs, savePrefs, abWeek, schoolDayLabel, hasSchoolSettings, subjectColor, subjectInputHTML, wireSubjectChips,
  emptyHTML, armDelete, abbr, PALETTE, WD, WD_LONG,
} from "./school-core.js";
import { askClaude, aiAvailable } from "./ai-client.js";
import { shrinkImage } from "./unterwegs-shared.js";
import { parsePlan, sameLesson, clashes, lessonsFromEvents } from "./school-photo-core.js";
import * as FD from "../cal-feeds.js";

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

/* ---------- 📷 Stundenplan vom Foto ---------- */
function pickPhotos() {
  return new Promise((res) => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
    inp.addEventListener("change", () => res(inp.files ? [...inp.files].slice(0, 6) : []), { once: true });
    inp.click();
  });
}
export async function photoImport(S) {
  const ui = S.ctx.ui;
  if (!aiAvailable()) { ui.toast("📷 Stundenplan vom Foto geht mit der Google-Anmeldung und dem Claude-Server.", 3600); return; }
  const files = await pickPhotos(); if (!files.length) return;
  const imgs = [];
  for (const f of files) { try { imgs.push(await shrinkImage(f, { maxSide: 1800, maxBytes: 900 * 1024, quality: 0.85 })); } catch (e) { ui.toast(e.message || "Foto geht nicht."); return; } }
  const ctrl = new AbortController(); let closeWait = null, waitEl = null;
  ui.openSheet({ title: "📷 Stundenplan lesen …", bodyHTML: `<div class="tt-ph-wait"><img src="${imgs[0].data}" alt="Dein Foto"><p data-k="st">Claude liest deinen Stundenplan … (ca. 10–30 s${imgs.length > 1 ? ` pro Bild, ${imgs.length} Bilder` : ""})</p></div>`,
    onMount(el, close) { closeWait = close; waitEl = el; } });
  const gone = setInterval(() => { if (waitEl && !waitEl.isConnected) { clearInterval(gone); ctrl.abort(); } }, 500); // Fenster zu = abbrechen
  const all = [], notes = [];
  try {
    for (let i = 0; i < imgs.length; i++) {
      if (waitEl) { const st = waitEl.querySelector("[data-k=st]"), im = waitEl.querySelector("img"); if (st && imgs.length > 1) st.textContent = `Claude liest Bild ${i + 1} von ${imgs.length} …`; if (im) im.src = imgs[i].data; }
      const out = await askClaude([{ role: "user", content: `Lies bitte diesen Stundenplan ab.${imgs.length > 1 ? ` (Bild ${i + 1} von ${imgs.length} – die Bilder können sich überschneiden, z. B. Vormittag und Nachmittag derselben Woche.)` : ""}` }], { body: { mode: "stundenplan", image: { type: "image/jpeg", data: imgs[i].data.replace(/^data:[^,]*,/, "") } }, timeoutMs: 120000, signal: ctrl.signal });
      const p = parsePlan(out.reply);
      for (const l of p.lessons) if (!all.some((x) => sameLesson(x, l))) all.push(l);
      if (p.note) notes.push(p.note);
    }
  } catch (e) { clearInterval(gone); if (closeWait && waitEl && waitEl.isConnected) closeWait(); if (e && e.code !== "abort") ui.toast(e.message || "Hat nicht geklappt.", 3600); return; }
  clearInterval(gone); if (!waitEl || !waitEl.isConnected) return; closeWait();
  all.sort((a, b) => a.weekday - b.weekday || a.from.localeCompare(b.from));
  reviewPlan(S, { lessons: all, note: [...new Set(notes)].join(" ") }, imgs.length === 1 ? imgs[0].data : null);
}
/* ---------- 🔗 WebUntis (Kalender-Abo) ---------- */
function untisEvents(id) {
  const mon = mondayOf(todayKey()), to = addDays(mon, 13);
  return FD.instancesFor(mon, to, (cal) => cal === "f:" + id);
}
function waitUntis(id, ms = 25000) {
  return new Promise((res) => {
    const t0 = Date.now(), done = () => { off(); clearInterval(iv); res(untisEvents(id)); };
    const check = () => { const st = FD.status(id); if (untisEvents(id).length || (!FD.isLoading() && st.text !== "Noch nicht geladen" && Date.now() - t0 > 1500) || Date.now() - t0 > ms) done(); };
    const off = FD.onChange(check), iv = setInterval(check, 700); check();
  });
}
export function untisSheet(S) {
  const ui = S.ctx.ui, f = FD.list().find((x) => x.untis);
  if (f) {
    ui.toast("🔗 Stundenplan wird aus WebUntis gelesen …", 2000);
    if (!untisEvents(f.id).length) FD.refresh({ fresh: true });
    waitUntis(f.id).then((evs) => {
      const st = FD.status(f.id);
      if (!evs.length) { ui.toast(st.bad ? `WebUntis: ${st.text}` : "In WebUntis sind für diese und nächste Woche keine Stunden zu finden.", 4200); return; }
      reviewPlan(S, { lessons: lessonsFromEvents(evs), note: `Aus „${f.name}“ (diese und nächste Woche). Im Planer siehst du die echten Stunden inkl. Entfall automatisch.` }, null);
    });
    return;
  }
  ui.openSheet({ title: "🔗 Mit WebUntis verbinden", bodyHTML: `<form class="form" id="un-f">
      <ol class="un-steps"><li>WebUntis öffnen (App oder Browser) und anmelden.</li><li>Unten links auf dein <b>Profil</b> → Reiter <b>Freigaben</b>.</li>
        <li><b>„Kalender publizieren“</b> einschalten → <b>Standard</b> wählen → Link <b>kopieren</b>.</li><li>Hier einfügen und verbinden.</li></ol>
      <p class="note">🔒 Der Link funktioniert wie ein Passwort – gib ihn niemandem weiter. Die App zeigt ihn nie ganz an. Gibt es „Freigaben“ bei dir nicht, hat die Schule das Kalender-Abo nicht freigeschaltet – dann frag im Sekretariat oder nimm 📷.</p>
      <label>Kalender-Link aus WebUntis<input id="un-u" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://….webuntis.com/WebUntis/…"></label>
      <div class="row"><button class="btn primary" type="submit" id="un-go">Verbinden</button></div></form>`,
    onMount(el, close) {
      el.querySelector("#un-f").addEventListener("submit", async (e) => {
        e.preventDefault();
        const inp = el.querySelector("#un-u"), go = el.querySelector("#un-go");
        if (!FD.isUntisFeed(inp.value)) { const c = FD.checkFeedUrl(inp.value); ui.toast(c.ok ? "Das ist kein WebUntis-Link." : c.error, 4000); return; }
        go.disabled = true; go.textContent = "Verbinde …";
        try { await FD.addFeed({ url: inp.value, name: "WebUntis", color: "lavendel" }); inp.value = ""; close(); untisSheet(S); }
        catch (err) { ui.toast(err.message || "Verbinden hat nicht geklappt.", 4000); go.disabled = false; go.textContent = "Verbinden"; }
      });
    } });
}

function reviewPlan(S, plan, src) {
  const ui = S.ctx.ui, have = S.data.timetable || [];
  const rows = plan.lessons.map((l, i) => {
    const dup = have.some((h) => sameLesson(h, l)), clash = !dup && have.find((h) => clashes(h, l));
    return { l, i, dup, clash };
  });
  const byDay = [1, 2, 3, 4, 5, 6].map((d) => rows.filter((r) => r.l.weekday === d)).filter((x) => x.length);
  ui.openSheet({ title: "📷 Erkannter Stundenplan", bodyHTML: `<div class="tt-ph">
      ${plan.note ? `<p class="hint">ℹ️ ${esc(plan.note)}</p>` : ""}
      ${rows.length ? `<p class="note">Bitte kurz kontrollieren – Haken weg bei allem, was nicht stimmt. Einzelne Stunden kannst du danach antippen und ändern.</p>
      ${byDay.map((day) => `<h4>${WD_LONG[day[0].l.weekday]}</h4><ul class="tt-ph-list">${day.map(({ l, i, dup, clash }) => `<li><label><input type="checkbox" data-i="${i}"${dup ? " disabled" : " checked"}>
        <span class="tt-ph-p">${l.period}.${l.periods > 1 ? `–${l.period + l.periods - 1}.` : ""}</span>
        <span class="tt-ph-s"><b>${esc(l.subject)}</b><small>${esc(l.from)}–${esc(l.to)}${l.room ? ` · ${esc(l.room)}` : ""}${l.teacher ? ` · ${esc(l.teacher)}` : ""}${l.week ? ` · ${l.week}-Woche` : ""}</small>
        ${dup ? `<em>schon eingetragen</em>` : clash ? `<em class="warn">überschneidet sich mit ${esc(clash.subject)}</em>` : ""}</span></label></li>`).join("")}</ul>`).join("")}
      <div class="row"><button type="button" class="btn primary" id="tt-ph-save">Eintragen</button></div>`
      : `<p>Auf dem Foto habe ich keine Stunden gefunden.</p>`}
      ${src ? `<details class="tt-ph-src"><summary>Dein Foto</summary><img src="${src}" alt="Dein Foto"></details>` : ""}
    </div>`,
    onMount(el, close) {
      const b = el.querySelector("#tt-ph-save"); if (!b) return;
      b.addEventListener("click", () => {
        const pick = [...el.querySelectorAll("input[data-i]:checked")].map((c) => plan.lessons[Number(c.dataset.i)]);
        if (!pick.length) { ui.toast("Nichts ausgewählt."); return; }
        for (const l of pick) safeWrite(col("timetable").put({ ...l, color: "" }));
        ui.toast(`✅ ${pick.length} Stunde${pick.length === 1 ? "" : "n"} eingetragen`, 2600); close();
      });
    } });
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
      <button type="button" class="ss-icon-btn" data-act="untis-plan" aria-label="Aus WebUntis übernehmen" title="WebUntis">🔗</button>
      <button type="button" class="ss-icon-btn" data-act="photo-plan" aria-label="Stundenplan vom Foto eintragen" title="Vom Foto eintragen">📷</button>
      <button type="button" class="btn primary sm" data-act="add-lesson">+ Stunde</button>
    </div>
    ${configured ? `<p class="note ss-sc-note">🏫 Berufsschule: ${esc(schoolDaysTxt)} <button type="button" class="linkbtn" id="tt-sc">ändern</button></p>`
      : `<div class="hint ss-sc-hint">Tipp: Trag deine Schultage in der Übersicht unter <b>Berufsschule</b> ein – dann zeigt „Heute“ den Stundenplan genau an Schultagen (auch Blockschule). <button type="button" class="linkbtn" id="tt-sc">Jetzt eintragen</button></div>`}
    ${all.length ? grid + `<p class="note">Tippe auf eine Stunde zum Bearbeiten, auf ein leeres Feld zum Eintragen.</p>`
      : emptyHTML("🗓️", "Stundenplan ist leer", "Trag deine Fächer mit Zeit, Raum und Lehrer/in ein – als Wochenraster mit Farben.", "Hinzufügen", "add-lesson") + `<div class="row" style="justify-content:center"><button type="button" class="btn sm" data-act="untis-plan">🔗 Aus WebUntis</button><button type="button" class="btn sm" data-act="photo-plan">📷 Stundenplan fotografieren</button></div>`}`;
  body.querySelectorAll("[data-act=untis-plan]").forEach((b) => b.addEventListener("click", () => untisSheet(S)));
  body.querySelectorAll("[data-act=photo-plan]").forEach((b) => b.addEventListener("click", () => photoImport(S)));

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
