#!/usr/bin/env python3
"""Structural checks on the GIS user interface.

The analysis core has been well tested and the UI layer had nothing at all,
which is exactly where every fault reported this month lived: a catalogue
built into the wrong panel, styles written to a stylesheet the page does not
load, a select the handler reads and nobody fills, a dialog that built itself
invisibly. None of those is subtle — each is a structural fact that can be
asserted, and each check below exists because a specific one of them shipped.

Structure, never pixels. "Does this look right" is not a test; "is every tool
in the registry reachable from the sidebar" is.

    python3 GeoID_GIS/tests/ui.py            # needs the site on :8125

Skips green when Chrome is unavailable, as smoke.py does.
"""

import json
import re
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import smoke  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EARTH = ROOT / "GeoID_GIS/viewer/index.html"
SHELL = ROOT / "GeoID_GIS/viewer/gis/shell.html"
BASE = "http://localhost:8125"

failures = []
passes = 0


def check(name, ok, detail=""):
    global passes
    if ok:
        passes += 1
        print(f"PASS  {name}")
    else:
        failures.append(f"{name} — {detail}")
        print(f"FAIL  {name}  — {detail}")


# ── static checks: the two sidebars are one design ────────────────────────

def panel_ids(path):
    """Ids that carry behaviour, i.e. the ones a module looks up."""
    return set(re.findall(r'id="(gis-[a-z0-9\-]+|extract-[a-z\-]+|polygon-[a-z\-]+)"',
                          path.read_text()))


def static_checks():
    earth = panel_ids(EARTH)
    shell = panel_ids(SHELL)
    # Earth-only ids are the viewer's own panels, which the planet pages get
    # from their own viewers; the reverse should be empty, and the GIS panels
    # must exist on both.
    # Only ids a GIS module actually reads: the viewer's own panels differ
    # between Earth and the planets by design, and comparing those reports a
    # divergence that is a fact about the bodies rather than a fault.
    gis_dir = ROOT / "GeoID_GIS/viewer/gis"
    read = set()
    for js in gis_dir.glob("*.js"):
        if js.name.endswith(".test.mjs"):
            continue
        read |= set(re.findall(r'getElementById\("([a-z0-9\-]+)"\)', js.read_text()))
        read |= set(re.findall(r'querySelector\("#([a-z0-9\-]+)"\)', js.read_text()))
    # Earth-only by design: GeoID mode is the Analysis Hub's, and the hub is a
    # fact about Earth — the planets have no pinned-location workflow. Listed
    # rather than filtered by prefix so that adding a fourth is a decision.
    EARTH_ONLY = {"gis-group-geoid", "gis-inspect-section", "gis-pin-place"}
    missing_on_planets = ((earth & read) - shell) - EARTH_ONLY
    check("both sidebars carry the same GIS panel ids",
          not missing_on_planets,
          f"missing from shell.html: {sorted(missing_on_planets)[:6]}")

    # Every id a module reads by name must exist in the markup it belongs to.
    gis = ROOT / "GeoID_GIS/viewer/gis"
    read_ids = set()
    for js in gis.glob("*.js"):
        if js.name.endswith(".test.mjs"):
            continue
        for m in re.finditer(r'getElementById\("([a-z0-9\-]+)"\)', js.read_text()):
            read_ids.add(m.group(1))
    known = earth | shell
    # Ids built at runtime are not in the markup and must not be reported.
    # Built by a module at runtime rather than written in the markup.
    runtime = {i for i in read_ids if i.startswith(("gis-tool-", "gis-side-panel-",
                                                    "gis-time-", "gis-chart-", "gis-planet-"))}
    runtime |= {"gis-charts-section", "gis-feature-popup-style", "gis-panel-styles",
                "gis-symbology-host", "gis-tool-dialog-fallback"}
    orphans = sorted(i for i in read_ids - known - runtime
                     if i.startswith(("gis-", "extract-", "polygon-")))
    check("every panel id a module reads exists in the markup",
          not orphans, f"read but never rendered: {orphans[:8]}")


# ── live checks: the running page ─────────────────────────────────────────

LIVE = r"""
(() => {
  const d = document, w = window;
  const ids = (sel) => [...d.querySelectorAll(sel)].map((e) => e.id).filter(Boolean);
  const cat = d.getElementById("gis-tool-catalogue");
  const items = [...(cat ? cat.querySelectorAll(".gis-tool-item") : [])];
  // Selects a handler will read: empty ones are dead controls.
  const selects = [...d.querySelectorAll("#ui select, #gis-toolbox-panels select")]
    .filter((s) => s.id && !s.disabled);
  // A layer picker with no layers loaded is honestly empty; only judge these
  // once the page has something to offer.
  const layerCount = (w.GeoIDImportManager?.getLayers?.() || []).length;
  const empty = layerCount
    ? selects.filter((s) => s.options.length === 0).map((s) => s.id)
    : [];
  // Nothing may be wider than the panel that holds it.
  const host = d.getElementById("ui-scroll-body") || d.getElementById("ui");
  const wide = [];
  if (host) {
    [...host.querySelectorAll("details, .gis-tool-item, table")].forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > host.clientWidth + 2) wide.push((el.id || el.className || el.tagName) + ":" + Math.round(r.width));
    });
  }
  return JSON.stringify({
    seams: ["GeoIDViewer", "GeoIDImportManager", "GeoIDToolSearch", "GeoIDLayerHierarchy",
            "GeoIDDrawnLayers", "GeoIDSymbology", "GeoIDHydrology"]
      .filter((s) => !w[s]),
    catalogueItems: items.length,
    groups: ids("#gis-toolbox-panels > details, #ui > details").length,
    emptySelects: empty,
    overWide: wide.slice(0, 5),
    panelStyles: Boolean(d.getElementById("gis-panel-styles")),
  });
})()
"""


def live_checks(cdp, evaluate, label, tools_expected):
    raw = evaluate(LIVE)
    if not raw:
        check(f"{label}: the page answered", False, "no result")
        return
    state = json.loads(raw)
    check(f"{label}: every seam the UI depends on is present",
          not state["seams"], f"absent: {state['seams']}")
    check(f"{label}: every registered tool is in the catalogue",
          state["catalogueItems"] == tools_expected,
          f"{state['catalogueItems']} shown of {tools_expected} registered")
    check(f"{label}: the shared panel styles are installed", state["panelStyles"], "no style tag")
    check(f"{label}: no control is left empty for its handler",
          not state["emptySelects"], f"empty: {state['emptySelects']}")
    check(f"{label}: nothing is wider than its panel",
          not state["overWide"], f"{state['overWide']}")


def main():
    chrome = smoke.find_chrome()
    static_checks()
    if not chrome:
        print("\nChrome not found — static checks only.")
        return 0 if not failures else 1

    tools = len(re.findall(r'^    id: "', (ROOT / "GeoID_GIS/viewer/gis/tool-runner.js")
                           .read_text(), re.M))
    port = smoke._free_port()
    proc = smoke.launch_chrome(chrome, port, tempfile.mkdtemp(prefix="geoid-ui-"))
    try:
        cdp = smoke.CDP(smoke.WebSocket(smoke.wait_for_page_target(port)))
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        def run(url, wrap, label):
            cdp.call("Page.navigate", {"url": url})
            for _ in range(60):
                time.sleep(2)
                try:
                    if cdp.evaluate(wrap('Boolean(document.querySelector(".gis-tool-item") '
                                         '&& window.GeoIDViewer && window.GeoIDImportManager)'),
                                    await_promise=False, timeout=30):
                        break
                except Exception:
                    pass
            live_checks(cdp, lambda js: _try(cdp, wrap(js)), label, tools)

        def _try(cdp, js):
            for _ in range(3):
                try:
                    return cdp.evaluate(js, await_promise=False, timeout=40)
                except Exception:
                    time.sleep(2)
            return None

        # The Earth page runs inside the shell's iframe, and a script has to be
        # evaluated IN that realm to see its globals — reading them from the top
        # window reports every seam absent, which is a fault in the test rather
        # than in the page.
        def in_iframe(js):
            return ("(()=>{const w=document.querySelector('iframe').contentWindow;"
                    "return w.eval(" + json.dumps(js) + ");})()")
        run(f"{BASE}/myGeoID/", in_iframe, "earth")
        # The planet page is a top-level document, so the same script runs as-is.
        run(f"{BASE}/planet_explorer/mars/viewer/", lambda js: js, "mars")
    finally:
        proc.terminate()

    print(f"\n{passes} passed, {len(failures)} failed")
    for f in failures:
        print(f"  ✗ {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
