// Update 10 E – Alltag › 👤 Kunden & Kontakte (#alltag/kontakte, Detail #alltag/kontakte/<id>).
// Kontakte (Kunde, Firma, Privat) mit Ansprechpartner, Telefon/E-Mail als Text + tel:/mailto:-Links (die App schickt nichts selbst),
// Adresse, Notizen, datierte Gesprächsnotizen, verknüpfte Baustellen (Orte, setzt dort optional customerId) und einfache Aufträge.
// Verlauf = Gespräche + Aufträge + Arbeitstage auf den Baustellen + Dokumente. Reine Logik: ./kontakte-core.js
import { collection, newId } from "./db.js";
import * as K from "./kontakte-core.js";
import * as A from "./akten-ui.js";
import * as store from "../store.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";
import { siteHash } from "../site-core.js";

export function mount(el) {
  A.injectCSS();
  const col = collection("kontakte");
  const S = { type: "", q: "", id: K.routeId(location.hash), tab: "verlauf" };
  let alive = true, queued = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };

  el.innerHTML = `<div class="ak kt">
      <div class="ak-home">
        <div class="ak-top">
          <label class="ak-search"><span class="sr">Kontakte suchen</span><input id="kt-q" type="search" placeholder="🔎 Name, Firma, Telefon, Auftrag …" autocomplete="off" enterkeyhint="search"></label>
          <div class="ak-acts"><button type="button" class="btn primary sm" data-kt="new">${icon("plus", 16)}<span>Kontakt</span></button></div>
        </div>
        <div class="ak-chips kt-types" role="group" aria-label="Art"></div>
        <div class="ak-list-wrap"></div>
      </div>
      <div class="ak-detail-wrap" hidden></div>
    </div>`;
  const home = el.querySelector(".ak-home");
  const detailEl = el.querySelector(".ak-detail-wrap");
  const listEl = el.querySelector(".ak-list-wrap");
  const typesEl = el.querySelector(".kt-types");
  const qIn = el.querySelector("#kt-q");
  const all = () => col.all().map(K.normContact).filter((c) => c.id);
  const byId = (id) => { const x = col.get(id); return x ? K.normContact(x) : null; };
  const placeName = (id) => { const p = A.places().find((x) => x.id === id); return p ? p.name || "Ort" : "Baustelle (gelöscht)"; };

  function renderHome() {
    const list = all();
    typesEl.innerHTML = list.length ? `<button type="button" class="chip" data-type="" aria-pressed="${!S.type}">Alle <span class="ak-cn">${list.length}</span></button>` +
      K.TYPES.map((t) => { const n = list.filter((c) => c.type === t.id).length; return `<button type="button" class="chip" data-type="${t.id}" aria-pressed="${S.type === t.id}">${t.e} ${esc(t.label)}${n ? ` <span class="ak-cn">${n}</span>` : ""}</button>`; }).join("") : "";
    if (!list.length) {
      listEl.innerHTML = col.loaded ? A.emptyHTML("👤", "Noch keine Kontakte", "Kunden, Firmen, Lieferanten oder Nachbarn – mit Ansprechpartner, Telefon, Baustellen und Gesprächsnotizen. So weißt du beim nächsten Anruf gleich, was ausgemacht war. 📞", "＋ Ersten Kontakt", "new") : `<p class="note">Lade …</p>`;
      return;
    }
    const shown = K.filterContacts(list, { q: S.q, type: S.type });
    listEl.innerHTML = shown.length ? `<ul class="ak-list">${shown.map((c) => {
      const open = K.openJobs(c).length;
      return `<li><button type="button" class="ak-card" data-kt="open" data-id="${esc(c.id)}">` +
        `<span class="ak-thumb"><span class="ak-emo kt-ini" aria-hidden="true">${esc(K.typeById(c.type).e)}</span></span>` +
        `<span class="ak-ct"><b>${esc(K.displayName(c))}</b><small>${esc([c.company && c.company !== c.name ? c.company : "", c.person, c.phone].filter(Boolean).join(" · ") || K.typeById(c.type).label)}</small>` +
        `<span class="ak-badges">${c.placeIds.length ? `<span class="ak-b ak-b-info">🏗️ ${c.placeIds.length}</span>` : ""}${open ? `<span class="ak-b ak-b-bald">🔨 ${open} ${open === 1 ? "Auftrag offen" : "Aufträge offen"}</span>` : ""}</span></span>` +
        `<span class="ak-go" aria-hidden="true">${icon("chevron-right", 18)}</span></button></li>`;
    }).join("")}</ul>` : `<div class="empty ak-empty"><p>Nichts gefunden für „${esc(S.q)}“ 🤔</p></div>`;
  }

  function renderDetail(c) {
    const tel = K.telHref(c.phone), mail = K.mailHref(c.email);
    const sn = A.snap();
    const docs = A.linkedDocs("kontakt", c.id) || []; // Update 10 – 🔒 nur entsperrt
    const hist = K.history(c, { entries: sn.entries || [], places: A.places(), docs });
    const tabs = [["verlauf", "📜 Verlauf"], ["gespraeche", `📞 Gespräche (${c.calls.length})`], ["auftraege", `🔨 Aufträge (${c.jobs.length})`]];
    detailEl.innerHTML = `<div class="ak-det">
      <div class="ak-det-bar"><button type="button" class="btn ghost sm" data-kt="back">${icon("chevron-left", 18)}<span>Kontakte</span></button></div>
      <section class="ak-hero">
        <div class="ak-hero-emo" aria-hidden="true">${K.typeById(c.type).e}</div>
        <div class="ak-hero-t"><h2>${esc(K.displayName(c))}</h2><p class="note">${esc([K.typeById(c.type).label, c.company && c.company !== c.name ? c.company : "", c.person ? "Ansprechpartner: " + c.person : ""].filter(Boolean).join(" · "))}</p></div>
        <div class="ak-hero-acts">
          ${tel ? `<a class="btn primary sm" href="${esc(tel)}">📞 <span>Anrufen</span></a>` : ""}
          ${mail ? `<a class="btn ghost sm" href="${esc(mail)}">✉️ <span>E-Mail</span></a>` : ""}
          <button type="button" class="btn ghost sm" data-kt="call">📝 <span>Gesprächsnotiz</span></button>
          <button type="button" class="btn ghost sm" data-kt="edit">${icon("pencil", 16)}<span>Bearbeiten</span></button>
        </div>
      </section>
      <section class="ak-card-s"><h3>📇 Kontakt</h3><dl class="ak-dl">
        ${c.phone ? `<dt>📞 Telefon</dt><dd>${tel ? `<a href="${esc(tel)}">${esc(c.phone)}</a>` : esc(c.phone)}</dd>` : ""}
        ${c.email ? `<dt>✉️ E-Mail</dt><dd>${mail ? `<a href="${esc(mail)}">${esc(c.email)}</a>` : esc(c.email)}</dd>` : ""}
        ${c.address ? `<dt>📍 Adresse</dt><dd class="ak-pre">${esc(c.address)}</dd>` : ""}
        ${!c.phone && !c.email && !c.address ? `<dt>ℹ️</dt><dd class="note">Noch keine Kontaktdaten – über „Bearbeiten“ ergänzen.</dd>` : ""}
      </dl>${c.notes ? `<p class="ak-pre kt-notes">${esc(c.notes)}</p>` : ""}</section>
      <section class="ak-card-s"><header class="ak-linked-h"><h3>🏗️ Baustellen</h3><button type="button" class="btn ghost sm" data-kt="addplace">＋ Verknüpfen</button></header>
        ${c.placeIds.length ? `<div class="ak-chiprow">${c.placeIds.map((pid) => `<span class="kt-pl"><a class="chip" href="${esc(siteHash(pid))}">🏗️ ${esc(placeName(pid))}</a><button type="button" class="ak-x" data-kt="rmplace" data-id="${esc(pid)}" aria-label="Verknüpfung lösen">✕</button></span>`).join("")}</div>` : `<p class="note">Noch keine Baustelle verknüpft.</p>`}
      </section>
      <div class="ak-tabs" role="tablist">${tabs.map(([id, l]) => `<button type="button" role="tab" class="ak-vt" data-tab="${id}" aria-selected="${S.tab === id}">${esc(l)}</button>`).join("")}</div>
      <section class="ak-card-s kt-tab">${tabHTML(c, hist)}</section>
      ${A.linkedDocsHTML("kontakt", c.id)}
      <div class="ak-det-foot"><button type="button" class="btn danger sm" data-kt="del">Kontakt löschen</button></div>
    </div>`;
    ui.confirmButton(detailEl.querySelector('[data-kt="del"]'), "Wirklich löschen?", async () => {
      await clearCustomerIds(c.id, []);
      await A.safe(col.remove(c.id), "Kontakt gelöscht 🗑️");
      A.go("#alltag/kontakte");
    });
  }

  function tabHTML(c, hist) {
    if (S.tab === "gespraeche") {
      const list = c.calls.slice().reverse();
      return list.length ? `<ul class="kt-calls">${list.map((n) => `<li><span class="kt-date">${esc(A.fmtKey(n.date) || "–")}</span><p class="ak-pre">${esc(n.text)}</p><button type="button" class="ak-x" data-kt="rmcall" data-id="${esc(n.id)}" aria-label="Notiz löschen">✕</button></li>`).join("")}</ul>`
        : `<p class="note">Noch keine Gesprächsnotizen. Nach dem Telefonat kurz festhalten, was ausgemacht wurde – „📝 Gesprächsnotiz“. ☎️</p>`;
    }
    if (S.tab === "auftraege") {
      return `<div class="row"><button type="button" class="btn ghost sm" data-kt="job">＋ Auftrag</button></div>` + (c.jobs.length ? `<ul class="kt-jobs">${c.jobs.slice().reverse().map((j) =>
        `<li><button type="button" class="kt-job" data-kt="editjob" data-id="${esc(j.id)}"><span>${K.jobStatusById(j.status).e}</span><span><b>${esc(j.title)}</b><small>${esc([A.fmtKey(j.date), K.jobStatusById(j.status).label, j.placeId ? placeName(j.placeId) : ""].filter(Boolean).join(" · "))}</small>${j.note ? `<small class="ak-pre">${esc(j.note)}</small>` : ""}</span></button></li>`).join("")}</ul>` : `<p class="note">Noch keine Aufträge.</p>`);
    }
    return hist.length ? `<ol class="kt-hist">${hist.slice(0, 60).map((h) => `<li><span class="kt-date">${esc(A.fmtKey(h.date) || "–")}</span><span aria-hidden="true">${h.e}</span><span>${esc(h.text.length > 160 ? h.text.slice(0, 157) + "…" : h.text)}</span></li>`).join("")}</ol>`
      : `<p class="note">Noch nichts passiert – Gespräche, Aufträge und Arbeitstage auf verknüpften Baustellen erscheinen hier. 🕰️</p>`;
  }

  /** customerId an Baustellen setzen/entfernen (optional, für die Projektseite). */
  async function setCustomerIds(cid, placeIds) {
    for (const p of A.places()) {
      if (placeIds.includes(p.id) && p.customerId !== cid) await store.savePlace({ ...p, customerId: cid }).catch((e) => console.warn(e));
    }
  }
  async function clearCustomerIds(cid, keep) {
    for (const p of A.places()) {
      if (p.customerId === cid && !keep.includes(p.id)) { const q = { ...p }; delete q.customerId; await store.savePlace(q).catch((e) => console.warn(e)); }
    }
  }

  function openForm(c0 = null) {
    const c = K.normContact(c0 || { type: S.type || "kunde" });
    const isNew = !c0;
    ui.openSheet({
      title: isNew ? "👤 Neuer Kontakt" : "✏️ Kontakt bearbeiten",
      bodyHTML: `<form class="fields ak-form" novalidate>
        <div class="ak-chiprow" role="group" aria-label="Art">${K.TYPES.map((t) => `<button type="button" class="chip" data-ty="${t.id}" aria-pressed="${c.type === t.id}">${t.e} ${esc(t.label)}</button>`).join("")}</div>
        <label>Name<input id="kt-f-name" type="text" maxlength="120" value="${esc(c.name)}" placeholder="z. B. Familie Muster oder Muster Bau GmbH" required></label>
        <div class="row2"><label>Firma<input id="kt-f-co" type="text" maxlength="120" value="${esc(c.company)}"></label>
          <label>Ansprechpartner<input id="kt-f-person" type="text" maxlength="120" value="${esc(c.person)}"></label></div>
        <div class="row2"><label>Telefon<input id="kt-f-phone" type="tel" inputmode="tel" maxlength="40" value="${esc(c.phone)}" placeholder="+43 …"></label>
          <label>E-Mail<input id="kt-f-mail" type="email" inputmode="email" maxlength="120" value="${esc(c.email)}"></label></div>
        <label>Adresse<textarea id="kt-f-addr" rows="2" maxlength="240">${esc(c.address)}</textarea></label>
        <label>Notizen<textarea id="kt-f-notes" rows="3" maxlength="4000" placeholder="z. B. lieber vormittags anrufen">${esc(c.notes)}</textarea></label>
        <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button></div>
      </form>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        let type = c.type;
        sheet.querySelectorAll("[data-ty]").forEach((b) => b.addEventListener("click", () => { type = b.dataset.ty; sheet.querySelectorAll("[data-ty]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.ty === type))); }));
        $("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const name = $("#kt-f-name").value.trim(), company = $("#kt-f-co").value.trim();
          if (!name && !company) { ui.toast("Bitte Name oder Firma eingeben."); $("#kt-f-name").focus(); return; }
          const doc = { ...(c0 || {}), id: c.id || newId(), type, name: name || company, company, person: $("#kt-f-person").value.trim(), phone: $("#kt-f-phone").value.trim(),
            email: $("#kt-f-mail").value.trim(), address: $("#kt-f-addr").value.trim(), notes: $("#kt-f-notes").value.trim(), updated: Date.now(), created: c.created || Date.now() };
          if (await A.safe(col.put(doc), isNew ? "Kontakt gespeichert 👤" : "Gespeichert ✓")) { close(); if (isNew) A.go(K.contactHash(doc.id)); }
        });
      },
    });
  }

  function openCall(c) {
    ui.openSheet({
      title: "📝 Gesprächsnotiz",
      bodyHTML: `<form class="fields ak-form" novalidate><label>Datum<input id="kt-c-date" type="date" value="${A.todayKey()}"></label>
        <label>Was wurde besprochen?<textarea id="kt-c-text" rows="5" maxlength="2000" placeholder="z. B. Termin Do 8 Uhr fix, Steckdosen im Bad zusätzlich" required></textarea></label>
        <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button></div></form>`,
      onMount(sheet, close) {
        sheet.querySelector("#kt-c-text").focus();
        sheet.querySelector("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const text = sheet.querySelector("#kt-c-text").value.trim();
          if (!text) { ui.toast("Bitte kurz notieren, worum's ging."); return; }
          const cur = byId(c.id) || c;
          const calls = [...cur.calls, { id: newId(), date: sheet.querySelector("#kt-c-date").value || A.todayKey(), text }];
          if (await A.safe(col.patch(c.id, { calls, updated: Date.now() }), "Notiert ✍️")) { close(); S.tab = "gespraeche"; queue(); }
        });
      },
    });
  }

  function openJob(c, j0 = null) {
    const j = j0 || { title: "", date: A.todayKey(), status: "offen", note: "", placeId: c.placeIds[0] || "" };
    ui.openSheet({
      title: j0 ? "✏️ Auftrag" : "🔨 Neuer Auftrag",
      bodyHTML: `<form class="fields ak-form" novalidate>
        <label>Was?<input id="kt-j-title" type="text" maxlength="140" value="${esc(j.title)}" placeholder="z. B. Zählerkasten tauschen" required></label>
        <div class="row2"><label>Datum<input id="kt-j-date" type="date" value="${esc(j.date)}"></label>
          <label>Status<select id="kt-j-st">${K.JOB_STATUS.map((s) => `<option value="${s.id}"${j.status === s.id ? " selected" : ""}>${s.e} ${esc(s.label)}</option>`).join("")}</select></label></div>
        <label>Baustelle<select id="kt-j-pl"><option value="">– keine –</option>${A.places().map((p) => `<option value="${esc(p.id)}"${j.placeId === p.id ? " selected" : ""}>${esc(p.name || "Ort")}</option>`).join("")}</select></label>
        <label>Notiz<textarea id="kt-j-note" rows="3" maxlength="1000">${esc(j.note)}</textarea></label>
        <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button>${j0 ? `<button type="button" class="btn danger sm" data-deljob>Löschen</button>` : ""}</div></form>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        const cur = () => byId(c.id) || c;
        $("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const title = $("#kt-j-title").value.trim();
          if (!title) { ui.toast("Bitte kurz beschreiben, was zu tun ist."); return; }
          const nj = { id: j0 ? j0.id : newId(), title, date: $("#kt-j-date").value || "", status: $("#kt-j-st").value, placeId: $("#kt-j-pl").value, note: $("#kt-j-note").value.trim() };
          const jobs = j0 ? cur().jobs.map((x) => (x.id === j0.id ? nj : x)) : [...cur().jobs, nj];
          const placeIds = nj.placeId && !cur().placeIds.includes(nj.placeId) ? [...cur().placeIds, nj.placeId] : cur().placeIds;
          if (await A.safe(col.patch(c.id, { jobs, placeIds, updated: Date.now() }), "Auftrag gespeichert 🔨")) {
            if (placeIds !== cur().placeIds) setCustomerIds(c.id, placeIds);
            close(); S.tab = "auftraege"; queue();
          }
        });
        const del = $("[data-deljob]");
        if (del) ui.confirmButton(del, "Wirklich?", async () => {
          if (await A.safe(col.patch(c.id, { jobs: cur().jobs.filter((x) => x.id !== j0.id), updated: Date.now() }), "Auftrag gelöscht")) close();
        });
      },
    });
  }

  function openAddPlace(c) {
    const free = A.places().filter((p) => !c.placeIds.includes(p.id));
    if (!free.length) { ui.toast(A.places().length ? "Alle Baustellen sind schon verknüpft." : "Noch keine Orte/Baustellen angelegt (Reiter „Orte“)."); return; }
    ui.openSheet({
      title: "🏗️ Baustelle verknüpfen",
      bodyHTML: `<ul class="kt-pick">${free.map((p) => `<li><button type="button" class="ak-card" data-pid="${esc(p.id)}"><span class="ak-thumb"><span class="ak-emo">🏗️</span></span><span class="ak-ct"><b>${esc(p.name || "Ort")}</b><small>${esc(p.addr || "")}</small></span></button></li>`).join("")}</ul>`,
      onMount(sheet, close) {
        sheet.addEventListener("click", async (ev) => {
          const b = ev.target.closest("[data-pid]"); if (!b) return;
          const cur = byId(c.id) || c;
          const placeIds = [...cur.placeIds, b.dataset.pid];
          if (await A.safe(col.patch(c.id, { placeIds, updated: Date.now() }), "Baustelle verknüpft 🏗️")) { setCustomerIds(c.id, [b.dataset.pid]); close(); }
        });
      },
    });
  }

  function render() {
    S.id = K.routeId(location.hash);
    const c = S.id ? byId(S.id) : null;
    if (S.id && !c) {
      home.hidden = true; detailEl.hidden = false;
      detailEl.innerHTML = col.loaded ? `<div class="empty ak-empty"><h3>🤔 Kontakt nicht gefunden</h3><a class="btn ghost sm" href="#alltag/kontakte">Zu allen Kontakten</a></div>` : `<p class="note">Lade …</p>`;
      return;
    }
    if (c) { home.hidden = true; detailEl.hidden = false; renderDetail(c); return; }
    home.hidden = false; detailEl.hidden = true; detailEl.innerHTML = "";
    renderHome();
  }
  function onClick(ev) {
    const t = ev.target.closest("[data-type]");
    if (t && el.contains(t)) { S.type = t.dataset.type; render(); return; }
    const tb = ev.target.closest("[data-tab]");
    if (tb && el.contains(tb)) { S.tab = tb.dataset.tab; render(); return; }
    const b = ev.target.closest("[data-kt], [data-ak]");
    if (!b || !el.contains(b)) return;
    const c = S.id ? byId(S.id) : null;
    switch (b.dataset.kt || b.dataset.ak) {
      case "new": openForm(); break;
      case "open": S.tab = "verlauf"; A.go(K.contactHash(b.dataset.id)); break;
      case "back": A.go("#alltag/kontakte"); break;
      case "edit": if (c) openForm(col.get(c.id)); break;
      case "call": if (c) openCall(c); break;
      case "job": if (c) openJob(c); break;
      case "editjob": if (c) { const j = c.jobs.find((x) => x.id === b.dataset.id); if (j) openJob(c, j); } break;
      case "rmcall": if (c) A.safe(col.patch(c.id, { calls: c.calls.filter((x) => x.id !== b.dataset.id), updated: Date.now() }), "Notiz gelöscht"); break;
      case "addplace": if (c) openAddPlace(c); break;
      case "rmplace": if (c) { const keep = c.placeIds.filter((x) => x !== b.dataset.id); A.safe(col.patch(c.id, { placeIds: keep, updated: Date.now() }), "Verknüpfung gelöst").then(() => clearCustomerIds(c.id, keep)); } break;
      default: break;
    }
  }
  qIn.addEventListener("input", () => { S.q = qIn.value; renderHome(); });
  el.addEventListener("click", onClick);
  const offs = [col.watch(queue), A.watchDocs(queue), store.subscribe(() => { if (S.id) queue(); })];
  const offRoute = A.onRoute((h) => { if (/^#alltag\/kontakte/.test(h)) { queue(); window.scrollTo(0, 0); } });
  render();
  return () => {
    alive = false;
    offs.forEach((o) => { if (typeof o === "function") o(); });
    offRoute();
    el.removeEventListener("click", onClick);
    el.innerHTML = "";
  };
}
