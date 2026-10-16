import * as THREE from 'three';
import { WeldBead, weldBeadOptions } from './WeldBead.js';
import { buildWeldingGun, updateGunTrigger } from './WeldingGun.js';
import { poseTorchByTip } from './Torches.js';
import { basicDownhillPlan, Stroke } from './PassPlan.js';

// A presentation with its own workpieces and beads; never grades a visitor or
// changes the VR exercises. Every tool pose is authored relative to the seam.
export class WebWeldingDemo {
  constructor(shop, stations, camera, controls) {
    Object.assign(this, { camera, controls });
    this.root = new THREE.Group(); shop.add(this.root);
    this.progress = 0; this.playing = false; this.time = 0;
    this.mode = 'demo'; this.pressed = false; this.pointerInside = false;
    this.canvas = controls.domElement;
    this.pointer = new THREE.Vector2(); this.projected = new THREE.Vector3();
    this.aimRay = new THREE.Raycaster(); this.aimWorld = new THREE.Vector3();
    this.aimDirection = new THREE.Vector3();
    this.aimP = null; this.arcOn = false;
    this.keys = new Set();
    this.viewForward = new THREE.Vector3(); this.viewRight = new THREE.Vector3();
    this.viewMove = new THREE.Vector3();
    this.point = new THREE.Vector3(); this.tip = new THREE.Vector3();
    this.forward = new THREE.Vector3(); this.radial = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.frame = { normal: new THREE.Vector3(), travel: new THREE.Vector3(), lateral: new THREE.Vector3() };
    this.examples = stations.map(source => {
      const group = new THREE.Group(); group.position.copy(source.group.position);
      if (source.id === 'pipe') group.position.y += 0.15;
      this.root.add(group);
      const surfaces = source.picks.map(mesh => mesh.clone());
      for (const mesh of surfaces) group.add(mesh);
      if (source.id === 'pipe') {
        // A visible plinth supports the elevated pipe fixture.
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.164, 0.19),
          new THREE.MeshStandardMaterial({ color: 0x303a40, metalness: 0.65, roughness: 0.45 }));
        foot.position.set(0, -group.position.y + 0.07, -0.035); group.add(foot);
      }
      const seam = source.seam, circular = source.id === 'pipe';
      // Own a fresh plan: browsing or practicing never advances the VR session.
      const strokes = circular ? basicDownhillPlan(seam).strokes : [new Stroke({
        id: 'straight', label: '직선 · 시작점에서 끝까지', from: 0, to: 1,
      })];
      const bead = new WeldBead(group, seam, {
        ...weldBeadOptions({ scale: circular ? 0.68 : 1, segments: 320 }),
        sparkCount: 60, gravity: false,
      });
      const gun = buildWeldingGun(); group.add(gun);
      const points = [];
      for (let i = 0; i <= 160; i++) {
        const p = seam.pointAt(i / 160, new THREE.Vector3());
        const f = seam.frameAt(i / 160);
        p.addScaledVector(f.lateral, circular ? -0.003 : 0).addScaledVector(f.normal, 0.0008);
        points.push(p);
      }
      const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x59d7f1, transparent: true, opacity: 0.7, depthWrite: false }));
      group.add(path);
      const start = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x85e7c0 }));
      group.add(start);
      return { id: source.id, group, seam, bead, gun, path, start, circular, strokes, surfaces,
        totalSpan: strokes.reduce((sum, stroke) => sum + stroke.span, 0) };
    });
    this.active = this.examples[0];
    this.playButton = document.getElementById('demo-play');
    this.replayButton = document.getElementById('demo-replay');
    this.progressBar = document.getElementById('demo-progress');
    this.status = document.getElementById('readout');
    this.title = document.getElementById('task');
    this.playButton.addEventListener('click', () => {
      if (this.mode !== 'demo') return;
      if (this.progress >= 1) this.reset();
      this.playing = !this.playing; this.refresh();
    });
    this.replayButton.addEventListener('click', () => {
      this.reset(); this.playing = this.mode === 'demo'; this.refresh();
    });
    for (const button of document.querySelectorAll('[data-web-mode]'))
      button.addEventListener('click', () => this.setMode(button.dataset.webMode));
    document.getElementById('demo-view-reset').addEventListener('click', () => this.frameCamera());
    for (const button of document.querySelectorAll('[data-demo]'))
      button.addEventListener('click', () => this.select(button.dataset.demo));
    const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft',
      'ArrowDown', 'ArrowRight', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
    window.addEventListener('keydown', event => {
      if (!this.root.visible || !this.controls.enabled || event.ctrlKey || event.altKey || event.metaKey
        || event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      if (movementKeys.has(event.code)) {
        event.preventDefault(); this.keys.add(event.code);
      } else if (event.code === 'KeyF') {
        event.preventDefault(); if (!event.repeat) this.frameCamera();
      }
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.releasePointer(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.keys.clear(); this.pause(); }
    });
    this.canvas.addEventListener('pointermove', event => {
      if (event.pointerType === 'mouse' && !(event.buttons & 1)) this.pressed = false;
      this.readPointer(event);
    });
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.root.visible || !this.controls.enabled || this.mode !== 'practice') return;
      event.preventDefault(); event.stopImmediatePropagation(); this.readPointer(event);
      this.pressed = true;
    }, true);
    window.addEventListener('pointerup', event => { if (event.button === 0) this.releasePointer(); }, true);
    this.canvas.addEventListener('pointerleave', () => { this.pointerInside = false; this.releasePointer(); });
    this.canvas.addEventListener('pointercancel', () => { this.pointerInside = false; this.releasePointer(); });
    this.select('plate');
  }
  setMode(mode) {
    if (!['demo', 'practice'].includes(mode) || this.mode === mode) return;
    this.pause(); this.mode = mode;
    document.body.classList.toggle('web-practice', mode === 'practice');
    this.controls.mouseButtons.LEFT = mode === 'practice' ? null : THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = mode === 'practice' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    this.reset(); this.refresh();
  }
  readPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2);
    this.pointerInside = event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }
  releasePointer() {
    this.pressed = false; this.arcOn = false;
  }
  select(id) {
    const next = this.examples.find(example => example.id === id);
    if (!next) return;
    this.playing = false;
    this.active = next;
    for (const example of this.examples) example.group.visible = example === next;
    this.reset(); this.frameCamera(); this.refresh();
  }
  frameCamera() {
    this.keys.clear();
    this.releasePointer(); this.pointerInside = false;
    const { group, circular } = this.active;
    group.updateWorldMatrix(true, true);
    const target = group.localToWorld(new THREE.Vector3());
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(circular
      ? new THREE.Vector3(0.005, 0.005, 0.60) : new THREE.Vector3(0.36, 0.42, 0.37));
    this.controls.update();
    this.layoutCamera();
  }
  layoutCamera() {
    // Leave the controls their own space instead of covering the weld.
    const width = window.innerWidth, height = window.innerHeight;
    this.camera.setViewOffset(width, height, width > 700 ? -Math.min(180, width * 0.15) : 0,
      width > 700 ? 0 : Math.min(130, height * 0.16), width, height);
  }
  reset() {
    this.playing = false; this.progress = 0;
    this.releasePointer(); this.aimP = null;
    this.strokeIndex = 0; this.p = 0; this.coveredP = 0; this.completedSpan = 0;
    this.transfer = null; this.waitingRelease = false;
    this.active.bead.reset(); this.updatePath(); this.pose(); this.refresh();
  }
  pause() {
    this.keys.clear();
    this.releasePointer(); this.pointerInside = false;
    this.playing = false;
    updateGunTrigger(this.active.gun, 0, false, this.time);
    this.active.bead.update(0, { arcOn: false, point: this.point, t: this.cursorT });
    this.refresh();
  }
  pose() {
    const { seam, gun, circular } = this.active;
    const stroke = this.active.strokes[this.strokeIndex];
    let t = stroke.tAt(this.p), lift = 0;
    if (this.transfer) {
      const ratio = this.transfer.elapsed / this.transfer.duration;
      // Lift first, travel around the pipe outside its surface, then lower.
      const travel = THREE.MathUtils.smoothstep(ratio, 0.2, 0.8);
      t = this.transfer.from + this.transfer.delta * travel;
      lift = 0.035 * Math.sin(Math.PI * ratio);
    }
    this.cursorT = t;
    this.lateral = stroke.lateralAt(this.p, seam.length);
    seam.pointAt(t, this.point); seam.frameAt(t, this.frame);
    this.point.addScaledVector(this.frame.lateral, this.lateral);
    if (circular) {
      // Back the nozzle away radially as well as from the plate. Keep the
      // handle above the pipe instead of swinging it through the table.
      this.radial.copy(this.point).setZ(0).normalize();
      this.forward.copy(this.radial).multiplyScalar(-0.65).addScaledVector(this.frame.normal, -0.76).normalize();
      this.up.set(0, -1, 0);
    } else {
      this.forward.copy(this.frame.normal).negate().addScaledVector(this.frame.travel, 0.18).normalize();
      this.up.copy(this.frame.travel);
    }
    this.tip.copy(this.point).addScaledVector(this.forward, -0.006 - lift);
    poseTorchByTip(gun, this.tip, this.forward, this.up);
  }
  update(dt) {
    this.updateView(dt);
    this.time += dt;
    this.aimP = this.mode === 'practice' ? this.pickProgress() : null;
    // A fixed substep keeps the displayed bead continuous after a slow frame.
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(remaining, 1 / 90); remaining -= step;
      const { bead, seam, strokes, totalSpan, circular } = this.active;
      const stroke = strokes[this.strokeIndex];
      let depositing = false;
      if (this.transfer) {
        if (this.mode === 'demo' ? this.playing : !this.waitingRelease || !this.pressed) {
          this.waitingRelease = false;
          this.transfer.elapsed += step;
          if (this.transfer.elapsed >= this.transfer.duration) this.advanceStroke();
        }
      } else if (this.progress < 1) {
        if (this.mode === 'demo' && this.playing) {
          this.p = Math.min(1, this.p + step * totalSpan / ((circular ? 28 : 14) * stroke.span));
          depositing = true;
        } else if (this.mode === 'practice' && this.aimP !== null) {
          // A mouse gesture steers the tool along the selected stroke. Limit
          // speed so sparse pointer events cannot teleport a lit arc.
          const reachable = this.p <= this.coveredP + 0.04;
          const maxStep = step * 0.035 / (stroke.span * seam.length);
          this.p += THREE.MathUtils.clamp(this.aimP - this.p, -maxStep, maxStep);
          depositing = this.pressed && reachable;
        }
        if (depositing) this.coveredP = Math.max(this.coveredP, this.p);
      }
      this.pose();
      if (depositing) bead.deposit(step, { t: this.cursorT, lateral: this.lateral,
        speedRatio: 1, nominalSpeed: seam.length * totalSpan / (circular ? 28 : 14), quality: 1, dir: stroke.dir });
      bead.update(step, { arcOn: depositing, point: this.point, t: this.cursorT });
      this.arcOn = depositing;
      this.progress = Math.min(1, (this.completedSpan + this.coveredP * this.active.strokes[this.strokeIndex].span) / totalSpan);
      if (depositing && this.coveredP >= 1 - 1e-6) { this.coveredP = 1; this.finishStroke(); }
    }
    updateGunTrigger(this.active.gun, this.arcOn ? 1 : 0, false, this.time);
    this.active.path.visible = this.progress < 1;
    this.active.start.visible = this.mode === 'practice' && this.progress < 1 && !this.transfer;
    this.samplePoint(this.active.strokes[this.strokeIndex], this.coveredP, this.active.start.position);
    this.refresh();
  }
  samplePoint(stroke, p, target) {
    const { seam } = this.active, t = stroke.tAt(p);
    seam.pointAt(t, target);
    seam.frameAt(t, this.frame);
    return target.addScaledVector(this.frame.lateral, stroke.lateralAt(p, seam.length))
      .addScaledVector(this.frame.normal, 0.0008);
  }
  updatePath() {
    const stroke = this.active.strokes[this.strokeIndex];
    const positions = this.active.path.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      this.samplePoint(stroke, i / (positions.count - 1), this.projected);
      positions.setXYZ(i, this.projected.x, this.projected.y, this.projected.z);
    }
    positions.needsUpdate = true;
    this.active.path.geometry.computeBoundingSphere();
    this.active.path.material.color.setHex(stroke.colorPath ?? 0x59d7f1);
    this.aimP = null;
  }
  pickProgress() {
    if (!this.pointerInside || this.transfer || !this.root.visible || !this.controls.enabled) return null;
    const rect = this.canvas.getBoundingClientRect();
    const positions = this.active.path.geometry.attributes.position;
    this.camera.updateWorldMatrix(true, false);
    this.active.group.updateWorldMatrix(true, true);
    let best = 48 * 48, result = null;
    for (let i = 0; i < positions.count; i++) {
      this.projected.fromBufferAttribute(positions, i).applyMatrix4(this.active.group.matrixWorld).project(this.camera);
      if (this.projected.z < -1 || this.projected.z > 1) continue;
      const distance = ((this.projected.x - this.pointer.x) * rect.width / 2) ** 2
        + ((this.projected.y - this.pointer.y) * rect.height / 2) ** 2;
      if (distance < best) { best = distance; result = i / (positions.count - 1); }
    }
    if (result !== null) {
      this.samplePoint(this.active.strokes[this.strokeIndex], result, this.aimWorld);
      this.aimWorld.applyMatrix4(this.active.group.matrixWorld);
      const distance = this.camera.position.distanceTo(this.aimWorld);
      this.aimDirection.subVectors(this.aimWorld, this.camera.position).normalize();
      this.aimRay.set(this.camera.position, this.aimDirection);
      this.aimRay.far = Math.max(0, distance - 0.002);
      if (this.aimRay.intersectObjects(this.active.surfaces, false).length) return null;
    }
    return result;
  }
  finishStroke() {
    const stroke = this.active.strokes[this.strokeIndex];
    if (this.strokeIndex === this.active.strokes.length - 1) {
      this.progress = 1; this.playing = false; this.arcOn = false;
      this.active.bead.update(0, { arcOn: false, point: this.point, t: this.cursorT });
    } else if (stroke.requireArcBreak === false) {
      this.advanceStroke();
    } else {
      const next = this.active.strokes[this.strokeIndex + 1];
      let delta = next.tAt(0) - stroke.tAt(1);
      if (this.active.seam.closed) delta -= Math.round(delta);
      this.transfer = { from: stroke.tAt(1), delta, elapsed: 0, duration: 1.4 };
      this.waitingRelease = this.mode === 'practice' && this.pressed;
      this.arcOn = false;
      this.active.bead.update(0, { arcOn: false, point: this.point, t: this.cursorT });
    }
  }
  advanceStroke() {
    this.completedSpan += this.active.strokes[this.strokeIndex].span;
    this.strokeIndex++; this.p = 0; this.coveredP = 0;
    this.transfer = null; this.waitingRelease = false;
    this.updatePath();
  }
  updateView(dt) {
    if (!this.root.visible || !this.controls.enabled) return;
    const pressed = (...codes) => codes.some(code => this.keys.has(code));
    // Translate both eye and orbit center, keeping the weld animation independent.
    this.viewRight.setFromMatrixColumn(this.camera.matrix, 0).setY(0).normalize();
    this.viewForward.crossVectors(this.camera.up, this.viewRight).normalize();
    this.viewMove.set(0, 0, 0)
      .addScaledVector(this.viewRight, Number(pressed('KeyD', 'ArrowRight')) - Number(pressed('KeyA', 'ArrowLeft')))
      .addScaledVector(this.viewForward, Number(pressed('KeyW', 'ArrowUp')) - Number(pressed('KeyS', 'ArrowDown')));
    this.viewMove.y = Number(pressed('KeyE')) - Number(pressed('KeyQ'));
    if (this.viewMove.lengthSq() > 0) {
      this.viewMove.normalize().multiplyScalar(dt * (pressed('ShiftLeft', 'ShiftRight') ? 0.8 : 0.3));
      this.camera.position.add(this.viewMove);
      this.controls.target.add(this.viewMove);
    }
    this.controls.update();
  }
  refresh() {
    const percent = Math.round(this.progress * 100);
    const state = `${this.active.id}:${percent}:${this.playing}:${this.mode}:${this.strokeIndex}:${!!this.transfer}:${this.waitingRelease}:${this.arcOn}:${this.aimP !== null}:${this.p <= this.coveredP + 0.04}`;
    if (state === this.lastState) return;
    this.lastState = state;
    this.title.textContent = this.active.strokes[this.strokeIndex].label;
    this.playButton.hidden = this.mode !== 'demo';
    this.replayButton.textContent = this.mode === 'demo' ? '처음부터' : '다시 연습';
    this.playButton.textContent = this.playing ? '일시정지' : this.progress >= 1 ? '다시 시연' : this.progress > 0 ? '계속 보기' : '▶ 시연 시작';
    this.progressBar.value = this.progress;
    this.progressBar.setAttribute('aria-label', this.mode === 'demo' ? '용접 시연 진행률' : '용접 연습 진행률');
    this.status.textContent = this.progress >= 1 ? '완료 · 남은 비드를 확인해 보세요.'
      : this.transfer ? this.waitingRelease ? '1차 완료 · 왼쪽 버튼을 놓아 아크를 끊으세요.'
        : this.mode === 'demo' && !this.playing ? '일시정지 · 다음 시작점으로 이동 중' : '아크를 끄고 다음 시작점으로 이동 중…'
      : this.mode === 'practice' ? this.arcOn ? `용접 중 · ${percent}%`
        : this.p > this.coveredP + 0.04 ? '초록 표시로 돌아와 이어서 용접하세요.'
        : '초록 표시부터 좌클릭을 누른 채 경로를 따라 움직이세요.'
      : this.playing ? `용접 중 · ${percent}%` : this.progress > 0 ? `일시정지 · ${percent}%` : '시연 시작을 누르면 용접 과정을 보여드립니다.';
    document.getElementById('demo-note').textContent = this.mode === 'demo'
      ? '시연 보기 · 원형은 VR과 같은 운봉 순서로 진행합니다.'
      : '직접 해보기 · 마우스로 운봉, 좌클릭으로 용접 · 경로 보정 적용';
    document.getElementById('demo-view-help').innerHTML = this.mode === 'demo'
      ? '마우스 드래그로 회전 · 휠로 확대<br>방향키 / WASD 이동 · Q/E 높이 조절'
      : '우클릭 드래그로 회전 · 휠로 확대<br>방향키 / WASD 이동 · Q/E 높이 조절';
    for (const button of document.querySelectorAll('[data-web-mode]'))
      button.setAttribute('aria-pressed', String(button.dataset.webMode === this.mode));
    for (const button of document.querySelectorAll('[data-demo]'))
      button.setAttribute('aria-pressed', String(button.dataset.demo === this.active.id));
  }
}
