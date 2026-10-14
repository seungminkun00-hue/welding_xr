// Headless check of the seam math, the grader and bead deposition.
// Run with:  node selftest.mjs      (needs `npm install three@0.160.0`)
import * as THREE from 'three';
import { WeldSeam } from './src/WeldSeam.js';
import { WeldSession } from './src/WeldSession.js';
import { WeldBead } from './src/WeldBead.js';
import { LinearGuide } from './src/LinearGuide.js';

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Measure the deposited cross-section, independent of vertex-count changes.
function section(bead, t = 0.5) {
  const cols = bead.count / (bead.segments + 1), row = Math.round(t * bead.segments);
  const sides = bead.mesh.geometry.attributes.aSide.array;
  let min = Infinity, max = -Infinity, mass = 0, moment = 0;
  for (let c = 0; c < cols; c++) {
    const v = row * cols + c, x = sides[v] * bead.halfWidth, fill = bead.aFill[v];
    if (fill > 0.02) { min = Math.min(min, x); max = Math.max(max, x); }
    mass += fill; moment += x * fill;
  }
  return { width: mass ? max - min : 0, center: mass ? moment / mass : 0 };
}

const SEAM_LENGTH = 0.24;
const seam = new WeldSeam({
  start: new THREE.Vector3(0, 0, SEAM_LENGTH / 2),
  end: new THREE.Vector3(0, 0, -SEAM_LENGTH / 2),
  normal: new THREE.Vector3(0, 1, 0),
});

// -- seam frame ------------------------------------------------------------
check('seam length', near(seam.length, SEAM_LENGTH, 1e-9), seam.length.toFixed(4));
check('travel runs away from the welder', near(seam.travel.z, -1, 1e-9));
check('lateral is the welder right-hand axis', near(seam.lateral.x, 1, 1e-9));

const mid = seam.pointAt(0.5, new THREE.Vector3());
check('midpoint sits at the origin', mid.length() < 1e-9);

const probe = new THREE.Vector3(0.004, 0.010, 0); // 4mm right, 10mm up, halfway
const c = seam.decompose(probe);
check('decompose t', near(c.t, 0.5, 1e-9), c.t.toFixed(4));
check('decompose lateral', near(c.lateral, 0.004, 1e-9), c.lateral.toFixed(4));
check('decompose height', near(c.height, 0.010, 1e-9), c.height.toFixed(4));

// -- a pass driven by a scripted torch -------------------------------------
/** Nozzle direction for a given push/roll, matching main.js. */
function forward(travelDeg, workDeg) {
  return seam.normal
    .clone()
    .negate()
    .applyAxisAngle(seam.lateral, THREE.MathUtils.degToRad(travelDeg))
    .applyAxisAngle(seam.travel, THREE.MathUtils.degToRad(workDeg))
    .normalize();
}

function runPass({ speed, standoff, lateral, travelDeg, workDeg, label }) {
  const session = new WeldSession(seam);
  const bead = new WeldBead(seam ? { add() {}, remove() {} } : null, seam);
  const dt = 1 / 90;
  const fwd = forward(travelDeg, workDeg);
  let travelled = 0;
  let last = null;

  for (let i = 0; i < 20000 && !session.finished; i++) {
    travelled += speed * dt;
    const tip = seam.start
      .clone()
      .addScaledVector(seam.travel, travelled)
      .addScaledVector(seam.lateral, lateral)
      .addScaledVector(seam.normal, standoff);
    const m = session.sample(dt, tip, fwd, true);
    if (m.welding) {
      bead.deposit(dt, {
        t: THREE.MathUtils.clamp(m.t, 0, 1),
        lateral: m.lateral,
        speedRatio: m.speedRatio,
        quality: m.quality,
      });
    }
    bead.update(dt, { arcOn: m.welding, point: seam.pointAt(THREE.MathUtils.clamp(m.t, 0, 1)) });
    last = m;
    if (travelled > SEAM_LENGTH * 1.3) break;
  }

  const report = session.report(bead.getStats());
  console.log(
    `      ${label}: total=${report.total} depth=${report.depth} center=${report.center} ` +
      `speed=${report.speed} coverage=${report.coverage} finished=${session.finished}`
  );
  return { session, bead, report, last };
}

// A textbook pass: nominal standoff, dead on the seam, nominal push, ideal speed.
const good = runPass({
  speed: 0.010,
  standoff: 0.010,
  lateral: 0,
  travelDeg: 15,
  workDeg: 0,
  label: 'textbook',
});
check('textbook pass finishes', good.session.finished);
check('textbook depth reading is centred', near(good.last.depthErr, 0, 0.01), good.last.depthErr.toFixed(3));
check('textbook crosshair is centred', Math.hypot(good.last.center.x, good.last.center.y) < 0.01);
check('textbook needle sits mid-dial', near(good.last.speedFraction, 0.5, 0.05), good.last.speedFraction.toFixed(3));
check('textbook scores high', good.report.total >= 95, String(good.report.total));
check('textbook bead covers the seam', good.bead.getStats().coverage > 0.95);
check('textbook bead quality is high', good.bead.getStats().quality > 0.9);

// Too fast, torch held too high, drifting off the seam.
const sloppy = runPass({
  speed: 0.022,
  standoff: 0.019,
  lateral: 0.006,
  travelDeg: 15,
  workDeg: 0,
  label: 'sloppy',
});
check('sloppy pass scores lower than textbook', sloppy.report.total < good.report.total - 30, String(sloppy.report.total));
check('sloppy depth reads too far', sloppy.last.depthErr > 1, sloppy.last.depthErr.toFixed(2));
check('sloppy crosshair is off centre', Math.abs(sloppy.last.center.x) > 1, sloppy.last.center.x.toFixed(2));
check('sloppy needle is past the green band', sloppy.last.speedFraction > 0.62, sloppy.last.speedFraction.toFixed(3));
check('sloppy bead is thinner than textbook', section(sloppy.bead).width < section(good.bead).width);

// Crawling: the bead should pile up wider than the textbook pass.
const slow = runPass({
  speed: 0.004,
  standoff: 0.010,
  lateral: 0,
  travelDeg: 15,
  workDeg: 0,
  label: 'crawling',
});
check('crawling needle is below the green band', slow.last.speedFraction < 0.38, slow.last.speedFraction.toFixed(3));
check('crawling bead is wider than textbook', section(slow.bead).width > section(good.bead).width);

// A drifting torch must drag the bead off the centreline with it.
const drift = runPass({
  speed: 0.010,
  standoff: 0.010,
  lateral: 0.007,
  travelDeg: 15,
  workDeg: 0,
  label: 'off-seam',
});
check('bead follows the torch off the seam', near(section(drift.bead).center, 0.007, 0.001),
  section(drift.bead).center.toFixed(4));

// Both side dwells must survive; the newest stroke cannot drag the old bead.
{
  const bead = new WeldBead(new THREE.Group(), seam);
  bead.visualDetails = false;
  const point = seam.pointAt(0.5), dt = 1 / 90;
  const dwell = lateral => {
    for (let i = 0; i < 90; i++) {
      bead.deposit(dt, { t: 0.5, lateral, speedRatio: 1, quality: 1 });
      bead.update(dt, { arcOn: true, point, t: 0.5 });
    }
    bead.update(dt, { arcOn: false, point, t: 0.5 });
  };
  dwell(-0.006);
  const leftHeight = bead._heightAt(0.5, -0.006);
  dwell(0.006);
  check('weave retains the earlier side dwell', bead._heightAt(0.5, -0.006) >= leftHeight * 0.99);
  check('weave deposits on both sides', leftHeight > 0.001 && bead._heightAt(0.5, 0.006) > 0.001);
  check('wide weave broadens the finished bead', section(bead).width > section(good.bead).width * 1.5);
  const rightHeight = bead._heightAt(0.5, 0.006);
  dwell(0.006);
  check('longer edge dwell adds local height', bead._heightAt(0.5, 0.006) > rightHeight);
  bead.dispose();
}

// Gravity moves molten metal without adding volume, then stops on cooling.
{
  const parent = new THREE.Group(); parent.rotation.z = Math.PI / 2;
  const bead = new WeldBead(parent, seam, { gravity: true });
  bead.visualDetails = false;
  for (let i = 0; i < 90; i++) bead.deposit(1 / 90, { t: 0.5, lateral: 0, speedRatio: 1, quality: 1 });
  const mass = () => bead.aFill.reduce((sum, value) => sum + value, 0);
  const before = mass(), point = seam.pointAt(0.5);
  for (let i = 0; i < 720; i++) bead.update(1 / 90, { arcOn: false, point, passive: true });
  check('molten flow conserves deposited volume', near(mass(), before, before * 0.0001));
  check('rotated workpiece uses world gravity', section(bead).center < -0.0001);
  const frozen = bead.aFill.slice();
  for (let i = 0; i < 90; i++) bead.update(1 / 90, { arcOn: false, point, passive: true });
  check('cooled bead keeps its shape', frozen.every((value, i) => value === bead.aFill[i]));
  bead.reset();
  check('reset clears both deposited metal and heat', mass() === 0 && bead.hotRows.size === 0);
  bead.dispose();
}

// Travel angle shows up on the crosshair's vertical axis, not the horizontal.
const dragged = runPass({
  speed: 0.010,
  standoff: 0.010,
  lateral: 0,
  travelDeg: -20,
  workDeg: 0,
  label: 'dragging',
});
check('wrong travel angle pushes the dot vertically',
  dragged.last.center.y < -1 && Math.abs(dragged.last.center.x) < 0.01,
  `y=${dragged.last.center.y.toFixed(2)}`);

// -- the blue path is only consumed by real welding ------------------------
// The marker used to slide along from the travel-axis projection alone, so
// waving the torch past the joint -- off to one side, or up in the air --
// quietly ate the remaining path.
{
  const guide = new LinearGuide(new THREE.Group(), seam);
  const dt = 1 / 60;
  const step = (state) => {
    for (let i = 0; i < 120; i++) guide.update(dt, state);
  };

  step({ cursorT: 0.4, progressT: 0.4, onSeam: true, arcOn: true, severity: 0 });
  check('ring tracks the torch while it is on the seam', near(guide.cursorT, 0.4, 1e-9));
  check('path is consumed up to the welded progress', near(guide.centerLine.material.uniforms.uCursor.value, 0.4, 1e-9));
  check('ring reads as engaged on the seam', guide.engaged > 0.99, guide.engaged.toFixed(3));

  step({ cursorT: 0.95, progressT: 0.4, onSeam: false, arcOn: false, severity: 0 });
  check('ring holds position once the torch leaves the seam', near(guide.cursorT, 0.4, 1e-9), guide.cursorT.toFixed(3));
  check('wandering off does not consume the path', near(guide.centerLine.material.uniforms.uCursor.value, 0.4, 1e-9));
  check('chevrons also stay anchored to welded progress', near(guide.chevrons.material.uniforms.uCursor.value, 0.4, 1e-9));
  check('ring reads as disengaged off the seam', guide.engaged < 0.01, guide.engaged.toFixed(3));

  step({ cursorT: 0.55, progressT: 0.4, onSeam: true, arcOn: false, severity: 0 });
  check('ring picks the torch back up on return', near(guide.cursorT, 0.55, 1e-9));
}

// Travelling the whole joint with the trigger released must leave the path
// untouched -- progress is welding, not movement.
{
  const dry = new WeldSession(seam);
  const dt = 1 / 60;
  const fwd = forward(15, 0);
  for (let i = 0; i < 2000; i++) {
    const tip = seam.start
      .clone()
      .addScaledVector(seam.travel, (i / 2000) * SEAM_LENGTH)
      .addScaledVector(seam.normal, 0.010);
    dry.sample(dt, tip, fwd, false);
  }
  check('a dry run with no arc makes no progress', dry.maxT === 0, String(dry.maxT));
  check('a dry run never reports finished', dry.finished === false);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
