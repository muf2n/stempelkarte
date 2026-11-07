// Update 10 – 📸 Galerie-Extras (DOM): im Vollbild ⭐ Favorit, Schlagwörter, ⬅️ Vorher / ➡️ Nachher und „🤖 Bild beschreiben“
// (Claude-Server /chat mit Bild – die Beschreibung wird erst nach deiner Bestätigung zur Notiz). Außerdem die
// Duplikat-Prüfung mit Liste zum Löschen (zweistufig). Logik: js/gallery-extras-core.js
import * as photos from "../photos.js";
import * as X from "../gallery-extras-core.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { askClaude, aiAvailable } from "./ai-client.js";

(function injectCSS() {
  if (typeof document === "undefined" || document.getElementById("gx-css")) return;
  const l = document.createElement("link");
  l.id = "gx-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/galerie-extras.css", import.meta.url).href;
  document.head.appendChild(l);
})();

const PROMPT = "Beschreib dieses Foto für meine Foto-Notiz in 1–2 kurzen, sachlichen Sätzen auf Deutsch (Du-Form ist nicht nötig, keine Begrüßung, keine Rückfragen): " +
  "Was ist zu sehen (z. B. Baustelle, Verteiler, Leitungen, Werkzeug, Raum, Material)? Keine Personen identifizieren, keine Vermutungen über Namen oder Adressen. Max. 300 Zeichen.";

/** Bereich im Vollbild unter den Album-Chips zeichnen. p = Foto (Index oder voll), host = Container. */
export function viewerExtras(p, host, ctx) {
  const tags = X.cleanTags(p.tags);
  host.innerHTML = `
    <div class="gx" data-gx>
      <div class="gx-row">
        <button type="button" class="gx-fav" data-gx="fav" aria-pressed="${p.fav === true}" aria-label="${p.fav ? "Favorit entfernen" : "Als Favorit markieren"}">${p.fav ? "⭐ Favorit" : "☆ Favorit"}</button>
        <div class="gx-phase" role="group" aria-label="Vorher/Nachher">
          <button type="button" data-gx="ph" data-v="vorher" aria-pressed="${p.phase === "vorher"}">⬅️ Vorher</button>
          <button type="button" data-gx="ph" data-v="nachher" aria-pressed="${p.phase === "nachher"}">➡️ Nachher</button>
        </div>
        <button type="button" class="gx-ai" data-gx="ai">🤖 Bild beschreiben</button>
      </div>
      <div class="gx-tags" role="group" aria-label="Schlagwörter">
        ${tags.map((t) => `<span class="gx-tag">#${esc(t)}<button type="button" data-gx="untag" data-t="${esc(t)}" aria-label="Schlagwort „${esc(t)}“ entfernen">✕</button></span>`).join("")}
        <form class="gx-add" data-gx-form><label><span class="gx-sr">Schlagwort hinzufügen</span><input type="text" data-gx="tagin" maxlength="60" placeholder="＋ Schlagwort" enterkeyhint="done" autocomplete="off"></label><button type="submit" class="gx-addbtn" aria-label="Schlagwort hinzufügen">＋</button></form>
      </div>
      <div class="gx-aibox" data-gx="aibox" hidden></div>
    </div>`;
  const $ = (k) => host.querySelector(`[data-gx="${k}"]`);
  const save = async (patch, ok) => {
    try { await photos.updatePhoto(p.id, patch); Object.assign(p, patch); if (ok) ui.toast(ok, 1600); if (host.isConnected) viewerExtras(p, host, ctx); }
    catch (err) { console.error(err); ui.toast((err && err.message) || "Speichern hat nicht geklappt.", 3200); }
  };
  host.querySelector("[data-gx-form]").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const add = X.parseTagInput($("tagin").value);
    if (!add.length) return;
    const next = X.addTags(p.tags, add);
    if (next.length === X.cleanTags(p.tags).length) { $("tagin").value = ""; ui.toast("Das Schlagwort gibt's schon 🙂", 1600); return; }
    save({ tags: next }, `🏷️ ${add.map((t) => "#" + t).join(" ")}`).then(() => { const i = document.querySelector('.ph-view [data-gx="tagin"]'); if (i) i.focus({ preventScroll: true }); });
  });
  host.querySelector("[data-gx]").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-gx]");
    if (!b) return;
    const act = b.dataset.gx;
    if (act === "fav") save({ fav: !(p.fav === true) }, p.fav ? "Favorit entfernt" : "⭐ Favorit!");
    else if (act === "ph") { const v = b.dataset.v; const next = p.phase === v ? null : v; save({ phase: next }, next ? `Als „${next === "vorher" ? "Vorher" : "Nachher"}“ markiert ✨` : "Markierung entfernt"); }
    else if (act === "untag") save({ tags: X.removeTag(p.tags, b.dataset.t) }, "Schlagwort entfernt");
    else if (act === "ai") describe(p, host, b);
  });
}

async function describe(p, host, btn) {
  const box = host.querySelector('[data-gx="aibox"]');
  const view = host.closest(".ph-view"); // vor dem Speichern merken – das Vollbild zeichnet den Bereich danach neu
  if (!aiAvailable()) { ui.toast("🤖 Bild beschreiben geht mit der Google-Anmeldung und dem Claude-Server.", 3600); return; }
  ui.setBusy(btn, true, "🤖 Schaut sich das an …");
  box.hidden = false;
  box.innerHTML = `<p class="note">🤖 Claude schaut sich das Foto an …</p>`;
  try {
    const full = p.data ? p : await photos.getPhoto(p.id);
    const data = full && (full.data || full.thumb);
    if (!data) throw new Error("Foto konnte nicht geladen werden.");
    const type = (/^data:([^;,]+)/.exec(data) || [])[1] || "image/jpeg";
    const out = await askClaude([{ role: "user", content: PROMPT }], { body: { mode: "lehrer", image: { type, data: data.replace(/^data:[^,]*,/, "") } }, timeoutMs: 60000 });
    const text = X.cleanDescription(out.reply);
    if (!text) throw new Error("Keine Beschreibung bekommen.");
    const hasNote = !!String(p.note || "").trim();
    box.innerHTML = `<p class="gx-ai-t">${esc(text)}</p><p class="note">Passt das? Erst mit deinem Okay wird's zur Notiz.</p>
      <div class="gx-ai-acts"><button type="button" class="btn sm primary" data-ai="set">✔️ ${hasNote ? "Notiz ersetzen" : "Als Notiz übernehmen"}</button>${hasNote ? `<button type="button" class="btn sm ghost" data-ai="add">➕ Anhängen</button>` : ""}<button type="button" class="btn sm ghost" data-ai="no">Verwerfen</button></div>`;
    box.onclick = async (ev) => {
      const b = ev.target.closest("[data-ai]");
      if (!b) return;
      if (b.dataset.ai === "no") { box.hidden = true; box.innerHTML = ""; return; }
      const note = (b.dataset.ai === "add" ? `${String(p.note || "").trim()}\n${text}` : text).slice(0, 500);
      try {
        await photos.updateNote(p.id, note);
        p.note = note;
        const ta = view && view.querySelector('[data-v="note"]');
        if (ta) ta.value = note;
        box.hidden = true; box.innerHTML = "";
        ui.toast("📝 Notiz gespeichert");
      } catch (err) { console.error(err); ui.toast("Notiz konnte nicht gespeichert werden.", 3200); }
    };
  } catch (err) {
    box.innerHTML = `<p class="gx-ai-err">⚠️ ${esc((err && err.message) || "Hat nicht geklappt.")}</p>`;
  } finally { if (btn.isConnected) ui.setBusy(btn, false); }
}

/* ---------- Duplikate ---------- */

const hashCache = new Map(); // id → dHash (diese Sitzung)

function hashThumb(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(""); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 9; c.height = 8;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, 9, 8);
        resolve(X.dHash(X.grayOf(g.getImageData(0, 0, 9, 8).data)));
      } catch { resolve(""); }
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}

async function hashesFor(items, onProgress) {
  const m = new Map();
  let i = 0;
  for (const p of items) {
    i++;
    if (!p.thumb) continue;
    const key = p.id + ":" + p.thumb.length;
    if (!hashCache.has(key)) hashCache.set(key, await hashThumb(p.thumb));
    m.set(p.id, hashCache.get(key));
    if (onProgress && i % 25 === 0) onProgress(i, items.length);
  }
  return m;
}

/** Prüf-Blatt: Gruppen ähnlicher Fotos, Vorschlag was weg kann, Löschen in zwei Schritten. */
export function openDuplicates(items, ctx, { onDeleted } = {}) {
  ui.openSheet({
    title: "🧹 Doppelte Fotos",
    bodyHTML: `<div class="gx-dup" data-dup><p class="note"><span class="gx-spin" aria-hidden="true"></span> Ich vergleiche deine ${items.length} Fotos …</p></div>`,
    async onMount(sheet, close) {
      const host = sheet.querySelector("[data-dup]");
      const hashes = await hashesFor(items, (i, n) => { const n0 = host.querySelector(".note"); if (n0) n0.textContent = `Ich vergleiche deine Fotos … ${i}/${n}`; });
      const groups = X.findDuplicates(items, hashes);
      if (!host.isConnected) return;
      if (!groups.length) { host.innerHTML = `<div class="gx-dup-none"><div aria-hidden="true">✨</div><b>Keine Duplikate gefunden</b><p class="note">Deine Galerie ist schön aufgeräumt. 🌿</p></div>`; return; }
      const del = new Set(X.deletionPlan(groups));
      const draw = () => {
        host.innerHTML = `<p class="note">${groups.length} ${groups.length === 1 ? "Gruppe" : "Gruppen"} gefunden. Markiert (🗑️) sind die Kopien – das Foto mit ⭐/Notiz bzw. das älteste bleibt. Tipp auf ein Foto zum Umschalten.</p>
          <ol class="gx-groups">${groups.map((g, gi) => `<li class="gx-group"><b>Gruppe ${gi + 1}</b><div class="gx-gthumbs">${g.map((p) => `<button type="button" class="gx-gth${del.has(p.id) ? " del" : ""}" data-dp="${esc(p.id)}" aria-pressed="${del.has(p.id)}" aria-label="${del.has(p.id) ? "Wird gelöscht – tippen zum Behalten" : "Bleibt – tippen zum Löschen"}">
              ${p.thumb ? `<img src="${p.thumb}" alt="">` : ""}<span class="gx-gth-b">${del.has(p.id) ? "🗑️" : "✔️ bleibt"}</span></button>`).join("")}</div></li>`).join("")}</ol>
          <div class="row"><button type="button" class="btn ghost" data-dx="close">Fertig</button><button type="button" class="btn danger" data-dx="del"${del.size ? "" : " disabled"}>🗑️ ${del.size} ${del.size === 1 ? "Foto" : "Fotos"} löschen</button></div>`;
      };
      draw();
      host.addEventListener("click", async (ev) => {
        const t = ev.target.closest("[data-dp]");
        if (t) {
          const id = t.dataset.dp;
          const g = groups.find((x) => x.some((p) => p.id === id));
          if (del.has(id)) del.delete(id);
          else if (g.filter((p) => !del.has(p.id)).length > 1) del.add(id);
          else { ui.toast("Mindestens ein Foto pro Gruppe bleibt 🙂", 1800); return; }
          draw(); return;
        }
        const b = ev.target.closest("[data-dx]");
        if (!b) return;
        if (b.dataset.dx === "close") { close(); return; }
        if (b.dataset.dx === "del") {
          if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = `Wirklich ${del.size} löschen?`; setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; draw(); } }, 4000); return; }
          ui.setBusy(b, true, "Lösche …");
          let n = 0;
          for (const id of [...del]) { try { await photos.deletePhoto(id); n++; } catch (err) { console.error(err); } }
          ui.toast(`🧹 ${n} ${n === 1 ? "Duplikat" : "Duplikate"} gelöscht`);
          close();
          if (onDeleted) onDeleted(n);
        }
      });
    },
  });
}
