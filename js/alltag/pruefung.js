// Update 14 – Alltag › ⚡ Prüfprotokoll (#alltag/pruefung): Erst-/Wiederholungsprüfung nach ÖVE/ÖNORM E 8101 dokumentieren –
// Besichtigen, Erproben, Messen je Stromkreis (Isolation, Schutzleiter, Zs, FI/RCD, UB, TT-Erdung) mit Live-Bewertung,
// Verknüpfung zur Baustelle, Druck/PDF. Lern- und Dokumentationshilfe – den Prüfbefund unterschreibt die befugte Fachkraft.
// Sammlung „pruefungen“. Logik: ./pruef-core.js
import { collection } from "./db.js";
import * as P from "./pruef-core.js";
import * as U from "./xui.js";
import * as ui from "../ui.js";
import * as store from "../store.js";
import { esc } from "../util.js";

export function mount(el) {
  U.loadCss("extras"); U.loadCss("pruefung");
  const col = collection("pruefungen");
  let sel = "", alive = true;
  const prots = () => col.all().map(P.normProt).filter((p) => p.id).sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.updated - a.updated);
  const places = () => ((store.get() || {}).places || []).filter((p) => p && p.id && p.name);
  const settings = () => (store.get() || {}).settings || {};
  const put = (p, ok) => U.safe(col.put({ ...p, updated: Date.now() }), ok);
  const cur = () => (sel ? P.normProt(col.get(sel) || {}) : null);
  const placeName = (id) => (places().find((p) => p.id === id) || {}).name || "";

  function render() {
    if (!alive) return;
    const p = cur();
    if (p && p.id) { el.innerHTML = detailHTML(p); return; }
    sel = "";
    const list = prots();
    el.innerHTML = `<div class="xu"><section class="card pp-intro"><b>⚡ Prüfprotokolle</b><p class="note">Besichtigen, Erproben, Messen – mit Grenzwerten nach ÖVE/ÖNORM E 8101. Lern- und Dokuhilfe: Den Prüfbefund unterschreibt die befugte Fachkraft.</p>
      <div class="xu-row"><button type="button" class="btn primary sm" data-x="new">➕ Neues Protokoll</button><button type="button" class="btn ghost sm" data-x="limits">📏 Grenzwerte</button></div></section>
      ${list.length ? `<ul class="xu-list">${list.map((x) => { const r = P.evalProt(x);
        return `<li><button type="button" class="xu-item${r.state === "fehler" ? " warn" : ""}" data-open="${esc(x.id)}"><span class="xu-ie">${x.status === "fertig" ? P.STATE_E[r.state] : "📝"}</span><span class="xu-im"><b>${esc(x.kunde || placeName(x.placeId) || "Ohne Kunde")}</b><small>${[x.date && fmtD(x.date), (P.ARTEN.find((a) => a[0] === x.art) || [])[1], `${x.circuits.length} Stromkreise`, x.status === "fertig" ? "abgeschlossen" : "Entwurf"].filter(Boolean).map(esc).join(" · ")}</small></span></button></li>`; }).join("")}</ul>`
        : U.empty("⚡", "Noch keine Prüfung", "Leg ein Protokoll an, trag die Stromkreise ein und dann die Messwerte – die App zeigt sofort, ob alles passt.")}</div>`;
  }
  const fmtD = (k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;
  const pill = (st) => `<span class="pp-st ${st}">${P.STATE_E[st]} ${{ ok: "in Ordnung", knapp: "knapp", fehler: "Mangel", offen: "offen" }[st]}</span>`;

  function detailHTML(p) {
    const r = P.evalProt(p);
    return `<div class="xu pp">
      <div class="xu-row"><button type="button" class="btn ghost sm" data-x="back">← Alle Protokolle</button><span class="xu-sp"></span><button type="button" class="btn ghost sm" data-x="print">🖨️ PDF</button></div>
      <section class="card"><div class="xu-row"><h3>${esc(p.kunde || placeName(p.placeId) || "Prüfprotokoll")}</h3><span class="xu-sp"></span>${pill(r.state)}</div>
        <p class="note">${[p.adresse, (P.ARTEN.find((a) => a[0] === p.art) || [])[1], `${p.netz} · U0 ${p.u0} V`, p.date && fmtD(p.date), p.pruefer && "Prüfer: " + p.pruefer, p.geraet && "Messgerät: " + p.geraet].filter(Boolean).map(esc).join(" · ")}</p>
        <button type="button" class="chip sm" data-x="head">✏️ Kopfdaten</button></section>
      <section class="card"><h3>👀 Besichtigen <small>${r.visOk}/${r.visAll}</small></h3><ul class="xu-check">${P.BESICHTIGUNG.map(([k, t]) => `<li class="${p.besichtigung[k] ? "done" : ""}"><label><input type="checkbox" data-vis="${k}"${p.besichtigung[k] ? " checked" : ""}><span>${esc(t)}</span></label></li>`).join("")}</ul></section>
      <section class="card"><h3>🔘 Erproben <small>${r.erpOk}/${r.erpAll}</small></h3><ul class="xu-check">${P.ERPROBEN.map(([k, t]) => `<li class="${p.erproben[k] ? "done" : ""}"><label><input type="checkbox" data-erp="${k}"${p.erproben[k] ? " checked" : ""}><span>${esc(t)}</span></label></li>`).join("")}</ul>
        <div class="xu-row"><span>Drehfeld:</span>${[["", "–"], ["rechts", "✅ rechts"], ["links", "❌ links"]].map(([v, l]) => `<button type="button" class="chip sm" data-dreh="${v}" aria-pressed="${p.drehfeld === v}">${l}</button>`).join("")}</div></section>
      <section class="card"><div class="xu-row"><h3>📏 Messen <small>${p.circuits.length} Stromkreise${r.fail ? ` · ❌ ${r.fail}` : ""}${r.warn ? ` · ⚠️ ${r.warn}` : ""}${r.open ? ` · ⏳ ${r.open}` : ""}</small></h3><span class="xu-sp"></span><button type="button" class="chip sm" data-x="addc">➕</button><button type="button" class="chip sm" data-x="bulk">📋 Liste</button></div>
        ${p.netz === "TT" ? `<div class="xu-row pp-ra"><span>🌍 Erdungswiderstand RA:</span><b>${r.ra && r.ra.value != null ? P.fmt(r.ra.value) + " Ω" : "–"}</b>${r.ra && r.ra.limit ? `<small>max. ${r.ra.limit} Ω (RA · IΔn ≤ 50 V)</small>` : ""}${r.ra ? pill(r.ra.state) : ""}<button type="button" class="chip sm" data-x="ra">✏️</button></div>` : ""}
        ${r.circuits.length ? `<ul class="xu-list">${r.circuits.map(({ c, r: cr }) => `<li><button type="button" class="xu-item pp-c ${cr.state}" data-c="${esc(c.id)}"><span class="xu-ie">${P.STATE_E[cr.state]}</span><span class="xu-im"><b>${esc([c.nr, c.name].filter(Boolean).join(" · ") || "Stromkreis")}</b>
          <small>${esc([c.schutz && c.in ? (c.schutz === "gG" ? "gG " : c.schutz) + c.in + " A" : "", c.mm2 && P.fmt(c.mm2) + " mm²", c.rcd && `FI ${c.rcd} mA`].filter(Boolean).join(" · "))}</small>
          <small>${cr.checks.filter((x) => x.value != null).map((x) => `${{ riso: "Riso", rpe: "RPE", zs: "Zs", rcdT: "tA", rcdI: "IΔ", ub: "UB" }[x.key]} ${esc(x.value)}`).join(" · ") || "noch keine Messwerte"}</small></span></button></li>`).join("")}</ul>`
          : `<p class="note">Trag die Stromkreise aus dem Verteiler ein – einzeln oder als Liste (z. B. „1 Licht Küche B10 1,5“).</p>`}</section>
      <section class="card"><div class="xu-row"><h3>📝 Befund</h3><span class="xu-sp"></span><button type="button" class="chip sm" data-x="befund">✏️</button></div>
        ${p.maengel ? `<p><b>Mängel:</b> ${esc(p.maengel)}</p>` : ""}${p.befund ? `<p style="white-space:pre-line">${esc(p.befund)}</p>` : `<p class="note">Ergebnis und Mängel festhalten.</p>`}
        <div class="xu-row">${p.status === "fertig" ? `<button type="button" class="btn ghost sm" data-x="reopen">✏️ Wieder bearbeiten</button>` : `<button type="button" class="btn primary sm" data-x="finish"${r.state === "offen" ? " disabled title=\"Erst alle Messwerte eintragen\"" : ""}>✅ Abschließen</button>`}</div></section>
      <button type="button" class="btn danger sm" data-x="del">🗑️ Protokoll löschen</button>
    </div>`;
  }

  function headForm(p0) {
    const isNew = !p0; const p = P.normProt(p0 || { date: U.todayKey(), pruefer: ((settings().apprentice || {}).name) || "" });
    const ps = places();
    U.form({ title: isNew ? "⚡ Neues Prüfprotokoll" : "Kopfdaten", fields: [
      { id: "placeId", label: "Baustelle (optional)", type: "select", value: p.placeId, options: [["", "–"], ...ps.map((x) => [x.id, x.name])] },
      { id: "kunde", label: "Kunde / Anlage", value: p.kunde, placeholder: "z. B. Fam. Huber, EFH" }, { id: "adresse", label: "Adresse", value: p.adresse },
      { type: "row", fields: [{ id: "art", label: "Art", type: "select", value: p.art, options: P.ARTEN }, { id: "netz", label: "Netzsystem", type: "select", value: p.netz, options: P.NETZE.map((n) => [n, n]) }] },
      { type: "row", fields: [{ id: "date", label: "Datum", type: "date", value: p.date }, { id: "u0", label: "U0", type: "select", value: p.u0, options: [[230, "230 V"], [220, "220 V"]] }] },
      { id: "pruefer", label: "Prüfer:in", value: p.pruefer }, { id: "geraet", label: "Messgerät (Typ, Seriennr.)", value: p.geraet, placeholder: "z. B. Fluke 1664 FC, SN …" },
    ], onSave: async (v) => {
      const place = ps.find((x) => x.id === v.placeId);
      const doc = P.normProt({ ...p, ...v, u0: Number(v.u0), kunde: v.kunde || (place ? place.name : ""), adresse: v.adresse || (place && place.address) || "", created: p.created || Date.now() });
      const id = await put({ ...doc, id: doc.id || undefined }, isNew ? "⚡ Protokoll angelegt" : "Gespeichert ✓");
      if (isNew && typeof id === "string") { sel = id; render(); }
    } });
  }
  function circuitForm(p, c0) {
    const isNew = !c0; const c = P.normCircuit(c0 || { nr: String(p.circuits.length + 1) });
    const live = () => {
      const sh = document.querySelector(".sheet:last-child"); if (!sh) return;
      const v = (id) => { const e = sh.querySelector("#xf-" + id); return e ? (e.type === "checkbox" ? e.checked : e.value) : undefined; };
      const r = P.evalCircuit({ schutz: v("schutz"), in: v("in"), ia: v("ia"), rcd: v("rcd"), rcdS: v("rcdS"), riso: v("riso"), uiso: v("uiso"), rpe: v("rpe"), zs: v("zs"), rcdT: v("rcdT"), rcdI: v("rcdI"), ub: v("ub") }, p);
      sh.querySelector("[data-live]").innerHTML = r.checks.map((x) => `<li class="${x.state}">${P.STATE_E[x.state]} ${esc(x.label)}: <b>${esc(x.value || "–")}</b> <small>(${esc(x.limit)})</small></li>`).join("");
    };
    U.form({ title: isNew ? "➕ Stromkreis" : `Stromkreis ${c.nr}`, fields: [
      { type: "row", fields: [{ id: "nr", label: "Nr.", value: c.nr, max: 10 }, { id: "name", label: "Bezeichnung", value: c.name, placeholder: "z. B. Steckdosen Küche" }] },
      { type: "row", fields: [{ id: "schutz", label: "Schutzorgan", type: "select", value: c.schutz, options: P.SCHUTZ }, { id: "in", label: "In (A)", type: "number", value: c.in ?? "" }, { id: "mm2", label: "mm²", type: "number", value: c.mm2 ?? "" }] },
      { id: "ia", label: "nur bei Sicherung gG: Abschaltstrom Ia für 0,4 s (A, aus Kennlinie)", type: "number", value: c.ia ?? "" },
      { type: "row", fields: [{ id: "rcd", label: "FI/RCD", type: "select", value: c.rcd, options: [["", "keiner"], ["30", "30 mA"], ["100", "100 mA"], ["300", "300 mA"], ["500", "500 mA"]] }, { id: "rcdTyp", label: "Typ", type: "select", value: c.rcdTyp, options: P.RCD_TYPEN.map((t) => [t, "Typ " + t]) }] },
      { id: "rcdS", label: "FI selektiv (S)", type: "check", value: c.rcdS },
      { type: "html", html: `<div class="lbl">📏 Messwerte</div>` },
      { type: "row", fields: [{ id: "riso", label: "Riso (MΩ)", type: "number", value: c.riso ?? "" }, { id: "uiso", label: "Prüfspannung", type: "select", value: c.uiso, options: [[500, "500 V DC"], [250, "250 V (SELV/PELV)"], [1000, "1000 V DC"]] }] },
      { type: "row", fields: [{ id: "rpe", label: "RPE (Ω)", type: "number", value: c.rpe ?? "" }, { id: "zs", label: "Zs (Ω)", type: "number", value: c.zs ?? "" }] },
      { type: "row", fields: [{ id: "rcdT", label: "tA bei IΔn (ms)", type: "number", value: c.rcdT ?? "" }, { id: "rcdI", label: "IΔ (mA)", type: "number", value: c.rcdI ?? "" }, { id: "ub", label: "UB (V)", type: "number", value: c.ub ?? "" }] },
      { type: "html", html: `<ul class="pp-live" data-live aria-live="polite"></ul>` },
      { id: "note", label: "Bemerkung", value: c.note, max: 200 },
    ], onSave: (v) => {
      const n = P.normCircuit({ ...c, ...v, uiso: Number(v.uiso) });
      put({ ...p, circuits: isNew ? [...p.circuits, n] : p.circuits.map((x) => (x.id === c.id ? n : x)) }, "📏 Gespeichert");
    }, onDelete: isNew ? null : () => put({ ...p, circuits: p.circuits.filter((x) => x.id !== c.id) }, "Gelöscht") });
    const sh = document.querySelector(".sheet:last-child");
    if (sh) { sh.addEventListener("input", live); sh.addEventListener("change", live); live(); }
  }
  function limitsSheet() {
    ui.openSheet({ title: "📏 Grenzwerte (Richtwerte)", bodyHTML: `<div class="pp-lim"><table><tbody>
      <tr><td>Isolationswiderstand</td><td>≥ 1 MΩ bei 500 V DC (bis 500 V Nennspannung)<br>≥ 0,5 MΩ bei 250 V DC (SELV/PELV)</td></tr>
      <tr><td>Schleifenimpedanz (TN)</td><td>Zs ≤ U0 / Ia · Ia = 5·In (B), 10·In (C), 20·In (D)<br>z. B. B16: ≤ 2,88 Ω · C16: ≤ 1,44 Ω · B10: ≤ 4,6 Ω<br>über 2/3 davon: knapp (Leitung erwärmt sich im Betrieb)</td></tr>
      <tr><td>FI/RCD unverzögert</td><td>Auslösezeit bei IΔn ≤ 300 ms · Auslösestrom 0,5–1 × IΔn</td></tr>
      <tr><td>FI selektiv (S)</td><td>130–500 ms bei IΔn</td></tr>
      <tr><td>Berührungsspannung</td><td>UB ≤ 50 V (AC)</td></tr>
      <tr><td>TT-Erdung</td><td>RA · IΔn ≤ 50 V → bei 30 mA ≤ 1666 Ω, bei 300 mA ≤ 166 Ω</td></tr>
      <tr><td>RCD-Typ</td><td>Typ AC seit OVE E 8101:2025 in neuen Anlagen und bei Änderungen/Erweiterungen unzulässig – mind. Typ A</td></tr>
      <tr><td>30-mA-Zusatzschutz</td><td>Steckdosen-Stromkreise bis 32 A, Endstromkreise mit Leuchten in Wohnräumen (seit 2025)</td></tr>
      <tr><td>Schutzleiter</td><td>durchgängig, niederohmig – Richtwert ≤ 1 Ω</td></tr></tbody></table>
      <p class="note">Nach ÖVE/ÖNORM E 8101 Teil 6 (bzw. HD 60364-6). Maßgeblich sind immer die aktuell gültige Norm, Herstellerangaben und die Vorgaben deines Betriebs.</p></div>` });
  }
  function printProt(p) {
    const r = P.evalProt(p);
    const root = document.createElement("div"); root.id = "pp-print";
    const row = (c, cr) => `<tr><td>${esc(c.nr)}</td><td>${esc(c.name)}</td><td>${esc(c.schutz && c.in ? (c.schutz === "gG" ? "gG " : c.schutz) + c.in : "")}</td><td>${esc(c.mm2 ? P.fmt(c.mm2) : "")}</td><td>${esc(c.rcd ? c.rcd + " mA " + c.rcdTyp + (c.rcdS ? " S" : "") : "")}</td><td>${P.fmt(c.riso)}</td><td>${P.fmt(c.rpe)}</td><td>${p.netz === "TT" ? "–" : P.fmt(c.zs)}</td><td>${P.fmt(c.rcdT)}</td><td>${P.fmt(c.rcdI)}</td><td>${P.fmt(c.ub)}</td><td>${{ ok: "i. O.", knapp: "i. O. (knapp)", fehler: "MANGEL", offen: "offen" }[cr.state]}</td></tr>`;
    root.innerHTML = `<h1>Prüfprotokoll – Elektrische Anlage</h1><p class="pp-sub">nach ÖVE/ÖNORM E 8101 Teil 6 · ${esc((P.ARTEN.find((a) => a[0] === p.art) || [])[1] || "")}</p>
      <table class="pp-kv"><tbody><tr><th>Kunde/Anlage</th><td>${esc(p.kunde)}</td><th>Datum</th><td>${p.date ? fmtD(p.date) : ""}</td></tr><tr><th>Adresse</th><td>${esc(p.adresse)}</td><th>Netz</th><td>${esc(p.netz)} · U0 ${p.u0} V</td></tr>
      <tr><th>Prüfer:in</th><td>${esc(p.pruefer)}</td><th>Messgerät</th><td>${esc(p.geraet)}</td></tr>${p.netz === "TT" ? `<tr><th>Erdungswiderstand RA</th><td>${P.fmt(p.ra)} Ω</td><th>Drehfeld</th><td>${esc(p.drehfeld || "–")}</td></tr>` : `<tr><th>Drehfeld</th><td>${esc(p.drehfeld || "–")}</td><th></th><td></td></tr>`}</tbody></table>
      <h2>Besichtigen</h2><ul>${P.BESICHTIGUNG.map(([k, t]) => `<li>${p.besichtigung[k] ? "☑" : "☐"} ${esc(t)}</li>`).join("")}</ul>
      <h2>Erproben</h2><ul>${P.ERPROBEN.map(([k, t]) => `<li>${p.erproben[k] ? "☑" : "☐"} ${esc(t)}</li>`).join("")}</ul>
      <h2>Messen</h2><table class="pp-m"><thead><tr><th>Nr</th><th>Stromkreis</th><th>Schutz</th><th>mm²</th><th>RCD</th><th>Riso MΩ</th><th>RPE Ω</th><th>Zs Ω</th><th>tA ms</th><th>IΔ mA</th><th>UB V</th><th>Ergebnis</th></tr></thead>
      <tbody>${r.circuits.map(({ c, r: cr }) => row(c, cr)).join("")}</tbody></table>
      <h2>Befund</h2><p><b>Gesamtergebnis:</b> ${{ ok: "Keine Mängel festgestellt", fehler: "Mängel festgestellt", offen: "Prüfung nicht vollständig" }[r.state]}</p>${p.maengel ? `<p><b>Mängel:</b> ${esc(p.maengel)}</p>` : ""}${p.befund ? `<p>${esc(p.befund)}</p>` : ""}
      <div class="pp-sign"><div>Ort, Datum</div><div>Unterschrift Prüfer:in</div><div>Unterschrift befugte Fachkraft</div></div>`;
    document.body.appendChild(root);
    document.documentElement.classList.add("pp-printing");
    const done = () => { document.documentElement.classList.remove("pp-printing"); root.remove(); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => { try { window.print(); } catch { ui.toast("Drucken geht hier nicht."); } setTimeout(() => { if (document.getElementById("pp-print")) done(); }, 60000); }, 50);
  }

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b || !el.contains(b)) return;
    const d = b.dataset, p = cur();
    if (d.open) { sel = d.open; render(); window.scrollTo({ top: 0 }); return; }
    if (d.c && p) { circuitForm(p, p.circuits.find((x) => x.id === d.c)); return; }
    if (d.dreh != null && p) { put({ ...p, drehfeld: d.dreh }); return; }
    switch (d.x) {
      case "new": headForm(null); break;
      case "limits": limitsSheet(); break;
      case "back": sel = ""; render(); break;
      case "head": headForm(p); break;
      case "addc": circuitForm(p, null); break;
      case "bulk": U.form({ title: "📋 Stromkreise als Liste", note: "Eine Zeile pro Stromkreis: Nr, Bezeichnung, Schutzorgan, Querschnitt, ggf. FI – z. B. „1 Licht Küche B10 1,5“ oder „F3 Steckdosen Bad C16 2,5 FI30“.",
        fields: [{ id: "lines", label: "Stromkreise", type: "textarea", rows: 10, max: 4000 }], onSave: (v) => { const add = v.lines.split("\n").map(P.parseCircuitLine).filter(Boolean); if (!add.length) return false; put({ ...p, circuits: [...p.circuits, ...add] }, `➕ ${add.length} Stromkreise`); } }); break;
      case "ra": U.form({ title: "🌍 Erdungswiderstand", fields: [{ id: "ra", label: "RA (Ω)", type: "number", value: p.ra ?? "" }], onSave: (v) => { put({ ...p, ra: v.ra }); } }); break;
      case "befund": U.form({ title: "📝 Befund", fields: [{ id: "maengel", label: "Mängel (falls vorhanden)", type: "textarea", value: p.maengel, max: 2000 }, { id: "befund", label: "Bemerkungen / Ergebnis", type: "textarea", rows: 5, value: p.befund, max: 2000 }], onSave: (v) => { put({ ...p, ...v }, "Gespeichert ✓"); } }); break;
      case "finish": put({ ...p, status: "fertig" }, P.evalProt(p).state === "ok" ? "✅ Abgeschlossen – keine Mängel" : "Abgeschlossen – Mängel vermerkt"); break;
      case "reopen": put({ ...p, status: "entwurf" }); break;
      case "print": printProt(p); break;
      case "del": U.form({ title: "🗑️ Protokoll löschen?", fields: [{ type: "html", html: `<p>„${esc(p.kunde || "Prüfprotokoll")}“ wird endgültig gelöscht.</p>` }], saveLabel: "Löschen", onSave: () => { U.safe(col.remove(p.id), "Gelöscht"); sel = ""; } }); break;
      default: break;
    }
  });
  el.addEventListener("change", (ev) => {
    const p = cur(); if (!p) return;
    const v = ev.target.closest("[data-vis]"), e = ev.target.closest("[data-erp]");
    if (v) put({ ...p, besichtigung: { ...p.besichtigung, [v.dataset.vis]: v.checked } });
    if (e) put({ ...p, erproben: { ...p.erproben, [e.dataset.erp]: e.checked } });
  });
  const off = col.watch(() => queueMicrotask(render));
  render();
  return () => { alive = false; off(); const r = document.getElementById("pp-print"); if (r) r.remove(); document.documentElement.classList.remove("pp-printing"); };
}
