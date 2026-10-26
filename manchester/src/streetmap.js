// Street map: a plain polyline plan of the new street network and the names it carries, drawn as SVG in local
// metres (x east, z south, so north is up). Pan by dragging, zoom with the wheel or the buttons; click a street
// for who it is named after.
const NS = 'http://www.w3.org/2000/svg';
export const THEMES = {
  lens:    { t: 'The Busby Babes & Munich', c: '#e8b54a' },
  freight: { t: 'The 1968 European Cup side', c: '#ef5a43' },
  tri:     { t: 'The 1999 Treble', c: '#4ea3f0' },
  north:   { t: 'Ferguson’s later sides & Ella Toone', c: '#46c487' },
  ote:     { t: 'The pioneers & the 1970s–80s', c: '#b98cf5' },
  other:   { t: 'Bridges', c: '#e9e3dc' },
  history: { t: 'Club history', c: '#d9c7a8' },
};
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.appendChild(e); return e; };
const pts = (l) => l.map(([x, z]) => `${x},${z}`).join(' ');
const len = (l) => l.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);

export function createStreetMap(root, data, { onShow, arena }) {
  const { plan, ctx, site } = data;
  const svg = el('svg', { class: 'smap', role: 'img', 'aria-label': 'Street map of the new neighbourhood' }, root);
  const g = el('g', {}, svg);
  // extent: the new streets and walks, padded
  const all = [...plan.roads.filter((r) => r.kind !== 'existing'), ...plan.walks].flatMap((r) => r.l);
  const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]);
  const home = { x0: Math.min(...xs) - 120, x1: Math.max(...xs) + 120, z0: Math.min(...zs) - 120, z1: Math.max(...zs) + 120 };
  // the land the scheme redevelops: its old roads are gone, so the map leaves them out
  const devPolys = ['stadiumSite', 'northBank', 'northWharf', 'freightDev', 'otEast', 'lensDev'].map((k) => site[k]).filter(Boolean);
  const inPoly = ([x, z], P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const demolished = (l) => l.filter((p) => devPolys.some((P) => inPoly(p, P))).length > l.length * 0.4;
  const inView = (l) => l.some(([x, z]) => x > home.x0 - 600 && x < home.x1 + 600 && z > home.z0 - 600 && z < home.z1 + 600);

  // ground: parcels, water, rail, the existing streets
  const L = { base: el('g', { class: 'm-base' }, g), roads: el('g', { class: 'm-roads' }, g), places: el('g', { class: 'm-places' }, g), streets: el('g', { class: 'm-streets' }, g), names: el('g', { class: 'm-names' }, g), marks: el('g', { class: 'm-marks' }, g) };
  for (const k of ['stadiumSite', 'northBank', 'northWharf', 'freightDev', 'otEast', 'lensDev']) if (site[k]) el('polygon', { points: pts(site[k]), class: 'm-parcel' }, L.base);
  for (const b of plan.blocks) el('polygon', { points: pts(b.p), class: 'm-block' }, L.base);
  for (const w of ctx.water) if (inView(w.p)) el('polygon', { points: pts(w.p), class: 'm-water' }, L.base);
  for (const c of ctx.canal) if (inView(c.l)) el('polyline', { points: pts(c.l), class: 'm-canal', 'stroke-width': c.w || 18 }, L.base);
  for (const r of ctx.rails) if (inView(r.l)) el('polyline', { points: pts(r.l), class: 'm-rail' }, L.base);
  const kept = ctx.roads.filter((r) => r.w >= 6 && inView(r.l) && !demolished(r.l));
  for (const r of kept) el('polyline', { points: pts(r.l), class: 'm-road', 'stroke-width': r.w }, L.roads);
  for (const r of plan.roads.filter((r) => r.kind === 'existing')) el('polyline', { points: pts(r.l), class: 'm-road keep', 'stroke-width': r.w }, L.roads);
  for (const w of plan.walks) el('polyline', { points: pts(w.l), class: 'm-walk', 'stroke-width': w.w }, L.roads);
  for (const b of plan.bridges) el('line', { x1: b.a[0], y1: b.a[1], x2: b.b[0], y2: b.b[1], class: 'm-bridge', 'stroke-width': b.w + 3 }, L.roads);
  // the two grounds
  if (arena) el('ellipse', { cx: arena.x, cy: arena.z, rx: 148, ry: 124, transform: `rotate(${-arena.rot * 180 / Math.PI} ${arena.x} ${arena.z})`, class: 'm-ground' }, L.marks);
  if (ctx.stadium) el('polygon', { points: pts(ctx.stadium), class: 'm-ground' }, L.marks);
  const mark = (x, z, t) => { const e = el('text', { x, y: z, class: 'm-place' }, L.marks); e.textContent = t; return e; };
  if (arena) mark(arena.x, arena.z, 'The Flowers of Manchester Arena');
  mark(0, 0, 'Old Trafford');
  if (plan.special?.station) mark(plan.special.station.x, plan.special.station.z - 30, 'Station');

  // the real streets keep their own names, in grey along their longest stretch
  const realNames = new Map();
  for (const r of [...kept, ...plan.roads.filter((r) => r.kind === 'existing')]) {
    const n = r.n || r.name; if (!n) continue;
    if (!realNames.has(n) || len(r.l) > len(realNames.get(n))) realNames.set(n, r.l);
  }
  const realLabels = [];
  let rn = 0;
  for (const [n, l0] of realNames) {
    let l = l0; if (l[l.length - 1][0] < l[0][0]) l = l.slice().reverse();
    const id = 'rp' + rn++; el('path', { id, d: 'M' + l.map((p) => p.join(',')).join('L'), fill: 'none', stroke: 'none' }, L.names);
    const t = el('text', { class: 'm-name real', dy: '-0.75em' }, L.names), tp = el('textPath', { href: '#' + id, startOffset: '50%', 'text-anchor': 'middle' }, t);
    tp.textContent = n; realLabels.push({ t, segLen: len(l), name: n });
  }

  // the new streets and bridges, coloured by theme, and their names along the longest stretch
  const byStreet = new Map();
  const named = [...plan.roads, ...plan.bridges.filter((b) => b.sid != null).map((b) => ({ l: [b.a, b.b], w: b.w, sid: b.sid }))];
  named.forEach((r) => { if (r.sid == null) return; (byStreet.get(r.sid) || byStreet.set(r.sid, []).get(r.sid)).push(r); });
  const items = [];
  plan.streets.forEach((s, sid) => {
    const segs = byStreet.get(sid) || []; if (!segs.length) return;
    const th = THEMES[s.theme] || THEMES.other, grp = el('g', { class: 'm-street', tabindex: 0, role: 'button', 'aria-label': `${s.name}, named for ${s.person}` }, L.streets);
    grp.style.setProperty('--c', th.c);
    for (const r of segs) { el('polyline', { points: pts(r.l), class: 'm-hit', 'stroke-width': r.w + 14 }, grp); el('polyline', { points: pts(r.l), class: 'm-line', 'stroke-width': r.w }, grp); }
    const longest = segs.reduce((a, r) => (len(r.l) > len(a.l) ? r : a));
    let l = longest.l; if (l[l.length - 1][0] < l[0][0]) l = l.slice().reverse();   // read left to right
    const id = 'sp' + sid; el('path', { id, d: 'M' + l.map((p) => p.join(',')).join('L'), fill: 'none', stroke: 'none' }, L.names);
    const t = el('text', { class: 'm-name', dy: '-0.75em' }, L.names), tp = el('textPath', { href: '#' + id, startOffset: '50%', 'text-anchor': 'middle' }, t);
    tp.textContent = s.name;
    const mid = l[Math.floor(l.length / 2)];
    const it = { s, sid, key: sid, grp, t, segLen: len(l), mid, segs };
    grp.addEventListener('click', (e) => { e.stopPropagation(); select(sid); });
    grp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(sid); } });
    items.push(it);
  });
  // the places between the buildings: lanes, passages, arcades and yards as lines; courtyards and greens as areas
  const KIND = { lane: 'Lane between the blocks', court: 'Courtyard and the passages through to it', arcade: 'Arcade through the block', yard: 'Service yard', park: 'Pocket green' };
  (plan.places || []).forEach((s, i) => {
    const key = 'p' + i, th = THEMES[s.theme] || THEMES.other;
    const grp = el('g', { class: 'm-street m-place-g ' + s.kind, tabindex: 0, role: 'button', 'aria-label': `${s.name}, named for ${s.person}` }, L.places);
    grp.style.setProperty('--c', th.c);
    for (const p of s.polys) el('polygon', { points: pts(p), class: 'm-area' }, grp);
    for (const l of s.lines) { el('polyline', { points: pts(l), class: 'm-hit', 'stroke-width': s.w + 10 }, grp); el('polyline', { points: pts(l), class: 'm-line thin', 'stroke-width': s.w }, grp); }
    let t, segLen, mid;
    const P = s.polys[0];
    if (P && (s.kind === 'court' || s.kind === 'park' || !s.lines.length)) {
      const cx = P.reduce((a, p) => a + p[0], 0) / P.length, cz = P.reduce((a, p) => a + p[1], 0) / P.length, X = P.map((p) => p[0]);
      t = el('text', { x: cx, y: cz, class: 'm-name small', dy: '0.35em', 'text-anchor': 'middle' }, L.names); t.textContent = s.name;
      segLen = Math.max(...X) - Math.min(...X) + 30; mid = [cx, cz];
    } else if (s.lines.length) {
      let l = s.lines.reduce((a, b) => (len(b) > len(a) ? b : a)); if (l[l.length - 1][0] < l[0][0]) l = l.slice().reverse();
      const id = 'pp' + i; el('path', { id, d: 'M' + l.map((p) => p.join(',')).join('L'), fill: 'none', stroke: 'none' }, L.names);
      t = el('text', { class: 'm-name small', dy: '0.35em' }, L.names); const tp = el('textPath', { href: '#' + id, startOffset: '50%', 'text-anchor': 'middle' }, t); tp.textContent = s.name;
      segLen = len(l); mid = l[Math.floor(l.length / 2)];
    } else return;
    const it = { s: { ...s, kindText: KIND[s.kind] }, key, grp, t, segLen, mid, segs: [...s.lines.map((l) => ({ l })), ...s.polys.map((p) => ({ l: p }))], small: true };
    grp.addEventListener('click', (e) => { e.stopPropagation(); select(key); });
    grp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(key); } });
    items.push(it);
  });

  // card
  const card = document.createElement('div'); card.className = 'm-card'; card.hidden = true; root.appendChild(card);
  let selected = null;
  function select(key, { zoom = false } = {}) {
    const it = items.find((i) => i.key === key); if (!it) return;
    items.forEach((i) => i.grp.classList.toggle('sel', i === it)); selected = it;
    const th = THEMES[it.s.theme] || THEMES.other;
    card.style.setProperty('--c', th.c);
    card.innerHTML = `<button class="m-x" aria-label="Close">✕</button><div class="m-theme">${th.t}</div><h3>${it.s.name}</h3>
      <p class="m-for">Named for <b>${it.s.person}</b> · ${it.s.honour}</p><p>${it.s.note}</p><p class="m-meta">${it.s.kindText || (it.s.len.toLocaleString('en-GB') + ' m of street')}</p>
      <button class="pill m-go">Show in 3D</button>`;
    card.hidden = false;
    card.querySelector('.m-x').onclick = () => { card.hidden = true; items.forEach((i) => i.grp.classList.remove('sel')); selected = null; };
    card.querySelector('.m-go').onclick = () => onShow?.(it.mid, it.s);
    if (zoom) { const all = it.segs.flatMap((r) => r.l), X = all.map((p) => p[0]), Z = all.map((p) => p[1]); fit(Math.min(...X) - 160, Math.max(...X) + 160, Math.min(...Z) - 160, Math.max(...Z) + 160); }
  }

  // pan / zoom on the viewBox; text and outlines keep their size on screen
  let vb = null;
  function apply() {
    svg.setAttribute('viewBox', `${vb.x} ${vb.z} ${vb.w} ${vb.h}`);
    const r = svg.getBoundingClientRect(), upp = vb.w / Math.max(1, r.width);   // metres per screen pixel
    svg.style.setProperty('--u', upp);
    for (const it of items) it.t.style.display = it.s.name.length * (it.small ? 5.6 : 6.6) * upp < it.segLen * 0.96 ? '' : 'none';
    for (const it of realLabels) it.t.style.display = it.name.length * 6 * upp < it.segLen * 0.9 ? '' : 'none';
  }
  function fit(x0, x1, z0, z1) {
    const r = svg.getBoundingClientRect(), a = (r.width || 800) / (r.height || 600);
    let w = x1 - x0, h = z1 - z0; if (w / h > a) h = w / a; else w = h * a;
    vb = { x: (x0 + x1) / 2 - w / 2, z: (z0 + z1) / 2 - h / 2, w, h }; apply();
  }
  const reset = () => fit(home.x0, home.x1, home.z0, home.z1);
  const zoomAt = (k, cx, cz) => { const nw = Math.min(6000, Math.max(120, vb.w * k)), s = nw / vb.w; vb = { x: cx - (cx - vb.x) * s, z: cz - (cz - vb.z) * s, w: nw, h: vb.h * s }; apply(); };
  const toMap = (e) => { const r = svg.getBoundingClientRect(); return [vb.x + (e.clientX - r.left) / r.width * vb.w, vb.z + (e.clientY - r.top) / r.height * vb.h]; };
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const [x, z] = toMap(e); zoomAt(Math.exp(e.deltaY * 0.0015), x, z); }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vb: { ...vb }, moved: false }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return; const r = svg.getBoundingClientRect(), dx = (e.clientX - drag.x) / r.width * vb.w, dz = (e.clientY - drag.y) / r.height * vb.h;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
    vb = { ...vb, x: drag.vb.x - dx, z: drag.vb.z - dz }; apply();
  });
  svg.addEventListener('pointerup', () => { drag = null; });
  svg.addEventListener('click', (e) => { if (!e.target.closest('.m-street') && !(drag?.moved)) { card.hidden = true; items.forEach((i) => i.grp.classList.remove('sel')); } }, true);
  addEventListener('resize', () => { if (!root.hidden && vb) apply(); });

  // tools + legend
  const tools = document.createElement('div'); tools.className = 'm-tools';
  tools.innerHTML = '<button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button><button aria-label="Fit the whole network">⤢</button>';
  const [bi, bo, bf] = tools.querySelectorAll('button');
  bi.onclick = () => zoomAt(0.7, vb.x + vb.w / 2, vb.z + vb.h / 2); bo.onclick = () => zoomAt(1.4, vb.x + vb.w / 2, vb.z + vb.h / 2); bf.onclick = reset;
  root.appendChild(tools);
  const legend = document.createElement('div'); legend.className = 'm-legend';
  legend.innerHTML = '<h4>Street names</h4>' + Object.entries(THEMES).filter(([k]) => plan.streets.some((s) => s.theme === k)).map(([k, v]) => `<div><i style="--c:${v.c}"></i>${v.t} <span>${plan.streets.filter((s) => s.theme === k).length}</span></div>`).join('')
    + `<div><i class="lanes"></i>Lanes, courts, arcades & yards <span>${(plan.places || []).length}</span></div>` + '<div><i class="walk"></i>Fan walks</div><div><i class="keep"></i>Existing roads</div>';
  root.appendChild(legend);

  return {
    open(sid) { root.hidden = false; requestAnimationFrame(() => { if (!vb) reset(); else apply(); if (sid != null) select(sid, { zoom: true }); }); },
    close() { root.hidden = true; },
    select: (key) => select(key, { zoom: true }),
    items,
  };
}
