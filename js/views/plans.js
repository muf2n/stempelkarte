// Geplante Schichten: Liste + Formular (settings.plans). Wird im Reiter „Orte“ oben eingehängt.
// Hilfsfunktionen (plansToday, dueTs, planKey) nutzt auch der Reiter „Heute“ für das Auto-Stempeln.
import { icon } from "../icons.js";

const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const DEFAULT_ACTS = ["Arbeiten", "Autofahren", "Material holen", "Büro"];

let C = null;
let root = null;
let snap = null;
let listKey = "";
let formHook = null;   // offenes Formular: bei Store-Änderung Orte neu zeichnen

/* ---------- Hilfen (auch für today.js) ---------- */

function hasCoords(p) {
  return !!p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

function pad(n) { return String(n).padStart(2, "0"); }
function dayKeyOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/** Gültige Pläne aus den Einstellungen. */
export function readPlans(settings) {
  const a = settings && settings.plans;
  return Array.isArray(a) ? a.filter((p) => p && p.id && /^\d{1,2}:\d{2}$/.test(String(p.time || ""))) : [];
}

/** Zeitpunkt (ms) der Planzeit am Tag von `ts`. */
export function dueTs(plan, ts = Date.now()) {
  const [h, m] = String(plan.time).split(":").map(Number);
  const d = new Date(ts);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/** Schlüssel wie im Server-pushlog: "planId:YYYY-MM-DD". */
export function planKey(planId, ts) { return `${planId}:${dayKeyOf(ts)}`; }

/** Gilt der Plan an diesem Tag (Wochentag bzw. Datum)? Ohne Feiertags-/Abwesenheitsprüfung. */
export function appliesOn(plan, ts) {
  if (!plan || plan.enabled === false) return false;
  const days = Array.isArray(plan.days) ? plan.days : [];
  if (days.length) return days.includes(new Date(ts).getDay());
  return !!plan.date && plan.date === dayKeyOf(ts);
}

/** Pläne, die heute gelten (kein Feiertag, keine Abwesenheit heute). */
export function plansToday(s, util, now = Date.now()) {
  const settings = (s && s.settings) || {};
  if (settings.holidays !== false && util && util.holidayName) {
    try { if (util.holidayName(now)) return []; } catch { /* egal */ }
  }
  const today = dayKeyOf(now);
  const absent = ((s && s.entries) || []).some((e) => e.kind && e.kind !== "work" && dayKeyOf(e.start) === today);
  if (absent) return [];
  return readPlans(settings).filter((p) => appliesOn(p, now));
}

function daysText(plan) {
  const days = Array.isArray(plan.days) ? plan.days : [];
  if (!days.length) {
    if (!plan.date) return "einmalig";
    const [y, m, d] = plan.date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return `einmalig · ${WD_SHORT[dt.getDay()]}, ${pad(d)}.${pad(m)}.${y}`;
  }
  const set = new Set(days);
  if (set.size === 7) return "täglich";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((x) => set.has(x))) return "Mo – Fr";
  return WD_ORDER.filter((x) => set.has(x)).map((x) => WD_SHORT[x]).join(", ");
}

function activities() {
  const a = snap && snap.settings && snap.settings.activities;
  const list = Array.isArray(a) && a.length ? a.filter((x) => typeof x === "string" && x.trim()) : DEFAULT_ACTS;
  return list.length ? list : DEFAULT_ACTS;
}

async function savePlans(list) {
  await C.store.saveSettings({ plans: list });
}

/* ---------- Karte ---------- */

export function mount(el, ctx) {
  C = ctx;
  root = el;
  el.innerHTML =
    `<div class="card plans-card">` +
      `<div class="section-h"><h2 class="h-ico">${icon("clock", 24)}<span>Geplante Schichten</span></h2>` +
        `<button type="button" class="btn sm primary" data-r="pl-add">${icon("plus", 18)}<span>Schicht planen</span></button></div>` +
      `<p class="note plans-limit">Zur geplanten Zeit bekommst du eine Benachrichtigung. Ein Tipp genügt: Bist du am Ort, stempelt die App dich automatisch ein. ` +
        `Ohne geöffnete App kann der Standort nicht geprüft werden – daher der eine Tipp.</p>` +
      `<div class="plans-list" data-r="pl-list"></div>` +
    `</div>`;
  el.querySelector("[data-r=pl-add]").addEventListener("click", () => openPlanForm(null, C));
  el.querySelector("[data-r=pl-list]").addEventListener("click", onListClick);
  el.querySelector("[data-r=pl-list]").addEventListener("change", onListChange);
  snap = ctx.store.get ? ctx.store.get() : null;
  render();
}

export function update(s) {
  snap = s;
  if (root) render();
  if (formHook) { try { formHook(s); } catch (e) { console.error(e); } }
}

function render() {
  if (!root || !C) return;
  const { esc } = C.util;
  const plans = readPlans(snap && snap.settings);
  const places = (snap && snap.places) || [];
  const key = JSON.stringify([plans, places.map((p) => [p.id, p.name, hasCoords(p)])]);
  if (key === listKey) return;
  listKey = key;
  const box = root.querySelector("[data-r=pl-list]");
  if (!plans.length) {
    box.innerHTML = `<p class="note plans-empty">Noch keine Schicht geplant. Lege z. B. „Mo – Fr, 07:00 bei Baustelle Linz“ an.</p>`;
    return;
  }
  const sorted = plans.slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
  box.innerHTML = sorted.map((p) => {
    const pl = places.find((x) => x.id === p.placeId);
    const name = (pl && pl.name) || p.place || "Ort gelöscht";
    const days = Array.isArray(p.days) ? p.days : [];
    const chips = days.length
      ? `<span class="plan-days">${WD_ORDER.map((d) => `<i class="${days.includes(d) ? "on" : ""}">${WD_SHORT[d]}</i>`).join("")}</span>`
      : `<span class="plan-once">${esc(daysText(p))}</span>`;
    const warn = !pl ? `<span class="plan-warn">Ort existiert nicht mehr</span>`
      : !hasCoords(pl) ? `<span class="plan-warn">Ort ohne Position – dort einmal „Meinen Standort übernehmen“</span>` : "";
    return `<div class="plan-item${p.enabled === false ? " off" : ""}" data-id="${esc(p.id)}">` +
      `<button type="button" class="plan-main" data-act="edit">` +
        `<span class="plan-time">${esc(p.time)}</span>` +
        `<span class="plan-txt"><b>${esc(name)}</b><span class="plan-sub">${esc(p.activity || "Arbeiten")}</span>${chips}${warn}</span>` +
      `</button>` +
      `<div class="plan-side">` +
        `<label class="switch plan-sw" title="Plan aktiv"><input type="checkbox" data-act="toggle"${p.enabled === false ? "" : " checked"} aria-label="Plan aktiv"></label>` +
        `<button type="button" class="plan-del" data-act="del" aria-label="Plan löschen">✕</button>` +
      `</div></div>`;
  }).join("");
}

function onListClick(ev) {
  const b = ev.target.closest("button[data-act]");
  if (!b) return;
  const item = b.closest(".plan-item");
  const plan = readPlans(snap && snap.settings).find((p) => p.id === (item && item.dataset.id));
  if (!plan) return;
  if (b.dataset.act === "edit") openPlanForm(plan, C);
  else if (b.dataset.act === "del") {
    if (b.dataset.armed) {
      savePlans(readPlans(snap.settings).filter((p) => p.id !== plan.id))
        .then(() => C.ui.toast("Plan gelöscht."), () => {});
      return;
    }
    b.dataset.armed = "1";
    b.textContent = "Löschen?";
    setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "✕"; } }, 4000);
  }
}

function onListChange(ev) {
  const inp = ev.target.closest("input[data-act=toggle]");
  if (!inp) return;
  const id = inp.closest(".plan-item").dataset.id;
  const list = readPlans(snap && snap.settings).map((p) => (p.id === id ? { ...p, enabled: inp.checked } : p));
  savePlans(list).then(() => C.ui.toast(inp.checked ? "Plan aktiv." : "Plan pausiert."), () => {});
}

/* ---------- Formular ---------- */

/** Plan anlegen/bearbeiten. `preset` = { placeId } (z. B. aus dem Ortsformular). */
export function openPlanForm(plan, ctx, preset = null) {
  const c = ctx || C;
  if (!C) C = c;
  const { esc } = c.util;
  const s0 = c.store.get();
  if (!snap) snap = s0;
  const isNew = !plan;
  const st = {
    placeId: (plan && plan.placeId) || (preset && preset.placeId) || null,
    time: (plan && plan.time) || "07:00",
    once: !!plan && !(Array.isArray(plan.days) && plan.days.length),
    days: plan && Array.isArray(plan.days) && plan.days.length ? plan.days.slice() : [1, 2, 3, 4, 5],
    date: (plan && plan.date) || dayKeyOf(Date.now()),
    activity: (plan && plan.activity) || "Arbeiten",
  };
  let knownPlaceIds = new Set(((s0 && s0.places) || []).map((p) => p.id));
  if (!st.placeId && s0.places && s0.places.length === 1) st.placeId = s0.places[0].id;

  const bodyHTML =
    `<div class="fields plan-form">` +
      `<div><div class="lbl lbl-ico">${icon("pin", 20)}<span>Ort</span></div>` +
        `<div class="chips" data-r="places"></div>` +
        `<p class="hint" data-r="nocoords" hidden></p></div>` +
      `<label>Beginn um<input type="time" data-r="time" value="${esc(st.time)}" step="300" required></label>` +
      `<div><div class="lbl">Wiederholung</div>` +
        `<div class="chips plan-mode" data-r="mode">` +
          `<button type="button" class="chip" data-m="week">Jede Woche</button>` +
          `<button type="button" class="chip" data-m="once">Einmalig</button></div></div>` +
      `<div class="chips plan-wd" data-r="days">${WD_ORDER.map((d) => `<button type="button" class="chip" data-d="${d}">${WD_SHORT[d]}</button>`).join("")}</div>` +
      `<label data-r="datewrap">Datum<input type="date" data-r="date" value="${esc(st.date)}"></label>` +
      `<div><div class="lbl lbl-ico">${icon("briefcase", 20)}<span>Tätigkeit</span></div>` +
        `<div class="chips" data-r="acts"></div></div>` +
      `<p class="note plan-info" data-r="info"></p>` +
    `</div>` +
    `<div class="stack" style="margin-top:14px">` +
      `<button type="button" class="btn primary" data-r="save">Speichern</button>` +
      (isNew ? "" : `<button type="button" class="btn danger" data-r="del">Plan löschen</button>`) +
    `</div>`;

  c.ui.openSheet({
    title: isNew ? "Schicht planen" : "Geplante Schicht",
    bodyHTML,
    onMount(sheet, close) {
      const $ = (r) => sheet.querySelector(`[data-r="${r}"]`);
      let locating = false;

      const places = () => (c.store.get().places || []);
      const drawPlaces = () => {
        const ps = places();
        $("places").innerHTML = ps.map((p) =>
          `<button type="button" class="chip" data-id="${esc(p.id)}" aria-pressed="${p.id === st.placeId}">${esc(p.name || "Ohne Namen")}</button>`
        ).join("") +
          `<button type="button" class="chip add" data-id=""${locating ? " disabled" : ""}>${locating ? "Standort wird ermittelt …" : `${icon("plus", 18)}<span>Neuer Ort hier</span>`}</button>`;
        const sel = ps.find((p) => p.id === st.placeId);
        const nc = $("nocoords");
        nc.textContent = sel && !hasCoords(sel)
          ? `„${sel.name}“ hat noch keine Position. Öffne den Ort einmal vor Ort und tippe „Meinen Standort übernehmen“ – sonst kann die App nicht automatisch einstempeln.`
          : "";
        nc.hidden = !nc.textContent;
      };
      const drawMode = () => {
        $("mode").querySelectorAll("[data-m]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.m === "once") === st.once)));
        $("days").hidden = st.once;
        $("datewrap").hidden = !st.once;
        $("days").querySelectorAll("[data-d]").forEach((b) => b.setAttribute("aria-pressed", String(st.days.includes(Number(b.dataset.d)))));
      };
      const drawActs = () => {
        const list = activities();
        if (!list.includes(st.activity)) list.push(st.activity);
        $("acts").innerHTML = list.map((a) =>
          `<button type="button" class="chip" data-a="${esc(a)}" aria-pressed="${a === st.activity}">${esc(a)}</button>`).join("");
      };
      const drawInfo = () => {
        $("info").textContent = `Um ${st.time || "–"} bekommst du eine Benachrichtigung. Ein Tipp genügt: Bist du am Ort, stempelt die App dich automatisch ein. ` +
          `Ist die App gerade offen, stempelt sie dich zur Planzeit von selbst ein.`;
      };
      drawPlaces(); drawMode(); drawActs(); drawInfo();

      // Neuer Ort gespeichert (Ortsformular liegt über diesem Blatt) → automatisch auswählen
      formHook = (s) => {
        if (!sheet.isConnected) { formHook = null; return; }
        const ids = (s.places || []).map((p) => p.id);
        const fresh = ids.filter((id) => !knownPlaceIds.has(id));
        knownPlaceIds = new Set(ids);
        if (fresh.length) st.placeId = fresh[0];
        if (st.placeId && !ids.includes(st.placeId)) st.placeId = null;
        drawPlaces();
      };

      $("places").addEventListener("click", async (ev) => {
        const b = ev.target.closest("button.chip");
        if (!b || b.disabled) return;
        if (b.dataset.id) { st.placeId = b.dataset.id; drawPlaces(); return; }
        // „+ Neuer Ort hier“
        locating = true; drawPlaces();
        let loc = null;
        try { loc = await c.geo.getPosition({ timeout: 12000, maxAge: 5000 }); }
        catch (e) { c.ui.toast(((e && e.message) || "Standort nicht verfügbar") + " – du kannst die Adresse von Hand eintragen.", 3500); }
        locating = false; drawPlaces();
        c.openPlaceForm(null, loc);
      });
      $("mode").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-m]");
        if (!b) return;
        st.once = b.dataset.m === "once";
        drawMode();
      });
      $("days").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-d]");
        if (!b) return;
        const d = Number(b.dataset.d);
        st.days = st.days.includes(d) ? st.days.filter((x) => x !== d) : [...st.days, d].sort();
        drawMode();
      });
      $("acts").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-a]");
        if (!b) return;
        st.activity = b.dataset.a;
        drawActs();
      });
      $("time").addEventListener("input", () => { st.time = $("time").value; drawInfo(); });
      $("date").addEventListener("input", () => { st.date = $("date").value; });

      const saveBtn = $("save");
      saveBtn.addEventListener("click", async () => {
        const place = places().find((p) => p.id === st.placeId);
        if (!place) { c.ui.toast("Bitte einen Ort wählen."); return; }
        const t = $("time").value || "";
        if (!/^\d{1,2}:\d{2}$/.test(t)) { c.ui.toast("Bitte eine Uhrzeit eingeben."); return; }
        if (!st.once && !st.days.length) { c.ui.toast("Bitte mindestens einen Wochentag wählen."); return; }
        if (st.once && !/^\d{4}-\d{2}-\d{2}$/.test(st.date || "")) { c.ui.toast("Bitte ein Datum wählen."); return; }
        const data = {
          id: (plan && plan.id) || c.util.newId("pl"),
          placeId: place.id,
          place: place.name || "",
          time: t.length === 4 ? "0" + t : t,
          days: st.once ? [] : st.days.slice().sort(),
          date: st.once ? st.date : null,
          activity: st.activity || "Arbeiten",
          enabled: plan ? plan.enabled !== false : true,
        };
        const list = readPlans(c.store.get().settings);
        const i = list.findIndex((p) => p.id === data.id);
        if (i >= 0) list[i] = data; else list.push(data);
        c.ui.setBusy(saveBtn, true, "Speichert …");
        try {
          await savePlans(list);
          formHook = null;
          close();
          c.ui.toast(hasCoords(place) ? `Geplant: ${daysText(data)}, ${data.time} · ${place.name}` : "Geplant – der Ort braucht noch eine Position.", 3200);
        } catch { c.ui.setBusy(saveBtn, false); }
      });

      const delBtn = $("del");
      if (delBtn) {
        c.ui.confirmButton(delBtn, "Wirklich löschen?", async () => {
          try {
            await savePlans(readPlans(c.store.get().settings).filter((p) => p.id !== plan.id));
            formHook = null;
            close();
            c.ui.toast("Plan gelöscht.");
          } catch { /* Toast kommt vom Store */ }
        });
      }
    },
  });
}
