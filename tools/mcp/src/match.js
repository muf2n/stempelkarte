// Unscharfe Namenssuche (Orte, Tätigkeiten, Kategorien, Aufgaben, Fächer).

export function norm(s) {
  return String(s ?? "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Ähnlichkeit 0–100 zwischen Suchtext q und Name n. */
export function score(q, n) {
  const a = norm(q), b = norm(n);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const ca = a.replace(/ /g, ""), cb = b.replace(/ /g, "");
  if (ca === cb) return 98;
  if (cb.startsWith(ca) || ca.startsWith(cb)) return 90;
  if (cb.includes(ca)) return 82;
  if (ca.includes(cb) && cb.length >= 3) return 72;
  const qa = a.split(" "), nb = b.split(" ");
  let hit = 0;
  for (const t of qa) {
    if (nb.some((w) => w === t || (t.length >= 3 && (w.startsWith(t) || t.startsWith(w) && w.length >= 3)) || (t.length >= 4 && lev(t, w) <= 1))) hit++;
  }
  let s = hit ? 50 + Math.round(25 * hit / qa.length) : 0;
  const r = 1 - lev(ca, cb) / Math.max(ca.length, cb.length);
  if (r >= 0.6) s = Math.max(s, Math.round(r * 70));
  return s;
}

/** Bester Treffer {item, score} oder null (Schwelle 50). Mehrdeutig = zweiter fast gleich gut. */
export function best(q, list, nameOf, min = 50) {
  let top = null, second = null;
  for (const it of list || []) {
    const s = score(q, nameOf(it));
    if (!top || s > top.score) { second = top; top = { item: it, score: s }; }
    else if (!second || s > second.score) second = { item: it, score: s };
  }
  if (!top || top.score < min) return null;
  return { ...top, ambiguous: !!(second && second.score >= min && top.score < 100 && top.score - second.score < 5), second: second && second.score >= min ? second.item : null };
}
