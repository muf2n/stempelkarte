// Schule → 🧠 Mindmaps: Liste, Editor (Vollbild, Ziehen/Zoomen), Lernmodus, Bild speichern, Mit Claude erstellen.
// Daten: Sammlung school_mindmaps ({ id, title, subject, nodes, updated }). Logik: mindmap-core.js.
import { col, safeWrite, esc, dot, subjectColor, subjectInputHTML, wireSubjectChips, armDelete, emptyHTML } from "./school-core.js";
import { newId } from "./db.js";
import { askClaude, aiAvailable } from "./ai-client.js";
import { shrinkImage } from "./unterwegs-shared.js";
import * as M from "./mindmap-core.js";

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const fmtD = (ts) => { const d = new Date(ts || 0); return ts ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}` : ""; };

/* ---------- Liste (Reiter) ---------- */
export function renderMindmaps(body, S) {
  const maps = (S.data.mindmaps || []).slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  body.innerHTML = `<div class="ss-grid">
    <section class="card ss-card mm-intro"><div class="ss-h-row"><h3 class="ss-h">🧠 Mindmaps <span class="ss-count">${maps.length}</span></h3></div>
      <p class="note">Stoff als Mindmap ordnen – und im <b>Lernmodus</b> verdeckt abfragen: Punkt antippen, aufdecken, merken.</p>
      <div class="row mm-actions"><button type="button" class="btn primary sm" data-act="mm-new">+ Neue Mindmap</button>
        <button type="button" class="btn sm" data-act="mm-ai">🤖 Von Claude erstellen</button></div></section>
    ${maps.length ? `<ul class="mm-list">${maps.map((m) => `<li><button type="button" class="mm-item" data-mm="${esc(m.id)}" style="--c:${esc(subjectColor(S.data, m.subject))}">
        <span class="mm-ic" aria-hidden="true">🧠</span><span class="mm-tx"><b>${esc(m.title || "Mindmap")}</b>
        <small>${m.subject ? `${dot(subjectColor(S.data, m.subject))}${esc(m.subject)} · ` : ""}${Math.max(0, (m.nodes || []).length - 1)} Punkte · ${fmtD(m.updated)}</small></span><span aria-hidden="true">›</span></button></li>`).join("")}</ul>`
      : emptyHTML("🧠", "Noch keine Mindmap", "Leg eine an – z. B. „Ohmsches Gesetz“ mit Formel, Einheiten und Beispielen – oder lass Claude eine vorschlagen.", "", "")}
  </div>`;
  body.querySelector("[data-act=mm-new]").addEventListener("click", () => newSheet(S));
  body.querySelector("[data-act=mm-ai]").addEventListener("click", () => aiSheet(S));
  body.querySelectorAll("[data-mm]").forEach((b) => b.addEventListener("click", () => {
    const m = (S.data.mindmaps || []).find((x) => x.id === b.dataset.mm); if (m) openEditor(S, m);
  }));
}

function newSheet(S) {
  S.ctx.ui.openSheet({ title: "🧠 Neue Mindmap", bodyHTML: `<form class="form" id="mm-f">
      <label>Thema (kommt in die Mitte)<input id="mm-t" maxlength="80" required placeholder="z. B. Ohmsches Gesetz" autocomplete="off"></label>
      ${subjectInputHTML(S.data, "mm-s")}
      <div class="row"><button class="btn primary" type="submit">Anlegen</button></div></form>`,
    onMount(el, close) {
      wireSubjectChips(el); const t = el.querySelector("#mm-t"); setTimeout(() => t.focus(), 50);
      el.querySelector("#mm-f").addEventListener("submit", (e) => {
        e.preventDefault(); if (!t.value.trim()) return;
        const m = { id: newId(), ...M.newMap(t.value, el.querySelector("#mm-s").value), updated: Date.now() };
        safeWrite(col("mindmaps").put(m)); close(); openEditor(S, m, { select: "root" });
      });
    } });
}

function aiSheet(S) {
  const ui = S.ctx.ui;
  if (!aiAvailable()) { ui.toast("🤖 Geht mit der Google-Anmeldung und dem Claude-Server.", 3600); return; }
  let photo = null;
  ui.openSheet({ title: "🤖 Mindmap von Claude", bodyHTML: `<form class="form" id="mm-af">
      <label>Thema oder Stoff<textarea id="mm-at" rows="3" maxlength="1500" placeholder="z. B. Drehstrom: Stern- und Dreieckschaltung"></textarea></label>
      ${subjectInputHTML(S.data, "mm-as")}
      <div class="row"><button type="button" class="btn sm" id="mm-ap">📷 Foto vom Heft/Buch dazu</button><span class="note" id="mm-apn"></span></div>
      <p class="note">Claude macht daraus Stichworte in Ästen. Kontrollier den Inhalt – auch eine KI kann sich irren.</p>
      <div class="row"><button class="btn primary" type="submit" id="mm-ago">Erstellen</button></div></form>`,
    onMount(el, close) {
      wireSubjectChips(el);
      el.querySelector("#mm-ap").addEventListener("click", () => {
        const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
        inp.addEventListener("change", async () => {
          try { photo = await shrinkImage(inp.files[0], { maxSide: 1600, maxBytes: 800 * 1024, quality: 0.85 }); el.querySelector("#mm-apn").textContent = "✓ Foto dabei"; }
          catch (e) { ui.toast(e.message || "Foto geht nicht."); }
        }, { once: true }); inp.click();
      });
      el.querySelector("#mm-af").addEventListener("submit", async (e) => {
        e.preventDefault();
        const topic = el.querySelector("#mm-at").value.trim(), subject = el.querySelector("#mm-as").value.trim();
        if (!topic && !photo) { ui.toast("Bitte ein Thema eingeben oder ein Foto wählen."); return; }
        const go = el.querySelector("#mm-ago"); go.disabled = true; go.textContent = "Claude denkt nach … (ca. 15–40 s)";
        try {
          const msg = `${subject ? `Fach: ${subject}\n` : ""}Mindmap zu: ${topic || "dem Stoff auf dem Foto"}`;
          const out = await askClaude([{ role: "user", content: msg }], { body: { mode: "mindmap", ...(photo ? { image: { type: "image/jpeg", data: photo.data.replace(/^data:[^,]*,/, "") } } : {}) }, timeoutMs: 120000 });
          const r = M.fromAI(out.reply);
          if (!r) { ui.toast("Claude hat keine brauchbare Mindmap geliefert – bitte nochmal versuchen.", 3600); go.disabled = false; go.textContent = "Erstellen"; return; }
          const m = { id: newId(), title: r.title, subject, nodes: r.nodes, updated: Date.now() };
          safeWrite(col("mindmaps").put(m)); close(); openEditor(S, m);
        } catch (err) { ui.toast(err.message || "Hat nicht geklappt.", 3600); go.disabled = false; go.textContent = "Erstellen"; }
      });
    } });
}

/* ---------- Editor ---------- */
let mctx = null;
const tw = (t, px, w = 600) => { if (!mctx) mctx = document.createElement("canvas").getContext("2d"); mctx.font = `${w} ${px}px ${FONT}`; return mctx.measureText(t).width; };
const FS = (d) => (d === 0 ? 17 : d === 1 ? 15 : 13.5);
function measure(t, d) {
  const px = FS(d), wt = d === 0 ? 800 : d === 1 ? 700 : 500, max = d === 0 ? 200 : 170;
  const lines = M.wrap(t, max, (x) => tw(x, px, wt));
  const w = Math.max(...lines.map((l) => tw(l, px, wt))) + (d === 0 ? 34 : 24), lh = px * 1.3;
  return { w: Math.max(d === 0 ? 90 : 44, Math.ceil(w)), h: Math.ceil(lines.length * lh + (d === 0 ? 22 : 14)), lines, px, wt, lh };
}

export function openEditor(S, map, { select = null } = {}) {
  const ui = S.ctx.ui;
  let nodes = M.normalize(map).nodes, sel = select, learn = false, revealed = new Set(), editing = null;
  let tx = 0, ty = 0, k = 1, fitted = false, saveT = 0, dirty = false;
  const ov = document.createElement("div");
  ov.className = "mm-ed"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Mindmap bearbeiten");
  ov.innerHTML = `<header class="mm-top">
      <button type="button" class="mm-b" data-x="close" aria-label="Zurück">←</button>
      <b class="mm-title"></b>
      <button type="button" class="mm-b" data-x="learn" aria-pressed="false" title="Lernmodus">🙈</button>
      <button type="button" class="mm-b" data-x="png" title="Als Bild speichern" aria-label="Als Bild speichern">⤓</button>
      <button type="button" class="mm-b" data-x="more" aria-label="Mehr">⋯</button></header>
    <div class="mm-learnbar" hidden><span data-k="prog"></span><button type="button" class="btn sm" data-x="showall">Alle zeigen</button><button type="button" class="btn sm" data-x="hideall">Neu verdecken</button></div>
    <svg class="mm-svg" role="img" aria-label="Mindmap"><g class="mm-world"></g></svg>
    <div class="mm-zoom"><button type="button" class="mm-b" data-x="zin" aria-label="Vergrößern">＋</button><button type="button" class="mm-b" data-x="zout" aria-label="Verkleinern">－</button><button type="button" class="mm-b" data-x="fit" aria-label="Alles zeigen">⊙</button></div>
    <div class="mm-bar" hidden>
      <button type="button" data-x="child"><b>＋</b><small>Unterpunkt</small></button>
      <button type="button" data-x="sib"><b>＋</b><small>Daneben</small></button>
      <button type="button" data-x="edit"><b>✏️</b><small>Text</small></button>
      <button type="button" data-x="color"><b>🎨</b><small>Farbe</small></button>
      <button type="button" data-x="up"><b>▲</b><small>Hoch</small></button>
      <button type="button" data-x="down"><b>▼</b><small>Runter</small></button>
      <button type="button" data-x="del" class="mm-del"><b>🗑</b><small>Löschen</small></button></div>
    <form class="mm-edit" hidden><input maxlength="${M.MAX_TEXT}" aria-label="Text" enterkeyhint="done" autocomplete="off"><button type="submit" class="btn primary sm">✓</button></form>
    <div class="mm-colors" hidden>${M.MM_COLORS.map((c) => `<button type="button" data-c="${c}" style="background:${c}" aria-label="Farbe ${c}"></button>`).join("")}</div>`;
  document.body.appendChild(ov); document.documentElement.classList.add("mm-open");
  const svg = ov.querySelector(".mm-svg"), world = ov.querySelector(".mm-world"), bar = ov.querySelector(".mm-bar"), edit = ov.querySelector(".mm-edit"), inp = edit.querySelector("input"), colors = ov.querySelector(".mm-colors");
  let pos = new Map();

  const save = (now = false) => {
    dirty = true; clearTimeout(saveT);
    const run = () => { if (!dirty) return; dirty = false; map = { ...map, nodes, title: nodes[0].t.slice(0, 80), updated: Date.now() }; safeWrite(col("mindmaps").put(map)); };
    if (now) run(); else saveT = setTimeout(run, 700);
  };
  const apply = () => { world.setAttribute("transform", `translate(${tx},${ty}) scale(${k})`); };
  const fit = () => {
    const b = M.bounds(pos), r = svg.getBoundingClientRect(), pad = 30;
    k = Math.max(0.5, Math.min(1.05, Math.min((r.width - pad * 2) / Math.max(1, b.w), (r.height - pad * 2 - 70) / Math.max(1, b.h)))); // lesbar bleiben – Rest mit dem Finger verschieben
    tx = r.width / 2 - (b.x0 + b.w / 2) * k; ty = (r.height - 70) / 2 - (b.y0 + b.h / 2) * k + 10; apply();
  };
  /** Knoten in den sichtbaren Bereich schieben (über der Werkzeugleiste) */
  const showNode = (id) => {
    const p = pos.get(id); if (!p) return;
    const r = svg.getBoundingClientRect(), m = 24, bottom = r.height - 120;
    const x0 = p.x - p.w / 2 - 30, x1 = p.x + p.w / 2 + 30, y0 = p.y - p.h / 2, y1 = p.y + p.h / 2;
    if (x0 * k + tx < m) tx = m - x0 * k; else if (x1 * k + tx > r.width - m) tx = r.width - m - x1 * k;
    if (y0 * k + ty < m) ty = m - y0 * k; else if (y1 * k + ty > bottom) ty = bottom - y1 * k;
    apply();
  };
  const hidden = (n, d) => learn && d > 0 && !revealed.has(n.id);
  function draw() {
    ov.querySelector(".mm-title").textContent = nodes[0].t;
    pos = M.layout(nodes, measure);
    let links = "", boxes = "";
    for (const n of nodes) {
      const p = pos.get(n.id); if (!p) continue;
      const c = M.colorOf(nodes, n.id), d = p.depth;
      if (n.p != null) {
        const q = pos.get(n.p), sx = q.x + (q.depth === 0 ? p.side * q.w / 2 * 0.85 : p.side * q.w / 2), ex = p.x - p.side * p.w / 2, mx = (sx + ex) / 2;
        links += `<path d="M${sx},${q.y} C${mx},${q.y} ${mx},${p.y} ${ex},${p.y}" stroke="${c}" stroke-width="${d === 1 ? 4 : d === 2 ? 2.6 : 1.8}" fill="none" stroke-linecap="round" opacity=".9"/>`;
      }
      const m = measure(n.t, d), hid = hidden(n, d), x0 = p.x - p.w / 2, y0 = p.y - p.h / 2;
      const fill = d === 0 ? "var(--mm-root)" : d === 1 ? c : "var(--mm-node)", stroke = d === 0 ? "var(--mm-root)" : c, txtc = d <= 1 ? "#fff" : "var(--mm-text)";
      const ty0 = p.y - (m.lines.length - 1) * m.lh / 2;
      const text = hid ? `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central" font-size="18">❓</text>`
        : m.lines.map((l, i) => `<text x="${p.x}" y="${ty0 + i * m.lh}" text-anchor="middle" dominant-baseline="central" font-size="${m.px}" font-weight="${m.wt}" fill="${txtc}">${esc(l)}</text>`).join("");
      const kc = M.kids(nodes, n.id).length;
      const foldBtn = kc && d > 0 ? `<g class="mm-fold" data-fold="${esc(n.id)}"><circle cx="${p.x + p.side * (p.w / 2 + 11)}" cy="${p.y}" r="10" fill="var(--mm-bg)" stroke="${c}" stroke-width="2"/><text x="${p.x + p.side * (p.w / 2 + 11)}" y="${p.y}" text-anchor="middle" dominant-baseline="central" font-size="${n.fold ? 10 : 13}" font-weight="800" fill="${c}">${n.fold ? kc : "–"}</text></g>` : "";
      boxes += `<g class="mm-n${sel === n.id ? " sel" : ""}${hid ? " hid" : ""}" data-n="${esc(n.id)}"><rect x="${x0}" y="${y0}" width="${p.w}" height="${p.h}" rx="${d === 0 ? 18 : 11}" fill="${hid ? "var(--mm-hid)" : fill}" stroke="${stroke}" stroke-width="${sel === n.id ? 3.5 : 2}"${hid ? ' stroke-dasharray="5 4"' : ""}/>${text}</g>${foldBtn}`;
    }
    world.innerHTML = links + boxes;
    bar.hidden = !sel || learn || !!editing;
    if (sel) {
      const n = M.nodeOf(nodes, sel), isRoot = n && n.p == null, d = isRoot ? 0 : M.depthOf(nodes, sel);
      bar.querySelector("[data-x=sib]").disabled = isRoot; bar.querySelector("[data-x=del]").disabled = isRoot;
      bar.querySelector("[data-x=up]").disabled = isRoot; bar.querySelector("[data-x=down]").disabled = isRoot;
      bar.querySelector("[data-x=color]").disabled = d !== 1;
    }
    if (learn) {
      const all = nodes.length - 1, seen = nodes.filter((n) => n.p != null && revealed.has(n.id)).length;
      ov.querySelector("[data-k=prog]").textContent = all ? `🙈 ${seen}/${all} aufgedeckt${seen === all ? " – super! 🎉" : ""}` : "Noch keine Punkte";
    }
    if (!fitted) { fitted = true; requestAnimationFrame(fit); }
  }
  const startEdit = (id, fresh = false) => {
    const n = M.nodeOf(nodes, id); if (!n) return;
    editing = id; sel = id; inp.value = fresh ? "" : n.t; inp.placeholder = fresh ? "Neuer Punkt" : ""; edit.hidden = false; colors.hidden = true; draw(); showNode(id);
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  };
  const endEdit = () => {
    if (!editing) return;
    const id = editing; editing = null; edit.hidden = true;
    if (inp.value.trim()) { nodes = M.setText(nodes, id, inp.value); save(); }
    else if (M.nodeOf(nodes, id) && M.nodeOf(nodes, id).t === "Neuer Punkt") { nodes = M.removeNode(nodes, id); sel = M.nodeOf(nodes, id) ? id : null; save(); } // leer gelassen → wieder weg
    draw();
  };
  edit.addEventListener("submit", (e) => { e.preventDefault(); inp.blur(); });
  inp.addEventListener("blur", () => setTimeout(endEdit, 0));
  inp.addEventListener("keydown", (e) => { if (e.key === "Escape") { inp.value = ""; editing = null; edit.hidden = true; draw(); } });

  /* Ziehen, Zoomen, Tippen */
  const pts = new Map(); let moved = 0, pinch0 = null, lastTap = { id: null, t: 0 }, downT = null;
  const zoomAt = (f, cx, cy) => { const nk = Math.max(0.2, Math.min(3, k * f)); tx = cx - (cx - tx) * (nk / k); ty = cy - (cy - ty) * (nk / k); k = nk; apply(); };
  svg.addEventListener("pointerdown", (e) => { downT = e.target; try { svg.setPointerCapture(e.pointerId); } catch { /* egal */ } pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), k }; } });
  svg.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 1) { moved += Math.abs(dx) + Math.abs(dy); tx += dx; ty += dy; apply(); }
    else if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()], r = svg.getBoundingClientRect(); moved = 99; zoomAt((pinch0.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d) / k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); }
  });
  const up = (e) => {
    const was = pts.has(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null;
    if (!was || moved > 8 || pts.size) return;
    const tg = downT || e.target; // mit Pointer-Capture zeigt e.target sonst aufs SVG
    const fb = tg.closest && tg.closest("[data-fold]");
    if (fb) { nodes = M.toggleFold(nodes, fb.dataset.fold); save(); draw(); return; }
    const g = tg.closest && tg.closest("[data-n]"); colors.hidden = true;
    if (!g) { if (editing) inp.blur(); sel = null; draw(); return; }
    const id = g.dataset.n;
    if (learn) { if (!revealed.has(id)) { revealed.add(id); draw(); } return; }
    const now = Date.now();
    if (lastTap.id === id && now - lastTap.t < 350) { startEdit(id); lastTap = { id: null, t: 0 }; return; }
    lastTap = { id, t: now }; sel = id; draw();
  };
  svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", (e) => { pts.delete(e.pointerId); pinch0 = null; });
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, { passive: false });

  const close = () => { save(true); clearTimeout(saveT); ov.remove(); document.documentElement.classList.remove("mm-open"); window.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape" && !editing) close(); };
  window.addEventListener("keydown", onKey);

  ov.addEventListener("click", (e) => {
    const b = e.target.closest("[data-x],[data-c]"); if (!b || b.disabled) return;
    if (b.dataset.c) { nodes = M.setColor(nodes, sel, b.dataset.c); colors.hidden = true; save(); draw(); return; }
    const x = b.dataset.x;
    if (x === "close") return close();
    if (x === "zin" || x === "zout") { const r = svg.getBoundingClientRect(); return zoomAt(x === "zin" ? 1.25 : 0.8, r.width / 2, r.height / 2); }
    if (x === "fit") return fit();
    if (x === "learn") { learn = !learn; revealed = new Set(); sel = null; b.setAttribute("aria-pressed", String(learn)); ov.querySelector(".mm-learnbar").hidden = !learn; requestAnimationFrame(fit); if (learn) ui.toast("🙈 Lernmodus: Überleg dir, was dasteht – dann antippen zum Aufdecken.", 2600); return draw(); }
    if (x === "showall") { nodes.forEach((n) => revealed.add(n.id)); return draw(); }
    if (x === "hideall") { revealed = new Set(); return draw(); }
    if (x === "png") return exportPng(nodes, pos, nodes[0].t).catch(() => ui.toast("Bild speichern hat nicht geklappt."));
    if (x === "more") return moreSheet();
    if (!sel) return;
    if (x === "child" || x === "sib") { const r = (x === "child" ? M.addChild : M.addSibling)(nodes, sel); if (!r.id) { ui.toast(`Höchstens ${M.MAX_NODES} Punkte.`); return; } nodes = r.nodes; save(); startEdit(r.id, true); return; }
    if (x === "edit") return startEdit(sel);
    if (x === "color") { colors.hidden = !colors.hidden; return; }
    if (x === "up" || x === "down") { nodes = M.moveSibling(nodes, sel, x === "up" ? -1 : 1); save(); return draw(); }
    if (x === "del") {
      if (!b.dataset.armed) { const n = M.subtreeIds(nodes, sel).length; b.dataset.armed = "1"; b.querySelector("small").textContent = n > 1 ? `${n} weg?` : "Sicher?"; setTimeout(() => { delete b.dataset.armed; b.querySelector("small").textContent = "Löschen"; }, 3500); return; }
      delete b.dataset.armed; b.querySelector("small").textContent = "Löschen";
      const p = M.nodeOf(nodes, sel).p; nodes = M.removeNode(nodes, sel); sel = p; save(); draw();
    }
  });

  function moreSheet() {
    ui.openSheet({ title: "🧠 " + nodes[0].t, bodyHTML: `<div class="form">
        <button type="button" class="btn" id="mm-copy">📋 Als Text kopieren (Gliederung)</button>
        <button type="button" class="btn" id="mm-fold">↔ Alle Äste ${nodes.some((n) => n.fold) ? "aufklappen" : "zuklappen"}</button>
        <button type="button" class="btn danger" id="mm-delmap">🗑 Mindmap löschen</button></div>`,
      onMount(el, closeS) {
        el.querySelector("#mm-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(M.outline(nodes)); ui.toast("📋 Kopiert"); } catch { ui.toast("Kopieren geht hier nicht."); } closeS(); });
        el.querySelector("#mm-fold").addEventListener("click", () => { const any = nodes.some((n) => n.fold); nodes = nodes.map((n) => (n.p != null && M.depthOf(nodes, n.id) === 1 && M.kids(nodes, n.id).length ? { ...n, fold: !any } : { ...n, fold: false })); save(); fitted = false; draw(); closeS(); });
        armDelete(el.querySelector("#mm-delmap"), () => { clearTimeout(saveT); dirty = false; safeWrite(col("mindmaps").remove(map.id)); closeS(); ov.remove(); document.documentElement.classList.remove("mm-open"); window.removeEventListener("keydown", onKey); ui.toast("🗑 Mindmap gelöscht"); });
      } });
  }
  draw();
  if (sel === "root" && nodes.length === 1) ui.toast("Tipp auf die Mitte → „＋ Unterpunkt“ für den ersten Ast.", 3000);
}

/* ---------- Als Bild speichern (PNG, helles Design) ---------- */
async function exportPng(nodes, pos, title) {
  const b = M.bounds(pos), pad = 40, W = Math.ceil(b.w + pad * 2), H = Math.ceil(b.h + pad * 2), sc = 2;
  let body = "";
  for (const n of nodes) {
    const p = pos.get(n.id); if (!p) continue;
    const c = M.colorOf(nodes, n.id), d = p.depth;
    if (n.p != null) { const q = pos.get(n.p), sx = q.x + (q.depth === 0 ? p.side * q.w / 2 * 0.85 : p.side * q.w / 2), ex = p.x - p.side * p.w / 2, mx = (sx + ex) / 2; body += `<path d="M${sx},${q.y} C${mx},${q.y} ${mx},${p.y} ${ex},${p.y}" stroke="${c}" stroke-width="${d === 1 ? 4 : d === 2 ? 2.6 : 1.8}" fill="none" stroke-linecap="round"/>`; }
  }
  for (const n of nodes) {
    const p = pos.get(n.id); if (!p) continue;
    const c = M.colorOf(nodes, n.id), d = p.depth, m = measure(n.t, d), y0 = p.y - (m.lines.length - 1) * m.lh / 2;
    body += `<rect x="${p.x - p.w / 2}" y="${p.y - p.h / 2}" width="${p.w}" height="${p.h}" rx="${d === 0 ? 18 : 11}" fill="${d === 0 ? "#1e293b" : d === 1 ? c : "#fff"}" stroke="${d === 0 ? "#1e293b" : c}" stroke-width="2"/>`
      + m.lines.map((l, i) => `<text x="${p.x}" y="${y0 + i * m.lh}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="${m.px}" font-weight="${m.wt}" fill="${d <= 1 ? "#fff" : "#0f172a"}">${esc(l)}</text>`).join("");
  }
  const src = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * sc}" height="${H * sc}" viewBox="${b.x0 - pad} ${b.y0 - pad} ${W} ${H}"><rect x="${b.x0 - pad}" y="${b.y0 - pad}" width="${W}" height="${H}" fill="#f8fafc"/>${body}</svg>`;
  const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
  await img.decode();
  const cv = document.createElement("canvas"); cv.width = W * sc; cv.height = H * sc; cv.getContext("2d").drawImage(img, 0, 0);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `Mindmap ${String(title).replace(/[\\/:*?"<>|]/g, "").slice(0, 60)}.png`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
