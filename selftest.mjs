// Headless check of the seam math, the grader and bead deposition.
// Run with:  node selftest.mjs      (needs `npm install three@0.160.0`)
import * as THREE from 'three';
import { WeldSeam } from './src/WeldSeam.js';
import { WeldSession } from './src/WeldSession.js';
import { WeldBead } from './src/WeldBead.js';

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

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
check('sloppy bead is thinner than textbook', sloppy.bead.aWidth[400] < good.bead.aWidth[400],
  `${sloppy.bead.aWidth[400].toFixed(2)} vs ${good.bead.aWidth[400].toFixed(2)}`);

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
check('crawling bead is wider than textbook', slow.bead.aWidth[400] > good.bead.aWidth[400],
  `${slow.bead.aWidth[400].toFixed(2)} vs ${good.bead.aWidth[400].toFixed(2)}`);

// A drifting torch must drag the bead off the centreline with it.
const drift = runPass({
  speed: 0.010,
  standoff: 0.010,
  lateral: 0.007,
  travelDeg: 15,
  workDeg: 0,
  label: 'off-seam',
});
check('bead follows the torch off the seam', near(drift.bead.aOffset[400], 0.007, 0.001),
  drift.bead.aOffset[400].toFixed(4));

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

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
