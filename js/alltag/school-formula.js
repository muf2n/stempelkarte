// Schule → Lernen → 🎲 Formel-Trainer: zufällige Werte und zufälliges Umformen, offline. Logik: formula-core.js.
import { esc } from "./school-core.js";
import * as F from "./formula-core.js";
import { photoBtnHTML, photoCheck } from "./school-photocheck.js";

const KEY = "sk-formel-trainer";
const DEF = { ids: ["ohm", "pui", "pi2r", "pu2r", "reihe", "parallel", "prozent", "rabatt"], mode: "mix", pre: true, n: 10 };
function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && Array.isArray(v.ids) ? { ...DEF, ...v } : { ...DEF }; } catch { return { ...DEF }; } }
function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* egal */ } }

export function formulaCardHTML() {
  const st = load(), groups = F.GROUPS.filter((g) => F.FORMULAS.some((x) => x.g === g && st.ids.includes(x.id)));
  return `<section class="card ss-card ft-card"><h3 class="ss-h">🎲 Formel-Trainer</h3>
    <p class="note">Zufällige Zahlen und zufälliges Umstellen – du wählst, welche Formeln kommen. Geht auch offline.</p>
    <p class="ft-sum">${st.ids.length} Formeln · ${groups.map(esc).join(", ") || "keine"} · ${st.mode === "rechnen" ? "nur Rechnen" : st.mode === "umformen" ? "nur Umformen" : "Rechnen + Umformen"}${st.best ? ` · 🔥 Rekord ${st.best}` : ""}</p>
    <div class="row ft-actions"><button type="button" class="btn primary sm" data-ft="start">▶ Los geht's</button><button type="button" class="btn sm" data-ft="setup">⚙️ Formeln wählen</button></div></section>`;
}
export function wireFormula(root, S) {
  root.querySelectorAll("[data-ft]").forEach((b) => b.addEventListener("click", () => (b.dataset.ft === "start" ? run(S) : setup(S))));
}

function setup(S) {
  const ui = S.ctx.ui, st = load();
  ui.openSheet({ title: "⚙️ Formel-Trainer einstellen", bodyHTML: `<form class="form ft-set" id="ft-f">
      <div class="lbl">Was üben?</div>
      <div class="seg ft-seg" role="radiogroup">${[["mix", "Beides"], ["rechnen", "Rechnen"], ["umformen", "Umformen"]].map(([v, t]) => `<label><input type="radio" name="mode" value="${v}"${st.mode === v ? " checked" : ""}><span>${t}</span></label>`).join("")}</div>
      <div class="lbl">Aufgaben pro Runde</div>
      <div class="seg ft-seg" role="radiogroup">${[[10, "10"], [20, "20"], [0, "Endlos"]].map(([v, t]) => `<label><input type="radio" name="n" value="${v}"${st.n === v ? " checked" : ""}><span>${t}</span></label>`).join("")}</div>
      <label class="ft-check"><input type="checkbox" id="ft-pre"${st.pre ? " checked" : ""}> Mit Vorsätzen (mA, kΩ, µF …) – wie in der Schularbeit</label>
      <div class="row"><button type="button" class="btn sm" data-all="1">Alle</button><button type="button" class="btn sm" data-all="0">Keine</button></div>
      ${F.GROUPS.map((g) => `<fieldset class="ft-grp"><legend><label><input type="checkbox" data-g="${esc(g)}"> <b>${esc(g)}</b></label></legend>
        ${F.FORMULAS.filter((x) => x.g === g).map((x) => `<label class="ft-check"><input type="checkbox" name="id" value="${x.id}"${st.ids.includes(x.id) ? " checked" : ""}> ${esc(x.name)}</label>`).join("")}</fieldset>`).join("")}
      <div class="row ft-sticky"><button class="btn primary" type="submit">Speichern & los</button></div></form>`,
    onMount(el, close) {
      const f = el.querySelector("#ft-f");
      const sync = () => el.querySelectorAll("[data-g]").forEach((g) => { const bs = [...g.closest("fieldset").querySelectorAll("input[name=id]")]; g.checked = bs.every((b) => b.checked); g.indeterminate = !g.checked && bs.some((b) => b.checked); });
      sync();
      f.addEventListener("change", (e) => { if (e.target.dataset.g != null) e.target.closest("fieldset").querySelectorAll("input[name=id]").forEach((b) => { b.checked = e.target.checked; }); sync(); });
      el.querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", () => { f.querySelectorAll("input[name=id]").forEach((x) => { x.checked = b.dataset.all === "1"; }); sync(); }));
      f.addEventListener("submit", (e) => {
        e.preventDefault();
        const ids = [...f.querySelectorAll("input[name=id]:checked")].map((x) => x.value);
        if (!ids.length) { ui.toast("Wähl mindestens eine Formel."); return; }
        const v = { ...load(), ids, mode: f.querySelector("input[name=mode]:checked").value, n: Number(f.querySelector("input[name=n]:checked").value), pre: el.querySelector("#ft-pre").checked };
        save(v); close(); S.rerender && S.rerender(); run(S);
      });
    } });
}

function run(S) {
  const ui = S.ctx.ui, st = load();
  if (!st.ids.length) { setup(S); return; }
  let i = 0, right = 0, streak = 0, best = st.best || 0, task = null, done = false;
  ui.openSheet({ title: "🎲 Formel-Trainer", bodyHTML: `<div class="pr-run ft-run" data-ft-run></div>`,
    onMount(el, close) {
      const box = el.querySelector("[data-ft-run]");
      const next = () => {
        if (st.n && i >= st.n) return end();
        task = F.makeTask(st); done = false; box.classList.remove("done");
        if (!task) { box.innerHTML = `<p>Mit dieser Auswahl gehen keine Aufgaben – bitte andere Formeln wählen.</p>`; return; }
        box.innerHTML = `<div class="pr-prog"><span>${st.n ? `Aufgabe ${i + 1}/${st.n}` : `Aufgabe ${i + 1}`}</span><span>✅ ${right} · 🔥 ${streak}</span></div>
          ${st.n ? `<div class="pr-bar"><i style="width:${(i / st.n) * 100}%"></i></div>` : ""}
          <span class="ft-tag">${task.kind === "form" ? "🔀 Umformen" : "🧮 Rechnen"}</span>
          <p class="pr-q">${esc(task.q)}</p>
          ${task.kind === "form" ? `<div class="pr-choices">${task.choices.map((c, k) => `<button type="button" class="pr-ch ft-f" data-ch="${k}">${esc(c)}</button>`).join("")}</div>`
            : `<ul class="ft-given">${task.given.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
               <form class="pr-ans" id="ft-a"><input id="ft-in" inputmode="decimal" autocomplete="off" placeholder="Ergebnis" aria-label="Ergebnis in ${esc(task.unit || "ohne Einheit")}"><span class="pr-unit">${esc(task.unit)}</span><button class="btn primary" type="submit">Prüfen</button></form>`}
          <div class="pc-box" aria-live="polite"></div>
          <div class="pr-fb" aria-live="polite"></div>
          <div class="row pr-nav">${task.kind === "calc" ? photoBtnHTML() : ""}<button type="button" class="btn sm" data-x="skip">Lösung zeigen</button></div>
          ${task.kind === "calc" ? `<p class="note pc-tip">✍️ Auf Papier rechnen, dann Ergebnis eintippen – oder den Rechenweg fotografieren, Claude schaut drüber.</p>` : ""}`;
        const inp = box.querySelector("#ft-in"); if (inp) setTimeout(() => inp.focus(), 60);
      };
      const judge = (ok) => {
        if (done) return; done = true; box.classList.add("done");
        if (ok) { right++; streak++; if (streak > best) { best = streak; save({ ...load(), best }); } } else streak = 0;
        const fb = box.querySelector(".pr-fb"); fb.className = `pr-fb ${ok ? "ok" : "bad"}`;
        const sol = task.kind === "form" ? `<p><b>Richtig:</b> ${esc(task.choices[task.answer])}</p>`
          : `<ol class="pr-steps">${task.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
        fb.innerHTML = `<p class="pr-verdict">${ok ? (streak >= 5 ? `🔥 ${streak} in Folge!` : "✅ Richtig!") : "❌ Leider nicht."}</p>${sol}<button type="button" class="btn primary" data-x="next">${st.n && i + 1 >= st.n ? "Fertig" : "Nächste ›"}</button>`;
        box.querySelectorAll(".pr-ch, #ft-a button, #ft-in").forEach((x) => { x.disabled = true; });
        if (task.kind === "form") box.querySelectorAll(".pr-ch").forEach((x) => x.classList.toggle("right", Number(x.dataset.ch) === task.answer));
        setTimeout(() => { const n = box.querySelector("[data-x=next]"); if (n) n.focus(); }, 60);
      };
      const end = () => {
        const pct = i ? Math.round((right / i) * 100) : 0;
        box.innerHTML = `<div class="pr-end"><div class="pr-score">${pct >= 90 ? "🏆" : pct >= 60 ? "👍" : "💪"}<b>${right}/${i}</b><small>${pct} % · 🔥 Rekord ${best}</small></div>
          <div class="row"><button type="button" class="btn primary" data-x="again">🎲 Neue Runde</button><button type="button" class="btn" data-x="setup">⚙️ Formeln wählen</button></div></div>`;
      };
      box.addEventListener("submit", (e) => { e.preventDefault(); const v = box.querySelector("#ft-in").value; if (v.trim()) judge(F.check(task, v)); });
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-ch],[data-x]"); if (!b || b.disabled) return;
        if (b.dataset.ch != null) return judge(F.check(task, Number(b.dataset.ch)));
        const x = b.dataset.x;
        if (x === "photo") {
          const t = task, pc = box.querySelector(".pc-box"); b.disabled = true;
          photoCheck(ui, { text: `${t.q} Gegeben: ${t.given.join(", ")}`, unit: t.unit, solution: t.steps.join("\n"), check: (raw, unit) => F.checkUnit(t, raw, unit) }, pc).then((r) => {
            if (task !== t || done) return;
            b.disabled = false; if (!r) return;
            pc.innerHTML = ""; judge(r.ok); box.querySelector(".pr-fb .pr-verdict").insertAdjacentHTML("afterend", r.html);
          });
          return;
        }
        if (x === "skip") judge(false);
        else if (x === "next") { i++; next(); }
        else if (x === "again") { i = 0; right = 0; streak = 0; next(); }
        else if (x === "setup") { close(); setup(S); }
      });
      next();
    } });
}
