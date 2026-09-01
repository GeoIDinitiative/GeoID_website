#!/usr/bin/env python3
"""How much ice is in each glacier complex, and what it would raise the sea by.

    python3 GeoID_GIS/services/bake-ice-thickness.py   # writes data/global/ice/thickness.json

An outline says where the ice is; it says nothing about how much there is. The
card could say "597 km2" about Myrdalsjokull and nothing about the 100-odd
cubic kilometres of ice in it, which is the number a reader actually wants and
the one every downstream question needs — melt, runoff, sea level.

THE SOURCE. **IceBoost v2.0**, Maffezzoli (2026), a deep-learning ensemble
trained on the GlaThiDa measurements — published per RGI 7.0 GLACIER COMPLEX,
which is the very key this site's tiles carry, and under CC BY 4.0:

    Maffezzoli, N. (2026). IceBoost v2.0 Regional Glacier-Complex Products for
    RGI v7.0. Zenodo. https://doi.org/10.5281/zenodo.21220985   (CC BY 4.0)

The rasters are 1.4 GB; the compiled per-complex table is 26 MB and is what is
read here. Why not Farinotti et al. (2019), the older consensus estimate: it is
keyed to RGI **6.0** glaciers, so it would need a 6-to-7 link table AND a sum
from glaciers up to complexes, and it ships only as ~100 GB of rasters.

MEASURED ON THE TABLE, and each of these is a check on the join rather than a
statistic for its own sake:

- **192,869 rows, one per complex** — the same count as the tiles, so nothing
  is unmatched.
- **706,744 km2** of glacier area, identical to the inventory's own total.
- **149,318 km3** of ice, against Farinotti's consensus of about 158,000 —
  the same quantity from a different method.
- **343 mm of sea-level equivalent**, against a published ~324 mm for the
  world's glaciers. Close enough to believe the join; far enough apart to be
  worth quoting the source rather than the number.

WHAT IS WRITTEN. `data/global/ice/thickness.json`, keyed like `names.json` by
the complex id without its constant prefix:

    "06-00201": [volume km3, uncertainty km3, volume below sea level km3]

Rounded to three significant figures — the published uncertainty runs to tens
of percent, so a fourth digit is noise with a size in megabytes.
The below-sea-level part is carried because it is what a sea-level number must
subtract: ice already below the waterline is already displacing its own volume.
"""

from __future__ import annotations

import csv
import json
import pathlib
import shutil
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORK = ROOT / ".glacier-bake"
OUT = ROOT / "data" / "global" / "ice" / "thickness.json"

TABLE = ("https://cluster.klima.uni-bremen.de/~oggm/ice_thickness/iceboost_v2/"
         "iceboostv2_compiled_rgi70C_v20260705.csv")

#: Ice to water, and water to sea level. 1 km3 of water over the 361.8 million
#: km2 of ocean is 1/361.8 of a millimetre.
ICE_TO_WATER = 0.917
KM3_PER_MM = 361.8


def sig(value: float, digits: int = 3) -> float:
    """Three significant figures, which is one more than the model supports.

    The published uncertainty on these volumes runs to tens of percent, so a
    fourth digit is noise that costs 0.4 MB across 192,869 rows (5.9 against
    5.5, and 1.6 against 1.3 over the wire).
    """
    if not value:
        return 0
    from math import floor, log10
    power = digits - int(floor(log10(abs(value)))) - 1
    return round(round(value, power), max(0, power))


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    source = WORK / "raw" / "iceboost-rgi70C.csv"
    if not source.exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        print(f"  fetching {TABLE.rsplit('/', 1)[-1]} …", flush=True)
        with urllib.request.urlopen(TABLE, timeout=1800) as answer, source.open("wb") as out:
            shutil.copyfileobj(answer, out)

    table = {}
    volume = below = area = 0.0
    with source.open(newline="") as fh:
        for row in csv.DictReader(fh):
            rgi_id = (row.get("") or row.get("rgi_id") or "").strip()
            if not rgi_id.startswith("RGI2000-v7.0-C-"):
                continue
            vol = float(row["vol_km3"] or 0)
            err = float(row["vol_err_km3"] or 0)
            bsl = float(row["vol_bsl_km3"] or 0)
            volume += vol
            below += bsl
            area += float(row["area_km2"] or 0)
            entry = [sig(vol), sig(err)]
            # Below sea level is zero for all but the tidewater glaciers, and a
            # zero on 190,000 rows is 190,000 bytes saying nothing.
            if bsl:
                entry.append(sig(bsl))
            table[rgi_id.replace("RGI2000-v7.0-C-", "")] = entry

    if not table:
        sys.exit("no rows read — has the compiled table changed shape?")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(table, separators=(",", ":")))
    sle = (volume - below) * ICE_TO_WATER / KM3_PER_MM
    print(f"{len(table):,} complexes | {volume:,.0f} km3 of ice "
          f"({below:,.0f} below sea level) over {area:,.0f} km2")
    print(f"  sea-level equivalent {sle:,.0f} mm  (published: about 324 mm)")
    print(f"  -> {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
