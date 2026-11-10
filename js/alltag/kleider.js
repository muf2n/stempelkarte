// Update 12 – Alltag › 👕 Kleiderschrank (#alltag/kleider): Kleidung mit Foto, Kategorie, Saison, Wärme und Pflegehinweis,
// Outfits zusammenstellen, Vorschlag passend zum Wetter (Open-Meteo aus dem Wetter-Widget), Outfit-Kalender (getragen/geplant),
// Saison-Übersicht, „lange nicht getragen“ und Reise-Packassistent. Sammlungen „kleidung“, „outfits“.
import { collection } from "./db.js";
import * as X from "./extras-core.js";
import * as U from "./xui.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const TABS = [["schrank", "👕", "Schrank"], ["outfits", "✨", "Outfits"], ["kalender", "📅", "Kalender"], ["packen", "🧳", "Packen"]];

export function mount(el) {
  U.loadCss("extras");
  const col = { cl: collection("kleidung"), of: collection("outfits") };
  const S = { tab: TABS.some((t) => t[0] === U.lsGet("sk-kleider-tab")) ? U.lsGet("sk-kleider-tab") : "schrank", cat: "", season: "", days: 5, packSeason: X.seasonOf(U.todayKey()) };
  let alive = true, weather = null;
  import("../weather.js").then((W) => { const st = W.state(); weather = st && st.data; if (!weather) W.refresh(); W.onChange(() => { weather = W.state().data; if (alive && S.tab === "outfits") render(); }); if (alive) render(); }).catch(() => {});
  const clothes = () => col.cl.all().map(X.normCloth).filter((c) => c.id && c.name);
  const outfits = () => col.of.all().map(X.normOutfit).filter((o) => o.id);
  const catOf = (id) => X.CLOTH_CATS.find((c) => c[0] === id) || X.CLOTH_CATS[0];
  const tile = (c, attrs = "") => `<button type="button" class="xu-tile" ${attrs}>${c.photo ? `<img src="${esc(c.photo)}" alt="">` : `<span class="xu-ph" aria-hidden="true">${catOf(c.cat)[1]}</span>`}<b>${c.fav ? "⭐ " : ""}${esc(c.name)}</b><small>${esc([c.color, c.care].filter(Boolean).join(" · "))}</small></button>`;

  function render() {
    if (!alive) return;
    el.innerHTML = `<div class="xu">${U.tabsHTML(TABS, S.tab)}${S.tab === "outfits" ? outfitsHTML() : S.tab === "kalender" ? calHTML() : S.tab === "packen" ? packHTML() : wardrobeHTML()}</div>`;
  }
  function wardrobeHTML() {
    const all = clothes();
    if (!col.cl.loaded && !all.length) return `<p class="note">Lade …</p>`;
    if (!all.length) return `${U.empty("👕", "Dein digitaler Kleiderschrank", "Fotografier deine Lieblingsteile – dann kannst du Outfits zusammenstellen, bekommst Vorschläge passend zum Wetter und packst für Reisen in Sekunden.")}<div class="xu-row" style="justify-content:center"><button type="button" class="btn primary sm" data-x="new">📷 Erstes Teil</button></div>`;
    const list = all.filter((c) => (!S.cat || c.cat === S.cat) && (!S.season || !c.seasons.length || c.seasons.includes(S.season)));
    const st = X.wardrobeStats(all, U.todayKey());
    return `<div class="xu-row"><button type="button" class="btn primary sm" data-x="new">➕ Teil</button><span class="xu-sp"></span><small class="note">${st.total} Teile</small></div>
      <div class="chips"><button type="button" class="chip sm" data-cat="" aria-pressed="${!S.cat}">Alle</button>${X.CLOTH_CATS.filter(([k]) => all.some((c) => c.cat === k)).map(([k, e, l]) => `<button type="button" class="chip sm" data-cat="${k}" aria-pressed="${S.cat === k}">${e} ${l}</button>`).join("")}</div>
      <div class="chips">${X.SEASONS.map(([k, e, l]) => `<button type="button" class="chip sm" data-season="${k}" aria-pressed="${S.season === k}">${e} ${l} <small>${st.bySeason[k]}</small></button>`).join("")}</div>
      <ul class="xu-grid">${list.map((c) => `<li>${tile(c, `data-ed="${esc(c.id)}"`)}</li>`).join("") || `<li class="note">Nichts in diesem Filter.</li>`}</ul>
      ${st.unused.length ? `<section class="card"><h3>🧺 Lange nicht getragen (${st.unused.length})</h3><p class="note">${esc(st.unused.slice(0, 8).map((c) => c.name).join(", "))}${st.unused.length > 8 ? " …" : ""} – verschenken, verkaufen oder wieder anziehen?</p></section>` : ""}`;
  }
  function outfitsHTML() {
    const today = U.todayKey(), cs = clothes(), os = outfits();
    const cur = weather && weather.current, day0 = weather && weather.days && weather.days[0];
    const sug = X.suggestOutfits(os, cs, { temp: cur ? cur.temp : null, rain: !!(day0 && (day0.rainProb >= 50 || day0.rain >= 1)), today });
    const byId = new Map(cs.map((c) => [c.id, c]));
    return `${cur ? `<section class="card"><b>${cur.emoji} ${Math.round(cur.temp)} °C</b> – ${esc(cur.text)}${day0 && day0.rainProb >= 50 ? " · ☔ Regen wahrscheinlich" : ""}${sug[0] ? `<p>💡 Vorschlag für heute: <b>${esc(sug[0].outfit.name || "Outfit")}</b></p><div class="xu-row"><button type="button" class="btn primary sm" data-wear="${esc(sug[0].outfit.id)}">👕 Heute anziehen</button></div>` : ""}</section>` : `<p class="note">🌦️ Stell im Überblick das Wetter ein, dann gibt's Vorschläge passend zur Temperatur.</p>`}
      <div class="xu-row"><button type="button" class="btn primary sm" data-x="newoutfit"${cs.length < 2 ? " disabled" : ""}>➕ Outfit zusammenstellen</button></div>
      ${os.length ? `<ul class="xu-list">${(sug.length ? sug.map((x) => x.outfit) : os).map((o) => `<li><button type="button" class="xu-item" data-of="${esc(o.id)}"><span class="xu-ie">${o.fav ? "⭐" : "✨"}</span><span class="xu-im"><b>${esc(o.name || "Outfit")}</b><small>${esc(o.items.map((i) => (byId.get(i) || {}).name).filter(Boolean).join(" + "))}${o.worn.length ? ` · zuletzt ${X.fmtDay(o.worn[o.worn.length - 1])}` : ""}</small></span></button></li>`).join("")}</ul>` : cs.length < 2 ? `<p class="note">Leg erst ein paar Teile im Schrank an.</p>` : ""}`;
  }
  function calHTML() {
    const today = U.todayKey(), os = outfits();
    const days = Array.from({ length: 21 }, (_, i) => X.addDays(today, 7 - i));
    return `<p class="note">Was du getragen hast (✅) und was geplant ist (📌). Tipp auf einen Tag, um ein Outfit einzutragen.</p><ul class="xu-list">${days.map((d) => {
      const worn = os.filter((o) => o.worn.includes(d)), plan = os.filter((o) => o.plan.includes(d));
      return `<li><button type="button" class="xu-item${d === today ? " warn" : ""}" data-day="${d}"><span class="xu-ie" style="font-size:.85rem">${X.fmtDay(d).slice(0, 6)}</span><span class="xu-im"><b>${worn.length ? worn.map((o) => "✅ " + esc(o.name || "Outfit")).join(", ") : plan.length ? plan.map((o) => "📌 " + esc(o.name || "Outfit")).join(", ") : "–"}</b></span></button></li>`;
    }).join("")}</ul>`;
  }
  function packHTML() {
    const res = X.packFor(clothes(), S.days, S.packSeason);
    return `<section class="card"><div class="row"><label>Tage<input id="pk-days" type="number" min="1" max="30" value="${S.days}"></label><label>Saison<select id="pk-season">${X.SEASONS.map(([k, e, l]) => `<option value="${k}"${S.packSeason === k ? " selected" : ""}>${e} ${l}</option>`).join("")}</select></label></div></section>
      <ul class="xu-check">${res.map((r) => `<li><span>${catOf(r.cat)[1]}</span><span style="flex:1"><b>${r.want}× ${esc(catOf(r.cat)[2])}</b><small>${r.items.length ? esc(r.items.map((c) => c.name).join(", ")) : "Nichts Passendes im Schrank eingetragen"}</small></span></li>`).join("")}
        <li><span>🧦</span><span style="flex:1"><b>${S.days + 1}× Unterwäsche & Socken</b></span></li><li><span>🧴</span><span style="flex:1"><b>Pflege & Ladekabel</b><small>Den Rest packst du mit den Packlisten unter Unterwegs.</small></span></li></ul>
      <button type="button" class="btn ghost sm" data-x="copypack">📋 Als Liste kopieren</button>`;
  }

  async function editCloth(c0) {
    const isNew = !c0; const c = X.normCloth(c0 || { cat: S.cat || "oberteil" });
    let photo = c.photo;
    U.form({ title: isNew ? "👕 Neues Teil" : "Bearbeiten", fields: [
      { type: "html", html: `<div class="xu-row"><button type="button" class="btn ghost sm" data-photo>📷 ${photo ? "Foto ändern" : "Foto aufnehmen"}</button><small data-phok class="note">${photo ? "✅ Foto da" : ""}</small></div>` },
      { id: "name", label: "Bezeichnung", value: c.name, placeholder: "z. B. Schwarzer Hoodie" },
      { type: "row", fields: [{ id: "cat", label: "Art", type: "select", value: c.cat, options: X.CLOTH_CATS.map(([k, e, l]) => [k, `${e} ${l}`]) }, { id: "color", label: "Farbe", value: c.color, max: 30 }] },
      { id: "seasons", label: "Saison (leer = ganzjährig)", type: "chips", value: c.seasons, options: X.SEASONS.map(([k, e, l]) => [k, `${e} ${l}`]) },
      { type: "row", fields: [{ id: "warmth", label: "Wärme", type: "select", value: c.warmth, options: [[1, "🌞 leicht"], [2, "🌤️ mittel"], [3, "❄️ warm"]] }, { id: "care", label: "Pflege", type: "select", value: c.care, options: X.CARE.map((v) => [v, v || "–"]) }] },
      { id: "fav", label: "⭐ Lieblingsteil", type: "check", value: c.fav }, { id: "note", label: "Notiz", value: c.note, max: 300 },
    ], onSave: (v) => { if (!v.name) { ui.toast("Bitte eine Bezeichnung."); return false; } U.safe(col.cl.put({ ...c, ...v, warmth: Number(v.warmth), photo, id: c.id || undefined }), isNew ? "👕 Im Schrank!" : "Gespeichert ✓"); },
    onDelete: isNew ? null : () => U.safe(col.cl.remove(c.id), "Gelöscht") });
    const sh = document.querySelector(".sheet:last-child"), btn = sh && sh.querySelector("[data-photo]");
    if (btn) btn.addEventListener("click", async () => { const p = await U.pickPhoto(); if (p) { photo = p; sh.querySelector("[data-phok]").textContent = "✅ Foto da"; } });
  }
  function editOutfit(o0) {
    const isNew = !o0; const o = X.normOutfit(o0 || {}); const cs = clothes();
    const chosen = new Set(o.items);
    U.form({ title: isNew ? "✨ Neues Outfit" : esc(o.name || "Outfit"), fields: [
      { id: "name", label: "Name", value: o.name, placeholder: "z. B. Freitag-Abend, Baustelle Winter" },
      { type: "html", html: `<div class="lbl">Teile auswählen</div><ul class="xu-grid" data-pick>${cs.map((c) => `<li>${tile(c, `data-pid="${esc(c.id)}" aria-pressed="${chosen.has(c.id)}"`)}</li>`).join("")}</ul>` },
      { id: "fav", label: "⭐ Lieblingsoutfit", type: "check", value: o.fav },
    ], onSave: (v) => { if (!chosen.size) { ui.toast("Wähl mindestens ein Teil."); return false; } U.safe(col.of.put({ ...o, name: v.name || "Outfit", fav: v.fav, items: [...chosen], id: o.id || undefined }), isNew ? "✨ Outfit gespeichert" : "Gespeichert ✓"); },
    onDelete: isNew ? null : () => U.safe(col.of.remove(o.id), "Gelöscht") });
    const sh = document.querySelector(".sheet:last-child"), g = sh && sh.querySelector("[data-pick]");
    if (g) g.addEventListener("click", (ev) => { const t = ev.target.closest("[data-pid]"); if (!t) return; chosen.has(t.dataset.pid) ? chosen.delete(t.dataset.pid) : chosen.add(t.dataset.pid); t.setAttribute("aria-pressed", String(chosen.has(t.dataset.pid))); });
  }
  function wear(oid, day, mode = "worn") {
    const o = X.normOutfit(col.of.get(oid) || {}); if (!o.id) return;
    const n = { ...o, [mode]: [...new Set([...o[mode], day])], plan: mode === "worn" ? o.plan.filter((d) => d !== day) : [...new Set([...o.plan, day])] };
    U.safe(col.of.put(n), mode === "worn" ? "👕 Eingetragen – sieht gut aus!" : "📌 Geplant");
    if (mode === "worn") for (const id of o.items) { const c = X.normCloth(col.cl.get(id) || {}); if (c.id) col.cl.put({ ...c, worn: [...new Set([...c.worn, day])] }).catch(() => {}); }
  }
  function daySheet(day) {
    const os = outfits(), today = U.todayKey();
    U.form({ title: `📅 ${X.fmtDay(day)}`, fields: [{ id: "of", label: "Outfit", type: "select", value: "", options: [["", "– wählen –"], ...os.map((o) => [o.id, o.name || "Outfit"])] }],
      saveLabel: day <= today ? "✅ Getragen" : "📌 Planen", onSave: (v) => { if (!v.of) return false; wear(v.of, day, day <= today ? "worn" : "plan"); } });
  }

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b || !el.contains(b)) return;
    const d = b.dataset;
    if (d.tab) { S.tab = d.tab; U.lsSet("sk-kleider-tab", S.tab); render(); return; }
    if (d.cat != null) { S.cat = d.cat; render(); return; }
    if (d.season) { S.season = S.season === d.season ? "" : d.season; render(); return; }
    if (d.ed) { editCloth(col.cl.get(d.ed)); return; }
    if (d.of) { editOutfit(col.of.get(d.of)); return; }
    if (d.wear) { wear(d.wear, U.todayKey()); return; }
    if (d.day) { daySheet(d.day); return; }
    if (d.x === "new") editCloth(null);
    else if (d.x === "newoutfit") editOutfit(null);
    else if (d.x === "copypack") {
      const t = X.packFor(clothes(), S.days, S.packSeason).map((r) => `${r.want}× ${catOf(r.cat)[2]}${r.items.length ? ": " + r.items.map((c) => c.name).join(", ") : ""}`).join("\n") + `\n${S.days + 1}× Unterwäsche & Socken`;
      navigator.clipboard?.writeText(t).then(() => ui.toast("📋 Kopiert")).catch(() => ui.toast("Kopieren nicht möglich"));
    }
  });
  el.addEventListener("change", (ev) => {
    if (ev.target.id === "pk-days") { S.days = Math.max(1, Math.min(30, Number(ev.target.value) || 5)); render(); }
    if (ev.target.id === "pk-season") { S.packSeason = ev.target.value; render(); }
  });
  const offs = Object.values(col).map((c) => c.watch(() => queueMicrotask(render)));
  render();
  return () => { alive = false; offs.forEach((f) => f()); };
}
