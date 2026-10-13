import * as THREE from 'three';
import { SeamCurve } from './SeamCurve.js';
import { pipeFilletPlan } from './PassPlan.js';

// Both marked joints are perpendicular cylinder intersections, not a ring
// around the large end flange. Authoring and runtime share joint-layout.json.
export function fieldJointDefinitions(layout) {
  const { mainRadius: R, lineRadius: r, bossRadius: B, bossZ, elbowZ, lineY } = layout;
  return layout.lineX.flatMap((x, i) => {
    const prefix = layout.lineX.length === 1 ? '작은 배관' : `배관 ${String.fromCharCode(65 + i)}`;
    return [
      {
        id: `line-${i}-side`, label: `${prefix} · 옆면 접합`, radius: r,
        center: new THREE.Vector3(x, lineY, bossZ - B),
        viewOffset: new THREE.Vector3(-0.09, 0.11, -0.19),
        sample(u) {
          const a = u * Math.PI * 2, dx = r * Math.sin(a), dy = r * Math.cos(a);
          const dz = -Math.sqrt(B * B - dx * dx);
          return {
            position: new THREE.Vector3(x + dx, lineY + dy, bossZ + dz),
            hostNormal: new THREE.Vector3(dx, 0, dz).normalize(),
            branchNormal: new THREE.Vector3(dx, dy, 0).normalize(),
          };
        },
        // Nearest surface on the vertical boss or the horizontal small tube.
        projectHost(p) {
          const d = Math.hypot(p.x - x, p.z - bossZ);
          p.x = x + (p.x - x) * B / d; p.z = bossZ + (p.z - bossZ) * B / d;
          return p;
        },
        projectBranch(p) {
          const d = Math.hypot(p.x - x, p.y - lineY);
          p.x = x + (p.x - x) * r / d; p.y = lineY + (p.y - lineY) * r / d;
          return p;
        },
      },
      {
        id: `line-${i}-base`, label: `${prefix} · 곡면 접합`, radius: r,
        center: new THREE.Vector3(x, Math.sqrt(R * R - x * x), elbowZ),
        viewOffset: new THREE.Vector3(-0.08, 0.17, 0.14),
        sample(u) {
          const a = u * Math.PI * 2, dx = r * Math.cos(a), dz = r * Math.sin(a);
          const y = Math.sqrt(R * R - (x + dx) ** 2);
          return {
            position: new THREE.Vector3(x + dx, y, elbowZ + dz),
            hostNormal: new THREE.Vector3(x + dx, y, 0).normalize(),
            branchNormal: new THREE.Vector3(dx, 0, dz).normalize(),
          };
        },
        projectHost(p) {
          const d = Math.hypot(p.x, p.y);
          p.x *= R / d; p.y *= R / d; return p;
        },
        projectBranch(p) {
          const d = Math.hypot(p.x - x, p.z - elbowZ);
          p.x = x + (p.x - x) * r / d; p.z = elbowZ + (p.z - elbowZ) * r / d;
          return p;
        },
      },
    ];
  });
}

export function createFieldSeam(definition) {
  const seam = new SeamCurve(u => {
    const { position, hostNormal, branchNormal } = definition.sample(u);
    return { position, normal: hostNormal.add(branchNormal).normalize() };
  }, { closed: true, resolution: 320 });
  seam.center = definition.center.clone();
  seam.radius = definition.radius;
  seam.clockAt = t => THREE.MathUtils.euclideanModulo(t, 1) * 12;
  // Attach a surface projector for the shared bead and heat-tint renderers.
  // Its t is arc length, so obtain the host normal from the actual seam point.
  const p = new THREE.Vector3(), h = new THREE.Vector3();
  const host = new THREE.Vector3(), branch = new THREE.Vector3(), offset = new THREE.Vector3();
  const frame = { travel: new THREE.Vector3(), normal: new THREE.Vector3(), lateral: new THREE.Vector3() };
  seam.surfacePoint = (t, lateral, target = new THREE.Vector3()) => {
    seam.pointAt(t, p); seam.frameAt(t, frame);
    // Project a small outward step to determine the host-facing side without
    // assuming that geometric angle and arc length are interchangeable.
    h.copy(p).addScaledVector(frame.lateral, lateral);
    definition.projectHost(host.copy(h));
    definition.projectBranch(branch.copy(h));
    // The visible union boundary is the candidate displaced furthest toward
    // the outside of the fillet. The other lies inside the intersecting solid.
    const hostLift = offset.subVectors(host, h).dot(frame.normal);
    const branchLift = offset.subVectors(branch, h).dot(frame.normal);
    return target.copy(hostLift >= branchLift ? host : branch);
  };
  return seam;
}

export function smallJointPlan(seam) {
  const plan = pipeFilletPlan(seam);
  for (let i = 0; i < plan.strokes.length; i++) {
    const stroke = plan.strokes[i];
    stroke.label = `${i + 1}획 · 작은 접합부 ${i === 0 ? '첫 번째' : '반대쪽'} 반원`;
    stroke.tieIn = { lead: i ? 0.001 : 0, trail: 0.001 };
    stroke.profile = {
      speed: [[0, 0.002], [1, 0.002]],
      standoff: [[0, 0.002], [1, 0.002]],
      travelAngle: [[0, -8], [1, -8]], workAngle: [[0, 0], [1, 0]],
      weave: { pattern: 'crescent', amp: [[0, 0.0003], [1, 0.0003]], pitch: [[0, 0.002], [1, 0.002]] },
    };
  }
  return plan;
}
