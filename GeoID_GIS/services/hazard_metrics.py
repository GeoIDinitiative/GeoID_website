"""The validation arithmetic every hazard bake shares, in Python.

This is `viewer/gis/validation.js` transcribed, not reinvented: the page
computes ROC/AUC and the confusion matrix for a map a user validates in the
GUI, and the bakes compute the same numbers offline for the maps GeoHUB
publishes. Two implementations of one formula drift unless something holds them
equal, so `hazard-metrics.test.mjs` runs both over the same fixtures and fails
on the fourth decimal.

Pure Python on purpose (lists in, dict out, no numpy): the arithmetic is the
thing a reader checks, and a confusion matrix written out can be read against
a hand count.

    pairs = [(score, positive), ...]
    confusion(pairs, threshold)  -> tp fp tn fn accuracy precision recall f1 kappa
    roc_auc(pairs)               -> AUC with tied scores moving the curve once
    youden(pairs)                -> the threshold at the ROC's corner
    report(pairs, threshold)     -> all of the above, the shape the hub reads
"""
import json
import sys


def _round(v):
    return None if v is None else round(v, 4)


def _clean(pairs):
    out = []
    for score, positive in pairs:
        try:
            s = float(score)
        except (TypeError, ValueError):
            continue
        if s != s or s in (float("inf"), float("-inf")):
            continue
        out.append((s, bool(positive)))
    return out


def confusion(pairs, threshold):
    """Counts and rates at one threshold: predicted positive is score >= threshold.

    Accuracy alone is a liar when most of a map is "no" -- a model that says no
    everywhere scores 0.97 on a 3% positive class -- so precision, recall, F1
    and Cohen's kappa travel with it, and an undefined ratio is None rather
    than a zero that reads as a measurement.
    """
    tp = fp = tn = fn = 0
    for score, positive in _clean(pairs):
        predicted = score >= threshold
        if positive and predicted:
            tp += 1
        elif positive:
            fn += 1
        elif predicted:
            fp += 1
        else:
            tn += 1
    n = tp + fp + tn + fn
    if not n:
        return {"ok": False, "message": "no comparable observations"}
    accuracy = (tp + tn) / n
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = (2 * precision * recall / (precision + recall)
          if precision is not None and recall is not None and precision + recall else None)
    expected = ((tp + fn) * (tp + fp) + (tn + fp) * (tn + fn)) / (n * n)
    kappa = None if expected == 1 else (accuracy - expected) / (1 - expected)
    return {
        "ok": True, "threshold": threshold, "n": n, "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "accuracy": _round(accuracy), "precision": _round(precision), "recall": _round(recall),
        "f1": _round(f1), "kappa": _round(kappa),
        "specificity": _round(tn / (tn + fp) if tn + fp else None),
    }


def roc(pairs):
    """ROC points and the trapezoid area under them.

    Tied scores are grouped and move the curve ONCE, diagonally: a classified
    map has five values, and stepping through a tie one point at a time would
    credit the model with a ranking inside its own classes that it never made.
    """
    rows = sorted(_clean(pairs), key=lambda r: -r[0])
    positives = sum(1 for _, p in rows if p)
    negatives = len(rows) - positives
    if not positives or not negatives:
        return {"ok": False, "auc": None, "points": [], "positives": positives, "negatives": negatives,
                "message": "ROC needs both outcomes"}
    points = [(0.0, 0.0, float("inf"))]
    tp = fp = 0
    auc = 0.0
    prev_f = prev_t = 0.0
    i = 0
    while i < len(rows):
        score = rows[i][0]
        while i < len(rows) and rows[i][0] == score:
            if rows[i][1]:
                tp += 1
            else:
                fp += 1
            i += 1
        tpr = tp / positives
        fpr = fp / negatives
        auc += (fpr - prev_f) * (tpr + prev_t) / 2
        points.append((fpr, tpr, score))
        prev_f, prev_t = fpr, tpr
    return {"ok": True, "auc": _round(auc), "points": points,
            "positives": positives, "negatives": negatives}


def roc_auc(pairs):
    return roc(pairs)["auc"]


def youden(pairs):
    """The threshold that maximises TPR - FPR: the ROC's corner."""
    r = roc(pairs)
    if not r["ok"]:
        return None
    best = None
    for fpr, tpr, score in r["points"]:
        if score == float("inf"):
            continue
        j = tpr - fpr
        if best is None or j > best[0]:
            best = (j, score)
    return best[1] if best else None


def report(pairs, threshold, threshold_rule):
    """Everything the Analysis Hub shows for one map, at one stated threshold.

    `threshold_rule` is said in words beside the numbers because a confusion
    matrix without its threshold cannot be compared with anything.
    """
    r = roc(pairs)
    c = confusion(pairs, threshold)
    out = {k: c.get(k) for k in ("n", "tp", "fp", "tn", "fn", "accuracy", "precision",
                                 "recall", "f1", "kappa", "specificity")}
    out.update({"auc": r["auc"], "threshold": threshold, "threshold_rule": threshold_rule,
                "positives": r["positives"], "negatives": r["negatives"]})
    return out


"""Where the numbers go.

Each validator writes ONE fragment, `data/global/hazard-validation/<id>.json`,
and the combined `data/global/hazard-validation.json` -- the file the Analysis
Hub's Models tab reads -- is rebuilt from every fragment on each write. One
fragment per map means two validators run side by side cannot overwrite each
other's entry, and a map re-validated replaces only itself.

An entry is:
    id, name, hazard, product        what map, and which file or layer it is
    model {method, parameters, inputs, grid}
    validation {holdout, events, report(...) fields, extra}
    limits [..], script, generated
"""
import datetime
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = os.path.join(ROOT, "data", "global", "hazard-validation")
OUT_FILE = os.path.join(ROOT, "data", "global", "hazard-validation.json")

# The order the hub lists them in: the maps GeoHUB publishes, the flood tiers first.
ORDER = ["flood-susceptibility", "flood-susceptibility-fine", "flood-susceptibility-wales", "landslide-susceptibility", "cyclone-risk",
         "seismic-risk", "volcanic-risk", "volcanic-risk-holocene"]


def write_entry(entry, root=None):
    out_dir = os.path.join(root, "data", "global", "hazard-validation") if root else OUT_DIR
    out_file = os.path.join(root, "data", "global", "hazard-validation.json") if root else OUT_FILE
    if not entry.get("id"):
        raise ValueError("an entry needs an id")
    entry = dict(entry)
    entry.setdefault("generated", datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, entry["id"] + ".json"), "w") as f:
        json.dump(entry, f, indent=1)
    entries = []
    for name in sorted(os.listdir(out_dir)):
        if name.endswith(".json"):
            with open(os.path.join(out_dir, name)) as f:
                entries.append(json.load(f))
    rank = {k: i for i, k in enumerate(ORDER)}
    entries.sort(key=lambda e: (rank.get(e["id"], len(ORDER)), e["id"]))
    tmp = out_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"about": "Validation of every hazard map GeoHUB publishes, against held-out "
                            "historical events. Built by GeoID_GIS/services/hazard_metrics.py; "
                            "methods in GeoID_GIS/docs/notes/hazards.md.",
                   "maps": entries}, f, indent=1)
    os.replace(tmp, out_file)
    return out_file


if __name__ == "__main__":
    # The cross-implementation check: `hazard-metrics.test.mjs` pipes a fixture
    # in and compares this answer with validation.js's.
    fixture = json.load(sys.stdin)
    out = []
    for case in fixture:
        pairs = [(p["score"], p["positive"]) for p in case["pairs"]]
        r = roc(pairs)
        c = confusion(pairs, case["threshold"])
        out.append({"auc": r["auc"], "confusion": c, "youden": youden(pairs)})
    json.dump(out, sys.stdout)
