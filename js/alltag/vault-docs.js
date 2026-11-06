// Alltag › Passwort-Tresor › Dokumente (Reisepass, Ausweise, e-card, Zeugnisse …) – Ende-zu-Ende verschlüsselt.
// Eintrag (type "doc") liegt wie alle Tresor-Einträge verschlüsselt in vault_items (Titel, Art, Nummer, Daten, Datei-Metadaten).
// Dateien: mit dem Tresor-Schlüssel (DEK) in Stücken verschlüsselt → vault-files.js. Laden + Entschlüsseln erst beim Öffnen.
// Einzige Ausnahme vom Zero-Knowledge-Prinzip (nur nach Zustimmung im Formular): Ablauf-Erinnerung als normale
// Planer-Aufgabe „Reisepass erneuern – läuft am … ab“ (ohne Titel, Nummer, Bild). Verknüpft über eine Zufalls-ID (remId),
// die nur der verschlüsselte Eintrag kennt.
import * as V from "./vault-crypto.js";
import * as D from "./vault-docs-core.js";
import * as F from "./vault-files.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import * as ui from "../ui.js";
import * as store from "../store.js";

const SHARE_WARN = "Achtung: Die Datei ist dann unverschlüsselt auf dem Gerät";
const PHOTO_HINT = "Dokument flach hinlegen, gutes Licht";

export function injectCSS() {
  if (document.getElementById("vd-css")) return;
  const l = document.createElement("link");
  l.id = "vd-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-vault-docs.css", import.meta.url).href;
  document.head.appendChild(l);
}

const native = () => { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch { return false; } };
const kindOf = (d) => D.DOC_KINDS[d && d.kind] || D.DOC_KINDS.sonstiges;
const sideLabel = (f) => (f.side ? D.SIDES[f.side] : f.mime === "application/pdf" ? "PDF" : "Foto");
const safeName = (s) => String(s || "Dokument").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
const sleepRace = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

/** Wenn ein Sheet zugeht (✕, Hintergrund, Sperren) → fn() */
function onClosed(s, fn) {
  const parent = s.el.parentNode;
  if (!parent) { fn(); return; }
  const obs = new MutationObserver(() => { if (!document.contains(s.el)) { obs.disconnect(); fn(); } });
  obs.observe(parent, { childList: true });
}

/**
 * api: { getKey, getEntry(id), entries(), saveEntry(id, data, prev), removeEntry(id), sheet(opts), track(o), untrack(o),
 *        settle(p, ms), renderBody(), pwField, wireFields, copySecret(text, label), showErr(el, msg), newId() }
 */
export function createDocs(api) {
  injectCSS();
  const urls = new Set();          // alle erzeugten Object-URLs (Klartext im Speicher) → beim Sperren widerrufen
  const thumbs = new Map();        // thumbId → Promise<url>
  let gen = 0;                     // erhöht sich beim Sperren (laufende Ladevorgänge verwerfen)

  function mkUrl(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; }
  function dropUrl(u) { if (u && urls.has(u)) { URL.revokeObjectURL(u); urls.delete(u); } }

  function reset() {
    gen++;
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
    thumbs.clear();
  }

  async function loadBytes(fileId, total) {
    const key = api.getKey();
    if (!key) throw new Error("Tresor ist gesperrt.");
    const chunks = await F.getChunks(fileId, total);
    if (!chunks.length) throw new Error("Datei nicht gefunden (evtl. noch nicht synchronisiert).");
    return V.decryptFile(key, fileId, chunks, total);
  }
  async function loadBlob(meta) {
    const bytes = await loadBytes(meta.id, meta.chunks);
    const b = new Blob([bytes], { type: meta.mime });
    bytes.fill(0);
    return b;
  }

  function thumbUrl(thumbId) {
    if (!thumbId) return Promise.resolve("");
    if (!thumbs.has(thumbId)) {
      const g = gen;
      const p = loadBytes(thumbId, 1).then((bytes) => {
        if (g !== gen) return "";
        const u = mkUrl(new Blob([bytes], { type: "image/jpeg" }));
        bytes.fill(0);
        return u;
      }).catch((e) => { thumbs.delete(thumbId); console.warn("Vorschaubild:", e && e.message); return ""; });
      thumbs.set(thumbId, p);
    }
    return thumbs.get(thumbId);
  }

  /** <img data-thumb> in einem Container nachladen. */
  function hydrate(scope) {
    scope.querySelectorAll("img[data-thumb]:not([data-done])").forEach((img) => {
      img.dataset.done = "1";
      thumbUrl(img.dataset.thumb).then((u) => {
        if (!u || !document.contains(img)) return;
        img.src = u;
        img.hidden = false;
        const ph = img.parentNode && img.parentNode.querySelector(".vd-ph");
        if (ph) ph.hidden = true;
      });
    });
  }

  /* ---------- Bausteine ---------- */

  function bubble(d, size = 42) {
    const k = kindOf(d);
    return `<span class="tr-bub vd-bub" style="--c:${k.color};width:${size}px;height:${size}px" aria-hidden="true">${k.emoji}</span>`;
  }

  function badge(d, { always = false } = {}) {
    const x = D.expiryInfo(d.expires);
    if (x.state === "none" || (!always && x.state === "ok")) return "";
    return `<span class="vd-badge ${x.state}">${esc(x.label)}</span>`;
  }

  const coverOf = (d) => (d.files || []).find((f) => f.thumb && f.side === "front") || (d.files || []).find((f) => f.thumb) || null;

  function cardsHTML(list) {
    if (!list.length) {
      return `<div class="empty tr-empty vd-empty"><span class="vd-empty-ic" aria-hidden="true">🛂</span><h3>🪪 Noch keine Dokumente</h3>` +
        `<p>Reisepass, Personalausweis, Lehrlingsausweis, e-card, Zeugnisse … – Fotos und PDFs, verschlüsselt im Tresor.</p>` +
        `<button type="button" class="btn primary sm" data-tr="newdoc">+ Dokument hinzufügen</button></div>`;
    }
    return `<div class="vd-head"><p class="note">${list.length} ${list.length === 1 ? "Dokument" : "Dokumente"}</p>` +
        `<button type="button" class="btn primary sm" data-tr="newdoc">${icon("plus", 18)} Dokument</button></div>` +
      `<ul class="vd-grid">${list.map((e) => {
        const d = e.data, k = kindOf(d), cov = coverOf(d), n = (d.files || []).length;
        return `<li><button type="button" class="vd-card" data-tr="open" data-id="${esc(e.id)}" style="--c:${k.color}">` +
          `<span class="vd-thumb"><span class="vd-ph">${k.emoji}</span>${cov ? `<img data-thumb="${esc(cov.thumb)}" alt="" hidden>` : ""}` +
            (n ? `<span class="vd-count">${icon("image", 13)} ${n}</span>` : "") + `</span>` +
          `<span class="vd-body"><b>${esc(d.title)}</b><small>${esc(k.label)}${d.expires ? " · bis " + esc(D.fmtKey(d.expires)) : ""}</small>${badge(d, { always: true })}</span>` +
        `</button></li>`;
      }).join("")}</ul>`;
  }

  /* ---------- Teilen/Speichern (mit Warnung) ---------- */

  function download(blob, name) {
    const u = mkUrl(blob);
    const a = document.createElement("a");
    a.href = u; a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => dropUrl(u), 30000);
  }

  function confirmShare(meta, d, extra = "") {
    let blob = null, failed = null;
    const g = gen;
    const ready = loadBlob(meta).then((b) => { if (g === gen) blob = b; }).catch((e) => { failed = e; });
    const s = api.sheet({
      title: "Teilen/Speichern",
      bodyHTML:
        (extra ? `<p class="note">${esc(extra)}</p>` : "") +
        `<div class="tr-warn danger vd-sharewarn">${icon("lock", 22)}<p><b>${esc(SHARE_WARN)}</b> – z. B. in „Downloads“ oder in der App, mit der du teilst. Danach am besten wieder löschen.</p></div>` +
        `<p class="note">${esc(meta.name)} · ${esc(D.fmtSize(meta.size))}</p>` +
        `<p class="tr-err" role="alert" hidden></p>` +
        `<div class="row"><button type="button" class="btn ghost" data-no>Abbrechen</button><button type="button" class="btn danger" data-yes>${icon("share", 18)} Teilen/Speichern</button></div>`,
    });
    s.el.classList.add("vd-share");
    s.el.querySelector("[data-no]").addEventListener("click", () => s.close());
    s.el.querySelector("[data-yes]").addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      if (!blob && !failed) { ui.setBusy(btn, true, "Entschlüssele …"); await ready; ui.setBusy(btn, false); }
      if (failed || !blob) { api.showErr(s.el.querySelector(".tr-err"), (failed && failed.message) || "Datei konnte nicht geladen werden."); return; }
      const name = safeName(meta.name || d.title);
      let file = null;
      try { file = new File([blob], name, { type: meta.mime }); } catch { file = null; }
      if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: d.title || "Dokument" }); s.close(); }
        catch (err) { if (err && err.name === "AbortError") return; download(blob, name); s.close(); }
        return;
      }
      download(blob, name);
      s.close();
      ui.toast("Datei gespeichert (unverschlüsselt) – bitte später löschen.", 3500);
    });
    onClosed(s, () => { blob = null; });
  }

  /* ---------- Öffnen ---------- */

  async function openPdf(meta, d) {
    // Ohne eingebauten PDF-Betrachter (Capacitor-WebView, Chrome am Handy) würde die Blob-URL still als
    // unverschlüsselte Datei heruntergeladen → stattdessen bewusst über „Teilen/Speichern“ (mit Warnung).
    if (native() || navigator.pdfViewerEnabled === false) { confirmShare(meta, d, "Dieses Gerät kann PDFs nicht direkt anzeigen – über „Teilen/Speichern“ in einer PDF-App öffnen."); return; }
    // Fenster sofort (im Klick) öffnen, sonst blockt der Popup-Blocker nach dem Entschlüsseln
    let w = null;
    try { w = window.open("", "_blank"); } catch { w = null; }
    try {
      const blob = await loadBlob(meta);
      const u = mkUrl(blob);
      setTimeout(() => dropUrl(u), 60000);
      if (w && !w.closed) { w.location.href = u; try { w.opener = null; } catch { /* egal */ } }
      else confirmShare(meta, d, "Das PDF-Fenster wurde blockiert.");
    } catch (e) {
      if (w) try { w.close(); } catch { /* egal */ }
      ui.toast(e && e.message || "PDF konnte nicht geöffnet werden.", 3500);
    }
  }

  function openFile(d, idx) {
    const meta = d.files[idx];
    if (!meta) return;
    if (meta.mime === "application/pdf") openPdf(meta, d);
    else openViewer(d, idx);
  }

  /* ---------- Vollbild-Ansicht (Pinch/Zoom per CSS-Transform) ---------- */

  function openViewer(d, startIdx) {
    const imgs = d.files.map((f, i) => [f, i]).filter(([f]) => f.mime !== "application/pdf");
    let pos = Math.max(0, imgs.findIndex(([, i]) => i === startIdx));
    const el = document.createElement("div");
    el.className = "vd-viewer";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Dokument ansehen");
    el.innerHTML =
      `<div class="vd-vbar">` +
        `<button type="button" class="vd-vbtn" data-v="close" aria-label="Schließen">✕</button>` +
        `<span class="vd-vtitle"><b>${esc(d.title)}</b><small></small></span>` +
        `<button type="button" class="vd-vbtn" data-v="share" aria-label="Teilen/Speichern" title="Teilen/Speichern">${icon("share", 22)}</button>` +
      `</div>` +
      `<div class="vd-stage"><img alt="" draggable="false"><p class="vd-vload">Entschlüssele …</p></div>` +
      (imgs.length > 1 ? `<button type="button" class="vd-nav prev" data-v="prev" aria-label="Vorheriges Bild">${icon("chevron-left", 28)}</button><button type="button" class="vd-nav next" data-v="next" aria-label="Nächstes Bild">${icon("chevron-right", 28)}</button>` : "") +
      `<p class="vd-vhint">Mit zwei Fingern zoomen · Doppeltipp = Zoom</p>`;
    document.body.appendChild(el);
    const img = el.querySelector("img"), stage = el.querySelector(".vd-stage"), load = el.querySelector(".vd-vload");
    let cur = null, token = 0;
    let sc = 1, tx = 0, ty = 0;
    const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`; };
    const resetZoom = () => { sc = 1; tx = 0; ty = 0; apply(); };

    async function show() {
      const [f] = imgs[pos];
      const my = ++token;
      el.querySelector(".vd-vtitle small").textContent = `${sideLabel(f)}${imgs.length > 1 ? ` · ${pos + 1}/${imgs.length}` : ""}`;
      load.hidden = false; load.textContent = "Entschlüssele …";
      img.hidden = true;
      resetZoom();
      try {
        const blob = await loadBlob(f);
        if (my !== token || !document.contains(el)) return;
        const u = mkUrl(blob);
        const old = cur; cur = u;
        img.onload = () => { load.hidden = true; img.hidden = false; dropUrl(old); };
        img.src = u;
        img.alt = `${d.title} – ${sideLabel(f)}`;
      } catch (e) {
        if (my === token) load.textContent = (e && e.message) || "Bild konnte nicht geladen werden.";
      }
    }

    const step = (n) => { if (imgs.length < 2) return; pos = (pos + n + imgs.length) % imgs.length; show(); };
    const obj = { close };
    function close() {
      if (!document.contains(el)) return;
      token++;
      el.remove();
      dropUrl(cur); cur = null;
      document.removeEventListener("keydown", onKey, true);
      api.untrack(obj);
    }
    function onKey(e) {
      if (document.querySelector(".sheet.vd-share")) return; // erst die Teilen-Bestätigung schließen
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    }
    document.addEventListener("keydown", onKey, true);
    api.track(obj);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      const a = b.dataset.v;
      if (a === "close") close();
      else if (a === "share") confirmShare(imgs[pos][0], d);
      else if (a === "prev") step(-1);
      else if (a === "next") step(1);
    });

    // Gesten: 2 Finger = Zoom, 1 Finger = verschieben (gezoomt) bzw. wischen (nicht gezoomt)
    const pts = new Map();
    let base = null, lastTap = 0;
    const snap = () => {
      const p = [...pts.values()];
      const c = p.length > 1 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0];
      return { sc, tx, ty, c, dist: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0, n: p.length };
    };
    const clamp = (v) => Math.min(6, Math.max(1, v));
    stage.addEventListener("pointerdown", (e) => {
      try { stage.setPointerCapture(e.pointerId); } catch { /* egal */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      base = snap();
    });
    stage.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId) || !base) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = snap();
      if (now.n >= 2 && base.n >= 2 && base.dist > 0) {
        sc = clamp(base.sc * (now.dist / base.dist));
        tx = base.tx + (now.c.x - base.c.x);
        ty = base.ty + (now.c.y - base.c.y);
      } else if (now.n === 1 && base.n === 1 && base.sc > 1) {
        tx = base.tx + (now.c.x - base.c.x);
        ty = base.ty + (now.c.y - base.c.y);
      }
      apply();
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      const startC = base && base.c;
      const p = pts.get(e.pointerId);
      const wasSingle = base && base.n === 1;
      pts.delete(e.pointerId);
      if (wasSingle && sc === 1 && startC) {
        const dx = p.x - startC.x, dy = p.y - startC.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
        else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
          const t = Date.now();
          if (t - lastTap < 320) { if (sc > 1) resetZoom(); else { sc = 2.5; apply(); } lastTap = 0; } else lastTap = t;
        }
      } else if (wasSingle && sc > 1 && startC && Math.abs(p.x - startC.x) < 8 && Math.abs(p.y - startC.y) < 8) {
        const t = Date.now();
        if (t - lastTap < 320) { resetZoom(); lastTap = 0; } else lastTap = t;
      }
      if (sc <= 1.02) resetZoom();
      base = pts.size ? snap() : null;
    };
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      sc = clamp(sc * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      if (sc === 1) { tx = 0; ty = 0; }
      apply();
    }, { passive: false });
    stage.addEventListener("dblclick", () => { if (sc > 1) resetZoom(); else { sc = 2.5; apply(); } });
    show();
    return obj;
  }

  /* ---------- Ansehen ---------- */

  function reminderLine(d) {
    if (!d.remind || !d.expires) return `<p class="note vd-remline">${icon("calendar", 16)} Keine Erinnerung im Planer.</p>`;
    const ids = new Set(D.reminderIds(d.remId));
    const todos = (store.get().todos || []).filter((t) => ids.has(t.id)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const when = todos.length ? todos.map((t) => D.fmtKey(t.date)).join(" und ") : "";
    return `<p class="note vd-remline">${icon("calendar-check", 16)} Erinnerung im Planer${when ? ": " + esc(when) : " ist eingeschaltet"} (nur Art + Ablaufdatum, unverschlüsselt).</p>`;
  }

  function tilesHTML(d, { edit = false } = {}) {
    return (d.files || []).map((f, i) => {
      const pdf = f.mime === "application/pdf";
      return `<li class="vd-tile${pdf ? " pdf" : ""}">` +
        `<button type="button" class="vd-tile-main" data-file="${i}" aria-label="${esc(sideLabel(f))} öffnen: ${esc(f.name)}">` +
          `<span class="vd-tile-img">${f.thumb ? `<img data-thumb="${esc(f.thumb)}" alt="" hidden>` : ""}<span class="vd-ph">${pdf ? "📄" : "🖼️"}</span></span>` +
          `<span class="vd-tile-t"><b title="${esc(f.name)}">${esc(pdf ? f.name : sideLabel(f))}</b><small>${pdf ? "PDF · " : ""}${esc(D.fmtSize(f.size))}</small></span>` +
        `</button>` +
        (edit ? "" : `<button type="button" class="tr-ib vd-tile-share" data-share="${i}" aria-label="${esc(f.name)} teilen/speichern" title="Teilen/Speichern">${icon("share", 18)}</button>`) +
      `</li>`;
    }).join("");
  }

  function openDetail(id) {
    const e = api.getEntry(id);
    if (!e) return;
    const d = e.data, k = kindOf(d);
    const row = (label, val, extra = "") => `<div class="tr-field"><div><small>${esc(label)}</small><div class="tr-v">${val}</div></div>${extra}</div>`;
    const rows = [
      d.number ? row("Nummer", `<span class="tr-secret" data-k="number">••••••••</span>`,
        `<div class="tr-acts"><button type="button" class="tr-ib" data-reveal="number" aria-label="Nummer anzeigen" aria-pressed="false">${icon("eye", 20)}</button>` +
        `<button type="button" class="tr-ib" data-copy="number" aria-label="Nummer kopieren">${icon("copy", 20)}</button></div>`) : "",
      d.issued ? row("Ausstellungsdatum", esc(D.fmtKey(d.issued))) : "",
      d.expires ? row("Ablaufdatum", `${esc(D.fmtKey(d.expires))} ${badge(d, { always: true })}`) : "",
      d.authority ? row("Ausstellende Behörde", `<span class="tr-val">${esc(d.authority)}</span>`) : "",
    ].join("");
    const body =
      `<div class="tr-dhead">${bubble(d, 44)}<div><b>${esc(k.label)}</b><small>geändert ${esc(D.fmtKey(D.todayKey(new Date(e.updated || Date.now()))))}</small></div>` +
        `<button type="button" class="tr-ib tr-fav" data-fav aria-pressed="${d.fav}" aria-label="${d.fav ? "Kein Favorit mehr" : "Als Favorit markieren"}">${icon("star", 22)}</button></div>` +
      (d.files.length ? `<ul class="vd-tiles">${tilesHTML(d)}</ul>` : `<p class="note">Keine Fotos oder PDFs.</p>`) +
      (rows ? `<div class="tr-fields">${rows}</div>` : "") +
      (d.note ? `<div class="tr-field tr-notefield"><div><small>Notiz</small><div class="tr-note">${esc(d.note)}</div></div></div>` : "") +
      reminderLine(d) +
      `<div class="row tr-drow"><button type="button" class="btn danger sm" data-del>Löschen</button><button type="button" class="btn primary sm" data-edit>${icon("pencil", 18)} Bearbeiten</button></div>`;
    const s = api.sheet({ title: d.title, bodyHTML: body });
    const box = s.el;
    box.classList.add("vd-detail");
    hydrate(box);
    box.querySelectorAll("[data-file]").forEach((b) => b.addEventListener("click", () => openFile(d, Number(b.dataset.file))));
    box.querySelectorAll("[data-share]").forEach((b) => b.addEventListener("click", () => confirmShare(d.files[Number(b.dataset.share)], d)));
    const rv = box.querySelector("[data-reveal]");
    if (rv) rv.addEventListener("click", () => {
      const span = box.querySelector('.tr-secret[data-k="number"]');
      const show = rv.getAttribute("aria-pressed") !== "true";
      span.textContent = show ? d.number : "••••••••";
      span.classList.toggle("shown", show);
      rv.setAttribute("aria-pressed", String(show));
      rv.innerHTML = icon(show ? "eye-off" : "eye", 20);
    });
    const cp = box.querySelector("[data-copy]");
    if (cp) cp.addEventListener("click", () => api.copySecret(d.number, "Nummer"));
    box.querySelector("[data-fav]").addEventListener("click", async (ev) => {
      const b = ev.currentTarget;
      const cur = api.getEntry(id);
      if (!cur) return;
      const fav = !cur.data.fav;
      b.setAttribute("aria-pressed", String(fav));
      try { await api.settle(api.saveEntry(id, { ...cur.data, fav }, cur), 300); } catch { /* Meldung kommt aus settle */ }
      api.renderBody();
    });
    box.querySelector("[data-edit]").addEventListener("click", () => { s.close(); openEditor(id); });
    ui.confirmButton(box.querySelector("[data-del]"), "Wirklich löschen?", async () => {
      s.close();
      const cur = api.getEntry(id);
      await api.removeEntry(id);
      if (cur) await cleanupDoc(cur.data);
      ui.toast("Dokument gelöscht");
    });
  }

  async function cleanupDoc(d) {
    for (const f of d.files || []) {
      try { await F.deleteChunks(f.id, f.chunks); if (f.thumb) await F.deleteChunks(f.thumb, 1); } catch (e) { console.warn("Datei löschen:", e); }
    }
    await syncReminders({ ...d, remind: false }, d.remId);
  }

  /* ---------- Erinnerungen (Planer) ---------- */

  async function syncReminders(doc, prevRemId) {
    const ids = new Set([...D.reminderIds(doc.remId), ...D.reminderIds(prevRemId)]);
    const existing = (store.get().todos || []).filter((t) => ids.has(t.id));
    const { save, remove } = D.reminderDiff(doc, prevRemId, existing);
    try {
      for (const t of save) await sleepRace(store.saveTodo(t), 1500);
      for (const id of remove) await sleepRace(store.deleteTodo(id), 1500);
    } catch (e) {
      console.error("Tresor-Erinnerung:", e);
      ui.toast("Erinnerung konnte nicht gespeichert werden.", 3500);
    }
    return { saved: save.length, removed: remove.length };
  }

  /* ---------- Bearbeiten ---------- */

  function openEditor(id) {
    const prev = id ? api.getEntry(id) : null;
    const d0 = prev ? prev.data : { kind: "reisepass", files: [], remind: false };
    let kind = d0.kind || "reisepass";
    let remindTouched = !!prev;
    let busy = false;
    // Dateiliste: bestehende (meta) + neue (prep, nur im Speicher)
    let files = (d0.files || []).map((m) => ({ key: m.id, meta: m, prep: null, side: m.side, url: "" }));
    const removed = [];

    const v = (k) => esc(d0[k] || "");
    const s = api.sheet({
      title: prev ? "Dokument bearbeiten" : "Neues Dokument",
      bodyHTML:
        `<form class="fields tr-form vd-form" novalidate>` +
          `<div class="vd-kinds" role="group" aria-label="Art">${D.DOC_KIND_IDS.map((x) => `<button type="button" class="chip" data-kind="${x}" aria-pressed="${x === kind}"><span aria-hidden="true">${D.DOC_KINDS[x].emoji}</span> ${esc(D.DOC_KINDS[x].label)}</button>`).join("")}</div>` +
          `<label class="tr-f">Titel<input id="vd-title" type="text" maxlength="120" value="${v("title")}" placeholder="z. B. Reisepass" autocomplete="off"></label>` +
          `<section class="vd-files" aria-label="Fotos und PDFs">` +
            `<div class="vd-files-h"><b>Fotos &amp; PDFs</b><small>Vorder- und Rückseite, mehrere möglich</small></div>` +
            `<ul class="vd-tiles vd-edit-tiles"></ul>` +
            `<div class="vd-add">` +
              `<label class="btn ghost sm vd-pick">${icon("image", 18)} Foto aufnehmen<input type="file" id="vd-cam" accept="image/*" capture="environment" hidden></label>` +
              `<label class="btn ghost sm vd-pick">${icon("upload", 18)} Datei wählen<input type="file" id="vd-pick" accept="image/*,application/pdf,.pdf" multiple hidden></label>` +
            `</div>` +
            `<p class="note vd-hint">📸 ${esc(PHOTO_HINT)}. Fotos werden verkleinert (max. 2000 px), PDFs bis 5 MB. Alles wird vor dem Speichern verschlüsselt.</p>` +
            `<p class="tr-err vd-ferr" role="alert" hidden></p>` +
          `</section>` +
          `<label class="tr-f">Nummer (optional)<input id="vd-number" type="text" maxlength="60" value="${v("number")}" autocomplete="off" autocapitalize="characters" spellcheck="false" class="vd-mono"></label>` +
          `<div class="vd-dates">` +
            `<label class="tr-f">Ausstellungsdatum<input id="vd-issued" type="date" value="${v("issued")}"></label>` +
            `<label class="tr-f">Ablaufdatum<input id="vd-expires" type="date" value="${v("expires")}"></label>` +
          `</div>` +
          `<div class="vd-remind">` +
            `<label class="tr-check"><input type="checkbox" id="vd-remind"${d0.remind ? " checked" : ""}><span>${icon("calendar", 16)} Erinnern vor Ablauf</span></label>` +
            `<p class="vd-remnote" id="vd-remnote"></p>` +
          `</div>` +
          `<label class="tr-f">Ausstellende Behörde<input id="vd-authority" type="text" maxlength="120" value="${v("authority")}" placeholder="z. B. BH Graz-Umgebung, WKO" autocomplete="off"></label>` +
          `<label class="tr-f">Notiz<textarea id="vd-note" rows="3" spellcheck="false">${v("note")}</textarea></label>` +
          `<label class="tr-check"><input type="checkbox" id="vd-fav"${d0.fav ? " checked" : ""}><span>${icon("star", 16)} Favorit (oben anzeigen)</span></label>` +
        `</form>` +
        `<p class="tr-err vd-err" role="alert" hidden></p>` +
        `<div class="row"><button type="button" class="btn primary" data-save>Speichern</button></div>`,
    });
    const box = s.el;
    box.classList.add("vd-editor");
    const $ = (sel) => box.querySelector(sel);
    const title = $("#vd-title"), exp = $("#vd-expires"), rem = $("#vd-remind"), remNote = $("#vd-remnote");
    if (prev) title.dataset.touched = "1";
    else if (!title.value) title.value = D.DOC_KINDS[kind].label;
    title.addEventListener("input", () => { title.dataset.touched = "1"; });

    const drawRemind = () => {
      const has = !!exp.value;
      if (has && !remindTouched) rem.checked = true;
      rem.disabled = !has;
      if (!has) rem.checked = false;
      $(".vd-remind").classList.toggle("off", !has);
      remNote.textContent = has ? D.reminderNotice(kind, exp.value) : "Erst ein Ablaufdatum eintragen, dann kann der Planer rechtzeitig erinnern (3 und 1 Monat vorher).";
    };
    exp.addEventListener("input", drawRemind);
    exp.addEventListener("change", drawRemind);
    rem.addEventListener("change", () => { remindTouched = true; });
    drawRemind();

    box.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
      const was = D.DOC_KINDS[kind].label;
      kind = b.dataset.kind;
      box.querySelectorAll("[data-kind]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.kind === kind)));
      if (!title.dataset.touched || title.value === was) { title.value = D.DOC_KINDS[kind].label; delete title.dataset.touched; }
      drawRemind();
    }));

    const tilesEl = $(".vd-edit-tiles");
    function drawFiles() {
      tilesEl.innerHTML = files.map((f, i) => {
        const m = f.meta || f.prep;
        const pdf = m.mime === "application/pdf";
        const thumb = f.url ? `<img src="${esc(f.url)}" alt="">` : f.meta && f.meta.thumb ? `<img data-thumb="${esc(f.meta.thumb)}" alt="" hidden>` : "";
        return `<li class="vd-tile vd-etile${pdf ? " pdf" : ""}">` +
          `<span class="vd-tile-img">${thumb}<span class="vd-ph"${f.url ? " hidden" : ""}>${pdf ? "📄" : "🖼️"}</span></span>` +
          `<span class="vd-tile-t">` +
            (pdf ? `<b title="${esc(m.name)}">${esc(m.name)}</b>` :
              `<select data-side="${i}" aria-label="Seite">${Object.entries(D.SIDES).map(([k2, l]) => `<option value="${k2}"${(f.side || "") === k2 ? " selected" : ""}>${esc(l === "–" ? "Foto" : l)}</option>`).join("")}</select>`) +
            `<small>${esc(D.fmtSize(m.size))}${f.prep ? " · neu" : ""}</small></span>` +
          `<button type="button" class="tr-ib vd-rm" data-rm="${i}" aria-label="Datei entfernen" title="Entfernen">✕</button>` +
        `</li>`;
      }).join("");
      hydrate(tilesEl);
      $(".vd-files").classList.toggle("has", files.length > 0);
    }
    tilesEl.addEventListener("change", (ev) => { const sel = ev.target.closest("[data-side]"); if (sel) files[Number(sel.dataset.side)].side = sel.value; });
    tilesEl.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-rm]");
      if (!b) return;
      const [f] = files.splice(Number(b.dataset.rm), 1);
      if (f.meta) removed.push(f.meta);
      if (f.prep) wipePrep(f);
      drawFiles();
    });
    drawFiles();

    const ferr = $(".vd-ferr");
    async function addFiles(list) {
      ferr.hidden = true;
      const errs = [];
      for (const file of list) {
        if (files.length >= D.MAX_FILES) { errs.push(`Höchstens ${D.MAX_FILES} Dateien pro Dokument.`); break; }
        try {
          const prep = await F.prepareFile(file);
          const imgs = files.filter((f) => (f.meta || f.prep).mime !== "application/pdf").length;
          const side = prep.kind === "image" ? (imgs === 0 ? "front" : imgs === 1 ? "back" : "page") : "";
          const url = prep.thumb ? mkUrl(new Blob([prep.thumb], { type: "image/jpeg" })) : "";
          files.push({ key: "n" + Math.random().toString(36).slice(2), meta: null, prep, side, url });
          drawFiles();
        } catch (e) { errs.push(e && e.message || "Datei konnte nicht gelesen werden."); }
      }
      if (errs.length) api.showErr(ferr, errs.join(" "));
    }
    for (const inpId of ["#vd-cam", "#vd-pick"]) {
      const inp = $(inpId);
      inp.addEventListener("change", async () => {
        const list = [...(inp.files || [])];
        if (!list.length) return;
        const lbls = box.querySelectorAll(".vd-pick");
        lbls.forEach((l) => l.classList.add("busy"));
        await addFiles(list);
        inp.value = ""; // Original-Datei nicht im Formular behalten
        lbls.forEach((l) => l.classList.remove("busy"));
      });
    }

    function wipePrep(f) {
      if (f.prep) { try { f.prep.bytes.fill(0); if (f.prep.thumb) f.prep.thumb.fill(0); } catch { /* egal */ } f.prep = null; }
      dropUrl(f.url); f.url = "";
    }
    onClosed(s, () => { if (!busy) for (const f of files) if (f.prep) wipePrep(f); else dropUrl(f.url); });

    $("form").addEventListener("submit", (ev) => { ev.preventDefault(); $("[data-save]").click(); });
    $("[data-save]").addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      const err = $(".vd-err");
      const key = api.getKey();
      if (!key) return;
      const t = title.value.trim() || D.DOC_KINDS[kind].label;
      if (exp.value && $("#vd-issued").value && exp.value < $("#vd-issued").value) { api.showErr(err, "Das Ablaufdatum liegt vor dem Ausstellungsdatum."); return; }
      err.hidden = true;
      busy = true;
      ui.setBusy(btn, true, "Verschlüssele …");
      const written = [];
      try {
        const metas = [];
        const fresh = files.filter((f) => f.prep).length;
        let n = 0;
        for (const f of files) {
          if (f.meta) { metas.push({ ...f.meta, side: f.side || "" }); continue; }
          n++;
          btn.textContent = fresh > 1 ? `Verschlüssele ${n}/${fresh} …` : "Verschlüssele …";
          const p = f.prep;
          const fid = V.newFileId();
          const chunks = await V.encryptFile(key, fid, p.bytes);
          let tid = null, tchunks = [];
          if (p.thumb) { tid = V.newFileId(); tchunks = await V.encryptFile(key, tid, p.thumb); }
          await F.putChunks([...chunks, ...tchunks]);
          written.push({ id: fid, chunks: chunks.length }, ...(tid ? [{ id: tid, chunks: 1 }] : []));
          metas.push({ id: fid, name: p.name, mime: p.mime, size: p.size, chunks: chunks.length, enc: V.storedSize(chunks), w: p.w, h: p.h, side: f.side || "", thumb: tid, thumbEnc: V.storedSize(tchunks) });
          wipePrep(f);
          f.meta = metas[metas.length - 1];
        }
        btn.textContent = "Speichern …";
        const wantRemind = !!(rem.checked && exp.value);
        const remId = d0.remId || (wantRemind ? V.newFileId().slice(0, 20) : "");
        const data = {
          type: "doc", title: t, kind, number: $("#vd-number").value, issued: $("#vd-issued").value, expires: exp.value,
          authority: $("#vd-authority").value, note: $("#vd-note").value, fav: $("#vd-fav").checked, category: d0.category || "",
          files: metas, remind: wantRemind, remId,
        };
        const newIdv = prev ? prev.id : api.newId();
        await api.settle(api.saveEntry(newIdv, data, prev), 1500);
        for (const m of removed) { F.deleteChunks(m.id, m.chunks).catch(() => {}); if (m.thumb) F.deleteChunks(m.thumb, 1).catch(() => {}); }
        const saved = api.getEntry(newIdv);
        const r = await syncReminders(saved ? saved.data : data, d0.remId);
        busy = false;
        s.close();
        api.renderBody();
        ui.toast((prev ? "Gespeichert" : "Dokument angelegt") + (r.saved && wantRemind ? " · Erinnerung im Planer" : r.removed ? " · Erinnerung entfernt" : ""), 2600);
      } catch (e2) {
        console.error("Dokument speichern:", e2);
        // schon hochgeladene neue Stücke wieder entfernen (sonst verwaist)
        for (const w of written) F.deleteChunks(w.id, w.chunks).catch(() => {});
        for (const f of files) if (f.meta && written.some((w) => w.id === f.meta.id)) f.meta = null;
        files = files.filter((f) => f.meta || f.prep);
        drawFiles();
        busy = false;
        ui.setBusy(btn, false);
        api.showErr(err, "Speichern fehlgeschlagen: " + (e2 && e2.message || e2) + (written.length ? " – bitte die neuen Dateien erneut hinzufügen." : ""));
      }
    });
  }

  return { openEditor, openDetail, cardsHTML, hydrate, bubble, badge, reset, cleanupDoc, syncReminders };
}
