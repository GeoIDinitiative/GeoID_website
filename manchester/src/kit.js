// Shared modelling kit: palette, procedural textures, geometry helpers.
import * as THREE from 'three';

export const PAL = {
  red: 0xc8102e, deepRed: 0x8e0c22, blush: 0xf2b8c0, white: 0xf5f3ef,
  lightBlue: 0x8cc8ec, green: 0x169b62, aqua: 0x5fb8ad, gold: 0xf1c040,
  brick: 0x8a3e2c, steel: 0xd8dce1, charcoal: 0x2a2c30, asphalt: 0x3d3f43,
  paving: 0xc9c2b6, grass: 0x5f8f3e, water: 0x3d5f6b,
};

// ---------- procedural textures ----------
export function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const seatRowsTex = (base = '#c8102e', rows = 24) => canvasTex(64, 512, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < rows; i++) {
    const y = i * h / rows;
    g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(0, y, w, h / rows * 0.28);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, y + h / rows * 0.3, w, 2);
  }
  for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 1, h); }
});

// Seat texture that spans an entire tier perimeter, with white seat-lettering placed at arc fractions.
export function seatBannerTex(words, { base = '#c8102e', rows = 30, W = 8192, H = 512 } = {}) {
  return canvasTex(W, H, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f5f3ef'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const { text, at, size = 0.55, spacing = 0.18 } of words) {
      g.save(); g.translate(at * w, h * 0.5); g.scale(1, -1);
      g.font = `900 ${h * size}px Arial Black, Arial, sans-serif`;
      const chars = [...text]; const step = h * size * (0.78 + spacing);
      chars.forEach((ch, i) => g.fillText(ch, (i - (chars.length - 1) / 2) * step, 0));
      g.restore();
    }
    for (let i = 0; i < rows; i++) {
      const y = i * h / rows;
      g.fillStyle = 'rgba(0,0,0,0.34)'; g.fillRect(0, y, w, h / rows * 0.26);
    }
    // aisles
    for (let x = 0; x < w; x += 96) { g.fillStyle = 'rgba(60,60,60,0.55)'; g.fillRect(x, 0, 3, h); }
  });
}

export const glazingTex = (glass = '#5fb8ad', frame = '#e8e8e8', cols = 8, rows = 4) => canvasTex(256, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, glass); gr.addColorStop(1, shade(glass, -0.25));
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = frame; g.lineWidth = 4;
  for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo(i * w / cols, 0); g.lineTo(i * w / cols, h); g.stroke(); }
  g.lineWidth = 6;
  for (let j = 0; j <= rows; j++) { g.beginPath(); g.moveTo(0, j * h / rows); g.lineTo(w, j * h / rows); g.stroke(); }
});

// facade for residential / commercial blocks: floors of windows, optional balconies
export const facadeTex = ({ wall = '#d9d3c8', glass = '#3e5866', balcony = null, floors = 6, bays = 8 } = {}) => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = wall; g.fillRect(0, 0, w, h);
  const fh = h / floors, bw = w / bays;
  for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
    g.fillStyle = glass; g.fillRect(b * bw + bw * 0.14, f * fh + fh * 0.18, bw * 0.72, fh * 0.6);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(b * bw + bw * 0.14, f * fh + fh * 0.18, bw * 0.72, fh * 0.12);
    if (balcony && b % 2 === 0) { g.fillStyle = balcony; g.fillRect(b * bw + bw * 0.06, f * fh + fh * 0.78, bw * 0.88, fh * 0.1); }
  }
});

export const diagridTex = (line = 'rgba(255,255,255,0.95)', fill = 'rgba(255,255,255,0.0)', n = 8, lw = 3) => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = fill; g.fillRect(0, 0, w, h);
  g.strokeStyle = line; g.lineWidth = lw;
  for (let i = -n; i <= n * 2; i++) {
    g.beginPath(); g.moveTo(i * w / n, 0); g.lineTo(i * w / n + h, h); g.stroke();
    g.beginPath(); g.moveTo(i * w / n, 0); g.lineTo(i * w / n - h, h); g.stroke();
  }
}, { srgb: true });

export const pitchTex = (stripes = 18, lines = true, w = 1024, h = 660) => canvasTex(w, h, (g) => {
  for (let i = 0; i < stripes; i++) { g.fillStyle = i % 2 ? '#3f8a35' : '#4a9a3e'; g.fillRect(i * w / stripes, 0, w / stripes + 1, h); }
  if (!lines) return;
  const m = 0.03 * w; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 4;
  g.strokeRect(m, m, w - 2 * m, h - 2 * m);
  g.beginPath(); g.moveTo(w / 2, m); g.lineTo(w / 2, h - m); g.stroke();
  g.beginPath(); g.arc(w / 2, h / 2, h * 0.135, 0, Math.PI * 2); g.stroke();
  const bw = (w - 2 * m) * 0.157, bh = (h - 2 * m) * 0.593, sw = (w - 2 * m) * 0.052, sh = (h - 2 * m) * 0.27;
  for (const s of [0, 1]) {
    const x = s ? w - m - bw : m; g.strokeRect(x, (h - bh) / 2, bw, bh);
    const x2 = s ? w - m - sw : m; g.strokeRect(x2, (h - sh) / 2, sw, sh);
  }
});

export const pavingTex = (base = '#cbc4b8', joint = 'rgba(0,0,0,0.10)', n = 16) => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 6, 6); }
  g.strokeStyle = joint; g.lineWidth = 2;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * w / n, 0); g.lineTo(i * w / n, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / n); g.lineTo(w, i * h / n); g.stroke(); }
});

export const roadTex = (lanes = 2) => canvasTex(128, 512, (g, w, h) => {
  g.fillStyle = '#3b3d41'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.fillStyle = '#e8e4d8'; g.fillRect(3, 0, 3, h); g.fillRect(w - 6, 0, 3, h);
  for (let l = 1; l < lanes; l++) for (let y = 0; y < h; y += 64) g.fillRect(l * w / lanes - 2, y, 4, 32);
});

export const brickTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#8a3e2c'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 32; r++) for (let c = 0; c < 16; c++) {
    g.fillStyle = `hsl(${10 + Math.random() * 8},${45 + Math.random() * 10}%,${28 + Math.random() * 8}%)`;
    g.fillRect(c * 16 + (r % 2) * 8, r * 8, 15, 7);
  }
});

export function shade(hex, k) {
  const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + k))); return '#' + c.getHexString();
}

// ---------- geometry helpers ----------
const sgnPow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

// Superellipse point (plan), centred at origin, x = long axis, z = short axis.
export function seP(theta, a, b, n) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [a * sgnPow(c, 2 / n), b * sgnPow(s, 2 / n)];
}

// Arc-length parametrised superellipse loop with outward normals.
export function sePath(a, b, n, N = 256) {
  const M = 4096, pts = [];
  let L = 0, prev = seP(0, a, b, n); const acc = [0];
  for (let i = 1; i <= M; i++) {
    const p = seP(i / M * Math.PI * 2, a, b, n); L += Math.hypot(p[0] - prev[0], p[1] - prev[1]); acc.push(L); prev = p;
  }
  let j = 0; const out = [];
  for (let i = 0; i < N; i++) {
    const target = i / N * L; while (acc[j + 1] < target) j++;
    const f = (target - acc[j]) / (acc[j + 1] - acc[j] || 1);
    out.push((j + f) / M * Math.PI * 2);
  }
  for (const th of out) {
    const p = seP(th, a, b, n), q = seP(th + 1e-4, a, b, n);
    const tx = q[0] - p[0], tz = q[1] - p[1], tl = Math.hypot(tx, tz);
    pts.push({ x: p[0], z: p[1], nx: tz / tl, nz: -tx / tl, th });
  }
  return { pts, length: L };
}

// Sweep a section profile [{d, y}] along a closed path (offset along normal by d).
// Returns BufferGeometry with u = arclength fraction * uRepeat, v = profile fraction.
export function sweepProfile(path, profile, { uRepeat = 1, closed = true } = {}) {
  const N = path.pts.length, P = profile.length;
  const pos = [], uv = [], idx = [];
  // profile cumulative length for v
  const pl = [0]; for (let k = 1; k < P; k++) pl.push(pl[k - 1] + Math.hypot(profile[k].d - profile[k - 1].d, profile[k].y - profile[k - 1].y));
  const PL = pl[P - 1] || 1;
  // u follows true arc length of the sampled points (the θ->arc inversion is uneven near the axes)
  const cum = [0]; for (let i = 1; i <= N; i++) { const a = path.pts[i - 1], b = path.pts[i % N]; cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z)); }
  for (let i = 0; i <= N; i++) {
    const p = path.pts[i % N];
    for (let k = 0; k < P; k++) {
      const { d, y } = profile[k];
      pos.push(p.x + p.nx * d, y, p.z + p.nz * d);
      uv.push(cum[i] / cum[N] * uRepeat, pl[k] / PL);
    }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < P - 1; k++) {
    const a = i * P + k, b = (i + 1) * P + k;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

// Generic parametric surface: f(u, v) -> [x, y, z] (+ optional colour fn)
export function paramSurface(f, nu, nv, colorFn) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv; pos.push(...f(u, v)); uv.push(u, v);
    if (colorFn) col.push(...colorFn(u, v));
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = (i + 1) * (nv + 1) + j;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

// Tube along a polyline of [x,y,z]
export function tube(points, r, mat, seg) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg || Math.max(8, points.length * 2), r, 6, false), mat);
}

// Extrude a plan polygon [[x,z],...] to height h (base y0)
export function extrudePoly(poly, h, y0 = 0) {
  const s = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}

// Flat plan polygon at height y
export function flatPoly(poly, y = 0, uvScale = 1 / 40) {
  const s = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  const p = g.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * uvScale, p.getZ(i) * uvScale);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// Ribbon along a polyline in plan (roads, paths, canal); width w, at height y
export function ribbon(line, w, y = 0.05, vScale = 1 / 30) {
  const pos = [], uv = [], idx = []; let acc = 0;
  for (let i = 0; i < line.length; i++) {
    const p = line[i], a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    if (i > 0) acc += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
    pos.push(p[0] - tz * w / 2, y, p[1] + tx * w / 2, p[0] + tz * w / 2, y, p[1] - tx * w / 2);
    uv.push(0, acc * vScale, 1, acc * vScale);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

export const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.0, ...o });

// rotate+translate a plan point
export const xf = (p, ang, ox, oz) => [ox + p[0] * Math.cos(ang) - p[1] * Math.sin(ang), oz + p[0] * Math.sin(ang) + p[1] * Math.cos(ang)];

// deterministic RNG
export function rng(seed = 1) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Seat lettering laid flat on a straight stretch of a raked tier, reading correctly from the pitch.
// Built in a "north stand" frame (stand along x at z = -(R + d), rake rising towards -z), then turned by rotY.
// Rows of seats are knocked out of the letters so they read as coloured seats, not paint.
export function seatLettering({ text, img, R, d0, y0, d1, y1, rows, frac = 0.5, width, height, rotY = 0, color = '#f4f2ee', font = '900 1px "Arial Black", Arial, sans-serif' }) {
  const dd = (d1 - d0) / rows, dy = (y1 - y0) / rows, a = Math.atan2(dy, dd), pitch = Math.hypot(dd, dy);
  const W = 2048, H = Math.max(64, Math.round(W * height / width)), ppm = W / width;
  const tex = canvasTex(W, H, (g) => draw(g, null));
  function draw(g, image) {
    g.clearRect(0, 0, W, H); g.fillStyle = color;
    if (text) {
      g.font = font.replace('1px', `${H * 0.92}px`); g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = g.measureText(text).width, k = Math.min(1, W * 0.98 / tw);
      g.save(); g.translate(W / 2, H * 0.53); g.scale(k, k); g.fillText(text, 0, 0); g.restore();
    }
    if (image) { const s = Math.min(W / image.width, H / image.height) * 0.96; g.drawImage(image, (W - image.width * s) / 2, (H - image.height * s) / 2, image.width * s, image.height * s); }
    g.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < H; y += pitch * ppm) g.fillRect(0, y, W, pitch * ppm * 0.3);          // row gaps
    for (let x = 0; x < W; x += 0.5 * ppm) g.fillRect(x, 0, Math.max(1, 0.07 * ppm), H);      // seat gaps
    g.globalCompositeOperation = 'source-over';
  }
  if (img) { const im = new Image(); im.onload = () => { draw(tex.image.getContext('2d'), im); tex.needsUpdate = true; }; im.src = img; }
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }));
  const dc = d0 + frac * (d1 - d0);
  mesh.rotation.x = a - Math.PI / 2;
  mesh.position.set(0, y0 + dy + (dc - d0) * Math.tan(a) + 0.06, -(R + dc));
  const grp = new THREE.Group(); grp.add(mesh); grp.rotation.y = rotY; grp.name = 'seatLettering';
  return grp;
}
