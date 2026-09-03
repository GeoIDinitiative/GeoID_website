/**
 * Putting a picture on the globe.
 *
 * A scanned map, a figure from a paper, a screenshot of somebody else's model:
 * these are the layers people actually arrive with, and until now the only way
 * in was a GeoTIFF that already knew where it was. An image has pixels and no
 * opinion about the Earth, so someone has to supply the link — either the
 * corners of the picture, or control points read off recognisable features.
 *
 * The control-point path solves a least-squares AFFINE transform (six
 * parameters: scale, rotation, skew and shift in each axis), which is what
 * every GIS means by a first-order georeference. Three points determine it
 * exactly; more than three over-determine it, and the residuals are then the
 * only honest measure of whether the registration is any good — so they are
 * reported per point and never hidden behind a success message.
 *
 * Rotation is the one limit worth stating plainly: the drape is an
 * axis-aligned lat/lon patch, so a transform with real rotation in it cannot
 * be drawn faithfully. Rather than silently drawing it wrong, the rotation is
 * measured and reported, and past a threshold the tool says the image needs
 * warping the GIS cannot do in the browser.
 */

/* ── the affine solve ───────────────────────────────────────────────────── */

/** Solve `A x = b` by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (Math.abs(M[pivot][c]) < 1e-12) return null;          // singular: collinear points
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * `points` are `[{ x, y, lat, lon }]` — pixel coordinates and where they are.
 * Returns the six coefficients, the per-point residuals in metres, and the RMS.
 */
export function solveAffine(points) {
  const p = (points || []).filter((q) =>
    [q?.x, q?.y, q?.lat, q?.lon].every(Number.isFinite));
  if (p.length < 3) {
    return { ok: false, message: `three control points are the minimum; ${p.length} given` };
  }
  // Normal equations for lon = a·x + b·y + c and lat = d·x + e·y + f.
  const build = (target) => {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const rhs = [0, 0, 0];
    p.forEach((q) => {
      const basis = [q.x, q.y, 1];
      basis.forEach((bi, i) => {
        basis.forEach((bj, j) => { A[i][j] += bi * bj; });
        rhs[i] += bi * target(q);
      });
    });
    return solve(A, rhs);
  };
  const lonC = build((q) => q.lon);
  const latC = build((q) => q.lat);
  if (!lonC || !latC) {
    return { ok: false, message: "those control points are collinear — no unique transform" };
  }
  const [a, b, c] = lonC;
  const [d, e, f] = latC;
  const midLat = p.reduce((s, q) => s + q.lat, 0) / p.length;
  const mPerLat = 110574;
  const mPerLon = 111320 * Math.cos((midLat * Math.PI) / 180);
  const residuals = p.map((q) => {
    const lon = a * q.x + b * q.y + c;
    const lat = d * q.x + e * q.y + f;
    const dx = (lon - q.lon) * mPerLon;
    const dy = (lat - q.lat) * mPerLat;
    return { ...q, lonFit: lon, latFit: lat, errorM: Math.sqrt(dx * dx + dy * dy) };
  });
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r.errorM ** 2, 0) / residuals.length);
  // Rotation is the direction the image's x axis points. Skew is the angle
  // BETWEEN the two axes, less the right angle they should make — and it must
  // be measured from the axis vectors rather than from each one's own bearing,
  // because an image's y grows downward: a perfectly north-up picture has
  // e < 0, and reading that as a bearing calls it 180° skewed.
  const rotationDeg = (Math.atan2(d, a) * 180) / Math.PI;
  const cross = a * e - d * b;
  const dot = a * b + d * e;
  const between = (Math.atan2(cross, dot) * 180) / Math.PI;   // −90° when north-up
  const skewDeg = between + 90;
  return {
    ok: true,
    coefficients: { a, b, c, d, e, f },
    residuals,
    rmsMetres: Number(rms.toFixed(2)),
    rotationDeg: Number(rotationDeg.toFixed(3)),
    skewDeg: Number(skewDeg.toFixed(3)),
    points: p.length,
  };
}

/** Apply a solved transform to a pixel. */
export function pixelToLatLon({ a, b, c, d, e, f }, x, y) {
  return { lon: a * x + b * y + c, lat: d * x + e * y + f };
}

/**
 * The lat/lon box an image occupies under a transform.
 *
 * All four corners, not two: with any rotation at all the extreme longitude
 * can belong to a corner the diagonal never touches.
 */
export function boundsFromTransform(coefficients, width, height) {
  const corners = [[0, 0], [width, 0], [width, height], [0, height]]
    .map(([x, y]) => pixelToLatLon(coefficients, x, y));
  return {
    minX: Math.min(...corners.map((p) => p.lon)),
    maxX: Math.max(...corners.map((p) => p.lon)),
    minY: Math.min(...corners.map((p) => p.lat)),
    maxY: Math.max(...corners.map((p) => p.lat)),
  };
}

/** The transform implied by naming the corners of the picture. */
export function transformFromBounds(bounds, width, height) {
  const { minX, minY, maxX, maxY } = bounds;
  return {
    a: (maxX - minX) / width, b: 0, c: minX,
    d: 0, e: (minY - maxY) / height, f: maxY,     // y grows downward in an image
  };
}

/** How far from a north-up, axis-aligned drape this transform is. */
export function drapeWarning(fit, { rotationLimitDeg = 1.5, skewLimitDeg = 1.5 } = {}) {
  if (!fit?.ok) return null;
  const problems = [];
  if (Math.abs(fit.rotationDeg) > rotationLimitDeg) {
    problems.push(`rotated ${fit.rotationDeg.toFixed(1)}°`);
  }
  if (Math.abs(fit.skewDeg) > skewLimitDeg) {
    problems.push(`skewed ${fit.skewDeg.toFixed(1)}°`);
  }
  if (!problems.length) return null;
  return `This image is ${problems.join(" and ")}. The globe drapes an `
    + "axis-aligned lat/lon patch, so it will be placed by its bounding box and "
    + "features will not line up exactly. Warping it needs GDAL through the sidecar.";
}

/* ── decoding an image into bands ───────────────────────────────────────── */

/** An image file to three 8-bit bands, at a size the drape can carry. */
export async function imageToBands(file, { maxSide = 2048 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("that file is not an image the browser can read"));
      img.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    const r = new Uint8Array(width * height);
    const g = new Uint8Array(width * height);
    const b = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
      r[i] = data[i * 4];
      g[i] = data[i * 4 + 1];
      b[i] = data[i * 4 + 2];
    }
    return { bands: [r, g, b], width, height, sourceWidth: image.width, sourceHeight: image.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

if (typeof window !== "undefined") {
  window.GeoIDGeoreference = {
    solveAffine, pixelToLatLon, boundsFromTransform, transformFromBounds,
    drapeWarning, imageToBands,
  };
}
