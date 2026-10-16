import { buildWorkshop, perforatedBench, plateFixtures } from './src/Workshop.js';
import { steelMaterialPBR } from './src/SteelTextures.js';
import { buildMigTorch, setTorchControllerMounted } from './src/Torches.js';
import { WorkpieceGrab } from './src/Stability.js';
import { VRControls } from './src/VRControls.js';
import { TrainingUI } from './src/TrainingUI.js';
import { PhysicalControllers } from './src/PhysicalControllers.js';
import { StatsBoard } from './src/StatsBoard.js';
import './src/boot-status.js';
import { HelmetView } from './src/HelmetView.js';
import { PoseGuide } from './src/PoseGuide.js';
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
// Update the tracked camera exactly once in our animation loop.
renderer.xr.cameraAutoUpdate = false;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(0.85);
renderer.xr.setFoveation(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Without tone mapping the arc and the lamp highlights clip flat to white,
// which is most of why the steel read as a video-game surface rather than
// as metal. ACES keeps the roll-off into the highlights.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
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
scene.add(new THREE.HemisphereLight(0x9fc0e0, 0x14161c, 0.18));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.45);
keyLight.position.set(0.8, 2, 0.9);
scene.add(keyLight);
buildWorkshop(scene, renderer);

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

// Mill-scale face for everything the welder looks at, and bare cut metal on the
// two edges that form the root gap: a sheared edge carries no oxide, and that
// bright line down the middle is most of what sells the joint as real steel.
const plateFace = steelMaterialPBR('rolledSheet', {
  span: [PLATE_WIDTH, PLATE_LENGTH], tile: 0.09, renderer, normalScale: 0.35,
});
const plateCut = steelMaterialPBR('cutEdge', {
  span: [PLATE_LENGTH, PLATE_THICKNESS], tile: 0.02, size: 512, renderer, normalScale: 0.7,
});
for (const side of [-1, 1]) {
  // BoxGeometry material order is +x, -x, +y, -y, +z, -z. The face pointing at
  // the seam is the inboard one, which differs per plate.
  const faces = Array(6).fill(plateFace);
  faces[side > 0 ? 1 : 0] = plateCut;
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(PLATE_WIDTH, PLATE_THICKNESS, PLATE_LENGTH),
    faces
  );
  plate.position.set(side * (PLATE_WIDTH / 2 + ROOT_GAP / 2), -PLATE_THICKNESS / 2, 0);
  workpiece.add(plate);
}

perforatedBench(workpiece, { top: -PLATE_THICKNESS });

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
const session = new WeldSession(seam, { standoffTol: 0.006, lateralTol: 0.0075, angleTol: 25, speedRange: 0.008 });
const visualFeatures = !new URLSearchParams(location.search).has('safe');
const helmet = visualFeatures ? new HelmetView(scene, renderer, camera, controls, workpiece, new THREE.Vector3(0, 0.36, 0.30)) : null;
const poseGuide = new PoseGuide(workpiece, seam);

// ---------------------------------------------------------------------------
// Torch
// ---------------------------------------------------------------------------
// Geometry lives in src/Torches.js so the plate gun, the pipe holder and the
// combined shop page cannot drift apart.
const buildTorchMesh = () => buildMigTorch(TORCH_LENGTH);

// ---------------------------------------------------------------------------
// VR controllers
//
// The torch binds to the hand the welder actually holds it in, reported by the
// runtime, rather than to a controller index (which is arbitrary and differs
// between headsets). The torch now stays on the right physical controller.
//
// The free hand squeezes to drag the bench: a bench fixed at one height and
// distance only suits one body, and a trainee fighting their own reach is not
// learning anything about welding.
// ---------------------------------------------------------------------------
// Right physical controller welds; left physical controller moves the bench.
const WELDING_HAND = 'right';

const vrTorch = setTorchControllerMounted(buildTorchMesh());

const physicalInput = new PhysicalControllers(scene, renderer);
const controllers = physicalInput.controllers;
controllers.forEach((c) => {
  c.userData.trigger = false;
  c.userData.handedness = null;
  c.addEventListener('selectstart', () => {
    if (trainingUI.handleSelect(c)) return;
    c.userData.trigger = c === torchController;
  });
  c.addEventListener('selectend', () => {
    c.userData.trigger = false;
    c.userData.uiPressed = false;
  });
  c.addEventListener('squeezestart', () => {
    if (c.userData.source?.hand || trainingUI.blocksManipulation) return;
    startBenchDrag(c);
  });
  c.addEventListener('squeezeend', () => endBenchDrag(c));
  c.addEventListener('connected', (event) => {
    c.userData.source = event.data;
    c.userData.handedness = event.data?.handedness ?? null;
    assignHands();
  });
  c.addEventListener('disconnected', () => {
    c.userData.source = null;
    c.userData.uiPressed = false;
    c.userData.handedness = null;
    c.userData.trigger = false;
    endBenchDrag(c);
    assignHands();
  });
});

let torchController = controllers[0];
let gripController = controllers[1];

function assignHands() {
  torchController = physicalInput.right;
  gripController = physicalInput.left;
  torchController.add(vrTorch);
}
assignHands();

// Dragging the bench mid-pass would teleport the torch in seam coordinates and
// register as an impossible travel speed, so the arc has to be off first.
let benchDrag = null;

function startBenchDrag(controller) {
  if (controller !== gripController || controller.userData.source?.hand || !controller.userData.source || trainingUI.blocksManipulation || isArcOn()) return;
  if (!controller.userData.tracked) return;
  benchDrag = new WorkpieceGrab(controller, workpiece, 0.55, 1.35);
}

function endBenchDrag(controller) {
  if (benchDrag && benchDrag.controller === controller) benchDrag = null;
}

function updateBenchDrag(dt) {
  if (!benchDrag) return;
  if (isArcOn() || trainingUI.blocksManipulation || !benchDrag.update(dt)) benchDrag = null;
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
const vrControls = new VRControls(scene, renderer, workpiece, { weldingHand: WELDING_HAND });
const desktopTorch = buildTorchMesh();
poseGuide?.useTorch(desktopTorch);
workpiece.add(desktopTorch);
const board = new StatsBoard(scene, {
  occluders: [workpiece],
  follow: workpiece,
  // Keep the panel above and 15 cm behind the plate's rear edge.
  width: 0.62, position: new THREE.Vector3(0, BENCH_HEIGHT + 0.42, WORKPIECE_Z - PLATE_LENGTH / 2 - 0.15),
});
board.configure('plate', session);
const trainingUI = new TrainingUI({
  scene, renderer, camera, board, controllers, physicalInput, weldingHand: WELDING_HAND,
  helmet, vrControls, reset: resetPass,
});

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
  controls.enabled = false;
  overlay.style.display = 'none';
  desktopTorch.visible = false;
});
renderer.xr.addEventListener('sessionend', () => {
  controls.enabled = true;
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
  if (trainingUI.blocksArc(torchController)) return false;
  return renderer.xr.isPresenting ? torchController.visible && torchController.userData.handedness === WELDING_HAND && torchController.userData.trigger : !!keys['Space'];
}

function resetPass() {
  poseGuide?.reset();
  session.reset();
  bead.reset();
  board.reset();
  desktop.travel = 0;
  desktop.lateral = 0;
  desktop.height = session.idealStandoff;
  desktop.travelAngle = session.idealTravelAngleDeg;
  desktop.workAngle = 0;
  result.style.display = 'none';
}

function showResult() {
  const r = session.report(bead.getStats());
  board.showResult(r);
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

function readViewerPosition(xrFrame) {
  const referenceSpace = renderer.xr.getReferenceSpace();
  const pose = xrFrame && referenceSpace ? xrFrame.getViewerPose(referenceSpace) : null;
  if (pose) {
    const p = pose.transform.position;
    _viewer.set(p.x, p.y, p.z);
  } else _viewer.copy(camera.position);
}

function animate(time, xrFrame) {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
  physicalInput.update(xrFrame, dt);

  trainingUI.update(xrFrame);
  vrTorch.visible = renderer.xr.isPresenting && !!torchController.userData.source
    && !torchController.userData.source.hand && torchController.userData.handedness === WELDING_HAND;
  guide.setVisible(trainingUI.guides);
  poseGuide.setVisible(trainingUI.guides);
  hud.setVisible(trainingUI.guides);
  updateBenchDrag(dt);
  updateDesktopTorch(dt);
  getTorchTipLocal(_tip);
  getTorchForwardLocal(_fwd);
  // The displayed controller pose is already filtered; score that same pose.

  const arcOn = isArcOn() && !session.finished;
  const m = session.sample(dt, _tip, _fwd, arcOn);

  // Where the torch is right now, versus how much joint has actually been
  // welded. The guide needs both: the ring tracks the first, the blue path is
  // only consumed by the second.
  const liveT = THREE.MathUtils.clamp(m.t, 0, 1);
  guide.update(dt, {
    cursorT: liveT,
    progressT: session.maxT,
    onSeam: m.onSeam,
    arcOn: m.welding,
    severity: m.severity,
  });

  seam.pointAt(liveT, _contact).addScaledVector(seam.lateral, m.lateral);
  if (m.welding) {
    bead.deposit(dt, {
      t: liveT,
      lateral: m.lateral,
      speedRatio: m.speedRatio,
      nominalSpeed: session.idealSpeed,
      quality: m.quality,
    });
  }
  bead.update(dt, { arcOn: m.welding, point: _contact });

  if (renderer.xr.isPresenting) {
    readViewerPosition(xrFrame);
  } else {
    _viewer.copy(camera.position);
  }
  workpiece.localToWorld(_tip);
  hud.update(dt, {
    depth: m.depthErr,
    center: m.center,
    speed: m.welding ? m.speedFraction : 0.5,
    anchor: _tip,
    viewer: _viewer,
  });

  board.sample(dt, m);
  board.update(dt);

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
      `진행 ${Math.round(session.maxT * 100)}%${m.onSeam ? '' : ' (심 이탈)'}  ·  ` +
      `아크길이 ${(m.height * 1000).toFixed(1)}mm  ·  ` +
      `중심편차 ${(m.lateral * 1000).toFixed(1)}mm  ·  ` +
      `속도 ${(m.speed * 1000).toFixed(1)}mm/s  ·  ` +
      `작업각 ${m.travelAngleDeg.toFixed(0)}°`;
  }


  if (trainingUI.guides) poseGuide?.update(session.maxT, { standoff: session.idealStandoff, travelAngle: session.idealTravelAngleDeg, workAngle: 0 }, 1, 0, null, dt);
  helmet?.update(m.welding);
  vrControls.update(_viewer, false);
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
  window.weldReady = true;
}

renderer.setAnimationLoop(animate);

// Opt-in handle for tuning and for driving the scene from the console
// (index.html?debug=1) -- useful because a headset is not always to hand.
if (new URLSearchParams(location.search).has('debug')) {
  window.weldDebug = { physicalInput, board, trainingUI, vrControls, helmet, poseGuide, scene, camera, renderer, seam, guide, bead, hud, session, desktop };
}
