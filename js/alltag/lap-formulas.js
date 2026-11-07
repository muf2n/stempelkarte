// Alltag › LAP › 📐 Formelsammlung: durchsuchbar, nach Thema, mit Mini-Rechnern (reine Funktionen in ./lap-core.js).
import { FORMULAS, TOPICS, MATERIALS, NORM_NOTE, topicOf } from "./lap-data.js";
import { solveOhm, solvePUI, solvePI2R, wireR, seriesR, parallelR, voltageDrop, energyCost, power3, parseNum, fmtAuto, fmt } from "./lap-core.js";

const r = (label, value, unit) => ({ label, value, unit });
const list = (s) => String(s || "").split(/[;\s]+/).map(parseNum).filter((x) => Number.isFinite(x));
const kap = (v) => (MATERIALS.find((m) => m.id === v.mat) || MATERIALS[0]).kappa;
const NAMES = { U: "Spannung U", R: "Widerstand R", I: "Strom I", P: "Leistung P" };
const UNITS = { U: "V", R: "Ω", I: "A", P: "W" };
function three(fn) {
  return (v) => {
    const s = fn(v);
    if (!s) return { hint: "Gib genau zwei Werte ein – der dritte wird berechnet 🙂" };
    return { out: [r(NAMES[s.solved], s[s.solved], UNITS[s.solved])] };
  };
}

/** Rechner: Felder + Berechnung (→ { out:[{label,value,unit}] } oder { hint }) */
export const CALC_UI = {
  ohm: { fields: [["U", "Spannung U", "V"], ["R", "Widerstand R", "Ω"], ["I", "Strom I", "A"]], run: three(solveOhm) },
  pui: { fields: [["P", "Leistung P", "W"], ["U", "Spannung U", "V"], ["I", "Strom I", "A"]], run: three(solvePUI) },
  pi2r: { fields: [["P", "Leistung P", "W"], ["I", "Strom I", "A"], ["R", "Widerstand R", "Ω"]], run: three(solvePI2R) },
  series: { fields: [["list", "Widerstände (mit Leerzeichen oder ; trennen)", "Ω", "text"]], run: (v) => { const x = seriesR(list(v.list)); return x == null ? { hint: "Z. B. „10 22 47“ eingeben" } : { out: [r("Gesamtwiderstand Rges", x, "Ω")] }; } },
  parallel: { fields: [["list", "Widerstände (mit Leerzeichen oder ; trennen)", "Ω", "text"]], run: (v) => { const x = parallelR(list(v.list)); return x == null ? { hint: "Z. B. „100 100“ eingeben (alle größer als 0)" } : { out: [r("Gesamtwiderstand Rges", x, "Ω")] }; } },
  wire: { mat: true, fields: [["l", "Länge l", "m"], ["A", "Querschnitt A", "mm²"]], run: (v) => { const x = wireR({ l: v.l, A: v.A, kappa: kap(v) }); return x == null ? { hint: "Länge und Querschnitt eingeben" } : { out: [r("Widerstand R (eine Ader)", x, "Ω")] }; } },
  wire2: { mat: true, fields: [["l", "Einfache Länge l", "m"], ["A", "Querschnitt A", "mm²"]], run: (v) => { const x = wireR({ l: v.l, A: v.A, kappa: kap(v), twoWay: true }); return x == null ? { hint: "Länge und Querschnitt eingeben" } : { out: [r("Leitungswiderstand RL (Hin + Rück)", x, "Ω")] }; } },
  du1: { mat: true, fields: [["l", "Einfache Länge l", "m"], ["I", "Strom I", "A"], ["A", "Querschnitt A", "mm²"], ["cos", "cos φ", "", "num", "1"], ["U", "Netzspannung U", "V", "num", "230"]],
    run: (v) => { const x = voltageDrop({ phases: 1, l: v.l, I: v.I, A: v.A, kappa: kap(v), cosphi: v.cos || 1, U: v.U || 230 }); return x ? { out: [r("Spannungsfall ΔU", x.dU, "V"), r("Spannungsfall ΔU", x.pct, "%")] } : { hint: "Länge, Strom und Querschnitt eingeben (cos φ zwischen 0 und 1)" }; } },
  du3: { mat: true, fields: [["l", "Länge l", "m"], ["I", "Strom I (je Außenleiter)", "A"], ["A", "Querschnitt A", "mm²"], ["cos", "cos φ", "", "num", "1"], ["U", "Außenleiterspannung U", "V", "num", "400"]],
    run: (v) => { const x = voltageDrop({ phases: 3, l: v.l, I: v.I, A: v.A, kappa: kap(v), cosphi: v.cos || 1, U: v.U || 400 }); return x ? { out: [r("Spannungsfall ΔU", x.dU, "V"), r("Spannungsfall ΔU", x.pct, "%")] } : { hint: "Länge, Strom und Querschnitt eingeben (cos φ zwischen 0 und 1)" }; } },
  energy: { fields: [["P", "Leistung P", "W"], ["h", "Laufzeit pro Tag", "h"], ["days", "Tage", "", "num", "1"], ["ct", "Strompreis", "ct/kWh", "num", "30"]],
    run: (v) => { const x = energyCost({ P: v.P, h: v.h, days: v.days || 1, priceCt: v.ct }); return x && Number.isFinite(parseNum(v.P)) && Number.isFinite(parseNum(v.h)) ? { out: [r("Energie W", x.kWh, "kWh"), ...(x.euro != null ? [r("Kosten", x.euro, "€")] : [])] } : { hint: "Leistung und Laufzeit eingeben" }; } },
  p3: { fields: [["U", "Außenleiterspannung U", "V", "num", "400"], ["I", "Strom I", "A"], ["cos", "cos φ", "", "num", "1"]],
    run: (v) => { const x = power3({ U: v.U || 400, I: v.I, cosphi: v.cos || 1 }); return x != null && Number.isFinite(parseNum(v.I)) ? { out: [r("Wirkleistung P", x, "W"), r("Wirkleistung P", x / 1000, "kW")] } : { hint: "Strom eingeben (cos φ zwischen 0 und 1)" }; } },
};

export function createFormulas(L) {
  const { esc } = L;
  let page = null;
  let search = "";
  let topic = "";
  const open = new Set();
  const vals = {}; // calc → { feld: Wert }

  function calcHTML(f) {
    const c = CALC_UI[f.calc];
    const v = (vals[f.id] = vals[f.id] || {});
    return `<div class="lap-calc" data-calc="${f.id}">` +
      (c.mat ? `<div class="lap-seg" role="group" aria-label="Leiterwerkstoff">` + MATERIALS.map((m) => `<button type="button" data-mat="${m.id}" aria-pressed="${(v.mat || "cu") === m.id}">${esc(m.name)} <small>κ ${m.kappa}</small></button>`).join("") + `</div>` : "") +
      `<div class="lap-fields">` + c.fields.map(([k, label, unit, type, def]) =>
        `<label class="lap-field${type === "text" ? " wide" : ""}"><span>${esc(label)}</span><span class="lap-inp"><input inputmode="${type === "text" ? "text" : "decimal"}" autocomplete="off" data-f="${k}" value="${esc(v[k] ?? def ?? "")}" ${def ? `placeholder="${esc(def)}"` : ""}>${unit ? `<i>${esc(unit)}</i>` : ""}</span></label>`).join("") + `</div>` +
      `<div class="lap-calc-out" aria-live="polite">${outHTML(f)}</div>` +
    `</div>`;
  }
  function outHTML(f) {
    const c = CALC_UI[f.calc];
    const v = { ...(vals[f.id] || {}) };
    for (const [k, , , , def] of c.fields) if ((v[k] == null || v[k] === "") && def) v[k] = def;
    const res = c.run(v);
    if (res.hint) return `<p class="lap-muted">💡 ${esc(res.hint)}</p>`;
    return res.out.map((o) => `<div class="lap-res"><span>${esc(o.label)}</span><b>${o.unit === "€" ? fmt(o.value, 2) : fmtAuto(o.value)} ${esc(o.unit)}</b></div>`).join("");
  }

  function html() {
    const s = search.trim().toLowerCase();
    const list = FORMULAS.filter((f) => (!topic || f.topic === topic) && (!s || (f.name + " " + f.f + " " + f.units + " " + f.m).toLowerCase().includes(s)));
    return `<div class="lap-card">` +
      `<input type="search" class="lap-search" placeholder="🔎 Formel suchen, z. B. Spannungsfall, Leistung …" aria-label="Formeln durchsuchen" value="${esc(search)}">` +
      `<div class="chips lap-chips"><button type="button" class="chip" data-ft="" aria-pressed="${!topic}">Alle</button>` +
        TOPICS.filter((t) => FORMULAS.some((f) => f.topic === t.id)).map((t) => `<button type="button" class="chip" data-ft="${t.id}" aria-pressed="${topic === t.id}">${t.emoji} ${esc(t.name)}</button>`).join("") + `</div>` +
      `<p class="lap-muted">🧮 = mit Rechner. Werte wie κ = 56 (Cu) und 35 (Al) sind gängige Tabellenbuchwerte – manche Schulen rechnen mit 58 bzw. 36.</p>` +
    `</div>` +
    `<div class="lap-flist">` + (list.length ? list.map((f) => {
      const tp = topicOf(f.topic);
      const isOpen = open.has(f.id);
      return `<article class="lap-formula${isOpen ? " open" : ""}" data-fid="${f.id}">` +
        `<div class="lap-row"><h3 class="lap-h3">${esc(f.name)}</h3><span class="lap-grow"></span><span class="lap-pill sm">${tp.emoji} ${esc(tp.name)}</span></div>` +
        `<div class="lap-f">${esc(f.f)}</div>` +
        `<p class="lap-units">📏 ${esc(f.units)}</p>` +
        `<p class="lap-muted">${esc(f.m)}</p>` +
        (tp.norm && /Spannungsfall/.test(f.name) ? `<p class="lap-norm">${esc(NORM_NOTE)} Wie viel Spannungsfall erlaubt ist, steht in der Norm bzw. euren Unterlagen.</p>` : "") +
        (f.calc ? `<button type="button" class="btn ${isOpen ? "ghost" : "primary"} sm lap-calc-btn" data-open="${f.id}" aria-expanded="${isOpen}">${isOpen ? "✕ Rechner zu" : "🧮 Rechner"}</button>${isOpen ? calcHTML(f) : ""}` : "") +
      `</article>`;
    }).join("") : `<p class="lap-muted lap-center">Keine Formel gefunden 🤔</p>`) + `</div>`;
  }
  function render(keepFocus) {
    if (!page) return;
    page.innerHTML = `<div>${html()}</div>`;
    if (keepFocus) {
      const inp = page.querySelector(keepFocus.sel);
      if (inp) { inp.focus({ preventScroll: true }); try { inp.setSelectionRange(keepFocus.pos, keepFocus.pos); } catch { /* egal */ } }
    }
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !page || !page.contains(t)) return;
    if (t.dataset.ft != null) { topic = t.dataset.ft; render(); return; }
    if (t.dataset.open) {
      const id = t.dataset.open;
      if (open.has(id)) open.delete(id); else open.add(id);
      render();
      if (open.has(id)) { const first = page.querySelector(`[data-calc="${id}"] input`); if (first) first.focus({ preventScroll: true }); }
      return;
    }
    if (t.dataset.mat) {
      const box = t.closest("[data-calc]");
      const id = box.dataset.calc;
      vals[id] = { ...(vals[id] || {}), mat: t.dataset.mat };
      box.querySelectorAll("[data-mat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mat === t.dataset.mat)));
      box.querySelector(".lap-calc-out").innerHTML = outHTML(FORMULAS.find((f) => f.id === id));
    }
  }
  let searchTimer = null;
  function onInput(ev) {
    const t = ev.target;
    if (t.classList.contains("lap-search")) {
      search = t.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => render({ sel: ".lap-search", pos: t.selectionStart }), 180);
      return;
    }
    const box = t.closest("[data-calc]");
    if (box && t.dataset.f) {
      const id = box.dataset.calc;
      vals[id] = { ...(vals[id] || {}), [t.dataset.f]: t.value };
      box.querySelector(".lap-calc-out").innerHTML = outHTML(FORMULAS.find((f) => f.id === id));
    }
  }

  return {
    show(el) { page = el; page.addEventListener("click", onClick); page.addEventListener("input", onInput); render(); },
    hide() { if (page) { page.removeEventListener("click", onClick); page.removeEventListener("input", onInput); } clearTimeout(searchTimer); page = null; },
  };
}
