/**
 * Line of sight and fringes against geometry with a closed-form answer.
 */
import { losVector, losDisplacement, wrapFringes, fringeCount, fringesPerEdge, PLATFORMS, FRINGE_MAP } from "./insar.js";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass += 1; else failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`);
}
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
const near = (a, b, t = 1e-3) => Math.abs(a - b) <= t;
// A whole fringe and none are the same colour: 0.99999994 from a Float32 input is 0.

const asc = losVector({ heading: -12, incidence: 39 });
const desc = losVector({ heading: -168, incidence: 39 });
check("LOS is a unit vector", near(Math.hypot(...asc), 1, 1e-12));
check("Sentinel-1 ascending sees from the west and a little south: the published E/N/U", near(asc[0], -0.615) && near(asc[1], -0.131) && near(asc[2], 0.777), asc.join(","));
check("descending mirrors it east–west", near(desc[0], 0.615) && near(desc[1], -0.131) && near(desc[2], 0.777), desc.join(","));
check("looking left moves the satellite to the other side of the track", near(losVector({ heading: -12, incidence: 39, look: "left" })[0], 0.615));
check("straight down (incidence 0) the LOS is vertical", near(losVector({ heading: 45, incidence: 0 })[2], 1, 1e-12));

// Two nodes, 3 dofs: 1 m of uplift, then 1 m east.
const vals = Float64Array.from([0, 0, 1, 1, 0, 0]);
const los = losDisplacement(vals, 2, 3, [0, 1, 2], { heading: -12, incidence: 39 });
check("uplift is positive from either pass, by cos(incidence)", near(los[0], Math.cos(39 * Math.PI / 180), 1e-6));
check("eastward motion is AWAY from an ascending satellite, TOWARD a descending one", los[1] < 0 && losDisplacement(vals, 2, 3, [0, 1, 2], { heading: -168, incidence: 39 })[1] > 0);
check("a 2D field reads its two components and nothing for z", near(losDisplacement(Float64Array.from([0, 2]), 1, 2, [0, 1], { heading: 0, incidence: 90 })[0], 0, 1e-9));

const lam = 0.056;
const f = wrapFringes(Float32Array.from([0, lam / 4, -lam / 4, lam / 2, NaN]), lam);
check("fringes wrap every half wavelength into [0, 1)", near(f[0], 0) && near(f[1], 0.5) && near(f[2], 0.5) && (near(f[3], 0) || near(f[3], 1)) && Number.isNaN(f[4]), [...f].join(","));
check("fringe count: 28 cm of LOS at C-band is 10 fringes", near(fringeCount(0, 0.28, 0.056), 10, 1e-9));
check("per-edge fringes find the steepest edge", near(fringesPerEdge(Float32Array.from([0, 0.028, 0.14]), [0, 1, 1, 2], 0.056), 4, 1e-6));
check("every platform names a geometry and a wavelength", PLATFORMS.every((p) => Number.isFinite(p.heading) && p.incidence > 0 && p.wavelength > 0));
check("the fringe map is cyclic", FRINGE_MAP[0].join() === FRINGE_MAP[FRINGE_MAP.length - 1].join());
