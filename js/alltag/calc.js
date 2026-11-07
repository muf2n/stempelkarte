// 🧮 Taschenrechner (Alltag). Logik: calc-core.js. Verlauf nur auf diesem Gerät (localStorage).
import { evaluate, format } from "./calc-core.js";

const HIST_KEY = "sk-calc-hist";
const KEYS = [
  ["C", "clear", "fn"], ["( )", "paren", "fn"], ["%", "%", "fn"], ["÷", "÷", "op"],
  ["7", "7"], ["8", "8"], ["9", "9"], ["×", "×", "op"],
  ["4", "4"], ["5", "5"], ["6", "6"], ["−", "−", "op"],
  ["1", "1"], ["2", "2"], ["3", "3"], ["+", "+", "op"],
  ["√", "√", "fn"], ["0", "0"], [",", ","], ["=", "eq", "eq"],
];
const EXTRA = [["x²", "^2"], ["^", "^"], ["π", "π"], ["±", "neg"], ["⌫", "back"]];

function loadCss() {
  if (document.querySelector('link[data-css="calc"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.dataset.css = "calc";
  l.href = new URL("../../css/alltag-calc.css", import.meta.url).href;
  document.head.appendChild(l);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function loadHist() { try { const a = JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); return Array.isArray(a) ? a.slice(0, 30) : []; } catch { return []; } }
function saveHist(h) { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 30))); } catch {} }

export function mount(el, ctx) {
  loadCss();
  let expr = "", last = null, hist = loadHist(), justDone = false;
  el.innerHTML = `<div class="calc">
    <div class="calc-screen" aria-live="polite">
      <div class="calc-expr" data-c="expr"></div>
      <div class="calc-out" data-c="out">0</div>
    </div>
    <div class="calc-extra">${EXTRA.map(([l, k]) => `<button type="button" data-k="${esc(k)}" aria-label="${esc(l)}">${esc(l)}</button>`).join("")}</div>
    <div class="calc-keys">${KEYS.map(([l, k, cls]) => `<button type="button" class="${cls || "num"}" data-k="${esc(k)}">${esc(l)}</button>`).join("")}</div>
    <div class="calc-hist"><div class="calc-hh"><b>🕓 Verlauf</b><button type="button" class="calc-link" data-c="clearhist">Leeren</button></div><ul data-c="hist"></ul></div>
  </div>`;
  const $ = (s) => el.querySelector(`[data-c="${s}"]`);

  function preview() {
    try { return expr ? format(evaluate(expr)) : "0"; } catch { return null; }
  }
  function draw() {
    $("expr").textContent = expr || (last ? "" : " ");
    const p = preview();
    $("out").textContent = justDone && last ? last.res : p != null ? p : $("out").textContent;
    $("out").classList.toggle("dim", !justDone && !!expr);
    $("hist").innerHTML = hist.length
      ? hist.map((h, i) => `<li><button type="button" data-h="${i}"><span>${esc(h.expr)} =</span><b>${esc(h.res)}</b></button></li>`).join("")
      : `<li class="calc-empty">🧮 Noch nichts gerechnet.</li>`;
  }
  function put(k) {
    if (justDone) { // nach „=“: Zahl startet neu, Operator rechnet mit dem Ergebnis weiter
      expr = /^[0-9,√(π]$/.test(k) ? "" : last ? last.res.replace(/\./g, "") : "";
      justDone = false;
    }
    if (/^[+×÷−^]$/.test(k) && /[+×÷−^]$/.test(expr) && k !== "−") expr = expr.slice(0, -1); // Operator ersetzen
    expr += k;
  }
  function press(k) {
    if (k === "clear") { expr = ""; last = null; justDone = false; }
    else if (k === "back") { if (justDone) { justDone = false; expr = last ? last.res.replace(/\./g, "") : ""; } expr = expr.slice(0, -1); }
    else if (k === "paren") {
      const open = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
      put(open > 0 && /[0-9)%π]$/.test(expr) ? ")" : "(");
    }
    else if (k === "neg") {
      if (justDone && last) { expr = last.res.replace(/\./g, ""); justDone = false; }
      const m = expr.match(/(−?)([0-9,]+)$/);
      if (m) expr = expr.slice(0, expr.length - m[0].length) + (m[1] ? "" : "−") + m[2];
      else expr += "−";
    }
    else if (k === "eq") {
      if (!expr) return;
      try {
        const res = format(evaluate(expr));
        last = { expr, res };
        hist.unshift(last); saveHist(hist);
        justDone = true;
      } catch (err) {
        $("out").textContent = "⚠️ " + (err.message || "Fehler");
        $("out").classList.remove("dim");
        return;
      }
    }
    else put(k);
    draw();
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.k) return press(b.dataset.k);
    if (b.dataset.h != null) { const h = hist[+b.dataset.h]; if (h) { expr = h.expr; justDone = false; draw(); } return; }
    if (b.dataset.c === "clearhist") { hist = []; saveHist(hist); draw(); }
  });
  $("out").addEventListener("click", async () => {
    const t = $("out").textContent;
    if (!/^-?[0-9.,]+$/.test(t)) return;
    try { await navigator.clipboard.writeText(t.replace(/\./g, "")); ctx && ctx.ui && ctx.ui.toast("📋 Ergebnis kopiert", 1500); } catch {}
  });
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "")) return;
    const map = { "*": "×", "/": "÷", "-": "−", "+": "+", ".": ",", ",": ",", "%": "%", "^": "^", "(": "(", ")": ")", Enter: "eq", "=": "eq", Backspace: "back", Escape: "clear", Delete: "clear" };
    const k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
    if (!k) return;
    e.preventDefault();
    press(k);
  };
  document.addEventListener("keydown", onKey);
  draw();
  return () => document.removeEventListener("keydown", onKey);
}
