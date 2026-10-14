import * as THREE from 'three';
import { steelMaterialPBR } from './SteelTextures.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// Kept as the shared entry point so every caller picks up the procedural PBR
// set. roughness is no longer an absolute value: a roughnessMap drives the
// surface now, and this multiplies it.
export function steelMaterial({
  preset = 'benchSteel', span = [0.8, 0.6], tile = 0.22, size = 512,
  roughness = 1, tint = null, renderer = null, normalScale = 0.8,
} = {}) {
  const material = steelMaterialPBR(preset, { span, tile, size, renderer, normalScale, tint });
  material.roughness = roughness;
  return material;
}

function box(parent, dimensions, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

export function perforatedBench(parent, { width = 0.8, depth = 0.6, top = -0.012, z = 0 } = {}) {
  const group = new THREE.Group();
  group.name = 'welding-bench';
  group.position.set(0, top, z);
  parent.add(group);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -depth / 2);
  shape.lineTo(width / 2, -depth / 2); shape.lineTo(width / 2, depth / 2);
  shape.lineTo(-width / 2, depth / 2); shape.closePath();
  for (let x = -width / 2 + 0.035; x < width / 2 - 0.025; x += 0.05) {
    for (let y = -depth / 2 + 0.035; y < depth / 2 - 0.025; y += 0.05) {
      const hole = new THREE.Path();
      hole.absarc(x, y, 0.007, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: true, bevelSize: 0.0005, bevelThickness: 0.0005, bevelSegments: 1, steps: 1, curveSegments: 8 }), steelMaterial());
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = -0.018;
  group.add(plate);
  const frame = new THREE.MeshStandardMaterial({ color: 0x283c42, metalness: 0.65, roughness: 0.56 });
  const height = Math.max(0.5, parent.position.y + top - 0.02);
  for (const x of [-width / 2 + 0.05, width / 2 - 0.05]) {
    for (const dz of [-depth / 2 + 0.05, depth / 2 - 0.05]) {
      box(group, [0.04, height, 0.04], [x, -height / 2 - 0.02, dz], frame);
      box(group, [0.065, 0.015, 0.065], [x, -height - 0.02, dz], frame);
    }
    box(group, [0.035, 0.07, depth - 0.07], [x, -0.055, 0], frame);
  }
  box(group, [width - 0.07, 0.07, 0.035], [0, -0.055, depth / 2 - 0.035], frame);
  box(group, [width - 0.07, 0.035, 0.035], [0, -height * 0.7, -depth / 2 + 0.05], frame);
  return group;
}

export function plateFixtures(parent, plateSize = 0.17, plateHeight = plateSize, centerY = 0) {
  const bottom = centerY - plateHeight / 2;
  const dark = new THREE.MeshStandardMaterial({ color: 0x344044, metalness: 0.7, roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xa5afb2, metalness: 0.9, roughness: 0.32 });
  for (const side of [-1, 1]) {
    box(parent, [0.027, 0.018, 0.045], [side * (plateSize / 2 - 0.018), bottom + 0.006, -0.014], dark);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.009, 6), metal);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(side * (plateSize / 2 - 0.018), bottom + 0.016, 0.011);
    parent.add(bolt);
  }
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(plateSize, plateHeight, 0.012)), new THREE.LineBasicMaterial({ color: 0x9aa8ac, transparent: true, opacity: 0.45, depthWrite: false }));
  outline.position.y = centerY;
  outline.position.z = -0.006;
  parent.add(outline);
}

export function buildWorkshop(scene, renderer) {
  scene.background = new THREE.Color(0xa4afb3);
  for (const child of [...scene.children]) if (child.isGridHelper) scene.remove(child);
  const room = new THREE.Group();
  scene.add(room);
  const concrete = new THREE.MeshStandardMaterial({ color: 0x73807f, roughness: 0.98 });
  const wall = new THREE.MeshStandardMaterial({ color: 0xbcc5bf, roughness: 0.92 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x34474a, metalness: 0.45, roughness: 0.62 });
  box(room, [5, 0.08, 5], [0, -0.045, -0.7], concrete);
  box(room, [5, 3, 0.08], [0, 1.5, -2.5], wall);
  box(room, [0.08, 3, 5], [-2.5, 1.5, -0.7], wall);
  box(room, [0.08, 3, 5], [2.5, 1.5, -0.7], wall);
  for (const x of [-1.4, 1.4]) {
    box(room, [0.035, 3, 0.08], [x, 1.5, -2.43], frame);
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe9f4ff, emissiveIntensity: 2 });
    box(room, [0.8, 0.025, 0.14], [x, 2.7, -0.8], lamp);
  }
  scene.add(new THREE.HemisphereLight(0xe4f3ff, 0x74766a, 0.45));
  const key = new THREE.DirectionalLight(0xfff2df, 1.5);
  key.position.set(-1, 2.8, 1); scene.add(key);
  const fill = new THREE.DirectionalLight(0xc3e2ff, 0.55);
  fill.position.set(1.8, 2, -1); scene.add(fill);

  // What the steel reflects decides how much it reads as metal, so this loads a
  // real workshop probe rendered by tools/blender/make_env_hdr.py: dark floor,
  // dim walls, bright ceiling strips, one hot daylight opening. The three-box
  // room below stands in until the file arrives, and remains the fallback if it
  // cannot be fetched at all, so the demo never ends up with no environment.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const reflections = new THREE.Scene();
  box(reflections, [8, 6, 8], [0, 2, 0], new THREE.MeshBasicMaterial({ color: 0x737f84, side: THREE.BackSide }));
  box(reflections, [4, 0.05, 1], [0, 3.5, 0], new THREE.MeshBasicMaterial({ color: 0xffffff }));
  box(reflections, [0.05, 2, 3], [-3, 1.8, 0], new THREE.MeshBasicMaterial({ color: 0xbed6e8 }));
  const fallback = pmrem.fromScene(reflections, 0.04).texture;
  scene.environment = fallback;
  reflections.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });

  new RGBELoader().load(
    './assets/workshop.hdr',
    (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
      fallback.dispose();
      pmrem.dispose();
    },
    undefined,
    () => pmrem.dispose()
  );

  // Pegboard and a few recognisable tools, kept to simple meshes.
  box(room, [1.15, 0.65, 0.035], [1.25, 1.55, -2.42], frame);
  const orange = new THREE.MeshStandardMaterial({ color: 0xe99837, roughness: 0.75 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xa6b2b6, metalness: 0.8, roughness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const x = 0.8 + i * 0.18;
    box(room, [0.022, 0.18, 0.025], [x, 1.58, -2.38], i % 2 ? orange : metal);
    box(room, [i % 2 ? 0.09 : 0.04, 0.045, 0.035], [x, 1.70, -2.37], metal);
  }
  box(room, [1.2, 0.05, 0.36], [1.25, 1.03, -2.22], frame);
  for (let i = 0; i < 3; i++) box(room, [0.23, 0.16, 0.24], [0.88 + i * 0.35, 1.135, -2.22], i === 1 ? orange : frame);
  box(room, [0.55, 0.68, 0.4], [-1.6, 0.38, -1.9], frame);
  box(room, [0.44, 0.32, 0.025], [-1.6, 0.53, -1.68], orange);
  return room;
}
