// Alltag › Geld: Übersicht · Buchungen · Budget · Sparziele · Abos · Teilen.
// Daten über js/alltag/db.js (Sammlungen money_tx, money_cats, money_rules, money_budget, money_goals, money_subs, money_split).
// Logik (Formatierung, Kategorien-Vorschlag, Abos, Ausgleich) in money-core.js.
import { collection } from "./db.js";
import * as M from "./money-core.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import * as ui from "../ui.js";
import { createGmail } from "./money-gmail.js";
import { createBank, bankMark } from "./money-bank.js";

const TABS = [
  ["uebersicht", "Übersicht", "pie"],
  ["buchungen", "Buchungen", "list"],
  ["budget", "Budget", "target"],
  ["ziele", "Sparziele", "piggy"],
  ["abos", "Abos", "repeat"],
  ["teilen", "Teilen", "users"],
];
const TAB_KEY = "stempelkarte.money.tab";
const FALLBACK_CAT = { id: "sonstiges", name: "Sonstiges", emoji: "📦", color: "#64748b", type: "out" };
const GOAL_EMOJIS = ["🎯", "🚗", "📱", "🏍️", "✈️", "🎮", "💻", "🎧", "🏖️", "🧰", "🎁", "🏠"];

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const amt = (v, o) => esc(M.eur(v, o));
const ruleId = (kw) => "r_" + String(kw).toLowerCase().replace(/[^a-z0-9]/g, (c) => "_" + c.charCodeAt(0).toString(36));

export function mount(el, ctx) {
  const col = {
    tx: collection("money_tx"),
    cats: collection("money_cats"),
    rules: collection("money_rules"),
    budget: collection("money_budget"),
    goals: collection("money_goals"),
    subs: collection("money_subs"),
    split: collection("money_split"),
    gmail: collection("money_gmail"), // nur {connected, lastScan, handled} – keine Mails
  };
  const S = {
    tab: TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "uebersicht",
    mk: M.monthOf(M.todayKey()),
    q: "",
    catFilter: "",
    group: null, // geöffnete Teilen-Gruppe
  };
  let alive = true;
  let seeded = false;
  let catching = false;
  let renderQueued = false;

  el.innerHTML =
    `<div class="mn">` +
      `<div class="mn-tabs" role="tablist" aria-label="Geld-Bereiche">` +
        TABS.map(([id, label, ic]) => `<button type="button" role="tab" class="mn-tab" data-tab="${id}" aria-selected="${id === S.tab}">${icon(ic, 18)}<span>${label}</span></button>`).join("") +
      `</div>` +
      `<div class="mn-page"></div>` +
      `<button type="button" class="mn-fab" data-mn="fab" aria-label="Hinzufügen">${icon("plus", 26)}</button>` +
    `</div>`;
  const page = el.querySelector(".mn-page");
  const tabsEl = el.querySelector(".mn-tabs");
  const gm = createGmail({
    col, ui,
    render: () => queue(),
    openSub: (sub, preset, onSaved) => openSub(sub, preset, onSaved),
    catOf: (id) => catOf(id),
    goSubs: () => { S.tab = "abos"; lsSet(TAB_KEY, S.tab); render(); window.scrollTo({ top: 0 }); },
  });
  const bk = createBank({ ui, render: () => queue() });

  /* ---------- Daten-Hilfen ---------- */

  const cats = () => {
    const list = M.sortCats(col.cats.all());
    return list.length ? list : M.DEFAULT_CATS;
  };
  const catMap = () => new Map(cats().map((c) => [c.id, c]));
  const catOf = (id, map = catMap()) => map.get(id) || { ...FALLBACK_CAT, id: id || "sonstiges", name: map.size && id && id !== "sonstiges" ? "Ohne Kategorie" : "Sonstiges" };
  const txs = () => col.tx.all();
  const allLoaded = () => Object.values(col).every((c) => c.loaded);

  async function safeWrite(p, okMsg) {
    try { await p; if (okMsg) ui.toast(okMsg); return true; }
    catch (err) { console.error(err); ui.toast("Speichern fehlgeschlagen: " + (err && err.message || err), 4000); return false; }
  }

  // Standard-Kategorien einmal anlegen (feste IDs → mehrere Geräte erzeugen keine Doppelten)
  function maybeSeed() {
    if (seeded || !col.cats.loaded) return;
    seeded = true;
    if (col.cats.all().length) return;
    DEFAULTS_SEED().forEach((c) => col.cats.put(c).catch((e) => console.warn(e)));
  }
  const DEFAULTS_SEED = () => M.DEFAULT_CATS.map((c, i) => ({ ...c, order: i }));

  // Fällige Abo-Zahlungen nachholen. Buchungs-ID = sub_<abo>_<datum> → nie doppelt.
  async function catchUpSubs() {
    if (catching || !col.subs.loaded || !col.tx.loaded) return;
    catching = true;
    try {
      const today = M.todayKey();
      const ids = new Set(txs().map((t) => t.id));
      let n = 0;
      for (const s of col.subs.all()) {
        const { txs: due, next } = M.dueBookings(s, today, ids);
        for (const t of due) { await col.tx.put(t); ids.add(t.id); n++; }
        if (next && next !== s.next) await col.subs.patch(s.id, { next });
      }
      if (n) ui.toast(n === 1 ? "1 Abo-Zahlung automatisch gebucht" : `${n} Abo-Zahlungen automatisch gebucht`, 3200);
    } catch (err) {
      console.warn("Abos nachholen:", err);
    } finally {
      catching = false;
    }
  }

  /* ---------- Rendern ---------- */

  function queue() {
    if (renderQueued || !alive) return;
    renderQueued = true;
    queueMicrotask(() => { renderQueued = false; if (alive) render(); });
  }

  function render() {
    maybeSeed();
    if (allLoaded()) catchUpSubs();
    tabsEl.querySelectorAll(".mn-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
    // Fokus/Cursor in Eingabefeldern (Suche) über das Neuzeichnen retten
    const a = document.activeElement;
    const keep = a && page.contains(a) && a.id ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
    page.dataset.tab = S.tab;
    page.innerHTML = PAGES[S.tab]();
    if (keep) {
      const n = page.querySelector("#" + keep.id);
      if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(keep.s, keep.e); } catch { /* egal */ } }
    }
    const fab = el.querySelector(".mn-fab");
    fab.setAttribute("aria-label", FAB_LABEL[S.tab] || "Hinzufügen");
    fab.hidden = S.tab === "budget";
  }
  const FAB_LABEL = { uebersicht: "Buchung hinzufügen", buchungen: "Buchung hinzufügen", ziele: "Sparziel hinzufügen", abos: "Abo hinzufügen", teilen: "Hinzufügen" };

  function monthNav() {
    const cur = M.monthOf(M.todayKey());
    return `<div class="nav mn-nav">` +
      `<button type="button" data-mn="mprev" aria-label="Voriger Monat">${icon("chevron-left", 20)}</button>` +
      `<b>${esc(M.monthLabel(S.mk))}</b>` +
      `<button type="button" data-mn="mnext" aria-label="Nächster Monat"${S.mk >= cur ? " disabled" : ""}>${icon("chevron-right", 20)}</button>` +
    `</div>`;
  }

  function emptyBox(title, text, act, btn = "+ Hinzufügen") {
    return `<div class="empty mn-empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>` +
      `<button type="button" class="btn primary sm" data-mn="${act}">${esc(btn)}</button></div>`;
  }

  function catBubble(c, size = "") {
    return `<span class="mn-bub${size ? " " + size : ""}" style="--c:${esc(c.color || "#64748b")}" aria-hidden="true">${esc(c.emoji || "•")}</span>`;
  }

  function txRow(t, map) {
    const c = catOf(t.category, map);
    const sign = t.type === "in" ? "+" : "−";
    return `<li><button type="button" class="mn-tx" data-mn="tx" data-id="${esc(t.id)}">` +
      catBubble(c) +
      `<span class="mn-tx-main"><b>${esc(t.note || c.name)}</b><small>${esc(c.name)}${t.recurringId ? ` · ${icon("repeat", 12)} Abo` : ""}${t.goalId ? " · Sparziel" : ""}${bankMark(t)}</small></span>` +
      `<span class="mn-tx-amt ${t.type === "in" ? "in" : "out"}">${sign}${amt(t.amount)}</span>` +
    `</button></li>`;
  }

  /* ---------- Übersicht ---------- */

  function donutSVG(parts, total) {
    if (!(total > 0)) return `<svg viewBox="0 0 42 42" class="mn-donut" aria-hidden="true"><circle cx="21" cy="21" r="15.915" class="mn-donut-bg"/></svg>`;
    let off = 0;
    const gap = parts.length > 1 ? 0.8 : 0;
    const segs = parts.map((p) => {
      const pct = (p.sum / total) * 100;
      const len = Math.max(0.01, pct - gap);
      const s = `<circle cx="21" cy="21" r="15.915" fill="none" stroke="${esc(p.color)}" stroke-width="6.2" stroke-dasharray="${len.toFixed(3)} ${(100 - len).toFixed(3)}" stroke-dashoffset="${(25 - off).toFixed(3)}"><title>${esc(p.name)}: ${esc(M.eur(p.sum))}</title></circle>`;
      off += pct;
      return s;
    }).join("");
    return `<svg viewBox="0 0 42 42" class="mn-donut" role="img" aria-label="Ausgaben nach Kategorie"><circle cx="21" cy="21" r="15.915" class="mn-donut-bg"/>${segs}</svg>`;
  }

  function pageOverview() {
    const map = catMap();
    const list = M.monthTx(txs(), S.mk);
    const tot = M.totals(list);
    const by = M.byCategory(list, "out");
    // max. 6 Stücke, Rest zusammenfassen
    let parts = by.map((b) => { const c = catOf(b.cat, map); return { ...b, name: c.name, emoji: c.emoji, color: c.color }; });
    if (parts.length > 7) {
      const rest = parts.slice(6).reduce((s, p) => s + p.sum, 0);
      parts = parts.slice(0, 6).concat([{ cat: "_rest", sum: M.round2(rest), name: "Weitere", emoji: "…", color: "#94a3b8" }]);
    }
    const hist = M.history(txs(), S.mk, 6);
    const hmax = Math.max(1, ...hist.map((h) => Math.max(h.in, h.out)));

    const hero = `<section class="card mn-hero">` +
      `<p class="lbl">Saldo ${esc(M.monthLabel(S.mk))}</p>` +
      `<div class="mn-hero-big ${tot.saldo < 0 ? "neg" : ""}">${amt(tot.saldo, { sign: true })}</div>` +
      `<div class="mn-hero-row">` +
        `<span class="mn-kpi in"><small>Einnahmen</small><b>${amt(tot.in)}</b></span>` +
        `<span class="mn-kpi out"><small>Ausgaben</small><b>${amt(tot.out)}</b></span>` +
      `</div>` +
    `</section>`;

    const donut = `<section class="card mn-card">` +
      `<h3 class="mn-h">Wofür gebe ich mein Geld aus?</h3>` +
      (parts.length
        ? `<div class="mn-donut-wrap">` +
            `<div class="mn-donut-box">${donutSVG(parts, tot.out)}<div class="mn-donut-c"><small>Ausgaben</small><b>${amt(tot.out, { cents: false })}</b></div></div>` +
            `<ul class="mn-legend">` + parts.map((p) =>
              `<li><button type="button" data-mn="catfilter" data-cat="${esc(p.cat)}"${p.cat === "_rest" ? " disabled" : ""}>` +
                `<i style="background:${esc(p.color)}"></i><span>${esc(p.emoji)} ${esc(p.name)}</span>` +
                `<b>${amt(p.sum)}</b><em>${Math.round((p.sum / tot.out) * 100)} %</em>` +
              `</button></li>`).join("") +
            `</ul>` +
          `</div>`
        : `<p class="note">In diesem Monat noch keine Ausgaben.</p>`) +
    `</section>`;

    const bars = `<section class="card mn-card">` +
      `<h3 class="mn-h">Verlauf 6 Monate</h3>` +
      `<div class="mn-bars" role="img" aria-label="Einnahmen und Ausgaben der letzten 6 Monate">` +
        hist.map((h) =>
          `<div class="mn-bar${h.mk === S.mk ? " cur" : ""}" title="${esc(M.monthLabel(h.mk))}: +${esc(M.eur(h.in))} / −${esc(M.eur(h.out))}">` +
            `<div class="mn-bar-cols"><span class="in" style="height:${((h.in / hmax) * 100).toFixed(1)}%"></span><span class="out" style="height:${((h.out / hmax) * 100).toFixed(1)}%"></span></div>` +
            `<small>${esc(M.monthLabel(h.mk, true))}</small>` +
          `</div>`).join("") +
      `</div>` +
      `<div class="mn-bars-leg"><span><i class="in"></i>Einnahmen</span><span><i class="out"></i>Ausgaben</span></div>` +
    `</section>`;

    // Budget-Warnungen
    const warn = budgetRows(list, map).filter((r) => r.level === "warn" || r.level === "over");
    const warnBox = warn.length ? `<section class="card mn-card">` +
      `<h3 class="mn-h">Budget-Hinweise</h3>` +
      `<ul class="mn-warns">${warn.map((r) => `<li class="${r.level}"><button type="button" data-mn="gotab" data-tab="budget">${r.emoji ? esc(r.emoji) + " " : ""}<span>${esc(r.name)}</span><b>${Math.round(r.ratio * 100)} %</b></button></li>`).join("")}</ul>` +
    `</section>` : "";

    // Nächste Zahlungen + Sparziele (kurz)
    const up = M.upcoming(col.subs.all(), M.todayKey(), 14).slice(0, 4);
    const upBox = up.length ? `<section class="card mn-card">` +
      `<h3 class="mn-h">Nächste Zahlungen</h3>` +
      `<ul class="mn-mini">${up.map((u) => `<li><span>${esc(dueLabel(u.date))}</span><b>${esc(u.sub.name)}</b><em>${amt(u.sub.amount)}</em></li>`).join("")}</ul>` +
    `</section>` : "";
    const goals = col.goals.all().filter((g) => (Number(g.saved) || 0) < (Number(g.target) || 0)).slice(0, 3);
    const goalBox = goals.length ? `<section class="card mn-card">` +
      `<h3 class="mn-h">Sparziele</h3>` +
      goals.map((g) => `<button type="button" class="mn-goal-mini" data-mn="gotab" data-tab="ziele"><span>${esc(g.emoji || "🎯")} ${esc(g.name)}</span><div class="progress"><div style="width:${pct(g.saved, g.target)}%"></div></div><small>${amt(g.saved)} von ${amt(g.target)}</small></button>`).join("") +
    `</section>` : "";

    const hasAny = txs().length > 0;
    return monthNav() + gm.hintHTML() +
      (hasAny ? "" : `<div class="hint mn-welcome">👋 Trag deine erste Einnahme (z. B. Lehrlingsentschädigung) oder Ausgabe ein – die Kategorie wird aus der Notiz erkannt.</div>`) +
      `<div class="mn-ov">${hero}${bk.linked() ? bk.cardHTML() : ""}${donut}${bars}${warnBox}${upBox}${goalBox}${bk.linked() ? "" : bk.cardHTML()}</div>`;
  }

  const pct = (a, b) => Math.max(0, Math.min(100, ((Number(a) || 0) / Math.max(0.01, Number(b) || 0)) * 100)).toFixed(1);

  function dueLabel(key) {
    const d = M.daysBetween(M.todayKey(), key);
    if (d === 0) return "Heute";
    if (d === 1) return "Morgen";
    const wd = M.WD[M.dateOf(key).getDay()];
    return `${wd}, ${M.fmtDate(key).slice(0, 6)}`;
  }

  /* ---------- Buchungen ---------- */

  function pageTx() {
    const map = catMap();
    const q = S.q.trim().toLowerCase();
    let list = txs();
    if (q) {
      list = list.filter((t) => {
        const c = catOf(t.category, map);
        return [t.note, c.name, M.fmtDate(t.date), String(t.amount).replace(".", ","), t.counterparty].some((x) => String(x || "").toLowerCase().includes(q));
      });
    } else list = M.monthTx(list, S.mk);
    if (S.catFilter) list = list.filter((t) => (t.category || "sonstiges") === S.catFilter);
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0)));
    const tot = M.totals(list);

    const days = new Map();
    for (const t of list) { if (!days.has(t.date)) days.set(t.date, []); days.get(t.date).push(t); }

    const fc = S.catFilter ? catOf(S.catFilter, map) : null;
    const head = `<div class="mn-search">` +
        `<span class="mn-search-ic">${icon("search", 18)}</span>` +
        `<input id="mn-q" type="search" placeholder="Suchen (Notiz, Kategorie, Betrag)" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search">` +
      `</div>` +
      `<div class="mn-tools">` +
        (fc ? `<button type="button" class="chip mn-filter" data-mn="clearfilter">${esc(fc.emoji)} ${esc(fc.name)} ✕</button>` : "") +
        `<button type="button" class="chip" data-mn="cats">${icon("tag", 16)} Kategorien</button>` +
      `</div>` +
      (q ? `<p class="note mn-count">${list.length} Treffer in allen Monaten</p>` : monthNav());

    const sum = list.length ? `<div class="mn-sumline"><span class="in">+${amt(tot.in)}</span><span class="out">−${amt(tot.out)}</span><b class="${tot.saldo < 0 ? "out" : "in"}">= ${amt(tot.saldo, { sign: true })}</b></div>` : "";

    const body = list.length
      ? [...days.entries()].map(([d, arr]) => {
          const ds = M.totals(arr);
          return `<section class="mn-day"><h4><span>${esc(M.WD[M.dateOf(d).getDay()])}, ${esc(M.fmtDate(d))}</span><em>${amt(ds.saldo, { sign: true })}</em></h4>` +
            `<ul class="mn-txlist">${arr.map((t) => txRow(t, map)).join("")}</ul></section>`;
        }).join("")
      : (q || S.catFilter
          ? `<div class="empty mn-empty"><h3>Nichts gefunden</h3><p>Probier ein anderes Suchwort.</p></div>`
          : emptyBox("Noch keine Buchungen", `Für ${M.monthLabel(S.mk)} ist noch nichts eingetragen.`, "newtx"));
    return head + sum + `<div class="mn-days">${body}</div>`;
  }

  /* ---------- Budget ---------- */

  function budgetRows(list, map) {
    const b = new Map(col.budget.all().map((x) => [x.id, Number(x.amount) || 0]));
    const by = new Map(M.byCategory(list, "out").map((x) => [x.cat, x.sum]));
    const rows = [];
    const totalLimit = b.get("total") || 0;
    const tot = M.totals(list).out;
    if (totalLimit > 0) rows.push({ id: "total", name: "Gesamt", emoji: "", spent: tot, limit: totalLimit, color: "var(--accent)", ...M.budgetLevel(tot, totalLimit) });
    for (const c of [...map.values()].filter((c) => c.type !== "in")) {
      const lim = b.get(c.id) || 0;
      if (lim <= 0) continue;
      const sp = by.get(c.id) || 0;
      rows.push({ id: c.id, name: c.name, emoji: c.emoji, spent: sp, limit: lim, color: c.color, ...M.budgetLevel(sp, lim) });
    }
    return rows;
  }

  function pageBudget() {
    const map = catMap();
    const list = M.monthTx(txs(), S.mk);
    const rows = budgetRows(list, map);
    const by = M.byCategory(list, "out");
    const without = by.filter((x) => !rows.some((r) => r.id === x.cat));
    const cur = S.mk === M.monthOf(M.todayKey());
    const now = new Date();
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayFrac = cur ? now.getDate() / daysIn : 1;

    const rowHTML = (r) => {
      const left = r.limit - r.spent;
      const msg = r.level === "over" ? `⚠️ ${amt(-left)} drüber` : r.level === "warn" ? `Achtung: ${Math.round(r.ratio * 100)} % verbraucht` : `noch ${amt(left)}`;
      return `<li class="mn-bud ${r.level}${r.id === "total" ? " total" : ""}" style="--c:${esc(r.color)}">` +
        `<div class="mn-bud-top"><span>${r.emoji ? esc(r.emoji) + " " : ""}<b>${esc(r.name)}</b></span><span class="mn-bud-v">${amt(r.spent)} <small>/ ${amt(r.limit)}</small></span></div>` +
        `<div class="mn-bud-bar"><div style="width:${Math.min(100, r.ratio * 100).toFixed(1)}%"></div>${cur ? `<i style="left:${(dayFrac * 100).toFixed(1)}%" title="Heute"></i>` : ""}</div>` +
        `<small class="mn-bud-msg">${msg}</small>` +
      `</li>`;
    };

    return monthNav() +
      `<div class="mn-budget-head"><p class="note">Monatliches Budget pro Kategorie. Ab 80 % gibt’s eine Warnung, ab 100 % wird’s rot.</p>` +
      `<button type="button" class="btn primary sm" data-mn="editbudget">${icon("pencil", 16)} Budget festlegen</button></div>` +
      (rows.length
        ? `<ul class="mn-buds">${rows.map(rowHTML).join("")}</ul>`
        : emptyBox("Noch kein Budget", "Leg fest, wie viel du pro Monat z. B. für Essen gehen oder Freizeit ausgeben willst.", "editbudget", "+ Budget festlegen")) +
      (without.length ? `<section class="card mn-card"><h3 class="mn-h">Ohne Budget</h3><ul class="mn-mini mn-mini-cat">${without.map((x) => { const c = catOf(x.cat, map); return `<li><span>${esc(c.emoji)}</span><b>${esc(c.name)}</b><em>${amt(x.sum)}</em></li>`; }).join("")}</ul></section>` : "");
  }

  /* ---------- Sparziele ---------- */

  function pageGoals() {
    const goals = col.goals.all().sort((a, b) => (a.done === b.done ? (a.created || 0) - (b.created || 0) : a.done ? 1 : -1));
    if (!goals.length) return emptyBox("Noch keine Sparziele", "Spar auf etwas Bestimmtes – z. B. Führerschein, Moped oder neues Handy.", "newgoal");
    const totalSaved = goals.reduce((s, g) => s + (Number(g.saved) || 0), 0);
    return `<div class="mn-goal-sum"><span>Gespart insgesamt</span><b>${amt(totalSaved)}</b></div>` +
      `<div class="mn-goals">` + goals.map((g) => {
        const p = M.goalPerMonth(g);
        const pc = pct(g.saved, g.target);
        let info;
        if (p.done) info = `🎉 Ziel erreicht!`;
        else if (p.late) info = `Zieldatum vorbei – noch ${amt(p.rest)}`;
        else if (p.perMonth != null) info = `noch <b>${amt(p.perMonth)}</b> pro Monat (${p.months} ${p.months === 1 ? "Monat" : "Monate"})`;
        else info = `noch ${amt(p.rest)}`;
        return `<article class="card mn-goal${p.done ? " done" : ""}" style="--c:${esc(g.color || "#14b8a6")}">` +
          `<button type="button" class="mn-goal-head" data-mn="editgoal" data-id="${esc(g.id)}">` +
            `<span class="mn-goal-emo">${esc(g.emoji || "🎯")}</span>` +
            `<span class="mn-goal-t"><b>${esc(g.name || "Sparziel")}</b><small>${M.isKey(g.date) ? "bis " + esc(M.fmtDate(g.date)) : "ohne Datum"}</small></span>` +
            `<span class="mn-goal-p">${Math.floor(pc)} %</span>` +
          `</button>` +
          `<div class="mn-goal-bar"><div style="width:${pc}%"></div></div>` +
          `<div class="mn-goal-v"><b>${amt(g.saved)}</b><span>von ${amt(g.target)}</span></div>` +
          `<p class="mn-goal-info">${info}</p>` +
          `<div class="row"><button type="button" class="btn sm primary" data-mn="deposit" data-id="${esc(g.id)}">${icon("plus", 16)} Einzahlen</button>` +
          `<button type="button" class="btn sm ghost" data-mn="withdraw" data-id="${esc(g.id)}">Abheben</button></div>` +
        `</article>`;
      }).join("") + `</div>`;
  }

  /* ---------- Abos ---------- */

  function pageSubs() {
    const map = catMap();
    const subs = col.subs.all().sort((a, b) => (!!a.ended - !!b.ended) || String(a.next || "9").localeCompare(String(b.next || "9")));
    if (!subs.length) return gm.cardHTML() + emptyBox("Noch keine Abos", "Netflix, Spotify, Handyvertrag, Fitnessstudio … – trag sie ein, sie werden am Fälligkeitstag automatisch gebucht.", "newsub");
    const active = subs.filter((s) => !s.paused);
    const perMonth = active.reduce((s, x) => s + M.monthlyCost(x), 0);
    const perYear = active.reduce((s, x) => s + M.yearlyCost(x), 0);
    const up = M.upcoming(active, M.todayKey(), 31);
    return gm.cardHTML() + `<div class="mn-sub-sum">` +
        `<div class="card"><small>pro Monat</small><b>${amt(perMonth)}</b></div>` +
        `<div class="card"><small>pro Jahr</small><b>${amt(perYear)}</b></div>` +
      `</div>` +
      (up.length ? `<section class="card mn-card"><h3 class="mn-h">Nächste Zahlungen (31 Tage)</h3><ul class="mn-mini">${up.slice(0, 8).map((u) => `<li><span>${esc(dueLabel(u.date))}</span><b>${esc(u.sub.name)}</b><em>${amt(u.sub.amount)}</em></li>`).join("")}</ul></section>` : "") +
      `<h3 class="mn-h mn-h-out">Alle Abos &amp; Fixkosten</h3>` +
      `<ul class="mn-subs">` + subs.map((s) => {
        const c = catOf(s.category || "abos", map);
        return `<li><button type="button" class="mn-tx${s.paused ? " paused" : ""}" data-mn="editsub" data-id="${esc(s.id)}">` +
          catBubble(c) +
          `<span class="mn-tx-main"><b>${esc(s.name)}</b><small>${esc(M.INTERVALS[s.interval] || "monatlich")} · ${s.ended ? "beendet " + esc(M.fmtDate(s.ended)) : s.paused ? "pausiert" : esc(M.fmtDate(s.next))}${s.source === "gmail" ? " · aus Gmail" : ""}</small></span>` +
          `<span class="mn-tx-amt out">${amt(s.amount)}<small>${s.interval !== "month" ? "≈ " + amt(M.monthlyCost(s)) + "/Mon." : ""}</small></span>` +
        `</button></li>`;
      }).join("") + `</ul>` +
      `<p class="note">Fällige Zahlungen werden beim Öffnen automatisch als Buchung eingetragen (jede nur einmal).</p>`;
  }

  /* ---------- Teilen ---------- */

  function pageSplit() {
    const groups = col.split.all().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const g = S.group && col.split.get(S.group);
    if (g) return groupDetail(g);
    S.group = null;
    if (!groups.length) return emptyBox("Mit Freunden teilen", "Leg eine Gruppe an (z. B. „Urlaub Lignano“ oder „WG“), trag ein, wer was bezahlt hat – die App rechnet aus, wer wem wie viel schuldet.", "newgroup", "+ Gruppe anlegen");
    return `<ul class="mn-groups">` + groups.map((gr) => {
      const st = M.settle(gr);
      const mine = st.filter((t) => t.to === M.ME).reduce((s, t) => s + t.amount, 0) - st.filter((t) => t.from === M.ME).reduce((s, t) => s + t.amount, 0);
      const people = (gr.people || []).filter((p) => p.id !== M.ME).map((p) => p.name).join(", ");
      return `<li><button type="button" class="mn-group" data-mn="opengroup" data-id="${esc(gr.id)}">` +
        `<span class="mn-group-ic">${icon("users", 22)}</span>` +
        `<span class="mn-tx-main"><b>${esc(gr.name)}</b><small>${esc(people || "Noch niemand")}</small></span>` +
        `<span class="mn-group-bal ${mine > 0.004 ? "in" : mine < -0.004 ? "out" : ""}">${st.length ? (mine > 0.004 ? "bekommst " + amt(mine) : mine < -0.004 ? "schuldest " + amt(-mine) : "offen") : "✓ beglichen"}</span>` +
      `</button></li>`;
    }).join("") + `</ul>`;
  }

  function groupDetail(g) {
    const exp = (g.expenses || []).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const st = M.settle(g);
    const bal = M.balances(g);
    const total = exp.filter((e) => e.kind !== "pay").reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return `<div class="mn-gd-head">` +
        `<button type="button" class="chip" data-mn="closegroup">${icon("chevron-left", 16)} Gruppen</button>` +
        `<button type="button" class="chip" data-mn="editgroup" data-id="${esc(g.id)}">${icon("pencil", 16)} Bearbeiten</button>` +
      `</div>` +
      `<section class="card mn-card mn-gd">` +
        `<h3 class="mn-gd-t">${esc(g.name)}</h3>` +
        `<div class="mn-people">${(g.people || []).map((p) => { const v = bal.get(p.id) || 0; return `<span class="mn-person"><b>${esc(p.id === M.ME ? "Du" : p.name)}</b><small class="${v > 0.004 ? "in" : v < -0.004 ? "out" : ""}">${amt(v, { sign: true })}</small></span>`; }).join("")}</div>` +
        `<p class="note">Ausgaben gesamt: <b>${amt(total)}</b></p>` +
      `</section>` +
      `<section class="card mn-card">` +
        `<h3 class="mn-h">Ausgleich</h3>` +
        (st.length
          ? `<ul class="mn-settle">${st.map((t, i) => `<li class="${t.to === M.ME ? "in" : t.from === M.ME ? "out" : ""}"><span>${esc(M.settleSentence(g, t))}</span><button type="button" class="btn sm ghost" data-mn="settle" data-i="${i}">Beglichen</button></li>`).join("")}</ul>` +
            `<div class="row"><button type="button" class="btn sm ghost" data-mn="sharegroup">${icon("share", 16)} Als Text teilen</button><button type="button" class="btn sm ghost" data-mn="settleall">Alles beglichen</button></div>`
          : `<p class="mn-ok">✅ Alles ausgeglichen.</p><div class="row"><button type="button" class="btn sm ghost" data-mn="sharegroup">${icon("share", 16)} Als Text teilen</button></div>`) +
      `</section>` +
      `<section class="mn-days">` +
        (exp.length
          ? `<ul class="mn-txlist">${exp.map((e) => {
              const isPay = e.kind === "pay";
              const who = M.personName(g, e.paidBy, { me: "Du" });
              const forTxt = isPay ? `an ${M.personName(g, e.to, { me: "dich" })}` : forLabel(g, e.forIds);
              return `<li><button type="button" class="mn-tx${isPay ? " pay" : ""}" data-mn="editexp" data-id="${esc(e.id)}">` +
                `<span class="mn-bub" style="--c:${isPay ? "#059669" : "#8b5cf6"}" aria-hidden="true">${isPay ? "✓" : "🧾"}</span>` +
                `<span class="mn-tx-main"><b>${esc(isPay ? "Ausgleich" : e.desc || "Ausgabe")}</b><small>${esc(M.fmtDate(e.date))} · ${esc(who)} ${isPay ? "zahlt" : "hat bezahlt"} · ${esc(forTxt)}</small></span>` +
                `<span class="mn-tx-amt">${amt(e.amount)}</span>` +
              `</button></li>`;
            }).join("")}</ul>`
          : emptyBox("Noch keine Ausgaben", "Trag ein, wer was bezahlt hat.", "newexp", "+ Ausgabe")) +
      `</section>`;
  }

  function forLabel(g, ids) {
    const all = (g.people || []).map((p) => p.id);
    const f = ids && ids.length ? ids : all;
    if (f.length === all.length) return "für alle";
    return "für " + f.map((id) => M.personName(g, id, { me: "dich" })).join(", ");
  }

  const PAGES = { uebersicht: pageOverview, buchungen: pageTx, budget: pageBudget, ziele: pageGoals, abos: pageSubs, teilen: pageSplit };

  /* ---------- Sheets ---------- */

  function catChips(type, sel) {
    return cats().filter((c) => (type === "in" ? c.type === "in" : c.type !== "in"))
      .map((c) => `<button type="button" class="chip mn-cat" data-cat="${esc(c.id)}" aria-pressed="${c.id === sel}" style="--c:${esc(c.color)}"><span>${esc(c.emoji)}</span>${esc(c.name)}</button>`).join("");
  }

  function openTx(tx = null) {
    const isNew = !tx;
    const st = {
      type: tx ? (tx.type === "in" ? "in" : "out") : "out",
      amount: tx ? String(M.round2(tx.amount).toFixed(2)).replace(".", ",").replace(/,00$/, "") : "",
      cat: tx ? tx.category || "" : "",
      catTouched: !!tx,
    };
    const body =
      `<div class="mn-io" role="group" aria-label="Art">` +
        `<button type="button" data-type="out" aria-pressed="${st.type === "out"}">− Ausgabe</button>` +
        `<button type="button" data-type="in" aria-pressed="${st.type === "in"}">+ Einnahme</button>` +
      `</div>` +
      `<div class="mn-amount" data-type="${st.type}" aria-live="polite"><span class="mn-amount-v"></span><span class="mn-amount-cur">€</span></div>` +
      `<div class="mn-keys">` +
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].map((k) => `<button type="button" data-key="${k}"${k === "⌫" ? ' aria-label="Löschen"' : ""}>${k}</button>`).join("") +
      `</div>` +
      `<div class="fields">` +
        `<label>Notiz<input id="mn-note" type="text" maxlength="80" placeholder="z. B. Billa, OMV, Netflix …" value="${esc(tx ? tx.note || "" : "")}" autocomplete="off"></label>` +
        `<p class="mn-suggest note" hidden></p>` +
        `<div><p class="lbl mn-lbl">Kategorie</p><div class="chips mn-catchips"></div></div>` +
        `<label>Datum<input id="mn-date" type="date" value="${esc(tx ? tx.date : M.todayKey())}"></label>` +
      `</div>` +
      `<div class="row">` +
        (isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`) +
        `<button type="button" class="btn primary" data-save>Speichern</button>` +
      `</div>` +
      (tx && tx.recurringId ? `<p class="note">Automatisch aus einem Abo gebucht.</p>` : "") +
      (tx && (tx.src === "bank" || tx.bankRef) ? `<p class="note">🏦 Von der Bank übernommen${tx.counterparty ? ` – ${esc(tx.counterparty)}` : ""}${tx.bankText && tx.bankText !== tx.counterparty ? ` · „${esc(String(tx.bankText).slice(0, 120))}“` : ""}. Deine Änderungen hier überschreibt der Abgleich nicht.</p>` : "");

    ui.openSheet({
      title: isNew ? "Neue Buchung" : "Buchung bearbeiten",
      bodyHTML: body,
      onMount(sheet, close) {
        const $ = (s) => sheet.querySelector(s);
        const vEl = $(".mn-amount-v"), amtBox = $(".mn-amount"), note = $("#mn-note"), sug = $(".mn-suggest"), chips = $(".mn-catchips");
        const showAmt = () => { vEl.textContent = st.amount || "0"; amtBox.dataset.type = st.type; amtBox.classList.toggle("is-empty", !st.amount); };
        const drawChips = () => {
          const valid = cats().filter((c) => (st.type === "in" ? c.type === "in" : c.type !== "in"));
          if (st.cat && !valid.some((c) => c.id === st.cat) && st.catTouched) st.cat = "";
          chips.innerHTML = catChips(st.type, st.cat) + `<button type="button" class="chip add" data-newcat>+ Neu</button>`;
        };
        const suggest = () => {
          const valid = new Set(cats().filter((c) => (st.type === "in" ? c.type === "in" : c.type !== "in")).map((c) => c.id));
          const s = M.suggestCategory(note.value, col.rules.all(), valid);
          if (s && !st.catTouched) { st.cat = s.cat; drawChips(); }
          if (s) {
            const c = catOf(s.cat);
            sug.hidden = false;
            sug.innerHTML = `${icon("sparkle", 14)} Vorschlag: <b>${esc(c.emoji)} ${esc(c.name)}</b>${s.source === "eigen" ? " (gelernt)" : ""}` +
              (st.cat !== s.cat ? ` <button type="button" class="linkbtn" data-usesug="${esc(s.cat)}">übernehmen</button>` : "");
          } else sug.hidden = true;
        };
        const press = (k) => {
          let a = st.amount;
          if (k === "⌫") a = a.slice(0, -1);
          else if (k === ",") { if (!a.includes(",")) a = (a || "0") + ","; }
          else {
            const [i, d] = a.split(",");
            if (d !== undefined && d.length >= 2) return;
            if (d === undefined && (i || "").replace(/^0/, "").length >= 6) return;
            a = a === "0" ? k : a + k;
          }
          st.amount = a;
          showAmt();
        };
        showAmt(); drawChips(); suggest();

        sheet.addEventListener("click", (ev) => {
          const t = ev.target.closest("button");
          if (!t || !sheet.contains(t)) return;
          if (t.dataset.key) { press(t.dataset.key); return; }
          if (t.dataset.type) {
            st.type = t.dataset.type;
            sheet.querySelectorAll("[data-type]").forEach((b) => { if (b.tagName === "BUTTON") b.setAttribute("aria-pressed", String(b.dataset.type === st.type)); });
            if (!st.catTouched || !cats().some((c) => c.id === st.cat && (st.type === "in" ? c.type === "in" : c.type !== "in"))) { st.cat = ""; st.catTouched = false; }
            showAmt(); drawChips(); suggest();
            return;
          }
          if (t.dataset.cat) { st.cat = t.dataset.cat; st.catTouched = true; drawChips(); suggest(); return; }
          if (t.dataset.usesug) { st.cat = t.dataset.usesug; st.catTouched = false; drawChips(); suggest(); return; }
          if (t.hasAttribute("data-newcat")) { openCatEdit(null, st.type, (id) => { st.cat = id; st.catTouched = true; drawChips(); }); return; }
        });
        note.addEventListener("input", suggest);
        // PC: Ziffern direkt tippen (außer im Notizfeld)
        sheet.addEventListener("keydown", (ev) => {
          if (ev.target.matches("input, textarea, select")) {
            if (ev.key === "Enter" && ev.target === note) { ev.preventDefault(); $("[data-save]").click(); }
            return;
          }
          if (/^[0-9]$/.test(ev.key)) { press(ev.key); ev.preventDefault(); }
          else if (ev.key === "," || ev.key === ".") { press(","); ev.preventDefault(); }
          else if (ev.key === "Backspace") { press("⌫"); ev.preventDefault(); }
          else if (ev.key === "Enter") { $("[data-save]").click(); ev.preventDefault(); }
        });

        $("[data-save]").addEventListener("click", async () => {
          const a = M.parseAmount(st.amount);
          if (!(a > 0)) { ui.toast("Bitte einen Betrag eingeben."); amtBox.classList.add("shake"); setTimeout(() => amtBox.classList.remove("shake"), 400); return; }
          const date = $("#mn-date").value;
          if (!M.isKey(date)) { ui.toast("Bitte ein Datum wählen."); return; }
          const noteV = note.value.trim();
          const cat = st.cat || (st.type === "in" ? "sonstein" : "sonstiges");
          const item = { ...(tx || {}), date, amount: a, type: st.type, category: cat, note: noteV };
          close();
          if (!(await safeWrite(col.tx.put(item), isNew ? "Gebucht ✓" : "Gespeichert ✓"))) return;
          // Lernen: eigene Zuordnung merken, wenn sie vom automatischen Vorschlag abweicht
          const kw = M.ruleKeyword(noteV);
          if (kw && st.catTouched) {
            const auto = M.suggestCategory(noteV, [], null);
            const existing = col.rules.get(ruleId(kw));
            if ((!auto || auto.cat !== cat) && (!existing || existing.cat !== cat)) col.rules.put({ id: ruleId(kw), keyword: kw, cat }).catch((e) => console.warn(e));
            else if (existing && auto && auto.cat === cat && existing.cat !== cat) col.rules.remove(existing.id).catch(() => {});
          }
          if (isNew && M.monthOf(date) !== S.mk && !S.q) { S.mk = M.monthOf(date); queue(); }
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => { close(); await safeWrite(col.tx.remove(tx.id), "Gelöscht"); });
      },
    });
  }

  function openCats() {
    ui.openSheet({
      title: "Kategorien",
      bodyHTML: `<div class="mn-catlist"></div>` +
        `<div class="row"><button type="button" class="btn sm ghost" data-add="out">+ Ausgabe-Kategorie</button><button type="button" class="btn sm ghost" data-add="in">+ Einnahme-Kategorie</button></div>` +
        `<h3 class="mn-h">Gelernte Zuordnungen</h3><div class="mn-rules"></div>` +
        `<p class="note">Wenn du bei einer Buchung eine andere Kategorie wählst, merkt sich die App das Stichwort aus der Notiz.</p>`,
      onMount(sheet) {
        const draw = () => {
          const list = cats();
          const sec = (type, title) => `<p class="lbl mn-lbl">${title}</p><ul class="mn-catrows">` + list.filter((c) => (type === "in") === (c.type === "in")).map((c) =>
            `<li><button type="button" class="mn-tx" data-edit="${esc(c.id)}">${catBubble(c)}<span class="mn-tx-main"><b>${esc(c.name)}</b></span>${icon("chevron-right", 18)}</button></li>`).join("") + `</ul>`;
          sheet.querySelector(".mn-catlist").innerHTML = sec("out", "Ausgaben") + sec("in", "Einnahmen");
          const rules = col.rules.all().sort((a, b) => String(a.keyword).localeCompare(String(b.keyword), "de"));
          sheet.querySelector(".mn-rules").innerHTML = rules.length
            ? `<ul class="mn-rulelist">${rules.map((r) => { const c = catOf(r.cat); return `<li><span>„${esc(r.keyword)}“ → ${esc(c.emoji)} ${esc(c.name)}</span><button type="button" class="linkbtn" data-delrule="${esc(r.id)}" aria-label="Zuordnung „${esc(r.keyword)}“ entfernen">${icon("trash", 16)}</button></li>`; }).join("")}</ul>`
            : `<p class="note">Noch nichts gelernt.</p>`;
        };
        draw();
        const offA = col.cats.watch(() => draw());
        const offB = col.rules.watch(() => draw());
        const obs = new MutationObserver(() => { if (!document.contains(sheet)) { offA(); offB(); obs.disconnect(); } });
        obs.observe(sheet.parentNode || document.body, { childList: true });
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("button");
          if (!b) return;
          if (b.dataset.edit) openCatEdit(col.cats.get(b.dataset.edit) || M.DEFAULT_CATS.find((c) => c.id === b.dataset.edit));
          else if (b.dataset.add) openCatEdit(null, b.dataset.add);
          else if (b.dataset.delrule) col.rules.remove(b.dataset.delrule).catch((e) => ui.toast(String(e.message || e)));
        });
      },
    });
  }

  function openCatEdit(cat = null, type = "out", onSaved = null) {
    const isNew = !cat;
    const c = cat || { name: "", emoji: type === "in" ? "💰" : "🏷️", color: M.CAT_COLORS[(cats().length) % M.CAT_COLORS.length], type };
    ui.openSheet({
      title: isNew ? "Neue Kategorie" : "Kategorie bearbeiten",
      bodyHTML: `<div class="fields">` +
          `<div class="row"><label style="flex:0 0 90px">Emoji<input id="mn-c-emo" type="text" maxlength="4" value="${esc(c.emoji)}" style="text-align:center;font-size:1.4rem"></label>` +
          `<label>Name<input id="mn-c-name" type="text" maxlength="30" value="${esc(c.name)}" placeholder="z. B. Moped"></label></div>` +
          `<div><p class="lbl mn-lbl">Farbe</p><div class="mn-colors">${M.CAT_COLORS.map((col_) => `<button type="button" data-color="${col_}" style="--c:${col_}" aria-label="Farbe ${col_}" aria-pressed="${col_ === c.color}"></button>`).join("")}</div></div>` +
          `<div class="mn-io" role="group" aria-label="Art"><button type="button" data-t="out" aria-pressed="${c.type !== "in"}">Ausgabe</button><button type="button" data-t="in" aria-pressed="${c.type === "in"}">Einnahme</button></div>` +
        `</div>` +
        `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        let color = c.color, t = c.type === "in" ? "in" : "out";
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("button");
          if (!b) return;
          if (b.dataset.color) { color = b.dataset.color; sheet.querySelectorAll("[data-color]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
          if (b.dataset.t) { t = b.dataset.t; sheet.querySelectorAll("[data-t]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
        });
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const name = sheet.querySelector("#mn-c-name").value.trim();
          if (!name) { ui.toast("Bitte einen Namen eingeben."); return; }
          const emoji = sheet.querySelector("#mn-c-emo").value.trim() || "🏷️";
          // Liegen noch keine Kategorien in der Sammlung, zuerst die Standard-Liste speichern
          if (!col.cats.all().length) await Promise.all(DEFAULTS_SEED().map((d) => col.cats.put(d))).catch(() => {});
          const id = (cat && cat.id) || undefined;
          const item = { ...(cat || {}), id, name, emoji, color, type: t, order: cat && cat.order != null ? cat.order : 100 + cats().length };
          close();
          try { const nid = await col.cats.put(item); if (onSaved) onSaved(nid); } catch (err) { ui.toast("Speichern fehlgeschlagen: " + (err.message || err), 4000); }
        });
        const del = sheet.querySelector("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => {
          close();
          await safeWrite(col.cats.remove(cat.id), "Kategorie gelöscht – Buchungen bleiben als „Ohne Kategorie“");
        });
      },
    });
  }

  function openBudget() {
    const b = new Map(col.budget.all().map((x) => [x.id, Number(x.amount) || 0]));
    const val = (id) => (b.get(id) ? String(b.get(id)).replace(".", ",") : "");
    const outCats = cats().filter((c) => c.type !== "in");
    ui.openSheet({
      title: "Monatsbudget",
      bodyHTML: `<p class="note">Leer lassen = kein Budget. Beträge pro Monat.</p>` +
        `<div class="fields mn-budform">` +
          `<label class="mn-budrow total"><span>💶 Gesamt</span><input data-b="total" inputmode="decimal" placeholder="—" value="${esc(val("total"))}"></label>` +
          outCats.map((c) => `<label class="mn-budrow"><span>${esc(c.emoji)} ${esc(c.name)}</span><input data-b="${esc(c.id)}" inputmode="decimal" placeholder="—" value="${esc(val(c.id))}"></label>`).join("") +
        `</div>` +
        `<button type="button" class="btn primary" data-save>Speichern</button>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const ops = [];
          let bad = false;
          sheet.querySelectorAll("[data-b]").forEach((inp) => {
            const id = inp.dataset.b;
            const raw = inp.value.trim();
            const v = raw ? M.parseAmount(raw) : 0;
            if (raw && !(v >= 0)) { bad = true; inp.focus(); return; }
            const had = b.get(id) || 0;
            if (v > 0 && v !== had) ops.push(col.budget.put({ id, amount: v }));
            else if (!(v > 0) && had) ops.push(col.budget.remove(id));
          });
          if (bad) { ui.toast("Bitte gültige Beträge eingeben."); return; }
          close();
          await safeWrite(Promise.all(ops), ops.length ? "Budget gespeichert ✓" : null);
        });
      },
    });
  }

  function openGoal(goal = null) {
    const isNew = !goal;
    const g = goal || { name: "", target: "", saved: 0, date: "", emoji: "🎯" };
    ui.openSheet({
      title: isNew ? "Neues Sparziel" : "Sparziel bearbeiten",
      bodyHTML: `<div class="fields">` +
          `<div><p class="lbl mn-lbl">Symbol</p><div class="chips mn-emos">${GOAL_EMOJIS.map((e) => `<button type="button" class="chip" data-emo="${e}" aria-pressed="${e === (g.emoji || "🎯")}">${e}</button>`).join("")}</div></div>` +
          `<label>Ziel<input id="mn-g-name" type="text" maxlength="40" placeholder="z. B. Führerschein" value="${esc(g.name)}"></label>` +
          `<div class="row"><label>Zielbetrag (€)<input id="mn-g-target" inputmode="decimal" placeholder="1.500" value="${g.target ? esc(String(g.target).replace(".", ",")) : ""}"></label>` +
          `<label>Schon gespart (€)<input id="mn-g-saved" inputmode="decimal" placeholder="0" value="${g.saved ? esc(String(g.saved).replace(".", ",")) : ""}"></label></div>` +
          `<label>Bis wann? (optional)<input id="mn-g-date" type="date" value="${esc(g.date || "")}"></label>` +
        `</div>` +
        `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        let emoji = g.emoji || "🎯";
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-emo]");
          if (!b) return;
          emoji = b.dataset.emo;
          sheet.querySelectorAll("[data-emo]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        });
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const name = sheet.querySelector("#mn-g-name").value.trim();
          const target = M.parseAmount(sheet.querySelector("#mn-g-target").value);
          const savedRaw = sheet.querySelector("#mn-g-saved").value.trim();
          const saved = savedRaw ? M.parseAmount(savedRaw) : 0;
          const date = sheet.querySelector("#mn-g-date").value;
          if (!name) { ui.toast("Wie heißt dein Ziel?"); return; }
          if (!(target > 0)) { ui.toast("Bitte einen Zielbetrag eingeben."); return; }
          if (!(saved >= 0)) { ui.toast("„Schon gespart“ ist ungültig."); return; }
          close();
          await safeWrite(col.goals.put({ ...(goal || {}), name, target, saved, date: M.isKey(date) ? date : "", emoji }), "Gespeichert ✓");
        });
        const del = sheet.querySelector("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => { close(); await safeWrite(col.goals.remove(goal.id), "Gelöscht"); });
      },
    });
  }

  function openDeposit(goal, sign = 1) {
    ui.openSheet({
      title: sign > 0 ? `Einzahlen: ${goal.name}` : `Abheben: ${goal.name}`,
      bodyHTML: `<div class="fields">` +
          `<label>Betrag (€)<input id="mn-d-amt" inputmode="decimal" placeholder="z. B. 50" autocomplete="off"></label>` +
          `<div class="chips">${[10, 20, 50, 100].map((v) => `<button type="button" class="chip" data-q="${v}">${v} €</button>`).join("")}</div>` +
          (sign > 0 ? `<label class="mn-check"><input type="checkbox" id="mn-d-book"> Auch als Ausgabe „Sparen“ buchen</label>` : "") +
        `</div>` +
        `<button type="button" class="btn primary" data-save>${sign > 0 ? "Einzahlen" : "Abheben"}</button>`,
      onMount(sheet, close) {
        const inp = sheet.querySelector("#mn-d-amt");
        setTimeout(() => { try { inp.focus(); } catch { /* egal */ } }, 50);
        sheet.addEventListener("click", (ev) => { const b = ev.target.closest("[data-q]"); if (b) inp.value = b.dataset.q; });
        const go = async () => {
          const a = M.parseAmount(inp.value);
          if (!(a > 0)) { ui.toast("Bitte einen Betrag eingeben."); return; }
          const cur = col.goals.get(goal.id) || goal;
          const saved = M.round2(Math.max(0, (Number(cur.saved) || 0) + sign * a));
          const book = sign > 0 && sheet.querySelector("#mn-d-book") && sheet.querySelector("#mn-d-book").checked;
          close();
          const ok = await safeWrite(col.goals.patch(goal.id, { saved }), null);
          if (ok && book) await safeWrite(col.tx.put({ date: M.todayKey(), amount: a, type: "out", category: catMap().has("sparen") ? "sparen" : "sonstiges", note: `Sparziel: ${cur.name}`, goalId: goal.id }), null);
          if (ok) {
            const reached = sign > 0 && saved >= (Number(cur.target) || 0) && (Number(cur.saved) || 0) < (Number(cur.target) || 0);
            ui.toast(reached ? "🎉 Ziel erreicht! Gratuliere!" : `${sign > 0 ? "Eingezahlt" : "Abgehoben"} ✓ – Stand ${M.eur(saved)}`, 3000);
          }
        };
        sheet.querySelector("[data-save]").addEventListener("click", go);
        inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
      },
    });
  }

  function openSub(sub = null, preset = null, onSaved = null) {
    const isNew = !sub;
    const s = sub || { name: "", amount: "", interval: "month", next: M.todayKey(), category: "abos", paused: false, ...(preset || {}) };
    const outCats = cats().filter((c) => c.type !== "in");
    ui.openSheet({
      title: isNew ? "Neues Abo / Fixkosten" : "Abo bearbeiten",
      bodyHTML: `<div class="fields">` +
          `<label>Name<input id="mn-s-name" type="text" maxlength="40" placeholder="z. B. Spotify, Handy, Fitnessstudio" value="${esc(s.name)}"></label>` +
          `<div class="row"><label>Betrag (€)<input id="mn-s-amt" inputmode="decimal" placeholder="9,99" value="${s.amount ? esc(String(s.amount).replace(".", ",")) : ""}"></label>` +
          `<label>Intervall<select id="mn-s-int">${Object.entries(M.INTERVALS).map(([k, v]) => `<option value="${k}"${k === s.interval ? " selected" : ""}>${v}</option>`).join("")}</select></label></div>` +
          `<div class="row"><label>Nächster Termin<input id="mn-s-next" type="date" value="${esc(s.next || M.todayKey())}"></label>` +
          `<label>Kategorie<select id="mn-s-cat">${outCats.map((c) => `<option value="${esc(c.id)}"${c.id === s.category ? " selected" : ""}>${esc(c.emoji)} ${esc(c.name)}</option>`).join("")}</select></label></div>` +
          `<label class="mn-check"><input type="checkbox" id="mn-s-pause"${s.paused ? " checked" : ""}> Pausiert (wird nicht gebucht)</label>` +
          (s.ended ? `<p class="note">Beendet am ${esc(M.fmtDate(s.ended))} (Kündigung). Häkchen weg = wieder aktiv.</p>` : "") +
          `<p class="note">Liegt der Termin heute oder in der Vergangenheit, wird die Zahlung sofort gebucht.</p>` +
        `</div>` +
        `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const name = sheet.querySelector("#mn-s-name"), catSel = sheet.querySelector("#mn-s-cat");
        let catTouched = !isNew;
        catSel.addEventListener("change", () => { catTouched = true; });
        name.addEventListener("input", () => {
          if (catTouched) return;
          const sg = M.suggestCategory(name.value, col.rules.all(), new Set(outCats.map((c) => c.id)));
          if (sg) catSel.value = sg.cat;
        });
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const n = name.value.trim();
          const a = M.parseAmount(sheet.querySelector("#mn-s-amt").value);
          const next = sheet.querySelector("#mn-s-next").value;
          if (!n) { ui.toast("Bitte einen Namen eingeben."); return; }
          if (!(a > 0)) { ui.toast("Bitte einen Betrag eingeben."); return; }
          if (!M.isKey(next)) { ui.toast("Bitte den nächsten Termin wählen."); return; }
          const interval = sheet.querySelector("#mn-s-int").value;
          const day = interval === "week" ? null : M.dateOf(next).getDate();
          close();
          const paused = sheet.querySelector("#mn-s-pause").checked;
          const extra = isNew && preset ? { source: preset.source, gmail: preset.gmail } : {};
          const ok = await safeWrite(col.subs.put({ ...(sub || {}), ...extra, name: n, amount: a, interval, next, day, category: catSel.value, paused, ...(paused ? {} : { ended: null }) }), "Gespeichert ✓");
          if (ok && onSaved) onSaved();
        });
        const del = sheet.querySelector("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => { close(); await safeWrite(col.subs.remove(sub.id), "Abo gelöscht – bisherige Buchungen bleiben"); });
      },
    });
  }

  function openGroup(group = null) {
    const isNew = !group;
    const people = group ? (group.people || []).filter((p) => p.id !== M.ME).map((p) => ({ ...p })) : [];
    ui.openSheet({
      title: isNew ? "Neue Gruppe" : "Gruppe bearbeiten",
      bodyHTML: `<div class="fields">` +
          `<label>Name der Gruppe<input id="mn-gr-name" type="text" maxlength="40" placeholder="z. B. Urlaub Lignano" value="${esc(group ? group.name : "")}"></label>` +
          `<div><p class="lbl mn-lbl">Personen (du bist automatisch dabei)</p><div class="chips mn-ppl"></div></div>` +
          `<div class="row"><input id="mn-gr-p" type="text" maxlength="24" placeholder="Name, z. B. Max" autocomplete="off"><button type="button" class="btn sm ghost" data-addp>+ Dazu</button></div>` +
        `</div>` +
        `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Gruppe löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const pin = sheet.querySelector("#mn-gr-p");
        const used = (id) => group && (group.expenses || []).some((e) => e.paidBy === id || e.to === id || (e.forIds || []).includes(id));
        const draw = () => {
          sheet.querySelector(".mn-ppl").innerHTML = `<span class="chip" aria-disabled="true">Du</span>` +
            people.map((p, i) => `<button type="button" class="chip" data-rm="${i}" aria-label="${esc(p.name)} entfernen">${esc(p.name)}${used(p.id) ? "" : " ✕"}</button>`).join("");
        };
        const add = () => {
          const n = pin.value.trim();
          if (!n) return;
          if (people.some((p) => p.name.toLowerCase() === n.toLowerCase())) { ui.toast("Gibt’s schon."); return; }
          people.push({ id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: n });
          pin.value = ""; draw(); pin.focus();
        };
        draw();
        sheet.querySelector("[data-addp]").addEventListener("click", add);
        pin.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); add(); } });
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-rm]");
          if (!b) return;
          const p = people[Number(b.dataset.rm)];
          if (used(p.id)) { ui.toast(`${p.name} hat schon Ausgaben – zuerst diese löschen.`, 3000); return; }
          people.splice(Number(b.dataset.rm), 1); draw();
        });
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          if (pin.value.trim()) add();
          const name = sheet.querySelector("#mn-gr-name").value.trim();
          if (!name) { ui.toast("Bitte einen Namen eingeben."); return; }
          if (!people.length) { ui.toast("Füg mindestens eine Person hinzu."); return; }
          close();
          const item = { ...(group || { expenses: [] }), name, people: [{ id: M.ME, name: "Ich" }, ...people] };
          try { const id = await col.split.put(item); S.group = id; queue(); } catch (err) { ui.toast("Speichern fehlgeschlagen: " + (err.message || err), 4000); }
        });
        const del = sheet.querySelector("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => { close(); S.group = null; await safeWrite(col.split.remove(group.id), "Gruppe gelöscht"); });
      },
    });
  }

  function openExpense(group, exp = null) {
    const isNew = !exp;
    const all = (group.people || []).map((p) => p.id);
    const e = exp || { desc: "", amount: "", date: M.todayKey(), paidBy: M.ME, forIds: all.slice() };
    const isPay = e.kind === "pay";
    const pname = (id) => M.personName(group, id, { me: "Du" });
    ui.openSheet({
      title: isPay ? "Ausgleich" : isNew ? "Neue Ausgabe" : "Ausgabe bearbeiten",
      bodyHTML: isPay
        ? `<p>${esc(pname(e.paidBy))} → ${esc(pname(e.to))}: <b>${amt(e.amount)}</b> am ${esc(M.fmtDate(e.date))}</p>` +
          `<button type="button" class="btn danger sm" data-del>Ausgleich zurücknehmen</button>`
        : `<div class="fields">` +
            `<label>Wofür?<input id="mn-e-desc" type="text" maxlength="50" placeholder="z. B. Pizza, Tanken, Ferienwohnung" value="${esc(e.desc || "")}"></label>` +
            `<div class="row"><label>Betrag (€)<input id="mn-e-amt" inputmode="decimal" placeholder="0,00" value="${e.amount ? esc(String(e.amount).replace(".", ",")) : ""}"></label>` +
            `<label>Datum<input id="mn-e-date" type="date" value="${esc(e.date || M.todayKey())}"></label></div>` +
            `<div><p class="lbl mn-lbl">Wer hat bezahlt?</p><div class="chips" data-g="paid">${all.map((id) => `<button type="button" class="chip" data-p="${esc(id)}" aria-pressed="${id === e.paidBy}">${esc(pname(id))}</button>`).join("")}</div></div>` +
            `<div><p class="lbl mn-lbl">Für wen? <button type="button" class="linkbtn" data-allf>alle</button></p><div class="chips" data-g="for">${all.map((id) => `<button type="button" class="chip" data-f="${esc(id)}" aria-pressed="${(e.forIds && e.forIds.length ? e.forIds : all).includes(id)}">${esc(pname(id))}</button>`).join("")}</div></div>` +
            `<p class="note mn-each"></p>` +
          `</div>` +
          `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const saveGroup = async (expenses, msg) => {
          const cur = col.split.get(group.id) || group;
          await safeWrite(col.split.patch(group.id, { expenses: expenses(cur.expenses || []) }), msg);
        };
        const del = sheet.querySelector("[data-del]");
        if (del) ui.confirmButton(del, isPay ? "Wirklich?" : "Wirklich löschen?", async () => { close(); await saveGroup((list) => list.filter((x) => x.id !== exp.id), "Gelöscht"); });
        if (isPay) return;
        let paidBy = e.paidBy || M.ME;
        const fors = new Set(e.forIds && e.forIds.length ? e.forIds : all);
        const amtIn = sheet.querySelector("#mn-e-amt");
        const each = () => {
          const a = M.parseAmount(amtIn.value);
          sheet.querySelector(".mn-each").textContent = a > 0 && fors.size ? `= ${M.eur(a / fors.size)} pro Person (${fors.size})` : "";
        };
        each();
        amtIn.addEventListener("input", each);
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("button");
          if (!b) return;
          if (b.dataset.p) { paidBy = b.dataset.p; sheet.querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
          else if (b.dataset.f) {
            if (fors.has(b.dataset.f)) { if (fors.size > 1) fors.delete(b.dataset.f); } else fors.add(b.dataset.f);
            sheet.querySelectorAll("[data-f]").forEach((x) => x.setAttribute("aria-pressed", String(fors.has(x.dataset.f)))); each();
          } else if (b.hasAttribute("data-allf")) {
            all.forEach((id) => fors.add(id));
            sheet.querySelectorAll("[data-f]").forEach((x) => x.setAttribute("aria-pressed", "true")); each();
          }
        });
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const desc = sheet.querySelector("#mn-e-desc").value.trim();
          const a = M.parseAmount(amtIn.value);
          const date = sheet.querySelector("#mn-e-date").value;
          if (!(a > 0)) { ui.toast("Bitte einen Betrag eingeben."); return; }
          const item = { id: exp ? exp.id : "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), desc, amount: a, date: M.isKey(date) ? date : M.todayKey(), paidBy, forIds: fors.size === all.length ? [] : [...fors] };
          close();
          await saveGroup((list) => (exp ? list.map((x) => (x.id === exp.id ? item : x)) : list.concat([item])), isNew ? "Ausgabe eingetragen ✓" : "Gespeichert ✓");
        });
      },
    });
  }

  async function addPayments(group, transfers) {
    const cur = col.split.get(group.id) || group;
    const now = Date.now().toString(36);
    const pays = transfers.map((t, i) => ({ id: `pay${now}${i}`, kind: "pay", paidBy: t.from, to: t.to, amount: t.amount, date: M.todayKey() }));
    await safeWrite(col.split.patch(group.id, { expenses: (cur.expenses || []).concat(pays) }), pays.length > 1 ? "Alles beglichen ✓" : "Beglichen ✓");
  }

  async function shareGroup(group) {
    const text = M.shareText(group);
    try {
      if (navigator.share) { await navigator.share({ title: group.name, text }); return; }
    } catch (err) { if (err && err.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(text); ui.toast("Text kopiert – jetzt z. B. in WhatsApp einfügen"); }
    catch {
      ui.openSheet({ title: "Zum Kopieren", bodyHTML: `<textarea readonly rows="10" style="font-family:var(--f-mono);font-size:.85rem">${esc(text)}</textarea>`, onMount(s) { const t = s.querySelector("textarea"); t.focus(); t.select(); } });
    }
  }

  /* ---------- Ereignisse ---------- */

  function onClick(ev) {
    const g = ev.target.closest("[data-gm]");
    if (g && el.contains(g) && gm.onClick(g)) return;
    const b = ev.target.closest("[data-bk]");
    if (b && el.contains(b) && bk.onClick(b)) return;
    const t = ev.target.closest("[data-tab], [data-mn]");
    if (!t || !el.contains(t)) return;
    if (t.classList.contains("mn-tab")) {
      S.tab = t.dataset.tab; lsSet(TAB_KEY, S.tab);
      if (S.tab !== "buchungen") S.catFilter = "";
      render();
      t.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      return;
    }
    const id = t.dataset.id;
    switch (t.dataset.mn) {
      case "fab":
        if (S.tab === "ziele") openGoal();
        else if (S.tab === "abos") openSub();
        else if (S.tab === "teilen") { const g = S.group && col.split.get(S.group); if (g) openExpense(g); else openGroup(); }
        else openTx();
        break;
      case "newtx": openTx(); break;
      case "tx": openTx(col.tx.get(id)); break;
      case "mprev": S.mk = M.shiftMonth(S.mk, -1); render(); break;
      case "mnext": S.mk = M.shiftMonth(S.mk, 1); render(); break;
      case "gotab": S.tab = t.dataset.tab; lsSet(TAB_KEY, S.tab); render(); window.scrollTo({ top: 0 }); break;
      case "catfilter": S.catFilter = t.dataset.cat; S.tab = "buchungen"; lsSet(TAB_KEY, S.tab); render(); window.scrollTo({ top: 0 }); break;
      case "clearfilter": S.catFilter = ""; render(); break;
      case "cats": openCats(); break;
      case "editbudget": openBudget(); break;
      case "newgoal": openGoal(); break;
      case "editgoal": openGoal(col.goals.get(id)); break;
      case "deposit": openDeposit(col.goals.get(id), 1); break;
      case "withdraw": openDeposit(col.goals.get(id), -1); break;
      case "newsub": openSub(); break;
      case "editsub": openSub(col.subs.get(id)); break;
      case "newgroup": openGroup(); break;
      case "opengroup": S.group = id; render(); window.scrollTo({ top: 0 }); break;
      case "closegroup": S.group = null; render(); break;
      case "editgroup": openGroup(col.split.get(id)); break;
      case "newexp": { const g = col.split.get(S.group); if (g) openExpense(g); break; }
      case "editexp": { const g = col.split.get(S.group); const e = g && (g.expenses || []).find((x) => x.id === id); if (e) openExpense(g, e); break; }
      case "settle": { const g = col.split.get(S.group); if (g) { const tr = M.settle(g)[Number(t.dataset.i)]; if (tr) addPayments(g, [tr]); } break; }
      case "settleall": {
        const g = col.split.get(S.group);
        if (!g) break;
        if (t.dataset.armed !== "1") { t.dataset.armed = "1"; t.textContent = "Wirklich alles?"; setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = "Alles beglichen"; } }, 4000); break; }
        addPayments(g, M.settle(g));
        break;
      }
      case "sharegroup": { const g = col.split.get(S.group); if (g) shareGroup(g); break; }
      default: break;
    }
  }
  function onInput(ev) {
    if (ev.target.id === "mn-q") { S.q = ev.target.value; render(); }
  }
  el.addEventListener("click", onClick);
  el.addEventListener("input", onInput);
  const onToggle = (ev) => { if (ev.target.classList && ev.target.classList.contains("gm-help")) gm.onToggleHelp(ev.target.open); };
  el.addEventListener("toggle", onToggle, true);

  const offs = Object.values(col).map((c) => c.watch(queue));
  render();

  // Tageswechsel (App bleibt offen) → fällige Abos nachholen
  const onVis = () => { if (document.visibilityState === "visible") { queue(); bk.refresh(); } };
  document.addEventListener("visibilitychange", onVis);

  return () => {
    alive = false;
    offs.forEach((off) => off());
    el.removeEventListener("click", onClick);
    el.removeEventListener("input", onInput);
    el.removeEventListener("toggle", onToggle, true);
    document.removeEventListener("visibilitychange", onVis);
    el.innerHTML = "";
  };
}
