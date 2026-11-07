// Alltag › Claude-Assistent: Chat mit Claude über den eigenen Server (tools/mcp, Endpunkt /chat).
// Der Server prüft das Firebase-Anmelde-Token, ruft Claude auf und darf über Werkzeuge die App-Daten lesen/ändern.
// Verlauf bleibt nur auf diesem Gerät (localStorage), max. 40 Nachrichten.
import * as store from "../store.js";
import { askClaude, serverUrl, aiAvailable, URL_KEY, DEFAULT_URL } from "./ai-client.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import * as ui from "../ui.js";
import { speakable } from "./voice-core.js";
import * as voice from "./voice.js";

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
      <div class="ai-voicebar">
        <button type="button" class="ai-talk" aria-label="Gesprächsmodus starten"><span class="ai-orb" aria-hidden="true">${icon("mic", 20)}</span><span class="ai-talk-t">🎙️ Sprechen</span></button>
        <span class="ai-wake" hidden title="Hört nur, solange der Assistent offen und der Bildschirm an ist. Ein Weckwort im Hintergrund geht nur mit der nativen App."><i></i><span class="ai-wake-t">Hört auf „Hey Claude“</span></span>
        <span class="ai-vnote" hidden></span>
        <button type="button" class="ai-link ai-vset">Stimme</button>
      </div>
      <div class="ai-att" hidden><img alt="Angehängtes Foto"><span>📷 Foto angehängt</span><button type="button" class="ai-att-x" aria-label="Foto entfernen">✕</button></div>
      <form class="ai-form" autocomplete="off">
        <button type="button" class="ai-cam" aria-label="Foto anhängen">📷</button>
        <input type="file" class="ai-file" accept="image/*" hidden>
        <button type="button" class="ai-mic" aria-label="Sprechen">${icon("mic", 22)}</button>
        <textarea class="ai-in" rows="1" placeholder="Frag Claude …" aria-label="Nachricht an Claude"></textarea>
        <button type="submit" class="ai-send" aria-label="Senden">${icon("send", 22)}</button>
      </form>
      <div class="ai-foot">
        <button type="button" class="ai-link" data-a="clear">Verlauf löschen</button>
        <span class="ai-usage"></span>
        <button type="button" class="ai-link" data-a="trash">Papierkorb</button>
        <button type="button" class="ai-link" data-a="url">Server</button>
      </div>
    </div>`;
  const log = el.querySelector(".ai-log");
  const sugg = el.querySelector(".ai-sugg");
  const form = el.querySelector(".ai-form");
  const input = el.querySelector(".ai-in");
  const usageEl = el.querySelector(".ai-usage");
  const mic = el.querySelector(".ai-mic");
  const vbar = el.querySelector(".ai-voicebar");
  const talkBtn = el.querySelector(".ai-talk");
  const wakeEl = el.querySelector(".ai-wake");
  const vnote = el.querySelector(".ai-vnote");
  const sup = voice.support();

  /** Name des Assistenten in Platzhalter, Kopfzeile, Orb-Knopf und Weckwort-Anzeige */
  function applyName() {
    const n = voice.assistantName();
    input.placeholder = `Frag ${n} …`;
    input.setAttribute("aria-label", `Nachricht an ${n}`);
    talkBtn.setAttribute("aria-label", `Gespräch mit ${n} starten`);
    talkBtn.querySelector(".ai-talk-t").textContent = `Mit ${n} sprechen`;
    wakeEl.querySelector(".ai-wake-t").textContent = `Hört auf „Hey ${n}“`;
    const head = el.closest(".al-mod")?.querySelector(".al-title");
    if (head) {
      const t = [...head.childNodes].find((x) => x.nodeType === 3);
      const label = voice.customName() || "Claude-Assistent";
      if (t) t.textContent = label; else head.append(label);
    }
  }
  let conv = null;
  let wake = null;

  // lokaler Modus sperrt (Test-Haken window.__skAiTest in ai-client.js hebt das auf localhost auf)
  const blocked = () => !aiAvailable(store.get());

  function render() {
    const snap = store.get();
    if (blocked()) {
      vbar.hidden = true;
      log.innerHTML = `<div class="ai-empty"><div class="ai-badge">✨</div><h3>Claude-Assistent</h3>
        <p>Der Assistent braucht die Anmeldung mit Google, weil er deine gespeicherten Daten liest. Im lokalen Modus geht das nicht.</p></div>`;
      sugg.innerHTML = ""; form.hidden = true; return;
    }
    form.hidden = false;
    vbar.hidden = false;
    if (!hist.length) {
      const nm = esc(voice.assistantName());
      log.innerHTML = `<div class="ai-empty"><div class="ai-badge">✨</div><h3>Frag ${nm}</h3>
        <p>${nm} kennt deine Zeiten, Termine, To-dos, Geld und Schule – und kann auch eintragen (z. B. „Trag mir morgen 7 Uhr Baustelle ein“).</p></div>`;
    } else {
      log.innerHTML = hist.map((m) => m.role === "user"
        ? `<div class="ai-msg me">${m.thumb && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m.thumb) ? `<img class="ai-thumb" src="${m.thumb}" alt="Foto">` : m.photo ? "📷 " : ""}${esc(m.content).replace(/\n/g, "<br>")}</div>`
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

  /** Frage stellen, Verlauf führen. → {reply, actions, error} */
  async function ask(text, { spoken = false, image = null } = {}) {
    text = String(text || "").trim();
    if (!text) return { reply: "", actions: [], error: true };
    if (busy) return { reply: "Moment, ich bin noch bei der letzten Frage.", actions: [], error: true };
    hist.push(image ? { role: "user", content: text, photo: true, thumb: image.thumb } : { role: "user", content: text });
    save(); busy = true; if (alive) render();
    let reply, actions = [];
    try {
      const extra = { assistantName: voice.assistantName() };
      if (spoken) { extra.mode = "voice"; extra.short = voice.loadVoice().short; }
      if (image) extra.image = { type: "image/jpeg", data: image.data.replace(/^data:[^,]*,/, "") };
      const data = await askClaude(hist.filter((m) => !m.err).map((m) => ({ role: m.role, content: m.content })), { body: extra });
      reply = data.reply;
      actions = data.actions;
      if (data.usage) {
        usageEl.textContent = `Diesen Monat: ${Number(data.usage.usd || 0).toFixed(2).replace(".", ",")} $ von ${data.usage.capUsd} $`;
      }
      if (actions.length && ctx && ctx.toast) {
        ctx.toast(actions.includes("loeschen")
          ? `${voice.assistantName()} hat gelöscht – rückgängig im Papierkorb`
          : actions.includes("einstellung") ? `${voice.assistantName()} hat eine Einstellung geändert ✓`
          : `${voice.assistantName()} hat etwas eingetragen ✓`);
      }
    } catch (err) {
      const msg = err && err.name === "TypeError"
        ? "Server nicht erreichbar. Ist er schon eingerichtet und bist du online?"
        : (err && err.message) || String(err);
      hist.push({ role: "assistant", content: "⚠️ " + msg, err: true });
      save(); busy = false; if (alive) render();
      return { reply: msg, actions: [], error: true };
    }
    hist.push({ role: "assistant", content: reply, actions });
    save(); busy = false;
    if (alive) render();
    return { reply, actions };
  }

  async function send(text) {
    text = String(text || "").trim();
    if (busy) return;
    const image = pendingImg;
    if (!text && image) text = "Was siehst du auf dem Foto?";
    if (!text) return;
    input.value = ""; autosize();
    setPending(null);
    voice.cancelSpeech();
    const r = await ask(text, { image });
    if (alive && !conv && r.reply && sup.tts && voice.loadVoice().readAloud) voice.speak(speakable(r.reply));
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(140, input.scrollHeight) + "px";
  }

  // Foto an Claude schicken (wird vorher verkleinert; nur in DIESER Frage mitgeschickt, im Verlauf bleibt ein Mini-Bild)
  const camBtn = el.querySelector(".ai-cam"), fileIn = el.querySelector(".ai-file"), att = el.querySelector(".ai-att");
  let pendingImg = null;
  function setPending(img) {
    pendingImg = img;
    att.hidden = !img;
    if (img) { att.querySelector("img").src = img.thumb; input.placeholder = "Was willst du zum Foto wissen?"; }
    else input.placeholder = "Frag Claude …";
  }
  camBtn.addEventListener("click", () => fileIn.click());
  att.querySelector(".ai-att-x").addEventListener("click", () => setPending(null));
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = "";
    if (!f) return;
    try {
      const { shrinkImage } = await import("./unterwegs-shared.js");
      const big = await shrinkImage(f, { maxSide: 1280, maxBytes: 600 * 1024, quality: 0.8 });
      const small = await shrinkImage(f, { maxSide: 160, maxBytes: 12 * 1024, quality: 0.7 });
      setPending({ data: big.data, thumb: small.data });
      input.focus();
    } catch (err) { if (ctx && ctx.toast) ctx.toast((err && err.message) || "Foto konnte nicht geladen werden."); }
  });

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
    voice.cancelSpeech();
    if (wake) wake.pause();
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
    rec.onend = () => { mic.classList.remove("on"); rec = null; if (wake && !conv) wake.resume(); if (input.value.trim()) send(input.value); };
    try { rec.start(); } catch { mic.classList.remove("on"); rec = null; if (wake && !conv) wake.resume(); }
  });

  el.querySelector(".ai-foot").addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "clear") {
      if (!hist.length) return;
      ui.confirmButton(e.target.closest("button"), "Wirklich löschen?", () => { hist = []; save(); render(); });
    } else if (a === "trash") {
      import("./trash.js").then((m) => m.openTrash()).catch((err) => { console.error(err); ui.toast("Papierkorb konnte nicht geladen werden."); });
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

  /* ---------- Sprache: Gesprächsmodus, „Hey Claude“, Einstellungen ---------- */

  function showWake(on) {
    wakeEl.hidden = !on;
    if (on) { const v = voice.loadVoice(); if (!v.wakeGranted) voice.saveVoice({ wakeGranted: true }); }
  }

  async function startTalk(first = "") {
    if (!sup.talk || conv || !alive) return;
    if (rec) { try { rec.abort(); } catch {} rec = null; mic.classList.remove("on"); }
    voice.cancelSpeech();
    conv = new voice.Conversation({
      ask: (t) => ask(t, { spoken: true }),
      onEnd: () => { conv = null; if (wake && alive) wake.resume(); },
    });
    const c = conv;
    if (wake) await wake.pause();
    if (conv === c) c.start(first);
  }

  if (!sup.talk) {
    talkBtn.hidden = true;
    vnote.hidden = false;
    vnote.textContent = sup.tts
      ? "Sprachmodus geht in diesem Browser nicht (am Handy: Chrome)."
      : "Sprechen und Vorlesen gehen in diesem Browser nicht.";
  }
  if (!sup.tts && !sup.sr) el.querySelector(".ai-vset").hidden = true;
  talkBtn.addEventListener("click", () => startTalk(""));

  if (sup.talk) {
    wake = new voice.WakeListener({
      onWake: (rest) => startTalk(rest),
      onChange: showWake,
      onDenied: () => {
        voice.saveVoice({ wake: false, wakeGranted: false });
        ui.toast(`Kein Mikrofon-Zugriff – „Hey ${voice.assistantName()}“ ist aus.`);
      },
    });
    const v = voice.loadVoice();
    // Beim ersten Mal nur über den Schalter (Tipp) starten – danach automatisch beim Öffnen
    if (v.wake && v.wakeGranted && !blocked()) wake.setWanted(true);
  }

  el.querySelector(".ai-vset").addEventListener("click", () => {
    voice.openVoiceSettings(ui, {
      onWakeToggle: (on) => {
        if (!wake) return;
        wake.setWanted(on && !blocked());
        if (on) ui.toast(`„Hey ${voice.assistantName()}“ ist an – nur solange die App offen ist.`);
      },
      onName: () => { applyName(); if (!busy && !hist.length) render(); },
    });
  });

  const off = store.subscribe(() => { if (alive && !busy) { render(); applyName(); } });
  render();
  applyName();
  return () => {
    alive = false; off();
    if (rec) { try { rec.stop(); } catch {} }
    if (conv) conv.stop("unmount");
    if (wake) wake.destroy();
    voice.cancelSpeech();
  };
}
