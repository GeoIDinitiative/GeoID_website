/**
 * The water card: which bake a feature came from, and what it says about it.
 * Run with `node water-card.test.mjs`.
 */
import { readFileSync } from "node:fs";
import { waterKind, waterCard, WATER_SAID } from "./water-card.js";

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
// The verdict is an exit hook, so a check appended anywhere still counts.
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

/* ── recognition: each bake by its own columns, nothing else claimed ─────── */

const baikal = { id: 1, name: "Baikal", country: "Russia", lake_type: 1, class: "lake",
  colour: "#3d8fd1", area_km2: 31494, volume_mcm: 23615390, depth_avg_m: 749.8,
  elevation_m: 453, shore_km: 2385, residence_days: 138000, watershed_km2: 571000,
  discharge_m3s: 1880, volume_source: 1 };
const pond = { id: 99, name: "", country: "Canada", lake_type: 1, class: "lake",
  area_km2: 0.12, volume_mcm: 0.4, depth_avg_m: 3.3, volume_source: 3 };
const reservoir = { id: 7, name: "Kariba", country: "Zambia", lake_type: 2,
  area_km2: 5580, volume_mcm: 180600, volume_source: 2 };
const river = { id: 12, class: "w300", colour: "#2f86d0", width_median_m: 420,
  width_mean_m: 450, width_min_m: 180, width_max_m: 1020, width_sd_m: 90, lake_flag: 0,
  measurements: 1840 };
const tidal = { width_median_m: 1500, lake_flag: 2 };
const canal = { width_median_m: 60, lake_flag: 3 };
const sea = { class: "ocean", colour: "#1e5a8c" };
const marine = { name: "Tyrrhenian Sea", kind: "sea", rank: 1 };

check("a HydroLAKES shoreline is a lake", waterKind(baikal) === "lake");
check("a GRWL centreline is a river", waterKind(river) === "river");
check("the ocean pyramid is the sea", waterKind(sea) === "sea");
check("a Natural Earth marine area is a named sea", waterKind(marine) === "marine");
check("a soil polygon is not water",
  waterKind({ code: "Re", name: "Eutric Regosols", unit: "Re33", group: "REGOSOLS" }) === null);
check("an ice sheet is not a named sea",
  waterKind({ name: "Antarctic ice sheet", kind: "Ice sheet", rank: 0 }) === null);
check("a geological unit is not water",
  waterKind({ lith: "sandstone", name: "Old Red Sandstone", color: "#c86" }) === null);
check("a cyclone risk cell is not water",
  waterKind({ p_yr: 0.1, rate_yr: 0.1, deg: 1 }) === null);
check("a named feature is never read as the open sea",
  waterKind({ class: "ocean", name: "Somewhere" }) === null);

/* ── the lake ────────────────────────────────────────────────────────────── */

const b = waterCard(baikal);
check("a natural lake is kicked as a Lake and titled by its name",
  b.kicker === "Lake" && b.title === "Baikal", `${b.kicker} / ${b.title}`);
check("a large volume is said in km³", b.headline.some(([k, v]) => k === "Volume" && /23,615 km³/.test(v)),
  JSON.stringify(b.headline));
check("a REPORTED volume is not marked modelled",
  !b.headline.some(([, v]) => /modelled/.test(v)));
check("the basis of the volume is stated",
  b.rows.some(([k, v]) => k === "Volume basis" && /literature/.test(v)));
check("a residence time of centuries is said in years",
  b.rows.some(([k, v]) => k === "Residence time" && /years/.test(v)));

const p = waterCard(pond);
check("an unnamed lake is titled by where it is, not 'Unnamed'",
  p.title === "Unnamed lake, Canada", p.title);
check("a MODELLED volume says so on the face of the card",
  p.headline.some(([k, v]) => k === "Volume" && /modelled/.test(v)));
check("and so does the mean depth, which is that volume over the area",
  p.headline.some(([k, v]) => k === "Mean depth" && /modelled/.test(v)));
check("a small volume is said in million m³",
  p.headline.some(([, v]) => /million m³/.test(v)));
check("the note says the estimate is not a survey", /not a survey/.test(p.note));

const r = waterCard(reservoir);
check("a reservoir is kicked as a Reservoir", r.kicker === "Reservoir");
check("and its volume credited to GRanD", r.rows.some(([, v]) => /GRanD/.test(v)));

/* ── the river ───────────────────────────────────────────────────────────── */

const rv = waterCard(river);
check("a river is titled by its measured width", rv.title === "River channel, 420 m wide", rv.title);
check("its width range is on the face",
  rv.headline.some(([k, v]) => k === "Width range" && v === "180 – 1,020 m"), JSON.stringify(rv.headline));
check("lakeFlag 2 is a TIDAL river (GRWL's own coding, not SWORD's)",
  waterCard(tidal).kicker === "Tidal river");
check("lakeFlag 3 is a canal", waterCard(canal).kicker === "Canal");
check("the card says GRWL carries no names", /no\s+names/.test(rv.note));
check("the record id is not called a segment — GRWL's own ID repeats across tiles",
  rv.rows.some(([k]) => k === "GRWL record") && !rv.rows.some(([k]) => /segment/i.test(k)));
check("how many widths stand behind the median is on the card",
  rv.rows.some(([k, v]) => k === "Width measurements" && /1,840/.test(v)));

/* ── the sea and the named seas ──────────────────────────────────────────── */

check("the open sea cites OpenStreetMap under the ODbL", /ODbL/.test(waterCard(sea).source));
const m = waterCard(marine);
check("a named sea is kicked by its kind and titled by its name",
  m.kicker === "Sea" && m.title === "Tyrrhenian Sea");
check("a Natural Earth 'river' marine area is an estuary",
  waterCard({ name: "Río de la Plata", kind: "river", rank: 2 }).kicker === "Estuary");

/* ── the attribute fold does not repeat what the card said ───────────────── */

check("every column the card reads is in WATER_SAID",
  Object.keys({ ...baikal, ...river }).every((key) => WATER_SAID.test(key)));

/* ── wired into BOTH builders, and kept off the ground profile ───────────── */

const panel = readFileSync(new URL("./geology-panel.js", import.meta.url), "utf8");
const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
const profile = readFileSync(new URL("./ground-profile.js", import.meta.url), "utf8");
check("the tiled-map builder writes the water card", /const water = waterCard\(props\)/.test(panel));
check("the vector card path writes it too", /waterCard\(props\)/.test(popup));
check("both mark it water: true", /water: true/.test(panel) && /water: true/.test(popup));
check("the ground profile refuses a water card", /if \(feature\?\.water\) return;/.test(profile));
