// Scene assembly shared by the still renderer and the interactive model.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildContext, pointInPoly, loadOrtho } from './context.js';
import { buildStadium } from './stadium.js';
import { buildOldTrafford, OT } from './oldtrafford.js';
import { buildMasterplan, STADIUM_POS, KEEP_FREIGHT, alongLine } from './masterplan.js';
import { loadHorizon, buildHorizon } from './horizon.js';
import { loadCity, buildCity, nightGround, NIGHT } from './city.js';

export async function loadData(base = './data/', { onProgress } = {}) {
  const root = base.replace(/data\/$/, '');
  const [ctx, site, plan, ortho, horizon] = await Promise.all([fetch(base + 'context.json').then((r) => r.json()), fetch(base + 'site.json').then((r) => r.json()),
    fetch(base + 'plan.json').then((r) => r.json()), loadOrtho(root), loadHorizon(root)]);
  // the city round the scheme, built by the GeoHUB flight sim's own pipeline (src/city.js)
  const city = await loadCity(root), S = site, otPoly = ctx.stadium;
  // Old Trafford's own OSM stands reach past the stadium outline at the ends: drop everything in its box (stands, roof
  // and the 49 m all round), in Old Trafford's frame
  const inOT = ([x, z]) => { const dx = x - OT.x, dz = z - OT.z, c = Math.cos(OT.rot), s = Math.sin(OT.rot), lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < 145 && Math.abs(lz) < 122; };
  const inOTcore = ([x, z]) => { const dx = x - OT.x, dz = z - OT.z, c = Math.cos(OT.rot), s = Math.sin(OT.rot), lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < 150 && Math.abs(lz) < 128; };   // also cuts any city triangle left inside
  const devPolys = [S.stadiumSite, S.northBank, S.northWharf, S.site, S.freightDev, S.otEast, S.lensDev].filter(Boolean);
  const cityGroup = await buildCity(city, { ortho: { core: ortho.core, wide: ortho.wide, mid: { tex: horizon.mid, b: [-6000, 6000, -6000, 6000] } },
    skip: (p) => pointInPoly(p, otPoly) || inOT(p), skipAny: inOTcore, dev: (p) => devPolys.some((q) => pointInPoly(p, q)), onProgress });
  return { ctx, site, plan, ortho, horizon, city, cityGroup };
}

export function createRenderer(canvasParent, w, h, { logDepth = true } = {}) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: logDepth, stencil: true })   // stencil needed for the cutaway section fill;
  r.setSize(w, h); r.setPixelRatio(1);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.78;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.outputColorSpace = THREE.SRGBColorSpace;
  canvasParent.appendChild(r.domElement); return r;
}

export function createWorld(renderer, data, { opt = 'A', otState = 'after', existing = false, time = 'day', shadowSize = 8192, withToday = false } = {}) {
  const scene = new THREE.Scene();
  const S = data.site;
  // sky + sun
  const sky = new Sky(); sky.scale.setScalar(300000); scene.add(sky);
  const U = sky.material.uniforms;
  U.turbidity.value = 6; U.rayleigh.value = 1.6; U.mieCoefficient.value = 0.006; U.mieDirectionalG.value = 0.85;
  const pm = new THREE.PMREMGenerator(renderer);
  const sun = new THREE.DirectionalLight(0xfff3e4, 3.3);
  sun.castShadow = true; sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  Object.assign(sun.shadow.camera, { left: -850, right: 850, top: 850, bottom: -850, near: 100, far: 5000 });
  const hemi = new THREE.HemisphereLight(0xd9e2ee, 0x8a7458, 0.38);
  scene.add(sun, sun.target, hemi);
  const world = { scene, sun, sky, hemi, pm, groups: {} };

  // clearance: development land vs retained surroundings
  const otPoly = data.ctx.stadium;
  const clear = existing
    ? (p) => pointInPoly(p, otPoly)
    : (p) => pointInPoly(p, otPoly) || pointInPoly(p, S.stadiumSite) || pointInPoly(p, S.northBank) || (S.northWharf && pointInPoly(p, S.northWharf)) || pointInPoly(p, S.site) || (S.freightDev && pointInPoly(p, S.freightDev)) || (S.otEast && pointInPoly(p, S.otEast));
  const groups = world.groups;
  groups.context = buildContext(data.ctx, { clear, ortho: data.ortho, buildings: false }); scene.add(groups.context);
  groups.city = data.cityGroup; groups.city.userData.dev.visible = existing; scene.add(groups.city);
  groups.horizon = buildHorizon(data.horizon); scene.add(groups.horizon);

  const ot = buildOldTrafford(existing ? 'before' : otState);
  ot.position.set(OT.x, 0, OT.z); ot.rotation.y = OT.rot; scene.add(ot); groups.oldTrafford = ot;

  if (!existing) {
    const st = buildStadium(opt, { night: time === 'night' });
    st.position.set(STADIUM_POS.x, 0.25, STADIUM_POS.z); st.rotation.y = STADIUM_POS.rot; scene.add(st); groups.stadium = st;
    groups.masterplan = buildMasterplan(data.plan); scene.add(groups.masterplan);
  }
  if (withToday) {   // the site as it is today, for before/after comparison (hidden until asked for)
    groups.contextToday = buildContext(data.ctx, { clear: (p) => pointInPoly(p, otPoly), ortho: data.ortho, buildings: false });
    groups.oldTraffordToday = buildOldTrafford('before');
    groups.oldTraffordToday.position.set(OT.x, 0, OT.z); groups.oldTraffordToday.rotation.y = OT.rot;
    groups.contextToday.visible = groups.oldTraffordToday.visible = false;
    scene.add(groups.contextToday, groups.oldTraffordToday);
  }
  scene.traverse((o) => { if (o.userData.noShadow) { o.castShadow = o.receiveShadow = false; return; } if (o.isMesh && !o.material.transparent) { o.castShadow = o.castShadow ?? true; o.receiveShadow = true; } if (o.isMesh && o.material.transparent) { o.castShadow = true; } });
  world.labels = [...(groups.masterplan?.userData.labels || []), ...groups.horizon.userData.labels];
  // night: a glow at every street lamp in the scene — existing roads and the new streets
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.25, 'rgba(255,210,140,0.55)'); gr.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const makeGlow = (pts) => {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTex, size: 22, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd9a0 }));
    p.name = 'lampGlow'; p.visible = false; return p;
  };
  if (groups.masterplan) groups.masterplan.add(makeGlow((groups.masterplan.userData.lightPoints || []).flatMap(([x, z]) => [x, 9, z])));
  // GeoHUB's night pass on every ground: darkens to ~12 % and lays the Black Marble city lights over it
  // (the scheme's own paving, roads and lawns too, so the ground has one night look everywhere)
  scene.traverse((o) => { if (o.isMesh && /^(ortho_|ground_|terrain$)/.test(o.name)) { o.material = nightGround(o.material.clone(), data.city.bmTex); } });
  applyTime(world, renderer, time);
  return world;
}

// Lighting presets; safe to call repeatedly on a built world.
export function applyTime(world, renderer, time = 'day') {
  const { scene, sun, sky, hemi } = world, U = sky.material.uniforms;
  U.turbidity.value = 6; U.rayleigh.value = 1.6; U.mieCoefficient.value = 0.006; U.mieDirectionalG.value = 0.85;
  const elev = time === 'golden' ? 24 : time === 'day' ? 40 : time === 'noon' ? 52 : 8, azim = time === 'golden' ? 228 : 196;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(azim));
  U.sunPosition.value.copy(sunDir);
  if (time !== 'night') {
    const envScene = new THREE.Scene(); envScene.add(sky.clone());
    world.envTex?.dispose(); world.envTex = world.pm.fromScene(envScene, 0, 1, 400000).texture;
  }
  const night = time === 'night', dusk0 = time === 'golden';
  NIGHT.value = night ? 1 : dusk0 ? 0.12 : 0;
  sky.visible = !night;
  scene.background = night ? new THREE.Color(0x0b1424) : null;
  scene.environment = world.envTex; scene.environmentIntensity = night ? 0.08 : 0.32;
  const tgt = new THREE.Vector3(-480, 0, 60);
  sun.position.copy(tgt).addScaledVector(sunDir, 2500); sun.target.position.copy(tgt);
  sun.color.set(night ? 0x9fb6e0 : time === 'golden' ? 0xffcf96 : 0xfff3e4); sun.intensity = night ? 0.35 : time === 'golden' ? 3.6 : 3.3;
  hemi.intensity = night ? 0.12 : 0.38;
  // aerial perspective: the far terrain fades into the horizon haze, fully by the edge of the mapped world
  scene.fog = night ? new THREE.Fog(0x0b1424, 2500, 30000) : new THREE.Fog(time === 'golden' ? 0xe6cfae : 0xc9d5e1, 3500, 38000);
  const cl = world.groups.horizon?.getObjectByName('clouds');
  if (cl) { const u = cl.material.uniforms; u.uSun.value.copy(sunDir); u.uLit.value.set(night ? 0x3a4560 : dusk0 ? 0xffe2c0 : 0xffffff); u.uShade.value.set(night ? 0x1a2236 : dusk0 ? 0xa59aa4 : 0xb3bdc8); u.uAlpha.value = night ? 0.7 : 0.88; }
  renderer.toneMappingExposure = night ? 0.9 : 0.78;
  const dusk = time === 'golden';
  scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const m = o.material;
    if (o.name === 'skin') m.emissiveIntensity = night ? 2.0 : 0.5;
    if (o.name === 'pitch') { m.emissive ??= new THREE.Color(); m.emissive.set(night ? 0x335522 : 0x000000); }
    if (m?.userData?.nightGlow) { m.emissiveMap = m.map; m.emissive.set(0xffd9a0); m.emissiveIntensity = night ? 0.32 : 0; m.needsUpdate = true; }
    if (m?.userData?.lampHead) m.emissiveIntensity = night ? 3 : dusk ? 1 : 0.4;
    if (m?.userData?.windowGlow) m.emissiveIntensity = night ? 0.9 : dusk ? 0.25 : 0;
    if (m?.name === 'brand') m.emissiveIntensity = night ? 1.2 : 0.25;
  });
  scene.traverse((o) => { if (o.name === 'lampGlow') { o.visible = night || dusk; o.material.opacity = night ? 1 : 0.35; } });
  const tl = world.groups.masterplan?.userData.trinity;
  if (tl) { tl.userData.beams.visible = night || dusk; tl.userData.beams.children.forEach((p) => p.children.forEach((b, i) => (b.material.opacity = (i ? 0.12 : 0.35) * (night ? 1 : 0.45)))); }
  world.time = time;
}

// camera presets (world metres)
export const VIEWS = {
  hero:    { pos: [380, 620, 720], tgt: [-470, 0, -110], fov: 34 },
  west:    { pos: [-1700, 520, 520], tgt: [-520, 0, -120], fov: 32 },
  north:   { pos: [-260, 700, -1450], tgt: [-480, 0, -60], fov: 34 },
  stadium: { pos: [-440, 230, 60], tgt: [-790, 18, -285], fov: 36 },
  stadiumN:{ pos: [-1130, 200, -600], tgt: [-790, 20, -285], fov: 36 },
  ot:      { pos: [250, 190, 260], tgt: [0, 8, 0], fov: 36 },
  rosa:    { pos: [-600, 290, 160], tgt: [-800, 14, -300], fov: 36 },
  sketch:  { pos: [-700, 440, 70], tgt: [-795, 20, -300], fov: 36 },
  plan:    { ortho: [-1180, 220, -620, 760] },
};

export function makeCamera(view, w, h) {
  const v = VIEWS[view];
  if (v.ortho) {
    const [x0, x1, z0, z1] = v.ortho, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    let hw = (x1 - x0) / 2, hh = (z1 - z0) / 2; if (hw / hh > w / h) hh = hw * h / w; else hw = hh * w / h;
    const c = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 1500, 2300); c.position.set(cx, 2000, cz); c.up.set(0, 0, -1); c.lookAt(cx, 0, cz); return c;
  }
  const c = new THREE.PerspectiveCamera(v.fov, w / h, 2, 250000); c.position.set(...v.pos); c.lookAt(...v.tgt); return c;
}
