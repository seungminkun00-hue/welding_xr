import * as THREE from 'three';

export class VRControls {
  constructor(scene, renderer, workpiece, { weldingHand = 'right', onDemo = null } = {}) {
    Object.assign(this, { renderer, workpiece, weldingHand, onDemo });
    this.down = { y: false, b: false };
    this.helpVisible = true;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 640;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2125), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.mesh.renderOrder = 100002;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.draw(false);
    renderer.xr.addEventListener('sessionend', () => { this.down = { y: false, b: false }; });
  }
  draw(demo) {
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, 1024, 640);
    ctx.fillStyle = 'rgba(8,16,24,0.93)';
    ctx.fillRect(0, 0, 1024, 640);
    ctx.font = 'bold 54px sans-serif';
    ctx.fillStyle = '#6effbf';
    ctx.fillText('VR 조작 안내', 40, 72);
    ctx.font = '40px sans-serif';
    ctx.fillStyle = '#ffffff';
    const torch = this.weldingHand === 'left' ? '왼손' : '오른손';
    const free = this.weldingHand === 'left' ? '오른손' : '왼손';
    const lines = [
      `${torch} 그립 : 용접봉 쥐기 / 놓기`,
      `${torch} 그립 + 트리거 : 아크`,
      `${free} 트리거 : 작업물 선택 · 서랍 · 다시하기`,
      `${free} 그립 : 작업대 이동 (아크 OFF)`,
      '왼손 X : 용접 마스크 · Y : 시범 재생',
      '자세한 설명 : 작업대 밑 서랍 속 종이',
    ];
    lines.forEach((line, i) => ctx.fillText(line, 40, 140 + i * 64));
    ctx.fillStyle = demo ? '#ffdb67' : '#8daabc';
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText(demo ? '시범 재생 중 · Y를 눌러 직접 연습' : '직접 연습 중', 40, 580);
    this.texture.needsUpdate = true;
  }
  update(viewer, demo) {
    const inputs = Array.from(this.renderer.xr.getSession()?.inputSources ?? []);
    const pressed = hand => {
      const source = inputs.find(s => s.handedness === hand);
      return source?.gamepad?.mapping === 'xr-standard' && !!source.gamepad.buttons[5]?.pressed;
    };
    const y = pressed('left');
    const b = pressed('right');
    if (y && !this.down.y) this.onDemo?.();
    if (b && !this.down.b) this.helpVisible = !this.helpVisible;
    this.down = { y, b };
    this.mesh.visible = this.renderer.xr.isPresenting && this.helpVisible;
    this.mesh.position.copy(this.workpiece.position).add(new THREE.Vector3(-0.32, 0.24, 0.12));
    // A fixed board on the bench, rather than a panel that rotates at every head tremor.
    this.mesh.rotation.set(-0.12, 0, 0);
    if (demo !== this.lastDemo) { this.draw(demo); this.lastDemo = demo; }
  }
}
