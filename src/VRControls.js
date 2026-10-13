import * as THREE from 'three';

export class VRControls {
  constructor(scene, renderer, workpiece, { weldingHand = 'right', onDemo = null, applied = false } = {}) {
    Object.assign(this, { renderer, workpiece, weldingHand, onDemo, applied });
    this.down = { y: false, b: false };
    this.helpVisible = false;
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
    ctx.font = '36px sans-serif';
    ctx.fillStyle = '#ffffff';
    const torch = this.weldingHand === 'left' ? '왼손' : '오른손';
    const free = this.weldingHand === 'left' ? '오른손' : '왼손';
    const lines = this.applied ? [
      '오른손 트리거 : 용접 아크',
      '왼손 그립 : 잡은 채 축 둘레를 따라 수평 회전',
      '왼쪽 스틱 위·아래 : 작업대 높이 조절',
      '전광판 : 왼쪽 트리거를 누른 채 이동',
      '놓으면 고정 / 전광판 버튼은 짧게 클릭',
      '왼손 X : 마스크 / Y : 시연 / 오른손 B : 안내',
    ] : [
      `${torch} 컨트롤러 : 운봉 / 트리거 : 아크`,
      '통합 작업실 : 그립으로 운봉을 쥐고 작업',
      '전광판 : 왼쪽 트리거로 잡고 이동 / 놓아 고정',
      `${free} 컨트롤러 그립 : 작업대 이동`,
      '왼손 X : 마스크 / Y : 고스트 시연',
      '오른손 B : 이 안내 표시 / 숨기기',
    ];
    lines.forEach((line, i) => ctx.fillText(line, 40, 140 + i * 64));
    ctx.fillStyle = demo ? '#ffdb67' : '#8daabc';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(demo ? '시연 중 · 고스트만 이동 / 연습 기록 보존'
      : this.applied ? '응용연습 · 아크를 끄고 자세를 조절하세요' : '기초연습 · 설정에서 가이드 선택', 40, 580);
    this.texture.needsUpdate = true;
  }
  update(viewer, demo) {
    const inputs = Array.from(this.renderer.xr.getSession()?.inputSources ?? []);
    const pressed = hand => {
      const source = inputs.find(s => !s.hand && s.handedness === hand);
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
