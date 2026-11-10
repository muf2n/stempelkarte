// Update 12 – Alltag › 👥 Freunde & Gruppen (#alltag/gruppen): Gruppen mit Mitgliedern, gemeinsamen Terminen (Gruppenkalender,
// optional in den eigenen Planer übernehmen), Aufgabenliste mit Zuständigkeit, Kosten aufteilen (gleiche Rechenlogik wie im
// Geld-Bereich: js/alltag/money-core.js balances/settle) und freiwilliger Gruppen-Challenge. Sammlung „gruppen“.
// Die App verschickt nichts – Teilen geht nur über „Text kopieren“.
import { collection } from "./db.js";
import * as X from "./extras-core.js";
import { balances, settle } from "./money-core.js";
import * as U from "./xui.js";
import * as ui from "../ui.js";
import * as store from "../store.js";
import { esc } from "../util.js";

const TABS = [["termine", "📅", "Termine"], ["aufgaben", "✅", "Aufgaben"], ["kosten", "💶", "Kosten"], ["challenge", "🏁", "Challenge"]];

export function mount(el) {
  U.loadCss("extras");
  const col = collection("gruppen");
  const S = { sel: U.lsGet("sk-gruppen-sel") || "", tab: "termine" };
  let alive = true;
  const groups = () => col.all().map(X.normGroup).filter((g) => g.id && g.name);
  const cur = () => groups().find((g) => g.id === S.sel);
  const put = (g, ok) => U.safe(col.put(g), ok);
  const opts = (g) => [["me", "Du"], ...g.people.map((p) => [p.id, p.name])];

  function render() {
    if (!alive) return;
    const gs = groups(), today = U.todayKey();
    if (!col.loaded && !gs.length) { el.innerHTML = `<p class="note">Lade …</p>`; return; }
    if (!gs.length) { el.innerHTML = `<div class="xu">${U.empty("👥", "Freunde & Gruppen", "WG, Freundeskreis, Fußballteam, Familie: gemeinsame Termine, wer bringt was mit, wer schuldet wem wie viel – und freiwillige Challenges.")}<div class="xu-row" style="justify-content:center"><button type="button" class="btn primary sm" data-x="new">➕ Gruppe anlegen</button></div></div>`; return; }
    if (!gs.some((g) => g.id === S.sel)) S.sel = gs[0].id;
    const g = cur(), up = X.upcomingEvents(gs, today, 30);
    el.innerHTML = `<div class="xu">
      <div class="xu-tabs">${gs.map((x) => `<button type="button" class="xu-tab${x.id === S.sel ? " on" : ""}" data-sel="${esc(x.id)}">${esc(x.emoji)} ${esc(x.name)}</button>`).join("")}<button type="button" class="xu-tab" data-x="new" aria-label="Gruppe anlegen">➕</button></div>
      ${up.length ? `<section class="card"><b>🗓️ Demnächst in allen Gruppen:</b> ${up.slice(0, 3).map((e) => `${esc(e.group.emoji)} ${esc(e.title)} (${X.fmtDay(e.date).slice(0, 6)})`).join(" · ")}</section>` : ""}
      <section class="card xu-hero"><span class="xu-ph" aria-hidden="true">${esc(g.emoji)}</span><div><h2>${esc(g.name)}</h2><small>Du${g.people.length ? ", " + esc(g.people.map((p) => p.name).join(", ")) : " – noch allein 🙂"}</small>
        <div class="xu-row"><button type="button" class="chip sm" data-x="edit">✏️ Gruppe & Mitglieder</button><button type="button" class="chip sm" data-x="share">📋 Übersicht kopieren</button></div></div></section>
      ${U.tabsHTML(TABS.map(([id, e, l]) => [id, e, l, id === "aufgaben" ? g.tasks.filter((t) => !t.done && t.who === "me").length || 0 : 0]), S.tab)}
      ${S.tab === "aufgaben" ? tasksHTML(g) : S.tab === "kosten" ? costsHTML(g) : S.tab === "challenge" ? challengeHTML(g) : eventsHTML(g, today)}</div>`;
  }
  function eventsHTML(g, today) {
    const fut = g.events.filter((e) => e.date >= today), past = g.events.filter((e) => e.date < today).reverse().slice(0, 5);
    const row = (e) => `<li><button type="button" class="xu-item${e.date < today ? " done" : ""}" data-ev="${esc(e.id)}"><span class="xu-ie" style="font-size:.85rem">${X.fmtDay(e.date).slice(0, 6)}</span><span class="xu-im"><b>${esc(e.title)}</b><small>${esc([e.time, e.place, e.note].filter(Boolean).join(" · "))}</small></span></button></li>`;
    return `<div class="xu-row"><button type="button" class="btn primary sm" data-add="event">➕ Termin / Event</button></div>
      ${fut.length ? `<ul class="xu-list">${fut.map(row).join("")}</ul>` : `<p class="note">Keine geplanten Treffen. Grillabend? Spieleabend? Geburtstagsparty? 🎉</p>`}
      ${past.length ? `<h4>Vergangen</h4><ul class="xu-list">${past.map(row).join("")}</ul>` : ""}`;
  }
  function tasksHTML(g) {
    return `<form class="xu-row" data-f="task"><input id="gt-text" maxlength="100" placeholder="z. B. Getränke mitbringen" style="flex:1;min-width:0" aria-label="Neue Aufgabe"><select id="gt-who" aria-label="Wer?">${[["", "Wer?"], ...opts(g)].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select><button type="submit" class="btn primary sm" aria-label="Hinzufügen">➕</button></form>
      ${g.tasks.length ? `<ul class="xu-check">${g.tasks.map((t) => `<li class="${t.done ? "done" : ""}"><label><input type="checkbox" data-task="${esc(t.id)}"${t.done ? " checked" : ""}><span>${esc(t.text)}${t.who ? ` <small>👤 ${esc(X.personName(g, t.who))}</small>` : ""}</span></label><button type="button" class="btn ghost sm" data-deltask="${esc(t.id)}" aria-label="Löschen">✕</button></li>`).join("")}</ul>` : `<p class="note">Gemeinsame Liste: Wer kauft ein, wer putzt, wer bringt was mit?</p>`}`;
  }
  function costsHTML(g) {
    const grp = { people: [{ id: "me" }, ...g.people], expenses: g.expenses };
    const bal = balances(grp), plan = settle(grp), total = g.expenses.filter((e) => e.kind !== "pay").reduce((n, e) => n + e.amount, 0);
    return `<div class="xu-row"><button type="button" class="btn primary sm" data-add="expense"${g.people.length ? "" : " disabled"}>➕ Ausgabe</button>${plan.length ? `<button type="button" class="btn ghost sm" data-add="pay">💸 Ausgleich eintragen</button>` : ""}</div>
      ${g.people.length ? "" : `<p class="note">Füg erst Mitglieder hinzu (✏️ Gruppe & Mitglieder).</p>`}
      ${g.expenses.length ? `<div class="xu-kpis"><span><small>Gesamt</small><b>${X.eur(total)}</b></span><span><small>Dein Saldo</small><b class="${(bal.get("me") || 0) >= 0 ? "up" : "down"}">${X.eur(bal.get("me") || 0)}</b></span></div>
        <section class="card"><h3>🤝 So wird's ausgeglichen</h3>${plan.length ? `<ul class="xu-list">${plan.map((t) => `<li>${esc(X.personName(g, t.from))} → ${esc(X.personName(g, t.to))}: <b>${X.eur(t.amount)}</b></li>`).join("")}</ul>` : `<p>✅ Alles ausgeglichen!</p>`}</section>
        <ul class="xu-list">${[...g.expenses].reverse().map((e) => `<li><button type="button" class="xu-item" data-exp="${esc(e.id)}"><span class="xu-ie">${e.kind === "pay" ? "💸" : "🧾"}</span><span class="xu-im"><b>${esc(e.kind === "pay" ? `${X.personName(g, e.paidBy)} → ${X.personName(g, e.to)}` : e.what || "Ausgabe")}</b><small>${e.kind === "pay" ? "Ausgleich" : `bezahlt von ${esc(X.personName(g, e.paidBy))}${e.forIds.length ? ` · für ${esc(e.forIds.map((i) => X.personName(g, i)).join(", "))}` : " · für alle"}`}${e.date ? " · " + X.fmtDay(e.date) : ""}</small></span><b>${X.eur(e.amount)}</b></button></li>`).join("")}</ul>` : `<p class="note">Urlaub, WG-Einkauf, Geschenk für jemanden – trag ein, wer was bezahlt hat. Die App rechnet aus, wer wem wie viel schuldet.</p>`}`;
  }
  function challengeHTML(g) {
    if (!g.challenge) return `<p class="note">Eine freiwillige Challenge für die Gruppe – z. B. „100 km laufen im Monat“ oder „20 Bücherseiten pro Tag“. Ganz ohne Druck. 🏁</p><button type="button" class="btn primary sm" data-x="challenge">🏁 Challenge starten</button>`;
    const r = X.challengeRanking(g);
    return `<section class="card"><div class="xu-row"><h3>🏁 ${esc(g.challenge.title)}</h3><span class="xu-sp"></span><button type="button" class="chip sm" data-x="challenge">✏️</button></div><small class="note">Ziel: ${g.challenge.goal} ${esc(g.challenge.unit)}</small>
      <ul class="xu-list">${r.map((p, i) => `<li><div class="xu-row"><b>${["🥇", "🥈", "🥉"][i] || "🏅"} ${esc(p.name)}</b><span class="xu-sp"></span><small>${String(p.n).replace(".", ",")} ${esc(g.challenge.unit)}</small><button type="button" class="chip sm" data-prog="${esc(p.id)}" aria-label="Fortschritt für ${esc(p.name)} eintragen">➕</button></div><span class="xu-bar"><i style="width:${p.pct}%"></i></span></li>`).join("")}</ul></section>
      <button type="button" class="btn ghost sm" data-x="endchallenge">Challenge beenden</button>`;
  }

  function groupForm(g0) {
    const isNew = !g0; const g = X.normGroup(g0 || {});
    U.form({ title: isNew ? "👥 Neue Gruppe" : "Gruppe bearbeiten", fields: [
      { type: "row", fields: [{ id: "emoji", label: "Emoji", value: g.emoji, max: 4 }, { id: "name", label: "Name", value: g.name, placeholder: "z. B. WG, Fußball, Familie" }] },
      { id: "people", label: "Mitglieder (eine Person pro Zeile, du bist automatisch dabei)", type: "textarea", rows: 5, value: g.people.map((p) => p.name).join("\n") },
    ], onSave: async (v) => {
      if (!v.name) return false;
      const names = v.people.split("\n").map((x) => x.trim()).filter(Boolean);
      const people = names.map((n) => g.people.find((p) => p.name === n) || { id: U.nid(), name: n });
      const id = await put({ ...g, id: g.id || undefined, name: v.name, emoji: v.emoji, people }, isNew ? "👥 Gruppe angelegt" : "Gespeichert ✓");
      if (isNew && typeof id === "string") { S.sel = id; U.lsSet("sk-gruppen-sel", id); }
    }, onDelete: isNew ? null : () => U.safe(col.remove(g.id), "Gruppe gelöscht") });
  }
  function eventForm(g, e0) {
    const e = e0 || { date: U.todayKey(), time: "", title: "", place: "", note: "" };
    U.form({ title: e0 ? "Termin bearbeiten" : "📅 Neuer Termin", fields: [
      { id: "title", label: "Was?", value: e.title, placeholder: "z. B. Grillen bei Anna" },
      { type: "row", fields: [{ id: "date", label: "Datum", type: "date", value: e.date }, { id: "time", label: "Uhrzeit", type: "time", value: e.time }] },
      { id: "place", label: "Wo?", value: e.place }, { id: "note", label: "Notiz", type: "textarea", value: e.note },
      { id: "mine", label: "📅 Auch in meinen Planer übernehmen", type: "check", value: !e0 },
    ], onSave: async (v) => {
      if (!v.title || !v.date) return false;
      const n = { ...e, ...v, id: e.id || U.nid() }; delete n.mine;
      await put({ ...g, events: e0 ? g.events.map((x) => (x.id === e0.id ? n : x)) : [...g.events, n] }, "📅 Gespeichert");
      if (v.mine) { try { await store.saveTodo({ kind: "termin", title: `${g.emoji} ${v.title}`, date: v.date, time: v.time || null, note: [v.place, `Gruppe: ${g.name}`].filter(Boolean).join(" · "), remind: !!v.time }); ui.toast("📅 Auch im Planer eingetragen"); } catch { /* egal */ } }
    }, onDelete: e0 ? () => put({ ...g, events: g.events.filter((x) => x.id !== e0.id) }, "Gelöscht") : null });
  }
  function expenseForm(g, e0, pay = false) {
    const e = e0 || { what: "", amount: "", paidBy: "me", forIds: [], date: U.todayKey() };
    if (pay || (e0 && e0.kind === "pay")) {
      const plan = settle({ people: [{ id: "me" }, ...g.people], expenses: g.expenses })[0] || { from: "me", to: g.people[0] && g.people[0].id, amount: 0 };
      return U.form({ title: "💸 Ausgleich", fields: [{ type: "row", fields: [{ id: "paidBy", label: "Von", type: "select", value: e0 ? e0.paidBy : plan.from, options: opts(g) }, { id: "to", label: "An", type: "select", value: e0 ? e0.to : plan.to, options: opts(g) }] }, { id: "amount", label: "Betrag €", type: "number", value: e0 ? e0.amount : plan.amount }],
        onSave: (v) => { const a = Number(String(v.amount).replace(",", ".")); if (!(a > 0) || v.paidBy === v.to) return false; const n = { id: e0 ? e0.id : U.nid(), kind: "pay", paidBy: v.paidBy, to: v.to, amount: a, forIds: [], date: U.todayKey(), what: "Ausgleich" }; put({ ...g, expenses: e0 ? g.expenses.map((x) => (x.id === e0.id ? n : x)) : [...g.expenses, n] }, "💸 Eingetragen"); },
        onDelete: e0 ? () => put({ ...g, expenses: g.expenses.filter((x) => x.id !== e0.id) }, "Gelöscht") : null });
    }
    U.form({ title: e0 ? "Ausgabe bearbeiten" : "🧾 Neue Ausgabe", fields: [
      { id: "what", label: "Wofür?", value: e.what, placeholder: "z. B. Pizza, Ferienhaus" },
      { type: "row", fields: [{ id: "amount", label: "Betrag €", type: "number", value: e.amount }, { id: "paidBy", label: "Bezahlt von", type: "select", value: e.paidBy, options: opts(g) }] },
      { id: "forIds", label: "Für wen? (keine Auswahl = alle)", type: "chips", value: e.forIds, options: opts(g) }, { id: "date", label: "Datum", type: "date", value: e.date },
    ], onSave: (v) => { const a = Number(String(v.amount).replace(",", ".")); if (!(a > 0)) { ui.toast("Bitte einen Betrag."); return false; } const n = { id: e.id || U.nid(), what: v.what, amount: a, paidBy: v.paidBy, forIds: v.forIds, date: v.date }; put({ ...g, expenses: e0 ? g.expenses.map((x) => (x.id === e0.id ? n : x)) : [...g.expenses, n] }, "🧾 Gespeichert"); },
    onDelete: e0 ? () => put({ ...g, expenses: g.expenses.filter((x) => x.id !== e0.id) }, "Gelöscht") : null });
  }
  function shareText(g) {
    const today = U.todayKey(), plan = settle({ people: [{ id: "me" }, ...g.people], expenses: g.expenses });
    return [`${g.emoji} ${g.name}`, ...g.events.filter((e) => e.date >= today).slice(0, 5).map((e) => `📅 ${X.fmtDay(e.date)}${e.time ? " " + e.time : ""} – ${e.title}${e.place ? " (" + e.place + ")" : ""}`),
      ...g.tasks.filter((t) => !t.done).map((t) => `☐ ${t.text}${t.who ? " – " + X.personName(g, t.who) : ""}`), ...plan.map((t) => `💶 ${X.personName(g, t.from)} → ${X.personName(g, t.to)}: ${X.eur(t.amount)}`)].join("\n");
  }

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b || !el.contains(b)) return;
    const d = b.dataset, g = cur();
    if (d.sel) { S.sel = d.sel; U.lsSet("sk-gruppen-sel", S.sel); render(); return; }
    if (d.tab) { S.tab = d.tab; render(); return; }
    if (!g && d.x !== "new") return;
    if (d.ev) { eventForm(g, g.events.find((e) => e.id === d.ev)); return; }
    if (d.exp) { expenseForm(g, g.expenses.find((e) => e.id === d.exp)); return; }
    if (d.deltask) { put({ ...g, tasks: g.tasks.filter((t) => t.id !== d.deltask) }); return; }
    if (d.prog) { const p = d.prog; U.form({ title: "➕ Fortschritt", fields: [{ id: "n", label: `Wie viel dazu? (${g.challenge.unit || "Einheiten"})`, type: "number", value: "1" }], onSave: (v) => { const n = Number(String(v.n).replace(",", ".")); if (!n) return false; put({ ...g, challenge: { ...g.challenge, progress: { ...g.challenge.progress, [p]: Math.max(0, (g.challenge.progress[p] || 0) + n) } } }, "💪 Weiter so!"); } }); return; }
    if (d.add === "event") eventForm(g, null);
    else if (d.add === "expense") expenseForm(g, null);
    else if (d.add === "pay") expenseForm(g, null, true);
    else if (d.x === "new") groupForm(null);
    else if (d.x === "edit") groupForm(g);
    else if (d.x === "share") navigator.clipboard?.writeText(shareText(g)).then(() => ui.toast("📋 Übersicht kopiert – jetzt in die Gruppe einfügen")).catch(() => ui.toast("Kopieren nicht möglich"));
    else if (d.x === "challenge") U.form({ title: "🏁 Gruppen-Challenge", fields: [{ id: "title", label: "Challenge", value: g.challenge ? g.challenge.title : "", placeholder: "z. B. 100 km laufen im Dezember" }, { type: "row", fields: [{ id: "goal", label: "Ziel", type: "number", value: g.challenge ? g.challenge.goal : 100 }, { id: "unit", label: "Einheit", value: g.challenge ? g.challenge.unit : "km", max: 20 }] }],
      onSave: (v) => { if (!v.title) return false; put({ ...g, challenge: { title: v.title, goal: Number(v.goal) || 10, unit: v.unit, progress: g.challenge ? g.challenge.progress : {} } }, "🏁 Los geht's!"); } });
    else if (d.x === "endchallenge") put({ ...g, challenge: null }, "Challenge beendet");
  });
  el.addEventListener("change", (ev) => { const c = ev.target.closest("[data-task]"); const g = cur(); if (c && g) put({ ...g, tasks: g.tasks.map((t) => (t.id === c.dataset.task ? { ...t, done: c.checked } : t)) }); });
  el.addEventListener("submit", (ev) => {
    if (!ev.target.matches('[data-f="task"]')) return; ev.preventDefault();
    const g = cur(), t = el.querySelector("#gt-text").value.trim(); if (!g || !t) return;
    put({ ...g, tasks: [...g.tasks, { id: U.nid(), text: t, who: el.querySelector("#gt-who").value, done: false }] });
  });
  const off = col.watch(() => queueMicrotask(render));
  render();
  return () => { alive = false; off(); };
}
