// Alltag › LAP › 🧮 Taschenrechner zum Aufklappen (Rechenaufgaben + Prüfung). Rechnet mit ./calc-core.js (kein eval).
//   const calc = createCalc({ onTake(text) {…} });   calc.html({ take:true })  →  Panel-HTML (im eigenen Bereich einsetzen)
//   calc.click(ev) / calc.input(ev) / calc.key(ev) im Bereich aufrufen (true = erledigt). Zustand (offen, Ausdruck) bleibt im Speicher.
import { evaluate, format } from "./calc-core.js";
import { esc } from "../util.js";

const KEYS = [
  ["C", "clear", "fn"], ["(", "(", ""], [")", ")", ""], ["⌫", "back", "fn"],
  ["√", "√", "op"], ["x²", "^2", "op"], ["^", "^", "op"], ["÷", "÷", "op"],
  ["7", "7", ""], ["8", "8", ""], ["9", "9", ""], ["×", "×", "op"],
  ["4", "4", ""], ["5", "5", ""], ["6", "6", ""], ["−", "−", "op"],
  ["1", "1", ""], ["2", "2", ""], ["3", "3", ""], ["+", "+", "op"],
  ["0", "0", ""], [",", ",", ""], ["π", "π", ""], ["=", "eq", "eq"],
];

/** Zahl ohne Tausenderpunkte (wieder einlesbar), höchstens 12 signifikante Stellen. */
export const plain = (v) => String(Number.parseFloat(Number(v).toPrecision(12))).replace(".", ",");

export function createCalc({ onTake } = {}) {
  let open = false;
  let expr = "";

  function result() {
    if (!expr.trim()) return { ok: false, text: "" };
    try { const v = evaluate(expr); return Number.isFinite(v) ? { ok: true, v, text: format(v) } : { ok: false, text: "–" }; }
    catch { return { ok: false, text: "…" }; }
  }
  function inner(take) {
    const r = result();
    return `<div class="lap-calc-screen"><input class="lap-calc-expr" inputmode="none" autocomplete="off" spellcheck="false" aria-label="Rechnung" placeholder="z. B. 230 ÷ 46" value="${esc(expr)}">` +
        `<output class="lap-calc-res${r.ok ? "" : " soft"}" aria-live="polite">${r.ok ? "= " + esc(r.text) : esc(r.text) || "&nbsp;"}</output></div>` +
      `<div class="lap-keys" role="group" aria-label="Tasten">` +
        KEYS.map(([l, k, c]) => `<button type="button" class="lap-key${c ? " " + c : ""}" data-ck="${esc(k)}" aria-label="${esc(l === "−" ? "minus" : l === "⌫" ? "löschen" : l)}">${esc(l)}</button>`).join("") +
      `</div>` +
      (take ? `<button type="button" class="btn primary sm lap-full" data-ck="take" ${r.ok ? "" : "disabled"}>📥 Ergebnis übernehmen</button>` : "");
  }
  function refresh(root, take) {
    const box = root && root.querySelector(".lap-calcbox .lap-calc-in");
    if (!box) return;
    const had = document.activeElement && document.activeElement.classList.contains("lap-calc-expr");
    box.innerHTML = inner(take);
    if (had) { const i = box.querySelector(".lap-calc-expr"); i.focus({ preventScroll: true }); i.setSelectionRange(expr.length, expr.length); }
  }

  return {
    html({ take = false } = {}) {
      return `<details class="lap-calcbox" data-take="${take ? 1 : 0}"${open ? " open" : ""}><summary>🧮 Taschenrechner</summary><div class="lap-calc-in">${inner(take)}</div></details>`;
    },
    /** Klick im Bereich – true, wenn der Rechner ihn verarbeitet hat. */
    click(ev) {
      const sum = ev.target.closest(".lap-calcbox > summary");
      if (sum) { setTimeout(() => { open = !!sum.parentElement.open; }, 0); return true; }
      const b = ev.target.closest("[data-ck]");
      if (!b) return false;
      const root = b.closest(".lap-calcbox");
      const take = root && root.dataset.take === "1";
      const k = b.dataset.ck;
      if (k === "take") { const r = result(); if (r.ok && onTake) onTake(plain(r.v)); return true; }
      if (k === "clear") expr = "";
      else if (k === "back") expr = expr.slice(0, -1);
      else if (k === "eq") { const r = result(); if (r.ok) expr = plain(r.v); }
      else expr += k;
      refresh(root.parentElement, take);
      return true;
    },
    input(ev) {
      if (!ev.target.classList.contains("lap-calc-expr")) return false;
      expr = ev.target.value;
      const root = ev.target.closest(".lap-calcbox");
      const out = root.querySelector(".lap-calc-res");
      const r = result();
      out.textContent = r.ok ? "= " + r.text : r.text || " ";
      out.classList.toggle("soft", !r.ok);
      const t = root.querySelector('[data-ck="take"]');
      if (t) t.disabled = !r.ok;
      return true;
    },
    /** Enter im Rechnerfeld = „=“ (statt Formular abschicken). */
    key(ev) {
      if (ev.key !== "Enter" || !ev.target.classList || !ev.target.classList.contains("lap-calc-expr")) return false;
      ev.preventDefault();
      const r = result();
      if (r.ok) { expr = plain(r.v); const root = ev.target.closest(".lap-calcbox"); refresh(root.parentElement, root.dataset.take === "1"); }
      return true;
    },
    reset() { expr = ""; },
  };
}
