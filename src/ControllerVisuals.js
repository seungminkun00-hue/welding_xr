import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MotionController } from '../vendor/addons/libs/motion-controllers.module.js';
import { updateGunTrigger } from './WeldingGun.js';

// Use the browser-reported profile, never the arbitrary input-source index.
// Cache the versioned JSON and GLB in the browser for subsequent offline use.
const PROFILE_BASE = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.19/dist/profiles/';
const requests = new Map();
const models = new Map();
async function resource(url) {
  if (!requests.has(url)) requests.set(url, (async () => {
    let cache;
    try {
      cache = await globalThis.caches?.open('welding-controller-profiles-v1');
      const saved = await cache?.match(url);
      if (saved) return saved;
    } catch { /* Storage can be unavailable in private browsing. */ }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) throw new Error(`Controller asset: ${response.status}`);
      // Consume the body before clearing the timeout.
      const buffered = new Response(await response.arrayBuffer(), { headers: response.headers });
      try { await cache?.put(url, buffered.clone()); } catch { /* Optional cache. */ }
      return buffered;
    } finally { clearTimeout(timer); }
  })().catch(error => { requests.delete(url); throw error; }));
  return (await requests.get(url)).clone();
}

async function loadModel(source) {
  const list = await (await resource(PROFILE_BASE + 'profilesList.json')).json();
  const id = source.profiles.find(name => list[name]);
  if (!id) throw new Error('No matching controller profile');
  const url = new URL(list[id].path, PROFILE_BASE).href;
  const profile = await (await resource(url)).json();
  const layout = profile.layouts[source.handedness];
  if (!layout?.assetPath) throw new Error('Controller model has no handed layout');
  const asset = new URL(layout.assetPath, url).href;
  if (!models.has(asset)) models.set(asset, (async () => {
    const data = await (await resource(asset)).arrayBuffer();
    return (await new GLTFLoader().parseAsync(data, new URL('.', asset).href)).scene;
  })().catch(error => { models.delete(asset); throw error; }));
  return { profile, asset, scene: (await models.get(asset)).clone(true) };
}

// Immediate offline fallback: a ringless controller with individually marked
// controls. It is replaced by the matching manufacturer's profile asset.
function fallbackController(hand) {
  const root = new THREE.Group(), buttons = new Map(), anchors = new Map();
  const shell = new THREE.MeshStandardMaterial({ color: 0xe1e4e6, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x262c32, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.075, 4, 12), shell);
  body.rotation.x = -0.32; body.position.set(0, -0.025, 0.015); root.add(body);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.031, 0.015, 20), dark);
  face.position.set(0, 0.035, -0.016); root.add(face);
  const side = hand === 'left' ? -1 : 1;
  for (const [index, position, size] of [
    [0, [0, 0.015, -0.047], [0.023, 0.017, 0.012]],
    [1, [-side * 0.022, -0.013, 0.009], [0.009, 0.026, 0.022]],
    [3, [-side * 0.014, 0.05, -0.018], [0.014, 0.009, 0.014]],
    [4, [side * 0.016, 0.046, -0.007], [0.011, 0.006, 0.011]],
    [5, [side * 0.014, 0.046, -0.028], [0.011, 0.006, 0.011]],
  ]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), dark.clone());
    mesh.position.set(...position); root.add(mesh);
    buttons.set(index, [mesh.material]);
    anchors.set(index, mesh);
  }
  return { root, buttons, anchors };
}

export function controllerHint(hand, data, context) {
  if (data.needsRelease) return { button: 1, text: '버튼을 모두 놓아 조작 시작', release: true };
  if (context.demo) return hand === 'left'
    ? { button: 5, text: 'Y · 시연 끝내고 연습하기' } : { text: '시연을 보고 따라 해보세요' };
  if (context.help) return hand === 'left'
    ? { button: 0, text: '검지로 선택 · 스틱으로 높이', sub: 'X 마스크 · Y 시연 · B 안내 닫기' }
    : { button: context.heldTool ? 0 : 1, text: context.heldTool ? '검지 트리거 · 누르면 용접' : '옆면 그립 · 용접건 잡기', sub: 'B · 조작 안내 닫기' };
  if (context.pointing || context.dragging) return {
    button: 0, text: context.dragging ? '트리거를 놓으면 전광판 고정' : '트리거 · 가리킨 버튼 선택',
  };
  if (hand === 'right') {
    if (context.blocked) return { text: '설정을 마치고 용접하세요' };
    if (context.finished) return { button: 0, text: '용접 완료 · 트리거를 놓으세요', release: true };
    if (context.needsArcBreak) return { button: 0, text: '트리거를 놓고 다음 구간으로', release: true };
    if (context.basicBench || context.applied) return context.heldTool
      ? { button: 0, text: '검지 트리거 · 누르면 용접', sub: '그립은 유지 · 트리거를 놓으면 정지' }
      : { button: 1, text: '옆면 그립 · 용접건 잡기', sub: 'B · 조작 안내' };
    return { button: 0, text: '앞쪽 트리거 · 누르면 용접', sub: 'B · 조작 안내' };
  }
  if (context.welding) return { text: '' };
  if (context.applied && data.physicalGripDown)
    return { button: 1, text: '그립 유지 · 축 둘레로 회전', sub: '놓으면 작업물 고정' };
  if (context.interaction) return { button: 0, text: `검지 트리거 · ${context.interaction}` };
  if (context.toolHeld) return { text: '' };
  return { button: 0, secondary: 3, text: '트리거 · 테이블 버튼 선택',
    sub: context.applied ? '스틱 ↑↓ 높이 · 그립 회전' : '스틱 ↑↓ 높이 · ◀/▶ 과제' };
}

export class ControllerVisuals {
  constructor(anchor) {
    this.anchor = anchor;
    this.hand = anchor.userData.handedness;
    this.root = new THREE.Group();
    this.root.name = this.hand + '-controller-model'; anchor.add(this.root);
    this.fallback = fallbackController(this.hand);
    this.root.add(this.fallback.root);
    this.buttonMaterials = this.fallback.buttons;
    this.buttonAnchors = this.fallback.anchors;
    this.buttonCenters = this.fallback.anchors;
    this.neutralCenters = new Map([...this.fallback.anchors].map(([id, mesh]) => [id, mesh.position.clone()]));
    this.generation = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 768; this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter; this.texture.generateMipmaps = false;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.texture, transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
    }));
    this.label.position.set(this.hand === 'left' ? -0.10 : 0.10, 0.12, 0.035);
    this.label.scale.set(0.28, 0.28 / 6, 1);
    this.label.renderOrder = 100004;
    anchor.add(this.label);
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
    ]), new THREE.LineBasicMaterial({ color: 0x49c8ff, transparent: true,
      opacity: 0.85, depthTest: true, toneMapped: false }));
    this.line.renderOrder = 100004; anchor.add(this.line);
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x49c8ff, toneMapped: false }));
    anchor.add(this.dot);
    this.target = new THREE.Vector3();
    this.labelWorld = new THREE.Vector3(); this.labelGoal = new THREE.Vector3();
    this.eye = new THREE.Vector3(); this.handPosition = new THREE.Vector3();
    this.eyeRotation = new THREE.Quaternion(); this.eyeRight = new THREE.Vector3();
    this.eyeUp = new THREE.Vector3(); this.eyeForward = new THREE.Vector3();
    this.lookDirection = new THREE.Vector3();
    this.hintOpacity = 0; this.hintSince = 0; this.lastTime = 0;
    anchor.addEventListener('connected', event => this.bind(event.data));
    anchor.addEventListener('disconnected', () => this.clear());
  }

  clear() {
    this.generation++;
    this.model?.removeFromParent();
    // Cached geometry/textures are shared; only cloned materials belong here.
    this.materials?.forEach(material => material.dispose());
    this.materials = []; this.model = this.motion = null;
    this.fallback.root.visible = true;
    this.buttonMaterials = this.fallback.buttons;
    this.buttonAnchors = this.fallback.anchors;
    this.buttonCenters = this.fallback.anchors;
    this.neutralCenters = new Map([...this.fallback.anchors].map(([id, mesh]) => [id, mesh.position.clone()]));
    this.label.visible = false;
    this.hintOpacity = 0; this.labelInitialized = false;
  }

  async bind(source) {
    this.clear();
    const generation = this.generation;
    this.anchor.userData.controllerModelStatus = 'loading';
    try {
      const { profile, asset, scene } = await loadModel(source);
      if (generation !== this.generation || this.anchor.userData.source !== source) return;
      const motion = new MotionController(source, profile, asset);
      scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        const clone = material => {
          const copy = material.clone(); this.materials.push(copy); return copy;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
        mesh.castShadow = mesh.receiveShadow = false;
      });
      this.buttonMaterials = new Map();
      this.buttonAnchors = new Map();
      this.buttonCenters = new Map();
      this.neutralCenters = new Map();
      for (const component of Object.values(motion.components)) {
        // Measure the actual moving button at rest, excluding limit helpers.
        let buttonNode = null;
        for (const response of Object.values(component.visualResponses)) {
          response.valueNode = scene.getObjectByName(response.valueNodeName);
          response.minNode = scene.getObjectByName(response.minNodeName);
          response.maxNode = scene.getObjectByName(response.maxNodeName);
          if (response.componentProperty === 'button' && response.valueNodeProperty === 'transform' && response.minNode && response.valueNode) {
            response.valueNode.position.copy(response.minNode.position);
            response.valueNode.quaternion.copy(response.minNode.quaternion);
            if (response.componentProperty === 'button') buttonNode = response.valueNode;
          }
        }
        const materials = [];
        const node = buttonNode ?? scene.getObjectByName(component.rootNodeName);
        node?.traverse(mesh => {
          if (mesh.isMesh) materials.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
        });
        if (component.gamepadIndices.button !== undefined)
          this.buttonMaterials.set(component.gamepadIndices.button, materials);
        if (node) {
          node.updateWorldMatrix(true, true);
          const box = new THREE.Box3().setFromObject(node);
          const marker = new THREE.Object3D();
          const center = new THREE.Object3D();
          if (!box.isEmpty()) {
            box.getCenter(marker.position);
            center.position.copy(marker.position); node.worldToLocal(center.position);
            if (component.gamepadIndices.button === 0) marker.position.z = box.min.z;
            if (component.gamepadIndices.button !== undefined)
              this.neutralCenters.set(component.gamepadIndices.button, marker.position.clone());
            if (component.gamepadIndices.button === 0) marker.position.z -= 0.002;
            else marker.position.y = box.max.y + 0.002;
            node.worldToLocal(marker.position);
          }
          node.add(marker, center);
          if (component.gamepadIndices.button !== undefined) {
            this.buttonAnchors.set(component.gamepadIndices.button, marker);
            this.buttonCenters.set(component.gamepadIndices.button, center);
          }
        }
      }
      this.motion = motion; this.model = scene; this.root.add(scene);
      this.fallback.root.visible = false;
      this.anchor.userData.controllerModelStatus = profile.profileId;
    } catch (error) {
      if (generation !== this.generation) return;
      this.anchor.userData.controllerModelStatus = 'fallback';
      console.warn('Controller model unavailable; using local controls.', error.message);
    }
  }

  mountTool(tool) {
    // Use neutral profile coordinates, never the moving pressed-button pose.
    // Match the palm-to-index direction as well as the contact position.
    if (!tool.userData.triggerCenter || !tool.userData.gripCenter) return;
    const trigger = this.neutralCenters.get(0) ?? this.fallback.anchors.get(0).position;
    const grip = this.neutralCenters.get(1) ?? this.fallback.anchors.get(1).position;
    const desired = new THREE.Vector3().subVectors(trigger, grip);
    const authored = new THREE.Vector3().subVectors(tool.userData.triggerCenter, tool.userData.gripCenter);
    const pitch = THREE.MathUtils.clamp(Math.atan2(desired.z, desired.y) - Math.atan2(authored.z, authored.y),
      -Math.PI / 2, Math.PI / 2);
    tool.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    tool.position.copy(trigger).sub(this.target.copy(tool.userData.triggerCenter).applyQuaternion(tool.quaternion));
    tool.userData.controllerProfile = this.anchor.userData.controllerModelStatus;
  }

  update(context, time) {
    const data = this.anchor.userData;
    this.root.visible = !!data.source && !context.heldTool;
    this.label.visible = !!data.tracked && !!data.source;
    this.line.visible = this.dot.visible = this.label.visible;
    if (!data.tracked || !data.source) {
      updateGunTrigger(this.lastTool, false, false, time);
      return;
    }
    if (this.motion) {
      this.motion.updateFromGamepad();
      for (const component of Object.values(this.motion.components)) {
        for (const response of Object.values(component.visualResponses)) {
          const { valueNode, minNode, maxNode, value, valueNodeProperty } = response;
          if (!valueNode) continue;
          if (valueNodeProperty === 'visibility') valueNode.visible = value;
          else if (minNode && maxNode) {
            valueNode.position.lerpVectors(minNode.position, maxNode.position, value);
            valueNode.quaternion.slerpQuaternions(minNode.quaternion, maxNode.quaternion, value);
          }
        }
      }
    }
    const hint = controllerHint(this.hand, data, context);
    const dt = Math.min(0.05, time - this.lastTime || 0.016); this.lastTime = time;
    const text = `${hint.text}|${hint.sub ?? ''}|${hint.release ? 'release' : ''}`;
    if (text !== this.lastText) this.hintSince = time;
    let looking = true;
    if (context.viewer) {
      context.viewer.getWorldPosition(this.eye);
      context.viewer.getWorldQuaternion(this.eyeRotation);
      this.anchor.getWorldPosition(this.handPosition);
      this.eyeRight.set(1, 0, 0).applyQuaternion(this.eyeRotation);
      this.eyeUp.set(0, 1, 0).applyQuaternion(this.eyeRotation);
      this.eyeForward.set(0, 0, -1).applyQuaternion(this.eyeRotation);
      this.lookDirection.subVectors(this.handPosition, this.eye).normalize();
      looking = this.lookDirection.dot(this.eyeForward) > 0.9;
      const side = this.hand === 'left' ? -1 : 1;
      this.labelGoal.copy(this.handPosition).addScaledVector(this.eyeRight, side * 0.17)
        .addScaledVector(this.eyeUp, 0.12).addScaledVector(this.eyeForward, -0.06);
      const distance = this.labelGoal.distanceTo(this.eye);
      if (distance < 0.45) this.labelGoal.sub(this.eye).normalize().multiplyScalar(0.45).add(this.eye);
      if (!this.labelInitialized || this.labelWorld.distanceTo(this.labelGoal) > 0.5) {
        this.labelWorld.copy(this.labelGoal); this.labelInitialized = true;
      } else this.labelWorld.lerp(this.labelGoal, 1 - Math.exp(-dt / 0.10));
      this.label.position.copy(this.labelWorld); this.anchor.worldToLocal(this.label.position);
      const width = THREE.MathUtils.clamp(this.eye.distanceTo(this.labelWorld) * 0.48, 0.23, 0.36);
      this.label.scale.set(width, width / 6, 1);
    }
    const priority = context.help || hint.release || context.pointing || context.dragging || context.interaction;
    const show = !!hint.text && (!context.welding || hint.release) &&
      (priority || looking || time - this.hintSince < 5);
    this.hintOpacity = THREE.MathUtils.lerp(this.hintOpacity, show ? 1 : 0, 1 - Math.exp(-dt / 0.16));
    this.label.visible = this.hintOpacity > 0.02;
    this.label.material.opacity = this.hintOpacity;
    this.line.material.opacity = this.hintOpacity * 0.75;
    const pressed = !data.needsRelease ? data.source.gamepad.buttons[0]?.value ?? 0 : 0;
    // A downloaded profile may arrive after pickup. Align once the index
    // trigger is released so the contact tip never jumps during a weld.
    if (context.heldTool && pressed < 0.05 &&
      context.heldTool.userData.controllerProfile !== data.controllerModelStatus)
      this.mountTool(context.heldTool);
    if (this.lastTool && this.lastTool !== context.heldTool) updateGunTrigger(this.lastTool, false, false, time);
    this.lastTool = context.heldTool;
    updateGunTrigger(context.heldTool, pressed, !context.blocked && !context.demo, time);
    const target = context.heldTool?.userData.triggerAnchor ?? this.buttonAnchors.get(hint.button ?? hint.buttons?.[0]);
    this.line.visible = this.dot.visible = !!target && this.label.visible;
    if (target) {
      target.updateWorldMatrix(true, false);
      target.getWorldPosition(this.target);
      this.anchor.worldToLocal(this.target);
      const points = this.line.geometry.attributes.position;
      points.setXYZ(0, this.target.x, this.target.y, this.target.z);
      points.setXYZ(1, THREE.MathUtils.lerp(this.target.x, this.label.position.x, 0.55),
        THREE.MathUtils.lerp(this.target.y, this.label.position.y, 0.55),
        THREE.MathUtils.lerp(this.target.z, this.label.position.z, 0.55));
      points.setXYZ(2, this.label.position.x, this.label.position.y, this.label.position.z);
      points.needsUpdate = true; this.line.geometry.computeBoundingSphere();
      this.dot.position.copy(this.target);
      const activePressed = !!data.source.gamepad.buttons[hint.button ?? hint.buttons?.[0]]?.pressed;
      const color = hint.release ? 0xffbd59 : activePressed ? 0x39ed99 : 0x49c8ff;
      this.line.material.color.setHex(color); this.dot.material.color.setHex(color);
    }
    const highlighted = hint.buttons ?? [hint.button, hint.secondary];
    for (const [index, materials] of this.buttonMaterials) {
      const pressed = !!data.source.gamepad.buttons[index]?.pressed;
      const suggested = highlighted.includes(index);
      const color = pressed && !hint.release ? 0x39ed99 : hint.release ? 0xffbd59 : 0x49c8ff;
      for (const material of materials) {
        if (!material.emissive) continue;
        material.emissive.setHex(pressed || suggested ? color : 0);
        material.emissiveIntensity = pressed ? 0.9 : suggested ? 0.38 + 0.22 * Math.sin(time * 3) : 0;
      }
    }
    if (text !== this.lastText) {
      this.lastText = text;
      const ctx = this.canvas.getContext('2d');
      ctx.clearRect(0, 0, 768, 128);
      ctx.fillStyle = 'rgba(10,23,32,0.94)'; ctx.fillRect(0, 0, 768, 128);
      ctx.fillStyle = hint.release ? '#ffbd59' : '#49c8ff'; ctx.fillRect(0, 0, 8, 128);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 36px sans-serif';
      ctx.fillText(hint.text, 25, 51, 718);
      ctx.fillStyle = '#b8ccd8'; ctx.font = '28px sans-serif';
      ctx.fillText(hint.sub ?? 'B 버튼으로 전체 조작 안내', 25, 101, 718);
      this.texture.needsUpdate = true;
    }
  }
}
