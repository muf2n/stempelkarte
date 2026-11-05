// Update 9 – Kalender: Kalender-Blatt (Sichtbarkeit, Farben, eigene Kalender), ICS-Import/-Export,
// Google Kalender verbinden (nur lesen) inkl. Anleitung bei 403, Suche.
import { icon } from "../icons.js";
import {
  normCalendars, calendarsForSave, calOf, PALETTE, parseICS, todoFromIcs, toICS, searchEvents, addDays, wdOf, parseKey,
  isEventTodo, fmtKey,
} from "../cal-core.js";
import { calColor } from "../planer-core.js";
import { shareICS } from "./cal-editor.js";
import * as GC from "../cal-google.js";

const WD2 = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const newCalId = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Alle Kalender inkl. Google (sichtbar laut Einstellung, sonst Google-Vorgabe). */
export function allCalendars(settings) {
  const list = normCalendars(settings && settings.calendars);
  for (const g of GC.calendars()) {
    const saved = list.find((c) => c.id === g.id);
    if (saved) { saved.name = g.name; if (!(settings.calendars || []).some((x) => x.id === g.id && x.color)) saved.color = g.color; saved.gcolor = g.color; continue; }
    list.push({ id: g.id, name: g.name, color: g.color, gcolor: g.color, visible: g.defaultVisible !== false, kind: "google", readOnly: true });
  }
  return list;
}

/** Google-Anleitung (403 / API nicht aktiviert). */
export function googleHelpHTML(open = false) {
  return `<details class="gm-help cal-ghelp"${open ? " open" : ""}><summary>Anleitung: Google Kalender freischalten (einmalig)</summary><ol>` +
    `<li><a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=stempelkarte-40682" target="_blank" rel="noopener">Google Cloud Console</a> öffnen, Projekt <b>stempelkarte-40682</b> wählen und die <b>Google Calendar API</b> aktivieren („Aktivieren“ tippen).</li>` +
    `<li><b>Google Auth Platform</b> (früher „OAuth-Zustimmungsbildschirm“) → <b>Datenzugriff</b> → „Bereiche hinzufügen oder entfernen“ → <code>https://www.googleapis.com/auth/calendar.readonly</code> eintragen → Aktualisieren → Speichern.</li>` +
    `<li><b>Zielgruppe</b>: Veröffentlichungsstatus <b>„Testen“</b> lassen → Testnutzer → dein Google-Konto (<b>lippa.florian@gmail.com</b>) muss eingetragen sein → Speichern.</li>` +
    `<li>Ein paar Minuten warten, dann hier „Google Kalender verbinden“ tippen. Bei „Google hat diese App nicht überprüft“ → <b>Erweitert</b> → <b>Weiter zu stempelkarte-40682.firebaseapp.com</b> → Häkchen bei „Kalender ansehen“ setzen → Weiter.</li>` +
    `</ol><p class="note">Die App liest Google-Termine nur (keine Änderungen) und speichert sie nicht – sie bleiben nur in diesem Tab. Im Status „Testen“ fragt Google ungefähr wöchentlich erneut nach der Freigabe.</p></details>`;
}

/* ---------- Kalender-Blatt ---------- */

export function openCalendarsSheet(c, { onImportDone } = {}) {
  let editColor = null;
  let gMsg = "";
  let gHelp = false;
  return c.ui.openSheet({
    title: "Kalender",
    bodyHTML: `<div class="cal-sheet" data-r="body"></div>`,
    onMount(sheet, close) {
      const body = sheet.querySelector("[data-r=body]");
      const settings = () => c.store.get().settings || {};
      const save = async (list) => {
        const own = list.filter((x) => x.kind !== "google" || (settings().calendars || []).some((s) => s.id === x.id) || x._touched);
        try { await c.store.saveSettings({ calendars: calendarsForSave(own) }); } catch { /* Toast vom Store */ }
      };
      const row = (x) => {
        const col = calColor(x.color) || x.color;
        const editing = editColor === x.id;
        return `<li class="cal-row${x.visible ? "" : " off"}" data-id="${esc(x.id)}">` +
          `<label class="cal-vis"><input type="checkbox" data-vis="${esc(x.id)}"${x.visible ? " checked" : ""}><span class="cal-dot" style="--c:${esc(col)}"></span>` +
          `<span class="cal-nm"><b>${esc(x.name)}</b>${x.hint || x.readOnly ? `<small>${esc([x.hint, x.readOnly ? "nur lesen" : ""].filter(Boolean).join(" · "))}</small>` : ""}</span></label>` +
          `<button type="button" class="icon-btn cal-colbtn" data-colfor="${esc(x.id)}" aria-label="Farbe von ${esc(x.name)} ändern" aria-expanded="${editing}" style="--c:${esc(col)}"><i></i></button>` +
          (x.kind === "user" && !x.builtin ? `<button type="button" class="icon-btn" data-delcal="${esc(x.id)}" aria-label="${esc(x.name)} löschen">${icon("trash", 18)}</button>` : "") +
          (editing ? `<div class="cal-colors cal-colrow">${PALETTE.map(([k, n]) => `<button type="button" class="cal-sw" data-setcol="${k}" style="--c:var(--cal-${k})" aria-label="${n}" aria-pressed="${x.color === k}"></button>`).join("")}` +
            (x.gcolor ? `<button type="button" class="cal-sw" data-setcol="${esc(x.gcolor)}" style="--c:${esc(x.gcolor)}" aria-label="Google-Farbe"></button>` : "") + `</div>` : "") +
        `</li>`;
      };
      const draw = () => {
        const list = allCalendars(settings());
        const mine = list.filter((x) => x.kind === "user");
        const layers = list.filter((x) => x.kind === "layer");
        const google = list.filter((x) => x.kind === "google");
        const gs = GC.state;
        const s = c.store.get();
        const perm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
        body.innerHTML =
          `<h3 class="ag-h">Meine Kalender</h3><ul class="cal-list">${mine.map(row).join("")}</ul>` +
          `<form class="row cal-add" data-r="addform"><input type="text" data-r="newname" maxlength="40" placeholder="Neuer Kalender, z. B. Fußball" aria-label="Name des neuen Kalenders"><button type="submit" class="btn sm">${icon("plus", 16)} Anlegen</button></form>` +
          `<h3 class="ag-h">Weitere Ebenen</h3><ul class="cal-list">${layers.map(row).join("")}</ul>` +
          `<h3 class="ag-h">Google Kalender <small class="note">nur lesen</small></h3>` +
          (gs.connected
            ? `<ul class="cal-list">${google.map(row).join("") || `<li class="note">Keine Kalender gefunden.</li>`}</ul>` +
              `<div class="row"><button type="button" class="btn sm ghost" data-r="grefresh">Neu laden</button><button type="button" class="btn sm ghost" data-r="gdisc">Trennen</button></div>`
            : `<button type="button" class="btn" data-r="gconnect">${icon("calendar", 18)} Google Kalender verbinden</button>`) +
          (gMsg ? `<p class="hint cal-gmsg" role="alert">${esc(gMsg)}</p>` : "") +
          googleHelpHTML(gHelp) +
          `<h3 class="ag-h">Import / Export</h3>` +
          `<div class="stack cal-io"><label class="btn ghost cal-file">${icon("upload", 18)} .ics-Datei importieren<input type="file" accept=".ics,text/calendar" data-r="icsfile" hidden></label>` +
          `<button type="button" class="btn ghost" data-r="export">${icon("download", 18)} Sichtbare Kalender exportieren (.ics)</button></div>` +
          (s.mode !== "cloud" || perm !== "granted"
            ? `<h3 class="ag-h">Erinnerungen</h3><p class="note">${s.mode !== "cloud" ? "Ohne Google-Konto gibt es keine Push-Nachrichten. Solange die App offen ist, erinnert sie trotzdem." : "Push-Nachrichten sind auf diesem Gerät noch nicht erlaubt. Solange die App offen ist, erinnert sie trotzdem."}</p>` +
              (perm === "default" ? `<button type="button" class="btn sm ghost" data-r="notif">Benachrichtigungen in diesem Browser erlauben</button>` : "")
            : "");
      };
      draw();
      const unsub = GC.onChange(() => { if (sheet.isConnected) draw(); else unsub(); });
      try { GC.prepare(); } catch { /* egal */ }

      body.addEventListener("change", async (ev) => {
        const v = ev.target.closest("[data-vis]");
        if (v) {
          const list = allCalendars(settings());
          const x = list.find((y) => y.id === v.dataset.vis);
          if (x) { x.visible = v.checked; x._touched = true; const sp = save(list); draw(); await sp; }
          return;
        }
        if (ev.target.matches("[data-r=icsfile]")) {
          const f = ev.target.files && ev.target.files[0];
          ev.target.value = "";
          if (!f) return;
          if (f.size > 5 * 1024 * 1024) { c.ui.toast("Die Datei ist zu groß (max. 5 MB)."); return; }
          const text = await f.text();
          openImportPreview(c, text, f.name, onImportDone);
        }
      });
      body.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const inp = body.querySelector("[data-r=newname]");
        const name = inp.value.trim();
        if (!name) { inp.focus(); return; }
        const list = allCalendars(settings());
        const used = new Set(list.map((x) => x.color));
        const col = (PALETTE.find(([k]) => !used.has(k)) || PALETTE[0])[0];
        list.push({ id: newCalId(), name, color: col, visible: true, kind: "user", _touched: true });
        const sp = save(list);
        draw();
        c.ui.toast(`Kalender „${name}“ angelegt`, 1600);
        await sp;
      });
      body.addEventListener("click", async (ev) => {
        const b = ev.target.closest("button, a");
        if (!b) return;
        if (b.dataset.colfor) { editColor = editColor === b.dataset.colfor ? null : b.dataset.colfor; draw(); return; }
        if (b.dataset.setcol) {
          const list = allCalendars(settings());
          const x = list.find((y) => y.id === editColor);
          if (x) { x.color = b.dataset.setcol; x._touched = true; editColor = null; const sp = save(list); draw(); await sp; }
          return;
        }
        if (b.dataset.delcal) {
          if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.classList.add("armed"); b.setAttribute("aria-label", "Wirklich löschen? Nochmal tippen"); c.ui.toast("Nochmal tippen zum Löschen – Termine wandern nach „Privat“.", 2600); return; }
          const id = b.dataset.delcal;
          const list = allCalendars(settings()).map((x) => (x.id === id ? { ...x, deleted: true } : x));
          const sp = save(list);
          draw();
          await sp;
          for (const t of (c.store.get().todos || []).filter((t) => t.calendarId === id)) { try { await c.store.saveTodo({ ...t, calendarId: "privat" }); } catch { /* egal */ } }
          draw();
          return;
        }
        const r = b.dataset.r;
        if (r === "gconnect") {
          gMsg = "";
          try {
            const p = GC.connect(c.store.get().user && c.store.get().user.email);
            b.disabled = true;
            b.textContent = "Verbinde …";
            await p;
            gMsg = "";
            c.ui.toast("Google Kalender verbunden", 1800);
          } catch (e) {
            gMsg = (e && e.message) || "Verbindung fehlgeschlagen.";
            if (e && e.code === "scope") gHelp = true;
          }
          draw();
          return;
        }
        if (r === "grefresh") { GC.refresh(); c.ui.toast("Google-Termine werden neu geladen …", 1500); return; }
        if (r === "gdisc") { GC.disconnect(); draw(); return; }
        if (r === "export") {
          const list = allCalendars(settings());
          const vis = (id) => { const x = list.find((y) => y.id === id); return !x || x.visible !== false; };
          const todos = (c.store.get().todos || []).filter((t) => (isEventTodo(t) && vis(calOf(t, list))) || (t.kind === "geburtstag" && vis("geburtstage")));
          if (!todos.length) { c.ui.toast("In den sichtbaren Kalendern gibt es keine Termine."); return; }
          await shareICS(c, toICS(todos, { name: "Stempelkarte" }), `stempelkarte-kalender-${todayKey()}.ics`, "Stempelkarte Kalender");
          return;
        }
        if (r === "notif") {
          try { await Notification.requestPermission(); } catch { /* egal */ }
          draw();
        }
      });
    },
  });
}

/* ---------- ICS-Import ---------- */

export function openImportPreview(c, text, fileName = "Kalender.ics", onDone) {
  let parsed;
  try { parsed = parseICS(text); } catch (e) { console.error(e); c.ui.toast("Diese Datei konnte nicht gelesen werden."); return null; }
  const { events, skipped } = parsed;
  if (!events.length) { c.ui.toast("In der Datei wurden keine Termine gefunden."); return null; }
  const todos = c.store.get().todos || [];
  const byUid = new Map(todos.filter((t) => t.icsUid).map((t) => [t.icsUid, t]));
  const existing = events.filter((e) => e.uid && byUid.has(e.uid)).length;
  const series = events.filter((e) => e.rrule).length;
  const cals = normCalendars((c.store.get().settings || {}).calendars).filter((x) => x.kind === "user");
  let target = "privat";
  const sorted = [...events].sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const rows = sorted.slice(0, 40).map((e) => {
    const { d, m, y } = parseKey(e.date);
    return `<li><span class="cal-imp-d">${WD2[wdOf(e.date)]}, ${pad(d)}.${pad(m)}.${y}</span><span class="cal-imp-t">${e.allDay ? "ganztägig" : esc(e.time)}</span><b>${esc(e.title)}</b>` +
      `${e.rrule ? ` <span title="Serie">${icon("repeat", 14)}</span>` : ""}${e.uid && byUid.has(e.uid) ? ` <small class="cal-imp-upd">aktualisiert</small>` : ""}</li>`;
  }).join("");
  return c.ui.openSheet({
    title: "Kalender importieren",
    bodyHTML: `<p class="note"><b>${esc(fileName)}</b>: ${events.length} ${events.length === 1 ? "Termin" : "Termine"}${series ? `, davon ${series} Serie${series === 1 ? "" : "n"}` : ""}` +
      `${existing ? ` · ${existing} schon vorhanden (werden aktualisiert, keine Doppelten)` : ""}${skipped ? ` · ${skipped} übersprungen` : ""}.</p>` +
      `<ul class="cal-imp">${rows}</ul>${events.length > 40 ? `<p class="note">… und ${events.length - 40} weitere.</p>` : ""}` +
      `<div class="lbl">In welchen Kalender?</div><div class="chips cal-cals" data-r="cals">${cals.map((x) => `<button type="button" class="chip cal-chip" data-cal="${esc(x.id)}" style="--c:${calColor(x.color)}" aria-pressed="${x.id === target}"><i aria-hidden="true"></i><span>${esc(x.name)}</span></button>`).join("")}</div>` +
      `<div class="stack" style="margin-top:14px"><button type="button" class="btn primary" data-r="go">${events.length} importieren</button></div>`,
    onMount(sheet, close) {
      sheet.querySelector("[data-r=cals]").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-cal]");
        if (!b) return;
        target = b.dataset.cal;
        sheet.querySelectorAll("[data-cal]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.cal === target)));
      });
      const go = sheet.querySelector("[data-r=go]");
      go.addEventListener("click", async () => {
        c.ui.setBusy(go, true, "Importiert …");
        let added = 0, updated = 0;
        try {
          for (const e of events) {
            const t = todoFromIcs(e, target);
            const ex = e.uid && byUid.get(e.uid);
            if (ex) { await c.store.saveTodo({ ...ex, ...t, id: ex.id, calendarId: ex.calendarId || target }); updated++; }
            else { await c.store.saveTodo(t); added++; }
          }
          close();
          c.ui.toast(`${added} importiert${updated ? `, ${updated} aktualisiert` : ""}`, 2400);
          if (onDone) onDone(sorted[0] && sorted[0].date);
        } catch (err) { console.error(err); c.ui.setBusy(go, false); }
      });
    },
  });
}

/* ---------- Suche ---------- */

export function openSearch(c, { onPick, visible = () => true } = {}) {
  return c.ui.openSheet({
    title: "Suchen",
    bodyHTML: `<label class="cal-search"><span class="cal-sr">Suchbegriff</span>${icon("search", 18)}<input type="search" data-r="q" enterkeyhint="search" placeholder="Titel, Ort oder Notiz" autocomplete="off"></label>` +
      `<p class="note" data-r="info">Sucht in Terminen (auch Wiederholungen ±1 Jahr), Aufgaben und geladenen Google-Terminen.</p><ul class="cal-res" data-r="res"></ul>`,
    onMount(sheet, close) {
      const q = sheet.querySelector("[data-r=q]");
      const res = sheet.querySelector("[data-r=res]");
      const info = sheet.querySelector("[data-r=info]");
      let timer = null;
      let last = [];
      const run = () => {
        const term = q.value.trim();
        if (term.length < 2) { res.innerHTML = ""; info.hidden = false; return; }
        const tk = todayKey();
        const todos = c.store.get().todos || [];
        const list = searchEvents(todos, term, tk, { limit: 150 });
        const words = term.toLowerCase().split(/\s+/);
        const g = GC.instancesFor(addDays(tk, -366), addDays(tk, 366), visible).filter((i) => words.every((w) => `${i.title} ${i.location} ${i.note}`.toLowerCase().includes(w)));
        last = [...list, ...g].sort((a, b) => {
          const fa = a.date && a.date >= tk ? 0 : 1, fb = b.date && b.date >= tk ? 0 : 1;
          return fa - fb || (fa ? String(b.date).localeCompare(String(a.date)) : String(a.date).localeCompare(String(b.date))) || (a.startMin || 0) - (b.startMin || 0);
        }).slice(0, 150);
        info.hidden = true;
        res.innerHTML = last.length ? last.map((i, n) => {
          const when = i.date ? `${WD2[wdOf(i.date)]}, ${fmtKey(i.date)}` : "ohne Datum";
          return `<li><button type="button" data-n="${n}" class="cal-resb${i.date && i.date < tk ? " past" : ""}"><span class="cal-res-d">${esc(when)}<small>${i.allDay || !i.time ? (i.task ? "Aufgabe" : "ganztägig") : esc(i.time)}</small></span>` +
            `<span class="cal-res-m"><b>${esc(i.title)}</b>${i.location ? `<small>${icon("pin", 12)} ${esc(i.location)}</small>` : ""}${i.ext ? `<small>Google</small>` : ""}${i.recurring ? `<small>${icon("repeat", 12)} Serie</small>` : ""}</span></button></li>`;
        }).join("") : `<li class="note">Nichts gefunden.</li>`;
      };
      q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 120); });
      res.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-n]");
        if (!b) return;
        const i = last[Number(b.dataset.n)];
        close();
        if (i && onPick) onPick(i);
      });
      setTimeout(() => { try { q.focus(); } catch { /* egal */ } }, 60);
    },
  });
}
