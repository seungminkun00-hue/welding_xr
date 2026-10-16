import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import './boot-status.js';

// User-supplied CAD, interpreted in millimetres. Preserve its silhouette and
// split the actual trigger faces so highlighting cannot light the whole grip.
const source = await new STLLoader().loadAsync(new URL('../assets/tools/welding-gun.stl', import.meta.url).href);
const position = source.attributes.position;
const normal = source.attributes.normal;
const parts = Array.from({ length: 5 }, () => ({ positions: [], normals: [], uvs: [] }));
for (let i = 0; i < position.count; i += 3) {
  const x = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
  const y = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
  const part = parts[x < -30 && y > 12 && y < 69 ? 4 : y > 85 ? 1 :
    y < 0 ? (-0.8660254 * x - 0.5 * y > 125 ? 3 : 2) : 0];
  for (let j = i; j < i + 3; j++) {
    // CAD thickness -> hand X, grip length -> down Y, muzzle -> forward Z.
    part.positions.push((position.getZ(j) - 15) * 0.001,
      (55 - position.getY(j)) * 0.001, (position.getX(j) - 10) * 0.001);
    part.normals.push(normal.getZ(j), -normal.getY(j), normal.getX(j));
    const nx = Math.abs(normal.getX(j)), ny = Math.abs(normal.getY(j)), nz = Math.abs(normal.getZ(j));
    const a = nx > ny && nx > nz ? position.getY(j) : position.getX(j);
    const b = nz > nx && nz > ny ? position.getY(j) : position.getZ(j);
    part.uvs.push(a / 28, b / 28);
  }
}
const geometries = parts.map(part => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
  geometry.computeBoundingSphere(); return geometry;
});
source.dispose();

// Centre of the CAD's terminal face, with a 6 mm contact wire beyond it.
const muzzle = new THREE.Vector3(0, 0.1992567, -0.1665022);
const forward = new THREE.Vector3(0, 0.5, -0.8660254).normalize();
// Derive finger contact from the actual forward-facing trigger triangles.
const contact = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const edge = new THREE.Vector3(), other = new THREE.Vector3();
let areaSum = 0;
const triggerGeometry = geometries[4];
for (let i = 0; i < triggerGeometry.attributes.position.count; i += 3) {
  if (triggerGeometry.attributes.normal.getZ(i) > -0.5) continue;
  a.fromBufferAttribute(triggerGeometry.attributes.position, i);
  b.fromBufferAttribute(triggerGeometry.attributes.position, i + 1);
  c.fromBufferAttribute(triggerGeometry.attributes.position, i + 2);
  const area = edge.subVectors(b, a).cross(other.subVectors(c, a)).length() * 0.5;
  contact.addScaledVector(a.add(b).add(c).multiplyScalar(1 / 3), area); areaSum += area;
}
contact.divideScalar(areaSum || 1); contact.x = 0;
const triggerPivot = new THREE.Vector3(0, 0.039, -0.040);
triggerGeometry.translate(-triggerPivot.x, -triggerPivot.y, -triggerPivot.z);

// Shared, deterministic microtexture: molded rubber grain and brushed metal.
function surfaceTexture(kind) {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const noise = ((Math.imul(x + 1, 374761393) ^ Math.imul(y + 7, 668265263)) >>> 0) % 31;
    const value = kind === 'rubber' ? 170 + noise - ((x % 12 < 2 || y % 12 < 2) ? 45 : 0)
      : kind === 'metal' ? 190 + noise + 12 * Math.sin(y * 1.7) : 215 + noise;
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true; return texture;
}
const rubber = surfaceTexture('rubber'), brushed = surfaceTexture('metal'), paint = surfaceTexture('paint');

export function buildWeldingGun() {
  const gun = new THREE.Group(); gun.name = 'user-stl-welding-gun';
  const materials = [
    new THREE.MeshPhysicalMaterial({ color: 0xb92720, roughness: 0.38, metalness: 0.12,
      clearcoat: 0.3, clearcoatRoughness: 0.35, bumpMap: paint, bumpScale: 0.00008 }),
    new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.88, metalness: 0,
      roughnessMap: rubber, bumpMap: rubber, bumpScale: 0.00035 }),
    new THREE.MeshStandardMaterial({ color: 0xb8bdc2, roughness: 0.3, metalness: 0.95,
      roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.00006 }),
    new THREE.MeshStandardMaterial({ color: 0xba7846, roughness: 0.4, metalness: 0.95,
      roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.00009 }),
    new THREE.MeshStandardMaterial({ color: 0x20272d, roughness: 0.48, metalness: 0.2,
      bumpMap: rubber, bumpScale: 0.00012 }),
  ];
  const triggerLever = new THREE.Group(); triggerLever.name = 'moving-gun-trigger';
  triggerLever.position.copy(triggerPivot); gun.add(triggerLever);
  geometries.forEach((geometry, i) => {
    const mesh = new THREE.Mesh(geometry, materials[i]);
    mesh.name = ['red-painted-shell', 'rubber-grip', 'brushed-metal-neck', 'copper-nozzle', 'gun-trigger'][i];
    (i === 4 ? triggerLever : gun).add(mesh);
  });
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.00065, 0.00065, 0.006, 8), materials[2]);
  wire.position.copy(muzzle).addScaledVector(forward, 0.003);
  wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward); gun.add(wire);
  const tip = new THREE.Object3D(); tip.name = 'gun-contact-tip';
  tip.position.copy(muzzle).addScaledVector(forward, 0.006);
  tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), forward);
  tip.updateMatrix(); gun.add(tip);
  const trigger = new THREE.Object3D(); trigger.position.copy(contact).sub(triggerPivot);
  trigger.position.x = 0.017; triggerLever.add(trigger);
  gun.userData.tip = tip;
  gun.userData.reach = tip.position.length();
  gun.userData.triggerAnchor = trigger;
  gun.userData.triggerCenter = contact.clone();
  gun.userData.gripCenter = new THREE.Vector3(0, -0.055, -0.005);
  gun.userData.triggerMaterial = materials[4];
  gun.userData.triggerLever = triggerLever;
  gun.userData.stlGun = true;
  return gun;
}

export function updateGunTrigger(gun, value, suggested, time) {
  const material = gun?.userData.triggerMaterial;
  if (!material) return;
  const amount = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
  gun.userData.triggerLever.rotation.x = -THREE.MathUtils.degToRad(6) * amount;
  material.emissive.setHex(amount > 0.1 ? 0x39ed99 : suggested ? 0x49c8ff : 0);
  material.emissiveIntensity = amount > 0.1 ? 0.45 + amount * 0.6 : suggested ? 0.25 + 0.12 * Math.sin(time * 3) : 0;
}
