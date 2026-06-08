// =============================================================================
// treeAlgorithms.js — pluggable tree-skeleton generators.
//
// Each generator is `(params, rand) => { segments, bounds }` and is the ONLY
// algorithm-specific part of Grovekeeper. Everything downstream (tube/knuckle
// meshing, leaves, growth+wind baking, shaders, camera) is shared in treeMesh.js.
//
//   segment = { p0, p1, rBase, rTip, t0, t1, level, tip, leaf, len }
//     p0/p1   world endpoints      rBase/rTip  radius at each end
//     t0/t1   growth window 0..1   level       0..1 (bark color / sway, root→tip)
//     tip     terminal → end cap   leaf        add a leaf cloud at p1
//   bounds = { minY, maxY, radius, centerY }   (camera framing)
// =============================================================================
import { add, scale, sub, normalize, cross } from './mat4.js';
import { mix, lerp3, clamp, frame, rotate, MIN_R } from './treeUtil.js';

const TRUNK_LEN = 1.0;

export const ALGORITHM_LIST = [
  { id: 'recursive', name: 'Recursive (fractal)' },
  { id: 'spacecol',  name: 'Space colonization' },
  { id: 'lsystem',   name: 'L-system' },
];

function makeBounds() {
  const b = { minY: 0, maxY: 0, radius: 0.0001 };
  b.track = (p) => {
    b.minY = Math.min(b.minY, p[1]); b.maxY = Math.max(b.maxY, p[1]);
    b.radius = Math.max(b.radius, Math.hypot(p[0], p[2]));
  };
  b.finish = () => { b.centerY = (b.minY + b.maxY) / 2; delete b.track; delete b.finish; return b; };
  return b;
}

// ── recursive / fractal ──────────────────────────────────────────────────────
function recursive(params, rand) {
  const segs = [], bounds = makeBounds();
  const maxDepth = Math.max(2, Math.round(params.maxDepth));
  const span = params.leafPhase / (maxDepth + 1);
  const reg = params.regularity, fAngle = params.fractalAngle;

  function grow(p0, dir, len, radBase, depth) {
    const p1 = add(p0, scale(dir, len));
    bounds.track(p0); bounds.track(p1);
    const radTip = Math.max(radBase * 0.75, MIN_R);
    const tip = depth >= maxDepth;
    segs.push({
      p0, p1, rBase: radBase, rTip: radTip, len,
      t0: depth * span, t1: (depth + 1) * span,
      level: depth / maxDepth, tip, leaf: depth >= maxDepth - 1,
    });
    if (tip) return;
    // 2–3 limbs around the full cone, first slightly dominant (apical), regularity blend
    const children = rand() < 0.5 ? 2 : 3;
    const baseRoll = rand() * Math.PI * 2;
    const [u, v] = frame(dir);
    for (let i = 0; i < children; i++) {
      const dom = i === 0;
      const phi = baseRoll + ((i + (rand() - 0.5) * 0.5) / children) * Math.PI * 2;
      const spread = dom ? mix(0.12 + rand() * 0.10, fAngle, reg) : mix(0.45 + rand() * 0.30, fAngle, reg);
      const lenF = dom ? mix(0.76 + rand() * 0.04, 0.76, reg) : mix(0.58 + rand() * 0.16, 0.76, reg);
      const radF = dom ? mix(0.82, 0.76, reg) : mix(0.60 + rand() * 0.12, 0.76, reg);
      const axis = add(scale(u, Math.cos(phi)), scale(v, Math.sin(phi)));
      let cd = normalize(add(scale(dir, Math.cos(spread)), scale(axis, Math.sin(spread))));
      cd = normalize(lerp3(cd, [0, 1, 0], 0.05 * (1 - reg)));
      grow(p1, cd, len * lenF, Math.max(radBase * radF, MIN_R), depth + 1);
    }
  }
  grow([0, 0, 0], [0, 1, 0], TRUNK_LEN, params.trunkRadius ?? 0.06, 0);
  return { segments: segs, bounds: bounds.finish() };
}

// ── space colonization (Runions 2007) ────────────────────────────────────────
// Buds grow toward unclaimed attraction markers inside a crown envelope, consuming
// markers they reach → emergent, self-organizing skeleton. Pipe-model radii.
function spacecol(params, rand) {
  const segs = [], bounds = makeBounds();
  const crownR = params.crownRadius ?? 1.2;
  const crownH = params.crownHeight ?? 1.8;
  const nMarkers = Math.max(40, Math.round(params.markerCount ?? 480));
  const stepD = Math.max(0.04, crownR * 0.13);
  const dInf = crownR * 0.95;
  const dKill = Math.max(stepD * 1.5, params.dKill ?? stepD * 1.7);
  const trunkH = 0.85;
  const cy = trunkH + crownH * 0.5;

  // markers: uniform in the crown ellipsoid (rx,rz = crownR, ry = crownH/2)
  const markers = [], alive = [];
  let guard = nMarkers * 40;
  while (markers.length < nMarkers && guard-- > 0) {
    const x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 2 - 1;
    if (x * x + y * y + z * z > 1) continue;
    markers.push([x * crownR, cy + y * (crownH * 0.5), z * crownR]); alive.push(true);
  }

  const nodes = [];
  const addNode = (pos, parent, born) => {
    const n = { pos, parent, children: [], born, radius: 0 };
    nodes.push(n);
    if (parent >= 0) nodes[parent].children.push(nodes.length - 1);
    return nodes.length - 1;
  };
  // pre-grow a trunk up to the crown so there's a stem to colonize from
  let prev = addNode([0, 0, 0], -1, 0);
  for (let y = stepD; y < trunkH; y += stepD) prev = addNode([0, y, 0], prev, 0);

  let lastIt = 1;
  for (let it = 1; it <= 400; it++) {
    const acc = new Map();   // nodeIndex -> [sumDir, count]
    for (let mi = 0; mi < markers.length; mi++) {
      if (!alive[mi]) continue;
      const m = markers[mi];
      let best = -1, bd = dInf * dInf;
      for (let ni = 0; ni < nodes.length; ni++) {
        const d = nodes[ni].pos;
        const dx = m[0] - d[0], dy = m[1] - d[1], dz = m[2] - d[2], dd = dx * dx + dy * dy + dz * dz;
        if (dd < bd) { bd = dd; best = ni; }
      }
      if (best < 0) continue;
      const e = acc.get(best) || [[0, 0, 0], 0];
      e[0] = add(e[0], normalize(sub(m, nodes[best].pos))); e[1]++;
      acc.set(best, e);
    }
    if (acc.size === 0) { lastIt = it; break; }
    const fresh = [];
    for (const [ni, e] of acc) {
      let dir = normalize(lerp3(normalize(e[0]), [0, 1, 0], 0.12));   // slight upward bias
      fresh.push(addNode(add(nodes[ni].pos, scale(dir, stepD)), ni, it));
    }
    for (let mi = 0; mi < markers.length; mi++) {
      if (!alive[mi]) continue;
      const m = markers[mi];
      for (const ni of fresh) {
        const d = nodes[ni].pos, dx = m[0] - d[0], dy = m[1] - d[1], dz = m[2] - d[2];
        if (dx * dx + dy * dy + dz * dz < dKill * dKill) { alive[mi] = false; break; }
      }
    }
    lastIt = it;
  }

  // pipe-model radii (post-order), then scale so the root = trunkRadius
  const E = 2.4;
  const radiusOf = (ni) => {
    const n = nodes[ni];
    if (n.children.length === 0) { n.radius = MIN_R; return MIN_R; }
    let s = 0; for (const c of n.children) s += Math.pow(radiusOf(c), E);
    n.radius = Math.pow(s, 1 / E); return n.radius;
  };
  radiusOf(0);
  const sr = (params.trunkRadius ?? 0.06) / (nodes[0].radius || MIN_R);
  for (const n of nodes) n.radius = Math.max(n.radius * sr, MIN_R);

  const span = trunkH + crownH;
  for (let ni = 1; ni < nodes.length; ni++) {
    const n = nodes[ni], p = nodes[n.parent];
    bounds.track(p.pos); bounds.track(n.pos);
    const t0 = clamp(p.born / lastIt, 0, 1) * params.leafPhase;
    const t1 = Math.max(t0 + 0.01, clamp(n.born / lastIt, 0, 1) * params.leafPhase);
    const tip = n.children.length === 0;
    segs.push({
      p0: p.pos, p1: n.pos, rBase: p.radius, rTip: n.radius, len: stepD,
      t0, t1, level: clamp(n.pos[1] / span, 0, 1), tip, leaf: tip,
    });
  }
  return { segments: segs, bounds: bounds.finish() };
}

// ── stochastic bracketed L-system ────────────────────────────────────────────
function lsystem(params, rand) {
  const segs = [], bounds = makeBounds();
  const iters = Math.max(1, Math.min(6, Math.round(params.lsysIters ?? 4)));
  const ang = params.lsysAngle ?? 0.42;
  const taper = clamp(params.lsysTaper ?? 0.78, 0.5, 0.95);
  const rules = ['F[+A][-A][/A]', 'F[+A][^A]', 'F[-A][&A][\\A]', 'FF[+A][-A]'];

  let s = 'A';
  for (let i = 0; i < iters; i++) {
    let out = '';
    for (const ch of s) out += ch === 'A' ? rules[Math.floor(rand() * rules.length)] : ch;
    s = out;
  }

  const maxD = iters + 1;
  let st = { pos: [0, 0, 0], dir: [0, 1, 0], up: [0, 0, 1], len: 0.55, rad: params.trunkRadius ?? 0.06, depth: 0 };
  const stack = [];
  const aj = () => (rand() - 0.5) * 0.3 * ang;   // small per-turn jitter so it's not perfectly regular
  for (const ch of s) {
    if (ch === 'F') {
      const p1 = add(st.pos, scale(st.dir, st.len));
      bounds.track(st.pos); bounds.track(p1);
      segs.push({
        p0: st.pos, p1, rBase: st.rad, rTip: Math.max(st.rad * taper, MIN_R), len: st.len,
        t0: clamp(st.depth / maxD, 0, 1) * params.leafPhase,
        t1: clamp((st.depth + 1) / maxD, 0, 1) * params.leafPhase,
        level: clamp(st.depth / maxD, 0, 1), tip: false, leaf: false,
      });
      st = { ...st, pos: p1 };
    } else if (ch === 'A') {
      const last = segs[segs.length - 1]; if (last) { last.tip = true; last.leaf = true; }
    } else if (ch === '+') st.dir = rotate(st.dir, st.up, ang + aj());
    else if (ch === '-') st.dir = rotate(st.dir, st.up, -ang + aj());
    else if (ch === '&' || ch === '^') {
      const r = normalize(cross(st.dir, st.up)), a = (ch === '&' ? 1 : -1) * ang + aj();
      st = { ...st, dir: rotate(st.dir, r, a), up: rotate(st.up, r, a) };
    } else if (ch === '/') st.up = rotate(st.up, st.dir, ang);
    else if (ch === '\\') st.up = rotate(st.up, st.dir, -ang);
    else if (ch === '[') {
      stack.push(st);
      st = { ...st, len: st.len * taper, rad: Math.max(st.rad * taper, MIN_R), depth: st.depth + 1 };
    } else if (ch === ']') { if (stack.length) st = stack.pop(); }
  }
  return { segments: segs, bounds: bounds.finish() };
}

export const ALGORITHMS = { recursive, spacecol, lsystem };
