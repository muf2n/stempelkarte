// Update 10 – Alltag › 🏡 Haushalt (#alltag/haushalt): Putzplan (wiederkehrende Aufgaben mit Raum und Intervall)
// und Wartung (z. B. Rauchmelder testen, Filter wechseln). Abhaken mit Verlauf, „zuletzt erledigt“, nächster Termin,
// Überfällig-Abzeichen. Fällige Aufgaben erscheinen in den Mitteilungen und im Dashboard. Reine Logik: ./haushalt-core.js
// Sammlung „haushalt“.
import { collection } from "./db.js";
import * as H from "./haushalt-core.js";
import * as ui from "../ui.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";

const TAB_KEY = "sk-hh-tab";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const TABS = [["putz", "🧽", "Putzplan"], ["wartung", "🛠️", "Wartung"], ["verlauf", "📜", "Verlauf"]];

function injectCSS() {
  if (document.getElementById("hh-css")) return;
  const l = document.createElement("link");
  l.id = "hh-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-haushalt.css", import.meta.url).href;
  document.head.appendChild(l);
}

const safe = (p, ok) => Promise.resolve(p).then(() => { if (ok) ui.toast(ok); return true; })
  .catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); return false; });

export function mount(el) {
  injectCSS();
  const col = collection("haushalt");
  const S = { tab: TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "putz", room: "" };
  let alive = true, queued = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };

  el.innerHTML =
    `<div class="hh">
      <div class="hh-sum card" aria-live="polite"></div>
      <div class="hh-tabs" role="tablist" aria-label="Bereich"></div>
      <div class="hh-rooms" role="group" aria-label="Raum"></div>
      <div class="hh-main"></div>
    </div>`;
  const sumEl = el.querySelector(".hh-sum");
  const tabsEl = el.querySelector(".hh-tabs");
  const roomsEl = el.querySelector(".hh-rooms");
  const mainEl = el.querySelector(".hh-main");

  const all = () => col.all().map((x) => H.normTask(x)).filter((t) => t.id && t.title);

  function render() {
    const today = H.todayKey();
    const tasks = all();
    const c = H.counts(tasks, today);
    const due = H.dueChores(tasks);
    const over = due.filter((d) => d.state === "ueber").length;
    sumEl.innerHTML = !tasks.length ? `<div class="hh-sum-t"><b>🏡 Dein Zuhause, gut organisiert</b><small>Putzplan und Wartung an einem Ort – du siehst sofort, was dran ist.</small></div>`
      : `<div class="hh-sum-big" aria-hidden="true">${c.faellig ? (over ? "⏰" : "📌") : "✨"}</div>` +
        `<div class="hh-sum-t"><b>${c.faellig ? `${c.faellig} ${c.faellig === 1 ? "Aufgabe ist" : "Aufgaben sind"} dran` : "Alles erledigt – gönn dir was! ☕"}</b>` +
        `<small>${over ? `${over} davon überfällig · ` : ""}${c.putz} im Putzplan · ${c.wartung} Wartung</small></div>`;
    tabsEl.innerHTML = TABS.map(([id, e, label]) => {
      const n = id === "verlauf" ? 0 : due.filter((d) => d.kind === id && d.state !== "bald").length;
      return `<button type="button" role="tab" class="hh-tab" data-tab="${id}" aria-selected="${S.tab === id}"><span aria-hidden="true">${e}</span><span>${label}</span>${n ? `<span class="hh-tab-n" title="fällig">${n}</span>` : ""}</button>`;
    }).join("");
    if (S.tab === "verlauf") { roomsEl.innerHTML = ""; renderLog(tasks); return; }
    const list = tasks.filter((t) => t.kind === S.tab);
    const rooms = [...new Set(list.map((t) => t.room).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
    if (S.room && !rooms.includes(S.room)) S.room = "";
    roomsEl.innerHTML = rooms.length > 1 ? `<div class="chips">` +
      `<button type="button" class="chip" data-room="" aria-pressed="${!S.room}">Alle Räume</button>` +
      rooms.map((r) => `<button type="button" class="chip" data-room="${esc(r)}" aria-pressed="${S.room === r}">${H.roomEmoji(r)} ${esc(r)}</button>`).join("") + `</div>` : "";
    renderList(S.room ? list.filter((t) => t.room === S.room) : list, today);
  }

  function presetChips(kind) {
    return `<div class="hh-presets"><p class="note">💡 Schnell anlegen:</p><div class="chips">` +
      H.PRESETS[kind].map((p, i) => `<button type="button" class="chip" data-hh="preset" data-kind="${kind}" data-i="${i}">${p.e} ${esc(p.title)}</button>`).join("") + `</div></div>`;
  }

  function renderList(list, today) {
    const kind = S.tab;
    const addBtn = `<button type="button" class="btn primary sm hh-add" data-hh="new" data-kind="${kind}">${icon("plus", 16)}<span>${kind === "wartung" ? "Wartung" : "Aufgabe"}</span></button>`;
    if (!col.loaded && !list.length) { mainEl.innerHTML = `<p class="note">Lade …</p>`; return; }
    if (!list.length) {
      mainEl.innerHTML = `<div class="empty hh-empty"><div class="hh-empty-emo">${kind === "wartung" ? "🛠️" : "🧽"}</div>` +
        `<h3>${kind === "wartung" ? "Noch keine Wartung eingetragen" : "Dein Putzplan ist noch leer"}</h3>` +
        `<p>${kind === "wartung" ? "Rauchmelder testen, Filter wechseln, entkalken – trag ein, was regelmäßig fällig ist, und die App erinnert dich rechtzeitig. 🔔" : "Leg fest, was wie oft dran ist – die App zeigt dir, was heute fällig ist. Abhaken fühlt sich gut an! ✅"}</p>` +
        `${addBtn}${presetChips(kind)}</div>`;
      return;
    }
    const sorted = H.sortTasks(list, today);
    mainEl.innerHTML = `<div class="hh-head">${addBtn}</div><ul class="hh-list">${sorted.map((t) => {
      const st = H.taskStatus(t, today);
      const doneToday = t.last === today;
      return `<li class="hh-item is-${st.state}">` +
        `<button type="button" class="hh-card" data-hh="edit" data-id="${esc(t.id)}">` +
          `<span class="hh-emo" aria-hidden="true">${t.kind === "wartung" ? "🛠️" : H.roomEmoji(t.room)}</span>` +
          `<span class="hh-ct"><b>${esc(t.title)}</b>` +
            `<small>${esc([t.room, H.intervalLabel(t.unit, t.n)].filter(Boolean).join(" · "))}</small>` +
            `<small>${esc(H.lastLabel(t, today))}</small>` +
            `<span class="hh-b hh-b-${st.state}">${st.e} ${esc(st.label)}</span></span>` +
        `</button>` +
        `<button type="button" class="hh-tick${doneToday ? " is-done" : ""}" data-hh="${doneToday ? "untick" : "tick"}" data-id="${esc(t.id)}" aria-label="${doneToday ? `${esc(t.title)}: Abhaken zurücknehmen` : `${esc(t.title)} erledigt`}">` +
          `<span aria-hidden="true">${doneToday ? "✓" : ""}</span><small>${doneToday ? "erledigt" : "Erledigt"}</small></button>` +
      `</li>`;
    }).join("")}</ul>`;
  }

  function renderLog(tasks) {
    const log = H.recentLog(tasks, 60);
    if (!log.length) { mainEl.innerHTML = `<div class="empty hh-empty"><div class="hh-empty-emo">📜</div><h3>Noch nichts abgehakt</h3><p>Sobald du etwas erledigst, siehst du es hier – schön zum Zurückschauen. 😊</p></div>`; return; }
    let lastDay = "";
    const rows = [];
    for (const h of log) {
      if (h.day !== lastDay) { rows.push(`<li class="hh-log-day">${esc(H.fmtShort(h.day))} ${h.day.slice(0, 4)}</li>`); lastDay = h.day; }
      const t = new Date(h.ts);
      rows.push(`<li class="hh-log-row"><span aria-hidden="true">${h.kind === "wartung" ? "🛠️" : H.roomEmoji(h.room)}</span><span><b>${esc(h.title)}</b>${h.room ? ` <small>· ${esc(h.room)}</small>` : ""}${h.note ? `<small class="hh-log-note">${esc(h.note)}</small>` : ""}</span>` +
        `<time>${h.ts > 1e11 ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : ""}</time></li>`);
    }
    mainEl.innerHTML = `<ul class="hh-log card">${rows.join("")}</ul>`;
  }

  /* ---------- Formular ---------- */

  function openForm(task, kind = "putz", preset = null) {
    const isNew = !task;
    const t = H.normTask(task || { kind, ...(preset ? { title: preset.title, room: preset.room, unit: preset.unit, n: preset.n } : { unit: kind === "wartung" ? "m" : "w", n: 1 }) });
    let choice = H.intervalChoice(t.unit, t.n);
    const nVal = choice === "tage" ? H.toDays(t.unit, t.n) : choice === "monate" ? t.n : "";
    const hist = t.history.slice().reverse().slice(0, 12);
    ui.openSheet({
      title: isNew ? (t.kind === "wartung" ? "🛠️ Neue Wartung" : "🧽 Neue Aufgabe") : "Bearbeiten",
      bodyHTML: `<div class="fields hh-form">` +
        `<label>Was ist zu tun?<input id="hh-f-title" maxlength="80" placeholder="${t.kind === "wartung" ? "z. B. Rauchmelder testen" : "z. B. Bad putzen"}" value="${esc(t.title)}"></label>` +
        `<div class="lbl">Art</div><div class="chips" data-r="kind">${H.KINDS.map((k) => `<button type="button" class="chip" data-fkind="${k.id}" aria-pressed="${t.kind === k.id}">${k.e} ${k.label}</button>`).join("")}</div>` +
        `<label>Raum / Bereich<input id="hh-f-room" maxlength="40" list="hh-rooms" placeholder="z. B. Küche" value="${esc(t.room)}"></label>` +
        `<datalist id="hh-rooms">${H.ROOMS.map((r) => `<option value="${esc(r)}"></option>`).join("")}</datalist>` +
        `<div class="lbl">Wie oft?</div><div class="chips" data-r="int">${H.INTERVALS.map(([id, , , label]) => `<button type="button" class="chip" data-fint="${id}" aria-pressed="${choice === id}">${label}</button>`).join("")}</div>` +
        `<label data-nf>${choice === "monate" ? "Alle wie viele Monate?" : "Alle wie viele Tage?"}<input id="hh-f-n" inputmode="numeric" maxlength="3" value="${nVal}"></label>` +
        `<div class="row"><label>Zuletzt erledigt<input id="hh-f-last" type="date" value="${esc(t.last || "")}"></label>` +
        `<label>Erstmals fällig<input id="hh-f-start" type="date" value="${esc(t.start)}"></label></div>` +
        `<p class="note">Noch nie erledigt? Dann ist die Aufgabe ab „Erstmals fällig“ dran. Danach rechnet die App „zuletzt erledigt + Intervall“.</p>` +
        `<label>Notiz (optional)<textarea id="hh-f-notes" rows="2" maxlength="1000" placeholder="z. B. Filter-Typ, Putzmittel">${esc(t.notes)}</textarea></label>` +
        (isNew ? "" : `<label class="switch"><span>⏸️ Pausieren (z. B. im Urlaub)</span><input type="checkbox" id="hh-f-pause"${t.paused ? " checked" : ""}></label>`) +
        (hist.length ? `<div class="hh-fhist"><div class="lbl">📜 Verlauf</div><ul>${hist.map((h) => `<li>✅ ${esc(H.fmtDay(h.day))}${h.note ? ` – ${esc(h.note)}` : ""}</li>`).join("")}</ul></div>` : "") +
      `</div>` +
      `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        let kindSel = t.kind;
        const syncN = () => {
          const lab = sheet.querySelector("[data-nf]");
          lab.hidden = choice !== "tage" && choice !== "monate";
          lab.firstChild.textContent = choice === "monate" ? "Alle wie viele Monate?" : "Alle wie viele Tage?";
          if (!lab.hidden && !$("#hh-f-n").value) $("#hh-f-n").value = choice === "monate" ? "3" : "3";
        };
        syncN();
        $('[data-r="kind"]').addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-fkind]"); if (!b) return;
          kindSel = b.dataset.fkind;
          sheet.querySelectorAll("[data-fkind]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        });
        $('[data-r="int"]').addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-fint]"); if (!b) return;
          if (b.dataset.fint !== choice) $("#hh-f-n").value = "";
          choice = b.dataset.fint;
          sheet.querySelectorAll("[data-fint]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          syncN();
        });
        $("[data-save]").addEventListener("click", async () => {
          const title = $("#hh-f-title").value.trim();
          if (!title) { ui.toast("Bitte eintragen, was zu tun ist."); $("#hh-f-title").focus(); return; }
          const def = H.INTERVALS.find((x) => x[0] === choice);
          let unit = def[1], n = def[2];
          if (choice === "tage" || choice === "monate") {
            n = Math.round(Number($("#hh-f-n").value.replace(",", ".")));
            const max = choice === "monate" ? 36 : 365;
            if (!(n >= 1 && n <= max)) { ui.toast(choice === "monate" ? "Bitte 1–36 Monate eingeben." : "Bitte 1–365 Tage eingeben."); $("#hh-f-n").focus(); return; }
          }
          const last = $("#hh-f-last").value || null;
          const item = {
            ...(task || {}), kind: kindSel, title, room: $("#hh-f-room").value.trim(), unit, n, last,
            start: $("#hh-f-start").value || H.todayKey(), notes: $("#hh-f-notes").value.trim(),
            paused: $("#hh-f-pause") ? $("#hh-f-pause").checked : false,
            history: t.history,
          };
          if (isNew && last) item.history = [{ ts: Date.now(), day: last, note: "beim Anlegen eingetragen" }];
          close();
          if (kindSel !== S.tab) { S.tab = kindSel; lsSet(TAB_KEY, kindSel); }
          await safe(col.put(item), isNew ? `${kindSel === "wartung" ? "🛠️" : "🧽"} „${title}“ ist im Plan ✓` : "Gespeichert ✓");
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", () => { close(); safe(col.remove(task.id), "Gelöscht 🗑️"); });
      },
    });
  }

  el.addEventListener("click", (ev) => {
    const tb = ev.target.closest("[data-tab]");
    if (tb) { S.tab = tb.dataset.tab; lsSet(TAB_KEY, S.tab); S.room = ""; render(); return; }
    const rb = ev.target.closest("[data-room]");
    if (rb) { S.room = rb.dataset.room; render(); return; }
    const b = ev.target.closest("[data-hh]");
    if (!b) return;
    const a = b.dataset.hh;
    const t = b.dataset.id ? col.get(b.dataset.id) : null;
    if (a === "new") openForm(null, b.dataset.kind || "putz");
    else if (a === "preset") openForm(null, b.dataset.kind, H.PRESETS[b.dataset.kind][Number(b.dataset.i)]);
    else if (a === "edit" && t) openForm(t);
    else if (a === "tick" && t) {
      const next = H.tick(t, Date.now());
      const nd = H.nextDue(next);
      safe(col.put(next), `✅ ${H.normTask(t).title} erledigt – nächstes Mal ${H.fmtShort(nd)} 🙌`);
    } else if (a === "untick" && t) safe(col.put(H.untick(t)), "↩️ Zurückgenommen");
  });

  const off = col.watch(queue);
  render();
  return () => { alive = false; try { off(); } catch { /* egal */ } };
}
