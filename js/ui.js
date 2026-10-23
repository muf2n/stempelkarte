// UI-Bausteine: Toast-Meldung, modales Blatt (Sheet), Zweifach-Tipp-Bestätigung, Lade-Zustand für Knöpfe.

import { esc } from "./util.js";

/* ---------- Toast ---------- */

let toastTimer = null;

/** Kurze Meldung unten anzeigen; ersetzt einen laufenden Toast. */
export function toast(msg, ms = 2400) {
  const el = document.getElementById("toast");
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = msg == null ? "" : String(msg);
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.hidden = false;
  toastTimer = setTimeout(() => {
    el.hidden = true;
    toastTimer = null;
  }, Math.max(800, Number(ms) || 2400));
}

/* ---------- Sheet ---------- */

const openSheets = []; // Stapel offener Blätter (oberstes zuletzt)
let savedOverflow = null;

function lockScroll() {
  if (savedOverflow === null) {
    savedOverflow = document.body.style.overflow || "";
    document.body.style.overflow = "hidden";
  }
}

function unlockScroll() {
  if (openSheets.length === 0 && savedOverflow !== null) {
    document.body.style.overflow = savedOverflow;
    savedOverflow = null;
  }
}

function onKeyDown(ev) {
  if (ev.key === "Escape" || ev.key === "Esc") {
    const top = openSheets[openSheets.length - 1];
    if (top) {
      ev.preventDefault();
      top.close();
    }
  }
}

/**
 * Modales Blatt von unten öffnen.
 * @returns {{el: HTMLElement, close: () => void}}  el = .sheet-Element
 */
export function openSheet({ title = "", bodyHTML = "", onMount } = {}) {
  let root = document.getElementById("sheet-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "sheet-root";
    document.body.appendChild(root);
  }

  const prevFocus = document.activeElement;
  const titleId = "sheet-t-" + Math.random().toString(36).slice(2, 9);

  const el = document.createElement("div");
  el.className = "sheet";
  el.innerHTML =
    `<div class="box" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">` +
    `<div class="sheet-head" style="display:flex;align-items:center;justify-content:space-between;gap:12px">` +
    `<h2 id="${titleId}">${esc(title)}</h2>` +
    `<button type="button" class="close" aria-label="Schließen">✕</button>` +
    `</div>` +
    `<div class="sheet-body">${bodyHTML || ""}</div>` +
    `</div>`;

  let closed = false;
  const entry = { close };

  function close() {
    if (closed) return;
    closed = true;
    const i = openSheets.indexOf(entry);
    if (i >= 0) openSheets.splice(i, 1);
    el.remove();
    if (openSheets.length === 0) document.removeEventListener("keydown", onKeyDown);
    unlockScroll();
    if (prevFocus && typeof prevFocus.focus === "function" && document.contains(prevFocus)) {
      try { prevFocus.focus({ preventScroll: true }); } catch { /* egal */ }
    }
  }

  // Hintergrund-Tipp schließt (nur wenn Druck UND Loslassen auf dem Hintergrund – verhindert
  // versehentliches Schließen beim Markieren von Text im Formular).
  let downOnBackdrop = false;
  el.addEventListener("pointerdown", (ev) => { downOnBackdrop = ev.target === el; });
  el.addEventListener("click", (ev) => {
    if (ev.target === el && downOnBackdrop) close();
    downOnBackdrop = false;
  });
  el.querySelector(".close").addEventListener("click", close);

  if (openSheets.length === 0) document.addEventListener("keydown", onKeyDown);
  openSheets.push(entry);
  lockScroll();
  root.appendChild(el);

  const box = el.querySelector(".box");
  try { box.focus({ preventScroll: true }); } catch { /* egal */ }

  if (typeof onMount === "function") {
    try {
      onMount(el, close);
    } catch (err) {
      console.error("openSheet onMount:", err);
    }
  }
  return { el, close };
}

/* ---------- Zweifach-Tipp-Bestätigung ---------- */

/**
 * Erster Tipp: Text → label2; zweiter Tipp innerhalb 4 s → onConfirm(ev).
 * Danach bzw. nach Ablauf wird der Originaltext wiederhergestellt.
 */
export function confirmButton(btn, label2 = "Wirklich?", onConfirm) {
  if (!btn) return;
  const original = btn.textContent;
  let armed = false;
  let timer = null;

  const reset = () => {
    clearTimeout(timer);
    timer = null;
    armed = false;
    btn.textContent = original;
    btn.removeAttribute("data-armed");
  };

  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    if (btn.disabled) return;
    if (!armed) {
      armed = true;
      btn.textContent = label2;
      btn.setAttribute("data-armed", "1");
      timer = setTimeout(reset, 4000);
      return;
    }
    reset();
    if (typeof onConfirm === "function") {
      try {
        await onConfirm(ev);
      } catch (err) {
        console.error("confirmButton:", err);
      }
    }
  });
}

/* ---------- Lade-Zustand ---------- */

/** Knopf deaktivieren und Text tauschen (busy=true) bzw. alten Text wiederherstellen (busy=false). */
export function setBusy(btn, busy, busyText) {
  if (!btn) return;
  if (busy) {
    if (btn.dataset.busyOrig === undefined) btn.dataset.busyOrig = btn.textContent;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    if (busyText != null) btn.textContent = busyText;
  } else {
    if (btn.dataset.busyOrig !== undefined) {
      btn.textContent = btn.dataset.busyOrig;
      delete btn.dataset.busyOrig;
    }
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
  }
}
