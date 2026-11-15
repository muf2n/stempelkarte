// 🧾 Alltag › Steuer-Helfer (#alltag/steuer): Arbeitnehmerveranlagung vorbereiten – Lohnzettel-Werte, Pendlerpauschale aus
// deinen Arbeitstagen, Werbungskosten aus „Geld“, geschätzte Gutschrift und die Kennzahlen für FinanzOnline.
// Logik: ./steuer-core.js · Sammlung „steuer“ (Dokument je Jahr). SCHÄTZUNG – verbindlich rechnet nur das Finanzamt.
import { collection } from "./db.js";
import * as X from "./steuer-core.js";
import * as store from "../store.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const YEAR_KEY = "sk-steuer-year";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const MON = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
function loadCss() {
  if (document.querySelector('link[data-css="steuer"]')) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.css = "steuer";
  l.href = new URL("../../css/alltag-steuer.css", import.meta.url).href; document.head.appendChild(l);
}

export function mount(el) {
  loadCss();
  const col = collection("steuer"), money = collection("money_tx");
  col.get("x"); money.get("x");
  const years = Object.keys(X.YEARS).map(Number);
  const S = { year: years.includes(Number(lsGet(YEAR_KEY))) ? Number(lsGet(YEAR_KEY)) : years[0], alive: true };
  const doc = () => col.get(String(S.year)) || {};
  const save = (patch) => { const d = { ...doc(), ...patch, id: String(S.year), updated: Date.now() }; try { const p = col.put(d); if (p && p.catch) p.catch(() => {}); } catch { /* egal */ } };

  function calc() {
    const d = doc(), snap = store.get() || {};
    const days = Array.isArray(d.days) && d.days.length === 12 ? d.days : X.pendelDays(snap.entries, S.year);
    const km = X.num(d.km), gross = !!d.gross;
    const pend = km ? X.pendler(S.year, km, gross, days) : { pp: 0, pe: 0, perMonth: 0, fractions: days.map(() => 0) };
    const skip = new Set(d.skip || []);
    const fromMoney = X.wkFromMoney(money.all(), S.year);
    const extra = (d.extra || []).filter((x) => x && x.name);
    const sums = { 719: 0, 720: 0, 721: 0, 722: 0, 724: 0 };
    for (const t of fromMoney) if (!skip.has(t.id)) sums[t.kz] += t.amt;
    for (const t of extra) sums[t.kz] = (sums[t.kz] || 0) + X.num(t.amt);
    const wk = Object.values(sums).reduce((a, b) => a + b, 0);
    const est = X.estimate({ year: S.year, kz245: d.kz245, sv: d.sv, lst: d.lst, pp: pend.pp, pe: pend.pe, wk, gew: d.gew, ppDone: !!d.inAG });
    return { d, days, km, gross, pend, fromMoney, skip, extra, sums, wk, est, autoDays: !(Array.isArray(d.days) && d.days.length === 12) };
  }

  function render() {
    if (!S.alive) return;
    const c = calc(), d = c.d, e = c.est, filled = X.num(d.kz245) > 0;
    const kzRows = [[718, !d.inAG ? c.pend.pp : 0], [916, !d.inAG ? c.pend.pe : 0], [717, X.num(d.gew)], [719, c.sums[719]], [720, c.sums[720]], [721, c.sums[721]], [722, c.sums[722]], [724, c.sums[724]]].filter(([, v]) => v > 0);
    el.innerHTML = `<div class="st">
      <div class="st-years" role="tablist">${years.map((y) => `<button type="button" role="tab" aria-selected="${y === S.year}" class="${y === S.year ? "on" : ""}" data-a="year" data-v="${y}">${y}</button>`).join("")}</div>
      <section class="st-result ${!filled ? "empty" : e.gut >= 0 ? "plus" : "minus"}">
        ${filled ? `<small>Geschätzte ${e.gut >= 0 ? "Gutschrift" : "Nachzahlung"} für ${S.year}</small><b>${X.eur(Math.abs(e.gut))}</b>
          <details><summary>So ist das gerechnet</summary><ul class="st-calc">
            <li><span>Steuerpflichtige Bezüge (KZ 245)</span><b>${X.eur(X.num(d.kz245))}</b></li>
            <li><span>− Werbungskosten ${e.pauschaleOnly ? "(Pauschale)" : ""}</span><b>${X.eur(e.wkUsed)}</b></li>
            ${X.num(d.gew) ? `<li><span>− Gewerkschaft</span><b>${X.eur(X.num(d.gew))}</b></li>` : ""}
            ${c.pend.pp && !d.inAG ? `<li><span>− Pendlerpauschale</span><b>${X.eur(c.pend.pp)}</b></li>` : ""}
            <li class="sum"><span>= Einkommen</span><b>${X.eur(e.E)}</b></li>
            <li><span>Steuer laut Tarif</span><b>${X.eur(e.t)}</b></li>
            <li><span>− Absetzbeträge (Verkehrsabsetzbetrag ${X.eur(e.vab)}${e.zus ? `, Zuschlag ${X.eur(e.zus)}` : ""}${e.pe ? `, Pendlereuro ${X.eur(e.pe)}` : ""})</span><b>${X.eur(e.credits)}</b></li>
            <li class="sum"><span>= Steuer</span><b>${X.eur(e.tax)}</b></li>
            <li><span>Bezahlte Lohnsteuer (KZ 260)</span><b>${X.eur(X.num(d.lst))}</b></li>
            ${e.refundSV ? `<li><span>+ SV-Rückerstattung (55 % der SV-Beiträge, gedeckelt)</span><b>${X.eur(e.refundSV)}</b></li>` : ""}
          </ul>${e.est ? `<p class="note">≈ Ein Grenzwert für ${S.year} ist noch nicht offiziell veröffentlicht – hier geschätzt.</p>` : ""}</details>`
        : `<small>Trag unten die 3 Zahlen von deinem Lohnzettel ein</small><b>? €</b>`}
        <p class="st-disc">Schätzung ohne Gewähr – keine Steuerberatung. Verbindlich rechnet nur das Finanzamt.</p>
      </section>

      <section class="st-card"><h3><span>1</span> Lohnzettel ${S.year}</h3>
        <p class="note">Steht auf deinem Jahreslohnzettel (L16). Den bekommst du vom Betrieb oder siehst ihn in FinanzOnline › Abfragen.</p>
        <div class="st-grid">
          <label>Steuerpflichtige Bezüge <small>KZ 245</small><input inputmode="decimal" data-f="kz245" value="${esc(d.kz245 ?? "")}" placeholder="z. B. 12.480,00"></label>
          <label>SV-Beiträge <small>KZ 230</small><input inputmode="decimal" data-f="sv" value="${esc(d.sv ?? "")}" placeholder="z. B. 1.850,00"></label>
          <label>Einbehaltene Lohnsteuer <small>KZ 260</small><input inputmode="decimal" data-f="lst" value="${esc(d.lst ?? "")}" placeholder="0,00"></label>
        </div></section>

      <section class="st-card"><h3><span>2</span> Pendeln zur Arbeit</h3>
        <p class="note">Die Kilometer und ob „klein“ oder „groß“ sagt dir der offizielle <a href="https://pendlerrechner.bmf.gv.at/pendlerrechner/" target="_blank" rel="noopener">Pendlerrechner des BMF</a> (Wohnung → Betrieb). Den Ausdruck (L34) brauchst du als Nachweis.</p>
        <div class="st-grid">
          <label>Einfache Strecke (km)<input inputmode="numeric" data-f="km" value="${esc(d.km ?? "")}" placeholder="z. B. 24"></label>
          <div class="st-seg" role="group" aria-label="Art"><button type="button" data-a="gross" data-v="0" aria-pressed="${!d.gross}">Kleines<small>Öffis zumutbar, ab 20 km</small></button><button type="button" data-a="gross" data-v="1" aria-pressed="${!!d.gross}">Großes<small>Öffis unzumutbar, ab 2 km</small></button></div>
        </div>
        <label class="st-check"><input type="checkbox" data-f="inAG"${d.inAG ? " checked" : ""}> Mein Betrieb berücksichtigt das Pendlerpauschale schon in der Lohnverrechnung</label>
        <div class="st-months">${c.days.map((n, i) => `<label class="f${Math.round(c.pend.fractions[i] * 3)}"><span>${MON[i]}</span><input inputmode="numeric" data-day="${i}" value="${n}" aria-label="Pendeltage ${MON[i]}"><small>${c.pend.fractions[i] === 1 ? "voll" : c.pend.fractions[i] ? `${Math.round(c.pend.fractions[i] * 3)}/3` : "–"}</small></label>`).join("")}</div>
        <p class="note">${c.autoDays ? "📅 Pendeltage automatisch aus deinen Einträgen (Arbeit, Urlaub, Krankenstand – ohne Berufsschule)." : `✏️ Von dir angepasst. <button type="button" class="st-link" data-a="resetdays">Wieder automatisch</button>`} Ab 11 Tagen im Monat volles Pauschale, 8–10 = ⅔, 4–7 = ⅓.</p>
        ${c.km ? `<div class="st-pp"><span>Pendlerpauschale <b>${X.eur(c.pend.pp)}</b></span><span>Pendlereuro <b>${X.eur(c.pend.pe)}</b></span></div>${c.pend.perMonth ? "" : `<p class="note">⚠️ Für ${c.km} km gibt es ${c.gross ? "noch kein" : "kein kleines"} Pauschale (${c.gross ? "ab 2 km" : "erst ab 20 km"}).</p>`}` : ""}
      </section>

      <section class="st-card"><h3><span>3</span> Werbungskosten</h3>
        <p class="note">Was du selbst für die Arbeit bezahlt hast: Werkzeug, typische Arbeitskleidung, Fachbücher, Kurse. Die ersten ${X.WK_PAUSCHALE} € zählen als Pauschale sowieso – erst darüber bringt es was.</p>
        ${c.fromMoney.length ? `<ul class="st-tx">${c.fromMoney.map((t) => `<li><label><input type="checkbox" data-tx="${esc(t.id)}"${c.skip.has(t.id) ? "" : " checked"}><span>${esc(t.date.split("-").reverse().join("."))} · ${esc(t.name)}<small>KZ ${t.kz} · aus Geld</small></span><b>${X.eur(t.amt)}</b></label></li>`).join("")}</ul>` : `<p class="note">In „Geld“ sind für ${S.year} keine Ausgaben in „Werkzeug & Arbeit“ oder „Schule“.</p>`}
        ${c.extra.length ? `<ul class="st-tx">${c.extra.map((t, i) => `<li><span>${esc(t.name)}<small>KZ ${t.kz}</small></span><b>${X.eur(X.num(t.amt))}</b><button type="button" class="st-del" data-a="delx" data-i="${i}" aria-label="Entfernen">✕</button></li>`).join("")}</ul>` : ""}
        <button type="button" class="btn" data-a="addx">➕ Ausgabe hinzufügen</button>
        <label>Gewerkschaftsbeitrag (falls selbst bezahlt) <small>KZ 717</small><input inputmode="decimal" data-f="gew" value="${esc(d.gew ?? "")}" placeholder="0,00"></label>
        <div class="st-pp"><span>Werbungskosten gesamt <b>${X.eur(c.wk)}</b></span><span>${c.wk > X.WK_PAUSCHALE ? `davon wirksam <b>${X.eur(c.wk - X.WK_PAUSCHALE)}</b>` : `unter der Pauschale`}</span></div>
      </section>

      <section class="st-card"><h3><span>4</span> In FinanzOnline eintragen</h3>
        ${kzRows.length ? `<table class="st-kz"><tbody>${kzRows.map(([k, v]) => `<tr><td>KZ ${k}</td><td>${esc(X.KZ[k])}</td><td>${X.eur(v)}</td></tr>`).join("")}</tbody></table>
          <button type="button" class="btn" data-a="copy">📋 Als Text kopieren</button>` : `<p class="note">Noch nichts einzutragen. ${filled ? "Vielleicht bekommst du trotzdem Geld zurück – die SV-Rückerstattung passiert automatisch bei der Veranlagung." : ""}</p>`}
        <ol class="st-steps"><li>Auf <a href="https://finanzonline.bmf.gv.at" target="_blank" rel="noopener">finanzonline.bmf.gv.at</a> anmelden (ID Austria).</li><li>Eingaben › Erklärungen › <b>Arbeitnehmerveranlagung ${S.year}</b> (L1).</li><li>Bei „Werbungskosten“ die Kennzahlen oben eintragen.</li><li>Absenden – den Bescheid bekommst du meist nach ein paar Wochen.</li></ol>
        <p class="note">Tipp: Du kannst die Veranlagung bis zu 5 Jahre rückwirkend machen. Belege 7 Jahre aufheben (z. B. in 📂 Dokumente).</p>
      </section>
    </div>`;
  }

  const onInput = (ev) => {
    const f = ev.target.closest("[data-f]");
    if (f && f.type !== "checkbox") { clearTimeout(S.t); S.t = setTimeout(() => { save({ [f.dataset.f]: f.value.trim() }); }, 500); return; }
    const dd = ev.target.closest("[data-day]");
    if (dd) { clearTimeout(S.t); S.t = setTimeout(() => { const c = calc(); const days = c.days.slice(); days[Number(dd.dataset.day)] = Math.max(0, Math.min(31, Math.round(X.num(dd.value)))); save({ days }); }, 600); }
  };
  el.addEventListener("input", onInput);
  el.addEventListener("change", (ev) => {
    const f = ev.target.closest("[data-f]");
    if (f && f.type === "checkbox") { save({ [f.dataset.f]: f.checked }); return; }
    if (f) { clearTimeout(S.t); save({ [f.dataset.f]: f.value.trim() }); return; }
    const tx = ev.target.closest("[data-tx]");
    if (tx) { const skip = new Set(doc().skip || []); if (tx.checked) skip.delete(tx.dataset.tx); else skip.add(tx.dataset.tx); save({ skip: [...skip] }); }
  });
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-a]"); if (!b) return;
    switch (b.dataset.a) {
      case "year": S.year = Number(b.dataset.v); lsSet(YEAR_KEY, String(S.year)); render(); break;
      case "gross": save({ gross: b.dataset.v === "1" }); break;
      case "resetdays": save({ days: null }); break;
      case "delx": { const ex = (doc().extra || []).slice(); ex.splice(Number(b.dataset.i), 1); save({ extra: ex }); break; }
      case "addx": ui.openSheet({ title: "Werbungskosten hinzufügen", bodyHTML: `<div class="fields"><label>Was?<input id="st-xn" placeholder="z. B. Arbeitsschuhe S3"></label><label>Betrag (€)<input id="st-xa" inputmode="decimal" placeholder="0,00"></label>
          <label>Art<select id="st-xk">${[719, 720, 721, 722, 724].map((k) => `<option value="${k}">${k} – ${X.KZ[k]}</option>`).join("")}</select></label></div><button type="button" class="btn primary" data-save style="width:100%">Hinzufügen</button>`,
        onMount(sh, close) { sh.querySelector("[data-save]").addEventListener("click", () => { const name = sh.querySelector("#st-xn").value.trim(), amt = sh.querySelector("#st-xa").value.trim(); if (!name || !(X.num(amt) > 0)) { ui.toast("Bitte Name und Betrag eingeben."); return; } close(); save({ extra: [...(doc().extra || []), { name: name.slice(0, 60), amt, kz: Number(sh.querySelector("#st-xk").value) }] }); }); } }); break;
      case "copy": {
        const c = calc(), d = c.d;
        const rows = [[718, !d.inAG ? c.pend.pp : 0], [916, !d.inAG ? c.pend.pe : 0], [717, X.num(d.gew)], [719, c.sums[719]], [720, c.sums[720]], [721, c.sums[721]], [722, c.sums[722]], [724, c.sums[724]]].filter(([, v]) => v > 0);
        const txt = `Arbeitnehmerveranlagung ${S.year}\n` + rows.map(([k, v]) => `KZ ${k} ${X.KZ[k]}: ${X.eur(v)}`).join("\n");
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => ui.toast("📋 Kopiert"), () => ui.toast("Kopieren ging nicht"));
        break;
      }
    }
  });
  const off1 = col.watch(() => { if (!el.contains(document.activeElement) || document.activeElement.tagName !== "INPUT") render(); });
  const off2 = money.watch(() => render());
  render();
  return () => { S.alive = false; try { off1(); off2(); } catch { /* egal */ } };
}
