"""
Earth Engine, end to end, with no browser in the way.

The GUI failed for a whole session and every diagnosis was ambiguous, because a
failure there could be the OAuth origin, the iframe, a stale module, the request
shape, or Earth Engine itself -- five candidates and no way to separate them.
This removes four of the five. It sends the SAME request the browser client
builds, from Python, over a token you supply, so a pass means the contract in
`gee-live.js` is right and a failure names which stage broke.

It found four faults on its first run, each of which alone was fatal:
no quota-project header (403 on everything), an invented expression shape
(EE takes a serialised graph), a function name that does not exist
(Collection.filterDate), and a band that is not on these images
(total_precipitation_surface -> precipitation_rate).

Usage:

    python3 GeoID_GIS/tests/gee-live.py                 # takes a token from gcloud
    python3 GeoID_GIS/tests/gee-live.py $(cat token)    # or pass one
    GEOID_EE_TOKEN=ya29... python3 GeoID_GIS/tests/gee-live.py

Stdlib only, like every other test here. The token is never printed, never
written to disk, and never put in a URL -- it travels in the Authorization
header and nowhere else.
"""

import json
import os
import struct
import subprocess
import sys
import urllib.error
import urllib.request

EE = "https://earthengine.googleapis.com/v1"
PROJECT = os.environ.get("GEOID_EE_PROJECT", "geoid-504623")
COLLECTION = "NOAA/GFS0P25"
RAIN_BAND = "precipitation_rate"

# Northern Ireland, which is the prototype's own study area -- so a pass here is
# a pass for the thing being built rather than for a convenient elsewhere.
BOUNDS = {"minX": -8.2, "minY": 54.0, "maxX": -5.4, "maxY": 55.4}

passed, failed = [], []


def token_from_gcloud():
    """The user's own login. Never stored, never echoed."""
    try:
        out = subprocess.run(
            ["gcloud", "auth", "application-default", "print-access-token"],
            capture_output=True, text=True, timeout=60,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


def call(path, body, token, raw=False):
    """POST to Earth Engine. Returns (ok, payload-or-error-text)."""
    req = urllib.request.Request(
        f"{EE}/projects/{PROJECT}{path}",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            # Without this every call is 403: ADC has no quota project by
            # default, and the message says so only if you read the body.
            "x-goog-user-project": PROJECT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        return True, (data if raw else json.loads(data))
    except urllib.error.HTTPError as e:
        # NOT truncated. A 400-character cut hid `precipitation_rate` past the
        # end of EE's band list and failed stage 2 for a band stage 3 then
        # fetched successfully -- a false failure manufactured by the test's
        # own tidiness. An error body is the useful part of a failed call.
        return False, e.read().decode("utf8", "replace")
    except Exception as e:  # network, DNS, timeout
        return False, str(e)


def step_body(start, end, width=64, height=32):
    """
    The request `gee-live.js:stepImageBody` builds, in Python.

    Kept deliberately parallel to the JS so the two can be diffed by eye. If it
    drifts, this test stops testing the client and starts testing itself.
    """
    span_x = BOUNDS["maxX"] - BOUNDS["minX"]
    span_y = BOUNDS["maxY"] - BOUNDS["minY"]
    return {
        "expression": {
            "result": "0",
            "values": {
                "0": {"functionInvocationValue": {"functionName": "Image.select", "arguments": {
                    "input": {"valueReference": "1"},
                    "bandSelectors": {"constantValue": [RAIN_BAND]}}}},
                "1": {"functionInvocationValue": {"functionName": "Collection.first", "arguments": {
                    "collection": {"valueReference": "2"}}}},
                "2": {"functionInvocationValue": {"functionName": "Collection.filter", "arguments": {
                    "collection": {"valueReference": "3"}, "filter": {"valueReference": "4"}}}},
                "3": {"functionInvocationValue": {"functionName": "ImageCollection.load", "arguments": {
                    "id": {"constantValue": COLLECTION}}}},
                "4": {"functionInvocationValue": {"functionName": "Filter.dateRangeContains", "arguments": {
                    "leftValue": {"valueReference": "5"},
                    "rightField": {"constantValue": "system:time_start"}}}},
                "5": {"functionInvocationValue": {"functionName": "DateRange", "arguments": {
                    "start": {"constantValue": start}, "end": {"constantValue": end}}}},
            },
        },
        "fileFormat": "NPY",
        "grid": {
            "dimensions": {"width": width, "height": height},
            # North-up: the origin is the TOP-left and scaleY is negative. The
            # wrong sign returns a perfectly plausible upside-down map.
            "affineTransform": {
                "scaleX": span_x / width, "shearX": 0, "translateX": BOUNDS["minX"],
                "shearY": 0, "scaleY": -span_y / height, "translateY": BOUNDS["maxY"],
            },
            "crsCode": "EPSG:4326",
        },
    }


def read_npy(blob):
    """
    Floats out of a .npy, without numpy.

    EE returns a structured array of one named field, so the header carries a
    dtype like [('precipitation_rate', '<f8')] and the body is plain doubles.
    """
    if blob[:6] != b"\x93NUMPY":
        raise ValueError("not a .npy -- EE probably returned an error as JSON")
    major = blob[6]
    hlen = struct.unpack("<H" if major == 1 else "<I", blob[8:10 if major == 1 else 12])[0]
    start = (10 if major == 1 else 12) + hlen
    header = blob[10 if major == 1 else 12:start].decode()
    count = (len(blob) - start) // 8
    values = struct.unpack(f"<{count}d", blob[start:start + count * 8])
    return header, list(values)


def check(name, fn):
    try:
        detail = fn()
        passed.append(name)
        print(f"  PASS  {name}" + (f"\n        {detail}" if detail else ""))
    except Exception as e:
        failed.append(name)
        print(f"  FAIL  {name}\n        {str(e)[:600]}")


def main():
    tok = (sys.argv[1] if len(sys.argv) > 1 else "").strip() \
        or os.environ.get("GEOID_EE_TOKEN", "").strip() \
        or token_from_gcloud()
    if not tok:
        print("No token. Get one with:\n"
              "  gcloud auth application-default print-access-token\n"
              "then pass it as the first argument, or set GEOID_EE_TOKEN.")
        return 2

    print(f"Earth Engine, project {PROJECT}, collection {COLLECTION}\n")

    def auth():
        ok, out = call("/value:compute",
                       {"expression": {"values": {"0": {"constantValue": 42}}, "result": "0"}}, tok)
        if not ok:
            raise AssertionError(out)
        if out.get("result") != 42:
            raise AssertionError(f"unexpected answer {out}")
        return "token accepted, quota project set"

    def bands():
        # Ask the image what it carries rather than assuming. Assuming is how
        # total_precipitation_surface survived in the client for weeks.
        body = step_body("2026-08-14T00:00:00", "2026-08-15T00:00:00")
        body["expression"]["values"]["0"]["functionInvocationValue"]["arguments"][
            "bandSelectors"]["constantValue"] = ["no_such_band"]
        ok, out = call("/image:computePixels", body, tok, raw=True)
        text = out if isinstance(out, str) else out.decode("utf8", "replace")
        if RAIN_BAND not in text:
            raise AssertionError(f"{RAIN_BAND} is not offered. EE said: {text[:300]}")
        return f"{RAIN_BAND} is present on these images"

    def pixels():
        ok, out = call("/image:computePixels",
                       step_body("2026-08-14T00:00:00", "2026-08-15T00:00:00"), tok, raw=True)
        if not ok:
            raise AssertionError(out)
        header, values = read_npy(out)
        if RAIN_BAND not in header:
            raise AssertionError(f"unexpected dtype {header}")
        if len(values) != 64 * 32:
            raise AssertionError(f"expected 2048 cells, got {len(values)}")
        mm = [v * 3600 for v in values]           # kg/m2/s == mm/s
        wet = sum(1 for v in mm if v > 0.01)
        if max(mm) <= 0:
            raise AssertionError("every cell is dry -- suspect the date window, not the wiring")
        return (f"{len(values)} cells   max {max(mm):.3f} mm/h   "
                f"mean {sum(mm) / len(mm):.3f} mm/h   raining {wet}/{len(mm)}")

    def series():
        # The thing the pipeline actually needs: consecutive steps that DIFFER.
        # A series that repeats one frame looks alive and is the static-map bug
        # this project chased for days.
        totals = []
        for hour in (0, 6, 12):
            start = f"2026-08-14T{hour:02d}:00:00"
            end = f"2026-08-14T{hour + 3:02d}:00:00" if hour < 21 else "2026-08-15T00:00:00"
            ok, out = call("/image:computePixels", step_body(start, end, 32, 16), tok, raw=True)
            if not ok:
                raise AssertionError(f"step {hour}h: {out}")
            _, values = read_npy(out)
            totals.append(sum(values) * 3600 / len(values))
        if len(set(round(t, 6) for t in totals)) < len(totals):
            raise AssertionError(f"steps are identical -- {totals}; the map would look static")
        return "  ".join(f"{h:02d}h {t:.3f} mm/h" for h, t in zip((0, 6, 12), totals))

    check("1. auth and quota project", auth)
    check("2. the band the client asks for exists", bands)
    check("3. a real GFS grid over the study area", pixels)
    check("4. consecutive steps differ", series)

    print(f"\n{len(passed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
