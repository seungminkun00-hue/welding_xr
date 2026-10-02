import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WeldSeam } from './src/WeldSeam.js';
import { LinearGuide } from './src/LinearGuide.js';
import { WeldBead } from './src/WeldBead.js';
import { TorchHud } from './src/TorchHud.js';
import { WeldSession } from './src/WeldSession.js';

// ---------------------------------------------------------------------------
// Geometry (meters). Two plates lie flat on a bench, butted together, and the
// seam runs away from the welder -- the 1G flat butt joint every MIG trainee
// starts on. Travel is -Z, so "forward" on the keyboard is forward on the weld.
// ---------------------------------------------------------------------------
const BENCH_HEIGHT = 0.9;
const WORKPIECE_Z = -0.42; // an arm's length in front of where the player stands
const PLATE_WIDTH = 0.13; // across the seam, per plate
const PLATE_LENGTH = 0.34; // along the seam
const PLATE_THICKNESS = 0.012;
const ROOT_GAP = 0.002;
const SEAM_LENGTH = 0.24;

const TORCH_LENGTH = 0.15;

// Holding W must land near the ideal travel speed, otherwise the speed gauge
// is pegged red the whole pass and stops teaching anything. Shift is the
// escape hatch for repositioning between runs.
const TRAVEL_SPEED = 0.011; // m/s, desktop W/S
const LATERAL_SPEED = 0.02; // m/s, desktop A/D
const BOOST = 6;
const STANDOFF_SPEED = 0.02; // m/s, desktop Q/E
const TILT_SPEED = 40; // deg/s, desktop arrow keys
const TILT_LIMIT = 55; // deg

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d13);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.01, 50);
// Roughly where a welder's eyes sit behind the joint: low enough that the seam
// runs away from you in perspective rather than reading as a plan view.
camera.position.set(0.26, 1.27, WORKPIECE_Z + 0.44);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, BENCH_HEIGHT, WORKPIECE_Z - 0.04);
controls.enableDamping = true;
controls.minDistance = 0.15;
controls.maxDistance = 2.5;
controls.update();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Dim ambient on purpose: the arc should be the brightest thing in the room.
scene.add(new THREE.HemisphereLight(0x9fc0e0, 0x14161c, 0.55));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.75);
keyLight.position.set(0.8, 2, 0.9);
scene.add(keyLight);
scene.add(new THREE.GridHelper(4, 40, 0x232b36, 0x161c24));

// ---------------------------------------------------------------------------
// Workpiece. This group only ever gets a translation, so local direction
// vectors double as world direction vectors everywhere downstream.
// ---------------------------------------------------------------------------
// In VR the origin is where the player is standing, so a bench at z = 0 sits
// on top of them with half the seam behind their back. Put it an arm's length
// in front; the free hand can squeeze to move it from there.
const workpiece = new THREE.Group();
workpiece.position.set(0, BENCH_HEIGHT, WORKPIECE_Z);
scene.add(workpiece);

const plateMaterial = new THREE.MeshStandardMaterial({
  color: 0x8e949c,
  metalness: 0.55,
  roughness: 0.62,
});
for (const side of [-1, 1]) {
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(PLATE_WIDTH, PLATE_THICKNESS, PLATE_LENGTH),
    plateMaterial
  );
  plate.position.set(side * (PLATE_WIDTH / 2 + ROOT_GAP / 2), -PLATE_THICKNESS / 2, 0);
  workpiece.add(plate);
}

const bench = new THREE.Mesh(
  new THREE.BoxGeometry(0.8, 0.04, 0.6),
  new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.2, roughness: 0.85 })
);
bench.position.set(0, -PLATE_THICKNESS - 0.02, 0);
workpiece.add(bench);

const seam = new WeldSeam({
  start: new THREE.Vector3(0, 0, SEAM_LENGTH / 2),
  end: new THREE.Vector3(0, 0, -SEAM_LENGTH / 2),
  normal: new THREE.Vector3(0, 1, 0),
});

// ---------------------------------------------------------------------------
// Guide, bead, HUD, scoring
// ---------------------------------------------------------------------------
// The zone is deliberately far wider than the bead: the trainee needs to see
// the margin they still have, not a line the bead already fills.
const guide = new LinearGuide(workpiece, seam, { zoneHalfWidth: 0.015 });
const bead = new WeldBead(workpiece, seam);
const hud = new TorchHud(scene, { width: 0.15, offset: 0.17 });
const session = new WeldSession(seam);

// ---------------------------------------------------------------------------
// Torch
// ---------------------------------------------------------------------------
function buildTorchMesh() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.011, TORCH_LENGTH * 0.72, 20),
    new THREE.MeshStandardMaterial({ color: 0x1d2026, metalness: 0.35, roughness: 0.55 })
  );
  body.rotation.x = -Math.PI / 2;
  body.position.z = -TORCH_LENGTH * 0.36;
  group.add(body);

  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0085, 0.0105, TORCH_LENGTH * 0.26, 20),
    new THREE.MeshStandardMaterial({ color: 0x5a5f68, metalness: 0.8, roughness: 0.35 })
  );
  nozzle.rotation.x = -Math.PI / 2;
  nozzle.position.z = -TORCH_LENGTH * 0.85;
  group.add(nozzle);

  const wire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0006, 0.0006, TORCH_LENGTH * 0.1, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8b26a, metalness: 0.9, roughness: 0.3 })
  );
  wire.rotation.x = -Math.PI / 2;
  wire.position.z = -TORCH_LENGTH * 0.95;
  group.add(wire);

  const tip = new THREE.Object3D();
  tip.position.z = -TORCH_LENGTH;
  group.add(tip);
  group.userData.tip = tip;
  return group;
}

// ---------------------------------------------------------------------------
// VR controllers
//
// The torch binds to the hand the welder actually holds it in, reported by the
// runtime, rather than to a controller index (which is arbitrary and differs
// between headsets). Add ?hand=left to weld left-handed.
//
// The free hand squeezes to drag the bench: a bench fixed at one height and
// distance only suits one body, and a trainee fighting their own reach is not
// learning anything about welding.
// ---------------------------------------------------------------------------
const WELDING_HAND =
  new URLSearchParams(location.search).get('hand') === 'left' ? 'left' : 'right';

const vrTorch = buildTorchMesh();
const gripMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.018, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0x47515f, metalness: 0.2, roughness: 0.8 })
);

const controllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  c.userData.trigger = false;
  c.userData.handedness = null;
  c.addEventListener('selectstart', () => (c.userData.trigger = true));
  c.addEventListener('selectend', () => (c.userData.trigger = false));
  c.addEventListener('squeezestart', () => startBenchDrag(c));
  c.addEventListener('squeezeend', () => endBenchDrag(c));
  c.addEventListener('connected', (event) => {
    c.userData.handedness = event.data?.handedness ?? null;
    assignHands();
  });
  c.addEventListener('disconnected', () => {
    c.userData.handedness = null;
    c.userData.trigger = false;
    endBenchDrag(c);
  });
  scene.add(c);
  return c;
});

let torchController = controllers[0];
let gripController = controllers[1];

function assignHands() {
  torchController =
    controllers.find((c) => c.userData.handedness === WELDING_HAND) ?? controllers[0];
  gripController = controllers.find((c) => c !== torchController);
  torchController.add(vrTorch);
  gripController.add(gripMarker);
}
assignHands();

// Dragging the bench mid-pass would teleport the torch in seam coordinates and
// register as an impossible travel speed, so the arc has to be off first.
let benchDrag = null;
const _grab = new THREE.Vector3();

function startBenchDrag(controller) {
  if (controller !== gripController || isArcOn()) return;
  controller.getWorldPosition(_grab);
  benchDrag = { controller, offset: workpiece.position.clone().sub(_grab) };
}

function endBenchDrag(controller) {
  if (benchDrag && benchDrag.controller === controller) benchDrag = null;
}

function updateBenchDrag() {
  if (!benchDrag) return;
  benchDrag.controller.getWorldPosition(_grab);
  workpiece.position.copy(_grab).add(benchDrag.offset);
  workpiece.position.y = THREE.MathUtils.clamp(workpiece.position.y, 0.55, 1.35);
}

// Desktop stand-in, parameterised in seam coordinates so the keyboard maps
// onto the things a welder actually controls.
const desktop = {
  travel: 0, // meters along the seam from the start
  lateral: 0, // meters across the seam
  height: session.idealStandoff,
  travelAngle: session.idealTravelAngleDeg, // deg of push
  workAngle: 0, // deg of roll
};
const desktopTorch = buildTorchMesh();
workpiece.add(desktopTorch);

const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR') resetPass();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => (keys[e.code] = false));

const overlay = document.getElementById('overlay');
const readout = document.getElementById('readout');
const result = document.getElementById('result');

renderer.xr.addEventListener('sessionstart', () => {
  overlay.style.display = 'none';
  desktopTorch.visible = false;
});
renderer.xr.addEventListener('sessionend', () => {
  overlay.style.display = 'block';
  desktopTorch.visible = true;
});

const _fwd = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _contact = new THREE.Vector3();
const _viewer = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Nozzle direction for the given push/roll angles, in workpiece-local space. */
function torchForward(travelAngleDeg, workAngleDeg, target) {
  return target
    .copy(seam.normal)
    .negate()
    .applyAxisAngle(seam.lateral, THREE.MathUtils.degToRad(travelAngleDeg))
    .applyAxisAngle(seam.travel, THREE.MathUtils.degToRad(workAngleDeg))
    .normalize();
}

function updateDesktopTorch(dt) {
  if (renderer.xr.isPresenting) return;

  const boost = keys['ShiftLeft'] || keys['ShiftRight'] ? BOOST : 1;
  const travelStep = TRAVEL_SPEED * boost * dt;
  const lateralStep = LATERAL_SPEED * dt;
  if (keys['KeyW']) desktop.travel += travelStep;
  if (keys['KeyS']) desktop.travel -= travelStep;
  if (keys['KeyD']) desktop.lateral += lateralStep;
  if (keys['KeyA']) desktop.lateral -= lateralStep;
  if (keys['KeyQ']) desktop.height += STANDOFF_SPEED * dt;
  if (keys['KeyE']) desktop.height -= STANDOFF_SPEED * dt;

  if (keys['ArrowUp']) desktop.travelAngle += TILT_SPEED * dt;
  if (keys['ArrowDown']) desktop.travelAngle -= TILT_SPEED * dt;
  if (keys['ArrowRight']) desktop.workAngle += TILT_SPEED * dt;
  if (keys['ArrowLeft']) desktop.workAngle -= TILT_SPEED * dt;

  desktop.travel = THREE.MathUtils.clamp(desktop.travel, -0.03, SEAM_LENGTH + 0.03);
  desktop.lateral = THREE.MathUtils.clamp(desktop.lateral, -0.05, 0.05);
  desktop.height = THREE.MathUtils.clamp(desktop.height, 0.001, 0.08);
  desktop.travelAngle = THREE.MathUtils.clamp(desktop.travelAngle, -TILT_LIMIT, TILT_LIMIT);
  desktop.workAngle = THREE.MathUtils.clamp(desktop.workAngle, -TILT_LIMIT, TILT_LIMIT);

  torchForward(desktop.travelAngle, desktop.workAngle, _fwd);
  _tip
    .copy(seam.start)
    .addScaledVector(seam.travel, desktop.travel)
    .addScaledVector(seam.lateral, desktop.lateral)
    .addScaledVector(seam.normal, desktop.height);

  desktopTorch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _fwd);
  desktopTorch.position.copy(_tip).addScaledVector(_fwd, -TORCH_LENGTH);
}

function getTorchTipLocal(target) {
  if (renderer.xr.isPresenting) {
    torchController.updateMatrixWorld(true); // sync before renderer.render() would
    vrTorch.userData.tip.getWorldPosition(target);
    return workpiece.worldToLocal(target);
  }
  return target
    .copy(seam.start)
    .addScaledVector(seam.travel, desktop.travel)
    .addScaledVector(seam.lateral, desktop.lateral)
    .addScaledVector(seam.normal, desktop.height);
}

function getTorchForwardLocal(target) {
  if (renderer.xr.isPresenting) {
    torchController.getWorldQuaternion(_q);
    return target.set(0, 0, -1).applyQuaternion(_q);
  }
  return torchForward(desktop.travelAngle, desktop.workAngle, target);
}

function isArcOn() {
  return renderer.xr.isPresenting ? torchController.userData.trigger : !!keys['Space'];
}

function resetPass() {
  session.reset();
  bead.reset();
  desktop.travel = 0;
  desktop.lateral = 0;
  desktop.height = session.idealStandoff;
  desktop.travelAngle = session.idealTravelAngleDeg;
  desktop.workAngle = 0;
  result.style.display = 'none';
}

function showResult() {
  const r = session.report(bead.getStats());
  result.innerHTML = `
    <h2>용접 결과 · ${r.total}점</h2>
    <div class="bar"><span>깊이(아크 길이)</span><b>${r.depth}%</b></div>
    <div class="bar"><span>중앙 정렬</span><b>${r.center}%</b></div>
    <div class="bar"><span>운봉 속도</span><b>${r.speed}%</b></div>
    <div class="bar"><span>비드 적층률</span><b>${r.coverage}%</b></div>
    <p class="hint">아크 시간 ${r.arcTime.toFixed(1)}초 · R 키로 다시 시도</p>`;
  result.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let readoutTimer = 0;
let wasFinished = false;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);

  updateBenchDrag();
  updateDesktopTorch(dt);
  getTorchTipLocal(_tip);
  getTorchForwardLocal(_fwd);

  const arcOn = isArcOn() && !session.finished;
  const m = session.sample(dt, _tip, _fwd, arcOn);

  const cursorT = THREE.MathUtils.clamp(m.t, 0, 1);
  guide.update(dt, { cursorT, arcOn: m.welding, severity: m.severity });

  seam.pointAt(cursorT, _contact).addScaledVector(seam.lateral, m.lateral);
  if (m.welding) {
    bead.deposit(dt, {
      t: cursorT,
      lateral: m.lateral,
      speedRatio: m.speedRatio,
      quality: m.quality,
    });
  }
  bead.update(dt, { arcOn: m.welding, point: _contact });

  if (renderer.xr.isPresenting) {
    renderer.xr.getCamera().getWorldPosition(_viewer);
  } else {
    _viewer.copy(camera.position);
  }
  workpiece.localToWorld(_tip);
  hud.update(dt, {
    depth: m.depthErr,
    center: m.center,
    speed: m.speedFraction,
    anchor: _tip,
    viewer: _viewer,
  });

  if (session.finished && !wasFinished) {
    wasFinished = true;
    showResult();
  } else if (!session.finished && wasFinished) {
    wasFinished = false;
  }

  readoutTimer += dt;
  if (readoutTimer > 0.1 && readout) {
    readoutTimer = 0;
    readout.textContent =
      `진행 ${Math.round(cursorT * 100)}%  ·  ` +
      `아크길이 ${(m.height * 1000).toFixed(1)}mm  ·  ` +
      `중심편차 ${(m.lateral * 1000).toFixed(1)}mm  ·  ` +
      `속도 ${(m.speed * 1000).toFixed(1)}mm/s  ·  ` +
      `작업각 ${m.travelAngleDeg.toFixed(0)}°`;
  }

  controls.update();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

// Opt-in handle for tuning and for driving the scene from the console
// (index.html?debug=1) -- useful because a headset is not always to hand.
if (new URLSearchParams(location.search).has('debug')) {
  window.weldDebug = { scene, camera, renderer, seam, guide, bead, hud, session, desktop };
}
