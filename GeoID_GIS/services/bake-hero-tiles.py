#!/usr/bin/env python3
"""Bake the planet viewers' hero-tile backgrounds: an oblique shot of each body.

The hero tile used to be a round icon beside the planet's name. The icons are
a different picture of the same thing the globe behind them already is, and at
4.9rem they say nothing the word does not. The tile now carries an oblique view
of that body's OWN surface instead, and the name sits on it.

The shots are RENDERED FROM THE VIEWERS THEMSELVES rather than fetched. Three
reasons, in order of how much they matter:

  * they are the same basemaps the globe wears, so a tile cannot come to
    describe a map the page no longer shows;
  * the licence question is already answered — these are the textures the site
    ships and credits;
  * nobody has to find ten oblique photographs, four of which are of planets
    with no surface to photograph.

Run it against a served copy of the site (`python3 serve.py`, then
`python3 GeoID_GIS/services/bake-hero-tiles.py`). It drives headless Chrome
over CDP — the same hand-rolled WebSocket the smoke test uses, no puppeteer
and no chromium download — poses each viewer's own camera, and captures the
CANVAS rather than the screen, so no panel, label or cursor can get into a
tile. Re-run it after a basemap changes; it is idempotent and overwrites.

The composition is one rule with per-body numbers (SHOTS below):

    camera  = centre + u * (R * alt)
    target  = centre + (u cos θ + w sin θ) * R

so the camera stands `alt` body-radii out and looks θ degrees around the curve.
θ near 55° puts the horizon across the upper frame with sky above it — an
oblique — where θ = 0 would be a flat nadir view and θ = 90° a pure limb.
`spin` turns the chosen ground under the camera, which is how a body's most
interesting face is picked; the rest is the same for all ten.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from smoke import (  # noqa: E402  (path set above)
    CDP,
    WebSocket,
    find_chrome,
    launch_chrome,
    wait_for_page_target,
    _free_port,
)

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = os.environ.get("GEOID_ORIGIN", "http://localhost:8125")

# The tile is about 2.4:1 at the sidebar's width; captured at 3x that so it
# stays crisp on a high-DPI screen and still costs well under 100 KB as JPEG.
WIDTH, HEIGHT = 960, 400
QUALITY = 0.82

# spin:  degrees the shot is turned about the pole, which chooses the ground.
# alt:   camera distance from the centre, in body radii.
# frac:  aim point as a fraction of the way to the horizon (see the shoot).
# tilt:  degrees the look-direction is swung out of the equatorial plane, so the
#        horizon is not a dead-level line across every one of the ten.
# light: degrees the key light is lifted off the view axis, for modelling.
SHOTS = {
    # The ISS destination's "planet" is Earth, and Earth's viewer is not under
    # planet_explorer/ — hence the explicit url. It boots standalone (measured:
    # 55 seam keys with window.self === window.top), so no iframe is needed.
    "earth": {"spin": 0, "alt": 1.16, "frac": 0.55, "tilt": -12,
              "url": "/GeoID_GIS/viewer/"},
    "mercury": {"spin": 20, "alt": 1.16, "frac": 0.55, "tilt": 18},
    "venus": {"spin": 165, "alt": 1.16, "frac": 0.55, "tilt": -14},
    "moon": {"spin": 300, "alt": 1.16, "frac": 0.55, "tilt": 12},
    "mars": {"spin": 250, "alt": 1.14, "frac": 0.55, "tilt": -16},
    # Pluto's basemap is New Horizons' one good hemisphere, so it is shot from
    # further out — close in, the frame is mostly the soft half.
    "pluto": {"spin": 180, "alt": 1.34, "frac": 0.55, "tilt": 10},
    # The gas giants have no surface, so the oblique is of the cloud deck —
    # the only "surface" they have and the one the viewer draws. They stand off
    # further than the rocky worlds: close in, a body whose whole texture is a
    # soft gradient fills the tile with one flat colour, and Saturn's rings —
    # the most defining thing about it — never enter the frame at all.
    "jupiter": {"spin": 120, "alt": 1.35, "frac": 0.50, "tilt": -20},
    "saturn": {"spin": 40, "alt": 1.55, "frac": 0.45, "tilt": 16},
    "uranus": {"spin": 90, "alt": 1.55, "frac": 0.50, "tilt": -12},
    "neptune": {"spin": 210, "alt": 1.55, "frac": 0.50, "tilt": 14},
}

OUT_DIR = ROOT / "assets" / "hero"

# A fixed moment, so a re-bake reproduces the same ground. 2026-03-20
# 12:00 UTC — an equinox noon, which puts the terminator on the poles and
# the most daylight across the mid-latitudes a single instant can give.
EPOCH_MS = 1774008000000

# Runs in the page. Waits for the globe AND for its texture, poses the camera,
# strips the annotation, renders at the tile's own size and hands back a JPEG.
SHOOT_JS = r"""
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  let v = null;
  while (Date.now() - t0 < 90000) {
    v = window.GeoIDViewer;
    if (v && v.camera && v.controls && v.globe && v.renderer && v.scene) break;
    await wait(200);
  }
  if (!v || !v.globe) return { ok: false, why: "no viewer" };

  // A tile of an untextured sphere is a tile of nothing. Wait for the basemap
  // to be on the material, then settle for the relief and any streamed refine.
  const hasMap = () => {
    let found = false;
    v.globe.traverse((o) => {
      const m = o.material;
      for (const mat of Array.isArray(m) ? m : [m]) if (mat && mat.map) found = true;
    });
    return found;
  };
  while (Date.now() - t0 < 90000 && !hasMap()) await wait(250);
  await wait(SETTLE_MS);

  v.setSpinPaused && v.setSpinPaused(true);
  // PIN THE CLOCK, or the bake is not idempotent. These globes turn with
  // simulated UTC, so `spin` names a fixed angle from wherever the body
  // happened to be when the page opened — and Earth, which turns fastest
  // against its own geography, came out over the Mediterranean in one run and
  // over the Sahel in the next from the identical numbers. Where a viewer has
  // no such seam its ground still drifts, and the shot is composed by eye
  // rather than promised.
  if (typeof v.setSimulatedUtcMs === "function") v.setSimulatedUtcMs(EPOCH_MS);
  await wait(120);

  const V3 = v.camera.position.constructor;
  const centre = new V3().setFromMatrixPosition(v.globe.matrixWorld);
  let R = 3.2;
  v.globe.traverse((o) => {
    const r = o.geometry && o.geometry.parameters && o.geometry.parameters.radius;
    if (r && r > R * 0.5) R = Math.max(R, r);
  });

  const pole = new V3(0, 1, 0).applyQuaternion(
    v.globe.getWorldQuaternion(new (v.camera.quaternion.constructor)())).normalize();

  // `u` is the point the tile is OF: the camera's own direction, turned about
  // the body's pole by `spin` to choose which ground shows.
  const u = v.camera.position.clone().sub(centre).normalize()
    .applyAxisAngle(pole, (SPIN_DEG * Math.PI) / 180).normalize();

  // THE OBLIQUE HAS TO SWING THE WAY THE FRAME IS TALL. `camera.up` is the
  // body's pole, so up in the picture is pole-ward; swinging the aim due EAST
  // moved the horizon sideways instead of raising it, and every trial came out
  // as a disc pushed against the left edge with a third of the tile empty. The
  // tangent is the pole-ward one, then turned about `u` by `tilt` so the
  // horizon runs across the frame on a diagonal rather than dead level.
  // Toward the far pole, not the near one: with `camera.up` on the pole, aiming
  // pole-ward put the ground along the TOP of the frame and the sky under it.
  const w = pole.clone().addScaledVector(u, -pole.dot(u)).normalize()
    .negate()
    .applyAxisAngle(u, (TILT_DEG * Math.PI) / 180).normalize();

  // THE AIM POINT MUST BE INSIDE THE HORIZON. From alt body-radii out the
  // horizon lies acos(1/alt) around the curve; aiming past it points the
  // camera at empty sky, which is what filled half the first Mars tile with
  // black. `frac` is a fraction of that angle, so the rule holds at any alt.
  const horizon = Math.acos(Math.min(1, 1 / ALT));
  const th = horizon * FRAC;
  const look = u.clone().multiplyScalar(Math.cos(th))
    .add(w.clone().multiplyScalar(Math.sin(th))).normalize();

  // OrbitControls CLAMPS to minDistance on update, and these viewers set a
  // zoom floor well outside the tile's altitude — so every pose was being
  // pushed back out to the floor and only the AIM moved, which is why a sweep
  // from alt 1.14 to 1.50 produced four near-identical frames. Lifted for the
  // shot and put back after.
  const minWas = v.controls.minDistance;
  v.controls.minDistance = 0.001;
  v.camera.position.copy(centre).addScaledVector(u, R * ALT);
  v.controls.target.copy(centre).addScaledVector(look, R);
  v.camera.up.copy(pole);
  v.controls.update();
  const achieved = v.camera.position.distanceTo(centre) / R;

  // LIGHT THE FACE BEING SHOT. Choosing the ground by turning the camera walks
  // it onto whatever the sun was already lighting — the first Mars tile came
  // out on the night side. The key light is aimed down `u` instead, lifted
  // `LIGHT_OFF` degrees toward the pole so the relief still models rather than
  // flattening under a light straight down the lens. A DirectionalLight is a
  // direction only, so this is right whether or not the body is at the origin.
  const lights = [];
  v.scene.traverse((o) => { if (o.isDirectionalLight) lights.push(o); });
  lights.sort((a, b) => b.intensity - a.intensity);
  const restoreLights = lights.map((l) => ({ l, pos: l.position.clone() }));
  if (lights[0]) {
    const dir = u.clone().applyAxisAngle(w, (LIGHT_OFF * Math.PI) / 180).normalize();
    lights[0].position.copy(dir).multiplyScalar(100);
    lights[0].target && lights[0].target.position.set(0, 0, 0);
  }
  // The fill comes from behind, so the limb keeps a rim rather than going flat.
  if (lights[1]) lights[1].position.copy(u).multiplyScalar(-100);

  // A TILE IS THE BODY AND THE SKY, and nothing else. Keeping only the shells
  // that are the body's own surface (within a fifth of its radius) drops the
  // annotation wholesale — names, leaders, orbit lines, and the 0.03-radius
  // marker dots and 0.28-radius hit spheres that survived a sprites-and-lines
  // sweep and speckled the first tile.
  const hidden = [];
  const draws = (o) => o.isMesh || o.isSprite || o.isPoints
    || o.isLine || o.isLineSegments || o.isLineLoop;
  v.scene.traverse((o) => {
    if (!o.visible || !draws(o)) return;                // containers stay, or
    if (o.renderOrder === -1000) return;                // their children vanish
    const g = o.geometry;
    const r = g && g.parameters && g.parameters.radius;
    if (o.isMesh && r && Math.abs(r - R) < R * 0.2) return;   // a surface shell
    // Saturn's rings are the one thing that is neither surface nor sky and
    // still belongs in its tile — they are the body, as much as its cloud deck.
    if (o.isMesh && g && g.type === "RingGeometry") return;
    o.visible = false;
    hidden.push(o);
  });

  const canvas = v.renderer.domElement;
  const before = { w: canvas.width, h: canvas.height, aspect: v.camera.aspect };
  v.renderer.setSize(W, H, false);
  v.camera.aspect = W / H;
  v.camera.updateProjectionMatrix();
  v.renderer.render(v.scene, v.camera);
  // Read it back in the same tick — the drawing buffer is not preserved, so a
  // toDataURL after the next composite comes back blank.
  const data = canvas.toDataURL("image/jpeg", QUALITY);

  v.renderer.setSize(before.w, before.h, false);
  v.camera.aspect = before.aspect;
  v.camera.updateProjectionMatrix();
  hidden.forEach((o) => { o.visible = true; });
  restoreLights.forEach((e) => e.l.position.copy(e.pos));
  v.controls.minDistance = minWas;

  return { ok: true, data, hidden: hidden.length, radius: R,
           askedAlt: ALT, achievedAlt: +achieved.toFixed(3), minWas,
           horizonDeg: +(horizon * 180 / Math.PI).toFixed(1) };
})()
"""


def shoot(cdp: CDP, world: str, shot: dict, settle_ms: int) -> bytes:
    js = (SHOOT_JS
          .replace("SPIN_DEG", str(shot["spin"]))
          .replace("ALT", str(shot["alt"]))
          .replace("FRAC", str(shot["frac"]))
          .replace("LIGHT_OFF", str(shot.get("light", 22)))
          .replace("TILT_DEG", str(shot["tilt"]))
          .replace("SETTLE_MS", str(settle_ms))
          .replace("EPOCH_MS", str(EPOCH_MS))
          .replace("QUALITY", str(QUALITY))
          .replace("W, H", f"{WIDTH}, {HEIGHT}")
          .replace("W / H", f"{WIDTH} / {HEIGHT}"))
    result = cdp.evaluate(js, timeout=180)
    if not result or not result.get("ok"):
        raise RuntimeError(f"{world}: {result.get('why') if result else 'no result'}")
    if abs(result["achievedAlt"] - result["askedAlt"]) > 0.02:
        print(f"    ! {world}: asked alt {result['askedAlt']}, got "
              f"{result['achievedAlt']} (minDistance was {result['minWas']})")
    head, _, b64 = result["data"].partition(",")
    if "jpeg" not in head:
        raise RuntimeError(f"{world}: unexpected data URL {head[:40]}")
    return base64.b64decode(b64)


def sweep(cdp: CDP, world: str, out: Path) -> None:
    """Tuning aid: several poses from ONE page load, so composition can be
    judged side by side without paying the viewer's boot for each."""
    base = SHOTS[world]
    out.mkdir(parents=True, exist_ok=True)
    first = True
    # Spin is what chooses the ground, and it is the one number worth sweeping
    # once alt and frac are settled: it decides whether a tile lands on a
    # cratered highland or an empty ocean, and — on Earth, whose terminator
    # follows the clock rather than the light — whether it lands in daylight.
    for spin in range(0, 360, 30):
        shot = {**base, "spin": spin}
        jpeg = shoot(cdp, world, shot, settle_ms=6000 if first else 200)
        first = False
        (out / f"{world}-s{spin:03d}.jpg").write_bytes(jpeg)
        print(f"  spin {spin:>3}  {len(jpeg) // 1024:>3} KB")


def main() -> int:
    argv = [a for a in sys.argv[1:] if a != "--sweep"]
    sweeping = "--sweep" in sys.argv
    only = argv
    worlds = [w for w in SHOTS if not only or w in only]
    if not worlds:
        print(f"no such world; know: {', '.join(SHOTS)}")
        return 2

    try:
        with urllib.request.urlopen(f"{ORIGIN}/", timeout=5):
            pass
    except (urllib.error.URLError, OSError) as exc:
        print(f"{ORIGIN} is not answering ({exc}). Start it with: python3 serve.py")
        return 2

    chrome = find_chrome()
    if not chrome:
        print("No Chrome found; set GEOID_CHROME.")
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    port = _free_port()
    profile = tempfile.mkdtemp(prefix="geoid-hero-")
    proc = launch_chrome(chrome, port, profile)
    failures = 0
    try:
        ws = WebSocket(wait_for_page_target(port))
        # smoke.py opens the socket with a 10 s read timeout, which is right for
        # its own short calls and far too short for one of these: a viewer has
        # to boot, stream a basemap and settle before the shot is even posed.
        ws.sock.settimeout(300)
        cdp = CDP(ws)
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        for world in worlds:
            path = SHOTS[world].get("url", f"/planet_explorer/{world}/viewer/")
            url = f"{ORIGIN}{path}"
            cdp.call("Page.navigate", {"url": url})
            time.sleep(1.0)
            try:
                if sweeping:
                    sweep(cdp, world, ROOT / "scratch-hero-sweep")
                    continue
                # A generous settle: these viewers stream their basemap.
                jpeg = shoot(cdp, world, SHOTS[world], settle_ms=6000)
            except RuntimeError as exc:
                print(f"  {world:<9} FAILED  {exc}")
                failures += 1
                continue
            path = OUT_DIR / f"{world}.jpg"
            path.write_bytes(jpeg)
            print(f"  {world:<9} {len(jpeg) // 1024:>4} KB  {path.relative_to(ROOT)}")
        ws.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print("done" if not failures else f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
