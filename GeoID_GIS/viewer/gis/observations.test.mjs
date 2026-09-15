/**
 * Observations against a model whose answer is known: a model that is the
 * data divided by a number must be scaled back by exactly that number.
 */
import { parseObservations, headerRoles, fitScale, pairsOf, comparisonCsv } from "./observations.js";

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
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t * Math.max(1, Math.abs(a), Math.abs(b));

const r = headerRoles(["Station", "Easting", "Northing", "dE (mm)", "dN (mm)", "dU (mm)", "sig_e", "sig_n", "sig_u"]);
check("header words are matched loosely, units stripped", r.name === 0 && r.x === 1 && r.y === 2 && r.ue === 3 && r.un === 4 && r.uu === 5 && r.se === 6 && r.su === 8 && r.z === null, JSON.stringify(r));

const gnss = parseObservations("station,x,y,ue,un,uu,se,sn,su\nEMGL,1000,2000,5,-3,12,1,1,2\nEPDN,-500,0,-2,4,8,1,1,2\n", { scale: 1000 });
check("GNSS: kind, stations, millimetres to metres", gnss.kind === "gnss" && gnss.stations.length === 2 && near(gnss.stations[0].obs[2], 0.012) && near(gnss.stations[1].sigma[2], 0.002));
check("GNSS: a table without z puts the station on the ground (z null)", gnss.stations[0].z === null);

const los = parseObservations("name x y z los sigma\nP1 0 0 3000 -0.02 0.004\nP2 100 100 2900 0.01 0.004\n");
check("LOS: kind and values", los.kind === "los" && los.stations.length === 2 && near(los.stations[0].obs[0], -0.02) && los.stations[1].z === 2900);

const bare = parseObservations("A 0 0 10 0.01 0.02 0.03\nB 1 1 11 0.02 0.03 0.04\n");
check("unheaded 6-number rows are x y z ue un uu, and say they were read by position", bare.kind === "gnss" && bare.stations[1].obs[2] === 0.04 && bare.warnings.some((w) => /position/.test(w)));
check("unheaded 3-number rows are x y los", parseObservations("0 0 0.01\n1 1 0.02\n").kind === "los");
check("a row without coordinates is skipped and counted", parseObservations("name,x,y,los\nA,,1,0.01\nB,1,1,0.02\n").warnings.some((w) => /1 row/.test(w)));
check("no displacement columns is refused, not guessed", parseObservations("name,x,y\nA,1,2\n").kind === null);

// The model is the data over 2.5: the fit must find 2.5 and leave nothing.
const stations = gnss.stations;
const model = stations.map((s) => s.obs.map((d) => d / 2.5));
const fit = fitScale(pairsOf(stations, model));
check("fit: a model off only in size scales back exactly", near(fit.scale, 2.5, 1e-12) && fit.rmsScaled < 1e-15 && fit.rms > 0, JSON.stringify(fit));
check("fit: weighted when every component has a sigma, chi² falls to zero", fit.weighted && near(fit.chi2Scaled, 0, 1e-9) && fit.chi2 > 0);
check("fit: all of the data explained by the scaled model", near(fit.explained, 1, 1e-12));

// Unweighted least squares by hand: d = [1, 2], m = [1, 1] → k = 1.5, rms 0.5.
const ols = fitScale([{ d: 1, m: 1 }, { d: 2, m: 1 }]);
check("fit: ordinary least squares by hand", near(ols.scale, 1.5) && near(ols.rmsScaled, 0.5) && !ols.weighted);
check("fit: weighted and unweighted mixed is flagged", fitScale([{ d: 1, m: 1, sigma: 1 }, { d: 2, m: 1 }]).mixed);
check("fit: a station the model cannot reach (NaN) is left out", fitScale([{ d: 1, m: NaN }, { d: 2, m: 1 }]).n === 1);

const csv = comparisonCsv("gnss", stations, model, { k: 2.5 });
const row = csv.trim().split("\n")[1].split(",");
check("CSV: observed, scaled model and residual in mm", row[4] === "5" && row[7] === "5" && row[10] === "0", row.join(","));
