/**
 * Mapbox Vector Tiles, decoded to GeoJSON.
 *
 * Global geology is the reason this exists. There is no global geological map
 * you can download as one shapefile and put on a globe — the open compilations
 * are hundreds of megabytes, and the one that is genuinely global and current
 * (Macrostrat's Burwell) is published as vector tiles. A tile is the map at the
 * resolution the view deserves: 713 KB for the whole world, 2 KB for a valley.
 *
 * So this is the reader, not a library: no protobuf runtime, no vector-tile
 * package, about two hundred lines against a format that is a decade stable.
 * It returns ordinary GeoJSON, which is what the rest of this app already
 * knows how to draw, colour, click, clip, sample and export — the decoder is
 * the ONLY new idea, and everything downstream of it is unchanged.
 *
 * Format: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */

/** A protobuf varint. Values here are tile coordinates and small ids. */
function varint(bytes, at) {
  let value = 0;
  let shift = 1;
  let i = at;
  for (;;) {
    const byte = bytes[i];
    i += 1;
    // Multiply rather than shift: `<<` is 32-bit in JS and a 64-bit field id
    // would silently wrap. Nothing in a tile is that big, and a decoder that
    // is quietly wrong on one field is worse than one that is slow.
    value += (byte & 0x7f) * shift;
    if (!(byte & 0x80)) return [value, i];
    shift *= 128;
    if (i >= bytes.length) throw new Error("truncated varint");
  }
}

/** Protobuf zigzag: how the spec stores a signed delta. */
const zigzag = (n) => (n >> 1) ^ -(n & 1);

/**
 * Walk one protobuf message, yielding [fieldNumber, wireType, value].
 *
 * Length-delimited fields come back as a subarray — a view, not a copy, so
 * nesting costs nothing.
 */
function* fields(bytes, start = 0, end = bytes.length) {
  let i = start;
  while (i < end) {
    let key;
    [key, i] = varint(bytes, i);
    const tag = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      let value;
      [value, i] = varint(bytes, i);
      yield [tag, wire, value];
    } else if (wire === 1) {
      yield [tag, wire, bytes.subarray(i, i + 8)];
      i += 8;
    } else if (wire === 2) {
      let length;
      [length, i] = varint(bytes, i);
      yield [tag, wire, bytes.subarray(i, i + length)];
      i += length;
    } else if (wire === 5) {
      yield [tag, wire, bytes.subarray(i, i + 4)];
      i += 4;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
}

const TEXT = typeof TextDecoder === "undefined" ? null : new TextDecoder();
function text(bytes) {
  if (TEXT) return TEXT.decode(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(out));
}

/** One entry of a layer's value pool: whichever of the seven types is set. */
function decodeValue(bytes) {
  for (const [tag, , value] of fields(bytes)) {
    if (tag === 1) return text(value);
    if (tag === 2) return new DataView(value.buffer, value.byteOffset, 4).getFloat32(0, true);
    if (tag === 3) return new DataView(value.buffer, value.byteOffset, 8).getFloat64(0, true);
    if (tag === 4 || tag === 5) return value; // int64 / uint64, already a number
    if (tag === 6) return zigzag(value);
    if (tag === 7) return Boolean(value);
  }
  return null;
}

/**
 * Geometry commands into rings of tile coordinates.
 *
 * MoveTo starts a ring, LineTo extends it, ClosePath ends it — all as deltas
 * from a cursor that persists across commands, which is what makes a tile
 * small and a naive reader wrong.
 */
function decodeGeometry(bytes) {
  const rings = [];
  let ring = [];
  let x = 0;
  let y = 0;
  let i = 0;
  while (i < bytes.length) {
    let header;
    [header, i] = varint(bytes, i);
    const command = header & 7;
    const count = header >>> 3;
    if (command === 1 || command === 2) {
      for (let n = 0; n < count; n += 1) {
        let dx; let dy;
        [dx, i] = varint(bytes, i);
        [dy, i] = varint(bytes, i);
        x += zigzag(dx);
        y += zigzag(dy);
        if (command === 1) {
          if (ring.length) rings.push(ring);
          ring = [];
        }
        ring.push([x, y]);
      }
    } else if (command === 7) {
      if (ring.length) {
        rings.push(ring);
        ring = [];
      }
    } else {
      throw new Error(`unsupported geometry command ${command}`);
    }
  }
  if (ring.length) rings.push(ring);
  return rings;
}

/** Signed area in TILE space, whose y runs downward. Only the sign is used. */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

/** Even-odd crossing test, used to put a hole in the ring that holds it. */
function pointInRing(point, ring) {
  if (!point || !ring || ring.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Tile coordinate -> [lon, lat].
 *
 * Web Mercator, and the same inverse the tile drape uses. Coordinates outside
 * `0..extent` are normal: a tile carries a buffer of its neighbours' geometry
 * so a polygon is not cut off at the seam, and those points are still real
 * places.
 */
function projector(z, x, y, extent) {
  const scale = 2 ** z;
  return ([px, py]) => {
    const lon = ((x + px / extent) / scale) * 360 - 180;
    const n = Math.PI * (1 - (2 * (y + py / extent)) / scale);
    const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
    return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
  };
}

function toGeoJSON(gtype, rings, project) {
  if (gtype === 1) {
    const points = rings.flat().map(project);
    return points.length === 1
      ? { type: "Point", coordinates: points[0] }
      : { type: "MultiPoint", coordinates: points };
  }
  if (gtype === 2) {
    const lines = rings.map((r) => r.map(project));
    return lines.length === 1
      ? { type: "LineString", coordinates: lines[0] }
      : { type: "MultiLineString", coordinates: lines };
  }
  if (gtype === 3) {
    /**
     * Rings are grouped by CONTAINMENT, not by the order they arrive in.
     *
     * The spec says a polygon's rings come as exterior-then-its-holes, and
     * mostly they do — but measured on the real tiles, 1-2% of holes are not
     * inside the ring that order would give them (2 of 301 in one zoom-1 tile,
     * 1 of 169 at zoom 4). Ear clipping then bridges the outer ring to a hole
     * lying somewhere else entirely, and the bridge is a triangle stretching
     * between the two: the bright slivers shooting out across the ocean,
     * reported as "rogue elements, sharp polygons".
     *
     * Winding still decides which rings are candidates to be holes, because
     * the encoder does mean something by it. Containment decides where each
     * one goes: the SMALLEST ring that actually contains it, and a ring inside
     * nothing becomes its own polygon rather than a hole in something it does
     * not touch.
     */
    const areas = rings.map(signedArea);
    const outerSign = Math.sign(areas.find((a) => a !== 0) || 1);
    const closeRing = (points) => {
      // A ring must be closed for GeoJSON; ClosePath leaves it implicit.
      const first = points[0];
      const last = points[points.length - 1];
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
        points.push([first[0], first[1]]);
      }
      return points;
    };
    const outers = [];
    const holes = [];
    rings.forEach((ring, i) => {
      const entry = { ring: closeRing(ring.map(project)), area: Math.abs(areas[i]) };
      if (Math.sign(areas[i]) === outerSign || !outers.length) outers.push(entry);
      else holes.push(entry);
    });
    const polygons = outers.map((outer) => [outer.ring]);
    holes.forEach((hole) => {
      let best = -1;
      let bestArea = Infinity;
      outers.forEach((outer, i) => {
        if (outer.area < bestArea && pointInRing(hole.ring[0], outer.ring)) {
          best = i;
          bestArea = outer.area;
        }
      });
      if (best >= 0) polygons[best].push(hole.ring);
      else polygons.push([hole.ring]);
    });
    return polygons.length === 1
      ? { type: "Polygon", coordinates: polygons[0] }
      : { type: "MultiPolygon", coordinates: polygons };
  }
  return null;
}

/**
 * Decode one tile.
 *
 * `only` limits which named layers are read — a Macrostrat tile carries both
 * `units` and `lines`, and decoding the one you did not ask for is most of the
 * work for none of the result.
 */
export function decodeTile(buffer, { z, x, y, only = null } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const out = {};
  for (const [tag, , layerBytes] of fields(bytes)) {
    if (tag !== 3) continue;
    let name = null;
    let extent = 4096;
    const keys = [];
    const values = [];
    const featureBytes = [];
    for (const [t, , v] of fields(layerBytes)) {
      if (t === 1) name = text(v);
      else if (t === 2) featureBytes.push(v);
      else if (t === 3) keys.push(text(v));
      else if (t === 4) values.push(decodeValue(v));
      else if (t === 5) extent = v;
    }
    if (!name || (only && !only.includes(name))) continue;
    const project = projector(z, x, y, extent);
    out[name] = featureBytes.map((fb) => {
      const properties = {};
      let geometry = null;
      let gtype = 0;
      let id = null;
      for (const [t, , v] of fields(fb)) {
        if (t === 1) id = v;
        else if (t === 2) {
          const pairs = [];
          let i = 0;
          while (i < v.length) {
            let n;
            [n, i] = varint(v, i);
            pairs.push(n);
          }
          for (let j = 0; j + 1 < pairs.length; j += 2) {
            properties[keys[pairs[j]]] = values[pairs[j + 1]];
          }
        } else if (t === 3) gtype = v;
        else if (t === 4) geometry = decodeGeometry(v);
      }
      return {
        type: "Feature",
        id,
        properties,
        geometry: geometry ? toGeoJSON(gtype, geometry, project) : null,
      };
    }).filter((f) => f.geometry);
  }
  return out;
}

/** Which XYZ tiles cover a lon/lat box at one zoom. */
/**
 * The zoom a BOX deserves, when there is no camera to ask.
 *
 * EPSG:4326 is 2x1 at zoom 0, so a tile spans 360/2^(z+1) degrees; the level
 * where a box covers about two tiles across is log2(720/W) - 1.
 *
 * It exists because the alternative was a NULL, and a null reaching
 * `Math.round` is ZERO — which asked for the single world tile: 5,792 units
 * for the whole planet, generalised so hard that point-in-polygon finds
 * nothing under Northern Ireland. An extraction over a study area came back
 * with three units, all of them things like "Precambrian-Phanerozoic
 * crystalline metamorphic rocks". Ask for a zoom by name or compute one; do
 * not let a missing one mean the coarsest possible answer.
 */
export function zoomForBounds({ west, east } = {}, { maxZoom = 12 } = {}) {
  const width = Math.abs(Number(east) - Number(west));
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.max(0, Math.min(maxZoom, Math.round(Math.log2(720 / width) - 1)));
}

export function tilesForBounds({ west, south, east, north }, z) {
  const scale = 2 ** z;
  const xOf = (lon) => Math.floor(((lon + 180) / 360) * scale);
  const yOf = (lat) => {
    const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
    const rad = (clamped * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale);
  };
  const x0 = Math.max(0, Math.min(scale - 1, xOf(west)));
  const x1 = Math.max(0, Math.min(scale - 1, xOf(east)));
  const y0 = Math.max(0, Math.min(scale - 1, yOf(north)));
  const y1 = Math.max(0, Math.min(scale - 1, yOf(south)));
  const tiles = [];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) tiles.push({ z, x, y });
  }
  return tiles;
}
