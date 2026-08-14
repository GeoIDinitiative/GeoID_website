/**
 * ASCENT — the loop that holds everything.
 *
 * Boot order matters and is not arbitrary: the elevation model has to be on
 * disk-in-memory before the terrain can be built, the terrain before the
 * world can be put on the ground, and the world before the player can be
 * stood on it. Everything after that is a frame.
 *
 * Two clocks run. Real seconds drive animation, the camera, the avalanche and
 * anything the player is reacting to. Simulated seconds — eight of them per
 * real one — drive the body, the weather and the sun. Every system takes
 * whichever one it means, and says which in its signature.
 */

import * as THREE from "../vendor/three.module.js?v=deee5eb-4b034ad8";
import { ROUTE, SUMMIT, TIME_SCALE, MOVE, RENDER, IMAGERY, ELEVATION, PHYS } from "./config.js?v=deee5eb-4b034ad8";
import { llToLocal, localToLL, haversine, bearing, compassPoint } from "./geo.js?v=deee5eb-4b034ad8";
import { Heightfield } from "./dem.js?v=deee5eb-4b034ad8";
import { Imagery } from "./imagery.js?v=deee5eb-4b034ad8";
import { Terrain } from "./terrain.js?v=deee5eb-4b034ad8";
import { Sky, NEPAL_UTC_OFFSET_H } from "./sky.js?v=deee5eb-4b034ad8";
import { Weather, Precipitation, Spindrift } from "./weather.js?v=deee5eb-4b034ad8";
import { Glacier } from "./glacier.js?v=deee5eb-4b034ad8";
import { TerrainShadows } from "./shadows.js?v=deee5eb-4b034ad8";
import { PostFX, QUALITY } from "./postfx.js?v=deee5eb-4b034ad8";
import { estimateCaptureSun } from "./delight.js?v=deee5eb-4b034ad8";
import { SnowField } from "./snowfield.js?v=deee5eb-4b034ad8";
import { Photoclinometry } from "./photoclino.js?v=deee5eb-4b034ad8";
import { World } from "./world.js?v=deee5eb-4b034ad8";
import { Survival, pressureKPa, inspiredO2 } from "./survival.js?v=deee5eb-4b034ad8";
import { Player, STATE } from "./player.js?v=deee5eb-4b034ad8";
import { Director, Climbers } from "./director.js?v=deee5eb-4b034ad8";
import { Hud } from "./hud.js?v=deee5eb-4b034ad8";
import { Audio } from "./audio.js?v=deee5eb-4b034ad8";
import { install as installDiag } from "./diag.js?v=deee5eb-4b034ad8";
import * as tiles from "./tiles.js?v=deee5eb-4b034ad8";

/** Photoclinometric relief: off. See Game.refreshDetail for the measurement
 *  and the mechanism. The estimator still runs; nothing is displaced. */
const PHOTOCLINO_ON = false;

/**
 * BARE MAP MODE — the mountain, and nothing else.
 *
 * The instruction, after a day of chasing vertical lines through shadows,
 * imagery correction, recovered relief and colour grading, was to stop:
 * "wipe everything to do with mapping, the shadows, tents, wind, snow —
 * everything except for the DEM and satellite image mapping."
 *
 * So this renders exactly what the reference viewer renders: the elevation
 * model as geometry, the satellite imagery draped over it unlit, the sky
 * behind it. The photograph carries its own sun. Concretely:
 *
 *   - terrain fragment shader short-circuits to the raw composited imagery
 *     (debugMode 2 — the same path the PICTURE isolation mode uses)
 *   - no game lighting, no snow/rock/micro-relief materials, no post chain
 *   - no tents, no glacier props, no falling snow, no spindrift lines
 *   - crevasse cuts stay (they are holes in the surface, and the game
 *     mechanics stand on them), and so do the route, labels and HUD
 *
 * The simulation underneath — weather as forces, cold, oxygen, the body —
 * is untouched; only its visuals are gone. Set false to bring the full
 * renderer back one piece at a time.
 */
const BARE_MAP = true;

export class Game {
  constructor(canvas, hudRoot) {
    this.canvas = canvas;
    /* `?shot` keeps the drawing buffer so a frame can be read back with
       toDataURL. A browser pane that is not being displayed does not
       composite and cannot be screenshotted any other way, and this is off by
       default because holding the buffer costs memory and a little speed. */
    this.headless = location.search.includes("shot");
    /* Logarithmic depth. The camera spans near 0.6 m to far 90 km — a range
       of 150,000:1 — and a 24-bit fixed-point depth buffer spends almost all
       of its precision in the first few metres. By 3 km, adjacent depth
       values are metres apart, and the clipmap is built so that a level and
       its parent are COINCIDENT surfaces at every ring boundary (that is how
       it avoids cracks). Coincident surfaces with no precision left is
       z-fighting: interleaved dark and light wedges, widening in opposite
       directions with the depth gradient, on distant ground only — never in
       the foreground where precision is ample, never in the sky where there
       is nothing to fight. That is the artifact, exactly as described.
       Logarithmic depth distributes precision by log(z) instead, which is
       what every planetary-scale renderer does for this reason. */
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: "high-performance",
      preserveDrawingBuffer: this.headless,
      logarithmicDepthBuffer: true,
    });
    // Provisional; resize() sets the real one against the display grid.
    this.renderer.setPixelRatio(devicePixelRatio || 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();

    this.hud = new Hud(hudRoot);
    this.audio = new Audio();
    this.clock = new THREE.Clock();

    /* 28 May 2026, 05:20 in Nepal — an hour before it gets light at Base
       Camp, in the pre-monsoon season.
       The date is chosen, not arbitrary. A summit push happens about 2.3
       simulated days in, which puts summit night on the 30th or 31st — and
       the moon is full on the 31st and thirty degrees up at one in the
       morning. Expeditions really do pick their window partly for the moon,
       because the alternative is following a rope by torchlight across the
       Triangular Face. Starting a week earlier, as this did at first, puts
       summit night three days after new moon: astronomically correct and
       pitch black. */
    this.date = new Date(Date.UTC(2026, 4, 28, 0, 0) - NEPAL_UTC_OFFSET_H * 3600000 + 5.33 * 3600000);

    this.reached = new Set();
    this.running = false;
    this.paused = false;
    this.slowmo = 1;
    this.stats = { started: 0, distance: 0, climbed: 0, helped: 0, flares: 0, falls: 0 };
    this.ended = false;
    this.showLabels = true;
    this.showRoute = true;
    /* Quality. The scene is fill-rate bound, so this is a real choice: on the
       integrated GPU this was built against, `high` costs about 10 ms of a
       16.6 ms frame at 1080p and `ultra` does not fit. Defaults to high and
       cycles from the control bar. */
    /* One setting, and it is the direct render.
       The four tiers differed mostly in what the post chain did, and the post
       chain was the thing making the mountain look flat: `low` is the only
       tier with `post: false`, so it renders straight to the canvas. Measured
       against `high`: sharpness 19.1 vs 11.2, contrast 57.1 vs 28.6.

       Worth being honest about WHY it looks better, because it is not more
       detail. The terrain shader outputs linear HDR and leaves tonemapping to
       the post chain; with no chain nothing tonemaps, so values are clipped
       into 0-1 and both ends are crushed. That is a harder image, and on this
       scene it reads as bite. It is also free — no HDR target, no AO, no
       bloom, no grade — which is worth several milliseconds a frame.

       The cycle is kept as a single entry rather than removed so the control
       bar, the HUD label and the quality plumbing all keep working. */
    this.qualityNames = ["low"];
    this.qualityIndex = 0;
    this.quality = QUALITY.low;
    this.postfx = new PostFX(this.renderer);
    this.hud.onTool = (id) => this.tool(id);
  }

  async boot(onProgress) {
    const p = (frac, what) => onProgress && onProgress(frac, what);

    this.field = new Heightfield();
    p(0.02, "Reading the elevation model");
    await this.field.boot((f, k) => p(0.02 + f * 0.44, `Elevation · ${k}`));

    Imagery.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.imagery = new Imagery();
    p(0.48, "Streaming imagery");
    await this.imagery.boot((f, k) => p(0.48 + f * 0.34, `Imagery · ${k}`));

    p(0.84, "Building the mountain");
    this.terrain = new Terrain(this.field, this.imagery);
    this.scene.add(this.terrain.group);

    /* ── Gravel for the imagery's black voids ────────────────────────────
       The mosaic around Base Camp has genuine no-capture patches. The shader
       fills them with this repeating moraine texture. A real photograph at
       data/pebbles.jpg is preferred — drop one there and it is used on the
       next load; failing that, a procedural gravel canvas stands in, drawn
       once: layered rounded stones in the greys of the surrounding rock. */
    {
      const applyMoraine = (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        this.terrain.uniforms.moraineTex.value = tex;
        this.terrain.uniforms.moraineOn.value = 1;
      };
      const procedural = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 512;
        const x = c.getContext("2d");
        x.fillStyle = "#4c4a46"; x.fillRect(0, 0, 512, 512);
        let seed = 7;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 2600; i++) {
          const r = 4 + rnd() * 14;
          const g = 110 + rnd() * 90;
          const warm = rnd() < 0.18 ? 14 : 0;
          x.fillStyle = `rgb(${g + warm}, ${g + warm * 0.5}, ${g - warm * 0.4})`;
          x.beginPath();
          x.ellipse(rnd() * 512, rnd() * 512, r, r * (0.62 + rnd() * 0.3),
                    rnd() * Math.PI, 0, Math.PI * 2);
          x.fill();
          // a darker under-edge sells the stone as sitting on its neighbours
          x.fillStyle = "rgba(30,28,26,0.28)";
          x.beginPath();
          x.ellipse(rnd() * 512, rnd() * 512, r * 0.8, r * 0.32,
                    rnd() * Math.PI, 0, Math.PI * 2);
          x.fill();
        }
        const tx = new THREE.CanvasTexture(c);
        applyMoraine(tx);
      };
      new THREE.TextureLoader().load("data/pebbles.jpg", applyMoraine, undefined, procedural);

      /* Procedural snow grain: R is low-contrast multi-scale lump noise,
         G is sparse sparkle. Drawn once — no asset to fetch. */
      {
        const c = document.createElement("canvas");
        c.width = c.height = 512;
        const x = c.getContext("2d");
        x.fillStyle = "#808000"; x.fillRect(0, 0, 512, 512);
        let seed = 31;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 4200; i++) {
          const r = 2 + rnd() * 16;
          const v = 96 + rnd() * 64;
          x.fillStyle = `rgba(${v},0,0,0.30)`;
          x.beginPath();
          x.ellipse(rnd() * 512, rnd() * 512, r, r * (0.6 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
          x.fill();
        }
        for (let i = 0; i < 900; i++) {
          x.fillStyle = "rgba(0,255,0,0.9)";
          x.fillRect(rnd() * 512, rnd() * 512, 1.4, 1.4);
        }
        const tx = new THREE.CanvasTexture(c);
        tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
        this.terrain.uniforms.snowTex.value = tx;
        this.terrain.uniforms.snowTexOn.value = 1;
      }
    }

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.ambient = new THREE.HemisphereLight(0xbcd4f0, 0x6a6258, 0.9);
    this.scene.add(this.sun, this.ambient);

    this.weather = new Weather();
    this.precip = new Precipitation();
    this.spindrift = new Spindrift();
    this.scene.add(this.precip.points, this.spindrift.lines);

    /* The head torch. The terrain lights itself (see terrain.js), so this
       spotlight exists only for the props — tents, wands, seracs, the other
       climbers — which use ordinary materials. Both are driven from the same
       state so they cannot disagree about whether the torch is on. */
    this.lamp = {
      on: false,
      battery: 100,
      light: new THREE.SpotLight(0xfff2d6, 0, 60, 0.42, 0.55, 1.2),
    };
    this.lamp.light.visible = false;
    this.scene.add(this.lamp.light, this.lamp.light.target);

    this.glacier = new Glacier(this.field, this.weather);
    this.scene.add(this.glacier.group);

    /* Relief recovered from the imagery, below the elevation model's real
       17 m resolution. Built once the capture sun is known. */
    this.photoclino = new Photoclinometry("near");

    this.snow = new SnowField();
    this.snow.bind(this.terrain.uniforms);

    /* Terrain self-shadowing. Built for the sun's current bearing and
       rebuilt when it has moved a few degrees; the work is spread across
       frames so the map is never rebuilt in one visible stall. */
    this.shadows = new TerrainShadows(this.field);

    /* Work out where the sun was when the satellite took the picture, so its
       shading can be divided back out. Costs a few hundred milliseconds once,
       at boot, and is the difference between the game's lighting being the
       only lighting and it being the second one. */
    p(0.88, "Reading the light in the imagery");
    this.tryDelight();

    p(0.90, "Placing the route");
    this.world = new World(this.field, this.hud.el.labels);
    this.world.snapToGround();
    this.world.buildBoulders();
    this.hud.bindMapPois(this.world.pois);
    this.hud.bindMapRoute(ROUTE);
    this.hud.onFastTravel = (poi) => {
      /* The full relocation, not a bare placeAt — copied from the helicopter
         lift-out, which is the one path that already teleports correctly.
         Without these, the follow windows (near DEM, ultra imagery, the
         crevasse field) are still centred kilometres away. */
      this.player.placeAt(poi.x, poi.z, this.player.yaw);
      this.field.update(poi.x, poi.z);
      this.imagery.update(poi.x, poi.z);
      this.glacier.update(poi.x, poi.z, true);
      this.terrain.invalidate();
      this.reached.add(poi.id);
      this.hud.notify(`Travelled to ${poi.name}.`);
    };
    this.world.buildRoute();
    /* Gio's ground: each hazard area warns once, in the guide's voice, as
       the player walks into it — the replacement for the retired random
       hazard events. Zones anchor to the POIs they describe. */
    this.guideZones = [];
    const zone = (namePat, r, msg) => {
      const poi = this.world.pois.find((p) => namePat.test(p.name));
      if (poi) this.guideZones.push({ x: poi.x, z: poi.z, r, msg, fired: false });
    };
    zone(/Khumbu Icefall/i, 420,
      "Seracs stand over this whole section and they do not announce themselves. Clip the line, keep moving, and do not stop under the blue ice.");
    zone(/Popcorn/i, 260,
      "The Popcorn Field. Snow bridges here fail under the second climber, not the first. Probe before you commit \u2014 SPACE \u2014 and stay roped.");
    zone(/Western Cwm|Valley of Silence/i, 480,
      "Avalanche fans run off Nuptse right across the Cwm. If the snowpack speaks \u2014 a deep whumpf \u2014 you move downhill, immediately.");
    zone(/Camp III/i, 420,
      "Rockfall comes down the Lhotse Face all afternoon once the sun has been on it. Helmet on, stay in the rope line, do not linger.");
    zone(/South Col/i, 420,
      "Above the Col you are dying, just slowly. The turn-around time matters more than the summit does. Watch the bottle, watch the clock.");
    zone(/Balcony/i, 260,
      "The Balcony. The wind owns this ridge \u2014 if it rises past a hundred, the mountain is closed today, whatever the summit looks like.");
    zone(/South Summit/i, 260,
      "Cornice line ahead overhangs the Kangshung face by metres. Stay on the rock side of the crest \u2014 the snow side is air.");
    /* Camp arrivals, in the same voice. */
    zone(/^Base Camp$/i, 140,
      "Base Camp. Eat, drink, sort your kit here \u2014 nothing above this line forgives improvisation.");
    zone(/^Camp I$/i, 130,
      "Camp One, top of the Icefall. The worst objective danger is below you now. Rest \u2014 then move before the sun softens everything.");
    zone(/^Camp II/i, 140,
      "Camp Two \u2014 Advanced Base. The Cwm cooks by noon and freezes an hour after shadow. This is the last comfortable sleep on the mountain.");
    zone(/^Camp III/i, 130,
      "Camp Three, hanging on the Face. Stay clipped even at the tents \u2014 people have rolled out of this camp.");
    zone(/Camp IV/i, 140,
      "Camp Four. Summit night starts here: sleep if you can, leave before midnight, and agree your turn-around before you stand up.");
    this.world.onOpen = (poi) => this.hud.showPoiCard(poi);
    this.scene.add(this.world.group);

    this.survival = new Survival();
    this.player = new Player(this.field, this.glacier, this.survival);
    this.scene.add(this.player.avatar);

    this.director = new Director(this.field, this.weather, this.glacier, this.survival);
    this.scene.add(this.director.group);
    this.climbers = new Climbers(this.field, this.world);
    this.scene.add(this.climbers.group);

    /* The banding diagnostic. Always installed, costs nothing until called:
       the artifact it hunts has never reproduced on this machine, so the
       measurement has to be runnable on the one that has it. */
    installDiag(this);

    if (BARE_MAP) {
      const u = this.terrain.uniforms;
      u.debugMode.value = 2;        // raw draped imagery, unlit
      /* Detail off in this mode, and it is not a stylistic choice — it does
         nothing here. The snow and rock materials work by perturbing the
         surface NORMAL, and the unlit path returns the albedo before any
         lighting term runs, so a perturbed normal has nothing to act on.
         Measured: switching all three on changed foreground sharpness by a
         factor of exactly 1.00. Giving the foreground real sub-metre
         structure needs a lighting term in this path, which is a change to
         the look, not a dial. */
      /* Zero, all three. The sastrugi/grain block runs BEFORE the map path's
         early return and its ripple pattern is advected by windPhase every
         frame — with these dials up, the ground carries a moving wind
         animation even in tiles-only mode. That is the "separate wind
         animation" that kept surviving: not a particle system, a shader term.
         The dials feed nothing else this mode uses. */
      u.microRelief.value = 0;
      u.rockDetail.value = 0;
      u.snowDetail.value = 0;
      this.postfx.enabled = false;  // direct render — no AO, bloom or grade
      this.precip.points.visible = false;
      this.spindrift.lines.visible = false;
      this.glacier.group.visible = false;         // seracs and ice props
      if (this.world.campTents) this.world.campTents.visible = false;
    }

    /* Stand the player at Base Camp, facing the way the route goes — but a
       few metres short of the marker, so the first thing they see is the
       camp rather than the inside of its prayer flags. */
    const bc = llToLocal(ROUTE[0].lat, ROUTE[0].lon);
    const c1 = llToLocal(ROUTE[3].lat, ROUTE[3].lon);
    const yaw = Math.atan2(c1.x - bc.x, -(c1.z - bc.z));
    this.player.placeAt(bc.x - Math.sin(yaw) * 14, bc.z + Math.cos(yaw) * 14, yaw);
    this.reached.add("bc");
    this.camera = this.player.camera;

    p(0.96, "Cutting the Icefall");
    this.glacier.update(bc.x, bc.z, true);
    this.glacier.bindTerrain(this.terrain.uniforms);
    this.terrain.update(bc.x, bc.z, 400);

    this.resize();
    addEventListener("resize", () => this.resize());
    this.bindInput();
    p(1, "Ready");
  }

  /**
   * Estimate the imagery's own sun, and divide it back out.
   *
   * Retried rather than done once at boot, because it needs the *mid* tier —
   * z14, 8.4 m/px — and that tier follows the player, so `Imagery.boot()`
   * does not build it. The first version ran at boot, silently fell back to
   * the 67 m/px far tier, correlated at less than 0.3 against a normal
   * sampled over 24 m, and disabled itself. The symptom was de-lighting that
   * worked in one session and not the next, depending on which tiers had
   * landed. It gives up after a while rather than retrying forever.
   */
  tryDelight() {
    if (this.captureSun || this._delightTries > 25) return;
    this._delightTries = (this._delightTries || 0) + 1;
    const cap = estimateCaptureSun(this.field, this.imagery);
    // Below about 0.3 the sweep has not found a sun, it has found noise, and
    // de-lighting on that basis is worse than leaving the picture alone.
    if (!cap || cap.correlation <= 0.30) return;
    this.captureSun = cap;
    const u = this.terrain.uniforms;
    u.captureSun.value.copy(cap.dir);
    u.meanAlbedo.value = cap.meanAlbedo;
    /* De-lighting is OFF by default, and this is why.
     *
     * It divides the imagery by `delightFloor + (1-floor)*dot(vNormal, captureSun)`
     * — a function of the surface normal — to remove the sun that was shining
     * when the satellite took the picture. The idea is sound and the estimator
     * works, but the normal it divides by comes from central differences on an
     * elevation model whose real resolution is 17 m. That normal is *stepped*
     * across a slope, and dividing by a stepped function does not remove
     * shading, it amplifies the steps: bands of constant dot(N, captureSun),
     * up to 3.1x apart where the floor clamps, running down the fall line.
     * Vertical stripes on every mid-distance face.
     *
     * Measured on the reporting machine with everything else held still:
     * turning this off dropped the banding 28% while all eight other
     * candidates moved it by 0%, against a 0.4% spread between runs.
     *
     * The correlation behind it is only ~0.38 — a weak fit to be multiplying
     * the entire map by. So the estimate is still made, because the capture
     * sun direction is genuinely needed elsewhere (photoclino.js inverts
     * brightness for shape with it, and the micro-relief pass projects onto
     * it), but the division is not applied. Set `delightAmount` by hand if you
     * want to look at it. */
    u.delightAmount.value = 0;
    this.survival?.note?.(
      `Capture sun found: ${cap.azimuth}° / ${cap.altitude}° elevation, r=${cap.correlation.toFixed(2)}.`);
    // The same estimate that lets us divide the imagery's lighting out is what
    // lets us invert it for shape. Nothing to recover until it lands.
    this.refreshDetail();
  }

  /**
   * Rebuild the photoclinometric relief when its source imagery has moved.
   *
   * Cheap enough to attempt whenever the near tier is rebuilt — the field is a
   * few passes over one canvas and it early-outs if nothing has changed — but
   * it must not run before the capture sun is known, because the whole
   * inversion is "given that the light came from over there, this brightness
   * means that slope".
   */
  refreshDetail() {
    /* ── OFF. The recovered relief streaks, and here is the mechanism. ─────
     *
     * photoclino.js integrates the brightness residual ALONG THE SUN AZIMUTH
     * with a leaky accumulator: one sweep, one ray per line, each ray reading
     * only what it has already passed over. Adjacent rays are integrated
     * independently, so any bias — a shadow edge, a patch of rock, a clamp —
     * accumulates down its own ray and not its neighbour's. The result is
     * streaks running along a FIXED COMPASS BEARING, the capture sun's 135°,
     * regardless of what the ground does. That is what the lines are: not a
     * feature boundary, but the boundary between one integration ray and the
     * next.
     *
     * The blur meant to suppress exactly this is radius 1. It needed to be an
     * order of magnitude wider, or the integration needed to be a proper 2D
     * Poisson solve with a smoothness term across the sweep rather than a
     * one-pass sweep at all.
     *
     * Measured with the terrain in SHAPE-only mode (flat grey albedo, so only
     * geometry and normals can show): removing this — both the shader
     * displacement and the CPU heights that feed the vertex normals —
     * dropped the banding 48%.
     *
     * Note what that number required: `detailOn = 0` alone reports 0%, because
     * it disables only the shader half while `Heightfield.height` keeps adding
     * the same field to the vertex positions and therefore to the normals.
     * Every "recovered relief off" reading in every diagnostic run today was
     * measuring a half-disabled system, which is worse than not measuring it.
     *
     * The estimate still runs — the capture sun direction is used elsewhere —
     * but nothing is displaced. Re-enable by deleting this return once the
     * integration is a solve rather than a sweep. */
    if (!PHOTOCLINO_ON) return;
    if (!this.captureSun || !this.photoclino) return;
    const t0 = performance.now();
    const first = !this.field.detail;
    if (!this.photoclino.update(this.imagery, this.captureSun.dir)) return;
    this.field.detail = this.photoclino;          // the ground follows the picture
    this.photoclino.bind(this.terrain.uniforms);

    /* Everything standing on the mountain was placed against a surface that
       has just moved under it by up to a few metres. The camps were pitched at
       boot, before the capture sun was known and so before any of this
       existed; left alone, a third of Base Camp floats and the rest is buried.
       Re-snapping is cheap and idempotent — it rebuilds the tent instances
       from the same seeds — so it happens once, when the relief first lands. */
    if (first) this.world?.snapToGround();
    const s = this.photoclino.stats;
    this.survival?.note?.(
      `Relief recovered from imagery: ${s.rms.toFixed(2)} m rms, peak ${s.peak.toFixed(2)} m ` +
      `(${s.px}px, ${(performance.now() - t0).toFixed(0)} ms).`);
  }

  /**
   * The canvas must never disagree with the display grid.
   *
   * This used to be `setPixelRatio(min(devicePixelRatio, quality.maxPixelRatio))`,
   * which on any high-DPI screen is a trap. At devicePixelRatio 2 and quality
   * "high" the canvas gets 1.5 device pixels per CSS pixel while the monitor
   * has 2, so the browser rescales the finished frame by 4/3 on its way to the
   * screen. A non-integer rescale of a detailed image beats against the pixel
   * grid and lays down evenly spaced vertical bands — 35 px apart for a 1.029
   * ratio, which is exactly the spacing that kept showing up.
   *
   * The reason this survived every test I ran is that the resampling happens
   * *after* the drawing buffer. `gl.readPixels` reads the buffer, so it is
   * structurally incapable of seeing the artifact, and it reported a clean
   * render every time while the screen was striped. On a devicePixelRatio of 1
   * the clamp is inert, which is why it never reproduced here.
   *
   * So the pixel ratio is no longer a quality knob. The canvas is always
   * exactly devicePixelRatio, and the cost that `maxPixelRatio` used to buy is
   * taken out of the *internal* render target instead, where we own the
   * upsample and it is a single filtered blit rather than a compositor
   * rescale. The pixel budget is unchanged; only the place it is spent moves.
   *
   * Quality "low" has no chain to scale (`post: false` is a direct render), so
   * there the ratio is snapped to an exact integer submultiple of the device
   * ratio. An integer downscale maps whole pixels to whole pixels and cannot
   * beat; only fractional ratios can.
   */
  resize() {
    const w = innerWidth, h = innerHeight;
    const dpr = devicePixelRatio || 1;
    const budget = Math.min(1, (this.quality.maxPixelRatio ?? 2) / dpr);

    this.renderer.setPixelRatio(
      this.quality.post ? dpr : dpr / Math.max(1, Math.round(1 / budget)));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = this.binoculars ? 16 : RENDER.fov;
    this.camera.near = RENDER.near;
    this.camera.far = RENDER.far;
    this.camera.updateProjectionMatrix();
    const db = this.renderer.getDrawingBufferSize(_bufSize);
    this.postfx.setSize(db.x, db.y, this.quality, this.quality.post ? budget : 1);
  }

  /** The map look mirrors the reference viewer: neutral, no vignette, full
   *  saturation. "cinematic" restores the old graded look. */
  setLook(name) {
    const applied = this.postfx.setLook(name);
    this.hud.notify(`Look: ${applied}`);
    return applied;
  }

  setQuality(name) {
    this.quality = QUALITY[name] || QUALITY.high;
    this.qualityIndex = this.qualityNames.indexOf(this.quality.name);
    this.terrain.uniforms.snowDetail.value = this.quality.snowDetail;
    this.terrain.uniforms.rockDetail.value = this.quality.rockDetail ?? 1;
    this.resize();
    this.hud.notify(`Graphics: ${this.quality.name}`);
  }

  /* ── Input ───────────────────────────────────────────────────────────
     Pointer lock for looking; everything else is a key. The wheel and the
     journal both release the lock, because a radial menu you cannot point at
     is not a radial menu. */

  /** Pointer lock, without the console full of unhandled rejections.
   *  `requestPointerLock` returns a promise in current Chrome and it rejects
   *  whenever the request is not allowed — an embedded document, a frame that
   *  has not been clicked, a browser that refuses on the second attempt
   *  inside a second. None of those is an error worth reporting; the game
   *  simply stays in look-by-drag. */
  lockPointer() {
    const r = this.canvas.requestPointerLock?.();
    if (r && typeof r.catch === "function") r.catch(() => {});
  }

  bindInput() {
    this.keys = {};
    const down = (e) => {
      if (e.repeat) { this.keys[e.code] = true; return; }
      this.keys[e.code] = true;
      this.onKey(e);
    };
    addEventListener("keydown", down);
    addEventListener("keyup", (e) => { this.keys[e.code] = false; });

    this.canvas.addEventListener("click", () => {
      if (!this.hud.wheelOpen && !this.hud.journalOpen && !this.hud.readerOpen && this.running) {
        this.lockPointer();
      }
    });
    addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.player.look(e.movementX, e.movementY);
    });
    addEventListener("wheel", (e) => {
      if (this.hud.wheelOpen) {
        this.hud.wheelMove(e.deltaY > 0 ? 1 : -1, this.survival);
        e.preventDefault();
      } else if (this.player.thirdPerson) {
        this.player.camDist = Math.max(2.4, Math.min(11, this.player.camDist + e.deltaY * 0.006));
      }
    }, { passive: false });
    addEventListener("blur", () => { this.keys = {}; });
  }

  onKey(e) {
    // Backquote toggles the whole control bar, mirroring the Etna explorer's
    // collapsible chrome: the mountain first, the buttons on request.
    if (e.code === "Backquote") { this.hud.setNavHidden(!this.hud.navHidden); return; }
    /* Binoculars: B narrows the FOV onto the centre of view — which IS the
       optical definition of zoom — and drops the twin-circle mask over it.
       Look sensitivity scales down with the zoom, or a 62->16 degree jump
       makes the mouse feel four times too fast through the glasses. */
    /* M is the map — the navigation hub gets the mnemonic key, and the
       label toggle it used to hold moves to T. O cycles the regulator
       through the flows the wheel offers, so gas is one keystroke: off
       when you top out, 2 L/min back on the ridge, without opening a menu. */
    // U folds the compass and info bar into the footer, same as the arrow tab.
    if (e.code === "KeyU") { this.hud.setBarsHidden(!this.hud.barsHidden); return; }
    if (e.code === "KeyM") { this.hud.toggleMap(); return; }
    if (e.code === "Escape" && this.hud.mapOpen) { this.hud.toggleMap(); return; }
    if (e.code === "KeyO") {
      const flows = [0, 1, 2, 4];
      const cur = flows.indexOf(this.survival.o2Flow);
      const msg = this.survival.setFlow(flows[(cur + 1) % flows.length]);
      if (msg) this.hud.notify(msg);
      return;
    }
    if (e.code === "KeyB") { this.toggleBinoculars(); return; }

    const c = e.code;
    if (c === "Escape") {
      if (this.hud.poiCardOpen) return this.hud.closePoiCard();
      if (this.hud.readerOpen) return this.hud.closeReader();
      if (this.hud.journalOpen) return this.hud.toggleJournal(false);
      document.exitPointerLock?.();
      return;
    }
    if (!this.running) return;

    if (c === "Tab") { e.preventDefault(); this.hud.setNavHidden(!this.hud.navHidden); return; }
    if (c === "KeyJ") return this.tool("journal");
    if (c === "KeyQ") { this.hud.openWheel(); document.exitPointerLock?.(); return; }
    if (this.hud.wheelOpen) {
      if (c === "ArrowLeft") return this.setFlow(this.survival.o2Flow - 1);
      if (c === "ArrowRight") return this.setFlow(this.survival.o2Flow + 1);
      if (c === "ArrowUp") return this.hud.wheelMove(-1, this.survival);
      if (c === "ArrowDown") return this.hud.wheelMove(1, this.survival);
      if (c === "Enter" || c === "Space") {
        const key = this.hud.wheelSelected(this.survival);
        const line = key && this.survival.use(key);
        if (line) this.hud.notify(line);
        return;
      }
    }
    if (c === "KeyV") return this.tool("third");
    if (c === "KeyN") return this.tool("route");
    if (c === "KeyG") return this.tool("quality");
    if (c === "KeyR") return this.tool("rope");
    if (c === "KeyL") return this.tool("torch");
    if (c === "KeyF") return this.fireFlare();
    if (c === "KeyE") return this.interact();
    if (c === "KeyH") return this.tool("help");
    if (c === "KeyT") return this.tool("labels");
  }

  /**
   * Every toggle, in one place.
   *
   * The control bar's buttons and the keyboard shortcuts both come through
   * here, so there is exactly one implementation of "turn the torch on" and
   * no way for the lit state of a button to drift from the thing it claims
   * to control.
   */
  toggleBinoculars() {
    this.binoculars = !this.binoculars;
    this.camera.fov = this.binoculars ? 16 : RENDER.fov;
    this.camera.updateProjectionMatrix();
    this.player.lookScale = this.binoculars ? 16 / RENDER.fov : 1;
    this.hud.setBinoculars(this.binoculars);
  }

  tool(id) {
    switch (id) {
      case "third":
        this.player.thirdPerson = !this.player.thirdPerson;
        return this.hud.notify(this.player.thirdPerson ? "Third person" : "First person");
      case "route":
        this.showRoute = !this.showRoute;
        this.world.routeGroup.visible = this.showRoute;
        return this.hud.notify(this.showRoute
          ? "Fixed line shown."
          : "Fixed line hidden. You are navigating on your own now.", this.showRoute ? "info" : "warn");
      case "labels":
        this.showLabels = !this.showLabels;
        this.hud.el.labels.style.display = this.showLabels ? "" : "none";
        return;
      case "rope":
        this.survival.roped = !this.survival.roped;
        return this.hud.notify(this.survival.roped
          ? "Tied in. Slower, and the crevasses stop being fatal."
          : "Untied. Faster, and now a snow bridge is the whole story.",
          this.survival.roped ? "good" : "warn");
      case "torch":
        if (this.lamp.battery <= 0) return this.hud.notify("The torch is dead.", "warn");
        this.lamp.on = !this.lamp.on;
        this.audio.cue("chime");
        return this.hud.notify(this.lamp.on
          ? "Head torch on. It lights about thirty metres, and nothing beyond it exists."
          : "Torch off.");
      case "items":
        if (this.hud.wheelOpen) return this.hud.closeWheel();
        this.hud.openWheel();
        return document.exitPointerLock?.();
      case "journal":
        this.hud.journalState = this.journalState();
        this.hud.toggleJournal();
        if (this.hud.journalOpen) document.exitPointerLock?.();
        return;
      case "map":
        return this.hud.toggleMap();
      case "binoculars":
        return this.toggleBinoculars();
      case "oxygen": {
        const flows = [0, 1, 2, 4];
        const cur = flows.indexOf(this.survival.o2Flow);
        const msg = this.survival.setFlow(flows[(cur + 1) % flows.length]);
        if (msg) this.hud.notify(msg);
        return;
      }
      case "quality":
        this.qualityIndex = (this.qualityIndex + 1) % this.qualityNames.length;
        return this.setQuality(this.qualityNames[this.qualityIndex]);
      case "help":
        return this.toggleControls();
    }
  }

  setFlow(f) {
    const clamped = Math.max(0, Math.min(4, f));
    const line = this.survival.setFlow(clamped);
    if (line) this.hud.notify(line);
  }

  /* ── Verbs ───────────────────────────────────────────────────────────*/

  interact() {
    const p = this.player.pos;

    if (this.player.state === STATE.HANGING) return;

    const climber = this.climbers.nearest(p.x, p.z, 14);
    if (climber) {
      const line = this.climbers.help(climber, this.survival);
      if (line) { this.hud.say(line, 11); this.survival.note(line); }
      return;
    }

    const poi = this.world.nearest(p.x, p.z, 40);
    if (poi) {
      if (poi.camp && !this.reached.has(poi.id)) this.arriveAtCamp(poi);
      else if (poi.camp) this.restAt(poi);
      else this.hud.showReader(poi);
      return;
    }
  }

  arriveAtCamp(poi) {
    this.reached.add(poi.id);
    this.audio.cue("arrive");
    this.hud.cinematic = 1;
    setTimeout(() => { this.hud.cinematic = 0; }, 5200);
    this.hud.notify(`${poi.name.toUpperCase()} — ${Math.round(poi.published ?? poi.y).toLocaleString()} m`, "good");
    this.hud.say(poi.text, 14);
    this.survival.note(`Reached ${poi.name}.`);
    this.survival.standing += 1;
    if (poi.id === "summit") return this.endGame("summit");
    this.restAt(poi, true);
  }

  restAt(poi, arriving = false) {
    const hours = arriving ? 8 : 4;
    this.survival.restAtCamp(poi.published ?? poi.y, hours);
    this.date = new Date(this.date.getTime() + hours * 3600000);
    this.weather.update(hours, 0);
    this.hud.notify(`${hours} hours at ${poi.name}. ${this.weather.label.toLowerCase()} outside.`);
    if (this.survival.inventory.food > 0 && this.survival.energy < 70) this.survival.use("food");
  }

  /**
   * The flare. Two things, and the second one is the interesting one.
   *
   * It is a genuine call for help — and in bad weather nobody can fly, which
   * is true of this mountain: a helicopter cannot land above about 6,000 m
   * and will not fly into cloud at all. It is also the way out for a player
   * who has had enough: a lift to the next camp up, at the cost of having
   * been carried there. The game does not hide that cost and does not punish
   * it either; it just declines to call it a summit.
   */
  fireFlare() {
    if (this.survival.inventory.flare <= 0) {
      return this.hud.notify("No flares left.", "warn");
    }
    this.survival.inventory.flare--;
    this.stats.flares++;
    this.audio.cue("flare");
    this.hud.flash("rgba(255,90,60,0.45)");

    const vis = this.weather.visibility;
    const alt = this.player.pos.y;
    const canFly = vis > 3000 && this.weather.windAt(alt) < 16 && alt < 6300;

    if (!canFly) {
      this.hud.say(vis <= 3000
        ? "The flare goes up and vanishes into the cloud about forty metres above your head. Nobody is flying in this."
        : alt >= 6300
        ? "Red light, and the whole Cwm lit up for four seconds. But no helicopter lands at this height — the air will not hold one. Whoever saw it will send people on foot, and they are a day away."
        : "The flare goes up and the wind takes it sideways. Nothing is coming while it blows like this.", 12);
      this.hud.notify("Signal seen by nobody", "bad");
      return;
    }

    const next = this.nextCamp();
    this.hud.say(
      "Red light over the glacier, and twenty minutes later the sound of a B3 coming up the valley. " +
      "The pilot will not shut down — one skid on the snow, and you get in.", 13);
    this.hud.notify("LIFTED OUT", "warn");
    this.survival.standing -= 2;
    this.stats.lifted = (this.stats.lifted || 0) + 1;

    setTimeout(() => {
      if (!next) return;
      const l = { x: next.x, z: next.z };
      this.player.placeAt(l.x, l.z, this.player.yaw);
      this.reached.add(next.id);
      this.field.update(l.x, l.z);
      this.imagery.update(l.x, l.z);
      this.glacier.update(l.x, l.z, true);
      this.terrain.invalidate();
      this.survival.restAtCamp(next.published ?? next.y, 6);
      this.date = new Date(this.date.getTime() + 6 * 3600000);
      this.hud.notify(`Set down at ${next.name}. You did not walk here.`, "warn");
      this.survival.note(`Flown to ${next.name}. Did not walk it.`);
    }, 4200);
  }

  nextCamp() {
    for (const c of this.world.camps) if (!this.reached.has(c.id)) return c;
    return null;
  }

  /* ── Loop ────────────────────────────────────────────────────────────*/

  start() {
    this.running = true;
    this.stats.started = Date.now();
    this.audio.start();
    this.clock.getDelta();
    this.frame();
  }

  /** One frame, with the elapsed time supplied rather than measured. The
   *  loop calls it; a test harness calls it too, because rAF does not fire
   *  in a tab that is not compositing and a game that can only be checked by
   *  a human watching it is a game that does not get checked. */
  tick(raw) {
    const slow = this.hud.wheelOpen ? 0.22 : 1;
    this.slowmo += (slow - this.slowmo) * Math.min(1, raw * 8);
    const dtReal = raw * this.slowmo;
    const dtSim = dtReal * TIME_SCALE;
    if (!this.hud.journalOpen && !this.ended) this.step(dtReal, dtSim);
    this.postfx.render(this.scene, this.camera, this.quality, performance.now() / 1000);
  }

  frame = () => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    this.tick(Math.min(0.1, this.clock.getDelta()));
  };

  step(dtReal, dtSim) {
    const P = this.player, S = this.survival;

    /* ── Clocks ── */
    this.date = new Date(this.date.getTime() + dtSim * 1000);
    const hourLocal = ((this.date.getUTCHours() + this.date.getUTCMinutes() / 60
                        + NEPAL_UTC_OFFSET_H) % 24 + 24) % 24;
    this.weather.update(dtSim / 3600, dtReal);
    this.director.hourLocal = hourLocal;

    /* ── Environment at the player ── */
    const alt = P.pos.y;
    const windMs = this.weather.windAt(alt);
    const tempC = this.weather.tempAt(alt, hourLocal);
    const chillC = this.weather.windChill(tempC, windMs);
    const windDir = this.weather.windVector(_wind);
    const slopeDeg = this.field.slope(P.pos.x, P.pos.z, 8);
    const nearCamp = this.world.camps.find((c) => Math.hypot(c.x - P.pos.x, c.z - P.pos.z) < 22);

    /* ── Input → intent ── */
    const k = this.keys;
    const locked = this.hud.wheelOpen || this.hud.journalOpen || this.hud.readerOpen || this.hud.mapOpen;
    P.input.f = locked ? 0 : (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    P.input.r = locked ? 0 : (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);

    /* Keyboard look, arrows, held-rate. Not a luxury: Ubuntu's libinput
       disables the touchpad while any key is down ("disable while typing"),
       so on a stock laptop the mouse look dies exactly while W is held —
       "we cannot look around and move at the same time". Arrows give look
       and movement separate devices. Only when the item wheel is closed;
       inside it the arrows adjust oxygen flow, as documented. */
    if (!this.hud.wheelOpen && !locked) {
      const lr = (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0);
      const ud = (k.ArrowUp ? 1 : 0) - (k.ArrowDown ? 1 : 0);
      if (lr || ud) {
        const rate = 2.1 * dtReal * (this.player.lookScale || 1);
        P.yaw += lr * rate;
        P.pitch = Math.max(-(Math.PI / 2 - 0.02),
                  Math.min(Math.PI / 2 - 0.02, P.pitch + ud * rate * 0.65));
      }
    }
    P.input.run = !!k.ShiftLeft || !!k.ShiftRight;
    P.input.crouch = !!k.ControlLeft;
    P.prusikInput = !!k.Space;
    this.director.digging = !!k.Space;

    if (!locked && !this.hud.wheelOpen && k.Space && P.state === STATE.WALKING && !this.director.buried) {
      // Probing: an axe shaft into the snow ahead tells you whether there is
      // anything under it. It is what you do instead of finding out.
      this.probe();
    }

    const prev = _prev.copy(P.pos);
    P.update(dtReal, { windMs, windDir, snowDepth: this.weather.snowFall, hourLocal });
    const moved = Math.hypot(P.pos.x - prev.x, P.pos.z - prev.z);
    this.stats.distance += moved;
    if (P.pos.y > prev.y) this.stats.climbed += P.pos.y - prev.y;

    /* ── The body ── */
    S.update(dtSim, {
      altitude: alt, speed: P.speed, slopeDeg,
      tempC, windMs, weather: this.weather,
      resting: P.speed < 0.05,
      sheltered: !!nearCamp || P.state === STATE.HANGING,
      sunUp: this.sky.sun.altitude > 0,
    });

    /* Gio watches the ground the player is on. */
    /* The first ladder is its own lesson, wherever it is met: fired when
       the player first closes on any laddered crossing. */
    if (!this._gioLadder && this.running && this.glacier.segments) {
      for (const seg of this.glacier.segments) {
        if (!seg.hasLadder) continue;
        if (Math.hypot(P.pos.x - seg.x, P.pos.z - seg.z) < 26) {
          this._gioLadder = true;
          const ladderMsg = "First ladder. Face the rungs, points between them, both safeties clipped. It wobbles \u2014 it holds. Do not stop in the middle.";
          this.hud.guideSay(ladderMsg);
          this.survival.note("Gio \u2014 " + ladderMsg);
          break;
        }
      }
    }
    if (this.guideZones && this.running) {
      for (const z of this.guideZones) {
        if (z.fired) continue;
        if (Math.hypot(P.pos.x - z.x, P.pos.z - z.z) < z.r) {
          z.fired = true;
          this.hud.guideSay(z.msg);
          this.survival.note("Gio \u2014 " + z.msg);
          break;
        }
      }
    }

    /* ── Streaming ── */
    this.field.update(P.pos.x, P.pos.z);
    /* The route is a drape: built from the heightfield, it is only as
       true as the data it sampled, and at boot that is the coarse tier.
       When finer elevation lands the ground moves and the rope used to
       stay behind — floating over dips, buried in rises. Rebuild it the
       same way the terrain rebuilds itself: once the data has been quiet
       for a moment. */
    if (this.field.version !== this._routeFieldV) {
      this._routeFieldV = this.field.version;
      this._routeRebuildAt = performance.now() + 600;
    }
    if (this._routeRebuildAt && performance.now() > this._routeRebuildAt) {
      this._routeRebuildAt = 0;
      this.world.buildRoute();
      this.world.routeGroup.visible = this.showRoute;
    }
    this.imagery.update(P.pos.x, P.pos.z);
    this.terrain.update(P.pos.x, P.pos.z);
    if (this.glacier.update(P.pos.x, P.pos.z)) this.glacier.bindTerrain(this.terrain.uniforms);
    this.glacier.tintTo(this.sky.skyLight);

    /* ── Light ── */
    this.sky.update(this.date, this.weather.cloud, performance.now() / 1000);
    const u = this.terrain.uniforms;

    // Shadows follow the sun, and the sun moves eight times as fast as it
    // does outside. Budget kept small: this is on the main thread.
    // Once every couple of seconds until it lands; see tryDelight.
    if (!this.captureSun) {
      this._delightAt = (this._delightAt || 0) - dtReal;
      if (this._delightAt <= 0) { this._delightAt = 2; this.tryDelight(); }
    } else {
      /* The relief is tied to the near imagery tier, which re-centres every
         480 m of walking. Checked on a slow timer rather than per frame: the
         update early-outs on an unchanged tier, but the check itself should
         not be in the hot path either. */
      this._detailAt = (this._detailAt || 0) - dtReal;
      if (this._detailAt <= 0) { this._detailAt = 1.5; this.refreshDetail(); }
    }

    /* ── Terrain self-shadowing: OFF. This was the vertical lines. ────────
     *
     * Confirmed by A/B on magnified framebuffer crops: with shadowsOn the
     * distant faces carry evenly spaced vertical needles in a band; with it
     * off, the same frame is smooth. The mechanism is the horizon map's
     * resolution: each 33.6 m texel stores the elevation angle of the highest
     * FOREGROUND ridge toward the sun, from a 32-step geometric ray march.
     * Across a sharp ridge crest, adjacent texels' marches hit or miss the
     * crest and their horizons disagree by more than the shader's 0.024
     * penumbra — so along the shadow terminator the face alternates lit /
     * shadowed, texel by texel. Needles: ~20 px apart at 3 km (33.6 m), in a
     * band (the terminator), gated by the foreground hills (they ARE the
     * occluder), worst at low sun. Every property of the reported artifact.
     *
     * It is also why the report resisted a day of bisection. The one clean
     * measurement of the flag came back 0% — taken pre-dawn, when the direct
     * term the shadow multiplies was already zero. A toggle proves nothing
     * when the thing it gates is off.
     *
     * The imagery already carries the mountain's real shadows, baked in by
     * the sun that was shining at capture — the reference viewer this game is
     * measured against ships exactly that and no more. Re-lighting on top of
     * it needs a horizon map an order of magnitude finer (16-bit, supersampled
     * march, wide penumbra) to not stripe; until that exists, honest lighting
     * is N·L and the photograph. The machinery stays for that day. */
    this.shadows.update(this.sky.sun, P.pos.x, P.pos.z, this.quality.shadowBudgetMs);
    this.shadows.bind(u, this.sky.sun.altitude);
    u.shadowsOn.value = this.quality.shadows ? 1 : 0;
    u.sunDir.value.copy(this.sky.sun.dir);
    u.sunColor.value.copy(this.sky.sun.color);
    u.skyColor.value.copy(this.sky.skyLight);
    u.fogColor.value.copy(this.sky.fog);
    u.whiteout.value = this.weather.whiteout;
    u.snowFall.value = this.weather.snowFall;
    u.fogDensity.value = 1 / Math.max(700, this.weather.visibility * 0.85);
    u.time.value += dtReal;
    this.terrain.setCamera(this.camera);

    this.sun.position.copy(this.sky.sun.dir).multiplyScalar(9000).add(this.camera.position);
    this.sun.target.position.copy(this.camera.position);
    this.sun.target.updateMatrixWorld();
    this.sun.color.copy(this.sky.sun.color);
    /* This lights the props — markers, seracs, climbers, crevasse walls —
       not the terrain, which does its own. Kept low: it was 2.2, which
       filled the inside of every crevasse with skylight and turned a
       forty-metre slot into a grey groove. Nothing gets into a crevasse. */
    this.ambient.color.copy(this.sky.skyLight).multiplyScalar(1.15);
    this.scene.fog = this.scene.fog || new THREE.FogExp2(0xffffff, 0.0001);
    this.scene.fog.color.copy(this.sky.fog);
    this.scene.fog.density = 1 / Math.max(700, this.weather.visibility * 0.9);

    /* ── Night, and the torch ───────────────────────────────────────────
       Snow under stars alone is about as bright as a lit room is dark; under
       a moon it is genuinely walkable. Without a floor here "night" means a
       black screen, which is not what night on a glacier is. */
    const sunAlt = this.sky.sun.altitude;
    const darkness = Math.min(1, Math.max(0, (-sunAlt - 2) / 10));
    _night.setRGB(0.16, 0.21, 0.34)
      .multiplyScalar(darkness * (this.sky.nightLight ?? 0.1) * (1 - this.weather.cloud * 0.75));
    u.nightSky.value.copy(_night);

    if (this.lamp.on && this.lamp.battery > 0) {
      // A head torch is a few hours on high. It is also the only reason to
      // ever turn one off, so the drain has to be felt.
      this.lamp.battery = Math.max(0, this.lamp.battery - dtSim / 3600 * 11);
      if (this.lamp.battery === 0) {
        this.lamp.on = false;
        this.hud.notify("The torch fades out.", "bad");
      }
    }
    const lampLevel = this.lamp.on ? 0.35 + 0.65 * Math.min(1, this.lamp.battery / 45) : 0;
    u.lampIntensity.value += (lampLevel * 0.95 - u.lampIntensity.value) * Math.min(1, dtReal * 6);
    u.lampPos.value.copy(this.camera.position);
    this.camera.getWorldDirection(u.lampDir.value);
    this.lamp.light.visible = u.lampIntensity.value > 0.01;
    this.lamp.light.intensity = u.lampIntensity.value * 5;
    this.lamp.light.position.copy(this.camera.position);
    this.lamp.light.target.position.copy(this.camera.position).addScaledVector(u.lampDir.value, 20);
    this.lamp.light.target.updateMatrixWorld();

    /* Weather and snow VISUALS. Skipped entirely in bare map mode — not just
       hidden, because Precipitation.update sets its own `visible` from the
       snowfall every frame and would quietly re-enable itself the first time
       it snows. The weather itself still runs above: wind still pushes, cold
       still bites, the forecast still matters. It just is not drawn. */
    if (!BARE_MAP) {
      this.snow.update(P, dtReal, dtSim, windMs, this.weather.snowFall, windDir);
      this.snow.bind(u);
      u.windPhase.value += Math.min(windMs, 30) * dtSim * 0.0016;
      u.windAxis.value.set(windDir.x, windDir.z).normalize();


      this.precip.update(this.camera, this.weather, dtReal, alt, this.renderer.getPixelRatio());
      this.spindrift.update(this.camera, this.weather, dtReal,
        this.field.height(this.camera.position.x, this.camera.position.z), alt);

    }

    /* ── Hazards and people ── */
    this.director.update(dtSim, dtReal, P, this.renderer.getPixelRatio());
    this.climbers.update(dtReal, P, this.world);

    this.handleEvents();

    /* ── Arrival ── */
    if (nearCamp && !this.reached.has(nearCamp.id)) this.arriveAtCamp(nearCamp);

    /* ── HUD ── */
    const next = this.nextCamp();
    const ll = localToLL(P.pos.x, P.pos.z);
    this.hud.update(dtReal, {
      survival: S,
      altitude: alt,
      lat: ll.lat, lon: ll.lon,      // already computed above, for the rail readout
      spo2: S.spo2At(alt),
      tempC, chillC, windMs, resistance: P.resistance || 0,
      distance: this.stats.distance,
      windFrom: this.weather.windFrom,
      slopeDeg,
      heading: P.heading,
      stability: this.director.lastStability,
      buried: this.director.buried,
      clock: `${String(Math.floor(hourLocal)).padStart(2, "0")}:${String(Math.floor((hourLocal % 1) * 60)).padStart(2, "0")}`,
      seasonDay: this.weather.day,
      sunAltitude: sunAlt,
      phase: sunAlt > 6 ? "day" : sunAlt > -0.5 ? (hourLocal < 12 ? "sunrise" : "sunset")
           : sunAlt > -6 ? "twilight" : "night",
      lamp: true, lampOn: this.lamp.on, lampBattery: this.lamp.battery,
      qualityName: this.quality.name,
      standingWord: S.standing >= 6 ? "well thought of"
        : S.standing >= 2 ? "sound"
        : S.standing <= -6 ? "people have noticed"
        : S.standing <= -2 ? "questionable" : "unremarked",
      toggles: {
        third: this.player.thirdPerson,
        torch: this.lamp.on,
        rope: S.roped,
        items: this.hud.wheelOpen,
        labels: this.showLabels,
        route: this.showRoute,
        journal: this.hud.journalOpen,
        help: document.getElementById("controls")?.classList.contains("on"),
      },
      nextCamp: next,
      distanceToNext: next ? haversine(ll.lat, ll.lon, next.lat, next.lon) : 0,
      bearingToNext: next ? bearing(P.pos.x, P.pos.z, next.x, next.z) : 0,
      prompt: this.promptFor(),
    });

    this.world.updateMarkers(this.camera.position, windMs, u.time.value);
    if (this.world.routeMat) this.world.routeMat.uniforms.time.value = u.time.value;
    this.world.updateLabels(this.camera, P.pos, {
      width: innerWidth, height: innerHeight,
      maxDist: Math.max(600, Math.min(24000, this.weather.visibility)),
    });

    /* ── Sound ── */
    this.audio.update(dtReal, {
      windMs, sheltered: !!nearCamp, precip: this.weather.precip,
      distress: S.distress(alt), speed: P.speed, onSnow: true,
      o2Mask: S.o2Flow > 0 && S.bottleLitres > 0,
      rumble: this.director.avalanches.length ? 1 : 0,
    });

    if (S.dead && !this.ended) this.endGame("dead");
  }

  probe() {
    if (this._probedAt && performance.now() - this._probedAt < 900) return;
    this._probedAt = performance.now();
    const P = this.player;
    const ax = P.pos.x + Math.sin(P.yaw) * 2.4;
    const az = P.pos.z - Math.cos(P.yaw) * 2.4;
    const seg = this.glacier.at(ax, az);
    if (seg) {
      seg.probed = true;
      this.hud.notify(seg.bridged > 0.55
        ? "The shaft goes in and stops. There is a bridge here — and something under it."
        : "The shaft goes straight through. Open slot, right in front of you.", "warn");
      this.audio.cue("crack");
    } else {
      this.hud.notify("Solid.", "info");
    }
  }

  promptFor() {
    const P = this.player;
    if (this.director.buried) return `<kbd>SPACE</kbd> dig`;
    if (P.state === STATE.HANGING) return `<kbd>SPACE</kbd> prusik out — ${Math.round(P.prusik * 100)}%`;
    const c = this.climbers.nearest(P.pos.x, P.pos.z, 14);
    if (c && !c.delivered) {
      if (c.following) return `<kbd>E</kbd> let ${c.name.split(" ")[0]} rest`;
      if (c.helped && c.fate === "beyond") return `${c.name}`;
      return `<kbd>E</kbd> ${c.alive ? "help" : "look"} — ${c.name}`;
    }
    const l = this.glacier.ladderNear(P.pos.x, P.pos.z, 12);
    if (l) return `Ladder crossing — ${l.width.toFixed(1)} m. Walk it.`;
    const poi = this.world.nearest(P.pos.x, P.pos.z, 40);
    if (poi) {
      if (poi.camp && !this.reached.has(poi.id)) return `<kbd>E</kbd> arrive at ${poi.name}`;
      if (poi.camp) return `<kbd>E</kbd> rest at ${poi.name}`;
      return `<kbd>E</kbd> ${poi.name}`;
    }
    return null;
  }

  handleEvents() {
    for (const e of this.player.drainEvents()) {
      if (e.type === "bridgeCollapse") {
        this.stats.falls++;
        this.audio.cue("collapse");
        this.hud.flash("rgba(120,160,200,0.4)");
        this.hud.notify(e.roped ? "THE FLOOR GOES" : "THE FLOOR GOES — AND YOU ARE NOT TIED IN", "bad");
      }
      if (e.type === "ropeArrest") {
        this.hud.say(`The rope comes tight ${e.depth.toFixed(0)} metres down and you stop, spinning, ` +
          `in blue light. Hold SPACE and start prusiking.`, 12);
      }
      if (e.type === "crevasseBottom") {
        this.hud.say("You stop wedged, on your side, somewhere under the glacier. Nobody saw where you went in.", 12);
      }
      if (e.type === "climbedOut") this.hud.notify("Out. Sit down for a moment.", "good");
      if (e.type === "died") this.endGame("dead");
    }
    for (const e of this.director.drainEvents()) {
      if (e.type === "avalanche") {
        this.audio.cue("collapse");
        this.hud.notify("AVALANCHE — ABOVE YOU", "bad");
        this.hud.flash("rgba(255,255,255,0.25)");
      }
      if (e.type === "serac") {
        this.audio.cue(e.near ? "collapse" : "crack");
        this.hud.notify(e.near ? "A serac lets go, close" : "Something collapses somewhere in the Icefall",
          e.near ? "bad" : "warn");
      }
      if (e.type === "rockfall") {
        this.audio.cue("crack");
        if (e.hit) { this.hud.flash(); this.hud.notify("Rockfall — you are hit", "bad"); }
        else this.hud.notify("Rock comes down the face to your left", "warn");
      }
      if (e.type === "caught") {
        this.hud.flash("rgba(255,255,255,0.75)");
        this.hud.say("It picks you up and there is no up. Swim. Then it stops like concrete. Hold SPACE.", 12);
      }
      if (e.type === "dugOut") {
        this.hud.say("Your arm comes out into air, then your head. You are alive and you are very cold.", 10);
      }
    }
    for (const e of this.climbers.drainEvents()) {
      if (e.type === "delivered") {
        this.stats.helped++;
        this.survival.standing += 6;
        this.hud.notify(`${e.climber.name} is at ${e.camp.name}`, "good");
        this.hud.say("They take her from you at the tents. Somebody puts a cup in your hands. " +
          "You have lost half a day and you would do it again.", 11);
        this.survival.note(`Got ${e.climber.name} down to ${e.camp.name}.`);
      }
    }
  }

  journalState() {
    return {
      world: this.world, weather: this.weather, survival: this.survival,
      reached: this.reached, px: this.player.pos.x, pz: this.player.pos.z,
      altitude: this.player.pos.y,
      spo2: this.survival.spo2At(this.player.pos.y),
      pressureKPa, piO2: inspiredO2(this.player.pos.y, this.survival.fiO2),
    };
  }

  endGame(how) {
    if (this.ended) return;
    this.ended = true;
    document.exitPointerLock?.();
    const card = document.getElementById("endcard");
    const mins = Math.round((Date.now() - this.stats.started) / 60000);
    const S = this.survival;
    card.querySelector(".end-title").textContent =
      how === "summit" ? "The Summit" : "The Mountain Wins";
    card.querySelector(".end-sub").textContent = how === "summit"
      ? (this.stats.lifted
        ? "You are standing on the highest point on Earth, and you were flown part of the way. Only you and the flight log know that. There is room for about six people up here and the wind is doing what it does."
        : "You walked every metre of it. Fifteen minutes, and then the whole thing again, downwards, tired — because the summit is only halfway.")
      : `${S.causeOfDeath ? S.causeOfDeath[0].toUpperCase() + S.causeOfDeath.slice(1) : "The mountain"}. ` +
        `It is not a punishment and it was not personal. It happens here about six times a season, to people who were doing everything right.`;
    const g = card.querySelector(".end-stats");
    g.innerHTML = [
      ["Highest point", `${Math.round(this.highestReached || this.player.pos.y).toLocaleString()} m`],
      ["Distance", `${(this.stats.distance / 1000).toFixed(1)} km`],
      ["Climbed", `${Math.round(this.stats.climbed).toLocaleString()} m`],
      ["Camps reached", `${this.reached.size} / ${this.world.camps.length}`],
      ["People helped", `${this.stats.helped}`],
      ["Crevasse falls", `${this.stats.falls}`],
      ["Flares fired", `${this.stats.flares}`],
      ["Frostbite", `${Math.round(S.frostbite)}%`],
      ["Standing", `${S.standing > 0 ? "+" : ""}${S.standing}`],
      ["Played", `${mins} min`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
    card.classList.add("on");
  }

  toggleControls() {
    const c = document.getElementById("controls");
    c.classList.toggle("on");
    if (c.classList.contains("on")) document.exitPointerLock?.();
  }
}

const _wind = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _night = new THREE.Color();
const _bufSize = new THREE.Vector2();
