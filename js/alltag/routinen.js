// Update 10 – Alltag › 🎯 Routinen & Ziele (#alltag/routinen): Gewohnheiten (täglich/wöchentlich, Streaks 🔥,
// Kalender-Heatmap der letzten 8 Wochen), Morgen-/Abendroutine (Checklisten, setzen sich täglich zurück) und
// persönliche Ziele mit Meilensteinen und Fortschritt in %. Reine Logik: ./habits-core.js
// Sammlungen „habits“, „routines“, „goals“.
import { collection } from "./db.js";
import * as R from "./habits-core.js";
import * as ui from "../ui.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";

const TAB_KEY = "sk-rt-tab";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const TABS = [["habits", "🔥", "Gewohnheiten"], ["routines", "🌅", "Routinen"], ["goals", "🎯", "Ziele"]];
const EMOJIS = ["💧", "📖", "🏃", "🧘", "🦷", "🥗", "😴", "📵", "🇯🇵", "🎸", "💪", "🚭"];
const GOAL_EMOJIS = ["🎯", "🎓", "🚗", "💰", "🏋️", "✈️", "📚", "🏠"];
const SUGGEST = {
  morgen: ["Glas Wasser trinken 💧", "Zähne putzen 🦷", "Bett machen 🛏️", "Jause & Tasche packen 🎒", "Wetter checken ☀️"],
  abend: ["Gewand für morgen herrichten 👕", "Handy weglegen 📵", "Zähne putzen 🦷", "10 Minuten lesen 📖", "Wecker stellen ⏰"],
};
const WDS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function injectCSS() {
  if (document.getElementById("rt-css")) return;
  const l = document.createElement("link");
  l.id = "rt-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-routinen.css", import.meta.url).href;
  document.head.appendChild(l);
}
const safe = (p, ok) => Promise.resolve(p).then(() => { if (ok) ui.toast(ok); return true; })
  .catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); return false; });
const fmtDay = (k) => { const [y, m, d] = k.split("-"); return `${d}.${m}.${y}`; };

export function mount(el) {
  injectCSS();
  const habits = collection("habits");
  const routines = collection("routines");
  const goals = collection("goals");
  const S = { tab: TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "habits" };
  let alive = true, queued = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };

  el.innerHTML = `<div class="rt"><div class="rt-tabs" role="tablist" aria-label="Bereich"></div><div class="rt-main"></div></div>`;
  const tabsEl = el.querySelector(".rt-tabs");
  const mainEl = el.querySelector(".rt-main");

  const habitList = () => habits.all().map(R.normHabit).filter((h) => h.id && h.title && !h.archived)
    .sort((a, b) => (a.created || 0) - (b.created || 0) || a.title.localeCompare(b.title, "de"));

  function render() {
    const today = R.todayKey();
    const openN = R.openHabits(habits.all(), today).length;
    const rOpen = R.ROUTINES.reduce((n, meta) => { const r = R.normRoutine(routines.get(meta.id) || {}, meta.id); return n + (r.items.length && R.checkedToday(r, today).length < r.items.length ? 1 : 0); }, 0);
    tabsEl.innerHTML = TABS.map(([id, e, label]) => {
      const n = id === "habits" ? openN : id === "routines" ? rOpen : 0;
      return `<button type="button" role="tab" class="rt-tab" data-tab="${id}" aria-selected="${S.tab === id}"><span aria-hidden="true">${e}</span><span>${label}</span>${n ? `<span class="rt-tab-n" title="heute offen">${n}</span>` : ""}</button>`;
    }).join("");
    if (S.tab === "routines") renderRoutines(today);
    else if (S.tab === "goals") renderGoals(today);
    else renderHabits(today);
  }

  /* ---------- Gewohnheiten ---------- */

  function heat(h, today) {
    const hm = R.heatmap(h, today, 8);
    return `<div class="rt-heat" role="img" aria-label="Verlauf der letzten 8 Wochen: ${R.rate(h, today)} % geschafft">` +
      `<div class="rt-heat-wd" aria-hidden="true">${WDS.map((d) => `<span>${d[0]}</span>`).join("")}</div>` +
      hm.map((w) => `<div class="rt-heat-col">${w.days.map((d) => `<span class="rt-c l${d.level}${d.future ? " fut" : ""}${d.today ? " now" : ""}" title="${esc(fmtDay(d.key))}${d.count ? ` · ${d.count}×` : ""}"></span>`).join("")}</div>`).join("") +
    `</div>`;
  }

  function renderHabits(today) {
    const list = habitList();
    const add = `<button type="button" class="btn primary sm" data-rt="habit-new">${icon("plus", 16)}<span>Gewohnheit</span></button>`;
    if (!list.length) {
      mainEl.innerHTML = habits.loaded ? `<div class="empty rt-empty"><div class="rt-empty-emo">🔥</div><h3>Kleine Schritte, große Wirkung</h3>` +
        `<p>Leg eine Gewohnheit an – z. B. „Wasser trinken“ oder „3× pro Woche Sport“. Jeden Tag abhaken und die Serie 🔥 wachsen lassen!</p>${add}</div>` : `<p class="note">Lade …</p>`;
      return;
    }
    const doneN = list.filter((h) => !R.openToday(h, today)).length;
    mainEl.innerHTML = `<div class="rt-head"><p class="rt-sub">${doneN === list.length ? "Heute alles geschafft – stark! 🎉" : `${doneN} von ${list.length} heute erledigt`}</p>${add}</div>` +
      `<ul class="rt-habits">${list.map((h) => {
        const st = R.streak(h, today);
        const cnt = Number(h.log[today]) || 0;
        const done = !R.openToday(h, today);
        const multi = h.freq === "daily" && h.target > 1;
        return `<li class="rt-habit card${done ? " is-done" : ""}">` +
          `<div class="rt-h-top">` +
            `<button type="button" class="rt-h-main" data-rt="habit-edit" data-id="${esc(h.id)}">` +
              `<span class="rt-h-emo" aria-hidden="true">${esc(h.emoji)}</span>` +
              `<span class="rt-h-t"><b>${esc(h.title)}</b><small>${esc(R.progressLabel(h, today))}${h.freq === "weekly" ? "" : ""}</small></span>` +
            `</button>` +
            `<span class="rt-streak${st.current ? "" : " zero"}" title="Beste Serie: ${st.best} ${st.unit}"><span aria-hidden="true">🔥</span><b>${st.current}</b><small>${st.unit}</small></span>` +
            `<button type="button" class="rt-tap${(h.freq === "weekly" ? cnt > 0 : done) ? " on" : ""}" data-rt="habit-tap" data-id="${esc(h.id)}" aria-pressed="${h.freq === "weekly" ? cnt > 0 : done}" aria-label="${esc(h.title)} ${multi ? `+1 (${cnt}/${h.target})` : "heute abhaken"}">` +
              (multi ? `<b>${cnt}</b><small>/${h.target}</small>` : `<span aria-hidden="true">✓</span>`) + `</button>` +
          `</div>` +
          `<div class="rt-h-body">${heat(h, today)}<div class="rt-h-stats"><span>Beste Serie</span><b>${st.best} ${esc(st.unit)}</b><span>Letzte 4 Wochen</span><b>${R.rate(h, today)} %</b></div></div>` +
        `</li>`;
      }).join("")}</ul>`;
  }

  function openHabit(h) {
    const isNew = !h;
    const x = R.normHabit(h || { emoji: "💧", freq: "daily", target: 1 });
    let freq = x.freq;
    ui.openSheet({
      title: isNew ? "🔥 Neue Gewohnheit" : "Gewohnheit bearbeiten",
      bodyHTML: `<div class="fields">` +
        `<label>Was möchtest du regelmäßig tun?<input id="rt-h-title" maxlength="60" placeholder="z. B. Wasser trinken" value="${esc(x.title)}"></label>` +
        `<label>Emoji<input id="rt-h-emo" maxlength="8" value="${esc(x.emoji)}" class="rt-emo-in"></label>` +
        `<div class="chips" data-r="emo">${EMOJIS.map((e) => `<button type="button" class="chip" data-emo="${e}">${e}</button>`).join("")}</div>` +
        `<div class="lbl">Rhythmus</div><div class="chips" data-r="freq">` +
          `<button type="button" class="chip" data-freq="daily" aria-pressed="${freq === "daily"}">📅 Täglich</button>` +
          `<button type="button" class="chip" data-freq="weekly" aria-pressed="${freq === "weekly"}">🗓️ Wöchentlich</button></div>` +
        `<label><span data-tl>${freq === "weekly" ? "An wie vielen Tagen pro Woche? (1–7)" : "Wie oft pro Tag? (meist 1)"}</span><input id="rt-h-target" inputmode="numeric" maxlength="2" value="${x.target}"></label>` +
        (isNew ? "" : `<p class="note">Beste Serie: ${R.streak(x).best} ${R.streak(x).unit} · letzte 4 Wochen ${R.rate(x)} % geschafft</p>`) +
      `</div>` +
      `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        $('[data-r="emo"]').addEventListener("click", (ev) => { const b = ev.target.closest("[data-emo]"); if (b) $("#rt-h-emo").value = b.dataset.emo; });
        $('[data-r="freq"]').addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-freq]"); if (!b) return;
          freq = b.dataset.freq;
          sheet.querySelectorAll("[data-freq]").forEach((y) => y.setAttribute("aria-pressed", String(y === b)));
          $("[data-tl]").textContent = freq === "weekly" ? "An wie vielen Tagen pro Woche? (1–7)" : "Wie oft pro Tag? (meist 1)";
          $("#rt-h-target").value = freq === "weekly" ? "3" : "1";
        });
        $("[data-save]").addEventListener("click", () => {
          const title = $("#rt-h-title").value.trim();
          if (!title) { ui.toast("Bitte einen Namen eingeben."); $("#rt-h-title").focus(); return; }
          const target = Math.round(Number($("#rt-h-target").value));
          const max = freq === "weekly" ? 7 : 20;
          if (!(target >= 1 && target <= max)) { ui.toast(`Bitte eine Zahl von 1 bis ${max} eingeben.`); return; }
          close();
          safe(habits.put({ ...(h || {}), title, emoji: $("#rt-h-emo").value.trim() || "⭐", freq, target, log: x.log }), isNew ? `${$("#rt-h-emo").value.trim() || "⭐"} Los geht's – viel Erfolg! 💪` : "Gespeichert ✓");
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", () => { close(); safe(habits.remove(h.id), "Gelöscht 🗑️"); });
      },
    });
  }

  /* ---------- Routinen ---------- */

  function renderRoutines(today) {
    mainEl.innerHTML = `<p class="rt-sub">Hakt sich jeden Tag neu – morgen startest du wieder bei null. ☀️</p><div class="rt-routines">${R.ROUTINES.map((meta) => {
      const r = R.normRoutine(routines.get(meta.id) || {}, meta.id);
      const done = new Set(R.checkedToday(r, today));
      const st = R.routineStreak(r, today);
      const all = r.items.length && done.size === r.items.length;
      return `<section class="rt-rout card${all ? " is-done" : ""}" aria-label="${esc(r.title)}">` +
        `<div class="rt-r-head"><span class="rt-r-emo" aria-hidden="true">${meta.e}</span><div><h3>${esc(r.title)}</h3>` +
          `<small>${r.items.length ? `${done.size}/${r.items.length} erledigt${all ? " – super! 🎉" : ""}` : "noch keine Punkte"}${st.current ? ` · 🔥 ${st.current} ${st.current === 1 ? "Tag" : "Tage"}` : ""}</small></div>` +
          `<button type="button" class="btn ghost sm" data-rt="rout-edit" data-id="${meta.id}">${icon("pencil", 16)}<span>Bearbeiten</span></button></div>` +
        (r.items.length ? `<div class="rt-r-bar" aria-hidden="true"><span style="width:${Math.round((done.size / r.items.length) * 100)}%"></span></div>` +
          `<ul class="rt-r-list">${r.items.map((i) => `<li><label class="rt-check"><input type="checkbox" data-rt="rout-tick" data-r="${meta.id}" data-item="${esc(i.id)}"${done.has(i.id) ? " checked" : ""}><span>${esc(i.text)}</span></label></li>`).join("")}</ul>`
          : `<p class="note">Was gehört für dich dazu? Tipp auf „Bearbeiten“ – ein paar Vorschläge sind schon vorbereitet. ✍️</p>`) +
      `</section>`;
    }).join("")}</div>`;
  }

  function openRoutine(id) {
    const meta = R.ROUTINES.find((r) => r.id === id);
    const cur = routines.get(id);
    const r = R.normRoutine(cur || {}, id);
    ui.openSheet({
      title: `${meta.e} ${meta.title}`,
      bodyHTML: `<div class="fields">` +
        `<label>Punkte (einer pro Zeile)<textarea id="rt-r-items" rows="7" maxlength="2000" placeholder="${esc(SUGGEST[id].slice(0, 3).join("\n"))}">${esc(r.items.map((i) => i.text).join("\n"))}</textarea></label>` +
        `<button type="button" class="btn ghost sm" data-suggest>💡 Vorschläge einfügen</button>` +
      `</div><div class="row"><button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const ta = sheet.querySelector("#rt-r-items");
        sheet.querySelector("[data-suggest]").addEventListener("click", () => {
          const have = new Set(ta.value.split("\n").map((x) => x.trim()).filter(Boolean));
          ta.value = [...have, ...SUGGEST[id].filter((x) => !have.has(x))].join("\n");
        });
        sheet.querySelector("[data-save]").addEventListener("click", () => {
          const lines = ta.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 25);
          const items = lines.map((text) => { const old = r.items.find((i) => i.text === text); return { id: old ? old.id : R.newItemId(), text: text.slice(0, 80) }; });
          close();
          safe(routines.put({ ...(cur || {}), id, title: meta.title, items, doneDay: r.doneDay, doneIds: r.doneIds, log: r.log }), "Routine gespeichert ✓");
        });
      },
    });
  }

  /* ---------- Ziele ---------- */

  function renderGoals(today) {
    const list = R.sortGoals(goals.all());
    const add = `<button type="button" class="btn primary sm" data-rt="goal-new">${icon("plus", 16)}<span>Ziel</span></button>`;
    if (!list.length) {
      mainEl.innerHTML = goals.loaded ? `<div class="empty rt-empty"><div class="rt-empty-emo">🎯</div><h3>Was möchtest du erreichen?</h3>` +
        `<p>Führerschein, LAP, Sparziel oder ein eigenes Projekt – teil es in Meilensteine und schau zu, wie der Balken wächst. 📈</p>${add}</div>` : `<p class="note">Lade …</p>`;
      return;
    }
    mainEl.innerHTML = `<div class="rt-head"><p class="rt-sub">${list.filter((g) => g.done).length} von ${list.length} Zielen geschafft</p>${add}</div>` +
      `<ul class="rt-goals">${list.map((g) => {
        const p = R.goalProgress(g);
        const dl = R.goalDueLabel(g, today);
        const late = g.due && !g.done && g.due < today;
        return `<li class="rt-goal card${g.done ? " is-done" : ""}">` +
          `<button type="button" class="rt-g-head" data-rt="goal-edit" data-id="${esc(g.id)}">` +
            `<span class="rt-h-emo" aria-hidden="true">${esc(g.emoji)}</span>` +
            `<span class="rt-h-t"><b>${esc(g.title)}</b><small>${g.done ? "geschafft 🎉" : g.milestones.length ? `${g.milestones.filter((m) => m.done).length}/${g.milestones.length} Meilensteine` : "Fortschritt selbst eingeschätzt"}${dl && !g.done ? ` · <span class="${late ? "rt-late" : ""}">${esc(dl)}</span>` : ""}${g.due ? ` · bis ${esc(fmtDay(g.due))}` : ""}</small></span>` +
            `<span class="rt-pct">${p}%</span></button>` +
          `<div class="rt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}" aria-label="Fortschritt ${esc(g.title)}"><span style="width:${p}%"></span></div>` +
          (g.milestones.length ? `<ul class="rt-ms">${g.milestones.map((m) => `<li><label class="rt-check"><input type="checkbox" data-rt="ms-tick" data-g="${esc(g.id)}" data-ms="${esc(m.id)}"${m.done ? " checked" : ""}${g.done ? " disabled" : ""}><span>${esc(m.text)}</span></label></li>`).join("")}</ul>` : "") +
        `</li>`;
      }).join("")}</ul>`;
  }

  function openGoal(g) {
    const isNew = !g;
    const x = R.normGoal(g || {});
    ui.openSheet({
      title: isNew ? "🎯 Neues Ziel" : "Ziel bearbeiten",
      bodyHTML: `<div class="fields">` +
        `<label>Dein Ziel<input id="rt-g-title" maxlength="80" placeholder="z. B. Führerschein B" value="${esc(x.title)}"></label>` +
        `<label>Emoji<input id="rt-g-emo" maxlength="8" value="${esc(x.emoji)}" class="rt-emo-in"></label>` +
        `<div class="chips" data-r="emo">${GOAL_EMOJIS.map((e) => `<button type="button" class="chip" data-emo="${e}">${e}</button>`).join("")}</div>` +
        `<label>Bis wann? (optional)<input id="rt-g-due" type="date" value="${esc(x.due || "")}"></label>` +
        `<label>Meilensteine (einer pro Zeile)<textarea id="rt-g-ms" rows="5" maxlength="3000" placeholder="z. B.\nTheorie lernen\nFahrstunden\nPrüfung">${esc(x.milestones.map((m) => m.text).join("\n"))}</textarea></label>` +
        `<label data-man>Fortschritt ohne Meilensteine: <b data-pv>${x.progress}%</b><input id="rt-g-prog" type="range" min="0" max="100" step="5" value="${x.progress}"></label>` +
        `<label>Notiz (optional)<textarea id="rt-g-notes" rows="2" maxlength="1000">${esc(x.notes)}</textarea></label>` +
        (isNew ? "" : `<label class="switch"><span>🎉 Ziel erreicht</span><input type="checkbox" id="rt-g-done"${x.done ? " checked" : ""}></label>`) +
      `</div>` +
      `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        const syncMan = () => { $("[data-man]").hidden = !!$("#rt-g-ms").value.trim(); };
        syncMan();
        $("#rt-g-ms").addEventListener("input", syncMan);
        $("#rt-g-prog").addEventListener("input", () => { $("[data-pv]").textContent = $("#rt-g-prog").value + "%"; });
        $('[data-r="emo"]').addEventListener("click", (ev) => { const b = ev.target.closest("[data-emo]"); if (b) $("#rt-g-emo").value = b.dataset.emo; });
        $("[data-save]").addEventListener("click", () => {
          const title = $("#rt-g-title").value.trim();
          if (!title) { ui.toast("Bitte dein Ziel eintragen."); $("#rt-g-title").focus(); return; }
          const lines = $("#rt-g-ms").value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30);
          const milestones = lines.map((text) => { const old = x.milestones.find((m) => m.text === text); return old || { id: R.newItemId(), text: text.slice(0, 100), done: false, doneAt: null }; });
          const done = $("#rt-g-done") ? $("#rt-g-done").checked : false;
          close();
          safe(goals.put({ ...(g || {}), title, emoji: $("#rt-g-emo").value.trim() || "🎯", due: $("#rt-g-due").value || null, milestones,
            progress: Number($("#rt-g-prog").value) || 0, notes: $("#rt-g-notes").value.trim(), done, doneAt: done ? (x.doneAt || Date.now()) : null }),
            done && !x.done ? "🎉 Ziel erreicht – herzlichen Glückwunsch!" : isNew ? "🎯 Ziel gesetzt – du schaffst das!" : "Gespeichert ✓");
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", () => { close(); safe(goals.remove(g.id), "Gelöscht 🗑️"); });
      },
    });
  }

  /* ---------- Ereignisse ---------- */

  el.addEventListener("click", (ev) => {
    const tb = ev.target.closest("[data-tab]");
    if (tb) { S.tab = tb.dataset.tab; lsSet(TAB_KEY, S.tab); render(); return; }
    const b = ev.target.closest("[data-rt]");
    if (!b || b.tagName === "INPUT") return;
    const a = b.dataset.rt;
    const today = R.todayKey();
    if (a === "habit-new") openHabit(null);
    else if (a === "habit-edit") openHabit(habits.get(b.dataset.id));
    else if (a === "habit-tap") {
      const h = habits.get(b.dataset.id);
      if (!h) return;
      const x = R.normHabit(h);
      const log = R.tap(x, today);
      const after = { ...x, log };
      const was = R.streak(x, today).current;
      const st = R.streak(after, today);
      const msg = !R.openToday(after, today) && R.openToday(x, today) ? (st.current >= 3 && st.current > was ? `🔥 ${st.current} ${st.unit} am Stück – weiter so!` : `${x.emoji} Erledigt – gut gemacht!`) : "";
      safe(habits.patch(x.id, { log }), msg);
    } else if (a === "rout-edit") openRoutine(b.dataset.id);
    else if (a === "goal-new") openGoal(null);
    else if (a === "goal-edit") openGoal(goals.get(b.dataset.id));
  });
  el.addEventListener("change", (ev) => {
    const inp = ev.target.closest("input[data-rt]");
    if (!inp) return;
    const today = R.todayKey();
    if (inp.dataset.rt === "rout-tick") {
      const id = inp.dataset.r;
      const meta = R.ROUTINES.find((r) => r.id === id);
      const r = R.normRoutine(routines.get(id) || {}, id);
      const patch = R.toggleItem(r, inp.dataset.item, today);
      const complete = r.items.length && patch.doneIds.length === r.items.length;
      safe(routines.put({ ...r, ...patch, id, title: meta.title }), complete ? `${meta.e} ${meta.title} geschafft – stark! 🎉` : "");
    } else if (inp.dataset.rt === "ms-tick") {
      const g = goals.get(inp.dataset.g);
      if (!g) return;
      const patch = R.toggleMilestone(g, inp.dataset.ms);
      const p = R.goalProgress({ ...g, ...patch });
      safe(goals.patch(g.id, patch), p === 100 ? "🏁 Alle Meilensteine erledigt – Ziel als erreicht markieren? Tipp aufs Ziel." : inp.checked ? `✅ Meilenstein geschafft – ${p} %` : "");
    }
  });

  const offs = [habits.watch(queue), routines.watch(queue), goals.watch(queue)];
  render();
  return () => { alive = false; for (const o of offs) { try { o(); } catch { /* egal */ } } };
}
