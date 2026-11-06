// Update 10e: Einstellungs-Zentrale im Discord-Stil (Vollbild über der App).
// Handy: Suchfeld + gruppierte Liste (Symbol · Name · aktueller Wert · ›), Antippen öffnet die Unterseite mit Zurück-Pfeil.
// PC (≥ 1024 px): zwei Spalten – Kategorien links, Seite rechts.
// Die Unterseiten enthalten die bisherigen Felder und Module mit unveränderten IDs (#ov-target, #reminders-panel …);
// overview.js verdrahtet die Felder und hängt die Module ein (siehe dort). Öffnen: Zahnrad oben (appbar-settings.js),
// Seitenleiste „Einstellungen“ und der Knopf in der Übersicht – alle über das Ereignis „sk:open-settings“.
// Zurück: Pfeil, Escape und Android-Zurück (history.pushState, wie beim Stundenzettel) gehen eine Ebene hoch.
import { esc } from "../util.js";
import { ACCENTS, readAccent } from "../accent.js";
import { readReminders } from "./reminders.js";
import { isNative } from "../native.js";

let ctx = null;
let hub = null;
let snap = null;
let cat = "";          // offene Kategorie ("" = Liste)
let open = false;
let pendingAfterClose = null;
let token = ""; // kennzeichnet die Verlaufseinträge dieser Öffnung (alte Einträge nach Neuladen zählen nicht)
const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 1024px)") : null;
const wide = () => !!(mq && mq.matches);

const GROUPS = [
  ["konto", "Accounteinstellungen"],
  ["arbeit", "Arbeit & Lehre"],
  ["unterwegs", "Orte & Unterwegs"],
  ["app", "App-Einstellungen"],
  ["schutz", "Datenschutz & Sicherheit"],
  ["mehr", "Sonstiges"],
];

// id, Gruppe, Emoji, Titel, Suchwörter, Seiteninhalt
const CATS = [
  { id: "konto", g: "konto", e: "👤", t: "Google-Konto", k: "konto google anmelden abmelden synchronisieren sync daten export csv excel",
    html: `<div class="sh-card"><div class="lbl">Konto</div><div id="ov-account"></div></div>
      <div class="sh-links"><button type="button" class="sh-row" data-sh-act="csv"><span class="sh-ic" aria-hidden="true">📊</span><span class="sh-lb"><b>Daten als CSV (Excel)</b><small>In der Übersicht unter Monat – Monat wählen und herunterladen</small></span><span class="sh-chev" aria-hidden="true">›</span></button></div>` },
  { id: "arbeitszeit", g: "arbeit", e: "⏱️", t: "Arbeitszeit", k: "soll stunden woche arbeitstage feiertage österreich überstunden konto startsaldo saldo zählt ab pläne geplante schichten auto-stempeln soll je wochentag tagesstunden freitag urlaubsanspruch urlaub tage vergessen stempelung nachtragen",
    html: `<div class="sh-card"><div class="fields">
        <label>Soll-Stunden pro Woche
          <input type="number" id="ov-target" inputmode="decimal" min="0" max="80" step="0.5">
        </label>
        <div>
          <div class="lbl">Arbeitstage</div>
          <div class="chips ov-wd" id="ov-workdays" role="group" aria-label="Arbeitstage"></div>
        </div>
        <label class="switch">
          <input type="checkbox" id="ov-holidays">
          <span>Feiertage (Österreich) berücksichtigen</span>
        </label>
        <label>Überstundenkonto zählt ab
          <input type="date" id="ov-balstart">
        </label>
        <label>Startsaldo (Stunden, darf negativ sein)
          <input type="text" id="ov-baloffset" inputmode="text" placeholder="z. B. 12,5 oder -3:15">
        </label>
        <p class="note">Ohne Datum zählt das Konto ab deinem ersten Eintrag.</p>
      </div></div>
      <div class="sh-card"><div id="wt-settings"></div></div>
      <div class="sh-links">
        <button type="button" class="sh-row" id="ov-plans-link"><span class="sh-ic" aria-hidden="true">📅</span><span class="sh-lb"><b>Geplante Schichten (Auto-Stempeln) öffnen</b><small>Unter Orte – Schichten planen und automatisch stempeln</small></span><span class="sh-chev" aria-hidden="true">›</span></button>
        <button type="button" class="sh-row" data-sh-act="leave"><span class="sh-ic" aria-hidden="true">🌴</span><span class="sh-lb"><b>Urlaub &amp; Krankenstand</b><small>Urlaubskonto in der Übersicht</small></span><span class="sh-chev" aria-hidden="true">›</span></button>
      </div>` },
  { id: "lehre", g: "arbeit", e: "🎓", t: "Lehre & Berichtsheft", k: "lehre lehrling lehrjahr lehrbeginn lehrberuf lehrbetrieb berichtsheft ausbildungsnachweis urlaub anspruch",
    html: `<div class="sh-card"><div id="apprentice-panel"></div></div>` },
  { id: "taggeld", g: "arbeit", e: "💶", t: "Taggeld & Kilometer", k: "taggeld diäten kilometer kilometergeld heim-orte beträge fahrten",
    html: `<div class="sh-card"><div id="allowance-panel"></div></div>` },
  { id: "schule", g: "arbeit", e: "🏫", t: "Schule", k: "schule berufsschule blockschule schultag woche",
    html: `<div class="sh-card"><div id="school-panel"></div></div>` },
  { id: "orte", g: "unterwegs", e: "📍", t: "Orte & Fahrten", k: "standort gps ort orte radius fahrerkennung auto fahren fahrtenbuch fahrten",
    html: `<div class="sh-card"><div class="fields">
        <label class="switch">
          <input type="checkbox" id="ov-autoloc">
          <span>Standort beim Stempeln erfassen</span>
        </label>
        <label>Standard-Radius für Orte (m)
          <input type="number" id="ov-radius" inputmode="numeric" min="50" max="1000" step="10">
        </label>
      </div></div>
      <div class="sh-card"><div id="drive-panel"></div></div>
      <div class="sh-links">
        <button type="button" class="sh-row" data-sh-act="places"><span class="sh-ic" aria-hidden="true">🗺️</span><span class="sh-lb"><b>Orte verwalten</b><small>Baustellen, Firma, Zuhause</small></span><span class="sh-chev" aria-hidden="true">›</span></button>
        <button type="button" class="sh-row" data-sh-act="trips"><span class="sh-ic" aria-hidden="true">🚗</span><span class="sh-lb"><b>Fahrten &amp; Fahrtenbuch</b><small>Karte in der Übersicht</small></span><span class="sh-chev" aria-hidden="true">›</span></button>
      </div>` },
  { id: "benachrichtigungen", g: "app", e: "🔔", t: "Benachrichtigungen", k: "benachrichtigung erinnerung push pause pausen-erinnerung einstempeln ausstempeln sperrbildschirm",
    html: `<div class="sh-card"><div class="fields"><label class="switch">
          <input type="checkbox" id="ov-pauserem">
          <span>Pausen-Hinweis in der App</span>
        </label><div id="wt-pause-settings"></div></div></div>
      <div class="sh-card"><div id="reminders-panel"></div></div>
      <div class="sh-card"><div id="lock-panel"></div></div>` },
  { id: "aussehen", g: "app", e: "🎨", t: "Erscheinungsbild", k: "farbe akzent design dunkel hell dark mode schrift groß einfache ansicht bedienen dashboard überblick widgets heute",
    html: `<div class="sh-card"><div id="accent-panel"></div></div>
      <div class="sh-card"><div id="comfort-panel"></div></div>
      <div class="sh-links"><button type="button" class="sh-row" data-sh-act="dashboard"><span class="sh-ic" aria-hidden="true">🧩</span><span class="sh-lb"><b>Heute-Überblick anpassen</b><small>Widgets ein/aus, Reihenfolge, automatisch sortieren</small></span><span class="sh-chev" aria-hidden="true">›</span></button></div>
      <p class="note sh-foot">🌙 Hell oder dunkel richtet sich nach deinem Gerät.</p>` },
  { id: "geraete", g: "app", e: "⌚", t: "Geräte", k: "uhr watch bangle smartwatch android app gerät",
    html: `<div class="sh-card" id="sh-android-card" hidden><div id="android-panel" hidden></div></div>
      <div class="sh-card"><div id="watch-panel"></div></div>` },
  { id: "schutz", g: "schutz", e: "🛡️", t: "Privatsphäre & Sperren", k: "privat privat-modus arbeit geld-sperre pin fingerabdruck tresor passwort galerie sicherheit datenschutz",
    html: `<div class="sh-links">
        <button type="button" class="sh-row" data-sh-act="privat"><span class="sh-ic" aria-hidden="true">🏠</span><span class="sh-lb"><b>Privat-Modus</b><small>Wann Arbeit ausgeblendet wird</small></span><span class="sh-chev" aria-hidden="true">›</span></button>
        <button type="button" class="sh-row" data-sh-act="geld"><span class="sh-ic" aria-hidden="true">🔐</span><span class="sh-lb"><b>Geld-Sperre</b><small>Öffnet Alltag › Geld – dort oben das Zahnrad</small></span><span class="sh-chev" aria-hidden="true">›</span></button>
        <button type="button" class="sh-row" data-sh-act="tresor"><span class="sh-ic" aria-hidden="true">🗝️</span><span class="sh-lb"><b>Passwort-Tresor</b><small>Auto-Sperre, Master-Passwort, Sicherung</small></span><span class="sh-chev" aria-hidden="true">›</span></button>
        <button type="button" class="sh-row" data-sh-act="galerie"><span class="sh-ic" aria-hidden="true">🖼️</span><span class="sh-lb"><b>Galerie</b><small>Öffnet die Galerie – dort das Zahnrad</small></span><span class="sh-chev" aria-hidden="true">›</span></button>
      </div>` },
  { id: "assistent", g: "schutz", e: "✨", t: "Claude-Assistent", k: "claude assistent ki ai server stimme sprache hey claude verlauf",
    html: `<div class="sh-card"><p>Claude plant, fasst zusammen und trägt für dich ein. Server-Adresse, Stimme und Verlauf findest du unten im Assistenten.</p></div>
      <div class="sh-links"><button type="button" class="sh-row" data-sh-act="claude"><span class="sh-ic" aria-hidden="true">💬</span><span class="sh-lb"><b>Assistent öffnen</b><small>Alltag › Claude-Assistent</small></span><span class="sh-chev" aria-hidden="true">›</span></button></div>` },
  { id: "papierkorb", g: "mehr", e: "🗑️", t: "Papierkorb", k: "papierkorb gelöscht wiederherstellen claude",
    html: `<div class="sh-card"><p>Was Claude gelöscht hat, bleibt hier 30 Tage – du kannst es mit einem Tipp zurückholen.</p>
      <button type="button" class="btn ghost sm" id="ov-trash">🗑️ <span>Papierkorb (von Claude gelöscht)</span></button></div>` },
  { id: "hilfe", g: "mehr", e: "💡", t: "Hilfe & Über", k: "hilfe über version app info tipps",
    html: `<div class="sh-card sh-about"><div class="sh-about-ic" aria-hidden="true">⏰</div><b>Stempelkarte</b><span class="note" data-sh="version"></span></div>
      <div class="sh-card"><div class="lbl">Kleine Tipps</div><ul class="sh-tips">
        <li>Lange aufs App-Symbol drücken → Einstempeln oder Pause.</li>
        <li>Oben in den Einstellungen kannst du suchen, z. B. „Radius“ oder „Farbe“.</li>
        <li>Zahnrad oben rechts bringt dich immer hierher zurück.</li></ul></div>` },
];

function version() {
  const l = document.querySelector('link[href*="css/styles.css"]');
  const m = l && /[?&]v=([\w.-]+)/.exec(l.getAttribute("href") || "");
  return m ? m[1] : "";
}

function ensureCss() {
  if (document.getElementById("css-settings-hub")) return;
  const l = document.createElement("link");
  l.id = "css-settings-hub";
  l.rel = "stylesheet";
  l.href = new URL("../../css/settings-hub.css", import.meta.url).href;
  document.head.appendChild(l);
}

/** Baut die Zentrale (versteckt) in <body>. Gibt das Element zurück – overview.js sucht darin seine Felder. */
export function mount(c) {
  ctx = c;
  if (hub) return hub;
  ensureCss();
  hub = document.createElement("div");
  hub.id = "settings-hub";
  hub.className = "sh";
  hub.hidden = true;
  hub.setAttribute("role", "dialog");
  hub.setAttribute("aria-modal", "true");
  hub.setAttribute("aria-label", "Einstellungen");
  hub.tabIndex = -1;
  const list = GROUPS.map(([g, title]) => {
    const rows = CATS.filter((x) => x.g === g).map((x) =>
      `<button type="button" class="sh-row" data-cat="${x.id}"><span class="sh-ic" aria-hidden="true">${x.e}</span>` +
      `<span class="sh-lb"><b>${esc(x.t)}</b><small class="sh-hit" hidden></small></span>` +
      `<span class="sh-val" data-val="${x.id}"></span><span class="sh-chev" aria-hidden="true">›</span></button>`).join("");
    return `<section class="sh-group" data-group="${g}"><h3 class="sh-gh">${esc(title)}</h3><div class="sh-rows">${rows}</div></section>`;
  }).join("");
  hub.innerHTML =
    `<div class="sh-nav">
      <header class="sh-head">
        <button type="button" class="sh-back" data-sh="close" aria-label="Einstellungen schließen">←</button>
        <h2>⚙️ Einstellungen</h2>
      </header>
      <div class="sh-search"><span aria-hidden="true">🔎</span><input type="search" id="sh-q" placeholder="Suchen …" aria-label="Einstellungen durchsuchen" autocomplete="off" enterkeyhint="search"></div>
      <div class="sh-list">${list}
        <p class="sh-empty note" hidden>Nichts gefunden 🤔 – probier ein anderes Wort.</p>
        <button type="button" class="sh-signout" id="sh-signout" hidden>Abmelden</button>
        <p class="sh-ver note" data-sh="version"></p>
      </div>
    </div>
    <div class="sh-pages">${CATS.map((x) =>
      `<section class="sh-page" data-page="${x.id}" hidden aria-label="${esc(x.t)}">
        <header class="sh-head sh-phead">
          <button type="button" class="sh-back" data-sh="up" aria-label="Zurück">←</button>
          <h2><span aria-hidden="true">${x.e}</span> ${esc(x.t)}</h2>
        </header>
        <div class="sh-body">${x.html}</div>
      </section>`).join("")}
      <div class="sh-pick note">← Such dir links etwas aus.</div>
    </div>`;
  document.body.appendChild(hub);

  const v = version();
  hub.querySelectorAll('[data-sh="version"]').forEach((e) => { e.textContent = v ? "Version " + v : ""; });
  if (isNative()) hub.querySelector("#sh-android-card").hidden = false;

  hub.addEventListener("click", onClick);
  hub.querySelector("#sh-q").addEventListener("input", filter);
  hub.querySelector("#sh-q").addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    const first = hub.querySelector(".sh-list .sh-row[data-cat]:not([hidden])");
    if (first) { ev.preventDefault(); select(first.dataset.cat); }
  });
  const so = hub.querySelector("#sh-signout");
  ctx.ui.confirmButton(so, "Wirklich abmelden?", () => close(() => ctx.signOut()));

  window.addEventListener("sk:open-settings", (ev) => openHub(ev.detail && ev.detail.cat));
  window.addEventListener("popstate", onPop);
  document.addEventListener("keydown", onKey);
  if (mq && mq.addEventListener) mq.addEventListener("change", () => { if (open) show(); });
  return hub;
}

function onClick(ev) {
  const r = ev.target.closest("[data-cat]");
  if (r) { select(r.dataset.cat); return; }
  const b = ev.target.closest("[data-sh]");
  if (b && b.dataset.sh === "close") { close(); return; }
  if (b && b.dataset.sh === "up") { if (wide()) close(); else history.back(); return; }
  const a = ev.target.closest("[data-sh-act]");
  if (!a) return;
  const act = a.dataset.shAct;
  if (act === "csv") close(() => ctx.jump("month-panel"));
  else if (act === "leave") close(() => ctx.jump("leave-panel"));
  else if (act === "trips") close(() => ctx.jump("trips-panel"));
  else if (act === "places") close(() => ctx.go("orte"));
  else if (act === "dashboard") close(() => { ctx.go("heute"); setTimeout(() => document.dispatchEvent(new CustomEvent("sk:dashboard-edit")), 80); });
  else if (act === "privat") {
    import("./privat-mode.js").then((m) => m.openSettings()).catch((err) => { console.error(err); ctx.ui.toast("Privat-Modus konnte nicht geladen werden."); });
  } else if (act === "geld" || act === "tresor" || act === "galerie" || act === "claude") {
    close(() => { location.hash = "#alltag/" + act; });
  }
}

/** Zentrale öffnen (optional direkt eine Kategorie). */
export function openHub(c) {
  if (!hub) return;
  if (!open) {
    open = true;
    hub.hidden = false;
    document.body.classList.add("sh-open");
    token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const base = { ...(history.state || {}) };
    delete base.sh; delete base.shCat; delete base.shId;
    try { history.pushState({ ...base, sh: 1, shCat: "", shId: token }, "", location.href); } catch { /* egal */ }
    const q = hub.querySelector("#sh-q");
    q.value = "";
    filter();
    cat = "";
    hub.querySelector(".sh-list").scrollTop = 0;
  }
  if (c && CATS.some((x) => x.id === c)) select(c);
  else show();
  if (snap) update(snap);
  try { hub.focus({ preventScroll: true }); } catch { /* egal */ }
}

function select(id) {
  if (!open) return openHub(id);
  const st = { ...(history.state || {}), shId: token };
  if (wide() || (st.sh === 2 && (history.state || {}).shId === token)) {
    try { history.replaceState({ ...st, sh: wide() ? 1 : 2, shCat: id }, "", location.href); } catch { /* egal */ }
  } else {
    try { history.pushState({ ...st, sh: 2, shCat: id }, "", location.href); } catch { /* egal */ }
  }
  cat = id;
  show();
  const p = hub.querySelector(`.sh-page[data-page="${id}"]`);
  if (p) {
    p.scrollTop = 0;
    const back = p.querySelector(".sh-back");
    if (!wide() && back) { try { back.focus({ preventScroll: true }); } catch { /* egal */ } }
  }
}

function show() {
  const w = wide();
  if (w && !cat) cat = "konto";
  hub.dataset.level = cat && !w ? "page" : "list";
  hub.querySelectorAll(".sh-page").forEach((p) => { p.hidden = p.dataset.page !== cat; });
  hub.querySelector(".sh-pick").hidden = !!cat;
  hub.querySelectorAll(".sh-list .sh-row[data-cat]").forEach((r) => {
    if (w && r.dataset.cat === cat) r.setAttribute("aria-current", "page"); else r.removeAttribute("aria-current");
  });
}

/** Zentrale schließen; then() läuft, sobald der Verlauf zurückgesetzt ist. */
export function close(then) {
  if (!open) { if (then) then(); return; }
  const st = history.state || {};
  const depth = st.shId !== token ? 0 : st.sh === 2 ? 2 : st.sh === 1 ? 1 : 0;
  pendingAfterClose = then || null;
  if (depth) { history.go(-depth); return; } // onPop schließt dann wirklich
  finishClose();
}

function finishClose() {
  open = false;
  cat = "";
  hub.hidden = true;
  document.body.classList.remove("sh-open");
  const t = pendingAfterClose;
  pendingAfterClose = null;
  if (t) { try { t(); } catch (err) { console.error(err); } }
}

function onPop(ev) {
  if (!open) return;
  const st = ev.state || {};
  if (!st.sh || st.shId !== token) { finishClose(); return; }
  cat = st.sh === 2 ? (st.shCat || "") : (wide() ? cat : "");
  show();
}

function onKey(ev) {
  if (!open || ev.key !== "Escape") return;
  if (document.querySelector("#sheet-root .sheet")) return;
  ev.preventDefault();
  const q = hub.querySelector("#sh-q");
  if (document.activeElement === q && q.value) { q.value = ""; filter(); return; }
  if (cat && !wide()) history.back(); else close();
}

/* ---------- Suche ---------- */

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function pageLabels(id) {
  const p = hub.querySelector(`.sh-page[data-page="${id}"] .sh-body`);
  if (!p) return [];
  return [...p.querySelectorAll("label, .lbl, .rm-title, .sh-lb b, h3, h4, .switch span")]
    .map((e) => (e.firstChild && e.tagName === "LABEL" ? (e.childNodes[0].textContent || e.textContent) : e.textContent).trim().replace(/\s+/g, " "))
    .filter((t) => t && t.length < 70);
}

function filter() {
  const raw = hub.querySelector("#sh-q").value.trim();
  const q = norm(raw);
  let any = false;
  hub.querySelectorAll(".sh-group").forEach((g) => {
    let n = 0;
    g.querySelectorAll(".sh-row[data-cat]").forEach((r) => {
      const c = CATS.find((x) => x.id === r.dataset.cat);
      const hit = r.querySelector(".sh-hit");
      let show = true, sub = "";
      if (q) {
        const inTitle = norm(c.t).includes(q) || norm(c.k).includes(q);
        const lab = pageLabels(c.id).find((t) => norm(t).includes(q));
        show = inTitle || !!lab;
        if (lab && !norm(c.t).includes(q)) sub = lab;
      }
      r.hidden = !show;
      hit.hidden = !sub;
      hit.textContent = sub;
      if (show) n++;
    });
    g.hidden = n === 0;
    if (n) any = true;
  });
  hub.querySelector(".sh-empty").hidden = any;
  hub.querySelector(".sh-list").classList.toggle("searching", !!q);
}

/* ---------- Werte rechts ---------- */

export function update(s) {
  snap = s;
  if (!hub || !snap) return;
  const set = snap.settings || {};
  const val = (id, t) => { const e = hub.querySelector(`[data-val="${id}"]`); if (e && e.textContent !== t) e.textContent = t; };
  const u = snap.user;
  val("konto", snap.mode === "cloud" && u ? (u.name || u.email || "Angemeldet") : "Nur dieses Gerät");
  const wt = Number(set.weeklyTarget ?? 38.5);
  val("arbeitszeit", Number.isFinite(wt) ? String(wt).replace(".", ",") + " h/Woche" : "");
  let rem = true;
  try { rem = readReminders(set).enabled; } catch { /* egal */ }
  val("benachrichtigungen", rem ? "An" : "Aus");
  const ac = ACCENTS.find((a) => a.id === readAccent(set));
  val("aussehen", ac ? ac.name : "");
  val("orte", set.autoLocate !== false ? "Standort an" : "Standort aus");
  val("hilfe", version());
  hub.querySelector("#sh-signout").hidden = !(snap.mode === "cloud" && u);
}

export function isOpen() { return open; }
