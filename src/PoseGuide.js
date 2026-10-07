import * as THREE from 'three';

// Technique is authored in seam coordinates; the seam frame lifts it into 3D.
export class PoseGuide {
  constructor(parent, seam) {
    this.seam = seam;
    this.group = new THREE.Group();
    parent.add(this.group);
    this.frame = { travel: new THREE.Vector3(), normal: new THREE.Vector3(), lateral: new THREE.Vector3() };
    this.tip = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.displayTip = new THREE.Vector3();
    this.displayDirection = new THREE.Vector3();
    this.aim = new THREE.Quaternion();
    this.matrix = new THREE.Matrix4();
    this.one = new THREE.Vector3(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x53ffd0, transparent: true, opacity: 0.42, depthWrite: false });
    this.rod = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.12, 12), material);
    this.group.add(this.rod);
    this.handle = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.045, 16), material);
    this.group.add(this.handle);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0006, 6, 32), material);
    this.group.add(this.ring);
    this.travel = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 0.035, 0xffcc54, 0.009, 0.005);
    this.group.add(this.travel);
    this.path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x53ffd0, transparent: true, opacity: 0.65 }));
    parent.add(this.path);
    this.points = new Float32Array(32 * 3);
    this.path.geometry.setAttribute('position', new THREE.BufferAttribute(this.points, 3));
    this.path.frustumCulled = false;
  }
  useTorch(model) {
    this.ghostTorch = model.clone(true);
    this.tipInverse = model.userData.tip.matrix.clone().invert();
    this.ghostTorch.traverse(o => {
      if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0x53ffd0, transparent: true, opacity: 0.25, depthWrite: false });
    });
    this.group.add(this.ghostTorch);
    this.rod.visible = this.handle.visible = false;
  }
  setVisible(visible) { this.group.visible = visible; }

  reset() { this.initialized = false; }
  update(t, target, dir = 1, lateral = 0, trajectory = null, dt = 0) {
    const f = this.seam.frameAt(t, this.frame);
    this.seam.pointAt(t, this.tip).addScaledVector(f.lateral, lateral).addScaledVector(f.normal, target.standoff);
    this.direction.copy(f.normal)
      .addScaledVector(f.travel, -Math.tan(THREE.MathUtils.degToRad(target.travelAngle)))
      .addScaledVector(f.lateral, -Math.tan(THREE.MathUtils.degToRad(target.workAngle))).normalize();
    const alpha = !this.initialized || dt <= 0 ? 1 : 1 - Math.exp(-dt / 0.12);
    this.displayTip.lerp(this.tip, alpha);
    this.displayDirection.lerp(this.direction, alpha).normalize();
    this.tip.copy(this.displayTip);
    this.direction.copy(this.displayDirection);
    this.initialized = true;
    if (this.ghostTorch) {
      this.aim.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction);
      this.matrix.compose(this.tip, this.aim, this.one).multiply(this.tipInverse);
      this.matrix.decompose(this.ghostTorch.position, this.ghostTorch.quaternion, this.ghostTorch.scale);
    }
    this.rod.position.copy(this.tip).addScaledVector(this.direction, 0.06);
    this.rod.quaternion.setFromUnitVectors(this.up, this.direction);
    this.handle.position.copy(this.tip).addScaledVector(this.direction, 0.135);
    this.handle.quaternion.copy(this.rod.quaternion);
    this.ring.position.copy(this.tip);
    this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.normal);
    this.travel.position.copy(this.tip).addScaledVector(f.normal, 0.015);
    this.travel.setDirection(f.travel.clone().multiplyScalar(dir));
    for (let i = 0; i < 32; i++) {
      const sample = trajectory ? trajectory(i / 31) : { t: THREE.MathUtils.clamp(t + dir * i / 31 * 0.025 / this.seam.length, 0, 1), lateral, ...target };
      const frame = this.seam.frameAt(sample.t, this.frame);
      this.seam.pointAt(sample.t, this.tip).addScaledVector(frame.lateral, sample.lateral).addScaledVector(frame.normal, sample.standoff);
      this.tip.toArray(this.points, i * 3);
    }
    this.path.geometry.attributes.position.needsUpdate = true;
  }
}
