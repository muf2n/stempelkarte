// Üben mit Claude – reine Logik: Aufgaben aus der Claude-Antwort prüfen, Rechenweg nachrechnen, Antworten bewerten.
// Aufgabe: { q, kind: "num"|"choice", answer, unit, dec, calc, choices, steps, hint }

const clean = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, n);

/** Sicherer Rechner für + − · × / : ( ) und Dezimalzahlen (kein eval). → Zahl oder null */
export function calc(expr) {
  const s = String(expr || "").replace(/[×·]/g, "*").replace(/:/g, "/").replace(/−/g, "-").replace(/(\d),(\d)/g, "$1.$2").replace(/\s+/g, "");
  if (!s || s.length > 200 || /[^0-9.+\-*/()]/.test(s)) return null;
  let i = 0;
  const num = () => { const m = /^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return Number(m[0]); };
  const atom = () => {
    if (s[i] === "-") { i++; return -atom(); }
    if (s[i] === "+") { i++; return atom(); }
    if (s[i] === "(") { i++; const v = sum(); if (s[i] !== ")") throw 0; i++; return v; }
    return num();
  };
  const prod = () => { let v = atom(); while (s[i] === "*" || s[i] === "/") { const o = s[i++], r = atom(); v = o === "*" ? v * r : v / r; } return v; };
  const sum = () => { let v = prod(); while (s[i] === "+" || s[i] === "-") { const o = s[i++], r = prod(); v = o === "+" ? v + r : v - r; } return v; };
  try { const v = sum(); return i === s.length && Number.isFinite(v) ? v : null; } catch { return null; }
}

/** Eingabe des Nutzers → Zahl („1.507,69“, „1507.69 €“, „387,69“) */
export function parseNum(raw) {
  let s = String(raw || "").replace(/[€%\s]|EUR|Euro/gi, "").replace(/−/g, "-");
  if (!s) return null;
  if (/,\d{1,}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");      // deutsch: 1.507,69
  else if (/^\-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");      // 1.120 = tausend
  else s = s.replace(/,/g, "");
  const v = Number(s); return Number.isFinite(v) ? v : null;
}
export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
/** Richtig? 1 Einheit der letzten Stelle Abweichung ist ok, ebenso richtig gerundet mit weniger Kommastellen (mind. 1). */
export function isRight(task, raw) {
  if (task.kind === "choice") return Number(raw) === task.answer;
  const v = parseNum(raw); if (v == null) return false;
  if (Math.abs(v - task.answer) <= 10 ** -(task.dec ?? 2) + 1e-9) return true;       // 1 Cent Rundung ist ok
  const m = /[.,](\d+)\s*\D*$/.exec(String(raw)), ud = m ? m[1].length : 0;          // weniger Stellen eingegeben? (387,7)
  return ud >= 1 && ud < (task.dec ?? 2) && Math.abs(round(task.answer, ud) - v) < 1e-9;
}
export const fmtNum = (v, d = 2) => Number(v).toLocaleString("de-AT", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Claude-Antwort → { title, tasks } oder null. Rechenaufgaben werden mit „calc“ nachgerechnet. */
export function parseSet(reply) {
  const s = String(reply || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  let j = null; if (a >= 0 && b > a) try { j = JSON.parse(s.slice(a, b + 1)); } catch { j = null; }
  if (!j || !Array.isArray(j.tasks)) return null;
  const tasks = [];
  for (const x of j.tasks.slice(0, 12)) {
    if (!x || typeof x !== "object") continue;
    const q = clean(x.q || x.question, 600); if (!q) continue;
    const steps = (Array.isArray(x.steps) ? x.steps : []).map((y) => clean(y, 240)).filter(Boolean).slice(0, 8), hint = clean(x.hint, 240);
    if (Array.isArray(x.choices)) {
      const choices = x.choices.map((c) => clean(c, 160)).filter(Boolean).slice(0, 5), ans = Math.round(Number(x.answer));
      if (choices.length >= 2 && ans >= 0 && ans < choices.length) tasks.push({ q, kind: "choice", choices, answer: ans, steps, hint });
      continue;
    }
    const dec = Math.max(0, Math.min(4, Math.round(Number(x.dec ?? 2)) || 0));
    const c = calc(x.calc), given = typeof x.answer === "number" ? x.answer : parseNum(x.answer);
    const answer = c != null ? round(c, dec) : given; // nachgerechnet geht vor
    if (answer == null || !Number.isFinite(answer)) continue;
    tasks.push({ q, kind: "num", answer, dec, unit: clean(x.unit, 12), calc: c != null ? clean(x.calc, 200) : "", steps, hint, fixed: c != null && given != null && Math.abs(round(given, dec) - answer) > 1e-9 });
  }
  return tasks.length ? { title: clean(j.title, 80) || "Übung", tasks } : null;
}

/** Ergebnis einer Runde → Statistik des Sets */
export function addResult(set, right, total, now = Date.now()) {
  const st = set.stats || { runs: 0, best: 0, last: 0 };
  const pct = total ? Math.round((right / total) * 100) : 0;
  return { ...set, stats: { runs: st.runs + 1, best: Math.max(st.best || 0, pct), last: pct, at: now } };
}
