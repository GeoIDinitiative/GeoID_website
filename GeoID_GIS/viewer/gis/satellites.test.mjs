#!/usr/bin/env node
/**
 * The satellite tracker's two pure seams: TLE parsing, and the property
 * contract its features speak to the scene card.
 *
 * The propagation itself is satellite.js's SGP4 and is not re-tested here —
 * but the vendored build IS loaded and driven once with a real ISS element
 * set, because "the library parses and propagates in Node exactly as the
 * browser loads it" is the assumption everything above rests on, and a bad
 * vendor fetch would otherwise surface as a blank layer with no error.
 */

import { createRequire } from "node:module";
import { parseTle, satelliteProperties } from "./satellites.js";

const require = createRequire(import.meta.url);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/* ── parsing ─────────────────────────────────────────────────────────────── */

const ISS_L1 = "1 25544U 98067A   26238.17646693  .00007447  00000+0  14005-3 0  9995";
const ISS_L2 = "2 25544  51.6329 313.6786 0007692  84.9120 275.2747 15.49633385582609";
const TLE = `ISS (ZARYA)\n${ISS_L1}\n${ISS_L2}\nCSS (TIANHE)\n1 48274U 21035A   26238.50000000  .00020000  00000+0  20000-3 0  9990\n2 48274  41.4700 100.0000 0005000  90.0000 270.0000 15.60000000300000\n`;

{
  const triples = parseTle(TLE);
  check("two objects parse from a two-object file", triples.length === 2,
    String(triples.length));
  check("names and lines land in the right slots",
    triples[0].name === "ISS (ZARYA)" && triples[0].l1 === ISS_L1 && triples[0].l2 === ISS_L2);
  // A truncated download must fail the record, not shift every record after
  // it — the lines are recognised by their leading digits, not counted.
  const truncated = parseTle(`ISS (ZARYA)\n${ISS_L1}\nCSS (TIANHE)\n1 48274U 21035A   26238.50000000  .00020000  00000+0  20000-3 0  9990\n2 48274  41.4700 100.0000 0005000  90.0000 270.0000 15.60000000300000\n`);
  check("a record missing its second line is dropped, the next survives",
    truncated.length === 1 && truncated[0].name === "CSS (TIANHE)",
    JSON.stringify(truncated.map((t) => t.name)));
  check("empty input is an empty answer", parseTle("").length === 0 && parseTle(null).length === 0);
}

/* ── the vendored propagator, driven once ───────────────────────────────── */

{
  const satellite = require("../vendor/satellite.min.js");
  const satrec = satellite.twoline2satrec(ISS_L1, ISS_L2);
  // At its own epoch the propagation must place the ISS in low orbit: the
  // numbers are not asserted exactly (they move with the elements), only
  // that they are the SHAPE of an ISS state.
  const date = new Date("2026-08-26T12:00:00Z");
  const out = satellite.propagate(satrec, date);
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(out.position, gmst);
  const lat = satellite.degreesLat(geo.latitude);
  const alt = geo.height;
  const speed = Math.hypot(out.velocity.x, out.velocity.y, out.velocity.z);
  check("the vendored SGP4 places the ISS in low orbit",
    alt > 300 && alt < 500, `${alt.toFixed(0)} km`);
  check("at orbital speed", speed > 7 && speed < 8, `${speed.toFixed(2)} km/s`);
  check("inside its inclination band", Math.abs(lat) <= 52, `${lat.toFixed(1)}°`);

  /* ── the card contract ──────────────────────────────────────────────── */
  const entry = { name: "ISS (ZARYA)", norad: "25544", kind: "Space station", category: "Space stations" };
  const props = satelliteProperties(entry, {
    lat, lon: 0, altitudeKm: alt, speedKms: speed,
    inclinationDeg: (satrec.inclo * 180) / Math.PI,
    periodMinutes: (2 * Math.PI) / (satrec.no_kozai ?? satrec.no),
  });
  check("kind becomes the card's kicker field", props.kind === "Space station");
  check("the layer declares itself nameable without ranking anything",
    props.label_rank === 0);
  check("the dimension row carries altitude, speed and period",
    /km up · .+ km\/s · 9\d min orbit/.test(props.dimension), props.dimension);
  check("the summary says where the numbers come from",
    /SGP4/.test(props.summary) && /NORAD 25544/.test(props.summary));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
