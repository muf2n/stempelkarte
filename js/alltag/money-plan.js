// Update 10 E – Geld › 🧮 Planen: „Was bleibt am Monatsende?“, „Wie wirkt sich eine Ausgabe aus?“ (nutzt „Kann ich mir das leisten?“),
// Jahreskosten aller Abos & 📜 Verträge und die 🎁 Wunschliste (money_wishes, optional mit Sparziel verknüpft).
// Läuft innerhalb von money.js → die Geld-Sperre gilt automatisch. Reine Logik: ./finanz-core.js
import { collection, newId } from "./db.js";
import * as M from "./money-core.js";
import * as FP from "./finanz-core.js";
import { esc } from "../util.js";

const INCOME_KEY = "sk-fp-income";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null || v === "") localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* egal */ } };

function injectCSS() {
  if (typeof document === "undefined" || document.getElementById("fp-css")) return;
  const l = document.createElement("link");
  l.id = "fp-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-finanzplan.css", import.meta.url).href;
  document.head.appendChild(l);
}

/**
 * opts = { col (Geld-Sammlungen), ui, render, safeWrite, cats(), bankStatus(), goGoals() }
 * → { pageHTML(), onClick(el) → bool, onInput(el) → bool, newWish(), destroy() }
 */
export function createPlan(opts) {
  injectCSS();
  const { col, ui } = opts;
  const wishes = collection("money_wishes");
  const contracts = collection("vertraege");
  const offs = [wishes.watch(() => opts.render()), contracts.watch(() => opts.render())];
  const P = { amount: "", note: "", showYear: false };
  const amt = (v) => esc(M.eur(v));
  const incomeFix = () => { const n = M.parseAmount(lsGet(INCOME_KEY) || ""); return n > 0 ? n : null; };
  const base = () => ({ today: M.todayKey(), txs: col.tx.all(), subs: col.subs.all(), contracts: contracts.all(), wishes: wishes.all(), income: incomeFix() });

  function monthEndHTML() {
    const r = FP.monthEnd(base());
    const lvl = FP.restLevel(r);
    const src = r.incomeSource === "angegeben" ? "deine Angabe" : r.incomeSource === "schnitt" ? `Schnitt der letzten Monate (bisher ${M.eur(r.incomeSoFar)})` : "bisher eingegangen";
    const line = (e, label, v, sub = "", cls = "out") => `<li class="${cls}"><span aria-hidden="true">${e}</span><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><b>${cls === "in" ? "+" : "−"} ${amt(v)}</b></li>`;
    return `<section class="card mn-card fp-me fp-${lvl}">
      <h3 class="mn-h">🗓️ Was bleibt am Monatsende?</h3>
      <div class="fp-big"><span class="fp-big-n">${amt(r.rest)}</span><span class="fp-big-l">${lvl === "minus" ? "😬 Das wird eng – da fehlt was." : lvl === "knapp" ? "🙂 Knapp, aber geht sich aus." : "😊 Passt – da bleibt was übrig!"}</span><small>${r.daysLeft} ${r.daysLeft === 1 ? "Tag" : "Tage"} bis Monatsende</small></div>
      <ul class="fp-lines">
        ${line("💰", "Einnahmen", r.income, src, "in")}
        ${line("🧾", "Schon ausgegeben", r.spent, `${M.monthLabel(r.mk)} bis heute`)}
        ${r.subsLeft ? line("🔁", "Abos bis Monatsende", r.subsLeft, r.subsList.slice(0, 3).map((x) => x.name).join(", ")) : ""}
        ${r.contracts ? line("📜", "Verträge (pro Monat)", r.contracts, r.contractList.slice(0, 3).map((x) => x.name).join(", ")) : ""}
        ${r.planned ? line("🎁", "Geplante Wünsche", r.planned, r.plannedList.map((x) => x.name).join(", ")) : ""}
      </ul>
      <details class="fp-inc"><summary>✏️ Einnahmen selbst festlegen</summary>
        <label>Erwartete Einnahmen diesen Monat (€)<input id="fp-income" inputmode="decimal" placeholder="${esc(String(r.incomeAvg || r.incomeSoFar || "").replace(".", ","))}" value="${esc(lsGet(INCOME_KEY) || "")}" autocomplete="off"></label>
        <p class="note">Leer lassen = automatisch (Schnitt der letzten 3 Monate). Verträge mit Abo-Verknüpfung zählen nur einmal.</p></details>
    </section>`;
  }

  function simResultHTML() {
    const a = M.parseAmount(P.amount) > 0 ? M.parseAmount(P.amount) : M.splitNoteAmount(P.note).amount;
    if (!(a > 0)) return `<p class="note">Betrag eingeben – dann siehst du, was am Monatsende übrig bleibt und ob's ins Budget passt. 🤔</p>`;
    const r = FP.simulate({ ...base(), amount: a, note: M.splitNoteAmount(P.note).note || P.note, budgets: col.budget.all(), cats: opts.cats(), rules: col.rules.all(), goals: col.goals.all(), bank: opts.bankStatus() });
    return `<div class="fp-sim-res fp-${r.level}">
      <div class="fp-ba"><div><small>Vorher</small><b>${amt(r.before.rest)}</b></div><span aria-hidden="true">→</span><div><small>Nachher</small><b>${amt(r.after.rest)}</b></div></div>
      <div class="mn-af-box ${r.afford.verdict}"><p class="mn-af-head">${esc(r.afford.headline)}</p><ul>${r.afford.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="row"><button type="button" class="btn ghost sm" data-fp="wishfromsim">🎁 Auf die Wunschliste</button></div>
    </div>`;
  }
  function simHTML() {
    return `<section class="card mn-card fp-sim"><h3 class="mn-h">🔮 Wie wirkt sich eine Ausgabe aus?</h3>
      <div class="fields fp-sim-f"><label>Was?<input id="fp-note" type="text" maxlength="80" placeholder="z. B. Neue Kopfhörer" value="${esc(P.note)}" autocomplete="off"></label>
        <label>Betrag (€)<input id="fp-amt" inputmode="decimal" placeholder="0,00" value="${esc(P.amount)}" autocomplete="off"></label></div>
      <div class="fp-sim-out" aria-live="polite">${simResultHTML()}</div></section>`;
  }

  function yearHTML() {
    const y = FP.yearlyFixed({ subs: col.subs.all(), contracts: contracts.all(), today: M.todayKey() });
    if (!y.rows.length) return `<section class="card mn-card"><h3 class="mn-h">📅 Fixkosten im Jahr</h3><p class="note">Noch keine Abos oder Verträge. Trag sie unter „Abos“ bzw. Alltag › 📜 Verträge ein – dann siehst du hier, was dich das im Jahr kostet.</p><a class="btn ghost sm" href="#alltag/vertraege">📜 Zu den Verträgen</a></section>`;
    const max = Math.max(...y.rows.map((r) => r.year), 1);
    const rows = P.showYear ? y.rows : y.rows.slice(0, 6);
    return `<section class="card mn-card fp-year"><h3 class="mn-h">📅 Fixkosten im Jahr</h3>
      <div class="ak-like-stats"><div><b>${amt(y.year)}</b><small>pro Jahr</small></div><div><b>${amt(y.month)}</b><small>im Monat</small></div><div><b>${amt(y.abos)}</b><small>davon Abos</small></div></div>
      <ul class="fp-yl">${rows.map((r) => `<li><span aria-hidden="true">${r.e}</span><span class="fp-yn">${esc(r.name)}<small>${r.src === "abo" ? "Abo" : "Vertrag"} · ${amt(r.month)}/Monat</small><span class="fp-bar"><span style="width:${Math.max(3, Math.round((r.year / max) * 100))}%"></span></span></span><b>${amt(r.year)}</b></li>`).join("")}</ul>
      ${y.rows.length > 6 ? `<button type="button" class="btn ghost sm" data-fp="allyear">${P.showYear ? "Weniger anzeigen" : `Alle ${y.rows.length} anzeigen`}</button>` : ""}
      <p class="note">💡 Tipp: Jährlich zahlen ist oft billiger – und jeder gekündigte 10-€-Vertrag spart 120 € im Jahr.</p></section>`;
  }

  function wishesHTML() {
    const goals = col.goals.all();
    const list = FP.sortWishes(wishes.all(), goals);
    const open = list.filter((w) => !w.done);
    const sum = open.reduce((a, w) => a + w.price, 0), saved = open.reduce((a, w) => a + Math.min(w.saved, w.price), 0);
    return `<section class="card mn-card fp-wish"><header class="fp-h"><h3 class="mn-h">🎁 Wunschliste</h3><button type="button" class="btn primary sm" data-fp="newwish">＋ Wunsch</button></header>
      ${list.length ? `<p class="note">${open.length} ${open.length === 1 ? "Wunsch" : "Wünsche"} · ${amt(saved)} von ${amt(sum)} angespart</p>
      <ul class="fp-wl">${list.map((w) => {
        const p = FP.wishProgress(w);
        const pr = FP.prioById(w.prio);
        return `<li class="${w.done ? "is-done" : ""}"><button type="button" class="fp-wi" data-fp="editwish" data-id="${esc(w.id)}">
          <span class="fp-wi-e" aria-hidden="true">${w.done ? "✅" : pr.e}</span>
          <span class="fp-wi-t"><b>${esc(w.name)}</b><small>${esc([pr.label, w.goalName ? `🎯 ${w.goalName}` : "", w.plan ? `geplant ${M.monthLabel(w.plan, true)}` : ""].filter(Boolean).join(" · "))}</small>
            ${w.done ? "" : `<div class="progress fp-prog"><div style="width:${p.pct}%"></div></div><small>${p.ready ? "🎉 Genug angespart!" : `${amt(w.saved)} von ${amt(w.price)} · noch ${amt(p.left)}`}</small>`}</span>
          <b class="fp-wi-p">${amt(w.price)}</b></button></li>`;
      }).join("")}</ul>` : `<p class="note">Was hättest du gern? Schreib's auf, setz eine Priorität und spar gezielt drauf hin – mit Sparziel-Verknüpfung siehst du den Fortschritt automatisch. 🌟</p>`}
    </section>`;
  }

  function pageHTML() {
    return `<div class="fp">${monthEndHTML()}${simHTML()}<div class="fp-cols">${wishesHTML()}${yearHTML()}</div></div>`;
  }

  function openWish(w0 = null, preset = {}) {
    const goals = col.goals.all().filter((g) => g && g.id && !g.done);
    const w = FP.normWish({ ...(w0 || { prio: 2 }), ...preset }, col.goals.all());
    const thisMonth = M.monthOf(M.todayKey());
    ui.openSheet({
      title: w0 ? "✏️ Wunsch bearbeiten" : "🎁 Neuer Wunsch",
      bodyHTML: `<form class="fields" novalidate>
        <label>Was wünschst du dir?<input id="fp-w-name" type="text" maxlength="120" value="${esc(w.name)}" placeholder="z. B. Akku-Schrauber" required></label>
        <label>Preis (€)<input id="fp-w-price" inputmode="decimal" value="${w.price ? esc(String(w.price).replace(".", ",")) : ""}" placeholder="0,00"></label>
        <div><p class="lbl mn-lbl">Priorität</p><div class="chips">${FP.PRIOS.map((p) => `<button type="button" class="chip" data-prio="${p.id}" aria-pressed="${w.prio === p.id}">${p.e} ${esc(p.label)}</button>`).join("")}</div></div>
        <label>Sparziel <select id="fp-w-goal"><option value="">– ohne –</option>${goals.map((g) => `<option value="${esc(g.id)}"${g.id === w.goalId ? " selected" : ""}>${esc((g.emoji || "🎯") + " " + g.name)}</option>`).join("")}</select></label>
        <label id="fp-w-saved-l">Schon angespart (€)<input id="fp-w-saved" inputmode="decimal" value="${w.saved && !w.goalId ? esc(String(w.saved).replace(".", ",")) : ""}" placeholder="0,00"></label>
        <label class="fp-check"><input id="fp-w-plan" type="checkbox"${w.plan === thisMonth ? " checked" : ""}> 🗓️ Diesen Monat kaufen (zählt bei „Was bleibt am Monatsende?“)</label>
        <label>Link <small class="note">(optional)</small><input id="fp-w-url" type="url" maxlength="500" value="${esc(w.url)}" placeholder="https://…"></label>
        <label>Notiz<textarea id="fp-w-note" rows="2" maxlength="1000">${esc(w.note)}</textarea></label>
        <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button></div>
        ${w0 ? `<div class="row fp-w-more">${w.goalId ? "" : `<button type="button" class="btn ghost sm" data-togoal>🎯 Als Sparziel anlegen</button>`}<button type="button" class="btn ghost sm" data-done>${w.done ? "↩️ Wieder offen" : "✅ Gekauft!"}</button><button type="button" class="btn danger sm" data-del>Löschen</button></div>` : ""}
      </form>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        let prio = w.prio;
        sheet.querySelectorAll("[data-prio]").forEach((b) => b.addEventListener("click", () => { prio = Number(b.dataset.prio); sheet.querySelectorAll("[data-prio]").forEach((x) => x.setAttribute("aria-pressed", String(Number(x.dataset.prio) === prio))); }));
        const syncGoal = () => { $("#fp-w-saved-l").hidden = !!$("#fp-w-goal").value; };
        $("#fp-w-goal").addEventListener("change", syncGoal); syncGoal();
        const doc = () => ({
          ...(w0 || {}), id: w.id || newId(), name: $("#fp-w-name").value.trim(), price: M.parseAmount($("#fp-w-price").value) || 0, prio,
          goalId: $("#fp-w-goal").value, saved: $("#fp-w-goal").value ? 0 : M.parseAmount($("#fp-w-saved").value) || 0,
          plan: $("#fp-w-plan").checked ? thisMonth : (w.plan && w.plan !== thisMonth ? w.plan : ""), url: $("#fp-w-url").value.trim(), note: $("#fp-w-note").value.trim(),
          done: w.done, created: w.created || Date.now(), updated: Date.now(),
        });
        $("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const d = doc();
          if (!d.name) { ui.toast("Bitte eintragen, was du dir wünschst."); return; }
          if (await opts.safeWrite(wishes.put(d), w0 ? "Gespeichert ✓" : "Auf der Wunschliste 🎁")) close();
        });
        const tg = $("[data-togoal]");
        if (tg) tg.addEventListener("click", async () => {
          const d = doc();
          const gid = newId();
          const g = FP.goalFromWish(FP.normWish(d));
          if (!(g.target > 0)) { ui.toast("Bitte zuerst einen Preis eintragen."); return; }
          if (await opts.safeWrite(col.goals.put({ ...g, id: gid }), null) && await opts.safeWrite(wishes.put({ ...d, goalId: gid, saved: 0 }), "Sparziel angelegt 🎯")) close();
        });
        const dn = $("[data-done]");
        if (dn) dn.addEventListener("click", async () => { if (await opts.safeWrite(wishes.patch(w.id, { done: !w.done, updated: Date.now() }), w.done ? "Wieder offen" : "Gratuliere zum Kauf! 🎉")) close(); });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => { if (await opts.safeWrite(wishes.remove(w.id), "Wunsch gelöscht")) close(); });
      },
    });
  }

  function onClick(t) {
    switch (t.dataset.fp) {
      case "newwish": openWish(); return true;
      case "editwish": { const w = wishes.get(t.dataset.id); if (w) openWish(w); return true; }
      case "wishfromsim": {
        const a = M.parseAmount(P.amount) > 0 ? M.parseAmount(P.amount) : M.splitNoteAmount(P.note).amount;
        openWish(null, { name: M.splitNoteAmount(P.note).note || P.note, price: a > 0 ? a : 0 });
        return true;
      }
      case "allyear": P.showYear = !P.showYear; opts.render(); return true;
      default: return false;
    }
  }
  function onInput(t) {
    if (t.id === "fp-amt" || t.id === "fp-note") {
      if (t.id === "fp-amt") P.amount = t.value; else P.note = t.value;
      const out = document.querySelector(".fp-sim-out");
      if (out) out.innerHTML = simResultHTML();
      return true;
    }
    if (t.id === "fp-income") { lsSet(INCOME_KEY, t.value.trim()); return true; }
    return false;
  }
  function onChange(t) {
    if (t.id === "fp-income") { opts.render(); return true; }
    return false;
  }
  return { pageHTML, onClick, onInput, onChange, newWish: () => openWish(), destroy: () => offs.forEach((o) => o()) };
}
