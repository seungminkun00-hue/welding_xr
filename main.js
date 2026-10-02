import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WeldingGuideManager } from './WeldingGuideManager.js';

// ---------------------------------------------------------------------------
// Geometry constants (meters). Plate stands vertically; the pipe protrudes
// through it toward the viewer (+Z), so the weld joint is a vertical circle
// facing the welder -- this is what makes "6 o'clock / 12 o'clock" meaningful.
// ---------------------------------------------------------------------------
const PIPE_RADIUS = 0.05;
const PIPE_LENGTH = 0.18;
const PLATE_SIZE = 0.32;
const PLATE_THICKNESS = 0.02;

const TORCH_LENGTH = 0.15;
const MOVE_SPEED = 0.08; // m/s, desktop keyboard torch position speed
const STANDOFF_SPEED = 0.05; // m/s, desktop Q/E standoff speed
const TILT_SPEED = 1.2; // rad/s, desktop arrow-key tilt speed
const TILT_LIMIT = 0.85; // rad (~49 deg)

// Joint circle lives at the plate's front face, centered on the pipe axis.
const jointCenterLocal = new THREE.Vector3(0, 0, PLATE_THICKNESS / 2);
const jointRight = new THREE.Vector3(1, 0, 0);
const jointUp = new THREE.Vector3(0, 1, 0);
const jointNormal = new THREE.Vector3().crossVectors(jointRight, jointUp); // (0,0,1)

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
scene.background = new THREE.Color(0x0b0e14);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0, 1.3, 0.05);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.3, -0.35);
controls.enableDamping = true;
controls.minDistance = 0.1;
controls.maxDistance = 2;
controls.update();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Lighting + floor reference
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x1a1a1f, 0.9));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
dirLight.position.set(1, 2, 1);
scene.add(dirLight);
scene.add(new THREE.GridHelper(4, 40, 0x2a3240, 0x1a2029));

// ---------------------------------------------------------------------------
// Workpiece: vertical plate + horizontal pipe poking through toward +Z.
// NOTE: this group only ever gets a translation (no rotation/scale), so
// world-space direction vectors double as workpiece-local direction vectors.
// ---------------------------------------------------------------------------
const workpiece = new THREE.Group();
workpiece.position.set(0, 1.3, -0.35);
scene.add(workpiece);

const plate = new THREE.Mesh(
  new THREE.BoxGeometry(PLATE_SIZE, PLATE_SIZE, PLATE_THICKNESS),
  new THREE.MeshStandardMaterial({ color: 0x8c8c92, metalness: 0.6, roughness: 0.5 })
);
workpiece.add(plate);

const pipe = new THREE.Mesh(
  new THREE.CylinderGeometry(PIPE_RADIUS, PIPE_RADIUS, PIPE_LENGTH, 48),
  new THREE.MeshStandardMaterial({ color: 0x9a9aa0, metalness: 0.6, roughness: 0.45 })
);
pipe.rotation.x = Math.PI / 2; // cylinder axis (+Y) -> +Z, pointing at the viewer
pipe.position.z = PLATE_THICKNESS / 2 + PIPE_LENGTH / 2;
workpiece.add(pipe);

// ---------------------------------------------------------------------------
// Welding guide system
// ---------------------------------------------------------------------------
const overlay = document.getElementById('overlay');

const guideManager = new WeldingGuideManager(workpiece, {
  center: jointCenterLocal,
  radius: PIPE_RADIUS,
  right: jointRight,
  up: jointUp,
  idealStandoff: 0.012,
  idealTiltDeg: 45,
  expertPassDuration: 7.0,
  onPhaseComplete: (phaseIndex) => {
    console.log(`[weld] phase ${phaseIndex} complete`);
  },
  onWeldComplete: () => {
    console.log('[weld] complete');
  },
});
guideManager.start();

// Floating HUD readout (billboarded canvas texture), shows manager status text.
const hudCanvas = document.createElement('canvas');
hudCanvas.width = 512;
hudCanvas.height = 160;
const hudCtx = hudCanvas.getContext('2d');
const hudTexture = new THREE.CanvasTexture(hudCanvas);
const hudPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(0.34, 0.1),
  new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true })
);
hudPlane.position.set(0, PIPE_RADIUS + 0.1, PLATE_THICKNESS / 2 + 0.09);
workpiece.add(hudPlane);

function updateHud(text) {
  const ctx = hudCtx;
  ctx.clearRect(0, 0, 512, 160);
  ctx.fillStyle = 'rgba(10,14,22,0.78)';
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 160, 20);
  ctx.fill();
  ctx.fillStyle = '#eaeef2';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(text, 24, 95);
  hudTexture.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Torch: VR controller + desktop keyboard fallback
// ---------------------------------------------------------------------------
function buildTorchMesh() {
  const group = new THREE.Group();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.008, TORCH_LENGTH, 16),
    new THREE.MeshStandardMaterial({ color: 0x222227, metalness: 0.3, roughness: 0.6 })
  );
  cone.rotation.x = -Math.PI / 2; // point along local -Z
  cone.position.z = -TORCH_LENGTH / 2;
  group.add(cone);

  const tip = new THREE.Object3D();
  tip.position.z = -TORCH_LENGTH;
  group.add(tip);
  group.userData.tip = tip;
  return group;
}

const controller1 = renderer.xr.getController(0);
const torch1 = buildTorchMesh();
controller1.add(torch1);
scene.add(controller1);

const controller2 = renderer.xr.getController(1);
scene.add(controller2);

renderer.xr.addEventListener('sessionstart', () => {
  overlay.style.display = 'none';
  desktopTorchMesh.visible = false;
});
renderer.xr.addEventListener('sessionend', () => {
  overlay.style.display = 'block';
  desktopTorchMesh.visible = true;
});

// Desktop fallback: WASD moves the torch in the joint plane, Q/E adjusts
// standoff distance, arrow keys tilt the approach angle.
const desktopTorchLocalPos = jointCenterLocal
  .clone()
  .addScaledVector(jointUp, -PIPE_RADIUS)
  .addScaledVector(jointNormal, 0.012); // start at 6 o'clock, at ideal standoff
let desktopTiltX = 0; // yaw, rad
let desktopTiltY = 0; // pitch, rad

const desktopTorchMesh = buildTorchMesh();
workpiece.add(desktopTorchMesh);

const keys = {};
window.addEventListener('keydown', (e) => (keys[e.code] = true));
window.addEventListener('keyup', (e) => (keys[e.code] = false));

function getDesktopForward() {
  return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(desktopTiltY, desktopTiltX, 0));
}

function updateDesktopTorch(dt) {
  if (renderer.xr.isPresenting) return;
  const d = MOVE_SPEED * dt;
  if (keys['KeyA']) desktopTorchLocalPos.x -= d;
  if (keys['KeyD']) desktopTorchLocalPos.x += d;
  if (keys['KeyW']) desktopTorchLocalPos.y += d;
  if (keys['KeyS']) desktopTorchLocalPos.y -= d;
  if (keys['KeyQ']) desktopTorchLocalPos.z += STANDOFF_SPEED * dt;
  if (keys['KeyE']) desktopTorchLocalPos.z -= STANDOFF_SPEED * dt;
  desktopTorchLocalPos.z = THREE.MathUtils.clamp(
    desktopTorchLocalPos.z,
    PLATE_THICKNESS / 2,
    PLATE_THICKNESS / 2 + 0.08
  );

  if (keys['ArrowLeft']) desktopTiltX -= TILT_SPEED * dt;
  if (keys['ArrowRight']) desktopTiltX += TILT_SPEED * dt;
  if (keys['ArrowUp']) desktopTiltY -= TILT_SPEED * dt;
  if (keys['ArrowDown']) desktopTiltY += TILT_SPEED * dt;
  desktopTiltX = THREE.MathUtils.clamp(desktopTiltX, -TILT_LIMIT, TILT_LIMIT);
  desktopTiltY = THREE.MathUtils.clamp(desktopTiltY, -TILT_LIMIT, TILT_LIMIT);

  const fwd = getDesktopForward();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), fwd);
  desktopTorchMesh.quaternion.copy(q);
  desktopTorchMesh.position.copy(desktopTorchLocalPos).addScaledVector(fwd, -TORCH_LENGTH);
}

function getTorchTipLocal() {
  if (renderer.xr.isPresenting) {
    controller1.updateMatrixWorld(true); // force-sync before renderer.render() does it
    const tipWorld = new THREE.Vector3();
    torch1.userData.tip.getWorldPosition(tipWorld);
    return workpiece.worldToLocal(tipWorld);
  }
  return desktopTorchLocalPos.clone();
}

function getTorchForward() {
  if (renderer.xr.isPresenting) {
    const q = new THREE.Quaternion();
    controller1.getWorldQuaternion(q);
    return new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  }
  return getDesktopForward();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let hudTimer = 0;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateDesktopTorch(dt);

  const tipLocal = getTorchTipLocal();
  const fwd = getTorchForward();
  guideManager.update(dt, tipLocal, fwd);

  hudTimer += dt;
  if (hudTimer > 0.1) {
    hudTimer = 0;
    updateHud(guideManager.getStatusText());
    hudPlane.lookAt(camera.position);
  }

  controls.update();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
