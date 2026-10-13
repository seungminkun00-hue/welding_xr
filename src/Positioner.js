import * as THREE from 'three';

const DEG = Math.PI / 180;
// Grip rotation follows the hand's angle around the vertical spindle, 1:1.
// The separate lift input changes the platform height, never the pipe's tilt.
export class Positioner {
  constructor({ yaw, tilt, roll, liftTop, liftMechanism }) {
    Object.assign(this, { yaw, tilt, roll, liftTop, liftMechanism });
    this.homeYaw = -65 * DEG;
    this.homeHeight = yaw.position.y;
    this.heightOffset = 0;
    this.liftNeedsNeutral = true;
    this.pose = { yaw: this.homeYaw, tilt: 0, roll: 0 };
    this.drag = null; this.moving = false;
    this.position = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
    this.apply();
  }
  get held() { return !!this.drag; }
  begin(controller) {
    if (this.drag || !controller?.userData.tracked || controller.userData.handedness !== 'left') return;
    controller.getWorldPosition(this.position);
    this.yaw.getWorldPosition(this.pivot);
    this.drag = { controller, last: this.position.clone(), armed: false };
    controller.userData.trigger = false;
  }
  end(controller) {
    if (!controller || this.drag?.controller === controller) this.drag = null;
    this.moving = false;
  }
  home() {
    this.end(); this.pose.yaw = this.homeYaw; this.apply();
  }
  apply() {
    // Wrap full turns without a hard stop. Height, tilt and pipe roll stay fixed.
    this.pose.yaw = this.homeYaw + THREE.MathUtils.euclideanModulo(this.pose.yaw - this.homeYaw + Math.PI, Math.PI * 2) - Math.PI;
    this.pose.roll = 0;
    this.pose.tilt = 0;
    this.yaw.rotation.set(0, this.pose.yaw, 0);
    this.yaw.position.y = this.homeHeight + this.heightOffset;
    if (this.liftTop && this.liftMechanism) {
      this.liftTop.position.y = this.heightOffset;
      // Visual extension of the linkage, with its lower pivots fixed at 18 cm.
      const extension = 1 + this.heightOffset / 0.52;
      this.liftMechanism.scale.y = extension;
      this.liftMechanism.position.y = 0.18 * (1 - extension);
      this.liftTop.updateWorldMatrix(true, true);
      this.liftMechanism.updateWorldMatrix(true, true);
    }
    this.tilt.rotation.set(0, 0, 0);
    this.roll.rotation.set(0, 0, 0);
    this.yaw.updateWorldMatrix(true, true);
  }
  update(dt, keys, { blocked = false, xr = false, controller = null } = {}) {
    this.moving = false;
    if (blocked) { this.end(); this.liftNeedsNeutral = true; return; }
    const before = this.pose.yaw;
    const beforeHeight = this.heightOffset;
    if (this.drag) {
      this.liftNeedsNeutral = true;
      const { controller, last } = this.drag;
      if (!controller.userData.tracked || !controller.userData.physicalGripDown) {
        this.end(); return;
      }
      controller.getWorldPosition(this.position);
      this.yaw.getWorldPosition(this.pivot);
      const x = this.position.x - this.pivot.x, z = this.position.z - this.pivot.z;
      const lx = last.x - this.pivot.x, lz = last.z - this.pivot.z;
      const radius = Math.min(Math.hypot(x, z), Math.hypot(lx, lz));
      // Close to the axis the angle is undefined; rebase instead of snapping.
      if (radius < 0.1 || this.position.distanceToSquared(last) > 0.2 ** 2) {
        last.copy(this.position);
      } else {
        const angle = Math.atan2(x, z) - Math.atan2(lx, lz);
        const turn = Math.atan2(Math.sin(angle), Math.cos(angle));
        if (Math.abs(turn) * radius >= (this.drag.armed ? 0.001 : 0.003)) {
          this.drag.armed = true;
          this.pose.yaw = before + turn;
          last.copy(this.position);
        }
      }
    } else if (!xr) {
      const speed = (keys.ShiftLeft || keys.ShiftRight ? 12 : 30) * DEG * dt;
      this.pose.yaw = before + ((keys.KeyI ? 1 : 0) - (keys.KeyK ? 1 : 0)) * speed;
    }
    if (!this.drag && this.liftTop && this.liftMechanism) {
      let lift = (keys.PageUp ? 1 : 0) - (keys.PageDown ? 1 : 0);
      if (xr) {
        const data = controller?.userData;
        const valid = data?.tracked && !data.needsRelease;
        const axis = valid ? data.source?.gamepad?.axes[3] ?? 0 : 0;
        if (!valid) this.liftNeedsNeutral = true;
        else if (Math.abs(axis) <= 0.25) this.liftNeedsNeutral = false;
        lift = !this.liftNeedsNeutral && Math.abs(axis) > 0.25
          ? -Math.sign(axis) * (Math.abs(axis) - 0.25) / 0.75 : 0;
      }
      this.heightOffset = THREE.MathUtils.clamp(beforeHeight + lift * 0.12 * dt, -0.2, 0.3);
    }
    this.moving = Math.abs(before - this.pose.yaw) > 1e-7 || Math.abs(beforeHeight - this.heightOffset) > 1e-7;
    if (this.moving) this.apply();
  }
  get readout() {
    return `수평 회전 ${Math.round((this.pose.yaw - this.homeYaw) / DEG)}° · 작업대 상판 ${Math.round((0.755 + this.heightOffset) * 100)} cm`;
  }
}
