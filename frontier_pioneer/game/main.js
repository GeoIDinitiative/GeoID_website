/**
 * The game: boot order, the two clocks, and the loop.
 *
 * TWO CLOCKS (Everest's rule). Real seconds drive the rover's dynamics, the
 * camera and input. Simulated seconds (state.clock.scale per real one) drive
 * the Sun, the hotel loads and the solar array. Drive energy is work, so it
 * belongs to neither.
 *
 * BOOT ORDER matters: the manifest, then the two always-loaded base levels
 * (16 m heights, CTX image), then the detail provider (it conditions on
 * both), then everything that samples the ground. The first clipmap build
 * waits for the fine tiles around the rover so the player never sees the
 * coarse ground first.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { CAMERA, QUALITY, TIME_SCALE, TIME_WARP, MARS, VERSION } from "./config.js?v=b8cfe8e-efa5b7b7";
import { Site } from "./site.js?v=b8cfe8e-efa5b7b7";
import { Heightfield } from "./heightfield.js?v=b8cfe8e-efa5b7b7";
import { Imagery } from "./imagery.js?v=b8cfe8e-efa5b7b7";
import { ProceduralDetail } from "./detail.js?v=b8cfe8e-efa5b7b7";
import { Surface } from "./surface.js?v=b8cfe8e-efa5b7b7";
import { Terrain } from "./terrain.js?v=b8cfe8e-efa5b7b7";
import { Rocks } from "./rocks.js?v=b8cfe8e-efa5b7b7";
import { Sky } from "./sky.js?v=b8cfe8e-efa5b7b7";
import { TerrainShadows } from "./shadows.js?v=b8cfe8e-efa5b7b7";
import { PostFX } from "./postfx.js?v=b8cfe8e-efa5b7b7";
import { Vehicle, VEHICLES } from "./vehicle.js?v=b8cfe8e-efa5b7b7";
import { loadRoverModel } from "./rovermodel.js?v=b8cfe8e-efa5b7b7";
import { Rig } from "./camera.js?v=b8cfe8e-efa5b7b7";
import { Input, DRIVING_HELP } from "./input.js?v=b8cfe8e-efa5b7b7";
import { Hud } from "./hud.js?v=b8cfe8e-efa5b7b7";
import { EntityLayer, Assets } from "./entities.js?v=b8cfe8e-efa5b7b7";
import * as State from "./state.js?v=b8cfe8e-efa5b7b7";
import * as tiles from "./tiles.js?v=b8cfe8e-efa5b7b7";

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _q = new THREE.Quaternion();
const _drag = { x: 0, y: 0 };

import * as Systems from "./systems.js?v=b8cfe8e-efa5b7b7";
import "./plugins.js";

// Modes in which the world runs. "onfoot" and "build" belong to systems (the astronaut, the base builder).
export const LIVE_MODES = new Set(["driving", "onfoot", "build"]);

export class Game {
  constructor(canvas, { headless = false } = {}) {
    this.canvas = canvas;
    this.headless = headless;
    this.version = VERSION;
    this.settings = State.loadSettings();
    this.quality = QUALITY[this.settings.quality] || QUALITY.high;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: "high-performance",
      preserveDrawingBuffer: headless, logarithmicDepthBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.shaderLog = [];
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      this.shaderLog.push((gl.getProgramInfoLog(program) || "") + " | VS: " + (gl.getShaderInfoLog(vs) || "") + " | FS: " + (gl.getShaderInfoLog(fs) || ""));
    };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    this.post = new PostFX(this.renderer);
    this.input = new Input(canvas);
    this.hud = new Hud();
    this.mode = "title";            // title | loading | driving | onfoot | build | menu | complete
    this.paused = false;
    this.warp = false;
    this.ready = false;
    this.clock = new THREE.Clock();
    this.frame = 0;
    this.fps = 0;
    this.listeners = {};
    this._autosave = 0;
    this.hud.attach(this);                // the interface manager reads settings.ui (uiman.js)
    this._wireInput();
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
  emit(name, detail) { for (const f of this.listeners[name] || []) f(detail); }

  /* ── boot ─────────────────────────────────────────────────────────────*/

  async boot(siteEntry, { fresh = false, onProgress = () => {} } = {}) {
    this.mode = "loading";
    onProgress(0.02, "Reading the site manifest", "");
    const variant = new URLSearchParams(location.search).get("lite") !== null ? "lite" : "";
    const site = this.site = await Site.load(siteEntry.path, variant);
    this.field = new Heightfield(site);
    this.imagery = new Imagery(site, this.renderer);
    onProgress(0.05, "Terrain: 16 m base (CTX + HiRISE)", "");
    await this.field.loadBase((d, n) => onProgress(0.05 + 0.2 * d / n, "Terrain: 16 m base (CTX + HiRISE)", `${d} / ${n} tiles`));
    await this.imagery.loadBase((d, n) => onProgress(0.25 + 0.25 * d / n, "Imagery: CTX orthomosaic", `${d} / ${n} tiles`));
    onProgress(0.52, "Conditioning the generated detail on the data", "");
    this.detail = new ProceduralDetail();
    await this.detail.init({ site, field: this.field, albedo: this.imagery.base });
    this.rocks = new Rocks(this.detail, this.quality);
    this.surface = new Surface(site, this.field, this.imagery, this.detail, this.rocks);
    this.sky = new Sky(site.manifest.grid.lat0_deg);
    this.terrain = new Terrain(this.field, this.imagery, this.detail, this.sky, this.quality);
    this.shadows = new TerrainShadows(this.field, this.quality.shadowRes);
    this.imagery.setAnisotropy(this.quality.aniso);
    this.detail.uniforms.uMicro.value = this.quality.microNormal;

    // three's own lights, for the rover, rocks and entities (the terrain lights itself from the same Sky)
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    this.scene.add(this.sky.mesh, this.terrain.group, this.rocks.group, this.sunLight, this.sunLight.target, this.hemi);

    this.assets = new Assets("assets/models/");
    this.entities = new EntityLayer(this.surface, site, this.assets);
    this.scene.add(this.entities.group);

    // state
    const saved = fresh ? null : State.loadGame(site.id);
    this.state = saved || State.newState(site, this.detail.id);
    const def = VEHICLES[(saved && saved.vehicle && saved.vehicle.type) || "rover_crew"] || VEHICLES.rover_crew;
    this.vehicle = new Vehicle(def, this.surface);
    onProgress(0.56, "Rover", "");
    this.model = await loadRoverModel(def, this.vehicle, "assets/models/");
    this.scene.add(this.model.group);
    this.rig = new Rig(this.camera, def);
    this.rig.invertY = this.settings.invertY;
    this.rig.mode = this.state.view.camera || "chase";

    // where the rover is, so the right fine tiles stream before the first frame
    const sx = saved && saved.vehicle ? saved.vehicle.p[0] : site.start.x, sz = saved && saved.vehicle ? saved.vehicle.p[2] : site.start.z;
    this.field.update(sx, sz); this.imagery.update(sx, sz);
    await this._settle((f) => onProgress(0.58 + 0.34 * f, "Terrain and imagery around the rover (HiRISE)", `${tiles.pending()} tiles to go`));
    if (saved && saved.vehicle) this.vehicle.fromJSON(saved.vehicle);
    else this.vehicle.place(sx + 14, sz + 6, (site.start.heading_deg || 0) * Math.PI / 180);     // beside the landing marker, not on it
    this.vehicle.headlights = !!(saved && saved.vehicle && saved.vehicle.headlights);

    for (const p of site.pois) await this.entities.add({ type: "poi_beacon", x: p.x, z: p.z, id: "poi:" + p.id, data: { colour: p.id === "landing" ? 0x7fd0ff : 0xffb347 } });
    await this.entities.restore(this.state.entities);
    // everything built on the foundation (weather, base builder, astronaut…): systems.js
    await Systems.initSystems(this);
    Systems.loadSystems(this, this.state);

    onProgress(0.94, "Building the ground", "");
    this.setHonesty(false);                       // no data-honesty view in the game; an old save's flag is ignored
    this.resize();
    this.terrain.update(this.vehicle.p.x, this.vehicle.p.z);
    this.rocks.update(this.vehicle.p.x, this.vehicle.p.z, this.surface);
    this.sky.update(this.state.clock, this.state.weather.tau);
    this.shadows.update(this.sky.sun, 4000);
    this.ready = true;
    this.tick(0);
    onProgress(1, "Ready", "");
    return this;
  }

  /** Wait until the tiles wanted around the focus are in memory (or 20 s). */
  async _settle(onFrac = () => {}, ms = 20000) {
    const start = performance.now(), total = Math.max(1, tiles.pending());
    while (performance.now() - start < ms) {
      if (tiles.pending() === 0 && this.field.settled) break;
      onFrac(1 - tiles.pending() / total);
      await new Promise((r) => setTimeout(r, 60));
    }
    this.imagery.flush();
    onFrac(1);
  }

  /* ── mode ─────────────────────────────────────────────────────────────*/

  get driving() { return this.mode === "driving" && !this.paused; }
  /** The world is running: driving, walking ("onfoot") or building ("build"). Time passes and systems tick in all three;
   *  the rover's own physics steps only while driving. Systems own the "onfoot" and "build" modes (systems.js). */
  get live() { return LIVE_MODES.has(this.mode) && !this.paused; }
  get target() { return this.ready ? State.currentTarget(this.state, this.site) : null; }

  /** The controller module is in "flight" mode exactly while the player is driving. */
  syncPadMode() {
    const P = window.GeoIDPad;
    const want = this.live && !this.helpOpen ? "flight" : "app";
    this.input.enabled = want === "flight";
    if (P && P.mode !== want) P.setMode(want);
    this.padMode = want;
  }
  setMode(mode) {
    const prev = this.mode;
    this.mode = mode;
    this.paused = !LIVE_MODES.has(mode);
    this.hud.show(LIVE_MODES.has(mode) || mode === "menu" || mode === "complete");
    this.syncPadMode();
    this.emit("mode", mode);
    Systems.modeSystems(this, mode, prev);
  }
  start() { this.setMode("driving"); this.clock.getDelta(); if (!this.headless) this._loop(); }
  pause(on = true) {
    if (!this.ready || (!LIVE_MODES.has(this.mode) && this.mode !== "menu")) return;
    if (on) { this.save(); this._resumeMode = this.mode; this.setMode("menu"); } else this.setMode(this._resumeMode || "driving");
  }

  _wireInput() {
    const I = this.input;
    const both = (name, fn, anyMode = false) => {
      I.on(name, () => { if (anyMode || this.driving) fn(); });
      I.on("pad:" + name, () => { if (this.driving) fn(); });
    };
    both("camera", () => { this.state.view.camera = this.rig.toggle(); });
    both("recentre", () => this.rig.recentre());
    both("recover", () => this.recover());
    both("lights", () => this.setHeadlights(!this.vehicle.headlights));
    both("warp", () => this.setWarp(!this.warp));
    both("objective", () => this.announceObjective());
    both("interact", () => this.interact());
    // pause and menu work from the keyboard in either direction; from the pad, Options toggles and Circle is the module's "back"
    I.on("pause", () => { if (this.storyHold) return; if (LIVE_MODES.has(this.mode)) this.pause(true); else if (this.mode === "menu") this.pause(false); });
    I.on("menu", () => this.emit("menukey"));
    I.on("help", () => this.emit("helpkey"));
    // hide the whole interface for a screenshot: F1, or Share on the pad (free in every controls table)
    I.on("hidehud", () => { if (this.ready && (LIVE_MODES.has(this.mode) || this.mode === "menu")) this.hud.ui.hideAll(); });
    I.on("pad:hidehud", () => { if (this.ready && LIVE_MODES.has(this.mode) && !this.paused) this.hud.ui.hideAll(); });
    const P = window.GeoIDPad;
    if (P) {
      P.setHelp(DRIVING_HELP, "Driving");
      P.on("options", () => {
        if (this.storyHold) return;                         // a choice or a cutscene holds the world (uistory.js)
        if (this.mode === "driving") { this.pause(true); this.emit("padmenu"); }
        else if (this.mode === "menu") this.emit("padresume");
      });
      // Circle with nothing left to close: open the game menu.
      P.onBack(() => { if (this.storyHold) return true; if (this.mode === "driving") { this.pause(true); this.emit("padmenu"); return true; } return false; });
      // The module's overlay titles a page's own map "Flying"; re-present ours under its real name.
      let guard = false;
      P.on("help", (open) => {
        if (guard) return;
        guard = true;
        this.helpOpen = !!open;
        this.syncPadMode();
        // a system that owns a mode may publish its own map: game.helpMaps[mode] = { entries, title }
        const own = this.helpMaps && this.helpMaps[this.mode];
        if (open && this.ready && this.mode !== "title") P.showHelp(own ? own.entries : DRIVING_HELP, own ? own.title : "Driving");
        guard = false;
      });
    }
  }

  /* ── actions ──────────────────────────────────────────────────────────*/

  setHonesty(on) {
    this.state.view.honesty = on;
    this.terrain.uniforms.uHonesty.value = on ? 1 : 0;
    this.rocks.setHonesty(on);
  }
  setHeadlights(on) { this.vehicle.headlights = on; this.model.setHeadlights(on); }
  setWarp(on) {
    this.warp = on;
    this.state.clock.scale = on ? TIME_WARP : TIME_SCALE;
    this.hud.toast(on ? `Time warp ×${TIME_WARP}<small>the Sun and the battery run fast; the rover does not</small>` : "Time warp off", 2.5);
  }
  // the clock and the weather run themselves (state.js, weather.js); these two remain for the tests and story scripting only
  setTimeOfDay(hours) { this.state.clock.tod = (((hours % 24) + 24) % 24) / 24 * MARS.solSeconds; }
  setTau(tau) { this.state.weather.tau = Math.max(0.05, tau); }
  recover() {
    if (Math.abs(this.vehicle.t.speed) > 1.5 && !this.vehicle.t.tipped) { this.hud.toast("Stop first to right the rover", 2); return; }
    this.vehicle.recover();
    this.emit("recover", { x: this.vehicle.p.x, z: this.vehicle.p.z });
    State.advanceClock(this.state.clock, 20 * 60);          // it is not free: twenty minutes of the sol
    this.hud.toast("Rover righted<small>20 minutes of the sol spent</small>", 2.5);
  }
  announceObjective() {
    const ms = Systems.getSystem("missions");                // the missions system answers when it is there (a line first, then its briefing)
    this.hud.ui.poke("objective", 8);
    if (ms && ms.api && ms.api.announce) return ms.api.announce();
    const t = this.target;
    this.hud.toast(t ? `${t.name}<small>${t.note}</small>` : "Traverse complete<small>free exploration</small>", 5);
  }
  interact() {
    const v = this.vehicle;
    const near = this.site.pois.find((p) => Math.hypot(p.x - v.p.x, p.z - v.p.z) < 40);
    if (near) this.hud.toast(`${near.name}<small>${near.note} Source: ${near.source}.</small>`, 7);
    this.emit("interact", { near });
  }
  setQuality(name) {
    this.quality = QUALITY[name] || QUALITY.high;
    this.settings.quality = this.quality.name;
    if (!this.ready) return;
    this.terrain.setQuality(this.quality);
    this.rocks.setQuality(this.quality);
    this.imagery.setAnisotropy(this.quality.aniso);
    this.detail.uniforms.uMicro.value = this.quality.microNormal;
    this.resize();
    this.terrain.update(this.vehicle.p.x, this.vehicle.p.z);
  }
  applySettings() {
    State.saveSettings(this.settings);
    if (this.rig) this.rig.invertY = this.settings.invertY;
    this.hud.hintKey = "";
  }

  save() {
    if (!this.ready) return false;
    this.state.vehicle = this.vehicle.toJSON();
    this.state.entities = this.entities.serialise();
    this.state.detail = this.detail.id;
    Systems.saveSystems(this, this.state);
    return State.saveGame(this.state);
  }
  restart() {
    State.clearGame(this.site.id);
    const fresh = State.newState(this.site, this.detail.id);
    fresh.view = this.state.view;
    this.state = fresh;
    Systems.loadSystems(this, this.state);                   // a new game for every system too (saved = undefined)
    this.vehicle.battery = this.vehicle.capacity; this.vehicle.flat = false; this.vehicle.odometer = 0; this.vehicle.energyUsed = 0;
    this.teleport(this.site.start.x + 14, this.site.start.z + 6, this.site.start.heading_deg || 0);
    this.setWarp(false);
  }
  /** Move the rover (and the streaming focus) somewhere else. Heights settle as tiles arrive. */
  teleport(x, z, headingDeg = 0) {
    this.field.update(x, z); this.imagery.update(x, z);
    this.vehicle.place(x, z, headingDeg * Math.PI / 180);
    this.rig.followYaw = null; this.rig.recentre();
    this.terrain.invalidate();
    this.rocks.builtAt.x = NaN;
    this._reseatAt = performance.now() + 400;
  }

  /* ── the loop ─────────────────────────────────────────────────────────*/

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(s.x, s.y, this.quality);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop() {
    if (this._looping) return;
    this._looping = true;
    const step = () => {
      requestAnimationFrame(step);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.fps += ((dt > 0 ? 1 / dt : 60) - this.fps) * 0.05;
      if (this.ready && this.mode !== "title") this.tick(dt);
    };
    requestAnimationFrame(step);
  }

  tick(dt) {
    const st = this.state, v = this.vehicle;
    this.frame++;
    this.syncPadMode();
    const ctl = this.input.poll(dt);
    if (this.live && dt > 0) {
      State.advanceClock(st.clock, dt * st.clock.scale);
      st.playtime_s += dt;
    }
    this.sky.update(st.clock, st.weather.tau);
    if (this.driving && dt > 0) {
      v.update(dt, ctl, {
        sunDir: this.sky.sunDir, irradiance: this.sky.irradiance, sinEl: this.sky.sun.sinEl,
        timeScale: st.clock.scale, panelFactor: 1 - (st.weather.panelDust || 0),
      });
      // the mapped area ends: a soft wall
      const s = this.site, m = 60;
      this.edge = !s.inside(v.p.x, v.p.z, m + 40);
      if (!s.inside(v.p.x, v.p.z, m)) {
        v.p.x = Math.max(-s.halfX + m, Math.min(s.halfX - m, v.p.x)); v.p.z = Math.max(-s.halfZ + m, Math.min(s.halfZ - m, v.p.z));
        v.v.multiplyScalar(0.5);
      }
      const ev = State.stepObjectives(st, this.site, v);
      if (ev) {
        if (ev.reached) this.hud.toast(`Reached: ${ev.reached.name}<small>${ev.reached.note}</small>`, 6);
        this.save();
        if (ev.complete) { this.setMode("complete"); this.emit("complete", State.summary(st, v)); }
      }
      this._autosave += dt;
      if (this._autosave > 20) { this._autosave = 0; this.save(); }
    }

    // the systems' simulation step: only while the game is live
    if (this.live && dt > 0) Systems.tickSystems(this, dt, { ctl, active: true, simDt: dt * st.clock.scale, mode: this.mode });

    // streaming and the ground. A system may move the focus (an astronaut on foot) by setting game.focus = {x, z}.
    const fx = this.focus ? this.focus.x : v.p.x, fz = this.focus ? this.focus.z : v.p.z;
    this.field.update(fx, fz);
    this.imagery._fx = fx; this.imagery._fz = fz;
    this.imagery.update(fx, fz);
    this.terrain.update(fx, fz, 5);
    this.rocks.update(fx, fz, this.surface);
    if (this._reseatAt && performance.now() > this._reseatAt && this.field.settled) { this.entities.reseat(); this.rocks.builtAt.x = NaN; this._reseatAt = 0; }
    else if (this.field.lastTileAt && this.field.lastTileAt !== this._seenTile) { this._seenTile = this.field.lastTileAt; this._reseatAt = performance.now() + 500; }
    if (this.settings.shadows) this.shadows.update(this.sky.sun, 2.5);
    this.shadows.bind(this.terrain.uniforms, this.settings.shadows);

    // picture
    this.model.sync(v);
    this.input.takeDrag(_drag);
    this.rig.zoom(this.input.takeZoom());
    this.rig.update(dt, v, this.surface, this.input.look, _drag);
    Systems.frameSystems(this, dt);
    this.camera.updateMatrixWorld(true);
    this._uniforms();
    this.post.render(this.scene, this.camera, this.quality);
    if (this.mode !== "title" && this.mode !== "loading") {
      this.hud.hints(this.input.padConnected && this.input.lastDevice === "pad", window.GeoIDPad);
      this.hud.update(dt || 0.2, this);
    }
  }

  _uniforms() {
    const U = this.terrain.uniforms, v = this.vehicle, sky = this.sky, b = v.def.box;
    U.uCamPos.value.copy(this.camera.position);
    U.uHazeK.value = this.state.weather.tau / 11000;                 // dust scale height, metres
    if (this.env && this.env.hazeK > 0) U.uHazeK.value = this.env.hazeK;      // the weather system's near-surface extinction (storms)
    // the rover's shadow boxes: the body, and the wheels' envelope under it
    _p.set(0, b.y, 0).applyQuaternion(v.q).add(v.p);
    U.uBoxInv.value[0].copy(_m.compose(_p, v.q, _s)).invert();
    U.uBoxHalf.value[0].set(b.width / 2, b.height / 2, b.length / 2);
    const wy = -(v.rideHeight - v.def.wheelRadius);
    _p.set(0, wy, 0).applyQuaternion(v.q).add(v.p);
    U.uBoxInv.value[1].copy(_m.compose(_p, v.q, _s)).invert();
    U.uBoxHalf.value[1].set(Math.abs(v.wheels[0].attach.x) + v.def.wheelWidth / 2, v.def.wheelRadius, Math.abs(v.wheels[0].attach.z) + v.def.wheelRadius);
    U.uBoxOn.value = this.rig.mode === "chase" || true ? 1 : 0;
    const lp = v.def.lamp.pos;
    U.uLampPos.value.set(lp[0], lp[1], lp[2]).applyQuaternion(v.q).add(v.p);
    U.uLampDir.value.set(0, -0.16, -1).normalize().applyQuaternion(v.q);
    U.uLampOn.value = v.headlights && !v.flat ? 1 : 0;
    // the terrain has one lamp: a system may borrow it (the astronaut's helmet lamp) with game.lamp = { pos, dir, on }
    if (this.lamp) { U.uLampPos.value.copy(this.lamp.pos); U.uLampDir.value.copy(this.lamp.dir); U.uLampOn.value = this.lamp.on ? 1 : 0; }
    // three's lights, matched to the terrain's: a Lambert surface under these gets the same radiance
    this.sunLight.color.copy(sky.sunColor); this.sunLight.intensity = Math.PI;
    this.sunLight.position.copy(v.p).addScaledVector(sky.sunDir, 100); this.sunLight.target.position.copy(v.p);
    this.hemi.color.copy(sky.ambSky); this.hemi.groundColor.copy(sky.ambGround); this.hemi.intensity = Math.PI;
    // exposure: open up as the light goes
    const day = sky.uniforms.uDay.value;
    const ex = 0.95 + (1 - THREE.MathUtils.smoothstep(sky.sun.sinEl, 0.0, 0.5)) * 0.55 + (1 - day) * 2.4;
    this.post.exposure = ex;
  }

  /* ── diagnostics (see diag.js) ────────────────────────────────────────*/
  shaderErrors() {
    const gl = this.renderer.getContext(), out = this.shaderLog.slice();
    for (const p of this.renderer.info.programs || []) {
      if (p.diagnostics && !p.diagnostics.runnable) out.push(`${p.name || "(shader)"}: ${p.diagnostics.programLog} ${p.diagnostics.fragmentShader?.log || ""} ${p.diagnostics.vertexShader?.log || ""}`.trim());
      else if (p.program && !gl.getProgramParameter(p.program, gl.LINK_STATUS)) out.push(`${p.name || "(shader)"}: ${gl.getProgramInfoLog(p.program)}`);
    }
    return out;
  }
}
