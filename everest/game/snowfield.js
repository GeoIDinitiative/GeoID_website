/**
 * Snow that remembers, and wind that forgets for it.
 *
 * Everything else in this game draws snow as a static surface: imagery for
 * the colour, a shape-from-shading pass for the metre scale, procedural
 * grain for the decimetre. All of it is fixed. Real snow is the opposite —
 * it is the most *worked* surface on the mountain. It records every boot
 * that crosses it, and then the wind takes the record away again, and the
 * balance between those two is what a glacier surface looks like at any
 * given hour.
 *
 * So this is a live field, 0.25 m per pixel over a 256 m square that follows
 * the player:
 *
 *   R  disturbance   — trodden, broken, darker, and it scatters light badly
 *   G  drift         — where wind-blown snow has piled: brighter, smoother
 *   B  wind ripple   — advected sastrugi phase, so the surface pattern moves
 *
 * The terrain shader samples all three for both the normal and the albedo.
 *
 * ── Why a canvas and not a render target ─────────────────────────────────
 * Because the operations are a stamp, a fade and a translation, and a 2D
 * context does all three in one call each. A ping-pong render target would
 * be two framebuffers, two triangles and a shader to do a blur that
 * `filter: blur()` already does — and this runs at most a few times a second,
 * not per frame.
 *
 * ── Why it scrolls rather than re-centring ───────────────────────────────
 * The field has to keep what it recorded when the player walks. Redrawing it
 * about a new centre would need every footprint remembered separately; a
 * `drawImage` of the canvas onto itself at an offset moves the whole history
 * for the cost of one blit, and only the newly exposed strip is blank.
 */

import * as THREE from "../vendor/three.module.js?v=27e13eb-b3f75c4d";

/**
 * 1024 px over 48 m — **4.7 cm per pixel**.
 *
 * The first attempt was 0.25 m/px over 256 m, which sounds generous and is
 * useless: a boot is 23 cm across, so a footprint came out ONE PIXEL. 128
 * strides produced 128 disturbed pixels and nothing was visible at all. The
 * resolution has to be set by the smallest thing being recorded, and then the
 * extent is whatever that leaves — 48 m here, which is about right anyway
 * since the shader stops drawing surface detail at 46 m.
 *
 * The size also has to be affordable to upload: `needsUpdate` re-sends the
 * whole canvas, so 1024² is 4 MB a time and 2048² would be four times that
 * several times a second.
 */
const PX = 1024;
const METRES = 48;
const S = PX / METRES;              // ≈ 21.3 px per metre
/** Scroll only when the window is this far out, in pixels. Re-blitting a
 *  megapixel canvas onto itself every 5 cm of walking is not free, and a
 *  three-quarter-metre lag on a 48 m window is not visible. */
const SCROLL_AT = 16;

export class SnowField {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = PX;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    this.seed();
    // An untouched copy of the resting surface, for `update` to settle toward.
    this.rest = document.createElement("canvas");
    this.rest.width = this.rest.height = PX;
    this.rest.getContext("2d").drawImage(this.canvas, 0, 0);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;

    /** (minX, minZ, width, height) in local metres. */
    this.bounds = new THREE.Vector4(-METRES / 2, -METRES / 2, METRES, METRES);
    this.centre = { x: 0, z: 0 };
    this.lastStamp = { x: 1e9, z: 1e9 };
    this.stride = 0;
    this.accum = 0;
    this.dirty = true;
  }

  /**
   * Lay down a resting wind-worked surface.
   *
   * This canvas used to start black and stay black — measured at
   * nonZeroFraction 0.000 across all 1024x1024, every channel. The terrain
   * shader multiplies its sastrugi and grain by this texture, so every
   * surface-detail dial was multiplying by zero, and switching all three on
   * changed the foreground by a factor of exactly 1.00 under three separate
   * attempted fixes.
   *
   * Two reasons, both addressed. R was only written by footprints and G only
   * accumulated above 9 m/s of wind, so calm air wrote nothing; and `update`
   * faded with destination-out, which erases ALPHA, so anything seeded was
   * wiped within seconds. Now the field starts as worked snow and the fade
   * settles back toward it rather than toward nothing.
   *
   * Real snow is never featureless: sastrugi are cut across the prevailing
   * wind, so the noise is stretched 4:1 to match.
   */
  seed() {
    const c = this.ctx;
    c.globalCompositeOperation = "source-over";
    c.fillStyle = "#000";
    c.fillRect(0, 0, PX, PX);
    const img = c.getImageData(0, 0, PX, PX);
    const d = img.data;
    const hash = (x, y) => {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return n - Math.floor(n);
    };
    const val = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v)
           + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v;
    };
    for (let y = 0; y < PX; y++) {
      for (let x = 0; x < PX; x++) {
        const sx = x / 24, sy = y / 6;              // 4:1, ripples across the wind
        const n = val(sx, sy) * 0.62 + val(sx * 2.4, sy * 2.4) * 0.26;
        const o = (y * PX + x) * 4;
        d[o]     = Math.min(255, n * 104);          // R: surface disturbance
        d[o + 1] = Math.min(255, val(x / 85, y / 85) * 80);   // G: broad drift
        d[o + 2] = 0;
        d[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    this.dirty = true;
  }

  /** Move the window with the player, keeping everything already recorded. */
  recentre(x, z) {
    const dx = Math.round((x - this.centre.x) * S);
    const dz = Math.round((z - this.centre.z) * S);
    if (Math.abs(dx) < SCROLL_AT && Math.abs(dz) < SCROLL_AT) return;
    const c = this.ctx;
    // Blit the canvas onto itself, offset. `globalCompositeOperation` has to
    // be "copy" or the old content shows through the shifted copy as a ghost.
    c.globalCompositeOperation = "copy";
    c.drawImage(this.canvas, -dx, -dz);
    c.globalCompositeOperation = "source-over";
    // The strip that has just come into view has no history; black it out or
    // it repeats the far edge, which reads as a wall of old footprints.
    c.fillStyle = "#000";
    if (dx > 0) c.fillRect(PX - dx, 0, dx, PX);
    else if (dx < 0) c.fillRect(0, 0, -dx, PX);
    if (dz > 0) c.fillRect(0, PX - dz, PX, dz);
    else if (dz < 0) c.fillRect(0, 0, PX, -dz);

    this.centre = { x: this.centre.x + dx / S, z: this.centre.z + dz / S };
    this.bounds.set(this.centre.x - METRES / 2, this.centre.z - METRES / 2, METRES, METRES);
    this.dirty = true;
  }

  toPx(x, z) {
    return [(x - (this.centre.x - METRES / 2)) * S, (z - (this.centre.z - METRES / 2)) * S];
  }

  /**
   * A boot goes in. Two marks, side by side, at the stride the player is
   * actually walking — a single blob down the middle reads as a bulldozer.
   */
  step(x, z, yaw, depth) {
    const c = this.ctx;
    const across = 0.16;                        // half the gap between boots
    const side = (this.stride & 1) ? 1 : -1;
    const ox = Math.cos(yaw) * across * side;
    const oz = -Math.sin(yaw) * across * side;
    const [px, py] = this.toPx(x + ox, z + oz);

    c.save();
    c.translate(px, py);
    c.rotate(-yaw);
    // Disturbance in red; a little drift in green at the rim, because a boot
    // pushes snow up as well as down.
    const a = Math.min(1, depth);
    // The hollow.
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 0.19 * S);
    g.addColorStop(0, `rgba(255,0,0,${0.88 * a})`);
    g.addColorStop(0.60, `rgba(220,0,0,${0.62 * a})`);
    g.addColorStop(1, "rgba(120,0,0,0)");
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(0, 0, 0.115 * S, 0.185 * S, 0, 0, Math.PI * 2);
    c.fill();
    // The rim: a boot pushes snow up as well as down, and the little ridge
    // round a print is most of what makes it read as a dent.
    c.strokeStyle = `rgba(0,255,0,${0.32 * a})`;
    c.lineWidth = Math.max(1, 0.035 * S);
    c.beginPath();
    c.ellipse(0, 0, 0.135 * S, 0.205 * S, 0, 0, Math.PI * 2);
    c.stroke();
    c.restore();
    this.dirty = true;
  }

  /**
   * @param dtSim  simulated seconds — filling in is a weather process
   * @param wind   m/s at the player
   * @param snowFall 0..1
   */
  update(player, dtReal, dtSim, wind, snowFall, windDir) {
    this.recentre(player.pos.x, player.pos.z);

    // Footprints, at the stride the player is walking.
    if (player.speed > 0.15 && player.onGroundish !== false) {
      const d = Math.hypot(player.pos.x - this.lastStamp.x, player.pos.z - this.lastStamp.z);
      if (d > 0.62) {
        this.lastStamp = { x: player.pos.x, z: player.pos.z };
        this.stride++;
        // How deep the print is: soft new snow takes a boot, wind-hammered
        // old snow barely marks, and blue ice does not mark at all.
        this.step(player.pos.x, player.pos.z, player.yaw, 0.35 + 0.65 * snowFall);
      }
    }

    /* ── Wind fills it in ──
       A trail lasts hours in still air and minutes in a gale. Rather than
       decay each pixel, the whole field is faded toward drift: the red
       (disturbance) is knocked back and a little green (drift) is laid over
       everything, which is what actually happens — the wind does not erase a
       footprint, it fills it with new snow. */
    this.accum += dtSim;
    const period = 12;                     // simulated seconds between passes
    if (this.accum >= period) {
      const passes = Math.min(6, Math.floor(this.accum / period));
      this.accum -= passes * period;
      const fillRate = Math.min(0.5, (0.006 + Math.max(0, wind - 4) * 0.0045
                                      + snowFall * 0.010) * passes);
      const c = this.ctx;
      /* Settle toward the resting surface rather than erasing to nothing.
         destination-out reduces alpha, so the old version drove the whole
         field to zero and took every sub-metre detail with it. */
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = Math.min(0.5, fillRate);
      c.drawImage(this.rest, 0, 0);
      c.globalAlpha = 1;
      // Drift laid down across the whole field, biased by how hard it blows.
      if (wind > 9) {
        c.fillStyle = `rgba(0,255,0,${Math.min(0.05, (wind - 9) * 0.0016 * passes)})`;
        c.fillRect(0, 0, PX, PX);
      }
      this.dirty = true;
    }

    if (this.dirty) { this.texture.needsUpdate = true; this.dirty = false; }
  }

  bind(uniforms) {
    uniforms.snowField.value = this.texture;
    uniforms.snowFieldBounds.value = this.bounds;
  }
}
