// Update 12 – 💼 Karriere – reine Logik (kein DOM).
// Sammlungen:
//   „karriere“ – ein Dokument "cv": { id:"cv", headline, about, email, phone, city, skills: [{ name, level 1–5, cat }], languages: [{ name, level }],
//                 cv: [{ id, kind: ausbildung|arbeit|schule|praktikum|ehrenamt, title, org, from (YYYY-MM), to (YYYY-MM|""), text }], hobbies, goals: [{ id, text, due, done }] }
//   „karriere_certs“ – { id, kind: zertifikat|kurs|fuehrerschein|unterweisung, title, issuer, date, expires, note }
//   „karriere_jobs“  – { id, company, position, status, applied (YYYY-MM-DD), next (YYYY-MM-DD), nextWhat, contact, link, note, prep: { [i]: true } }
// Ausbildungsdaten (Lehrbeginn, Jahre, Beruf, Betrieb) kommen aus settings.apprentice (js/views/report.js).

const s = (v) => (v == null ? "" : String(v)).trim();
const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(s(k));
const isMonth = (k) => /^\d{4}-\d{2}$/.test(s(k));
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d || 1, 12); };
export const diffDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
export const fmtDay = (k) => (isKey(k) ? `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}` : "");
export const fmtMonth = (k) => (isMonth(k) ? `${k.slice(5, 7)}/${k.slice(0, 4)}` : "");

export const CV_KINDS = [["ausbildung", "🎓", "Ausbildung"], ["arbeit", "🛠️", "Berufserfahrung"], ["praktikum", "🔎", "Praktikum"], ["schule", "🏫", "Schule"], ["ehrenamt", "🤝", "Ehrenamt"]];
export const SKILL_CATS = [["fach", "⚡ Fachlich"], ["werkzeug", "🧰 Werkzeuge & Software"], ["soft", "🤝 Persönlich"]];
export const LANG_LEVELS = ["Grundkenntnisse", "Gut", "Sehr gut", "Fließend", "Muttersprache"];
export const CERT_KINDS = [["zertifikat", "🏅", "Zertifikat"], ["kurs", "📘", "Kurs / Weiterbildung"], ["fuehrerschein", "🚗", "Führerschein / Berechtigung"], ["unterweisung", "🦺", "Unterweisung / Schulung"]];
export const JOB_STATUS = [["idee", "💭", "Interessant"], ["gesendet", "📨", "Beworben"], ["gespraech", "🗣️", "Gespräch"], ["zusage", "🎉", "Zusage"], ["absage", "🙅", "Absage"]];
export const jobStatus = (id) => JOB_STATUS.find((x) => x[0] === id) || JOB_STATUS[0];

/** Checkliste fürs Vorstellungsgespräch (Elektro-Lehre / Facharbeiter). */
export const PREP = [
  "Firma recherchiert (Website, Projekte, Größe)",
  "Antwort auf „Erzählen Sie etwas über sich“ geübt",
  "3 Stärken + 1 Schwäche mit Beispiel überlegt",
  "Beispiel einer Baustelle/eines Projekts vorbereitet",
  "Fachfragen wiederholt (FI/LS, Schutzmaßnahmen, ÖVE/ÖNORM)",
  "Eigene Fragen an die Firma notiert",
  "Unterlagen: Lebenslauf, Zeugnisse, Zertifikate dabei",
  "Anfahrt geplant, 10 Minuten früher da",
];
export const QUESTIONS = [
  "Warum möchten Sie bei uns arbeiten?",
  "Was haben Sie in Ihrer Lehre am meisten gelernt?",
  "Wie gehen Sie mit Stress auf der Baustelle um?",
  "Erzählen Sie von einem Fehler und was Sie daraus gelernt haben.",
  "Wo sehen Sie sich in 5 Jahren (Meister, Spezialisierung, Weiterbildung)?",
  "Welche Schutzmaßnahmen kennen Sie und wann setzen Sie welche ein?",
  "Wie prüfen Sie eine Anlage vor der Inbetriebnahme?",
  "Welche Gehaltsvorstellung haben Sie?",
];

export function normCv(x = {}) {
  const lim = (v, n) => s(v).slice(0, n);
  return {
    id: "cv", headline: lim(x.headline, 80), about: lim(x.about, 800), email: lim(x.email, 80), phone: lim(x.phone, 40), city: lim(x.city, 60),
    skills: (Array.isArray(x.skills) ? x.skills : []).filter((k) => k && s(k.name)).slice(0, 40)
      .map((k) => ({ name: lim(k.name, 50), level: Math.max(1, Math.min(5, Math.round(Number(k.level) || 3))), cat: SKILL_CATS.some((c) => c[0] === k.cat) ? k.cat : "fach" })),
    languages: (Array.isArray(x.languages) ? x.languages : []).filter((l) => l && s(l.name)).slice(0, 10)
      .map((l) => ({ name: lim(l.name, 30), level: LANG_LEVELS.includes(l.level) ? l.level : LANG_LEVELS[1] })),
    cv: (Array.isArray(x.cv) ? x.cv : []).filter((c) => c && s(c.title)).slice(0, 40).map((c) => ({
      id: s(c.id) || nid(), kind: CV_KINDS.some((k) => k[0] === c.kind) ? c.kind : "arbeit", title: lim(c.title, 80), org: lim(c.org, 80),
      from: isMonth(c.from) ? c.from : "", to: isMonth(c.to) ? c.to : "", text: lim(c.text, 600) })),
    hobbies: lim(x.hobbies, 200),
    goals: (Array.isArray(x.goals) ? x.goals : []).filter((g) => g && s(g.text)).slice(0, 30)
      .map((g) => ({ id: s(g.id) || nid(), text: lim(g.text, 120), due: isMonth(g.due) ? g.due : "", done: !!g.done })),
    updated: Number(x.updated) || 0,
  };
}

/** Lebenslauf-Stationen: laufende zuerst, dann neueste. */
export function sortCv(list) {
  return [...list].sort((a, b) => Number(!a.to && !!a.from ? 0 : 1) - Number(!b.to && !!b.from ? 0 : 1) || (b.to || "9999").localeCompare(a.to || "9999") || (b.from || "").localeCompare(a.from || ""));
}

/** Ausbildung aus den App-Einstellungen als Lebenslauf-Station (wenn noch nicht vorhanden). */
export function apprenticeStation(ap) {
  if (!ap || !ap.start) return null;
  const [y, m] = ap.start.split("-").map(Number);
  const endY = y + Math.floor(ap.years), endM = m + Math.round((ap.years % 1) * 12);
  const end = new Date(endY, endM - 1, 1);
  return { id: "lehre", kind: "ausbildung", title: `Lehre ${ap.trade || "Elektrotechnik"}`, org: ap.company || "", from: ap.start.slice(0, 7), to: "",
    text: `Lehrzeit ${String(ap.years).replace(".", ",")} Jahre, voraussichtliches Ende ${String(end.getMonth() + 1).padStart(2, "0")}/${end.getFullYear()}` };
}

/** Ausbildungsfortschritt in % und Lehrjahr. */
export function apprenticeProgress(ap, todayKey) {
  if (!ap || !ap.start) return null;
  const start = dateOf(ap.start), now = dateOf(todayKey);
  const end = new Date(start); end.setMonth(end.getMonth() + Math.round(ap.years * 12));
  const total = (end - start) / 864e5, done = (now - start) / 864e5;
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  const year = Math.max(1, Math.min(Math.ceil(ap.years), Math.floor(done / 365.25) + 1));
  const daysLeft = Math.max(0, Math.round((end - now) / 864e5));
  return { pct, year, daysLeft, end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}` };
}

export function normCert(x = {}) {
  return { id: s(x.id), kind: CERT_KINDS.some((k) => k[0] === x.kind) ? x.kind : "zertifikat", title: s(x.title).slice(0, 100), issuer: s(x.issuer).slice(0, 80),
    date: isKey(x.date) ? x.date : "", expires: isKey(x.expires) ? x.expires : "", note: s(x.note).slice(0, 400), updated: Number(x.updated) || 0 };
}
/** Ablauf-Zustand: abgelaufen / bald (≤ 60 Tage) / ok / unbefristet. */
export function certState(c, today) {
  if (!c.expires) return "frei";
  const d = diffDays(today, c.expires);
  return d < 0 ? "ab" : d <= 60 ? "bald" : "ok";
}
export function dueCerts(certs, today) {
  return certs.map(normCert).filter((c) => c.id && c.title && ["ab", "bald"].includes(certState(c, today)))
    .map((c) => ({ ...c, days: diffDays(today, c.expires) })).filter((c) => c.days >= -30);
}

export function normJob(x = {}) {
  return { id: s(x.id), company: s(x.company).slice(0, 80), position: s(x.position).slice(0, 80), status: jobStatus(x.status)[0],
    applied: isKey(x.applied) ? x.applied : "", next: isKey(x.next) ? x.next : "", nextWhat: s(x.nextWhat).slice(0, 80),
    contact: s(x.contact).slice(0, 100), link: /^https:\/\/[^\s<>"']+$/i.test(s(x.link)) ? s(x.link).slice(0, 300) : "", note: s(x.note).slice(0, 1000),
    prep: x.prep && typeof x.prep === "object" ? Object.fromEntries(Object.entries(x.prep).filter(([k, v]) => v && Number(k) < PREP.length)) : {}, updated: Number(x.updated) || 0 };
}
export function jobCounts(jobs) {
  const c = Object.fromEntries(JOB_STATUS.map(([id]) => [id, 0]));
  for (const j of jobs) c[normJob(j).status]++;
  return c;
}
/** Offene Bewerbungen: nächster Schritt fällig, oder 14 Tage ohne Antwort → nachfassen. */
export function jobHints(jobs, today) {
  const out = [];
  for (const j of jobs.map(normJob).filter((x) => x.id && x.company)) {
    if (j.status === "zusage" || j.status === "absage") continue;
    if (j.next && diffDays(today, j.next) <= 2 && diffDays(today, j.next) >= -1) out.push({ ...j, hint: `${j.nextWhat || "Termin"} ${j.next === today ? "heute" : fmtDay(j.next)}` });
    else if (j.status === "gesendet" && j.applied && diffDays(j.applied, today) >= 14 && !j.next) out.push({ ...j, hint: "Seit 2 Wochen keine Antwort – nachfragen?" });
  }
  return out;
}
export const prepDone = (j) => Object.keys(normJob(j).prep).length;

/** Lebenslauf als Text (zum Kopieren in Bewerbungsportale). */
export function cvText(cv, name, ap) {
  const c = normCv(cv);
  const lines = [name || "Lebenslauf", c.headline, [c.city, c.email, c.phone].filter(Boolean).join(" · "), "", c.about].filter((x, i) => x || i === 3);
  const st = sortCv([...(ap && !c.cv.some((x) => x.id === "lehre") ? [apprenticeStation(ap)].filter(Boolean) : []), ...c.cv]);
  for (const [k, , label] of CV_KINDS) {
    const list = st.filter((x) => x.kind === k);
    if (!list.length) continue;
    lines.push("", label.toUpperCase());
    for (const x of list) lines.push(`${fmtMonth(x.from) || "?"} – ${x.to ? fmtMonth(x.to) : "heute"}  ${x.title}${x.org ? ", " + x.org : ""}${x.text ? "\n   " + x.text : ""}`);
  }
  if (c.skills.length) { lines.push("", "KENNTNISSE"); for (const [k, l] of SKILL_CATS) { const sk = c.skills.filter((x) => x.cat === k); if (sk.length) lines.push(`${l.replace(/^\S+\s/, "")}: ${sk.map((x) => x.name).join(", ")}`); } }
  if (c.languages.length) lines.push("", "SPRACHEN", c.languages.map((l) => `${l.name} (${l.level})`).join(", "));
  if (c.hobbies) lines.push("", "HOBBYS", c.hobbies);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
