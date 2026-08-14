/**
 * Turning a photograph back into an albedo map.
 *
 * The imagery is a picture taken at one moment, with the sun wherever it
 * happened to be. Every slope in it is already shaded, and every hollow
 * already has a cast shadow painted into it. Draping that over the terrain
 * and lighting it again multiplies the two: at dawn the game's own shadows
 * land on top of the satellite's, and there are pits on the Khumbu that stay
 * pure black at every hour of the day and night because the darkness is in
 * the texture, not in the lighting.
 *
 * So: estimate where the sun was when the picture was taken, and divide its
 * shading back out.
 *
 * ── Estimating the capture sun ───────────────────────────────────────────
 * We have the elevation model, so for any candidate sun direction we can
 * predict what the shading *should* look like. Sweep a grid of azimuths and
 * elevations, correlate each prediction against the imagery's actual
 * luminance over a few thousand sample points, and take the best fit. Snow
 * has nearly uniform albedo, which is what makes this work at all: over
 * snow, almost all of the variation in the picture IS the shading.
 *
 * It is not a perfect inverse and it cannot be. Cast shadows need the
 * terrain's occlusion rather than just its normal, single scattering ignores
 * the light bouncing between facets, and where the source is genuinely
 * black there is no information left to recover — division cannot invent it.
 * So the recovery is clamped, and what it cannot fix it lifts toward a
 * plausible snow albedo rather than amplifying noise.
 */

import * as THREE from "../vendor/three.module.js?v=c258b35-55266b61";

const SAMPLES = 4000;

/**
 * @returns {{dir: THREE.Vector3, altitude: number, azimuth: number,
 *            correlation: number, meanAlbedo: number}}
 */
export function estimateCaptureSun(field, imagery, halfExtent = 6000) {
  const tier = imagery.byKey.mid && imagery.byKey.mid.ready ? imagery.byKey.mid
             : imagery.byKey.far;
  if (!tier || !tier.ready) return null;

  const cv = tier.canvas;
  const ctx = cv.getContext("2d");
  let px;
  try { px = ctx.getImageData(0, 0, cv.width, cv.height).data; }
  catch (e) { return null; }

  const b = tier.bounds;                    // minX, minZ, width, height

  /* Sample points on a jittered grid, keeping only ground that is bright
     enough to be snow. Rock has real albedo variation and would drag the
     fit toward whatever colour the rock happens to be. */
  const pts = [];
  const side = Math.ceil(Math.sqrt(SAMPLES));
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const fx = (i + 0.5 + (Math.random() - 0.5) * 0.8) / side;
      const fz = (j + 0.5 + (Math.random() - 0.5) * 0.8) / side;
      const x = b.x + fx * b.z, z = b.y + fz * b.w;
      if (Math.abs(x) > halfExtent || Math.abs(z) > halfExtent) continue;

      const ix = Math.min(cv.width - 1, Math.max(0, (fx * cv.width) | 0));
      const iz = Math.min(cv.height - 1, Math.max(0, (fz * cv.height) | 0));
      const p = (iz * cv.width + ix) * 4;
      if (px[p + 3] < 250) continue;
      const lum = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
      if (lum < 0.30) continue;             // shadow or rock: no albedo prior
      const n = field.normal(x, z, 24, { x: 0, y: 1, z: 0 });
      pts.push({ nx: n.x, ny: n.y, nz: n.z, lum });
    }
  }
  if (pts.length < 200) return null;

  /* Sweep. Pearson correlation between predicted N·L and observed luminance;
     the best-correlated direction is the one the sun was in. */
  let best = null;
  for (let azDeg = 0; azDeg < 360; azDeg += 5) {
    const a = azDeg * Math.PI / 180;
    for (let elDeg = 12; elDeg <= 78; elDeg += 3) {
      const e = elDeg * Math.PI / 180;
      const lx = Math.cos(e) * Math.sin(a);
      const ly = Math.sin(e);
      const lz = -Math.cos(e) * Math.cos(a);

      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
      for (const p of pts) {
        const ndl = Math.max(0, p.nx * lx + p.ny * ly + p.nz * lz);
        sx += ndl; sy += p.lum;
        sxx += ndl * ndl; syy += p.lum * p.lum; sxy += ndl * p.lum;
        n++;
      }
      const cov = sxy / n - (sx / n) * (sy / n);
      const vx = sxx / n - (sx / n) ** 2;
      const vy = syy / n - (sy / n) ** 2;
      const r = cov / Math.sqrt(Math.max(1e-9, vx * vy));
      if (!best || r > best.correlation) {
        best = { correlation: r, azimuth: azDeg, altitude: elDeg,
                 dir: new THREE.Vector3(lx, ly, lz) };
      }
    }
  }

  /* The mean albedo the recovery should aim at: what the brightest, most
     face-on snow in the scene implies once its own shading is divided out. */
  const a = best.azimuth * Math.PI / 180, e = best.altitude * Math.PI / 180;
  const L = new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
  let acc = 0, cnt = 0;
  for (const p of pts) {
    const ndl = p.nx * L.x + p.ny * L.y + p.nz * L.z;
    if (ndl < 0.55) continue;
    acc += p.lum / (0.15 + 0.85 * ndl);
    cnt++;
  }
  best.meanAlbedo = cnt ? Math.min(1.1, acc / cnt) : 0.82;
  best.samples = pts.length;
  return best;
}
