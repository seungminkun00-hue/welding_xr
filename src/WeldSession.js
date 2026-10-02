import * as THREE from 'three';

const _ideal = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _seamCoords = { t: 0, lateral: 0, height: 0 };

/**
 * Judges one straight MIG pass.
 *
 * Everything the trainee is graded on reduces to three readings, which is also
 * exactly what the floating HUD shows:
 *
 *   depth   contact-tip-to-work distance (CTWD). Too close chokes the arc and
 *           burns the nozzle; too far loses shielding gas and spatters.
 *   center  how far off the seam the torch is, plus how far the travel angle
 *           has drifted from the nominal push angle.
 *   speed   travel speed. Slow piles up a fat, cold-lapped bead; fast starves
 *           it and leaves an undercut stringer.
 */
export class WeldSession {
  constructor(seam, options = {}) {
    this.seam = seam;

    // MIG short-circuit on thin plate: ~10mm stickout, 15 degrees of push,
    // ~10mm/s of travel.
    this.idealStandoff = options.idealStandoff ?? 0.010;
    this.standoffTol = options.standoffTol ?? 0.004;
    this.lateralTol = options.lateralTol ?? 0.005;
    this.idealTravelAngleDeg = options.idealTravelAngleDeg ?? 15; // push technique
    this.angleTol = options.angleTol ?? 18;
    this.idealSpeed = options.idealSpeed ?? 0.010; // m/s
    this.speedRange = options.speedRange ?? 0.006; // m/s, full-scale deflection

    this.reset();
  }

  reset() {
    this.speed = 0;
    this.lastT = null;
    this.arcTime = 0;
    this.goodTime = { depth: 0, center: 0, speed: 0 };
    this.maxT = 0;
    this.started = false;
    this.finished = false;
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} tip  torch tip, workpiece-local
   * @param {THREE.Vector3} fwd  unit vector the nozzle points along, local
   * @param {boolean} arcOn      trigger held
   */
  sample(dt, tip, fwd, arcOn) {
    const c = this.seam.decompose(tip, _seamCoords);
    const t = c.t;

    // Travel speed along the seam, smoothed: raw frame-to-frame deltas are far
    // too jittery to drive a needle.
    if (this.lastT !== null && dt > 0) {
      const raw = ((t - this.lastT) * this.seam.length) / dt;
      this.speed = THREE.MathUtils.lerp(this.speed, raw, 1 - Math.exp(-dt / 0.22));
    }
    this.lastT = t;

    const depthErr = (c.height - this.idealStandoff) / this.standoffTol;

    _fwd.copy(fwd).normalize();
    const alongN = -_fwd.dot(this.seam.normal);
    const travelAngleDeg = THREE.MathUtils.radToDeg(
      Math.atan2(_fwd.dot(this.seam.travel), Math.max(alongN, 1e-4))
    );
    const workAngleDeg = THREE.MathUtils.radToDeg(
      Math.atan2(_fwd.dot(this.seam.lateral), Math.max(alongN, 1e-4))
    );

    const center = {
      x: c.lateral / this.lateralTol,
      y: (travelAngleDeg - this.idealTravelAngleDeg) / this.angleTol,
    };

    const speedFraction = THREE.MathUtils.clamp(
      0.5 + (this.speed - this.idealSpeed) / (2 * this.speedRange),
      0,
      1
    );
    const speedErr = (this.speed - this.idealSpeed) / this.speedRange;

    // The work angle is not on the HUD, but holding the gun rolled over on a
    // flat butt joint still ruins the bead, so it feeds the overall severity.
    const workErr = workAngleDeg / this.angleTol;

    const severity = THREE.MathUtils.clamp(
      Math.max(Math.abs(depthErr), Math.abs(center.x), Math.abs(center.y), Math.abs(speedErr), Math.abs(workErr)),
      0,
      1.6
    );
    const quality = THREE.MathUtils.clamp(1 - severity, 0, 1);

    const onSeam =
      t > -0.05 &&
      t < 1.08 &&
      c.height > -0.002 &&
      c.height < this.idealStandoff + this.standoffTol * 3 &&
      Math.abs(c.lateral) < this.lateralTol * 3;

    const welding = arcOn && onSeam;
    if (welding) {
      this.started = true;
      this.arcTime += dt;
      if (Math.abs(depthErr) <= 1) this.goodTime.depth += dt;
      if (Math.hypot(center.x, center.y) <= 1) this.goodTime.center += dt;
      if (Math.abs(speedErr) <= 1) this.goodTime.speed += dt;
      this.maxT = Math.max(this.maxT, THREE.MathUtils.clamp(t, 0, 1));
      if (this.maxT >= 0.98) this.finished = true;
    }

    return {
      t,
      lateral: c.lateral,
      height: c.height,
      depthErr,
      center,
      travelAngleDeg,
      workAngleDeg,
      speed: this.speed,
      speedFraction,
      speedErr,
      speedRatio: this.speed / this.idealSpeed,
      severity: Math.min(severity, 1),
      quality,
      onSeam,
      welding,
    };
  }

  /** Percentage of arc-on time spent inside tolerance, per axis, plus a total. */
  report(beadStats) {
    const pct = (v) => (this.arcTime > 0 ? Math.round((v / this.arcTime) * 100) : 0);
    const depth = pct(this.goodTime.depth);
    const center = pct(this.goodTime.center);
    const speed = pct(this.goodTime.speed);
    const coverage = Math.round((beadStats?.coverage ?? 0) * 100);
    const total = Math.round(depth * 0.3 + center * 0.3 + speed * 0.25 + coverage * 0.15);
    return { depth, center, speed, coverage, total, arcTime: this.arcTime };
  }
}
