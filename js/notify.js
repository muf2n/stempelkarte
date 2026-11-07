// Update 10 – 🔔 Benachrichtigungszentrale: Glocke in der Kopfzeile (#btn-notify, am PC #pc-notify) mit Zähler,
// Tipp öffnet die Liste. Inhalte sammelt js/notify-core.js aus echten Daten (Planer, Geld, Schule, Material,
// Arbeitszeit, Wochenbericht, Backup). Gelesen/weggewischt pro Gerät in localStorage. Push bleibt unverändert.
// Kategorien ein/aus: Einstellungen › Benachrichtigungen (js/views/notify-settings.js, settings.notify.off).
import * as N from "./notify-core.js";
import { collection } from "./alltag/db.js";
import { lastBackupAt } from "./backup-core.js";
import { cachedAutoAt } from "./backup.js";

const LS = "stempelkarte.notify.v1";
let ctx = null;
let layer = null;
let snap = null;
let items = [];
let state = N.emptyState();
let open = false;
let token = "";
let pendingAfterClose = null;
let queued = false;
let lockMod = null;
const subs = new Map();
const data = new Map();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function readState() { try { return N.normState(JSON.parse(localStorage.getItem(LS) || "{}")); } catch { return N.emptyState(); } }
function writeState() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch { /* egal */ } }

function ensureCss() {
  if (document.getElementById("css-notify")) return;
  const l = document.createElement("link");
  l.id = "css-notify";
  l.rel = "stylesheet";
  l.href = new URL("../css/notify.css", import.meta.url).href;
  document.head.appendChild(l);
}

export function mount(c) {
  ctx = c;
  if (layer) return;
  ensureCss();
  state = readState();
  layer = document.createElement("div");
  layer.id = "notify-layer";
  layer.className = "nt";
  layer.hidden = true;
  layer.innerHTML = `<div class="nt-scrim" data-nt="close"></div>
    <section class="nt-panel" role="dialog" aria-modal="true" aria-labelledby="nt-title" tabindex="-1">
      <header class="nt-head">
        <button type="button" class="nt-x nt-back" data-nt="close" aria-label="Mitteilungen schließen">←</button>
        <h2 id="nt-title">🔔 Mitteilungen</h2>
        <button type="button" class="btn ghost sm nt-all" data-nt="all">✔️ Alle gelesen</button>
      </header>
      <div class="nt-body" id="nt-body"></div>
      <footer class="nt-foot"><button type="button" class="nt-link" data-nt="prefs">⚙️ Was soll hier auftauchen?</button></footer>
    </section>`;
  document.body.appendChild(layer);
  layer.addEventListener("click", onClick);
  for (const id of ["btn-notify", "pc-notify"]) {
    const b = document.getElementById(id);
    if (b) b.addEventListener("click", () => (open ? close() : openPanel()));
  }
  window.addEventListener("popstate", onPop);
  document.addEventListener("keydown", (ev) => { if (open && ev.key === "Escape" && !document.querySelector("#sheet-root .sheet")) { ev.preventDefault(); close(); } });
  window.addEventListener("sk:open-notify", () => setTimeout(openPanel, 0)); // nicht mitten in einem popstate öffnen
  window.addEventListener("sk:backup-changed", schedule);
  window.addEventListener("storage", (ev) => { if (ev.key === LS) { state = readState(); schedule(); } });
  setInterval(schedule, 60000);
  import("./alltag/money-lock-state.js").then((m) => { lockMod = m; m.onChange(schedule); schedule(); }).catch(() => { /* ohne Geld-Sperre */ });
  if (ctx.store && ctx.store.get) update(ctx.store.get());
}

export function update(s) {
  snap = s || snap;
  if (!layer || !snap || !snap.ready) return;
  syncSources();
  schedule();
}

/* ---------- Datenquellen (nur für eingeschaltete Kategorien) ---------- */

function want() {
  const off = N.readPrefs(snap.settings).off;
  const names = new Set();
  for (const [cat, list] of Object.entries(N.NEEDS)) if (!off.has(cat)) list.forEach((n) => names.add(n));
  if (!off.has("geld") && (data.get("money_budget") || []).length) { names.add("money_tx"); names.add("money_cats"); }
  return names;
}

function syncSources() {
  const w = want();
  for (const n of w) {
    if (subs.has(n)) continue;
    subs.set(n, () => {}); // Platzhalter: watch() ruft sofort zurück
    try { subs.set(n, collection(n).watch((list) => { data.set(n, list || []); if (n === "money_budget") queueMicrotask(syncSources); schedule(); })); }
    catch (err) { console.warn("Mitteilungen: " + n, err); }
  }
  for (const [n, off] of [...subs]) if (!w.has(n)) { try { off(); } catch { /* egal */ } subs.delete(n); data.delete(n); }
}

function schedule() {
  if (queued) return;
  queued = true;
  setTimeout(() => { queued = false; try { recompute(); } catch (err) { console.error("Mitteilungen:", err); } }, 60);
}

function recompute() {
  if (!snap || !snap.ready) return;
  const loaded = {};
  for (const n of subs.keys()) { try { loaded[n] = collection(n).loaded; } catch { loaded[n] = false; } }
  const s = snap.settings || {};
  items = N.collect({
    now: Date.now(), todos: snap.todos, entries: snap.entries, running: snap.running, settings: s,
    cols: Object.fromEntries(data), loaded,
    moneyLocked: !!(lockMod && lockMod.isLocked()),
    lastBackupAt: lastBackupAt(s, [{ created: cachedAutoAt() }]),
    hasData: (snap.entries || []).length + (snap.todos || []).length + (snap.places || []).length > 0,
  });
  const pruned = N.prune(state, items);
  if (JSON.stringify(pruned) !== JSON.stringify(state)) { state = pruned; writeState(); }
  renderBadge();
  if (open) renderList();
}

/* ---------- Glocke ---------- */

function renderBadge() {
  const n = N.unreadCount(items, state);
  const urgent = N.view(items, state).some((i) => !i.read && i.prio >= 3);
  for (const id of ["btn-notify", "pc-notify"]) {
    const b = document.getElementById(id);
    if (!b) continue;
    const badge = b.querySelector(".nt-badge");
    if (badge) {
      badge.hidden = n === 0;
      badge.textContent = n > 9 ? "9+" : String(n);
      badge.classList.toggle("hot", urgent);
    }
    const label = n ? `Mitteilungen, ${n} neu` : "Mitteilungen";
    if (b.getAttribute("aria-label") !== label) b.setAttribute("aria-label", label);
    b.title = label;
  }
}

/* ---------- Liste ---------- */

const GROUPS = [["🔥 Jetzt wichtig", (i) => i.prio >= 2], ["🗓️ Demnächst", (i) => i.prio === 1], ["💡 Gut zu wissen", (i) => i.prio <= 0]];

function renderList() {
  const body = layer.querySelector("#nt-body");
  const list = N.view(items, state);
  layer.querySelector(".nt-all").disabled = !list.some((i) => !i.read);
  if (!list.length) {
    body.innerHTML = `<div class="nt-empty"><div class="nt-empty-ic" aria-hidden="true">🌿</div><b>Alles erledigt 🎉</b><p class="note">Gerade gibt's nichts Neues. Gönn dir einen Kaffee ☕</p></div>`;
    return;
  }
  body.innerHTML = GROUPS.map(([title, f]) => {
    const g = list.filter(f);
    if (!g.length) return "";
    return `<h3 class="nt-gh">${title}</h3><ul class="nt-list">${g.map((i) => `<li class="nt-item${i.read ? "" : " unread"} p${i.prio}" data-id="${esc(i.id)}">
        <button type="button" class="nt-go" data-nt="go" data-id="${esc(i.id)}">
          <span class="nt-ic" aria-hidden="true">${esc(i.emoji || "🔔")}</span>
          <span class="nt-tx"><b>${esc(i.title)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span>
          ${i.read ? "" : `<span class="nt-dot" aria-label="neu"></span>`}
        </button>
        <button type="button" class="nt-x nt-dis" data-nt="dismiss" data-id="${esc(i.id)}" aria-label="„${esc(i.title)}“ ausblenden">✕</button>
      </li>`).join("")}</ul>`;
  }).join("");
}

function onClick(ev) {
  const b = ev.target.closest("[data-nt]");
  if (!b) return;
  const act = b.dataset.nt;
  if (act === "close") { close(); return; }
  if (act === "all") { state = N.markRead(state, items.map((i) => i.id)); writeState(); renderBadge(); renderList(); ctx.ui.toast("✔️ Alles als gelesen markiert"); return; }
  if (act === "prefs") { close(() => window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "benachrichtigungen" } }))); return; }
  const it = items.find((i) => i.id === b.dataset.id);
  if (!it) return;
  if (act === "dismiss") {
    state = N.dismiss(state, it.id); writeState(); renderBadge();
    const li = b.closest(".nt-item");
    if (li) li.classList.add("gone");
    setTimeout(renderList, 160);
    return;
  }
  if (act === "go") {
    state = N.markRead(state, [it.id]); writeState(); renderBadge();
    close(() => navigate(it.target));
  }
}

function navigate(target) {
  const t = String(target || "");
  if (t.startsWith("#")) { if (location.hash !== t) location.hash = t; return; }
  if (t.startsWith("jump:")) { if (ctx.jump) ctx.jump(t.slice(5)); return; } // Update 10 – Automationen (z. B. Monatsübersicht)
  if (t.startsWith("settings:")) { window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: t.slice(9) } })); return; }
  if (t.startsWith("todo:")) {
    const todo = ((snap && snap.todos) || []).find((x) => x.id === t.slice(5));
    if (location.hash !== "#agenda") location.hash = "#agenda";
    if (todo && ctx.openTodoForm) setTimeout(() => ctx.openTodoForm(todo), 60);
    return;
  }
  if (t === "weekreport") {
    import("./views/weekreport.js").then((m) => m.openWeekReport(ctx, {})).catch((err) => { console.error(err); ctx.ui.toast("Wochenbericht konnte nicht geladen werden."); });
  }
}

/* ---------- Öffnen / Schließen ---------- */

export function openPanel() {
  if (!layer || open) return;
  if (document.body.classList.contains("sh-open") || document.body.classList.contains("srch-open")) return;
  open = true;
  recompute();
  renderList();
  layer.hidden = false;
  document.body.classList.add("nt-open");
  token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try { history.pushState({ ...(history.state || {}), nt: token }, "", location.href); } catch { /* egal */ }
  for (const id of ["btn-notify", "pc-notify"]) { const b = document.getElementById(id); if (b) b.setAttribute("aria-expanded", "true"); }
  try { layer.querySelector(".nt-panel").focus({ preventScroll: true }); } catch { /* egal */ }
}

export function close(then) {
  if (!open) { if (then) then(); return; }
  pendingAfterClose = then || null;
  if ((history.state || {}).nt === token) { history.back(); return; }
  finishClose();
}

function finishClose() {
  open = false;
  layer.hidden = true;
  document.body.classList.remove("nt-open");
  for (const id of ["btn-notify", "pc-notify"]) { const b = document.getElementById(id); if (b) b.setAttribute("aria-expanded", "false"); }
  const t = pendingAfterClose;
  pendingAfterClose = null;
  if (t) setTimeout(() => { try { t(); } catch (err) { console.error(err); } }, 0); // erst nach allen popstate-Hörern
}

function onPop(ev) {
  if (!open) return;
  if ((ev.state || {}).nt !== token) finishClose();
}

export function isOpen() { return open; }
/** Für Tests/andere Module: aktuelle Liste (ohne weggewischte). */
export function current() { return N.view(items, state); }
