// Update 10 E – gemeinsame Bausteine für 📁 Dokumente, 📜 Verträge, 📦 Inventar, 👤 Kontakte (CSS css/alltag-akten.css, Präfix .ak-).
// „📎 Dokumente“-Liste für verknüpfte Seiten (Baustelle, Vertrag, Inventar, Kontakt) – liest den entschlüsselten Stand
// (dokumente-store.js, nur solange der Tresor entsperrt ist; gesperrt → nur Hinweis „🔒 entsperren“).
import { collection } from "./db.js";
import * as DS from "./dokumente-store.js"; // Update 10 – 🔒
import { hasVault as hasVaultSafe } from "./vault-session.js";
import * as D from "./dokumente-core.js";
import * as store from "../store.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { siteHash } from "../site-core.js";
import { eur as moneyEur } from "./money-core.js";

export function injectCSS() {
  if (typeof document === "undefined" || document.getElementById("ak-css")) return;
  const l = document.createElement("link");
  l.id = "ak-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-akten.css", import.meta.url).href;
  document.head.appendChild(l);
}

const pad = (n) => String(n).padStart(2, "0");
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const fmtKey = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(String(k || "")) ? `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}` : "");
export const snap = () => { try { return store.get() || {}; } catch { return {}; } };
export const places = () => (Array.isArray(snap().places) ? snap().places.filter((p) => p && p.id) : []);
export const safe = (p, ok) => Promise.resolve(p).then(() => { if (ok) ui.toast(ok); return true; })
  .catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren. 🙈"); return false; });
export const eur = (v) => moneyEur(Number(v) || 0); // wie im Geld-Bereich: 1.234,56 €
export const num = (v) => { const t = String(v ?? "").trim().replace(/\s/g, ""); if (!t) return null; const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); return Number.isFinite(n) ? n : null; };
export const amountIn = (v) => (v == null || v === "" ? "" : String(v).replace(".", ","));

/** Ereignis-Hilfe: Bildschirm-Wechsel per Hash. */
export function go(hash) {
  const h = String(hash || "").replace(/^#/, "");
  if (location.hash.replace(/^#/, "") === h) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = h;
}

/** Ziel eines Dokument-Links: Hash (oder null, wenn die App das selbst öffnen muss). */
export function linkHash(l) {
  switch (l.k) {
    case "place": return siteHash(l.id);
    case "tx": return "#alltag/geld?tab=buchungen";
    case "vertrag": return `#alltag/vertraege/${encodeURIComponent(l.id)}`;
    case "inventar": return `#alltag/inventar/${encodeURIComponent(l.id)}`;
    case "kontakt": return `#alltag/kontakte/${encodeURIComponent(l.id)}`;
    case "beleg": return `#alltag/buchhaltung/beleg/${encodeURIComponent(l.id)}`; // Update 10 – 💼 Buchhaltung
    default: return null;
  }
}

/**
 * „📎 Dokumente“ für eine verknüpfte Seite. Gibt HTML zurück (liest den letzten Stand der Sammlung) –
 * neu zeichnen, wenn sich watchDocs meldet. k/id = Verknüpfung (z. B. "inventar", "<id>").
 */
export function linkedDocsHTML(k, id, { title = "📎 Dokumente", cls = "" } = {}) {
  const open = linkedDocs(k, id);
  const list = (open || []).sort((a, b) => (b.date > a.date ? 1 : -1));
  const add = `#alltag/dokumente?neu=${encodeURIComponent(k)}:${encodeURIComponent(id)}`;
  const locked = !open && DS.raw().length;
  return `<section class="ak-linked ${cls}"><header class="ak-linked-h"><h3>${esc(title)}</h3><a class="btn ghost sm" href="${esc(add)}">＋ Dokument</a></header>` +
    (locked ? `<p class="note ak-linked-lock">🔒 Deine Dokumente sind gesperrt – <a href="#alltag/dokumente">entsperren</a>, um die verknüpften zu sehen.</p>` : list.length ? `<ul class="ak-linked-l">${list.map((d) =>
      `<li><a class="ak-linked-i" href="${esc(D.docHash(d.id))}"><span class="ak-linked-ic">${d.thumb ? `<img src="${esc(d.thumb)}" alt="">` : `<span aria-hidden="true">${D.kindIcon(d)}</span>`}</span>` +
      `<span class="ak-linked-t"><b>${esc(d.title)}</b><small>${esc([D.folderOf(d.folder).label, fmtKey(d.date)].filter(Boolean).join(" · "))}</small></span></a></li>`).join("")}</ul>`
      : `<p class="note">${DS.loaded() ? "Noch nichts verknüpft – Rechnung, Vertrag oder Foto hier ablegen. 📄" : "Lade …"}</p>`) +
    `</section>`;
}
/** Bei Änderungen an „dokumente“ (auch Entsperren/Sperren) cb aufrufen → Abmelde-Funktion. */
export const watchDocs = (cb) => DS.watch(cb);
/** Verknüpfte Dokumente (entschlüsselt) – oder null, solange gesperrt. Alte Klartext-Dokumente ohne Tresor: wie bisher. */
export function linkedDocs(k, id) {
  const open = DS.docs();
  if (open) return D.linkedTo(open, k, id);
  if (hasVaultSafe()) return null; // Tresor da, aber gesperrt (oder entschlüsselt gerade)
  return D.linkedTo(DS.raw().filter((r) => r.enc !== 1), k, id); // noch kein Tresor: alte Klartext-Dokumente wie bisher
}

/** Leerer Zustand im gemütlichen Stil. */
export const emptyHTML = (emo, title, text, btn = "", act = "") =>
  `<div class="empty ak-empty"><div class="ak-empty-emo" aria-hidden="true">${emo}</div><h3>${esc(title)}</h3><p>${text}</p>${btn ? `<button type="button" class="btn primary sm" data-ak="${esc(act)}">${esc(btn)}</button>` : ""}</div>`;

/** Kleines Warte-Promise, bis eine Sammlung geladen ist (max. ms). */
export function whenLoaded(col, ms = 4000) {
  if (col.loaded) return Promise.resolve();
  return new Promise((res) => {
    let off = null;
    const t = setTimeout(() => { if (off) off(); res(); }, ms);
    off = col.watch(() => { if (col.loaded) { clearTimeout(t); queueMicrotask(() => { if (off) off(); }); res(); } });
  });
}

/** Detail-Route-Helfer: Hash-Wechsel innerhalb des Moduls beobachten → Abmelde-Funktion. */
export function onRoute(cb) {
  const h = () => cb(location.hash);
  window.addEventListener("hashchange", h);
  return () => window.removeEventListener("hashchange", h);
}
