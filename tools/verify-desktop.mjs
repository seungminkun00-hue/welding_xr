import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Run with the HTTP server on 8778, or supply WELD_TEST_URL.
const base = process.env.WELD_TEST_URL ?? 'http://localhost:8778';
const artifacts = path.resolve('.browser-check');
await mkdir(artifacts, { recursive: true });
const child = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless', '--no-sandbox', '--remote-debugging-port=9338', '--enable-unsafe-swiftshader',
  `--user-data-dir=${path.join(artifacts, 'desktop-profile')}`, '--window-size=1440,1000', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let tabs;
  for (let i = 0; i < 40; i++) {
    try { tabs = await (await fetch('http://localhost:9338/json')).json(); break; } catch { await sleep(200); }
  }
  assert.ok(tabs, 'Chrome debugging endpoint');
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (request) message.error ? request.reject(message.error) : request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async expression => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate('!!window.weldReady && !!window.weldDebug')) return;
      await sleep(200);
    }
    throw new Error(`Boot timeout: ${JSON.stringify(errors)}`);
  };
  const screenshot = async name => {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(artifacts, name), Buffer.from(shot.data, 'base64'));
  };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.navigate', { url: `${base}/?debug=1` }); await ready();
  await evaluate(`localStorage.removeItem('welding-pc-settings-v1'); for (const key in weldDebug.webDemo.settings) weldDebug.webDemo.setSetting(key, true);`);
  console.log('BOOT', await evaluate(`({ready:weldReady, tasks:weldDebug.webDemo.examples.length, board:weldDebug.board.mesh.visible, bench:weldDebug.benchControls.group.visible})`));
  assert.equal(await evaluate('weldDebug.board.mesh.visible && weldDebug.benchControls.group.visible'), true);
  const oldHeight = await evaluate('weldDebug.shop.position.y');
  await evaluate(`document.querySelector('[data-action="raise"]').click()`); await sleep(850);
  assert.ok(await evaluate(`weldDebug.shop.position.y > ${oldHeight + 0.04}`), 'height button raises physical bench');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'PageDown', key: 'PageDown', windowsVirtualKeyCode: 34 });
  await sleep(600);
  await call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'PageDown', key: 'PageDown', windowsVirtualKeyCode: 34 });
  assert.ok(await evaluate(`weldDebug.shop.position.y < ${oldHeight + 0.02}`), 'PageDown lowers bench');
  await evaluate(`document.querySelector('[data-web-mode="practice"]').click()`);
  await sleep(150);
  assert.equal(await evaluate(`weldDebug.webDemo.active.guide.chevrons.isMesh && weldDebug.webDemo.active.guide.edges.length === 2 && weldDebug.webDemo.active.poseGuide.travel.visible && weldDebug.webDemo.hud.mesh.visible`), true, 'original arrows, boundaries and HUD are restored');
  await screenshot('desktop-guides-hud.png');
  await evaluate(`document.querySelector('[data-setting="guides"]').click()`); await sleep(100);
  assert.deepEqual(await evaluate(`({guide:weldDebug.webDemo.active.guide.group.visible, arrow:weldDebug.webDemo.active.poseGuide.travel.visible, ghost:weldDebug.webDemo.active.ghost.visible, hud:weldDebug.webDemo.hud.mesh.visible})`), {guide:false, arrow:false, ghost:true, hud:true}, 'guide, ghost and HUD switches are independent');
  await evaluate(`document.querySelector('[data-setting="guides"]').click()`);
  for (const key of ['guides', 'ghost', 'start', 'board', 'hud']) {
    await evaluate(`document.querySelector('[data-setting="${key}"]').click()`); await sleep(100);
  }
  assert.deepEqual(await evaluate(`({path:weldDebug.webDemo.active.guide.group.visible, ghost:weldDebug.webDemo.active.ghost.visible, start:weldDebug.webDemo.active.start.visible, board:weldDebug.board.mesh.visible, hud:weldDebug.webDemo.hud.mesh.visible})`), { path:false, ghost:false, start:false, board:false, hud:false });
  await call('Page.reload'); await ready();
  assert.equal(await evaluate('Object.values(weldDebug.webDemo.settings).every(value => value === false)'), true, 'settings survive reload');
  for (const key of ['guides', 'ghost', 'start', 'board', 'hud']) await evaluate(`document.querySelector('[data-setting="${key}"]').click()`);
  await evaluate(`document.querySelector('[data-web-mode="practice"]').click()`);
  // Move a real browser pointer along the projected seam, then weld it.
  const pointAt = async p => evaluate(`(() => {
    const d = weldDebug.webDemo, v = d.point.clone();
    d.samplePoint(d.active.strokes[d.strokeIndex], ${p}, v);
    d.active.group.localToWorld(v).project(weldDebug.camera);
    return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2};
  })()`);
  const first = await pointAt(0);
  const along = await pointAt(1);
  const skipped = await pointAt(0.65);
  const length = Math.hypot(along.x - first.x, along.y - first.y);
  skipped.x += -(along.y - first.y) / length * 90;
  skipped.y += (along.x - first.x) / length * 90;
  await call('Input.dispatchMouseEvent', { type:'mouseMoved', ...skipped }); await sleep(450);
  await call('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', buttons:1, clickCount:1, ...skipped }); await sleep(200);
  assert.ok(await evaluate('weldDebug.webDemo.progress > 0 && weldDebug.webDemo.progress < 0.4 && weldDebug.webDemo.arcOn'), 'rough 90px-offset re-entry reconnects and welds continuously instead of rejecting or teleporting');
  await call('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...skipped });
  await call('Input.dispatchMouseEvent', { type:'mouseMoved', ...first }); await sleep(450);
  await call('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', buttons:1, clickCount:1, ...first });
  for (let i = 1; i <= 30; i++) {
    await call('Input.dispatchMouseEvent', { type:'mouseMoved', buttons:1, ...(await pointAt(i / 30 * 0.97)) });
    await sleep(120);
  }
  await sleep(400);
  await call('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...(await pointAt(1)) });
  console.log('PRACTICE', await evaluate(`({progress:weldDebug.webDemo.progress, arcTime:weldDebug.webDemo.arcTime, p:weldDebug.webDemo.p})`));
  assert.equal(await evaluate('weldDebug.webDemo.progress'), 1, 'rough gesture finishes without pixel-perfect endpoint aim');
  assert.equal(await evaluate('weldDebug.webDemo.arcOn'), false, 'release extinguishes arc');
  await evaluate(`document.querySelector('[data-action="board-open"]').click()`);
  assert.equal(await evaluate('document.querySelector("#pc-board-dialog").open'), true);
  await screenshot('desktop-scoreboard.png');
  await evaluate('document.querySelector("#pc-board-dialog").close()');
  await screenshot('desktop-practice.png');
  if (!process.argv.includes('--smoke')) {
  const ids = await evaluate('weldDebug.webDemo.examples.map(e => e.id)');
  for (const id of ids) {
    await evaluate(`weldDebug.webDemo.select(${JSON.stringify(id)})`); await sleep(150);
    assert.equal(await evaluate('weldDebug.webDemo.active.group.visible && weldDebug.camera.position.toArray().every(Number.isFinite)'), true);
  }
  await evaluate(`document.querySelector('[data-action="previous"]').click()`);
  assert.equal(await evaluate('weldDebug.webDemo.active.id'), ids.at(-2));
  await evaluate(`document.querySelector('[data-action="next"]').click()`);
  assert.equal(await evaluate('weldDebug.webDemo.active.id'), ids.at(-1));
  await screenshot('desktop-applied.png');
  await evaluate(`weldDebug.webDemo.select('pipe'); document.querySelector('[data-action="wide"]').click()`); await sleep(150);
  await screenshot('desktop-bench.png');
  // A projected physical button must consume the gesture and change the task.
  const next = await evaluate(`(() => { const d=weldDebug, v=d.benchControls.picks.find(b=>b.userData.action==='next').getWorldPosition(d.camera.position.clone()).project(d.camera); return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2}; })()`);
  await call('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', buttons:1, clickCount:1, ...next });
  await call('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...next });
  assert.equal(await evaluate('weldDebug.webDemo.active.id'), ids[2], 'physical next button changes task');
  await call('Page.navigate', { url: `${base}/pipe.html?debug=1` }); await ready();
  assert.equal(await evaluate('weldDebug.webDemo.active.id'), 'pipe', 'pipe entry retains its task');
  await evaluate(`weldDebug.webDemo.setMode('practice')`);
  await sleep(150);
  assert.equal(await evaluate('weldDebug.webDemo.active.guide.strokes[0].chevrons.isMesh && weldDebug.webDemo.active.guide.activeIndex === 0'), true, 'pipe uses the original curved guide');
  await screenshot('desktop-pipe-guides.png');
  // All pipe strokes must remain reachable, including arc-break transfers.
  const count = await evaluate('weldDebug.webDemo.active.strokes.length');
  for (let stroke = 0; stroke < count; stroke++) {
    const start = await pointAt(0);
    await call('Input.dispatchMouseEvent', { type:'mouseMoved', ...start }); await sleep(250);
    await call('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', buttons:1, clickCount:1, ...start });
    for (let i = 1; i <= 30; i++) {
      await call('Input.dispatchMouseEvent', { type:'mouseMoved', buttons:1, ...(await pointAt(i / 30)) });
      await sleep(85);
    }
    await sleep(200);
    await call('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...(await pointAt(1)) });
    await sleep(1650);
    console.log('PIPE STROKE', stroke, await evaluate('({index:weldDebug.webDemo.strokeIndex,p:weldDebug.webDemo.p,progress:weldDebug.webDemo.progress})'));
    if (stroke < count - 1) assert.equal(await evaluate('weldDebug.webDemo.strokeIndex'), stroke + 1, 'pipe advances after arc release');
  }
  assert.ok(await evaluate('weldDebug.webDemo.progress > 0.99'), 'pipe mouse practice completes');
  await call('Page.navigate', { url: `${base}/application.html?debug=1` }); await ready();
  assert.equal(await evaluate('weldDebug.webDemo.active.source.applied'), true, 'application entry retains its task');
  await call('Emulation.setDeviceMetricsOverride', { width:900, height:700, deviceScaleFactor:1, mobile:false });
  await evaluate(`weldDebug.webDemo.select('plate')`); await sleep(150);
  await screenshot('desktop-compact.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal overflow');
  await call('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
  await call('Page.reload'); await ready();
  assert.equal(await evaluate('document.querySelector("#desktop-settings > details").open'), false, 'small screen starts with compact settings');
  await screenshot('desktop-mobile.png');
  }
  console.log('ERRORS', errors);
  assert.equal(errors.length, 0);
  console.log('Desktop browser checks passed.');
} finally { ws?.close(); child.kill(); }
