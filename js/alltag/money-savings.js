// Update 9 – Sparziele: echtes Bankkonto, Spar-Erinnerung am Zahltag, Aufrunden.
// Wird von money.js benutzt (Sparziele-Seite, Sparziel-Blatt, Banner in der Übersicht). Logik: money-core.js (Abschnitt „Update 9 – Sparziele“).
// Daten: money_goals (goal.bank, goal.reminder, goal.remindAck), settings.money.roundup, Bank-Status von /bank/status (money-bank.js).
import * as store from "../store.js";
import * as M from "./money-core.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";

const TRANSFER_HINT = "Geld überweisen kannst du in der BAWAG-App (z. B. Dauerauftrag aufs Sparkonto).";
const amt = (v, o) => esc(M.eur(v, o));
const pad = (n) => String(n).padStart(2, "0");

function hhmm(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return M.keyOf(d) === M.todayKey() ? t : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${t}`;
}
const accLabel = (a) => `${a.name || "Konto"}${a.iban_last4 ? ` ••${a.iban_last4}` : ""}`;

/**
 * opts: { col, ui, render, bank (createBank-Objekt), safeWrite, emptyBox }
 */
export function createSavings(opts) {
  const { col, ui, render, bank, safeWrite } = opts;

  const bankData = () => { const s = bank.status && bank.status(); return s && s.linked ? s : null; };
  const goals = () => col.goals.all();
  const ctx = () => ({ txs: col.tx.all(), goals: goals(), bank: bankData() });
  const current = (g) => M.goalCurrent(g, goals(), bankData());
  const ru = () => M.roundupSettings(store.get().settings || {});

  async function saveRoundup(partial) {
    const s = store.get().settings || {};
    const money = s.money && typeof s.money === "object" ? s.money : {};
    const cur = money.roundup && typeof money.roundup === "object" ? money.roundup : {};
    const p = store.saveSettings({ money: { ...money, roundup: { ...cur, ...partial } } }); // Stand ist sofort lokal da
    render();
    try { await p; } catch (err) { console.error(err); ui.toast("Speichern fehlgeschlagen", 3000); }
  }

  /* ---------- Übersicht: Banner nach dem Zahltag ---------- */

  function dueList() {
    const c = ctx(), today = M.todayKey();
    return c.goals.map((g) => ({ g, due: M.reminderDue(g, today, c) })).filter((x) => x.due);
  }

  function bannerHTML() {
    return dueList().map(({ g, due }) => {
      const m = M.reminderMessage(g, due);
      return `<section class="card sv-banner" role="status" style="--c:${esc(g.color || "#14b8a6")}">` +
        `<div class="sv-banner-t"><b>${esc(m.title)}</b><span>${esc(m.body)}</span>` +
        (due.linked ? `<small>${esc(TRANSFER_HINT)}</small>` : "") + `</div>` +
        `<div class="sv-banner-a">` +
          `<button type="button" class="btn primary sm" data-sv="remdone" data-id="${esc(g.id)}">${icon("check", 16)} Erledigt</button>` +
          `<button type="button" class="btn ghost sm" data-sv="remhide" data-id="${esc(g.id)}">Ausblenden</button>` +
        `</div>` +
      `</section>`;
    }).join("");
  }

  /* ---------- Aufrunden ---------- */

  function roundupCardHTML() {
    const r = ru();
    if (!r.on) {
      return `<section class="card sv-ru sv-ru-off">` +
        `<div class="sv-ru-head"><span class="sv-ru-ic" aria-hidden="true">🪙</span><div><h3 class="mn-h">Aufrunden</h3>` +
        `<small>Jede Ausgabe auf den nächsten Euro aufrunden – die Differenz ins Sparziel.</small></div></div>` +
        `<button type="button" class="btn ghost sm" data-sv="ruon">Einschalten</button>` +
      `</section>`;
    }
    const w = M.roundUpWeek(col.tx.all(), M.todayKey(), r.step);
    const booked = r.booked[w.from] || 0;
    const open = M.round2(Math.max(0, w.total - booked));
    const all = goals().filter((g) => !g.archived);
    const goal = all.find((g) => g.id === r.goalId) || null;
    const linked = goal && M.goalLinked(goal);
    let action;
    if (!all.length) action = `<p class="note">Leg zuerst ein Sparziel an, dann kannst du das Aufrunden dort verbuchen.</p>`;
    else if (!goal) action = `<p class="note">Wähle oben ein Sparziel.</p>`;
    else if (linked) action = `<p class="sv-ru-hint">🏦 „${esc(goal.name)}“ ist ein echtes Konto – das Aufrunden geht <b>per Überweisung in der BAWAG-App</b>.</p>`;
    else if (open > 0) action = `<button type="button" class="btn primary sm" data-sv="rubook">${icon("plus", 16)} ${amt(open)} auf Sparziel buchen</button>`;
    else action = booked > 0 ? `<p class="sv-ru-ok">✓ ${amt(booked)} diese Woche schon gebucht</p>` : "";
    return `<section class="card sv-ru" aria-labelledby="sv-ru-h">` +
      `<div class="sv-ru-head"><span class="sv-ru-ic" aria-hidden="true">🪙</span><div><h3 class="mn-h" id="sv-ru-h">Aufrunden</h3>` +
      `<small>Diese Woche (seit ${esc(M.WD[1])} ${esc(M.fmtDate(w.from).slice(0, 6))})</small></div>` +
      `<b class="sv-ru-amt" data-sv-amt="${w.total.toFixed(2)}">${amt(w.total)}</b></div>` +
      `<p class="sv-ru-txt">${w.total > 0 ? `Diese Woche hättest du durch Aufrunden <b>${amt(w.total)}</b> sparen können (${w.count} ${w.count === 1 ? "Ausgabe" : "Ausgaben"}).` : "Diese Woche gibt es noch nichts aufzurunden."}</p>` +
      `<div class="sv-ru-opts">` +
        `<div class="chips" role="group" aria-label="Aufrunden auf">` +
          [1, 5].map((s) => `<button type="button" class="chip" data-sv="rustep" data-step="${s}" aria-pressed="${r.step === s}">auf ${s} €</button>`).join("") +
        `</div>` +
        (all.length ? `<label class="sv-ru-goal"><span>Sparziel</span><select data-sv-sel="rugoal"><option value="">– wählen –</option>${all.map((g) => `<option value="${esc(g.id)}"${g.id === r.goalId ? " selected" : ""}>${esc(g.emoji || "🎯")} ${esc(g.name)}${M.goalLinked(g) ? " (🏦)" : ""}</option>`).join("")}</select></label>` : "") +
      `</div>` +
      action +
      `<label class="switch sv-ru-push"><input type="checkbox" data-sv-chk="rupush"${r.push ? " checked" : ""}><span>Sonntag 18:00 per Push erinnern</span></label>` +
      `<button type="button" class="linkbtn sv-ru-offbtn" data-sv="ruoff">Aufrunden ausschalten</button>` +
    `</section>`;
  }

  /* ---------- Sparziele-Seite ---------- */

  const pct = (a, b) => Math.max(0, Math.min(100, ((Number(a) || 0) / Math.max(0.01, Number(b) || 0)) * 100)).toFixed(1);

  function reminderChip(g) {
    const r = M.goalReminder(g);
    if (!r.on || !(r.amount > 0)) return "";
    return `<span class="sv-chip">🔔 ${r.mode === "day" ? `am ${r.day}.` : "am Zahltag"} ${amt(r.amount, { cents: r.amount % 1 !== 0 })}</span>`;
  }

  function goalCardHTML(g) {
    const cur = current(g);
    const saved = cur.amount;
    const tgt = Number(g.target) || 0;
    const p = M.goalPerMonth({ ...g, saved }, M.todayKey());
    const pc = pct(saved, tgt);
    let info;
    if (p.done) info = `🎉 Ziel erreicht!`;
    else if (p.late) info = `Zieldatum vorbei – noch ${amt(p.rest)}`;
    else if (p.perMonth != null) info = `noch <b>${amt(p.perMonth)}</b> pro Monat (${p.months} ${p.months === 1 ? "Monat" : "Monate"})`;
    else info = `noch ${amt(p.rest)}`;
    let badge = "", extra = "", actions;
    if (cur.linked) {
      const acc = cur.account;
      const at = cur.balance && (cur.balance.at || null);
      badge = `<div class="sv-real"><span class="sv-chip real">🏦 echt${at ? ` · aktualisiert ${esc(hhmm(at))}` : ""}</span>` +
        (acc ? `<span class="sv-acc">${esc(accLabel(acc))}</span>` : "") + reminderChip(g) + `</div>`;
      if (cur.missing) extra += `<p class="bk-warn">Das verbundene Konto (${esc(g.bank.name || "Konto")}${g.bank.last4 ? ` ••${esc(g.bank.last4)}` : ""}) ist ${bankData() ? "in der aktuellen Bank-Freigabe nicht dabei – beim nächsten „Mit BAWAG verbinden“ mit auswählen" : "gerade nicht abrufbar – Bank in der Übersicht verbinden (nur mit Google-Anmeldung)"}.</p>`;
      else if (cur.unknown) extra += `<p class="note">Kontostand noch unbekannt – kommt mit dem nächsten Abgleich.</p>`;
      if (g.bank.mode === "fixed" && cur.balance) {
        const free = M.accountFree(acc, goals(), bankData());
        extra += `<p class="note">Fester Anteil ${amt(g.bank.alloc || 0)} · auf dem Konto ${amt(cur.balance.amount)}${free != null ? ` · nicht zugeteilt ${amt(free)}` : ""}</p>`;
      } else if (!p.done && acc && cur.balance) {
        const hist = (bankData() && bankData().balanceHistory && bankData().balanceHistory[acc.uid]) || [];
        const f = M.monthlyInflow(hist, M.todayKey());
        if (!f) extra += `<p class="note">Für eine Prognose braucht es noch ein paar Wochen Kontoverlauf.</p>`;
        else if (f.perMonth > 0.5) {
          const m = M.monthsToGoal(p.rest, f.perMonth);
          extra += `<p class="sv-eta">📈 Bei Ø <b>${amt(f.perMonth, { sign: true })}</b> pro Monat (letzte 3 Monate) ≈ <b>${m} ${m === 1 ? "Monat" : "Monate"}</b> bis zum Ziel</p>`;
        } else extra += `<p class="note">In den letzten 3 Monaten ist das Konto nicht gewachsen (Ø ${amt(f.perMonth, { sign: true })} pro Monat).</p>`;
      }
      actions = `<p class="sv-transfer">💸 Einzahlen geht hier nicht – der Stand kommt direkt von der Bank. ${esc(TRANSFER_HINT)}</p>`;
    } else {
      const chip = reminderChip(g);
      if (chip) badge = `<div class="sv-real">${chip}</div>`;
      actions = `<div class="row"><button type="button" class="btn sm primary" data-mn="deposit" data-id="${esc(g.id)}">${icon("plus", 16)} Einzahlen</button>` +
        `<button type="button" class="btn sm ghost" data-mn="withdraw" data-id="${esc(g.id)}">Abheben</button></div>`;
    }
    return `<article class="card mn-goal${p.done ? " done" : ""}${cur.linked ? " sv-linked" : ""}" data-goal="${esc(g.id)}" style="--c:${esc(g.color || "#14b8a6")}">` +
      `<button type="button" class="mn-goal-head" data-mn="editgoal" data-id="${esc(g.id)}">` +
        `<span class="mn-goal-emo">${esc(g.emoji || "🎯")}</span>` +
        `<span class="mn-goal-t"><b>${esc(g.name || "Sparziel")}</b><small>${M.isKey(g.date) ? "bis " + esc(M.fmtDate(g.date)) : "ohne Datum"}</small></span>` +
        `<span class="mn-goal-p">${Math.floor(pc)} %</span>` +
      `</button>` + badge +
      `<div class="mn-goal-bar"><div style="width:${pc}%"></div></div>` +
      `<div class="mn-goal-v"><b class="sv-cur">${amt(saved)}</b><span>von ${amt(tgt)}</span></div>` +
      `<p class="mn-goal-info">${info}</p>` + extra + actions +
    `</article>`;
  }

  function goalsPageHTML(emptyBox) {
    const list = goals().sort((a, b) => (a.done === b.done ? (a.created || 0) - (b.created || 0) : a.done ? 1 : -1));
    if (!list.length) return emptyBox("🐷 Noch keine Sparziele", "Spar auf etwas Bestimmtes – z. B. Führerschein, Moped oder neues Handy.", "newgoal") + roundupCardHTML();
    const totalSaved = list.reduce((s, g) => s + current(g).amount, 0);
    return `<div class="mn-goal-sum"><span>Gespart insgesamt</span><b>${amt(totalSaved)}</b></div>` +
      `<div class="mn-goals">${list.map(goalCardHTML).join("")}</div>` +
      roundupCardHTML();
  }

  /* ---------- Sparziel-Blatt: Konto + Erinnerung ---------- */

  function goalSheetHTML(g) {
    const b = bankData();
    const accs = (b && b.accounts) || [];
    const l = g.bank || null;
    const sel = l ? M.goalAccount(g, b) : null;
    const mode = l && l.mode === "fixed" ? "fixed" : "all";
    const r = M.goalReminder(g);
    const num = (v) => (v ? esc(String(v).replace(".", ",")) : "");
    const accOpts = accs.map((a) => {
      const bal = M.accountBalance(a, b);
      return `<option value="${esc(a.uid)}"${sel && sel.uid === a.uid ? " selected" : ""}>${esc(accLabel(a))}${bal ? ` · ${esc(M.eur(bal.amount))}` : ""}</option>`;
    }).join("");
    return `<fieldset class="sv-fs">` +
        `<label class="switch"><input type="checkbox" id="sv-link"${l ? " checked" : ""}${!accs.length && !l ? " disabled" : ""}><span>🏦 Mit echtem Konto verbinden</span></label>` +
        (!accs.length && !l ? `<p class="note">Zuerst unter Übersicht › Bankkonto „Mit BAWAG verbinden“ (nur mit Google-Anmeldung). Ein eigenes Sparkonto kannst du dort mit freigeben.</p>` : "") +
        `<div class="sv-link-body"${l ? "" : " hidden"}>` +
          (accs.length ? `<label>Konto<select id="sv-acc">${accOpts}</select></label>`
            : `<p class="note">Verbunden mit ${esc(l ? (l.name || "Konto") + (l.last4 ? " ••" + l.last4 : "") : "")} – Bank-Status gerade nicht verfügbar.</p>`) +
          `<div class="chips" role="group" aria-label="Was zählt">` +
            `<button type="button" class="chip" data-svmode="all" aria-pressed="${mode === "all"}">Ganzer Kontostand</button>` +
            `<button type="button" class="chip" data-svmode="fixed" aria-pressed="${mode === "fixed"}">Fester Anteil</button>` +
          `</div>` +
          `<label data-svm="all"${mode === "all" ? "" : " hidden"}>Startbetrag abziehen (€, optional)<input id="sv-offset" inputmode="decimal" placeholder="0" value="${num(l && l.offset)}"></label>` +
          `<label data-svm="fixed"${mode === "fixed" ? "" : " hidden"}>Zugeteilter Betrag (€)<input id="sv-alloc" inputmode="decimal" placeholder="z. B. 300" value="${num(l && l.alloc)}"></label>` +
          `<p class="note">Der Stand kommt dann direkt vom Konto. Teilen sich mehrere Ziele ein Konto: jedem einen festen Anteil geben – der Rest wird angezeigt. ${esc(TRANSFER_HINT)}</p>` +
        `</div>` +
      `</fieldset>` +
      `<fieldset class="sv-fs">` +
        `<label class="switch"><input type="checkbox" id="sv-rem"${r.on ? " checked" : ""}><span>🔔 Spar-Erinnerung</span></label>` +
        `<div class="sv-rem-body"${r.on ? "" : " hidden"}>` +
          `<label>Betrag pro Monat (€)<input id="sv-rem-amt" inputmode="decimal" placeholder="z. B. 50" value="${num(r.amount)}"></label>` +
          `<div class="chips" role="group" aria-label="Wann erinnern">` +
            `<button type="button" class="chip" data-svrm="payday" aria-pressed="${r.mode === "payday"}">Am Zahltag (Lohn ist da)</button>` +
            `<button type="button" class="chip" data-svrm="day" aria-pressed="${r.mode === "day"}">Fixer Tag</button>` +
          `</div>` +
          `<label data-svd${r.mode === "day" ? "" : " hidden"}>Tag im Monat (09:00 Uhr)<input id="sv-rem-day" type="number" inputmode="numeric" min="1" max="31" value="${r.day}"></label>` +
          `<p class="note" data-svpn${r.mode === "payday" ? "" : " hidden"}>Der Zahltag wird an der Lehrlingsentschädigung bzw. am Lohn erkannt (Kategorie „Einkommen“ oder Stichwort in der Buchung).</p>` +
        `</div>` +
      `</fieldset>`;
  }

  /** Blatt verdrahten; gibt read() → {bank, reminder} | {error} zurück. */
  function bindGoalSheet(sheet, g) {
    let mode = g.bank && g.bank.mode === "fixed" ? "fixed" : "all";
    let rmode = M.goalReminder(g).mode;
    const $ = (s) => sheet.querySelector(s);
    const savedRow = $("#mn-g-saved");
    const syncSaved = () => {
      const on = $("#sv-link").checked;
      if (savedRow) { savedRow.disabled = on; savedRow.closest("label").classList.toggle("sv-dim", on); }
    };
    $("#sv-link").addEventListener("change", () => { $(".sv-link-body").hidden = !$("#sv-link").checked; syncSaved(); });
    $("#sv-rem").addEventListener("change", () => { $(".sv-rem-body").hidden = !$("#sv-rem").checked; });
    sheet.addEventListener("click", (ev) => {
      const m = ev.target.closest("[data-svmode]");
      if (m) {
        mode = m.dataset.svmode;
        sheet.querySelectorAll("[data-svmode]").forEach((x) => x.setAttribute("aria-pressed", String(x === m)));
        sheet.querySelectorAll("[data-svm]").forEach((x) => { x.hidden = x.dataset.svm !== mode; });
      }
      const r = ev.target.closest("[data-svrm]");
      if (r) {
        rmode = r.dataset.svrm;
        sheet.querySelectorAll("[data-svrm]").forEach((x) => x.setAttribute("aria-pressed", String(x === r)));
        $("[data-svd]").hidden = rmode !== "day";
        $("[data-svpn]").hidden = rmode !== "payday";
      }
    });
    syncSaved();
    return function read() {
      const out = {};
      if ($("#sv-link").checked) {
        const b = bankData();
        const sel = $("#sv-acc");
        const acc = sel && b ? (b.accounts || []).find((a) => a.uid === sel.value) : null;
        if (!acc && !g.bank) return { error: "Bitte ein Konto wählen." };
        const base = acc ? { uid: acc.uid, hash: acc.hash || null, last4: acc.iban_last4 || "", name: acc.name || "Konto" } : { ...g.bank };
        if (mode === "fixed") {
          const alloc = M.parseAmount($("#sv-alloc").value);
          if (!(alloc > 0)) return { error: "Bitte den zugeteilten Betrag eingeben." };
          out.bank = { ...base, mode: "fixed", alloc, offset: null };
        } else {
          const raw = $("#sv-offset").value.trim();
          const offset = raw ? M.parseAmount(raw) : 0;
          if (!(offset >= 0)) return { error: "Der Startbetrag ist ungültig." };
          out.bank = { ...base, mode: "all", offset: offset || null, alloc: null };
        }
      } else out.bank = null;
      const on = $("#sv-rem").checked;
      const a = M.parseAmount($("#sv-rem-amt").value);
      if (on && !(a > 0)) return { error: "Wie viel willst du pro Monat sparen?" };
      const day = Math.min(31, Math.max(1, Math.round(Number($("#sv-rem-day").value) || 1)));
      out.reminder = on || g.reminder ? { on, amount: a > 0 ? a : 0, mode: rmode, day: rmode === "day" ? day : null } : null;
      return out;
    };
  }

  /* ---------- Klicks ---------- */

  async function markDone(id, deposit) {
    const g = col.goals.get(id);
    if (!g) return;
    const due = M.reminderDue(g, M.todayKey(), ctx());
    const mk = M.monthOf(M.todayKey());
    if (!deposit || !due) { await safeWrite(col.goals.patch(id, { remindAck: mk }), deposit ? null : "Ausgeblendet – nächsten Monat wieder"); return; }
    if (M.goalLinked(g)) {
      const ok = await safeWrite(col.goals.patch(id, { remindAck: mk }), null);
      if (ok) ui.toast("Super! Denk an die Überweisung in der BAWAG-App 🏦", 3400);
      return;
    }
    const saved = M.round2((Number(g.saved) || 0) + due.amount);
    const ok = await safeWrite(col.goals.patch(id, { saved, remindAck: mk }), null);
    if (ok) ui.toast(`${M.eur(due.amount)} eingezahlt ✓ – Stand ${M.eur(saved)}`, 3000);
  }

  async function bookRoundup() {
    const r = ru();
    const g = col.goals.get(r.goalId);
    if (!g || M.goalLinked(g)) return;
    const w = M.roundUpWeek(col.tx.all(), M.todayKey(), r.step);
    const open = M.round2(Math.max(0, w.total - (r.booked[w.from] || 0)));
    if (!(open > 0)) return;
    const saved = M.round2((Number(g.saved) || 0) + open);
    const ok = await safeWrite(col.goals.patch(g.id, { saved }), null);
    if (!ok) return;
    const keep = Object.fromEntries(Object.entries(r.booked).filter(([k]) => k >= M.addDays(w.from, -56)));
    await saveRoundup({ booked: { ...keep, [w.from]: w.total } });
    ui.toast(`🪙 ${M.eur(open)} auf „${g.name}“ gebucht – Stand ${M.eur(saved)}`, 3200);
  }

  function onClick(t) {
    const a = t.dataset.sv;
    if (!a) return false;
    if (a === "remdone") markDone(t.dataset.id, true);
    else if (a === "remhide") markDone(t.dataset.id, false);
    else if (a === "ruon") {
      const first = goals().find((g) => !g.archived && !M.goalLinked(g)) || goals()[0];
      saveRoundup({ on: true, step: ru().step, push: ru().push, goalId: ru().goalId || (first && first.id) || "" });
    } else if (a === "ruoff") saveRoundup({ on: false });
    else if (a === "rustep") saveRoundup({ step: Number(t.dataset.step) === 5 ? 5 : 1 });
    else if (a === "rubook") bookRoundup();
    else return false;
    return true;
  }

  function onChange(t) {
    if (t.dataset.svSel === "rugoal") { saveRoundup({ goalId: t.value }); return true; }
    if (t.dataset.svChk === "rupush") { saveRoundup({ push: t.checked }); return true; }
    return false;
  }

  return { bannerHTML, roundupCardHTML, goalsPageHTML, goalSheetHTML, bindGoalSheet, onClick, onChange, current, isLinked: M.goalLinked };
}
