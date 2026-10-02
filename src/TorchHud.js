import * as THREE from 'three';

const CELL = 320;
const CANVAS_W = CELL * 3;
const CANVAS_H = CELL;
const REDRAW_HZ = 30;

const GREEN = '#2fe36a';
const YELLOW = '#ffd21e';
const RED = '#ff2f2f';
const WHITE = '#f2f6fa';

/** Error magnitude (in tolerance units) -> the usual traffic-light colour. */
function gradeColor(magnitude) {
  if (magnitude <= 0.5) return GREEN;
  if (magnitude <= 1.0) return YELLOW;
  return RED;
}

/**
 * The three floating gauges that ride above the torch nozzle:
 *
 *   깊이 가이드  standoff (contact-tip-to-work distance) -- an arrow inside a
 *               bracket; the tip rests on the crossbar when the distance is
 *               right and punches through it when the torch is too close
 *   중앙 가이드  alignment -- a dot on a crosshair; centred means the torch is
 *               on the seam and held at the right travel angle
 *   속도 가이드  travel speed -- a needle on a red/yellow/green dial
 *
 * Drawn to a canvas rather than built from meshes: the shapes are pure 2D and
 * the whole readout is one billboarded quad, which keeps it legible from any
 * head angle and costs a single draw call.
 */
export class TorchHud {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.offset = options.offset ?? 0.13; // meters above the torch tip
    this.redrawTimer = 0;

    this.state = { depth: 0, center: { x: 0, y: 0 }, speed: 0.5 };

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    const width = options.width ?? 0.225;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 3),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false, // a HUD: never occluded by spatter, smoke or the bead
        depthWrite: false,
      })
    );
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this._draw();
  }

  /**
   * @param {number} dt seconds
   * @param {object} s
   * @param {number} s.depth    signed standoff error in tolerance units
   *                            (negative = too close, positive = too far)
   * @param {{x:number,y:number}} s.center normalised alignment error
   *                            (x = across the seam, y = travel angle)
   * @param {number} s.speed    dial fraction 0..1, 0.5 = ideal travel speed
   * @param {THREE.Vector3} s.anchor world-space torch tip
   * @param {THREE.Vector3} s.viewer world-space head/camera position
   */
  update(dt, s) {
    this.mesh.position.copy(s.anchor);
    this.mesh.position.y += this.offset;
    this.mesh.lookAt(s.viewer);

    this.state.depth = s.depth;
    this.state.center = s.center;
    this.state.speed = s.speed;

    this.redrawTimer += dt;
    if (this.redrawTimer >= 1 / REDRAW_HZ) {
      this.redrawTimer = 0;
      this._draw();
    }
  }

  setVisible(visible) {
    this.mesh.visible = visible;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
    this.scene.remove(this.mesh);
  }

  // -- drawing ---------------------------------------------------------

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // One soft dark halo under everything, so the gauges stay readable against
    // the white-hot arc.
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 12;

    this._drawDepth(CELL * 0.5, CELL * 0.5, this.state.depth);
    this._drawCenter(CELL * 1.5, CELL * 0.5, this.state.center);
    this._drawSpeed(CELL * 2.5, CELL * 0.5, this.state.speed);

    ctx.shadowBlur = 0;
    this.texture.needsUpdate = true;
  }

  /** Bracket + arrow. err < 0 = too close, so the arrow drives past the crossbar. */
  _drawDepth(cx, cy, err) {
    const ctx = this.ctx;
    const clamped = THREE.MathUtils.clamp(err, -1.6, 1.6);
    const color = gradeColor(Math.abs(err));

    const top = cy - 88;
    const bottom = cy + 82;
    const crossbarY = cy + 30;
    const halfSpan = 36;

    ctx.fillStyle = WHITE;
    ctx.fillRect(cx - halfSpan - 3, top, 7, bottom - top); // left upright
    ctx.fillRect(cx + halfSpan - 4, top, 7, bottom - top); // right upright
    ctx.fillRect(cx - halfSpan, crossbarY - 3, halfSpan * 2, 7); // crossbar

    const tipY = crossbarY - clamped * 38;
    const headH = 34;
    const shaftHalf = 17;
    const headHalf = 26;
    const shaftTop = top - 4;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - shaftHalf, shaftTop);
    ctx.lineTo(cx + shaftHalf, shaftTop);
    ctx.lineTo(cx + shaftHalf, tipY - headH);
    ctx.lineTo(cx + headHalf, tipY - headH);
    ctx.lineTo(cx, tipY);
    ctx.lineTo(cx - headHalf, tipY - headH);
    ctx.lineTo(cx - shaftHalf, tipY - headH);
    ctx.closePath();
    ctx.fill();
  }

  /** Crosshair + dot. The dot sits dead centre when the torch is on the line. */
  _drawCenter(cx, cy, center) {
    const ctx = this.ctx;
    const nx = THREE.MathUtils.clamp(center.x, -1.3, 1.3);
    const ny = THREE.MathUtils.clamp(center.y, -1.3, 1.3);
    const magnitude = Math.hypot(center.x, center.y);

    ctx.fillStyle = WHITE;
    ctx.fillRect(cx - 84, cy - 2.5, 168, 5);
    ctx.fillRect(cx - 2.5, cy - 84, 5, 168);

    ctx.fillStyle = gradeColor(magnitude);
    ctx.beginPath();
    ctx.arc(cx + nx * 74, cy + ny * 74, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Red/yellow/green dial with a needle. 0.5 = the master's pace. */
  _drawSpeed(cx, cy, fraction) {
    const ctx = this.ctx;
    const f = THREE.MathUtils.clamp(fraction, 0, 1);
    const pivotY = cy + 54;
    const rInner = 46;
    const rOuter = 100;

    // Canvas angles: PI is due left, 2*PI due right, so PI + f*PI sweeps the
    // top half from left (too slow) through vertical (ideal) to right (too fast).
    const angleAt = (v) => Math.PI + v * Math.PI;
    const bands = [
      [0.0, 0.18, RED],
      [0.18, 0.38, YELLOW],
      [0.38, 0.62, GREEN],
      [0.62, 0.82, YELLOW],
      [0.82, 1.0, RED],
    ];

    for (const [from, to, color] of bands) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, pivotY, rOuter, angleAt(from), angleAt(to));
      ctx.arc(cx, pivotY, rInner, angleAt(to), angleAt(from), true);
      ctx.closePath();
      ctx.fill();
    }

    const band = bands.find(([from, to]) => f >= from && f <= to) ?? bands[bands.length - 1];
    const needleColor = band[2];
    const angle = angleAt(f);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const px = -dy; // unit normal, for the needle's taper
    const py = dx;

    ctx.fillStyle = needleColor;
    ctx.beginPath();
    ctx.moveTo(cx + dx * (rOuter - 6), pivotY + dy * (rOuter - 6));
    ctx.lineTo(cx + px * 11, pivotY + py * 11);
    ctx.lineTo(cx - px * 11, pivotY - py * 11);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, pivotY, 13, 0, Math.PI * 2);
    ctx.fill();
  }
}
