/* =============================================================================
   MARS FLIGHT SIMULATOR — flight module
   Runs on top of the forked Mars viewer (mars-viewer.js in this directory).
   The viewer render loop calls window.__flightSim.update(camera) once per
   frame while flight mode is engaged; everything else (CTX tile streaming,
   basemaps, overlays, labels, starfield, nav panel) is the stock viewer.

   Scale: the viewer globe sphere has radius 3.2 scene units and represents
   MARS_RADIUS_METERS (3 396 190 m), so 1 scene unit ≈ 1 061 km. Terrain in
   flight mode is forced to 1:1 relief (no vertical exaggeration) by the
   getEffectiveTerrainRelief override inside the forked viewer.
   ============================================================================= */
(function () {
  "use strict";

  // Public state object — the forked viewer optional-chains on this, so it must
  // exist before the viewer's render loop starts.
  const fs = {
    active: false,
    forceRelief: false,
    focusLatLon: null,  // ground point the tile streamer should refine around
    maxDetailLevel: 9, // detail cap from fs-detail-level: 9 = base + altitude-staged streamed detail (default), 6 = base only
    update: () => {},
    engage: () => {},
    disengage: () => {},
  };
  window.__flightSim = fs;

  // Dump the frame trace. Fly into the jerk, then call __fsTrace() — the
  // summary alone usually decides position vs scene, and `rows` carries the
  // raw frames for the worst stretch.
  window.__fsTrace = (worstN = 40) => {
    const n = Math.min(_traceIdx, TRACE_N);
    if (!n) return "no frames recorded — is the flight sim running?";
    const rows = [];
    const start = _traceIdx > TRACE_N ? _traceIdx % TRACE_N : 0;
    for (let j = 0; j < n; j += 1) {
      const i = ((start + j) % TRACE_N) * TRACE_W;
      rows.push({
        t: +_traceBuf[i].toFixed(0), dt: +_traceBuf[i + 1].toFixed(4),
        spdKmS: +_traceBuf[i + 2].toFixed(2), altKm: +_traceBuf[i + 3].toFixed(2),
        ceilKmS: +_traceBuf[i + 4].toFixed(2), boost: +_traceBuf[i + 5].toFixed(2),
        stepKm: +_traceBuf[i + 6].toFixed(3), camGapKm: +_traceBuf[i + 7].toFixed(4),
      });
    }
    const col = (k) => rows.map((r) => r[k]);
    const stats = (k) => {
      const v = col(k).slice().sort((a, b) => a - b);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      // Coefficient of variation: the scale-free measure of "how jumpy".
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
      return {
        min: +v[0].toFixed(4), p50: +v[v.length >> 1].toFixed(4),
        p95: +v[Math.floor(v.length * 0.95)].toFixed(4),
        max: +v[v.length - 1].toFixed(4),
        mean: +mean.toFixed(4), cv: +(mean ? sd / mean : 0).toFixed(3),
      };
    };
    // The worst stretch: highest frame-to-frame CHANGE in step size, which is
    // what a jerk actually is — not a big step, but a step unlike its
    // neighbours.
    let worstAt = 0, worstJump = 0;
    for (let j = 1; j < rows.length; j += 1) {
      const d = Math.abs(rows[j].stepKm - rows[j - 1].stepKm);
      if (d > worstJump) { worstJump = d; worstAt = j; }
    }
    const from = Math.max(0, worstAt - (worstN >> 1));
    return {
      frames: n,
      fps: +(1000 / (stats("dt").mean * 1000)).toFixed(1),
      dt: stats("dt"),
      stepKm: stats("stepKm"),
      camGapKm: stats("camGapKm"),
      ceilKmS: stats("ceilKmS"),
      worstStepChangeKm: +worstJump.toFixed(3),
      // cv (coefficient of variation) is scale-free, so it compares directly
      // across speeds. Steady motion at any speed has a low cv; a jerk is
      // variance, not magnitude.
      verdict: (() => {
        const sCv = stats("stepKm").cv, cCv = stats("camGapKm").cv;
        const cCeil = stats("ceilKmS").cv;
        if (cCeil > 0.05) {
          return "CEILING: the speed ceiling itself is moving (altitude-derived, "
            + "undamped) — the speed target is being modulated. cv=" + cCeil;
        }
        if (sCv > 0.35) {
          return "POSITION: the ship's per-frame step is genuinely irregular "
            + "(cv=" + sCv + "). Frame times or the speed target, not the camera.";
        }
        if (cCv > 0.35) {
          return "SCENE: steps are even (cv=" + sCv + ") but the camera gap "
            + "oscillates (cv=" + cCv + ") — the camera is the artefact.";
        }
        return "NEITHER: ship and camera are both steady (step cv=" + sCv
          + ", cam cv=" + cCv + "). The apparent jump is the ground texture, "
          + "i.e. the streamer re-keying under a steady ship. Read __fsStreamStats.";
      })(),
      rows: rows.slice(from, from + worstN),
    };
  };

  let hooks = null;
  let THREE = null;

  // ---- constants (filled in once hooks arrive) ----
  let METERS_PER_UNIT = 1061309;      // MARS_RADIUS_METERS / 3.2
  const GLOBE_R = 3.2;                // scene radius of Mars datum sphere
  // Hull length of the built orbiter in local units (nose cap ≈ -17.7 to engine
  // bells ≈ +17.1). applyShipScale divides the chosen display size by this.
  const SHIP_NOMINAL_LENGTH = 35;
  // Realistic = the orbiter's true 37 m length. At planet scale that is close to
  // invisible, hence the exaggerated display options.
  const SHIP_SIZES_M = { realistic: 37, cinematic: 600, arcade: 6000 };
  // Full throttle is HALF the original 2400 m/s. The launch default sits at 0.7,
  // which puts default cruise on 840 m/s — the ground speed the whole CTX
  // pipeline is tuned around (lead distance, per-level budgets, the ~15 tiles/s
  // transport ceiling) — so the sim still opens in the regime the streamer can
  // feed, with headroom in both directions.
  // Cruise ceiling with no boost. Boost raises the ceiling toward
  // speedCeilingKmS(altitude) rather than multiplying this.
  const MAX_SPEED_MS = 1200;
  const LAUNCH_THROTTLE = 0.7;
  const MIN_CLEARANCE_M = 60;         // floor above the visible tile surface
  const MAX_ALT_M = 600000;           // 600 km ceiling
  const PITCH_RATE = 1.1, YAW_RATE = 0.7, ROLL_RATE = 1.6; // rad/s

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const hud = $("fs-hud");
  const hudAlt = $("fs-alt"), hudSpd = $("fs-spd"), hudHdg = $("fs-hdg"),
    hudCoord = $("fs-coord"), hudRegion = $("fs-region-top"), hudThr = $("fs-thr"),
    hudThrottleFill = $("fs-throttle-fill"), hudBoostFill = $("fs-boost-fill"),
    hudMsg = $("fs-msg"), hudCamTag = $("fs-camtag");
  const bearingCanvas = $("fs-bearing-tape");
  const hudPitch = $("fs-pitch"), hudVs = $("fs-vs"), hudGround = $("fs-ground"),
    hudDist = $("fs-dist");
  // Atmosphere now reads out inside the instrument row, captioned by the domain
  // line above it — the viewer's own surface-conditions panel is hidden in
  // flight, so nothing here touches it any more.
  const hudTemp = $("fs-temp"), hudPress = $("fs-press");
  // Match each canvas backing store to its CSS box at device resolution, or the
  // tick strip and the rose both come out soft on a HiDPI display.
  function sizeHudCanvas(cv, cssW, cssH) {
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
  }
  // Read the sizes back from CSS so the media queries stay the single source of
  // truth for how big these instruments are.
  function syncHudCanvasSizes() {
    if (bearingCanvas) {
      const r = bearingCanvas.getBoundingClientRect();
      if (r.width) sizeHudCanvas(bearingCanvas, r.width, r.height);
    }
    bearingLastDeg = null;   // force a repaint at the new resolution
  }
  window.addEventListener("resize", () => { if (fs.active) syncHudCanvasSizes(); });

  const flightToggle = $("flightsim-toggle");
  const shipModelSelect = $("fs-ship-model");
  const vexSlider = $("fs-vex");
  const fadeEl = $("fs-fade");
  const cameraModeSelect = $("fs-camera-mode");
  const startAltSelect = $("fs-start-alt");
  const detailLevelSelect = $("fs-detail-level");
  let preFlightReliefValue = null; // slider value to restore on disengage

  // CONTINUOUS SPEED RANGE, CEILINGED BY ALTITUDE.
  //
  // This replaces the old x1 / x10 selector. Two discrete modes could not work:
  // x1 was smooth but almost static from altitude, x10 was unflyable near the
  // ground, and nothing in between was reachable. Worse, the failure was not
  // gradual — x10 broke two separate budgets at once.
  //
  //   STREAMING. The focus disc exposes ~2*R*v of new ground per second and so
  //   needs 2*k*v/tile tiles/s to stay filled. At 12 km/s that is 158 tiles/s
  //   at L12 against the ~15/s this pipeline sustains, which is why fine levels
  //   simply never landed at x10.
  //
  //   PERCEPTION. Position integrates the true frame time, so a hitch moves the
  //   ship v*dt. What the eye judges is that step against the VISIBLE GROUND,
  //   and the visible ground is proportional to altitude: at a 45 deg fov and
  //   16:9 it is ~1.47*alt across. At 2.5 km altitude the view is 3.7 km, so a
  //   clamped 0.25 s hitch at 12 km/s moves the scene 3 km — 81% of the screen
  //   in one frame. Consecutive frames then share almost no content and the eye
  //   reads teleporting rather than motion. The same hitch at 60 km is 3% of
  //   the view and invisible. THAT is why it was smooth high and jumped low.
  //
  // Both budgets scale with altitude, so the ceiling does too. Cap speed so a
  // clamped hitch cannot move the scene more than ~25% of the view:
  //
  //   step = v * 0.25 s  <=  0.25 * view   =>   v <= view = 1.47 * altKm
  //
  // which is high enough to be worth flying and low enough that the streamer
  // can serve it — the level cap in the viewer reads the same ground speed and
  // picks the finest level that speed allows, so detail degrades smoothly as
  // you accelerate instead of collapsing at a mode switch.
  // Frame trace ring buffer — see the write site in update() for why.
  // 1800 frames is ~60 s at 30 fps, enough to fly into the jerk and dump after.
  const TRACE_N = 1800, TRACE_W = 8;
  const _traceBuf = new Float64Array(TRACE_N * TRACE_W);
  let _traceIdx = 0;
  let _tracePrev = null;

  const VIEW_KM_PER_ALT_KM = 1.47;   // 45 deg vertical fov, 16:9
  const SPEED_FLOOR_KMS = 0.8;       // always flyable, even on the deck
  const SPEED_ROOF_KMS = 12;         // the old x10 top, reachable once high
  function speedCeilingKmS(altKm) {
    const byView = VIEW_KM_PER_ALT_KM * Math.max(0, altKm);
    return Math.min(SPEED_ROOF_KMS, Math.max(SPEED_FLOOR_KMS, byView));
  }

  // ---- flight state ----
  const state = {
    throttle: LAUNCH_THROTTLE,
    pos: null, quat: null, vel: null,
    speed: 0,            // scene units / s
    boost: 1,
    boosting: false,
    braking: false,
    cam: "chase",
    hudVisible: true,
    lastT: 0,
    crashed: false,
    crashTimer: 0,
    crashLatLon: null,
  };
  const keys = {};
  let ship = null;
  let engineGlow = [];
  let thrustCones = [];
  // Materials whose EMISSIVE tracks throttle, for drives that read as a lit band
  // rather than an exhaust plume (the freighter's rear vent). Cones are the wrong
  // idiom there — the band IS the geometry, so it only needs to brighten.
  let engineBands = [];
  let msgTimer = 0;

  function flash(text) {
    if (!hudMsg) return;
    hudMsg.textContent = text;
    hudMsg.style.opacity = "1";
    msgTimer = 1.6;
  }

  // ---- geometry helpers ----
  // The globe mesh is rotated by (π + spinDelta); label/tile groups counter-rotate
  // by spinDelta. Points from latLonToVector3 live in that counter-rotated "map"
  // frame, so world → map = rotateY(−spinDelta), map → world = rotateY(+spinDelta).
  function spinDelta() { return hooks.getSpinDelta(); }

  // AXIAL TILT. `marsGroup` carries the planet's 25.19° obliquity as a rotation
  // about Z, so the map frame is NOT world-axis-aligned and the spin alone does
  // not get you between the two. The viewer's own picker already accounts for it
  // (`marsGroup.worldToLocal` then un-spin); these must be its exact inverse or
  // the ship launches ~1,500 km from wherever the crosshair was.
  //
  // Leaving the tilt out of BOTH directions is what hid this: world→latlon and
  // latlon→world were wrong by the same rotation, so the sim round-tripped
  // perfectly against itself and still put the ship in the wrong place.
  // Allocated lazily: `THREE` is null until the viewer hands over its instance,
  // so anything built at module scope here runs too early and takes the rest of
  // the file down with it.
  let _mapMat = null;
  let _mapMatInv = null;
  function mapToWorldMatrix() {
    if (!_mapMat) _mapMat = new THREE.Matrix4();
    hooks.marsGroup.updateWorldMatrix(true, false);
    return _mapMat.copy(hooks.marsGroup.matrixWorld);
  }
  function worldToMapMatrix() {
    if (!_mapMatInv) _mapMatInv = new THREE.Matrix4();
    return _mapMatInv.copy(mapToWorldMatrix()).invert();
  }

  // The planet's spin axis in WORLD space — map-frame +Y carried through the
  // tilt. Every north/east basis must be built from this, not from world +Y,
  // or headings are off by the obliquity as well.
  function planetAxis() {
    return new THREE.Vector3(0, 1, 0).transformDirection(mapToWorldMatrix());
  }

  function worldToLatLon(p) {
    const q = p.clone()
      .applyMatrix4(worldToMapMatrix())
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -spinDelta());
    const r = q.length() || 1;
    const lat = Math.asin(Math.max(-1, Math.min(1, q.y / r))) * 180 / Math.PI;
    const sceneLon = Math.atan2(q.z, -q.x) * 180 / Math.PI;
    const lonE = ((sceneLon % 360) + 360) % 360;
    return { lat, lon: lonE };
  }

  function latLonToWorld(lat, lonE, radius) {
    return hooks.latLonToVector3(lat, lonE, radius)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), spinDelta())
      .applyMatrix4(mapToWorldMatrix());
  }

  function ctxModeActive() {
    const v = hooks.baseLayerSelect?.value;
    return v === "ctx-mosaic" || v === "ctx-mosaic-color";
  }

  // Radius (scene units) of the *visible* surface at lat/lon — datum sphere
  // + 1:1 DEM displacement + the lift the CTX tile drape floats at.
  function surfaceRadiusAt(lat, lonE) {
    const relief = hooks.getEffectiveTerrainRelief();
    const norm = hooks.elevationSampler
      ? hooks.sampleElevationNormalized(hooks.elevationSampler, lat, lonE)
      : 0.5;
    let lift = 0;
    if (ctxModeActive() && hooks.ctxDetailStreamer) {
      lift = hooks.ctxDetailStreamer.surfaceLiftBase
        + Math.max(0, relief) * hooks.ctxDetailStreamer.surfaceLiftReliefFactor;
    }
    return GLOBE_R + norm * relief + lift;
  }

  // ---- named regions for the HUD (east-positive longitude, 0–360) ----
  function regionName(lat, lon) {
    if (lat > 72) return "PLANUM BOREUM";
    if (lat < -72) return "PLANUM AUSTRALE";
    if (lat > -18 && lat < 2 && lon > 250 && lon < 320) return "VALLES MARINERIS";
    if (lat > -5 && lat < 25 && lon > 220 && lon < 250) return "THARSIS MONTES";
    if (lat > 12 && lat < 25 && lon > 130 && lon < 150) return "ELYSIUM MONS";
    if (lat < -25 && lat > -55 && lon > 45 && lon < 100) return "HELLAS PLANITIA";
    if (lat < -35 && lat > -55 && lon > 250 && lon < 300) return "ARGYRE PLANITIA";
    if (lat > 8 && lat < 28 && lon > 222 && lon < 232) return "OLYMPUS MONS";
    if (lat > 30 && lon > 150 && lon < 210) return "ARCADIA PLANITIA";
    if (lat > 25 && lon > 20 && lon < 90) return "UTOPIA PLANITIA";
    if (lat < -20 && lon > 315) return "NOACHIS TERRA";
    if (lat > -15 && lat < 15 && lon > 150 && lon < 210) return "AMAZONIS PLANITIA";
    return lat >= 0 ? "NORTHERN LOWLANDS" : "SOUTHERN HIGHLANDS";
  }

  // ---- ship ----
  // Small canvas-backed decal (flag, lettering). Planes only — no cylindrical
  // UV wrapping to fight, so orientation is predictable.
  function makeDecalTexture(width, height, draw) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    draw(c.getContext("2d"), width, height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function makeTextDecal(text, wpx = 512, hpx = 128) {
    return makeDecalTexture(wpx, hpx, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = "#15161c";
      g.font = `bold ${Math.floor(h * 0.66)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, w / 2, h / 2);
    });
  }

  // GeoID mark, loaded from the site's own asset rather than painted in canvas.
  // TextureLoader returns the texture synchronously and fills it in on load, so
  // the ship can be built before the image arrives.
  let _geoidLogoTex = null;
  function geoidLogoTexture() {
    if (_geoidLogoTex) return _geoidLogoTex;
    _geoidLogoTex = new THREE.TextureLoader().load("../../../assets/GeoID_logo_icon.png");
    _geoidLogoTex.colorSpace = THREE.SRGBColorSpace;
    _geoidLogoTex.anisotropy = 4;
    _geoidLogoTex.userData.shared = true;   // built once — disposeGroup must skip it
    return _geoidLogoTex;
  }

  // Soft radial falloff used for the nozzle-exit glow sprites. Built once.
  let _engineGlowTex = null;
  function engineGlowTexture() {
    if (_engineGlowTex) return _engineGlowTex;
    _engineGlowTex = makeDecalTexture(128, 128, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.18, "rgba(216,240,255,0.92)");
      grd.addColorStop(0.45, "rgba(128,196,255,0.38)");
      grd.addColorStop(1, "rgba(64,140,220,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    // Built once and shared by EVERY nozzle sprite on every ship — the X-Fighter
    // alone binds it eight times. disposeGroup must not destroy it on a rebuild,
    // or the next ship binds a texture whose GPU object is already gone.
    _engineGlowTex.userData.shared = true;
    return _engineGlowTex;
  }

  // Density ramp along a plume, nozzle -> downstream.
  //
  // Without this the plume cones are flat-shaded shells: uniform brightness for
  // their whole length, then a hard circular cut-off where the open base ends.
  // That edge is what made them read as solid plastic cones rather than gas.
  //
  // ORIENTATION MATTERS and is easy to get backwards. three.js builds a cone as
  // a cylinder with radiusTop 0, and its UVs run uv.y = 1 at the TOP (the apex)
  // down to 0 at the base. With the default flipY the apex therefore samples the
  // TOP row of this canvas — so the opaque end of the gradient must be at y = 0.
  // The apex is the nozzle, so: bright at the throat, gone by the tail.
  let _plumeTex = null;
  function plumeTexture() {
    if (_plumeTex) return _plumeTex;
    _plumeTex = makeDecalTexture(8, 256, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      // Falls off fast just past the throat, then carries a long thin tail —
      // a linear ramp looks like a cone with the tip cut off.
      grd.addColorStop(0.00, "rgba(255,255,255,1)");
      grd.addColorStop(0.06, "rgba(255,255,255,0.96)");
      grd.addColorStop(0.20, "rgba(255,255,255,0.62)");
      grd.addColorStop(0.42, "rgba(255,255,255,0.30)");
      grd.addColorStop(0.68, "rgba(255,255,255,0.11)");
      grd.addColorStop(1.00, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    _plumeTex.userData.shared = true;   // cached; disposeGroup must skip it
    return _plumeTex;
  }

  // Drive every engine's visuals from a 0..1 thrust level. Called each frame
  // and forced to 0 when the ship is destroyed.
  function setThrustVisuals(level, boosting) {
    const t = Math.max(0, Math.min(1.6, level));
    // Shared phase, declared before ANY loop that reads it — a ship's discs and
    // their blooms must pulse together rather than drifting against each other.
    const pulseWave = Math.sin(performance.now() * 0.0055);
    // Combustion shimmer. Two incommensurate frequencies so it never settles
    // into a visible loop, kept small — a plume that throbs obviously reads as
    // an animation, whereas a real one just refuses to sit perfectly still.
    const _ft = performance.now();
    const flicker = 1
      + 0.045 * Math.sin(_ft * 0.037)
      + 0.030 * Math.sin(_ft * 0.0113 + 1.7);
    for (const glow of engineGlow) {
      const mat = glow.mat || glow;             // legacy entries were bare materials
      const base = (t <= 0.001 ? 0 : Math.min(1, 0.2 + t * 0.8)) * (glow.alpha ?? 1);
      mat.opacity = Math.min(1, base * (1 + (glow.pulse ?? 0) * pulseWave));
      mat.color.setHex(boosting ? (glow.boostTint ?? 0xffd9a8) : (glow.tint ?? 0xbfe4ff));
    }
    for (const band of engineBands) {
      const k = Math.min(1, t) + (boosting ? 0.45 : 0);
      const lit = band.idle + (band.hot - band.idle) * k;
      band.mat.emissiveIntensity = lit * (1 + (band.pulse ?? 0) * pulseWave);
    }
    for (const engine of thrustCones) {
      const hot = engine.hot ?? 0xf2fbff;
      const mid = engine.mid ?? 0x9fd8ff;
      const cool = engine.cool ?? 0x4f8fd6;
      for (const layer of engine.layers) {
        layer.mat.opacity = t <= 0.001 ? 0
          : Math.min(1, layer.baseAlpha * Math.min(1, t) * flicker);
        layer.mat.color.setHex(boosting ? (engine.boostHot ?? 0xffc98a)
          : layer.baseAlpha > 0.8 ? hot : layer.baseAlpha > 0.3 ? mid : cool);
        // Plume stretches with throttle and the apex stays pinned at the nozzle.
        const stretch = 0.45 + (t * 0.75) + (boosting ? 0.45 : 0);
        // sx/sz let slot-shaped engines (the freighter's drive band) stay wide
        // while still stretching along the flight axis like a round nozzle.
        layer.mesh.scale.set(layer.sx ?? 1, stretch, layer.sz ?? 1);
        layer.mesh.position.z = layer.baseZ + (layer.length * stretch) / 2;
      }
      for (const dia of engine.diamonds) {
        // Diamonds only form under real thrust, fade with distance downstream,
        // and pack closer together as the plume intensifies.
        const spacing = (engine.diaSpacing ?? 1.05) + (t * 0.75);
        dia.mesh.position.z = engine.origin.z + (engine.diaStart ?? 2.6) + (dia.index * spacing);
        dia.mat.opacity = t < 0.25 ? 0 : Math.max(0, (t - 0.25) * 0.9) * (1 - dia.index * 0.22);
        dia.mat.color.setHex(boosting ? 0xffe3bb : 0xffffff);
        const s = 0.7 + t * 0.5;
        dia.mesh.scale.set(s * (dia.sx ?? 1), s, s * 2.1);
      }
    }
  }

  // Build one engine emitter — exit glow, layered plume and shock diamonds —
  // at a nozzle, and register it so setThrustVisuals() drives it from throttle.
  //
  // The shuttle grew this inline; the baked ships need the same thing at their
  // own nozzles, so it lives here. `size` scales the plume radially, `length`
  // along the flight axis, and `aspectX` widens it for slot-shaped drives.
  // Every position is in the BUILDER'S local units, i.e. after the bake scale
  // and before applyShipScale, so it lines up with the mesh as authored.
  function addThruster(group, x, y, z, opts = {}) {
    const size = opts.size ?? 1;
    const len = opts.length ?? 1;
    const aspectX = opts.aspectX ?? 1;

    const glowMat = new THREE.SpriteMaterial({
      map: engineGlowTexture(), color: opts.tint ?? 0xbfe4ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sprite = new THREE.Sprite(glowMat);
    sprite.position.set(x, y, z + 0.3 * size);
    sprite.scale.set(3.4 * size * aspectX, 3.4 * size, 1);
    group.add(sprite);
    engineGlow.push({ mat: glowMat, tint: opts.tint, boostTint: opts.boostTint });

    const layers = [];
    for (const L of [
      { radius: 0.42, length: 7, alpha: 0.95 },
      { radius: 0.95, length: 12, alpha: 0.42 },
      { radius: 1.7, length: 17, alpha: 0.16 },
    ]) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const length = L.length * len;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(L.radius * size, length, 20, 1, true), mat);
      cone.rotation.x = -Math.PI / 2;       // apex at the nozzle, opening downstream
      cone.position.set(x, y, z + 0.25 * size + length / 2);
      group.add(cone);
      layers.push({ mesh: cone, mat, baseAlpha: L.alpha, baseZ: z + 0.25 * size, length,
        sx: aspectX, sz: 1 });
    }

    const diamonds = [];
    if (opts.diamonds !== false) {
      for (let d = 0; d < (opts.diamondCount ?? 4); d += 1) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const dia = new THREE.Mesh(new THREE.SphereGeometry(0.3 * size, 12, 8), mat);
        group.add(dia);
        diamonds.push({ mesh: dia, mat, index: d, sx: aspectX });
      }
    }

    thrustCones.push({
      layers, diamonds, origin: { x, y, z },
      hot: opts.hot, mid: opts.mid, cool: opts.cool, boostHot: opts.boostHot,
      diaStart: (opts.diaStart ?? 3.3) * size * len,
      diaSpacing: (opts.diaSpacing ?? 1.25) * size * len,
    });
  }

  // ---- Space Shuttle orbiter (Challenger) ----
  // Built to STS orbiter proportions — 37 m long, 24 m span, 17 m tall — with
  // the defining features: double-delta wing, black HRSI belly and nose cap,
  // swept vertical stabiliser, OMS pods flanking the tail, and three SSME bells
  // in the classic triangle. Nose points -Z, matching the flight model.
  function buildShuttle() {
    const group = new THREE.Group();
    group.userData.nominalLength = 35;

    const tileWhite = new THREE.MeshStandardMaterial({ color: 0xe9ecf0, metalness: 0.05, roughness: 0.78 });
    const tileBlack = new THREE.MeshStandardMaterial({ color: 0x16171c, metalness: 0.08, roughness: 0.92 });
    const podWhite = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.06, roughness: 0.72 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.92, roughness: 0.32 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x33363d, metalness: 0.7, roughness: 0.45 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0b1622, metalness: 0.9, roughness: 0.06,
      emissive: 0x0a2233, emissiveIntensity: 0.35,
    });

    // ---- fuselage ----
    // Mid body (payload bay section), z from -7 to +10.
    const midBody = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 17, 28), tileWhite);
    midBody.rotation.x = Math.PI / 2;
    midBody.position.z = 1.5;
    group.add(midBody);

    // Forward fuselage as one continuous lathed surface. Stacking cone
    // sections left visible steps where the radii met and read as a blunt
    // slab; a single revolved profile gives the orbiter's long, finely drawn
    // nose with no seams. Profile is [z, radius] from tip back to the mid body.
    const noseProfile = [
      [-18.40, 0.03], [-18.15, 0.32], [-17.80, 0.57], [-17.25, 0.87],
      [-16.50, 1.19], [-15.55, 1.50], [-14.35, 1.79], [-12.90, 2.03],
      [-11.20, 2.21], [-9.30, 2.33], [-7.40, 2.39], [-6.00, 2.40],
    ];
    const radiusAtZ = (z) => {
      if (z <= noseProfile[0][0]) return noseProfile[0][1];
      const last = noseProfile[noseProfile.length - 1];
      if (z >= last[0]) return last[1];
      for (let i = 0; i < noseProfile.length - 1; i += 1) {
        const [z0, r0] = noseProfile[i];
        const [z1, r1] = noseProfile[i + 1];
        if (z >= z0 && z <= z1) return r0 + ((r1 - r0) * ((z - z0) / (z1 - z0)));
      }
      return last[1];
    };
    // Lathe revolves around Y, so points are (radius, axial) and the mesh is
    // rotated to lay that axis along Z. phi = 0 maps to world -Y (the belly),
    // which lets the same profile drive a partial revolve for the black TPS.
    const latheSection = (zStart, zEnd, material, radiusBias = 0, phiStart, phiLength) => {
      const pts = [];
      const steps = 26;
      for (let i = 0; i <= steps; i += 1) {
        const z = zStart + ((zEnd - zStart) * (i / steps));
        pts.push(new THREE.Vector2(Math.max(0.01, radiusAtZ(z) + radiusBias), z));
      }
      const geo = (phiStart === undefined)
        ? new THREE.LatheGeometry(pts, 30)
        : new THREE.LatheGeometry(pts, 30, phiStart, phiLength);
      const mesh = new THREE.Mesh(geo, material);
      mesh.rotation.x = Math.PI / 2;
      return mesh;
    };
    group.add(latheSection(-17.05, -6.0, tileWhite));
    // Black RCC nose cap and the black TPS running back along the underside.
    group.add(latheSection(-18.40, -17.0, tileBlack, 0.012));
    const noseBellyLathe = latheSection(-17.0, -6.0, tileBlack, 0.02, -1.95, 3.9);
    noseBellyLathe.material = tileBlack;
    group.add(noseBellyLathe);

    // Aft fuselage / thrust structure, z from +10 to +14.5.
    const aftBody = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.15, 4.5, 28), tileWhite);
    aftBody.rotation.x = Math.PI / 2;
    aftBody.position.z = 12.25;
    group.add(aftBody);

    // Black thermal-protection belly. After rotation.x = π/2 the cylinder's
    // theta = 0 points at world -Y, so a band centred on theta = 0 is the
    // underside. Radius is a hair larger to sit proud of the white skin.
    const bellyBand = (radius, length, z, taper = radius) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(taper, radius, length, 28, 1, true, -1.95, 3.9),
        tileBlack,
      );
      m.rotation.x = Math.PI / 2;
      m.position.z = z;
      m.material.side = THREE.DoubleSide;
      return m;
    };
    // Forward belly is handled by the lathed nose section above.
    group.add(bellyBand(2.44, 17, 1.5));
    group.add(bellyBand(2.44, 4.5, 12.25, 2.19));

    // ---- double-delta wings ----
    // Shape is authored in XY then rotated: shape +Y becomes world -Z (forward),
    // extrude depth becomes world +Y (thickness).
    const wingShape = new THREE.Shape();
    wingShape.moveTo(1.8, 8.0);     // strake root, well forward
    wingShape.lineTo(4.6, 2.4);     // leading-edge kink (strake → main delta)
    wingShape.lineTo(11.1, -6.2);   // tip, leading edge
    wingShape.lineTo(11.1, -9.0);   // tip, trailing edge
    wingShape.lineTo(1.8, -9.0);    // root trailing edge
    wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.5, bevelEnabled: false });
    // Black underside plate, slightly oversized so it reads as the RCC/HRSI
    // leading edge and belly when seen from below.
    const wingUnderGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.22, bevelEnabled: false });

    for (const side of [1, -1]) {
      const wing = new THREE.Mesh(wingGeo, tileWhite);
      wing.rotation.x = -Math.PI / 2;
      wing.position.set(0, -0.75, 1.0);
      wing.scale.x = side;
      group.add(wing);

      const wingUnder = new THREE.Mesh(wingUnderGeo, tileBlack);
      wingUnder.rotation.x = -Math.PI / 2;
      wingUnder.position.set(0, -0.95, 1.0);
      wingUnder.scale.set(side * 1.012, 1.006, 1);
      group.add(wingUnder);

      // Elevons along the trailing edge.
      const elevon = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.16, 1.5), darkMetal);
      elevon.position.set(side * 7.4, -0.62, 9.3);
      group.add(elevon);
    }

    // ---- vertical stabiliser ----
    // Shape +X becomes world -Z, so x is negated to place it aft.
    const finShape = new THREE.Shape();
    finShape.moveTo(-7.0, 2.3);     // base, leading edge
    finShape.lineTo(-13.0, 11.6);   // top, leading edge
    finShape.lineTo(-14.6, 11.6);   // top, trailing edge
    finShape.lineTo(-15.0, 2.3);    // base, trailing edge
    finShape.closePath();
    const fin = new THREE.Mesh(
      new THREE.ExtrudeGeometry(finShape, { depth: 0.75, bevelEnabled: false }),
      tileWhite,
    );
    fin.rotation.y = Math.PI / 2;
    fin.position.x = -0.375;
    group.add(fin);
    // Split rudder / speedbrake at the trailing edge.
    const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.4, 0.5), darkMetal);
    rudder.position.set(0, 7.0, 14.35);
    rudder.rotation.x = -0.06;
    group.add(rudder);

    // ---- OMS pods ----
    for (const side of [1, -1]) {
      const pod = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 16), podWhite);
      pod.position.set(side * 1.95, 2.15, 11.4);
      pod.scale.set(0.6, 0.66, 1.95);
      group.add(pod);
      // Black tile patch on the pod nose, and the OMS nozzle at the back.
      const podNozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.4, 0.9, 14, 1, true), darkMetal);
      podNozzle.material.side = THREE.DoubleSide;
      podNozzle.rotation.x = Math.PI / 2;
      podNozzle.position.set(side * 1.95, 2.05, 14.3);
      group.add(podNozzle);
    }

    // ---- crew module windows ----
    // Six forward windshields plus a side pair, sunk into the forward fuselage.
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.72, 0.12), glass);
    windshield.position.set(0, 1.02, -13.15);
    windshield.rotation.x = -0.62;
    group.add(windshield);
    const windshieldLow = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.12), glass);
    windshieldLow.position.set(0, 0.52, -13.75);
    windshieldLow.rotation.x = -0.95;
    group.add(windshieldLow);
    for (const side of [1, -1]) {
      const sideWin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 1.1), glass);
      sideWin.position.set(side * 1.18, 0.85, -12.4);
      group.add(sideWin);
    }

    // ---- payload bay doors ----
    // Centreline seam plus the radiator panel edges on the upper surface.
    const baySeam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 15.5), darkMetal);
    baySeam.position.set(0, 2.38, 1.5);
    group.add(baySeam);
    for (const side of [1, -1]) {
      const doorEdge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 15.5), darkMetal);
      doorEdge.position.set(side * 1.75, 1.62, 1.5);
      group.add(doorEdge);
    }

    // ---- markings ----
    const decalMat = (tex) => new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, toneMapped: false,
    });
    // "GeoID" along both sides of the payload bay. A plane rotated ±90° about Y
    // reads correctly from the side it faces. The plane is narrower than the old
    // "UNITED STATES" one — makeTextDecal centres the glyphs in the canvas, so a
    // short word on a 9.5-wide plane would float in a lot of empty space.
    const nameTex = makeTextDecal("GeoID", 512, 128);
    for (const side of [1, -1]) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.2), decalMat(nameTex));
      decal.position.set(side * 2.47, 0.75, 0.5);
      decal.rotation.y = side * (Math.PI / 2);
      group.add(decal);
    }
    // GeoID mark on the left wing, "GeoID" on the right — the layout the US flag
    // and "USA" used to occupy. The logo plane is SQUARE because the source art
    // is 512x512; a 3.4x1.8 plane would stretch it.
    //
    // PLACEMENT IS CONSTRAINED BY THE SWEEP, not by the tip. The wing is a
    // double delta whose leading edge runs (4.6, -1.4) -> (11.1, 7.2) in world
    // X/Z, i.e. Z_le(X) = -1.4 + 1.323*(X - 4.6). A rectangle sitting outboard
    // therefore pokes out AHEAD of that diagonal even though its corners are
    // well inside the tip: at the old x=7.7 outboard edge the leading edge is
    // already back at z=2.70 while the decal front was at z=1.30. Both decals
    // moved inboard and aft so their forward edge clears Z_le at their own
    // outboard corner, with ~1 unit of margin.
    // Sized to fill the usable wing panel rather than to a safe guess: the box
    // is bounded inboard by the fuselage side (x 2.47), outboard/forward by
    // Z_le, and aft by the trailing edge (z 10.0). 3.4 square keeps ~1.0 unit
    // clear of the leading edge at its own outboard corner.
    const logoDecal = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), decalMat(geoidLogoTexture()));
    logoDecal.rotation.x = -Math.PI / 2;
    logoDecal.position.set(-4.8, -0.24, 3.8);
    group.add(logoDecal);
    // No z-rotation here: the plane's local +X already maps to world +X, so the
    // lettering reads correctly from above. Rotating it flipped the text.
    const wingNameDecal = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.3), decalMat(makeTextDecal("GeoID", 512, 256)));
    wingNameDecal.rotation.x = -Math.PI / 2;
    wingNameDecal.position.set(5.0, -0.24, 3.9);
    group.add(wingNameDecal);

    // ---- main engines (3 × SSME) ----
    engineGlow = [];
    thrustCones = [];
    engineBands = [];
    const enginePositions = [[0, 2.15, 14.2], [-1.95, -0.55, 14.4], [1.95, -0.55, 14.4]];
    for (const [ex, ey, ez] of enginePositions) {
      const bell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.78, 1.2, 3.0, 22, 1, true), metal,
      );
      bell.material.side = THREE.DoubleSide;
      bell.rotation.x = Math.PI / 2;
      bell.position.set(ex, ey, ez + 1.4);
      group.add(bell);
      // Powerhead collar where the bell meets the thrust structure.
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 0.9, 18), darkMetal);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(ex, ey, ez - 0.4);
      group.add(collar);

      // Nozzle-exit glow: a soft radial sprite rather than a flat disc, so the
      // throat reads as incandescent instead of as a coloured circle.
      const glowMat = new THREE.SpriteMaterial({
        map: engineGlowTexture(), color: 0xbfe4ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const glowSprite = new THREE.Sprite(glowMat);
      glowSprite.position.set(ex, ey, ez + 2.9);
      glowSprite.scale.set(3.4, 3.4, 1);
      group.add(glowSprite);
      engineGlow.push(glowMat);

      // Layered plume. Each cone has its apex at the nozzle and widens
      // downstream (rotation.x = -π/2 puts the apex at -Z). Three nested
      // shells give the hot white core → blue mid → faint outer halo
      // falloff of a real hydrogen/oxygen exhaust, and additive blending
      // makes the overlaps brighten naturally.
      // Four shells rather than three, each with the density ramp above. The
      // extra one is a very tight, very bright core right at the throat — a real
      // bell is blinding for the first metre or so and pale after that, and a
      // single wide cone cannot express both. Alphas are well below the old
      // values because the ramp concentrates brightness at the nozzle instead of
      // spreading it evenly, so the same peak reads much hotter.
      const plumeLayers = [
        { radius: 0.22, length: 3.4, color: 0xffffff, alpha: 0.95 },
        { radius: 0.46, length: 9,   color: 0xdff1ff, alpha: 0.55 },
        { radius: 1.05, length: 15,  color: 0x9fd8ff, alpha: 0.26 },
        { radius: 1.95, length: 22,  color: 0x4f8fd6, alpha: 0.10 },
      ];
      const layers = [];
      for (const layer of plumeLayers) {
        const mat = new THREE.MeshBasicMaterial({
          color: layer.color, transparent: true, opacity: 0,
          map: plumeTexture(),
          blending: THREE.AdditiveBlending, depthWrite: false,
          side: THREE.DoubleSide,
        });
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(layer.radius, layer.length, 20, 1, true), mat,
        );
        cone.rotation.x = -Math.PI / 2;
        cone.position.set(ex, ey, ez + 2.6 + (layer.length / 2));
        group.add(cone);
        layers.push({ mesh: cone, mat, baseAlpha: layer.alpha, baseZ: ez + 2.6, length: layer.length });
      }

      // Mach shock diamonds along the plume axis — flattened bright spheres
      // that get brighter and tighter as throttle rises.
      const diamonds = [];
      for (let d = 0; d < 4; d += 1) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const dia = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), mat);
        dia.scale.set(1, 1, 2.1);
        dia.position.set(ex, ey, ez + 3.4 + (d * 1.55));
        group.add(dia);
        diamonds.push({ mesh: dia, mat, index: d });
      }

      thrustCones.push({ layers, diamonds, origin: { x: ex, y: ey, z: ez } });
    }

    // ---- aft RCS thrusters + body flap ----
    const bodyFlap = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.35, 2.0), tileBlack);
    bodyFlap.position.set(0, -2.1, 14.6);
    bodyFlap.rotation.x = 0.12;
    group.add(bodyFlap);

    return group;
  }

  // ── Alternate ship models (original stylised geometry) ───────────────────
  // Each returns a Group with userData.nominalLength (its local long-axis size,
  // used by applyShipScale to normalise every model to the chosen display size)
  // and forward pointing −Z, matching the shuttle. Engine-bearing models push
  // their glow/plume meshes onto engineGlow/thrustCones so throttle drives them.

  function signDecal(text, bg, fg) {
    return makeDecalTexture(256, 64, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.font = `bold ${Math.floor(h * 0.5)}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(text, w / 2, h / 2 + 1);
    });
  }

  // Police-box signage. The real box does not read "POLICE BOX" on one line —
  // it is "POLICE" and "BOX" in large caps with "PUBLIC CALL" set small and
  // stacked between them, white on black, so it gets its own painter.
  function policeSignDecal() {
    return makeDecalTexture(1024, 160, (g, w, h) => {
      g.fillStyle = "#07090d"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#f2f5fa";
      g.textBaseline = "middle";
      g.font = `bold ${Math.floor(h * 0.62)}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = "left";
      g.fillText("POLICE", w * 0.045, h * 0.52);
      g.textAlign = "right";
      g.fillText("BOX", w * 0.955, h * 0.52);
      g.font = `bold ${Math.floor(h * 0.29)}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = "center";
      g.fillText("PUBLIC", w * 0.5, h * 0.31);
      g.fillText("CALL", w * 0.5, h * 0.71);
    });
  }

  // The notice board on the left door leaf — white with dense grey body text.
  // Rendered as texture noise rather than real words: at flight scale the panel
  // is a few pixels tall and legible copy would be wasted work.
  function noticeDecal() {
    return makeDecalTexture(256, 320, (g, w, h) => {
      g.fillStyle = "#eceee9"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#2b2f36"; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
      g.fillStyle = "#2b2f36";
      g.font = `bold 21px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = "center";
      g.fillText("POLICE TELEPHONE", w / 2, 44);
      g.fillText("FREE", w / 2, 74);
      g.font = `16px "Helvetica Neue", Arial, sans-serif`;
      for (let i = 0; i < 9; i++) {
        const y = 104 + i * 20;
        const lw = w * (0.5 + 0.32 * Math.abs(Math.sin(i * 1.7)));
        g.fillRect((w - lw) / 2, y, lw, 6);
      }
      g.font = `bold 23px "Helvetica Neue", Arial, sans-serif`;
      g.fillText("PULL TO OPEN", w / 2, h - 26);
    });
  }

  // POLICE BOX — real geometry, not an approximation.
  //
  // Three hand-built versions of this were rejected, and the recurring failure
  // was the roof: it is a stack of shallow overhanging STEPS, and neither a
  // 4-tier taper nor a hipped pyramid reads correctly. Rather than keep guessing
  // silhouettes, the shape now comes from the actual modular-TARDIS print model,
  // assembled and baked to two small STLs by tools/build_tardis_stl.py:
  //   tardis_body.stl     6,622 tris  (base, 4 walls, upper ring, stepped top)
  //   tardis_windows.stl  2,088 tris  (8 windows, lit from inside)
  // 8.7k triangles / 425 KB total — the print set itself is 100 MB and 164k
  // triangles for one size, so only the LOW-POLY parts are used (the plain wall
  // panel is 400 tris where the fully-detailed door panel is 71k). The sign band
  // and lamp stay procedural: as carved geometry they were 10k and 25k triangles
  // each, which is absurd for something a few pixels tall in flight.
  // Shared loader for every baked ship. Returns a record immediately and fills
  // each geometry in as it arrives, calling `onReady` so the builder can attach
  // late parts — builders stay synchronous and the ship appears at once.
  const _bakedGeo = {};
  function loadBakedGeometry(ship, keys) {
    if (_bakedGeo[ship]) return _bakedGeo[ship];
    const rec = _bakedGeo[ship] = {};
    for (const k of keys) rec[k] = null;
    import("./vendor/STLLoader.js").then((mod) => {
      const loader = new mod.STLLoader();
      for (const key of keys) {
        loader.load(`assets/${ship}_${key}.stl`, (geo) => {
          geo.computeVertexNormals();
          geo.userData.shared = true;   // cached per ship; disposeGroup must skip it
          rec[key] = geo;
          rec.onReady?.(key, geo);
        });
      }
    }).catch(() => { /* builder falls back to whatever it draws procedurally */ });
    return rec;
  }

  // TEXTURED MESH LOADER (.gmsh), for sources that arrive with UVs and maps.
  //
  // STL is fine for the ships whose textures were missing or unopenable — they
  // ship as one STL per material and get a flat colour each. But throwing a
  // fully-textured source through that path discards its UVs, its normals and
  // every map, which is what made the saucer render as three flat colours.
  //
  // Layout is written by tools/build_ufo_mesh.py:
  //   "GMSH" | u32 version | u32 vertexCount | u32 indexCount
  //   vertexCount x 8 f32 (px py pz nx ny nz u v), interleaved
  //   indexCount x u32, then u32 groupCount and (start, count, materialIndex)*
  const _gmshGeo = {};
  function loadTexturedMesh(name) {
    if (_gmshGeo[name]) return _gmshGeo[name];
    const rec = _gmshGeo[name] = { geometry: null };
    fetch(`assets/${name}.gmsh`).then((r) => r.arrayBuffer()).then((buf) => {
      const dv = new DataView(buf);
      if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "GMSH") return;
      const vCount = dv.getUint32(8, true);
      const iCount = dv.getUint32(12, true);
      const vBytes = vCount * 8 * 4;
      // Interleaved so position/normal/uv share one upload and one buffer.
      const inter = new THREE.InterleavedBuffer(new Float32Array(buf, 16, vCount * 8), 8);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.InterleavedBufferAttribute(inter, 3, 0));
      geo.setAttribute("normal", new THREE.InterleavedBufferAttribute(inter, 3, 3));
      geo.setAttribute("uv", new THREE.InterleavedBufferAttribute(inter, 2, 6));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, 16 + vBytes, iCount), 1));
      let off = 16 + vBytes + iCount * 4;
      const groupCount = dv.getUint32(off, true); off += 4;
      for (let i = 0; i < groupCount; i += 1) {
        geo.addGroup(dv.getUint32(off, true), dv.getUint32(off + 4, true), dv.getUint32(off + 8, true));
        off += 12;
      }
      geo.computeBoundingSphere();
      geo.userData.shared = true;       // cached per ship; disposeGroup must skip it
      rec.geometry = geo;
      rec.onReady?.(geo);
    }).catch(() => { /* builder simply shows nothing rather than throwing */ });
    return rec;
  }

  // Texture cache. sRGB is set explicitly on colour maps — three.js r152+ treats
  // an unflagged map as linear and the hull comes out washed out and pale.
  const _shipTex = {};
  function shipTexture(file, srgb = true) {
    if (_shipTex[file]) return _shipTex[file];
    const t = new THREE.TextureLoader().load(`assets/${file}`);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.flipY = true;                       // OBJ v is bottom-up, like three's default
    // The source UVs run outside 0..1 (v reaches -0.36), so the maps must tile.
    // Left on the default ClampToEdge those faces smear the texture's edge row.
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.userData.shared = true;           // cached per file; disposeGroup must skip it
    return (_shipTex[file] = t);
  }

  // Attach whatever has already loaded, and whatever arrives later. Late meshes
  // MUST go through applyShipDepthOrder or the label sprites draw over them.
  function attachBaked(group, rec, mats, scale) {
    const put = (key) => {
      const g = rec[key];
      if (!g || !mats[key]) return;
      const m = new THREE.Mesh(g, mats[key]);
      m.scale.setScalar(scale);
      group.add(m);
      applyShipDepthOrder(m);
    };
    for (const key of Object.keys(mats)) put(key);
    rec.onReady = put;
  }

  function buildTardis() {
    const group = new THREE.Group();
    group.userData.nominalLength = 12;
    group.userData.spins = true;
    const body = new THREE.MeshStandardMaterial({ color: 0x2d4a6b, metalness: 0.06, roughness: 0.74 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c1c31, metalness: 0.1, roughness: 0.66 });
    // Opaque: the frames are open between their mullions and the bake now puts a
    // solid backing panel behind each, so nothing should read as see-through.
    const winMat = new THREE.MeshStandardMaterial({
      color: 0xffe9bd, emissive: 0xffc76e, emissiveIntensity: 1.1, roughness: 0.4,
      transparent: false, opacity: 1, side: THREE.FrontSide, depthWrite: true,
    });

    // The STL is 133 units tall in print millimetres; scale it to the same
    // envelope the procedural box used so nothing downstream has to change.
    const H = 9.6, STL_H = 133, k = H / STL_H;
    attachBaked(group, loadBakedGeometry("tardis", ["body", "windows"]),
      { body, windows: winMat }, k);

    // Sign band + lamp, procedural — see the note above on triangle cost.
    // Every figure below is READ OFF THE PRINT MODEL rather than eyeballed: the
    // carved sign occupies z 108.5-115 of a 0-133 assembly, so once centred and
    // scaled its middle sits at 3.27, not the 3.98 a guess had put it (which
    // rode up over the roof overhang). Width 54/133 and height 6.5/133 likewise.
    const SIGN_Y = 3.266;          // (111.75 - 66.5) * k
    const SIGN_R = 2.30;           // wall face is 2.238; sign stands just proud
    const SIGN_W = 3.90, SIGN_H = 0.47;
    const signMat = new THREE.MeshStandardMaterial({ map: policeSignDecal(), roughness: 0.55 });
    for (let face = 0; face < 4; face++) {
      const rot = face * Math.PI / 2, s = Math.sin(rot), c = Math.cos(rot);
      const band = new THREE.Mesh(new THREE.BoxGeometry(SIGN_W, SIGN_H, 0.06), dark);
      band.position.set(s * SIGN_R, SIGN_Y, c * SIGN_R);
      band.rotation.y = rot; group.add(band);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(SIGN_W * 0.95, SIGN_H * 0.78), signMat);
      sign.position.set(s * (SIGN_R + 0.04), SIGN_Y, c * (SIGN_R + 0.04));
      sign.rotation.y = rot; group.add(sign);
    }

    // The "POLICE TELEPHONE / PULL TO OPEN" notice goes on ONE face only — the
    // real box has a single door face and only that one carries it. Position and
    // size are the print model's own DoorSign part (x -17.2..-6.5, z 60.8..75.8
    // of the 0-133 assembly), scaled by k, so it lands under the left window
    // exactly where the kit puts it.
    const notice = new THREE.Mesh(new THREE.PlaneGeometry(0.772, 1.083),
      new THREE.MeshStandardMaterial({ map: noticeDecal(), roughness: 0.62 }));
    notice.position.set(-0.855, 0.131, 2.10);
    group.add(notice);
    applyShipDepthOrder(notice);
    const topY = H * 0.5;
    const mk = (g2, mat, y) => { const m = new THREE.Mesh(g2, mat); m.position.set(0, y, 0); group.add(m); };
    mk(new THREE.CylinderGeometry(0.20, 0.26, 0.14, 10), dark, topY + 0.07);
    mk(new THREE.CylinderGeometry(0.17, 0.17, 0.38, 10),
      new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xffcf7a, emissiveIntensity: 1.5, roughness: 0.32 }),
      topY + 0.33);
    mk(new THREE.CylinderGeometry(0.22, 0.19, 0.10, 10), dark, topY + 0.57);
    return group;
  }

  // STARSHIP — baked from EnterpriseSTL.stl.
  //
  // tools/build_enterprise_from_stl.py. This source arrives at 16,432 triangles,
  // already a sane browser budget, so it ships at FULL RESOLUTION — the previous
  // 3ds Max source needed ~10x decimation and the saucer rim suffered for it.
  //
  // A lone STL has no groups at all, so the split below is rebuilt from
  // CONNECTED COMPONENTS and their position: the bussard domes, nacelle caps and
  // deflector dish are each separate shells. There is no impulse-engine shell in
  // this model, so unlike the old bake there is no impulse group.
  function buildStarship() {
    const group = new THREE.Group();
    group.userData.nominalLength = 26;
    const mats = {
      hull: new THREE.MeshStandardMaterial({ color: 0xe7ebf1, metalness: 0.38, roughness: 0.42 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x99a2b0, metalness: 0.55, roughness: 0.45 }),
      deflector: new THREE.MeshStandardMaterial({
        color: 0xffdca6, emissive: 0xff9a3c, emissiveIntensity: 1.3, roughness: 0.35 }),
      bussard: new THREE.MeshStandardMaterial({
        color: 0xff9a78, emissive: 0xff3311, emissiveIntensity: 1.8, roughness: 0.3 }),
      caps: new THREE.MeshStandardMaterial({
        color: 0xffc98c, emissive: 0xff8a1e, emissiveIntensity: 1.5, roughness: 0.32 }),
    };
    // The bake is 20.1052 units nose-to-tail; nominalLength 26 is the envelope
    // the procedural model used, so nothing downstream moves.
    attachBaked(group, loadBakedGeometry("enterprise", Object.keys(mats)), mats, 26 / 20.1052);

    // ENGINES: pulsing nacelle caps, not plumes. This ship does not throw
    // exhaust — the aft caps glow and throb — and cones read as rocket motors
    // bolted to the nacelles. The bake already isolates those caps as their own
    // shell ("caps"), so that geometry carries the light and brightens with
    // throttle, with a soft round bloom over each.
    engineBands.push({ mat: mats.caps, idle: 0.5, hot: 2.8, pulse: 0.12 });

    // Bloom, one per nacelle. The cap shells sit at +-3.52, y 2.25, z 9.67 in
    // bake units; carried through 26/20.1052 that is +-4.55, 2.91, 12.5, so the
    // sprites sit just off the cap face.
    for (const ex of [-4.55, 4.55]) {
      for (const b of [{ s: 1.9, a: 1.0, z: 13.0 }, { s: 3.6, a: 0.4, z: 13.15 }]) {
        const mat = new THREE.SpriteMaterial({
          map: engineGlowTexture(), color: 0xffc98c, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(ex, 2.91, b.z);
        sprite.scale.set(b.s, b.s, 1);
        group.add(sprite);
        engineGlow.push({ mat, alpha: b.a, pulse: 0.12, tint: 0xffc98c, boostTint: 0xffe8c4 });
      }
    }
    return group;
  }

  // X-FIGHTER — baked from the real mesh in X-wing.blend.
  //
  // tools/build_xfighter_from_blend.py reads the .blend directly (Blender is not
  // installed and bpy has no wheel for this Python, so tools/blend_reader.py
  // walks the file's own DNA1 struct catalogue) and splits it by material slot.
  // It bakes the landing gear UP — the source has it deployed — and adds the
  // exhaust discs, which the source has no emissive slot for. The result can be
  // RENDERED AND CHECKED offline via tools/preview_mesh.py before it ships.
  //
  // SIX FILES, ONE PER MATERIAL. A merged STL carries no per-face material, so
  // everything sharing a file shares a colour — shipping it as a single mesh is
  // exactly why it read as one flat untextured mass in flight.
  function buildXFighter() {
    const group = new THREE.Group();
    group.userData.nominalLength = 17;
    // Groups follow the MATERIAL SLOTS of the source mesh: hull is the fuselage
    // shell, wings covers the S-foils/nacelles/cannons, trim is the mechanical
    // greebling, canopy the glass. Splitting this way is what gives the model its
    // panel colour instead of one flat plastic tone.
    const mats = {
      hull: new THREE.MeshStandardMaterial({ color: 0xdcdee3, metalness: 0.24, roughness: 0.55 }),
      wings: new THREE.MeshStandardMaterial({ color: 0xcbd0d7, metalness: 0.3, roughness: 0.5 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x6a717b, metalness: 0.62, roughness: 0.4 }),
      // Squadron markings. The source's own paint lives in a texture the .blend
      // only references and never packed, so the bake reassigns hull faces into
      // this group instead — a decal laid over the curve would z-fight.
      accent: new THREE.MeshStandardMaterial({ color: 0xb2352b, metalness: 0.2, roughness: 0.55 }),
      canopy: new THREE.MeshStandardMaterial({ color: 0x141f2c, metalness: 0.6, roughness: 0.18 }),
      glow: new THREE.MeshStandardMaterial({
        color: 0xffd2a0, emissive: 0xff7a2c, emissiveIntensity: 1.9, roughness: 0.3 }),
    };
    // The bake is 12.47 units nose-to-tail (real X-wing metres); nominalLength 17
    // is the envelope the old procedural model used, so nothing downstream moves.
    attachBaked(group, loadBakedGeometry("xfighter", Object.keys(mats)), mats, 17 / 12.47);

    // ENGINES: four pulsing lights, not jets. These nacelles vent as glowing
    // discs — plumes made them look like rockets and the cones spilled forward
    // past the wings. The bake already puts an exhaust disc in each nozzle
    // (the "glow" group), so that geometry carries the light and just brightens
    // with throttle; a soft round bloom sits over each one.
    engineBands.push({ mat: mats.glow, idle: 0.55, hot: 2.8, pulse: 0.1 });

    // Bloom, one per nozzle. Centres are the exhaust-disc positions the bake
    // reports (+-1.51, -0.53/+1.23, 6.18 in bake units) carried through the same
    // 17/12.47 scale, so each sits exactly in its nozzle mouth.
    for (const ex of [-2.06, 2.06]) {
      for (const ey of [-0.70, 1.65]) {
        for (const b of [{ s: 1.5, a: 1.0, z: 8.5 }, { s: 2.8, a: 0.4, z: 8.62 }]) {
          const mat = new THREE.SpriteMaterial({
            map: engineGlowTexture(), color: 0xffb473, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
          });
          const sprite = new THREE.Sprite(mat);
          sprite.position.set(ex, ey, b.z);
          sprite.scale.set(b.s, b.s, 1);
          group.add(sprite);
          engineGlow.push({ mat, alpha: b.a, pulse: 0.1, tint: 0xffb473, boostTint: 0xffe6c2 });
        }
      }
    }
    return group;
  }

  // FLYING SAUCER — TEXTURED, from Low_poly_UFO_OBJ.
  //
  // The only source in this project that arrived complete: geometry, UVs, the
  // author's vertex normals, and diffuse/emissive/normal maps. It first shipped
  // through the STL path like the other ships and looked cheap for a specific
  // reason — STL carries no UVs, so a richly panelled hull collapsed into three
  // flat colours, and no per-vertex normals, so every facet shaded flat.
  //
  // tools/build_ufo_mesh.py writes a .gmsh instead (see loadTexturedMesh) and
  // the real maps are bound below. The bake is PRE-SCALED to the 15-unit
  // envelope, so unlike the STL ships there is no scale factor here.
  function buildSaucer() {
    const group = new THREE.Group();
    group.userData.nominalLength = 15;
    // emissive is white so the glow map's own green comes through unchanged;
    // tinting it here would fight the artist's map.
    const body = new THREE.MeshStandardMaterial({
      map: shipTexture("ufo_diffuse.jpg"),
      emissiveMap: shipTexture("ufo_glow.png"),
      emissive: 0xffffff,
      emissiveIntensity: 1.35,
      normalMap: shipTexture("ufo_normal.jpg", false),
      metalness: 0.45,
      roughness: 0.55,
    });
    const trim = new THREE.MeshStandardMaterial({
      map: shipTexture("ufo_diffuse2.jpg"),
      emissiveMap: shipTexture("ufo_glow2.png"),
      emissive: 0xffffff,
      emissiveIntensity: 1.35,
      metalness: 0.45,
      roughness: 0.55,
    });
    const rec = loadTexturedMesh("ufo");
    const put = (geo) => {
      const m = new THREE.Mesh(geo, [body, trim]);   // groups index this array
      group.add(m);
      applyShipDepthOrder(m);
    };
    if (rec.geometry) put(rec.geometry); else rec.onReady = put;
    return group;
  }

  // FREIGHTER — baked from a Blender OBJ export of the Millennium Falcon.
  //
  // tools/build_falcon_from_obj.py. The source shipped without its .mtl and its
  // surviving usemtl names are all "None", so there is no material information
  // at all — the split below comes from the object layers, and which layer is
  // which is counter-intuitive: the 229k-triangle object is the GREEBLING and
  // the 21k one is the smooth plating. Getting that backwards paints the ship
  // inside out, so the bake decides it by surface area, not triangle count.
  function buildFalcon() {
    const group = new THREE.Group();
    group.userData.nominalLength = 20;
    const mats = {
      hull: new THREE.MeshStandardMaterial({ color: 0xcdc8ba, metalness: 0.3, roughness: 0.55 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x8a8880, metalness: 0.5, roughness: 0.5 }),
      engine: new THREE.MeshStandardMaterial({
        color: 0xdff0ff, emissive: 0x59b8ff, emissiveIntensity: 2.0, roughness: 0.25 }),
    };
    // The bake is 4.2918 units nose-to-tail in source units.
    attachBaked(group, loadBakedGeometry("falcon", Object.keys(mats)), mats, 20 / 4.2918);

    // ENGINE: a lit band, not a plume. This drive is a continuous slot across the
    // back of the hull that glows blue-white — it does not throw exhaust cones,
    // and building it from five cone emitters produced what looked like landing
    // searchlights raking the ground. So the vent's OWN geometry carries the
    // light (its emissive is driven by throttle) and a pair of wide, flat
    // additive streaks sit just behind it for bloom.
    engineBands.push({ mat: mats.engine, idle: 0.35, hot: 2.9 });

    // Bloom, sized to the vent: it spans x -4.83..3.89 and sits at y -0.2, z 9.0
    // (genuinely off-centre in the source, so these follow it rather than being
    // forced symmetric). Two layers — a tight core and a wider halo at lower
    // alpha — read as a soft glow instead of a hard rectangle.
    for (const s of [
      { w: 9.6, h: 1.0, z: 9.15, alpha: 1.0 },
      { w: 12.4, h: 2.6, z: 9.35, alpha: 0.45 },
    ]) {
      const mat = new THREE.SpriteMaterial({
        map: engineGlowTexture(), color: 0xbfe4ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(-0.47, -0.2, s.z);
      sprite.scale.set(s.w, s.h, 1);
      group.add(sprite);
      engineGlow.push({ mat, alpha: s.alpha, tint: 0xbfe4ff, boostTint: 0xd8ecff });
    }
    return group;
  }

  const SHIP_BUILDERS = {
    shuttle: buildShuttle, tardis: buildTardis, starship: buildStarship,
    xfighter: buildXFighter, falcon: buildFalcon, saucer: buildSaucer,
  };

  function buildShip() {
    const model = shipModelSelect?.value || "shuttle";
    engineGlow = [];
    thrustCones = [];
    engineBands = [];
    const group = (SHIP_BUILDERS[model] || buildShuttle)();
    group.userData.model = model;
    group.visible = false;
    group.traverse((o) => { o.raycast = () => {}; }); // never intercept viewer picking
    // DEPTH ORDER vs LABELS. Feature labels are transparent sprites drawn with
    // depthTest:false and renderOrder 93, so they paint over anything already in
    // the framebuffer. The ship was OPAQUE, and three.js renders the whole
    // opaque list before the transparent one — so no renderOrder on an opaque
    // ship could ever beat them, and labels drew across the hull.
    // Putting the ship in the TRANSPARENT list (opacity still 1) with a
    // renderOrder above the labels makes it draw last and sit in front.
    // depthTest/depthWrite stay ON, so terrain in front of the ship still
    // occludes it correctly — only the label sprites are overtaken.
    group.renderOrder = 400;
    group.traverse(applyShipDepthOrder);
    hooks.scene.add(group);
    return group;
  }

  // Applied to every mesh in a ship, and it MUST be re-applied to anything added
  // to a ship after buildShip() has run — an async-loaded STL part attaches long
  // after that traverse, so without this it keeps renderOrder 0 and stays opaque,
  // and the label sprites paint straight over it.
  function applyShipDepthOrder(o) {
    o.raycast = () => {};                 // never intercept viewer picking
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      m.transparent = true;
      m.depthTest = true;
      m.depthWrite = true;
      m.needsUpdate = true;
    }
    o.renderOrder = 400;
  }

  // Two things this has to get right, and the original got neither:
  //
  // 1. A MESH'S MATERIAL CAN BE AN ARRAY. The saucer draws its two texture groups
  //    from one geometry, so its material is [body, trim]. Calling m.dispose()
  //    on the array threw, and because that threw inside rebuildShip() the
  //    replacement ship was never built — so after selecting the saucer, EVERY
  //    later model rendered nothing.
  // 2. BAKED GEOMETRY AND TEXTURES ARE SHARED. loadBakedGeometry/loadTexturedMesh
  //    cache per ship type and shipTexture caches per file, precisely so
  //    switching back does not refetch. Disposing them here quietly destroyed
  //    the cache, so returning to a ship reused a disposed buffer.
  //    Anything cached is tagged userData.shared and skipped.
  function disposeGroup(g) {
    const disposeMaterial = (m) => {
      if (!m || typeof m.dispose !== "function") return;
      for (const slot of ["map", "emissiveMap", "normalMap", "alphaMap", "roughnessMap"]) {
        const tex = m[slot];
        if (tex && !tex.userData?.shared) tex.dispose();
      }
      m.dispose();
    };
    g.traverse((o) => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      if (Array.isArray(o.material)) o.material.forEach(disposeMaterial);
      else disposeMaterial(o.material);
    });
  }

  function rebuildShip() {
    if (!hooks) return;
    if (ship) { hooks.scene.remove(ship); disposeGroup(ship); }
    ship = buildShip();
    applyShipScale();
    ship.visible = fs.active && state.cam !== "cockpit";
  }

  function shipDisplayLengthUnits() {
    // Ship display size is fixed at cinematic — the selector was removed, and
    // this was already its fallback, so the value is unchanged.
    const meters = SHIP_SIZES_M.cinematic;
    return meters / METERS_PER_UNIT;
  }

  // Ground clearance scales with the displayed ship so the hull never visually
  // buries itself in the terrain. 0.55 of LENGTH was sized when an "arcade"
  // 6 km ship existed; that option is gone and only the 600 m cinematic size
  // remains, where 0.55 meant the ship was flown 330 m above the ground and
  // shoved upward long before anything visually touched — the reported
  // premature skimming. What the clamp actually needs to clear is the hull's
  // half-DEPTH, not half its length: a shuttle's belly sits ~0.1 of its length
  // below centre, so 0.15 leaves margin without flying it up a mountain.
  const HULL_DEPTH_FRACTION = 0.15;
  function minClearanceUnits() {
    return Math.max(
      MIN_CLEARANCE_M / METERS_PER_UNIT,
      shipDisplayLengthUnits() * HULL_DEPTH_FRACTION,
    );
  }

  // ---- crash sequence ----
  let explosion = null;
  let explosionT = 0;
  function buildExplosion() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,244,214,1)");
    grd.addColorStop(0.22, "rgba(255,196,110,0.95)");
    grd.addColorStop(0.5, "rgba(255,120,50,0.55)");
    grd.addColorStop(1, "rgba(120,30,10,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.raycast = () => {};
    hooks.scene.add(sprite);
    return sprite;
  }

  function triggerCrash(ll) {
    const s = state;
    s.crashed = true;
    s.crashTimer = 2.8;
    s.crashLatLon = ll;
    s.speed = 0;
    s.vel.set(0, 0, 0);
    if (ship) ship.visible = false;
    setThrustVisuals(0, false);
    if (!explosion) explosion = buildExplosion();
    explosion.position.copy(state.pos).setLength(surfaceRadiusAt(ll.lat, ll.lon));
    explosion.visible = true;
    explosion.material.opacity = 1;
    explosionT = 0;
    flash("⚠ SHIP DOWN");
  }

  function respawnAfterCrash(camera) {
    const s = state;
    const ll = s.crashLatLon || worldToLatLon(s.pos);
    const radius = surfaceRadiusAt(ll.lat, ll.lon) + 8000 / METERS_PER_UNIT;
    s.pos = latLonToWorld(ll.lat, ll.lon, radius);
    s.quat = tangentBasisQuat(s.pos);
    s.vel = new THREE.Vector3();
    s.speed = 0;
    s.throttle = LAUNCH_THROTTLE;
    // Ramp position, not an energy reserve — launch at cruise, not at the top.
    s.boost = 0;
    s._camOff = null;
    s.crashed = false;
    s.crashLatLon = null;
    // CLEAR THE TILE FAILURE COOLDOWNS. A tile the proxy cannot supply comes
    // back 504, and _getTileFailureCooldownMs treats anything >= 500 as a
    // transient server fault worth a TWO MINUTE backoff. Over ground where a
    // whole level is absent — Olympus has L10 0/16, L9 0/16 and 10 of 16 L11
    // tiles missing — that stamps the entire area as un-fetchable, and nothing
    // cleared it on respawn. Redeploying at 8 km over the same spot therefore
    // came up blank and stayed blank until the backoff expired, which is the
    // "wipe still prevalent after crash" report.
    //
    // A redeploy is a deliberate fresh start, so retry from clean. Genuinely
    // dead tiles simply 504 again and re-arm their own cooldown; the cost is
    // one wasted round, against a scene that otherwise cannot recover.
    try {
      const cs = window.__ctxUpgradeDebug?.ctxStreamer;
      cs?._failedUntil?.clear?.();
      cs?._failedStatus?.clear?.();
      const ds = window.__ctxUpgradeDebug?.ctxDetailStreamer;
      ds?._failedUntil?.clear?.();
      ds?._failedStatus?.clear?.();
    } catch (_) { /* diagnostics only — never block a respawn */ }
    if (explosion) explosion.visible = false;
    if (ship) {
      ship.visible = s.cam !== "cockpit";
      ship.position.copy(s.pos);
      ship.quaternion.copy(s.quat);
    }
    camera.position.copy(s.pos.clone().add(
      new THREE.Vector3(0, 0, 1).applyQuaternion(s.quat).multiplyScalar(shipDisplayLengthUnits() * 2.6)
    ));
    flash("SHIP REDEPLOYED — 8 KM");
  }

  function runCrash(dt, camera) {
    const s = state;
    explosionT += dt;
    if (explosion) {
      const L = shipDisplayLengthUnits();
      const grow = L * (1.5 + explosionT * 9);
      explosion.scale.set(grow, grow, 1);
      explosion.material.opacity = Math.max(0, 1 - explosionT / 1.4);
    }
    // brief camera shake, decaying over the sequence
    const shake = Math.max(0, 0.6 - explosionT) * shipDisplayLengthUnits() * 0.25;
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.position.z += (Math.random() - 0.5) * shake;
    }
    if (explosion) camera.lookAt(explosion.position);
    s.crashTimer -= dt;
    if (s.crashTimer <= 0) respawnAfterCrash(camera);
  }

  function applyShipScale() {
    if (!ship) return;
    const nominal = ship.userData.nominalLength || SHIP_NOMINAL_LENGTH;
    ship.scale.setScalar(shipDisplayLengthUnits() / nominal);
  }

  // ---- orientation ----
  // Orientation for an explicit compass heading. Uses EXACTLY the frame the HUD
  // readout uses — east = Y x up, north = up x east, hdg = atan2(fwd.east,
  // fwd.north) — so a dial set to 090 reads 090 in the cockpit. (The default
  // tangentBasisQuat faces due east, i.e. heading 090, which is why every
  // unspecified launch has shown 090 on the HUD.)
  function headingQuat(pos, headingDeg) {
    const up = pos.clone().normalize();
    let east = new THREE.Vector3().crossVectors(planetAxis(), up);
    if (east.lengthSq() < 1e-10) east.set(1, 0, 0); else east.normalize();
    const north = new THREE.Vector3().crossVectors(up, east).normalize();
    const h = headingDeg * Math.PI / 180;
    const fwd = north.clone().multiplyScalar(Math.cos(h))
      .addScaledVector(east, Math.sin(h)).normalize();
    const bZ = fwd.clone().negate();                       // ship forward is -Z
    const bX = new THREE.Vector3().crossVectors(up, bZ).normalize();
    const bY = new THREE.Vector3().crossVectors(bZ, bX).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(bX, bY, bZ));
  }

  function tangentBasisQuat(pos, headingEast = true) {
    const up = pos.clone().normalize();
    let right = new THREE.Vector3().crossVectors(planetAxis(), up);
    if (right.lengthSq() < 1e-10) right.set(1, 0, 0); else right.normalize();
    const fwd = headingEast
      ? right.clone()                                        // due east
      : new THREE.Vector3().crossVectors(up, right).normalize(); // due south-ish
    const bZ = fwd.clone().negate();  // ship forward is −Z
    const bX = new THREE.Vector3().crossVectors(up, bZ).normalize();
    const bY = new THREE.Vector3().crossVectors(bZ, bX).normalize();
    const m = new THREE.Matrix4().makeBasis(bX, bY, bZ);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  function levelOut() {
    if (!state.pos) return;
    state.quat.copy(tangentBasisQuat(state.pos));
    state.vel.set(0, 0, 0);
    state.speed = 0;
    state.throttle = LAUNCH_THROTTLE;
    flash("LEVELED — HEADING EAST");
  }

  // ---- engage / disengage ----
  // WebGL context-loss recovery. On a weak/integrated GPU (e.g. Intel Mesa) a
  // heavy low-altitude scene can make the driver drop the WebGL context. WITHOUT
  // calling preventDefault() the browser leaves it lost forever → permanent black
  // screen ("crash"). preventDefault() makes the browser RESTORE the context;
  // three.js then re-uploads its retained textures/geometries on the next render,
  // and we nudge the tile streamer to rebuild. Turns a fatal crash into a blink.
  let _ctxRecoveryInstalled = false;
  function installContextLossRecovery() {
    if (_ctxRecoveryInstalled || !hooks?.renderer?.domElement) return;
    _ctxRecoveryInstalled = true;
    const canvas = hooks.renderer.domElement;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      flash("⚠ GRAPHICS RESET — RECOVERING");
    }, false);
    canvas.addEventListener("webglcontextrestored", () => {
      try { hooks.ctxDetailStreamer?.rebuild?.(); } catch (_e) {}
      try { hooks.syncTerrainReliefState?.(); } catch (_e) {}
      flash("GRAPHICS RESTORED");
    }, false);
  }

  // Repair the base globe texture. In this build the shared "viking-color" base
  // texture (the Mars color mosaic the globe wears AND the LUT that colorizes the
  // CTX tiles) can end up with NO image attached — an async load race: mars_color
  // .jpg fetches fine (HTTP 200) but never lands on the THREE texture. The globe
  // then renders DARK and shows through as a "gap"/void between CTX tiles while
  // they stream. Re-attach the image so every gap falls back to a bright Mars
  // surface and the tile colorization is correct. Safe (idempotent) repair.
  function repairBaseTexture() {
    const vk = hooks?.layerTextures?.get?.("viking-color");
    if (!vk || vk.image) return;
    const path = (window.__marsViewerManifest?.texture?.path) || "https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_color.jpg?v=aff5dbff30d7";
    let url; try { url = new URL(path, document.baseURI).href; } catch (_e) { url = path; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      vk.image = img;
      vk.needsUpdate = true;
      if (hooks.globe?.material) hooks.globe.material.needsUpdate = true;
    };
    img.src = url;
  }

  function engage(spec) {
    if (!hooks || fs.active) return;
    if (hooks.isMoonViewerActive()) { flash("EXIT MOON VIEWER FIRST"); syncToggle(false); return; }
    installContextLossRecovery();
    repairBaseTexture();
    // The amber flight palette belongs to BEING IN FLIGHT, not to having passed
    // through pre-flight. enterPreflight() was the only caller, so any direct
    // engage() (deep links, the spec API, tests) flew with the cyan orbit theme
    // and every accent-coloured HUD element came out the wrong colour.
    // setFlightTheme guards its own saved previous mode, so this is idempotent.
    setFlightTheme(true);
    document.body.classList.add("fs-flying"); // drives flight-only UI (hides logo, etc.)
    // Collapse the nav the moment we launch — the cockpit view should be clear
    // on arrival. The panel is NOT gone: reopening it from the tab gives the
    // flight-filtered layer stack (Locations, Basemap and Relief, Geology, Sea
    // Level, Legend, Regions), so layers stay controllable in the air. Pre-flight
    // deliberately leaves it open, since that is where the site is chosen.
    document.getElementById("nav-collapse-btn")?.click();

    // 1. Default to the CTX (color) streamed basemap, per the sim's design.
    if (!ctxModeActive() && hooks.baseLayerSelect) {
      hooks.baseLayerSelect.value = "ctx-mosaic-color";
      hooks.baseLayerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    // 2. Enable relief in CTX mode and set the stock terrain-relief slider
    // (Basemap and Relief section) to true 1:1 scale. The slider stays live
    // during flight — drag it there for vertical exaggeration, exactly like
    // the normal viewer.
    fs.maxDetailLevel = Number(detailLevelSelect?.value) || 9;
    fs.forceRelief = true;
    if (hooks.terrainScale) {
      preFlightReliefValue = hooks.terrainScale.value;
      applyVex(); // set relief from the flight-tab exaggeration slider (defaults to ×1 true scale)
    } else {
      hooks.syncTerrainReliefState();
    }
    hooks.pauseSpin();

    // 3. Spawn at the LAUNCH SPEC if one was set in pre-flight, otherwise fall
    // back to the sub-camera point (the old implicit behaviour, kept so any
    // other caller of engage() still works).
    const cam = hooks.camera;
    const here = (spec && Number.isFinite(spec.lat) && Number.isFinite(spec.lon))
      ? { lat: spec.lat, lon: spec.lon }
      : worldToLatLon(cam.position);
    const startAltM = Number(startAltSelect?.value || 30000);
    const radius = surfaceRadiusAt(here.lat, here.lon) + startAltM / METERS_PER_UNIT;
    if (!ship) ship = buildShip();
    applyShipScale();
    state.pos = latLonToWorld(here.lat, here.lon, radius);
    state.quat = Number.isFinite(spec?.heading)
      ? headingQuat(state.pos, spec.heading)
      : tangentBasisQuat(state.pos);
    state.vel = new THREE.Vector3();
    state.speed = 0;
    state.throttle = LAUNCH_THROTTLE;
    // Boost is now a RAMP position, not an energy reserve: start at 0 (cruise)
    // so the ship does not launch already at the top of the range.
    state.boost = 0;
    // Chase offset is damped, so a stale one from a previous flight would be
    // eased out of visibly on the first frames. Snap it on the next update.
    state._camOff = null;
    state.cam = cameraModeSelect?.value || "chase";
    state.lastT = 0;
    state.dtSmooth = 0;      // don't inherit the previous flight's frame pacing
    state.distM = 0;
    state.prevDir = null;    // odometer restarts with each flight
    ship.visible = state.cam !== "cockpit";
    ship.position.copy(state.pos);
    ship.quaternion.copy(state.quat);

    // 4. Hand the camera to the flight model.
    hooks.controls.enabled = false;
    cam.position.copy(state.pos.clone().add(
      new THREE.Vector3(0, 0, 1).applyQuaternion(state.quat).multiplyScalar(shipDisplayLengthUnits() * 2.6)
    ));

    fs.active = true;
    // Re-run relief sync now that flight is officially active — it re-enables
    // the terrain slider (kept disabled in CTX modes outside flight).
    hooks.syncTerrainReliefState();
    syncToggle(true);
    // Drop focus from whatever was clicked (usually the engage checkbox) so
    // the keyboard immediately flies the ship.
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur?.();
    }
    if (hud) hud.hidden = false;
    syncHudCanvasSizes();
    updateCamTag();
    hooks.setStatus?.("Flight mode engaged — Esc to exit.");
    flash("FLIGHT MODE ENGAGED · GODSPEED");
  }

  function disengage() {
    if (!fs.active) return;
    fs.active = false;
    document.body.classList.remove("fs-flying");
    document.getElementById("nav-tab")?.click(); // reopen the nav panel on exit
    fs.forceRelief = false;
    fs.focusLatLon = null;
    fs._releaseTouchKeys?.();   // a held pad button must not survive the flight
    for (const k of Object.keys(keys)) keys[k] = false;
    state.crashed = false;
    state.crashLatLon = null;
    if (explosion) explosion.visible = false;
    if (hooks.terrainScale && preFlightReliefValue !== null) {
      hooks.terrainScale.value = preFlightReliefValue;
      preFlightReliefValue = null;
      hooks.terrainScale.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      hooks.syncTerrainReliefState();
    }
    if (ship) ship.visible = false;
    if (hud) hud.hidden = true;
    syncToggle(false);

    // Return the camera to OrbitControls: restore up-vector, back away from
    // the surface so the orbit floor doesn't fight, aim at the planet.
    const cam = hooks.camera;
    cam.up.set(0, 1, 0);
    const minLen = GLOBE_R + Math.max(0.03, hooks.getEffectiveTerrainRelief() + 0.005);
    if (cam.position.length() < minLen) cam.position.setLength(minLen);
    cam.near = 0.1;
    cam.updateProjectionMatrix();
    cam.lookAt(0, 0, 0);
    hooks.controls.enabled = true;
    hooks.controls.update();
    hooks.setStatus?.("Flight mode disengaged.");
  }

  function syncToggle(checked) {
    if (flightToggle && flightToggle.checked !== checked) flightToggle.checked = checked;
  }

  function updateCamTag() {
    if (hudCamTag) hudCamTag.textContent = "CAM: " + state.cam.toUpperCase();
  }

  function toggleCam() {
    state.cam = state.cam === "chase" ? "cockpit" : "chase";
    // Returning to chase must snap, not ease in from wherever cockpit left it.
    state._camOff = null;
    if (cameraModeSelect) cameraModeSelect.value = state.cam;
    if (ship) ship.visible = state.cam !== "cockpit";
    updateCamTag();
    flash(state.cam === "cockpit" ? "COCKPIT VIEW" : "CHASE VIEW");
  }

  // ---- 360° bearing tape ----
  // A strip of the compass rose scrolling under a fixed centre index, the way a
  // real HSI tape reads: the number under the index IS your heading, and turns
  // move the world rather than a needle. Drawn to a canvas rather than built
  // from DOM ticks because it repaints every frame.
  const BEARING_SPAN_DEG = 110;          // total width of the visible arc
  let bearingCtx = null, bearingLastDeg = null;
  function drawBearingTape(hdg) {
    const cv = bearingCanvas;
    if (!cv) return;
    if (bearingLastDeg !== null && Math.abs(hdg - bearingLastDeg) < 0.05) return;
    bearingLastDeg = hdg;
    if (!bearingCtx) bearingCtx = cv.getContext("2d");
    const ctx = bearingCtx;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const pxPerDeg = W / BEARING_SPAN_DEG;
    const mid = W / 2;
    const rootStyle = getComputedStyle(document.documentElement);
    const accent = rootStyle.getPropertyValue("--nav-accent").trim() || "#ffc93c";
    // The tape is drawn entirely in the accent (yellow in flight); cardinals are
    // picked out in white so N/E/S/W still separate from the numeric bearings.
    const accentRgb = rootStyle.getPropertyValue("--nav-accent-rgb").trim() || "255, 201, 60";
    const CARDINALS = { 0: "N", 90: "E", 180: "S", 270: "W" };
    const first = Math.ceil((hdg - BEARING_SPAN_DEG / 2) / 5) * 5;
    ctx.textAlign = "center";
    for (let d = first; d <= hdg + BEARING_SPAN_DEG / 2; d += 5) {
      const x = mid + (d - hdg) * pxPerDeg;
      const deg = ((d % 360) + 360) % 360;
      const major = deg % 15 === 0;
      const label = CARDINALS[deg] || (deg % 30 === 0 ? String(deg).padStart(3, "0") : null);
      // Fade the ends so the tape reads as a window onto a continuous rose
      // rather than a strip that stops.
      const edge = Math.abs(x - mid) / (W / 2);
      ctx.globalAlpha = Math.max(0, 1 - Math.pow(edge, 2.2));
      ctx.strokeStyle = `rgba(${accentRgb}, ${major ? 0.95 : 0.6})`;
      ctx.lineWidth = major ? 2 : 1.4;
      ctx.beginPath();
      ctx.moveTo(x, H * 0.46);
      ctx.lineTo(x, major ? H * 0.9 : H * 0.72);
      ctx.stroke();
      if (label) {
        ctx.fillStyle = CARDINALS[deg] ? "#ffffff" : accent;
        ctx.font = `600 ${Math.round(H * 0.44)}px "Exo 2", "Segoe UI", sans-serif`;
        ctx.fillText(label, x, H * 0.34);
      }
    }
    ctx.globalAlpha = 1;
    // Centre index — the heading you are actually on.
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(mid, H * 0.40);
    ctx.lineTo(mid - H * 0.18, H * 0.06);
    ctx.lineTo(mid + H * 0.18, H * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(mid - 1, H * 0.40, 2, H * 0.58);
  }

  // ---- atmospheric conditions at the ship, not at the surface ----
  // The viewer's surface-conditions panel answers "what is it like on the ground
  // under the cursor", which is the wrong question from a cockpit at 100 km. This
  // is the NASA Glenn simple Mars atmosphere model (two-layer fit to Mars GRAM /
  // Viking data), evaluated at the ship's own height above the datum.
  function marsAtmosphere(hMeters) {
    const h = Math.max(0, hMeters);
    // The Glenn fit is only quoted to ~30 km, and its LINEAR upper-layer term
    // keeps falling: extrapolated to 108 km it reads -263 °C, i.e. 10 K above
    // absolute zero, which is nonsense on an instrument. Mars' middle atmosphere
    // is roughly isothermal near -130 °C from the mesosphere up, so hold there
    // rather than run the fit outside its range. The sim flies to 300 km.
    const MESOSPHERE_C = -130;
    const raw = h < 7000 ? -31 - 0.000998 * h : -23.4 - 0.00222 * h;
    const tempC = Math.max(raw, MESOSPHERE_C);
    // Exponential with an ~11 km scale height. Rough above the fit's range too,
    // but it stays the right order of magnitude and never goes unphysical.
    const pressurePa = 699 * Math.exp(-0.00009 * h);
    return { tempC, pressurePa };
  }

  // Colour ramps for the two environment readouts, running the CONVENTIONAL
  // direction: cold/low = blue, hot/high = red. This deliberately overrides the
  // earlier "no blue text on the flight HUD" rule for these two cells only, at
  // the user's request — a thermometer that runs pale-to-red reads as wrong to
  // anyone who has seen one before, and the convention is worth more here than
  // palette purity. Matches the hues the viewer's own surface-conditions panel
  // already uses (#6ec6ff / #90d8e8 / #e8c97a / #ff7a5a).
  const rampFor = (v, stops) => {
    for (const [limit, colour] of stops) if (v < limit) return colour;
    return stops[stops.length - 1][1];
  };
  // Bands are scaled to the range this atmosphere model ACTUALLY produces, not to
  // a generic thermometer: it spans -130 °C (isothermal mesosphere floor) to
  // -31 °C (datum), and 0 to 699 Pa. Bands centred on 0 °C would have left the
  // whole flight envelope sitting in one blue bucket with red unreachable.
  const TEMP_STOPS = [
    [-118, "#5aa9ff"],                    // mesosphere floor — coldest it gets
    [-100, "#6ec6ff"],
    [-80, "#90d8e8"],
    [-60, "#e8c97a"],
    [-45, "#ff9d3c"],
    [Infinity, "#ff6a4d"],                // near datum — warmest it gets
  ];
  const PRESS_STOPS = [
    [0.01, "#5aa9ff"],                    // effectively vacuum
    [1, "#6ec6ff"],
    [30, "#90d8e8"],
    [150, "#e8c97a"],
    [400, "#ff9d3c"],
    [Infinity, "#ff6a4d"],                // dense — deep basin floor
  ];

  function updateFlightAtmosphere(altAboveDatumM) {
    if (!hudTemp || !hudPress) return;
    const { tempC, pressurePa } = marsAtmosphere(altAboveDatumM);
    hudTemp.textContent = `${tempC > 0 ? "+" : ""}${Math.round(tempC)} °C`;
    hudTemp.style.color = rampFor(tempC, TEMP_STOPS);
    hudPress.textContent = pressurePa >= 1 ? `${pressurePa.toFixed(pressurePa < 10 ? 1 : 0)} Pa`
      : pressurePa >= 0.001 ? `${pressurePa.toFixed(3)} Pa`
      : "< 10\u207B\u00B3 Pa";
    hudPress.style.color = rampFor(pressurePa, PRESS_STOPS);
  }

  // ---- per-frame update (called from the viewer render loop) ----
  function update(camera) {
    if (!fs.active) return;
    if (hooks.isMoonViewerActive()) { disengage(); return; }

    const now = performance.now();
    let dt = state.lastT ? (now - state.lastT) / 1000 : 0;
    state.lastT = now;
    // The clamp exists to stop a genuine hitch (tab switch, GC pause) from
    // teleporting the ship. It was 0.05 s — i.e. 20 fps — but this page routinely
    // runs 8-20 fps while tiles stream, so at any normal frame rate the sim was
    // advancing LESS time than really elapsed and everything ran in slow motion:
    // measured 0.087 s of sim time per second of wall clock at 3.3 fps, which is
    // why holding the throttle open barely moved it. 0.25 s still bounds a real
    // hitch while letting an ordinary slow frame integrate honestly.
    dt = Math.min(0.25, Math.max(0, dt));
    if (!dt) return;
    // SMOOTHED INTEGRATION STEP. Frame times on this page are genuinely
    // irregular — tile draws, tone solves and multi-MB texture uploads land on
    // arbitrary frames — and integrating the RAW dt turns every one of those
    // hitches straight into a visible jump in ship position and attitude.
    // The average is taken with a fixed TIME CONSTANT rather than a fixed
    // per-frame weight: `0.88/0.12` converges in a fixed number of FRAMES, so at
    // 3 fps it needed ~15 s of wall clock to catch up and spent all of it
    // under-integrating. `1 - e^(-dt/TAU)` converges in 0.25 s of real time at
    // any frame rate. Physics-affecting terms below use `dts`; wall-clock timers
    // (crash sequence, HUD message expiry) keep the raw dt.
    const DT_SMOOTH_TAU = 0.25;
    state.dtSmooth = state.dtSmooth
      ? state.dtSmooth + (dt - state.dtSmooth) * (1 - Math.exp(-dt / DT_SMOOTH_TAU))
      : dt;
    const dts = state.dtSmooth;

    const s = state;

    if (s.crashed) {
      runCrash(dt, camera);
      return;
    }

    // rotational control (body axes)
    let pitch = 0, yaw = 0, roll = 0;
    if (keys.ArrowUp) pitch += PITCH_RATE;
    if (keys.ArrowDown) pitch -= PITCH_RATE;
    // Arrows YAW (turn), A/D ROLL. The stick-and-rudder convention is the other
    // way round — arrows roll, A/D rudder — but for an explorer the obvious
    // reading of "press left" is "turn left", not "bank left", and the on-screen
    // d-pad makes that expectation stronger still.
    if (keys.ArrowLeft) yaw += YAW_RATE;
    if (keys.ArrowRight) yaw -= YAW_RATE;
    if (keys.KeyA) roll += ROLL_RATE;
    if (keys.KeyD) roll -= ROLL_RATE;
    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * dts, yaw * dts, roll * dts, "XYZ"));
    s.quat.multiply(dq).normalize();

    // throttle trim
    if (keys.KeyW) s.throttle = Math.min(1, s.throttle + 0.5 * dts);
    if (keys.KeyS) s.throttle = Math.max(0, s.throttle - 0.6 * dts);

    // BOOST IS A RAMP, NOT A SWITCH. It used to be a fixed x2.6 gated by an
    // energy bar that drained in ~3.5 s, so top speed arrived instantly and
    // could not be held. Holding it now ACCELERATES: `s.boost` climbs while the
    // key is down and decays when released, and it interpolates the speed
    // ceiling from cruise up to the altitude-allowed maximum. The existing HUD
    // bar reads as "how far up the speed range you are" instead of "how much
    // boost is left", which is the same bar showing something more useful.
    s.boosting = Boolean(keys.ShiftLeft || keys.ShiftRight);
    if (s.boosting) s.boost = Math.min(1, s.boost + 0.22 * dts);   // ~4.5 s to full
    else s.boost = Math.max(0, s.boost - 0.5 * dts);               // ~2 s to shed

    s.braking = Boolean(keys.Space);

    // speed dynamics (scene units)
    //
    // Altitude here is above the DATUM, not the terrain: the ceiling is about
    // how much ground is in view, which the datum gives directly, and using
    // terrain height would make the ceiling twitch as hills pass underneath.
    const altKmForSpeed = Math.max(0, s.pos.length() - GLOBE_R) * METERS_PER_UNIT / 1000;
    const ceilKmS = speedCeilingKmS(altKmForSpeed);
    const cruiseKmS = Math.min(MAX_SPEED_MS / 1000, ceilKmS);
    // Boost interpolates cruise -> ceiling, so the top of the range is only
    // available where the view is wide enough to absorb a hitch at that speed.
    const maxKmS = cruiseKmS + (ceilKmS - cruiseKmS) * s.boost;
    s.speedCeilKmS = ceilKmS;
    s.speedMaxKmS = maxKmS;
    const maxSpeed = (maxKmS * 1000) / METERS_PER_UNIT;
    const target = s.throttle * maxSpeed;
    const rate = s.boosting ? 2.4 : 1.4;
    s.speed += (target - s.speed) * Math.min(1, rate * dts * (target > s.speed ? 1.4 : 1));
    if (s.braking) s.speed *= (1 - 1.4 * dts);
    s.speed = Math.max(0, s.speed);

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
    const up = s.pos.clone().normalize();
    // Ground-track odometer: great-circle arc swept between successive frames,
    // NOT the length of the 3D path — climbing and diving should not add to
    // "distance travelled across Mars".
    if (s.prevDir) {
      const cosA = Math.max(-1, Math.min(1, up.dot(s.prevDir)));
      // MARS_RADIUS_METERS is not a local here; derive it from the scale pair.
      s.distM = (s.distM || 0) + Math.acos(cosA) * (METERS_PER_UNIT * GLOBE_R);
      s.prevDir.copy(up);
    } else {
      s.prevDir = up.clone();
      s.distM = 0;
    }

    // TRANSLATION USES THE TRUE STEP, NOT THE SMOOTHED ONE.
    //
    // `dts` is a 0.25 s exponential average of frame time. Advancing position by
    // `vel * dts` while the clock advances by `dt` decouples the ground track
    // from wall time, and because the average LAGS, the error alternates sign:
    // on a hitch (a multi-MB tile upload lands, dt = 0.25 s) the ship moves by
    // the stale small average and visibly stalls; over the following short
    // frames `dts` is still elevated, so each one over-advances and it surges.
    // That is the "slows down then speeds up in bursts" cruise behaviour.
    //
    // Attitude, throttle, boost and the speed lerp above keep `dts` — a hitch
    // should not slam the controls — but distance travelled must track the
    // clock, so it integrates the real (clamped) dt. A genuine hitch now shows
    // as one honest catch-up rather than a permanent surge cycle, and the 0.25 s
    // clamp still bounds how far a single frame can carry the ship.
    const gravAcc = -(3.71 * 3 / METERS_PER_UNIT);
    s.vel.copy(fwd).multiplyScalar(s.speed).addScaledVector(up, gravAcc * dt);
    s.pos.addScaledVector(s.vel, dt);

    // Parallel-transport the orientation around the globe: rotate the ship by
    // the same angle its radial "up" swept this frame, so level flight follows
    // the planet's curvature instead of flying straight off into space.
    const upNew = s.pos.clone().normalize();
    const transportAxis = new THREE.Vector3().crossVectors(up, upNew);
    if (transportAxis.lengthSq() > 1e-18) {
      const transportAngle = Math.asin(Math.min(1, transportAxis.length()));
      transportAxis.normalize();
      s.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(transportAxis, transportAngle)).normalize();
    }

    // terrain floor + ceiling
    const ll = worldToLatLon(s.pos);
    // Publish the point the tile streamer should refine around: WHERE THE CAMERA
    // IS LOOKING (the screen-centre ground point), so the sharp tiles land where
    // the pilot's eye is, not in a thin strip under the ship. Ray-cast the
    // camera's forward direction onto the surface sphere. If it misses (looking
    // at the sky) or lands past a cap, fall back to a modest lead ahead of the
    // ship so the near-field is always covered.
    {
      const camPos = camera.position;
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const surfR = surfaceRadiusAt(ll.lat, ll.lon);
      // Solve |camPos + t*camDir|² = surfR² for the near root.
      const b = 2 * camPos.dot(camDir);
      const c = camPos.lengthSq() - surfR * surfR;
      const disc = b * b - 4 * c;
      let focusPoint = null;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / 2;
        // Cap the look distance so a near-horizontal glance doesn't put the
        // focus at the far limb (hundreds of km out); beyond the cap, use the
        // capped point along the ray.
        const maxLook = Math.max(0.02, (s.pos.length() - GLOBE_R) * 6);
        if (t > 0) focusPoint = camPos.clone().addScaledVector(camDir, Math.min(t, maxLook));
      }
      if (!focusPoint) {
        const altUnits = Math.max(0, s.pos.length() - GLOBE_R);
        focusPoint = s.pos.clone().addScaledVector(fwd, Math.max(altUnits * 2, 0.01));
      }
      const fLL = worldToLatLon(focusPoint);
      fs.focusLatLon = { lat: fLL.lat, lon: fLL.lon > 180 ? fLL.lon - 360 : fLL.lon };
      // Also publish the ship's own ground point so the streamer can cover a
      // full disc AROUND the ship (not just the forward view) — that keeps the
      // ground behind you mapped, so a U-turn is instant instead of rebuilding.
      fs.shipLatLon = { lat: ll.lat, lon: ll.lon > 180 ? ll.lon - 360 : ll.lon };
      // FLIGHT-SIM: scene-space ship position for the viewer's ship-anchored
      // streaming (the streamer converts it to its own frame — no IAU/frame
      // conversion happens on this side).
      fs.shipWorldPos = s.pos;
    }
    const surfR = surfaceRadiusAt(ll.lat, ll.lon);
    // Publish the SHIP's height above terrain (scene units) so the tile streamer
    // sizes the finest LOD level to where the pilot is — not to the chase
    // camera, which trails tens of km higher and would force coarse tiles even
    // on a low pass.
    fs.shipAltUnits = Math.max(0, s.pos.length() - surfR);
    // Publish the ship's ANGULAR ground speed (degrees of arc per second). The
    // tile streamer uses this to back off detail when travelling fast: at cruise
    // the ship crosses a fresh tile-disc faster than 6 connections can load it,
    // so requesting fine tiles just churns doomed fetches (never maps, thrashes
    // GPU memory). deg/s = tangential_speed / radius. s.speed is already smoothed
    // by the velocity lerp, so this needs no extra filtering.
    fs.shipSpeedDegPerSec = (s.speed / Math.max(s.pos.length(), 1e-6)) * (180 / Math.PI);
    prefetchAhead(s, fwd); // Phase 4: warm fine tiles ahead into the disk cache
    const floorR = surfR + minClearanceUnits();
    const ceilR = GLOBE_R + MAX_ALT_M / METERS_PER_UNIT;
    let r = s.pos.length();
    if (r < floorR) {
      const n = s.pos.clone().normalize();
      const vn = s.vel.dot(n);
      // Hard vertical impact → crash sequence. The threshold used to scale with
      // the speed multiplier so fast flight stayed survivable at shallow
      // angles; with the multiplier gone it scales with the speed range
      // actually in use, which is the same intent expressed continuously.
      const downMs = -vn * METERS_PER_UNIT;
      const impactScale = Math.max(1, (s.speedMaxKmS || 1.2) / 1.2);
      if (downMs > 450 * impactScale) {
        s.pos.setLength(floorR);
        triggerCrash(ll);
        return;
      }
      // Terrain-skimming assist REMOVED (user request). The floor clamp and the
      // crash test above stay — without the clamp the ship would sink through
      // the planet — but the ship no longer bounces, bleeds speed, auto-pitches
      // away from the ground or flashes a skimming warning. Downward velocity is
      // simply cancelled, so it tracks the surface and the pilot keeps control.
      s.pos.setLength(floorR);
      r = floorR;
      if (vn < 0) s.vel.addScaledVector(n, -vn);
    }
    if (r > ceilR) {
      s.pos.setLength(ceilR);
      r = ceilR;
      const n = s.pos.clone().normalize();
      const vn = s.vel.dot(n);
      if (vn > 0) s.vel.addScaledVector(n, -vn);
    }

    // ship pose + engine visuals
    ship.position.copy(s.pos);
    ship.quaternion.copy(s.quat);
    // TARDIS tumbles around its vertical axis as it travels — faster with speed,
    // with a steady idle spin so it turns even at a hover.
    if (ship.userData.spins) {
      // Rate comes off airspeed in m/s. The speed term used to read s.speed
      // directly, which is in WORLD UNITS — at ~1,061 km per unit, cruise is
      // about 0.0011 units/s, so `s.speed * 40` contributed ~0.05 rad/s
      // against a 0.8 rad/s idle. The box spun at one visibly fixed rate no
      // matter how hard you accelerated.
      //
      // Square root, not linear. Boost raises the ceiling toward
      // speedCeilingKmS(altitude) rather than multiplying MAX_SPEED_MS, so
      // real speeds span 0 to about 12 km/s — ten times cruise. Scaled
      // linearly off cruise the rate pins at the cap almost as soon as you
      // boost and the whole upper range feels identical; scaled linearly off
      // the ceiling it barely moves at the cruise speeds you actually fly at.
      // Speed is normalised against cruise, so f is 1 at MAX_SPEED_MS and
      // reaches about 10 flat out. The exponent sits between linear and a
      // square root on purpose: a square root is steepest at the very bottom,
      // which made the box pick up a brisk turn the instant it crept forward,
      // while pure linear leaves the whole upper range feeling identical.
      //
      // Constants are calibrated against what the box actually does on screen
      // rather than against this expression. update() runs more than once per
      // rendered frame and the count varies with frame pacing, so the observed
      // rate lands somewhere around 1.5-2.5x nominal — enough slack that
      // picking these numbers analytically gets it wrong.
      //
      // Tuned deliberately slow. The box is scenery, not a gyroscope: it
      // should look like it is drifting round as it travels, and the change
      // with speed should be something you notice rather than something that
      // dominates the shot. Measured on a live flight: about one turn per
      // minute at a standstill, 4 s at cruise, 1.5 s flat out.
      const spinMs = s.speed * METERS_PER_UNIT;
      const f = spinMs / MAX_SPEED_MS;
      const spinRate = Math.min(1.7, 0.04 + 0.58 * Math.pow(f, 0.75));
      // Keep the accumulator bounded (mod 2π) so it never drifts to a huge float.
      state.spinAngle = ((state.spinAngle || 0) + dts * spinRate) % (Math.PI * 2);
      ship.rotateY(state.spinAngle);
    }
    // Plume tracks commanded throttle rather than achieved speed, so the
    // engines respond the instant the pilot moves the throttle.
    const thrustLvl = s.braking ? 0 : Math.min(1.6, s.throttle * (s.boosting ? 1.5 : 1));
    setThrustVisuals(thrustLvl, s.boosting);

    // camera
    const L = shipDisplayLengthUnits();
    const shipUp = new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat);
    if (s.cam === "chase") {
      const chasePos = s.pos.clone()
        .addScaledVector(fwd, -2.6 * L)
        .addScaledVector(shipUp, 0.9 * L);
      // Exponential damping, not a linear step. `min(1, k*dt)` changes its
      // effective stiffness with frame rate — the camera snaps on long frames
      // and lags on short ones, which reads as the ship jittering against the
      // view even when its own motion is smooth. 1 - e^(-k*dt) is the exact
      // solution and is frame-rate independent.
      //
      // ...but ONLY if it is fed the real elapsed time. This was passing `dts`,
      // the 0.25 s smoothed average, while the ship moves on the true `dt`, so
      // the two ran on different clocks and the frame-rate independence the
      // formula provides was given away again. MEASURED at k=7: on a 200 ms
      // hitch the camera should close 75% of the gap and closed 30%, so the
      // ship surged forward in frame; on the short frames after it, `dts` is
      // still elevated and the camera closed 47% where it should close 11%,
      // rushing forward and pulling the ship BACK. That oscillation is the
      // "jerks back at max speed" report, and it scales with the gap, which is
      // why it only becomes obvious at the ceiling.
      //
      // DEFAULT IS `dts`, AND THAT IS DELIBERATE. Feeding the true `dt` is
      // correct in isolation — the measurement above is real — but it has now
      // broken tile streaming TWICE: 947af11 (reverted in 6c1c1fd), and again
      // after the focus-disc hold was added, which was the specific reason to
      // expect it to be safe the second time. It was not: a camera that tracks
      // continuously moves the view every frame, and the SURROUND layer keys
      // off the view, so holding the focus disc does not cover it.
      //
      // It also did not fix the jerk it was aimed at. So the camera clock is
      // not the cause of that, and both of those are now observed rather than
      // reasoned. Do not flip this default again before the surround layer gets
      // the same drift-hold the focus disc has. window.__fsCamTrueDt = true
      // still enables it for experiments; expect streaming to suffer while on.
      // DAMP THE OFFSET, NOT THE WORLD POSITION. This is the actual defect
      // behind "the ship retracts backwards once max speed is reached", and it
      // is a property of the damping itself, not of the clock fed to it.
      //
      // Exponential damping toward a MOVING target settles at a steady-state
      // lag of v/k. Chasing the world-space point at k=7 therefore parks the
      // camera v/7 behind where it belongs — MEASURED: 0.17 km at 1.2 km/s but
      // 1.71 km at 12 km/s, against an intended offset of 0.078 km. The ship's
      // distance from the camera was thus a FUNCTION OF SPEED, growing 23x
      // between cruise and the ceiling. Accelerating pushed it away, reaching
      // the ceiling stopped that, and any speed change slid it along the view
      // axis. No choice of dt fixes this; the target is moving, so a damped
      // follow must lag it.
      //
      // Damping the OFFSET removes the lag entirely: the offset is constant in
      // steady flight regardless of speed, so the camera tracks position
      // exactly and the ship holds the same pixel. Damping still applies to
      // CHANGES in the offset — i.e. to attitude — which is the smoothing that
      // was actually wanted. Turns stay soft; the ship stops sliding.
      const camDt = window.__fsCamTrueDt === true ? dt : dts;
      const desiredOff = chasePos.clone().sub(s.pos);
      if (!s._camOff) s._camOff = desiredOff.clone();
      else s._camOff.lerp(desiredOff, 1 - Math.exp(-7 * camDt));
      camera.position.copy(s.pos).add(s._camOff);
      camera.up.lerp(shipUp, 1 - Math.exp(-5 * camDt)).normalize();
      // Residual offset error. Now that translation cannot lag, this only moves
      // during attitude changes, and should sit at ~0 in straight flight.
      s._camGapKm = s._camOff.distanceTo(desiredOff) * METERS_PER_UNIT / 1000;
      const look = s.pos.clone().addScaledVector(fwd, 4 * L).addScaledVector(shipUp, -0.4 * L);
      camera.lookAt(look);
    } else {
      // Seat the view in the orbiter's crew module: forward of centre, just
      // below the windshield line.
      camera.position.copy(s.pos.clone().addScaledVector(fwd, 0.36 * L).addScaledVector(shipUp, 0.03 * L));
      camera.up.copy(shipUp);
      camera.lookAt(s.pos.clone().addScaledVector(fwd, 8 * L));
    }

    // Keep the chase camera itself above the terrain — a low skim with the
    // camera trailing high behind the ship can otherwise dip it underground.
    if (s.cam === "chase") {
      const camLL = worldToLatLon(camera.position);
      const camFloor = surfaceRadiusAt(camLL.lat, camLL.lon) + 25 / METERS_PER_UNIT;
      if (camera.position.length() < camFloor) camera.position.setLength(camFloor);
    }

    // near-plane management: keep the surface out of the near frustum without
    // clipping the ship (which sits ~2.6 ship-lengths from the chase camera).
    const camAltUnits = Math.max(1e-6, camera.position.length() - surfR);
    const nearCap = s.cam === "chase" ? Math.max(1.5e-5, 0.5 * L) : 0.1;
    camera.near = Math.min(0.1, Math.min(nearCap, camAltUnits * 0.4));
    camera.near = Math.max(camera.near, 1.2e-5);
    camera.updateProjectionMatrix();

    // ---- HUD ----
    const altM = (r - surfR) * METERS_PER_UNIT;
    const spdMs = s.speed * METERS_PER_UNIT;

    // FRAME TRACE. Five rounds of reasoning about this jerk have not converged,
    // so record what actually happens instead. Ring buffer, no allocation per
    // frame, always on — the cost is eight float writes.
    //
    // It is built to answer ONE question, the one that was asked and that I
    // have twice answered wrongly from theory: position or scene?
    //   * stepKm irregular      -> POSITION. The ship really is lurching.
    //   * stepKm smooth but
    //     camGapKm oscillating  -> SCENE. The ship is fine, the camera is not.
    //   * both smooth           -> neither; it is the ground texture moving,
    //                              i.e. the streamer re-keying under a steady
    //                              ship, and the flight model is not at fault.
    // ceilKmS is included because the altitude-derived ceiling is itself a
    // suspect: it is recomputed from instantaneous altitude every frame with no
    // damping, so if altitude wobbles the speed target wobbles with it.
    if (_traceBuf) {
      const i = (_traceIdx % TRACE_N) * TRACE_W;
      _traceBuf[i] = now;
      _traceBuf[i + 1] = dt;
      _traceBuf[i + 2] = spdMs / 1000;
      _traceBuf[i + 3] = altM / 1000;
      _traceBuf[i + 4] = s.speedCeilKmS || 0;
      _traceBuf[i + 5] = s.boost || 0;
      // Actual distance the ship moved this frame, in km — the ground truth
      // for "is the position smooth", independent of speed and dt separately.
      _traceBuf[i + 6] = _tracePrev
        ? s.pos.distanceTo(_tracePrev) * METERS_PER_UNIT / 1000
        : 0;
      _traceBuf[i + 7] = s._camGapKm || 0;
      if (!_tracePrev) _tracePrev = s.pos.clone(); else _tracePrev.copy(s.pos);
      _traceIdx += 1;
    }
    if (hudAlt) hudAlt.textContent = altM >= 10000 ? (altM / 1000).toFixed(1) + " km" : Math.round(altM) + " m";
    if (hudSpd) hudSpd.textContent = spdMs >= 1000 ? (spdMs / 1000).toFixed(2) + " km/s" : Math.round(spdMs) + " m/s";
    // VERTICAL SPEED. Taken as the radial component of the actual velocity
    // vector rather than by differencing altitude frame to frame: `s.vel` is
    // already the true velocity (`fwd * speed + gravity`), so this is exact and
    // needs no smoothing, and it does NOT jump when terrain rises or falls
    // beneath the ship the way a d(altitude)/dt reading would.
    if (hudVs) {
      const vsMs = s.vel.dot(up) * METERS_PER_UNIT;
      const mag = Math.abs(vsMs);
      const sign = vsMs > 0.5 ? "+" : vsMs < -0.5 ? "\u2212" : "";
      hudVs.textContent = mag < 0.5 ? "0 m/s"
        : sign + (mag >= 1000 ? (mag / 1000).toFixed(2) + " km/s" : Math.round(mag) + " m/s");
    }
    // GROUND ELEVATION of the terrain below, relative to datum — the Altitude
    // cell is height ABOVE that terrain, so the two together place the ship
    // absolutely. Straight from the DEM sampler, not from surfaceRadiusAt(),
    // which also folds in the CTX drape lift.
    if (hudDist) {
      const d = s.distM || 0;
      hudDist.textContent = d >= 1000
        ? (d / 1000).toFixed(d >= 100000 ? 0 : 1) + " km"
        : Math.round(d) + " m";
    }
    if (hudGround) {
      const relief = Number(hooks.manifest?.elevation?.relief_m ?? 0);
      const minM = Number(hooks.manifest?.elevation?.min_m ?? 0);
      const norm = hooks.elevationSampler
        ? hooks.sampleElevationNormalized(hooks.elevationSampler, ll.lat, ll.lon) : 0;
      const groundM = minM + norm * relief;
      const g = Math.abs(groundM);
      hudGround.textContent = (groundM < 0 ? "\u2212" : "+") +
        (g >= 1000 ? (g / 1000).toFixed(2) + " km" : Math.round(g) + " m");
    }
    const east = new THREE.Vector3().crossVectors(planetAxis(), up).normalize();
    const north = new THREE.Vector3().crossVectors(up, east).normalize();
    const hdg = (Math.atan2(fwd.dot(east), fwd.dot(north)) * 180 / Math.PI + 360) % 360;
    if (hudHdg) hudHdg.textContent = String(Math.round(hdg)).padStart(3, "0") + "°";
    // Attitude for the compass: pitch is the nose above the local horizon, roll
    // is the ship's own up-vector rotated about the flight path. Both come from
    // the SAME local basis as the heading, so the instrument can never disagree
    // with the number beside it.
    const pitchDeg = Math.asin(Math.max(-1, Math.min(1, fwd.dot(up)))) * 180 / Math.PI;
    // Round FIRST, then sign it — `(-0.4).toFixed(0)` is "-0", which reads as a
    // broken instrument.
    const pitchWhole = Math.round(pitchDeg) === 0 ? 0 : Math.round(pitchDeg);
    drawBearingTape(hdg);
    if (hudPitch) hudPitch.textContent =
      `${pitchWhole > 0 ? "+" : ""}${pitchWhole}°`;
    updateFlightAtmosphere((r - GLOBE_R) * METERS_PER_UNIT);
    if (hudCoord) hudCoord.textContent =
      Math.abs(ll.lat).toFixed(1) + "°" + (ll.lat >= 0 ? "N" : "S") + " " + ll.lon.toFixed(1) + "°E";
    if (hudRegion) hudRegion.textContent = regionName(ll.lat, ll.lon);
    if (hudThr) hudThr.textContent = Math.round(s.throttle * 100) + "%";
    if (hudThrottleFill) hudThrottleFill.style.width = (s.throttle * 100) + "%";
    if (hudBoostFill) hudBoostFill.style.width = (s.boost * 100) + "%";
    if (msgTimer > 0) {
      msgTimer -= dt;
      if (msgTimer <= 0 && hudMsg) hudMsg.style.opacity = "0";
    }
  }

  // ---- input ----
  const GAME_KEYS = new Set([
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
    "KeyW", "KeyS", "KeyA", "KeyD", "ShiftLeft", "ShiftRight",
  ]);

  // Only genuine text-entry fields swallow keys. Checkboxes, sliders and
  // selects (e.g. the engage toggle itself, which keeps focus after being
  // clicked) must NOT block flight controls — they get blurred instead.
  const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "password", "number", "tel"]);
  function typingInField(e) {
    const t = e.target;
    if (!t) return false;
    const tag = (t.tagName || "").toUpperCase();
    if (tag === "TEXTAREA" || t.isContentEditable) return true;
    if (tag === "INPUT") return TEXT_INPUT_TYPES.has((t.type || "text").toLowerCase());
    return false;
  }

  function blurNonTextControl(e) {
    const t = e.target;
    if (!t || typingInField(e)) return;
    const tag = (t.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "SELECT" || tag === "BUTTON" || tag === "SUMMARY") {
      t.blur();
    }
  }

  // KEYBOARD LAYOUT. `e.code` is the PHYSICAL key position, so on AZERTY, QWERTZ
  // or Dvorak the key printed "W" reports something other than "KeyW" and the
  // throttle never moves however long you hold it — indistinguishable from a
  // stuck 40% cap. Register the position AND the printed letter, so both the
  // physical WASD cluster and the labelled keys work.
  function keyTokens(e) {
    const t = [e.code];
    if (e.key && /^[a-zA-Z]$/.test(e.key)) t.push("Key" + e.key.toUpperCase());
    return t;
  }
  const pressed = (e, token) => keyTokens(e).includes(token);

  // Direct-set throttle. Holding a key for two seconds is the least discoverable
  // control there is; every flight sim worth the name also binds absolute
  // settings. 1-9 = 10-90%, 0 = full, X = cut.
  function setThrottle(v) {
    state.throttle = Math.max(0, Math.min(1, v));
    if (hudThr) hudThr.textContent = Math.round(state.throttle * 100) + "%";
    if (hudThrottleFill) hudThrottleFill.style.width = (state.throttle * 100) + "%";
  }

  window.addEventListener("keydown", (e) => {
    if (!fs.active || typingInField(e)) return;
    // Steal focus from panel controls so Space/arrows fly the ship instead of
    // re-toggling the engage checkbox or scrolling a select.
    blurNonTextControl(e);
    for (const token of keyTokens(e)) keys[token] = true;
    if (keyTokens(e).some((t) => GAME_KEYS.has(t))) e.preventDefault();
    if (/^Digit[0-9]$/.test(e.code)) {
      const d = Number(e.code.slice(5));
      setThrottle(d === 0 ? 1 : d / 10);
      flash("THROTTLE " + Math.round(state.throttle * 100) + "%");
      e.preventDefault();
      return;
    }
    if (pressed(e, "KeyX")) { setThrottle(0); flash("THROTTLE CUT"); e.preventDefault(); return; }
    if (pressed(e, "KeyC")) toggleCam();
    if (pressed(e, "KeyR")) levelOut();
    if (pressed(e, "KeyH")) {
      state.hudVisible = !state.hudVisible;
      hud?.classList.toggle("fs-hud-hidden", !state.hudVisible);
    }
    if (e.code === "Escape") disengage();
  });
  window.addEventListener("keyup", (e) => { for (const t of keyTokens(e)) keys[t] = false; });
  window.addEventListener("blur", () => { for (const k of Object.keys(keys)) keys[k] = false; });
  // DIRECT MANIPULATION. The throttle is drawn on screen as a slider, so it
  // behaves like one: click or drag anywhere along the track to set it, wheel to
  // trim. Needs no key discovery at all. (#fs-hud is pointer-events:none, so the
  // track opts itself back in via CSS.)
  const throttleTrack = hudThrottleFill?.parentElement || null;
  if (throttleTrack) {
    const setFromPointer = (clientX) => {
      const r = throttleTrack.getBoundingClientRect();
      if (r.width) setThrottle((clientX - r.left) / r.width);
    };
    let dragging = false;
    throttleTrack.addEventListener("pointerdown", (e) => {
      if (!fs.active) return;
      dragging = true;
      throttleTrack.setPointerCapture?.(e.pointerId);
      setFromPointer(e.clientX);
      e.preventDefault();
    });
    throttleTrack.addEventListener("pointermove", (e) => {
      if (dragging) { setFromPointer(e.clientX); e.preventDefault(); }
    });
    const endDrag = (e) => { dragging = false; throttleTrack.releasePointerCapture?.(e.pointerId); };
    throttleTrack.addEventListener("pointerup", endDrag);
    throttleTrack.addEventListener("pointercancel", endDrag);
    throttleTrack.addEventListener("wheel", (e) => {
      if (!fs.active) return;
      setThrottle(state.throttle + (e.deltaY < 0 ? 0.05 : -0.05));
      e.preventDefault();
    }, { passive: false });
  }

  // Throttle steppers. Press-and-hold repeats, because a single 5% nudge per
  // click makes crossing the range a chore — first repeat is delayed so a plain
  // click is still exactly one step.
  (function wireThrottleSteppers() {
    const step = (dir) => setThrottle(state.throttle + dir * 0.05);
    for (const [id, dir] of [["fs-thr-down", -1], ["fs-thr-up", 1]]) {
      const btn = $(id);
      if (!btn) continue;
      let holdTimer = null, repeatTimer = null;
      const stop = () => {
        clearTimeout(holdTimer); clearInterval(repeatTimer);
        holdTimer = repeatTimer = null;
      };
      btn.addEventListener("pointerdown", (e) => {
        if (!fs.active) return;
        step(dir);
        holdTimer = setTimeout(() => { repeatTimer = setInterval(() => step(dir), 70); }, 350);
        e.preventDefault();
      });
      btn.addEventListener("pointerup", stop);
      btn.addEventListener("pointerleave", stop);
      btn.addEventListener("pointercancel", stop);
      // A focused stepper would otherwise swallow Space/arrows meant for the ship.
      btn.addEventListener("click", () => btn.blur());
    }
  })();

  // ON-SCREEN CONTROL PAD. Each button writes the SAME `keys` map the keyboard
  // handler writes, so there is exactly one input path into the flight model and
  // the pad can never drift out of step with the shortcuts.
  (function wireTouchPad() {
    const pad = $("fs-touch"), toggle = $("fs-touch-toggle");
    if (!pad || !toggle) return;

    const release = (el, code) => { keys[code] = false; el.classList.remove("is-down"); };
    pad.querySelectorAll("[data-key]").forEach((el) => {
      const code = el.dataset.key;
      el.addEventListener("pointerdown", (e) => {
        if (!fs.active) return;
        keys[code] = true;
        el.classList.add("is-down");
        // Capture so a finger that slides off the button still releases here —
        // without it the key would latch on and the ship would keep pitching.
        el.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      });
      const up = () => release(el, code);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", up);
      el.addEventListener("click", () => el.blur());   // keep focus off the pad
    });

    const setPad = (on) => {
      pad.hidden = !on;
      toggle.setAttribute("aria-pressed", String(on));
      if (!on) pad.querySelectorAll("[data-key]").forEach((el) => release(el, el.dataset.key));
    };
    toggle.addEventListener("click", (e) => { e.preventDefault(); setPad(pad.hidden); toggle.blur(); });
    // A coarse pointer means a touchscreen with no keyboard, so the shortcuts are
    // unreachable — default the pad on there.
    if (window.matchMedia?.("(pointer: coarse)").matches) setPad(true);
    fs._releaseTouchKeys = () => pad.querySelectorAll("[data-key]")
      .forEach((el) => release(el, el.dataset.key));
  })();

  // Controls reference popup.
  (function wireControlsPanel() {
    const btn = $("fs-controls-btn"), panel = $("fs-controls-panel"), close = $("fs-controls-close");
    if (!btn || !panel) return;
    const setOpen = (open) => {
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      btn.blur();
    };
    btn.addEventListener("click", (e) => { e.preventDefault(); setOpen(panel.hidden); });
    close?.addEventListener("click", (e) => { e.preventDefault(); setOpen(false); });
    // Esc already exits flight, so the panel closes on any OTHER keypress rather
    // than binding a key of its own.
    window.addEventListener("keydown", () => { if (!panel.hidden) setOpen(false); });
    document.addEventListener("pointerdown", (e) => {
      if (panel.hidden) return;
      if (!panel.contains(e.target) && !btn.contains(e.target)) setOpen(false);
    });
  })();

  // ---- panel wiring ----
  // Fade the screen to black, run the state change behind it, then fade back —
  // hides the camera/scene swap on engage/disengage.
  function screenTransition(action) {
    if (!fadeEl) { action(); return; }
    fadeEl.classList.add("show");
    setTimeout(() => {
      try { action(); } catch (e) { console.error("[flightsim] transition", e); }
      setTimeout(() => fadeEl.classList.remove("show"), 200); // let the new view render first
    }, 430); // matches the CSS fade duration
  }

  // Vertical exaggeration slider (in the flight tab) → terrain-relief scale.
  // ×1 = true 1:1 scale (TRUE_SCALE_TERRAIN_RELIEF); higher exaggerates height.
  function applyVex() {
    if (!hooks?.terrainScale) return;
    const vex = Math.max(1, Number(vexSlider?.value) || 1);
    const trueScale = hooks.TRUE_SCALE_TERRAIN_RELIEF ?? 0.0277;
    hooks.terrainScale.value = String(vex * trueScale);
    hooks.terrainScale.dispatchEvent(new Event("input", { bubbles: true }));
  }
  vexSlider?.addEventListener("input", () => { if (fs.active) applyVex(); });

  // ── PRE-FLIGHT (Phase 2) ────────────────────────────────────────────────
  // Engaging no longer launches straight from wherever the camera happened to
  // point. The toggle now opens a pre-flight state: the globe stays fully
  // orbit-controllable, clicking it sets the launch site, a dial sets the
  // heading, and LAUNCH commits. That explicit spec is what makes this a mode
  // rather than a tab.
  const siteReadout = $("fs-site-readout");
  const launchBtn = $("fs-launch");
  const headingDial = $("fs-heading-dial");
  const headingNeedle = $("fs-heading-needle");
  const headingValue = $("fs-heading-value");
  const retFrame = $("fs-ret-frame");
  const retNeedle = $("fs-ret-needle");
  const preflight = { active: false, lat: null, lon: null, heading: 90 };

  // Label density: the pre-flight slider is a PROXY for the viewer's own
  // #lod-slider in the Locations panel — it drives the real control by
  // dispatching the same "input" event, so there is one source of truth and no
  // duplicated label logic. Mirrored both ways so the two never disagree.
  const fsLod = $("fs-lod-slider");
  const fsLodLabel = $("fs-lod-value-label");
  const mainLod = document.getElementById("lod-slider");
  const mainLodLabel = document.getElementById("lod-value-label");
  // The caption copy is deferred a frame: script-registration order between
  // mars-viewer.js (module) and flightsim.js (defer) is not guaranteed, so this
  // listener can run BEFORE the viewer has rewritten #lod-value-label. Reading
  // it immediately captured the previous caption (measured: value synced to 2
  // while the caption still read "All features").
  function copyLodCaption() {
    if (!fsLodLabel || !mainLodLabel) return;
    requestAnimationFrame(() => { fsLodLabel.textContent = mainLodLabel.textContent; });
  }
  function syncLodFromMain() {
    if (!fsLod || !mainLod) return;
    fsLod.value = mainLod.value;
    copyLodCaption();
  }
  fsLod?.addEventListener("input", () => {
    if (!mainLod) return;
    mainLod.value = fsLod.value;
    mainLod.dispatchEvent(new Event("input", { bubbles: true }));
    copyLodCaption();
  });
  mainLod?.addEventListener("input", syncLodFromMain);

  const fmtSite = (lat, lon) =>
    `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}  ${lon.toFixed(2)}°E`;

  function setHeading(deg, fromDial) {
    preflight.heading = ((Math.round(deg) % 360) + 360) % 360;
    if (headingNeedle) headingNeedle.setAttribute("transform",
      `rotate(${preflight.heading} 50 50)`);
    if (headingValue) headingValue.textContent =
      String(preflight.heading).padStart(3, "0") + "°";
    headingDial?.setAttribute("aria-valuenow", String(preflight.heading));
    syncReticleNeedle();
    if (!fromDial) return;
  }

  // Put the reticle's compass ring and needle into the LOCAL surface frame of the
  // targeted point.
  //
  // The crosshair itself is a screen aid and stays put, but its four ticks were
  // being read as compass points — and on a sphere, local north almost never
  // points at screen-up. It only does at the sub-camera meridian; anywhere else it
  // swings by tens of degrees, and it inverts entirely once you drag past a pole.
  // So the site, the ring and the heading dial all appeared to disagree.
  //
  // The bearing is measured the honest way — project the target and a point one
  // short step due north of it, and take the screen-space angle between them —
  // rather than derived analytically, so it stays correct under any camera
  // orientation, including upside-down views, with no special cases. North is
  // built from the SAME basis headingQuat uses (east = Y x up, north = up x east),
  // so a needle at 090 leaves along exactly the course the HUD will report.
  // Bearing of north is measured FROM THE PICKER, by finite-differencing the
  // latitude it reports a few pixels either side of the crosshair.
  //
  // Deriving it instead from lat/lon -> world -> project looks cleaner and is
  // what I tried first, but it is a second path to the same place and it drifted
  // 10-24 deg from the picker depending on camera orientation. The picker is the
  // one thing that is true BY CONSTRUCTION here: it is the same raycast that
  // decides the launch site, so a bearing built from it cannot disagree with what
  // is actually under the crosshair. Three picks per sample, in pixel space, so
  // there is no viewport-aspect correction to get wrong either.
  // The needle lives inside the rotated frame, so aiming it is just the heading.
  // Heading is clockwise from north, and viewed from outside the globe that is
  // also clockwise on screen — measured, not assumed: the picker's longitude
  // gradient sits +84 deg from its latitude gradient (90 less sweep resolution).
  function syncReticleNeedle() {
    if (retNeedle) retNeedle.setAttribute("transform", `rotate(${preflight.heading} 60 60)`);
  }

  // Each pickSurfaceLatLon is a raycast against the displaced globe and costs
  // ~16 ms on this machine, so the bearing is re-measured at most every 240 ms
  // and reuses the centre pick sampleTarget has already paid for — two extra
  // raycasts per update rather than three per 80 ms tick.
  let lastFrameMeasure = 0;
  function syncReticleFrame(centre, force) {
    if (!retFrame || !hooks.pickSurfaceLatLon) return;
    const now = performance.now();
    if (!force && now - lastFrameMeasure < 240) return;
    const r = hooks.renderer.domElement.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const c = centre || hooks.pickSurfaceLatLon(cx, cy);
    if (!c) return;
    const STEP = 14;
    const px = hooks.pickSurfaceLatLon(cx + STEP, cy);
    const py = hooks.pickSurfaceLatLon(cx, cy - STEP);   // one step UP the screen
    // Either can miss the globe near the limb; hold the last good frame rather
    // than snapping the ring to something meaningless.
    if (!px || !py) return;
    lastFrameMeasure = now;
    const dLatDx = px.lat - c.lat;
    const dLatDy = py.lat - c.lat;        // per step towards screen-up
    if (Math.abs(dLatDx) + Math.abs(dLatDy) < 1e-9) return;
    const northScreenDeg = Math.atan2(dLatDx, dLatDy) * 180 / Math.PI;
    retFrame.setAttribute("transform", `rotate(${northScreenDeg.toFixed(2)} 60 60)`);
  }

  // NOTE: there is deliberately NO 3D launch marker. The screen-centre reticle
  // already shows the targeted point, and a second marker pinned to the surface
  // read as a competing, smaller crosshair that curved away with the globe.
  // One target, at screen centre.

  function setLaunchSite(lat, lon) {
    preflight.lat = lat;
    preflight.lon = lon;
    if (siteReadout) {
      siteReadout.textContent = fmtSite(lat, lon);
      siteReadout.classList.remove("is-unset");
    }
    if (launchBtn) { launchBtn.disabled = false; launchBtn.textContent = "Launch"; }
    // The bearing of north depends on BOTH the site and the camera angle, so it
    // is refreshed as the globe is dragged, not only when the heading changes.
    syncReticleNeedle();
    syncReticleFrame({ lat, lon });
  }

  // CENTRE-TARGET AIMING. The reticle is pinned to the middle of the screen and
  // the launch site is simply whatever the crosshair is over — you aim the
  // globe rather than chase a cursor. This replaces click/drag-to-place: with a
  // continuously-updating target a click would be overwritten on the next tick,
  // and the two would fight. OrbitControls keeps the drag entirely to itself.
  function sampleTarget() {
    if (!preflight.active) return;
    const el = hooks.renderer.domElement;
    const r = el.getBoundingClientRect();
    const ll = hooks.pickSurfaceLatLon?.(r.left + r.width / 2, r.top + r.height / 2);
    if (ll) {
      document.body.classList.remove("fs-target-invalid");
      setLaunchSite(ll.lat, ll.lon);
    } else {
      // Crosshair is on sky — hold the last valid site but block launching, and
      // colour the reticle so the reason is obvious.
      document.body.classList.add("fs-target-invalid");
      if (siteReadout) {
        siteReadout.textContent = "Aim at the surface";
        siteReadout.classList.add("is-unset");
      }
      preflight.lat = preflight.lon = null;
      if (launchBtn) { launchBtn.disabled = true; launchBtn.textContent = "Aim at the surface"; }
    }
  }

  // Theme swap, using the viewer's existing data-mode mechanism (the same one
  // the moon viewer uses). Applied from ENTER so site selection already looks
  // like flight mode, and held until a full exit. The previous value is saved
  // and restored so this can never clobber another mode's theme.
  function setFlightTheme(on) {
    const root = document.documentElement;
    if (on) {
      if (preflight.prevMode === undefined) {
        preflight.prevMode = root.getAttribute("data-mode");
      }
      root.setAttribute("data-mode", "flight");
    } else {
      if (preflight.prevMode) root.setAttribute("data-mode", preflight.prevMode);
      else root.removeAttribute("data-mode");
      preflight.prevMode = undefined;
    }
  }

  function enterPreflight() {
    if (fs.active || preflight.active) return;
    // Opening the sim is what earns the tile warmer. Deferred a little so it
    // does not contend with building the ship and the pre-flight scene; it
    // already suspends itself for the duration of a flight.
    if (!warmerStarted) {
      setTimeout(() => { warmGlobalCtxCache().catch(() => setCacheStatus("paused")); }, 3000);
    }
    preflight.active = true;
    document.body.classList.add("fs-preflight");
    setFlightTheme(true);
    const sec = document.getElementById("flightsim-section");
    if (sec && !sec.open) sec.open = true;
    if (siteReadout) {
      siteReadout.textContent = "Click the globe to set";
      siteReadout.classList.add("is-unset");
    }
    if (launchBtn) { launchBtn.disabled = true; launchBtn.textContent = "Set a launch site"; }
    preflight.lat = preflight.lon = null;
    // Hold the globe still. The reticle is fixed at screen centre and the site is
    // whatever it is over, so an auto-spinning globe drags the launch point out
    // from under the crosshair while you are trying to set it. Remember whether
    // spin was already paused so cancelling restores the user's own setting
    // rather than silently switching rotation off for them.
    preflight.spinWasPaused = hooks.isSpinPaused ? hooks.isSpinPaused() : true;
    hooks.pauseSpin?.();
    setHeading(preflight.heading);
    syncLodFromMain();
    // Sample at ~12 Hz: fast enough to feel continuous while the globe is
    // dragged, cheap enough that the raycast never competes with streaming.
    preflight.timer = setInterval(sampleTarget, 80);
    sampleTarget();
    flash("AIM AT YOUR LAUNCH SITE");
  }



  function exitPreflight(keepTheme) {
    if (!preflight.active) return;
    preflight.active = false;
    document.body.classList.remove("fs-preflight");
    // Launching hands straight over to flight, which keeps the theme; cancelling
    // returns to the normal viewer, which restores it.
    if (!keepTheme) setFlightTheme(false);
    // Launching keeps the globe held (engage pauses it anyway); cancelling gives
    // the user back the spin state pre-flight took away, and only that — if they
    // had already stopped the globe themselves, it stays stopped.
    if (!keepTheme && !preflight.spinWasPaused) hooks.resumeSpin?.();
    if (preflight.timer) { clearInterval(preflight.timer); preflight.timer = null; }
    document.body.classList.remove("fs-target-invalid");
  }

  // Dial: drag anywhere on the face to aim. Screen-up is north, clockwise is
  // increasing heading, matching the compass rose drawn on it.
  let dialDragging = false;
  const dialAngleFrom = (e) => {
    const r = headingDial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  };
  headingDial?.addEventListener("pointerdown", (e) => {
    dialDragging = true;
    headingDial.setPointerCapture?.(e.pointerId);
    setHeading(dialAngleFrom(e), true);
    e.preventDefault();
  });
  headingDial?.addEventListener("pointermove", (e) => {
    if (dialDragging) setHeading(dialAngleFrom(e), true);
  });
  headingDial?.addEventListener("pointerup", (e) => {
    dialDragging = false;
    headingDial.releasePointerCapture?.(e.pointerId);
  });
  headingDial?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") setHeading(preflight.heading - 5, true);
    else if (e.key === "ArrowRight") setHeading(preflight.heading + 5, true);
  });
  document.querySelectorAll(".fs-snap").forEach((b) => {
    b.addEventListener("click", () => setHeading(Number(b.dataset.heading) || 0, true));
  });

  launchBtn?.addEventListener("click", () => {
    if (!Number.isFinite(preflight.lat)) return;
    const spec = { lat: preflight.lat, lon: preflight.lon, heading: preflight.heading };
    exitPreflight(true);                       // keep the flight theme
    screenTransition(() => { engage(spec); syncEnterBtn(); });
  });

  const enterBtn = $("flightsim-enter");
  function syncEnterBtn() {
    if (!enterBtn) return;
    if (fs.active) { enterBtn.textContent = "Exit"; enterBtn.classList.add("is-armed"); }
    else if (preflight.active) { enterBtn.textContent = "Cancel"; enterBtn.classList.add("is-armed"); }
    else { enterBtn.textContent = "Enter"; enterBtn.classList.remove("is-armed"); }
  }
  // THE HEADER IS THE SWITCH. Enter/Exit fully replaces this section's native
  // expand/collapse: a click anywhere on the summary engages the sim (opening
  // the panel so the launch controls are reachable) or leaves it (collapsing
  // again), so the panel's open state simply follows whether the sim is running
  // rather than being a second thing to manage. The "+"/"−" glyph is suppressed
  // in styles.css to match.
  function toggleFlightFromHeader() {
    const sec = document.getElementById("flightsim-section");
    const turningOn = !(fs.active || preflight.active);
    if (sec) sec.open = turningOn;
    flightToggle.checked = turningOn;
    flightToggle.dispatchEvent(new Event("change", { bubbles: true }));
  }

  enterBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();                       // don't toggle the <details>
    toggleFlightFromHeader();
  });

  // <summary> click also covers keyboard Enter/Space on the focused header, so
  // this keeps the control reachable without a mouse. preventDefault suppresses
  // the browser's own toggle — otherwise the panel would flip twice per click.
  document.querySelector("#flightsim-section > .section-toggle")
    ?.addEventListener("click", (e) => {
      if (e.target.closest("#flightsim-enter")) return;   // button handles itself
      e.preventDefault();
      toggleFlightFromHeader();
    });

  flightToggle?.addEventListener("change", () => {
    if (flightToggle.checked) {
      if (fs.active) return;
      enterPreflight();                       // choose a site first
      syncEnterBtn();
    } else if (fs.active) {
      screenTransition(() => { disengage(); setFlightTheme(false); syncEnterBtn(); });
    } else {
      exitPreflight();                        // cancelled before launching
      syncEnterBtn();
    }
  });
  shipModelSelect?.addEventListener("change", () => { rebuildShip(); });
  const applyDetailLevel = () => {
    fs.maxDetailLevel = Number(detailLevelSelect?.value) || 9;
    // Force the streamer to re-plan tiles at the new ceiling on the next frame.
    if (hooks?.ctxDetailStreamer) hooks.ctxDetailStreamer._lastStateKey = "";
  };
  detailLevelSelect?.addEventListener("change", applyDetailLevel);
  cameraModeSelect?.addEventListener("change", () => {
    if (!fs.active) return;
    state.cam = cameraModeSelect.value === "cockpit" ? "cockpit" : "chase";
    state._camOff = null;   // snap on the next frame, do not ease in
    if (ship) ship.visible = state.cam !== "cockpit";
    updateCamTag();
  });

  fs.update = update;
  fs.engage = engage;
  fs.disengage = disengage;

  // ---- global CTX base-tile cache warmer ----
  // Fetches every CTX tile for levels 0–5 (2 730 tiles ≈ 30–40 MB, one time
  // per device) through the same URLs the streamer uses, so the root service
  // worker caches them. After warming, any first flight over new terrain has
  // instant moderate-resolution coverage (~1.3 km/px at level 5, ~4× sharper
  // than the Viking global basemap) while finer levels stream live.
  const WARM_MAX_LEVEL = 6; // L6 = 325 m/px: a sharp, RELIABLE global base cached
  // so the whole surface shows at 325 m/px instantly (vs L5's 650 m/px) and the
  // flight disc at cruise pulls L6 straight from cache — no live-stream lag. L6
  // adds ~8 192 tiles (~0.4 GB) on top of L0-5's 2 730; the warmer resumes into
  // it from the existing progress. Must match INSTANT_CACHED_LEVEL in the viewer.
  const WARM_PROGRESS_KEY = "fsCtxWarmProgress_v1";
  let warmerStarted = false;

  function setCacheStatus(text) {
    // (The readout this used to drive was removed; the warmer still runs.)
  }

  // ---- Phase 4: approach prefetch ----------------------------------------
  // Warm the FINE tiles for the ground AHEAD of the ship into the service-worker
  // disk cache, so a low/slow pass finds them cached (~5 ms) instead of streaming
  // (~500 ms) as it flies forward. Strictly opportunistic: it fires only when the
  // streamer's own queue is nearly drained (spare of the ~6 HTTP/1.1 connections),
  // so it can NEVER starve the tiles under the pilot — that was the failure mode
  // of the old medium-ring and the cache warmer during flight. Only fine levels
  // (≥9) are worth it; the L6 base is already globally cached.
  const _prefetched = new Set();
  let _lastPrefetchT = 0;
  const PREFETCH_LEVEL = 9; // L9 (40 m/px) — reliable everywhere; the first, biggest
  //                           sharpening step from the L6 base. Warming it ahead makes
  //                           the 6→9 jump instant when you slow over the target.
  function prefetchAhead(s, fwd) {
    const streamer = hooks?.ctxDetailStreamer;
    if (!streamer || !ctxModeActive() || !s) return;
    // Only fires with genuine SPARE capacity — i.e. at cruise, where the disc is
    // the cached L6 and its queue is drained. When you're already slow at fine
    // detail the disc saturates all 6 connections; adding prefetch there would
    // starve the view (the old medium-ring failure), so skip it (bg ≥ 9).
    const bg = streamer._flightBgLevel;
    if (!bg || bg >= PREFETCH_LEVEL) return;
    if ((streamer.inflight?.size || 0) >= 5) return;
    if ((streamer.queue?.length || 0) > 40) return;
    if (s.speed < 1e-5) return;
    // Only when actually APPROACHING the surface — descending, or already low —
    // so we don't spend bandwidth warming fine tiles along a high cruise the
    // pilot will never stop to inspect.
    const up = s.pos.clone().normalize();
    const descending = s.vel.dot(up) < -1e-6;
    const lowAlt = (fs.shipAltUnits || 0) * METERS_PER_UNIT < 40000; // < 40 km
    if (!descending && !lowAlt) return;
    const now = performance.now();
    if (now - _lastPrefetchT < 350) return;                 // throttle
    _lastPrefetchT = now;
    const base = streamer.tileBase;
    if (!base) return;
    const level = PREFETCH_LEVEL;
    // Ground point ~4 s ahead along the heading (min ~10 km so slow flight still
    // looks ahead), converted to the L9 tile grid.
    const leadDist = Math.max(s.speed * 4, 0.01);
    const ahead = s.pos.clone().addScaledVector(fwd, leadDist);
    const g = worldToLatLon(ahead);
    const lon = g.lon > 180 ? g.lon - 360 : g.lon;
    const nc = 1 << (level + 1), nr = 1 << level;
    const c0 = Math.floor((lon + 180) / 360 * nc);
    const r0 = Math.floor((90 - g.lat) / 180 * nr);
    const RAD = 2; // 5×5 patch around the lead point
    let fired = 0;
    for (let dr = -RAD; dr <= RAD && fired < 8; dr += 1) {
      for (let dc = -RAD; dc <= RAD && fired < 8; dc += 1) {
        const row = r0 + dr;
        if (row < 0 || row >= nr) continue;
        const col = ((c0 + dc) % nc + nc) % nc;
        const key = level + "/" + row + "/" + col;
        if (_prefetched.has(key)) continue;
        _prefetched.add(key);
        fired += 1;
        fetch(base + "/" + level + "/" + row + "/" + col, { mode: "cors", cache: "default" })
          .then((resp) => (resp.ok ? resp.blob() : null))
          .catch(() => null);
      }
    }
    if (_prefetched.size > 4000) _prefetched.clear(); // bound the dedup set
  }

  async function warmGlobalCtxCache() {
    if (warmerStarted) return;
    warmerStarted = true;
    const base = hooks?.ctxDetailStreamer?.tileBase || hooks?.ctxDetailStreamer?.TILE_BASE;
    if (!base) { setCacheStatus("unavailable"); return; }
    let isProxy = false;
    try { isProxy = new URL(base, window.location.href).pathname.includes("/ctx-proxy/tile/"); } catch (_e) {}
    const tileUrl = (l, r, c) => `${base}/${l}/${r}/${c}` + (isProxy ? "?blankTile=true" : "");

    const counts = [];
    let total = 0;
    for (let l = 0; l <= WARM_MAX_LEVEL; l += 1) {
      const c = (1 << l) * (1 << (l + 1)); // rows × cols
      counts.push(c);
      total += c;
    }
    const idxToTile = (i) => {
      let l = 0, rem = i;
      while (rem >= counts[l]) { rem -= counts[l]; l += 1; }
      const cols = 1 << (l + 1);
      return { l, row: Math.floor(rem / cols), col: rem % cols };
    };

    let done = 0;
    try { done = Math.min(total, Number(localStorage.getItem(WARM_PROGRESS_KEY)) || 0); } catch (_e) {}
    if (done >= total) { setCacheStatus("ready"); return; }
    setCacheStatus(Math.round((done / total) * 100) + "%");

    // The warmer must NEVER saturate the ~6 per-host connections: in orbit mode
    // it runs alongside the interactive mosaic streamer, and at 6-wide it starved
    // it completely ("no tiles get streamed" outside flight). Two connections
    // leave four free for whatever the user is looking at; during flight it
    // still suspends fully (below). The global warm just takes longer — it is a
    // one-time download persisted by the service worker.
    const CONCURRENCY = 2;
    while (done < total) {
      if (!navigator.onLine) { await new Promise((r) => setTimeout(r, 5000)); continue; }
      const batch = [];
      for (let k = 0; k < CONCURRENCY && done + k < total; k += 1) batch.push(idxToTile(done + k));
      await Promise.all(batch.map((t) =>
        fetch(tileUrl(t.l, t.row, t.col), { mode: "cors", cache: "default" })
          .then((resp) => resp.blob())
          .catch(() => null)
      ));
      done += batch.length;
      if (done % 30 < CONCURRENCY || done >= total) {
        try { localStorage.setItem(WARM_PROGRESS_KEY, String(done)); } catch (_e) {}
        setCacheStatus(done >= total ? "ready" : Math.round((done / total) * 100) + "%");
      }
      // Fully suspend while flying: the warmer and the tile streamer share the
      // same ~6 per-host connections, so warming during flight directly starves
      // the tiles the pilot is actually looking at.
      while (fs.active) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  // ---- boot: wait for the forked viewer to expose its hooks ----
  function adoptHooks() {
    hooks = window.__flightSimHooks;
    if (!hooks) return false;
    THREE = hooks.THREE;
    METERS_PER_UNIT = hooks.MARS_RADIUS_METERS / GLOBE_R;
    // NO WARMING ON BOOT. This used to fire 4 s after the viewer loaded, on
    // every visit. It exists purely to make FLIGHTS smooth, but it ran for every
    // Mars viewer visitor: 10,922 tiles (~0.4 GB) across levels 0-6 at two
    // concurrent connections out of the ~6 the browser allows per host, each one
    // also decoded and written to the service-worker cache. That contended
    // directly with the tiles the viewer was trying to draw, which is what made
    // the globe jumpy for the first minutes of a session. It is started from
    // enterPreflight() now, so nobody pays for it until they open the sim.
    // Repair the base globe texture if the async load raced (so the globe isn't
    // dark before the user even engages flight). Retried a couple of times in
    // case the legitimate load is still in flight at these check points.
    setTimeout(repairBaseTexture, 5000);
    setTimeout(repairBaseTexture, 10000);
    return true;
  }
  if (!adoptHooks()) {
    window.addEventListener("flightsim:hooks-ready", adoptHooks, { once: true });
  }
})();
