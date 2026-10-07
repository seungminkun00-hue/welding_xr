// Headless check of the curved seam, the stroke plan and the multi-stroke
// grader. Run with:  node selftest-pipe.mjs
import * as THREE from 'three';
import { pipeFilletSeam } from './src/SeamCurve.js';
import { pipeFilletPlan } from './src/PassPlan.js';
import { JointSession } from './src/JointSession.js';
import { WeldBead } from './src/WeldBead.js';
import { CurvedGuide } from './src/CurvedGuide.js';

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const R = 0.0335;
const seam = pipeFilletSeam({
  center: new THREE.Vector3(0, 0, 0),
  wallNormal: new THREE.Vector3(0, 0, 1),
  up: new THREE.Vector3(0, 1, 0),
  radius: R,
});

// -- the circle ------------------------------------------------------------
check('seam closes on itself', seam.closed === true);
check(
  'arc length is the circumference',
  near(seam.length, 2 * Math.PI * R, 1e-5),
  `${(seam.length * 1000).toFixed(2)}mm vs ${(2 * Math.PI * R * 1000).toFixed(2)}mm`
);

const top = seam.pointAt(0, new THREE.Vector3());
check('t = 0 is twelve o\'clock', near(top.y, R, 1e-6) && near(top.x, 0, 1e-6), `y=${top.y.toFixed(4)}`);
const bottom = seam.pointAt(0.5, new THREE.Vector3());
check('t = 0.5 is six o\'clock', near(bottom.y, -R, 1e-5), `y=${bottom.y.toFixed(4)}`);
const three = seam.pointAt(0.25, new THREE.Vector3());
check(
  't = 0.25 is three o\'clock, not nine',
  three.x > 0 && near(three.x, R, 1e-5),
  `x=${three.x.toFixed(4)}`
);
check('clockAt names the hour', near(seam.clockAt(0.25), 3, 1e-6), seam.clockAt(0.25).toFixed(2));

// -- the frame -------------------------------------------------------------
// This is the thing the whole design rests on: a frame taken from the JOINT,
// not from the curve. Frenet would point the normal at the centre of the
// circle, which is not where an electrode goes.
const f0 = seam.frameAt(0);
check(
  'normal at twelve bisects pipe wall and face at 45 degrees',
  near(f0.normal.y, Math.SQRT1_2, 1e-3) && near(f0.normal.z, Math.SQRT1_2, 1e-3),
  `(${f0.normal.x.toFixed(3)}, ${f0.normal.y.toFixed(3)}, ${f0.normal.z.toFixed(3)})`
);
check(
  'normal is not the Frenet normal (which would point at the centre)',
  f0.normal.dot(new THREE.Vector3(0, -1, 0)) < 0.9
);
check('travel at twelve heads towards three o\'clock', near(f0.travel.x, 1, 1e-3), f0.travel.x.toFixed(3));
check('frame is orthonormal', Math.abs(f0.travel.dot(f0.normal)) < 1e-6);

const f6 = seam.frameAt(0.5);
check(
  'normal at six points down and out (overhead)',
  f6.normal.y < -0.6 && f6.normal.z > 0.6,
  `(${f6.normal.x.toFixed(3)}, ${f6.normal.y.toFixed(3)}, ${f6.normal.z.toFixed(3)})`
);
// A 45 degree fillet frame sweeps a cone, not a plane: twelve and six are a
// quarter turn apart, not opposed. Asserting the normals are antiparallel
// would be asserting the joint is a butt weld.
check(
  'the frame sweeps a 45 degree cone round the seam',
  near(f0.normal.dot(f6.normal), 0, 1e-3),
  `dot=${f0.normal.dot(f6.normal).toFixed(3)}`
);
check(
  'the frame really does turn (lateral axis at six differs from twelve)',
  f0.lateral.dot(f6.lateral) < 0.1,
  `dot=${f0.lateral.dot(f6.lateral).toFixed(3)}`
);

// -- decompose round trip --------------------------------------------------
for (const t of [0.0, 0.17, 0.5, 0.83]) {
  const fr = seam.frameAt(t);
  const probe = seam
    .pointAt(t, new THREE.Vector3())
    .addScaledVector(fr.lateral, 0.0012)
    .addScaledVector(fr.normal, 0.003);
  const c = seam.decompose(probe);
  const dt = Math.abs(seam.deltaT(t, c.t));
  check(
    `decompose round trip at t=${t}`,
    dt < 0.002 && near(c.lateral, 0.0012, 2e-4) && near(c.height, 0.003, 2e-4),
    `dt=${dt.toFixed(5)} lat=${c.lateral.toFixed(5)} h=${c.height.toFixed(5)}`
  );
}

// -- wrap ------------------------------------------------------------------
check('deltaT across twelve is a small step forward', near(seam.deltaT(0.99, 0.01), 0.02, 1e-9), seam.deltaT(0.99, 0.01).toFixed(4));
check('deltaT backwards across twelve is negative', near(seam.deltaT(0.01, 0.99), -0.02, 1e-9));

// -- the stroke plan -------------------------------------------------------
const plan = pipeFilletPlan(seam);
check('the joint is two strokes, not one lap', plan.strokes.length === 2);

const [A, B] = plan.strokes;
check('each stroke is half the circle', near(A.span, 0.5, 1e-9) && near(B.span, 0.5, 1e-9));
check('both strokes strike at six o\'clock', near(A.tAt(0), 0.5, 1e-9) && near(B.tAt(0), 0.5, 1e-9));
check('both strokes finish at twelve o\'clock', near(A.tAt(1) % 1, 0, 1e-9) && near(B.tAt(1) % 1, 0, 1e-9));
check('stroke A climbs the nine o\'clock side', near(A.tAt(0.5), 0.75, 1e-9), A.tAt(0.5).toFixed(3));
check('stroke B climbs the three o\'clock side', near(B.tAt(0.5), 0.25, 1e-9), B.tAt(0.5).toFixed(3));
check('the strokes run opposite ways round the seam', A.dir === -B.dir);
check(
  'progressOf inverts tAt on both strokes',
  near(A.progressOf(0.75), 0.5, 1e-6) && near(B.progressOf(0.25), 0.5, 1e-6)
);
check('stroke B overlaps stroke A at the strike', B.tieIn.lead > 0);

// Weave: a 2D figure in (progress, lateral). Amplitude has to stay inside the
// zone, or the guide is drawing a target the grader will fail.
let maxWeave = 0;
for (let i = 0; i <= 200; i++) maxWeave = Math.max(maxWeave, Math.abs(A.lateralAt(i / 200, seam.length)));
check('weave stays inside the weld zone', maxWeave < 0.0055, `${(maxWeave * 1000).toFixed(2)}mm`);

// -- a scripted master pass ------------------------------------------------
const fakeParent = { add() {}, remove() {} };
const _fr = { travel: new THREE.Vector3(), normal: new THREE.Vector3(), lateral: new THREE.Vector3() };

function rodForward(frame, travelDeg, workDeg) {
  return frame.normal
    .clone()
    .negate()
    .applyAxisAngle(frame.lateral, THREE.MathUtils.degToRad(travelDeg))
    .applyAxisAngle(frame.travel, THREE.MathUtils.degToRad(workDeg))
    .normalize();
}

/**
 * @param {object} err deviations from the master: speedScale, standoffErr,
 *                     lateralErr, workErr, reverse, skipTieIn
 */
function runJoint(err = {}) {
  const p2 = pipeFilletPlan(seam);
  const session = new JointSession(seam, p2);
  const bead = new WeldBead(fakeParent, seam, { segments: 160 });
  const dt = 1 / 90;

  for (let s = 0; s < p2.strokes.length; s++) {
    const stroke = p2.strokes[s];
    const strokeLength = stroke.span * seam.length;
    const lead = stroke.leadP(seam.length);
    let p = err.skipTieIn ? 0 : -lead;
    let guard = 0;

    while (p < 1.02 && guard++ < 40000) {
      const clamped = THREE.MathUtils.clamp(p, 0, 1);
      const target = stroke.sample(clamped);
      const speed = target.speed * (err.speedScale ?? 1);
      p += ((speed * (err.reverse ? -1 : 1)) / strokeLength) * dt;

      const t = stroke.tAt(THREE.MathUtils.clamp(p, -0.1, 1.1));
      const frame = seam.frameAt(t, _fr);
      const lateral = stroke.lateralAt(clamped, seam.length) + (err.lateralErr ?? 0);
      const height = target.standoff + (err.standoffErr ?? 0);
      const tip = seam
        .pointAt(t, new THREE.Vector3())
        .addScaledVector(frame.lateral, lateral)
        .addScaledVector(frame.normal, height);
      const fwd = rodForward(frame, target.travelAngle, target.workAngle + (err.workErr ?? 0));

      const m = session.sample(dt, tip, fwd, true);
      if (m.welding) {
        bead.deposit(dt, { t: m.t, lateral: m.lateral, speedRatio: Math.abs(m.speedRatio), quality: m.quality });
      }
      if (err.reverse && p < -0.3) break;
    }

    // Break the arc. Without this the plan never advances, which is the point:
    // one continuous lap must not satisfy two strokes.
    for (let i = 0; i < 20; i++) {
      const frame = seam.frameAt(stroke.tAt(1), _fr);
      const tip = seam.pointAt(stroke.tAt(1), new THREE.Vector3()).addScaledVector(frame.normal, 0.05);
      session.sample(dt, tip, rodForward(frame, 0, 0), false);
    }
  }

  return { session, report: session.report(bead.getStats()), plan: p2 };
}

const master = runJoint();
check('master pass completes both strokes', master.plan.index >= 2, `index=${master.plan.index}`);
check('master pass is marked finished', master.session.finished === true);
check('master stroke A covered', master.report.strokes[0].coverage >= 97, `${master.report.strokes[0].coverage}%`);
check('master stroke B covered', master.report.strokes[1].coverage >= 97, `${master.report.strokes[1].coverage}%`);
check('master arc length scores high', master.report.arc >= 90, `${master.report.arc}%`);
check('master speed scores high', master.report.speed >= 90, `${master.report.speed}%`);
check('master centre scores high', master.report.center >= 90, `${master.report.center}%`);
check('master direction is clean', master.report.direction >= 99, `${master.report.direction}%`);
check('master total is high', master.report.total >= 85, `${master.report.total}점`);

// -- the errors the stroke model exists to catch ---------------------------
const fast = runJoint({ speedScale: 2.2 });
check('running too fast is caught', fast.report.speed < 40, `${fast.report.speed}%`);
check('a fast pass still scores below the master', fast.report.total < master.report.total, `${fast.report.total} < ${master.report.total}`);

const longArc = runJoint({ standoffErr: 0.004 });
check('a long arc is caught', longArc.report.arc < 30, `${longArc.report.arc}%`);

const rolled = runJoint({ workErr: 30 });
check('losing the 45 degree work angle is caught', rolled.report.work < 30, `${rolled.report.work}%`);
check('a rolled electrode drops the total', rolled.report.total < master.report.total - 10, `${rolled.report.total} vs ${master.report.total}`);
check('master work angle scores high', master.report.work >= 95, `${master.report.work}%`);

const offCentre = runJoint({ lateralErr: 0.004 });
check('drifting off the joint centre is caught', offCentre.report.center < 40, `${offCentre.report.center}%`);

const noTieIn = runJoint({ skipTieIn: true });
check(
  'striking short of the tie-in scores worse than striking into it',
  noTieIn.report.tieIn < master.report.tieIn,
  `${noTieIn.report.tieIn}% vs ${master.report.tieIn}%`
);

// -- one continuous lap must not pass as two strokes -----------------------
{
  const p3 = pipeFilletPlan(seam);
  const session = new JointSession(seam, p3);
  const dt = 1 / 90;
  const stroke = p3.strokes[0];
  const strokeLength = stroke.span * seam.length;
  let p = 0;
  // Keep the arc on and keep going round past the end of stroke A.
  for (let i = 0; i < 40000 && p < 2.5; i++) {
    const target = stroke.sample(THREE.MathUtils.clamp(p, 0, 1));
    p += (target.speed / strokeLength) * dt;
    const t = stroke.tAt(p);
    const frame = seam.frameAt(t, _fr);
    const tip = seam
      .pointAt(t, new THREE.Vector3())
      .addScaledVector(frame.normal, target.standoff);
    session.sample(dt, tip, rodForward(frame, target.travelAngle, 0), true);
  }
  check(
    'one unbroken lap does not advance past the first stroke',
    p3.index === 0,
    `index=${p3.index}`
  );
  check('one unbroken lap does not finish the joint', session.finished === false);
}

// -- the guide -------------------------------------------------------------
{
  const parent = new THREE.Group();
  const p4 = pipeFilletPlan(seam);
  const guide = new CurvedGuide(parent, seam, p4, { zoneHalfWidth: 0.0055, segments: 32 });
  check('the guide draws one ribbon set per stroke', guide.strokes.length === 2);
  check('the guide never draws an unbroken ring', guide.strokes.every((g) => g.stroke.span < 1));
  check('each stroke has a strike mark and a stop mark', guide.strokes.every((g) => g.strikeMark && g.stopMark));
  check('stroke B shows a tie-in overlap', guide.strokes[1].tieIns.length >= 1);

  guide.update(1 / 90, { strokeIndex: 0, progressP: 0.3, cursorT: 0.6, onSeam: true, arcOn: true, severity: 0 });
  check('only the live stroke is drawn at full strength', guide.strokes[0].active && !guide.strokes[1].active);
  const dim = guide.strokes[1].centerLine.material.uniforms.uOpacity.value;
  check('the upcoming stroke is dimmed, not hidden', dim > 0 && dim < 0.5, dim.toFixed(2));

  guide.update(1 / 90, { strokeIndex: 1, progressP: 0.1, cursorT: 0.4, onSeam: true, arcOn: true, severity: 0 });
  check('the guide follows the plan to the next stroke', guide.strokes[1].active && !guide.strokes[0].active);

  // The contact marker lies in the joint, so on a pipe it has to re-aim.
  const q0 = guide.ring.quaternion.clone();
  guide.update(1 / 90, { strokeIndex: 1, progressP: 0.5, cursorT: 0.9, onSeam: true, arcOn: true, severity: 0 });
  check('the contact marker re-aims as the surface turns', q0.angleTo(guide.ring.quaternion) > 0.5, `${((q0.angleTo(guide.ring.quaternion) * 180) / Math.PI).toFixed(0)}deg`);
}

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
