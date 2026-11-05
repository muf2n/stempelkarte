// Update 9 (Agent B): Einstellungen „Taggeld & Kilometergeld“ (settings.allowance).
// Wird im Einstellungs-Panel (#allowance-panel) eingehängt.
import { icon } from "../icons.js";
import { readAllowance, parseNum } from "../travel.js";
import { readTripSettings, readVehicles, defaultVehicle, vehicleLabel } from "../trip-core.js"; // Update 9 – Fahrtenbuch

let ctx = null;
let root = null;
let snap = null;
let lastPlacesKey = "";

const $ = (sel) => root.querySelector(sel);

function cur() { return readAllowance(snap && snap.settings); }

async function save(partial, msg) {
  const next = { ...cur(), ...partial };
  try {
    await ctx.store.saveSettings({ allowance: next });
    if (msg) ctx.ui.toast(msg);
    return true;
  } catch { return false; }
}

function fmtN(v) { return v == null ? "" : String(v).replace(".", ","); }
function fmtMoney(v) { return v == null ? "" : (Math.round(v * 100) / 100).toFixed(2).replace(".", ","); }
const MONEY = new Set(["ratePart", "rateFull", "kmRate"]);
const show = (key, v) => (MONEY.has(key) ? fmtMoney(v) : fmtN(v));

const NUM_FIELDS = [
  // id, key, min, max, allowEmpty
  ["#al-min", "minHours", 0, 24, false],
  ["#al-full", "fullHours", 0, 24, false],
  ["#al-part-eur", "ratePart", 0, 10000, true],
  ["#al-full-eur", "rateFull", 0, 10000, true],
  ["#al-kmrate", "kmRate", 0, 100, false],
  ["#al-factor", "kmFactor", 1, 3, false],
];

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  root.classList.add("rm", "al");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico">${icon("car", 20)}</span>
      <div><div class="rm-title">Taggeld &amp; Kilometergeld</div>
      <p class="note">Taggeld wird pro Arbeitstag aus der Zeit außerhalb deiner Heim-Orte berechnet (Fahrten zählen mit). Die Regeln hängen von deinem Kollektivvertrag ab – keine Rechtsberatung.</p></div>
    </div>
    <div class="rm-opt">
      <label class="switch"><input type="checkbox" id="al-on"><span>Taggeld berechnen</span></label>
    </div>
    <div class="rm-opts" id="al-opts">
      <div class="rm-opt">
        <div class="lbl">Ab wie vielen Stunden?</div>
        <label class="rm-inline"><span>Teilweise ab</span><input type="text" inputmode="decimal" id="al-min"><span>h</span></label>
        <label class="rm-inline"><span>Volles Taggeld ab</span><input type="text" inputmode="decimal" id="al-full"><span>h</span></label>
      </div>
      <div class="rm-opt">
        <div class="lbl">Beträge</div>
        <label class="rm-inline"><span>Teilweise</span><input type="text" inputmode="decimal" id="al-part-eur" placeholder="13,20"><span>€</span></label>
        <label class="rm-inline"><span>Voll</span><input type="text" inputmode="decimal" id="al-full-eur" placeholder="26,40"><span>€</span></label>
        <p class="note">Beträge laut deinem Kollektivvertrag / Lohnzettel eintragen.</p>
      </div>
      <div class="rm-opt">
        <div class="lbl">Heim-Orte (kein Taggeld)</div>
        <div class="chips al-places" id="al-places" role="group" aria-label="Heim-Orte"></div>
        <p class="note">z. B. Firma, Büro, Lager, Berufsschule. Zeit an diesen Orten zählt nicht als Abwesenheit.</p>
      </div>
    </div>
    <div class="rm-opt">
      <div class="lbl">Kilometer</div>
      <label class="rm-inline"><span>Umwegfaktor</span><input type="text" inputmode="decimal" id="al-factor"><span>× Luftlinie</span></label>
      <label class="switch"><input type="checkbox" id="al-car"><span>Eigenes Auto (Kilometergeld)</span></label>
      <label class="rm-inline" id="al-kmrate-row"><span>Kilometergeld</span><input type="text" inputmode="decimal" id="al-kmrate"><span>€ pro km</span></label>
      <p class="note">Nur bei Fahrten mit deinem eigenen Auto. Mit dem Firmenauto gibt es kein Kilometergeld.</p>
    </div>
    <div class="rm-opt al-fb">
      <div class="lbl">Fahrtenbuch</div>
      <label class="switch"><input type="checkbox" id="al-road"><span>Straßen-km berechnen</span></label>
      <p class="note">Datenschutz: Für die Straßen-km werden Start- und Zielkoordinaten deiner Fahrten an den öffentlichen Routing-Dienst OSRM (router.project-osrm.org) geschickt – einmal pro Fahrt, das Ergebnis wird gespeichert. Ausgeschaltet gilt die Schätzung (Luftlinie × Umwegfaktor).</p>
      <div class="al-veh"><span id="al-veh-txt"></span><button type="button" class="btn ghost sm" id="al-veh">Fahrzeuge verwalten</button></div>
    </div>`;

  $("#al-on").addEventListener("change", (ev) => save({ enabled: ev.target.checked }, ev.target.checked ? "Taggeld wird berechnet" : "Taggeld ausgeschaltet"));
  $("#al-car").addEventListener("change", (ev) => save({ ownCar: ev.target.checked }));
  // Update 9 – Fahrtenbuch: Straßen-km (OSRM) an/aus, Fahrzeuge
  $("#al-road").addEventListener("change", async (ev) => {
    const on = ev.target.checked;
    try {
      await ctx.store.saveSettings({ trips: { ...readTripSettings(snap && snap.settings), roadKm: on } });
      if (!on) import("../road-km.js").then((m) => m.clear()).catch(() => {});
      ctx.ui.toast(on ? "Straßen-km werden berechnet" : "Straßen-km aus – es gilt die Schätzung");
    } catch { /* Store zeigt Toast */ }
  });
  $("#al-veh").addEventListener("click", () => {
    import("./triplog.js").then((m) => m.openVehicles(ctx, { month: new Date() }))
      .catch((err) => { console.error(err); ctx.ui.toast("Fahrzeuge konnten nicht geladen werden."); });
  });

  for (const [id, key, min, max, allowEmpty] of NUM_FIELDS) {
    const inp = $(id);
    inp.addEventListener("change", () => {
      const v = parseNum(inp.value);
      const a = cur();
      if (v === null && allowEmpty) { if (a[key] !== null) save({ [key]: null }); return; }
      if (v === null || Number.isNaN(v) || v < min || v > max) {
        ctx.ui.toast(`Bitte eine Zahl zwischen ${fmtN(min)} und ${fmtN(max)} eingeben.`);
        inp.value = show(key, a[key]);
        return;
      }
      const r = Math.round(v * 100) / 100;
      inp.value = show(key, r);
      if (a[key] === r) return;
      const patch = { [key]: r };
      if (key === "minHours" && a.fullHours < r) patch.fullHours = r;
      if (key === "fullHours" && a.minHours > r) patch.minHours = r;
      save(patch);
    });
  }

  $("#al-places").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pid]");
    if (!b) return;
    const a = cur();
    const id = b.dataset.pid;
    const on = !a.homePlaceIds.includes(id);
    b.setAttribute("aria-pressed", String(on));
    save({ homePlaceIds: on ? [...a.homePlaceIds, id] : a.homePlaceIds.filter((x) => x !== id) });
  });

  try { snap = ctx.store.get(); } catch { snap = null; }
  if (snap) update(snap);
}

export function update(s) {
  snap = s;
  if (!root || !snap || !root.querySelector("#al-on")) return;
  const a = cur();
  $("#al-on").checked = a.enabled;
  $("#al-opts").classList.toggle("off", !a.enabled);
  $("#al-car").checked = a.ownCar;
  $("#al-kmrate-row").hidden = !a.ownCar;
  $("#al-road").checked = readTripSettings(snap.settings).roadKm;
  const vs = readVehicles(snap.settings);
  const dv = defaultVehicle(snap.settings);
  $("#al-veh-txt").textContent = vs.length ? `${vs.length} ${vs.length === 1 ? "Fahrzeug" : "Fahrzeuge"}${dv ? ` · Standard: ${vehicleLabel(dv)}` : ""}` : "Noch keine Fahrzeuge";
  for (const [id, key] of NUM_FIELDS) {
    const inp = $(id);
    if (document.activeElement !== inp) inp.value = show(key, a[key]);
  }
  const places = Array.isArray(snap.places) ? snap.places : [];
  const key = JSON.stringify([places.map((p) => [p.id, p.name]), a.homePlaceIds]);
  if (key === lastPlacesKey) return;
  lastPlacesKey = key;
  const esc = ctx.util.esc;
  $("#al-places").innerHTML = places.length
    ? places.map((p) => `<button type="button" class="chip" data-pid="${esc(p.id)}" aria-pressed="${String(a.homePlaceIds.includes(p.id))}">${esc(p.name || "Ort")}</button>`).join("")
    : `<p class="note">Noch keine Orte gespeichert – lege sie im Reiter „Orte“ an.</p>`;
}
