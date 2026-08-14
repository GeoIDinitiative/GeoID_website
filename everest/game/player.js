/**
 * The climber, and the camera that watches them.
 *
 * Movement is Tobler's hiking function — the empirical relation between
 * ground slope and walking speed that every piece of terrain analysis uses,
 * and it is why the route in this game goes where it goes: the least-cost
 * line up a mountain is a real thing you can compute, and it lands on the
 * South Col route. Above about 38° walking stops and front-pointing starts,
 * which is a third of the speed and several times the effort.
 *
 * Everything the body is doing arrives here as one multiplier from
 * `Survival.capability`, so there is exactly one place where being cold,
 * hypoxic, exhausted and frostbitten turns into being slow.
 */

import * as THREE from "../vendor/three.module.js?v=7967fec-a4d57da1";
import { MOVE, TIME_SCALE, OPEN } from "./config.js?v=7967fec-a4d57da1";

const D2R = Math.PI / 180;

export const STATE = {
  WALKING: "walking",
  FALLING: "falling",     // through a snow bridge
  HANGING: "hanging",     // on the rope, in the slot
  CLIMBING_OUT: "out",
  DEAD: "dead",
  RESTING: "resting",
};

export class Player {
  constructor(field, glacier, survival) {
    this.field = field;
    this.glacier = glacier;
    this.survival = survival;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.state = STATE.WALKING;

    this.thirdPerson = false;
    this.camDist = 4.6;
    this.speed = 0;
    this.stride = 0;          // walk-cycle phase
    this.breath = 0;
    this.stumble = 0;

    this.fallDepth = 0;
    this.hangTime = 0;
    this.prusik = 0;          // 0..1 progress climbing back out
    this.lastCrevasse = null;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.35, 120000);
    this.avatar = buildClimber();
    this.avatar.visible = false;
    /* The body's own heading, distinct from the camera's. It slews toward
       the direction of travel rather than snapping, so a quarter-turn is a
       visible pivot instead of a teleport between the four cardinal poses —
       which is what facing the camera yaw directly used to look like when
       every strafe held the body rigidly forward. */
    this.bodyYaw = 0;
    this.moveDir = { x: 0, z: -1 };

    this.input = { f: 0, r: 0, run: false, crouch: false };
    this.events = [];
  }

  emit(type, data) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  placeAt(x, z, yaw = 0) {
    this.pos.set(x, this.field.height(x, z), z);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.state = STATE.WALKING;
  }

  get altitude() { return this.pos.y; }

  /** Ground slope in the direction being walked, as a signed grade. Uphill
   *  positive. Tobler's function needs the *directional* grade, not the
   *  terrain's steepest slope — traversing a 45° face on a level line is a
   *  completely different proposition from climbing straight up it. */
  gradeAlong(dirX, dirZ) {
    const d = 3.0;
    const h0 = this.field.height(this.pos.x, this.pos.z);
    const h1 = this.field.height(this.pos.x + dirX * d, this.pos.z + dirZ * d);
    return (h1 - h0) / d;
  }

  /** Tobler, normalised so flat ground is 1. The +0.05 offset is his: the
   *  fastest walking is very slightly downhill, not level. */
  static tobler(grade) {
    return Math.exp(-3.5 * Math.abs(grade + 0.05)) / Math.exp(-3.5 * 0.05);
  }

  update(dt, ctx) {
    const surv = this.survival;
    if (surv.dead && this.state !== STATE.DEAD) {
      this.state = STATE.DEAD;
      this.emit("died", { cause: surv.causeOfDeath });
    }
    switch (this.state) {
      case STATE.FALLING: return this.updateFalling(dt);
      case STATE.HANGING: return this.updateHanging(dt, ctx);
      case STATE.CLIMBING_OUT: return this.updateClimbOut(dt);
      case STATE.DEAD: this.speed = 0; return this.updateCamera(dt, ctx);
      default: return this.updateWalking(dt, ctx);
    }
  }

  updateWalking(dt, ctx) {
    const surv = this.survival;
    const cap = surv.capability(this.pos.y);

    // Where we are trying to go, in world XZ.
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    let dx = this.input.r * cosY + this.input.f * sinY;
    let dz = this.input.r * sinY - this.input.f * cosY;
    const mag = Math.hypot(dx, dz);
    if (mag > 1e-4) { dx /= mag; dz /= mag; } else { dx = dz = 0; }

    const wantMove = mag > 1e-4 && !this.input.crouch;
    // The direction of travel, kept for the avatar: the BODY faces where the
    // legs are going, not where the eyes are looking.
    if (wantMove) { this.moveDir.x = dx; this.moveDir.z = dz; }
    const slopeHere = this.field.slope(this.pos.x, this.pos.z, 6);
    const grade = wantMove ? this.gradeAlong(dx, dz) : 0;

    /* Movement is free by request: altitude, oxygen, exhaustion and snow no
       longer throttle the legs. What they WOULD have cost is computed below
       and published to the instrument panel as Resistance — the simulation
       records the environment instead of enforcing it. Terrain itself still
       shapes pace (grade via Tobler, cliffs still unclimbable) because that
       is geometry, not fatigue. */
    let v = 0;
    if (wantMove) {
      /* Grade shapes pace but never stops it: Tobler's function falls to a
         few percent on summit-ridge grades and the old hard gate zeroed it
         outright, which on a mountain that steep meant standing still at the
         top — the second way the summit refused to let you walk. Floored at
         0.6 the steepness still reads underfoot, and full speed is always
         within reach on reasonable ground. */
      v = MOVE.walk * Math.max(0.6, Player.tobler(grade));
      if (this.input.run) v *= 1.42;
    }

    /* Wind. Above about 20 m/s you are being pushed, and at 30 you are being
       knocked over — which is the actual mechanism by which summit-day winds
       stop people, rather than the cold. */
    const wind = ctx.windMs;
    const wv = ctx.windDir;
    /* The push is clamped to a fraction of the player's own speed. At the
       summit the jet stream reaches ~50 m/s, which made the raw push
       (1.2 m/s) larger than the walk authority at altitude (0.86 m/s) — the
       wind's vector was simply bigger than yours, so you walked wherever it
       pointed: aiming north measured as travelling east. Wind now costs you
       up to 45% of your pace as drift, but the heading is always yours, and
       standing still nothing drags you. */
    const pushRaw = Math.max(0, wind - 14) * 0.035;
    /* Recorded, not applied. The would-be drift fraction of your pace plus
       the body's condition deficit, published for the Resist reader. */
    const windCost = Math.min(0.45, pushRaw / MOVE.walk);
    this.resistance = Math.min(1, (1 - cap) + windCost * cap);
    let vx = dx * v;
    let vz = dz * v;
    void wv;

    /* The wind knockdown is gone by request. Gusts used to roll a chance of
       throwing the player off their feet above 24 m/s; the steady lean-into-
       it push above stays, because being slowed by wind is walking, being
       randomly floored by it was a dice roll. Only exhaustion staggers now. */
    if (surv.distress(this.pos.y) > 0.72 && Math.random() < 0.10 * dt) this.stumble = 0.6;
    if (this.stumble > 0) {
      this.stumble = Math.max(0, this.stumble - dt * 1.4);
      const s = this.stumble;
      // Camera sway only — the positional shove made exhaustion feel like
      // losing the controls rather than losing strength.
      vx += Math.sin(performance.now() * 0.011) * s * 0.25;
      vz += Math.cos(performance.now() * 0.013) * s * 0.25;
    }

    /* Standing over nothing. The glacier guards against opening a hole under
       a stationary player, but a flare lift or a load can put someone over an
       open slot — and if the terrain there has been discarded, the only
       honest thing is for them to be in it. */
    if (!(this.safeUntil && performance.now() < this.safeUntil)) {
      const here = this.glacier.at(this.pos.x, this.pos.z);
      if (here && (here.collapsed || here.bridged < 0.08)) {
        this.beginFall(here, this.pos.x, this.pos.z);
        return;
      }
    }

    const nx = this.pos.x + vx * dt;
    const nz = this.pos.z + vz * dt;

    /* ── The hole ──
       Checked on the new position, before committing to it, so that stepping
       onto a bridge is what triggers it rather than standing on one. */
    /* One roll per crossing, made on the step that puts a foot on the bridge
       — not one per frame.
       Per-frame was the first version and it is not a difficulty setting, it
       is a unit error: at 0.62−holds ≈ 0.4 it worked out at a 36% chance
       every single frame, so any weak bridge collapsed instantly and a
       hundred and fifty metres of the Icefall produced three falls. A bridge
       either takes your weight or it does not, and you find out in the first
       second.

       Surviving one marks it as holding. Re-crossing ground you have already
       crossed is how the route works — the fixed line goes over the same
       bridges all season — and re-rolling every time would make retracing
       your steps more dangerous than breaking new ground. */
    const seg = this.glacier.at(nx, nz);
    if (seg && !seg.collapsed && seg !== this.onSeg) {
      const onLadder = seg.hasLadder && this.nearLadderLine(seg, nx, nz);
      if (!onLadder && !seg.held) {
        if (seg.bridged <= OPEN) {
          /* Open. The terrain shader has cut a hole here and you can see it
             from a hundred metres — walking into it is not bad luck, and
             rolling dice for it would be pretending otherwise. */
          this.beginFall(seg, nx, nz);
          return;
        }
        /* Bridged, and therefore indistinguishable from the snow either side
           of it. THIS is the one that gets people, so this is the one with a
           probability on it: strength against what you are carrying, one roll
           on the step that commits your weight. Probe first (SPACE) or be
           tied in — those are the two answers, and they are the real ones. */
        const load = 1 + surv.carriedWeight / 55;
        const holds = seg.bridged / load;
        const p = Math.max(0, Math.min(0.85, (0.66 - holds) * 1.25));
        if (Math.random() < p) {
          seg.collapsed = true;
          this.beginFall(seg, nx, nz);
          return;
        }
        seg.held = true;                 // it took your weight once
      }
    }
    this.onSeg = seg;

    this.pos.x = nx; this.pos.z = nz;
    this.speed = Math.hypot(vx, vz);
    this.stride += this.speed * dt * 1.65;

    /* Ground contact with gravity, not glue.
       The old line lerped pos.y toward the ground at dt*18 in BOTH
       directions — up over kerbs, but also DOWN any cliff, so a cornice
       could never be fallen off: the surface dragged you down its face at
       walking speed. (A first attempt at this fix was verified "working"
       while actually sitting in updateClimbOut — the crevasse exit — because
       the same assignment text appears there. The trace that exposed it:
       height above ground going straight to zero in one tick, which gravity
       cannot do.)
       Now: rising ground still snaps you up; when the ground falls away
       more than half a metre, the body detaches and accelerates down, and
       landings past a survivable impact speed cost health. */
    const g = this.field.height(this.pos.x, this.pos.z);
    /* The step-up tolerance must not apply mid-flight: at 15 m/s a fall
       covers 0.25 m per frame, so its final frame is always within the half
       metre — and the gentle-lerp branch was catching every landing before
       the impact accounting could run. Falls dealt no damage. Airborne stays
       ballistic until the ground is actually met. */
    if (!this.airborne && g >= this.pos.y - 0.5) {
      this.pos.y += (g - this.pos.y) * Math.min(1, dt * 18);
      this.vy = 0;
    } else {
      this.airborne = true;
      this.vy = (this.vy || 0) - 9.81 * dt;
      this.pos.y = Math.max(g, this.pos.y + this.vy * dt);
      if (this.pos.y === g) {
        const impact = -this.vy;
        this.vy = 0;
        this.airborne = false;
        if (impact > 8) {
          const dmg = Math.min(70, (impact - 8) * 6);
          this.survival.health = Math.max(0, this.survival.health - dmg);
          this.stumble = 0.9;
          this.emit("hardLanding", { impact: Math.round(impact), dmg: Math.round(dmg) });
        }
      }
    }

    this.updateCamera(dt, ctx);
  }

  nearLadderLine(seg, x, z) {
    const ux = Math.sin(seg.angle), uz = Math.cos(seg.angle);
    const dx = x - seg.x, dz = z - seg.z;
    const across = dx * Math.cos(seg.angle) - dz * Math.sin(seg.angle);
    const along = dx * ux + dz * uz;
    return Math.abs(along) < 3.0 && Math.abs(across) < seg.width / 2 + 1.4;
  }

  beginFall(seg, x, z) {
    /* Work out which lip to come back up onto BEFORE going in, because
       afterwards there is no record of which side was solid.
       Getting this wrong is not cosmetic: the first version stepped 3.5 m
       "backwards" along the current heading, which for a six-metre slot
       leaves you still over the hole — and since the hole is now collapsed,
       the standing-over-nothing check drops you straight back into it. That
       is an infinite loop, and it showed up as a forty-minute test session
       that covered 146 metres and spent 3,800 frames in a crevasse. */
    const acrossX = Math.cos(seg.angle), acrossZ = -Math.sin(seg.angle);
    const side = ((this.pos.x - seg.x) * acrossX + (this.pos.z - seg.z) * acrossZ) >= 0 ? 1 : -1;
    const clear = seg.width / 2 + 2.6;
    this.exitTo = {
      x: seg.x + acrossX * side * clear + Math.sin(seg.angle) * ((this.pos.x - seg.x) * Math.sin(seg.angle) + (this.pos.z - seg.z) * Math.cos(seg.angle)),
      z: seg.z + acrossZ * side * clear + Math.cos(seg.angle) * ((this.pos.x - seg.x) * Math.sin(seg.angle) + (this.pos.z - seg.z) * Math.cos(seg.angle)),
    };

    this.lastCrevasse = seg;
    this.state = STATE.FALLING;
    this.fallDepth = 0;
    this.vel.set(0, 0, 0);
    this.pos.x = x; this.pos.z = z;
    this.lipY = this.field.height(x, z);
    this.emit("bridgeCollapse", { seg, roped: this.survival.roped });
  }

  updateFalling(dt) {
    this.vel.y -= MOVE.gravity * dt;
    this.pos.y += this.vel.y * dt;
    this.fallDepth = this.lipY - this.pos.y;

    const seg = this.lastCrevasse;
    // The rope comes tight after the slack runs out — a few metres, and then
    // it is a hard stop, which is what a fall factor means.
    const arrestAt = 4.5 + Math.random() * 3.5;
    if (this.survival.roped && this.fallDepth > arrestAt) {
      this.state = STATE.HANGING;
      this.hangTime = 0;
      this.prusik = 0;
      this.vel.y = 0;
      this.survival.health -= 6;
      this.emit("ropeArrest", { depth: this.fallDepth });
      return;
    }
    if (this.fallDepth > seg.depth * 0.92) {
      // The bottom. A crevasse narrows as it goes down, so you usually stop
      // wedged rather than flat — which is worse.
      this.pos.y = this.lipY - seg.depth * 0.92;
      const impact = Math.min(1, this.fallDepth / 32);
      this.survival.health -= 30 + impact * 80;
      this.survival.warmth -= 25;
      this.emit("crevasseBottom", { depth: this.fallDepth, roped: false });
      if (this.survival.health <= 0) {
        this.survival.dead = true;
        this.survival.causeOfDeath = "a crevasse";
        this.state = STATE.DEAD;
      } else {
        this.state = STATE.HANGING;
        this.hangTime = 0;
        this.prusik = 0;
      }
    }
  }

  updateHanging(dt, ctx) {
    this.hangTime += dt;
    this.speed = 0;
    /* `dt` here is REAL seconds — everything in Player takes real time,
       because it is all animation and input response. The body's rates are
       written per simulated hour, so they have to be converted, and getting
       that wrong is silent: the first version divided real seconds by 3600
       and the climber hung in the slot losing warmth eight times too slowly
       while the prusik took two minutes of held key instead of fifteen
       seconds. */
    const h = dt * TIME_SCALE / 3600;
    this.survival.warmth -= h * 62;
    this.survival.energy -= h * 20;
    if (this.prusikInput) {
      // Fifteen seconds of holding the key, standing in for the half hour it
      // really takes to prusik out of a slot. Real seconds: this one is a
      // test of the player's patience, not of the climber's day.
      this.prusik = Math.min(1, this.prusik + dt * (1 / 15) * this.survival.capability(this.pos.y));
      this.survival.energy -= h * 90;
      this.pos.y = this.lipY - (1 - this.prusik) * this.fallDepth;
      if (this.prusik >= 1) {
        this.state = STATE.CLIMBING_OUT;
        this.climbOut = 0;
      }
    }
    this.updateCamera(dt, ctx);
  }

  updateClimbOut(dt) {
    this.climbOut += dt;
    // Onto the lip you came from, and a clear two and a half metres back
    // from the edge — the edge is what broke.
    const t = Math.min(1, this.climbOut / 1.6);
    const e = this.exitTo;
    if (e) {
      this.pos.x += (e.x - this.pos.x) * Math.min(1, dt * 4);
      this.pos.z += (e.z - this.pos.z) * Math.min(1, dt * 4);
    }
    this.pos.y = this.field.height(this.pos.x, this.pos.z);
    if (t >= 1) {
      if (e) { this.pos.x = e.x; this.pos.z = e.z; this.pos.y = this.field.height(e.x, e.z); }
      this.state = STATE.WALKING;
      // A moment of grace, so a slot that is still under the boot on the
      // frame the state flips does not immediately re-trigger.
      this.safeUntil = performance.now() + 900;
      this.emit("climbedOut", {});
    }
  }

  updateCamera(dt, ctx) {
    const surv = this.survival;
    const distress = surv.distress(this.pos.y);

    /* Breathing. At altitude it is the loudest thing in the world and it sets
       the pace of everything — so the camera moves with it, harder the worse
       you are doing. Two or three steps, then a breath. */
    const rate = 0.55 + distress * 1.15 + this.speed * 0.35;
    this.breath += dt * rate;
    const breathe = Math.sin(this.breath * Math.PI * 2);

    /* Camera shake removed by request. The walk bob, the breathing sway and
       the distress roll all animated the camera itself; whatever immersion
       they bought, they cost more in comfort — on a screen a shaking camera
       is the viewer being shaken. The stride/breath phases still advance
       (the avatar's gait and the audio breathe from them); they just no
       longer move the lens. */
    const eye = MOVE.eyeHeight - (this.input.crouch ? 0.55 : 0);
    const bobY = 0;
    const bobX = 0;
    const sway = 0;

    const head = _v1.set(
      this.pos.x + bobX * Math.cos(this.yaw),
      this.pos.y + eye + bobY + sway,
      this.pos.z + bobX * Math.sin(this.yaw),
    );

    const dir = _v2.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );

    if (this.thirdPerson && this.state !== STATE.HANGING) {
      // Behind and slightly above, pulled in if the ground is in the way.
      let d = this.camDist;
      const want = _v3.copy(head).addScaledVector(dir, -d).add(_v4.set(0, 0.85, 0));
      for (let i = 0; i < 6; i++) {
        const g = this.field.height(want.x, want.z) + 1.1;
        if (want.y >= g) break;
        d *= 0.78;
        want.copy(head).addScaledVector(dir, -d).add(_v4.set(0, 0.85, 0));
      }
      this.camera.position.lerp(want, Math.min(1, dt * 12));
      this.camera.lookAt(head.x, head.y + 0.15, head.z);
    } else {
      this.camera.position.copy(head);
      this.camera.lookAt(head.x + dir.x, head.y + dir.y, head.z + dir.z);
      // Roll removed with the rest of the camera shake — a rolling horizon
      // reads as the screen tilting, not the climber.
    }

    this.updateAvatar(dt);
  }

  updateAvatar(dt) {
    const a = this.avatar;
    a.visible = this.thirdPerson && this.state !== STATE.HANGING;
    a.position.set(this.pos.x, this.pos.y, this.pos.z);

    /* Face the direction of travel, arriving there rather than being there.
       Shortest-arc slew at 8 rad/s — quick enough that the body never lags a
       sprint, slow enough that a 180 reads as a person turning round. Idle
       keeps the last heading, so stopping does not swivel anyone. */
    const moving = this.speed > 0.15;
    if (moving) {
      const want = Math.atan2(this.moveDir.x, -this.moveDir.z);
      let d = want - this.bodyYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const step = Math.min(Math.abs(d), 8.0 * dt);
      this.bodyYaw += Math.sign(d) * step;
    }
    a.rotation.y = -this.bodyYaw + Math.PI;

    const s = Math.min(1, this.speed / MOVE.walk);
    const ph = this.stride * Math.PI * 2;
    const p = a.userData.parts;

    /* Two-segment gait. Hips swing; the knee flexes hardest as its leg
       swings through under the body, which is what separates a walk from a
       pair of scissors. Elbows carry a standing bend that deepens on the
       back-swing. */
    const swingL = Math.sin(ph), swingR = -swingL;
    p.hipL.rotation.x = swingL * 0.72 * s;
    p.hipR.rotation.x = swingR * 0.72 * s;
    p.kneeL.rotation.x = Math.max(0, -Math.cos(ph)) * 1.05 * s + 0.06;
    p.kneeR.rotation.x = Math.max(0,  Math.cos(ph)) * 1.05 * s + 0.06;
    p.shoulderL.rotation.x = swingR * 0.5 * s;
    p.shoulderR.rotation.x = swingL * 0.5 * s;
    p.elbowL.rotation.x = -0.28 - Math.max(0, swingR) * 0.35 * s;
    p.elbowR.rotation.x = -0.28 - Math.max(0, swingL) * 0.35 * s;

    // Breathing at rest; lean into the slope when moving.
    const t = performance.now() / 1000;
    const lean = Math.min(0.42, 0.10 + this.field.slope(this.pos.x, this.pos.z, 6) * 0.006);
    p.torso.rotation.x = lean * s + (1 - s) * Math.sin(t * 1.4) * 0.015;
    p.torso.position.y = 1.02 + (1 - s) * Math.sin(t * 1.4) * 0.008
                       + s * Math.abs(Math.cos(ph)) * 0.035;   // gait bob
    p.head.rotation.x = -lean * 0.6 * s;
    p.axe.rotation.z = -0.5 + swingL * 0.22 * s;
  }

  /**
   * Mouse look.
   *
   * **Yaw increases clockwise from north**, because the look direction is
   * `(sin yaw, ·, −cos yaw)`: yaw 0 is north (−z) and yaw +90° is east (+x).
   * So moving the mouse right — turning to the right — must ADD to yaw. It
   * subtracted, which inverted the horizontal axis: pushing the mouse right
   * turned you left. Pitch is not inverted and is not meant to be.
   */
  look(dxPix, dyPix, sens = 0.0022) {
    // Binoculars narrow the FOV 4x; unscaled, the mouse would sweep the
    // magnified view 4x too fast. main sets lookScale to fov/baseFov.
    this.yaw += dxPix * sens * (this.lookScale || 1);
    this.pitch -= dyPix * sens * (this.lookScale || 1);
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  /** Compass heading, degrees from north — the same convention `bearing()`
   *  answers in, which is what lets the compass strip put the next camp's
   *  marker in the right place. This was negated, so the strip and the
   *  bearing disagreed by twice the heading. */
  get heading() { return ((this.yaw * 180 / Math.PI) % 360 + 360) % 360; }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();

/* ── The climber ─────────────────────────────────────────────────────────
   Boxes. Everything worth looking at in this game is the mountain, and a
   third-person figure only has to read as a person in a down suit from four
   metres — silhouette, the red suit, the pack, the axe. */
function buildClimber() {
  /* Third figure, and this time drawn like a figure. The first was boxes and
     the second was capsules pinned at the wrong widths — both read as
     mannequins because limbs met the body at right angles with visible seams.
     This one is built the way stop-motion armatures are: TAPERED cylinders
     for every segment (limbs are cones, not tubes), a SPHERE embedded at
     every joint so flexing never opens a gap, and proportions taken off a
     7.5-head figure at 1.78 m. The down suit is stacked baffle rings, the
     hood is a sphere with a fur torus around the face, and the axe hangs
     from the mitt. Still zero assets — geometry only. */
  const g = new THREE.Group();
  g.name = "climber";
  const suit  = new THREE.MeshLambertMaterial({ color: 0xd8402f });
  const suitD = new THREE.MeshLambertMaterial({ color: 0xa92f22 });
  const dark  = new THREE.MeshLambertMaterial({ color: 0x23262c });
  const pack  = new THREE.MeshLambertMaterial({ color: 0xe2a12a });
  const skin  = new THREE.MeshLambertMaterial({ color: 0x1a1c20 });
  const metal = new THREE.MeshLambertMaterial({ color: 0xbfc6cc });
  const fur   = new THREE.MeshLambertMaterial({ color: 0xd8d3c8 });
  const boot  = new THREE.MeshLambertMaterial({ color: 0x2e3238 });

  const cyl = (mat, rTop, rBot, h, seg = 10) =>
    new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  const ball = (mat, r) => new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);

  const torso = new THREE.Group();
  torso.position.y = 1.06;
  g.add(torso);

  /* The suit torso: hips narrower than chest, chest broadening to the
     shoulders, wrapped in three baffle rings so it reads as down. */
  const hips = cyl(suitD, 0.155, 0.135, 0.18); hips.position.y = -0.22; torso.add(hips);
  const waist = cyl(suit, 0.165, 0.155, 0.16); waist.position.y = -0.06; torso.add(waist);
  const chest = cyl(suit, 0.185, 0.165, 0.24); chest.position.y = 0.13; torso.add(chest);
  for (const [ry, rr] of [[-0.14, 0.162], [0.02, 0.170], [0.18, 0.188]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.02, 6, 14), suitD);
    ring.rotation.x = Math.PI / 2; ring.position.y = ry; torso.add(ring);
  }
  const shL = ball(suit, 0.085); shL.position.set(-0.19, 0.27, 0); torso.add(shL);
  const shR = ball(suit, 0.085); shR.position.set(0.19, 0.27, 0); torso.add(shR);

  const head = new THREE.Group(); head.position.y = 0.44; torso.add(head);
  const neck = cyl(suitD, 0.05, 0.055, 0.07); neck.position.y = 0.03; head.add(neck);
  const hood = ball(suit, 0.115); hood.position.y = 0.15; hood.scale.set(1, 1.08, 1.05); head.add(hood);
  const ruff = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.025, 8, 16), fur);
  ruff.position.set(0, 0.14, 0.075); head.add(ruff);
  const face = ball(skin, 0.07); face.position.set(0, 0.14, 0.055); head.add(face);
  const goggle = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.032, 0.028), metal);
  goggle.position.set(0, 0.165, 0.104); head.add(goggle);

  const bag = cyl(pack, 0.13, 0.145, 0.34, 12); bag.position.set(0, 0.06, -0.225);
  bag.scale.z = 0.72; torso.add(bag);
  const lid = ball(pack, 0.115); lid.position.set(0, 0.26, -0.21); lid.scale.set(1, 0.55, 0.72); torso.add(lid);
  const bottle = cyl(metal, 0.04, 0.04, 0.34, 8); bottle.position.set(0.085, 0.08, -0.335); torso.add(bottle);

  /* Limbs: pivot group at the proximal joint, tapered segment hanging below,
     a joint ball at the distal end, then the next pivot group. */
  const segment = (mat, rTop, rBot, len) => {
    const grp = new THREE.Group();
    const m = cyl(mat, rTop, rBot, len);
    m.position.y = -len / 2;
    grp.add(m);
    const joint = ball(mat, rBot * 1.18);
    joint.position.y = -len;
    grp.add(joint);
    return grp;
  };
  const limb = (mat, dims, x, y) => {
    const [rT1, rB1, l1, rT2, rB2, l2] = dims;
    const upper = segment(mat, rT1, rB1, l1); upper.position.set(x, y, 0);
    const lower = segment(mat, rT2, rB2, l2); lower.position.y = -l1;
    upper.add(lower);
    return { upper, lower };
  };

  const armL = limb(suit, [0.062, 0.052, 0.26, 0.05, 0.042, 0.24], -0.20, 0.27);
  const armR = limb(suit, [0.062, 0.052, 0.26, 0.05, 0.042, 0.24], 0.20, 0.27);
  armL.upper.rotation.z = 0.10; armR.upper.rotation.z = -0.10;
  torso.add(armL.upper, armR.upper);
  const mittL = ball(dark, 0.058); mittL.position.y = -0.26; mittL.scale.set(1, 1.25, 1); armL.lower.add(mittL);
  const mittR = mittL.clone(); armR.lower.add(mittR);

  const legL = limb(dark, [0.082, 0.068, 0.34, 0.062, 0.05, 0.32], -0.095, -0.30);
  const legR = limb(dark, [0.082, 0.068, 0.34, 0.062, 0.05, 0.32], 0.095, -0.30);
  torso.add(legL.upper, legR.upper);
  for (const l of [legL, legR]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.09, 0.24), boot);
    b.position.set(0, -0.345, 0.045);
    l.lower.add(b);
    const spike = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.02, 0.22), metal);
    spike.position.set(0, -0.395, 0.045);
    l.lower.add(spike);
  }

  const axe = new THREE.Group();
  const shaft = cyl(dark, 0.014, 0.016, 0.55, 6); shaft.position.y = -0.27;
  const pick = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.025), metal);
  axe.add(shaft, pick);
  axe.position.set(0, -0.27, 0.05);
  axe.rotation.x = 0.28;
  armR.lower.add(axe);

  g.userData.parts = {
    torso, head,
    shoulderL: armL.upper, shoulderR: armR.upper,
    elbowL: armL.lower, elbowR: armR.lower,
    hipL: legL.upper, hipR: legR.upper,
    kneeL: legL.lower, kneeR: legR.lower,
    axe,
  };
  return g;
}
