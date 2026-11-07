// Schule & Lernen – Dokumente & PDFs. Metadaten in school_docs (über db.js), der Dateiinhalt (dataURL)
// in einer EIGENEN Ablage, damit Listen nicht alle Dateien laden:
//   Cloud → users/{uid}/a_school_files/{id} = { id, data }   (einzeln gelesen, kein Listener)
//   lokal → IndexedDB „stempelkarte-school“, Store „files“  (localStorage wäre für Dateien zu klein)
// Limit 700 kB pro Datei; Bilder werden vorher verkleinert (JPEG).
import { getFirebase } from "../firebase.js";
import { newId } from "./db.js";
import { safeType, OCTET } from "./dokumente-core.js";
import {
  col, safeWrite, esc, dot, todayKey, fmtDate, subjectColor, subjectInputHTML, wireSubjectChips, emptyHTML, armDelete, subjects,
} from "./school-core.js";

export const MAX_BYTES = 700 * 1024;
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

/* ---------- Datei-Ablage ---------- */

let idbP = null;
function idb() {
  if (!idbP) {
    idbP = new Promise((res, rej) => {
      const r = indexedDB.open("stempelkarte-school", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => { idbP = null; rej(r.error); };
    });
  }
  return idbP;
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("files", mode);
    const req = fn(tx.objectStore("files"));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error("abgebrochen"));
  });
}
function where(ctx) {
  const s = ctx.store.get();
  if (s.mode === "local") return { local: true };
  if (s.user && s.user.uid) return { uid: s.user.uid };
  throw new Error("Nicht angemeldet.");
}
export async function putFile(ctx, id, data) {
  const w = where(ctx);
  if (w.local) return idbDo("readwrite", (st) => st.put({ id, data }));
  const f = await getFirebase();
  if (!f) throw new Error("Keine Verbindung.");
  return f.fs.setDoc(f.fs.doc(f.db, "users", w.uid, "a_school_files", id), { id, data });
}
export async function getFile(ctx, id) {
  const w = where(ctx);
  if (w.local) { const r = await idbDo("readonly", (st) => st.get(id)); return r ? r.data : null; }
  const f = await getFirebase();
  if (!f) throw new Error("Keine Verbindung.");
  const d = await f.fs.getDoc(f.fs.doc(f.db, "users", w.uid, "a_school_files", id));
  return d.exists() ? d.data().data : null;
}
export async function delFile(ctx, id) {
  const w = where(ctx);
  if (w.local) return idbDo("readwrite", (st) => st.delete(id));
  const f = await getFirebase();
  if (!f) return;
  return f.fs.deleteDoc(f.fs.doc(f.db, "users", w.uid, "a_school_files", id));
}

/* ---------- Dateien vorbereiten ---------- */

const readDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const dataBytes = (u) => Math.floor(((u.length - u.indexOf(",") - 1) * 3) / 4);
function loadImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Bild konnte nicht gelesen werden.")); };
    im.src = url;
  });
}
function draw(im, max, q) {
  const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}
/** → { data, type, size, thumb? } oder wirft Error mit Hinweistext. */
export async function prepareFile(file) {
  if (/^image\//.test(file.type) && !/svg/.test(file.type)) {
    const im = await loadImg(file);
    let max = 1800, q = 0.82, data = draw(im, max, q);
    while (dataBytes(data) > MAX_BYTES && max > 500) { max = Math.round(max * 0.8); q = Math.max(0.5, q - 0.06); data = draw(im, max, q); }
    if (dataBytes(data) > MAX_BYTES) throw new Error("Das Bild ist auch verkleinert noch zu groß.");
    return { data, type: "image/jpeg", size: dataBytes(data), thumb: draw(im, 160, 0.7) };
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`Die Datei ist ${kb(file.size)} groß – erlaubt sind höchstens 700 kB. Tipp: PDF verkleinern („PDF komprimieren“) oder die Seiten als Fotos speichern.`);
  }
  const data = await readDataURL(file);
  return { data: data.replace(/^data:[^,]*,/, `data:${safeType(file.type)};base64,`), type: safeType(file.type), size: file.size }; // L1
}
function toBlob(dataURL) {
  const [head, b64] = dataURL.split(",");
  const type = safeType((/data:([^;]+)/.exec(head) || [])[1]); // L1: nie text/html, SVG o. Ä.
  const bin = atob(b64); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type });
}
const SAFE_IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function fileName(d) {
  if (d.name) return d.name;
  const ext = d.type === "application/pdf" ? ".pdf" : /^image\/jpeg/.test(d.type) ? ".jpg" : "";
  return (d.title || "Dokument").replace(/[\\/:*?"<>|]+/g, "_") + ext;
}
export const kindIcon = (d) => (d.type === "application/pdf" ? "📄" : /^image\//.test(d.type || "") ? "🖼️" : /word|document/.test(d.type || "") ? "📝" : /sheet|excel/.test(d.type || "") ? "📊" : "📎");

/* ---------- Formulare ---------- */

function openUpload(S) {
  let prepared = null, origName = "";
  S.ctx.ui.openSheet({
    title: "Dokument hinzufügen",
    bodyHTML: `<form class="fields ss-form" novalidate>
      <label class="ss-file">Datei wählen (PDF, Foto, …)<input type="file" id="dc-file" accept="application/pdf,image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"></label>
      <div class="ss-file-info note" id="dc-info">Höchstens 700 kB pro Datei. Fotos werden automatisch verkleinert.</div>
      <label>Titel<input type="text" id="dc-title" maxlength="100" placeholder="z. B. Formelsammlung Elektrotechnik"></label>
      ${subjectInputHTML(S.data, "dc-subj", "")}
      <div class="row"><button type="submit" class="btn primary" id="dc-save" disabled>Speichern</button></div>
    </form>`,
    onMount(el, close) {
      wireSubjectChips(el);
      const info = el.querySelector("#dc-info"), save = el.querySelector("#dc-save");
      el.querySelector("#dc-file").addEventListener("change", async (ev) => {
        const f = ev.target.files && ev.target.files[0];
        prepared = null; save.disabled = true;
        if (!f) return;
        origName = f.name;
        info.classList.remove("ss-err"); info.textContent = "Wird vorbereitet …";
        try {
          prepared = await prepareFile(f);
          info.textContent = `✓ ${f.name} · ${kb(prepared.size)}${prepared.size < f.size ? ` (verkleinert von ${kb(f.size)})` : ""}`;
          const t = el.querySelector("#dc-title");
          if (!t.value.trim()) t.value = f.name.replace(/\.[^.]+$/, "");
          save.disabled = false;
        } catch (err) {
          info.classList.add("ss-err"); info.textContent = err.message || "Datei konnte nicht gelesen werden.";
          ev.target.value = "";
        }
      });
      el.querySelector("form").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        if (!prepared) return;
        const title = el.querySelector("#dc-title").value.trim() || origName || "Dokument";
        const meta = { title, subject: el.querySelector("#dc-subj").value.trim(), type: prepared.type, size: prepared.size, name: origName, date: todayKey(), thumb: prepared.thumb || null };
        save.disabled = true; save.textContent = "Speichert …";
        try {
          const id = newId();
          const fp = putFile(S.ctx, id, prepared.data);
          // lokal warten (schnell), Cloud nicht blockieren (offline wird später hochgeladen)
          if (S.ctx.store.get().mode === "local") await fp; else fp.catch((err) => { console.error(err); S.ctx.ui.toast("Datei-Upload fehlgeschlagen."); });
          safeWrite(col("docs").put({ ...meta, id }));
          S.ctx.ui.toast("Dokument gespeichert");
          close();
        } catch (err) {
          console.error(err);
          save.disabled = false; save.textContent = "Speichern";
          info.classList.add("ss-err"); info.textContent = "Speichern fehlgeschlagen (Speicher voll?).";
        }
      });
    },
  });
}

async function withFile(S, d, fn) {
  try {
    const data = await getFile(S.ctx, d.id);
    if (!data) { S.ctx.ui.toast("Datei nicht gefunden (evtl. noch nicht synchronisiert)."); return; }
    await fn(data);
  } catch (err) {
    console.error(err);
    S.ctx.ui.toast(/offline|unavailable/i.test(String(err && err.message)) ? "Offline – Datei nicht verfügbar." : "Datei konnte nicht geladen werden.");
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function openDoc(S, d) {
  S.ctx.ui.openSheet({
    title: d.title || "Dokument",
    bodyHTML: `<div class="ss-doc-view">
      <p class="note">${d.subject ? `${dot(subjectColor(S.data, d.subject))}${esc(d.subject)} · ` : ""}${esc(fmtDate(d.date))} · ${esc(kb(d.size || 0))}${d.name ? ` · ${esc(d.name)}` : ""}</p>
      <div class="ss-doc-prev" id="dv-prev">${/^image\//.test(d.type || "") ? `<p class="note">Lädt …</p>` : `<div class="ss-doc-big" aria-hidden="true">${kindIcon(d)}</div>`}</div>
      <div class="row">
        <button type="button" class="btn primary" id="dv-open">Öffnen</button>
        <button type="button" class="btn ghost" id="dv-share">Teilen</button>
      </div>
      <label>Titel<input type="text" id="dv-title" maxlength="100" value="${esc(d.title || "")}"></label>
      ${subjectInputHTML(S.data, "dv-subj", d.subject || "")}
      <div class="row"><button type="button" class="btn ghost sm" id="dv-save">Änderungen speichern</button><button type="button" class="btn danger sm" id="dv-del">Löschen</button></div>
    </div>`,
    onMount(el, close) {
      wireSubjectChips(el);
      if (/^image\//.test(d.type || "")) withFile(S, d, (data) => { const p = el.querySelector("#dv-prev"); if (p && SAFE_IMG.test(data)) p.innerHTML = `<img src="${esc(data)}" alt="${esc(d.title || "")}">`; });
      el.querySelector("#dv-open").addEventListener("click", () => withFile(S, d, (data) => {
        const blob = toBlob(data);
        // L1 (Audit 2): nur PDFs und Fotos im Tab öffnen, alles andere herunterladen
        if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(blob.type)) { download(new Blob([blob], { type: OCTET }), fileName(d)); return; }
        const url = URL.createObjectURL(blob);
        const w = window.open(url, "_blank");
        if (!w) download(blob, fileName(d));
        setTimeout(() => URL.revokeObjectURL(url), 120000);
      }));
      el.querySelector("#dv-share").addEventListener("click", () => withFile(S, d, async (data) => {
        const blob = toBlob(data);
        const file = new File([blob], fileName(d), { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: d.title || "Dokument" }); } catch (err) { if (err && err.name !== "AbortError") S.ctx.ui.toast("Teilen nicht möglich."); }
        } else { download(blob, fileName(d)); S.ctx.ui.toast("Teilen nicht verfügbar – Datei wird heruntergeladen."); }
      }));
      el.querySelector("#dv-save").addEventListener("click", () => {
        safeWrite(col("docs").patch(d.id, { title: el.querySelector("#dv-title").value.trim() || d.title, subject: el.querySelector("#dv-subj").value.trim() }));
        S.ctx.ui.toast("Gespeichert"); close();
      });
      armDelete(el.querySelector("#dv-del"), () => {
        delFile(S.ctx, d.id).catch((err) => console.error(err));
        safeWrite(col("docs").remove(d.id));
        S.ctx.ui.toast("Dokument gelöscht"); close();
      });
    },
  });
}

/* ---------- Ansicht ---------- */

export function renderDocs(body, S) {
  const all = [...(S.data.docs || [])].sort((a, b) => (b.created || 0) - (a.created || 0));
  const subjF = S.view.docSubj || "";
  const q = (S.view.docQ || "").toLowerCase();
  const subs = subjects({ docs: all });
  const list = all.filter((d) => (!subjF || d.subject === subjF) && (!q || `${d.title} ${d.subject} ${d.name}`.toLowerCase().includes(q)));
  const total = all.reduce((a, d) => a + (Number(d.size) || 0), 0);
  body.innerHTML = `<div class="ss-toolbar"><p class="note">${all.length ? `${all.length} ${all.length === 1 ? "Dokument" : "Dokumente"} · ${kb(total)}` : "Skripten, Arbeitsblätter, Formelsammlungen."}</p>
      <button type="button" class="btn primary sm" data-act="add-doc">+ Dokument</button></div>
    ${all.length ? `<div class="ss-docbar">
        <input type="search" id="dc-q" placeholder="Suchen …" value="${esc(S.view.docQ || "")}" aria-label="Dokumente suchen">
        ${subs.length > 1 ? `<div class="chips ss-filter"><button type="button" class="chip" data-ds="" aria-pressed="${!subjF}">Alle</button>${subs.map((s) => `<button type="button" class="chip" data-ds="${esc(s)}" aria-pressed="${subjF === s}">${dot(subjectColor(S.data, s))}${esc(s)}</button>`).join("")}</div>` : ""}
      </div>
      ${list.length ? `<ul class="ss-docs">${list.map((d) => `<li><button type="button" class="ss-doc" data-doc="${esc(d.id)}" style="--c:${esc(subjectColor(S.data, d.subject))}">
          <span class="ss-doc-ic">${d.thumb ? `<img src="${esc(d.thumb)}" alt="">` : `<span aria-hidden="true">${kindIcon(d)}</span>`}</span>
          <span class="ss-doc-t"><b>${esc(d.title || "Dokument")}</b><span class="ss-meta">${d.subject ? `${dot(subjectColor(S.data, d.subject))}${esc(d.subject)}` : ""}<span>${esc(fmtDate(d.date))}</span><span>${esc(kb(d.size || 0))}</span></span></span>
        </button></li>`).join("")}</ul>` : `<p class="note">Nichts gefunden.</p>`}`
      : emptyHTML("📚", "📄 Noch keine Dokumente", "PDFs und Fotos von Arbeitsblättern hier ablegen – bis 700 kB pro Datei, Fotos werden automatisch verkleinert.", "Hinzufügen", "add-doc")}`;
  body.querySelectorAll("[data-act=add-doc]").forEach((b) => b.addEventListener("click", () => openUpload(S)));
  body.querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", () => openDoc(S, col("docs").get(b.dataset.doc))));
  body.querySelectorAll("[data-ds]").forEach((b) => b.addEventListener("click", () => { S.view.docSubj = b.dataset.ds; S.rerender(); }));
  const qi = body.querySelector("#dc-q");
  if (qi) qi.addEventListener("input", () => { S.view.docQ = qi.value; S.keepFocus = "#dc-q"; S.rerender(); });
}
