#!/usr/bin/env python3
"""How often a tropical cyclone passes, as a map -- and one year at a time.

Built from IBTrACS v04r01 streamed where it lies, the same way
bake-cyclone-tracks.py reads it. Two products come out of one pass:

- cyclone-risk.geojson     the CLIMATOLOGY: a variable-resolution grid whose
                           cells carry the annual rate and probability
- cyclone-risk-years.json  a sparse count per cell PER SEASON, so the map can
                           follow the track animation year by year

WHAT THE NUMBER IS, because a hazard map that does not say is not one:

    For a point on the grid, the number of DISTINCT STORMS whose track passed
    within RADIUS_KM of it, divided by the number of COMPLETE seasons in the
    window. That is a rate in storms per year; the probability of at least one
    in a given year follows as 1 - exp(-rate), the Poisson form.

THREE THINGS THAT WOULD MAKE IT A WRONG MAP, and what is done about each:

1. VARIABLE CELL SIZE BREAKS A PER-CELL COUNT. "Storms in this cell" is not
   comparable between an 8-degree cell and a quarter-degree one: the big cell
   catches more storms by being big, so the map would be showing its own
   resolution rather than the hazard. So the quantity is measured AT A POINT
   within a FIXED radius, and a cell's size is only how finely the field is
   drawn there. The grid is a sampling lattice, fine where the field varies;
   it is not the measurement.

2. A CELL IS NOT A STORM. Counting track FIXES would weight a slow storm over
   a fast one and a well-observed storm over a sparse one. Each storm is
   counted ONCE per cell however many of its fixes fall inside.

3. AN INCOMPLETE SEASON DRAGS THE RATE DOWN. The archive's last season is in
   progress, so it is excluded from the climatology: dividing 46 seasons of
   storms by 47 years understates every cell. It is still emitted in the
   per-year file, because a year's own count is a count whether or not the
   year has finished.

AND WHAT A SINGLE YEAR IS NOT. One season cannot carry a probability -- a cell
either had a storm that year or did not -- so the per-year file holds COUNTS
and is named as counts everywhere it surfaces. The probability belongs to the
climatology; the year is an occurrence.

    python3 GeoID_GIS/services/bake-cyclone-risk.py

Publish both with services/publish-data.py.
"""

import json
import math
import pathlib
import subprocess
import sys
import time

import numpy as np

BASE = ("https://www.ncei.noaa.gov/data/"
        "international-best-track-archive-for-climate-stewardship-ibtracs/"
        "v04r01/access/shapefile")
ARCHIVE = "IBTrACS.ALL.list.v04r01.lines.zip"

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_GRID = ROOT / "data" / "global" / "cyclone-risk.geojson"
OUT_YEARS = ROOT / "data" / "global" / "cyclone-risk-years.json"

# The window. 1980 is where the record becomes globally consistent -- the
# satellites -- and everything before it is a record of where ships and coasts
# were, which is a map of observation rather than a climatology.
FIRST_SEASON = 1980

# 200 km is the distance over which a tropical cyclone's wind field is felt at
# strength, and the order the operational passage products use. It is stated on
# the layer because the number IS the definition: at 100 km the map is roughly
# half as red, and neither radius is more correct than the other.
RADIUS_KM = 200.0

# Hurricane force in knots -- SAFFIR_SIMPSON_KTS[0], the same threshold the
# live markers and the track colours use.
HURRICANE_KTS = 64

# The sampling lattice. A quarter degree is 27.8 km at the equator, so the
# 200 km disc is about fifteen cells across -- fine enough that the quadtree
# below has something to coarsen and cheap enough to hold in memory.
STEP = 0.25
NX = int(360 / STEP)
NY = int(180 / STEP)

# The coarsest and finest cells the quadtree may emit, in fine cells per side.
# 32 is 8 degrees, 1 is a quarter.
COARSEST = 32
FINEST = 1

# Subdivide while the spread of the rate inside a block exceeds this fraction
# of the global peak. Lower makes a finer map and a bigger file; zero is the
# full million-cell lattice.
SPREAD = 0.02

# Densify the track to this spacing before stamping. A storm's fixes are three
# hours apart, which at 30 knots is 165 km -- under the 400 km two 200 km discs
# need to touch, so the swath is usually continuous already. Usually is not
# always: an extratropical transition runs at twice that, and the gap would be
# a hole straight across the swath.
LEG_KM = 50.0

PLACES = 4


def stream_segments():
    """IBTrACS' own segments, read where the archive lies.

    Never staged to disk: the extracted shapefile is 700 MB and filled this
    machine once already.
    """
    vsi = "/vsizip//vsicurl/{}/{}/{}.shp".format(BASE, ARCHIVE, ARCHIVE[:-4])
    print("  streaming IBTrACS (no local copy) ...")
    proc = subprocess.Popen(
        ["ogr2ogr", "-f", "GeoJSONSeq", "/vsistdout/", vsi, "-lco", "RS=NO"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1 << 20)
    for line in proc.stdout:
        line = line.strip().lstrip("\x1e")
        if line:
            yield json.loads(line)
    proc.stdout.close()
    if proc.wait() != 0:
        raise SystemExit("ogr2ogr failed: " + proc.stderr.read()[:400])


def wrap(lon):
    return ((lon + 180.0) % 360.0) - 180.0


ROW_LAT = 90.0 - (np.arange(NY) + 0.5) * STEP
ROW_KM_PER_LON = np.maximum(111.32 * np.cos(np.radians(ROW_LAT)), 1e-6)
EARTH_R_KM = 6371.0


def build_discs():
    """The 200 km disc as a lookup, one entry per grid row.

    THE DISC IS IN KILOMETRES, NOT DEGREES, so its width in columns depends on
    the latitude: a fixed column count would be a 200 km disc at the equator, a
    100 km one at 60 degrees and a meaningless one near the pole.

    Precomputed per row rather than per fix because the shape only depends on
    the row -- three million fixes each solving the same 720 shapes is an hour
    of arithmetic to arrive at 720 answers.
    """
    span = int(math.ceil(RADIUS_KM / 111.32 / STEP)) + 1
    row_part, col_off = [], []
    for r in range(NY):
        lat = ROW_LAT[r]
        rows, cols = [], []
        for drow in range(-span, span + 1):
            r2 = r + drow
            if r2 < 0 or r2 >= NY:
                # Off the top or bottom of the world. A pole is an edge, not a
                # wrap: a disc there does not continue on the far side.
                continue
            # SOLVED ON THE SPHERE, not on a flat approximation. Inverting
            # the haversine for the longitude difference is closed form, and
            # the flat version is wrong exactly where a disc has most of its
            # cells: measured, a cell computed at 199 km along the diagonal is
            # 216 km of real ground, so the layer would claim a radius it does
            # not have. And a cell is in the disc when its CENTRE is within the
            # radius -- rounding OUTWARD instead adds up to a cell and a half of
            # reach (240 km at the equator) and inflates every rate on the map.
            lat2 = ROW_LAT[r2]
            hav_r = math.sin(0.5 * RADIUS_KM / EARTH_R_KM) ** 2
            hav_lat = math.sin(math.radians(lat2 - lat) / 2) ** 2
            room = hav_r - hav_lat
            if room < 0:
                continue
            denom = math.cos(math.radians(lat)) * math.cos(math.radians(lat2))
            if denom <= 0:
                # A row at the pole itself: every meridian is the same place.
                half = NX // 2
            else:
                s = math.sqrt(min(1.0, room / denom))
                dlon = math.degrees(2 * math.asin(s))
                half = min(NX // 2, int(math.floor(dlon / STEP)))
            offs = np.arange(-half, half + 1)
            cols.append(offs)
            rows.append(np.full(offs.size, r2, dtype=np.int64))
        row_part.append(np.concatenate(rows) * NX)
        col_off.append(np.concatenate(cols))
    return row_part, col_off


ROW_PART, COL_OFF = build_discs()


def stamp(points):
    """Every lattice cell within RADIUS_KM of any of these positions.

    Batched by grid row: the points sharing a row share a disc shape, so the
    whole row's worth is one broadcast instead of one loop iteration each.
    """
    if not points:
        return None
    lon = np.array([p[0] for p in points])
    lat = np.array([p[1] for p in points])
    good = np.isfinite(lon) & np.isfinite(lat) & (np.abs(lat) <= 90)
    lon, lat = lon[good], lat[good]
    if not lon.size:
        return None
    rows = np.clip(((90.0 - lat) / STEP).astype(np.int64), 0, NY - 1)
    cols = np.mod(((lon + 180.0) / STEP).astype(np.int64), NX)
    out = []
    for r in np.unique(rows):
        here = cols[rows == r]
        # The lattice wraps in longitude: a storm at 179 E is a neighbour of one
        # at 179 W, and a disc clipped at the seam would be a hole down the
        # antimeridian -- through the middle of the busiest basin there is.
        flat = ROW_PART[r][None, :] + np.mod(here[:, None] + COL_OFF[r][None, :], NX)
        out.append(flat.ravel())
    # ONCE PER STORM per cell, whatever number of its fixes landed inside.
    return np.unique(np.concatenate(out))


def densify(points):
    """Sample along each leg so consecutive discs overlap into a swath."""
    out = []
    for i, (lon, lat) in enumerate(points):
        out.append((lon, lat))
        if i + 1 >= len(points):
            break
        lon2, lat2 = points[i + 1]
        dlon = wrap(lon2 - lon)
        dx = dlon * 111.32 * math.cos(math.radians((lat + lat2) / 2))
        dy = (lat2 - lat) * 111.32
        legs = int(math.hypot(dx, dy) // LEG_KM)
        for k in range(1, legs):
            t = k / legs
            out.append((lon + dlon * t, lat + (lat2 - lat) * t))
    return out


def read_storms():
    """One record per storm: its season and its fixes in time order."""
    storms = {}
    for feature in stream_segments():
        props = feature.get("properties") or {}
        try:
            season = int(props.get("SEASON"))
        except (TypeError, ValueError):
            continue
        if season < FIRST_SEASON:
            continue
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if geom.get("type") != "LineString" or len(coords) < 2:
            continue
        sid = props.get("SID")
        if not sid:
            continue
        held = storms.get(sid)
        if held is None:
            held = storms[sid] = {"season": season, "fixes": []}
        wind = props.get("WMO_WIND")
        strong = isinstance(wind, (int, float)) and wind >= HURRICANE_KTS
        when = props.get("ISO_TIME") or ""
        # A segment carries its own start and end; keeping both and
        # de-duplicating by time reassembles the track without assuming the
        # segments arrive in order, which they do not.
        for c in (coords[0], coords[-1]):
            held["fixes"].append((when, wrap(float(c[0])), float(c[1]), strong))
    for storm in storms.values():
        seen, ordered = set(), []
        for fix in sorted(storm["fixes"], key=lambda f: f[0]):
            key = (fix[0], round(fix[1], 3), round(fix[2], 3))
            if key in seen:
                continue
            seen.add(key)
            ordered.append(fix)
        storm["fixes"] = ordered
    return storms


def main() -> int:
    began = time.time()
    storms = read_storms()
    seasons = sorted({s["season"] for s in storms.values()})
    # The archive's last season is in progress. A climatology divided by a year
    # that has not finished understates every cell in the map.
    partial = seasons[-1]
    complete = [y for y in seasons if y != partial]
    print("  {:,} storms over {} seasons ({}-{} complete, {} in progress)".format(
        len(storms), len(seasons), complete[0], complete[-1], partial))

    cells = NY * NX
    per_year = {y: np.zeros(cells, dtype=np.int16) for y in seasons}
    per_year_hur = {y: np.zeros(cells, dtype=np.int16) for y in seasons}

    for n, storm in enumerate(storms.values()):
        fixes = storm["fixes"]
        touched = stamp(densify([(f[1], f[2]) for f in fixes]))
        if touched is None:
            continue
        per_year[storm["season"]][touched] += 1
        # The hurricane swath is the part of the track at hurricane force, not
        # the whole track of a storm that reached it somewhere: a Category 5 in
        # the mid-Atlantic was a depression when it left Africa.
        strong = [(f[1], f[2]) for f in fixes if f[3]]
        if strong:
            hit = stamp(densify(strong))
            if hit is not None:
                per_year_hur[storm["season"]][hit] += 1
        if (n + 1) % 500 == 0:
            print("    {:,} / {:,}  ({:.0f}s)".format(
                n + 1, len(storms), time.time() - began))

    years = len(complete)
    counted = np.zeros(cells, dtype=np.int32)
    counted_hur = np.zeros(cells, dtype=np.int32)
    for y in complete:
        counted += per_year[y]
        counted_hur += per_year_hur[y]

    rate = (counted.astype(np.float64) / years).reshape(NY, NX)
    rate_hur = (counted_hur.astype(np.float64) / years).reshape(NY, NX)
    print("  peak {:.2f} storms/yr; {:,} of {:,} lattice points ever reached".format(
        rate.max(), int((rate > 0).sum()), cells))

    # -- the quadtree ------------------------------------------------------
    # A block stays whole while the field inside it is FLAT, so a coarse cell's
    # mean is representative of every point in it. Where the field varies -- a
    # coastline, a basin edge -- it splits until it is quarter-degree.
    limit = SPREAD * rate.max()
    blocks = []

    def flat(field, r0, c0, size):
        block = field[r0:r0 + size, c0:c0 + size]
        lo, hi = block.min(), block.max()
        # A BLOCK THAT IS EMPTY IN PART IS NOT FLAT, whatever its spread.
        #
        # This is the trap the whole design is against, reappearing at the
        # other end of the scale. A single lattice point can report no less
        # than one storm in the window -- 1/46, about 0.022 a year -- so a
        # coarse cell reporting 0.0003 is not a rate anywhere inside it: it is
        # one point's rate divided by the thousand points beside it that no
        # storm has ever reached. Measured before this gate: 177 cells of 2
        # degrees and up claiming rates down to "once every 3,623 years", and
        # 1,485 doing the same with the hurricane rate.
        #
        # The absolute spread test cannot catch it, and correctly so: 0.022
        # against a global peak of 6.17 is a third of a percent, genuinely
        # flat by any measure of the field. What is wrong is not the variation
        # but the MEAN -- it describes neither the ground a storm crossed nor
        # the ground it did not.
        if lo == 0 and hi > 0:
            return False
        return (hi - lo) <= limit

    def emit(r0, c0, size):
        # BOTH fields, because both are means over the same block and a cell
        # carries them side by side. Gating on the storm rate alone leaves the
        # hurricane rate diluted in exactly the same way, under a cell whose
        # other number is sound.
        if size > FINEST and not (flat(rate, r0, c0, size)
                                  and flat(rate_hur, r0, c0, size)):
            half = size // 2
            for dr in (0, half):
                for dc in (0, half):
                    emit(r0 + dr, c0 + dc, half)
            return
        blocks.append((r0, c0, size))

    for r0 in range(0, NY, COARSEST):
        for c0 in range(0, NX, COARSEST):
            emit(r0, c0, COARSEST)
    print("  {:,} cells after coarsening (lattice is {:,})".format(len(blocks), cells))

    # -- the features ------------------------------------------------------
    year_grid = {y: per_year[y].reshape(NY, NX) for y in seasons}
    features = []
    year_rows = {str(y): {} for y in seasons}
    for r0, c0, size in blocks:
        mean = float(rate[r0:r0 + size, c0:c0 + size].mean())
        if mean <= 0:
            # Nothing has ever passed here. That is most of the planet, and an
            # empty polygon is bytes spent drawing nothing.
            continue
        hur = float(rate_hur[r0:r0 + size, c0:c0 + size].mean())
        north = 90.0 - r0 * STEP
        south = north - size * STEP
        west = -180.0 + c0 * STEP
        east = west + size * STEP
        index = len(features)
        features.append({
            "type": "Feature",
            "properties": {
                "i": index,
                "deg": round(size * STEP, 4),
                "rate_yr": round(mean, PLACES),
                "p_yr": round(1.0 - math.exp(-mean), PLACES),
                "rate_hur_yr": round(hur, PLACES),
                "p_hur_yr": round(1.0 - math.exp(-hur), PLACES),
                "years_per": round(1.0 / mean, 1),
            },
            "geometry": {"type": "Polygon", "coordinates": [[
                [round(west, 4), round(south, 4)], [round(east, 4), round(south, 4)],
                [round(east, 4), round(north, 4)], [round(west, 4), round(north, 4)],
                [round(west, 4), round(south, 4)],
            ]]},
        })
        for y in seasons:
            v = float(year_grid[y][r0:r0 + size, c0:c0 + size].mean())
            if v > 0:
                year_rows[str(y)][index] = round(v, 2)

    window = ("Distinct storms passing within {:.0f} km of a point, per year, "
              "over the {} complete seasons {}-{}.".format(
                  RADIUS_KM, years, complete[0], complete[-1]))
    grid = {
        "type": "FeatureCollection",
        "_source": {
            "dataset": "IBTrACS v04r01 - International Best Track Archive for "
                       "Climate Stewardship",
            "publisher": "NOAA National Centers for Environmental Information",
            "citation": "Knapp, K. R., M. C. Kruk, D. H. Levinson, H. J. Diamond, "
                        "and C. J. Neumann (2010). Bull. Amer. Meteor. Soc., 91, "
                        "363-376.",
            "measure": window + " p_yr is 1 - exp(-rate): the chance of at least "
                       "one in a year, on the Poisson assumption that storms "
                       "arrive independently.",
            "radius_km": RADIUS_KM,
            "seasons": years,
            "from": complete[0],
            "to": complete[-1],
            "hurricane_kts": HURRICANE_KTS,
            "resolution": "variable, {} to {} degrees; a cell subdivides while "
                          "the rate inside it varies by more than {:.0%} of the "
                          "global peak. Cell size is display resolution only - "
                          "the value is measured at a point, so it is comparable "
                          "between a large cell and a small one.".format(
                              FINEST * STEP, COARSEST * STEP, SPREAD),
            "built_here": "Counted once per storm per cell; cells no storm has "
                          "ever reached are omitted.",
        },
        "features": features,
    }
    OUT_GRID.parent.mkdir(parents=True, exist_ok=True)
    OUT_GRID.write_text(json.dumps(grid, separators=(",", ":")))
    OUT_YEARS.write_text(json.dumps({
        "_source": {
            "measure": "Distinct storms within {:.0f} km of a cell in that season "
                       "- a COUNT, not a probability: a single season cannot "
                       "carry one. Keyed by the cell's index in "
                       "cyclone-risk.geojson.".format(RADIUS_KM),
            "radius_km": RADIUS_KM,
            "from": seasons[0],
            "to": seasons[-1],
            "partial": partial,
        },
        "years": year_rows,
    }, separators=(",", ":")))

    print("\n  {:,} cells drawn in {:.0f}s".format(len(features), time.time() - began))
    print("  {:.1f} MB -> {}".format(
        OUT_GRID.stat().st_size / 1e6, OUT_GRID.relative_to(ROOT)))
    print("  {:.1f} MB -> {}".format(
        OUT_YEARS.stat().st_size / 1e6, OUT_YEARS.relative_to(ROOT)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
