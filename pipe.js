import { buildWorkshop, steelMaterial, perforatedBench, plateFixtures } from './src/Workshop.js';
import { WorkpieceGrab } from './src/Stability.js';
import { VRControls } from './src/VRControls.js';
import { TrainingUI } from './src/TrainingUI.js';
import { PhysicalControllers } from './src/PhysicalControllers.js';
import { MasterDemo } from './src/MasterDemo.js';
import './src/boot-status.js';
import { HelmetView } from './src/HelmetView.js';
import { PoseGuide } from './src/PoseGuide.js';
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pipeFilletSeam } from './src/SeamCurve.js';
import { basicDownhillPlan } from './src/PassPlan.js';
import { poseTorchByTip } from './src/Torches.js';
import { buildWeldingGun } from './src/WeldingGun.js';
import { CurvedGuide } from './src/CurvedGuide.js';
import { JointSession } from './src/JointSession.js';
import { WeldBead, weldBeadOptions } from './src/WeldBead.js';
import { TorchHud } from './src/TorchHud.js';
import { StatsBoard } from './src/StatsBoard.js';
import { buildFieldWorkshop } from './src/FieldWorkshop.js';
import { fieldJointDefinitions, createFieldSeam, smallJointPlan } from './src/FieldJoints.js';
import { Positioner } from './src/Positioner.js';

const APPLIED = document.body.dataset.mode === 'applied';

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

const TRAVEL_SPEED = APPLIED ? 0.002 : 0.0030; // m/s
const LATERAL_SPEED = 0.008;
const STANDOFF_SPEED = 0.008;
const TILT_SPEED = 40; // deg/s
const TILT_LIMIT = 55;
const BOOST = 8;

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, APPLIED ? 1 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
// Update the tracked camera exactly once in our animation loop.
renderer.xr.cameraAutoUpdate = false;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(APPLIED ? 0.7 : 0.85);
renderer.xr.setFoveation(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Without tone mapping the arc and the lamp highlights clip flat to white,
// which is most of why the steel read as a video-game surface rather than
// as metal. ACES keeps the roll-off into the highlights.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);
const vrEntry = document.createElement('div');
vrEntry.hidden = APPLIED;
if (!APPLIED) vrEntry.appendChild(VRButton.createButton(renderer));
document.body.appendChild(vrEntry);

const scene = new THREE.Scene();
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

if (!APPLIED) {
  scene.add(new THREE.HemisphereLight(0x9fc0e0, 0x14161c, 0.18));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.45);
  keyLight.position.set(0.9, 1.8, 1.2);
  scene.add(keyLight);
}
const field = APPLIED ? await buildFieldWorkshop(scene, renderer) : null;
if (!APPLIED) buildWorkshop(scene, renderer);
const positioner = field ? new Positioner(field) : null;

// ---------------------------------------------------------------------------
// Workpiece. The field exercise inherits the positioner's articulated frame.
// ---------------------------------------------------------------------------
const workpiece = field?.assembly ?? new THREE.Group();
if (!APPLIED) {
  workpiece.position.set(0, WORK_HEIGHT, WORK_Z);
  scene.add(workpiece);
}
const workpieceOccluders = [];

if (!APPLIED) {

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
workpieceOccluders.push(block, pipe, bore, rim);
} else {
  workpieceOccluders.push(field.assembly);
}
// ---------------------------------------------------------------------------
// Seam, plan, guide, bead, scoring
// ---------------------------------------------------------------------------
const jointDefinitions = APPLIED ? fieldJointDefinitions(field.layout) : [null];
const fieldArcLight = APPLIED ? new THREE.PointLight(0xbcd2ff, 0, 0.55, 2) : null;
if (fieldArcLight) workpiece.add(fieldArcLight);
const exercises = jointDefinitions.map(definition => {
  const seam = definition ? createFieldSeam(definition) : pipeFilletSeam({
    center: new THREE.Vector3(), wallNormal: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0), radius: SEAM_RADIUS,
    plateAim: true,
  });
  const plan = APPLIED ? smallJointPlan(seam) : basicDownhillPlan(seam);
  const guide = new CurvedGuide(workpiece, seam, plan, {
    segments: APPLIED ? 64 : 160,
    zoneHalfWidth: APPLIED ? 0.0022 : 0.0055, ringRadius: APPLIED ? 0.0024 : 0.006,
  });
  const bead = new WeldBead(workpiece, seam, {
    ...weldBeadOptions({ scale: APPLIED ? 0.32 : 0.68, segments: APPLIED ? 192 : 320 }),
    arcLight: fieldArcLight, sparkCount: APPLIED ? 80 : 160,
    gravity: !APPLIED,
  });
  const session = new JointSession(seam, plan, {
    standoffTol: APPLIED ? 0.0012 : 0.0024, lateralTol: APPLIED ? 0.0015 : 0.0035,
    angleTol: 22, speedTol: APPLIED ? 0.0012 : 0.0018,
    workpiece,
  });
  const poseGuide = new PoseGuide(workpiece, seam);
  if (APPLIED) { poseGuide.ring.scale.setScalar(0.4); poseGuide.travel.setLength(0.015, 0.004, 0.002); }
  guide.setVisible(false); poseGuide.setVisible(false);
  return { definition, seam, plan, guide, bead, session, poseGuide,
    demoPlayer: new MasterDemo(seam, plan, poseGuide), desktop: null };
});
let jointIndex = 0;
let { seam, plan, guide, bead, session, poseGuide, demoPlayer } = exercises[0];
// Tight to the nozzle. At 150mm the gauges sat outside the hood's useful cone
// while the eye was on the puddle, so they were only ever read between runs.
const hud = new TorchHud(scene, { width: 0.1, offset: 0.075 });
// Place the panel within reading distance, above the welding area. The basic
// panel sits 24 cm behind the seam; the applied panel starts above the yaw sweep.
const board = new StatsBoard(scene, {
  occluders: workpieceOccluders,
  follow: APPLIED ? null : workpiece,
  width: 0.62,
  position: APPLIED ? new THREE.Vector3(0, 1.68, -0.62)
    : new THREE.Vector3(0, WORK_HEIGHT + 0.43, WORK_Z - 0.24),
});
const visualFeatures = !new URLSearchParams(location.search).has('safe');
// A seam anchor keeps the desktop helmet camera at the actual weld when its
// parent has both a positioner transform and an offset from the pipe centre.
const helmetAnchor = APPLIED ? new THREE.Object3D() : workpiece;
if (APPLIED) {
  helmetAnchor.position.copy(seam.center);
  workpiece.add(helmetAnchor);
}
const helmet = visualFeatures ? new HelmetView(scene, renderer, camera, controls, helmetAnchor, new THREE.Vector3(0, 0.20, 0.32)) : null;
if (APPLIED && helmet) helmet.eyeOffset.copy(jointDefinitions[0].viewOffset);

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
const buildTorchMesh = buildWeldingGun;


/** Place a torch so its NOZZLE TIP lands at `tipPos` aimed along `fwd`. */

// ---------------------------------------------------------------------------
// VR controllers
// ---------------------------------------------------------------------------
// Right physical controller welds; left physical controller moves the fixture.
const WELDING_HAND = 'right';

const vrTorch = buildTorchMesh();
let rodHeld = false;

function holdGun(held) {
  rodHeld = held;
  if (held) {
    rodController.add(vrTorch);
    vrTorch.position.set(0, 0, 0); vrTorch.quaternion.identity();
    rodController.userData.visuals.mountTool(vrTorch);
  } else {
    (field?.liftTop ?? workpiece).add(vrTorch);
    vrTorch.position.copy(APPLIED ? new THREE.Vector3(0.34, 0.83, 0.25) : new THREE.Vector3(0.2, -0.20, 0.15));
    vrTorch.rotation.set(0, 0, Math.PI / 2);
    if (rodController) rodController.userData.trigger = false;
  }
}

const physicalInput = new PhysicalControllers(scene, renderer);
const controllers = physicalInput.controllers;
controllers.forEach((c) => {
  c.userData.trigger = false;
  c.userData.handedness = null;
  c.addEventListener('selectstart', () => {
    if (trainingUI.handleSelect(c)) return;
    if (demo || positioner?.held) return;
    c.userData.trigger = c === rodController;
  });
  c.addEventListener('selectend', () => {
    c.userData.trigger = false;
    c.userData.uiPressed = false;
  });
  c.addEventListener('squeezestart', () => {
    if (c.userData.source?.hand || demo || trainingUI.blocksManipulation) return;
    if (c === rodController) holdGun(true);
    else if (APPLIED) {
      if (c === gripController && !isArcOn() && !trainingUI.controllerHit(c)) positioner.begin(c);
    } else startDrag(c);
  });
  c.addEventListener('squeezeend', () => {
    if (c === rodController && !demo) holdGun(false);
    endDrag(c); positioner?.end(c);
  });
  c.addEventListener('connected', (e) => {
    c.userData.source = e.data;
    c.userData.handedness = e.data?.handedness ?? null;
    assignHands();
  });
  c.addEventListener('disconnected', () => {
    c.userData.source = null;
    c.userData.uiPressed = false;
    c.userData.handedness = null;
    c.userData.trigger = false;
    if (c === rodController) holdGun(false);
    endDrag(c);
    positioner?.end(c);
    assignHands();
  });
});

let rodController = controllers[0];
let gripController = controllers[1];

function assignHands() {
  rodController = physicalInput.right;
  gripController = physicalInput.left;
  holdGun(rodHeld);
}
assignHands();

let drag = null;

function startDrag(controller) {
  if (controller !== gripController || controller.userData.source?.hand || !controller.userData.source || demo || trainingUI.blocksManipulation || isArcOn() || !controller.visible) return;
  if (!controller.userData.tracked) return;
  drag = new WorkpieceGrab(controller, workpiece, 0.6, 1.5);
}
function endDrag(controller) {
  if (drag && drag.controller === controller) drag = null;
}
function updateDrag(dt) {
  if (!drag) return;
  if (isArcOn() || trainingUI.blocksManipulation || !drag.update(dt)) drag = null;
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
  lateral: plan.current.lateralAt(0, seam.length),
  height: APPLIED ? 0.002 : 0.0028,
  travelAngle: plan.current.sample(0).travelAngle,
  workAngle: plan.current.sample(0).workAngle,
};
const desktopTorch = buildTorchMesh();
for (const exercise of exercises) exercise.poseGuide.useTorch(desktopTorch);
workpiece.add(desktopTorch);

let demo = false;
const vrControls = new VRControls(scene, renderer, field?.yaw ?? workpiece, {
  weldingHand: WELDING_HAND, onDemo: toggleDemo, applied: APPLIED,
});
board.configure('pipe', session);
const trainingUI = new TrainingUI({
  scene, renderer, camera, board, controllers, physicalInput, weldingHand: WELDING_HAND,
  helmet, vrControls, getDemo: () => demo, toggleDemo,
  supportsDemo: () => true, reset: resetJoint,
  getHeldTool: () => rodHeld && !demo ? vrTorch : null,
  mode: APPLIED ? 'applied' : 'basic', positioner, resetPositioner,
  getJointLabel: () => exercises[jointIndex].definition?.label,
  nextJoint: APPLIED ? () => selectJoint(jointIndex + 1) : null,
  getTechnique: () => plan.technique,
  setTechnique: value => {
    plan.setTechnique?.(value);
    guide.refreshPaths();
    resetJoint();
  },
});

function toggleDemo() {
  if (demo) {
    demoPlayer.stop(); demo = false;
    holdGun(!!rodController.userData.physicalGripDown && !rodController.userData.needsRelease);
  }
  else demo = demoPlayer.start(renderer.xr.isPresenting ? vrTorch : null, scene);
  drag = null;
  positioner?.end();
  session.lastT = null;
  session.speed = 0;
  for (const c of controllers) c.userData.trigger = false;
  desktopTorch.visible = !renderer.xr.isPresenting;
}

const keys = {};
window.addEventListener('keydown', (e) => {
  if (e.target?.matches('select, input, textarea')) return;
  keys[e.code] = true;
  if (e.code === 'KeyR') resetJoint();
  if (e.code === 'KeyG' && !e.repeat) toggleDemo();
  if (APPLIED && !e.repeat) {
    if (e.code === 'KeyH') resetPositioner();
    if (e.code === 'Digit1') setFieldView('overview');
    if (e.code === 'Digit2') setFieldView('joint');
    if (e.code === 'Digit3') setFieldView('work');
    if (e.code === 'KeyN') selectJoint(jointIndex + 1);
    if (e.code === 'KeyP') selectJoint(jointIndex - 1);
  }
  if (e.code === 'Space' || (APPLIED && ['PageUp', 'PageDown'].includes(e.code))) e.preventDefault();
});
window.addEventListener('keyup', (e) => (keys[e.code] = false));
window.addEventListener('blur', () => {
  for (const key of Object.keys(keys)) keys[key] = false;
  if (!demo) holdGun(false);
  positioner?.end();
});

const overlay = document.getElementById('overlay');
const readout = document.getElementById('readout');
const result = document.getElementById('result');

renderer.xr.addEventListener('sessionstart', () => {
  controls.enabled = false;
  overlay.style.display = 'none';
  if (demo) toggleDemo();
  desktopTorch.visible = false;
  vrTorch.visible = true;
});
renderer.xr.addEventListener('sessionend', () => {
  if (demo) toggleDemo();
  holdGun(false);
  controls.enabled = true;
  overlay.style.display = 'block';
  desktopTorch.visible = true;
  positioner?.end();
});

function resetPositioner() {
  if (!positioner || isArcOn() || demo) return;
  positioner.home();
  session.lastT = null; session.speed = 0;
}

function selectJoint(index) {
  if (!APPLIED || isArcOn() || positioner.held) return;
  if (demo) toggleDemo();
  exercises[jointIndex].desktop = { ...desktop };
  guide.setVisible(false); poseGuide.setVisible(false);
  jointIndex = THREE.MathUtils.euclideanModulo(index, exercises.length);
  ({ seam, plan, guide, bead, session, poseGuide, demoPlayer } = exercises[jointIndex]);
  const initial = { p: 0, lateral: 0, height: 0.002, travelAngle: -8, workAngle: 0 };
  Object.assign(desktop, exercises[jointIndex].desktop ?? initial);
  session.lastT = null; session.speed = 0;
  lastStrokeIndex = plan.index; wasFinished = session.finished;
  board.configure('pipe', session); board.reset();
  if (session.finished) showResult(); else result.style.display = 'none';
  helmetAnchor.position.copy(seam.center);
  if (helmet) helmet.eyeOffset.copy(jointDefinitions[jointIndex].viewOffset);
  document.getElementById('field-joint').value = String(jointIndex);
  if (!renderer.xr.isPresenting) setFieldView('joint');
}

function setFieldView(view) {
  if (!field || renderer.xr.isPresenting) return;
  if (helmet?.enabled) helmet.toggle();
  if (view === 'joint') {
    controls.target.copy(workpiece.localToWorld(seam.center.clone()));
    camera.position.copy(workpiece.localToWorld(seam.center.clone().add(jointDefinitions[jointIndex].viewOffset)));
  } else if (view === 'overview') {
    camera.position.set(-0.8, 1.9, 3.2);
    controls.target.set(-0.1, 1.15, -0.75);
  } else {
    camera.position.set(0, 1.72, 0.35);
    controls.target.set(0, 1.47, -0.68);
  }
  controls.maxDistance = 6;
  controls.update();
}
document.getElementById('field-overview')?.addEventListener('click', () => setFieldView('overview'));
document.getElementById('field-closeup')?.addEventListener('click', () => setFieldView('joint'));
document.getElementById('field-work')?.addEventListener('click', () => setFieldView('work'));
document.getElementById('field-home')?.addEventListener('click', resetPositioner);
if (APPLIED) setFieldView('work');
if (APPLIED) {
  const selector = document.getElementById('field-joint');
  jointDefinitions.forEach((definition, index) => selector.add(new Option(definition.label, index)));
  selector.addEventListener('change', () => {
    selectJoint(Number(selector.value)); selector.value = String(jointIndex); selector.blur();
  });
}

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
 * stays zero the whole way round a correct weld in applied mode. Basic
 * plateAim instead uses the plate normal and its configurable work angle.
 */
function rodForward(frame, travelAngleDeg, workAngleDeg, target) {
  if (seam.plateAim) return target.copy(frame.normal).negate()
    .addScaledVector(frame.travel, Math.tan(THREE.MathUtils.degToRad(travelAngleDeg)))
    .addScaledVector(frame.lateral, Math.tan(THREE.MathUtils.degToRad(workAngleDeg))).normalize();
  return target
    .copy(frame.normal)
    .negate()
    .applyAxisAngle(frame.lateral, THREE.MathUtils.degToRad(travelAngleDeg))
    .applyAxisAngle(frame.travel, THREE.MathUtils.degToRad(workAngleDeg))
    .normalize();
}

function updateDesktopRod(dt) {
  if (renderer.xr.isPresenting || demo) return;

  const stroke = activeStroke();

  {
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
  if (renderer.xr.isPresenting) {
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
  if (renderer.xr.isPresenting) {
    // The tip's own orientation, not the controller's. With a swan neck the
    // handle axis and the arc axis are 48 degrees apart, and grading the
    // handle would mark a correctly held gun as badly rolled.
    rodController.updateMatrixWorld(true);
    vrTorch.userData.tip.getWorldQuaternion(_q);
    target.set(0, 0, -1).applyQuaternion(_q);
    workpiece.getWorldQuaternion(_q).invert();
    return target.applyQuaternion(_q).normalize();
  }
  const stroke = activeStroke();
  const frame = seam.frameAt(stroke.tAt(desktop.p), _frame);
  return rodForward(frame, desktop.travelAngle, desktop.workAngle, target);
}

// A trainee starts at the beginning; the replay owns its separate cursor.
function strokeStartP() {
  return 0;
}

function isArcOn() {
  if (demo || positioner?.held || positioner?.moving || trainingUI.blocksArc(rodController)) return false;
  return renderer.xr.isPresenting
    ? rodHeld && rodController.userData.physicalGripDown && rodController.visible &&
      rodController.userData.handedness === WELDING_HAND && rodController.userData.trigger
    : !!keys['Space'];
}

let lastStrokeIndex = 0;

function resetJoint() {
  if (demo) toggleDemo();
  poseGuide?.reset();
  session.reset();
  bead.reset();
  board.reset();
  desktop.p = strokeStartP(activeStroke());
  desktop.lateral = activeStroke().lateralAt(0, seam.length);
  desktop.height = APPLIED ? 0.002 : 0.0028;
  desktop.travelAngle = activeStroke().sample(0).travelAngle;
  desktop.workAngle = activeStroke().sample(0).workAngle;
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
         작업각 ${s.work}% · 이음부 ${s.tieIn}% · 진행방향 ${s.direction}%</p>`
    )
    .join('');
  result.innerHTML = `
    <h2>용접 결과 · ${r.total}점</h2>
    ${rows}
    <div class="bar"><span>비드 적층률</span><b>${r.coverage}%</b></div>
    ${r.physics ? `<p class="hint">모델 지표(0~100): 용입 ${r.physics.penetration} · 흘러내림 ${r.physics.runoff} · 융합불량 ${r.physics.fusionRisk} · 슬래그 ${r.physics.slagRisk} — 실제 결함 판정 아님</p>` : ''}
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
  physicalInput.update(xrFrame, dt);

  if (renderer.xr.isPresenting) readViewerPosition(xrFrame);
  else _viewer.copy(camera.position);
  vrControls.update(_viewer, demo);
  trainingUI.update(xrFrame);
  // Previously welded joints remain visible and cool while another is active.
  for (let i = 0; i < exercises.length; i++) {
    if (i !== jointIndex) exercises[i].bead.update(dt, { arcOn: false, point: exercises[i].seam.start, t: 0, passive: true });
  }
  if (positioner) {
    // Read raw arc intent so simultaneous keyboard motion cannot start an arc
    // while a workpiece transform is still being applied.
    const arcRequested = renderer.xr.isPresenting ? !!rodController.userData.trigger : !!keys.Space;
    positioner.update(dt, keys, {
      blocked: demo || trainingUI.blocksManipulation || (arcRequested && !positioner.held),
      xr: renderer.xr.isPresenting,
      controller: gripController,
    });
    if (positioner.held || positioner.moving) {
      session.lastT = null; session.speed = 0;
    }
  }
  vrTorch.visible = demo || (renderer.xr.isPresenting && (!rodHeld ||
    (!!rodController.userData.source && !rodController.userData.source.hand &&
      rodController.userData.handedness === WELDING_HAND)));
  if (demo) {
    demoPlayer.update(dt);
    board.demoStage = plan.sequential ? plan.strokes[demoPlayer.index].label : null;
    guide.setVisible(false);
    hud.setVisible(false);
    bead.update(dt, { arcOn: false, point: _contact, t: 0 });
    board.update(dt);
    helmet?.update(false);
    if (!renderer.xr.isPresenting) controls.update();
    renderer.render(scene, camera);
    window.weldReady = true;
    return;
  }
  guide.setVisible(trainingUI.guides);
  hud.setVisible(trainingUI.guides);
  if (!APPLIED) updateDrag(dt);
  updateDesktopRod(dt);
  getTipLocal(_tip);
  getForwardLocal(_fwd);
  // The displayed controller pose is already filtered; score that same pose.

  const arcOn = isArcOn() && !session.finished;
  const m = session.sample(dt, _tip, _fwd, arcOn);

  // A finished stroke hands the desktop controls back to the start of the next
  // one, so W keeps meaning "forward" without the trainee having to find six
  // o'clock again by hand.
  if (m.strokeIndex !== lastStrokeIndex) {
    lastStrokeIndex = m.strokeIndex;
    poseGuide?.reset();
    const continuous = m.stroke?.requireArcBreak === false && plan.current;
    desktop.p = continuous ? plan.current.progressOf(m.t) : strokeStartP();
    if (!continuous) desktop.lateral = activeStroke().lateralAt(0, seam.length);
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
    lateral: m.lateral,
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
      nominalSpeed: m.target?.speed,
      quality: m.quality,
      physics: m.physics, dir: m.stroke?.dir,
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
    // Positioner rotation changes gravity relative to the local clock face.
    const worldNormal = seam.frameAt(m.t, _frame).normal.clone();
    workpiece.getWorldQuaternion(_q); worldNormal.applyQuaternion(_q);
    const posture = worldNormal.y > 0.35 ? '아래보기' : worldNormal.y < -0.35 ? '위보기' : '수직';
    const label = (APPLIED ? jointDefinitions[jointIndex].label + ' · ' : '') + (m.stroke ? m.stroke.label : '완료');
    readout.textContent =
      `${label}  ·  ${hour === 0 ? 12 : hour}시 방향(${posture})  ·  ` +
      `진행 ${Math.round(THREE.MathUtils.clamp(m.p, 0, 1) * 100)}%${m.onSeam ? '' : ' (이탈)'}  ·  ` +
      `아크길이 ${(m.height * 1000).toFixed(1)}mm` +
      (m.target ? ` / 목표 ${(m.target.standoff * 1000).toFixed(1)}mm` : '') +
      `  ·  속도 ${(m.strokeSpeed * 1000).toFixed(1)}mm/s` +
      (m.target ? ` / 목표 ${(m.target.speed * 1000).toFixed(1)}mm/s` : '') +
      `  ·  작업각오차 ${(m.workAngleDeg - (m.target?.workAngle ?? 0)).toFixed(0)}°` +
      (demo ? '  ·  [명장 궤적 재생 중]' : '');
    if (positioner) document.getElementById('positioner-readout').textContent = positioner.readout;
  }


  const poseStroke = plan.current;
  poseGuide.setVisible(trainingUI.guides && !!poseStroke);
  if (trainingUI.guides && poseStroke && poseGuide) {
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

if (APPLIED) {
  document.getElementById('loading-field').textContent = '작업장 재질을 준비하는 중…';
  await renderer.compileAsync(scene, camera);
  vrEntry.appendChild(VRButton.createButton(renderer));
}
document.getElementById('loading-field')?.remove();
vrEntry.hidden = false;
renderer.setAnimationLoop(animate);

if (new URLSearchParams(location.search).has('debug')) {
  window.weldDebug = { field, positioner, physicalInput, board, trainingUI,
    getTipLocal, getForwardLocal, updateDesktopRod, vrControls, toggleDemo, helmet,
    scene, camera, controls, renderer, hud, desktop, workpiece, exercises, selectJoint,
    get jointIndex() { return jointIndex; }, get seam() { return seam; },
    get plan() { return plan; }, get guide() { return guide; }, get bead() { return bead; },
    get session() { return session; }, get poseGuide() { return poseGuide; }, get demoPlayer() { return demoPlayer; },
  };
}
