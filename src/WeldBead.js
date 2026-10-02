import * as THREE from 'three';

// Five columns per ring is the minimum that gives the bead a crowned profile
// instead of a flat ribbon.
const SIDES = [-1, -0.5, 0, 0.5, 1];
const COLS = SIDES.length;

const RIPPLE_HZ = 7; // arc pulses per second; ripple spacing = travel speed / this
const HEAT_TAU = 1.1; // seconds for the glow to fall to 1/e

const BEAD_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aSide;
  attribute float aOffset;   // lateral drift of the bead from the seam, meters
  attribute float aFill;
  attribute float aWidth;
  attribute float aHeat;
  attribute float aQuality;
  attribute float aPhase;
  uniform vec3 uLateral;
  uniform vec3 uNormal;
  uniform float uHalfWidth;
  uniform float uHeight;
  varying float vFill;
  varying float vHeat;
  varying float vQuality;
  varying float vPhase;
  varying vec3 vNormalW;
  void main() {
    vFill = aFill;
    vHeat = aHeat;
    vQuality = aQuality;
    vPhase = aPhase;

    float crown = cos(aSide * 1.5707963);
    vec3 pos = aCenter
      + uLateral * (aOffset + aSide * uHalfWidth * aWidth)
      + uNormal * (uHeight * aFill * crown + 0.0004);

    // Analytic normal for the crowned profile: straight up at the centreline,
    // rolling off toward the toes.
    vNormalW = normalize(uNormal * (1.0 - abs(aSide) * 0.55) + uLateral * (aSide * 0.85));

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const BEAD_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uLightDir;
  uniform vec3 uGoodColor;
  uniform vec3 uBadColor;
  uniform vec3 uHotColor;
  varying float vFill;
  varying float vHeat;
  varying float vQuality;
  varying float vPhase;
  varying vec3 vNormalW;
  void main() {
    if (vFill < 0.02) discard;

    vec3 n = normalize(vNormalW);
    float lambert = max(dot(n, normalize(uLightDir)), 0.0);

    // Ripples: laid down at a fixed arc frequency, so travelling faster
    // stretches them out -- exactly the tell an instructor looks for.
    float ripple = 0.5 + 0.5 * sin(vPhase);

    vec3 base = mix(uBadColor, uGoodColor, clamp(vQuality, 0.0, 1.0));
    base *= 0.76 + 0.24 * ripple;

    vec3 col = base * (0.28 + 0.72 * lambert);
    col += uHotColor * pow(clamp(vHeat, 0.0, 1.0), 1.6) * 1.7;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const POOL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const POOL_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform float uArc;
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float flicker = 0.82 + 0.18 * sin(uTime * 47.0) * sin(uTime * 31.0);
    float core = pow(1.0 - clamp(r, 0.0, 1.0), 2.4);
    float halo = pow(1.0 - clamp(r, 0.0, 1.0), 0.8) * 0.35;
    float a = (core + halo) * uArc * flicker;
    if (a < 0.01) discard;
    vec3 col = mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.98, 0.9), core);
    gl_FragColor = vec4(col, a);
  }
`;

const _pt = new THREE.Vector3();

/**
 * The bead the trainee actually lays down.
 *
 * Deposition is driven by where the torch is and how it is being handled:
 * travelling slowly piles up a wide, tall, closely-rippled bead; running fast
 * leaves a thin stretched one; drifting off the seam drags the bead off with
 * it. That makes the finished weld, not just the live HUD, the feedback.
 */
export class WeldBead {
  constructor(parent, seam, options = {}) {
    this.parent = parent;
    this.seam = seam;
    this.time = 0;

    this.segments = options.segments ?? 160;
    this.halfWidth = options.halfWidth ?? 0.0062; // at nominal travel speed
    this.height = options.height ?? 0.0032;
    this.poolLength = options.poolLength ?? 0.007; // meters of molten puddle

    const count = (this.segments + 1) * COLS;
    this.count = count;

    const aCenter = new Float32Array(count * 3);
    const aSide = new Float32Array(count);
    this.aOffset = new Float32Array(count);
    this.aFill = new Float32Array(count);
    this.aWidth = new Float32Array(count);
    this.aHeat = new Float32Array(count);
    this.aQuality = new Float32Array(count);
    this.aPhase = new Float32Array(count);

    const indices = [];
    for (let i = 0; i <= this.segments; i++) {
      seam.pointAt(i / this.segments, _pt);
      for (let c = 0; c < COLS; c++) {
        const v = i * COLS + c;
        aCenter[v * 3] = _pt.x;
        aCenter[v * 3 + 1] = _pt.y;
        aCenter[v * 3 + 2] = _pt.z;
        aSide[v] = SIDES[c];
      }
      if (i < this.segments) {
        for (let c = 0; c < COLS - 1; c++) {
          const a = i * COLS + c;
          const b = a + 1;
          const d = (i + 1) * COLS + c;
          const e = d + 1;
          indices.push(a, d, b, b, d, e);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aCenter', new THREE.BufferAttribute(aCenter, 3));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    this.offsetAttr = new THREE.BufferAttribute(this.aOffset, 1);
    this.fillAttr = new THREE.BufferAttribute(this.aFill, 1);
    this.widthAttr = new THREE.BufferAttribute(this.aWidth, 1);
    this.heatAttr = new THREE.BufferAttribute(this.aHeat, 1);
    this.qualityAttr = new THREE.BufferAttribute(this.aQuality, 1);
    this.phaseAttr = new THREE.BufferAttribute(this.aPhase, 1);
    geometry.setAttribute('aOffset', this.offsetAttr);
    geometry.setAttribute('aFill', this.fillAttr);
    geometry.setAttribute('aWidth', this.widthAttr);
    geometry.setAttribute('aHeat', this.heatAttr);
    geometry.setAttribute('aQuality', this.qualityAttr);
    geometry.setAttribute('aPhase', this.phaseAttr);
    geometry.setIndex(indices);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uLateral: { value: seam.lateral.clone() },
        uNormal: { value: seam.normal.clone() },
        uHalfWidth: { value: this.halfWidth },
        uHeight: { value: this.height },
        uLightDir: { value: new THREE.Vector3(0.45, 1, 0.5).normalize() },
        uGoodColor: { value: new THREE.Color(0xc3c9d2) },
        uBadColor: { value: new THREE.Color(0x4a4036) },
        uHotColor: { value: new THREE.Color(0xff6a12) },
      },
      vertexShader: BEAD_VERT,
      fragmentShader: BEAD_FRAG,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);

    this._buildPool();
    this._buildSparks(options.sparkCount ?? 160);

    this.filledSegments = 0;
    this.anyHeat = false;
  }

  /**
   * Lay down metal around the cursor.
   *
   * @param {number} dt seconds
   * @param {object} m
   * @param {number} m.t          cursor position along the seam, 0..1
   * @param {number} m.lateral    torch offset across the seam, meters
   * @param {number} m.speedRatio actual travel speed / ideal travel speed
   * @param {number} m.quality    0..1, how well the torch is being handled
   */
  deposit(dt, m) {
    // Deposition per unit length goes as 1/speed: crawl and it piles up, race
    // and it starves.
    const ratio = Math.max(m.speedRatio, 0.12);
    const widthScale = THREE.MathUtils.clamp(Math.pow(1 / ratio, 0.5), 0.42, 1.85);
    const phase = this.time * Math.PI * 2 * RIPPLE_HZ;

    const halfT = this.poolLength / this.seam.length;
    const lo = Math.max(0, Math.floor((m.t - halfT) * this.segments));
    const hi = Math.min(this.segments, Math.ceil((m.t + halfT * 0.35) * this.segments));
    if (hi < lo) return;

    const blend = 1 - Math.exp(-dt * 14);

    for (let i = lo; i <= hi; i++) {
      for (let c = 0; c < COLS; c++) {
        const v = i * COLS + c;
        this.aFill[v] = THREE.MathUtils.lerp(this.aFill[v], 1, blend);
        this.aWidth[v] = THREE.MathUtils.lerp(this.aWidth[v] || widthScale, widthScale, blend);
        this.aOffset[v] = THREE.MathUtils.lerp(this.aOffset[v], m.lateral, blend);
        this.aQuality[v] = THREE.MathUtils.lerp(
          this.aQuality[v] || m.quality,
          m.quality,
          blend
        );
        this.aHeat[v] = 1;
        if (this.aPhase[v] === 0) this.aPhase[v] = phase;
      }
    }

    this.filledSegments = Math.max(this.filledSegments, hi);
    this.anyHeat = true;
    this._emitSparks(m, dt);
  }

  /** @param {{arcOn:boolean, point:THREE.Vector3}} s point is in parent-local space */
  update(dt, s) {
    this.time += dt;

    if (this.anyHeat) {
      const decay = Math.exp(-dt / HEAT_TAU);
      let remaining = false;
      for (let v = 0; v < this.count; v++) {
        if (this.aHeat[v] > 0.002) {
          this.aHeat[v] *= decay;
          remaining = true;
        } else {
          this.aHeat[v] = 0;
        }
      }
      this.anyHeat = remaining;
      this.heatAttr.needsUpdate = true;
    }

    this.fillAttr.needsUpdate = true;
    this.widthAttr.needsUpdate = true;
    this.offsetAttr.needsUpdate = true;
    this.qualityAttr.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;

    const arc = s.arcOn ? 1 : 0;
    this.poolArc = THREE.MathUtils.lerp(this.poolArc ?? 0, arc, 1 - Math.exp(-dt * 18));
    this.pool.position.copy(s.point).addScaledVector(this.seam.normal, 0.0022);
    this.pool.material.uniforms.uTime.value = this.time;
    this.pool.material.uniforms.uArc.value = this.poolArc;
    this.light.position.copy(s.point).addScaledVector(this.seam.normal, 0.02);
    this.light.intensity = this.poolArc * 0.05;

    this._updateSparks(dt);
  }

  reset() {
    this.aOffset.fill(0);
    this.aFill.fill(0);
    this.aWidth.fill(0);
    this.aHeat.fill(0);
    this.aQuality.fill(0);
    this.aPhase.fill(0);
    this.offsetAttr.needsUpdate = true;
    this.fillAttr.needsUpdate = true;
    this.widthAttr.needsUpdate = true;
    this.heatAttr.needsUpdate = true;
    this.qualityAttr.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.filledSegments = 0;
    this.anyHeat = false;
    this.sparkLife.fill(0);
  }

  /** Coverage and mean quality over the part of the seam that got welded. */
  getStats() {
    let covered = 0;
    let qualitySum = 0;
    for (let i = 0; i <= this.segments; i++) {
      const v = i * COLS + 2; // centre column
      if (this.aFill[v] > 0.5) {
        covered++;
        qualitySum += this.aQuality[v];
      }
    }
    return {
      coverage: covered / (this.segments + 1),
      quality: covered ? qualitySum / covered : 0,
    };
  }

  dispose() {
    for (const obj of [this.mesh, this.pool, this.sparks]) {
      obj.geometry.dispose();
      obj.material.dispose();
      this.parent.remove(obj);
    }
    this.parent.remove(this.light);
  }

  // -- internals -------------------------------------------------------

  _buildPool() {
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uArc: { value: 0 } },
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.02), material);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.seam.normal);
    mesh.frustumCulled = false;
    this.parent.add(mesh);
    this.pool = mesh;
    this.poolArc = 0;

    // Kept deliberately tight: the arc should pool light around the puddle,
    // not floodlight the whole plate.
    this.light = new THREE.PointLight(0xffa94d, 0, 0.3, 2);
    this.parent.add(this.light);
  }

  _buildSparks(count) {
    this.sparkCount = count;
    this.sparkPos = new Float32Array(count * 3);
    this.sparkVel = new Float32Array(count * 3);
    this.sparkLife = new Float32Array(count);
    this.sparkCursor = 0;
    this.sparkEmitAcc = 0;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkAlpha = new Float32Array(count);
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.sparkAlpha, 1));

    const material = new THREE.ShaderMaterial({
      // uSize is a spark diameter already multiplied by the usual
      // viewportHeight / (2 tan(fov/2)) factor, so point size falls off with
      // distance. The clamp keeps a spark from ballooning when the headset is
      // right on top of the puddle.
      uniforms: { uSize: { value: 1.4 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        uniform float uSize;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(uSize / max(-mv.z, 0.05), 1.0, 9.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float a = (1.0 - smoothstep(0.1, 0.5, r)) * vAlpha;
          gl_FragColor = vec4(mix(vec3(1.0, 0.5, 0.1), vec3(1.0, 1.0, 0.85), vAlpha), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.sparks = new THREE.Points(geometry, material);
    this.sparks.frustumCulled = false;
    this.parent.add(this.sparks);
  }

  _emitSparks(m, dt) {
    // Spatter scales with how badly the torch is being held -- a clean weld is
    // a quiet one.
    const rate = 40 + (1 - m.quality) * 180;
    this.sparkEmitAcc += rate * dt;
    const n = Math.floor(this.sparkEmitAcc);
    this.sparkEmitAcc -= n;

    this.seam.pointAt(m.t, _pt).addScaledVector(this.seam.lateral, m.lateral);
    for (let k = 0; k < n; k++) {
      const i = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % this.sparkCount;
      this.sparkPos[i * 3] = _pt.x;
      this.sparkPos[i * 3 + 1] = _pt.y;
      this.sparkPos[i * 3 + 2] = _pt.z;

      const speed = 0.25 + Math.random() * 0.75;
      const theta = Math.random() * Math.PI * 2;
      const lift = 0.35 + Math.random() * 0.8;
      const dir = new THREE.Vector3()
        .addScaledVector(this.seam.lateral, Math.cos(theta))
        .addScaledVector(this.seam.travel, Math.sin(theta))
        .addScaledVector(this.seam.normal, lift)
        .normalize()
        .multiplyScalar(speed);
      this.sparkVel[i * 3] = dir.x;
      this.sparkVel[i * 3 + 1] = dir.y;
      this.sparkVel[i * 3 + 2] = dir.z;
      this.sparkLife[i] = 0.3 + Math.random() * 0.45;
    }
  }

  _updateSparks(dt) {
    let alive = false;
    for (let i = 0; i < this.sparkCount; i++) {
      if (this.sparkLife[i] <= 0) {
        this.sparkAlpha[i] = 0;
        continue;
      }
      alive = true;
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 9.81 * 0.45 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      this.sparkAlpha[i] = Math.max(0, Math.min(1, this.sparkLife[i] * 2.2));
    }
    if (alive) {
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparks.geometry.attributes.aAlpha.needsUpdate = true;
    }
  }
}
