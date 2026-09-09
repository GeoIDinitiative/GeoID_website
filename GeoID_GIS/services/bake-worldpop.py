#!/usr/bin/env python3
"""WorldPop's 2020 global 1 km population mosaic, rewritten as a Cloud-Optimised
GeoTIFF for the page to read by window -- the soil-thickness sheet's recipe.

    data/global/.worldpop-work/ppp_2020_1km_Aggregated.tif   (870 MB, from
        https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/0_Mosaicked/)
    -> data/global/worldpop/ppp_2020_1km.hotlink-ok.tif        (Float32, DEFLATE,
        predictor 3, 512 blocks, average overviews)

The source stores POPULATION COUNT per cell; a 30-arcsecond cell is a
kilometre or so across, and the card converts with the cell's true area.
`.hotlink-ok.` is Cloudflare's own exemption from Hotlink Protection, which
403s an image by Referer from any origin but the zone. The grid size and
bounds are written into meta.json FROM THE FILE, never typed.

Written through GDAL's CLI with its cache capped: the Python bindings
segfault on this machine, and an uncapped warp of an 870 MB raster is how a
machine goes down.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORK = ROOT / "data" / "global" / ".worldpop-work"
SRC = WORK / "ppp_2020_1km_Aggregated.tif"
OUT = ROOT / "data" / "global" / "worldpop" / "ppp_2020_1km.hotlink-ok.tif"
META = ROOT / "data" / "global" / "worldpop" / "meta.json"


def main() -> int:
    if not SRC.is_file():
        print(f"missing {SRC}", file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["gdalwarp", "-overwrite", "-of", "COG", "-ot", "Float32", "-t_srs", "EPSG:4326",
         "-co", "COMPRESS=DEFLATE", "-co", "PREDICTOR=3", "-co", "BLOCKSIZE=512",
         "-co", "RESAMPLING=AVERAGE", "-co", "OVERVIEW_RESAMPLING=AVERAGE", "-co", "NUM_THREADS=2",
         "--config", "GDAL_CACHEMAX", "512", "--config", "GDAL_NUM_THREADS", "2",
         str(SRC), str(OUT)],
        check=True)
    info = subprocess.run(["gdalinfo", "-json", str(OUT)], capture_output=True, text=True, check=True).stdout
    g = json.loads(info)
    w, h = g["size"]
    cc = g["cornerCoordinates"]
    nodata = g["bands"][0].get("noDataValue")
    meta = json.loads(META.read_text())
    meta["grid"] = [w, h]
    meta["bounds"] = {"west": round(cc["upperLeft"][0], 6), "east": round(cc["lowerRight"][0], 6),
                      "south": round(cc["lowerRight"][1], 6), "north": round(cc["upperLeft"][1], 6)}
    if nodata is not None:
        meta["noData"] = nodata
    META.write_text(json.dumps(meta, indent=2) + "\n")
    print("wrote {} ({:.0f} MB): {}x{}, bounds {}, nodata {}".format(
        OUT.relative_to(ROOT), OUT.stat().st_size / 1e6, w, h, meta["bounds"], nodata))
    return 0


if __name__ == "__main__":
    sys.exit(main())
