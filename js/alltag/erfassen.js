// Update 15 – Alltag › 📸 Erfassen (#alltag/erfassen): QR-/Barcode-Scanner (Kamera, BarcodeDetector), Dokumentenscanner &
// Bild → PDF (mehrere Seiten, drehen, Dokument-Filter), Teilen-Eingang (Bilder/PDFs/Text aus anderen Apps über das
// Android-Teilen-Menü, wenn die App installiert ist). Logik: ./scan-core.js, ../pdf-core.js.
// Sicherheit: Gescannte oder geteilte Inhalte lösen NIE automatisch etwas aus – es gibt nur Vorschläge (Knöpfe).
import { collection } from "./db.js";
import * as SC from "./scan-core.js";
import { makePdf } from "../pdf-core.js";
import * as Inbox from "../inbox.js";
import * as U from "./xui.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const SHARE_CACHE = "sk-share-v1";
const buzz = (ms = 35) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* egal */ } };
const canDetect = () => typeof window.BarcodeDetector === "function";
const canCam = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

export function mount(el, ctx) {
  U.loadCss("extras"); U.loadCss("erfassen");
  const S = { tab: /share=1/.test(location.hash) ? "geteilt" : (U.lsGet("sk-erf-tab") || "scan"), result: null, pages: [], shared: null, busy: false };
  let alive = true, stream = null, timer = null, det = null;
  const col = { vorrat: collection("vorrat"), einkauf: collection("einkauf"), material: collection("material_items"), notes: collection("notes") };

  /* ================================================================= Rendern */
  function render() {
    if (!alive) return;
    stopCam();
    const tabs = [["scan", "📷", "Code scannen"], ["pdf", "📄", "Dokument → PDF"], ...(S.shared ? [["geteilt", "📥", "Geteilt"]] : [])];
    el.innerHTML = `<div class="xu ef">${U.tabsHTML(tabs, S.tab)}${S.tab === "pdf" ? pdfHTML() : S.tab === "geteilt" && S.shared ? sharedHTML() : scanHTML()}</div>`;
    if (S.tab === "scan" && !S.result) startCam();
  }

  /* ----------------------------------------------------------------- Scanner */
  function scanHTML() {
    if (S.result) return resultHTML(S.result);
    return `${canDetect() && canCam() ? `<div class="ef-cam"><video playsinline muted autoplay aria-label="Kamerabild"></video><span class="ef-frame" aria-hidden="true"></span></div>
        <p class="note ef-st" aria-live="polite">Kamera wird gestartet …</p>`
      : `<section class="card"><p>📱 Dieser Browser kann nicht selbst scannen. In Chrome auf Android und in der Stempelkarte-App geht's. Du kannst aber ein <b>Foto eines Codes</b> wählen oder den Text einfügen.</p></section>`}
      <div class="xu-row"><label class="btn ghost sm">🖼️ Code aus Foto<input type="file" accept="image/*" data-ef="codeimg" hidden></label><button type="button" class="btn ghost sm" data-x="manual">⌨️ Eingeben</button></div>
      <p class="note">Erkennt QR-Codes (auch die Sticker von Werkzeug und Baustellen), Strichcodes auf Produkten (EAN), Links, Telefonnummern und WLAN-Codes.</p>`;
  }
  function resultHTML(r) {
    const A = {
      open: `<button type="button" class="btn primary" data-r="open">➡️ In der App öffnen</button>`,
      vorrat: `<button type="button" class="btn primary" data-r="vorrat">🥫 In den Vorrat</button>`,
      einkauf: `<button type="button" class="btn ghost" data-r="einkauf">🛒 Auf die Einkaufsliste</button>`,
      material: `<button type="button" class="btn ghost" data-r="material">🧱 Als Material (Baustelle)</button>`,
      lookup: r.name ? "" : `<button type="button" class="btn ghost" data-r="lookup">🔎 Produktname nachschlagen</button>`,
      openurl: `<button type="button" class="btn primary" data-r="openurl">↗️ Öffnen</button>`,
      copy: `<button type="button" class="btn ghost" data-r="copy">📋 Kopieren</button>`,
      copypass: `<button type="button" class="btn primary" data-r="copypass">📋 WLAN-Passwort kopieren</button>`,
      note: `<button type="button" class="btn primary" data-r="note">📝 Als Notiz</button>`,
    };
    return `<section class="card ef-res"><small>${esc(r.label)}</small><b class="ef-val">${esc(r.name || r.value)}</b>${r.name ? `<small>Code ${esc(r.value)}</small>` : ""}
      ${r.kind === "url" ? `<p class="note">⚠️ Fremder Link – nur öffnen, wenn du der Quelle vertraust.</p>` : ""}
      <div class="ef-acts">${r.actions.map((a) => A[a] || "").join("")}</div></section>
      <button type="button" class="btn ghost sm" data-x="again">📷 Nochmal scannen</button>`;
  }
  function onCode(raw, format) {
    const r = SC.classify(raw, { appBase: location.href.replace(/[?#].*$/, ""), format });
    if (!r) return false;
    buzz(); stopCam(); S.result = r; render();
    return true;
  }
  async function startCam() {
    if (!canDetect() || !canCam()) return;
    const video = el.querySelector(".ef-cam video"), st = el.querySelector(".ef-st");
    if (!video) return;
    try {
      const fm = window.BarcodeDetector.getSupportedFormats ? await window.BarcodeDetector.getSupportedFormats() : ["qr_code", "ean_13", "ean_8"];
      det = new window.BarcodeDetector({ formats: fm.filter((f) => f !== "unknown") });
    } catch { if (st) st.textContent = "Scanner geht hier leider nicht. 🤔"; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (!alive || !video.isConnected) { stopCam(); return; }
      video.srcObject = stream; video.play().catch(() => {});
      if (st) st.textContent = "Halte den Code ins Bild 🎯";
      const loop = async () => {
        if (!alive || !stream || !video.isConnected) return;
        try { if (video.readyState >= 2) { const codes = await det.detect(video); if (codes && codes[0] && onCode(codes[0].rawValue, codes[0].format)) return; } } catch { /* nächster Versuch */ }
        timer = setTimeout(loop, 200);
      };
      loop();
    } catch (err) {
      if (st) st.textContent = err && err.name === "NotAllowedError" ? "📷 Kamera-Zugriff wurde nicht erlaubt. Du kannst ihn in den Browser-/App-Einstellungen freigeben – oder ein Foto wählen." : "Kamera nicht verfügbar – wähl ein Foto des Codes.";
    }
  }
  function stopCam() { if (timer) { clearTimeout(timer); timer = null; } if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }
  async function codeFromImage(file) {
    if (!canDetect()) { ui.toast("Dieser Browser kann keine Codes erkennen 🙈"); return; }
    try {
      let src = file;
      try { src = await createImageBitmap(file); } catch { /* manche Formate → Datei direkt an den Scanner geben */ }
      const d = new window.BarcodeDetector();
      const codes = await d.detect(src);
      if (!codes.length || !onCode(codes[0].rawValue, codes[0].format)) ui.toast("Kein Code im Bild gefunden 🤔");
    } catch { ui.toast("Bild konnte nicht gelesen werden."); }
  }
  async function resultAction(a) {
    const r = S.result; if (!r) return;
    const name = r.name || "";
    if (a === "open") { location.hash = r.hash; return; }
    if (a === "openurl") { window.open(r.url, "_blank", "noopener,noreferrer"); return; }
    if (a === "copy") { copy(r.value); return; }
    if (a === "copypass") { copy(r.secret || ""); return; }
    if (a === "lookup") {
      ui.toast("🔎 Suche bei Open Food Facts …", 1500);
      try {
        const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(r.value)}.json?fields=product_name,product_name_de,generic_name,generic_name_de,brands,quantity`);
        const n = SC.offName(await res.json());
        if (n) { S.result = { ...r, name: n }; render(); } else ui.toast("Produkt nicht gefunden – du kannst den Namen selbst eintippen.");
      } catch { ui.toast("Nachschlagen hat nicht geklappt (offline?)."); }
      return;
    }
    if (a === "note") { U.form({ title: "📝 Als Notiz", fields: [{ id: "title", label: "Titel", value: "Gescannt" }, { id: "text", label: "Text", type: "textarea", rows: 5, max: 2000, value: r.value }], onSave: (v) => { const now = Date.now(); U.safe(col.notes.put({ title: v.title, text: v.text, tags: ["gescannt"], created: now, updated: now }), "📝 Notiz gespeichert"); } }); return; }
    if (a === "einkauf" && r.kind === "text") { const items = SC.linesToItems(r.value); return saveShop(items.map((n) => ({ name: n }))); }
    const target = { vorrat: "🥫 Vorrat", einkauf: "🛒 Einkaufsliste", material: "🧱 Material" }[a];
    if (!target) return;
    U.form({ title: target, fields: [{ id: "name", label: "Bezeichnung", value: name, placeholder: "z. B. Vollmilch 1 l" }, { id: "qty", label: "Menge", type: "number", value: "1" }],
      note: name ? "" : "Tipp: „Produktname nachschlagen“ füllt das Feld automatisch.",
      onSave: (v) => {
        if (!v.name) { ui.toast("Bitte eine Bezeichnung."); return false; }
        const qty = Number(String(v.qty).replace(",", ".")) || 1, now = Date.now();
        if (a === "vorrat") {
          const ex = col.vorrat.all().find((x) => x && (x.ean === r.value || String(x.name || "").toLowerCase() === v.name.toLowerCase()));
          return U.safe(col.vorrat.put(ex ? { ...ex, qty: (Number(ex.qty) || 0) + qty, ean: r.value, updated: now } : { name: v.name, qty, unit: "Stk", place: "speis", ean: r.value, updated: now }), ex ? `🥫 ${v.name}: +${qty}` : "🥫 Im Vorrat ✓");
        }
        if (a === "einkauf") return saveShop([{ name: v.name, qty }]);
        return U.safe(col.material.put({ name: v.name, qty, unit: "Stk", status: "brauche", note: `EAN ${r.value}`, created: now }), "🧱 Material eingetragen");
      } });
  }
  function saveShop(items) {
    if (!items.length) { ui.toast("Nichts zum Eintragen gefunden."); return; }
    const now = Date.now();
    return U.safe(Promise.all(items.map((x) => col.einkauf.put({ listId: "privat", name: x.name.slice(0, 80), qty: x.qty || 1, unit: "Stk", cat: "sonstiges", done: false, created: now }))), `🛒 ${items.length} auf der Einkaufsliste`);
  }
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => ui.toast("📋 Kopiert")).catch(() => ui.toast("Kopieren nicht möglich"));

  /* ----------------------------------------------------------------- Dokument → PDF */
  function pdfHTML() {
    return `<section class="card"><p class="note">Fotografier Seiten (Rechnung, Lieferschein, Zettel …) oder wähl Bilder/Screenshots – daraus wird ein PDF. Der Dokument-Filter macht das Papier weiß und die Schrift kräftig.</p>
      <div class="xu-row"><label class="btn primary sm">📷 Seite fotografieren<input type="file" accept="image/*" capture="environment" data-ef="page" hidden></label><label class="btn ghost sm">🖼️ Bilder wählen<input type="file" accept="image/*" multiple data-ef="pages" hidden></label></div></section>
      ${S.pages.length ? `<ul class="ef-pages">${S.pages.map((p, i) => `<li><img src="${p.url}" alt="Seite ${i + 1}"><div class="ef-pact"><b>${i + 1}</b>
          <button type="button" class="btn ghost sm" data-pg="rot" data-i="${i}" aria-label="Seite ${i + 1} drehen">↻</button>
          <button type="button" class="btn ghost sm${p.doc ? " on" : ""}" data-pg="doc" data-i="${i}" aria-pressed="${p.doc}" aria-label="Dokument-Filter für Seite ${i + 1}">📄</button>
          ${i ? `<button type="button" class="btn ghost sm" data-pg="up" data-i="${i}" aria-label="Seite ${i + 1} nach vorne">↑</button>` : ""}
          <button type="button" class="btn ghost sm" data-pg="del" data-i="${i}" aria-label="Seite ${i + 1} entfernen">🗑️</button></div></li>`).join("")}</ul>
        <section class="card"><label class="fields">Name<input id="ef-name" value="${esc(S.pdfName || `Scan ${new Date().toLocaleDateString("de-AT")}`)}" maxlength="80"></label>
        <div class="ef-acts"><button type="button" class="btn primary" data-x="todocs">🔒 In Dokumente speichern</button><button type="button" class="btn ghost" data-x="share">📤 Teilen</button><button type="button" class="btn ghost" data-x="download">⬇️ Herunterladen</button></div>
        <p class="note">${S.pages.length} ${S.pages.length === 1 ? "Seite" : "Seiten"} · Dokumente werden verschlüsselt gespeichert.</p></section>`
      : `<p class="note">Noch keine Seiten.</p>`}`;
  }
  async function addPages(files) {
    for (const f of [...files].slice(0, 30)) {
      try { const p = await loadPage(f); S.pages.push(p); } catch { ui.toast(`„${f.name || "Bild"}“ konnte nicht gelesen werden.`); }
    }
    buzz(); render();
  }
  async function loadPage(file) {
    const bmp = await createImageBitmap(file);
    const p = { bmp, rot: 0, doc: true, url: "" };
    p.url = await renderPage(p, 360, 0.7, "dataurl");
    return p;
  }
  /** Seite zeichnen (Drehung + optional Dokument-Filter) → dataURL oder JPEG-Bytes. */
  async function renderPage(p, max = 1700, q = 0.78, out = "bytes") {
    const rotated = p.rot % 180 !== 0;
    const sw = p.bmp.width, sh = p.bmp.height, k = Math.min(1, max / Math.max(sw, sh));
    const w = Math.round((rotated ? sh : sw) * k), h = Math.round((rotated ? sw : sh) * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
    g.translate(w / 2, h / 2); g.rotate((p.rot * Math.PI) / 180);
    g.drawImage(p.bmp, (-sw * k) / 2, (-sh * k) / 2, sw * k, sh * k);
    if (p.doc) docFilter(g, w, h);
    if (out === "dataurl") return c.toDataURL("image/jpeg", q);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", q));
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), w, h };
  }
  /** Dokument-Filter: Graustufen + Kontrast strecken (helle Ränder → weiß, Schrift → dunkel). */
  function docFilter(g, w, h) {
    const img = g.getImageData(0, 0, w, h), d = img.data, hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; }
    const n = w * h; let lo = 0, hi = 255, acc = 0;
    for (; lo < 255 && (acc += hist[lo]) < n * 0.02; lo++);
    acc = 0; for (; hi > 0 && (acc += hist[hi]) < n * 0.25; hi--); // Papier ≈ obere 25 % → weiß
    const span = Math.max(30, hi - lo);
    for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)); d[i] = d[i + 1] = d[i + 2] = v; }
    g.putImageData(img, 0, 0);
  }
  async function buildPdf() {
    if (!S.pages.length) return null;
    ui.toast("📄 PDF wird erstellt …", 1500);
    const name = (el.querySelector("#ef-name") || {}).value || "Scan";
    S.pdfName = name;
    let q = 0.78, max = 1700, bytes;
    for (let tries = 0; tries < 4; tries++) {
      const pages = []; for (const p of S.pages) pages.push(await renderPage(p, max, q));
      bytes = makePdf(pages, { title: name });
      if (bytes.length <= 9.5 * 1024 * 1024) break;
      q = Math.max(0.5, q - 0.1); max = Math.round(max * 0.8); // zu groß fürs Dokumente-Limit (10 MB) → verkleinern
    }
    const fname = `${name.replace(/[^\wäöüÄÖÜß .-]+/g, "").trim() || "Scan"}.pdf`;
    return new File([bytes], fname, { type: "application/pdf" });
  }

  /* ----------------------------------------------------------------- Geteilt (Android-Teilen-Menü → PWA) */
  async function loadShared() {
    try {
      if (!("caches" in window)) return;
      const c = await caches.open(SHARE_CACHE), m = await c.match("share/meta");
      if (!m) return;
      const meta = await m.json(), files = [];
      for (let i = 0; i < (meta.files || []).length; i++) { const r = await c.match(`share/file-${i}`); if (r) files.push(new File([await r.blob()], meta.files[i].name || `Datei-${i + 1}`, { type: meta.files[i].type || "application/octet-stream" })); }
      S.shared = { title: meta.title || "", text: [meta.text, meta.url].filter(Boolean).join("\n"), files };
      S.tab = "geteilt";
      render();
    } catch (err) { console.warn("Geteilt lesen:", err); }
  }
  async function clearShared() { S.shared = null; try { await caches.delete(SHARE_CACHE); } catch { /* egal */ } S.tab = "scan"; render(); }
  function sharedHTML() {
    const sh = S.shared, imgs = sh.files.filter((f) => /^image\//.test(f.type)), others = sh.files.filter((f) => !/^image\//.test(f.type));
    return `<section class="card"><b>📥 Aus einer anderen App geteilt</b>
      ${sh.text ? `<p class="ef-shtext">${esc(sh.text).slice(0, 600)}</p><div class="ef-acts"><button type="button" class="btn primary sm" data-s="note">📝 Als Notiz</button><button type="button" class="btn ghost sm" data-s="shop">🛒 Zeilen auf die Einkaufsliste</button>${/^https?:\/\//m.test(sh.text) ? `<button type="button" class="btn ghost sm" data-s="scanurl">🔗 Als Link behandeln</button>` : ""}</div>` : ""}
      ${imgs.length ? `<p>${imgs.length} ${imgs.length === 1 ? "Bild" : "Bilder"}</p><div class="ef-acts"><button type="button" class="btn primary sm" data-s="topdf">📄 Als PDF</button><button type="button" class="btn ghost sm" data-s="gallery">🖼️ In die Galerie</button><button type="button" class="btn ghost sm" data-s="imgdocs">🔒 In Dokumente</button><button type="button" class="btn ghost sm" data-s="code">📷 Code im Bild suchen</button></div>` : ""}
      ${others.length ? `<p>${others.map((f) => esc(f.name)).join(", ")}</p><div class="ef-acts"><button type="button" class="btn primary sm" data-s="filedocs">🔒 In Dokumente</button></div>` : ""}
      </section><button type="button" class="btn ghost sm" data-s="clear">✕ Verwerfen</button>`;
  }
  async function sharedAction(a) {
    const sh = S.shared; if (!sh) return;
    const imgs = sh.files.filter((f) => /^image\//.test(f.type)), others = sh.files.filter((f) => !/^image\//.test(f.type));
    if (a === "clear") return clearShared();
    if (a === "note") { S.result = { value: [sh.title, sh.text].filter(Boolean).join("\n") }; return resultAction("note"); }
    if (a === "shop") return saveShop(SC.linesToItems(sh.text).map((n) => ({ name: n })));
    if (a === "scanurl") { const u = (/https?:\/\/\S+/.exec(sh.text) || [])[0]; if (u) { S.tab = "scan"; onCode(u); } return; }
    if (a === "topdf") { S.tab = "pdf"; await addPages(imgs); return; }
    if (a === "code") { if (imgs[0]) { S.tab = "scan"; render(); codeFromImage(imgs[0]); } return; }
    if (a === "gallery") {
      try { const P = await import("../photos.js"); for (const f of imgs) await P.addPhoto(f, { note: "Geteilt" }); ui.toast(`🖼️ ${imgs.length} in der Galerie`); } catch { ui.toast("Galerie-Speichern hat nicht geklappt."); }
      return;
    }
    if (a === "imgdocs" || a === "filedocs") {
      const f = a === "imgdocs" ? imgs[0] : others[0]; if (!f) return;
      if ((a === "imgdocs" ? imgs : others).length > 1) ui.toast("Es wird die erste Datei übernommen – für mehrere Bilder nimm „Als PDF“.", 3500);
      Inbox.put("dokumente", f); location.hash = "alltag/dokumente";
    }
  }

  /* ================================================================= Ereignisse */
  el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button"); if (!b || !el.contains(b)) return;
    const d = b.dataset;
    if (d.tab) { S.tab = d.tab; if (d.tab !== "geteilt") U.lsSet("sk-erf-tab", d.tab); render(); return; }
    if (d.r) { resultAction(d.r); return; }
    if (d.s) { sharedAction(d.s); return; }
    if (d.pg) {
      const i = Number(d.i), p = S.pages[i]; if (!p) return;
      if (d.pg === "del") S.pages.splice(i, 1);
      else if (d.pg === "up" && i > 0) [S.pages[i - 1], S.pages[i]] = [S.pages[i], S.pages[i - 1]];
      else { if (d.pg === "rot") p.rot = (p.rot + 90) % 360; else p.doc = !p.doc; p.url = await renderPage(p, 360, 0.7, "dataurl"); }
      const n = el.querySelector("#ef-name"); if (n) S.pdfName = n.value;
      render(); return;
    }
    switch (d.x) {
      case "again": S.result = null; render(); break;
      case "manual": U.form({ title: "⌨️ Code eingeben", fields: [{ id: "t", label: "Code, Link oder Text", type: "textarea", rows: 3, max: 2000 }], onSave: (v) => { if (!v.t) return false; onCode(v.t); } }); break;
      case "todocs": { const f = await buildPdf(); if (f) { Inbox.put("dokumente", f); S.pages = []; location.hash = "alltag/dokumente"; } break; }
      case "share": {
        const f = await buildPdf(); if (!f) break;
        if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: f.name }); } catch { /* abgebrochen */ } }
        else { ui.toast("Teilen geht hier nicht – ich lade die Datei herunter."); download(f); }
        break;
      }
      case "download": { const f = await buildPdf(); if (f) download(f); break; }
      default: break;
    }
  });
  el.addEventListener("change", (ev) => {
    const t = ev.target; if (!t.dataset || !t.dataset.ef) return;
    const files = t.files ? [...t.files] : []; t.value = "";
    if (!files.length) return;
    if (t.dataset.ef === "codeimg") codeFromImage(files[0]);
    else addPages(files);
  });
  function download(f) { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

  render();
  loadShared();
  return () => { alive = false; stopCam(); };
}
