// ✏️ Bereich auf einem Foto markieren: mit dem Finger einen Rahmen um die eigene Rechnung ziehen.
// Gibt eine neue Bild-Datei nur mit dem markierten Ausschnitt zurück (oder das ganze Foto / null bei Abbruch).

/** Rahmen-Rechteck (in Bildpixeln) aus zwei Punkten, begrenzt aufs Bild; zu klein → null */
export function rectFrom(a, b, w, h, min = 24) {
  const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(w, Math.max(a.x, b.x)), y1 = Math.min(h, Math.max(a.y, b.y));
  return x1 - x0 >= min && y1 - y0 >= min ? { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) } : null;
}

export function markArea(file, { title = "Markier deine Rechnung", hint = "Zieh mit dem Finger einen Rahmen um die Rechnung, die geprüft werden soll." } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const ov = document.createElement("div");
    ov.className = "pm-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", title);
    ov.innerHTML = `<header class="pm-top"><b>✏️ ${title}</b><small>${hint}</small></header>
      <div class="pm-stage"><img alt="Dein Foto" draggable="false"><div class="pm-box" hidden></div><div class="pm-dim" hidden></div></div>
      <div class="pm-bar"><button type="button" class="btn ghost" data-x="cancel">Abbrechen</button><button type="button" class="btn" data-x="all">Ganzes Foto</button><button type="button" class="btn primary" data-x="ok" disabled>✓ Prüfen</button></div>`;
    document.body.appendChild(ov); document.documentElement.classList.add("pm-open");
    const img = ov.querySelector("img"), box = ov.querySelector(".pm-box"), ok = ov.querySelector("[data-x=ok]"), stage = ov.querySelector(".pm-stage");
    let rect = null, start = null;
    const done = (v) => { URL.revokeObjectURL(url); ov.remove(); document.documentElement.classList.remove("pm-open"); resolve(v); };
    img.src = url;
    const toImg = (e) => { const r = img.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * img.naturalWidth, y: ((e.clientY - r.top) / r.height) * img.naturalHeight, r }; };
    const draw = () => {
      if (!rect) { box.hidden = true; ok.disabled = true; return; }
      const r = img.getBoundingClientRect(), s = stage.getBoundingClientRect(), k = r.width / img.naturalWidth;
      Object.assign(box.style, { left: `${r.left - s.left + rect.x * k}px`, top: `${r.top - s.top + rect.y * k}px`, width: `${rect.w * k}px`, height: `${rect.h * k}px` });
      box.hidden = false; ok.disabled = false;
    };
    stage.addEventListener("pointerdown", (e) => { if (!img.naturalWidth) return; e.preventDefault(); try { stage.setPointerCapture(e.pointerId); } catch { /* egal */ } start = toImg(e); });
    stage.addEventListener("pointermove", (e) => { if (!start) return; const p = toImg(e); rect = rectFrom(start, p, img.naturalWidth, img.naturalHeight, 8); draw(); });
    const end = (e) => { if (!start) return; const p = toImg(e); rect = rectFrom(start, p, img.naturalWidth, img.naturalHeight); start = null; draw(); };
    stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", () => { start = null; });
    window.addEventListener("resize", draw);
    ov.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-x]"); if (!b || b.disabled) return;
      if (b.dataset.x === "cancel") return done(null);
      if (b.dataset.x === "all") return done(file);
      const cv = document.createElement("canvas"); cv.width = rect.w; cv.height = rect.h;
      cv.getContext("2d").drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
      const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.92));
      done(blob ? new File([blob], "ausschnitt.jpg", { type: "image/jpeg" }) : file);
    });
  });
}
