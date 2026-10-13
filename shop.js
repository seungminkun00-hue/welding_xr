import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { buildWorkshop, perforatedBench, plateFixtures } from './src/Workshop.js';
import { steelMaterialPBR } from './src/SteelTextures.js';
import { buildMigTorch, buildStickHolder, poseTorchByTip } from './src/Torches.js';
import { WorkpieceGrab } from './src/Stability.js';
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
import { pipeFilletPlan } from './src/PassPlan.js';
import { CurvedGuide } from './src/CurvedGuide.js';
import { JointSession } from './src/JointSession.js';
import { WeldBead, weldBeadOptions } from './src/WeldBead.js';
import { TorchHud } from './src/TorchHud.js';
import { StatsBoard } from './src/StatsBoard.js';

// ---------------------------------------------------------------------------
// One bench, both exercises.
//
// Previously the flat butt joint and the pipe fillet were separate pages, so
// changing task meant a page load -- which in a headset drops the XR session
// and makes you take the thing off and start again. Here both pieces sit on
// one bench and the free hand points at whichever one you want. Nothing
// reloads, so the session survives the switch.
//
// index.html and pipe.html still exist and still work; this is a third entry
// point, not a replacement, so a problem here cannot take the two working
// exercises down with it.
// ---------------------------------------------------------------------------

const BENCH_HEIGHT = 0.9;
const BENCH_Z = -0.46;

// Flat butt joint, same dimensions as index.html.
const PLATE_WIDTH = 0.13;
const PLATE_LENGTH = 0.34;
const PLATE_THICKNESS = 0.012;
const ROOT_GAP = 0.002;
const SEAM_LENGTH = 0.24;
const TORCH_LENGTH = 0.15;

// Pipe fillet, same dimensions as pipe.html.
const BLOCK = 0.17;
const PLATE_EXTENSION = 0.22;
const PIPE_PLATE_HEIGHT = BLOCK + PLATE_EXTENSION;
const PIPE_PLATE_CENTER_Y = -PLATE_EXTENSION / 2;
const PIPE_TABLE_TOP = PIPE_PLATE_CENTER_Y - PIPE_PLATE_HEIGHT / 2 - 0.002;
const PIPE_OUTER = 0.0335;
const PIPE_WALL = 0.004;
const PIPE_LENGTH = 0.085;

const TILT_SPEED = 40;
const TILT_LIMIT = 55;

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.cameraAutoUpdate = false;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(0.85);
renderer.xr.setFoveation(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d13);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0.1, 1.42, BENCH_Z + 0.78);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, BENCH_HEIGHT + 0.08, BENCH_Z);
controls.enableDamping = true;
controls.minDistance = 0.2;
controls.maxDistance = 3.0;
controls.update();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.HemisphereLight(0x9fc0e0, 0x14161c, 0.18));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.45);
keyLight.position.set(0.8, 2, 0.9);
scene.add(keyLight);
buildWorkshop(scene, renderer);

// ---------------------------------------------------------------------------
// The bench everything stands on
// ---------------------------------------------------------------------------
const shop = new THREE.Group();
shop.position.set(0, BENCH_HEIGHT, BENCH_Z);
scene.add(shop);

// Wide enough that the two pieces are a head-turn apart rather than touching.
perforatedBench(shop, { width: 1.18, depth: 0.62, top: -PLATE_THICKNESS, z: 0 });

// ---------------------------------------------------------------------------
// Station: flat butt joint (MIG, 1G)
// ---------------------------------------------------------------------------
function buildPlateStation() {
  const group = new THREE.Group();
  group.name = 'station-plate';
  group.position.set(-0.27, 0, 0);
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

  const desktopTorch = buildMigTorch(TORCH_LENGTH);
  poseGuide?.useTorch(desktopTorch);
  group.add(desktopTorch);

  const desktop = {
    travel: 0, lateral: 0,
    height: session.idealStandoff,
    travelAngle: session.idealTravelAngleDeg,
    workAngle: 0,
  };

  const TRAVEL_SPEED = 0.011, LATERAL_SPEED = 0.02, STANDOFF_SPEED = 0.02, BOOST = 6;
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
    title: '평판 맞대기',
    hint: 'MIG · 1G 기초연습',
    group, picks, seam, guide, bead, session, poseGuide,
    desktop, desktopTorch,
    vrTorch: buildMigTorch(TORCH_LENGTH),
    usesBoard: true,
    // The recorded master trajectory is available for the pipe exercise.
    supportsDemo: false,

    updateDesktop(dt, keys) {
      const boost = keys['ShiftLeft'] || keys['ShiftRight'] ? BOOST : 1;
      if (keys['KeyW']) desktop.travel += TRAVEL_SPEED * boost * dt;
      if (keys['KeyS']) desktop.travel -= TRAVEL_SPEED * boost * dt;
      if (keys['KeyD']) desktop.lateral += LATERAL_SPEED * dt;
      if (keys['KeyA']) desktop.lateral -= LATERAL_SPEED * dt;
      if (keys['KeyQ']) desktop.height += STANDOFF_SPEED * dt;
      if (keys['KeyE']) desktop.height -= STANDOFF_SPEED * dt;
      if (keys['ArrowUp']) desktop.travelAngle += TILT_SPEED * dt;
      if (keys['ArrowDown']) desktop.travelAngle -= TILT_SPEED * dt;
      if (keys['ArrowRight']) desktop.workAngle += TILT_SPEED * dt;
      if (keys['ArrowLeft']) desktop.workAngle -= TILT_SPEED * dt;

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
function buildPipeStation() {
  const group = new THREE.Group();
  group.name = 'station-pipe';
  // Lift it so the fixture's own table line lands on the bench top.
  group.position.set(0.3, -PIPE_TABLE_TOP, 0);
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

  const seam = pipeFilletSeam({
    center: new THREE.Vector3(0, 0, 0),
    wallNormal: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0),
    radius: PIPE_OUTER,
  });

  const plan = pipeFilletPlan(seam);
  const guide = new CurvedGuide(group, seam, plan, { zoneHalfWidth: 0.0055 });
  const bead = new WeldBead(group, seam, weldBeadOptions({ scale: 0.68, segments: 320 }));
  const session = new JointSession(seam, plan, {
    standoffTol: 0.0024, lateralTol: 0.0035, angleTol: 22, speedTol: 0.0018,
  });
  const poseGuide = new PoseGuide(group, seam);

  const desktopTorch = buildStickHolder();
  poseGuide?.useTorch(desktopTorch);
  const demoPlayer = new MasterDemo(seam, plan, poseGuide);
  group.add(desktopTorch);

  const desktop = { p: 0, lateral: 0, height: 0.0028, travelAngle: -10, workAngle: 0 };
  let lastStrokeIndex = 0;

  const TRAVEL_SPEED = 0.0030, LATERAL_SPEED = 0.008, STANDOFF_SPEED = 0.008, BOOST = 8;
  const _frame = { travel: new THREE.Vector3(), normal: new THREE.Vector3(), lateral: new THREE.Vector3() };
  const _f = new THREE.Vector3();

  const activeStroke = () => plan.current ?? plan.strokes[plan.strokes.length - 1];

  // A trainee starts at the beginning; the replay owns its separate cursor.
  const strokeStartP = () => 0;

  const forward = (target) => {
    const frame = seam.frameAt(activeStroke().tAt(desktop.p), _frame);
    return target
      .copy(frame.normal).negate()
      .applyAxisAngle(frame.lateral, THREE.MathUtils.degToRad(desktop.travelAngle))
      .applyAxisAngle(frame.travel, THREE.MathUtils.degToRad(desktop.workAngle))
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
    id: 'pipe',
    title: '파이프 원주 필릿',
    hint: '피복아크 · 2획 기초연습',
    group,
    picks: [pipe, rim, block],
    seam, guide, bead, session, poseGuide, demoPlayer,
    desktop, desktopTorch,
    vrTorch: buildStickHolder(),
    usesBoard: true,
    supportsDemo: true,

    updateDesktop(dt, keys) {
      const stroke = activeStroke();
      const strokeLength = stroke.span * seam.length;

      {
      const boost = keys['ShiftLeft'] || keys['ShiftRight'] ? BOOST : 1;
      const step = ((TRAVEL_SPEED * boost) / strokeLength) * dt;
      if (keys['KeyW']) desktop.p += step;
      if (keys['KeyS']) desktop.p -= step;
      if (keys['KeyD']) desktop.lateral += LATERAL_SPEED * dt;
      if (keys['KeyA']) desktop.lateral -= LATERAL_SPEED * dt;
      if (keys['KeyQ']) desktop.height += STANDOFF_SPEED * dt;
      if (keys['KeyE']) desktop.height -= STANDOFF_SPEED * dt;
      if (keys['ArrowUp']) desktop.travelAngle += TILT_SPEED * dt;
      if (keys['ArrowDown']) desktop.travelAngle -= TILT_SPEED * dt;
      if (keys['ArrowRight']) desktop.workAngle += TILT_SPEED * dt;
      if (keys['ArrowLeft']) desktop.workAngle -= TILT_SPEED * dt;
      }

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
        desktop.p = strokeStartP();
        desktop.lateral = 0;
      }
    },

    updateGuide(dt, m) {
      const weldedP = session.stats ? THREE.MathUtils.clamp(session.stats.maxP, 0, 1) : 1;
      guide.update(dt, {
        strokeIndex: m.strokeIndex,
        progressP: weldedP,
        cursorT: m.t,
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
        quality: m.quality,
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
        ` · 작업각오차 ${(m.workAngleDeg ?? 0).toFixed(0)}°`;
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
         작업각(45°) ${s.work}% · 이음부 ${s.tieIn}% · 진행방향 ${s.direction}%</p>`
      ).join('');
      return `<h2>파이프 필릿 · ${r.total}점</h2>${rows}
        <div class="bar"><span>비드 적층률</span><b>${r.coverage}%</b></div>
        <p class="hint">아크 시간 ${r.arcTime.toFixed(1)}초 · R 키로 다시 시도</p>`;
    },

    reset() {
      session.reset();
      bead.reset();
      poseGuide?.reset();
      desktop.p = strokeStartP();
      desktop.lateral = 0;
      desktop.height = 0.0028;
      desktop.travelAngle = -10;
      desktop.workAngle = 0;
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
const stations = [plateStation, pipeStation];
let active = plateStation;


const hud = new TorchHud(scene, { width: 0.1, offset: 0.075 });
const board = new StatsBoard(scene, {
  occluders: [...plateStation.picks, ...pipeStation.picks],
  follow: shop,
  width: 0.66,
  position: new THREE.Vector3(0.15, BENCH_HEIGHT + 0.70, BENCH_Z - 0.24),
});
const helmet = visualFeatures
  ? new HelmetView(scene, renderer, camera, controls, shop, new THREE.Vector3(0, 0.36, 0.30))
  : null;

const picker = new StationPicker(shop, stations);

// The control sheet lives in here rather than in the page overlay.
const drawer = new BenchDrawer(shop, {
  torchHand: WELDING_HAND === 'left' ? '왼손' : '오른손',
  freeHand: WELDING_HAND === 'left' ? '오른손' : '왼손',
});
let drawerHover = null;

// Master replay has a separate cursor and never drives the real torch.
let demo = false;

function toggleDemo() {
  if (!active.supportsDemo) return;
  if (demo) {
    active.demoPlayer.stop();
    demo = false;
    if (renderer.xr.isPresenting)
      holdRod(!!torchController.userData.source?.gamepad?.buttons[1]?.pressed);
  }
  else demo = active.demoPlayer.start(renderer.xr.isPresenting ? active.vrTorch : null, scene);
  benchDrag = null;
  active.session.lastT = null;
  active.session.speed = 0;
  for (const c of controllers) c.userData.trigger = false;
  syncTorchVisibility();
}

function syncTorchVisibility() {
  for (const s of stations) {
    s.desktopTorch.visible = s === active && !renderer.xr.isPresenting;
    s.vrTorch.visible = s === active && renderer.xr.isPresenting;
  }
}

// ---------------------------------------------------------------------------
// VR controllers
// ---------------------------------------------------------------------------
const gripMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.018, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0x47515f, metalness: 0.2, roughness: 0.8 })
);

// Where the rod lies when nobody is holding it: on the bench, in front, near
// the drawer, so it is obvious what to pick up and where it went.
const ROD_REST_POS = new THREE.Vector3(-0.02, 0.012, 0.235);
const ROD_REST_ROT = new THREE.Euler(0, Math.PI * 0.08, Math.PI / 2);
let rodHeld = false;

/**
 * Put the rod in the hand, or back on the bench.
 *
 * Splitting "hold" from "strike" is the point: on a real holder your hand is
 * already closed round it long before the arc goes, and making the trigger
 * alone strike meant you could weld with the rod nowhere near your grip.
 */
function holdRod(held) {
  rodHeld = held;
  const rod = active.vrTorch;
  if (held) {
    torchController.add(rod);
    rod.position.set(0, 0, 0);
    rod.quaternion.identity();
  } else {
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
        const station = picker.pick(aim);
        if (station) selectStation(station);
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
    // Welding hand: the lower button is your hand closing round the holder.
    // Free hand: it is still the bench drag it always was.
    if (c === torchController) holdRod(true);
    else startBenchDrag(c);
  });
  c.addEventListener('squeezeend', event => {
    if (c.userData.source?.hand || demo) return;
    c.userData.grip = false;
    if (c === torchController && !event.cancelled) holdRod(false);
    else endBenchDrag(c);
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
    endBenchDrag(c);
    assignHands();
  });
});

let torchController = controllers[0];
let gripController = controllers[1];

function assignHands() {
  torchController = physicalInput.right;
  gripController = physicalInput.left;
  gripController.add(gripMarker);
  holdRod(rodHeld);
}
assignHands();

let benchDrag = null;

function startBenchDrag(controller) {
  if (controller !== gripController || controller.userData.source?.hand || !controller.userData.source || demo || trainingUI.blocksManipulation || isArcOn()) return;
  if (!controller.userData.tracked) return;
  benchDrag = new WorkpieceGrab(controller, shop, 0.55, 1.35);
}
function endBenchDrag(controller) {
  if (benchDrag && benchDrag.controller === controller) benchDrag = null;
}
function updateBenchDrag(dt) {
  if (!benchDrag) return;
  if (isArcOn() || trainingUI.blocksManipulation || !benchDrag.update(dt)) benchDrag = null;
}

// ---------------------------------------------------------------------------
// Switching
// ---------------------------------------------------------------------------
function selectStation(station) {
  if (station === active) return;
  if (isArcOn()) return;
  // A replay belongs to the piece it was recorded on; carrying the flag across
  // would leave the other station with no torch and no way to get one back.
  if (demo) toggleDemo();
  // Leave the finished weld on the piece you walked away from. Coming back to
  // see your own bead is half the point of having both on one bench.
  active.vrTorch.removeFromParent();
  active.desktopTorch.visible = false;
  drawer.reading = false;
  active.guide.setVisible(false);
  active.poseGuide?.setVisible(false);

  active = station;
  active.guide.setVisible(true);
  active.poseGuide?.setVisible(true);
  holdRod(rodHeld);
  board.setVisible(true);
  board.configure(active.id, active.session);
  board.reset();
  result.style.display = 'none';
  wasFinished = active.session.finished;
  if (wasFinished) showResult();
  if (overlayTask) overlayTask.textContent = `${active.title} — ${active.hint}`;
}

function resetActive() {
  if (demo) toggleDemo();
  active.reset();
  if (active.usesBoard) board.reset();
  result.style.display = 'none';
  wasFinished = false;
}

// ---------------------------------------------------------------------------
// Desktop input
// ---------------------------------------------------------------------------
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR') resetActive();
  if (e.code === 'KeyG' && !e.repeat) toggleDemo();
  if (e.code === 'Digit1') selectStation(plateStation);
  if (e.code === 'Digit2') selectStation(pipeStation);
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => (keys[e.code] = false));

const pointerNdc = new THREE.Vector2();
let pointerInside = false;
renderer.domElement.addEventListener('pointermove', (e) => {
  pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerInside = true;
});
renderer.domElement.addEventListener('pointerleave', () => (pointerInside = false));
// A click that lands on the other piece switches to it; OrbitControls keeps
// everything else, so dragging to orbit never changes task by accident.
let dragged = false;
renderer.domElement.addEventListener('pointerdown', () => (dragged = false));
renderer.domElement.addEventListener('pointermove', () => (dragged = true), { passive: true });
renderer.domElement.addEventListener('pointerup', () => {
  if (dragged) return;
  if (drawerHover) drawer.activate(drawerHover);
  else if (picker.hovered) selectStation(picker.hovered);
});

const vrControls = new VRControls(scene, renderer, shop, {
  weldingHand: WELDING_HAND,
  onDemo: toggleDemo,
});
board.configure(active.id, active.session);
const trainingUI = new TrainingUI({
  scene, renderer, camera, board, controllers, physicalInput, weldingHand: WELDING_HAND,
  helmet, vrControls, getDemo: () => demo, toggleDemo,
  supportsDemo: () => active.supportsDemo, reset: resetActive,
  selectStation: id => selectStation(stations.find(s => s.id === id)),
});

const overlay = document.getElementById('overlay');
const overlayTask = document.getElementById('task');
const readout = document.getElementById('readout');
const result = document.getElementById('result');
if (overlayTask) overlayTask.textContent = `${active.title} — ${active.hint}`;

renderer.xr.addEventListener('sessionstart', () => {
  if (demo) toggleDemo();
  controls.enabled = false;
  overlay.style.display = 'none';
  syncTorchVisibility();
});
renderer.xr.addEventListener('sessionend', () => {
  if (demo) toggleDemo();
  holdRod(false);
  controls.enabled = true;
  overlay.style.display = 'block';
  syncTorchVisibility();
});

function isArcOn() {
  if (demo || trainingUI.blocksArc(torchController)) return false;
  if (!renderer.xr.isPresenting) return !!keys['Space'];
  // Both buttons: the lower one is holding the holder, the upper one strikes.
  return torchController.visible
    && torchController.userData.handedness === WELDING_HAND
    && rodHeld
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
  return active.tipLocal(target);
}

function forwardLocal(target) {
  if (renderer.xr.isPresenting && rodHeld) {
    active.vrTorch.userData.tip.getWorldQuaternion(_q);
    return target.set(0, 0, -1).applyQuaternion(_q);
  }
  return active.forwardLocal(target);
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

// Only the active station runs physics; the other keeps its finished bead on
// screen and costs nothing but its draw calls.
function animate(time, xrFrame) {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
  physicalInput.update(xrFrame, dt);

  if (renderer.xr.isPresenting) readViewerPosition(xrFrame);
  else { _viewer.copy(camera.position); _viewerQ.copy(camera.quaternion); }

  trainingUI.update(xrFrame);
  vrControls.update(_viewer, demo);
  gripMarker.visible = gripController.visible;
  if (demo) {
    active.demoPlayer.update(dt);
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
  updateBenchDrag(dt);

  // The drawer sits between the welder and the work, so it gets first refusal
  // on the ray; otherwise reaching for it would keep selecting the piece
  // behind it.
  const candidateAim = aimRay();
  const aim = board.settingsOpen || board.hit(candidateAim) ? null : candidateAim;
  const drawerHit = aim ? aim.intersectObjects(drawer.picks, true)[0]?.object ?? null : null;
  drawerHover = drawer.classify(drawerHit);
  picker.update(dt, aim, active.id, !!drawerHover);
  drawer.update(dt, _viewer, _viewerQ);

  if (!renderer.xr.isPresenting) active.updateDesktop(dt, keys);
  tipLocal(_tip);
  forwardLocal(_fwd);
  // The displayed controller pose is already filtered; score that same pose.

  const arcOn = isArcOn() && !active.session.finished;
  const m = active.session.sample(dt, _tip, _fwd, arcOn);
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

// The inactive station starts hidden-guided and torch-less.
pipeStation.guide.setVisible(false);
pipeStation.poseGuide?.setVisible(false);
board.setVisible(true);
syncTorchVisibility();

renderer.setAnimationLoop(animate);

if (new URLSearchParams(location.search).has('debug')) {
  window.weldDebug = {
    scene, camera, controls, renderer, shop, stations, picker, hud, board, trainingUI, physicalInput,
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
