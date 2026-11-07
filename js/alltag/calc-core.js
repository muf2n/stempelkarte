// Taschenrechner – sicherer Ausdrucks-Parser (kein eval; die CSP verbietet es ohnehin).
// Unterstützt: + − × ÷ ^ %, Klammern, Kommazahlen (1,5 oder 1.5), √, π, unäres Minus.
// Prozent wie am Taschenrechner: 200 + 10% = 220, 200 − 10% = 180, 200 × 10% = 20, 50% = 0,5.

const OPS = { "+": [1, "L"], "-": [1, "L"], "*": [2, "L"], "/": [2, "L"], "^": [3, "R"] };

export function tokenize(src) {
  const s = String(src || "")
    .replace(/[×xX·]/g, "*").replace(/[÷:]/g, "/").replace(/[−–]/g, "-")
    .replace(/π/g, "p").replace(/\s+/g, "");
  const out = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/[0-9.,]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.,]/.test(s[j])) j++;
      const raw = s.slice(i, j).replace(",", ".");
      if ((raw.match(/\./g) || []).length > 1 || raw === ".") throw new Error("Ungültige Zahl");
      out.push({ t: "num", v: Number(raw) });
      i = j;
    } else if (c === "p") { out.push({ t: "num", v: Math.PI }); i++; }
    else if (c === "√") { out.push({ t: "fn", v: "sqrt" }); i++; }
    else if (c === "%") { out.push({ t: "pct" }); i++; }
    else if (c === "(" || c === ")") { out.push({ t: c }); i++; }
    else if (OPS[c]) { out.push({ t: "op", v: c }); i++; }
    else throw new Error("Unbekanntes Zeichen: " + c);
  }
  return out;
}

/** Rekursiver Abstieg mit Taschenrechner-Prozent. */
export function evaluate(src) {
  const toks = tokenize(src);
  if (!toks.length) throw new Error("Leer");
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];

  // primary := num | ( expr ) | √ primary | - primary ; danach optional %
  function primary() {
    const t = next();
    if (!t) throw new Error("Unvollständig");
    let v;
    if (t.t === "num") v = t.v;
    else if (t.t === "(") { v = expr(0); if (!peek() || peek().t !== ")") throw new Error("Klammer fehlt"); next(); }
    else if (t.t === "fn") { const a = unwrap(power()); if (a < 0) throw new Error("Wurzel aus negativer Zahl"); v = Math.sqrt(a); }
    else if (t.t === "op" && (t.v === "-" || t.v === "+")) { const a = unwrap(power()); v = t.v === "-" ? -a : a; }
    else throw new Error("Unerwartet");
    // implizites Mal: 2(3) oder 2π oder (2)(3)
    return v;
  }
  function power() {
    let v = primary();
    let pct = false;
    while (peek() && peek().t === "pct") { next(); pct = true; v = v / 100; }
    if (pct) return { pct: true, v };
    if (peek() && peek().t === "op" && peek().v === "^") { next(); const e = unwrap(power()); v = Math.pow(v, e); }
    return v;
  }
  const unwrap = (x) => (typeof x === "object" ? x.v : x);

  // expr mit Präzedenz; Prozent bei + / − bezieht sich auf den linken Wert
  function expr(minPrec) {
    let left = unwrap(power());
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.t === "num" || t.t === "(" || t.t === "fn") { // implizites Mal
        if (OPS["*"][0] < minPrec) break;
        const r = unwrap(power());
        left = left * r;
        continue;
      }
      if (t.t !== "op") break;
      const [prec, assoc] = OPS[t.v];
      if (prec < minPrec) break;
      next();
      const rhsRaw = rhs(assoc === "L" ? prec + 1 : prec);
      const r = typeof rhsRaw === "object" ? (t.v === "+" || t.v === "-" ? left * rhsRaw.v : rhsRaw.v) : rhsRaw;
      if (t.v === "+") left += r;
      else if (t.v === "-") left -= r;
      else if (t.v === "*") left *= r;
      else if (t.v === "/") { if (r === 0) throw new Error("Division durch 0"); left /= r; }
      else left = Math.pow(left, r);
    }
    return left;
  }
  // rechte Seite: wenn sie nur „Zahl %“ ist, Prozent-Info durchreichen
  function rhs(minPrec) {
    const start = i;
    const p = power();
    if (typeof p === "object" && (!peek() || peek().t === ")" || (peek().t === "op" && OPS[peek().v][0] < minPrec))) return p;
    i = start;
    return expr(minPrec);
  }

  const v = expr(0);
  if (i < toks.length) throw new Error(peek().t === ")" ? "Klammer zu viel" : "Unerwartet");
  if (!Number.isFinite(v)) throw new Error("Ergebnis zu groß");
  return v;
}

/** Österreichisches Zahlenformat, max. 10 signifikante Nachkommastellen, ohne Rundungsfehler-Schwanz. */
export function format(v) {
  if (!Number.isFinite(v)) return "Fehler";
  const r = Number.parseFloat(v.toPrecision(12));
  if (Math.abs(r) >= 1e12 || (Math.abs(r) < 1e-9 && r !== 0)) return r.toExponential(6).replace(".", ",");
  return r.toLocaleString("de-DE", { maximumFractionDigits: 10 });
}
