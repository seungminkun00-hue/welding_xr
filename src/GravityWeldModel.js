import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;

// Qualitative training model, not a thermal solver or a defect probability.
// Flooding depends on gravity along actual travel, dwell, arc length and aim.
// Hydrogen cracking cannot be inferred from these inputs and is not modeled.
export class GravityWeldModel {
  constructor(parent) {
    this.parent = parent;
    this.rotation = new THREE.Quaternion();
    this.gravity = new THREE.Vector3();
    this.reset();
  }
  reset() {
    this.pool = 0;
    this.time = 0;
    this.sums = { runoff: 0, penetration: 0, fusionRisk: 0, slagRisk: 0 };
  }
  sample(dt, frame, m) {
    this.parent.getWorldQuaternion(this.rotation).invert();
    this.gravity.set(0, -1, 0).applyQuaternion(this.rotation);
    const direction = m.speedRatio < -0.05 ? -m.stroke.dir : m.stroke.dir;
    const downTravel = Math.max(0, this.gravity.dot(frame.travel) * direction);
    const slope = Math.sqrt(Math.max(0, 1 - this.gravity.dot(frame.normal) ** 2));
    const ratio = Math.abs(m.speedRatio);
    const dwell = clamp(1 - ratio, 0, 1);
    const fast = clamp((ratio - 1) / 2, 0, 1);
    const longArc = clamp(m.arcErr, 0, 1);
    const aim = clamp(Math.abs(m.center.x) * 0.5 + Math.abs(m.workError) * 0.5, 0, 1);
    const rootMiss = clamp((Math.abs(m.lateral) - 0.003) / 0.005, 0, 1);
    const desired = m.welding ? clamp(0.12 + dwell * 0.72 + longArc * 0.16, 0, 1) : 0;
    this.pool = THREE.MathUtils.lerp(this.pool, desired, 1 - Math.exp(-dt / (m.welding ? 0.8 : 1.1)));
    const runoff = clamp(slope * this.pool * (0.3 + 0.7 * downTravel), 0, 1);
    const penetration = clamp(1 - runoff * 0.65 - fast * 0.5 - longArc * 0.18 - aim * 0.35 - rootMiss * 0.5, 0, 1);
    const fusionRisk = clamp(runoff * 0.6 + (1 - penetration) * 0.55 + aim * 0.2 + rootMiss * 0.3, 0, 1);
    const slagRisk = clamp(downTravel * this.pool * 0.65 + aim * 0.25 + longArc * 0.15, 0, 1);
    const result = { runoff, penetration, fusionRisk, slagRisk };
    if (m.welding) {
      this.time += dt;
      for (const key of Object.keys(this.sums)) this.sums[key] += result[key] * dt;
    }
    return result;
  }
  report() {
    return Object.fromEntries(Object.entries(this.sums).map(([key, value]) =>
      [key, this.time > 0 ? Math.round(100 * value / this.time) : 0]));
  }
}
