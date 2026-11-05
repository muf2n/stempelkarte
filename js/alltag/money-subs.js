// Geld › Abos: Übersicht (Summen, nächste Abbuchungen, Fristen, Testzeiträume), Abo-Karten mit „Kündigen ↗“,
// Detail-Blatt („So kündigst du“, Kopieren, „Als gekündigt markieren“), Formular mit Katalog-Vorschlag
// und Planer-Erinnerungen vor Kündigungsfristen/Testende.
// Logik in subs-core.js, Dienste-Katalog in subs-catalog.js.
import * as M from "./money-core.js";
import * as C from "./subs-core.js";
import * as K from "./subs-catalog.js";
import * as store from "../store.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";
import { plugin } from "../native.js";

const IV_PER = { week: "Woche", month: "Monat", quarter: "Quartal", year: "Jahr" };
const amt = (v, o) => esc(M.eur(v, o));
const isUrl = (u) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(String(u || "").trim());

/** Link in neuem Tab öffnen – in der Android-App über das Browser-Plugin. */
export function openUrl(url) {
  if (!isUrl(url)) return false;
  const B = plugin("Browser");
  if (B && B.open) { B.open({ url }).catch(() => window.open(url, "_blank", "noopener")); return true; }
  window.open(url, "_blank", "noopener");
  return true;
}

async function copyText(ui, text, what = "Kopiert") {
  try { await navigator.clipboard.writeText(text); ui.toast(`${what} ✓`); }
  catch {
    ui.openSheet({ title: "Zum Kopieren", bodyHTML: `<textarea readonly rows="6">${esc(text)}</textarea>`, onMount(s) { const t = s.querySelector("textarea"); t.focus(); t.select(); } });
  }
}

/** Katalog-Eintrag eines Abos (gespeicherter Schlüssel oder Namenssuche). */
export function catalogOf(sub) {
  if (!sub) return null;
  if (sub.catalogKey) { const e = K.catalogByKey(sub.catalogKey); if (e) return e; }
  const m = K.matchCatalog(sub.name);
  return m ? m.entry : null;
}

/**
 * opts: { col, ui, render, catOf(id), cats(), safeWrite(p, msg), gmCardHTML() }
 */
export function createSubs(opts) {
  const { col, ui } = opts;
  let reminding = false;
  const today = () => M.todayKey();

  const logo = (s, c) => {
    const e = catalogOf(s);
    const t = e ? e.emoji : String(s.name || "?").trim().charAt(0).toUpperCase() || "?";
    return `<span class="mn-bub ab-logo${e ? "" : " ab-ini"}" style="--c:${esc((c && c.color) || "#8b5cf6")}" aria-hidden="true">${esc(t)}</span>`;
  };
  const per = (s) => IV_PER[s.interval] || "Monat";

  /* ---------- Seite ---------- */

  function dueLabel(key) {
    const d = M.daysBetween(today(), key);
    if (d === 0) return "Heute";
    if (d === 1) return "Morgen";
    return `${M.WD[M.dateOf(key).getDay()]}, ${C.fmtShort(key)}`;
  }

  function card(s) {
    const c = opts.catOf(s.category || "abos");
    const st = C.subStatus(s, today());
    const off = st.kind === "ended" || st.kind === "paused";
    const done = st.kind === "cancelled" || st.kind === "ended";
    const stIc = st.kind === "trial" ? "⏳" : st.kind === "term" ? "📄" : done ? "✓" : st.kind === "paused" ? "⏸" : "🔁";
    const cancelBtn = !done && s.cancelUrl
      ? `<button type="button" class="btn sm ab-cancel" data-ab="cancel" data-id="${esc(s.id)}" aria-label="${esc(s.name)} kündigen (öffnet neuen Tab)">Kündigen ↗</button>`
      : !done ? `<button type="button" class="btn sm ghost ab-cancel ghosty" data-ab="open" data-id="${esc(s.id)}">So kündigen</button>` : "";
    return `<li><article class="ab-card${off ? " off" : ""}${st.urgent ? " urgent" : ""}" style="--c:${esc(c.color || "#8b5cf6")}">` +
      `<button type="button" class="ab-main" data-ab="open" data-id="${esc(s.id)}">` +
        logo(s, c) +
        `<span class="ab-txt"><b>${esc(s.name)}</b><small>${esc(s.what || c.name)}${s.source === "gmail" ? " · aus Gmail" : ""}</small></span>` +
        `<span class="ab-price"><b>${amt(s.amount)}</b><small>/${esc(per(s))}</small>${s.interval && s.interval !== "month" ? `<small class="ab-pm">≈ ${amt(M.monthlyCost(s))}/Monat</small>` : ""}</span>` +
      `</button>` +
      `<div class="ab-foot"><p class="ab-status ${esc(st.kind)}"><span aria-hidden="true">${stIc}</span> ${esc(st.line)}</p>${cancelBtn}</div>` +
    `</article></li>`;
  }

  function pageHTML(emptyBox) {
    const subs = col.subs.all().filter((s) => s && !s.deleted);
    const gm = opts.gmCardHTML();
    if (!subs.length) return gm + emptyBox("Noch keine Abos", "Netflix, Spotify, Handyvertrag, Fitnessstudio … – trag sie ein: Du siehst, was es kostet, wie lange es noch läuft und wie du kündigst.", "newsub");
    const t = today();
    const sum = C.subsSummary(subs, t);
    const up = M.upcoming(sum.active, t, 31).slice(0, 6);
    const rank = (s) => { const k = C.subStatus(s, t).kind; return k === "ended" ? 3 : k === "paused" ? 2 : k === "cancelled" ? 1 : 0; };
    const sorted = subs.slice().sort((a, b) => rank(a) - rank(b) || String(C.nextCharge(a, t) || "9").localeCompare(String(C.nextCharge(b, t) || "9")) || String(a.name).localeCompare(String(b.name), "de"));

    const hero = `<section class="card ab-hero">` +
      `<div><small>pro Monat</small><b>${amt(sum.perMonth)}</b></div>` +
      `<div><small>pro Jahr</small><b>${amt(sum.perYear)}</b></div>` +
      `<p class="ab-hero-n">${sum.active.length} ${sum.active.length === 1 ? "aktives Abo" : "aktive Abos"}${sum.trials.length ? ` · ${sum.trials.length} im Testzeitraum` : ""}</p>` +
    `</section>`;
    const mini = (title, cls, rows) => rows.length ? `<section class="card mn-card ab-mini ${cls}"><h3 class="mn-h">${title}</h3><ul class="mn-mini">${rows.join("")}</ul></section>` : "";
    const upBox = mini("Nächste Abbuchungen", "", up.map((u) => `<li><span>${esc(dueLabel(u.date))}</span><b>${esc(u.sub.name)}</b><em>${amt(u.sub.amount)}</em></li>`));
    const dlBox = mini("Kündigungsfristen bald", "warn", sum.deadlines.map((d) => `<li><span>bis ${esc(C.fmtShort(d.date))}</span><b><button type="button" class="linkbtn" data-ab="open" data-id="${esc(d.sub.id)}">${esc(d.sub.name)}</button></b><em>${esc(d.days === 0 ? "heute!" : d.days === 1 ? "morgen" : `noch ${d.days} T.`)}</em></li>`));
    const trBox = mini("Testzeiträume", "trial", sum.trials.map((d) => `<li><span>endet ${esc(C.fmtShort(d.date))}</span><b><button type="button" class="linkbtn" data-ab="open" data-id="${esc(d.sub.id)}">${esc(d.sub.name)}</button></b><em>${esc(d.days === 0 ? "heute" : d.days === 1 ? "morgen" : `in ${d.days} T.`)}</em></li>`));

    return `<div class="ab-top">${hero}${upBox}${dlBox}${trBox}</div>` + gm +
      `<h3 class="mn-h mn-h-out">Alle Abos &amp; Fixkosten</h3>` +
      `<ul class="ab-list mn-subs">${sorted.map(card).join("")}</ul>` +
      `<p class="note">Fällige Zahlungen werden automatisch als Buchung eingetragen (jede nur einmal) – nach dem Kündigungsende nicht mehr. Vor Kündigungsfristen und dem Ende von Testzeiträumen kommt 3 Tage vorher eine Erinnerung in den Planer.</p>`;
  }

  /* ---------- Erinnerungen ---------- */

  async function catchUpReminders() {
    if (reminding || !col.subs.loaded) return;
    let snap;
    try { snap = store.get(); } catch { return; }
    if (!snap || !snap.ready) return;
    reminding = true;
    try {
      const t = today();
      const todos = new Map((snap.todos || []).map((x) => [x.id, x]));
      for (const s of col.subs.all()) {
        const r = C.reminderFor(s, t);
        if (!r) continue;
        if (!todos.has(r.id)) {
          await store.saveTodo({ id: r.id, title: r.title, kind: "todo", date: r.date, time: "09:00", remind: true, remindMin: 0, done: false, note: r.note, src: "abo", aboId: s.id });
          ui.toast(`Erinnerung im Planer: ${r.title}`, 3200);
        }
        await col.subs.patch(s.id, { remindedFor: r.deadline });
      }
    } catch (err) {
      console.warn("Abo-Erinnerungen:", err);
    } finally {
      reminding = false;
    }
  }

  async function finishReminders(sub) {
    try {
      const prefix = C.reminderId(sub.id, "");
      for (const t of store.get().todos || []) {
        if (t.id && t.id.startsWith(prefix) && !t.done) await store.saveTodo({ ...t, done: true, doneAt: Date.now() });
      }
    } catch (err) { console.warn(err); }
  }

  /* ---------- Detail ---------- */

  function openDetail(sub) {
    if (!sub) return;
    const draw = (sheet) => {
      const s = col.subs.get(sub.id) || sub;
      const t = today();
      const st = C.subStatus(s, t);
      const c = opts.catOf(s.category || "abos");
      const type = C.contractTypeOf(s);
      const notice = C.parseNotice(s);
      const nc = C.nextCharge(s, t);
      const done = st.kind === "cancelled" || st.kind === "ended";
      const row = (k, v, extra = "") => (v ? `<div class="ab-dl-r"><dt>${k}</dt><dd>${v}${extra}</dd></div>` : "");
      const copyBtn = (val, label) => `<button type="button" class="ab-copy" data-copy="${esc(val)}" data-what="${esc(label)}" aria-label="${esc(label)} kopieren">${icon("copy", 16)}</button>`;
      const termEndKey = C.termEnd(s, t);
      const dl = [
        row("Preis", `${amt(s.amount)} / ${esc(per(s))}${s.interval && s.interval !== "month" ? ` <small>(≈ ${amt(M.monthlyCost(s))}/Monat, ${amt(M.yearlyCost(s))}/Jahr)</small>` : ` <small>(${amt(M.yearlyCost(s))}/Jahr)</small>`}`),
        row("Vertragsart", esc(type)),
        row("Seit", M.isKey(s.startDate) ? esc(M.fmtDate(s.startDate)) : ""),
        row("Nächste Abbuchung", nc ? esc(M.fmtDate(nc)) : ""),
        row(type === "Prepaid" ? "Bezahlt bis" : "Vertrag bis", (type === "Mindestlaufzeit" || type === "Prepaid") && termEndKey ? esc(M.fmtDate(termEndKey)) + (M.isKey(s.minTermEnd) && s.minTermEnd !== termEndKey ? ` <small>(Mindestlaufzeit bis ${esc(M.fmtDate(s.minTermEnd))})</small>` : "") : ""),
        row("Testzeitraum bis", M.isKey(s.trialEnd) ? esc(M.fmtDate(s.trialEnd)) : ""),
        row("Kündigungsfrist", notice ? esc(notice.text || `${notice.days} Tage`) : ""),
        row("Spätestens kündigen", st.deadline && (st.kind === "term" || st.kind === "trial") ? `<b class="ab-dead">${esc(M.fmtDate(st.deadline))}</b> <small>(${esc(C.inDays(t, st.deadline))})</small>` : ""),
        row("Verlängert sich", s.autoRenew === true ? "automatisch" : s.autoRenew === false ? "nein" : ""),
        row("Gekündigt am", M.isKey(s.cancelledOn) ? esc(M.fmtDate(s.cancelledOn)) : ""),
        row("Läuft aus am", M.isKey(s.ended) ? esc(M.fmtDate(s.ended)) : ""),
        row("Konto / Login", s.account ? esc(s.account) : "", s.account ? copyBtn(s.account, "Login") : ""),
        row("Kategorie", `${esc(c.emoji || "")} ${esc(c.name)}`),
      ].join("");
      const links = (s.cancelUrl || s.manageUrl)
        ? `<div class="ab-links">` +
            (s.cancelUrl ? `<div class="ab-link"><button type="button" class="btn primary ab-cancel" data-ab="cancel" data-id="${esc(s.id)}">Kündigen ↗</button><span class="ab-url">${esc(s.cancelUrl)}</span>${copyBtn(s.cancelUrl, "Kündigungslink")}</div>` : "") +
            (s.manageUrl && s.manageUrl !== s.cancelUrl ? `<div class="ab-link"><button type="button" class="btn ghost sm" data-ab="manage" data-id="${esc(s.id)}">Verwalten ↗</button><span class="ab-url">${esc(s.manageUrl)}</span>${copyBtn(s.manageUrl, "Link")}</div>` : "") +
          `</div>`
        : `<p class="note">Noch kein Kündigungslink eingetragen – tipp auf „Bearbeiten“.</p>`;
      const cat = catalogOf(s);
      const canRemind = st.kind === "term" || st.kind === "trial";
      sheet.querySelector(".ab-detail").innerHTML =
        `<div class="ab-d-head">${logo(s, c)}<div><b>${esc(s.name)}</b><small>${esc(s.what || "")}</small></div></div>` +
        `<p class="ab-d-status ${esc(st.kind)}${st.urgent ? " urgent" : ""}">${esc(st.line)}</p>` +
        links +
        `<dl class="ab-dl">${dl}</dl>` +
        (s.account ? `<p class="note ab-vault">🔐 Passwort? Liegt sicher im <a href="#alltag/tresor" data-ab="vault">Passwort-Tresor</a> – hier nur der Login.</p>` : "") +
        `<section class="ab-how"><div class="ab-how-h"><h4>So kündigst du</h4>` +
          `<button type="button" class="ab-copy" data-ab="copyhow" aria-label="Anleitung kopieren">${icon("copy", 16)}</button></div>` +
          `<textarea id="ab-how" rows="5" placeholder="Schritte zum Kündigen, z. B. „Konto → Abo → Kündigen“">${esc(s.cancelHow || "")}</textarea>` +
          `<div class="row ab-how-btns">` +
            (cat && !s.cancelHow ? `<button type="button" class="btn sm ghost" data-ab="fillcat">Aus Katalog (${esc(cat.name)})</button>` : "") +
            `<button type="button" class="btn sm" data-ab="savehow" hidden>Text speichern</button>` +
          `</div>` +
        `</section>` +
        (canRemind || s.remind === false ? `<label class="mn-check ab-remind"><input type="checkbox" id="ab-remind"${s.remind !== false ? " checked" : ""}> Erinnerung im Planer 3 Tage vor ${st.kind === "trial" ? "Ende des Testzeitraums" : "der Kündigungsfrist"}</label>` : "") +
        `<div class="row ab-d-btns">` +
          `<button type="button" class="btn ghost sm" data-ab="edit" data-id="${esc(s.id)}">${icon("pencil", 16)} Bearbeiten</button>` +
          (done && M.isKey(s.cancelledOn)
            ? `<button type="button" class="btn ghost sm" data-ab="uncancel">Kündigung zurücknehmen</button>`
            : !done ? `<button type="button" class="btn sm ab-markc" data-ab="markcancel">Als gekündigt markieren</button>` : "") +
        `</div>`;
    };

    ui.openSheet({
      title: "Abo",
      bodyHTML: `<div class="ab-detail"></div>`,
      onMount(sheet, close) {
        draw(sheet);
        const off = col.subs.watch(() => { if (document.contains(sheet) && !sheet.querySelector("#ab-how:focus")) draw(sheet); });
        const obs = new MutationObserver(() => { if (!document.contains(sheet)) { off(); obs.disconnect(); } });
        obs.observe(sheet.parentNode || document.body, { childList: true });
        const cur = () => col.subs.get(sub.id) || sub;
        sheet.addEventListener("input", (ev) => {
          if (ev.target.id === "ab-how") { const b = sheet.querySelector("[data-ab=savehow]"); if (b) b.hidden = ev.target.value === (cur().cancelHow || ""); }
        });
        sheet.addEventListener("change", async (ev) => {
          if (ev.target.id === "ab-remind") await opts.safeWrite(col.subs.patch(sub.id, { remind: ev.target.checked }), ev.target.checked ? "Erinnerung an ✓" : "Erinnerung aus");
        });
        sheet.addEventListener("click", async (ev) => {
          const cp = ev.target.closest("[data-copy]");
          if (cp) { copyText(ui, cp.dataset.copy, `${cp.dataset.what || "Text"} kopiert`); return; }
          const b = ev.target.closest("[data-ab]");
          if (!b) return;
          const s = cur();
          switch (b.dataset.ab) {
            case "cancel": openUrl(s.cancelUrl); break;
            case "manage": openUrl(s.manageUrl); break;
            case "vault": close(); break; // Link-Ziel öffnet den Tresor
            case "copyhow": copyText(ui, sheet.querySelector("#ab-how").value || s.cancelHow || "", "Anleitung kopiert"); break;
            case "fillcat": { const e = catalogOf(s); if (e) await opts.safeWrite(col.subs.patch(s.id, K.catalogFill(s, e)), "Aus Katalog ergänzt ✓"); break; }
            case "savehow": {
              const v = sheet.querySelector("#ab-how").value.trim();
              b.hidden = true;
              await opts.safeWrite(col.subs.patch(s.id, { cancelHow: v }), "Gespeichert ✓");
              break;
            }
            case "edit": close(); openSub(s); break;
            case "markcancel": openMarkCancel(s); break;
            case "uncancel":
              await opts.safeWrite(col.subs.patch(s.id, { cancelledOn: null, ended: null }), "Kündigung zurückgenommen – wird wieder gebucht");
              break;
            default: break;
          }
        });
      },
    });
  }

  function openMarkCancel(sub) {
    const t = today();
    const end = C.cancelEndDate(sub, t);
    ui.openSheet({
      title: `${sub.name} gekündigt`,
      bodyHTML: `<div class="fields">` +
          `<label>Gekündigt am<input id="ab-c-on" type="date" value="${esc(t)}"></label>` +
          `<label>Läuft aus am (letzter Tag)<input id="ab-c-end" type="date" value="${esc(end)}"></label>` +
          `<p class="note">Vorschlag aus Vertragsart und Kündigungsfrist – am besten mit der Kündigungsbestätigung vergleichen. Bis zu diesem Tag wird weiter automatisch gebucht, danach nicht mehr.</p>` +
        `</div>` +
        `<button type="button" class="btn primary" data-save>Als gekündigt speichern</button>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const on = sheet.querySelector("#ab-c-on").value;
          const ended = sheet.querySelector("#ab-c-end").value;
          if (!M.isKey(on) || !M.isKey(ended)) { ui.toast("Bitte beide Daten wählen."); return; }
          if (ended < on) { ui.toast("Das Ende liegt vor dem Kündigungsdatum."); return; }
          close();
          const ok = await opts.safeWrite(col.subs.patch(sub.id, { cancelledOn: on, ended, paused: false }), `${sub.name}: gekündigt, läuft bis ${M.fmtDate(ended)} ✓`);
          if (ok) finishReminders(sub);
        });
      },
    });
  }

  /* ---------- Formular ---------- */

  function openSub(sub = null, preset = null, onSaved = null) {
    const isNew = !sub;
    const s = sub || { name: "", amount: "", interval: "month", next: today(), category: "abos", paused: false, ...(preset || {}) };
    const outCats = opts.cats().filter((c) => c.type !== "in");
    const type0 = C.contractTypeOf(s);
    const v = (x) => esc(x == null ? "" : String(x));
    ui.openSheet({
      title: isNew ? "Neues Abo / Fixkosten" : "Abo bearbeiten",
      bodyHTML: `<div class="fields ab-form">` +
          `<label>Name<input id="mn-s-name" type="text" maxlength="40" placeholder="z. B. Netflix, A1, FitInn" value="${v(s.name)}" autocomplete="off"></label>` +
          `<p class="note ab-cat-hint" hidden></p>` +
          `<label>Was ist es?<input id="ab-what" type="text" maxlength="80" placeholder="z. B. Musik-Streaming Premium Individual" value="${v(s.what)}"></label>` +
          `<div class="row"><label>Betrag (€)<input id="mn-s-amt" inputmode="decimal" placeholder="9,99" value="${s.amount ? v(String(s.amount).replace(".", ",")) : ""}"></label>` +
          `<label>Intervall<select id="mn-s-int">${Object.entries(M.INTERVALS).map(([k, l]) => `<option value="${k}"${k === s.interval ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>` +
          `<div class="row"><label>Nächste Abbuchung<input id="mn-s-next" type="date" value="${v(s.next || today())}"></label>` +
          `<label>Kategorie<select id="mn-s-cat">${outCats.map((c) => `<option value="${esc(c.id)}"${c.id === s.category ? " selected" : ""}>${esc(c.emoji)} ${esc(c.name)}</option>`).join("")}</select></label></div>` +
          `<p class="lbl mn-lbl">Vertrag</p>` +
          `<div class="chips ab-types" role="radiogroup" aria-label="Vertragsart">${C.CONTRACT_TYPES.map((ct) => `<button type="button" class="chip" role="radio" data-ct="${esc(ct)}" aria-checked="${ct === type0}" aria-pressed="${ct === type0}">${esc(ct)}</button>`).join("")}</div>` +
          `<div class="row"><label data-show="Mindestlaufzeit">Mindestlaufzeit bis<input id="ab-min" type="date" value="${v(s.minTermEnd)}"></label>` +
          `<label data-show="Prepaid">Bezahlt bis<input id="ab-cend" type="date" value="${v(s.contractEnd)}"></label>` +
          `<label data-show="Testzeitraum">Testzeitraum endet am<input id="ab-trial" type="date" value="${v(s.trialEnd)}"></label>` +
          `<label>Seit<input id="ab-start" type="date" value="${v(s.startDate)}"></label></div>` +
          `<label data-show="monatlich kündbar|Mindestlaufzeit|Prepaid">Kündigungsfrist<input id="ab-notice" type="text" maxlength="60" placeholder="z. B. 1 Monat zum Monatsende, 14 Tage" value="${v(s.noticeText || (s.noticeDays != null && s.noticeDays !== "" ? s.noticeDays + " Tage" : ""))}"></label>` +
          `<label class="mn-check" data-show="Mindestlaufzeit|Prepaid"><input type="checkbox" id="ab-renew"${s.autoRenew !== false ? " checked" : ""}> Verlängert sich automatisch</label>` +
          `<p class="lbl mn-lbl">Kündigen</p>` +
          `<label>Kündigungslink<input id="ab-url" type="url" inputmode="url" placeholder="https://…" value="${v(s.cancelUrl)}" autocomplete="off"></label>` +
          `<label>Verwalten-Link (optional)<input id="ab-murl" type="url" inputmode="url" placeholder="https://…" value="${v(s.manageUrl)}" autocomplete="off"></label>` +
          `<label>So kündigst du<textarea id="ab-howf" rows="4" placeholder="Schritt für Schritt …">${v(s.cancelHow)}</textarea></label>` +
          `<label>Konto / Login (optional)<input id="ab-acc" type="text" maxlength="80" placeholder="z. B. deine E-Mail-Adresse" value="${v(s.account)}" autocomplete="off"></label>` +
          `<p class="note">🔐 Nur den Login – Passwörter gehören in den Passwort-Tresor.</p>` +
          `<label class="mn-check"><input type="checkbox" id="ab-rem"${s.remind !== false ? " checked" : ""}> Erinnerung im Planer vor Kündigungsfrist / Testende</label>` +
          `<label class="mn-check"><input type="checkbox" id="mn-s-pause"${s.paused ? " checked" : ""}> Pausiert (wird nicht gebucht)</label>` +
          (s.ended && s.paused ? `<p class="note">Beendet am ${esc(M.fmtDate(s.ended))}. Häkchen weg = wieder aktiv.</p>` : "") +
          (M.isKey(s.cancelledOn) ? `<p class="note">Gekündigt am ${esc(M.fmtDate(s.cancelledOn))}${M.isKey(s.ended) ? `, läuft bis ${esc(M.fmtDate(s.ended))}` : ""}.</p>` : "") +
          `<p class="note">Liegt der Termin heute oder in der Vergangenheit, wird die Zahlung sofort gebucht.</p>` +
        `</div>` +
        `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        const name = $("#mn-s-name"), catSel = $("#mn-s-cat"), hint = $(".ab-cat-hint"), intSel = $("#mn-s-int");
        let catTouched = !isNew, intTouched = !isNew, typeTouched = !isNew || !!(preset && preset.contractType);
        let type = type0;
        let catKey = s.catalogKey || null;
        // Felder, die der Katalog gefüllt hat (werden bei anderem Treffer ersetzt, eigene Eingaben nie)
        const auto = new Map();
        const FIELDS = { what: "#ab-what", cancelUrl: "#ab-url", manageUrl: "#ab-murl", cancelHow: "#ab-howf", noticeText: "#ab-notice" };
        const showType = () => {
          sheet.querySelectorAll("[data-ct]").forEach((b) => { const on = b.dataset.ct === type; b.setAttribute("aria-checked", String(on)); b.setAttribute("aria-pressed", String(on)); });
          sheet.querySelectorAll("[data-show]").forEach((n) => { n.hidden = !n.dataset.show.split("|").includes(type); });
        };
        const applyCatalog = (initial = false) => {
          const m = K.matchCatalog(name.value);
          const e = m && m.entry;
          for (const [f, val] of auto) { const inp = $(FIELDS[f]); if (inp && inp.value === val && (!e || K.catalogFill({}, e)[f] !== val)) inp.value = ""; }
          auto.clear();
          if (!e) { hint.hidden = true; catKey = isNew ? null : catKey; return; }
          catKey = e.key;
          const cur = Object.fromEntries(Object.entries(FIELDS).map(([f, q]) => [f, $(q).value]));
          const fill = K.catalogFill(cur, e, { interval: true });
          let n = 0;
          for (const f of Object.keys(FIELDS)) {
            if (fill[f] && !cur[f]) { $(FIELDS[f]).value = fill[f]; auto.set(f, fill[f]); n++; }
          }
          if (fill.interval && !intTouched) intSel.value = fill.interval;
          if (fill.contractType && !typeTouched) { type = fill.contractType; showType(); }
          if (!catTouched && e.category && [...catSel.options].some((o) => o.value === e.category)) catSel.value = e.category;
          hint.hidden = false;
          hint.innerHTML = `✨ <b>${esc(e.name)}</b> erkannt${n ? " – Beschreibung, Kündigungslink und Anleitung übernommen" : ""}.` +
            (e.verified === true ? "" : " Link führt zur offiziellen Hilfe-Seite.");
          if (initial && !n) hint.hidden = true;
        };
        showType();
        applyCatalog(true);
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-ct]");
          if (b) { type = b.dataset.ct; typeTouched = true; showType(); }
        });
        catSel.addEventListener("change", () => { catTouched = true; });
        intSel.addEventListener("change", () => { intTouched = true; });
        name.addEventListener("input", () => {
          applyCatalog();
          if (catTouched) return;
          const sg = M.suggestCategory(name.value, col.rules.all(), new Set(outCats.map((c) => c.id)));
          if (sg && !(K.matchCatalog(name.value) || {}).entry) catSel.value = sg.cat;
        });
        $("[data-save]").addEventListener("click", async () => {
          const n = name.value.trim();
          const a = M.parseAmount($("#mn-s-amt").value);
          const next = $("#mn-s-next").value;
          if (!n) { ui.toast("Bitte einen Namen eingeben."); return; }
          if (!(a > 0)) { ui.toast("Bitte einen Betrag eingeben."); return; }
          if (!M.isKey(next)) { ui.toast("Bitte den nächsten Termin wählen."); return; }
          const cancelUrl = $("#ab-url").value.trim(), manageUrl = $("#ab-murl").value.trim();
          if (cancelUrl && !isUrl(cancelUrl)) { ui.toast("Der Kündigungslink muss mit https:// beginnen."); $("#ab-url").focus(); return; }
          if (manageUrl && !isUrl(manageUrl)) { ui.toast("Der Verwalten-Link muss mit https:// beginnen."); $("#ab-murl").focus(); return; }
          const date = (q) => { const x = $(q).value; return M.isKey(x) ? x : null; };
          const minTermEnd = type === "Mindestlaufzeit" ? date("#ab-min") : (s.minTermEnd || null);
          const trialEnd = type === "Testzeitraum" ? date("#ab-trial") : (s.trialEnd || null);
          if (type === "Testzeitraum" && !trialEnd) { ui.toast("Wann endet der Testzeitraum?"); $("#ab-trial").focus(); return; }
          const interval = intSel.value;
          const day = interval === "week" ? null : M.dateOf(next).getDate();
          const paused = $("#mn-s-pause").checked;
          const noticeText = $("#ab-notice").value.trim();
          const extra = isNew && preset ? { source: preset.source, gmail: preset.gmail } : {};
          const item = {
            ...(sub || {}), ...extra,
            name: n, what: $("#ab-what").value.trim(), amount: a, interval, next, day, category: catSel.value, paused,
            contractType: type, startDate: date("#ab-start"), minTermEnd, trialEnd,
            contractEnd: type === "Prepaid" ? date("#ab-cend") : (s.contractEnd || null),
            noticeText, autoRenew: type === "Mindestlaufzeit" || type === "Prepaid" ? $("#ab-renew").checked : (s.autoRenew ?? null),
            cancelUrl, manageUrl, cancelHow: $("#ab-howf").value.trim(), account: $("#ab-acc").value.trim(),
            remind: $("#ab-rem").checked, catalogKey: catKey || null,
          };
          if (sub && noticeText !== (sub.noticeText || "")) item.noticeDays = null; // Text gilt
          // altes Gmail-Ende: Pause aus = wieder aktiv
          if (!paused && sub && sub.paused && sub.ended && !sub.cancelledOn) item.ended = null;
          close();
          const ok = await opts.safeWrite(col.subs.put(item), "Gespeichert ✓");
          if (ok && onSaved) onSaved();
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => { close(); await opts.safeWrite(col.subs.remove(sub.id), "Abo gelöscht – bisherige Buchungen bleiben"); });
      },
    });
  }

  /** Klick-Weiche für Elemente mit data-ab auf der Seite: true, wenn behandelt. */
  function onClick(t) {
    const a = t.dataset.ab;
    if (!a) return false;
    const s = t.dataset.id ? col.subs.get(t.dataset.id) : null;
    switch (a) {
      case "open": openDetail(s); break;
      case "cancel": if (s) openUrl(s.cancelUrl); break;
      case "edit": openSub(s); break;
      default: return false;
    }
    return true;
  }

  return { pageHTML, onClick, openSub, openDetail, catchUpReminders };
}
