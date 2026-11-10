// Update 12 – Alltag › 🐾 Haustiere (#alltag/tiere): Profile mit Foto, Fütterungsplan, Pflege-Erinnerungen, Tierarzt,
// Impfungen, Medikamente, Gewicht, Kosten und Notizen. Fälliges erscheint in den Mitteilungen. Sammlung „tiere“.
import { collection } from "./db.js";
import * as X from "./extras-core.js";
import * as U from "./xui.js";
import { esc } from "../util.js";

export function mount(el) {
  U.loadCss("extras");
  const col = collection("tiere");
  let sel = U.lsGet("sk-tiere-sel") || "", alive = true;
  const pets = () => col.all().map(X.normPet).filter((p) => p.id && p.name);
  const put = (p, ok) => U.safe(col.put(p), ok);

  function render() {
    if (!alive) return;
    const list = pets(), today = U.todayKey();
    if (!col.loaded && !list.length) { el.innerHTML = `<p class="note">Lade …</p>`; return; }
    if (!list.length) { el.innerHTML = `<div class="xu">${U.empty("🐾", "Deine Tiere", "Leg ein Profil an – Fütterung, Pflege, Tierarzt, Impfungen und Medikamente an einem Ort. Die App erinnert dich rechtzeitig.")}<div class="xu-row" style="justify-content:center"><button type="button" class="btn primary sm" data-x="new">➕ Tier hinzufügen</button></div></div>`; return; }
    if (!list.some((p) => p.id === sel)) sel = list[0].id;
    const p = list.find((x) => x.id === sel);
    const due = X.petDue([p], today), c = X.petCosts(p, Number(today.slice(0, 4)));
    const w = p.weight.slice(-20), maxW = Math.max(...w.map((x) => x.kg), 1), minW = Math.min(...w.map((x) => x.kg), maxW);
    el.innerHTML = `<div class="xu">
      ${`<div class="xu-tabs">${list.map((x) => `<button type="button" class="xu-tab${x.id === sel ? " on" : ""}" data-sel="${esc(x.id)}">${esc(x.emoji)} ${esc(x.name)}</button>`).join("")}<button type="button" class="xu-tab" data-x="new" aria-label="Tier hinzufügen">➕</button></div>`}
      <section class="card xu-hero">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<span class="xu-ph" aria-hidden="true">${esc(p.emoji)}</span>`}
        <div><h2>${esc(p.name)}</h2><small>${[X.PET_KINDS.find((k) => k[0] === p.art)[2], X.ageText(p.birthday, today), p.chip && "Chip " + p.chip].filter(Boolean).map(esc).join(" · ")}</small>
        <div class="xu-row"><button type="button" class="chip sm" data-x="edit">✏️ Profil</button><button type="button" class="chip sm" data-x="photo">📷 Foto</button></div></div></section>
      ${due.length ? `<section class="card"><h3>📌 Jetzt dran</h3><ul class="xu-check">${due.map((d) => `<li class="${d.days < 0 ? "late" : ""}"><span>${{ pflege: "🧽", impfung: "💉", medikament: "💊", tierarzt: "🩺" }[d.kind]}</span><span style="flex:1">${esc(d.text)}<small>${d.days < 0 ? `seit ${-d.days} Tagen fällig` : d.days === 0 ? "heute" : `in ${d.days} Tagen (${X.fmtDay(d.date)})`}</small></span>${d.kind === "pflege" ? `<button type="button" class="btn ghost sm" data-caredone="${esc(d.id)}">✅ Erledigt</button>` : ""}</li>`).join("")}</ul></section>` : `<p class="note">✨ Gerade steht nichts an.</p>`}
      <section class="card"><div class="xu-row"><h3>🍖 Füttern</h3><span class="xu-sp"></span><button type="button" class="chip sm" data-x="food">✏️</button></div>
        ${p.food.what || p.food.times.length ? `<p>${esc(p.food.what || "Futter")}${p.food.amount ? ` · ${esc(p.food.amount)}` : ""}</p>${p.food.times.length ? `<div class="chips">${p.food.times.map((t) => `<span class="chip sm">⏰ ${t}</span>`).join("")}</div>` : ""}` : `<p class="note">Was, wie viel und wann? Trag den Fütterungsplan ein.</p>`}</section>
      ${sec("🧽 Pflege", "care", p.care.map((x) => [x.id, `${x.title}`, `alle ${x.every} Tage · nächstes Mal ${X.fmtDay(X.careNext(x, today))}`]))}
      ${sec("💉 Impfungen & Dokumente", "vacc", p.vacc.map((x) => [x.id, x.name, [x.date && "zuletzt " + X.fmtDay(x.date), x.next && "nächste " + X.fmtDay(x.next)].filter(Boolean).join(" · ")]), "📁 Impfpass & Befunde kannst du verschlüsselt unter Dokumente ablegen.")}
      ${sec("💊 Medikamente", "meds", p.meds.map((x) => [x.id, `${x.name}${x.dose ? " · " + x.dose : ""}`, [x.times.join(", "), x.from && "ab " + X.fmtDay(x.from), x.until && "bis " + X.fmtDay(x.until)].filter(Boolean).join(" · ")]))}
      ${sec("🩺 Tierarzt", "vet", [...p.vet].reverse().map((x) => [x.id, x.reason || "Besuch", [X.fmtDay(x.date), x.cost && X.eur(x.cost)].filter(Boolean).join(" · ")]))}
      <section class="card"><div class="xu-row"><h3>⚖️ Gewicht</h3><span class="xu-sp"></span><button type="button" class="chip sm" data-add="weight">➕</button></div>
        ${w.length ? `<p>Zuletzt <b>${String(w[w.length - 1].kg).replace(".", ",")} kg</b> am ${X.fmtDay(w[w.length - 1].date)}</p>${w.length > 1 ? `<div class="xu-spark" aria-hidden="true">${w.map((x) => `<i style="height:${20 + ((x.kg - minW) / (maxW - minW || 1)) * 80}%"></i>`).join("")}</div>` : ""}` : `<p class="note">Nur falls du es brauchst (z. B. Tierarzt-Empfehlung).</p>`}</section>
      ${sec("💶 Kosten", "costs", [...p.costs].reverse().slice(0, 10).map((x) => [x.id, x.what || "Ausgabe", `${X.fmtDay(x.date)} · ${X.eur(x.amount)}`]), `Dieses Jahr: <b>${X.eur(c.total)}</b> (Tierarzt ${X.eur(c.vet)} · Sonstiges ${X.eur(c.other)})`)}
      <section class="card"><div class="xu-row"><h3>📝 Notizen</h3><span class="xu-sp"></span><button type="button" class="chip sm" data-x="notes">✏️</button></div>${p.notes ? `<p style="white-space:pre-line">${esc(p.notes)}</p>` : `<p class="note">Vorlieben, Macken, Tierarzt-Telefonnummer …</p>`}</section>
    </div>`;
  }
  function sec(title, key, rows, foot = "") {
    return `<section class="card"><div class="xu-row"><h3>${title}</h3><span class="xu-sp"></span><button type="button" class="chip sm" data-add="${key}">➕</button></div>
      ${rows.length ? `<ul class="xu-list">${rows.map(([id, t, sub]) => `<li><button type="button" class="xu-item" data-ed="${key}" data-id="${esc(id)}"><span class="xu-im"><b>${esc(t)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span></button></li>`).join("")}</ul>` : `<p class="note">Noch nichts eingetragen.</p>`}${foot ? `<p class="note">${foot}</p>` : ""}</section>`;
  }

  const cur = () => pets().find((p) => p.id === sel);
  const times = (v) => String(v || "").split(/[,\s]+/).map((t) => t.replace(/^(\d):/, "0$1:")).filter((t) => /^\d{2}:\d{2}$/.test(t));
  function profile(p) {
    const isNew = !p; const x = X.normPet(p || { art: "hund" });
    U.form({ title: isNew ? "🐾 Neues Tier" : "Profil bearbeiten", fields: [
      { id: "name", label: "Name", value: x.name, max: 40 }, { id: "art", label: "Tierart", type: "select", value: x.art, options: X.PET_KINDS.map(([k, e, l]) => [k, `${e} ${l}`]) },
      { type: "row", fields: [{ id: "birthday", label: "Geburtstag", type: "date", value: x.birthday }, { id: "chip", label: "Chipnummer", value: x.chip, max: 30 }] },
    ], onSave: async (v) => {
      if (!v.name) return false;
      const doc = X.normPet({ ...x, ...v, emoji: "" });
      if (isNew) doc.care = (X.CARE_PRESETS[doc.art] || []).map(([title, every]) => ({ id: U.nid(), title, every, last: "" }));
      const id = await U.safe(col.put({ ...doc, id: doc.id || undefined }), isNew ? `${doc.emoji} ${doc.name} ist dabei!` : "Gespeichert ✓");
      if (isNew && typeof id === "string") { sel = id; U.lsSet("sk-tiere-sel", id); }
    }, onDelete: isNew ? null : () => U.safe(col.remove(x.id), "Gelöscht") });
  }
  function editSub(key, id) {
    const p = cur(); if (!p) return;
    const list = p[key], it = id ? list.find((y) => y.id === id) : null, today = U.todayKey();
    const done = (patch, ok) => { const n = { ...it, ...patch, id: it ? it.id : U.nid() }; put({ ...p, [key]: it ? list.map((y) => (y.id === it.id ? n : y)) : [...list, n] }, ok); };
    const del = it ? () => put({ ...p, [key]: list.filter((y) => y.id !== it.id) }, "Gelöscht") : null;
    const F = {
      care: [[{ id: "title", label: "Was?", value: it?.title, placeholder: "z. B. Krallen schneiden" }, { type: "row", fields: [{ id: "every", label: "Alle wie viele Tage?", type: "number", value: it?.every || 30 }, { id: "last", label: "Zuletzt gemacht", type: "date", value: it?.last || "" }] }], (v) => v.title && done({ title: v.title, every: Number(v.every) || 30, last: v.last })],
      vacc: [[{ id: "name", label: "Impfung / Dokument", value: it?.name, placeholder: "z. B. Tollwut, EU-Heimtierausweis" }, { type: "row", fields: [{ id: "date", label: "Zuletzt", type: "date", value: it?.date || "" }, { id: "next", label: "Nächste fällig", type: "date", value: it?.next || "" }] }], (v) => v.name && done(v)],
      meds: [[{ id: "name", label: "Medikament", value: it?.name }, { id: "dose", label: "Dosis", value: it?.dose, placeholder: "z. B. ½ Tablette" }, { id: "times", label: "Uhrzeiten (mit Komma)", value: (it?.times || []).join(", "), placeholder: "08:00, 20:00" },
        { type: "row", fields: [{ id: "from", label: "Ab", type: "date", value: it?.from || today }, { id: "until", label: "Bis", type: "date", value: it?.until || "" }] }], (v) => v.name && done({ ...v, times: times(v.times) })],
      vet: [[{ type: "row", fields: [{ id: "date", label: "Datum", type: "date", value: it?.date || today }, { id: "cost", label: "Kosten €", type: "number", value: it?.cost || "" }] }, { id: "reason", label: "Grund", value: it?.reason, placeholder: "z. B. Jahres-Check" }, { id: "note", label: "Notiz / Befund", type: "textarea", value: it?.note }], (v) => v.date && done({ ...v, cost: Number(String(v.cost).replace(",", ".")) || 0 })],
      weight: [[{ type: "row", fields: [{ id: "date", label: "Datum", type: "date", value: today }, { id: "kg", label: "Gewicht (kg)", type: "number" }] }], (v) => { const kg = Number(String(v.kg).replace(",", ".")); if (!(kg > 0)) return false; put({ ...p, weight: [...p.weight.filter((y) => y.date !== v.date), { date: v.date, kg }] }, "⚖️ Eingetragen"); }],
      costs: [[{ type: "row", fields: [{ id: "date", label: "Datum", type: "date", value: it?.date || today }, { id: "amount", label: "Betrag €", type: "number", value: it?.amount || "" }] }, { id: "what", label: "Wofür?", value: it?.what, placeholder: "Futter, Spielzeug, Versicherung …" }], (v) => { const a = Number(String(v.amount).replace(",", ".")); if (!(a > 0)) return false; done({ ...v, amount: a }); }],
    }[key];
    U.form({ title: it ? "Bearbeiten" : "Hinzufügen", fields: F[0], onSave: (v) => { const r = F[1](v); if (r === false || r === "") return false; }, onDelete: del });
  }

  el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button"); if (!b || !el.contains(b)) return;
    const d = b.dataset, p = cur();
    if (d.sel) { sel = d.sel; U.lsSet("sk-tiere-sel", sel); render(); return; }
    if (d.add) { editSub(d.add, null); return; }
    if (d.ed) { editSub(d.ed, d.id); return; }
    if (d.caredone && p) { put({ ...p, care: p.care.map((c) => (c.id === d.caredone ? { ...c, last: U.todayKey() } : c)) }, "✅ Erledigt – brav! 🐾"); return; }
    if (d.x === "new") profile(null);
    else if (d.x === "edit" && p) profile(p);
    else if (d.x === "photo" && p) { const ph = await U.pickPhoto(); if (ph) put({ ...p, photo: ph }, "📷 Foto gespeichert"); }
    else if (d.x === "food" && p) U.form({ title: "🍖 Fütterungsplan", fields: [{ id: "what", label: "Futter", value: p.food.what, placeholder: "z. B. Trockenfutter Junior" }, { id: "amount", label: "Menge", value: p.food.amount, placeholder: "z. B. 2× 120 g" }, { id: "times", label: "Uhrzeiten (mit Komma)", value: p.food.times.join(", "), placeholder: "07:00, 18:00" }],
      onSave: (v) => { put({ ...p, food: { what: v.what, amount: v.amount, times: times(v.times) } }, "Gespeichert ✓"); } });
    else if (d.x === "notes" && p) U.form({ title: "📝 Notizen", fields: [{ id: "notes", label: "Notizen", type: "textarea", rows: 8, max: 2000, value: p.notes }], onSave: (v) => { put({ ...p, notes: v.notes }, "Gespeichert ✓"); } });
  });
  const off = col.watch(() => queueMicrotask(render));
  render();
  return () => { alive = false; off(); };
}
