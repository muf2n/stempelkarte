// Alltag › Claude-Assistent › Sprache: Gesprächsmodus (Vollbild mit Orb), Vorlesen, „Hey Claude“, Stimm-Einstellungen.
// Chrome/Android: Spracherkennung und Sprachausgabe dürfen sich nicht überlappen → strikt nacheinander:
//   zuhören (eigene Erkennung pro Runde) → Erkennung ganz beendet → senden → vorlesen → kurze Pause → wieder zuhören.
// „onend“ kommt auf manchen Geräten sofort nach start() ohne Ergebnis → bis zu 3 Mal still neu starten.
import * as store from "../store.js";
import { esc } from "../util.js";
import { speakable, splitChunks, matchWake, isStopPhrase, rankVoices, pickVoice, normVoice, sanitizeName, DEFAULT_NAME } from "./voice-core.js";

const LS_KEY = "stempelkarte.ai.voice";
export const NAME_KEY = "stempelkarte.ai.name";
const LANG = "de-AT";

const T = () => { try { return ["localhost", "127.0.0.1"].includes(location.hostname) && window.__aiTest || {}; } catch { return {}; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const gap = () => (T().gapMs ?? 350);

export function SRClass() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
export function support() {
  const tts = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  const sr = !!SRClass();
  return { tts, sr, talk: tts && sr };
}

/* ---------- Einstellungen ---------- */

export function loadVoice() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { local = null; }
  const cloud = store.get()?.settings?.ai?.voice;
  return normVoice(local || cloud);
}

/** Name des Assistenten (settings.ai.name, Kopie im localStorage). "" = Standard „Claude“. */
export function customName() {
  let n = null;
  try { n = localStorage.getItem(NAME_KEY); } catch { n = null; }
  if (n == null) n = store.get()?.settings?.ai?.name;
  return sanitizeName(n);
}
export function assistantName() { return customName() || DEFAULT_NAME; }

let nameT = 0;
export function saveName(raw) {
  const n = sanitizeName(raw);
  const v = n && n.toLowerCase() !== DEFAULT_NAME.toLowerCase() ? n : "";
  try { localStorage.setItem(NAME_KEY, v); } catch { /* egal */ }
  clearTimeout(nameT);
  nameT = setTimeout(() => {
    const ai = store.get()?.settings?.ai || {};
    store.saveSettings({ ai: { ...ai, name: v } }).catch(() => {});
  }, 400);
  return v || DEFAULT_NAME;
}

let saveT = 0;
export function saveVoice(partial) {
  const v = normVoice({ ...loadVoice(), ...partial });
  try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* egal */ }
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const ai = store.get()?.settings?.ai || {};
    store.saveSettings({ ai: { ...ai, voice: v } }).catch(() => {});
  }, 400);
  return v;
}

/* ---------- Stimmen & Vorlesen ---------- */

export function voicesReady(timeout = 1500) {
  const ss = window.speechSynthesis;
  if (!ss) return Promise.resolve([]);
  const now = ss.getVoices() || [];
  if (now.length) return Promise.resolve(now);
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (done) return; done = true; ss.removeEventListener?.("voiceschanged", fin); res(ss.getVoices() || []); };
    ss.addEventListener?.("voiceschanged", fin);
    setTimeout(fin, timeout);
  });
}

let speakTok = 0;
export function isSpeaking() { return !!(window.speechSynthesis && window.speechSynthesis.speaking); }
export function cancelSpeech() {
  speakTok++;
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* egal */ }
}

function speakOne(text, voice, vs, tok) {
  return new Promise((res) => {
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = (voice && voice.lang) || LANG;
    if (voice) u.voice = voice;
    u.rate = vs.rate; u.pitch = vs.pitch;
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(wd); clearInterval(poll); res(); };
    u.onend = fin; u.onerror = fin;
    // Chrome liefert onend manchmal nie → Wachhund nach geschätzter Sprechdauer
    const wd = setTimeout(fin, Math.max(4000, (text.length * 95) / vs.rate) + 2500);
    const poll = setInterval(() => { if (tok !== speakTok) fin(); }, 120);
    try { window.speechSynthesis.speak(u); } catch { fin(); }
  });
}

/** Liest Text (schon vorlesbar) vor. → true wenn ganz gesprochen, false wenn abgebrochen. */
export async function speak(text, vs = loadVoice()) {
  if (!support().tts || !text) return true;
  cancelSpeech();
  const tok = speakTok;
  await wait(60); // Chrome verschluckt speak() direkt nach cancel()
  const voice = pickVoice(await voicesReady(), vs.voiceURI);
  for (const chunk of splitChunks(text)) {
    if (tok !== speakTok) return false;
    await speakOne(chunk, voice, vs, tok);
  }
  return tok === speakTok;
}

/* ---------- Gesprächsmodus ---------- */

const STATUS = { listen: "Hört zu …", think: "Denkt nach …", speak: "Spricht …", idle: "" };
const HINT = { listen: "Sprich einfach. Tippen beendet.", think: "Tippen beendet.", speak: "Tippen zum Unterbrechen", idle: "" };

export class Conversation {
  /** ask(text) → Promise<{reply, error?}>; onEnd(reason) */
  constructor({ ask, onEnd }) {
    this.ask = ask; this.onEnd = onEnd;
    this.active = false; this.state = "idle"; this.tok = 0;
    this.rec = null; this.recEnd = null; this.silent = 0; this.early = 0;
    this.el = null;
  }

  start(first = "") {
    if (this.active) return;
    this.active = true; this.silent = 0; this.early = 0;
    this.mountView();
    if (first && first.trim()) this.handle(first.trim());
    else this.listen();
  }

  stop(reason = "user") {
    if (!this.active) return;
    this.active = false; this.tok++;
    this.killRec();
    cancelSpeech();
    this.setState("idle");
    if (this.el) { this.el.remove(); this.el = null; }
    document.documentElement.classList.remove("vc-open");
    if (this.onEnd) this.onEnd(reason);
  }

  mountView() {
    const el = document.createElement("div");
    el.className = "vc";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Gesprächsmodus mit " + assistantName());
    el.innerHTML = `
      <div class="vc-top">
        <span class="vc-title">Gespräch mit ${esc(assistantName())}</span>
        <button type="button" class="vc-x" aria-label="Gespräch beenden">✕</button>
      </div>
      <div class="vc-stage">
        <div class="vc-status" aria-live="polite"></div>
        <button type="button" class="vc-orb" aria-label="Gespräch steuern">
          <span class="vc-ring"></span><span class="vc-ring r2"></span><span class="vc-core"></span>
        </button>
        <p class="vc-hint"></p>
      </div>
      <div class="vc-text" aria-live="polite">
        <p class="vc-you"></p>
        <p class="vc-bot"></p>
      </div>
      <p class="vc-foot">Sag „Stopp“, „Danke“ oder „Tschüss“ zum Beenden.</p>`;
    el.querySelector(".vc-x").addEventListener("click", () => this.stop("user"));
    el.querySelector(".vc-orb").addEventListener("click", () => this.tap());
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") this.stop("user"); });
    document.body.appendChild(el);
    document.documentElement.classList.add("vc-open");
    this.el = el;
    setTimeout(() => { try { el.querySelector(".vc-orb").focus({ preventScroll: true }); } catch { /* egal */ } }, 0);
  }

  setState(s) {
    this.state = s;
    if (!this.el) return;
    this.el.dataset.state = s;
    this.el.querySelector(".vc-status").textContent = STATUS[s] || "";
    this.el.querySelector(".vc-hint").textContent = HINT[s] || "";
    this.el.querySelector(".vc-orb").setAttribute("aria-label", s === "speak" ? "Unterbrechen und zuhören" : "Gespräch beenden");
  }
  show(you, bot) {
    if (!this.el) return;
    if (you != null) this.el.querySelector(".vc-you").textContent = you;
    if (bot != null) this.el.querySelector(".vc-bot").textContent = bot;
  }

  /** Orb antippen: beim Sprechen → unterbrechen und zuhören, sonst beenden. */
  tap() {
    if (!this.active) return;
    if (this.state === "speak") { this.tok++; cancelSpeech(); this.listen(); }
    else this.stop("tap");
  }

  killRec() {
    const r = this.rec;
    if (!r) return Promise.resolve();
    try { r.abort(); } catch { try { r.stop(); } catch { /* egal */ } }
    return Promise.race([this.recEnd, wait(800)]).then(() => { if (this.rec === r) this.rec = null; });
  }

  async listen() {
    if (!this.active) return;
    const tok = ++this.tok;
    cancelSpeech();
    await this.killRec();
    // Chrome Android: Mikrofon erst öffnen, wenn die Sprachausgabe wirklich still ist
    for (let i = 0; i < 20 && isSpeaking(); i++) await wait(100);
    await wait(gap());
    if (!this.active || tok !== this.tok) return;
    this.setState("listen");
    this.show("", null);

    const SR = SRClass();
    const rec = new SR();
    rec.lang = LANG; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
    let fin = "", interim = "", err = null, got = false;
    const t0 = Date.now();
    let endRes;
    this.recEnd = new Promise((r) => { endRes = r; });
    this.rec = rec;
    const safety = setTimeout(() => { try { rec.stop(); } catch { /* egal */ } }, T().listenMs ?? 15000);

    rec.onresult = (ev) => {
      got = true;
      let f = "", n = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) f += r[0].transcript; else n += r[0].transcript;
      }
      fin = f; interim = n;
      if (tok === this.tok) this.show((f + " " + n).trim(), null);
      if (f && !n) { try { rec.stop(); } catch { /* egal */ } }
    };
    rec.onerror = (e) => { err = (e && e.error) || "error"; };
    rec.onend = () => {
      clearTimeout(safety);
      if (this.rec === rec) this.rec = null;
      endRes();
      if (!this.active || tok !== this.tok) return;
      const text = (fin || interim).trim();
      if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") {
        this.sayAndStop("Ich komme nicht ans Mikrofon. Bitte erlaube den Zugriff in den Browser-Einstellungen.", "mic");
        return;
      }
      if (text) { this.handle(text); return; }
      if (!err && !got && Date.now() - t0 < (T().earlyMs ?? 1200) && this.early < 3) {
        this.early++; // „onend“ zu früh → still nochmal
        setTimeout(() => { if (tok === this.tok) this.listen(); }, 250);
        return;
      }
      this.early = 0;
      this.silent++;
      if (this.silent >= 2) { this.stop("silence"); return; }
      this.listen();
    };
    try { rec.start(); }
    catch { clearTimeout(safety); this.rec = null; endRes(); setTimeout(() => { if (tok === this.tok) this.listen(); }, 400); }
  }

  async sayAndStop(text, reason) {
    const tok = ++this.tok;
    this.setState("speak");
    this.show(null, text);
    await speak(speakable(text));
    if (tok === this.tok) this.stop(reason);
  }

  async handle(text) {
    if (!this.active) return;
    this.silent = 0; this.early = 0;
    this.show(text, "");
    if (isStopPhrase(text, assistantName())) { this.sayAndStop("Gern. Bis später!", "stopword"); return; }
    const tok = ++this.tok;
    await this.killRec();
    this.setState("think");
    let res;
    try { res = await this.ask(text); } catch (e) { res = { reply: (e && e.message) || "Da ist etwas schiefgegangen.", error: true }; }
    if (!this.active || tok !== this.tok) return;
    const reply = String((res && res.reply) || "Erledigt.");
    this.setState("speak");
    this.show(null, speakable(reply));
    const done = await speak(speakable(reply));
    if (!this.active || tok !== this.tok) return;
    if (res && res.error) { this.stop("error"); return; }
    if (done) this.listen();
  }
}

/* ---------- „Hey Claude“ ---------- */

export class WakeListener {
  /** onWake(rest), onChange(listening), onDenied() */
  constructor({ onWake, onChange, onDenied }) {
    this.onWake = onWake; this.onChange = onChange || (() => {}); this.onDenied = onDenied || (() => {});
    this.want = false; this.paused = false; this.rec = null; this.recEnd = null; this.listening = false;
    this.backoff = 400; this.retryT = 0; this.pendT = 0; this.dead = false;
    this.onVis = () => this.sync();
    document.addEventListener("visibilitychange", this.onVis);
  }

  setWanted(on) { this.want = !!on; if (!on) this.backoff = 400; this.sync(); }
  pause() { this.paused = true; return this.kill(); }
  resume() { this.paused = false; this.backoff = 400; this.sync(); }
  destroy() { this.dead = true; this.want = false; document.removeEventListener("visibilitychange", this.onVis); this.kill(); }

  should() { return !this.dead && this.want && !this.paused && document.visibilityState === "visible" && !!SRClass(); }
  setListening(v) { if (this.listening !== v) { this.listening = v; this.onChange(v); } }

  sync() {
    clearTimeout(this.retryT);
    if (this.should()) { if (!this.rec) this.startRec(); }
    else if (this.rec) this.kill();
    else this.setListening(false);
  }

  kill() {
    clearTimeout(this.retryT); clearTimeout(this.pendT);
    const r = this.rec;
    this.setListening(false);
    if (!r) return Promise.resolve();
    this.rec = null;
    try { r.abort(); } catch { /* egal */ }
    return Promise.race([this.recEnd, wait(800)]);
  }

  fire(rest) {
    clearTimeout(this.pendT);
    this.kill().then(() => { if (!this.dead) this.onWake(rest || ""); });
  }

  startRec() {
    const SR = SRClass();
    const rec = new SR();
    rec.lang = LANG; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    let endRes, startedAt = Date.now(), fired = false;
    this.recEnd = new Promise((r) => { endRes = r; });
    this.rec = rec;
    rec.onstart = () => { if (this.rec === rec) { startedAt = Date.now(); this.setListening(true); } };
    rec.onresult = (ev) => {
      if (this.rec !== rec || fired) return;
      for (let i = ev.resultIndex || 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        const m = matchWake(r[0].transcript, assistantName());
        if (!m) continue;
        if (r.isFinal) { fired = true; this.fire(m.rest); return; }
        // Zwischenergebnis: kurz auf den Rest des Satzes warten
        clearTimeout(this.pendT);
        this.pendT = setTimeout(() => { if (!fired && this.rec === rec) { fired = true; this.fire(m.rest); } }, T().wakeWaitMs ?? 1500);
      }
    };
    rec.onerror = (e) => {
      const er = e && e.error;
      if (er === "not-allowed" || er === "service-not-allowed") { this.want = false; this.onDenied(er); }
    };
    rec.onend = () => {
      endRes();
      if (this.rec !== rec) return;
      this.rec = null;
      this.setListening(false);
      if (!this.should()) return;
      // Neustart mit Backoff (lief es länger, war alles in Ordnung)
      this.backoff = Date.now() - startedAt > 5000 ? 400 : Math.min(this.backoff * 2, 15000);
      this.retryT = setTimeout(() => this.sync(), T().wakeBackoffMs ?? this.backoff);
    };
    try { rec.start(); this.setListening(true); }
    catch { this.rec = null; endRes(); this.backoff = Math.min(this.backoff * 2, 15000); this.retryT = setTimeout(() => this.sync(), this.backoff); }
  }
}

/* ---------- Einstellungs-Blatt ---------- */

const SAMPLE = "Hallo! So klinge ich. Du hast diese Woche 4:30 h Überstunden und 12,50 € ausgegeben.";

export function openVoiceSettings(ui, { onWakeToggle, onName } = {}) {
  const sup = support();
  const v = loadVoice();
  const pct = (x) => String(Math.round(x * 100) / 100).replace(".", ",") + "×";
  const body = `
    <div class="fields vs">
      <label>Name des Assistenten
        <input type="text" class="vs-name" maxlength="24" autocomplete="off" placeholder="${DEFAULT_NAME}" value="${esc(customName())}"></label>
      <p class="note vs-nnote">Gilt für das Weckwort („Hey ${esc(assistantName())}“) und so stellt er sich vor. Nur Buchstaben, Leerzeichen und Bindestriche.</p>
      ${!sup.tts && !sup.sr ? `<p class="vs-warn">Dieser Browser kann leider weder vorlesen noch zuhören. Am Handy klappt es am besten mit Chrome.</p>` : ""}
      ${sup.tts ? `
      <label>Stimme
        <select class="vs-voice"><option value="">Automatisch (beste deutsche Stimme)</option></select>
      </label>
      <p class="note vs-vnote" hidden></p>
      <label>Tempo <span class="vs-val" data-for="rate">${pct(v.rate)}</span>
        <input type="range" class="vs-rate" min="0.6" max="1.6" step="0.05" value="${v.rate}"></label>
      <label>Tonhöhe <span class="vs-val" data-for="pitch">${pct(v.pitch)}</span>
        <input type="range" class="vs-pitch" min="0.5" max="1.5" step="0.05" value="${v.pitch}"></label>
      <button type="button" class="btn vs-try">🔊 Probe hören</button>
      <label class="switch"><span>Antworten immer vorlesen</span><input type="checkbox" class="vs-read"${v.readAloud ? " checked" : ""}></label>
      ` : `<p class="vs-warn">Vorlesen geht in diesem Browser nicht.</p>`}
      ${sup.talk ? `
      <label class="switch"><span>Kurze Antworten im Sprachmodus</span><input type="checkbox" class="vs-short"${v.short ? " checked" : ""}></label>
      <label class="switch"><span class="vs-wlabel">„Hey ${esc(assistantName())}“ zuhören, solange die App offen ist</span><input type="checkbox" class="vs-wake"${v.wake ? " checked" : ""}></label>
      <p class="note vs-wnote">Funktioniert nur, solange der Assistent offen und der Bildschirm an ist – das Mikrofon hört dabei ständig mit (die Erkennung macht der Browser bzw. Google). Ein Weckwort im Hintergrund bei gesperrtem Handy geht nur mit der nativen App.</p>
      ` : sup.tts ? `<p class="vs-warn">Zuhören (Sprachmodus, „Hey Claude“) geht in diesem Browser nicht – am Handy klappt es mit Chrome.</p>` : ""}
    </div>`;

  ui.openSheet({
    title: "Stimme & Sprechen",
    bodyHTML: body,
    onMount(sheet) {
      const $ = (s) => sheet.querySelector(s);
      const nameIn = $(".vs-name");
      nameIn.addEventListener("input", () => {
        const n = saveName(nameIn.value);
        $(".vs-nnote").textContent = `Gilt für das Weckwort („Hey ${n}“) und so stellt er sich vor. Nur Buchstaben, Leerzeichen und Bindestriche.`;
        const wl = $(".vs-wlabel");
        if (wl) wl.textContent = `„Hey ${n}“ zuhören, solange die App offen ist`;
        if (onName) onName(n);
      });
      nameIn.addEventListener("change", () => { nameIn.value = customName(); });
      if (sup.tts) {
        const sel = $(".vs-voice");
        const fill = (voices) => {
          const de = rankVoices(voices);
          const cur = loadVoice().voiceURI;
          sel.innerHTML = `<option value="">Automatisch (beste deutsche Stimme)</option>` +
            de.map((x) => `<option value="${esc(x.voiceURI || x.name)}"${(x.voiceURI || x.name) === cur ? " selected" : ""}>${esc(x.name)} (${esc(x.lang)})</option>`).join("");
          const note = $(".vs-vnote");
          note.hidden = !!de.length;
          note.textContent = de.length ? "" : "Keine deutsche Stimme gefunden – es wird die Standardstimme verwendet.";
        };
        fill(window.speechSynthesis.getVoices() || []);
        const onVc = () => { if (sheet.isConnected) fill(window.speechSynthesis.getVoices() || []); };
        window.speechSynthesis.addEventListener?.("voiceschanged", onVc);
        voicesReady().then(onVc);
        sel.addEventListener("change", () => saveVoice({ voiceURI: sel.value }));
        for (const k of ["rate", "pitch"]) {
          const inp = $(".vs-" + k);
          inp.addEventListener("input", () => {
            sheet.querySelector(`.vs-val[data-for="${k}"]`).textContent = pct(Number(inp.value));
            saveVoice({ [k]: Number(inp.value) });
          });
        }
        $(".vs-try").addEventListener("click", () => speak(speakable(SAMPLE)));
        $(".vs-read").addEventListener("change", (e) => saveVoice({ readAloud: e.target.checked }));
      }
      if (sup.talk) {
        $(".vs-short").addEventListener("change", (e) => saveVoice({ short: e.target.checked }));
        $(".vs-wake").addEventListener("change", (e) => {
          saveVoice({ wake: e.target.checked });
          if (onWakeToggle) onWakeToggle(e.target.checked); // im Tipp-Ereignis → Mikrofon-Erlaubnis darf gefragt werden
        });
      }
    },
  });
}
