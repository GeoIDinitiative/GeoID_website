#!/usr/bin/env python3
import csv, collections, re, sys

CSV_PATH = "/home/owen/GeoID_webpage/location_check/labels_compiled.csv"
rows = list(csv.DictReader(open(CSV_PATH)))

# Re-apply the runtime classifier so the audit mirrors what the viewer renders.
TECT_RE = re.compile(r"^(chasma|fossa|sulcus|rupes|dorsum|cavus|labyrinthus|linea|scopulus|tessera|graben)$")
FLUV_RE = re.compile(r"^(vallis|catena|flumen|rima)$")
VOLC_RE = re.compile(r"(?:cryo)?volcan|patera|caldera|lava|basalt|plume|eruption|vent", re.I)
for r in rows:
    t = (r.get("type") or "").strip().lower()
    if r.get("kind","").startswith("moon-of-"):
        if VOLC_RE.search(t): r["category"] = "volcanic"
        elif t in ("impact crater","crater"): r["category"] = "crater"
        elif FLUV_RE.match(t): r["category"] = "fluvial"
        elif TECT_RE.match(t): r["category"] = "tectonic"
        else: r["category"] = "moon-feature"

print(f"Total rows: {len(rows)}\n")

# 1) Type -> category mapping
type_to_cat = collections.defaultdict(lambda: collections.Counter())
for r in rows:
    type_to_cat[r["type"].strip().lower()][r["category"]] += 1

# Find types where the category is NOT unique
print("=" * 70)
print("TYPES WITH MIXED CATEGORY ASSIGNMENTS (potential mis-classifications)")
print("=" * 70)
mixed_types = []
for t, cats in sorted(type_to_cat.items()):
    if len(cats) > 1:
        mixed_types.append((t, cats))
        print(f"  type={t!r:40} categories={dict(cats)}")
print(f"  ({len(mixed_types)} mixed types)\n")

# 2) Category → color consistency
cat_to_color = collections.defaultdict(lambda: collections.Counter())
for r in rows:
    cat_to_color[r["category"]][r["color"]] += 1
print("=" * 70)
print("CATEGORY → COLOR (any category should have a single color)")
print("=" * 70)
for cat, colors in sorted(cat_to_color.items()):
    if len(colors) > 1:
        print(f"  category={cat!r:25} mixed colors={dict(colors)}")
    else:
        print(f"  {cat:25} -> {list(colors.keys())[0]}  ({sum(colors.values())} rows)")
print()

# 3) Volcanic feature check — every feature with type matching volcanic keywords
#    must be category=volcanic
print("=" * 70)
print("VOLCANIC SANITY — features whose type implies volcanic but category differs")
print("=" * 70)
volcanic_re = re.compile(r"(?:cryo)?volcan|patera|caldera|lava|basalt|plume|eruption|vent", re.I)
bad = []
for r in rows:
    if volcanic_re.search(r["type"]) and r["category"] != "volcanic":
        bad.append(r)
if not bad:
    print("  ✓ all volcanic-flavoured types correctly categorised as 'volcanic'")
else:
    for r in bad[:25]:
        print(f"  {r['name']:30} body={r['body']:15} type={r['type']:25} category={r['category']}")
    if len(bad) > 25: print(f"  ... +{len(bad)-25} more")
print()

# 4) Crater sanity — type=Crater or Impact crater must be category=crater
print("=" * 70)
print("CRATER SANITY — type Crater/Impact crater not in category=crater")
print("=" * 70)
bad = [r for r in rows if r["type"].strip().lower() in ("crater","impact crater") and r["category"] != "crater"]
if not bad:
    print("  ✓ all Crater/Impact crater types correctly categorised")
else:
    for r in bad[:25]: print(f"  {r['name']:30} body={r['body']:15} category={r['category']}")
print()

# 5) Description keyword consistency by TYPE
print("=" * 70)
print("DESCRIPTION KEYWORD CONSISTENCY")
print("(For each type, what does the description usually start with?)")
print("=" * 70)
desc_by_type = collections.defaultdict(list)
for r in rows:
    desc = (r["description"] or "").strip().lower()
    if desc: desc_by_type[r["type"].strip()].append(desc)

def starting_phrase(d, n=4):
    return " ".join(d.split()[:n])

for t in sorted(desc_by_type.keys()):
    descs = desc_by_type[t]
    if len(descs) < 5: continue
    starts = collections.Counter(starting_phrase(d, 5) for d in descs)
    most = starts.most_common(1)[0]
    coverage = most[1] / len(descs)
    flag = "" if coverage >= 0.8 else "  ⚠ inconsistent"
    print(f"  type={t!r:30} n={len(descs):4}  most-common-prefix={most[0]!r}  coverage={coverage:.0%}{flag}")

# 6) Empty fields per body
print()
print("=" * 70)
print("EMPTY-FIELD SUMMARY")
print("=" * 70)
empty = collections.Counter()
for r in rows:
    if not r["description"]: empty["description"] += 1
    if not r["type"]: empty["type"] += 1
    if not r["lat"]: empty["lat"] += 1
    if not r["lon"]: empty["lon"] += 1
    if not r["lod"]: empty["lod"] += 1
for k, n in sorted(empty.items()): print(f"  empty {k:15} : {n}")

# 7) Type taxonomy across bodies — which types appear on multiple bodies?
print()
print("=" * 70)
print("CROSS-BODY TYPE USAGE (types used on >1 body — should agree on category)")
print("=" * 70)
type_bodies = collections.defaultdict(set)
type_categories_per_body = collections.defaultdict(dict)
for r in rows:
    type_bodies[r["type"]].add(r["body"])
    type_categories_per_body[r["type"]][r["body"]] = r["category"]

shared = [t for t,bs in type_bodies.items() if len(bs) > 3 and t]
shared.sort(key=lambda t: -len(type_bodies[t]))
for t in shared[:15]:
    cats = collections.Counter(type_categories_per_body[t].values())
    print(f"  {t:30} bodies={len(type_bodies[t]):3}  categories={dict(cats)}")
