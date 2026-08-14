/**
 * The named mountain: camps, route, peaks and points of interest, as things
 * that exist in the scene and can be looked at, walked to and read about.
 *
 * Every position here comes from `config.js`, which got it from the DEM.
 * Heights are re-read from the live heightfield at boot rather than trusted
 * from the table, because the table's `dem` figure was measured at z14 and
 * the game runs on a blend of three tiers — a camp floating two metres above
 * its own snow is the kind of thing nobody notices until they walk through it.
 */

import * as THREE from "../vendor/three.module.js?v=4aa1a88-d2dc7919";
import { ROUTE, CAMPS, PEAKS, POI_EXTRA, SUMMIT } from "./config.js?v=4aa1a88-d2dc7919";
import { llToLocal, haversine } from "./geo.js?v=4aa1a88-d2dc7919";

/** Screen-space label for a point in the world. Drawn as DOM rather than as
 *  sprites: text stays crisp at any distance, wraps properly, and can be
 *  styled with the rest of the interface instead of being baked into a
 *  texture at one size. */
class Label {
  constructor(poi, host) {
    this.poi = poi;
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "poi-label poi-" + poi.kind;
    /* The flight sim's horizon-tag form: the pill floats high over the
       feature, the distance reads beneath it, and a chevron points down
       the connector line at what is being named. */
    this.el.innerHTML =
      `<span class="poi-pill"><span class="poi-pip"></span><span class="poi-text">${poi.name}</span></span>` +
      `<span class="poi-dist"></span>` +
      `<span class="poi-arrow">\u25BE</span>`;
    this.dist = this.el.querySelector(".poi-dist");
    this.el.addEventListener("click", () => poi.onOpen && poi.onOpen(poi));
    host.appendChild(this.el);
    this.visible = false;
  }
  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.el.style.display = v ? "" : "none";
  }
  dispose() { this.el.remove(); }
}

export class World {
  /**
   * @param field  Heightfield — POIs snap to it
   * @param labelHost  a DOM element the labels live in
   */
  constructor(field, labelHost) {
    this.field = field;
    this.group = new THREE.Group();
    this.group.name = "world-markers";
    this.pois = [];
    this.labelHost = labelHost;
    this.labels = new Map();
    this.onOpen = null;

    this.build();
  }

  build() {
    const add = (p, kind, extra = {}) => {
      const l = llToLocal(p.lat, p.lon);
      const poi = {
        id: p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: p.name, kind, lat: p.lat, lon: p.lon,
        x: l.x, z: l.z, y: 0,
        published: p.published ?? null,
        text: p.text || p.note || "",
        ...extra,
      };
      poi.onOpen = (q) => this.onOpen && this.onOpen(q);
      this.pois.push(poi);
      return poi;
    };

    for (const p of ROUTE) {
      const kind = p.camp ? (p.id === "summit" ? "summit" : "camp") : "route";
      add(p, kind, {
        camp: !!p.camp,
        text: ROUTE_TEXT[p.id] || "",
        order: ROUTE.indexOf(p),
      });
    }
    for (const p of PEAKS) add(p, "peak");
    for (const p of POI_EXTRA) add(p, p.kind);

    /* Markers. A camp is a cairn of prayer flags; a route point is a wand;
       a peak has nothing in the world, only a label — you cannot put a sign
       on the top of Lhotse. */
    for (const poi of this.pois) {
      if (poi.kind === "peak") continue;
      const m = poi.kind === "camp" || poi.kind === "summit"
        ? campMarker(poi.kind === "summit")
        : wandMarker(poi.kind === "warning");
      m.userData.poi = poi;
      poi.marker = m;
      this.group.add(m);
    }
  }

  /**
   * The fixed line, the trail beaten into the snow beside it, and the wands.
   *
   * This is not a HUD affordance bolted on — it is the single most
   * conspicuous man-made thing on the mountain. The Icefall Doctors re-rig
   * three kilometres of rope every season and everybody clips into the same
   * one, so a route that was invisible until you read the compass was the
   * thing most obviously missing. It also does the job a waypoint arrow
   * would do, and does it diegetically: in a whiteout the orange wands are
   * how you find your way, exactly as they are in life.
   *
   * The line is the config route densified and dropped onto the terrain.
   * Between waypoints it is a straight interpolation — the waypoints
   * themselves came off a least-cost path over the DEM, so the shape is
   * right at the scale that matters and approximate between.
   */
  buildRoute() {
    if (this.routeGroup) this.group.remove(this.routeGroup);
    const g = new THREE.Group();
    g.name = "fixed-line";
    this.routeGroup = g;
    this.group.add(g);

    const pts = [];
    const src = (this.routePathLL || ROUTE).map((p) => ({ ...llToLocal(p.lat, p.lon) }));
    for (let i = 1; i < src.length; i++) {
      const a = src[i - 1], b = src[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(2, Math.ceil(len / 7));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        pts.push({ x, z, y: this.field.height(x, z) });
      }
    }
    pts.push({ ...src[src.length - 1], y: this.field.height(src[src.length - 1].x, src[src.length - 1].z) });
    this.routePoints = pts;

    /* The rope is no longer geometry. A ribbon draped over a mesh that
       renders FILTERED heights disagrees with that mesh systematically —
       buried on every crest, floating over every hollow — and no constant
       lift can fix a spatially varying error. The route is now painted
       into a world-space mask (buildRouteMask below) and tinted onto the
       ground by the terrain shader itself: part of the surface by
       construction, at every LOD. The wands stay as geometry — points
       have none of these problems. */

    /* Wands, every sixty metres or so.
       **Instanced.** There are 173 of them and each was a Group holding two
       Meshes, so the fixed line alone cost about 350 draw calls — more than
       the entire rest of the scene put together, for two hundred grams of
       bamboo. Nothing about them varies except a transform, which is exactly
       what an InstancedMesh is for. */
    const wandEvery = Math.max(1, Math.round(60 / 7));
    const at = [];
    for (let i = wandEvery; i < pts.length - 1; i += wandEvery) at.push({ p: pts[i], i });
    if (at.length) {
      const poles = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.018, 0.018, 1.5, 4),
        new THREE.MeshLambertMaterial({ color: 0xd8cfae }), at.length);
      const flags = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.22, 0.16),
        new THREE.MeshLambertMaterial({ color: 0xffb43c, side: THREE.DoubleSide }), at.length);
      at.forEach(({ p, i }, k) => {
        const yaw = (i * 1.7) % 6.28;
        _d.position.set(p.x, p.y + 0.75, p.z); _d.rotation.set(0, yaw, 0);
        _d.scale.setScalar(1); _d.updateMatrix();
        poles.setMatrixAt(k, _d.matrix);
        _d.position.set(p.x + Math.cos(yaw) * 0.12, p.y + 1.36, p.z - Math.sin(yaw) * 0.12);
        _d.updateMatrix();
        flags.setMatrixAt(k, _d.matrix);
      });
      poles.instanceMatrix.needsUpdate = true;
      flags.instanceMatrix.needsUpdate = true;
      poles.frustumCulled = false; flags.frustumCulled = false;
      g.add(poles, flags);
    }
  }

  /** Distance from a point to the fixed line, and how far along it you are.
   *  The HUD uses the first to tell you when you have wandered off it. */
  offRoute(x, z) {
    if (!this.routePoints) return { dist: 0, index: 0 };
    let best = 1e9, bi = 0;
    for (let i = 0; i < this.routePoints.length; i++) {
      const p = this.routePoints[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return { dist: Math.sqrt(best), index: bi };
  }

  /** Put everything on the ground. Called once the heightfield is loaded. */
  /**
   * Sporadic boulders, Base Camp valley only.
   *
   * No STL required: a boulder is an icosahedron pushed around by three
   * octaves of positional noise with its base flattened — the same trick
   * every terrain tool uses, four variants so neighbours never match. The
   * 2D photo at data/boulder.jpg wraps them as the material, and because
   * they are ordinary Lambert meshes (like the tents and the flag pole)
   * the sun and sky light them properly even while the terrain runs unlit.
   *
   * Placement is seeded, not random: the same 64 boulders on every load,
   * scattered 60-700 m from Base Camp with distance-weighted falloff,
   * rejected on slopes above 22 deg (a boulder on a steep face would visibly
   * float on the next relief change), each sunk a third of its height into
   * the moraine the way settled rock sits.
   */
  buildBoulders() {
    const bc = this.camps.find((c) => c.id === "bc");
    if (!bc) return;
    if (this.boulders) this.group.remove(this.boulders);

    const tex = new THREE.TextureLoader().load("data/boulder_skin.jpg");
    tex.colorSpace = THREE.SRGBColorSpace;
    /* Tiled, not wrapped once. The photo is a single boulder filling the
       frame, so stretching the whole image around the mesh samples its
       uniform grey middle and the rock came out looking unpainted. Repeating
       it ~3x across the surface is what actually shows grain and lichen at
       boulder scale. */
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    const mat = new THREE.MeshLambertMaterial({ map: tex });

    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    const variants = [];
    for (let v = 0; v < 4; v++) {
      // Detail 3, not 2: at 2 the facets read as cut gemstone from the
      // distance a player actually stands. 642 vertices x 4 variants is
      // still nothing.
      const geo = new THREE.IcosahedronGeometry(1, 3);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const n = Math.sin(x * 12.9 + v * 7) * Math.sin(y * 9.7 + v * 3)
                * Math.sin(z * 11.3 + v * 5);
        const r = 0.78 + 0.30 * n + 0.10 * Math.sin(x * 31 + y * 29 + z * 37);
        pos.setXYZ(i, x * r * 1.15, Math.max(y * r, -0.55), z * r);
      }
      geo.computeVertexNormals();
      variants.push(geo);
    }

    const group = new THREE.Group();
    group.name = "boulders";
    const per = 16;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
          sv = new THREE.Vector3(), pv = new THREE.Vector3(),
          eu = new THREE.Euler();
    for (const geo of variants) {
      const inst = new THREE.InstancedMesh(geo, mat, per);
      let k = 0;
      for (let tries = 0; k < per && tries < per * 40; tries++) {
        const a = rnd() * Math.PI * 2;
        const d = 60 + Math.pow(rnd(), 0.6) * 640;
        const x = bc.x + Math.cos(a) * d, z = bc.z + Math.sin(a) * d;
        if (this.field.slope(x, z, 6) > 22) continue;
        const sc = 0.35 + Math.pow(rnd(), 1.6) * 1.9;
        const ys = sc * (0.75 + rnd() * 0.4);
        const y = this.field.height(x, z) + ys * 0.36;
        q.setFromEuler(eu.set(0, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.12));
        m.compose(pv.set(x, y, z), q, sv.set(sc, ys, sc));
        inst.setMatrixAt(k++, m);
      }
      inst.count = k;
      group.add(inst);
    }
    this.boulders = group;
    this.group.add(group);
  }

  snapToGround() {
    for (const poi of this.pois) {
      poi.y = this.field.height(poi.x, poi.z);
      if (poi.marker) poi.marker.position.set(poi.x, poi.y, poi.z);
    }
    // The summit POI is the one place the surveyed height is the truth.
    const s = this.pois.find((p) => p.id === "summit");
    if (s) s.summitHeight = SUMMIT.surveyed;

    /* Pitch the camps. Base Camp is a town — three hundred tents on the
       moraine for two months — and Camp IV on the South Col is four tents on
       gravel at 7,920 m that nobody sleeps in for more than one night. The
       counts carry that difference, because it is most of what those two
       places feel like. */
    if (this.campTents) this.group.remove(this.campTents);
    const SIZE = { bc: [110, 170], c1: [8, 28], c2: [14, 40], c3: [4, 16], c4: [6, 24] };
    let seed = 3, places = [];
    for (const camp of this.camps) {
      const spec = SIZE[camp.id];
      if (!spec) continue;
      places = places.concat(pitchCamp(this.field, camp.x, camp.z, spec[0], spec[1], seed++));
    }
    this.campTents = buildTents(places);
    this.tentCount = places.length;
    this.group.add(this.campTents);
  }

  /** Camps in route order — progression is measured in these. */
  get camps() { return this.pois.filter((p) => p.camp); }

  /** The nearest POI within `radius` metres, for the "press E" prompt. */
  nearest(x, z, radius = 45) {
    let best = null, bd = radius * radius;
    for (const poi of this.pois) {
      if (poi.kind === "peak") continue;
      const d = (poi.x - x) ** 2 + (poi.z - z) ** 2;
      if (d < bd) { bd = d; best = poi; }
    }
    return best;
  }

  /** Straight-line ground distance in metres, honestly computed on the
   *  ellipsoid rather than in the local frame. */
  distanceTo(poi, lat, lon) { return haversine(lat, lon, poi.lat, poi.lon); }

  /**
   * Project every POI to the screen and place its label.
   *
   * Two rules keep this from becoming a wall of text, and both were learnt
   * the hard way on the Pluto viewer: a label behind the camera projects to a
   * perfectly plausible on-screen position (so the w-component has to be
   * checked, not just the x/y), and labels that overlap are worse than no
   * labels — so they are sorted near-to-far and a farther one that would land
   * on top of a nearer one is dropped.
   */
  updateLabels(camera, playerPos, opts = {}) {
    this._occTick = (this._occTick ?? 0) + 1;
    const maxDist = opts.maxDist ?? 20000;
    const w = opts.width, h = opts.height;
    const v = _v;
    const placed = [];

    const cand = [];
    for (const poi of this.pois) {
      const d = Math.hypot(poi.x - playerPos.x, poi.z - playerPos.z);
      if (d > maxDist) { this.hide(poi); continue; }
      /* The tag hangs 100 m over the place, like the flight sim's horizon
         labels — enough air to read as a marker rather than a sticker,
         without drifting into the sky above its feature. */
      v.set(poi.x, poi.y + 100, poi.z);
      v.project(camera);
      if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) { this.hide(poi); continue; }
      /* Terrain occlusion. A label is a claim that the place is in view, and
         a pill floating over the ridge that hides its place breaks the depth
         the mapping works to establish. The sight line from the camera to
         the anchor is marched against the heightfield — up to 28 samples,
         both endpoints skipped so a label's own hill (or the ground at the
         camera's feet) cannot occlude it, and 12 m of clearance so a grazing
         ridge does not make the label flicker. */
      {
        /* The occlusion ray runs to just above the GROUND point — a
           feature IS its ground location. Two failure modes were fixed
           the hard way: the old 28-sample cap spaced samples ~360 m
           apart at range, wide enough for a whole ridge to pass between
           them; and the percentage end-skip ignored the last several
           hundred metres of the ray — precisely where the occluding
           crest sits for a feature just behind a ridge. Samples are now
           a fixed ~55 m with absolute 35 m end-skips, and each label
           re-tests every third frame from a cache, which keeps the cost
           where the cheap version was. */
        const cp = camera.position;
        this._occTick = this._occTick ?? 0;
        if ((this._occTick + (poi._occPhase ?? (poi._occPhase = Math.floor(Math.random() * 3)))) % 3 === 0 || poi._occBlocked === undefined) {
          const ay = poi.y + 20;
          const ddx = poi.x - cp.x, ddy = ay - cp.y, ddz = poi.z - cp.z;
          const dist = Math.hypot(ddx, ddz) || 1;
          let blocked = false;
          /* Near pass first: on steep ground the occluding crest is often
             METRES from the camera — inside the far pass's 35 m end-skip,
             which existed so the ground at your feet could not hide the
             world. 12 m still covers the feet; from there to 90 m the ray
             is tested every ~6.5 m with a tight 3 m clearance, because a
             slope face grazing the sightline at close range really does
             hide what is behind it (the high-altitude leak: labels shining
             through the summit pyramid's own flank). */
          for (let s = 12; s < Math.min(90, dist - 35); s += 6.5) {
            const t = s / dist;
            if (this.field.height(cp.x + ddx * t, cp.z + ddz * t) > cp.y + ddy * t + 3) { blocked = true; break; }
          }
          if (!blocked) {
            const steps = Math.min(220, Math.max(10, Math.ceil(dist / 55)));
            /* Label-side skip is kind-aware: a PEAK's ground point sits on
               its own massif, and at z12 smoothing the summit's shoulder
               grazes the sight line a hundred-odd metres before the point —
               its own mountain blanking its own label. 180 m of skip clears
               the home shoulder; foreign ridges still occlude. Everything
               else keeps the tight 35 m. */
            const endSkip = poi.kind === "peak" ? 180 : 35;
            const t0 = Math.min(0.2, 90 / dist), t1 = 1 - Math.min(0.25, endSkip / dist);
            for (let i = 1; i < steps; i++) {
              const t = t0 + (i / steps) * (t1 - t0);
              if (t <= 0 || t >= 1) continue;
              /* 8 m of clearance, as before the near pass existed: any
                 tighter and a big peak's own shoulder — grazing the ray a
                 few metres under the summit point — blanks its label. */
              if (this.field.height(cp.x + ddx * t, cp.z + ddz * t) > cp.y + ddy * t + 8) { blocked = true; break; }
            }
          }
          poi._occBlocked = blocked;
        }
        if (poi._occBlocked) { this.hide(poi); continue; }
      }
      cand.push({ poi, d, sx: (v.x * 0.5 + 0.5) * w, sy: (-v.y * 0.5 + 0.5) * h });
    }

    /* Ranked, not just sorted by distance. Everything on this mountain is
       worth a label and all of them at once is a wall of text across the
       sky — measured at thirteen overlapping labels from Base Camp. A camp
       always beats a peak, and near beats far within a rank; anything past
       the cap is dropped rather than squeezed in. */
    const RANK = { camp: 0, summit: 0, route: 1, warning: 1, site: 2, peak: 3 };
    cand.sort((a, b) => (RANK[a.poi.kind] - RANK[b.poi.kind]) || (a.d - b.d));
    const cap = opts.max ?? 9;

    for (const c of cand) {
      if (placed.length >= cap) { this.hide(c.poi); continue; }
      let clash = false;
      for (const p of placed) {
        if (Math.abs(p.sx - c.sx) < 150 && Math.abs(p.sy - c.sy) < 30) { clash = true; break; }
      }
      if (clash) { this.hide(c.poi); continue; }
      placed.push(c);
      let lab = this.labels.get(c.poi.id);
      if (!lab) { lab = new Label(c.poi, this.labelHost); this.labels.set(c.poi.id, lab); }
      lab.setVisible(true);
      lab.el.style.transform = `translate(-50%,-100%) translate(${c.sx.toFixed(1)}px,${c.sy.toFixed(1)}px)`;
      lab.el.style.opacity = String(Math.max(0.35, 1 - c.d / maxDist));
      lab.dist.textContent = c.d > 1200 ? `${(c.d / 1000).toFixed(1)} km` : `${c.d.toFixed(0)} m`;
    }
  }

  hide(poi) { const l = this.labels.get(poi.id); if (l) l.setVisible(false); }

  /**
   * Markers are hidden when the camera is almost on top of them.
   *
   * A line of prayer flags is 0.4 m of fabric five metres wide, which is
   * correct and completely fills the screen from half a metre away — the
   * player spawns at Base Camp, and Base Camp has a marker, so the opening
   * shot of the game was two enormous green and yellow slabs. Also flutter
   * the flags, since they are here and the wind is a variable.
   */
  /** Swap in the terrain-following path (lat/lon list) and rebuild —
   *  the same line the maps draw, so there is one route everywhere. */
  setRoutePath(ll) {
    this.routePathLL = ll;
    this.buildRoute();
    this._routeMaskCentre = null;      // force a repaint on next update
  }

  /** Paint the route into a 1.5 m/px mask window that follows the player.
   *  R is the line, G encodes along-distance mod 620 m so the shader can
   *  run the travelling pulse. Repainted only when the player nears the
   *  window's edge. */
  updateRouteMask(px, pz) {
    if (!this.routePoints || !this.routePoints.length) return;
    const SIZE = 2048, SCALE = 1.5, HALF = SIZE * SCALE / 2;   // 3.07 km window
    if (!this.routeMaskCanvas) {
      this.routeMaskCanvas = document.createElement("canvas");
      this.routeMaskCanvas.width = this.routeMaskCanvas.height = SIZE;
      this.routeMaskTex = new THREE.CanvasTexture(this.routeMaskCanvas);
      /* The painter maps world +z to canvas +y and the shader samples with
         the same convention; CanvasTexture's default flipY would mirror the
         whole window about its centreline — the route drawn on the wrong
         side of the valley everywhere the line has a north-south component. */
      this.routeMaskTex.flipY = false;
      this.routeMaskTex.minFilter = THREE.LinearFilter;
      this.routeMaskTex.magFilter = THREE.LinearFilter;
      this.routeMaskBounds = new THREE.Vector4(0, 0, 1, 1);
    }
    const c = this._routeMaskCentre;
    if (c && Math.hypot(px - c.x, pz - c.z) < HALF * 0.45) return;
    this._routeMaskCentre = { x: px, z: pz };
    const minX = px - HALF, minZ = pz - HALF;
    const ctx = this.routeMaskCanvas.getContext("2d");
    ctx.clearRect(0, 0, SIZE, SIZE);
    /* Blue channel first: the GLACIER CORRIDOR, a ~900 m band along the
       route. The terrain shader reads it as "this ground is the Khumbu /
       the Cwm" — the spatial gate the fills need, because the glacier and
       the Base Camp valley overlap in altitude and can only be told apart
       by where the route runs. 900 m spans the Cwm's full width; the
       valley walls inside the band stay safe behind the shader's slope
       and altitude gates. */
    ctx.strokeStyle = "rgb(0, 0, 255)";
    ctx.lineWidth = 900 / SCALE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    for (let i = 1; i < this.routePoints.length; i++) {
      const a = this.routePoints[i - 1], b = this.routePoints[i];
      const inA = Math.abs(a.x - px) < HALF && Math.abs(a.z - pz) < HALF;
      const inB = Math.abs(b.x - px) < HALF && Math.abs(b.z - pz) < HALF;
      if (!inA && !inB) { started = false; continue; }
      if (!started) { ctx.moveTo((a.x - minX) / SCALE, (a.z - minZ) / SCALE); started = true; }
      ctx.lineTo((b.x - minX) / SCALE, (b.z - minZ) / SCALE);
    }
    ctx.stroke();
    ctx.lineWidth = 1.2;               // ~1.8 m of rope on the ground
    ctx.lineCap = "round";
    let along = 0;
    const pts = this.routePoints;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      along += seg;
      const inA = Math.abs(a.x - px) < HALF && Math.abs(a.z - pz) < HALF;
      const inB = Math.abs(b.x - px) < HALF && Math.abs(b.z - pz) < HALF;
      if (!inA && !inB) continue;
      const g = Math.round(((along % 620) / 620) * 255);
      ctx.strokeStyle = `rgb(255, ${g}, 0)`;
      ctx.beginPath();
      ctx.moveTo((a.x - minX) / SCALE, (a.z - minZ) / SCALE);
      ctx.lineTo((b.x - minX) / SCALE, (b.z - minZ) / SCALE);
      ctx.stroke();
    }
    this.routeMaskTex.needsUpdate = true;
    this.routeMaskBounds.set(minX, minZ, SIZE * SCALE, SIZE * SCALE);
  }

  updateMarkers(cameraPos, wind = 0, t = 0) {
    for (const poi of this.pois) {
      const m = poi.marker;
      if (!m) continue;
      const d2 = (poi.x - cameraPos.x) ** 2 + (poi.z - cameraPos.z) ** 2;
      m.visible = d2 > 9;                     // three metres
      if (!m.visible || !m.userData.flags) continue;
      const gust = 0.35 + 0.65 * Math.min(1, wind / 18);
      for (const c of m.children) {
        if (c.userData.flag === undefined) continue;
        c.rotation.y = Math.sin(t * 3.1 + c.userData.flag * 0.8) * 0.85 * gust;
        c.rotation.z = Math.sin(t * 2.3 + c.userData.flag) * 0.30 * gust;
      }
    }
  }

  setLabelsEnabled(on) {
    this.labelHost.style.display = on ? "" : "none";
  }
}

const _v = new THREE.Vector3();

/* ── Markers ─────────────────────────────────────────────────────────────
   Deliberately simple geometry. Everything the eye is meant to spend time on
   in this game is the mountain; a marker's job is to be findable in a
   whiteout, which means a shape and a colour, not a model. */

/**
 * Tents.
 *
 * A tunnel tent — a half-cylinder with a sloped porch — because that is what
 * is pitched above Base Camp: a dome catches wind from every direction and a
 * tunnel is laid along it. Base Camp itself gets far more of them and bigger
 * ones, because it is a town of three hundred people for two months and the
 * higher camps are four tents on a ledge.
 */
/**
 * Find somewhere to pitch: flat ground within a radius of the camp.
 * Returns placements only — the geometry is built once for every camp at
 * once, instanced, because sixty tents as sixty Groups of four Meshes is two
 * hundred and forty draw calls for something that never moves.
 */
export function pitchCamp(field, x, z, count, radius, seed) {
  const out = [];
  const colours = [0xe8b021, 0xd4562c, 0xe0d4bb, 0x3f7fbf, 0xe8b021, 0xcf9020];
  let tries = 0;
  while (out.length < count && tries < count * 24) {
    tries++;
    const a = ((seed * 37 + tries * 97) % 360) * Math.PI / 180;
    const r = radius * (0.18 + ((seed * 13 + tries * 61) % 100) / 100 * 0.82);
    const tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r;
    // Nobody pitches on a slope, and nobody pitches on a crevasse either —
    // but the glacier does not exist yet at boot, so flatness is the test.
    if (field.slope(tx, tz, 10) > 16) continue;
    /* Seat height is the terrain the MESH renders, not the raw point
       sample: the clipmap box-filters heights at its cell scale, so on
       hummocky moraine a point sample can sit a metre off the drawn
       surface and the tent floats or drowns. A 3x3 box at 8 m spacing
       approximates the rendered ground; a small sink buries the
       groundsheet; and the local gradient tilts the tent so its floor
       lies IN the slope rather than bridging it. */
    let fh = 0;
    for (const dx of [-8, 0, 8]) for (const dz of [-8, 0, 8]) fh += field.height(tx + dx, tz + dz);
    fh /= 9;
    const gx = (field.height(tx + 6, tz) - field.height(tx - 6, tz)) / 12;
    const gz = (field.height(tx, tz + 6) - field.height(tx, tz - 6)) / 12;
    out.push({
      x: tx, z: tz, y: fh - 0.14,
      yaw: a + 1.1,
      tiltX: Math.atan(gz) * 0.8, tiltZ: -Math.atan(gx) * 0.8,
      scale: 0.85 + ((tries * 29) % 40) / 100,
      colour: colours[(out.length + seed) % colours.length],
    });
  }
  return out;
}

/**
 * Merge a list of {geometry, matrix} into one non-indexed BufferGeometry.
 *
 * three's own `BufferGeometryUtils.mergeGeometries` lives in examples/, which
 * would mean vendoring a second module tree for one function. This handles
 * exactly what is needed here: position and normal, indexed or not, each part
 * baked through its own transform.
 */
function mergeParts(parts) {
  let count = 0;
  for (const p of parts) {
    const g = p.geometry;
    count += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  let o = 0;
  for (const p of parts) {
    const g = p.geometry;
    const gp = g.attributes.position, gn = g.attributes.normal;
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : gp.count;
    nm.getNormalMatrix(p.matrix);
    for (let i = 0; i < n; i++) {
      const k = idx ? idx[i] : i;
      v.fromBufferAttribute(gp, k).applyMatrix4(p.matrix);
      pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
      v.fromBufferAttribute(gn, k).applyMatrix3(nm).normalize();
      nrm[o * 3] = v.x; nrm[o * 3 + 1] = v.y; nrm[o * 3 + 2] = v.z;
      o++;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * Every tent on the mountain, in three draw calls.
 *
 * ── Why this is modelled and not a downloaded asset ──────────────────────
 * The obvious answer is an STL or a glTF of a real tent. There isn't one to
 * reach for: nothing in this project loads external binaries, a model would
 * need a licence that permits redistribution, and it would be a mesh nobody
 * here can inspect or fix. What it *was* — a half-cylinder with two end caps
 * — was not a tent, it was a lozenge, so the answer is to model the thing
 * properly rather than to model it badly.
 *
 * ── What an 8,000 m tent actually is ─────────────────────────────────────
 * A geodesic dome. Not a ridge tent and not a tunnel: a dome is the only
 * shape that takes wind from any direction without a windward end to
 * present, which is why every photograph of Camp II and the South Col is
 * domes. Four poles cross over the top in two arcs, the fly comes to the
 * ground all round, there is a vestibule at the door for boots and a stove,
 * and there is a snow valance shovelled over the skirt to stop it lifting.
 *
 * So: a flattened hemisphere, two crossed pole arcs standing proud of the
 * fabric, a vestibule half-dome at the door, a dark doorway, and a low ring
 * of snow round the base. One merged geometry per material, instanced.
 */
function tentGeometry() {
  const parts = [];
  const M = () => new THREE.Matrix4();

  /* The dome. Flattened to 0.78 of a hemisphere: a real expedition dome is
     wider than it is tall, both for headroom-per-gram and so the wind goes
     over it rather than into it. */
  const dome = new THREE.SphereGeometry(1.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
  parts.push({ geometry: dome, matrix: M().makeScale(1, 0.78, 1) });

  // The vestibule: a smaller half-dome pushed out at the door.
  const vest = new THREE.SphereGeometry(0.72, 14, 8, 0, Math.PI, 0, Math.PI * 0.5);
  parts.push({
    geometry: vest,
    matrix: M().makeTranslation(0, 0, 0.95).multiply(M().makeScale(1, 0.62, 1.15)),
  });
  const fabric = mergeParts(parts);
  dome.dispose(); vest.dispose();

  /* Poles: two arcs crossing over the apex at right angles, standing a few
     centimetres off the fabric the way a sleeved pole does. */
  const poleParts = [];
  const arc = new THREE.TorusGeometry(1.19, 0.028, 5, 22, Math.PI);
  for (const rot of [0, Math.PI / 2]) {
    const m = M().makeRotationY(rot).multiply(M().makeScale(1, 0.80, 1));
    poleParts.push({ geometry: arc, matrix: m });
  }
  // A guy line from each shoulder to a peg, which is most of what says
  // "this is pitched in wind" at a distance.
  const guy = new THREE.CylinderGeometry(0.012, 0.012, 1, 3);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const from = new THREE.Vector3(Math.cos(a) * 0.85, 0.62, Math.sin(a) * 0.85);
    const to = new THREE.Vector3(Math.cos(a) * 1.95, 0.0, Math.sin(a) * 1.95);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const dir = to.clone().sub(from);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), dir.normalize());
    poleParts.push({
      geometry: guy,
      matrix: M().compose(mid, q, new THREE.Vector3(1, len, 1)),
    });
  }
  const frame = mergeParts(poleParts);
  arc.dispose(); guy.dispose();

  // The doorway, and the snow shovelled onto the skirt.
  const doorParts = [];
  const door = new THREE.CircleGeometry(0.46, 10, 0, Math.PI);
  doorParts.push({
    geometry: door,
    matrix: M().makeTranslation(0, 0.01, 1.63).multiply(M().makeScale(1, 0.85, 1)),
  });
  const dark = mergeParts(doorParts);
  door.dispose();

  const skirtGeo = new THREE.CylinderGeometry(1.30, 1.52, 0.20, 20, 1, true);
  const snow = mergeParts([{ geometry: skirtGeo, matrix: M().makeTranslation(0, 0.09, 0) }]);
  skirtGeo.dispose();

  return { fabric, frame, dark, snow };
}

function buildTents(places) {
  const g = new THREE.Group();
  g.name = "camp-tents";
  if (!places.length) return g;
  const n = places.length;
  const geo = tentGeometry();

  const fabric = new THREE.InstancedMesh(geo.fabric,
    new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), n);
  const frame = new THREE.InstancedMesh(geo.frame,
    new THREE.MeshLambertMaterial({ color: 0x2a2d33 }), n);
  const dark = new THREE.InstancedMesh(geo.dark,
    new THREE.MeshBasicMaterial({ color: 0x14120f, side: THREE.DoubleSide }), n);
  const snow = new THREE.InstancedMesh(geo.snow,
    new THREE.MeshLambertMaterial({ color: 0xe9eef4, side: THREE.DoubleSide }), n);

  const c = new THREE.Color();
  places.forEach((p, i) => {
    _d.position.set(p.x, p.y, p.z);
    _d.rotation.set(p.tiltX || 0, p.yaw, p.tiltZ || 0, "YXZ");
    _d.scale.setScalar(p.scale);
    _d.updateMatrix();
    fabric.setMatrixAt(i, _d.matrix);
    frame.setMatrixAt(i, _d.matrix);
    dark.setMatrixAt(i, _d.matrix);
    snow.setMatrixAt(i, _d.matrix);
    fabric.setColorAt(i, c.set(p.colour));
  });

  for (const m of [snow, fabric, frame, dark]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = false;
    g.add(m);
  }
  return g;
}

const _d = new THREE.Object3D();

function campMarker(isSummit) {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: isSummit ? 0xffc93c : 0xe8e2d4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), poleMat);
  pole.position.y = 1.6;
  g.add(pole);

  /* One generic flag at the masthead — a plain rectangle that still
     flutters through updateMarkers, gold for the summit, expedition red
     for the camps. The prayer-flag string is retired by request. */
  /* The flag hinges AT the pole. The flutter animation rotates whatever
     carries userData.flag around its own origin — on the flag mesh itself
     that origin is the flag's centre, so every gust swung the cloth clean
     off the mast. A pivot group sits on the pole; the cloth hangs off its
     hinge edge inside it. */
  const hinge = new THREE.Group();
  hinge.position.set(0.05, 2.9, 0);
  const f = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 0.55),
    new THREE.MeshLambertMaterial({ color: isSummit ? 0xffc93c : 0xd8402f, side: THREE.DoubleSide }),
  );
  f.position.x = 0.425;
  hinge.add(f);
  hinge.userData.flag = 0;
  g.add(hinge);
  g.userData.flags = true;
  return g;
}

function wandMarker(isWarning) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 2.0, 5),
    new THREE.MeshLambertMaterial({ color: 0x2a2a2a }),
  );
  pole.position.y = 1.0;
  g.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.30, 0.22),
    new THREE.MeshLambertMaterial({ color: isWarning ? 0xff4d3d : 0xff8a1f, side: THREE.DoubleSide }),
  );
  flag.position.set(0.16, 1.85, 0);
  g.add(flag);
  return g;
}

/* ── What each place on the route is ─────────────────────────────────────
   The journal entry the player gets for arriving. Written to be worth
   reading once rather than skipped every time. */
const ROUTE_TEXT = {
  bc: "5,364 m, on the moving ice of the Khumbu Glacier. Three hundred tents on rubble that shifts under them all season; the medical tent, the comms tent, the kitchen. Nobody climbs Everest from here. They live here for two months and climb it in five days.",
  icefall: "The glacier turns a corner and falls six hundred metres, and the ice breaks up as it goes. Blocks the size of houses, none of them attached to anything. It is the most dangerous ground on the mountain and it is the first thing you cross.",
  icefall2: "Named for the shape of it. Everything here has moved since yesterday and will move again tonight. Cross it before the sun gets on it.",
  c1: "6,065 m, at the top of the Icefall where the ground goes flat. The first night you spend above the Icefall is the first night you cannot simply walk down.",
  cwm1: "The Western Cwm opens out. Mallory named it, from the Welsh, without ever setting foot in it.",
  cwm2: "Walled by Everest, Nuptse and Lhotse; no wind gets in. On a clear morning it is the hottest place on the mountain — 35 °C off the snow with the air twenty below.",
  c2: "6,400 m. Advanced Base Camp — the real base for the summit push. Rock underfoot at the edge of the ice, which after the Cwm feels like solid ground.",
  bergs: "The crack where the moving glacier pulls away from the ice frozen to the face above. The bergschrund is the last flat ground before the Lhotse Face.",
  face1: "1,200 metres of blue ice at forty-five degrees, and no ledges. You are on the fixed line the whole way and you do not unclip to pass anyone.",
  c3: "7,470 m, on platforms cut into the face. Tents pitched over a drop. People have walked out of one at night without clipping in.",
  yellow: "A band of yellowish limestone across the face at 7,600 m — Ordovician seabed, marine fossils in it, lifted eight kilometres by the collision that is still going on. You climb over a shallow sea.",
  geneva: "A black rib of rock named by a Swiss party in 1952. Over it, and the ground drops away to the South Col.",
  c4: "7,920 m. A flat plain of ice and rock between Everest and Lhotse, and the last camp. You arrive in the afternoon, try to eat, fail, and leave for the summit before midnight.",
  balcony: "8,430 m, on the south-east ridge, where the route comes out onto the crest and the ground falls away on both sides. Bottles are swapped here. It is usually dark and it is usually still.",
  ssummit: "8,749 m — a summit in its own right, and from it you see the last ridge and the true top for the first time. Turning round here has saved more lives than any other decision on this mountain.",
  step: "A twelve-metre step of rock and ice at 8,790 m. The 2015 earthquake changed it. It is the last obstacle and the queue for it has killed people.",
  summit: "8,848.86 m. The elevation model this world is built from reads 8,749 here — SRTM-lineage data rounds off a summit cone, and the last hundred metres of this mountain are corrected back onto the surveyed height. There is room for about six people. Fifteen minutes, and then the whole thing again, downwards, tired.",
};
