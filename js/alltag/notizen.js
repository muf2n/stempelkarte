// Update 10 – Alltag › 🧠 Notizbuch (#alltag/notizen, Notiz: #alltag/notizen/<id>): Notizen mit Titel, Markdown-light
// (sicher dargestellt), Schlagworten, Favoriten, Sammlungen, Anpinnen, Verweisen [[Titel]] mit Rückverweisen, Volltextsuche
// und Diktat (Spracherkennung des Browsers, falls vorhanden). Dazu „🤖 Was Claude sich merkt“: kurze Fakten, die du
// selbst speicherst – je Bereich freigebbar („Claude darf das lesen“). Reine Logik: ./notes-core.js
// Sammlungen „notes“ und „ai_memory“.
import { collection } from "./db.js";
import * as N from "./notes-core.js";
import * as ui from "../ui.js";
import { icon } from "../icons.js";

const esc = N.esc;
const TAB_KEY = "sk-nb-tab";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

function injectCSS() {
  if (document.getElementById("nb-css")) return;
  const l = document.createElement("link");
  l.id = "nb-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-notizen.css", import.meta.url).href;
  document.head.appendChild(l);
}
const safe = (p, ok) => Promise.resolve(p).then(() => { if (ok) ui.toast(ok); return true; })
  .catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); return false; });
const fmtTs = (ts) => { if (!ts) return ""; const d = new Date(ts); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const SR = () => (typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;

export function mount(el) {
  injectCSS();
  const notes = collection("notes");
  const mem = collection("ai_memory");
  const S = { tab: lsGet(TAB_KEY) === "memory" ? "memory" : "notes", q: "", view: "alle", tag: "", coll: "", marea: "allgemein", id: N.routeId(location.hash) || null };
  let alive = true, queued = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };

  el.innerHTML =
    `<div class="nb">
      <div class="nb-tabs" role="tablist" aria-label="Bereich">
        <button type="button" role="tab" class="nb-tab" data-tab="notes">📝 <span>Notizen</span></button>
        <button type="button" role="tab" class="nb-tab" data-tab="memory">🤖 <span>Was Claude sich merkt</span></button>
      </div>
      <div class="nb-notes">
        <div class="nb-top">
          <label class="nb-search"><span class="sr">Notizen durchsuchen</span><input id="nb-q" type="search" placeholder="🔎 In allen Notizen suchen …" autocomplete="off" enterkeyhint="search"></label>
          <button type="button" class="btn primary sm" data-nb="new">${icon("plus", 16)}<span>Notiz</span></button>
        </div>
        <div class="nb-filters"></div>
        <div class="nb-list-wrap"></div>
      </div>
      <div class="nb-detail" hidden></div>
      <div class="nb-memory" hidden></div>
    </div>`;
  const $ = (q) => el.querySelector(q);
  const notesEl = $(".nb-notes"), detailEl = $(".nb-detail"), memEl = $(".nb-memory");
  const filtersEl = $(".nb-filters"), listEl = $(".nb-list-wrap"), qIn = $("#nb-q");

  const allNotes = () => notes.all().map(N.normNote).filter((n) => n.id);
  const resolver = (list) => (t) => { const n = N.findByTitle(list, t); return n ? n.id : null; };

  function render() {
    el.querySelectorAll(".nb-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
    const showDetail = S.tab === "notes" && S.id;
    notesEl.hidden = S.tab !== "notes" || !!showDetail;
    detailEl.hidden = !showDetail;
    memEl.hidden = S.tab !== "memory";
    if (S.tab === "memory") renderMemory();
    else if (showDetail) renderDetail();
    else renderList();
  }

  /* ---------- Liste ---------- */

  function renderList() {
    const list = allNotes();
    const tags = N.tagCounts(list), colls = N.collections(list);
    const favN = list.filter((n) => n.fav).length;
    filtersEl.innerHTML = list.length ? `<div class="chips nb-chips">` +
      `<button type="button" class="chip" data-f="alle" aria-pressed="${S.view === "alle" && !S.tag && !S.coll}">Alle <small>${list.length}</small></button>` +
      (favN ? `<button type="button" class="chip" data-f="fav" aria-pressed="${S.view === "fav"}">⭐ Favoriten <small>${favN}</small></button>` : "") +
      colls.map((c) => `<button type="button" class="chip" data-coll="${esc(c.coll)}" aria-pressed="${N.fold(S.coll) === N.fold(c.coll)}">📁 ${esc(c.coll)} <small>${c.n}</small></button>`).join("") +
      tags.slice(0, 12).map((t) => `<button type="button" class="chip" data-tag="${esc(t.tag)}" aria-pressed="${N.fold(S.tag) === N.fold(t.tag)}">#${esc(t.tag)}</button>`).join("") +
      `</div>` : "";
    if (!list.length) {
      listEl.innerHTML = notes.loaded ? `<div class="empty nb-empty"><div class="nb-empty-emo">🧠</div><h3>Dein Notizbuch ist noch leer</h3>` +
        `<p>Ideen, Rezepte, Merkzettel, Wissen aus der Arbeit – alles an einem Ort. Mit [[Titel]] verknüpfst du Notizen miteinander. ✨</p>` +
        `<button type="button" class="btn primary sm" data-nb="new">＋ Erste Notiz</button></div>` : `<p class="note">Lade …</p>`;
      return;
    }
    let shown = N.filterNotes(list, { view: S.view, tag: S.tag, coll: S.coll });
    if (S.q.trim()) { const ids = new Set(shown.map((n) => n.id)); shown = N.searchNotes(list, S.q).filter((n) => ids.has(n.id)); }
    listEl.innerHTML = shown.length ? `<ul class="nb-list">${shown.map((n) =>
      `<li><a class="nb-card${n.pinned ? " is-pin" : ""}" href="${esc(N.noteHash(n.id))}" data-open="${esc(n.id)}">` +
        `<span class="nb-card-h"><b>${n.pinned ? `<span aria-label="angepinnt">📌</span> ` : ""}${esc(N.noteTitle(n))}</b>${n.fav ? `<span class="nb-fav" aria-label="Favorit">⭐</span>` : ""}</span>` +
        `<span class="nb-ex">${esc(N.excerpt(n.text, 160)) || "<i>leer</i>"}</span>` +
        `<span class="nb-meta">${n.coll ? `<span class="nb-coll">📁 ${esc(n.coll)}</span>` : ""}${n.tags.map((t) => `<span class="nb-tag">#${esc(t)}</span>`).join("")}<span class="nb-date">${esc(fmtTs(n.updated))}</span></span>` +
      `</a></li>`).join("")}</ul>`
      : `<div class="empty nb-empty"><p>${S.q ? `Nichts gefunden für „${esc(S.q)}“ 🤔` : "Keine Notizen in dieser Auswahl."}</p></div>`;
  }

  /* ---------- Detail ---------- */

  function renderDetail() {
    const list = allNotes();
    const n = list.find((x) => x.id === S.id);
    if (!n) {
      detailEl.innerHTML = notes.loaded ? `<a class="btn ghost sm nb-back" href="#alltag/notizen">${icon("chevron-left", 16)}<span>Alle Notizen</span></a><div class="empty"><p>Diese Notiz gibt's nicht mehr. 🤷</p></div>` : `<p class="note">Lade …</p>`;
      return;
    }
    const back = N.backlinks(list, n);
    detailEl.innerHTML =
      `<a class="btn ghost sm nb-back" href="#alltag/notizen">${icon("chevron-left", 16)}<span>Alle Notizen</span></a>` +
      `<article class="nb-art card">` +
        `<header class="nb-art-h"><h3>${esc(N.noteTitle(n))}</h3>` +
          `<p class="nb-meta">${n.coll ? `<span class="nb-coll">📁 ${esc(n.coll)}</span>` : ""}${n.tags.map((t) => `<button type="button" class="nb-tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}<span class="nb-date">zuletzt ${esc(fmtTs(n.updated))}</span></p></header>` +
        `<div class="nb-body">${N.render(n.text, { resolve: resolver(list) }) || `<p class="note">Noch kein Text – tipp auf „Bearbeiten“.</p>`}</div>` +
      `</article>` +
      `<div class="nb-actions">` +
        `<button type="button" class="btn primary sm" data-nb="edit">${icon("pencil", 16)}<span>Bearbeiten</span></button>` +
        `<button type="button" class="btn ghost sm" data-nb="fav" aria-pressed="${n.fav}">${n.fav ? "⭐ Favorit" : "☆ Favorit"}</button>` +
        `<button type="button" class="btn ghost sm" data-nb="pin" aria-pressed="${n.pinned}">${n.pinned ? "📌 Angepinnt" : "📌 Anpinnen"}</button>` +
        `<button type="button" class="btn danger sm" data-nb="del">Löschen</button>` +
      `</div>` +
      (back.length ? `<section class="nb-back-links card"><h4>🔗 Verweist hierher</h4><ul>${back.map((b) => `<li><a href="${esc(N.noteHash(b.id))}">${esc(N.noteTitle(b))}</a></li>`).join("")}</ul></section>` : "");
    const del = detailEl.querySelector('[data-nb="del"]');
    ui.confirmButton(del, "Wirklich löschen?", async () => { if (await safe(notes.remove(n.id), "Notiz gelöscht 🗑️")) location.hash = "alltag/notizen"; });
  }

  /* ---------- Editor ---------- */

  function openEditor(note, preTitle = "") {
    const isNew = !note;
    const n = N.normNote(note || { title: preTitle, coll: S.coll, tags: S.tag ? [S.tag] : [] });
    const colls = N.collections(allNotes());
    const canDictate = !!SR();
    let rec = null;
    ui.openSheet({
      title: isNew ? "📝 Neue Notiz" : "Notiz bearbeiten",
      bodyHTML: `<div class="fields nb-form">` +
        `<label>Titel<input id="nb-f-title" maxlength="120" placeholder="z. B. Ideen fürs Wochenende" value="${esc(n.title)}"></label>` +
        `<label>Text<textarea id="nb-f-text" rows="10" maxlength="20000" placeholder="Schreib einfach drauflos ✍️">${esc(n.text)}</textarea></label>` +
        `<div class="nb-tools">` +
          (canDictate ? `<button type="button" class="btn ghost sm" data-dict aria-pressed="false">🎤 <span>Diktieren</span></button>` : "") +
          `<details class="nb-help"><summary>✨ Formatieren</summary><p class="note">**fett** · *kursiv* · # Überschrift · - Liste · 1. Liste · - [ ] Aufgabe · [Text](https://…) · [[Titel einer Notiz]] verknüpft. Links nur mit https.</p></details>` +
        `</div>` +
        `<div class="row"><label>Schlagworte<input id="nb-f-tags" maxlength="200" placeholder="z. B. Rezept, Arbeit" value="${esc(n.tags.join(", "))}"></label>` +
        `<label>Sammlung<input id="nb-f-coll" maxlength="40" list="nb-colls" placeholder="z. B. Schule" value="${esc(n.coll)}"></label></div>` +
        `<datalist id="nb-colls">${colls.map((c) => `<option value="${esc(c.coll)}"></option>`).join("")}</datalist>` +
      `</div><div class="row"><button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const q = (s) => sheet.querySelector(s);
        const ta = q("#nb-f-text");
        const stop = () => { if (rec) { try { rec.stop(); } catch { /* egal */ } rec = null; } const b = q("[data-dict]"); if (b) { b.setAttribute("aria-pressed", "false"); b.lastChild.textContent = "Diktieren"; } };
        const db = q("[data-dict]");
        if (db) db.addEventListener("click", () => {
          if (rec) { stop(); return; }
          const Rec = SR();
          try {
            rec = new Rec();
            rec.lang = "de-AT"; rec.continuous = true; rec.interimResults = false;
            rec.onresult = (ev) => {
              if (!document.contains(ta)) { stop(); return; }
              let txt = "";
              for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) txt += ev.results[i][0].transcript;
              txt = txt.trim();
              if (!txt) return;
              const pos = ta.selectionEnd ?? ta.value.length;
              const before = ta.value.slice(0, pos), after = ta.value.slice(pos);
              const sep = before && !/\s$/.test(before) ? " " : "";
              ta.value = before + sep + txt + after;
              ta.selectionStart = ta.selectionEnd = (before + sep + txt).length;
            };
            rec.onerror = (ev) => { if (ev.error === "not-allowed") ui.toast("🎤 Kein Zugriff aufs Mikrofon – bitte in den Einstellungen erlauben."); stop(); };
            rec.onend = () => { rec = null; stop(); };
            rec.start();
            db.setAttribute("aria-pressed", "true"); db.lastChild.textContent = "Stopp";
            ui.toast("🎤 Ich hör zu …");
          } catch (err) { console.warn(err); rec = null; ui.toast("Diktieren geht hier leider nicht."); }
        });
        q("[data-save]").addEventListener("click", async () => {
          stop();
          const title = q("#nb-f-title").value.trim();
          const text = ta.value;
          if (!title && !text.trim()) { ui.toast("Eine leere Notiz speichere ich nicht. 😉"); return; }
          const item = { ...(note || {}), title, text, tags: N.parseTags(q("#nb-f-tags").value), coll: q("#nb-f-coll").value.trim(), fav: n.fav, pinned: n.pinned };
          close();
          try {
            const id = await notes.put(item);
            ui.toast(isNew ? "📝 Notiz gespeichert ✓" : "Gespeichert ✓");
            if (isNew || S.id !== id) location.hash = N.noteHash(id).slice(1);
          } catch (err) { console.error(err); ui.toast("Speichern fehlgeschlagen: " + (err.message || err), 4000); }
        });
      },
    });
  }

  /* ---------- KI-Gedächtnis ---------- */

  function renderMemory() {
    const items = mem.all().map(N.normMemory).filter((m) => m.id && m.text);
    const groups = N.memoryGroups(items);
    const allowedN = N.readable(items).length;
    memEl.innerHTML =
      `<section class="nb-mem-intro card"><div class="nb-mem-emo" aria-hidden="true">🤖</div><div>` +
        `<h3>Was Claude sich merkt</h3>` +
        `<p>Kurze Fakten, die du <b>selbst</b> hier speicherst (z. B. „Ich bin im 2. Lehrjahr“ oder „Ich mag kein Koriander“). Claude liest nur, was du je Bereich freigibst – und kann auf deinen Wunsch auch etwas dazuschreiben.</p>` +
        `<p class="note">🔐 Keine Passwörter, PINs oder Bankdaten – die gehören in den Tresor. ${items.length ? `· ${allowedN} von ${items.length} für Claude lesbar` : ""}</p>` +
      `</div></section>` +
      `<form class="nb-mem-add card" novalidate>` +
        `<label class="nb-mem-in"><span class="sr">Neuer Fakt</span><textarea id="nb-m-text" rows="2" maxlength="${N.MEMORY_MAX}" placeholder="Was soll sich Claude merken?"></textarea></label>` +
        `<div class="nb-mem-row"><label class="nb-mem-area"><span class="sr">Bereich</span><select id="nb-m-area">${N.AREAS.map((a) => `<option value="${a.id}"${a.id === S.marea ? " selected" : ""}>${a.e} ${esc(a.label)}</option>`).join("")}</select></label>` +
        `<button type="submit" class="btn primary sm">💾 Merken</button></div>` +
      `</form>` +
      (groups.length ? groups.map((g) =>
        `<section class="nb-mem-g card" data-area="${g.area.id}">` +
          `<div class="nb-mem-gh"><h4>${g.area.e} ${esc(g.area.label)} <small>${g.items.length}</small></h4>` +
            `<label class="switch nb-mem-sw"><span>Claude darf das lesen</span><input type="checkbox" data-marea="${g.area.id}"${g.allowed ? " checked" : ""}></label></div>` +
          `<ul class="nb-mem-list">${g.items.map((m) => `<li class="${m.allowed ? "" : "is-off"}"><span class="nb-mem-t">${esc(m.text)}${m.src === "claude" ? ` <small class="nb-mem-src">· von Claude gemerkt</small>` : ""}${m.allowed ? "" : ` <small class="nb-mem-src">· 🙈 nicht freigegeben</small>`}</span>` +
            `<button type="button" class="btn ghost sm" data-medit="${esc(m.id)}" aria-label="Bearbeiten: ${esc(m.text)}">${icon("pencil", 16)}</button></li>`).join("")}</ul>` +
        `</section>`).join("")
      : mem.loaded ? `<div class="empty nb-empty"><p>Noch nichts gemerkt. Schreib oben deinen ersten Fakt – oder sag im Chat „Merk dir, dass …“. 🙂</p></div>` : `<p class="note">Lade …</p>`);
  }

  function addMemory(text, area) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) { ui.toast("Bitte etwas eintragen."); return false; }
    const secret = N.looksSecret(t);
    if (secret) { ui.toast("🔐 " + secret, 4500); return false; }
    const items = mem.all();
    if (N.isDuplicate(items, t)) { ui.toast("Das weiß Claude schon. 😉"); return false; }
    if (items.length >= N.MEMORY_LIMIT) { ui.toast(`Höchstens ${N.MEMORY_LIMIT} Einträge – bitte erst etwas löschen.`); return false; }
    const g = N.memoryGroups(items).find((x) => x.area.id === area);
    safe(mem.put({ text: t, area, allowed: g ? g.allowed : true, src: "app" }), "🤖 Gemerkt ✓");
    return true;
  }

  function editMemory(m) {
    const x = N.normMemory(m);
    ui.openSheet({
      title: "🤖 Fakt bearbeiten",
      bodyHTML: `<div class="fields">` +
        `<label>Text<textarea id="nb-me-text" rows="3" maxlength="${N.MEMORY_MAX}">${esc(x.text)}</textarea></label>` +
        `<label>Bereich<select id="nb-me-area">${N.AREAS.map((a) => `<option value="${a.id}"${a.id === x.area ? " selected" : ""}>${a.e} ${esc(a.label)}</option>`).join("")}</select></label>` +
        `<label class="switch"><span>Claude darf das lesen</span><input type="checkbox" id="nb-me-ok"${x.allowed ? " checked" : ""}></label>` +
      `</div><div class="row"><button type="button" class="btn danger sm" data-del>Löschen</button><button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const q = (s) => sheet.querySelector(s);
        q("[data-save]").addEventListener("click", () => {
          const t = q("#nb-me-text").value.replace(/\s+/g, " ").trim();
          if (!t) { ui.toast("Bitte etwas eintragen."); return; }
          const secret = N.looksSecret(t);
          if (secret) { ui.toast("🔐 " + secret, 4500); return; }
          close();
          safe(mem.put({ ...m, text: t, area: q("#nb-me-area").value, allowed: q("#nb-me-ok").checked }), "Gespeichert ✓");
        });
        ui.confirmButton(q("[data-del]"), "Wirklich löschen?", () => { close(); safe(mem.remove(m.id), "Vergessen 🗑️"); });
      },
    });
  }

  /* ---------- Ereignisse ---------- */

  el.addEventListener("click", (ev) => {
    const tb = ev.target.closest("[data-tab]");
    if (tb) {
      S.tab = tb.dataset.tab; lsSet(TAB_KEY, S.tab);
      if (S.tab === "memory" && S.id) { S.id = null; history.replaceState(null, "", "#alltag/notizen"); }
      render(); return;
    }
    const wl = ev.target.closest(".nb-wl");
    if (wl) {
      ev.preventDefault();
      if (wl.dataset.note) location.hash = N.noteHash(wl.dataset.note).slice(1);
      else openEditor(null, wl.dataset.newnote || "");
      return;
    }
    const f = ev.target.closest("[data-f]");
    if (f) { S.view = f.dataset.f; S.tag = ""; S.coll = ""; render(); return; }
    const tg = ev.target.closest("[data-tag]");
    if (tg) {
      const same = N.fold(S.tag) === N.fold(tg.dataset.tag);
      S.tag = same ? "" : tg.dataset.tag; S.view = "alle";
      if (S.id) { location.hash = "alltag/notizen"; return; }
      render(); return;
    }
    const cl = ev.target.closest("[data-coll]");
    if (cl) { S.coll = N.fold(S.coll) === N.fold(cl.dataset.coll) ? "" : cl.dataset.coll; S.view = "alle"; render(); return; }
    const me = ev.target.closest("[data-medit]");
    if (me) { const m = mem.get(me.dataset.medit); if (m) editMemory(m); return; }
    const b = ev.target.closest("[data-nb]");
    if (!b) return;
    const a = b.dataset.nb;
    const cur = S.id ? notes.get(S.id) : null;
    if (a === "new") openEditor(null);
    else if (a === "edit" && cur) openEditor(cur);
    else if (a === "fav" && cur) safe(notes.patch(cur.id, { fav: !cur.fav }), cur.fav ? "Kein Favorit mehr" : "⭐ Zu den Favoriten");
    else if (a === "pin" && cur) safe(notes.patch(cur.id, { pinned: !cur.pinned }), cur.pinned ? "Losgelöst" : "📌 Angepinnt – steht jetzt oben");
  });
  el.addEventListener("change", (ev) => {
    const sw = ev.target.closest("[data-marea]");
    if (!sw) return;
    const area = sw.dataset.marea;
    const on = sw.checked;
    const items = mem.all().map(N.normMemory).filter((m) => m.area === area && m.allowed !== on);
    Promise.all(items.map((m) => mem.patch(m.id, { allowed: on })))
      .then(() => ui.toast(on ? "✅ Claude darf diesen Bereich lesen" : "🙈 Bereich für Claude gesperrt"))
      .catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); });
  });
  el.addEventListener("submit", (ev) => {
    if (!ev.target.closest(".nb-mem-add")) return;
    ev.preventDefault();
    const ta = el.querySelector("#nb-m-text");
    S.marea = el.querySelector("#nb-m-area").value;
    if (addMemory(ta.value, el.querySelector("#nb-m-area").value)) ta.value = "";
  });
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && ev.target.id === "nb-m-text") { ev.preventDefault(); ev.target.form.requestSubmit(); }
  });
  qIn.addEventListener("input", () => { S.q = qIn.value; renderList(); });

  const onHash = () => {
    const id = N.routeId(location.hash);
    if (id === null) return;
    const next = id || null;
    if (next !== S.id) { S.id = next; if (next) { S.tab = "notes"; } render(); window.scrollTo(0, 0); }
  };
  window.addEventListener("hashchange", onHash);
  if (S.id) S.tab = "notes";
  const offs = [notes.watch(queue), mem.watch(() => { if (S.tab === "memory") queue(); })];
  render();
  return () => { alive = false; window.removeEventListener("hashchange", onHash); for (const o of offs) { try { o(); } catch { /* egal */ } } };
}
