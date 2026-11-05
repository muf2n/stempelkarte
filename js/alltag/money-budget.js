// Update 9 – Budget-Warnungen: Banner bei neuen Buchungen (manuell oder Bank), Warn-Einstellungen,
// „Kann ich mir das leisten?“ und der ehrliche Hinweis, dass nur die Bank Karten sperren kann.
// Logik in money-core.js (budgetStatus, budgetAlerts, affordCheck) – dieselbe wie bei den Push-Warnungen
// (tools/reminders/decide.mjs) und beim Claude-Werkzeug „leisten_pruefen“.
import * as store from "../store.js";
import { getFirebase } from "../firebase.js";
import * as M from "./money-core.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";

const LS_KEY = "stempelkarte.money.budgetAlerts";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

function readLocal() {
  try { const v = JSON.parse(lsGet(LS_KEY) || "null"); return v && typeof v === "object" ? v : null; } catch { return null; }
}

/** Zwei Zustände (App + Server) zusammenführen: gleicher Monat → gemerkte Schwellen vereinen, höchster Stand gewinnt. */
export function mergeAlertState(a, b) {
  if (!a || !a.month) return b || null;
  if (!b || !b.month) return a;
  if (a.month !== b.month) return a.month > b.month ? a : b;
  const sent = { ...(a.sent || {}) };
  for (const [k, v] of Object.entries(b.sent || {})) {
    const x = sent[k];
    if (!x || Number(x.limit) !== Number(v.limit)) { sent[k] = x && Number(x.spent) > Number(v.spent) ? x : v; continue; }
    sent[k] = { ...x, ...v, spent: Math.max(Number(x.spent) || 0, Number(v.spent) || 0) };
    for (const f of ["80", "100", "pace", "over"]) if (x[f] || v[f]) sent[k][f] = true;
  }
  return { month: a.month, sent };
}

const cloudUid = () => { const s = store.get(); return s.mode === "cloud" && s.user ? s.user.uid : null; };

/**
 * opts: { el (Geld-Wurzel), col, ui, cats(), catOf(id), bankStatus(), safeWrite(p,msg), goBudget() }
 * → { check(), budgetExtrasHTML(), affordBtnHTML(cls), onClick(el) → bool, openAfford(), destroy() }
 */
export function createBudgetGuard(opts) {
  const { el, col, ui, cats, catOf, bankStatus, safeWrite, goBudget } = opts;
  let state = readLocal();
  let serverReady = !cloudUid();
  let alive = true;
  let bannerTimer = null;

  // Server-Zustand (meta/budget_alerts) einmal holen → kein doppeltes Banner, wenn schon ein Push kam
  (async () => {
    const uid = cloudUid();
    if (!uid) return;
    try {
      const f = await getFirebase();
      if (f) {
        const snap = await Promise.race([
          f.fs.getDoc(f.fs.doc(f.db, "users", uid, "meta", "budget_alerts")),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
        ]);
        if (snap && snap.exists()) state = mergeAlertState(state, snap.data());
      }
    } catch (err) { console.warn("Budget-Warnungen (Server):", err && err.message || err); }
    serverReady = true;
    if (alive) check();
  })();

  const alertsCfg = () => { const s = store.get().settings || {}; return M.normAlerts(s.money && s.money.alerts); };
  const today = () => M.todayKey();
  const rows = (mk = M.monthOf(today())) => M.budgetStatus(col.tx.all(), col.budget.all(), mk, cats());

  function save(next) {
    state = next;
    lsSet(LS_KEY, JSON.stringify(next));
    const uid = cloudUid();
    if (!uid) return;
    getFirebase().then((f) => f && f.fs.setDoc(f.fs.doc(f.db, "users", uid, "meta", "budget_alerts"), { ...next, updatedAt: Date.now() }))
      .catch((err) => console.warn("Budget-Warnungen speichern:", err && err.message || err));
  }

  /** Nach jeder Datenänderung: neue Schwellen → Banner (und gemerkt, damit kein Push mehr dafür kommt). */
  function check() {
    if (!alive || !serverReady || !col.tx.loaded || !col.budget.loaded) return;
    const t = today();
    const list = M.budgetAlerts(rows(), state, t, alertsCfg());
    if (!list.length) return;
    save(M.applyAlerts(state, t, list));
    showBanner(list);
  }

  function showBanner(list) {
    const host = el.querySelector(".mn-alert-host");
    if (!host) return;
    const stop = list.some((a) => a.kind === "100" || a.kind === "over");
    const order = { over: 0, "100": 1, "80": 2, pace: 3 };
    const sorted = list.slice().sort((a, b) => order[a.kind] - order[b.kind]);
    host.innerHTML = `<div class="mn-alert ${stop ? "stop" : "warn"}" role="alert">` +
      `<div class="mn-alert-txt">${sorted.map((a) => `<p>${esc(a.text)}</p>`).join("")}` +
      (stop ? `<small>Die App kann deine Karte nicht sperren – aber bitte: diesen Monat nichts mehr dafür ausgeben.</small>` : "") + `</div>` +
      `<div class="mn-alert-act"><button type="button" class="btn sm" data-bg="tobudget">Budget ansehen</button>` +
      `<button type="button" class="btn sm ghost" data-bg="dismiss" aria-label="Hinweis schließen">OK</button></div>` +
    `</div>`;
    try { if (stop && navigator.vibrate) navigator.vibrate([90, 60, 90]); } catch { /* egal */ }
    clearTimeout(bannerTimer);
    if (!stop) bannerTimer = setTimeout(() => { if (alive) host.innerHTML = ""; }, 15000);
  }

  /* ---------- Budget-Reiter: Knopf, Hinweis „echte Sperre“, Warn-Einstellungen ---------- */

  const affordBtnHTML = (cls = "") => `<button type="button" class="btn ${cls || "sm"} mn-afford-btn" data-bg="afford">🤔 Kann ich mir das leisten?</button>`;

  function budgetExtrasHTML() {
    const a = alertsCfg();
    const sw = (k, label, on, dis = false) => `<label class="switch"><input type="checkbox" data-bga="${k}"${on ? " checked" : ""}${dis ? " disabled" : ""}><span>${label}</span></label>`;
    return `<section class="card mn-card mn-bankhint">` +
        `<h3 class="mn-h">🔒 Echte Sperre geht nur bei der Bank</h3>` +
        `<p>Die App kann Kartenzahlungen <b>nicht blockieren</b> – sie warnt dich sofort und hilft dir, <i>vor</i> dem Kauf zu entscheiden.</p>` +
        `<p class="mn-bankhint-path">BAWAG-App → Karten → Limits</p>` +
        `<p class="note">Dort kannst du z. B. ein niedriges Tages- oder Online-Limit für deine Karte einstellen.</p>` +
      `</section>` +
      `<section class="card mn-card mn-alertcfg">` +
        `<h3 class="mn-h">Warnungen</h3>` +
        sw("on", "Budget-Warnungen (Push + Banner)", a.on) +
        `<div class="mn-alertcfg-sub"${a.on ? "" : " hidden"}>` +
          sw("at80", "Ab 80 % – fast aufgebraucht", a.at80) +
          sw("at100", "Bei 100 % – STOPP", a.at100) +
          sw("over", "Bei jeder weiteren Ausgabe darüber", a.over) +
          sw("pace", "Tempo-Hinweis in der ersten Monatshälfte", a.pace) +
        `</div>` +
        `<p class="note">Push kommt auch bei geschlossener App (Bank-Buchungen werden 4× am Tag abgeglichen), nachts erst ab 7 Uhr. Push-Erinnerungen allgemein: Einstellungen → Erinnerungen.</p>` +
      `</section>`;
  }

  async function saveAlert(k, v) {
    const s = store.get().settings || {};
    const money = s.money && typeof s.money === "object" ? s.money : {};
    const next = { ...M.normAlerts(money.alerts), [k]: v };
    try { await store.saveSettings({ money: { ...money, alerts: next } }); }
    catch (err) { ui.toast("Speichern fehlgeschlagen: " + (err && err.message || err), 4000); }
    const sub = el.querySelector(".mn-alertcfg-sub");
    if (sub && k === "on") sub.hidden = !v;
  }

  function onChange(ev) {
    const k = ev.target && ev.target.dataset && ev.target.dataset.bga;
    if (k) saveAlert(k, ev.target.checked);
  }
  el.addEventListener("change", onChange);

  function onClick(t) {
    const a = t.dataset.bg;
    if (a === "afford") { openAfford(); return true; }
    if (a === "dismiss") { const h = el.querySelector(".mn-alert-host"); if (h) h.innerHTML = ""; return true; }
    if (a === "tobudget") { const h = el.querySelector(".mn-alert-host"); if (h) h.innerHTML = ""; goBudget(); return true; }
    return false;
  }

  /* ---------- „Kann ich mir das leisten?“ ---------- */

  function openAfford(preset = {}) {
    const st = { cat: preset.cat || "", touched: !!preset.cat, res: null };
    const outCats = () => cats().filter((c) => c.type !== "in");
    ui.openSheet({
      title: "Kann ich mir das leisten?",
      bodyHTML: `<div class="fields">` +
          `<label>Was willst du kaufen?<input id="mn-af-note" type="text" maxlength="80" placeholder="z. B. Pizza 12 €" autocomplete="off" value="${esc(preset.note || "")}"></label>` +
          `<label>Betrag (€)<input id="mn-af-amt" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${preset.amount ? esc(String(preset.amount).replace(".", ",")) : ""}"></label>` +
        `</div>` +
        `<div class="mn-af-res" aria-live="polite"></div>` +
        `<div class="fields"><div><p class="lbl mn-lbl">Kategorie</p><div class="chips mn-catchips mn-af-cats"></div></div></div>` +
        `<div class="row mn-af-act"><button type="button" class="btn ghost" data-af="no">Lieber nicht</button>` +
        `<button type="button" class="btn primary" data-af="buy" disabled>Kaufen &amp; eintragen</button></div>`,
      onMount(sheet, close) {
        const $ = (s) => sheet.querySelector(s);
        const note = $("#mn-af-note"), amtIn = $("#mn-af-amt"), chips = $(".mn-af-cats"), resEl = $(".mn-af-res"), buy = $("[data-af=buy]");
        const drawChips = () => {
          chips.innerHTML = outCats().map((c) => `<button type="button" class="chip mn-cat" data-cat="${esc(c.id)}" aria-pressed="${c.id === st.cat}" style="--c:${esc(c.color || "#64748b")}"><span>${esc(c.emoji || "")}</span>${esc(c.name)}</button>`).join("");
        };
        const amount = () => {
          const a = M.parseAmount(amtIn.value);
          if (a > 0) return a;
          return M.splitNoteAmount(note.value).amount;
        };
        const update = () => {
          const sp = M.splitNoteAmount(note.value);
          if (!st.touched) {
            const valid = new Set(outCats().map((c) => c.id));
            const sg = M.suggestCategory(sp.note || note.value, col.rules.all(), valid);
            const next = sg ? sg.cat : "";
            if (next !== st.cat) { st.cat = next; drawChips(); }
          }
          amtIn.placeholder = sp.amount > 0 ? String(sp.amount).replace(".", ",") : "0,00";
          const a = amount();
          if (!(a > 0)) { resEl.innerHTML = `<p class="note">Betrag eingeben – die App rechnet mit deinem Budget, Kontostand, Abos und Sparzielen.</p>`; buy.disabled = true; st.res = null; return; }
          const r = M.affordCheck({
            amount: a, cat: st.cat || null, note: sp.note || note.value, today: M.todayKey(),
            txs: col.tx.all(), budgets: col.budget.all(), cats: cats(), rules: col.rules.all(),
            subs: col.subs.all(), goals: col.goals.all(), bank: bankStatus(),
          });
          st.res = r;
          if (!st.cat && r.cat) { st.cat = r.cat; drawChips(); }
          resEl.innerHTML = `<div class="mn-af-box ${r.verdict}">` +
              `<p class="mn-af-head">${esc(r.headline)}</p>` +
              `<ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` +
            `</div>`;
          buy.disabled = false;
          buy.textContent = r.verdict === "ja" ? "Kaufen & eintragen" : "Trotzdem kaufen & eintragen";
          buy.classList.toggle("danger", r.verdict === "nein");
          buy.classList.toggle("primary", r.verdict !== "nein");
        };
        drawChips(); update();
        setTimeout(() => { try { (preset.note ? amtIn : note).focus(); } catch { /* egal */ } }, 60);
        note.addEventListener("input", update);
        amtIn.addEventListener("input", update);
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("button");
          if (!b || !sheet.contains(b)) return;
          if (b.dataset.cat) { st.cat = b.dataset.cat; st.touched = true; drawChips(); update(); }
          else if (b.dataset.af === "no") { close(); ui.toast(st.res && st.res.verdict !== "ja" ? "Gute Entscheidung 💪" : "Ok, nichts eingetragen."); }
        });
        buy.addEventListener("click", async () => {
          const r = st.res;
          if (!r) return;
          const sp = M.splitNoteAmount(note.value);
          close();
          await safeWrite(col.tx.put({ date: M.todayKey(), amount: r.amount, type: "out", category: r.cat, note: (sp.note || note.value).trim() }), r.verdict === "ja" ? "Gebucht ✓" : "Gebucht – Budget im Blick behalten!");
        });
      },
    });
  }

  return {
    check,
    affordBtnHTML,
    budgetExtrasHTML,
    onClick,
    openAfford,
    destroy() { alive = false; clearTimeout(bannerTimer); el.removeEventListener("change", onChange); },
  };
}
