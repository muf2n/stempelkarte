// ⚡ Strom-Tycoon – ⛏️ Bergwerk-Ansicht einer Welt + 🎪 Event-Ansicht. Eigene Datei (Agent „Bergwerk“).
// Vertrag: export mineHTML(g, { amtN, inv, chest }) und eventHTML(g, ev, { amtN }); data-a/data-k/data-cost/data-evcost siehe js/alltag/tycoon.js (refresh + Klicks).
import * as T from "../tycoon-core.js";
import { esc } from "../util.js";
/* ---------- Bergwerk-Ansicht einer Welt ---------- */
export function mineHTML(g, { amtN, rates, abil, inv, chest }) {
  const wi = g.cur, Wd = T.world(wi), W = g.worlds[wi];
  const gens = Wd.gens.filter((x) => T.visible(g, x.id));
  const rows = gens.map((x, i) => {
    const st = W.gens[x.id];
    if (!st.lvl) {
      const c = T.genCost(wi, x.id, 0, 1, g);
      return `<div class="ty-row rock" data-g="${x.id}"><span class="ty-num">${i + 1}</span><div class="ty-rock"><span class="ty-rk" aria-hidden="true">🪨🪨🪨</span>
        <div><b>${x.e} ${esc(x.name)}</b><small>${esc(x.joke)}</small></div><button type="button" class="btn sm ty-buy" data-a="buy" data-id="${x.id}" data-cost="${c}">🔨 Bauen<small>${T.fmt(c)} €</small></button></div></div>`;
    }
    const n = amtN(st.lvl, x.id), cost = T.genCost(wi, x.id, st.lvl, n, g), ms = T.nextMilestone(st.lvl);
    return `<div class="ty-row${st.mgr ? " auto" : ""}" data-g="${x.id}"><span class="ty-num">${i + 1}</span>
      <div class="ty-stollen">
        ${st.mgr ? `<span class="ty-pile auto" aria-label="läuft automatisch">💰<b><span data-k="out-${x.id}"></span>/s</b></span>`
          : `<button type="button" class="ty-pile" data-a="tap" data-id="${x.id}"><span class="ty-pf" data-k="buf-bar-${x.id}"></span>💰<b data-k="buf-${x.id}"></b></button>`}
        ${st.mgr ? `<span class="ty-boss" title="Elektriker angestellt" aria-hidden="true">🧑‍🔧</span>` : `<button type="button" class="ty-hire" data-a="hire" data-id="${x.id}" data-cost="${T.mgrCost(wi, x.id, g)}">➕🧑‍🔧<small>${T.fmt(T.mgrCost(wi, x.id, g))} €</small></button>`}
        <span class="ty-worker" aria-hidden="true">👷</span>
        <span class="ty-gen-e" aria-hidden="true">${x.e}</span>
        <button type="button" class="ty-lvl" data-a="buy" data-id="${x.id}" data-cost="${cost}"><b>Stufe ${st.lvl}</b><small>+${n} · ${T.fmt(cost)} €</small></button>
      </div>
      <div class="ty-rowinfo"><b>${esc(x.name)}</b> <span>${st.mgr ? "" : '<span data-k="out-' + x.id + '"></span> €/s · '}${ms ? `noch ${ms - st.lvl} bis ×2` : "alle Boni ✓"}</span>${ms ? `<span class="ty-ms"><i style="width:${(st.lvl / ms) * 100}%"></i></span>` : ""}</div>
    </div>`;
  }).join("");
  const nw = T.nextWorld(g);
  return `<section class="ty-mine" style="--wbg:${Wd.bg}">
    <div class="ty-surface">
      <div class="ty-sun" aria-hidden="true"></div>
      <div class="ty-tower" data-k="grid-box"><span class="ty-bld" aria-hidden="true">🗼</span><b>Leitung</b><small>Stufe ${W.grid} · <span data-k="cap"></span>/s</small>
        <button type="button" class="ty-up" data-a="grid" data-cost="${T.gridCost(wi, W.grid)}">⬆ ${T.fmt(T.gridCost(wi, W.grid))} €</button></div>
      <div class="ty-road"><span class="ty-truck" aria-hidden="true">🚚</span><span class="ty-flow">💶 <b data-k="flow"></b> €/s</span></div>
      <div class="ty-tower right" data-k="umsp-box"><span class="ty-bld" aria-hidden="true">🏭</span><b>Umspannwerk</b><small>Stufe ${W.umsp} · <span data-k="ucap"></span>/s</small>
        <button type="button" class="ty-up" data-a="umsp" data-cost="${T.umspCost(wi, W.umsp)}">⬆ ${T.fmt(T.umspCost(wi, W.umsp))} €</button></div>
    </div>
    <p class="ty-neck" data-k="neck"></p>
    <div class="ty-shaftwrap"><div class="ty-shaft" aria-hidden="true"><span class="ty-cabin">⚡</span></div><div class="ty-rows">${rows}</div></div>
    ${nw ? `<div class="ty-deep"><span aria-hidden="true">🪨⛏️🪨</span><b>${wi === g.unlocked ? `Nächste Welt: ${esc(T.world(nw.wi).name)}` : "Die Karte hat noch mehr Welten"}</b><small>Verdiene in „${esc(T.world(g.unlocked).name)}“ ${T.fmt(nw.need)} €</small><span class="ty-use"><i data-k="next" style="width:${nw.pct * 100}%"></i></span>${nw.pct >= 1 ? `<button type="button" class="btn primary" data-a="unlock">🚀 Freischalten!</button>` : ""}</div>` : `<div class="ty-deep"><b>🌌 Du besitzt das Universum.</b></div>`}
  </section>
  <div class="ty-dock">
    <button type="button" class="ty-dbtn" data-a="view" data-v="shop">🛒<small>Shop</small>${inv ? `<i>${inv}</i>` : ""}</button>
    <button type="button" class="ty-dbtn" data-a="chest"${chest ? "" : " disabled"}>🎁<small>Truhe</small>${chest ? "<i>!</i>" : ""}</button>
    <button type="button" class="ty-boost" data-a="abil"><span class="ty-abil-f" data-k="abil-bar"></span><span class="ty-abil-t">▶❙ Boost! <small data-k="abil"></small></span></button>
    <button type="button" class="ty-dbtn" data-a="all">💰<small>Alles</small></button>
    <button type="button" class="ty-dbtn" data-a="view" data-v="karte">🗺️<small>Karte</small></button>
  </div>`;
}

/* ---------- 🎪 Event-Ansicht ---------- */
export function eventHTML(g, ev, { amtN }) {
  const th = ev.theme, I = ev.info, can = T.evClaimable(ev);
  const ms = I.end - Date.now(), d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5);
  const gens = th.gens.filter((x) => T.evVisible(ev, x.id));
  const rows = gens.map((x, i) => {
    const st = ev.gens[x.id];
    if (!st.lvl) { const c = T.evGenCost(th, x.id, 0); return `<div class="ty-row rock"><span class="ty-num">${i + 1}</span><div class="ty-rock"><span class="ty-rk" aria-hidden="true">🪨🪨</span><div><b>${x.e} ${esc(x.name)}</b><small>${esc(x.joke)}</small></div><button type="button" class="btn sm ty-buy" data-a="evbuy" data-id="${x.id}" data-evcost="${c}">🔨 Bauen<small>${T.fmt(c)} 🎫</small></button></div></div>`; }
    const n = amtN(st.lvl, x.id, true), c = T.evGenCost(th, x.id, st.lvl, n), mc = T.evMgrCost(th, x.id);
    return `<div class="ty-row${st.mgr ? " auto" : ""}"><span class="ty-num">${i + 1}</span><div class="ty-stollen">
      ${st.mgr ? `<span class="ty-pile auto">🎫<b><span data-k="evout-${x.id}"></span>/s</b></span>` : `<button type="button" class="ty-pile" data-a="evtap" data-id="${x.id}"><span class="ty-pf" data-k="evbuf-bar-${x.id}"></span>🎫<b data-k="evbuf-${x.id}"></b></button>`}
      ${st.mgr ? `<span class="ty-boss" aria-hidden="true">🧑‍🔧</span>` : `<button type="button" class="ty-hire" data-a="evhire" data-id="${x.id}" data-evcost="${mc}">➕🧑‍🔧<small>${T.fmt(mc)} 🎫</small></button>`}
      <span class="ty-worker" aria-hidden="true">👷</span><span class="ty-gen-e" aria-hidden="true">${x.e}</span>
      <button type="button" class="ty-lvl" data-a="evbuy" data-id="${x.id}" data-evcost="${c}"><b>Stufe ${st.lvl}</b><small>+${n} · ${T.fmt(c)} 🎫</small></button></div>
      <div class="ty-rowinfo"><b>${esc(x.name)}</b></div></div>`;
  }).join("");
  const max = Math.log10(T.EV_TRACK[T.EV_TRACK.length - 1].at), pos = (v) => Math.max(0, Math.min(100, (Math.log10(Math.max(1, v)) / max) * 100));
  return `<section class="ty-evhead" style="--ebg:${th.bg}"><div class="ty-evtop"><span class="ty-eve" aria-hidden="true">${th.e}</span><div><b>🎪 ${esc(th.name)}</b><small>Event endet in ${d ? `${d} T ` : ""}${h} h</small></div></div>
      <div class="ty-evmoney">🎫 <b data-k="evmoney"></b><small><span data-k="evrate"></span> 🎫/s</small></div>
      <div class="ty-evtrack"><span class="ty-evbar"><i data-k="evbar" style="width:${pos(ev.total)}%"></i></span>${T.EV_TRACK.map((x, i) => `<span class="ty-evm${ev.claimed.includes(i) ? " got" : ev.total >= x.at ? " ready" : ""}" style="left:${pos(x.at)}%" title="${esc(x.t)} (ab ${T.fmt(x.at)} 🎫)">${x.e}</span>`).join("")}</div>
      ${can.length ? `<button type="button" class="btn primary" data-a="evclaim">🎁 ${can.length} Belohnung${can.length > 1 ? "en" : ""} abholen!</button>` : `<small>Nächste Belohnung: ${(() => { const nx = T.EV_TRACK.find((x, i) => !ev.claimed.includes(i) && ev.total < x.at); return nx ? `${nx.e} ${esc(nx.t)} bei ${T.fmt(nx.at)} 🎫 gesamt` : "alles geholt – Champion! 🏆"; })()}</small>`}
    </section>
    <section class="ty-mine" style="--wbg:${th.bg}"><div class="ty-shaftwrap"><div class="ty-shaft" aria-hidden="true"><span class="ty-cabin">${th.e}</span></div><div class="ty-rows">${rows}</div></div></section>
    <p class="note">🎫 Event-Münzen gibt's nur während des Events. Elektriker arbeiten auch hier offline weiter. Alle 3 Wochen kommt ein neues Event!</p>`;
}
