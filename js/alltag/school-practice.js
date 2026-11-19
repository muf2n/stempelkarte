// Schule → Lernen → 📝 Üben mit Claude: Aufgaben aus Foto/Thema, selbst lösen, sofort prüfen, Rechenweg sehen, Falsche wiederholen.
// Daten: Sammlung school_practice ({ id, title, subject, tasks, stats, created }). Logik: school-practice-core.js.
import { col, safeWrite, esc, subjectInputHTML, wireSubjectChips, armDelete } from "./school-core.js";
import { newId } from "./db.js";
import { askClaude, aiAvailable } from "./ai-client.js";
import { shrinkImage } from "./unterwegs-shared.js";
import * as P from "./school-practice-core.js";

export function practiceCardHTML(S) {
  const sets = (S.data.practice || []).slice().sort((a, b) => ((b.stats && b.stats.at) || b.created || 0) - ((a.stats && a.stats.at) || a.created || 0));
  return `<section class="card ss-card pr-card"><h3 class="ss-h">📝 Üben mit Claude <span class="ss-count">${sets.length}</span></h3>
    <p class="note">Foto vom Heft, Buch oder Arbeitsblatt – Claude macht ähnliche Aufgaben mit neuen Zahlen. Du rechnest, die App prüft sofort und zeigt den Rechenweg.</p>
    <div class="pr-secs" role="list">${P.SECTIONS.map((x) => `<button type="button" role="listitem" class="pr-sec" data-pr-sec="${x.id}"><span aria-hidden="true">${x.e}</span><b>${esc(x.name)}</b><small>${esc(x.long)}</small></button>`).join("")}</div>
    <div class="row pr-actions"><button type="button" class="btn primary sm" data-pr="new-photo">📷 Aus Foto</button><button type="button" class="btn sm" data-pr="new-topic">✏️ Eigenes Thema</button></div>
    ${P.groupSets(sets).map((g) => `<div class="pr-group"><div class="lbl ss-sub">${g.e} ${esc(g.name)}</div><ul class="ss-list pr-list">${g.sets.slice(0, 10).map((s) => `<li><button type="button" class="pr-set" data-pr-set="${esc(s.id)}">
        <span class="pr-tx"><b>${esc(s.title)}</b><small>${s.tasks.length} Aufgaben${s.stats ? ` · zuletzt ${s.stats.last} % · best ${s.stats.best} %` : " · neu"}</small></span>
        <span class="pr-go" aria-hidden="true">▶</span></button></li>`).join("")}</ul></div>`).join("")}
  </section>`;
}
export function wirePractice(root, S) {
  root.querySelectorAll("[data-pr]").forEach((b) => b.addEventListener("click", () => newSheet(S, b.dataset.pr === "new-photo")));
  root.querySelectorAll("[data-pr-sec]").forEach((b) => b.addEventListener("click", () => sectionSheet(S, P.SECTIONS.find((x) => x.id === b.dataset.prSec))));
  root.querySelectorAll("[data-pr-set]").forEach((b) => b.addEventListener("click", () => { const s = (S.data.practice || []).find((x) => x.id === b.dataset.prSet); if (s) runSet(S, s); }));
}

function pickPhoto() {
  return new Promise((res) => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.addEventListener("change", () => res((inp.files && inp.files[0]) || null), { once: true }); inp.click(); });
}

/** Aufgaben erstellen lassen → gespeichertes Set */
async function createSet({ topic, subject, photo }) {
  const sec = P.sectionOf(subject);
  const msg = `${subject ? `Fach: ${sec ? `${sec.long} (${sec.name})` : subject}\n` : ""}${topic ? `Thema: ${topic}\n` : ""}Bitte Übungsaufgaben${photo ? " zum Stoff auf dem Foto" : ""}.`;
  const out = await askClaude([{ role: "user", content: msg }], { body: { mode: "uebung", ...(photo ? { image: { type: "image/jpeg", data: photo.data.replace(/^data:[^,]*,/, "") } } : {}) }, timeoutMs: 150000 });
  const set = P.parseSet(out.reply);
  if (!set) throw new Error("Claude hat keine brauchbaren Aufgaben geliefert – bitte nochmal.");
  const doc = { id: newId(), title: topic && topic.length < 60 ? topic : set.title, subject, tasks: set.tasks, created: Date.now() };
  safeWrite(col("practice").put(doc)); return doc;
}
/** Abschnitt (z. B. AWL): Themen antippen → sofort Aufgaben */
function sectionSheet(S, sec) {
  const ui = S.ctx.ui; if (!sec) return;
  if (!aiAvailable()) { ui.toast("📝 Geht mit der Google-Anmeldung und dem Claude-Server.", 3600); return; }
  const mine = (S.data.practice || []).filter((x) => P.sectionOf(x.subject) === sec);
  ui.openSheet({ title: `${sec.e} ${sec.name} – ${sec.long}`, bodyHTML: `<div class="pr-topics">
      <p class="note">Thema antippen – Claude macht 6–8 neue Aufgaben dazu.</p>
      ${sec.topics.map((t) => { const done = mine.filter((x) => x.title === t); const best = done.reduce((a, x) => Math.max(a, (x.stats && x.stats.best) || 0), 0);
        return `<button type="button" class="pr-topic" data-t="${esc(t)}"><span>${esc(t)}</span>${done.length ? `<small class="${best >= 90 ? "ok" : ""}">${best >= 90 ? "✓ " : ""}best ${best} %</small>` : ""}</button>`; }).join("")}
      <button type="button" class="pr-topic own" data-own="1"><span>✏️ Anderes ${esc(sec.name)}-Thema …</span></button></div>`,
    onMount(el, close) {
      el.addEventListener("click", async (e) => {
        const b = e.target.closest(".pr-topic"); if (!b || el.dataset.busy) return;
        if (b.dataset.own) { close(); newSheet(S, false, sec.name); return; }
        el.dataset.busy = "1"; b.classList.add("busy"); b.querySelector("span").textContent = `⏳ ${b.dataset.t} – Claude schreibt Aufgaben …`;
        try { const doc = await createSet({ topic: b.dataset.t, subject: sec.name }); close(); runSet(S, doc); }
        catch (err) { ui.toast(err.message || "Hat nicht geklappt.", 3600); delete el.dataset.busy; b.classList.remove("busy"); b.querySelector("span").textContent = b.dataset.t; }
      });
    } });
}

async function newSheet(S, withPhoto, presetSubject = "") {
  const ui = S.ctx.ui;
  if (!aiAvailable()) { ui.toast("📝 Geht mit der Google-Anmeldung und dem Claude-Server.", 3600); return; }
  let photo = null;
  if (withPhoto) { const f = await pickPhoto(); if (!f) return; try { photo = await shrinkImage(f, { maxSide: 1800, maxBytes: 900 * 1024, quality: 0.85 }); } catch (e) { ui.toast(e.message || "Foto geht nicht."); return; } }
  ui.openSheet({ title: "📝 Neue Übung", bodyHTML: `<form class="form" id="pr-f">
      ${photo ? `<img class="pr-thumb" src="${photo.data}" alt="Dein Foto">` : ""}
      <label>${photo ? "Worum geht's? (optional)" : "Thema"}<input id="pr-t" maxlength="200" ${photo ? "" : "required"} placeholder="z. B. Aliquote Sonderzahlungen" autocomplete="off"></label>
      ${subjectInputHTML(S.data, "pr-s")}
      <p class="note">Claude erstellt 6–8 Aufgaben. Die Ergebnisse werden zur Sicherheit nachgerechnet – trotzdem: Wenn dir etwas komisch vorkommt, frag deine Lehrkraft.</p>
      <div class="row"><button class="btn primary" type="submit" id="pr-go">Aufgaben erstellen</button></div></form>`,
    onMount(el, close) {
      wireSubjectChips(el);
      if (presetSubject) el.querySelector("#pr-s").value = presetSubject;
      el.querySelector("#pr-f").addEventListener("submit", async (e) => {
        e.preventDefault();
        const topic = el.querySelector("#pr-t").value.trim(), subject = el.querySelector("#pr-s").value.trim(), go = el.querySelector("#pr-go");
        if (!topic && !photo) return;
        go.disabled = true; go.textContent = "Claude schreibt Aufgaben … (ca. 20–40 s)";
        try { const doc = await createSet({ topic, subject, photo }); close(); runSet(S, doc); } catch (err) { ui.toast(err.message || "Hat nicht geklappt.", 3600); go.disabled = false; go.textContent = "Aufgaben erstellen"; }
      });
    } });
}

/** Eine Runde: Aufgaben der Reihe nach; am Ende Ergebnis, Falsche wiederholen. */
function runSet(S, set, only = null) {
  const ui = S.ctx.ui, list = only || set.tasks.map((_, i) => i);
  let pos = 0, right = 0, wrong = [], answered = false, hintShown = false;
  ui.openSheet({ title: `📝 ${set.title}`, bodyHTML: `<div class="pr-run" data-run></div>`,
    onMount(el, close) {
      const box = el.querySelector("[data-run]");
      const draw = () => {
        if (pos >= list.length) return drawEnd();
        const t = set.tasks[list[pos]];
        box.innerHTML = `<div class="pr-prog"><span>Aufgabe ${pos + 1}/${list.length}</span><span>✅ ${right}</span></div>
          <div class="pr-bar"><i style="width:${(pos / list.length) * 100}%"></i></div>
          <p class="pr-q">${esc(t.q)}</p>
          ${t.kind === "choice" ? `<div class="pr-choices">${t.choices.map((c, i) => `<button type="button" class="pr-ch" data-ch="${i}">${esc(c)}</button>`).join("")}</div>`
            : `<form class="pr-ans" id="pr-a"><input id="pr-in" inputmode="decimal" autocomplete="off" placeholder="Ergebnis" aria-label="Dein Ergebnis"><span class="pr-unit">${esc(t.unit || "")}</span><button class="btn primary" type="submit">Prüfen</button></form>`}
          <div class="pr-fb" aria-live="polite"></div>
          <div class="row pr-nav">${t.hint ? `<button type="button" class="btn sm" data-x="hint">💡 Tipp</button>` : ""}<button type="button" class="btn sm" data-x="skip">Lösung zeigen</button></div>`;
        answered = false; hintShown = false; box.classList.remove("done");
        const inp = box.querySelector("#pr-in"); if (inp) setTimeout(() => inp.focus(), 60);
      };
      const solution = (t) => `${t.kind === "choice" ? `<p><b>Richtig:</b> ${esc(t.choices[t.answer])}</p>` : `<p><b>Ergebnis:</b> ${esc(P.fmtNum(t.answer, t.dec))} ${esc(t.unit || "")}</p>`}
        ${t.steps.length ? `<ol class="pr-steps">${t.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
        ${t.calc ? `<p class="note">Rechnung: <code>${esc(t.calc)}</code></p>` : ""}`;
      const judge = (ok, t) => {
        if (answered) return; answered = true; box.classList.add("done");
        if (ok) right++; else wrong.push(list[pos]);
        const fb = box.querySelector(".pr-fb");
        fb.className = `pr-fb ${ok ? "ok" : "bad"}`;
        fb.innerHTML = `<p class="pr-verdict">${ok ? ["✅ Richtig!", "✅ Super!", "✅ Passt!"][pos % 3] : "❌ Leider nicht."}</p>${solution(t)}
          <button type="button" class="btn primary" data-x="next">${pos + 1 < list.length ? "Weiter ›" : "Fertig"}</button>`;
        box.querySelectorAll(".pr-ch, #pr-a button, #pr-in, [data-x=skip], [data-x=hint]").forEach((x) => { x.disabled = true; });
        if (t.kind === "choice") box.querySelectorAll(".pr-ch").forEach((x) => x.classList.toggle("right", Number(x.dataset.ch) === t.answer));
        setTimeout(() => { const n = box.querySelector("[data-x=next]"); if (n) n.focus(); }, 60);
      };
      const drawEnd = () => {
        const pct = list.length ? Math.round((right / list.length) * 100) : 0;
        if (!only) { const upd = P.addResult(set, right, list.length); set.stats = upd.stats; safeWrite(col("practice").put({ ...set })); }
        box.innerHTML = `<div class="pr-end"><div class="pr-score">${pct >= 90 ? "🏆" : pct >= 60 ? "👍" : "💪"}<b>${right}/${list.length}</b><small>${pct} % richtig</small></div>
          <p>${pct >= 90 ? "Sitzt! Morgen nochmal kurz wiederholen, dann bleibt's hängen." : pct >= 60 ? "Gut! Die falschen nochmal üben." : "Dranbleiben – schau dir die Rechenwege an und probier's nochmal."}</p>
          <div class="row">${wrong.length ? `<button type="button" class="btn primary" data-x="again-wrong">🔁 Falsche nochmal (${wrong.length})</button>` : ""}
          <button type="button" class="btn" data-x="again">Alle nochmal</button></div>
          <div class="row"><button type="button" class="btn sm danger" data-x="del">🗑 Übung löschen</button></div></div>`;
        const del = box.querySelector("[data-x=del]");
        armDelete(del, () => { safeWrite(col("practice").remove(set.id)); close(); ui.toast("🗑 Übung gelöscht"); });
      };
      box.addEventListener("submit", (e) => { e.preventDefault(); const t = set.tasks[list[pos]], v = box.querySelector("#pr-in").value; if (!v.trim()) return; judge(P.isRight(t, v), t); });
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-ch],[data-x]"); if (!b || b.disabled) return;
        const t = set.tasks[list[pos]];
        if (b.dataset.ch != null) return judge(P.isRight(t, Number(b.dataset.ch)), t);
        const x = b.dataset.x;
        if (x === "hint" && !hintShown) { hintShown = true; b.closest(".pr-nav").insertAdjacentHTML("beforebegin", `<p class="pr-hint">💡 ${esc(t.hint)}</p>`); b.remove(); }
        else if (x === "skip") judge(false, t);
        else if (x === "next") { pos++; draw(); }
        else if (x === "again-wrong") { close(); runSet(S, set, wrong.slice()); }
        else if (x === "again") { close(); runSet(S, set); }
      });
      draw();
    } });
}
