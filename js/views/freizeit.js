// Freizeit-Stempeluhr im Privat-Modus: Sport (Radfahren, Laufen …) und Zuhause (Aufräumen, Heimwerken …).
// Zählt NIE als Arbeitszeit. Daten: Alltag-Sammlung "freizeit" (js/alltag/db.js). Logik: js/freizeit-core.js.
import * as F from "../freizeit-core.js";
import { collection } from "../alltag/db.js";
import { esc } from "../util.js";
import { confirmButton } from "../ui.js";
import { isPrivatNow } from "../privat.js";

let ctx = null, root = null, col = null, off = null, items = [], timer = null, open = null, lastSnap = null;

function loadCss() {
  if (document.querySelector('link[data-css="freizeit"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.dataset.css = "freizeit";
  l.href = new URL("../../css/freizeit.css", import.meta.url).href;
  document.head.appendChild(l);
}

export function mount(el, c) {
  ctx = c; root = el; loadCss();
  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
}

/** Vom Heute-Tab bei jedem Store-Update aufgerufen. */
export function update(snap, fromTick = false) {
  if (!root) return;
  lastSnap = snap || lastSnap;
  const priv = !!(lastSnap && isPrivatNow(lastSnap));
  const run = F.running(items);
  const show = priv || !!run;
  if (fromTick && show === !root.hidden) return; // Zeitplan-Wechsel nur bei Änderung neu zeichnen
  root.hidden = !show;
  if (!show) { stopTimer(); return; }
  if (!col) { col = collection("freizeit"); off = col.watch((arr) => { items = arr; draw(); }); return; }
  const ae = document.activeElement;
  if (ae && root.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "SELECT")) return; // beim Tippen nicht neu zeichnen
  draw();
}

function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

function draw() {
  if (!root || root.hidden) return;
  const now = Date.now();
  const run = F.running(items);
  const week = F.summary(items.filter((i) => i && i.end), F.weekStart(now), now);
  const today = items.filter((i) => i && i.start >= F.dayStart(now)).sort((a, b) => b.start - a.start);
  let h = `<div class="card fz"><div class="fz-head"><h2>🏠 Freizeit-Stempeluhr</h2><small>zählt nicht als Arbeit</small></div>`;

  if (run) {
    h += `<div class="fz-run" role="status"><span class="fz-big" aria-hidden="true">${esc(run.emoji)}</span>
      <div><b>${esc(run.label)}</b><div class="fz-clock" data-fz="clock">${F.fmtClock(F.durMs(run, now))}</div></div></div>`;
    if (open === "stop") {
      const a = F.activity(run.kind);
      h += `<form class="fz-stop" data-fz="stopform">
        ${a && a.km ? `<label>📏 Kilometer <input id="fz-km" inputmode="decimal" placeholder="z. B. 12,5" autocomplete="off"></label>` : ""}
        <label>📝 Notiz <input id="fz-note" maxlength="120" placeholder="optional" autocomplete="off"></label>
        <div class="fz-btns"><button type="submit" class="btn primary">✅ Speichern</button><button type="button" class="btn ghost" data-fz="back">Zurück</button></div>
      </form>`;
    } else {
      h += `<div class="fz-btns"><button type="button" class="btn primary" data-fz="stop">⏹️ Fertig</button><button type="button" class="btn ghost" data-fz="cancel">Verwerfen</button></div>`;
    }
  } else {
    for (const cat of ["sport", "zuhause"]) {
      h += `<div class="fz-sub">${F.CATS[cat].emoji} ${F.CATS[cat].label}</div><div class="fz-chips">` +
        F.ACTIVITIES.filter((a) => a.cat === cat).map((a) => `<button type="button" class="fz-chip" data-start="${a.kind}"><span aria-hidden="true">${a.emoji}</span>${esc(a.label)}</button>`).join("") +
        `</div>`;
    }
    h += open === "own"
      ? `<form class="fz-own" data-fz="ownform"><input id="fz-own" maxlength="40" placeholder="z. B. Klettern, Auto putzen" autocomplete="off" aria-label="Eigene Aktivität">
          <select id="fz-owncat" aria-label="Art"><option value="sport">💪 Sport</option><option value="zuhause">🏡 Zuhause</option></select>
          <button type="submit" class="btn primary">▶️ Los</button></form>`
      : `<button type="button" class="fz-chip fz-ownbtn" data-fz="own">➕ Eigene Aktivität</button>`;
  }

  if (week.total > 0) {
    h += `<div class="fz-week"><div class="fz-sub">📊 Diese Woche</div>
      <div class="fz-tiles"><div><span>💪 Sport</span><b>${F.fmtDur(week.cats.sport)}</b></div><div><span>🏡 Zuhause</span><b>${F.fmtDur(week.cats.zuhause)}</b></div>${week.km ? `<div><span>📏 Strecke</span><b>${String(week.km).replace(".", ",")} km</b></div>` : ""}</div>
      <ul class="fz-top">${week.list.slice(0, 4).map((x) => `<li><span aria-hidden="true">${esc(x.emoji)}</span>${esc(x.label)}<small>${x.n}× · ${F.fmtDur(x.ms)}</small></li>`).join("")}</ul></div>`;
  }
  const done = today.filter((i) => i.end);
  if (done.length) {
    h += `<div class="fz-sub">Heute</div><ul class="fz-today">${done.map((i) => `<li><span aria-hidden="true">${esc(i.emoji)}</span><span>${esc(i.label)}${i.km ? ` · ${String(i.km).replace(".", ",")} km` : ""}${i.note ? `<small>${esc(i.note)}</small>` : ""}</span><small>${clock(i.start)}–${clock(i.end)} · ${F.fmtDur(F.durMs(i, now))}</small><button type="button" class="fz-del" data-del="${esc(i.id)}" aria-label="${esc(i.label)} löschen">🗑️</button></li>`).join("")}</ul>`;
  }
  h += `</div>`;
  root.innerHTML = h;
  const cb = root.querySelector('[data-fz="cancel"]');
  if (cb) confirmButton(cb, "Wirklich verwerfen?", async () => { const r = F.running(items); if (r) await col.remove(r.id); });
  root.querySelectorAll("[data-del]").forEach((b) => confirmButton(b, "Löschen?", () => col.remove(b.dataset.del)));
  const f = root.querySelector("#fz-own, #fz-km, #fz-note");
  if (f && open) f.focus();
  stopTimer();
  if (run) timer = setInterval(() => {
    const el = root.querySelector('[data-fz="clock"]');
    if (!el || root.hidden) return stopTimer();
    el.textContent = F.fmtClock(F.durMs(F.running(items), Date.now()));
  }, 1000);
}

function clock(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

async function start(item) {
  if (!item || F.running(items)) return;
  open = null;
  try { await col.put(item); ctx.ui.toast(`${item.emoji} ${item.label} läuft – viel Spaß!`, 2000); }
  catch { ctx.ui.toast("Konnte nicht starten – bitte nochmal versuchen."); }
}

function onClick(e) {
  const b = e.target.closest("button");
  if (!b || !root.contains(b)) return;
  if (b.dataset.start) return start(F.startItem(b.dataset.start, Date.now()));
  const a = b.dataset.fz;
  if (a === "own") { open = "own"; draw(); }
  else if (a === "stop") { open = "stop"; draw(); }
  else if (a === "back") { open = null; draw(); }
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (form.dataset.fz === "ownform") {
    return start(F.startItem("eigen", Date.now(), { label: root.querySelector("#fz-own").value, cat: root.querySelector("#fz-owncat").value }));
  }
  if (form.dataset.fz === "stopform") {
    const r = F.running(items);
    if (!r) return;
    const km = F.parseKm(root.querySelector("#fz-km") && root.querySelector("#fz-km").value);
    const note = String(root.querySelector("#fz-note").value || "").trim().slice(0, 120);
    open = null;
    const end = Date.now();
    try {
      await col.put({ ...r, end, ...(km ? { km } : {}), ...(note ? { note } : {}) });
      ctx.ui.toast(`🎉 ${r.label}: ${F.fmtDur(end - r.start)} – stark!`, 2400);
    } catch { ctx.ui.toast("Speichern fehlgeschlagen – bitte nochmal."); }
  }
}

export function unmount() { stopTimer(); if (off) off(); off = null; col = null; }
