import * as THREE from 'three';

const _d = new THREE.Vector3();

/**
 * A straight weld seam, expressed in the workpiece group's local space.
 *
 * The workpiece group only ever carries a translation (no rotation/scale), so
 * local direction vectors double as world direction vectors -- only positions
 * ever need a worldToLocal() round trip.
 *
 *   travel  (T) : the direction the welder advances, start -> end
 *   normal  (N) : plate surface normal, pointing up out of the material
 *   lateral (L) : T x N, the "across the seam" axis (+L = welder's right)
 */
export class WeldSeam {
  constructor({ start, end, normal }) {
    this.start = start.clone();
    this.end = end.clone();

    this.travel = new THREE.Vector3().subVectors(end, start);
    this.length = this.travel.length();
    this.travel.normalize();

    this.normal = normal.clone().normalize();
    this.lateral = new THREE.Vector3().crossVectors(this.travel, this.normal).normalize();
  }

  /**
   * The joint frame, which for a straight seam is the same everywhere.
   *
   * Present so a straight seam and a SeamCurve are interchangeable: everything
   * downstream asks for the frame at a t rather than reading fixed axes off
   * the seam, and a flat plate is just the case where the answer never
   * changes.
   */
  frameAt(_t, target) {
    const out = target ?? {
      travel: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      lateral: new THREE.Vector3(),
    };
    out.travel.copy(this.travel);
    out.normal.copy(this.normal);
    out.lateral.copy(this.lateral);
    return out;
  }

  /** Signed step in t. No wrapping: a straight seam has no far side. */
  deltaT(t0, t1) {
    return t1 - t0;
  }

  /** Clock position is meaningless on a straight seam. */
  clockAt() {
    return 0;
  }

  /** Point at normalized progress t; t outside [0,1] extrapolates past the ends. */
  pointAt(t, target = new THREE.Vector3()) {
    return target.copy(this.start).addScaledVector(this.travel, t * this.length);
  }

  /**
   * Decompose a local-space point into seam coordinates:
   *   t       normalized progress along the seam (0 = start, 1 = end)
   *   lateral signed distance across the seam, meters
   *   height  signed distance above the plate surface, meters
   */
  decompose(point, target = { t: 0, lateral: 0, height: 0 }) {
    _d.subVectors(point, this.start);
    target.t = _d.dot(this.travel) / this.length;
    target.lateral = _d.dot(this.lateral);
    target.height = _d.dot(this.normal);
    return target;
  }
}
