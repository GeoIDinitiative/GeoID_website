// The atrium: an open-plan, multi-storey "endoskeleton" between the bowl and the rose skin —
// gallery floors of shops, restaurants and bars stepping out with the leaning wall, inclined white columns,
// escalators, glass balustrades and a light-well against the skin.
import * as THREE from 'three';
import { canvasTex, std, rng, sePath } from './kit.js';
import { BOWL_PATH, BACK_FACES } from './bowl.js';

const TAU = Math.PI * 2, sgnPow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
// point on a superellipse in the direction of polar angle phi
function seAtPolar(phi, a, b, n) {
  const c = Math.cos(phi), s = Math.sin(phi);
  const r = 1 / Math.pow(Math.pow(Math.abs(c) / a, n) + Math.pow(Math.abs(s) / b, n), 1 / n);
  return [r * c, r * s];
}

const SHOPS = ['MEGASTORE', 'THE HOLY TRINITY BAR', 'BUSBY’S KITCHEN', 'RED CAFÉ', 'MUSEUM SHOP', 'THE 1878 TAVERN', 'KIT ROOM', 'NOODLE BAR',
  'STRETFORD END GRILL', 'COFFEE', 'BOOKS', 'GELATO', 'LEGENDS LOUNGE', 'TREBLE ’99 SPORTS BAR', 'FOOD HALL', 'ACADEMY STORE'];
function shopfrontTex(levels, seed) {
  const R = rng(seed), W = 4096, H = 256 * levels;
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#e9e6e1'; g.fillRect(0, 0, W, H);
    for (let l = 0; l < levels; l++) {
      const y0 = l * 256;
      let x = 0;
      while (x < W) {
        const w = 120 + R() * 160, name = SHOPS[Math.floor(R() * SHOPS.length)];
        const hue = [0, 355, 200, 160, 40, 0][Math.floor(R() * 6)];
        g.fillStyle = `hsl(${hue},${hue === 0 ? 0 : 55}%,${hue === 0 ? 14 : 34}%)`; g.fillRect(x + 3, y0 + 40, w - 6, 40);            // fascia
        g.fillStyle = '#fff'; g.font = '600 20px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(name.length * 11 > w ? name.slice(0, Math.floor(w / 12)) : name, x + w / 2, y0 + 61);
        const gr = g.createLinearGradient(0, y0 + 80, 0, y0 + 240); gr.addColorStop(0, '#f7e6c4'); gr.addColorStop(1, '#c79a5a');
        g.fillStyle = gr; g.fillRect(x + 3, y0 + 82, w - 6, 158);                                                                      // lit interior
        g.fillStyle = 'rgba(40,30,20,0.35)'; for (let k = 0; k < 4; k++) g.fillRect(x + 10 + R() * (w - 30), y0 + 150 + R() * 40, 14, 60); // shelves / people
        g.fillStyle = '#cfd5d8'; for (let m = x + 3; m < x + w; m += 40) g.fillRect(m, y0 + 82, 3, 158);                               // mullions
        g.fillStyle = '#9a958d'; g.fillRect(x, y0 + 30, 3, 226);
        x += w;
      }
      g.fillStyle = '#b8b2a8'; g.fillRect(0, y0, W, 30);   // slab edge above
    }
  }, { repeat: [6, 1] });
}

export function buildAtrium(sec, { A, B, NE }) {
  const g = new THREE.Group(); g.name = 'atrium';
  const M = (A + B) / 2;
  // skin plan scale k at height y (wall part of the section, ground -> eave)
  const kAt = (y) => { let lo = 0, hi = 0.6; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; sec(m)[1] < y ? lo = m : hi = m; } return sec(lo)[0]; };
  const P0 = BOWL_PATH(), N = 180;
  const backD = (y) => (y < 17.4 ? 30 : y < 34.4 ? 46 : 68);
  // the skin's plan scale at a point (superellipse "radius" in units of A,B)
  const kOf = (x, z) => Math.pow(Math.pow(Math.abs(x) / A, NE) + Math.pow(Math.abs(z) / B, NE), 1 / NE);
  const ring = (d, y, inset, maxDepth = Infinity) => {
    // inner points follow the bowl path at offset d; each gallery runs straight out along the bowl's normal,
    // stopping maxDepth out or `inset` metres short of the skin — so every bay has the same depth and direction
    const kS = kAt(y) - inset / M, inner = [], outer = [];
    for (let i = 0; i < N; i++) {
      const p = P0.pts[Math.round(i / N * P0.pts.length) % P0.pts.length];
      const ix = p.x + p.nx * d, iz = p.z + p.nz * d; inner.push([ix, iz]);
      let lo = 0, hi = 200; for (let j = 0; j < 30; j++) { const m = (lo + hi) / 2; kOf(ix + p.nx * m, iz + p.nz * m) < kS ? (lo = m) : (hi = m); }
      const t = Math.max(4, Math.min(maxDepth, lo)); outer.push([ix + p.nx * t, iz + p.nz * t]);
    }
    return { inner, outer };
  };
  const slabMat = new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (c) => { c.fillStyle = '#ece8e2'; c.fillRect(0, 0, 256, 256); c.strokeStyle = 'rgba(0,0,0,0.06)'; for (let i = 0; i <= 256; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 256); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(256, i); c.stroke(); } }, { repeat: [1, 1] }), roughness: 0.35, side: THREE.DoubleSide });
  const edgeMat = std(0xf4f4f2, { side: THREE.DoubleSide });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe9e6, transparent: true, opacity: 0.25, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const LEVELS = [5.8, 11.6, 17.4, 23.2, 29, 34.4, 40.2, 46], INSET = 13;
  // each gallery's underside in its own colour: United red, white, Scotland blue, Ireland green, gold, Old Trafford aqua
  const soffitMats = [0xc8102e].map((c) => std(c, { roughness: 0.6, side: THREE.DoubleSide, emissive: c, emissiveIntensity: 0.12 }));
  const floorGeo = (inner, outer, y, uvS = 1 / 12) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i < N; i++) { pos.push(inner[i][0], y, inner[i][1], outer[i][0], y, outer[i][1]); uv.push(inner[i][0] * uvS, inner[i][1] * uvS, outer[i][0] * uvS, outer[i][1] * uvS); }
    for (let i = 0; i < N; i++) { const a = i * 2, b = ((i + 1) % N) * 2; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals(); return geo;
  };
  const band = (pts, y0, y1, mat) => {
    const pos = [], idx = [];
    for (let i = 0; i < N; i++) pos.push(pts[i][0], y0, pts[i][1], pts[i][0], y1, pts[i][1]);
    for (let i = 0; i < N; i++) { const a = i * 2, b = ((i + 1) % N) * 2; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  };
  // ground concourse floor (full width to the skin)
  { const { inner, outer } = ring(30, 0.4, 0); g.add(new THREE.Mesh(floorGeo(inner, outer, 0.4), slabMat)); }
  const walk = [];
  const edges = [];
  for (const y of LEVELS) {
    const { inner, outer } = ring(backD(y + 0.1), y, INSET);   // every floor edge kept INSET in from the leaning skin: floors step out with it
    const slab = new THREE.Mesh(floorGeo(inner, outer, y), slabMat); g.add(slab); walk.push(slab);
    g.add(new THREE.Mesh(floorGeo(inner, outer, y - 0.6), soffitMats[LEVELS.indexOf(y) % soffitMats.length]));     // coloured soffit
    g.add(band(outer, y - 0.6, y, edgeMat));                              // slab edge fascia
    g.add(band(outer, y, y + 1.1, glassMat));                             // glass balustrade
    edges.push({ y, outer });
  }
  // shopfronts on the bowl's back faces, one band per gallery floor
  BACK_FACES.forEach(([d, y0, y1], i) => {
    const pts = []; for (let k = 0; k < N; k++) { const p = P0.pts[Math.round(k / N * P0.pts.length) % P0.pts.length]; pts.push([p.x + p.nx * (d + 0.7), p.z + p.nz * (d + 0.7)]); }
    const levels = Math.round((y1 - y0) / 5.8), m = band(pts, y0, y1, new THREE.MeshStandardMaterial({ map: shopfrontTex(levels, 11 + i), roughness: 0.6, side: THREE.DoubleSide }));
    const uv = []; let acc = 0; for (let k = 0; k < N; k++) { if (k) acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); uv.push(acc / 120, 0, acc / 120, 1); }
    m.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); m.name = 'shopfronts'; g.add(m);
  });
  // endoskeleton: inclined white columns at an even 9 m pitch round the skin, each one leaning out in its own radial plane
  // with the wall (same angle everywhere), tied by a white ring beam at every gallery level
  const colMat = std(0xffffff, { roughness: 0.3, metalness: 0.1 });
  const kB = kAt(0.4) - INSET / M, kT = kAt(46) - INSET / M, base = sePath(A * kB, B * kB, NE, 1440);
  const nCol = Math.round(base.length / 36), colPts = [];   // a column every ~36 m: an open, spacious atrium
  for (let i = 0; i < nCol; i++) {
    const p = base.pts[Math.floor(i / nCol * base.pts.length)], s = kT / kB;
    const a = new THREE.Vector3(p.x, 0.4, p.z), b = new THREE.Vector3(p.x * s, 46.6, p.z * s); colPts.push([a, b]);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, a.distanceTo(b), 16), colMat);
    c.position.copy(a).lerp(b, 0.5); c.lookAt(b); c.rotateX(Math.PI / 2); g.add(c);
  }
  for (const y of []) {          // no extra ring beams: the floor edges tie the columns
    const t = (y - 0.4) / 46.2, pts = colPts.map(([a, b]) => a.clone().lerp(b, t)); pts.push(pts[0].clone());
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), nCol * 2, 0.22, 6, true), colMat));
  }
  // internal vertical columns on a uniform ~15 m grid: one ring from the concourse up to the 34.4 m slab (behind the lower tiers),
  // a second ring from that slab up to the top floor behind the upper tier — every gallery is carried
  { const vMat = std(0xf6f6f4, { roughness: 0.35 });
    // each ring follows the façade's plan shape just inside the lowest floor it carries, and is kept clear of the bowl behind
    for (const [yLow, y0, y1, dMin] of [[5.8, 0.4, 34.4, 50], [40.2, 34.4, 51.4, 72]]) {
      const kc = kAt(yLow) - (INSET + 3) / M, pth = sePath(A * kc, B * kc, NE, 1440), n = Math.round(pth.length / 15);
      const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, y1 - y0, 14), vMat, n), M4 = new THREE.Matrix4(); let c = 0;
      for (let i = 0; i < n; i++) {
        const q = pth.pts[Math.floor(i / n * pth.pts.length)];
        if (Math.pow(Math.abs(q.x) / (60 + dMin), 5) + Math.pow(Math.abs(q.z) / (41 + dMin), 5) < 1) continue;   // would stand in the bowl
        M4.makeTranslation(q.x, (y0 + y1) / 2, q.z); im.setMatrixAt(c++, M4);
      }
      im.count = c; im.castShadow = true; im.name = 'atriumColumns'; g.add(im);
    } }
  // lift and stair cores: solid towers from the ground to the underside of the upper tier, passing through the galleries
  const coreMat = std(0xf0eee9, { roughness: 0.5 }), liftGlass = new THREE.MeshPhysicalMaterial({ color: 0xbfe3df, transparent: true, opacity: 0.5, roughness: 0.05 });
  const solids = [];
  for (let j = 0; j < 8; j++) {
    const p = P0.pts[Math.round((j + 0.5) / 8 * P0.pts.length) % P0.pts.length], d = 54, ang = Math.atan2(p.nz, p.nx);
    const core = new THREE.Mesh(new THREE.BoxGeometry(9, 34.4, 7), coreMat); core.position.set(p.x + p.nx * d, 17.2, p.z + p.nz * d); core.rotation.y = -ang; g.add(core); solids.push(core);
    const lift = new THREE.Mesh(new THREE.BoxGeometry(3.2, 34.4, 3.2), liftGlass); lift.position.set(p.x + p.nx * (d + 5.2), 17.2, p.z + p.nz * (d + 5.2)); lift.rotation.y = -ang; g.add(lift);
  }
  // ---------------- fit-out: a programme per level, units built against the bowl and facing the void across a promenade
  const PROGRAM = [
    { y: 0.4, d: 30, inset: 3, h: 4.6, title: 'Ground · Concourse & Megastore', units: [
      ['United Megastore', 'mega', 96], ['Ticket & Membership Office', 'service', 22], ['Food Hall', 'food', 64], ['Red Café', 'cafe', 18], ['Matchday Bar', 'bar', 28],
      ['Kit Printing', 'retail', 16], ['Coffee', 'cafe', 12], ['First Aid & Guest Services', 'service', 14], ['Bakery', 'cafe', 14], ['Matchday Bar', 'bar', 28]] },
    { y: 5.8, h: 4.4, title: 'Level 1 · Shops', units: [['adidas Store', 'retail', 40], ['Kids Kit Room', 'retail', 16], ['Books & Programmes', 'retail', 14], ['Jewellers', 'retail', 12], ['Sports Store', 'retail', 24], ['Pharmacy', 'retail', 12], ['Fashion', 'retail', 18], ['Gift Shop', 'retail', 14]] },
    { y: 11.6, h: 4.4, title: 'Level 2 · Restaurants', units: [['Busby’s Kitchen', 'rest', 30], ['Noodle Bar', 'rest', 18], ['Stretford End Grill', 'rest', 28], ['Pizza', 'rest', 18], ['Seafood', 'rest', 22], ['Gelato', 'cafe', 12], ['Curry House', 'rest', 22]] },
    { y: 17.4, h: 4.4, title: 'Level 3 · Museum & Hall of Fame', units: [['Manchester United Museum', 'museum', 90], ['Munich Memorial Gallery', 'museum', 34], ['Trophy Room', 'museum', 40], ['Museum Café', 'cafe', 16], ['Education Rooms', 'office', 20]] },
    { y: 23.2, h: 4.4, title: 'Level 4 · Bars', units: [['Treble ’99 Sports Bar', 'bar', 34], ['The 1878 Tavern', 'bar', 26], ['Holy Trinity Bar', 'bar', 26], ['Wine Bar', 'bar', 18], ['Craft Beer Hall', 'bar', 30]] },
    { y: 29, h: 4.4, title: 'Level 5 · VIP Lounges', units: [['Sir Matt Busby Suite', 'vip', 44], ['Trinity Lounge', 'vip', 34], ['Legends Lounge', 'vip', 34], ['Treble Suite', 'vip', 30], ['Charlton Club', 'vip', 30]] },
    { y: 34.4, h: 4.4, title: 'Level 6 · Club Offices', units: [['Club Offices', 'office', 50], ['United Foundation', 'office', 28], ['Media Centre', 'office', 36], ['Meeting Rooms', 'office', 22]] },
    { y: 40.2, h: 4.4, title: 'Level 7 · Executive Dining', units: [['Executive Box', 'vip', 12]] },
    { y: 46, h: 4.4, title: 'Level 8 · Sky Restaurant & Rooftop Bar', units: [['The Theatre Restaurant', 'rest', 60], ['Rooftop Bar', 'bar', 40], ['Private Dining', 'vip', 24]] },
  ];
  const STYLE = {
    mega: ['#c8102e', '#fff', '#f6e6c8'], retail: ['#1d1f22', '#fff', '#f4f1ea'], food: ['#2f3b2a', '#f1c040', '#f2d8a8'], cafe: ['#6b4a2b', '#fff', '#f2d8a8'],
    bar: ['#3a0c14', '#ff5a6e', '#d9925a'], rest: ['#3a2a1e', '#f1c040', '#eebd7f'], museum: ['#0d0d0d', '#c9a34a', '#7f6a48'], vip: ['#0b2a2a', '#c9a34a', '#9fd6cd'],
    office: ['#e9edf0', '#2a4a5e', '#cfe0ea'], service: ['#c8102e', '#fff', '#f0f0f0'],
  };
  const POOL = {
    retail: ['Boot Room', 'Retro Shirts', 'Sports Optics', 'Phone & Tech', 'Watches', 'Trainers', 'Outdoor Store', 'Travel Shop', 'Stationery', 'Toy Shop', 'Sunglasses', 'Perfumery', 'Barber', 'Florist', 'Newsagent', 'Record Shop'],
    rest: ['Trattoria', 'Steakhouse', 'Sushi Bar', 'Tapas', 'Burger Kitchen', 'Thai Kitchen', 'Lebanese Grill', 'Fish & Chips', 'Ramen House', 'Brasserie', 'Dim Sum', 'Taqueria'],
    bar: ['Cocktail Bar', 'Gin Bar', 'Whisky Lounge', 'Cider House', 'Rum Bar', 'Sports Bar 2', 'Terrace Bar', 'Champagne Bar'],
    cafe: ['Juice Bar', 'Patisserie', 'Tea Room', 'Bagel Bar', 'Crêperie', 'Doughnuts', 'Espresso Bar'],
    food: ['Street Food Market'], museum: ['Academy Gallery', 'Women’s Team Gallery', 'Kit Archive', 'Newton Heath Room', 'Treble Gallery'],
    vip: ['Champions Lounge', 'Red Devils Club', 'Directors’ Lounge', 'Captains’ Club', 'Heritage Suite', 'Edwards Lounge', 'Best Suite', 'Law Lounge', 'Trinity Box'],
    office: ['Scouting Department', 'Ticketing Office', 'Commercial Office', 'Community Office', 'Stadium Operations', 'Security Control', 'Analytics Lab', 'Academy Admin'],
    service: ['Lost Property', 'Family Room', 'Prayer Room', 'Accessibility Hub', 'Cloakroom'], mega: ['United Megastore'],
  };
  const used = new Set(), seq = {};
  const uniqueName = (name, kind) => {
    if (name === 'Executive Box') { seq.box = (seq.box || 0) + 1; return 'Executive Box ' + String(seq.box).padStart(2, '0'); }
    if (!used.has(name)) { used.add(name); return name; }
    const pool = POOL[kind] || []; for (const n of pool) if (!used.has(n)) { used.add(n); return n; }
    seq[kind] = (seq[kind] || 1) + 1; const n = name + ' ' + seq[kind]; used.add(n); return n;
  };
  const units = [], labels = [];
  for (const L of PROGRAM) {
    const e = L.d ? ring(L.d, L.y, L.inset) : ring(backD(L.y + 0.1), L.y, INSET);
    const len = (i) => Math.hypot(e.inner[(i + 1) % N][0] - e.inner[i][0], e.inner[(i + 1) % N][1] - e.inner[i][1]);
    const cores = [...Array(8)].map((_, j) => Math.round((j + 0.5) / 8 * N) % N), nearCore = (i) => cores.some((c) => Math.min(Math.abs(i - c), N - Math.abs(i - c)) <= 2);
    let i = 0, k = 0, labelled = new Set();
    while (i < N - 2) {
      if (nearCore(i)) { i++; continue; }
      const [name0, kind, want] = L.units[k++ % L.units.length];
      let j = i, acc = 0; while (j < N && acc < want && !nearCore(j)) { acc += len(j); j++; }
      if (j - i < 2) { i = j + 1; continue; }
      const name = uniqueName(name0, kind);
      units.push({ L, e, i0: i, i1: j, name, kind });
      {   // every unit is labelled
        labelled.add(name); const m = Math.floor((i + j) / 2);
        const [mx, mz] = e.inner[m], [ox, oz] = e.outer[m], dl = Math.hypot(ox - mx, oz - mz), tf = (Math.min(22, Math.max(3, dl - 5)) + 1.2) / dl;   // just outside the shopfront
        labels.push({ name: name + ' · ' + L.title.split(' · ')[0], x: mx + (ox - mx) * tf, y: L.y + 2.5, z: mz + (oz - mz) * tf, interior: true, kind, desc: describe(name, kind, acc, L.title) });
      }
      i = j + 1;
    }
    const m0 = Math.floor(N * 0.27); labels.push({ name: L.title, x: e.outer[m0][0], y: L.y + 1.5, z: e.outer[m0][1], interior: true, major: true, desc: floorDesc(L) });
  }
  function describe(name, kind, m, level) {
    const area = Math.round(m * 9 / 10) * 10, what = { mega: 'The club’s flagship store across the full concourse frontage: kits, printing, training wear and a matchday pick-up counter.',
      retail: 'A shop unit off the Level 1 promenade.', food: 'A food hall of independent Manchester traders, with shared seating out on the concourse.', cafe: 'A café with seating spilling onto the promenade.',
      bar: 'A bar open on matchdays and every evening, looking out through the atrium to the glass skin.', rest: 'A restaurant with a terrace over the atrium.', museum: 'Part of the club museum: the story of Manchester United from Newton Heath to today.',
      vip: 'Hospitality with its own lounge and direct access to padded seats in the bowl.', office: 'Club workspace with views across the atrium.', service: 'Fan services.' }[kind];
    return `${what} About ${area.toLocaleString('en-GB')} m², ${level}.`;
  }
  function floorDesc(L) { return `${L.units.length > 1 ? L.units.map((u) => u[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ') : 'A ring of ' + L.units[0][0].toLowerCase() + 'es'} round a 5 m promenade along the atrium edge.`; }

  // build the units: lit interior faces behind a glazed front, a named fascia, solid party walls and a ceiling
  const fasciaAtlas = document.createElement('canvas'); fasciaAtlas.width = 2048; fasciaAtlas.height = 64 * Math.ceil(units.length / 4);
  const fa = fasciaAtlas.getContext('2d');
  const buckets = {}, add = (k, arr, uv) => { const b = buckets[k] ||= { pos: [], uv: [] }; b.pos.push(...arr); b.uv.push(...uv); };
  const quad = (k, a, b, c, d, uv = [0, 0, 1, 0, 1, 1, 0, 1]) => add(k, [...a, ...b, ...c, ...a, ...c, ...d], [uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]]);
  units.forEach((u, n) => {
    const { L, e, i0, i1, kind, name } = u, y0 = L.y, y1 = L.y + L.h, PROM = 5;
    const front = (i) => { const [ix, iz] = e.inner[i % N], [ox, oz] = e.outer[i % N], dl = Math.hypot(ox - ix, oz - iz), t = Math.min(22, Math.max(3, dl - PROM)) / dl; return [ix + (ox - ix) * t, iz + (oz - iz) * t]; };
    const [bg, fg] = STYLE[kind];
    const cx = (n % 4) * 512, cy = Math.floor(n / 4) * 64;
    fa.fillStyle = bg; fa.fillRect(cx, cy, 512, 64); fa.fillStyle = fg; fa.font = '700 26px Arial'; fa.textAlign = 'center'; fa.textBaseline = 'middle';
    const tw = fa.measureText(name).width, ks = Math.min(1, 480 / tw); fa.save(); fa.translate(cx + 256, cy + 33); fa.scale(ks, ks); fa.fillText(name, 0, 0); fa.restore();
    const fu0 = cx / 2048, fu1 = (cx + 512) / 2048, fuS = (cx + 3) / 2048, fv0 = 1 - (cy + 64) / fasciaAtlas.height, fv1 = 1 - cy / fasciaAtlas.height;
    let acc = 0; const total = (() => { let t = 0; for (let i = i0; i < i1; i++) { const a = front(i), b = front(i + 1); t += Math.hypot(b[0] - a[0], b[1] - a[1]); } return t; })();
    for (let i = i0; i < i1; i++) {
      const a = front(i), b = front(i + 1), ia = e.inner[i % N], ib = e.inner[(i + 1) % N], sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ua = acc / total, ub = (acc + sl) / total; acc += sl;
      quad('glass_' + kind, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1 - 0.9, b[1]], [a[0], y1 - 0.9, a[1]], [ua * total / 6, 0, ub * total / 6, 0, ub * total / 6, 1, ua * total / 6, 1]);
      quad('fascia', [a[0], y1 - 0.9, a[1]], [b[0], y1 - 0.9, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [fuS, fv0 + 0.001, fuS, fv0 + 0.001, fuS, fv0 + 0.001, fuS, fv0 + 0.001]);   // plain band in the unit's colour
      quad('ceil', [ia[0], y1, ia[1]], [ib[0], y1, ib[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]);
      quad('interior_' + kind, [ia[0], y0 + 0.01, ia[1]], [ib[0], y0 + 0.01, ib[1]], [b[0], y0 + 0.01, b[1]], [a[0], y0 + 0.01, a[1]]);
    }
    { // name sign centred on the fascia, 7.2 m x 0.9 m (the atlas cell's 8:1), standing just proud of it, reading from the void
      const mi = Math.floor((i0 + i1) / 2), c0 = front(mi), c1 = front(mi + 1), tx = c1[0] - c0[0], tz = c1[1] - c0[1], tl = Math.hypot(tx, tz), hw = Math.min(3.6, total * 0.45);
      const ux = tx / tl, uz = tz / tl, ix = e.inner[mi % N], ox = c0[0] - ix[0], oz = c0[1] - ix[1], ol = Math.hypot(ox, oz), px = c0[0] + ox / ol * 0.06, pz = c0[1] + oz / ol * 0.06;
      const wv = hw / 3.6, du = (fu1 - fu0) * (1 - wv) / 2;
      quad('fascia', [px + ux * hw, y1 - 0.9, pz + uz * hw], [px - ux * hw, y1 - 0.9, pz - uz * hw], [px - ux * hw, y1, pz - uz * hw], [px + ux * hw, y1, pz + uz * hw], [fu0 + du, fv0, fu1 - du, fv0, fu1 - du, fv1, fu0 + du, fv1]);
    }
    for (const i of [i0, i1]) { const a = front(i), ia = e.inner[i % N]; quad('wall', [ia[0], y0, ia[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [ia[0], y1, ia[1]]); }
  });
  const glazing = (kind) => { const [bg, , lit] = STYLE[kind]; return canvasTex(128, 128, (c) => {
    const gr = c.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, lit); gr.addColorStop(1, bg === '#e9edf0' ? '#a9c3d2' : '#5a4632'); c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
    c.fillStyle = 'rgba(30,25,20,0.35)'; for (let x = 10; x < 128; x += 26) c.fillRect(x, 70 + (x % 3) * 6, 9, 58 - (x % 3) * 6);     // people / displays
    c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(0, 0, 128, 10); c.fillStyle = '#d7dcde'; c.fillRect(0, 0, 4, 128); c.fillRect(62, 0, 3, 128); }); };
  const fasciaTex = new THREE.CanvasTexture(fasciaAtlas); fasciaTex.colorSpace = THREE.SRGBColorSpace; fasciaTex.anisotropy = 8;
  for (const [k, b] of Object.entries(buckets)) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2)); geo.computeVertexNormals();
    let mat;
    if (k === 'fascia') mat = new THREE.MeshBasicMaterial({ map: fasciaTex, side: THREE.DoubleSide });
    else if (k === 'ceil') mat = std(0xf2efe9, { side: THREE.DoubleSide });
    else if (k === 'wall') mat = std(0xdedad3, { side: THREE.DoubleSide });
    else if (k.startsWith('glass_')) { const t = glazing(k.slice(6)); mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.2, side: THREE.DoubleSide }); mat.userData.nightGlow = true; }
    else mat = std(new THREE.Color(STYLE[k.slice(9)][2]).multiplyScalar(0.8), { side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat); m.name = 'fitout_' + k; g.add(m);
  }
  g.userData.labels = labels;

  // café tables and planters on the ground concourse
  const R = rng(3), tbl = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.75, 10), std(0xffffff), 600);
  const tree = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 1), std(0x4e7a3a, { flatShading: true }), 80);
  const mtx = new THREE.Matrix4(); let nt = 0, ntr = 0;
  for (const { y, outer } of [{ y: 0.4, outer: ring(30, 0.4, 3).outer }, ...edges]) {
    for (let k = 0; k < 75 && nt < 600; k++) {
      const i = Math.floor(R() * N), e = ring(y < 1 ? 30 : backD(y + 0.1), y, y < 1 ? 3 : INSET), dl = Math.hypot(e.outer[i][0] - e.inner[i][0], e.outer[i][1] - e.inner[i][1]), f = y < 1 ? Math.min(0.95, (24 + R() * Math.max(1, dl - 27)) / dl) : 1 - (1.5 + R() * 2.5) / dl;   // on the promenade, clear of the units
      const x = e.inner[i][0] + (e.outer[i][0] - e.inner[i][0]) * f, z = e.inner[i][1] + (e.outer[i][1] - e.inner[i][1]) * f;
      mtx.makeTranslation(x, y + 0.38, z); tbl.setMatrixAt(nt++, mtx);
      if (y < 1 && ntr < 80 && R() < 0.5) { mtx.makeTranslation(x + 3, y + 2.4, z + 3); tree.setMatrixAt(ntr++, mtx); }
    }
  }
  tbl.count = nt; tree.count = ntr; g.add(tbl, tree);
  g.userData.walkable = walk; g.userData.solids = solids;
  return g;
}
