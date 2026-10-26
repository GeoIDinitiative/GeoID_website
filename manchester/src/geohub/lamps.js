/**
 * Street lamps along OSM roads, for Earth Flight's night (owner, 2026-10-24:
 * Black Marble as "a guide to add surface level streetlights, urban lighting
 * and using road shp for lampposts"). Pure: decoded vector-tile road lines in,
 * lamp candidates out. Whether a candidate is actually lit, and how brightly,
 * is decided against the Black Marble radiance where it stands
 * (`litPower`), so a motorway through dark country is dark and a residential
 * street in a town is lit.
 *
 * OpenMapTiles `transportation` classes; spacing and setback are typical UK
 * practice (BS 5489): ~45 m on motorways, ~35 m on main roads, ~30 m on
 * residential streets, staggered side to side. Tunnels, tracks, paths, rail and
 * ferries get none.
 */

// code, spacing (m), setback from the centre line (m), Black Marble radiance
// (above its background, 0..1) at which the class starts to be lit.
export const LAMP_CLASSES = {
  motorway: { code: 0, spacing: 45, offset: 13, lit: 0.04 },
  trunk: { code: 1, spacing: 40, offset: 10, lit: 0.06 },
  primary: { code: 2, spacing: 35, offset: 8, lit: 0.08 },
  secondary: { code: 3, spacing: 35, offset: 7, lit: 0.10 },
  tertiary: { code: 4, spacing: 33, offset: 6, lit: 0.12 },
  minor: { code: 5, spacing: 30, offset: 5, lit: 0.15 },
  service: { code: 6, spacing: 40, offset: 4, lit: 0.25 },
};
export const CLASS_BY_CODE = Object.values(LAMP_CLASSES);

/** A stable 0..1 hash of a position, so a lamp is the same lamp every flight. */
export function lampHash(u, v) {
  const s = Math.sin(u * 12.9898 + v * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Lamp candidates along a tile's road lines.
 *   lines: [{ cls, pts: [[x, y], ...] }] in tile units (0..extent)
 *   returns Float32Array of [u, v, code, hash] per lamp, u, v in 0..1 of the tile
 *   (v down, as the tile's y). `thin` > 1 keeps one lamp in `thin` (wider
 *   pitch) for far rings, where the caller brightens each by the same factor.
 */
export function placeLamps(lines, extent, tileSizeM, classes = Object.keys(LAMP_CLASSES), thin = 1) {
  const out = [];
  const mPerUnit = tileSizeM / extent;
  const wanted = new Set(classes);
  for (const { cls, pts } of lines) {
    const c = LAMP_CLASSES[cls];
    if (!c || !wanted.has(cls) || !pts || pts.length < 2) continue;
    const pitch = c.spacing * thin;
    let carry = pitch * 0.5;              // distance to the next lamp
    let side = 1;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const dx = x1 - x0, dy = y1 - y0;
      const segM = Math.hypot(dx, dy) * mPerUnit;
      if (segM < 1e-6) continue;
      const nx = -dy / Math.hypot(dx, dy), ny = dx / Math.hypot(dx, dy);
      let at = carry;
      while (at <= segM) {
        const t = at / segM;
        const off = side * c.offset / mPerUnit;
        const x = x0 + dx * t + nx * off, y = y0 + dy * t + ny * off;
        const u = x / extent, v = y / extent;
        if (u >= 0 && u < 1 && v >= 0 && v < 1) out.push(u, v, c.code, lampHash(u * 4096 + 0.5, v * 4096 + 0.5));
        side = -side;
        // A little irregularity: real columns are not on a perfect pitch.
        at += pitch * (0.9 + 0.2 * lampHash(x, y));
      }
      carry = at - segM;
    }
  }
  return new Float32Array(out);
}

/** Black Marble's dark background sits at ~0.06-0.10: radiance above it, 0..1. */
export function radianceAboveBackground(r, g, b) {
  const lum = (0.35 * r + 0.45 * g + 0.20 * b) / 255;
  return Math.max(0, Math.min(1, (lum - 0.11) / 0.89));
}

/** Is a lamp of this class lit at this radiance, and how strongly (0 = dark)? */
export function litPower(code, rad) {
  const c = CLASS_BY_CODE[code];
  if (!c || rad < c.lit) return 0;
  return 0.45 + 0.55 * Math.min(1, (rad - c.lit) / 0.4);
}
