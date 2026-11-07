// Alltag › Japanisch › ✍️ Schreiben: Kana nachspuren (blasse Vorlage) oder frei schreiben, selbst prüfen,
// optional „📷 Von Claude prüfen lassen“ (Canvas → JPEG → /chat mit image, Modus "sensei").
import { kanaList } from "./jp-core.js";
import { askClaude, aiAvailable } from "./ai-client.js";
import { md } from "./jp-sensei.js";

const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
const OPT_KEY = "sk-jp-write";
const JP_FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic","Meiryo",sans-serif';

/** Striche (in 0..1-Koordinaten) als JPEG-Base64 (ohne Präfix) – schwarz auf weiß, ohne Vorlage. */
export function strokesToJpeg(strokes, size = 512) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, size, size);
  g.strokeStyle = "#111111"; g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = size * 0.035;
  for (const s of strokes) {
    if (!s.length) continue;
    g.beginPath(); g.moveTo(s[0][0] * size, s[0][1] * size);
    if (s.length === 1) g.lineTo(s[0][0] * size + 0.1, s[0][1] * size + 0.1);
    for (const p of s.slice(1)) g.lineTo(p[0] * size, p[1] * size);
    g.stroke();
  }
  return c.toDataURL("image/jpeg", 0.85).replace(/^data:[^,]*,/, "");
}

export function createWrite(J) {
  const { esc, ui } = J;
  let page = null;
  const saved = lsGet(OPT_KEY) || {};
  const opt = {
    script: saved.script === "kata" ? "kata" : "hira",
    group: ["basis", "daku", "yoon"].includes(saved.group) ? saved.group : "basis",
    guide: saved.guide !== false,
  };
  let idx = Number(saved.idx) || 0;
  let strokes = [];
  let revealed = false;
  let ai = { busy: false, reply: "", err: "", usage: null };
  let canvas = null, g = null, drawing = null, ro = null;

  const list = () => kanaList(opt.script, [opt.group]);
  const curK = () => { const l = list(); return l[((idx % l.length) + l.length) % l.length]; };
  const save = () => lsSet(OPT_KEY, { ...opt, idx });

  function cssVar(n, fb) { try { return getComputedStyle(page || document.documentElement).getPropertyValue(n).trim() || fb; } catch { return fb; } }

  function draw() {
    if (!canvas || !g) return;
    const w = canvas.clientWidth || 300;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, w);
    const ink = cssVar("--ink", "#141A33"), line = cssVar("--line", "#DADFEE"), acc = cssVar("--accent", "#4F46E5");
    // Hilfslinien (Kreuz, gestrichelt)
    g.save(); g.strokeStyle = line; g.lineWidth = 1; g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(w / 2, 8); g.lineTo(w / 2, w - 8); g.moveTo(8, w / 2); g.lineTo(w - 8, w / 2); g.stroke(); g.restore();
    const k = curK();
    if (opt.guide || revealed) {
      g.save();
      g.globalAlpha = revealed ? 0.35 : 0.13;
      g.fillStyle = revealed ? acc : ink;
      const fs = k.kana.length > 1 ? w * 0.5 : w * 0.78;
      g.font = `${fs}px ${JP_FONT}`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(k.kana, w / 2, w / 2 + fs * 0.04);
      g.restore();
    }
    g.strokeStyle = ink; g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = Math.max(5, w * 0.035);
    for (const s of strokes) {
      if (!s.length) continue;
      g.beginPath(); g.moveTo(s[0][0] * w, s[0][1] * w);
      if (s.length === 1) g.lineTo(s[0][0] * w + 0.1, s[0][1] * w + 0.1);
      for (const p of s.slice(1)) g.lineTo(p[0] * w, p[1] * w);
      g.stroke();
    }
  }

  function pt(ev) {
    const r = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))];
  }
  function onDown(ev) { ev.preventDefault(); try { canvas.setPointerCapture(ev.pointerId); } catch { /* egal */ } drawing = [pt(ev)]; strokes.push(drawing); draw(); }
  function onMove(ev) { if (!drawing) return; ev.preventDefault(); drawing.push(pt(ev)); draw(); }
  function onUp() { if (drawing) { drawing = null; updBtns(); } }

  function updBtns() {
    if (!page) return;
    const has = strokes.length > 0;
    page.querySelectorAll("[data-needs-ink]").forEach((b) => { b.disabled = !has || (b.dataset.k === "ai" && (ai.busy || !aiAvailable())); });
  }

  function html() {
    const k = curK();
    const l = list();
    const aiOk = aiAvailable();
    const fb = ai.busy ? `<div class="jp-ai busy">🎌 Sensei schaut sich deine Schrift an …</div>`
      : ai.err ? `<div class="jp-ai err">⚠️ ${esc(ai.err)}</div>`
      : ai.reply ? `<div class="jp-ai"><div class="jp-ai-h">🎌 Sensei sagt:</div>${md(ai.reply)}${ai.usage ? `<small class="jp-muted">Diesen Monat: ${Number(ai.usage.usd || 0).toFixed(2).replace(".", ",")} $ von ${esc(String(ai.usage.capUsd))} $</small>` : ""}</div>` : "";
    return `<div class="jp-write">` +
      `<div class="jp-card">` +
        `<div class="jp-row jp-wrap">` +
          `<div class="jp-seg" role="group" aria-label="Schrift"><button type="button" data-o="script" data-v="hira" aria-pressed="${opt.script === "hira"}">あ</button><button type="button" data-o="script" data-v="kata" aria-pressed="${opt.script === "kata"}">ア</button></div>` +
          `<div class="jp-seg" role="group" aria-label="Zeichen"><button type="button" data-o="group" data-v="basis" aria-pressed="${opt.group === "basis"}">Grund</button><button type="button" data-o="group" data-v="daku" aria-pressed="${opt.group === "daku"}">゛゜</button><button type="button" data-o="group" data-v="yoon" aria-pressed="${opt.group === "yoon"}">ゃゅょ</button></div>` +
          `<div class="jp-seg" role="group" aria-label="Modus"><button type="button" data-o="guide" data-v="1" aria-pressed="${opt.guide}">👻 Nachspuren</button><button type="button" data-o="guide" data-v="0" aria-pressed="${!opt.guide}">✏️ Frei</button></div>` +
        `</div>` +
        `<div class="jp-wtop">` +
          `<button type="button" class="btn ghost sm" data-k="prev" aria-label="Voriges Zeichen">←</button>` +
          `<div class="jp-wlabel">${opt.guide || revealed ? `<span class="jp-ja">${esc(k.kana)}</span> ` : ""}<b>${esc(k.romaji)}</b> <small class="jp-muted">${(((idx % l.length) + l.length) % l.length) + 1}/${l.length}</small></div>` +
          `<button type="button" class="btn ghost sm" data-k="say" aria-label="Vorlesen">🔊</button>` +
          `<button type="button" class="btn ghost sm" data-k="nextk" aria-label="Nächstes Zeichen">→</button>` +
        `</div>` +
        `<div class="jp-canvaswrap"><canvas class="jp-canvas" aria-label="Schreibfeld für ${esc(k.romaji)}" role="img"></canvas></div>` +
        `<div class="jp-row jp-wrap jp-mt">` +
          `<button type="button" class="btn ghost sm" data-k="undo" data-needs-ink>↩️ Zurück</button>` +
          `<button type="button" class="btn ghost sm" data-k="clear" data-needs-ink>🧹 Löschen</button>` +
          `<span class="jp-grow"></span>` +
          (revealed ? "" : `<button type="button" class="btn ghost sm" data-k="reveal">👁️ Auflösen</button>`) +
        `</div>` +
        (revealed ? `<div class="jp-fb"><div>Passt deins zur Vorlage?</div><div class="jp-row"><button type="button" class="btn ghost sm" data-k="bad">🔁 Nochmal üben</button><button type="button" class="btn primary sm" data-k="good">✅ Passt!</button></div></div>` : "") +
        `<div class="jp-row jp-mt">` +
          `<button type="button" class="btn ghost jp-full" data-k="ai" data-needs-ink ${aiOk ? "" : "disabled"}>📷 Von Claude prüfen lassen</button>` +
        `</div>` +
        (aiOk ? "" : `<p class="jp-muted">Für Claudes Feedback brauchst du die Anmeldung mit Google.</p>`) +
        fb +
      `</div>` +
      `<p class="jp-muted">Tipp: Japanisch schreibt man von oben nach unten und von links nach rechts. Langsam und groß üben 🖌️</p>` +
    `</div>`;
  }

  function render() {
    if (!page) return;
    if (ro) { ro.disconnect(); ro = null; }
    page.innerHTML = html();
    canvas = page.querySelector(".jp-canvas");
    g = canvas.getContext("2d");
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("lostpointercapture", onUp);
    if (typeof ResizeObserver === "function") { ro = new ResizeObserver(() => draw()); ro.observe(canvas); }
    draw(); updBtns();
  }

  function go(d) { idx += d; strokes = []; revealed = false; ai = { busy: false, reply: "", err: "", usage: null }; save(); render(); }

  async function askAi() {
    if (!strokes.length || ai.busy) return;
    const k = curK();
    const data = strokesToJpeg(strokes);
    ai = { busy: true, reply: "", err: "", usage: null };
    render();
    try {
      const prompt = `Ich übe Japanisch schreiben. Auf dem Bild habe ich mit dem Finger das ${opt.script === "kata" ? "Katakana" : "Hiragana"} „${k.kana}“ (${k.romaji}) geschrieben. ` +
        `Gib mir bitte kurzes, freundliches Feedback auf Deutsch (max. 4 Sätze): Ist es erkennbar? Was passt, was sollte ich verbessern (Proportionen, Striche, Strichreihenfolge)?`;
      const out = await askClaude([{ role: "user", content: prompt }], { body: { mode: "sensei", image: { type: "image/jpeg", data } }, timeoutMs: 60000 });
      ai = { busy: false, reply: out.reply, err: "", usage: out.usage };
      J.count("write", true);
    } catch (err) {
      ai = { busy: false, reply: "", err: (err && err.message) || String(err), usage: null };
    }
    render();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !page || !page.contains(t)) return;
    if (t.dataset.o) {
      const o = t.dataset.o;
      if (o === "guide") opt.guide = t.dataset.v === "1";
      else { opt[o] = t.dataset.v; idx = 0; }
      strokes = []; revealed = false; ai = { busy: false, reply: "", err: "", usage: null };
      save(); render(); return;
    }
    const k = t.dataset.k;
    const kk = curK();
    if (k === "prev") go(-1);
    else if (k === "nextk") go(1);
    else if (k === "say") J.speak(kk.kana);
    else if (k === "undo") { strokes.pop(); draw(); updBtns(); }
    else if (k === "clear") { strokes = []; draw(); updBtns(); }
    else if (k === "reveal") { revealed = true; render(); J.speak(kk.kana); }
    else if (k === "good") { J.count("write", true); ui.toast("✍️ Schön geschrieben!"); go(1); }
    else if (k === "bad") { J.count("write", false); J.grade(J.kanaId(kk.kana), 1, { kind: "kana", kana: kk.kana, romaji: kk.romaji }); strokes = []; revealed = false; render(); }
    else if (k === "ai") askAi();
  }

  return {
    show(el) { page = el; page.addEventListener("click", onClick); render(); },
    hide() { if (ro) { ro.disconnect(); ro = null; } if (page) page.removeEventListener("click", onClick); page = null; canvas = null; g = null; },
  };
}
