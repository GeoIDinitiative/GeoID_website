#!/usr/bin/env python3
"""Terrain-following route line for the interactive maps.

Straight segments between waypoints cut across ridges and ignore the
icefall's bends. This runs a least-cost A* over the same terrarium DEM the
contours use (z12, ~38 m/px over map bounds B), leg by leg between the
ROUTE waypoints read from game/config.js, and writes the concatenated,
simplified path to data/route_path.json as [[lat, lon], ...].

Cost per step = distance * (1 + (slope * 5)^2), with slopes over ~40
degrees effectively barred — the path bends around walls and through the
valley the way a climber would.

    python3 tools/make_route_path.py
"""
import heapq
import io
import json
import math
import re
import urllib.request

import numpy as np
from PIL import Image

B = {"W": 86.780, "E": 87.070, "N": 28.120, "S": 27.880}
Z = 12
OUT = "data/route_path.json"


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    r = math.radians(lat)
    y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
    return x, y


def fetch(z, x, y):
    url = f"https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
    with urllib.request.urlopen(url, timeout=30) as r:
        img = Image.open(io.BytesIO(r.read())).convert("RGB")
    a = np.asarray(img, dtype=np.float64)
    return a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768


def load_dem():
    x0f, y0f = tile_xy(B["W"], B["N"], Z)
    x1f, y1f = tile_xy(B["E"], B["S"], Z)
    x0, y0, x1, y1 = int(x0f), int(y0f), int(x1f), int(y1f)
    grid = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256))
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            grid[(ty - y0) * 256:(ty - y0 + 1) * 256,
                 (tx - x0) * 256:(tx - x0 + 1) * 256] = fetch(Z, tx, ty)
    ix0, iy0 = int(round((x0f - x0) * 256)), int(round((y0f - y0) * 256))
    ix1, iy1 = int(round((x1f - x0) * 256)), int(round((y1f - y0) * 256))
    return grid[iy0:iy1, ix0:ix1]


def waypoints():
    src = open("game/config.js").read()
    block = re.search(r"export const ROUTE = \[(.*?)\n\];", src, re.S).group(1)
    pts = re.findall(r"lat:\s*([\d.]+),\s*lon:\s*([\d.]+)", block)
    return [(float(a), float(b)) for a, b in pts]


def to_px(lat, lon, W, H):
    u = (lon - B["W"]) / (B["E"] - B["W"])
    v = (B["N"] - lat) / (B["N"] - B["S"])
    return min(W - 1, max(0, int(round(u * (W - 1))))), min(H - 1, max(0, int(round(v * (H - 1)))))


def to_ll(px, py, W, H):
    lon = B["W"] + px / (W - 1) * (B["E"] - B["W"])
    lat = B["N"] - py / (H - 1) * (B["N"] - B["S"])
    return lat, lon


def astar(dem, start, goal, m_per_px):
    H, W = dem.shape
    sx, sy = start
    gx, gy = goal
    NBR = [(-1, -1, 1.414), (0, -1, 1), (1, -1, 1.414), (-1, 0, 1),
           (1, 0, 1), (-1, 1, 1.414), (0, 1, 1), (1, 1, 1.414)]
    dist = {(sx, sy): 0.0}
    prev = {}
    pq = [(0.0, 0.0, sx, sy)]
    while pq:
        f, d, x, y = heapq.heappop(pq)
        if (x, y) == (gx, gy):
            break
        if d > dist.get((x, y), 1e18) + 1e-6:
            continue
        h0 = dem[y, x]
        for dx, dy, w in NBR:
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H):
                continue
            run = w * m_per_px
            slope = abs(dem[ny, nx] - h0) / run
            dh = dem[ny, nx] - h0
            if slope > 0.70:            # ~35 degrees: a wall, not a route.
                cost = run * 500
            else:
                # Slope-squared for steepness, PLUS a per-metre-of-height
                # charge: without it, DEM noise at 38 m/px offers "cheap"
                # shelves and the path zigzags up and down slopes for
                # nothing. Since the endpoints fix the net climb, charging
                # every metre up or down makes needless bumps pay double.
                cost = run * (1 + (slope * 8) ** 2) + abs(dh) * 9.0
            nd = d + cost
            if nd < dist.get((nx, ny), 1e18):
                dist[(nx, ny)] = nd
                prev[(nx, ny)] = (x, y)
                heapq.heappush(pq, (nd + math.hypot(gx - nx, gy - ny) * m_per_px, nd, nx, ny))
    path = [(gx, gy)]
    while path[-1] != (sx, sy):
        path.append(prev[path[-1]])
    return path[::-1]


def line_ok(dem, a, b, max_slope=0.60):
    """True if the straight pixel line a->b never crosses ground steeper
    than max_slope between consecutive samples."""
    n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1])))
    prev = None
    for i in range(n + 1):
        t = i / n
        x = int(round(a[0] + (b[0] - a[0]) * t))
        y = int(round(a[1] + (b[1] - a[1]) * t))
        h = dem[y, x]
        if prev is not None and abs(h - prev[0]) / max(prev[1], 1e-6) > max_slope:
            return False
        step = math.hypot((b[0] - a[0]) / n, (b[1] - a[1]) / n)
        prev = (h, step * 38.0)
    return True


def string_pull(path, dem):
    """Drop intermediate points wherever the direct line is safe — this is
    what removes the A* grid's staircase zigzags."""
    out = [path[0]]
    i = 0
    while i < len(path) - 1:
        j = min(i + 14, len(path) - 1)
        while j > i + 1 and not line_ok(dem, path[i], path[j]):
            j -= 1
        out.append(path[j])
        i = j
    return out


def chaikin(pts, passes=2):
    for _ in range(passes):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out.append((a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25))
            out.append((a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75))
        out.append(pts[-1])
        pts = out
    return pts


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    ax, ay = pts[0]
    bx, by = pts[-1]
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        num = abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax)
        den = math.hypot(bx - ax, by - ay) or 1
        d = num / den
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def main():
    dem = load_dem()
    H, W = dem.shape
    ground_w = (B["E"] - B["W"]) * 111320 * math.cos(math.radians((B["N"] + B["S"]) / 2))
    m_per_px = ground_w / W
    wps = waypoints()
    full = []
    for a, b in zip(wps, wps[1:]):
        leg = astar(dem, to_px(*a, W, H), to_px(*b, W, H), m_per_px)
        leg = string_pull(leg, dem)
        # No cosmetic smoothing: Chaikin cut corners WITHOUT validating
        # them, dragging the drawn line off the A*'s corridor and up the
        # slopes the search had paid to avoid. String-pull is the only
        # simplifier because it is the only one that checks the ground.
        leg = rdp(leg, 0.6)
        full.extend(leg if not full else leg[1:])
        print(f"leg {a} -> {b}: {len(leg)} pts")
    lls = [[round(la, 5), round(lo, 5)] for la, lo in (to_ll(x, y, W, H) for x, y in full)]
    json.dump(lls, open(OUT, "w"))
    print("wrote", OUT, len(lls), "points")


if __name__ == "__main__":
    main()
