// Reiter „Planer“: Aufgaben (To-dos) und Termine mit Erinnerung.
// Daten: store.saveTodo/deleteTodo, snap.todos. Der Kalender (Einträge) bleibt reine Arbeitszeit.
import { icon } from "../icons.js";
import { einsatzFor, einsaetze } from "../einsatz.js";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const REMIND_OPTS = [[0, "Zur Uhrzeit"], [5, "5 Min vorher"], [10, "10 Min vorher"], [15, "15 Min vorher"],
  [30, "30 Min vorher"], [60, "1 Std vorher"], [120, "2 Std vorher"], [1440, "1 Tag vorher"]];
const DONE_SHOW = 30;

let C = null;
let root = null;
let snap = null;
let selDay = null;            // in der Monatsleiste gewählter Tag (YYYY-MM-DD) oder null
let month = null;             // {y, m} der Monatsleiste
let lastKey = "";
let doneOpen = false;
let stripScrolled = "";
const MODE_KEY = "stempelkarte.planerMode";
let mode = "list";            // "list" (Aufgaben & Termine) | "einsatz" (Einsatzplan)
try { if (localStorage.getItem(MODE_KEY) === "einsatz") mode = "einsatz"; } catch { /* egal */ }
let ezMonth = null;           // {y, m} des Einsatzplan-Kalenders

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => keyOf(new Date());
function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return keyOf(new Date(y, m - 1, d + n));
}
function dateOf(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ""));
const isTime = (t) => /^\d{1,2}:\d{2}$/.test(String(t || ""));
const normTime = (t) => (isTime(t) ? String(t).padStart(5, "0") : null);

/** „Heute“, „Morgen“, „Gestern“ oder „Fr, 6. November“. */
export function dayLabel(key, long = false) {
  const t = todayKey();
  if (key === t) return "Heute";
  if (key === addDays(t, 1)) return "Morgen";
  if (key === addDays(t, -1)) return "Gestern";
  const d = dateOf(key);
  const same = d.getFullYear() === new Date().getFullYear();
  return `${(long ? WD_LONG : WD)[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}${same ? "" : " " + d.getFullYear()}`;
}

/** Schnelleingabe: erkennt „heute“, „morgen“, „übermorgen“, Wochentag, „14:30“ / „14 Uhr“. */
export function parseQuick(text, baseKey = todayKey()) {
  let s = ` ${String(text || "").trim()} `;
  let date = null, time = null;
  const take = (re, fn) => { const m = re.exec(s); if (m) { fn(m); s = s.replace(m[0], " "); } };
  take(/\s(?:um\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*uhr)?(?=\s)/i, (m) => { time = `${pad(m[1])}:${m[2]}`; });
  if (!time) take(/\s(?:um\s+)?([01]?\d|2[0-3])\s*uhr(?=\s)/i, (m) => { time = `${pad(m[1])}:00`; });
  take(/\s(übermorgen|uebermorgen)(?=\s)/i, () => { date = addDays(baseKey, 2); });
  if (!date) take(/\s(morgen)(?=\s)/i, () => { date = addDays(baseKey, 1); });
  if (!date) take(/\s(heute)(?=\s)/i, () => { date = baseKey; });
  if (!date) {
    take(/\s(?:am\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(?=\s)/i, (m) => {
      const wd = WD_LONG.findIndex((w) => w.toLowerCase() === m[1].toLowerCase());
      const cur = dateOf(baseKey).getDay();
      date = addDays(baseKey, ((wd - cur + 7) % 7) || 7);
    });
  }
  const title = s.replace(/\s+/g, " ").trim();
  if (time && !date) date = baseKey;
  return { title, date, time };
}

/* ---------- Gruppierung ---------- */

export function groupTodos(todos, tKey = todayKey()) {
  const open = [], done = [];
  for (const t of todos || []) (t.done ? done : open).push(t);
  const today = [], soon = new Map(), nodate = [];
  for (const t of open) {
    if (!isKey(t.date)) nodate.push(t);
    else if (t.date <= tKey) today.push(t);
    else {
      if (!soon.has(t.date)) soon.set(t.date, []);
      soon.get(t.date).push(t);
    }
  }
  done.sort((a, b) => (Number(b.doneAt) || 0) - (Number(a.doneAt) || 0));
  return { today, soon: [...soon.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), nodate, done };
}

/* ---------- Anzeige ---------- */

function itemHTML(t, tKey) {
  const overdue = !t.done && isKey(t.date) && (t.date < tKey ||
    (t.date === tKey && t.time && t.time < `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}` && t.kind === "termin"));
  const meta = [];
  if (t.kind === "termin") meta.push(`<span class="ag-badge">Termin</span>`);
  if (t.time) meta.push(`<span class="ag-time">${icon("clock", 14)}${esc(t.time)}</span>`);
  if (isKey(t.date) && (t.date < tKey || t.done)) meta.push(`<span>${esc(dayLabel(t.date))}</span>`);
  if (overdue && t.date < tKey) meta.push(`<span class="ag-late">überfällig</span>`);
  if (t.remind && t.time && !t.done) meta.push(`<span class="ag-bell" title="Erinnerung">${bell(14)}</span>`);
  if (t.note) meta.push(`<span class="ag-note">${esc(String(t.note).split("\n")[0])}</span>`);
  return `<li class="ag-item${t.done ? " done" : ""}${t.kind === "termin" ? " termin" : ""}${overdue ? " late" : ""}" data-id="${esc(t.id)}">` +
    `<button type="button" class="ag-check" data-act="check" aria-pressed="${t.done ? "true" : "false"}" aria-label="${t.done ? "Wieder offen" : "Erledigt"}: ${esc(t.title)}">${icon("check", 22)}</button>` +
    `<button type="button" class="ag-main" data-act="edit"><span class="ag-title">${esc(t.title || "Ohne Titel")}</span>` +
    (meta.length ? `<span class="ag-meta">${meta.join("")}</span>` : "") + `</button></li>`;
}

function bell(size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`;
}

function listHTML(items, tKey) {
  return `<ul class="ag-list">${items.map((t) => itemHTML(t, tKey)).join("")}</ul>`;
}

function section(title, body, cls = "") {
  return `<section class="ag-sec ${cls}"><h3 class="ag-h">${title}</h3>${body}</section>`;
}

function stripHTML(todos, tKey) {
  if (!month) { const d = new Date(); month = { y: d.getFullYear(), m: d.getMonth() }; }
  const { y, m } = month;
  const n = new Date(y, m + 1, 0).getDate();
  const marks = new Map();
  for (const t of todos || []) {
    if (!isKey(t.date) || t.done) continue;
    const k = marks.get(t.date) || { termin: 0, todo: 0 };
    k[t.kind === "termin" ? "termin" : "todo"]++;
    marks.set(t.date, k);
  }
  let days = "";
  for (let d = 1; d <= n; d++) {
    const k = `${y}-${pad(m + 1)}-${pad(d)}`;
    const wd = new Date(y, m, d).getDay();
    const mk = marks.get(k);
    const dots = mk ? `<span class="ag-dots">${mk.termin ? `<i class="t"></i>` : ""}${mk.todo ? `<i></i>` : ""}</span>` : `<span class="ag-dots"></span>`;
    const lbl = `${WD_LONG[wd]}, ${d}. ${MONTHS[m]}` + (mk ? ` – ${mk.termin ? mk.termin + " Termin(e)" : ""}${mk.termin && mk.todo ? ", " : ""}${mk.todo ? mk.todo + " Aufgabe(n)" : ""}` : "");
    days += `<button type="button" class="ag-day${k === tKey ? " today" : ""}${wd === 0 || wd === 6 ? " we" : ""}" data-day="${k}" aria-pressed="${k === selDay}" aria-label="${esc(lbl)}">` +
      `<span class="ag-wd">${WD[wd]}</span><span class="ag-dn">${d}</span>${dots}</button>`;
  }
  return `<div class="ag-month">` +
    `<button type="button" class="icon-btn ag-mnav" data-act="mprev" aria-label="Vorheriger Monat">${icon("chevron-left", 20)}</button>` +
    `<b class="ag-mname">${MONTHS[m]} ${y}</b>` +
    `<button type="button" class="icon-btn ag-mnav" data-act="mnext" aria-label="Nächster Monat">${icon("chevron-right", 20)}</button>` +
    `</div><div class="ag-strip" data-r="strip">${days}</div>`;
}

function render() {
  if (!root || !snap) return;
  applyMode();
  if (mode === "einsatz") { renderEinsatz(); return; }
  const todos = (snap.todos || []).filter((t) => t.kind !== "einsatz");
  const tKey = todayKey();
  const minute = `${new Date().getHours()}:${new Date().getMinutes()}`;
  const key = JSON.stringify(["list", todos, tKey, selDay, month, doneOpen, minute.slice(0, -1)]);
  if (key === lastKey) return;
  lastKey = key;

  root.querySelector("[data-r=month]").innerHTML = stripHTML(todos, tKey);
  const g = groupTodos(todos, tKey);
  const body = root.querySelector("[data-r=lists]");
  let html = "";

  if (selDay) {
    const items = todos.filter((t) => t.date === selDay && !t.done);
    html += section(`${esc(dayLabel(selDay, true))}<button type="button" class="btn sm ghost ag-clear" data-act="clearday">Alle Tage</button>`,
      items.length ? listHTML(items, tKey) : `<p class="note ag-none">Nichts geplant. Tippe oben auf ＋, um für diesen Tag etwas einzutragen.</p>`, "ag-sel");
  } else {
    const openCount = g.today.length + g.soon.length + g.nodate.length;
    if (!openCount) {
      html += `<div class="empty ag-empty">${icon("calendar-check", 34)}<h3>Alles erledigt</h3>` +
        `<p class="note">Schreib oben eine Aufgabe oder einen Termin hinein – z. B. „Berufsschule Hefte mitnehmen“ oder „Zahnarzt morgen 14:30“.</p></div>`;
    }
    if (g.today.length) html += section(`Heute <span class="ag-count">${g.today.length}</span>`, listHTML(g.today, tKey), "ag-today");
    if (g.soon.length) {
      html += section("Demnächst", g.soon.map(([k, items]) =>
        `<div class="ag-group"><div class="ag-gh">${esc(dayLabel(k, true))}</div>${listHTML(items, tKey)}</div>`).join(""), "ag-soon");
    }
    if (g.nodate.length) html += section(`Ohne Datum <span class="ag-count">${g.nodate.length}</span>`, listHTML(g.nodate, tKey), "ag-nodate");
  }
  if (g.done.length) {
    const shown = g.done.slice(0, DONE_SHOW);
    html += `<details class="ag-sec ag-done"${doneOpen ? " open" : ""}><summary class="ag-h">Erledigt <span class="ag-count">${g.done.length}</span></summary>` +
      listHTML(shown, tKey) +
      (g.done.length > DONE_SHOW ? `<p class="note">… und ${g.done.length - DONE_SHOW} ältere.</p>` : "") +
      `<button type="button" class="btn sm danger ag-purge" data-act="purge">Erledigte löschen</button></details>`;
  }
  body.innerHTML = html;
  const purge = body.querySelector("[data-act=purge]");
  if (purge) {
    C.ui.confirmButton(purge, "Wirklich alle löschen?", async () => {
      const ids = (C.store.get().todos || []).filter((t) => t.done && t.kind !== "einsatz").map((t) => t.id);
      try { await Promise.all(ids.map((id) => C.store.deleteTodo(id))); C.ui.toast(`${ids.length} erledigte gelöscht.`); } catch { /* Toast vom Store */ }
    });
  }
  const det = body.querySelector("details.ag-done");
  if (det) det.addEventListener("toggle", () => { doneOpen = det.open; });

  // heutigen bzw. gewählten Tag in der Leiste sichtbar machen
  const strip = root.querySelector("[data-r=strip]");
  const target = selDay || tKey;
  const sk = `${month.y}-${month.m}-${target}`;
  if (strip && stripScrolled !== sk) {
    stripScrolled = sk;
    const b = strip.querySelector(`[data-day="${target}"]`) || strip.firstElementChild;
    if (b) requestAnimationFrame(() => { strip.scrollLeft = Math.max(0, b.offsetLeft - strip.clientWidth / 2 + b.offsetWidth / 2); });
  }
}

/* ---------- Aktionen ---------- */

async function toggleDone(id) {
  const t = (C.store.get().todos || []).find((x) => x.id === id);
  if (!t) return;
  const done = !t.done;
  try {
    await C.store.saveTodo({ ...t, done, doneAt: done ? Date.now() : null });
    if (done) C.ui.toast(t.kind === "termin" ? "Termin abgehakt ✓" : "Erledigt ✓", 1800);
  } catch { /* Toast vom Store */ }
}

async function quickAdd(text) {
  const p = parseQuick(text, selDay || todayKey());
  if (!p.title) { C.ui.toast("Bitte einen Text eingeben."); return false; }
  const date = p.date || selDay || null;
  const todo = {
    title: p.title, kind: p.time ? "termin" : "todo", date, time: p.time,
    remind: !!p.time, remindMin: 30, done: false, doneAt: null, note: "",
  };
  try {
    await C.store.saveTodo(todo);
    const when = date ? ` · ${dayLabel(date)}${p.time ? " " + p.time : ""}` : "";
    C.ui.toast(`${todo.kind === "termin" ? "Termin" : "Aufgabe"} gespeichert${when}`, 2400);
    return true;
  } catch { return false; }
}

/** Blatt zum Anlegen/Bearbeiten. `preset` = { title, date, time, kind }. */
export function openTodoForm(todo = null, ctx = C, preset = null) {
  const c = ctx || C;
  if (!C) C = c;
  const isNew = !todo;
  const base = todo || {};
  const pre = preset || {};
  const st = {
    kind: base.kind || pre.kind || (pre.time ? "termin" : "todo"),
    date: isKey(base.date) ? base.date : (isKey(pre.date) ? pre.date : null),
    time: normTime(base.time || pre.time),
    remind: todo ? !!base.remind : !!(pre.time || pre.kind === "termin"),
    remindMin: Number.isFinite(Number(base.remindMin)) ? Number(base.remindMin) : 30,
  };
  if (!REMIND_OPTS.some(([v]) => v === st.remindMin)) REMIND_OPTS.push([st.remindMin, `${st.remindMin} Min vorher`]);

  const bodyHTML =
    `<div class="fields ag-form">` +
      `<label>Was?<input type="text" data-r="title" maxlength="140" enterkeyhint="done" placeholder="z. B. Werkzeug zurückbringen" value="${esc(base.title || pre.title || "")}"></label>` +
      `<div><div class="lbl">Art</div><div class="chips ag-kind" data-r="kind">` +
        `<button type="button" class="chip" data-k="todo">${icon("check", 18)}<span>Aufgabe</span></button>` +
        `<button type="button" class="chip" data-k="termin">${icon("calendar", 18)}<span>Termin</span></button></div></div>` +
      `<div><div class="lbl">Wann?</div><div class="chips ag-when" data-r="when">` +
        `<button type="button" class="chip" data-w="today">Heute</button>` +
        `<button type="button" class="chip" data-w="tomorrow">Morgen</button>` +
        `<button type="button" class="chip" data-w="none">Ohne Datum</button></div></div>` +
      `<div class="row ag-dt">` +
        `<label>Datum<input type="date" data-r="date" value="${esc(st.date || "")}"></label>` +
        `<label data-r="timewrap"><span data-r="timelbl">Uhrzeit</span><input type="time" data-r="time" step="300" value="${esc(st.time || "")}"></label>` +
      `</div>` +
      `<div class="ag-rem" data-r="remwrap">` +
        `<label class="switch"><input type="checkbox" data-r="remind"${st.remind ? " checked" : ""}><span>${bell(18)} Erinnern</span></label>` +
        `<label class="ag-remmin" data-r="remminwrap">Wann erinnern?<select data-r="remmin">` +
          REMIND_OPTS.sort((a, b) => a[0] - b[0]).map(([v, l]) => `<option value="${v}"${v === st.remindMin ? " selected" : ""}>${esc(l)}</option>`).join("") +
        `</select></label>` +
        `<p class="hint" data-r="remhint" hidden></p>` +
      `</div>` +
      `<label>Notiz<textarea data-r="note" rows="3" placeholder="optional">${esc(base.note || "")}</textarea></label>` +
    `</div>` +
    `<div class="stack" style="margin-top:14px">` +
      `<button type="button" class="btn primary" data-r="save">Speichern</button>` +
      (isNew ? "" :
        `<button type="button" class="btn ghost" data-r="toggle">${base.done ? "Wieder offen" : "Als erledigt abhaken"}</button>` +
        `<button type="button" class="btn danger" data-r="del">Löschen</button>`) +
    `</div>`;

  return c.ui.openSheet({
    title: isNew ? "Neu im Planer" : (base.kind === "termin" ? "Termin" : "Aufgabe"),
    bodyHTML,
    onMount(sheet, close) {
      const $ = (r) => sheet.querySelector(`[data-r="${r}"]`);
      const draw = () => {
        $("kind").querySelectorAll("[data-k]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === st.kind)));
        const tk = todayKey();
        $("when").querySelectorAll("[data-w]").forEach((b) => {
          const w = b.dataset.w;
          const on = w === "none" ? !st.date : w === "today" ? st.date === tk : st.date === addDays(tk, 1);
          b.setAttribute("aria-pressed", String(on));
        });
        $("timelbl").textContent = st.kind === "termin" ? "Uhrzeit" : "Uhrzeit (optional)";
        $("timewrap").hidden = !st.date;
        $("remwrap").hidden = !st.date;
        $("remminwrap").hidden = !st.remind;
        const hint = $("remhint");
        let h = "";
        if (st.remind) {
          const s = c.store.get();
          if (!st.time) h = "Für eine Erinnerung braucht es eine Uhrzeit.";
          else if (s.mode !== "cloud") h = "Erinnerungen per Benachrichtigung gibt es nur mit Google-Konto (Übersicht → Einstellungen).";
          else if (s.settings && s.settings.reminders && s.settings.reminders.enabled === false) h = "Erinnerungen sind ausgeschaltet – schalte sie unter Übersicht → Erinnerungen ein.";
          else if (typeof Notification !== "undefined" && Notification.permission !== "granted") h = "Erlaube Benachrichtigungen unter Übersicht → Erinnerungen, damit sie ankommen.";
          else h = "Die Erinnerung kommt als Benachrichtigung (kann bis zu 15 Minuten später eintreffen).";
        }
        hint.textContent = h;
        hint.hidden = !h;
      };
      draw();

      $("kind").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-k]");
        if (!b) return;
        st.kind = b.dataset.k;
        if (st.kind === "termin" && !st.date) { st.date = selDay || todayKey(); $("date").value = st.date; }
        if (st.kind === "termin" && isNew && st.time) st.remind = true;
        $("remind").checked = st.remind;
        draw();
      });
      $("when").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-w]");
        if (!b) return;
        const tk = todayKey();
        st.date = b.dataset.w === "today" ? tk : b.dataset.w === "tomorrow" ? addDays(tk, 1) : null;
        $("date").value = st.date || "";
        draw();
      });
      $("date").addEventListener("input", () => { st.date = isKey($("date").value) ? $("date").value : null; draw(); });
      $("time").addEventListener("input", () => {
        const had = !!st.time;
        st.time = normTime($("time").value);
        if (!had && st.time && isNew && st.kind === "termin") { st.remind = true; $("remind").checked = true; }
        draw();
      });
      $("remind").addEventListener("change", () => { st.remind = $("remind").checked; draw(); });
      $("remmin").addEventListener("change", () => { st.remindMin = Number($("remmin").value) || 0; });
      $("title").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("save").click(); } });
      if (isNew && !$("title").value) setTimeout(() => { try { $("title").focus(); } catch { /* egal */ } }, 60);

      const saveBtn = $("save");
      saveBtn.addEventListener("click", async () => {
        const title = $("title").value.trim();
        if (!title) { c.ui.toast("Bitte schreib kurz, worum es geht."); $("title").focus(); return; }
        if (st.kind === "termin" && !st.date) { c.ui.toast("Ein Termin braucht ein Datum."); return; }
        const data = {
          ...(todo || {}),
          title,
          kind: st.kind,
          date: st.date,
          time: st.date ? st.time : null,
          remind: !!(st.remind && st.date && st.time),
          remindMin: st.remindMin,
          note: $("note").value.trim(),
          done: !!base.done,
          doneAt: base.doneAt ?? null,
        };
        c.ui.setBusy(saveBtn, true, "Speichert …");
        try {
          await c.store.saveTodo(data);
          close();
          c.ui.toast(isNew ? (st.kind === "termin" ? "Termin gespeichert" : "Aufgabe gespeichert") : "Gespeichert", 1800);
        } catch { c.ui.setBusy(saveBtn, false); }
      });

      const tg = $("toggle");
      if (tg) tg.addEventListener("click", async () => { close(); await toggleDone(base.id); });
      const del = $("del");
      if (del) {
        c.ui.confirmButton(del, "Wirklich löschen?", async () => {
          try { await c.store.deleteTodo(base.id); close(); c.ui.toast("Gelöscht."); } catch { /* Toast vom Store */ }
        });
      }
    },
  });
}

/* ---------- View-Schnittstelle ---------- */

export function mount(el, ctx) {
  root = el;
  C = ctx;
  el.innerHTML =
    `<div class="stack ag">` +
      `<div class="card ag-head">` +
        `<div class="section-h ag-top"><h2>Planer</h2></div>` +
        `<div class="ez-switch" role="group" aria-label="Ansicht im Planer">` +
          `<button type="button" class="ez-sw" data-mode="list">Aufgaben &amp; Termine</button>` +
          `<button type="button" class="ez-sw" data-mode="einsatz">Einsatzplan</button>` +
        `</div>` +
        `<div class="ag-listhead" data-r="listhead">` +
        `<form class="ag-quick" data-r="quick" autocomplete="off">` +
          `<input type="text" data-r="qtext" maxlength="140" enterkeyhint="done" placeholder="Neue Aufgabe oder Termin…" aria-label="Neue Aufgabe oder Termin">` +
          `<button type="button" class="ag-plus" data-r="plus" aria-label="Hinzufügen">${icon("plus", 28)}</button>` +
        `</form>` +
        `<p class="note ag-tip">Tipp: „Zahnarzt morgen 14:30“ wird direkt ein Termin. Antippen zum Bearbeiten, ＋ ohne Text öffnet alle Felder.</p>` +
        `<div data-r="month"></div>` +
        `</div>` +
        `<div class="ez" data-r="ez" hidden></div>` +
      `</div>` +
      `<div class="ag-lists" data-r="lists"></div>` +
      `<div class="ez-next-wrap" data-r="eznext" hidden></div>` +
    `</div>`;

  const form = el.querySelector("[data-r=quick]");
  const qt = el.querySelector("[data-r=qtext]");
  let busy = false;
  // Text + Enter/＋ → sofort speichern; ＋ ohne Text → Blatt mit allen Feldern
  const submit = async () => {
    if (busy) return;
    const text = qt.value.trim();
    if (!text) { openTodoForm(null, C, { date: selDay || null }); return; }
    busy = true;
    try { if (await quickAdd(text)) qt.value = ""; } finally { busy = false; }
  };
  form.addEventListener("submit", (ev) => { ev.preventDefault(); submit(); });
  el.querySelector("[data-r=plus]").addEventListener("click", () => submit());

  el.addEventListener("click", (ev) => {
    const sw = ev.target.closest("[data-mode]");
    if (sw && el.contains(sw)) { setMode(sw.dataset.mode); return; }
    const ez = ev.target.closest("[data-ezday], [data-ezact], [data-ezid]");
    if (ez && el.contains(ez)) { onEinsatzClick(ez); return; }
    const b = ev.target.closest("[data-act], [data-day]");
    if (!b || !el.contains(b)) return;
    if (b.dataset.day) { selDay = selDay === b.dataset.day ? null : b.dataset.day; render(); return; }
    const act = b.dataset.act;
    if (act === "mprev" || act === "mnext") {
      const d = new Date(month.y, month.m + (act === "mprev" ? -1 : 1), 1);
      month = { y: d.getFullYear(), m: d.getMonth() };
      render();
      return;
    }
    if (act === "clearday") { selDay = null; render(); return; }
    const li = b.closest(".ag-item");
    if (!li) return;
    const id = li.dataset.id;
    if (act === "check") {
      if (b.dataset.busy) return;
      b.dataset.busy = "1";
      li.classList.add("ticking");
      setTimeout(() => toggleDone(id).finally(() => { delete b.dataset.busy; }), 220);
    } else if (act === "edit") {
      const t = (C.store.get().todos || []).find((x) => x.id === id);
      if (t) openTodoForm(t, C);
    }
  });

  snap = ctx.store.get ? ctx.store.get() : null;
  render();
  // Minütlich neu zeichnen (überfällig, Tageswechsel) – nur wenn sichtbar
  setInterval(() => { if (root && !root.hidden) render(); }, 60000);
}

export function update(s) {
  snap = s;
  if (selDay && !isKey(selDay)) selDay = null;
  render();
}

export function onShow() {
  const d = new Date();
  if (!selDay) month = { y: d.getFullYear(), m: d.getMonth() };
  if (!ezMonth) ezMonth = { y: d.getFullYear(), m: d.getMonth() };
  stripScrolled = "";
  lastKey = "";
  render();
}

/* ---------- Einsatzplan (Update 8) ---------- */

const EZ_COLORS = 6;
const WD_MO = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Von außen (z. B. „Mein Tag“): beim nächsten Öffnen den Einsatzplan zeigen. */
export function showEinsatzplan() {
  const d = new Date();
  ezMonth = { y: d.getFullYear(), m: d.getMonth() };
  setMode("einsatz");
}

function setMode(m) {
  mode = m === "einsatz" ? "einsatz" : "list";
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* egal */ }
  lastKey = "";
  stripScrolled = "";
  render();
}

function applyMode() {
  if (!root) return;
  const ez = mode === "einsatz";
  root.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  const show = (r, on) => { const x = root.querySelector(`[data-r=${r}]`); if (x) x.hidden = !on; };
  show("listhead", !ez);
  show("lists", !ez);
  show("ez", ez);
  show("eznext", ez);
}

function u() { return (C && C.util) || {}; }
function settingsOf() { return (snap && snap.settings) || {}; }

/** „Mo, 9.11.“ */
function shortDay(key) {
  const d = dateOf(key);
  return `${WD[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
}

/** Initialen: „Max Müller“ → „MM“, „Anna“ → „A“. */
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function peopleShort(people) {
  const ini = (people || []).map(initials).filter(Boolean);
  if (ini.length <= 3) return ini.join(" ");
  return ini.slice(0, 2).join(" ") + ` +${ini.length - 2}`;
}

/** Ortsname eines Einsatzes (gespeicherter Ort, sonst Freitext). */
function ezPlace(e) {
  if (!e) return "";
  const p = e.placeId ? (snap.places || []).find((x) => x.id === e.placeId) : null;
  return String((p && p.name) || e.place || e.title || "").trim();
}

/** Gleiche Farbe für gleichen Ort. */
function ezColor(e) {
  const k = String(e.placeId || ezPlace(e)).toLowerCase();
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return h % EZ_COLORS;
}

function abbr(name) {
  const s = String(name || "").trim();
  return s.length > 9 ? s.slice(0, 8) + "…" : s;
}

function dayFlags(key) {
  const ut = u(), st = settingsOf();
  const d = dateOf(key);
  const wd = d.getDay();
  let hol = null, school = null;
  if (st.holidays !== false && ut.holidayName) { try { hol = ut.holidayName(d.getTime()); } catch { hol = null; } }
  if (ut.schoolLabel) { try { school = ut.schoolLabel(d.getTime(), st); } catch { school = null; } }
  else if (ut.isSchoolDay) { try { school = ut.isSchoolDay(d.getTime(), st) ? "Berufsschule" : null; } catch { school = null; } }
  return { we: wd === 0 || wd === 6, hol, school };
}

function ezCalHTML(todos, tKey) {
  if (!ezMonth) { const d = new Date(); ezMonth = { y: d.getFullYear(), m: d.getMonth() }; }
  const { y, m } = ezMonth;
  const n = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Mo = 0
  const isCur = (() => { const d = new Date(); return d.getFullYear() === y && d.getMonth() === m; })();
  let cells = WD_MO.map((w, i) => `<div class="ez-wh${i >= 5 ? " we" : ""}" aria-hidden="true">${w}</div>`).join("");
  for (let i = 0; i < lead; i++) cells += `<div class="ez-cell ez-pad" aria-hidden="true"></div>`;
  for (let d = 1; d <= n; d++) {
    const k = `${y}-${pad(m + 1)}-${pad(d)}`;
    const col = (lead + d - 1) % 7;
    const f = dayFlags(k);
    const e = einsatzFor(k, todos);
    const prevE = e && col > 0 && d > 1 ? einsatzFor(addDays(k, -1), todos) : null;
    const nextE = e && col < 6 && d < n ? einsatzFor(addDays(k, 1), todos) : null;
    const cl = !!(prevE && prevE.id === e.id);
    const cr = !!(nextE && nextE.id === e.id);
    const place = e ? ezPlace(e) : "";
    const lblParts = [`${WD_LONG[dateOf(k).getDay()]}, ${d}. ${MONTHS[m]}`];
    if (f.hol) lblParts.push(`Feiertag ${f.hol}`);
    if (f.school) lblParts.push(f.school);
    if (e) lblParts.push(`Einsatz: ${place}${e.people && e.people.length ? " mit " + e.people.join(", ") : ""}`);
    else lblParts.push("kein Einsatz eingetragen");
    const cls = ["ez-cell"];
    if (k === tKey) cls.push("today");
    if (k < tKey) cls.push("past");
    if (f.we) cls.push("we");
    if (f.hol) cls.push("hol");
    if (f.school) cls.push("school");
    const mark = f.hol ? `<i class="ez-mk ez-mk-hol" aria-hidden="true">F</i>` : f.school ? `<i class="ez-mk ez-mk-sch" aria-hidden="true">BS</i>` : "";
    const bar = e
      ? `<span class="ez-bar ez-c${ezColor(e)}${cl ? " cl" : ""}${cr ? " cr" : ""}">${cl ? "&nbsp;" : esc(abbr(place))}</span>` +
        `<span class="ez-ini">${cl ? "" : esc(peopleShort(e.people))}</span>`
      : `<span class="ez-bar ez-empty"></span><span class="ez-ini"></span>`;
    cells += `<button type="button" class="${cls.join(" ")}" data-ezday="${k}" aria-label="${esc(lblParts.join(" – "))}"${f.hol ? ` title="${esc(f.hol)}"` : ""}>` +
      `<span class="ez-dn">${d}${mark}</span>${bar}</button>`;
  }
  return `<div class="ez-month">` +
      `<button type="button" class="icon-btn ag-mnav" data-ezact="prev" aria-label="Vorheriger Monat">${icon("chevron-left", 20)}</button>` +
      `<b class="ag-mname">${MONTHS[m]} ${y}</b>` +
      `<button type="button" class="btn sm ghost ez-today" data-ezact="today"${isCur ? " disabled" : ""}>Heute</button>` +
      `<button type="button" class="icon-btn ag-mnav" data-ezact="next" aria-label="Nächster Monat">${icon("chevron-right", 20)}</button>` +
    `</div>` +
    `<div class="ez-grid">${cells}</div>` +
    `<p class="note ez-tip">Tippe auf einen Tag und trag ein, wo du arbeitest und mit wem. <span class="ez-leg"><i class="ez-mk ez-mk-hol">F</i> Feiertag <i class="ez-mk ez-mk-sch">BS</i> Schule</span></p>`;
}

function ezNextHTML(todos, tKey) {
  const list = einsaetze(todos)
    .filter((e) => isKey(e.date) && ((isKey(e.dateTo) && e.dateTo >= e.date ? e.dateTo : e.date) >= tKey))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)))
    .slice(0, 10);
  const body = list.length
    ? `<ul class="ez-list">${list.map((e) => {
      const to = isKey(e.dateTo) && e.dateTo > e.date ? e.dateTo : null;
      const when = to ? `${shortDay(e.date)} – ${shortDay(to)}` : (e.date === tKey ? "Heute" : e.date === addDays(tKey, 1) ? "Morgen" : shortDay(e.date));
      const who = e.people && e.people.length ? `mit ${e.people.join(", ")}` : "";
      return `<li><button type="button" class="ez-row" data-ezid="${esc(e.id)}">` +
        `<span class="ez-dot ez-c${ezColor(e)}" aria-hidden="true"></span>` +
        `<span class="ez-rmain"><b>${esc(ezPlace(e) || "Ohne Ort")}</b><span class="ez-rmeta">${esc(when)}${who ? " · " + esc(who) : ""}${e.note ? " · " + esc(String(e.note).split("\n")[0]) : ""}</span></span>` +
        `${icon("chevron-right", 18)}</button></li>`;
    }).join("")}</ul>`
    : `<p class="note ag-none">Noch nichts eingetragen. Tippe oben auf einen Tag.</p>`;
  return section("Nächste Einsätze", body, "ez-next");
}

function renderEinsatz() {
  const todos = snap.todos || [];
  const tKey = todayKey();
  const st = settingsOf();
  const key = JSON.stringify(["ez", einsaetze(todos), (snap.places || []).map((p) => [p.id, p.name]), tKey, ezMonth,
    st.holidays, st.school, st.workDays]);
  if (key === lastKey) return;
  lastKey = key;
  root.querySelector("[data-r=ez]").innerHTML = ezCalHTML(todos, tKey);
  root.querySelector("[data-r=eznext]").innerHTML = ezNextHTML(todos, tKey);
}

function onEinsatzClick(b) {
  if (b.dataset.ezact) {
    const d0 = new Date();
    if (b.dataset.ezact === "today") ezMonth = { y: d0.getFullYear(), m: d0.getMonth() };
    else {
      const d = new Date(ezMonth.y, ezMonth.m + (b.dataset.ezact === "prev" ? -1 : 1), 1);
      ezMonth = { y: d.getFullYear(), m: d.getMonth() };
    }
    render();
    return;
  }
  const todos = (C.store.get().todos || []);
  if (b.dataset.ezday) {
    const k = b.dataset.ezday;
    openEinsatzForm(k, einsatzFor(k, todos));
  } else if (b.dataset.ezid) {
    const e = todos.find((t) => t.id === b.dataset.ezid);
    if (e) openEinsatzForm(e.date, e);
  }
}

function sortPeople(list) {
  return [...new Set(list.map((p) => String(p || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
}

/** Blatt „Wo bist du am Mo, 9.11.?“ – neu (existing=null) oder bearbeiten. */
export function openEinsatzForm(dayKey, existing = null, ctx = C) {
  const c = ctx || C;
  if (!C) C = c;
  const s0 = c.store.get();
  const places = (s0.places || []).filter((p) => p && p.name);
  const known = sortPeople(Array.isArray(s0.settings && s0.settings.people) ? s0.settings.people : []);
  const ex = existing || null;
  const multi = !!(ex && isKey(ex.dateTo) && ex.dateTo > ex.date);
  const st = {
    scope: "all",                                   // bei mehrtägigem Einsatz: "all" | "day"
    placeId: ex && ex.placeId && places.some((p) => p.id === ex.placeId) ? ex.placeId : null,
    place: ex ? (ex.placeId && places.some((p) => p.id === ex.placeId) ? "" : String(ex.place || ex.title || "")) : "",
    dateTo: ex && isKey(ex.dateTo) && ex.dateTo > ex.date ? ex.dateTo : null,
    people: sortPeople(ex && Array.isArray(ex.people) ? ex.people : []),
    extra: [],                                      // neu hinzugefügte Personen
  };
  const startKey = () => (ex && st.scope === "all" ? ex.date : dayKey);
  const fri = (() => { const wd = dateOf(dayKey).getDay(); return wd >= 1 && wd <= 4 ? addDays(dayKey, 5 - wd) : null; })();

  const bodyHTML =
    `<div class="fields ez-form">` +
      (multi ? `<div class="ez-scope"><p class="note">Dieser Einsatz gilt ${esc(shortDay(ex.date))} – ${esc(shortDay(ex.dateTo))}.</p>` +
        `<div class="chips" data-r="scope"><button type="button" class="chip" data-sc="all">Ganzen Einsatz ändern</button>` +
        `<button type="button" class="chip" data-sc="day">Nur ${esc(shortDay(dayKey))} ändern</button></div></div>` : "") +
      `<div><div class="lbl">Wo?</div>` +
        (places.length ? `<div class="chips ez-places" data-r="places">${places.map((p) =>
          `<button type="button" class="chip" data-pid="${esc(p.id)}">${icon("pin", 16)}<span>${esc(p.name)}</span></button>`).join("")}</div>` : "") +
        `<label class="ez-free">${places.length ? "Oder anderer Ort / Adresse" : "Ort oder Adresse"}` +
        `<input type="text" data-r="place" maxlength="140" enterkeyhint="done" placeholder="z. B. Baustelle Hauptstraße 5" value="${esc(st.place)}"></label>` +
      `</div>` +
      `<div data-r="towrap"><div class="lbl">Wie lange?</div><div class="chips" data-r="tochips">` +
        `<button type="button" class="chip" data-to="one">Nur dieser Tag</button>` +
        (fri ? `<button type="button" class="chip" data-to="fri">bis Freitag</button>` : "") +
      `</div><label class="ez-to">bis (optional)<input type="date" data-r="to" min="${esc(dayKey)}" value="${esc(st.dateTo || "")}"></label></div>` +
      `<div><div class="lbl">Mit wem?</div><div class="chips ez-people" data-r="people"></div>` +
        `<div class="row ez-addp" data-r="addwrap" hidden><input type="text" data-r="pname" maxlength="60" enterkeyhint="done" placeholder="Name" aria-label="Name der Person">` +
        `<button type="button" class="btn sm" data-r="padd">Dazu</button></div></div>` +
      `<label>Notiz<textarea data-r="note" rows="2" placeholder="optional, z. B. Schlüssel beim Hausmeister">${esc(ex ? ex.note || "" : "")}</textarea></label>` +
    `</div>` +
    `<div class="stack" style="margin-top:14px">` +
      `<button type="button" class="btn primary" data-r="save">Speichern</button>` +
      (ex ? `<button type="button" class="btn danger" data-r="del">${multi ? "Ganzen Einsatz löschen" : "Löschen"}</button>` : "") +
    `</div>`;

  return c.ui.openSheet({
    title: `Wo bist du am ${shortDay(dayKey)}?`,
    bodyHTML,
    onMount(sheet, close) {
      const $ = (r) => sheet.querySelector(`[data-r="${r}"]`);
      const drawPeople = () => {
        const all = sortPeople([...known, ...st.extra, ...st.people]);
        $("people").innerHTML = all.map((n) =>
          `<button type="button" class="chip" data-person="${esc(n)}" aria-pressed="${st.people.includes(n)}">${esc(n)}</button>`).join("") +
          `<button type="button" class="chip add" data-r="plus">+ Person</button>`;
      };
      const draw = () => {
        const sc = $("scope");
        if (sc) sc.querySelectorAll("[data-sc]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sc === st.scope)));
        const pl = $("places");
        if (pl) pl.querySelectorAll("[data-pid]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pid === st.placeId)));
        const day = st.scope === "day";
        $("towrap").hidden = day;
        $("to").min = startKey();
        $("tochips").querySelectorAll("[data-to]").forEach((b) => {
          const on = b.dataset.to === "one" ? !st.dateTo : st.dateTo === fri;
          b.setAttribute("aria-pressed", String(on));
        });
      };
      drawPeople();
      draw();

      const sc = $("scope");
      if (sc) sc.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-sc]");
        if (b) { st.scope = b.dataset.sc; draw(); }
      });
      const pl = $("places");
      if (pl) pl.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-pid]");
        if (!b) return;
        st.placeId = st.placeId === b.dataset.pid ? null : b.dataset.pid;
        if (st.placeId) { st.place = ""; $("place").value = ""; }
        draw();
      });
      $("place").addEventListener("input", () => {
        st.place = $("place").value;
        if (st.place.trim() && st.placeId) { st.placeId = null; draw(); }
      });
      $("tochips").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-to]");
        if (!b) return;
        st.dateTo = b.dataset.to === "fri" ? fri : null;
        $("to").value = st.dateTo || "";
        draw();
      });
      $("to").addEventListener("input", () => {
        const v = $("to").value;
        st.dateTo = isKey(v) && v > startKey() ? v : null;
        draw();
      });
      const addPerson = () => {
        const name = $("pname").value.trim().replace(/\s+/g, " ");
        if (!name) { $("pname").focus(); return; }
        const hit = sortPeople([...known, ...st.extra]).find((n) => n.toLowerCase() === name.toLowerCase());
        const n = hit || name;
        if (!hit) st.extra.push(n);
        if (!st.people.includes(n)) st.people.push(n);
        $("pname").value = "";
        $("addwrap").hidden = true;
        drawPeople();
      };
      $("people").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-person], [data-r=plus]");
        if (!b) return;
        if (b.dataset.r === "plus") {
          $("addwrap").hidden = false;
          setTimeout(() => { try { $("pname").focus(); } catch { /* egal */ } }, 30);
          return;
        }
        const n = b.dataset.person;
        st.people = st.people.includes(n) ? st.people.filter((x) => x !== n) : [...st.people, n];
        b.setAttribute("aria-pressed", String(st.people.includes(n)));
      });
      $("padd").addEventListener("click", addPerson);
      $("pname").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); addPerson(); } });

      const saveBtn = $("save");
      saveBtn.addEventListener("click", async () => {
        if (!$("addwrap").hidden && $("pname").value.trim()) addPerson();
        const p = st.placeId ? places.find((x) => x.id === st.placeId) : null;
        const placeName = p ? p.name : $("place").value.trim();
        if (!placeName) { c.ui.toast("Bitte wähle einen Ort oder schreib ihn hinein."); $("place").focus(); return; }
        const onlyDay = st.scope === "day";
        const date = onlyDay ? dayKey : (ex ? ex.date : dayKey);
        const dateTo = onlyDay ? null : (st.dateTo && st.dateTo > date ? st.dateTo : null);
        const data = {
          ...(ex && !onlyDay ? ex : {}),
          kind: "einsatz",
          title: placeName,
          date, dateTo,
          time: null,
          placeId: p ? p.id : null,
          place: placeName,
          people: sortPeople(st.people),
          note: $("note").value.trim(),
          remind: false, done: false, doneAt: null,
        };
        if (onlyDay) { delete data.id; delete data.createdAt; }
        c.ui.setBusy(saveBtn, true, "Speichert …");
        try {
          await c.store.saveTodo(data);
          const cur = Array.isArray(c.store.get().settings?.people) ? c.store.get().settings.people : [];
          const merged = sortPeople([...cur, ...data.people]);
          if (merged.length !== sortPeople(cur).length) {
            try { await c.store.saveSettings({ people: merged }); } catch { /* Toast vom Store */ }
          }
          close();
          c.ui.toast(`Einsatz gespeichert · ${shortDay(date)}${dateTo ? " – " + shortDay(dateTo) : ""}`, 2200);
        } catch { c.ui.setBusy(saveBtn, false); }
      });

      const del = $("del");
      if (del) {
        c.ui.confirmButton(del, "Wirklich löschen?", async () => {
          try { await c.store.deleteTodo(ex.id); close(); c.ui.toast("Einsatz gelöscht."); } catch { /* Toast vom Store */ }
        });
      }
    },
  });
}
