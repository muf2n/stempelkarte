// Update 10 – Alltag › 🧰 Werkzeug-Register (#alltag/werkzeug, Detail: #alltag/werkzeug/<id>).
// Werkzeuge mit Kategorie, Hersteller/Modell, Seriennummer, Foto, Standort (Firma/Auto/Baustelle), Ausgabe/Rückgabe mit Verlauf,
// Prüf-/Wartungsintervall mit Status, Defektmeldung, Notizen. QR-Sticker je Werkzeug (Einzel + Druckbogen),
// Scanner mit BarcodeDetector + Kamera (sonst Hinweis auf die Kamera-App). Reine Logik: ./werkzeug-core.js
// Sammlung „werkzeug“; Fotos in der Unterwegs-Bildablage (travel_images, ID "tool_<id>").
import { collection } from "./db.js";
import * as W from "./werkzeug-core.js";
import { qrSVG } from "./qr.js";
import { putImage, getImage, cachedImage, delImage, shrinkImage } from "./unterwegs-shared.js";
import * as ui from "../ui.js";
import * as store from "../store.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import { readVehicles } from "../trip-core.js";

const VIEW_KEY = "sk-wz-view";
const PRINT_ID = "wz-print-root";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const VIEWS = [["alle", "🧰", "Alle"], ["faellig", "⏰", "Fällig"], ["aus", "🤝", "Ausgeliehen"], ["defekt", "🛠️", "Defekt"]];

function injectCSS() {
  if (document.getElementById("wz-css")) return;
  const l = document.createElement("link");
  l.id = "wz-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-werkzeug.css", import.meta.url).href;
  document.head.appendChild(l);
}

const snap = () => { try { return store.get() || {}; } catch { return {}; } };
const places = () => (Array.isArray(snap().places) ? snap().places : []);
const vehicles = () => readVehicles(snap().settings);
const people = () => { const p = snap().settings && snap().settings.people; return Array.isArray(p) ? p.map((x) => String(x || "").trim()).filter(Boolean) : []; };
const safe = (p, ok) => Promise.resolve(p).then(() => { if (ok) ui.toast(ok); return true; })
  .catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); return false; });
const now = () => Date.now();
const today = () => W.todayKey();
const photoKey = (id) => "tool_" + id;

/** Für Benachrichtigungen/Dashboard: fällige Prüfungen (liest die Sammlung „werkzeug“). */
export async function dueTools(at = Date.now()) {
  const col = collection("werkzeug");
  if (!col.loaded) {
    await new Promise((res) => {
      let off = null;
      const t = setTimeout(() => { if (off) off(); res(); }, 4000);
      off = col.watch(() => { if (col.loaded) { clearTimeout(t); queueMicrotask(() => { if (off) off(); }); res(); } });
    });
  }
  return W.dueTools(col.all(), at);
}

export function mount(el) {
  injectCSS();
  const col = collection("werkzeug");
  const S = { view: VIEWS.some((v) => v[0] === lsGet(VIEW_KEY)) ? lsGet(VIEW_KEY) : "alle", cat: "", q: "", id: W.routeId(location.hash) || null };
  let alive = true, queued = false;
  const queue = () => {
    if (queued || !alive) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (alive) render(); });
  };

  el.innerHTML =
    `<div class="wz">
      <div class="wz-home">
        <div class="wz-top">
          <label class="wz-search"><span class="sr">Werkzeug suchen</span><input id="wz-q" type="search" placeholder="🔎 Name, Marke, Seriennummer …" autocomplete="off" enterkeyhint="search"></label>
          <div class="wz-acts">
            <button type="button" class="btn ghost sm" data-wz="scan">📷 <span>Scannen</span></button>
            <button type="button" class="btn ghost sm" data-wz="print">🖨️ <span>QR-Bogen</span></button>
            <button type="button" class="btn primary sm" data-wz="new">${icon("plus", 16)}<span>Werkzeug</span></button>
          </div>
        </div>
        <div class="wz-views" role="tablist" aria-label="Ansicht"></div>
        <div class="wz-cats" role="group" aria-label="Kategorie"></div>
        <div class="wz-list-wrap"></div>
      </div>
      <div class="wz-detail-wrap" hidden></div>
    </div>`;
  const home = el.querySelector(".wz-home");
  const detailEl = el.querySelector(".wz-detail-wrap");
  const viewsEl = el.querySelector(".wz-views");
  const catsEl = el.querySelector(".wz-cats");
  const listEl = el.querySelector(".wz-list-wrap");
  const qIn = el.querySelector("#wz-q");

  const all = () => col.all().map(W.normTool).filter((t) => t.id && t.name);
  const byId = (id) => { const x = col.get(id); return x ? W.normTool(x) : null; };

  function thumb(t, size = "") {
    if (t.photoId) {
      const img = cachedImage(t.photoId);
      if (img) return `<img src="${esc(img)}" alt="" class="wz-img${size}">`;
      getImage(t.photoId).then((v) => { if (v) queue(); });
    }
    return `<span class="wz-emo${size}" aria-hidden="true">${W.catById(t.cat).e}</span>`;
  }

  function badges(t, d) {
    const st = W.toolState(t);
    const c = W.checkStatus(t, d);
    const out = [];
    if (st.id !== "da" || !c.e) out.push(`<span class="wz-b wz-b-${st.id}">${st.e} ${esc(st.label)}</span>`);
    if (c.state !== "none" && c.state !== "ok") out.push(`<span class="wz-b wz-b-${c.state}">${c.e} ${esc(c.label)}</span>`);
    else if (c.state === "ok") out.push(`<span class="wz-b wz-b-ok">✅ Prüfung ${esc(c.label)}</span>`);
    return out.join("");
  }

  /* ---------- Liste ---------- */

  function renderHome() {
    const d = today();
    const tools = all();
    const cnt = W.counts(tools, d);
    viewsEl.innerHTML = VIEWS.map(([id, e, label]) =>
      `<button type="button" role="tab" class="wz-vt" data-view="${id}" aria-selected="${S.view === id}"><span aria-hidden="true">${e}</span><span>${label}</span>${cnt[id] ? `<span class="wz-vt-n">${cnt[id]}</span>` : ""}</button>`).join("");
    const usedCats = new Set(tools.map((t) => t.cat));
    catsEl.innerHTML = usedCats.size > 1 ? `<div class="chips">` +
      `<button type="button" class="chip" data-cat="" aria-pressed="${!S.cat}">Alle</button>` +
      W.CATS.filter((c) => usedCats.has(c.id)).map((c) => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${S.cat === c.id}">${c.e} ${esc(c.label)}</button>`).join("") +
      `</div>` : "";
    if (!tools.length) {
      listEl.innerHTML = col.loaded ? `<div class="empty wz-empty"><div class="wz-empty-emo">🧰</div><h3>Dein Werkzeug-Register ist noch leer</h3>` +
        `<p>Trag dein Werkzeug ein – mit Seriennummer, Prüftermin und QR-Sticker. Dann weißt du immer, wo dein Messgerät gerade steckt. 😉</p>` +
        `<button type="button" class="btn primary sm" data-wz="new">＋ Erstes Werkzeug</button></div>` : `<p class="note">Lade …</p>`;
      return;
    }
    const list = W.filterTools(tools, { q: S.q, cat: S.cat, view: S.view }, d);
    const pl = places(), vs = vehicles();
    listEl.innerHTML = list.length ? `<ul class="wz-list">${list.map((t) =>
      `<li><button type="button" class="wz-card${t.defect ? " is-defekt" : ""}" data-wz="open" data-id="${esc(t.id)}">` +
        `<span class="wz-thumb">${thumb(t)}</span>` +
        `<span class="wz-ct"><b>${esc(t.name)}</b>` +
          `<small>${esc([t.brand, t.serial ? "SN " + t.serial : ""].filter(Boolean).join(" · ") || W.catById(t.cat).label)}</small>` +
          `<small class="wz-loc">${esc(W.locLabel(t, pl, vs))}</small>` +
          `<span class="wz-badges">${badges(t, d)}</span></span>` +
        `<span class="wz-go" aria-hidden="true">${icon("chevron-right", 18)}</span>` +
      `</button></li>`).join("")}</ul>`
      : `<div class="empty wz-empty"><p>${S.q ? `Nichts gefunden für „${esc(S.q)}“ 🤔` : S.view === "faellig" ? "Keine Prüfung fällig – alles im grünen Bereich ✨" : S.view === "aus" ? "Gerade ist nichts verliehen 👍" : S.view === "defekt" ? "Nichts defekt – super! 💪" : "Keine Treffer."}</p></div>`;
  }

  /* ---------- Detail ---------- */

  function renderDetail() {
    const t = byId(S.id);
    if (!t) {
      detailEl.innerHTML = `<button type="button" class="btn ghost sm wz-back" data-wz="back">${icon("chevron-left", 16)}<span>Alle Werkzeuge</span></button>` +
        (col.loaded ? `<div class="empty wz-empty"><div class="wz-empty-emo">🔍</div><h3>Werkzeug nicht gefunden</h3><p>Vielleicht wurde es gelöscht – oder der Sticker gehört zu einem anderen Konto.</p></div>` : `<p class="note">Lade …</p>`);
      return;
    }
    const d = today();
    const c = W.checkStatus(t, d);
    const cat = W.catById(t.cat);
    const hist = t.history.slice().reverse().slice(0, 25);
    const row = (k, v) => (v ? `<div class="wz-dl-r"><dt>${k}</dt><dd>${v}</dd></div>` : "");
    detailEl.innerHTML =
      `<button type="button" class="btn ghost sm wz-back" data-wz="back">${icon("chevron-left", 16)}<span>Alle Werkzeuge</span></button>` +
      `<article class="wz-det">` +
      `<section class="card wz-hero">` +
        `<button type="button" class="wz-hero-ph" data-wz="photo" aria-label="${t.photoId ? "Foto groß ansehen" : "Foto hinzufügen"}">${thumb(t, " big")}</button>` +
        `<div class="wz-hero-t"><small>${cat.e} ${esc(cat.label)}</small><h3>${esc(t.name)}</h3>` +
          `${t.brand ? `<p>${esc(t.brand)}</p>` : ""}<div class="wz-badges">${badges(t, d)}</div></div>` +
      `</section>` +
      (t.defect ? `<section class="card wz-defect"><b>🛠️ Defekt gemeldet</b>${t.defectNote ? `<p>${esc(t.defectNote)}</p>` : ""}</section>` : "") +
      `<div class="wz-actions">` +
        (t.holder ? `<button type="button" class="btn primary sm" data-wz="return">↩️ Zurückgeben</button>` : `<button type="button" class="btn primary sm" data-wz="lend">🤝 Ausgeben</button>`) +
        (t.checkMonths || t.lastCheck || t.nextCheck ? `<button type="button" class="btn ghost sm" data-wz="check">✅ Geprüft</button>` : "") +
        (t.defect ? `<button type="button" class="btn ghost sm" data-wz="fixed">✨ Repariert</button>` : `<button type="button" class="btn ghost sm" data-wz="defect">🛠️ Defekt melden</button>`) +
        `<button type="button" class="btn ghost sm" data-wz="qr">🔳 QR-Sticker</button>` +
        `<button type="button" class="btn ghost sm" data-wz="edit">${icon("pencil", 16)}<span>Bearbeiten</span></button>` +
      `</div>` +
      `<section class="card wz-info"><dl class="wz-dl">` +
        row("Seriennummer", t.serial ? `<span class="wz-mono">${esc(t.serial)}</span>` : "") +
        row("Standort", esc(W.locLabel(t, places(), vehicles()))) +
        row("Ausgeliehen an", t.holder ? `🤝 ${esc(t.holder)}` : "") +
        row(esc(t.checkLabel || cat.check), t.checkMonths || t.lastCheck || t.nextCheck
          ? `${t.checkMonths ? `alle ${t.checkMonths} Monate` : "ohne festes Intervall"}${t.lastCheck ? ` · zuletzt ${esc(W.fmtKey(t.lastCheck))}` : ""}<br><span class="wz-b wz-b-${c.state}">${c.e} ${esc(c.state === "ok" ? "nächste am " + W.fmtKey(c.due) : c.label)}</span>`
          : `<span class="wz-muted">kein Prüfintervall</span>`) +
        row("Notizen", t.notes ? `<span class="wz-pre">${esc(t.notes)}</span>` : "") +
      `</dl></section>` +
      `<section class="card wz-hist"><h4>📜 Verlauf</h4>` +
        (hist.length ? `<ul>${hist.map((h) => `<li><span>${esc(W.histText(h))}</span><small>${esc(new Date(h.ts).toLocaleDateString("de-AT"))}${h.note ? ` · ${esc(h.note)}` : ""}</small></li>`).join("")}</ul>`
          : `<p class="note">Noch nichts passiert – Ausgaben, Rückgaben und Prüfungen landen hier.</p>`) +
      `</section>` +
      `</article>`;
  }

  function render() {
    if (!alive) return;
    const inDetail = S.id != null;
    home.hidden = inDetail;
    detailEl.hidden = !inDetail;
    if (inDetail) renderDetail(); else renderHome();
  }

  /* ---------- Formular ---------- */

  function openForm(tool = null) {
    const isNew = !tool;
    const t = tool ? W.normTool(tool) : W.normTool({ cat: "akku", checkMonths: W.catById("akku").months, loc: { kind: "firma" } });
    let photo; // undefined = unverändert, null = entfernen, string = neu
    let cat = t.cat, lk = t.loc.kind, autoInterval = isNew;
    const pl = places(), vs = vehicles();
    const cur = t.photoId ? cachedImage(t.photoId) : null;
    ui.openSheet({
      title: isNew ? "🧰 Neues Werkzeug" : "Werkzeug bearbeiten",
      bodyHTML: `<div class="fields wz-form">` +
        `<label>Bezeichnung<input id="wz-f-name" maxlength="60" placeholder="z. B. Installationstester" value="${esc(t.name)}"></label>` +
        `<div class="lbl">Kategorie</div><div class="chips" data-r="cats">${W.CATS.map((c) => `<button type="button" class="chip" data-fcat="${c.id}" aria-pressed="${cat === c.id}">${c.e} ${esc(c.label)}</button>`).join("")}</div>` +
        `<div class="row"><label>Hersteller / Modell<input id="wz-f-brand" maxlength="60" placeholder="z. B. Marke Modell 123" value="${esc(t.brand)}"></label>` +
        `<label>Seriennummer<input id="wz-f-sn" maxlength="40" autocapitalize="characters" value="${esc(t.serial)}"></label></div>` +
        `<div class="wz-photo-pick"><div class="wz-photo-prev">${cur ? `<img src="${esc(cur)}" alt="">` : "📷"}</div>` +
          `<label class="btn ghost sm wz-file">Foto wählen<input id="wz-f-photo" type="file" accept="image/*" capture="environment" hidden></label>` +
          (t.photoId ? `<button type="button" class="btn ghost sm" data-nophoto>Foto entfernen</button>` : "") + `</div>` +
        `<div class="lbl">Standort</div><div class="chips" data-r="locs">${W.LOC_KINDS.map((k) => `<button type="button" class="chip" data-floc="${k.id}" aria-pressed="${lk === k.id}">${k.e} ${esc(k.label)}</button>`).join("")}</div>` +
        `<label data-locf="baustelle">Baustelle<select id="wz-f-place"><option value="">– wählen –</option>${pl.map((p) => `<option value="${esc(p.id)}"${p.id === t.loc.placeId ? " selected" : ""}>${esc(p.name || "Ort")}</option>`).join("")}</select></label>` +
        `<label data-locf="auto">Fahrzeug<select id="wz-f-veh"><option value="">– wählen –</option>${vs.map((v) => `<option value="${esc(v.id)}"${v.id === t.loc.vehicleId ? " selected" : ""}>${esc(v.plate ? `${v.name} (${v.plate})` : v.name)}</option>`).join("")}</select></label>` +
        `<label>Genauer (optional)<input id="wz-f-loctext" maxlength="60" placeholder="z. B. Regal 3, Kofferraum links" value="${esc(t.loc.text)}"></label>` +
        `<div class="lbl">Prüfung / Wartung</div>` +
        `<div class="row"><label>Intervall (Monate)<input id="wz-f-months" inputmode="numeric" placeholder="leer = keins" value="${t.checkMonths || ""}"></label>` +
        `<label>Art<input id="wz-f-clabel" maxlength="40" placeholder="${esc(W.catById(cat).check)}" value="${esc(t.checkLabel)}"></label></div>` +
        `<div class="row"><label>Zuletzt geprüft<input id="wz-f-last" type="date" value="${esc(t.lastCheck || "")}"></label>` +
        `<label>Nächste Prüfung (optional)<input id="wz-f-next" type="date" value="${esc(t.nextCheck || "")}"></label></div>` +
        `<p class="note">Ohne festen Termin rechnet die App „zuletzt geprüft + Intervall“. Messgeräte meist jährlich kalibrieren, Leitern regelmäßig prüfen – wie es deine Firma vorgibt.</p>` +
        `<label>Notizen<textarea id="wz-f-notes" rows="3" maxlength="1000" placeholder="z. B. Zubehör, Ladegerät, Kaufdatum">${esc(t.notes)}</textarea></label>` +
      `</div>` +
      `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        const syncLoc = () => sheet.querySelectorAll("[data-locf]").forEach((x) => { x.hidden = x.dataset.locf !== lk; });
        syncLoc();
        $("#wz-f-months").addEventListener("input", () => { autoInterval = false; });
        sheet.querySelector('[data-r="cats"]').addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-fcat]"); if (!b) return;
          cat = b.dataset.fcat;
          sheet.querySelectorAll("[data-fcat]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          $("#wz-f-clabel").placeholder = W.catById(cat).check;
          if (autoInterval) $("#wz-f-months").value = W.catById(cat).months || "";
        });
        sheet.querySelector('[data-r="locs"]').addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-floc]"); if (!b) return;
          lk = b.dataset.floc;
          sheet.querySelectorAll("[data-floc]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          syncLoc();
        });
        const prev = $(".wz-photo-prev");
        $("#wz-f-photo").addEventListener("change", async (ev) => {
          const f = ev.target.files && ev.target.files[0];
          if (!f) return;
          prev.textContent = "⏳";
          try { const r = await shrinkImage(f, { maxSide: 800, maxBytes: 90 * 1024, quality: 0.75 }); photo = r.data; prev.innerHTML = `<img src="${esc(r.data)}" alt="">`; }
          catch (err) { prev.textContent = "📷"; ui.toast(err.message || "Foto ging nicht."); }
        });
        const np = $("[data-nophoto]");
        if (np) np.addEventListener("click", () => { photo = null; prev.textContent = "📷"; });
        $("[data-save]").addEventListener("click", async () => {
          const name = $("#wz-f-name").value.trim();
          if (!name) { ui.toast("Bitte eine Bezeichnung eingeben."); $("#wz-f-name").focus(); return; }
          const mRaw = $("#wz-f-months").value.trim();
          const months = mRaw ? Math.round(Number(mRaw.replace(",", "."))) : 0;
          if (mRaw && !(months > 0 && months <= 120)) { ui.toast("Intervall bitte als Monate (1–120) eingeben."); return; }
          const item = {
            ...(tool || {}), name, cat,
            brand: $("#wz-f-brand").value.trim(), serial: $("#wz-f-sn").value.trim().toUpperCase(),
            loc: { kind: lk, placeId: lk === "baustelle" ? $("#wz-f-place").value || null : null, vehicleId: lk === "auto" ? $("#wz-f-veh").value || null : null, text: $("#wz-f-loctext").value.trim() },
            checkMonths: months, checkLabel: $("#wz-f-clabel").value.trim(),
            lastCheck: $("#wz-f-last").value || null, nextCheck: $("#wz-f-next").value || null,
            notes: $("#wz-f-notes").value.trim(),
            created: (tool && tool.created) || now(), updated: now(),
          };
          if (!item.history) item.history = [];
          close();
          try {
            const id = await col.put(item);
            if (photo) { await putImage(photoKey(id), photo); await col.patch(id, { photoId: photoKey(id) }); }
            else if (photo === null && item.photoId) { await delImage(item.photoId).catch(() => {}); await col.patch(id, { photoId: null }); }
            ui.toast(isNew ? `${W.catById(cat).e} ${name} ist im Register ✓` : "Gespeichert ✓");
            if (isNew) location.hash = W.toolHash(id).slice(1);
          } catch (err) { console.error(err); ui.toast("Speichern fehlgeschlagen: " + (err.message || err), 4000); }
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => {
          close();
          if (tool.photoId) delImage(tool.photoId).catch(() => {});
          if (await safe(col.remove(tool.id), "Gelöscht 🗑️")) location.hash = "alltag/werkzeug";
        });
      },
    });
  }

  function openLend(t) {
    const ps = people();
    ui.openSheet({
      title: "🤝 Werkzeug ausgeben",
      bodyHTML: `<div class="fields">` +
        `<p class="note"><b>${esc(t.name)}</b> geht an …</p>` +
        (ps.length ? `<div class="chips" data-r="ppl">${ps.map((p) => `<button type="button" class="chip" data-p="${esc(p)}" aria-pressed="false">${esc(p)}</button>`).join("")}</div>` : "") +
        `<label>Name<input id="wz-l-who" maxlength="60" placeholder="z. B. Kollege, Partie, Firma"></label>` +
        `<label>Notiz (optional)<input id="wz-l-note" maxlength="200" placeholder="z. B. für Baustelle Muster"></label>` +
      `</div><div class="row"><button type="button" class="btn primary" data-save>Ausgeben</button></div>`,
      onMount(sheet, close) {
        const who = sheet.querySelector("#wz-l-who");
        const chips = sheet.querySelector('[data-r="ppl"]');
        if (chips) chips.addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-p]"); if (!b) return;
          who.value = b.dataset.p;
          chips.querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        });
        sheet.querySelector("[data-save]").addEventListener("click", () => {
          let next;
          try { next = W.lend(t, who.value, now(), sheet.querySelector("#wz-l-note").value); } catch (err) { ui.toast(err.message); who.focus(); return; }
          close();
          safe(col.put({ ...next, updated: now() }), `🤝 ${t.name} ist jetzt bei ${next.holder}`);
        });
      },
    });
  }

  function openCheck(t) {
    ui.openSheet({
      title: "✅ Prüfung eintragen",
      bodyHTML: `<div class="fields"><p class="note"><b>${esc(t.name)}</b> – ${esc(t.checkLabel || W.catById(t.cat).check)}</p>` +
        `<label>Geprüft am<input id="wz-c-date" type="date" value="${today()}"></label>` +
        `<label>Notiz (optional)<input id="wz-c-note" maxlength="200" placeholder="z. B. Prüfprotokoll Nr."></label></div>` +
        `<div class="row"><button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-save]").addEventListener("click", () => {
          let next;
          try { next = W.markChecked(t, sheet.querySelector("#wz-c-date").value, now(), sheet.querySelector("#wz-c-note").value); } catch (err) { ui.toast(err.message); return; }
          close();
          const due = W.nextDue(next);
          safe(col.put({ ...next, updated: now() }), due ? `Geprüft ✓ – nächste Prüfung ${W.fmtKey(due)}` : "Geprüft ✓");
        });
      },
    });
  }

  function openDefect(t) {
    ui.openSheet({
      title: "🛠️ Defekt melden",
      bodyHTML: `<div class="fields"><p class="note"><b>${esc(t.name)}</b> – was ist los?</p>` +
        `<label>Beschreibung<textarea id="wz-d-note" rows="3" maxlength="300" placeholder="z. B. Akku lädt nicht mehr, Kabel beschädigt"></textarea></label></div>` +
        `<div class="row"><button type="button" class="btn danger" data-save>Als defekt markieren</button></div>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-save]").addEventListener("click", () => {
          const next = W.reportDefect(t, sheet.querySelector("#wz-d-note").value, now());
          close();
          safe(col.put({ ...next, updated: now() }), "Als defekt markiert – gute Besserung, Werkzeug! 🩹");
        });
      },
    });
  }

  function openQR(t) {
    const url = W.toolUrl(location.href, t.id);
    let svg = "";
    try { svg = qrSVG(url, { label: `QR-Code ${t.name}` }); } catch (e) { console.error(e); }
    ui.openSheet({
      title: "🔳 QR-Sticker",
      bodyHTML: `<div class="wz-qr">` +
        `<div class="wz-qr-box">${svg}</div><b>${esc(t.name)}</b>` +
        `<p class="note">Druck den Sticker aus und kleb ihn aufs Werkzeug oder den Koffer – Scannen öffnet direkt diese Seite. 📱</p>` +
        `<p class="wz-qr-url">${esc(url)}</p>` +
        `<div class="row"><button type="button" class="btn ghost" data-q="copy">🔗 Link kopieren</button><button type="button" class="btn ghost" data-q="print">🖨️ Drucken</button></div>` +
      `</div>`,
      onMount(sheet, close) {
        sheet.querySelector('[data-q="copy"]').addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(url); ui.toast("Link kopiert 📋", 1600); }
          catch { ui.toast("Kopieren geht hier nicht – halt den Link gedrückt."); }
        });
        sheet.querySelector('[data-q="print"]').addEventListener("click", () => { close(); openPrint([t.id]); });
      },
    });
  }

  function showPhoto(t) {
    if (!t.photoId) { openForm(byId(t.id)); return; }
    getImage(t.photoId).then((src) => {
      if (!src) { ui.toast("Foto konnte nicht geladen werden."); return; }
      ui.openSheet({ title: `📷 ${t.name}`, bodyHTML: `<div class="wz-photo-big"><img src="${esc(src)}" alt="Foto: ${esc(t.name)}"></div>` });
    });
  }

  /* ---------- Druckbogen ---------- */

  let printer = null;
  function closePrint(fromPop = false) {
    if (!printer) return;
    const p = printer; printer = null;
    window.removeEventListener("popstate", p.onPop);
    p.el.remove();
    document.body.classList.remove("wz-print-open");
    if (!fromPop && p.pushed && history.state && history.state.wzp) history.back();
  }
  function openPrint(only = null) {
    closePrint();
    const tools = W.filterTools(col.all(), {}, today()).sort((a, b) => a.name.localeCompare(b.name, "de"));
    if (!tools.length) { ui.toast("Noch kein Werkzeug zum Drucken."); return; }
    const sel = new Set(only && only.length ? only : tools.map((t) => t.id));
    const el2 = document.createElement("div");
    el2.id = PRINT_ID;
    el2.className = "rp wz-pr";
    el2.setAttribute("role", "dialog"); el2.setAttribute("aria-modal", "true"); el2.setAttribute("aria-label", "QR-Sticker drucken");
    el2.tabIndex = -1;
    const base = location.href;
    const sticker = (t) => {
      let svg = "";
      try { svg = qrSVG(W.toolUrl(base, t.id), { label: `QR-Code ${t.name}` }); } catch (e) { console.error(e); }
      return `<label class="wz-st${sel.has(t.id) ? "" : " off"}" data-id="${esc(t.id)}">` +
        `<input type="checkbox" class="wz-st-cb" data-pick="${esc(t.id)}"${sel.has(t.id) ? " checked" : ""} aria-label="${esc(t.name)} drucken">` +
        `<span class="wz-st-qr">${svg}</span>` +
        `<span class="wz-st-t"><b>${W.catById(t.cat).e} ${esc(t.name)}</b>${t.serial ? `<small>SN ${esc(t.serial)}</small>` : t.brand ? `<small>${esc(t.brand)}</small>` : ""}<em>Scannen → Stempelkarte</em></span>` +
      `</label>`;
    };
    el2.innerHTML = `<div class="rp-bar"><button type="button" class="btn ghost sm rp-close" data-p="close">${icon("chevron-left", 18)}<span>Zurück</span></button><h2>🖨️ QR-Sticker drucken</h2></div>` +
      `<p class="note wz-pr-note">Häkchen weg = wird nicht gedruckt. Tipp: auf Etikettenpapier oder normal drucken, ausschneiden und mit Klebeband/Folie schützen. ✂️</p>` +
      `<div class="wz-pr-tools"><button type="button" class="btn ghost sm" data-p="all">Alle</button><button type="button" class="btn ghost sm" data-p="none">Keine</button><span class="wz-pr-n"></span></div>` +
      `<article class="rp-paper wz-sheet">${tools.map(sticker).join("")}</article>` +
      `<div class="rp-actions"><button type="button" class="btn primary" data-p="print">${icon("file", 20)}<span>Drucken / als PDF speichern</span></button></div>`;
    document.body.appendChild(el2);
    document.body.classList.add("wz-print-open");
    const count = () => { el2.querySelector(".wz-pr-n").textContent = `${sel.size} von ${tools.length} ausgewählt`; };
    const setAll = (on) => { el2.querySelectorAll("[data-pick]").forEach((cb) => { cb.checked = on; cb.closest(".wz-st").classList.toggle("off", !on); if (on) sel.add(cb.dataset.pick); else sel.delete(cb.dataset.pick); }); count(); };
    count();
    el2.addEventListener("change", (ev) => {
      const cb = ev.target.closest("[data-pick]"); if (!cb) return;
      if (cb.checked) sel.add(cb.dataset.pick); else sel.delete(cb.dataset.pick);
      cb.closest(".wz-st").classList.toggle("off", !cb.checked);
      count();
    });
    el2.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-p]"); if (!b) return;
      const a = b.dataset.p;
      if (a === "close") closePrint();
      else if (a === "all") setAll(true);
      else if (a === "none") setAll(false);
      else if (a === "print") {
        if (!sel.size) { ui.toast("Bitte mindestens einen Sticker auswählen."); return; }
        const prevT = document.title;
        document.title = `Werkzeug QR-Sticker ${today()}`;
        try { window.print(); } catch { ui.toast("Drucken geht hier nicht."); }
        setTimeout(() => { document.title = prevT; }, 1000);
      }
    });
    const p = { el: el2, pushed: false, onPop: () => closePrint(true) };
    try { history.pushState({ ...(history.state || {}), wzp: 1 }, "", location.href); p.pushed = true; window.addEventListener("popstate", p.onPop); } catch { /* egal */ }
    printer = p;
    try { el2.focus({ preventScroll: true }); } catch { /* egal */ }
  }

  /* ---------- Scanner ---------- */

  function openScanner() {
    const canScan = typeof window.BarcodeDetector === "function" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    let stream = null, timer = null, done = false;
    const stop = () => {
      clearTimeout(timer); timer = null;
      if (stream) { try { stream.getTracks().forEach((tr) => tr.stop()); } catch { /* egal */ } stream = null; }
    };
    const hit = (raw, close) => {
      const id = W.parseToolRef(raw);
      if (!id) return false;
      done = true; stop(); close();
      if (!col.get(id) && col.loaded) ui.toast("Diesen Sticker kenne ich nicht 🤔 – gehört er zu deinem Konto?", 3500);
      location.hash = W.toolHash(id).slice(1);
      return true;
    };
    ui.openSheet({
      title: "📷 Sticker scannen",
      bodyHTML: `<div class="wz-scan">` +
        (canScan ? `<div class="wz-scan-v"><video playsinline muted autoplay aria-label="Kamerabild"></video><span class="wz-scan-frame" aria-hidden="true"></span></div>` +
          `<p class="note wz-scan-st" aria-live="polite">Kamera wird gestartet …</p>`
          : `<div class="wz-scan-hint"><span aria-hidden="true">📱</span><p>Dein Browser kann hier nicht selbst scannen. Öffne einfach die <b>Kamera-App</b> deines Handys und halte sie auf den Sticker – der Link öffnet das Werkzeug direkt in der Stempelkarte.</p></div>`) +
        `<label class="wz-scan-man">Oder Link/ID einfügen<span class="wz-scan-row"><input id="wz-s-in" placeholder="…#alltag/werkzeug/…" autocomplete="off"><button type="button" class="btn primary sm" data-go>Öffnen</button></span></label>` +
      `</div>`,
      onMount(sheet, close) {
        const inp = sheet.querySelector("#wz-s-in");
        const go = () => { if (!hit(inp.value, close)) ui.toast("Das ist kein Werkzeug-Link."); };
        sheet.querySelector("[data-go]").addEventListener("click", go);
        inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
        if (!canScan) return;
        const video = sheet.querySelector("video");
        const st = sheet.querySelector(".wz-scan-st");
        let det;
        try { det = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (err) { st.textContent = "Scanner geht hier leider nicht – nimm die Kamera-App deines Handys. 📱"; return; }
        const loop = async () => {
          if (done) return;
          if (!video.isConnected) { stop(); return; }
          try {
            if (video.readyState >= 2) {
              const codes = await det.detect(video);
              for (const c of codes || []) { if (hit(c.rawValue, close)) return; }
              if (codes && codes.length) st.textContent = "Das ist kein Werkzeug-Sticker 🤔";
            }
          } catch { /* nächster Versuch */ }
          timer = setTimeout(loop, 220);
        };
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
          .then((s) => {
            if (!video.isConnected || done) { s.getTracks().forEach((tr) => tr.stop()); return; }
            stream = s; video.srcObject = s;
            video.play().catch(() => {});
            st.textContent = "Halte den QR-Sticker ins Bild 🎯";
            loop();
          })
          .catch((err) => {
            st.textContent = err && err.name === "NotAllowedError" ? "Kein Kamera-Zugriff erlaubt. Du kannst auch die Kamera-App deines Handys nehmen. 📱" : "Kamera nicht verfügbar – nimm die Kamera-App deines Handys. 📱";
          });
      },
    });
  }

  /* ---------- Ereignisse ---------- */

  el.addEventListener("click", (ev) => {
    const vt = ev.target.closest("[data-view]");
    if (vt) { S.view = vt.dataset.view; lsSet(VIEW_KEY, S.view); render(); return; }
    const ct = ev.target.closest("[data-cat]");
    if (ct) { S.cat = ct.dataset.cat; render(); return; }
    const b = ev.target.closest("[data-wz]");
    if (!b) return;
    const a = b.dataset.wz;
    const t = S.id ? byId(S.id) : null;
    if (a === "new") openForm();
    else if (a === "open") location.hash = W.toolHash(b.dataset.id).slice(1);
    else if (a === "back") location.hash = "alltag/werkzeug";
    else if (a === "scan") openScanner();
    else if (a === "print") openPrint();
    else if (!t) return;
    else if (a === "edit") openForm(col.get(t.id));
    else if (a === "lend") openLend(t);
    else if (a === "return") { const who = t.holder; safe(col.put({ ...W.giveBack(t, now()), updated: now() }), `↩️ ${t.name} ist zurück${who ? ` von ${who}` : ""}`); }
    else if (a === "check") openCheck(t);
    else if (a === "defect") openDefect(t);
    else if (a === "fixed") safe(col.put({ ...W.repaired(t, now()), updated: now() }), "✨ Wieder einsatzbereit");
    else if (a === "qr") openQR(t);
    else if (a === "photo") showPhoto(t);
  });
  qIn.addEventListener("input", () => { S.q = qIn.value; renderHome(); });

  const onHash = () => {
    const id = W.routeId(location.hash);
    if (id === null) return; // anderer Bereich – alltag.js räumt auf
    const next = id || null;
    if (next !== S.id) { S.id = next; render(); window.scrollTo(0, 0); }
  };
  window.addEventListener("hashchange", onHash);
  const off = col.watch(queue);
  let unsub = null;
  try { unsub = store.subscribe(queue); } catch { /* egal */ }
  render();

  return () => {
    alive = false;
    window.removeEventListener("hashchange", onHash);
    try { off(); } catch { /* egal */ }
    if (typeof unsub === "function") try { unsub(); } catch { /* egal */ }
    closePrint(true);
  };
}
