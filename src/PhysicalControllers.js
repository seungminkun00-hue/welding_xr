import * as THREE from 'three';
import { ControllerVisuals } from './ControllerVisuals.js';

// Physical controllers only. Held tools use gripSpace; menus use the independent
// targetRaySpace. Read both once per animation frame, never in input callbacks.
export class PhysicalControllers {
  constructor(scene, renderer) {
    this.renderer = renderer;
    this.controllers = ['right', 'left'].map(hand => {
      const anchor = new THREE.Group();
      anchor.name = hand + '-physical-controller'; anchor.visible = false;
      Object.assign(anchor.userData, {
        handedness: hand, source: null, tracked: false, trigger: false,
        physicalGripDown: false, needsRelease: true, lastPoseTime: -Infinity,
      });
      const ray = new THREE.Group();
      ray.name = hand + '-target-ray'; ray.visible = false;
      anchor.userData.ray = ray;
      scene.add(anchor, ray);
      anchor.userData.visuals = new ControllerVisuals(anchor);
      return anchor;
    });
    [this.right, this.left] = this.controllers;
    this.position = new THREE.Vector3(); this.rotation = new THREE.Quaternion();
    this.session = null; this.pending = [];
    this.onSources = () => this.syncSources();
    this.onInput = event => this.pending.push({ type: event.type, source: event.inputSource });
    this.onVisibility = () => {
      if (this.session?.visibilityState !== 'visible') this.suspend();
    };
    this.onReset = () => this.suspend();
    this.events = ['selectstart', 'selectend'];
    renderer.xr.addEventListener('sessionstart', () => this.connect());
    renderer.xr.addEventListener('sessionend', () => this.disconnect());
    window.addEventListener('blur', () => this.suspend());
  }
  isPhysical(source) {
    return !!source && !source.hand && source.targetRayMode === 'tracked-pointer'
      && source.gamepad?.mapping === 'xr-standard' && !!source.gripSpace;
  }
  connect() {
    this.session = this.renderer.xr.getSession();
    if (!this.session) return;
    this.session.addEventListener('inputsourceschange', this.onSources);
    this.session.addEventListener('visibilitychange', this.onVisibility);
    for (const type of this.events) this.session.addEventListener(type, this.onInput);
    this.reference = this.renderer.xr.getReferenceSpace();
    this.reference?.addEventListener('reset', this.onReset);
    this.syncSources();
  }
  release(anchor) {
    anchor.userData.trigger = anchor.userData.uiPressed = false;
    anchor.dispatchEvent({ type: 'selectend', cancelled: true });
    if (anchor.userData.physicalGripDown) {
      anchor.userData.physicalGripDown = false;
      anchor.dispatchEvent({ type: 'squeezeend', cancelled: true });
    }
    anchor.userData.needsRelease = true;
  }
  suspend() {
    this.pending.length = 0;
    for (const anchor of this.controllers) {
      anchor.userData.tracked = false;
      this.release(anchor);
      anchor.dispatchEvent({ type: 'trackinglost' });
    }
  }
  disconnect() {
    this.suspend();
    this.session?.removeEventListener('inputsourceschange', this.onSources);
    this.session?.removeEventListener('visibilitychange', this.onVisibility);
    this.reference?.removeEventListener('reset', this.onReset);
    for (const type of this.events) this.session?.removeEventListener(type, this.onInput);
    this.session = null; this.reference = null;
    for (const anchor of this.controllers) this.bind(anchor, null);
  }
  syncSources() {
    const sources = Array.from(this.session?.inputSources ?? []);
    for (const [i, anchor] of this.controllers.entries()) {
      const hand = i === 0 ? 'right' : 'left';
      this.bind(anchor, sources.find(s => s.handedness === hand && this.isPhysical(s)) ?? null);
    }
  }
  bind(anchor, source) {
    if (anchor.userData.source === source) return;
    if (anchor.userData.source) {
      this.release(anchor);
      anchor.dispatchEvent({ type: 'disconnected' });
    }
    Object.assign(anchor.userData, {
      source, handedness: anchor === this.right ? 'right' : 'left',
      tracked: false, physicalGripDown: false, needsRelease: true, lastPoseTime: -Infinity,
    });
    anchor.visible = anchor.userData.ray.visible = false;
    anchor.userData.ray.userData.hasPose = anchor.userData.ray.userData.tracked = false;
    if (source) anchor.dispatchEvent({ type: 'connected', data: source });
  }
  applyPose(object, pose, alpha, fresh) {
    const p = pose.transform.position, q = pose.transform.orientation;
    this.position.set(p.x, p.y, p.z); this.rotation.set(q.x, q.y, q.z, q.w);
    if (fresh || object.position.distanceTo(this.position) > 0.15) {
      object.position.copy(this.position); object.quaternion.copy(this.rotation);
    } else {
      if (object.position.distanceToSquared(this.position) > 0.0002 ** 2)
        object.position.lerp(this.position, alpha);
      if (object.quaternion.angleTo(this.rotation) > 0.001)
        object.quaternion.slerp(this.rotation, alpha);
    }
    object.updateMatrixWorld(true);
  }
  update(frame, dt = 1 / 72) {
    if (!this.session) return;
    this.syncSources();
    const reference = this.renderer.xr.getReferenceSpace();
    const now = performance.now();
    const focused = this.session.visibilityState === 'visible';
    for (const anchor of this.controllers) {
      const data = anchor.userData, source = data.source;
      const gripPose = source && frame && reference && focused ? frame.getPose(source.gripSpace, reference) : null;
      const rayPose = source && frame && reference && focused ? frame.getPose(source.targetRaySpace, reference) : null;
      const tracked = !!gripPose && !gripPose.emulatedPosition;
      if (!tracked) {
        if (data.tracked) {
          data.tracked = false; this.release(anchor);
          anchor.dispatchEvent({ type: 'trackinglost' });
        }
        // Brief loss freezes the tool visual for 120 ms, but stops all input.
        anchor.visible = focused && !!source && now - data.lastPoseTime < 120;
        data.ray.visible = anchor.visible && !!data.ray.userData.hasPose;
        data.ray.userData.tracked = false;
        continue;
      }
      const fresh = !anchor.visible;
      const p = gripPose.transform.position, q = gripPose.transform.orientation;
      this.position.set(p.x, p.y, p.z); this.rotation.set(q.x, q.y, q.z, q.w);
      if (data.tracked && (anchor.position.distanceToSquared(this.position) > 0.12 ** 2
        || anchor.quaternion.angleTo(this.rotation) > Math.PI / 3)) this.release(anchor);
      const alpha = 1 - Math.exp(-Math.max(dt, 0) / 0.018);
      this.applyPose(anchor, gripPose, alpha, fresh);
      anchor.visible = data.tracked = true; data.lastPoseTime = now;
      data.ray.userData.tracked = !!rayPose && !rayPose.emulatedPosition;
      if (data.ray.userData.tracked) {
        this.applyPose(data.ray, rayPose, alpha, fresh || !data.ray.userData.hasPose);
        data.ray.userData.hasPose = true; data.ray.userData.lastPoseTime = now;
      }
      data.ray.visible = !!data.ray.userData.hasPose && now - data.ray.userData.lastPoseTime < 120;
      const buttons = source.gamepad.buttons;
      const triggerDown = !!buttons[0]?.pressed;
      const gripValue = buttons[1]?.value ?? (buttons[1]?.pressed ? 1 : 0);
      if (data.needsRelease) {
        if (!triggerDown && gripValue < 0.55) {
          data.needsRelease = false;
          anchor.dispatchEvent({ type: 'squeezeend' });
        }
        else continue;
      }
      // Distinct press/release thresholds prevent incidental grip chatter.
      const grip = data.physicalGripDown ? gripValue > 0.55 : gripValue >= 0.85;
      if (grip !== data.physicalGripDown) {
        data.physicalGripDown = grip;
        anchor.dispatchEvent({ type: grip ? 'squeezestart' : 'squeezeend' });
      }
      if (!triggerDown && (data.trigger || data.uiPressed)) {
        data.trigger = data.uiPressed = false;
        anchor.dispatchEvent({ type: 'selectend' });
      }
    }
    for (const event of this.pending.splice(0)) {
      const anchor = this.controllers.find(c => c.userData.source === event.source);
      if (!anchor || !this.isPhysical(event.source)) continue;
      if (event.type === 'selectstart' && (!anchor.userData.tracked || anchor.userData.needsRelease)) continue;
      anchor.dispatchEvent({ type: event.type, data: event.source });
    }
    // A lost selectend event must never leave an arc latched on.
    for (const anchor of this.controllers) {
      if (!anchor.userData.source?.gamepad?.buttons[0]?.pressed && anchor.userData.trigger) {
        anchor.userData.trigger = false;
        anchor.dispatchEvent({ type: 'selectend' });
      }
    }
  }
  get status() {
    if (!this.session) return 'Meta 컨트롤러 · 오른손 용접 / 왼손 메뉴·작업물 조절';
    return this.controllers.map(c => `${c === this.right ? '오른손' : '왼손'}: ${
      !c.userData.source ? '연결 대기' : c.userData.tracked ? '연결됨' : '추적 대기'}`).join(' / ');
  }
}
