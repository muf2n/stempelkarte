// Update 10 – 💾 Einstellungs-Karte „Backup & Daten“ (#backup-panel, Kategorie „backup“ der Einstellungs-Zentrale).
// Jetzt sichern (optional mit Passwort → .skbackup), Datei zurückspielen (Vorschau, Zusammenführen/Ersetzen),
// automatische Server-Backups (users/{uid}/backups, jeden Sonntag vom Worker) laden/zurückspielen.
import * as B from "../backup-core.js";
import * as BK from "../backup.js";

let ctx = null;
let root = null;
let snap = null;
let autoList = null;   // null = noch nicht geladen
let autoErr = "";
let autoKey = "";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDay = (k) => { const [y, m, d] = String(k).split("-"); return `${d}.${m}.${y}`; };
const fmtTs = (ts) => { const d = new Date(ts); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function ensureCss() {
  if (document.getElementById("css-backup")) return;
  const l = document.createElement("link");
  l.id = "css-backup";
  l.rel = "stylesheet";
  l.href = new URL("../../css/backup.css", import.meta.url).href;
  document.head.appendChild(l);
}

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  ensureCss();
  root.classList.add("rm", "bk");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico" aria-hidden="true">💾</span>
      <div><div class="rm-title">Backup &amp; Daten</div>
      <p class="note">Alles in einer Datei – Arbeitszeit, Planer, Geld, Schule, Lernkarten, Material … So bist du auf der sicheren Seite 🛟</p></div>
    </div>
    <div class="bk-status" id="bk-status" role="status"><span class="bk-dot" aria-hidden="true"></span><span><b>Letztes Backup:</b> <span id="bk-last">…</span></span></div>

    <h4 class="bk-h">📦 Jetzt sichern</h4>
    <label class="switch"><input type="checkbox" id="bk-enc" checked><span>🔒 Mit Passwort verschlüsseln (empfohlen)</span></label>
    <p class="note warn bk-nopw" id="bk-nopw" hidden>⚠️ Ohne Passwort kann jeder, der die Datei bekommt, alles darin lesen – Notfallkarte, Kontakte, Geld, Dokument-Texte. Kalender-Abo-Links und die Geld-Sperre werden deshalb weggelassen (nach dem Zurückspielen neu einrichten).</p>
    <div class="bk-pw" id="bk-pw">
      <label>Passwort (mind. 8 Zeichen)<input type="password" id="bk-pw1" autocomplete="new-password" minlength="8"></label>
      <label>Passwort wiederholen<input type="password" id="bk-pw2" autocomplete="new-password" minlength="8"></label>
      <p class="note">Merk dir das Passwort gut – ohne kann niemand (auch du nicht) das Backup öffnen.</p>
    </div>
    <button type="button" class="btn primary bk-go" id="bk-save">💾 Backup herunterladen</button>
    <p class="note bk-fine">🗝️ Der Passwort-Tresor ist nicht dabei – er hat seine eigene verschlüsselte Sicherung (Alltag › Tresor). Fotos selbst auch nicht, nur ihre Infos.</p>

    <h4 class="bk-h">📂 Wiederherstellen</h4>
    <p class="note">Wähl eine Backup-Datei (.json oder .skbackup). Du siehst zuerst, was drin ist – erst dann wird etwas geändert.</p>
    <input type="file" id="bk-file" accept=".json,.skbackup,application/json,application/octet-stream" hidden>
    <button type="button" class="btn ghost bk-go" id="bk-pick">📂 Backup-Datei wählen</button>

    <h4 class="bk-h">🌙 Automatische Backups</h4>
    <div id="bk-auto"></div>`;

  const $ = (s) => root.querySelector(s);
  $("#bk-enc").addEventListener("change", () => { const on = $("#bk-enc").checked; $("#bk-pw").hidden = !on; $("#bk-nopw").hidden = on; if (on) $("#bk-pw1").focus(); });
  $("#bk-save").addEventListener("click", onSave);
  $("#bk-pick").addEventListener("click", () => { $("#bk-file").value = ""; $("#bk-file").click(); });
  $("#bk-file").addEventListener("change", onFile);
  $("#bk-auto").addEventListener("click", onAutoClick);
  if (ctx.store && ctx.store.get) { try { update(ctx.store.get()); } catch { /* egal */ } }
}

export function update(s) {
  snap = s;
  if (!root || !snap) return;
  renderStatus();
  const k = snap.mode === "cloud" && snap.user ? "cloud:" + snap.user.uid : snap.mode || "";
  if (k !== autoKey && snap.ready) { autoKey = k; loadAuto(); }
}

function lastAt() {
  const set = (snap && snap.settings) || {};
  return B.lastBackupAt(set, autoList || [{ created: BK.cachedAutoAt() }]);
}

function renderStatus() {
  const last = lastAt();
  const el = root.querySelector("#bk-last");
  const t = last ? `${B.agoText(last)} (${fmtTs(last)})` : "noch nie 🙈";
  if (el.textContent !== t) el.textContent = t;
  root.querySelector("#bk-status").classList.toggle("warn", B.needsReminder(last));
}

/* ---------- Jetzt sichern ---------- */

async function onSave() {
  const btn = root.querySelector("#bk-save");
  const enc = root.querySelector("#bk-enc").checked;
  const p1 = root.querySelector("#bk-pw1").value, p2 = root.querySelector("#bk-pw2").value;
  if (enc) {
    if (p1.length < 8) { ctx.ui.toast("🔒 Das Passwort braucht mindestens 8 Zeichen."); root.querySelector("#bk-pw1").focus(); return; }
    if (p1 !== p2) { ctx.ui.toast("🙈 Die Passwörter sind nicht gleich."); root.querySelector("#bk-pw2").focus(); return; }
  }
  ctx.ui.setBusy(btn, true, enc ? "🔒 Verschlüssle …" : "📦 Packe ein …");
  try {
    const backup = await BK.makeBackup("manual");
    // L2 (Audit 2): unverschlüsselt ohne geheime Kalender-Abo-Links und ohne Geld-Sperre (PIN-Hash)
    if (!enc && backup.meta) { delete backup.meta.ical_feeds; delete backup.meta.money_lock; }
    const r = await BK.saveFile(backup, { password: enc ? p1 : "" });
    await BK.noteManual(backup.created);
    root.querySelector("#bk-pw1").value = ""; root.querySelector("#bk-pw2").value = "";
    ctx.ui.toast(`💾 Gesichert: ${B.totalDocs(backup)} Einträge (${B.sizeText(r.size)}) – gut gemacht!`, 3200);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error("Backup:", err);
    ctx.ui.toast("😕 Backup ging nicht: " + (err && err.message ? err.message : "unbekannter Fehler"));
  } finally {
    ctx.ui.setBusy(btn, false);
  }
}

/* ---------- Datei wählen ---------- */

async function onFile(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  if (f.size > 200 * 1024 * 1024) { ctx.ui.toast("Die Datei ist zu groß für ein Backup."); return; }
  let parsed;
  try { parsed = BK.parseFile(await f.text()); } catch (err) { ctx.ui.toast("🤔 " + err.message, 3500); return; }
  if (parsed.encrypted) askPassword(parsed, f.name);
  else openPreview(parsed, "", { label: f.name });
}

function askPassword(parsed, name) {
  ctx.ui.openSheet({
    title: "🔒 Verschlüsseltes Backup",
    bodyHTML: `<div class="bk-sheet stack">
      <p>„${esc(name)}“ ist mit einem Passwort geschützt.</p>
      <label>Passwort<input type="password" id="bkx-pw" autocomplete="current-password"></label>
      <p class="bkx-err note" role="alert" hidden></p>
      <div class="row"><button type="button" class="btn primary" id="bkx-open">🔓 Öffnen</button></div>
    </div>`,
    onMount(el, close) {
      const pw = el.querySelector("#bkx-pw");
      const btn = el.querySelector("#bkx-open");
      const go = async () => {
        ctx.ui.setBusy(btn, true, "🔓 Entschlüssle …");
        try {
          const res = await BK.openParsed(parsed, pw.value);
          close();
          showPreview(res, { label: name, encrypted: true });
        } catch (err) {
          const e = el.querySelector(".bkx-err");
          e.hidden = false;
          e.textContent = "🙈 " + (err && err.message ? err.message : "Öffnen fehlgeschlagen.");
          pw.select();
        } finally { ctx.ui.setBusy(btn, false); }
      };
      btn.addEventListener("click", go);
      pw.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      setTimeout(() => pw.focus(), 50);
    },
  });
}

async function openPreview(parsed, password, info) {
  try { showPreview(await BK.openParsed(parsed, password), info); }
  catch (err) { ctx.ui.toast("🤔 " + (err && err.message ? err.message : "Backup unlesbar."), 3500); }
}

/* ---------- Vorschau & Zurückspielen ---------- */

function showPreview(res, info = {}) {
  const { backup, ignored, vaultSkipped } = res;
  const secs = B.sectionCounts(backup);
  const total = B.totalDocs(backup);
  const src = backup.source === "auto" ? "🌙 automatisch" : backup.source === "safety" ? "🛟 Sicherheitskopie" : "✋ von dir";
  ctx.ui.openSheet({
    title: "📂 Backup ansehen",
    bodyHTML: `<div class="bk-sheet">
      <div class="bk-meta"><b>${esc(info.label || "Backup")}</b><span>${esc(fmtTs(backup.created))} · ${src}${backup.app ? " · Version " + esc(backup.app) : ""}</span></div>
      ${secs.length ? `<ul class="bk-secs">${secs.map((s) => `<li><span aria-hidden="true">${s.emoji}</span><span>${esc(s.label)}</span><b>${s.n}</b></li>`).join("")}</ul>`
        : `<p class="note">Dieses Backup ist leer 🫙</p>`}
      ${vaultSkipped ? `<p class="note">🗝️ Tresor-Daten in der Datei werden aus Sicherheitsgründen ignoriert.</p>` : ""}
      ${ignored.filter((n) => !B.isVaultName(n)).length ? `<p class="note">🧩 ${ignored.filter((n) => !B.isVaultName(n)).length} unbekannte Bereiche werden übersprungen.</p>` : ""}
      <fieldset class="bk-modes" ${total ? "" : "disabled"}>
        <legend>Wie zurückspielen?</legend>
        <label class="bk-mode"><input type="radio" name="bk-mode" value="merge" checked><span><b>🤝 Zusammenführen</b><small>Fehlendes kommt dazu, bei doppelten gewinnt der neuere Stand. Nichts wird gelöscht. (empfohlen)</small></span></label>
        <label class="bk-mode"><input type="radio" name="bk-mode" value="replace"><span><b>♻️ Ersetzen</b><small>Dein Stand wird genau wie im Backup – was dort fehlt, wird gelöscht. Vorher laden wir automatisch eine Sicherheitskopie herunter.</small></span></label>
      </fieldset>
      <div class="bk-confirm" hidden>
        <p>⚠️ <b>Wirklich ersetzen?</b> Einträge, die nach dem ${esc(fmtTs(backup.created))} dazugekommen sind, sind danach weg (außer in der Sicherheitskopie).</p>
        <label class="switch"><input type="checkbox" id="bk-sure"><span>Ja, ich hab's verstanden</span></label>
      </div>
      <p class="bk-res note" role="status" hidden></p>
      <div class="row"><button type="button" class="btn primary" id="bk-apply" ${total ? "" : "disabled"}>🤝 Zusammenführen</button></div>
    </div>`,
    onMount(el, close) {
      const btn = el.querySelector("#bk-apply");
      const conf = el.querySelector(".bk-confirm");
      const sure = el.querySelector("#bk-sure");
      const mode = () => el.querySelector('input[name="bk-mode"]:checked').value;
      const sync = () => {
        const r = mode() === "replace";
        conf.hidden = !r;
        btn.textContent = r ? "♻️ Ersetzen" : "🤝 Zusammenführen";
        btn.classList.toggle("danger", r);
        btn.classList.toggle("primary", !r);
        btn.disabled = !total || (r && !sure.checked);
      };
      el.querySelectorAll('input[name="bk-mode"]').forEach((r) => r.addEventListener("change", sync));
      sure.addEventListener("change", sync);
      sync();
      btn.addEventListener("click", async () => {
        const m = mode();
        if (m === "replace" && !sure.checked) return;
        ctx.ui.setBusy(btn, true, m === "replace" ? "🛟 Sicherheitskopie …" : "🤝 Führe zusammen …");
        try {
          if (m === "replace") {
            const safety = await BK.makeBackup("safety");
            await BK.saveFile(safety);
            btn.textContent = "♻️ Ersetze …";
          }
          const st = await BK.restore(backup, m);
          const msg = m === "replace"
            ? `♻️ Fertig: ${st.add + st.update} geschrieben, ${st.del} gelöscht.`
            : `🤝 Fertig: ${st.add} neu, ${st.update} aktualisiert, ${st.keep} unverändert.`;
          if (store().mode !== "cloud") { ctx.ui.toast(msg + " Lade neu …", 2500); setTimeout(() => location.reload(), 900); return; }
          close();
          ctx.ui.toast(msg, 4000);
        } catch (err) {
          if (err && err.name === "AbortError") { ctx.ui.toast("Abgebrochen – ohne Sicherheitskopie wird nichts ersetzt."); return; }
          console.error("Wiederherstellen:", err);
          const r = el.querySelector(".bk-res");
          r.hidden = false;
          r.textContent = "😕 Das ging schief: " + (err && err.message ? err.message : "unbekannter Fehler");
        } finally { if (document.contains(btn)) { ctx.ui.setBusy(btn, false); sync(); } }
      });
    },
  });
}

function store() { return (ctx.store && ctx.store.get && ctx.store.get()) || {}; }

/* ---------- Automatische Backups ---------- */

async function loadAuto() {
  const box = root.querySelector("#bk-auto");
  if (!BK.autoAvailable()) {
    autoList = [];
    box.innerHTML = `<p class="note">Mit Google-Konto sichert der Server jeden Sonntag in der Nacht automatisch – die letzten ${B.KEEP_AUTO} bleiben. Im Nur-dieses-Gerät-Modus bitte ab und zu selbst sichern 🙂</p>`;
    renderStatus();
    return;
  }
  box.innerHTML = `<p class="note">Lade …</p>`;
  try { autoList = await BK.listAuto(); autoErr = ""; }
  catch (err) { console.warn("Automatische Backups:", err); autoList = null; autoErr = "Konnte die automatischen Backups gerade nicht laden."; }
  renderAuto();
  renderStatus();
}

function renderAuto() {
  const box = root.querySelector("#bk-auto");
  const head = `<p class="note">Jeden Sonntag in der Nacht sichert der Server automatisch (ohne Tresor). Die letzten ${B.KEEP_AUTO} bleiben.</p>`;
  if (autoErr) { box.innerHTML = head + `<p class="note">😕 ${esc(autoErr)} <button type="button" class="btn ghost sm" data-bk="reload">Nochmal</button></p>`; return; }
  if (!autoList || !autoList.length) { box.innerHTML = head + `<p class="note bk-none">Noch keins da – das erste kommt am nächsten Sonntag 🌙</p>`; return; }
  box.innerHTML = head + `<ul class="bk-autos">${autoList.map((a, i) => `<li>
      <span class="bk-ad"><b>${esc(fmtDay(a.date))}</b><small>${esc(B.sizeText(a.size))}${a.counts ? " · " + Object.values(a.counts).reduce((x, y) => x + (Number(y) || 0), 0) + " Einträge" : ""}</small></span>
      <button type="button" class="btn ghost sm" data-bk="dl" data-i="${i}" aria-label="Backup vom ${esc(fmtDay(a.date))} herunterladen">⬇️ Laden</button>
      <button type="button" class="btn ghost sm" data-bk="restore" data-i="${i}" aria-label="Backup vom ${esc(fmtDay(a.date))} zurückspielen">↩️ Zurück</button>
    </li>`).join("")}</ul>`;
}

async function onAutoClick(ev) {
  const b = ev.target.closest("[data-bk]");
  if (!b) return;
  if (b.dataset.bk === "reload") { loadAuto(); return; }
  const a = autoList && autoList[Number(b.dataset.i)];
  if (!a) return;
  ctx.ui.setBusy(b, true, "⏳");
  try {
    const res = await BK.fetchAuto(a);
    if (b.dataset.bk === "dl") {
      const r = await BK.saveFile(res.backup);
      ctx.ui.toast(`⬇️ Backup vom ${fmtDay(a.date)} gespeichert (${B.sizeText(r.size)}).`);
    } else showPreview(res, { label: `Automatisches Backup vom ${fmtDay(a.date)}` });
  } catch (err) {
    if (!(err && err.name === "AbortError")) { console.error(err); ctx.ui.toast("😕 " + (err && err.message ? err.message : "Laden fehlgeschlagen.")); }
  } finally { ctx.ui.setBusy(b, false); }
}
