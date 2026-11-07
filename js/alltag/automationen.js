// Update 10 – Alltag › ⚡ Automationen (#alltag/automationen): eigene „WENN → (BEDINGUNG) → DANN“-Regeln ohne Code
// aus einem festen Katalog (js/automation-core.js), Vorlagen mit einem Tipp, Ein/Aus, Bearbeiten, Duplizieren, Löschen,
// Verlauf der letzten 100 Läufe mit Fehleranzeige. Ausgeführt wird in der App (js/automation.js) – nie auf dem Server.
import { collection } from "./db.js";
import * as AC from "../automation-core.js";
import * as ui from "../ui.js";
import * as store from "../store.js";
import { esc, clock } from "../util.js";

const TAB_KEY = "sk-au-tab";
const TABS = [["regeln", "⚡", "Meine Regeln"], ["vorlagen", "✨", "Vorlagen"], ["verlauf", "📜", "Verlauf"]];
const EMOJIS = ["⚡", "📍", "🧰", "📒", "📆", "🎓", "🏡", "🔔", "⏰", "🛒", "💶", "🌴", "☕", "💪", "🚗", "📸"];
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const places = () => { const s = store.get() || {}; return (Array.isArray(s.places) ? s.places : []).filter((p) => p && p.id); };
const WDS = [[1, "Mo"], [2, "Di"], [3, "Mi"], [4, "Do"], [5, "Fr"], [6, "Sa"], [0, "So"]];

function injectCSS() {
  if (document.getElementById("au-css")) return;
  const l = document.createElement("link");
  l.id = "au-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-automationen.css", import.meta.url).href;
  document.head.appendChild(l);
}

function ago(ts, now = Date.now()) {
  const d = now - ts;
  if (d < 60000) return "gerade eben";
  if (d < 3600e3) return `vor ${Math.round(d / 60000)} Min`;
  const day = new Date(ts); const t = new Date(now);
  if (day.toDateString() === t.toDateString()) return `heute ${clock(ts)}`;
  const y = new Date(now - 86400000);
  if (day.toDateString() === y.toDateString()) return `gestern ${clock(ts)}`;
  return `${String(day.getDate()).padStart(2, "0")}.${String(day.getMonth() + 1).padStart(2, "0")}. ${clock(ts)}`;
}

export function mount(el) {
  injectCSS();
  const rules = collection("automations");
  const logs = collection("automation_log");
  let tab = TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "";
  let alive = true, queued = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };

  el.innerHTML = `<div class="au">
      <div class="au-hero card">
        <div class="au-hero-ic" aria-hidden="true">⚡</div>
        <div><h3>Deine Automationen</h3><p class="note">WENN etwas passiert → (nur WENN es passt) → DANN erledigt die App den Kleinkram für dich. Läuft, solange die App offen ist – ganz ohne Code 🙌</p></div>
      </div>
      <div class="au-tabs" role="tablist" aria-label="Automationen">${TABS.map(([id, e, t]) => `<button type="button" class="au-tab" role="tab" data-tab="${id}"><span aria-hidden="true">${e}</span> ${t}</button>`).join("")}</div>
      <div class="au-page" data-au="page"></div>
    </div>`;
  const pageEl = el.querySelector('[data-au="page"]');

  function sortedRules() { return rules.all().map(AC.normRule).filter((r) => r.id).sort((a, b) => (b.enabled - a.enabled) || ((b.created || 0) - (a.created || 0))); }
  function lastLogOf(id) { let best = null; for (const l of logs.all()) if (l && l.ruleId === id && (!best || l.ts > best.ts)) best = l; return best; }

  function render() {
    const list = sortedRules();
    if (!tab) tab = list.length ? "regeln" : "vorlagen";
    el.querySelectorAll(".au-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    if (!rules.loaded) { pageEl.innerHTML = `<p class="note au-load">Lade deine Regeln …</p>`; return; }
    if (tab === "vorlagen") pageEl.innerHTML = templatesHTML(list);
    else if (tab === "verlauf") pageEl.innerHTML = historyHTML();
    else pageEl.innerHTML = rulesHTML(list);
  }

  function rulesHTML(list) {
    const head = `<div class="au-bar"><span class="note">${list.length ? `${list.filter((r) => r.enabled).length} von ${list.length} aktiv` : ""}</span><button type="button" class="btn primary sm" data-au="new">＋ Neue Regel</button></div>`;
    if (!list.length) return head + `<div class="au-empty"><div class="au-empty-ic" aria-hidden="true">🌱</div><b>Noch keine Automation</b><p class="note">Fang am besten mit einer Vorlage an – ein Tipp und sie läuft.</p><button type="button" class="btn ghost sm" data-tab="vorlagen">✨ Vorlagen ansehen</button></div>`;
    const pl = places();
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    return head + `<ul class="au-list">${list.map((r) => {
      const last = lastLogOf(r.id);
      const runsToday = logs.all().filter((l) => l && l.ruleId === r.id && l.ts >= today0.getTime()).length;
      const status = last ? `${last.ok ? "✅" : "⚠️"} zuletzt ${ago(last.ts)} · ${r.runs}× gelaufen` : r.enabled ? "⏳ Wartet auf den ersten Anlass" : "💤 Pausiert";
      return `<li class="au-rule card${r.enabled ? "" : " off"}" data-id="${esc(r.id)}">
        <div class="au-rh">
          <span class="au-re" aria-hidden="true">${esc(r.emoji)}</span>
          <b class="au-rn">${esc(r.name)}</b>
          <label class="switch au-sw"><span class="sr">${esc(r.name)} ${r.enabled ? "ausschalten" : "einschalten"}</span><input type="checkbox" data-toggle="${esc(r.id)}"${r.enabled ? " checked" : ""}></label>
        </div>
        <div class="au-flow">
          <div class="au-step"><span class="au-k">WENN</span><span>${esc((AC.triggerById(r.trigger.type) || {}).e || "")} ${esc(AC.triggerText(r.trigger, pl))}</span></div>
          ${r.conds.length ? `<div class="au-step"><span class="au-k">NUR</span><span>${r.conds.map((c) => esc(AC.condText(c, pl))).join(" · ")}</span></div>` : ""}
          <div class="au-step"><span class="au-k">DANN</span><span>${r.actions.map((a) => esc(AC.actionText(a))).join("<br>")}</span></div>
        </div>
        <p class="au-st note">${esc(status)}${runsToday >= r.maxPerDay ? ` · 🛑 Tageslimit (${r.maxPerDay}) erreicht` : ""}</p>
        ${last && !last.ok && last.error ? `<p class="au-err" role="status">⚠️ ${esc(last.error)}</p>` : ""}
        <div class="au-acts">
          <button type="button" class="btn ghost sm" data-edit="${esc(r.id)}">✏️ Bearbeiten</button>
          <button type="button" class="btn ghost sm" data-dup="${esc(r.id)}">📄 Duplizieren</button>
          <button type="button" class="btn danger sm" data-del="${esc(r.id)}">🗑️ Löschen</button>
        </div>
      </li>`;
    }).join("")}</ul>`;
  }

  function templatesHTML(list) {
    const used = new Set(list.map((r) => r.tpl).filter(Boolean));
    return `<p class="note au-intro">Fertige Ideen zum Loslegen – du kannst sie danach jederzeit anpassen. ✨</p><div class="au-tpls">${AC.TEMPLATES.map((t) => `
      <article class="au-tpl card">
        <div class="au-tpl-e" aria-hidden="true">${esc(t.emoji)}</div>
        <b>${esc(t.name)}</b>
        <p class="note">${esc(t.d)}</p>
        ${used.has(t.tpl) ? `<span class="au-on">✔️ Aktiv</span>` : `<button type="button" class="btn primary sm" data-tpl="${esc(t.tpl)}">⚡ Aktivieren</button>`}
      </article>`).join("")}</div>`;
  }

  function historyHTML() {
    const list = logs.all().filter((l) => l && l.id).sort((a, b) => b.ts - a.ts).slice(0, AC.LOG_MAX);
    if (!logs.loaded) return `<p class="note au-load">Lade den Verlauf …</p>`;
    if (!list.length) return `<div class="au-empty"><div class="au-empty-ic" aria-hidden="true">📜</div><b>Noch nichts passiert</b><p class="note">Sobald eine Automation läuft, siehst du hier, was sie gemacht hat.</p></div>`;
    return `<div class="au-bar"><span class="note">Die letzten ${list.length} Läufe</span><button type="button" class="btn ghost sm" data-au="clear">🧹 Verlauf leeren</button></div>
      <ul class="au-log">${list.map((l) => `<li class="au-li${l.ok ? "" : " bad"}">
        <span class="au-li-ic" aria-hidden="true">${l.ok ? "✅" : "⚠️"}</span>
        <div class="au-li-tx"><b>${esc(l.emoji || "⚡")} ${esc(l.name || "Automation")}</b><small>${esc(ago(l.ts))}</small>
          ${(l.done || []).length ? `<ul class="au-done">${l.done.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
          ${l.ok ? "" : `<p class="au-err">${esc(l.error || "Unbekannter Fehler")}</p>`}</div>
      </li>`).join("")}</ul>`;
  }

  async function activateTemplate(id, btn) {
    const r = AC.fromTemplate(id, Date.now());
    if (!r) return;
    if (btn) ui.setBusy(btn, true, "…");
    try {
      await rules.put({ ...r, id: undefined });
      ui.toast(`⚡ „${r.name}“ ist aktiv!`);
      window.dispatchEvent(new Event("sk:automation-check"));
    } catch (err) { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); if (btn) ui.setBusy(btn, false); }
  }

  async function toggle(id, on) {
    const cur = rules.get(id);
    if (!cur) return;
    try {
      await rules.patch(id, { enabled: on, enabledAt: on ? Date.now() : cur.enabledAt || 0 });
      ui.toast(on ? "⚡ Eingeschaltet" : "💤 Pausiert", 1600);
      window.dispatchEvent(new Event("sk:automation-check"));
    } catch (err) { console.error(err); ui.toast("Speichern hat nicht geklappt."); }
  }

  el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b || !el.contains(b)) return;
    if (b.dataset.tab) { tab = b.dataset.tab; lsSet(TAB_KEY, tab); render(); return; }
    if (b.dataset.au === "new") { openEditor(null); return; }
    if (b.dataset.tpl) { activateTemplate(b.dataset.tpl, b); return; }
    if (b.dataset.edit) { const r = rules.get(b.dataset.edit); if (r) openEditor(AC.normRule(r)); return; }
    if (b.dataset.dup) {
      const r = rules.get(b.dataset.dup);
      if (!r) return;
      const copy = AC.duplicateRule(r);
      try { await rules.put({ ...copy, id: undefined }); ui.toast("📄 Kopie angelegt (pausiert) – pass sie an und schalte sie ein."); } catch (err) { console.error(err); ui.toast("Kopieren hat nicht geklappt."); }
      return;
    }
    if (b.dataset.del) {
      if (!b.dataset.armed) {
        b.dataset.armed = "1"; b.textContent = "Wirklich löschen?";
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "🗑️ Löschen"; } }, 4000);
        return;
      }
      try { await rules.remove(b.dataset.del); ui.toast("🗑️ Automation gelöscht"); } catch (err) { console.error(err); ui.toast("Löschen hat nicht geklappt."); }
      return;
    }
    if (b.dataset.au === "clear") {
      if (!b.dataset.armed) {
        b.dataset.armed = "1"; b.textContent = "Wirklich leeren?";
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "🧹 Verlauf leeren"; } }, 4000);
        return;
      }
      // Schlüssel bleiben in den Regeln gemerkt (seen) → nichts läuft dadurch doppelt
      for (const l of logs.all()) logs.remove(l.id).catch(() => { /* egal */ });
      ui.toast("🧹 Verlauf geleert");
    }
  });
  el.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t instanceof HTMLInputElement && t.dataset.toggle) toggle(t.dataset.toggle, t.checked);
  });

  const offs = [rules.watch(queue), logs.watch(queue)];
  render();
  return () => { alive = false; for (const o of offs) { try { o(); } catch { /* egal */ } } };
}

/* ---------- Editor ---------- */

function openEditor(existing) {
  const col = collection("automations");
  const d = existing ? JSON.parse(JSON.stringify(existing)) : AC.normRule({ trigger: { type: "clock_in" }, actions: [{ type: "hint", text: "" }], enabled: true });
  if (!existing) { d.name = ""; d.emoji = "⚡"; }
  const pl = places();
  const plOpts = (cur, any) => (any ? `<option value="">📍 Jeder Ort</option>` : `<option value="">– Ort wählen –</option>`) + pl.map((p) => `<option value="${esc(p.id)}"${p.id === cur ? " selected" : ""}>${esc(p.name || "Ort")}</option>`).join("");
  const wdChips = (days, attr) => `<div class="chips au-wd" role="group" aria-label="Wochentage">${WDS.map(([v, l]) => `<button type="button" class="chip" ${attr}="${v}" aria-pressed="${days.includes(v)}">${l}</button>`).join("")}</div>`;

  function trigParams() {
    const t = d.trigger;
    switch (t.type) {
      case "site": return `<label>Ort<select data-f="t.placeId">${plOpts(t.placeId, true)}</select></label>`;
      case "termin": return `<div class="au-row"><label>Wie lange vorher<input type="number" min="1" max="999" inputmode="numeric" data-f="t.amount" value="${t.amount}"></label><label>Einheit<select data-f="t.unit"><option value="min"${t.unit === "min" ? " selected" : ""}>Minuten</option><option value="h"${t.unit === "h" ? " selected" : ""}>Stunden</option></select></label></div>`;
      case "budget": return `<label>Wann<select data-f="t.level"><option value="warn"${t.level === "warn" ? " selected" : ""}>⚠️ Fast aufgebraucht (ab 80 %)</option><option value="limit"${t.level === "limit" ? " selected" : ""}>🛑 Aufgebraucht</option></select></label><p class="note">🔐 Bei aktiver Geld-Sperre wird das nicht geprüft – und Beträge kommen nie in die Texte.</p>`;
      case "month_end": return `<div class="au-row"><label>Tage vor Monatsende<input type="number" min="0" max="7" inputmode="numeric" data-f="t.days" value="${t.days}"></label><label>Uhrzeit<input type="time" data-f="t.time" value="${esc(t.time)}"></label></div>`;
      case "month_start": return `<label>Uhrzeit<input type="time" data-f="t.time" value="${esc(t.time)}"></label>`;
      case "weekly": return `${wdChips(t.days, "data-twd")}<label>Uhrzeit<input type="time" data-f="t.time" value="${esc(t.time)}"></label>`;
      case "exam": return `<label>Tage vorher<input type="number" min="0" max="60" inputmode="numeric" data-f="t.days" value="${t.days}"></label>`;
      case "vacation": return `<label>Tage vorher<input type="number" min="0" max="14" inputmode="numeric" data-f="t.days" value="${t.days}"></label>`;
      case "material": return `<p class="note">Gilt für Material, das ab jetzt auf „brauche“ gesetzt wird.</p>`;
      default: return "";
    }
  }
  function condHTML(c, i) {
    let body = "";
    if (c.type === "weekday") body = wdChips(c.days || [], `data-cwd="${i}" data-v`);
    else if (c.type === "time") body = `<div class="au-row"><label>Von<input type="time" data-f="c.${i}.from" value="${esc(c.from || "06:00")}"></label><label>Bis<input type="time" data-f="c.${i}.to" value="${esc(c.to || "18:00")}"></label></div>`;
    else if (c.type === "place") body = `<label>Ort<select data-f="c.${i}.placeId">${plOpts(c.placeId, false)}</select></label>`;
    else if (c.type === "mode") body = `<div class="chips"><button type="button" class="chip" data-cmode="${i}" data-v="arbeit" aria-pressed="${c.mode !== "privat"}">🔧 Arbeit</button><button type="button" class="chip" data-cmode="${i}" data-v="privat" aria-pressed="${c.mode === "privat"}">🏡 Privat</button></div>`;
    const meta = AC.CONDS.find((x) => x.id === c.type) || {};
    return `<div class="au-ed-item"><div class="au-ed-ih"><b>${esc(meta.e || "")} ${esc(meta.t || "")}</b><button type="button" class="au-x" data-rmc="${i}" aria-label="Bedingung entfernen">✕</button></div>${body}</div>`;
  }
  function actionHTML(a, i) {
    let body = "";
    if (a.type === "hint") body = `<label>Text<input type="text" maxlength="${AC.TEXT_MAX}" data-f="a.${i}.text" value="${esc(a.text || "")}" placeholder="z. B. Denk an die Fotos von {ort} 📸"></label>`;
    else if (a.type === "task") body = `<label>Aufgabe<input type="text" maxlength="${AC.TEXT_MAX}" data-f="a.${i}.text" value="${esc(a.text || "")}" placeholder="z. B. Stunden für {name} kontrollieren"></label><label>Fällig<select data-f="a.${i}.when"><option value="today"${a.when !== "tomorrow" ? " selected" : ""}>Heute</option><option value="tomorrow"${a.when === "tomorrow" ? " selected" : ""}>Morgen</option></select></label>`;
    else if (a.type === "open") body = `<label>Welche Seite<select data-f="a.${i}.target">${AC.OPEN_TARGETS.map(([v, l]) => `<option value="${esc(v)}"${a.target === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label><p class="note">Kommt als Mitteilung – ein Tipp darauf öffnet die Seite.</p>`;
    else if (a.type === "mode") body = `<div class="chips"><button type="button" class="chip" data-amode="${i}" data-v="privat" aria-pressed="${a.mode !== "arbeit"}">🏡 Privat</button><button type="button" class="chip" data-amode="${i}" data-v="arbeit" aria-pressed="${a.mode === "arbeit"}">🔧 Arbeit</button></div><p class="note">Während du eingestempelt bist, bleibt's beim Arbeitsmodus.</p>`;
    else if (a.type === "report") body = `<label>Bericht<select data-f="a.${i}.kind"><option value="week"${a.kind !== "month" ? " selected" : ""}>📒 Wochenbericht</option><option value="month"${a.kind === "month" ? " selected" : ""}>📊 Monatsbericht</option></select></label>`;
    else if (a.type === "learn") body = `<label>Wohin<select data-f="a.${i}.to"><option value="schule"${a.to !== "lap" ? " selected" : ""}>📚 Schule & Lernen</option><option value="lap"${a.to === "lap" ? " selected" : ""}>🎓 LAP Elektrotechnik</option></select></label>`;
    else if (a.type === "einkauf") body = `<p class="note">Landet auf „🏗️ Baustelle“ – doppelte Einträge werden übersprungen.</p>`;
    const meta = AC.actionById(a.type) || {};
    return `<div class="au-ed-item"><div class="au-ed-ih"><b>${esc(meta.e || "")} ${esc(meta.t || "")}</b><button type="button" class="au-x" data-rma="${i}" aria-label="Aktion entfernen">✕</button></div>${body}</div>`;
  }

  ui.openSheet({
    title: existing ? "✏️ Automation bearbeiten" : "⚡ Neue Automation",
    bodyHTML: `<div class="au-ed fields" data-ed></div>`,
    onMount(sheet, close) {
      const host = sheet.querySelector("[data-ed]");
      function draw(focusSel) {
        const fitting = AC.ACTIONS.filter((a) => AC.actionFits(a.id, d.trigger.type));
        host.innerHTML = `
          <div class="au-row au-name"><label class="au-em">Symbol<select data-f="emoji">${EMOJIS.map((e) => `<option${e === d.emoji ? " selected" : ""}>${e}</option>`).join("")}</select></label>
            <label>Name<input type="text" maxlength="${AC.NAME_MAX}" data-f="name" value="${esc(d.name)}" placeholder="z. B. Feierabend"></label></div>
          <section class="au-sec"><h4><span class="au-k">WENN</span> das passiert</h4>
            <label><span class="sr">Auslöser</span><select data-f="t.type" id="au-trigger">${AC.TRIGGERS.map((t) => `<option value="${t.id}"${t.id === d.trigger.type ? " selected" : ""}>${t.e} ${esc(t.t)}</option>`).join("")}</select></label>
            <p class="note">${esc((AC.triggerById(d.trigger.type) || {}).d || "")}</p>
            ${trigParams()}
          </section>
          <section class="au-sec"><h4><span class="au-k">NUR</span> wenn (optional)</h4>
            ${d.conds.map(condHTML).join("")}
            ${d.conds.length < 4 ? `<label><span class="sr">Bedingung hinzufügen</span><select data-addc><option value="">＋ Bedingung hinzufügen …</option>${AC.CONDS.map((c) => `<option value="${c.id}">${c.e} ${esc(c.t)}</option>`).join("")}</select></label>` : ""}
          </section>
          <section class="au-sec"><h4><span class="au-k">DANN</span> mach das</h4>
            ${d.actions.map(actionHTML).join("")}
            ${d.actions.length < 6 ? `<label><span class="sr">Aktion hinzufügen</span><select data-adda><option value="">＋ Aktion hinzufügen …</option>${fitting.map((a) => `<option value="${a.id}">${a.e} ${esc(a.t)}</option>`).join("")}</select></label>` : ""}
            <p class="note">💡 Platzhalter im Text: <code>{name}</code> (Aufgabe, Termin, Material …), <code>{ort}</code>, <code>{datum}</code></p>
          </section>
          <label>Höchstens so oft pro Tag<input type="number" min="1" max="${AC.MAX_PER_DAY_LIMIT}" inputmode="numeric" data-f="maxPerDay" value="${d.maxPerDay}"></label>
          <div class="au-errs" data-errs role="alert" hidden></div>
          <div class="row"><button type="button" class="btn ghost" data-cancel>Abbrechen</button><button type="button" class="btn primary" data-save>💾 Speichern</button></div>`;
        if (focusSel) { const f = host.querySelector(focusSel); if (f) try { f.focus({ preventScroll: true }); } catch { /* egal */ } }
      }
      const setPath = (path, val) => {
        const [k, i, f] = path.split(".");
        if (k === "name" || k === "emoji") d[k] = val;
        else if (k === "maxPerDay") d.maxPerDay = val;
        else if (k === "t") {
          if (i === "type") { d.trigger = AC.normRule({ trigger: { type: val } }).trigger; d.actions = d.actions.filter((a) => AC.actionFits(a.type, val)); draw("#au-trigger"); return; }
          d.trigger[i] = val;
        } else if (k === "c") d.conds[+i][f] = val;
        else if (k === "a") d.actions[+i][f] = val;
      };
      host.addEventListener("input", (ev) => { const t = ev.target; if (t.dataset && t.dataset.f && t.tagName === "INPUT") setPath(t.dataset.f, t.value); });
      host.addEventListener("change", (ev) => {
        const t = ev.target;
        if (t.dataset.f) { setPath(t.dataset.f, t.value); return; }
        if (t.hasAttribute("data-addc") && t.value) {
          const type = t.value;
          d.conds.push(type === "weekday" ? { type, days: [1, 2, 3, 4, 5] } : type === "time" ? { type, from: "06:00", to: "18:00" } : type === "place" ? { type, placeId: (pl[0] && pl[0].id) || "" } : { type, mode: "arbeit" });
          draw("[data-addc]"); return;
        }
        if (t.hasAttribute("data-adda") && t.value) {
          const type = t.value;
          d.actions.push(type === "hint" || type === "task" ? { type, text: "", when: "today" } : type === "open" ? { type, target: "auto" } : type === "mode" ? { type, mode: "privat" } : type === "report" ? { type, kind: "week" } : type === "learn" ? { type, to: "schule" } : { type });
          draw("[data-adda]");
        }
      });
      host.addEventListener("click", async (ev) => {
        const b = ev.target.closest("button");
        if (!b) return;
        const toggleDay = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v].sort());
        if (b.dataset.twd != null) { d.trigger.days = toggleDay(d.trigger.days || [], +b.dataset.twd); b.setAttribute("aria-pressed", String(d.trigger.days.includes(+b.dataset.twd))); return; }
        if (b.dataset.cwd != null) { const c = d.conds[+b.dataset.cwd]; c.days = toggleDay(c.days || [], +b.dataset.v); b.setAttribute("aria-pressed", String(c.days.includes(+b.dataset.v))); return; }
        if (b.dataset.cmode != null) { d.conds[+b.dataset.cmode].mode = b.dataset.v; draw(); return; }
        if (b.dataset.amode != null) { d.actions[+b.dataset.amode].mode = b.dataset.v; draw(); return; }
        if (b.dataset.rmc != null) { d.conds.splice(+b.dataset.rmc, 1); draw(); return; }
        if (b.dataset.rma != null) { d.actions.splice(+b.dataset.rma, 1); draw(); return; }
        if (b.hasAttribute("data-cancel")) { close(); return; }
        if (b.hasAttribute("data-save")) {
          const errs = AC.validateRule(d);
          const box = host.querySelector("[data-errs]");
          if (errs.length) { box.hidden = false; box.innerHTML = errs.map((e) => `<p>⚠️ ${esc(e)}</p>`).join(""); return; }
          const n = AC.normRule(d);
          const now = Date.now();
          const item = { ...n, id: existing ? existing.id : undefined, enabledAt: existing && existing.enabled && n.enabled ? (existing.enabledAt || now) : now };
          if (existing && JSON.stringify(existing.trigger) !== JSON.stringify(n.trigger)) item.enabledAt = now; // neuer Auslöser → ab jetzt
          ui.setBusy(b, true, "Speichert …");
          try {
            await col.put(item);
            ui.toast(existing ? "💾 Gespeichert" : `⚡ „${n.name}“ ist aktiv!`);
            window.dispatchEvent(new Event("sk:automation-check"));
            close();
          } catch (err) { console.error(err); ui.setBusy(b, false); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); }
        }
      });
      draw();
    },
  });
}
