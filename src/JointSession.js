import * as THREE from 'three';

const _fwd = new THREE.Vector3();
const _coords = { t: 0, lateral: 0, height: 0 };
const _frame = {
  travel: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  lateral: new THREE.Vector3(),
};

/**
 * Judges a multi-stroke weld on a curved seam.
 *
 * Two things make this different from the flat straight pass:
 *
 *   The frame turns. Work angle and travel angle are measured against the
 *   joint frame at the electrode's own position, not against one fixed set of
 *   axes, so "45 degrees to both members" stays a single number the whole way
 *   round the pipe instead of becoming a function of where you are.
 *
 *   There are strokes. Progress, completion and the score are per stroke, and
 *   two further things get graded that do not exist on a single pass: whether
 *   the trainee travelled the right way, and whether they struck back over the
 *   previous stroke instead of leaving a cold shut at the tie-in.
 */
export class JointSession {
  constructor(seam, plan, options = {}) {
    this.seam = seam;
    this.plan = plan;

    // SMAW on 6mm plate with a 3.2mm rod: arc length about one rod diameter,
    // and travel far slower than MIG.
    this.standoffTol = options.standoffTol ?? 0.0016;
    this.lateralTol = options.lateralTol ?? 0.0022;
    this.angleTol = options.angleTol ?? 15;
    this.speedTol = options.speedTol ?? 0.0012; // m/s either side of target

    this.strikeRadius = options.strikeRadius ?? 0.02; // how close counts as striking on target
    this.reset();
  }

  reset() {
    this.plan.reset();
    this.speed = 0;
    this.lastT = null;
    this.arcTime = 0;
    this.finished = false;
    this.strokeStats = this.plan.strokes.map((s) => ({
      id: s.id,
      label: s.label,
      arcTime: 0,
      good: { arc: 0, center: 0, speed: 0, work: 0 },
      maxP: 0,
      minP: 1,
      backwards: 0,
      struckAt: null,
      brokeAt: null,
      done: false,
    }));
  }

  get stats() {
    return this.strokeStats[this.plan.index] ?? null;
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} tip electrode tip, workpiece-local
   * @param {THREE.Vector3} fwd unit vector the electrode points along, local
   * @param {boolean} arcOn
   */
  sample(dt, tip, fwd, arcOn) {
    const stroke = this.plan.current;
    const c = this.seam.decompose(tip, _coords);
    const frame = this.seam.frameAt(c.t, _frame);

    // Travel speed along the seam. deltaT, not a raw subtraction: on a closed
    // seam crossing twelve o'clock is a small step, and the raw difference
    // there is a full lap.
    if (this.lastT !== null && dt > 0) {
      const raw = (this.seam.deltaT(this.lastT, c.t) * this.seam.length) / dt;
      this.speed = THREE.MathUtils.lerp(this.speed, raw, 1 - Math.exp(-dt / 0.22));
    }
    this.lastT = c.t;

    _fwd.copy(fwd).normalize();
    const alongN = -_fwd.dot(frame.normal);
    const travelAngleDeg = THREE.MathUtils.radToDeg(
      Math.atan2(_fwd.dot(frame.travel), Math.max(alongN, 1e-4))
    );
    const workAngleDeg = THREE.MathUtils.radToDeg(
      Math.atan2(_fwd.dot(frame.lateral), Math.max(alongN, 1e-4))
    );

    const clock = this.seam.clockAt ? this.seam.clockAt(c.t) : 0;

    if (!stroke) {
      return this._idle(c, travelAngleDeg, workAngleDeg, clock);
    }

    // --- where we are in the stroke, and what the master would be doing ----
    const p = stroke.progressOf(c.t);
    const target = stroke.sample(THREE.MathUtils.clamp(p, 0, 1));
    const idealLateral = stroke.lateralAt(THREE.MathUtils.clamp(p, 0, 1), this.seam.length);

    // Travel is signed along the stroke, so running the wrong way reads as a
    // negative speed rather than as a correct one.
    const strokeSpeed = this.speed * stroke.dir;

    const arcErr = (c.height - target.standoff) / this.standoffTol;
    const lateralErr = (c.lateral - idealLateral) / this.lateralTol;
    const travelErr = (travelAngleDeg - target.travelAngle) / this.angleTol;
    const workErr = (workAngleDeg - target.workAngle) / this.angleTol;
    const speedErr = (strokeSpeed - target.speed) / this.speedTol;

    const center = { x: lateralErr, y: travelErr };

    const lead = stroke.leadP(this.seam.length);
    const trail = stroke.trailP(this.seam.length);
    const onStroke =
      p > -lead - 0.04 &&
      p < 1 + trail + 0.04 &&
      c.height > -0.001 &&
      c.height < target.standoff + this.standoffTol * 4 &&
      Math.abs(c.lateral) < this.lateralTol * 3;

    const severity = THREE.MathUtils.clamp(
      Math.max(
        Math.abs(arcErr),
        Math.abs(lateralErr),
        Math.abs(travelErr),
        Math.abs(workErr),
        Math.abs(speedErr)
      ),
      0,
      1.6
    );
    const quality = THREE.MathUtils.clamp(1 - severity, 0, 1);

    const welding = arcOn && onStroke;
    const st = this.strokeStats[this.plan.index];

    if (welding) {
      if (st.struckAt === null) st.struckAt = p;
      st.arcTime += dt;
      this.arcTime += dt;
      if (Math.abs(arcErr) <= 1) st.good.arc += dt;
      if (Math.hypot(center.x, center.y) <= 1) st.good.center += dt;
      if (Math.abs(speedErr) <= 1) st.good.speed += dt;
      // Scored on its own axis rather than folded into `center`. On a fillet
      // the work angle is the measurement: roll off 45 degrees and the bead
      // climbs one member and undercuts the other, however straight the rest
      // of the run was.
      if (Math.abs(workErr) <= 1) st.good.work += dt;
      if (strokeSpeed < -0.0005) st.backwards += dt;
      st.maxP = Math.max(st.maxP, Math.min(p, 1));
      st.minP = Math.min(st.minP, Math.max(p, 0));
      if (st.maxP >= 0.97) {
        st.brokeAt = p;
        st.done = true;
      }
    } else if (st.done && !arcOn) {
      // The arc has to actually be broken before the next stroke begins,
      // otherwise one continuous lap would quietly satisfy both strokes.
      this.plan.advance();
      this.speed = 0;
      this.lastT = null;
      if (this.plan.done) this.finished = true;
    }

    return {
      t: c.t,
      p,
      clock,
      stroke,
      strokeIndex: this.plan.index,
      lateral: c.lateral,
      idealLateral,
      height: c.height,
      target,
      arcErr,
      center,
      travelAngleDeg,
      workAngleDeg,
      speed: this.speed,
      strokeSpeed,
      speedErr,
      speedFraction: THREE.MathUtils.clamp(0.5 + speedErr / 2, 0, 1),
      speedRatio: target.speed > 0 ? strokeSpeed / target.speed : 0,
      severity: Math.min(severity, 1),
      quality,
      onSeam: onStroke,
      welding,
    };
  }

  _idle(c, travelAngleDeg, workAngleDeg, clock) {
    return {
      t: c.t,
      p: 1,
      clock,
      stroke: null,
      strokeIndex: this.plan.index,
      lateral: c.lateral,
      idealLateral: 0,
      height: c.height,
      target: null,
      arcErr: 0,
      center: { x: 0, y: 0 },
      travelAngleDeg,
      workAngleDeg,
      speed: 0,
      strokeSpeed: 0,
      speedErr: 0,
      speedFraction: 0.5,
      speedRatio: 0,
      severity: 0,
      quality: 1,
      onSeam: false,
      welding: false,
    };
  }

  /**
   * Per stroke and overall. The two scores that only exist because the weld is
   * made of strokes:
   *
   *   tieIn      did the trainee strike back over the previous stroke, or
   *              start clear of it and leave a cold shut?
   *   direction  did they climb, or did they drift back downhill?
   */
  report(beadStats) {
    const strokes = this.strokeStats.map((st, i) => {
      const pct = (v) => (st.arcTime > 0 ? Math.round((v / st.arcTime) * 100) : 0);
      const s = this.plan.strokes[i];
      const lead = s.leadP(this.seam.length);
      const tieIn =
        st.struckAt === null
          ? 0
          : lead > 1e-6
            ? Math.round(THREE.MathUtils.clamp(1 - Math.abs(st.struckAt + lead) / (lead * 2), 0, 1) * 100)
            : Math.round(THREE.MathUtils.clamp(1 - Math.abs(st.struckAt) / 0.05, 0, 1) * 100);
      const direction = st.arcTime > 0 ? Math.round((1 - st.backwards / st.arcTime) * 100) : 0;
      return {
        id: st.id,
        label: st.label,
        arc: pct(st.good.arc),
        center: pct(st.good.center),
        speed: pct(st.good.speed),
        work: pct(st.good.work),
        tieIn,
        direction,
        coverage: Math.round(THREE.MathUtils.clamp(st.maxP, 0, 1) * 100),
        arcTime: st.arcTime,
        done: st.done,
      };
    });

    const mean = (key) =>
      Math.round(strokes.reduce((acc, s) => acc + s[key], 0) / Math.max(strokes.length, 1));

    const arc = mean('arc');
    const center = mean('center');
    const speed = mean('speed');
    const work = mean('work');
    const tieIn = mean('tieIn');
    const direction = mean('direction');
    const coverage = Math.round((beadStats?.coverage ?? 0) * 100);

    return {
      strokes,
      arc,
      center,
      speed,
      work,
      tieIn,
      direction,
      coverage,
      arcTime: this.arcTime,
      total: Math.round(
        arc * 0.2 +
          center * 0.2 +
          speed * 0.16 +
          work * 0.14 +
          tieIn * 0.12 +
          direction * 0.08 +
          coverage * 0.1
      ),
    };
  }
}
