// PC controls share the physical bench and scoreboard actions.
export class DesktopPanel {
  constructor(demo, bench, board, { rotate, home }) {
    Object.assign(this, { demo, bench, board });
    this.element = document.createElement('aside');
    this.element.id = 'desktop-settings';
    this.element.setAttribute('aria-label', 'PC 용접 설정');
    this.element.innerHTML = `
      <details open>
        <summary>설정 <span>PC MODE</span></summary>
        <div class="desktop-settings-content">
          <label class="desktop-exercise">연습 과제<select id="pc-exercise" aria-label="연습 과제"></select></label>
          <div class="desktop-button-row"><button data-action="previous">◀ 이전</button><button data-action="next">다음 ▶</button></div>
          <div class="desktop-height"><span>작업대 높이</span><output id="pc-height"></output></div>
          <div class="desktop-button-row"><button data-action="lower">− 낮추기</button><button data-action="raise">+ 높이기</button></div>
          <p class="desktop-hint">버튼: 5 cm씩 · Page Up / Down: 연속 조절</p>
          <div id="pc-positioner" hidden><div class="desktop-button-row"><button data-action="rotate-left">↶ 회전</button><button data-action="rotate-right">회전 ↷</button><button data-action="home">원위치</button></div></div>
          <div class="desktop-toggles">
            ${[['guides', '궤도 · 화살표 가이드'], ['ghost', '고스트 토치'], ['hud', '토치 HUD (게이지)'], ['start', '이어갈 지점 표시'], ['board', '전광판']].map(([key, label]) =>
              `<label class="desktop-toggle"><span>${label}</span><input type="checkbox" role="switch" data-setting="${key}"><span class="desktop-switch" aria-hidden="true"></span></label>`).join('')}
          </div>
          <p class="desktop-hint">HUD: 깊이·중앙은 자동 보정, 속도는 실제 운봉 표시</p>
          <div class="desktop-button-row"><button data-action="wide">작업대 전체</button><button data-action="focus">용접부 확대</button></div>
          <section id="pc-board" aria-label="실시간 전광판">
            <div class="desktop-height"><span>진행률</span><output id="pc-progress"></output></div>
            <div class="desktop-height"><span id="pc-arc">아크 OFF</span><output id="pc-time"></output></div>
            <div class="desktop-button-row"><button data-action="board-open">전광판 크게 보기</button></div>
          </section>
          <p class="desktop-hint">N / P 과제 전환 · F 시점 복귀 · R 다시 연습</p>
        </div>
      </details>`;
    document.body.append(this.element);
    if (window.innerWidth <= 700) this.element.querySelector('details').open = false;
    const select = this.element.querySelector('select');
    for (const example of demo.examples) select.add(new Option(example.source.title, example.id));
    select.addEventListener('change', () => demo.select(select.value));
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'pc-board-dialog';
    this.dialog.setAttribute('aria-label', '용접 전광판');
    this.dialog.innerHTML = '<form method="dialog"><button aria-label="전광판 닫기">닫기 ✕</button></form>';
    this.dialog.append(board.canvas);
    document.body.append(this.dialog);
    board.canvas.setAttribute('aria-label', '실시간 용접 전광판. 설정 버튼은 위의 PC 설정으로도 조작할 수 있습니다.');
    board.canvas.addEventListener('click', event => {
      const rect = board.canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width * board.canvas.width;
      const y = (event.clientY - rect.top) / rect.height * board.canvas.height;
      const button = board.buttons.find(b => b.enabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (button) board.activate(button.id);
    });
    this.element.addEventListener('change', event => {
      if (event.target.dataset.setting) demo.setSetting(event.target.dataset.setting, event.target.checked);
    });
    this.element.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      demo.releasePointer();
      if (action === 'previous' || action === 'next') demo.step(action === 'next' ? 1 : -1);
      if (action === 'raise' || action === 'lower') bench.activate(action);
      if (action === 'wide' || action === 'focus') demo.frameCamera(action === 'wide');
      if (action.startsWith('rotate-')) rotate(action === 'rotate-left' ? 1 : -1);
      if (action === 'home') home();
      if (action === 'board-open') { demo.pause(); board.refresh(); this.dialog.showModal(); }
    });
  }
  update() {
    const { demo, bench, board } = this;
    this.element.querySelector('#pc-height').value = `${Math.round((bench.shop.position.y + bench.bench.position.y) * 100)} cm`;
    this.element.querySelector('select').value = demo.active.id;
    this.element.querySelector('#pc-positioner').hidden = !demo.active.source.applied;
    for (const input of this.element.querySelectorAll('[data-setting]')) input.checked = demo.settings[input.dataset.setting];
    this.element.querySelector('#pc-board').hidden = !demo.settings.board;
    this.element.querySelector('#pc-progress').value = `${Math.round(demo.progress * 100)}%`;
    this.element.querySelector('#pc-time').value = `${demo.arcTime.toFixed(1)}초`;
    this.element.querySelector('#pc-arc').textContent = demo.arcOn ? '● 용접 중' : '아크 OFF';
    if (!demo.settings.board && this.dialog.open) this.dialog.close();
    board.setVisible(demo.settings.board);
    this.element.querySelector('[data-action="lower"]').disabled = bench.targetHeight <= bench.minHeight;
    this.element.querySelector('[data-action="raise"]').disabled = bench.targetHeight >= bench.maxHeight;
  }
}
