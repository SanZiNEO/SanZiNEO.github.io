// PolyJump H5 纯前端入口：菜单 + Three.js 渲染 + 交互
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  Board, legalMoves, legalMovesFrom, applyMove as engineApplyMove, checkWinner,
  selectMove, resolveDirections, addVec, pk, parsePoint,
} from "./engine.js";

const PLAYER_COLORS = [0xff5252, 0x448aff, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00bcd4, 0xffd54f, 0x6d4c41];
const AI_TYPES = [
  ["distance_graph", "图距离 BFS"],
  ["distance_euclidean", "欧氏距离"],
  ["distance_chebyshev", "切比雪夫距离"],
];

const state = {
  board: null,
  config: null,
  currentPlayer: 1,
  winner: null,
  history: [],
  pieceSnapshots: [],
  aiPlayers: new Set(),
  aiTypes: {},
  selectedPos: null,
  legalPaths: [],
  replayStep: null,
  replayMode: false,
  replayTimer: null,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  pieceGroup: null,
  pointGroup: null,
  routeGroup: null,
  highlightGroup: null,
  pieceMeshes: [],
  highlightMeshes: [],
};

/* ---------------- 菜单 ---------------- */

function updateGeometryFields() {
  const g = document.getElementById("geometry").value;
  document.getElementById("board-size-field").classList.toggle("hidden", g !== "A");
  document.getElementById("radius-field").classList.toggle("hidden", !(g === "B" || g === "C"));
  document.getElementById("ep-side-field").classList.toggle("hidden", !["D", "A_EXT", "B_EXT", "C_EXT"].includes(g));
}

function renderAiPlayerMenu() {
  const wrap = document.getElementById("ai-player-menu");
  const count = parseInt(document.getElementById("players").value, 10);
  wrap.innerHTML = "";
  for (let i = 1; i <= count; i++) {
    const row = document.createElement("div");
    row.className = "switch-row";
    const label = document.createElement("label");
    label.className = "ai-player-label";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.aiPlayer = String(i);
    const span = document.createElement("span");
    span.textContent = "P" + i + " AI";
    label.appendChild(cb);
    label.appendChild(span);
    const sel = document.createElement("select");
    sel.className = "ai-type-select";
    sel.dataset.aiPlayer = String(i);
    for (const [value, text] of AI_TYPES) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      sel.appendChild(opt);
    }
    row.appendChild(label);
    row.appendChild(sel);
    wrap.appendChild(row);
  }
}

function updatePlayerOptions() {
  const geometry = document.getElementById("geometry").value;
  const select = document.getElementById("players");
  const allowed = geometry === "A" ? [2, 3, 4, 6, 8] : [2, 3, 4, 6];
  const current = parseInt(select.value, 10);
  const next = allowed.includes(current) ? current : allowed[allowed.length - 1];
  select.innerHTML = "";
  for (const v of allowed) {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = String(v);
    if (v === next) opt.selected = true;
    select.appendChild(opt);
  }
  renderAiPlayerMenu();
}

function readConfig() {
  const geometry = document.getElementById("geometry").value;
  const players = parseInt(document.getElementById("players").value, 10);
  const movement = {
    allow_step: document.getElementById("allow-step").checked,
    allow_jump: document.getElementById("allow-jump").checked,
    allow_chain: document.getElementById("allow-chain").checked,
    hop_mode: document.getElementById("hop-mode").value,
    two_step_hop: document.getElementById("allow-two-step").checked,
    max_chain_length: 0,
  };
  const capture = {
    mode: document.getElementById("capture-mode").value,
    capture_opponent_only: true,
    mixed_swap: false,
    capture_in_base: document.getElementById("capture-in-base").checked,
  };
  const goal = {
    objective: "FILL_TARGET",
    target_region: "OPPOSITE_CORNER",
    must_fill_all_cells: true,
    allow_pass_through_enemy: true,
    allow_stay_in_enemy: false,
    first_to_finish_wins: true,
  };

  let direction_set = [];
  let custom_vectors = [];
  if (["A", "A_EXT"].includes(geometry)) {
    if (document.getElementById("dir6").checked) direction_set.push(6);
    if (document.getElementById("dir12").checked) direction_set.push(12);
    if (document.getElementById("dir8").checked) direction_set.push(8);
    if (document.getElementById("dir2140").checked) custom_vectors.push([2, 1, 0]);
    if (document.getElementById("dir2221").checked) custom_vectors.push([2, 2, 1]);
    if (!direction_set.length && !custom_vectors.length) direction_set = [6];
  } else if (geometry === "B" || geometry === "B_EXT") {
    direction_set = [12];
  } else if (geometry === "C" || geometry === "C_EXT") {
    direction_set = [20];
  } else if (geometry === "D") {
    direction_set = [14];
  }

  const size = (document.getElementById("board-size").value || "7,7,7").split(",").map(Number);
  const initial_layout = { layers: Math.max(2, Math.floor(Math.min(...size) / 2)) };

  return {
    geometry, players, direction_set, custom_vectors,
    movement, capture, goal, initial_layout,
    board_size: size,
    b_radius: parseInt(document.getElementById("radius").value, 10) || 4,
    c_radius: parseInt(document.getElementById("radius").value, 10) || 4,
    ep_side: parseInt(document.getElementById("ep-side").value, 10) || 5,
  };
}

function selectedAiPlayers() {
  const set = new Set();
  document.querySelectorAll("#ai-player-menu input:checked").forEach(el => set.add(parseInt(el.dataset.aiPlayer, 10)));
  return set;
}

function selectedAiTypes() {
  const map = {};
  document.querySelectorAll("#ai-player-menu select.ai-type-select").forEach(el => {
    map[parseInt(el.dataset.aiPlayer, 10)] = el.value;
  });
  return map;
}

/* ---------------- 场景 ---------------- */

function initScene() {
  const container = document.getElementById("scene-container");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2f5f9);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  camera.position.set(18, 14, 18);
  camera.lookAt(0, 0, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
  dirLight.position.set(10, 20, 8);
  scene.add(dirLight);

  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.controls = controls;
  state.pieceGroup = new THREE.Group();
  state.pointGroup = new THREE.Group();
  state.routeGroup = new THREE.Group();
  state.highlightGroup = new THREE.Group();
  scene.add(state.pointGroup, state.routeGroup, state.pieceGroup, state.highlightGroup);

  function resize() {
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  if (state.controls) state.controls.update();
  if (state.renderer && state.scene) state.renderer.render(state.scene, state.camera);
}

function worldPos(p, center) {
  const spacing = 1.4;
  return [
    (p[0] - center[0]) * spacing,
    (p[1] - center[1]) * spacing,
    (p[2] - center[2]) * spacing,
  ];
}

function getCenter() {
  const pts = state.board.points;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  return [(min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2];
}

function clearGroup(group) {
  while (group.children.length) {
    const obj = group.children.pop();
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }
}

function buildRouteVertices() {
  const board = state.board;
  const dirs = resolveDirections(board.config.direction_set, board.config.custom_vectors);
  const seen = new Set();
  const verts = [];
  for (const p of board.points) {
    for (const v of dirs) {
      const q = addVec(p, v);
      if (!board.inside(q)) continue;
      const a = pk(p), b = pk(q);
      const key = a < b ? a + "|" + b : b + "|" + a;
      if (seen.has(key)) continue;
      seen.add(key);
      verts.push(...p, ...q);
    }
  }
  return verts;
}

function renderBoard() {
  const board = state.board;
  const center = getCenter();

  clearGroup(state.pointGroup);
  clearGroup(state.routeGroup);
  clearGroup(state.pieceGroup);
  state.pieceMeshes = [];

  // 点阵
  const pointGeo = new THREE.BufferGeometry();
  const pointPositions = [];
  for (const p of board.points) pointPositions.push(...worldPos(p, center));
  pointGeo.setAttribute("position", new THREE.Float32BufferAttribute(pointPositions, 3));
  const pointMat = new THREE.PointsMaterial({ color: 0x7c8b9a, size: 0.08, sizeAttenuation: true });
  state.pointGroup.add(new THREE.Points(pointGeo, pointMat));

  // 路线
  const verts = buildRouteVertices();
  if (verts.length) {
    const routeGeo = new THREE.BufferGeometry();
    routeGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const routeMat = new THREE.LineBasicMaterial({ color: 0x8fa3b8, transparent: true, opacity: 0.45 });
    state.routeGroup.add(new THREE.LineSegments(routeGeo, routeMat));
  }

  // 棋子
  const sphereGeo = new THREE.SphereGeometry(0.32, 18, 18);
  for (const [key, owner] of board.pieces) {
    const p = parsePoint(key);
    const mesh = new THREE.Mesh(
      sphereGeo,
      new THREE.MeshStandardMaterial({ color: PLAYER_COLORS[(owner - 1) % PLAYER_COLORS.length], roughness: 0.35 })
    );
    mesh.position.set(...worldPos(p, center));
    mesh.userData = { pos: p, player: owner };
    state.pieceGroup.add(mesh);
    state.pieceMeshes.push(mesh);
  }

  // 相机适配
  const span = Math.max(center[0] * 2, center[1] * 2, center[2] * 2, 2) * 1.4;
  state.camera.position.set(span * 0.9, span * 0.7, span * 0.9);
  state.camera.lookAt(0, 0, 0);
  state.controls.target.set(0, 0, 0);
  state.controls.update();
}

function clearHighlights() {
  clearGroup(state.highlightGroup);
  state.highlightMeshes = [];
  state.legalPaths = [];
  state.selectedPos = null;
}

function showHighlights(paths) {
  clearHighlights();
  state.legalPaths = paths;
  const center = getCenter();
  const endGeo = new THREE.SphereGeometry(0.22, 12, 12);
  const endMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.85 });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.5 });

  const seenEnd = new Set();
  for (const path of paths) {
    const end = path[path.length - 1];
    const key = pk(end);
    if (!seenEnd.has(key)) {
      seenEnd.add(key);
      const mesh = new THREE.Mesh(endGeo, endMat.clone());
      mesh.position.set(...worldPos(end, center));
      mesh.userData = { pos: end, isHighlight: true };
      state.highlightGroup.add(mesh);
      state.highlightMeshes.push(mesh);
    }
    const pts = path.map(p => worldPos(p, center)).flat();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    state.highlightGroup.add(new THREE.Line(geo, lineMat.clone()));
  }
  state.selectedPos = paths.length ? paths[0][0] : null;
}

/* ---------------- 游戏流程 ---------------- */

function setStatus(text) {
  document.getElementById("status-text").textContent = text;
}

function advanceTurn() {
  const n = state.config.players;
  for (let i = 0; i < n; i++) {
    state.currentPlayer = state.currentPlayer % n + 1;
    const moves = legalMoves(state.board, state.currentPlayer, state.config);
    if (moves.length) return;
  }
}

function applyMove(path) {
  const player = state.currentPlayer;
  applyMoveToState(path, player);
}

function applyMoveToState(path, player) {
  engineApplyMove(state.board, path, player, state.config);
  state.history.push({ player, path: path.map(p => p.slice()) });
  state.pieceSnapshots.push(new Map(state.board.pieces));
  state.winner = checkWinner(state.board, state.config);
  if (state.winner) {
    setStatus("玩家 P" + state.winner + " 获胜！");
  } else {
    advanceTurn();
    setStatus("第 " + (state.currentPlayer) + " 玩家");
  }
  renderBoard();
  clearHighlights();
  maybeAiMove();
}

function maybeAiMove() {
  if (state.winner || state.replayMode) return;
  if (!state.aiPlayers.has(state.currentPlayer)) return;
  setTimeout(handleAiMove, 400);
}

async function handleAiMove() {
  if (state.winner || state.replayMode) return;
  const player = state.currentPlayer;
  const paths = legalMoves(state.board, player, state.config);
  if (!paths.length) {
    advanceTurn();
    renderBoard();
    setStatus("P" + state.currentPlayer + " 无棋可走");
    maybeAiMove();
    return;
  }
  const aiType = state.aiTypes[player] || "distance_graph";
  const move = selectMove(state.board, player, paths, aiType);
  if (!move) return;
  applyMoveToState(move, player);
}

function onClick(e) {
  if (!state.board || state.replayMode) return;
  const rect = state.renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, state.camera);

  const highlightHits = raycaster.intersectObjects(state.highlightMeshes);
  if (highlightHits.length) {
    const pos = highlightHits[0].object.userData.pos;
    const path = state.legalPaths.find(p => pk(p[p.length-1]) === pk(pos));
    if (path) {
      applyMove(path);
      return;
    }
  }

  const pieceHits = raycaster.intersectObjects(state.pieceMeshes);
  if (pieceHits.length) {
    const mesh = pieceHits[0].object;
    const pos = mesh.userData.pos;
    const player = mesh.userData.player;
    if (player !== state.currentPlayer) return;
    if (state.aiPlayers.has(state.currentPlayer)) return;
    const paths = legalMovesFrom(state.board, pos, state.config);
    if (!paths.length) { clearHighlights(); return; }
    showHighlights(paths);
  }
}

/* ---------------- 回放 ---------------- */

function setReplayStep(step) {
  if (!state.pieceSnapshots.length) return;
  const max = state.pieceSnapshots.length;
  step = Math.max(0, Math.min(max, step));
  state.replayStep = step;
  state.replayMode = true;
  if (step === 0) {
    // 用初始棋局：通过重新建 Board 太重，这里从第一个快照前的记录恢复。
    // 简单处理：重建初始 state 逻辑放在 replayStart 时完成；这里用快照。
    const initial = state.initialPieces ? new Map(state.initialPieces) : new Map();
    state.board.pieces = initial;
  } else {
    state.board.pieces = new Map(state.pieceSnapshots[step - 1]);
  }
  renderBoard();
  clearHighlights();
  setStatus("回放中：" + step + "/" + max);
}

function startReplay() {
  if (!state.history.length) return;
  state.replayMode = true;
  state.replayStep = 0;
  state.board.pieces = state.initialPieces ? new Map(state.initialPieces) : new Map();
  renderBoard();
  clearHighlights();
  setStatus("回放中：开局");
  setReplayControlsEnabled(true);
}

function setReplayControlsEnabled(enabled) {
  ["replay-start", "replay-prev", "replay-next", "replay-end", "replay-auto"].forEach(id => {
    document.getElementById(id).disabled = !enabled;
  });
}

/* ---------------- 主流程 ---------------- */

function startGame() {
  try {
    const config = readConfig();
    state.config = config;
    state.board = new Board(config);
    state.currentPlayer = 1;
    state.winner = null;
    state.history = [];
    state.pieceSnapshots = [];
    state.aiPlayers = selectedAiPlayers();
    state.aiTypes = selectedAiTypes();
    state.initialPieces = new Map(state.board.pieces);
    renderBoard();
    clearHighlights();
    setStatus("P1 玩家");
    document.getElementById("ai-move-btn").disabled = false;
    setReplayControlsEnabled(false);
    maybeAiMove();
  } catch (err) {
    document.getElementById("menu-error").textContent = err.message || String(err);
    console.error(err);
  }
}

function init() {
  initScene();
  renderAiPlayerMenu();
  updateGeometryFields();
  updatePlayerOptions();

  document.getElementById("geometry").addEventListener("change", () => {
    updateGeometryFields();
    updatePlayerOptions();
  });
  document.getElementById("players").addEventListener("change", () => {
    renderAiPlayerMenu();
  });
  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("restart-btn").addEventListener("click", startGame);
  document.getElementById("ai-move-btn").addEventListener("click", () => {
    if (!state.board || state.winner) return;
    if (state.aiPlayers.has(state.currentPlayer)) { handleAiMove(); return; }
    // 人类也可以点 AI 走一步（模拟当前玩家由 AI 代理）
    state.aiPlayers.add(state.currentPlayer);
    state.aiTypes[state.currentPlayer] = state.aiTypes[state.currentPlayer] || "distance_graph";
    handleAiMove();
  });
  document.getElementById("replay-start").addEventListener("click", () => { startReplay(); setReplayStep(0); });
  document.getElementById("replay-prev").addEventListener("click", () => setReplayStep((state.replayStep ?? state.pieceSnapshots.length) - 1));
  document.getElementById("replay-next").addEventListener("click", () => setReplayStep((state.replayStep ?? -1) + 1));
  document.getElementById("replay-end").addEventListener("click", () => setReplayStep(state.pieceSnapshots.length));
  document.getElementById("replay-auto").addEventListener("click", () => {
    if (state.replayTimer) { clearInterval(state.replayTimer); state.replayTimer = null; document.getElementById("replay-auto").textContent = "自动播放"; return; }
    state.replayTimer = setInterval(() => {
      const next = (state.replayStep ?? 0) + 1;
      if (next > state.pieceSnapshots.length) {
        clearInterval(state.replayTimer); state.replayTimer = null;
        document.getElementById("replay-auto").textContent = "自动播放";
        return;
      }
      setReplayStep(next);
    }, 700);
    document.getElementById("replay-auto").textContent = "停止";
  });

  state.renderer.domElement.addEventListener("pointerdown", onClick);
}

init();
