// Update 9 – Kalender: Termine im Zeitraster verschieben (lange drücken + ziehen) und Dauer ändern (Griff unten).
// Pointer Events: Maus sofort nach kurzer Bewegung, Touch/Stift nach langem Drücken (380 ms); Raster 15 Minuten.

const SNAP = 15;
const LONG_MS = 380;
const snap = (m) => Math.round(m / SNAP) * SNAP;
const pad = (n) => String(n).padStart(2, "0");
const hm = (m) => (m >= 1440 ? "24:00" : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);

/**
 * root: Element, in dem die Raster gezeichnet werden.
 * onDrop({id, key, fromDay, day, start, end, mode: "move"|"resize"}) – Rückgabe egal; danach zeichnet der Aufrufer neu.
 * onCancel() – Ziehen abgebrochen / nichts geändert (Aufrufer zeichnet neu).
 */
export function attachDnD(root, { onDrop, onCancel }) {
  let st = null;

  const blockScroll = (ev) => { if (st && st.active) ev.preventDefault(); };
  document.addEventListener("touchmove", blockScroll, { passive: false });
  root.addEventListener("contextmenu", (ev) => { if (ev.target.closest(".pl-blk[data-ev]")) ev.preventDefault(); });

  root.addEventListener("pointerdown", (ev) => {
    if (ev.button > 0 || st) return;
    const blk = ev.target.closest(".pl-blk[data-ev]");
    if (!blk || !root.contains(blk) || ev.target.closest(".pl-chk")) return;
    const sc = blk.closest("[data-pscroll]");
    if (!sc) return;
    const [id, key] = blk.dataset.ev.split("|");
    const s0 = Number(blk.dataset.s), e0 = Number(blk.dataset.e);
    const rsz = !!ev.target.closest("[data-rsz]");
    st = {
      blk, sc, id, key, s0, e0, s: s0, e: e0, day0: blk.dataset.day, day: blk.dataset.day,
      H: Number(sc.dataset.h) || 56, mode: rsz ? "resize" : "move", pid: ev.pointerId,
      x0: ev.clientX, y0: ev.clientY, active: false, timer: null, touch: ev.pointerType !== "mouse",
      grab: 0,
    };
    if (rsz) { ev.preventDefault(); begin(ev); }
    else if (st.touch) st.timer = setTimeout(() => { if (st && !st.active) begin(null); }, LONG_MS);
  });

  function begin(ev) {
    if (!st) return;
    st.active = true;
    const r = st.blk.getBoundingClientRect();
    st.grab = ((st.y0 - r.top) / st.H) * 60;
    st.blk.classList.add("dragging");
    st.sc.classList.add("is-dragging");
    try { st.blk.setPointerCapture(st.pid); } catch { /* egal */ }
    try { if (st.touch && navigator.vibrate) navigator.vibrate(12); } catch { /* egal */ }
    label();
    if (ev) move(ev);
  }

  function colAt(x) {
    const cols = [...st.sc.querySelectorAll("[data-pcol]")];
    for (const c of cols) { const r = c.getBoundingClientRect(); if (x >= r.left && x < r.right) return c; }
    return x < cols[0].getBoundingClientRect().left ? cols[0] : cols[cols.length - 1];
  }

  function label() {
    const s = st.blk.querySelector(".pl-blk-s") || st.blk.querySelector(".pl-blk-t");
    st.blk.dataset.time = `${hm(st.s)}–${hm(st.e)}`;
    if (s) s.setAttribute("data-time", st.blk.dataset.time);
  }

  function move(ev) {
    const col = colAt(ev.clientX);
    const cr = col.getBoundingClientRect();
    const atY = ((ev.clientY - cr.top) / st.H) * 60;
    if (st.mode === "resize") {
      st.e = Math.min(1440, Math.max(st.s + SNAP, snap(atY)));
    } else {
      const dur = st.e0 - st.s0;
      st.s = Math.min(1440 - SNAP, Math.max(0, snap(atY - st.grab)));
      st.e = Math.min(1440, st.s + dur);
      if (col.dataset.pcol !== st.day) { st.day = col.dataset.pcol; col.appendChild(st.blk); }
    }
    const b = st.blk.style;
    b.top = `${(st.s / 60) * st.H}px`;
    b.height = `${Math.max(18, ((st.e - st.s) / 60) * st.H - 2)}px`;
    if (st.mode === "move") { b.left = "1px"; b.width = "calc(100% - 3px)"; }
    label();
    // am Rand automatisch scrollen
    const sr = st.sc.getBoundingClientRect();
    if (ev.clientY < sr.top + 36) st.sc.scrollTop -= 10;
    else if (ev.clientY > sr.bottom - 36) st.sc.scrollTop += 10;
  }

  window.addEventListener("pointermove", (ev) => {
    if (!st || ev.pointerId !== st.pid) return;
    if (!st.active) {
      const d = Math.hypot(ev.clientX - st.x0, ev.clientY - st.y0);
      if (st.touch) { if (d > 8) cancel(false); }
      else if (d > 4) begin(ev);
      return;
    }
    ev.preventDefault();
    move(ev);
  }, { passive: false });

  const end = (ev) => {
    if (!st || (ev && ev.pointerId !== st.pid)) return;
    clearTimeout(st.timer);
    if (!st.active) { st = null; return; }
    const s = st;
    st = null;
    s.blk.classList.remove("dragging");
    s.sc.classList.remove("is-dragging");
    // Klick nach dem Ziehen nicht als Antippen werten
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 400);
    if (s.s === s.s0 && s.e === s.e0 && s.day === s.day0) { onCancel && onCancel(); return; }
    onDrop({ id: s.id, key: s.key, fromDay: s.day0, day: s.day, start: s.s, end: s.e, mode: s.mode });
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", (ev) => {
    if (!st || ev.pointerId !== st.pid) return;
    cancel(true);
  });

  function cancel(redraw) {
    if (!st) return;
    clearTimeout(st.timer);
    const was = st.active;
    st.blk.classList.remove("dragging");
    st.sc.classList.remove("is-dragging");
    st = null;
    if (was && redraw && onCancel) onCancel();
  }
}

export { hm as fmtMin };
