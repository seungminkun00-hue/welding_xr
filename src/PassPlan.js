import * as THREE from 'three';

/** Linear interpolation over [[key, value], ...] sorted by key. */
function track(keys, p) {
  if (!keys || keys.length === 0) return 0;
  if (p <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (p >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const [k0, v0] = keys[i - 1];
      const [k1, v1] = keys[i];
      const span = k1 - k0;
      return span > 1e-9 ? THREE.MathUtils.lerp(v0, v1, (p - k0) / span) : v1;
    }
  }
  return last[1];
}

const wrap01 = (x) => ((x % 1) + 1) % 1;

/**
 * One continuous arc-on run: everything between striking the arc and breaking
 * it. A stroke is the unit a master actually works in, and the unit a trainee
 * is graded in.
 *
 * Where a stroke starts and stops is NOT a property of the geometry. A circle
 * has no corners to break at; the breaks are there because a wrist does not
 * turn through 360 degrees and because the puddle behaves differently
 * overhead than it does flat. So stroke boundaries are authored or captured
 * data, never derived -- which is the whole reason this class is separate
 * from SeamCurve.
 *
 *   from, to  seam t, start and end of the stroke proper
 *   dir       +1 travels with increasing t, -1 against it
 *   tieIn     metres of overlap to run into a neighbouring stroke at each end
 *   profile   the master's technique, keyed on p, the stroke's own 0..1
 *             progress. For the pipe fillet p runs bottom to top, so p is the
 *             clock position rescaled; seam.clockAt(t) gives the real hour.
 */
export class Stroke {
  constructor({
    id,
    label = '',
    from,
    to,
    dir = 1,
    closed = false,
    tieIn = { lead: 0, trail: 0 },
    profile = {},
    crater = { dwell: 0.4, backstep: 0.004 },
  }) {
    this.id = id;
    this.label = label;
    this.from = from;
    this.to = to;
    this.dir = dir >= 0 ? 1 : -1;
    this.closed = closed;
    this.tieIn = tieIn;
    this.profile = profile;
    this.crater = crater;

    if (closed) {
      const raw = this.dir > 0 ? wrap01(to - from) : wrap01(from - to);
      this.span = raw < 1e-6 ? 1 : raw; // from == to means all the way round
    } else {
      this.span = Math.abs(to - from);
    }
  }

  /** Stroke-local progress 0..1 for a seam t. Can run outside [0,1]. */
  progressOf(t) {
    const ahead = this.closed
      ? (this.dir > 0 ? wrap01(t - this.from) : wrap01(this.from - t))
      : (t - this.from) * this.dir;
    // On a closed seam everything is "ahead" of the start; fold the far side
    // of the circle into negative progress so a trainee sitting just behind
    // the strike point reads as not started rather than nearly finished.
    const p = this.closed && ahead > this.span + (1 - this.span) / 2 ? ahead - 1 : ahead;
    return p / this.span;
  }

  /** Seam t for a stroke-local progress. */
  tAt(p) {
    const t = this.from + this.dir * p * this.span;
    return this.closed ? wrap01(t) : t;
  }

  /** How far outside the stroke proper the tie-in overlap reaches, in p. */
  leadP(seamLength) {
    return (this.tieIn.lead ?? 0) / (this.span * seamLength);
  }

  trailP(seamLength) {
    return (this.tieIn.trail ?? 0) / (this.span * seamLength);
  }

  /** The master's targets at this point in the stroke. */
  sample(p) {
    const w = this.profile.weave;
    return {
      speed: track(this.profile.speed, p),
      standoff: track(this.profile.standoff, p),
      travelAngle: track(this.profile.travelAngle, p),
      workAngle: track(this.profile.workAngle, p),
      weave: w
        ? {
            pattern: w.pattern ?? 'none',
            amp: track(w.amp, p),
            pitch: track(w.pitch, p),
            dwell: w.dwell ?? 0,
          }
        : null,
    };
  }

  /**
   * The master's lateral offset at p: the weave, drawn as a 2D figure in the
   * (progress, lateral) plane. The seam frame is what lifts it into 3D, so the
   * same weave data replays on a flat plate and on a pipe without change.
   */
  lateralAt(p, seamLength) {
    const w = this.profile.weave;
    if (!w || w.pattern === 'none') return 0;
    const amp = track(w.amp, p);
    const pitch = Math.max(track(w.pitch, p), 1e-4);
    const phase = ((p * this.span * seamLength) / pitch) % 1;
    switch (w.pattern) {
      case 'zigzag':
        return amp * (4 * Math.abs(phase - 0.5) - 1);
      case 'crescent':
        return amp * Math.sin(phase * Math.PI * 2);
      case 'triangle':
        // One side held against the pipe wall, the other swept out and back.
        return amp * (phase < 0.5 ? Math.sin(phase * Math.PI * 2) : 0);
      default:
        return 0;
    }
  }
}

/**
 * The ordered list of strokes that make up one joint, plus which one the
 * trainee is on.
 *
 * Deliberately dumb: it does not decide when a stroke is finished, because
 * that is a judgement about weld quality and lives in JointSession.
 */
export class PassPlan {
  constructor(strokes, { seam } = {}) {
    this.strokes = strokes;
    this.seam = seam;
    this.index = 0;
  }

  get current() {
    return this.strokes[this.index] ?? null;
  }

  get next() {
    return this.strokes[this.index + 1] ?? null;
  }

  get done() {
    return this.index >= this.strokes.length;
  }

  advance() {
    this.index = Math.min(this.index + 1, this.strokes.length);
    return this.current;
  }

  reset() {
    this.index = 0;
  }
}

/**
 * The master's plan for a pipe fillet welded in the fixed position, taken
 * straight off how it is actually done: two strokes, each starting at six
 * o'clock and climbing to twelve.
 *
 * Why not one lap? Three reasons, none of them geometric.
 *   - A wrist cannot follow a circle round without the arm crossing itself.
 *   - Uphill is the direction that works: the bead already laid down shelves
 *     the puddle, so it will not run out of the joint. Coming downhill from
 *     twelve, the puddle leads the arc and rides over cold metal.
 *   - The hardest part is six o'clock, flat overhead. A master starts there,
 *     while the rod is fresh and the joint is cold.
 *
 * The two tie-ins -- at six where both strokes strike, and at twelve where
 * both terminate -- are the parts a trainee gets wrong, so they are explicit
 * overlap data rather than a happy accident of the two arcs meeting.
 */
export function pipeFilletPlan(seam, { uphill = true } = {}) {
  const BOTTOM = 0.5; // six o'clock
  const TOP = 0.0; // twelve o'clock

  // Technique over the climb from six to twelve. p = 0 is overhead, p = 0.5 is
  // the vertical side, p = 1 is the near-flat top. Everything slows down and
  // opens up as the position gets harder.
  const climb = {
    // Slower overhead: the puddle has nothing holding it up but surface
    // tension, and a fat slow bead there will simply fall off.
    speed: [[0, 0.0022], [0.25, 0.0026], [0.5, 0.0030], [0.8, 0.0034], [1, 0.0030]],
    // Short arc overhead, a touch longer once gravity stops fighting.
    standoff: [[0, 0.0025], [0.3, 0.0030], [1, 0.0035]],
    // Drag angle, electrode tipped back against the direction of travel.
    travelAngle: [[0, -10], [0.5, -5], [1, -8]],
    // The 45 degree bisector is the frame's own normal, so a correct work
    // angle is zero here all the way round. That is the point of the frame.
    workAngle: [[0, 0], [1, 0]],
    weave: {
      pattern: 'crescent',
      amp: [[0, 0.0008], [0.3, 0.0018], [1, 0.0022]],
      pitch: [[0, 0.0030], [1, 0.0042]],
      dwell: 0.3,
    },
  };

  const dirA = uphill ? 1 : -1;
  const dirB = uphill ? -1 : 1;

  return new PassPlan(
    [
      new Stroke({
        id: 'A',
        label: '1획 · 6시 → 9시 → 12시',
        from: uphill ? BOTTOM : TOP,
        to: uphill ? TOP : BOTTOM,
        dir: dirA,
        closed: true,
        tieIn: { lead: 0, trail: 0.006 },
        profile: climb,
      }),
      new Stroke({
        id: 'B',
        label: '2획 · 6시 → 3시 → 12시',
        from: uphill ? BOTTOM : TOP,
        to: uphill ? TOP : BOTTOM,
        dir: dirB,
        closed: true,
        // Strike back over where stroke A started, and finish back over where
        // it ended. Both overlaps are the tie-in; neither is optional.
        tieIn: { lead: 0.006, trail: 0.008 },
        profile: climb,
      }),
    ],
    { seam }
  );
}
