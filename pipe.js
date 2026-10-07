import { buildWorkshop, steelMaterial, perforatedBench, plateFixtures } from './src/Workshop.js';
import { PoseStabilizer } from './src/Stability.js';
import { VRControls } from './src/VRControls.js';
import './src/boot-status.js';
import { HelmetView } from './src/HelmetView.js';
import { PoseGuide } from './src/PoseGuide.js';
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pipeFilletSeam } from './src/SeamCurve.js';
import { pipeFilletPlan } from './src/PassPlan.js';
import { buildStickHolder, poseTorchByTip } from './src/Torches.js';
import { CurvedGuide } from './src/CurvedGuide.js';
import { JointSession } from './src/JointSession.js';
import { WeldBead } from './src/WeldBead.js';
import { TorchHud } from './src/TorchHud.js';
import { StatsBoard } from './src/StatsBoard.js';

// ---------------------------------------------------------------------------
// Geometry (metres).
//
// A square block with a round pipe landing square on its vertical face. The
// seam is the circle where they meet, and it stands in a VERTICAL plane, which
// is the whole difficulty: one lap passes through three welding positions.
// ---------------------------------------------------------------------------
const BLOCK = 0.17;
const PLATE_EXTENSION = 0.22;
const PLATE_HEIGHT = BLOCK + PLATE_EXTENSION;
const PLATE_CENTER_Y = -PLATE_EXTENSION / 2;
const TABLE_TOP = PLATE_CENTER_Y - PLATE_HEIGHT / 2 - 0.002;
const PIPE_OUTER = 0.0335;
const PIPE_WALL = 0.004;
// Short, like the test coupon in the reference photo. A long pipe hides its
// own seam from every viewpoint, which is realistic and useless to learn from.
const PIPE_LENGTH = 0.085;
const SEAM_RADIUS = PIPE_OUTER;

const WORK_HEIGHT = 1.12; // seam centre, about chest high standing
const WORK_Z = -0.44;

// Grip to nozzle tip. A real gun is nearly 200mm, but every millimetre of it
// is a lever arm on the controller: at 260mm a centimetre of hand tremor threw
// the tip most of a bead width. 134mm still reads as a torch and halves it.
const TORCH_REACH = 0.134;

const TRAVEL_SPEED = 0.0030; // m/s, desktop W/S -- SMAW pace, much slower than MIG
const LATERAL_SPEED = 0.008;
const STANDOFF_SPEED = 0.008;
const TILT_SPEED = 40; // deg/s
const TILT_LIMIT = 55;
const BOOST = 8;

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
// Update the tracked camera exactly once in our animation loop.
renderer.xr.cameraAutoUpdate = false;
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
const handStability = new PoseStabilizer();
scene.background = new THREE.Color(0x0a0d13);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.01, 50);
// Up and to the side, not square in front: head on, the pipe itself hides the
// far half of the seam, which is also exactly why a welder has to move round
// this joint rather than stand still and turn their wrist.
// Roughly where the welder's head is in VR, so the desktop view and the
// headset view frame the same thing: statistics board above, joint below.
camera.position.set(0.06, WORK_HEIGHT + 0.34, WORK_Z + 0.46);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, WORK_HEIGHT + 0.12, WORK_Z - 0.26);
controls.enableDamping = true;
controls.minDistance = 0.12;
controls.maxDistance = 2.5;
controls.update();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.HemisphereLight(0x9fc0e0, 0x14161c, 0.18));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.45);
keyLight.position.set(0.9, 1.8, 1.2);
scene.add(keyLight);
buildWorkshop(scene, renderer);

// ---------------------------------------------------------------------------
// Workpiece. Translation only, so local directions double as world directions.
// ---------------------------------------------------------------------------
const workpiece = new THREE.Group();
workpiece.position.set(0, WORK_HEIGHT, WORK_Z);
scene.add(workpiece);

// Each surface here has a different history on a real joint, so each takes the
// preset that matches: rolled backing plate, brushed pipe OD, unground bore,
// and a bare sawn rim.
const PIPE_CIRCUMFERENCE = 2 * Math.PI * PIPE_OUTER;
const steel = steelMaterial({
  preset: 'rolledSheet', span: [BLOCK, PLATE_HEIGHT], tile: 0.09, renderer, normalScale: 0.35,
});
const steelPipe = steelMaterial({
  preset: 'polishedTube', span: [PIPE_CIRCUMFERENCE, PIPE_LENGTH], tile: 0.06,
  renderer, normalScale: 0.18,
});
const steelDark = steelMaterial({
  preset: 'hotRolledPlate', span: [PIPE_CIRCUMFERENCE, PIPE_LENGTH], tile: 0.05,
  renderer, tint: 0x6f767a,
});
const steelRim = steelMaterial({
  preset: 'cutEdge', span: [PIPE_CIRCUMFERENCE, PIPE_WALL], tile: 0.012,
  size: 512, renderer, normalScale: 1.2,
});
// The block. Its front face sits at local z = 0, so the seam plane is z = 0.
const block = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, PLATE_HEIGHT, 0.012), steel);
block.position.set(0, PLATE_CENTER_Y, -0.006);
block.name = 'pipe-backing-plate';
workpiece.add(block);
plateFixtures(workpiece, BLOCK, PLATE_HEIGHT, PLATE_CENTER_Y);

// The pipe, lying along +Z out of that face. Open-ended so the bore reads as
// a pipe rather than as a peg.
const pipe = new THREE.Mesh(
  new THREE.CylinderGeometry(PIPE_OUTER, PIPE_OUTER, PIPE_LENGTH, 48, 1, true),
  steelPipe
);
pipe.rotation.x = Math.PI / 2;
pipe.position.set(0, 0, PIPE_LENGTH / 2);
workpiece.add(pipe);

const bore = new THREE.Mesh(
  new THREE.CylinderGeometry(
    PIPE_OUTER - PIPE_WALL,
    PIPE_OUTER - PIPE_WALL,
    PIPE_LENGTH,
    48,
    1,
    true
  ),
  steelDark
);
bore.rotation.x = Math.PI / 2;
bore.position.set(0, 0, PIPE_LENGTH / 2);
bore.material.side = THREE.BackSide;
workpiece.add(bore);

const rim = new THREE.Mesh(
  new THREE.RingGeometry(PIPE_OUTER - PIPE_WALL, PIPE_OUTER, 48),
  steelRim
);
rim.position.set(0, 0, PIPE_LENGTH);
workpiece.add(rim);

perforatedBench(workpiece, { width: 0.8, depth: 0.6, top: TABLE_TOP, z: -0.08 });
// ---------------------------------------------------------------------------
// Seam, plan, guide, bead, scoring
// ---------------------------------------------------------------------------
const seam = pipeFilletSeam({
  center: new THREE.Vector3(0, 0, 0),
  wallNormal: new THREE.Vector3(0, 0, 1), // out of the block face, along the pipe
  up: new THREE.Vector3(0, 1, 0),
  radius: SEAM_RADIUS,
});

const plan = pipeFilletPlan(seam);
const guide = new CurvedGuide(workpiece, seam, plan, { zoneHalfWidth: 0.0055 });
const bead = new WeldBead(workpiece, seam, {
  segments: 320,
  halfWidth: 0.0042,
  height: 0.0026,
  poolLength: 0.005,
});
// Tight to the nozzle. At 150mm the gauges sat outside the hood's useful cone
// while the eye was on the puddle, so they were only ever read between runs.
const hud = new TorchHud(scene, { width: 0.1, offset: 0.075 });
// Behind and just above the work, bottom edge tucked behind the block, so the
// board and the puddle sit in one glance instead of one being a head turn away.
const board = new StatsBoard(scene, {
  width: 0.86,
  position: new THREE.Vector3(0, WORK_HEIGHT + 0.24, WORK_Z - 0.6),
});
const session = new JointSession(seam, plan, { standoffTol: 0.0024, lateralTol: 0.0035, angleTol: 22, speedTol: 0.0018 });
const visualFeatures = !new URLSearchParams(location.search).has('safe');
const helmet = visualFeatures ? new HelmetView(scene, renderer, camera, controls, workpiece, new THREE.Vector3(0, 0.20, 0.32)) : null;
const poseGuide = visualFeatures ? new PoseGuide(workpiece, seam) : null;
bead.visualDetails = visualFeatures;

// ---------------------------------------------------------------------------
// Electrode. Stick, not MIG: a holder with a straight consumable rod, which is
// what the reference photo shows and what the 45 degree work angle refers to.
// ---------------------------------------------------------------------------

/**
 * A MIG gun with a swan neck, like the reference photo.
 *
 * The nozzle does NOT point along the group's own axis -- it bends about 48
 * degrees down out of the handle, which is the whole character of the tool:
 * you hold your hand level and the arc goes where the neck points. So the tip
 * is a child object carrying its own orientation, and everything downstream
 * asks the tip where it is and which way it faces rather than assuming the
 * handle axis.
 */
const buildTorchMesh = buildStickHolder;


/** Place a torch so its NOZZLE TIP lands at `tipPos` aimed along `fwd`. */

// ---------------------------------------------------------------------------
// VR controllers
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
  c.addEventListener('selectstart', () => {
    c.userData.trigger = true;
    // The free hand's trigger restarts the joint. In the headset there is no
    // keyboard and no DOM overlay, so without this a trainee who has made a
    // mess has no way back except taking the headset off.
    if (c !== rodController) resetJoint();
  });
  c.addEventListener('selectend', () => (c.userData.trigger = false));
  c.addEventListener('squeezestart', () => startDrag(c));
  c.addEventListener('squeezeend', () => endDrag(c));
  c.addEventListener('connected', (e) => {
    c.userData.handedness = e.data?.handedness ?? null;
    assignHands();
  });
  c.addEventListener('disconnected', () => {
    c.userData.handedness = null;
    c.userData.trigger = false;
    endDrag(c);
  });
  scene.add(c);
  return c;
});

let rodController = controllers[0];
let gripController = controllers[1];

function assignHands() {
  rodController = controllers.find((c) => c.userData.handedness === WELDING_HAND) ?? controllers[0];
  gripController = controllers.find((c) => c !== rodController);
  rodController.add(vrTorch);
  gripController.add(gripMarker);
}
assignHands();

let drag = null;
const _grab = new THREE.Vector3();

function startDrag(controller) {
  if (controller !== gripController || isArcOn() || !controller.visible) return;
  controller.getWorldPosition(_grab);
  drag = { controller, offset: workpiece.position.clone().sub(_grab) };
}
function endDrag(controller) {
  if (drag && drag.controller === controller) drag = null;
}
function updateDrag() {
  if (!drag) return;
  drag.controller.getWorldPosition(_grab);
  if (isArcOn() || !drag.controller.visible) { drag = null; return; }
  workpiece.position.lerp(_grab.clone().add(drag.offset), 0.2);
  workpiece.position.y = THREE.MathUtils.clamp(workpiece.position.y, 0.6, 1.5);
}

// ---------------------------------------------------------------------------
// Desktop stand-in, driven in STROKE coordinates.
//
// W does not move the rod along the circle; it moves it along the current
// stroke. That is the whole point of the stroke abstraction: the keyboard, the
// scoring and the guide all speak the same coordinate, and none of them has to
// know that stroke B happens to run backwards round the seam.
// ---------------------------------------------------------------------------
const desktop = {
  p: 0,
  lateral: 0,
  height: 0.0028,
  travelAngle: -10,
  workAngle: 0,
};
const desktopTorch = buildTorchMesh();
poseGuide?.useTorch(desktopTorch);
workpiece.add(desktopTorch);

let demo = false; // G: replay the master's own pass
let demoAnnounced = false;
const vrControls = new VRControls(scene, renderer, workpiece, { weldingHand: WELDING_HAND, onDemo: toggleDemo });

function toggleDemo() {
  demo = !demo;
  demoAnnounced = false;
  resetJoint();
  desktopTorch.visible = !renderer.xr.isPresenting || demo;
  vrTorch.visible = !demo;
}

const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR') resetJoint();
  if (e.code === 'KeyG' && !e.repeat) toggleDemo();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => (keys[e.code] = false));

const overlay = document.getElementById('overlay');
const readout = document.getElementById('readout');
const result = document.getElementById('result');

renderer.xr.addEventListener('sessionstart', () => {
  controls.enabled = false;
  handStability.reset();
  overlay.style.display = 'none';
  desktopTorch.visible = demo;
  vrTorch.visible = !demo;
});
renderer.xr.addEventListener('sessionend', () => {
  controls.enabled = true;
  handStability.reset();
  overlay.style.display = 'block';
  desktopTorch.visible = true;
});

const _fwd = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _contact = new THREE.Vector3();
const _viewer = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _frame = {
  travel: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  lateral: new THREE.Vector3(),
};

function activeStroke() {
  return plan.current ?? plan.strokes[plan.strokes.length - 1];
}

/**
 * Where the rod points, for the given angles, at a point on the seam.
 *
 * The base direction is the joint frame's own normal reversed -- straight into
 * the corner, bisecting both members. On this joint that IS the 45 degree work
 * angle, so workAngle here is the error off 45, not the angle itself, and it
 * stays zero the whole way round a correct weld.
 */
function rodForward(frame, travelAngleDeg, workAngleDeg, target) {
  return target
    .copy(frame.normal)
    .negate()
    .applyAxisAngle(frame.lateral, THREE.MathUtils.degToRad(travelAngleDeg))
    .applyAxisAngle(frame.travel, THREE.MathUtils.degToRad(workAngleDeg))
    .normalize();
}

function updateDesktopRod(dt) {
  if (renderer.xr.isPresenting && !demo) return;

  const stroke = activeStroke();

  if (demo) {
    // Replay: drive progress at the master's own travel speed and put every
    // other control exactly where the master would have it, weave included.
    const target = stroke.sample(THREE.MathUtils.clamp(desktop.p, 0, 1));
    const strokeLength = stroke.span * seam.length;
    desktop.p += (target.speed / strokeLength) * dt;
    desktop.lateral = stroke.lateralAt(THREE.MathUtils.clamp(desktop.p, 0, 1), seam.length);
    desktop.height = target.standoff;
    desktop.travelAngle = target.travelAngle;
    desktop.workAngle = target.workAngle;
    if (desktop.p > 1.02) desktop.p = 1.02; // let the stroke close out, then wait
  } else {
    const boost = keys['ShiftLeft'] || keys['ShiftRight'] ? BOOST : 1;
    const strokeLength = stroke.span * seam.length;
    const step = ((TRAVEL_SPEED * boost) / strokeLength) * dt;
    if (keys['KeyW']) desktop.p += step;
    if (keys['KeyS']) desktop.p -= step;
    if (keys['KeyD']) desktop.lateral += LATERAL_SPEED * dt;
    if (keys['KeyA']) desktop.lateral -= LATERAL_SPEED * dt;
    if (keys['KeyQ']) desktop.height += STANDOFF_SPEED * dt;
    if (keys['KeyE']) desktop.height -= STANDOFF_SPEED * dt;
    if (keys['ArrowUp']) desktop.travelAngle += TILT_SPEED * dt;
    if (keys['ArrowDown']) desktop.travelAngle -= TILT_SPEED * dt;
    if (keys['ArrowRight']) desktop.workAngle += TILT_SPEED * dt;
    if (keys['ArrowLeft']) desktop.workAngle -= TILT_SPEED * dt;
  }

  desktop.p = THREE.MathUtils.clamp(desktop.p, -0.12, 1.08);
  desktop.lateral = THREE.MathUtils.clamp(desktop.lateral, -0.02, 0.02);
  desktop.height = THREE.MathUtils.clamp(desktop.height, 0.0005, 0.05);
  desktop.travelAngle = THREE.MathUtils.clamp(desktop.travelAngle, -TILT_LIMIT, TILT_LIMIT);
  desktop.workAngle = THREE.MathUtils.clamp(desktop.workAngle, -TILT_LIMIT, TILT_LIMIT);

  const t = stroke.tAt(desktop.p);
  const frame = seam.frameAt(t, _frame);
  rodForward(frame, desktop.travelAngle, desktop.workAngle, _fwd);
  seam
    .pointAt(t, _tip)
    .addScaledVector(frame.lateral, desktop.lateral)
    .addScaledVector(frame.normal, desktop.height);

  poseTorchByTip(desktopTorch, _tip, _fwd);
}

function getTipLocal(target) {
  if (renderer.xr.isPresenting && !demo) {
    rodController.updateMatrixWorld(true);
    vrTorch.userData.tip.getWorldPosition(target);
    return workpiece.worldToLocal(target);
  }
  const stroke = activeStroke();
  const t = stroke.tAt(desktop.p);
  const frame = seam.frameAt(t, _frame);
  return seam
    .pointAt(t, target)
    .addScaledVector(frame.lateral, desktop.lateral)
    .addScaledVector(frame.normal, desktop.height);
}

function getForwardLocal(target) {
  if (renderer.xr.isPresenting && !demo) {
    // The tip's own orientation, not the controller's. With a swan neck the
    // handle axis and the arc axis are 48 degrees apart, and grading the
    // handle would mark a correctly held gun as badly rolled.
    rodController.updateMatrixWorld(true);
    vrTorch.userData.tip.getWorldQuaternion(_q);
    return target.set(0, 0, -1).applyQuaternion(_q);
  }
  const stroke = activeStroke();
  const frame = seam.frameAt(stroke.tAt(desktop.p), _frame);
  return rodForward(frame, desktop.travelAngle, desktop.workAngle, target);
}

/** Where a stroke begins. The replay strikes back inside the tie-in overlap;
 *  a trainee is left to find it, because finding it is the skill. */
function strokeStartP(stroke) {
  return demo ? -stroke.leadP(seam.length) : 0;
}

function isArcOn() {
  if (demo) {
    const lead = activeStroke().leadP(seam.length);
    return desktop.p > -lead - 0.01 && desktop.p < 1.015;
  }
  return renderer.xr.isPresenting ? rodController.visible && rodController.userData.trigger : !!keys['Space'];
}

let lastStrokeIndex = 0;

function resetJoint() {
  handStability.reset();
  poseGuide?.reset();
  session.reset();
  bead.reset();
  board.reset();
  desktop.p = strokeStartP(activeStroke());
  desktop.lateral = 0;
  desktop.height = 0.0028;
  desktop.travelAngle = -10;
  desktop.workAngle = 0;
  lastStrokeIndex = 0;
  result.style.display = 'none';
}

function showResult() {
  const r = session.report(bead.getStats());
  board.showResult(r);
  const rows = r.strokes
    .map(
      (s) =>
        `<div class="bar"><span>${s.label}</span><b>${s.coverage}%</b></div>
         <p class="hint">아크길이 ${s.arc}% · 중앙 ${s.center}% · 속도 ${s.speed}% ·
         작업각(45°) ${s.work}% · 이음부 ${s.tieIn}% · 진행방향 ${s.direction}%</p>`
    )
    .join('');
  result.innerHTML = `
    <h2>용접 결과 · ${r.total}점</h2>
    ${rows}
    <div class="bar"><span>비드 적층률</span><b>${r.coverage}%</b></div>
    <p class="hint">아크 시간 ${r.arcTime.toFixed(1)}초 · R 키로 다시 시도 · G 키로 명장 궤적 재생</p>`;
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

  if (renderer.xr.isPresenting) readViewerPosition(xrFrame);
  else _viewer.copy(camera.position);
  vrControls.update(_viewer, demo);
  updateDrag();
  updateDesktopRod(dt);
  getTipLocal(_tip);
  getForwardLocal(_fwd);
  if (renderer.xr.isPresenting && !demo) handStability.update(dt, _tip, _fwd);
  else handStability.reset();

  const arcOn = isArcOn() && !session.finished;
  const m = session.sample(dt, _tip, _fwd, arcOn);

  // A finished stroke hands the desktop controls back to the start of the next
  // one, so W keeps meaning "forward" without the trainee having to find six
  // o'clock again by hand.
  if (m.strokeIndex !== lastStrokeIndex) {
    lastStrokeIndex = m.strokeIndex;
    poseGuide?.reset();
    desktop.p = strokeStartP(activeStroke());
    desktop.lateral = 0;
  }

  // Progress and cursor are two different things, and conflating them was the
  // bug: `m.p` is where the torch is RIGHT NOW, so driving the blue remaining
  // path with it meant waving the torch down the joint with the arc off ate
  // the path. `maxP` is how much of the stroke has actually been welded.
  // The ring still follows the live position -- that one is meant to.
  const weldedP = session.stats ? THREE.MathUtils.clamp(session.stats.maxP, 0, 1) : 1;
  guide.update(dt, {
    strokeIndex: m.strokeIndex,
    progressP: weldedP,
    cursorT: m.t,
    onSeam: m.onSeam,
    arcOn: m.welding,
    // Only an arc that is actually burning can be going wrong. Feeding
    // severity through while the rod is parked flags "far too slow" at a
    // standing start and leaves the guide sitting in warning orange before
    // the trainee has done anything.
    severity: m.welding ? m.severity : 0,
  });

  const frame = seam.frameAt(m.t, _frame);
  seam.pointAt(m.t, _contact).addScaledVector(frame.lateral, m.lateral);
  if (m.welding) {
    bead.deposit(dt, {
      t: m.t,
      lateral: m.lateral,
      speedRatio: Math.abs(m.speedRatio),
      quality: m.quality,
    });
  }
  bead.update(dt, { arcOn: m.welding, point: _contact, t: m.t });

  if (renderer.xr.isPresenting) {
    readViewerPosition(xrFrame);
  } else {
    _viewer.copy(camera.position);
  }
  workpiece.localToWorld(_tip);
  hud.update(dt, {
    depth: m.arcErr,
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
    const hour = Math.round(m.clock) % 12;
    const posture =
      m.clock > 10.5 || m.clock < 1.5 ? '아래보기' : m.clock > 4.5 && m.clock < 7.5 ? '위보기' : '수직';
    const label = m.stroke ? m.stroke.label : '완료';
    readout.textContent =
      `${label}  ·  ${hour === 0 ? 12 : hour}시 방향(${posture})  ·  ` +
      `진행 ${Math.round(THREE.MathUtils.clamp(m.p, 0, 1) * 100)}%${m.onSeam ? '' : ' (이탈)'}  ·  ` +
      `아크길이 ${(m.height * 1000).toFixed(1)}mm` +
      (m.target ? ` / 목표 ${(m.target.standoff * 1000).toFixed(1)}mm` : '') +
      `  ·  속도 ${(m.strokeSpeed * 1000).toFixed(1)}mm/s` +
      (m.target ? ` / 목표 ${(m.target.speed * 1000).toFixed(1)}mm/s` : '') +
      `  ·  작업각오차 ${m.workAngleDeg.toFixed(0)}°` +
      (demo ? '  ·  [명장 궤적 재생 중]' : '');
    if (demo && !demoAnnounced) demoAnnounced = true;
  }


  const poseStroke = plan.current;
  if (poseGuide) poseGuide.group.visible = poseGuide.path.visible = !!poseStroke;
  if (poseStroke && poseGuide) {
    const p = THREE.MathUtils.clamp(session.stats?.maxP ?? 0, 0, 1);
    poseGuide.update(poseStroke.tAt(p), poseStroke.sample(p), poseStroke.dir,
      poseStroke.lateralAt(p, seam.length), fraction => {
        const ahead = Math.min(1, p + fraction * 0.025 / (poseStroke.span * seam.length));
        return { t: poseStroke.tAt(ahead), lateral: poseStroke.lateralAt(ahead, seam.length), ...poseStroke.sample(ahead) };
      }, dt);
  }
  helmet?.update(m.welding);
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
  window.weldReady = true;
}

renderer.setAnimationLoop(animate);

if (new URLSearchParams(location.search).has('debug')) {
  window.weldDebug = { getTipLocal, getForwardLocal, updateDesktopRod, vrControls, toggleDemo, helmet, poseGuide, scene, camera, controls, renderer, seam, plan, guide, bead, hud, session, desktop, workpiece };
}
