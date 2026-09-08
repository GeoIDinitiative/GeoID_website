#!/usr/bin/env python3
"""Every tropical cyclone track on record, as one line per storm.

IBTrACS v04r01 — the International Best Track Archive for Climate Stewardship,
NOAA NCEI — is the authoritative global record: every agency's best track,
reconciled into one file. Measured on the archive as published: **713,155
segments over 13,513 storms, 1842 to 2026**, and the endpoint answers
`Access-Control-Allow-Origin: *` at every size, so nothing here needs a key.

WHY IT IS BAKED RATHER THAN FETCHED LIVE, when the plate boundaries and the
GEM faults are not. Three things about the published shapefile make it unusable
as it comes, and every one of them is a wrong map rather than a slow one:

- **A FEATURE IS A THREE-HOUR SEGMENT, not a storm.** Hurricane Melissa is 92
  of them. Drawn raw, a click gives you three hours of one storm's life, the
  layer holds seven hundred thousand features where it wants thirteen
  thousand, and there is nothing to colour by a storm's own peak intensity
  because no feature knows it.
- **LONGITUDES RUN PAST 180.** The file's own extent is -179.9 to **183.3**,
  because a track crossing the antimeridian is continued rather than wrapped.
  `looksLikeGeographic` allows +/-180.5 for rounding, so 183.3 fails it and the
  layer is filed as NOT georeferenced — it lands in the local-models group and
  sits wherever the planet happens to have turned to. That is exactly the
  World Stress Map fault this tree already paid for, and it is silent.
- **A TRACK CROSSING THE SEAM IS ONE LINE ACROSS THE WHOLE MAP.** Wrapping
  alone is not enough: a storm at 179.9 followed by one at -179.9 draws a
  chord back across every meridian between them.

So the merge, the wrap and the split happen once, here, and what ships is a
layer the app can treat as ordinary.

NOTHING LARGE TOUCHES THE DISK. The published shapefile extracts to about
700 MB, and an intermediate GeoJSON of 713,155 segments is a few hundred more —
enough to fill a working drive, which is exactly what it did here. GDAL reads
the archive where it lies (`/vsizip//vsicurl/`) and writes its stream to
stdout, so the only thing this ever holds is the output.

    python3 GeoID_GIS/services/bake-cyclone-tracks.py

Writes `data/global/cyclone-tracks.geojson`, which is gitignored like every
other loose file there. `services/publish-data.py` puts it in the bucket and
records its fingerprint in `sources.json`, which is the part that ships.
"""

import json
import math
import pathlib
import subprocess
import sys

BASE = ("https://www.ncei.noaa.gov/data/"
        "international-best-track-archive-for-climate-stewardship-ibtracs/"
        "v04r01/access/shapefile")
ARCHIVE = "IBTrACS.ALL.list.v04r01.lines.zip"

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "global" / "cyclone-tracks.geojson"

# Three decimals is 110 m. IBTrACS reports position to 0.1 degrees — about
# 11 km — so this is already two orders finer than the source knows, and every
# further digit is bytes spent on precision nobody has.
PLACES = 3

# A jump wider than this between consecutive fixes is the antimeridian rather
# than a storm's motion. The fastest tropical cyclones translate at about
# 60 kt, which is 3 degrees of longitude in three hours at the equator and
# less further north; 180 is the seam and nothing else.
SEAM_JUMP = 180.0


def stream_segments():
    """Every segment, one JSON object per line, straight off the network.

    `/vsizip//vsicurl/` is GDAL reading the archive WHERE IT LIES: no download,
    no unpack, no intermediate. `GeoJSONSeq` to `/vsistdout/` then streams the
    features, so seven hundred thousand of them never have to be held at once
    and none of them is ever a file. Measured before relying on it — the
    endpoint answers byte ranges and GDAL opens the layer over them.
    """
    vsi = f"/vsizip//vsicurl/{BASE}/{ARCHIVE}/{ARCHIVE[:-4]}.shp"
    print("  streaming the archive (no local copy) ...")
    proc = subprocess.Popen(
        ["ogr2ogr", "-f", "GeoJSONSeq", "/vsistdout/", vsi, "-lco", "RS=NO"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1 << 20)
    for line in proc.stdout:
        line = line.strip().lstrip("\x1e")
        if line:
            yield json.loads(line)
    proc.stdout.close()
    if proc.wait() != 0:
        raise SystemExit(f"ogr2ogr failed: {proc.stderr.read()[:400]}")


def wrap(lon: float) -> float:
    """Onto [-180, 180], which is what every reader here means by longitude."""
    return ((lon + 180.0) % 360.0) - 180.0


def split_at_seam(points):
    """One track into the parts that do not cross the antimeridian.

    The jump is measured on the UNWRAPPED difference, because read off the
    wrapped values a step across the seam looks like 359 degrees of travel and
    the cut lands hundreds of degrees from where it belongs — the same trap
    `bake-stress.py` records for the stress bars.
    """
    parts = []
    run = []
    for point in points:
        if run and abs(point[0] - run[-1][0]) > SEAM_JUMP:
            if len(run) > 1:
                parts.append(run)
            run = []
        run.append(point)
    if len(run) > 1:
        parts.append(run)
    return parts


def title(name: str) -> str:
    """IBTrACS shouts its names, and a map is not shouting."""
    clean = (name or "").strip()
    if not clean or clean.upper() in {"NOT_NAMED", "UNNAMED", "NONAME"}:
        return ""
    return clean.title().replace("_", " ")


def main() -> int:
    storms = {}
    seen = 0
    for feature in stream_segments():
        props = feature.get("properties") or {}
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if geom.get("type") != "LineString" or len(coords) < 2:
            continue
        sid = props.get("SID")
        if not sid:
            continue
        seen += 1
        storm = storms.get(sid)
        if storm is None:
            storm = storms[sid] = {
                "name": title(props.get("NAME")),
                "season": props.get("SEASON"),
                "basin": props.get("BASIN") or "",
                "fixes": [],
                "wind": None,
                "pressure": None,
            }
        # Keyed by TIME, not by the order the file happens to be in: the
        # segments are a set, and a track drawn in file order is a scribble.
        stamp = props.get("ISO_TIME") or ""
        storm["fixes"].append((stamp, coords[0]))
        storm["fixes"].append((stamp, coords[-1]))
        wind = props.get("WMO_WIND")
        if isinstance(wind, (int, float)) and wind > 0:
            storm["wind"] = max(storm["wind"] or 0, int(wind))
        press = props.get("WMO_PRES")
        if isinstance(press, (int, float)) and press > 0:
            storm["pressure"] = min(storm["pressure"] or 10_000, int(press))

    print(f"  {seen:,} segments over {len(storms):,} storms")

    features = []
    dropped = 0
    split = 0
    for sid, storm in storms.items():
        fixes = sorted(storm["fixes"], key=lambda f: f[0])
        # A segment's end IS the next segment's start, so the raw list holds
        # every interior fix twice. Dropping the repeats halves the vertices
        # and changes nothing about the line.
        points = []
        for _, coord in fixes:
            lon = wrap(float(coord[0]))
            lat = float(coord[1])
            if not (math.isfinite(lon) and math.isfinite(lat)):
                continue
            spot = [round(lon, PLACES), round(lat, PLACES)]
            if points and points[-1] == spot:
                continue
            points.append(spot)
        parts = split_at_seam(points)
        if not parts:
            dropped += 1
            continue
        if len(parts) > 1:
            split += 1
        start = fixes[0][0][:10] if fixes else ""
        end = fixes[-1][0][:10] if fixes else ""
        props = {
            "sid": sid,
            "name": storm["name"],
            "season": storm["season"],
            "basin": storm["basin"],
            "start": start,
            "end": end,
            "peak_wind_kts": storm["wind"],
            "min_pressure_mb": storm["pressure"],
        }
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": ({"type": "LineString", "coordinates": parts[0]}
                         if len(parts) == 1
                         else {"type": "MultiLineString", "coordinates": parts}),
        })

    features.sort(key=lambda f: (f["properties"]["season"] or 0,
                                 f["properties"]["sid"]))
    payload = {
        "type": "FeatureCollection",
        "_source": {
            "dataset": "IBTrACS v04r01 — International Best Track Archive for "
                       "Climate Stewardship",
            "publisher": "NOAA National Centers for Environmental Information",
            "url": f"{BASE}/{ARCHIVE}",
            "citation": "Knapp, K. R., M. C. Kruk, D. H. Levinson, H. J. Diamond, "
                        "and C. J. Neumann (2010): The International Best Track "
                        "Archive for Climate Stewardship (IBTrACS). "
                        "Bull. Amer. Meteor. Soc., 91, 363-376.",
            "built_here": "One line per storm rather than per three-hour segment; "
                          "longitudes wrapped onto +/-180 and tracks split where "
                          "they cross the antimeridian; peak wind and minimum "
                          "pressure taken across each storm's own fixes.",
        },
        "features": features,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")))

    vertices = sum(len(p) for f in features
                   for p in ([f["geometry"]["coordinates"]]
                             if f["geometry"]["type"] == "LineString"
                             else f["geometry"]["coordinates"]))
    named = sum(1 for f in features if f["properties"]["name"])
    winds = sum(1 for f in features if f["properties"]["peak_wind_kts"])
    seasons = [f["properties"]["season"] for f in features
               if f["properties"]["season"]]
    print(f"\n  {len(features):,} storms, {vertices:,} vertices")
    print(f"  {named:,} named, {winds:,} with a peak wind")
    print(f"  seasons {min(seasons)}-{max(seasons)}")
    print(f"  {split:,} split at the antimeridian, {dropped:,} with no drawable track")
    print(f"  {OUT.stat().st_size / 1e6:.1f} MB -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
