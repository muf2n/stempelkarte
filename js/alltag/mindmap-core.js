// Mindmaps zum Lernen – reine Logik (ohne DOM, in Node testbar).
// Eine Mindmap = { id, title, subject, nodes: [{ id, p, t, c?, fold? }], updated }
//   p = Eltern-ID (null = Mitte), t = Text, c = Farbe (nur Hauptäste), fold = eingeklappt.

export const MM_COLORS = ["#5b7cfa", "#f59e0b", "#3fae7a", "#ec4899", "#a855f7", "#14b8a6", "#ef4444", "#f97316", "#0ea5e9", "#84cc16"];
export const MAX_NODES = 300, MAX_TEXT = 120;

let seq = 0;
export const nid = () => "n" + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);
const clean = (v, n = MAX_TEXT) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export function newMap(title = "Neues Thema", subject = "") {
  return { title: clean(title, 80) || "Neues Thema", subject: clean(subject, 40), nodes: [{ id: "root", p: null, t: clean(title) || "Neues Thema" }] };
}

/** Kaputte Daten reparieren: genau eine Mitte, Eltern existieren, keine Kreise, Grenzen. */
export function normalize(map) {
  const src = Array.isArray(map && map.nodes) ? map.nodes.slice(0, MAX_NODES) : [];
  const nodes = [], ids = new Set();
  const root = src.find((n) => n && n.p == null) || { id: "root", t: (map && map.title) || "Thema" };
  nodes.push({ id: String(root.id || "root"), p: null, t: clean(root.t) || "Thema" }); ids.add(nodes[0].id);
  let rest = src.filter((n) => n && n !== root && n.id != null), guard = 0;
  while (rest.length && guard++ < 50) { // Eltern vor Kindern einsortieren (so gibt es keine Kreise)
    const next = [];
    for (const n of rest) {
      const id = String(n.id);
      if (ids.has(id)) continue;
      if (ids.has(String(n.p))) { const o = { id, p: String(n.p), t: clean(n.t) || "…" }; if (n.c && /^#[0-9a-f]{6}$/i.test(n.c)) o.c = n.c; if (n.fold) o.fold = true; nodes.push(o); ids.add(id); }
      else next.push(n);
    }
    if (next.length === rest.length) break;
    rest = next;
  }
  return { ...map, title: nodes[0].t.slice(0, 80), nodes };
}

export const kids = (nodes, id) => nodes.filter((n) => n.p === id);
export const nodeOf = (nodes, id) => nodes.find((n) => n.id === id) || null;
export function depthOf(nodes, id) { let d = 0, n = nodeOf(nodes, id); while (n && n.p != null && d < 99) { n = nodeOf(nodes, n.p); d++; } return d; }
/** Hauptast (Kind der Mitte), zu dem ein Knoten gehört */
export function branchOf(nodes, id) { let n = nodeOf(nodes, id), prev = null; while (n && n.p != null) { prev = n; n = nodeOf(nodes, n.p); } return prev; }
export function colorOf(nodes, id) {
  const b = branchOf(nodes, id); if (!b) return "#334155";
  return b.c || MM_COLORS[Math.max(0, kids(nodes, nodes[0].id).indexOf(b)) % MM_COLORS.length];
}
export function subtreeIds(nodes, id) { const out = [id]; for (let i = 0; i < out.length; i++) for (const k of kids(nodes, out[i])) out.push(k.id); return out; }

export function addChild(nodes, pid, t = "Neuer Punkt") {
  if (nodes.length >= MAX_NODES || !nodeOf(nodes, pid)) return { nodes, id: null };
  const id = nid(); return { nodes: nodes.map((n) => (n.id === pid && n.fold ? { ...n, fold: false } : n)).concat({ id, p: pid, t: clean(t) || "…" }), id };
}
export function addSibling(nodes, id, t = "Neuer Punkt") {
  const n = nodeOf(nodes, id); if (!n || n.p == null) return addChild(nodes, id, t);
  if (nodes.length >= MAX_NODES) return { nodes, id: null };
  const nn = { id: nid(), p: n.p, t: clean(t) || "…" }, i = nodes.indexOf(n);
  return { nodes: [...nodes.slice(0, i + 1), nn, ...nodes.slice(i + 1)], id: nn.id };
}
export function setText(nodes, id, t) { const v = clean(t); return v ? nodes.map((n) => (n.id === id ? { ...n, t: v } : n)) : nodes; }
export function setColor(nodes, id, c) { return nodes.map((n) => (n.id === id ? { ...n, c } : n)); }
export function toggleFold(nodes, id) { return nodes.map((n) => (n.id === id ? { ...n, fold: !n.fold } : n)); }
export function removeNode(nodes, id) { const n = nodeOf(nodes, id); if (!n || n.p == null) return nodes; const del = new Set(subtreeIds(nodes, id)); return nodes.filter((x) => !del.has(x.id)); }
/** Knoten eine Stelle nach oben/unten unter den Geschwistern */
export function moveSibling(nodes, id, dir) {
  const n = nodeOf(nodes, id); if (!n || n.p == null) return nodes;
  const sib = kids(nodes, n.p), j = sib.indexOf(n) + dir; if (j < 0 || j >= sib.length) return nodes;
  const a = nodes.indexOf(n), b = nodes.indexOf(sib[j]), out = nodes.slice(); out[a] = sib[j]; out[b] = n; return out;
}

/* ---------- Layout: Mitte, Hauptäste abwechselnd links/rechts, Bäume waagrecht ---------- */
export const GAP_X = 56, GAP_Y = 14;
/** measure(text, depth) → {w, h}. Ergebnis: Map id → {x, y, w, h, side, depth} (x/y = Mitte des Knotens) */
export function layout(nodes, measure, { reveal = null } = {}) {
  const pos = new Map(), root = nodes[0]; if (!root) return pos;
  const size = new Map(); for (const n of nodes) size.set(n.id, measure(n.t, depthOf(nodes, n.id), n.id));
  const visKids = (id) => { const n = nodeOf(nodes, id); return n && n.fold ? [] : kids(nodes, id); };
  const hOf = new Map();
  const H = (id) => { if (hOf.has(id)) return hOf.get(id); const k = visKids(id), own = size.get(id).h; const v = k.length ? Math.max(own, k.reduce((a, c) => a + H(c.id), 0) + GAP_Y * (k.length - 1)) : own; hOf.set(id, v); return v; };
  const rs = size.get(root.id); pos.set(root.id, { x: 0, y: 0, ...rs, side: 0, depth: 0 });
  // Hauptäste so verteilen, dass beide Seiten ungefähr gleich hoch sind (Reihenfolge bleibt erhalten)
  const main = visKids(root.id), total = main.reduce((a, c) => a + H(c.id), 0);
  let acc = 0; const right = [], left = [];
  for (const c of main) { (acc + H(c.id) / 2 <= total / 2 || !right.length ? right : left).push(c); acc += H(c.id); }
  const place = (id, side, xEdge, yTop, depth) => {
    const s = size.get(id), h = H(id), x = xEdge + side * s.w / 2, y = yTop + h / 2;
    pos.set(id, { x, y, ...s, side, depth });
    const k = visKids(id); if (!k.length) return;
    const kh = k.reduce((a, c) => a + H(c.id), 0) + GAP_Y * (k.length - 1); let yy = y - kh / 2;
    for (const c of k) { place(c.id, side, x + side * (s.w / 2 + GAP_X), yy, depth + 1); yy += H(c.id) + GAP_Y; }
  };
  for (const [list, side] of [[right, 1], [left, -1]]) {
    const hh = list.reduce((a, c) => a + H(c.id), 0) + GAP_Y * Math.max(0, list.length - 1); let y = -hh / 2;
    for (const c of list) { place(c.id, side, side * (rs.w / 2 + GAP_X * 1.3), y, 1); y += H(c.id) + GAP_Y; }
  }
  return pos;
}
export function bounds(pos) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pos.values()) { x0 = Math.min(x0, p.x - p.w / 2); x1 = Math.max(x1, p.x + p.w / 2); y0 = Math.min(y0, p.y - p.h / 2); y1 = Math.max(y1, p.y + p.h / 2); }
  return isFinite(x0) ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
}

/* ---------- Text umbrechen (Breite über measureText-Funktion) ---------- */
export function wrap(text, maxW, tw, maxLines = 4) {
  const words = String(text).split(" "), lines = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (tw(t) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const l = lines.slice(0, maxLines); l[maxLines - 1] = l[maxLines - 1].replace(/\s*\S*$/, "") + " …"; return l; }
  return lines;
}

/* ---------- KI: Claude-Antwort → Knoten ---------- */
export function fromAI(reply) {
  const s = String(reply || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  let j = null; if (a >= 0 && b > a) try { j = JSON.parse(s.slice(a, b + 1)); } catch { j = null; }
  if (!j || !clean(j.title)) return null;
  const nodes = [{ id: "root", p: null, t: clean(j.title) }];
  const walk = (arr, pid, d) => {
    if (!Array.isArray(arr) || d > 4) return;
    for (const x of arr.slice(0, 12)) {
      if (nodes.length >= 80) return;
      const t = clean(typeof x === "string" ? x : x && (x.t || x.text || x.title)); if (!t) continue;
      const id = nid(); nodes.push({ id, p: pid, t }); if (x && typeof x === "object") walk(x.children || x.c, id, d + 1);
    }
  };
  walk(j.children, "root", 1);
  return nodes.length > 1 ? { title: nodes[0].t.slice(0, 80), nodes } : null;
}

/* ---------- Als Gliederung (Text) ---------- */
export function outline(nodes) {
  const out = []; const rec = (id, d) => { const n = nodeOf(nodes, id); out.push(`${"  ".repeat(d)}${d ? "• " : ""}${n.t}`); for (const k of kids(nodes, id)) rec(k.id, d + 1); };
  if (nodes[0]) rec(nodes[0].id, 0); return out.join("\n");
}
