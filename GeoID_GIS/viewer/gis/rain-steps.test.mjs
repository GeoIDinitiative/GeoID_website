/**
 * The rainfall time step: the finest each source has by default, a coarser
 * step only where asked, and never a source read finer than it is. Run with
 * `node rain-steps.test.mjs`.
 */
import { readFileSync } from "node:fs";
import { planSeries, rendersOf, stepFor, alignDown, addStep, stepText, rampMaxFor, NATIVE_STEP, HOUR, DAY, MIN } from "./rain-steps.js";

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`rain-steps: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

const allGfs = () => "gfs";
const chirpsTo = (last) => (d) => (d <= last ? "chirps" : "gfs");

check("each source's finest step is its own", NATIVE_STEP.gfs === HOUR && NATIVE_STEP.chirps === DAY && NATIVE_STEP.imerg === 30 * MIN);
check("finest reads a source at its own step; a finer ask cannot make CHIRPS hourly; a coarser ask is honoured",
  stepFor("gfs", "native").ms === HOUR && stepFor("chirps", "1h").ms === DAY && stepFor("gfs", "1d").ms === DAY && stepFor("chirps", "1y").months === 12);
check("calendar steps land on months and years", alignDown(Date.parse("2023-05-17T10:00Z"), { months: 1 }) === Date.parse("2023-05-01T00:00Z")
  && alignDown(Date.parse("2023-05-17T10:00Z"), { months: 12 }) === Date.parse("2023-01-01T00:00Z")
  && addStep(Date.parse("2023-12-01T00:00Z"), { months: 1 }) === Date.parse("2024-01-01T00:00Z"));
check("a step is said the way a reader says it", stepText({ ms: HOUR }) === "1 h" && stepText({ ms: 30 * MIN }) === "30 min" && stepText({ ms: DAY }) === "1 day" && stepText({ months: 12 }) === "1 year");

{
  const p = planSeries({ start: "2026-09-04", end: "2026-09-18", choice: "native", windowH: 24, sourceOf: allGfs });
  check("GFS alone, by default, is a map every hour: fifteen days is 360 maps", p.ok && p.frames.length === 360 && p.stride === 1, String(p.frames.length));
  check("each hourly map sums the 24 hours before it", p.frames.every((f) => (Date.parse(`${f.time}Z`) - Date.parse(`${f.from}Z`)) === 24 * HOUR));
  check("and costs no Earth Engine render", rendersOf(p) === 0 && p.gfsSpan);
  const six = planSeries({ start: "2026-09-04", end: "2026-09-18", choice: "6h", windowH: 24, sourceOf: allGfs });
  check("a 6-hour step, when asked for, is a quarter of the maps", six.frames.length === 60);
}

{
  const p = planSeries({ start: "2026-09-04", end: "2026-09-18", choice: "native", windowH: 24, sourceOf: chirpsTo("2026-09-10") });
  const daily = p.frames.filter((f) => f.sources.join() === "chirps");
  check("CHIRPS history then GFS forecast: a map a day, then a map an hour", daily.length === 7 && p.frames.length === 7 + 8 * 24, `${daily.length} + ${p.frames.length}`);
  check("one render per CHIRPS day, none for GFS", rendersOf(p) === 7 && p.geeParts.every((g) => g.src === "chirps" && g.to - g.from === DAY));
  const h = p.frames.find((f) => f.time === "2026-09-11T01:00");
  check("at the handover a map sums WHOLE steps — the last CHIRPS day and the first GFS hour — never a daily total cut in two",
    h && h.from === "2026-09-10T00:00" && h.sources.join() === "chirps,gfs");
}

{
  const y = planSeries({ start: "2015-01-01", end: "2020-12-31", choice: "1y", windowH: null, sourceOf: () => "chirps" });
  check("years of CHIRPS by the year: one map and one render a year, each a calendar year", y.frames.length === 6 && rendersOf(y) === 6
    && y.frames[0].from === "2015-01-01T00:00" && y.frames[0].time === "2016-01-01T00:00");
  const m = planSeries({ start: "2026-06-01", end: "2026-08-20", choice: "1mo", windowH: null, sourceOf: chirpsTo("2026-07-15") });
  const july = m.units.find((u) => u.start === Date.parse("2026-07-01T00:00Z"));
  check("a month in which CHIRPS runs out is split where it does, each part from the source that holds it",
    july && july.parts.length === 2 && july.parts[0].src === "chirps" && july.parts[0].to === Date.parse("2026-07-16T00:00Z") && july.parts[1].src === "gfs");
  check("and a month cut short by the end of the series is the days there are", m.frames.at(-1).time === "2026-08-21T00:00");
}

{
  const p = planSeries({ start: "2026-09-04", end: "2026-09-10", choice: "native", windowH: 24, sourceOf: () => "imerg" });
  check("IMERG at its finest is half-hourly — and a week of it is hundreds of billed renders, which the page asks about first",
    p.frames.length === 336 && rendersOf(p) > 300);
  const src = readFileSync(new URL("./landslide-pipeline.js", import.meta.url), "utf8");
  check("the page states the renders and fetches on a second press past its budget",
    /export const RENDER_BUDGET = 60;/.test(src) && /if \(renders > RENDER_BUDGET && state\.rainConfirm !== signature\)/.test(src));
  check("the time step opens on the finest each source has", /value="\$\{c\.key\}"\$\{c\.key === "native" \? " selected" : ""\}/.test(src));
  check("the model converts each map's rain over its OWN window, not one global window",
    /windowH: r\.frames\[k\]\.hours/.test(src) && /windowH: frames\[k\]\.hours/.test(src));
}

check("a long composite raises the top of the colour ramp; a day keeps the service's 300 mm", rampMaxFor(DAY) === 300 && rampMaxFor(365 * DAY) >= 6000);
check("the service honours the ramp top only for a summed rainfall in mm",
  /config\.reducer === "sum" && config\.legend\?\.unit === "mm"/.test(readFileSync(new URL("../../services/gee-tiles/index.js", import.meta.url), "utf8")));
check("too long a span at too fine a step is refused rather than hanging the page",
  !planSeries({ start: "1990-01-01", end: "2020-12-31", choice: "30m", windowH: 24, sourceOf: () => "imerg" }).ok);
