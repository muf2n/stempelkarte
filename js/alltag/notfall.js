// Update 10 – Alltag › 🆘 Notfallkarte (#alltag/notfall): Blutgruppe, Allergien, Medikamente, Vorerkrankungen,
// Notfallkontakte (mit tel:-Link) und Krankenkasse als klare Karte. Datenschutz: Der Assistent liest die Karte nur,
// wenn „Claude darf die Notfallkarte lesen“ an ist (Standard: aus). Reine Logik: ./notfall-core.js
// Sammlung „notfall“, Dokument "card".
// Sperrbildschirm: Die App kann (noch) keinen eigenen Text auf den Sperrbildschirm legen (js/lockscreen.js steuert nur
// die Stempel-Benachrichtigung) – deshalb verweisen wir auf die Notfallinfos des Handys.
import { collection } from "./db.js";
import * as F from "./notfall-core.js";
import * as ui from "../ui.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";

function injectCSS() {
  if (document.getElementById("nf-css")) return;
  const l = document.createElement("link");
  l.id = "nf-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-notfall.css", import.meta.url).href;
  document.head.appendChild(l);
}
const safe = (p, ok) => Promise.resolve(p).then(() => { if (ok) ui.toast(ok); return true; })
  .catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); return false; });
const multi = (t) => esc(t).replace(/\n/g, "<br>");

export function mount(el) {
  injectCSS();
  const col = collection("notfall");
  let alive = true, queued = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };
  const card = () => F.normCard(col.get(F.CARD_ID) || {});

  function row(label, val, cls = "") { return val ? `<div class="nf-r ${cls}"><dt>${label}</dt><dd>${multi(val)}</dd></div>` : ""; }

  function render() {
    const c = card();
    if (!col.loaded) { el.innerHTML = `<p class="note">Lade …</p>`; return; }
    const empty = F.isEmpty(c);
    el.innerHTML = `<div class="nf">` +
      (empty ? `<div class="empty nf-empty"><div class="nf-empty-emo">🆘</div><h3>Deine Notfallkarte</h3>` +
          `<p>Trag ein, was Helfer im Ernstfall wissen sollten: Blutgruppe, Allergien, Medikamente und wen man anrufen soll. Hoffentlich brauchst du sie nie! 🍀</p>` +
          `<button type="button" class="btn primary" data-nf="edit">✍️ Jetzt ausfüllen</button></div>`
        : `<article class="nf-card" aria-label="Notfallkarte">` +
          `<header class="nf-head"><span aria-hidden="true">🆘</span><div><h3>Notfallkarte</h3><small>Medizinische Infos &amp; Kontakte</small></div>` +
            (c.blood ? `<div class="nf-blood" aria-label="Blutgruppe ${esc(c.blood)}"><small>Blutgruppe</small><b>${esc(c.blood)}</b></div>` : "") + `</header>` +
          `<dl class="nf-dl">` +
            row("⚠️ Allergien", c.allergies, "nf-warn") + row("💊 Medikamente", c.meds) + row("🩺 Vorerkrankungen", c.conditions) +
            (c.insurance.name || c.insurance.number ? row("🏥 Krankenkasse", [c.insurance.name, c.insurance.number && `Nr. ${c.insurance.number}`].filter(Boolean).join(" · ")) : "") +
            row("📝 Hinweise", c.notes) +
          `</dl>` +
          (c.contacts.length ? `<div class="nf-contacts"><h4>📞 Notfallkontakte</h4><ul>${c.contacts.map((k) => {
            const href = F.telHref(k.phone);
            return `<li><span class="nf-k"><b>${esc(k.name || "Kontakt")}</b>${k.rel ? `<small>${esc(k.rel)}</small>` : ""}${k.phone ? `<small class="nf-ph">${esc(k.phone)}</small>` : ""}</span>` +
              (href ? `<a class="btn go sm nf-call" href="${esc(href)}" aria-label="${esc(k.name || "Kontakt")} anrufen">${icon("phone", 16)}<span>Anrufen</span></a>` : "") + `</li>`;
          }).join("")}</ul></div>` : "") +
          `<footer class="nf-foot"><span>🇦🇹 Notruf 144 · Euro-Notruf 112</span></footer>` +
        `</article>` +
        `<div class="nf-actions"><button type="button" class="btn primary sm" data-nf="edit">${icon("pencil", 16)}<span>Bearbeiten</span></button>` +
          `<button type="button" class="btn ghost sm" data-nf="copy">${icon("copy", 16)}<span>Als Text kopieren</span></button></div>`) +
      `<section class="nf-priv card">` +
        `<label class="switch"><span>🤖 Claude darf die Notfallkarte lesen</span><input type="checkbox" data-nf="ai"${c.claudeAllowed ? " checked" : ""}></label>` +
        `<p class="note">${c.claudeAllowed ? "An: Der Assistent kann die Karte lesen, wenn du ihn danach fragst (nur lesen, nie ändern)." : "Aus (Standard): Der Assistent sieht deine Gesundheitsdaten nicht."}</p>` +
      `</section>` +
      `<section class="nf-tip card"><b>🔒 Auf dem Sperrbildschirm?</b><p class="note">Das kann die App leider (noch) nicht selbst. Tipp: Am Handy unter <b>Einstellungen › Sicherheit &amp; Notfall</b> (bzw. „Notfallinformationen“, am iPhone „Notfallpass“ in der Health-App) eintragen – das sehen Helfer auch ohne Entsperren.</p></section>` +
    `</div>`;
  }

  function openForm() {
    const cur = col.get(F.CARD_ID);
    const c = F.normCard(cur || {});
    const kRows = [...c.contacts];
    while (kRows.length < 2) kRows.push({ name: "", rel: "", phone: "" });
    const kHTML = (k, i) => `<fieldset class="nf-kf" data-k="${i}"><legend>Kontakt ${i + 1}</legend>` +
      `<div class="row"><label>Name<input data-kn maxlength="60" value="${esc(k.name)}" placeholder="z. B. Mama"></label>` +
      `<label>Beziehung<input data-kr maxlength="40" value="${esc(k.rel)}" placeholder="z. B. Mutter"></label></div>` +
      `<label>Telefon<input data-kp type="tel" inputmode="tel" maxlength="30" value="${esc(k.phone)}" placeholder="+43 …"></label></fieldset>`;
    ui.openSheet({
      title: "🆘 Notfallkarte",
      bodyHTML: `<div class="fields nf-form">` +
        `<label>Blutgruppe<select id="nf-blood">${F.BLOOD.map((b) => `<option value="${esc(b)}"${b === c.blood ? " selected" : ""}>${b ? esc(b) : "– nicht angegeben –"}</option>`).join("")}</select></label>` +
        `<label>Allergien<textarea id="nf-all" rows="2" maxlength="600" placeholder="z. B. Penicillin, Nüsse, Bienenstich">${esc(c.allergies)}</textarea></label>` +
        `<label>Medikamente<textarea id="nf-med" rows="2" maxlength="800" placeholder="Name, Dosis">${esc(c.meds)}</textarea></label>` +
        `<label>Vorerkrankungen<textarea id="nf-cond" rows="2" maxlength="800" placeholder="z. B. Asthma, Diabetes">${esc(c.conditions)}</textarea></label>` +
        `<div class="row"><label>Krankenkasse<input id="nf-ins" maxlength="60" placeholder="z. B. ÖGK" value="${esc(c.insurance.name)}"></label>` +
        `<label>Versicherungsnummer<input id="nf-insn" maxlength="40" inputmode="numeric" value="${esc(c.insurance.number)}"></label></div>` +
        `<div class="lbl">📞 Notfallkontakte</div><div class="nf-ks">${kRows.map(kHTML).join("")}</div>` +
        `<button type="button" class="btn ghost sm" data-addk>＋ Weiterer Kontakt</button>` +
        `<label>Weitere Hinweise<textarea id="nf-notes" rows="2" maxlength="800" placeholder="z. B. Organspender, Brillenträger">${esc(c.notes)}</textarea></label>` +
      `</div><div class="row"><button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        const ks = $(".nf-ks");
        const addK = $("[data-addk]");
        const syncAdd = () => { addK.hidden = ks.children.length >= F.MAX_CONTACTS; };
        syncAdd();
        addK.addEventListener("click", () => { ks.insertAdjacentHTML("beforeend", kHTML({ name: "", rel: "", phone: "" }, ks.children.length)); syncAdd(); });
        $("[data-save]").addEventListener("click", () => {
          const contacts = [...ks.querySelectorAll(".nf-kf")].map((f) => ({ name: f.querySelector("[data-kn]").value, rel: f.querySelector("[data-kr]").value, phone: f.querySelector("[data-kp]").value }));
          const bad = contacts.find((k) => k.phone.trim() && !F.telDigits(k.phone));
          if (bad) { ui.toast(`Die Telefonnummer „${bad.phone.trim()}“ sieht nicht richtig aus.`); return; }
          const next = F.normCard({ ...c, blood: $("#nf-blood").value, allergies: $("#nf-all").value, meds: $("#nf-med").value, conditions: $("#nf-cond").value,
            insurance: { name: $("#nf-ins").value, number: $("#nf-insn").value }, contacts, notes: $("#nf-notes").value });
          close();
          safe(col.put({ ...(cur || {}), ...next }), "🆘 Notfallkarte gespeichert ✓");
        });
      },
    });
  }

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-nf]");
    if (!b || b.tagName === "INPUT") return;
    if (b.dataset.nf === "edit") openForm();
    else if (b.dataset.nf === "copy") {
      const txt = F.cardText(card());
      Promise.resolve().then(() => navigator.clipboard.writeText(txt)).then(() => ui.toast("📋 Kopiert – z. B. für eine Nachricht an die Familie"))
        .catch(() => ui.toast("Kopieren ging nicht – bitte manuell markieren."));
    }
  });
  el.addEventListener("change", (ev) => {
    const sw = ev.target.closest('input[data-nf="ai"]');
    if (!sw) return;
    const cur = col.get(F.CARD_ID);
    safe(col.put({ ...(cur || {}), ...F.normCard(cur || {}), claudeAllowed: sw.checked }), sw.checked ? "🤖 Claude darf die Notfallkarte jetzt lesen" : "🙈 Notfallkarte für Claude gesperrt");
  });

  const off = col.watch(queue);
  render();
  return () => { alive = false; try { off(); } catch { /* egal */ } };
}
