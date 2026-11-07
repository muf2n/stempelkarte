// Alltag › Japanisch › 📖 Lesen: kurze, gestufte Texte/Dialoge mit Schaltern für Furigana, Romaji und Deutsch; antippen = vorlesen.
import { READINGS as BASE } from "./jp-data.js";

// Weitere Texte (r11–r30) werden beim ersten Öffnen nachgeladen (./jp-data-read.js, Kompaktformat → Furigana-Teile).
let READINGS = BASE;
let more = null;
function loadMore() {
  more ||= Promise.all([import("./jp-data-read.js"), import("./jp-text.js")]).then(([d, t]) => {
    READINGS = [...BASE, ...d.MORE_READINGS.map(([id, level, emoji, title, lines]) => ({
      id, level, emoji, title, lines: lines.map(([who, src, ro, de]) => ({ who, ja: t.parseJa(src).ja, ro, de })),
    }))];
  }).catch((err) => { console.error(err); more = null; });
  return more;
}

const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
const KEY = "sk-jp-read";
const LEVELS = { 1: "🌱 Anfang", 2: "🌿 Leicht", 3: "🌳 Weiter" };

export function createRead(J) {
  const { esc } = J;
  let page = null;
  const s = lsGet(KEY) || {};
  const opt = { furi: s.furi !== false, ro: s.ro !== false, de: !!s.de, open: s.open || null, done: Array.isArray(s.done) ? s.done : [] };
  const save = () => lsSet(KEY, opt);

  const jaHTML = (parts) => parts.map(([t, rd]) => (rd && opt.furi ? `<ruby>${esc(t)}<rt>${esc(rd)}</rt></ruby>` : esc(t))).join("");
  const speakText = (line) => line.ja.map(([t]) => t).join("");

  function listHTML() {
    let h = `<p class="jp-muted">Kurze Texte zum Mitlesen – tipp einen Satz an, dann hörst du ihn 🔊</p>`;
    for (const lv of [1, 2, 3]) {
      const rs = READINGS.filter((r) => r.level === lv);
      if (!rs.length) continue;
      h += `<h3 class="jp-h3">${LEVELS[lv]}</h3><div class="jp-rlist">` + rs.map((r) =>
        `<button type="button" class="jp-rtile" data-open="${esc(r.id)}"><span class="jp-rem" aria-hidden="true">${r.emoji}</span><span><b>${esc(r.title)}</b><small>${r.lines.length} Sätze${opt.done.includes(r.id) ? " · ✅ gelesen" : ""}</small></span></button>`).join("") + `</div>`;
    }
    return h;
  }
  function textHTML(r) {
    const tg = (k, label) => `<button type="button" class="chip" data-tg="${k}" aria-pressed="${!!opt[k]}">${label}</button>`;
    return `<div class="jp-card">` +
      `<div class="jp-row"><button type="button" class="btn ghost sm" data-k="back">← Texte</button><span class="jp-grow"></span>` +
        `<button type="button" class="btn ghost sm" data-k="all">▶️ Alles vorlesen</button></div>` +
      `<h3 class="jp-h3">${r.emoji} ${esc(r.title)}</h3>` +
      `<div class="chips">${tg("furi", "あ Furigana")}${tg("ro", "Aa Romaji")}${tg("de", "🇩🇪 Deutsch")}</div>` +
      `<div class="jp-lines">` + r.lines.map((l, i) =>
        `<button type="button" class="jp-line" data-line="${i}">` +
          (l.who ? `<span class="jp-who jp-ja">${esc(l.who)}</span>` : "") +
          `<span class="jp-lt"><span class="jp-ja jp-ltja">${jaHTML(l.ja)}</span>` +
          (opt.ro ? `<small class="jp-lro">${esc(l.ro)}</small>` : "") +
          (opt.de ? `<small class="jp-lde">${esc(l.de)}</small>` : "") +
          `</span></button>`).join("") +
      `</div>` +
      `<div class="jp-row jp-mt"><span class="jp-grow"></span><button type="button" class="btn primary sm" data-k="done">${opt.done.includes(r.id) ? "✅ Gelesen" : "Gelesen ✓"}</button></div>` +
    `</div>`;
  }
  function render() {
    if (!page) return;
    const r = READINGS.find((x) => x.id === opt.open);
    page.innerHTML = `<div class="jp-read">${r ? textHTML(r) : listHTML()}</div>`;
  }
  let playing = 0;
  async function playAll(r) {
    const tok = ++playing;
    for (let i = 0; i < r.lines.length; i++) {
      if (tok !== playing || !page) return;
      const b = page.querySelector(`.jp-line[data-line="${i}"]`);
      page.querySelectorAll(".jp-line.on").forEach((x) => x.classList.remove("on"));
      if (b) b.classList.add("on");
      await J.speak(speakText(r.lines[i]));
    }
    if (page) page.querySelectorAll(".jp-line.on").forEach((x) => x.classList.remove("on"));
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !page || !page.contains(t)) return;
    const r = READINGS.find((x) => x.id === opt.open);
    if (t.dataset.open) { opt.open = t.dataset.open; save(); render(); window.scrollTo(0, 0); return; }
    if (t.dataset.tg) { opt[t.dataset.tg] = !opt[t.dataset.tg]; save(); render(); return; }
    if (t.dataset.line != null && r) {
      playing++;
      page.querySelectorAll(".jp-line.on").forEach((x) => x.classList.remove("on"));
      t.classList.add("on");
      J.speak(speakText(r.lines[Number(t.dataset.line)])).then(() => t.classList.remove("on"));
      return;
    }
    const k = t.dataset.k;
    if (k === "back") { playing++; opt.open = null; save(); render(); }
    else if (k === "all" && r) playAll(r);
    else if (k === "done" && r) {
      if (!opt.done.includes(r.id)) opt.done.push(r.id);
      J.count("read", true); J.ui.toast("📖 Gut gelesen – よくできました！");
      opt.open = null; save(); render();
    }
  }
  return {
    show(el) { page = el; page.addEventListener("click", onClick); render(); if (READINGS === BASE) loadMore().then(() => render()); },
    hide() { playing++; if (page) page.removeEventListener("click", onClick); page = null; },
  };
}
