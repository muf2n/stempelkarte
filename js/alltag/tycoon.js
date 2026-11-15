// ⚡ Strom-Tycoon (#alltag/tycoon) – eigenes Idle-Spiel. Logik: ../tycoon-core.js
// Bereiche: 🗺️ Karte · ⛏️ Welt · 🧭 Expedition · 🛒 Shop (+ Rucksack) · 🏆 Mehr (Fundstücke, Erfolge, Meisterbrief).
// Gespeichert in Sammlung „spiel“, Dokument "tycoon" (alle 20 s, beim Verlassen und nach wichtigen Aktionen).
// Echte Arbeit zählt: Wenn du heute gestempelt hast, läuft alles doppelt (Schicht-Bonus).
import { collection } from "./db.js";
import * as T from "../tycoon-core.js";
import * as SC from "./tycoon-scene.js";
import * as store from "../store.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const AMT_KEY = "sk-ty-amt", VIEW_KEY = "sk-ty-view";
const VIEWS = [["karte", "🗺️", "Karte"], ["welt", "⛏️", "Welt"], ["tour", "🧭", "Expedition"], ["shop", "🛒", "Shop"], ["mehr", "🏆", "Mehr"]];
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function loadCss() {
  if (document.querySelector('link[data-css="tycoon"]')) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.css = "tycoon";
  l.href = new URL("../../css/alltag-tycoon.css", import.meta.url).href; document.head.appendChild(l);
}
function workedToday() {
  try {
    const s = store.get(), t = dayKey();
    if (s && s.running && s.running.start) return true;
    return ((s && s.entries) || []).some((e) => e && (!e.kind || e.kind === "work") && dayKey(new Date(Number(e.start))) === t);
  } catch { return false; }
}
const sheetBtn = (label) => `<button type="button" class="btn primary" data-close style="width:100%;margin-top:8px">${label}</button>`;
function info(title, html, label = "Super!") {
  ui.openSheet({ title, bodyHTML: `<div class="ty-back">${html}</div>${sheetBtn(label)}`, onMount(sh, close) { sh.querySelector("[data-close]").addEventListener("click", close); } });
}

export function mount(el) {
  loadCss();
  const sp = collection("spiel");
  sp.get("tycoon"); // startet das Laden der Sammlung
  const S = { g: null, amt: ["1", "10", "100", "max"].includes(lsGet(AMT_KEY)) ? lsGet(AMT_KEY) : "1",
    view: VIEWS.some((v) => v[0] === lsGet(VIEW_KEY)) ? lsGet(VIEW_KEY) : "welt", alive: true, dirty: false,
    blitzAt: Date.now() + 25e3, blitzEl: null, newsI: Math.floor(Math.random() * T.NEWS.length), lastSave: Date.now(), shift: workedToday(), sig: "" };
  const opt = () => ({ boost: S.shift ? 2 : 1, now: Date.now() });

  function save(force) {
    if (!S.g) return;
    if (!force && !S.dirty && Date.now() - S.lastSave < 20e3) return;
    S.lastSave = Date.now(); S.dirty = false;
    try { const p = sp.put({ ...S.g, id: "tycoon" }); if (p && p.catch) p.catch(() => {}); } catch { /* offline egal */ }
  }
  function set(n, { redraw = true, persist = false } = {}) {
    if (!n) return false;
    S.g = n;
    const a = T.checkAch(S.g);
    if (a.fresh.length) { S.g = a.s; a.fresh.forEach((x, i) => setTimeout(() => ui.toast(`🏆 ${x.e} ${x.t}! +${x.f} 🔩`, 2600), 400 + i * 2700)); persist = true; }
    S.dirty = true;
    if (persist) save(true);
    if (redraw) render();
    return true;
  }
  function start() {
    const raw = sp.get("tycoon");
    let g = T.norm(raw || {}, Date.now());
    const off = T.offline(g, Date.now(), opt());
    S.g = off.s;
    render();
    if (!raw) welcome();
    else if (off.earned > 0 && off.secs > 60) info("👋 Willkommen zurück, Chef!", `<div class="ty-back-e" aria-hidden="true">🧑‍🔧💰</div><p>Du warst <b>${T.fmtDur(off.secs)}</b> weg.${off.used < off.secs ? ` Dein Akku hat <b>${T.fmtDur(off.used)}</b> gehalten.` : ""}</p><p>Deine Elektriker haben in der Zeit</p><div class="ty-back-big">+${T.fmt(off.earned)} €</div><p class="note">verdient. Und den Kaffee leer getrunken.</p>`, "Kassieren 💶");
    save(true);
  }
  function welcome() {
    info("⚡ Willkommen beim Strom-Tycoon!", `<div class="ty-back-e" aria-hidden="true">🏚️🐹</div><p>Opa hat dir seine Garage vermacht. Und einen Hamster.</p>
      <ol class="ty-how"><li>👆 <b>Einspeisen</b> antippen – Strom wird zu Geld.</li><li>🛒 Kraftwerke ausbauen, Stufe 10/25/50 … = <b>Ertrag ×2</b>.</li>
      <li>🧑‍🔧 <b>Elektriker anstellen</b> – dann läuft's von selbst, auch wenn die App zu ist.</li><li>🔌 Leitung und 🏭 Umspannwerk ausbauen – das schwächste Glied bremst!</li>
      <li>🧭 Trupp auf <b>Expedition</b> schicken – Fundstücke sammeln.</li><li>⚡ <b>Goldene Blitze</b> fangen, 🗺️ neue Welten freischalten.</li><li>💼 Heute echt gestempelt? Dann läuft alles <b>doppelt</b>.</li></ol>`, "Los geht's! 🐹");
  }

  /* ---------- Bausteine ---------- */
  const amtN = (lvl, id, ev) => {
    if (S.amt !== "max") return Number(S.amt);
    if (ev) { const E = T.evOf(S.g); return E ? Math.max(1, T.evMaxBuy(E.theme, id, lvl, E.money)) : 1; }
    return Math.max(1, T.maxBuy(S.g.cur, id, lvl, S.g.worlds[S.g.cur].money, S.g));
  };
  const readyTours = () => S.g.exp.filter((e) => e.end <= Date.now()).length;
  const invCount = () => Object.values(S.g.inv).reduce((a, b) => a + b, 0);

  function headHTML() {
    const g = S.g, Wd = T.world(g.cur);
    return `<section class="ty-head">
      <div class="ty-wname">${Wd.e} ${esc(Wd.name)}</div>
      <div class="ty-money"><b data-k="money"></b> €</div>
      <div class="ty-rate"><span data-k="rate"></span> €/s</div>
      <div class="ty-chips"><span title="Sicherungen">🔩 <b data-k="fuses"></b></span>${g.stars ? `<span title="Sterne aus Meisterbriefen">⭐ ${g.stars}</span>` : ""}<span data-k="boosts"></span></div>
    </section>`;
  }
  function navHTML() {
    const rt = readyTours(), inv = invCount();
    return `<nav class="ty-nav" role="tablist">${VIEWS.map(([id, e, l]) => `<button type="button" role="tab" aria-selected="${S.view === id}" class="${S.view === id ? "on" : ""}" data-a="view" data-v="${id}"><span aria-hidden="true">${e}</span>${l}${id === "tour" && rt ? `<i>${rt}</i>` : ""}${id === "shop" && inv ? `<i class="b">${inv}</i>` : ""}${id === "welt" && S.g.chestDay !== dayKey() ? `<i>🎁</i>` : ""}</button>`).join("")}</nav>`;
  }

  function mapHTML() {
    const rt = readyTours();
    const ev = T.evOf(S.g);
    return SC.mapHTML(S.g, { opt, badges: { tour: rt || "", rad: S.g.wheelDay !== dayKey() ? "!" : "", shop: invCount() || "", ev: ev && T.evClaimable(ev).length ? "🎁" : "" } });
  }

  function genHTML(g, wi) {
    const W = S.g.worlds[wi], st = W.gens[g.id];
    if (!T.visible(S.g, g.id)) return `<div class="ty-gen ty-lock"><span class="ty-ge" aria-hidden="true">❓</span><div><b>???</b><small>Kauf zuerst das Kraftwerk darüber.</small></div></div>`;
    const n = amtN(st.lvl, g.id), cost = T.genCost(wi, g.id, st.lvl, n, S.g), ms = T.nextMilestone(st.lvl);
    return `<div class="ty-gen${st.mgr ? " auto" : ""}${st.lvl ? "" : " new"}" data-g="${g.id}">
      <span class="ty-ge" aria-hidden="true">${g.e}</span>
      <div class="ty-gm"><b>${esc(g.name)}</b>${st.lvl ? ` <span class="ty-lv">Stufe ${st.lvl}</span>` : ""}<small class="ty-joke">${esc(g.joke)}</small>
        ${st.lvl ? `<small class="ty-out"><span data-k="out-${g.id}"></span> €/s${ms ? ` · noch ${ms - st.lvl} bis <b>×2</b>` : " · alle Boni ✓"}</small>` : ""}
        ${ms && st.lvl ? `<span class="ty-ms" aria-hidden="true"><i style="width:${(st.lvl / ms) * 100}%"></i></span>` : ""}</div>
      <div class="ty-ga">
        <button type="button" class="btn sm ty-buy" data-a="buy" data-id="${g.id}" data-cost="${cost}">${st.lvl ? `+${n}` : "Bauen"}<small>${T.fmt(cost)} €</small></button>
        ${st.lvl && !st.mgr ? `<button type="button" class="btn sm ty-mgr" data-a="hire" data-id="${g.id}" data-cost="${T.mgrCost(wi, g.id, S.g)}">🧑‍🔧 Anstellen<small>${T.fmt(T.mgrCost(wi, g.id, S.g))} €</small></button>` : ""}
      </div>
      ${st.lvl && !st.mgr ? `<button type="button" class="ty-tap" data-a="tap" data-id="${g.id}"><span class="ty-tapf" data-k="buf-bar-${g.id}"></span><span class="ty-tapt">⚡ Einspeisen <b data-k="buf-${g.id}"></b></span></button>` : ""}
      ${st.mgr ? `<div class="ty-run"><i></i><span>🧑‍🔧 läuft automatisch</span></div>` : ""}
    </div>`;
  }

  function worldHTML() {
    const g = S.g;
    return `<div class="ty-news" aria-live="off"><span data-k="news">${esc(T.NEWS[S.newsI % T.NEWS.length])}</span></div>
      ${S.shift ? `<div class="ty-shift on">💼 <b>Schicht-Bonus ×2</b> – du warst heute arbeiten. Respekt!</div>` : `<div class="ty-shift">💼 Heute noch nicht gestempelt – mit echter Arbeit läuft alles <b>doppelt</b>.</div>`}
      <div class="ty-amt" role="group" aria-label="Kaufmenge"><span>Kaufen:</span>${["1", "10", "100", "max"].map((a) => `<button type="button" data-a="amt" data-v="${a}" aria-pressed="${S.amt === a}">${a === "max" ? "MAX" : "×" + a}</button>`).join("")}</div>
      ${SC.mineHTML(g, { amtN, inv: invCount(), chest: g.chestDay !== dayKey() })}`;
  }

  function tourHTML() {
    const g = S.g, now = Date.now();
    const running = g.exp.map((e, i) => {
      const t = T.TOURS.find((x) => x.k === e.k), done = e.end <= now;
      return `<div class="ty-exp${done ? " done" : ""}"><span class="ty-ee" aria-hidden="true">${done ? "🎒" : t.e}</span>
        <div class="ty-em"><b>${esc(t.name)}</b>${done ? `<small>Zurück! Der Trupp hat was gefunden 👀</small>` : `<small>noch <span data-until="${e.end}"></span></small><span class="ty-use"><i data-prog="${e.start}-${e.end}"></i></span>`}</div>
        ${done ? `<button type="button" class="btn primary sm" data-a="claim" data-i="${i}">Auspacken!</button>` : `<button type="button" class="btn sm" data-a="rush" data-i="${i}" data-fuse="${T.rushCost(e, now)}">⚡ Sofort<small>${T.rushCost(e, now)} 🔩</small></button>`}</div>`;
    }).join("");
    const free = g.slots - g.exp.length;
    return `<section class="ty-card"><h3>🧭 Dein Expeditionstrupp</h3><p class="note">Schick deinen Trupp los – in Echtzeit, auch wenn die App zu ist. Je länger die Reise, desto besser die Beute: 💶 Geld, 🔩 Sicherungen, 🎒 Booster und seltene 🏺 Fundstücke.</p>
        ${running || ""}${free > 0 ? `<div class="ty-tours">${T.TOURS.map((t) => `<button type="button" class="ty-tour" data-a="tour" data-k="${t.k}"><span aria-hidden="true">${t.e}</span><b>${esc(t.name)}</b><small>${T.fmtDur(T.tourMs(g, t) / 1000)} · Fundstück ${Math.round(t.relic * 100)} %</small></button>`).join("")}</div>` : `<p class="note">Alle Plätze sind unterwegs. ${g.slots < T.SLOT_COST.length ? "Mehr Plätze unten." : ""}</p>`}
        ${g.slots < T.SLOT_COST.length ? `<button type="button" class="btn" data-a="slot" data-fuse="${T.SLOT_COST[g.slots]}" style="width:100%">➕ ${g.slots + 1}. Expeditions-Platz <small>${T.SLOT_COST[g.slots]} 🔩</small></button>` : ""}</section>
      ${relicsHTML()}`;
  }
  function relicsHTML() {
    const g = S.g, have = Object.keys(g.relics).length;
    return `<section class="ty-card"><h3>🏺 Fundstücke <small>${have}/${T.RELICS.length}</small></h3><p class="note">Bringt der Trupp mit. Doppelte machen das Fundstück stärker (bis Stufe ${T.RELIC_MAX}).</p>
      <div class="ty-relics">${T.RELICS.map((r) => { const l = g.relics[r.id] || 0; return `<div class="ty-relic${l ? "" : " no"}"><span aria-hidden="true">${l ? r.e : "❔"}</span><b>${l ? esc(r.name) : "???"}</b><small>${l ? `${esc(r.d)} · Stufe ${l}` : "noch nicht gefunden"}</small></div>`; }).join("")}</div></section>`;
  }

  function shopHTML() {
    const g = S.g, wi = g.cur, inv = Object.entries(g.inv);
    return `<section class="ty-card"><h3>🎒 Dein Rucksack</h3>${inv.length ? `<div class="ty-inv">${inv.map(([k, n]) => { const B = T.BOOSTS[k]; return `<button type="button" class="ty-item" data-a="use" data-k="${k}"><span aria-hidden="true">${B.e}</span><b>${esc(B.name)}</b><small>${esc(B.d)}</small><i>×${n}</i><em>Einsetzen</em></button>`; }).join("")}</div>` : `<p class="note">Leer. Booster findest du auf Expeditionen und in der Truhe – oder kauf sie unten.</p>`}</section>
      <section class="ty-card"><h3>🛒 Booster-Shop <small>🔩 ${g.fuses}</small></h3><div class="ty-shop">${T.SHOP.map((it) => { const B = T.BOOSTS[it.id]; return `<button type="button" class="ty-item" data-a="shop" data-id="${it.id}" data-fuse="${it.cost}"><span aria-hidden="true">${B.e}</span><b>${esc(B.name)}</b><small>${esc(B.d)}</small><em>${it.cost} 🔩</em></button>`; }).join("")}</div>
        <p class="note">🔩 Sicherungen gibt's aus der Truhe, von goldenen Blitzen, Expeditionen und für Erfolge. Kein echtes Geld – nie.</p></section>
      <section class="ty-card"><h3>🔋 Akku</h3><p class="note">Wie lange deine Elektriker offline weiterarbeiten: <b>${T.fmt(T.offlineHours(g))} h</b>.</p>
        ${g.akku < T.AKKU.length - 1 ? `<button type="button" class="btn" style="width:100%" data-a="akku" data-cost="${T.AKKU_COST[g.akku + 1] * Math.pow(1000, wi)}">🔋 ${T.AKKU[g.akku]} h → ${T.AKKU[g.akku + 1]} h · ${T.fmt(T.AKKU_COST[g.akku + 1] * Math.pow(1000, wi))} €</button>` : `<p class="note">Voll ausgebaut ✓</p>`}</section>`;
  }

  function moreHTML() {
    const g = S.g, gain = T.prestigeGain(g);
    return `<section class="ty-card"><h3>📜 Meisterbrief ${gain ? `<span class="ty-badge">+${gain} ⭐</span>` : ""}</h3>
        <p>Fang alle Welten von vorne an und bekomm dafür <b>Sterne</b>: jeder Stern = <b>+${Math.round((T.STAR_BONUS + T.relicFx(g, "star")) * 100)} % Ertrag für immer</b>. Sicherungen, Rucksack, Fundstücke, Erfolge und Akku bleiben.</p>
        <p class="note">Insgesamt verdient: ${T.fmt(g.allTime)} € · nächster Stern bei ${T.fmt(Math.pow(T.starsFor(g.allTime) + 1, 2) * T.STAR_BASE)} €</p>
        ${gain ? `<button type="button" class="btn primary" data-a="prestige" style="width:100%">📜 Meisterbrief holen (+${gain} ⭐)</button>` : `<p class="note">Noch zu wenig verdient – weiter schuften! 💪</p>`}</section>
      <section class="ty-card"><h3>🏆 Erfolge <small>${g.ach.length}/${T.ACH.length}</small></h3><ul class="ty-ach">${T.ACH.map((a) => `<li class="${g.ach.includes(a.id) ? "got" : ""}"><span aria-hidden="true">${g.ach.includes(a.id) ? a.e : "🔒"}</span><div><b>${esc(a.t)}</b><small>${esc(a.d)} · +${a.f} 🔩</small></div></li>`).join("")}</ul></section>
      <section class="ty-card"><h3>📊 Statistik</h3><ul class="ty-stats"><li>💶 Insgesamt verdient <b>${T.fmt(g.allTime)} €</b></li><li>⚡ Blitze gefangen <b>${g.blitze}</b></li><li>🧭 Expeditionen <b>${g.tours}</b></li><li>👆 Eingespeist <b>${g.taps}×</b></li><li>📜 Meisterbriefe <b>${g.resets}</b></li><li>📅 Truhen-Serie <b>${g.streak} Tage</b></li></ul>
        <button type="button" class="btn" data-a="help" style="width:100%">❓ Wie geht das Spiel?</button></section>`;
  }

  function render() {
    if (!S.alive) return;
    if (!S.g) { el.innerHTML = `<p class="note">Lade …</p>`; return; }
    const wi = S.g.cur;
    if (S.view === "event" && !T.evOf(S.g)) S.view = "karte";
    const body = S.view === "event" ? `<div class="ty-amt" role="group" aria-label="Kaufmenge"><span>Kaufen:</span>${["1", "10", "100", "max"].map((a) => `<button type="button" data-a="amt" data-v="${a}" aria-pressed="${S.amt === a}">${a === "max" ? "MAX" : "×" + a}</button>`).join("")}<button type="button" class="ty-all" data-a="view" data-v="karte">🗺️ Karte</button></div>${SC.eventHTML(S.g, T.evOf(S.g), { amtN })}` : S.view === "karte" ? mapHTML() : S.view === "tour" ? tourHTML() : S.view === "shop" ? shopHTML() : S.view === "mehr" ? moreHTML() : worldHTML();
    el.innerHTML = `<div class="ty" style="--wbg:${T.world(wi).bg}">${headHTML()}${navHTML()}<div class="ty-body">${body}</div><div class="ty-fx" aria-hidden="true"></div></div>`;
    S.sig = sig();
    refresh();
  }
  /** Änderungen, die ein komplettes Neuzeichnen brauchen (Expedition fertig, Abklingzeit …). */
  function sig() { const now = Date.now(), E = T.evOf(S.g); return [S.view, readyTours(), E ? T.evClaimable(E).length : -1, S.g.worlds[S.g.cur].abilCd > now, T.nextWorld(S.g)?.pct >= 1].join("|"); }

  function refresh() {
    if (!S.g || !el.querySelector(".ty")) return;
    if (sig() !== S.sig) { render(); return; }
    const g = S.g, wi = g.cur, W = g.worlds[wi], r = T.rates(g, wi, opt()), now = Date.now();
    const q = (k) => el.querySelector(`[data-k="${k}"]`);
    const txt = (k, v) => { el.querySelectorAll(`[data-k="${k}"]`).forEach((x) => { if (x.textContent !== v) x.textContent = v; }); };
    txt("money", T.fmt(W.money)); txt("rate", T.fmt(r.auto + r.manual)); txt("fuses", String(g.fuses));
    const act = g.boosts.filter((b) => b.until > now);
    txt("boosts", act.map((b) => `${b.k === "mega" ? "⚡" : b.k === "turbo" ? "🚀" : (T.BOOSTS[b.k] || {}).e || "✨"}×${b.m} ${T.fmtDur((b.until - now) / 1000)}`).join(" · "));
    el.querySelector(".ty-head")?.classList.toggle("boost", act.length > 0 || W.abilUntil > now);
    if (S.view === "welt") {
      txt("cap", T.fmt(r.cap * r.k)); txt("ucap", T.fmt(r.ucap * r.k)); txt("flow", T.fmt(r.auto));
      q("grid-box")?.classList.toggle("neck", r.neck === "grid"); q("umsp-box")?.classList.toggle("neck", r.neck === "umsp");
      txt("neck", !r.raw ? "Noch keine Elektriker – du speist selbst ein. Stell welche an, dann fließt der Strom automatisch!" : r.neck === "grid" ? "🔥 Die Leitung ist zu schwach – bau sie aus!" : r.neck === "umsp" ? "🔥 Das Umspannwerk schafft's nicht – bau es aus!" : "✅ Alles fließt. Bau mehr Kraftwerke!");
      const ab = W.abilUntil > now, cd = W.abilCd > now;
      txt("abil", ab ? `×${T.ABIL.m} · ${T.fmtDur((W.abilUntil - now) / 1000)}` : cd ? `in ${T.fmtDur((W.abilCd - now) / 1000)}` : `×${T.ABIL.m} für ${T.fmtDur(T.abilDur(g) / 1000)}`);
      const ae = el.querySelector(".ty-boost"); if (ae) { ae.disabled = cd; ae.classList.toggle("on", ab); ae.classList.toggle("ready", !cd); }
      const ab2 = q("abil-bar"); if (ab2) ab2.style.width = ab ? `${((W.abilUntil - now) / T.abilDur(g)) * 100}%` : cd ? `${(1 - (W.abilCd - now) / T.ABIL.cd) * 100}%` : "100%";
      for (const x of T.WORLDS[wi].gens) {
        const st = W.gens[x.id];
        txt(`out-${x.id}`, T.fmt(r.per[x.id]));
        if (st.lvl && !st.mgr) {
          const max = r.per[x.id] * T.BUF_SEC;
          txt(`buf-${x.id}`, `${T.fmt(st.buf)} €`);
          const bar = q(`buf-bar-${x.id}`); if (bar) { bar.style.height = `${max ? Math.min(100, (st.buf / max) * 100) : 0}%`; bar.parentElement.classList.toggle("full", max > 0 && st.buf >= max - 1e-9); }
        }
      }
      if (S.amt === "max") el.querySelectorAll('[data-a="buy"]').forEach((b) => {
        const st = W.gens[b.dataset.id]; if (!st || !st.lvl) return;
        const n = Math.max(1, T.maxBuy(wi, b.dataset.id, st.lvl, W.money, g)), c = T.genCost(wi, b.dataset.id, st.lvl, n, g);
        if (b.dataset.cost !== String(c)) { b.dataset.cost = String(c); b.innerHTML = `<b>Stufe ${st.lvl}</b><small>+${n} · ${T.fmt(c)} €</small>`; }
      });
    }
    if (S.view === "event") {
      const E = T.evOf(g); if (E) {
        const er = T.evRates(g, E, opt());
        txt("evmoney", T.fmt(E.money)); txt("evrate", T.fmt(er.auto + er.manual));
        for (const x of E.theme.gens) {
          const st = E.gens[x.id]; txt(`evout-${x.id}`, T.fmt(er.per[x.id]));
          if (st.lvl && !st.mgr) { const max = er.per[x.id] * T.BUF_SEC; txt(`evbuf-${x.id}`, T.fmt(st.buf)); const bar = q(`evbuf-bar-${x.id}`); if (bar) { bar.style.height = `${max ? Math.min(100, (st.buf / max) * 100) : 0}%`; bar.parentElement.classList.toggle("full", max > 0 && st.buf >= max - 1e-9); } }
        }
        el.querySelectorAll("[data-evcost]").forEach((b) => { b.disabled = E.money + 1e-9 < Number(b.dataset.evcost); });
        if (S.amt === "max") el.querySelectorAll('[data-a="evbuy"]').forEach((b) => { const st = E.gens[b.dataset.id]; if (!st || !st.lvl) return; const n = Math.max(1, T.evMaxBuy(E.theme, b.dataset.id, st.lvl, E.money)), c = T.evGenCost(E.theme, b.dataset.id, st.lvl, n); if (b.dataset.evcost !== String(c)) { b.dataset.evcost = String(c); b.innerHTML = `<b>Stufe ${st.lvl}</b><small>+${n} · ${T.fmt(c)} 🎫</small>`; } });
      }
    }
    el.querySelectorAll("[data-until]").forEach((x) => { x.textContent = T.fmtDur((Number(x.dataset.until) - now) / 1000); });
    el.querySelectorAll("[data-prog]").forEach((x) => { const [a, b] = x.dataset.prog.split("-").map(Number); x.style.width = `${Math.min(100, ((now - a) / (b - a)) * 100)}%`; });
    el.querySelectorAll("[data-cost]").forEach((b) => { b.disabled = W.money + 1e-9 < Number(b.dataset.cost); });
    el.querySelectorAll("[data-fuse]").forEach((b) => { b.disabled = g.fuses < Number(b.dataset.fuse); });
  }

  function pop(target, text, cls = "") {
    const fx = el.querySelector(".ty-fx"); if (!fx || !target) return;
    const tr = target.getBoundingClientRect(), br = el.querySelector(".ty").getBoundingClientRect();
    const p = document.createElement("span"); p.className = "ty-pop " + cls; p.textContent = text;
    p.style.left = `${tr.left - br.left + tr.width / 2}px`; p.style.top = `${tr.top - br.top}px`;
    fx.appendChild(p); setTimeout(() => p.remove(), 1100);
  }
  function spawnBlitz() {
    const host = el.querySelector(".ty"); if (!host || S.blitzEl) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "ty-blitz"; b.setAttribute("aria-label", "Goldener Blitz – schnell antippen!"); b.textContent = "⚡";
    b.style.left = `${8 + Math.random() * 70}%`; b.style.top = `${200 + Math.random() * Math.max(150, host.offsetHeight - 450)}px`;
    b.addEventListener("click", () => {
      const r = T.blitz(S.g, opt());
      pop(b, r.got ? `+${T.fmt(r.got)} €` : r.text.split(" ")[0], "gold");
      ui.toast(r.got ? `💰 Geldregen: +${T.fmt(r.got)} €!` : r.text, 2200);
      b.remove(); S.blitzEl = null; set(r.s, { persist: true });
    });
    host.appendChild(b); S.blitzEl = b;
    setTimeout(() => { if (S.blitzEl === b) { b.remove(); S.blitzEl = null; } }, 11e3);
  }
  function scrollToMe(smooth) {
    const oc = el.querySelector(".ty-ocean"); if (!oc) return;
    const y = oc.getBoundingClientRect().top + window.scrollY + oc.offsetHeight * SC.worldTop(S.g.cur) - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, y), behavior: smooth ? "smooth" : "auto" });
  }
  function wheelSheet() {
    let rot = 0, busy = false;
    const body = () => { const free = S.g.wheelDay !== dayKey(); return `<div class="ty-back">${SC.wheelSVG(rot)}<p class="ty-wres" aria-live="polite">${free ? "Heute 1× <b>gratis</b> drehen!" : `Nochmal drehen kostet <b>${T.WHEEL_COST} 🔩</b> (du hast ${S.g.fuses}).`}</p>
      <button type="button" class="btn primary" data-spin style="width:100%"${!free && S.g.fuses < T.WHEEL_COST ? " disabled" : ""}>🎡 ${free ? "Gratis drehen!" : `Drehen (${T.WHEEL_COST} 🔩)`}</button>
      <ul class="ty-wlist">${T.WHEEL.map((w) => `<li><span>${w.e}</span>${esc(w.t)}</li>`).join("")}</ul></div>`; };
    ui.openSheet({ title: "🎡 Glücksrad", bodyHTML: `<div data-wbody>${body()}</div>`, onMount(sh) {
      sh.addEventListener("click", (ev) => {
        if (!ev.target.closest("[data-spin]") || busy) return;
        const r = T.spin(S.g, dayKey(), opt()); if (!r) return;
        busy = true;
        const seg = 360 / T.WHEEL.length;
        rot += 360 * 5 + (360 - ((r.idx + 0.5) * seg) - (rot % 360));
        const svg = sh.querySelector(".ty-wsvg"); svg.style.transition = "transform 3.2s cubic-bezier(.15,.85,.2,1)"; svg.style.transform = `rotate(${rot}deg)`;
        sh.querySelector("[data-spin]").disabled = true;
        setTimeout(() => {
          set(r.s, { persist: true });
          const R = r.relic && T.RELICS.find((x) => x.id === r.relic);
          const txt = r.prize.k === "cash" ? `💶 +${T.fmt(r.got)} €` : R ? `🏺 Fundstück: ${R.e} ${R.name}!` : r.prize.k === "boost" ? `${r.prize.e} ${r.prize.t} in den Rucksack!` : `${r.prize.e} ${r.prize.t}!`;
          ui.toast(`🎉 ${txt}`, 2600);
          busy = false;
          const b = sh.querySelector("[data-wbody]"); if (b) { b.innerHTML = body(); b.querySelector(".ty-wres").innerHTML = `🎉 <b>${esc(txt)}</b>`; }
        }, 3300);
      });
    } });
  }
  function lootSheet(loot) {
    const R = loot.relic && T.RELICS.find((x) => x.id === loot.relic), lvl = R ? S.g.relics[R.id] : 0;
    const items = [`<li>💶 <b>+${T.fmt(loot.cash)} €</b></li>`, `<li>🔩 <b>+${loot.fuses}</b> Sicherungen</li>`,
      ...loot.boosts.map((k) => `<li>${T.BOOSTS[k].e} <b>${esc(T.BOOSTS[k].name)}</b> in den Rucksack</li>`)];
    info("🎒 Der Trupp ist zurück!", `<div class="ty-back-e" aria-hidden="true">🥾🎒</div><ul class="ty-loot">${items.map((x, i) => x.replace("<li>", `<li style="animation-delay:${i * 0.25}s">`)).join("")}</ul>
      ${R ? `<div class="ty-found" style="animation-delay:${items.length * 0.25 + 0.2}s"><span aria-hidden="true">${R.e}</span><b>${lvl > 1 ? "Fundstück verbessert!" : "Neues Fundstück!"}</b><div>${esc(R.name)} ${lvl > 1 ? `→ Stufe ${lvl}` : ""}</div><small>${esc(R.d)}${lvl > 1 ? ` (×${lvl})` : ""}</small></div>` : ""}`, "Einpacken 🎒");
  }

  /* ---------- Bedienung ---------- */
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-a]"); if (!b || !S.g || b.disabled) return;
    const id = b.dataset.id, now = Date.now();
    switch (b.dataset.a) {
      case "view": S.view = b.dataset.v; lsSet(VIEW_KEY, S.view); render(); if (S.view === "karte") scrollToMe(false); else el.querySelector(".ty-nav")?.scrollIntoView({ block: "nearest" }); break;
      case "goto": { const wi = Number(b.dataset.wi); set(T.goWorld(S.g, wi), { redraw: false }); S.view = "welt"; lsSet(VIEW_KEY, "welt"); render(); ui.toast(`🚐 Unterwegs nach ${T.world(wi).e} ${T.world(wi).name}`, 1200); break; }
      case "lockinfo": ui.toast("🔒 Noch gesperrt – verdiene genug in der Welt davor!", 1600); break;
      case "tap": { const r = T.collect(S.g, id); if (r.got > 0) { pop(b, `+${T.fmt(r.got)} €`); set(r.s, { redraw: false }); refresh(); } else pop(b, "⏳"); break; }
      case "all": { const r = T.collectAll(S.g); if (r.got > 0) { pop(b, `+${T.fmt(r.got)} €`); set(r.s, { redraw: false }); refresh(); } else ui.toast("Alle Puffer leer – kurz warten ⏳", 1200); break; }
      case "buy": {
        const st = S.g.worlds[S.g.cur].gens[id], before = st.lvl, n = amtN(st.lvl, id);
        if (set(T.buyGen(S.g, id, n))) {
          const after = S.g.worlds[S.g.cur].gens[id].lvl, g = T.WORLDS[S.g.cur].gens.find((x) => x.id === id);
          const hit = T.MILESTONES.filter((m) => before < m && after >= m);
          if (!before) ui.toast(`${g.e} ${g.name} gebaut!`, 1400);
          if (hit.length) ui.toast(`🎉 Stufe ${hit[hit.length - 1]}: ${g.name} macht jetzt ×${2 ** hit.length} mehr!`, 2400);
        }
        break;
      }
      case "hire": { const g = T.WORLDS[S.g.cur].gens.find((x) => x.id === id); if (set(T.hire(S.g, id), { persist: true })) ui.toast(`🧑‍🔧 Elektriker für ${g.e} angestellt – läuft jetzt von selbst!`, 2200); break; }
      case "grid": if (set(T.buyGrid(S.g))) ui.toast("🔌 Leitung verstärkt!", 1000); break;
      case "umsp": if (set(T.buyUmsp(S.g))) ui.toast("🏭 Umspannwerk ausgebaut!", 1000); break;
      case "abil": if (set(T.abil(S.g, now), { persist: true })) { ui.toast(`🧑‍🔧 „Hackln, Burschen!“ – ×${T.ABIL.m} für ${T.fmtDur(T.abilDur(S.g) / 1000)}`, 2200); pop(b, `×${T.ABIL.m}!`, "gold"); } break;
      case "amt": S.amt = b.dataset.v; lsSet(AMT_KEY, S.amt); render(); break;
      case "unlock": { const n = T.tryUnlock(S.g); if (set(n, { persist: true, redraw: false })) { S.view = "welt"; lsSet(VIEW_KEY, "welt"); render(); const w = T.world(n.cur); info(`🚀 Neue Welt: ${w.name}!`, `<div class="ty-back-e" aria-hidden="true">${w.e}</div><p>Willkommen in <b>${esc(w.name)}</b>! Neue Kraftwerke, neue Verrücktheiten.</p><p class="note">Deine alten Welten verdienen mit ihren Elektrikern weiter – schau ab und zu auf der 🗺️ Karte vorbei.</p>`, "Los! 🚀"); } break; }
      case "chest": {
        const d = new Date(); d.setDate(d.getDate() - 1);
        const r = T.chest(S.g, dayKey(), dayKey(d));
        if (r && set(r.s, { persist: true })) info("🎁 Truhe geöffnet!", `<div class="ty-back-e" aria-hidden="true">🎁</div><ul class="ty-loot"><li>🔩 <b>+${r.fuses}</b> Sicherungen</li>${r.boost ? `<li style="animation-delay:.25s">${T.BOOSTS[r.boost].e} <b>${esc(T.BOOSTS[r.boost].name)}</b> in den Rucksack</li>` : ""}</ul><p>${r.streak > 1 ? `🔥 ${r.streak} Tage in Folge! Morgen gibt's noch mehr.` : "Komm morgen wieder – die Serie bringt mehr!"}</p>`);
        break;
      }
      case "tour": { const t = T.TOURS.find((x) => x.k === b.dataset.k); if (set(T.startTour(S.g, b.dataset.k, now), { persist: true })) ui.toast(`${t.e} Trupp ist losgezogen – zurück in ${T.fmtDur(T.tourMs(S.g, t) / 1000)}`, 2200); break; }
      case "claim": { const r = T.claimTour(S.g, Number(b.dataset.i), opt()); if (r && set(r.s, { persist: true })) lootSheet(r.loot); break; }
      case "rush": if (set(T.rushTour(S.g, Number(b.dataset.i), now), { persist: true })) ui.toast("⚡ Trupp im Laufschritt zurück!", 1200); break;
      case "slot": if (set(T.buySlot(S.g), { persist: true })) ui.toast("➕ Neuer Expeditions-Platz!", 1400); break;
      case "use": { const B = T.BOOSTS[b.dataset.k], r = T.useInv(S.g, b.dataset.k, opt()); if (r && set(r.s, { persist: true })) ui.toast(r.got ? `${B.e} +${T.fmt(r.got)} €!` : `${B.e} ${B.name} aktiv!`, 2000); break; }
      case "shop": { const B = T.BOOSTS[id], r = T.shopBuy(S.g, id, opt()); if (r && set(r.s, { persist: true })) ui.toast(r.got ? `${B.e} +${T.fmt(r.got)} €!` : `${B.e} ${B.name} aktiv!`, 2000); break; }
      case "akku": if (set(T.buyAkku(S.g), { persist: true })) ui.toast(`🔋 Akku hält jetzt ${T.fmt(T.offlineHours(S.g))} h offline!`, 1800); break;
      case "help": welcome(); break;
      case "evsoon": { const I = T.eventInfo(); ui.toast(`🎪 Nächstes Event: ${I.nextTheme.e} ${I.nextTheme.name} – am ${new Date(I.nextStart).toLocaleDateString("de-AT")}`, 2600); break; }
      case "evbuy": { const E = T.evOf(S.g); if (!E) break; const st = E.gens[id], before = st.lvl; if (set(T.evBuy(S.g, id, amtN(st.lvl, id, true), now))) { const x = E.theme.gens.find((y) => y.id === id); if (!before) ui.toast(`${x.e} ${x.name} gebaut!`, 1400); } break; }
      case "evhire": if (set(T.evHire(S.g, id, now), { persist: true })) ui.toast("🧑‍🔧 Event-Elektriker angestellt!", 1500); break;
      case "evtap": { const r = T.evCollect(S.g, id, now); if (r.got > 0) { pop(b, `+${T.fmt(r.got)} 🎫`); set(r.s, { redraw: false }); refresh(); } else pop(b, "⏳"); break; }
      case "evclaim": { const r = T.evClaim(S.g, now); if (r && set(r.s, { persist: true })) info("🎁 Event-Belohnung!", `<div class="ty-back-e" aria-hidden="true">🎪</div><ul class="ty-loot">${r.got.map((x, i) => `<li style="animation-delay:${i * 0.25}s">${esc(x)}</li>`).join("")}</ul>`); break; }
      case "rad": wheelSheet(); break;
      case "relics": S.view = "tour"; lsSet(VIEW_KEY, "tour"); render(); setTimeout(() => el.querySelector(".ty-relics")?.scrollIntoView({ block: "center", behavior: "smooth" }), 50); break;
      case "findme": scrollToMe(true); break;
      case "prestige": {
        const gain = T.prestigeGain(S.g);
        ui.openSheet({ title: "📜 Meisterbrief holen?", bodyHTML: `<p>Alle Welten, Kraftwerke, Elektriker und dein Geld starten <b>neu</b>. Dafür bekommst du <b>+${gain} ⭐</b> – mehr Ertrag für immer.</p><p class="note">Sicherungen, Rucksack, Fundstücke, Erfolge und Akku bleiben.</p><div class="row" style="gap:8px"><button type="button" class="btn" data-no>Doch nicht</button><button type="button" class="btn primary" data-yes>📜 Ja, Meisterbrief!</button></div>`,
          onMount(sh, close) {
            sh.querySelector("[data-no]").addEventListener("click", close);
            sh.querySelector("[data-yes]").addEventListener("click", () => { close(); if (set(T.prestige(S.g, Date.now()), { persist: true })) ui.toast(`📜 Herzlichen Glückwunsch, Meister! ⭐ ${S.g.stars}`, 2800); });
          } });
        break;
      }
    }
  });

  /* ---------- Spielschleife ---------- */
  let last = Date.now(), newsT = Date.now();
  const loop = setInterval(() => {
    if (!S.alive) return;
    if (!S.g) { if (sp.loaded) start(); return; }
    const now = Date.now(), dt = (now - last) / 1000; last = now;
    if (document.hidden) return;
    S.g = T.tick(S.g, Math.min(dt, 5), opt());
    refresh();
    if (now - newsT > 12e3) { newsT = now; S.newsI++; const n = el.querySelector('[data-k="news"]'); if (n) { n.textContent = T.NEWS[S.newsI % T.NEWS.length]; n.style.animation = "none"; void n.offsetWidth; n.style.animation = ""; } }
    if (now >= S.blitzAt) { S.blitzAt = now + T.nextBlitzIn(S.g) * 1000; spawnBlitz(); }
    save(false);
  }, 200);
  const onVis = () => {
    if (!S.g) return;
    if (document.hidden) { save(true); return; }
    const off = T.offline(S.g, Date.now(), opt()); last = Date.now(); S.shift = workedToday();
    S.g = off.s; render();
    if (off.earned > 0 && off.secs > 60) ui.toast(`👋 Während du weg warst: +${T.fmt(off.earned)} €`, 2600);
  };
  document.addEventListener("visibilitychange", onVis);
  if (sp.loaded) start(); else render();
  return () => { S.alive = false; clearInterval(loop); document.removeEventListener("visibilitychange", onVis); save(true); };
}
