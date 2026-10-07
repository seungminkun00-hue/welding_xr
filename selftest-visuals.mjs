import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HelmetView } from './src/HelmetView.js';
import { PoseGuide } from './src/PoseGuide.js';
import { pipeFilletSeam } from './src/SeamCurve.js';
import { pipeFilletPlan } from './src/PassPlan.js';
import { WeldBead } from './src/WeldBead.js';
import { VRControls } from './src/VRControls.js';
import { PoseStabilizer } from './src/Stability.js';
import { TorchHud } from './src/TorchHud.js';

globalThis.window = { addEventListener() {} };
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
camera.position.set(1, 2, 3);
const controls = { target: new THREE.Vector3(), update() {} };
const left = { handedness: 'left', gamepad: { mapping: 'xr-standard', buttons: Array.from({ length: 6 }, () => ({ pressed: false })) } };
const right = { handedness: 'right', gamepad: { mapping: 'xr-standard', buttons: Array.from({ length: 6 }, () => ({ pressed: false })) } };
const renderer = { xr: { isPresenting: true, getSession: () => ({ inputSources: [right, left] }), addEventListener() {} } };
const workpiece = new THREE.Group();
const helmet = new HelmetView(scene, renderer, camera, controls, workpiece, new THREE.Vector3(0, 0.2, 0.3));
right.gamepad.buttons[4].pressed = true;
helmet.update(false);
assert.equal(helmet.enabled, false, 'right A must not toggle the helmet');
left.gamepad.buttons[4].pressed = true;
helmet.update(true);
assert.equal(helmet.enabled, true);
helmet.update(true);
assert.equal(helmet.enabled, true, 'holding X must not repeatedly toggle');
assert.deepEqual(camera.position.toArray(), [1, 2, 3], 'headset viewpoint must not teleport');
left.gamepad.buttons[4].pressed = false;
helmet.update(false);
left.gamepad.buttons[4].pressed = true;
helmet.update(false);
assert.equal(helmet.enabled, false);
renderer.xr.isPresenting = false;
helmet.toggle();
assert.deepEqual(camera.position.toArray(), [0, 0.2, 0.3]);
helmet.toggle();
assert.deepEqual(camera.position.toArray(), [1, 2, 3], 'desktop orbit position restores');
let copiedOrigin;
helmet.captureEye({
  getCurrentViewport: target => target.set(800, 0, 800, 900),
  copyFramebufferToTexture: (origin, texture) => {
    copiedOrigin = origin.toArray();
    assert.equal(texture.image.width, 800);
    assert.equal(texture.image.height, 900);
  },
});
assert.deepEqual(copiedOrigin, [800, 0], 'right eye samples its own framebuffer region');
const rightCapture = helmet.capture;
const captureEye = (x, width) => helmet.captureEye({
  getCurrentViewport: target => target.set(x, 0, width, 900),
  copyFramebufferToTexture() {},
});
captureEye(0, 799);
const leftCapture = helmet.capture;
assert.notEqual(leftCapture, rightCapture, 'each eye has a separate capture');
captureEye(800, 800);
assert.equal(helmet.capture, rightCapture, 'right-eye capture is reused across frames');
captureEye(0, 799);
assert.equal(helmet.capture, leftCapture, 'asymmetric eye sizes do not reallocate every draw');
assert.equal(helmet.filter.material.uniformsNeedUpdate, true, 'sampler switches between eye textures');

globalThis.document = { createElement: () => ({ getContext: () => ({ clearRect() {}, fillRect() {}, fillText() {} }) }) };
let demoToggles = 0;
const vrControls = new VRControls(scene, renderer, workpiece, { onDemo: () => demoToggles++ });
renderer.xr.isPresenting = true;
left.gamepad.buttons[5].pressed = true;
vrControls.update(new THREE.Vector3(0, 1, 1), false);
vrControls.update(new THREE.Vector3(0, 1, 1), false);
assert.equal(demoToggles, 1, 'holding left Y toggles the replay once');
assert.equal(vrControls.mesh.visible, true, 'instructions are visible in VR');
right.gamepad.buttons[5].pressed = true;
vrControls.update(new THREE.Vector3(0, 1, 1), false);
vrControls.update(new THREE.Vector3(0, 1, 1), false);
assert.equal(vrControls.mesh.visible, false, 'right B hides the instructions without repeat');
left.gamepad.buttons[5].pressed = false;
vrControls.update(new THREE.Vector3(0, 1, 1), false);
left.gamepad.buttons[5].pressed = true;
vrControls.update(new THREE.Vector3(0, 1, 1), false);
assert.equal(demoToggles, 2, 'second Y press returns from replay');

const stabilizer = new PoseStabilizer();
const handPosition = new THREE.Vector3();
const handDirection = new THREE.Vector3(0, -1, 0);
stabilizer.update(1 / 72, handPosition, handDirection);
let filteredPeak = 0;
for (let i = 0; i < 72; i++) {
  handPosition.set(i % 2 ? 0.002 : -0.002, 0, 0);
  stabilizer.update(1 / 72, handPosition, handDirection);
  filteredPeak = Math.max(filteredPeak, Math.abs(handPosition.x));
}
assert.ok(filteredPeak < 0.0006, '2mm tracking chatter is attenuated');
handPosition.set(0.5, 0, 0);
stabilizer.update(1 / 72, handPosition, handDirection);
assert.equal(handPosition.x, 0.5, 'large reposition does not drag an old filtered pose');

globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: (obj, key) => key in obj ? obj[key] : () => {} }) }) };
const hud = new TorchHud(scene);
const hudInput = { depth: 1.5, center: { x: 1.5, y: -1.5 }, speed: 1, anchor: new THREE.Vector3(), viewer: new THREE.Vector3(0, 1, 1) };
hud.update(1 / 72, hudInput);
assert.ok(hud.state.depth < 0.15, 'depth gauge does not jump to a one-frame spike');
assert.ok(hud.state.center.x < 0.15, 'crosshair does not jump to a one-frame spike');
assert.ok(hud.state.speed < 0.55, 'speed gauge does not jump to a one-frame spike');
for (let i = 0; i < 144; i++) hud.update(1 / 72, hudInput);
assert.ok(hud.state.depth > 1.49, 'sustained technique error remains visible');

const seam = pipeFilletSeam({ center: new THREE.Vector3(), wallNormal: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), radius: 0.0335 });
const plan = pipeFilletPlan(seam);
const pose = new PoseGuide(workpiece, seam);
for (const t of [0, 0.25, 0.5, 0.75]) {
  pose.update(t, { standoff: 0.003, travelAngle: -10, workAngle: 0 });
  const actualTip = pose.rod.position.clone().addScaledVector(pose.direction, -0.06);
  const coords = seam.decompose(actualTip);
  assert.ok(Math.abs(coords.height - 0.003) < 0.00001, 'ghost tip follows rotating joint frame');
  assert.ok(Math.abs(coords.lateral) < 0.00001);
  assert.ok(pose.points.every(Number.isFinite));
}
const bead = new WeldBead(workpiece, seam);
bead.deposit(0.5, { t: 0.5, lateral: 0, speedRatio: 1, quality: 0 });
assert.ok(bead.spatter.count > 0, 'welding leaves solid spatter');
bead.reset();
assert.equal(bead.spatter.count, 0);
bead.dispose();
assert.equal(workpiece.children.includes(bead.spatter), false);
console.log('PASS visual controls, stereo-safe helmet placement, curved 3D pose, solid spatter lifecycle');
