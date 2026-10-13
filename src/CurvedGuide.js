import * as THREE from 'three';
import { CHEVRON_FRAG, DASH_FRAG, CENTER_FRAG, RING_VERT, RING_FRAG } from './LinearGuide.js';

// ---------------------------------------------------------------------------
// Vertex shader for a ribbon laid along a curved seam.
//
// The straight guide rebuilt every vertex from one start point and three fixed
// axes, which is why its whole band fitted in four vertices. A curve has no
// fixed axes, so the ribbon is baked on the CPU and this shader only passes
// (vT, vSide) through.
//
// That is the entire cost of going curved: every fragment shader downstream
// is reused untouched, because they were only ever written against vT, vSide
// and uLength -- a flat 2D strip of parameter space that knows nothing about
// where it sits in the world.
// ---------------------------------------------------------------------------
const RIBBON_VERT = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  varying float vT;
  varying float vSide;
  void main() {
    vT = aT;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Crosshatch marking a tie-in: the stretch a stroke has to be struck back
// over so the two beads fuse instead of butting cold against each other.
const TIEIN_FRAG = /* glsl */ `
  precision mediump float;
  uniform highp float uLength;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vT;
  varying float vSide;
  void main() {
    float s = (vT * uLength) * 180.0 + vSide * 3.0;
    float stripe = step(0.5, fract(s));
    float across = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
    float alpha = stripe * across * uOpacity * 0.75;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

const _p = new THREE.Vector3();
const _frame = {
  travel: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  lateral: new THREE.Vector3(),
};
const _warn = new THREE.Color();

/**
 * The guide for one stroke, drawn in the stroke's own direction of travel.
 *
 * Built in stroke-local progress, so a stroke that runs against increasing
 * seam t gets its chevrons pointing the way the welder actually goes without
 * any special casing: the ribbon is simply sampled from tAt(0) to tAt(1).
 */
class StrokeGuide {
  constructor(parent, seam, stroke, options) {
    this.seam = seam;
    this.stroke = stroke;
    this.group = new THREE.Group();
    parent.add(this.group);

    this.segments = options.segments ?? 160;
    this.zoneHalfWidth = options.zoneHalfWidth ?? 0.006;
    this.colorZone = new THREE.Color(options.colorZone ?? 0xffc61a);
    this.colorPath = new THREE.Color(options.colorPath ?? 0x1766ff);
    this.colorTieIn = new THREE.Color(options.colorTieIn ?? 0xff4fd0);

    this.strokeLength = stroke.span * seam.length;
    const lead = stroke.leadP(seam.length);
    const trail = stroke.trailP(seam.length);

    this.chevrons = this._ribbon({
      p0: -lead,
      p1: 1 + trail,
      halfWidth: this.zoneHalfWidth,
      lift: 0.0009,
      frag: CHEVRON_FRAG,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSpacing: { value: options.chevronSpacing ?? 0.009 },
        uFlowSpeed: { value: options.chevronFlowSpeed ?? 0.5 },
        uGlow: { value: 1.0 },
        uCursor: { value: 0 },
        uColor: { value: this.colorZone.clone() },
      },
    });

    this.edges = [-1, 1].map((side) =>
      this._ribbon({
        p0: 0,
        p1: 1,
        halfWidth: 0.0013,
        lift: 0.0011,
        lateralOffset: side * this.zoneHalfWidth,
        frag: DASH_FRAG,
        blending: THREE.NormalBlending,
        uniforms: {
          uDashLen: { value: 0.010 },
          uDuty: { value: 0.55 },
          uColor: { value: this.colorZone.clone() },
        },
      })
    );

    this.centerLine = this._ribbon({
      p0: 0,
      p1: 1,
      halfWidth: 0.0016,
      lift: 0.0014,
      frag: CENTER_FRAG,
      blending: THREE.NormalBlending,
      uniforms: {
        uCursor: { value: 0 },
        uColor: { value: this.colorPath.clone() },
      },
    });

    // Tie-ins, drawn only where there is actually overlap to make.
    this.tieIns = [];
    if (lead > 1e-6) {
      this.tieIns.push(
        this._ribbon({
          p0: -lead,
          p1: 0,
          halfWidth: this.zoneHalfWidth,
          lift: 0.0007,
          frag: TIEIN_FRAG,
          blending: THREE.NormalBlending,
          uniforms: { uColor: { value: this.colorTieIn.clone() } },
        })
      );
    }
    if (trail > 1e-6) {
      this.tieIns.push(
        this._ribbon({
          p0: 1,
          p1: 1 + trail,
          halfWidth: this.zoneHalfWidth,
          lift: 0.0007,
          frag: TIEIN_FRAG,
          blending: THREE.NormalBlending,
          uniforms: { uColor: { value: this.colorTieIn.clone() } },
        })
      );
    }

    // Strike here, stop here. On a circle these are the only two features that
    // tell the welder a lap is not what is being asked for.
    this.strikeMark = this._crossBar(0, 0x35ff7a);
    this.stopMark = this._crossBar(1, 0xff5a3c);

    this.setActive(false);
  }

  /** Bake a ribbon between two stroke-local progress values. */
  _ribbon({ p0, p1, halfWidth, lift, lateralOffset = 0, frag, blending, uniforms }) {
    const n = this.segments;
    const positions = new Float32Array((n + 1) * 2 * 3);
    const aT = new Float32Array((n + 1) * 2);
    const aSide = new Float32Array((n + 1) * 2);
    const surface = new THREE.Vector3();
    const indices = [];

    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const p = THREE.MathUtils.lerp(p0, p1, f);
      const t = this.stroke.tAt(p);
      this.seam.pointAt(t, _p);
      const frame = this.seam.frameAt(t, _frame);
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? -1 : 1;
        const v = i * 2 + s;
        const across = side * halfWidth + lateralOffset;
        if (this.seam.surfacePoint) this.seam.surfacePoint(t, across, surface);
        else surface.copy(_p).addScaledVector(frame.lateral, across);
        surface.addScaledVector(frame.normal, lift).toArray(positions, v * 3);
        aT[v] = f;
        aSide[v] = side;
      }
      if (i < n) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    geometry.setIndex(indices);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        // uLength is the span this ribbon actually covers, so chevron pitch
        // and dash length stay in millimetres on the metal.
        uLength: { value: Math.abs(p1 - p0) * this.strokeLength },
        uHalfWidth: { value: halfWidth },
        uOpacity: { value: 1 },
        ...uniforms,
      },
      vertexShader: RIBBON_VERT,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      // Drawn through the metal on purpose. On a pipe the far half of the seam
      // is behind the pipe from every single viewpoint, so a depth-tested
      // guide would only ever show the welder the quarter they are already
      // looking at -- and the one thing this guide has to communicate is the
      // shape of the whole plan, including the half they will have to move
      // round to reach.
      depthTest: false,
      blending,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    this.group.add(mesh);
    return mesh;
  }

  /** A short bar laid across the seam at a stroke-local progress. */
  _crossBar(p, color) {
    const t = this.stroke.tAt(p);
    this.seam.pointAt(t, _p);
    const frame = this.seam.frameAt(t, _frame);
    const half = this.zoneHalfWidth * 1.8;
    const geometry = new THREE.BufferGeometry();
    const a = _p.clone().addScaledVector(frame.lateral, -half);
    const b = _p.clone().addScaledVector(frame.lateral, half);
    a.addScaledVector(frame.normal, 0.0016);
    b.addScaledVector(frame.normal, 0.0016);
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]), 3)
    );
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })
    );
    line.frustumCulled = false;
    line.renderOrder = 11;
    this.group.add(line);
    return line;
  }

  /** Dim an upcoming or finished stroke so only the live one reads as live. */
  setActive(active) {
    this.active = active;
    this.group.traverse((obj) => {
      if (obj.isMesh && obj.material.uniforms?.uOpacity) {
        obj.material.uniforms.uOpacity.value = active ? 1 : 0.16;
      } else if (obj.isLine) {
        obj.material.opacity = active ? 1 : 0.2;
      }
    });
  }

  update(dt, time, state) {
    const cursor = THREE.MathUtils.clamp(state.progressP ?? 0, 0, 1);
    const chev = this.chevrons.material.uniforms;
    chev.uTime.value = time;
    chev.uCursor.value = cursor;
    if (this.active) {
      const severity = THREE.MathUtils.clamp(state.severity ?? 0, 0, 1);
      chev.uGlow.value = THREE.MathUtils.lerp(chev.uGlow.value, 0.9 + severity * 0.8, 0.2);
      chev.uColor.value.lerp(
        severity > 0.5 ? _warn.setHex(0xff7a1a) : _warn.copy(this.colorZone),
        0.12
      );
    }
    this.centerLine.material.uniforms.uCursor.value = cursor;
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.group.parent?.remove(this.group);
  }
}

/**
 * The whole guide for a multi-stroke joint.
 *
 * The one thing it refuses to draw is an unbroken ring. A continuous circle
 * would teach a motion no welder can make, and it would hide the two skills
 * that are actually being tested here: breaking the arc cleanly at twelve
 * o'clock, and striking back over the old bead at six.
 */
export class CurvedGuide {
  constructor(parent, seam, plan, options = {}) {
    this.parent = parent;
    this.seam = seam;
    this.plan = plan;
    this.time = 0;
    this.cursorT = 0;
    this.arc = 0;
    this.engaged = 0;

    this.group = new THREE.Group();
    parent.add(this.group);

    this.strokes = plan.strokes.map((s) => new StrokeGuide(this.group, seam, s, options));
    this.ring = this._makeRing(options.ringRadius ?? 0.006);
    this.activeIndex = -1;
  }

  _makeRing(radius) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uArc: { value: 0 },
          uEngaged: { value: 0 },
          uOpacity: { value: 1 },
          uColor: { value: new THREE.Color(0x1766ff) },
          uIdleColor: { value: new THREE.Color(0x6f7d93) },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * @param {{strokeIndex:number, progressP:number, cursorT:number,
   *          onSeam:boolean, arcOn:boolean, severity:number}} state
   */
  update(dt, state) {
    this.time += dt;

    if (state.strokeIndex !== this.activeIndex) {
      this.activeIndex = state.strokeIndex;
      this.strokes.forEach((g, i) => g.setActive(i === this.activeIndex));
    }

    for (const g of this.strokes) {
      g.update(dt, this.time, g.active ? state : { progressP: g.active ? 0 : 1 });
    }

    const onSeam = !!state.onSeam;
    if (onSeam) this.cursorT = state.cursorT ?? this.cursorT;
    this.arc = THREE.MathUtils.lerp(this.arc, state.arcOn ? 1 : 0, 1 - Math.exp(-dt * 10));
    this.engaged = THREE.MathUtils.lerp(this.engaged, onSeam ? 1 : 0, 1 - Math.exp(-dt * 12));

    // The contact marker lies flat in the joint, so it has to be re-aimed
    // every frame: on a pipe the surface it sits on turns under it.
    this.seam.pointAt(this.cursorT, _p);
    const frame = this.seam.frameAt(this.cursorT, _frame);
    this.ring.position.copy(_p).addScaledVector(frame.normal, 0.0018);
    this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.normal);

    const u = this.ring.material.uniforms;
    u.uTime.value = this.time;
    u.uArc.value = this.arc * this.engaged;
    u.uEngaged.value = this.engaged;
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  dispose() {
    this.strokes.forEach((g) => g.dispose());
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.parent.remove(this.group);
  }
}
