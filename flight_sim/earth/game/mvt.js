/**
 * Mapbox Vector Tile decoding — just enough of it to read one layer.
 *
 * Written rather than vendored because what is needed is small and exact:
 * a protobuf varint reader, the four MVT messages, and the MoveTo / LineTo /
 * ClosePath command stream. The usual pair (pbf + @mapbox/vector-tile) is two
 * dependencies, a CommonJS build and a lot of API for ~150 lines of work.
 *
 * Plain ES module with no DOM and no three.js, so the building worker and a
 * node test can both import it.
 */

class Reader {
  constructor(buf) {
    this.b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.p = 0;
  }
  varint() {
    // Up to 2^53 is all MVT ever needs; past 28 bits use multiplication so
    // nothing is lost to 32-bit bitwise maths.
    let v = 0, shift = 0, byte;
    do {
      byte = this.b[this.p++];
      v += shift < 28 ? (byte & 0x7f) << shift : (byte & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (byte & 0x80);
    return v;
  }
  svarint() { const v = this.varint(); return (v % 2 === 1) ? (v + 1) / -2 : v / 2; }
  bytes() { const n = this.varint(); const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
  string() { return new TextDecoder().decode(this.bytes()); }
  float() { const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 4).getFloat32(0, true); this.p += 4; return v; }
  double() { const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 8).getFloat64(0, true); this.p += 8; return v; }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) this.p += this.varint();
    else if (wire === 5) this.p += 4;
    else throw new Error("mvt: unsupported wire type " + wire);
  }
  packed() {
    const end = this.varint() + this.p, out = [];
    while (this.p < end) out.push(this.varint());
    return out;
  }
}

function readValue(r) {
  const end = r.varint() + r.p;
  let v = null;
  while (r.p < end) {
    const tag = r.varint(), f = tag >> 3, w = tag & 7;
    if (f === 1) v = r.string();
    else if (f === 2) v = r.float();
    else if (f === 3) v = r.double();
    else if (f === 4) v = r.varint();          // int64 (non-negative in practice)
    else if (f === 5) v = r.varint();
    else if (f === 6) v = r.svarint();
    else if (f === 7) v = !!r.varint();
    else r.skip(w);
  }
  return v;
}

/**
 * Decode one named layer from a tile. Returns null if the tile has no such
 * layer. Every other layer is skipped by length without being parsed, which
 * is most of the tile: in central London the building layer is about a third
 * of OpenFreeMap's z14 bytes.
 *
 * Features come back as `{ type, props, geometry }` with geometry the raw
 * command stream, decoded on demand by `rings()`.
 */
export function decodeLayer(buf, wanted) {
  const r = new Reader(buf);
  while (r.p < r.b.length) {
    const tag = r.varint(), f = tag >> 3, w = tag & 7;
    if (f !== 3 || w !== 2) { r.skip(w); continue; }
    const len = r.varint(), end = r.p + len;
    // Peek the name: it is field 1 and by convention first, but do not rely
    // on that — scan the layer once for it.
    const start = r.p;
    let name = null;
    while (r.p < end) {
      const t = r.varint();
      if ((t >> 3) === 1) { name = r.string(); break; }
      r.skip(t & 7);
    }
    if (name !== wanted) { r.p = end; continue; }
    r.p = start;
    return readLayer(r, end);
  }
  return null;
}

function readLayer(r, end) {
  const keys = [], values = [], raw = [];
  let extent = 4096, name = "";
  while (r.p < end) {
    const tag = r.varint(), f = tag >> 3, w = tag & 7;
    if (f === 1) name = r.string();
    else if (f === 2) {
      const fend = r.varint() + r.p;
      const feat = { type: 0, tags: null, geometry: null };
      while (r.p < fend) {
        const t = r.varint(), ff = t >> 3, ww = t & 7;
        if (ff === 2) feat.tags = r.packed();
        else if (ff === 3) feat.type = r.varint();
        else if (ff === 4) feat.geometry = r.packed();
        else r.skip(ww);
      }
      raw.push(feat);
    }
    else if (f === 3) keys.push(r.string());
    else if (f === 4) values.push(readValue(r));
    else if (f === 5) extent = r.varint();
    else r.skip(w);
  }
  const features = raw.map((ft) => {
    const props = {};
    if (ft.tags) for (let i = 0; i + 1 < ft.tags.length; i += 2) props[keys[ft.tags[i]]] = values[ft.tags[i + 1]];
    return { type: ft.type, props, geometry: ft.geometry || [] };
  });
  return { name, extent, features };
}

/** Decode a geometry command stream into rings of [x, y] in tile units. */
export function rings(geometry) {
  const out = [];
  let x = 0, y = 0, ring = null, i = 0;
  while (i < geometry.length) {
    const cmd = geometry[i++], id = cmd & 7, count = cmd >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < count; k++) {
        const dx = geometry[i++], dy = geometry[i++];
        x += (dx >> 1) ^ (-(dx & 1));
        y += (dy >> 1) ^ (-(dy & 1));
        if (id === 1) { ring = [[x, y]]; out.push(ring); }
        else if (ring) ring.push([x, y]);
      }
    } else if (id === 7) {
      ring = null;
    } else {
      break;   // malformed: stop rather than read garbage as coordinates
    }
  }
  return out;
}

/** Shoelace area in tile units (y down): positive = exterior ring per spec 2.x. */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++)
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  return a / 2;
}

/**
 * Group rings into polygons: each exterior followed by its holes.
 * The spec says exteriors are positive, but an encoder that got it backwards
 * is consistent about it, so the sign of the FIRST ring defines "exterior".
 */
export function polygons(rs) {
  const out = [];
  let outerSign = 0, cur = null;
  for (const ring of rs) {
    if (ring.length < 3) continue;
    const a = ringArea(ring);
    if (a === 0) continue;
    if (!outerSign) outerSign = Math.sign(a);
    if (Math.sign(a) === outerSign) { cur = { outer: ring, holes: [] }; out.push(cur); }
    else if (cur) cur.holes.push(ring);
  }
  return out;
}

/**
 * Sutherland–Hodgman against the square [0, ext]². Tiles carry a buffer of
 * geometry past their edge, so a building straddling a tile boundary arrives
 * twice, once in each tile. Clipping both copies at the shared edge leaves
 * two half-buildings that meet exactly, instead of two whole ones z-fighting.
 */
export function clipRing(ring, ext) {
  let pts = ring;
  const edges = [
    (p) => p[0] >= 0, (p) => p[0] <= ext, (p) => p[1] >= 0, (p) => p[1] <= ext,
  ];
  const cut = [
    (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (ext - a[0]) / (b[0] - a[0]); return [ext, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0]; },
    (a, b) => { const t = (ext - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), ext]; },
  ];
  for (let e = 0; e < 4 && pts.length; e++) {
    const inside = edges[e], next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      const ia = inside(a), ib = inside(b);
      if (ib) { if (!ia) next.push(cut[e](a, b)); next.push(b); }
      else if (ia) next.push(cut[e](a, b));
    }
    pts = next;
  }
  return pts;
}
