/**
 * How much real detail is in the DEM we actually stream?
 *
 * A terrarium tile pyramid will happily serve you zoom 15. That does not mean
 * zoom 15 contains zoom-15 information. If the source over High Mountain Asia
 * is 30 m SRTM/ALOS, then every level past ~z12 is an interpolation of it, and
 * the extra tiles cost bandwidth while adding nothing but smooth ramps.
 *
 * The test: build the height grid at level z, and separately build it at z-1
 * and bilinearly upsample that to the same grid. If level z carries genuine
 * information the residual is large; if it is an interpolation the residual
 * collapses toward zero. Where the residual falls off the cliff is the true
 * resolution of the data, whatever the pyramid claims.
 *
 *   node tools/dem_information.mjs
 */

import zlib from "node:zlib";

const LAT = 27.9930, LON = 86.8950;      // ASCENT's ORIGIN — the Everest massif
const LEVELS = [10, 11, 12, 13, 14, 15];
const URL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/* ── Minimal PNG reader: 8-bit RGB(A), no interlace. Terrarium is exactly
      that, so there is no reason to carry a dependency for it. ───────────── */
function decodePNG(buf) {
  let p = 8, w = 0, h = 0, bitDepth = 0, colour = 0, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colour = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG unsupported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
  if (!ch) throw new Error(`colour type ${colour} unsupported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  // Undo the per-scanline filters (PNG spec 9.2).
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const dst = out.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? dst[i - ch] : 0;
      const b = up ? up[i] : 0;
      const c = (up && i >= ch) ? up[i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      dst[i] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z;
};

async function tile(z, x, y) {
  const r = await fetch(URL(z, x, y));
  if (!r.ok) throw new Error(`${z}/${x}/${y} → ${r.status}`);
  const png = decodePNG(Buffer.from(await r.arrayBuffer()));
  const { w, h, ch, data } = png;
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    out[i] = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768;
  }
  return { w, h, e: out };
}

/** A 2x2-tile block centred on the massif, as one (2*256)^2 grid. */
async function grid(z) {
  const x0 = Math.floor(lon2x(LON, z)) , y0 = Math.floor(lat2y(LAT, z));
  const N = 256, G = N * 2;
  const g = new Float64Array(G * G);
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    const t = await tile(z, x0 + tx, y0 + ty);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      g[(ty * N + y) * G + tx * N + x] = t.e[y * N + x];
  }
  // Metres per pixel at this latitude, for reporting.
  const mpp = 156543.03392 * Math.cos(LAT * Math.PI / 180) / 2 ** z;
  return { g, G, mpp, x0, y0 };
}

/** Bilinear upsample of a GxG grid by 2, on the same geographic footprint. */
function up2(g, G) {
  const H = G * 2, o = new Float64Array(H * H);
  const at = (x, y) => g[Math.min(G - 1, Math.max(0, y)) * G + Math.min(G - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++) for (let x = 0; x < H; x++) {
    const fx = (x + 0.5) / 2 - 0.5, fy = (y + 0.5) / 2 - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), sx = fx - ix, sy = fy - iy;
    o[y * H + x] = at(ix, iy) * (1 - sx) * (1 - sy) + at(ix + 1, iy) * sx * (1 - sy)
                 + at(ix, iy + 1) * (1 - sx) * sy + at(ix + 1, iy + 1) * sx * sy;
  }
  return o;
}

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

console.log(`Terrarium DEM over ${LAT}N ${LON}E — information added per level\n`);
console.log("  z   m/px    grid    RMS residual vs upsampled parent   verdict");

let prev = null;
for (const z of LEVELS) {
  const cur = await grid(z);
  let line = `  ${String(z).padStart(2)}  ${cur.mpp.toFixed(2).padStart(6)}  ${cur.G}²`;
  if (prev) {
    /* The parent 2x2 block spans four child tiles; this child block is a 2x2
       tile window inside it. The offset is in PARENT PIXELS — one child tile
       is 128 parent pixels, not one parent quadrant. Getting this wrong
       misaligns the grids by kilometres and reports ~1000 m of "detail". */
    const qx = cur.x0 - prev.x0 * 2, qy = cur.y0 - prev.y0 * 2;   // 0..2 tiles
    const N = 256;                                  // parent px covering 2 child tiles
    const ox = qx * 128, oy = qy * 128;
    if (ox < 0 || oy < 0 || ox + N > prev.G || oy + N > prev.G)
      throw new Error(`parent window (${ox},${oy}) outside ${prev.G}² grid`);
    const sub = new Float64Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      sub[y * N + x] = prev.g[(oy + y) * prev.G + ox + x];
    const u = up2(sub, N);                       // now G x G, same footprint
    const d = [];
    for (let i = 0; i < cur.g.length; i++) {
      const v = cur.g[i] - u[i];
      // The massif has one corrupt scanline (see DEM_DESPIKE_M in config.js).
      // Keep it out of the statistic rather than letting it set the answer.
      if (Math.abs(v) < 300) d.push(v);
    }
    const r = rms(d);
    const s = d.map(Math.abs).sort((a, b) => a - b);
    const p50 = s[s.length >> 1];
    const verdict = r < 0.75 ? "INTERPOLATED — no new data"
                  : r < 3 ? "marginal"
                  : "real detail";
    line += `   ${r.toFixed(2).padStart(6)} m  (med ${p50.toFixed(2).padStart(5)})  ${verdict}`;
  } else line += `        —                                  (base)`;
  console.log(line);
  prev = cur;
}
