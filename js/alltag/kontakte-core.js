// Update 10 E – 👤 Kunden & Kontakte: reine Logik ohne DOM (Node-testbar, auch vom Assistenten-Werkzeug „kontakte_lesen“ benutzt).
// Sammlung „kontakte“ (users/{uid}/a_kontakte). Telefon/E-Mail sind nur Text + tel:/mailto:-Links – die App schickt nichts selbst.
// Felder: name, type ("kunde"|"firma"|"privat"), company, person (Ansprechpartner), phone, email, address, notes,
//   calls: [{ id, date, text }] (Gesprächsnotizen), jobs: [{ id, title, date, status, note }] (Aufträge), placeIds: [] (Baustellen),
//   created, updated
const s = (v) => String(v ?? "").trim();
const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ""));

export const TYPES = [
  { id: "kunde", e: "🤝", label: "Kunde" },
  { id: "firma", e: "🏢", label: "Firma" },
  { id: "privat", e: "🏡", label: "Privat" },
];
export const JOB_STATUS = [
  { id: "offen", e: "📝", label: "Offen" },
  { id: "laeuft", e: "🔨", label: "In Arbeit" },
  { id: "fertig", e: "✅", label: "Erledigt" },
];
export const typeById = (id) => TYPES.find((t) => t.id === id) || TYPES[0];
export const jobStatusById = (id) => JOB_STATUS.find((t) => t.id === id) || JOB_STATUS[0];

/** Telefonnummer für tel: (nur Ziffern und führendes +). */
export function telHref(phone) {
  const p = s(phone).replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return p.replace(/\D/g, "").length >= 3 ? "tel:" + p : "";
}
/** E-Mail für mailto: (nur wenn sie plausibel aussieht). */
export function mailHref(email) {
  const e = s(email);
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(e) ? "mailto:" + e : "";
}

const listOf = (v, fn, max) => (Array.isArray(v) ? v : []).map(fn).filter(Boolean).slice(-max);

export function normContact(x) {
  const c = x && typeof x === "object" ? x : {};
  return {
    id: s(c.id), name: s(c.name).slice(0, 120), type: typeById(c.type).id, company: s(c.company).slice(0, 120), person: s(c.person).slice(0, 120),
    phone: s(c.phone).slice(0, 40), email: s(c.email).slice(0, 120), address: s(c.address).slice(0, 240), notes: s(c.notes).slice(0, 4000),
    calls: listOf(c.calls, (n) => (n && s(n.text) ? { id: s(n.id) || s(n.date) + s(n.text).slice(0, 6), date: isKey(n.date) ? n.date : "", text: s(n.text).slice(0, 2000) } : null), 300)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    jobs: listOf(c.jobs, (j) => (j && s(j.title) ? { id: s(j.id) || s(j.title).slice(0, 8), title: s(j.title).slice(0, 140), date: isKey(j.date) ? j.date : "", status: jobStatusById(j.status).id, note: s(j.note).slice(0, 1000), placeId: s(j.placeId) } : null), 300),
    placeIds: [...new Set((Array.isArray(c.placeIds) ? c.placeIds : []).map(s).filter(Boolean))].slice(0, 50),
    created: Number(c.created) || 0, updated: Number(c.updated) || 0,
  };
}

export const displayName = (c) => c.name || c.company || c.person || "Kontakt";

/** Kontakt für eine Baustelle: place.customerId hat Vorrang, sonst ein Kontakt mit dieser Baustelle in placeIds. */
export function customerOfPlace(place, contacts) {
  if (!place) return null;
  const list = (contacts || []).map(normContact).filter((c) => c.id);
  if (place.customerId) { const c = list.find((x) => x.id === place.customerId); if (c) return c; }
  return list.find((c) => c.placeIds.includes(place.id)) || null;
}

/**
 * Verlauf (neueste zuerst): Gesprächsnotizen, Aufträge, Baustellen-Arbeitstage (aus entries), verknüpfte Dokumente.
 * → [{ date, e, text, kind }]
 */
export function history(c, { entries = [], places = [], docs = [] } = {}) {
  const out = [];
  for (const n of c.calls) out.push({ date: n.date, e: "📞", text: n.text, kind: "call" });
  for (const j of c.jobs) out.push({ date: j.date, e: jobStatusById(j.status).e, text: `Auftrag: ${j.title}`, kind: "job" });
  const pids = new Set(c.placeIds);
  const days = new Map();
  for (const e of entries || []) {
    if (!e || !pids.has(e.placeId) || !e.start) continue;
    const d = new Date(e.start);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.set(k + "|" + e.placeId, { k, pid: e.placeId });
  }
  for (const { k, pid } of days.values()) {
    const p = (places || []).find((x) => x && x.id === pid);
    out.push({ date: k, e: "🏗️", text: `Gearbeitet: ${(p && p.name) || "Baustelle"}`, kind: "work" });
  }
  for (const d of docs || []) out.push({ date: d.date || "", e: "📎", text: `Dokument: ${d.title}`, kind: "doc" });
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function filterContacts(list, { q = "", type = "" } = {}) {
  const f = s(q).toLowerCase();
  return (list || []).map(normContact).filter((c) => c.id && (c.name || c.company || c.person))
    .filter((c) => !type || c.type === type)
    .filter((c) => !f || searchText(c).toLowerCase().includes(f))
    .sort((a, b) => displayName(a).localeCompare(displayName(b), "de"));
}

export const openJobs = (c) => c.jobs.filter((j) => j.status !== "fertig");

export const contactHash = (id) => `#alltag/kontakte/${encodeURIComponent(s(id))}`;
export function routeId(hash) {
  const m = /#?alltag\/kontakte\/([^?/]+)/.exec(String(hash || ""));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
export function searchText(raw) {
  const c = raw && raw.calls ? raw : normContact(raw);
  return [c.name, c.company, c.person, c.phone, c.phone.replace(/\D/g, ""), c.email, c.address, typeById(c.type).label, c.notes,
    c.jobs.map((j) => j.title).join(" "), c.calls.map((n) => n.text).join(" ")].join(" ");
}
