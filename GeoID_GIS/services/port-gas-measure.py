#!/usr/bin/env python3
"""Carry Saturn's measurement code to the gas giants that forked before it.

The four gas-giant viewers are copies of one file. Saturn and Uranus received
the moon tidal-locking fix — a point measured on a moon is stored in the MOON
MESH's own frame (`moonMeshLocal`) and every marker, arc and fill is re-placed
from it each frame, so a measurement stays on the ground as the moon turns.
Jupiter and Neptune forked earlier and never got it: on Io or Triton the same
measurement slid across the surface, and the draw tools built on top of this
code (services/port-draw-tools.py) had no common frame to stand on.

So this lifts Saturn's versions verbatim, with the body's own name written in,
rather than asking four files to be kept equal by hand.

**Edit saturn-viewer.js and re-run this. Never edit a lifted function.**

Run:  python3 GeoID_GIS/services/port-gas-measure.py [--check]
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "planet_explorer" / "saturn" / "viewer" / "saturn-viewer.js"

TARGETS = [
    # folder,    display name
    ("jupiter", "Jupiter"),
    ("neptune", "Neptune"),
]

# The measurement set, whole. Each is taken from `function name(` to its
# matching closing brace (counted, not found by indent).
FUNCTIONS = [
    "clearMeasureGroup",
    "normalizeMeasureHitLocalPoint",
    "intersectMeasurementSurface",
    "addMeasureMarker",
    "updateMeasureVisualScale",
    "buildMoonLocalArcPts",
    "updateMeasureVisualization",
]

# Saturn's per-frame moon lists, declared beside the other measure state.
DECL_ANCHOR = "      const measureVisuals = [];\n"
DECL = (
    "      const moonMeasureLines = []; // { line, moonMesh, moonLocalPts } — updated each frame\n"
    "      const moonMeasureFills = []; // { mesh, moonMesh, moonLocalBoundaryPts } — updated each frame\n"
)

# The click that records a point must record the moon-mesh frame too.
PUSH_OLD = (
    "              point: surfaceHit.localPoint.clone(),\n"
    "              localPoint: surfaceHit.localPoint.clone(),\n"
    "              bodyKind: context.kind,\n"
)
PUSH_NEW = (
    "              point: surfaceHit.localPoint.clone(),\n"
    "              localPoint: surfaceHit.localPoint.clone(),\n"
    "              moonMeshLocal: surfaceHit.moonMeshLocal ? surfaceHit.moonMeshLocal.clone() : null,\n"
    "              moonMesh: (surfaceHit.context.kind === \"moon\" && surfaceHit.context.mesh) ? surfaceHit.context.mesh : null,\n"
    "              bodyKind: context.kind,\n"
)


def _skip_string(text: str, i: int) -> int:
    """Index just past the string/template literal opening at text[i]."""
    quote = text[i]
    i += 1
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if quote == "`" and text.startswith("${", i):
            i = _match_brace(text, i + 1) + 1
            continue
        if ch == quote:
            return i + 1
        i += 1
    raise SystemExit("unterminated string")


def _match_brace(text: str, i: int) -> int:
    """Index of the brace closing the one at text[i], by counting — an
    indent rule is fooled by any inner closure at the same depth."""
    depth = 0
    while i < len(text):
        ch = text[i]
        if ch in "'\"`":
            i = _skip_string(text, i)
            continue
        if text.startswith("//", i):
            i = text.index("\n", i)
            continue
        if text.startswith("/*", i):
            i = text.index("*/", i) + 2
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise SystemExit("unbalanced braces")


def function_span(text: str, name: str) -> tuple[int, int] | None:
    match = re.search(r"^ *function " + re.escape(name) + r"\s*\(", text, re.M)
    if not match:
        return None
    # The body's brace is the first one after the parameter list closes.
    depth, i = 0, match.end() - 1
    while True:
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                break
        i += 1
    open_brace = text.index("{", i)
    return match.start(), _match_brace(text, open_brace) + 1


def localise(body: str, display: str) -> str:
    return (body.replace("Saturn", display)
                .replace("saturn_", display.lower() + "_"))


def port(text: str, source: str, display: str) -> str:
    for name in FUNCTIONS:
        src_span = function_span(source, name)
        if not src_span:
            raise SystemExit(f"saturn: {name} not found")
        lifted = localise(source[src_span[0]:src_span[1]], display)
        span = function_span(text, name)
        if span:
            text = text[:span[0]] + lifted + text[span[1]:]
        else:
            # Absent here (buildMoonLocalArcPts): it goes straight before the
            # function Saturn keeps it beside.
            anchor = function_span(text, "updateMeasureVisualization")
            text = text[:anchor[0]] + lifted + "\n\n      " + text[anchor[0]:]
    if "const moonMeasureLines" not in text:
        if text.count(DECL_ANCHOR) != 1:
            raise SystemExit(f"{display}: measure state anchor not found once")
        text = text.replace(DECL_ANCHOR, DECL_ANCHOR + DECL, 1)
    if PUSH_NEW not in text:
        if text.count(PUSH_OLD) != 1:
            raise SystemExit(f"{display}: measure click anchor not found once")
        text = text.replace(PUSH_OLD, PUSH_NEW, 1)
    return text


def main() -> int:
    check = "--check" in sys.argv
    source = SOURCE.read_text(encoding="utf-8")
    stale = []
    for folder, display in TARGETS:
        path = ROOT / "planet_explorer" / folder / "viewer" / f"{folder}-viewer.js"
        text = path.read_text(encoding="utf-8")
        updated = port(text, source, display)
        if updated == text:
            print(f"  {folder:8s} unchanged")
            continue
        stale.append(folder)
        if not check:
            path.write_text(updated, encoding="utf-8")
        print(f"  {folder:8s} {'STALE' if check else 'ported'}")
    if check and stale:
        return 1
    print("uniform" if not stale else f"ported {len(stale)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
