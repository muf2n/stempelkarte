// Update 12 – kleine gemeinsame UI-Bausteine für die neuen Alltag-Module (Tiere, Kleiderschrank, Gruppen, Wohnen).
import * as ui from "../ui.js";
import { esc } from "../util.js";

export const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
export const safe = (p, ok) => Promise.resolve(p).then((r) => { if (ok) ui.toast(ok); return r ?? true; })
  .catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); return false; });

export function loadCss(name) {
  if (document.querySelector(`link[data-css="${name}"]`)) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.css = name;
  l.href = new URL(`../../css/alltag-${name}.css`, import.meta.url).href; document.head.appendChild(l);
}
/** Tab-Leiste (gemeinsames Aussehen .xu-tabs). */
export const tabsHTML = (tabs, cur) => `<div class="xu-tabs" role="tablist">${tabs.map(([id, e, l, n]) => `<button type="button" role="tab" class="xu-tab${cur === id ? " on" : ""}" aria-selected="${cur === id}" data-tab="${id}"><span aria-hidden="true">${e}</span>${esc(l)}${n ? `<i>${n}</i>` : ""}</button>`).join("")}</div>`;
export const empty = (emo, title, text) => `<div class="empty xu-empty"><div class="xu-emo" aria-hidden="true">${emo}</div><h3>${esc(title)}</h3><p>${text}</p></div>`;

/**
 * Formular als Blatt. fields: [{ id, label, type: text|number|date|time|textarea|select|check|month, value, options: [[v, l]], placeholder, max }]
 * onSave(values) → false = offen lassen. onDelete optional.
 */
export function form({ title, fields, onSave, onDelete, saveLabel = "Speichern", note = "" }) {
  const f = (x) => {
    const id = `xf-${x.id}`, v = x.value ?? "";
    if (x.type === "textarea") return `<label>${esc(x.label)}<textarea id="${id}" rows="${x.rows || 3}" maxlength="${x.max || 1000}" placeholder="${esc(x.placeholder || "")}">${esc(v)}</textarea></label>`;
    if (x.type === "select") return `<label>${esc(x.label)}<select id="${id}">${x.options.map(([o, l]) => `<option value="${esc(o)}"${String(o) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
    if (x.type === "check") return `<label class="switch"><span>${esc(x.label)}</span><input type="checkbox" id="${id}"${v ? " checked" : ""}></label>`;
    if (x.type === "chips") return `<div class="lbl">${esc(x.label)}</div><div class="chips" data-xchips="${x.id}">${x.options.map(([o, l]) => `<button type="button" class="chip sm" data-v="${esc(o)}" aria-pressed="${(v || []).includes(o)}">${esc(l)}</button>`).join("")}</div>`;
    if (x.type === "row") return `<div class="row">${x.fields.map(f).join("")}</div>`;
    if (x.type === "html") return x.html;
    const t = x.type === "number" ? "text\" inputmode=\"decimal" : x.type || "text";
    return `<label>${esc(x.label)}<input id="${id}" type="${t}" value="${esc(v)}" maxlength="${x.max || 120}" placeholder="${esc(x.placeholder || "")}" autocomplete="off"></label>`;
  };
  ui.openSheet({
    title,
    bodyHTML: `<div class="fields">${note ? `<p class="note">${note}</p>` : ""}${fields.map(f).join("")}</div><div class="row">${onDelete ? `<button type="button" class="btn danger sm" data-del>Löschen</button>` : ""}<button type="button" class="btn primary" data-save>${esc(saveLabel)}</button></div>`,
    onMount(sh, close) {
      sh.querySelectorAll("[data-xchips]").forEach((g) => g.addEventListener("click", (ev) => { const c = ev.target.closest("[data-v]"); if (c) c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true")); }));
      const first = sh.querySelector("input:not([type=checkbox]), textarea"); if (first && !first.value) first.focus();
      sh.querySelector("[data-save]").addEventListener("click", async () => {
        const vals = {};
        const all = (list) => { for (const x of list) { if (x.type === "row") { all(x.fields); continue; } if (x.type === "html") continue;
          if (x.type === "chips") { vals[x.id] = [...sh.querySelectorAll(`[data-xchips="${x.id}"] [aria-pressed="true"]`)].map((c) => c.dataset.v); continue; }
          const e = sh.querySelector(`#xf-${x.id}`); if (e) vals[x.id] = x.type === "check" ? e.checked : e.value.trim(); } };
        all(fields);
        if ((await onSave(vals, sh)) !== false) close();
      });
      const d = sh.querySelector("[data-del]"); if (d) ui.confirmButton(d, "Wirklich löschen?", () => { close(); onDelete(); });
    },
  });
}

/** Foto auswählen und auf ein kleines JPEG (max. 480 px) verkleinern → dataURL oder "". */
export function pickPhoto() {
  return new Promise((res) => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.addEventListener("change", () => {
      const file = inp.files && inp.files[0]; if (!file) { res(""); return; }
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res(c.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(""); };
      img.src = url;
    });
    inp.click();
  });
}
export const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
