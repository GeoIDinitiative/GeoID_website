/**
 * The glacier: crevasses, the bridges over them, the ladders across them,
 * and the seracs waiting above.
 *
 * ── Where crevasses go ───────────────────────────────────────────────────
 * Not scattered at random. Ice cracks where it is being pulled apart, and it
 * is pulled apart where it accelerates — over a convexity, at a steepening,
 * where the valley widens. So the field is generated from the DEM's own
 * slope and curvature, and each crevasse is laid out **across** the direction
 * of flow, because that is the direction the ice is being stretched in. The
 * Khumbu Icefall comes out as a dense mess of them and the floor of the
 * Western Cwm as a few enormous ones, which is what those two places are.
 *
 * ── How a hole is cut in a clipmap ───────────────────────────────────────
 * It is not. The terrain shader samples a 1 m/px mask painted here and
 * discards the fragments inside a crevasse; the trench walls are separate
 * geometry drawn behind. Cutting the geometry would mean re-triangulating a
 * surface that is rebuilt every time the player walks 8 metres.
 *
 * ── The one that gets you ────────────────────────────────────────────────
 * A crevasse you can see is a nuisance. The dangerous one is under a snow
 * bridge, and fresh snow makes more of them and makes them all look the
 * same. So bridge strength is a function of the weather, and a bridge is not
 * drawn differently from solid ground — the only way to know is to probe, to
 * be roped, or to have gone that way before.
 */

import * as THREE from "../vendor/three.module.js?v=a3960f9-482e0b99";
import { llToLocal } from "./geo.js?v=a3960f9-482e0b99";
import { ROUTE, OPEN } from "./config.js?v=a3960f9-482e0b99";

const MASK_PX = 1024;
const MASK_M = 1024;            // metres covered — so exactly 1 m per pixel
const REGEN_AFTER = 340;        // metres of walking before the field is rebuilt

/** Brightness at the very lip of a crevasse wall, as a fraction of the open
 *  snow beside it. See `buildTrench` for where the number comes from. */
const LIP_RADIANCE = 0.30;

const _sd = new THREE.Object3D();

/** Deterministic value hash — the same ground always cracks the same way,
 *  so walking back across the Icefall does not find a new mountain. */
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Glacier {
  constructor(field, weather) {
    this.field = field;
    this.weather = weather;
    this.segments = [];
    this.ladders = [];
    this.seracs = [];
    this.centre = { x: NaN, z: NaN };

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = MASK_PX;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.bounds = new THREE.Vector4(0, 0, MASK_M, MASK_M);

    this.group = new THREE.Group();
    this.group.name = "glacier";
    this.trench = null;
    this.seracGroup = new THREE.Group();
    this.group.add(this.seracGroup);

    /* Where the fixed route crosses a crevasse there is a ladder, because in
       reality there is. These are the anchors the generator is told to keep
       clear and then bridge. */
    this.routePath = ROUTE.map((p) => ({ ...llToLocal(p.lat, p.lon), id: p.id }));
  }

  /** Is this ground glacier at all? Ice, not rock — the Khumbu and the Cwm,
   *  not the Lhotse Face and not the summit ridge. */
  isGlacier(x, z, h, slope) {
    if (h > 6950 || h < 4900) return false;
    if (slope > 46) return false;             // too steep to hold a glacier body
    return true;
  }

  /** Rebuild the field around a point, if the player has moved far enough. */
  update(x, z, force = false) {
    const moved = Math.hypot(x - this.centre.x, z - this.centre.z);
    if (!force && moved < REGEN_AFTER) return false;
    this.centre = { x, z };
    this.generate(x, z);

    /* Never open a hole under someone who is already standing there.
       The field is deterministic per patch of ground, but it is regenerated
       every 340 m of walking, and the player is at the centre of the new
       window — so without this a crevasse can appear beneath their feet, the
       terrain under them is discarded, and they are left standing inside the
       trench looking at blue walls. Whatever they are standing on has just
       demonstrably held their weight, so it is a bridge. */
    const under = this.at(x, z);
    if (under) { under.bridged = 1; under.collapsed = false; }

    this.paintMask(x, z);
    this.buildTrench();
    this.buildSeracs();
    return true;
  }

  generate(cx, cz) {
    const f = this.field;
    const segs = [];
    /* Candidate spacing. Measured on the first version at 38 m with an 0.82
       acceptance: **14.6% of the ground came out as open hole** — a quarter
       of a square kilometre of void in the Icefall. You cannot walk through
       that, and from eye height it is not a crevasse field, it is a wall of
       trench geometry with a few snow bridges on top. The real Khumbu is
       chaotic and still mostly ground. 52 m and 0.34 puts coverage near 3%,
       which leaves the Icefall dense and the Cwm to a handful of very large
       ones — the two things those places are. */
    const step = 52;
    const half = MASK_M / 2 - 40;
    const freshSnow = this.weather ? this.weather.snowFall : 0.2;

    for (let gz = -half; gz <= half; gz += step) {
      for (let gx = -half; gx <= half; gx += step) {
        // Quantise to a world lattice so the same ground always generates the
        // same crevasses regardless of where the window happens to sit.
        const wx = Math.round((cx + gx) / step) * step;
        const wz = Math.round((cz + gz) / step) * step;
        const h = f.height(wx, wz);
        const slope = f.slope(wx, wz, 22);
        if (!this.isGlacier(wx, wz, h, slope)) continue;

        /* Extension: ice speeds up going over a convexity, and that is where
           it tears. Measured as the along-flow second difference of height —
           positive curvature (convex) means the ice below is moving faster
           than the ice above. */
        const asp = f.aspect(wx, wz, 30) * Math.PI / 180;
        const fx = Math.sin(asp), fz = Math.cos(asp);   // downslope direction
        const d = 45;
        const hUp = f.height(wx - fx * d, wz - fz * d);
        const hDn = f.height(wx + fx * d, wz + fz * d);
        const convex = (hUp + hDn - 2 * h) / (d * d) * 1000;

        const steepness = Math.min(1, Math.max(0, (slope - 5) / 22));
        const tearing = Math.min(1, Math.max(0, convex * 0.55 + steepness * 0.9));
        const r = hash2(wx * 3 + 11, wz * 7 + 5);
        if (r > tearing * 0.34) continue;

        const r2 = hash2(wx * 13 + 3, wz * 5 + 29);
        const r3 = hash2(wx * 17 + 7, wz * 11 + 41);
        const r4 = hash2(wx * 23 + 19, wz * 3 + 61);

        // Across the flow, with a little scatter. A crevasse field is
        // organised, not parallel.
        const along = Math.atan2(fx, fz) + Math.PI / 2 + (r2 - 0.5) * 0.55;
        const len = 26 + r3 * 74 + steepness * 40;
        const width = 1.1 + r4 * 5.5 + steepness * 4.2;
        // Crevasses on the Khumbu reach forty metres and more. Only the top
        // few are ever visible, but the depth is what the fall is measured
        // against, so it should be the real number.
        const depth = 25 + r2 * 38 + steepness * 30;

        /* Bridge strength. Fresh snow builds bridges over everything, which
           is why a heavy snowfall makes the Icefall look easier and is the
           single most dangerous thing that can happen to it. A wide crevasse
           does not bridge as readily as a narrow one. */
        const bridged = Math.max(0, Math.min(1,
          freshSnow * 1.5 * (1 - (width - 1) / 12) + (r3 - 0.5) * 0.35));

        segs.push({
          x: wx, z: wz, angle: along, len, width, depth,
          bridged, probed: false, collapsed: false,
          id: `${wx}_${wz}`,
        });
      }
    }
    this.segments = segs;

    /* Ladders where the route crosses. The Icefall Doctors have been through
       here already; the player is not the first person up this season. */
    this.ladders = [];
    for (const seg of segs) {
      const near = this.routeDistance(seg.x, seg.z);
      if (near > 22) continue;
      if (seg.width < 1.6 || seg.width > 11) continue;
      seg.hasLadder = true;
      seg.bridged = 1;                     // a ladder is as good as a bridge
      this.ladders.push(seg);
    }
  }

  /** Distance from a point to the fixed route polyline, in metres. */
  routeDistance(x, z) {
    let best = 1e9;
    for (let i = 1; i < this.routePath.length; i++) {
      const a = this.routePath[i - 1], b = this.routePath[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
      if (d < best) best = d;
    }
    return best;
  }

  paintMask(cx, cz) {
    const c = this.ctx, S = MASK_PX / MASK_M;
    c.clearRect(0, 0, MASK_PX, MASK_PX);
    c.fillStyle = "#000";
    c.fillRect(0, 0, MASK_PX, MASK_PX);

    const toPx = (wx, wz) => [(wx - (cx - MASK_M / 2)) * S, (wz - (cz - MASK_M / 2)) * S];

    /* Three passes. Two green — a wide faint one and a narrow strong one,
       added together — give the ground around a slot the darkening it
       actually has: a broad occlusion where the sky is half blocked, and a
       hard band right on the lip. One uniform-width pass reads as a drawn
       outline, which is most of why the first version looked like a line
       painted on the snow rather than a hole in it. Red last, and opaque:
       that is the hole, and nothing may soften its edge. */
    c.lineCap = "round";
    const passes = [
      { ch: "#0f0", extra: 6.5, alpha: 0.26, comp: "lighter" },
      { ch: "#0f0", extra: 2.2, alpha: 0.55, comp: "lighter" },
      { ch: "#f00", extra: 0, alpha: 1, comp: "source-over" },
    ];
    for (const p of passes) {
      c.globalCompositeOperation = p.comp;
      for (const seg of this.segments) {
        const open = seg.bridged <= OPEN || seg.collapsed;
        if (!open && p.ch === "#f00") continue;
        // A bridged crevasse still sags: the ground over one is dished, so
        // the occlusion is drawn for it too, at half strength. It is the
        // only visual tell there is, and it is a fair one.
        const hx = Math.sin(seg.angle) * seg.len / 2;
        const hz = Math.cos(seg.angle) * seg.len / 2;
        const [x1, y1] = toPx(seg.x - hx, seg.z - hz);
        const [x2, y2] = toPx(seg.x + hx, seg.z + hz);
        c.strokeStyle = p.ch;
        c.lineWidth = Math.max(1, (seg.width + p.extra) * S);
        c.globalAlpha = p.alpha * (open ? 1 : 0.35);
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      }
    }
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    this.texture.needsUpdate = true;
    this.bounds.set(cx - MASK_M / 2, cz - MASK_M / 2, MASK_M, MASK_M);
  }

  /**
   * The insides.
   *
   * A crevasse is a cliff you cannot see over, and the first version drew it
   * as two flat panels with a linear gradient — which from any distance is a
   * blue line painted on the snow. Four things fix that, and they are all
   * about depth rather than about colour:
   *
   *  - **Rows, not a single quad.** Six of them, bunched toward the top,
   *    because the first six metres are all you can actually see into and
   *    that is where the shape has to be.
   *  - **The walls converge.** Ice pulls apart at the surface and is still
   *    in contact below; a slot that stays the same width all the way down
   *    reads as a trench dug with a spade.
   *  - **Light falls off exponentially**, not linearly. Two metres down a
   *    slot is already dim and at ten it is black — a straight ramp to black
   *    makes the whole wall a mid-blue, which is the "blue line" look.
   *  - **The lip is not straight.** A hash-jittered edge, and a slight
   *    undercut just below it, so the top reads as broken ice rather than as
   *    a cut in paper.
   */
  buildTrench() {
    if (this.trench) {
      this.group.remove(this.trench);
      this.trench.geometry.dispose();
    }
    const pos = [], col = [], idx = [];
    const f = this.field;
    const SPANS = 7, ROWS = 6;

    /* Depth of each row as a fraction of the whole, and how bright it is.
       Rows crowd the top; radiance is e^-3.4·d, so row 1 is already at a
       third and the bottom is effectively black. */
    const rowT = [], rowLight = [], rowWidth = [];
    for (let k = 0; k <= ROWS; k++) {
      const u = k / ROWS;
      const t = Math.pow(u, 2.1);                 // bunched near the surface
      rowT.push(t);
      rowLight.push(1 - u * 0.35);              // scaled by depth below, per segment
      // Slight undercut immediately below the lip, then a steady squeeze.
      rowWidth.push(k === 1 ? 1.10 : 1.0 - 0.86 * Math.pow(u, 0.85));
    }

    for (const seg of this.segments) {
      if (seg.bridged > OPEN && !seg.collapsed) continue;
      const ux = Math.sin(seg.angle), uz = Math.cos(seg.angle);     // along
      const px = Math.cos(seg.angle), pz = -Math.sin(seg.angle);    // across
      const hw = seg.width / 2;
      const base0 = pos.length / 3;
      /** How far light reaches down this particular slot, in metres. */
      const lightScale = 0.85 * seg.width + 1.4;

      for (let s = 0; s <= SPANS; s++) {
        const t = s / SPANS - 0.5;
        const ax = seg.x + ux * seg.len * t, az = seg.z + uz * seg.len * t;
        // Narrow to nothing at the ends, or a crevasse is a rectangular pit.
        const taper = Math.sqrt(Math.max(0, 1 - (t * 2) ** 2 * 0.92));
        const depth = seg.depth * (0.32 + 0.68 * taper);

        for (const side of [-1, 1]) {
          // A broken edge, deterministic per metre of ground.
          const jitter = (hash2(Math.round(ax * 2) + side * 7, Math.round(az * 2)) - 0.5);
          const w0 = hw * taper * (1 + jitter * 0.34);
          const lipY = f.height(ax + px * w0 * side, az + pz * w0 * side) - 0.10;
          for (let k = 0; k <= ROWS; k++) {
            const w = w0 * rowWidth[k];
            const below = depth * rowT[k];              // metres under the lip
            pos.push(ax + px * w * side, lipY - below, az + pz * w * side);

            /* Radiance, not albedo — the material is unlit, see below.
               Glacier ice is blue because the air has been squeezed out of
               it and what is left absorbs red, so the tint gets *bluer* as
               it darkens rather than simply greyer.

               **The falloff is over METRES, not over a fraction of the
               depth.** That distinction is the whole difference between a
               crevasse and a blue stripe: an eighty-metre slot with a
               fraction-based ramp is still two-thirds lit over the top
               twenty metres, which is the only part you can see, so the
               visible wall comes out a flat mid-blue. Light actually gets
               into a slot to a distance set by how wide it is — a narrow one
               is black almost immediately, a wide one holds its colour for
               a few metres — so that is what the scale length is. */
            const L = LIP_RADIANCE * rowLight[k] * Math.exp(-below / lightScale);
            col.push(L * 0.34, L * 0.62, L * 1.00);
          }
        }
      }

      /* Index. Vertices per span: 2 sides × (ROWS+1) rows, side −1 first. */
      const perSpan = 2 * (ROWS + 1);
      for (let s = 0; s < SPANS; s++) {
        for (let side = 0; side < 2; side++) {
          const a0 = base0 + s * perSpan + side * (ROWS + 1);
          const b0 = base0 + (s + 1) * perSpan + side * (ROWS + 1);
          for (let k = 0; k < ROWS; k++) {
            const a = a0 + k, b = b0 + k;
            if (side === 0) idx.push(a, a + 1, b, b, a + 1, b + 1);
            else idx.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
        // Floor: join the two walls at the deepest row. It is black, and it
        // exists only so there is no hole through the world.
        const aL = base0 + s * perSpan + ROWS;
        const aR = aL + (ROWS + 1);
        const bL = base0 + (s + 1) * perSpan + ROWS;
        const bR = bL + (ROWS + 1);
        idx.push(aL, aR, bL, bL, aR, bR);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    /* Unlit, with the vertex colours standing for how much sky each depth can
       see — because that is genuinely what decides the colour inside a
       crevasse. A lit material cannot express it: the far wall of a slot
       faces the sky as squarely as the open glacier does, so any diffuse
       shading model paints it just as bright, and forty-metre slots came out
       as pale ribbons lying on top of the snow. The overall level is scaled
       by the sky each frame (see `tintTo`) so it still darkens at dusk. */
    this.trench = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide,
    }));
    this.trench.name = "crevasse-walls";
    this.trench.renderOrder = 1;
    this.group.add(this.trench);
  }

  /** Seracs: the blocks the Icefall is made of, and the reason nobody stops
   *  in it. Only in the steep ice, only a few, and each one can come down. */
  buildSeracs() {
    this.seracGroup.clear();
    this.seracs = [];
    const f = this.field;
    const half = MASK_M / 2 - 60;
    const cx = this.centre.x, cz = this.centre.z;
    /* Ice, not stone. The emissive is standing in for the light that gets
       into a block of glacier ice and comes back out of it — without it a
       serac in its own shadow renders black, and a field of black cubes on a
       white glacier looks like a bug rather than like the Icefall. */
    const mat = new THREE.MeshLambertMaterial({
      color: 0xd2e2ee, emissive: 0x24384a, emissiveIntensity: 1,
    });

    /* A serac is a fractured block, not a crate. A dodecahedron at
       subdivision zero is angular in the right way and costs the same as a
       box; scaled unevenly and turned, they read as broken ice where cubes
       read as packing cases. All of them in one instanced draw — the unit
       radius is 1 and the size goes into the scale. */
    const found = [];
    for (let i = 0; i < 90; i++) {
      const r1 = hash2(cx + i * 97, cz + i * 31);
      const r2 = hash2(cx + i * 53, cz + i * 71);
      const r3 = hash2(cx + i * 17, cz + i * 13);
      const wx = cx + (r1 - 0.5) * 2 * half, wz = cz + (r2 - 0.5) * 2 * half;
      const h = f.height(wx, wz), slope = f.slope(wx, wz, 22);
      if (h < 5250 || h > 6150 || slope < 11 || slope > 40) continue;   // the Icefall
      const s = 3 + r3 * 11;
      found.push({ wx, wz, h, s, r1, r2, r3 });
    }
    if (!found.length) return;

    const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat, found.length);
    found.forEach((b, i) => {
      _sd.position.set(b.wx, b.h + b.s * (0.26 + b.r1 * 0.34) - 1.4, b.wz);
      _sd.rotation.set((b.r1 - 0.5) * 0.7, b.r2 * 6.28, (b.r3 - 0.5) * 0.7);
      _sd.scale.set(b.s * 0.62, b.s * 0.62 * (0.75 + b.r1 * 0.95), b.s * 0.62 * (0.72 + b.r2 * 0.6));
      _sd.updateMatrix();
      im.setMatrixAt(i, _sd.matrix);
      this.seracs.push({ x: b.wx, z: b.wz, size: b.s });
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    this.seracGroup.add(im);
  }

  /**
   * What is under a point.
   * @returns null on solid ground, otherwise the crevasse and how it is.
   */
  at(x, z) {
    for (const seg of this.segments) {
      const dx = x - seg.x, dz = z - seg.z;
      const ux = Math.sin(seg.angle), uz = Math.cos(seg.angle);
      const along = dx * ux + dz * uz;
      if (Math.abs(along) > seg.len / 2) continue;
      const across = dx * Math.cos(seg.angle) - dz * Math.sin(seg.angle);
      const t = along / (seg.len / 2);
      const taper = Math.sqrt(Math.max(0, 1 - t * t * 0.92));
      if (Math.abs(across) > seg.width / 2 * taper) continue;
      return seg;
    }
    return null;
  }

  /** The nearest ladder crossing within reach, for the crossing prompt. */
  ladderNear(x, z, radius = 14) {
    let best = null, bd = radius * radius;
    for (const l of this.ladders) {
      const d = (l.x - x) ** 2 + (l.z - z) ** 2;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  /** Scale the trench's baked radiance by however bright the sky is now. */
  tintTo(skyLight) {
    if (this.trench) this.trench.material.color.copy(skyLight).multiplyScalar(1.25);
  }

  bindTerrain(uniforms) {
    uniforms.crevasseMask.value = this.texture;
    uniforms.crevasseBounds.value = this.bounds;
    uniforms.crevasseOn.value = 1;
  }
}
