import * as THREE from 'three';

const W = 1024;
const H = 700;
const REDRAW_HZ = 12;
const SAMPLE_HZ = 6;
const HISTORY = 90; // samples kept, ~15 s at 6 Hz

const BG = '#11141a';
const FRAME = '#39414f';
const INK = '#e8eef6';
const DIM = '#8d97a8';
const GRID = '#2a313c';
const BAND = 'rgba(47, 227, 106, 0.13)';

const WHITE = '#f2f6fa';
const YELLOW = '#ffd21e';
const ORANGE = '#ff7a3c';
const GREEN = '#35e36a';
const RED = '#ff4a4a';

const FONT = "'Malgun Gothic', 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif";
const MONO = "'Consolas', 'D2Coding', monospace";

/** Fixed-length ring of numbers, oldest first when read out. */
class Trace {
  constructor() {
    this.values = [];
  }
  push(v) {
    this.values.push(v);
    if (this.values.length > HISTORY) this.values.shift();
  }
  clear() {
    this.values.length = 0;
  }
  get last() {
    return this.values.length ? this.values[this.values.length - 1] : 0;
  }
}

/**
 * The statistics board standing in front of the bench.
 *
 * The floating torch HUD answers "am I inside tolerance right now"; this board
 * answers "what have I been doing for the last fifteen seconds", which is the
 * question a trainee cannot answer from inside the hood. Everything is drawn
 * to one canvas and shown on one quad, so it costs a single draw call and
 * stays readable in the headset where DOM overlays do not exist at all.
 */
export class StatsBoard {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.redrawTimer = 0;
    this.sampleTimer = 0;
    this.result = null;

    this.traces = {
      arc: new Trace(),
      speed: new Trace(),
      work: new Trace(),
      travel: new Trace(),
    };
    this.live = null;

    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;

    const width = options.width ?? 0.66;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, (width * H) / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false })
    );
    this.mesh.position.copy(options.position ?? new THREE.Vector3(0, 1.55, -0.78));
    // Tipped down towards the welder: at this height a board square to the
    // floor reads at a glance only if you stand bolt upright.
    this.mesh.rotation.x = options.tilt ?? -0.16;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);

    this.frame = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 1.03, ((width * H) / W) * 1.045),
      new THREE.MeshBasicMaterial({ color: 0x424a58 })
    );
    this.frame.position.copy(this.mesh.position).add(new THREE.Vector3(0, 0, -0.004));
    this.frame.rotation.copy(this.mesh.rotation);
    scene.add(this.frame);

    this._draw();
  }

  /** Feed one frame of measurements. Only arc-on time is traced. */
  sample(dt, m) {
    this.live = m;
    this.sampleTimer += dt;
    if (this.sampleTimer < 1 / SAMPLE_HZ) return;
    this.sampleTimer = 0;
    if (!m || !m.welding) return;
    this.traces.arc.push(m.height * 1000);
    this.traces.speed.push(m.strokeSpeed * 1000);
    this.traces.work.push(m.workAngleDeg);
    this.traces.travel.push(m.travelAngleDeg);
  }

  update(dt) {
    this.redrawTimer += dt;
    if (this.redrawTimer < 1 / REDRAW_HZ) return;
    this.redrawTimer = 0;
    this._draw();
    this.texture.needsUpdate = true;
  }

  /** The board belongs to whichever exercise reports stroke data; the flat
   *  butt joint has none, so the combined bench has to be able to hide it. */
  setVisible(visible) {
    this.mesh.visible = visible;
    this.frame.visible = visible;
  }

  showResult(report) {
    this.result = report;
    this._draw();
    this.texture.needsUpdate = true;
  }

  reset() {
    this.result = null;
    for (const key of Object.keys(this.traces)) this.traces[key].clear();
    this._draw();
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.frame);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.frame.geometry.dispose();
    this.frame.material.dispose();
    this.texture.dispose();
  }

  // -- drawing ---------------------------------------------------------

  _draw() {
    const c = this.ctx;
    c.fillStyle = BG;
    c.fillRect(0, 0, W, H);
    c.strokeStyle = FRAME;
    c.lineWidth = 4;
    c.strokeRect(2, 2, W - 4, H - 4);

    if (this.result) return this._drawResult();

    const m = this.live;
    const target = m?.target ?? null;

    // -- header ---------------------------------------------------------
    c.fillStyle = INK;
    c.font = `600 38px ${FONT}`;
    c.textAlign = 'center';
    c.fillText('용접 통계', W / 2, 52);

    c.font = `22px ${FONT}`;
    c.fillStyle = DIM;
    c.textAlign = 'left';
    const label = m?.stroke?.label ?? '완료';
    const hour = m ? Math.round(m.clock) % 12 : 12;
    const posture = m ? this._posture(m.clock) : '';
    c.fillText(`${label}   ·   ${hour === 0 ? 12 : hour}시 방향 (${posture})`, 34, 92);

    c.textAlign = 'right';
    const prog = m ? Math.round(THREE.MathUtils.clamp(m.p, 0, 1) * 100) : 0;
    c.fillStyle = m?.welding ? GREEN : DIM;
    c.fillText(`진행 ${prog}%${m?.welding ? '  ● 아크' : ''}`, W - 34, 92);

    // -- charts ---------------------------------------------------------
    this._chart({
      y: 112,
      h: 160,
      title: '아크 길이',
      unit: 'mm',
      value: m ? m.height * 1000 : 0,
      target: target ? target.standoff * 1000 : null,
      tol: 1.6,
      min: 0,
      max: 8,
      series: [{ trace: this.traces.arc, color: WHITE }],
    });

    this._chart({
      y: 292,
      h: 160,
      title: '운봉 속도',
      unit: 'mm/s',
      value: m ? m.strokeSpeed * 1000 : 0,
      target: target ? target.speed * 1000 : null,
      tol: 1.2,
      min: 0,
      max: 8,
      series: [{ trace: this.traces.speed, color: YELLOW }],
    });

    this._chart({
      y: 472,
      h: 160,
      title: '각도',
      unit: '°',
      min: -45,
      max: 45,
      target: 0,
      tol: 15,
      legend: [
        { text: `작업각(45° 기준) ${m ? m.workAngleDeg.toFixed(0) : 0}°`, color: ORANGE },
        { text: `전진각 ${m ? m.travelAngleDeg.toFixed(0) : 0}°`, color: GREEN },
      ],
      series: [
        { trace: this.traces.work, color: ORANGE },
        { trace: this.traces.travel, color: GREEN },
      ],
    });

    // -- footer ---------------------------------------------------------
    c.fillStyle = DIM;
    c.font = `20px ${FONT}`;
    c.textAlign = 'left';
    c.fillText('트리거 = 아크   ·   반대쪽 손 트리거 = 다시하기   ·   반대쪽 손 그립 = 작업물 옮기기', 34, H - 22);
  }

  _posture(clock) {
    if (clock > 10.5 || clock < 1.5) return '아래보기';
    if (clock > 4.5 && clock < 7.5) return '위보기';
    return '수직';
  }

  /** One labelled chart block with a target band and a live value. */
  _chart({ y, h, title, unit, value, target, tol, min, max, series, legend }) {
    const c = this.ctx;
    const x0 = 112;
    const x1 = W - 40;
    const top = y + 34;
    const bottom = y + h;
    const toY = (v) => bottom - ((THREE.MathUtils.clamp(v, min, max) - min) / (max - min)) * (bottom - top);

    // title and live reading
    c.textAlign = 'left';
    c.font = `22px ${FONT}`;
    if (legend) {
      let lx = x0;
      for (const item of legend) {
        c.fillStyle = item.color;
        c.beginPath();
        c.arc(lx + 7, y + 18, 7, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = INK;
        c.fillText(item.text, lx + 22, y + 26);
        lx += c.measureText(item.text).width + 56;
      }
    } else {
      c.fillStyle = DIM;
      c.fillText(title, x0, y + 26);
      c.font = `600 26px ${MONO}`;
      const off = target !== null && tol ? Math.abs(value - target) / tol : 0;
      c.fillStyle = off <= 0.5 ? GREEN : off <= 1 ? YELLOW : RED;
      c.fillText(`${value.toFixed(1)} ${unit}`, x0 + 120, y + 27);
      if (target !== null) {
        c.fillStyle = DIM;
        c.font = `20px ${MONO}`;
        c.fillText(`목표 ${target.toFixed(1)}`, x0 + 280, y + 27);
      }
    }

    // target band: the thing the line has to stay inside
    if (target !== null && tol) {
      c.fillStyle = BAND;
      const yTop = toY(target + tol);
      const yBot = toY(target - tol);
      c.fillRect(x0, yTop, x1 - x0, yBot - yTop);
      c.strokeStyle = 'rgba(53, 227, 106, 0.45)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x0, toY(target));
      c.lineTo(x1, toY(target));
      c.stroke();
    }

    // axes
    c.strokeStyle = GRID;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x0, top);
    c.lineTo(x0, bottom);
    c.lineTo(x1, bottom);
    c.stroke();

    c.fillStyle = DIM;
    c.font = `17px ${MONO}`;
    c.textAlign = 'right';
    for (let i = 0; i <= 3; i++) {
      const v = min + ((max - min) * i) / 3;
      c.fillText(v.toFixed(0), x0 - 10, toY(v) + 6);
    }

    // traces, oldest at the left edge so the line grows towards "now"
    for (const s of series) {
      const vals = s.trace.values;
      if (vals.length < 2) continue;
      c.strokeStyle = s.color;
      c.lineWidth = 3;
      c.beginPath();
      for (let i = 0; i < vals.length; i++) {
        const px = x0 + ((x1 - x0) * i) / (HISTORY - 1);
        const py = toY(vals[i]);
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.stroke();

      const px = x0 + ((x1 - x0) * (vals.length - 1)) / (HISTORY - 1);
      c.fillStyle = s.color;
      c.beginPath();
      c.arc(px, toY(vals[vals.length - 1]), 5, 0, Math.PI * 2);
      c.fill();
    }
  }

  _drawResult() {
    const c = this.ctx;
    const r = this.result;

    c.textAlign = 'center';
    c.fillStyle = INK;
    c.font = `600 40px ${FONT}`;
    c.fillText('용접 결과', W / 2, 60);

    c.font = `600 92px ${MONO}`;
    c.fillStyle = r.total >= 80 ? GREEN : r.total >= 55 ? YELLOW : RED;
    c.fillText(`${r.total}점`, W / 2, 152);

    const rows = [
      ['아크 길이', r.arc],
      ['중앙 정렬', r.center],
      ['운봉 속도', r.speed],
      ['작업각 (45°)', r.work],
      ['이음부 겹침', r.tieIn],
      ['진행 방향', r.direction],
      ['비드 적층률', r.coverage],
    ];

    const x0 = 120;
    const barX = 330;
    const barW = W - barX - 150;
    let y = 210;
    c.font = `24px ${FONT}`;
    for (const [name, pct] of rows) {
      c.textAlign = 'left';
      c.fillStyle = DIM;
      c.fillText(name, x0, y + 8);

      c.fillStyle = '#20262f';
      c.fillRect(barX, y - 14, barW, 22);
      c.fillStyle = pct >= 80 ? GREEN : pct >= 55 ? YELLOW : RED;
      c.fillRect(barX, y - 14, (barW * THREE.MathUtils.clamp(pct, 0, 100)) / 100, 22);

      c.textAlign = 'right';
      c.fillStyle = INK;
      c.font = `22px ${MONO}`;
      c.fillText(`${pct}%`, W - 40, y + 8);
      c.font = `24px ${FONT}`;
      y += 46;
    }

    c.textAlign = 'center';
    c.fillStyle = DIM;
    c.font = `22px ${FONT}`;
    c.fillText(
      `획별 완주 ${r.strokes.map((s) => `${s.id} ${s.coverage}%`).join('  ·  ')}   ·   아크 시간 ${r.arcTime.toFixed(1)}초`,
      W / 2,
      y + 14
    );
    c.fillStyle = YELLOW;
    c.font = `600 24px ${FONT}`;
    c.fillText('반대쪽 손 트리거 = 다시하기   (데스크톱은 R)', W / 2, H - 26);
  }
}
