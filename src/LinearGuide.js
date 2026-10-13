import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared vertex shader for every flat band drawn along the seam.
//
// Geometry is a single quad carrying (aT, aSide); the real position is
// reconstructed here from the seam frame, so one 4-vertex buffer can be
// re-aimed just by changing uniforms. Everything is planar, so interpolation
// across that single quad is exact.
// ---------------------------------------------------------------------------
const BAND_VERT = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  uniform vec3 uStart;
  uniform vec3 uTravel;
  uniform vec3 uLateral;
  uniform vec3 uNormal;
  uniform float uLength;
  uniform float uHalfWidth;
  uniform float uLift;
  varying float vT;
  varying float vSide;
  void main() {
    vT = aT;
    vSide = aSide;
    vec3 pos = uStart
      + uTravel * (aT * uLength)
      + uLateral * (aSide * uHalfWidth)
      + uNormal * uLift;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// Flowing ">" chevrons filling the padded weld zone. The bright apex sits
// forward at the centerline and the arms trail outward, so each repeat reads
// as an arrowhead pointing the way the welder must travel.
export const CHEVRON_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform highp float uLength; // highp: must match the vertex shader, which defaults to highp
  uniform float uSpacing;    // meters between chevrons
  uniform float uFlowSpeed;  // chevrons per second
  uniform float uGlow;
  uniform float uCursor;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vT;
  varying float vSide;
  void main() {
    float av = clamp(abs(vSide), 0.0, 1.0);
    float u = fract((vT * uLength) / uSpacing - uTime * uFlowSpeed);

    float peak = 0.62 - av * 0.50;
    float d = abs(u - peak);
    float arm = 1.0 - smoothstep(0.0, 0.11, d);
    float tip = (1.0 - smoothstep(0.0, 0.22, av)) * (1.0 - smoothstep(0.0, 0.07, d)) * 0.7;
    float edgeFade = pow(1.0 - av, 0.55);

    // Chevrons only ever lead the welder: anything already laid down fades out.
    float ahead = smoothstep(uCursor - 0.03, uCursor + 0.04, vT);

    float intensity = (arm * edgeFade + tip) * uGlow;
    float alpha = clamp(intensity, 0.0, 1.0) * ahead * uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor * (0.7 + arm * 1.3 + tip), alpha);
  }
`;

// Dashed outline marking the edge of the allowed weld zone. The padding is
// deliberate: the finished bead has to sit inside these lines.
export const DASH_FRAG = /* glsl */ `
  precision mediump float;
  uniform highp float uLength; // highp: must match the vertex shader, which defaults to highp
  uniform float uDashLen;  // meters, one on+off cycle
  uniform float uDuty;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vT;
  varying float vSide;
  void main() {
    float cyc = fract((vT * uLength) / uDashLen);
    float on = 1.0 - smoothstep(uDuty - 0.06, uDuty + 0.06, cyc);
    float across = 1.0 - smoothstep(0.25, 1.0, abs(vSide));
    float alpha = on * across * uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// Solid blue centerline showing the exact path still left to weld.
export const CENTER_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uCursor;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vT;
  varying float vSide;
  void main() {
    float across = 1.0 - smoothstep(0.30, 1.0, abs(vSide));
    float ahead = smoothstep(uCursor - 0.004, uCursor + 0.004, vT);
    float alpha = across * ahead * uOpacity;
    if (alpha < 0.01) discard;
    float core = 1.0 - smoothstep(0.0, 0.45, abs(vSide));
    gl_FragColor = vec4(uColor + core * 0.35, alpha);
  }
`;

export const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The blue ring riding at the torch/plate contact point.
export const RING_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform float uArc;
  uniform float uEngaged; // 1 = torch is over the seam, 0 = it has wandered off
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform vec3 uIdleColor;
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;

    float ring = smoothstep(0.58, 0.68, r) * (1.0 - smoothstep(0.78, 0.90, r));
    float core = 1.0 - smoothstep(0.0, 0.30, r);

    // While the arc burns, a soft scan ring breathes outward from the center.
    float scan = fract(r * 1.3 - uTime * 0.9);
    float scanBand = smoothstep(0.0, 0.08, scan) * (1.0 - smoothstep(0.08, 0.30, scan));
    float pulse = scanBand * uArc * 0.45;

    // Off the seam the marker holds position but empties out, so it reads as a
    // place to return to rather than as a live contact point.
    float filled = core * 0.85 * uEngaged;
    float dim = mix(0.5, 1.0, uEngaged);

    float alpha = clamp(ring + filled + pulse, 0.0, 1.0) * uOpacity * dim;
    if (alpha < 0.01) discard;
    vec3 col = mix(uIdleColor, uColor, uEngaged);
    gl_FragColor = vec4(col + core * 0.5 * uEngaged, alpha);
  }
`;

const _p = new THREE.Vector3();
const _warn = new THREE.Color();

/**
 * The on-plate guide for a straight MIG pass.
 *
 * From the welder's point of view:
 *   - a padded yellow zone (dashed outline) wide enough that a correct bead
 *     lands inside it
 *   - flowing yellow chevrons inside the zone, continuing past the far end,
 *     showing which way to travel
 *   - a solid blue centerline marking the path not yet welded
 *   - a blue ring riding at the torch contact point
 */
export class LinearGuide {
  constructor(parent, seam, options = {}) {
    this.parent = parent;
    this.seam = seam;
    this.time = 0;

    this.zoneHalfWidth = options.zoneHalfWidth ?? 0.011; // bead half-width + margin
    this.leadOvershoot = options.leadOvershoot ?? 0.22; // chevrons run past the end
    this.colorZone = new THREE.Color(options.colorZone ?? 0xffc61a);
    this.colorPath = new THREE.Color(options.colorPath ?? 0x1766ff);

    this.cursorT = 0; // last contact point seen while actually over the seam
    this.progressT = 0; // how much of the joint has really been welded
    this.arc = 0;
    this.engaged = 0; // 1 while the torch is over the seam, 0 when it has wandered off

    this.group = new THREE.Group();
    parent.add(this.group);

    // Chevrons start slightly behind the seam and run well past the far end,
    // so the last thing the welder sees is a row of arrows pointing onward.
    this.chevrons = this._makeBand({
      t0: -0.04,
      t1: 1 + this.leadOvershoot,
      halfWidth: this.zoneHalfWidth,
      lift: 0.001,
      frag: CHEVRON_FRAG,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSpacing: { value: options.chevronSpacing ?? 0.022 },
        uFlowSpeed: { value: options.chevronFlowSpeed ?? 0.8 },
        uGlow: { value: 1.0 },
        uCursor: { value: 0 },
        uColor: { value: this.colorZone.clone() },
      },
    });

    // Dashed zone boundary: one band per side, plus a cap at each end.
    this.edges = [-1, 1].map((side) =>
      this._makeBand({
        t0: 0,
        t1: 1,
        halfWidth: 0.001,
        lift: 0.0012,
        lateralOffset: side * this.zoneHalfWidth,
        frag: DASH_FRAG,
        blending: THREE.NormalBlending,
        uniforms: {
          uDashLen: { value: 0.016 },
          uDuty: { value: 0.55 },
          uColor: { value: this.colorZone.clone() },
        },
      })
    );
    this.caps = [0, 1].map((t) => this._makeCap(t));

    this.centerLine = this._makeBand({
      t0: 0,
      t1: 1,
      halfWidth: 0.0016,
      lift: 0.0015,
      frag: CENTER_FRAG,
      blending: THREE.NormalBlending,
      uniforms: {
        uCursor: { value: 0 },
        uColor: { value: this.colorPath.clone() },
      },
    });

    this.ring = this._makeRing(options.ringRadius ?? 0.009);
  }

  /**
   * Progress and cursor are deliberately two different things.
   *
   * `progressT` is how much of the joint has actually been welded, so the blue
   * path is only consumed by real work -- waving the torch down the bench a
   * foot above the plate must not eat it.
   *
   * `cursorT` is where the contact point is right now, and it is only taken
   * while the torch is genuinely over the seam. Off the seam the ring holds
   * its last good position and goes hollow, which reads as "come back to
   * here" instead of silently sliding along the axis.
   *
   * @param {number} dt seconds
   * @param {{progressT:number, cursorT:number, onSeam:boolean,
   *          arcOn:boolean, severity:number}} state
   */
  update(dt, state) {
    this.time += dt;

    const progressT = THREE.MathUtils.clamp(state.progressT ?? 0, 0, 1);
    const onSeam = !!state.onSeam;
    if (onSeam) this.cursorT = THREE.MathUtils.clamp(state.cursorT ?? 0, 0, 1);

    this.progressT = progressT;
    this.arc = THREE.MathUtils.lerp(this.arc, state.arcOn ? 1 : 0, 1 - Math.exp(-dt * 10));
    this.engaged = THREE.MathUtils.lerp(this.engaged, onSeam ? 1 : 0, 1 - Math.exp(-dt * 12));
    const severity = THREE.MathUtils.clamp(state.severity ?? 0, 0, 1);

    const chev = this.chevrons.material.uniforms;
    chev.uTime.value = this.time;
    chev.uCursor.value = progressT;
    chev.uGlow.value = THREE.MathUtils.lerp(chev.uGlow.value, 0.9 + severity * 0.8, 0.2);
    chev.uColor.value.lerp(
      severity > 0.5 ? _warn.setHex(0xff7a1a) : _warn.copy(this.colorZone),
      0.12
    );

    this.centerLine.material.uniforms.uCursor.value = progressT;

    this.seam.pointAt(this.cursorT, _p);
    this.ring.position.copy(_p).addScaledVector(this.seam.normal, 0.0018);
    const ring = this.ring.material.uniforms;
    ring.uTime.value = this.time;
    ring.uArc.value = this.arc * this.engaged;
    ring.uEngaged.value = this.engaged;
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        obj.material.dispose();
      }
    });
    this.parent.remove(this.group);
  }

  // -- internals -------------------------------------------------------

  _bandUniforms(halfWidth, lift, lateralOffset) {
    const start = this.seam.start.clone().addScaledVector(this.seam.lateral, lateralOffset);
    return {
      uStart: { value: start },
      uTravel: { value: this.seam.travel.clone() },
      uLateral: { value: this.seam.lateral.clone() },
      uNormal: { value: this.seam.normal.clone() },
      uLength: { value: this.seam.length },
      uHalfWidth: { value: halfWidth },
      uLift: { value: lift },
      uOpacity: { value: 1 },
    };
  }

  _makeBand({ t0, t1, halfWidth, lift, lateralOffset = 0, frag, blending, uniforms }) {
    const geometry = new THREE.BufferGeometry();
    // A dummy position attribute keeps three.js bounding-sphere math happy;
    // the real position comes from the seam frame in the vertex shader.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute('aT', new THREE.BufferAttribute(new Float32Array([t0, t0, t1, t1]), 1));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array([-1, 1, -1, 1]), 1));
    geometry.setIndex([0, 2, 1, 1, 2, 3]);

    const material = new THREE.ShaderMaterial({
      uniforms: { ...this._bandUniforms(halfWidth, lift, lateralOffset), ...uniforms },
      vertexShader: BAND_VERT,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /** A short dashed bar laid across the seam, closing off the zone at t. */
  _makeCap(t) {
    const mesh = this._makeBand({
      t0: -1,
      t1: 1,
      halfWidth: 0.001,
      lift: 0.0012,
      frag: DASH_FRAG,
      blending: THREE.NormalBlending,
      uniforms: {
        uDashLen: { value: 0.008 },
        uDuty: { value: 0.6 },
        uColor: { value: this.colorZone.clone() },
      },
    });
    // Re-aim the band so it sweeps across the seam instead of along it.
    const u = mesh.material.uniforms;
    this.seam.pointAt(t, u.uStart.value);
    u.uTravel.value.copy(this.seam.lateral);
    u.uLateral.value.copy(this.seam.travel);
    u.uLength.value = this.zoneHalfWidth;
    return mesh;
  }

  _makeRing(radius) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uArc: { value: 0 },
        uEngaged: { value: 0 },
        uOpacity: { value: 1 },
        uColor: { value: this.colorPath.clone() },
        // Still blue -- it is the same marker, just not engaged. Amber here
        // would collide with the zone outline and the glowing bead.
        uIdleColor: { value: new THREE.Color(0x6f9fe0) },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), material);
    mesh.frustumCulled = false;
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.seam.normal);
    this.group.add(mesh);
    return mesh;
  }
}
