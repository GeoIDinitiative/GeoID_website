import { sizeFieldLines, defaultField, describeField, smallestSize, FIELD_TYPES, DEFAULT_OPTIONS } from "./mesh-size-fields.js";
import { gmshScript } from "./model-build.js";
import { sectionGmshScript, profileAlong } from "./section-model.js";
import { makeLocalFrame } from "./model-build.js";

let passes = 0; let failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes += 1; else failures += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const has = (text, re) => (re instanceof RegExp ? re.test(text) : text.includes(re));

// Every type has a default, a label and a sentence.
Object.keys(FIELD_TYPES).forEach((type) => {
  const fld = defaultField(type, { coarseM: 200 });
  check(`${type}: a default field with a description`, fld.type === type && fld.on === true && typeof describeField(fld) === "string" && describeField(fld).length > 4);
});

// 3D: one of each, resolved.
const fields3 = [
  { type: "point", name: "borehole", on: true, x: 100, y: 200, z: 50, sizeM: 5, distMinM: 50, distMaxM: 500, sizeMaxM: null },
  { type: "boundary", name: "the ground", on: true, key: "top", flag: 1, entityDim: 2, sizeM: 20, distMinM: 10, distMaxM: 300, sizeMaxM: 400 },
  { type: "box", name: "dam", on: true, xMin: -100, xMax: 100, yMin: -50, yMax: 50, zMin: null, zMax: null, sizeM: 10, sizeOutM: null, thicknessM: 80 },
  { type: "ball", name: "vent", on: true, x: 0, y: 0, z: 300, radiusM: 400, sizeM: 15, sizeOutM: 250, thicknessM: 100 },
  { type: "expr", name: "formula", on: true, expression: "50 + 0.01*sqrt(x*x+y*y)" },
  { type: "point", name: "off", on: false, x: 0, y: 0, z: 0, sizeM: 1, distMinM: 1, distMaxM: 2 },
];
const text3 = sizeFieldLines({ fields: fields3, dim: 3, coarseM: 300, options: { sizeMaxM: 300 } }).join("\n");
check("a point is a MathEval distance under a Threshold", has(text3, /MathEval", 1\)/) && has(text3, "sqrt((x-(100.0000))^2+(y-(200.0000))^2+(z-(50.0000))^2)") && has(text3, /Threshold", 2\)/) && has(text3, /setNumber\(2, "SizeMin", 5\.0000\)/) && has(text3, /setNumber\(2, "DistMax", 500\.0000\)/));
check("the point's coarse size defaults to the cap", has(text3, /setNumber\(2, "SizeMax", 300\.0000\)/));
check("a boundary is a Distance from the entities wearing its flag, on the right list", has(text3, "getEntitiesForPhysicalGroup(2, 1)") && has(text3, /"SurfacesList", _ents/) && has(text3, /setNumber\(4, "SizeMax", 400\.0000\)/));
check("a box is a Box with its blend", has(text3, /"Box", 5\)/) && has(text3, /setNumber\(5, "XMin", -100\.0000\)/) && has(text3, /setNumber\(5, "ZMin", -1000000000\.0000\)/) && has(text3, /setNumber\(5, "Thickness", 80\.0000\)/) && has(text3, /setNumber\(5, "VOut", 300\.0000\)/));
check("a ball is a Ball", has(text3, /"Ball", 6\)/) && has(text3, /setNumber\(6, "Radius", 400\.0000\)/) && has(text3, /setNumber\(6, "VOut", 250\.0000\)/));
check("a formula is a MathEval verbatim", has(text3, /"MathEval", 7\)/) && has(text3, '"F", "50 + 0.01*sqrt(x*x+y*y)"'));
check("a field switched off is not written", !has(text3, "# off:"));
check("the fields combine by Min and become the background mesh", has(text3, /"Min", 8\)/) && has(text3, /"FieldsList", \[2, 4, 5, 6, 7\]/) && has(text3, "setAsBackgroundMesh(8)"));
check("gmsh's own sources are off unless asked, and the cap is written", has(text3, 'MeshSizeExtendFromBoundary", 0') && has(text3, 'MeshSizeFromPoints", 0') && has(text3, 'MeshSizeFromCurvature", 0') && has(text3, 'MeshSizeMax", 300.0000') && !has(text3, "MeshSizeMin"));

// Options: Max, the sources on, a floor, algorithms.
const textOpt = sizeFieldLines({ fields: fields3.slice(0, 1), dim: 3, options: { combine: "max", extendFromBoundary: true, fromPoints: true, fromCurvature: 24, sizeMinM: 2, algorithm3d: 10 } }).join("\n");
check("Max, the sources on, a floor and an algorithm are all written when asked", has(textOpt, /"Max", 3\)/) && has(textOpt, 'ExtendFromBoundary", 1') && has(textOpt, 'FromPoints", 1') && has(textOpt, 'FromCurvature", 24') && has(textOpt, 'MeshSizeMin", 2.0000') && has(textOpt, 'Algorithm3D", 10') && !has(textOpt, "MeshSizeMax"));
check("no cap anywhere: the point's coarse size falls to gmsh's own", has(textOpt, /"SizeMax", 1e\+22|"SizeMax", 10000000000000000000000\.0000/));

// 2D: a boundary measures from curves, a point sits at (s, z, 0).
const text2 = sizeFieldLines({ fields: [{ type: "boundary", on: true, key: "top", flag: 1, sizeM: 3, distMinM: 5, distMaxM: 100 }, { type: "point", on: true, x: 1200, y: 350, z: 0, sizeM: 2, distMinM: 10, distMaxM: 200 }], dim: 2, coarseM: 50 }).join("\n");
check("in 2D a boundary field reads CurvesList", has(text2, "getEntitiesForPhysicalGroup(1, 1)") && has(text2, /"CurvesList", _ents/));
check("in 2D a point field measures in (s, z)", has(text2, "sqrt((x-(1200.0000))^2+(y-(350.0000))^2+(z-(0.0000))^2)"));

// Nothing asked: only the source options are stated.
const none = sizeFieldLines({ fields: [], dim: 3 }).join("\n");
check("with no field there is no background mesh", !has(none, "setAsBackgroundMesh") && has(none, "MeshSizeFromPoints"));
check("the smallest size any field asks for", smallestSize(fields3) === 5 && smallestSize([]) === null);

// Through the two scripts.
const script3 = gmshScript({ name: "t", meshSizeM: 200, sizeFields: fields3.slice(0, 2), meshOptions: { sizeMaxM: 200, extendFromBoundary: false }, sizeFieldFile: "t_size.dat", refineBoxes: [{ name: "r", xMin: 0, xMax: 10, yMin: 0, yMax: 10, sizeM: 4 }] });
check("the 3D script carries the study's fields, the refine boxes and the terrain field in one Min", has(script3, "# borehole:") && has(script3, "# r:") && has(script3, '"Structured"') && has(script3, "setAsBackgroundMesh") && (script3.match(/MeshSizeMax/g) || []).length === 1 && !has(script3, "MeshSizeMin"));
check("the old one-number call still writes its cap and floor", has(gmshScript({ name: "o", meshSizeM: 100, minSizeM: 10 }), 'MeshSizeMin", 10.0000'));
const frame = makeLocalFrame({ lat: 54, lon: -6, radiusKm: 6371 });
const prof = profileAlong({ a: { lat: 54, lon: -6.05 }, b: { lat: 54, lon: -5.95 }, n: 21, heightAt: () => 100, radiusKm: 6371, frame });
const script2 = sectionGmshScript({ name: "s", profile: prof, belowM: 500, aboveM: 0, meshSizeM: 80, sizeFields: [{ type: "point", on: true, name: "probe", x: 1000, y: 50, z: 0, sizeM: 4, distMinM: 20, distMaxM: 300 }], meshOptions: { sizeMaxM: 80 } });
check("the 2D script carries its fields before generate(2)", has(script2, "# probe:") && script2.indexOf("setAsBackgroundMesh") < script2.indexOf("generate(2)") && (script2.match(/MeshSizeMax/g) || []).length === 1);
check("the 2D script without fields is as it was", has(sectionGmshScript({ name: "s", profile: prof, belowM: 500, meshSizeM: 80 }), 'MeshSizeMax", 80.0000'));
check("DEFAULT_OPTIONS is frozen and Min by default", Object.isFrozen(DEFAULT_OPTIONS) && DEFAULT_OPTIONS.combine === "min");

process.on("exit", () => { console.log(`mesh-size-fields: ${passes} passed, ${failures} failed`); if (failures) process.exitCode = 1; });
