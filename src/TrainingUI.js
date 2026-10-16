import * as THREE from 'three';

const STORAGE = 'welding-basic-settings-v1';
export class TrainingUI {
  constructor({ scene, renderer, camera, board, controllers, physicalInput, weldingHand,
    helmet, vrControls, getDemo = () => false, toggleDemo = null,
    supportsDemo = () => false, reset, selectStation = null,
    mode = 'basic', positioner = null, resetPositioner = null,
    getMode = () => mode, selectMode = null,
    getJointLabel = () => null, nextJoint = null,
    getHeldTool = () => null,
    getInteraction = () => null,
    getTechnique = () => null, setTechnique = null }) {
    Object.assign(this, { renderer, camera, board, controllers, helmet, vrControls,
      getDemo, toggleDemo, supportsDemo, reset, selectStation, physicalInput, getHeldTool, getInteraction });
    this.getMode = getMode;
    this.guides = true;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
      if (typeof saved.guides === 'boolean') this.guides = saved.guides;
    } catch { /* Private browsing can disable storage. */ }
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 5;
    this.origin = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.pointer = new THREE.Vector2();
    this.boardDrag = null;
    this.dragPoint = new THREE.Vector3();
    this.dragTarget = new THREE.Vector3();
    for (const controller of controllers) {
      controller.addEventListener('selectend', event => this.endBoardDrag(controller, !!event.cancelled || !controller.userData.tracked));
      for (const type of ['trackinglost', 'disconnected'])
        controller.addEventListener(type, () => this.endBoardDrag(controller, true));
    }
    board.getSettings = () => ({
      mode: getMode(), unified: !!selectMode,
      positioner: positioner?.readout, jointLabel: getJointLabel(), hasNextJoint: !!nextJoint,
      guides: this.guides,
      inputStatus: physicalInput.status,
      inputState: this.inputState,
      helmet: helmet?.enabled, hasHelmet: !!helmet, help: vrControls.helpVisible,
      demo: getDemo(), supportsDemo: supportsDemo(), selectStation: !!selectStation,
      technique: getTechnique(),
    });
    board.onAction = async action => {
      const technique = getTechnique();
      if (technique && action === 'plate-angle') {
        const angles = [90, 80, 70, 60, 45];
        setTechnique?.({ plateAngle: angles[(angles.indexOf(technique.plateAngle) + 1) % angles.length] });
      }
      if (technique && action === 'plate-offset') {
        setTechnique?.({ plateOffset: ((Math.round(technique.plateOffset * 1000) + 1) % 7) / 1000 });
      }
      if ((action === 'applied' || action === 'basic') && selectMode) {
        selectMode(action); return;
      }
      if ((action === 'applied' || action === 'basic') && action !== getMode()) {
        const xrSession = renderer.xr.getSession();
        if (xrSession) await xrSession.end();
        location.assign(action === 'applied' ? './application.html' : './shop.html');
        return;
      }
      if (action === 'positioner-home') resetPositioner?.();
      if (action === 'next-joint') nextJoint?.();
      if (action === 'guide') this.guides = !this.guides;
      if (action === 'demo' && supportsDemo()) toggleDemo?.();
      if (action === 'helmet') helmet?.toggle();
      if (action === 'help') vrControls.helpVisible = !vrControls.helpVisible;
      if (action === 'reset') reset();
      if (action === 'plate' || action === 'pipe') selectStation?.(action);
      try { localStorage.setItem(STORAGE, JSON.stringify({ guides: this.guides })); } catch {}
    };
    this.pointers = controllers.map(controller => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(), new THREE.Vector3(0, 0, -1),
      ]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color: 0x91d8ff, transparent: true, opacity: 0.65,
        depthTest: false, depthWrite: false, toneMapped: false,
      }));
      line.renderOrder = 100005; line.frustumCulled = false;
      line.visible = false; controller.userData.ray.add(line);
      const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x69efb0, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      cursor.renderOrder = 100006; cursor.visible = false;
      controller.userData.ray.add(cursor); line.userData.cursor = cursor;
      return line;
    });
    // Capture board clicks before OrbitControls or the workshop picker.
    const canvas = renderer.domElement;
    let down = null;
    const hitAt = event => {
      const rect = canvas.getBoundingClientRect();
      this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, camera);
      return board.hit(this.raycaster);
    };
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || document.pointerLockElement === canvas || renderer.xr.isPresenting || !hitAt(event)) return;
      down = { x: event.clientX, y: event.clientY };
      event.stopImmediatePropagation();
      event.preventDefault();
    }, true);
    canvas.addEventListener('pointerup', event => {
      if (event.button !== 0 || document.pointerLockElement === canvas) return;
      const hit = renderer.xr.isPresenting ? null : hitAt(event);
      if (!down && !hit) return;
      event.stopImmediatePropagation();
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 8)
        board.activate(hit?.action);
      down = null;
    }, true);
    canvas.addEventListener('pointermove', event => {
      if (!renderer.xr.isPresenting && document.pointerLockElement !== canvas) board.hovered = hitAt(event)?.action ?? null;
    });
    canvas.addEventListener('pointercancel', () => { down = null; });
    document.addEventListener('pointerlockchange', () => { down = null; });
    renderer.xr.addEventListener('sessionend', () => {
      this.boardDrag = null;
      board.settingsOpen = false;
      for (const controller of controllers) {
        controller.userData.trigger = false;
        controller.userData.uiPressed = false;
      }
    });
    board.refresh();
  }
  get inputState() {
    const session = this.renderer.xr.getSession();
    const right = this.physicalInput.right.userData;
    const left = this.physicalInput.left.userData;
    return {
      sessionActive: !!session,
      rightSource: !!right.source, rightTracked: right.tracked,
      leftSource: !!left.source, leftTracked: left.tracked,
      summary: !session ? 'PC: 마우스로 시점·운봉 · 방향키 이동 · 좌클릭 용접'
        : right.tracked && left.tracked ? '양쪽 컨트롤러 위치 수신 중'
          : '추적 대기 · 컨트롤러가 다시 잡히면 버튼을 놓고 재입력하세요.',
    };
  }
  setControllerRay(controller) {
    const ray = controller?.userData.ray;
    if (!controller?.userData.tracked || !ray?.visible || !ray.userData.tracked) return null;
    ray.getWorldPosition(this.origin);
    ray.getWorldQuaternion(this.rotation);
    this.direction.set(0, 0, -1).applyQuaternion(this.rotation);
    this.raycaster.set(this.origin, this.direction);
    return true;
  }
  controllerHit(controller, includeSurface = false) {
    if (!this.setControllerRay(controller)) return null;
    return this.board.hit(this.raycaster, includeSurface);
  }
  get blocksManipulation() { return this.board.settingsOpen || !!this.boardDrag; }
  endBoardDrag(controller, cancelled = false) {
    const drag = this.boardDrag;
    if (drag?.controller !== controller) return;
    this.boardDrag = null;
    if (!cancelled && !drag.moved) {
      const hit = this.controllerHit(controller, true);
      if (hit?.action === drag.action) this.board.activate(drag.action);
    }
  }
  updateBoardDrag() {
    const drag = this.boardDrag;
    if (!drag) return;
    const data = drag.controller.userData;
    if (!data.tracked || data.needsRelease || !this.setControllerRay(drag.controller)) {
      this.endBoardDrag(drag.controller, true); return;
    }
    if (!data.source?.gamepad?.buttons[0]?.pressed) {
      this.endBoardDrag(drag.controller); return;
    }
    this.raycaster.ray.at(drag.distance, this.dragPoint);
    this.dragTarget.copy(drag.boardStart).add(this.dragPoint).sub(drag.start);
    if (this.dragTarget.distanceToSquared(drag.last) > 0.12 ** 2) {
      this.endBoardDrag(drag.controller, true); return;
    }
    if (!drag.moved && this.dragPoint.distanceToSquared(drag.start) < 0.006 ** 2) return;
    drag.moved = true;
    if (this.dragTarget.distanceToSquared(drag.last) < 0.0005 ** 2) return;
    this.board.moveTo(this.dragTarget);
    drag.last.copy(this.dragTarget);
  }
  handleSelect(controller) {
    if (!controller.userData.tracked || controller.userData.needsRelease) return true;
    const left = controller.userData.handedness === 'left';
    if (left && controller.userData.physicalGripDown) return true;
    if (this.boardDrag) return true;
    const hit = this.controllerHit(controller, left);
    if (!hit && !this.board.settingsOpen) return false;
    controller.userData.uiPressed = true;
    controller.userData.trigger = false;
    if (hit && left) {
      const boardStart = this.board.mesh.getWorldPosition(new THREE.Vector3());
      this.boardDrag = { controller, distance: hit.distance, action: hit.action,
        start: this.raycaster.ray.at(hit.distance, new THREE.Vector3()),
        boardStart, last: boardStart.clone(), moved: false };
    } else if (hit) this.board.activate(hit.action);
    return true;
  }
  blocksArc(controller) {
    return this.blocksManipulation || !!controller?.userData.uiPressed ||
      (this.renderer.xr.isPresenting && (!controller?.userData.tracked ||
        controller.userData.needsRelease || !!this.controllerHit(controller)));
  }
  update(frame) {
    if (!this.renderer.xr.isPresenting) return;
    this.updateBoardDrag();
    this.board.hovered = null;
    this.controllers.forEach((controller, i) => {
      const hit = this.boardDrag?.controller === controller ? { distance: this.boardDrag.distance }
        : this.controllerHit(controller, controller.userData.handedness === 'left');
      const pointer = this.pointers[i];
      pointer.visible = controller.visible && controller.userData.ray.visible;
      pointer.scale.z = hit?.distance ?? 3;
      pointer.userData.cursor.visible = pointer.visible && !!hit;
      pointer.userData.cursor.position.z = -(hit?.distance ?? 3);
      pointer.material.color.setHex(hit?.action ? 0x69efb0 : 0x91d8ff);
      if (hit) {
        this.board.hovered ??= hit.action;
      }
      controller.userData.visuals?.update({
        basicBench: this.vrControls.basicBench,
        applied: this.getMode() === 'applied',
        help: this.vrControls.helpVisible,
        demo: this.getDemo(),
        pointing: !!hit,
        dragging: this.boardDrag?.controller === controller,
        blocked: this.blocksManipulation,
        welding: !!this.board.live?.welding,
        toolHeld: this.vrControls.basicBench && this.physicalInput.right.userData.physicalGripDown,
        finished: !!this.board.session?.finished,
        heldTool: controller === this.physicalInput.right ? this.getHeldTool() : null,
        needsArcBreak: !!this.board.session?.stats?.done &&
          this.board.session?.plan?.current?.requireArcBreak !== false,
        viewer: this.renderer.xr.getCamera(this.camera),
        interaction: controller === this.physicalInput.left ? this.getInteraction() : null,
      }, performance.now() / 1000);
    });
  }
}
