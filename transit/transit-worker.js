// Warp animation — runs entirely on a worker thread via OffscreenCanvas.
// Receives messages: { type:'start', canvas, width, height, dpr, transitMs }
//                   { type:'resize', width, height, dpr }
//                   { type:'stop' }

let canvas, ctx;
let w = 0, h = 0, cx = 0, cy = 0, dpr = 1;
let stars = [];
let startedAt = null;
let transitMs = 4200;
let running = false;
let _cachedVignette = null; // rebuilt only on resize
let _cachedCore = null;

self.onmessage = ({ data }) => {
  if (data.type === 'start') {
    canvas = data.canvas;
    ctx = canvas.getContext('2d');
    transitMs = data.transitMs;
    applyResize(data.width, data.height, data.dpr);
    running = true;
    requestAnimationFrame(frame);
  } else if (data.type === 'resize') {
    applyResize(data.width, data.height, data.dpr);
  } else if (data.type === 'stop') {
    running = false;
  }
};

function applyResize(width, height, pixelRatio) {
  w = width; h = height; cx = w / 2; cy = h / 2; dpr = pixelRatio;
  canvas.width  = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _cachedVignette = null; _cachedCore = null; // invalidate on resize
  seedStars();
}

function seedStars() {
  const count = Math.round((w * h) / 2600);
  stars = Array.from({ length: count }, createStar);
}

/**
 * Where a star may live: from just outside the core to the far corner.
 *
 * The core is an opaque black disc painted over the middle of the field every
 * frame (`_cachedCore`, radius 0.13). Stars used to be seeded at
 * `pow(random, 1.9) * 0.42 * max(w,h)`, which put **54% of them underneath it**
 * — invisible from the first frame — and never reached past 61% of the way to
 * a corner, so the outer field was empty as well. Between the two, most of the
 * screen had nothing on it until the acceleration had carried the survivors
 * out, which is why the warp read as slow to start.
 */
const coreRadius  = () => Math.max(w, h) * 0.14;
const fieldRadius = () => Math.hypot(w, h) / 2;

/** Uniform in AREA, so the field is evenly dense rather than centre-heavy. */
function seedRadius() {
  const rMin = coreRadius();
  const rMax = fieldRadius();
  return Math.sqrt(Math.random() * (rMax * rMax - rMin * rMin) + rMin * rMin);
}

function createStar() {
  return {
    angle: Math.random() * Math.PI * 2,
    radius: seedRadius(),
    speed: 0.9 + Math.random() * 1.9,
    depth: 0.25 + Math.random() * 0.75,
    size:  0.6  + Math.random() * 1.8,
    drift: (Math.random() - 0.5) * 0.002,
    glow:  0.35 + Math.random() * 0.65,
  };
}

function resetStar(star) {
  star.angle  = Math.random() * Math.PI * 2;
  // Just outside the core, not at 0.06 of the screen -- that was inside it,
  // so every recycled star went dark for a moment before reappearing.
  star.radius = coreRadius() * (1 + Math.random() * 0.25);
  star.speed  = 0.9 + Math.random() * 1.9;
  star.depth  = 0.25 + Math.random() * 0.75;
  star.size   = 0.6  + Math.random() * 1.8;
  star.drift  = (Math.random() - 0.5) * 0.002;
  star.glow   = 0.35 + Math.random() * 0.65;
}

function frame(now) {
  if (!running) return;
  if (startedAt === null) startedAt = now;

  const elapsed      = Math.min(now - startedAt, transitMs);
  const progress     = elapsed / transitMs;
  // Starts at 4.2, not 1.2: at the old base a typical star had moved 49 px
  // after a quarter second, which is a still picture. The peak is where it
  // was, so the end of the run is unchanged.
  const acceleration = 4.2 + progress * 9.0;

  ctx.clearRect(0, 0, w, h);

  if (!_cachedVignette) {
    _cachedVignette = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.85);
    _cachedVignette.addColorStop(0,    'rgba(0,0,0,0.10)');
    _cachedVignette.addColorStop(0.18, 'rgba(0,0,0,0)');
    _cachedVignette.addColorStop(1,    'rgba(0,0,0,0.92)');
  }
  ctx.fillStyle = _cachedVignette;
  ctx.fillRect(0, 0, w, h);

  for (const star of stars) {
    star.angle += star.drift;
    const prevRadius = star.radius;
    star.radius += star.speed * acceleration * (0.55 + star.depth);

    const x1 = cx + Math.cos(star.angle) * prevRadius;
    const y1 = cy + Math.sin(star.angle) * prevRadius;
    const x2 = cx + Math.cos(star.angle) * star.radius;
    const y2 = cy + Math.sin(star.angle) * star.radius;

    if (x2 < -120 || x2 > w + 120 || y2 < -120 || y2 > h + 120) {
      resetStar(star);
      continue;
    }

    const alpha     = Math.min(0.98, 0.45 + progress * 0.35 + star.depth * 0.4);
    const lineWidth = Math.max(0.9, star.size * (0.75 + progress * 1.85));

    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.35, `rgba(255,255,255,${Math.round(alpha * 45) / 100})`);
    grad.addColorStop(1,    `rgba(255,255,255,${Math.round(alpha * 100) / 100})`);

    ctx.strokeStyle = grad;
    ctx.lineWidth   = lineWidth;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (Math.hypot(x2 - x1, y2 - y1) > 4) {
      ctx.fillStyle = `rgba(235,244,255,${Math.round(alpha * star.glow * 100) / 100})`;
      ctx.beginPath();
      ctx.arc(x2, y2, Math.max(0.4, lineWidth * 0.42), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (!_cachedCore) {
    _cachedCore = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.12);
    _cachedCore.addColorStop(0,    'rgba(0,0,0,0.98)');
    _cachedCore.addColorStop(0.18, 'rgba(0,0,0,0.88)');
    _cachedCore.addColorStop(0.55, 'rgba(0,0,0,0.06)');
    _cachedCore.addColorStop(1,    'rgba(0,0,0,0)');
  }
  ctx.fillStyle = _cachedCore;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(w, h) * 0.13, 0, Math.PI * 2);
  ctx.fill();

  requestAnimationFrame(frame);
}
