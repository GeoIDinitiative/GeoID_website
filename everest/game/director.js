/**
 * What happens to you, and who you meet.
 *
 * ── Avalanches ───────────────────────────────────────────────────────────
 * A slab releases on a slope between about 25° and 60°, and the great
 * majority of fatal ones happen between 30° and 45°. Below 25° the snow will
 * not slide; above 60° it sloughs continuously and never gets the chance to
 * build into a slab. That band is the single most useful thing anyone knows
 * about avalanches, so it is the spine of the model — and it means the
 * player can be taught to read the ground rather than to read a meter.
 *
 * Loading matters as much as angle: snow blows off the windward side and
 * piles up on the lee, so an aspect facing away from the wind holds far more
 * of it. That is computed from the terrain's own aspect and the live wind
 * direction, which is why the dangerous slope changes when the weather does.
 *
 * ── The others on the mountain ───────────────────────────────────────────
 * The climbers you meet are not a quest chain. Some can be helped down, some
 * can be given oxygen and will make it on their own, and some cannot be
 * saved by anybody and will still ask you to. Getting one to a camp costs
 * hours and most of what you have left, and the game does not tell you in
 * advance which kind you have found. That is the actual moral situation up
 * there and it is not improved by being made tidy.
 */

import * as THREE from "../vendor/three.module.js?v=5d280e5-e507c198";
import { HAZARD } from "./config.js?v=5d280e5-e507c198";
import { llToLocal } from "./geo.js?v=5d280e5-e507c198";

/* ── Avalanche ───────────────────────────────────────────────────────────*/

export class Avalanche {
  constructor(field, path, width) {
    this.field = field;
    this.path = path;             // [{x,z,y}] release → runout
    this.width = width;
    this.t = 0;
    this.dist = 0;
    this.speed = 3;
    this.total = 0;
    for (let i = 1; i < path.length; i++) {
      this.total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    }
    this.done = false;
    this.build();
  }

  build() {
    const N = 5200;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      seed[i * 2] = Math.random();          // along the front, -0.5..0.5 later
      seed[i * 2 + 1] = Math.random();      // size / lifetime jitter
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);

    this.uniforms = {
      time: { value: 0 },
      tint: { value: new THREE.Color(0.95, 0.96, 0.99) },
      pixelScale: { value: 1 },
      fade: { value: 1 },
    };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec2 seed;
        uniform float pixelScale;
        varying float vA;
        void main() {
          vec4 mv = viewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          vA = seed.y;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (26.0 + 70.0 * seed.y) * pixelScale * 30.0 / max(d, 5.0);
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying float vA;
        uniform vec3 tint; uniform float fade;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = dot(c, c);
          if (r > 0.25) discard;
          gl_FragColor = vec4(tint, (1.0 - r * 4.0) * (0.10 + 0.22 * vA) * fade);
        }`,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 800;
    this.array = pos;
    this.seed = seed;
    this.count = N;
  }

  pointAt(d) {
    let acc = 0;
    for (let i = 1; i < this.path.length; i++) {
      const a = this.path[i - 1], b = this.path[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (acc + len >= d) {
        const t = (d - acc) / (len || 1);
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
                 dx: (b.x - a.x) / (len || 1), dz: (b.z - a.z) / (len || 1) };
      }
      acc += len;
    }
    const l = this.path[this.path.length - 1];
    return { x: l.x, z: l.z, dx: 0, dz: 1 };
  }

  update(dt, pixelRatio) {
    this.t += dt;
    // Accelerates hard, then runs out on the flat.
    const slope = Math.max(0, this.slopeAtFront ?? 0.4);
    this.speed = Math.min(58, this.speed + dt * (9 + slope * 40));
    if (this.dist > this.total * 0.72) this.speed *= 1 - dt * 1.1;
    this.dist += this.speed * dt;
    if (this.dist > this.total || this.speed < 1.5) {
      this.uniforms.fade.value -= dt * 0.55;
      if (this.uniforms.fade.value <= 0) { this.done = true; return; }
    }

    const front = this.pointAt(this.dist);
    this.front = front;
    const px = -front.dz, pz = front.dx;           // across the flow
    const arr = this.array;
    // A tail behind the front, widening as it goes, plus the powder cloud
    // lifting off the top of it.
    for (let i = 0; i < this.count; i++) {
      const s0 = this.seed[i * 2], s1 = this.seed[i * 2 + 1];
      const back = s1 * 210 + s0 * 40;
      const d = Math.max(0, this.dist - back);
      const p = this.pointAt(d);
      const spread = this.width * (0.35 + 1.15 * (back / 250)) * (s0 - 0.5) * 2;
      const x = p.x + px * spread + Math.sin(this.t * 3 + i) * 2.2;
      const z = p.z + pz * spread + Math.cos(this.t * 2.6 + i) * 2.2;
      const ground = this.field.height(x, z);
      const lift = (back / 250) * 55 * s1 + 3;
      arr[i * 3] = x;
      arr[i * 3 + 1] = ground + lift;
      arr[i * 3 + 2] = z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.uniforms.pixelScale.value = pixelRatio;
    this.slopeAtFront = Math.abs(
      this.field.height(front.x + front.dx * 20, front.z + front.dz * 20)
      - this.field.height(front.x, front.z)) / 20;
  }

  /** Is the player in it? Anything within the front's width and behind it. */
  catches(x, z) {
    if (!this.front) return false;
    const f = this.front;
    const rel = (x - f.x) * f.dx + (z - f.z) * f.dz;
    if (rel > 12 || rel < -190) return false;
    const across = Math.abs((x - f.x) * -f.dz + (z - f.z) * f.dx);
    return across < this.width * 0.75;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

/* ── The director ────────────────────────────────────────────────────────*/

export class Director {
  constructor(field, weather, glacier, survival) {
    this.field = field;
    this.weather = weather;
    this.glacier = glacier;
    this.survival = survival;
    this.group = new THREE.Group();
    this.group.name = "hazards";
    this.avalanches = [];
    this.cooldown = 25;
    this.events = [];
    this.buriedDepth = 0;
    this.lastStability = 1;
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  /**
   * Slab stability at a point: 1 is safe, 0 is going to go.
   * Reported to the player as a word, never as a number — nobody in the
   * mountains has a stability readout, they have a slope, an aspect and a
   * memory of what the weather did.
   */
  stability(x, z) {
    const slope = this.field.slope(x, z, 26);
    if (slope < HAZARD.slabMin || slope > HAZARD.slabMax) return 1;
    // Peaks at 38°, falls away either side.
    const band = 1 - Math.abs(slope - HAZARD.slabPeak) / (HAZARD.slabMax - HAZARD.slabPeak);
    const aspect = this.field.aspect(x, z, 40);
    // Lee slopes face away from where the wind is coming from.
    let rel = Math.abs(((aspect - (this.weather.windFrom + 180)) % 360 + 540) % 360 - 180);
    const lee = 1 - rel / 180;                       // 1 = fully leeward
    const load = this.weather.snowFall;
    const wind = Math.min(1, this.weather.windAt(this.field.height(x, z)) / 30);
    const danger = Math.min(1, band * (0.35 + 0.65 * lee) * (0.30 + 1.15 * load) * (0.55 + 0.75 * wind));
    return 1 - danger;
  }

  /** A word for it, and a colour. */
  static rate(stab) {
    if (stab > 0.86) return { word: "Low", level: 1 };
    if (stab > 0.70) return { word: "Moderate", level: 2 };
    if (stab > 0.50) return { word: "Considerable", level: 3 };
    if (stab > 0.32) return { word: "High", level: 4 };
    return { word: "Extreme", level: 5 };
  }

  /**
   * Trace the fall line from a point — where the snow would go.
   *
   * Stopping the moment a step fails to descend makes the runout absurdly
   * short: on a glacier the surface undulates, so a 26 m step goes uphill
   * every so often on a slope that is losing three hundred metres overall.
   * Measured before this was fixed: seven points, about 180 m, and the
   * avalanche was over before it reached anything. A slide carries through a
   * rise — that is what momentum is — so it takes three consecutive
   * non-descending steps to stop it, and it always stops if it has climbed
   * more than fifteen metres above the lowest point it has reached.
   */
  fallLine(x, z, steps = 220, step = 26) {
    const path = [{ x, z, y: this.field.height(x, z) }];
    let cx = x, cz = z, stalls = 0;
    let lowest = path[0].y;
    for (let i = 0; i < steps; i++) {
      const a = this.field.aspect(cx, cz, 26) * Math.PI / 180;
      cx += Math.sin(a) * step;
      cz += Math.cos(a) * step;
      const y = this.field.height(cx, cz);
      const prev = path[path.length - 1];
      path.push({ x: cx, z: cz, y });
      lowest = Math.min(lowest, y);
      if (y > prev.y - 0.4) { if (++stalls >= 3) break; } else stalls = 0;
      if (y > lowest + 15) break;                   // running back uphill
    }
    return path;
  }

  /** Walk uphill to find where a slab above the player would break away. */
  releasePoint(x, z) {
    let cx = x, cz = z;
    for (let i = 0; i < 26; i++) {
      const a = (this.field.aspect(cx, cz, 26) + 180) * Math.PI / 180;
      cx += Math.sin(a) * 22;
      cz += Math.cos(a) * 22;
      const s = this.field.slope(cx, cz, 26);
      if (s > HAZARD.slabMax) break;
    }
    return { x: cx, z: cz };
  }

  trigger(x, z, width = 90) {
    const rel = this.releasePoint(x, z);
    const path = this.fallLine(rel.x, rel.z);
    if (path.length < 4) return null;
    const av = new Avalanche(this.field, path, width);
    this.avalanches.push(av);
    this.group.add(av.points);
    this.emit("avalanche", { release: rel, size: width });
    return av;
  }

  /**
   * @param dtSim   simulated seconds — everything that is a rate per hour
   * @param dtReal  real seconds — the avalanche itself, which has to move at
   *                the speed it moves at or running from it means nothing
   */
  update(dtSim, dtReal, player, pixelRatio) {
    const p = player.pos;
    const h = dtSim / 3600;
    this.lastStability = this.stability(p.x, p.z);

    for (let i = this.avalanches.length - 1; i >= 0; i--) {
      const av = this.avalanches[i];
      av.update(dtReal, pixelRatio);
      if (av.catches(p.x, p.z) && !this.buried) {
        this.buried = true;
        this.buriedDepth = 0.4 + Math.random() * 1.4;
        this.survival.health -= 22 + Math.random() * 30;
        this.survival.warmth -= 30;
        this.emit("caught", { depth: this.buriedDepth });
      }
      if (av.done) {
        this.group.remove(av.points);
        av.dispose();
        this.avalanches.splice(i, 1);
      }
    }

    if (this.buried) {
      /* Buried: no air pocket to speak of, and the clock is minutes. Roughly
         half of people dug out inside fifteen minutes live; after forty-five
         almost nobody does. Digging is a held key and it is deliberately
         slow — being caught should not feel survivable by reflex. */
      this.survival.warmth -= h * 140;
      this.survival.health -= h * (this.buriedDepth > 1.0 ? 85 : 40);
      if (this.digging) {
        this.buriedDepth -= dtReal * 0.055 * this.survival.capability(p.y);
        this.survival.energy -= h * 160;
        if (this.buriedDepth <= 0) {
          this.buried = false;
          this.emit("dugOut", {});
        }
      }
      return;
    }

    /* Hazards are rolled on a fixed simulated interval rather than every
       frame, so the published per-hour rates mean what they say regardless
       of frame rate. */
    this.cooldown -= dtSim;
    if (this.cooldown > 0) return;
    /* The random hazard theatre — serac lets-go, rockfall hits, slab
       releases and the avalanche animation they trigger — is retired by
       request. Danger is now communicated, not simulated: the guide (Gio,
       wired in main.js) warns as you enter each hazard's ground, and the
       stability rating still runs the instruments. The rolls below stay in
       the file as the record of the model, behind this return. */
    return;
    const window = 240;                       // simulated seconds per roll
    this.cooldown = window;

    const alt = p.y;
    const perHourToChance = (perHour) => 1 - Math.exp(-perHour * (window / 3600));

    /* Serac collapse — only in the Icefall, and it is not a response to
       anything the player did. That is the point of it. */
    if (alt > 5250 && alt < 6150 && this.field.slope(p.x, p.z, 30) > 9) {
      if (Math.random() < perHourToChance(HAZARD.seracCollapse.perHour)) {
        const near = Math.random() < 0.34;
        this.emit("serac", { near });
        if (near) {
          this.trigger(p.x + (Math.random() - 0.5) * 120, p.z + (Math.random() - 0.5) * 120, 60);
        }
      }
    }

    /* Rockfall on the faces. Worse in the afternoon, when the sun has been on
       the rock all day and the ice holding it has let go. */
    if (alt > 6800 && alt < 8200 && this.field.slope(p.x, p.z, 30) > 30) {
      const hour = this.hourLocal ?? 12;
      const afternoon = hour > 11 && hour < 17 ? 2.2 : 0.6;
      if (Math.random() < perHourToChance(HAZARD.rockfall.perHour * afternoon)) {
        const hit = Math.random() < 0.22;
        this.emit("rockfall", { hit });
        if (hit) this.survival.health -= 8 + Math.random() * 22;
      }
    }

    /* A slab that is going to go. The player standing on it is the trigger
       most of the time — which is true, and is why the rating matters. */
    const stab = this.lastStability;
    if (stab < 0.55 && player.speed > 0.2) {
      const chance = perHourToChance(HAZARD.avalanche.perHour * (0.55 - stab) * 8);
      if (Math.random() < chance) this.trigger(p.x, p.z, 70 + (0.55 - stab) * 300);
    }
  }
}

/* ── Climbers ────────────────────────────────────────────────────────────*/

const FATE = { HELPABLE: "helpable", OXYGEN: "oxygen", BEYOND: "beyond", DEAD: "dead" };

export class Climbers {
  constructor(field, world) {
    this.field = field;
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = "climbers";
    this.list = [];
    this.escorting = null;
    this.events = [];
    this.build();
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  build() {
    /* Placed where people actually get into trouble: on the Lhotse Face, at
       the top of the fixed lines, on the traverse to the South Summit, and
       in the Icefall. Not spread evenly — the mountain is not fair. */
    const spots = [
      { lat: 27.9800, lon: 86.9146, fate: FATE.OXYGEN, name: "Dawa Sherpa",
        line: "His bottle ran dry an hour below Camp III. He is conscious, he is furious with himself, and he can walk if he can breathe.",
        need: "o2" },
      { lat: 27.9776, lon: 86.9238, fate: FATE.HELPABLE, name: "Ingrid Hass",
        line: "Snow-blind. She took her goggles off in the cloud yesterday and by this morning she could not see the rope. She is not hurt. She simply cannot find her way down.",
        need: "escort" },
      { lat: 27.9840, lon: 86.9280, fate: FATE.BEYOND, name: "an unnamed climber",
        line: "Sitting against the rock above the Balcony, above 8,400 m, with no bottle and no mask. He asks you, quite reasonably, to help him stand. There is nothing here that will let you carry a grown man down from this altitude and both of you know it.",
        need: null },
      { lat: 27.9995, lon: 86.8720, fate: FATE.HELPABLE, name: "Pemba Rita",
        line: "Went through a bridge below Camp I and came out with a broken wrist and no rope. He is cold, and the Icefall is between him and the doctor.",
        need: "escort" },
      { lat: 27.9758, lon: 86.9290, fate: FATE.OXYGEN, name: "Marc Oliveira",
        line: "Came down from the Col too slowly and sat down to think about it. He has been sitting for two hours. Give him gas and he will get up.",
        need: "o2" },
      { lat: 27.9866, lon: 86.9262, fate: FATE.DEAD, name: "someone in a green jacket",
        line: "Curled against the rock a little below the South Summit, in a green down jacket, entirely covered in rime. He has been here a long time and he is part of the route now — people use him to know where they are.",
        need: null },
    ];

    for (const s of spots) {
      const l = llToLocal(s.lat, s.lon);
      const y = this.field.height(l.x, l.z);
      const mesh = buildSlumped(s.fate === FATE.DEAD);
      mesh.position.set(l.x, y, l.z);
      mesh.rotation.y = Math.random() * 6.28;
      this.group.add(mesh);
      this.list.push({
        ...s, x: l.x, z: l.z, y, mesh,
        helped: false, given: false, abandoned: false, delivered: false,
        alive: s.fate !== FATE.DEAD,
        following: false,
      });
    }
  }

  nearest(x, z, radius = 16) {
    let best = null, bd = radius * radius;
    for (const c of this.list) {
      if (c.delivered) continue;
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Give them what they need. Returns the line the game should show. */
  help(c, survival) {
    if (!c.alive) {
      c.helped = true;
      return "Nothing to be done. You note where he is, because that is worth something to somebody.";
    }
    if (c.fate === FATE.BEYOND) {
      c.helped = true;
      survival.standing += 1;
      return "You give him what water you have and sit with him a while. He asks you not to tell his daughter he was on his own. Then you go on, because the alternative is two people here instead of one.";
    }
    if (c.need === "o2") {
      if (survival.inventory.o2 <= 0) return "He needs gas. You have none to give.";
      survival.inventory.o2--;
      c.given = true; c.helped = true; c.delivered = true;
      survival.standing += 3;
      c.mesh.visible = false;
      return "You crack the bottle onto his regulator. It takes four minutes, and then he is a different person. He goes down on his own feet.";
    }
    if (c.need === "escort") {
      if (this.escorting && this.escorting !== c) return "You already have someone. You cannot take two.";
      c.following = !c.following;
      this.escorting = c.following ? c : null;
      return c.following
        ? "You get her onto her feet and clip her to your harness. Everything you do from now on takes twice as long."
        : "You unclip her. She sits back down.";
    }
    return "";
  }

  abandon(c, survival) {
    if (c.abandoned || !c.alive || c.fate === FATE.DEAD) return "";
    c.abandoned = true;
    if (c.following) { c.following = false; this.escorting = null; }
    survival.standing -= 4;
    return "You go on. You will find that you are able to, and you will find that afterwards you think about it more than you expected to.";
  }

  /** Delivering someone to a camp is the whole payoff. */
  update(dt, player, world) {
    const c = this.escorting;
    if (!c) return;
    // Follow, a few metres behind and slower than the player would like.
    const dx = player.pos.x - c.x, dz = player.pos.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > 2.6) {
      const v = Math.min(player.speed * 0.85, 0.9) * dt;
      c.x += dx / d * v * 12; c.z += dz / d * v * 12;
      c.y = this.field.height(c.x, c.z);
      c.mesh.position.set(c.x, c.y, c.z);
      c.mesh.rotation.y = Math.atan2(dx, dz);
    }
    for (const camp of world.camps) {
      if (Math.hypot(camp.x - c.x, camp.z - c.z) < 25) {
        c.delivered = true; c.following = false; this.escorting = null;
        c.mesh.visible = false;
        this.emit("delivered", { climber: c, camp });
        return;
      }
    }
  }
}

function buildSlumped(dead) {
  const g = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: dead ? 0x2f6a3d : 0x2f5fd0 });
  const rime = new THREE.MeshLambertMaterial({ color: 0xd6dee6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.36), dead ? rime : jacket);
  body.position.y = 0.34; body.rotation.x = 0.42;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), dead ? rime : new THREE.MeshLambertMaterial({ color: 0x24262b }));
  head.position.set(0, 0.72, 0.12);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.20, 0.62), dead ? rime : new THREE.MeshLambertMaterial({ color: 0x24262b }));
  legs.position.set(0, 0.12, 0.30);
  g.add(body, head, legs);
  return g;
}
