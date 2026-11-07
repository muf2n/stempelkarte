// Update 10 F – Alltag › ⚡ Elektro-Tools: Einheiten umrechnen, Widerstands-Farbcode (beide Richtungen), Lexikon, Schaltzeichen, Rechner.
// Rechner = dieselben Mini-Rechner wie die LAP-Formelsammlung (./lap-formulas.js CALC_UI) – nichts doppelt.
// Direkt-Sprung: #alltag/elektro?tab=lexikon&q=Schütz (Universale Suche).
import * as E from "./elektro-core.js";
import { LEXIKON, LEX_CATS, LEX_NOTE } from "./elektro-data.js";
import { SYMBOLS, SYMBOL_NOTE } from "./elektro-symbols.js";
import { CALC_UI } from "./lap-formulas.js";
import { MATERIALS } from "./lap-data.js";
import { esc } from "../util.js";

const TABS = [
  ["umrechnen", "🔁", "Umrechnen"],
  ["farbcode", "🌈", "Farbcode"],
  ["rechner", "🔢", "Rechner"],
  ["lexikon", "📖", "Lexikon"],
  ["zeichen", "🔣", "Schaltzeichen"],
];
const TAB_KEY = "sk-el-tab";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const SAFETY = "⚠️ Nur zum Lernen und Nachrechnen – ersetzt keine Planung, Messung oder Freigabe. Arbeiten an Anlagen nur durch bzw. unter Aufsicht einer befugten Elektrofachkraft (5 Sicherheitsregeln!).";

const CALCS = [
  ["ohm", "Ohmsches Gesetz", "U = R · I"],
  ["pui", "Leistung", "P = U · I"],
  ["pi2r", "Leistung aus Strom", "P = I² · R"],
  ["series", "Reihenschaltung", "R = R1 + R2 + …"],
  ["parallel", "Parallelschaltung", "1/R = 1/R1 + 1/R2 + …"],
  ["wire2", "Leitungswiderstand", "R = 2 · l / (κ · A)"],
  ["du1", "Spannungsfall 1~", "ΔU = 2 · l · I · cos φ / (κ · A)"],
  ["du3", "Spannungsfall 3~", "ΔU = √3 · l · I · cos φ / (κ · A)"],
  ["p3", "Drehstrom-Leistung", "P = √3 · U · I · cos φ"],
  ["energy", "Energie & Kosten", "W = P · t"],
];

function ensureCss() {
  if (document.getElementById("css-elektro")) return;
  const l = document.createElement("link");
  l.id = "css-elektro"; l.rel = "stylesheet";
  l.href = new URL("../../css/elektro.css", import.meta.url).href;
  document.head.appendChild(l);
}

function hashParams() {
  const h = location.hash || "";
  const i = h.indexOf("?");
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : "");
}

export function mount(el) {
  ensureCss();
  const hp = hashParams();
  let tab = TABS.some((t) => t[0] === hp.get("tab")) ? hp.get("tab") : TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "umrechnen";
  const st = {
    grp: "strom", from: "mA", val: "1500",
    bands: 4, b4: ["gelb", "violett", "rot", "gold"], b5: ["braun", "schwarz", "schwarz", "rot", "braun"], ohm: "4k7",
    calc: "ohm", lexQ: hp.get("q") || "", lexCat: "", symQ: "",
  };
  el.innerHTML = `<div class="el">
    <div class="el-tabs" role="tablist" aria-label="Elektro-Tools">${TABS.map(([id, e, t]) =>
      `<button type="button" role="tab" class="el-tab" data-tab="${id}" aria-selected="${id === tab}"><span aria-hidden="true">${e}</span><span>${t}</span></button>`).join("")}</div>
    <div class="el-page" role="tabpanel"></div>
    <p class="note el-safety">${esc(SAFETY)}</p>
  </div>`;
  const page = el.querySelector(".el-page");

  function show(id) {
    tab = id; lsSet(TAB_KEY, id);
    el.querySelectorAll(".el-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === id)));
    ({ umrechnen: pUnits, farbcode: pColor, rechner: pCalc, lexikon: pLex, zeichen: pSym })[id]();
  }

  /* ---------- 🔁 Umrechnen ---------- */
  function pUnits() {
    const g = E.groupById(st.grp);
    if (!g.units.some((u) => u[0] === st.from)) st.from = g.units[Math.min(1, g.units.length - 1)][0];
    page.innerHTML = `<div class="el-card">
      <div class="el-chips" role="group" aria-label="Größe">${E.UNIT_GROUPS.map((x) => `<button type="button" class="el-chip" data-grp="${x.id}" aria-pressed="${x.id === st.grp}">${x.e} ${esc(x.t)}</button>`).join("")}</div>
      <div class="el-row">
        <label class="el-in">Wert<input type="text" inputmode="decimal" data-u="val" value="${esc(st.val)}" autocomplete="off" aria-label="Wert"></label>
        <label class="el-in">Einheit<select data-u="from" aria-label="Einheit">${g.units.map(([u]) => `<option${u === st.from ? " selected" : ""}>${esc(u)}</option>`).join("")}</select></label>
      </div>
      <ul class="el-res" data-u="out" aria-live="polite"></ul>
      ${st.grp === "querschnitt" ? `<p class="note">${esc(E.AWG_NOTE)}</p>` : ""}
    </div>`;
    outUnits();
  }
  function outUnits() {
    const box = page.querySelector('[data-u="out"]');
    if (!box) return;
    const v = st.grp === "querschnitt" && st.from === "AWG" ? E.parseAwg(st.val) : E.parseNum(st.val);
    if (!Number.isFinite(v)) { box.innerHTML = `<li class="el-hint">Gib eine Zahl ein, z. B. 1500 🙂</li>`; return; }
    box.innerHTML = E.convertAll(st.grp === "querschnitt" && st.from === "AWG" ? v : st.val, st.grp, st.from).filter((r) => r.unit !== st.from).map((r) => {
      const txt = st.grp === "querschnitt" && r.unit === "AWG" ? (Number.isFinite(r.value) ? "AWG " + E.awgLabel(r.value) : "–") : `${E.fmtVal(r.value)} ${r.unit}`;
      return `<li><span>${esc(st.val)} ${esc(st.from)} =</span><b data-unit="${esc(r.unit)}">${esc(txt)}</b></li>`;
    }).join("");
  }

  /* ---------- 🌈 Farbcode ---------- */
  function bandSvg(ids) {
    const n = ids.length;
    const xs = n === 4 ? [44, 58, 72, 96] : [40, 52, 64, 76, 98];
    return `<svg viewBox="0 0 160 50" class="el-res-svg" role="img" aria-label="Widerstand mit Ringen ${esc(ids.map((i) => E.colorById(i).t).join(", "))}">
      <path d="M2 25H30M130 25H158" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <rect x="28" y="8" width="104" height="34" rx="14" fill="#e9d8b4" stroke="#8b6b3e" stroke-width="2"/>
      ${ids.map((id, i) => { const c = E.colorById(id); return id === "keine" ? "" : `<rect x="${xs[i]}" y="8" width="8" height="34" fill="${c.hex}" stroke="${id === "weiss" ? "#999" : "none"}"/>`; }).join("")}
    </svg>`;
  }
  function pColor() {
    const ids = st.bands === 4 ? st.b4 : st.b5;
    const nd = st.bands - 2;
    const sel = (i, list, val, label) => `<label class="el-in el-band">${label}<select data-band="${i}" aria-label="${label}">${list.map((id) => { const c = E.colorById(id); return `<option value="${id}"${id === val ? " selected" : ""}>${esc(c.t)}</option>`; }).join("")}</select></label>`;
    const sels = ids.map((v, i) => i < nd ? sel(i, E.DIGIT_COLORS, v, `${i + 1}. Ring (Ziffer)`) : i === nd ? sel(i, E.MULT_COLORS, v, "Multiplikator") : sel(i, E.TOL_COLORS, v, "Toleranz")).join("");
    const dec = E.decodeBands(ids);
    page.innerHTML = `<div class="el-card">
      <h3>🌈 Ringe → Wert</h3>
      <div class="el-chips" role="group" aria-label="Anzahl Ringe"><button type="button" class="el-chip" data-bands="4" aria-pressed="${st.bands === 4}">4 Ringe</button><button type="button" class="el-chip" data-bands="5" aria-pressed="${st.bands === 5}">5 Ringe</button></div>
      <div class="el-band-pic">${bandSvg(ids)}</div>
      <div class="el-bands">${sels}</div>
      <p class="el-big" data-c="value" aria-live="polite">${dec ? esc(dec.text) : "–"}</p>
    </div>
    <div class="el-card">
      <h3>🔍 Wert → Ringe</h3>
      <div class="el-row"><label class="el-in">Widerstand<input type="text" data-c="ohm" value="${esc(st.ohm)}" placeholder="z. B. 4k7, 220, 1,5M" autocomplete="off"></label></div>
      <div data-c="enc" aria-live="polite"></div>
      <p class="note">Leserichtung: Der Toleranzring (oft Gold/Silber) steht etwas abseits und kommt zuletzt. Kodierung nach IEC 60062.</p>
    </div>`;
    outEnc();
  }
  function outEnc() {
    const box = page.querySelector('[data-c="enc"]');
    if (!box) return;
    const v = E.parseOhm(st.ohm);
    if (!Number.isFinite(v)) { box.innerHTML = `<p class="el-hint">Gib einen Wert ein, z. B. „4k7“ oder „220“ 🙂</p>`; return; }
    const r4 = E.encodeOhm(v, 4, 5), r5 = E.encodeOhm(v, 5, 1);
    const row = (r, label) => !r ? `<p class="el-hint">${label}: außerhalb des Farbcodes</p>` :
      `<div class="el-enc"><b>${label}</b>${bandSvg(r.bands)}<span>${esc(r.bands.map((i) => E.colorById(i).t).join(" – "))}</span>${r.exact ? "" : `<small>gerundet auf ${esc(E.ohmText(r.ohm))}</small>`}</div>`;
    const e24 = E.nearestE(v, E.E24);
    box.innerHTML = `<p class="el-big">${esc(E.ohmText(v))}</p>${row(r4, "4 Ringe (±5 %)")}${row(r5, "5 Ringe (±1 %)")}` +
      (Number.isFinite(e24) && Math.abs(e24 - v) > v * 1e-9 ? `<p class="note">Nächster Normwert (E24): <b>${esc(E.ohmText(e24))}</b></p>` : `<p class="note">✅ Normwert der E24-Reihe</p>`);
  }

  /* ---------- 🔢 Rechner (aus der LAP-Formelsammlung) ---------- */
  function pCalc() {
    const ui = CALC_UI[st.calc];
    page.innerHTML = `<div class="el-card">
      <label class="el-in">Rechner<select data-k="calc">${CALCS.map(([id, t, f]) => `<option value="${id}"${id === st.calc ? " selected" : ""}>${esc(t)} – ${esc(f)}</option>`).join("")}</select></label>
      <form class="el-calc" data-k="form" novalidate>
        ${ui.mat ? `<label class="el-in">Material<select name="mat">${MATERIALS.map((m) => `<option value="${m.id}">${esc(m.name)} (κ = ${m.kappa})</option>`).join("")}</select></label>` : ""}
        ${ui.fields.map(([k, label, unit, type, def]) => `<label class="el-in">${esc(label)}${unit ? ` <small>(${esc(unit)})</small>` : ""}<input name="${k}" type="text" inputmode="${type === "text" ? "text" : "decimal"}" value="${esc(def || "")}" autocomplete="off"></label>`).join("")}
      </form>
      <ul class="el-res" data-k="out" aria-live="polite"></ul>
      <p class="note">Gleiche Rechner wie in 🎓 LAP › Formeln.</p>
    </div>`;
    outCalc();
  }
  function outCalc() {
    const f = page.querySelector('[data-k="form"]');
    if (!f) return;
    const v = Object.fromEntries(new FormData(f).entries());
    const r = CALC_UI[st.calc].run(v);
    page.querySelector('[data-k="out"]').innerHTML = r.out ? r.out.map((x) => `<li><span>${esc(x.label)}</span><b>${esc(E.fmtVal(x.value))} ${esc(x.unit)}</b></li>`).join("") : `<li class="el-hint">${esc(r.hint || "")}</li>`;
  }

  /* ---------- 📖 Lexikon ---------- */
  const norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function pLex() {
    page.innerHTML = `<div class="el-card">
      <div class="el-search"><span aria-hidden="true">🔎</span><input type="search" data-l="q" value="${esc(st.lexQ)}" placeholder="Begriff suchen, z. B. FI, Schlupf, IP" aria-label="Lexikon durchsuchen" autocomplete="off"></div>
      <div class="el-chips" role="group" aria-label="Thema"><button type="button" class="el-chip" data-lcat="" aria-pressed="${!st.lexCat}">Alle</button>${LEX_CATS.map(([id, e, t]) => `<button type="button" class="el-chip" data-lcat="${id}" aria-pressed="${st.lexCat === id}">${e} ${esc(t)}</button>`).join("")}</div>
      <p class="note" data-l="count"></p>
      <dl class="el-lex" data-l="list"></dl>
      <p class="note">${esc(LEX_NOTE)}</p>
    </div>`;
    outLex();
  }
  function outLex() {
    const q = norm(st.lexQ.trim());
    const list = LEXIKON.filter((x) => (!st.lexCat || x.c === st.lexCat) && (!q || norm(x.t).includes(q) || norm(x.d).includes(q)))
      .sort((a, b) => (q ? (norm(b.t).startsWith(q) - norm(a.t).startsWith(q)) || (norm(b.t).includes(q) - norm(a.t).includes(q)) : 0) || a.t.localeCompare(b.t, "de"));
    page.querySelector('[data-l="count"]').textContent = `${list.length} von ${LEXIKON.length} Begriffen`;
    const cat = Object.fromEntries(LEX_CATS.map(([id, e]) => [id, e]));
    page.querySelector('[data-l="list"]').innerHTML = list.length ? list.map((x) => `<div class="el-lx" data-lx="${x.id}"><dt><span aria-hidden="true">${cat[x.c] || ""}</span> ${esc(x.t)}</dt><dd>${esc(x.d)}</dd></div>`).join("")
      : `<p class="el-hint">Nichts gefunden 🤔 – probier ein anderes Wort.</p>`;
  }

  /* ---------- 🔣 Schaltzeichen ---------- */
  function pSym() {
    page.innerHTML = `<div class="el-card">
      <div class="el-search"><span aria-hidden="true">🔎</span><input type="search" data-s="q" value="${esc(st.symQ)}" placeholder="Zeichen suchen, z. B. Diode" aria-label="Schaltzeichen durchsuchen" autocomplete="off"></div>
      <ul class="el-syms" data-s="list"></ul>
      <p class="note">${esc(SYMBOL_NOTE)}</p>
    </div>`;
    outSym();
  }
  function outSym() {
    const q = norm(st.symQ.trim());
    const list = SYMBOLS.filter((x) => !q || norm(x.t).includes(q) || norm(x.sub).includes(q));
    page.querySelector('[data-s="list"]').innerHTML = list.length ? list.map((x) => `<li class="el-sym" data-sym="${x.id}"><span class="el-sym-pic">${x.s}</span><b>${esc(x.t)}</b><small>${esc(x.sub)}</small></li>`).join("")
      : `<li class="el-hint">Nichts gefunden 🤔</li>`;
  }

  /* ---------- Ereignisse ---------- */
  const onClick = (ev) => {
    const t = ev.target.closest(".el-tab");
    if (t) { show(t.dataset.tab); return; }
    const b = ev.target.closest("button");
    if (!b || !el.contains(b)) return;
    if (b.dataset.grp) { st.grp = b.dataset.grp; st.from = ""; pUnits(); return; }
    if (b.dataset.bands) { st.bands = Number(b.dataset.bands); pColor(); return; }
    if (b.dataset.lcat != null) { st.lexCat = b.dataset.lcat; page.querySelectorAll("[data-lcat]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.lcat === st.lexCat))); outLex(); }
  };
  const onInput = (ev) => {
    const t = ev.target;
    if (t.dataset.u === "val") { st.val = t.value; outUnits(); return; }
    if (t.dataset.u === "from") { st.from = t.value; outUnits(); return; }
    if (t.dataset.band != null) {
      const arr = st.bands === 4 ? st.b4 : st.b5;
      arr[Number(t.dataset.band)] = t.value;
      const d = E.decodeBands(arr);
      page.querySelector('[data-c="value"]').textContent = d ? d.text : "–";
      page.querySelector(".el-band-pic").innerHTML = bandSvg(arr);
      return;
    }
    if (t.dataset.c === "ohm") { st.ohm = t.value; outEnc(); return; }
    if (t.dataset.k === "calc") { st.calc = t.value; pCalc(); return; }
    if (t.closest('[data-k="form"]')) { outCalc(); return; }
    if (t.dataset.l === "q") { st.lexQ = t.value; outLex(); return; }
    if (t.dataset.s === "q") { st.symQ = t.value; outSym(); }
  };
  // Sprung aus der Suche, während der Bereich schon offen ist
  const onHash = () => {
    if (!/^#alltag\/elektro\?/.test(location.hash || "")) return;
    const p = hashParams();
    if (p.get("q") != null) st.lexQ = p.get("q");
    if (TABS.some((t) => t[0] === p.get("tab"))) show(p.get("tab"));
  };
  el.addEventListener("click", onClick);
  el.addEventListener("input", onInput);
  el.addEventListener("change", onInput);
  window.addEventListener("hashchange", onHash);
  show(tab);
  return () => { el.removeEventListener("click", onClick); el.removeEventListener("input", onInput); el.removeEventListener("change", onInput); window.removeEventListener("hashchange", onHash); };
}
