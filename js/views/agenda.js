// Reiter „Planer“: Aufgaben (To-dos) und Termine mit Erinnerung.
// Daten: store.saveTodo/deleteTodo, snap.todos. Der Kalender (Einträge) bleibt reine Arbeitszeit.
import { icon } from "../icons.js";

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
  const todos = snap.todos || [];
  const tKey = todayKey();
  const minute = `${new Date().getHours()}:${new Date().getMinutes()}`;
  const key = JSON.stringify([todos, tKey, selDay, month, doneOpen, minute.slice(0, -1)]);
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
      const ids = (C.store.get().todos || []).filter((t) => t.done).map((t) => t.id);
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
        `<div class="section-h ag-top"><h2>Planer</h2><span class="note ag-sub">Aufgaben &amp; Termine</span></div>` +
        `<form class="ag-quick" data-r="quick" autocomplete="off">` +
          `<input type="text" data-r="qtext" maxlength="140" enterkeyhint="done" placeholder="Neue Aufgabe oder Termin…" aria-label="Neue Aufgabe oder Termin">` +
          `<button type="button" class="ag-plus" data-r="plus" aria-label="Hinzufügen">${icon("plus", 28)}</button>` +
        `</form>` +
        `<p class="note ag-tip">Tipp: „Zahnarzt morgen 14:30“ wird direkt ein Termin. Antippen zum Bearbeiten, ＋ ohne Text öffnet alle Felder.</p>` +
        `<div data-r="month"></div>` +
      `</div>` +
      `<div class="ag-lists" data-r="lists"></div>` +
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
  stripScrolled = "";
  lastKey = "";
  render();
}
