import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Scratch vectors reused across calls to avoid per-frame GC pressure.
// ---------------------------------------------------------------------------
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _widthDir = new THREE.Vector3();
const _toTip = new THREE.Vector3();
const _radialOut = new THREE.Vector3();
const _idealDir = new THREE.Vector3();
const _fwdN = new THREE.Vector3();
const _curvePoint = new THREE.Vector3();
const _dockPoint = new THREE.Vector3();

/**
 * An analytic 180-degree (or arbitrary-sweep) arc of a circle, parameterized
 * like a THREE.Curve so it drops into TubeGeometry / getTangent / etc.
 * phi = 0 is defined as "12 o'clock" (along `up`), increasing phi sweeps
 * clockwise toward `right` ("3 o'clock" at phi = PI/2).
 */
export class CircleArcCurve extends THREE.Curve {
  constructor(center, radius, right, up, phiStart, phiEnd) {
    super();
    this.center = center.clone();
    this.radius = radius;
    this.right = right.clone().normalize();
    this.up = up.clone().normalize();
    this.normal = new THREE.Vector3().crossVectors(this.right, this.up).normalize();
    this.phiStart = phiStart;
    this.phiEnd = phiEnd;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const phi = THREE.MathUtils.lerp(this.phiStart, this.phiEnd, t);
    return target
      .copy(this.center)
      .addScaledVector(this.right, this.radius * Math.sin(phi))
      .addScaledVector(this.up, this.radius * Math.cos(phi));
  }
}

/** Ternary-search projection of `point` onto `curve`, returning the closest t in [0,1]. */
function projectPointToCurveT(curve, point, coarseSamples = 48, refineIters = 10) {
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= coarseSamples; i++) {
    const t = i / coarseSamples;
    curve.getPoint(t, _p1);
    const d = _p1.distanceToSquared(point);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  let lo = Math.max(0, bestT - 1 / coarseSamples);
  let hi = Math.min(1, bestT + 1 / coarseSamples);
  for (let i = 0; i < refineIters; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const d1 = curve.getPoint(m1, _p1).distanceToSquared(point);
    const d2 = curve.getPoint(m2, _p2).distanceToSquared(point);
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
const RIBBON_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aWidthDir;
  attribute float aSide;
  attribute float aProgress;
  uniform float uHalfWidth;
  uniform float uWidthScale;
  varying float vProgress;
  varying float vSide;
  void main() {
    vProgress = aProgress;
    vSide = aSide;
    vec3 pos = aCenter + aWidthDir * aSide * uHalfWidth * uWidthScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const RIBBON_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uChevronCount;
  uniform float uGlow;
  uniform float uActive;
  uniform vec3 uColor;
  varying float vProgress;
  varying float vSide;
  void main() {
    float av = clamp(abs(vSide), 0.0, 1.0);
    float u = fract(vProgress * uChevronCount - uTime * uFlowSpeed);

    // Explicit ">" chevron: the bright peak sits forward (large u) at the
    // ribbon's centerline and trails backward (smaller u) toward the edges,
    // so each repeat reads as an arrowhead pointing in the flow direction.
    float peak = 0.62 - av * 0.52;
    float d = abs(u - peak);
    float arm = smoothstep(0.1, 0.0, d);

    float edgeFade = pow(clamp(1.0 - av, 0.0, 1.0), 0.7);
    float tip = smoothstep(0.22, 0.0, av) * smoothstep(0.08, 0.0, d) * 0.7;
    float base = 0.07 * edgeFade;

    float intensity = base + (arm * edgeFade + tip) * uGlow;
    float alpha = clamp(intensity, 0.0, 1.0) * uActive;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(uColor * (0.65 + arm * 1.4 + tip), alpha);
  }
`;

const DOCK_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOCK_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform float uDwellProgress;
  uniform float uState; // 0 = scanning, 1 = locked
  uniform float uFlash;
  uniform vec3 uColor;
  uniform vec3 uLockColor;
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    vec3 col = mix(uColor, uLockColor, uState);

    float rings = fract(r * 3.0 - uTime * 1.4);
    float ringBand = smoothstep(0.0, 0.06, rings) * smoothstep(0.22, 0.06, rings);
    float ringAlpha = ringBand * (1.0 - uState) * 0.8;

    float ang = atan(vUv.y, vUv.x);
    float angN = (ang + 3.14159265) / 6.2831853;
    float dwellFill = step(angN, uDwellProgress) * smoothstep(1.0, 0.75, r) * 0.9;

    float core = smoothstep(1.0, 0.0, r) * (0.22 + 0.5 * uState);
    float flash = uFlash * smoothstep(1.0, 0.0, r) * 1.5;

    float alpha = clamp(ringAlpha + dwellFill + core + flash, 0.0, 1.0);
    gl_FragColor = vec4(col * (1.0 + flash), alpha);
  }
`;

// ---------------------------------------------------------------------------
// WeldingGuideManager
// ---------------------------------------------------------------------------
/**
 * Drives a calligraphy/rhythm-game style weld guide: two half-pass ribbons
 * (flowing neon chevrons), a pacemaker lead arrow, a lift&reset transition
 * arc, and a pulse/dwell tie-in docking ring.
 *
 * All geometry is built directly in `parent`'s local space (parent is
 * expected to carry translation only, no rotation/scale) so world-space
 * torch readings only need a worldToLocal() position transform, never a
 * direction transform.
 */
export class WeldingGuideManager {
  constructor(parent, options) {
    this.parent = parent;
    this.center = options.center.clone();
    this.radius = options.radius;
    this.right = options.right.clone().normalize();
    this.up = options.up.clone().normalize();
    this.normal = new THREE.Vector3().crossVectors(this.right, this.up).normalize();

    this.idealStandoff = options.idealStandoff ?? 0.012;
    this.idealTiltDeg = options.idealTiltDeg ?? 45;
    this.standoffTolerance = options.standoffTolerance ?? 0.006;
    this.tiltToleranceDeg = options.tiltToleranceDeg ?? 20;
    this.expertPassDuration = options.expertPassDuration ?? 6.0; // seconds, master's pace per half-pass
    this.leadCapT = options.leadCapT ?? 0.12; // pacemaker never leads user by more than this (0..1)
    this.captureRadius = options.captureRadius ?? 0.012;
    this.dockDwellTime = options.dockDwellTime ?? 1.2;
    this.liftThreshold = options.liftThreshold ?? 0.035;
    this.completionT = options.completionT ?? 0.96;

    this.onPhaseComplete = options.onPhaseComplete ?? null; // (phaseIndex) => void
    this.onWeldComplete = options.onWeldComplete ?? null; // () => void

    this.phase1Curve =
      options.phase1Curve ??
      new CircleArcCurve(this.center, this.radius, this.right, this.up, Math.PI, Math.PI * 2);
    this.phase2Curve =
      options.phase2Curve ??
      new CircleArcCurve(this.center, this.radius, this.right, this.up, Math.PI, 0);

    this.state = 'IDLE';
    this.time = 0;
    this.userT = 0;
    this.pacemakerT = 0;
    this.pacemakerTarget = 0;
    this.dwellTimer = 0;
    this.flashTimer = 0;
    this.lastErr = { standoffErr: 0, tiltErrDeg: 0, severity: 0 };

    this.ribbon1 = this._makeRibbonFromCurve(this.phase1Curve, 48, 0.0028, 0x35ff7a);
    this.ribbon2 = this._makeRibbonFromCurve(this.phase2Curve, 48, 0.0028, 0x35ff7a);

    const start1 = this.phase1Curve.getPoint(1, new THREE.Vector3());
    const start2 = this.phase2Curve.getPoint(0, new THREE.Vector3());
    const mid = start1
      .clone()
      .add(start2)
      .multiplyScalar(0.5)
      .addScaledVector(this.normal, this.radius * 0.9);
    this.transitionCurve = new THREE.QuadraticBezierCurve3(start1, mid, start2);
    this.transitionArc = this._makeRibbonFromCurve(this.transitionCurve, 32, 0.0018, 0x4fd7ff);
    this.transitionArc.material.uniforms.uChevronCount.value = 5;
    this.transitionArc.material.uniforms.uFlowSpeed.value = 0.9;

    this._buildPacemaker();
    this._buildDockRing();

    this.ribbon1.visible = false;
    this.ribbon2.visible = false;
    this.transitionArc.visible = false;
  }

  start() {
    this.state = 'PHASE1_ACTIVE';
    this.time = 0;
    this.userT = 0;
    this.pacemakerT = 0;
    this.pacemakerTarget = 0;
    this.dwellTimer = 0;

    this.ribbon1.visible = true;
    this.ribbon1.material.uniforms.uActive.value = 1;
    this.ribbon2.visible = true;
    this.ribbon2.material.uniforms.uActive.value = 0;
    this.transitionArc.visible = false;
    this.dockRing.visible = false;
    this.pacemaker.visible = true;
  }

  getStatusText() {
    switch (this.state) {
      case 'IDLE':
        return '대기 중';
      case 'PHASE1_ACTIVE':
        return `1구간 · 6시→12시 (좌측)  진행 ${Math.round(this.userT * 100)}%`;
      case 'TRANSITION_TO_DOCK':
        return '토치를 떼고 반대편 6시로 이동하세요';
      case 'DOCKING':
        return `이음매 도킹 중... 유지 ${Math.round((this.dwellTimer / this.dockDwellTime) * 100)}%`;
      case 'PHASE2_ACTIVE':
        return `2구간 · 6시→12시 (우측)  진행 ${Math.round(this.userT * 100)}%`;
      case 'COMPLETE':
        return '용접 완료';
      default:
        return '';
    }
  }

  /** @param {number} dt seconds @param {THREE.Vector3} tipLocal @param {THREE.Vector3} fwdLocal unit vector */
  update(dt, tipLocal, fwdLocal) {
    this._tick(dt);
    switch (this.state) {
      case 'PHASE1_ACTIVE':
        this._updateActivePhase(dt, tipLocal, fwdLocal, this.phase1Curve, this.ribbon1, () =>
          this._enterTransition()
        );
        break;
      case 'TRANSITION_TO_DOCK':
        this._updateTransition(tipLocal);
        break;
      case 'DOCKING':
        this._updateDocking(dt, tipLocal);
        break;
      case 'PHASE2_ACTIVE':
        this._updateActivePhase(dt, tipLocal, fwdLocal, this.phase2Curve, this.ribbon2, () =>
          this._complete()
        );
        break;
      default:
        break;
    }
  }

  dispose() {
    for (const mesh of [this.ribbon1, this.ribbon2, this.transitionArc, this.dockRing]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.parent.remove(mesh);
    }
    this.parent.remove(this.pacemaker);
  }

  // -- internals -------------------------------------------------------

  _tick(dt) {
    this.time += dt;
    this.ribbon1.material.uniforms.uTime.value = this.time;
    this.ribbon2.material.uniforms.uTime.value = this.time;
    this.transitionArc.material.uniforms.uTime.value = this.time;
    this.dockRing.material.uniforms.uTime.value = this.time;

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      this.dockRing.material.uniforms.uFlash.value = this.flashTimer / 0.6;
      if (this.flashTimer === 0) this.dockRing.visible = false;
    }
  }

  _computeError(tip, fwd, curvePoint) {
    _toTip.subVectors(tip, curvePoint);
    const standoff = _toTip.dot(this.normal);
    const standoffAbs = Math.abs(standoff);
    const standoffErr = Math.abs(standoffAbs - this.idealStandoff);

    _radialOut.subVectors(curvePoint, this.center).normalize();
    const tiltRad = THREE.MathUtils.degToRad(this.idealTiltDeg);
    _idealDir
      .copy(this.normal)
      .multiplyScalar(-Math.cos(tiltRad))
      .addScaledVector(_radialOut, -Math.sin(tiltRad))
      .normalize();

    _fwdN.copy(fwd).normalize();
    const dot = THREE.MathUtils.clamp(_fwdN.dot(_idealDir), -1, 1);
    const tiltErrDeg = THREE.MathUtils.radToDeg(Math.acos(dot));

    const standoffNorm = THREE.MathUtils.clamp(standoffErr / this.standoffTolerance, 0, 1);
    const tiltNorm = THREE.MathUtils.clamp(tiltErrDeg / this.tiltToleranceDeg, 0, 1);
    const severity = Math.max(standoffNorm, tiltNorm);

    return { standoff, standoffAbs, standoffErr, tiltErrDeg, severity };
  }

  _applyErrorToRibbon(ribbon, err) {
    const u = ribbon.material.uniforms;
    u.uWidthScale.value = THREE.MathUtils.lerp(u.uWidthScale.value, 1 + err.severity * 0.7, 0.2);
    u.uGlow.value = THREE.MathUtils.lerp(u.uGlow.value, THREE.MathUtils.lerp(0.9, 1.7, err.severity), 0.2);
    const target = new THREE.Color(0x35ff7a).lerp(new THREE.Color(0xff9933), err.severity);
    u.uColor.value.lerp(target, 0.15);
  }

  _updateActivePhase(dt, tip, fwd, curve, ribbon, onComplete) {
    const t = projectPointToCurveT(curve, tip);
    this.userT = t;

    this.pacemakerTarget = Math.min(1, this.pacemakerTarget + dt / this.expertPassDuration);
    this.pacemakerT = Math.max(t, Math.min(this.pacemakerTarget, t + this.leadCapT));
    this._placePacemaker(curve, this.pacemakerT);

    curve.getPoint(t, _curvePoint);
    const err = this._computeError(tip, fwd, _curvePoint);
    this.lastErr = err;
    this._applyErrorToRibbon(ribbon, err);

    if (t >= this.completionT && err.standoffAbs > this.liftThreshold) {
      onComplete();
    }
  }

  _enterTransition() {
    this.state = 'TRANSITION_TO_DOCK';
    this.ribbon1.material.uniforms.uActive.value = 0.35;
    this.pacemaker.visible = false;
    this.transitionArc.visible = true;
    this.transitionArc.material.uniforms.uActive.value = 1;
    this.dockRing.visible = true;
    this.dockRing.material.uniforms.uState.value = 0;
    this.dockRing.material.uniforms.uDwellProgress.value = 0;
    this.dwellTimer = 0;
    this.onPhaseComplete?.(1);
  }

  _updateTransition(tip) {
    this.phase2Curve.getPoint(0, _dockPoint);
    const d = tip.distanceTo(_dockPoint);
    if (d <= this.captureRadius) {
      this.state = 'DOCKING';
      this.dwellTimer = 0;
    }
  }

  _updateDocking(dt, tip) {
    this.phase2Curve.getPoint(0, _dockPoint);
    const d = tip.distanceTo(_dockPoint);
    if (d <= this.captureRadius) {
      this.dwellTimer += dt;
      this.dockRing.material.uniforms.uDwellProgress.value = Math.min(1, this.dwellTimer / this.dockDwellTime);
      if (this.dwellTimer >= this.dockDwellTime) {
        this._lockOnAndStartPhase2();
      }
    } else {
      this.dwellTimer = Math.max(0, this.dwellTimer - dt * 2);
      this.dockRing.material.uniforms.uDwellProgress.value = Math.min(1, this.dwellTimer / this.dockDwellTime);
      if (d > this.captureRadius * 2.5) this.state = 'TRANSITION_TO_DOCK';
    }
  }

  _lockOnAndStartPhase2() {
    this.dockRing.material.uniforms.uState.value = 1;
    this.flashTimer = 0.6;
    this.transitionArc.visible = false;
    this.ribbon2.material.uniforms.uActive.value = 1;
    this.pacemaker.visible = true;
    this.pacemakerTarget = 0;
    this.pacemakerT = 0;
    this.state = 'PHASE2_ACTIVE';
  }

  _complete() {
    this.state = 'COMPLETE';
    this.pacemaker.visible = false;
    this.onWeldComplete?.();
  }

  _placePacemaker(curve, t) {
    curve.getPoint(t, _p1);
    curve.getTangent(t, _tan);
    this.pacemaker.position.copy(_p1).addScaledVector(this.normal, 0.005);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _tan);
    this.pacemaker.quaternion.copy(q);
    const pulse = 1 + 0.14 * Math.sin(this.time * 7.0); // rhythmic "heartbeat" scale
    this.pacemaker.scale.set(pulse, pulse, 1);
  }

  /** Flat dart/chevron silhouette, tip at +Y -- an unambiguous arrow from any near-frontal angle. */
  static _buildArrowShape() {
    const s = new THREE.Shape();
    s.moveTo(0, 0.023);
    s.lineTo(0.0115, 0.004);
    s.lineTo(0.0048, 0.004);
    s.lineTo(0.0048, -0.015);
    s.lineTo(-0.0048, -0.015);
    s.lineTo(-0.0048, 0.004);
    s.lineTo(-0.0115, 0.004);
    s.lineTo(0, 0.023);
    return s;
  }

  /** Tapered comet-tail triangle trailing behind the arrow's tail edge. */
  static _buildTailGeometry() {
    const verts = new Float32Array([-0.0048, -0.015, 0, 0.0048, -0.015, 0, 0.0, -0.048, 0]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geom.setIndex([0, 1, 2]);
    return geom;
  }

  _buildPacemaker() {
    const group = new THREE.Group();
    const arrowGeom = new THREE.ShapeGeometry(WeldingGuideManager._buildArrowShape());

    const glow = new THREE.Mesh(
      arrowGeom,
      new THREE.MeshBasicMaterial({
        color: 0x4fd7ff,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      })
    );
    glow.scale.set(2.0, 1.8, 1);
    group.add(glow);

    const core = new THREE.Mesh(
      arrowGeom,
      new THREE.MeshBasicMaterial({
        color: 0xeafaff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      })
    );
    group.add(core);

    const tail = new THREE.Mesh(
      WeldingGuideManager._buildTailGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x4fd7ff,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      })
    );
    group.add(tail);

    group.frustumCulled = false;
    group.visible = false;
    this.parent.add(group);
    this.pacemaker = group;
  }

  _buildDockRing() {
    const visR = this.captureRadius * 2.4;
    const geom = new THREE.PlaneGeometry(visR * 2, visR * 2, 1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDwellProgress: { value: 0 },
        uState: { value: 0 },
        uFlash: { value: 0 },
        uColor: { value: new THREE.Color(0x4fd7ff) },
        uLockColor: { value: new THREE.Color(0x35ff7a) },
      },
      vertexShader: DOCK_VERT,
      fragmentShader: DOCK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.normal);
    mesh.quaternion.copy(q);
    mesh.position.copy(this.phase2Curve.getPoint(0, new THREE.Vector3()));
    mesh.visible = false;
    this.parent.add(mesh);
    this.dockRing = mesh;
  }

  _makeRibbonFromCurve(curve, segments, halfWidth, colorHex) {
    const count = (segments + 1) * 2;
    const aCenter = new Float32Array(count * 3);
    const aWidthDir = new Float32Array(count * 3);
    const aSide = new Float32Array(count);
    const aProgress = new Float32Array(count);
    const indices = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      curve.getPoint(t, _p1);
      curve.getTangent(t, _tan);
      _widthDir.crossVectors(_tan, this.normal).normalize();

      for (let s = 0; s < 2; s++) {
        const idx = i * 2 + s;
        const sign = s === 0 ? -1 : 1;
        aCenter[idx * 3] = _p1.x;
        aCenter[idx * 3 + 1] = _p1.y;
        aCenter[idx * 3 + 2] = _p1.z;
        aWidthDir[idx * 3] = _widthDir.x;
        aWidthDir[idx * 3 + 1] = _widthDir.y;
        aWidthDir[idx * 3 + 2] = _widthDir.z;
        aSide[idx] = sign;
        aProgress[idx] = t;
      }
      if (i < segments) {
        const a = i * 2;
        const b = i * 2 + 1;
        const c = (i + 1) * 2;
        const d = (i + 1) * 2 + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('aCenter', new THREE.BufferAttribute(aCenter, 3));
    geometry.setAttribute('aWidthDir', new THREE.BufferAttribute(aWidthDir, 3));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    geometry.setAttribute('aProgress', new THREE.BufferAttribute(aProgress, 1));
    geometry.setIndex(indices);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFlowSpeed: { value: 0.75 },
        uChevronCount: { value: 7 },
        uHalfWidth: { value: halfWidth },
        uWidthScale: { value: 1 },
        uGlow: { value: 1.0 },
        uActive: { value: 0 },
        uColor: { value: new THREE.Color(colorHex) },
      },
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.parent.add(mesh);
    return mesh;
  }
}
