"""Product names for things the Qt app names after the work that produced them.

The Signal Processing page carries a block written for a specific thesis —
peak CSVs correlated against earthquake and volcanic catalogues, a wavelet
suite, SNR and joint analysis. The *functions* are general geophysical signal
work and belong to the Research Hub as its own; only the naming was personal.
So the hub renames them at extraction: "Thesis Analysis Toolkit" becomes
"Event Correlation Toolkit", which is what it does — correlate signal peaks
against event catalogues.

Applied by `qt-layout.py` and `qt-extract.py` as they read `app_qt.py`, so
re-running either keeps the product naming and the desktop app is untouched.

**"Hypothesis" contains "thesis".** A plain substring replace turns "Hypothesis
Tests" — an ordinary statistics term on the Statistics page — into nonsense.
Every rule here is therefore anchored, and `rename_text` guards the word
explicitly. Do not replace this with a blanket `.replace("thesis", …)`.
"""

from __future__ import annotations

import re

# Whole labels, matched exactly first so the phrasing stays deliberate.
LABELS = {
    "Thesis Analysis Toolkit": "Event Correlation Toolkit",
    "Load Thesis Inputs": "Load Event Inputs",
    "Run Thesis Suite": "Run Full Suite",
    "Full Thesis Pipeline": "Full Event Pipeline",
    "Full Thesis Suite": "Full Event Suite",
}

# Phrases inside longer sentences.
PHRASES = [
    (re.compile(r"\bthesis function module\b", re.I), "analysis module"),
    (re.compile(r"\bprimary Thesis and GALES toolkits\b"),
     "primary Event Correlation and GALES toolkits"),
    (re.compile(r"\bthesis (analysis )?(toolkit|suite|workflow|pipeline)\b", re.I),
     r"event correlation \2"),
    (re.compile(r"\bthesis (inputs|candidates|modules|plotting|results)\b", re.I),
     r"event \1"),
]

# Variable names, which are also the keys wiring.js matches on.
VAR_PREFIX = ("thesis_", "btn_thesis_")


def rename_text(value):
    """A user-visible string, with the personal naming replaced."""
    if not isinstance(value, str) or not value:
        return value
    if value in LABELS:
        return LABELS[value]
    # "Hypothesis" is not "thesis"; leave anything that only matches inside it.
    if not re.search(r"(?<!hypo)thesis", value, re.I):
        return value
    out = value
    for pattern, replacement in PHRASES:
        out = pattern.sub(replacement, out)
    return out


def rename_var(name):
    """A widget variable name. `thesis_peaks_root` -> `event_peaks_root`."""
    if not isinstance(name, str):
        return name
    if name.startswith("btn_thesis_"):
        return "btn_event_" + name[len("btn_thesis_"):]
    if name.startswith("thesis_"):
        return "event_" + name[len("thesis_"):]
    return name


def rename_tree(node):
    """Walk an extracted tree in place, renaming text and variables."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ("text", "title", "subtitle", "label", "placeholder", "tip"):
                node[key] = rename_text(value)
            elif key == "var":
                node[key] = rename_var(value)
            elif key in ("items", "headers", "buttons") and isinstance(value, list):
                # "buttons" carries plain label strings — leaving it out kept
                # "Load Thesis Inputs" in qt-spec.json while the rendered tree
                # said "Load Event Inputs", and the completion appended the old
                # name as a disabled ghost beside its renamed, wired twin.
                node[key] = [rename_text(v) for v in value]
            else:
                rename_tree(value)
    elif isinstance(node, list):
        for item in node:
            rename_tree(item)
    return node
