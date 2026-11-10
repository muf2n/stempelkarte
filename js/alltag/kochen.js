// Update 12 – Alltag › 🍳 Kochen (#alltag/kochen[/<rezept-id>]): Rezeptbuch, Wochen-Essensplan, „Was kann ich kochen?“
// (aus dem Vorrat), Einkaufsliste aus Plan/Rezept, Koch-Timer aus den Schritten, Rezept-Import per Text, Allergene.
// Daten: „rezepte“, „essensplan“; liest „vorrat“, schreibt „einkauf“. Logik: ./rezepte-core.js
import { collection } from "./db.js";
import * as R from "./rezepte-core.js";
import * as A from "./akten-ui.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const TAB_KEY = "sk-kochen-tab", PREF_KEY = "sk-kochen-prefs";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const TABS = [["buch", "📖", "Rezepte"], ["plan", "📅", "Wochenplan"], ["vorrat", "🥫", "Was koche ich?"]];
const timers = new Map(); // läuft über Ansichtswechsel weiter: id → { end, label, t }

function loadCss() {
  if (document.querySelector('link[data-css="kochen"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.dataset.css = "kochen";
  l.href = new URL("../../css/alltag-kochen.css", import.meta.url).href;
  document.head.appendChild(l);
}
const routeId = (h) => { const m = String(h || "").match(/^#alltag\/kochen\/([^/?]+)/); return m ? decodeURIComponent(m[1]) : ""; };
function prefs() { try { const p = JSON.parse(lsGet(PREF_KEY) || "{}"); return { noAllergens: Array.isArray(p.noAllergens) ? p.noAllergens : [], diet: p.diet || "" }; } catch { return { noAllergens: [], diet: "" }; } }

export function mount(el) {
  loadCss();
  const col = { rec: collection("rezepte"), plan: collection("essensplan"), stock: collection("vorrat"), shop: collection("einkauf") };
  const S = { tab: TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "buch", id: routeId(location.hash), q: "", cat: "", fav: false,
    week: R.mondayOf(A.todayKey()), servings: {}, ...prefs() };
  let alive = true, queued = false, tick = null;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };
  const recipes = () => col.rec.all().map(R.normRecipe).filter((r) => r.id && r.title);

  function render() {
    const ae = document.activeElement;
    if (ae && el.contains(ae) && ae.matches('[data-kc="q"]')) { renderBody(); return; } // Suche: nur Liste neu
    const r = S.id ? recipes().find((x) => x.id === S.id) : null;
    if (S.id && !r && col.rec.loaded) S.id = "";
    el.innerHTML = `<div class="kc">${r ? "" : `<div class="kc-tabs" role="tablist">${TABS.map(([id, e, l]) => `<button type="button" role="tab" class="kc-tab${S.tab === id ? " on" : ""}" aria-selected="${S.tab === id}" data-tab="${id}"><span aria-hidden="true">${e}</span>${l}</button>`).join("")}</div>`}
      ${timerBar()}<div data-kc="body"></div></div>`;
    renderBody();
  }
  function renderBody() {
    const body = el.querySelector('[data-kc="body"]');
    if (!body) return;
    const r = S.id ? recipes().find((x) => x.id === S.id) : null;
    body.innerHTML = r ? detailHTML(r) : S.tab === "plan" ? planHTML() : S.tab === "vorrat" ? stockHTML() : bookHTML();
  }

  /* ---------- Rezeptbuch ---------- */
  function bookHTML() {
    const all = recipes();
    if (!col.rec.loaded && !all.length) return `<p class="note">Lade …</p>`;
    if (!all.length) return A.emptyHTML("🍳", "Dein Rezeptbuch", "Sammle deine Lieblingsrezepte – mit Portionen-Rechner, Koch-Timer und Einkaufsliste per Tipp. Rezepte aus dem Netz einfach als Text einfügen. 😋", "", "") +
      `<div class="kc-row kc-center"><button type="button" class="btn primary sm" data-kc="new">➕ Rezept anlegen</button><button type="button" class="btn ghost sm" data-kc="import">📋 Text einfügen</button></div>`;
    const list = R.filterRecipes(all, { q: S.q, cat: S.cat, diet: S.diet, noAllergens: S.noAllergens, fav: S.fav });
    const cats = R.CATS.filter(([id]) => all.some((x) => x.cat === id));
    return `<div class="kc-bar"><input type="search" data-kc="q" placeholder="🔍 Rezept oder Zutat" value="${esc(S.q)}" aria-label="Rezepte suchen">
        <button type="button" class="btn primary sm" data-kc="new" aria-label="Neues Rezept">➕</button><button type="button" class="btn ghost sm" data-kc="import" aria-label="Rezept als Text einfügen">📋</button><button type="button" class="btn ghost sm" data-kc="prefs" aria-label="Allergene und Ernährung">⚙️</button></div>
      <div class="chips"><button type="button" class="chip" data-cat="" aria-pressed="${!S.cat && !S.fav}">Alle</button><button type="button" class="chip" data-fav="1" aria-pressed="${S.fav}">⭐ Lieblinge</button>${cats.map(([id, e, l]) => `<button type="button" class="chip" data-cat="${id}" aria-pressed="${S.cat === id}">${e} ${l}</button>`).join("")}</div>
      ${S.noAllergens.length || S.diet ? `<p class="note">Filter aktiv: ${[S.diet && R.DIETS.find((d) => d[0] === S.diet)[1], S.noAllergens.length && `ohne ${S.noAllergens.join(", ")}`].filter(Boolean).join(" · ")}</p>` : ""}
      ${list.length ? `<ul class="kc-grid">${list.map((r) => `<li><button type="button" class="kc-card" data-open="${esc(r.id)}"><span class="kc-emo" aria-hidden="true">${esc(r.emoji)}</span><b>${esc(r.title)}</b>
        <small>${[r.fav && "⭐", r.minutes && `⏱️ ${r.minutes} min`, `🍽️ ${r.servings}`, r.rating && "★".repeat(r.rating), r.diet === "vegan" ? "🌱" : r.diet === "vegetarisch" ? "🥕" : ""].filter(Boolean).join(" · ")}</small></button></li>`).join("")}</ul>`
        : `<p class="note">Nichts gefunden – probier einen anderen Filter.</p>`}`;
  }

  /* ---------- Detail ---------- */
  function detailHTML(r) {
    const sv = S.servings[r.id] || r.servings;
    return `<div class="kc-detail">
      <div class="kc-row"><button type="button" class="btn ghost sm" data-kc="back">← Rezepte</button><span class="kc-sp"></span>
        <button type="button" class="btn ghost sm" data-kc="fav" aria-pressed="${r.fav}" aria-label="Liebling">${r.fav ? "⭐" : "☆"}</button>
        <button type="button" class="btn ghost sm" data-kc="share" aria-label="Teilen">📤</button><button type="button" class="btn ghost sm" data-kc="edit" aria-label="Bearbeiten">✏️</button></div>
      <header class="kc-head"><span class="kc-emo big" aria-hidden="true">${esc(r.emoji)}</span><div><h2>${esc(r.title)}</h2>
        <small>${[R.catBy(r.cat)[2], r.minutes && `⏱️ ${r.minutes} min`, r.diet && R.DIETS.find((d) => d[0] === r.diet)[1], r.allergens.length && `Allergene: ${r.allergens.join(", ")}`].filter(Boolean).join(" · ")}</small>
        <div class="kc-rate" role="group" aria-label="Bewertung">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-rate="${n}" aria-label="${n} Sterne" class="${n <= r.rating ? "on" : ""}">★</button>`).join("")}</div></div></header>
      <section class="card"><div class="kc-row"><h3>🧾 Zutaten</h3><span class="kc-sp"></span>
        <div class="kc-sv"><button type="button" class="btn ghost sm" data-sv="-1" aria-label="Weniger Portionen">−</button><b>${sv} ${sv === 1 ? "Portion" : "Portionen"}</b><button type="button" class="btn ghost sm" data-sv="1" aria-label="Mehr Portionen">+</button></div></div>
        <ul class="kc-ings">${r.ingredients.map((i) => `<li>${esc(R.ingText(i, r.servings, sv))}</li>`).join("") || `<li class="note">Keine Zutaten eingetragen.</li>`}</ul>
        ${r.ingredients.length ? `<button type="button" class="btn ghost sm" data-kc="toshop">🛒 Fehlendes auf die Einkaufsliste</button>` : ""}</section>
      <section class="card"><h3>👩‍🍳 Zubereitung</h3><ol class="kc-steps">${r.steps.map((t) => `<li><p>${esc(t)}</p>${R.stepTimers(t).map((x) => `<button type="button" class="chip sm" data-timer="${x.sec}" data-label="${esc(r.title + ": " + x.label)}">⏲️ ${esc(x.label)}</button>`).join("")}</li>`).join("") || `<li class="note">Noch keine Schritte.</li>`}</ol>
        <button type="button" class="chip sm" data-kc="owntimer">⏲️ Eigener Timer</button></section>
      ${r.note ? `<section class="card"><h3>📝 Notiz</h3><p class="kc-note">${esc(r.note)}</p></section>` : ""}
      ${r.source ? `<a class="kc-src" href="${esc(r.source)}" target="_blank" rel="noopener noreferrer">🔗 Original-Rezept</a>` : ""}
      <button type="button" class="btn ghost sm" data-kc="toplan">📅 In den Wochenplan</button>
    </div>`;
  }

  /* ---------- Wochenplan ---------- */
  function planHTML() {
    const byId = new Map(recipes().map((r) => [r.id, r]));
    const days = Array.from({ length: 7 }, (_, i) => R.addDays(S.week, i));
    const today = A.todayKey();
    return `<div class="kc-row kc-week"><button type="button" class="btn ghost sm" data-wk="-7" aria-label="Woche davor">‹</button><b>${R.fmtShort(days[0])} – ${R.fmtShort(days[6])}</b><button type="button" class="btn ghost sm" data-wk="7" aria-label="Woche danach">›</button></div>
      <ul class="kc-plan">${days.map((d) => {
        const doc = R.normDay(col.plan.get(d) || { id: d });
        return `<li class="${d === today ? "today" : ""}"><b class="kc-day">${R.fmtShort(d)}</b><div class="kc-meals">${R.MEALS.map(([m, e, l]) => {
          const v = doc.meals[m], rc = v && v.recipeId ? byId.get(v.recipeId) : null;
          return v ? `<button type="button" class="kc-meal set" data-meal="${m}" data-day="${d}">${e} ${esc(rc ? rc.emoji + " " + rc.title : v.text)}${v.servings ? ` <small>×${v.servings}</small>` : ""}</button>`
            : (m === "snack" ? "" : `<button type="button" class="kc-meal" data-meal="${m}" data-day="${d}" aria-label="${l} am ${R.fmtShort(d)} planen">${e} <span>${l}</span></button>`);
        }).join("")}</div></li>`;
      }).join("")}</ul>
      <button type="button" class="btn primary sm" data-kc="planshop">🛒 Einkaufsliste für diese Woche</button>
      <p class="note">Was du schon im Vorrat hast, wird abgezogen. Salz, Pfeffer, Öl und Wasser kommen nicht auf die Liste.</p>`;
  }

  /* ---------- Was kann ich kochen? ---------- */
  function stockHTML() {
    const stock = col.stock.all();
    if (!stock.length) return A.emptyHTML("🥫", "Erst den Vorrat füllen", "Trag unter Haushalt › 🥫 Vorrat ein, was du daheim hast – dann schlage ich dir hier passende Rezepte vor.", "", "") +
      `<div class="kc-row kc-center"><a class="btn ghost sm" href="#alltag/haushalt/vorrat">🥫 Zum Vorrat</a></div>`;
    const sg = R.suggestFromStock(R.filterRecipes(recipes(), { diet: S.diet, noAllergens: S.noAllergens }), stock, { min: 0.4 });
    if (!sg.length) return `<p class="note">🤔 Mit deinem Vorrat passt gerade kein Rezept (mind. 40 % der Zutaten). Leg mehr Rezepte an oder füll den Vorrat auf.</p>`;
    return `<p class="note">Sortiert danach, wie viel du schon daheim hast:</p><ul class="kc-sug">${sg.map((x) => `<li><button type="button" class="kc-card wide" data-open="${esc(x.recipe.id)}"><span class="kc-emo" aria-hidden="true">${esc(x.recipe.emoji)}</span>
      <span><b>${esc(x.recipe.title)}</b><small>${Math.round(x.score * 100)} % da${x.missing.length ? ` · fehlt: ${esc(x.missing.slice(0, 4).join(", "))}` : " · alles da! 🎉"}</small></span>
      <span class="kc-pct" style="--p:${Math.round(x.score * 100)}%" aria-hidden="true"></span></button></li>`).join("")}</ul>`;
  }

  /* ---------- Timer ---------- */
  function timerBar() {
    if (!timers.size) return "";
    const now = Date.now();
    return `<div class="kc-timers" role="status">${[...timers.entries()].map(([id, t]) => { const left = Math.max(0, Math.round((t.end - now) / 1000));
      return `<span class="kc-tm${left === 0 ? " done" : ""}">⏲️ <b data-tleft="${id}">${R.fmtTimer(left)}</b> ${esc(t.label)}<button type="button" data-tstop="${id}" aria-label="Timer beenden">✕</button></span>`; }).join("")}</div>`;
  }
  function startTimer(sec, label) {
    const id = Date.now().toString(36);
    const t = { end: Date.now() + sec * 1000, label, rang: false };
    t.t = setTimeout(() => ring(t), sec * 1000);
    timers.set(id, t);
    ui.toast(`⏲️ Timer läuft: ${R.fmtTimer(sec)}`, 1600);
    render(); ensureTick();
  }
  function ring(t) {
    t.rang = true;
    ui.toast(`🔔 Zeit ist um: ${t.label}`, 6000);
    try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch { /* egal */ }
    try { const C = window.AudioContext || window.webkitAudioContext; if (C) { const c = new C(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; o.connect(g); g.connect(c.destination); g.gain.value = 0.15; o.start(); o.stop(c.currentTime + 0.8); } } catch { /* egal */ }
    if (alive) render();
  }
  function ensureTick() {
    if (tick || !timers.size) return;
    tick = setInterval(() => {
      if (!alive || !timers.size) { clearInterval(tick); tick = null; return; }
      const now = Date.now();
      for (const [id, t] of timers) { const b = el.querySelector(`[data-tleft="${id}"]`); if (b) b.textContent = R.fmtTimer(Math.max(0, Math.round((t.end - now) / 1000))); }
    }, 1000);
  }

  /* ---------- Formulare ---------- */
  function editRecipe(r0, preset) {
    const isNew = !r0;
    const r = R.normRecipe(r0 || preset || { cat: "haupt" });
    ui.openSheet({
      title: isNew ? "🍳 Neues Rezept" : "Rezept bearbeiten",
      bodyHTML: `<div class="fields">
        <div class="row"><label style="flex:0 0 4.5em">Emoji<input id="kc-emo" maxlength="4" value="${esc(r.emoji)}"></label><label>Name<input id="kc-title" maxlength="100" value="${esc(r.title)}" placeholder="z. B. Kaiserschmarrn"></label></div>
        <div class="row"><label>Art<select id="kc-cat">${R.CATS.map(([id, e, l]) => `<option value="${id}"${r.cat === id ? " selected" : ""}>${e} ${l}</option>`).join("")}</select></label>
          <label>Portionen<input id="kc-sv" inputmode="numeric" value="${r.servings}"></label><label>Minuten<input id="kc-min" inputmode="numeric" value="${r.minutes || ""}"></label></div>
        <label>Zutaten (eine pro Zeile, z. B. „200 g Mehl“)<textarea id="kc-ings" rows="6">${esc(r.ingredients.map((i) => R.ingText(i, 1, 1)).join("\n"))}</textarea></label>
        <label>Zubereitung (ein Schritt pro Zeile)<textarea id="kc-steps" rows="6" placeholder="Zeiten wie „10 Minuten“ werden zu Timer-Knöpfen">${esc(r.steps.join("\n"))}</textarea></label>
        <label>Ernährung<select id="kc-diet">${R.DIETS.map(([id, l]) => `<option value="${id}"${r.diet === id ? " selected" : ""}>${id ? l : "– keine Angabe –"}</option>`).join("")}</select></label>
        <div class="lbl">Allergene</div><div class="chips" data-r="al">${R.ALLERGENS.map(([id, l]) => `<button type="button" class="chip sm" data-al="${id}" aria-pressed="${r.allergens.includes(id)}">${id} ${l}</button>`).join("")}</div>
        <label>Tags (mit Komma)<input id="kc-tags" value="${esc(r.tags.join(", "))}" placeholder="schnell, billig, meal-prep"></label>
        <label>Notiz<textarea id="kc-note" rows="2">${esc(r.note)}</textarea></label>
        <label>Quelle (Link, optional)<input id="kc-src" type="url" value="${esc(r.source)}" placeholder="https://…"></label></div>
        <div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        const al = new Set(r.allergens);
        $('[data-r="al"]').addEventListener("click", (ev) => { const c = ev.target.closest("[data-al]"); if (!c) return; al.has(c.dataset.al) ? al.delete(c.dataset.al) : al.add(c.dataset.al); c.setAttribute("aria-pressed", String(al.has(c.dataset.al))); });
        $("[data-save]").addEventListener("click", async () => {
          const title = $("#kc-title").value.trim();
          if (!title) { ui.toast("Bitte einen Namen eingeben."); return; }
          const doc = R.normRecipe({ ...r, id: r.id || undefined, title, emoji: $("#kc-emo").value.trim(), cat: $("#kc-cat").value, servings: $("#kc-sv").value, minutes: $("#kc-min").value,
            ingredients: $("#kc-ings").value.split("\n").filter((l) => l.trim()), steps: $("#kc-steps").value.split("\n").map((l) => l.replace(/^\d+[.)]\s*/, "")),
            diet: $("#kc-diet").value, allergens: [...al], tags: $("#kc-tags").value.split(","), note: $("#kc-note").value, source: $("#kc-src").value });
          close();
          const id = await col.rec.put(isNew ? { ...doc, id: undefined } : doc).catch((e) => { console.error(e); ui.toast("Speichern hat nicht geklappt."); return null; });
          if (id) { ui.toast(isNew ? `${doc.emoji} ${title} gespeichert 😋` : "Gespeichert ✓"); if (isNew) A.go(R.recipeHash(id)); }
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Rezept löschen?", () => { close(); A.safe(col.rec.remove(r.id), "Gelöscht 🗑️"); A.go(R.recipeHash("")); });
      },
    });
  }
  function importText() {
    ui.openSheet({
      title: "📋 Rezept einfügen",
      bodyHTML: `<div class="fields"><p class="note">Kopier ein Rezept (z. B. von einer Webseite) und füg es hier ein. Erste Zeile = Name, dann „Zutaten“ und „Zubereitung“.</p>
        <textarea id="kc-paste" rows="12" placeholder="Kaiserschmarrn&#10;Für 2 Portionen&#10;Zutaten&#10;3 Eier&#10;200 ml Milch&#10;…&#10;Zubereitung&#10;1. Eier trennen …"></textarea></div>
        <div class="row"><button type="button" class="btn primary" data-go>Weiter ›</button></div>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-go]").addEventListener("click", () => {
          const r = R.parseRecipeText(sheet.querySelector("#kc-paste").value);
          if (!r || !r.title) { ui.toast("Da war kein Text drin."); return; }
          close(); editRecipe(null, r);
        });
      },
    });
  }
  function prefSheet() {
    ui.openSheet({
      title: "⚙️ Ernährung & Allergene",
      bodyHTML: `<div class="fields"><label>Ernährung<select id="kp-diet">${R.DIETS.map(([id, l]) => `<option value="${id}"${S.diet === id ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <div class="lbl">Rezepte mit diesen Allergenen ausblenden</div><div class="chips" data-r="al">${R.ALLERGENS.map(([id, l]) => `<button type="button" class="chip sm" data-al="${id}" aria-pressed="${S.noAllergens.includes(id)}">${id} ${l}</button>`).join("")}</div></div>
        <div class="row"><button type="button" class="btn primary" data-save>Übernehmen</button></div>`,
      onMount(sheet, close) {
        const al = new Set(S.noAllergens);
        sheet.querySelector('[data-r="al"]').addEventListener("click", (ev) => { const c = ev.target.closest("[data-al]"); if (!c) return; al.has(c.dataset.al) ? al.delete(c.dataset.al) : al.add(c.dataset.al); c.setAttribute("aria-pressed", String(al.has(c.dataset.al))); });
        sheet.querySelector("[data-save]").addEventListener("click", () => { S.diet = sheet.querySelector("#kp-diet").value; S.noAllergens = [...al]; lsSet(PREF_KEY, JSON.stringify({ diet: S.diet, noAllergens: S.noAllergens })); close(); render(); });
      },
    });
  }
  function mealSheet(day, meal) {
    const doc = R.normDay(col.plan.get(day) || { id: day });
    const cur = doc.meals[meal] || {};
    const list = R.filterRecipes(recipes(), { diet: S.diet, noAllergens: S.noAllergens });
    const m = R.MEALS.find((x) => x[0] === meal);
    ui.openSheet({
      title: `${m[1]} ${m[2]} · ${R.fmtShort(day)}`,
      bodyHTML: `<div class="fields"><label>Rezept<select id="km-rec"><option value="">– freier Text –</option>${list.map((r) => `<option value="${esc(r.id)}"${cur.recipeId === r.id ? " selected" : ""}>${esc(r.emoji + " " + r.title)}</option>`).join("")}</select></label>
        <label>…oder einfach notieren<input id="km-text" maxlength="100" value="${esc(cur.text || "")}" placeholder="z. B. Pizza bestellen, Mensa"></label>
        <label>Portionen (leer = wie im Rezept)<input id="km-sv" inputmode="numeric" value="${cur.servings || ""}"></label></div>
        <div class="row">${cur.recipeId || cur.text ? `<button type="button" class="btn ghost sm" data-clear>Leeren</button>` : ""}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        const save = async (v) => { const meals = { ...doc.meals }; if (v) meals[meal] = v; else delete meals[meal]; close(); await A.safe(col.plan.put({ id: day, meals }), v ? "📅 Eingeplant" : "Geleert"); };
        $("[data-save]").addEventListener("click", () => { const recipeId = $("#km-rec").value, text = $("#km-text").value.trim(); if (!recipeId && !text) { save(null); return; } save({ recipeId, text, servings: Number($("#km-sv").value) || 0 }); });
        const c = $("[data-clear]"); if (c) c.addEventListener("click", () => save(null));
      },
    });
  }
  function toPlanSheet(r) {
    const days = Array.from({ length: 14 }, (_, i) => R.addDays(A.todayKey(), i));
    ui.openSheet({
      title: `📅 ${r.title} einplanen`,
      bodyHTML: `<div class="fields"><label>Tag<select id="kt-day">${days.map((d) => `<option value="${d}">${R.fmtShort(d)}</option>`).join("")}</select></label>
        <label>Mahlzeit<select id="kt-meal">${R.MEALS.map(([m, e, l]) => `<option value="${m}"${m === "abend" ? " selected" : ""}>${e} ${l}</option>`).join("")}</select></label></div>
        <div class="row"><button type="button" class="btn primary" data-save>Einplanen</button></div>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const day = sheet.querySelector("#kt-day").value, meal = sheet.querySelector("#kt-meal").value;
          const doc = R.normDay(col.plan.get(day) || { id: day });
          close();
          await A.safe(col.plan.put({ id: day, meals: { ...doc.meals, [meal]: { recipeId: r.id, text: "", servings: S.servings[r.id] || 0 } } }), `📅 ${R.fmtShort(day)} eingeplant`);
        });
      },
    });
  }
  async function addToShopping(items) {
    const open = col.shop.all().filter((i) => i && !i.done).map((i) => String(i.name || "").toLowerCase());
    const add = items.filter((x) => !open.includes(x.name.toLowerCase()));
    if (!add.length) { ui.toast("Steht schon alles auf der Einkaufsliste 👍"); return; }
    const now = Date.now();
    if (await A.safe(Promise.all(add.map((x) => col.shop.put({ listId: "privat", name: x.name.slice(0, 80), qty: x.qty, unit: R.shopUnit(x.unit), cat: "lebensmittel", done: false, note: x.note || "", created: now }))))) {
      ui.toast(`🛒 ${add.length} ${add.length === 1 ? "Zutat" : "Zutaten"} auf die Einkaufsliste (Privat)`);
    }
  }

  /* ---------- Ereignisse ---------- */
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button, a"); if (!b || !el.contains(b)) return;
    const r = S.id ? recipes().find((x) => x.id === S.id) : null;
    const d = b.dataset;
    if (d.tab) { S.tab = d.tab; lsSet(TAB_KEY, S.tab); render(); return; }
    if (d.open) { A.go(R.recipeHash(d.open)); return; }
    if (d.cat != null && !d.fav) { S.cat = d.cat; S.fav = false; renderBody(); return; }
    if (d.fav) { S.fav = !S.fav; S.cat = ""; renderBody(); return; }
    if (d.wk) { S.week = R.addDays(S.week, Number(d.wk)); renderBody(); return; }
    if (d.meal) { mealSheet(d.day, d.meal); return; }
    if (d.timer) { startTimer(Number(d.timer), d.label || "Timer"); return; }
    if (d.tstop) { const t = timers.get(d.tstop); if (t) clearTimeout(t.t); timers.delete(d.tstop); render(); return; }
    if (d.sv && r) { S.servings[r.id] = Math.max(1, Math.min(50, (S.servings[r.id] || r.servings) + Number(d.sv))); renderBody(); return; }
    if (d.rate && r) { A.safe(col.rec.put({ ...r, rating: Number(d.rate) === r.rating ? 0 : Number(d.rate) })); return; }
    switch (d.kc) {
      case "new": editRecipe(null); break;
      case "import": importText(); break;
      case "prefs": prefSheet(); break;
      case "back": A.go(R.recipeHash("")); break;
      case "edit": if (r) editRecipe(r); break;
      case "fav": if (r) A.safe(col.rec.put({ ...r, fav: !r.fav }), r.fav ? null : "⭐ Liebling!"); break;
      case "share": if (r) navigator.clipboard?.writeText(R.shareText(r, S.servings[r.id])).then(() => ui.toast("📋 Rezept kopiert")).catch(() => ui.toast("Kopieren nicht möglich")); break;
      case "toplan": if (r) toPlanSheet(r); break;
      case "toshop": if (r) {
        const sv = S.servings[r.id] || r.servings;
        const days = [{ id: "0000-00-00", meals: { mittag: { recipeId: r.id, servings: sv } } }];
        addToShopping(R.shoppingFromPlan(days, [r], "0000-00-00", "0000-00-00", col.stock.all()).map((x) => ({ ...x, note: r.title })));
      } break;
      case "planshop": {
        const list = R.shoppingFromPlan(col.plan.all(), col.rec.all(), S.week, R.addDays(S.week, 6), col.stock.all());
        if (!list.length) { ui.toast("Nichts zu kaufen – plan erst Rezepte ein oder alles ist schon da 👍"); break; }
        addToShopping(list.map((x) => ({ ...x, note: "Essensplan" })));
      } break;
      case "owntimer":
        ui.openSheet({
          title: "⏲️ Eigener Timer",
          bodyHTML: `<div class="fields"><label>Minuten<input id="kt-min" inputmode="decimal" value="10"></label></div><div class="row"><button type="button" class="btn primary" data-go>Starten</button></div>`,
          onMount(sheet, close) {
            sheet.querySelector("[data-go]").addEventListener("click", () => {
              const n = Number(String(sheet.querySelector("#kt-min").value || "").replace(",", "."));
              if (!(n > 0 && n <= 600)) { ui.toast("Bitte 1–600 Minuten."); return; }
              close(); startTimer(Math.round(n * 60), r ? r.title : "Timer");
            });
          },
        });
        break;
      default: break;
    }
  });
  el.addEventListener("input", (ev) => { if (ev.target.matches('[data-kc="q"]')) { S.q = ev.target.value; renderBody(); } });
  const offRoute = A.onRoute((h) => { if (!/^#alltag\/kochen/.test(h)) return; const id = routeId(h); if (id !== S.id) { S.id = id; render(); window.scrollTo({ top: 0 }); } });
  const offs = Object.values(col).map((c) => c.watch(queue));
  render(); ensureTick();
  return () => { alive = false; offRoute(); offs.forEach((f) => { try { f(); } catch { /* egal */ } }); if (tick) clearInterval(tick); tick = null; };
}
