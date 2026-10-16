import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { removeFieldEndPlate } from './FieldWorkpiece.js';

export async function buildFieldWorkshop(scene, renderer, { environmentOnly = false } = {}) {
  const [gltf, response, hdr] = await Promise.all([
    new GLTFLoader().loadAsync('./assets/field-workshop/workshop.glb?v=adjustable-lift-4'),
    fetch('./assets/field-workshop/joint-layout.json?v=single-pbr-3'),
    new RGBELoader().loadAsync('./assets/workshop.hdr').catch(() => null),
  ]);
  if (!response.ok) throw new Error('작은 배관 치수 정보를 불러오지 못했습니다.');
  const layout = await response.json();
  const root = gltf.scene;
  root.name = 'photo-referenced-workshop';
  const names = ['PositionerYaw', 'PositionerTilt', 'PipeRoll', 'WeldAssembly', 'LiftTop', 'LiftMechanism'];
  const nodes = names.map(name => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`현장 모델에 ${name} 노드가 없습니다.`);
    return node;
  });
  removeFieldEndPlate(nodes[3]);
  scene.add(root);
  scene.background = new THREE.Color(0x737872);
  scene.add(new THREE.HemisphereLight(0xecf1ff, 0x4c4436, 1.05));
  const key = new THREE.DirectionalLight(0xfff1db, 2.3);
  key.position.set(-1, 3.2, 2); key.target.position.set(0, 0.7, -0.7);
  scene.add(key, key.target);
  // Standalone headset budget: one key, one hemisphere, no shadow-map pass.
  renderer.shadowMap.enabled = false;
  const backgroundMaterials = new Map();
  const workshop = root.getObjectByName('WorkshopStatic');
  workshop?.traverse(o => {
    if (!o.isMesh) return;
    const lightweight = original => {
      if (!backgroundMaterials.has(original)) {
        // Keep the photo-model's colour/wear maps, but reserve full PBR and
        // reflection sampling for the pipe, fixture and completed welds.
        backgroundMaterials.set(original, new THREE.MeshLambertMaterial({
          name: original.name + ' background', color: original.color,
          map: original.map, emissive: original.emissive,
          emissiveMap: original.emissiveMap, emissiveIntensity: original.emissiveIntensity,
          side: original.side, transparent: original.transparent,
          opacity: original.opacity, alphaTest: original.alphaTest,
        }));
      }
      return backgroundMaterials.get(original);
    };
    o.material = Array.isArray(o.material) ? o.material.map(lightweight) : lightweight(o.material);
    o.updateMatrix(); o.matrixAutoUpdate = false;
  });
  root.traverse(o => {
    if (!o.isMesh) return;
    o.receiveShadow = o.castShadow = false;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const material of materials) {
      if (material.name !== 'Training polished tube PBR') continue;
      material.envMapIntensity = 1.6;
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
        if (material[slot]) material[slot].anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      }
    }
  });
  // A bundled probe keeps steel reflective without requiring network access.
  const pmrem = new THREE.PMREMGenerator(renderer);
  if (hdr) {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
  } else {
    const probe = new THREE.Scene();
    probe.add(new THREE.Mesh(new THREE.BoxGeometry(8, 6, 8),
      new THREE.MeshBasicMaterial({ color: 0xaaa99c, side: THREE.BackSide })));
    const strip = new THREE.Mesh(new THREE.BoxGeometry(4, 0.03, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    strip.position.y = 2.8; probe.add(strip);
    const fallback = pmrem.fromScene(probe, 0.04);
    scene.environment = fallback.texture;
    probe.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  pmrem.dispose();
  const [yaw, tilt, roll, assembly, liftTop, liftMechanism] = nodes;
  // Prepare the rig's materials before detaching it for a shared bench.
  if (environmentOnly) {
    root.getObjectByName('LiftTable')?.removeFromParent();
    yaw.removeFromParent();
  }
  return { root, yaw, tilt, roll, assembly, liftTop, liftMechanism, layout };
}
