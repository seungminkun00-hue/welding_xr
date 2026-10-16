import * as THREE from 'three';

// Front-mounted controls stay with the moving tabletop. The lift keeps the
// bench level; only its height changes, so seam frames remain unchanged.
export class BasicBenchControls {
  constructor(shop, bench, { onStep }) {
    Object.assign(this, { shop, bench, onStep });
    this.minHeight = 0.65;
    this.maxHeight = 1.2;
    this.targetHeight = shop.position.y;
    this.needsNeutral = true;
    this.hovered = null;
    this.group = new THREE.Group();
    this.group.position.set(0, -0.035, 0.385);
    this.group.rotation.x = -0.35;
    shop.add(this.group);
    this.picks = [];
    for (const [action, label, x] of [
      ['previous', '◀ 이전', -0.45], ['next', '다음 ▶', -0.29],
      ['lower', '▼ 낮춤', 0.29], ['raise', '▲ 높임', 0.45],
    ]) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 96;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#21343d'; ctx.fillRect(0, 0, 256, 96);
      ctx.strokeStyle = '#78b9c9'; ctx.lineWidth = 5; ctx.strokeRect(3, 3, 250, 90);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 37px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 128, 48);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      const button = new THREE.Mesh(new THREE.PlaneGeometry(0.145, 0.065),
        new THREE.MeshBasicMaterial({ map, toneMapped: false }));
      button.position.x = x;
      button.userData.action = action;
      this.group.add(button); this.picks.push(button);
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512; this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.09),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.group.add(screen);
  }

  pick(ray) {
    return ray?.intersectObjects(this.picks, false)[0]?.object.userData.action ?? null;
  }

  activate(action, blocked = false, liftBlocked = blocked) {
    if (!action || blocked) return;
    if (action === 'previous' || action === 'next') this.onStep(action === 'next' ? 1 : -1);
    else if (!liftBlocked && (action === 'raise' || action === 'lower')) this.targetHeight = THREE.MathUtils.clamp(
      this.targetHeight + (action === 'raise' ? 0.05 : -0.05), this.minHeight, this.maxHeight);
  }

  stop() {
    this.targetHeight = this.shop.position.y;
    this.needsNeutral = true;
  }

  update(dt, { keys, xr, controller, blocked, switchBlocked = blocked, title, ray }) {
    this.hovered = this.pick(ray);
    for (const button of this.picks) {
      const action = button.userData.action;
      const disabled = action === 'previous' || action === 'next' ? switchBlocked : blocked;
      button.material.color.setHex(disabled ? 0x607078 :
        button.userData.action === this.hovered ? 0x9dffcc : 0xffffff);
    }
    if (blocked) {
      this.stop();
    } else {
      let input = (keys.PageUp ? 1 : 0) - (keys.PageDown ? 1 : 0);
      if (xr) {
        const data = controller?.userData;
        const valid = data?.tracked && !data.needsRelease && !data.physicalGripDown;
        const axis = valid ? data.source?.gamepad?.axes[3] ?? 0 : 0;
        if (!valid) this.stop();
        else if (Math.abs(axis) <= 0.25) this.needsNeutral = false;
        input = !this.needsNeutral && Math.abs(axis) > 0.25
          ? -Math.sign(axis) * (Math.abs(axis) - 0.25) / 0.75 : 0;
      }
      if (input) this.targetHeight = THREE.MathUtils.clamp(
        this.shop.position.y + input * 0.12 * dt, this.minHeight, this.maxHeight);
      const delta = THREE.MathUtils.clamp(this.targetHeight - this.shop.position.y, -0.12 * dt, 0.12 * dt);
      if (Math.abs(delta) > 1e-7) {
        this.shop.position.y += delta;
        this.bench.userData.updateHeight();
        this.shop.updateWorldMatrix(true, true);
      }
    }
    const label = `${title} · ${Math.round((this.shop.position.y + this.bench.position.y) * 100)} cm`;
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      const ctx = this.canvas.getContext('2d');
      ctx.fillStyle = '#102129'; ctx.fillRect(0, 0, 512, 128);
      ctx.textAlign = 'center'; ctx.fillStyle = '#9dffcc';
      ctx.font = 'bold 34px sans-serif'; ctx.fillText(label, 256, 51, 490);
      ctx.fillStyle = '#d5e4eb'; ctx.font = '26px sans-serif';
      ctx.fillText('과제 전환  ·  작업대 높이', 256, 99);
      this.texture.needsUpdate = true;
    }
  }
}
