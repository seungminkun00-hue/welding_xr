import * as THREE from 'three';

// The two guns, in one place.
//
// Both were previously built inline in main.js and pipe.js. Keeping two copies
// of the same geometry cost a real bug: the electrode on the swan-neck gun ran
// 2 mm past the object the arc length is measured from, so on a 2.6 mm target
// the rod had to be held buried in the pipe to read correct. A fix in one copy
// does not reach the other, so there is only one copy now.
//
// Every torch exposes `userData.tip`: a child object sitting exactly at the
// electrode end and carrying its own orientation. Nothing downstream may
// assume the handle axis -- on the swan neck the handle and the arc are 48
// degrees apart, and grading the handle marks a correctly held gun as rolled.

const _unitY = new THREE.Vector3(0, 1, 0);
const _unitNegZ = new THREE.Vector3(0, 0, -1);
const _tipInv = new THREE.Matrix4();
const _poseMat = new THREE.Matrix4();
const _poseQ = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);

/** Straight MIG gun for the flat butt joint. Length is the tip's own offset. */
export function buildMigTorch(length = 0.15) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.011, length * 0.72, 20),
    new THREE.MeshStandardMaterial({ color: 0x1d2026, metalness: 0.35, roughness: 0.55 })
  );
  body.rotation.x = -Math.PI / 2;
  body.position.z = -length * 0.36;
  group.add(body);

  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0085, 0.0105, length * 0.26, 20),
    new THREE.MeshStandardMaterial({ color: 0x5a5f68, metalness: 0.8, roughness: 0.35 })
  );
  nozzle.rotation.x = -Math.PI / 2;
  nozzle.position.z = -length * 0.85;
  group.add(nozzle);

  // Centred so the wire ENDS on the tip, never past it.
  const wire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0006, 0.0006, length * 0.1, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8b26a, metalness: 0.9, roughness: 0.3 })
  );
  wire.rotation.x = -Math.PI / 2;
  wire.position.z = -length * 0.95;
  group.add(wire);

  const tip = new THREE.Object3D();
  tip.position.z = -length;
  tip.updateMatrix();
  group.add(tip);
  group.userData.tip = tip;
  group.userData.reach = length;
  return group;
}

/** Swan-neck holder for the pipe fillet, the shape a stick welder works with. */
export function buildStickHolder() {
  const group = new THREE.Group();

  const black = new THREE.MeshStandardMaterial({
    color: 0x16181d, metalness: 0.25, roughness: 0.68,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: 0xc6ccd4, metalness: 0.95, roughness: 0.18,
  });

  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.1, 12), black);
  cable.rotation.x = -Math.PI / 2;
  cable.position.z = 0.072;
  group.add(cable);

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0205, 0.0225, 0.105, 20), black);
  handle.rotation.x = -Math.PI / 2;
  handle.position.z = -0.012;
  group.add(handle);

  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.03), black);
  trigger.position.set(0, -0.021, -0.034);
  group.add(trigger);

  // The swan neck. Quadratic bend so the end tangent is a clean 48 degrees.
  const p0 = new THREE.Vector3(0, 0, -0.062);
  const p1 = new THREE.Vector3(0, 0, -0.094);
  const p2 = new THREE.Vector3(0, -0.024, -0.115);
  const neckCurve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
  const neck = new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 24, 0.0098, 14, false), chrome);
  group.add(neck);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.014, 16), black);
  collar.position.copy(p0);
  collar.rotation.x = Math.PI / 2;
  group.add(collar);

  const endDir = new THREE.Vector3().subVectors(p2, p1).normalize();
  const tipPos = p2.clone().addScaledVector(endDir, 0.02);

  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.0092, 0.0115, 0.026, 18), black);
  nozzle.position.copy(p2).addScaledVector(endDir, 0.011);
  nozzle.quaternion.setFromUnitVectors(_unitY, endDir);
  group.add(nozzle);

  // Half the rod's length back from the tip, so the rod ends exactly on it.
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.0007, 0.012, 8), chrome);
  wire.position.copy(tipPos).addScaledVector(endDir, -0.006);
  wire.quaternion.setFromUnitVectors(_unitY, endDir);
  group.add(wire);

  const tip = new THREE.Object3D();
  tip.position.copy(tipPos);
  tip.quaternion.setFromUnitVectors(_unitNegZ, endDir);
  tip.updateMatrix();
  group.add(tip);
  group.userData.tip = tip;
  group.userData.reach = 0.134;
  return group;
}

/** Place a torch so its electrode tip lands at `tipPos` aimed along `fwd`. */
export function poseTorchByTip(mesh, tipPos, fwd) {
  _tipInv.copy(mesh.userData.tip.matrix).invert();
  _poseQ.setFromUnitVectors(_unitNegZ, fwd);
  _poseMat.compose(tipPos, _poseQ, _one).multiply(_tipInv);
  _poseMat.decompose(mesh.position, mesh.quaternion, mesh.scale);
}
