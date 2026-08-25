# Flight Tile-Streaming — Gold-Standard Design

Goal: maximum detail around the ship, streamed dynamically and seamlessly,
with **no artificial level caps** — bounded only by what the server serves and
what the transport can carry.

## 0. Measured ground truth (everything here was measured, not assumed)

| Constraint | Value |
|---|---|
| Transport | HTTP/1.1, ~6 connections/host, **~15 tiles/s sustained**; SW-cache hits ~5 ms |
| Server pyramid | **L12 max** (5 m/px native; L13+ = HTTP 400 planet-wide). Non-monotonic regional holes (dead L7/L8/L9 under alive L10–L12); health drifts over hours |
| Screen density at flight scales | ~64–130 px/° |
| Focus canvas | resized to ~400–512 px/tile → ≥ native density over its small bbox |
| Surround canvas | 4096×2048 over 6–40° → 100–680 px/° — **exceeds screen density** for everything beyond the focus window |
| Sustainability law | round_tiles × speed / span ≤ share × 15 tiles/s, else queues grow forever |
| Memory ceiling | ~350 MB GPU; tile cache 768 entries LRU (~200 MB off-heap) |

**The key insight** that makes "maximum detail" cheap: beyond the focus
window, the *surround canvas already out-resolves the screen*. Tiles finer
than its base level drawn into it look **fully sharp on screen**. So the
gradient the eye wants does not need native-density canvases everywhere —
it needs finer *tiles* progressively drawn into the existing surround.

## 1. The architecture: three roles, one scheduler

```
┌────────────────────────────────────────────────────────────┐
│  RING A — focus window (focus canvas, native density)      │
│  byAlt level (native L12 low), ship-anchored,              │
│  speed-scaled span. Unchanged from today.                  │
├────────────────────────────────────────────────────────────┤
│  RING B — enhancement rings (drawn INTO the surround       │
│  canvas, mixed levels, coarse-under-fine paint guard):     │
│    B1: ≤ 1.5× focus span  → byAlt − 1                      │
│    B2: ≤ 3×   focus span  → byAlt − 2                      │
│  Progressive: painted only with connection capacity RING A │
│  is not using. Eliminates the current L12→L6 cliff.        │
├────────────────────────────────────────────────────────────┤
│  RING C — surround base (as today): finest level whose     │
│  pad-free grid over ship±horizon fits 300 tiles.           │
└────────────────────────────────────────────────────────────┘
        all fed by ONE priority scheduler over 6 connections
```

### The unified scheduler (replaces the two independent fetch loops)
Single priority queue, strict ordering, 6 global in-flight:
1. **P0 — Ring A round** (center-out, as now)
2. **P1 — Ring B1 upgrades**, distance-to-ship ascending, heading-biased
3. **P2 — Ring B2 upgrades**, same ordering
4. **P3 — Ring C base fill** (center-out)
5. **P4 — heading prefetch**: extend B1/B2 one ring-width along the ground
   velocity vector (computed from successive `_flightShipGround()` samples —
   no flightsim change needed). Behind the ship: half priority, never zero
   (U-turns stay covered).

Demand control falls out of the ordering: Ring A's speed-scaled budget bounds
P0; everything else consumes only leftover capacity. Hover/slow ⇒ capacity
flows automatically into B1/B2 ⇒ the whole vicinity sharpens toward native.
Cruise ⇒ A stays complete, B fills what it can, C never regresses.

## 2. What "no capping" means here — precisely

- Ring A requests the **native altitude band** (≤10 km → L12 …) — already in.
- Rings B request byAlt−1/−2 — *relative* to native, not capped constants.
- The only ceilings left are the server's 400s and the level-exact dead-region
  memory (6-strike, unanimous-failure, 5-min TTL) which skips *proven-dead*
  rungs per region — that is discovery, not capping.

## 3. Seamlessness inventory (already in place, retained)

tone-gain solve per level ▪ seam-free integer-edge compositing ▪ LRU cache +
request coalescing (share NO caller's abort signal) ▪ instant repaint from
cache on rebuild ▪ quantized, jitter-proof keys ▪ retire-don't-abort ▪
stranding-proof pause guard ▪ ancestor fallback floor target−4.

## 4. Phases (each independently shippable + verifiable)

**P1 — Unified scheduler.** Merge the surround drain into the focus drain as
priority classes. *Accept:* per-class throughput measurable; Ring A latency
unchanged (round completion time ±10%); total inflight never > 6.

**P2 — Enhancement rings.** Port the coarse-under-fine paint-guard cell
tracker to the surround canvas; add B1/B2 ring sets recomputed on surround
rebuild (same quantized-key stability). *Accept:* at hover 8 km over Jezero,
the area just beyond the focus window reaches ≥ byAlt−1 within 20 s; the
L12→base cliff is replaced by ≥ 2 intermediate steps; zero paint-order
artifacts (boundary-step metric ≤ 2 at ring seams).

**P3 — Heading prefetch.** Velocity-biased extension of B1/B2. *Accept:* at
cruise, the ground entering the view ahead is already ≥ byAlt−2 on arrival
(sampled over a 1° leg); behind-ship coverage unchanged.

**P4 — Field validation contract.** A standing `window.__ringProbe()` with
per-ring {level, fill, queue} + the acceptance thresholds above, and a
5-minute real-tab checklist (visible tab, real rAF, mouse input) — because
pane-green has twice failed to predict field-green on this subsystem.

## 5. Explicitly rejected (relearned traps — do not resurrect)

- Per-tile mesh quadtree in flight (drowned the old fork; canvas rings achieve
  the visual result within budget).
- Any monotonic branch-cap consulted at fetch time.
- Any bbox handed to `_getFocusTileRange` without recomputing the ±pad growth.
- Any shared fetch cancellable by a single caller.
- Any politeness gate that assumes the focus round ever idles in flight.
- Level caps by speed (dulls the picture); window scaling is the lever.

## 6. Honest limits that remain after all phases

- Fresh-region first visit at cruise: B rings trail the ship by seconds —
  progressive sharpening, never blankness (C + base underneath).
- Regions whose CTX tops out at L10/L11: native there IS L10/L11.
- 15 tiles/s is the roof for everything, forever, on this transport.
