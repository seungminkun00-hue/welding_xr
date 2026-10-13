import * as THREE from 'three';

const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ab = new THREE.Vector3();

const _frame = {
  travel: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  lateral: new THREE.Vector3(),
};

/**
 * A weld seam that bends.
 *
 * Every consumer downstream -- guide, bead, scoring -- works in seam
 * coordinates, never in world coordinates:
 *
 *   t       normalized position along the seam, by ARC LENGTH (0..1)
 *   lateral signed meters across the seam  (+ = welder's right)
 *   height  signed meters out of the joint (the standoff / arc length axis)
 *
 * Lifting that back into 3D needs exactly one thing: a frame
 * {travel, normal, lateral} at every t. For a straight plate the frame is
 * constant and this class collapses to WeldSeam; for a pipe it turns a full
 * revolution, which is why one fixed 45 degree work angle in seam space
 * sweeps a whole cone in world space.
 *
 * NOTE `normal` is NOT the curve's Frenet normal. Frenet points at the centre
 * of curvature, which has nothing to do with welding and is undefined wherever
 * the seam runs straight. `normal` comes from the JOINT: for a fillet it is
 * the bisector of the two member surfaces, the direction a correctly held
 * electrode points back along.
 */
export class SeamCurve {
  /**
   * @param {(u:number) => {position: THREE.Vector3, normal: THREE.Vector3}} sampler
   *        u runs 0..1 over the seam's own parameter, not over arc length
   * @param {{closed?: boolean, resolution?: number}} options
   */
  constructor(sampler, { closed = false, resolution = 480 } = {}) {
    this.closed = closed;
    this.resolution = resolution;

    // --- 1. dense sampling in the raw parameter --------------------------
    const raw = [];
    const rawCount = resolution * 2;
    for (let i = 0; i <= rawCount; i++) {
      if (closed && i === rawCount) break; // u = 1 would duplicate u = 0
      const s = sampler(i / rawCount);
      raw.push({ position: s.position.clone(), normal: s.normal.clone().normalize() });
    }

    // --- 2. cumulative arc length ---------------------------------------
    const cum = [0];
    for (let i = 1; i < raw.length; i++) {
      cum.push(cum[i - 1] + raw[i].position.distanceTo(raw[i - 1].position));
    }
    if (closed) cum.push(cum[cum.length - 1] + raw[0].position.distanceTo(raw[raw.length - 1].position));
    const total = cum[cum.length - 1];
    this.length = total;

    const rawAt = (idx) => {
      if (closed) return raw[((idx % raw.length) + raw.length) % raw.length];
      return raw[THREE.MathUtils.clamp(idx, 0, raw.length - 1)];
    };

    // --- 3. resample at equal arc length ---------------------------------
    // Even spacing in metres is what the guide shaders assume: chevron pitch
    // and dash length are given in millimetres, so a table spaced by the raw
    // parameter would bunch them wherever the seam curves tighter.
    const n = closed ? resolution : resolution + 1;
    const divisor = closed ? resolution : resolution;
    this.positions = [];
    this.normals = [];
    this.travels = [];
    this.laterals = [];

    let cursor = 0;
    for (let i = 0; i < n; i++) {
      const target = (i / divisor) * total;
      while (cursor < cum.length - 2 && cum[cursor + 1] < target) cursor++;
      const span = cum[cursor + 1] - cum[cursor];
      const f = span > 1e-9 ? (target - cum[cursor]) / span : 0;
      const p0 = rawAt(cursor);
      const p1 = rawAt(cursor + 1);
      this.positions.push(p0.position.clone().lerp(p1.position, f));
      this.normals.push(p0.normal.clone().lerp(p1.normal, f).normalize());
    }

    // --- 4. frames -------------------------------------------------------
    for (let i = 0; i < this.positions.length; i++) {
      const travel = new THREE.Vector3()
        .subVectors(this.positions[this._wrapIndex(i + 1)], this.positions[this._wrapIndex(i - 1)])
        .normalize();
      // Gram-Schmidt. The joint normal handed in is only approximately square
      // to the tangent, and a frame that is not orthonormal leaks travel error
      // into the standoff reading.
      const normal = this.normals[i].clone();
      normal.addScaledVector(travel, -normal.dot(travel)).normalize();
      this.normals[i] = normal;
      this.travels.push(travel);
      this.laterals.push(new THREE.Vector3().crossVectors(travel, normal).normalize());
    }

    // Aliases so code written against a straight WeldSeam still reads
    // sensibly. They are the frame at the seam's start, nothing more.
    this.start = this.positions[0].clone();
    this.end = this.positions[this.positions.length - 1].clone();
    this.travel = this.travels[0].clone();
    this.normal = this.normals[0].clone();
    this.lateral = this.laterals[0].clone();
  }

  _wrapIndex(i) {
    const n = this.positions.length;
    if (this.closed) return ((i % n) + n) % n;
    return THREE.MathUtils.clamp(i, 0, n - 1);
  }

  /** t -> floating index into the resampled tables. */
  _tToIndex(t) {
    const n = this.positions.length;
    if (this.closed) return (t - Math.floor(t)) * n;
    return THREE.MathUtils.clamp(t, 0, 1) * (n - 1);
  }

  /** Point at normalized arc length t. */
  pointAt(t, target = new THREE.Vector3()) {
    const fi = this._tToIndex(t);
    const i0 = Math.floor(fi);
    return target
      .copy(this.positions[this._wrapIndex(i0)])
      .lerp(this.positions[this._wrapIndex(i0 + 1)], fi - i0);
  }

  /** Orthonormal joint frame at t. Allocation-free when handed a target. */
  frameAt(t, target) {
    const out = target ?? {
      travel: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      lateral: new THREE.Vector3(),
    };
    const fi = this._tToIndex(t);
    const i0 = this._wrapIndex(Math.floor(fi));
    const i1 = this._wrapIndex(Math.floor(fi) + 1);
    const f = fi - Math.floor(fi);
    out.travel.copy(this.travels[i0]).lerp(this.travels[i1], f).normalize();
    out.normal.copy(this.normals[i0]).lerp(this.normals[i1], f);
    out.normal.addScaledVector(out.travel, -out.normal.dot(out.travel)).normalize();
    out.lateral.crossVectors(out.travel, out.normal).normalize();
    return out;
  }

  /**
   * Nearest point on the seam, in seam coordinates.
   *
   * Brute force over the resampled table. A few hundred dot products once a
   * frame costs nothing next to a draw call, and anything cleverer -- a
   * spatial hash, an incremental search seeded from the last hit -- would have
   * to be re-armed every time the trainee lifts the electrode clear and comes
   * back down somewhere else entirely.
   */
  decompose(point, target = { t: 0, lateral: 0, height: 0 }) {
    const n = this.positions.length;
    const segs = this.closed ? n : n - 1;

    let bestDist = Infinity;
    let bestSeg = 0;
    let bestF = 0;
    for (let i = 0; i < segs; i++) {
      _a.copy(this.positions[i]);
      _b.copy(this.positions[this._wrapIndex(i + 1)]);
      _ab.subVectors(_b, _a);
      const len2 = _ab.lengthSq();
      const f = len2 > 1e-12
        ? THREE.MathUtils.clamp(_d.subVectors(point, _a).dot(_ab) / len2, 0, 1)
        : 0;
      const dist = _d.subVectors(point, _a).addScaledVector(_ab, -f).lengthSq();
      if (dist < bestDist) {
        bestDist = dist;
        bestSeg = i;
        bestF = f;
      }
    }

    const t = this.closed ? (bestSeg + bestF) / n : (bestSeg + bestF) / (n - 1);
    const frame = this.frameAt(t, _frame);
    this.pointAt(t, _a);
    _d.subVectors(point, _a);
    target.t = t;
    target.lateral = _d.dot(frame.lateral);
    target.height = _d.dot(frame.normal);
    return target;
  }

  /**
   * Shortest signed step from t0 to t1, in units of t.
   *
   * On a closed seam 0.99 -> 0.01 is a small step forward, not a huge step
   * backward. Handing the raw difference to the speed gauge drives the needle
   * through its stop every time the welder crosses twelve o'clock.
   */
  deltaT(t0, t1) {
    let d = t1 - t0;
    if (this.closed) {
      while (d > 0.5) d -= 1;
      while (d < -0.5) d += 1;
    }
    return d;
  }
}

/**
 * The joint in the reference photo: a round pipe landing square on a flat
 * face, welded all the way round. The seam is a circle; the weld is a fillet.
 *
 *   center      where the pipe axis meets the face
 *   wallNormal  unit vector out of the flat face, parallel to the pipe axis
 *   up          world up, used to put twelve o'clock at the top of the circle
 *
 * The frame normal is the 45 degree bisector between the pipe wall and the
 * flat face, so "hold the rod at 45 degrees" becomes the single constant
 * workAngle = 0 in seam space, the whole way round.
 */
export function pipeFilletSeam({ center, wallNormal, up, radius, resolution = 480 }) {
  const axis = wallNormal.clone().normalize();
  // Twelve o'clock straight up; three and nine o'clock on the cross axis.
  const u = up.clone().addScaledVector(axis, -up.dot(axis)).normalize();
  // u x axis, not axis x u: t has to advance 12 -> 3 -> 6 -> 9 as seen by
  // someone standing in front of the face, or clockAt() names the wrong hour
  // and the two strokes come out mirrored.
  const v = new THREE.Vector3().crossVectors(u, axis).normalize();

  const seam = new SeamCurve(
    (t) => {
      const theta = t * Math.PI * 2; // 0 = twelve o'clock
      const radial = u.clone().multiplyScalar(Math.cos(theta)).addScaledVector(v, Math.sin(theta));
      return {
        position: center.clone().addScaledVector(radial, radius),
        normal: radial.clone().add(axis).normalize(), // 45 degree joint bisector
      };
    },
    { closed: true, resolution }
  );

  seam.center = center.clone();
  seam.radius = radius;
  seam.axis = axis;
  seam.upAxis = u;
  seam.rightAxis = v;
  seam.surfacePoint = (t, lateral, target = new THREE.Vector3()) => {
    const frame = seam.frameAt(t);
    const p = seam.pointAt(t).addScaledVector(frame.lateral, lateral);
    const relative = p.clone().sub(center);
    const along = relative.dot(axis);
    const onPlate = p.clone().addScaledVector(axis, -along);
    const radial = relative.addScaledVector(axis, -along).normalize();
    const onPipe = center.clone().addScaledVector(axis, along).addScaledVector(radial, radius);
    const plateLift = onPlate.clone().sub(p).dot(frame.normal);
    const pipeLift = onPipe.clone().sub(p).dot(frame.normal);
    return target.copy(plateLift >= pipeLift ? onPlate : onPipe);
  };

  /**
   * Clock position in hours (0..12) measured from the top of the circle.
   *
   * This is the single number that says how hard the current spot is, and it
   * is the axis master technique data should be keyed on: twelve o'clock is
   * nearly flat, three and nine are vertical, six is overhead. Keying on t
   * instead would not transfer to a pipe of a different diameter.
   */
  seam.clockAt = (t) => (((t % 1) + 1) % 1) * 12;

  return seam;
}
