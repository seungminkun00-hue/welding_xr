import * as THREE from 'three';

// Filter hands and instruments, never the tracked head/camera.
export class PoseStabilizer {
  constructor() {
    this.position = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.ready = false;
  }
  reset() { this.ready = false; }
  update(dt, position, direction) {
    if (!this.ready || this.position.distanceTo(position) > 0.18) {
      this.position.copy(position);
      this.direction.copy(direction);
      this.ready = true;
    } else {
      const alpha = 1 - Math.exp(-Math.max(dt, 0) / 0.055);
      this.position.lerp(position, alpha);
      this.direction.lerp(direction, alpha).normalize();
    }
    position.copy(this.position);
    direction.copy(this.direction);
  }
}

// A held controller must move deliberately before the bench starts moving.
// The final position stops immediately on release; no residual lerp runs.
export class WorkpieceGrab {
  constructor(controller, target, minY, maxY) {
    Object.assign(this, { controller, target, minY, maxY });
    this.start = controller.getWorldPosition(new THREE.Vector3());
    this.offset = target.position.clone().sub(this.start);
    this.position = new THREE.Vector3();
    this.armed = false;
  }
  update(dt) {
    if (!this.controller.userData.tracked || !this.controller.userData.physicalGripDown) return false;
    this.controller.getWorldPosition(this.position);
    if (!this.armed) {
      if (this.position.distanceToSquared(this.start) < 0.006 ** 2) return true;
      this.armed = true;
    }
    this.position.add(this.offset);
    this.position.y = THREE.MathUtils.clamp(this.position.y, this.minY, this.maxY);
    if (this.target.position.distanceToSquared(this.position) > 0.0005 ** 2)
      this.target.position.lerp(this.position, 1 - Math.exp(-dt / 0.04));
    return true;
  }
}
