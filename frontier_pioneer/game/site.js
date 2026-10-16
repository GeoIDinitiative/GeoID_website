/**
 * A site: the manifest the tile pipeline wrote (sites/<id>/site.json) and the
 * coordinate conversions that follow from it.
 *
 * WORLD FRAME: X east, Z south, Y up, in true metres, origin at the centre of
 * the site; Y is height above the areoid minus `height.ref` so the numbers the
 * GPU sees stay small. The tiles are on the source products' equirectangular
 * grid, which is true-scale north-south and stretched east-west by
 * 1/cos(lat): `cos` below is that correction.
 */

/** Sites offered on the title screen. More entries here is all the launcher needs. */
export const SITES = [
  { id: "jezero", name: "Jezero Crater", path: "sites/jezero/" },
  { id: "gale", name: "Gale Crater", path: "sites/gale/" },
  // the regional sites (tools/build_regional.py), in campaign order
  { id: "arcadia", name: "Arcadia Planitia", path: "sites/arcadia/" },
  { id: "north_polar", name: "North Polar Layered Deposits", path: "sites/north_polar/" },
  { id: "korolev", name: "Korolev crater", path: "sites/korolev/" },
  { id: "arsia", name: "Arsia Mons flank", path: "sites/arsia/" },
  { id: "utopia", name: "Utopia Planitia", path: "sites/utopia/" },
  { id: "valles", name: "Coprates Chasma", path: "sites/valles/" },
  { id: "hellas", name: "Hellas Planitia", path: "sites/hellas/" },
  { id: "olympus", name: "Olympus Mons summit", path: "sites/olympus/" },
];

export class Site {
  constructor(manifest, base) {
    this.manifest = manifest;
    this.base = base;
    this.id = manifest.id;
    this.name = manifest.name;
    const g = manifest.grid;
    this.cos = g.cos_lat0;
    this.projW = g.size_projected_m[0];
    this.projH = g.size_projected_m[1];
    this.halfX = this.projW * this.cos / 2;      // true metres, east-west half extent
    this.halfZ = this.projH / 2;
    this.x0 = g.origin_projected[0];
    this.y0 = g.origin_projected[1];
    this.R = g.projection.radius_m;
    // Projected x -> longitude. Jezero and Gale are on the products' own grid (lon0 0, latTs 0: x = R lon);
    // a regional site (tools/build_regional.py) has its own grid, true scale at its latitude and
    // centred on its longitude (x = R cos(latTs) (lon - lon0)), so `cos` there is 1.
    const P = g.projection;
    this.lon0 = P.lon_0_deg || 0;
    this.lonScale = P.lat_ts_deg != null ? this.R * Math.cos(P.lat_ts_deg * Math.PI / 180) : this.R;
    this.heightRef = manifest.height.ref;
    this.levels = manifest.levels;
    this.heightLevels = this.levels.filter((l) => l.kind === "height").sort((a, b) => b.mpp - a.mpp);
    this.imageryLevels = this.levels.filter((l) => l.kind === "imagery").sort((a, b) => b.mpp - a.mpp);
    for (const l of this.levels) {
      l.has = new Set(l.tiles.map((t) => t[0] + "_" + t[1]));
      // world metres per sample along X and along Z
      l.sx = l.mpp * this.cos; l.sz = l.mpp;
    }
    this.pois = manifest.pois;
    this.start = manifest.start;
  }

  static async load(base, variant = "") {
    const url = base + (variant === "lite" ? "site.lite.json" : "site.json");
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error("site manifest not found: " + url);
    return new Site(await r.json(), base);
  }

  tileUrl(level, tx, ty) {
    return this.base + level.path.replace("{tx}", tx).replace("{ty}", ty);
  }

  /** World X/Z -> fractional sample index of a level (pixel-centre convention). */
  u(level, x) { return (x / this.cos + this.projW / 2) / level.mpp - 0.5; }
  v(level, z) { return (z + this.projH / 2) / level.mpp - 0.5; }

  /** World -> planetocentric degrees. */
  toLonLat(x, z) {
    const px = this.x0 + this.projW / 2 + x / this.cos;
    const py = this.y0 - this.projH / 2 - z;
    let lon = this.lon0 + px / this.lonScale * 180 / Math.PI;
    if (this.lon0) lon = ((lon % 360) + 360) % 360;
    return { lon, lat: py / this.R * 180 / Math.PI };
  }
  fromLonLat(lon, lat) {
    const dl = this.lon0 ? ((lon - this.lon0 + 540) % 360) - 180 : lon;
    const px = this.lonScale * dl * Math.PI / 180, py = this.R * lat * Math.PI / 180;
    return { x: (px - (this.x0 + this.projW / 2)) * this.cos, z: (this.y0 - this.projH / 2) - py };
  }
  /** Real elevation (metres above the areoid) from a world Y. */
  elevation(y) { return y + this.heightRef; }
  inside(x, z, margin = 0) {
    return Math.abs(x) <= this.halfX - margin && Math.abs(z) <= this.halfZ - margin;
  }
}
