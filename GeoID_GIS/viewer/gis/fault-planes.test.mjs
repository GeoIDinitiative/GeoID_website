// Fault planes from lines: the geometry against closed forms, and what the
// gmsh script says it does with it.
import {
  linesFromCollection, hasLines, bearingDeg, traceLength, simplifyTrace, clipTraceToBox,
  mitreNormals, faultPlane, dipAzimuthDeg, compassOf, triangleDipDeg, faultsStl, faultScriptLines,
  MIN_DIP_DEG, slug, tupleFirst, faultDefaultsFrom, planesCross, nonCrossing,
} from "./fault-planes.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
process.on("exit", () => {
  console.log(`fault-planes: ${pass} passed${fail ? `, ${fail} failed` : ""}`);
  if (fail) process.exitCode = 1;
});
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ── Lines out of a collection ───────────────────────────────────────────────
{
  const fc = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { name: "Timpe" }, geometry: { type: "LineString", coordinates: [[15, 37.6], [15.1, 37.7]] } },
    { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [[[15, 37], [15.1, 37]], [[15.2, 37], [15.3, 37.1], [15.4, 37.1]]] } },
    { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[1, 1]] } },
  ] };
  const lines = linesFromCollection(fc);
  ok("a LineString is one line and a MultiLineString one per part; a polygon and a one-point line are not lines",
    lines.length === 3 && lines[0].name === "Timpe" && lines[1].name === "line 2 (part 1)" && lines[2].coords.length === 3);
  ok("keys tell the parts apart", lines[1].key === "1:0" && lines[2].key === "1:1");
  ok("a collection with a line offers the role; one without does not",
    hasLines(fc) && !hasLines({ features: [fc.features[2]] }));
}

// ── Bearings, lengths, simplification, clipping ─────────────────────────────
{
  ok("north is 0, east 90, south 180, west 270", bearingDeg([0, 0], [0, 1]) === 0 && bearingDeg([0, 0], [1, 0]) === 90 && bearingDeg([0, 0], [0, -1]) === 180 && bearingDeg([0, 0], [-1, 0]) === 270);
  ok("a 3-4-5 polyline is 5 + 5 long", close(traceLength([[0, 0], [3, 4], [6, 8]]), 10));
  const wiggly = [[0, 0], [100, 2], [200, -2], [300, 1], [400, 0]];
  ok("simplifying drops the wiggle and keeps both ends", simplifyTrace(wiggly, 5).length === 2 && simplifyTrace(wiggly, 1).length === 5);
  ok("a real bend survives", simplifyTrace([[0, 0], [100, 0], [100, 100]], 5).length === 3);
  const box = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
  const pieces = clipTraceToBox([[-50, 50], [50, 50], [150, 50]], box);
  ok("a line crossing the box is cut at both edges", pieces.length === 1 && close(pieces[0][0][0], 0) && close(pieces[0][pieces[0].length - 1][0], 100));
  const two = clipTraceToBox([[-50, 20], [50, 20], [150, 20], [150, 80], [50, 80], [-50, 80]], box);
  ok("a line that leaves and returns is two pieces", two.length === 2);
  ok("a line entirely outside is nothing", clipTraceToBox([[200, 200], [300, 300]], box).length === 0);
  ok("the dip azimuth is 90° right of the strike, or left", dipAzimuthDeg(0, "right") === 90 && dipAzimuthDeg(0, "left") === 270 && dipAzimuthDeg(350, "right") === 80);
  ok("compass words", compassOf(90) === "E" && compassOf(225) === "SW" && compassOf(359) === "N");
}

// ── A straight north–south trace dipping 60° east ───────────────────────────
{
  const flat = () => 500;
  const f = faultPlane({ trace: [[0, 0], [0, 1000]], groundAt: flat, dipDeg: 60, side: "right", depthM: 1000, topOffsetM: 5 });
  ok("it builds", f.ok, f.message);
  ok("strike is north, so the plane dips east", f.strikeDeg === 0 && f.dipDirectionDeg === 90 && f.compass === "E");
  ok("the top edge sits the offset under the ground", f.top.every((p) => close(p[2], 495)));
  ok("the bottom edge is the depth below the trace's lowest point", f.bottom.every((p) => close(p[2], -505)) && close(f.depthM, 1000));
  const reach = 1000 / Math.tan(Math.PI / 3);
  ok("the bottom edge is offset east by depth / tan(dip)", f.bottom.every((p) => close(p[0], reach, 1e-9)) && f.bottom.every((p) => close(p[1], f.top[f.bottom.indexOf(p)][1])));
  ok("both triangles dip at 60°", f.tris.every(([a, b, c]) => close(triangleDipDeg(f.points[a], f.points[b], f.points[c]), 60, 1e-9)));
  ok("its area is length × down-dip length", close(f.areaM2, 1000 * (1000 / Math.sin(Math.PI / 3)), 1e-9));
  ok("two triangles, six preview edges", f.tris.length === 2 && f.edges.length === 4);
  const left = faultPlane({ trace: [[0, 0], [0, 1000]], groundAt: flat, dipDeg: 60, side: "left", depthM: 1000, topOffsetM: 5 });
  ok("the left side dips west", left.compass === "W" && left.bottom.every((p) => close(p[0], -reach, 1e-9)));
  const vertical = faultPlane({ trace: [[0, 0], [0, 1000]], groundAt: flat, dipDeg: 90, depthM: 1000, topOffsetM: 5 });
  ok("a vertical fault has no horizontal offset", vertical.bottom.every((p) => close(p[0], 0)) && vertical.tris.every(([a, b, c]) => close(triangleDipDeg(vertical.points[a], vertical.points[b], vertical.points[c]), 90, 1e-9)));
  const tooFlat = faultPlane({ trace: [[0, 0], [0, 1000]], groundAt: flat, dipDeg: 1, depthM: 100, topOffsetM: 5 });
  ok("a dip below the floor is raised and said", tooFlat.dipDeg === MIN_DIP_DEG && tooFlat.notes.some((n) => /layer, not a fault/.test(n)));
}

// ── The trace follows the terrain, the bottom is one elevation ──────────────
{
  const ramp = (x, y) => 100 + y; // rises northward
  const f = faultPlane({ trace: [[0, 0], [0, 500], [0, 1000]], groundAt: ramp, dipDeg: 45, depthM: 800, topOffsetM: 10 });
  ok("each top vertex is its own ground less the offset", close(f.top[0][2], 90) && close(f.top[1][2], 590) && close(f.top[2][2], 1090));
  ok("the bottom is 800 m under the LOWEST top vertex, flat", f.bottom.every((p) => close(p[2], 90 - 800)));
  ok("so a higher vertex reaches further down-dip (45°: reach = drop)", close(f.bottom[2][0], 1090 + 800 - 90) && close(f.bottom[0][0], 800));
  // A trace climbing at 45° across a 45° dip: the panel's TRUE dip is
  // atan(sqrt(tan²45 + tan²45)) = atan(√2) = 54.74°, and the result says so.
  const want = (Math.atan(Math.SQRT2) * 180) / Math.PI;
  ok("a climbing trace makes the true dip steeper, and it is reported", close(f.trueDipDeg, want, 1e-9) && f.tris.every(([a, b, c]) => close(triangleDipDeg(f.points[a], f.points[b], f.points[c]), want, 1e-9)));
  const level = faultPlane({ trace: [[0, 0], [0, 1000]], groundAt: () => 100, dipDeg: 45, depthM: 800, topOffsetM: 10 });
  ok("on level ground the true dip is the dip asked for", close(level.trueDipDeg, 45, 1e-9));
}

// ── A bend is mitred: one bottom vertex per top vertex, no gap ──────────────
{
  const flat = () => 0;
  const f = faultPlane({ trace: [[0, 0], [1000, 0], [1000, 1000]], groundAt: flat, dipDeg: 60, side: "right", depthM: 500, topOffsetM: 5 });
  ok("three top and three bottom vertices, four triangles", f.top.length === 3 && f.bottom.length === 3 && f.tris.length === 4);
  const reach = 500 / Math.tan(Math.PI / 3);
  const n = mitreNormals([[0, 0], [1000, 0], [1000, 1000]], "right");
  ok("the end normals are the segments' own (right of east is south, right of north is east)", close(n[0][0], 0) && close(n[0][1], -1) && close(n[2][0], 1) && close(n[2][1], 0));
  ok("the corner normal is the bisector, scaled 1/cos(45°)", close(Math.hypot(n[1][0], n[1][1]), Math.SQRT2) && close(n[1][0], 1) && close(n[1][1], -1));
  ok("the corner's bottom vertex is the mitre point: reach east AND reach south", close(f.bottom[1][0], 1000 + reach) && close(f.bottom[1][1], -reach));
  // Each panel's bottom edge keeps the plane's horizontal reach from its own top segment.
  const distToSeg = (p, a, b) => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
  ok("the bottom edges stay the reach from their segments", close(distToSeg(f.bottom[1], f.top[0], f.top[1]), reach) && close(distToSeg(f.bottom[1], f.top[1], f.top[2]), reach));
  const shared = f.tris.filter((t) => t.includes(4)).length;
  ok("the mitre vertex is shared by the panels either side (continuous surface)", shared === 3);
}

// ── Kept inside the domain: clipped, capped, shortened ──────────────────────
{
  const flat = () => 0;
  const box = { xMin: 0, xMax: 2000, yMin: 0, yMax: 2000 };
  const out = faultPlane({ trace: [[-500, 1000], [2500, 1000]], groundAt: flat, dipDeg: 90, depthM: 500, topOffsetM: 5, box, marginM: 50, baseZ: -5000 });
  ok("a trace longer than the footprint is clipped to the inner box", out.ok && out.clipped && close(out.top[0][0], 50) && close(out.top[1][0], 1950));
  const deep = faultPlane({ trace: [[500, 1000], [1500, 1000]], groundAt: flat, dipDeg: 90, depthM: 5000, topOffsetM: 5, box, marginM: 50, baseZ: -1000 });
  ok("a depth reaching the base is capped a margin above it, and said", deep.ok && close(deep.zBottom, -950) && close(deep.capped, 945) && deep.notes.some((n) => /above the base/.test(n)));
  const wide = faultPlane({ trace: [[1000, 100], [1000, 1900]], groundAt: flat, dipDeg: 30, side: "right", depthM: 1000, topOffsetM: 5, box, marginM: 50, baseZ: -5000 });
  // At 30° a 1000 m drop reaches 1732 m east; the wall is 950 m away, so the plane is shortened.
  ok("a bottom edge that would leave through a wall shortens the plane to the wall", wide.ok && wide.bottom.every((p) => p[0] <= 1950 + 1e-6) && close(Math.max(...wide.bottom.map((p) => p[0])), 1950) && wide.capped !== null && wide.notes.some((n) => /inside the footprint/.test(n)));
  ok("its dip is still what was asked", wide.tris.every(([a, b, c]) => close(triangleDipDeg(wide.points[a], wide.points[b], wide.points[c]), 30, 1e-9)));
  const gone = faultPlane({ trace: [[5000, 5000], [6000, 6000]], groundAt: flat, dipDeg: 60, depthM: 500, box, marginM: 50 });
  ok("a trace wholly outside is refused with a reason", !gone.ok && /outside/.test(gone.message));
  const noGround = faultPlane({ trace: [[100, 100], [200, 200]], groundAt: () => null, dipDeg: 60, depthM: 500, box, marginM: 50 });
  ok("no ground under the trace is refused", !noGround.ok && /no height/.test(noGround.message));
  const noisy = faultPlane({ trace: [[100, 100], [600, 102], [1100, 98], [1600, 100]], groundAt: flat, dipDeg: 60, depthM: 300, topOffsetM: 5, box, marginM: 50, simplifyM: 10 });
  ok("a noisy trace is simplified before it becomes geometry", noisy.ok && noisy.vertices === 2);
}

// ── STL and the gmsh script ─────────────────────────────────────────────────
{
  const flat = () => 0;
  const a = faultPlane({ trace: [[0, 0], [0, 1000]], groundAt: flat, dipDeg: 60, depthM: 500, topOffsetM: 5 });
  const b = faultPlane({ trace: [[500, 0], [500, 1000]], groundAt: flat, dipDeg: 60, depthM: 500, topOffsetM: 5 });
  const faults = [{ ...a, name: "Timpe", flag: 30, sizeM: 40 }, { ...b, name: "Pernicana east", flag: 31, sizeM: 40 }];
  const stl = faultsStl(faults, "geoid_faults");
  ok("one solid per fault, named", (stl.match(/^solid /gm) || []).length === 2 && /solid geoid_faults_timpe/.test(stl) && /solid geoid_faults_pernicana_east/.test(stl));
  ok("four facets in all", (stl.match(/facet normal/g) || []).length === 4);
  ok("a slug is a file-safe name", slug("Pernicana east (part 2)") === "pernicana_east_part_2");
  const lines = faultScriptLines(faults);
  const script = lines.join("\n");
  ok("the script embeds the fault surfaces in the volume", /gmsh\.model\.mesh\.embed\(2, stags, 3, volume\)/.test(script));
  ok("it files each fault under groups with its own name, so the physical-group pass makes it", /groups\[fault\["name"\]\] = stags/.test(script) && /"name":"fault:Timpe","flag":30/.test(script) && /"fault:Pernicana east","flag":31/.test(script));
  ok("every triangle is a planar surface on shared lines", /addPlaneSurface\(\[loop\]\)/.test(script) && /lines\[key\] if a < b else -lines\[key\]/.test(script));
  ok("HXT is stood down for the embedding", /Mesh\.Algorithm3D", 1\)/.test(script));
  ok("Python literals, not JSON", !/\btrue\b|\bnull\b/.test(script));
  ok("no faults, no lines", faultScriptLines([]).length === 0);
}

// ── What a catalogue already says, and two planes that cross ────────────────
{
  ok("GEM's tuples give their preferred number; an empty first slot falls to the next",
    tupleFirst("(40,30,50)") === 40 && tupleFirst("(,30,50)") === 30 && tupleFirst(55) === 55 && tupleFirst("") === null && tupleFirst("(,,)") === null);
  // A fault striking north (0 deg): right of travel is east.
  const east = faultDefaultsFrom({ average_dip: "(65,50,80)", dip_dir: "E", lower_seis_depth: "(12,,)" }, 0);
  ok("a stated dip direction picks the side: east of a north-striking trace is its right",
    east.dipDeg === 65 && east.side === "right" && east.depthM === 12000 && east.from.length === 3);
  ok("and west is its left", faultDefaultsFrom({ dip_dir: "W" }, 0).side === "left");
  ok("an oblique direction goes to the nearer perpendicular", faultDefaultsFrom({ dip_dir: "SE" }, 30).side === "right" && faultDefaultsFrom({ dip_dir: "NW" }, 30).side === "left");
  ok("nothing stated, nothing claimed", faultDefaultsFrom({}, 10).from.length === 0 && faultDefaultsFrom({ average_dip: "(0,,)" }, 10).dipDeg === undefined);

  const flat = () => 0;
  const mk = (name, trace, o = {}) => ({ name, ...faultPlane({ trace, groundAt: flat, dipDeg: 90, depthM: 1000, topOffsetM: 10, ...o }) });
  const ns = mk("north-south", [[0, -1000], [0, 1000]]);
  const ew = mk("east-west", [[-1000, 0], [1000, 0]]);
  const far = mk("far", [[5000, -1000], [5000, 1000]]);
  const under = mk("under", [[-1000, 0], [1000, 0]], { topOffsetM: 2000 });
  ok("two vertical planes through one point cross, whichever is asked first", planesCross(ns, ew) && planesCross(ew, ns));
  ok("planes five kilometres apart do not", !planesCross(ns, far));
  ok("a plane wholly BELOW another's bottom edge does not", !planesCross(ns, under));
  const dipping = mk("dipping", [[500, -1000], [500, 1000]], { dipDeg: 45, side: "left" });
  ok("a plane dipping under a vertical one crosses it at depth, though the traces never meet", planesCross(ns, dipping));
  const sorted = nonCrossing([ns, ew, far]);
  ok("the first of a crossing pair is kept and the second named with what it crossed",
    sorted.kept.map((k) => k.name).join() === "north-south,far" && sorted.dropped[0].name === "east-west" && sorted.dropped[0].crosses === "north-south");
}

// ── The wiring: a fault reaches every script whose volume holds it ───────────
{
  const { readFileSync } = await import("node:fs");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const pipe = strip(readFileSync(new URL("./model-pipeline.js", import.meta.url), "utf8"));
  ok("a line layer is offered the fault role, and only a line layer", /id: "fault"/.test(pipe) && /o\.id === "fault" && can\.fault/.test(pipe) && /fault: hasLines\(/.test(pipe));
  ok("the planes go into the unlayered domain's script", /flags: state\.flags,\s*faults,/.test(pipe));
  ok("and into the layered BEDROCK's, with the points that lie in each volume", /faults: vol\.id === "bedrock" \? faults : \[\]/.test(pipe) && /embedPoints: pointsIn\[vol\.id\]/.test(pipe));
  ok("with soil on, a fault hangs from the bedrock surface, not the ground", /tinWith\(t, L\.soil \? H\.bedrock : H\.solid\)/.test(pipe));
  ok("the base a plane clears is the unlayered domain's, the higher of the two", /const baseZ = t\.zMin - Math\.max\(state\.domain\.depthM, 1\)/.test(pipe));
  ok("crossing planes are left out before gmsh meets them", /nonCrossing\(built\)/.test(pipe));
  ok("a catalogue's own dip, direction and depth open a trace", /faultDefaultsFrom\(c\.properties, traceStrikeDeg\(c\.coords\)\)/.test(pipe));
  ok("the studio is handed the planes and the model page's flag edit comes back", /faults: state\.kind === "3d" \?/.test(pipe) && /setFaultFlag:/.test(pipe));
  const provAt = pipe.indexOf("provenance: {", pipe.indexOf("async function writePackage"));
  const provenance = pipe.slice(provAt, pipe.indexOf("built_at:", provAt));
  const topKeys = (provenance.match(/^      [a-z_]+:/gm) || []).map((k) => k.trim());
  ok("the pin is reading the provenance, not an empty slice", topKeys.length > 15 && topKeys.includes("faults:") && topKeys.includes("layer_roles:"));
  ok("no key is written twice into the spec's provenance (a second `layers` replaced the layered volumes)",
    new Set(topKeys).size === topKeys.length, topKeys.filter((k, i) => topKeys.indexOf(k) !== i).join(" "));

  const { layeredGmshScript } = await import("./layered-model.js");
  const plane = faultPlane({ trace: [[0, -500], [0, 500]], groundAt: () => 0, dipDeg: 70, depthM: 800, topOffsetM: 20 });
  const script = layeredGmshScript({ name: "b", stlFile: "b.stl", meshFile: "b.msh", meshSizeM: 200, faceFlags: { base: 2 }, volumeFlag: 10, volumeName: "bedrock",
    embedPoints: [{ x: 1, y: 2, z: -300, sizeM: 50, name: "borehole", flag: 21 }], faults: [{ name: "F1", flag: 33, sizeM: 100, points: plane.points, tris: plane.tris }] });
  ok("a layered volume's script embeds its faults after the volume exists and files them under their flag",
    script.indexOf("addVolume") < script.indexOf("FAULTS =") && /fault_flags = \{"fault:F1":33\}/.test(script) && /faces\.setdefault\(fault_flags\[gname\], \[\]\)\.extend\(stags\)/.test(script)
    && script.indexOf("fault_flags[gname]") < script.indexOf("addPhysicalGroup(2"));
  ok("and its points, tagged with their own flag", /mesh\.embed\(0, \[t for \(t, _, _\) in ptags\], 3, volume\)/.test(script) && /"borehole",21\]/.test(script));
  const bare = layeredGmshScript({ name: "s", stlFile: "s.stl", meshFile: "s.msh", meshSizeM: 40, faceFlags: {}, volumeFlag: 12, volumeName: "soil" });
  ok("a volume with nothing inside it gets neither block", !/FAULTS|embedded =/.test(bare));
}
