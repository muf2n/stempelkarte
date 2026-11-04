// Einstellungen „Berufsschule“ (Update 6): wöchentliche Schultage + Schulblöcke (Blockschule).
// Schulzeit zählt als Arbeitszeit (Tagessoll gilt als erfüllt). Wird im Einstellungs-Panel (#school-panel) eingehängt.
import { icon } from "../icons.js";

const WD = [[1, "Mo"], [2, "Di"], [3, "Mi"], [4, "Do"], [5, "Fr"]];
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

let ctx = null;
let root = null;
let snap = null;
let lastKey = "";

const $ = (sel) => root.querySelector(sel);

function readSchool(settings) {
  const sc = settings && settings.school;
  const days = sc && Array.isArray(sc.days) ? sc.days.map(Number).filter((d) => d >= 0 && d <= 6) : [];
  const blocks = sc && Array.isArray(sc.blocks)
    ? sc.blocks.filter((b) => b && b.id && RE_DATE.test(String(b.from || "")) && RE_DATE.test(String(b.to || ""))) : [];
  return { days, blocks };
}

function fmtD(k) {
  const [y, m, d] = k.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][dt.getDay()]}, ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

async function save(next) {
  try { await ctx.store.saveSettings({ school: next }); return true; } catch { return false; }
}

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  root.classList.add("rm", "sc");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico">${icon("building", 20)}</span>
      <div><div class="rm-title">Berufsschule</div>
      <p class="note">Schulzeit zählt als Arbeitszeit: An Schultagen gilt dein Tagessoll als erfüllt. Geplante Schichten und Einstempel-Erinnerungen entfallen.</p></div>
    </div>
    <div class="rm-opt">
      <div class="lbl">Jede Woche Schule am</div>
      <div class="chips sc-wd" role="group" aria-label="Wöchentliche Schultage">
        ${WD.map(([d, n]) => `<button type="button" class="chip" data-d="${d}" aria-pressed="false">${n}</button>`).join("")}
      </div>
    </div>
    <div class="rm-opt">
      <div class="lbl">Blockschule</div>
      <div class="sc-list" id="sc-list"></div>
      <div class="sc-add">
        <div class="row">
          <label>von<input type="date" id="sc-from"></label>
          <label>bis<input type="date" id="sc-to"></label>
        </div>
        <label>Bezeichnung<input type="text" id="sc-label" value="Blockschule" maxlength="40" placeholder="z. B. Blockschule 2. Klasse"></label>
        <button type="button" class="btn primary sm" id="sc-addbtn">${icon("plus", 18)}<span>Schulblock hinzufügen</span></button>
        <p class="note">Im Block zählen nur deine Arbeitstage (meist Mo – Fr), Feiertage bleiben Feiertage.</p>
      </div>
    </div>`;

  $(".sc-wd").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-d]");
    if (!b) return;
    const d = Number(b.dataset.d);
    const cur = readSchool(snap && snap.settings);
    const days = cur.days.includes(d) ? cur.days.filter((x) => x !== d) : [...cur.days, d].sort((a, z) => a - z);
    b.setAttribute("aria-pressed", String(days.includes(d)));
    if (await save({ days, blocks: cur.blocks })) {
      ctx.ui.toast(days.length ? `Berufsschule: ${WD.filter(([x]) => days.includes(x)).map(([, n]) => n).join(", ")}` : "Keine wöchentlichen Schultage mehr.");
    }
  });

  $("#sc-from").addEventListener("change", () => {
    const f = $("#sc-from").value, t = $("#sc-to");
    if (RE_DATE.test(f) && (!t.value || t.value < f)) t.value = f;
  });

  $("#sc-addbtn").addEventListener("click", async () => {
    const from = $("#sc-from").value, to = $("#sc-to").value || $("#sc-from").value;
    const label = $("#sc-label").value.trim() || "Blockschule";
    if (!RE_DATE.test(from)) { ctx.ui.toast("Bitte ein Startdatum wählen."); return; }
    if (!RE_DATE.test(to) || to < from) { ctx.ui.toast("„bis“ liegt vor „von“."); return; }
    const cur = readSchool(snap && snap.settings);
    const block = { id: ctx.util.newId("sb"), from, to, label };
    const blocks = [...cur.blocks, block].sort((a, b) => (a.from < b.from ? -1 : 1));
    const btn = $("#sc-addbtn");
    ctx.ui.setBusy(btn, true, "Speichert …");
    const ok = await save({ days: cur.days, blocks });
    ctx.ui.setBusy(btn, false);
    if (ok) {
      $("#sc-from").value = ""; $("#sc-to").value = ""; $("#sc-label").value = "Blockschule";
      ctx.ui.toast(`${label}: ${fmtD(from)} – ${fmtD(to)} gespeichert`);
    }
  });

  $("#sc-list").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-del]");
    if (!b) return;
    if (!b.dataset.armed) {
      b.dataset.armed = "1";
      b.textContent = "Löschen?";
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "✕"; } }, 4000);
      return;
    }
    const cur = readSchool(snap && snap.settings);
    if (await save({ days: cur.days, blocks: cur.blocks.filter((x) => x.id !== b.dataset.del) })) ctx.ui.toast("Schulblock gelöscht.");
  });

  try { snap = ctx.store.get(); } catch { snap = null; }
  if (snap) update(snap);
}

export function update(s) {
  snap = s;
  if (!root || !snap || !root.querySelector(".sc-wd")) return;
  const cur = readSchool(snap.settings);
  root.querySelectorAll(".sc-wd [data-d]").forEach((b) => b.setAttribute("aria-pressed", String(cur.days.includes(Number(b.dataset.d)))));
  const key = JSON.stringify(cur.blocks);
  if (key === lastKey) return;
  lastKey = key;
  const esc = ctx.util.esc;
  const today = ctx.util.dayKey(Date.now());
  $("#sc-list").innerHTML = cur.blocks.length
    ? cur.blocks.map((b) => `<div class="sc-item${b.to < today ? " past" : ""}">
        <span class="sc-txt"><b>${esc(b.label || "Blockschule")}</b><span>${esc(fmtD(b.from))}${b.to !== b.from ? ` – ${esc(fmtD(b.to))}` : ""}</span></span>
        <button type="button" class="plan-del sc-del" data-del="${esc(b.id)}" aria-label="Schulblock löschen">✕</button>
      </div>`).join("")
    : `<p class="note sc-empty">Noch kein Schulblock eingetragen.</p>`;
}
