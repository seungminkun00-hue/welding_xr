import * as THREE from 'three';
import { poseTorchByTip } from './Torches.js';

// Fixed camera-space gun. The rendered tip, not a raycast surface, is scored.
export class DesktopWeldingControls {
  constructor({ canvas, camera, controls, getStation, enabled, blocked, pickUI, activateUI, onHover }) {
    Object.assign(this, { canvas, camera, controls, getStation, enabled, blocked, pickUI, activateUI, onHover });
    this.pointer = new THREE.Vector2();
    this.ray = new THREE.Raycaster(); this.ray.far = 8;
    this.forward = new THREE.Vector3(); this.right = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this.tip = new THREE.Vector3(); this.localForward = new THREE.Vector3();
    this.rotation = new THREE.Quaternion(); this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.look = new THREE.Vector2(); this.reach = 0.45;
    this.pressed = false; this.uiDown = null;
    this.crosshair = document.createElement('div');
    this.crosshair.id = 'fps-crosshair'; this.crosshair.hidden = true;
    this.crosshair.setAttribute('aria-hidden', 'true');
    this.status = document.createElement('div'); this.status.id = 'fps-status';
    this.status.setAttribute('role', 'status');
    this.status.textContent = '화면 클릭: FPS 조작 시작';
    document.body.append(this.crosshair, this.status);
    document.addEventListener('mousemove', event => {
      if (!this.enabled() || !this.locked) return;
      const sensitivity = (this.pressed ? 0.00035 : 0.0016) * (event.ctrlKey ? 0.2 : 1);
      this.look.x += event.movementX * sensitivity;
      this.look.y += event.movementY * sensitivity;
    });
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.enabled() || event.pointerType === 'touch') return;
      this.readPointer(event);
      const ui = this.pickUI(this.ray);
      if (ui) {
        this.cancel(); this.uiDown = { ...ui, locked: this.locked, x: event.clientX, y: event.clientY };
        return;
      }
      event.preventDefault();
      // The capture click never starts welding; a fresh click is required.
      if (!this.locked) { this.requestLock(); return; }
      if (!this.blocked()) this.pressed = true;
    });
    window.addEventListener('pointerup', event => {
      if (event.button !== 0) return;
      const down = this.uiDown; this.cancel();
      if (!down || !this.enabled() || down.locked !== this.locked) return;
      if (!this.locked && (event.target !== canvas ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) >= 8)) return;
      this.readPointer(event);
      const up = this.pickUI(this.ray);
      if (up?.kind === down.kind && up?.action === down.action) this.activateUI(up);
    }, true);
    canvas.addEventListener('pointerleave', () => { if (!this.locked) this.cancel(); });
    canvas.addEventListener('pointercancel', () => this.cancel());
    document.addEventListener('pointerlockchange', () => {
      this.reset();
      if (this.locked && !this.enabled()) { this.release(); return; }
      this.crosshair.hidden = !this.locked || !this.enabled();
      document.body.classList.toggle('fps-locked', this.locked && this.enabled());
      this.status.textContent = this.locked ? '좌클릭: 용접 · 방향키: 이동 · Esc: 마우스 해제' : '화면 클릭: FPS 조작 시작';
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed());
    window.addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('wheel', event => {
      if (!this.enabled() || !this.locked) return;
      event.preventDefault();
      if (!this.blocked()) this.reach = THREE.MathUtils.clamp(this.reach - Math.sign(event.deltaY) * 0.002, 0.25, 0.9);
    }, { passive: false });
  }
  get locked() { return document.pointerLockElement === this.canvas; }
  get arcOn() { return this.enabled() && this.locked && !this.blocked() && this.pressed; }
  cancel() { this.pressed = false; this.uiDown = null; }
  reset() { this.cancel(); this.look.set(0, 0); }
  release() { this.reset(); if (this.locked) document.exitPointerLock(); }
  requestLock() {
    this.reset();
    if (!this.canvas.requestPointerLock) { this.lockFailed(); return; }
    try { this.canvas.requestPointerLock()?.catch(() => this.lockFailed()); }
    catch { this.lockFailed(); }
  }
  lockFailed() {
    this.reset(); this.status.textContent = '마우스 고정을 시작하지 못했습니다. 화면을 다시 클릭하세요.';
  }
  fitToTarget() {
    this.reset();
    this.reach = THREE.MathUtils.clamp(this.camera.position.distanceTo(this.controls.target) - this.getStation().desktop.height, 0.25, 0.9);
  }
  readPointer(event) {
    if (this.locked) this.pointer.set(0, 0);
    else {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1);
    }
    this.camera.updateWorldMatrix(true, false);
    this.ray.setFromCamera(this.pointer, this.camera);
  }
  placeGun() {
    const station = this.getStation();
    this.camera.updateWorldMatrix(true, false);
    this.camera.getWorldQuaternion(this.rotation);
    this.forward.set(0, 0, -1).applyQuaternion(this.rotation);
    this.camera.getWorldPosition(this.tip); this.tip.addScaledVector(this.forward, this.reach);
    station.group.updateWorldMatrix(true, false);
    station.group.worldToLocal(this.tip);
    station.group.getWorldQuaternion(this.rotation).invert();
    this.localForward.copy(this.forward).applyQuaternion(this.rotation);
    this.camera.getWorldQuaternion(this.rotation);
    this.right.set(0, 1, 0).applyQuaternion(this.rotation);
    station.group.getWorldQuaternion(this.rotation).invert();
    this.right.applyQuaternion(this.rotation);
    poseTorchByTip(station.desktopTorch, this.tip, this.localForward, this.right);
  }
  update(dt, keys) {
    this.status.hidden = !this.enabled();
    this.crosshair.hidden = !this.enabled() || !this.locked;
    if (!this.enabled()) { this.release(); return; }
    if (!this.locked) return;
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.euler.y -= this.look.x;
    this.euler.x = THREE.MathUtils.clamp(this.euler.x - this.look.y, -1.48, 1.48);
    this.look.set(0, 0); this.camera.quaternion.setFromEuler(this.euler);
    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.move.copy(this.forward); this.move.y = 0; this.move.normalize();
    const ahead = ((keys.ArrowUp || keys.KeyW) ? 1 : 0) - ((keys.ArrowDown || keys.KeyS) ? 1 : 0);
    const strafe = ((keys.ArrowRight || keys.KeyD) ? 1 : 0) - ((keys.ArrowLeft || keys.KeyA) ? 1 : 0);
    const rise = (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
    const distance = Math.max(0.2, this.camera.position.distanceTo(this.controls.target));
    const slow = keys.ControlLeft || keys.ControlRight ? 0.2 : 1;
    const speed = dt * (this.pressed ? 0.015 : 0.25) * slow *
      (!this.pressed && (keys.ShiftLeft || keys.ShiftRight) ? 2.5 : 1);
    const norm = Math.max(1, Math.hypot(ahead, strafe, rise));
    this.camera.position.addScaledVector(this.move, ahead * speed / norm).addScaledVector(this.right, strafe * speed / norm);
    this.camera.position.y += rise * speed / norm;
    this.controls.target.copy(this.camera.position).addScaledVector(this.forward, distance);
    this.controls.update(); this.placeGun();
    this.pointer.set(0, 0); this.ray.setFromCamera(this.pointer, this.camera);
    const ui = this.pickUI(this.ray); this.onHover?.(ui);
    if (this.blocked() || ui) this.pressed = false;
    this.crosshair.dataset.state = ui ? 'ui' : this.pressed ? 'welding' : 'aim';
  }
}
