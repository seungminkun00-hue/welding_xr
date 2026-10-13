import * as THREE from 'three';

// The controls, where controls actually live in a workshop: on a bit of paper
// in the bench drawer.
//
// The on-screen overlay had grown to five paragraphs and a wall of bullets,
// which is worse than useless in a headset -- you cannot read HTML through a
// welding hood, and a trainee who needs the key list mid-pass has nowhere to
// look. Pull the drawer open, take out the sheet, read it, put it back. It is
// found rather than presented, so nobody has to scroll past it to start.

const PAPER_W = 0.20;
const PAPER_H = 0.283; // A4 proportions

const _box = new THREE.Vector3();
const _faceQ = new THREE.Quaternion();

function drawSheet(ctx, w, h, lines, torchHand, freeHand) {
  // Paper stock, not pure white: a sheet that has lived in a drawer.
  ctx.fillStyle = '#efe7d6';
  ctx.fillRect(0, 0, w, h);

  // Faint fold line across the middle, the giveaway that it was folded once.
  ctx.strokeStyle = 'rgba(120,108,88,0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5);
  ctx.lineTo(w, h * 0.5);
  ctx.stroke();

  ctx.fillStyle = '#1b1a16';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText('조작 안내', 56, 86);

  ctx.strokeStyle = '#8a3a22';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(56, 104);
  ctx.lineTo(w - 56, 104);
  ctx.stroke();

  ctx.font = '26px sans-serif';
  ctx.fillStyle = '#5c5446';
  ctx.fillText(`용접 손: ${torchHand}   ·   빈 손: ${freeHand}`, 56, 142);

  let y = 196;
  for (const line of lines) {
    if (line === null) { y += 18; continue; }
    if (line.heading) {
      ctx.font = 'bold 30px sans-serif';
      ctx.fillStyle = '#8a3a22';
      ctx.fillText(line.heading, 56, y);
      y += 44;
      continue;
    }
    ctx.font = 'bold 27px sans-serif';
    ctx.fillStyle = '#1b1a16';
    ctx.fillText(line.key, 56, y);
    ctx.font = '27px sans-serif';
    ctx.fillStyle = '#3b382f';
    ctx.fillText(line.what, 300, y);
    y += 40;
  }

  ctx.font = 'italic 24px sans-serif';
  ctx.fillStyle = '#7a7161';
  ctx.fillText('서랍에 다시 넣어 두세요', 56, h - 52);
}

export class BenchDrawer {
  /**
   * @param {THREE.Object3D} bench  the bench group; the drawer hangs under it
   * @param {{torchHand?:string, openThrow?:number}} options
   */
  constructor(bench, { torchHand = '오른손', freeHand = '왼손', openThrow = 0.21 } = {}) {
    this.openThrow = openThrow;
    this.open = 0;       // 0 closed, 1 fully out
    this.wantOpen = false;
    this.reading = false;
    this.readBlend = 0;

    const carcass = new THREE.MeshStandardMaterial({
      color: 0x2b3238, metalness: 0.55, roughness: 0.62,
    });
    const front = new THREE.MeshStandardMaterial({
      color: 0x39424a, metalness: 0.6, roughness: 0.5,
    });

    this.group = new THREE.Group();
    // Clear of the whole bench structure, not just the top plate. The top is
    // 18 mm thick and a 70 mm apron rail runs under its front edge, so a
    // drawer hung just below the surface ends up embedded in the frame.
    // Centred between the two workpieces, front flush with the bench edge.
    this.group.position.set(0, -0.185, 0.18);
    bench.add(this.group);

    const W = 0.32, H = 0.072, D = 0.24;
    const body = new THREE.Group();
    this.body = body;
    this.group.add(body);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.006, D), carcass);
    body.add(floor);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.006, H, D), carcass);
      side.position.set(sx * (W / 2 - 0.003), H / 2, 0);
      body.add(side);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.006), carcass);
    back.position.set(0, H / 2, -D / 2);
    body.add(back);

    this.front = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, H + 0.016, 0.01), front);
    this.front.position.set(0, H / 2, D / 2);
    body.add(this.front);

    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.012, 0.018),
      new THREE.MeshStandardMaterial({ color: 0x9aa6ad, metalness: 0.9, roughness: 0.3 })
    );
    handle.position.set(0, H / 2, D / 2 + 0.014);
    body.add(handle);

    // --- the sheet --------------------------------------------------------
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1018;
    this.canvas = canvas;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.paper = new THREE.Mesh(
      new THREE.PlaneGeometry(PAPER_W, PAPER_H),
      new THREE.MeshStandardMaterial({
        map: this.texture, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide,
      })
    );
    // Lying flat in the drawer until it is picked up.
    this.paper.rotation.x = -Math.PI / 2;
    this.paper.position.set(0, 0.006, 0.0);
    body.add(this.paper);
    this.restPosition = this.paper.position.clone();
    this.restQuaternion = this.paper.quaternion.clone();

    this.setHands(torchHand, freeHand);
  }

  /** Redraw the sheet; call again if the welding hand changes. */
  setHands(torchHand, freeHand) {
    const ctx = this.canvas.getContext('2d');
    drawSheet(ctx, this.canvas.width, this.canvas.height, [
      { heading: 'VR' },
      { key: '그립 (아래 버튼)', what: '용접봉 쥐기 / 놓기' },
      { key: '그립 + 트리거', what: '아크 — 둘 다 눌러야 붙습니다' },
      { key: '왼손 트리거', what: '포인터로 작업물 · 서랍 · 설정 선택' },
      { key: '빈 손 그립', what: '작업대 끌어 옮기기' },
      { key: '왼손 X', what: '용접 마스크' },
      { key: '왼손 Y', what: '명장 궤적 재생' },
      null,
      { heading: '데스크톱' },
      { key: 'W / S', what: '진행 · 후퇴' },
      { key: 'A / D', what: '좌우 (중심 이탈)' },
      { key: 'Q / E', what: '아크 길이' },
      { key: '방향키', what: '전진각 · 작업각' },
      { key: 'Space', what: '아크' },
      { key: '1 / 2', what: '평판 · 파이프' },
      { key: 'R / G', what: '다시하기 · 명장 재생' },
    ], torchHand, freeHand);
    this.texture.needsUpdate = true;
  }

  /** Meshes a pointer ray may hit, and what hitting each one means. */
  get picks() {
    return this.reading ? [this.paper] : [this.front, this.paper];
  }

  /**
   * @param {THREE.Object3D} hit  the mesh the ray landed on, or null
   * @returns {'drawer'|'paper'|null}
   */
  classify(hit) {
    if (!hit) return null;
    if (hit === this.paper) return 'paper';
    let node = hit;
    while (node) {
      if (node === this.front) return 'drawer';
      node = node.parent;
    }
    return null;
  }

  /** Trigger pulled on whatever the ray was touching. */
  activate(kind) {
    if (kind === 'drawer') {
      this.wantOpen = !this.wantOpen;
      // Shutting the drawer with the sheet still in the air would leave it
      // floating with nothing to go back into.
      if (!this.wantOpen) this.reading = false;
      return true;
    }
    if (kind === 'paper') {
      // Only reachable once the drawer is actually open.
      if (!this.wantOpen && !this.reading) return false;
      this.reading = !this.reading;
      return true;
    }
    return false;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} viewer  world position of the head / camera
   * @param {THREE.Quaternion} viewerQ  its orientation
   */
  update(dt, viewer, viewerQ) {
    const k = Math.min(1, dt * 7);
    this.open += ((this.wantOpen ? 1 : 0) - this.open) * k;
    this.body.position.z = this.open * this.openThrow;

    this.readBlend += ((this.reading ? 1 : 0) - this.readBlend) * Math.min(1, dt * 6);

    if (this.readBlend < 0.001) {
      this.paper.position.copy(this.restPosition);
      this.paper.quaternion.copy(this.restQuaternion);
      this.paper.scale.setScalar(1);
      return;
    }

    // Held up at arm's length, square to the face. A sheet you have to crane
    // at is no better than the overlay it replaced.
    _box.set(0, -0.05, -0.52).applyQuaternion(viewerQ).add(viewer);
    this.body.worldToLocal(_box);

    this.paper.position.lerpVectors(this.restPosition, _box, this.readBlend);
    _faceQ.copy(viewerQ);
    this.body.getWorldQuaternion(_worldQ);
    _faceQ.premultiply(_worldQ.invert());
    this.paper.quaternion.copy(this.restQuaternion).slerp(_faceQ, this.readBlend);
    this.paper.scale.setScalar(1 + this.readBlend * 0.28);
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    this.texture.dispose();
    this.group.parent?.remove(this.group);
  }
}

const _worldQ = new THREE.Quaternion();
