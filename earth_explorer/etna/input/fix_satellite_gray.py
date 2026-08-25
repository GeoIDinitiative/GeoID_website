#!/usr/bin/env python3
"""
Detect and replace gray (no-data) patches in satellite.jpg with ocean blue.

ESRI World Imagery at Z=14 serves uniform gray tiles (~RGB 185-195) for
offshore areas without high-resolution coverage. These appear as a gray
rectangle over the Ionian Sea in the bottom-right of the composite.

Strategy:
  1. Divide image into 128×128 px cells (one per source Z=14 tile, 2× downsampled).
  2. Mark cells where mean brightness is 160-220 AND colour spread < 20 as "gray".
  3. Sample median ocean colour from adjacent blue-dominant cells.
  4. Fill gray cells with ocean blue + gentle depth gradient + per-cell noise.
  5. Feather the land/sea boundary to avoid hard edges.
"""

import os
import numpy as np
from PIL import Image

IMG_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), '..', 'viewer', 'assets', 'satellite.jpg')
)

# Gray-tile detection thresholds
GRAY_BRIGHTNESS_MIN = 155
GRAY_BRIGHTNESS_MAX = 220
GRAY_SATURATION_MAX = 18   # max channel spread (R-G, G-B, etc.) to count as gray

CELL = 128   # px — one Z=14 tile at 2× downsample


def is_gray_cell(patch):
    """True when a 128×128 patch is an ESRI 'no imagery' gray tile."""
    f = patch.astype(np.float32)
    mean = f.mean(axis=(0, 1))          # shape (3,)
    brightness = mean.mean()
    saturation = mean.max() - mean.min()
    return (GRAY_BRIGHTNESS_MIN < brightness < GRAY_BRIGHTNESS_MAX
            and saturation < GRAY_SATURATION_MAX)


def main():
    print(f'[fix] Loading {IMG_PATH} …')
    img = Image.open(IMG_PATH).convert('RGB')
    arr = np.array(img, dtype=np.uint8)
    H, W = arr.shape[:2]
    print(f'[fix] Size: {W}×{H}')

    GX = W // CELL   # grid columns
    GY = H // CELL   # grid rows

    # ── Step 1: build gray mask ───────────────────────────────────────────────
    gray = np.zeros((GY, GX), dtype=bool)
    for gy in range(GY):
        for gx in range(GX):
            patch = arr[gy*CELL:(gy+1)*CELL, gx*CELL:(gx+1)*CELL]
            gray[gy, gx] = is_gray_cell(patch)

    n_gray = int(gray.sum())
    print(f'[fix] Gray cells: {n_gray}/{GX*GY} ({100*n_gray/(GX*GY):.1f}%)')
    if n_gray == 0:
        print('[fix] No gray tiles — image is already clean. Nothing to do.')
        return

    # Report extent
    gy_idx, gx_idx = np.where(gray)
    print(f'[fix] Gray rows  {gy_idx.min()}–{gy_idx.max()} of {GY}')
    print(f'[fix] Gray cols  {gx_idx.min()}–{gx_idx.max()} of {GX}')

    # ── Step 2: sample ocean colour from adjacent non-gray water cells ────────
    rng = np.random.default_rng(42)
    ocean_samples = []
    for gy_i, gx_i in zip(gy_idx, gx_idx):
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            ny, nx = gy_i + dy, gx_i + dx
            if 0 <= ny < GY and 0 <= nx < GX and not gray[ny, nx]:
                patch = arr[ny*CELL:(ny+1)*CELL, nx*CELL:(nx+1)*CELL]
                mean = patch.astype(float).mean(axis=(0, 1))
                # Only include visibly blue-dominant (ocean) pixels
                if mean[2] > mean[0] + 5 and mean[2] > mean[1] - 5:
                    ocean_samples.append(mean)

    if ocean_samples:
        ocean_base = np.median(ocean_samples, axis=0)
    else:
        # Fallback: deep Mediterranean blue
        ocean_base = np.array([28.0, 50.0, 90.0])
    print(f'[fix] Ocean base colour: RGB({ocean_base[0]:.0f}, '
          f'{ocean_base[1]:.0f}, {ocean_base[2]:.0f})')

    # ── Step 3: fill gray cells ───────────────────────────────────────────────
    result = arr.copy().astype(np.float32)
    gy_max = float(gy_idx.max()) if gy_idx.size else 1
    gx_max = float(gx_idx.max()) if gx_idx.size else 1

    for gy_i, gx_i in zip(gy_idx, gx_idx):
        # Depth gradient: cells in the SE (bottom-right) are slightly darker
        depth = 0.4 * (gy_i / gy_max) + 0.4 * (gx_i / gx_max)
        scale = 1.0 - 0.20 * depth       # max 20% darker at far SE
        colour = ocean_base * scale       # (3,)

        # Per-cell coherent noise (± 4 DN)
        noise = rng.normal(0, 4, (CELL, CELL, 3))
        patch_fill = np.clip(colour + noise, 0, 255)

        py, px = gy_i * CELL, gx_i * CELL
        result[py:py+CELL, px:px+CELL] = patch_fill

    # ── Step 4: feather boundary (non-gray cells adjacent to gray) ────────────
    FEATHER = 20   # pixel blend width inside the non-gray side

    # Build a float "distance to nearest gray cell" map at cell resolution,
    # then expand to pixel resolution and feather.
    from scipy.ndimage import distance_transform_edt
    # distance_transform_edt: distance of each non-gray cell to nearest gray cell
    dist_cells = distance_transform_edt(~gray)          # 0 at gray cells, >0 outside
    # Expand to pixel space (nearest-cell)
    dist_px = np.repeat(np.repeat(dist_cells, CELL, axis=0), CELL, axis=1) * CELL
    dist_px = dist_px[:H, :W]                           # trim to exact image size

    # Alpha = 0 at boundary (blend toward ocean), 1 far from boundary
    alpha = np.clip(dist_px / FEATHER, 0, 1)[:, :, np.newaxis]  # (H,W,1)

    orig_f = arr.astype(np.float32)
    result = alpha * orig_f + (1 - alpha) * result
    result = np.clip(result, 0, 255).astype(np.uint8)

    # ── Step 5: save ─────────────────────────────────────────────────────────
    out = Image.fromarray(result)
    out.save(IMG_PATH, 'JPEG', quality=88, optimize=True, progressive=True)
    size_mb = os.path.getsize(IMG_PATH) / 1e6
    print(f'[fix] Saved → {IMG_PATH}  ({size_mb:.1f} MB)')
    print('[fix] Done.')


if __name__ == '__main__':
    main()
