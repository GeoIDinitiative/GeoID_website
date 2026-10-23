#!/usr/bin/env python3
"""Land ice from the CPOM portal: surface elevation change and mass change.

The CPOM Land Ice Portal (UK Centre for Polar Observation and Modelling, ESA
supported) publishes Antarctic surface elevation change from radar altimetry —
ERS-1, ERS-2, Envisat and CryoSat-2, cross-checked against ICESat-2 — through
the ESA Antarctic Ice Sheet CCI. The portal's own pages are hosted at UCL
(www.cpom.ucl.ac.uk/landice_portal), which did not answer from here when this
was written; the SAME FILES, produced by CPOM and named for it in their own
`institution` attribute, are in the CCI archive at CEDA:

    https://data.ceda.ac.uk/neodc/esacci/ice_sheets_antarctica/data/
        surface_elevation_change/v2.0/
        ESACCI-AIS-L3C-SEC-MULTIMISSION_ANNUAL_CUMULATIVE_DH_GRID-5KM/

One NetCDF4 per year, `..._199301_YYYYMM-fv2.nc`: the CUMULATIVE elevation
change since January 1993 on a 5 km EPSG:3031 grid (1128 x 968), with the IMBIE
basin id and the BedMachine surface type on every cell. Public, under the ESA
CCI data policy (free and open, cite the catalogue record).

THREE PRODUCTS come out of one pass, all under data/global/ice/cpom/:

- antarctica-sec.hotlink-ok.tif   one Int16 band per year, centimetres, in the
                                  file's OWN grid — EPSG:3031, never resampled
                                  to lat/lon. The globe reprojects at draw time
                                  (gis/polar-stereo.js), so a cell is drawn
                                  where CPOM put it and nowhere else.
                                  The last band is the density model below.
- antarctica-basins.json          per IMBIE basin and per region: area, the
                                  mean elevation change and the mass change in
                                  gigatonnes, one value per year. Plus the ESA
                                  CCI gravimetric (GRACE/GRACE-FO) series for
                                  the same regions, as an independent check.
- manifest.json                   what was baked, from where, and the citation;
                                  one entry per ice sheet. Greenland is a STUB
                                  until the portal publishes it (see REGIONS).

MASS FROM ELEVATION NEEDS A DENSITY, and that is a choice, so it is stated:
where a cell's elevation has changed faster than DYNAMIC_M_PER_YR over the
whole record the change is taken as ice (917 kg/m3) — that is what dynamic
thinning removes — and elsewhere as firn (350 kg/m3), which is what a change in
snowfall adds or takes away. The two-density split follows the approach of
Shepherd et al. (2019, GRL, doi:10.1029/2019GL082182), whose processor these
files come from; the threshold is this bake's. The gravimetric series beside it
in the chart measures mass directly and is how a reader checks the assumption.

    python3 GeoID_GIS/services/bake-cpom-landice.py
    python3 GeoID_GIS/services/bake-cpom-landice.py --region antarctica

Downloads are cached in the work folder, so a re-run after CEDA adds a year
fetches only that year.

Publish the COG with services/publish-data.py; the manifest and the basin JSON
stay with the site.
"""

from __future__ import annotations

import argparse
import base64
import csv
import datetime
import io
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

import h5py
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "global" / "ice" / "cpom"
# Scratch. `data/global/.*-work/` is gitignored: about 500 MB of NetCDF.
WORK = ROOT / "data" / "global" / ".cpom-work"

LISTING = "https://data.ceda.ac.uk{}?json"
DOWNLOAD = "https://dap.ceda.ac.uk{}"

# ONE ENTRY PER ICE SHEET. The portal covers Antarctica; Greenland is announced
# and not yet published. When it is, fill in `path` and `pattern` for its
# annual cumulative grid and run this again: the manifest gains a `greenland`
# entry with the same shape, and the viewer draws a row for every entry it
# finds — nothing in the browser names Antarctica.
REGIONS = {
    "antarctica": {
        "label": "Antarctic Ice Sheet",
        "path": ("/neodc/esacci/ice_sheets_antarctica/data/surface_elevation_change/v2.0/"
                 "ESACCI-AIS-L3C-SEC-MULTIMISSION_ANNUAL_CUMULATIVE_DH_GRID-5KM"),
        "pattern": r"ESACCI-AIS-L3C-SEC-MULTIMISSION_ANNUAL_CUMULATIVE_DH_GRID-5KM_(\d{6})_(\d{6})-fv(\d+)\.nc$",
        "crs": "EPSG:3031",
        "catalogue": "https://catalogue.ceda.ac.uk/uuid/6415e9e095e249ab9509f9c7878d1f11",
        "gravimetric": ("/neodc/esacci/ice_sheets_antarctica/data/gravimetric_mass_balance/"
                        "basin/v3.0/20210226-ESACCI-L4_AIS-GMB-BASIN-fv3.0.nc"),
    },
    "greenland": {
        "label": "Greenland Ice Sheet",
        # Not yet on the portal. The CCI's own Greenland elevation change
        # (greenland_surface_elevation_change) is a different processor and is
        # NOT substituted for it.
        "path": None,
        "pattern": None,
        "crs": "EPSG:3413",
    },
}

# IMBIE basin ids as CPOM's `basin_id` numbers them — NOT alphabetical, so the
# names are not guessable from the numbers. Cross-tabulated cell by cell against
# IMBIE's own 5 km delineation grid (imbie.org/imbie-3/drainage-basins): every
# id agrees with exactly one IMBIE basin on 90-99.5% of its cells, the rest
# being coastline the two masks draw a cell apart. Region is IMBIE's.
BASINS = {
    1: ("H-Hp", "West"), 2: ("F-G", "West"), 3: ("E-Ep", "East"),
    4: ("D-Dp", "East"), 5: ("Cp-D", "East"), 6: ("B-C", "East"),
    7: ("A-Ap", "East"), 8: ("Jpp-K", "East"), 9: ("G-H", "West"),
    10: ("Dp-E", "East"), 11: ("Ap-B", "East"), 12: ("C-Cp", "East"),
    13: ("K-A", "East"), 14: ("J-Jpp", "West"), 15: ("Ipp-J", "Peninsula"),
    16: ("I-Ipp", "Peninsula"), 17: ("Hp-I", "Peninsula"), 18: ("Ep-F", "West"),
}

# What a reader recognises a basin by. The letters are IMBIE's; these are the
# glaciers or coasts that drain through them.
BASIN_PLACES = {
    "A-Ap": "Western Dronning Maud Land", "Ap-B": "Enderby Land",
    "B-C": "Lambert Glacier / Amery", "C-Cp": "Wilhelm II Land",
    "Cp-D": "Totten / Wilkes Land", "D-Dp": "Adélie / George V Land",
    "Dp-E": "Victoria Land", "E-Ep": "Ross Ice Shelf, East",
    "Ep-F": "Siple Coast / Ross West", "F-G": "Getz / Marie Byrd Land",
    "G-H": "Pine Island and Thwaites", "H-Hp": "Ellsworth Land",
    "Hp-I": "Peninsula, west (George VI)", "I-Ipp": "Peninsula, north",
    "Ipp-J": "Peninsula, east (Larsen)", "J-Jpp": "Ronne / Ellsworth Mountains",
    "Jpp-K": "Filchner / Recovery", "K-A": "Coats Land",
}

ICE_DENSITY = 917.0
FIRN_DENSITY = 350.0
# Faster than this over the record and the change is taken as ice. A tenth of a
# metre a year is several times the year-to-year scatter in snowfall over the
# interior, and well under the metres a year the Amundsen Sea glaciers lose.
DYNAMIC_M_PER_YR = 0.1

CELL_M = 5000.0
NODATA = -32768
# The gravimetric product's region numbers for the four aggregates.
GRAVIMETRIC_REGIONS = {"AIS29": "Peninsula", "AIS30": "East", "AIS31": "West", "AIS32": "Antarctica"}


def listing(path):
    with urllib.request.urlopen(LISTING.format(path), timeout=120) as r:
        return json.load(r)["items"]


def fetch(path, dest):
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(DOWNLOAD.format(path), timeout=600) as r, open(tmp, "wb") as fh:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
    # CEDA answers a restricted file with its login page and a 200: refuse
    # anything that is not HDF5 rather than bake a web page.
    with open(tmp, "rb") as fh:
        if fh.read(8) != b"\x89HDF\r\n\x1a\n":
            tmp.unlink()
            raise RuntimeError(f"{path} is not a NetCDF4 file (login page?)")
    tmp.rename(dest)
    return dest


def annual_files(region):
    spec = REGIONS[region]
    rx = re.compile(spec["pattern"])
    found = []
    for item in listing(spec["path"]):
        m = rx.match(item["name"])
        if m:
            found.append({"name": item["name"], "start": m.group(1), "end": m.group(2),
                          "version": m.group(3), "path": item["path"]})
    found.sort(key=lambda f: f["end"])
    return found


def read_grid(path):
    with h5py.File(path, "r") as h:
        dh = h["dH"][:].astype(np.float32)
        x = h["x"][:].astype(np.float64)
        y = h["y"][:].astype(np.float64)
        basin = h["basin_id"][:].astype(np.int16)
        surface = h["surface_type"][:].astype(np.int16)
        attrs = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in h.attrs.items()
                 if k in ("title", "source", "institution", "references", "license",
                          "time_coverage_start", "time_coverage_end", "gia_correction_model")}
    return dh, x, y, basin, surface, attrs


def gravimetric(region):
    """The CCI's GRACE/GRACE-FO basin product, aggregates only, in Gt."""
    path = REGIONS[region].get("gravimetric")
    if not path:
        return None
    try:
        local = fetch(path, WORK / region / pathlib.Path(path).name)
    except Exception as error:  # an independent check is worth having, not worth failing for
        print(f"  gravimetric series skipped: {error}")
        return None
    with h5py.File(local, "r") as h:
        names = ["".join(c.decode() for c in row).strip() for row in h["regions"][:]]
        t = h["time_dec"][:]
        dm = h["dm"][:]
        sigma = h["sigma_dm"][:]
        attrs = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in h.attrs.items()
                 if k in ("title", "institution", "source", "time_coverage_start", "time_coverage_end")}
    series = {}
    for code, label in GRAVIMETRIC_REGIONS.items():
        if code in names:
            i = names.index(code)
            series[label] = {
                "gt": [None if not np.isfinite(v) else round(float(v) / 1e12, 1) for v in dm[i]],
                "sigma_gt": [None if not np.isfinite(v) else round(float(v) / 1e12, 1) for v in sigma[i]],
            }
    return {
        "years": [round(float(v), 3) for v in t],
        "series": series,
        "reference": "mass relative to 2011-01-01, as published",
        "source": attrs.get("source"), "institution": attrs.get("institution"),
        "title": attrs.get("title"),
        "url": DOWNLOAD.format(path),
        "citation": "ESA Antarctic Ice Sheet CCI, Gravimetric Mass Balance basin product v3.0 "
                    "(Groh & Horwath, TU Dresden), CEDA.",
    }


# IMBIE 2021 (Otosaka et al. 2023, ESSD 15, 1597): the reconciled assessment
# the portal's numbers feed. UK Polar Data Centre, Open Government Licence v3.
IMBIE_ENTRY = "77b64c55-7166-4a06-9def-2e400398e452"
IMBIE_FILES = {"Antarctica": "imbie_antarctica_2021_Gt.csv",
               "West": "imbie_west_antarctica_2021_Gt.csv",
               "East": "imbie_east_antarctica_2021_Gt.csv",
               "Peninsula": "imbie_antarctic_peninsula_2021_Gt.csv"}
IMBIE_URL = "https://ramadda.data.bas.ac.uk/repository/entry/get/{name}?entryid=synth:{entry}:{key}"


def imbie(start_year):
    """IMBIE's cumulative series per region, re-zeroed at our own epoch.

    IMBIE counts from January 1992 and this product from January 1993, so the
    IMBIE curve has its own value at 1993.0 SUBTRACTED — an exact change of
    reference, not a fitted shift: both lines then mean "mass gained or lost
    since January 1993", and any gap between them is a disagreement.
    """
    out = {"years": None, "series": {}, "reference": f"re-zeroed at {start_year:.1f}",
           "citation": ("IMBIE Team / Otosaka, I. N. et al. (2023). Mass balance of the Greenland and "
                        "Antarctic ice sheets from 1992 to 2020. Earth Syst. Sci. Data 15, 1597-1616, "
                        "doi:10.5194/essd-15-1597-2023. Data: UK Polar Data Centre, "
                        "doi:10.5285/77B64C55-7166-4A06-9DEF-2E400398E452."),
           "licence": "Open Government Licence v3.0",
           "url": "https://doi.org/10.5285/77B64C55-7166-4A06-9DEF-2E400398E452"}
    for label, name in IMBIE_FILES.items():
        key = base64.b64encode(f"/{name}".encode()).decode()
        local = WORK / "imbie" / name
        if not local.exists():
            local.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(IMBIE_URL.format(name=name, entry=IMBIE_ENTRY, key=key), timeout=120) as r:
                local.write_bytes(r.read())
        rows = list(csv.DictReader(io.StringIO(local.read_text())))
        t = np.array([float(r["Year"]) for r in rows])
        c = np.array([float(r["Cumulative mass balance (Gt)"]) for r in rows])
        sig = np.array([float(r["Cumulative mass balance uncertainty (Gt)"]) for r in rows])
        zero = float(np.interp(start_year, t, c))
        keep = t >= start_year
        out["years"] = [round(float(v), 4) for v in t[keep]]
        out["series"][label] = {"gt": [round(float(v - zero), 1) for v in c[keep]],
                                "sigma_gt": [round(float(v), 1) for v in sig[keep]]}
    return out


def write_cog(bands, descriptions, nx, ny, x0, y1, out):
    """Int16 bands in the source grid, rows NORTH-UP in projected y."""
    WORK.mkdir(parents=True, exist_ok=True)
    raw = WORK / "sec.bin"
    with open(raw, "wb") as fh:
        for band in bands:
            fh.write(band.astype("<i2").tobytes())
    xml = "".join(
        '<VRTRasterBand dataType="Int16" band="{}" subClass="VRTRawRasterBand">'
        '<SourceFilename relativeToVRT="1">sec.bin</SourceFilename>'
        '<ImageOffset>{}</ImageOffset><PixelOffset>2</PixelOffset>'
        '<LineOffset>{}</LineOffset><ByteOrder>LSB</ByteOrder>'
        '<NoDataValue>{}</NoDataValue><Description>{}</Description>'
        '</VRTRasterBand>'.format(i + 1, i * nx * ny * 2, nx * 2, NODATA, d)
        for i, d in enumerate(descriptions))
    vrt = WORK / "sec.vrt"
    # The geotransform's origin is the top-left CORNER: the first cell CENTRE
    # less half a cell in x, plus half a cell in y.
    vrt.write_text(
        '<VRTDataset rasterXSize="{}" rasterYSize="{}"><SRS>EPSG:3031</SRS>'
        '<GeoTransform>{}, {}, 0.0, {}, 0.0, -{}</GeoTransform>{}</VRTDataset>'.format(
            nx, ny, x0 - CELL_M / 2, CELL_M, y1 + CELL_M / 2, CELL_M, xml))
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["gdal_translate", str(vrt), str(out), "-of", "COG",
         "-co", "COMPRESS=DEFLATE", "-co", "PREDICTOR=2", "-co", "BLOCKSIZE=512",
         "-co", "OVERVIEWS=NONE"],
        check=True, capture_output=True, text=True)
    raw.unlink()


def bake(region):
    spec = REGIONS[region]
    files = annual_files(region)
    if not files:
        raise RuntimeError(f"no annual grids listed under {spec['path']}")
    print(f"  {region}: {len(files)} annual grids, {files[0]['end']} .. {files[-1]['end']}")

    frames, epochs = [], []
    x = y = basin = surface = attrs = None
    for f in files:
        local = fetch(f["path"], WORK / region / f["name"])
        dh, x, y, basin, surface, attrs = read_grid(local)
        frames.append(dh)
        epochs.append({"start": f["start"], "end": f["end"], "file": f["name"],
                       "url": DOWNLOAD.format(f["path"])})
        print(f"    {f['end']}  {np.isfinite(dh).sum():,} cells")

    # Projected y ascends in the file; a raster's rows run north-up (y
    # DEScending). Flipped once here, so the band and the grid in the manifest
    # describe the same thing.
    flip = y[0] < y[-1]
    if flip:
        frames = [fr[::-1] for fr in frames]
        basin = basin[::-1]
        surface = surface[::-1]
        y = y[::-1]
    ny, nx = frames[0].shape

    first = datetime.date(int(files[0]["start"][:4]), int(files[0]["start"][4:]), 1)

    def years_since(end):
        e = datetime.date(int(end[:4]), int(end[4:]), 28)
        return (e - first).days / 365.25

    span = years_since(files[-1]["end"])
    rate = frames[-1] / span
    density = np.where(np.abs(rate) > DYNAMIC_M_PER_YR, ICE_DENSITY, FIRN_DENSITY).astype(np.float32)
    density[~np.isfinite(frames[-1])] = np.nan

    def cm(a):
        out = np.full(a.shape, NODATA, dtype=np.int32)
        ok = np.isfinite(a)
        out[ok] = np.clip(np.round(a[ok] * 100), -32767, 32767)
        return out.astype(np.int16)

    bands = [cm(fr) for fr in frames]
    dens_band = np.where(np.isfinite(density), density, NODATA).astype(np.int16)
    bands.append(dens_band)
    descriptions = [e["end"] for e in epochs] + ["density_kg_m3"]
    cog = OUT / f"{region}-sec.hotlink-ok.tif"
    write_cog(bands, descriptions, nx, ny, float(x[0]), float(y[0]), cog)
    print(f"  wrote {cog.relative_to(ROOT)} ({cog.stat().st_size / 1e6:.1f} MB)")

    # PER BASIN: area, mean elevation change, mass change. A cell is 25 km2.
    cell_area = CELL_M * CELL_M
    basins = []
    regions = {}
    for bid, (name, reg) in BASINS.items():
        m = basin == bid
        area = float(m.sum()) * cell_area
        dh_mean, gt = [], []
        for fr in frames:
            ok = m & np.isfinite(fr)
            dh_mean.append(round(float(fr[ok].mean()), 3) if ok.any() else None)
            gt.append(round(float((fr[ok] * density[ok]).sum() * cell_area / 1e12), 1) if ok.any() else None)
        basins.append({"id": bid, "name": name, "place": BASIN_PLACES[name], "region": reg,
                       "area_km2": round(area / 1e6), "dh_m": dh_mean, "mass_gt": gt})
        agg = regions.setdefault(reg, {"area_km2": 0, "mass_gt": [0.0] * len(frames)})
        agg["area_km2"] += round(area / 1e6)
        agg["mass_gt"] = [round(a + (b or 0.0), 1) for a, b in zip(agg["mass_gt"], gt)]
    total = {"area_km2": sum(r["area_km2"] for r in regions.values()),
             "mass_gt": [round(sum(r["mass_gt"][i] for r in regions.values()), 1)
                         for i in range(len(frames))]}
    regions["Antarctica"] = total

    years = [round(years_since(e["end"]) + first.year + first.month / 12 - 1 / 12, 3) for e in epochs]
    reference = imbie(first.year + (first.month - 1) / 12)

    # RECONCILIATION, written into the series so the page can state it. Over
    # the window both cover, the altimetry estimate per region beside IMBIE's,
    # and how far the sheet total moves under other reasonable density rules
    # — the number is only as good as that assumption, and this shows how good.
    last_imbie = reference["years"][-1]
    k = max(i for i, t in enumerate(years) if t <= last_imbie + 0.1)
    window = {"from": first.isoformat()[:7], "to": epochs[k]["end"],
              "altimetry_gt": {}, "imbie_gt": {}}
    for reg, agg in regions.items():
        window["altimetry_gt"][reg] = agg["mass_gt"][k]
        ims = reference["series"].get(reg)
        if ims:
            window["imbie_gt"][reg] = ims["gt"][-1]
    grounded = (basin > 0) & np.isfinite(frames[k])
    fr = frames[k]
    rules = {
        "all firn (350)": np.full(fr.shape, FIRN_DENSITY),
        "this product's rule": density,
        "all ice (917)": np.full(fr.shape, ICE_DENSITY),
        "loss as ice, gain as firn": np.where(fr < 0, ICE_DENSITY, FIRN_DENSITY),
    }
    window["density_sensitivity_gt"] = {
        name: round(float((fr[grounded] * rho[grounded]).sum() * cell_area / 1e12))
        for name, rho in rules.items()}
    print(f"  reconcile {window['from']}..{window['to']}: altimetry {window['altimetry_gt']}  "
          f"IMBIE {window['imbie_gt']}  sensitivity {window['density_sensitivity_gt']}")
    series = {
        "region": region,
        "reference": f"change since {first.isoformat()[:7]}",
        "epochs": [e["end"] for e in epochs],
        "years": years,
        "density": {"ice_kg_m3": ICE_DENSITY, "firn_kg_m3": FIRN_DENSITY,
                    "dynamic_m_per_yr": DYNAMIC_M_PER_YR},
        "basins": basins,
        "regions": regions,
        "gravimetric": gravimetric(region),
        "imbie": reference,
        "reconcile": window,
    }
    (OUT / f"{region}-basins.json").write_text(json.dumps(series, separators=(",", ":")))

    return {
        "label": spec["label"],
        "status": "published",
        "crs": spec["crs"],
        "grid": {"nx": nx, "ny": ny, "dx": CELL_M, "x0": float(x[0]), "y0": float(y[0]),
                 "order": "rows north-up (y descending), x ascending; values are cell centres"},
        "raster": f"/data/global/ice/cpom/{cog.name}",
        "series": f"/data/global/ice/cpom/{region}-basins.json",
        "scale": 0.01, "nodata": NODATA, "unit": "m",
        "bands": [{"band": i, "end": e["end"], "start": e["start"]} for i, e in enumerate(epochs)],
        "density_band": len(epochs),
        "next": next_probe(files[-1]),
        "listing": LISTING.format(spec["path"]).replace("?json", ""),
        "catalogue": spec.get("catalogue"),
        "source": attrs.get("source"),
        "institution": attrs.get("institution"),
        "title": attrs.get("title"),
        "gia": attrs.get("gia_correction_model"),
        "references": attrs.get("references"),
        "licence": "ESA CCI Data Policy: free and open access; cite the catalogue record.",
        "citation": ("ESA Antarctic Ice Sheet Climate Change Initiative (Antarctic_Ice_Sheet_cci): "
                     "Antarctic Ice Sheet Surface Elevation Change v2.0, produced by the Centre for "
                     "Polar Observation and Modelling (CPOM). NERC EDS Centre for Environmental Data "
                     "Analysis. " + (spec.get("catalogue") or "")),
    }


def next_probe(last):
    """The file a NEWER bake would read, for the viewer's one-byte freshness check."""
    year = int(last["end"][:4])
    # The archive names the final year by its last month of data (202511), so a
    # finished year after it will be YYYY12 of the next year.
    name = re.sub(r"_(\d{6})-fv", f"_{year + 1}12-fv", last["name"])
    return DOWNLOAD.format(last["path"].replace(last["name"], name))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--region", choices=list(REGIONS), action="append")
    args = ap.parse_args()
    manifest = {
        "name": "CPOM Land Ice Portal",
        "portal": "https://www.cpom.ucl.ac.uk/landice_portal",
        "about": "https://cpom.org.uk/leeds_data/test-data/",
        "baked": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "regions": {},
    }
    for region in args.region or list(REGIONS):
        spec = REGIONS[region]
        if not spec.get("path"):
            manifest["regions"][region] = {
                "label": spec["label"], "status": "pending", "crs": spec["crs"],
                "note": "Announced by the CPOM Land Ice Portal and not yet published. "
                        "When it is, fill in REGIONS in services/bake-cpom-landice.py and re-run.",
            }
            print(f"  {region}: pending (no portal product yet)")
            continue
        manifest["regions"][region] = bake(region)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"  wrote {(OUT / 'manifest.json').relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
