// Parametric solids, mirroring the Meshing Studio's primitive set (which is
// built on Gmsh OCC) but defined natively so they work in the browser.
//
// Each primitive provides two things:
//   surface(params) -> triangle soup, for display
//   inside(params)  -> point-in-solid test, for volume meshing and CSG
//
// Keeping an exact inside-test alongside the display mesh is what lets the
// volume mesher and the boolean operations work without a CAD kernel.

const DEG = Math.PI / 180;

function pushTri(out, a, b, c) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function pushQuad(out, a, b, c, d) {
  pushTri(out, a, b, c);
  pushTri(out, a, c, d);
}

/** Revolution surface from a profile of [radius, z] pairs. */
function revolve(profile, segments, transform = (p) => p) {
  const out = [];
  for (let i = 0; i < segments; i += 1) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;
    for (let k = 0; k + 1 < profile.length; k += 1) {
      const [r0, z0] = profile[k];
      const [r1, z1] = profile[k + 1];
      const p = (r, z, t) => transform([r * Math.cos(t), r * Math.sin(t), z]);
      const a = p(r0, z0, t0);
      const b = p(r0, z0, t1);
      const c = p(r1, z1, t1);
      const d = p(r1, z1, t0);
      if (r0 === 0) {
        pushTri(out, a, c, d);
      } else if (r1 === 0) {
        pushTri(out, a, b, c);
      } else {
        pushQuad(out, a, b, c, d);
      }
    }
  }
  return out;
}

function boxSurface(x, y, z, dx, dy, dz) {
  const out = [];
  const v = [
    [x, y, z], [x + dx, y, z], [x + dx, y + dy, z], [x, y + dy, z],
    [x, y, z + dz], [x + dx, y, z + dz], [x + dx, y + dy, z + dz], [x, y + dy, z + dz],
  ];
  const faces = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
    [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ];
  faces.forEach(([a, b, c, d]) => pushQuad(out, v[a], v[b], v[c], v[d]));
  return out;
}

/** Rotates a point about the origin: dip about +Y then strike about +Z. */
function dikeTransform(params) {
  const dip = (90 - params.dip) * DEG;
  const strike = -params.strike * DEG;
  const cd = Math.cos(dip);
  const sd = Math.sin(dip);
  const cs = Math.cos(strike);
  const ss = Math.sin(strike);
  return (p, invert = false) => {
    if (!invert) {
      // rotate about Y, then about Z
      const x1 = p[0] * cd + p[2] * sd;
      const z1 = -p[0] * sd + p[2] * cd;
      return [x1 * cs - p[1] * ss, x1 * ss + p[1] * cs, z1];
    }
    const x1 = p[0] * cs + p[1] * ss;
    const y1 = -p[0] * ss + p[1] * cs;
    return [x1 * cd - p[2] * sd, y1, x1 * sd + p[2] * cd];
  };
}

export function parseThicknesses(raw) {
  return String(raw ?? "")
    .split(/[,\s]+/)
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0);
}

// Parameter specs mirror meshing_studio/primitives.py so models transfer.
export const PRIMITIVES = {
  box: {
    label: "Box",
    group: "Basic",
    params: { x: ["X", 0], y: ["Y", 0], z: ["Z", 0], dx: ["Width", 1], dy: ["Depth", 1], dz: ["Height", 1] },
    surface: (p) => boxSurface(p.x, p.y, p.z, p.dx, p.dy, p.dz),
    inside: (p) => (q) => q[0] >= p.x && q[0] <= p.x + p.dx
      && q[1] >= p.y && q[1] <= p.y + p.dy
      && q[2] >= p.z && q[2] <= p.z + p.dz,
  },
  sphere: {
    label: "Sphere",
    group: "Basic",
    params: { x: ["Center X", 0], y: ["Center Y", 0], z: ["Center Z", 0], r: ["Radius", 0.5] },
    surface: (p, seg = 32) => {
      const profile = [];
      for (let i = 0; i <= seg / 2; i += 1) {
        const a = (i / (seg / 2)) * Math.PI;
        profile.push([p.r * Math.sin(a), p.r * Math.cos(a)]);
      }
      return revolve(profile, seg, (q) => [q[0] + p.x, q[1] + p.y, q[2] + p.z]);
    },
    inside: (p) => (q) => ((q[0] - p.x) ** 2 + (q[1] - p.y) ** 2 + (q[2] - p.z) ** 2) <= p.r * p.r,
  },
  ellipsoid: {
    label: "Ellipsoid",
    group: "Basic",
    params: { x: ["Center X", 0], y: ["Center Y", 0], z: ["Center Z", 0], rx: ["Radius X", 1], ry: ["Radius Y", 0.6], rz: ["Radius Z", 0.4] },
    surface: (p, seg = 32) => {
      const profile = [];
      for (let i = 0; i <= seg / 2; i += 1) {
        const a = (i / (seg / 2)) * Math.PI;
        profile.push([Math.sin(a), Math.cos(a)]);
      }
      return revolve(profile, seg, (q) => [q[0] * p.rx + p.x, q[1] * p.ry + p.y, q[2] * p.rz + p.z]);
    },
    inside: (p) => (q) => (((q[0] - p.x) / p.rx) ** 2 + ((q[1] - p.y) / p.ry) ** 2
      + ((q[2] - p.z) / p.rz) ** 2) <= 1,
  },
  cylinder: {
    label: "Cylinder",
    group: "Basic",
    params: { x: ["Base X", 0], y: ["Base Y", 0], z: ["Base Z", 0], h: ["Height", 1], r: ["Radius", 0.5] },
    surface: (p, seg = 32) => revolve(
      [[0, 0], [p.r, 0], [p.r, p.h], [0, p.h]], seg,
      (q) => [q[0] + p.x, q[1] + p.y, q[2] + p.z],
    ),
    inside: (p) => (q) => q[2] >= p.z && q[2] <= p.z + p.h
      && ((q[0] - p.x) ** 2 + (q[1] - p.y) ** 2) <= p.r * p.r,
  },
  cone: {
    label: "Cone",
    group: "Basic",
    params: { x: ["Base X", 0], y: ["Base Y", 0], z: ["Base Z", 0], h: ["Height", 1], r1: ["Base radius", 0.5], r2: ["Top radius", 0] },
    surface: (p, seg = 32) => revolve(
      [[0, 0], [p.r1, 0], [p.r2, p.h], [0, p.h]], seg,
      (q) => [q[0] + p.x, q[1] + p.y, q[2] + p.z],
    ),
    inside: (p) => (q) => {
      if (q[2] < p.z || q[2] > p.z + p.h) return false;
      const t = p.h === 0 ? 0 : (q[2] - p.z) / p.h;
      const r = p.r1 + (p.r2 - p.r1) * t;
      return ((q[0] - p.x) ** 2 + (q[1] - p.y) ** 2) <= r * r;
    },
  },
  torus: {
    label: "Torus",
    group: "Basic",
    params: { x: ["Center X", 0], y: ["Center Y", 0], z: ["Center Z", 0], r1: ["Major radius", 1], r2: ["Minor radius", 0.3] },
    surface: (p, seg = 32) => {
      const profile = [];
      for (let i = 0; i <= seg; i += 1) {
        const a = (i / seg) * Math.PI * 2;
        profile.push([p.r1 + p.r2 * Math.cos(a), p.r2 * Math.sin(a)]);
      }
      return revolve(profile, seg, (q) => [q[0] + p.x, q[1] + p.y, q[2] + p.z]);
    },
    inside: (p) => (q) => {
      const dx = q[0] - p.x;
      const dy = q[1] - p.y;
      const dz = q[2] - p.z;
      const a = Math.sqrt(dx * dx + dy * dy) - p.r1;
      return (a * a + dz * dz) <= p.r2 * p.r2;
    },
  },

  // ---------------------------------------------------------- volcanology
  layered_halfspace: {
    label: "Layered halfspace",
    group: "Geological",
    params: { width: ["Width", 10], depth: ["Depth", 10], thicknesses: ["Thicknesses", "1,2,3"] },
    surface: (p) => {
      const out = [];
      let z = 0;
      parseThicknesses(p.thicknesses).forEach((th) => {
        out.push(...boxSurface(-p.width / 2, -p.depth / 2, z - th, p.width, p.depth, th));
        z -= th;
      });
      return out;
    },
    inside: (p) => {
      const total = parseThicknesses(p.thicknesses).reduce((a, b) => a + b, 0);
      return (q) => Math.abs(q[0]) <= p.width / 2 && Math.abs(q[1]) <= p.depth / 2
        && q[2] <= 0 && q[2] >= -total;
    },
    /** Layer index at a depth, so the volume mesh can be tagged by layer. */
    region: (p) => {
      const ths = parseThicknesses(p.thicknesses);
      return (q) => {
        let z = 0;
        for (let i = 0; i < ths.length; i += 1) {
          z -= ths[i];
          if (q[2] >= z) return i + 1;
        }
        return ths.length;
      };
    },
  },
  volcano_edifice: {
    label: "Volcano edifice",
    group: "Geological",
    params: {
      crust_width: ["Crust width", 20], crust_depth: ["Crust depth", 10],
      height: ["Edifice height", 3], base_radius: ["Base radius", 5], summit_radius: ["Summit radius", 0.5],
    },
    surface: (p, seg = 48) => {
      const w = p.crust_width;
      const out = boxSurface(-w / 2, -w / 2, -p.crust_depth, w, w, p.crust_depth);
      out.push(...revolve([[p.base_radius, 0], [p.summit_radius, p.height], [0, p.height]], seg));
      return out;
    },
    inside: (p) => (q) => {
      const w = p.crust_width / 2;
      const inCrust = Math.abs(q[0]) <= w && Math.abs(q[1]) <= w
        && q[2] <= 0 && q[2] >= -p.crust_depth;
      if (inCrust) return true;
      if (q[2] < 0 || q[2] > p.height) return false;
      const t = p.height === 0 ? 0 : q[2] / p.height;
      const r = p.base_radius + (p.summit_radius - p.base_radius) * t;
      return (q[0] * q[0] + q[1] * q[1]) <= r * r;
    },
  },
  dike: {
    label: "Dike",
    group: "Geological",
    params: {
      x: ["X", 0], y: ["Y", 0], length: ["Length", 4], height: ["Height", 3],
      thickness: ["Thickness", 0.2], top_depth: ["Top depth", 1],
      strike: ["Strike (deg)", 0], dip: ["Dip (deg)", 90],
    },
    surface: (p) => {
      const zc = -Math.abs(p.top_depth) - p.height / 2;
      const local = boxSurface(-p.thickness / 2, -p.length / 2, -p.height / 2,
        p.thickness, p.length, p.height);
      const rot = dikeTransform(p);
      const out = [];
      for (let i = 0; i < local.length; i += 3) {
        const q = rot([local[i], local[i + 1], local[i + 2]]);
        out.push(q[0] + p.x, q[1] + p.y, q[2] + zc);
      }
      return out;
    },
    inside: (p) => {
      const zc = -Math.abs(p.top_depth) - p.height / 2;
      const rot = dikeTransform(p);
      return (q) => {
        const local = rot([q[0] - p.x, q[1] - p.y, q[2] - zc], true);
        return Math.abs(local[0]) <= p.thickness / 2
          && Math.abs(local[1]) <= p.length / 2
          && Math.abs(local[2]) <= p.height / 2;
      };
    },
  },
};

export function defaultParams(kind) {
  const spec = PRIMITIVES[kind];
  if (!spec) return {};
  const out = {};
  Object.entries(spec.params).forEach(([key, [, value]]) => { out[key] = value; });
  return out;
}

function coerce(kind, params) {
  const merged = { ...defaultParams(kind), ...(params || {}) };
  Object.keys(merged).forEach((key) => {
    if (key !== "thicknesses" && typeof merged[key] === "string") {
      merged[key] = Number(merged[key]);
    }
  });
  return merged;
}

/** Display surface as a flat triangle-soup Float32Array. */
export function buildSurface(kind, params, segments) {
  const spec = PRIMITIVES[kind];
  if (!spec) {
    throw new Error(`Unknown primitive: ${kind}`);
  }
  const merged = coerce(kind, params);
  return { positions: new Float32Array(spec.surface(merged, segments)), params: merged };
}

/** Point-in-solid test, used for volume meshing and boolean operations. */
export function buildInside(kind, params) {
  const spec = PRIMITIVES[kind];
  if (!spec) {
    throw new Error(`Unknown primitive: ${kind}`);
  }
  return spec.inside(coerce(kind, params));
}

export function boundingBoxOf(kind, params) {
  const { positions } = buildSurface(kind, params, 16);
  const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < b.minX) b.minX = positions[i];
    if (positions[i] > b.maxX) b.maxX = positions[i];
    if (positions[i + 1] < b.minY) b.minY = positions[i + 1];
    if (positions[i + 1] > b.maxY) b.maxY = positions[i + 1];
    if (positions[i + 2] < b.minZ) b.minZ = positions[i + 2];
    if (positions[i + 2] > b.maxZ) b.maxZ = positions[i + 2];
  }
  return b;
}
