// Update 9 – iCal-Abos (z. B. Google „Privatadresse im iCal-Format“): reine Logik ohne DOM/Netz (in Node testbar).
//   checkFeedUrl(text)            → {ok, url, error}  (webcal:// wird zu https://)
//   maskUrl(url)                  → "calendar.google.com/…/basic.ics"
//   googleCalId(url)              → Kalender-ID aus /calendar/ical/<id>/… oder null
//   isHolidayFeed(url)            → enthält „holiday“
//   parseFeed(text)               → [event] (parseICS, alte Einzeltermine > 2 Jahre weggelassen)
//   expandFeed(events, feed, from, to, {skipHoliday}) → Instanzen (Format wie cal-google instFromGoogle)
import { parseICS, expandTodo, addDays, keyTimeToTs } from "./cal-core.js";

const pad = (n) => String(n).padStart(2, "0");

/** Nutzereingabe prüfen. Erlaubt: https (webcal → https), Host calendar.google.com (/calendar/ical/…) oder Pfad auf .ics. */
export function checkFeedUrl(raw) {
  let s = String(raw || "").trim().replace(/^<|>$/g, "");
  if (!s) return { ok: false, error: "Bitte die Adresse einfügen." };
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, "https://");
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: "Das ist keine gültige Adresse. Sie beginnt mit https://" }; }
  if (u.protocol !== "https:") return { ok: false, error: "Nur sichere Adressen (https://) sind erlaubt." };
  if (u.username || u.password || (u.port && u.port !== "443")) return { ok: false, error: "Diese Adresse ist nicht erlaubt." };
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[") || h === "localhost" || /\.(localhost|local|internal)$/.test(h)) {
    return { ok: false, error: "Diese Adresse ist nicht erlaubt." };
  }
  if (h === "calendar.google.com") {
    if (!/^\/calendar\/ical\//.test(u.pathname)) return { ok: false, error: "Das ist nicht die iCal-Adresse. Bitte „Privatadresse im iCal-Format“ kopieren (endet auf …/basic.ics)." };
    if (/\/public\/basic\.ics$/i.test(u.pathname) && !/holiday|#|%23/i.test(u.pathname)) {
      // öffentliche Adresse geht nur bei öffentlichen Kalendern – trotzdem erlauben, aber Hinweis
      return { ok: true, url: u.toString(), warn: "Das ist die öffentliche Adresse – sie funktioniert nur, wenn der Kalender öffentlich ist. Besser die „Privatadresse im iCal-Format“ nehmen." };
    }
    return { ok: true, url: u.toString() };
  }
  if (!/\.ics$/i.test(u.pathname)) return { ok: false, error: "Die Adresse muss auf .ics enden (oder von calendar.google.com sein)." };
  return { ok: true, url: u.toString() };
}

/** Adresse für die Anzeige kürzen – der geheime Teil bleibt verborgen. */
export function maskUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "";
    return `${u.hostname}/…${last ? "/" + (last.length > 24 ? "…" + last.slice(-12) : last) : ""}`;
  } catch { return "…"; }
}

/** Google-Kalender-ID aus der iCal-Adresse (in /ical/<id>/ URL-kodiert). */
export function googleCalId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== "calendar.google.com") return null;
    const m = /^\/calendar\/ical\/([^/]+)\//.exec(u.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

export const isHolidayFeed = (url) => /holiday/i.test(String(url || ""));

/** Vorschlag für den Namen aus der Adresse. */
export function suggestName(url) {
  const id = googleCalId(url);
  if (id) {
    if (isHolidayFeed(id)) return "Feiertage (Google)";
    if (/@gmail\.com$/i.test(id)) return "Google Kalender";
    if (/@group\.calendar\.google\.com$/i.test(id)) return "Google (Gruppe)";
    return "Google Kalender";
  }
  try { return new URL(url).hostname.replace(/^www\./, "").split(".").slice(-2, -1)[0].replace(/^./, (c) => c.toUpperCase()) || "Kalender"; } catch { return "Kalender"; }
}

/**
 * ICS-Text → schlanke Ereignisse für die Anzeige. Einzeltermine, die vor mehr als ~2 Jahren endeten, werden
 * weggelassen (Google-Feeds enthalten die ganze Geschichte – spart Speicher im Offline-Zwischenspeicher).
 */
export function parseFeed(text, { now = Date.now(), keepDays = 750 } = {}) {
  const { events } = parseICS(text);
  const d = new Date(now - keepDays * 864e5);
  const cut = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const out = [];
  for (const e of events) {
    if (!e.rrule && (e.endDate || e.date) < cut) continue;
    const o = { uid: e.uid, title: e.title, date: e.date, time: e.time, endDate: e.endDate, endTime: e.endTime, allDay: e.allDay };
    if (e.location) o.location = e.location;
    if (e.note) o.note = e.note.length > 2000 ? e.note.slice(0, 2000) + " …" : e.note;
    if (e.url) o.url = e.url;
    if (e.rrule) o.rrule = e.rrule;
    if (e.exdates && e.exdates.length) o.exdates = e.exdates;
    if (e.overrides && Object.keys(e.overrides).length) o.overrides = e.overrides;
    out.push(o);
  }
  return out;
}

const b64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return (typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64")).replace(/=+$/, "");
};

/**
 * Link „In Google Kalender öffnen“: nur bei Google-Feeds und UIDs der Form <id>@google.com.
 * eid = base64("<eventId>[_<Instanz>] <kalenderId>"), wie Google sie in seinen Links verwendet.
 * UNSICHER: Format der eid nicht offiziell dokumentiert (aus Google-Links abgeleitet); Serien-Instanz als
 * _YYYYMMDDTHHMMSSZ bzw. _YYYYMMDD (ganztägig).
 */
export function googleLink(ev, calId, inst = null) {
  if (ev.url && /^https:\/\/(www\.)?(calendar\.)?google\.com\//i.test(ev.url)) return ev.url;
  if (!calId) return "";
  const m = /^([A-Za-z0-9_]+)@google\.com$/.exec(String(ev.uid || ""));
  if (!m) return "";
  let eventId = m[1];
  if (ev.rrule && inst) {
    if (ev.allDay) eventId += "_" + inst.key.replace(/-/g, "");
    else {
      const ts = keyTimeToTs(inst.key, ev.time || "00:00");
      const d = new Date(ts);
      eventId += `_${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    }
  }
  const cal = String(calId).replace(/@gmail\.com$/i, "@m");
  return "https://calendar.google.com/calendar/event?eid=" + encodeURIComponent(b64(`${eventId} ${cal}`));
}

/**
 * Ereignisse eines Feeds → Instanzen in [from, to].
 * feed = {id, name, color, gcal (Google-Kalender-ID|null), holiday}
 * skipHoliday(key) → true: Tag ist eingebauter Feiertag (nur bei Feiertags-Feeds, ganztägig) → weglassen.
 */
export function expandFeed(events, feed, from, to, { skipHoliday = null } = {}) {
  const out = [];
  const calendarId = "f:" + feed.id;
  const color = feed.color || null;
  (events || []).forEach((e, n) => {
    if (!e || !e.date) return;
    if (!e.rrule && ((e.endDate || e.date) < addDays(from, -1) || e.date > to)) return;
    const t = {
      id: `${feed.id}~${n}`, kind: "termin", title: e.title, date: e.date, time: e.allDay ? null : e.time,
      endDate: e.endDate || null, endTime: e.allDay ? null : e.endTime, allDay: !!e.allDay,
      location: e.location || "", note: e.note || "", rrule: e.rrule || null,
      exdates: e.exdates || [], overrides: e.overrides || {},
    };
    for (const i of expandTodo(t, from, to)) {
      if (feed.holiday && skipHoliday && i.allDay && skipHoliday(i.date)) continue;
      out.push({
        ...i, t: null, ext: true, feed: true, calendarId, color,
        uid: `f:${feed.id}|${e.uid || n}|${i.key}`, id: e.uid || t.id, cat: null, done: false,
        htmlLink: feed.gcal ? googleLink(e, feed.gcal, i) : "",
      });
    }
  });
  return out;
}
