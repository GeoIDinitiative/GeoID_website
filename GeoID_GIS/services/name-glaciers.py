#!/usr/bin/env python3
"""Give the glacier complexes their own names.

    python3 GeoID_GIS/services/name-glaciers.py        # writes data/global/ice/names.json

WHY THIS EXISTS. RGI's glacier COMPLEXES carry no name — a complex is an id, a
region and an area — so a click on the biggest ice cap in Europe read "Glacier
complex, Iceland". The names exist; they are in three other places, and the
whole job is deciding which one is honestly the name of THIS ice mass.

THE RULES, in the order they are applied. Each is stricter than the next, and
the point of the order is that an OUTLET'S NAME IS NOT THE ICE CAP'S NAME:

1. **RGI's own, where the complex IS a glacier.** RGI names 57,996 of its
   274,531 glaciers, and the `CtoG_links.json` shipped with every region says
   which glaciers make up each complex. Where a complex is ONE glacier, that
   glacier's name is the complex's name — 35,017 of them. Where it is many
   glaciers that all carry ONE name covering more than 80% of the area, the
   same holds: 2,202 more.

2. **A gazetteer ICE CAP inside it.** Vatnajökull is 99 glaciers in RGI and
   nine of them are named — Skeiðarárjökull, Brúarjökull, and so on, every one
   an outlet. Taking the largest would name the whole ice cap after one of its
   tongues, which is wrong in the way that is hardest to notice. GeoNames files
   an ice cap as `H.CAPG` — 61 of them worldwide — and where one falls inside a
   complex, that is the ice mass's own name. Ties go to the point nearest the
   centroid.

3. **A single gazetteer GLACIER inside it.** `H.GLCR`, 8,291 points. Only where
   exactly ONE falls inside the complex, because two points inside one polygon
   is the outlet problem again.

Anything else keeps no name, and the card says where it is instead ("Glacier
complex, Iceland"). Measured: **38,016 of 192,869 complexes named (19.7%)** —
37,219 from RGI, 797 from the gazetteer.

WHAT IS WRITTEN: `data/global/ice/names.json`, 1.25 MB, `{ "06-00201":
["Mýrdalsjökull", "GeoNames"] }` — keyed by the id without its constant
`RGI2000-v7.0-C-` prefix, which is 14 bytes on every one of forty thousand
entries and says nothing. The SOURCE rides with the name because the card says
it: a name from RGI is that glacier's own, a name from GeoNames is a match by
POSITION and a reader should be told which they are looking at.

NOT baked into the tiles. A name is 20 bytes on a feature that already costs a
kilobyte of geometry, so it could have gone in — and then every correction to a
name would mean re-baking an 82 MB pyramid.

Sources and licences:
  - RGI 7.0 glacier attributes (RGI Consortium 2023, NSIDC, CC BY 4.0)
  - GeoNames (CC BY 4.0) — https://www.geonames.org/

Needs `shapely` for the point-in-polygon, and the RGI region folders that
`bake-glaciers.py` has already downloaded.
"""

from __future__ import annotations

import csv
import json
import pathlib
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORK = ROOT / ".glacier-bake"
OUT = ROOT / "data" / "global" / "ice" / "names.json"

RGI_ATTRIBUTES = ("https://cluster.klima.uni-bremen.de/~oggm/rgi/"
                  "RGI2000-v7.0-G-global-attributes.csv")
GEONAMES = "https://download.geonames.org/export/dump/allCountries.zip"

#: A complex of many glaciers takes their shared name only when the named ones
#: are nearly all of it. Below that the name describes a part, not the whole.
UNANIMOUS_SHARE = 0.8


def fetch(url: str, dest: pathlib.Path) -> pathlib.Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  fetching {url.rsplit('/', 1)[-1]} …", flush=True)
    with urllib.request.urlopen(url, timeout=3600) as answer, dest.open("wb") as out:
        shutil.copyfileobj(answer, out)
    return dest


def rgi_names(raw: pathlib.Path, src: pathlib.Path) -> dict:
    """Rule 1: the complexes that ARE a named glacier."""
    csv.field_size_limit(10 ** 7)
    names, areas = {}, {}
    with fetch(RGI_ATTRIBUTES, raw / "G-global-attributes.csv").open(newline="") as fh:
        for row in csv.DictReader(fh):
            name = (row["glac_name"] or "").strip()
            if name:
                names[row["rgi_id"]] = name
            areas[row["rgi_id"]] = float(row["area_km2"] or 0)

    out = {}
    links = sorted(src.glob("RGI2000-v7.0-C-*/*-CtoG_links.json"))
    if not links:
        sys.exit(f"no RGI region folders under {src} — run bake-glaciers.py first")
    for path in links:
        for complex_id, glaciers in json.loads(path.read_text()).items():
            found = {names[g] for g in glaciers if g in names}
            if not found:
                continue
            key = complex_id.replace("RGI2000-v7.0-C-", "")
            if len(glaciers) == 1:
                out[key] = [next(iter(found)), "RGI"]
                continue
            named = sum(areas.get(g, 0) for g in glaciers if g in names)
            whole = sum(areas.get(g, 0) for g in glaciers) or 1
            if len(found) == 1 and named / whole > UNANIMOUS_SHARE:
                out[key] = [next(iter(found)), "RGI"]
    print(f"  {len(out):,} complexes named from RGI itself", flush=True)
    return out


def gazetteer(raw: pathlib.Path) -> list:
    """Every ice cap and glacier GeoNames knows, as (name, lon, lat, code)."""
    table = raw / "ice-gazetteer.tsv"
    if not table.exists():
        dump = raw / "allCountries.txt"
        if not dump.exists():
            with zipfile.ZipFile(fetch(GEONAMES, raw / "geonames.zip")) as bundle:
                bundle.extract("allCountries.txt", raw)
        with dump.open(encoding="utf-8") as fh, table.open("w", encoding="utf-8") as out:
            for line in fh:
                cols = line.split("\t")
                # H.GLCR is a glacier; H.CAPG is an ice cap, and there are only
                # 61 of those in the world — they are what names an ice mass.
                if len(cols) > 8 and cols[6] == "H" and cols[7] in ("GLCR", "CAPG"):
                    out.write(f"{cols[1]}\t{cols[4]}\t{cols[5]}\t{cols[7]}\n")
    rows = []
    with table.open(newline="", encoding="utf-8") as fh:
        for row in csv.reader(fh, delimiter="\t"):
            if len(row) >= 4:
                rows.append((row[0], float(row[2]), float(row[1]), row[3]))
    caps = sum(1 for r in rows if r[3] == "CAPG")
    print(f"  gazetteer: {len(rows):,} points, {caps} of them ice caps", flush=True)
    return rows


def main() -> None:
    try:
        from shapely.geometry import Point, shape
        from shapely.strtree import STRtree
    except ImportError:
        sys.exit("this needs shapely: python3 -m pip install shapely")

    WORK.mkdir(parents=True, exist_ok=True)
    raw, src = WORK / "raw", WORK / "src"
    named = rgi_names(raw, src)
    rows = gazetteer(raw)
    points = [Point(lon, lat) for _, lon, lat, _ in rows]
    tree = STRtree(points)

    gpkg = WORK / "ice.gpkg"
    if not gpkg.exists():
        sys.exit(f"no {gpkg} — run bake-glaciers.py first")
    proc = subprocess.Popen(
        ["ogr2ogr", "-f", "GeoJSONSeq", "/vsistdout/", str(gpkg), "ice",
         "-where", "kind = 'Glacier or ice cap'", "-lco", "RS=NO"],
        stdout=subprocess.PIPE, text=True, bufsize=1)

    seen = from_cap = from_one = 0
    for line in proc.stdout:
        line = line.strip().lstrip("\x1e")
        if not line:
            continue
        feature = json.loads(line)
        seen += 1
        key = (feature["properties"].get("rgi_id") or "").replace("RGI2000-v7.0-C-", "")
        if not key or key in named:
            continue
        geom = shape(feature["geometry"])
        inside = [i for i in tree.query(geom) if geom.contains(points[i])]
        if not inside:
            continue
        caps = [i for i in inside if rows[i][3] == "CAPG"]
        if caps:
            middle = geom.centroid
            best = min(caps, key=lambda i: points[i].distance(middle))
            named[key] = [rows[best][0], "GeoNames"]
            from_cap += 1
        elif len(inside) == 1:
            named[key] = [rows[inside[0]][0], "GeoNames"]
            from_one += 1
        if seen % 25000 == 0:
            print(f"  {seen:,} complexes…", flush=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(named))
    print(f"{len(named):,} of {seen:,} complexes named ({len(named) / seen * 100:.1f}%) "
          f"— {from_cap} ice caps and {from_one} single glaciers from the gazetteer")
    print(f"  -> {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
