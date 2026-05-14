#!/usr/bin/env python3
"""
Rebalance LOD tiers in each viewer's label-data.json so the surface-label
slider has a consistent, user-friendly graduation across all viewers:

    tier 1 (min)   top  1.5%   — only the most iconic landmarks
    tier 2         top  5%
    tier 3         top 10%     — standard slider position
    tier 4         top 35%
    tier 5         100%        — everything mapped

Each feature gets a notability score:

    score = TYPE_WEIGHT[type] + log10(km + 1) × SIZE_WEIGHT + FAME_BONUS[name]

where FAME_BONUS is a per-viewer whitelist of iconic features. The whitelist
guarantees that things like Olympus Mons, Hellas Planitia, Valles Marineris,
Tycho, Sputnik Planitia, etc. land in tier 1 regardless of how many small
named Terras and Regios exist.

Within each band, the original ordering (by score) is preserved.
"""
from __future__ import annotations
import json, math, re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Cumulative percentile cut-offs (tier 1 → tier 5).
TARGETS = [0.015, 0.05, 0.10, 0.35, 1.00]

# Multiplier on log10(km+1). 12 means a 600-km feature picks up ~33 score points
# from size alone, a 100-km feature ~24, a 10-km feature ~12.
SIZE_WEIGHT = 12.0

# Type weights — higher = more inherently notable. Patterns matched in order,
# first match wins. Anything unmatched falls into UNKNOWN_WEIGHT.
TYPE_WEIGHTS = [
    # 70+ — major impact basins, named oceans
    (r"^Oceanus\b",                                        85),
    (r"^Impact basin\b",                                   70),
    (r"^Canyon basin\b",                                   70),
    # 65 — large dark plains, defining seas/continents
    (r"^Mare\b",                                           68),
    (r"^Sinus\b",                                          55),
    (r"^Lacus\b",                                          45),
    (r"^Palus\b",                                          40),
    (r"^Promontorium\b",                                   50),
    # 60–65 — continents / regional plains / planar regions
    (r"^Terra\b",                                          65),
    (r"^Regio\b",                                          62),
    (r"^Region\b",                                         62),
    (r"^Planitia\b",                                       60),
    (r"^Planum\b",                                         55),
    (r"^Plateau\b",                                        55),
    (r"^Tectonic plateau\b",                               55),
    (r"^Volcanic plateau\b",                               55),
    (r"^Lava plateau\b",                                   55),
    (r"^Volcanic province\b",                              55),
    (r"^Volcanic highland\b",                              55),
    (r"^Ancient highland",                                 50),
    (r"^Polar (plateau|trough)\b",                         55),
    (r"^(South|North) polar plateau\b",                    55),
    (r"^Northern (plain|lowland)\b",                       55),
    (r"^Lowland plain\b",                                  55),
    (r"^Sedimentary plain\b",                              50),
    (r"^Lava plain\b",                                     50),
    (r"^Volcanic plain\b",                                 50),
    # 55 — Mountains, big volcanoes
    (r"^Montes\b",                                         62),
    (r"^Mons\b",                                           58),
    (r"^Tessera\b",                                        55),  # Venusian continent-like
    (r"^Shield volcano\b",                                 60),
    (r"^Ancient volcano\b",                                55),
    (r"^Volcanic edifice\b",                               52),
    (r"^Volcanic rise\b",                                  52),
    (r"^Volcanic caldera\b",                               48),
    (r"^Volcano\b",                                        55),
    # 50 — Canyons and chasms
    (r"^Chasma\b",                                         55),
    (r"^Canyon system\b",                                  60),
    (r"^Canyon\b",                                         52),
    (r"^Faulted canyon maze\b",                            45),
    (r"^Labyrinthus\b",                                    48),
    # 45 — Corona / patera (Venus, Io-style)
    (r"^Corona\b",                                         45),
    (r"^Patera\b",                                         40),
    (r"^Tholus\b",                                         40),
    (r"^Volcanic dome\b",                                  38),
    (r"^Farrum\b",                                         35),
    # 35–40 — Outflow channels and major valleys
    (r"^Outflow channel\b",                                42),
    (r"^Valley network\b",                                 40),
    (r"^Valley / clay-bearing region",                     45),
    (r"^Ancient valley\b",                                 35),
    (r"^Vallis\b",                                         35),
    (r"^Valley\b",                                         35),
    # 30 — Linear features, fossae, fractures
    (r"^Linea\b",                                          28),
    (r"^Fossa(e)?\b",                                      25),
    (r"^Fracture (system|zone|belt|trough system)\b",      25),
    (r"^Fissure system\b",                                 25),
    (r"^Sulcus\b",                                         28),
    (r"^Sulci\b",                                          28),
    (r"^Rima\b",                                           22),
    # Visible-from-Earth albedo features (historically named)
    (r"^Albedo Feature",                                   30),
    (r"^Macula\b",                                         32),
    # 20 — Scarps, ridges
    (r"^Rupes\b",                                          22),
    (r"^Scarp\b",                                          22),
    (r"^Dorsum\b",                                         18),
    (r"^Dorsa\b",                                          18),
    # 15 — Chaos, cavi, lingula, layered units, mensae, collis
    (r"^Chaos\b",                                          25),
    (r"^Cavus\b",                                          18),
    (r"^Mensa\b",                                          20),
    (r"^Lingula\b",                                        18),
    (r"^Collis\b",                                         18),
    (r"^Labes\b",                                          15),
    (r"^Serpens\b",                                        18),
    (r"^Unda\b",                                           18),
    (r"^Fluctus\b",                                        20),
    (r"^Layered mound\b",                                  18),
    # 10 — Catenae and crater chains
    (r"^Catena\b",                                         15),
    (r"^Crater (chain|cluster)\b",                         15),
    # Faculae (Mercury — bright spots)
    (r"^Facula\b",                                         25),
    # Craters (default for the long tail)
    (r"^Crater\b",                                         12),
    (r"^Craters\b",                                        12),
    # Landing sites & mission landmarks
    (r"^Mars rover landing site",                          16),
    (r"^Mars landing site",                                14),
    (r"^Future habitat candidate",                         8),
    (r"^Astronaut-named features",                         10),
    (r"^Statio\b",                                         18),
]
UNKNOWN_WEIGHT = 20

DIM_RE = re.compile(r"~?\s*([\d.]+)\s*km")

# ── Fame whitelist ─────────────────────────────────────────────────────────
# Per-viewer dicts mapping feature name → bonus score.
# +250 → guaranteed tier 1 (most iconic)
# +120 → tier 1 or top of tier 2
# +60  → solidly tier 2 / 3 (notable but not single-glance famous)
FAME_BONUS = {
    "mars": {
        # ── 250: solar-system-class landmarks ──
        **dict.fromkeys([
            "Olympus Mons", "Valles Marineris", "Hellas Planitia", "Hellas",
            "Tharsis Montes", "Tharsis", "Arsia Mons", "Pavonis Mons", "Ascraeus Mons",
            "Elysium Mons", "Alba Mons", "Olympus Tholus",
            "Gale", "Jezero",
            "Argyre Planitia", "Utopia Planitia", "Isidis Planitia",
            "Chryse Planitia", "Acidalia Planitia", "Amazonis Planitia",
            "Arcadia Planitia", "Elysium Planitia",
            "Planum Boreum", "Planum Australe",
            "Curiosity", "Perseverance", "Spirit", "Opportunity",
        ], 250),
        # ── 120: famous but second-tier ──
        **dict.fromkeys([
            "Tharsis Bulge", "Solis Planum", "Sinai Planum", "Syria Planum",
            "Hesperia Planum", "Lunae Planum",
            "Eos Chasma", "Coprates Chasma", "Melas Chasma",
            "Ophir Chasma", "Candor Chasma", "Tithonium Chasma", "Ius Chasma",
            "Noctis Labyrinthus", "Kasei Valles", "Maja Valles", "Ares Vallis",
            "Mawrth Vallis", "Nirgal Vallis", "Nanedi Valles",
            "Apollinaris Mons", "Hecates Tholus", "Albor Tholus",
            "Holden", "Eberswalde", "Mojave", "Endeavour", "Endurance",
            "Erebus", "Victoria", "Greeley", "Korolev",
            "Schiaparelli", "Huygens", "Lowell", "Mariner", "Newton",
            "InSight", "Phoenix", "Viking 1", "Viking 2",
            "Tianwen-1", "Zhurong", "Pathfinder", "Sojourner",
            "Beagle 2", "ExoMars",
            "Argyre", "Tempe Terra", "Arabia Terra", "Noachis Terra",
            "Terra Cimmeria", "Terra Sirenum", "Terra Sabaea", "Margaritifer Terra",
        ], 120),
    },

    "moon": {
        **dict.fromkeys([
            # Apollo landing sites (statios + nearby named features)
            "Tranquility Base", "Statio Tianhe", "Hadley", "Hadley Rille",
            "Fra Mauro", "Descartes", "Taurus-Littrow",
            # Iconic maria
            "Mare Tranquillitatis", "Mare Imbrium", "Mare Serenitatis",
            "Mare Crisium", "Mare Fecunditatis", "Mare Nubium",
            "Mare Humorum", "Mare Frigoris", "Mare Vaporum",
            "Oceanus Procellarum",
            # Iconic ray craters
            "Tycho", "Copernicus", "Kepler", "Aristarchus",
            "Plato", "Clavius",
        ], 250),
        **dict.fromkeys([
            "Mare Cognitum", "Mare Insularum", "Mare Marginis", "Mare Australe",
            "Mare Smythii", "Mare Orientale", "Mare Moscoviense", "Mare Ingenii",
            "Mare Nectaris", "Mare Spumans", "Mare Undarum",
            "Sinus Aestuum", "Sinus Iridum", "Sinus Medii", "Sinus Roris",
            "Sinus Honoris", "Sinus Asperitatis",
            "Montes Apenninus", "Montes Caucasus", "Montes Alpes",
            "Montes Carpatus", "Montes Cordillera", "Montes Riphaeus",
            "Montes Pyrenaeus", "Montes Haemus", "Montes Taurus",
            "Montes Jura", "Montes Carpatus",
            "Tsiolkovsky", "Aristoteles", "Eratosthenes", "Theophilus",
            "Cyrillus", "Catharina", "Posidonius", "Bullialdus",
            "Maginus", "Bailly", "Petavius", "Langrenus",
            "Janssen", "Mendel", "Schickard", "Grimaldi", "Stevinus",
            "Vallis Schröteri", "Vallis Alpes", "Vallis Bouvard",
            "Rima Hadley", "Rima Ariadaeus", "Rima Hyginus",
            "Rupes Recta", "Rupes Altai",
            "South Pole-Aitken", "Aitken",
        ], 120),
    },

    "mercury": {
        **dict.fromkeys([
            "Caloris Planitia", "Caloris", "Rachmaninoff",
            "Beethoven", "Tolstoj", "Goethe", "Rembrandt", "Mozart",
            "Discovery Rupes", "Vostok Rupes",
        ], 250),
        **dict.fromkeys([
            "Sobkou Planitia", "Borealis Planitia", "Suisei Planitia",
            "Budh Planitia", "Tir Planitia", "Odin Planitia",
            "Bach", "Tolkien", "Apollodorus", "Praxiteles", "Munch",
            "Raphael", "Strindberg", "Schubert", "Brahms",
            "Hero Rupes", "Santa Maria Rupes", "Beagle Rupes",
        ], 120),
    },

    "venus": {
        **dict.fromkeys([
            # Continents
            "Aphrodite Terra", "Ishtar Terra", "Lada Terra",
            # Highest mountain
            "Maxwell Montes",
            # Famous volcanoes
            "Maat Mons", "Sif Mons", "Gula Mons", "Sapas Mons", "Theia Mons",
            # Large coronae / plana
            "Artemis Corona", "Lakshmi Planum",
            # Largest crater
            "Mead",
        ], 250),
        **dict.fromkeys([
            "Sedna Planitia", "Atalanta Planitia", "Lavinia Planitia",
            "Niobe Planitia", "Helen Planitia", "Aino Planitia",
            "Diana Chasma", "Dali Chasma", "Devana Chasma",
            "Hecate Chasma", "Parga Chasma",
            "Beta Regio", "Phoebe Regio", "Eistla Regio", "Bell Regio",
            "Themis Regio", "Atla Regio", "Tellus Regio", "Asteria Regio",
            "Alpha Regio", "Ovda Regio", "Thetis Regio",
            "Sacajawea Patera", "Colette Patera",
            "Cleopatra", "Mona Lisa", "Sappho Patera",
        ], 120),
    },

    "pluto": {
        **dict.fromkeys([
            "Tombaugh Regio", "Sputnik Planitia", "Cthulhu Macula",
            "Norgay Montes", "Hillary Montes",
        ], 250),
        **dict.fromkeys([
            "Burney", "Wright Mons", "Piccard Mons",
            "Voyager Terra", "Vega Terra", "Lowell Regio", "Hayabusa Terra",
            "Pioneer Terra", "Venera Terra", "Krun Macula", "Belton Regio",
            "Al-Idrisi Montes", "Tartarus Dorsa",
            "Sleipnir Fossa", "Hyecho Palus",
        ], 120),
    },
}

def parse_km(text):
    if not text:
        return 0.0
    m = DIM_RE.search(str(text))
    if not m:
        return 0.0
    try:
        return float(m.group(1))
    except ValueError:
        return 0.0

def type_weight(t: str) -> int:
    if not t:
        return UNKNOWN_WEIGHT
    for pat, weight in TYPE_WEIGHTS:
        if re.search(pat, t, flags=re.IGNORECASE):
            return weight
    return UNKNOWN_WEIGHT

def score(entry, fame_table):
    name = (entry.get("name") or "").strip()
    t    = entry.get("type") or ""
    km   = parse_km(entry.get("dimension"))
    return (
        type_weight(t)
        + math.log10(km + 1) * SIZE_WEIGHT
        + fame_table.get(name, 0)
    )

def assign_lods(data, viewer):
    fame_table = FAME_BONUS.get(viewer, {})
    ordered = sorted(data, key=lambda e: -score(e, fame_table))
    n = len(ordered)
    if n == 0:
        return data
    cutoffs = [math.ceil(n * t) for t in TARGETS]
    for idx, entry in enumerate(ordered):
        for lod, cut in enumerate(cutoffs, start=1):
            if idx < cut:
                entry["lod"] = lod
                break
    return data

VIEWERS = [
    ("planet_explorer/mars/viewer/label-data.json",    "mars"),
    ("planet_explorer/moon/viewer/label-data.json",    "moon"),
    ("planet_explorer/venus/viewer/label-data.json",   "venus"),
    ("planet_explorer/mercury/viewer/label-data.json", "mercury"),
    ("planet_explorer/pluto/viewer/label-data.json",   "pluto"),
]

def main():
    for rel, name in VIEWERS:
        path = ROOT / rel
        if not path.exists():
            print(f"skip {rel} (missing)")
            continue
        data = json.loads(path.read_text())
        assign_lods(data, name)
        path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
        counts = Counter(d.get("lod") for d in data)
        n = len(data)
        cum = 0
        print(f"\n{name.upper()}: {n} labels")
        for lod in sorted(k for k in counts.keys() if k is not None):
            c = counts[lod]
            cum += c
            print(f"  lod {lod}: {c:5d}  cumulative {cum/n:5.1%}")

if __name__ == "__main__":
    main()
