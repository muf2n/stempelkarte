// Alltag › Japanisch › 🎌 Sensei: Übungs-Chat mit Claude als Japanisch-Lehrer (Server-Modus "sensei", ohne Werkzeuge/Datenzugriff).
// Eigener Verlauf in localStorage (gedeckelt), nicht im Verlauf des Claude-Assistenten.
import { askClaude, aiAvailable } from "./ai-client.js";
import { esc } from "../util.js";

const HIST_KEY = "sk-jp-sensei";
const MAX_HIST = 40;   // gespeichert
const MAX_SEND = 20;   // an den Server
const STARTERS = [
  ["🙋", "Rollenspiel: Ich stelle mich vor. Fang du an!"],
  ["🍜", "Rollenspiel: Ich bestelle im Restaurant. Du bist der Kellner."],
  ["🔢", "Üb mit mir die Zahlen 1–10, mit kleinem Quiz."],
  ["❓", "Erklär mir einfach den Unterschied zwischen は und が."],
  ["⚡", "Welche japanischen Wörter brauch ich als Elektriker auf der Baustelle?"],
  ["🌸", "Gib mir einen einfachen Satz zum Übersetzen und korrigier mich."],
];

/** sehr kleines, sicheres Markdown: **fett**, Listen, Zeilenumbrüche (alles vorher escaped). */
export function md(text) {
  const lines = esc(String(text || "")).split("\n");
  let out = "", inList = false;
  for (const raw of lines) {
    const l = raw.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    const m = l.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)$/);
    if (m) { if (!inList) { out += "<ul>"; inList = true; } out += `<li>${m[1]}</li>`; continue; }
    if (inList) { out += "</ul>"; inList = false; }
    out += l.trim() ? `<p>${l}</p>` : "";
  }
  if (inList) out += "</ul>";
  return out;
}
/** Nur die japanischen Teile einer Antwort (zum Vorlesen). */
export function japaneseParts(text) {
  const m = String(text || "").match(/[぀-ヿ㐀-鿿ｦ-ﾟ々ー〜][぀-ヿ㐀-鿿ｦ-ﾟ々ー〜、。！？!?\s]*/g) || [];
  return m.map((x) => x.trim()).filter(Boolean).join("。");
}

const load = () => { try { const a = JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); return Array.isArray(a) ? a.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : []; } catch { return []; } };
const store = (h) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-MAX_HIST))); } catch { /* egal */ } };

export function createSensei(J) {
  let page = null;
  let hist = load();
  let busy = false;
  let usage = null;
  let draft = "";
  let ctrl = null;

  function msgsHTML() {
    if (!hist.length) {
      return `<div class="jp-sensei-hi"><div class="jp-sensei-av" aria-hidden="true">🎌</div>` +
        `<p><b>こんにちは！</b> Ich bin dein Sensei 🙂 Frag mich alles übers Japanischlernen – oder wir spielen eine Situation durch. Ich erklär auf Deutsch und schreib Japanisch immer mit Kana + Romaji.</p></div>` +
        `<div class="jp-starters">${STARTERS.map(([e, t], i) => `<button type="button" class="chip" data-start="${i}">${e} ${esc(t)}</button>`).join("")}</div>`;
    }
    return hist.map((m, i) => m.role === "user"
      ? `<div class="jp-msg from-me"><div class="jp-bub">${esc(m.content)}</div></div>`
      : `<div class="jp-msg from-ai${m.err ? " err" : ""}"><span class="jp-sensei-av sm" aria-hidden="true">🎌</span><div class="jp-bub">${md(m.content)}` +
          (!m.err && japaneseParts(m.content) ? `<button type="button" class="jp-say-ai" data-sayi="${i}" aria-label="Japanisch vorlesen">🔊</button>` : "") + `</div></div>`).join("") +
      (busy ? `<div class="jp-msg from-ai"><span class="jp-sensei-av sm" aria-hidden="true">🎌</span><div class="jp-bub jp-typing" aria-label="Sensei schreibt"><span></span><span></span><span></span></div></div>` : "");
  }
  function html() {
    if (!aiAvailable()) {
      return `<div class="jp-card jp-center"><div class="jp-sensei-av" aria-hidden="true">🎌</div><p>Der Sensei ist Claude – dafür brauchst du die <b>Anmeldung mit Google</b>. Im lokalen Modus geht das leider nicht 🙏</p></div>`;
    }
    return `<div class="jp-card jp-sensei">` +
      `<div class="jp-row"><span class="jp-muted jp-usage">${usage ? `Diesen Monat: ${Number(usage.usd || 0).toFixed(2).replace(".", ",")} $ von ${esc(String(usage.capUsd))} $` : "Sensei antwortet auf Deutsch mit Kana + Romaji"}</span><span class="jp-grow"></span>` +
        (hist.length ? `<button type="button" class="btn ghost sm" data-k="clear">🧹 Neu</button>` : "") + `</div>` +
      `<div class="jp-msgs" aria-live="polite">${msgsHTML()}</div>` +
      `<form class="jp-chatform" autocomplete="off">` +
        `<textarea class="jp-chatin" rows="1" lang="ja" placeholder="Schreib auf Deutsch oder Japanisch … " aria-label="Nachricht an Sensei" ${busy ? "disabled" : ""}>${esc(draft)}</textarea>` +
        `<button type="submit" class="btn primary" ${busy ? "disabled" : ""} aria-label="Senden">➤</button>` +
      `</form>` +
    `</div>`;
  }
  function render() {
    if (!page) return;
    page.innerHTML = html();
    const box = page.querySelector(".jp-msgs");
    if (box && hist.length) box.scrollTop = box.scrollHeight;
    const last = page.querySelector(".jp-msg:last-child");
    if (last && hist.length && last.scrollIntoView) { try { last.scrollIntoView({ block: "nearest" }); } catch { /* egal */ } }
  }

  async function send(text) {
    text = String(text || "").trim().slice(0, 2000);
    if (!text || busy) return;
    hist.push({ role: "user", content: text });
    draft = ""; busy = true; store(hist); render();
    ctrl = new AbortController();
    try {
      const out = await askClaude(hist.filter((m) => !m.err).slice(-MAX_SEND), { body: { mode: "sensei" }, timeoutMs: 60000, signal: ctrl.signal });
      hist.push({ role: "assistant", content: out.reply });
      if (out.usage) usage = out.usage;
      J.count("sensei", true);
    } catch (err) {
      if (err && err.code === "abort") { busy = false; return; }
      hist.push({ role: "assistant", content: "⚠️ " + ((err && err.message) || String(err)), err: true });
    }
    ctrl = null; busy = false; store(hist); render();
    const ta = page && page.querySelector(".jp-chatin"); if (ta) ta.focus({ preventScroll: true });
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !page || !page.contains(t)) return;
    if (t.dataset.start != null) { send(STARTERS[Number(t.dataset.start)][1]); return; }
    if (t.dataset.sayi != null) { const m = hist[Number(t.dataset.sayi)]; if (m) J.speak(japaneseParts(m.content)); return; }
    if (t.dataset.k === "clear") {
      if (!t.dataset.armed) { t.dataset.armed = "1"; t.textContent = "Wirklich löschen?"; return; }
      hist = []; store(hist); render();
    }
  }
  function onSubmit(ev) { ev.preventDefault(); const ta = page.querySelector(".jp-chatin"); if (ta) send(ta.value); }
  function onKey(ev) {
    if (ev.target.classList && ev.target.classList.contains("jp-chatin") && ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(ev.target.value); }
  }
  function onInput(ev) {
    if (!ev.target.classList.contains("jp-chatin")) return;
    draft = ev.target.value;
    ev.target.style.height = "auto"; ev.target.style.height = Math.min(160, ev.target.scrollHeight) + "px";
  }

  return {
    show(el) { page = el; page.addEventListener("click", onClick); page.addEventListener("submit", onSubmit); page.addEventListener("keydown", onKey); page.addEventListener("input", onInput); render(); },
    hide() { if (page) { page.removeEventListener("click", onClick); page.removeEventListener("submit", onSubmit); page.removeEventListener("keydown", onKey); page.removeEventListener("input", onInput); } page = null; },
    destroy() { if (ctrl) { try { ctrl.abort(); } catch { /* egal */ } } },
  };
}
