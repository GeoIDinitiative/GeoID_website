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
  const MAX_SPEED_MS = 2400;          // full-throttle airspeed, m/s
  const BOOST_MULT = 2.6;
  const MIN_CLEARANCE_M = 60;         // floor above the visible tile surface
  const MAX_ALT_M = 600000;           // 600 km ceiling
  const PITCH_RATE = 1.1, YAW_RATE = 0.7, ROLL_RATE = 1.6; // rad/s

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const hud = $("fs-hud");
  const hudAlt = $("fs-alt"), hudSpd = $("fs-spd"), hudHdg = $("fs-hdg"),
    hudCoord = $("fs-coord"), hudRegion = $("fs-region"), hudThr = $("fs-thr"),
    hudThrottleFill = $("fs-throttle-fill"), hudBoostFill = $("fs-boost-fill"),
    hudMode = $("fs-mode"), hudMsg = $("fs-msg"), hudCamTag = $("fs-camtag");
  const flightToggle = $("flightsim-toggle");
  const shipScaleSelect = $("fs-ship-scale");
  const shipModelSelect = $("fs-ship-model");
  const vexSlider = $("fs-vex");
  const fadeEl = $("fs-fade");
  const cameraModeSelect = $("fs-camera-mode");
  const startAltSelect = $("fs-start-alt");
  const speedMultSelect = $("fs-speed-mult");
  const detailLevelSelect = $("fs-detail-level");
  const cacheStatusEl = $("fs-cache-status");
  let preFlightReliefValue = null; // slider value to restore on disengage

  // True scale is realistic but reads as almost static from cruise altitude —
  // a 2.4 km/s ship takes ~90 min to cross the hemisphere. The multiplier
  // scales airspeed only (not sizes/altitudes); ×10 is the playable default.
  function speedMultiplier() {
    const v = Number(speedMultSelect?.value || 10);
    return Number.isFinite(v) && v > 0 ? v : 10;
  }

  // ---- flight state ----
  const state = {
    pos: null, quat: null, vel: null,
    throttle: 0.4,
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

  function worldToLatLon(p) {
    const q = p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -spinDelta());
    const r = q.length() || 1;
    const lat = Math.asin(Math.max(-1, Math.min(1, q.y / r))) * 180 / Math.PI;
    const sceneLon = Math.atan2(q.z, -q.x) * 180 / Math.PI;
    const lonE = ((sceneLon % 360) + 360) % 360;
    return { lat, lon: lonE };
  }

  function latLonToWorld(lat, lonE, radius) {
    return hooks.latLonToVector3(lat, lonE, radius)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), spinDelta());
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

  function makeFlagDecal() {
    return makeDecalTexture(247, 130, (g, w, h) => {
      const stripe = h / 13;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#b22234";
      for (let i = 0; i < 13; i += 2) g.fillRect(0, i * stripe, w, stripe);
      const cantonW = w * 0.4;
      const cantonH = stripe * 7;
      g.fillStyle = "#3c3b6e";
      g.fillRect(0, 0, cantonW, cantonH);
      g.fillStyle = "#ffffff";
      for (let row = 0; row < 9; row += 1) {
        const cols = (row % 2) ? 5 : 6;
        for (let col = 0; col < cols; col += 1) {
          const x = (cantonW / 12) * (1 + (col * 2) + (row % 2));
          const y = (cantonH / 10) * (1 + row);
          g.beginPath();
          g.arc(x, y, Math.max(1, h * 0.014), 0, Math.PI * 2);
          g.fill();
        }
      }
    });
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
    return _engineGlowTex;
  }

  // Drive every engine's visuals from a 0..1 thrust level. Called each frame
  // and forced to 0 when the ship is destroyed.
  function setThrustVisuals(level, boosting) {
    const t = Math.max(0, Math.min(1.6, level));
    for (const glow of engineGlow) {
      glow.opacity = t <= 0.001 ? 0 : Math.min(1, 0.2 + t * 0.8);
      glow.color.setHex(boosting ? 0xffd9a8 : 0xbfe4ff);
    }
    for (const engine of thrustCones) {
      for (const layer of engine.layers) {
        layer.mat.opacity = t <= 0.001 ? 0 : layer.baseAlpha * Math.min(1, t);
        layer.mat.color.setHex(boosting ? 0xffc98a : layer.baseAlpha > 0.8 ? 0xf2fbff
          : layer.baseAlpha > 0.3 ? 0x9fd8ff : 0x4f8fd6);
        // Plume stretches with throttle and the apex stays pinned at the nozzle.
        const stretch = 0.45 + (t * 0.75) + (boosting ? 0.45 : 0);
        layer.mesh.scale.set(1, stretch, 1);
        layer.mesh.position.z = layer.baseZ + (layer.length * stretch) / 2;
      }
      for (const dia of engine.diamonds) {
        // Diamonds only form under real thrust, fade with distance downstream,
        // and pack closer together as the plume intensifies.
        const spacing = 1.25 + (t * 0.9);
        dia.mesh.position.z = engine.origin.z + 3.3 + (dia.index * spacing);
        dia.mat.opacity = t < 0.25 ? 0 : Math.max(0, (t - 0.25) * 0.9) * (1 - dia.index * 0.22);
        dia.mat.color.setHex(boosting ? 0xffe3bb : 0xffffff);
        const s = 0.7 + t * 0.5;
        dia.mesh.scale.set(s, s, s * 2.1);
      }
    }
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
    // "United States" along both sides of the payload bay. A plane rotated
    // ±90° about Y reads correctly from the side it faces.
    const usTex = makeTextDecal("UNITED STATES", 1024, 128);
    for (const side of [1, -1]) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 1.2), decalMat(usTex));
      decal.position.set(side * 2.47, 0.75, 0.5);
      decal.rotation.y = side * (Math.PI / 2);
      group.add(decal);
    }
    // US flag on the left wing, "USA" on the right — as flown.
    const flagDecal = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.8), decalMat(makeFlagDecal()));
    flagDecal.rotation.x = -Math.PI / 2;
    flagDecal.position.set(-6.4, -0.24, 2.6);
    group.add(flagDecal);
    // No z-rotation here: the plane's local +X already maps to world +X, so the
    // lettering reads correctly from above. Rotating it flipped the text.
    const usaDecal = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), decalMat(makeTextDecal("USA", 512, 256)));
    usaDecal.rotation.x = -Math.PI / 2;
    usaDecal.position.set(6.0, -0.24, 2.6);
    group.add(usaDecal);

    // ---- main engines (3 × SSME) ----
    engineGlow = [];
    thrustCones = [];
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
      const plumeLayers = [
        { radius: 0.42, length: 7,  color: 0xf2fbff, alpha: 0.95 },
        { radius: 0.95, length: 12, color: 0x9fd8ff, alpha: 0.42 },
        { radius: 1.7,  length: 17, color: 0x4f8fd6, alpha: 0.16 },
      ];
      const layers = [];
      for (const layer of plumeLayers) {
        const mat = new THREE.MeshBasicMaterial({
          color: layer.color, transparent: true, opacity: 0,
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

  // A blue police box that tumbles around its vertical axis as it flies.
  function buildTardis() {
    const group = new THREE.Group();
    group.userData.nominalLength = 12;
    group.userData.spins = true;
    const body = new THREE.MeshStandardMaterial({ color: 0x0c3f74, metalness: 0.12, roughness: 0.62 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x07223f, metalness: 0.18, roughness: 0.55 });
    const winMat = new THREE.MeshStandardMaterial({ color: 0xcfeaff, emissive: 0x74b8ff, emissiveIntensity: 0.6, roughness: 0.35 });
    const W = 4.6, D = 4.6, H = 11;
    const mk = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); group.add(m); return m; };
    mk(new THREE.BoxGeometry(W, H, D), body, 0, 0, 0);
    // vertical corner posts (defining police-box feature)
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      mk(new THREE.BoxGeometry(0.5, H + 0.5, 0.5), trim, cx * W / 2, 0, cz * D / 2);
    // per-face doors, window (mullion grid), sign
    for (let face = 0; face < 4; face++) {
      const rot = face * Math.PI / 2, s = Math.sin(rot), c = Math.cos(rot);
      const place = (localX, y, out, w, hh, dd, mat) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, dd), mat);
        m.position.set(s * (D / 2 + out) + c * localX, y, c * (D / 2 + out) - s * localX);
        m.rotation.y = rot; group.add(m); return m;
      };
      for (const px of [-1, 1]) {                                   // two doors: frame + raised panel
        place(px * W * 0.22, -H * 0.15, 0.03, W * 0.38, H * 0.52, 0.10, trim);
        place(px * W * 0.22, -H * 0.15, 0.09, W * 0.32, H * 0.46, 0.05, body);
      }
      place(-0.12, -H * 0.15, 0.14, 0.35, 0.24, 0.12, trim);        // door handle
      const wy = H * 0.28;                                          // window
      place(0, wy, 0.05, W * 0.76, H * 0.20, 0.04, winMat);
      for (const mx of [-1, 0, 1]) place(mx * W * 0.25, wy, 0.09, 0.08, H * 0.20, 0.05, trim);
      for (const my of [-1, 1]) place(0, wy + my * H * 0.07, 0.09, W * 0.76, 0.08, 0.05, trim);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, 0.85),
        new THREE.MeshStandardMaterial({ map: signDecal("POLICE BOX", "#0c3f74", "#eef4ff"), emissive: 0x22456a, emissiveIntensity: 0.35 }));
      sign.position.set(s * (D / 2 + 0.06), H * 0.435, c * (D / 2 + 0.06)); sign.rotation.y = rot; group.add(sign);
    }
    // stepped roof (4 tiers) + lamp housing + beacon
    [[1.12, 0.45, 0.30], [0.88, 0.50, 0.70], [0.64, 0.45, 1.10], [0.44, 0.40, 1.45]]
      .forEach(([sc, ht, y], i) => mk(new THREE.BoxGeometry(W * sc, ht, D * sc), i % 2 ? body : trim, 0, H / 2 + y, 0));
    mk(new THREE.CylinderGeometry(0.35, 0.45, 0.8, 12), trim, 0, H / 2 + 1.9, 0);
    mk(new THREE.SphereGeometry(0.5, 18, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 1.3, roughness: 0.3 }), 0, H / 2 + 2.5, 0);
    return group;
  }

  // Saucer + engineering hull + two glowing nacelles.
  function buildStarship() {
    const group = new THREE.Group();
    group.userData.nominalLength = 26;
    const V2 = (x, y) => new THREE.Vector2(x, y);
    const hull = new THREE.MeshStandardMaterial({ color: 0xe7ebf1, metalness: 0.38, roughness: 0.42 });
    const hull2 = new THREE.MeshStandardMaterial({ color: 0xc6cdd8, metalness: 0.48, roughness: 0.48 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x59616f, metalness: 0.6, roughness: 0.42 });
    const win = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffca6a, emissiveIntensity: 1.0, roughness: 0.4 });
    const blueGlow = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, emissive: 0x2f90ff, emissiveIntensity: 1.7, roughness: 0.25 });
    const redGlow = new THREE.MeshStandardMaterial({ color: 0xff9a78, emissive: 0xff3311, emissiveIntensity: 1.8, roughness: 0.3 });
    const amber = new THREE.MeshStandardMaterial({ color: 0xffdca6, emissive: 0xff9a3c, emissiveIntensity: 1.3, roughness: 0.35 });
    // saucer (lathed lens) — front at -Z, sits high
    const sp = [[0, 0.95], [1.4, 0.9], [3.2, 0.76], [5, 0.52], [6.6, 0.22], [7.2, 0], [6.9, -0.18], [4.6, -0.4], [1.6, -0.46], [0, -0.44]].map((p) => V2(p[0], p[1]));
    const saucer = new THREE.Mesh(new THREE.LatheGeometry(sp, 64), hull);
    saucer.position.set(0, 0.6, -6.5); group.add(saucer);
    const rimBand = new THREE.Mesh(new THREE.TorusGeometry(7.05, 0.16, 10, 64), hull2);
    rimBand.rotation.x = Math.PI / 2; rimBand.position.set(0, 0.6, -6.5); group.add(rimBand);
    const bridge = new THREE.Mesh(new THREE.SphereGeometry(1.5, 26, 14, 0, Math.PI * 2, 0, Math.PI / 2), hull2);
    bridge.position.set(0, 1.5, -6.5); group.add(bridge);
    // saucer-edge window ring
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2;
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.42), win);
      w.position.set(Math.cos(a) * 6.9, 0.5, -6.5 + Math.sin(a) * 6.9); w.lookAt(0, 0.5, -6.5); group.add(w);
    }
    // swept neck → engineering hull
    const neck = new THREE.Mesh(new THREE.BoxGeometry(1.3, 3.2, 2.3), hull2);
    neck.position.set(0, -0.6, -2.8); neck.rotation.x = -0.58; group.add(neck);
    const eng = new THREE.Mesh(new THREE.CapsuleGeometry(1.85, 8.5, 6, 22), hull);
    eng.rotation.x = Math.PI / 2; eng.position.set(0, -1.6, 3.6); group.add(eng);
    // deflector dish (glowing, front of engineering hull)
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), amber);
    dish.rotation.x = Math.PI / 2; dish.position.set(0, -1.6, -1.8); dish.scale.z = 0.4; group.add(dish);
    const dishRing = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.16, 10, 30), hull2);
    dishRing.position.set(0, -1.6, -1.7); group.add(dishRing);
    // nacelles on swept pylons
    for (const side of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.8, 2.4), dark);
      pylon.position.set(side * 2.4, 0.5, 5.6); pylon.rotation.z = side * 0.64; group.add(pylon);
      const nac = new THREE.Mesh(new THREE.CapsuleGeometry(0.95, 9, 6, 20), hull);
      nac.rotation.x = Math.PI / 2; nac.position.set(side * 4.9, 2.1, 4); group.add(nac);
      const buss = new THREE.Mesh(new THREE.SphereGeometry(1.0, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), redGlow);
      buss.rotation.x = -Math.PI / 2; buss.position.set(side * 4.9, 2.1, -1.7); group.add(buss);
      const grille = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 8), blueGlow);
      grille.position.set(side * 4.9, 3.05, 4.2); group.add(grille);
      const grilleSide = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 8), blueGlow);
      grilleSide.position.set(side * 5.85, 2.1, 4.2); group.add(grilleSide);
    }
    return group;
  }

  // Four-wing X-configuration fighter with throttle-driven engine flares.
  function buildXFighter() {
    const group = new THREE.Group();
    group.userData.nominalLength = 17;
    const body = new THREE.MeshStandardMaterial({ color: 0xedeff2, metalness: 0.28, roughness: 0.52 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x7c838d, metalness: 0.62, roughness: 0.42 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x373c44, metalness: 0.55, roughness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: 0xb23a2c, metalness: 0.3, roughness: 0.6 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x2f6fa8, metalness: 0.5, roughness: 0.45 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x16232f, metalness: 0.9, roughness: 0.08, emissive: 0x0b2a3a, emissiveIntensity: 0.35 });
    // fuselage: tapered nose (-Z) → body → engine deck (+Z)
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.95, 6.5, 22), body);
    nose.rotation.x = Math.PI / 2; nose.position.z = -5; group.add(nose);
    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), dark); noseTip.position.z = -8.25; group.add(noseTip);
    const body1 = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 5.5, 20), body);
    body1.rotation.x = Math.PI / 2; body1.position.z = 1; group.add(body1);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 3.2), grey); deck.position.z = 5; group.add(deck);
    for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.5, 4.5), red); st.position.set(s * 0.6, 0, -2.4); group.add(st); }
    // cockpit canopy + frame, astromech dome behind
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.82, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    canopy.position.set(0, 0.72, -1.4); canopy.scale.set(1, 1.05, 1.95); group.add(canopy);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.07, 8, 22, Math.PI), grey);
    frame.rotation.set(0, Math.PI / 2, 0); frame.position.set(0, 0.72, -1.4); frame.scale.set(1.95, 1, 1); group.add(frame);
    const astro = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.6, 16), grey); astro.position.set(0, 0.62, 0.7); group.add(astro);
    const astroDome = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), blue); astroDome.position.set(0, 0.92, 0.7); group.add(astroDome);
    // four wings in X, each with wingtip cannon housing + long barrel + rear engine
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const roll = sy * 0.32 * sx;
      const wing = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 2.3), body);
      wing.position.set(sx * 4.5, sy * 1.6, 4.2); wing.rotation.z = roll; group.add(wing);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(8, 0.22, 0.5), red);
      stripe.position.set(sx * 4.5, sy * 1.6, 3.2); stripe.rotation.z = roll; group.add(stripe);
      const tipX = sx * 8.4, tipY = sy * 1.6 + Math.sin(roll) * 4 * sx;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 2.2), dark); tip.position.set(tipX, tipY, 4.2); tip.rotation.z = roll; group.add(tip);
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.5, 12), grey);
      cannon.rotation.x = Math.PI / 2; cannon.position.set(tipX, tipY, 0.6); group.add(cannon);
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.9, 12), dark);
      muzzle.rotation.x = Math.PI / 2; muzzle.position.set(tipX, tipY, -2.9); group.add(muzzle);
      // rear engine at wing root: housing + glowing intake ring + throttle flare
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.6, 2.2, 18), grey);
      eng.rotation.x = Math.PI / 2; eng.position.set(sx * 1.5, sy * 0.85, 6.2); group.add(eng);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 8, 20), dark);
      ring.position.set(sx * 1.5, sy * 0.85, 7.35); group.add(ring);
      const glMat = new THREE.SpriteMaterial({ map: engineGlowTexture(), color: 0xff7a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 });
      const gl = new THREE.Sprite(glMat); gl.position.set(sx * 1.5, sy * 0.85, 7.6); gl.scale.set(2.2, 2.2, 1); group.add(gl); engineGlow.push(glMat);
    }
    return group;
  }

  // Classic flying saucer: lathed lens hull, glowing dome, underside drive ring.
  function buildSaucer() {
    const group = new THREE.Group();
    group.userData.nominalLength = 15;
    const V2 = (x, y) => new THREE.Vector2(x, y);
    const shell = new THREE.MeshStandardMaterial({ color: 0xcfd4db, metalness: 0.78, roughness: 0.26 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x8b929c, metalness: 0.7, roughness: 0.35 });
    const dome = new THREE.MeshStandardMaterial({ color: 0x36e0d2, metalness: 0.3, roughness: 0.1, emissive: 0x13a89c, emissiveIntensity: 0.9, transparent: true, opacity: 0.92 });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffe680, emissive: 0xffcf3a, emissiveIntensity: 1.5, roughness: 0.4 });
    const driveMat = new THREE.MeshStandardMaterial({ color: 0x9fe6ff, emissive: 0x37b6ff, emissiveIntensity: 1.6, roughness: 0.3 });
    // hull: lathed lens (wide, smooth)
    const lp = [[0, 1.45], [1.6, 1.32], [3.2, 1.02], [4.8, 0.62], [6.2, 0.18], [7, 0], [6.3, -0.5], [4, -1.0], [1.6, -1.22], [0, -1.28]].map((p) => V2(p[0], p[1]));
    const shellMesh = new THREE.Mesh(new THREE.LatheGeometry(lp, 64), shell); group.add(shellMesh);
    // equatorial trim band
    const band = new THREE.Mesh(new THREE.TorusGeometry(7.0, 0.28, 12, 64), trim);
    band.rotation.x = Math.PI / 2; group.add(band);
    // glowing dome (cockpit)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(3.0, 30, 18, 0, Math.PI * 2, 0, Math.PI / 2), dome);
    cap.position.y = 1.35; group.add(cap);
    const capRing = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.14, 10, 36), trim);
    capRing.rotation.x = Math.PI / 2; capRing.position.y = 1.35; group.add(capRing);
    // underside recessed drive ring (glowing)
    const drive = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.5, 14, 48), driveMat);
    drive.rotation.x = Math.PI / 2; drive.position.y = -1.05; group.add(drive);
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 14), driveMat);
    core.scale.y = 0.5; core.position.y = -1.05; group.add(core);
    // rim light sequence
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), lightMat);
      l.position.set(Math.cos(a) * 6.95, -0.05, Math.sin(a) * 6.95); group.add(l);
    }
    return group;
  }

  const SHIP_BUILDERS = {
    shuttle: buildShuttle, tardis: buildTardis, starship: buildStarship,
    xfighter: buildXFighter, saucer: buildSaucer,
  };

  function buildShip() {
    const model = shipModelSelect?.value || "shuttle";
    engineGlow = [];
    thrustCones = [];
    const group = (SHIP_BUILDERS[model] || buildShuttle)();
    group.userData.model = model;
    group.visible = false;
    group.traverse((o) => { o.raycast = () => {}; }); // never intercept viewer picking
    hooks.scene.add(group);
    return group;
  }

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const m = o.material; if (m.map) m.map.dispose(); m.dispose(); }
    });
  }

  function rebuildShip() {
    if (!hooks) return;
    if (ship) { hooks.scene.remove(ship); disposeGroup(ship); }
    ship = buildShip();
    applyShipScale();
    ship.visible = fs.active && state.cam !== "cockpit";
  }

  // ── External model loading (.stl) ────────────────────────────────────────
  // Load a real 3-D model from a file the pilot picks. STL is geometry-only, so
  // we apply a spacecraft-grade PBR material; the mesh is centred, oriented so
  // its longest axis points forward (−Z), and normalised so its size maps to the
  // chosen "Ship display size" — i.e. it's auto-scaled like the built-ins.
  let _customGeometry = null; // master geometry (cloned per ship build)

  function buildCustomModel() {
    const group = new THREE.Group();
    if (!_customGeometry) { group.userData.nominalLength = 35; return group; }
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.55, roughness: 0.42 });
    const mesh = new THREE.Mesh(_customGeometry.clone(), mat); // clone: disposeGroup mustn't free the master
    group.add(mesh);
    group.userData.nominalLength = _customGeometry.userData.nominalLength || 35;
    return group;
  }

  async function loadModelFile(file) {
    if (!file || !hooks) return;
    const name = file.name.toLowerCase();
    try {
      let geo;
      if (name.endsWith(".stl")) {
        const mod = await import("/flight_sim/mars_flightsim/vendor/STLLoader.js");
        geo = new mod.STLLoader().parse(await file.arrayBuffer());
      } else {
        flash("UNSUPPORTED FILE — USE .STL");
        return;
      }
      if (!geo?.getAttribute?.("position")) { flash("MODEL PARSE FAILED"); return; }
      // centre at origin
      geo.computeBoundingBox();
      const size = new THREE.Vector3(), ctr = new THREE.Vector3();
      geo.boundingBox.getSize(size); geo.boundingBox.getCenter(ctr);
      geo.translate(-ctr.x, -ctr.y, -ctr.z);
      // orient longest axis → forward (−Z)
      if (size.z >= size.x && size.z >= size.y) { /* already Z-dominant */ }
      else if (size.x >= size.y) geo.rotateY(Math.PI / 2); // X → Z
      else geo.rotateX(-Math.PI / 2);                      // Y → Z
      geo.computeVertexNormals();
      geo.userData.nominalLength = Math.max(size.x, size.y, size.z) || 35;
      _customGeometry = geo;
      // add / update a "Custom" option and select it
      let opt = shipModelSelect && [...shipModelSelect.options].find((o) => o.value === "custom");
      if (shipModelSelect && !opt) { opt = document.createElement("option"); opt.value = "custom"; shipModelSelect.insertBefore(opt, shipModelSelect.firstChild); }
      if (opt) opt.textContent = "Custom: " + file.name.replace(/\.[^.]+$/, "");
      if (shipModelSelect) shipModelSelect.value = "custom";
      rebuildShip();
      const tris = (geo.getAttribute("position").count / 3) | 0;
      flash("MODEL LOADED · " + tris.toLocaleString() + " TRIS");
    } catch (e) {
      flash("MODEL LOAD ERROR");
      console.error("[flightsim] model load failed", e);
    }
  }

  function openModelPicker() {
    let input = document.getElementById("fs-model-file");
    if (!input) {
      input = document.createElement("input");
      input.type = "file"; input.id = "fs-model-file"; input.accept = ".stl"; input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("change", () => { if (input.files[0]) loadModelFile(input.files[0]); input.value = ""; });
    }
    input.click();
  }

  function shipDisplayLengthUnits() {
    const meters = SHIP_SIZES_M[shipScaleSelect?.value] || SHIP_SIZES_M.cinematic;
    return meters / METERS_PER_UNIT;
  }

  // Ground clearance scales with the displayed ship so the hull never visually
  // buries itself in the terrain (a 6 km arcade ship needs far more than 60 m).
  function minClearanceUnits() {
    return Math.max(MIN_CLEARANCE_M / METERS_PER_UNIT, shipDisplayLengthUnits() * 0.55);
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
    s.throttle = 0;
    if (ship) ship.visible = false;
    setThrustVisuals(0, false);
    if (!explosion) explosion = buildExplosion();
    explosion.position.copy(state.pos).setLength(surfaceRadiusAt(ll.lat, ll.lon));
    explosion.visible = true;
    explosion.material.opacity = 1;
    explosionT = 0;
    flash("⚠ SHIP DOWN");
    if (hudMode) { hudMode.textContent = "CRASH"; hudMode.style.color = "#ff6a4d"; }
  }

  function respawnAfterCrash(camera) {
    const s = state;
    const ll = s.crashLatLon || worldToLatLon(s.pos);
    const radius = surfaceRadiusAt(ll.lat, ll.lon) + 8000 / METERS_PER_UNIT;
    s.pos = latLonToWorld(ll.lat, ll.lon, radius);
    s.quat = tangentBasisQuat(s.pos);
    s.vel = new THREE.Vector3();
    s.speed = 0;
    s.throttle = 0.4;
    s.boost = 1;
    s.crashed = false;
    s.crashLatLon = null;
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
  function tangentBasisQuat(pos, headingEast = true) {
    const up = pos.clone().normalize();
    let right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up);
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
    state.throttle = 0.4;
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
    const path = (window.__marsViewerManifest?.texture?.path) || "assets/mars_color.jpg";
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

  function engage() {
    if (!hooks || fs.active) return;
    if (hooks.isMoonViewerActive()) { flash("EXIT MOON VIEWER FIRST"); syncToggle(false); return; }
    installContextLossRecovery();
    repairBaseTexture();
    document.body.classList.add("fs-flying"); // drives flight-only UI (hides logo, etc.)
    document.getElementById("nav-collapse-btn")?.click(); // collapse the nav panel on launch

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

    // 3. Spawn at the sub-camera point, at the selected altitude above terrain.
    const cam = hooks.camera;
    const here = worldToLatLon(cam.position);
    const startAltM = Number(startAltSelect?.value || 30000);
    const radius = surfaceRadiusAt(here.lat, here.lon) + startAltM / METERS_PER_UNIT;
    if (!ship) ship = buildShip();
    applyShipScale();
    state.pos = latLonToWorld(here.lat, here.lon, radius);
    state.quat = tangentBasisQuat(state.pos);
    state.vel = new THREE.Vector3();
    state.speed = 0;
    state.throttle = 0.4;
    state.boost = 1;
    state.cam = cameraModeSelect?.value || "chase";
    state.lastT = 0;
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
    if (cameraModeSelect) cameraModeSelect.value = state.cam;
    if (ship) ship.visible = state.cam !== "cockpit";
    updateCamTag();
    flash(state.cam === "cockpit" ? "COCKPIT VIEW" : "CHASE VIEW");
  }

  // ---- per-frame update (called from the viewer render loop) ----
  function update(camera) {
    if (!fs.active) return;
    if (hooks.isMoonViewerActive()) { disengage(); return; }

    const now = performance.now();
    let dt = state.lastT ? (now - state.lastT) / 1000 : 0;
    state.lastT = now;
    dt = Math.min(0.05, Math.max(0, dt));
    if (!dt) return;

    const s = state;

    if (s.crashed) {
      runCrash(dt, camera);
      return;
    }

    // rotational control (body axes)
    let pitch = 0, yaw = 0, roll = 0;
    if (keys.ArrowUp) pitch += PITCH_RATE;
    if (keys.ArrowDown) pitch -= PITCH_RATE;
    if (keys.ArrowLeft) roll += ROLL_RATE;
    if (keys.ArrowRight) roll -= ROLL_RATE;
    if (keys.KeyA) yaw += YAW_RATE;
    if (keys.KeyD) yaw -= YAW_RATE;
    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * dt, yaw * dt, roll * dt, "XYZ"));
    s.quat.multiply(dq).normalize();

    // throttle
    if (keys.KeyW) s.throttle = Math.min(1, s.throttle + 0.5 * dt);
    if (keys.KeyS) s.throttle = Math.max(0, s.throttle - 0.6 * dt);

    // boost energy
    s.boosting = Boolean(keys.ShiftLeft || keys.ShiftRight) && s.boost > 0.02;
    if (s.boosting) s.boost = Math.max(0, s.boost - 0.28 * dt);
    else s.boost = Math.min(1, s.boost + 0.12 * dt);

    s.braking = Boolean(keys.Space);

    // speed dynamics (scene units)
    const maxSpeed = (MAX_SPEED_MS * speedMultiplier() / METERS_PER_UNIT) * (s.boosting ? BOOST_MULT : 1);
    const target = s.throttle * maxSpeed;
    const rate = s.boosting ? 2.4 : 1.4;
    s.speed += (target - s.speed) * Math.min(1, rate * dt * (target > s.speed ? 1.4 : 1));
    if (s.braking) s.speed *= (1 - 1.4 * dt);
    s.speed = Math.max(0, s.speed);

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
    const up = s.pos.clone().normalize();

    // gentle gravity pull (arcade-scaled Mars gravity)
    const grav = up.clone().multiplyScalar(-(3.71 * 3 / METERS_PER_UNIT) * dt);
    s.vel.copy(fwd).multiplyScalar(s.speed).add(grav);
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
      // Hard vertical impact → crash sequence. Threshold scales with the
      // speed multiplier so ×10/×50 flight stays survivable at shallow angles.
      const downMs = -vn * METERS_PER_UNIT;
      if (downMs > 450 * speedMultiplier()) {
        s.pos.setLength(floorR);
        triggerCrash(ll);
        return;
      }
      s.pos.setLength(floorR);
      r = floorR;
      if (vn < 0) s.vel.addScaledVector(n, -vn * 1.6);
      s.speed *= 0.985;
      const gentle = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6 * dt, 0, 0));
      s.quat.multiply(gentle);
      flash("⚠ TERRAIN — SKIMMING");
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
      // Keep the accumulator bounded (mod 2π) so it never drifts to a huge float.
      state.spinAngle = ((state.spinAngle || 0) + dt * (0.8 + s.speed * 40)) % (Math.PI * 2);
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
      camera.position.lerp(chasePos, Math.min(1, 7 * dt));
      camera.up.lerp(shipUp, Math.min(1, 5 * dt)).normalize();
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
    if (hudAlt) hudAlt.textContent = altM >= 10000 ? (altM / 1000).toFixed(1) + " km" : Math.round(altM) + " m";
    if (hudSpd) hudSpd.textContent = spdMs >= 1000 ? (spdMs / 1000).toFixed(2) + " km/s" : Math.round(spdMs) + " m/s";
    const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up).normalize();
    const north = new THREE.Vector3().crossVectors(up, east).normalize();
    const hdg = (Math.atan2(fwd.dot(east), fwd.dot(north)) * 180 / Math.PI + 360) % 360;
    if (hudHdg) hudHdg.textContent = String(Math.round(hdg)).padStart(3, "0") + "°";
    if (hudCoord) hudCoord.textContent =
      Math.abs(ll.lat).toFixed(1) + "°" + (ll.lat >= 0 ? "N" : "S") + " " + ll.lon.toFixed(1) + "°E";
    if (hudRegion) hudRegion.textContent = regionName(ll.lat, ll.lon);
    if (hudThr) hudThr.textContent = Math.round(s.throttle * 100) + "%";
    if (hudThrottleFill) hudThrottleFill.style.width = (s.throttle * 100) + "%";
    if (hudBoostFill) hudBoostFill.style.width = (s.boost * 100) + "%";
    if (hudMode) {
      hudMode.textContent = s.boosting ? "★ BOOST" : (s.braking ? "BRAKE" : (altM < 3000 ? "LOW PASS" : "CRUISE"));
      hudMode.style.color = s.boosting ? "#8ad0ff" : (altM < 3000 ? "#ffb089" : "#ffd9c4");
    }
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

  window.addEventListener("keydown", (e) => {
    if (!fs.active || typingInField(e)) return;
    // Steal focus from panel controls so Space/arrows fly the ship instead of
    // re-toggling the engage checkbox or scrolling a select.
    blurNonTextControl(e);
    keys[e.code] = true;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.code === "KeyC") toggleCam();
    if (e.code === "KeyR") levelOut();
    if (e.code === "KeyH") {
      state.hudVisible = !state.hudVisible;
      hud?.classList.toggle("fs-hud-hidden", !state.hudVisible);
    }
    if (e.code === "Escape") disengage();
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });
  window.addEventListener("blur", () => { for (const k of Object.keys(keys)) keys[k] = false; });

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

  flightToggle?.addEventListener("change", () => {
    const engaging = flightToggle.checked;
    screenTransition(() => { if (engaging) engage(); else disengage(); });
  });
  shipScaleSelect?.addEventListener("change", applyShipScale);
  SHIP_BUILDERS.custom = buildCustomModel;
  fs.loadModel = loadModelFile; // public API: load a File (.stl) as the ship
  shipModelSelect?.addEventListener("change", () => {
    if (shipModelSelect.value === "loadfile") {
      // Not a real model — reset to the current one so cancelling the picker
      // doesn't leave the sim on an empty selection, then open the file dialog.
      shipModelSelect.value = ship?.userData?.model || "shuttle";
      openModelPicker();
      return;
    }
    rebuildShip();
  });
  const applyDetailLevel = () => {
    fs.maxDetailLevel = Number(detailLevelSelect?.value) || 9;
    // Force the streamer to re-plan tiles at the new ceiling on the next frame.
    if (hooks?.ctxDetailStreamer) hooks.ctxDetailStreamer._lastStateKey = "";
  };
  detailLevelSelect?.addEventListener("change", applyDetailLevel);
  cameraModeSelect?.addEventListener("change", () => {
    if (!fs.active) return;
    state.cam = cameraModeSelect.value === "cockpit" ? "cockpit" : "chase";
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
    if (cacheStatusEl) cacheStatusEl.textContent = "Downloaded global base (L0–L6, 325 m/px): " + text;
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
    // Start warming the global tile cache once the viewer has finished booting.
    // (Tile colorization is done on the GPU inside the detail streamer.)
    setTimeout(() => { warmGlobalCtxCache().catch(() => setCacheStatus("paused")); }, 4000);
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
