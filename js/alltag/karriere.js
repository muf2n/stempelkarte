// Update 12 – Alltag › 💼 Karriere (#alltag/karriere): Ausbildungsfortschritt & Ziele, Lebenslauf (mit Text-Export und
// Druckansicht), Zertifikate & Weiterbildungen (mit Ablauf-Erinnerung), Bewerbungen mit Status und Gesprächs-Vorbereitung.
// Daten: „karriere“ (Dokument "cv"), „karriere_certs“, „karriere_jobs“. Ausbildung: settings.apprentice. Logik: ./karriere-core.js
import { collection } from "./db.js";
import * as K from "./karriere-core.js";
import * as A from "./akten-ui.js";
import * as ui from "../ui.js";
import * as store from "../store.js";
import { readApprentice } from "../views/report.js";
import { esc } from "../util.js";

const TAB_KEY = "sk-karriere-tab";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const TABS = [["weg", "🎓", "Ausbildung"], ["cv", "📄", "Lebenslauf"], ["certs", "🏅", "Zertifikate"], ["jobs", "📨", "Bewerbungen"]];
function loadCss() {
  if (document.querySelector('link[data-css="karriere"]')) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.css = "karriere";
  l.href = new URL("../../css/alltag-karriere.css", import.meta.url).href; document.head.appendChild(l);
}
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function mount(el) {
  loadCss();
  const col = { cv: collection("karriere"), certs: collection("karriere_certs"), jobs: collection("karriere_jobs") };
  const S = { tab: TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "weg" };
  let alive = true, queued = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };
  const ap = () => readApprentice((store.get() || {}).settings || {});
  const cv = () => K.normCv(col.cv.get("cv") || {});
  const saveCv = (patch, ok) => A.safe(col.cv.put({ ...cv(), ...patch, id: "cv" }), ok);

  function render() {
    el.innerHTML = `<div class="kr2"><div class="kr2-tabs" role="tablist">${TABS.map(([id, e, l]) => `<button type="button" role="tab" class="kr2-tab${S.tab === id ? " on" : ""}" aria-selected="${S.tab === id}" data-tab="${id}"><span aria-hidden="true">${e}</span>${l}</button>`).join("")}</div>
      <div class="kr2-body">${S.tab === "cv" ? cvHTML() : S.tab === "certs" ? certsHTML() : S.tab === "jobs" ? jobsHTML() : wegHTML()}</div></div>`;
  }

  /* ---------- Ausbildung & Ziele ---------- */
  function wegHTML() {
    const a = ap(), p = K.apprenticeProgress(a, A.todayKey()), c = cv();
    return `${p ? `<section class="card kr2-hero"><div class="kr2-ring" style="--p:${p.pct}" aria-label="${p.pct} Prozent der Lehrzeit"><b>${p.pct}%</b></div>
        <div><h3>${esc(a.trade || "Lehre")} · ${p.year}. Lehrjahr</h3><small>${a.company ? esc(a.company) + " · " : ""}noch ${p.daysLeft} Tage bis ${K.fmtDay(p.end)}</small>
        <div class="kr2-row"><a class="chip sm" href="#alltag/lap">🎓 LAP üben</a><a class="chip sm" href="#alltag/schule">📚 Schule</a></div></div></section>`
      : `<section class="card"><p class="note">Trag in den Einstellungen unter <b>Lehrling</b> deinen Lehrbeginn ein – dann siehst du hier deinen Fortschritt.</p><button type="button" class="btn ghost sm" data-kr="settings">⚙️ Zu den Einstellungen</button></section>`}
      <section class="card"><div class="kr2-row"><h3>🎯 Berufliche Ziele</h3><span class="kr2-sp"></span><button type="button" class="chip sm" data-kr="goal">➕ Ziel</button></div>
        ${c.goals.length ? `<ul class="kr2-goals">${c.goals.map((g) => `<li class="${g.done ? "done" : ""}"><label><input type="checkbox" data-goal="${esc(g.id)}"${g.done ? " checked" : ""}><span>${esc(g.text)}</span></label>${g.due ? `<small>bis ${K.fmtMonth(g.due)}</small>` : ""}<button type="button" class="kr2-x" data-delgoal="${esc(g.id)}" aria-label="Ziel löschen">✕</button></li>`).join("")}</ul>`
          : `<p class="note">z. B. „LAP mit gutem Erfolg“, „Führerschein B“, „E-Mobilität-Kurs“, „Meisterprüfung“ – Schritt für Schritt. 🚀</p>`}</section>
      <section class="card"><h3>📈 Kompetenzen</h3>${c.skills.length ? `<ul class="kr2-skills">${c.skills.map((k) => `<li><span>${esc(k.name)}</span><span class="kr2-bar" aria-label="Stufe ${k.level} von 5"><i style="width:${k.level * 20}%"></i></span></li>`).join("")}</ul>` : `<p class="note">Trag im Lebenslauf deine Kenntnisse mit Stufe ein – hier siehst du, wie du wächst.</p>`}</section>`;
  }

  /* ---------- Lebenslauf ---------- */
  function cvHTML() {
    const c = cv(), a = ap(), st = K.apprenticeStation(a);
    const stations = K.sortCv([...(st && !c.cv.some((x) => x.id === "lehre") ? [st] : []), ...c.cv]);
    return `<section class="card"><div class="kr2-row"><h3>👤 Über mich</h3><span class="kr2-sp"></span><button type="button" class="chip sm" data-kr="about">✏️</button></div>
        <p><b>${esc(a.name || "Dein Name")}</b>${c.headline ? ` – ${esc(c.headline)}` : ""}</p>${c.about ? `<p class="kr2-pre">${esc(c.about)}</p>` : ""}
        <small class="note">${[c.city, c.email, c.phone].filter(Boolean).map(esc).join(" · ") || "Kontaktdaten fehlen noch"}</small></section>
      <section class="card"><div class="kr2-row"><h3>🗂️ Stationen</h3><span class="kr2-sp"></span><button type="button" class="chip sm" data-kr="station">➕</button></div>
        <ol class="kr2-cv">${stations.map((x) => { const k = K.CV_KINDS.find((y) => y[0] === x.kind);
          return `<li><button type="button" data-station="${esc(x.id)}"${x.id === "lehre" && !c.cv.some((y) => y.id === "lehre") ? ' data-auto="1"' : ""}><small>${k[1]} ${K.fmtMonth(x.from) || "?"} – ${x.to ? K.fmtMonth(x.to) : "heute"}</small><b>${esc(x.title)}</b>${x.org ? `<span>${esc(x.org)}</span>` : ""}</button></li>`; }).join("") || `<li class="note">Noch keine Stationen.</li>`}</ol></section>
      <section class="card"><div class="kr2-row"><h3>🧠 Kenntnisse & Sprachen</h3><span class="kr2-sp"></span><button type="button" class="chip sm" data-kr="skills">✏️</button></div>
        ${K.SKILL_CATS.map(([id, l]) => { const sk = c.skills.filter((x) => x.cat === id); return sk.length ? `<p><b>${l}:</b> ${sk.map((x) => esc(x.name) + " " + "●".repeat(x.level)).join(", ")}</p>` : ""; }).join("")}
        ${c.languages.length ? `<p><b>🗣️ Sprachen:</b> ${c.languages.map((l) => `${esc(l.name)} (${esc(l.level)})`).join(", ")}</p>` : ""}${c.hobbies ? `<p><b>🎨 Hobbys:</b> ${esc(c.hobbies)}</p>` : ""}
        ${!c.skills.length && !c.languages.length ? `<p class="note">Noch leer.</p>` : ""}</section>
      <div class="kr2-row"><button type="button" class="btn primary sm" data-kr="copycv">📋 Lebenslauf als Text kopieren</button><button type="button" class="btn ghost sm" data-kr="printcv">🖨️ Drucken / PDF</button></div>`;
  }

  /* ---------- Zertifikate ---------- */
  function certsHTML() {
    const today = A.todayKey();
    const list = col.certs.all().map(K.normCert).filter((c) => c.id && c.title).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const ST = { ab: "⌛ abgelaufen", bald: "⏰ läuft bald ab", ok: "", frei: "" };
    return `<div class="kr2-row"><button type="button" class="btn primary sm" data-kr="cert">➕ Zertifikat / Kurs</button></div>
      ${list.length ? `<ul class="kr2-list">${list.map((c) => { const k = K.CERT_KINDS.find((x) => x[0] === c.kind), st = K.certState(c, today);
        return `<li><button type="button" class="kr2-item ${st}" data-cert="${esc(c.id)}"><span aria-hidden="true">${k[1]}</span><span><b>${esc(c.title)}</b><small>${[c.issuer, c.date && K.fmtDay(c.date), c.expires && `gültig bis ${K.fmtDay(c.expires)}`, ST[st]].filter(Boolean).map(esc).join(" · ")}</small></span></button></li>`; }).join("")}</ul>`
        : A.emptyHTML("🏅", "Deine Nachweise", "Erste-Hilfe-Kurs, Führerschein, Herstellerschulungen, Unterweisungen … alles an einem Ort – mit Erinnerung, bevor etwas abläuft.", "", "")}`;
  }

  /* ---------- Bewerbungen ---------- */
  function jobsHTML() {
    const list = col.jobs.all().map(K.normJob).filter((j) => j.id && j.company);
    const cnt = K.jobCounts(list), hints = K.jobHints(list, A.todayKey());
    const order = Object.fromEntries(K.JOB_STATUS.map(([id], i) => [id, i]));
    return `<div class="kr2-row"><button type="button" class="btn primary sm" data-kr="job">➕ Bewerbung</button><button type="button" class="btn ghost sm" data-kr="questions">💬 Typische Fragen</button></div>
      ${list.length ? `<div class="kr2-pipe">${K.JOB_STATUS.map(([id, e, l]) => `<span><b>${cnt[id]}</b><small>${e} ${l}</small></span>`).join("")}</div>` : ""}
      ${hints.length ? `<div class="card kr2-hint">${hints.map((h) => `<p>🔔 <b>${esc(h.company)}</b>: ${esc(h.hint)}</p>`).join("")}</div>` : ""}
      ${list.length ? `<ul class="kr2-list">${list.sort((a, b) => order[a.status] - order[b.status] || (b.applied || "").localeCompare(a.applied || "")).map((j) => { const st = K.jobStatus(j.status);
        return `<li><button type="button" class="kr2-item" data-job="${esc(j.id)}"><span aria-hidden="true">${st[1]}</span><span><b>${esc(j.company)}</b><small>${[j.position, st[2], j.applied && "beworben " + K.fmtDay(j.applied), j.status === "gespraech" && `Vorbereitung ${K.prepDone(j)}/${K.PREP.length}`].filter(Boolean).map(esc).join(" · ")}</small></span></button></li>`; }).join("")}</ul>`
        : A.emptyHTML("📨", "Bewerbungen im Blick", "Für nach der Lehre oder einen Firmenwechsel: Wo hast du dich beworben, was ist der nächste Schritt, bist du fürs Gespräch vorbereitet?", "", "")}`;
  }

  /* ---------- Formulare ---------- */
  function sheet(title, body, onSave, onDel) {
    ui.openSheet({ title, bodyHTML: `<div class="fields">${body}</div><div class="row">${onDel ? `<button type="button" class="btn danger sm" data-del>Löschen</button>` : ""}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sh, close) {
        const $ = (q) => sh.querySelector(q);
        $("[data-save]").addEventListener("click", async () => { if ((await onSave($, sh)) !== false) close(); });
        const d = $("[data-del]"); if (d) ui.confirmButton(d, "Wirklich löschen?", () => { close(); onDel(); });
      } });
  }
  const month = (id, v, label) => `<label>${label}<input id="${id}" type="month" value="${esc(v || "")}"></label>`;
  function aboutForm() {
    const c = cv();
    sheet("👤 Über mich", `<label>Kurzbeschreibung<input id="f-head" maxlength="80" value="${esc(c.headline)}" placeholder="z. B. Elektrotechnik-Lehrling im 3. Lehrjahr"></label>
      <label>Über mich<textarea id="f-about" rows="4" maxlength="800">${esc(c.about)}</textarea></label>
      <div class="row"><label>Wohnort<input id="f-city" value="${esc(c.city)}"></label><label>Telefon<input id="f-phone" type="tel" value="${esc(c.phone)}"></label></div>
      <label>E-Mail<input id="f-mail" type="email" value="${esc(c.email)}"></label><p class="note">Deinen Namen trägst du in den Einstellungen unter Lehrling ein.</p>`,
      ($) => saveCv({ headline: $("#f-head").value, about: $("#f-about").value, city: $("#f-city").value, phone: $("#f-phone").value, email: $("#f-mail").value }, "Gespeichert ✓"));
  }
  function stationForm(id, auto) {
    const c = cv(); const a = auto ? K.apprenticeStation(ap()) : null;
    const x = a || c.cv.find((y) => y.id === id) || { id: nid(), kind: "arbeit", title: "", org: "", from: "", to: "", text: "" };
    const isNew = !c.cv.some((y) => y.id === x.id);
    sheet(isNew ? "🗂️ Neue Station" : "Station bearbeiten", `<label>Art<select id="f-kind">${K.CV_KINDS.map(([k, e, l]) => `<option value="${k}"${x.kind === k ? " selected" : ""}>${e} ${l}</option>`).join("")}</select></label>
      <label>Titel<input id="f-title" maxlength="80" value="${esc(x.title)}" placeholder="z. B. Ferialjob, Polytechnische Schule"></label><label>Firma / Schule<input id="f-org" maxlength="80" value="${esc(x.org)}"></label>
      <div class="row">${month("f-from", x.from, "Von")}${month("f-to", x.to, "Bis (leer = heute)")}</div><label>Beschreibung<textarea id="f-text" rows="3" maxlength="600">${esc(x.text)}</textarea></label>`,
      ($) => { const t = $("#f-title").value.trim(); if (!t) { ui.toast("Bitte einen Titel."); return false; }
        const n = { ...x, kind: $("#f-kind").value, title: t, org: $("#f-org").value, from: $("#f-from").value, to: $("#f-to").value, text: $("#f-text").value };
        return saveCv({ cv: isNew ? [...c.cv, n] : c.cv.map((y) => (y.id === x.id ? n : y)) }, "Gespeichert ✓"); },
      isNew ? null : () => saveCv({ cv: c.cv.filter((y) => y.id !== x.id) }, "Gelöscht 🗑️"));
  }
  function skillsForm() {
    const c = cv();
    sheet("🧠 Kenntnisse & Sprachen", `<p class="note">Eine Kenntnis pro Zeile, Stufe 1–5 dahinter, z. B. „Hausinstallation 4“. Bereich: fachlich (⚡), Werkzeuge/Software (🧰) oder persönlich (🤝) – einfach das Emoji davor setzen.</p>
      <label>Kenntnisse<textarea id="f-sk" rows="7">${esc(c.skills.map((k) => `${k.cat === "werkzeug" ? "🧰 " : k.cat === "soft" ? "🤝 " : ""}${k.name} ${k.level}`).join("\n"))}</textarea></label>
      <label>Sprachen (je Zeile „Deutsch Muttersprache“)<textarea id="f-lang" rows="3">${esc(c.languages.map((l) => `${l.name} ${l.level}`).join("\n"))}</textarea></label>
      <label>Hobbys<input id="f-hob" maxlength="200" value="${esc(c.hobbies)}"></label>`,
      ($) => {
        const skills = $("#f-sk").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const cat = l.startsWith("🧰") ? "werkzeug" : l.startsWith("🤝") ? "soft" : "fach";
          const t = l.replace(/^(🧰|🤝|⚡)\s*/u, ""); const m = /^(.*?)\s+([1-5])$/.exec(t); return { name: m ? m[1] : t, level: m ? +m[2] : 3, cat }; });
        const languages = $("#f-lang").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const lv = K.LANG_LEVELS.find((x) => l.toLowerCase().endsWith(x.toLowerCase())); return { name: lv ? l.slice(0, -lv.length).trim() : l, level: lv || "Gut" }; });
        return saveCv({ skills, languages, hobbies: $("#f-hob").value }, "Gespeichert ✓");
      });
  }
  function goalForm() {
    const c = cv();
    sheet("🎯 Neues Ziel", `<label>Ziel<input id="f-g" maxlength="120" placeholder="z. B. LAP mit gutem Erfolg"></label>${month("f-due", "", "Bis wann? (optional)")}`,
      ($) => { const t = $("#f-g").value.trim(); if (!t) return false; return saveCv({ goals: [...c.goals, { id: nid(), text: t, due: $("#f-due").value, done: false }] }, "🎯 Ziel gesetzt!"); });
  }
  function certForm(id) {
    const x = K.normCert(col.certs.get(id) || {}); const isNew = !x.id;
    sheet(isNew ? "🏅 Neuer Nachweis" : "Nachweis bearbeiten", `<label>Art<select id="f-kind">${K.CERT_KINDS.map(([k, e, l]) => `<option value="${k}"${x.kind === k ? " selected" : ""}>${e} ${l}</option>`).join("")}</select></label>
      <label>Bezeichnung<input id="f-title" maxlength="100" value="${esc(x.title)}" placeholder="z. B. Erste-Hilfe-Kurs 16 h"></label><label>Aussteller<input id="f-iss" maxlength="80" value="${esc(x.issuer)}" placeholder="z. B. Rotes Kreuz, WIFI, Hersteller"></label>
      <div class="row"><label>Datum<input id="f-date" type="date" value="${esc(x.date)}"></label><label>Gültig bis<input id="f-exp" type="date" value="${esc(x.expires)}"></label></div>
      <label>Notiz<textarea id="f-note" rows="2">${esc(x.note)}</textarea></label><p class="note">📁 Das Dokument selbst kannst du verschlüsselt unter Alltag › Dokumente ablegen.</p>`,
      ($) => { const t = $("#f-title").value.trim(); if (!t) { ui.toast("Bitte eine Bezeichnung."); return false; }
        return A.safe(col.certs.put({ ...x, id: x.id || undefined, kind: $("#f-kind").value, title: t, issuer: $("#f-iss").value, date: $("#f-date").value, expires: $("#f-exp").value, note: $("#f-note").value }), isNew ? "🏅 Gespeichert!" : "Gespeichert ✓"); },
      isNew ? null : () => A.safe(col.certs.remove(x.id), "Gelöscht 🗑️"));
  }
  function jobForm(id) {
    const x = K.normJob(col.jobs.get(id) || { status: "gesendet", applied: A.todayKey() }); const isNew = !x.id;
    sheet(isNew ? "📨 Neue Bewerbung" : esc(x.company), `<label>Firma<input id="f-co" maxlength="80" value="${esc(x.company)}"></label><label>Stelle<input id="f-pos" maxlength="80" value="${esc(x.position)}" placeholder="z. B. Elektrotechniker:in"></label>
      <label>Status<select id="f-st">${K.JOB_STATUS.map(([k, e, l]) => `<option value="${k}"${x.status === k ? " selected" : ""}>${e} ${l}</option>`).join("")}</select></label>
      <div class="row"><label>Beworben am<input id="f-app" type="date" value="${esc(x.applied)}"></label><label>Nächster Termin<input id="f-next" type="date" value="${esc(x.next)}"></label></div>
      <label>Was ist der nächste Schritt?<input id="f-nw" maxlength="80" value="${esc(x.nextWhat)}" placeholder="z. B. Vorstellungsgespräch, Schnuppertag"></label>
      <label>Ansprechperson<input id="f-ct" maxlength="100" value="${esc(x.contact)}"></label><label>Link zur Stelle<input id="f-link" type="url" value="${esc(x.link)}" placeholder="https://…"></label>
      <label>Notizen<textarea id="f-note" rows="3">${esc(x.note)}</textarea></label>
      <div class="lbl">✅ Vorbereitung aufs Gespräch</div><ul class="kr2-prep">${K.PREP.map((p, i) => `<li><label><input type="checkbox" data-prep="${i}"${x.prep[i] ? " checked" : ""}> ${esc(p)}</label></li>`).join("")}</ul>`,
      ($, sh) => { const co = $("#f-co").value.trim(); if (!co) { ui.toast("Bitte die Firma eintragen."); return false; }
        const prep = {}; sh.querySelectorAll("[data-prep]").forEach((c) => { if (c.checked) prep[c.dataset.prep] = true; });
        return A.safe(col.jobs.put({ ...x, id: x.id || undefined, company: co, position: $("#f-pos").value, status: $("#f-st").value, applied: $("#f-app").value, next: $("#f-next").value, nextWhat: $("#f-nw").value, contact: $("#f-ct").value, link: $("#f-link").value, note: $("#f-note").value, prep }),
          $("#f-st").value === "zusage" ? "🎉 Gratuliere zur Zusage!" : "Gespeichert ✓"); },
      isNew ? null : () => A.safe(col.jobs.remove(x.id), "Gelöscht 🗑️"));
  }
  function printCv() {
    const txt = K.cvText(cv(), ap().name, ap());
    const w = window.open("", "_blank");
    if (!w) { ui.toast("Pop-up blockiert – nutze „Als Text kopieren“."); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Lebenslauf</title><style>body{font:15px/1.55 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;white-space:pre-wrap}</style><body></body>`);
    w.document.body.textContent = txt;
    w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch { /* egal */ } }, 300);
  }

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button, a"); if (!b || !el.contains(b)) return;
    const d = b.dataset;
    if (d.tab) { S.tab = d.tab; lsSet(TAB_KEY, S.tab); render(); return; }
    if (d.station) { stationForm(d.station, d.auto === "1"); return; }
    if (d.cert) { certForm(d.cert); return; }
    if (d.job) { jobForm(d.job); return; }
    if (d.delgoal) { saveCv({ goals: cv().goals.filter((g) => g.id !== d.delgoal) }); return; }
    switch (d.kr) {
      case "about": aboutForm(); break;
      case "station": stationForm(null); break;
      case "skills": skillsForm(); break;
      case "goal": goalForm(); break;
      case "cert": certForm(null); break;
      case "job": jobForm(null); break;
      case "copycv": navigator.clipboard?.writeText(K.cvText(cv(), ap().name, ap())).then(() => ui.toast("📋 Lebenslauf kopiert")).catch(() => ui.toast("Kopieren nicht möglich")); break;
      case "printcv": printCv(); break;
      case "settings": window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "lehre" } })); break;
      case "questions": ui.openSheet({ title: "💬 Typische Fragen im Gespräch", bodyHTML: `<ol class="kr2-q">${K.QUESTIONS.map((q) => `<li>${esc(q)}</li>`).join("")}</ol><p class="note">Tipp: Übe die Antworten laut – oder frag Claude im Assistenten nach einem Probe-Gespräch. 🗣️</p>` }); break;
      default: break;
    }
  });
  el.addEventListener("change", (ev) => { const g = ev.target.closest("[data-goal]"); if (g) { const c = cv(); saveCv({ goals: c.goals.map((x) => (x.id === g.dataset.goal ? { ...x, done: g.checked } : x)) }, g.checked ? "🎉 Ziel erreicht!" : null); } });
  const offs = Object.values(col).map((c) => c.watch(queue));
  const offStore = store.subscribe ? store.subscribe(queue) : null;
  render();
  return () => { alive = false; offs.forEach((f) => { try { f(); } catch { /* egal */ } }); if (typeof offStore === "function") offStore(); };
}
