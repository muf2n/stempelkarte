// Update 12 – Alltag › 🏠 Wohnen (#alltag/wohnen): „Wo liegt was?“ (Fundbüro für Gegenstände), Verleih (verliehen/geliehen mit
// Rückgabe-Erinnerung), Nebenkosten mit Zählerständen & Verbrauch, Räume (Größe, Notizen) und Umzugsplaner mit
// österreichischer Checkliste (Meldezettel 3 Tage, Nachsendeauftrag …). Sammlung „wohnen“ (Feld kind). Ergänzt Haushalt & Inventar.
import { collection } from "./db.js";
import * as X from "./extras-core.js";
import * as U from "./xui.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const TABS = [["orte", "🔎", "Wo liegt was?"], ["verleih", "🔁", "Verleih"], ["kosten", "💶", "Nebenkosten"], ["raeume", "📐", "Räume"], ["umzug", "📦", "Umzug"]];

export function mount(el) {
  U.loadCss("extras");
  const col = collection("wohnen");
  const S = { tab: TABS.some((t) => t[0] === U.lsGet("sk-wohnen-tab")) ? U.lsGet("sk-wohnen-tab") : "orte", q: "" };
  let alive = true;
  const of = (k) => col.all().filter((d) => d && d.kind === k);
  const put = (d, ok) => U.safe(col.put(d), ok);

  function render() {
    if (!alive) return;
    const ae = document.activeElement;
    if (ae && el.contains(ae) && ae.id === "wo-q") { const l = el.querySelector("[data-list]"); if (l) l.innerHTML = placesList(); return; }
    const due = X.lendDue(of("verleih"), U.todayKey()).length;
    el.innerHTML = `<div class="xu">${U.tabsHTML(TABS.map(([id, e, l]) => [id, e, l, id === "verleih" ? due : 0]), S.tab)}${S.tab === "verleih" ? lendHTML() : S.tab === "kosten" ? costsHTML() : S.tab === "raeume" ? roomsHTML() : S.tab === "umzug" ? moveHTML() : placesHTML()}</div>`;
  }
  function placesList() {
    const list = X.findPlace(of("ort"), S.q);
    return list.map((p) => `<li><button type="button" class="xu-item" data-ed="ort" data-id="${esc(p.id)}"><span class="xu-ie">📍</span><span class="xu-im"><b>${esc(p.what)}</b><small>${esc([p.where, p.room].filter(Boolean).join(" · "))}</small></span></button></li>`).join("") || `<li class="note">${S.q ? "Nichts gefunden 🤔" : "Noch nichts eingetragen."}</li>`;
  }
  function placesHTML() {
    return `<p class="note">Reisepass, Ersatzschlüssel, Garantiescheine, Weihnachtsdeko … Einmal eintragen, nie wieder suchen. 🔎</p>
      <div class="xu-row"><input id="wo-q" type="search" placeholder="🔍 Was suchst du?" value="${esc(S.q)}" style="flex:1;min-width:0" aria-label="Suchen"><button type="button" class="btn primary sm" data-add="ort">➕</button></div>
      <ul class="xu-list" data-list>${placesList()}</ul>`;
  }
  function lendHTML() {
    const today = U.todayKey(), list = of("verleih").map(X.normLend).filter((l) => l.id).sort((a, b) => Number(!!a.back) - Number(!!b.back) || (a.due || "9").localeCompare(b.due || "9"));
    return `<div class="xu-row"><button type="button" class="btn primary sm" data-add="verleih">➕ Verliehen / geliehen</button></div>
      ${list.length ? `<ul class="xu-list">${list.map((l) => { const late = !l.back && l.due && l.due < today;
        return `<li><button type="button" class="xu-item${l.back ? " done" : late ? " warn" : ""}" data-ed="verleih" data-id="${esc(l.id)}"><span class="xu-ie">${l.dir === "an" ? "📤" : "📥"}</span><span class="xu-im"><b>${esc(l.what)}</b><small>${l.dir === "an" ? "an" : "von"} ${esc(l.who)}${l.since ? " · seit " + X.fmtDay(l.since) : ""}${l.back ? " · ✅ zurück" : l.due ? ` · ${late ? "⚠️ überfällig seit" : "zurück bis"} ${X.fmtDay(l.due)}` : ""}</small></span></button></li>`; }).join("")}</ul>`
        : U.empty("🔁", "Wem hast du was geborgt?", "Bohrmaschine an den Nachbarn, Buch von der Kollegin … Mit Rückgabedatum erinnert dich die App.")}`;
  }
  function costsHTML() {
    const sum = X.costSummary(of("kosten"));
    return `${sum.items.length ? `<div class="xu-kpis"><span><small>pro Monat</small><b>${X.eur(sum.monthly)}</b></span><span><small>pro Jahr</small><b>${X.eur(sum.yearly)}</b></span></div>` : ""}
      <div class="xu-row"><button type="button" class="btn primary sm" data-add="kosten">➕ Kostenpunkt</button></div>
      ${sum.items.length ? `<ul class="xu-list">${sum.items.map((c) => { const u = X.usage(c.meter), last = u[u.length - 1];
        return `<li><button type="button" class="xu-item" data-ed="kosten" data-id="${esc(c.id)}"><span class="xu-ie">${(X.COST_PRESETS.find((p) => p[0] === c.name) || [0, "💶"])[1]}</span><span class="xu-im"><b>${esc(c.name)}</b><small>${X.eur(c.amount)}${c.every > 1 ? ` alle ${c.every} Monate (${X.eur(X.monthly(c))}/Monat)` : " monatlich"}${last && last.perDay != null ? ` · ⚡ ${String(last.perDay).replace(".", ",")} ${esc(c.unit)}/Tag` : ""}</small></span></button>${c.unit ? `<button type="button" class="chip sm" data-meter="${esc(c.id)}">🔢 Zählerstand</button>` : ""}</li>`; }).join("")}</ul>`
        : `<p class="note">Miete, Strom, Internet, Haushaltsversicherung … Schnell anlegen:</p><div class="chips">${X.COST_PRESETS.map(([n, e]) => `<button type="button" class="chip sm" data-preset="${esc(n)}">${e} ${esc(n)}</button>`).join("")}</div>`}
      <p class="note">💡 Mit Einheit (z. B. „kWh“ bei Strom) kannst du Zählerstände eintragen – die App rechnet den Tagesverbrauch aus.</p>`;
  }
  function roomsHTML() {
    const rooms = of("raum").map(X.normRoom).filter((r) => r.id), total = rooms.reduce((n, r) => n + r.m2, 0);
    const placesBy = (n) => of("ort").map(X.normPlace).filter((p) => p.room === n).length;
    return `${rooms.length ? `<div class="xu-kpis"><span><small>Wohnfläche</small><b>${String(Math.round(total * 10) / 10).replace(".", ",")} m²</b></span><span><small>Räume</small><b>${rooms.length}</b></span></div>` : ""}
      <div class="xu-row"><button type="button" class="btn primary sm" data-add="raum">➕ Raum</button></div>
      ${rooms.length ? `<ul class="xu-list">${rooms.map((r) => `<li><button type="button" class="xu-item" data-ed="raum" data-id="${esc(r.id)}"><span class="xu-ie">🚪</span><span class="xu-im"><b>${esc(r.name)}</b><small>${r.m2 ? String(r.m2).replace(".", ",") + " m²" : ""}${placesBy(r.name) ? ` · ${placesBy(r.name)} Dinge verortet` : ""}${r.note ? " · " + esc(r.note) : ""}</small></span></button></li>`).join("")}</ul>`
        : U.empty("📐", "Deine Räume", "Raumgrößen (z. B. für Bodenbelag oder Farbe), Maße fürs Möbelkaufen und Notizen je Zimmer.")}`;
  }
  function moveHTML() {
    const doc = col.get("umzug") || { id: "umzug", kind: "umzug" }, today = U.todayKey();
    if (!X.isKey(doc.date)) return `${U.empty("📦", "Umzug geplant?", "Gib den Umzugstag ein – du bekommst eine Checkliste mit allem, was in Österreich zu tun ist (Kündigung, Nachsendeauftrag, Meldezettel innerhalb von 3 Tagen …).")}<div class="xu-row" style="justify-content:center"><input id="mv-date" type="date" aria-label="Umzugstag"><button type="button" class="btn primary sm" data-x="movestart">Los geht's</button></div>`;
    const st = X.moveSteps(doc, today), done = st.filter((x) => x.done).length, days = X.diffDays(today, doc.date);
    return `<section class="card"><div class="xu-row"><h3>📦 Umzug am ${X.fmtDay(doc.date)}</h3><span class="xu-sp"></span><small>${days > 0 ? `noch ${days} Tage` : days === 0 ? "heute! 💪" : "geschafft 🏡"}</small></div><span class="xu-bar"><i style="width:${Math.round((done / st.length) * 100)}%"></i></span><small class="note">${done} von ${st.length} erledigt</small></section>
      <ul class="xu-check">${st.map((x) => `<li class="${x.done ? "done" : x.late ? "late" : ""}"><label><input type="checkbox" data-step="${esc(x.id)}"${x.done ? " checked" : ""}><span>${x.e} ${esc(x.text)}<small>${x.date ? X.fmtDay(x.date) : ""}${x.late ? " · ⚠️ überfällig" : ""}</small></span></label></li>`).join("")}</ul>
      <div class="xu-row"><button type="button" class="btn ghost sm" data-x="moveown">➕ Eigener Punkt</button><button type="button" class="btn ghost sm" data-x="movedate">📅 Datum ändern</button><button type="button" class="btn ghost sm" data-x="moveend">Umzug abschließen</button></div>`;
  }

  function edit(kind, id, preset) {
    const raw = id ? col.get(id) : null, isNew = !raw, today = U.todayKey();
    const del = isNew ? null : () => U.safe(col.remove(id), "Gelöscht");
    if (kind === "ort") { const p = X.normPlace(raw || { what: S.q }); const rooms = of("raum").map(X.normRoom).filter((r) => r.name);
      return U.form({ title: isNew ? "📍 Wo liegt …?" : "Bearbeiten", fields: [{ id: "what", label: "Was?", value: p.what, placeholder: "z. B. Reisepass" }, { id: "where", label: "Wo genau?", value: p.where, placeholder: "z. B. Schreibtisch, 2. Lade links" },
        rooms.length ? { id: "room", label: "Raum", type: "select", value: p.room, options: [["", "–"], ...rooms.map((r) => [r.name, r.name])] } : { id: "room", label: "Raum (optional)", value: p.room, max: 40 }, { id: "note", label: "Notiz", value: p.note, max: 200 }],
        onSave: (v) => { if (!v.what || !v.where) { ui.toast("Bitte „Was“ und „Wo“ eintragen."); return false; } put({ ...p, ...v, kind: "ort", id: p.id || undefined, updated: Date.now() }, "📍 Gemerkt!"); }, onDelete: del }); }
    if (kind === "verleih") { const l = X.normLend(raw || { since: today, dir: "an" });
      return U.form({ title: isNew ? "🔁 Verleih" : "Bearbeiten", fields: [{ id: "dir", label: "Richtung", type: "select", value: l.dir, options: [["an", "📤 Ich habe verliehen an …"], ["von", "📥 Ich habe geliehen von …"]] }, { id: "what", label: "Was?", value: l.what }, { id: "who", label: "Wer?", value: l.who },
        { type: "row", fields: [{ id: "since", label: "Seit", type: "date", value: l.since }, { id: "due", label: "Zurück bis", type: "date", value: l.due }] }, ...(isNew ? [] : [{ id: "back", label: "Zurückgegeben am", type: "date", value: l.back }]), { id: "note", label: "Notiz", value: l.note, max: 200 }],
        onSave: (v) => { if (!v.what || !v.who) return false; put({ ...l, ...v, kind: "verleih", id: l.id || undefined }, v.back ? "✅ Zurück!" : "🔁 Eingetragen"); }, onDelete: del }); }
    if (kind === "kosten") { const c = X.normCost(raw || { name: preset || "", unit: /strom/i.test(preset || "") ? "kWh" : /gas/i.test(preset || "") ? "m³" : /wasser/i.test(preset || "") ? "m³" : "" });
      return U.form({ title: isNew ? "💶 Kostenpunkt" : c.name, fields: [{ id: "name", label: "Bezeichnung", value: c.name }, { type: "row", fields: [{ id: "amount", label: "Betrag €", type: "number", value: c.amount || "" }, { id: "every", label: "Wie oft?", type: "select", value: c.every, options: [[1, "monatlich"], [2, "alle 2 Monate"], [3, "vierteljährlich"], [6, "halbjährlich"], [12, "jährlich"]] }] },
        { id: "unit", label: "Zähler-Einheit (optional, z. B. kWh, m³)", value: c.unit, max: 10 }, ...(c.meter.length ? [{ type: "html", html: `<p class="note">Zählerstände: ${c.meter.slice(-5).map((m) => `${X.fmtDay(m.date)}: ${String(m.value).replace(".", ",")}`).join(" · ")}</p>` }] : [])],
        onSave: (v) => { if (!v.name) return false; put({ ...c, kind: "kosten", id: c.id || undefined, name: v.name, amount: Number(String(v.amount).replace(",", ".")) || 0, every: Number(v.every), unit: v.unit }, "💶 Gespeichert"); }, onDelete: del }); }
    if (kind === "raum") { const r = X.normRoom(raw || {});
      return U.form({ title: isNew ? "📐 Neuer Raum" : r.name, fields: [{ type: "row", fields: [{ id: "name", label: "Raum", value: r.name, placeholder: "z. B. Wohnzimmer" }, { id: "m2", label: "Fläche m²", type: "number", value: r.m2 || "" }] }, { id: "note", label: "Maße & Notizen", type: "textarea", value: r.note, placeholder: "z. B. Nische 1,20 m breit, Wandfarbe RAL 9010" }],
        onSave: (v) => { if (!v.name) return false; put({ ...r, kind: "raum", id: r.id || undefined, name: v.name, m2: Number(String(v.m2).replace(",", ".")) || 0, note: v.note }, "📐 Gespeichert"); }, onDelete: del }); }
  }

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b || !el.contains(b)) return;
    const d = b.dataset;
    if (d.tab) { S.tab = d.tab; U.lsSet("sk-wohnen-tab", S.tab); render(); return; }
    if (d.add) { edit(d.add, null); return; }
    if (d.ed) { edit(d.ed, d.id); return; }
    if (d.preset) { edit("kosten", null, d.preset); return; }
    if (d.meter) { const c = X.normCost(col.get(d.meter) || {}); U.form({ title: `🔢 ${c.name}`, fields: [{ type: "row", fields: [{ id: "date", label: "Datum", type: "date", value: U.todayKey() }, { id: "value", label: `Stand (${c.unit})`, type: "number" }] }],
      onSave: (v) => { const n = Number(String(v.value).replace(",", ".")); if (!Number.isFinite(n) || !v.date) return false; put({ ...c, meter: [...c.meter.filter((m) => m.date !== v.date), { date: v.date, value: n }] }, "🔢 Eingetragen"); } }); return; }
    const mv = col.get("umzug") || { id: "umzug", kind: "umzug" };
    if (d.x === "movestart") { const v = el.querySelector("#mv-date").value; if (!v) { ui.toast("Bitte den Umzugstag wählen."); return; } put({ ...mv, kind: "umzug", date: v, done: {}, own: [] }, "📦 Checkliste erstellt"); }
    else if (d.x === "movedate") U.form({ title: "📅 Umzugstag", fields: [{ id: "date", label: "Datum", type: "date", value: mv.date }], onSave: (v) => { if (!v.date) return false; put({ ...mv, date: v.date }); } });
    else if (d.x === "moveown") U.form({ title: "➕ Eigener Punkt", fields: [{ id: "text", label: "Was?", placeholder: "z. B. Katze zur Oma bringen" }, { id: "days", label: "Tage vor (−) / nach (+) dem Umzug", type: "number", value: "-1" }],
      onSave: (v) => { if (!v.text) return false; put({ ...mv, own: [...(mv.own || []), { id: "o" + U.nid(), text: v.text, days: Number(v.days) || 0 }] }); } });
    else if (d.x === "moveend") U.form({ title: "🏡 Umzug abschließen?", fields: [{ type: "html", html: `<p>Die Umzugs-Checkliste wird gelöscht.</p>` }], saveLabel: "Ja, abschließen", onSave: () => { U.safe(col.remove("umzug"), "🏡 Willkommen im neuen Zuhause!"); } });
  });
  el.addEventListener("change", (ev) => { const s = ev.target.closest("[data-step]"); if (!s) return; const mv = col.get("umzug"); if (mv) put({ ...mv, done: { ...(mv.done || {}), [s.dataset.step]: s.checked } }); });
  el.addEventListener("input", (ev) => { if (ev.target.id === "wo-q") { S.q = ev.target.value; render(); } });
  const off = col.watch(() => queueMicrotask(render));
  render();
  return () => { alive = false; off(); };
}
