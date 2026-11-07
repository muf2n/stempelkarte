// Update 10 – 💡 App-Wünsche (Einstellungen › Sonstiges › 💡 App-Wünsche).
// Wünsche an die App sammeln (auch vom Claude-Assistenten über „app_wunsch_notieren“), Status pflegen und alle offenen
// mit einem Tipp als saubere Liste kopieren – zum Einfügen in Claude Code, das sie dann umsetzt.
// Reine Logik: ./app-wishes-core.js
import { collection, newId } from "./db.js";
import * as W from "./app-wishes-core.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const FILTER_KEY = "sk-wish-filter";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const fmt = (ms) => { if (!ms) return ""; const d = new Date(ms); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };
const FILTERS = [["offen", "📝 Offen"], ["umgesetzt", "✅ Umgesetzt"], ["verworfen", "🗑️ Verworfen"], ["alle", "📚 Alle"]];

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}

function ensureCss() {
  if (typeof document === "undefined" || document.getElementById("css-app-wishes")) return;
  const l = document.createElement("link");
  l.id = "css-app-wishes"; l.rel = "stylesheet";
  l.href = new URL("../../css/app-wishes.css", import.meta.url).href;
  document.head.appendChild(l);
}

/** Panel in den Einstellungen → Neu-Zeichnen-Funktion. */
export function mountPanel(el) {
  if (!el) return null;
  ensureCss();
  const col = collection("app_wishes");
  let filter = FILTERS.some((f) => f[0] === lsGet(FILTER_KEY)) ? lsGet(FILTER_KEY) : "offen";
  el.innerHTML = `<div class="aw">
    <div class="sh-card aw-intro"><p>💡 Dir fällt auf, was an der App besser sein könnte? Schreib's hier rein – oder sag dem Claude-Assistenten „Notier als App-Wunsch: …“.
      Später kopierst du alle offenen Wünsche mit einem Tipp und gibst sie <b>Claude Code</b>, das sie dann einbaut. 🛠️</p></div>
    <form class="sh-card aw-form fields" novalidate>
      <label>Was soll sich ändern?<textarea id="aw-text" rows="3" maxlength="${W.TEXT_MAX}" placeholder="z. B. Im Planer möchte ich Aufgaben per Wischen abhaken"></textarea></label>
      <div class="aw-row">
        <label>Bereich<input id="aw-area" list="aw-areas" maxlength="${W.AREA_MAX}" placeholder="optional, z. B. Planer" autocomplete="off"></label>
        <label>Wichtigkeit<select id="aw-prio">${W.PRIOS.map((p) => `<option value="${p.id}">${p.e} ${p.label}</option>`).join("")}</select></label>
      </div>
      <datalist id="aw-areas">${W.AREAS.map((a) => `<option value="${esc(a)}">`).join("")}</datalist>
      <p class="aw-err" role="alert" hidden></p>
      <button type="submit" class="btn primary" data-aw="add">➕ Wunsch notieren</button>
    </form>
    <div class="aw-bar">
      <div class="aw-filters" role="tablist" aria-label="Status"></div>
      <button type="button" class="btn ghost sm" data-aw="copy">📋 Alle offenen kopieren</button>
    </div>
    <div class="aw-list"></div>
  </div>`;
  const listEl = el.querySelector(".aw-list");
  const filtEl = el.querySelector(".aw-filters");
  const form = el.querySelector(".aw-form");
  const err = el.querySelector(".aw-err");

  function render() {
    const all = col.all();
    const c = W.counts(all);
    filtEl.innerHTML = FILTERS.map(([id, label]) => `<button type="button" role="tab" class="chip" data-aw-f="${id}" aria-selected="${filter === id}" aria-pressed="${filter === id}">${label}${c[id] ? ` <span class="aw-n">${c[id]}</span>` : ""}</button>`).join("");
    el.querySelector('[data-aw="copy"]').disabled = !c.offen;
    const list = W.sortWishes(all, filter);
    if (!col.loaded && !all.length) { listEl.innerHTML = `<p class="note">Lade …</p>`; return; }
    listEl.innerHTML = list.length ? `<ul class="aw-ul">${list.map((w) => {
      const st = W.statusById(w.status);
      return `<li class="sh-card aw-item aw-${w.status}" data-id="${esc(w.id)}">
        <div class="aw-top">${w.prio === "wichtig" ? `<span class="aw-b aw-b-imp">❗ Wichtig</span>` : ""}${w.area ? `<span class="aw-b">${esc(w.area)}</span>` : ""}<span class="aw-b aw-b-st">${st.e} ${st.label}</span></div>
        <p class="aw-text">${esc(w.text)}</p>
        <small class="note">${w.source === "assistent" ? "✨ vom Assistenten" : "📱 in der App"} · ${fmt(w.created)}</small>
        <div class="aw-acts">
          ${w.status !== "umgesetzt" ? `<button type="button" class="btn ghost sm" data-aw="done">✅ Umgesetzt</button>` : ""}
          ${w.status !== "offen" ? `<button type="button" class="btn ghost sm" data-aw="reopen">↩️ Wieder offen</button>` : ""}
          ${w.status === "offen" ? `<button type="button" class="btn ghost sm" data-aw="drop">🗑️ Verwerfen</button>` : ""}
          <button type="button" class="btn ghost sm" data-aw="edit">✏️ Bearbeiten</button>
          <button type="button" class="btn ghost sm aw-del" data-aw="del">Löschen</button>
        </div></li>`;
    }).join("")}</ul>`
      : `<div class="sh-card aw-empty"><p>${filter === "offen" ? (c.alle ? "Keine offenen Wünsche – alles erledigt! 🎉" : "Noch keine Wünsche. Was würdest du an der App gern ändern? 😊") : "Hier ist nichts."}</p></div>`;
    listEl.querySelectorAll('[data-aw="del"]').forEach((b) => ui.confirmButton(b, "Wirklich löschen?", () => {
      const id = b.closest("[data-id]").dataset.id;
      col.remove(id).then(() => ui.toast("Wunsch gelöscht 🗑️")).catch((e) => { console.error(e); ui.toast("Löschen hat nicht geklappt."); });
    }));
  }

  function setStatus(id, status, msg) {
    const w = col.get(id);
    if (!w) return;
    col.patch(id, { status, updated: Date.now() }).then(() => ui.toast(msg)).catch((e) => { console.error(e); ui.toast("Speichern hat nicht geklappt. 🙈"); });
  }

  function openEdit(id) {
    const w = W.normWish(col.get(id));
    if (!w.id) return;
    ui.openSheet({
      title: "✏️ Wunsch bearbeiten",
      bodyHTML: `<form class="fields aw-form" novalidate>
        <label>Was soll sich ändern?<textarea id="aw-e-text" rows="4" maxlength="${W.TEXT_MAX}">${esc(w.text)}</textarea></label>
        <div class="aw-row"><label>Bereich<input id="aw-e-area" list="aw-areas" maxlength="${W.AREA_MAX}" value="${esc(w.area)}" autocomplete="off"></label>
          <label>Wichtigkeit<select id="aw-e-prio">${W.PRIOS.map((p) => `<option value="${p.id}"${p.id === w.prio ? " selected" : ""}>${p.e} ${p.label}</option>`).join("")}</select></label></div>
        <label>Status<select id="aw-e-status">${W.STATUS.map((x) => `<option value="${x.id}"${x.id === w.status ? " selected" : ""}>${x.e} ${x.label}</option>`).join("")}</select></label>
        <p class="aw-err" role="alert" hidden></p>
        <div class="row"><button type="submit" class="btn primary">Speichern</button></div></form>`,
      onMount(sheet, close) {
        const f = sheet.querySelector("form");
        f.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const v = W.validate({ ...w, text: f.querySelector("#aw-e-text").value, area: f.querySelector("#aw-e-area").value, prio: f.querySelector("#aw-e-prio").value, status: f.querySelector("#aw-e-status").value });
          const e = f.querySelector(".aw-err");
          if (!v.ok) { e.textContent = v.error; e.hidden = false; return; }
          try { await col.put({ ...v.wish, updated: Date.now() }); ui.toast("Gespeichert ✓"); close(); }
          catch (er) { console.error(er); ui.toast("Speichern hat nicht geklappt. 🙈"); }
        });
      },
    });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = form.querySelector("#aw-text").value;
    const v = W.validate({ text, area: form.querySelector("#aw-area").value, prio: form.querySelector("#aw-prio").value });
    if (!v.ok) { err.textContent = v.error; err.hidden = false; return; }
    if (W.isDuplicate(col.all(), v.wish.text)) { err.textContent = "Den Wunsch gibt's schon (offen). 😊"; err.hidden = false; return; }
    err.hidden = true;
    const now = Date.now();
    try {
      await col.put({ ...v.wish, id: newId(), status: "offen", source: "app", created: now, updated: now });
      form.reset();
      if (filter !== "offen" && filter !== "alle") { filter = "offen"; lsSet(FILTER_KEY, filter); }
      ui.toast("Wunsch notiert 💡");
    } catch (e) { console.error(e); ui.toast("Speichern hat nicht geklappt. 🙈"); }
  });

  el.addEventListener("click", async (ev) => {
    const f = ev.target.closest("[data-aw-f]");
    if (f) { filter = f.dataset.awF; lsSet(FILTER_KEY, filter); render(); return; }
    const b = ev.target.closest("[data-aw]");
    if (!b || !el.contains(b)) return;
    const id = (b.closest("[data-id]") || {}).dataset ? b.closest("[data-id]") && b.closest("[data-id]").dataset.id : "";
    switch (b.dataset.aw) {
      case "copy": {
        const t = W.copyText(col.all());
        if (!t) { ui.toast("Keine offenen Wünsche zum Kopieren."); break; }
        ui.toast((await copy(t)) ? `📋 ${W.counts(col.all()).offen} offene Wünsche kopiert – jetzt in Claude Code einfügen` : "Kopieren nicht möglich. 🙈", 3500);
        break;
      }
      case "done": setStatus(id, "umgesetzt", "Umgesetzt ✅ – super!"); break;
      case "reopen": setStatus(id, "offen", "Wieder offen 📝"); break;
      case "drop": setStatus(id, "verworfen", "Verworfen 🗑️"); break;
      case "edit": openEdit(id); break;
      default: break;
    }
  });

  col.watch(() => render());
  render();
  return render;
}
