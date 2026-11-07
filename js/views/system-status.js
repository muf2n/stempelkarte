// Update 10 F – 🖥️ System-Status (Einstellungen › Sonstiges): Version, Was ist neu, Sync, Backup, Speicher, KI-Verbrauch,
// Service-Worker-Cache (+ „Cache leeren & neu laden“), „Diagnose kopieren“ (nur Zahlen/Flags, keine Inhalte) und „Überall abmelden“.
import { CHANGELOG } from "../changelog.js";
import { agoText, lastBackupAt } from "../backup-core.js";
import { getFirebase } from "../firebase.js";
import { openedNames, collection } from "../alltag/db.js";
import { readProfiles, modulesOff } from "../profiles-core.js";
import { readPrefs } from "../notify-core.js";

const fmtBytes = (n) => {
  if (!(n >= 0)) return "–";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1).replace(".", ",")} MB`;
  return `${(n / 1073741824).toFixed(2).replace(".", ",")} GB`;
};

function ensureCss() {
  if (document.getElementById("css-system-status")) return;
  const l = document.createElement("link");
  l.id = "css-system-status"; l.rel = "stylesheet";
  l.href = new URL("../../css/system-status.css", import.meta.url).href;
  document.head.appendChild(l);
}

export function pageVersion() {
  const l = document.querySelector('link[href*="css/styles.css"]');
  const m = l && /[?&]v=([\w.-]+)/.exec(l.getAttribute("href") || "");
  return m ? m[1] : "";
}

/** Service Worker nach Version fragen (MessageChannel, 1,5 s Zeitlimit). */
export function swInfo(timeout = 1500) {
  return new Promise((resolve) => {
    const c = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!c || typeof MessageChannel === "undefined") { resolve(null); return; }
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), timeout);
    ch.port1.onmessage = (ev) => { clearTimeout(t); resolve(ev.data && typeof ev.data === "object" ? ev.data : null); };
    try { c.postMessage({ type: "sk-version" }, [ch.port2]); } catch { clearTimeout(t); resolve(null); }
  });
}

/** localStorage-Größe (UTF-16 → 2 Byte/Zeichen) und Anzahl Schlüssel. */
export function localStorageSize() {
  let bytes = 0, keys = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      bytes += (k.length + (localStorage.getItem(k) || "").length) * 2;
      keys++;
    }
  } catch { /* egal */ }
  return { bytes, keys };
}

async function cachesInfo() {
  if (typeof caches === "undefined") return [];
  try {
    const names = (await caches.keys()).filter((n) => n.startsWith("stempelkarte"));
    return await Promise.all(names.map(async (n) => ({ name: n, entries: (await (await caches.open(n)).keys()).length })));
  } catch { return []; }
}

async function idbNames() {
  try { if (indexedDB && indexedDB.databases) return (await indexedDB.databases()).map((d) => d.name).filter(Boolean); } catch { /* egal */ }
  return null;
}

/** Firestore: wartende Schreibvorgänge? → "ok" | "pending" | "unknown" */
async function pendingWrites(snap) {
  if (!snap || snap.mode !== "cloud") return "local";
  try {
    const f = await getFirebase();
    if (!f || !f.fs.waitForPendingWrites) return "unknown";
    const done = f.fs.waitForPendingWrites(f.db).then(() => "ok", () => "unknown");
    return await Promise.race([done, new Promise((r) => setTimeout(() => r("pending"), 1500))]);
  } catch { return "unknown"; }
}

async function aiUsage(snap) {
  if (!snap || snap.mode !== "cloud" || !snap.user) return null;
  try {
    const f = await getFirebase();
    const u = f && f.auth.currentUser;
    if (!u) return null;
    const d = await f.fs.getDoc(f.fs.doc(f.db, "users", u.uid, "meta", "ai_usage"));
    if (!d.exists()) return { none: true };
    const x = d.data() || {};
    return { month: String(x.month || ""), usd: Number(x.usd) || 0, inTok: Number(x.inTok) || 0, outTok: Number(x.outTok) || 0 };
  } catch { return null; }
}

/** Inhaltsfreie Diagnose: nur Versionen, Zahlen und Schalter. */
export async function diagnose(ctx) {
  const snap = ctx.store.get() || {};
  const s = snap.settings || {};
  const sw = await swInfo();
  let est = null;
  try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch { est = null; }
  const cols = {};
  for (const n of openedNames()) { try { const c = collection(n); cols[n] = c.loaded ? c.all().length : null; } catch { /* egal */ } }
  const ls = localStorageSize();
  return {
    app: "stempelkarte", page: pageVersion(), sw: sw ? sw.version : null, swCacheEntries: sw ? sw.entries : null,
    at: new Date().toISOString().slice(0, 16), mode: snap.mode || null, online: navigator.onLine !== false,
    standalone: !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches),
    native: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
    counts: { entries: (snap.entries || []).length, places: (snap.places || []).length, todos: (snap.todos || []).length, days: Object.keys(snap.days || {}).length, alltag: cols },
    flags: {
      running: !!snap.running, profile: readProfiles(s).active, modulesOff: [...modulesOff(s)].sort(),
      notifyOff: [...readPrefs(s).off].sort(), privat: !!(s.mode && s.mode.privat), briefingPush: !!(s.briefing && s.briefing.push),
      lastBackupDays: (() => { const b = lastBackupAt(s, []); return b ? Math.floor((Date.now() - b) / 86400000) : null; })(),
    },
    storage: { usage: est ? est.usage || 0 : null, quota: est ? est.quota || 0 : null, localStorageBytes: ls.bytes, localStorageKeys: ls.keys },
    screen: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
  };
}

export function mountPanel(el, ctx) {
  ensureCss();
  if (!el) return null;
  const esc = ctx.util.esc;
  let seq = 0;
  async function render() {
    const my = ++seq;
    const snap = ctx.store.get() || {};
    const s = snap.settings || {};
    let autoAt = 0;
    try { autoAt = Number(JSON.parse(localStorage.getItem("stempelkarte.backup.auto") || "0")) || 0; } catch { /* egal */ }
    const bk = lastBackupAt(s, [{ created: autoAt }]);
    const online = navigator.onLine !== false;
    const cloud = snap.mode === "cloud";
    el.innerHTML = `
      <div class="sh-card ss-grid">
        <div class="ss-kv"><span>📦 App-Version</span><b data-ss="page">${esc(pageVersion() || "–")}</b></div>
        <div class="ss-kv"><span>⚙️ Service Worker</span><b data-ss="sw">…</b></div>
        <div class="ss-kv"><span>${online ? "🟢" : "📴"} Verbindung</span><b data-ss="online">${online ? "online" : "offline"}</b></div>
        <div class="ss-kv"><span>☁️ Sync</span><b data-ss="sync">${cloud ? "wird geprüft …" : "nur dieses Gerät"}</b></div>
        <div class="ss-kv"><span>💾 Letztes Backup</span><b data-ss="backup">${esc(bk ? agoText(bk) : "noch nie")}</b></div>
        <div class="ss-kv"><span>🤖 KI diesen Monat</span><b data-ss="ai">${cloud ? "…" : "–"}</b></div>
      </div>
      <div class="sh-card"><div class="lbl">🗄️ Speicher</div>
        <div class="ss-bar" data-ss="bar" hidden><i></i></div>
        <ul class="ss-list" data-ss="storage"><li>Wird berechnet …</li></ul>
      </div>
      <div class="sh-card"><div class="lbl">🧹 Offline-Cache</div>
        <ul class="ss-list" data-ss="caches"><li>…</li></ul>
        <p class="note">Hilft, wenn etwas komisch aussieht: Cache leeren lädt die App frisch. Deine Daten bleiben erhalten ☁️</p>
        <button type="button" class="btn ghost sm" data-ss-act="clear">🧹 Cache leeren &amp; neu laden</button>
      </div>
      <div class="sh-card"><div class="lbl">🩺 Diagnose</div>
        <p class="note">Kopiert nur Versionen, Anzahlen und Schalter – keine Namen, Texte, Orte oder Beträge. Praktisch, wenn du einen Fehler meldest.</p>
        <button type="button" class="btn ghost sm" data-ss-act="diag">📋 Diagnose kopieren</button>
        <pre class="ss-diag" data-ss="diag" hidden></pre>
      </div>
      <div class="sh-card"><div class="lbl">🚪 Überall abmelden</div>
        ${cloud ? `<p class="note">Meldet dich hier ab und macht die Anmeldung auf <b>allen anderen Geräten</b> ungültig (über deinen Server). Dort musst du dich danach neu mit Google anmelden. Schon geöffnete Fenster merken es spätestens nach einer Stunde.</p>
        <button type="button" class="btn ghost sm ss-danger" data-ss-act="revoke">🚪 Überall abmelden</button>`
        : `<p class="note">Du nutzt die App gerade nur auf diesem Gerät – es gibt keine Anmeldung, die man widerrufen könnte.</p>`}
      </div>
      <div class="sh-card"><div class="lbl">✨ Was ist neu</div>
        <ol class="ss-log">${CHANGELOG.map((c, i) => `<li${i > 3 ? ' class="ss-old" hidden' : ""}><b>${esc(c.v)}</b><ul>${c.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></li>`).join("")}</ol>
        <button type="button" class="btn ghost sm" data-ss-act="more">Ältere anzeigen</button>
      </div>`;
    const set = (k, v) => { if (my !== seq) return; const e = el.querySelector(`[data-ss="${k}"]`); if (e) e.textContent = v; };
    swInfo().then((i) => set("sw", i ? `${i.version}${i.version !== pageVersion() && pageVersion() ? " (Update wartet)" : ""}` : "nicht aktiv"));
    pendingWrites(snap).then((p) => set("sync", { ok: online ? "✅ alles hochgeladen" : "offline – wartet", pending: "⏳ Änderungen warten auf Upload", unknown: "unbekannt", local: "nur dieses Gerät" }[p]));
    if (cloud) aiUsage(snap).then((a) => set("ai", !a ? "nicht verfügbar" : a.none ? "noch nichts" : `${a.usd.toFixed(2).replace(".", ",")} $ · ${Math.round((a.inTok + a.outTok) / 1000)}k Tokens${a.month ? " (" + a.month + ")" : ""}`));
    (async () => {
      let est = null;
      try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch { est = null; }
      const ls = localStorageSize();
      const dbs = await idbNames();
      if (my !== seq) return;
      const rows = [];
      if (est && est.quota) {
        const pct = Math.min(100, Math.round(((est.usage || 0) / est.quota) * 1000) / 10);
        rows.push(`<li><span>Gesamt belegt</span><b>${esc(fmtBytes(est.usage || 0))} von ${esc(fmtBytes(est.quota))} (${String(pct).replace(".", ",")} %)</b></li>`);
        const bar = el.querySelector('[data-ss="bar"]');
        bar.hidden = false;
        bar.querySelector("i").style.width = Math.max(1, pct) + "%";
      }
      rows.push(`<li><span>localStorage</span><b>${esc(fmtBytes(ls.bytes))} · ${ls.keys} Einträge</b></li>`);
      rows.push(`<li><span>IndexedDB</span><b>${dbs ? esc(dbs.length ? dbs.join(", ") : "keine") : "nicht abfragbar"}</b></li>`);
      el.querySelector('[data-ss="storage"]').innerHTML = rows.join("");
      const cs = await cachesInfo();
      if (my !== seq) return;
      el.querySelector('[data-ss="caches"]').innerHTML = cs.length ? cs.map((c) => `<li><span>${esc(c.name)}</span><b>${c.entries} Dateien</b></li>`).join("") : "<li>Kein Cache vorhanden</li>";
    })().catch((e) => console.warn("System-Status:", e));
  }

  el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-ss-act]");
    if (!b) return;
    const act = b.dataset.ssAct;
    if (act === "more") { el.querySelectorAll(".ss-old").forEach((x) => { x.hidden = false; }); b.hidden = true; return; }
    if (act === "diag") {
      const txt = JSON.stringify(await diagnose(ctx), null, 2);
      const pre = el.querySelector('[data-ss="diag"]');
      pre.textContent = txt; pre.hidden = false;
      try { await navigator.clipboard.writeText(txt); ctx.ui.toast("📋 Diagnose kopiert – ohne persönliche Inhalte", 2200); }
      catch { ctx.ui.toast("Kopieren ging nicht – markier den Text unten 🙂", 2600); }
      return;
    }
    if (act === "clear") {
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Wirklich? Nochmal tippen"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "🧹 Cache leeren & neu laden"; }, 4000); return; }
      ctx.ui.setBusy(b, true, "Leere …");
      try {
        if (typeof caches !== "undefined") for (const n of await caches.keys()) if (n.startsWith("stempelkarte")) await caches.delete(n);
        const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
        if (reg) await reg.update().catch(() => {});
      } catch (e) { console.warn(e); }
      location.reload();
      return;
    }
    if (act === "revoke") {
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Wirklich überall abmelden?"; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "🚪 Überall abmelden"; } }, 4000); return; }
      ctx.ui.setBusy(b, true, "Melde ab …");
      try {
        const ai = await import("../alltag/ai-client.js");
        if (!ai.isServerOwner()) throw Object.assign(new Error(ai.notOwnerText()), { code: "owner" });
        const token = await ai.idToken();
        const res = await fetch(ai.serverUrl() + "/auth/revoke", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: "{}" });
        let data = null; try { data = await res.json(); } catch { /* leer */ }
        if (!res.ok) throw new Error((data && data.error) || "Fehler " + res.status);
        ctx.ui.toast("🚪 Alle Geräte abgemeldet – bis gleich!", 2600);
        if (ctx.signOut) setTimeout(() => ctx.signOut(), 400);
      } catch (e) {
        ctx.ui.toast(e && e.code === "owner" ? e.message : `Überall abmelden ging nicht: ${(e && e.message) || "Server nicht erreichbar"}. Hier abmelden geht trotzdem unten.`, 4200);
        ctx.ui.setBusy(b, false);
        b.dataset.armed = "";
      }
    }
  });
  render();
  return render;
}
