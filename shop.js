import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WebWeldingDemo } from './src/WebWeldingDemo.js';
import { DesktopPanel } from './src/DesktopPanel.js';

import { perforatedBench, plateFixtures } from './src/Workshop.js';
import { buildFieldWorkshop } from './src/FieldWorkshop.js';
import { fieldJointDefinitions, createFieldSeam, smallJointPlan } from './src/FieldJoints.js';
import { Positioner } from './src/Positioner.js';
import { BasicBenchControls } from './src/BasicBenchControls.js';
import { steelMaterialPBR } from './src/SteelTextures.js';
import { poseTorchByTip } from './src/Torches.js';
import { buildWeldingGun, updateGunTrigger } from './src/WeldingGun.js';
import { VRControls } from './src/VRControls.js';
import { TrainingUI } from './src/TrainingUI.js';
import { PhysicalControllers } from './src/PhysicalControllers.js';
import { MasterDemo } from './src/MasterDemo.js';
import { HelmetView } from './src/HelmetView.js';
import { PoseGuide } from './src/PoseGuide.js';
import { StationPicker } from './src/StationPicker.js';
import { BenchDrawer } from './src/BenchDrawer.js';
import './src/boot-status.js';

import { WeldSeam } from './src/WeldSeam.js';
import { LinearGuide } from './src/LinearGuide.js';
import { WeldSession } from './src/WeldSession.js';
import { pipeFilletSeam } from './src/SeamCurve.js';
import { basicDownhillPlan } from './src/PassPlan.js';
import { CurvedGuide } from './src/CurvedGuide.js';
import { JointSession } from './src/JointSession.js';
import { WeldBead, weldBeadOptions } from './src/WeldBead.js';
import { TorchHud } from './src/TorchHud.js';
import { StatsBoard } from './src/StatsBoard.js';

// ---------------------------------------------------------------------------
// One centered exercise at a time. Switching preserves each exercise's bead
// and the XR session; the held tool follows the selected task automatically.
// ---------------------------------------------------------------------------

const BENCH_HEIGHT = 0.9;
const BENCH_Z = -0.46;

// Flat butt joint, same dimensions as index.html.
const PLATE_WIDTH = 0.13;
const PLATE_LENGTH = 0.34;
const PLATE_THICKNESS = 0.012;
const ROOT_GAP = 0.002;
const SEAM_LENGTH = 0.24;

// Pipe fillet, same dimensions as pipe.html.
const BLOCK = 0.17;
const PLATE_EXTENSION = 0.22;
const PIPE_PLATE_HEIGHT = BLOCK + PLATE_EXTENSION;
const PIPE_PLATE_CENTER_Y = -PLATE_EXTENSION / 2;
const PIPE_TABLE_TOP = PIPE_PLATE_CENTER_Y - PIPE_PLATE_HEIGHT / 2 - 0.002;
const PIPE_OUTER = 0.0335;
const PIPE_WALL = 0.004;
const PIPE_LENGTH = 0.085;

const TILT_LIMIT = 55;
let webDemo = null;

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.cameraAutoUpdate = false;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(0.70);
renderer.xr.setFoveation(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);
const loading = document.getElementById('task');
if (loading) loading.textContent = '현장 작업장을 불러오는 중…';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d13);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0.1, 1.42, BENCH_Z + 0.78);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, BENCH_HEIGHT + 0.08, BENCH_Z);
controls.enableDamping = false;
controls.enableRotate = controls.enablePan = controls.enableZoom = true;
controls.rotateSpeed = 0.65;
controls.zoomSpeed = 0.65;
controls.panSpeed = 0.7;
// Desktop viewing is enabled after the presentation is ready; XR owns its camera.
controls.enabled = false;
controls.minDistance = 0.2;
controls.maxDistance = 3.0;
controls.update();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (!renderer.xr.isPresenting) webDemo?.layoutCamera();
});

const field = await buildFieldWorkshop(scene, renderer, { environmentOnly: true });

// ---------------------------------------------------------------------------
// The bench everything stands on
// ---------------------------------------------------------------------------
const shop = new THREE.Group();
shop.position.set(0, BENCH_HEIGHT, BENCH_Z);
scene.add(shop);

const bench = perforatedBench(shop, {
  width: 1.38, depth: 0.72, top: -PLATE_THICKNESS, z: 0, adjustable: true,
});
const appliedRig = new THREE.Group();
appliedRig.name = 'applied-positioner-on-shared-bench';
shop.add(appliedRig);
appliedRig.add(field.yaw);
field.yaw.position.set(0, 0.43, -0.08);
const pedestalMaterial = new THREE.MeshStandardMaterial({ color: 0x303c42, metalness: 0.75, roughness: 0.4 });
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 0.34, 24), pedestalMaterial);
pedestal.position.set(0, 0.17, -0.08); appliedRig.add(pedestal);
const base = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.24), pedestalMaterial);
base.position.set(0, 0, -0.08); appliedRig.add(base);
// The shared motion table owns height. This positioner only rotates the jig.
const positioner = new Positioner({ yaw: field.yaw, tilt: field.tilt, roll: field.roll });

// ---------------------------------------------------------------------------
// Station: flat butt joint (MIG, 1G)
// ---------------------------------------------------------------------------
function buildPlateStation() {
  const group = new THREE.Group();
  group.name = 'station-plate';
  group.position.set(0, 0, 0);
  shop.add(group);

  const face = steelMaterialPBR('rolledSheet', {
    span: [PLATE_WIDTH, PLATE_LENGTH], tile: 0.09, renderer, normalScale: 0.35,
  });
  const cut = steelMaterialPBR('cutEdge', {
    span: [PLATE_LENGTH, PLATE_THICKNESS], tile: 0.02, size: 512, renderer, normalScale: 0.7,
  });

  const picks = [];
  for (const side of [-1, 1]) {
    const faces = Array(6).fill(face);
    faces[side > 0 ? 1 : 0] = cut;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(PLATE_WIDTH, PLATE_THICKNESS, PLATE_LENGTH), faces
    );
    plate.position.set(side * (PLATE_WIDTH / 2 + ROOT_GAP / 2), -PLATE_THICKNESS / 2, 0);
    group.add(plate);
    picks.push(plate);
  }

  const seam = new WeldSeam({
    start: new THREE.Vector3(0, 0, SEAM_LENGTH / 2),
    end: new THREE.Vector3(0, 0, -SEAM_LENGTH / 2),
    normal: new THREE.Vector3(0, 1, 0),
  });

  const guide = new LinearGuide(group, seam, { zoneHalfWidth: 0.007 });
  const bead = new WeldBead(group, seam, weldBeadOptions());
  const session = new WeldSession(seam, {
    standoffTol: 0.006, lateralTol: 0.0075, angleTol: 25, speedRange: 0.008,
  });
  const poseGuide = new PoseGuide(group, seam);

  const desktopTorch = buildWeldingGun();
  poseGuide?.useTorch(desktopTorch);
  group.add(desktopTorch);

  const desktop = {
    travel: 0, lateral: 0,
    height: session.idealStandoff,
    travelAngle: session.idealTravelAngleDeg,
    workAngle: 0,
  };

  const _f = new THREE.Vector3();

  const forward = (target) => target
    .copy(seam.normal).negate()
    .applyAxisAngle(seam.lateral, THREE.MathUtils.degToRad(desktop.travelAngle))
    .applyAxisAngle(seam.travel, THREE.MathUtils.degToRad(desktop.workAngle))
    .normalize();

  const tipFromDesktop = (target) => target
    .copy(seam.start)
    .addScaledVector(seam.travel, desktop.travel)
    .addScaledVector(seam.lateral, desktop.lateral)
    .addScaledVector(seam.normal, desktop.height);

  return {
    id: 'plate',
    title: '직선 용접 · 평판',
    hint: 'MIG · 1G 기초연습',
    group, picks, seam, guide, bead, session, poseGuide,
    desktop, desktopTorch,
    vrTorch: buildWeldingGun(),
    usesBoard: true,
    // The recorded master trajectory is available for the pipe exercise.
    supportsDemo: false,

    updateDesktop() {
      desktop.travel = THREE.MathUtils.clamp(desktop.travel, -0.03, SEAM_LENGTH + 0.03);
      desktop.lateral = THREE.MathUtils.clamp(desktop.lateral, -0.05, 0.05);
      desktop.height = THREE.MathUtils.clamp(desktop.height, 0.001, 0.08);
      desktop.travelAngle = THREE.MathUtils.clamp(desktop.travelAngle, -TILT_LIMIT, TILT_LIMIT);
      desktop.workAngle = THREE.MathUtils.clamp(desktop.workAngle, -TILT_LIMIT, TILT_LIMIT);

      forward(_f);
      const tip = tipFromDesktop(new THREE.Vector3());
      poseTorchByTip(desktopTorch, tip, _f);
    },

    tipLocal: tipFromDesktop,
    forwardLocal: forward,

    updateGuide(dt, m) {
      guide.update(dt, {
        cursorT: THREE.MathUtils.clamp(m.t, 0, 1),
        progressT: session.maxT,
        onSeam: m.onSeam,
        arcOn: m.welding,
        severity: m.severity,
      });
    },

    contact(m, target) {
      return seam
        .pointAt(THREE.MathUtils.clamp(m.t, 0, 1), target)
        .addScaledVector(seam.lateral, m.lateral);
    },

    depositArgs(m) {
      return {
        t: THREE.MathUtils.clamp(m.t, 0, 1),
        lateral: m.lateral,
        speedRatio: m.speedRatio,
        nominalSpeed: session.idealSpeed,
        quality: m.quality,
      };
    },

    hudArgs(m) {
      return { depth: m.depthErr, center: m.center, speed: m.welding ? m.speedFraction : 0.5 };
    },

    readout(m) {
      return `평판 맞대기 · 진행 ${Math.round(session.maxT * 100)}%${m.onSeam ? '' : ' (심 이탈)'}` +
        ` · 아크길이 ${(m.height * 1000).toFixed(1)}mm` +
        ` · 중심편차 ${(m.lateral * 1000).toFixed(1)}mm` +
        ` · 속도 ${(m.speed * 1000).toFixed(1)}mm/s` +
        ` · 작업각 ${m.travelAngleDeg.toFixed(0)}°`;
    },

    updatePose(dt) {
      poseGuide?.update(session.maxT, {
        standoff: session.idealStandoff,
        travelAngle: session.idealTravelAngleDeg,
        workAngle: 0,
      }, 1, 0, null, dt);
    },

    resultHtml(r) {
      return `<h2>평판 맞대기 · ${r.total}점</h2>
        <div class="bar"><span>깊이(아크 길이)</span><b>${r.depth}%</b></div>
        <div class="bar"><span>중앙 정렬</span><b>${r.center}%</b></div>
        <div class="bar"><span>운봉 속도</span><b>${r.speed}%</b></div>
        <div class="bar"><span>비드 적층률</span><b>${r.coverage}%</b></div>
        <p class="hint">아크 시간 ${r.arcTime.toFixed(1)}초 · R 키로 다시 시도</p>`;
    },

    reset() {
      session.reset();
      bead.reset();
      poseGuide?.reset();
      desktop.travel = 0;
      desktop.lateral = 0;
      desktop.height = session.idealStandoff;
      desktop.travelAngle = session.idealTravelAngleDeg;
      desktop.workAngle = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Station: pipe-to-plate fillet (SMAW, all positions)
// ---------------------------------------------------------------------------
function buildPipeStation(definition = null) {
  const applied = !!definition;
  const group = applied ? field.assembly.clone(true) : new THREE.Group();
  group.name = applied ? definition.id : 'station-pipe';
  let picks;
  if (applied) {
    field.roll.add(group);
    picks = [];
    group.traverse(object => { if (object.isMesh) picks.push(object); });
  } else {
  // Lift it so the fixture's own table line lands on the bench top.
  group.position.set(0, -PIPE_TABLE_TOP, 0);
  shop.add(group);

  const CIRC = 2 * Math.PI * PIPE_OUTER;
  const plateMat = steelMaterialPBR('rolledSheet', {
    span: [BLOCK, PIPE_PLATE_HEIGHT], tile: 0.09, renderer, normalScale: 0.35,
  });
  const pipeMat = steelMaterialPBR('polishedTube', {
    span: [CIRC, PIPE_LENGTH], tile: 0.06, renderer, normalScale: 0.18,
  });
  const boreMat = steelMaterialPBR('hotRolledPlate', {
    span: [CIRC, PIPE_LENGTH], tile: 0.05, renderer, tint: 0x6f767a,
  });
  const rimMat = steelMaterialPBR('cutEdge', {
    span: [CIRC, PIPE_WALL], tile: 0.012, size: 512, renderer, normalScale: 1.2,
  });

  const block = new THREE.Mesh(
    new THREE.BoxGeometry(BLOCK, PIPE_PLATE_HEIGHT, 0.012), plateMat
  );
  block.position.set(0, PIPE_PLATE_CENTER_Y, -0.006);
  group.add(block);
  plateFixtures(group, BLOCK, PIPE_PLATE_HEIGHT, PIPE_PLATE_CENTER_Y);

  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(PIPE_OUTER, PIPE_OUTER, PIPE_LENGTH, 48, 1, true), pipeMat
  );
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(0, 0, PIPE_LENGTH / 2);
  group.add(pipe);

  const bore = new THREE.Mesh(
    new THREE.CylinderGeometry(PIPE_OUTER - PIPE_WALL, PIPE_OUTER - PIPE_WALL, PIPE_LENGTH, 48, 1, true),
    boreMat
  );
  bore.rotation.x = Math.PI / 2;
  bore.position.set(0, 0, PIPE_LENGTH / 2);
  bore.material.side = THREE.BackSide;
  group.add(bore);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(PIPE_OUTER - PIPE_WALL, PIPE_OUTER, 48), rimMat
  );
  rim.position.set(0, 0, PIPE_LENGTH);
  group.add(rim);
  picks = [pipe, rim, block];
  }

  const seam = applied ? createFieldSeam(definition) : pipeFilletSeam({
    center: new THREE.Vector3(0, 0, 0),
    wallNormal: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0),
    radius: PIPE_OUTER,
    plateAim: true,
  });

  const plan = applied ? smallJointPlan(seam) : basicDownhillPlan(seam);
  const guide = new CurvedGuide(group, seam, plan, {
    depthTest: applied,
    zoneHalfWidth: applied ? 0.0022 : 0.0055, segments: applied ? 64 : 160,
    ringRadius: applied ? 0.0024 : 0.006,
  });
  const bead = new WeldBead(group, seam, {
    ...weldBeadOptions({ scale: applied ? 0.32 : 0.68, segments: applied ? 192 : 320 }),
    gravity: !applied, sparkCount: applied ? 80 : 160,
  });
  const session = new JointSession(seam, plan, {
    standoffTol: applied ? 0.0012 : 0.0024, lateralTol: applied ? 0.0015 : 0.0035,
    angleTol: 22, speedTol: applied ? 0.0012 : 0.0018,
    workpiece: group,
  });
  const poseGuide = new PoseGuide(group, seam);
  if (applied) { poseGuide.ring.scale.setScalar(0.4); poseGuide.travel.setLength(0.015, 0.004, 0.002); }

  const desktopTorch = buildWeldingGun();
  poseGuide?.useTorch(desktopTorch);
  const demoPlayer = new MasterDemo(seam, plan, poseGuide);
  group.add(desktopTorch);

  const desktop = { p: 0, lateral: plan.current.lateralAt(0, seam.length), height: applied ? 0.002 : 0.0028,
    travelAngle: plan.current.sample(0).travelAngle, workAngle: plan.current.sample(0).workAngle };
  let lastStrokeIndex = 0;

  const _frame = { travel: new THREE.Vector3(), normal: new THREE.Vector3(), lateral: new THREE.Vector3() };
  const _f = new THREE.Vector3();

  const activeStroke = () => plan.current ?? plan.strokes[plan.strokes.length - 1];

  // A trainee starts at the beginning; the replay owns its separate cursor.
  const strokeStartP = () => 0;

  const forward = (target) => {
    const frame = seam.frameAt(activeStroke().tAt(desktop.p), _frame);
    return target
      .copy(frame.normal).negate()
      .addScaledVector(frame.travel, Math.tan(THREE.MathUtils.degToRad(desktop.travelAngle)))
      .addScaledVector(frame.lateral, Math.tan(THREE.MathUtils.degToRad(desktop.workAngle)))
      .normalize();
  };

  const tipFromDesktop = (target) => {
    const t = activeStroke().tAt(desktop.p);
    const frame = seam.frameAt(t, _frame);
    return seam
      .pointAt(t, target)
      .addScaledVector(frame.lateral, desktop.lateral)
      .addScaledVector(frame.normal, desktop.height);
  };

  return {
    id: applied ? definition.id : 'pipe',
    applied,
    viewOffset: definition?.viewOffset,
    title: applied ? `응용 · ${definition.label}` : '기초 · 파이프 원주 필릿',
    hint: applied ? `${definition.startLabel} 시작 · 왼손 그립으로 포지셔너 회전` : '하진 궤적 · 오버랩 · 마무리 편도 4회',
    group,
    picks,
    seam, guide, bead, session, poseGuide, demoPlayer,
    desktop, desktopTorch,
    vrTorch: buildWeldingGun(),
    usesBoard: true,
    supportsDemo: true,

    updateDesktop() {
      desktop.p = THREE.MathUtils.clamp(desktop.p, -0.12, 1.08);
      desktop.lateral = THREE.MathUtils.clamp(desktop.lateral, -0.02, 0.02);
      desktop.height = THREE.MathUtils.clamp(desktop.height, 0.0005, 0.05);
      desktop.travelAngle = THREE.MathUtils.clamp(desktop.travelAngle, -TILT_LIMIT, TILT_LIMIT);
      desktop.workAngle = THREE.MathUtils.clamp(desktop.workAngle, -TILT_LIMIT, TILT_LIMIT);

      forward(_f);
      poseTorchByTip(desktopTorch, tipFromDesktop(new THREE.Vector3()), _f);
    },

    tipLocal: tipFromDesktop,
    forwardLocal: forward,

    // A finished stroke hands the controls back to the start of the next one,
    // so W keeps meaning "forward" without hunting for six o'clock again.
    afterSample(m) {
      if (m.strokeIndex !== lastStrokeIndex) {
        lastStrokeIndex = m.strokeIndex;
        poseGuide?.reset();
        const continuous = m.stroke?.requireArcBreak === false && plan.current;
        desktop.p = continuous ? plan.current.progressOf(m.t) : strokeStartP();
        if (!continuous) desktop.lateral = activeStroke().lateralAt(0, seam.length);
      }
    },

    updateGuide(dt, m) {
      const weldedP = session.stats ? THREE.MathUtils.clamp(session.stats.maxP, 0, 1) : 1;
      guide.update(dt, {
        strokeIndex: m.strokeIndex,
        progressP: weldedP,
        cursorT: m.t,
        lateral: m.lateral,
        onSeam: m.onSeam,
        arcOn: m.welding,
        severity: m.welding ? m.severity : 0,
      });
    },

    contact(m, target) {
      const frame = seam.frameAt(m.t, _frame);
      return seam.pointAt(m.t, target).addScaledVector(frame.lateral, m.lateral);
    },

    depositArgs(m) {
      return {
        t: m.t,
        lateral: m.lateral,
        speedRatio: Math.abs(m.speedRatio),
        nominalSpeed: m.target?.speed,
        quality: m.quality,
        physics: m.physics, dir: m.stroke?.dir,
      };
    },

    hudArgs(m) {
      return { depth: m.arcErr, center: m.center, speed: m.welding ? m.speedFraction : 0.5 };
    },

    readout(m) {
      const stroke = activeStroke();
      return `${stroke.label ?? '파이프 필릿'} · 진행 ${Math.round((session.stats?.maxP ?? 0) * 100)}%` +
        ` · 아크길이 ${(m.height * 1000).toFixed(1)}mm` +
        ` · 속도 ${((m.strokeSpeed ?? 0) * 1000).toFixed(1)}mm/s` +
        ` · 작업각오차 ${((m.workAngleDeg ?? 0) - (m.target?.workAngle ?? 0)).toFixed(0)}°`;
    },

    updatePose(dt) {
      const poseStroke = plan.current;
      if (poseGuide) poseGuide.group.visible = poseGuide.path.visible = !!poseStroke;
      if (!poseStroke || !poseGuide) return;
      const p = THREE.MathUtils.clamp(session.stats?.maxP ?? 0, 0, 1);
      poseGuide.update(
        poseStroke.tAt(p), poseStroke.sample(p), poseStroke.dir,
        poseStroke.lateralAt(p, seam.length),
        (fraction) => {
          const ahead = Math.min(1, p + (fraction * 0.025) / (poseStroke.span * seam.length));
          return {
            t: poseStroke.tAt(ahead),
            lateral: poseStroke.lateralAt(ahead, seam.length),
            ...poseStroke.sample(ahead),
          };
        },
        dt
      );
    },

    resultHtml(r) {
      const rows = (r.strokes ?? []).map((s) =>
        `<div class="bar"><span>${s.label}</span><b>${s.coverage}%</b></div>
         <p class="hint">아크길이 ${s.arc}% · 중앙 ${s.center}% · 속도 ${s.speed}% ·
         작업각 ${s.work}% · 이음부 ${s.tieIn}% · 진행방향 ${s.direction}%</p>`
      ).join('');
      return `<h2>${applied ? definition.label : '파이프 필릿'} · ${r.total}점</h2>${rows}
        <div class="bar"><span>비드 적층률</span><b>${r.coverage}%</b></div>
        ${r.physics ? `<p class="hint">모델 지표(0~100): 용입 ${r.physics.penetration} · 흘러내림 ${r.physics.runoff} · 융합불량 ${r.physics.fusionRisk} · 슬래그 ${r.physics.slagRisk} — 실제 결함 판정 아님</p>` : ''}
        <p class="hint">아크 시간 ${r.arcTime.toFixed(1)}초 · R 키로 다시 시도</p>`;
    },

    reset() {
      session.reset();
      bead.reset();
      poseGuide?.reset();
      desktop.p = strokeStartP();
      desktop.lateral = activeStroke().lateralAt(0, seam.length);
      desktop.height = applied ? 0.002 : 0.0028;
      desktop.travelAngle = activeStroke().sample(0).travelAngle;
      desktop.workAngle = activeStroke().sample(0).workAngle;
      lastStrokeIndex = 0;
    },
  };
}

const visualFeatures = !new URLSearchParams(location.search).has('safe');

// Read up here rather than down with the controllers: the drawer needs it to
// label its sheet, and it is built long before any controller exists.
// Right physical controller welds; left physical controller handles the bench.
const WELDING_HAND = 'right';

const plateStation = buildPlateStation();
const pipeStation = buildPipeStation();
const appliedStations = fieldJointDefinitions(field.layout).map(buildPipeStation);
field.assembly.removeFromParent();
const stations = [plateStation, pipeStation, ...appliedStations];
const requestedExercise = new URLSearchParams(location.search).get('exercise');
let active = stations.find(station => station.id === requestedExercise) ??
  (requestedExercise === 'applied' || (!requestedExercise && location.pathname.endsWith('/application.html'))
    ? appliedStations[0] : !requestedExercise && location.pathname.endsWith('/pipe.html') ? pipeStation : plateStation);


const hud = new TorchHud(scene, { width: 0.1, offset: 0.075 });
const board = new StatsBoard(scene, {
  occluders: stations.flatMap(station => station.picks),
  follow: shop,
  width: 0.66,
  position: new THREE.Vector3(0.15, BENCH_HEIGHT + 0.70, BENCH_Z - 0.24),
});
const helmet = visualFeatures
  ? new HelmetView(scene, renderer, camera, controls, shop, new THREE.Vector3(0, 0.36, 0.30))
  : null;

const picker = new StationPicker(shop, stations);
const benchControls = new BasicBenchControls(shop, bench, {
  onStep: direction => {
    if (webDemo && !renderer.xr.isPresenting) webDemo.step(direction);
    else selectStation(stations[(stations.indexOf(active) + direction + stations.length) % stations.length]);
  },
});

// The control sheet lives in here rather than in the page overlay.
const drawer = new BenchDrawer(shop, {
  torchHand: WELDING_HAND === 'left' ? '왼손' : '오른손',
  freeHand: WELDING_HAND === 'left' ? '오른손' : '왼손',
});
let drawerHover = null;

// Master replay has a separate cursor and never drives the real torch.
let demo = false;
let welding = false;

function toggleDemo() {
  if (!active.supportsDemo) return;
  if (demo) {
    active.demoPlayer.stop();
    demo = false;
    if (renderer.xr.isPresenting)
      holdRod(!!torchController.userData.source?.gamepad?.buttons[1]?.pressed);
  }
  else demo = active.demoPlayer.start(renderer.xr.isPresenting ? active.vrTorch : null, scene);
  welding = false;
  benchControls.stop();
  active.session.lastT = null;
  active.session.speed = 0;
  for (const c of controllers) c.userData.trigger = false;
  syncTorchVisibility();
}

function syncTorchVisibility() {
  const web = !!webDemo && !renderer.xr.isPresenting;
  appliedRig.visible = !web && !!active.applied;
  for (const s of stations) {
    s.group.visible = !web && s === active;
    s.desktopTorch.visible = !web && s === active && !renderer.xr.isPresenting;
    s.vrTorch.visible = s === active && renderer.xr.isPresenting;
  }
}

// ---------------------------------------------------------------------------
// VR controllers
// ---------------------------------------------------------------------------
// Where the rod lies when nobody is holding it: on the bench, in front, near
// the drawer, so it is obvious what to pick up and where it went.
const ROD_REST_POS = new THREE.Vector3(-0.02, 0.012, 0.235);
const ROD_REST_ROT = new THREE.Euler(0, Math.PI * 0.08, Math.PI / 2);
let rodHeld = false;

/**
 * Put the rod in the hand, or back on the bench.
 *
 * Grip equips the CAD gun. The physical index trigger controls its arc.
 */
function holdRod(held) {
  rodHeld = held;
  if (!held) welding = false;
  const rod = active.vrTorch;
  if (held) {
    torchController.add(rod);
    rod.position.set(0, 0, 0);
    rod.quaternion.identity();
    torchController.userData.visuals.mountTool(rod);
  } else {
    updateGunTrigger(rod, 0, false, 0);
    shop.add(rod);
    rod.position.copy(ROD_REST_POS);
    rod.quaternion.setFromEuler(ROD_REST_ROT);
  }
  syncTorchVisibility();
}

const physicalInput = new PhysicalControllers(scene, renderer);
const controllers = physicalInput.controllers;
controllers.forEach((c) => {
  c.userData.trigger = false;
  c.userData.grip = false;
  c.userData.handedness = null;
  c.addEventListener('selectstart', () => {
    if (trainingUI.handleSelect(c)) return;
    if (demo) return;
    c.userData.trigger = c === torchController;
    // Pick from this frame's ray, not the previous frame's hover state.
    if (c !== torchController) {
      const aim = aimRay();
      if (!aim) return;
      shop.updateWorldMatrix(true, true);
      const hit = drawer.classify(aim.intersectObjects(drawer.picks, true)[0]?.object);
      if (hit) drawer.activate(hit);
      else {
        benchControls.activate(benchControls.pick(aim), welding || trainingUI.blocksManipulation,
          rodHeld || trainingUI.blocksManipulation);
      }
    }
  });
  c.addEventListener('selectend', () => {
    c.userData.trigger = false;
    c.userData.uiPressed = false;
  });
  c.addEventListener('squeezestart', () => {
    if (c.userData.source?.hand || !c.userData.source || demo || trainingUI.blocksManipulation) return;
    c.userData.grip = true;
    if (c === torchController) holdRod(true);
    else if (active.applied && !isArcOn()) positioner.begin(c);
  });
  c.addEventListener('squeezeend', () => {
    if (c.userData.source?.hand || demo) return;
    c.userData.grip = false;
    if (c === torchController) holdRod(false);
    else positioner.end(c);
  });
  c.addEventListener('connected', (event) => {
    c.userData.source = event.data;
    c.userData.handedness = event.data?.handedness ?? null;
    assignHands();
  });
  c.addEventListener('disconnected', () => {
    c.userData.source = null;
    c.userData.uiPressed = false;
    c.userData.handedness = null;
    c.userData.trigger = false;
    c.userData.grip = false;
    if (c === torchController) holdRod(false);
    assignHands();
  });
});

let torchController = controllers[0];
let gripController = controllers[1];

function assignHands() {
  torchController = physicalInput.right;
  gripController = physicalInput.left;
  holdRod(rodHeld);
}
assignHands();

// ---------------------------------------------------------------------------
// Switching
// ---------------------------------------------------------------------------
function selectStation(station) {
  if (webDemo && !renderer.xr.isPresenting) {
    if (station) webDemo.select(station.id);
    return;
  }
  if (!station || station === active || welding) return;
  // A replay belongs to the piece it was recorded on; carrying the flag across
  // would leave the other station with no torch and no way to get one back.
  if (demo) toggleDemo();
  positioner.end();
  benchControls.stop();
  for (const controller of controllers) controller.userData.trigger = false;
  // Keep the previous bead and progress while its workpiece is hidden.
  active.vrTorch.removeFromParent();
  active.desktopTorch.visible = false;
  drawer.reading = false;
  active.guide.setVisible(false);
  active.poseGuide?.setVisible(false);

  updateGunTrigger(active.desktopTorch, 0, false, 0);
  active = station;
  vrControls.applied = !!active.applied;
  vrControls.draw(false);
  active.session.lastT = null;
  active.session.speed = 0;
  active.guide.setVisible(true);
  active.poseGuide?.setVisible(true);
  holdRod(rodHeld);
  board.setVisible(true);
  board.configure(active.id === 'plate' ? 'plate' : 'pipe', active.session);
  board.reset();
  result.style.display = 'none';
  wasFinished = active.session.finished;
  if (wasFinished) showResult();
  if (overlayTask) overlayTask.textContent = `${active.title} — ${active.hint}`;
  focusStation();
}

function focusStation() {
  const startT = active.session.plan?.current?.tAt(0) ?? 0;
  const start = active.seam.pointAt(startT, new THREE.Vector3());
  if (helmet) {
    helmet.restoreCamera();
    helmet.workpiece = active.group;
    helmet.eyeOffset.copy(start).add(active.viewOffset ?? new THREE.Vector3(0, 0.25, 0.3));
  }
  if (renderer.xr.isPresenting) return;
  active.group.updateWorldMatrix(true, true);
  const target = active.group.localToWorld(start.clone());
  controls.target.copy(target);
  if (active.viewOffset) camera.position.copy(active.group.localToWorld(start.addScaledVector(active.viewOffset, 1.8)));
  else camera.position.copy(target).add(new THREE.Vector3(0.12, 0.4, 0.7));
  controls.update();
  if (helmet?.enabled) helmet.enterCamera();
}

function resetActive() {
  if (demo) toggleDemo();
  welding = false;
  active.reset();
  active.updateDesktop();
  if (active.usesBoard) board.reset();
  result.style.display = 'none';
  wasFinished = false;
}

// ---------------------------------------------------------------------------
// Desktop input
// ---------------------------------------------------------------------------
const keys = {};
window.addEventListener('keydown', (e) => {
  if (!renderer.xr.isPresenting) return;
  if (e.target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  keys[e.code] = true;
  if (e.code === 'KeyR') resetActive();
  if (e.code === 'KeyG' && !e.repeat) toggleDemo();
  if (e.code === 'Digit1') selectStation(plateStation);
  if (e.code === 'Digit2') selectStation(pipeStation);
  if (e.code === 'Digit3') selectStation(appliedStations[0]);
  if (e.code === 'Digit4') selectStation(appliedStations[1]);
  if (!e.repeat && ['KeyN', 'KeyP'].includes(e.code)) benchControls.onStep(e.code === 'KeyN' ? 1 : -1);
  if (e.code === 'KeyH' && active.applied && !isArcOn()) positioner.home();
  if (e.code === 'KeyF' && !e.repeat && !renderer.xr.isPresenting) focusStation();
  if (['Space', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => (keys[e.code] = false));
window.addEventListener('blur', () => {
  for (const code of Object.keys(keys)) keys[code] = false;
  holdRod(false);
  benchControls.stop();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) for (const code of Object.keys(keys)) keys[code] = false;
});

const pointerNdc = new THREE.Vector2();
let pointerInside = false;
renderer.domElement.addEventListener('pointermove', (e) => {
  pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerInside = true;
});
renderer.domElement.addEventListener('pointerleave', () => (pointerInside = false));

const vrControls = new VRControls(scene, renderer, shop, {
  weldingHand: WELDING_HAND,
  basicBench: true,
  applied: !!active.applied,
  onDemo: toggleDemo,
});
board.configure(active.id === 'plate' ? 'plate' : 'pipe', active.session);
const trainingUI = new TrainingUI({
  scene, renderer, camera, board, controllers, physicalInput, weldingHand: WELDING_HAND,
  helmet, vrControls, getDemo: () => demo, toggleDemo,
  supportsDemo: () => active.supportsDemo, reset: resetActive,
  getHeldTool: () => rodHeld && !demo ? active.vrTorch : null,
  getInteraction: () => ({ previous: '이전 과제', next: '다음 과제', lower: '테이블 낮추기', raise: '테이블 높이기' })[benchControls.hovered],
  getMode: () => active.applied ? 'applied' : 'basic',
  selectMode: mode => selectStation(mode === 'applied' ? appliedStations[0] : plateStation),
  getJointLabel: () => `${stations.indexOf(active) + 1}/${stations.length} · ${active.title}`,
  nextJoint: () => benchControls.onStep(1),
  positioner: { get readout() {
    const degrees = Math.round(THREE.MathUtils.radToDeg(positioner.pose.yaw - positioner.homeYaw));
    return `수평 회전 ${degrees}° · 상판 ${Math.round((shop.position.y + bench.position.y) * 100)} cm`;
  } },
  resetPositioner: () => { if (!isArcOn()) positioner.home(); },
  selectStation: id => selectStation(stations.find(s => s.id === id)),
  getTechnique: () => active.session.plan?.technique,
  setTechnique: value => {
    active.session.plan?.setTechnique?.(value);
    active.guide.refreshPaths();
    resetActive();
  },
});

const overlay = document.getElementById('overlay');
const overlayTask = document.getElementById('task');
const readout = document.getElementById('readout');
const result = document.getElementById('result');
if (overlayTask) overlayTask.textContent = `${active.title} — ${active.hint}`;
for (const button of document.querySelectorAll('[data-exercise]')) {
  button.addEventListener('click', () => selectStation(button.dataset.exercise === 'applied' ? appliedStations[0] : plateStation));
}

const initialDesktopId = active.id;
webDemo = new WebWeldingDemo(shop, stations, camera, controls, {
  onSelect: example => {
    active = example.source;
    benchControls.stop();
    board.configure(active.id === 'plate' ? 'plate' : 'pipe', active.session);
    board.reset();
    board.blockers = example.surfaces;
    appliedRig.visible = !!active.applied;
    for (const station of stations) station.group.visible = false;
  },
});
webDemo.select(initialDesktopId);
const desktopPanel = new DesktopPanel(webDemo, benchControls, board, {
  rotate: direction => { positioner.pose.yaw += direction * Math.PI / 36; positioner.apply(); },
  home: () => positioner.home(),
});
const vrBoardSettings = board.getSettings;
const vrBoardAction = board.onAction;
board.getSettings = () => {
  const settings = vrBoardSettings();
  if (renderer.xr.isPresenting) return settings;
  return { ...settings, ...webDemo.settings, demo: false,
    web: {
      title: active.title, mode: webDemo.mode, playing: webDemo.playing,
      stage: webDemo.active.strokes[webDemo.strokeIndex].label,
      progress: Math.round(webDemo.progress * 100), arc: webDemo.arcOn,
      speed: Number((webDemo.speed * 1000).toFixed(1)), seconds: Math.floor(webDemo.arcTime),
    },
    inputStatus: 'PC · N/P 과제 전환 · Page Up/Down 높이',
  };
};
board.onAction = action => {
  if (renderer.xr.isPresenting) return vrBoardAction(action);
  webDemo.releasePointer();
  if (action === 'guide') webDemo.setSetting('guides', !webDemo.settings.guides);
  if (action === 'ghost' || action === 'start' || action === 'hud') webDemo.setSetting(action, !webDemo.settings[action]);
  if (action === 'reset') webDemo.reset();
  if (action === 'plate' || action === 'pipe') webDemo.select(action);
  if (action === 'basic') webDemo.select('plate');
  if (action === 'applied') webDemo.select(appliedStations[0].id);
  if (action === 'next-joint') webDemo.step(1);
  if (action === 'positioner-home') positioner.home();
  if (action === 'demo') {
    webDemo.setMode('demo');
    if (webDemo.progress >= 1) webDemo.reset();
    webDemo.playing = !webDemo.playing;
  }
};
// Bench buttons consume clicks before orbiting or striking an arc.
const benchRay = new THREE.Raycaster();
const benchPointer = new THREE.Vector2();
let benchDown = null;
const pickBench = event => {
  const rect = renderer.domElement.getBoundingClientRect();
  benchPointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
  camera.updateWorldMatrix(true, false);
  benchControls.group.updateWorldMatrix(true, true);
  benchRay.setFromCamera(benchPointer, camera);
  return benchControls.pick(benchRay);
};
// WebWeldingDemo delegates before starting its own practice gesture.
webDemo.pickUI = event => {
  const action = pickBench(event);
  if (action) benchDown = { action, x: event.clientX, y: event.clientY };
  return action;
};
window.addEventListener('pointerup', event => {
  const down = benchDown; benchDown = null;
  if (renderer.xr.isPresenting || event.button !== 0 || !down || event.target !== renderer.domElement) return;
  if (Math.hypot(event.clientX - down.x, event.clientY - down.y) < 8 && pickBench(event) === down.action)
    benchControls.activate(down.action);
}, true);
window.addEventListener('blur', () => { benchDown = null; });
renderer.domElement.addEventListener('pointercancel', () => { benchDown = null; });
function setWebPresentation(web) {
  document.body.classList.toggle('web-showcase', web);
  controls.enabled = web;
  webDemo.root.visible = web;
  benchControls.group.visible = true;
  drawer.group.visible = !web;
  board.setVisible(!web || webDemo.settings.board); hud.setVisible(false);
  if (helmet) { helmet.keyboardEnabled = !web; helmet.filter.visible = !web && helmet.enabled; }
  if (web) {
    appliedRig.visible = !!webDemo.active.source.applied;
    for (const station of stations) {
      station.group.visible = station.desktopTorch.visible = station.vrTorch.visible = false;
    }
    result.style.display = 'none';
    webDemo.select(active.id);
  } else {
    webDemo.pause();
    if (desktopPanel.dialog.open) desktopPanel.dialog.close();
    vrControls.applied = !!active.applied;
    vrControls.draw(false);
    board.blockers = stations.flatMap(station => station.picks);
    board.configure(active.id === 'plate' ? 'plate' : 'pipe', active.session);
    board.reset();
  }
}

renderer.xr.addEventListener('sessionstart', () => {
  camera.clearViewOffset();
  for (const code of Object.keys(keys)) keys[code] = false;
  if (demo) toggleDemo();
  benchControls.stop();
  controls.enabled = false;
  overlay.style.display = 'none';
  syncTorchVisibility();
  setWebPresentation(false);
});
renderer.xr.addEventListener('sessionend', () => {
  if (demo) toggleDemo();
  benchControls.stop();
  positioner.end();
  holdRod(false);
  controls.enabled = false;
  overlay.style.display = 'block';
  syncTorchVisibility();
  setWebPresentation(true);
});

function isArcOn() {
  if (demo || positioner.held || positioner.moving) return false;
  if (!renderer.xr.isPresenting) return false;
  if (trainingUI.blocksArc(torchController)) return false;
  // Grip holds the gun; the controller's index trigger is the gun trigger.
  return torchController.visible
    && torchController.userData.handedness === WELDING_HAND
    && rodHeld
    && torchController.userData.physicalGripDown
    && torchController.userData.trigger;
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const _fwd = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _contact = new THREE.Vector3();
const _viewer = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _viewerQ = new THREE.Quaternion();
const _ray = new THREE.Raycaster();
_ray.far = 5;
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const clock = new THREE.Clock();

/** Aim the one pointer ray everything interactive is tested against. */
function aimRay() {
  if (renderer.xr.isPresenting) {
    const ray = gripController?.userData.ray;
    if (!gripController?.userData.tracked || !ray?.visible || !ray.userData.tracked) return null;
    ray.getWorldPosition(_rayOrigin);
    ray.getWorldQuaternion(_q);
    _rayDir.set(0, 0, -1).applyQuaternion(_q);
    _ray.set(_rayOrigin, _rayDir);
    return _ray;
  }
  if (!pointerInside) return null;
  _ray.setFromCamera(pointerNdc, camera);
  return _ray;
}
let readoutTimer = 0;
let wasFinished = false;

function tipLocal(target) {
  if (renderer.xr.isPresenting && rodHeld) {
    torchController.updateMatrixWorld(true);
    active.vrTorch.userData.tip.getWorldPosition(target);
    return active.group.worldToLocal(target);
  }
  active.desktopTorch.updateWorldMatrix(true, true);
  active.desktopTorch.userData.tip.getWorldPosition(target);
  return active.group.worldToLocal(target);
}

function forwardLocal(target) {
  if (renderer.xr.isPresenting && rodHeld) {
    active.vrTorch.userData.tip.getWorldQuaternion(_q);
    target.set(0, 0, -1).applyQuaternion(_q);
    active.group.getWorldQuaternion(_q).invert();
    return target.applyQuaternion(_q).normalize();
  }
  active.desktopTorch.userData.tip.getWorldQuaternion(_q);
  target.set(0, 0, -1).applyQuaternion(_q);
  active.group.getWorldQuaternion(_q).invert();
  return target.applyQuaternion(_q).normalize();
}

function readViewerPosition(xrFrame) {
  const referenceSpace = renderer.xr.getReferenceSpace();
  const pose = xrFrame && referenceSpace ? xrFrame.getViewerPose(referenceSpace) : null;
  if (pose) {
    const p = pose.transform.position;
    const o = pose.transform.orientation;
    _viewer.set(p.x, p.y, p.z);
    _viewerQ.set(o.x, o.y, o.z, o.w);
  } else {
    _viewer.copy(camera.position);
    _viewerQ.copy(camera.quaternion);
  }
}

function showResult() {
  const r = active.session.report(active.bead.getStats());
  if (active.usesBoard) board.showResult(r);
  result.innerHTML = active.resultHtml(r);
  result.style.display = 'block';
}

// Only the selected workpiece is rendered and sampled.
function animate(time, xrFrame) {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
  physicalInput.update(xrFrame, dt);
  if (!renderer.xr.isPresenting) {
    benchControls.update(dt, {
      keys: Object.fromEntries([...webDemo.keys].map(key => [key, true])), xr: false,
      blocked: webDemo.pressed, title: active.title,
    });
    webDemo.update(dt);
    desktopPanel.update();
    board.update(dt);
    renderer.render(scene, camera);
    window.weldReady = true;
    return;
  }

  if (renderer.xr.isPresenting) readViewerPosition(xrFrame);
  else { _viewer.copy(camera.position); _viewerQ.copy(camera.quaternion); }

  trainingUI.update(xrFrame);
  if (active.applied) positioner.update(dt, keys, {
    blocked: demo || trainingUI.blocksManipulation || welding ||
      (renderer.xr.isPresenting ? !!torchController.userData.trigger : false),
    xr: renderer.xr.isPresenting, controller: gripController,
  });
  for (const station of stations) {
    if (station !== active) station.bead.update(dt, { arcOn: false, point: _contact, t: 0, passive: true });
  }
  vrControls.update(_viewer, demo);
  if (demo) {
    active.demoPlayer.update(dt);
    board.demoStage = active.session.plan?.sequential
      ? active.session.plan.strokes[active.demoPlayer.index].label : null;
    active.guide.setVisible(false);
    hud.setVisible(false);
    active.bead.update(dt, { arcOn: false, point: _contact, t: 0 });
    board.update(dt);
    helmet?.update(false);
    if (!renderer.xr.isPresenting) controls.update();
    renderer.render(scene, camera);
    window.weldReady = true;
    return;
  }
  active.guide.setVisible(trainingUI.guides);
  active.poseGuide?.setVisible(trainingUI.guides);
  hud.setVisible(trainingUI.guides);
  if (renderer.xr.isPresenting && rodHeld)
    active.vrTorch.visible = !!torchController.userData.source && !torchController.userData.source.hand
      && torchController.userData.handedness === WELDING_HAND;

  // The drawer sits between the welder and the work, so it gets first refusal
  // on the ray; otherwise reaching for it would keep selecting the piece
  // behind it.
  const candidateAim = aimRay();
  const aim = board.settingsOpen || board.hit(candidateAim) ? null : candidateAim;
  const drawerHit = aim ? aim.intersectObjects(drawer.picks, true)[0]?.object ?? null : null;
  drawerHover = drawer.classify(drawerHit);
  benchControls.update(dt, {
    keys, xr: renderer.xr.isPresenting, controller: gripController,
    blocked: welding || positioner.held || trainingUI.blocksManipulation ||
      (renderer.xr.isPresenting ? rodHeld : false),
    switchBlocked: welding || trainingUI.blocksManipulation,
    title: `${stations.indexOf(active) + 1}/${stations.length} ${active.title}`, ray: drawerHover ? null : aim,
  });
  picker.update(dt, aim, active.id, !!drawerHover || !!benchControls.hovered);
  drawer.update(dt, _viewer, _viewerQ);

  tipLocal(_tip);
  forwardLocal(_fwd);
  // The displayed controller pose is already filtered; score that same pose.

  const arcOn = isArcOn() && !active.session.finished;
  const m = active.session.sample(dt, _tip, _fwd, arcOn);
  welding = m.welding;
  active.afterSample?.(m);

  active.updateGuide(dt, m);
  active.contact(m, _contact);
  if (m.welding) active.bead.deposit(dt, active.depositArgs(m));
  active.bead.update(dt, { arcOn: m.welding, point: _contact, t: m.t });

  active.group.localToWorld(_tip);
  hud.update(dt, { ...active.hudArgs(m), anchor: _tip, viewer: _viewer });

  if (active.usesBoard) {
    board.sample(dt, m);
    board.update(dt);
  }

  if (active.session.finished && !wasFinished) {
    wasFinished = true;
    showResult();
  } else if (!active.session.finished && wasFinished) {
    wasFinished = false;
  }

  readoutTimer += dt;
  if (readoutTimer > 0.1 && readout) {
    readoutTimer = 0;
    readout.textContent = active.readout(m) + (demo ? '  ·  [명장 궤적 재생 중]' : '');
  }

  if (trainingUI.guides) active.updatePose(dt);
  helmet?.update(m.welding);
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
  window.weldReady = true;
}

// Hidden exercises retain their progress for the next selection.
for (const station of stations) {
  station.updateDesktop();
  station.guide.setVisible(station === active && trainingUI.guides);
  station.poseGuide?.setVisible(station === active && trainingUI.guides);
}
board.setVisible(true);
syncTorchVisibility();
setWebPresentation(true);

await renderer.compileAsync(scene, camera);
document.body.appendChild(VRButton.createButton(renderer));
renderer.setAnimationLoop(animate);

if (new URLSearchParams(location.search).has('debug')) {
  window.weldDebug = {
    scene, camera, controls, renderer, shop, stations, picker, benchControls, hud, board, trainingUI, physicalInput, webDemo, desktopPanel,
    get active() { return active; },
    selectStation,
    resetActive,
    toggleDemo,
    drawer,
    get rodHeld() { return rodHeld; },
    get drawerHover() { return drawerHover; },
    get demo() { return demo; },
  };
}
