#!/usr/bin/env python3
"""
Rasterize GeoUnits.shp → equirectangular PNG for Moon viewer geology layer.
Colors each polygon by FIRST_Un_2 (feature type) not unit code.
Output: geology_4k.png (4096×2048, RGBA)
"""

import os, sys
import numpy as np

try:
    from osgeo import gdal, ogr
except ImportError:
    sys.exit("ERROR: GDAL Python bindings not found.")

try:
    from PIL import Image
except ImportError:
    sys.exit("ERROR: Pillow not found.")

from un2_colors import UN2_COLORS_RGB, DEFAULT_RGB

SHP = os.path.join(os.path.dirname(__file__),
    "Unified_Geologic_Map_of_the_Moon_GIS_v2/"
    "Unified_Geologic_Map_of_the_Moon_GIS/"
    "Lunar_GIS/Shapefiles/GeoUnits.shp")
OUT = os.path.join(os.path.dirname(__file__), "geology_4k.png")

OUT_W, OUT_H = 4096, 2048

def main():
    ds = ogr.Open(SHP)
    if ds is None:
        sys.exit(f"Cannot open {SHP}")
    layer = ds.GetLayer(0)

    ext = layer.GetExtent()
    minx, maxx, miny, maxy = ext[0], ext[1], ext[2], ext[3]
    print(f"Shapefile extent: X [{minx:.0f}, {maxx:.0f}]  Y [{miny:.0f}, {maxy:.0f}]")
    print(f"Features: {layer.GetFeatureCount()}")

    # Build integer ID → FIRST_Un_2 value mapping
    un2_values = sorted(UN2_COLORS_RGB.keys())
    un2_to_id  = {v: i + 1 for i, v in enumerate(un2_values)}
    default_id = len(un2_values) + 1

    # Create in-memory raster
    mem_driver = gdal.GetDriverByName("MEM")
    raster = mem_driver.Create("", OUT_W, OUT_H, 1, gdal.GDT_Byte)
    raster.SetGeoTransform([minx, (maxx - minx) / OUT_W, 0,
                            maxy, 0, -(maxy - miny) / OUT_H])
    srs = layer.GetSpatialRef()
    raster.SetProjection(srs.ExportToWkt())
    band = raster.GetRasterBand(1)
    band.Fill(0)

    gdal.SetConfigOption("GDAL_NUM_THREADS", "ALL_CPUS")

    total = len(un2_values)
    for idx, un2 in enumerate(un2_values):
        cid = un2_to_id[un2]
        layer.SetAttributeFilter(f"FIRST_Un_2 = '{un2}'")
        if layer.GetFeatureCount() == 0:
            continue
        gdal.RasterizeLayer(raster, [1], layer, burn_values=[cid])
        if (idx + 1) % 8 == 0:
            print(f"  {idx+1}/{total} types rasterized…")
    layer.SetAttributeFilter(None)

    print("Reading raster data…")
    data = band.ReadAsArray()

    print("Building RGBA image…")
    rgba = np.zeros((OUT_H, OUT_W, 4), dtype=np.uint8)
    for un2, cid in un2_to_id.items():
        mask = data == cid
        if not mask.any():
            continue
        r, g, b = UN2_COLORS_RGB.get(un2, DEFAULT_RGB)
        rgba[mask] = (r, g, b, 220)

    img = Image.fromarray(rgba, "RGBA")
    img.save(OUT, optimize=False)
    print(f"Saved: {OUT}  ({OUT_W}×{OUT_H})")

if __name__ == "__main__":
    main()
