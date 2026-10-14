import * as THREE from 'three';

// A fixed surface grid retains the entire weave, including both edge dwells.
// Moving one five-vertex crown sideways used to erase the previous stroke.
const SIDES = Array.from({ length: 25 }, (_, i) => i / 12 - 1);
const COLS = SIDES.length;
const GRID_SPAN = 2.6;

// These tile constants must match tools/blender/bake_bead_maps.py, which sculpts one
// tile of bead and bakes it. RIPPLES_PER_TILE is how far the phase has to run
// to cross the texture once; BEAD_SPAN_RATIO is the bead's share of the strip,
// the rest being the parent metal the toes wet out onto.
const RIPPLES_PER_TILE = 8;
const BEAD_SPAN_RATIO = 4.0 / 6.0;
const HEAT_TAU = 1.1; // seconds for the glow to fall to 1/e

// One finish for every exercise; only its physical size changes with the joint.
export function weldBeadOptions({ scale = 1, segments = 320 } = {}) {
  return { segments, halfWidth: 0.0062 * scale, height: 0.0032 * scale,
    poolLength: 0.007 * scale, tintHalfWidth: 0.0062 * 3.4 * scale };
}

const BEAD_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aSide;
  attribute float aOffset;   // deposition centre for local surface detail, meters
  attribute float aFill;
  attribute float aWidth;
  attribute float aHeat;
  attribute float aQuality;
  attribute float aPhase;
  attribute vec2 aSlope;
  attribute float aDefect;
  attribute vec3 aLateral;
  attribute vec3 aNormal;
  uniform float uHalfWidth;
  uniform float uHeight;
  uniform float uRipplesPerTile;
  uniform float uSpanRatio;
  varying float vFill;
  varying float vHeat;
  varying float vQuality;
  varying float vPhase;
  varying float vSide;
  varying vec2 vBeadUv;
  varying vec3 vNormalW;
  varying vec3 vLateralW;
  varying vec3 vTravelW;
  varying vec3 vPosW;
  varying float vDefect;
  void main() {
    vDefect = aDefect;
    vFill = aFill;
    vHeat = aHeat;
    vQuality = aQuality;
    vPhase = aPhase;
    vSide = clamp((aSide - aOffset / uHalfWidth) / max(aWidth, 0.1), -1.5, 1.5);
    vec3 travel = normalize(cross(aNormal, aLateral));
    vec3 pos = aCenter + aNormal * (uHeight * aFill + 0.00025);
    // Central differences of deposited height give a smooth, actual crown.
    vec3 normal = normalize(aNormal - aLateral * aSlope.x - travel * aSlope.y);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vLateralW = normalize(mat3(modelMatrix) * aLateral);
    vTravelW = normalize(cross(vNormalW, vLateralW));

    // Phase is frozen into the metal from the measured two-dimensional path.
    vBeadUv = vec2(
      0.5 + clamp(vSide, -1.0, 1.0) * 0.5 * uSpanRatio,
      aPhase / (6.2831853 * uRipplesPerTile)
    );

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const BEAD_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uLightDir;
  uniform vec3 uGoodColor;
  uniform vec3 uBadColor;
  uniform vec3 uHotColor;
  uniform sampler2D uBeadNormal;
  uniform sampler2D uBeadAO;
  uniform float uHasMaps;
  varying float vFill;
  varying float vHeat;
  varying float vQuality;
  varying float vPhase;
  varying float vSide;
  varying vec2 vBeadUv;
  varying vec3 vNormalW;
  varying vec3 vLateralW;
  varying vec3 vTravelW;
  varying vec3 vPosW;
  varying float vDefect;

  // Oxide-film interference, the colours a weld cools through.
  vec3 tempTint(float t) {
    vec3 straw  = vec3(0.72, 0.56, 0.26);
    vec3 copper = vec3(0.58, 0.33, 0.21);
    vec3 violet = vec3(0.34, 0.26, 0.44);
    vec3 blue   = vec3(0.22, 0.34, 0.52);
    vec3 c = mix(straw, copper, smoothstep(0.0, 0.35, t));
    c = mix(c, violet, smoothstep(0.35, 0.68, t));
    c = mix(c, blue, smoothstep(0.68, 1.0, t));
    return c;
  }

  void main() {
    if (vFill < 0.02) discard;

    // The mesh supplies the crown and weave. Maps only add fine surface marks;
    // they no longer impose an identical row of large dimes on every weld.
    float detail = 1.0 - smoothstep(0.6, 2.5, fwidth(vPhase));
    float ripple = 0.5 + 0.5 * cos(vPhase) * detail;
    vec3 n = normalize(vNormalW + vTravelW * sin(vPhase) * 0.13 * detail);
    float ao = 0.86 + 0.14 * ripple;
    if (uHasMaps > 0.5) {
      vec3 nt = texture2D(uBeadNormal, vBeadUv).xyz * 2.0 - 1.0;
      n = normalize(n + (vLateralW * nt.x + vTravelW * nt.y) * 0.12 * detail);
      ao *= mix(1.0, texture2D(uBeadAO, vBeadUv).r, 0.18 * detail);
    }

    vec3 view = normalize(cameraPosition - vPosW);
    float lambert = max(dot(n, normalize(uLightDir)), 0.0);

    // Stand-in for an environment probe: shop lamps overhead, dark floor below.
    float sky = n.y * 0.5 + 0.5;
    vec3 env = mix(vec3(0.09, 0.10, 0.12), vec3(0.58, 0.64, 0.73), sky * sky);

    vec3 base = mix(uBadColor, uGoodColor, clamp(vQuality, 0.0, 1.0));
    base *= 0.88 + 0.12 * ripple;
    // Irregular dark patches indicate the training model's slag/fusion risk;
    // they are deliberately not rendered as hydrogen cracks.
    float slagMask = smoothstep(0.40, 0.78, 0.5 + 0.5 * sin(vPhase * 0.7 + vSide * 9.0));
    base = mix(base, vec3(0.10, 0.085, 0.065), slagMask * vDefect * 0.8);
    base = mix(base, base * tempTint(abs(vSide)) * 2.1, 0.14);

    vec3 col = base * (0.42 + 0.70 * lambert) + base * env * 1.55;
    col *= 0.45 + 0.55 * ao;

    vec3 half0 = normalize(normalize(uLightDir) + view);
    float spec = pow(max(dot(n, half0), 0.0), 26.0);
    col += vec3(0.78, 0.81, 0.86) * spec * (0.45 + ripple * 0.55) * ao;

    col += uHotColor * pow(clamp(vHeat, 0.0, 1.0), 1.6) * 1.7;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const HAZ_SIDES = [-1, -0.78, -0.58, -0.4, -0.24, 0, 0.24, 0.4, 0.58, 0.78, 1];
const HAZ_COLS = HAZ_SIDES.length;

const HAZ_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aLateral;
  attribute vec3 aNormal;
  attribute float aSide;
  attribute float aFill;
  uniform float uHalfWidth;
  varying float vSide;
  varying float vFill;
  varying float vAlong;
  void main() {
    vSide = aSide;
    vFill = aFill;
    vAlong = aCenter.x * 91.0 + aCenter.z * 73.0;
    // aCenter is already projected to the actual parent-metal surface.
    vec3 pos = aCenter + aNormal * 0.00018;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const HAZ_FRAG = /* glsl */ `
  precision mediump float;
  varying float vSide;
  varying float vFill;
  varying float vAlong;

  // Same interference ramp as the bead. On the parent metal it is the whole
  // story: the rainbow band beside the weld is the most recognisable thing
  // about a finished pipe joint, and without it the plate just looks clean.
  vec3 tempTint(float t) {
    vec3 straw  = vec3(0.78, 0.60, 0.27);
    vec3 copper = vec3(0.62, 0.34, 0.22);
    vec3 violet = vec3(0.36, 0.27, 0.47);
    vec3 blue   = vec3(0.23, 0.36, 0.55);
    vec3 c = mix(straw, copper, smoothstep(0.0, 0.35, t));
    c = mix(c, violet, smoothstep(0.35, 0.68, t));
    c = mix(c, blue, smoothstep(0.68, 1.0, t));
    return c;
  }

  void main() {
    if (vFill < 0.05) discard;
    float d = abs(vSide);

    // The band starts where the bead's own toe ends and dies out as the parent
    // metal gets far enough away to never have reached tinting temperature.
    float inner = smoothstep(0.22, 0.34, d);
    float outer = 1.0 - smoothstep(0.62, 1.0, d);
    float band = inner * outer;
    if (band < 0.01) discard;

    // A real tint band wanders; a perfectly parallel one reads as a decal.
    float wobble = 0.86 + 0.14 * sin(vAlong) * sin(vAlong * 0.37);

    float t = clamp((d - 0.26) / 0.62, 0.0, 1.0);
    gl_FragColor = vec4(tempTint(t), band * wobble * vFill * 0.82);
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
  uniform vec2 uGravity;
  uniform float uRunoff;
  varying vec2 vUv;

  // Cheap hash so the sputter is irregular rather than a clean sine.
  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float r = length(vUv);
    float moltenR = length(vUv - uGravity * uRunoff * 0.35);
    if (min(r, moltenR) > 1.0) discard;
    float d = 1.0 - clamp(r, 0.0, 1.0);

    // Arcs are never steady. Two beat frequencies plus a coarse sputter that
    // occasionally drops the column almost out, the way short-circuit transfer
    // actually behaves.
    float beat = 0.80 + 0.20 * sin(uTime * 47.0) * sin(uTime * 31.0);
    float sputter = mix(0.55, 1.0, hash(floor(uTime * 38.0)));
    float flicker = beat * mix(1.0, sputter, 0.55);

    // Molten steel, wide and warm.
    float pool = pow(max(0.0, 1.0 - moltenR), 1.5) * 0.9;
    vec3 col = vec3(1.25, 0.42, 0.06) * pool;

    // Violet corona: the part that makes a welding photo look like welding.
    float corona = pow(d, 5.0);
    col += vec3(0.85, 0.72, 1.70) * corona * 1.5;

    // The plasma column. Deliberately far above 1.0 so tone mapping blows it
    // out to white with a coloured fringe, which is what the eye expects from
    // something this much brighter than the room.
    float core = pow(d, 22.0);
    col += vec3(5.0, 5.6, 7.4) * core * 2.4;

    float a = clamp((pool * 0.75 + corona * 0.8 + core * 2.0) * uArc * flicker, 0.0, 1.0);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col * flicker, a);
  }
`;

const _pt = new THREE.Vector3();
const _unitZ = new THREE.Vector3(0, 0, 1);
const _frame = {
  travel: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  lateral: new THREE.Vector3(),
};

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
    options = { ...weldBeadOptions(), ...options,
      tintHalfWidth: options.tintHalfWidth ?? (options.halfWidth ?? 0.0062) * 3.4 };
    this.parent = parent;
    this.seam = seam;
    this.time = 0;
    this.visualDetails = true;

    this.segments = options.segments ?? 320;
    this.halfWidth = options.halfWidth ?? 0.0062; // at nominal travel speed
    this.height = options.height ?? 0.0032;
    this.poolLength = options.poolLength ?? 0.007; // meters of molten puddle
    this.gravityEnabled = !!options.gravity;
    this.gravity = new THREE.Vector3(0, -1, 0);
    this.gravityRotation = new THREE.Quaternion();
    this.poolGravity = new THREE.Vector3();
    this.poolNormal = new THREE.Vector3();
    this.runoff = 0;
    this.gridHalfWidth = this.halfWidth * GRID_SPAN;
    this.rowSpacing = seam.length / this.segments;
    this.colSpacing = this.gridHalfWidth * 2 / (COLS - 1);
    this.lastDeposit = null;
    this.pathPhase = 0;
    this.hotRows = new Set();
    this.changedRows = new Set();
    this.normalRows = new Set();
    this.flowCells = new Set();

    const count = (this.segments + 1) * COLS;
    this.count = count;

    const aCenter = new Float32Array(count * 3);
    // The cross-section frame is per vertex, not per mesh: on a curved seam
    // every ring of the bead is extruded along a different pair of axes.
    const aLateral = new Float32Array(count * 3);
    const aNormal = new Float32Array(count * 3);
    const plus = new THREE.Vector3(), minus = new THREE.Vector3();
    const surface = new THREE.Vector3(), lateral = new THREE.Vector3(), normal = new THREE.Vector3();
    const aSide = new Float32Array(count);
    this.aOffset = new Float32Array(count);
    this.aFill = new Float32Array(count);
    this.aWidth = new Float32Array(count);
    this.aHeat = new Float32Array(count);
    this.aQuality = new Float32Array(count);
    this.aPhase = new Float32Array(count);
    this.aSlope = new Float32Array(count * 2);
    this.aDefect = new Float32Array(count);
    this.flowFields = ['Fill', 'Heat', 'Quality', 'Phase', 'Offset', 'Width', 'Defect'];
    this.flow = Object.fromEntries(this.flowFields.map(key => [key, new Float32Array(count)]));

    const indices = [];
    for (let i = 0; i <= this.segments; i++) {
      const t = i / this.segments;
      seam.pointAt(t, _pt);
      const frame = seam.frameAt(t, _frame);
      for (let c = 0; c < COLS; c++) {
        const v = i * COLS + c;
        const across = SIDES[c] * this.gridHalfWidth;
        if (seam.surfacePoint) {
          seam.surfacePoint(t, across, surface);
          seam.surfacePoint(t, across + 0.0001, plus);
          seam.surfacePoint(t, across - 0.0001, minus);
          lateral.subVectors(plus, minus).normalize();
          normal.crossVectors(lateral, frame.travel).normalize();
        } else {
          surface.copy(_pt).addScaledVector(frame.lateral, across);
          lateral.copy(frame.lateral); normal.copy(frame.normal);
        }
        surface.toArray(aCenter, v * 3);
        lateral.toArray(aLateral, v * 3);
        normal.toArray(aNormal, v * 3);
        aSide[v] = SIDES[c] * GRID_SPAN;
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
    geometry.setAttribute('aLateral', new THREE.BufferAttribute(aLateral, 3));
    geometry.setAttribute('aNormal', new THREE.BufferAttribute(aNormal, 3));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    this.offsetAttr = new THREE.BufferAttribute(this.aOffset, 1);
    this.fillAttr = new THREE.BufferAttribute(this.aFill, 1);
    this.widthAttr = new THREE.BufferAttribute(this.aWidth, 1);
    this.heatAttr = new THREE.BufferAttribute(this.aHeat, 1);
    this.qualityAttr = new THREE.BufferAttribute(this.aQuality, 1);
    this.phaseAttr = new THREE.BufferAttribute(this.aPhase, 1);
    this.slopeAttr = new THREE.BufferAttribute(this.aSlope, 2);
    this.defectAttr = new THREE.BufferAttribute(this.aDefect, 1);
    geometry.setAttribute('aSlope', this.slopeAttr);
    geometry.setAttribute('aDefect', this.defectAttr);
    geometry.setAttribute('aOffset', this.offsetAttr);
    geometry.setAttribute('aFill', this.fillAttr);
    geometry.setAttribute('aWidth', this.widthAttr);
    geometry.setAttribute('aHeat', this.heatAttr);
    geometry.setAttribute('aQuality', this.qualityAttr);
    geometry.setAttribute('aPhase', this.phaseAttr);
    for (const key of this.flowFields) {
      const attr = geometry.attributes['a' + key];
      attr.setUsage(THREE.DynamicDrawUsage);
    }
    this.slopeAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setIndex(indices);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uHalfWidth: { value: this.halfWidth },
        uHeight: { value: this.height },
        uLightDir: { value: new THREE.Vector3(0.45, 1, 0.5).normalize() },
        uGoodColor: { value: new THREE.Color(0xb6bcc4) },
        uBadColor: { value: new THREE.Color(0x6e6153) },
        uHotColor: { value: new THREE.Color(0xff6a12) },
        uRipplesPerTile: { value: RIPPLES_PER_TILE },
        uSpanRatio: { value: BEAD_SPAN_RATIO },
        uBeadNormal: { value: null },
        uBeadAO: { value: null },
        uHasMaps: { value: 0 },
      },
      vertexShader: BEAD_VERT,
      fragmentShader: BEAD_FRAG,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this._loadBeadMaps(material);

    this._buildPool(options);
    this._buildHeatTint(options);
    this._buildSparks(options.sparkCount ?? 80);
    this.spatter = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
      // Spatter has already cooled by the time it is sitting on the plate, so
      // it stays dull. The glowing part of the story belongs to the sparks.
      new THREE.MeshStandardMaterial({ color: 0x3a342c, metalness: 0.55, roughness: 0.82 }), 400);
    this.spatter.count = 0;
    this.spatter.frustumCulled = false;
    parent.add(this.spatter);
    this.spatterDummy = new THREE.Object3D();
    this.spatterAcc = 0;

    this.filledSegments = 0;
    this.anyHeat = false;
    this.mesh.visible = this.heatTint.visible = this.pool.visible = this.sparks.visible = false;
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
    if (!(dt > 0) || !Number.isFinite(m.t) || !Number.isFinite(m.lateral)) return;
    dt = Math.min(dt, 0.05);
    this.mesh.visible = this.heatTint.visible = true;
    this.runoff = m.physics?.runoff ?? 0;
    this.poolT = m.t;
    const previous = this.lastDeposit;
    let deltaT = previous ? m.t - previous.t : 0;
    if (this.seam.closed) deltaT -= Math.round(deltaT);
    let along = deltaT * this.seam.length;
    let across = previous ? m.lateral - previous.lateral : 0;
    let distance = Math.hypot(along, across);
    // Do not connect separated arcs or a tracking teleport with a metal bridge.
    if (distance > 0.03) { deltaT = along = across = distance = 0; }
    const dirAlong = distance > 0.00005 ? along / distance : previous?.dirAlong ?? m.dir ?? 1;
    const dirAcross = distance > 0.00005 ? across / distance : previous?.dirAcross ?? 0;
    const phaseStep = distance / (this.halfWidth * 0.65) * Math.PI * 2;
    const steps = Math.min(12, Math.max(1, Math.ceil(distance / (this.colSpacing * 0.6))));
    const width = THREE.MathUtils.clamp(Math.pow(1 / Math.max(m.speedRatio ?? 1, 0.12), 0.22), 0.6, 1.4);
    const feed = (m.nominalSpeed ?? 0.01) / this.poolLength * 1.3;
    for (let step = 1; step <= steps; step++) {
      const fraction = step / steps;
      this._stamp(dt / steps, m.t - deltaT * (1 - fraction), m.lateral - across * (1 - fraction),
        dirAlong, dirAcross, this.pathPhase + phaseStep * fraction, width, feed, m);
    }
    this.pathPhase += phaseStep;
    this.lastDeposit = { t: m.t, lateral: m.lateral, dirAlong, dirAcross };
    this.anyHeat = true;
    this._emitSparks(m, dt);
    this.spatterAcc += this.visualDetails ? dt * (2 + (1 - m.quality) * 22) : 0;
    while (this.spatterAcc >= 1) {
      this.spatterAcc--;
      const frame = this.seam.frameAt(m.t, _frame);
      this.seam.pointAt(m.t, this.spatterDummy.position)
        .addScaledVector(frame.lateral, m.lateral + (Math.random() < 0.5 ? -1 : 1) * this.halfWidth * (1.1 + Math.random() * 1.5))
        .addScaledVector(frame.travel, (Math.random() - 0.5) * 0.012)
        .addScaledVector(frame.normal, 0.0004);
      if (this.seam.surfacePoint) {
        const side = (Math.random() < 0.5 ? -1 : 1) * this.halfWidth * (1.1 + Math.random());
        this.seam.surfacePoint(m.t, side, this.spatterDummy.position).addScaledVector(frame.normal, 0.00025);
      }
      const size = 0.00018 + Math.random() * 0.00042;
      this.spatterDummy.scale.set(size, size, size);
      this.spatterDummy.updateMatrix();
      const index = this.spatterCursor ?? 0;
      this.spatter.setMatrixAt(index, this.spatterDummy.matrix);
      this.spatterCursor = (index + 1) % 400;
      this.spatter.count = Math.min(400, this.spatter.count + 1);
      this.spatter.instanceMatrix.needsUpdate = true;
    }
  }

  _stamp(dt, t, lateral, dirAlong, dirAcross, phase, width, feed, m) {
    const radius = this.halfWidth * width;
    const length = this.poolLength * 0.65;
    const reach = Math.max(radius, length);
    const lo = Math.floor((t - reach / this.seam.length) * this.segments);
    const hi = Math.ceil((t + reach / this.seam.length) * this.segments);
    const left = Math.max(0, Math.floor((lateral - reach + this.gridHalfWidth) / this.colSpacing));
    const right = Math.min(COLS - 1, Math.ceil((lateral + reach + this.gridHalfWidth) / this.colSpacing));
    const defect = m.physics ? Math.max(m.physics.slagRisk, m.physics.fusionRisk) : 0;
    for (let row = lo; row <= hi; row++) {
      const i = this.seam.closed ? THREE.MathUtils.euclideanModulo(row, this.segments) : row;
      if (i < 0 || i > this.segments) continue;
      const ds = (row / this.segments - t) * this.seam.length;
      let touched = false;
      for (let c = left; c <= right; c++) {
        const dx = c * this.colSpacing - this.gridHalfWidth - lateral;
        const forward = ds * dirAlong + dx * dirAcross;
        const sideways = dx * dirAlong - ds * dirAcross;
        const r2 = (forward / length) ** 2 + (sideways / radius) ** 2;
        if (r2 >= 1) continue;
        const v = i * COLS + c;
        const cellPhase = phase + forward / (this.halfWidth * 0.65) * Math.PI * 2
          - Math.abs(sideways / radius) * 2.8;
        const profile = (1 - r2) ** 0.7;
        const ridge = 0.9 + 0.1 * Math.cos(cellPhase);
        const added = dt * feed * profile * ridge * Math.max(0, 1 - this.aFill[v] / 2.4);
        const blend = added / Math.max(this.aFill[v] + added, 0.000001);
        this.aFill[v] += added;
        this.aWidth[v] = THREE.MathUtils.lerp(this.aWidth[v], width, blend);
        this.aOffset[v] = THREE.MathUtils.lerp(this.aOffset[v], lateral, blend);
        this.aQuality[v] = THREE.MathUtils.lerp(this.aQuality[v], m.quality, blend);
        this.aDefect[v] = THREE.MathUtils.lerp(this.aDefect[v], defect, blend);
        // New molten metal remelts local surface detail; cold neighbouring
        // strokes remain in place instead of moving to the newest torch tip.
        const remelt = this.aHeat[v] > 0.35 ? Math.max(blend, 1 - Math.exp(-dt * profile * 10)) : blend;
        this.aPhase[v] = THREE.MathUtils.lerp(this.aPhase[v], cellPhase, remelt);
        this.aHeat[v] = Math.max(this.aHeat[v], 0.4 + 0.6 * profile);
        touched = true;
      }
      if (!touched) continue;
      this.hotRows.add(i); this.changedRows.add(i);
      this.filledSegments = Math.max(this.filledSegments, i);
      for (let c = 0; c < HAZ_COLS; c++) {
        const v = i * HAZ_COLS + c;
        this.hazFill[v] += (1 - this.hazFill[v]) * (1 - Math.exp(-dt * 8));
      }
      if (this.seam.closed && i === 0)
        this.hazFill.copyWithin(this.segments * HAZ_COLS, 0, HAZ_COLS);
      this._upload(this.hazFillAttr, i * HAZ_COLS, (i + 1) * HAZ_COLS);
      if (this.seam.closed && i === 0)
        this._upload(this.hazFillAttr, this.segments * HAZ_COLS, this.hazFill.length);
    }
  }

  /** @param {{arcOn:boolean, point:THREE.Vector3}} s point is in parent-local space */
  update(dt, s) {
    this.time += dt;
    if (!s.arcOn) this.lastDeposit = null;

    if (this.gravityEnabled) {
      this.parent.getWorldQuaternion(this.gravityRotation).invert();
      this.gravity.set(0, -1, 0).applyQuaternion(this.gravityRotation);
      if (this.anyHeat) this._settleHotMetal(dt);
    }

    if (this.anyHeat) {
      const decay = Math.exp(-dt / HEAT_TAU);
      for (const row of this.hotRows) {
        let remaining = false;
        for (let c = 0; c < COLS; c++) {
          const v = row * COLS + c;
          this.aHeat[v] = this.aHeat[v] > 0.002 ? this.aHeat[v] * decay : 0;
          remaining ||= this.aHeat[v] > 0;
        }
        this._upload(this.heatAttr, row * COLS, (row + 1) * COLS);
        if (this.seam.closed && row === 0) {
          this.aHeat.copyWithin(this.segments * COLS, 0, COLS);
          this._upload(this.heatAttr, this.segments * COLS, this.count);
        }
        if (!remaining) this.hotRows.delete(row);
      }
      this.anyHeat = this.hotRows.size > 0;
    }
    this._flushSurface();

    const arc = s.arcOn ? 1 : 0;
    this.poolArc = THREE.MathUtils.lerp(this.poolArc ?? 0, arc, 1 - Math.exp(-dt * 18));
    this.pool.visible = this.poolArc > 0.002;
    // Cool completed joints without touching the shared active arc light or
    // projecting an invisible puddle onto curved surfaces every frame.
    if (s.passive || !this.pool.visible) {
      this.pool.material.uniforms.uArc.value = this.poolArc;
      if (!s.passive) this.light.intensity = 0;
      if (this.sparks.visible) this._updateSparks(dt);
      return;
    }
    // On a curved seam the puddle has to be re-aimed every frame: the surface
    // it lies on rotates underneath it as the welder travels.
    const poolT = s.t ?? this.poolT ?? 0;
    const poolFrame = this.seam.frameAt(poolT, _frame);
    this.seam.pointAt(poolT, _pt);
    const lateral = _pt.subVectors(s.point, _pt).dot(poolFrame.lateral);
    const row = Math.round(THREE.MathUtils.clamp(poolT, 0, 1) * this.segments);
    const col = THREE.MathUtils.clamp(Math.round((lateral + this.gridHalfWidth) / this.colSpacing), 0, COLS - 1);
    this.poolNormal.fromArray(this.mesh.geometry.attributes.aNormal.array, (row * COLS + col) * 3);
    if (this.seam.surfacePoint) {
      this.seam.surfacePoint(poolT, lateral, this.pool.position);
    } else this.pool.position.copy(s.point);
    // Repeated passes can rise above the old fixed-height arc quad.
    this.pool.position.addScaledVector(this.poolNormal, this._heightAt(poolT, lateral) + 0.0008);
    this.pool.quaternion.setFromUnitVectors(_unitZ, this.poolNormal);
    if (this.gravityEnabled) {
      this.gravityRotation.copy(this.pool.quaternion).invert();
      this.poolGravity.copy(this.gravity).applyQuaternion(this.gravityRotation);
      this.pool.material.uniforms.uGravity.value.set(this.poolGravity.x, this.poolGravity.y);
      this.pool.material.uniforms.uRunoff.value = this.runoff;
    }
    this.pool.material.uniforms.uTime.value = this.time;
    this.pool.material.uniforms.uArc.value = this.poolArc;
    this.light.position.copy(s.point).addScaledVector(poolFrame.normal, 0.02);
    this.light.intensity = this.poolArc * 0.12;

    this._updateSparks(dt);
  }

  reset() {
    this.aSlope.fill(0);
    this.aDefect.fill(0);
    this.slopeAttr.needsUpdate = this.defectAttr.needsUpdate = true;
    this.runoff = 0;
    this.poolT = 0;
    this.aOffset.fill(0);
    this.aFill.fill(0);
    this.aWidth.fill(0);
    this.aHeat.fill(0);
    this.aQuality.fill(0);
    this.aPhase.fill(0);
    this.hazFill.fill(0);
    this.hazFillAttr.needsUpdate = true;
    this.offsetAttr.needsUpdate = true;
    this.fillAttr.needsUpdate = true;
    this.widthAttr.needsUpdate = true;
    this.heatAttr.needsUpdate = true;
    this.qualityAttr.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.filledSegments = 0;
    this.lastDeposit = null; this.pathPhase = 0;
    this.hotRows.clear(); this.changedRows.clear(); this.normalRows.clear(); this.flowCells.clear();
    for (const key of this.flowFields) this.flow[key].fill(0);
    // A reset touches every cell, even if a partial upload was still pending.
    for (const attr of Object.values(this.mesh.geometry.attributes)) attr.clearUpdateRanges();
    this.hazFillAttr.clearUpdateRanges();
    for (const key of this.flowFields) this._upload(this.mesh.geometry.attributes['a' + key], 0, this.count);
    this._upload(this.slopeAttr, 0, this.aSlope.length);
    this._upload(this.hazFillAttr, 0, this.hazFill.length);
    this.anyHeat = false;
    this.mesh.visible = this.heatTint.visible = this.pool.visible = this.sparks.visible = false;
    this.poolArc = 0;
    this.sparkLife.fill(0);
    this.sparkAlpha.fill(0);
    this.sparks.geometry.attributes.aAlpha.needsUpdate = true;
    this.spatter.count = 0;
    this.spatterCursor = 0;
    this.spatterAcc = 0;
  }

  // Conservative transport on the fixed surface grid. Only molten material
  // flows; cooling freezes the shape. This remains a visual training model.
  _settleHotMetal(dt) {
    const laterals = this.mesh.geometry.attributes.aLateral.array;
    for (const i of this.hotRows) {
      const frame = this.seam.frameAt(i / this.segments, _frame);
      const along = this.gravity.dot(frame.travel);
      for (let c = 0; c < COLS; c++) {
        const v = i * COLS + c;
        if (this.aHeat[v] <= 0.35 || this.aFill[v] <= 0.002) continue;
        const mobility = (this.aHeat[v] - 0.35) / 0.65;
        const creep = Math.min(dt, 0.05) * 0.0015 * mobility * (0.6 + this.runoff * 0.4);
        const across = this.gravity.x * laterals[v * 3] + this.gravity.y * laterals[v * 3 + 1]
          + this.gravity.z * laterals[v * 3 + 2];
        let nextRow = i + Math.sign(along);
        if (this.seam.closed) nextRow = THREE.MathUtils.euclideanModulo(nextRow, this.segments);
        if (nextRow >= 0 && nextRow <= this.segments)
          this._flowMetal(v, nextRow * COLS + c, Math.min(0.12, Math.abs(along) * creep / this.rowSpacing));
        const nextCol = c + Math.sign(across);
        if (nextCol >= 0 && nextCol < COLS)
          this._flowMetal(v, i * COLS + nextCol, Math.min(0.12, Math.abs(across) * creep / this.colSpacing));
      }
    }
    // Apply all fluxes together, so scan order cannot accelerate the flow.
    for (const v of this.flowCells) {
      const oldFill = this.aFill[v];
      const fill = Math.max(0, oldFill + this.flow.Fill[v]);
      for (const key of this.flowFields) {
        if (key !== 'Fill') this['a' + key][v] = fill > 0.000001
          ? (this['a' + key][v] * oldFill + this.flow[key][v]) / fill : 0;
        this.flow[key][v] = 0;
      }
      this.aFill[v] = fill;
      const row = Math.floor(v / COLS);
      this.changedRows.add(row); this.hotRows.add(row);
    }
    this.flowCells.clear();
  }

  _flowMetal(from, to, fraction) {
    if (from === to || fraction < 0.000001) return;
    const amount = this.aFill[from] * fraction;
    for (const key of this.flowFields) {
      const value = key === 'Fill' ? 1 : this['a' + key][from];
      this.flow[key][from] -= amount * value;
      this.flow[key][to] += amount * value;
    }
    this.flowCells.add(from); this.flowCells.add(to);
  }

  _upload(attribute, start, end) {
    // Merge pending edits into one range; the renderer clears it after upload.
    const range = attribute.updateRanges[0];
    if (range) {
      const last = Math.max(range.start + range.count, end);
      range.start = Math.min(range.start, start); range.count = last - range.start;
    } else attribute.addUpdateRange(start, end - start);
    attribute.needsUpdate = true;
  }

  _heightAt(t, lateral) {
    const y = (this.seam.closed ? THREE.MathUtils.euclideanModulo(t, 1) : THREE.MathUtils.clamp(t, 0, 1)) * this.segments;
    const x = THREE.MathUtils.clamp((lateral + this.gridHalfWidth) / this.colSpacing, 0, COLS - 1);
    const row = Math.floor(y), col = Math.floor(x), nextRow = Math.min(row + 1, this.segments), nextCol = Math.min(col + 1, COLS - 1);
    const a = THREE.MathUtils.lerp(this.aFill[row * COLS + col], this.aFill[row * COLS + nextCol], x - col);
    const b = THREE.MathUtils.lerp(this.aFill[nextRow * COLS + col], this.aFill[nextRow * COLS + nextCol], x - col);
    return THREE.MathUtils.lerp(a, b, y - row) * this.height;
  }

  _flushSurface() {
    if (!this.changedRows.size) return;
    if (this.seam.closed && this.changedRows.has(0)) {
      for (const key of this.flowFields) this['a' + key].copyWithin(this.segments * COLS, 0, COLS);
      this.changedRows.add(this.segments);
    }
    for (const row of this.changedRows) {
      for (const key of this.flowFields)
        this._upload(this.mesh.geometry.attributes['a' + key], row * COLS, (row + 1) * COLS);
      for (let offset = -1; offset <= 1; offset++) {
        const i = this.seam.closed ? THREE.MathUtils.euclideanModulo(row + offset, this.segments) : row + offset;
        if (i < 0 || i > this.segments) continue;
        this.normalRows.add(i);
        if (this.seam.closed && i === 0) this.normalRows.add(this.segments);
      }
    }
    for (const row of this.normalRows) {
      const prev = this.seam.closed ? THREE.MathUtils.euclideanModulo(row - 1, this.segments) : Math.max(0, row - 1);
      const next = this.seam.closed ? (row + 1) % this.segments : Math.min(this.segments, row + 1);
      const ds = (this.seam.closed ? 2 : next - prev) * this.rowSpacing;
      for (let c = 0; c < COLS; c++) {
        const v = row * COLS + c, left = Math.max(0, c - 1), right = Math.min(COLS - 1, c + 1);
        this.aSlope[v * 2] = this.height * (this.aFill[row * COLS + right] - this.aFill[row * COLS + left])
          / ((right - left) * this.colSpacing);
        this.aSlope[v * 2 + 1] = this.height * (this.aFill[next * COLS + c] - this.aFill[prev * COLS + c]) / ds;
      }
      this._upload(this.slopeAttr, row * COLS * 2, (row + 1) * COLS * 2);
    }
    this.changedRows.clear(); this.normalRows.clear();
  }

  /** Coverage and mean quality over the part of the seam that got welded. */
  getStats() {
    let covered = 0;
    let qualitySum = 0;
    const rows = this.seam.closed ? this.segments : this.segments + 1;
    for (let i = 0; i < rows; i++) {
      // Coverage is evaluated at the joint, not at an arbitrary side vertex.
      const v = i * COLS + (COLS - 1) / 2;
      if (this.aFill[v] > 0.25) {
        covered++;
        qualitySum += this.aQuality[v];
      }
    }
    return {
      coverage: covered / rows,
      quality: covered ? qualitySum / covered : 0,
    };
  }

  dispose() {
    for (const obj of [this.mesh, this.pool, this.sparks, this.spatter, this.heatTint]) {
      obj.geometry.dispose();
      obj.material.dispose();
      this.parent.remove(obj);
    }
    this.parent.remove(this.light);
  }

  // -- internals -------------------------------------------------------

/**
   * The rainbow band of oxide the parent metal is left with after the arc has
   * passed. It is a separate ribbon rather than part of the bead because it
   * lies on the plate, not on the deposited metal, and has to read through to
   * the steel texture underneath.
   */
  _buildHeatTint(options = {}) {
    const tintHalfWidth = options.tintHalfWidth ?? this.halfWidth * 3.4;
    const surface = new THREE.Vector3();
    const segments = this.segments;
    const count = (segments + 1) * HAZ_COLS;
    const aCenter = new Float32Array(count * 3);
    const aLateral = new Float32Array(count * 3);
    const aNormal = new Float32Array(count * 3);
    const aSide = new Float32Array(count);
    this.hazFill = new Float32Array(count);

    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      this.seam.pointAt(t, _pt);
      const frame = this.seam.frameAt(t, _frame);
      for (let c = 0; c < HAZ_COLS; c++) {
        const v = i * HAZ_COLS + c;
        const across = HAZ_SIDES[c] * tintHalfWidth;
        if (this.seam.surfacePoint) this.seam.surfacePoint(t, across, surface);
        else surface.copy(_pt).addScaledVector(frame.lateral, across);
        surface.toArray(aCenter, v * 3);
        aLateral[v * 3] = frame.lateral.x;
        aLateral[v * 3 + 1] = frame.lateral.y;
        aLateral[v * 3 + 2] = frame.lateral.z;
        const pipeSide = this.seam.plateAim && across > 0;
        aNormal[v * 3] = pipeSide ? -frame.lateral.x : frame.normal.x;
        aNormal[v * 3 + 1] = pipeSide ? -frame.lateral.y : frame.normal.y;
        aNormal[v * 3 + 2] = pipeSide ? -frame.lateral.z : frame.normal.z;
        aSide[v] = HAZ_SIDES[c];
      }
      if (i < segments) {
        for (let c = 0; c < HAZ_COLS - 1; c++) {
          const a = i * HAZ_COLS + c;
          const b = a + 1;
          const d = (i + 1) * HAZ_COLS + c;
          const e = d + 1;
          indices.push(a, d, b, b, d, e);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aCenter', new THREE.BufferAttribute(aCenter, 3));
    geometry.setAttribute('aLateral', new THREE.BufferAttribute(aLateral, 3));
    geometry.setAttribute('aNormal', new THREE.BufferAttribute(aNormal, 3));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    this.hazFillAttr = new THREE.BufferAttribute(this.hazFill, 1);
    geometry.setAttribute('aFill', this.hazFillAttr);
    geometry.setIndex(indices);

    const material = new THREE.ShaderMaterial({
      // Roughly three bead widths each side, which is about how far the tint
      // reaches on a hand-run pass.
      uniforms: { uHalfWidth: { value: (options.tintHalfWidth ?? this.halfWidth * 3.4) } },
      vertexShader: HAZ_VERT,
      fragmentShader: HAZ_FRAG,
      transparent: true,
      // It sits a fifth of a millimetre above the plate, so it must not fight
      // the plate for the depth buffer or punch a hole in what draws after it.
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });

    this.heatTint = new THREE.Mesh(geometry, material);
    this.heatTint.frustumCulled = false;
    this.heatTint.renderOrder = -1;
    this.parent.add(this.heatTint);
  }

  /**
   * Pull in the sculpted bead tile baked by tools/blender/bake_bead_maps.py.
   * Both maps have to arrive before either is used, otherwise the first frame
   * after load shades a sculpted normal against a flat AO.
   */
  _loadBeadMaps(material) {
    // The headless self-tests construct a WeldBead with no real DOM, and
    // TextureLoader reaches for document. They do not shade anything, so
    // skipping the fetch there is enough; uHasMaps simply stays 0.
    if (typeof document === 'undefined' || typeof document.createElementNS !== 'function') return;
    const loader = new THREE.TextureLoader();
    let pending = 2;
    const arrive = (slot) => (texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      // Only the travel direction tiles; across the bead the strip is the
      // whole width and must not wrap onto itself.
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      material.uniforms[slot].value = texture;
      if (--pending === 0) material.uniforms.uHasMaps.value = 1;
    };
    loader.load('./assets/bead_normal.png', arrive('uBeadNormal'));
    loader.load('./assets/bead_ao.png', arrive('uBeadAO'));
  }

  _buildPool(options = {}) {
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uArc: { value: 0 },
        uGravity: { value: new THREE.Vector2() }, uRunoff: { value: 0 } },
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    const poolSize = 0.02 * this.halfWidth / 0.0062;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(poolSize, poolSize), material);
    mesh.quaternion.setFromUnitVectors(_unitZ, this.seam.normal);
    mesh.frustumCulled = false;
    this.parent.add(mesh);
    this.pool = mesh;
    this.poolArc = 0;

    // The old colour here, 0xcaffdc, is mint green, and it was most of why
    // the arc looked wrong: a welding arc runs around 6000 K and throws a cold
    // blue-white light, never a green one. Reach extended too -- an arc is by
    // far the brightest thing in the shop and does light the bench around it.
    this.light = options.arcLight ?? new THREE.PointLight(0xbcd2ff, 0, 0.55, 2);
    if (!options.arcLight) this.parent.add(this.light);
  }

  _buildSparks(count) {
    this.sparkCount = count;
    this.sparkPos = new Float32Array(count * 3);
    this.sparkVel = new Float32Array(count * 3);
    this.sparkLife = new Float32Array(count);
    this.sparkMaxLife = new Float32Array(count);
    this.sparkCursor = 0;
    this.sparkEmitAcc = 0;

    // Two vertices per spark, drawn as a line from the particle back along its
    // own velocity. Round dots read as confetti; what makes a welding photo
    // legible is that every spark is a streak pointing the way it flew.
    const geometry = new THREE.BufferGeometry();
    this.sparkVerts = new Float32Array(count * 2 * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.sparkVerts, 3));
    this.sparkAlpha = new Float32Array(count * 2);
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.sparkAlpha, 1));
    this.sparkHeat = new Float32Array(count * 2);
    geometry.setAttribute('aHeat', new THREE.BufferAttribute(this.sparkHeat, 1));

    const material = new THREE.ShaderMaterial({
      // uSize is a spark diameter already multiplied by the usual
      // viewportHeight / (2 tan(fov/2)) factor, so point size falls off with
      // distance. The clamp keeps a spark from ballooning when the headset is
      // right on top of the puddle.
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aHeat;
        varying float vAlpha;
        varying float vHeat;
        void main() {
          vAlpha = aAlpha;
          vHeat = aHeat;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        varying float vAlpha;
        varying float vHeat;
        void main() {
          if (vAlpha <= 0.001) discard;
          // A spark is a lump of steel cooling in flight, so it runs down the
          // blackbody ramp: white-hot as it leaves, then yellow, orange, and
          // finally the dull red that is the last thing visible.
          vec3 c = mix(vec3(0.70, 0.07, 0.01), vec3(1.30, 0.38, 0.03), smoothstep(0.0, 0.32, vHeat));
          c = mix(c, vec3(1.60, 0.90, 0.20), smoothstep(0.32, 0.68, vHeat));
          c = mix(c, vec3(2.20, 2.00, 1.55), smoothstep(0.68, 1.0, vHeat));
          gl_FragColor = vec4(c, vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.sparks = new THREE.LineSegments(geometry, material);
    this.sparks.frustumCulled = false;
    this.parent.add(this.sparks);
  }

  _emitSparks(m, dt) {
    this.sparks.visible = true;
    // Spatter scales with how badly the torch is being held -- a clean weld is
    // a quiet one.
    const rate = 40 + (1 - m.quality) * 180;
    this.sparkEmitAcc += rate * dt;
    const n = Math.floor(this.sparkEmitAcc);
    this.sparkEmitAcc -= n;

    const sparkFrame = this.seam.frameAt(m.t, _frame);
    if (this.seam.surfacePoint) this.seam.surfacePoint(m.t, m.lateral, _pt);
    else this.seam.pointAt(m.t, _pt).addScaledVector(sparkFrame.lateral, m.lateral);
    for (let k = 0; k < n; k++) {
      const i = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % this.sparkCount;
      this.sparkPos[i * 3] = _pt.x;
      this.sparkPos[i * 3 + 1] = _pt.y;
      this.sparkPos[i * 3 + 2] = _pt.z;

      // Real spatter leaves fast and mostly forward of the arc, with a few
      // outliers that carry a long way. The cubed roll is what gives that
      // occasional spark arcing right across the bench.
      const roll = Math.random();
      const speed = 0.5 + roll * roll * roll * 3.4;
      const theta = Math.random() * Math.PI * 2;
      const lift = 0.5 + Math.random() * 1.1;
      const dir = new THREE.Vector3()
        .addScaledVector(sparkFrame.lateral, Math.cos(theta))
        .addScaledVector(sparkFrame.travel, Math.sin(theta))
        .addScaledVector(sparkFrame.normal, lift)
        .normalize()
        .multiplyScalar(speed);
      this.sparkVel[i * 3] = dir.x;
      this.sparkVel[i * 3 + 1] = dir.y;
      this.sparkVel[i * 3 + 2] = dir.z;
      const life = 0.35 + Math.random() * 0.75;
      this.sparkLife[i] = life;
      this.sparkMaxLife[i] = life;
    }
  }

  _updateSparks(dt) {
    let alive = false;
    // Millimetre-scale steel loses speed quickly in air, and that drag is why
    // sparks curve over into a shower instead of flying off in straight lines.
    const drag = Math.exp(-dt * 2.4);
    for (let i = 0; i < this.sparkCount; i++) {
      const head = i * 2, tail = i * 2 + 1;
      if (this.sparkLife[i] <= 0) {
        this.sparkAlpha[head] = 0;
        this.sparkAlpha[tail] = 0;
        continue;
      }
      alive = true;
      this.sparkLife[i] -= dt;

      const vx = this.sparkVel[i * 3] * drag;
      const vy = this.sparkVel[i * 3 + 1] * drag - 9.81 * 0.45 * dt;
      const vz = this.sparkVel[i * 3 + 2] * drag;
      this.sparkVel[i * 3] = vx;
      this.sparkVel[i * 3 + 1] = vy;
      this.sparkVel[i * 3 + 2] = vz;

      const px = this.sparkPos[i * 3] + vx * dt;
      const py = this.sparkPos[i * 3 + 1] + vy * dt;
      const pz = this.sparkPos[i * 3 + 2] + vz * dt;
      this.sparkPos[i * 3] = px;
      this.sparkPos[i * 3 + 1] = py;
      this.sparkPos[i * 3 + 2] = pz;

      // The streak is the distance this spark covered in the last few
      // milliseconds, so fast ones draw long and slow ones draw short.
      const STREAK = 0.018;
      this.sparkVerts[head * 3] = px;
      this.sparkVerts[head * 3 + 1] = py;
      this.sparkVerts[head * 3 + 2] = pz;
      this.sparkVerts[tail * 3] = px - vx * STREAK;
      this.sparkVerts[tail * 3 + 1] = py - vy * STREAK;
      this.sparkVerts[tail * 3 + 2] = pz - vz * STREAK;

      const heat = Math.max(0, this.sparkLife[i] / this.sparkMaxLife[i]);
      const fade = Math.min(1, this.sparkLife[i] * 3.0);
      this.sparkHeat[head] = heat;
      this.sparkHeat[tail] = heat * 0.72;
      this.sparkAlpha[head] = fade;
      this.sparkAlpha[tail] = fade * 0.2;
    }
    if (alive) {
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparks.geometry.attributes.aAlpha.needsUpdate = true;
      this.sparks.geometry.attributes.aHeat.needsUpdate = true;
    }
    this.sparks.visible = alive;
  }
}
