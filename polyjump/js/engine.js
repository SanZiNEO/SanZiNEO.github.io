// PolyJump H5 纯前端核心引擎（纯 JS，无 DOM 依赖）
// 从 Python 版完整项目移植：几何 / 方向 / 走法 / 规则 / AI

/* ==================== 基础工具 ==================== */

export const pk = (p) => p[0] + "," + p[1] + "," + p[2];

export function parsePoint(s) {
  const [x, y, z] = s.split(",").map(Number);
  return [x, y, z];
}

export function addVec(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function subVec(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scaleVec(v, k) { return [v[0] * k, v[1] * k, v[2] * k]; }
export function manhattan(a, b) { return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]); }
export function euclidean(a, b) { return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); }
export function chebyshev(a, b) { return Math.max(Math.abs(a[0]-b[0]), Math.abs(a[1]-b[1]), Math.abs(a[2]-b[2])); }

export function expandVector(v) {
  const axes = v.map(c => c === 0 ? [0] : [c, -c]);
  const out = [];
  function rec(i, cur) {
    if (i === axes.length) { out.push(cur.slice()); return; }
    for (const val of axes[i]) { cur.push(val); rec(i + 1, cur); cur.pop(); }
  }
  rec(0, []);
  return out;
}

/* ==================== 方向集 ==================== */

const BASE_SETS = {
  6: [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],
  8: [[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]],
  12: [[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1],[0,1,1],[0,1,-1],[0,-1,1],[0,-1,-1]],
};

const DIRECTION_SETS = {
  6: BASE_SETS[6],
  8: BASE_SETS[8],
  12: BASE_SETS[12],
  14: [...BASE_SETS[6], ...BASE_SETS[8]],
  18: [...BASE_SETS[6], ...BASE_SETS[12]],
  20: [...BASE_SETS[12], ...BASE_SETS[8]],
  26: [...BASE_SETS[6], ...BASE_SETS[12], ...BASE_SETS[8]],
};

export function resolveDirections(directionSet, customVectors = []) {
  let result = [];
  const ds = Array.isArray(directionSet) ? directionSet : [directionSet];
  for (const d of ds) {
    if (DIRECTION_SETS[d]) result = result.concat(DIRECTION_SETS[d]);
  }
  for (const cv of customVectors || []) {
    result = result.concat(expandVector(cv));
  }
  const seen = new Set();
  return result.filter(v => {
    const key = v.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ==================== 几何模型 ==================== */

function makePyramidA(corner, layers, signs, inside) {
  const cells = [];
  for (let layer = 0; layer < layers; layer++) {
    for (let dx = 0; dx <= layer; dx++) {
      for (let dy = 0; dy <= layer - dx; dy++) {
        const dz = layer - dx - dy;
        const p = [
          corner[0] + signs[0] * dx,
          corner[1] + signs[1] * dy,
          corner[2] + signs[2] * dz,
        ];
        if (inside(p)) cells.push(p);
      }
    }
  }
  return cells;
}

function geometryA(config) {
  const [a, b, c] = config.board_size;
  const points = [];
  for (let z = 0; z < c; z++)
    for (let y = 0; y < b; y++)
      for (let x = 0; x < a; x++) points.push([x, y, z]);

  const inside = (p) => p[0] >= 0 && p[0] < a && p[1] >= 0 && p[1] < b && p[2] >= 0 && p[2] < c;

  const corners = [
    [0,0,0], [a-1,0,0], [0,b-1,0], [0,0,c-1],
    [a-1,b-1,0], [a-1,0,c-1], [0,b-1,c-1], [a-1,b-1,c-1],
  ];
  const mapping = {
    2: [0,7], 3: [0,4,5], 4: [0,7,1,6], 6: [0,7,1,6,2,5], 8: [0,1,2,3,4,5,6,7],
  };
  const signsForCorner = (corner) => corner.map(v => v === 0 ? 1 : -1);
  const playerAssignments = () => {
    const indices = mapping[config.players] || [];
    const bases = {}, targets = {};
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const corner = corners[idx];
      const signs = signsForCorner(corner);
      bases[i + 1] = makePyramidA(corner, config.initial_layout.layers, signs, inside);
      const tIdx = 7 - idx;
      const tCorner = corners[tIdx];
      targets[i + 1] = makePyramidA(tCorner, config.initial_layout.layers, signsForCorner(tCorner), inside);
    }
    return { bases, targets };
  };

  return { name: "A", points, inside, playerAssignments };
}

function geometryB(config) {
  const R = config.b_radius;
  const points = [];
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++)
      for (let z = -R; z <= R; z++)
        if (Math.abs(x)+Math.abs(y)+Math.abs(z) <= R && (x+y+z)%2 === 0) points.push([x,y,z]);
  const inside = (p) => Math.abs(p[0])+Math.abs(p[1])+Math.abs(p[2]) <= R && (p[0]+p[1]+p[2])%2 === 0;

  const tips = [
    [0,1], [0,-1], [1,1], [1,-1], [2,1], [2,-1],
  ];
  const PLAYER_TIPS = { 2:[0,1], 3:[0,2,4], 4:[0,1,2,3], 6:[0,1,2,3,4,5] };

  function tipBase(axis, sign) {
    const layers = Math.floor(R / 2);
    const other = [0,1,2].filter(i => i !== axis);
    const pts = [];
    for (let s = 0; s < layers; s++) {
      const main = sign * (R - s);
      for (let a = -s; a <= s; a++) {
        for (let b = -s; b <= s; b++) {
          if (Math.abs(a)+Math.abs(b) > s) continue;
          const coords = [0,0,0];
          coords[axis] = main;
          coords[other[0]] = a;
          coords[other[1]] = b;
          if ((coords[0]+coords[1]+coords[2])%2 === 0) pts.push(coords);
        }
      }
    }
    return pts;
  }

  const playerAssignments = () => {
    const indices = PLAYER_TIPS[config.players] || [];
    const bases = {}, targets = {};
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const [axis, sign] = tips[idx];
      bases[i+1] = tipBase(axis, sign);
      const [oAxis, oSign] = tips[idx ^ 1];
      targets[i+1] = tipBase(oAxis, oSign);
    }
    return { bases, targets };
  };

  return { name: "B", points, inside, playerAssignments };
}

function geometryC(config) {
  const R = config.c_radius;
  const points = [];
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++)
      for (let z = -R; z <= R; z++)
        if (Math.abs(x)+Math.abs(y)+Math.abs(z) <= R) points.push([x,y,z]);
  const inside = (p) => Math.abs(p[0])+Math.abs(p[1])+Math.abs(p[2]) <= R;

  const tips = [
    [0,1], [0,-1], [1,1], [1,-1], [2,1], [2,-1],
  ];
  const PLAYER_TIPS = { 2:[0,1], 3:[0,2,4], 4:[0,1,2,3], 6:[0,1,2,3,4,5] };

  function tipBase(axis, sign) {
    const layers = Math.floor(R / 2);
    const other = [0,1,2].filter(i => i !== axis);
    const pts = [];
    for (let s = 0; s < layers; s++) {
      const main = sign * (R - s);
      for (let a = -s; a <= s; a++) {
        for (let b = -s; b <= s; b++) {
          if (Math.abs(a)+Math.abs(b) > s) continue;
          const coords = [0,0,0];
          coords[axis] = main;
          coords[other[0]] = a;
          coords[other[1]] = b;
          pts.push(coords);
        }
      }
    }
    return pts;
  }

  const playerAssignments = () => {
    const indices = PLAYER_TIPS[config.players] || [];
    const bases = {}, targets = {};
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const [axis, sign] = tips[idx];
      bases[i+1] = tipBase(axis, sign);
      const [oAxis, oSign] = tips[idx ^ 1];
      targets[i+1] = tipBase(oAxis, oSign);
    }
    return { bases, targets };
  };

  return { name: "C", points, inside, playerAssignments };
}

function facePyramidPoints(axis, sign, parity, k) {
  const other = [0,1,2].filter(i => i !== axis);
  const pts = [];
  for (let layer = 1; layer <= k; layer++) {
    const side = 2*k + 1 - 2*layer;
    const half = Math.floor(side / 2);
    const main = sign * (k + layer);
    for (let a = -half; a <= half; a++) {
      for (let b = -half; b <= half; b++) {
        const p = [0,0,0];
        p[axis] = main;
        p[other[0]] = a;
        p[other[1]] = b;
        if (parity == null || (p[0]+p[1]+p[2])%2 === parity) pts.push(p);
      }
    }
  }
  return pts;
}

function generateExternalPoints(k, parity) {
  const pts = [];
  for (let x = -k; x <= k; x++)
    for (let y = -k; y <= k; y++)
      for (let z = -k; z <= k; z++) {
        const p = [x,y,z];
        if (parity == null || (x+y+z)%2 === parity) pts.push(p);
      }
  for (const axis of [0,1,2]) {
    for (const sign of [1,-1]) {
      pts.push(...facePyramidPoints(axis, sign, parity, k));
    }
  }
  return pts;
}

function geometryExternal(config, opts) {
  const ep = config.ep_side;
  const k = (ep - 1) / 2;
  const points = generateExternalPoints(k, opts.parity);
  const inside = (p) => points.some(q => q[0]===p[0] && q[1]===p[1] && q[2]===p[2]);

  const tips = [
    [0,1], [0,-1], [1,1], [1,-1], [2,1], [2,-1],
  ];
  const PLAYER_TIPS = { 2:[0,1], 3:[0,2,4], 4:[0,1,2,3], 6:[0,1,2,3,4,5] };

  const playerAssignments = () => {
    const indices = PLAYER_TIPS[config.players] || [];
    const bases = {}, targets = {};
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const [axis, sign] = tips[idx];
      bases[i+1] = facePyramidPoints(axis, sign, opts.parity, k);
      const [oAxis, oSign] = tips[idx ^ 1];
      targets[i+1] = facePyramidPoints(oAxis, oSign, opts.parity, k);
    }
    return { bases, targets };
  };

  return { name: opts.name, points, inside, playerAssignments };
}

const GEOMETRY_FACTORIES = {
  A: geometryA,
  B: geometryB,
  C: geometryC,
  D: (cfg) => geometryExternal(cfg, { name: "D", parity: null }),
  A_EXT: (cfg) => geometryExternal(cfg, { name: "A-ext", parity: null }),
  B_EXT: (cfg) => geometryExternal(cfg, { name: "B-ext", parity: 0 }),
  C_EXT: (cfg) => geometryExternal(cfg, { name: "C-ext", parity: null }),
};

export function createGeometry(config) {
  const factory = GEOMETRY_FACTORIES[config.geometry];
  if (!factory) throw new Error("未知几何模型: " + config.geometry);
  return factory(config);
}

/* ==================== 棋盘 ==================== */

export class Board {
  constructor(config) {
    this.config = config;
    this.geometry = createGeometry(config);
    this.points = this.geometry.points;
    this.pieces = new Map(); // key -> player
    this.playerBases = {};
    this.playerTargets = {};
    const { bases, targets } = this.geometry.playerAssignments();
    for (const [p, list] of Object.entries(bases)) this.playerBases[p] = new Set(list.map(pk));
    for (const [p, list] of Object.entries(targets)) this.playerTargets[p] = new Set(list.map(pk));
    for (const [p, list] of Object.entries(bases)) {
      for (const pos of list) this.pieces.set(pk(pos), Number(p));
    }
  }

  inside(p) { return this.geometry.inside(p); }
  empty(p) { return !this.pieces.has(pk(p)); }
  get(p) { return this.pieces.get(pk(p)) ?? null; }
  set(p, player) { this.pieces.set(pk(p), player); }
  remove(p) { this.pieces.delete(pk(p)); }
  piecesFor(player) {
    const out = [];
    for (const [key, owner] of this.pieces) if (owner === player) out.push(parsePoint(key));
    return out;
  }
}

/* ==================== 走法生成 ==================== */

export function isJumpSegment(src, dst, directions) {
  const diff = subVec(dst, src);
  if (diff.some(d => d % 2 !== 0)) return false;
  const half = diff.map(d => d / 2);
  return directions.some(v => v[0]===half[0] && v[1]===half[1] && v[2]===half[2]);
}
export function jumpMid(src, dst) { return [ (src[0]+dst[0])/2, (src[1]+dst[1])/2, (src[2]+dst[2])/2 ]; }
export function isTwoStepSegment(src, dst, directions) {
  const diff = subVec(dst, src);
  if (diff.some(d => d % 4 !== 0)) return false;
  const quarter = diff.map(d => d / 4);
  return directions.some(v => v[0]===quarter[0] && v[1]===quarter[1] && v[2]===quarter[2]);
}
export function twoStepMid(src, dst) {
  return [ src[0] + (dst[0]-src[0])/2, src[1] + (dst[1]-src[1])/2, src[2] + (dst[2]-src[2])/2 ];
}

function dedupePaths(paths) {
  const seen = new Set();
  return paths.filter(p => {
    const key = JSON.stringify(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function allJumpPaths(board, pos, directions, maxChain = 0) {
  const results = [];
  const seenLands = new Set([pk(pos)]);
  function recurse(path, depth) {
    if (maxChain > 0 && depth >= maxChain) return;
    const current = path[path.length - 1];
    for (const v of directions) {
      const mid = addVec(current, v);
      const dest = addVec(current, scaleVec(v, 2));
      if (!board.inside(mid) || board.empty(mid) || !board.inside(dest) || !board.empty(dest)) continue;
      if (seenLands.has(pk(dest))) continue;
      seenLands.add(pk(dest));
      const newPath = path.concat([dest]);
      results.push(newPath);
      recurse(newPath, depth + 1);
    }
  }
  recurse([pos.slice()], 0);
  return results;
}

export function allTwoStepPaths(board, pos, directions) {
  const paths = [];
  for (const v of directions) {
    const q = [0,1,2,3,4].map(k => addVec(pos, scaleVec(v, k)));
    if (!q.every(p => board.inside(p))) continue;
    if (!(board.empty(q[0]) && !board.empty(q[1]) && board.empty(q[2]) && board.empty(q[3]))) continue;
    paths.push([pos.slice(), q[4]]);
  }
  return paths;
}

export function legalMovesFrom(board, pos, config) {
  const directions = resolveDirections(config.direction_set, config.custom_vectors);
  let paths = [];
  if (config.movement.allow_step) {
    for (const v of directions) {
      const dest = addVec(pos, v);
      if (board.inside(dest) && board.empty(dest)) paths.push([pos.slice(), dest]);
    }
  }
  if (config.movement.allow_jump) {
    const jumps = allJumpPaths(board, pos, directions, config.movement.max_chain_length);
    if (config.movement.hop_mode === "FREE_STOP") {
      paths = paths.concat(jumps);
    } else {
      paths = paths.concat(jumps.filter(path => !hasAnyJump(board, path[path.length-1], path, directions, config.movement.max_chain_length)));
    }
  }
  if (config.movement.two_step_hop) {
    paths = paths.concat(allTwoStepPaths(board, pos, directions));
  }
  return dedupePaths(paths);
}

export function hasAnyJump(board, pos, excludePath, directions, maxChain = 0) {
  for (const v of directions) {
    const mid = addVec(pos, v);
    const dest = addVec(pos, scaleVec(v, 2));
    if (board.inside(mid) && !board.empty(mid) && board.inside(dest) && board.empty(dest)) {
      if (!excludePath.some(p => p[0]===dest[0] && p[1]===dest[1] && p[2]===dest[2])) return true;
    }
  }
  return false;
}

export function legalMoves(board, player, config) {
  let paths = [];
  for (const pos of board.piecesFor(player)) {
    paths = paths.concat(legalMovesFrom(board, pos, config));
  }
  return dedupePaths(paths);
}

/* ==================== 规则应用 ==================== */

function findHomeSlot(board, owner, fromPos) {
  const base = [...board.playerBases[owner] || []].map(parsePoint);
  if (!base.length) return null;
  const empties = base.filter(p => board.empty(p));
  if (empties.length) {
    return empties.reduce((best, p) => manhattan(p, fromPos) < manhattan(best, fromPos) ? p : best);
  }
  const candidates = board.points.filter(p => board.empty(p));
  if (!candidates.length) return null;
  return candidates.reduce((best, p) => {
    const bestDist = Math.min(...base.map(b => manhattan(b, best)));
    const pDist = Math.min(...base.map(b => manhattan(b, p)));
    return pDist < bestDist ? p : best;
  });
}

export function applyMove(board, path, player, config) {
  if (path.length < 2) throw new Error("路径长度必须 >= 2");
  const start = path[0];
  if (board.get(start) !== player) throw new Error("起点不是当前玩家棋子");
  board.remove(start);
  const directions = resolveDirections(config.direction_set, config.custom_vectors);
  let captureCount = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const src = path[i], dst = path[i+1];
    if (board.get(src) === player) board.remove(src);
    board.set(dst, player);
    let capturedPos = null;
    if (isJumpSegment(src, dst, directions)) capturedPos = jumpMid(src, dst);
    else if (isTwoStepSegment(src, dst, directions)) capturedPos = twoStepMid(src, dst);
    if (capturedPos == null) continue;
    const owner = board.get(capturedPos);
    if (owner == null) continue;
    const inOwnBase = board.playerBases[owner] && board.playerBases[owner].has(pk(capturedPos));
    if (config.capture.mode === "NONE") continue;
    if (config.capture.capture_opponent_only && owner === player) continue;
    if (!config.capture.capture_in_base && inOwnBase) continue;
    captureCount++;
    if (config.capture.mode === "CAPTURE" || config.capture.mode === "MIXED") {
      board.remove(capturedPos);
      if (config.capture.mode === "MIXED") {
        const slot = findHomeSlot(board, owner, capturedPos);
        if (slot && board.empty(slot)) board.set(slot, owner);
      }
    }
  }
  return captureCount;
}

export function checkWinner(board, config) {
  if (config.capture.mode === "CAPTURE") {
    for (let p = 1; p <= config.players; p++) {
      if (!board.piecesFor(p).length) continue;
      const others = [];
      for (let q = 1; q <= config.players; q++) if (q !== p && board.piecesFor(q).length) others.push(q);
      if (!others.length) return p;
    }
    return null;
  }
  if (!config.goal.first_to_finish_wins) return null;
  for (let p = 1; p <= config.players; p++) {
    const target = board.playerTargets[p];
    if (!target || target.size === 0) continue;
    const pieces = board.piecesFor(p);
    if (!pieces.length) continue;
    if (config.goal.must_fill_all_cells) {
      let full = true;
      for (const t of target) {
        if (board.get(parsePoint(t)) !== p) { full = false; break; }
      }
      if (full) return p;
    } else {
      if (pieces.every(pos => target.has(pk(pos)))) return p;
    }
  }
  return null;
}

/* ==================== AI ==================== */

function buildDistanceMap(board, targetSet, directions) {
  const points = new Set(board.points.map(pk));
  const dist = new Map();
  const q = [];
  for (const t of targetSet) {
    const key = t;
    if (points.has(key) && !dist.has(key)) { dist.set(key, 0); q.push(key); }
  }
  for (let head = 0; head < q.length; head++) {
    const key = q[head];
    const p = parsePoint(key);
    const d = dist.get(key);
    for (const v of directions) {
      const n = addVec(p, v);
      const nk = pk(n);
      if (points.has(nk) && !dist.has(nk)) { dist.set(nk, d + 1); q.push(nk); }
    }
  }
  return dist;
}

export function selectMove(board, player, paths, aiType = "distance_graph") {
  if (!paths || !paths.length) return null;
  const target = board.playerTargets[player];
  if (!target || target.size === 0) return paths[0];

  const directions = resolveDirections(board.config.direction_set, board.config.custom_vectors);

  let scoreFn;
  if (aiType === "distance_euclidean") {
    scoreFn = (path) => {
      const before = Math.min(...[...target].map(t => euclidean(path[0], parsePoint(t))));
      const after = Math.min(...[...target].map(t => euclidean(path[path.length-1], parsePoint(t))));
      return before - after;
    };
  } else if (aiType === "distance_chebyshev") {
    scoreFn = (path) => {
      const before = Math.min(...[...target].map(t => chebyshev(path[0], parsePoint(t))));
      const after = Math.min(...[...target].map(t => chebyshev(path[path.length-1], parsePoint(t))));
      return before - after;
    };
  } else {
    const dist = buildDistanceMap(board, target, directions);
    scoreFn = (path) => {
      const b = dist.get(pk(path[0]));
      const a = dist.get(pk(path[path.length-1]));
      if (b == null || a == null) return 0;
      return b - a;
    };
  }

  let best = null, bestKey = null;
  for (const p of paths) {
    const key = [scoreFn(p), -p.length];
    if (!best || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = p; bestKey = key;
    }
  }
  return best;
}
