// Update 10 E – Alltag › 📜 Verträge (#alltag/vertraege, Detail #alltag/vertraege/<id>).
// Längerfristige Verträge (Handy, Internet, Strom, Versicherung, Miete, Fitness, Kredit …) mit Laufzeit, Mindestlaufzeit,
// Kündigungsfrist, automatischer Verlängerung, Preisänderungen und Kosten pro Monat/Jahr. Die nächste Kündigungsfrist wird
// berechnet (vertraege-core.js) und landet in der Benachrichtigungszentrale („📜 Verträge & Kündigungsfristen“).
// Abos bleiben im Geld-Bereich: gibt's schon ein Abo vom selben Anbieter, wird verknüpft (subId) statt kopiert.
// Geld-Sperre aktiv → Beträge werden ausgeblendet.
import { collection, newId } from "./db.js";
import * as V from "./vertraege-core.js";
import * as A from "./akten-ui.js";
import { INTERVALS } from "./money-core.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";

const VIEW_KEY = "sk-vt-view";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const VIEWS = [["laufend", "📜", "Laufend"], ["frist", "⏰", "Frist bald"], ["beendet", "✔️", "Beendet"]];

let lockMod = null;
const lockReady = import("./money-lock-state.js").then((m) => { lockMod = m; return m; }).catch(() => null);
const locked = () => !!(lockMod && lockMod.isLocked());

export function mount(el, ctx) {
  A.injectCSS();
  const col = collection("vertraege");
  const subsCol = collection("money_subs");
  const S = { view: VIEWS.some((v) => v[0] === lsGet(VIEW_KEY)) ? lsGet(VIEW_KEY) : "laufend", q: "", id: V.routeId(location.hash) };
  let alive = true, queued = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };
  const money = (v) => (locked() ? "•••" : esc(A.eur(v)));

  el.innerHTML = `<div class="ak vt">
      <div class="ak-home">
        <div class="ak-top">
          <label class="ak-search"><span class="sr">Verträge suchen</span><input id="vt-q" type="search" placeholder="🔎 Anbieter, Kundennummer …" autocomplete="off" enterkeyhint="search"></label>
          <div class="ak-acts"><button type="button" class="btn primary sm" data-vt="new">${icon("plus", 16)}<span>Vertrag</span></button></div>
        </div>
        <div class="ak-sum vt-sum"></div>
        <div class="ak-views" role="tablist" aria-label="Ansicht"></div>
        <div class="vt-subhint"></div>
        <div class="ak-list-wrap"></div>
      </div>
      <div class="ak-detail-wrap" hidden></div>
    </div>`;
  const home = el.querySelector(".ak-home");
  const detailEl = el.querySelector(".ak-detail-wrap");
  const listEl = el.querySelector(".ak-list-wrap");
  const sumEl = el.querySelector(".vt-sum");
  const viewsEl = el.querySelector(".ak-views");
  const hintEl = el.querySelector(".vt-subhint");
  const qIn = el.querySelector("#vt-q");
  const all = () => col.all().map(V.normContract).filter((c) => c.id && c.name);
  const byId = (id) => { const x = col.get(id); return x ? V.normContract(x) : null; };
  const subs = () => subsCol.all().filter((x) => x && x.id);
  const subOf = (c) => (c.subId ? subs().find((x) => x.id === c.subId) || null : null);

  function bucket(c, today) {
    const st = V.termStatus(c, today);
    if (st.state === "beendet") return "beendet";
    return st.deadline && st.daysToDeadline >= 0 && st.daysToDeadline <= c.remindDays ? "frist" : (st.state === "gekuendigt" && st.daysToEnd <= c.remindDays ? "frist" : "laufend");
  }

  function renderHome() {
    const today = A.todayKey();
    const list = all();
    const tot = V.contractTotals(list, today);
    const linkedSubs = list.filter((c) => c.subId && V.isRunning(c, today)).length;
    sumEl.innerHTML = list.length ? `<div class="ak-stat"><b>${tot.n + linkedSubs}</b><small>laufende Verträge</small></div>` +
      `<div class="ak-stat"><b>${money(tot.month)}</b><small>pro Monat${linkedSubs ? " (+ Abos)" : ""}</small></div>` +
      `<div class="ak-stat"><b>${money(tot.year)}</b><small>pro Jahr</small></div>` : "";
    sumEl.hidden = !list.length;
    const cnt = { laufend: 0, frist: 0, beendet: 0 };
    for (const c of list) cnt[bucket(c, today)]++;
    cnt.laufend += cnt.frist;
    viewsEl.innerHTML = VIEWS.map(([id, e, label]) => `<button type="button" role="tab" class="ak-vt" data-view="${id}" aria-selected="${S.view === id}"><span aria-hidden="true">${e}</span><span>${label}</span>${cnt[id] ? `<span class="ak-vt-n">${cnt[id]}</span>` : ""}</button>`).join("");
    // Abos mit Mindestlaufzeit, die noch nicht als Vertrag geführt werden → „als Vertrag verwalten“
    const used = new Set(list.map((c) => c.subId).filter(Boolean));
    const cand = subs().filter((x) => !used.has(x.id) && !x.ended && (x.contractType === "Mindestlaufzeit" || x.minTermEnd || x.contractEnd));
    hintEl.innerHTML = cand.length ? `<div class="ak-hint">🔁 <span>${cand.length === 1 ? `Dein Abo <b>${esc(cand[0].name)}</b> hat eine Mindestlaufzeit` : `${cand.length} Abos haben eine Mindestlaufzeit`} – willst du ${cand.length === 1 ? "es" : "sie"} hier als Vertrag verwalten? (Wird verknüpft, nicht kopiert.)</span>` +
      `<div class="ak-chiprow">${cand.slice(0, 4).map((x) => `<button type="button" class="chip" data-vt="fromsub" data-id="${esc(x.id)}">📜 ${esc(x.name)}</button>`).join("")}</div></div>` : "";
    if (!list.length) {
      listEl.innerHTML = col.loaded ? A.emptyHTML("📜", "Noch keine Verträge", "Handy, Internet, Strom, Versicherung, Miete, Fitnessstudio … Trag sie ein – die App rechnet dir die nächste Kündigungsfrist aus und erinnert dich rechtzeitig. ⏰", "＋ Ersten Vertrag", "new") : `<p class="note">Lade …</p>`;
      return;
    }
    const q = S.q.trim().toLowerCase();
    const shown = list.filter((c) => (S.view === "laufend" ? bucket(c, today) !== "beendet" : bucket(c, today) === S.view))
      .filter((c) => !q || V.searchText(c).toLowerCase().includes(q))
      .sort((a, b) => {
        const sa = V.termStatus(a, today), sb = V.termStatus(b, today);
        const da = sa.deadline ? sa.daysToDeadline : sa.daysToEnd != null ? sa.daysToEnd : 99999, db = sb.deadline ? sb.daysToDeadline : sb.daysToEnd != null ? sb.daysToEnd : 99999;
        return da - db || a.name.localeCompare(b.name, "de");
      });
    listEl.innerHTML = shown.length ? `<ul class="ak-list">${shown.map((c) => {
      const b = bucket(c, today);
      const sub = subOf(c);
      const m = sub ? Number(sub.amount) || 0 : V.contractMonthly(c, today);
      return `<li><button type="button" class="ak-card${b === "frist" ? " is-warn" : ""}" data-vt="open" data-id="${esc(c.id)}">` +
        `<span class="ak-thumb"><span class="ak-emo" aria-hidden="true">${V.kindById(c.kind).e}</span></span>` +
        `<span class="ak-ct"><b>${esc(c.name)}</b><small>${esc([c.provider, V.kindById(c.kind).label].filter(Boolean).join(" · "))}${sub ? " · 🔁 Abo" : ""}</small>` +
        `<small class="vt-line">${esc(V.statusLine(c, today))}</small></span>` +
        `<span class="ak-amt">${money(m)}<small>${sub ? esc(INTERVALS[sub.interval] || "monatlich") : "/ Monat"}</small></span>` +
      `</button></li>`;
    }).join("")}</ul>` : `<div class="empty ak-empty"><p>${q ? `Nichts gefunden für „${esc(S.q)}“ 🤔` : S.view === "frist" ? "Keine Kündigungsfrist in Sicht – entspannt zurücklehnen ☕" : S.view === "beendet" ? "Noch keine beendeten Verträge." : "Keine laufenden Verträge."}</p></div>`;
  }

  function renderDetail(c) {
    const today = A.todayKey();
    const st = V.termStatus(c, today);
    const sub = subOf(c);
    const hist = V.priceHistory(c);
    const notice = V.noticeOf(c);
    const rows = [
      ["🏢 Anbieter", c.provider],
      ["🔢 Kundennummer", c.customerNo],
      ["▶️ Beginn", A.fmtKey(c.start)],
      ["⏳ Mindestlaufzeit", c.minMonths ? `${c.minMonths} Monate` : ""],
      ["🏁 Festes Ende", A.fmtKey(c.end)],
      ["✉️ Kündigungsfrist", notice ? (c.noticeDays != null ? `${c.noticeDays} Tage` : c.noticeText) : "keine angegeben"],
      ["🔄 Verlängerung", c.autoRenew ? `automatisch um ${c.renewMonths} ${c.renewMonths === 1 ? "Monat" : "Monate"}` : "keine – endet von selbst"],
      ["📆 Aktuelles Laufzeitende", st.end ? A.fmtKey(st.end) : st.state === "unbefristet" ? "unbefristet" : ""],
      ["✉️ Gekündigt am", A.fmtKey(c.cancelledOn)],
    ].filter((r) => r[1]);
    detailEl.innerHTML = `<div class="ak-det">
      <div class="ak-det-bar"><button type="button" class="btn ghost sm" data-vt="back">${icon("chevron-left", 18)}<span>Alle Verträge</span></button></div>
      <section class="ak-hero vt-hero">
        <div class="ak-hero-emo" aria-hidden="true">${V.kindById(c.kind).e}</div>
        <div class="ak-hero-t"><h2>${esc(c.name)}</h2><p class="note">${esc(V.kindById(c.kind).label)}${sub ? ` · 🔁 verknüpft mit Abo „${esc(sub.name)}“` : ""}</p>
          <p class="vt-status st-${st.state}${st.deadline && st.daysToDeadline <= 14 ? " is-urgent" : ""}">${esc(V.statusLine(c, today))}</p></div>
        <div class="ak-hero-acts">
          <button type="button" class="btn primary sm" data-vt="edit">${icon("pencil", 16)}<span>Bearbeiten</span></button>
          <button type="button" class="btn ghost sm" data-vt="price">💶 <span>Preisänderung</span></button>
          ${c.cancelledOn ? `<button type="button" class="btn ghost sm" data-vt="uncancel">↩️ <span>Doch nicht gekündigt</span></button>` : st.state === "beendet" ? "" : `<button type="button" class="btn ghost sm" data-vt="cancel">✉️ <span>Als gekündigt markieren</span></button>`}
        </div>
      </section>
      <section class="ak-card-s"><h3>💶 Kosten</h3>
        ${sub ? `<p>${money(sub.amount)} ${esc(INTERVALS[sub.interval] || "")} – kommt aus dem Abo im Geld-Bereich (zählt nur einmal). <a href="#alltag/geld?tab=abos">🔁 Zum Abo</a></p>`
          : `<div class="ak-stats">${c.interval !== "month" ? `<div class="ak-stat"><b>${money(V.priceAt(c, today))}</b><small>${esc(INTERVALS[c.interval])}</small></div>` : ""}<div class="ak-stat"><b>${money(V.contractMonthly(c, today))}</b><small>pro Monat</small></div><div class="ak-stat"><b>${money(V.contractYearly(c, today))}</b><small>pro Jahr</small></div></div>`}
        ${hist.length > 1 && !locked() ? `<h4>📈 Preisverlauf</h4><ol class="vt-prices">${hist.map((p) => `<li><span>${esc(A.fmtKey(p.from) || "Start")}</span><b>${esc(A.eur(p.amount))}</b>${p.diff ? `<span class="vt-diff ${p.diff > 0 ? "up" : "down"}">${p.diff > 0 ? "▲ +" : "▼ "}${esc(A.eur(p.diff))}</span>` : ""}${p.note ? `<small>${esc(p.note)}</small>` : ""}</li>`).join("")}</ol>` : ""}
      </section>
      <section class="ak-card-s"><h3>📋 Laufzeit</h3><dl class="ak-dl">${rows.map((r) => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join("")}</dl>
        ${c.remind ? `<p class="note">🔔 Erinnerung ${c.remindDays} Tage vor der Kündigungsfrist in der Benachrichtigungszentrale.</p>` : `<p class="note">🔕 Keine Erinnerung.</p>`}</section>
      ${c.notes ? `<section class="ak-card-s"><h3>📝 Notizen</h3><p class="ak-pre">${esc(c.notes)}</p></section>` : ""}
      <div class="vt-docs">${A.linkedDocsHTML("vertrag", c.id)}</div>
      <div class="ak-det-foot"><button type="button" class="btn danger sm" data-vt="del">Vertrag löschen</button></div>
    </div>`;
    ui.confirmButton(detailEl.querySelector('[data-vt="del"]'), "Wirklich löschen?", async () => {
      await A.safe(col.remove(c.id), "Vertrag gelöscht 🗑️");
      A.go("#alltag/vertraege");
    });
  }

  /* ---------- Formulare ---------- */

  function openForm(c0 = null, preset = {}) {
    const c = V.normContract({ ...(c0 || {}), ...preset });
    const isNew = !c0;
    let subId = c.subId;
    ui.openSheet({
      title: isNew ? "📜 Neuer Vertrag" : "✏️ Vertrag bearbeiten",
      bodyHTML: `<form class="fields ak-form" novalidate>
        <div class="ak-chiprow" role="group" aria-label="Art">${V.KINDS.map((k) => `<button type="button" class="chip" data-kind="${k.id}" aria-pressed="${c.kind === k.id}">${k.e} ${esc(k.label)}</button>`).join("")}</div>
        <label>Name<input id="vt-f-name" type="text" maxlength="120" value="${esc(c.name)}" placeholder="z. B. Handyvertrag" required></label>
        <div class="row2"><label>Anbieter<input id="vt-f-prov" type="text" maxlength="120" value="${esc(c.provider)}" placeholder="z. B. Musterfunk"></label>
          <label>Kundennummer<input id="vt-f-cno" type="text" maxlength="80" value="${esc(c.customerNo)}"></label></div>
        <div class="vt-subm" aria-live="polite"></div>
        <div class="row2 vt-amount"><label>Betrag (€)<input id="vt-f-amt" type="text" inputmode="decimal" value="${esc(A.amountIn(c.amount || ""))}" placeholder="0,00"></label>
          <label>Zahlung<select id="vt-f-int">${Object.entries(INTERVALS).map(([k, l]) => `<option value="${k}"${c.interval === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label></div>
        <div class="row2"><label>Beginn<input id="vt-f-start" type="date" value="${esc(c.start)}"></label>
          <label>Mindestlaufzeit (Monate)<input id="vt-f-min" type="number" min="0" max="240" inputmode="numeric" value="${c.minMonths || ""}" placeholder="z. B. 24"></label></div>
        <div class="row2"><label>Festes Ende <small class="note">(optional)</small><input id="vt-f-end" type="date" value="${esc(c.end)}"></label>
          <label>Kündigungsfrist<input id="vt-f-notice" type="text" maxlength="80" value="${esc(c.noticeDays != null ? c.noticeDays + " Tage" : c.noticeText)}" placeholder="z. B. 1 Monat, 3 Monate zum Monatsende"></label></div>
        <label class="ak-check"><input id="vt-f-renew" type="checkbox"${c.autoRenew ? " checked" : ""}> 🔄 Verlängert sich automatisch um <input id="vt-f-rm" type="number" min="1" max="120" inputmode="numeric" value="${c.renewMonths}" aria-label="Monate"> Monate</label>
        <label class="ak-check"><input id="vt-f-remind" type="checkbox"${c.remind ? " checked" : ""}> 🔔 Erinnern <input id="vt-f-rd" type="number" min="1" max="180" inputmode="numeric" value="${c.remindDays}" aria-label="Tage vorher"> Tage vor der Frist</label>
        <label>Notizen<textarea id="vt-f-notes" rows="3" maxlength="4000" placeholder="z. B. Kündigung nur schriftlich per Einschreiben">${esc(c.notes)}</textarea></label>
        <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button></div>
      </form>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        let kind = c.kind;
        sheet.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
          kind = b.dataset.kind;
          sheet.querySelectorAll("[data-kind]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.kind === kind)));
        }));
        const subBox = $(".vt-subm");
        const showSub = () => {
          const linked = subId ? subs().find((x) => x.id === subId) : null;
          if (linked) {
            subBox.innerHTML = `<div class="ak-hint">🔁 <span>Verknüpft mit dem Abo <b>${esc(linked.name)}</b> – die Kosten zählen beim Abo (nicht doppelt).</span><button type="button" class="btn ghost sm" data-unsub>Lösen</button></div>`;
            $(".vt-amount").hidden = true;
            subBox.querySelector("[data-unsub]").addEventListener("click", () => { subId = ""; showSub(); });
            return;
          }
          $(".vt-amount").hidden = false;
          const m = V.matchSub({ name: $("#vt-f-name").value, provider: $("#vt-f-prov").value }, subs().filter((x) => !all().some((k) => k.subId === x.id && k.id !== c.id)));
          subBox.innerHTML = m ? `<div class="ak-hint">💡 <span>Du hast schon ein Abo <b>${esc(m.name)}</b>. Lieber verknüpfen als doppelt eintragen?</span><button type="button" class="btn primary sm" data-sub="${esc(m.id)}">🔗 Als Vertrag verwalten</button></div>` : "";
          const b = subBox.querySelector("[data-sub]");
          if (b) b.addEventListener("click", () => {
            const sub = subs().find((x) => x.id === b.dataset.sub);
            if (!sub) return;
            subId = sub.id;
            const fill = V.fillFromSub(V.normContract({ name: $("#vt-f-name").value, provider: $("#vt-f-prov").value, start: $("#vt-f-start").value, end: $("#vt-f-end").value, noticeText: $("#vt-f-notice").value }), sub);
            if (fill.provider && !$("#vt-f-prov").value) $("#vt-f-prov").value = fill.provider;
            if (fill.start) $("#vt-f-start").value = fill.start;
            if (fill.end) $("#vt-f-end").value = fill.end;
            if (fill.noticeText && !$("#vt-f-notice").value) $("#vt-f-notice").value = fill.noticeText;
            showSub();
          });
        };
        $("#vt-f-name").addEventListener("input", showSub);
        $("#vt-f-prov").addEventListener("input", showSub);
        showSub();
        $("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const name = $("#vt-f-name").value.trim();
          if (!name) { ui.toast("Bitte einen Namen eingeben."); $("#vt-f-name").focus(); return; }
          const nt = $("#vt-f-notice").value.trim();
          const nd = /^\s*(\d+)\s*(tage?)?\s*$/i.exec(nt);
          const doc = {
            ...(c0 || {}), id: c.id || newId(), name, kind, provider: $("#vt-f-prov").value.trim(), customerNo: $("#vt-f-cno").value.trim(),
            amount: subId ? 0 : A.num($("#vt-f-amt").value) || 0, interval: $("#vt-f-int").value, // mit Abo: Kosten kommen vom Abo
            start: $("#vt-f-start").value || "", minMonths: Math.max(0, Math.round(Number($("#vt-f-min").value) || 0)), end: $("#vt-f-end").value || "",
            noticeText: nd ? "" : nt, noticeDays: nd ? Number(nd[1]) : null,
            autoRenew: $("#vt-f-renew").checked, renewMonths: Math.max(1, Math.round(Number($("#vt-f-rm").value) || 12)),
            remind: $("#vt-f-remind").checked, remindDays: Math.max(1, Math.round(Number($("#vt-f-rd").value) || 30)),
            notes: $("#vt-f-notes").value.trim(), subId, updated: Date.now(), created: c.created || Date.now(),
          };
          if (await A.safe(col.put(doc), isNew ? "Vertrag gespeichert 📜" : "Gespeichert ✓")) { close(); if (isNew) A.go(V.contractHash(doc.id)); }
        });
      },
    });
  }

  function openPrice(c) {
    ui.openSheet({
      title: "💶 Preisänderung",
      bodyHTML: `<form class="fields ak-form" novalidate>
        <p class="note">Aktuell: ${money(V.priceAt(c, A.todayKey()))} ${esc(INTERVALS[c.interval])}. Neue Preise werden ab dem Datum gerechnet – der Verlauf bleibt.</p>
        <div class="row2"><label>Neuer Betrag (€)<input id="vt-p-amt" type="text" inputmode="decimal" required placeholder="0,00"></label>
          <label>Gilt ab<input id="vt-p-from" type="date" value="${A.todayKey()}"></label></div>
        <label>Grund <small class="note">(optional)</small><input id="vt-p-note" type="text" maxlength="120" placeholder="z. B. Indexanpassung"></label>
        <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button></div></form>`,
      onMount(sheet, close) {
        sheet.querySelector("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const amount = A.num(sheet.querySelector("#vt-p-amt").value);
          const from = sheet.querySelector("#vt-p-from").value;
          if (amount == null || amount < 0 || !from) { ui.toast("Bitte Betrag und Datum angeben."); return; }
          const prices = [...c.prices.filter((p) => p.from !== from), { from, amount, note: sheet.querySelector("#vt-p-note").value.trim() }];
          if (await A.safe(col.patch(c.id, { prices, updated: Date.now() }), "Preis gespeichert 📈")) close();
        });
      },
    });
  }

  function openCancel(c) {
    const today = A.todayKey();
    const st = V.termStatus(c, today);
    const sugg = st.state === "unbefristet" ? st.canEndOn : st.end;
    ui.openSheet({
      title: "✉️ Als gekündigt markieren",
      bodyHTML: `<form class="fields ak-form" novalidate>
        <p class="note">Super, dass du's erledigt hast! 💪 Die App erinnert dann nicht mehr an die Frist, sondern ans Vertragsende.</p>
        <div class="row2"><label>Gekündigt am<input id="vt-c-on" type="date" value="${today}"></label>
          <label>Läuft bis<input id="vt-c-end" type="date" value="${esc(sugg || "")}"></label></div>
        <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button></div></form>`,
      onMount(sheet, close) {
        sheet.querySelector("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          if (await A.safe(col.patch(c.id, { cancelledOn: sheet.querySelector("#vt-c-on").value || today, endsOn: sheet.querySelector("#vt-c-end").value || "", updated: Date.now() }), "Als gekündigt markiert ✉️")) close();
        });
      },
    });
  }

  /* ---------- Rendern / Ereignisse ---------- */

  function render() {
    S.id = V.routeId(location.hash);
    const c = S.id ? byId(S.id) : null;
    if (S.id && !c) {
      home.hidden = true; detailEl.hidden = false;
      detailEl.innerHTML = col.loaded ? `<div class="empty ak-empty"><h3>🤔 Vertrag nicht gefunden</h3><a class="btn ghost sm" href="#alltag/vertraege">Zu allen Verträgen</a></div>` : `<p class="note">Lade …</p>`;
      return;
    }
    if (c) { home.hidden = true; detailEl.hidden = false; renderDetail(c); return; }
    home.hidden = false; detailEl.hidden = true; detailEl.innerHTML = "";
    renderHome();
  }

  function onClick(ev) {
    const v = ev.target.closest("[data-view]");
    if (v && el.contains(v)) { S.view = v.dataset.view; lsSet(VIEW_KEY, S.view); render(); return; }
    const b = ev.target.closest("[data-vt], [data-ak]");
    if (!b || !el.contains(b)) return;
    const c = S.id ? byId(S.id) : null;
    switch (b.dataset.vt || b.dataset.ak) {
      case "new": openForm(); break;
      case "open": A.go(V.contractHash(b.dataset.id)); break;
      case "back": A.go("#alltag/vertraege"); break;
      case "edit": if (c) openForm(col.get(c.id)); break;
      case "price": if (c) openPrice(c); break;
      case "cancel": if (c) openCancel(c); break;
      case "uncancel": if (c) A.safe(col.patch(c.id, { cancelledOn: "", endsOn: "", updated: Date.now() }), "Kündigung zurückgenommen ↩️"); break;
      case "fromsub": {
        const sub = subs().find((x) => x.id === b.dataset.id);
        if (!sub) break;
        const base = V.normContract({ name: sub.name });
        openForm(null, { name: sub.name, subId: sub.id, ...V.fillFromSub(base, sub), kind: /handy|mobil|magenta|drei|a1/i.test(sub.name) ? "handy" : /fitness|gym|verein/i.test(sub.name) ? "fitness" : "sonstiges" });
        break;
      }
      default: break;
    }
  }
  qIn.addEventListener("input", () => { S.q = qIn.value; renderHome(); });
  el.addEventListener("click", onClick);
  const offs = [col.watch(queue), subsCol.watch(queue), A.watchDocs(queue)];
  let offLock = null;
  lockReady.then((m) => { if (m && alive) { offLock = m.onChange(queue); queue(); } });
  const offRoute = A.onRoute((h) => { if (/^#alltag\/vertraege/.test(h)) { queue(); window.scrollTo(0, 0); } });
  render();
  return () => {
    alive = false;
    offs.forEach((o) => o());
    if (offLock) offLock();
    offRoute();
    el.removeEventListener("click", onClick);
    el.innerHTML = "";
  };
}
