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
