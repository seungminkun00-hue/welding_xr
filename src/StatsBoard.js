import * as THREE from 'three';

const W = 1024, H = 700, HISTORY = 90;
const FONT = "'Malgun Gothic', 'Noto Sans KR', sans-serif";
const GREEN = '#69efb0', DIM = '#a3b1c4', INK = '#eef5ff';

export class StatsBoard {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.occluders = options.occluders ?? [];
    this.live = null;
    this.result = null;
    this.exercise = 'pipe';
    this.session = null;
    this.sampleTimer = this.redrawTimer = 0;
    this.traces = { arc: [], speed: [], work: [], travel: [] };
    this.traceRevision = 0;
    this.settingsOpen = false;
    this.buttons = [];
    this.hovered = null;
    this.getSettings = () => ({});
    this.onAction = () => {};
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = 4;
    const width = options.width ?? 0.86;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * H / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, blending: THREE.NoBlending,
        depthTest: true, depthWrite: false, toneMapped: false }));
    this.mesh.position.copy(options.position ?? new THREE.Vector3(0, 1.55, -0.78));
    this.mesh.rotation.x = options.tilt ?? -0.16;
    // A physical board behind the work: respect opaque depth even when drawn
    // after the helmet filter. Never paint this panel over the training pipe.
    this.mesh.renderOrder = 100003;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // Draw the rim into the same canvas. Two almost coplanar, depth-writing
    // transparent panels can occlude each other differently in the two eyes.
    // Cache only real opaque workpiece meshes, excluding shader-generated
    // beads/guides. Do not raycast the whole workshop every pointer frame.
    this.blockers = [];
    for (const object of this.occluders) object.traverse(o => {
      if (!o.isMesh) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      if (materials.some(m => !m.isShaderMaterial && !m.transparent)) this.blockers.push(o);
    });
    // Basic-mode bench repositioning must preserve the board's rear clearance.
    if (options.follow) {
      options.follow.attach(this.mesh);
    }
    this.refresh();
  }
  configure(exercise, session) { this.exercise = exercise; this.session = session; }
  sample(dt, m) {
    this.live = m;
    this.sampleTimer += dt;
    if (this.sampleTimer < 1 / 6) return;
    this.sampleTimer = 0;
    if (!m?.welding) return;
    this.traceRevision++;
    const values = { arc: m.height * 1000, speed: (m.strokeSpeed ?? m.speed ?? 0) * 1000,
      work: m.workAngleDeg - (m.target?.workAngle ?? 0),
      travel: m.travelAngleDeg - (m.target?.travelAngle ?? this.session?.idealTravelAngleDeg ?? 0) };
    for (const key of Object.keys(this.traces)) {
      this.traces[key].push(values[key]);
      if (this.traces[key].length > HISTORY) this.traces[key].shift();
    }
  }
  update(dt) {
    this.redrawTimer += dt;
    if (this.redrawTimer >= 1 / 6 || (this.hovered !== this.lastHovered && this.redrawTimer >= 1 / 20)) {
      this.redrawTimer = 0; this.lastHovered = this.hovered; this.refresh(false);
    }
  }
  refresh(force = true) {
    const settings = this.getSettings(), m = this.live;
    const fixed = value => Number(value ?? 0).toFixed(1);
    const progress = this.exercise === 'pipe' ? this.session?.stats?.maxP : this.session?.maxT;
    const live = this.settingsOpen || this.result || settings.demo ? null : [
      m?.welding, Math.round((progress ?? 0) * 100), this.session?.plan?.current?.label,
      fixed((m?.height ?? 0) * 1000), fixed((m?.strokeSpeed ?? m?.speed ?? 0) * 1000),
      fixed((m?.workAngleDeg ?? 0) - (m?.target?.workAngle ?? 0)), m?.target,
      m?.physics && ['runoff', 'penetration', 'fusionRisk', 'slagRisk'].map(key => Math.round(m.physics[key] * 100)),
    ];
    const key = JSON.stringify([this.exercise, this.settingsOpen, this.hovered, settings,
      this.demoStage, this.traceRevision, live]);
    if (!force && key === this.drawKey) return;
    this.drawKey = key;
    this._draw(settings); this.texture.needsUpdate = true;
  }
  setVisible(visible) { this.mesh.visible = visible; }
  showResult(report) { this.result = report; this.refresh(); }
  reset() {
    this.result = this.live = null;
    this.sampleTimer = 0;
    this.traceRevision++;
    for (const values of Object.values(this.traces)) values.length = 0;
    this.refresh();
  }
  moveTo(worldPosition) {
    // Once deliberately placed, the board stays in the room even if the bench moves.
    if (this.mesh.parent !== this.scene) {
      this.scene.attach(this.mesh);
    }
    this.mesh.position.copy(worldPosition);
  }
  hit(raycaster, includeSurface = false) {
    if (!raycaster || !this.mesh.visible) return null;
    this.mesh.updateWorldMatrix(true, false);
    const hit = raycaster.intersectObject(this.mesh)[0];
    if (!hit?.uv) return null;
    const x = hit.uv.x * W, y = (1 - hit.uv.y) * H;
    const button = this.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    // Graphs are not controls: aiming the torch through a chart must not
    // consume its trigger. Only settings controls capture the ray.
    const action = button?.enabled ? button.id : null;
    if (!action && !this.settingsOpen && !includeSurface) return null;
    for (const object of this.blockers) {
      let visible = true;
      for (let node = object; node; node = node.parent) if (!node.visible) { visible = false; break; }
      if (!visible) continue;
      object.updateWorldMatrix(true, false);
      if (raycaster.intersectObject(object, false).some(front => front.distance < hit.distance - 0.001)) return null;
    }
    return { action, distance: hit.distance };
  }
  activate(action) {
    if (action === 'settings') this.settingsOpen = !this.settingsOpen;
    else if (action) this.onAction(action);
    this.refresh();
  }
  _text(text, x, y, size = 24, color = INK) {
    this.ctx.font = size + 'px ' + FONT;
    this.ctx.textAlign = 'left';
    this.ctx.fillStyle = color;
    this.ctx.fillText(text, x, y);
  }
  _button(id, text, x, y, w, h, enabled = true, selected = false) {
    const ctx = this.ctx;
    this.buttons.push({ id, x, y, w, h, enabled });
    ctx.fillStyle = !enabled ? '#19212c' : this.hovered === id ? '#365d73' : selected ? '#214d43' : '#273545';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = selected ? GREEN : '#42546a';
    ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    this._text(text, x + 18, y + h / 2 + 9, 26, enabled ? INK : '#738197');
  }
  _draw(settings) {
    const ctx = this.ctx;
    this.buttons = [];
    ctx.fillStyle = '#424a58'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#101822'; ctx.fillRect(5, 5, W - 10, H - 10);
    const applied = settings.mode === 'applied';
    this._button('basic', '기초연습', 28, 20, 190, 52, true, !applied);
    this._button('applied', '응용연습 · 현장', 234, 20, 280, 52, true, applied);
    if (!applied && settings.selectStation) {
      this._button('plate', '직선 용접', 536, 20, 220, 52, true, this.exercise === 'plate');
      this._button('pipe', '파이프 용접', 768, 20, 228, 52, true, this.exercise === 'pipe');
    } else this._text(applied ? settings.jointLabel ?? '작은 배관 접합' : this.exercise === 'pipe' ? '파이프 원주 필릿' : '직선 용접 · 평판', 540, 55, applied ? 20 : 27);
    if (this.settingsOpen && settings.web) this._webSettings(settings);
    else if (this.settingsOpen) this._settings(settings);
    else if (settings.web) this._web(settings.web);
    else if (settings.demo) {
      this._text('명장 시연 · 고스트만 재생 중', 58, 168, 36, GREEN);
      this._text('실제 운봉과 연습 기록은 멈춰 있습니다.', 58, 235, 28);
      this._text('설정 또는 G / 왼손 Y로 시연을 종료하세요.', 58, 292, 26, DIM);
      if (this.demoStage) this._text(this.demoStage, 58, 365, 26, GREEN);
    } else if (this.result) this._result();
    else this._live();
    this._text(settings.inputStatus ?? '', 28, 651, 19, DIM);
    this._text(settings.web ? '마우스: 운봉 · 좌클릭: 용접 · 우클릭: 시점' : '왼쪽 트리거: 잡고 이동 / 버튼은 짧게 클릭', 28, 680, 20, DIM);
    this._button('settings', this.settingsOpen ? '닫기' : '설정', 868, 628, 128, 56, true, this.settingsOpen);
    // A drawn gear avoids relying on a particular font having a gear glyph.
    if (!this.settingsOpen) {
      ctx.save(); ctx.translate(850, 656); ctx.strokeStyle = INK; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, 15); ctx.stroke();
      }
      ctx.restore();
      this.buttons[this.buttons.length - 1].x = 824;
      this.buttons[this.buttons.length - 1].w = 172;
    }
  }
  _settings(s) {
    this._text('훈련 설정', 42, 118, 32, GREEN);
    this._button('guide', '가이드라인  ' + (s.guides ? '켜짐' : '꺼짐'), 42, 145, 450, 62, true, s.guides);
    this._button('demo', s.demo ? '명장 시연 종료' : '명장 시연 · 고스트', 520, 145, 460, 62, s.supportsDemo, s.demo);
    this._text(s.unified && !s.inputState?.sessionActive ? '입력: 마우스 · 키보드' : '입력: Meta 양손 컨트롤러', 60, 262, 26, DIM);
    this._button('helmet', '용접 마스크  ' + (s.helmet ? '켜짐' : '꺼짐'), 520, 223, 460, 62, s.hasHelmet, s.helmet);
    this._button('help', '조작 안내  ' + (s.help ? '켜짐' : '꺼짐'), 42, 301, 450, 62, true, s.help);
    this._button('reset', '현재 연습 다시 시작', 520, 301, 460, 62);
    if (!s.supportsDemo) this._text('명장 시연은 파이프 연습에서 제공됩니다.', 42, 455, 21, DIM);
    if (s.unified && s.mode !== 'applied') {
      this._text('기초 → 응용 · 한 과제씩 이어서 연습', 42, 415, 24, DIM);
      this._button('next-joint', '다음 과제 ▶', 520, 379, 460, 62, s.hasNextJoint);
    } else if (s.selectStation && s.mode !== 'applied') {
      this._text('상단의 직선 용접 / 파이프 용접으로 과제를 전환하세요.', 42, 415, 25, DIM);
    }
    if (s.mode === 'applied') {
      this._button('positioner-home', '포지셔너 원위치', 42, 379, 450, 62);
      this._button('next-joint', '다음 용접부 선택', 520, 379, 460, 62, s.hasNextJoint);
      this._text(s.positioner ?? '', 42, 459, 21, '#ffd773');
    } else if (!s.technique) {
      this._text(s.unified ? '테이블 다음 버튼으로 기초·응용을 이어서 연습' : '모드를 이동하면 VR에 다시 입장하세요.', 520, 455, 21, DIM);
    }
    if (s.technique) {
      this._button('plate-angle', `철판 기준 ${s.technique.plateAngle}° · 변경`, 42, 445, 450, 46);
      this._button('plate-offset', `철판 쪽 ${(s.technique.plateOffset * 1000).toFixed(0)} mm · 변경`, 520, 445, 460, 46);
    } else this._text(s.unified ? '오른손 그립: 잡기 · 검지: 용접 / 왼손: 테이블 조작'
      : '오른손: 용접 · 왼손: 메뉴 / 그립으로 작업물 조절', 42, 487, 24, DIM);
    const input = s.inputState;
    if (input) {
      if (s.unified && !input.sessionActive) {
        this._text('마우스: 시점·운봉 · 좌클릭 유지: 용접', 42, 523, 23, DIM);
        this._text('방향키/WASD: 이동 · Q/E: 높이 · 휠: 용접건 앞뒤', 42, 557, 22, DIM);
        this._text('F: 과제 보기 · Ctrl: 정밀 조작 · Esc: 마우스 해제', 42, 591, 22, DIM);
        return;
      }
      this._text(s.technique ? '각도·겨냥 거리 변경 시 현재 연습이 초기화됩니다.' : input.summary,
        42, 523, 23, s.technique ? DIM : input.rightTracked && input.leftTracked ? GREEN : '#ffd773');
      const right = input.rightTracked ? '위치 수신' : input.rightSource ? '위치 없음' : '입력 없음';
      const left = input.leftTracked ? '위치 수신' : input.leftSource ? '추적 대기' : '연결 대기';
      this._text('오른손 컨트롤러: ' + right + ' / 왼손 컨트롤러: ' + left,
        42, 557, 22, DIM);
      this._text(s.mode === 'applied' ? '왼손 그립: 잡고 회전 / 왼쪽 스틱 위·아래: 작업대 높이'
        : s.unified ? '테이블 ◀ / ▶: 과제 · 왼쪽 스틱 위·아래: 높이'
          : '작업물은 왼손 그립을 확실히 누른 동안만 움직입니다.', 42, 591, 22, DIM);
    }
  }
  _webSettings(s) {
    this._text('PC 표시 · 연습 설정', 42, 120, 30, GREEN);
    this._button('guide', `궤도 (가이드)  ${s.guides ? 'ON' : 'OFF'}`, 42, 155, 450, 64, true, s.guides);
    this._button('ghost', `고스트 토치  ${s.ghost ? 'ON' : 'OFF'}`, 520, 155, 460, 64, true, s.ghost);
    this._button('start', `이어갈 지점  ${s.start ? 'ON' : 'OFF'}`, 42, 240, 450, 64, true, s.start);
    this._button('demo', s.web.playing ? '시연 일시정지' : '시연 보기', 520, 240, 460, 64);
    this._button('reset', '현재 과제 다시 시작', 42, 325, 450, 64);
    this._button('next-joint', '다음 과제 ▶', 520, 325, 460, 64);
    this._button('hud', `토치 HUD  ${s.hud ? 'ON' : 'OFF'}`, 42, 410, 450, 64, true, s.hud);
    this._text('표시를 꺼도 넉넉한 경로 보정은 유지됩니다.', 42, 530, 24, DIM);
  }
  _web(s) {
    this._text(s.mode === 'demo' ? '시연 보기' : '직접 해보기', 42, 145, 36, GREEN);
    this._text(s.stage, 42, 202, 24);
    this._text(`진행 ${s.progress}%`, 42, 290, 48, INK);
    this.ctx.fillStyle = '#273545'; this.ctx.fillRect(42, 325, 938, 26);
    this.ctx.fillStyle = GREEN; this.ctx.fillRect(42, 325, 938 * s.progress / 100, 26);
    this._text(s.progress >= 100 ? '완료' : s.arc ? '● 용접 중' : '아크 OFF', 42, 420, 32, s.arc ? GREEN : DIM);
    this._text(`아크 시간 ${s.seconds}초`, 520, 420, 30);
    this._text(s.mode === 'practice' ? `운봉 속도 ${s.speed.toFixed(1)} mm/s` : s.playing ? '시연 재생 중' : '시연 대기', 42, 490, 28);
    this._text('경로 보정 체험 · 실제 자세 채점은 VR 연습에서 진행', 42, 572, 23, DIM);
  }
  _live() {
    const m = this.live, pipe = this.exercise === 'pipe';
    const progress = pipe ? this.session?.stats?.maxP ?? 0 : this.session?.maxT ?? 0;
    const stage = this.session?.plan?.sequential ? this.session.plan.current?.label : null;
    this._text((stage ?? (m?.welding ? '용접 중' : '연습 대기')) + '  ·  진행 ' + Math.round(progress * 100) + '%',
      36, 114, stage ? 22 : 25, m?.welding ? GREEN : DIM);
    const target = m?.target ?? { standoff: this.session?.idealStandoff, speed: this.session?.idealSpeed };
    this._chart(144, '아크 길이', (m?.height ?? 0) * 1000, target.standoff * 1000,
      (this.session?.standoffTol ?? 0.0024) * 1000, pipe ? 8 : 24, [{ key: 'arc', color: INK }], 'mm');
    this._chart(302, '운봉 속도', (m?.strokeSpeed ?? m?.speed ?? 0) * 1000, target.speed * 1000,
      (this.session?.speedTol ?? this.session?.speedRange ?? 0.0018) * 1000,
      pipe ? 8 : 24, [{ key: 'speed', color: '#ffd773' }], 'mm/s');
    const angleTitle = this.session?.plan?.technique
      ? `철판 기준 ${this.session.plan.technique.plateAngle}° · 주황 작업각 오차 / 초록 전진각`
      : '각도 오차 · 주황 작업각 / 초록 전진각';
    this._chart(460, angleTitle, (m?.workAngleDeg ?? 0) - (m?.target?.workAngle ?? 0), 0,
      this.session?.angleTol ?? 22, 55,
      [{ key: 'work', color: '#ffae78' }, { key: 'travel', color: GREEN }], '°', -55);
    if (m?.physics) {
      const p = m.physics, n = value => Math.round(value * 100);
      this._text(`모델 지표 · 흘러내림 ${n(p.runoff)} · 용입 ${n(p.penetration)} · 융합불량 ${n(p.fusionRisk)} · 슬래그 ${n(p.slagRisk)}`,
        36, 624, 20, '#ffd773');
    }
  }
  _chart(y, title, value, target, tolerance, max, lines, unit, min = 0) {
    const ctx = this.ctx, x = 90, width = 890, top = y + 36, height = 105;
    this._text(title, 36, y + 20, 22, DIM);
    this._text(value.toFixed(1) + ' ' + unit, 720, y + 20, 25);
    const toY = v => top + height * (1 - THREE.MathUtils.clamp((v - min) / (max - min), 0, 1));
    if (Number.isFinite(target)) {
      ctx.fillStyle = '#1d3b34';
      ctx.fillRect(x, toY(target + tolerance), width, toY(target - tolerance) - toY(target + tolerance));
      ctx.strokeStyle = GREEN; ctx.beginPath();
      ctx.moveTo(x, toY(target)); ctx.lineTo(x + width, toY(target)); ctx.stroke();
    }
    ctx.strokeStyle = '#42546a'; ctx.strokeRect(x, top, width, height);
    this._text(String(max), 32, top + 16, 18, DIM);
    this._text(String(min), 32, top + height, 18, DIM);
    for (const line of lines) {
      ctx.strokeStyle = line.color; ctx.lineWidth = 3; ctx.beginPath();
      this.traces[line.key].forEach((v, i) => {
        const px = x + i / (HISTORY - 1) * width, py = toY(v);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }
  _result() {
    const r = this.result;
    this._text('연습 결과   ' + r.total + '점', 42, 140, 42, GREEN);
    const rows = [['아크 길이', r.arc ?? r.depth], ['중앙 정렬', r.center], ['운봉 속도', r.speed],
      ['작업각', r.work], ['이음부 겹침', r.tieIn], ['진행 방향', r.direction], ['비드 적층률', r.coverage]]
      .filter(([, value]) => Number.isFinite(value));
    rows.forEach(([label, value], i) => {
      const y = (r.physics ? 175 : 190) + i * (r.physics ? 46 : 54);
      this._text(label, 48, y + 22, 25, DIM);
      this.ctx.fillStyle = '#273545'; this.ctx.fillRect(290, y, 540, 26);
      this.ctx.fillStyle = value >= 80 ? GREEN : '#ffd773';
      this.ctx.fillRect(290, y, 540 * THREE.MathUtils.clamp(value, 0, 100) / 100, 26);
      this._text(value + '%', 862, y + 24, 25);
    });
    if (r.physics) {
      const p = r.physics;
      this._text(`모델 지표(0~100) · 용입 ${p.penetration} · 흘러내림 ${p.runoff}`, 48, 535, 23, '#ffd773');
      this._text(`융합불량 ${p.fusionRisk} · 슬래그 ${p.slagRisk} · 실제 결함 판정 아님`, 48, 568, 23, DIM);
    }
    this._text((r.finishMoves !== undefined ? `마무리 편도 ${r.finishMoves}/4 · ` : '') +
      '아크 시간 ' + (r.arcTime ?? 0).toFixed(1) + '초 · 설정에서 다시 시작', 48, 602, 23, DIM);
  }
  dispose() {
    this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.texture.dispose();
  }
}
