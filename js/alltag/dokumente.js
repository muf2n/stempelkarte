// Update 10 E – Alltag › 📁 Dokumente (#alltag/dokumente, Detail #alltag/dokumente/<id>, Neu mit Verknüpfung #alltag/dokumente?neu=<k>:<id>).
// PDFs & Fotos (auch direkt mit der Kamera), Ordner (feste + eigene), Tags, Favoriten, Vorschau, Ablaufdatum mit Erinnerung
// (Benachrichtigungszentrale „Ablaufende Dokumente“), Verknüpfungen zu Baustelle/Buchung/Aufgabe/Vertrag/Inventar/Kontakt,
// optional „🤖 Text erkennen“ (nur Bilder, Text erst nach deinem Okay gespeichert).
// 🔒 Update 10: Alles mit dem Tresor-Passwort verschlüsselt (Datei + Titel, Notizen, Tags, Text, Links, Vorschau) – siehe dokumente-crypt.js.
//   Kein Tresor → „🔒 Tresor-Passwort einrichten“; gesperrt → nur Ordner + Anzahl + Ablauf-Abzeichen; alte Klartext-Dokumente
//   werden nach dem ersten Entsperren automatisch umgestellt (mit Fortschritt).
// Reine Logik: ./dokumente-core.js, Verschlüsselung: ./dokumente-crypt.js, entschlüsselter Stand: ./dokumente-store.js, Datei-Ablage: ./doc-files.js
import * as Inbox from "../inbox.js"; // Update 15
import { collection, newId } from "./db.js";
import * as D from "./dokumente-core.js";
import * as E from "./dokumente-crypt.js";
import * as DS from "./dokumente-store.js";
import * as Sess from "./vault-session.js";
import * as F from "./doc-files.js";
import * as A from "./akten-ui.js";
import { askClaude, aiAvailable } from "./ai-client.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";
import { modulesOff } from "../profiles-core.js"; // Update 10 – 💼 Beleg-Verknüpfung nur bei eingeschalteter Buchhaltung

const VIEW_KEY = "sk-dk-view";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const VIEWS = [["alle", "📚", "Alle"], ["fav", "⭐", "Favoriten"], ["ablauf", "⏰", "Läuft ab"]];
const OCR_PROMPT = "Lies bitte den gesamten Text auf diesem Foto (Rechnung, Brief, Garantieschein o. Ä.) und gib NUR den erkannten Text zurück – " +
  "ohne Einleitung, ohne Kommentar, Zeilenumbrüche wie im Original. Wenn kein Text lesbar ist, antworte genau: (Kein lesbarer Text)";
const isAndroid = () => /Android/i.test(navigator.userAgent || "");

let lockMod = null;
import("./money-lock-state.js").then((m) => { lockMod = m; }).catch(() => { /* ohne Geld-Sperre */ });
const moneyLocked = () => !!(lockMod && lockMod.isLocked());

export function mount(el, ctx) {
  A.injectCSS();
  const col = DS.coll();
  const other = { vertraege: collection("vertraege"), inventar: collection("inventar"), kontakte: collection("kontakte") };
  const S = { view: VIEWS.some((v) => v[0] === lsGet(VIEW_KEY)) ? lsGet(VIEW_KEY) : "alle", folder: "", tag: "", q: "", id: D.routeId(location.hash) };
  let alive = true, queued = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };

  el.innerHTML = `<div class="ak dk">
      <div class="dk-sec"></div>
      <div class="ak-home">
        <div class="ak-top">
          <label class="ak-search"><span class="sr">Dokumente suchen</span><input id="dk-q" type="search" placeholder="🔎 Titel, Tag, erkannter Text …" autocomplete="off" enterkeyhint="search"></label>
          <div class="ak-acts">
            <label class="btn ghost sm ak-filebtn">📷 <span>Foto</span><input type="file" accept="image/*" capture="environment" data-dk-file="cam"></label>
            <label class="btn primary sm ak-filebtn">${icon("plus", 16)}<span>Dokument</span><input type="file" accept="application/pdf,image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" data-dk-file="file"></label>
          </div>
        </div>
        <div class="ak-views" role="tablist" aria-label="Ansicht"></div>
        <div class="ak-chips dk-folders" role="group" aria-label="Ordner"></div>
        <div class="ak-chips dk-tags" role="group" aria-label="Tags"></div>
        <div class="ak-list-wrap"></div>
        <p class="note ak-foot dk-foot"></p>
      </div>
      <div class="ak-detail-wrap" hidden></div>
    </div>`;
  const home = el.querySelector(".ak-home");
  const detailEl = el.querySelector(".ak-detail-wrap");
  const viewsEl = el.querySelector(".ak-views");
  const foldersEl = el.querySelector(".dk-folders");
  const tagsEl = el.querySelector(".dk-tags");
  const listEl = el.querySelector(".ak-list-wrap");
  const qIn = el.querySelector("#dk-q");
  const secEl = el.querySelector(".dk-sec");
  const footEl = el.querySelector(".dk-foot");
  const topEl = el.querySelector(".ak-top");
  // 🔒 Zustand: loading | setup (noch kein Tresor) | locked | decrypt (entschlüsselt gerade) | open
  const mode = () => (!Sess.metaLoaded() || !DS.loaded() ? "loading" : !Sess.hasVault() ? "setup" : !Sess.isUnlocked() ? "locked" : !DS.isReady() ? "decrypt" : "open");
  const legacy = () => DS.raw().filter((r) => !E.isEnc(r)).map(E.legacyDoc).filter((d) => d.id);
  const all = () => { const m = mode(); return m === "open" ? DS.docs() || [] : m === "setup" ? legacy() : []; };
  const byId = (id) => all().find((d) => d.id === id) || null;
  const sheets = new Set();
  const openSheet = (opts) => { const sh = ui.openSheet(opts); sheets.add(sh); return sh; };
  const closeSheets = () => { for (const sh of [...sheets]) { try { sh.close(); } catch { /* egal */ } } sheets.clear(); };
  const saveOk = (p, msg) => A.safe(p, msg);

  /* ---------- Verknüpfungen ---------- */

  function targets(k) {
    const sn = A.snap();
    switch (k) {
      case "place": return A.places().map((p) => ({ id: p.id, label: p.name || "Ort" }));
      case "todo": return (sn.todos || []).filter((t) => t && t.id && (t.kind === "todo" || !t.kind)).sort((a, b) => (a.done - b.done) || String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 200)
        .map((t) => ({ id: t.id, label: `${t.done ? "☑" : "☐"} ${t.title || "Aufgabe"}${t.date ? " · " + A.fmtKey(t.date) : ""}` }));
      case "vertrag": return other.vertraege.all().filter((c) => c && c.id && c.name).map((c) => ({ id: c.id, label: c.name }));
      case "inventar": return other.inventar.all().filter((c) => c && c.id && c.name).map((c) => ({ id: c.id, label: c.name }));
      case "kontakt": return other.kontakte.all().filter((c) => c && c.id).map((c) => ({ id: c.id, label: c.name || c.company || c.person || "Kontakt" }));
      case "beleg": { // Update 10 – 💼 Buchhaltung (Geld-Sperre: wie Buchungen)
        if (moneyLocked()) return [];
        return collection("buch_belege").all().filter((b) => b && b.id).sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 200)
          .map((b) => ({ id: b.id, label: `${A.fmtKey(b.date)} · ${b.partner || b.note || (b.type === "in" ? "Einnahme" : "Ausgabe")} · ${A.eur((Number(b.gross) || 0) / 100)}` }));
      }
      case "tx": {
        if (moneyLocked()) return [];
        return collection("money_tx").all().filter((t) => t && t.id).sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 150)
          .map((t) => ({ id: t.id, label: `${A.fmtKey(t.date)} · ${t.note || t.counterparty || (t.type === "in" ? "Einnahme" : "Ausgabe")} · ${A.eur(t.amount)}` }));
      }
      default: return [];
    }
  }
  function linkLabel(l) {
    const meta = D.LINK_KINDS[l.k] || { e: "🔗", label: l.k };
    if ((l.k === "tx" || l.k === "beleg") && moneyLocked()) return `${meta.e} ${meta.label}`;
    const t = targets(l.k).find((x) => x.id === l.id);
    return `${meta.e} ${t ? t.label.replace(/^[☐☑] /, "") : meta.label}`;
  }
  function openLink(l) {
    if (l.k === "todo") {
      const t = (A.snap().todos || []).find((x) => x.id === l.id);
      if (t && ctx && ctx.openTodoForm) ctx.openTodoForm(t); else ui.toast("Aufgabe nicht gefunden.");
      return;
    }
    const h = A.linkHash(l);
    if (h) A.go(h);
  }

  /* ---------- Liste ---------- */

  function badge(d, today) {
    const x = D.expiryStatus(d, today);
    if (x.state === "none") return "";
    return `<span class="ak-b ak-b-${x.state}">${x.state === "ab" ? "⌛" : x.state === "bald" ? "⏰" : "📅"} ${esc(x.label)}</span>`;
  }
  function renderHome() {
    const today = A.todayKey();
    const docs = all();
    const nAb = docs.filter((d) => ["bald", "ab"].includes(D.expiryStatus(d, today).state)).length;
    const nFav = docs.filter((d) => d.fav).length;
    const cnt = { alle: docs.length, fav: nFav, ablauf: nAb };
    viewsEl.innerHTML = VIEWS.map(([id, e, label]) => `<button type="button" role="tab" class="ak-vt" data-view="${id}" aria-selected="${S.view === id}"><span aria-hidden="true">${e}</span><span>${label}</span>${cnt[id] ? `<span class="ak-vt-n">${cnt[id]}</span>` : ""}</button>`).join("");
    const fc = D.folderCounts(docs).filter((f) => f.n || !f.own);
    foldersEl.innerHTML = docs.length ? `<button type="button" class="chip" data-folder="" aria-pressed="${!S.folder}">Alle Ordner</button>` +
      fc.map((f) => `<button type="button" class="chip" data-folder="${esc(f.id)}" aria-pressed="${S.folder === f.id}">${f.e} ${esc(f.label)}${f.n ? ` <span class="ak-cn">${f.n}</span>` : ""}</button>`).join("") : "";
    const tags = D.allTags(docs);
    tagsEl.innerHTML = tags.length ? tags.slice(0, 20).map((t) => `<button type="button" class="chip ak-tag" data-tag="${esc(t)}" aria-pressed="${S.tag.toLowerCase() === t.toLowerCase()}">#${esc(t)}</button>`).join("") : "";
    tagsEl.hidden = !tags.length;
    if (!docs.length) {
      listEl.innerHTML = col.loaded ? A.emptyHTML("📁", "Noch keine Dokumente", "Rechnungen, Verträge, Garantiescheine oder Zeugnisse – fotografier sie einfach ab oder lade PDFs hoch (bis 10 MB). Dann findest du alles in Sekunden wieder. 😊") : `<p class="note">Lade …</p>`;
      return;
    }
    const list = D.filterDocs(docs, { q: S.q, folder: S.folder, tag: S.tag, fav: S.view === "fav", view: S.view }, today);
    listEl.innerHTML = list.length ? `<ul class="ak-list">${list.map((d) =>
      `<li><button type="button" class="ak-card" data-dk="open" data-id="${esc(d.id)}">` +
        `<span class="ak-thumb">${d.thumb ? `<img src="${esc(d.thumb)}" alt="">` : `<span class="ak-emo" aria-hidden="true">${D.kindIcon(d)}</span>`}</span>` +
        `<span class="ak-ct"><b>${d.fav ? "⭐ " : ""}${esc(d.title)}</b>` +
          `<small>${esc([D.folderOf(d.folder).e + " " + D.folderOf(d.folder).label, A.fmtKey(d.date), D.fmtSize(d.size)].filter(Boolean).join(" · "))}</small>` +
          `<span class="ak-badges">${badge(d, today)}${d.tags.slice(0, 3).map((t) => `<span class="ak-b ak-b-tag">#${esc(t)}</span>`).join("")}${d.links.length ? `<span class="ak-b ak-b-info">🔗 ${d.links.length}</span>` : ""}${d.ocr ? `<span class="ak-b ak-b-info">🔤 Text</span>` : ""}</span></span>` +
        `<span class="ak-go" aria-hidden="true">${icon("chevron-right", 18)}</span>` +
      `</button></li>`).join("")}</ul>`
      : `<div class="empty ak-empty"><p>${S.q ? `Nichts gefunden für „${esc(S.q)}“ 🤔` : S.view === "ablauf" ? "Nichts läuft bald ab – alles im grünen Bereich ✨" : S.view === "fav" ? "Noch keine Favoriten – tipp im Dokument auf ☆." : "Hier ist noch nichts drin."}</p></div>`;
  }

  /* ---------- Detail ---------- */

  let prevUrl = null, prevImg = null;
  function renderDetail(d) {
    const today = A.todayKey();
    const x = D.expiryStatus(d, today);
    const canOcr = D.isImage(d) && aiAvailable();
    detailEl.innerHTML = `<div class="ak-det">
      <div class="ak-det-bar"><button type="button" class="btn ghost sm" data-dk="back">${icon("chevron-left", 18)}<span>Alle Dokumente</span></button>
        <button type="button" class="btn ghost sm ak-star" data-dk="fav" aria-pressed="${d.fav}" aria-label="${d.fav ? "Favorit entfernen" : "Als Favorit merken"}">${d.fav ? "⭐" : "☆"}</button></div>
      <section class="ak-hero">
        <div class="dk-prev" id="dk-prev">${D.isImage(d) ? (d.thumb ? `<img src="${esc(d.thumb)}" alt="Vorschau ${esc(d.title)}" class="is-thumb">` : `<p class="note">Lädt …</p>`) : `<div class="dk-big" aria-hidden="true">${D.kindIcon(d)}</div>`}</div>
        <div class="ak-hero-t"><h2>${esc(d.title)}</h2>
          <p class="note">${esc([D.folderOf(d.folder).e + " " + D.folderOf(d.folder).label, A.fmtKey(d.date), D.fmtSize(d.size), d.name].filter(Boolean).join(" · "))}</p>
          ${x.state !== "none" ? `<p><span class="ak-b ak-b-${x.state}">${x.state === "ab" ? "⌛" : x.state === "bald" ? "⏰" : "📅"} ${esc(x.label)}</span>${d.remind ? ` <span class="note">🔔 Erinnerung ${d.remindDays} Tage vorher</span>` : ""}</p>` : ""}
          ${d.tags.length ? `<p class="ak-tagrow">${d.tags.map((t) => `<span class="ak-b ak-b-tag">#${esc(t)}</span>`).join("")}</p>` : ""}
        </div>
        <div class="ak-hero-acts">
          <button type="button" class="btn primary sm" data-dk="view">${icon("eye", 16)}<span>${D.isImage(d) ? "Groß ansehen" : "Öffnen"}</span></button>
          <button type="button" class="btn ghost sm" data-dk="share">${icon("share", 16)}<span>Teilen/Speichern</span></button>
          ${canOcr ? `<button type="button" class="btn ghost sm" data-dk="ocr">🤖 <span>Text erkennen</span></button>` : ""}
          <button type="button" class="btn ghost sm" data-dk="edit">${icon("pencil", 16)}<span>Bearbeiten</span></button>
        </div>
      </section>
      <div class="dk-ocr-box" hidden></div>
      <section class="ak-card-s"><h3>🔗 Verknüpft mit</h3>
        ${d.links.length ? `<div class="ak-chiprow">${d.links.map((l, i) => `<button type="button" class="chip ak-link" data-dk="link" data-i="${i}">${esc(linkLabel(l))}</button>`).join("")}</div>` : `<p class="note">Noch nichts verknüpft. Über „Bearbeiten“ hängst du das Dokument an eine Baustelle, Buchung, Aufgabe, einen Vertrag, ein Inventar-Ding oder einen Kontakt. 🧷</p>`}
      </section>
      ${d.ocr ? `<details class="ak-card-s dk-ocr"><summary><h3>🔤 Erkannter Text</h3></summary><pre class="dk-ocr-t">${esc(d.ocr)}</pre><button type="button" class="btn ghost sm" data-dk="ocrdel">Text entfernen</button></details>` : ""}
      ${d.notes ? `<section class="ak-card-s"><h3>📝 Notizen</h3><p class="ak-pre">${esc(d.notes)}</p></section>` : ""}
      <div class="ak-det-foot"><button type="button" class="btn danger sm" data-dk="del">Dokument löschen</button></div>
    </div>`;
    if (mode() !== "open") detailEl.querySelectorAll('[data-dk="edit"],[data-dk="fav"],[data-dk="ocr"]').forEach((b) => { b.hidden = true; });
    if (D.isImage(d)) withBlob(d, (b) => {
      const p = detailEl.querySelector("#dk-prev");
      if (!p || S.id !== d.id) return;
      DS.revoke(prevImg);
      prevImg = DS.url(b);
      if (prevImg) p.innerHTML = `<img src="${esc(prevImg)}" alt="Vorschau ${esc(d.title)}">`;
    }, true);
    const arm = detailEl.querySelector('[data-dk="del"]');
    ui.confirmButton(arm, "Wirklich löschen?", async () => {
      await A.safe(DS.remove(d), "Dokument gelöscht 🗑️");
      A.go("#alltag/dokumente");
    });
  }

  async function withBlob(d, fn, quiet = false) {
    try {
      const b = await DS.blob(d);
      if (!b) { if (!quiet) ui.toast("Datei nicht gefunden (evtl. noch nicht synchronisiert)."); return; }
      await fn(b);
    } catch (err) {
      if (err && err.code === "locked") { if (!quiet) ui.toast(err.message); return; }
      console.error(err);
      if (!quiet) ui.toast(/offline|unavailable/i.test(String(err && err.message)) ? "Offline – Datei gerade nicht verfügbar." : "Datei konnte nicht geladen werden.");
    }
  }
  const fileName = (d) => d.name || (d.title.replace(/[\\/:*?"<>|]+/g, "_") + (D.isPdf(d) ? ".pdf" : D.isImage(d) ? ".jpg" : ""));
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function share(d, blob) {
    const file = new File([blob], fileName(d), { type: blob.type });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: d.title }); } catch (err) { if (err && err.name !== "AbortError") ui.toast("Teilen nicht möglich."); }
    } else { download(blob, fileName(d)); ui.toast("Wird heruntergeladen 📥"); }
  }
  function view(d) {
    withBlob(d, async (blob) => {
      if (D.isImage(d)) {
        const u = DS.url(blob);
        if (!u) return;
        const sh = openSheet({ title: `🖼️ ${d.title}`, bodyHTML: `<div class="ak-photo-big"><img src="${esc(u)}" alt="${esc(d.title)}"></div>` });
        const obs = new MutationObserver(() => { if (!document.contains(sh.el)) { obs.disconnect(); sheets.delete(sh); DS.revoke(u); } });
        obs.observe(sh.el.parentNode || document.body, { childList: true });
        return;
      }
      if (isAndroid()) { await share(d, blob); return; } // Android-WebView/PWA: Blob-Tabs gehen nicht zuverlässig → Teilen/Speichern
      // L1 (Audit 2): nur PDFs im Tab öffnen – alles andere (Word, Text, Unbekanntes) herunterladen, nie als Seite anzeigen.
      if (!D.isPdf(d)) { download(new Blob([blob], { type: D.OCTET }), fileName(d)); ui.toast("Wird heruntergeladen 📥"); return; }
      blob = new Blob([blob], { type: "application/pdf" });
      DS.revoke(prevUrl);
      prevUrl = DS.url(blob);
      if (!prevUrl) return;
      const w = window.open(prevUrl, "_blank");
      if (!w) download(blob, fileName(d));
    });
  }

  async function runOcr(d) {
    const box = detailEl.querySelector(".dk-ocr-box");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<p class="note">🤖 Claude liest den Text … (das dauert ein paar Sekunden)</p>`;
    try {
      let img = null;
      await withBlob(d, async (b) => { const u = DS.url(b); try { if (u) img = await F.ocrImage(u); } finally { DS.revoke(u); } });
      if (!img) throw new Error("Bild konnte nicht geladen werden.");
      const out = await askClaude([{ role: "user", content: OCR_PROMPT }], { body: { mode: "lehrer", image: img }, timeoutMs: 60000 });
      const text = D.cleanOcr(out.reply);
      if (!text) { box.innerHTML = `<p class="note">🤔 Auf dem Bild war kein lesbarer Text.</p>`; return; }
      box.innerHTML = `<h3>🔤 Erkannter Text – passt das?</h3><textarea id="dk-ocr-in" rows="8">${esc(text)}</textarea>
        <p class="note">Erst mit deinem Okay wird der Text gespeichert – dann findest du das Dokument auch über die Suche. 🔎</p>
        <div class="row"><button type="button" class="btn primary sm" data-dk="ocrok">✔️ Übernehmen</button><button type="button" class="btn ghost sm" data-dk="ocrno">Verwerfen</button></div>`;
    } catch (err) {
      console.error(err);
      box.innerHTML = `<p class="note ak-err">😕 ${esc(err && err.message || "Text erkennen hat nicht geklappt.")}</p>`;
    }
  }

  /* ---------- Formular ---------- */

  function folderOptions(cur) {
    const own = D.folderCounts(all()).filter((f) => f.own).map((f) => f.id);
    if (cur && !D.FOLDERS.some((f) => f.id === cur) && !own.includes(cur)) own.push(cur);
    return D.FOLDERS.map((f) => `<option value="${f.id}"${f.id === cur ? " selected" : ""}>${f.e} ${esc(f.label)}</option>`).join("") +
      own.map((o) => `<option value="${esc(o)}"${o === cur ? " selected" : ""}>🗂️ ${esc(o)}</option>`).join("") +
      `<option value="__neu">➕ Eigener Ordner …</option>`;
  }
  function linkRows(links) {
    return links.map((l, i) => `<li><span>${esc(linkLabel(l))}</span><button type="button" class="ak-x" data-rm="${i}" aria-label="Verknüpfung entfernen">✕</button></li>`).join("");
  }

  /** Neues Dokument (prepared = vorbereitete Datei) oder Bearbeiten (doc). */
  function openForm({ doc = null, prepared = null, origName = "", preLink = null } = {}) {
    const d = doc || D.normDoc({ title: origName.replace(/\.[^.]+$/, ""), folder: prepared && prepared.type === "application/pdf" && /rechnung|invoice/i.test(origName) ? "rechnungen" : "sonstiges", date: A.todayKey(), links: preLink ? [preLink] : [] });
    let links = d.links.slice();
    const kinds = Object.entries(D.LINK_KINDS).filter(([k]) => (k !== "tx" && k !== "beleg") || !moneyLocked()).filter(([k]) => k !== "beleg" || !modulesOff((A.snap() || {}).settings).has("buchhaltung") || links.some((l) => l.k === "beleg"));
    openSheet({
      title: doc ? "✏️ Dokument bearbeiten" : "📁 Dokument ablegen",
      bodyHTML: `<form class="fields ak-form" novalidate>
        ${prepared ? `<p class="note ak-fileinfo">✓ ${esc(origName || "Datei")} · ${esc(D.fmtSize(prepared.size))}</p>` : ""}
        <label>Titel<input id="dk-f-title" type="text" maxlength="140" required value="${esc(d.title)}" placeholder="z. B. Rechnung Waschmaschine"></label>
        <div class="row2"><label>Ordner<select id="dk-f-folder">${folderOptions(d.folder)}</select></label>
          <label id="dk-f-own-l" hidden>Neuer Ordner<input id="dk-f-own" type="text" maxlength="40" placeholder="z. B. Auto"></label></div>
        <label>Tags <small class="note">(mit Komma getrennt)</small><input id="dk-f-tags" type="text" maxlength="200" value="${esc(d.tags.join(", "))}" placeholder="z. B. Garantie, Küche"></label>
        <div class="row2"><label>Datum<input id="dk-f-date" type="date" value="${esc(d.date)}"></label>
          <label>Läuft ab am <small class="note">(optional)</small><input id="dk-f-exp" type="date" value="${esc(d.expires)}"></label></div>
        <label class="ak-check"><input id="dk-f-remind" type="checkbox"${d.remind ? " checked" : ""}> 🔔 Erinnern, <input id="dk-f-rdays" type="number" min="1" max="365" inputmode="numeric" value="${d.remindDays}" aria-label="Tage vorher"> Tage bevor es abläuft</label>
        <fieldset class="ak-links"><legend>🔗 Verknüpfen</legend>
          <ul class="ak-linklist">${linkRows(links)}</ul>
          <div class="row2"><select id="dk-f-lk" aria-label="Art">${kinds.map(([k, m]) => `<option value="${k}">${m.e} ${esc(m.label)}</option>`).join("")}</select>
            <select id="dk-f-lt" aria-label="Ziel"></select></div>
          <button type="button" class="btn ghost sm" data-addlink>＋ Verknüpfung hinzufügen</button>
        </fieldset>
        <label>Notizen<textarea id="dk-f-notes" rows="3" maxlength="4000" placeholder="z. B. Original liegt im Ordner im Büro">${esc(d.notes)}</textarea></label>
        <label class="ak-check"><input id="dk-f-fav" type="checkbox"${d.fav ? " checked" : ""}> ⭐ Favorit</label>
        <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button></div>
      </form>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        const fsel = $("#dk-f-folder"), ownL = $("#dk-f-own-l");
        fsel.addEventListener("change", () => { ownL.hidden = fsel.value !== "__neu"; if (!ownL.hidden) $("#dk-f-own").focus(); });
        const fillTargets = () => {
          const t = targets($("#dk-f-lk").value);
          $("#dk-f-lt").innerHTML = t.length ? t.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join("") : `<option value="">– noch nichts da –</option>`;
        };
        $("#dk-f-lk").addEventListener("change", fillTargets);
        fillTargets();
        const redraw = () => { $(".ak-linklist").innerHTML = linkRows(links); };
        sheet.querySelector("[data-addlink]").addEventListener("click", () => {
          const k = $("#dk-f-lk").value, id = $("#dk-f-lt").value;
          if (!id) { ui.toast("Da gibt's noch nichts zum Verknüpfen."); return; }
          links = D.cleanLinks([...links, { k, id }]); redraw();
        });
        $(".ak-linklist").addEventListener("click", (ev) => { const b = ev.target.closest("[data-rm]"); if (b) { links.splice(Number(b.dataset.rm), 1); redraw(); } });
        $("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const title = $("#dk-f-title").value.trim();
          if (!title) { ui.toast("Bitte einen Titel eingeben."); $("#dk-f-title").focus(); return; }
          let folder = fsel.value;
          if (folder === "__neu") folder = $("#dk-f-own").value.trim().slice(0, 40) || "sonstiges";
          const meta = {
            title, folder, tags: D.cleanTags($("#dk-f-tags").value), date: $("#dk-f-date").value || "", expires: $("#dk-f-exp").value || "",
            remind: $("#dk-f-remind").checked, remindDays: Math.max(1, Math.min(365, Number($("#dk-f-rdays").value) || 30)),
            links: D.cleanLinks(links), notes: $("#dk-f-notes").value.trim(), fav: $("#dk-f-fav").checked, updated: Date.now(),
          };
          const btn = $("[data-save]");
          ui.setBusy(btn, true, "Speichert …");
          try {
            if (doc) {
              await DS.update(doc.id, meta);
              ui.toast("Gespeichert ✓");
              close();
              return;
            }
            const id = newId();
            const r = await DS.create({ ...meta, id, type: prepared.type, size: prepared.size, name: origName, thumb: prepared.thumb || "", ocr: "", created: Date.now() }, E.dataUrlBytes(prepared.data));
            prepared.data = "";
            r.upload.catch((err) => { console.error(err); ui.toast("Datei-Upload fehlgeschlagen – bitte später nochmal öffnen."); });
            ui.toast("Dokument abgelegt & verschlüsselt 🔒📁");
            close();
            A.go(D.docHash(id));
          } catch (err) {
            console.error(err);
            ui.setBusy(btn, false);
            ui.toast(err && err.code === "locked" ? err.message : "Speichern fehlgeschlagen (Speicher voll?) 🙈");
          }
        });
      },
    });
  }

  async function onFile(input, preLink = null) {
    const f = input.files && input.files[0];
    input.value = "";
    if (!f) return;
    return onFileObj(f, preLink);
  }
  async function onFileObj(f, preLink = null) {
    if (mode() !== "open") { ui.toast(mode() === "setup" ? "🔒 Richte zuerst das Tresor-Passwort ein – dann werden deine Dokumente verschlüsselt." : "🔒 Bitte zuerst entsperren."); return; }
    ui.toast("Datei wird vorbereitet … ⏳", 1500);
    try {
      const prepared = await F.prepareFile(f);
      openForm({ prepared, origName: f.name || (prepared.type === "image/jpeg" ? `Foto ${A.fmtKey(A.todayKey())}.jpg` : "Dokument"), preLink });
    } catch (err) {
      ui.toast(err && err.message || "Datei konnte nicht gelesen werden.", 5000);
    }
  }

  /* ---------- Rendern / Routing ---------- */

  let pendingLink = null; // aus #alltag/dokumente?neu=<k>:<id>
  function readNew() {
    const m = /[?&]neu=([a-z]+):([^&]+)/.exec(location.hash || "");
    if (!m || !D.LINK_KINDS[m[1]]) return;
    let id = ""; try { id = decodeURIComponent(m[2]); } catch { return; }
    pendingLink = { k: m[1], id };
    history.replaceState(history.state, "", location.href.replace(/\?neu=[^#]*$/, ""));
    queueMicrotask(linkSheet);
  }
  // Update 15 – Datei aus 📸 Erfassen / Teilen übernehmen (js/inbox.js)
  let inboxWait = false;
  function readInbox() {
    if (!alive || !Inbox.peek("dokumente")) return;
    const m = mode();
    if (m === "setup") { ui.toast("🔒 Richte zuerst das Tresor-Passwort ein – dann kann ich die Datei verschlüsselt ablegen.", 4000); return; }
    if (m !== "open") { if (!inboxWait) ui.toast("🔒 Entsperr kurz deine Dokumente – dann speichere ich die Datei.", 3500); inboxWait = true; return; }
    inboxWait = false;
    const f = Inbox.take("dokumente");
    if (f) onFileObj(f);
  }
  let linkWait = false; // gesperrt → Blatt nach dem Entsperren öffnen
  function linkSheet() {
    if (!pendingLink || !alive) return;
    const m = mode();
    if (m === "setup") { ui.toast("🔒 Richte zuerst das Tresor-Passwort ein – dann kannst du Dokumente ablegen.", 3500); pendingLink = null; return; }
    if (m !== "open") { if (!linkWait) ui.toast("🔒 Entsperr kurz deine Dokumente – dann geht's mit der Verknüpfung weiter.", 3500); linkWait = true; return; }
    linkWait = false;
    {
      openSheet({
        title: "📎 Dokument verknüpfen",
        bodyHTML: `<p class="note">Neues Dokument für <b>${esc(linkLabel(pendingLink))}</b> – fotografieren oder Datei wählen:</p>
          <div class="row ak-acts"><label class="btn ghost ak-filebtn">📷 <span>Foto</span><input type="file" accept="image/*" capture="environment" data-pre></label>
          <label class="btn primary ak-filebtn">📄 <span>Datei wählen</span><input type="file" accept="application/pdf,image/*,.pdf,.doc,.docx,.txt" data-pre></label></div>
          ${all().length ? `<p class="note">…oder ein vorhandenes Dokument verknüpfen:</p><select id="dk-ex" aria-label="Vorhandenes Dokument">${all().map((d) => `<option value="${esc(d.id)}">${esc(d.title)}</option>`).join("")}</select>
          <div class="row"><button type="button" class="btn ghost sm" data-exlink>🔗 Verknüpfen</button></div>` : ""}`,
        onMount(sheet, close) {
          const link = pendingLink;
          sheet.querySelectorAll("[data-pre]").forEach((inp) => inp.addEventListener("change", () => { close(); onFile(inp, link); }));
          const b = sheet.querySelector("[data-exlink]");
          if (b) b.addEventListener("click", async () => {
            const d = byId(sheet.querySelector("#dk-ex").value);
            if (!d) return;
            await A.safe(DS.update(d.id, { links: D.cleanLinks([...d.links, link]) }), "Verknüpft 🔗");
            close();
          });
        },
      });
    }
  }

  /* ---------- 🔒 Sperre / Einrichten / Umstellung ---------- */

  let secMode = "";
  function lockSummary() {
    const today = A.todayKey();
    const L = DS.lockedList();
    const fc = D.folderCounts(L).filter((f) => f.n);
    const st = L.map((d) => D.expiryStatus(d, today).state);
    const nB = st.filter((x) => x === "bald").length, nA = st.filter((x) => x === "ab").length;
    return `<p class="dk-lsum-n">📚 ${L.length} ${L.length === 1 ? "Dokument" : "Dokumente"}</p>` +
      (fc.length ? `<div class="ak-chiprow dk-lfold">${fc.map((f) => `<span class="chip" data-lfold="${esc(f.id)}">${f.own ? "🗂️ Eigene Ordner" : `${f.e} ${esc(f.label)}`} <span class="ak-cn">${f.n}</span></span>`).join("")}</div>` : "") +
      (nB || nA ? `<p class="ak-badges">${nB ? `<span class="ak-b ak-b-bald">⏰ ${nB} ${nB === 1 ? "läuft" : "laufen"} bald ab</span>` : ""}${nA ? `<span class="ak-b ak-b-ab">⌛ ${nA} abgelaufen</span>` : ""}</p>` : "");
  }
  function renderSec() {
    const m = mode();
    const showTop = m === "open";
    topEl.hidden = !showTop && m !== "setup";
    el.querySelectorAll("[data-dk-file]").forEach((i) => { i.closest("label").hidden = !showTop; });
    if (m === "setup") {
      if (secMode !== m) {
        secEl.innerHTML = `<section class="ak-card-s dk-setup"><h3>🔒 Dokumente verschlüsseln</h3>
          <p>Damit Rechnungen, Verträge & Co. nur für dich lesbar sind, werden sie mit deinem <b>Tresor-Passwort</b> verschlüsselt – Datei, Titel, Notizen, Tags und erkannter Text. Einmal einrichten, dann kann's losgehen. 😊</p>
          <button type="button" class="btn primary" data-dk="setup">🔒 Tresor-Passwort einrichten</button></section>`;
      }
    } else if (m === "locked") {
      if (secMode !== m) {
        secEl.innerHTML = `<form class="ak-card-s dk-lock" novalidate><h3>🔒 Deine Dokumente sind gesperrt</h3>
          <p class="note dk-reason"></p>
          <label class="dk-pw-l">Tresor-Passwort<input id="dk-pw" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" enterkeyhint="go"></label>
          <p class="ak-err dk-err" role="alert" hidden></p>
          <button type="submit" class="btn primary" data-dk-unlock>🔓 Entsperren</button>
          <div class="dk-lsum"></div></form>`;
        secEl.querySelector("form").addEventListener("submit", onUnlock);
        setTimeout(() => { const i = secEl.querySelector("#dk-pw"); if (i && alive && !document.querySelector(".sheet")) try { i.focus({ preventScroll: true }); } catch { /* egal */ } }, 50);
      }
      secEl.querySelector(".dk-reason").textContent = Sess.lockReason() || "Gib dein Tresor-Passwort ein, um sie zu sehen. Ohne Entsperren siehst du nur Ordner, Anzahl und Ablauf-Hinweise.";
      secEl.querySelector(".dk-lsum").innerHTML = lockSummary();
    } else if (m === "open" || m === "decrypt") {
      const g = DS.mig, bad = DS.brokenCount(), plain = DS.plainCount();
      secEl.innerHTML = `<div class="dk-bar"><span class="dk-bar-t">🔓 Entsperrt – alles verschlüsselt gespeichert</span><button type="button" class="btn ghost sm" data-dk="lock">🔒 Sperren</button></div>` +
        (m === "decrypt" ? `<p class="note">🔓 Entschlüssle deine Dokumente …</p>` : "") +
        (g.running ? `<div class="ak-card-s dk-mig" role="status"><b>🔐 Verschlüssle deine Dokumente … ${g.done}/${g.total}</b><progress max="${g.total}" value="${g.done}"></progress><small class="note">Bitte die App kurz offen lassen – nichts geht verloren, falls sie zugeht.</small></div>`
          : plain && (g.failed || g.missing) ? `<p class="note dk-mig-warn">⚠️ ${plain} ${plain === 1 ? "Dokument ist" : "Dokumente sind"} noch nicht verschlüsselt (Datei gerade nicht erreichbar). Ich probier's beim nächsten Entsperren wieder – das Original bleibt erhalten.</p>` : "") +
        (bad ? `<p class="note ak-err">🔐 ${bad} ${bad === 1 ? "Dokument lässt" : "Dokumente lassen"} sich mit diesem Tresor nicht öffnen (anderer Tresor-Schlüssel?).</p>` : "");
    } else secEl.innerHTML = "";
    secMode = m;
    footEl.innerHTML = m === "setup" ? "🔒 Neue Dokumente brauchen ein Tresor-Passwort – dann ist alles verschlüsselt." : "🔒 Datei, Titel, Notizen, Tags, Verknüpfungen und erkannter Text sind mit deinem Tresor-Passwort verschlüsselt. Ohne Entsperren sichtbar: nur Ordner, Datum, Ablauf und Größe.";
  }
  async function onUnlock(ev) {
    ev.preventDefault();
    const f = ev.currentTarget, inp = f.querySelector("#dk-pw"), err = f.querySelector(".dk-err"), btn = f.querySelector("[data-dk-unlock]");
    if (!inp.value) { err.textContent = "Bitte Tresor-Passwort eingeben."; err.hidden = false; return; }
    ui.setBusy(btn, true, "Entsperre …");
    try {
      await Sess.unlock(inp.value);
      inp.value = "";
      ui.toast("Entsperrt 🔓");
    } catch (e) {
      inp.value = "";
      err.textContent = e && e.code === "wrong-password" ? `Falsches Passwort.${e.fails >= 3 ? ` (${e.fails} Fehlversuche)` : ""}` : (e && e.message) || "Entsperren fehlgeschlagen.";
      err.hidden = false;
      if (alive) { ui.setBusy(btn, false); try { inp.focus(); } catch { /* egal */ } }
    }
  }

  function render() {
    renderSec();
    const m = mode();
    S.id = D.routeId(location.hash);
    if (m === "locked" || m === "decrypt" || m === "loading") {
      home.hidden = false; detailEl.hidden = true; detailEl.innerHTML = "";
      viewsEl.innerHTML = foldersEl.innerHTML = tagsEl.innerHTML = "";
      listEl.innerHTML = m === "loading" ? `<p class="note">Lade …</p>` : "";
      return;
    }
    if (linkWait && m === "open") queueMicrotask(linkSheet);
    if (inboxWait && m === "open") queueMicrotask(readInbox);
    const d = S.id ? byId(S.id) : null;
    if (S.id && !d) {
      home.hidden = true; detailEl.hidden = false;
      detailEl.innerHTML = col.loaded ? `<div class="empty ak-empty"><h3>🤔 Dokument nicht gefunden</h3><p>Vielleicht wurde es gelöscht.</p><a class="btn ghost sm" href="#alltag/dokumente">Zu allen Dokumenten</a></div>` : `<p class="note">Lade …</p>`;
      return;
    }
    if (d) { home.hidden = true; detailEl.hidden = false; renderDetail(d); return; }
    home.hidden = false; detailEl.hidden = true; detailEl.innerHTML = "";
    renderHome();
  }

  function onClick(ev) {
    const v = ev.target.closest("[data-view]");
    if (v && el.contains(v)) { S.view = v.dataset.view; lsSet(VIEW_KEY, S.view); render(); return; }
    const f = ev.target.closest("[data-folder]");
    if (f && el.contains(f)) { S.folder = f.dataset.folder; render(); return; }
    const t = ev.target.closest("[data-tag]");
    if (t && el.contains(t)) { S.tag = S.tag.toLowerCase() === t.dataset.tag.toLowerCase() ? "" : t.dataset.tag; render(); return; }
    const b = ev.target.closest("[data-dk]");
    if (!b || !el.contains(b)) return;
    const d = S.id ? byId(S.id) : null;
    switch (b.dataset.dk) {
      case "open": A.go(D.docHash(b.dataset.id)); break;
      case "setup": try { sessionStorage.setItem("sk-dk-return", "1"); } catch { /* egal */ } A.go("#alltag/tresor"); break;
      case "lock": Sess.lock("Gesperrt – bis gleich! 🔒"); break;
      case "back": A.go("#alltag/dokumente"); break;
      case "fav": if (d) saveOk(DS.update(d.id, { fav: !d.fav }), d.fav ? "Favorit entfernt" : "Als Favorit gemerkt ⭐"); break;
      case "view": if (d) view(d); break;
      case "share": if (d) withBlob(d, (b) => share(d, b)); break;
      case "edit": if (d) openForm({ doc: d }); break;
      case "link": if (d) { const l = d.links[Number(b.dataset.i)]; if (l) openLink(l); } break;
      case "ocr": if (d) runOcr(d); break;
      case "ocrok": {
        const ta = detailEl.querySelector("#dk-ocr-in");
        if (d && ta) saveOk(DS.update(d.id, { ocr: D.cleanOcr(ta.value) }), "Text verschlüsselt gespeichert – jetzt auch durchsuchbar 🔎");
        break;
      }
      case "ocrno": { const box = detailEl.querySelector(".dk-ocr-box"); if (box) { box.hidden = true; box.innerHTML = ""; } break; }
      case "ocrdel": if (d) saveOk(DS.update(d.id, { ocr: "" }), "Text entfernt"); break;
      default: break;
    }
  }
  function onChange(ev) {
    const inp = ev.target.closest("[data-dk-file]");
    if (inp && el.contains(inp)) onFile(inp);
  }
  qIn.addEventListener("input", () => { S.q = qIn.value; renderHome(); });
  el.addEventListener("click", onClick);
  el.addEventListener("change", onChange);
  const offs = [DS.watch(queue), Sess.onChange(() => { if (!Sess.isUnlocked()) { closeSheets(); prevUrl = prevImg = null; } queue(); }), ...Object.values(other).map((c) => c.watch(queue))];
  const offRoute = A.onRoute((h) => { if (/^#alltag\/dokumente/.test(h)) { if (/[?&]neu=/.test(h)) readNew(); readInbox(); queue(); window.scrollTo(0, 0); } });
  readNew();
  setTimeout(readInbox, 300);
  render();
  return () => {
    alive = false;
    offs.forEach((o) => o());
    offRoute();
    closeSheets();
    DS.revoke(prevImg);
    if (prevUrl) { const u = prevUrl; setTimeout(() => DS.revoke(u), 60000); }
    el.removeEventListener("click", onClick);
    el.removeEventListener("change", onChange);
    el.innerHTML = "";
  };
}

/** Für Benachrichtigungen/Dashboard: bald ablaufende Dokumente (verschlüsselte ohne Titel). */
export async function dueDocs(today = A.todayKey()) {
  const col = collection("dokumente");
  await A.whenLoaded(col);
  return D.dueDocs(col.all(), today);
}
