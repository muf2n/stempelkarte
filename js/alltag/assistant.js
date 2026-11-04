// Alltag › Claude-Assistent: Chat mit Claude über den eigenen Server (tools/mcp, Endpunkt /chat).
// Der Server prüft das Firebase-Anmelde-Token, ruft Claude auf und darf über Werkzeuge die App-Daten lesen/ändern.
// Verlauf bleibt nur auf diesem Gerät (localStorage), max. 40 Nachrichten.
import * as store from "../store.js";
import { askClaude, serverUrl, aiAvailable, URL_KEY, DEFAULT_URL } from "./ai-client.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import * as ui from "../ui.js";

const HIST_KEY = "stempelkarte.ai.history";
const MAX_MSGS = 40;

const SUGGEST = [
  "Wie viele Überstunden hab ich?",
  "Plan mir den Tag morgen",
  "Fass meine Woche fürs Berichtsheft zusammen",
  "Was steht diese Woche an?",
  "Wofür hab ich diesen Monat Geld ausgegeben?",
  "Welche Prüfungen kommen als Nächstes?",
];

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

function loadHist() {
  try { const a = JSON.parse(lsGet(HIST_KEY) || "[]"); return Array.isArray(a) ? a.filter((m) => m && m.role && typeof m.content === "string") : []; }
  catch { return []; }
}

// sehr kleines, sicheres Markdown: **fett**, Listen, Zeilenumbrüche
function md(text) {
  const lines = esc(text).split("\n");
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

export function mount(el, ctx) {
  let hist = loadHist();
  let busy = false;
  let alive = true;
  let rec = null;

  el.innerHTML = `
    <div class="ai">
      <div class="ai-log" aria-live="polite"></div>
      <div class="ai-sugg"></div>
      <form class="ai-form" autocomplete="off">
        <button type="button" class="ai-mic" aria-label="Sprechen">${icon("mic", 22)}</button>
        <textarea class="ai-in" rows="1" placeholder="Frag Claude …" aria-label="Nachricht an Claude"></textarea>
        <button type="submit" class="ai-send" aria-label="Senden">${icon("send", 22)}</button>
      </form>
      <div class="ai-foot">
        <button type="button" class="ai-link" data-a="clear">Verlauf löschen</button>
        <span class="ai-usage"></span>
        <button type="button" class="ai-link" data-a="url">Server</button>
      </div>
    </div>`;
  const log = el.querySelector(".ai-log");
  const sugg = el.querySelector(".ai-sugg");
  const form = el.querySelector(".ai-form");
  const input = el.querySelector(".ai-in");
  const usageEl = el.querySelector(".ai-usage");
  const mic = el.querySelector(".ai-mic");

  function render() {
    const snap = store.get();
    if (!aiAvailable(snap)) {
      log.innerHTML = `<div class="ai-empty"><div class="ai-badge">✨</div><h3>Claude-Assistent</h3>
        <p>Der Assistent braucht die Anmeldung mit Google, weil er deine gespeicherten Daten liest. Im lokalen Modus geht das nicht.</p></div>`;
      sugg.innerHTML = ""; form.hidden = true; return;
    }
    form.hidden = false;
    if (!hist.length) {
      log.innerHTML = `<div class="ai-empty"><div class="ai-badge">✨</div><h3>Frag Claude</h3>
        <p>Claude kennt deine Zeiten, Termine, To-dos, Geld und Schule – und kann auch eintragen (z. B. „Trag mir morgen 7 Uhr Baustelle ein“).</p></div>`;
    } else {
      log.innerHTML = hist.map((m) => m.role === "user"
        ? `<div class="ai-msg me">${esc(m.content).replace(/\n/g, "<br>")}</div>`
        : `<div class="ai-msg bot">${md(m.content)}${m.actions && m.actions.length ? `<div class="ai-acts">✓ ${m.actions.map(esc).join(", ")}</div>` : ""}</div>`).join("");
    }
    if (busy) log.insertAdjacentHTML("beforeend", `<div class="ai-msg bot ai-typing"><span></span><span></span><span></span></div>`);
    sugg.innerHTML = hist.length > 1 || busy ? "" : SUGGEST.map((s) => `<button type="button" class="ai-chip">${esc(s)}</button>`).join("");
    log.scrollTop = log.scrollHeight;
  }

  function save() {
    hist = hist.slice(-MAX_MSGS);
    lsSet(HIST_KEY, JSON.stringify(hist));
  }

  async function send(text) {
    text = String(text || "").trim();
    if (!text || busy) return;
    hist.push({ role: "user", content: text });
    save(); busy = true; input.value = ""; autosize(); render();
    let reply, actions = [];
    try {
      const data = await askClaude(hist.filter((m) => !m.err).map((m) => ({ role: m.role, content: m.content })));
      reply = data.reply;
      actions = data.actions;
      if (data.usage) {
        usageEl.textContent = `Diesen Monat: ${Number(data.usage.usd || 0).toFixed(2).replace(".", ",")} $ von ${data.usage.capUsd} $`;
      }
      if (actions.length && ctx && ctx.toast) ctx.toast("Claude hat etwas eingetragen ✓");
    } catch (err) {
      const msg = err && err.name === "TypeError"
        ? "Server nicht erreichbar. Ist er schon eingerichtet und bist du online?"
        : (err && err.message) || String(err);
      hist.push({ role: "assistant", content: "⚠️ " + msg, err: true });
      save(); busy = false; if (alive) render(); return;
    }
    hist.push({ role: "assistant", content: reply, actions });
    save(); busy = false;
    if (alive) render();
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(140, input.scrollHeight) + "px";
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); send(input.value); }
  });
  sugg.addEventListener("click", (e) => { const b = e.target.closest(".ai-chip"); if (b) send(b.textContent); });

  // Spracheingabe (Chrome/Android)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) mic.hidden = true;
  mic.addEventListener("click", () => {
    if (!SR) return;
    if (rec) { try { rec.stop(); } catch {} return; }
    rec = new SR();
    rec.lang = "de-AT"; rec.interimResults = true; rec.maxAlternatives = 1;
    const base = input.value ? input.value + " " : "";
    mic.classList.add("on");
    rec.onresult = (ev) => {
      let t = "";
      for (const r of ev.results) t += r[0].transcript;
      input.value = base + t; autosize();
      if (ev.results[ev.results.length - 1].isFinal) { try { rec.stop(); } catch {} }
    };
    rec.onerror = () => {};
    rec.onend = () => { mic.classList.remove("on"); rec = null; if (input.value.trim()) send(input.value); };
    try { rec.start(); } catch { mic.classList.remove("on"); rec = null; }
  });

  el.querySelector(".ai-foot").addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "clear") {
      if (!hist.length) return;
      ui.confirmButton(e.target.closest("button"), "Wirklich löschen?", () => { hist = []; save(); render(); });
    } else if (a === "url") {
      ui.openSheet({
        title: "Claude-Server",
        bodyHTML: `<div class="fields"><label>Server-Adresse
          <input type="url" class="ai-url" value="${esc(serverUrl(store.get()))}" placeholder="${DEFAULT_URL}"></label>
          <p class="note">Steht nach der Einrichtung bei Cloudflare (…workers.dev). Normalerweise nichts ändern.</p>
          <button type="button" class="btn primary ai-url-save">Speichern</button></div>`,
        onMount(sheet, close) {
          sheet.querySelector(".ai-url-save").addEventListener("click", async () => {
            const v = sheet.querySelector(".ai-url").value.trim();
            lsSet(URL_KEY, v);
            try { await store.saveSettings({ ai: { ...(store.get().settings.ai || {}), url: v } }); } catch {}
            if (typeof close === "function") close();
            ui.toast("Gespeichert");
          });
        },
      });
    }
  });

  const off = store.subscribe(() => { if (alive && !busy) render(); });
  render();
  return () => { alive = false; off(); if (rec) { try { rec.stop(); } catch {} } };
}
