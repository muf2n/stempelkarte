// Update 12 – Alltag › 🎮 Spielwelt (#alltag/spiel): Avatar, Level & XP aus echten Aktivitäten, Weltkarte mit freischaltbaren
// Zonen, Skilltree, Tages-/Wochenquests (laufen ohne Strafe ab), Erfolge inkl. versteckter, Münzen & Shop, virtuelles Haustier,
// Saison-Events und Mini-Games (Entscheidungsrad, Zufalls-Challenge, Ohm-Blitz). Logik: ../spiel-core.js + ../life-core.js
// Gespeichert nur Spiel-Kleinkram: Sammlung „spiel“, Dokument "me".
import { collection } from "./db.js";
import * as L from "../life-core.js";
import * as G from "../spiel-core.js";
import { watchLife } from "./life-data.js";
import * as A from "./akten-ui.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const TAB_KEY = "sk-spiel-tab";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const TABS = [["welt", "🗺️", "Welt"], ["quests", "🎯", "Quests"], ["erfolge", "🏆", "Erfolge"], ["shop", "🛍️", "Shop"], ["spiele", "🎲", "Spiele"]];
const AVATARS = ["🧑‍🔧", "👷", "🧑‍🎓", "🦸", "🧙", "🥷", "🧑‍🚀", "🐻", "🦊", "🐸"];
function loadCss() {
  if (document.querySelector('link[data-css="spiel"]')) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.css = "spiel";
  l.href = new URL("../../css/alltag-spiel.css", import.meta.url).href; document.head.appendChild(l);
}

export function mount(el) {
  loadCss();
  const sp = collection("spiel");
  const S = { tab: TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "welt", taps: 0, ohm: null, wheelDeg: 0, wheelRes: "", challenge: "" };
  let inp = null, alive = true, ohmTimer = null;
  const me = () => G.normMe(sp.get("me") || {});
  const save = (m, ok) => A.safe(sp.put({ ...m, id: "me" }), ok);
  const live = watchLife((x) => { inp = x; render(); });
  const offSp = sp.watch(() => { if (inp && !S.ohm) render(); });
  const h = new Date().getHours();
  if (h >= 0 && h < 4) setTimeout(() => { const m = me(); if (!m.secret.nacht && sp.loaded) save({ ...m, secret: { ...m.secret, nacht: Date.now() } }, "🦉 Geheimer Erfolg: Nachteule!"); }, 1500);

  function model() {
    const acts = L.activities(inp), today = A.todayKey(), m = me();
    const lv = G.levelOf(G.totalXp(acts)), axp = G.xpByArea(acts), st = G.stats(acts);
    const q = G.quests(acts, today, m), ach = G.achievements(st, m);
    return { acts, today, m, lv, axp, st, q, ach, coins: G.coins(q, ach, m), season: G.season(today) };
  }

  function render() {
    if (!alive) return;
    if (!inp) { el.innerHTML = `<p class="note">Lade …</p>`; return; }
    const M = model();
    const hat = G.SHOP.find((i) => i.id === M.m.wear.hat), frame = G.SHOP.find((i) => i.id === M.m.wear.frame);
    const pet = G.SHOP.find((i) => i.id === M.m.wear.pet) || G.DEFAULT_PET, mood = G.petMood(M.acts, M.today, M.m);
    const open = M.q.daily.concat(M.q.weekly).filter((x) => x.done && !x.claimed).length;
    el.innerHTML = `<div class="sw">
      <section class="sw-head"><button type="button" class="sw-ava${frame ? " fr" : ""}" style="${frame ? `--fr:${frame.color === "conic" ? "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)" : frame.color}` : ""}" data-sw="ava" aria-label="Avatar ändern">${esc(M.m.avatar)}${hat ? `<span class="sw-hat">${hat.e}</span>` : ""}</button>
        <div class="sw-hm"><b>Level ${M.lv.level}</b> <small>${M.lv.xp.toLocaleString("de-AT")} XP</small><span class="sw-xp" aria-label="${M.lv.pct}% bis Level ${M.lv.level + 1}"><i style="width:${M.lv.pct}%"></i></span><small>noch ${M.lv.need - M.lv.into} XP bis Level ${M.lv.level + 1}</small></div>
        <div class="sw-coins" aria-label="${M.coins} Münzen">🪙 <b>${M.coins}</b></div></section>
      ${M.season ? `<div class="sw-season">${M.season.e} <b>${esc(M.season.t)}</b> – ${esc(M.season.d)}</div>` : ""}
      <button type="button" class="sw-pet" data-sw="pet"><span class="sw-pe" aria-hidden="true">${pet.e}</span><span><b>${esc(M.m.pet.name)}</b> ${mood.e} ${esc(mood.t)}</span><small>${M.m.pet.fedDay === M.today ? "schon gefüttert 🍪" : "🍪 füttern"}</small></button>
      <div class="sw-tabs" role="tablist">${TABS.map(([id, e, l]) => `<button type="button" role="tab" class="sw-tab${S.tab === id ? " on" : ""}" aria-selected="${S.tab === id}" data-tab="${id}"><span aria-hidden="true">${e}</span>${l}${id === "quests" && open ? `<i>${open}</i>` : ""}</button>`).join("")}</div>
      <div class="sw-body">${S.tab === "quests" ? questsHTML(M) : S.tab === "erfolge" ? achHTML(M) : S.tab === "shop" ? shopHTML(M) : S.tab === "spiele" ? gamesHTML(M) : worldHTML(M)}</div>
      <p class="note sw-fair">💛 Hier gibt es keine Strafen: Pausen, Urlaub und Krankheit kosten nichts. XP bleiben für immer.</p></div>`;
  }

  function worldHTML(M) {
    const w = G.world(M.lv.level, M.axp);
    const egg = M.season && M.season.id === "ostern";
    return `<div class="sw-map">${w.map((z, i) => `<div class="sw-zone${z.open ? "" : " locked"}"><span class="sw-ze" aria-hidden="true">${z.open ? z.e : "🔒"}</span><b>${esc(z.t)}</b>
        <small>${z.open ? (z.stage != null ? `${"⭐".repeat(Math.min(5, Math.ceil(z.stage / 2)))}${z.stage ? "" : "Noch leer"} · ${G.SKILL_TITLES[z.stage]}` : "Ausblick genießen 🌄") : `ab Level ${z.lvl}`}</small>
        ${egg && i === 4 ? `<button type="button" class="sw-egg" data-sw="egg" aria-label="Verstecktes Osterei">🥚</button>` : ""}</div>`).join("")}</div>
      <section class="card"><h3>🌳 Skilltree</h3><ul class="sw-skills">${L.AREAS.map((a) => { const lv = G.skillLevel(M.axp[a.id]);
        return `<li><span aria-hidden="true">${a.e}</span><div><div class="sw-row"><b>${esc(a.t)}</b><span class="sw-sp"></span><small>Stufe ${lv} · ${G.SKILL_TITLES[lv]}</small></div><span class="sw-xp"><i style="width:${lv * 10}%;background:${a.color}"></i></span></div></li>`; }).join("")}</ul></section>`;
  }
  function questsHTML(M) {
    const row = (q) => `<li class="${q.done ? "done" : ""}"><span aria-hidden="true">${q.e}</span><div><b>${esc(q.t)}</b><span class="sw-xp"><i style="width:${Math.round((q.value / q.goal) * 100)}%"></i></span><small>${q.value} / ${q.goal}</small></div>
      ${q.claimed ? `<span class="sw-ok">✅</span>` : q.done ? `<button type="button" class="btn primary sm" data-claim="${esc(q.key)}">+${q.coins} 🪙</button>` : `<small class="sw-c">${q.coins} 🪙</small>`}</li>`;
    return `<section class="card"><h3>☀️ Heute</h3><ul class="sw-q">${M.q.daily.map(row).join("")}</ul></section>
      <section class="card"><h3>📅 Diese Woche</h3><ul class="sw-q">${M.q.weekly.map(row).join("")}</ul></section>
      <section class="card"><h3>🎲 Challenge des Tages</h3><p>${esc(G.dailyChallenge(M.today))}</p><small class="note">Freiwillig – einfach zum Spaß.</small></section>`;
  }
  function achHTML(M) {
    const got = M.ach.filter((a) => a.got).length, vis = M.ach.filter((a) => a.got || !a.secret);
    return `<p class="note">${got} von ${M.ach.length} Erfolgen · ${M.ach.filter((a) => a.secret && !a.got).length} geheime noch versteckt 🤫</p>
      <ul class="sw-ach">${vis.map((a) => `<li class="${a.got ? "got" : ""}"><span aria-hidden="true">${a.got ? a.e : "🔒"}</span><b>${esc(a.t)}</b><small>${esc(a.d)}</small>${a.secret ? `<i>geheim</i>` : ""}</li>`).join("")}
        ${M.ach.filter((a) => a.secret && !a.got).map(() => `<li class="secret"><span aria-hidden="true">❓</span><b>???</b><small>Geheimer Erfolg</small></li>`).join("")}</ul>
      <section class="card"><h3>📊 Deine Rekorde</h3><p>🔥 Beste Serie: <b>${M.st.besteSerie} Tage</b> · 📅 Aktive Tage: <b>${M.st.aktivTage}</b>${M.m.records.ohm ? ` · ⚡ Ohm-Blitz: <b>${M.m.records.ohm}</b>` : ""}</p></section>`;
  }
  function shopHTML(M) {
    const slots = [["hat", "🎩 Hüte"], ["frame", "🖼️ Rahmen"], ["pet", "🐾 Begleiter"]];
    return `<p class="note">Münzen bekommst du für Quests (10/30 🪙) und Erfolge (25 🪙). Alles rein kosmetisch. ✨</p>${slots.map(([slot, l]) => `<section class="card"><h3>${l}</h3><ul class="sw-shop">${G.SHOP.filter((i) => i.slot === slot).map((i) => {
      const own = M.m.owned.includes(i.id), on = M.m.wear[slot] === i.id;
      return `<li><span aria-hidden="true">${i.e}</span><b>${esc(i.t)}</b>${own ? `<button type="button" class="btn ${on ? "ghost" : "primary"} sm" data-wear="${i.id}">${on ? "Ablegen" : "Anlegen"}</button>` : `<button type="button" class="btn ghost sm" data-buy="${i.id}"${M.coins < i.price ? " disabled" : ""}>${i.price} 🪙</button>`}</li>`; }).join("")}</ul></section>`).join("")}`;
  }
  function gamesHTML(M) {
    const opts = M.m.wheel.length >= 2 ? M.m.wheel : ["Pizza", "Kebab", "Selber kochen", "Schnitzel"];
    const n = opts.length, seg = 360 / n;
    const colors = ["#7c3aed", "#db2777", "#f59e0b", "#16a34a", "#2563eb", "#0891b2", "#ea580c", "#dc2626", "#65a30d", "#9333ea", "#0d9488", "#e11d48"];
    const grad = opts.map((_, i) => `${colors[i % colors.length]} ${i * seg}deg ${(i + 1) * seg}deg`).join(",");
    return `<section class="card"><h3>🎡 Entscheidungsrad</h3><div class="sw-wheel-wrap"><span class="sw-ptr" aria-hidden="true">▼</span>
        <div class="sw-wheel" style="background:conic-gradient(${grad});transform:rotate(${S.wheelDeg}deg)">${opts.map((o, i) => `<span style="transform:rotate(${i * seg + seg / 2}deg)"><em>${esc(o)}</em></span>`).join("")}</div></div>
        <p class="sw-res" aria-live="polite">${S.wheelRes ? `👉 <b>${esc(S.wheelRes)}</b>` : "&nbsp;"}</p>
        <div class="sw-row"><button type="button" class="btn primary sm" data-sw="spin">🎡 Drehen</button><button type="button" class="btn ghost sm" data-sw="wheel">✏️ Optionen</button></div></section>
      <section class="card"><h3>🎯 Zufalls-Challenge</h3><p aria-live="polite">${esc(S.challenge || "Tipp auf den Knopf für eine kleine Aufgabe.")}</p><button type="button" class="btn ghost sm" data-sw="challenge">🎲 Neue Challenge</button></section>
      <section class="card"><h3>⚡ Ohm-Blitz</h3>${S.ohm ? `<p class="sw-ohm-q">${esc(S.ohm.task.q)}</p><form class="sw-row" data-sw="ohmform"><input id="sw-ohm" inputmode="decimal" autocomplete="off" aria-label="Antwort" style="max-width:9em"><b>${S.ohm.task.unit}</b><button type="submit" class="btn primary sm">OK</button></form>
        <p>⏱️ <b data-ohmt>${Math.max(0, Math.ceil((S.ohm.end - Date.now()) / 1000))}</b> s · Punkte: <b>${S.ohm.pts}</b></p>`
        : `<p>60 Sekunden, so viele Aufgaben zu U = R · I wie möglich. Rekord: <b>${M.m.records.ohm || 0}</b></p><button type="button" class="btn primary sm" data-sw="ohm">▶️ Start</button>`}</section>`;
  }

  function claim(key) {
    const M = model();
    const q = M.q.daily.concat(M.q.weekly).find((x) => x.key === key);
    if (!q || !q.done || q.claimed) return;
    save(G.pruneClaimed({ ...M.m, claimed: { ...M.m.claimed, [key]: true } }, M.today), `🎉 +${q.coins} 🪙 – stark!`);
  }
  function avatarSheet() {
    const m = me();
    ui.openSheet({ title: "🧑 Dein Avatar", bodyHTML: `<div class="chips sw-avas">${AVATARS.map((a) => `<button type="button" class="chip" data-av="${a}" aria-pressed="${m.avatar === a}">${a}</button>`).join("")}</div>
      <label class="fields">Name deines Begleiters<input id="sw-petname" maxlength="20" value="${esc(m.pet.name)}"></label><div class="row"><button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sh, close) {
        let av = m.avatar;
        sh.querySelector(".sw-avas").addEventListener("click", (ev) => { const c = ev.target.closest("[data-av]"); if (!c) return; av = c.dataset.av; sh.querySelectorAll("[data-av]").forEach((x) => x.setAttribute("aria-pressed", String(x === c))); });
        sh.querySelector("[data-save]").addEventListener("click", () => { close(); save({ ...me(), avatar: av, pet: { ...me().pet, name: sh.querySelector("#sw-petname").value.trim() || "Funki" } }, "Gespeichert ✓"); });
      } });
  }
  function wheelSheet() {
    const m = me();
    ui.openSheet({ title: "🎡 Optionen fürs Rad", bodyHTML: `<label class="fields">Eine Option pro Zeile (2–12)<textarea id="sw-wh" rows="8">${esc((m.wheel.length ? m.wheel : ["Pizza", "Kebab", "Selber kochen", "Schnitzel"]).join("\n"))}</textarea></label><div class="row"><button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sh, close) { sh.querySelector("[data-save]").addEventListener("click", () => { const w = sh.querySelector("#sw-wh").value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 12); if (w.length < 2) { ui.toast("Mindestens 2 Optionen."); return; } close(); S.wheelRes = ""; save({ ...me(), wheel: w }); }); } });
  }
  function startOhm() {
    S.ohm = { task: G.ohmTask(), pts: 0, end: Date.now() + 60000 };
    render(); el.querySelector("#sw-ohm")?.focus();
    clearInterval(ohmTimer);
    ohmTimer = setInterval(() => {
      if (!alive || !S.ohm) { clearInterval(ohmTimer); return; }
      const left = Math.ceil((S.ohm.end - Date.now()) / 1000);
      const t = el.querySelector("[data-ohmt]"); if (t) t.textContent = String(Math.max(0, left));
      if (left <= 0) {
        clearInterval(ohmTimer);
        const pts = S.ohm.pts, m = me(), best = Number(m.records.ohm) || 0;
        S.ohm = null;
        if (pts > best) save({ ...m, records: { ...m.records, ohm: pts } }, `🏆 Neuer Rekord: ${pts} Punkte!`); else { ui.toast(`⚡ ${pts} Punkte – Rekord bleibt ${best}`); render(); }
      }
    }, 250);
  }

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b || !el.contains(b)) return;
    const d = b.dataset;
    if (d.tab) { S.tab = d.tab; lsSet(TAB_KEY, S.tab); render(); return; }
    if (d.claim) { claim(d.claim); return; }
    if (d.buy) { const it = G.SHOP.find((i) => i.id === d.buy), M = model(); const r = G.buy(M.m, it, M.coins); if (!r.ok) { ui.toast(r.why); return; } save(r.me, `${it.e} ${it.t} gehört dir!`); return; }
    if (d.wear) { const it = G.SHOP.find((i) => i.id === d.wear), m = me(); save({ ...m, wear: { ...m.wear, [it.slot]: m.wear[it.slot] === it.id ? null : it.id } }); return; }
    switch (d.sw) {
      case "ava": {
        S.taps++;
        if (S.taps === 7) { const m = me(); if (!m.secret.tipp7) { save({ ...m, secret: { ...m.secret, tipp7: Date.now() } }, "🐣 Geheimer Erfolg: Neugierig!"); return; } }
        clearTimeout(S.tapT); S.tapT = setTimeout(() => { if (S.taps < 7) avatarSheet(); S.taps = 0; }, 600);
        break;
      }
      case "pet": { const m = me(), today = A.todayKey(); if (m.pet.fedDay === today) { ui.toast(`${m.pet.name} ist satt und zufrieden 😊`); break; } save({ ...m, pet: { ...m.pet, fedDay: today } }, `🍪 ${m.pet.name} sagt Danke!`); break; }
      case "egg": { const m = me(); save({ ...m, spent: m.spent - 50, secret: { ...m.secret, ei: Date.now() } }, "🥚 Gefunden! +50 🪙"); break; }
      case "spin": {
        const m = me(), opts = m.wheel.length >= 2 ? m.wheel : ["Pizza", "Kebab", "Selber kochen", "Schnitzel"];
        const r = G.spin(opts.length);
        S.wheelDeg = Math.ceil(S.wheelDeg / 360) * 360 + r.deg; S.wheelRes = "";
        const w = el.querySelector(".sw-wheel"); if (w) w.style.transform = `rotate(${S.wheelDeg}deg)`;
        setTimeout(() => { S.wheelRes = opts[r.index]; const spins = (Number(me().records.spins) || 0) + 1; save({ ...me(), records: { ...me().records, spins } }); render(); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 50 : 3200);
        break;
      }
      case "wheel": wheelSheet(); break;
      case "challenge": S.challenge = G.randomChallenge(); render(); break;
      case "ohm": startOhm(); break;
      default: break;
    }
  });
  el.addEventListener("submit", (ev) => {
    if (!ev.target.matches('[data-sw="ohmform"]') || !S.ohm) return;
    ev.preventDefault();
    const inpEl = el.querySelector("#sw-ohm");
    if (G.ohmCheck(S.ohm.task, inpEl.value)) { S.ohm.pts++; ui.toast("✅", 500); } else ui.toast(`❌ ${String(S.ohm.task.a).replace(".", ",")} ${S.ohm.task.unit}`, 1200);
    S.ohm.task = G.ohmTask();
    render(); el.querySelector("#sw-ohm")?.focus();
  });
  render();
  return () => { alive = false; clearInterval(ohmTimer); live.off(); try { offSp(); } catch { /* egal */ } };
}
